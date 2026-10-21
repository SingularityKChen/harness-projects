#!/usr/bin/env node
/**
 * 裸包名解析守卫：检查本检出的 `@harness-projects/*` 是否解析在本检出之内。
 *
 * 用法：node scripts/resolution-check.mjs      （退出 0 静默；退出 1 时 stderr 首行以 `resolution-check:` 开头，
 *       越界时逐包列出落点与修复命令，根 manifest 读不到或没有名单时只有这一行）
 *
 * 存在的理由（issue #186，ExecPlan `2026-10-21-worktree-resolution-guard`）：Node 的裸包名查找从
 * 调用方目录逐级向上找 `node_modules`。检出嵌在 `<主检出>/.worktrees/<slug>/` 下又没装依赖时，
 * 它会命中主检出的 `node_modules`，测试跑的是主检出的代码，红/绿都不是本检出的证据。
 *
 * 判据只有一条：解析结果取 realpath 后必须落在检出根的 realpath 之内。它与逃逸机制（祖先
 * `node_modules`、`NODE_PATH`、`$HOME/.node_modules`、软链）无关，也不读 pnpm 的任何内部状态。
 * 包名取根 `package.json` 的 `devDependencies`；一个都没有时抛错，空集不能当作通过。
 *
 * 只 import `node:` 内建模块：依赖没装好时，守卫自己不能先崩。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCOPE = '@harness-projects/';
const FIX_COMMAND = 'pnpm install --frozen-lockfile';

/**
 * 返回本检出里没有解析到根之内的包：`{ name, resolved, reason }`。
 * 越界时 `reason` 是 `'outside-root'`；解析抛错时 `resolved` 为 `null`、`reason` 是错误码（不外抛，一次列全）。
 * 空数组即通过。根 manifest 不可读或没有 `@harness-projects/*` 时抛错。
 */
export function findStrayResolutions(root) {
  const realRoot = fs.realpathSync(root);
  const manifestPath = path.join(realRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const names = Object.keys(manifest.devDependencies ?? {}).filter((name) => name.startsWith(SCOPE));
  if (names.length === 0) {
    throw new Error(`根 package.json 的 devDependencies 里没有任何 ${SCOPE}*，无法判定解析落点`);
  }

  const resolveFromRoot = createRequire(manifestPath).resolve;
  const stray = [];
  for (const name of names) {
    try {
      const resolved = fs.realpathSync(resolveFromRoot(name));
      if (!resolved.startsWith(realRoot + path.sep)) stray.push({ name, resolved, reason: 'outside-root' });
    } catch (error) {
      stray.push({ name, resolved: null, reason: error.code ?? 'UNRESOLVED' });
    }
  }
  return stray;
}

function main() {
  // 根取自脚本自身的位置，与 cwd 无关。
  const root = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  let stray;
  try {
    stray = findStrayResolutions(root);
  } catch (error) {
    console.error(`resolution-check: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (stray.length === 0) return;

  console.error(
    [
      `resolution-check: ${stray.length} 个 ${SCOPE}* 包没有解析到检出 ${root} 之内，这次运行的红/绿都不是本检出的证据：`,
      ...stray.map(({ name, resolved, reason }) => `  ${name} -> ${resolved ?? reason}`),
      `在检出根目录执行：${FIX_COMMAND}`,
    ].join('\n'),
  );
  process.exitCode = 1;
}

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
