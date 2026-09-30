/**
 * Harness 插件安装件（产物）契约测试
 *
 * 保护的不变量（ExecPlan `2026-09-29-harness-plugin-package` Design / Spec §6 的 a–f）：
 * 本仓库只凭构建脚本就能产出一个宿主可接受的插件包——安装件 manifest 没有工作区依赖、
 * peer 范围与宿主线一致、patch 行按包名引用、宿主半边是能被 Node 直接加载的 JS、
 * 客户端半边只 `require` 宿主基线模块表里的名字并按宿主 Loader 的规则解包、
 * 构建只读本仓库且产物里没有本机路径。
 *
 * 这里只证明形状，不证明真实宿主接受它（那是 ExecPlan 的 K 行）。测试不依赖宿主运行时、
 * 不触网；预期值（peer 范围、基线模块表、导出映射）全部是本文件自带的字面量，
 * 不 import 构建脚本的常量，否则构建与测试会一起错。
 */

import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

import { parse as parseYaml } from 'yaml'

import { build } from '../../apps/harness-plugin/scripts/build.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// 独立预期（取值依据：ExecPlan Design / Spec §2、§4、§6，Decision Log D20）

/** 宿主线 0.2.0-rc.2：所有 `@deepseek-ai/dsh` / `dsh-*` peer 的唯一取值（D20）。 */
const EXPECTED_DSH_PEER_RANGE = '~0.2.0-rc.2'
const EXPECTED_CORDIS_PEER_RANGE = '~4.0.4'

const EXPECTED_PEER_KEYS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots',
]

const EXPECTED_EXPORTS = {
  '.': './lib/index.js',
  './client': './lib/client.js',
  './package.json': './package.json',
  './cordis.patch.yml': './cordis.patch.yml',
}

/**
 * 浏览器模块系统预置的 9 个模块名（宿主 0.2.0-rc.2 的基线表函数 `rM()`；
 * 键与 0.1.7-rc.2 的 `WS()` 相同，ExecPlan F6）。client bundle 的 `require` 只能取这些名字。
 */
const CLIENT_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const PANEL_ID = 'harness-projects'
const PANEL_TITLE = 'Harness Projects'
const HOST_READY_LINE = '[harness-projects] host ready'

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** 递归列出目录下所有文件（相对路径，POSIX 分隔符）。 */
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
  return files.map((file) => path.relative(dir, file).split(path.sep).join('/')).sort()
}

/**
 * 复刻宿主 Loader 的 `unwrapExports`（cordis-plugin-loader `lib/index.js:663-668`，ExecPlan F8；0.1.7-rc.2 与
 * Desktop 0.2.0-rc.2 自带的 1.0.5 行号、内容相同）。esbuild 的 CJS 输出带 `__esModule`、没有 `default`，被当作插件对象本身。
 */
function unwrapExports(exports) {
  if (exports === null || exports === undefined) return exports
  exports = exports.default ?? exports
  if (!exports.__esModule) return exports
  return exports.default ?? exports
}

/**
 * 在 `node:vm` 里执行 client bundle，模拟宿主浏览器的 `window.__ModuleLoader__.load`。
 * `require` 只回答基线键：`react` 返回记录型 `createElement`，其余基线键返回空对象，
 * 非基线一律抛出与宿主同形的错误。
 */
async function evaluateClientBundle(clientFile) {
  const code = await readFile(clientFile, 'utf8')
  const loadCalls = []
  const requested = []
  // 记录型 `createElement`：把调用还原成 `{ type, props, children }` 节点。
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) }
  const window = { __ModuleLoader__: { load: (descriptor) => loadCalls.push(descriptor) } }
  vm.runInContext(code, vm.createContext({ window }), { filename: clientFile })

  const stubRequire = (id) => {
    requested.push(id)
    if (!CLIENT_BASELINE.includes(id)) throw new Error(`require("${id}") missed the module table`)
    return id === 'react' ? react : {}
  }

  assert.equal(loadCalls.length, 1, 'client bundle 必须恰好调用一次 window.__ModuleLoader__.load')
  const [descriptor] = loadCalls
  assert.equal(typeof descriptor.factory, 'function')
  return { code, descriptor, exported: unwrapExports(descriptor.factory(stubRequire)), requested }
}

