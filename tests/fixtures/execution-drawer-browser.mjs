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
const ENTRY = `
import { createElement } from 'react'
import { apply } from './apps/harness-plugin/src/client.ts'
export async function mount(root) {
  let push, stopped = false, generation = 0, carrierFailed
  const queue = [], waiters = [], disposers = []
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve))
  const emit = (value) => waiters.length ? waiters.shift()(value) : queue.push(value)
  const command = async (action, value) => (await fetch('/control', { method: 'POST', body: JSON.stringify({ action, value }) })).json()
  const child = { effect: (run) => disposers.push(run()), slots: { inject: (_, run) => run(), register: (slot, Panel) => { if (slot.name === 'main') root.render(createElement(Panel)) } }, remote: {
    harnessProjects: { getExecutionContext: async (workItemId, repositoryId) => (await fetch('/context', { method: 'POST', body: JSON.stringify({ workItemId, repositoryId }) })).json() },
    $stream: (options) => { carrierFailed = options.carrierFailed; return { restart() {}, dispose: async () => { stopped = true; emit(null) }, async *[Symbol.asyncIterator]() {
      emit(await (await fetch('/baseline')).json())
      while (!stopped) { const baseline = await next(); if (baseline === null) return; yield { generation: ++generation, value: { kind: 'baseline', baseline }, accept() {} } }
    } } },
  } }
  await apply({ remote: { $mount: async () => {} }, inject: (_, run) => run(child) })
  return { command, emit: async () => emit(await (await fetch('/baseline')).json()), disconnect: () => carrierFailed?.(new Error('fixture disconnect')), unmount: async () => { root.unmount(); await Promise.all(disposers.map((run) => run())) } }
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
  const page = '<!doctype html><meta charset="utf-8"><title>执行抽屉</title><div id="app"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>window.require=()=>React;var module={exports:{}};var exports=module.exports</script><script src="/bundle.js"></script><script>module.exports.mount(ReactDOM.createRoot(document.getElementById("app"))).then(value=>window.fixture=value)</script>'
  const server = createServer(async (request, response) => {
    try {
      const route = new URL(request.url, 'http://fixture.invalid').pathname
      if (scripts[route]) { response.setHeader('content-type', 'text/javascript'); response.end(scripts[route]); return }
      if (route === '/') { response.setHeader('content-type', 'text/html;charset=utf-8'); response.end(page); return }
      let raw = ''; for await (const chunk of request) raw += chunk
      const input = raw ? JSON.parse(raw) : {}
      let result
      if (route === '/context') {
        requests.push(input)
        try { result = fail ? { ok: false, error: 'SECRET' } : { ok: true, value: await h.installed.service.getExecutionContext(input.workItemId, input.repositoryId) } } catch { result = { ok: false, error: 'Host unavailable' } }
        if (paused) await new Promise((resolve) => held.push(resolve))
      } else if (route === '/control') {
        if (input.action === 'status') await h.storage.putExecutionRun({ ...(await h.storage.getExecutionRun(h.runId)), status: input.value })
        if (input.action === 'visibility') input.value === null ? visibility.delete(h.itemId) : visibility.set(h.itemId, input.value)
        if (input.action === 'pause') paused = input.value
        if (input.action === 'fail') fail = input.value
        if (input.action === 'release') { paused = false; held.splice(0).forEach((resolve) => resolve()) }
        result = { requests }
      } else if (route === '/baseline') { const baseline = await h.host.controller.baseline(); result = { ...baseline, entities: baseline.entities.map(project) } }
      else { response.writeHead(404); response.end(); return }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result))
    } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { ...h, requests, inputs: Object.keys(bundle.metafile.inputs), url: `http://127.0.0.1:${server.address().port}`, close: async () => { held.splice(0).forEach((resolve) => resolve()); await new Promise((resolve) => server.close(resolve)); await h.close() } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const h = await startExecutionServer(); console.log(h.url); process.on('SIGINT', async () => { await h.close(); process.exit(0) }) }
