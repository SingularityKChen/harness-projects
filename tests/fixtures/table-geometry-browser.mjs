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
import { WorkItemApp, WorkItemListPage, WorkspaceSetupGate } from '@harness-projects/ui'
import { deriveWorkItemListView } from '@harness-projects/ui-model'
import { wire, redacted } from './tests/fixtures/work-item-wire.mjs'
const store=createEntityStore(), params=new URLSearchParams(location.search)
const title='Readable title '+ 'LongUnbrokenTitle'.repeat(18)
const entities=Array.from({length:120},(_,i)=>wire('item-'+i,{content:{title:i===0?title:'Work item '+i,externalKind:i%2?'change_request':'issue'},planningFields:i%3?{iterationTitle:'IterationWithoutSpaces'.repeat(8),targetDate:'2026-11-03'}:undefined}))
entities.splice(1,0,redacted('redacted',{},{planningFields:{iterationTitle:'CANARY-ITERATION',targetDate:'2099-12-31'}}))
store.applyBaseline({revision:0,entities,source:{revision:0,freshness:'fresh',authority:'provider'}})
let read={workspace:{id:'ws-1',name:'Table workspace'},planningSource:{bindingId:'bind-1',name:'SourceWithoutSpaces'.repeat(10)},store,connection:{connected:true},lastUpdatedAt:'2026-11-03T01:00:00.000Z',capabilities:[{key:'planning.item.read',access:'read_only'}]}
const readers=new Set(),setups=new Set()
const source={subscribe:listener=>{readers.add(listener);return()=>readers.delete(listener)},getSnapshot:()=>read}
let setup={pending:false,setup:{workspace:read.workspace,planning:{state:'confirmed',bindingId:'bind-1',projectNodeId:'project-1'}}}
const setupSource={subscribe:listener=>{setups.add(listener);return()=>setups.delete(listener)},getSnapshot:()=>setup,refresh:async()=>{}}
const refresh={pending:false},refreshSource={subscribe:()=>()=>{},getSnapshot:()=>refresh,refresh:async()=>{read={...read,lastUpdatedAt:'2026-11-03T01:01:00.000Z'};readers.forEach(listener=>listener())}}
const page=params.has('standalone')?h(WorkItemListPage,{view:deriveWorkItemListView({read,phase:'received',refreshing:false,metadata:{sourceNames:{'bind-1':'SourceWithoutSpaces'.repeat(10)}}})}):params.has('app')?h(WorkItemApp,{source,refreshSource}):h(WorkspaceSetupGate,{source,setupSource,refreshSource})
window.resizeParentClicks=0
const wrapped=()=>h('div',{style:{display:'contents'},onClick:()=>{window.resizeParentClicks++}},page)
let appRoot=window.ReactDOM.createRoot(document.getElementById('app'));appRoot.render(wrapped())
window.tableFixture={scope:(workspaceId,bindingId)=>{read={...read,workspace:{...read.workspace,id:workspaceId},planningSource:{...read.planningSource,bindingId}};setup={...setup,setup:{...setup.setup,workspace:read.workspace,planning:{...setup.setup.planning,bindingId}}};setups.forEach(listener=>listener());readers.forEach(listener=>listener())},unmount:()=>appRoot.unmount(),mount:()=>{appRoot=window.ReactDOM.createRoot(document.getElementById('app'));appRoot.render(wrapped())}}
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
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root { font:15px/1.5 system-ui; color-scheme:light; color:CanvasText; background:Canvas; --dsw-focus-ring-color:Highlight }
  :root.dark {color-scheme:dark} html,body {margin:0;min-width:0} #app {height:100dvh;display:flex;flex-direction:column;min-width:0}
  </style><div id="app"></div><script src="/react.js"></script><script src="/jsx-runtime.js"></script><script src="/react-dom.js"></script><script>
  const themeParams=new URLSearchParams(location.search);if(themeParams.has('dark'))document.documentElement.className='dark';if(themeParams.has('zoom'))document.documentElement.style.fontSize='30px';window.require=(id)=>{if(id==='react')return React;if(id==='react/jsx-runtime')return window.ReactJSX;throw Error(id)};var module={exports:{}};</script><script src="/bundle.js"></script></html>`
  const server=createServer((request,response)=>{const script=scripts[new URL(request.url,'http://fixture.invalid').pathname];response.writeHead(200,{'content-type':script===undefined?'text/html':'text/javascript'});response.end(script??html)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))}
}
