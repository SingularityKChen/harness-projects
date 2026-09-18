import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

export const RULES = [
  { id: 'W1', title: '每个 job 都声明 1 到 15 分钟的超时上界' },
  { id: 'W2', title: '每个 checkout step 都禁用持久化凭据' },
  { id: 'W3', title: '每个外部 action 都使用不可变提交引用' },
  { id: 'W4', title: 'workflow 权限最小且自托管 job 使用空权限' },
  { id: 'W5', title: '覆盖默认分支的 push 不得取消进行中的记录' },
  { id: 'W6', title: '声明 concurrency 时必须显式声明取消策略' },
];

const PINNED_USE = /^[^/\s]+\/[^@\s]+(?:\/[^@\s]+)*@[0-9a-fA-F]{40}$/;

function finding(rule, file, job, message) {
  return { rule, file, job, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const DEFAULT_BRANCH = 'main';

function isSelfHosted(runsOn) {
  if (typeof runsOn === 'string') return runsOn.includes('self-hosted');
  return Array.isArray(runsOn) && runsOn.some((label) => label === 'self-hosted');
}

/** `on` 允许写成字符串、字符串数组或映射；归一成映射后再判定。 */
function normalizeTriggers(on) {
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((name) => [name, null]));
  return isObject(on) ? on : {};
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * push 是否会覆盖默认分支。只限定 `branches` 与 `branches-ignore` 两种写法，
 * 其余（含 `push:` 空值）都视为覆盖全部分支。
 */
function pushCoversMainBranch(on) {
  const triggers = normalizeTriggers(on);
  if (!Object.prototype.hasOwnProperty.call(triggers, 'push')) return false;

  const push = triggers.push;
  if (!isObject(push)) return true;
  if (Object.prototype.hasOwnProperty.call(push, 'branches')) {
    return asList(push.branches).includes(DEFAULT_BRANCH);
  }
  if (Object.prototype.hasOwnProperty.call(push, 'branches-ignore')) {
    return !asList(push['branches-ignore']).includes(DEFAULT_BRANCH);
  }
  return true;
}

/** 逐键判定一份 permissions：缺失/非映射/含 write 都算违规。 */
function inspectPermissions(permissions, file, job) {
  const findings = [];
  const where = job === null ? '顶层' : `job ${job} 的`;

  if (!isObject(permissions)) {
    findings.push(finding('W4', file, job, `${where} permissions 必须是映射`));
    return findings;
  }
  for (const [key, value] of Object.entries(permissions)) {
    if (typeof value === 'string' && value.startsWith('write')) {
      findings.push(finding('W4', file, job, `${where} permissions.${key} 不得使用 write 权限`));
    }
  }
  return findings;
}

/** job 声明了非空 permissions 时，它对顶层的最小权限是一次覆盖。 */
function jobPermissionsOverride(job, file, jobName) {
  const findings = [];
  if (!isObject(job) || !Object.prototype.hasOwnProperty.call(job, 'permissions')) return findings;

  const jobPermissions = job.permissions;
  findings.push(...inspectPermissions(jobPermissions, file, jobName));

  if (isSelfHosted(job['runs-on']) && isObject(jobPermissions) && Object.keys(jobPermissions).length !== 0) {
    findings.push(finding('W4', file, jobName, 'self-hosted job 不得声明非空 permissions（顶层已经是空映射）'));
  }
  return findings;
}

function inspectWorkflow(document, file) {
  const findings = [];
  const jobs = isObject(document?.jobs) ? document.jobs : {};

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isObject(job) || !Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] < 1 || job['timeout-minutes'] > 15) {
      findings.push(finding('W1', file, jobName, 'job 必须声明 1 到 15 之间的整数 timeout-minutes'));
    }

    findings.push(...jobPermissionsOverride(job, file, jobName));

    if (isObject(job)) {
      const steps = Array.isArray(job.steps) ? job.steps : [];
      for (const step of steps) {
        if (!isObject(step)) continue;
        if (typeof step.uses === 'string' && !step.uses.startsWith('./') && !PINNED_USE.test(step.uses)) {
          findings.push(finding('W3', file, jobName, `step 的 uses 引用必须固定到 40 位提交：${step.uses}`));
        }
        if (typeof step.uses === 'string' && step.uses.startsWith('actions/checkout')) {
          if (!isObject(step.with) || step.with['persist-credentials'] !== false) {
            findings.push(finding('W2', file, jobName, 'actions/checkout 必须设置 with.persist-credentials: false'));
          }
        }
      }
    }
  }

  if (!Object.prototype.hasOwnProperty.call(document ?? {}, 'permissions')) {
    findings.push(finding('W4', file, null, 'workflow 必须声明顶层 permissions'));
  } else {
    findings.push(...inspectPermissions(document.permissions, file, null));
    if (
      isObject(document.permissions) &&
      Object.values(jobs).some((job) => isObject(job) && isSelfHosted(job['runs-on'])) &&
      Object.keys(document.permissions).length !== 0
    ) {
      findings.push(finding('W4', file, null, '包含 self-hosted job 时顶层 permissions 必须是空映射'));
    }
  }

  if (pushCoversMainBranch(document?.on) && document?.concurrency?.['cancel-in-progress'] === true) {
    findings.push(finding('W5', file, null, '覆盖默认分支的 push 不得将 concurrency.cancel-in-progress 设为 true'));
  }

  if (Object.prototype.hasOwnProperty.call(document ?? {}, 'concurrency')) {
    if (!isObject(document.concurrency) || !Object.prototype.hasOwnProperty.call(document.concurrency, 'cancel-in-progress')) {
      findings.push(finding('W6', file, null, '声明 concurrency 时必须显式声明 cancel-in-progress'));
    }
  }

  return findings;
}

export function checkWorkflows(rootDir) {
  const workflowsDir = path.join(rootDir, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir) || !fs.statSync(workflowsDir).isDirectory()) return [];

  const files = fs.readdirSync(workflowsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const findings = [];

  for (const name of files) {
    const absolute = path.join(workflowsDir, name);
    const relative = path.relative(rootDir, absolute).split(path.sep).join('/');
    let document;
    try {
      document = parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      throw new Error(`无法解析 workflow ${relative}: ${error.message}`, { cause: error });
    }
    findings.push(...inspectWorkflow(document, relative));
  }

  return findings;
}

function main() {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  try {
    const findings = checkWorkflows(rootDir);
    if (findings.length === 0) {
      console.log('workflow-check: no findings');
      return;
    }
    for (const item of findings) {
      console.log(`::error::${item.file} [${item.rule}] ${item.message}`);
    }
    process.exitCode = 1;
  } catch (error) {
    console.error(`workflow-check: ${error.message}`);
    process.exitCode = 1;
  }
}

/**
 * 是否作为 CLI 被直接执行。
 *
 * 不能用 `import.meta.url === \`file://${process.argv[1]}\``：`import.meta.url` 会
 * 对路径里的空格等字符做百分号编码，而 `process.argv[1]` 不会——两者不相等时
 * `main()` 会被静默跳过，检查变成"永远通过"。这正是本检查要防的那类失败。
 */
function invokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;

  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(entry) === fs.realpathSync(self);
  } catch {
    return path.basename(entry) === path.basename(self);
  }
}

if (invokedDirectly()) main();
