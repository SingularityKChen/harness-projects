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
import { OPERATIONS, exactRecord, parseInput } from '../../apps/harness-plugin/src/host-operations.ts'
import { AccessLevel, providerErr, providerError } from '@harness-projects/capabilities'
export async function createExecutionFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'execution-drawer-')), dataPath = path.join(root, 'workspace.sqlite')
  const mounted = [], byDomain = {}, providers = createFakeProviders(), catalog = catalogOf([{ definition: FAKE_PROVIDER_DEFINITION, configuration: { projectNodeId: { kind: 'string', required: false, pattern: '.+', maxLength: 100 } }, create: async ({ binding }) => { const provider = createFakeProviders({ [binding.domain]: { bindingId: binding.id } })[binding.domain]; byDomain[binding.domain] = provider; if (binding.domain === 'execution') mounted.push(provider); return provider } }])
  const workspaceId = '00000000-0000-4000-8000-000000000282'
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(catalog)), core = await composeCore({ workspace: { id: workspaceId, name: 'Execution Fixture' }, providers, storage })
  await storage.putBindingConfiguration({ ref: { workspaceId, bindingId: providers.planning.bindingId, domain: 'planning' }, configuration: { projectNodeId: providers.planning.state.projects[0].ref.externalId } })
  const itemId = (await core.queries.listPlanningItems()).find((item) => item.content.title === '规划项 issue-1').entityId
  await core.commands.startWork({ workItemId: itemId, repositoryId: 'repo-alpha', actor: { kind: 'human' }, idempotencyKey: 'fixture-start' })
  const id = contextIdFor(workspaceId, itemId, 'repo-alpha'), runId = runIdFor(id)
  await storage.putExecutionRun({ ...(await storage.getExecutionRun(runId)), fallback: true })
  const host = await createHostComposition({ dataPath, workspaceId, catalog, resolveCredential: async () => undefined, watchIntervalMs: 5 })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  return { workspaceId, itemId, runId, storage, host, installed, mounted, byDomain, close: async () => { await installed.dispose(); await host.dispose(); storage.close(); await rm(root, { recursive: true, force: true }) } }
}

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)), uiRequire = createRequire(path.join(repoRoot, 'packages/ui/package.json'))
const LONG_REPOSITORY = 'repository-with-a-long-unbroken-identity-' + 'abcdef'.repeat(12)
const ENTRY = `
import { createElement } from 'react'
import { apply } from './apps/harness-plugin/src/client.ts'
import { OPERATIONS } from './apps/harness-plugin/src/host-operations.ts'
export async function mount(root) {
  let disconnect
  const disposers = [], streams = new Set()
  const load = (url, options) => fetch(url + location.search, options)
  const command = async (action, value) => (await load('/control', { method: 'POST', body: JSON.stringify({ action, value }) })).json()
  const remote = Object.fromEntries(Object.values(OPERATIONS).filter(op => op.mode === 'unary').map(op => [op.name, async (...args) =>
    (await load('/remote', { method: 'POST', body: JSON.stringify({ name: op.name, input: Object.fromEntries(op.params.map((p, i) => [p.name, args[i]])) }) })).json()]))
  remote.watch = async function* (signal) {
    const response = await load('/watch', { signal }), reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) return; buffer += chunk.value
      for (let end; (end = buffer.indexOf('\\n')) >= 0;) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); yield JSON.parse(line) }
    } } finally { await reader.cancel().catch(() => {}) }
  }
  const child = { effect: (run) => disposers.push(run()), slots: { inject: (_, run) => run(), register: (slot, Panel) => { if (slot.name === 'main') root.render(createElement(Panel)) } }, remote: {
    harnessProjects: remote,
    $stream: (options) => { let abort, stopped = false, restart = false, generation = 0
      const stream = { restart() { restart = true; abort?.abort() }, dispose: async () => { stopped = true; abort?.abort(); streams.delete(stream) }, async *[Symbol.asyncIterator]() {
        while (!stopped) { abort = new AbortController(); restart = false; let accepted = false; generation++
          try { for await (const value of options.open(abort.signal)) yield { generation, value, accept() { accepted = true } } }
          catch (error) { if (!stopped && !restart) throw error }
          if (!stopped && !restart) throw options.ended(accepted)
        }
      } }
      streams.add(stream); disconnect = () => { options.carrierFailed?.(new Error('fixture disconnect')); abort?.abort() }; return stream
    },
  } }
  await apply({ remote: { $mount: async () => {} }, inject: (_, run) => run(child) })
  return { command, remote, disconnect: () => disconnect?.(), unmount: async () => { root.unmount(); await Promise.all(disposers.reverse().map((run) => run())); await Promise.all([...streams].map(stream => stream.dispose())) } }
}`
/** 真实浏览器与 Node 测试共用同一个 Host。HTTP 只是 fixture 的 JSON 载体，不替代产品 reader 或 apply。 */
export async function startExecutionServer() {
  const h = await createExecutionFixture(), requests = [], held = [], holds = new Set(), wrapped = new Set(), streams = new Set()
  const permissionMethods = { development: { createBranch: 'development.branch.create', createWorktree: 'development.worktree.create', getRepository: 'development.repository.read', preflightWorktree: 'development.worktree.read' },
    delivery: { listPipelineRuns: 'delivery.pipeline.read', listChecks: 'delivery.check.read' }, execution: { startRun: 'execution.run.start' } }
  const denied = new Set()
  for (const [domain, methods] of Object.entries(permissionMethods)) {
    const provider = h.byDomain[domain], describe = provider.describeCapabilities.bind(provider)
    provider.describeCapabilities = async () => { const snapshot = await describe(); return { ...snapshot, permission: { ...snapshot.permission,
      ...Object.fromEntries(Object.values(methods).filter(key => denied.has(key)).map(key => [key, AccessLevel.Unavailable])) } } }
    for (const [method, key] of Object.entries(methods)) {
      const run = provider[method].bind(provider)
      provider[method] = (...args) => denied.has(key) ? Promise.resolve(providerErr(providerError('permission_denied', 'fixture Provider permission revoked'))) : run(...args)
    }
  }
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
      const displayBaseline = (baseline) => ({ ...baseline, repositories: [...baseline.repositories, { ...baseline.repositories[0], id: LONG_REPOSITORY }] })
      if (route === '/watch') {
        const abort = new AbortController(); streams.add(abort); response.on('close', () => abort.abort())
        response.setHeader('content-type', 'application/x-ndjson'); response.flushHeaders()
        try { for await (const frame of h.installed.service.watch(abort.signal)) response.write(JSON.stringify(showcase && frame.kind === 'baseline' ? { ...frame, baseline: displayBaseline(frame.baseline) } : frame) + '\n') }
        finally { streams.delete(abort); response.end() }
        return
      }
      let raw = ''; for await (const chunk of request) raw += chunk
      const input = raw ? JSON.parse(raw) : {}
      let result
      // 显式视觉场景仅提供展示数据，不作为权限或 Provider 确认的证据；默认路径不进入这里。
      const displayContext = (input) => ({ ok: true, value: { context: {
          workspaceId: h.workspaceId, workItemId: input.workItemId, repositoryId: input.repositoryId, status: 'ready',
          ...(scenario === 'missing' || input.repositoryId === LONG_REPOSITORY ? {} : { runStatus: scenario === 'failed' ? 'failed' : scenario === 'succeeded' || scenario === 'stale' ? 'succeeded' : 'unknown', runConfirmedAt: '2026-10-30T00:00:00.000Z', runStale: ['all', 'unknown', 'stale'].includes(scenario), fallback: 'manual_fallback' }),
          worktreeExternalId: '/fixture/' + 'longdirectory'.repeat(18), branchExternalId: 'feature/' + 'longbranch'.repeat(12),
        } } })
      if (showcase && route === '/context') result = displayContext(input)
      else if (showcase && route === '/remote') {
        const method = input.name ?? input.method, operation = Object.hasOwn(OPERATIONS, method) ? OPERATIONS[method] : undefined
        if (operation?.mode !== 'unary') throw new TypeError('unary operation required')
        const args = input.args ?? operation.params.map(param => input.input?.[param.name])
        if (method === 'getExecutionContext') result = displayContext({ workItemId: args[0], repositoryId: args[1] })
        else if (method === 'baseline') result = { ok: true, value: displayBaseline(await h.installed.service.baseline()) }
        else {
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
      } else if (route === '/remote') {
        try {
          exactRecord(input, ['name', 'input'], 'remote')
          const operation = Object.hasOwn(OPERATIONS, input.name) ? OPERATIONS[input.name] : undefined
          if (operation?.mode !== 'unary') throw new TypeError('unary operation required')
          const parsed = parseInput(operation, input.input); requests.push({ name: input.name, input: parsed })
          result = { ok: true, value: await h.installed.service[input.name](...operation.params.map(p => parsed[p.name])) }
        } catch { result = { ok: false, error: 'Host unavailable' } }
      } else if (route === '/control') {
        // 既有执行状态 seam 只用于 drawer 正控，不用于证明权限事实。
        if (input.action === 'status') await h.storage.putExecutionRun({ ...(await h.storage.getExecutionRun(h.runId)), status: input.value })
        if (input.action === 'fault') h.byDomain[input.value.domain].faultsSwitch.set(input.value.kind, input.value.enabled)
        if (input.action === 'permission') {
          if (!Object.values(permissionMethods[input.value.domain] ?? {}).includes(input.value.key)) throw new TypeError('Unknown fixture permission')
          input.value.enabled ? denied.delete(input.value.key) : denied.add(input.value.key)
        }
        if (input.action === 'hold') {
          const { domain, method, enabled } = input.value, key = `${domain}.${method}`, provider = h.byDomain[domain]
          if (!wrapped.has(key)) { const run = provider[method].bind(provider); provider[method] = async (...args) => { const result = await run(...args); if (holds.has(key)) await new Promise(resolve => held.push(resolve)); return result }; wrapped.add(key) }
          enabled ? holds.add(key) : holds.delete(key)
        }
        if (input.action === 'release') { holds.clear(); held.splice(0).forEach((resolve) => resolve()) }
        result = { requests, held: held.length, streams: streams.size, workspaceId: h.workspaceId, itemId: h.itemId,
          external: { branches: h.byDomain.development.state.branches.length, worktrees: h.byDomain.development.state.worktrees.length, runs: h.byDomain.execution.state.runs.length } }
      }
      else { response.writeHead(404); response.end(); return }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result))
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { ...h, requests, inputs: Object.keys(bundle.metafile.inputs), url: `http://127.0.0.1:${server.address().port}`, close: async () => { holds.clear(); held.splice(0).forEach((resolve) => resolve()); for (const abort of streams) abort.abort(); server.closeIdleConnections(); await new Promise((resolve) => server.close(resolve)); await h.close() } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const h = await startExecutionServer(); console.log(h.url); process.on('SIGINT', async () => { await h.close(); process.exit(0) }) }
