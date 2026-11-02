import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { parse } from 'yaml';

// W1–W7 已覆盖 action pin、凭据、权限与通用超时；这里只保护 browser 接线语义。
const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

function job(id) {
  assert.ok(workflow.jobs && !Array.isArray(workflow.jobs), 'CI jobs 必须是映射');
  const value = workflow.jobs[id];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `缺少 CI job ${id}`);
  assert.ok(Array.isArray(value.steps), `CI job ${id} 必须有 steps`);
  return value;
}

test('CI 调度 verify、browser 和稳定的 PR Fast Gate，browser 安装后执行非空层入口', () => {
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['browser', 'fast-gate', 'verify']);
  const browser = job('browser');
  assert.match(browser['runs-on'], /^ubuntu-/);
  assert.equal(browser.needs, undefined, 'browser 与 verify 独立执行');
  assert.deepEqual(browser.steps.filter((step) => step.run !== undefined).map((step) => step.run.trim()), [
    'pnpm install --frozen-lockfile',
    'pnpm exec playwright install --with-deps chromium',
    'pnpm test:browser',
  ]);
});

test('browser job 与准备/执行步骤不能条件跳过或吞掉非零结果', () => {
  const browser = job('browser');
  for (const [where, value] of [['browser', browser], ...browser.steps.filter((step) => step.run !== undefined).map((step, index) => [`step ${index}`, step])]) {
    assert.equal(value.if, undefined, `${where} 不得条件静音`);
    assert.equal(value['continue-on-error'], undefined, `${where} 不得吞掉失败`);
  }
});

test('Fast Gate 必须等候 verify/browser，保持失败时可汇总且不执行候选代码', () => {
  const aggregate = job('fast-gate');
  assert.equal(aggregate.name, 'PR Fast Gate');
  assert.deepEqual([...aggregate.needs].sort(), ['browser', 'verify']);
  assert.equal(aggregate.if, '${{ !cancelled() }}');
  assert.equal(aggregate['continue-on-error'], undefined);
  assert.equal(aggregate.steps.length, 2, '聚合只含失败判定与汇总');
  assert.doesNotMatch(JSON.stringify(aggregate), /secrets|"uses"|"env"/);
  for (const step of aggregate.steps) {
    assert.equal(step['continue-on-error'], undefined);
    for (const line of step.run.trim().split('\n')) {
      assert.match(line.trim(), /^(?:echo\s+"[^"\n]*"|exit 1)$/, '聚合不得运行候选代码');
      const output = line.replaceAll(/\$\{\{ join\(needs\.\*\.result, ', '\) \}\}/g, '');
      assert.doesNotMatch(output, /[$`]/, '聚合只允许输出 needs 结果，不得命令替换');
    }
  }
});

test('Fast Gate 对两个 lane 的 16 种结果逐一失败闭合，只有双 success 放行', () => {
  const [reject, summary] = job('fast-gate').steps;
  assert.equal(summary.if, undefined, '汇总只在前一步成功后运行');
  const states = [...reject.if.split('||')].map((clause) => {
    const match = /^contains\(needs\.\*\.result, '(failure|cancelled|skipped)'\)$/.exec(clause.trim());
    assert.ok(match, `不认识的聚合失败条件：${clause}`);
    return match[1];
  });
  assert.deepEqual(states.sort(), ['cancelled', 'failure', 'skipped']);
  for (const verify of ['success', 'failure', 'cancelled', 'skipped']) {
    for (const browser of ['success', 'failure', 'cancelled', 'skipped']) {
      const results = [verify, browser];
      const rejected = states.some((state) => results.includes(state));
      const step = rejected ? reject : summary;
      const command = step.run.replaceAll(/\$\{\{ join\(needs\.\*\.result, ', '\) \}\}/g, results.join(', '));
      const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
      assert.equal(result.status, results.every((state) => state === 'success') ? 0 : 1, results.join(', '));
    }
  }
});

test('browser 失败证据仅上传生成的截图和 trace，保留不超过七天', () => {
  const uploads = job('browser').steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 1);
  const upload = uploads[0];
  assert.equal(upload.if, '${{ failure() }}');
  assert.equal(upload['continue-on-error'], undefined);
  assert.deepEqual(upload.with.path.trim().split('\n'), [
    'test-results/composed-browser/**/*.png',
    'test-results/composed-browser/**/*.zip',
  ]);
  assert.ok(Number.isInteger(upload.with['retention-days']) && upload.with['retention-days'] >= 1 && upload.with['retention-days'] <= 7);
  assert.equal(upload.with['include-hidden-files'], false);
});
