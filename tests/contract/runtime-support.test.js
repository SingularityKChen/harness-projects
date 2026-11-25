/**
 * Node 运行时支持契约（ExecPlan 2026-11-24-node-runtime-contract）：① source 声明行 engines/.nvmrc/CI 同源；
 * ② 每包 exports 全部子路径在声明行裸包名可加载；③ 非可擦除语法在 typecheck 期被 erasableSyntaxOnly
 * 拒绝（负控夹具只被 TS1294 拒绝）；④ docs/development/runtime-support.md 的模式表逐值等于代码事实。
 * compiled Host 的版本与类型天花板仍由 tests/contract/host-node-types.test.js 拥有，本文件只绑定文档关系。
 */

import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';
import { listPackageDirectories } from '../fixtures/source-tree.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUNTIME_DOC = 'docs/development/runtime-support.md';
const NEGATIVE = 'tests/fixtures/node-runtime/negative-erasable';
const WORKFLOW_DIR = '.github/workflows';
const SCOPE = '@harness-projects/';
/** engines.node 的唯一合法形状；契约只固定 major，不承诺逐 patch 验证。 */
const SOURCE_ENGINE = /^>=(\d+)\.0\.0$/;
/** .nvmrc 允许 major 或 major.minor[.patch]。 */
const NVMRC = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
/** exports 目标必须是源码，不是构建产物。 */
const SOURCE_EXPORT = /^\.\/src\/.+\.(?:ts|tsx)$/;

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const workspacePackages = () =>
  listPackageDirectories(ROOT, ['apps', 'packages']).map((directory) => ({
    directory,
    manifest: json(`${directory}/package.json`),
  }));

/** 从 Markdown 取一张表：表头以 header 开头，返回去掉表头与分隔行的数据行。 */
function tableRows(source, header) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(header));
  assert.notEqual(start, -1, `找不到表头为 ${header} 的表格`);
  assert.match(lines[start + 1], /^\|[\s|:-]+\|$/, `${header} 的表头下一行必须是分隔行`);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

