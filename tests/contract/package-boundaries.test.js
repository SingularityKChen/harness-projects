/**
 * 包边界契约测试
 *
 * 保护的不变量（AGENTS.md §2.2）：依赖方向单向、能力定义与实现分离、领域层是叶子、
 * 客户端模型与界面分离、Provider 之间互不调用。
 *
 * 允许的依赖边（左侧只能依赖右侧）：
 *
 *   apps/*            -> ui, ui-model, client, domain
 *   （例外）HOST_ENTRY 列出的 apps/harness-plugin Host 入口文件另可 -> core, controller, storage/sqlite, capabilities, 目录收录的 provider 包
 *   ui                -> ui-model, client, domain
 *   ui-model          -> client, domain
 *   client            -> controller, domain
 *   controller        -> core, capabilities, domain
 *   core              -> capabilities, domain
 *   capabilities      -> domain
 *   providers/*       -> capabilities, domain
 *   storage/*         -> capabilities, domain
 *   domain            -> （无）
 *
 * 外部运行时依赖同样受约束：react / react-dom 只允许出现在 ui 与 apps/*。
 */

import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { listPackageDirectories, listSourceFiles } from '../fixtures/source-tree.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const pkg = (name, allow) => ({ name, allow })

/** 预期存在的包：仓库路径 -> 名称与允许依赖的仓库路径。 */
const EXPECTED = {
  'packages/domain': pkg('@harness-projects/domain', []),
  'packages/capabilities': pkg('@harness-projects/capabilities', ['packages/domain']),
  'packages/core': pkg('@harness-projects/core', ['packages/domain', 'packages/capabilities']),
  'packages/controller': pkg('@harness-projects/controller', [
    'packages/domain',
    'packages/capabilities',
    'packages/core',
  ]),
  'packages/client': pkg('@harness-projects/client', ['packages/domain', 'packages/controller']),
  'packages/ui-model': pkg('@harness-projects/ui-model', ['packages/domain', 'packages/client']),
  'packages/ui': pkg('@harness-projects/ui', [
    'packages/domain',
    'packages/client',
    'packages/ui-model',
  ]),
  'packages/providers/planning-local': pkg('@harness-projects/provider-planning-local', [
    'packages/domain',
    'packages/capabilities',
  ]),
  'packages/providers/planning-github-projects': pkg(
    '@harness-projects/provider-planning-github-projects',
    ['packages/domain', 'packages/capabilities'],
  ),
  'packages/providers/development-local-git': pkg(
    '@harness-projects/provider-development-local-git',
    ['packages/domain', 'packages/capabilities'],
  ),
  'packages/providers/development-github': pkg('@harness-projects/provider-development-github', [
    'packages/domain',
    'packages/capabilities',
  ]),
  'packages/providers/delivery-github-actions': pkg(
    '@harness-projects/provider-delivery-github-actions',
    ['packages/domain', 'packages/capabilities'],
  ),
  'packages/providers/execution-harness': pkg('@harness-projects/provider-execution-harness', [
    'packages/domain',
    'packages/capabilities',
  ]),
  'packages/providers/execution-human': pkg('@harness-projects/provider-execution-human', [
    'packages/domain',
    'packages/capabilities',
  ]),
  'packages/providers/fake': pkg('@harness-projects/provider-fake', [
    'packages/domain',
    'packages/capabilities',
  ]),
  'packages/storage/sqlite': pkg('@harness-projects/storage-sqlite', [
    'packages/domain',
    'packages/capabilities',
  ]),
  'apps/harness-plugin': pkg('@harness-projects/app-harness-plugin', [
    'packages/domain',
    'packages/client',
    'packages/ui-model',
    'packages/ui',
  ]),
  'apps/web': pkg('@harness-projects/app-web', [
    'packages/domain',
    'packages/client',
    'packages/ui-model',
    'packages/ui',
  ]),
}

