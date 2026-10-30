/** 本地视觉输入：真实 WorkItemApp、client EntityStore 与 ui-model；不替代安装 Host。 */
import './resolution-preflight.mjs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const uiRequire = createRequire(path.join(repoRoot, 'packages/ui/package.json'))
const { build } = createRequire(path.join(repoRoot, 'apps/harness-plugin/package.json'))('esbuild')
const ENTRY = `
import { createElement } from 'react'
import { createEntityStore } from '@harness-projects/client'
import { WorkItemApp } from '@harness-projects/ui'
import { WORKSPACE_STYLES } from './packages/ui/src/workspace-presentation.ts'
import { wire, redacted, T } from './tests/fixtures/work-item-wire.mjs'

export function scene(scenario = 'content', detail = false) {
  const store = createEntityStore()
  const long = scenario === 'long'
  const entities = scenario === 'empty' ? [] : [
    wire('ent-aa', { content: { title: long ? '长标题无空格Title'.repeat(24) : '可见工作项', body: long ? '长正文WithoutSpaces'.repeat(200) : '正文-ent-aa' },
      planningFields: { iterationTitle: long ? 'IterationWithoutSpaces'.repeat(10) : 'E1 Sprint 1', targetDate: '2026-09-24' }, derived: ['ci_failing', 'execution_failed'] }),
    redacted('ent-bb', {}, { planningFields: { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' } }),
  ]
  store.applyBaseline({ revision: 0, entities, source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  if (scenario === 'stale') store.markAllStale()
  const read = scenario === 'loading' ? undefined : {
    workspace: { id: 'ws-1', name: long ? '长工作区名称Workspace'.repeat(8) : '浏览器工作区' }, store,
    connection: { connected: scenario !== 'offline' }, lastUpdatedAt: T, reconciledAt: '2026-10-01T07:59:00.000Z',
    capabilities: [{ key: 'planning.item.read', access: 'available' }],
  }
  const source = { subscribe: () => () => {}, getSnapshot: () => read }
  const initialPath = scenario === 'unresolved' ? '/projects/other/items' : detail ? '/projects/ws-1/items/ent-aa' : undefined
  const refreshSource = { subscribe: () => () => {}, getSnapshot: () => ({ pending: false }), refresh: async () => {} }
  // useSyncExternalStore 的 snapshot 在发布之间稳定，不能每次返回新对象。
  const refresh = { pending: false }
  refreshSource.getSnapshot = () => refresh
  return createElement(WorkItemApp, { source, initialPath, refreshSource })
}
export function renderStatic(scenario = 'long') {
  return window.ReactDOMServer.renderToStaticMarkup(scene(scenario, true))
}

/** Read-only probe: measurements come from the browser, never the CSS source. */
export function measureDetailReflow() {
  const dialog = document.querySelector('dialog')
  if (!dialog) return { open: false, failures: ['dialog missing'] }
  const header = dialog.querySelector('.hp-detail-header')
  const title = header.querySelector('h2')
  const close = header.querySelector('button')
  const body = dialog.querySelector('.hp-detail-body')
  const box = (node) => {
    const r = node.getBoundingClientRect(), css = getComputedStyle(node)
    return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height,
      clientWidth:node.clientWidth, scrollWidth:node.scrollWidth, clientHeight:node.clientHeight, scrollHeight:node.scrollHeight, scrollTop:node.scrollTop,
      padding: [css.paddingTop,css.paddingRight,css.paddingBottom,css.paddingLeft].map(parseFloat),
      fontSize:css.fontSize, lineHeight:parseFloat(css.lineHeight), overflowY:css.overflowY }
  }
  const d=box(dialog), h=box(header), t=box(title), c=box(close), b=box(body)
  const report = { open:dialog.open, viewport:{width:innerWidth,height:innerHeight}, root:box(document.querySelector('.hp-project')),
    rootFont:getComputedStyle(document.documentElement).fontSize, dialog:d, header:h, headerContentWidth:h.clientWidth-h.padding[1]-h.padding[3], title:t, close:c, body:b,
    bodyActionHeight:body.querySelector('button')?.getBoundingClientRect().height ?? 44,
    documentOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
    titleText:title.textContent, labelledBy:dialog.getAttribute('aria-labelledby'), activeElement:document.activeElement?.tagName }
  return { ...report, failures:detailReflowFailures(report) }
}

/** 用实际DOM量测判可达性；整体滚动允许低高度内容超出初始视口，不能把padding当正文。 */
export function detailReflowFailures({dialog:d,header:h,headerContentWidth,title:t,close:c,body:b,bodyActionHeight=44,viewport,documentOverflow}) {
  const failures=[], outerScrolls=['auto','scroll'].includes(d.overflowY) && d.scrollHeight>d.clientHeight
  if (d.padding.some((value) => value !== 0)) failures.push('dialog padding is not zero')
  if (t.width < Math.min(160,headerContentWidth)-1) failures.push('title lacks readable line width')
  if (c.width < 44 || c.height < 44) failures.push('close target below 44px')
  if (Math.min(t.right,c.right)>Math.max(t.left,c.left)+1 && Math.min(t.bottom,c.bottom)>Math.max(t.top,c.top)+1) failures.push('title overlaps close')
  for (const [name,r] of [['title',t],['close',c],['body',b]]) {
    const reachable=outerScrolls && r.top-d.top+d.scrollTop>=-1 && r.bottom-d.top+d.scrollTop<=d.scrollHeight+2 && r.height<=d.clientHeight+1
    if (r.left<d.left-1 || r.right>d.right+1 || (!reachable && (r.top<d.top-1 || r.bottom>d.bottom+1))) failures.push(name+' escapes dialog')
  }
  if (!outerScrolls && (c.left<0 || c.right>viewport.width+1 || c.top<0 || c.bottom>viewport.height+1)) failures.push('close escapes viewport')
  if (b.clientHeight-b.padding[0]-b.padding[2]<Math.max(44,b.lineHeight,bodyActionHeight)-1) failures.push('body lacks a complete content row')
  if (b.scrollWidth>b.clientWidth+1 || documentOverflow) failures.push('horizontal overflow')
  return failures
}

export function mount(element, scenario, params = new URLSearchParams()) {
  const root = window.ReactDOM.createRoot(element)
  const styleOrder=params.get('styleOrder') || 'production', mutant=params.get('mutant') || 'none'
  const report=document.createElement('output')
  report.id='detail-reflow-report'; report.hidden=true; document.body.append(report)
  const publish=() => requestAnimationFrame(() => { report.textContent=JSON.stringify(measureDetailReflow()) })
  window.addEventListener('resize',publish)
  document.addEventListener('scroll',publish,true)
  document.addEventListener('focusin',publish)
  new ResizeObserver(publish).observe(element)
  const fixtureStyles=document.createElement('style')
  fixtureStyles.dataset.reflowFixture='true'
  document.body.append(fixtureStyles)
  // Keep React-owned style nodes in place: experimental copies alone change cascade order.
  const configureStyles = () => {
    publish()
    if (styleOrder==='production' && mutant==='none') return
    const styles=Array.from(element.querySelectorAll('style'))
    const shared=[], own=[]
    for (const node of styles) {
      node.media='not all'
      const text=node.textContent
      if (text.includes(WORKSPACE_STYLES)) shared.push(WORKSPACE_STYLES)
      const rest=text.replace(WORKSPACE_STYLES,'')
      if (rest) own.push(rest)
    }
    let text=styleOrder==='workspace-before' ? shared.join('')+own.join('')
      : styleOrder==='workspace-after' ? own.join('')+shared.join('')
      : styles.map((node) => node.textContent).join('')
    if (styleOrder==='append' || styleOrder==='duplicate') text+=WORKSPACE_STYLES.repeat(styleOrder==='duplicate'?2:1)
    if (styleOrder==='noop') { element.classList.add('fixture-noop'); text+='/* harmless fixture variation */ .fixture-noop { --fixture-unused:1 }' }
    // Each negative control restores only one original root cause.
    if (mutant==='padding') text=text.replaceAll('.hp-workspace.hp-detail {','.hp-detail {')+WORKSPACE_STYLES
    if (mutant==='header') text+=' .hp-detail > .hp-detail-header { flex-wrap:nowrap } .hp-detail .hp-detail-title { flex:1 }'
    if (mutant==='outer-scroll') text+=' .hp-workspace.hp-detail { overflow:hidden }'
    if (mutant==='body-room') text+=' .hp-detail > .hp-detail-body { min-height:0 }'
    fixtureStyles.textContent=text
  }
  const observer=new MutationObserver(configureStyles)
  observer.observe(element,{childList:true,subtree:true})
  root.render(scene(scenario,params.get('detail')==='1'))
}

`

