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
 * 判据：各解析边界的结果取 realpath 后必须落在检出根的 realpath 之内。它与逃逸机制（祖先
 * `node_modules`、`NODE_PATH`、`$HOME/.node_modules`、软链）无关，也不读 pnpm 的任何内部状态。
 * 包名取根 `package.json` 的 `devDependencies`；一个都没有时抛错，空集不能当作通过。
 *
 * 只依赖 Node 内建模块与本仓 source-tree 剪枝来源，不加载工作区产品包。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ignoredDirectoryNames } from '../tests/fixtures/source-tree.mjs';

const SCOPE = '@harness-projects/';
const FIX_COMMAND = 'pnpm install --frozen-lockfile';

/**
 * 静态源码入口复用 source-tree 的构建产物剪枝；实际命中的 workspace 包另扫描全部包内目录，
 * 发现 dist/build 下会改变 Node 解析的 package scope 与 node_modules 父目录。依赖树不递归。
 */
export function resolutionContexts(root) {
  const realRoot = fs.realpathSync(root);
  const ignored = ignoredDirectoryNames(realRoot);
  const contexts = new Set([realRoot]);
  const visitedSourceTree = new Set();
  const visitedWorkspacePackages = new Set();
  const invalid = [];
  const inspectModules = (directory) => {
    const modules = path.join(directory, 'node_modules');
    try {
      fs.lstatSync(modules);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    contexts.add(directory);
    const target = fs.realpathSync(modules); // dangling links fail closed
    fs.accessSync(target, fs.constants.R_OK | fs.constants.X_OK);
    if (!inside(realRoot, target) || !fs.statSync(target).isDirectory()) invalid.push(modules);
  };
  const visit = (directory, consumedWorkspacePackage = false) => {
    if (!inside(realRoot, directory)) throw new Error(`实际 workspace 包根不在检出内：${directory}`);
    const visited = consumedWorkspacePackage ? visitedWorkspacePackages : visitedSourceTree;
    if (visited.has(directory)) return;
    visited.add(directory);
    inspectModules(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        if (consumedWorkspacePackage || !ignored.has(entry.name)) {
          visit(path.join(directory, entry.name), consumedWorkspacePackage);
        }
      } else if (entry.isSymbolicLink()) {
        throw new Error(`源码软链必须移除或物化后重试：${path.join(directory, entry.name)}`);
      } else if (entry.name === 'package.json') {
        JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
        contexts.add(directory); // package self-reference also changes resolution
      }
    }
  };
  inspectModules(realRoot);
  for (const scope of ['packages', 'apps', 'tests', 'scripts']) {
    const directory = path.join(realRoot, scope);
    try { fs.lstatSync(directory); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`源码目录软链：${directory}`);
    visit(directory);
  }
  return { contexts, invalid, inspectPackage: (packageRoot) => visit(packageRoot, true) };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** 按调用方的 self-reference / node_modules 顺序找包，入口内的嵌套清单不拥有该绑定。 */
function resolvedManifest(root, name, context, entry) {
  let directory = context;
  while (inside(root, directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (value.name === name && value.exports != null) return { manifest: value, packageRoot: directory };
      break; // 最近 package scope 不匹配时，不能使用更远的同名祖先做 self-reference
    }
    if (directory === root) break;
    directory = path.dirname(directory);
  }

  const resolve = createRequire(path.join(context, '__resolution_preflight__.cjs')).resolve;
  for (const search of resolve.paths(name) ?? []) {
    const packageRoot = path.join(search, name);
    const candidate = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(candidate)) continue;
    const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    // 有 exports 的候选会绑定或抛错；无 exports 的空目录可能被 Node 跳过。
    const realPackageRoot = fs.realpathSync(packageRoot);
    if (value.exports != null || inside(realPackageRoot, entry)) return { manifest: value, packageRoot: realPackageRoot };
  }
  throw new Error(`${name} 无法定位实际解析的 package.json`);
}

