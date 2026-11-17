// Windows 原生 lane runner 的可执行表述（ExecPlan `2026-11-17-windows-native-lane` Batch 2）。
//
// 判定的对象是「反空心」：清单文件必须存在且位于 tests/integration/、不得重复、
// 每文件有正整数下界；运行结果必须逐文件成功、摘要可解析、真正执行、达到下界、
// todo 为零，且合计 skip 数精确等于预算。hosted Windows 才跑真正的原生用例；
// 这里在 POSIX 上判别纯函数与 CLI 的失败语义，不能替代 hosted 证据。

import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SETS, evaluate, manifestErrors, parseArgs, platformRefusal } from '../../scripts/windows-native-checks.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/windows-native-checks.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function withRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-native-checks-'));
  for (const name of files) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// fixture\n');
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** 与 `runFile` 同形的结果；`tests` 默认 1，`skipped` 默认 0。 */
function result(file, { status = 0, tests = 1, skipped = 0, todo = 0 } = {}) {
  const output = [`ℹ tests ${tests}`, 'ℹ pass 1', 'ℹ fail 0', `ℹ skipped ${skipped}`, `ℹ todo ${todo}`];
  return { file, status, output: `${output.join('\n')}\n` };
}

function outputOf(run) {
  return `${run.stdout ?? ''}${run.stderr ?? ''}`;
}

function runCli(argv) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: ROOT, encoding: 'utf8', env });
}

test('SETS 是唯一清单来源：文件位于 tests/integration、真实存在、下界为正整数、互不重复', () => {
  assert.deepEqual(Object.keys(SETS).sort(), ['native-git', 'private-data']);
  const seen = new Set();
  for (const [setId, set] of Object.entries(SETS)) {
    assert.ok(Array.isArray(set.files) && set.files.length > 0, `set ${setId} 的 files 必须非空`);
    assert.ok(Number.isInteger(set.allowedSkips) && set.allowedSkips >= 0, `set ${setId} 的 allowedSkips 必须是非负整数`);
    for (const { file, minTests } of set.files) {
      assert.match(file, /^tests\/integration\/[^/]+\.test\.js$/, `set ${setId} 的文件必须是 tests/integration/*.test.js：${file}`);
      assert.ok(Number.isInteger(minTests) && minTests > 0, `set ${setId} 的 ${file} 必须有正整数 minTests`);
      assert.ok(fs.statSync(path.join(ROOT, file)).isFile(), `${file} 必须真实存在`);
      assert.ok(!seen.has(file), `文件在清单里重复：${file}`);
      seen.add(file);
    }
  }
  assert.deepEqual(manifestErrors(ROOT), [], '仓库内真实清单必须无问题');
});

