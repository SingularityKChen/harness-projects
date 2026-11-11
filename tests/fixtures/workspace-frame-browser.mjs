import { jsxRuntimeScript } from './markdown-vm.mjs'
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
  const long = scenario === 'long', numbers = scenario === 'numbers', reference = scenario === 'reference'
  const detailStale = scenario === 'detail-stale', detailNative = scenario === 'detail-native'
  const number = (scopeName) => ({ sourceNumber: { sourceName:'GitHub',scopeIdentity:{namespace:'github.com/graphql/Repository',id:'opaque-'+scopeName},scopeName,number:449 } })
  const entities = reference ? [
    [554, '为新会话保留可恢复的执行身份', 'in_progress', 'Core 恢复', '2026-11-13'],
    [604, '统一工作区视觉与导航层次，并在窄屏下保留真实来源与可访问状态', 'in_progress', '现代看板', '2026-11-12'],
    [605, '呈现真实规划数据的只读看板', 'todo', '现代看板'],
    [603, '确认本次发布的具体视觉目标', 'todo', '现代看板', '2026-11-11'],
    [415, '删除发布前旧数据修复路径', 'todo', 'Core 恢复', '2026-11-14'],
    [416, '明确观察视图与事件表的真实消费者', 'unknown', 'Core 恢复'],
    [594, '显示来源原生父项与子议题', 'done', '现代看板', '2026-11-10'],
  ].map(([number, title, planningStatus, iterationTitle, targetDate], index) => wire('item-' + index, { planningStatus,
    content: { title, body: '在同一工作区阅读规划、查看交付，并始终知道信息来自哪里。', sourceNumber: { sourceName: 'GitHub', scopeIdentity: { namespace: 'github.com/graphql/Repository', id: 'reference' }, scopeName: 'example/project', number } },
    planningFields: { iterationTitle, targetDate, ...(number === 416 ? { statusName: '待确认' } : {}) },
  })) : scenario === 'empty' ? [] : [
    wire('ent-aa', {
      ...(detailNative ? { planningStatus: 'unknown', source: { freshness: 'degraded' } } : {}),
      content: {
        ...(numbers ? number('example/one') : {}),
        ...(detailNative ? { externalId: 'RawExternalIdentity'.repeat(50) } : {}),
        title: long ? '长标题无空格Title'.repeat(24) : '可见工作项',
        body: detailStale ? '条目陈旧时仍须先看见来源与最后已知限定。'.repeat(800) : long ? '长正文WithoutSpaces'.repeat(200) : '正文-ent-aa',
      },
      planningFields: {
        ...(detailNative ? { statusName: 'NativeUnmappedStatus'.repeat(80) } : {}),
        iterationTitle: detailNative ? 'RawIterationMetadata'.repeat(50) : long ? 'IterationWithoutSpaces'.repeat(10) : 'E1 Sprint 1',
        targetDate: '2026-09-24',
      }, derived: ['ci_failing', 'execution_failed'],
    }),
    ...(numbers ? [wire('ent-cc',{content:{title:'另一仓库工作项',...number('example/two')}}),wire('ent-dd',{content:{title:'Draft工作项 Discuss GitHub example/one#449 GitHub missing/repo#449',externalKind:'draft'}})] : []),
    redacted('ent-bb', {}, { planningFields: { statusName: 'CANARY-STATUS', iterationTitle: 'CANARY-ITERATION', targetDate: '2099-12-31' } }),
  ]
  store.applyBaseline({ revision: 0, entities, source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  if (scenario === 'stale' || detailStale) store.markAllStale()
  const read = scenario === 'loading' ? undefined : {
    workspace: { id: 'ws-1', name: reference ? 'Harness Projects / 交付工作台' : long ? '长工作区名称Workspace'.repeat(8) : '浏览器工作区' }, store,
    ...(reference || detailStale || detailNative ? { planningSource: { bindingId: 'bind-1', name: reference ? 'GitHub Projects' : '来源一' } } : {}),
    connection: { connected: scenario !== 'offline' }, lastUpdatedAt: T, reconciledAt: '2026-10-01T07:59:00.000Z',
    capabilities: [{ key: 'planning.item.read', access: 'available' }],
  }
  const source = { subscribe: () => () => {}, getSnapshot: () => read }
  const initialPath = scenario === 'unresolved' ? '/projects/other/items' : detail ? '/projects/ws-1/items/' + (reference ? 'item-1' : 'ent-aa') : undefined
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
  const close = [...header.querySelectorAll('button')].find(node => node.textContent === '关闭详情')
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
    if (mutant==='metadata-nowrap') text+=' .hp-detail .hp-detail-metadata dd, .hp-detail .hp-detail-metadata dd * { white-space:nowrap; overflow-wrap:normal }'
    if (mutant==='body-room') text+=' .hp-detail > .hp-detail-body { min-height:0 }'
    fixtureStyles.textContent=text
  }
  const observer=new MutationObserver(configureStyles)
  observer.observe(element,{childList:true,subtree:true})
  root.render(scene(scenario,params.get('detail')==='1'))
}

