// 裸包名解析守卫 `scripts/resolution-check.mjs` 的可执行表述（ExecPlan
// `2026-10-21-worktree-resolution-guard`，issue #186）。
//
// 它保护的不变量是 AGENTS.md §6 隔离工作区的证据前提：测试里的 `@harness-projects/*`
// 必须解析到**本检出**的 `packages/`。嵌在主检出 `.worktrees/` 下又没装依赖的检出，裸包名会沿
// 父目录向上落到主检出，测试对着别人的代码给出假绿或无效红。判据只有一条：解析结果取 realpath
// 后必须落在检出根的 realpath 之内，与逃逸机制（祖先 node_modules、NODE_PATH、软链）无关。
//
// 夹具用仓库里不存在的包名 `@harness-projects/foo`（钉「一次列全」的用例再加 `bar`），所以不受
// 真实工作区包增减影响；每条用例新建一个 mkdtemp 根，避免 `require.resolve` 的进程内缓存把前一条的
// 结果带进来。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findStrayResolutions } from '../../scripts/resolution-check.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/resolution-check.mjs', import.meta.url));
const PKG = '@harness-projects/foo';
const PKG_BAR = '@harness-projects/bar';
const FIX_COMMAND = 'pnpm install --frozen-lockfile';

/** 新的临时目录（取 realpath，macOS 的 tmpdir 本身就是软链），用例结束自动删除。 */
function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolution-check-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** pnpm 式安装：`node_modules/@harness-projects/<name>` 是指向某个包目录的软链。 */
function linkPackage(root, target, name = 'foo') {
  const scope = path.join(root, 'node_modules', '@harness-projects');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(target, path.join(scope, name));
}

/**
 * 最小工作区根：根 manifest 声明 `names` 里的每个包，`packages/<name>` 有入口；`installed` 时每个包软链到自己的
 * `packages/<name>`。默认只有 foo；要钉「一次列全」的用例传两个包，单包夹具分辨不出「只报第一个」。
 */
function writeRoot(root, { installed, names = ['foo'] }) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      devDependencies: Object.fromEntries(names.map((name) => [`@harness-projects/${name}`, 'workspace:*'])),
    }),
  );
  for (const name of names) {
    fs.mkdirSync(path.join(root, 'packages', name), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', name, 'package.json'),
      JSON.stringify({ name: `@harness-projects/${name}`, exports: { '.': './index.js' } }),
    );
    fs.writeFileSync(path.join(root, 'packages', name, 'index.js'), 'export {};\n');
    if (installed) linkPackage(root, `../../packages/${name}`, name);
  }
}

/** 把守卫脚本拷进夹具根的 `scripts/`，让 CLI 的根取自夹具而不是真实检出。 */
function installScript(root) {
  fs.mkdirSync(path.join(root, 'scripts'));
  const script = path.join(root, 'scripts', 'resolution-check.mjs');
  fs.copyFileSync(SCRIPT, script);
  return script;
}

function runCli(script, cwd, env = {}) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

function describeStray(stray) {
  return stray.map((s) => `${s.name} -> ${s.resolved ?? s.reason}`).join('\n');
}

test('解析：本检出的 @harness-projects/* 全部解析在本检出之内（AGENTS.md §6 隔离工作区的证据前提）', () => {
  const stray = findStrayResolutions(REPO_ROOT);
  assert.deepEqual(
    stray,
    [],
    `以下包没有解析到本检出之内，这次运行的红/绿都不是本检出的证据；先在检出根目录执行 ${FIX_COMMAND}：\n${describeStray(stray)}`,
  );
});

test('入口前提：根守卫检查的工作区包提供无条件根导出，改变导出条件须同步调整守卫', () => {
  const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const names = Object.keys(root.devDependencies).filter((name) => name.startsWith('@harness-projects/'));
  assert.ok(names.length > 0);
  for (const name of names) {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(typeof manifest.exports?.['.'], 'string', `${name} 的根导出条件已改变；先调整 resolution-check 的定位方式，重新安装不能修复导出条件差异`);
  }
});