/**
 * ADR-0013 与 ADR-0014（均为 Proposed）的唯一例外：只有这些 Host 入口文件可以 import core / controller / storage / capabilities 与目录收录的
 * provider 包（provider-fake 不放行），且它们不得从 client 入口经相对 import 可达；包内其它文件（含 client 与 Host 共用的 remote.ts）仍按 apps/* 的边。
 */
const HOST_ENTRY = {
  dir: 'apps/harness-plugin',
  files: ['apps/harness-plugin/src/host.ts', 'apps/harness-plugin/src/host-composition.ts', 'apps/harness-plugin/src/host-providers.ts', 'apps/harness-plugin/src/host-planning-mapping.ts', 'apps/harness-plugin/src/host-execution.ts', 'apps/harness-plugin/src/host-session-adapter.ts'],
  allow: ['packages/core', 'packages/controller', 'packages/storage/sqlite', 'packages/capabilities',
    'packages/providers/planning-github-projects', 'packages/providers/development-local-git', 'packages/providers/development-github',
    'packages/providers/delivery-github-actions', 'packages/providers/execution-harness', 'packages/providers/execution-human'],
  clientEntry: 'apps/harness-plugin/src/client.ts',
}

/** 允许出现的外部运行时依赖。未列出的包不得声明它们。 */
const EXTERNAL_ALLOW = {
  react: ['packages/ui', 'apps/harness-plugin', 'apps/web'],
  'react-dom': ['packages/ui', 'apps/harness-plugin', 'apps/web'],
}

const nameToPath = new Map(Object.entries(EXPECTED).map(([p, { name }]) => [name, p]))

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

// 构建脚本的显式边：apps 下的 scripts 目录不是产品源码，但构建期的跨包 import 同样
// 不得反向或越层；目录必须显式登记，未登记的新构建脚本目录按 fail closed 处理。
const BUILD_SCRIPT_ALLOW = {
  'apps/harness-plugin/scripts': ['packages/storage/sqlite'],
}

/** 收集一个构建脚本目录下的 .mjs 文件。 */
async function scriptFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
}

/** 提取一个源文件里所有静态与动态 import 的模块说明符。 */
function importSpecifiers(source) {
  const specifiers = new Set()
  for (const re of [
    /from\s+['"]([^'"]+)['"]/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(re)) specifiers.add(match[1])
  }
  return [...specifiers]
}

function resolveInternal(specifier) {
  if (!specifier.startsWith('@harness-projects/')) return undefined
  const withoutSubpath = specifier.split('/').slice(0, 2).join('/')
  return nameToPath.get(withoutSubpath)
}

test('结构：目标包全部存在，且 manifest 契约一致', async () => {
  for (const [dir, { name }] of Object.entries(EXPECTED)) {
    const manifestPath = path.join(repoRoot, dir, 'package.json')
    assert.ok(await exists(manifestPath), `缺少 ${dir}/package.json`)

    const manifest = await readJson(manifestPath)
    assert.equal(manifest.name, name, `${dir} 的包名应为 ${name}`)
    assert.equal(manifest.private, true, `${dir} 必须是私有包，禁止误发布`)
    assert.equal(manifest.type, 'module', `${dir} 必须是 ESM`)
    assert.equal(
      manifest.exports?.['.'],
      './src/index.ts',
      `${dir} 的导出入口应为 ./src/index.ts`,
    )
    assert.ok(await exists(path.join(repoRoot, dir, 'src', 'index.ts')), `${dir} 缺少 src/index.ts`)
  }
})

test('结构：不存在未登记的包', async () => {
  const found = listPackageDirectories(repoRoot, ['packages', 'apps'])
  const unexpected = found.filter((dir) => !(dir in EXPECTED))
  assert.deepEqual(unexpected, [], `新增包必须先登记到本测试的依赖矩阵：${unexpected.join(', ')}`)
  assert.equal(found.length, Object.keys(EXPECTED).length)
})

