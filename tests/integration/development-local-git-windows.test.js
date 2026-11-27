/** #645：原生 NTFS/Git for Windows 判别证据；POSIX skip 不计作 Windows 验收。 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import childProcess, { execFileSync, spawnSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { composeCore, createWorkspaceSetup } from '@harness-projects/core'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { windowsPathsArePlain } from '../../packages/providers/development-local-git/src/git-runner.ts'
import { localGitPathProblem } from '../../packages/providers/development-local-git/src/paths.ts'
import { PROVIDER_CATALOG, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { preflightRepositoryBinding } from '../../apps/harness-plugin/src/host-repository-binding.ts'
import { ACCOUNT, WORKSPACE, account, githubFetch, REPOSITORY_MOUNTS, seedWorkspace } from './fixtures/host-seed.js'
import { BINDING, FROZEN_NOW, REPOSITORY_ID, destructiveCall, fixtureFor, git, providerFor, quarantineEntries, recordingRunner, registerWorkItem, repositoryRef, snapshotTree, worktreePaths } from './local-git-fixture.js'

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
    return composeCore({ workspace: { id: 'windows-durable', name: 'Windows durable' }, providers: { development, storage }, clock: () => FROZEN_NOW })
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

// --- #681：显式工作树移除的 Windows 原生资格（9 条，全部 native；前缀 `Windows worktree removal: `）------
// lane 语义：本文件已在 native-git SETS 内，新增用例只抬高 summary.tests；判定是单调下限 tests >= minTests，
// marker 只数文件数与 skip 预算，所以不需要改 SETS/ci.yml/契约（详见 active ExecPlan 与 PR body）。
const sep = String.fromCharCode(92)
/** 所有 helper 子进程都被跟踪：任何用例失败或超时后由 after 兜底 kill，挂起的子进程不得拖住测试进程退出。 */
const helperChildren = []
const trackHelper = (child) => { helperChildren.push(child); return child }
after(() => { for (const child of helperChildren) if (child.exitCode === null && child.signalCode === null) child.kill() })
/** 同步 Git 调用一律带 60s 上限：spawnSync 没有 timeout 时一个挂起会永锁测试进程。 */
const runSync = (file, args, options = {}) => spawnSync(file, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...options })
const diagnose = (t, prefix, fields) => t.diagnostic(prefix + ' ' + JSON.stringify(fields))
const timeLimited = (promise, ms, message) => {
  let timer
  const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}
