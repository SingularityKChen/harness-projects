import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import childProcess from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { apply } from '../../apps/harness-plugin/src/host.ts'
import { prepareWindowsProjectData } from '../../apps/harness-plugin/src/host-private-windows.ts'
import { preparePrivateWorktreeDirectories } from '../../apps/harness-plugin/src/host-private-data.ts'
import path from 'node:path'
import { seed, seedWorkspace } from './fixtures/host-seed.js'
import { corrupt, denied, hostFixture, inspectAcl, ordinaryToken, positiveHost, ps, setAcl, sqliteProbe, trustedAcl, windowsFixture } from './harness-plugin-windows-fixture.js'

test('native Windows fixture loads system 5.1 cmdlets despite an inherited incompatible module path', { skip: process.platform !== 'win32' }, async () => {
  const key = Object.keys(process.env).find((key) => key.toUpperCase() === 'PSMODULEPATH') ?? 'PSModulePath', previous = process.env[key]
  try {
    process.env[key] = path.join(os.tmpdir(), 'incompatible-powershell-modules')
    assert.equal(ps(String.raw`
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'engine_origin'}
$types=@{'Set-Acl'='SetAclCommand';'Get-Acl'='GetAclCommand';'ConvertFrom-Json'='ConvertFromJsonCommand';'ConvertTo-Json'='ConvertToJsonCommand'}
foreach($name in @('Set-Acl','Get-Acl','ConvertFrom-Json','ConvertTo-Json')) {
  $command=Get-Command $name -ErrorAction Stop
  if($command.CommandType -ne 'Cmdlet' -or $command.ImplementingType.FullName -cne ('Microsoft.PowerShell.Commands.'+$types[$name])){throw 'cmdlet_origin'}
  $assembly=$command.ImplementingType.Assembly
  $token=[BitConverter]::ToString($assembly.GetName().GetPublicKeyToken()).Replace('-','').ToLowerInvariant()
  if($token -cne '31bf3856ad364e35' -or !$assembly.Location.StartsWith([Environment]::GetFolderPath('Windows')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'assembly_origin'}
}
[Console]::Write('system-51-cmdlets-v1')
`), 'system-51-cmdlets-v1')
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous }
})

// Batch 0 事实门：真实 launcher 只普通 mkdir profile 链，插件必须只接纳、不创建也不改写它。
test('native launcher-shaped plain-mkdir profile chain is admitted by the secured-root contract', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true, provisioned: true })
  t.diagnostic(JSON.stringify({ launcherProfile: inspectAcl(f.profile), launcherAncestor: inspectAcl(f.ancestor) }))
  const lease = await prepareWindowsProjectData(f.profile)
  try { assert.equal(lease.signal.aborted, false) } finally { fs.closeSync(lease.logFd); await lease.dispose() }
})

// Batch 1：fresh 创建必须在创建调用内得到目标描述符，之后才由 Open 复核；无「先宽后 chmod」窗口。
test('native fresh profile creates the private data boundary inside the creating call', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true, provisioned: false })
  const lease = await prepareWindowsProjectData(f.profile)
  try {
    assert.equal(lease.signal.aborted, false)
    assert.deepEqual([fs.existsSync(f.root), fs.existsSync(f.dataPath), fs.existsSync(f.log)], [true, true, true], 'fresh prepare 必须建立 root/db/log')
    for (const location of [f.root, f.dataPath, f.log]) {
      const entry = trustedAcl(inspectAcl(location), f.token.sid)
      assert.deepEqual([entry.ownerSid, entry.protected, entry.aces.every(({ inherited }) => !inherited)], [f.token.sid, true, true], `${location} 必须在创建调用内即为 owner=self、protected、无继承 ACE`)
    }
    const self = (entry) => entry.aces.find(({ sid }) => sid === f.token.sid)
    assert.deepEqual([self(inspectAcl(f.root)).flags, self(inspectAcl(f.root)).rights], [3, 2032127], 'root 必须给当前 SID OI/CI full 继承')
    assert.deepEqual([self(inspectAcl(f.dataPath)).flags, self(inspectAcl(f.dataPath)).rights], [0, 2032127], '固定文件只给当前 SID full，不带继承标记')
    assert.deepEqual([fs.statSync(f.dataPath).size, fs.statSync(f.log).size], [0, 0], '边界先于内容：helper 不写任何字节')
  } finally { fs.closeSync(lease.logFd); await lease.dispose() }
})