test('结构：每个包声明责任与允许的依赖方向', async () => {
  for (const dir of Object.keys(EXPECTED)) {
    const source = await readFile(path.join(repoRoot, dir, 'src', 'index.ts'), 'utf8')
    assert.match(source, /Responsibility:/, `${dir}/src/index.ts 必须声明 Responsibility:`)
    assert.match(source, /Allowed imports:/, `${dir}/src/index.ts 必须声明 Allowed imports:`)
  }
})

test('依赖：源码中的跨包 import 必须落在允许的边上', async () => {
  for (const dir of Object.keys(EXPECTED)) {
    const { allow } = EXPECTED[dir]
    for (const { scope, file } of listSourceFiles(repoRoot, [`${dir}/src`])) {
      const source = await readFile(path.join(repoRoot, scope, file), 'utf8')
      const relative = `${scope}/${file}`
      for (const specifier of importSpecifiers(source)) {
        const target = resolveInternal(specifier)
        if (target !== undefined) {
          assert.ok(
            allow.includes(target) || (HOST_ENTRY.files.includes(relative) && HOST_ENTRY.allow.includes(target)),
            `${relative} 依赖了 ${target}，但 ${dir} 的允许依赖是 [${allow.join(', ')}]（AGENTS.md §2.2）`,
          )
          continue
        }
        if (specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(path.join(repoRoot, scope, file)), specifier)
          assert.ok(
            resolved.startsWith(path.join(repoRoot, dir)),
            `${relative} 通过相对路径逃出了本包：${specifier}`,
          )
        }
      }
    }
  }
})

test('依赖：源码 import 的兄弟包必须在本包 manifest 中声明', async () => {
  for (const dir of Object.keys(EXPECTED)) {
    const manifest = await readJson(path.join(repoRoot, dir, 'package.json'))
    // devDependencies 也算声明：它同样让一个包在运行时解析到兄弟包，
    // 漏掉它就是一个可用的越界通道（对抗验证实测：只查 dependencies 时，
    // 把越界依赖写进 devDependencies 可以让整份检查保持全绿）。
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ])
    for (const { scope, file } of listSourceFiles(repoRoot, [`${dir}/src`])) {
      const source = await readFile(path.join(repoRoot, scope, file), 'utf8')
      const relative = `${scope}/${file}`
      for (const specifier of importSpecifiers(source)) {
        const target = resolveInternal(specifier)
        if (target === undefined) continue
        const packageName = specifier.split('/').slice(0, 2).join('/')
        assert.ok(
          declared.has(packageName),
          `${relative} import 了 ${packageName}，但 ${dir}/package.json 没有声明它：运行时解析会失败`,
        )
      }
    }
  }
})

test('依赖：Host 入口例外从 client 入口经相对 import 不可达（ADR-0013）', async () => {
  const reachable = new Set()
  const visit = async (relative) => {
    if (reachable.has(relative)) return
    reachable.add(relative)
    for (const specifier of importSpecifiers(await readFile(path.join(repoRoot, relative), 'utf8'))) {
      if (specifier.startsWith('.')) await visit(path.relative(repoRoot, path.resolve(repoRoot, path.dirname(relative), specifier)))
    }
  }
  await visit(HOST_ENTRY.clientEntry)
  assert.ok(reachable.size > 1, 'client 入口没有任何相对 import，本断言空转')
  assert.deepEqual(HOST_ENTRY.files.filter((file) => reachable.has(file)), [], 'client 入口不得到达 Host 入口文件')
})

test('依赖：根 manifest 声明全部工作区包，测试层才能按包名 import', async () => {
  const root = await readJson(path.join(repoRoot, 'package.json'))
  const declared = root.devDependencies ?? {}
  for (const [dir, { name }] of Object.entries(EXPECTED)) {
    assert.ok(
      name in declared,
      `package.json 的 devDependencies 缺少 ${name}（${dir}）：tests/ 无法按包名 import 它`,
    )
    assert.equal(declared[name], 'workspace:*', `${name} 必须用 workspace:* 协议声明`)
  }
})

