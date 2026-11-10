/** 合成读取输入 + 真实 WorkItemApp；有界 slot 模拟布局约束，不声称安装 Host。 */
import './resolution-preflight.mjs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const uiRequire = createRequire(path.join(root, 'packages/ui/package.json'))
const { build } = createRequire(path.join(root, 'apps/harness-plugin/package.json'))('esbuild')
const entry = `
import { createElement as h } from 'react'
import { createEntityStore } from '@harness-projects/client'
import { WorkItemApp, WorkItemListPage, WorkspaceSetupGate, bindWorkspaceStatusApp } from '@harness-projects/ui'
import { deriveWorkItemListView } from '@harness-projects/ui-model'
import { wire, redacted } from './tests/fixtures/work-item-wire.mjs'
const store=createEntityStore(), params=new URLSearchParams(location.search)
const title='Readable title '+ 'LongUnbrokenTitle'.repeat(18)
let entities=Array.from({length:120},(_,i)=>wire('item-'+i,{content:{title:i===0?title:'Work item '+i,externalKind:i%2?'change_request':'issue'},planningFields:i%3?{iterationTitle:'IterationWithoutSpaces'.repeat(8),targetDate:'2026-11-03'}:undefined}))
entities.splice(1,0,redacted('redacted',{},{planningFields:{iterationTitle:'CANARY-ITERATION',targetDate:'2099-12-31'}}))
if (params.has('reference')) {
 const tasks = [
  [554, '为新会话保留可恢复的执行身份', 'in_progress', 'Core 恢复', '2026-11-13'],
  [604, '统一工作区视觉与导航层次，并在窄屏下保留真实来源与可访问状态', 'in_progress', '现代看板', '2026-11-12'],
  [605, '呈现真实规划数据的只读看板', 'todo', '现代看板'],
  [603, '确认本次发布的具体视觉目标', 'todo', '现代看板', '2026-11-11'],
  [415, '删除发布前旧数据修复路径', 'todo', 'Core 恢复', '2026-11-14'],
  [416, '明确观察视图与事件表的真实消费者', 'unknown', 'Core 恢复'],
  [594, '显示来源原生父项与子议题', 'done', '现代看板', '2026-11-10'],
 ]
 entities = tasks.map(([number, title, planningStatus, iterationTitle, targetDate], index) => wire('item-' + index, {
  planningStatus, content: { title, sourceNumber: { sourceName: 'GitHub', scopeIdentity: { namespace: 'github.com/graphql/Repository', id: 'reference' }, scopeName: 'example/project', number } },
  planningFields: { iterationTitle, targetDate, ...(number === 416 ? { statusName: '待确认' } : {}) },
 }))
}
store.applyBaseline({revision:0,entities,source:{revision:0,freshness:'fresh',authority:'provider'}})
let read={workspace:{id:'ws-1',name:'Table workspace'},planningSource:{bindingId:'bind-1',name:'SourceWithoutSpaces'.repeat(10)},store,connection:{connected:true},lastUpdatedAt:'2026-11-03T01:00:00.000Z',reconciledAt:'2026-11-03T01:00:00.000Z',capabilities:[{key:'planning.item.read',access:'read_only'}]}
if (params.has('reference')) read = { ...read, workspace: { id: 'ws-1', name: 'Harness Projects / 交付工作台' }, planningSource: { bindingId: 'bind-1', name: 'GitHub Projects' }, repositories: [{ id: 'example/project', capabilities: [] }] }
const deliveryReader = { refresh: async () => {}, read: async scope => ({ ...scope, now: '2026-11-10T02:26:00Z', projection: { workItemId: scope.workItemId, repositoryId: scope.repositoryId, hops: [], optional: [], freshness: [], degraded: false, gaps: [] } }) }
const readers=new Set(),setups=new Set();const publish=()=>{read={...read};readers.forEach(listener=>listener())}
let readPaused=false
const source={subscribe:listener=>{readers.add(listener);return()=>readers.delete(listener)},getSnapshot:()=>readPaused?undefined:read}
let setup={pending:false,setup:{workspace:read.workspace,planning:{state:'confirmed',bindingId:'bind-1',projectNodeId:'project-1'}}}
const setupSource={subscribe:listener=>{setups.add(listener);return()=>setups.delete(listener)},getSnapshot:()=>setup,refresh:async()=>{}}
let refresh={pending:false};const refreshers=new Set(),refreshSource={subscribe:listener=>{refreshers.add(listener);return()=>refreshers.delete(listener)},getSnapshot:()=>refresh,refresh:async()=>publish()}
const Header=bindWorkspaceStatusApp(setupSource,source,undefined,{refreshSource, deliveryReader})
const page=params.has('header')?h(Header):params.has('standalone')?h(WorkItemListPage,{view:deriveWorkItemListView({read,phase:'received',refreshing:false,metadata:{sourceNames:{'bind-1':'SourceWithoutSpaces'.repeat(10)}}})}):params.has('app')?h(WorkItemApp,{source,refreshSource,initialPath:params.get('path')??undefined}):h(WorkspaceSetupGate,{source,setupSource,refreshSource})
window.resizeParentClicks=0;const wrapped=()=>h('div',{style:{display:'contents'},onClick:()=>window.resizeParentClicks++},page);let appRoot=window.ReactDOM.createRoot(document.getElementById('app'));appRoot.render(wrapped())
let revision=0
const replace=values=>{store.applyBaseline({revision:++revision,entities:values,source:{revision,freshness:'fresh',authority:'provider'}});publish()}
window.queryFixture={scope:(workspaceId,bindingId)=>{read={...read,workspace:{...read.workspace,id:workspaceId},planningSource:{...read.planningSource,bindingId}};setup={...setup,setup:{...setup.setup,workspace:read.workspace,planning:{...setup.setup.planning,bindingId}}};setups.forEach(listener=>listener());publish()},hidden:()=>replace(entities.map(row=>row.content.contentKind==='redacted'?{...row,content:{...row.content,title:'OTHER-HIDDEN-TITLE',bindingId:'OTHER-HIDDEN-BIND'},planningFields:{iterationTitle:'OTHER-HIDDEN-ITERATION'}}:row)),revokeFacet:()=>replace(entities.map(row=>row.planningFields?.iterationTitle?{...row,content:{...row.content,contentKind:'redacted'}}:row)),stale:()=>{store.markAllStale();publish()},restore:()=>replace(entities),empty:()=>replace([]),unknown:()=>{read={...read,capabilities:[]};publish()}}
window.headerFixture={reading:value=>{readPaused=value;publish()},setupState:extra=>{setup={...setup,...extra};setups.forEach(listener=>listener())},state:(extra,operation={pending:false})=>{read={...read,...extra};refresh=operation;refreshers.forEach(listener=>listener());publish()},long:(name='WorkspaceWithoutSpaces'.repeat(12))=>{setup={...setup,setup:{...setup.setup,workspace:{...setup.setup.workspace,name}}};setups.forEach(listener=>listener());publish()}}
window.tableFixture={scope:window.queryFixture.scope,unmount:()=>appRoot.unmount(),mount:()=>{appRoot=window.ReactDOM.createRoot(document.getElementById('app'));appRoot.render(wrapped())}}

`
export async function startTableGeometryServer() {
  const vendor = (id, file) => readFile(path.join(path.dirname(uiRequire.resolve(id)), 'umd', file), 'utf8')
  const [bundle, react, reactDOM, jsxRuntime] = await Promise.all([
    build({stdin:{contents:entry,resolveDir:root},absWorkingDir:root,bundle:true,platform:'browser',format:'cjs',write:false,external:['react'],logLevel:'silent'}),
    vendor('react','react.development.js'),vendor('react-dom/client','react-dom.development.js'),
    build({entryPoints:[uiRequire.resolve('react/jsx-runtime')],bundle:true,platform:'browser',format:'cjs',external:['react'],write:false,logLevel:'silent'}),
  ])
  const jsxScript=`(function(){const module={exports:{}};const exports=module.exports;const require=id=>{if(id==='react')return window.React;throw Error(id)};${jsxRuntime.outputFiles[0].text}\nwindow.ReactJSX=module.exports;})()`
  const scripts={'/jsx-runtime.js':jsxScript,'/react.js':react,'/react-dom.js':reactDOM,'/bundle.js':bundle.outputFiles[0].text}
  const { palette } = JSON.parse(await readFile(path.join(root, 'docs/product/release-visual-target-v3/host-role-palette-v3.json'), 'utf8'))
  const roles = {
    'bg-base':'bg', 'bg-layer-1':'surface',
    'label-primary':'text', 'label-secondary':'muted',
    'border-l2':'line', 'border-l4':'cardBorder',
    'interactive-bg-hover-solid':'soft', 'bg-multi-select':'select',
    'button-primary-fill':'primary', 'label-primary-foreground':'onPrimary',
    'button-primary-hover':'primaryHover', 'state-success-primary':'good', 'link':'accent',
  }
  const roleStyles = Object.entries(palette).map(([mode, values]) => `:root.roles${mode === 'dark' ? '.dark' : ''} {${Object.entries(roles).map(([role, key]) => `--dsw-alias-${role}:${values[key]}`).join(';')}}`).join('')
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  ${roleStyles}
  :root { font:14px/1.5 system-ui; color-scheme:light; color:CanvasText; background:Canvas; --dsw-focus-ring-color:Highlight }
  :root.dark {color-scheme:dark} html,body {margin:0;min-width:0} #app {height:100dvh;display:flex;flex-direction:column;min-width:0}
  </style><div id="app"></div><script src="/react.js"></script><script src="/jsx-runtime.js"></script><script src="/react-dom.js"></script><script>
  const themeParams=new URLSearchParams(location.search);if(themeParams.has('dark'))document.documentElement.classList.add('dark');if(themeParams.has('reference')&&!themeParams.has('fallback'))document.documentElement.classList.add('roles');if(themeParams.has('zoom'))document.documentElement.style.fontSize='28px';window.require=(id)=>{if(id==='react')return React;if(id==='react/jsx-runtime')return window.ReactJSX;throw Error(id)};var module={exports:{}};</script><script src="/bundle.js"></script></html>`
  const server=createServer((request,response)=>{const script=scripts[new URL(request.url,'http://fixture.invalid').pathname];response.writeHead(200,{'content-type':script===undefined?'text/html':'text/javascript'});response.end(script??html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))}
}
