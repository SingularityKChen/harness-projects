/**
 * Harness 插件安装件构建（ADR-0009、ExecPlan 2026-09-29-harness-plugin-package）。
 *
 * 一次调用产出 `<outDir>/package/` 下的四个文件：
 *   package.json（生成的安装件 manifest）、cordis.patch.yml、lib/index.js（宿主半边）、lib/client.js（客户端半边）。
 * 任何一道构建闸门不满足就抛错，此时 `<outDir>/package` 不存在（先清空，闸门通过后才写盘）。
 *
 * 命令行：node apps/harness-plugin/scripts/build.mjs [--out <dir>]，缺省 outDir 为 apps/harness-plugin/dist。
 */
import { builtinModules } from 'node:module'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { build as esbuild } from 'esbuild'

/**
 * 浏览器模块系统预置的 9 个模块名，取自宿主 0.2.0-rc.2 的基线表函数 `rM()`（键与 0.1.7-rc.2 的 `WS()` 相同）。
 * client bundle 只能 `require` 这些名字与 `CLIENT_EXTERNAL`。
 */
export const CLIENT_BASELINE = Object.freeze([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** 等于安装件 `dsh.client.external`；#227 没有基线之外的外置模块。 */
export const CLIENT_EXTERNAL = Object.freeze([])

/** 所有 `@deepseek-ai/dsh-*` peer 的唯一取值（D20）。 */
export const HOST_DSH_PEER_RANGE = '~0.2.0-rc.2'

/** `@deepseek-ai/cordis` peer 的取值（D20）。 */
export const CORDIS_PEER_RANGE = '~4.0.4'

/** 宿主半边的构建目标（D26）：不高于 Desktop 的 Node 24.18.1 与仓库 engines.node >=22。 */
export const HOST_NODE_TARGET = 'node22'

/** 安装件 peer：至少一个 dsh-* peer，没有这类 peer 时宿主兼容闸门直接放行（F12）。 */
export const HOST_PEERS = Object.freeze({
  '@deepseek-ai/cordis': CORDIS_PEER_RANGE,
  '@deepseek-ai/dsh-client-ui-slots': HOST_DSH_PEER_RANGE,
  '@deepseek-ai/dsh-client-ui-layout': HOST_DSH_PEER_RANGE,
  '@deepseek-ai/dsh-client-ui-sidebar': HOST_DSH_PEER_RANGE,
})

/** 包级到达顺序边：指向声明 `main`（ui-layout）与 `sidebar.panellist`（ui-sidebar）的包。 */
const CLIENT_INJECT = Object.freeze([
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
])

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(APP_DIR, '..', '..')
const DEFAULT_OUT_DIR = path.join(APP_DIR, 'dist')

const NODE_BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

function isNodeBuiltin(specifier) {
  const bare = specifier.replace(/^node:/, '')
  return NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split('/')[0])
}

/** 只有一个输出文件（不出 source map），取它的 metafile 记录与文本。 */
function singleOutput(result, label) {
  const keys = Object.keys(result.metafile.outputs)
  if (keys.length !== 1) throw new Error(`${label}: 期望恰好一个输出，实际 ${keys.length}`)
  const files = result.outputFiles ?? []
  if (files.length !== 1) throw new Error(`${label}: 期望恰好一个输出文件，实际 ${files.length}`)
  return { record: result.metafile.outputs[keys[0]], text: files[0].text }
}

function externalImports(record) {
  return record.imports.filter((entry) => entry.external).map((entry) => entry.path)
}

/** `@harness-projects/*` 只允许作为打入产物的源码，不能以模块说明符的形式留在产物里。 */
const WORKSPACE_SPECIFIER = /(?:\brequire\s*\(|\bimport\s*\(|\bfrom\s*|\bimport\s*)["'`]@harness-projects\//

function assertGates({ client, host }) {
  const allowedClient = new Set([...CLIENT_BASELINE, ...CLIENT_EXTERNAL])
  const badClient = externalImports(client.record).filter((specifier) => !allowedClient.has(specifier))
  if (badClient.length > 0) {
    throw new Error(`client bundle 引用了基线之外的外置模块：${[...new Set(badClient)].join(', ')}`)
  }

  const badHost = externalImports(host.record).filter(
    (specifier) => !specifier.startsWith('@deepseek-ai/') && !isNodeBuiltin(specifier),
  )
  if (badHost.length > 0) {
    throw new Error(`宿主半边引用了既非 @deepseek-ai/* 也非 Node 内置的外置模块：${[...new Set(badHost)].join(', ')}`)
  }

  for (const [label, output] of [['宿主半边', host], ['client bundle', client]]) {
    if (WORKSPACE_SPECIFIER.test(output.text)) {
      throw new Error(`${label}产物里残留 @harness-projects/ 模块说明符（workspace 包必须被打入）`)
    }
  }
}

function assertManifestInvariants(manifest) {
  const peers = manifest.peerDependencies
  if (!Object.keys(peers).some((name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))) {
    throw new Error('安装件没有任何 @deepseek-ai/dsh-* peer：宿主兼容闸门会对它直接放行（F12）')
  }
  for (const name of manifest.dsh.client.inject) {
    if (!(name in peers)) throw new Error(`dsh.client.inject 的 ${name} 不在 peerDependencies 里`)
  }
}

function createManifest({ source, rootManifest }) {
  const dshClient = {
    platform: 'web',
    inject: [...CLIENT_INJECT],
    ...(CLIENT_EXTERNAL.length > 0 ? { external: [...CLIENT_EXTERNAL] } : {}),
  }
  const manifest = {
    name: source.name,
    version: source.version,
    description: source.description,
    license: rootManifest.license,
    private: true,
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './lib/client.js',
      './package.json': './package.json',
      './cordis.patch.yml': './cordis.patch.yml',
    },
    files: ['lib/index.js', 'lib/client.js', 'cordis.patch.yml'],
    peerDependencies: { ...HOST_PEERS },
    dsh: {
      manifestVersion: 1,
      bundle: { patch: './cordis.patch.yml' },
      client: dshClient,
    },
  }
  assertManifestInvariants(manifest)
  return manifest
}

/**
 * 构建安装件。
 * @param {{ outDir?: string }} [options] 缺省 `apps/harness-plugin/dist`
 * @returns {Promise<{ packageDir: string, manifest: object, metafiles: { host: object, client: object } }>}
 */
export async function build({ outDir = DEFAULT_OUT_DIR } = {}) {
  const packageDir = path.join(path.resolve(outDir), 'package')
  const libDir = path.join(packageDir, 'lib')

  // 先清空：闸门失败时不留下上一次的产物，避免把旧安装件当成这次的结果。
  await rm(packageDir, { recursive: true, force: true })

  const source = await readJson(path.join(APP_DIR, 'package.json'))
  const rootManifest = await readJson(path.join(REPO_ROOT, 'package.json'))

  // 共同选项：absWorkingDir 固定为仓库根，产物注释与 metafile 输入都是相对仓库根的路径，与 outDir 无关（D11）。
  const common = {
    absWorkingDir: REPO_ROOT,
    bundle: true,
    packages: 'bundle',
    sourcemap: false,
    minify: false,
    metafile: true,
    write: false,
    logLevel: 'silent',
  }

  const hostResult = await esbuild({
    ...common,
    entryPoints: [path.join(APP_DIR, 'src', 'host.ts')],
    outfile: path.join(libDir, 'index.js'),
    format: 'esm',
    platform: 'node',
    target: HOST_NODE_TARGET,
    external: ['@deepseek-ai/*'],
  })

  // 与宿主 Loader 的包装形状一致（F5）：window.__ModuleLoader__.load({ id, factory })。
  const clientResult = await esbuild({
    ...common,
    entryPoints: [path.join(APP_DIR, 'src', 'client.ts')],
    outfile: path.join(libDir, 'client.js'),
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: [...CLIENT_BASELINE, ...CLIENT_EXTERNAL],
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: {
      js:
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(source.name)}, factory: (require) => { ` +
        'var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  })

  const host = singleOutput(hostResult, '宿主半边')
  const client = singleOutput(clientResult, 'client bundle')
  assertGates({ host, client })

  const manifest = createManifest({ source, rootManifest })

  await mkdir(libDir, { recursive: true })
  await writeFile(path.join(libDir, 'index.js'), host.text)
  await writeFile(path.join(libDir, 'client.js'), client.text)
  await writeFile(
    path.join(packageDir, 'cordis.patch.yml'),
    await readFile(path.join(APP_DIR, 'cordis.patch.yml')),
  )
  await writeFile(path.join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  return {
    packageDir,
    manifest,
    metafiles: { host: hostResult.metafile, client: clientResult.metafile },
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  try {
    // strict：未知选项、位置参数与缺值的 --out 都抛错。
    const { out } = parseArgs({ options: { out: { type: 'string' } } }).values
    const { packageDir } = await build(out === undefined ? {} : { outDir: out })
    console.log(`built ${path.relative(process.cwd(), packageDir) || '.'}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
