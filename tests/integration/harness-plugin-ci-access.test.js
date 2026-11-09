import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from '../../apps/harness-plugin/scripts/build.mjs'
import { markdownDocument } from '../fixtures/markdown-vm.mjs'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'
import { createRepositoryBindingSource } from '@harness-projects/client'
import { RepositoryBindingForm } from '@harness-projects/ui'
import { WORKSPACE, ACCOUNT, account, dump, seed, seedWorkspace } from './fixtures/host-seed.js'
import { runItem, checkItem } from '../fixtures/github-actions.mjs'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url)), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const actorRef = { kind: 'user' }, repositoryId = 'github.com/acme-widgets/widgets'
const keys = ['delivery.pipeline.read', 'delivery.check.read']
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function fixture({ unborn = false, catalog = PROVIDER_CATALOG } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ci-access-')), repo = path.join(root, 'repo'), dataPath = path.join(root, 'data', 'workspace.sqlite')
  await mkdir(repo); git(repo, 'init', '-q', '-b', 'main')
  if (!unborn) git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture')
  const commit = unborn ? undefined : git(repo, 'rev-parse', 'HEAD')
  await seed(dataPath, PROVIDER_CATALOG, async storage => { await seedWorkspace(storage); await storage.putConnectorAccount(account()) })
  const calls = [], modes = { actions: 'ok', checks: 'ok' }
  let gate
  const fetch = async (href, init) => {
    const url = new URL(href)
    if (url.pathname === '/user') return reply({ node_id: 'octo-1', login: 'Octo' })
    if (url.pathname === '/graphql') {
      const body = JSON.parse(init.body)
      if (body.operationName === 'DevelopmentRepository') return reply({ data: { repository: { id: 'R_fixture', name: body.variables.name, nameWithOwner: `${body.variables.owner}/${body.variables.name}`, updatedAt: '2026-11-09T00:00:00Z', defaultBranchRef: { name: 'main' } } } })
      throw Error('Unexpected GraphQL fixture')
    }
    assert.equal(init.method, 'GET'); assert.equal(url.origin, 'https://api.github.com')
    assert.ok(url.pathname.startsWith('/repos/acme-widgets/widgets/'))
    const axis = url.pathname.endsWith('/actions/runs') ? 'actions' : 'checks', mode = modes[axis]
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) })
    if (gate) await gate(axis)
    if (mode === 'offline') throw Error('RAW-CANARY')
    if (typeof mode === 'number') return reply({ message: 'RAW-CANARY' }, mode)
    if (mode === 'limited') return reply({}, 403, { 'x-ratelimit-remaining': '0' })
    if (mode === 'malformed') return reply({ value: 'RAW-CANARY' })
    if (url.pathname.endsWith('/check-suites')) return reply({ total_count: 1, check_suites: [{ id: 1 }] })
    const sha = mode === 'wrong-head' ? 'b'.repeat(40) : commit
    if (axis === 'actions') assert.equal(url.searchParams.get('head_sha'), commit)
    else assert.ok(url.pathname.includes(`/commits/${commit}/`))
    return reply({ total_count: mode === 'empty' ? 0 : 1, [axis === 'actions' ? 'workflow_runs' : 'check_runs']: mode === 'empty' ? [] : [axis === 'actions' ? runItem({ id: 1, commit: sha }) : checkItem({ id: 2, name: 'build', commit: sha })] })
  }
  const options = { dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => 'fixture-secret', fetch }
  const host = await createHostComposition(options)
  const input = { actorRef, idempotencyKey: 'bind-ci', repositoryId, references: [
    { domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryPath: repo, repositoryExternalId: repositoryId } },
    ...['development.github', 'github-actions'].map(implementationKey => ({ domain: implementationKey === 'github-actions' ? 'delivery' : 'development', implementationKey, accountId: ACCOUNT, configuration: { repositoryExternalId: repositoryId, repositoryOwner: 'acme-widgets', repositoryName: 'widgets' } })),
  ] }
  const baseline = async () => HOST_REMOTE.invocations.find(entry => entry.method === 'baseline').result.encode(await host.call('baseline', {}))
  return { repo, dataPath, commit, options, host, input, modes, calls, baseline, gate: value => { gate = value } }
}
const access = baseline => keys.map(key => baseline.repositories.find(repository => repository.id === repositoryId).capabilities.find(entry => entry.key === key)?.access)
for (const [actions, checks, expected] of [['ok', 403, ['available', 'unavailable']], [403, 'ok', ['unavailable', 'available']]]) test(`explicit bind independently observes Actions ${actions} and Checks ${checks}`, async () => {
  const f = await fixture(); f.modes.actions = actions; f.modes.checks = checks
  try {
    assert.equal(f.calls.length, 0, 'startup must not read CI')
    const before = git(f.repo, 'status', '--porcelain=v1'), result = await f.host.call('bindRepository', f.input)
    assert.equal(result.writeState, 'local_only')
    assert.deepEqual(access(await f.baseline()), expected)
    assert.equal(git(f.repo, 'status', '--porcelain=v1'), before)
    const source = createRepositoryBindingSource({ connectAccount: (actorRef, idempotencyKey) => f.host.call('connectAccount', { actorRef, idempotencyKey }), bindRepository: (actorRef, idempotencyKey, repositoryId, references) => f.host.call('bindRepository', { actorRef, idempotencyKey, repositoryId, references }), baseline: f.baseline }, { actorRef })
    try {
      await source.bind({ localPath: f.repo, owner: 'acme-widgets', name: 'widgets' })
      assert.equal(source.getSnapshot().state, 'active', 'CI denial must not disable independent Development')
      assert.deepEqual(source.getSnapshot().ciReadAccess, { actions: expected[0], checks: expected[1] })
      const html = renderToStaticMarkup(React.createElement(RepositoryBindingForm, { source }))
      assert.match(html, /仓库已连接/); assert.ok(html.includes(`Actions 读取：${actions === 'ok' ? '已验证可用' : '不可用'}`)); assert.ok(html.includes(`Checks 读取：${checks === 'ok' ? '已验证可用' : '不可用'}`)); assert.match(html, /重新验证仓库与 CI/)
    } finally { source.dispose() }
  } finally { await f.host.dispose() }
})

