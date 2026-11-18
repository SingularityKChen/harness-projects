// Windows 私有数据创建不得跟随悬空 reparse（#662；PR #657 评审 P2 的后续修复）。
//
// 运行在 Windows lane 的 native-git（runner 管理员）阶段：标准本地用户没有
// SeCreateSymbolicLinkPrivilege，无法构造符号链接负控；本文件只证明「创建调用
// 不会跟随悬空链接写出树外对象」，不主张普通用户隔离证据（那由 private-data 阶段承担）。
//
// 管理员创建的目录默认 owner 是 BUILTIN\\Administrators，而 helper 的 profile 门要求
// owner=当前用户且 allow 主体只含受信集合；因此这里用一次显式 canonical DACL 建立
// launcher 形状的 profile（与 helper 对 root 的 canonical 形状一致），再进入产品路径。
import '../fixtures/resolution-preflight.mjs'

import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { prepareWindowsProjectData } from '../../apps/harness-plugin/src/host-private-windows.ts'
import { setAcl } from './harness-plugin-windows-fixture.js'

const unavailable = (error) => {
  assert.equal(error?.name, 'HostAuthorityError', '拒绝必须使用既有 HostAuthorityError')
  assert.equal(error?.message, 'Host project data is unavailable', '固定错误文案不得改变')
  return true
}

test('native dangling reparse at a fixed private-data object or the data root is refused without creating its target', { skip: process.platform !== 'win32' }, async (t) => {
  const canonical = async (t) => {
    // 用 USERPROFILE（长路径）而不是 os.tmpdir()：GitHub runner 的 TEMP 可能解析到 8.3 短名
    // （如 C:\\Users\\RUNNER~1\\...），而 helper 的 Lexical 明确拒绝 `~` 别名。
    const base = fs.mkdtempSync(path.join(os.homedir(), 'harness-reparse-'))
    t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
    const profile = path.join(base, 'profile')
    fs.mkdirSync(profile) // launcher 形状：普通 mkdir；管理员创建的目录默认 owner 是 Administrators，helper 的 profile 门要求 owner=当前用户，因此用既有 setAcl 写成 canonical 形状
    setAcl(profile)
    const lease = await prepareWindowsProjectData(profile)
    fs.closeSync(lease.logFd)
    await lease.dispose()
    return { base, profile }
  }

  for (const name of ['workspace.sqlite', 'diagnostics.log']) await t.test(name, async (t) => {
    const { base, profile } = await canonical(t)
    const objectPath = path.join(profile, 'harness-projects', name)
    const target = path.join(base, `outside-${name}`)
    fs.unlinkSync(objectPath)
    fs.symlinkSync(target, objectPath, 'file')
    try {
      await assert.rejects(() => prepareWindowsProjectData(profile), unavailable)
      assert.equal(fs.existsSync(target), false, `${name} 的悬空链接目标不得被创建`)
      assert.equal(fs.lstatSync(objectPath).isSymbolicLink(), true, `${name} 的链接不得被创建调用替换`)
    } finally {
      fs.unlinkSync(objectPath)
    }
  })

  await t.test('harness-projects', async (t) => {
    // #662 的目录分支：CreateDirectoryW 没有 reparse flag，创建前只靠 ProbeChecked。root 换成
    // 指向树外不存在目录的 dangling junction 时必须被既有 Open 以 type 拒绝，且不得在树外建目录。
    const { base, profile } = await canonical(t)
    const root = path.join(profile, 'harness-projects')
    const held = `${root}-held`
    fs.renameSync(root, held)
    const dbPath = path.join(held, 'workspace.sqlite')
    fs.writeFileSync(dbPath, 'reparse-sentinel')
    const dbBefore = fs.readFileSync(dbPath)
    const target = path.join(base, 'outside-root')
    fs.symlinkSync(target, root, 'junction')
    try {
      await assert.rejects(() => prepareWindowsProjectData(profile), unavailable)
      assert.equal(fs.existsSync(target), false, '目录悬空 junction 的目标不得被创建')
      assert.equal(fs.lstatSync(root).isSymbolicLink(), true, '目录链接不得被创建调用替换')
      assert.deepEqual(fs.readFileSync(dbPath), dbBefore, '拒绝不得改写既有数据库')
      // adoption-after-release：摘除链接后，既有 canonical 数据根必须能被再次正常接纳。
      fs.unlinkSync(root)
      fs.renameSync(held, root)
      const recovered = await prepareWindowsProjectData(profile)
      try { assert.equal(recovered.signal.aborted, false) } finally { fs.closeSync(recovered.logFd); await recovered.dispose() }
    } finally {
      // lstat 不跟随 reparse：悬空 junction 的 existsSync 会返回 false，不能用来判存在。
      const linkAtRoot = (() => { try { return fs.lstatSync(root).isSymbolicLink() } catch { return false } })()
      if (linkAtRoot) fs.unlinkSync(root)
      if (fs.existsSync(held) && !fs.existsSync(root)) fs.renameSync(held, root)
    }
  })
})
