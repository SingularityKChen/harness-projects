// Windows 原生 lane 的接线契约（ExecPlan `2026-11-17-windows-native-lane` Batch 3）。
//
// 聚合语义（needs 与 64 种结果闭合）的唯一断言在 `ci-browser-workflow.test.js`；
// 这里只固定 lane 自己的性质：hosted windows-2025、15 分钟上界、默认 pwsh、
// 无条件静音、只读权限、无 secrets、沿用现有 action pin、不 checkout 固定 ref、
// 两条按 set 名调用 runner 的入口、runner 管理员阶段与临时标准用户阶段的关键片段。
// 文件清单与用例下界只在 `scripts/windows-native-checks.mjs` 的 SETS 里，YAML
// 不得内联 `.test.js` 文件名。

import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { parse } from 'yaml';

import { SETS } from '../../scripts/windows-native-checks.mjs';

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

function lane() {
  const value = workflow.jobs?.['windows-native'];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), '缺少 CI job windows-native');
  assert.ok(Array.isArray(value.steps), 'windows-native 必须有 steps');
  return value;
}

const runText = (job) => job.steps.map((step) => step.run ?? '').join('\n');

function stepContaining(marker) {
  const step = lane().steps.find((value) => typeof value.run === 'string' && value.run.includes(marker));
  assert.ok(step, `缺少包含 ${marker} 的 run step`);
  return step;
}

/** 入口 marker 的期望值从 SETS 推导，SETS 变更而 YAML 漏改时本地 verify 即红。 */
const markerFor = (setId) =>
  `windows-native-checks: set=${setId} files=${SETS[setId].files.length} tests=\\d+ skipped=${SETS[setId].allowedSkips} todo=0`;

test('windows-native 固定 hosted windows-2025、1–15 分钟超时、默认 pwsh，且不条件静音', () => {
  const job = lane();
  assert.equal(job['runs-on'], 'windows-2025', 'Windows 原生 lane 必须跑在有原生证据的 hosted 镜像上');
  assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] >= 1 && job['timeout-minutes'] <= 15);
  assert.equal(job.defaults?.run?.shell, 'pwsh', '只显式声明 pwsh，不依赖继承的 bash 假设');
  for (const [where, value] of [['job', job], ...job.steps.map((step, index) => [`step ${index}`, step])]) {
    assert.equal(value.if, undefined, `${where} 不得条件静音`);
    assert.equal(value['continue-on-error'], undefined, `${where} 不得吞掉失败`);
  }
});

test('windows-native 继承顶层只读权限、无 secrets、沿用现有 action pin、checkout 不持久凭据也不钉 ref', () => {
  const job = lane();
  assert.equal(job.permissions, undefined, 'job 不得覆盖顶层 permissions');
  assert.doesNotMatch(JSON.stringify(job), /secrets/, 'lane 不得读取 secrets');
  const verify = workflow.jobs.verify;
  for (const prefix of ['actions/checkout@', 'pnpm/action-setup@', 'actions/setup-node@']) {
    const expected = verify.steps.find((step) => step.uses?.startsWith(prefix)).uses;
    assert.equal(job.steps.find((step) => step.uses?.startsWith(prefix))?.uses, expected, `${prefix} 必须沿用现有 pin`);
  }
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.deepEqual(checkout.with, { 'persist-credentials': false }, 'checkout 只关闭凭据持久化，不固定 ref');
  const setupNode = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(setupNode.with['node-version-file'], '.nvmrc', 'Node 版本来自 .nvmrc');
});

test('runner 管理员阶段记录镜像、架构、node/git 与提权身份，并执行 native-git set', () => {
  const identity = stepContaining('ImageOS');
  for (const marker of ['git rev-parse HEAD', 'ImageOS', 'ImageVersion', 'PROCESSOR_ARCHITECTURE',
    'node --version', 'git --version', 'WindowsIdentity', 'IsInRole', 'S-1-5-32-544']) {
    assert.ok(identity.run.includes(marker), `身份记录缺少 ${marker}`);
  }
  const entry = stepContaining('windows-native-checks.mjs --set native-git');
  assert.match(entry.run, /node scripts\/windows-native-checks\.mjs --set native-git/, 'native-git 入口必须按 set 名调用 runner');
  assert.match(entry.run, /\$LASTEXITCODE/, 'native-git 入口必须检查子进程退出码');
  assert.ok(entry.run.includes(markerFor('native-git')),
    'native-git 入口必须断言通过 marker（计数从 SETS 推导，入口 fail-open 时退出码仍为 0）');
  assert.ok(entry.run.includes("-notmatch '"), 'native-git 入口必须以 -notmatch 判定 marker 是否缺失');
  assert.match(entry.run, /::error::windows-native-checks: set=native-git[^\n]*\n\s*exit 1/, 'native-git 入口缺少 marker 时必须在错误分支 exit 1');
});

test('标准用户阶段自建临时账户、管理员预置 foreign fixture、限权启动 private-data runner 并在 finally 清理', () => {
  const text = runText(lane());
  for (const marker of ['New-LocalUser', 'AccountNeverExpires', 'UserMayNotChangePassword', 'Add-LocalGroupMember',
    "-SID 'S-1-5-32-545'", '-LoadUserProfile', 'provisionForeignFixture', 'HARNESS_NATIVE_FIXTURE_PROFILE',
    'HARNESS_NATIVE_FIXTURE_SID', 'HARNESS_WINDOWS_FOREIGN_PROFILE', 'Start-Process', 'windows-native-checks.mjs',
    "'--set'", "'private-data'", "'--profile'", "'--foreign'", 'Remove-CimInstance', 'Remove-LocalUser', 'finally',
    'standard-user exit=', '<fixture>']) {
    assert.ok(text.includes(marker), `标准用户阶段缺少 ${marker}`);
  }
  const standard = stepContaining('New-LocalUser');
  assert.ok(standard.run.indexOf('provisionForeignFixture') < standard.run.indexOf('standard-user-tests'),
    'foreign fixture 必须由管理员在标准用户测试启动之前预置');
  assert.ok(standard.run.indexOf('Remove-LocalUser') > standard.run.indexOf('finally'),
    '账户与 profile 清理必须位于 finally，不能靠条件 step 跳过');
  assert.ok(standard.run.includes(markerFor('private-data')),
    'private-data 入口必须断言通过 marker（计数从 SETS 推导，入口 fail-open 时退出码仍为 0）');
  assert.ok(standard.run.includes("-notmatch '"), 'private-data 入口必须以 -notmatch 判定 marker 是否缺失');
  assert.match(standard.run, /::error::windows-native-checks: set=private-data[^\n]*\n\s*\$nativeExit = 1/, 'private-data 入口缺少 marker 时必须在错误分支把 nativeExit 置 1');
  assert.ok(standard.run.includes('::error::windows-native-checks:'), '缺少 marker 时必须以 lane 错误注解失败');

  const yaml = JSON.stringify(lane());
  assert.doesNotMatch(yaml, /\.test\.js/, 'YAML 不得内联测试文件名（清单只在 SETS）');
  for (const setId of Object.keys(SETS)) assert.ok(runText(lane()).includes(setId), `两条入口必须覆盖 SETS 的 ${setId}`);
});