export function buildWorkspaceFrameBundle() {
  return build({ stdin: { contents: ENTRY, resolveDir: repoRoot }, absWorkingDir: repoRoot,
    bundle: true, platform: 'browser', format: 'cjs', write: false, metafile: true, external: ['react'], logLevel: 'silent' })
}

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace frame fixture</title>
<style>
/* Host token 的本地主题输入，非安装 Host。font query 以百分比提供等效文字放大。 */
:root { --dsw-focus-ring-color:#4176e6; --dsw-focus-ring-width:2px; --dsw-alias-state-business-primary:#4176e6; color-scheme:light; color:#20242c; background:#fff; font:15px/1.5 system-ui,sans-serif }
:root[data-theme=dark] { --dsw-focus-ring-color:#7aaaff; --dsw-alias-state-business-primary:#7aaaff; color-scheme:dark; color:#e3e5eb; background:#191b20 }
html,body { margin:0; padding:0; min-width:0 } #app { min-width:0; max-width:100% }
</style></head><body><div id="app"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script>
<script>const params = new URLSearchParams(location.search);document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light'; const font=Number(params.get('font'));if([200,400].includes(font))document.documentElement.style.fontSize=(15*font/100)+'px';window.require=(id)=>{if(id==='react')return React;throw Error(id)};var module={exports:{}};var exports=module.exports</script>
<script src="/bundle.js"></script><script>
const app=document.getElementById('app');const width=Number(params.get('rootWidth'));if(width>0)app.style.width=width+'px';
module.exports.mount(app,params.get('scenario')||'content',params)
</script></body></html>`

export async function startWorkspaceFrameServer(port = 0) {
  const vendor = (id, file) => readFile(path.join(path.dirname(uiRequire.resolve(id)), 'umd', file), 'utf8')
  const [bundle, react, reactDOM] = await Promise.all([buildWorkspaceFrameBundle(), vendor('react', 'react.development.js'), vendor('react-dom/client', 'react-dom.development.js')])
  const scripts = { '/react.js': react, '/react-dom.js': reactDOM, '/bundle.js': bundle.outputFiles[0].text }
  const server = createServer((request, response) => {
    const route = new URL(request.url, 'http://fixture.invalid').pathname
    const script = scripts[route]
    response.writeHead(200, { 'content-type': script === undefined ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(script ?? page)
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startWorkspaceFrameServer(Number(process.env.WORKSPACE_FRAME_PORT ?? process.argv[2] ?? 4173))
  console.log(`workspace-frame fixture: ${fixture.url}/?theme=light&scenario=content`)
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0) })
}
