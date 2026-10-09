/**
 * 交付运行时的类型面契约
 *
 * 保护的不变量（ADR-0009 Decision 5；归档计划 2026-09-29-harness-plugin-package 的 D26，来源是人类伙伴的要求）：
 * 插件宿主半边的代码不得依赖高于验收宿主的 Node API。验收宿主 Desktop 0.2.0-rc.2 的宿主子进程是 Electron 44
 * 以 Node 模式运行的 Node 24.18.1；CI 与本机开发跑 `.nvmrc` 的 Node 26，那一头抓不到宿主上才缺失的 API。
 * 剩下的唯一自动闸门是类型检查：`@types/node` 比宿主新，宿主上缺失的 API 就会通过 `tsc`，然后在宿主里抛 `TypeError`
 * （探针：`AsyncLocalStorage#withScope`，@since v25.9.0；同一个 major 内也一样：`Blob#textStream()`，@since v24.19.0，
 * 在 `@types/node` 24.19.x 里，Desktop 的 Node 24.18.1 上是 undefined）。
 *
 * 所以比较的是 major.minor，不只是 major：`@types/node` 的 major.minor 标示它描述到哪个 Node 小版本。它发布时会跳过
 * 一些 minor（24.13 之后直接是 24.19），但「major.minor 不高于宿主」仍然是可靠的阈值。patch 不比较：类型包的 patch
 * 是它自己的修订号，不对应 Node 的 patch。
 *
 * 宿主 Node 版本只在 `apps/harness-plugin/scripts/build.mjs` 声明一次（`HOST_NODE_VERSION`，紧挨 `HOST_NODE_TARGET`），
 * 这里直接 import，不再抄一份字面量；Desktop 换到更高的 Node 时只改那一处。
 *
 * 检查两个面，因为各自能漏掉对方抓得到的东西：
 *   - workspace 清单声明的范围：只接受上界落在同一个 minor 内的写法（`~M.m.p`、`~M.m`、`M.m.p`、`M.m`），因为
 *     major 级的 x 区间（`24.x`、`24`、`~24`）以及 `^`、`>=`、`*`、`latest` 的上界会越过宿主，下一次重新解析
 *     （`pnpm update`、`pnpm add`）就可能落到更高的版本；
 *   - 锁文件里实际解析出的版本：包括传递依赖，也是 `tsc` 真正读到的东西。
 *
 * 包集合取自锁文件的 `importers`（pnpm 自己展开 workspace 之后的结果），不在这里重新实现 glob；再与磁盘上的
 * 包根核对（找到包根就停，跳过 `node_modules` 与被忽略的构建产物 `dist/`），任何一边多出来或少了都报错，
 * 所以不认识的 workspace 写法、陈旧的锁文件都不会让一个包悄悄逃过检查，合法的构建产物也不会让它误报。
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { HOST_NODE_TARGET, HOST_NODE_VERSION } from '../../apps/harness-plugin/scripts/build.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** workspace 包所在的根：与 pnpm-workspace.yaml 的 packages 对应；多出来的根会让「磁盘与 importers 一一对应」那条红。 */
const PACKAGE_ROOTS = ['apps', 'packages']

/** 不是 workspace 成员的目录名：依赖，和被 .gitignore 忽略的构建产物。 */
const NOT_PACKAGES = new Set(['node_modules', 'dist'])

/** 只接受上界落在某个 minor 内的写法：`~24.13.5`、`~24.13`、`24.13.5`、`24.13`。 */
const MINOR_BOUNDED_SPECIFIER = /^~?(\d+)\.(\d+)(?:\.(\d+))?$/

const hostVersion = /^(\d+)\.(\d+)\.(\d+)$/.exec(HOST_NODE_VERSION)
const hostMajor = hostVersion === null ? Number.NaN : Number(hostVersion[1])
const hostMinor = hostVersion === null ? Number.NaN : Number(hostVersion[2])

/** major.minor 不高于验收宿主；宿主版本写错时恒为 false，由第一条检查报出原因。 */
const withinHost = (major, minor) => major < hostMajor || (major === hostMajor && minor <= hostMinor)