/** 逐段比较版本：>=26.0.0 同时允许 26.x 与 27+，等值断言会把合法运行时判红。 */
function atLeast(actual, declared) {
  for (let index = 0; index < Math.max(actual.length, declared.length); index += 1) {
    const left = actual[index] ?? 0;
    const right = declared[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

test('source：根 engines.node 与 .nvmrc 是同一个 major 行', () => {
  const engines = String(json('package.json').engines?.node ?? '');
  const nvmrc = read('.nvmrc').trim();
  const declared = SOURCE_ENGINE.exec(engines);
  assert.ok(declared, `package.json 的 engines.node 必须是 >=<major>.0.0，实际是 ${JSON.stringify(engines)}`);
  const executed = NVMRC.exec(nvmrc);
  assert.ok(executed, `.nvmrc 必须是 major 或 major.minor[.patch]，实际是 ${JSON.stringify(nvmrc)}`);
  assert.equal(
    Number(declared[1]),
    Number(executed[1]),
    `engines.node（${engines}）与 .nvmrc（${nvmrc}）不是同一个 major：声明支持的 source 运行时必须是 CI 实际执行的那一行，改 .nvmrc 的同一 PR 改 engines`,
  );

  const onDisk = workspacePackages().map(({ manifest }) => manifest.name).sort();
  const inDevDependencies = Object.keys(json('package.json').devDependencies ?? {}).filter((name) => name.startsWith(SCOPE)).sort();
  assert.deepEqual(
    onDisk,
    inDevDependencies,
    '磁盘 workspace 包与根 devDependencies 的 @harness-projects/* 集合不一致：裸包名 smoke 会漏测新增包或被未声明包绕过',
  );
});

test('CI：所有 actions/setup-node 步骤只从 .nvmrc 取 Node 版本', () => {
  const files = readdirSync(path.join(ROOT, WORKFLOW_DIR)).filter((name) => /\.ya?ml$/.test(name)).sort();
  assert.ok(files.length >= 1, `${WORKFLOW_DIR} 下没有 workflow 文件`);

  const steps = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    if (typeof node.uses === 'string' && node.uses.startsWith('actions/setup-node@')) steps.push(node);
    Object.values(node).forEach(visit);
  };
  for (const file of files) {
    try {
      visit(parseYaml(read(path.posix.join(WORKFLOW_DIR, file))));
    } catch (error) {
      throw new Error(`${file} 无法解析，Node 版本来源无法判定：${error.message}`);
    }
  }
  assert.ok(steps.length >= 1, '没有 setup-node 步骤：Node 版本来源未被本契约固定，新增 workflow 必须先接 .nvmrc');

  for (const step of steps) {
    const inputs = step.with ?? {};
    assert.equal(
      inputs['node-version-file'],
      '.nvmrc',
      `setup-node 步骤必须用 node-version-file: .nvmrc，实际是 ${JSON.stringify(inputs['node-version-file'])}；内联版本会绕过 engines 与 .nvmrc 的一致性`,
    );
    assert.equal(
      inputs['node-version'],
      undefined,
      `setup-node 步骤不得再写内联 node-version（${JSON.stringify(inputs['node-version'])}）：两处版本来源会漂移`,
    );
  }
});

test('运行时：当前进程满足声明下界并处于原生类型剥离模式', () => {
  const engines = SOURCE_ENGINE.exec(String(json('package.json').engines?.node ?? ''));
  assert.ok(engines, 'engines.node 形状不合法，先由第一条测试报出');
  const current = process.versions.node.split('.').map(Number);
  assert.ok(
    atLeast(current, [Number(engines[1]), 0, 0]),
    `当前进程 Node ${process.versions.node} 低于声明下界 ${engines[0]}：这是声明支持面断言，在更低 Node 上失败是预期；修复方向是用 .nvmrc 的 Node，或另开扩宽支持面的 issue`,
  );
  assert.equal(
    process.features.typescript,
    'strip',
    `当前进程 Node ${process.versions.node} 没有启用原生类型剥离（process.features.typescript=${String(process.features.typescript)}）：source workspace 的测试命令直接跑 .ts`,
  );
});

test('编译期：根 tsconfig 解析后的配置启用 erasableSyntaxOnly', () => {
  let parsed;
  try {
    parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    });
  } catch (error) {
    throw new Error(`tsconfig.json 无法解析：${error.message}`);
  }
  assert.ok(parsed, 'tsconfig.json 没有返回解析结果');
  assert.equal(
    parsed.options.erasableSyntaxOnly,
    true,
    '根 tsconfig 解析后的 erasableSyntaxOnly 不是 true：Node 类型剥离不执行 enum / 带运行时代码的 namespace / 构造器参数属性，这些语法必须在 pnpm typecheck 期被拒绝',
  );
});

test('编译期：负控夹具只被 TS1294 拒绝', () => {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', path.join(ROOT, NEGATIVE, 'tsconfig.json')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, `无法启动 tsc：${String(result.error)}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(
    result.status,
    0,
    `负控夹具编译通过：erasableSyntaxOnly 守卫没有生效，非可擦除语法会漏到运行时\n${output}`,
  );
  const codes = [...new Set([...output.matchAll(/error TS(\d+)/g)].map((match) => match[1]))];
  assert.deepEqual(codes, ['1294'], `负控夹具只应产生 TS1294（可擦除语法），实际是 ${JSON.stringify(codes)}：其他错误码说明配置本身有问题，不能让这条测试假绿\n${output}`);
  const probes = output.match(/probe\.ts\(\d+,\d+\): error TS1294/g) ?? [];
  assert.ok(probes.length >= 3, `期望 probe.ts 至少 3 处 TS1294，实际 ${probes.length} 处\n${output}`);
});

