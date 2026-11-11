import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import childProcess, { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { CURRENT_SCHEMA_GENERATION } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { WORKSPACE, seed } from './fixtures/host-seed.js'

const actorRef = { kind: 'user' }
const denied = { name: 'HostAuthorityError', message: 'Host project data is unavailable' }
async function fixture(t, parent = os.tmpdir()) {
  const profile = await realpath(await mkdtemp(path.join(parent, 'private-host-')))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const root = path.join(profile, 'harness-projects'), dataPath = path.join(root, 'workspace.sqlite'), log = path.join(root, 'diagnostics.log')
  return { profile, root, dataPath, log, options: { dataPath, workspaceId: WORKSPACE, catalog: new Map(), resolveCredential: async () => undefined } }
}
async function refusedHost(f) {
  const services = new Map(), effects = []
  let registrations = 0
  const ctx = { get: (name) => name === 'profileContext' ? { dir: f.profile } : undefined,
    effect(run) { effects.push(run()) }, provide(name, value) { services.set(name, value); return () => services.delete(name) },
    typert: { register() { registrations++; return () => {} } } }
  try {
    await assert.rejects(() => applyHost(ctx), denied)
    assert.equal(registrations, 0)
    assert.equal(services.size, 0)
  } finally { for (const dispose of effects) await dispose() }
}
const mode = async (file) => (await stat(file)).mode & 0o777
const create = (host) => host.call('createWorkspace', { actorRef, idempotencyKey: 'create-private', name: 'Private workspace' })

// Catches default mkdir/open modes and chmod-by-recreation that loses persisted data.
test('new and reopened Host data stays private under umask 022 and preserves rows and log bytes', async (t) => {
  const f = await fixture(t), oldMask = process.umask(0o022)
  let host
  try {
    host = await createHostComposition(f.options)
    host.diagnoseShutdown('shutdownFailed')
    assert.deepEqual(await Promise.all([mode(f.root), mode(f.dataPath), mode(f.log)]), [0o700, 0o600, 0o600])
    assert.equal((await create(host)).writeState, 'local_only')
    const db = new DatabaseSync(f.dataPath)
    try { assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete') } finally { db.close() }
    await host.dispose()
    await writeFile(f.log, 'existing diagnostic bytes\n')
    await Promise.all([chmod(f.root, 0o755), chmod(f.dataPath, 0o644), chmod(f.log, 0o644)])
    host = await createHostComposition(f.options)
    assert.deepEqual(await Promise.all([mode(f.root), mode(f.dataPath), mode(f.log)]), [0o700, 0o600, 0o600])
    assert.equal((await host.call('getWorkspaceSetup', {})).workspace.name, 'Private workspace')
    assert.ok((await readFile(f.log, 'utf8')).startsWith('existing diagnostic bytes\n'))
  } finally { process.umask(oldMask); await host?.dispose() }
})

// Catches following a link or accepting nonregular/multiply-linked data before opening SQLite.
test('unsafe root, DB, log and SQLite sidecars refuse without modifying an outside sentinel', async (t) => {
  const cases = [
    ['root', 'symlink'], ['workspace.sqlite', 'symlink'], ['diagnostics.log', 'symlink'],
    ['workspace.sqlite-wal', 'symlink'], ['workspace.sqlite-shm', 'symlink'], ['workspace.sqlite-journal', 'symlink'],
    ['workspace.sqlite', 'hardlink'], ['diagnostics.log', 'hardlink'], ['workspace.sqlite-journal', 'hardlink'],
    ['workspace.sqlite', 'fifo'], ['diagnostics.log', 'directory'],
  ]
  for (const [name, kind] of cases) await t.test(`${name} ${kind}`, async (t) => {
    const f = await fixture(t), sentinel = path.join(f.profile, 'outside')
    await writeFile(sentinel, 'outside bytes', { mode: 0o644 })
    const entry = name === 'root' ? f.root : path.join(f.root, name)
    if (name === 'root') await symlink(f.profile, entry)
    else {
      await mkdir(f.root)
      if (kind === 'symlink') await symlink(sentinel, entry)
      if (kind === 'hardlink') await link(sentinel, entry)
      if (kind === 'fifo') execFileSync('mkfifo', [entry])
      if (kind === 'directory') await mkdir(entry)
    }
    await refusedHost(f)
    assert.equal(await readFile(sentinel, 'utf8'), 'outside bytes')
    assert.equal(await mode(sentinel), 0o644)
  })
})

// Catches a composition-only guard that production apply could bypass, and raw path leakage.
test('production apply rejects an externally writable profile before remote registration', async (t) => {
  const f = await fixture(t)
  await chmod(f.profile, 0o777)
  await refusedHost(f)
  assert.equal(fs.existsSync(f.dataPath), false)
})

// Catches assuming DB mode alone covers existing sidecars or changing production journal policy.
test('real SQLite WAL and SHM are tightened and subsequent writes retain private modes', async (t) => {
  const f = await fixture(t)
  await mkdir(f.root, { mode: 0o755 })
  await seed(f.dataPath, new Map(), async () => {})
  const db = new DatabaseSync(f.dataPath)
  let host
  try {
    // 同值写入以实际建立 WAL/SHM，不改变 seed 的 schema generation。
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA user_version=${CURRENT_SCHEMA_GENERATION}`)
    await Promise.all([f.dataPath, f.dataPath + '-wal', f.dataPath + '-shm'].map(file => chmod(file, 0o644)))
    host = await createHostComposition(f.options)
    assert.equal((await create(host)).writeState, 'local_only')
    assert.deepEqual(await Promise.all([f.dataPath, f.dataPath + '-wal', f.dataPath + '-shm'].map(mode)), [0o600, 0o600, 0o600])
    assert.equal((await host.call('getWorkspaceSetup', {})).workspace.name, 'Private workspace')
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
  } finally { await host?.dispose(); db.close() }
  assert.equal(fs.existsSync(f.dataPath + '-wal'), false)
  const reopened = await createHostComposition(f.options)
  try {
    assert.deepEqual(await Promise.all([f.dataPath + '-wal', f.dataPath + '-shm'].map(mode)), [0o600, 0o600])
    assert.equal((await reopened.call('getWorkspaceSetup', {})).workspace.name, 'Private workspace')
  } finally { await reopened.dispose() }
})

// Catches reopening the diagnostic path on every write, and a missing logger close.
test('diagnostics stay on the verified descriptor and close after shutdown failure is logged', async (t) => {
  const f = await fixture(t), moved = path.join(f.root, 'original.log'), sentinel = path.join(f.profile, 'sentinel')
  await writeFile(sentinel, 'do not append')
  let logFd
  const open = fs.openSync
  t.mock.method(fs, 'openSync', function (file, ...args) {
    const fd = open.call(this, file, ...args)
    if (file === f.log) logFd = fd
    return fd
  })
  const host = await createHostComposition(f.options)
  try {
    assert.equal(typeof logFd, 'number')
    await rename(f.log, moved); await symlink(sentinel, f.log)
    host.diagnoseShutdown('shutdownFailed', Object.assign(Error('private path canary'), { code: 'SYNTHETIC' }))
    assert.equal(await readFile(sentinel, 'utf8'), 'do not append')
    assert.match(await readFile(moved, 'utf8'), /"code":"SYNTHETIC"/)
    assert.doesNotMatch(await readFile(moved, 'utf8'), /private path canary/)
  } finally { await host.dispose() }
  assert.throws(() => fs.fstatSync(logFd), { code: 'EBADF' })
})

// Catches leaking a descriptor acquired immediately before owner cancellation.
test('owner cancellation at diagnostic acquisition releases every acquired descriptor', async (t) => {
  const f = await fixture(t), controller = new AbortController(), acquired = []
  const open = fs.openSync
  t.mock.method(fs, 'openSync', function (file, ...args) {
    const fd = open.call(this, file, ...args)
    if (file === f.root || file === f.dataPath || file === f.log) acquired.push(fd)
    if (file === f.log) controller.abort()
    return fd
  })
  await assert.rejects(() => createHostComposition({ ...f.options, owner: { signal: controller.signal, stop() { controller.abort(); return Date.now() + 100 } } }))
  assert.ok(acquired.length > 0)
  for (const fd of acquired) assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' })
})

// Synthetic uid observation only: no privileged chown or real foreign-user file is used.
test('descriptor ownership, POSIX support and chmod failure refuse before publishing a Host', async (t) => {
  for (const entry of ['profile', 'root', 'db', 'log', 'chmod', 'platform']) await t.test(entry, async (t) => {
    const f = await fixture(t)
    await mkdir(f.root, { mode: 0o755 })
    await writeFile(f.dataPath, '', { mode: 0o644 })
    await writeFile(f.log, 'original bytes', { mode: 0o644 })
    const target = { profile: f.profile, root: f.root, db: f.dataPath, log: f.log }[entry]
    if (target) {
      const open = fs.openSync, inspect = fs.fstatSync
      let selected
      t.mock.method(fs, 'openSync', function (file, ...args) { const fd = open.call(this, file, ...args); if (file === target) selected = fd; return fd })
      t.mock.method(fs, 'fstatSync', function (fd, ...args) {
        const value = inspect.call(this, fd, ...args)
        return fd === selected ? Object.assign(Object.create(value), { uid: process.getuid() + 1 }) : value
      })
    } else if (entry === 'platform') t.mock.property(process, 'platform', 'win32')
    else t.mock.method(fs, 'fchmodSync', () => { throw Object.assign(Error('path canary'), { code: 'EPERM' }) })
    await refusedHost(f)
    assert.equal(await readFile(f.log, 'utf8'), 'original bytes')
    assert.equal(await readFile(f.dataPath, 'utf8'), '')
  })
})

// Catches replacing an owned private profile through an unprotected writable ancestor.
test('canonical profile ancestry refuses nonsticky shared parents and admits protected sticky temp roots', async (t) => {
  const top = await fixture(t), shared = path.join(top.profile, 'shared'), sentinel = path.join(top.profile, 'outside')
  await mkdir(shared); await chmod(shared, 0o777)
  const f = await fixture(t, shared)
  await writeFile(sentinel, 'untouched ancestor sentinel', { mode: 0o644 })
  assert.equal(await mode(f.profile), 0o700)
  await refusedHost(f)
  assert.equal(fs.existsSync(f.dataPath), false)
  assert.equal(await readFile(sentinel, 'utf8'), 'untouched ancestor sentinel')
  assert.deepEqual(await Promise.all([mode(shared), mode(f.profile), mode(sentinel)]), [0o777, 0o700, 0o644])
  const sticky = await fixture(t, await realpath('/tmp'))
  const effects = []
  try {
    await applyHost({ get: (name) => name === 'profileContext' ? { dir: sticky.profile } : undefined,
      effect(run) { effects.push(run()) }, provide() { return () => {} }, typert: { register() { return () => {} } } })
    assert.deepEqual(await Promise.all([mode(sticky.root), mode(sticky.dataPath)]), [0o700, 0o600])
  } finally { for (const dispose of effects) await dispose() }
})

// Real Darwin extended grants survive fchmod; each entry must refuse without ACL mutation.
test('Darwin ACL allow grants on every admitted object refuse and deny-only ACL remains usable', { skip: process.platform !== 'darwin' }, async (t) => {
  for (const name of ['profile', 'ancestor', 'root', 'workspace.sqlite', 'diagnostics.log', 'workspace.sqlite-wal', 'workspace.sqlite-shm', 'workspace.sqlite-journal', 'inherit', 'inherited']) await t.test(name, async (t) => {
    const top = await fixture(t, await realpath('/tmp')), f = name === 'ancestor' ? await fixture(t, top.profile) : top
    await mkdir(f.root)
    const file = ['profile', 'ancestor', 'inherit', 'inherited'].includes(name) ? (name === 'ancestor' ? top.profile : f.profile)
      : name === 'root' ? f.root : path.join(f.root, name)
    if (!['profile', 'ancestor', 'root', 'inherit', 'inherited'].includes(name)) await writeFile(file, 'ACL sentinel', { mode: 0o600 })
    const ace = name === 'inherit' ? 'everyone allow read,file_inherit,directory_inherit,only_inherit'
      : (await stat(file)).isDirectory() ? 'everyone allow search,add_file,delete_child' : 'everyone allow read,write,append'
    execFileSync('/bin/chmod', [name === 'inherited' ? '+ai' : '+a', ace, file])
    try {
      const before = execFileSync('/bin/ls', ['-lde', file], { encoding: 'utf8' }).split('\n').slice(1).join('\n')
      await refusedHost(f)
      const after = execFileSync('/bin/ls', ['-lde', file], { encoding: 'utf8' }).split('\n').slice(1).join('\n')
      assert.equal(after, before, '准入不删除或改变显式/继承ACL')
      if ((await stat(file)).isFile()) assert.equal(await readFile(file, 'utf8'), 'ACL sentinel')
    } finally { if (fs.existsSync(file)) execFileSync('/bin/chmod', ['-N', file]) }
  })
  const f = await fixture(t, await realpath('/tmp'))
  execFileSync('/bin/chmod', ['+a', 'everyone deny delete', f.profile])
  const effects = []
  try {
    await applyHost({ get: name => name === 'profileContext' ? { dir: f.profile } : undefined,
      effect(run) { effects.push(run()) }, provide() { return () => {} }, typert: { register() { return () => {} } } })
    assert.equal(await mode(f.dataPath), 0o600)
  } finally { for (const dispose of effects) await dispose(); execFileSync('/bin/chmod', ['-N', f.profile]) }
})

// Query failure/unknown output must refuse; a real hung OS query is killed and its fd closed.
test('Darwin native ACL failures stay bounded, fixed and release descriptors', { skip: process.platform !== 'darwin' }, async (t) => {
  for (const kind of ['failure', 'unknown', 'timeout', 'overflow']) await t.test(kind, async (t) => {
    const f = await fixture(t), native = childProcess.spawn, open = fs.openSync
    let fd, pid
    t.mock.method(fs, 'openSync', function (file, ...args) { const value = open.call(this, file, ...args); if (file === f.profile) fd = value; return value })
    t.mock.method(childProcess, 'spawn', function (file, args, options) {
      if (file !== '/usr/bin/osascript') return native.call(this, file, args, options)
      const program = kind === 'failure' ? 'throw Error("native query path canary")'
        : kind === 'unknown' ? JSON.stringify('private-acl-v1\n 0: everyone deny delete')
        : kind === 'overflow' ? 'Array(4096).join("x")' : 'delay(5); "private-acl-v1";'
      const child = native.call(this, file, ['-l', 'JavaScript', '-e', program], options)
      pid = child.pid; return child
    })
    const started = Date.now()
    await refusedHost(f)
    assert.ok(Date.now() - started < 1500, '真实子进程超时不能挂住Host启动')
    assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' })
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  })
})

// The OS ACL read must stay on the verified inode if the original pathname is replaced.
test('Darwin ACL query binds the descriptor and ignores hostile filename text', { skip: process.platform !== 'darwin' }, async (t) => {
  const f = await fixture(t, await realpath('/tmp')), moved = f.profile + '-moved', native = childProcess.spawn
  execFileSync('/bin/chmod', ['+a', 'everyone allow search,delete_child', f.profile])
  let swapped = false
  t.mock.method(childProcess, 'spawn', function (file, args, options) {
    if (!swapped && file === '/usr/bin/osascript') {
      swapped = true; fs.renameSync(f.profile, moved); fs.mkdirSync(f.profile, { mode: 0o700 })
    }
    return native.call(this, file, args, options)
  })
  try { await refusedHost(f); assert.equal(fs.existsSync(f.dataPath), false) }
  finally { execFileSync('/bin/chmod', ['-N', moved]); await rm(moved, { recursive: true, force: true }) }
  const hostile = path.join(f.profile, 'name\n 0: group:everyone allow read,only_inherit')
  await mkdir(hostile, { mode: 0o700 })
  const safe = await fixture(t, hostile), effects = []
  execFileSync('/bin/chmod', ['+a', 'everyone deny delete', safe.profile])
  try {
    await applyHost({ get: name => name === 'profileContext' ? { dir: safe.profile } : undefined,
      effect(run) { effects.push(run()) }, provide() { return () => {} }, typert: { register() { return () => {} } } })
    assert.equal(await mode(safe.dataPath), 0o600)
  } finally { for (const dispose of effects) await dispose(); execFileSync('/bin/chmod', ['-N', safe.profile]) }
})

// A real delayed OS query must be cancelled by root disposal rather than wait for its startup timeout.
test('Darwin owner abort kills in-flight ACL queries and drains each acquisition phase', { skip: process.platform !== 'darwin' }, async (t) => {
  for (const phase of ['profile', 'root', 'file']) await t.test(phase, async (t) => {
    const f = await fixture(t), sync = childProcess.execFileSync, spawn = childProcess.spawn
    const target = phase === 'profile' ? f.profile : phase === 'root' ? f.root : f.dataPath
    let stop, fd, pid, reason, scheduled = false, observed, stopped
    const stoppedPromise = new Promise(resolve => { stopped = resolve })
    const select = options => {
      if (!fs.existsSync(target)) return false
      const entry = fs.statSync(target)
      fd = options.stdio.slice(3).find(candidate => {
        const value = fs.fstatSync(candidate)
        return value.dev === entry.dev && value.ino === entry.ino
      })
      return fd !== undefined
    }
    const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(() => { void stop().finally(stopped) }, 20) } }
    const argsFor = ['-l', 'JavaScript', '-e', 'delay(5); "private-acl-v1";']
    t.mock.method(childProcess, 'execFileSync', function (file, args, options) {
      if (file !== '/usr/bin/osascript' || !select(options)) return sync.call(this, file, args, options)
      schedule()
      try { return sync.call(this, file, argsFor, options) } catch (error) { pid = error.pid; reason = error.code; throw error }
    })
    t.mock.method(childProcess, 'spawn', function (file, args, options) {
      if (file !== '/usr/bin/osascript' || !select(options)) return spawn.call(this, file, args, options)
      const child = spawn.call(this, file, argsFor, options); pid = child.pid
      child.once('error', error => { reason = error.code }); schedule(); return child
    })
    try {
      await applyHost({ get: name => name === 'profileContext' ? { dir: f.profile } : undefined,
        effect(run) { stop = run() }, provide() { throw Error('no endpoint during cancelled ACL query') }, typert: { register() { throw Error('no registration') } } })
    } catch (error) { observed = error }
    assert.equal(scheduled, true, '到达真实延迟OS查询')
    await stoppedPromise
    assert.equal(observed, undefined, '用户卸载必须先取消OS查询，不能等待startup timeout后冒充启动失败')
    assert.equal(reason, 'ABORT_ERR')
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' })
  })
})
