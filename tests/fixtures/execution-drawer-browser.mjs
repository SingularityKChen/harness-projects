/** SQLite → Host → typed remote 的离线执行抽屉夹具；真实浏览器入口复用生产 apply。 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { composeCore, contextIdFor, runIdFor } from '@harness-projects/core'
import { createFakeProviders, FAKE_PROVIDER_DEFINITION } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
export async function createExecutionFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'execution-drawer-')), dataPath = path.join(root, 'workspace.sqlite')
  const mounted = [], providers = createFakeProviders(), catalog = catalogOf([{ definition: FAKE_PROVIDER_DEFINITION, configuration: {}, create: async ({ binding }) => { const provider = createFakeProviders({ [binding.domain]: { bindingId: binding.id } })[binding.domain]; if (binding.domain === 'execution') mounted.push(provider); return provider } }])
  const workspaceId = '00000000-0000-4000-8000-000000000282'
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(catalog)), core = await composeCore({ workspace: { id: workspaceId, name: 'Execution Fixture' }, providers, storage })
  const itemId = (await core.queries.listPlanningItems()).find((item) => item.content.contentKind === 'work_item').entityId
  await core.commands.startWork({ workItemId: itemId, repositoryId: 'repo-alpha', actor: { kind: 'human' }, idempotencyKey: 'fixture-start' })
  const id = contextIdFor(workspaceId, itemId, 'repo-alpha'), runId = runIdFor(id)
  await storage.putExecutionRun({ ...(await storage.getExecutionRun(runId)), fallback: true })
  const host = await createHostComposition({ dataPath, workspaceId, catalog, resolveCredential: async () => undefined })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  return { workspaceId, itemId, runId, storage, host, installed, mounted, close: async () => { await installed.dispose(); host.dispose(); storage.close(); await rm(root, { recursive: true, force: true }) } }
}

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)), uiRequire = createRequire(path.join(repoRoot, 'packages/ui/package.json'))
const LONG_REPOSITORY = 'repository-with-a-long-unbroken-identity-' + 'abcdef'.repeat(12)
const ENTRY = `
import { createElement } from 'react'
import { apply } from './apps/harness-plugin/src/client.ts'
export async function mount(root) {
  let push, stopped = false, generation = 0, carrierFailed
  const queue = [], waiters = [], disposers = []
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve))
  const emit = (value) => waiters.length ? waiters.shift()(value) : queue.push(value)
  const load = (url, options) => fetch(url + location.search, options)
  const command = async (action, value) => (await load('/control', { method: 'POST', body: JSON.stringify({ action, value }) })).json()
  const child = { effect: (run) => disposers.push(run()), slots: { inject: (_, run) => run(), register: (slot, Panel) => { if (slot.name === 'main') root.render(createElement(Panel)) } }, remote: {
    harnessProjects: { ...Object.fromEntries(['getWorkspaceSetup', 'getStartWorkOptions', 'startWork', 'getDeliveryProjection', 'refreshDeliveryFacts', 'refreshExecutionRun'].map((method) => [method, async (...args) => (await load('/remote', { method: 'POST', body: JSON.stringify({ method, args }) })).json()])), getExecutionContext: async (workItemId, repositoryId) => (await load('/context', { method: 'POST', body: JSON.stringify({ workItemId, repositoryId }) })).json() },
    $stream: (options) => { carrierFailed = options.carrierFailed; return { restart() {}, dispose: async () => { stopped = true; emit(null) }, async *[Symbol.asyncIterator]() {
      emit(await (await load('/baseline')).json())
      while (!stopped) { const baseline = await next(); if (baseline === null) return; yield { generation: ++generation, value: { kind: 'baseline', baseline }, accept() {} } }
    } } },
  } }
  await apply({ remote: { $mount: async () => {} }, inject: (_, run) => run(child) })
  return { command, emit: async () => emit(await (await load('/baseline')).json()), disconnect: () => carrierFailed?.(new Error('fixture disconnect')), unmount: async () => { root.unmount(); await Promise.all(disposers.map((run) => run())) } }
}`
/** 真实浏览器与 Node 测试共用同一个 Host。HTTP 只是 fixture 的 JSON 载体，不替代产品 reader 或 apply。 */
export async function startExecutionServer() {
  const h = await createExecutionFixture(), visibility = new Map(), requests = [], held = []
  let paused = false, fail = false
  const original = h.host.controller.queries.getEntity
  const project = (entity) => { const kind = visibility.get(entity?.entityId); return kind === undefined ? entity : { ...entity, content: { ...entity.content, contentKind: kind } } }
  h.host.controller.queries.getEntity = async (id) => project(await original(id))
  const { build } = createRequire(path.join(repoRoot, 'apps/harness-plugin/package.json'))('esbuild')
  const bundle = await build({ stdin: { contents: ENTRY, resolveDir: repoRoot }, absWorkingDir: repoRoot, platform: 'browser', bundle: true, format: 'cjs', external: ['react'], write: false, metafile: true })
  const vendor = async (id, file) => readFile(path.join(path.dirname(uiRequire.resolve(id)), 'umd', file), 'utf8')
  const [react, reactDOM] = await Promise.all([vendor('react', 'react.development.js'), vendor('react-dom/client', 'react-dom.development.js')])
  const scripts = { '/react.js': react, '/react-dom.js': reactDOM, '/bundle.js': bundle.outputFiles[0].text }
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>执行抽屉</title><style>
/* 仅本地 fixture 的 Host token 与文字大小输入，不代表安装 Host。 */
:root { --dsw-focus-ring-color:#4176e6; --dsw-focus-ring-width:2px; --dsw-alias-state-business-primary:#4176e6; color-scheme:light; color:#20242c; background:#fff; font:15px/1.5 system-ui,sans-serif }
:root[data-theme=dark] { --dsw-focus-ring-color:#7aaaff; --dsw-alias-state-business-primary:#7aaaff; color-scheme:dark; color:#e3e5eb; background:#191b20 }
html,body { margin:0; padding:0; min-width:0; height:100%; overflow:hidden } body { display:grid; grid-template-rows:minmax(0,1fr) } #app { display:flex; flex-direction:column; min-height:0; min-width:0; max-width:100%; overflow:hidden }
</style><div id="app"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>const params=new URLSearchParams(location.search);document.documentElement.dataset.theme=params.get('theme')==='dark'?'dark':'light';if(params.get('font')==='200')document.documentElement.style.fontSize='30px';window.require=()=>React;var module={exports:{}};var exports=module.exports</script><script src="/bundle.js"></script><script>module.exports.mount(ReactDOM.createRoot(document.getElementById("app"))).then(value=>window.fixture=value)</script></html>`
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture.invalid'), route = url.pathname, scenario = url.searchParams.get('scenario')
      const showcase = ['all', 'unknown', 'failed', 'succeeded', 'missing', 'stale'].includes(scenario)
      if (scripts[route]) { response.setHeader('content-type', 'text/javascript'); response.end(scripts[route]); return }
      if (route === '/') { response.setHeader('content-type', 'text/html;charset=utf-8'); response.end(page); return }
      let raw = ''; for await (const chunk of request) raw += chunk
      const input = raw ? JSON.parse(raw) : {}
      let result
      if (route === '/context') {
        requests.push(input)
        try { result = fail ? { ok: false, error: 'SECRET' } : { ok: true, value: await h.installed.service.getExecutionContext(input.workItemId, input.repositoryId) } } catch { result = { ok: false, error: 'Host unavailable' } }
        if (showcase && !fail) result = { ok: true, value: { context: {
          workspaceId: h.workspaceId, workItemId: input.workItemId, repositoryId: input.repositoryId, status: 'ready',
          ...(scenario === 'missing' || input.repositoryId === LONG_REPOSITORY ? {} : { runStatus: scenario === 'failed' ? 'failed' : scenario === 'succeeded' || scenario === 'stale' ? 'succeeded' : 'unknown', runConfirmedAt: '2026-10-30T00:00:00.000Z', runStale: ['all', 'unknown', 'stale'].includes(scenario), fallback: 'manual_fallback' }),
          worktreeExternalId: '/fixture/' + 'longdirectory'.repeat(18), branchExternalId: 'feature/' + 'longbranch'.repeat(12),
        } } }
        if (paused) await new Promise((resolve) => held.push(resolve))
      } else if (route === '/remote') {
        const { method, args } = input
        if (!['getWorkspaceSetup', 'getStartWorkOptions', 'startWork', 'getDeliveryProjection', 'refreshDeliveryFacts', 'refreshExecutionRun'].includes(method)) throw new Error('Unsupported fixture method')
        if (!showcase) { try { result = { ok: true, value: await h.installed.service[method](...args) } } catch { result = { ok: false, error: 'Fixture Host unavailable' } } }
        else {
          // 仅测试展示数据；生产 apply、严格 client 解码、组件和动作仍是现有入口。
          const confirmedAt = '2026-10-30T00:00:00.000Z', stale = ['all', 'stale'].includes(scenario), value = method === 'getWorkspaceSetup'
            ? { workspace: { id: h.workspaceId, name: 'Execution Fixture' }, planning: { state: 'confirmed', bindingId: 'fixture-planning', projectNodeId: 'fixture-project' }, executionInstalled: true }
            : method === 'getStartWorkOptions'
            ? { workspaceId: h.workspaceId, workItemId: args[0], executionMode: 'manual' }
            : method === 'getDeliveryProjection' ? { workspaceId: h.workspaceId, workItemId: args[0], repositoryId: args[1], now: '2026-10-30T00:01:00.000Z', projection: {
              workItemId: args[0], repositoryId: args[1], optional: [], degraded: false, gaps: [{ entityKind: 'commit', reason: 'not_observed' }],
              freshness: ['change_request', 'pipeline_run', 'check_run'].map((kind) => ({ kind, stale, ...(scenario === 'unknown' || scenario === 'missing' ? {} : { confirmedAt }) })),
              hops: ['change_request', 'pipeline_run', 'check_run'].map((entityKind) => ({ entityKind, from: 'fixture-source', to: 'fixture-' + entityKind, label: entityKind === 'change_request' ? '变更请求 #42' : '持续集成检查', externalId: 'fixture-external-identity-' + '1234567890'.repeat(10), fact: scenario === 'failed' ? 'ci_failed' : 'ci_passed', stale, unavailable: false, relationState: 'candidate' })),
            } }
            : method === 'startWork' ? { writeState: scenario === 'failed' ? 'failed' : scenario === 'succeeded' ? 'confirmed' : 'unknown', saving: false, authoritative: scenario === 'succeeded', value: { executionContextId: 'fixture-context', status: 'ready', degraded: true, fallback: 'manual_fallback' } }
            : { writeState: 'local_only', saving: false, authoritative: false, value: { applied: true } }
          result = { ok: true, value }
        }
      } else if (route === '/control') {
        if (input.action === 'status') await h.storage.putExecutionRun({ ...(await h.storage.getExecutionRun(h.runId)), status: input.value })
        if (input.action === 'visibility') input.value === null ? visibility.delete(h.itemId) : visibility.set(h.itemId, input.value)
        if (input.action === 'pause') paused = input.value
        if (input.action === 'fail') fail = input.value
        if (input.action === 'release') { paused = false; held.splice(0).forEach((resolve) => resolve()) }
        result = { requests }
      } else if (route === '/baseline') { const baseline = await h.host.controller.baseline(); result = { ...baseline, ...(showcase ? { repositories: [...baseline.repositories, { ...baseline.repositories[0], id: LONG_REPOSITORY }] } : {}), entities: baseline.entities.map(project) } }
      else { response.writeHead(404); response.end(); return }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result))
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { ...h, requests, inputs: Object.keys(bundle.metafile.inputs), url: `http://127.0.0.1:${server.address().port}`, close: async () => { held.splice(0).forEach((resolve) => resolve()); await new Promise((resolve) => server.close(resolve)); await h.close() } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const h = await startExecutionServer(); console.log(h.url); process.on('SIGINT', async () => { await h.close(); process.exit(0) }) }
