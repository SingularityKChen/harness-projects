/** 组合资格证据：实际 packed Host + production catalog；预置安全布局不覆盖 #644 首次 provision。 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import childProcess, { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
const digest = (value) => createHash('sha256').update(value).digest('hex')
const json = (value) => JSON.parse(JSON.stringify(value))

// 字节快照加真实 argv 账本同时判定“没有额外 Git 写入”，不把最终 refs 相同当作充分证据。
async function gitState(repositoryPath) {
  const directory = path.join(repositoryPath, '.git'), files = []
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name)
      files.push([path.relative(directory, file).replaceAll('\\', '/'), digest(await readFile(file))])
    }
  }
  return files.sort(([left], [right]) => left.localeCompare(right))
}

async function openPacked(apply, fixture, handle, resolved) {
  const services = new Map(), registrations = new Set(), effects = []
  const ctx = {
    invocation: { peer: { id: 'combined-native-qualification' } },
    get: (name) => name === 'profileContext' ? { dir: fixture.profile } : name === 'credentials' ? {
      async resolve(reference) { assert.equal(reference, handle); resolved.push(reference); return { value: 'combined-fixture-token', source: 'qualification-fixture' } },
    } : undefined,
    effect(run) { effects.push(run()) },
    provide(name, value) { services.set(name, value); return () => services.delete(name) },
    typert: { register(value) { registrations.add(value); return () => registrations.delete(value) } },
  }
  const dispose = async () => { for (const stop of effects) await stop(); assert.equal(services.size, 0); assert.equal(registrations.size, 0) }
  try {
    await apply(ctx)
    assert.equal(registrations.size, 1)
    const service = services.get('harnessProjects')
    assert.equal(typeof service?.bindRepository, 'function')
    return { service, dispose }
  } catch (error) { await dispose(); throw error }
}

test('native ordinary-account packed Host explicitly rebinds Unicode repository aliases and preserves identities after reopen', { skip: process.platform !== 'win32', timeout: 120000 }, async (t) => {
  // Native fixture and source imports below are exclusively external DB/ACL setup. The Host only enters packed apply.
  const [{ windowsFixture, setAcl }, { createWorkspaceSetup }, { PROVIDER_CATALOG }, seedTools] = await Promise.all([
    import('./harness-plugin-windows-fixture.js'), import('@harness-projects/core'),
    import('../../apps/harness-plugin/src/host-providers.ts'), import('./fixtures/host-seed.js'),
  ])
  const { ACCOUNT, HANDLE, WORKSPACE, account, dump, githubFetch, REPOSITORY_MOUNTS, seed } = seedTools
  let host
  // Fixture cleanup must follow SQLite/native lease disposal on Windows.
  t.after(async () => { await host?.dispose() })
  const fixture = await windowsFixture(t), repositoryPath = path.join(fixture.ancestor, 'Repo 空 格')
  await mkdir(repositoryPath)
  git(repositoryPath, 'init', '-q', '-b', 'main')
  await writeFile(path.join(repositoryPath, '说明 file.md'), '# native fixture\n')
  git(repositoryPath, 'add', '.')
  git(repositoryPath, '-c', 'user.name=Qualification Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'native fixture')
  const canonical = await realpath(repositoryPath), selected = REPOSITORY_MOUNTS['development.github'][1]
  const owner = selected.repositoryOwner.toLowerCase(), name = selected.repositoryName.toLowerCase(), repositoryId = `github.com/${owner}/${name}`
  const references = (repositoryPath) => [
    { domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: repositoryId, repositoryPath } },
    ...['development.github', 'github-actions'].map((implementationKey) => ({ domain: implementationKey === 'github-actions' ? 'delivery' : 'development', implementationKey,
      accountId: ACCOUNT, configuration: { repositoryExternalId: repositoryId, repositoryOwner: owner, repositoryName: name } })),
  ]
  let bindingIds
  await seed(fixture.dataPath, PROVIDER_CATALOG, async (storage) => {
    await storage.putConnectorAccount(account())
    const seeded = await createWorkspaceSetup(storage).bindRepository({ workspaceId: WORKSPACE, repositoryId, references: references(canonical) })
    assert.equal(seeded.ok, true, JSON.stringify(seeded)); bindingIds = seeded.value.bindingIds
  })
  const before = dump(fixture.dataPath), bindings = JSON.parse(before.provider_binding)
  const localBinding = bindings.find((binding) => binding.implementation_key === 'development.local-git')
  assert.ok(localBinding)
  // #643 qualifies existing private objects; these two directories are intentionally provisioned outside Host (#644).
  const worktrees = path.join(fixture.root, 'worktrees'), allowedRoot = path.join(worktrees, digest(localBinding.id).slice(0, 16))
  for (const directory of [worktrees, allowedRoot]) { await mkdir(directory); setAcl(directory) }
  const stableTables = ['entity', 'external_identity', 'repository', 'provider_binding', 'workspace_binding', 'connector_account']
  const storedFacts = () => { const rows = dump(fixture.dataPath); return Object.fromEntries(stableTables.map((table) => [table, json(JSON.parse(rows[table]))])) }
  const initial = storedFacts(), repository = JSON.parse(before.repository)[0]
  const anchor = JSON.parse(before.external_identity).find((identity) => identity.id === repository.external_identity_id)
  const entity = JSON.parse(before.entity).find((entity) => entity.id === anchor.entity_id)
  const identities = JSON.parse(before.external_identity).filter((identity) => identity.entity_id === entity.id)
  assert.equal(identities.length, 3)
  assert.equal(identities.filter((identity) => identity.role === 'primary').length, 1)
  assert.equal(identities.find((identity) => identity.role === 'primary').id, entity.primary_identity_id)

  const replay = githubFetch(), requests = [], resolved = []
  t.mock.method(globalThis, 'fetch', (url, init) => {
    const target = new URL(url); assert.equal(target.origin, 'https://api.github.com')
    requests.push({ path: target.pathname, method: init.method })
    if (init.body !== undefined) {
      const body = JSON.parse(init.body); assert.equal(body.operationName, 'DevelopmentRepository')
      body.variables.owner = selected.repositoryOwner
      return replay.fetch(url, { ...init, body: JSON.stringify(body) })
    }
    assert.equal(init.method, 'GET')
    assert.ok(['/actions/runs', '/check-suites', '/check-runs'].some((suffix) => target.pathname.endsWith(suffix)))
    return Promise.resolve(new Response(JSON.stringify({ total_count: 0, [target.pathname.endsWith('/actions/runs') ? 'workflow_runs' : target.pathname.endsWith('/check-suites') ? 'check_suites' : 'check_runs']: [] }), { status: 200 }))
  })
  const packedUrl = new URL('../../apps/harness-plugin/dist/package/lib/index.js', import.meta.url)
  const packedBytes = await readFile(packedUrl)
  const state = await gitState(repositoryPath), calls = [], execute = childProcess.execFile
  const recorder = (file, args, ...rest) => {
    if (file === 'git') calls.push([...args])
    return execute(file, args, ...rest)
  }
  // A mock proxy retains execFile's original custom promisifier, which bypasses the argv ledger.
  // This custom adapter uses only the real callback's stdout/stderr/error and preserves promise.child.
  recorder[promisify.custom] = (...args) => {
    let child
    const promise = new Promise((resolve, reject) => {
      child = recorder(...args, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }))
        else resolve({ stdout, stderr })
      })
    })
    promise.child = child
    return promise
  }
  childProcess.execFile = recorder
  syncBuiltinESMExports()
  try {
    const packed = await import(packedUrl.href)
    assert.equal(typeof packed.apply, 'function')
    const aliases = [canonical.replace(/\\Repo /, '/Repo '), canonical.replaceAll('\\', '/').replace('/Repo ', '/repo ')]
    for (const [index, alias] of aliases.entries()) {
      host = await openPacked(packed.apply, fixture, HANDLE, resolved)
      assert.equal((await host.service.getWorkspaceSetup()).workspace.id, WORKSPACE)
      assert.deepEqual((await host.service.baseline()).repositories.map(({ id }) => id), [repositoryId])
      const result = await host.service.bindRepository({ kind: 'user' }, `combined-explicit-${index}`, repositoryId, references(alias))
      assert.equal(result.writeState, 'local_only', JSON.stringify(result))
      assert.equal(result.activationError, undefined, JSON.stringify(result))
      assert.deepEqual(result.value.bindingIds, bindingIds)
      assert.deepEqual(storedFacts(), initial, 'explicit validation and reopen preserve configuration, repository anchors and all primary/alias identities')
      await host.dispose(); host = undefined
    }
    assert.ok(calls.some((args) => args[2] === 'for-each-ref'), 'actual localGit getRepository reads real branch metadata')
    assert.ok(calls.every((args) => args[0] === '-C' && (['rev-parse', 'symbolic-ref', 'for-each-ref', 'show'].includes(args[2])
      || (args.length === 5 && args[2] === 'config' && args[3] === '--get' && args[4] === 'init.defaultBranch'))), JSON.stringify(calls))
    assert.deepEqual(await gitState(repositoryPath), state)
    assert.deepEqual(replay.misses, [])
    assert.ok(requests.length > 0 && resolved.length === requests.length)
    assert.deepEqual(await readdir(worktrees), [path.basename(allowedRoot)], 'public validation creates no probe digest or second binding root')
    t.diagnostic(JSON.stringify({ entry: 'apps/harness-plugin/dist/package/lib/index.js', packedSha256: digest(packedBytes), node: process.version,
      git: git(repositoryPath, '--version'), gitReads: calls.length, remoteFixtureRequests: requests.length, standardAccount: true, preprovisionedLayout: true }))
  } finally {
    try { await host?.dispose() }
    finally { host = undefined; childProcess.execFile = execute; syncBuiltinESMExports() }
  }
})