// Batch 1：完全 canonical 的既有对象只被 adopt；SDDL 与字节逐字不变，重开仍接纳。
test('native Windows adoption leaves the canonical data shape untouched across leases', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true, provisioned: false })
  const record = async () => ({ root: inspectAcl(f.root), db: inspectAcl(f.dataPath), log: inspectAcl(f.log), bytes: [await readFile(f.dataPath), await readFile(f.log)] })
  let lease = await prepareWindowsProjectData(f.profile)
  const before = await record()
  fs.closeSync(lease.logFd); await lease.dispose()
  lease = await prepareWindowsProjectData(f.profile)
  try {
    const after = await record()
    for (const key of ['root', 'db', 'log']) assert.equal(after[key].sddl, before[key].sddl, `${key} 的 DACL 不能被 adopt 路径改写`)
    assert.deepEqual([after.bytes[0].equals(before.bytes[0]), after.bytes[1].equals(before.bytes[1])], [true, true], 'adopt 不能截断/改写既有内容')
  } finally { fs.closeSync(lease.logFd); await lease.dispose() }
  const reopened = await prepareWindowsProjectData(f.profile)
  try { assert.equal(reopened.signal.aborted, false) } finally { fs.closeSync(reopened.logFd); await reopened.dispose() }
})

// Batch 1：真实 Host 在空 profile 上首启（建库迁移、零工作区），退出后追加日志再重开。
test('native fresh Windows Host creates, migrates and reopens its private data root', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true, provisioned: false })
  let host = await hostFixture(apply, f)
  try {
    const service = host.services.get('harnessProjects')
    assert.equal((await service.getWorkspaceSetup()).workspace, null, '干净数据根：零工作区')
    assert.equal((await service.baseline()).workspace, undefined, '干净数据根：baseline 无工作区')
    const db = new DatabaseSync(f.dataPath, { readOnly: true })
    try { assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2, 3, 4, 5, 6, 7], '首启必须完成迁移 1–7') } finally { db.close() }
    for (const location of [f.root, f.dataPath, f.log]) {
      const entry = trustedAcl(inspectAcl(location), f.token.sid)
      assert.deepEqual([entry.ownerSid, entry.protected], [f.token.sid, true], `${location} 在 Host 首启后仍是私有边界`)
    }
  } finally { await host.dispose(); host = undefined }
  fs.appendFileSync(f.log, 'fresh host resume sentinel\n')
  host = await hostFixture(apply, f)
  try {
    assert.equal((await host.services.get('harnessProjects').baseline()).workspace, undefined, '重开同一空库仍零工作区')
    assert.ok((await readFile(f.log, 'utf8')).startsWith('fresh host resume sentinel\n'), '重开必须保留既有日志字节')
    const reopened = new DatabaseSync(f.dataPath, { readOnly: true })
    try { assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 7, '重开不能重放/截断迁移') } finally { reopened.close() }
  } finally { await host.dispose() }
})

// Batch 1：部分状态（root canonical、db 或 log 缺失）只补建缺失对象，存活对象字节不变。
test('native partial private data resumes by creating only the missing objects', { skip: process.platform !== 'win32' }, async (t) => {
  for (const kind of ['missing-db', 'missing-log']) await t.test(kind, async (t) => {
    const f = await windowsFixture(t, { launcherProfile: true, provisioned: true })
    const database = await readFile(f.dataPath), log = await readFile(f.log)
    await rm(kind === 'missing-db' ? f.dataPath : f.log)
    const lease = await prepareWindowsProjectData(f.profile)
    try {
      assert.deepEqual([fs.existsSync(f.dataPath), fs.existsSync(f.log)], [true, true], '缺失对象必须被补建')
      if (kind === 'missing-db') { assert.equal(fs.statSync(f.dataPath).size, 0, '补建的库在 SQLite 初始化前是空文件'); assert.deepEqual(await readFile(f.log), log, '存活的日志字节不变') }
      else { assert.deepEqual(await readFile(f.dataPath), database, '存活的数据库字节不变'); assert.equal(fs.statSync(f.log).size, 0, '补建的日志在 Host 写入前是空文件') }
    } finally { fs.closeSync(lease.logFd); await lease.dispose() }
  })
})

