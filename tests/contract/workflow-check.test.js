import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkWorkflows } from '../../scripts/workflow-check.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/workflow-check.mjs', import.meta.url));

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

// 可复用 workflow 调用（`jobs.<id>.uses`）没有 `runs-on`/`steps`，需要一个
// 独立的最小 fixture，而不是从 baseline 改。
const reusableWorkflowPinned = `name: Fixture Call
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  call:
    uses: some-org/some-repo/.github/workflows/build.yml@1111111111111111111111111111111111111111
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
    assert.ok(findings.some((finding) => finding.rule === rule), `期望包含 ${rule}，实际 ${JSON.stringify(findings)}`);
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
  // 根目录必须从本文件的 URL 推导，不能用 process.cwd()：从子目录跑测试时
  // path.resolve('.') 不指向仓库根，这条本该守住真实 ci.yml 的用例会退化成
  // 对一个不存在的目录的空断言。
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  assert.deepEqual(checkWorkflows(repoRoot), []);
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

// -----------------------------------------------------------------------
// W2：大小写与"有牙"（issue #38 表格第 5 行）
// -----------------------------------------------------------------------

// GitHub 按 owner/repo 大小写不敏感解析 uses:，旧实现用 .startsWith() 做
// 大小写敏感比较，Actions/Checkout 这种写法完全绕过 W2。
test('W2：uses 大小写不敏感——Actions/Checkout 且没有 with 块时同样要拦', () => {
  assertOnlyRule(
    baseline
      .replace('actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'Actions/Checkout@11d5960a326750d5838078e36cf38b85af677262')
      .replace('        with:\n          persist-credentials: false\n', ''),
    'W2',
  );
});

// 旧的 W2 测试只删过整个 with: 块，只走了 `!isObject(step.with)` 这一半的
// `||`；把 `step.with['persist-credentials'] !== false` 突变成 `false` 之后
// 那条测试仍然是绿的。这里覆盖 with 存在、但缺 persist-credentials 键的
// 情形，才能真正压到 `!== false` 这一半判据。
test('W2：声明了 with 但没有 persist-credentials 键时要拦（不能只靠 with 是否存在判定）', () => {
  assertOnlyRule(
    baseline.replace('        with:\n          persist-credentials: false\n', '        with:\n          fetch-depth: 0\n'),
    'W2',
  );
});

test('W2：persist-credentials 显式声明为 true 时要拦', () => {
  assertOnlyRule(baseline.replace('persist-credentials: false', 'persist-credentials: true'), 'W2');
});

// 按前缀比较会把无关 action（例如一个假想的 actions/checkout-sarif）误判成
// checkout；按 action 名精确比较（拆 owner/repo，去掉 ref 与子路径）才不会。
test('W2：uses 前缀匹配到无关 action 时不得误报（按 action 名而非前缀比较）', () => {
  assertNoFinding(
    baseline.replace(
      '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n',
      '      - uses: actions/checkout-sarif@1111111111111111111111111111111111111111\n',
    ),
  );
});

test('W3：uses 使用可移动 tag', () => {
  assertOnlyRule(baseline.replace('actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4'), 'W3');
});

// -----------------------------------------------------------------------
// W3：可复用 workflow 调用（issue #38 表格第 2 行）
// -----------------------------------------------------------------------

// 复现"无法满足的红门禁"：旧实现从不遍历 jobs.<id>.uses，但 W1 仍然会在这类
// job 上要求 timeout-minutes——GitHub 根本不允许在 uses: 形态的 job 上声明
// 这个键（允许的键只有 name/uses/id/needs/permissions/if/with/secrets/
// strategy/concurrency）。一个正确固定了 commit 的可复用 workflow 调用应该
// 是零 finding。
test('W3：正确固定 commit 的可复用 workflow 调用没有 finding（W1 不得在 uses job 上误报）', () => {
  assertNoFinding(reusableWorkflowPinned);
});

// 可复用 workflow 调用整个语法类别从未被遍历：第三方 @main 带着仓库 token
// 运行而不被拦。
test('W3：job 级 uses 引用可移动 ref 时要拦', () => {
  assertOnlyRule(reusableWorkflowPinned.replace('@1111111111111111111111111111111111111111', '@main'), 'W3');
});

// 本地可复用 workflow（./ 开头）沿用与 step 级 uses 相同的豁免。
test('W3：本地可复用 workflow（./ 开头）豁免固定提交要求', () => {
  assertNoFinding(
    reusableWorkflowPinned.replace(
      'uses: some-org/some-repo/.github/workflows/build.yml@1111111111111111111111111111111111111111',
      'uses: ./.github/workflows/build.yml',
    ),
  );
});

// call job 允许声明 permissions（GitHub 允许的键之一），W4 的"不得 write"
// 判定必须继续覆盖它——豁免 W1/W2 不等于豁免整条 W4。
test('W4：call job 声明 write 权限时仍要拦（豁免 W1/W2 不等于豁免 W4）', () => {
  const workflow = reusableWorkflowPinned.replace(
    'uses: some-org/some-repo/.github/workflows/build.yml@1111111111111111111111111111111111111111\n',
    'uses: some-org/some-repo/.github/workflows/build.yml@1111111111111111111111111111111111111111\n    permissions:\n      contents: write\n',
  );
  assertOnlyRule(workflow, 'W4');
});

// call job 没有 runs-on。"未知 runs-on 一律 fail-closed 当 self-hosted"这条
// 新规则如果不排除 call job，会导致同一个 workflow 里只要出现一个可复用
// workflow 调用，顶层 permissions 就被强制要求为空映射——这是本次修复自己
// 可能引入的新误报，必须显式排除并守住。
test('W4：call job 与普通 hosted job 共存时不得因为 call job 没有 runs-on 就误判顶层需要空权限', () => {
  const workflow = reusableWorkflowPinned.replace(
    'jobs:\n  call:\n    uses: some-org/some-repo/.github/workflows/build.yml@1111111111111111111111111111111111111111\n',
    'jobs:\n  call:\n    uses: some-org/some-repo/.github/workflows/build.yml@1111111111111111111111111111111111111111\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps: []\n',
  );
  assertNoFinding(workflow);
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

// -----------------------------------------------------------------------
// W4：runs-on 的形状收敛（issue #38 表格第 1 行，影响排序最高——W4 是唯一
// 保护自托管机器的规则）
// -----------------------------------------------------------------------

// GitHub 文档化的 runner-group 对象形式：{group, labels}。旧实现只认字符串
// 与数组，这个形状既不是字符串也不是数组，直接落空判定。
test('W4：runs-on 写成 {group, labels} 对象形式时仍要识别 self-hosted', () => {
  assertOnlyRule(
    baseline.replace('runs-on: ubuntu-latest', 'runs-on:\n      group: laptops\n      labels: [self-hosted, macos]'),
    'W4',
  );
});

// 对称的反向用例：{labels} 对象形式里全是托管标签时不得误报。这条比上面
// 那条更能证明"摊平"本身在起作用——上面那条即使摊平逻辑被完全禁用，也会
// 落到"摊平不出标签 → fail-closed 当 self-hosted"这条兜底上得出同样的
// 结论，不能单独证明摊平分支有牙；这条才能，因为一旦摊平被禁用，
// {labels: [ubuntu-latest]} 会摊平成 []，被兜底误判为 self-hosted。
test('W4：runs-on 写成 {labels} 对象形式且全是托管标签时不得误报', () => {
  assertNoFinding(baseline.replace('runs-on: ubuntu-latest', 'runs-on:\n      labels: [ubuntu-latest]'));
});

// 本仓库真实 runner 注册的标签集是 self-hosted,macOS,ARM64,dsh。GitHub 按
// 标签集匹配调度，不要求字面量 self-hosted——旧实现的
// `.some(label => label === 'self-hosted')` 在这种写法下永远是 false。
test('W4：runs-on 标签集匹配到本仓库 runner 但不含字面量 self-hosted 时仍要识别', () => {
  assertOnlyRule(baseline.replace('runs-on: ubuntu-latest', 'runs-on: [macos, arm64, dsh]'), 'W4');
});

// runs-on 写成矩阵表达式时静态判定无法展开 matrix.runner 的取值，必须
// fail-closed 按 self-hosted 处理，而不是放行。
test('W4：runs-on 是未展开的矩阵表达式时按 self-hosted fail-closed 处理', () => {
  const workflow = baseline.replace(
    'runs-on: ubuntu-latest',
    'runs-on: ${{ matrix.runner }}\n    strategy:\n      matrix:\n        runner: [ubuntu-latest, self-hosted]',
  );
  assertOnlyRule(workflow, 'W4');
});

// 旧实现字符串分支用 .includes('self-hosted')、数组分支用严格相等，两条
//路径判据不同因而不对称：runs-on: [self-hosted-mac] 这种标签近似但不等于
// 字面量 self-hosted 的数组形式会被放过。摊平成标签、统一用白名单判定后，
// 两条路径收敛成同一条规则，不再存在"数组比字符串宽松"的缺口。
test('W4：数组里的自定义标签不等于字面量 self-hosted 时仍要 fail-closed（消除字符串/数组判据不对称）', () => {
  assertOnlyRule(baseline.replace('runs-on: ubuntu-latest', 'runs-on: [self-hosted-mac]'), 'W4');
});

// -----------------------------------------------------------------------
// W5/W6：job 级 concurrency、分支 glob、真值字面量（issue #38 表格第 3 行）
// -----------------------------------------------------------------------

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

// branches: ['**'] 用 Array.includes('main') 判定不会命中——它是通配符，
// 语义上覆盖包括 main 在内的所有分支，必须按 glob 匹配而不是字面量相等。
test('W5：push.branches 用 ** 通配符覆盖 main 时要拦（不是字面量相等）', () => {
  assertOnlyRule(
    baseline.replace('  pull_request:\n    branches: [main]\n', "  pull_request:\n    branches: [main]\n  push:\n    branches: ['**']\n"),
    'W5',
  );
});

// cancel-in-progress: 'true' 是带引号的字符串标量，=== true 判定不到。
test('W5：cancel-in-progress 写成带引号的字符串 "true" 时同样要拦', () => {
  assertOnlyRule(
    baseline
      .replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n')
      .replace('cancel-in-progress: true', "cancel-in-progress: 'true'"),
    'W5',
  );
});

// ci.yml 依赖的表达式形式必须继续放行，不能被"引号标量也拦"这条修复误伤。
test('W5：cancel-in-progress 是 pull_request 判定表达式时不算真值字面量，不得误报', () => {
  assertNoFinding(
    baseline
      .replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n')
      .replace('cancel-in-progress: true', "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"),
  );
});

// jobs.<id>.concurrency 是合法键，旧实现只查顶层、从未检查过它。push 覆盖
// main 时，job 级 cancel-in-progress: true 一样会取消上一次合并到 main 的
// 验证记录——这正是 W5 要防的事。
test('W5：job 级 concurrency.cancel-in-progress 为 true 时要拦（旧实现只查顶层）', () => {
  const workflow = baseline
    .replace('concurrency:\n  group: fixture-${{ github.event.pull_request.number }}\n  cancel-in-progress: true\n', '')
    .replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n    branches: [main]\n')
    .replace('    timeout-minutes: 5\n', '    timeout-minutes: 5\n    concurrency:\n      group: build\n      cancel-in-progress: true\n');
  const fixture = withWorkflow(workflow);
  try {
    const findings = fixture.findings();
    assert.deepEqual([...new Set(findings.map((item) => item.rule))], ['W5']);
    assert.ok(
      findings.some((item) => item.rule === 'W5' && item.job === 'build'),
      `期望 W5 finding 归属 job build，实际 ${JSON.stringify(findings)}`,
    );
  } finally {
    fixture.cleanup();
  }
});

test('W6：声明 concurrency 时必须显式声明 cancel-in-progress', () => {
  assertOnlyRule(baseline.replace('  cancel-in-progress: true\n', ''), 'W6');
});

test('W6：job 级声明 concurrency 但缺少 cancel-in-progress 时要拦（旧实现只查顶层）', () => {
  const workflow = baseline.replace('    timeout-minutes: 5\n', '    timeout-minutes: 5\n    concurrency:\n      group: build\n');
  const fixture = withWorkflow(workflow);
  try {
    const findings = fixture.findings();
    assert.deepEqual([...new Set(findings.map((item) => item.rule))], ['W6']);
    assert.ok(
      findings.some((item) => item.rule === 'W6' && item.job === 'build'),
      `期望 W6 finding 归属 job build，实际 ${JSON.stringify(findings)}`,
    );
  } finally {
    fixture.cleanup();
  }
});

// -----------------------------------------------------------------------
// 输入侧：目录缺失/零匹配必须 fail-closed（issue #38 表格第 4 行）
// -----------------------------------------------------------------------

test('输入：.github/workflows 目录不存在时必须抛错，而不是返回空结果', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-check-missing-'));
  try {
    assert.throws(() => checkWorkflows(root), /workflows 目录不存在/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('输入：workflows 目录匹配 0 个 *.yml/*.yaml 文件时必须抛错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-check-empty-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'README.txt'), 'not a workflow');
  try {
    assert.throws(() => checkWorkflows(root), /没有匹配到/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// CLI 层面同样要能观察到：内部错误必须用与规则违规不同的 exit code，
// 不能和 W1-W7 的 exit 1 混在一起（ExecPlan Global Constraints：内部错误取 3）。
test('CLI：workflows 目录缺失时 exit 3，不是 exit 1', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-check-missing-cli-'));
  try {
    const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
    assert.equal(result.status, 3, `期望 exit 3，实际 ${result.status}；输出：${result.stdout}${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI：解析失败时 exit 3（内部错误），不是 exit 1（规则违规）', () => {
  const fixture = withWorkflow('jobs: [unclosed\n');
  try {
    const result = spawnSync(process.execPath, [SCRIPT, fixture.root], { encoding: 'utf8' });
    assert.equal(result.status, 3, `期望 exit 3，实际 ${result.status}；输出：${result.stdout}${result.stderr}`);
  } finally {
    fixture.cleanup();
  }
});