const describeHost = () => `Node ${hostMajor}.${hostMinor}（${HOST_NODE_VERSION}）`

const readLock = async () => parseYaml(await readFile(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8'))

/** 锁文件 importers 的键：pnpm 自己展开 workspace 之后的包目录，根包是 `.`。 */
const importerDirectories = (lock) => Object.keys(lock.importers ?? {}).sort()

/**
 * 磁盘上的包目录：根目录，加 apps/ 与 packages/ 下的包根。找到带 package.json 的目录就停，不再下钻（包内嵌套的
 * 清单，比如测试夹具，不是 workspace 成员）；并跳过依赖与被 .gitignore 忽略的构建产物（`node_modules`、`dist`），
 * 否则按文档跑一次 `pack:plugin` 生成的 `apps/harness-plugin/dist/package/package.json` 会被算成「磁盘上的包」。
 * 与 `package-boundaries.test.js` 的 `findPackageDirs` 一样找到包根就停；不同的是它只看两层、只跳过 `node_modules`，
 * 这里逐层递归，并按名字跳过 `node_modules` 与 `dist`。
 */
async function packageDirectoriesOnDisk(root = repoRoot) {
  const found = []
  const visit = async (relative) => {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) {
      found.push(relative)
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !NOT_PACKAGES.has(entry.name)) await visit(path.posix.join(relative, entry.name))
    }
  }
  const rootEntries = await readdir(root)
  if (rootEntries.includes('package.json')) found.push('.')
  for (const group of PACKAGE_ROOTS) await visit(group)
  return found.sort()
}

/** 两个包集合的差：磁盘上有而锁文件没有，和锁文件有而磁盘上找不到。 */
const diffPackageSets = (imported, onDisk) => ({
  missingFromLock: onDisk.filter((directory) => !imported.includes(directory)),
  missingOnDisk: imported.filter((directory) => !onDisk.includes(directory)),
})

/** 每个 importer 的清单里对 `@types/node` 的声明：{ file, field, specifier }。清单缺失直接抛错，不跳过。 */
async function declaredTypesNode(lock) {
  const declared = []
  for (const directory of importerDirectories(lock)) {
    const file = path.posix.join(directory, 'package.json')
    const manifest = JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'))
    for (const field of DEPENDENCY_FIELDS) {
      const specifier = manifest[field]?.['@types/node']
      if (specifier !== undefined) declared.push({ file, field, specifier })
    }
  }
  return declared
}

