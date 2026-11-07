import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootstrapWorkspace, createContext, createQueries, promoteEntityIdentity } from '@harness-projects/core'
import { createController, toWireEntity } from '@harness-projects/controller'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { deriveWorkItemListView, deriveWorkItemDetailView, queryVisibleWorkItems } from '@harness-projects/ui-model'

// Synthetic GraphQL transport: these objects are not recorded platform observations.
const at = '2026-11-07T00:00:00Z', bindingId = 'planning', projectId = 'project'
const nativeNumber = (scopeName = 'example/one', number = 449) => ({ sourceName:'GitHub', scopeIdentity:{namespace:'github.com/graphql/Repository',id:`repo-${scopeName}`}, scopeName, number })
const node = (key, typename, repo = 'example/one', number = 449) => ({
  id:`membership-${key}`,type:{Issue:'ISSUE',PullRequest:'PULL_REQUEST',DraftIssue:'DRAFT_ISSUE'}[typename],createdAt:at,updatedAt:at,
  content:{__typename:typename,id:key,title:`Title ${key}`,body:'Body',updatedAt:at,url:'https://github.com/example/one/issues/449',number,repository:{id:`repo-${repo}`,nameWithOwner:repo}},
  fieldValues:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[]},
})
function fixture() {
  const state = { nodes:[node('issue-one','Issue'),node('issue-two','Issue','example/two'),node('pr','PullRequest'),node('draft','DraftIssue')] }
  const transport = async ({operationName}) => state.denied ? {status:401,headers:{},body:{message:'Bad credentials'}} : ({status:200,headers:{},body:{data:{node:operationName === 'PlanningProject'
    ? {__typename:'ProjectV2',id:projectId,title:'Numbers',url:'https://github.com/orgs/example/projects/1',updatedAt:at}
    : {__typename:'ProjectV2',items:{pageInfo:{hasNextPage:false,endCursor:null},nodes:structuredClone(state.nodes)}}}}})
  const planning = createGithubProjectsPlanningProvider({bindingId,projectNodeId:projectId,transport})
  return {state,planning}
}
const input = read => ({phase:'received',refreshing:false,metadata:{sourceNames:{}},read})

test('production provider → SQLite reopen → controller/client → default list/detail keeps qualified numbers; redaction clears them', async () => {
  const dir = mkdtempSync(join(tmpdir(),'source-numbers-')), path = join(dir,'workspace.sqlite')
  const {planning,state} = fixture(), workspace = {id:'numbers',name:'Numbers',project:{bindingId,objectKind:'project',externalId:projectId,url:undefined}}
  let storage = createSqliteStorage(path)
  try {
    let context = await createContext({workspace,providers:{planning},storage})
    assert.equal((await bootstrapWorkspace(context)).ok,true)
    const before = await createQueries(context).listPlanningItems()
    const issue = before.find(v => v.content.identity.externalId === 'issue-one')
    assert.deepEqual(issue.content.sourceNumber,nativeNumber())
    storage.close(); storage = createSqliteStorage(path)
    context = {...context,storage}
    assert.deepEqual(await createQueries(context).listPlanningItems(),before)
    storage.db.prepare('UPDATE workspace_projection SET source_number_json = ? WHERE entity_id = ?').run(JSON.stringify({...nativeNumber(),credential:'forbidden'}),issue.entityId)
    await assert.rejects(storage.getPlanningProjection('numbers',issue.entityId),TypeError)
    storage.db.prepare('UPDATE workspace_projection SET source_number_json = ? WHERE entity_id = ?').run(JSON.stringify(nativeNumber()),issue.entityId)
    const core = {queries:createQueries(context),commands:{}}
    const controller = createController(core), store = createEntityStore(), sync = createSync(createTransport(controller),store)
    await sync.connect()
    const view = deriveWorkItemListView(input(sync.read()))
    const one = view.body.rows.find(r => r.key === issue.entityId)
    assert.equal(one.numberLabel,'GitHub example/one#449')
    assert.equal(view.body.rows.find(r => r.title === 'Title draft').numberLabel,'暂无原生编号')
    assert.equal(deriveWorkItemDetailView(input(sync.read()),{projectId:'numbers',itemId:issue.entityId}).body.numberLabel,one.numberLabel)
    for (const search of ['449','#449']) assert.equal(queryVisibleWorkItems(view.body.rows,{search}).matchedReadableCount,3)
    assert.equal(queryVisibleWorkItems(view.body.rows,{search:' github EXAMPLE/ONE#449 '}).matchedReadableCount,2)
    assert.equal(queryVisibleWorkItems(view.body.rows,{search:'#44'}).matchedReadableCount,0)
    const oldId = issue.entityId
    state.nodes[0] = {...state.nodes[0],type:'REDACTED',content:null}
    assert.equal((await bootstrapWorkspace(context)).ok,true)
    await sync.reconnect()
    const hidden = store.get(oldId).entity
    assert.equal(hidden.content.sourceNumber,undefined)
    assert.doesNotMatch(JSON.stringify(hidden),/example\/one|449/)
    const after = deriveWorkItemListView(input(sync.read()))
    assert.deepEqual(after.body.rows.find(r=>r.key===oldId),{kind:'redacted',key:oldId})
    assert.equal(queryVisibleWorkItems(after.body.rows,{search:'#449'}).matchedReadableCount,2)
    const row = storage.db.prepare('SELECT source_number_json FROM workspace_projection WHERE entity_id = ?').get(oldId)
    assert.equal(row.source_number_json,null)
    // Existing promotion command retains EntityId while the next native observation adds its number.
    const draft = before.find(v=>v.content.identity.externalId==='draft')
    const promoted = await storage.transaction(tx=>promoteEntityIdentity(tx,draft.entityId,'promoted-issue'))
    assert.equal(promoted.ok,true)
    state.nodes[3] = {...node('promoted-issue','Issue','example/promoted',450),id:'membership-draft'}
    assert.equal((await bootstrapWorkspace(context)).ok,true)
    const promotedViews = await createQueries(context).listPlanningItems()
    assert.equal(promotedViews.length,4)
    assert.deepEqual(promotedViews.find(v=>v.entityId===draft.entityId).content.sourceNumber,nativeNumber('example/promoted',450))
    state.denied=true
    assert.equal((await bootstrapWorkspace(context)).ok,false)
    await sync.reconnect()
    assert.doesNotMatch(JSON.stringify(store.list()),/example\/|sourceNumber|449|450/)
    assert.doesNotMatch(JSON.stringify(deriveWorkItemListView(input(sync.read()))),/example\/|sourceNumber|449|450/)
  } finally { storage.close(); rmSync(dir,{recursive:true,force:true}) }
})