// Synthetic protocol/lifetime evidence only; native timing and ACL evidence are separate below.
const silentLease = "let ready=false;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{if(line==='close')process.exit();if(!ready){ready=true;process.stdout.write('private-windows-v1\\r\\n')}}).on('close',()=>process.exit())"
async function syntheticLease(t, script, run, { cancelOnSpawn = false } = {}) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'windows-protocol-')), spawn = childProcess.spawn
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), system = process.env.SystemRoot, owner = new AbortController()
  await mkdir(path.join(profile, 'harness-projects')); await writeFile(path.join(profile, 'harness-projects', 'diagnostics.log'), '')
  t.after(() => rm(profile, { recursive: true, force: true }))
  let lease, child
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' }); process.env.SystemRoot = 'C:\\Windows'
    childProcess.spawn = () => {
      child = spawn(script === null ? path.join(profile, 'missing.exe') : process.execPath, script === null ? [] : ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
      if (cancelOnSpawn) setImmediate(() => owner.abort(new Error('private path canary')))
      return child
    }
    lease = await prepareWindowsProjectData(profile, owner.signal); fs.closeSync(lease.logFd)
    await run(lease, owner, child)
  } finally {
    t.mock.timers.reset(); await lease?.dispose(); childProcess.spawn = spawn; Object.defineProperty(process, 'platform', platform)
    if (!lease && child?.pid) assert.ok(child.exitCode !== null || child.signalCode !== null, 'failed acquisition must wait for helper close')
    if (system === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = system
  }
}
test('synthetic Windows protocol refuses a second ready after admission', async (t) => {
  await syntheticLease(t, "process.stdin.once('data',()=>{process.stdout.write('private-windows-v1\\r\\n');setTimeout(()=>process.stdout.write('private-windows-v1\\r\\n'),30)});process.stdin.on('end',()=>process.exit())", async (lease) => {
    const invalidated = await Promise.race([new Promise((resolve) => lease.signal.addEventListener('abort', () => resolve(true), { once: true })), new Promise((resolve) => setTimeout(() => resolve(false), 500))])
    assert.equal(invalidated, true)
  })
})
test('synthetic repeated legal directory responses each receive their own bounded output budget', async (t) => {
  const script = "let ready=false;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{if(line==='close')process.exit();process.stdout.write(ready?'private-windows-added-v1\\r\\n':'private-windows-v1\\r\\n');ready=true}).on('close',()=>process.exit())"
  await syntheticLease(t, script, async (lease) => {
    for (let i = 0; i < 200; i++) await lease.assertDirectories(['worktrees', 'digest'])
    assert.equal(lease.signal.aborted, false)
  })
})
test('synthetic disposal rejects a pending directory request without reporting authority loss', async (t) => {
  await syntheticLease(t, silentLease, async (lease) => {
    let state = 'pending'; lease.assertDirectories(['worktrees', 'digest']).catch(() => { state = 'rejected' })
    await lease.dispose(); await new Promise(setImmediate)
    assert.deepEqual([state, lease.signal.aborted], ['rejected', false])
  })
})
test('synthetic normal owner stop retains an admitted lease until its final release', async (t) => {
  await syntheticLease(t, silentLease, async (lease, owner, child) => {
    owner.abort(); await new Promise(setImmediate)
    assert.deepEqual([lease.signal.aborted, child.killed], [false, false])
  })
})
test('synthetic directory requests enforce their 15 second response deadline', async (t) => {
  await syntheticLease(t, silentLease, async (lease) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let state = 'pending'; lease.assertDirectories(['worktrees', 'digest']).catch(() => { state = 'rejected' })
    t.mock.timers.tick(15000); await new Promise(setImmediate)
    assert.deepEqual([state, lease.signal.aborted], ['rejected', true])
  })
})
test('synthetic protocol rejects startup failure, unknown output, overflow and stderr without leaking raw text', async (t) => {
  for (const script of [null, 'process.exit(7)', "process.stdout.write('unknown\\r\\n');process.stdin.resume()",
    "process.stdout.write('x'.repeat(5000));process.stdin.resume()", "process.stderr.write('private path canary');process.stdin.resume()"])
    await assert.rejects(() => syntheticLease(t, script, () => assert.fail('invalid helper cannot admit')), denied)
})
test('synthetic owner cancellation during startup rejects safely after the helper closes', async (t) => {
  await assert.rejects(() => syntheticLease(t, 'process.stdin.resume()', () => assert.fail('cancelled helper cannot admit'), { cancelOnSpawn: true }), denied)
})
test('synthetic cancelling a directory request rejects it and invalidates authority without releasing directories early', async (t) => {
  await syntheticLease(t, silentLease, async (lease, _owner, child) => {
    const request = new AbortController(), pending = lease.assertDirectories(['worktrees', 'digest'], request.signal)
    request.abort(); await assert.rejects(pending, denied)
    assert.deepEqual([lease.signal.aborted, child.killed], [true, false])
  })
})