const readyLine = (child) => new Promise((resolve, reject) => {
  let seen = ''
  child.stdout.on('data', (chunk) => { seen += chunk; if (seen.includes('ready')) resolve() })
  child.once('error', reject)
  child.once('exit', (code) => reject(new Error('helper exited ' + code + ' before ready')))
})
const exitOf = (child) => new Promise((resolve) => child.once('exit', (code) => resolve(code)))
/** 子进程 cwd 持有目录：Windows 上它让父目录 rename 失败（POSIX 不成立，所以只作原生证据）。 */
const holdCwd = async (directory) => {
  const script = 'process.stdout.write("ready");process.stdin.on("data",()=>process.exit(0));process.stdin.resume()'
  const child = trackHelper(childProcess.spawn(process.execPath, ['-e', script], { cwd: directory, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }))
  await timeLimited(readyLine(child), 15000, 'cwd holder did not become ready')
  return { release: async () => { child.stdin.end('release'); await timeLimited(exitOf(child), 30000, 'cwd holder did not exit').catch((error) => { child.kill(); throw error }) } }
}
/** PowerShell 独占句柄（FileShare.None）：让删除真实失败；路径只经 stdin 传入，不解析本地化文本。 */
const holdExclusiveFile = async (file) => {
  const command = '$ErrorActionPreference="Stop";$p=[Console]::In.ReadLine();$s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);[Console]::Out.WriteLine("ready");[Console]::Out.Flush();[Console]::In.ReadLine()|Out-Null;$s.Dispose()'
  const child = trackHelper(childProcess.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }))
  child.stdin.write(file + String.fromCharCode(10))
  await timeLimited(readyLine(child), 30000, 'exclusive handle holder did not become ready')
  return { release: async () => { child.stdin.end('release' + String.fromCharCode(10)); await timeLimited(exitOf(child), 30000, 'exclusive handle holder did not exit').catch((error) => { child.kill(); throw error }) } }
}
let currentSid
/** 当前用户 SID：locale 无关地取数值 SID，用于真实的拒绝 ACE（不写进日志）。 */
const sid = () => currentSid ??= execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value'], { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim()
const denyDelete = (target) => execFileSync('icacls.exe', [target, '/deny', '*' + sid() + ':(D)'], { timeout: 20000, windowsHide: true })
const allowDelete = (target) => execFileSync('icacls.exe', [target, '/remove:d', '*' + sid()], { timeout: 20000, windowsHide: true })
/** 自探针：拿住目录后 rename 必须失败；失败分类只取确定性 errno。 */
const probeRename = async (directory, acquire) => {
  const holder = await acquire(directory)
  try {
    await rename(directory, directory + '-moved')
    await rename(directory + '-moved', directory)
    return { blocked: false }
  } catch (error) {
    return { blocked: ['EPERM', 'EACCES', 'EBUSY'].includes(error.code), code: error.code }
  } finally { await holder.release() }
}
const commitIgnore = async (fixtureValue, patterns) => {
  await writeFile(path.join(fixtureValue.repositoryPath, '.gitignore'), patterns.join(String.fromCharCode(10)))
  await fixtureValue.run(['add', '.gitignore'])
  await fixtureValue.run(['-c', 'commit.gpgsign=false', 'commit', '-m', '忽略测试内容'])
}
const headLockPath = async (target, repositoryPath) => path.resolve(target, (await git(['-C', target, 'rev-parse', '--git-path', 'HEAD'], repositoryPath)).trim())

test('Windows worktree removal: clean explicit removal round trips through isolated rename, repair and readback', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), port = provider(f, { runGit: recorder.runGit })
  const branch = 'work/clean-round-trip', target = path.join(f.allowedRoot, 'Task 干净')
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const rootReal = await realpath(f.allowedRoot), headBefore = (await f.run(['rev-parse', 'refs/heads/' + branch])).trim()
  const anchor = await stat(target, { bigint: true })
  const backendProbe = runSync('git', ['-C', target, 'config', '--local', '--get', 'extensions.refstorage'])
  const backend = backendProbe.status === 1 ? 'files' : backendProbe.stdout.trim() || 'exit-' + backendProbe.status
  const lockPath = await headLockPath(target, f.repositoryPath)
  let anchorMatched
  const observed = provider(f, { runGit: async (args) => {
    if (anchorMatched === undefined && args.includes('repair')) {
      const moved = await stat(args[args.length - 1], { bigint: true })
      anchorMatched = moved.dev === anchor.dev && moved.ino === anchor.ino
    }
    return recorder.runGit(args)
  } })
  const removed = await observed.removeWorktree({ worktree: ref(target) })
  assert.equal(removed.ok, true, JSON.stringify(removed))
  const repair = recorder.calls.find((call) => call.includes('repair'))
  const removal = recorder.calls.find((call) => call.includes('remove'))
  assert.ok(repair !== undefined && removal !== undefined, '必须先 repair 登记再 remove')
  const quarantine = repair[repair.length - 1]
  assert.equal(path.dirname(quarantine), rootReal, '隔离目录的父目录必须是允许根 realpath')
  assert.deepEqual(repair, ['-C', f.repositoryPath, 'worktree', 'repair', quarantine], 'repair 只改登记，目标必须是隔离目录')
  assert.deepEqual(removal, ['-C', f.repositoryPath, 'worktree', 'remove', quarantine], 'remove 目标隔离目录，不得带 force')
  assert.equal(recorder.calls.some((call) => call.includes('--force') || call.includes('-f') || call.includes('move')), false, '不得 force，也不得用 move 作隔离原语')
  assert.equal(anchorMatched, true, '隔离对象的 (dev, ino) 必须与准入对象一致')
  assert.equal(anchor.ino !== 0n, true, '真实文件系统必须提供稳定对象身份')
  assert.deepEqual(await quarantineEntries(f.allowedRoot), [], '成功后不得残留隔离目录')
  await assert.rejects(stat(target), { code: 'ENOENT' }, '目录必须消失')
  assert.equal((await worktreePaths(f)).map(slash).includes(slash(target)), false, '登记必须消失')
  assert.equal((await f.run(['rev-parse', 'refs/heads/' + branch])).trim(), headBefore, '分支头必须保留')
  await assert.rejects(stat(lockPath + '.lock'), { code: 'ENOENT' }, 'HEAD 协调锁不得残留')
  const again = await port.removeWorktree({ worktree: ref(target) })
  assert.equal(again.error?.code, 'not_found', '二次移除只能答 not_found')
  diagnose(t, 'windows-removal-matrix:', { git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(), node: process.version, backend, ino: anchor.ino !== 0n })
})

