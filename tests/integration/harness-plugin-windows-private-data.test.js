import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import childProcess from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import test from 'node:test'
import { apply } from '../../apps/harness-plugin/src/host.ts'
import { prepareWindowsProjectData } from '../../apps/harness-plugin/src/host-private-windows.ts'
import { preparePrivateWorktreeDirectories } from '../../apps/harness-plugin/src/host-private-data.ts'
import path from 'node:path'
import { seed, seedWorkspace } from './fixtures/host-seed.js'
import { corrupt, denied, hostFixture, ordinaryToken, positiveHost, ps, setAcl, sqliteProbe, windowsFixture } from './harness-plugin-windows-fixture.js'

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

test('native worktree admission keeps existing private layers in the owning lease and refuses missing layers', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await windowsFixture(t), container = path.join(f.root, 'worktrees'), digest = path.join(container, 'digest')
  const lease = await prepareWindowsProjectData(f.profile)
  try {
    await assert.rejects(() => preparePrivateWorktreeDirectories(container, digest, undefined, lease), denied)
  } finally { fs.closeSync(lease.logFd); await lease.dispose() }
  await mkdir(container); setAcl(container); await mkdir(digest); setAcl(digest)
  const admitted = await prepareWindowsProjectData(f.profile)
  try {
    await preparePrivateWorktreeDirectories(container, digest, undefined, admitted)
    await assert.rejects(() => rename(digest, digest + '-moved'))
  } finally { fs.closeSync(admitted.logFd); await admitted.dispose() }
  await rename(digest, digest + '-released')
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
  for (const kind of ['missing-root', 'missing-db', 'missing-log', 'ancestor', 'direct-only', 'null', 'callback', 'inherit-only',
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
      if (!['missing-root', 'missing-log', 'junction-profile', 'junction-root'].includes(kind)) assert.deepEqual(await readFile(f.log), original)
    })
  }
})
