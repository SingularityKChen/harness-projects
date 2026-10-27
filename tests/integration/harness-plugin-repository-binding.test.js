import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { WORKSPACE, ACCOUNT, account, dump, seed, seedWorkspace, githubFetch, REPOSITORY_MOUNTS } from './fixtures/host-seed.js'
const actorRef = { kind: 'user' }, selected = REPOSITORY_MOUNTS['development.github'][1]
const repositoryId = `github.com/${selected.repositoryOwner.toLowerCase()}/${selected.repositoryName.toLowerCase()}`
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const request = (repositoryPath, extra = {}) => ({ actorRef, idempotencyKey: 'bind-1', repositoryId, references: [
  { domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: repositoryId, repositoryPath } },
  ...['development.github', 'github-actions'].map((implementationKey) => ({ domain: implementationKey === 'github-actions' ? 'delivery' : 'development', implementationKey, accountId: ACCOUNT, configuration: { repositoryExternalId: repositoryId, repositoryOwner: selected.repositoryOwner.toLowerCase(), repositoryName: selected.repositoryName.toLowerCase() } })),
], ...extra })
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'binding-')), repo = path.join(root, 'repo'), dataPath = path.join(root, 'data', 'workspace.sqlite')
  await mkdir(repo); git(repo, 'init', '-q', '-b', 'main'); git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture')
  await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await storage.putConnectorAccount(account()) })
  const github = githubFetch(), host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'fixture-secret', fetch: (url, init) => { const body = JSON.parse(init.body); body.variables.owner = selected.repositoryOwner; return github.fetch(url, { ...init, body: JSON.stringify(body) }) } })
  return { root, repo, dataPath, host, github }
}
const identity = (file) => { const rows = dump(file); return Object.fromEntries(Object.entries(rows).filter(([key]) => !key.includes('revision'))) }
const repoState = async (repo) => [git(repo, 'show-ref'), git(repo, 'worktree', 'list', '--porcelain'), await readFile(path.join(repo, '.git', 'config'), 'utf8'), await readFile(path.join(repo, '.git', 'index')).catch(() => null)]
test('inconsistent three-reference intents reject before configuration without SQL changes', async () => {
  const f = await fixture()
  try {
    const before = identity(f.dataPath)
    for (const change of [(r) => { r.references[2].configuration.repositoryOwner = 'other' }, (r) => { r.references[1].configuration.repositoryExternalId = 'other' }, (r) => { r.references.pop() }, (r) => { r.references[2].accountId = 'other' }]) {
      const r = request(f.repo); change(r)
      const result = await f.host.call('bindRepository', r)
      assert.equal(result.writeState, 'failed'); assert.equal(result.error.code, 'invalid_input')
      assert.deepEqual(identity(f.dataPath), before)
    }
    assert.equal(f.github.requests.length, 0)
  } finally { await f.host.dispose() }
})
test('missing, ordinary and bare paths refuse without SQL or repository writes', async () => {
  const f = await fixture()
  try {
    const plain = path.join(f.root, 'plain'), bare = path.join(f.root, 'bare'); await mkdir(plain); git(f.root, 'init', '-q', '--bare', bare)
    const before = identity(f.dataPath), state = await repoState(f.repo)
    for (const repositoryPath of [path.join(f.root, 'missing'), plain, bare, `${f.repo}/../repo`]) {
      const result = await f.host.call('bindRepository', request(repositoryPath))
      assert.equal(result.writeState, 'failed'); assert.equal(result.error.code, 'invalid_input'); assert.deepEqual(identity(f.dataPath), before)
    }
    assert.deepEqual(await repoState(f.repo), state); assert.equal(f.github.requests.length, 0)
  } finally { await f.host.dispose() }
})
test('remote not-found, permission and transport failures reject before binding and redact raw text', async () => {
  for (const mode of [404, 403, 'offline']) {
    const f = await fixture(); await f.host.dispose()
    const host = await createHostComposition({ dataPath: f.dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'fixture-secret', fetch: async () => { if (mode === 'offline') throw new Error('RAW-CANARY'); return new Response(JSON.stringify({ message: 'RAW-CANARY' }), { status: mode }) } })
    try {
      const before = identity(f.dataPath), state = await repoState(f.repo), result = await host.call('bindRepository', request(f.repo))
      assert.equal(result.writeState, 'failed'); assert.equal(result.error.code, mode === 404 ? 'not_found' : mode === 403 ? 'permission_denied' : 'unavailable')
      assert.doesNotMatch(JSON.stringify(result), /RAW-CANARY|fixture-secret/); assert.deepEqual(identity(f.dataPath), before); assert.deepEqual(await repoState(f.repo), state)
    } finally { await host.dispose() }
  }
})
test('double binding uses one repository and exactly three same-key identities without changing Git', async () => {
  const f = await fixture()
  try {
    const before = await repoState(f.repo), input = request(f.repo)
    const results = await Promise.all([f.host.call('bindRepository', input), f.host.call('bindRepository', input)])
    assert.deepEqual(results.map((r) => r.writeState), ['local_only', 'local_only'])
    const rows = dump(f.dataPath), repos = JSON.parse(rows.repository), bindings = JSON.parse(rows.provider_binding), configs = JSON.parse(rows.workspace_binding)
    assert.equal(repos.length, 1); assert.equal(bindings.length, 3); assert.equal(configs.length, 3)
    assert.ok(configs.every((row) => JSON.parse(row.configuration_json).repositoryExternalId === repositoryId))
    const identities = JSON.parse(rows.external_identity); assert.equal(identities.length, 3); assert.ok(identities.every((row) => row.external_id === repositoryId)); assert.equal(new Set(identities.map((row) => row.entity_id)).size, 1)
    const baseline = await f.host.call('baseline', {}); assert.equal(baseline.repositories[0].id, repositoryId)
    assert.deepEqual(await repoState(f.repo), before); assert.deepEqual(f.github.misses, [])
  } finally { await f.host.dispose() }
})
test('output root in checkout or symlink into checkout rejects before binding', async () => {
  for (const link of [false, true]) {
    const f = await fixture(); await f.host.dispose()
    const dataPath = link ? f.dataPath : path.join(f.repo, 'data', 'workspace.sqlite')
    if (!link) await seed(dataPath, PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await storage.putConnectorAccount(account()) })
    if (link) await symlink(f.repo, path.join(path.dirname(dataPath), 'worktrees'))
    const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'fixture-secret', fetch: f.github.fetch })
    try { const before = identity(dataPath), result = await host.call('bindRepository', request(f.repo)); assert.equal(result.writeState, 'failed'); assert.equal(result.error.code, 'invalid_input'); assert.deepEqual(identity(dataPath), before) } finally { await host.dispose() }
  }
})
test('second and third reference SQL failures roll back every binding row', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  for (const ordinal of [2, 3]) {
    const f = await fixture(), db = new DatabaseSync(f.dataPath)
    db.exec(`CREATE TRIGGER fail_reference BEFORE INSERT ON workspace_binding WHEN (SELECT COUNT(*) FROM provider_binding) = ${ordinal} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`); db.close()
    try { const before = identity(f.dataPath); await assert.rejects(() => f.host.call('bindRepository', request(f.repo)), /操作失败/); assert.deepEqual(identity(f.dataPath), before) } finally { await f.host.dispose() }
  }
})
test('Local catalog preflight issues only read argv while real Git state remains unchanged', async () => {
  const f = await fixture(); await f.host.dispose()
  const catalog = new Map(PROVIDER_CATALOG), entry = catalog.get('development.local-git'), calls = []
  catalog.set('development.local-git', { ...entry, create: async (input) => { const port = await entry.create(input), run = port.runGit; port.runGit = (args) => { calls.push(args); return run(args) }; return port } })
  const host = await createHostComposition({ dataPath: f.dataPath, workspaceId: WORKSPACE, catalog, resolveCredential: async () => 'fixture-secret', fetch: (url, init) => { const body = JSON.parse(init.body); body.variables.owner = selected.repositoryOwner; return f.github.fetch(url, { ...init, body: JSON.stringify(body) }) } })
  try {
    const before = await repoState(f.repo); assert.equal((await host.call('bindRepository', request(f.repo))).writeState, 'local_only')
    assert.ok(calls.length > 0); assert.ok(calls.every((args) => args[0] === '-C' && (['rev-parse', 'symbolic-ref', 'for-each-ref'].includes(args[2]) || (args[2] === 'config' && args[3] === '--get'))))
    assert.deepEqual(await repoState(f.repo), before)
  } finally { await host.dispose() }
})
test('disabled Local Git stays configured until the output directory is repaired and Host is restarted', async () => {
  const { createHash } = await import('node:crypto'), { unlink } = await import('node:fs/promises')
  const { createRepositoryBindingSource } = await import('@harness-projects/client')
  const f = await fixture(), before = await repoState(f.repo)
  const first = await f.host.call('bindRepository', request(f.repo)); await f.host.dispose()
  const output = path.join(path.dirname(f.dataPath), 'worktrees'), localId = first.value.bindingIds[0]
  await mkdir(output); const link = path.join(output, createHash('sha256').update(localId).digest('hex').slice(0, 16)); await symlink(f.repo, link)
  const options = { dataPath: f.dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential: async () => 'fixture-secret', fetch: (url, init) => { const body = JSON.parse(init.body); body.variables.owner = selected.repositoryOwner; return f.github.fetch(url, { ...init, body: JSON.stringify(body) }) } }
  let host = await createHostComposition(options)
  const source = createRepositoryBindingSource({ connectAccount: async () => ({ writeState: 'local_only', saving: false, authoritative: false, value: { accountId: ACCOUNT } }), bindRepository: (actorRef, idempotencyKey, repositoryId, references) => host.call('bindRepository', { actorRef, idempotencyKey, repositoryId, references }), baseline: () => host.call('baseline', {}) }, { actorRef })
  const selection = { localPath: f.repo, owner: selected.repositoryOwner, name: selected.repositoryName }
  try {
    await source.bind(selection); assert.equal(source.getSnapshot().state, 'configured'); assert.equal(source.getSnapshot().activationBlocked, true)
    assert.ok(host.disabled.some(entry => entry.bindingId === localId)); assert.deepEqual(await repoState(f.repo), before)
    await unlink(link); await source.bind(selection); assert.equal(source.getSnapshot().state, 'configured', 'unchanged Host assembly still needs the documented restart')
    await host.dispose(); host = await createHostComposition(options); await source.bind(selection)
    assert.equal(source.getSnapshot().state, 'active'); assert.equal(host.disabled.length, 0); assert.deepEqual(await repoState(f.repo), before)
  } finally { source.dispose(); await host.dispose() }
})