test('Windows worktree removal: dirty worktree is refused with byte-identical preservation and recorded user paths', native, async (t) => {
  const f = await fixture(t), port = provider(f)
  await commitIgnore(f, ['.env'])
  const branch = 'work/dirty-bytes', target = path.join(f.allowedRoot, 'Task 脏')
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  await writeFile(path.join(target, 'README.md'), '# 修改后的内容')
  await writeFile(path.join(target, 'staged.txt'), 'staged')
  await git(['add', 'staged.txt'], target)
  await writeFile(path.join(target, 'untracked.txt'), 'untracked')
  await writeFile(path.join(target, '.env'), 'SECRET=1')
  // 负控：仓库配置让未跟踪文件从默认 status 消失；脏检查必须显式 --untracked-files=normal 才数得到 3 条。
  await git(['config', 'status.showUntrackedFiles', 'no'], target)
  const before = await snapshotTree(target), headBefore = (await git(['rev-parse', 'HEAD'], target)).trim(), registryBefore = await worktreePaths(f)
  const recorder = recordingRunner()
  const result = await provider(f, { runGit: recorder.runGit }).removeWorktree({ worktree: ref(target) })
  assert.equal(result.ok, false, '脏工作树必须被拒')
  assert.equal(result.error.code, 'invalid_input', '脏树是确定性拒绝，不能是 conflict/ambiguous_result')
  assert.equal(result.error.retryable, false, '脏树必须由用户处理后重新显式请求')
  assert.ok(result.error.message.includes('3 个未提交路径'), result.error.message)
  assert.ok(result.error.message.includes('README.md'), '必须点名一条未提交路径')
  assert.ok(result.error.message.includes('请先提交、stash 或清理'), '必须给出可行动出路')
  assert.deepEqual(await snapshotTree(target), before, '被拒的移除不得改动任何字节（含被忽略内容）')
  assert.deepEqual(await worktreePaths(f), registryBefore, '被拒后登记必须保留')
  assert.equal((await git(['rev-parse', 'HEAD'], target)).trim(), headBefore, '被拒后 HEAD 不得变化')
  assert.equal(recorder.calls.some(destructiveCall), false, '脏树拒绝不得发出破坏性 argv')
})

