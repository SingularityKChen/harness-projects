/** 浏览器 fixture（issue #130）：同源 HTTP 把两个 canonical pathname 交给同一入口，入口真实使用产品 History adapter、
 * 详情投影与组合页，bundle 只外置 react；静态渲染与浏览器走同一个 mount（固定路径 port + 只捕获 HTML 的 root），路由解析、scope 门与组合只有一处。导出 `buildBundle`/`startServer` 供契约测试；直接执行时打印地址并持续服务。 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const uiRequire = createRequire(path.join(repoRoot, 'packages/ui/package.json'))
const { build } = createRequire(path.join(repoRoot, 'apps/harness-plugin/package.json'))('esbuild')

const ENTRY = `
import { createElement } from 'react'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'
import { WorkItemProjectPage } from '@harness-projects/ui'
import { browserHistoryPort, createItemNavigation, itemPath } from '@harness-projects/app-web'

const item = (entityId, over) => Object.assign({ entityId, kind: 'work_item', planningStatus: 'in_progress', derived: ['ci_failing'],
  content: { contentKind: 'work_item', title: 'Fixture 详情标题', body: '正文-' + entityId, bindingId: 'bind-1', externalKind: 'issue', externalId: 'ext-' + entityId },
  source: { revision: 1, freshness: 'fresh', authority: 'provider' } }, over)
const REDACTED = item('ent-bb', { planningStatus: 'done', derived: ['attention'], content: { contentKind: 'redacted', title: 'CANARY-TITLE', body: 'CANARY-BODY', bindingId: 'bind-1' }, source: { revision: 1, freshness: 'degraded', authority: 'host', reason: 'CANARY-REASON' } })
export const SCENARIOS = {
  content: { items: [item('ent-aa'), REDACTED] },
  loading: { items: [item('ent-aa')], phase: 'pending' },
  offline: { items: [item('ent-aa'), REDACTED], failure: 'offline' },
  redacted: { items: [item('ent-aa'), REDACTED], target: 'ent-bb' },
  missing: { items: [item('ent-aa')], target: 'ent-zz' },
  denied: { items: [item('ent-aa'), REDACTED], failure: 'permission_denied' },
  scoped: { items: [item('ent-aa')], workspace: 'ws-2' },
}
const storeFor = (items) => ({ revision: 1,
  list: () => items.map((entity) => ({ entityId: entity.entityId, entity, revision: 1, stale: false })),
  get: (id) => { const entity = items.find((row) => row.entityId === id); return entity === undefined ? undefined : { entityId: id, entity, revision: 1, stale: false } } })
export const views = (name, projectId, itemId) => {
  const s = SCENARIOS[name] || SCENARIOS.content
  const read = { workspace: { id: s.workspace || 'ws-1', name: 'Fixture 工作区' }, store: storeFor(s.items), connection: { connected: true }, lastUpdatedAt: '2026-10-01T08:00:00.000Z', capabilities: [{ key: 'planning.item.read', access: 'available' }] }
  const marks = s.failure === undefined ? { phase: s.phase || 'received', refreshing: false } : { phase: 'failed', hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind: s.failure } }
  const input = Object.assign({ read, metadata: { planningSourceName: '规划来源', sourceNames: { 'bind-1': '来源一' } } }, marks)
  const target = s.target || itemId
  if (projectId !== read.workspace.id) return {} // 未知路由与跨 scope：不绑定当前 store，也不生成任何 href
  return { listView: deriveWorkItemListView(input), detailView: target === undefined ? undefined : deriveWorkItemDetailView(input, { projectId, itemId: target }) }
}
const hrefOf = (projectId) => (id) => itemPath({ projectId, itemId: id })
const dom = () => (globalThis.ReactDOMServer ? globalThis : window)
export const renderStatic = (name = 'content', pathname = '/projects/ws-1/items/ent-aa') => {
  let html = ''
  const port = { pathname: () => pathname, push: () => undefined, replace: () => undefined, subscribe: () => () => undefined }
  mount(null, port, { render: (element) => { html = dom().ReactDOMServer.renderToStaticMarkup(element) } }).setScenario(name)
  return html
}
export function mount(element, port = browserHistoryPort(), root = (dom().ReactDOMClient ?? dom().ReactDOM).createRoot(element)) {
  const state = { scenario: 'content' }
  let navigation, route
  const render = (next) => {
    route = next
    const projectId = next?.projectId // 只有通过 views 的 scope 门时才会被用于 href 与导航
    const v = views(state.scenario, projectId, next?.itemId)
    root.render(v.listView === undefined ? createElement('p', null, '当前快照未找到此条目，是否存在尚未确认')
      : createElement(WorkItemProjectPage, { listView: v.listView, detailView: v.detailView, navigation: { href: hrefOf(projectId), open: (id) => navigation.open({ projectId, itemId: id }) }, onCloseDetail: () => navigation.close(projectId) }))
  }
  navigation = createItemNavigation(port, render)
  return { setScenario: (name) => { state.scenario = name; render(route) } }
}
`

export const NEGATIVE_ENTRY = `import { newEntityId } from '@harness-projects/domain'\nexport const id = newEntityId()`

/** 浏览器 bundler：只外置 react；metafile 供契约测试检查输入面与 node:*。 */
export function buildBundle(contents = ENTRY) {
  return build({
    stdin: { contents, resolveDir: repoRoot, loader: 'js' }, absWorkingDir: repoRoot,
    bundle: true, platform: 'browser', format: 'cjs', write: false, metafile: true, external: ['react'], logLevel: 'silent',
  })
}