/** 锁文件 `packages` 里实际解析出的 `@types/node` 版本字符串（去掉 peer 后缀）。 */
const resolvedTypesNode = (lock) =>
  Object.keys(lock.packages ?? {})
    .filter((key) => key.startsWith('@types/node@'))
    .map((key) => key.slice('@types/node@'.length).replace(/\(.*$/, ''))

test('验收宿主的 Node 版本写成 major.minor.patch，并且不低于宿主半边的构建目标（D26）', () => {
  assert.ok(
    hostVersion !== null,
    `HOST_NODE_VERSION 必须写成 <major>.<minor>.<patch>，实际是 ${String(HOST_NODE_VERSION)}`,
  )
  const target = /^node(\d+)$/.exec(HOST_NODE_TARGET)
  assert.ok(target, `HOST_NODE_TARGET 必须写成 node<major>，实际是 ${String(HOST_NODE_TARGET)}`)
  assert.ok(
    Number(target[1]) <= hostMajor,
    `构建目标 ${HOST_NODE_TARGET} 高于验收宿主的 Node ${hostMajor}：D26 要求构建目标不高于验收宿主`,
  )
})

test('锁文件 importers 与磁盘上的包根一一对应：不认识的 workspace 写法、陈旧的锁文件都会让这条红', async () => {
  const imported = importerDirectories(await readLock())
  const onDisk = await packageDirectoriesOnDisk()
  assert.deepEqual(
    diffPackageSets(imported, onDisk),
    { missingFromLock: [], missingOnDisk: [] },
    '包集合对不上：missingFromLock 是磁盘上有包根（带 package.json，不在 node_modules 与 dist 里）但锁文件 importers 里没有的目录'
      + '（锁文件陈旧，或 workspace 写法 pnpm 与本测试理解不一致），missingOnDisk 是 importers 里有但扫描不到的目录'
      + '（包放到了 apps/ packages/ 之外，需要在 PACKAGE_ROOTS 里加上；或嵌套在另一个包里面，扫描到包根就停）。'
      + '这两种情况下清单检查都会漏掉某个包',
  )
})

test('磁盘扫描只数包根：构建产物 dist/、node_modules 和包内嵌套的 package.json 都不算包，两个方向的真差异仍被指出', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'host-node-types-'))
  try {
    const manifests = [
      'package.json',
      'apps/a/package.json',
      'apps/a/dist/package/package.json', // 构建产物，被 .gitignore 忽略
      'apps/a/test/fixtures/x/package.json', // 包内嵌套的清单
      'packages/providers/b/package.json',
      'packages/node_modules/dep/package.json', // 分组层的 node_modules
      'packages/providers/newpkg/package.json', // 磁盘上有、锁文件没有
      'packages/deep/er/c/package.json', // 多层嵌套的分组目录下的包
      'packages/dist/stray/package.json', // 分组层的 dist
    ]
    for (const file of manifests) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), '{}\n')
    }
    const onDisk = await packageDirectoriesOnDisk(root)
    assert.deepEqual(onDisk, [
      '.',
      'apps/a',
      'packages/deep/er/c',
      'packages/providers/b',
      'packages/providers/newpkg',
    ])
    // 构建产物和 node_modules 不制造差异；两个方向的真差异仍然被指出来：
    // 磁盘上有、锁文件没有（newpkg），和锁文件有、磁盘上找不到（tools/x，比如包放到了 PACKAGE_ROOTS 之外）
    const imported = ['.', 'apps/a', 'packages/deep/er/c', 'packages/providers/b', 'tools/x']
    assert.deepEqual(diffPackageSets(imported, onDisk), {
      missingFromLock: ['packages/providers/newpkg'],
      missingOnDisk: ['tools/x'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('importers 对应的清单里，@types/node 的声明必须带 minor 上界，且 major.minor 不高于验收宿主', async () => {
  const declared = await declaredTypesNode(await readLock())
  assert.ok(declared.length > 0, '没有任何 workspace 清单声明 @types/node：这条检查不能空转')
  for (const { file, field, specifier } of declared) {
    const match = MINOR_BOUNDED_SPECIFIER.exec(specifier)
    assert.ok(
      match,
      `${file} 的 ${field}["@types/node"] 是 "${specifier}"：必须写成上界落在同一个 minor 内的 ~M.m.p、~M.m、M.m.p 或 M.m。`
        + '^、major 级的 x 区间（24.x、24、~24）、>=、*、latest、tag 的上界会越过验收宿主，下一次重新解析就可能落到更高的 minor',
    )
    assert.ok(
      withinHost(Number(match[1]), Number(match[2])),
      `${file} 的 ${field}["@types/node"] 是 "${specifier}"，${match[1]}.${match[2]} 高于验收宿主的 ${describeHost()}：`
        + '宿主上缺失的 API 会通过 tsc，却在宿主里抛 TypeError（ADR-0009 Decision 5 / D26）',
    )
  }
})

test('锁文件解析出的每个 @types/node，其 major.minor 不高于验收宿主', async () => {
  const resolved = resolvedTypesNode(await readLock())
  assert.ok(resolved.length > 0, 'pnpm-lock.yaml 里没有解析出任何 @types/node：这条检查不能空转')
  for (const version of resolved) {
    const match = /^(\d+)\.(\d+)\./.exec(version)
    assert.ok(match, `pnpm-lock.yaml 里的 @types/node 版本 "${version}" 无法解析 major.minor`)
    assert.ok(
      withinHost(Number(match[1]), Number(match[2])),
      `pnpm-lock.yaml 解析出 @types/node@${version}，${match[1]}.${match[2]} 高于验收宿主的 ${describeHost()}：`
        + 'tsc 实际读到的就是它（ADR-0009 Decision 5 / D26）',
    )
  }
})
