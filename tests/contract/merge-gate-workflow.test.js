// `.github/workflows/merge-gate.yml` 的可执行表述（ExecPlan `2026-09-21-merge-gate-layers` D3–D5、issue #10）。
//
// 它钉住的是结构，不是"跑一次看看"：四条 lane 的 check 名与各自跑的那一层、
// 每条 lane 点名的不变量、聚合 job 的形状（不 checkout、不读 secrets、只汇总
// needs）、`on.pull_request` 没有 `branches` 过滤器、`on.push` 只限 `main`、
// 权限与超时的上下界、以及"新车道不替换 `PR Fast Gate`"。
//
// W1–W7 的通用判定不在这里重复：`tests/contract/workflow-check.test.js` 的
// "仓库当前的所有 workflow 满足全部不变量"已经覆盖本文件（新增 workflow 自动进入
// 那份检查）。这里补的是 workflow-check 判不了的语义：lane 集合、命令与不变量文案。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { countTestFiles } from '../../scripts/run-test-layer.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW_FILE = '.github/workflows/merge-gate.yml';
const RAW = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_FILE), 'utf8');
const WORKFLOW = parseYaml(RAW);

const CHECKOUT = /^actions\/checkout@/;
const PINNED = /^[^/\s]+\/[^@\s]+(?:\/[^@\s]+)*@[0-9a-f]{40}$/;

/** lane 的权威表：check 名、它跑的那一层、它点名的不变量。 */
const LANES = [
  {
    id: 'integration',
    name: 'Merge Gate · Integration',
    layer: 'tests/integration',
    invariant: '迁移可从空库重复执行、失败不留版本记录',
  },
  {
    id: 'boundaries',
    name: 'Merge Gate · Boundaries',
    layer: 'tests/contract/package-boundaries.test.js',
    invariant: '依赖方向不反向、不跨层',
  },
  {
    id: 'mvp0',
    name: 'Merge Gate · MVP-0',
    layer: 'tests/mvp0',
    invariant: '纵向链路每节点有断言，未实现节点必须失败并点名',
  },
  {
    id: 'e2e',
    name: 'Merge Gate · E2E',
    layer: 'tests/e2e',
    invariant: '端到端链路与故障降级',
  },
];

const AGGREGATE = 'merge-gate';
const LANE_IDS = LANES.map((lane) => lane.id);

function jobOf(id) {
  const job = WORKFLOW.jobs?.[id];
  assert.ok(job, `期望 workflow 里有 job ${id}`);
  return job;
}

function stepsOf(id) {
  const steps = jobOf(id).steps;
  assert.ok(Array.isArray(steps), `期望 job ${id} 有 steps`);
  return steps;
}

function usesList(job) {
  return (job.steps ?? []).map((step) => step.uses).filter((uses) => typeof uses === 'string');
}

/** 该 job 里调用层运行器的那一条命令；多于一条即视为接线错误。 */
function layerCommand(id) {
  const commands = stepsOf(id)
    .map((step) => (typeof step.run === 'string' ? step.run.trim() : null))
    .filter((command) => command !== null && command.includes('run-test-layer.mjs'));
  assert.equal(commands.length, 1, `期望 job ${id} 恰好有一条 run-test-layer 命令，实际 ${JSON.stringify(commands)}`);
  return commands[0];
}

// ---------------------------------------------------------------------------
// lane 集合与命令
// ---------------------------------------------------------------------------

test('lane 集合与 check 名：四条执行 lane 加一个聚合 job，没有多余 job', () => {
  assert.deepEqual(Object.keys(WORKFLOW.jobs).sort(), [...LANE_IDS, AGGREGATE].sort());
  for (const lane of LANES) {
    assert.equal(jobOf(lane.id).name, lane.name, `job ${lane.id} 的 check 名必须稳定`);
  }
});

test('每条 lane 跑的是它自己那一层，并把该层保护的不变量作为参数传进去', () => {
  for (const lane of LANES) {
    assert.equal(layerCommand(lane.id), `node scripts/run-test-layer.mjs ${lane.layer} "${lane.invariant}"`);
  }
});

test('每条 lane 的层运行步骤不可被静音：不允许 if 跳过或 continue-on-error 吞错', () => {
  for (const lane of LANES) {
    const layerStep = stepsOf(lane.id).find(
      (step) => typeof step.run === 'string' && step.run.includes('run-test-layer.mjs'),
    );
    assert.ok(layerStep, `lane ${lane.id} 必须有层运行步骤`);
    assert.equal(layerStep.if, undefined, `lane ${lane.id} 的层运行步骤不得用 if 静音`);
    assert.notEqual(layerStep['continue-on-error'], true, `lane ${lane.id} 的层运行步骤不得吞掉失败`);
  }
});

test('每条 lane 指向的层真实存在且至少有一个用例文件（空层不会被接线错误掩盖）', () => {
  for (const lane of LANES) {
    const target = path.join(REPO_ROOT, lane.layer);
    assert.ok(fs.existsSync(target), `lane ${lane.id} 指向的层不存在：${lane.layer}`);
    assert.ok(countTestFiles(target) >= 1, `lane ${lane.id} 指向的层没有 *.test.js 文件：${lane.layer}`);
  }
});

test('四条 lane 之间没有 needs：各自独立并行，一条慢不拖住其它层', () => {
  for (const lane of LANES) {
    assert.equal(jobOf(lane.id).needs, undefined, `lane ${lane.id} 不应依赖别的 lane`);
  }
});

