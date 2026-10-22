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

import '../fixtures/resolution-preflight.mjs';

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
      type: 'module',
      private: true,
      devDependencies: Object.fromEntries(names.map((name) => [`@harness-projects/${name}`, 'workspace:*'])),
    }),
  );
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ndist/\n');
  for (const name of names) {
    fs.mkdirSync(path.join(root, 'packages', name), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages', name, 'package.json'),
      JSON.stringify({ name: `@harness-projects/${name}`, type: 'module', exports: { '.': './index.js' } }),
    );
    fs.writeFileSync(path.join(root, 'packages', name, 'index.js'), 'export {};\n');
    if (installed) linkPackage(root, `../../packages/${name}`, name);
  }
}

/** 把守卫脚本拷进夹具根的 `scripts/`，让 CLI 的根取自夹具而不是真实检出。 */
function installScript(root) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const script = path.join(root, 'scripts', 'resolution-check.mjs');
  fs.copyFileSync(SCRIPT, script);
  fs.mkdirSync(path.join(root, 'tests/fixtures'), { recursive: true });
  for (const name of ['source-tree.mjs', 'resolution-preflight.mjs']) {
    const source = path.join(REPO_ROOT, 'tests/fixtures', name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(root, 'tests/fixtures', name));
  }
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
    for (const [key, target] of Object.entries(manifest.exports)) {
      assert.ok(key === '.' || key.startsWith('./'), name);
      assert.equal(typeof target, 'string', `${name}/${key} 必须无条件`);
      assert.ok(!key.includes('*') && !target.includes('*'), `${name}/${key} 必须精确`);
    }
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