test('依赖：manifest 中声明的内部与外部依赖同样受约束', async () => {
  for (const [dir, { allow }] of Object.entries(EXPECTED)) {
    const manifest = await readJson(path.join(repoRoot, dir, 'package.json'))
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    }
    for (const dependency of Object.keys(declared)) {
      const target = resolveInternal(dependency)
      if (target !== undefined) {
        assert.ok(
          allow.includes(target) || (dir === HOST_ENTRY.dir && HOST_ENTRY.allow.includes(target)),
          `${dir}/package.json 声明了 ${dependency}，但它不在允许依赖 [${allow.join(', ')}] 中`,
        )
        continue
      }
      const allowedHere = EXTERNAL_ALLOW[dependency]
      if (allowedHere !== undefined) {
        assert.ok(
          allowedHere.includes(dir),
          `${dir} 不得依赖 ${dependency}；只允许出现在 [${allowedHere.join(', ')}]（AGENTS.md §2.2）`,
        )
      }
    }
  }
})

test('壳：apps/harness-plugin/src 只有 .ts 文件，也不直接 import react / react-dom', async () => {
  // 插件壳只注册，组件只来自 @harness-projects/ui（#227 验收 4）；
  // 组件一旦在壳里用 JSX 或 createElement 自写，业务界面就有了第二个落点。
  // 列全部文件而不用 listSourceFiles：安装件构建也会打入 .tsx / .jsx / .js，扫描面必须不小于构建的输入面。
  const shellSrc = path.join(repoRoot, 'apps', 'harness-plugin', 'src')
  const entries = await readdir(shellSrc, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
  assert.ok(files.length > 0, 'apps/harness-plugin/src 至少要有 index.ts，否则本断言空转')

  assert.deepEqual(
    files.filter((file) => !file.endsWith('.ts')).map((file) => path.relative(repoRoot, file)),
    [],
    '插件壳只允许 .ts 文件（不得有 .tsx / .jsx / .js）：组件只来自 @harness-projects/ui',
  )

  const reactImport = /^react(-dom)?(\/|$)/
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const relative = path.relative(repoRoot, file)
    const requires = [...source.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
    for (const specifier of [...importSpecifiers(source), ...requires]) {
      assert.ok(
        !reactImport.test(specifier),
        `${relative} 直接 import 了 ${specifier}：插件壳不得依赖 react，组件只来自 @harness-projects/ui`,
      )
    }
  }
})

test('构建脚本：apps/*/scripts 的跨包 import 只允许已登记的构建边', async () => {
  // #658：build.mjs 静态 import @harness-projects/storage-sqlite 后，apps -> storage 的构建边
  // 必须被矩阵观测；方向本身合法，但未登记的 app 构建脚本边一律失败。
  // 范围：只解析字面量 import / export-from / dynamic import（见 importSpecifiers）；createRequire、
  // 模板拼接与 .js/.cjs 构建脚本不在本契约内——它是静态可见边的 fail-closed，不是完整引用分析。
  const found = []
  for (const app of await readdir(path.join(repoRoot, 'apps'), { withFileTypes: true })) {
    if (!app.isDirectory()) continue
    if (await exists(path.join(repoRoot, 'apps', app.name, 'scripts'))) found.push(`apps/${app.name}/scripts`)
  }
  assert.deepEqual(found.sort(), Object.keys(BUILD_SCRIPT_ALLOW).sort(), 'apps/*/scripts 构建目录必须先登记到 BUILD_SCRIPT_ALLOW')
  for (const [dir, allow] of Object.entries(BUILD_SCRIPT_ALLOW)) {
    for (const file of await scriptFiles(path.join(repoRoot, dir))) {
      const relative = path.relative(repoRoot, file)
      for (const specifier of importSpecifiers(await readFile(file, 'utf8'))) {
        const target = resolveInternal(specifier)
        if (target === undefined) continue
        assert.ok(allow.includes(target), `${relative} import 了 ${specifier}，构建边必须登记在 BUILD_SCRIPT_ALLOW（当前允许：${allow.join(', ') || '无'}）`)
      }
    }
  }
})
