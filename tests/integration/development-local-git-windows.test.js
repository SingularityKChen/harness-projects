/** #645：原生 NTFS/Git for Windows 判别证据；POSIX skip 不计作 Windows 验收。 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import childProcess, { execFileSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { chmod, lstat, mkdir, readFile, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { windowsPathsArePlain } from '../../packages/providers/development-local-git/src/git-runner.ts'
import { localGitPathProblem } from '../../packages/providers/development-local-git/src/paths.ts'
import { PROVIDER_CATALOG, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { preflightRepositoryBinding } from '../../apps/harness-plugin/src/host-repository-binding.ts'
import { ACCOUNT, WORKSPACE, account, githubFetch, REPOSITORY_MOUNTS, seedWorkspace } from './fixtures/host-seed.js'
import { BINDING, FROZEN_NOW, REPOSITORY_ID, fixtureFor, git, providerFor, recordingRunner, registerWorkItem, repositoryRef } from './local-git-fixture.js'

const native = { skip: process.platform !== 'win32' }
const slash = (value) => value.replaceAll('\\', '/')
const alias = (value) => slash(value).replace(/Repo|WorkTrees|Task/g, (part) => part.toLowerCase())
const ref = (externalId) => ({ bindingId: BINDING, objectKind: 'worktree', externalId, url: undefined })
async function fixture(t) {
  const original = await fixtureFor(t), repositoryPath = path.join(original.root, 'Repo 空 格')
  await rename(original.repositoryPath, repositoryPath)
  const allowedRoot = path.join(original.root, 'WorkTrees'); await mkdir(allowedRoot)
  return { ...original, repositoryPath, allowedRoot, run: (args) => git(args, repositoryPath) }
}
const provider = (f, options = {}) => providerFor(f, { allowedRoot: f.allowedRoot, ...options })

test('repository admission protects reads and branch writes before every Git entry', async (t) => {
  const f = await fixtureFor(t), recorder = recordingRunner()
  const paths = [process.platform === 'win32' ? 'repo' : path.relative(process.cwd(), f.repositoryPath)]
  if (process.platform === 'win32') {
    const junction = path.join(f.root, 'repository-junction'); await symlink(f.repositoryPath, junction, 'junction')
    paths.push(path.parse(f.root).root.slice(0, 2) + 'repo', '\\\\?\\' + f.repositoryPath, '\\\\server\\share\\repo', junction)
  }
  const observed = []
  for (const repositoryPath of paths) {
    const port = providerFor(f, { repository: { externalId: REPOSITORY_ID, path: repositoryPath }, runGit: recorder.runGit })
    for (const call of [() => port.getRepository(repositoryRef), () => port.listBranches({ repository: repositoryRef, limit: 100 }),
      () => port.getCommit({ bindingId: BINDING, objectKind: 'commit', externalId: f.headCommit }),
      () => port.createBranch({ repository: repositoryRef, name: 'work/admission', fromRef: 'main' })]) observed.push((await call()).error?.code)
  }
  assert.deepEqual(observed, paths.flatMap(() => ['invalid_input', 'invalid_input', 'invalid_input', 'invalid_input']))
  assert.equal(recorder.calls.length, 0)
})

test('real Git timeout after a landed checkout stays ambiguous despite refusal text and reads stay unavailable', async (t) => {
  let hook
  // 先注册屏障，再由 fixture 注册 rm：Git 超时不意味着受控 hook 已退出，Windows 会保留它的 cwd。
  t.after(async () => {
    if (hook === undefined) return
    const recorded = await readFile(hook + '.pid', 'utf8').catch((error) => { if (error.code === 'ENOENT') return undefined; throw error })
    if (recorded === undefined) return
    const pid = Number(recorded), deadline = Date.now() + 10000
    assert.ok(Number.isSafeInteger(pid) && pid > 0)
    while (Date.now() < deadline) {
      let alive = true
      try { process.kill(pid, 0) } catch (error) { if (error.code !== 'ESRCH') throw error; alive = false }
      const done = await readFile(hook + '.done', 'utf8').catch(() => undefined)
      if (!alive && done === 'done') return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.fail('controlled checkout hook did not complete and exit before fixture cleanup')
  })
  const f = await fixtureFor(t), target = path.join(f.root, 'timeout-worktree')
  await f.run(['branch', 'work/timeout'])
  hook = path.join(f.repositoryPath, '.git', 'hooks', 'post-checkout')
  await writeFile(hook, `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
writeFileSync(__filename + '.pid', String(process.pid))
process.stderr.write('fatal: Permission denied by fixture\\n')
setTimeout(() => { writeFileSync(__filename + '.done', 'done'); process.exit(0) }, 32000)
`)
  await chmod(hook, 0o755)
  const recorder = recordingRunner(), invocations = [], port = providerFor(f, { runGit: async (args) => {
    const result = await recorder.runGit(args); invocations.push(result); return result
  } })
  const result = await port.createWorktree({ repository: repositoryRef, path: target, branch: 'work/timeout' })
  assert.equal(result.error?.code, 'ambiguous_result', JSON.stringify(result))
  const interrupted = invocations[recorder.calls.findIndex((args) => args[2] === 'worktree' && args[3] === 'add')]
  assert.equal(interrupted?.interrupted, true, 'the real worktree write must have been interrupted')
  const hookPid = Number(await readFile(hook + '.pid', 'utf8'))
  assert.ok(Number.isSafeInteger(hookPid) && hookPid > 0, 'the controlled hook must have started')
  assert.ok((await f.run(['worktree', 'list', '--porcelain', '-z'])).includes('branch refs/heads/work/timeout\0'))
  assert.equal((await stat(target)).isDirectory(), true)
  const read = await providerFor(f, { runGit: async () => interrupted }).getRepository(repositoryRef)
  assert.equal(read.error?.code, 'unavailable'); assert.equal(recorder.calls.filter((args) => args[2] === 'worktree' && args[3] === 'add').length, 1)
})

// 注入的仅是进程启动边界；仍启动真实 Node child，观测 callback/close 和 stdin 终止的先后关系。
async function metadataChild(t, script, run) {
  const execute = childProcess.execFile, children = []; let completed = 0
  const mocked = t.mock.method(childProcess, 'execFile', (_file, _args, options, callback) => {
    const child = execute(process.execPath, ['-e', script], options, (...args) => { completed++; callback(...args) })
    children.push(child); return child
  })
  syncBuiltinESMExports()
  try { await run(children, () => completed) }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((resolve) => child.once('close', resolve)) } }
}

test('metadata input is limited to 64KiB UTF-8 before spawning, including Unicode', async (t) => {
  await metadataChild(t, 'process.stdin.resume(); process.stdin.on("end",()=>process.stdout.write("true"))', async (children) => {
    const boundary = 'C:\\' + '界'.repeat(21842) + 'xx'
    assert.equal(Buffer.byteLength(JSON.stringify([boundary])), 65536)
    assert.equal(await windowsPathsArePlain([boundary]), true); assert.equal(children.length, 1)
    assert.equal(await windowsPathsArePlain([boundary + 'x']), false); assert.equal(children.length, 1)
  })
})

test('metadata stdin failure terminates its child and waits for process completion before returning', async (t) => {
  await metadataChild(t, 'setTimeout(()=>{},3000)', async (children, completed) => {
    const result = windowsPathsArePlain(['C:\\fixture'])
    setImmediate(() => children[0].stdin.emit('error', Object.assign(new Error('closed pipe'), { code: 'EPIPE' })))
    assert.equal(await result, false); assert.equal(completed(), 1, 'helper must not settle while its process is alive')
    assert.notEqual(children[0].signalCode, null, 'stdin failure must terminate the child rather than await its normal exit')
  })
})

test('production catalog storage accepts a complete Windows repository path without bypassing schema validation', async (t) => {
  const f = await fixtureFor(t), storage = createSqliteStorage(path.join(f.root, 'schema.sqlite'), hostStoragePolicy(PROVIDER_CATALOG))
  try {
    await storage.putWorkspace({ id: 'windows-schema', name: 'Windows schema', statusPolicy: 'provider_authoritative' })
    await storage.putProviderBinding({ id: BINDING, workspaceId: 'windows-schema', domain: 'development', implementationKey: 'development.local-git', enabled: true, isDefault: true })
    const value = { ref: { workspaceId: 'windows-schema', bindingId: BINDING, domain: 'development' }, configuration: { repositoryExternalId: REPOSITORY_ID, repositoryPath: 'C:\\fixtures\\Repo 空 格' } }
    await storage.putBindingConfiguration(value)
    assert.deepEqual(await storage.getBindingConfiguration(value.ref), value)
  } finally { storage.close() }
})

test('Windows mechanism: native attributes expose ReparsePoint and NTFS identities retain case-sensitive siblings', native, async (t) => {
  const f = await fixture(t), link = path.join(f.root, 'junction')
  await symlink(f.allowedRoot, link, 'junction')
  // 固定脚本，路径只通过 stdin；输出数值属性，不解析本地化命令文本。
  const script = '$ErrorActionPreference="Stop"; $p=([Console]::In.ReadToEnd()|ConvertFrom-Json); $d=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($p[0])); @{attributes=@($p|%{[int][IO.File]::GetAttributes($_)});format=$d.DriveFormat;type=[int]$d.DriveType}|ConvertTo-Json -Compress'
  const metadata = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify([f.allowedRoot, link]), encoding: 'utf8', timeout: 10000, windowsHide: true }))
  assert.deepEqual([metadata.format, metadata.type], ['NTFS', 3])
  assert.equal(metadata.attributes[0] & 1024, 0); assert.equal(metadata.attributes[1] & 1024, 1024)
  const info = await lstat(link, { bigint: true })
  t.diagnostic(JSON.stringify({ node: process.version, git: (await f.run(['--version'])).trim(), symbolicLink: info.isSymbolicLink(), statFields: Object.keys(info), attributes: metadata.attributes }))
  const sensitive = path.join(f.root, 'Sensitive'); await mkdir(sensitive)
  execFileSync('fsutil.exe', ['file', 'SetCaseSensitiveInfo', sensitive, 'enable'], { timeout: 10000, windowsHide: true })
  const upper = path.join(sensitive, 'Allowed'), lower = path.join(sensitive, 'allowed')
  await mkdir(upper); await mkdir(lower)
  const identities = await Promise.all([upper, lower].map((entry) => stat(entry, { bigint: true })))
  assert.notEqual(identities[0].ino, identities[1].ino, 'fixture must contain two actual NTFS objects')
})

test('Windows worktree: Unicode and spaces create, mixed separators read, and existing case aliases reuse one canonical ref', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), port = provider(f, { runGit: recorder.runGit })
  await f.run(['branch', 'work/windows'])
  const target = path.join(f.allowedRoot, 'Task 中文'), created = await port.createWorktree({ repository: repositoryRef, path: target, branch: 'work/windows' })
  assert.equal(created.ok, true, JSON.stringify(created))
  const read = await port.getWorktree({ worktree: ref(alias(target)) })
  assert.equal(read.ok, true, JSON.stringify(read)); assert.equal(read.value.branch, 'work/windows')
  assert.deepEqual(read.value.ref, created.value.ref, 'aliases return the already registered canonical identity')
  assert.equal(read.value.path, created.value.path)
  const mark = recorder.calls.length
  const reused = await port.createWorktree({ repository: repositoryRef, path: alias(target), branch: 'work/windows' })
  assert.equal(reused.error?.code, 'conflict', JSON.stringify(reused))
  assert.equal(recorder.calls.slice(mark).some((args) => args[2] === 'worktree' && args[3] === 'add'), false)
  assert.equal((await f.run(['worktree', 'list', '--porcelain', '-z'])).split('\0').filter((field) => field.startsWith('worktree ')).length, 2)
})

test('Windows admission: ambiguous namespaces and filenames reject before any Git argv', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), drive = path.parse(f.root).root.slice(0, 2)
  const dangerous = [drive + 'relative', '\\root-relative', '/root-relative', '\\\\server\\share\\task', '\\\\?\\' + f.allowedRoot,
    '\\\\.\\' + f.allowedRoot, '\\??\\' + f.allowedRoot, path.join(f.allowedRoot, 'task:stream'), path.join(f.allowedRoot, 'CON.txt'),
    path.join(f.allowedRoot, 'LPT1'), path.join(f.allowedRoot, 'task.'), path.join(f.allowedRoot, 'task '), f.allowedRoot + '\\..\\escape',
    path.join(path.parse(process.cwd()).root, 'outside-allowed-drive')]
  for (const target of dangerous) {
    const result = await provider(f, { runGit: recorder.runGit }).createWorktree({ repository: repositoryRef, path: target, branch: 'work/safe' })
    assert.equal(result.error?.code, 'invalid_input', JSON.stringify({ target, result })); assert.equal(recorder.calls.length, 0, target)
  }
  for (const configuration of [{ repository: { externalId: REPOSITORY_ID, path: drive + 'repo' } }, { allowedRoot: drive + 'worktrees' }, { allowedRoot: '\\\\?\\' + f.allowedRoot }]) {
    const result = await provider(f, { runGit: recorder.runGit, ...configuration }).createWorktree({ repository: repositoryRef, path: path.join(f.allowedRoot, 'Task'), branch: 'work/safe' })
    assert.equal(result.error?.code, 'invalid_input', JSON.stringify(result)); assert.equal(recorder.calls.length, 0)
  }
})

test('Windows admission: junction, dangling junction and a junction root preserve sentinel without Git calls', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), sentinel = path.join(f.allowedRoot, 'sentinel')
  await writeFile(sentinel, 'unchanged')
  const linked = path.join(f.allowedRoot, 'linked'), dangling = path.join(f.allowedRoot, 'dangling')
  await symlink(f.allowedRoot, linked, 'junction'); await symlink(path.join(f.root, 'missing'), dangling, 'junction')
  for (const [root, target] of [[f.allowedRoot, path.join(linked, 'Task')], [f.allowedRoot, path.join(dangling, 'Task')], [linked, path.join(linked, 'Task')]]) {
    const result = await provider(f, { allowedRoot: root, runGit: recorder.runGit }).createWorktree({ repository: repositoryRef, path: target, branch: 'work/safe' })
    assert.equal(result.error?.code, 'invalid_input', JSON.stringify(result)); assert.equal(recorder.calls.length, 0)
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'unchanged')
})

test('Windows containment: case-sensitive sibling is outside the allowed object despite equal-folded path.relative', native, async (t) => {
  const f = await fixture(t), parent = path.join(f.root, 'Sensitive'); await mkdir(parent)
  execFileSync('fsutil.exe', ['file', 'SetCaseSensitiveInfo', parent, 'enable'], { timeout: 10000, windowsHide: true })
  const allowedRoot = path.join(parent, 'Allowed'), sibling = path.join(parent, 'allowed')
  await mkdir(allowedRoot); await mkdir(sibling)
  await writeFile(path.join(sibling, 'sentinel'), 'unchanged')
  const recorder = recordingRunner(), result = await provider(f, { allowedRoot, runGit: recorder.runGit }).createWorktree({ repository: repositoryRef, path: path.join(sibling, 'Task'), branch: 'work/safe' })
  assert.equal(result.error?.code, 'invalid_input', JSON.stringify(result)); assert.equal(recorder.calls.length, 0)
  assert.equal(await readFile(path.join(sibling, 'sentinel'), 'utf8'), 'unchanged')
  execFileSync('fsutil.exe', ['file', 'SetCaseSensitiveInfo', allowedRoot, 'enable'], { timeout: 10000, windowsHide: true })
  const created = []
  for (const [directory, branch] of [[path.join(allowedRoot, 'UpperTask'), 'work/upper'], [path.join(sibling, 'LowerTask'), 'work/lower']]) {
    await f.run(['branch', branch])
    const owner = provider(f, { allowedRoot: path.dirname(directory) })
    const made = await owner.createWorktree({ repository: repositoryRef, path: directory, branch })
    assert.equal(made.ok, true, JSON.stringify(made)); created.push(made.value)
    assert.equal((await owner.getWorktree({ worktree: made.value.ref })).value?.branch, branch)
    if (branch === 'work/upper') {
      const distinct = path.join(allowedRoot, 'uppertask'); await mkdir(distinct)
      const wrong = await owner.getWorktree({ worktree: ref(distinct) })
      assert.equal(wrong.error?.code, 'not_found', 'a distinct equal-folded directory must not read the registered worktree')
    }
  }
  assert.notEqual(created[0].ref.externalId, created[1].ref.externalId, 'two case-sensitive objects retain distinct canonical refs')
})

test('Windows Core/SQLite: lost worktree ack reconciles and reopen with repository aliases performs no second Git write', native, async (t) => {
  let storage, development, loseAck = true
  // Node after hooks 按注册顺序执行，关闭句柄必须先于 fixture 注册的删除。
  t.after(() => storage?.close())
  const f = await fixture(t), file = path.join(f.root, 'workspace.sqlite'), writes = []
  const compose = async (repositoryPath) => {
    storage = createSqliteStorage(file)
    const recorder = recordingRunner()
    development = provider(f, { repository: { externalId: REPOSITORY_ID, path: repositoryPath }, runGit: async (args) => {
      const result = await recorder.runGit(args)
      if (args[2] === 'branch' || (args[2] === 'worktree' && args[3] === 'add')) writes.push(args)
      if (loseAck && args[2] === 'worktree' && args[3] === 'add' && result.code === 0) { loseAck = false; return { code: 128, stdout: '', stderr: 'unknown write result' } }
      return result
    } })
    return composeCore({ workspace: { id: 'windows-durable', name: 'Windows durable' }, storage, providers: { development }, clock: () => FROZEN_NOW })
  }
  const request = { workItemId: 'wi-windows', repositoryId: REPOSITORY_ID, task: 'Synthetic task', actor: { kind: 'agent' } }
  let core = await compose(f.repositoryPath); await registerWorkItem(storage, 'windows-durable', request.workItemId)
  const first = await core.commands.startWork({ ...request, idempotencyKey: 'first' })
  assert.deepEqual([first.status, first.confirmed], ['ready', true], JSON.stringify(first))
  const before = writes.length; storage.close(); storage = undefined
  core = await compose(alias(f.repositoryPath))
  const resumed = await core.commands.startWork({ ...request, idempotencyKey: 'first' })
  assert.deepEqual([resumed.status, resumed.confirmed, resumed.executionContextId, resumed.worktreeExternalId], ['ready', true, first.executionContextId, first.worktreeExternalId], JSON.stringify(resumed))
  const observed = await development.getWorktree({ worktree: ref(alias(first.worktreeExternalId)) })
  assert.equal(observed.ok, true, JSON.stringify(observed)); assert.equal(observed.value.path, first.worktreeExternalId)
  const fresh = await core.commands.startWork({ ...request, idempotencyKey: 'after-reopen' })
  assert.equal(fresh.error?.message, 'existing_execution_task_not_sent', JSON.stringify(fresh))
  assert.equal(writes.length, before); assert.equal(writes.filter((args) => args[2] === 'worktree').length, 1)
  assert.equal(await realpath(resumed.worktreeExternalId), await realpath(path.join(f.allowedRoot, 'wi-windows')))
})

test('Windows production catalog retains its digest root and reads repository through a separator alias', native, async (t) => {
  const f = await fixture(t), worktreesDir = path.join(f.root, 'catalog-worktrees'); await mkdir(worktreesDir)
  const port = await PROVIDER_CATALOG.get('development.local-git').create({ binding: { id: BINDING, workspaceId: 'windows-catalog', domain: 'development', implementationKey: 'development.local-git', enabled: true, isDefault: true }, configuration: { repositoryPath: alias(f.repositoryPath), repositoryExternalId: REPOSITORY_ID }, worktreesDir })
  assert.equal((await port.getRepository(repositoryRef)).ok, true)
  const target = await port.preflightWorktree({ repository: repositoryRef, branch: 'work/catalog', worktreeKey: 'Task' })
  assert.equal(target.ok, true, JSON.stringify(target)); assert.equal(path.dirname(path.dirname(target.value.path)), worktreesDir)
  const rejected = await port.preflightWorktree({ repository: repositoryRef, branch: 'work/catalog', path: path.join(worktreesDir, 'alternate-digest', 'Task') })
  assert.equal(rejected.error?.code, 'invalid_input')
})

test('Windows production binding preflight and Core setup persist one canonical repository through the real schema', native, async (t) => {
  const f = await fixture(t), storage = createSqliteStorage(path.join(f.root, 'binding.sqlite'), hostStoragePolicy(PROVIDER_CATALOG))
  try {
    await seedWorkspace(storage); await storage.putConnectorAccount(account())
    const selected = REPOSITORY_MOUNTS['development.github'][1], owner = selected.repositoryOwner.toLowerCase(), name = selected.repositoryName.toLowerCase()
    const repositoryId = `github.com/${owner}/${name}`, replay = githubFetch()
    const fetch = (url, init) => {
      if (init.body === undefined) return Promise.resolve(new Response(JSON.stringify({ total_count: 0, [url.includes('/actions/runs') ? 'workflow_runs' : url.includes('/check-suites') ? 'check_suites' : 'check_runs']: [] }), { status: 200 }))
      const body = JSON.parse(init.body); body.variables.owner = selected.repositoryOwner
      return replay.fetch(url, { ...init, body: JSON.stringify(body) })
    }
    const references = [{ domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryExternalId: repositoryId, repositoryPath: alias(f.repositoryPath) } },
      ...['development.github', 'github-actions'].map((implementationKey) => ({ domain: implementationKey === 'github-actions' ? 'delivery' : 'development', implementationKey, accountId: ACCOUNT, configuration: { repositoryExternalId: repositoryId, repositoryOwner: owner, repositoryName: name } }))]
    const checked = await preflightRepositoryBinding({ workspaceId: WORKSPACE, actorRef: { kind: 'user' }, idempotencyKey: 'windows-bind', repositoryId, references }, storage, PROVIDER_CATALOG, { sequence: 1, worktreesDir: f.allowedRoot, fetch, resolveCredential: async () => 'fixture-secret' })
    assert.ok('input' in checked, JSON.stringify(checked))
    assert.equal(checked.input.references[0].configuration.repositoryPath, await realpath(f.repositoryPath))
    const setup = createWorkspaceSetup(storage), input = { workspaceId: WORKSPACE, repositoryId, references: checked.input.references }
    const first = await setup.bindRepository(input), second = await setup.bindRepository(input)
    assert.equal(first.ok, true, JSON.stringify(first)); assert.deepEqual(second, first)
    assert.equal((await storage.listRepositories(WORKSPACE)).length, 1); assert.equal((await storage.listProviderBindings(WORKSPACE)).length, 3)
    assert.deepEqual(replay.misses, [])
  } finally { storage.close() }
})

test('Windows lexical admission rejects foreign namespaces, aliases and reserved devices', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    for (const [value, label] of [['C:\\a\\..\\b', '..'], ['C:\\a\\b.', 'trailing dot'], ['C:\\a\\b ', 'trailing space'],
      ['C:\\a\\b:ads', 'ADS'], ['C:\\a\\CONIN$', 'CONIN$'], ['C:\\a\\CONOUT$', 'CONOUT$'],      ['C:foo', 'drive-relative'], ['\\\\server\\share\\x', 'UNC'], ['\\\\?\\C:\\x', 'device namespace']]) {
      assert.notEqual(localGitPathProblem(value, true), undefined, `${label} 必须在 Git 前拒绝`)
    }
    assert.equal(localGitPathProblem('C:\\Repo 空 格\\WorkTrees', true), undefined, '合法 Unicode/空格盘符路径必须通过')
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})

test('Windows repository admission rejects before any Git call when the native metadata probe says unsafe', async (t) => {
  const f = await fixtureFor(t), recorder = recordingRunner()
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const mocked = t.mock.method(childProcess, 'execFile', (_file, _args, _options, callback) => {
    setImmediate(() => callback(null, 'false\n', ''))
    return { stdin: { on() {}, end() {} } }
  })
  syncBuiltinESMExports()
  try {
    const port = providerFor(f, { repository: { externalId: REPOSITORY_ID, path: 'C:\\repo' }, runGit: recorder.runGit })
    const observed = [await port.getRepository(repositoryRef), await port.listBranches({ repository: repositoryRef, limit: 100 }),
      await port.getCommit({ bindingId: BINDING, objectKind: 'commit', externalId: f.headCommit }),
      await port.createBranch({ repository: repositoryRef, name: 'work/probe', fromRef: 'main' })]
    assert.deepEqual(observed.map((result) => result.error?.code), ['invalid_input', 'invalid_input', 'invalid_input', 'invalid_input'])
    assert.equal(recorder.calls.length, 0, '原生探针判定不安全后不得调用任何 Git 命令')
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); Object.defineProperty(process, 'platform', descriptor) }
})
