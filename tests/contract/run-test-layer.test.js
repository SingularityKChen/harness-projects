// 层运行器 `scripts/run-test-layer.mjs` 的可执行表述（ExecPlan `2026-09-21-merge-gate-layers` D2）。
//
// 它保护的不变量是"每一层都有真实执行的断言"：`node --test` 对"没有用例"退出 0，
// 所以"目录存在"与"这一层有证据"是两件事。这里用临时目录构造空层、零用例层、
// 全 skip / 全 todo 层与失败层，全部离线、无凭据；真实四层的非空与全绿在文件末尾
// 用真实的 `node --test` 各跑一次。
//
// 关于"摘要行解析不到"这条 fail-closed 分支：Node 26 的 runner 一旦启动成功，
// 即使用例文件语法错误、被 SIGKILL 或 `process.abort()`，也会打印 `ℹ tests <n>`
// （实测见 ExecPlan 的 Surprises & Discoveries）。因此这条分支无法用真实层做黑盒
// fixture，它的判据由 `parseSummary` 的单元断言钉住，CLI 侧的收尾由"层路径不存在"
// 与"空层"两条用例覆盖。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { countTestFiles, parseSummary } from '../../scripts/run-test-layer.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/run-test-layer.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// 真实层：与 `.github/workflows/merge-gate.yml` 的四条 lane 一一对应。这里只用
// 一个中性的探针不变量——车道文案由 `merge-gate-workflow.test.js` 钉住，本文件
// 钉的是"这些层真的有断言、且真的全绿"。
const REAL_LAYERS = [
  'tests/integration',
  'tests/contract/package-boundaries.test.js',
  'tests/mvp0',
  'tests/e2e',
];

const PROBE_INVARIANT = '探针：该层非空且全绿';

function withLayer(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-test-layer-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * `node --test` 给自己的子进程设置 `NODE_TEST_CONTEXT` / `NODE_TEST_WORKER_ID`。
 * 不清掉它们时，脚本再起的 `node --test` 会打印 "node:test run() is being called
 * recursively within a test file. skipping running files." 并且不打印任何摘要行
 * ——脚本于是 fail closed，本文件就观察不到真实运行结果。这里清掉这两个变量，
 * 让嵌套运行等价于 CI lane 里的顶层运行；Node 的递归保护在生产路径上不受影响。
 */
function runEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

function run(layer, invariant) {
  return spawnSync(process.execPath, [SCRIPT, layer, invariant], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: runEnv(),
  });
}

function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/** 失败的层必须同时给出退出码、`::error::` 注解、层名与被保护的不变量。 */
function assertLoudFailure(result, layer, invariant) {
  const output = outputOf(result);
  assert.equal(result.status, 1, `期望 exit 1，实际 ${result.status}；输出：${output}`);
  assert.match(output, /::error::/, `期望有 ::error:: 注解；输出：${output}`);
  assert.ok(output.includes(layer), `期望输出点名层 ${layer}；输出：${output}`);
  assert.ok(output.includes(invariant), `期望输出点名不变量 ${invariant}；输出：${output}`);
}

test('空层必须响亮失败：一个 *.test.js 都没有时 exit 1，并点名不变量', () => {
  const fixture = withLayer({});
  const invariant = '空层不算通过';
  try {
    const result = run(fixture.root, invariant);
    assertLoudFailure(result, fixture.root, invariant);
    // 必须由"数文件"这一步判出来：只看摘要行也能拦下空目录，但那样
    // "路径写错"与"这一层还没写用例"就分不开了。
    assert.match(outputOf(result), /没有任何 \*\.test\.js 用例文件/, `期望文件计数判定先失败；输出：${outputOf(result)}`);
  } finally {
    fixture.cleanup();
  }
});

test('层路径不存在时同样 exit 1：路径写错不能被读成"这一层没有问题"', () => {
  const missing = path.join(os.tmpdir(), 'run-test-layer-missing-layer-does-not-exist');
  const invariant = '层路径必须可解析';
  const result = run(missing, invariant);
  assertLoudFailure(result, missing, invariant);
  assert.match(outputOf(result), /没有任何 \*\.test\.js 用例文件/, `期望文件计数判定先失败；输出：${outputOf(result)}`);
});

test('零用例层必须失败：只有 describe 没有用例时 node --test 退出 0、摘要 tests 0', () => {
  const fixture = withLayer({
    'a.test.js': "import { describe } from 'node:test';\ndescribe('没有任何用例', () => {});\n",
  });
  const invariant = '零用例层不算通过';
  try {
    const result = run(fixture.root, invariant);
    assertLoudFailure(result, fixture.root, invariant);
    // 证明这条用例压的是"摘要行 tests 0"，而不是"文件数为 0"。
    assert.match(outputOf(result), /tests 0/, `期望透传的摘要行含 tests 0；输出：${outputOf(result)}`);
    assert.match(outputOf(result), /没有任何断言真正执行/, `期望零用例判定失败；输出：${outputOf(result)}`);
  } finally {
    fixture.cleanup();
  }
});

// Node 26 实测：只有 `test(name, { skip: true })` 的文件摘要行是 `ℹ tests 1` /
// `ℹ skipped 1`——skip 计入 tests。只判 `tests 0` 会让"整层被 skip 掉"看起来是
// 绿的，所以判据取"真正执行的用例数 = tests - skipped - todo"。
test('全 skip 的层必须失败：skip 计入 tests，零用例判据必须看 skipped', () => {
  const fixture = withLayer({
    'a.test.js': "import test from 'node:test';\ntest('被跳过', { skip: true }, () => {});\n",
  });
  const invariant = '全 skip 层不算通过';
  try {
    const result = run(fixture.root, invariant);
    assertLoudFailure(result, fixture.root, invariant);
    assert.match(outputOf(result), /skipped 1/, `期望透传的摘要行含 skipped 1；输出：${outputOf(result)}`);
    assert.match(outputOf(result), /没有任何断言真正执行/, `期望零用例判定失败；输出：${outputOf(result)}`);
  } finally {
    fixture.cleanup();
  }
});