test('synthetic helper death withdraws actual Host services and remote registrations', async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'windows-host-lifetime-')), root = path.join(profile, 'harness-projects')
  t.after(() => rm(profile, { recursive: true, force: true }))
  await seed(path.join(root, 'workspace.sqlite'), new Map(), seedWorkspace); await writeFile(path.join(root, 'diagnostics.log'), '')
  t.mock.property(process, 'platform', 'win32'); t.mock.property(process, 'env', { ...process.env, SystemRoot: 'C:\\Windows' })
  const spawn = childProcess.spawn
  let child, host
  t.mock.method(childProcess, 'spawn', () => child = spawn(process.execPath, ['-e', silentLease], { stdio: ['pipe', 'pipe', 'pipe'] }))
  try {
    host = await hostFixture(apply, { profile }); child.kill()
    const end = Date.now() + 1000
    while (host.services.size && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual([host.services.size, host.live.size], [0, 0])
  } finally { await host?.dispose(); child?.kill() }
})

test('synthetic lease dispose kills a helper that ignores close within its deadline', async (t) => {
  const script = "process.stdout.write('private-windows-v1\\r\\n');process.stdin.resume();process.stdin.on('data',()=>{});setInterval(()=>{},1000)"
  await syntheticLease(t, script, async (lease, _owner, child) => {
    const started = Date.now()
    await lease.dispose(Date.now() + 300)
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 200 && elapsed < 3000, `dispose 必须在 deadline 附近结算，实际 ${elapsed}ms`)
    assert.ok(child.signalCode !== null || child.exitCode !== null, '忽略 close 的 helper 必须被 deadline kill')
  })
})

test('native Windows path admission rejects ambiguous, foreign and substituted namespaces', { skip: process.platform !== 'win32' }, async (t) => {
  for (const profile of ['\\\\server\\share\\x', '\\\\?\\C:\\x', 'C:\\a\\..\\b', 'C:\\a\\b.', 'C:\\a\\b ',
    'C:\\a\\b:ads', 'C:\\a\\PROGRA~1', 'C:foo', 'relative\\path', 'C:/forward/slash']) {
    await assert.rejects(() => prepareWindowsProjectData(profile), denied, `${profile} 必须在打开任何私有内容前拒绝`)
  }
  const f = await windowsFixture(t)
  const lease = await prepareWindowsProjectData(f.profile)
  try { assert.equal(lease.signal.aborted, false) } finally { fs.closeSync(lease.logFd); await lease.dispose() }
  const target = await mkdtemp(path.join(os.tmpdir(), 'windows-subst-'))
  t.after(() => rm(target, { recursive: true, force: true }))
  let drive
  for (const letter of ['Z', 'Y', 'X', 'W', 'V', 'U']) {
    try { childProcess.execFileSync('subst', [`${letter}:`, target], { stdio: 'pipe', windowsHide: true }); drive = letter; break } catch { /* 找下一个空闲盘符 */ }
  }
  assert.ok(drive !== undefined, '原生 subst 反例需要一个空闲盘符')
  try { await assert.rejects(() => prepareWindowsProjectData(`${drive}:\\profile`), denied, 'subst 隐藏祖先必须被卷根身份校验拒绝') }
  finally { childProcess.execFileSync('subst', [`${drive}:`, '/D'], { stdio: 'pipe', windowsHide: true }) }
})

