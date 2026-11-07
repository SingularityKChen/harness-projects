import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import * as model from '@harness-projects/ui-model'
import { createEntityStore } from '@harness-projects/client'

const row = (key, title, extra = {}) => ({ kind:'item', key, title, identity:'Issue', planningStatus:'待办', iteration:'—', targetDate:'—', engineering:'无', source:'来源', authority:'提供方权威', stale:false, ...extra })
const redacted = { kind:'redacted', key:'private-key' }
const rows = [row('c','Beta',{iteration:'Sprint 1',targetDate:'2026-11-04'}),redacted,row('a','alpha',{planningStatus:'完成',targetDate:'2026-11-03'}),row('b','Alpha',{targetDate:'2026-02-30'})]
const keys = result => result.rows.map(r=>r.key)

test('查询只匹配标题，组合当前展示值 facet；计数不含 redacted，占位固定在尾部', () => {
  const result = model.queryVisibleWorkItems(rows,{search:' ALPHA ',planningStatus:'待办'})
  assert.deepEqual(keys(result),['b','private-key'])
  assert.equal(result.loadedReadableCount,3); assert.equal(result.matchedReadableCount,1)
  assert.deepEqual(result.facets,{planningStatus:['待办','完成'],iteration:['Sprint 1','—']})
  assert.equal(result.hasQuery,true)
  assert.deepEqual(keys(model.queryVisibleWorkItems(rows,{search:'来源'})),['private-key'])
  assert.deepEqual(keys(model.queryVisibleWorkItems([row('u','CAFÉ 工程')],{search:'cafe\u0301'})),['u'])
})

test('单列排序不改输入、相同值稳定；缺失与非法日期升降都在末尾', () => {
  const before = structuredClone(rows)
  for(const [column,direction,want] of [
    ['title','asc',['a','b','c','private-key']],['title','desc',['c','a','b','private-key']],
    ['targetDate','asc',['a','c','b','private-key']],['targetDate','desc',['c','a','b','private-key']],
    ['iteration','desc',['c','a','b','private-key']],
  ]) assert.deepEqual(keys(model.queryVisibleWorkItems(rows,{sort:{column,direction}})),want)
  assert.deepEqual(rows,before)
  assert.deepEqual(keys(model.queryVisibleWorkItems(rows)),['c','a','b','private-key'])
})

test('权限刷新撤去 facet 时同一次归一清空旧条件；标题必显，非法列和 sort 不存活', () => {
  const result = model.queryVisibleWorkItems([rows[0],redacted],{
    search:'Beta',planningStatus:'已撤权状态',iteration:'已撤权迭代',sort:{column:'source',direction:'asc'},visibleColumns:['source','title','source','private'],
  })
  assert.deepEqual(result.conditions,{search:'Beta',planningStatus:null,iteration:null,sort:null,visibleColumns:['title','source']})
  assert.equal(result.conditionsAdjusted,true)
  assert.doesNotMatch(JSON.stringify(result),/已撤权/)
  assert.deepEqual(keys(result),['c','private-key'])
  const defaults = model.defaultLocalTableConditions()
  assert.deepEqual(defaults.visibleColumns,['title','planningStatus','iteration','targetDate','engineering'])
  assert.deepEqual(model.queryVisibleWorkItems(rows,defaults).conditions,defaults)
  assert.equal(model.queryVisibleWorkItems([],defaults).loadedReadableCount,0)
  assert.equal(model.queryVisibleWorkItems([redacted],defaults).matchedReadableCount,0)
})