test('全 todo 的层必须失败：todo 计入 tests，但没有断言真正执行', () => {
  const fixture = withLayer({
    'a.test.js': "import test from 'node:test';\ntest.todo('以后再说');\n",
  });
  const invariant = '全 todo 层不算通过';
  try {
    assertLoudFailure(run(fixture.root, invariant), fixture.root, invariant);
  } finally {
    fixture.cleanup();
  }
});

test('断言失败的层：退出码非零，且失败输出里同时有 node --test 的失败与不变量', () => {
  const fixture = withLayer({
    'a.test.js': "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('故意失败', () => assert.equal(1, 2));\n",
  });
  const invariant = '断言失败必须点名不变量';
  try {
    const result = run(fixture.root, invariant);
    assertLoudFailure(result, fixture.root, invariant);
    const output = outputOf(result);
    assert.match(output, /ℹ tests 1/, `期望透传 node --test 的摘要；输出：${output}`);
    assert.match(output, /ℹ fail 1/, `期望透传 node --test 的失败计数；输出：${output}`);
    assert.match(output, /退出码/, `期望失败注解写明 node --test 的退出码；输出：${output}`);
  } finally {
    fixture.cleanup();
  }
});

test('缺少 <layer> 或 <invariant> 时 exit 1：参数不全不能被当成通过', () => {
  for (const args of [[SCRIPT], [SCRIPT, 'tests/mvp0']]) {
    const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1, `期望 exit 1，实际 ${result.status}；args=${JSON.stringify(args)}`);
  }
});

// ---------------------------------------------------------------------------
// 判据本身：摘要行解析
// ---------------------------------------------------------------------------

test('解析不到摘要行时 parseSummary 返回 null，调用方必须 fail closed', () => {
  for (const output of [
    '',
    'node: --not-a-real-flag is not allowed in NODE_OPTIONS\n',
    'ℹ pass 1\nℹ fail 0\n', // 有汇总块但没有 tests 行：不可判定，不是"零用例"
    'ℹ tests\n',
    'ℹ tests 很多\n',
  ]) {
    assert.equal(parseSummary(output), null, `期望 null，实际 ${JSON.stringify(parseSummary(output))}`);
  }
});

test('摘要行有多块时取最后一块：汇总行在末尾，不能被中间块覆盖', () => {
  assert.deepEqual(parseSummary('ℹ tests 0\nℹ skipped 0\nℹ todo 0\nℹ tests 7\nℹ skipped 2\nℹ todo 1\n'), {
    tests: 7,
    skipped: 2,
    todo: 1,
  });
});

test('skip / todo 行缺失时按 0 计，只有 tests 行是硬锚点', () => {
  assert.deepEqual(parseSummary('ℹ tests 3\n'), { tests: 3, skipped: 0, todo: 0 });
});

test('countTestFiles 对目录与单个用例文件都给出一致的计数', () => {
  const fixture = withLayer({
    'a.test.js': '// 空文件\n',
    'nested/b.test.js': '// 空文件\n',
    'helper.js': '// 不是用例文件\n',
    'README.md': '# 不是用例文件\n',
  });
  try {
    assert.equal(countTestFiles(fixture.root), 2);
    assert.equal(countTestFiles(path.join(fixture.root, 'a.test.js')), 1);
    assert.equal(countTestFiles(path.join(fixture.root, 'helper.js')), 0);
    assert.equal(countTestFiles(path.join(fixture.root, '不存在')), 0);
  } finally {
    fixture.cleanup();
  }
});

test('countTestFiles 不把 node_modules 里的用例算进这一层', () => {
  // `node --test <dir>` 自己会跳过 node_modules，而 readdirSync 的递归不会。
  // 两边口径不一致时，某一层一旦长出 fixture 依赖，计数就会把依赖包里的用例
  // 算进来——方向是"多算"，会让空层判定假绿。
  const fixture = withLayer({
    'a.test.js': '// 空文件\n',
    'node_modules/dep/index.test.js': '// 依赖包自带的用例\n',
    'nested/node_modules/dep/nested.test.js': '// 嵌套依赖\n',
  });
  try {
    assert.equal(countTestFiles(fixture.root), 1, 'node_modules 下的 *.test.js 不得计入');
  } finally {
    fixture.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 真实层：Merge Gate 的四条 lane 各自非空且全绿
// ---------------------------------------------------------------------------

for (const layer of REAL_LAYERS) {
  test(`真实层 ${layer}：非空、全绿，且摘要行被透传`, () => {
    const result = run(layer, PROBE_INVARIANT);
    const output = outputOf(result);
    assert.equal(result.status, 0, `期望 exit 0，实际 ${result.status}；输出：${output}`);
    assert.ok(output.includes(PROBE_INVARIANT), `期望输出点名不变量；输出：${output}`);
    assert.match(output, /ℹ tests [1-9][0-9]*/, `期望摘要行 tests ≥ 1；输出：${output}`);
    assert.match(output, /ℹ fail 0/, `期望摘要行 fail 0；输出：${output}`);
    assert.match(output, /通过，执行 [1-9][0-9]* 条用例/, `期望成功摘要；输出：${output}`);
  });
}