test('same binding explicitly revalidates revoke and recover, without persisting evidence or changing Planning', async () => {
  const f = await fixture()
  try {
    await f.host.call('bindRepository', f.input); const rows = dump(f.dataPath)
    assert.deepEqual(access(await f.baseline()), ['available', 'available'])
    f.modes.actions = 403; await f.host.call('bindRepository', f.input)
    assert.deepEqual(access(await f.baseline()), ['unavailable', 'available'])
    f.modes.actions = 'ok'; await f.host.call('bindRepository', f.input)
    const baseline = await f.baseline(); assert.deepEqual(access(baseline), ['available', 'available'])
    assert.deepEqual(dump(f.dataPath), rows, 'observations and same-bind revalidation must write no rows')
    assert.equal(JSON.parse(rows.workspace)[0].status_policy, 'provider_authoritative')
    assert.doesNotMatch(JSON.stringify([rows, baseline]), /fixture-secret|RAW-CANARY|accountStamp|observedAt.*sequence/)
    const diagnostics = await readFile(path.join(path.dirname(f.dataPath), 'diagnostics.log'), 'utf8').catch(() => '')
    assert.doesNotMatch(diagnostics, /RAW-CANARY|fixture-secret/)
    await f.host.dispose(); f.calls.length = 0
    const restarted = await createHostComposition(f.options)
    try { assert.equal(f.calls.length, 0); assert.deepEqual(access(await restarted.call('baseline', {})), ['degraded', 'degraded']); assert.equal(f.calls.length, 0) } finally { await restarted.dispose() }
  } finally { await f.host.dispose() }
})
for (const mode of ['empty', 'limited', 429, 404, 'offline', 'malformed', 'wrong-head']) test(`ambiguous ${mode} remains degraded independently on each axis`, async () => {
  const f = await fixture()
  try {
    for (const axis of ['actions', 'checks']) {
      f.modes.actions = 'ok'; f.modes.checks = 'ok'; f.modes[axis] = mode
      assert.equal((await f.host.call('bindRepository', f.input)).writeState, 'local_only')
      assert.deepEqual(access(await f.baseline()), axis === 'actions' ? ['degraded', 'available'] : ['available', 'degraded'])
    }
  } finally { await f.host.dispose() }
})
test('successful suites cannot stand in for denied check-runs', async () => {
  const f = await fixture(); f.gate(axis => { if (axis === 'checks') f.modes.checks = 403 })
  try {
    await f.host.call('bindRepository', f.input)
    assert.ok(f.calls.some(call => call.path.endsWith('/check-suites'))); assert.ok(f.calls.some(call => call.path.endsWith('/check-runs')))
    assert.deepEqual(access(await f.baseline()), ['available', 'unavailable'])
  } finally { await f.host.dispose() }
})
test('unborn HEAD makes no CI requests and cannot establish read access', async () => {
  const f = await fixture({ unborn: true })
  try { assert.equal((await f.host.call('bindRepository', f.input)).writeState, 'local_only'); assert.equal(f.calls.length, 0); assert.deepEqual(access(await f.baseline()), ['degraded', 'degraded']) } finally { await f.host.dispose() }
})
test('late older success cannot replace a newer explicit denial', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); let first = true
  f.gate(async axis => { if (axis === 'actions' && first) { first = false; entered.resolve(); await release.promise } })
  try {
    const old = f.host.call('bindRepository', f.input); await entered.promise
    f.modes.actions = 403; f.modes.checks = 403
    assert.equal((await f.host.call('bindRepository', f.input)).writeState, 'local_only')
    release.resolve(); assert.equal((await old).error.code, 'conflict')
    assert.deepEqual(access(await f.baseline()), ['unavailable', 'unavailable'])
  } finally { release.resolve(); await f.host.dispose() }
})
for (const changed of ['account', 'binding', 'HEAD', 'stop']) test(`${changed} changes during observation fence the old success`, async () => {
  const f = await fixture(), entered = deferred(), release = deferred()
  f.modes.actions = 403; f.modes.checks = 403; await f.host.call('bindRepository', f.input)
  f.modes.actions = 'ok'; f.modes.checks = 'ok'
  f.gate(async axis => { if (axis === 'actions') { entered.resolve(); await release.promise } })
  try {
    const pending = f.host.call('bindRepository', f.input); await entered.promise
    if (changed === 'account') await seed(f.dataPath, PROVIDER_CATALOG, storage => storage.putConnectorAccount(account({ secretHandle: undefined })))
    if (changed === 'binding') await seed(f.dataPath, PROVIDER_CATALOG, async storage => {
      const mount = (await storage.listProviderBindings(WORKSPACE)).find(binding => binding.implementationKey === 'github-actions')
      await storage.putBindingConfiguration({ ref: { workspaceId: WORKSPACE, bindingId: mount.id, domain: 'delivery' }, configuration: { repositoryExternalId: repositoryId, repositoryOwner: 'acme-widgets', repositoryName: 'other' } })
    })
    if (changed === 'HEAD') git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'next')
    if (changed === 'stop') f.host.stop()
    release.resolve()
    if (changed === 'stop') await assert.rejects(pending, /操作失败|关闭/)
    else { assert.equal((await pending).error?.code, 'conflict'); assert.deepEqual(access(await f.baseline()), ['unavailable', 'unavailable']) }
  } finally { release.resolve(); await f.host.dispose() }
})