test('运行时：工作区包的全部 exports 子路径在声明行 Node 上裸加载', async () => {
  const packages = workspacePackages();
  assert.ok(packages.length >= 1, '没有发现任何 workspace 包');

  const specifiers = [];
  for (const { directory, manifest } of packages) {
    const exportsMap = manifest.exports ?? {};
    assert.ok(Object.keys(exportsMap).includes('.'), `${directory}/package.json 的 exports 缺少 "." 入口`);
    for (const [key, target] of Object.entries(exportsMap)) {
      assert.equal(
        typeof target,
        'string',
        `${directory}/package.json 的 exports${JSON.stringify(key)} 必须是字符串目标：导出条件对象不在声明的 source 支持面内`,
      );
      assert.match(
        target,
        SOURCE_EXPORT,
        `${directory}/package.json 的 exports${JSON.stringify(key)} 必须指向 ./src/*.ts(x) 源码，实际是 ${JSON.stringify(target)}：声明行直接加载源码，不能依赖构建产物`,
      );
      specifiers.push(key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`);
    }
  }

  for (const specifier of specifiers) {
    try {
      const namespace = await import(specifier);
      assert.notEqual(namespace, null, `${specifier} 的命名空间是 null`);
    } catch (error) {
      throw new Error(
        `${specifier} 在 Node ${process.versions.node}（声明行）上裸加载失败（${String(error.code ?? '')}）：${error.message}`,
      );
    }
  }
  assert.ok(
    specifiers.length >= packages.length,
    `exports 入口数 ${specifiers.length} 少于包数 ${packages.length}：每个包至少要暴露 "."`,
  );
});

test('文档：runtime-support.md 被索引，模式表逐值等于代码来源', () => {
  assert.ok(existsSync(path.join(ROOT, RUNTIME_DOC)), `${RUNTIME_DOC} 不存在：两种执行模式没有唯一散文权威`);
  const document = read(RUNTIME_DOC);
  assert.ok(read('docs/development/README.md').includes('runtime-support.md'), `docs/development/README.md 没有索引 runtime-support.md`);

  const engines = String(json('package.json').engines?.node ?? '');
  const nvmrc = read('.nvmrc').trim();
  const typesNode = (json('package.json').devDependencies ?? {})['@types/node'] ?? '';
  const buildScript = read('apps/harness-plugin/scripts/build.mjs');
  const hostTarget = buildScript.match(/HOST_NODE_TARGET = '([^']+)'/)?.[1] ?? '';
  const hostVersion = buildScript.match(/HOST_NODE_VERSION = '([^']+)'/)?.[1] ?? '';
  assert.ok(engines !== '' && hostTarget !== '' && hostVersion !== '', '代码里的运行时事实缺失，先由其他测试报出');

  const rows = new Map(tableRows(document, '| 模式 ').map((cells) => [cells[0], cells]));
  const sourceRow = rows.get('source');
  const hostRow = rows.get('host');
  assert.ok(sourceRow, `${RUNTIME_DOC} 的模式表缺少首列为 source 的行`);
  assert.ok(hostRow, `${RUNTIME_DOC} 的模式表缺少首列为 host 的行`);

  /** 「版本事实」单元格只允许写成 `标签` = `值`；按标签取精确值，整行包含判断会被同行的其他值蒙混（评审 P2-1）。 */
  const versionFacts = (cells) =>
    new Map([...(cells[2] ?? '').matchAll(/`([^`]+)`\s*=\s*`([^`]+)`/g)].map((match) => [match[1], match[2]]));
  const sourceFacts = versionFacts(sourceRow);
  const hostFacts = versionFacts(hostRow);
  for (const [facts, rowLabel, label, value] of [[sourceFacts, 'source', 'engines.node', engines], [sourceFacts, 'source', '.nvmrc', nvmrc], [hostFacts, 'host', 'HOST_NODE_TARGET', hostTarget], [hostFacts, 'host', 'HOST_NODE_VERSION', hostVersion], [hostFacts, 'host', '@types/node', typesNode]]) {
    assert.equal(facts.get(label), value, `${rowLabel} 行「版本事实」单元格里 ${label} 的值必须是 ${value}，实际是 ${String(facts.get(label))}`);
  }

  const typesPair = /(\d+)\.(\d+)/.exec(typesNode);
  const hostPair = /(\d+)\.(\d+)/.exec(hostVersion);
  assert.ok(typesPair && hostPair, '@types/node 或 HOST_NODE_VERSION 不是 major.minor 形状');
  assert.ok(
    Number(typesPair[1]) < Number(hostPair[1]) ||
      (Number(typesPair[1]) === Number(hostPair[1]) && Number(typesPair[2]) <= Number(hostPair[2])),
    `@types/node（${typesNode}）的 major.minor 高于验收宿主 Node ${hostVersion}：类型天花板被抬高了`,
  );

  for (const evidence of ['tests/contract/runtime-support.test.js', 'tests/contract/host-node-types.test.js', 'tests/integration/harness-plugin-artifact.test.js']) {
    assert.ok(document.includes(evidence), `${RUNTIME_DOC} 没有点名证据 ${evidence}`);
    assert.ok(existsSync(path.join(ROOT, evidence)), `${RUNTIME_DOC} 点名的证据 ${evidence} 不存在`);
  }
});
