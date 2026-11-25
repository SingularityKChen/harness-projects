// 真实卷/映射盘 fixture 的纯逻辑契约（ExecPlan 2026-11-24-native-volume-refusal，Batch 1）。
//
// 这里在 POSIX 上判别 fixture helper 的可失败性质：卷标上限、跨 chunk 的 helper
// token 重组、快照对新增对象/字节/mtime 的敏感度、私有对象名命中。hosted Windows
// 原生行为不在这里证明（由 integration 用例与 PR CI 承担）。

import '../fixtures/resolution-preflight.mjs'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  VOLUME_LABELS, SHARE_NAME, volumeLabelError, createTokenTap, assertRefusalToken,
  snapshotTree, assertTreeUnchanged, findPrivateObjects, rootListing, assertDeviceRootUntouched,
  writeSentinel, assertSentinelUnchanged,
} from '../fixtures/windows-volume-fixture.js'

test('卷标与共享名契约：exFAT/ReFS 两个真实卷标互异、均在 11 字符上限内，超长/非法卷标被判无效', () => {
  assert.deepEqual(Object.keys(VOLUME_LABELS), ['exfat', 'refs']);
  const labels = Object.values(VOLUME_LABELS);
  assert.equal(new Set(labels).size, labels.length, '两个真实卷的卷标必须互不相同');
  for (const label of labels) {
    assert.ok(label.length > 0 && label.length <= 11, '卷标必须非空且不超过 11 字符');
    assert.match(label, /^[A-Z0-9]+$/, '卷标只允许大写字母与数字');
    assert.equal(volumeLabelError(label), null);
  }
  for (const label of ['', 'HARNESS-NATIVE-EXFAT', 'BAD LABEL', 'bad_label']) {
    assert.ok(volumeLabelError(label), `${JSON.stringify(label)} 必须被判无效`);
  }
  assert.match(SHARE_NAME, /^[a-z0-9-]+$/, '共享名必须是稳定的低风险字面量');
})

test('token tap 跨 chunk 重组精确 helper token；没有 token 时断言必须抛错', () => {
  const tap = createTokenTap();
  tap.push('noise\r\nprivate-windows-error-volume-');
  tap.push('filesystem\r\nmore');
  assert.deepEqual(tap.tokens(), ['private-windows-error-volume-filesystem']);
  assertRefusalToken(tap, 'private-windows-error-volume-filesystem');
  const missing = createTokenTap();
  missing.push('Host project data is unavailable\n');
  assert.deepEqual(missing.tokens(), [], 'generic denied 不得被当成拒绝 token');
  assert.throws(() => assertRefusalToken(missing, 'private-windows-error-binding-drive'), /token/);
})

test('snapshotTree 能区分新增对象、字节变化与 mtime 变化', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-volume-snapshot-'));
  try {
    fs.writeFileSync(path.join(root, 'sentinel.bin'), 'abc');
    const before = snapshotTree(root);
    assertTreeUnchanged(before, snapshotTree(root), '未变化快照');
    fs.writeFileSync(path.join(root, 'extra.bin'), 'x');
    assert.throws(() => assertTreeUnchanged(before, snapshotTree(root), '新增对象'), /extra\.bin|新增/);
    fs.rmSync(path.join(root, 'extra.bin'));
    fs.writeFileSync(path.join(root, 'sentinel.bin'), 'abd');
    const originalMtime = before.files.get('sentinel.bin').mtimeMs / 1000;
    fs.utimesSync(path.join(root, 'sentinel.bin'), originalMtime, originalMtime);
    assert.throws(() => assertTreeUnchanged(before, snapshotTree(root), '字节变化'), {
      code: 'ERR_ASSERTION', message: /^字节变化：sentinel\.bin 的字节内容必须不变(?:\n|$)/,
    });
    fs.writeFileSync(path.join(root, 'sentinel.bin'), 'abc');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(root, 'sentinel.bin'), past, past);
    assert.throws(() => assertTreeUnchanged(before, snapshotTree(root), 'mtime 变化'), /mtime|sentinel\.bin/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})