// These cases catch root-only checks, late/absent preflight, and omitted importer boundaries.
function managedFixture(t, installed = false) {
  const outer = path.join(scratch(t), 'outer');
  const inner = path.join(outer, '.worktrees', 'inner');
  writeRoot(outer, { installed: true, names: ['foo', 'bar'] });
  writeRoot(inner, { installed, names: ['foo', 'bar'] });
  installScript(inner);
  fs.copyFileSync(path.join(REPO_ROOT, 'scripts/run-test-layer.mjs'), path.join(inner, 'scripts/run-test-layer.mjs'));
  for (const [root, marker] of [[outer, 'outer-marker'], [inner, 'inner-marker']]) {
    fs.writeFileSync(path.join(root, 'packages/foo/index.js'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(outer, marker))}, 'executed'); export {};`);
  }
  const first = fs.readFileSync(path.join(REPO_ROOT, 'tests/contract/domain-enums.test.js'), 'utf8').match(/^import[^\n]+/m)?.[0];
  const guard = first?.includes('resolution-preflight.mjs') ? "import '../fixtures/resolution-preflight.mjs';\n" : '';
  for (const layer of ['integration', 'e2e', 'mvp0']) {
    fs.mkdirSync(path.join(inner, 'tests', layer), { recursive: true });
    fs.writeFileSync(path.join(inner, 'tests', layer, 'probe.test.js'),
      `${guard}import '${PKG}';\nimport test from 'node:test';\ntest('fixture marker', () => {});\n`);
  }
  return { outer, inner };
}

const NATIVE_ENTRIES = [
  ['file script', ['tests/integration/probe.test.js']],
  ['file --test', ['--test', 'tests/integration/probe.test.js']],
  ...['integration', 'e2e', 'mvp0'].map((layer) => [layer, ['--test', `tests/${layer}`]]),
  ['layer runner', ['scripts/run-test-layer.mjs', 'tests/integration', 'workspace-local test evidence']],
];
function nativeRun(root, args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
}
for (const [label, args] of NATIVE_ENTRIES) {
  test(`原生入口 ${label}：未安装内层必须先于外层模块 body 失败`, (t) => {
    const { outer, inner } = managedFixture(t);
    const result = nativeRun(inner, args);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /pnpm install --frozen-lockfile/);
    assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false, 'external body must never execute');
  });
}
test('合法控制：所有原生入口执行内层 marker，外层 marker 不执行', (t) => {
  const { outer, inner } = managedFixture(t, true);
  for (const [, args] of NATIVE_ENTRIES) {
    const result = nativeRun(inner, args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(outer, 'inner-marker')), true);
    assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false);
    fs.unlinkSync(path.join(outer, 'inner-marker'));
  }
});
for (const boundary of ['packages/foo/src/deep/nested', 'tests/integration/deep/nested']) {
  test(`深层 shadow：root 正常而 ${boundary} 外指时入口必须先行失败`, (t) => {
    const { outer, inner } = managedFixture(t, true);
    const context = path.join(inner, boundary);
    fs.mkdirSync(context, { recursive: true });
    linkPackage(context, path.join(outer, 'packages/bar'), 'bar');
    fs.writeFileSync(path.join(outer, 'packages/bar/index.js'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(outer, 'outer-marker'))}, 'external');`);
    fs.writeFileSync(path.join(context, 'entry.js'), `import '${PKG_BAR}';`);
    const importer = boundary.startsWith('packages') ? path.join(inner, 'packages/foo/index.js') :
      path.join(inner, 'tests/integration/probe.test.js');
    fs.appendFileSync(importer, `\nimport './${boundary.startsWith('packages') ? 'src/' : ''}deep/nested/entry.js';`);
    const result = nativeRun(inner, NATIVE_ENTRIES[0][1]);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /pnpm install --frozen-lockfile/);
    assert.equal(fs.existsSync(path.join(outer, 'inner-marker')), false, 'preflight must stop even a local body');
    assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false);
  });
}
test('自引用 package scope：没有 node_modules 的包级导出外指也被发现', (t) => {
  const { outer, inner } = managedFixture(t, true);
  const decoy = path.join(inner, 'packages/decoy');
  fs.mkdirSync(decoy);
  fs.writeFileSync(path.join(decoy, 'package.json'), JSON.stringify({ name: PKG, exports: './missing.js' }));
  assert.ok(findStrayResolutions(inner).some((s) => s.context === decoy && s.reason === 'MODULE_NOT_FOUND'));
});
test('失败闭合：坏 manifest、悬空/外指 node_modules 与源码目录软链不能静默略过', (t) => {
  for (const kind of ['manifest', 'dangling', 'outside', 'source-link', 'unreadable']) {
    const { outer, inner } = managedFixture(t, true);
    const scope = path.join(inner, 'packages/foo/src/deep');
    fs.mkdirSync(scope, { recursive: true });
    if (kind === 'manifest') fs.writeFileSync(path.join(scope, 'package.json'), '{');
    else if (kind === 'unreadable') {
      fs.chmodSync(scope, 0);
    } else fs.symlinkSync(kind === 'dangling' ? './missing' : outer,
      path.join(scope, kind === 'source-link' ? 'linked-source' : 'node_modules'));
    try { assert.throws(() => findStrayResolutions(inner), undefined, kind); }
    finally { if (kind === 'unreadable') fs.chmodSync(scope, 0o755); }
  }
});
test('合法边界：根内 node_modules 软链可解析；未消费包构建输出按共享来源剪枝', (t) => {
  const { inner } = managedFixture(t, true);
  const scope = path.join(inner, 'tests/deep');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(path.join(inner, 'node_modules'), path.join(scope, 'node_modules'));
  fs.mkdirSync(path.join(inner, 'packages/unconsumed/dist'), { recursive: true });
  fs.writeFileSync(path.join(inner, 'packages/unconsumed/dist/package.json'), '{');
  assert.deepEqual(findStrayResolutions(inner), []);
});
test('NODE_PATH：全局搜索路径也不能为未安装内层提供外部证据', (t) => {
  const { outer, inner } = managedFixture(t);
  const result = runCli(path.join(inner, 'scripts/resolution-check.mjs'), inner,
    { NODE_PATH: path.join(outer, 'node_modules') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside|outer/);
  assert.match(result.stderr, /pnpm install --frozen-lockfile/);
});
test('接线：动态发现的每个受管测试首条 import 必须相对导入 preflight', () => {
  const files = fs.readdirSync(path.join(REPO_ROOT, 'tests'), { recursive: true })
    .filter((file) => file.endsWith('.test.js') && !file.split(path.sep).includes('node_modules'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'tests', file), 'utf8');
    const first = source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').match(/^\s*import\s+([^;\n]+)/m)?.[1];
    assert.match(first ?? '', /^['"]\.\.?\/.*resolution-preflight\.mjs['"]$/, file);
    const specifier = first.slice(1, -1);
    assert.equal(fs.realpathSync(path.resolve(REPO_ROOT, 'tests', path.dirname(file), specifier)),
      fs.realpathSync(path.join(REPO_ROOT, 'tests/fixtures/resolution-preflight.mjs')), file);
  }
});

test('子路径导出：根入口本地但 values 文件软链外指时先于模块 body 失败', (t) => {
  const { outer, inner } = managedFixture(t, true);
  const pkg = path.join(inner, 'packages/foo');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
    name: PKG, type: 'module', exports: { '.': './index.js', './values': './values.js' },
  }));
  fs.symlinkSync(path.join(outer, 'packages/foo/index.js'), path.join(pkg, 'values.js'));
  const result = nativeRun(inner, NATIVE_ENTRIES[0][1]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /软链/);
  assert.equal(fs.existsSync(path.join(outer, 'inner-marker')), false);
  assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false);
});