test('Windows worktree removal: HEAD coordination lock rejects a concurrent detach and leaves no unreachable commit', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), port = provider(f, { runGit: recorder.runGit })
  const branch = 'work/head-lock', target = path.join(f.allowedRoot, 'Task 锁')
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const headBefore = (await f.run(['rev-parse', 'refs/heads/' + branch])).trim(), lockPath = await headLockPath(target, f.repositoryPath)
  let lockText, detachCode, detachStderr = '', commitCode, injected = false
  const racing = provider(f, { runGit: async (args) => {
    // 注入点 = 干净门的 status：锁已在手，真实 Git 尝试切 detached 并产生独有提交。
    if (!injected && args.includes('status')) {
      injected = true
      lockText = await readFile(lockPath + '.lock', 'utf8')
      const detach = runSync('git', ['checkout', '--detach'], { cwd: target })
      detachCode = detach.status
      detachStderr = detach.stderr ?? ''
      if (detach.status === 0) commitCode = runSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '竞态独有提交'], { cwd: target }).status
    }
    return recorder.runGit(args)
  } })
  const removed = await racing.removeWorktree({ worktree: ref(target) })
  assert.ok(lockText !== undefined && lockText.includes('harness worktree removal ' + process.pid + ' '), '锁内注入点必须看到本进程持有的 HEAD.lock 内容')
  assert.notEqual(detachCode, 0, 'HEAD 协调锁必须让注入的 checkout --detach 失败')
  assert.match(detachStderr, /HEAD/, 'Git 必须报告 HEAD 引用锁冲突：' + detachStderr)
  assert.match(detachStderr, /lock/i, 'Git 必须报告引用锁冲突：' + detachStderr)
  assert.equal(commitCode, undefined, 'detach 被拒后不得再产生独有提交')
  assert.equal(removed.ok, true, JSON.stringify(removed))
  assert.equal((await f.run(['rev-parse', 'refs/heads/' + branch])).trim(), headBefore, '分支头不得变化')
  assert.equal((await f.run(['fsck', '--unreachable', '--no-reflogs'])).trim(), '', '不得留下不可达提交')
  await assert.rejects(stat(lockPath + '.lock'), { code: 'ENOENT' }, '成功 remove 后协调锁不得残留')
})

test('Windows worktree removal: same-gitfile substitute is refused by real object identity without deleting content', native, async (t) => {
  const f = await fixture(t), port = provider(f)
  await commitIgnore(f, ['.env'])
  const branch = 'work/substitute', target = path.join(f.allowedRoot, 'Task 替身'), movedReal = path.join(f.allowedRoot, 'Task 替身 real')
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const recorder = recordingRunner()
  let substituteBefore, realBefore, swapped = false
  const racing = provider(f, { runGit: async (args) => {
    // 注入点 = 干净门的 status：锚已取，这是删除前最后一次只读 Git 读；复制 .git gitfile 后 Git 会把替身当同一登记。
    if (!swapped && args.includes('status')) {
      swapped = true
      await rename(target, movedReal)
      await cp(movedReal, target, { recursive: true })
      await writeFile(path.join(target, '.env'), 'SECRET=1')
      substituteBefore = await snapshotTree(target)
      realBefore = await snapshotTree(movedReal)
    }
    return recorder.runGit(args)
  } })
  const result = await racing.removeWorktree({ worktree: ref(target) })
  assert.equal(result.ok, false, '准入后被换成同 gitfile 替身时必须拒绝')
  assert.equal(result.error.code, 'invalid_input', '对象复核不符是确定性拒绝')
  assert.equal(result.error.retryable, false)
  assert.ok(result.error.message.includes('对象被替换') || result.error.message.includes('已回滚'), result.error.message)
  assert.deepEqual(await snapshotTree(target), substituteBefore, '回滚后的替身必须逐字节不变')
  assert.deepEqual(await snapshotTree(movedReal), realBefore, '被移走的准入对象必须完整')
  assert.equal((await worktreePaths(f)).map(slash).includes(slash(target)), true, '登记必须仍指向 target')
  assert.deepEqual(await quarantineEntries(f.allowedRoot), [], '不得留下隔离目录')
  assert.equal(recorder.calls.some(destructiveCall), false, '零破坏性 argv')
})