test('findPrivateObjects 命中私有根/库/日志名，干净目录返回空', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-volume-private-'));
  try {
    assert.deepEqual(findPrivateObjects(root), []);
    fs.mkdirSync(path.join(root, 'harness-projects'));
    fs.writeFileSync(path.join(root, 'harness-projects', 'workspace.sqlite'), '');
    fs.writeFileSync(path.join(root, 'harness-projects', 'diagnostics.log'), '');
    assert.deepEqual(findPrivateObjects(root), [
      'harness-projects',
      'harness-projects/diagnostics.log',
      'harness-projects/workspace.sqlite',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})
test('卷根定点检查不进入不可读系统目录，且对私有对象与目标 profile 有判别力', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-volume-device-root-'));
  const system = path.join(root, 'System Volume Information');
  const profile = path.join(root, 'volume-refusal');
  try {
    fs.mkdirSync(system);
    fs.chmodSync(system, 0o000);
    assert.deepEqual(rootListing(root), ['System Volume Information/']);
    assertDeviceRootUntouched(root, profile, 'clean');
    fs.mkdirSync(path.join(root, 'harness-projects'));
    assert.throws(() => assertDeviceRootUntouched(root, profile, 'private-root'), /harness-projects/);
    fs.rmSync(path.join(root, 'harness-projects'), { recursive: true, force: true });
    fs.writeFileSync(path.join(root, 'workspace.sqlite'), '');
    assert.throws(() => assertDeviceRootUntouched(root, profile, 'database'), /workspace\.sqlite/);
    fs.rmSync(path.join(root, 'workspace.sqlite'));
    fs.mkdirSync(profile);
    assert.throws(() => assertDeviceRootUntouched(root, profile, 'profile'), /目标 profile/);
  } finally {
    fs.chmodSync(system, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  }
})

test('writeSentinel/assertSentinelUnchanged 钉住拒绝前后哨兵字节、大小与 mtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-volume-sentinel-'));
  const file = path.join(root, 'volume-refusal-sentinel.bin');
  try {
    const record = writeSentinel(file);
    assert.ok(record.size > 0 && record.sha256.length === 64);
    assertSentinelUnchanged(record, '未变化哨兵');
    fs.writeFileSync(file, Buffer.alloc(record.size, 0x78));
    fs.utimesSync(file, record.mtimeMs / 1000, record.mtimeMs / 1000);
    assert.throws(() => assertSentinelUnchanged(record, '字节被改写'), {
      code: 'ERR_ASSERTION', message: /^字节被改写：哨兵字节必须不变(?:\n|$)/,
    });
    fs.writeFileSync(file, Buffer.from('volume-sentinel-v1', 'utf8'));
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(file, past, past);
    assert.throws(() => assertSentinelUnchanged(record, 'mtime 被改写'), /mtime/);
    fs.rmSync(file);
    assert.throws(() => assertSentinelUnchanged(record, '哨兵缺失'), /存在/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})

// darwin 上集成用例整组 skip，漏导入这类错误只会在 hosted Windows 暴露；这里用源码级
// 轻量守卫在 POSIX 契约层先抓住“使用了内建绑定但没有 import”的回归。
test('集成用例的 node 内建绑定都已导入（跳过分支的漏导入守卫）', () => {
  const source = fs.readFileSync(new URL('../integration/harness-plugin-windows-volume.test.js', import.meta.url), 'utf8')
  const imported = new Set([...source.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+'[^']+'/gm)].map((match) => match[1]))
  for (const binding of ['assert', 'childProcess', 'fs', 'path']) {
    if (new RegExp(`\\b${binding}\\.`).test(source)) assert.ok(imported.has(binding), `集成用例使用了 ${binding}. 但缺少对应 import`)
  }
  assert.ok(source.includes('test('), '集成用例必须仍然包含 test 调用')
})