test('越界：嵌在已安装检出下、自身未安装时，裸包名落到外层并被报出', (t) => {
  const outer = path.join(scratch(t), 'outer');
  const inner = path.join(outer, '.worktrees', 'bare');
  const names = ['foo', 'bar'];
  writeRoot(outer, { installed: true, names });
  writeRoot(inner, { installed: false, names });

  // 两个包都越界：一次列全，顺序同根 manifest 的声明顺序，不止报第一个。
  assert.deepEqual(findStrayResolutions(inner), [
    { name: PKG, resolved: path.join(outer, 'packages', 'foo', 'index.js'), reason: 'outside-root' },
    { name: PKG_BAR, resolved: path.join(outer, 'packages', 'bar', 'index.js'), reason: 'outside-root' },
  ]);
});

test('不误报：已安装的检出无越界，经符号链接别名传入根目录也一样', (t) => {
  const base = scratch(t);
  const root = path.join(base, 'real');
  const alias = path.join(base, 'alias');
  writeRoot(root, { installed: true });
  fs.symlinkSync(root, alias);

  assert.deepEqual(findStrayResolutions(root), []);
  assert.deepEqual(findStrayResolutions(alias), []);
});

test('越界：落点在同名前缀的兄弟目录（repo 与 repo-old）也算根外', (t) => {
  const base = scratch(t);
  const repo = path.join(base, 'repo');
  const sibling = path.join(base, 'repo-old');
  writeRoot(sibling, { installed: true });
  writeRoot(repo, { installed: false });
  linkPackage(repo, '../../../repo-old/packages/foo');

  assert.deepEqual(findStrayResolutions(repo), [
    { name: PKG, resolved: path.join(sibling, 'packages', 'foo', 'index.js'), reason: 'outside-root' },
  ]);
});

test('失败闭合：哪里都解析不到时记下错误码，不抛、不当作通过', (t) => {
  const root = path.join(scratch(t), 'solo');
  writeRoot(root, { installed: false });

  assert.deepEqual(findStrayResolutions(root), [{ name: PKG, resolved: null, reason: 'MODULE_NOT_FOUND' }]);
});

test('CLI：只有解析失败而没有越界时仍退出 1，列出错误码与安装指引', (t) => {
  const root = path.join(scratch(t), 'solo');
  writeRoot(root, { installed: false });
  const bad = runCli(installScript(root), root);
  assert.equal(bad.status, 1, `期望退出 1，实际 ${bad.status}\n${bad.stderr}`);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /^resolution-check: /);
  assert.ok(bad.stderr.includes(`${PKG} -> MODULE_NOT_FOUND`), bad.stderr);
  assert.ok(bad.stderr.includes(FIX_COMMAND), bad.stderr);
});

test('失败闭合：根 manifest 没有任何 @harness-projects/* 时抛错，不空转通过', (t) => {
  const root = path.join(scratch(t), 'empty');
  fs.mkdirSync(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, devDependencies: { yaml: '^2.9.1' } }),
  );

  assert.throws(() => findStrayResolutions(root), /@harness-projects\//);
});

