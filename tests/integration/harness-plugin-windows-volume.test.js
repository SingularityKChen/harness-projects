// Windows 原生真实卷/映射盘拒绝证据（ExecPlan docs/exec-plan/completed/2026-11-24-native-volume-refusal.md）。
//
// 由 CI 阶段 2 的临时标准用户进程执行；管理员只预置两块真实固定卷（exFAT 与 ReFS）
// 与回环 SMB 共享。五条用例分别钉住：现实 exFAT 卷在卷准入阶段被拒（真实卷根
// identity gate 先于文件系统 gate）、ReFS 卷命中卷文件系统 gate、映射网络盘在
// DriveType gate 被拒、同一生产入口在真实 NTFS 上被接纳（拒绝一切的反例）、拒绝
// 不通过 Host apply 发布任何 authority。设备事实先于产品断言，拒绝 token 来自
// helper 自己的 stdout。
import '../fixtures/resolution-preflight.mjs'

import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../../apps/harness-plugin/src/host.ts'
import { prepareWindowsProjectData } from '../../apps/harness-plugin/src/host-private-windows.ts'
import { denied, hostFixture, ordinaryToken, windowsFixture } from './harness-plugin-windows-fixture.js'
import {
  VOLUME_LABELS, SHARE_NAME, REFUSAL_TOKENS, createTokenTap, assertRefusalToken, findVolumeDrive,
  driveFacts, freeDriveLetter, mapDrive, unmapDrive, assertWritable, snapshotTree, assertTreeUnchanged,
  assertNoPrivateObjects, rootListing, assertDeviceRootUntouched, writeSentinel, assertSentinelUnchanged,
  refusalProfilePath, shareUnc,
} from '../fixtures/windows-volume-fixture.js'

const native = { skip: process.platform !== 'win32' }

/** 生产 helper 的拒绝分支由它自己 stdout 的 token 判别；调用期间累积子进程输出，测试后还原 spawn。 */
function captureHelperTokens(t) {
  const spawn = childProcess.spawn
  const tap = createTokenTap()
  childProcess.spawn = (...args) => {
    const child = spawn(...args)
    child.stdout?.on('data', (chunk) => tap.push(String(chunk)))
    return child
  }
  t.after(() => { childProcess.spawn = spawn })
  return tap
}

function mapFixtureShare() {
  const device = freeDriveLetter()
  mapDrive(device, shareUnc())
  return device
}

/** 真实设备拒绝的共同断言：事实先行、精确 token、零写入、目标 profile 不得被创建。 */
async function assertRefusedDevice(t, { label, expectedFileSystem, expectedToken }) {
  ordinaryToken(t)
  const volume = findVolumeDrive(label)
  t.diagnostic(JSON.stringify({ label, ...volume }))
  assert.deepEqual([volume.driveType, volume.fileSystem, volume.volumeLabel], [3, expectedFileSystem, label], '设备事实必须是预期的真实固定卷')
  assert.ok(assertWritable(volume.device, 'volume-write-probe.txt') > 0, '设备必须对当前标准用户可写')
  const root = `${volume.device}\\`
  const profile = refusalProfilePath(volume.device)
  const sentinel = writeSentinel(path.join(root, 'volume-refusal-sentinel.bin'))
  try {
    const listing = rootListing(root)
    assertDeviceRootUntouched(root, profile, `${label} 基线`)
    const tap = captureHelperTokens(t)
    await assert.rejects(() => prepareWindowsProjectData(profile), denied)
    assertRefusalToken(tap, expectedToken)
    assertSentinelUnchanged(sentinel, `${label} 拒绝`)
    assert.deepEqual(rootListing(root), listing, `${label}：卷根可见条目必须不变`)
    assertDeviceRootUntouched(root, profile, `${label} 拒绝`)
  } finally {
    fs.rmSync(sentinel.path, { force: true })
  }
}

test('native exFAT fixed volume is refused at the volume admission gate before any private object exists', native, async (t) => {
  await assertRefusedDevice(t, { label: VOLUME_LABELS.exfat, expectedFileSystem: 'exFAT', expectedToken: REFUSAL_TOKENS.exfatVolumeIdentity })
})

test('native ReFS fixed volume is refused at the volume filesystem gate before any private object exists', native, async (t) => {
  await assertRefusedDevice(t, { label: VOLUME_LABELS.refs, expectedFileSystem: 'ReFS', expectedToken: REFUSAL_TOKENS.refsVolumeFilesystem })
})

test('native mapped network drive is refused at the DriveType gate before any private object exists', native, async (t) => {
  ordinaryToken(t)
  const device = mapFixtureShare()
  try {
    const facts = driveFacts(device)
    t.diagnostic(JSON.stringify({ kind: 'mapped', ...facts }))
    assert.equal(facts.driveType, 4, '映射盘必须报告 Network（DriveType 4）')
    assert.equal(facts.providerName.toLowerCase(), shareUnc().toLowerCase(), '映射盘的 provider 必须指向预置共享')
    assert.ok(assertWritable(device, 'mapped-write-probe.txt') > 0, '映射盘必须对当前标准用户可写')
    const root = `${device}\\`
    const sentinel = writeSentinel(path.join(root, 'mapped-refusal-sentinel.bin'))
    try {
      const before = snapshotTree(root)
      const tap = captureHelperTokens(t)
      await assert.rejects(() => prepareWindowsProjectData(refusalProfilePath(device)), denied)
      assertRefusalToken(tap, REFUSAL_TOKENS.bindingDrive)
      assertSentinelUnchanged(sentinel, '映射盘拒绝')
      assertTreeUnchanged(before, snapshotTree(root), '映射盘拒绝')
      assertNoPrivateObjects(root, '映射盘拒绝')
    } finally {
      fs.rmSync(sentinel.path, { force: true })
    }
  } finally {
    unmapDrive(device)
  }
})

test('native NTFS positive control is admitted through the same production path', native, async (t) => {
  const f = await windowsFixture(t)
  const facts = driveFacts(f.profile.slice(0, 2))
  t.diagnostic(JSON.stringify({ kind: 'ntfs-positive', ...facts }))
  assert.deepEqual([facts.driveType, facts.fileSystem], [3, 'NTFS'], '正控必须落在真实 NTFS 固定卷上')
  const lease = await prepareWindowsProjectData(f.profile)
  try {
    assert.equal(lease.signal.aborted, false)
    assert.deepEqual([fs.existsSync(f.root), fs.existsSync(f.dataPath), fs.existsSync(f.log)], [true, true, true], '正控必须走通同一私有数据入口')
  } finally {
    fs.closeSync(lease.logFd)
    await lease.dispose()
  }
})

test('native volume refusals publish no Host authority through the production apply path', native, async (t) => {
  ordinaryToken(t)
  const exfat = findVolumeDrive(VOLUME_LABELS.exfat)
  const refs = findVolumeDrive(VOLUME_LABELS.refs)
  const mapped = mapFixtureShare()
  try {
    for (const profile of [refusalProfilePath(exfat.device), refusalProfilePath(refs.device), refusalProfilePath(mapped)]) {
      await assert.rejects(() => hostFixture(apply, { profile }), (error) => {
        assert.equal(error.name, denied.name, 'Host apply 必须折叠为固定拒绝错误')
        assert.doesNotMatch(error.message, /[A-Z]:\\/i, 'Host 错误面不得回显设备路径')
        return true
      })
    }
  } finally {
    unmapDrive(mapped)
  }
})