test('每条 lane 都 checkout 固定提交且关闭持久化凭据，所有外部 action 都固定到 40 位提交', () => {
  for (const lane of LANES) {
    const steps = stepsOf(lane.id);
    const checkouts = steps.filter((step) => typeof step.uses === 'string' && CHECKOUT.test(step.uses));
    assert.equal(checkouts.length, 1, `lane ${lane.id} 必须恰好 checkout 一次`);
    assert.match(checkouts[0].uses, /@[0-9a-f]{40}$/);
    assert.equal(checkouts[0].with?.['persist-credentials'], false);

    for (const uses of usesList(jobOf(lane.id))) {
      assert.match(uses, PINNED, `lane ${lane.id} 的 action 必须固定到 40 位提交：${uses}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 聚合 job 的形状
// ---------------------------------------------------------------------------

test('聚合 job 叫 Merge Gate，needs 覆盖全部四条 lane，且任一 lane 未成功即失败', () => {
  const aggregate = jobOf(AGGREGATE);
  assert.equal(aggregate.name, 'Merge Gate');
  assert.deepEqual([...aggregate.needs].sort(), [...LANE_IDS].sort());

  // 聚合 job 必须继续在 lane 被取消时也给出结论，否则"取消"会变成"没有状态"。
  assert.match(String(aggregate.if), /cancelled\(\)/);

  const failStep = stepsOf(AGGREGATE).find(
    (step) => typeof step.if === 'string' && step.if.includes("contains(needs.*.result, 'failure')"),
  );
  assert.ok(failStep, '期望聚合 job 有一条按 needs 结果判失败的步骤');
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.ok(failStep.if.includes(`'${result}'`), `聚合失败条件必须覆盖 ${result}`);
  }
  assert.match(failStep.run, /exit 1/);
});

test('聚合 job 不 checkout、不读 secrets：它只汇总结果，不执行候选 head 的代码', () => {
  assert.equal(usesList(jobOf(AGGREGATE)).length, 0, '聚合 job 不应有任何 uses（尤其不 checkout）');
  // 注释里提到 secrets 不算数，因此按解析后的结构判定。
  assert.ok(!JSON.stringify(WORKFLOW).includes('secrets'), 'workflow 不得引用 secrets 上下文');
});

// ---------------------------------------------------------------------------
// 触发面与并发
// ---------------------------------------------------------------------------

test('on.pull_request 不声明 branches 过滤器：基线不是 main 的 PR 也要拿到结论', () => {
  const pullRequest = WORKFLOW.on?.pull_request;
  assert.ok(
    pullRequest === null || typeof pullRequest === 'object',
    `期望 pull_request 触发器存在，实际 ${JSON.stringify(pullRequest)}`,
  );
  if (pullRequest !== null && typeof pullRequest === 'object') {
    assert.ok(!('branches' in pullRequest), 'pull_request 不得声明 branches');
    assert.ok(!('branches-ignore' in pullRequest), 'pull_request 不得声明 branches-ignore');
  }
  assert.ok(!('pull_request_target' in (WORKFLOW.on ?? {})), '本车道不得使用 pull_request_target');
});

test('on.push 只限 main', () => {
  assert.deepEqual(WORKFLOW.on?.push?.branches, ['main']);
});

test('concurrency 显式声明取消策略，且 push main 时不取消进行中的验证记录', () => {
  const concurrency = WORKFLOW.concurrency;
  assert.ok(concurrency && typeof concurrency === 'object', '期望声明顶层 concurrency');
  assert.ok(typeof concurrency.group === 'string' && concurrency.group.length > 0);
  assert.ok('cancel-in-progress' in concurrency, '声明 concurrency 时必须显式声明 cancel-in-progress');

  // W5：push 覆盖 main，因此这里不能是真值字面量（`true` 或 `'true'`）。
  const cancel = concurrency['cancel-in-progress'];
  assert.notEqual(cancel, true);
  assert.notEqual(String(cancel).trim().toLowerCase(), 'true');
  assert.match(String(cancel), /pull_request/, '期望取消策略只在 PR 上生效');
});

// ---------------------------------------------------------------------------
// 权限与超时
// ---------------------------------------------------------------------------

test('顶层 permissions 最小：只有 contents: read，任何位置都没有 write', () => {
  assert.deepEqual(WORKFLOW.permissions, { contents: 'read' });
  for (const [id, job] of Object.entries(WORKFLOW.jobs)) {
    if (job.permissions === undefined) continue;
    for (const value of Object.values(job.permissions)) {
      assert.doesNotMatch(String(value), /^write/, `job ${id} 不得声明 write 权限`);
    }
  }
});

test('每个 job 都声明 1–15 分钟的整数 timeout-minutes', () => {
  for (const [id, job] of Object.entries(WORKFLOW.jobs)) {
    const timeout = job['timeout-minutes'];
    assert.ok(Number.isInteger(timeout), `job ${id} 必须声明整数 timeout-minutes，实际 ${JSON.stringify(timeout)}`);
    assert.ok(timeout >= 1 && timeout <= 15, `job ${id} 的 timeout-minutes 必须在 1–15 之间，实际 ${timeout}`);
  }
});

// ---------------------------------------------------------------------------
// 与 PR Fast Gate 的关系
// ---------------------------------------------------------------------------

test('新车道不替换 PR Fast Gate：ci.yml 仍在，且本 workflow 不发布同名 check', () => {
  const ciPath = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
  assert.ok(fs.existsSync(ciPath), 'ci.yml 必须仍然存在——Merge Gate 是新增车道');
  const ci = parseYaml(fs.readFileSync(ciPath, 'utf8'));
  assert.equal(ci.jobs?.['fast-gate']?.name, 'PR Fast Gate');

  const names = Object.values(WORKFLOW.jobs).map((job) => job.name);
  assert.ok(!names.includes('PR Fast Gate'), '本 workflow 不得发布 PR Fast Gate 这个 check 名');
  assert.equal(new Set(names).size, names.length, 'check 名不得重复');
});