// 合规时打印检查过的文件数，"检查了 0 个"不能被读成"合规"。
test('CLI：合规时打印已检查的文件数', () => {
  const fixture = withWorkflow(baseline);
  try {
    const result = spawnSync(process.execPath, [SCRIPT, fixture.root], { encoding: 'utf8' });
    assert.equal(result.status, 0, `期望 exit 0，实际 ${result.status}；输出：${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /已检查 1 个文件/);
  } finally {
    fixture.cleanup();
  }
});

// -----------------------------------------------------------------------
// 其它（issue #38 表格第 6 行）
// -----------------------------------------------------------------------

// entry.isFile() 不跟随符号链接，符号链接指向的 workflow 会被静默跳过；
// statSync 会跟随符号链接，才能让它被真正检查到。
test('符号链接的 workflow 文件必须被检查，不能被静默跳过', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-check-symlink-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  const actualPath = path.join(root, 'actual-workflow.yml');
  // 故意违反 W1（缺 timeout-minutes），用来证明内容确实被读取了。
  fs.writeFileSync(actualPath, baseline.replace('    timeout-minutes: 5\n', ''));
  fs.symlinkSync(actualPath, path.join(workflowDir, 'linked.yml'));
  try {
    const findings = checkWorkflows(root);
    assert.ok(
      findings.some((item) => item.rule === 'W1'),
      `期望通过符号链接发现 W1 违规，实际 findings=${JSON.stringify(findings)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// jobs 写成 YAML 列表这类"能解析但结构不对"的输入必须报告，而不是静默
// 通过——现有的"解析失败"用例（下面那条）只覆盖语法错误，从未覆盖过
// "形状不对但语法合法"这条路径。
test('W7：jobs 写成 YAML 列表时必须报告', () => {
  assertOnlyRule(baseline.replace(/jobs:\n  build:[\s\S]*$/, 'jobs:\n  - not-a-mapping\n'), 'W7');
});

test('W7：workflow 缺少 jobs 时必须报告', () => {
  assertOnlyRule(baseline.replace(/jobs:\n  build:[\s\S]*$/, ''), 'W7');
});

// jobs: {} 能通过 isObject 检查（空映射也是映射），但创建零个检查——和
// "目录存在但一个 *.yml 都没匹配到"是同一类假绿：输入合法，工作量为零。
// RULES 里 W7 的 title 一直写着"非空映射"，实现之前只拒绝 undefined 与
// 非对象，从未真正检查过"非空"，这条用例把承诺和实现钉在一起。
test('W7：jobs 是空映射 {} 时必须报告（RULES 标题承诺的"非空"此前未实现）', () => {
  assertOnlyRule(baseline.replace(/jobs:\n  build:[\s\S]*$/, 'jobs: {}\n'), 'W7');
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

// 读取失败（权限、损坏的文件描述符等）与解析失败必须用不同措辞，
// 方便定位到底是权限问题还是内容问题；chmod 000 是最直接的读取失败复现。
// root 会绕过权限位，这条用例在 root 下没有意义，因此只在非 root 时跑。
test('读取失败与解析失败必须分开措辞', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return;

  const fixture = withWorkflow(baseline);
  const target = path.join(fixture.root, '.github', 'workflows', 'fixture.yml');
  fs.chmodSync(target, 0o000);
  try {
    assert.throws(() => fixture.findings(), (error) => {
      assert.match(error.message, /无法读取 workflow/);
      assert.doesNotMatch(error.message, /无法解析/);
      return true;
    });
  } finally {
    fs.chmodSync(target, 0o644);
    fixture.cleanup();
  }
});

// CLI 入口判定用的是 realpath 比较。用旧的 `file://${argv[1]}` 写法时，
// 路径里出现空格会让 main() 被静默跳过：同样的违规目录，exit 0 且无输出。
// 这里把脚本复制到一个含空格的目录里跑，确保那个失败模式不会回来。
test('CLI：脚本路径含空格时仍然真的执行检查', () => {
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow check '));
  const fixture = withWorkflow(baseline.replace('  pull_request:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n  push:\n'));

  try {
    const copy = path.join(holder, 'workflow-check.mjs');
    fs.copyFileSync(SCRIPT, copy);
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
