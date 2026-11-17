#!/usr/bin/env node
/**
 * Windows 原生 lane 的命名清单与反空心判定（issue #646 / ExecPlan
 * `2026-11-17-windows-native-lane`，Batch 2）。
 *
 * 用法：node scripts/windows-native-checks.mjs --set <native-git|private-data>
 *          [--profile <标准用户 profile> [--foreign <管理员预置的外来 owner fixture>]]
 *
 * 这个脚本是 lane 的唯一清单来源：文件集、每个文件的用例下界、允许的 skip 数
 * 都只在这里出现一次（`SETS`），`ci.yml` 只按 set 名调用，不内联 `.test.js`。
 * 存在的理由：`node --test` 对「文件被删」「用例被 skip」「零执行」都退出 0，
 * 所以 lane 必须在测试进程之外再做一次判定：
 *
 * - 清单文件必须存在、位于 `tests/integration/`、以 `.test.js` 结尾、不得重复；
 *   每个文件有正整数用例下界，删除/合并用例必须在同一 PR 更新此处。
 * - 每个文件必须退出 0、摘要行 `ℹ tests <n>` 可解析、真正执行（tests ≥ 1）、
 *   达到下界、`todo` 为 0。
 * - 合计 `skipped` 必须精确等于 `allowedSkips`：多一条是 skip 造假绿，少一条
 *   说明清单没有随用例移除更新。
 * - 非 win32 平台直接拒绝，不用 mock 替代原生执行。
 *
 * 纯 Node、无网络、无凭据。`--profile` 时本进程把 USERPROFILE/TEMP/TMP 指向
 * 标准用户的真实 profile，并以检出根为 cwd；账户、profile 与 foreign fixture
 * 的创建/清理属于 `ci.yml` 的内联 pwsh 步骤（唯一 owner），这里不碰账户。
 */
import { assertLocalResolutions } from './resolution-check.mjs';
import { parseSummary } from './run-test-layer.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTEGRATION_DIR = 'tests/integration/';

/** 捕获 node --test 输出的上限；完整层输出远小于它，但默认 1 MiB 会截断大文件。 */
const MAX_BUFFER = 8 * 1024 * 1024;

/**
 * 清单与判定的唯一来源。下界是「单调下限」：新增用例不需要改这里；删除或合并
 * 用例必须在同一 PR 更新，否则 lane 变红（防覆盖静默缩水）。`allowedSkips`
 * 是精确值：当前唯一合法 skip 是 `harness-plugin-artifact.test.js` 里
 * 「干净数据根首次创建」的 win32 skip，归 #644 接管；#644 必须在同一 PR
 * 删除该 skip 并把这里改成 0。
 */
export const SETS = {
  'native-git': {
    files: [
      { file: 'tests/integration/development-local-git-windows.test.js', minTests: 15 },
      { file: 'tests/integration/local-git-start-work-resume.test.js', minTests: 3 },
    ],
    allowedSkips: 0,
  },
  'private-data': {
    files: [
      { file: 'tests/integration/harness-plugin-windows-private-data.test.js', minTests: 39 },
      { file: 'tests/integration/harness-plugin-windows-artifact.test.js', minTests: 1 },
      { file: 'tests/integration/harness-plugin-artifact.test.js', minTests: 29 },
    ],
    allowedSkips: 1,
  },
};

const SET_IDS = Object.keys(SETS);
const USAGE = `usage: node scripts/windows-native-checks.mjs --set <${SET_IDS.join('|')}> [--profile <dir> [--foreign <dir>]]`;

/** 失败一律用 `::error::` 注解，并把规则放在同一条注解里（与 run-test-layer 一致）。 */
function fail(message) {
  console.log(`::error::windows-native-checks: ${message}`);
  process.exitCode = 1;
}

/**
 * 严格解析参数：只接受 `--set` / `--profile` / `--foreign` 三个 flag；位置参数、
 * 未知 flag、重复 flag、缺值都是错误。`--profile`/`--foreign` 只与 `private-data`
 * 组合，`--foreign` 需要同时给出 `--profile`。非法输入抛错，由 `main` 转成
 * `::error::` 与非零退出，不允许「忽略多余参数继续跑」。
 */
