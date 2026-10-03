/**
 * 工作项列表的完整浏览器路径（issue #129）：esbuild 以 platform=browser 打包「既有列表派生 → 新页面投影 → renderer」整条路径，
 * 只外置 react。只打包接受 type-only view 的 renderer 会漏掉实际归约路径（类型在构建时被擦除），所以入口必须真调用它们，
 * 并在隔离 vm 里执行产物再做真实 SSR。它不证明真实 DOM 或真实 Host 装配（client.store 与 transport 由 #178 / #229 验证）。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// 构建器与 React 各自从所属 manifest 解析：esbuild 来自插件壳，React / ReactDOM 来自 ui，测试与产物必须是同一个 React 副本。
const { build } = createRequire(path.join(repoRoot, 'apps/harness-plugin/package.json'))('esbuild')
const uiRequire = createRequire(path.join(repoRoot, 'packages/ui/package.json'))
const React = uiRequire('react')
const { renderToStaticMarkup } = uiRequire('react-dom/server')

const ENTRY = `
import { createElement } from 'react'
import { deriveWorkItemList, deriveWorkItemListView } from '@harness-projects/ui-model'
import { WorkItemListPage } from '@harness-projects/ui'
export { deriveWorkItemList }
export const Page = (input) => createElement(WorkItemListPage, { view: deriveWorkItemListView(input) })
`
const bundle = (contents) => build({
  stdin: { contents, resolveDir: repoRoot, loader: 'js' }, absWorkingDir: repoRoot,
  bundle: true, platform: 'browser', format: 'cjs', write: false, metafile: true, external: ['react'], logLevel: 'silent',
})

/** 只读 EntityStore 的 fixture：列表派生只用 `list()`；不构造 client.store，也不搬真实 transport。 */
const entity = {
  entityId: 'ent-aa', kind: 'work_item', planningStatus: 'todo', derived: [],
  content: { contentKind: 'work_item', title: 'Browser Visible', body: 'b', bindingId: 'bind-1', externalKind: 'issue', externalId: '7' },
  source: { revision: 1, freshness: 'fresh', authority: 'provider', reason: undefined },
}
const read = {
  workspace: { id: 'ws-1', name: '浏览器工作区' }, connection: { connected: true }, lastUpdatedAt: '2026-10-01T08:00:00.000Z',
  store: { revision: 1, list: () => [{ entityId: 'ent-aa', entity, revision: 1, stale: false }] },
  capabilities: [{ key: 'planning.item.read', access: 'available' }],
}

test('完整路径：meta 触达 derive → page view → renderer → 纯值 leaf，只外置 react，产物在 vm 里执行出真实 HTML', async () => {
  const result = await bundle(ENTRY)
  const [output] = Object.values(result.metafile.outputs)
  assert.deepEqual([...new Set(output.imports.filter((entry) => entry.external).map((entry) => entry.path))], ['react'])
  const inputs = Object.keys(result.metafile.inputs).filter((file) => file !== '<stdin>')
  assert.ok(inputs.every((file) => /^packages\/(domain|ui-model|ui)\/src\/(?!ids\.ts|identity\.ts)/.test(file)), `输入必须落在当前工作树的这三个包内：${inputs}`)
  for (const file of ['ui-model/src/derive.ts', 'ui-model/src/work-item-list-view.ts', 'ui/src/work-item-list.ts', 'domain/src/browser-values.ts']) {
    assert.ok(inputs.includes(`packages/${file}`), file)
  }
  const sandbox = { module: { exports: {} }, require: (id) => (id === 'react' ? React : assert.fail(`意外的 require：${id}`)) }
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  const { Page, deriveWorkItemList } = sandbox.module.exports
  const props = { read, metadata: { sourceNames: { 'bind-1': '来源一' } }, phase: 'received', refreshing: false }
  assert.equal(deriveWorkItemList(read).rows.length, 1)
  const html = renderToStaticMarkup(React.createElement(Page, props))
  assert.match(html, /<h2>浏览器工作区<\/h2>/)
  assert.match(html, /<th scope="row"[^>]*>Browser Visible<\/th>/)
  assert.match(html, /来源一（提供方权威）/)
})

test('负控：入口经 domain 根出口取运行时值时构建失败（node:crypto 不可解析），不能靠外置 node:* 掩盖', async () => {
  await assert.rejects(bundle("import { newEntityId } from '@harness-projects/domain'\nexport const id = newEntityId"), /node:crypto/)
})
