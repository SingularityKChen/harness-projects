import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startWorkspaceFrameServer } from '../fixtures/workspace-frame-browser.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { build } = createRequire(new URL('../../apps/harness-plugin/package.json', import.meta.url))('esbuild')
// Real project/drawer/business components; adapters replace only the external async boundary.
const ENTRY = `
import { createElement as h, useState } from 'react'
import { createEntityStore } from '@harness-projects/client'
import { WorkItemProjectPage } from '@harness-projects/ui'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'
import { wire, T } from './tests/fixtures/work-item-wire.mjs'
const store = createEntityStore()
const text = Array.from({length:180}, (_, i) => 'Reading paragraph '+i+' '+ 'readable words '.repeat(12)).join('\\n')
store.applyBaseline({revision:0, entities:[wire('ent-aa',{content:{title:'LongTitle'.repeat(35),body:text}})],source:{revision:0,freshness:'fresh',authority:'provider'}})
const input = {read:{workspace:{id:'ws-1',name:'Fixture workspace'},store,connection:{connected:true},lastUpdatedAt:T,
 repositories:[{id:'repo-alpha',capabilities:[]}],capabilities:[{key:'planning.item.read',access:'available'}]},metadata:{planningSourceName:'Fixture source',sourceNames:{'bind-1':'Fixture source'}},phase:'received',refreshing:false}
const listView = deriveWorkItemListView(input)
let detailView = deriveWorkItemDetailView(input,{projectId:'ws-1',itemId:'ent-aa'})
detailView = {body:{...detailView.body,startWorkRepositories:[{id:'repo-alpha',available:true,access:'available'}]}}
const calls = {read:0,deliveryRead:0,deliveryRefresh:0,options:0,write:0,refresh:0,close:0}
let resolve, updateBody
const executionReader = Object.assign(async () => {calls.read++;return null},{refresh:async()=>{calls.refresh++}})
const deliveryReader = {refresh:async()=>{calls.deliveryRefresh++},read:async scope=>{calls.deliveryRead++;return {...scope,now:T,projection:{workItemId:'ent-aa',repositoryId:'repo-alpha',hops:[],gaps:[],optional:[],freshness:[],degraded:false}}}}
const startWork = {options:async()=>{calls.options++;return {workspaceId:'ws-1',workItemId:'ent-aa',executionMode:'manual',repositories:[{id:'repo-alpha',available:true,access:'available'}]}},
 submit:async()=>{calls.write++;return new Promise(done=>{resolve=()=>done({writeState:'confirmed',saving:false,authoritative:true,value:{executionContextId:'fixture',status:'ready',degraded:false}})})}}
const refresh = {pending:false,disabled:false,run:()=>{calls.refresh++}}
function App() {
 const [open,setOpen] = useState(false)
 const [,setContentVersion] = useState(0); updateBody = () => setContentVersion(value => value + 1)
 const navigate = value => {history.pushState(null,'',value?'/projects/ws-1/items/ent-aa':'/projects/ws-1/items');setOpen(value)}
 return h(WorkItemProjectPage,{listView,detailView:open?detailView:undefined,connected:true,executionReader,deliveryReader,startWork,refresh,
 navigation:{href:()=>'/projects/ws-1/items/ent-aa',open:()=>navigate(true)},onCloseDetail:()=>{calls.close++;navigate(false)}})
}
window.fixture = {calls,release:()=>resolve(),shorten:()=>{detailView={body:{...detailView.body,body:'short'}};updateBody()},
 mark:()=>{const dialog=document.querySelector('dialog'),body=dialog.querySelector('.hp-detail-body'),sections=[...body.querySelectorAll('section')];
  let changes=0;const observer=new MutationObserver(records=>{for(const record of records)for(const node of [...record.addedNodes,...record.removedNodes])if(sections.some(section=>node===section||node.contains?.(section)))changes++});observer.observe(body,{childList:true,subtree:true});
  return window.fixture.same=()=>({dialog:document.querySelector('dialog')===dialog,body:dialog.querySelector('.hp-detail-body')===body,sections:sections.every(section=>section.isConnected&&body.contains(section)),changes})}}
window.ReactDOM.createRoot(document.getElementById('app')).render(h(App))
`