export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--set' && flag !== '--profile' && flag !== '--foreign') {
      throw new Error(`不认识的参数 ${JSON.stringify(flag)}。${USAGE}`);
    }
    if (values.has(flag)) throw new Error(`${flag} 只能出现一次。${USAGE}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 缺少取值。${USAGE}`);
    values.set(flag, value);
    index += 1;
  }

  const setId = values.get('--set');
  if (setId === undefined) throw new Error(`缺少 --set。${USAGE}`);
  if (!Object.prototype.hasOwnProperty.call(SETS, setId)) {
    throw new Error(`未知 set：${setId}（可选 ${SET_IDS.join('、')}）。${USAGE}`);
  }
  const profile = values.get('--profile') ?? null;
  const foreign = values.get('--foreign') ?? null;
  if ((profile !== null || foreign !== null) && setId !== 'private-data') {
    throw new Error(`--profile/--foreign 只能与 --set private-data 组合。${USAGE}`);
  }
  if (foreign !== null && profile === null) throw new Error(`--foreign 需要同时给出 --profile。${USAGE}`);
  return { setId, profile, foreign };
}

/** 非 win32 返回非空拒绝文案（返回非空即失败）；不做 mock 平台替代。 */
export function platformRefusal(platform) {
  if (platform === 'win32') return null;
  return `Windows 原生 lane 只在 win32 上执行，当前平台是 ${platform}；原生用例不能用 mock 平台替代。`;
}

/**
 * 清单自检：文件必须存在且是普通文件、位于 `tests/integration/`（拒绝 `..` 穿越）、
 * 以 `.test.js` 结尾、全局不得重复；每个文件必须有正整数 `minTests`；set 的
 * `allowedSkips` 必须是非负整数，`files` 必须非空（清单被清空不算通过）。
 * 返回问题列表，空数组表示清单合法。`sets` 参数只为契约测试注入合成清单。
 */
export function manifestErrors(root, sets = SETS) {
  const problems = [];
  const seen = new Set();
  for (const [setId, set] of Object.entries(sets)) {
    if (set === null || typeof set !== 'object' || !Array.isArray(set.files) || set.files.length === 0) {
      problems.push(`set ${setId} 的 files 必须是非空数组（清单被清空不算通过）`);
      continue;
    }
    if (!Number.isInteger(set.allowedSkips) || set.allowedSkips < 0) {
      problems.push(`set ${setId} 的 allowedSkips 必须是非负整数`);
    }
    for (const entry of set.files) {
      const file = entry?.file;
      if (typeof file !== 'string' || file.length === 0) {
        problems.push(`set ${setId} 有文件条目缺少 file`);
        continue;
      }
      if (!file.startsWith(INTEGRATION_DIR) || file.includes('..')) {
        problems.push(`set ${setId} 的文件必须位于 ${INTEGRATION_DIR}：${file}`);
        continue;
      }
      if (!file.endsWith('.test.js')) {
        problems.push(`set ${setId} 的文件必须以 .test.js 结尾：${file}`);
        continue;
      }
      if (!Number.isInteger(entry.minTests) || entry.minTests < 1) {
        problems.push(`set ${setId} 的 ${file} 的 minTests 必须是正整数`);
      }
      if (seen.has(file)) problems.push(`文件在清单里重复：${file}`);
      seen.add(file);
      let isFile = false;
      try {
        isFile = fs.statSync(path.join(root, file)).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) problems.push(`文件不存在或不是普通文件：${file}`);
    }
  }
  return problems;
}

/**
 * 反空心判定：逐文件要求退出码为 0、摘要可解析、tests ≥ 1、tests ≥ minTests、
 * todo 为 0；合计 skipped 精确等于 allowedSkips；缺少某文件的 run 结果也失败。
 * 返回 `{ problems, totals }`，空 problems 表示该 set 通过。
 */