test('manifestErrors 拒绝缺失文件、清单清空、重复项、越界路径、非 .test.js 与非法下界', () => {
  const fixture = withRoot(['tests/integration/present.test.js']);
  try {
    const { root } = fixture;
    const missing = manifestErrors(root, { s: { files: [{ file: 'tests/integration/absent.test.js', minTests: 1 }], allowedSkips: 0 } });
    assert.ok(missing.some((problem) => /不存在/.test(problem)), `缺少文件必须报错：${missing}`);
    const empty = manifestErrors(root, { s: { files: [], allowedSkips: 0 } });
    assert.ok(empty.some((problem) => /非空数组/.test(problem)), `清单被清空必须报错：${empty}`);
    const duplicate = manifestErrors(root, {
      s: { files: [{ file: 'tests/integration/present.test.js', minTests: 1 }, { file: 'tests/integration/present.test.js', minTests: 1 }], allowedSkips: 0 },
    });
    assert.ok(duplicate.some((problem) => /重复/.test(problem)), `重复项必须报错：${duplicate}`);
    for (const file of ['tests/contract/present.test.js', 'tests/integration/../contract/present.test.js']) {
      const escaped = manifestErrors(root, { s: { files: [{ file, minTests: 1 }], allowedSkips: 0 } });
      assert.ok(escaped.some((problem) => /位于 tests\/integration\//.test(problem)), `越界路径必须报错：${file} ${escaped}`);
    }
    const notTest = manifestErrors(root, { s: { files: [{ file: 'tests/integration/helper.mjs', minTests: 1 }], allowedSkips: 0 } });
    assert.ok(notTest.some((problem) => /\.test\.js/.test(problem)), `非测试文件名必须报错：${notTest}`);
    const badFloor = manifestErrors(root, { s: { files: [{ file: 'tests/integration/present.test.js', minTests: 0 }], allowedSkips: 0 } });
    assert.ok(badFloor.some((problem) => /minTests/.test(problem)), `非法下界必须报错：${badFloor}`);
  } finally {
    fixture.cleanup();
  }
});

test('parseArgs 只接受白名单 flag，拒绝未知 set、位置参数、重复与组合错误', () => {
  assert.deepEqual(parseArgs(['--set', 'native-git']), { setId: 'native-git', profile: null, foreign: null });
  assert.deepEqual(parseArgs(['--set', 'private-data', '--profile', 'C:/p', '--foreign', 'C:/f']), {
    setId: 'private-data', profile: 'C:/p', foreign: 'C:/f',
  });
  for (const argv of [
    [],
    ['--set', 'nope'],
    ['native-git'],
    ['--set'],
    ['--set', 'native-git', '--set', 'private-data'],
    ['--set', 'native-git', '--bogus'],
    ['--set', 'native-git', '--profile', 'C:/p'],
    ['--set', 'native-git', '--foreign', 'C:/f'],
    ['--set', 'private-data', '--foreign', 'C:/f'],
  ]) {
    assert.throws(() => parseArgs(argv), Error, `必须拒绝：${JSON.stringify(argv)}`);
  }
});

test('platformRefusal 只放行 win32，其余平台返回非空拒绝文案而不是 mock 替代', () => {
  assert.equal(platformRefusal('win32'), null);
  for (const platform of ['darwin', 'linux', 'freebsd']) {
    const refusal = platformRefusal(platform);
    assert.ok(typeof refusal === 'string' && refusal.length > 0, `${platform} 必须被拒绝`);
    assert.match(refusal, /win32/);
  }
});

test('evaluate 对合法输入返回空 problems 与合计 counts', () => {
  const gitFiles = SETS['native-git'].files;
  const git = gitFiles.map(({ file, minTests }) => result(file, { tests: minTests }));
  const verdict = evaluate('native-git', git);
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual(verdict.totals, {
    files: gitFiles.length,
    tests: gitFiles.reduce((total, { minTests }) => total + minTests, 0),
    skipped: 0,
    todo: 0,
  });

  const privateFiles = SETS['private-data'].files;
  const privateData = privateFiles.map(({ file, minTests }) => result(file, { tests: minTests }));
  const privateVerdict = evaluate('private-data', privateData);
  assert.deepEqual(privateVerdict.problems, []);
  assert.equal(privateVerdict.totals.skipped, 0, 'allowedSkips=0 的精确预算被接受');
});

test('evaluate 拒绝失败、缺摘要、零执行、低于下界、todo、skip 预算不符与缺 run', () => {
  const [first, ...rest] = SETS['native-git'].files;
  const minTests = first.minTests;
  const baseline = SETS['native-git'].files.map(({ file }) => result(file, { tests: minTests }));
  const cases = [
    ['失败退出码', [{ ...baseline[0], status: 1 }, ...rest.map(({ file }) => result(file))], /退出码/],
    ['缺摘要', [{ ...baseline[0], output: 'no summary here\n' }, ...rest.map(({ file }) => result(file))], /摘要/],
    ['零执行', [result(first.file, { tests: 0 }), ...rest.map(({ file }) => result(file))], /零执行/],
    ['低于下界', [result(first.file, { tests: minTests - 1 }), ...rest.map(({ file }) => result(file))], /下界/],
    ['todo 非零', [result(first.file, { tests: minTests, todo: 1 }), ...rest.map(({ file }) => result(file))], /todo/],
    ['skip 预算不符', [result(first.file, { tests: minTests, skipped: 1 }), ...rest.map(({ file }) => result(file))], /skip/],
    ['缺少 run 结果', baseline.slice(0, 1), /缺少/],
  ];
  for (const [label, results, pattern] of cases) {
    const verdict = evaluate('native-git', results);
    assert.ok(verdict.problems.length > 0, `${label} 必须产生 problems`);
    assert.ok(verdict.problems.some((problem) => pattern.test(problem)), `${label} 必须点名原因：${verdict.problems}`);
  }
});

test('allowedSkips 预算等于清单文件里 win32 上真正生效的 skip 标记数', () => {
  // 保护预算本身：新增一条 win32-active skip 却不改 SETS 时，lane 的精确计数
  // 会因「多一条」变红；这里让同一次 PR 在 POSIX 契约层就先红。只认字面量
  // `skip: process.platform === 'win32'`（清单里唯一形式）；`!==` 的 POSIX
  // 条件在 win32 上不生效，不算预算。
  const marker = /skip:\s*process\.platform === 'win32'/g;
  let active = 0;
  for (const set of Object.values(SETS)) {
    for (const { file } of set.files) {
      active += (fs.readFileSync(path.join(ROOT, file), 'utf8').match(marker) ?? []).length;
    }
  }
  const budget = Object.values(SETS).reduce((total, set) => total + set.allowedSkips, 0);
  assert.equal(active, budget, 'win32-active skip 数与 allowedSkips 预算必须同步（#644 接管后两者都为 0）');
});

test('CLI 对非法参数与非 win32 平台 exit 1 并输出 ::error::，不静默通过', () => {
  for (const argv of [['--set', 'nope'], ['--bogus'], []]) {
    const run = runCli(argv);
    assert.equal(run.status, 1, `${JSON.stringify(argv)} 必须 exit 1；输出：${outputOf(run)}`);
    assert.match(outputOf(run), /::error::/, `${JSON.stringify(argv)} 必须打印 ::error::`);
  }
  if (process.platform !== 'win32') {
    const run = runCli(['--set', 'native-git']);
    assert.equal(run.status, 1, `非 win32 必须 exit 1；输出：${outputOf(run)}`);
    assert.match(outputOf(run), /::error::/);
    assert.match(outputOf(run), /win32/);
  }
});