/** 只接受已明确支持的精确无条件导出；同样约束根内复制的 shadow 包。 */
function packageSpecifiers(root, name, entry, context = root, inspectPackage = () => {}) {
  const { manifest, packageRoot } = resolvedManifest(root, name, context, entry);
  const exports = manifest?.exports;
  if (manifest.name !== name || !exports || Array.isArray(exports) || typeof exports !== 'object' || typeof exports['.'] !== 'string') {
    throw new Error(`${name} 的 exports 必须是无条件精确入口映射`);
  }
  const specifiers = [];
  for (const [key, target] of Object.entries(exports)) {
    if ((key !== '.' && !key.startsWith('./')) || key.includes('*') || typeof target !== 'string' || target.includes('*')) {
      throw new Error(`${name} 的 exports 不支持条件、数组或通配入口：${key}`);
    }
    if (key !== '.') specifiers.push(name + key.slice(1));
  }
  inspectPackage(packageRoot); // 只展开实际消费的 workspace 包，仍不递归第三方依赖树
  return specifiers;
}

/** 从根绑定的 canonical manifest 收集声明的子路径，不扫描第三方依赖树。 */
function declaredSpecifiers(root, names) {
  const specifiers = [...names];
  const resolve = createRequire(path.join(root, 'package.json')).resolve;
  for (const name of names) {
    let entry;
    try { entry = fs.realpathSync(resolve(name)); } catch { continue; } // 缺包由逐上下文解析报告
    if (inside(root, entry)) specifiers.push(...packageSpecifiers(root, name, entry));
  }
  return specifiers;
}

/** 越界/缺包一次列全；坏 manifest、边界不可读等结构错误抛错，不能空转通过。 */
export function findStrayResolutions(root) {
  const realRoot = fs.realpathSync(root);
  const manifestPath = path.join(realRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const names = Object.keys(manifest.devDependencies ?? {}).filter((name) => name.startsWith(SCOPE));
  if (names.length === 0) throw new Error(`根 package.json 的 devDependencies 里没有任何 ${SCOPE}*，无法判定解析落点`);
  const { contexts, invalid, inspectPackage } = resolutionContexts(realRoot);
  const specifiers = declaredSpecifiers(realRoot, names);
  const stray = [];
  const seen = new Set();
  for (const context of contexts) {
    const resolve = createRequire(path.join(context, '__resolution_preflight__.cjs')).resolve;
    for (const name of specifiers) {
      let problem;
      let resolved;
      try {
        resolved = fs.realpathSync(resolve(name));
        if (!inside(realRoot, resolved)) problem = { name, resolved, reason: 'outside-root' };
      } catch (error) {
        problem = { name, resolved: null, reason: error.code ?? 'UNRESOLVED' };
      }
      if (!problem && names.includes(name)) packageSpecifiers(realRoot, name, resolved, context, inspectPackage);
      if (problem) {
        const key = JSON.stringify(problem);
        if (!seen.has(key)) {
          seen.add(key);
          stray.push(context === realRoot ? problem : { ...problem, context });
        }
      }
    }
  }
  if (invalid.length > 0 && stray.length === 0) throw new Error(`node_modules 边界不在检出内或不是目录：${invalid.join(', ')}`);
  return stray;
}

// 成功只在同一进程缓存；不同 worker 及下一次命令必须重新检查安装状态。
const checked = new Set();
export function assertLocalResolutions(root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const realRoot = fs.realpathSync(root);
  if (checked.has(realRoot)) return;
  try {
    const stray = findStrayResolutions(realRoot);
    if (stray.length > 0) throw new Error([
      `${stray.length} 个 ${SCOPE}* 包没有解析到检出 ${realRoot} 之内，这次运行的红/绿都不是本检出的证据：`,
      ...stray.map(({ name, resolved, reason, context }) => `  ${name} -> ${resolved ?? reason}${context ? ` (from ${context})` : ''}`),
    ].join('\n'));
  } catch (error) {
    throw new Error(`resolution-check: ${error.message}\n在检出根目录执行：${FIX_COMMAND}`);
  }
  checked.add(realRoot);
}

function main() {
  try { assertLocalResolutions(); } catch (error) {
    // CLI 收口成一行/多行诊断，不打栈；preflight 让抛错中止后续模块求值。
    console.error(error.message.replace('\n在检出根目录执行：', ' 在检出根目录执行：'));
    process.exitCode = 1;
  }
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