test('native empty-directory lease requires LIST access for deny-delete sharing to block rename', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t), empty = path.join(f.root, 'empty-probe')
  await mkdir(empty); setAcl(empty)
  const result = JSON.parse(ps(String.raw`
$ErrorActionPreference='Stop'; $p=[Console]::ReadLine()|ConvertFrom-Json
$assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('ShareProof'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
$builder=$assembly.DefineDynamicModule('Native').DefineType('ShareProof','Public, Abstract, Sealed')
$create=$builder.DefinePInvokeMethod('CreateFileW','kernel32.dll','Public, Static, PinvokeImpl','Standard',[IntPtr],[type[]]@([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr]),'Winapi','Unicode')
$close=$builder.DefinePInvokeMethod('CloseHandle','kernel32.dll','Public, Static, PinvokeImpl','Standard',[int],[type[]]@([IntPtr]),'Winapi','Unicode')
$create.SetImplementationFlags('PreserveSig'); $close.SetImplementationFlags('PreserveSig'); $native=$builder.CreateType(); $proof=@{}
foreach($access in @(131200,131201)) {
  $handle=$native::CreateFileW($p.path,$access,3,[IntPtr]::Zero,3,35651584,[IntPtr]::Zero)
  if($handle -eq [IntPtr]::new(-1)){throw 'probe_open_failed'}
  $moved=$false
  try {
    try {[IO.Directory]::Move($p.path,$p.path+'-moved'); $moved=$true} catch [IO.IOException] {}
  } finally {$null=$native::CloseHandle($handle)}
  $proof[[string]$access]=$moved
  if($moved){[IO.Directory]::Move($p.path+'-moved',$p.path)}
}
$proof|ConvertTo-Json -Compress
`, { path: empty }))
  t.diagnostic(JSON.stringify({ nativeEmptyDirectoryShare: result }))
  assert.deepEqual(result, { 131200: true, 131201: false })
})

// Batch 2：worktrees/digest 按需以同一描述符创建、Git 后代只靠继承、lease 阻止替换、dispose 后 adopt。
test('native worktrees and digest are created protected, inherited by Git descendants and adopted after release', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true }), container = path.join(f.root, 'worktrees'), digest = path.join(container, 'digest')
  let lease = await prepareWindowsProjectData(f.profile), shape
  try {
    await preparePrivateWorktreeDirectories(container, digest, undefined, lease)
    for (const location of [container, digest]) {
      const entry = trustedAcl(inspectAcl(location), f.token.sid)
      assert.deepEqual([entry.ownerSid, entry.protected, entry.aces.every(({ inherited }) => !inherited)], [f.token.sid, true, true], `${path.basename(location)} 必须由创建调用带目标描述符`)
    }
    shape = { container: inspectAcl(container).sddl, digest: inspectAcl(digest).sddl }
    const descendant = path.join(digest, 'git-child'), payload = path.join(descendant, 'file.txt')
    await mkdir(descendant); await writeFile(payload, 'git descendant sentinel')
    for (const location of [descendant, payload]) {
      const entry = inspectAcl(location)
      assert.equal(entry.ownerSid, f.token.sid, 'Git 后代 owner 必须是当前用户')
      trustedAcl(entry, f.token.sid)
      assert.equal(entry.aces.every(({ inherited }) => inherited), true, 'Git 后代只靠 digest 的继承 allow，不逐个改 ACL')
    }
    await assert.rejects(() => rename(container, container + '-moved'), 'lease 必须阻止容器替换')
    await assert.rejects(() => rename(digest, digest + '-moved'), 'lease 必须阻止 digest 替换')
  } finally { fs.closeSync(lease.logFd); await lease.dispose() }
  lease = await prepareWindowsProjectData(f.profile)
  try {
    await preparePrivateWorktreeDirectories(container, digest, undefined, lease)
    assert.deepEqual([inspectAcl(container).sddl, inspectAcl(digest).sddl], [shape.container, shape.digest], 'dispose 后重开必须 adopt 既有两层且不改写 DACL')
  } finally { fs.closeSync(lease.logFd); await lease.dispose() }
})

// Batch 2：普通 mkdir 的 worktrees（继承而来、未保护）不是 canonical，必须拒绝且不修复、不建 digest。
test('native preexisting plain worktrees are refused without ACL repair', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true }), container = path.join(f.root, 'worktrees'), digest = path.join(container, 'digest')
  await mkdir(container)
  const plain = inspectAcl(container)
  assert.equal(plain.protected, false, 'plain mkdir 层必须是未保护的继承形状')
  const lease = await prepareWindowsProjectData(f.profile)
  try {
    await assert.rejects(() => preparePrivateWorktreeDirectories(container, digest, undefined, lease), denied)
    assert.deepEqual([inspectAcl(container).sddl, fs.existsSync(digest)], [plain.sddl, false], '拒绝必须零写入：不改 worktrees DACL，也不建 digest')
  } finally { fs.closeSync(lease.logFd); await lease.dispose() }
})