test('a newer validation starting during assembly prevents the old candidate from activating', async () => {
  const entered = deferred(), release = deferred(), catalog = new Map(PROVIDER_CATALOG), entry = catalog.get('github-actions'); let pause = true
  catalog.set('github-actions', { ...entry, create: async input => { if (input.ci && pause) { pause = false; entered.resolve(); await release.promise } return entry.create(input) } })
  const f = await fixture({ catalog })
  try {
    const old = f.host.call('bindRepository', f.input); await entered.promise
    f.modes.actions = 403; f.modes.checks = 403
    const latest = f.host.call('bindRepository', f.input)
    release.resolve(); assert.equal((await old).activationError?.code, 'unavailable')
    assert.equal((await latest).writeState, 'local_only'); assert.deepEqual(access(await f.baseline()), ['unavailable', 'unavailable'])
  } finally { release.resolve(); await f.host.dispose() }
})

test('built Host and client entries carry both inverse CI observations into the packaged form', async () => {
  const f = await fixture(); await f.host.dispose()
  const profile = path.join(path.dirname(f.dataPath), 'profile'), dataPath = path.join(profile, 'harness-projects', 'workspace.sqlite'), outDir = path.join(profile, 'out')
  await seed(dataPath, PROVIDER_CATALOG, async storage => { await seedWorkspace(storage); await storage.putConnectorAccount(account()) })
  await build({ outDir })
  await mkdir(path.join(outDir, 'package', 'node_modules')); await symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/cordis/package.json')))), path.join(outDir, 'package', 'node_modules', '@deepseek-ai'))
  const hostModule = await import(pathToFileURL(path.join(outDir, 'package', 'lib', 'index.js')).href), effects = [], services = new Map(), originalFetch = globalThis.fetch
  const effect = callback => { const cleanup = callback(); effects.push(cleanup); return cleanup }
  globalThis.fetch = f.options.fetch
  try {
    await hostModule.apply({ invocation: { peer: { id: 'ci-artifact' } }, effect, provide: (name, value) => { services.set(name, value); return () => services.delete(name) }, typert: { register: () => async () => {} }, get: name => name === 'profileContext' ? { dir: profile } : name === 'credentials' ? { resolve: async () => ({ value: 'fixture-secret', source: 'fixture' }) } : undefined })
    assert.equal(f.calls.length, 0)
    let descriptor, Panel
    const context = vm.createContext({ window: { __ModuleLoader__: { load: value => { descriptor = value } } }, document: markdownDocument, console, crypto: globalThis.crypto, setTimeout, clearTimeout })
    vm.runInContext(await readFile(path.join(outDir, 'package', 'lib', 'client.js'), 'utf8'), context)
    const exported = descriptor.factory(id => id === 'react' ? React : id === 'react/jsx-runtime' ? require(id) : {}), json = vm.runInContext('(text) => JSON.parse(text)', context)
    const service = services.get('harnessProjects'), remote = new Proxy({}, { get: (_target, method) => async (...args) => json(JSON.stringify({ ok: true, value: await service[method](...JSON.parse(JSON.stringify(args))) })) })
    await exported.apply({ effect, remote: { $mount: async () => async () => {} }, inject: (_names, callback) => callback({ effect, remote: { harnessProjects: remote, $stream: () => ({ dispose: async () => {}, [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }) }, slots: { inject: (_name, callback) => effect(callback), register: (options, component) => { if (options.name === 'main') Panel = component; return () => {} } } }) })
    const source = Panel().props.repositoryBindingSource
    for (const [actions, checks] of [['ok', 403], [403, 'ok']]) {
      f.modes.actions = actions; f.modes.checks = checks
      await source.bind({ localPath: f.repo, owner: 'acme-widgets', name: 'widgets' })
      assert.equal(source.getSnapshot().state, 'active')
      const html = renderToStaticMarkup(React.createElement(Panel))
      assert.ok(html.includes(`Actions 读取：${actions === 'ok' ? '已验证可用' : '不可用'}`)); assert.ok(html.includes(`Checks 读取：${checks === 'ok' ? '已验证可用' : '不可用'}`))
      assert.doesNotMatch(html, /fixture-secret|RAW-CANARY|Saved/)
    }
  } finally { for (const cleanup of effects.reverse()) await cleanup?.(); globalThis.fetch = originalFetch; await f.host.dispose() }
})


// Local combination acceptance: the explicit CI preflight shares Host I/O lifetime.
for (const phase of ['credential', 'http']) test(`combined CI ${phase} wait aborts on Host stop without late activation`, async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), before = dump(f.dataPath), originalController = f.host.controller
  const originalFetch = f.options.fetch
  let signal, lateFetches = 0
  if (phase === 'credential') f.options.resolveCredential = async () => { entered.resolve(); return release.promise }
  else f.options.fetch = async (href, init) => {
    if (new URL(href).pathname.endsWith('/actions/runs')) { signal = init.signal; entered.resolve(); return release.promise }
    lateFetches++; return originalFetch(href, init)
  }
  const pending = f.host.call('bindRepository', f.input), rejected = assert.rejects(pending, /操作失败|关闭/)
  const within = async promise => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('combined CI shutdown exceeded deadline')), 500) })]) } finally { clearTimeout(timer) } }
  try {
    await entered.promise
    const atStop = lateFetches
    f.host.stop(); const started = Date.now()
    await within(f.host.dispose(started + 80)); await within(rejected)
    assert.ok(Date.now() - started < 400)
    if (phase === 'http') assert.equal(signal.aborted, true, 'real probe HTTP must carry Host abort')
    release.resolve(phase === 'credential' ? 'fixture-secret' : reply({ total_count: 1, workflow_runs: [runItem({ id: 1, commit: f.commit })] }))
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve))
    assert.equal(lateFetches, atStop, 'late value cannot dispatch more HTTP')
    assert.equal(f.host.controller, originalController, 'late success cannot activate an assembly')
    assert.deepEqual(dump(f.dataPath), before, 'aborted preflight cannot persist binding rows')
  } finally { release.resolve(); await rejected; await f.host.dispose() }
})