test('原始不可见值变化经安全投影后不能改变 matches/order/options/count；raw-first 排序负控可被识别', () => {
  function project(secret) {
    const store=createEntityStore()
    const wire=(entityId,title,contentKind='work_item')=>({entityId,kind:'work_item',planningStatus:'todo',derived:[],content:{contentKind,title,bindingId:'binding',externalKind:'issue',externalId:entityId},source:{revision:1,freshness:'fresh',authority:'provider'}})
    const entities=[wire('a','B'),wire('hidden',secret,'redacted'),wire('b','A')]
    store.applyBaseline({revision:1,entities,source:{revision:1,freshness:'fresh',authority:'provider'}})
    // Violate the client boundary deliberately: presentation still strips revoked number metadata.
    store.get('hidden').entity.content.sourceNumber={sourceName:secret,scopeName:secret,number:449,scopeIdentity:{namespace:'hidden',id:secret}}
    return {entities,view:model.deriveWorkItemListView({phase:'received',refreshing:false,metadata:{sourceNames:{}},read:{workspace:{id:'ws',name:'Workspace'},store,connection:{connected:true},lastUpdatedAt:'2026-11-03T00:00:00Z',capabilities:[{key:'planning.item.read',access:'available'}]}})}
  }
  const a=project('AAA SECRET'),b=project('ZZZ SECRET')
  const conditions={search:'A',sort:{column:'title',direction:'asc'}}
  assert.deepEqual(model.queryVisibleWorkItems(a.view.body.rows,conditions),model.queryVisibleWorkItems(b.view.body.rows,conditions))
  assert.equal(a.view.statusText,'已读取当前快照，共 2 项可读条目')
  assert.doesNotMatch(JSON.stringify(model.queryVisibleWorkItems(a.view.body.rows)),/SECRET/)
  const unsafeOrder=p=>p.entities.toSorted((x,y)=>x.content.title.localeCompare(y.content.title)).map(e=>e.entityId)
  assert.notDeepEqual(unsafeOrder(a),unsafeOrder(b),'负控：先用 raw 排序会让占位位置依赖秘密值')
})

// Explicit #number is exact; unprefixed digits preserve existing title search.
test('native number search is exact across repositories and sources; ordinary title search remains', () => {
  const visible=[row('a','Build',{sourceNumber:449,numberLabel:'GitHub owner/one#449'}),row('b','Build',{sourceNumber:449,numberLabel:'GitLab owner/two#449'}),row('c','449 in title',{sourceNumber:1449,numberLabel:'GitHub owner/one#1449'}),redacted]
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:'449'})),['a','b','c','private-key'])
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:'#449'})),['a','b','private-key'])
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:' GITHUB OWNER/ONE#449 '})),['a','private-key'])
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:'build'})),['a','b','private-key'])
})


test('qualified native tokens exclude other repository/source and Draft titles; case NFC and trim remain exact', () => {
  const visible=[row('native','Build',{sourceNumber:449,numberLabel:'GitHub example/one#449'}),row('unrelated','Follow up GitHub example/one#449',{sourceNumber:891,numberLabel:'GitLab example/two#891'}),row('draft','Discuss GitHub example/one#449'),row('unicode','Build',{sourceNumber:449,numberLabel:'GitHub examplé/one#449'}),redacted]
  for(const [search,want] of [[' GitHub EXAMPLE/ONE#449 ','native'],[' GITHUB EXAMPLE\u0301/ONE#449 ','unicode']]) {
    const result=model.queryVisibleWorkItems(visible,{search})
    assert.deepEqual(keys(result),[want,'private-key'])
    assert.equal(result.matchedReadableCount,1);assert.equal(result.loadedReadableCount,4)
  }
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:'#449'})),['native','unicode','private-key'])
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:'449'})),['native','unrelated','draft','unicode','private-key'])
  assert.deepEqual(keys(model.queryVisibleWorkItems(visible,{search:'discuss'})),['draft','private-key'])
})

test('unknown qualified native tokens do not fall back to title search or count hidden rows', () => {
  const visible=[row('other','Mention GitHub missing/repo#449',{sourceNumber:891,numberLabel:'GitHub example/two#891'}),row('draft','Discuss GitHub missing/repo#449'),redacted]
  const result=model.queryVisibleWorkItems(visible,{search:' GitHub MISSING/REPO#449 '})
  assert.deepEqual(keys(result),['private-key'])
  assert.equal(result.matchedReadableCount,0);assert.equal(result.loadedReadableCount,2)
})


test('a large ordinary query remains accepted without truncation in an isolated bounded process', () => {
  // A lifetime guard contains a regressed parser; no millisecond speed or growth-ratio assertion.
  const moduleUrl=new URL('../../packages/ui-model/src/local-table-view.ts',import.meta.url).href
  const code=`import { queryVisibleWorkItems } from ${JSON.stringify(moduleUrl)}; const search='a'+' '.repeat(1_000_000)+'tail'; const row={kind:'item',key:'visible',title:search,identity:'Issue',planningStatus:'待办',iteration:'—',targetDate:'—',engineering:'无',source:'Test',authority:'provider',stale:false}; const result=queryVisibleWorkItems([row],{search}); console.log(JSON.stringify({matches:result.matchedReadableCount,keys:result.rows.map(r=>r.key),length:result.conditions.search.length}))`
  const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:5000})
  assert.equal(result.error?.code,undefined,'isolated query failed or exceeded its lifetime guard')
  assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout),{matches:1,keys:['visible'],length:1_000_005})
})