`

export function buildWorkspaceFrameBundle(options = {}) {
  return build({ stdin: { contents: ENTRY, resolveDir: repoRoot }, absWorkingDir: repoRoot,
    bundle: true, platform: 'browser', format: 'cjs', write: false, metafile: true, external: ['react'], logLevel: 'silent', ...options })
}

let page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace frame fixture</title>
<style>
/* Host token 的本地主题输入，非安装 Host。font query 以百分比提供等效文字放大。 */
:root { --dsw-focus-ring-color:#4176e6; --dsw-focus-ring-width:2px; --dsw-alias-state-business-primary:#4176e6; color-scheme:light; color:#20242c; background:#fff; font:15px/1.5 system-ui,sans-serif }
:root[data-theme=dark] { --dsw-focus-ring-color:#7aaaff; --dsw-alias-state-business-primary:#7aaaff; color-scheme:dark; color:#e3e5eb; background:#191b20 }
html,body { margin:0; padding:0; min-width:0 } #app { min-width:0; max-width:100%; height:100dvh; display:flex; flex-direction:column }
</style></head><body><div id="app"></div>
<script src="/react.js"></script><script src="/jsx-runtime.js"></script><script src="/react-dom.js"></script>
<script>const params = new URLSearchParams(location.search);document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light'; const font=Number(params.get('font'));if([200,400].includes(font))document.documentElement.style.fontSize=(15*font/100)+'px';window.require=(id)=>{if(id==='react')return React;if(id==='react/jsx-runtime')return window.ReactJSX;throw Error(id)};var module={exports:{}};var exports=module.exports</script>
<script src="/bundle.js"></script><script>
const app=document.getElementById('app');const width=Number(params.get('rootWidth'));if(width>0)app.style.width=width+'px';
module.exports.mount(app,params.get('scenario')||'content',params)
</script></body></html>`

const { palette } = JSON.parse(await readFile(new URL('../../docs/product/release-visual-target-v3/host-role-palette-v3.json', import.meta.url), 'utf8'))
const roleKeys = { 'bg-base':'bg', 'bg-layer-1':'surface', 'label-primary':'text', 'label-secondary':'muted', 'border-l2':'line', 'border-l4':'cardBorder', 'interactive-bg-hover-solid':'soft', 'bg-multi-select':'select', 'button-primary-fill':'primary', 'label-primary-foreground':'onPrimary', 'button-primary-hover':'primaryHover', 'link':'accent' }
page = page.replace('</style>', Object.entries(palette).map(([mode, values]) => ':root[data-roles=reference][data-theme=' + mode + ']{font-size:14px;' + Object.entries(roleKeys).map(([role, key]) => '--dsw-alias-' + role + ':' + values[key]).join(';') + '}').join('') + '</style>')
page = page.replace('<script src="/react.js">', '<script>document.documentElement.dataset.roles=new URLSearchParams(location.search).get("roles")||"fallback"</script><script src="/react.js">')

page = page.replace('<div id="app">', '<div id="capture-host" hidden>Harness Projects　 / 交付工作台</div><div id="app">').replace('<script src="/react.js">', '<script>if(new URLSearchParams(location.search).has("capture")){const host=document.getElementById("capture-host");host.hidden=false;host.style.cssText="height:44px;box-sizing:border-box;padding:12px 24px;font:12px/20px system-ui;border-bottom:1px solid var(--dsw-alias-border-l2,CanvasText)";document.getElementById("app").style.height="calc(100dvh - 44px)"}</script><script src="/react.js">')

export async function startWorkspaceFrameServer(port = 0, options = {}) {
  const vendor = (id, file) => readFile(path.join(path.dirname(uiRequire.resolve(id)), 'umd', file), 'utf8')
  const [bundle, react, reactDOM, jsxText] = await Promise.all([buildWorkspaceFrameBundle(options), vendor('react', 'react.development.js'), vendor('react-dom/client', 'react-dom.development.js'), jsxRuntimeScript()])
  const scripts = { '/jsx-runtime.js': jsxText, '/react.js': react, '/react-dom.js': reactDOM, '/bundle.js': bundle.outputFiles[0].text }
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
