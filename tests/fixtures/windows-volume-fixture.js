// 真实卷/映射盘 fixture（ExecPlan docs/exec-plan/completed/2026-11-24-native-volume-refusal.md）。
//
// 两类入口：
// - 纯判定（卷标上限、helper token 重组、目录快照、私有对象名）在 POSIX 上也可判别，
//   契约测试与集成用例共用同一实现；
// - 原生适配器（CIM 查询、net use、写探针）只在 win32 上被调用，import 本身无副作用。
// 设备坐标不通过 argv/env 传入：卷按固定标签、共享按固定名发现，发现失败显式抛错。
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// 两类真实非 NTFS 本地卷（#679 Batch 2）：exFAT 是现实外接介质场景，真实卷根的
// BY_HANDLE_FILE_INFORMATION 文件标识为 0，identity gate 先于 filesystem gate 拒绝；
// ReFS 有真实 file ID，能命中 GetVolumeInformationByHandleW 的 filesystem gate。
// 两者都保留，避免最终 head 丢掉「现实 exFAT 场景仍被拒」的证据。
export const VOLUME_LABELS = { exfat: 'HARNESSFAT', refs: 'HARNESSRFS' }
export const SHARE_NAME = 'harness-vol-fixture'
export const VOLUME_LABEL_LIMIT = 11
export const REFUSAL_TOKENS = {
  exfatVolumeIdentity: 'private-windows-error-volume-identity',
  refsVolumeFilesystem: 'private-windows-error-volume-filesystem',
  bindingDrive: 'private-windows-error-binding-drive',
}
const PRIVATE_NAME = /^(?:harness-projects|workspace\.sqlite(?:-wal|-shm|-journal)?|diagnostics\.log)$/
const TOKEN = /private-windows-error-[a-z]+-[a-z]+/g

export function volumeLabelError(label) {
  if (typeof label !== 'string' || label.length === 0) return '卷标必须是非空字符串'
  if (label.length > VOLUME_LABEL_LIMIT) return `卷标 ${JSON.stringify(label)} 超过 ${VOLUME_LABEL_LIMIT} 字符上限`
  if (!/^[A-Z0-9]+$/.test(label)) return `卷标 ${JSON.stringify(label)} 含不允许字符`
  return null
}

/** 子进程 stdout 可能按任意 chunk 到达；先累积再抽取，避免 token 被切断导致假绿。 */
export function createTokenTap() {
  let buffer = ''
  return {
    push(chunk) { buffer += String(chunk ?? '') },
    output() { return buffer },
    tokens() { return [...buffer.matchAll(TOKEN)].map((match) => match[0]) },
  }
}

export function assertRefusalToken(tap, expected) {
  const tokens = tap.tokens()
  assert.ok(tokens.includes(expected), `缺少精确拒绝 token ${expected}；observed=${JSON.stringify(tokens)}`)
  assert.equal(new Set(tokens).size, 1, `拒绝只应来自一个 helper 分支；observed=${JSON.stringify(tokens)}`)
}

/** 记录目标目录的条目集合与每个文件的字节/大小/mtime，用于证明拒绝路径零写入。 */
export function snapshotTree(root) {
  const entries = []
  const files = new Map()
  const walk = (dir, prefix, depth) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${name.name}` : name.name
      const location = path.join(dir, name.name)
      entries.push(relative)
      if (name.isDirectory() && depth < 4) {
        walk(location, relative, depth + 1)
      } else if (name.isFile()) {
        const stat = fs.statSync(location)
        files.set(relative, {
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs),
          sha256: createHash('sha256').update(fs.readFileSync(location)).digest('hex'),
        })
      }
    }
  }
  walk(root, '', 0)
  return { entries, files }
}

export function assertTreeUnchanged(before, after, label) {
  assert.deepEqual(after.entries, before.entries, `${label}：条目集合必须不变`)
  assert.deepEqual([...after.files.keys()].sort(), [...before.files.keys()].sort(), `${label}：文件集合必须不变`)
  for (const [name, state] of before.files) {
    const next = after.files.get(name)
    assert.ok(next, `${label}：${name} 必须仍然存在`)
    assert.equal(next.size, state.size, `${label}：${name} 的大小从 ${state.size} 变成 ${next.size}`)
    assert.equal(next.sha256, state.sha256, `${label}：${name} 的字节内容必须不变`)
    assert.equal(next.mtimeMs, state.mtimeMs, `${label}：${name} 的 mtime 必须不变`)
  }
}

export function findPrivateObjects(root) {
  const found = []
  const walk = (dir, prefix, depth) => {
    if (depth > 4) return
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${name.name}` : name.name
      if (PRIVATE_NAME.test(name.name)) found.push(relative)
      if (name.isDirectory()) walk(path.join(dir, name.name), relative, depth + 1)
    }
  }
  if (fs.existsSync(root)) walk(root, '', 0)
  return found.sort()
}