export function evaluate(setId, results, sets = SETS) {
  const totals = { files: 0, tests: 0, skipped: 0, todo: 0 };
  const set = sets[setId];
  if (set === undefined || !Array.isArray(set.files)) return { problems: [`未知 set：${setId}`], totals };

  const byFile = new Map();
  for (const result of results ?? []) {
    if (result && typeof result.file === 'string' && !byFile.has(result.file)) byFile.set(result.file, result);
  }

  const problems = [];
  totals.files = set.files.length;
  for (const { file, minTests } of set.files) {
    const result = byFile.get(file);
    if (result === undefined) {
      problems.push(`${file}: 缺少该文件的运行结果`);
      continue;
    }
    if (result.status !== 0) {
      problems.push(`${file}: 测试进程失败（退出码 ${result.status ?? 'signal'}）`);
      continue;
    }
    const summary = parseSummary(result.output ?? '');
    if (summary === null) {
      problems.push(`${file}: 无法从 node --test 输出解析摘要行 "ℹ tests <n>"，按 fail closed 处理`);
      continue;
    }
    totals.tests += summary.tests;
    totals.skipped += summary.skipped;
    totals.todo += summary.todo;
    if (summary.tests < 1) problems.push(`${file}: 零执行（tests ${summary.tests}），零用例文件不算通过`);
    if (summary.tests < minTests) problems.push(`${file}: tests ${summary.tests} 低于清单下界 ${minTests}`);
    if (summary.todo > 0) problems.push(`${file}: todo 必须为 0，实际 ${summary.todo}`);
  }
  if (Number.isInteger(set.allowedSkips) && totals.skipped !== set.allowedSkips) {
    problems.push(
      `set ${setId} 的 skip 数与预算不符：期望 ${set.allowedSkips}，实际 ${totals.skipped}` +
        '（多=skip 造假绿，少=清单未随用例移除更新）',
    );
  }
  return { problems, totals };
}

/**
 * 执行单个测试文件：无 shell、cwd 固定为检出根、输出上限 8 MiB、
 * `--test-timeout=120000` 兜住挂起的用例（job 级 15 分钟是外圈兜底）。
 * stdout/stderr 原样透传后返回 `{ file, status, output }` 供 `evaluate` 判定。
 */
export function runFile(file) {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=spec', '--test-timeout=120000', file],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER, shell: false },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { file, status: result.status, output };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    return;
  }

  const refusal = platformRefusal(process.platform);
  if (refusal !== null) {
    fail(refusal);
    return;
  }

  if (args.profile !== null) {
    const profile = path.resolve(args.profile);
    const temp = path.join(profile, 'AppData', 'Local', 'Temp');
    fs.mkdirSync(temp, { recursive: true });
    process.env.USERPROFILE = profile;
    process.env.TEMP = temp;
    process.env.TMP = temp;
    if (args.foreign !== null) process.env.HARNESS_WINDOWS_FOREIGN_PROFILE = path.resolve(args.foreign);
  }
  process.chdir(ROOT);

  const manifest = manifestErrors(ROOT);
  if (manifest.length > 0) {
    for (const problem of manifest) fail(problem);
    return;
  }

  try {
    assertLocalResolutions(ROOT);
  } catch (error) {
    fail(error.message);
    return;
  }

  const results = SETS[args.setId].files.map(({ file }) => runFile(file));
  const { problems, totals } = evaluate(args.setId, results);
  if (problems.length > 0) {
    for (const problem of problems) fail(problem);
    return;
  }

  console.log(
    `windows-native-checks: set=${args.setId} files=${totals.files} tests=${totals.tests} ` +
      `skipped=${totals.skipped} todo=${totals.todo}`,
  );
}

/**
 * 是否作为 CLI 被直接执行。契约测试要 import 纯函数，因此不能用「import 即执行」。
 * 比较用 realpath，理由同 `workflow-check.mjs`：`file://${argv[1]}` 在路径含空格时
 * 会静默跳过 main()，判定变成永远通过。
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
