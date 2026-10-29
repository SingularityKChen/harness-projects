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
import { wire, redacted, T } from './tests/fixtures/work-item-wire.mjs'

export function scene(scenario = 'content') {
  const store = createEntityStore()
  const long = scenario === 'long'
  const entities = scenario === 'empty' ? [] : [
    wire('ent-aa', { content: { title: long ? '长标题无空格Title'.repeat(24) : '可见工作项' },
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
  const initialPath = scenario === 'unresolved' ? '/projects/other/items' : undefined
  const refreshSource = { subscribe: () => () => {}, getSnapshot: () => ({ pending: false }), refresh: async () => {} }
  // useSyncExternalStore 的 snapshot 在发布之间稳定，不能每次返回新对象。
  const refresh = { pending: false }
  refreshSource.getSnapshot = () => refresh
  return createElement(WorkItemApp, { source, initialPath, refreshSource })
}
export function mount(element, scenario) {
  const root = window.ReactDOM.createRoot(element)
  root.render(scene(scenario))
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
<script src="/bundle.js"></script><script>module.exports.mount(document.getElementById('app'),params.get('scenario')||'content')</script></body></html>`

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