test('runner 自身先于未接线子进程失败，不能依赖子测试守卫', (t) => {
  const { outer, inner } = managedFixture(t);
  fs.writeFileSync(path.join(inner, 'tests/integration/probe.test.js'),
    `import '${PKG}'; import test from 'node:test'; test('unguarded child', () => {});`);
  const result = nativeRun(inner, NATIVE_ENTRIES.at(-1)[1]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /pnpm install --frozen-lockfile/);
  assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false);
});
test('runner 作为库导入时不触发整仓守卫', (t) => {
  const { inner } = managedFixture(t);
  const result = nativeRun(inner, ['--input-type=module', '-e', "import './scripts/run-test-layer.mjs';"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('不可读 node_modules 边界不能沿父目录回退后假绿', (t) => {
  const { inner } = managedFixture(t, true);
  const modules = path.join(inner, 'tests/deep/node_modules');
  fs.mkdirSync(modules, { recursive: true });
  fs.chmodSync(modules, 0);
  try { assert.throws(() => findStrayResolutions(inner)); }
  finally { fs.chmodSync(modules, 0o755); }
});

for (const { title, conditional, diagnostic } of [
  { title: '已声明子路径：根内复制 shadow 的 root 本地而 values 软链外指也拒绝', conditional: false, diagnostic: /foo\/values/ },
  { title: 'shadow 导出条件：require 本地、import 外指不能绕过根导出前提', conditional: true, diagnostic: /exports/ },
]) {
  test(title, (t) => {
    const { outer, inner } = managedFixture(t, true);
    const manifest = { name: PKG, type: 'module', exports: { '.': './index.js', './values': './values.js' } };
    const local = path.join(inner, 'packages/foo');
    fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(local, 'values.js'), 'export {};');
    const context = path.join(inner, 'tests/integration/deep/nested');
    const shadow = path.join(context, 'node_modules', PKG);
    fs.mkdirSync(shadow, { recursive: true });
    fs.writeFileSync(path.join(shadow, 'package.json'), JSON.stringify({ ...manifest, exports: {
      '.': './index.js', './values': conditional ? { import: './values.js', require: './local.js' } : './values.js',
    } }));
    fs.writeFileSync(path.join(shadow, 'local.js'), 'export {};');
    fs.writeFileSync(path.join(shadow, 'index.js'), 'export {};');
    fs.symlinkSync(path.join(outer, 'packages/foo/index.js'), path.join(shadow, 'values.js'));
    fs.writeFileSync(path.join(context, 'entry.js'), `import '${PKG}/values';`);
    fs.appendFileSync(path.join(inner, 'tests/integration/probe.test.js'), "\nimport './deep/nested/entry.js';");
    const result = nativeRun(inner, NATIVE_ENTRIES[0][1]);
    assert.notEqual(result.status, 0, result.stdout + result.stderr + '\nouter-marker=' + fs.existsSync(path.join(outer, 'outer-marker')));
    assert.match(result.stdout + result.stderr, diagnostic);
    assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false);
  });
}

test('导出前提失败闭合：当前 workspace 的条件、数组与通配子路径必须显式拒绝', (t) => {
  for (const exports of [
    { '.': './index.js', './values': { import: './values.js', require: './index.js' } },
    { '.': './index.js', './values': ['./index.js'] },
    { '.': './index.js', './*': './*.js' },
  ]) {
    const { inner } = managedFixture(t, true);
    fs.writeFileSync(path.join(inner, 'packages/foo/package.json'), JSON.stringify({ name: PKG, type: 'module', exports }));
    assert.throws(() => findStrayResolutions(inner), /exports/);
  }
});

for (const [label, conditional, shared] of [
  ['嵌套同名清单', true, false],
  ['共享 require 入口', true, true],
  ['合法嵌套清单', false, false],
]) {
  test(`实际包清单：${label} 不能替代 shadow 清单验证`, (t) => {
    const { outer, inner } = managedFixture(t, true);
    const context = path.join(inner, 'tests/integration/deep');
    const shadow = path.join(context, 'node_modules', PKG);
    fs.mkdirSync(path.join(shadow, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(shadow, 'package.json'), JSON.stringify({
      name: PKG, type: 'module', exports: { '.': conditional ?
        { require: shared ? './local.js' : './nested/index.js', import: './external.js' } : './nested/index.js' },
    }));
    fs.writeFileSync(path.join(shadow, 'nested/package.json'), JSON.stringify({
      name: PKG, type: 'module', exports: { '.': './index.js' },
    }));
    const marker = path.join(outer, 'shadow-marker');
    fs.writeFileSync(path.join(shadow, 'nested/index.js'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'local'); export {};`);
    if (shared) fs.symlinkSync(path.join(inner, 'packages/foo/index.js'), path.join(shadow, 'local.js'));
    if (conditional) fs.symlinkSync(path.join(outer, 'packages/foo/index.js'), path.join(shadow, 'external.js'));
    fs.writeFileSync(path.join(context, 'entry.js'), `import '${PKG}';`);
    fs.appendFileSync(path.join(inner, 'tests/integration/probe.test.js'), "\nimport './deep/entry.js';");
    for (const [, args] of NATIVE_ENTRIES.slice(0, 2)) {
      const result = nativeRun(inner, args);
      const output = result.stdout + result.stderr;
      assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false, output);
      if (conditional) {
        assert.notEqual(result.status, 0, output);
        assert.match(output, /exports/);
        assert.equal(fs.existsSync(path.join(outer, 'inner-marker')), false);
      } else {
        assert.equal(result.status, 0, output);
        assert.equal(fs.existsSync(marker), true);
        fs.unlinkSync(marker);
      }
    }
  });
}

test('实际 shadow 源码：复制 workspace 包内的深层解析边界也必须检查', (t) => {
  for (const outside of [true, false]) {
    const { outer, inner } = managedFixture(t, true);
    const context = path.join(inner, 'tests/integration/deep');
    const shadow = path.join(context, 'node_modules', PKG);
    const source = path.join(shadow, 'src/deep/nested');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(shadow, 'package.json'), JSON.stringify({
      name: PKG, type: 'module', exports: { '.': './src/index.js' },
    }));
    fs.writeFileSync(path.join(shadow, 'src/index.js'), "import './deep/nested/entry.js'; export {};");
    fs.writeFileSync(path.join(source, 'entry.js'), `import '${PKG_BAR}';`);
    linkPackage(source, path.join(outside ? outer : inner, 'packages/bar'), 'bar');
    fs.writeFileSync(path.join(outer, 'packages/bar/index.js'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(outer, 'outer-marker'))}, 'external');`);
    fs.writeFileSync(path.join(context, 'entry.js'), `import '${PKG}';`);
    fs.appendFileSync(path.join(inner, 'tests/integration/probe.test.js'), "\nimport './deep/entry.js';");
    for (const [, args] of NATIVE_ENTRIES.slice(0, 2)) {
      const result = nativeRun(inner, args);
      const output = result.stdout + result.stderr;
      assert.equal(fs.existsSync(path.join(outer, 'outer-marker')), false, output);
      if (outside) {
        assert.notEqual(result.status, 0, output);
        assert.match(output, /pnpm install --frozen-lockfile/);
        assert.equal(fs.existsSync(path.join(outer, 'inner-marker')), false);
      } else {
        assert.equal(result.status, 0, output);
        assert.equal(fs.existsSync(path.join(outer, 'inner-marker')), true);
      }
    }
  }
});

for (const { label, ignoredDirectory, exports, specifiers, files } of [
  {
    label: '根入口',
    ignoredDirectory: 'dist',
    exports: { '.': './dist/index.js' },
    specifiers: [PKG],
    files: { 'dist/index.js': `import '${PKG_BAR}'; export {};` },
  },
  {
    label: '精确子路径',
    ignoredDirectory: 'build',
    exports: { '.': './index.js', './values': './build/values.js' },
    specifiers: [PKG, `${PKG}/values`],
    files: { 'index.js': 'export {};', 'build/values.js': `import '${PKG_BAR}'; export {};` },
  },
  {
    label: '源码传递导入构建目录',
    ignoredDirectory: 'dist',
    exports: { '.': './src/index.js' },
    specifiers: [PKG],
    files: { 'src/index.js': "import '../dist/index.js'; export {};", 'dist/index.js': `import '${PKG_BAR}'; export {};` },
  },
]) {
  test(`已消费 shadow 的${label}解析检查被忽略目录，外指失败且本地对照通过`, (t) => {
    const { outer, inner } = managedFixture(t, true);
    if (ignoredDirectory === 'build') fs.appendFileSync(path.join(inner, '.gitignore'), 'build/\n');
    const shadow = path.join(inner, 'tests/node_modules', PKG);
    fs.mkdirSync(shadow, { recursive: true });
    fs.writeFileSync(path.join(shadow, 'package.json'), JSON.stringify({
      name: PKG, type: 'module', exports,
    }));
    for (const [relative, contents] of Object.entries(files)) {
      const entry = path.join(shadow, relative);
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, contents);
    }

    const outerMarker = path.join(outer, 'outer-bar-marker');
    const innerMarker = path.join(inner, 'inner-bar-marker');
    fs.writeFileSync(path.join(outer, 'packages/bar/index.js'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(outerMarker)}, 'executed'); export {};`);
    fs.writeFileSync(path.join(inner, 'packages/bar/index.js'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(innerMarker)}, 'executed'); export {};`);
    const barLink = path.join(shadow, ignoredDirectory, 'node_modules/@harness-projects/bar');
    fs.mkdirSync(path.dirname(barLink), { recursive: true });
    fs.symlinkSync(path.join(outer, 'packages/bar'), barLink);
    const probe = path.join(inner, 'tests/integration/probe.test.js');
    const imports = specifiers.map((specifier) => `import '${specifier}';`).join('\n');
    fs.writeFileSync(probe,
      `import '../fixtures/resolution-preflight.mjs';\n${imports}\nimport test from 'node:test';\ntest('shadow output resolution', () => {});\n`);

    assert.equal(JSON.parse(fs.readFileSync(path.join(inner, 'packages/foo/package.json'), 'utf8')).exports['.'], './index.js');
    const outside = nativeRun(inner, ['--test', 'tests/integration/probe.test.js']);
    const outsideOutput = outside.stdout + outside.stderr;
    assert.notEqual(outside.status, 0,
      `preflight accepted the outer package from ${ignoredDirectory}; marker=${fs.existsSync(outerMarker)}\n${outsideOutput}`);
    assert.match(outsideOutput, /resolution-check:/);
    assert.match(outsideOutput, /@harness-projects\/bar/);
    assert.equal(fs.existsSync(outerMarker), false);
    assert.equal(fs.existsSync(innerMarker), false);

    fs.unlinkSync(barLink);
    fs.symlinkSync(path.join(inner, 'packages/bar'), barLink);
    const local = nativeRun(inner, ['--test', 'tests/integration/probe.test.js']);
    assert.equal(local.status, 0, local.stdout + local.stderr);
    assert.equal(fs.existsSync(innerMarker), true);
    assert.equal(fs.existsSync(outerMarker), false);
  });
}
