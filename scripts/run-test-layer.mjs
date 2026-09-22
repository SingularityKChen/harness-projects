#!/usr/bin/env node
/**
 * 运行一个测试层，并把"空层"与"零用例层"判为失败。
 *
 * 用法：node scripts/run-test-layer.mjs <layer> <invariant>
 *
 * 存在的理由（ExecPlan `2026-09-21-merge-gate-layers` D2）：`node --test` 对
 * "没有用例"退出 0，因此"目录存在即绿"。在 YAML 里数文件判不了"用例数非零"
 * （Node 26 实测：只有 `describe` 没有用例的文件摘要行是 `ℹ tests 0`，只有
 * `skip` 的文件是 `ℹ tests 1 / ℹ skipped 1`），所以判定放在这里：先数
 * `*.test.js` 文件，再解析 `node --test` 的摘要行，任何一步判不出来都 fail closed。
 *
 * 纯 Node、无网络、无凭据：只用 `fs` 与 `node:child_process` 起本机的
 * `node --test`，不读任何 secret，因此可以离线契约测试。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const USAGE = 'usage: node scripts/run-test-layer.mjs <layer> <invariant>';

/** node 的 reporter 在管道里不输出颜色；这里仍然剥一次 ANSI，避免解析被颜色码打断。 */
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;

/** 捕获 node --test 输出的上限；层输出远小于它，但 spawnSync 默认的 1 MiB 会截断大层。 */
const MAX_BUFFER = 8 * 1024 * 1024;

/** 该层有多少个 `*.test.js` 用例文件。层可以是目录，也可以是单个用例文件。 */
export function countTestFiles(layer) {
  let stats;
  try {
    stats = fs.statSync(layer);
  } catch {
    return 0;
  }
  if (stats.isFile()) return layer.endsWith('.test.js') ? 1 : 0;
  if (!stats.isDirectory()) return 0;

  let entries;
  try {
    entries = fs.readdirSync(layer, { recursive: true });
  } catch {
    return 0;
  }
  return entries.filter((entry) => {
    if (!entry.endsWith('.test.js')) return false;
    try {
      return fs.statSync(path.join(layer, entry)).isFile();
    } catch {
      return false;
    }
  }).length;
}

/** 摘要行里的某个计数；同名行出现多次时取最后一条（`node --test` 的汇总在末尾）。 */
function lastCount(output, label) {
  const pattern = new RegExp(`^ℹ\\s+${label}\\s+(\\d+)\\s*$`, 'gm');
  const matches = [...output.matchAll(pattern)];
  return matches.length === 0 ? null : Number(matches[matches.length - 1][1]);
}

/**
 * 解析 `node --test` 的汇总。解析不到 `ℹ tests <n>` 时返回 `null`——调用方必须
 * 把它当失败处理（fail closed），不能当成"没有需要检查的用例"。
 */
export function parseSummary(output) {
  const text = output.replace(ANSI_PATTERN, '');
  const tests = lastCount(text, 'tests');
  if (tests === null) return null;
  // skipped / todo 与 tests 由同一个汇总块打印；缺失时按 0 计，只有 tests 是硬锚点。
  return { tests, skipped: lastCount(text, 'skipped') ?? 0, todo: lastCount(text, 'todo') ?? 0 };
}

/** 失败一律用 `::error::` 注解，并把被保护的不变量放在同一条注解里。 */
function fail(layer, invariant, reason, exitCode = 1) {
  console.log(`::error::${layer}：${reason}。该层保护的不变量：${invariant}`);
  process.exitCode = exitCode;
}

function runLayer(layer) {
  const result = spawnSync(process.execPath, ['--test', layer], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  // 透传 node --test 的输出：失败时定位仍然要看得到具体是哪个用例红的。
  process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  return result;
}

function main() {
  const [layer, invariant] = process.argv.slice(2);
  if (layer === undefined || invariant === undefined) {
    console.error(`run-test-layer: 缺少 <layer> 或 <invariant>。${USAGE}`);
    process.exitCode = 1;
    return;
  }

  // 不变量先打一遍：即使后面的测试输出很长，CI 日志开头也能看到被保护的是什么。
  console.log(`run-test-layer: ${layer} —— 该层保护的不变量：${invariant}`);

  const files = countTestFiles(layer);
  if (files === 0) {
    fail(layer, invariant, '没有任何 *.test.js 用例文件，空层不算通过');
    return;
  }

  const result = runLayer(layer);
  const summary = parseSummary(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (summary === null) {
    fail(layer, invariant, '无法从 node --test 输出解析摘要行 "ℹ tests <n>"，按 fail closed 处理');
    return;
  }

  const executed = summary.tests - summary.skipped - summary.todo;
  if (executed < 1) {
    fail(
      layer,
      invariant,
      `摘要行 tests ${summary.tests}、skipped ${summary.skipped}、todo ${summary.todo}：没有任何断言真正执行，零用例层不算通过`,
    );
    return;
  }

  if (result.status !== 0) {
    fail(layer, invariant, `测试失败（node --test 退出码 ${result.status ?? 'signal'}）`, result.status ?? 1);
    return;
  }

  console.log(
    `run-test-layer: ${layer} 通过，执行 ${executed} 条用例` +
      `（tests ${summary.tests}、skipped ${summary.skipped}、todo ${summary.todo}）。`,
  );
}

/**
 * 是否作为 CLI 被直接执行。契约测试要 import `parseSummary` / `countTestFiles`，
 * 因此不能用"import 即执行"的写法；比较用 realpath，理由同 `workflow-check.mjs`：
 * `file://${argv[1]}` 在路径含空格时会静默跳过 main()，检查变成永远通过。
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