test('Windows worktree removal: outside-root, namespace, ADS, trailing-space and junction escapes refuse before any Git argv', native, async (t) => {
  const f = await fixture(t)
  const outside = path.join(f.root, 'outside'), junction = path.join(f.allowedRoot, 'escape')
  await mkdir(outside)
  const sentinel = path.join(outside, 'sentinel'); await writeFile(sentinel, 'unchanged')
  await symlink(outside, junction, 'junction')
  const cases = [
    { what: 'outside allowed root', target: path.join(outside, 'Task') },
    { what: 'parent segment', target: f.allowedRoot + sep + '..' + sep + 'outside' + sep + 'Task' },
    { what: 'UNC', target: sep + sep + 'server' + sep + 'share' + sep + 'task' },
    { what: 'device namespace', target: sep + sep + '?' + sep + f.allowedRoot },
    { what: 'ADS', target: path.join(f.allowedRoot, 'task:stream') },
    { what: 'trailing space', target: path.join(f.allowedRoot, 'task ') },
    { what: 'junction escape', target: path.join(junction, 'Task') },
    { what: 'junction allowed root', target: path.join(f.allowedRoot, 'Task'), root: junction },
  ]
  for (const item of cases) {
    const recorder = recordingRunner()
    const result = await provider(f, { runGit: recorder.runGit, ...(item.root === undefined ? {} : { allowedRoot: item.root }) }).removeWorktree({ worktree: ref(item.target) })
    assert.deepEqual(recorder.calls, [], item.what + ' 必须在任何 Git 命令之前被拒')
    assert.equal(result.error?.code, 'invalid_input', JSON.stringify({ what: item.what, error: result.error }))
    assert.equal(result.error.retryable, false, item.what + ' 是输入错误，原样重发没有意义')
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'unchanged', '允许根外的哨兵不得被触碰')
})

test('Windows worktree removal: capability, foreign binding, main checkout, foreign repository and detached all refuse without destructive argv', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), port = provider(f, { runGit: recorder.runGit })
  const branch = 'work/not-removable', target = path.join(f.allowedRoot, 'Task 不可移除')
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const offRecorder = recordingRunner()
  const off = await provider(f, { runGit: offRecorder.runGit, capabilities: { worktreeRemove: false } }).removeWorktree({ worktree: { ...ref(target), bindingId: BINDING + '-foreign' } })
  assert.equal(off.error?.code, 'not_supported', '能力先于身份：关闭能力 + 外来 ref 仍是 not_supported')
  assert.equal(off.error.retryable, false)
  assert.deepEqual(offRecorder.calls, [], '被拒的能力不得触发任何 Git 命令')
  const foreign = await port.removeWorktree({ worktree: { ...ref(target), bindingId: BINDING + '-foreign' } })
  assert.equal(foreign.error?.code, 'not_found', '外来 binding 不可见')
  const mainCheckout = await provider(f, { runGit: recorder.runGit, allowedRoot: f.root }).removeWorktree({ worktree: ref(f.repositoryPath) })
  assert.equal(mainCheckout.error?.code, 'invalid_input')
  assert.ok(mainCheckout.error.message.includes('主检出'), mainCheckout.error.message)
  await rm(target, { recursive: true, force: true })
  await mkdir(target)
  await git(['init', '-b', 'other'], target)
  await git(['config', 'user.email', 'other@example.invalid'], target)
  await git(['config', 'user.name', 'Other Repo'], target)
  await git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', '独立仓库的提交'], target)
  const replaced = await port.removeWorktree({ worktree: ref(target) })
  assert.equal(replaced.error?.code, 'invalid_input', '登记路径被换成独立仓库时不得按账本删除')
  assert.ok(replaced.error.message.includes('不是本仓库的工作树'), replaced.error.message)
  const detachedBranch = 'work/detached', detachedTarget = path.join(f.allowedRoot, 'Task detached')
  assert.equal((await provider(f).createBranch({ repository: repositoryRef, name: detachedBranch, fromRef: 'main' })).ok, true)
  assert.equal((await provider(f).createWorktree({ repository: repositoryRef, path: detachedTarget, branch: detachedBranch })).ok, true)
  await git(['checkout', '--detach'], detachedTarget)
  const detached = await port.removeWorktree({ worktree: ref(detachedTarget) })
  assert.equal(detached.error?.code, 'invalid_input', 'detached 可能承载未引用提交，不得移除')
  assert.ok(detached.error.message.includes('没有检出分支'), detached.error.message)
  assert.equal(recorder.calls.some(destructiveCall), false, '所有不可移除形态都不得发出破坏性 argv')
  assert.equal((await worktreePaths(f)).map(slash).includes(slash(target)), true, '被换目录的原登记不得被静默清理')
})

