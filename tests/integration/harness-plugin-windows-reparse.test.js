// Windows 私有数据创建不得跟随悬空 reparse（#662；PR #657 评审 P2 的后续修复）。
//
// 运行在 Windows lane 的 native-git（runner 管理员）阶段：标准本地用户没有
// SeCreateSymbolicLinkPrivilege，无法构造符号链接负控；本文件只证明「创建调用
// 不会跟随悬空链接写出树外对象」，不主张普通用户隔离证据（那由 private-data 阶段承担）。
import '../fixtures/resolution-preflight.mjs'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { prepareWindowsProjectData } from '../../apps/harness-plugin/src/host-private-windows.ts'

const unavailable = (error) => {
  assert.equal(error?.name, 'HostAuthorityError', '拒绝必须使用既有 HostAuthorityError')
  assert.equal(error?.message, 'Host project data is unavailable', '固定错误文案不得改变')
  return true
}

test('native dangling reparse at a fixed private-data object is refused without creating its target', { skip: process.platform !== 'win32' }, async (t) => {
  for (const name of ['workspace.sqlite', 'diagnostics.log']) await t.test(name, async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reparse-'))
    t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
    const profile = path.join(base, 'profile')
    fs.mkdirSync(profile) // launcher 形状：普通 mkdir，private DACL 只由 helper 在创建 root 时写入

    // 先建立 canonical root 与固定对象；随后把目标对象替换为指向树外不存在目标的悬空链接。
    const lease = await prepareWindowsProjectData(profile)
    fs.closeSync(lease.logFd)
    await lease.dispose()

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
})
