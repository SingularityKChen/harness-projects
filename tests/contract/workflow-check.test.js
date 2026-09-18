import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkWorkflows } from '../../scripts/workflow-check.mjs';

const baseline = `name: Fixture
on:
  pull_request:
    branches: [main]
concurrency:
  group: fixture-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
`;

function withWorkflow(workflow) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-check-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'fixture.yml'), workflow);
  return {
    root,
    findings: () => checkWorkflows(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function assertOnlyRule(workflow, rule) {
  const fixture = withWorkflow(workflow);
  try {
    const findings = fixture.findings();
    assert.ok(findings.some((finding) => finding.rule === rule));
    assert.deepEqual([...new Set(findings.map((finding) => finding.rule))], [rule]);
  } finally {
    fixture.cleanup();
  }
}

function assertNoFinding(workflow) {
  const fixture = withWorkflow(workflow);
  try {
    assert.deepEqual(fixture.findings(), []);
  } finally {
    fixture.cleanup();
  }
}

test('仓库当前的所有 workflow 满足全部不变量', () => {
  assert.deepEqual(checkWorkflows(path.resolve('.')), []);
});

test('W1：job 缺少 timeout-minutes', () => {
  assertOnlyRule(baseline.replace('    timeout-minutes: 5\n', ''), 'W1');
});

test('W1：timeout-minutes 超过上界', () => {
  assertOnlyRule(baseline.replace('    timeout-minutes: 5', '    timeout-minutes: 60'), 'W1');
});

test('W2：checkout 缺少 persist-credentials: false', () => {
  assertOnlyRule(baseline.replace('        with:\n          persist-credentials: false\n', ''), 'W2');
});

test('W3：uses 使用可移动 tag', () => {
  assertOnlyRule(baseline.replace('actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4'), 'W3');
});

test('W4：缺少顶层 permissions', () => {
  assertOnlyRule(baseline.replace('permissions:\n  contents: read\n', ''), 'W4');
});

test('W4：self-hosted job 要求空 permissions', () => {
  assertOnlyRule(baseline.replace('runs-on: ubuntu-latest', 'runs-on: [self-hosted, macos]'), 'W4');
});

test('W4：顶层 permissions 含 write', () => {
  assertOnlyRule(baseline.replace('  contents: read', '  contents: write'), 'W4');
});

// job 级 permissions 会覆盖顶层。只查顶层等于给最小权限留了一个后门。
test('W4：job 级 permissions 含 write 同样违规', () => {
  assertOnlyRule(
    baseline.replace('    timeout-minutes: 5\n', '    timeout-minutes: 5\n    permissions:\n      contents: write\n'),
    'W4',
  );
});

test('W4：self-hosted job 不得用 job 级 permissions 覆盖出非空权限', () => {
  const workflow = baseline
    .replace('permissions:\n  contents: read\n', 'permissions: {}\n')
    .replace('runs-on: ubuntu-latest', 'runs-on: [self-hosted, macos]')
    .replace('    timeout-minutes: 5\n', '    timeout-minutes: 5\n    permissions:\n      contents: read\n');
  assertOnlyRule(workflow, 'W4');
});

test('W5：push 覆盖默认分支时不得取消进行中的记录', () => {
  assertOnlyRule(baseline.replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n'), 'W5');
});

// `on: push` 与 `on: [push, ...]` 是合法写法，且都覆盖全部分支。
// 只认映射形态会让这两种写法静默通过——正是 W5 要拦的那个缺陷。
test('W5：on 写成 push 字符串时同样要拦', () => {
  assertOnlyRule(baseline.replace('on:\n  pull_request:\n    branches: [main]\n', 'on: push\n'), 'W5');
});

test('W5：on 写成含 push 的数组时同样要拦', () => {
  assertOnlyRule(baseline.replace('on:\n  pull_request:\n    branches: [main]\n', 'on: [push, pull_request]\n'), 'W5');
});

test('W5：push.branches 含 main 时要拦', () => {
  assertOnlyRule(
    baseline.replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n'),
    'W5',
  );
});

// branches-ignore 排除 main 时 push 并不覆盖默认分支，取消是安全的。
// 把它判成违规属于误报，而误报会让人开始绕过这条检查。
test('W5：push.branches-ignore 排除 main 时不算覆盖，不得误报', () => {
  assertNoFinding(
    baseline.replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n    branches-ignore: [main]\n'),
  );
});

test('W6：声明 concurrency 时必须显式声明 cancel-in-progress', () => {
  assertOnlyRule(baseline.replace('  cancel-in-progress: true\n', ''), 'W6');
});

// 解析不了的 workflow 必须让检查失败，不能静默放行：
// "语法错的 workflow 只是完全不创建检查"是已经发生过的事故。
test('解析失败时抛出，而不是返回空结果', () => {
  const fixture = withWorkflow('jobs: [unclosed\n');
  try {
    assert.throws(() => fixture.findings(), /无法解析 workflow/);
  } finally {
    fixture.cleanup();
  }
});

// CLI 入口判定用的是 realpath 比较。用旧的 `file://${argv[1]}` 写法时，
// 路径里出现空格会让 main() 被静默跳过：同样的违规目录，exit 0 且无输出。
// 这里把脚本复制到一个含空格的目录里跑，确保那个失败模式不会回来。
test('CLI：脚本路径含空格时仍然真的执行检查', () => {
  const script = fileURLToPath(new URL('../../scripts/workflow-check.mjs', import.meta.url));
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow check '));
  const fixture = withWorkflow(baseline.replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n'));

  try {
    const copy = path.join(holder, 'workflow-check.mjs');
    fs.copyFileSync(script, copy);
    // ESM 不认 NODE_PATH；用符号链接让 `yaml` 仍能解析。
    fs.symlinkSync(path.resolve('node_modules'), path.join(holder, 'node_modules'), 'dir');

    const result = spawnSync(process.execPath, [copy, fixture.root], { encoding: 'utf8' });
    assert.equal(result.status, 1, `期望 exit 1，实际 ${result.status}；输出：${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /\[W5\]/);
  } finally {
    fixture.cleanup();
    fs.rmSync(holder, { recursive: true, force: true });
  }
});