test('provider rejects unsafe native number and repository shape instead of inventing a label', async () => {
  for (const mutate of [n=>n.content.number=0,n=>n.content.number=Number.MAX_SAFE_INTEGER+1,n=>n.content.repository.id='',n=>n.content.repository.nameWithOwner='']) {
    const {planning,state}=fixture(); mutate(state.nodes[0])
    assert.equal((await planning.listPlanningItems({project:{bindingId,objectKind:'project',externalId:projectId},limit:100})).ok,false)
  }
})

test('client rejects malformed source metadata atomically and rejects redacted metadata; wire masks a poisoned redacted view', () => {
  const source = {revision:1,freshness:'fresh',authority:'provider'}
  const entity = {entityId:'safe',kind:'work_item',planningStatus:'todo',derived:[],source,content:{contentKind:'work_item',title:'Safe',bindingId,sourceNumber:nativeNumber()}}
  const baseline = e => ({revision:1,source,entities:[e]})
  const store = createEntityStore(); store.applyBaseline(baseline(entity))
  for (const bad of [{...nativeNumber(),number:-1},{...nativeNumber(),extra:'secret'},{...nativeNumber(),scopeIdentity:{namespace:'',id:'r'}},{...nativeNumber(),scopeName:''}]) {
    assert.throws(()=>store.applyBaseline(baseline({...entity,content:{...entity.content,sourceNumber:bad}})),TypeError)
    assert.equal(store.get('safe').entity,entity)
  }
  assert.throws(()=>store.applyBaseline(baseline({...entity,content:{...entity.content,contentKind:'redacted'}})),TypeError)
  const wire = toWireEntity({entityId:'hidden',kind:'work_item',planningStatus:'unknown',content:{...entity.content,contentKind:'redacted',identity:{bindingId,externalKind:'issue',externalId:'opaque'}},engineering:{derived:[],facts:[]},freshness:{revision:1,degraded:false}},'provider')
  assert.equal(wire.content.sourceNumber,undefined)
})

test('Core rejects inconsistent PR dual numbers before committing any row', async () => {
  const {planning} = fixture(), list = planning.listPlanningItems.bind(planning)
  planning.listPlanningItems = async input => {
    const result = await list(input)
    if(result.ok) result.value.items.find(x=>x.content.kind==='change_request').content.changeRequest.number=450
    return result
  }
  const storage=createSqliteStorage(':memory:')
  try {
    const context=await createContext({workspace:{id:'conflict',name:'Conflict'},providers:{planning},storage})
    const result=await bootstrapWorkspace(context)
    assert.equal(result.ok,false)
    assert.deepEqual(await storage.listPlanningProjections('conflict'),[])
  } finally {storage.close()}
})