test('Windows worktree removal: live cwd blocks isolated rename, provably deletes nothing, and succeeds after release', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner(), port = provider(f, { runGit: recorder.runGit })
  const branch = 'work/live-cwd', target = path.join(f.allowedRoot, 'Task live cwd')
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  const probeDirectory = path.join(f.allowedRoot, 'probe-rename'); await mkdir(probeDirectory)
  const cwdProbe = await probeRename(probeDirectory, holdCwd)
  let release, mechanism
  if (cwdProbe.blocked) {
    mechanism = 'cwd-holder'
    release = (await holdCwd(target)).release
  } else {
    const aclProbe = await probeRename(probeDirectory, async (directory) => { denyDelete(directory); return { release: async () => allowDelete(directory) } })
    assert.equal(aclProbe.blocked, true, 'windows-removal-mechanism: no real rename blocker (cwd=' + cwdProbe.code + ' acl=' + aclProbe.code + ')')
    mechanism = 'acl-deny-delete'
    denyDelete(target)
    release = async () => allowDelete(target)
  }
  const before = await snapshotTree(target), registryBefore = await worktreePaths(f)
  const headBefore = (await f.run(['rev-parse', 'refs/heads/' + branch])).trim(), lockPath = await headLockPath(target, f.repositoryPath)
  try {
    const blockedResult = await port.removeWorktree({ worktree: ref(target) })
    assert.equal(blockedResult.ok, false, '被真实目录句柄/拒绝 ACE 挡住时不得报成功')
    assert.ok(['permission_denied', 'unavailable'].includes(blockedResult.error.code), JSON.stringify(blockedResult.error))
    assert.ok(blockedResult.error.message.includes('可证未做任何删除'), '原子 rename 失败必须被声明为零副作用：' + blockedResult.error.message)
    assert.deepEqual(await snapshotTree(target), before, '失败路径不得改动工作树任何字节')
    assert.deepEqual(await worktreePaths(f), registryBefore, '失败路径不得改动登记')
    assert.equal((await f.run(['rev-parse', 'refs/heads/' + branch])).trim(), headBefore, '分支头不得变化')
    assert.deepEqual(await quarantineEntries(f.allowedRoot), [], '不得留下隔离目录')
    assert.equal(recorder.calls.some(destructiveCall), false, 'rename 之前不得发出破坏性 argv')
    await assert.rejects(stat(lockPath + '.lock'), { code: 'ENOENT' }, '协调锁必须在 finally 释放')
  } finally { await release() }
  const removed = await port.removeWorktree({ worktree: ref(target) })
  assert.equal(removed.ok, true, JSON.stringify(removed))
  await assert.rejects(stat(target), { code: 'ENOENT' })
  assert.deepEqual(await quarantineEntries(f.allowedRoot), [])
  diagnose(t, 'windows-removal-mechanism:', { mechanism, renameBlocked: true, zeroWrite: true })
})