test('combined same-bind CI revalidation keeps the cached Development port usable across retirement', async () => {
  const created = [], catalog = new Map(PROVIDER_CATALOG), entry = catalog.get('development.github')
  catalog.set('development.github', { ...entry, create: async input => {
    const port = await entry.create(input)
    if (input.binding.id !== 'repository-binding-probe') created.push({ port, bindingId: input.binding.id })
    return port
  } })
  const f = await fixture({ catalog })
  try {
    assert.equal((await f.host.call('bindRepository', f.input)).writeState, 'local_only')
    assert.equal(created.length, 1)
    const { port, bindingId } = created[0], scope = { bindingId, objectKind: 'repository', externalId: repositoryId, url: undefined }
    assert.equal((await port.getRepository(scope)).ok, true)
    const first = f.host.controller
    f.modes.actions = 403
    assert.equal((await f.host.call('bindRepository', f.input)).writeState, 'local_only')
    assert.notEqual(f.host.controller, first)
    assert.equal(created.length, 1, 'same target/account must reuse the cached Development port')
    assert.deepEqual(access(await f.baseline()), ['unavailable', 'available'])
    assert.equal((await port.getRepository(scope)).ok, true, 'retired assembly must not abort cached Host-scoped credentials/fetch')
    f.modes.actions = 'ok'
    assert.equal((await f.host.call('bindRepository', f.input)).writeState, 'local_only')
    assert.deepEqual(access(await f.baseline()), ['available', 'available'])
    assert.equal(created.length, 1)
    assert.equal((await port.getRepository(scope)).ok, true)
  } finally { await f.host.dispose() }
})