// Batch 2：同一 fresh profile 上的两个并发初始化都成功并收敛到同一 canonical 树。
test('native concurrent first starts converge on one canonical data tree', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true, provisioned: false })
  const settled = await Promise.allSettled([prepareWindowsProjectData(f.profile), prepareWindowsProjectData(f.profile)])
  const leases = settled.map(({ status, value }) => { assert.equal(status, 'fulfilled'); return value })
  try {
    for (const lease of leases) assert.equal(lease.signal.aborted, false)
    for (const location of [f.root, f.dataPath, f.log]) {
      const entry = trustedAcl(inspectAcl(location), f.token.sid)
      assert.deepEqual([entry.ownerSid, entry.protected], [f.token.sid, true], '并发收敛结果必须仍是 canonical 私有形状')
    }
    assert.deepEqual([fs.readdirSync(path.dirname(f.dataPath)).filter((name) => name === 'workspace.sqlite').length,
      fs.readdirSync(path.dirname(f.dataPath)).filter((name) => name === 'diagnostics.log').length], [1, 1], '并发后固定文件各只有一份')
  } finally { for (const lease of leases) { fs.closeSync(lease.logFd); await lease.dispose() } }
})

// Batch 2：SQLite 在私有 root 内留下的 sidecar 是继承形状，重开必须接纳且保留字节。
test('native sidecar residue from SQLite is adopted and preserved on reopen', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true, provisioned: false })
  let lease = await prepareWindowsProjectData(f.profile)
  fs.closeSync(lease.logFd); await lease.dispose()
  const journal = f.dataPath + '-journal'
  await writeFile(journal, 'sidecar sentinel')
  const inherited = inspectAcl(journal)
  assert.deepEqual([inherited.ownerSid, inherited.protected], [f.token.sid, false], 'sidecar 是继承形状而非 protected')
  trustedAcl(inherited, f.token.sid)
  lease = await prepareWindowsProjectData(f.profile)
  try { assert.equal(await readFile(journal, 'utf8'), 'sidecar sentinel', '重开必须保留既有 sidecar 字节') } finally { fs.closeSync(lease.logFd); await lease.dispose() }
})

// Batch 2：既有 plain root（普通 mkdir、未保护）明确 refuse，不修复 DACL、不建后续对象、不发布 authority。
test('native preexisting plain root is refused without repair or authority', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true })
  await rm(f.root, { recursive: true, force: true }); await mkdir(f.root)
  const plain = inspectAcl(f.root)
  assert.equal(plain.protected, false, 'plain root 必须是未保护的继承形状')
  await assert.rejects(() => prepareWindowsProjectData(f.profile), denied)
  await assert.rejects(() => hostFixture(apply, { profile: f.profile }), (error) => {
    assert.equal(error.name, denied.name); assert.doesNotMatch(error.message, /harness-admission-|[A-Z]:\\/i); return true
  })
  assert.deepEqual([inspectAcl(f.root).sddl, fs.existsSync(f.dataPath), fs.existsSync(f.log)], [plain.sddl, false, false], '拒绝必须零写入：不改 root DACL，也不建 db/log')
})

// Batch 2：profile 归 launcher，缺失时拒绝且插件不得代建。
test('native missing launcher profile is refused and never created', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t, { launcherProfile: true })
  await rm(f.profile, { recursive: true, force: true })
  await assert.rejects(() => prepareWindowsProjectData(f.profile), denied)
  await assert.rejects(() => hostFixture(apply, { profile: f.profile }), denied)
  assert.equal(fs.existsSync(f.profile), false, '插件不得创建或代管 launcher 的 profile')
})