test('Windows worktree removal: live handle inside quarantine keeps partial deletion honest and recoverable', native, async (t) => {
  const f = await fixture(t), recorder = recordingRunner()
  const branch = 'work/partial', target = path.join(f.allowedRoot, 'Task 部分删除'), keepFile = path.join(target, 'sub', 'keep.bin')
  // 故障必须允许“隔离 rename 成功、清理失败”。hosted 校准（run 45964019955）证明 icacls deny-DELETE 对
  // Git for Windows 的 worktree 清理无效：Node 侧 rm 被 EPERM 拒绝，但 git worktree remove 仍删掉整个隔离
  // 目录并让 provider 报成功。因此改用真实共享冲突：在 provider 调用 git worktree remove 之前，用独占句柄
  // 打开隔离目录内的文件，让清理真实失败、保留字节并要求 reconcile。
  await commitIgnore(f, ['keep.bin'])
  let holder
  const port = provider(f, { runGit: async (args) => {
    if (holder === undefined && args[2] === 'worktree' && args[3] === 'remove') {
      holder = await holdExclusiveFile(path.join(args[args.length - 1], 'sub', 'keep.bin'))
    }
    return recorder.runGit(args)
  } })
  assert.equal((await port.createBranch({ repository: repositoryRef, name: branch, fromRef: 'main' })).ok, true)
  assert.equal((await port.createWorktree({ repository: repositoryRef, path: target, branch })).ok, true)
  await mkdir(path.join(target, 'sub'))
  await writeFile(keepFile, 'locked-bytes')
  const keepBytes = await readFile(keepFile, 'utf8')
  const headProbe = runSync('git', ['-C', target, 'rev-parse', 'refs/heads/' + branch])
  assert.equal(headProbe.status, 0, '读取分支头失败：' + (headProbe.stderr ?? '').trim())
  const headBefore = headProbe.stdout.trim()
  const headPathProbe = runSync('git', ['-C', target, 'rev-parse', '--git-path', 'HEAD'])
  assert.equal(headPathProbe.status, 0, '读取 HEAD 协调锁路径失败：' + (headPathProbe.stderr ?? '').trim())
  const lockPath = path.resolve(target, headPathProbe.stdout.trim())
  let result
  try {
    result = await port.removeWorktree({ worktree: ref(target) })
  } finally {
    if (holder !== undefined) await holder.release()
  }
  console.error('DIAG t8 result=' + JSON.stringify(result))
  console.error('DIAG t8 quarantine=' + JSON.stringify(await quarantineEntries(f.allowedRoot)))
  console.error('DIAG t8 targetExists=' + await stat(target).then(() => true, () => false))
  assert.equal(result.ok, false, '部分删除绝不能报成功')
  assert.equal(result.error.code, 'ambiguous_result', JSON.stringify(result.error))
  assert.equal(result.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
  const [quarantineName] = await quarantineEntries(f.allowedRoot)
  assert.ok(quarantineName !== undefined, '隔离目录必须仍在允许根下')
  const quarantine = path.join(f.allowedRoot, quarantineName)
  assert.ok(result.error.message.includes(quarantine), 'message 必须包含完整隔离路径')
  assert.ok(result.error.message.includes(target), 'message 必须包含原目标路径')
  assert.ok(result.error.message.includes(branch), 'message 必须包含分支名')
  assert.ok(result.error.message.includes('隔离目录仍在'), result.error.message)
  assert.ok(result.error.message.includes('reconcile'), 'message 必须要求 reconcile')
  assert.ok(result.error.message.includes('恢复'), 'message 必须给出恢复步骤')
  assert.equal(await readFile(path.join(quarantine, 'sub', 'keep.bin'), 'utf8'), keepBytes, '被锁文件字节必须不变')
  const registry = (await worktreePaths(f)).map(slash), atQuarantine = registry.includes(slash(quarantine))
  assert.ok(result.error.message.includes(atQuarantine ? '登记仍指隔离目录或原目标' : '登记已不含隔离目录与原目标'), 'message 的登记读数必须与独立回读一致：' + result.error.message)
  assert.equal((await f.run(['rev-parse', 'refs/heads/' + branch])).trim(), headBefore, '分支头全程不变')
  await assert.rejects(stat(lockPath + '.lock'), { code: 'ENOENT' }, '协调锁必须释放')
  await rm(quarantine, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  await f.run(['worktree', 'prune'])
  await f.run(['worktree', 'add', target, branch])
  assert.equal((await port.getWorktree({ worktree: ref(target) })).ok, true, '恢复后必须能读回工作树')
  assert.equal((await port.removeWorktree({ worktree: ref(target) })).ok, true, '恢复后必须能正常移除')
  await assert.rejects(stat(target), { code: 'ENOENT' })
  diagnose(t, 'windows-removal-recovery:', { mechanism: 'live-handle-in-quarantine', registration: atQuarantine ? 'quarantine' : 'none', restored: true })
  diagnose(t, 'windows-removal-mechanism:', { mechanism: 'live-handle-in-quarantine', deleteBlocked: true, cleanupFailed: true })
})

test('Windows worktree removal: records Git version and reference backend, and refuses reftable removal fail closed', native, async (t) => {
  const versionText = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()
  const parsed = versionText.match(/([0-9]+)\.([0-9]+)/)
  assert.ok(parsed !== null, 'git --version 必须可解析：' + versionText)
  const major = Number(parsed[1]), minor = Number(parsed[2])
  assert.ok(major > 2 || (major === 2 && minor >= 30), 'worktree repair 需要 Git >= 2.30，实际 ' + versionText)
  const f = await fixtureFor(t)
  const filesProbe = runSync('git', ['-C', f.repositoryPath, 'config', '--local', '--get', 'extensions.refstorage'])
  assert.equal(filesProbe.status, 1, 'files 后端不得声明 extensions.refstorage')
  assert.equal(filesProbe.stdout.trim(), '')
  diagnose(t, 'windows-removal-matrix:', { git: versionText, node: process.version, backend: 'files' })
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'windows-reftable-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const repositoryPath = path.join(root, 'repo'); await mkdir(repositoryPath)
  const init = runSync('git', ['init', '--ref-format=reftable', '-b', 'main'], { cwd: repositoryPath })
  if (init.status !== 0) {
    diagnose(t, 'windows-removal-matrix:', { git: versionText, node: process.version, backend: 'reftable=init-unavailable' })
    return
  }
  const reftableRun = (args) => git(args, repositoryPath)
  await reftableRun(['config', 'user.email', 'local-git@example.invalid'])
  await reftableRun(['config', 'user.name', 'Local Git Windows Test'])
  await writeFile(path.join(repositoryPath, 'README.md'), '# reftable fixture')
  await reftableRun(['add', 'README.md'])
  await reftableRun(['-c', 'commit.gpgsign=false', 'commit', '-m', '初始提交'])
  const target = path.join(root, 'wt-reftable')
  await reftableRun(['branch', 'work/reftable'])
  const added = runSync('git', ['worktree', 'add', target, 'work/reftable'], { cwd: repositoryPath })
  if (added.status !== 0) {
    const format = runSync('git', ['-C', repositoryPath, 'rev-parse', '--show-ref-format'])
    assert.equal(format.stdout.trim(), 'reftable', 'reftable 仓库必须报告 reftable 引用后端')
    diagnose(t, 'windows-removal-matrix:', { git: versionText, node: process.version, backend: 'reftable=worktree-unavailable' })
    return
  }
  const reftableFixture = { root, repositoryPath, headCommit: '' }
  const before = await snapshotTree(target), registeredBefore = await worktreePaths(reftableFixture)
  const recorder = recordingRunner()
  const result = await providerFor(reftableFixture, { runGit: recorder.runGit }).removeWorktree({ worktree: ref(target) })
  assert.equal(result.ok, false, 'reftable 后端上的破坏性移除必须拒绝')
  assert.equal(result.error.code, 'not_supported', 'HEAD 协调锁只在 files 后端成立，必须 fail closed')
  assert.equal(result.error.retryable, false)
  assert.ok(result.error.message.includes('reftable'), '必须说明是引用后端限制')
  assert.ok(result.error.message.includes('git worktree remove'), '必须给人工移除出路')
  assert.deepEqual(await snapshotTree(target), before, '被拒的工作树必须逐字节不变')
  assert.deepEqual(await worktreePaths(reftableFixture), registeredBefore, '被拒后登记必须不变')
  assert.equal(recorder.calls.some(destructiveCall), false, '拒绝必须发生在任何破坏性 argv 之前')
  assert.deepEqual(await quarantineEntries(root), [], '不得留下隔离目录')
  diagnose(t, 'windows-removal-matrix:', { git: versionText, node: process.version, backend: 'reftable' })
})
