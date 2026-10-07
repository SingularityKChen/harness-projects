/**
 * 完整浏览器路径契约（issue #130）：esbuild 以 platform=browser 打包真实 adapter→投影→组合页，只外置 react；
 * 入口必须真调用归约路径，产物在隔离 vm 执行后做真实 SSR。焦点/showModal/真实 history 由 fixture 真实浏览器验。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { NEGATIVE_ENTRY, buildBundle, startServer } from '../fixtures/work-item-detail-browser.mjs'

// React 从 ui 的 manifest 解析：vm 里执行的产物必须与测试用同一个副本。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const uiRequire = createRequire(path.join(repoRoot, 'packages/ui/package.json'))
const React = uiRequire('react')
const ALLOWED = /^packages\/(domain|ui-model|ui)\/src\/(?!ids\.ts|identity\.ts)|^packages\/(capabilities\/src\/capability-keys|controller\/src\/keys|client\/src\/keys)\.ts$|^apps\/web\/src\/(item-route|index)\.ts$/
const REQUIRED = ['apps/web/src/item-route.ts', 'apps/web/src/index.ts', 'packages/ui-model/src/work-item-detail-view.ts', 'packages/ui-model/src/work-item-list-view.ts', 'packages/ui/src/work-item-project.ts', 'packages/ui/src/work-item-detail.ts', 'packages/ui/src/work-item-list.ts']

test('完整路径：meta 触达 adapter → 投影 → 组合页，只外置 react，禁止 node:* 与 core/controller/client 运行时', async () => {
  const result = await buildBundle()
  const [output] = Object.values(result.metafile.outputs)
  assert.deepEqual([...new Set(output.imports.filter((entry) => entry.external).map((entry) => entry.path))], ['react'])
  const inputs = Object.keys(result.metafile.inputs).filter((file) => file !== '<stdin>')
  assert.ok(inputs.every((file) => ALLOWED.test(file)), `输入必须只落在 domain / ui-model / ui / apps-web 与能力 key 纯值叶子：${inputs}`)
  for (const file of REQUIRED) assert.ok(inputs.includes(file), file)
  assert.match(result.outputFiles[0].text, /function mount\(element, port = browserHistoryPort\(\)/, 'fixture 的浏览器 mount 默认必须用产品 browserHistoryPort，而不是手写 port')
  const negative = await buildBundle(NEGATIVE_ENTRY).then(() => undefined, (error) => String(error.message ?? error))
  assert.match(negative ?? '', /node:crypto/, 'domain 根出口的 node:crypto 必须不可解析，不能靠外置 node:* 掩盖')
})

test('vm SSR 正控：产物在隔离 vm 里执行，标题非空、来源与派生前缀存在、遮蔽场景无 canary 且无写控件', async () => {
  const result = await buildBundle()
  const sandbox = { module: { exports: {} }, require: (id) => (id === 'react' ? React : assert.fail(`意外的 require：${id}`)), ReactDOMServer: uiRequire('react-dom/server'), ReactDOMClient: uiRequire('react-dom/client') }
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  const { renderStatic } = sandbox.module.exports
  const html = renderStatic('content')
  for (const expected of ['<h2', 'Fixture 详情标题', '正文-ent-aa', '来源一', '派生提示：']) assert.ok(html.includes(expected), expected)
  for (const forbidden of ['<input', '<select', '<textarea', '编辑', 'Saved', 'StartWork']) assert.ok(!html.includes(forbidden), forbidden)
  assert.ok(html.includes('<a href="/projects/ws-1/items/ent-aa">Fixture 详情标题</a>'), 'bundle 内组合页带 navigation 时 visible 行生成 canonical href；无需转义的 id 分不出是否经 codec，codec 判别在 canonical-open-close-idempotent')

  assert.match(renderStatic('redacted'), /<dialog[^]*<p>内容不可见<\/p>/, 'redacted 场景的详情 dialog 处于遮蔽态：fixture 的遮蔽条目与场景目标脱钩（退化为 missing）时不得空绿')
  for (const name of ['redacted', 'loading', 'offline', 'missing', 'denied']) {
    const shown = renderStatic(name)
    assert.ok(shown.includes('<h2'), `${name} 仍渲染工作项项目页`)
    for (const canary of ['CANARY-TITLE', 'CANARY-BODY', 'CANARY-REASON', 'ent-bb']) assert.ok(!shown.includes(canary), `${name}: ${canary}`)
  }
  assert.ok(renderStatic('scoped', '/projects/ws-2/items').includes('<a href="/projects/ws-2/items/ent-aa">'), '通过 scope 门时 href 用路由里通过门的 projectId，不写死工作区')
  for (const [name, pathname] of [['content', '/projects/ws-9/items'], ['content', '/projects/ws-1/items/a%2Fb'], ['scoped', '/projects/ws-1/items/ent-aa']]) {
    assert.equal(renderStatic(name, pathname), '<p>当前快照未找到此条目，是否存在尚未确认</p>', `${name} @ ${pathname}：经同一个 mount，未知路由与跨 scope 只显示中性 unresolved，不绑定当前 store、不生成 href、不回显路由`)
  }
})

test('同源 HTTP：两个 canonical pathname 与深链都交给同一入口，刷新可用；负控入口不产出可运行 bundle', async () => {
  const fixture = await startServer()
  try {
    const get = async (pathname) => {
      const response = await fetch(`${fixture.url}${pathname}`)
      return { status: response.status, html: await response.text() }
    }
    const list = await get('/projects/ws-1/items')
    const detail = await get('/projects/ws-1/items/ent-aa')
    assert.deepEqual([list.status, detail.status], [200, 200])
    assert.equal(list.html, detail.html, '两个 pathname 交给同一个入口页，由客户端 adapter 解析路径')
    assert.match(list.html, /<script src="\/bundle\.js"><\/script>\n<script>window\.__fixture = module\.exports\.mount\(document\.getElementById\('app'\)\)\n/, '入口页只以元素调用 mount，不得另传手写 port 绕过产品 browserHistoryPort')
    assert.match(list.html, /window\.ReactDOMClient = window\.ReactDOM/, 'P0：react-dom@18 的 client UMD 只装 window.ReactDOM，入口页必须补别名')
    assert.equal((await get('/nowhere')).status, 404)
    const bundle = await fetch(`${fixture.url}/bundle.js`)
    assert.equal(bundle.status, 200)
    const text = await bundle.text()
    assert.match(text, /ReactDOMClient \?\? .*ReactDOM\)\.createRoot/, 'mount 必须容忍只装 ReactDOM 的 UMD')
    for (const forbidden of ['require("node:', 'from"node:', 'node:crypto']) assert.ok(!text.includes(forbidden), forbidden)
  } finally {
    await fixture.close()
  }
})
