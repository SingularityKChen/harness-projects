/**
 * 包边界契约测试
 *
 * 保护的不变量（AGENTS.md §2.2）：依赖方向单向、能力定义与实现分离、领域层是叶子、
 * 客户端模型与界面分离、Provider 之间互不调用。
 *
 * 允许的依赖边（左侧只能依赖右侧）：
 *
 *   apps/*            -> ui, ui-model, client, domain
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

import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

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

/** 收集 package.json 所在目录（packages/**、apps/*），跳过 node_modules 与 dist。 */
async function findPackageDirs() {
  const found = []
  for (const group of ['packages', 'apps']) {
    const groupDir = path.join(repoRoot, group)
    if (!(await exists(groupDir))) continue
    for (const entry of await readdir(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      const direct = path.join(groupDir, entry.name)
      if (await exists(path.join(direct, 'package.json'))) {
        found.push(path.relative(repoRoot, direct))
        continue
      }
      for (const nested of await readdir(direct, { withFileTypes: true })) {
        if (!nested.isDirectory()) continue
        const nestedDir = path.join(direct, nested.name)
        if (await exists(path.join(nestedDir, 'package.json'))) {
          found.push(path.relative(repoRoot, nestedDir))
        }
      }
    }
  }
  return found.sort()
}

async function sourceFiles(dir) {
  const files = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...(await sourceFiles(full)))
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
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
  const found = await findPackageDirs()
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
    for (const file of await sourceFiles(path.join(repoRoot, dir, 'src'))) {
      const source = await readFile(file, 'utf8')
      const relative = path.relative(repoRoot, file)
      for (const specifier of importSpecifiers(source)) {
        const target = resolveInternal(specifier)
        if (target !== undefined) {
          assert.ok(
            allow.includes(target),
            `${relative} 依赖了 ${target}，但 ${dir} 的允许依赖是 [${allow.join(', ')}]（AGENTS.md §2.2）`,
          )
          continue
        }
        if (specifier.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), specifier)
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
    for (const file of await sourceFiles(path.join(repoRoot, dir, 'src'))) {
      const source = await readFile(file, 'utf8')
      const relative = path.relative(repoRoot, file)
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
          allow.includes(target),
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