/** 拒绝前预置固定字节哨兵，记录 size/mtime/sha256；拒绝后必须逐项不变（AC2 字面证据）。 */
export function writeSentinel(file) {
  const bytes = Buffer.from('volume-sentinel-v1', 'utf8')
  fs.writeFileSync(file, bytes)
  const stat = fs.statSync(file)
  return { path: file, size: stat.size, mtimeMs: Math.round(stat.mtimeMs), sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function assertSentinelUnchanged(record, label) {
  assert.ok(fs.existsSync(record.path), `${label}：哨兵文件必须仍然存在`)
  const bytes = fs.readFileSync(record.path)
  const stat = fs.statSync(record.path)
  assert.equal(bytes.length, record.size, `${label}：哨兵大小必须不变`)
  assert.equal(Math.round(stat.mtimeMs), record.mtimeMs, `${label}：哨兵 mtime 必须不变`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, `${label}：哨兵字节必须不变`)
}

/** 卷根只做定点检查：非递归列出可见条目，不进入 System Volume Information 等系统目录。 */
export const PRIVATE_OBJECT_NAMES = ['harness-projects', 'workspace.sqlite', 'workspace.sqlite-wal', 'workspace.sqlite-shm', 'workspace.sqlite-journal', 'diagnostics.log']

export function rootListing(root) {
  return fs.readdirSync(root, { withFileTypes: true }).map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).sort()
}

export function assertDeviceRootUntouched(root, profilePath, label) {
  for (const name of PRIVATE_OBJECT_NAMES) {
    assert.equal(fs.existsSync(path.join(root, name)), false, `${label}：卷根不得出现私有对象 ${name}`)
    assert.equal(fs.existsSync(path.join(profilePath, name)), false, `${label}：目标 profile 内不得出现私有对象 ${name}`)
  }
  assert.equal(fs.existsSync(profilePath), false, `${label}：拒绝不得创建目标 profile`)
}

export function assertNoPrivateObjects(root, label) {
  const found = findPrivateObjects(root)
  assert.deepEqual(found, [], `${label}：拒绝路径不得留下私有对象 ${JSON.stringify(found)}`)
}

export const deviceRoot = (device) => `${device}\\`
export const refusalProfilePath = (device) => `${device}\\volume-refusal`

// ---- win32 adapters: 只在原生用例里调用 ----
export const powershell = () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export function ps(program, input = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'))
  env.PSModulePath = path.join(path.dirname(powershell()), 'Modules')
  const prelude = "$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');$utf8=[Text.UTF8Encoding]::new($false);[Console]::InputEncoding=$utf8;[Console]::OutputEncoding=$utf8;"
  return childProcess.execFileSync(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', prelude + program], {
    input: JSON.stringify(input) + '\n', encoding: 'utf8', timeout: 15000, windowsHide: true, env,
  }).trim()
}

const DISCOVER = String.raw`$ErrorActionPreference='Stop';$p=[Console]::ReadLine()|ConvertFrom-Json
$disks=@(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.VolumeName -eq $p.label } | ForEach-Object {
  @{device=$_.DeviceID;driveType=[int]$_.DriveType;fileSystem=$_.FileSystem;volumeLabel=$_.VolumeName;providerName=[string]$_.ProviderName}})
ConvertTo-Json -InputObject @{count=$disks.Count;disks=$disks} -Compress -Depth 4`

export function findVolumeDrive(label) {
  const result = JSON.parse(ps(DISCOVER, { label }))
  assert.equal(result.count, 1, `按卷标 ${label} 发现的候选卷必须恰好一个，实际 ${result.count}`)
  return Array.isArray(result.disks) ? result.disks[0] : result.disks
}

const FACTS = String.raw`$ErrorActionPreference='Stop';$p=[Console]::ReadLine()|ConvertFrom-Json
$disk=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='"+$p.device+"'") -ErrorAction Stop
@{device=$disk.DeviceID;driveType=[int]$disk.DriveType;fileSystem=$disk.FileSystem;volumeLabel=$disk.VolumeName;providerName=[string]$disk.ProviderName}|ConvertTo-Json -Compress`

export function driveFacts(device) {
  return JSON.parse(ps(FACTS, { device }))
}

export function freeDriveLetter(candidates = 'LMNOPQRSTUVWXY') {
  const used = JSON.parse(ps("ConvertTo-Json -InputObject @([IO.DriveInfo]::GetDrives()|ForEach-Object{$_.Name.Substring(0,1)}) -Compress"))
  for (const letter of candidates) if (!used.includes(letter)) return `${letter}:`
  throw new Error('no free drive letter for the mapped volume fixture')
}

export function mapDrive(device, unc) {
  return childProcess.execFileSync('net.exe', ['use', device, unc, '/persistent:no'], { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim()
}

export function unmapDrive(device) {
  try {
    childProcess.execFileSync('net.exe', ['use', device, '/delete'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  } catch {
    // 清理幂等：映射已不存在时保持原失败结论，不把清理错误当测试失败。
  }
}

/** 写/读/删探针：证明设备对当前（标准用户）进程可达可写，拒绝不是只读或不可达造成的假象。 */
export function assertWritable(device, name) {
  const file = `${device}\\${name}`
  const bytes = Buffer.from('volume-probe', 'utf8')
  fs.writeFileSync(file, bytes)
  try {
    assert.deepEqual(fs.readFileSync(file), bytes)
  } finally {
    fs.rmSync(file, { force: true })
  }
  return bytes.length
}

export const shareUnc = (hostname = process.env.COMPUTERNAME) => `\\\\${hostname}\\${SHARE_NAME}`
