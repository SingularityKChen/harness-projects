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

const unavailable = (error) => {
  assert.equal(error?.name, 'HostAuthorityError', '拒绝必须使用既有 HostAuthorityError')
  assert.equal(error?.message, 'Host project data is unavailable', '固定错误文案不得改变')
  return true
}

const CANONICAL_PROFILE = String.raw`
$ErrorActionPreference = 'Stop'
$p = $env:HARNESS_REPARSE_PROFILE
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($sid)))
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$propagation = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$rights = [Security.AccessControl.FileSystemRights]::FullControl
foreach ($trustee in @($sid, 'S-1-5-18', 'S-1-5-32-544')) {
  $identity = New-Object Security.Principal.SecurityIdentifier($trustee)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, $rights, $inheritance, $propagation, $allow)
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $p -AclObject $acl
`

function canonicalProfile(profile) {
  const result = childProcess.spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CANONICAL_PROFILE], {
    env: { ...process.env, HARNESS_REPARSE_PROFILE: profile },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`canonical profile setup failed: ${result.stderr}`)
  // helper 的 profile 门要求 owner 与 allow 主体满足 private 形状；失败在第一次 prepare 就会暴露。
}

// 首次 prepare 意外失败时，直接以同一 PROGRAM 复跑一次并输出 helper 的固定错误 token，
// 让 hosted 失败能归因到具体 profile/ancestor/create 检查（token 不出现在产品错误里）。
function helperErrorToken(profile) {
  try {
    const source = fs.readFileSync(new URL('../../apps/harness-plugin/src/host-private-windows.ts', import.meta.url), 'utf8')
    const match = /const PROGRAM = String\.raw`([\s\S]*?)`\n\nconst unavailable/.exec(source)
    if (match === null) return 'PROGRAM 提取失败'
    const result = childProcess.spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', match[1]], {
      input: `${JSON.stringify({ profile })}\n`, encoding: 'utf8', timeout: 30000,
    })
    return `status=${result.status} stdout=${(result.stdout ?? '').trim()} stderr=${(result.stderr ?? '').trim()}`
  } catch (error) {
    return `诊断失败：${error?.message}`
  }
}

test('native dangling reparse at a fixed private-data object is refused without creating its target', { skip: process.platform !== 'win32' }, async (t) => {
  for (const name of ['workspace.sqlite', 'diagnostics.log']) await t.test(name, async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reparse-'))
    t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
    const profile = path.join(base, 'profile')
    fs.mkdirSync(profile) // launcher 形状：普通 mkdir；DACL/owner 由测试显式置为 canonical（管理员创建的默认 owner 是 Administrators）
    canonicalProfile(profile)

    // 先建立 canonical root 与固定对象；随后把目标对象替换为指向树外不存在目标的悬空链接。
    let lease
    try {
      lease = await prepareWindowsProjectData(profile)
    } catch (error) {
      throw new Error(`首次 prepare 被拒绝；helper 原始 token：${helperErrorToken(profile)}`)
    }
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
