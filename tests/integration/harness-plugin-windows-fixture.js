import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import childProcess from 'node:child_process'
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { seed, seedWorkspace } from './fixtures/host-seed.js'

export const denied = { name: 'HostAuthorityError', message: 'Host project data is unavailable' }
export const powershell = () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
export function ps(program, input = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'))
  env.PSModulePath = path.join(path.dirname(powershell()), 'Modules')
  const prelude = "$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');$utf8=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;"
  return execFileSync(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', prelude + program], {
    input: JSON.stringify(input) + '\n', encoding: 'utf8', timeout: 15000, windowsHide: true, env,
  }).trim()
}
const ACL = String.raw`
$ErrorActionPreference='Stop'; $p=[Console]::ReadLine()|ConvertFrom-Json
$sid=if($p.sid){$p.sid}else{[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}
$owner=if($p.owner){$p.owner}else{$sid}
$item=Get-Item -LiteralPath $p.path -Force
$acl=if($item.PSIsContainer){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
$inherit=if($item.PSIsContainer -and !$p.direct){'OICI'}else{''}
$sddl='O:'+$owner+'D:P(A;'+$inherit+';FA;;;'+$sid+')(A;'+$inherit+';FA;;;SY)(A;'+$inherit+';FA;;;BA)'
if($p.broad){$sddl+='(A;'+$p.flags+';'+$p.rights+';;;WD)'}
$sections=[Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access
$acl.SetSecurityDescriptorSddlForm($sddl,$sections)
if($p.null){$acl.SetSecurityDescriptorSddlForm('O:'+$sid+'D:NO_ACCESS_CONTROL',$sections)}
if($p.callback){
  $raw=New-Object Security.AccessControl.RawSecurityDescriptor($sddl)
  $ace=New-Object Security.AccessControl.CommonAce(0,0,1,(New-Object Security.Principal.SecurityIdentifier('S-1-1-0')),$true,([byte[]]@(0,0,0,0)))
  $raw.DiscretionaryAcl.InsertAce(0,$ace); $bytes=New-Object byte[] $raw.BinaryLength; $raw.GetBinaryForm($bytes,0)
  $acl.SetSecurityDescriptorBinaryForm($bytes,$sections)
}
$item.SetAccessControl($acl)
`
export const setAcl = (location, options = {}) => ps(ACL, { path: location, ...options })
// Qualification administrator only. The worker never elevates or assigns a foreign owner.
export async function provisionForeignFixture(profile, sid) {
  const owner = ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value')
  const root = path.join(profile, 'harness-projects'), dataPath = path.join(root, 'workspace.sqlite'), log = path.join(root, 'diagnostics.log')
  await mkdir(root, { recursive: true }); await writeFile(dataPath, 'foreign database sentinel'); await writeFile(log, 'foreign log sentinel')
  for (const location of [profile, root, dataPath, log]) setAcl(location, { sid, owner })
  for (const location of [profile, root, log]) execFileSync(path.join(process.env.SystemRoot, 'System32', 'icacls.exe'), [location, '/setowner', '*' + sid], { stdio: 'pipe' })
}
export function ordinaryToken(t) {
  const token = JSON.parse(ps(String.raw`
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$admin=(New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
@{sid=$id.User.Value;admin=$admin;adminMember=($id.Groups.Value -contains 'S-1-5-32-544');home=[Environment]::GetFolderPath('UserProfile')}|ConvertTo-Json -Compress
`))
  assert.equal(token.admin, false, 'native evidence requires an ordinary user token')
  assert.equal(token.adminMember, false, 'the worker must use the separate standard account')
  t.diagnostic(JSON.stringify({ ...token, home: undefined, platform: process.platform, node: process.version }))
  return token
}
export async function windowsFixture(t) {
  const token = ordinaryToken(t), ancestor = await mkdtemp(path.join(token.home, 'harness-admission-空 格-')), profile = path.join(ancestor, 'profile')
  t.after(() => rm(ancestor, { recursive: true, force: true }))
  setAcl(ancestor); await mkdir(profile); setAcl(profile)
  const root = path.join(profile, 'harness-projects'), dataPath = path.join(root, 'workspace.sqlite'), log = path.join(root, 'diagnostics.log')
  await mkdir(root); setAcl(root)
  await seed(dataPath, new Map(), seedWorkspace)
  await writeFile(log, 'admission log sentinel\n'); setAcl(dataPath); setAcl(log)
  return { token, ancestor, profile, root, dataPath, log }
}
export async function hostFixture(apply, f) {
  const services = new Map(), effects = [], live = new Set()
  const ctx = { invocation: { peer: { id: 'windows-fixture' } }, get: (name) => name === 'profileContext' ? { dir: f.profile } : undefined,
    effect(run) { effects.push(run()) }, provide(name, value) { services.set(name, value); return () => services.delete(name) },
    typert: { register(value) { live.add(value); return () => live.delete(value) } } }
  const dispose = async () => { for (const stop of effects) await stop() }
  try { await apply(ctx); return { services, live, dispose, ctx } }
  catch (error) { await dispose(); assert.equal(services.size, 0); assert.equal(live.size, 0); throw error }
}
export async function corrupt(f, kind) {
  if (kind.startsWith('missing-')) return rm(kind === 'missing-root' ? f.root : kind === 'missing-db' ? f.dataPath : f.log, { recursive: true })
  if (kind === 'ancestor') return setAcl(f.ancestor, { broad: true, flags: '', rights: '0x40' })
  if (kind === 'direct-only') return setAcl(f.root, { direct: true })
  if (kind === 'null' || kind === 'callback') return setAcl(f.root, { [kind]: true })
  if (kind === 'inherit-only') return setAcl(f.root, { broad: true, flags: 'OIIO', rights: 'FR' })
  if (kind.startsWith('broad-')) {
    const target = kind.slice(6), location = target === 'profile' ? f.profile : target === 'root' ? f.root : path.join(f.root, target)
    if (target.startsWith('workspace.sqlite-')) await writeFile(location, 'sidecar sentinel')
    return setAcl(location, { broad: true, flags: '', rights: 'FR' })
  }
  if (kind.startsWith('junction-')) {
    const location = kind === 'junction-profile' ? f.profile : f.root
    await rename(location, location + '-outside'); return symlink(location + '-outside', location, 'junction')
  }
  if (kind === 'wrong-type') { await rm(f.dataPath); return mkdir(f.dataPath) }
  const target = kind === 'hardlink-log' ? f.log : kind === 'hardlink-sidecar' ? f.dataPath + '-journal' : f.dataPath
  if (kind === 'hardlink-sidecar') await writeFile(target, 'sidecar sentinel')
  await link(target, path.join(f.profile, 'outside-sentinel'))
}
export function sqliteProbe(f, wal = false) {
    const db = new DatabaseSync(f.dataPath)
    try {
      db.exec("BEGIN IMMEDIATE; INSERT INTO workspace(id,name,status_policy) VALUES ('00000000-0000-4000-8000-000000000643','persisted','manual_only')")
      assert.equal(fs.existsSync(f.dataPath + '-journal'), true)
      ps(String.raw`$p=[Console]::ReadLine()|ConvertFrom-Json;$a=Get-Acl -LiteralPath $p.path;if($a.Access|Where-Object{$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($p.sid,'S-1-5-18','S-1-5-32-544')}){throw 'unsafe inherited sidecar'}`, { path: f.dataPath + '-journal', sid: f.token.sid })
      db.exec('COMMIT'); assert.equal(fs.existsSync(f.dataPath + '-journal'), false)
      if (wal) {
        db.exec("PRAGMA journal_mode=WAL; UPDATE workspace SET name='wal' WHERE id='00000000-0000-4000-8000-000000000643'")
        for (const suffix of ['-wal', '-shm']) {
          assert.equal(fs.existsSync(f.dataPath + suffix), true)
          ps(String.raw`$p=[Console]::ReadLine()|ConvertFrom-Json;$a=Get-Acl -LiteralPath $p.path;if($a.Access|Where-Object{$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($p.sid,'S-1-5-18','S-1-5-32-544')}){throw 'unsafe inherited sidecar'}`, { path: f.dataPath + suffix, sid: f.token.sid })
        }
      }
    } finally { db.close() }
    if (wal) for (const suffix of ['-wal', '-shm']) assert.equal(fs.existsSync(f.dataPath + suffix), false)
}
export async function positiveHost(apply, t) {
  const f = await windowsFixture(t), start = performance.now()
  const spawn = childProcess.spawn, open = fs.openSync
  let host, acquisition, orderingError
  childProcess.spawn = (...args) => {
    const child = spawn(...args), current = { child, fd: undefined }, end = child.stdin.end.bind(child.stdin)
    acquisition = current
    child.stdin.end = (...args) => {
      try {
        if (current.fd !== undefined) {
          assert.throws(() => fs.fstatSync(current.fd), { code: 'EBADF' }, 'log must close before native lease release')
          fs.renameSync(f.dataPath, f.dataPath + '-closed'); fs.renameSync(f.dataPath + '-closed', f.dataPath)
        }
      } catch (error) { orderingError ??= error }
      return end(...args)
    }
    return child
  }
  fs.openSync = (...args) => { const fd = open(...args); if (args[0] === f.log && acquisition) acquisition.fd = fd; return fd }
  try {
    host = await hostFixture(apply, f)
    assert.equal((await host.services.get('harnessProjects').getWorkspaceSetup()).workspace.name, 'Seeded Workspace')
    assert.equal((await host.services.get('harnessProjects').installExecutionBindings({ kind: 'user' }, 'native-install')).writeState, 'local_only')
    fs.writeSync(acquisition.fd, 'admission resumed log\n')
    await assert.rejects(() => rename(f.root, f.root + '-moved'), 'the native lease must prevent OS directory replacement')
    sqliteProbe(f)
    await host.dispose(); host = await hostFixture(apply, f)
    assert.equal((await host.services.get('harnessProjects').getWorkspaceSetup()).workspace.name, 'Seeded Workspace')
    const reopened = new DatabaseSync(f.dataPath)
    try {
      assert.equal(reopened.prepare("SELECT name FROM workspace WHERE id='00000000-0000-4000-8000-000000000643'").get().name, 'persisted')
      assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM provider_binding').get().n, 2)
    } finally { reopened.close() }
    assert.ok((await readFile(f.log, 'utf8')).startsWith('admission log sentinel\n'))
    assert.ok((await readFile(f.log, 'utf8')).includes('admission resumed log\n'))
    const service = host.services.get('harnessProjects'); acquisition.child.kill()
    const end = Date.now() + 1500
    while (host.services.size && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual([host.services.size, host.live.size], [0, 0], 'helper death must withdraw the entire Host authority')
    await assert.rejects(() => service.getWorkspaceSetup(), /已卸载/)
  } finally { await host?.dispose(); acquisition?.child.kill(); childProcess.spawn = spawn; fs.openSync = open }
  if (orderingError) throw orderingError
  await rename(f.root, f.root + '-released')
  t.diagnostic(`native apply/reopen/SQLite/lease elapsed_ms=${Math.round(performance.now() - start)}`)
}