test('CLI：根取自脚本位置而非 cwd；越界时退出 1 并给出落点与修复命令，即使 --preserve-symlinks', (t) => {
  const outer = path.join(scratch(t), 'outer');
  const wt = path.join(outer, '.worktrees', 'wt');
  const names = ['foo', 'bar'];
  writeRoot(outer, { installed: true, names });
  writeRoot(wt, { installed: false, names });
  const script = installScript(wt);
  // wt 自己没有安装，node_modules 软链到外层：默认标志下解析结果是外层的 realpath；
  // NODE_PRESERVE_SYMLINKS=1 下解析结果停在 wt/node_modules 的词法路径，只有对结果再取 realpath 才看得出越界。
  fs.symlinkSync('../../node_modules', path.join(wt, 'node_modules'));

  // cwd 取已安装的外层：根若取自 cwd，守卫会误判通过。
  const run = () => runCli(script, outer, { NODE_PRESERVE_SYMLINKS: '1' });

  const bad = run();
  assert.equal(bad.status, 1, `期望退出 1，实际 ${bad.status}\n${bad.stderr}`);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /^resolution-check: /);
  // 逐包列出：每个越界的包各占一行，不止第一个。
  for (const name of names) {
    const line = `@harness-projects/${name} -> ${path.join(outer, 'packages', name, 'index.js')}`;
    assert.ok(bad.stderr.includes(line), `stderr 应列出 ${line}：\n${bad.stderr}`);
  }
  assert.ok(bad.stderr.includes(FIX_COMMAND), `stderr 应给出修复命令：\n${bad.stderr}`);

  // 部分安装（装完之后根 manifest 又加了包）：只有 bar 越界，单个越界也必须退出 1，且只列它。
  fs.rmSync(path.join(wt, 'node_modules'));
  linkPackage(wt, '../../packages/foo', 'foo');
  const partial = run();
  assert.equal(partial.status, 1, `期望退出 1，实际 ${partial.status}\n${partial.stderr}`);
  const barLine = `${PKG_BAR} -> ${path.join(outer, 'packages', 'bar', 'index.js')}`;
  assert.ok(partial.stderr.includes(barLine), `stderr 应列出 ${barLine}：\n${partial.stderr}`);
  assert.ok(!partial.stderr.includes(`${PKG} ->`), `foo 已装在本检出，不应列出：\n${partial.stderr}`);

  // 补齐安装：同一命令、同一 cwd、同一环境，静默通过。
  linkPackage(wt, '../../packages/bar', 'bar');
  const good = run();
  assert.equal(good.status, 0, `期望退出 0，实际 ${good.status}\n${good.stderr}`);
  assert.equal(good.stderr, '');
  assert.equal(good.stdout, '');
});

test('接线：每个跑 node --test 的 pnpm 脚本都先跑守卫，且有单文件入口 test:file', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const guard = 'node scripts/resolution-check.mjs && ';

  // 这些入口必须存在；其余任何含 `node --test` 的脚本也一并要求前置守卫，新增入口不会漏。
  const required = ['test', 'test:contract', 'test:mvp0', 'boundaries', 'test:file'];
  for (const name of required) assert.ok(scripts[name], `package.json 缺少脚本 ${name}`);

  const runners = Object.entries(scripts).filter(([, command]) => command.includes('node --test'));
  assert.ok(runners.length >= required.length, `含 node --test 的脚本只有 ${runners.length} 个`);
  for (const [name, command] of runners) {
    assert.ok(command.startsWith(guard), `脚本 ${name} 没有以「${guard}」开头：${command}`);
  }
});

test('CLI 失败闭合：根 manifest 没有 @harness-projects/* 或读不到时退出 1，stderr 只有带前缀的一行、不打栈', (t) => {
  const wt = path.join(scratch(t), 'wt');
  fs.mkdirSync(wt);
  const manifest = path.join(wt, 'package.json');
  fs.writeFileSync(manifest, JSON.stringify({ name: 'fixture', private: true, devDependencies: { yaml: '^2.9.1' } }));
  const script = installScript(wt);

  // 没有名单：函数抛错，CLI 必须收口成退出 1，而不是静默通过（根 manifest 被改坏时测试会向上解析到主检出）。
  const empty = runCli(script, wt);
  assert.equal(empty.status, 1, `期望退出 1，实际 ${empty.status}\n${empty.stderr}`);
  assert.equal(empty.stdout, '');
  assert.match(empty.stderr, /^resolution-check: .*@harness-projects\//);
  assert.equal(empty.stderr.trim().split('\n').length, 1, `期望 stderr 只有一行：\n${empty.stderr}`);

  // manifest 读不到：同样收口成一行，错误码来自文件系统。
  fs.rmSync(manifest);
  const missing = runCli(script, wt);
  assert.equal(missing.status, 1, `期望退出 1，实际 ${missing.status}\n${missing.stderr}`);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /^resolution-check: .*package\.json/);
  assert.equal(missing.stderr.trim().split('\n').length, 1, `期望 stderr 只有一行：\n${missing.stderr}`);
});
