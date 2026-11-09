import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { DeliveryOverview } from '../../packages/ui/src/delivery-overview.ts'
const require=createRequire(new URL('../../packages/ui/package.json',import.meta.url)), React=require('react'), {renderToStaticMarkup}=require('react-dom/server')
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function mount(props) {
  const cells=[];let cursor=0,jobs=[]
  const slot=make=>cells[cursor++]??(cells[cursor-1]=make())
  const dispatcher={useRef:value=>slot(()=>({current:value})),useState:value=>{const c=slot(()=>({value}));return[c.value,n=>{c.value=typeof n==='function'?n(c.value):n}]},useEffect:(run,deps)=>{const c=slot(()=>({}));if(!c.deps||deps.some((v,i)=>!Object.is(v,c.deps[i])))jobs.push(()=>{c.cleanup?.();c.cleanup=run()});c.deps=deps;c.run=run}}
  return {props,render(){const d=React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher,old=d.current;d.current=dispatcher;cursor=0;try{return DeliveryOverview(props)}finally{d.current=old}},flush(){jobs.splice(0).forEach(run=>run())},replayEffects(){cells.filter(c=>c.run).forEach(c=>{c.cleanup?.();c.cleanup=c.run()})},close(){cells.forEach(c=>c.cleanup?.())}}
}
const all=(node,predicate)=>node==null||typeof node!=='object'?[]:[...(predicate(node)?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(child=>all(child,predicate))]
const sections=tree=>all(tree,node=>node.props?.presentation==='summary')
const targets=(count=23)=>({kind:'content',repositoryIds:['a','z'],items:Array.from({length:count},(_,i)=>({key:'i'+i,title:'Title '+i,target:{workspaceId:'ws',workItemId:'i'+i,repositoryIds:['a','z']},accessTokens:{a:'v1',z:'v1'}}))})
test('page refresh caps three flights and cancels queued old scopes', async()=>{
  assert.equal(typeof DeliveryOverview,'function')
  const flights=[],reads=[],h=mount({targets:targets(),connected:true,reader:{refresh:scope=>new Promise(resolve=>flights.push({scope,resolve})),read:async scope=>{reads.push(scope);return scope}}})
  let tree=h.render();h.flush();const rows=sections(tree);assert.equal(rows.length,20);assert.ok(rows.every(r=>r.props.scope.repositoryId==='a'))
  const tasks=rows.map(r=>r.props.reader.refresh(r.props.scope).catch(()=>{}));await settle();assert.equal(flights.length,3)
  flights[0].resolve();await settle();assert.equal(flights.length,4)
  const next=all(tree,node=>node.type==='button'&&node.props.children==='下一页')[0];next.props.onClick();tree=h.render();h.flush()
  const newRows=sections(tree);assert.equal(newRows.length,3);const fresh=newRows.map(r=>r.props.reader.refresh(r.props.scope).catch(()=>{}));await settle();assert.equal(flights.length,4)
  flights.slice(1).forEach(f=>f.resolve());await settle();assert.equal(flights.length,7);assert.ok(flights.slice(4).every(f=>Number(f.scope.workItemId.slice(1))>=20))
  flights.slice(4).forEach(f=>f.resolve());await Promise.all([...tasks,...fresh]);h.close()
})
test('unreadable targets dispatch nothing and access generations replace row readers immediately',()=>{
  assert.equal(typeof DeliveryOverview,'function')
  let calls=0;const h=mount({targets:targets(1),connected:true,reader:{refresh:async()=>{calls++},read:async()=>{calls++}}})
  const first=sections(h.render())[0];h.flush();h.props.targets={...targets(1),items:[{...targets(1).items[0],accessTokens:{a:'revoked',z:'v1'}}]}
  const replacement=sections(h.render())[0];assert.notEqual(first.props.reader,replacement.props.reader)
  h.props.targets={kind:'unavailable'};const html=renderToStaticMarkup(h.render());h.flush()
  assert.match(html,/无法读取工作项/);assert.doesNotMatch(html,/Title|共.*项/);assert.equal(calls,0);h.close()
})

test('StrictMode replay preserves every queued refresh intent without duplicate ingestion', async()=>{
  const flights=[],h=mount({targets:targets(20),connected:true,reader:{refresh:scope=>new Promise(resolve=>flights.push({scope,resolve})),read:async scope=>scope}})
  const rows=sections(h.render());h.flush()
  const tasks=rows.map(row=>row.props.reader.refresh(row.props.scope));const complete=Promise.allSettled(tasks)
  h.replayEffects();await settle()
  for(let turn=0;turn<8;turn++){flights.forEach(f=>f.resolve());await settle()}
  assert.equal(flights.length,20);assert.equal(new Set(flights.map(f=>f.scope.workItemId)).size,20)
  assert.ok((await complete).every(result=>result.status==='fulfilled'));h.close()
})