describe('Harness 插件安装件契约', () => {
  let tmpRoot
  let outDir
  let packageDir
  let result
  let sourceManifest
  let rootManifest

  before(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'harness-plugin-artifact-'))
    outDir = path.join(tmpRoot, 'out')
    sourceManifest = await readJson(path.join(repoRoot, 'apps/harness-plugin/package.json'))
    rootManifest = await readJson(path.join(repoRoot, 'package.json'))
    result = await build({ outDir })
    packageDir = path.join(outDir, 'package')
  })

  after(async () => {
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
  })

  describe('a. 安装件 manifest 是宿主可安装的、没有工作区依赖的白名单产物', () => {
    let manifest
    let manifestText

    before(async () => {
      manifestText = await readFile(path.join(packageDir, 'package.json'), 'utf8')
      manifest = JSON.parse(manifestText)
    })

    it('身份字段取自源 manifest 与仓库根，且保持私有 ESM 包', () => {
      assert.equal(manifest.name, sourceManifest.name)
      assert.equal(manifest.version, sourceManifest.version)
      assert.equal(manifest.license, rootManifest.license)
      assert.equal(manifest.private, true)
      assert.equal(manifest.type, 'module')
      assert.equal(manifest.main, './lib/index.js')
    })

    it('构建返回的 manifest 就是写到磁盘上的那一份', () => {
      assert.deepEqual(result.manifest, manifest)
    })

    it('exports 恰好是四个键，且含宿主定位 manifest 所需的 ./package.json', () => {
      assert.deepEqual(manifest.exports, EXPECTED_EXPORTS)
    })

    it('files 覆盖包目录里的每个产出，且每一项都真实存在', async () => {
      const produced = (await listFiles(packageDir)).filter((file) => file !== 'package.json')
      assert.ok(produced.length > 0, '包目录里没有产出')
      for (const file of produced) {
        assert.ok(manifest.files.includes(file), `产出 ${file} 没有列进 files`)
      }
      for (const file of manifest.files) {
        assert.ok(produced.includes(file), `files 列出的 ${file} 不存在`)
      }
      for (const target of Object.values(manifest.exports)) {
        assert.ok(
          target === './package.json' || produced.includes(target.replace(/^\.\//, '')),
          `exports 目标 ${target} 不存在`,
        )
      }
    })

    it('没有 dependencies / devDependencies，全文没有 workspace: 协议', () => {
      assert.equal('dependencies' in manifest, false)
      assert.equal('devDependencies' in manifest, false)
      assert.equal(manifestText.includes('workspace:'), false)
    })

    it('dsh 块声明 web 客户端与 patch，patch 文件存在，inject 是 peer 的子集', async () => {
      assert.equal(manifest.dsh.client.platform, 'web')
      assert.equal(typeof manifest.dsh.bundle.patch, 'string')
      const patchFile = path.join(packageDir, manifest.dsh.bundle.patch)
      assert.ok((await listFiles(packageDir)).includes(path.relative(packageDir, patchFile)))

      const { inject } = manifest.dsh.client
      assert.ok(Array.isArray(inject) && inject.length > 0, 'dsh.client.inject 不能为空')
      for (const name of inject) {
        assert.ok(name in manifest.peerDependencies, `inject 项 ${name} 不是 peerDependencies 的键`)
      }
      assert.deepEqual(manifest.dsh.client.external ?? [], [], '#227 的 client 没有 dsh.client.external')
    })

    it('peer 与宿主线 0.2.0-rc.2 一致：dsh-* 全部取同一个范围，cordis 取 ~4.0.4', () => {
      const peers = manifest.peerDependencies
      assert.deepEqual(Object.keys(peers).sort(), EXPECTED_PEER_KEYS)

      const dshPeers = Object.keys(peers).filter(
        (name) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'),
      )
      assert.ok(dshPeers.length >= 1, '没有任何 dsh-* peer 时兼容闸门直接放行，形同虚设')
      for (const name of dshPeers) {
        assert.equal(peers[name], EXPECTED_DSH_PEER_RANGE, `${name} 的范围不是 ${EXPECTED_DSH_PEER_RANGE}`)
      }
      assert.equal(peers['@deepseek-ai/cordis'], EXPECTED_CORDIS_PEER_RANGE)
    })
  })

  describe('b. patch 只插入一行、按包名引用本插件', () => {
    it('cordis.patch.yml 恰好一个 insert 行，id 为 harness-projects，name 等于包名', async () => {
      const patch = parseYaml(await readFile(path.join(packageDir, 'cordis.patch.yml'), 'utf8'))
      assert.ok(Array.isArray(patch), 'patch 顶层必须是列表')
      assert.equal(patch.length, 1)
      assert.deepEqual(Object.keys(patch[0]), ['insert'])
      assert.ok(Array.isArray(patch[0].insert))
      assert.equal(patch[0].insert.length, 1)
      const [row] = patch[0].insert
      assert.equal(row.id, PANEL_ID)
      assert.equal(row.name, sourceManifest.name)
    })
  })

  describe('c. 宿主半边是 Node 可直接加载的 JS', () => {
    let installedRoot
    let hostText

    before(async () => {
      installedRoot = path.join(tmpRoot, 'host', 'node_modules', ...sourceManifest.name.split('/'))
      await mkdir(path.dirname(installedRoot), { recursive: true })
      await cp(packageDir, installedRoot, { recursive: true })
      hostText = await readFile(path.join(packageDir, 'lib/index.js'), 'utf8')
    })

    it('装进 node_modules 后，包名、/package.json、/client 三个说明符都能解析', () => {
      const require = createRequire(path.join(tmpRoot, 'host', 'entry.cjs'))
      const main = require.resolve(sourceManifest.name)
      const manifestPath = require.resolve(`${sourceManifest.name}/package.json`)
      const clientPath = require.resolve(`${sourceManifest.name}/client`)
      assert.ok(main.endsWith(path.join('lib', 'index.js')))
      assert.ok(manifestPath.endsWith('package.json'))
      assert.ok(clientPath.endsWith(path.join('lib', 'client.js')))
    })

    it('import() 包名得到的 apply 是函数，调用后打出宿主就绪行', async (t) => {
      const require = createRequire(path.join(tmpRoot, 'host', 'entry.cjs'))
      const hostModule = await import(pathToFileURL(require.resolve(sourceManifest.name)).href)
      assert.equal(typeof hostModule.apply, 'function')

      const info = t.mock.method(console, 'info', () => {})
      hostModule.apply({})
      const lines = info.mock.calls.map((call) => call.arguments.join(' '))
      assert.ok(lines.includes(HOST_READY_LINE), `没有打出 ${HOST_READY_LINE}，实际：${JSON.stringify(lines)}`)
    })

    it('宿主半边文本里没有工作区说明符、.ts 说明符与 file: 说明符', () => {
      assert.equal(hostText.includes('@harness-projects/'), false)
      assert.equal(/["'`][^"'`\n]*\.tsx?["'`]/.test(hostText), false, '出现以 .ts 结尾的说明符')
      assert.equal(/["'`]file:/.test(hostText), false, '出现 file: 说明符')
    })
  })

  describe('d. 客户端半边是宿主 Loader 能物化的 __ModuleLoader__ 包装', () => {
    let evaluated

    before(async () => {
      evaluated = await evaluateClientBundle(path.join(packageDir, 'lib/client.js'))
    })

    it('load 描述符的 id 等于包名', () => {
      assert.equal(evaluated.descriptor.id, sourceManifest.name)
    })

    it('按宿主 unwrapExports 的规则解包后，恰好导出 apply 与 inject，且 inject 含 slots', () => {
      const { exported } = evaluated
      assert.equal(typeof exported.apply, 'function')
      assert.ok(Array.isArray(exported.inject))
      assert.ok([...exported.inject].includes('slots'))
      assert.deepEqual([...Object.keys(exported)].sort(), ['apply', 'inject'])
    })

    it('所有 require("…") 的参数都在宿主基线模块表里，factory 运行期也只取基线名', () => {
      const requiredInText = [...evaluated.code.matchAll(/\brequire\(\s*(["'`])([^"'`]+)\1\s*\)/g)].map(
        (match) => match[2],
      )
      for (const id of requiredInText) {
        assert.ok(CLIENT_BASELINE.includes(id), `bundle 文本 require 了非基线模块 ${id}`)
      }
      for (const id of evaluated.requested) {
        assert.ok(CLIENT_BASELINE.includes(id), `factory 运行期 require 了非基线模块 ${id}`)
      }
    })
  })

  describe('e. 客户端只读根 Context 的 slots，并注册 main 面板与侧栏入口', () => {
    let registrations
    let injectedNames

    before(async () => {
      const { exported } = await evaluateClientBundle(path.join(packageDir, 'lib/client.js'))
      const exposed = new Set([...exported.inject])
      registrations = []
      injectedNames = []

      const slots = {
        inject(name, callback) {
          injectedNames.push(name)
          callback()
        },
        register(options, component) {
          registrations.push({ options: { ...options }, component })
        },
      }
      // 复刻 M17：根 Context 只暴露模块级 `inject` 声明过的服务，读别的属性就抛错。
      const ctx = new Proxy(
        {},
        {
          get(_target, property) {
            if (typeof property === 'symbol') return undefined
            if (property === 'slots' && exposed.has('slots')) return slots
            throw new Error(`cannot get property "${String(property)}" without inject`)
          },
        },
      )
      exported.apply(ctx)
    })

    it('slots.inject 的名字恰好是 main 与 sidebar.panellist', () => {
      assert.deepEqual([...injectedNames].sort(), ['main', 'sidebar.panellist'])
      assert.equal(registrations.length, 2)
    })

    it('main 注册的选项是 { name, key }，key 为 harness-projects', () => {
      const main = registrations.find((entry) => entry.options.name === 'main')
      assert.ok(main, '没有 main 注册')
      assert.deepEqual(main.options, { name: 'main', key: PANEL_ID })
    })

    it('sidebar.panellist 的 id 等于 main 的 key，label 是可访问名称 Harness Projects', () => {
      const entry = registrations.find((item) => item.options.name === 'sidebar.panellist')
      assert.ok(entry, '没有 sidebar.panellist 注册')
      assert.equal(entry.options.id, PANEL_ID)
      assert.equal(entry.options.label, PANEL_TITLE)
      assert.equal(typeof entry.options.order, 'number')
    })

    it('main 的面板组件渲染 section[aria-label=Harness Projects]，标题为 h2；入口图标是 aria-hidden 的 svg', () => {
      const main = registrations.find((entry) => entry.options.name === 'main')
      const panel = main.component()
      assert.equal(panel.type, 'section')
      assert.equal(panel.props['aria-label'], PANEL_TITLE)
      const heading = panel.children.find((child) => child && child.type === 'h2')
      assert.ok(heading, '面板里没有 h2 标题')
      assert.ok(heading.children.includes(PANEL_TITLE))

      const icon = registrations.find((entry) => entry.options.name === 'sidebar.panellist').component()
      assert.equal(icon.type, 'svg')
      assert.equal(String(icon.props['aria-hidden']), 'true')
    })
  })

  describe('f. 构建只读本仓库且产物里没有本机路径', () => {
    it('两份 metafile 的每个 input 都是不以 .. 开头的相对路径', () => {
      for (const which of ['host', 'client']) {
        const inputs = Object.keys(result.metafiles[which].inputs)
        assert.ok(inputs.length > 0, `${which} metafile 没有 input`)
        for (const input of inputs) {
          assert.equal(path.isAbsolute(input), false, `${which} input 是绝对路径：${input}`)
          assert.equal(input.startsWith('..'), false, `${which} input 走出了仓库：${input}`)
        }
      }
    })

    it('产物文本与安装件 manifest 不含仓库根、临时构建目录与家目录的路径，也没有 source map', async () => {
      const roots = new Set([repoRoot, await realpath(repoRoot), outDir, await realpath(outDir)])
      const home = os.homedir()
      if (home.length > 1) roots.add(home)

      const files = await listFiles(packageDir)
      assert.equal(
        files.some((file) => file.endsWith('.map')),
        false,
        '安装件不应带 source map',
      )
      for (const file of files) {
        const text = await readFile(path.join(packageDir, file), 'utf8')
        assert.equal(text.includes('sourceMappingURL'), false, `${file} 含 sourceMappingURL`)
        for (const root of roots) {
          assert.equal(text.includes(root), false, `${file} 含本机路径 ${root}`)
        }
      }
    })
  })
})