/** 同源入口页：控件在 React 之外，只调用入口导出的 setScenario。 */
const page = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>work-item-detail fixture</title>
<div id="controls">${'content loading offline redacted missing denied scoped'.split(' ')
  .map((name) => `<button type="button" data-scenario="${name}">${name}</button>`).join('')}</div>
<div id="app"></div>
<script src="/vendor/react.js"></script><script src="/vendor/react-dom-server.js"></script><script src="/vendor/react-dom-client.js"></script>
<script>// react-dom/client 与 react-dom 是同一份 UMD；它只装 window.ReactDOM，这里显式补上入口读取的别名。
window.ReactDOMClient = window.ReactDOM
window.require = (id) => { if (id === 'react') return window.React; throw new Error('unexpected require: ' + id) }
var module = { exports: {} }; var exports = module.exports</script>
<script src="/bundle.js"></script>
<script>window.__fixture = module.exports.mount(document.getElementById('app'))
for (const button of document.querySelectorAll('#controls button')) button.addEventListener('click', () => window.__fixture.setScenario(button.dataset.scenario))</script>`

/** 启动同源 HTTP 服务：两个 canonical pathname 与任意 `/projects/**` 都交给同一入口。 */
export async function startServer() {
  const umd = (id, file) => readFile(path.join(path.dirname(uiRequire.resolve(id)), 'umd', file), 'utf8')
  const [bundle, reactText, serverText, clientText] = await Promise.all([
    buildBundle().then((result) => result.outputFiles[0].text),
    umd('react', 'react.development.js'), umd('react-dom/server', 'react-dom-server-legacy.browser.development.js'), umd('react-dom/client', 'react-dom.development.js'),
  ])
  const served = { '/vendor/react.js': reactText, '/vendor/react-dom-server.js': serverText, '/vendor/react-dom-client.js': clientText, '/bundle.js': bundle }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
    const script = served[pathname]
    if (script !== undefined) { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(script); return }
    if (pathname.startsWith('/projects/')) { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page()); return }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startServer()
  console.log(`work-item-detail fixture: ${fixture.url}/projects/ws-1/items 与 ${fixture.url}/projects/ws-1/items/ent-aa`)
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0) })
  await new Promise(() => undefined)
}