test('native mechanism holds original directories without compiler children and releases on helper death', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t), spawn = childProcess.spawn
  let child, lease
  childProcess.spawn = (...args) => {
    child = spawn(...args)
    child.stdout?.on('data', (chunk) => { if (/^private-windows-error-[a-z0-9-]+\r?\n$/.test(String(chunk))) t.diagnostic(String(chunk).trim()) })
    return child
  }
  try {
    const start = performance.now(); lease = await prepareWindowsProjectData(f.profile)
    t.diagnostic(`native Reflection.Emit startup_ms=${Math.round(performance.now() - start)}`)
    await assert.rejects(() => rename(f.profile, f.profile + '-moved'))
    sqliteProbe(f, true)
    const children = JSON.parse(ps(String.raw`
$p=[Console]::ReadLine()|ConvertFrom-Json
$expected=[IO.Path]::Combine([Environment]::GetFolderPath('Windows'),'System32','conhost.exe')
$proof=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$p.pid)|ForEach-Object {
  @{pid=$_.ProcessId;name=$(if($_.Name -match '^[A-Za-z][A-Za-z0-9_.-]{0,63}$'){$_.Name}else{'unsupported-name'});systemConhost=([string]::Equals($_.ExecutablePath,$expected,[StringComparison]::OrdinalIgnoreCase))}
})
ConvertTo-Json -InputObject $proof -Compress
`, { pid: child.pid }))
    t.diagnostic(JSON.stringify({ nativeHelperChildren: children }))
    fs.closeSync(lease.logFd); child.kill()
    await new Promise((resolve) => lease.signal.aborted ? resolve() : lease.signal.addEventListener('abort', resolve, { once: true }))
    await lease.dispose(); await rename(f.root, f.root + '-released')
    assert.equal(ps(String.raw`
$p=[Console]::ReadLine()|ConvertFrom-Json; $end=[DateTime]::UtcNow.AddSeconds(1)
do {
  $live=@($p.pids|Where-Object {Get-CimInstance Win32_Process -Filter ('ProcessId='+$_)})
  if(!$live.Count){break}; [Threading.Thread]::Sleep(20)
} while([DateTime]::UtcNow -lt $end)
[Console]::Write($live.Count)
`, { pids: children.map(({ pid }) => pid) }), '0', 'helper termination must leave no captured child alive')
    assert.ok(children.length <= 1 && children.every(({ name, systemConhost }) => name === 'conhost.exe' && systemConhost), 'only the verified system console host is permitted')
  } finally { childProcess.spawn = spawn; if (lease) await lease.dispose() }
})

// Catches the present win32 refusal through actual Host startup, before any adapter import exists.
test('native Windows Host reopens secured data and keeps a directory lease through SQLite cleanup', { skip: process.platform !== 'win32' }, async (t) => positiveHost(apply, t))

test('native Windows admission refuses a foreign-owned database even with otherwise safe ACL and ancestors', { skip: process.platform !== 'win32' }, async (t) => {
  ordinaryToken(t)
  const profile = process.env.HARNESS_WINDOWS_FOREIGN_PROFILE
  assert.ok(profile, 'qualification must pre-provision its foreign-owner fixture as administrator')
  const f = { profile }, database = path.join(profile, 'harness-projects', 'workspace.sqlite')
  const original = await readFile(database)
  await assert.rejects(() => prepareWindowsProjectData(profile), denied)
  await assert.rejects(() => hostFixture(apply, f), { name: 'HostAuthorityError' })
  assert.deepEqual(await readFile(database), original)
})

// Omitting each corresponding object, DACL, inheritance or hardlink check must publish no authority.
test('native Windows admission refuses unsafe objects without disclosing paths or mutating sentinels', { skip: process.platform !== 'win32' }, async (t) => {
  for (const kind of ['ancestor', 'direct-only', 'null', 'callback', 'inherit-only',
    'broad-profile', 'broad-root', 'broad-workspace.sqlite', 'broad-diagnostics.log', 'broad-workspace.sqlite-wal',
    'broad-workspace.sqlite-shm', 'broad-workspace.sqlite-journal', 'junction-profile', 'junction-root', 'wrong-type', 'hardlink-db', 'hardlink-log', 'hardlink-sidecar']) {
    await t.test(kind, async (t) => {
      const f = await windowsFixture(t), original = await readFile(f.log)
      await corrupt(f, kind)
      await assert.rejects(() => prepareWindowsProjectData(f.profile), denied)
      await assert.rejects(() => hostFixture(apply, f), (error) => {
        assert.equal(error.name, denied.name); assert.doesNotMatch(error.message, /harness-admission-|[A-Z]:\\/i)
        return true
      })
      if (!['junction-profile', 'junction-root'].includes(kind)) assert.deepEqual(await readFile(f.log), original)
    })
  }
})