async function startFixture() {
  const vendor = (id, file) => readFile(path.join(path.dirname(uiRequire.resolve(id)), 'umd', file), 'utf8')
  const [bundle, react, reactDOM, jsx] = await Promise.all([
    build({ stdin: { contents: ENTRY, resolveDir: repoRoot }, absWorkingDir: repoRoot, bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' }),
    vendor('react', 'react.development.js'), vendor('react-dom/client', 'react-dom.development.js'),
    build({ entryPoints: [uiRequire.resolve('react/jsx-runtime')], bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' }),
  ])
  const jsxScript = `(function(){const module={exports:{}};const exports=module.exports;const require=id=>{if(id==='react')return window.React;throw Error(id)};${jsx.outputFiles[0].text}\nwindow.ReactJSX=module.exports;})()`
  const scripts = { '/bundle.js': bundle.outputFiles[0].text, '/react.js': react, '/react-dom.js': reactDOM, '/jsx-runtime.js': jsxScript }
  const server = createServer((request, response) => {
    const script = scripts[request.url]
    response.setHeader('content-type', script ? 'text/javascript' : 'text/html; charset=utf-8')
    response.end(script ?? `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      :root{font:16px/1.5 system-ui;color-scheme:light dark}html,body{margin:0}#app{position:fixed;left:72px;right:20px;top:48px;bottom:20px}
      #app>.hp-project{height:100%;min-height:0}@media(max-width:639px){#app{left:24px;right:8px}}
      </style><div id="app"></div><script src="/react.js"></script><script src="/jsx-runtime.js"></script><script src="/react-dom.js"></script>
      <script>window.require=id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return window.ReactJSX;throw Error(id)};var module={exports:{}}</script><script src="/bundle.js"></script></html>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

async function scenario(t, run) {
  const server = await startFixture(); t.after(() => server.close())
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.dialogCalls = { open: 0, close: 0 }
    for (const [method, key] of [['showModal', 'open'], ['close', 'close']]) {
      const run = HTMLDialogElement.prototype[method]
      HTMLDialogElement.prototype[method] = function (...args) { window.dialogCalls[key]++; return run.apply(this, args) }
    }
  })
  await page.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort())
  await page.goto(server.url + '/projects/ws-1/items')
  await page.getByRole('link').click()
  await page.getByRole('dialog').waitFor()
  await page.waitForFunction(() => window.fixture.calls.deliveryRead === 1 && window.fixture.calls.read === 1)
  await run(page)
  assert.deepEqual(errors, [])
}
const toggle = (page, expanded) => page.getByRole('button', { name: expanded ? '还原详情' : '展开详情', exact: true })
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

// Catches replacing the dialog/business subtree, resetting drafts/pending, reading on toggle, or refocusing title.
test('expand keeps the mounted detail, draft, pending operation, route and focus contract', async t => {
  await scenario(t, async page => {
    const dialog = page.getByRole('dialog'), start = dialog.getByRole('region', { name: '开始工作', exact: true })
    await start.getByRole('button', { name: '开始工作', exact: true }).click()
    await dialog.getByLabel('已绑定仓库').selectOption('repo-alpha')
    await dialog.getByLabel('分支名（可留空）').fill('feature/kept-draft')
    await dialog.getByLabel('执行任务', { exact: true }).fill('Synthetic explicit expand task')
    await start.getByRole('button', { name: '提交开始工作', exact: true }).click()
    await start.getByRole('button', { name: '正在提交', exact: true }).waitFor()
    await page.evaluate(() => window.fixture.mark())
    const before = await page.evaluate(() => ({ calls: { ...window.fixture.calls }, route: location.pathname }))
    for (const expanded of [false, true, false, true]) {
      await toggle(page, expanded).click(); await settle(page)
      assert.equal(await toggle(page, !expanded).evaluate(el => el === document.activeElement), true)
      assert.equal(await dialog.getByLabel('分支名（可留空）').inputValue(), 'feature/kept-draft')
      assert.equal(await start.getByRole('button', { name: '正在提交', exact: true }).isDisabled(), true)
      assert.deepEqual(await page.evaluate(() => window.fixture.same()), { dialog: true, body: true, sections: true, changes: 0 })
      assert.deepEqual(await page.evaluate(() => ({ calls: { ...window.fixture.calls }, route: location.pathname })), before)
      assert.match(await toggle(page, !expanded).getAttribute('aria-describedby'), /.+/)
      assert.equal(await toggle(page, !expanded).getAttribute('aria-expanded'), null)
      assert.equal(await dialog.getByText(expanded ? '当前为预览模式' : '当前为展开模式', { exact: true }).isVisible(), true)
      assert.deepEqual(await page.evaluate(() => window.dialogCalls), { open: 1, close: 0 })
    }
    await page.evaluate(() => window.fixture.release())
    await start.getByText('开始工作已确认', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.same()), { dialog: true, body: true, sections: true, changes: 0 })
    assert.equal(await dialog.getByLabel('分支名（可留空）').inputValue(), 'feature/kept-draft')
    const last = dialog.getByRole('button', { name: '收起表单', exact: true })
    await last.focus(); await page.keyboard.press('Tab')
    assert.equal(await toggle(page, false).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Shift+Tab'); assert.equal(await last.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.fixture.calls.close), 1)
    assert.equal(await page.getByRole('link').evaluate(el => el === document.activeElement), true)
    assert.equal(new URL(page.url()).pathname, '/projects/ws-1/items')
  })
})

// Keeps the established App/style-order/short-height probe measuring the actual close action.
test('existing App reflow probe retains close and complete-row acceptance with both header actions', async t => {
  const server = await startWorkspaceFrameServer(); t.after(() => server.close())
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage()
  for (const theme of ['light', 'dark']) for (const font of [100, 200]) for (const width of [1440, 1200, 1024, 640, 320]) {
    await page.setViewportSize({ width, height: width === 640 ? 320 : 900 })
    await page.goto(server.url + `/?scenario=long&detail=1&theme=${theme}&font=${font}`)
    await page.locator('dialog[open]').waitFor()
    await settle(page)
    const report = JSON.parse(await page.locator('#detail-reflow-report').textContent())
    assert.deepEqual(report.failures, [], JSON.stringify({ theme, font, width, report }))
    const close = page.getByRole('button', { name: '关闭详情', exact: true })
    assert.ok(Math.abs(report.close.width - (await close.boundingBox()).width) < 1)
    await close.focus(); await close.scrollIntoViewIfNeeded()
    const box = await close.boundingBox()
    assert.ok(box.y >= report.dialog.top && box.y + box.height <= report.dialog.bottom + 1)
    await close.click(); await page.locator('dialog').waitFor({ state: 'detached' })
  }
})

// Catches the installed-Host regression: a target mode's old zero must not override new reading progress.
test('expand and restore preserve current reading progress instead of old mode offsets', async t => {
  await scenario(t, async page => {
    await page.setViewportSize({ width: 640, height: 480 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const body = page.locator('.hp-detail-body')
    assert.equal(await body.evaluate(el => el.scrollTop), 0)
    await toggle(page, false).click(); await settle(page)
    await body.getByRole('button', { name: '刷新规划', exact: true }).click()
    await page.keyboard.press('PageDown')
    await page.waitForFunction(() => document.querySelector('.hp-detail-body').scrollTop > 0)
    // Wait for the keyboard scroll to finish, so toggle captures the actual current offset.
    const read = await body.evaluate(el => new Promise(resolve => {
      let previous = -1, stable = 0
      const frame = () => { const top = el.scrollTop; stable = top === previous ? stable + 1 : 0; previous = top; if (stable === 3) resolve(top); else requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
    }))
    await toggle(page, true).click(); await settle(page)
    assert.ok(await body.evaluate((el, top) => el.scrollHeight - el.clientHeight >= top, read), 'destination can retain the current reading offset without a physical clamp')
    assert.equal(await body.evaluate(el => el.scrollTop), read, 'preview0 → expanded PageDown N → restore keeps N when reachable')
    await body.evaluate(el => { el.scrollTop = 620 })
    await toggle(page, false).click(); await settle(page)
    assert.equal(await body.evaluate(el => el.scrollTop), 620, 'new preview progress wins over the old expanded offset')
  })
})

// Content shortening permits only a physical clamp to the new legal range, in either direction.
test('current reading offset clamps only when the destination range is shorter', async t => {
  await scenario(t, async page => {
    const body = page.locator('.hp-detail-body')
    await body.evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight })
    const previous = await body.evaluate(el => el.scrollTop)
    assert.ok(previous > 1000)
    await page.evaluate(() => window.fixture.shorten())
    await body.getByText('short', { exact: true }).waitFor({ state: 'attached' })
    const current = await body.evaluate(el => el.scrollTop)
    assert.ok(current < previous, 'shortened content physically clamps the source range')
    await toggle(page, false).click(); await settle(page)
    const expanded = await body.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }))
    assert.ok(expanded.max < current, 'expansion must reduce the reachable range for this clamp fixture')
    assert.equal(expanded.top, Math.min(current, expanded.max))
    await toggle(page, true).click(); await settle(page)
    const preview = await body.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }))
    assert.equal(preview.top, Math.min(expanded.top, preview.max), 'restoring carries the current clamped offset, without resurrecting history')
  })
})

// Catches viewport geometry covering Host navigation, fixed preview width, inaccessible actions, and mode reset on resize.
test('preview and expanded fit the clipped Host rectangle across widths, short height and text zoom', async t => {
  await scenario(t, async page => {
    for (const font of [16, 32]) for (const width of [1440, 1200, 1024, 640, 320]) {
      await page.setViewportSize({ width, height: width === 640 ? 320 : 900 })
      await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px' }, font)
      for (const expanded of [false, true]) {
        await settle(page)
        const report = await page.evaluate(() => {
          const dialog = document.querySelector('dialog'), root = document.querySelector('.hp-project'), body = dialog.querySelector('.hp-detail-body')
          const rect = el => { const r = el.getBoundingClientRect(); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height } }
          return { dialog:rect(dialog), root:rect(root), mode:dialog.dataset.detailMode,
            actions:[...dialog.querySelectorAll('header button')].map(rect),
            bodyRoom:body.clientHeight-parseFloat(getComputedStyle(body).paddingTop)-parseFloat(getComputedStyle(body).paddingBottom),
            line:parseFloat(getComputedStyle(body).lineHeight), outerScroll:dialog.scrollHeight>dialog.clientHeight,
            reserve:parseFloat(getComputedStyle(document.querySelector('.hp-project-list')).paddingRight) }
        })
        const label = JSON.stringify({ font, width, expanded, report })
        assert.equal(report.mode, expanded ? 'expanded' : 'preview', label)
        assert.ok(Math.abs(report.dialog.top - report.root.top) < 1 && Math.abs(report.dialog.bottom - report.root.bottom) < 1, label)
        assert.ok(report.dialog.left >= report.root.left && report.dialog.right <= report.root.right + 1, label)
        const previewWidth = Math.min(report.root.width, Math.max(22 * font, Math.min(.38 * report.root.width, 36.428571 * font)))
        assert.ok(Math.abs(report.dialog.width - (expanded ? report.root.width : previewWidth)) < 1, label)
        assert.ok(report.bodyRoom >= report.line, label)
        for (const action of report.actions) assert.ok(action.left >= report.dialog.left && action.right <= report.dialog.right + 1 && action.width >= 44 && action.height >= 44, label)
        assert.equal(report.actions.length, 2)
        if (report.root.width >= 1200 && !expanded) assert.ok(Math.abs(report.reserve - previewWidth - font) < 1, label)
        else assert.equal(report.reserve, 0, label)
        for (const action of ['展开详情', '关闭详情']) if (!expanded) {
          const button = page.getByRole('button', { name: action, exact: true })
          await button.focus(); await button.scrollIntoViewIfNeeded()
          const box = await button.boundingBox()
          assert.ok(box.y >= report.dialog.top && box.y + box.height <= report.dialog.bottom + 1, label)
        }
        await toggle(page, expanded).click()
      }
    }
    await toggle(page, false).click()
    await page.setViewportSize({ width: 640, height: 480 })
    await page.evaluate(() => {
      Object.assign(document.getElementById('app').style, { position: 'absolute', left: '-20px', top: '48px', width: '460px', height: '700px', right: 'auto', bottom: 'auto' })
      document.body.style.height = '1600px'
      window.scrollTo(0, 100)
    })
    await settle(page)
    assert.deepEqual(await page.getByRole('dialog').evaluate(el => {
      const r = el.getBoundingClientRect()
      return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,mode:el.dataset.detailMode }
    }), { left:0,top:0,right:440,bottom:480,mode:'expanded' }, 'Host scroll/resize clips all four edges without resetting expanded mode')
  })
})

// Catches detached number/status hierarchy and metadata flattened into unlabelled prose.
test('safe detail header keeps source number, title and native planning status before semantic metadata', async t => {
  const server = await startWorkspaceFrameServer(); t.after(() => server.close())
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(server.url + '/?scenario=reference&detail=1&roles=reference')
  const dialog = page.getByRole('dialog'); await dialog.waitFor()
  const header = dialog.locator('.hp-detail-header')
  assert.match(await header.textContent(), /GitHub.*example\/project.*604.*统一工作区.*进行中/s)
  assert.equal(await dialog.locator('dl dt').filter({ hasText: '迭代：' }).count(), 1)
  assert.equal(await dialog.locator('dl dd').filter({ hasText: '现代看板' }).count(), 1)
  assert.equal(await dialog.locator('h2').count(), 1)
  const type = await dialog.locator('.hp-detail-title').evaluate(el => { const s = getComputedStyle(el); return [s.fontSize, s.lineHeight] })
  assert.equal(type[0], '22px'); assert.ok(Math.abs(parseFloat(type[1]) - 30) < .01)
  assert.ok(Math.abs((await dialog.boundingBox()).width - 510) < 1)
})

async function narrowReference(t, check) {
  const server = await startWorkspaceFrameServer(); t.after(() => server.close())
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage()
  for (const [font, width] of [[28, 320], [30, 320], [14, 390]]) for (const height of [900, 320]) {
    await page.setViewportSize({ width, height })
    await page.goto(server.url + '/?scenario=reference&detail=1&roles=reference&font=200')
    await page.getByRole('dialog').waitFor()
    await page.evaluate(size => { document.documentElement.style.fontSize = size + 'px' }, font)
    for (const expanded of [false, true]) {
      await settle(page); await check(page, { font, width, height, expanded })
      await toggle(page, expanded).click()
    }
  }
}

test('narrow 200% safe source number retains a readable line before the title', async t => {
  await narrowReference(t, async (page, scene) => {
    const number = await page.locator('.hp-detail-number').evaluate(el => {
      const header = el.closest('header'), css = getComputedStyle(header), text = getComputedStyle(el)
      return { width: el.clientWidth, height: el.clientHeight, line: parseFloat(text.lineHeight), available: header.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) }
    })
    assert.ok(number.width >= Math.min(160, number.available) - 1, JSON.stringify({ scene, number }))
    assert.ok(number.height <= 6 * number.line, JSON.stringify({ scene, number }))
  })
})

test('narrow 200% semantic metadata keeps every value readable without escaping glyphs', async t => {
  await narrowReference(t, async (page, scene) => {
    const report = await page.locator('.hp-detail-body').evaluate(body => {
      const css = getComputedStyle(body)
      return { available: body.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
        values: [...body.querySelectorAll('dl dd')].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, line: parseFloat(getComputedStyle(el).lineHeight), top: el.getBoundingClientRect().top, labelTop: el.previousElementSibling.getBoundingClientRect().top })) }
    })
    assert.equal(report.values.length, 6)
    for (const value of report.values) {
      if (scene.font === 14) assert.ok(Math.abs(value.top - value.labelTop) < 1, 'normal 390px keeps readable metadata columns')
      assert.ok(value.width >= Math.min(160, report.available) - 1, JSON.stringify({ scene, report }))
      assert.ok(value.scroll <= value.width + 1 && value.height <= 12 * value.line, JSON.stringify({ scene, value }))
    }
  })
})
