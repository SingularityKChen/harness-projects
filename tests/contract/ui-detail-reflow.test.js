/** 实际入口装配契约；几何判据由同一 fixture 的真实浏览器 probe 执行。 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import { buildWorkspaceFrameBundle } from '../fixtures/workspace-frame-browser.mjs'

const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))

async function fixtureExports() {
  const result = await buildWorkspaceFrameBundle()
  const sandbox = { module: { exports: {} }, require: (id) => id === 'react' ? uiRequire('react') : assert.fail(id),
    window: { ReactDOMServer: uiRequire('react-dom/server') } }
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  return { result, fixture: sandbox.module.exports }
}

// 将 fixture 偷换为孤立 ProjectPage 会丢失真实 App 最后装配的 shared styles 与 client store 管线。
test('reflow fixture 经真实 WorkItemApp/store 投影装配原生详情和完整标题', async () => {
  const { result, fixture } = await fixtureExports()
  for (const input of ['packages/ui/src/work-item-app.ts', 'packages/client/src/store.ts', 'packages/ui-model/src/work-item-detail-view.ts']) {
    assert.ok(Object.keys(result.metafile.inputs).includes(input), `真实入口依赖：${input}`)
  }
  const out = fixture.renderStatic('long')
  const dialog = out.match(/<dialog\b([^>]*)>([^]*?)<\/dialog>/)
  assert.ok(dialog, '真实 App 详情路由有原生 dialog')
  const labelledBy = dialog[1].match(/aria-labelledby="([^"]+)"/)?.[1]
  assert.ok(labelledBy, 'dialog 使用标题提供 accessible name')
  const title = dialog[2].match(/<h2\b([^>]*)>([^]*?)<\/h2>/)
  assert.ok(title, 'dialog 保留可见标题 heading')
  assert.equal(title[1].match(/(?:^|\s)id="([^"]+)"/)?.[1], labelledBy, 'accessible name 指向该标题')
  assert.match(title[1], /(?:^|\s)tabindex="-1"/, '初始焦点保留在 labelled title')
  assert.ok(dialog[2].includes('长标题无空格Title'.repeat(24)), '长标题完整保留，不截断 DOM/accessible name')
  assert.match(dialog[2], /<button[^>]*type="button"[^>]*>关闭详情<\/button>/, '可见的文字关闭操作保留原生 button')
  assert.match(dialog[2], /class="hp-detail-body"/, '正文保留独立容器')
  assert.ok(out.indexOf('<a href="#/projects/ws-1/items/ent-aa"') < out.indexOf('<dialog'), '真实列表 opener 与详情共存')
})

// 复用首轮真实640×320/root30量测：60px正文全是padding，不能因clientHeight>0而通过。
test('reflow probe rejects padding-only body and requires a reachable outer scroll path', async () => {
  const { fixture } = await fixtureExports()
  const box = (top, height, extra = {}) => ({ left: 1, right: 279, width: 278, top, bottom: top + height, height,
    clientWidth: 278, scrollWidth: 278, clientHeight: height, scrollHeight: height, scrollTop: 0,
    padding: [0, 0, 0, 0], lineHeight: 48, overflowY: 'hidden', ...extra })
  const report = { dialog: box(30, 290, { clientHeight: 288, scrollHeight: 308 }), header: box(31, 249), headerContentWidth: 218,
    title: box(61, 96, { width: 218 }), close: box(172, 77, { left: 110, width: 167, right: 277 }),
    body: box(280, 60, { padding: [30, 30, 30, 30], scrollHeight: 5000 }), bodyActionHeight: 77,
    viewport: { width: 640, height: 320 }, documentOverflow: false }
  const failures = (value) => Array.from(fixture.detailReflowFailures(value))
  assert.deepEqual(failures(report), ['body escapes dialog', 'body lacks a complete content row'])
  const reachable = { ...report, dialog: { ...report.dialog, overflowY: 'auto', scrollHeight: 400 },
    body: { ...report.body, height: 150, bottom: 430, clientHeight: 150 } }
  assert.deepEqual(failures(reachable), [], '完整行和动作可在整体滚动后进入视口')
  assert.deepEqual(failures({ ...reachable, dialog: { ...reachable.dialog, overflowY: 'hidden' } }), ['body escapes dialog'])
  assert.deepEqual(failures({ ...reachable, body: report.body }), ['body lacks a complete content row'])
})
