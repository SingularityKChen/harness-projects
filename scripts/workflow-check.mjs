import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

export const RULES = [
  { id: 'W1', title: '每个 job 都声明 1 到 15 分钟的超时上界' },
  { id: 'W2', title: '每个 checkout step 都禁用持久化凭据' },
  { id: 'W3', title: '每个外部 action 与可复用 workflow 都使用不可变提交引用' },
  { id: 'W4', title: 'workflow 权限最小且自托管 job 使用空权限' },
  { id: 'W5', title: '覆盖默认分支的 push 不得取消进行中的记录' },
  { id: 'W6', title: '声明 concurrency 时必须显式声明取消策略' },
  { id: 'W7', title: 'jobs 必须是非空映射' },
];

const PINNED_USE = /^[^/\s]+\/[^@\s]+(?:\/[^@\s]+)*@[0-9a-fA-F]{40}$/;

function finding(rule, file, job, message) {
  return { rule, file, job, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const DEFAULT_BRANCH = 'main';

/**
 * GitHub 托管 runner 的标签白名单。刻意保守：不认识的标签一律按 self-hosted
 * 处理（fail-closed）。出现合法的新标签时扩表是一次有意识的决策——理由与
 * §9.5 里 W1 的 15 分钟上界一致，不能在单个 workflow 里悄悄放宽判定。
 */
const GITHUB_HOSTED_RUNNERS = new Set([
  'ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-20.04',
  'windows-latest', 'windows-2025', 'windows-2022', 'windows-2019',
  'macos-latest', 'macos-latest-xlarge',
  'macos-15', 'macos-15-xlarge',
  'macos-14', 'macos-14-xlarge',
  'macos-13', 'macos-13-xlarge',
  'macos-12', 'macos-11',
]);

/** 把 `runs-on` 的字符串 / 数组 / `{labels}` 映射三种写法摊平成标签列表。 */
function runsOnLabels(runsOn) {
  if (typeof runsOn === 'string') return [runsOn];
  if (Array.isArray(runsOn)) return runsOn.flatMap(runsOnLabels);
  if (isObject(runsOn) && Object.prototype.hasOwnProperty.call(runsOn, 'labels')) {
    return runsOnLabels(runsOn.labels);
  }
  return [];
}

/**
 * 是否落在自托管机器上。未知即自托管（fail-closed）：
 * - 摊平不出标签（缺失、`{group}` 不带 `labels` 等未知形状）；
 * - 标签不在托管白名单里——GitHub 按标签集匹配调度，不要求字面量
 *   `self-hosted`，本仓库自己的 runner 就是靠 `[macos, arm64, dsh]`
 *   这类不含该字面量的标签集被匹配到的。未展开的矩阵表达式（含 `${{`）
 *   同样落在这一条：它必然不是白名单里的字面量，不需要单独判一次——
 *   单独判会是死代码，"含 `${{`" 蕴含"不在白名单里"，两者永远同真同假。
 * 字符串与数组两种写法在这里被统一摊平成同一条判据，不再各用一套比较
 * 方式——旧实现字符串分支用 `.includes()`、数组分支用严格相等，两者不
 * 对称，`runs-on: [self-hosted-mac]` 这种标签会被数组分支放过。
 */
function isSelfHosted(runsOn) {
  const labels = runsOnLabels(runsOn);
  if (labels.length === 0) return true;
  return labels.some((label) => {
    if (typeof label !== 'string') return true;
    if (label === 'self-hosted') return true;
    return !GITHUB_HOSTED_RUNNERS.has(label);
  });
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
 * 把 GitHub 分支过滤器的 glob（`*` 匹配单段内任意字符、`**` 跨段匹配、
 * `?` 匹配单字符）转成正则；其余字符按字面量转义。
 */
function branchGlobToRegExp(pattern) {
  const SPECIAL = /[.+^${}()|[\]\\]/;
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else if (SPECIAL.test(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesBranch(pattern, branch) {
  return typeof pattern === 'string' && branchGlobToRegExp(pattern).test(branch);
}

/**
 * push 是否会覆盖默认分支。只限定 `branches` 与 `branches-ignore` 两种写法，
 * 其余（含 `push:` 空值）都视为覆盖全部分支。`branches`/`branches-ignore`
 * 按 GitHub 的 glob 语义匹配（`*`、`**`），不是字面量相等——`['**']` 这类
 * 通配符必须被认成覆盖 main，`Array.includes('main')` 判定不到。
 */
function pushCoversMainBranch(on) {
  const triggers = normalizeTriggers(on);
  if (!Object.prototype.hasOwnProperty.call(triggers, 'push')) return false;

  const push = triggers.push;
  if (!isObject(push)) return true;
  if (Object.prototype.hasOwnProperty.call(push, 'branches')) {
    return asList(push.branches).some((pattern) => matchesBranch(pattern, DEFAULT_BRANCH));
  }
  if (Object.prototype.hasOwnProperty.call(push, 'branches-ignore')) {
    return !asList(push['branches-ignore']).some((pattern) => matchesBranch(pattern, DEFAULT_BRANCH));
  }
  return true;
}

/**
 * `cancel-in-progress` 的取值是否等价于字面量 true：既拦布尔值 `true`，
 * 也拦带引号的字符串标量 `'true'`（大小写与首尾空白不敏感）。
 * `${{ github.event_name == 'pull_request' }}` 这类表达式字符串不匹配，
 * 必须继续放行——`ci.yml` 依赖这个写法。
 */
function isTruthyLiteral(value) {
  if (value === true) return true;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
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

/**
 * 是否是可复用 workflow 调用（`jobs.<id>.uses`）。GitHub 只允许这类 job
 * 出现 name/uses/id/needs/permissions/if/with/secrets/strategy/concurrency，
 * 没有 `runs-on`，也不允许 `timeout-minutes` 或 `steps`。
 */
function isCallJob(job) {
  return isObject(job) && typeof job.uses === 'string';
}

/** job 声明了非空 permissions 时，它对顶层的最小权限是一次覆盖。 */
function jobPermissionsOverride(job, file, jobName) {
  const findings = [];
  if (!isObject(job) || !Object.prototype.hasOwnProperty.call(job, 'permissions')) return findings;

  const jobPermissions = job.permissions;
  findings.push(...inspectPermissions(jobPermissions, file, jobName));

  // 可复用 workflow 调用没有 runs-on，self-hosted 判定对它不适用——否则
  // 任何声明了 permissions 的 call job 都会被误判，重现"无法满足的红门禁"。
  if (
    !isCallJob(job) &&
    isSelfHosted(job['runs-on']) &&
    isObject(jobPermissions) &&
    Object.keys(jobPermissions).length !== 0
  ) {
    findings.push(finding('W4', file, jobName, 'self-hosted job 不得声明非空 permissions（顶层已经是空映射）'));
  }
  return findings;
}

/**
 * W5/W6 共用的判定：同一套逻辑既用在 workflow 顶层的 `concurrency`，
 * 也用在每个 job 的 `concurrency`（`jobs.<id>.concurrency` 是合法键，
 * call job 也可以声明它）。
 */
function inspectConcurrency(container, file, jobName, pushCoversMain) {
  const findings = [];
  const subject = jobName === null ? '顶层' : `job ${jobName} 的`;
  const hasConcurrency = isObject(container) && Object.prototype.hasOwnProperty.call(container, 'concurrency');
  const concurrency = hasConcurrency ? container.concurrency : undefined;

  if (pushCoversMain && isTruthyLiteral(concurrency?.['cancel-in-progress'])) {
    findings.push(finding('W5', file, jobName, `覆盖默认分支的 push 不得让${subject} concurrency.cancel-in-progress 取真值字面量`));
  }
  if (hasConcurrency && (!isObject(concurrency) || !Object.prototype.hasOwnProperty.call(concurrency, 'cancel-in-progress'))) {
    findings.push(finding('W6', file, jobName, `${subject}声明 concurrency 时必须显式声明 cancel-in-progress`));
  }
  return findings;
}

/**
 * `uses` 的 `owner/repo` 部分：去掉 `@ref` 与子路径、转小写。按 action
 * 精确匹配而不是按字符串前缀匹配——`actions/checkout-sarif` 不是
 * `actions/checkout`，`Actions/Checkout` 是。
 */
function usesActionName(uses) {
  const withoutRef = uses.split('@')[0];
  const segments = withoutRef.split('/');
  const name = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : withoutRef;
  return name.toLowerCase();
}

const CHECKOUT_ACTION = 'actions/checkout';

/** 单个 job 的 W1/W2/W3/W4/W5/W6 判定。 */
function inspectJob(job, jobName, file, pushCoversMain) {
  const findings = [];

  if (isCallJob(job)) {
    // timeout-minutes 与 steps 不在 GitHub 允许的键里；W1/W2 对这类 job
    // 不适用，要求就是制造一个无法满足的红门禁。
    if (!job.uses.startsWith('./') && !PINNED_USE.test(job.uses)) {
      findings.push(finding('W3', file, jobName, `job 的 uses 引用必须固定到 40 位提交：${job.uses}`));
    }
    findings.push(...jobPermissionsOverride(job, file, jobName));
    findings.push(...inspectConcurrency(job, file, jobName, pushCoversMain));
    return findings;
  }

  if (!isObject(job) || !Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] < 1 || job['timeout-minutes'] > 15) {
    findings.push(finding('W1', file, jobName, 'job 必须声明 1 到 15 之间的整数 timeout-minutes'));
  }

  findings.push(...jobPermissionsOverride(job, file, jobName));
  findings.push(...inspectConcurrency(job, file, jobName, pushCoversMain));

  if (isObject(job)) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      if (!isObject(step)) continue;
      if (typeof step.uses === 'string' && !step.uses.startsWith('./') && !PINNED_USE.test(step.uses)) {
        findings.push(finding('W3', file, jobName, `step 的 uses 引用必须固定到 40 位提交：${step.uses}`));
      }
      if (typeof step.uses === 'string' && usesActionName(step.uses) === CHECKOUT_ACTION) {
        if (!isObject(step.with) || step.with['persist-credentials'] !== false) {
          findings.push(finding('W2', file, jobName, 'actions/checkout 必须设置 with.persist-credentials: false'));
        }
      }
    }
  }

  return findings;
}

function inspectWorkflow(document, file) {
  const findings = [];

  // "能解析但结构不对"必须报告，不能静默通过——`jobs` 写成 YAML 列表
  // 这类输入语法合法，但不是 W1-W6 能处理的形状。
  const jobsValue = document?.jobs;
  let jobs = {};
  if (jobsValue === undefined) {
    findings.push(finding('W7', file, null, 'workflow 缺少 jobs'));
  } else if (!isObject(jobsValue)) {
    findings.push(finding('W7', file, null, 'workflow 的 jobs 必须是映射'));
  } else {
    jobs = jobsValue;
  }

  const pushCoversMain = pushCoversMainBranch(document?.on);

  for (const [jobName, job] of Object.entries(jobs)) {
    findings.push(...inspectJob(job, jobName, file, pushCoversMain));
  }

  if (!Object.prototype.hasOwnProperty.call(document ?? {}, 'permissions')) {
    findings.push(finding('W4', file, null, 'workflow 必须声明顶层 permissions'));
  } else {
    findings.push(...inspectPermissions(document.permissions, file, null));
    const anySelfHosted = Object.values(jobs).some(
      (job) => isObject(job) && !isCallJob(job) && isSelfHosted(job['runs-on']),
    );
    if (isObject(document.permissions) && anySelfHosted && Object.keys(document.permissions).length !== 0) {
      findings.push(finding('W4', file, null, '包含 self-hosted job 时顶层 permissions 必须是空映射'));
    }
  }

  findings.push(...inspectConcurrency(document, file, null, pushCoversMain));

  return findings;
}

/**
 * `.github/workflows` 下待检查的文件名。目录缺失或一个 *.yml/*.yaml 都没
 * 匹配到都视为不可判定，必须抛错而不是返回空结果——"没有 workflow" 和
 * "合规" 是两件事，静默放行等于让这条检查在最需要它的时候失效。
 *
 * 用 `statSync` 而不是 `readdirSync` 的 `Dirent.isFile()`：后者不跟随
 * 符号链接，会让符号链接指向的 workflow 被静默跳过。
 */
function listWorkflowFiles(workflowsDir, rootDir) {
  if (!fs.existsSync(workflowsDir) || !fs.statSync(workflowsDir).isDirectory()) {
    throw new Error(`workflows 目录不存在：${path.relative(rootDir, workflowsDir) || workflowsDir}`);
  }

  const files = fs.readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .filter((name) => {
      try {
        return fs.statSync(path.join(workflowsDir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();

  if (files.length === 0) {
    throw new Error(`workflows 目录下没有匹配到 *.yml/*.yaml 文件：${path.relative(rootDir, workflowsDir) || workflowsDir}`);
  }
  return files;
}

/** 读取失败（权限、损坏的文件描述符等）与解析失败必须分开措辞，方便定位。 */
function readWorkflowDocument(absolute, relative) {
  let raw;
  try {
    raw = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 workflow ${relative}: ${error.message}`, { cause: error });
  }
  try {
    return parse(raw);
  } catch (error) {
    throw new Error(`无法解析 workflow ${relative}: ${error.message}`, { cause: error });
  }
}

function collectFindings(rootDir, workflowsDir, files) {
  const findings = [];
  for (const name of files) {
    const absolute = path.join(workflowsDir, name);
    const relative = path.relative(rootDir, absolute).split(path.sep).join('/');
    const document = readWorkflowDocument(absolute, relative);
    findings.push(...inspectWorkflow(document, relative));
  }
  return findings;
}

export function checkWorkflows(rootDir) {
  const workflowsDir = path.join(rootDir, '.github', 'workflows');
  const files = listWorkflowFiles(workflowsDir, rootDir);
  return collectFindings(rootDir, workflowsDir, files);
}

function main() {
  const rootDir = path.resolve(process.argv[2] ?? process.cwd());
  let files;
  let findings;
  try {
    const workflowsDir = path.join(rootDir, '.github', 'workflows');
    files = listWorkflowFiles(workflowsDir, rootDir);
    findings = collectFindings(rootDir, workflowsDir, files);
  } catch (error) {
    // 内部错误（目录缺失、零匹配、读取失败、解析失败）与规则违规必须用
    // 不同 exit code 区分：内部错误取 3，规则违规取 1（见下）。
    console.error(`workflow-check: ${error.message}`);
    process.exitCode = 3;
    return;
  }

  if (findings.length === 0) {
    console.log(`workflow-check: no findings（已检查 ${files.length} 个文件）`);
    return;
  }
  for (const item of findings) {
    console.log(`::error::${item.file} [${item.rule}] ${item.message}`);
  }
  process.exitCode = 1;
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
