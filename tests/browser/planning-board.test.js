import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'
import { startTableGeometryServer } from '../fixtures/table-geometry-browser.mjs'

const output = process.env.PLANNING_BOARD_EVIDENCE_OUT
const control = async (server, action, value) => {
  const response = await fetch(server.url + '/control', { method: 'POST', body: JSON.stringify({ action, value }) })
  assert.equal(response.status, 200)
  return response.json()
}
async function scenario(t, start, run) {
  let server, browser, page, context
  const close = async () => { await control(server, 'release').catch(() => {}); await browser?.close(); await server?.close() }
  try {
    server = await start()
    browser = await chromium.launch({ timeout: 7000 })
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    page = await context.newPage(); page.setDefaultTimeout(7000)
    const outside = [], errors = []
    await context.route('**/*', route => new URL(route.request().url()).origin === server.url ? route.continue() : (outside.push(route.request().url()), route.abort()))
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(server.url)
    await run(page, server)
    assert.deepEqual(errors, []); assert.deepEqual(outside, [])
  } catch (error) {
    const directory = 'test-results/planning-board/' + t.name.replace(/[^a-z0-9-]/gi, '-')
    await mkdir(directory, { recursive: true }); await page?.screenshot({ path: directory + '/failure.png' }).catch(() => {})
    throw error
  } finally { await close() }
}
const board = page => page.getByRole('button', { name: '看板', exact: true }).click()
const items = page => page.getByRole('button', { name: '工作项', exact: true }).click()
const cards = page => page.locator('.hp-board-card')
async function tabTo(page, target) {
  for (let index = 0; index < 60; index++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(el => el === document.activeElement)) return
  }
  assert.fail('Tab order cannot reach Board opener')
}
async function capture(page, name) {
  if (!output) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: output + '/' + name + '.png' })
  const rendering = await page.evaluate(() => ({ path:location.pathname + location.search, viewport:{ width:innerWidth,height:innerHeight }, rootFont:getComputedStyle(document.documentElement).font, font:getComputedStyle(document.body).font, theme:document.documentElement.className, devicePixelRatio }))
  await writeFile(output + '/' + name + '.json', JSON.stringify({ capturedAt:new Date().toISOString(), ...rendering }, null, 2))
}

test('composed Board shares local query and opens one detail through keyboard without business writes', { timeout: 60000 }, async t => {
  await scenario(t, () => startExecutionServer({ seed: 'query' }), async (page, server) => {
    await page.getByRole('link', { name: 'Query 000', exact: true }).waitFor()
    const before = await control(server, 'inspect')
    await page.getByRole('searchbox').fill('Query 00')
    await board(page)
    assert.equal(await cards(page).count(), 10)
    assert.match(await page.locator('.hp-query-summary[role=status]').innerText(), /只读规划/)
    const scroll = await page.locator('.hp-board-scroll').evaluate(el => ({ height:el.clientHeight, content:el.scrollHeight, body:el.parentElement.clientHeight }))
    assert.ok(scroll.height <= scroll.body && scroll.content > scroll.height, JSON.stringify(scroll))
    assert.equal(await page.getByRole('table').count(), 0)
    assert.equal(await page.getByRole('checkbox').count(), 0)
    assert.equal(await page.getByRole('button', { name: '重置列宽' }).count(), 0)
    assert.doesNotMatch(await page.locator('.hp-work-items').innerText(), /内容不可见/)
    await items(page); assert.equal(await page.getByRole('searchbox').inputValue(), 'Query 00')
    await board(page); assert.equal(await cards(page).count(), 10)
    const local = await control(server, 'inspect')
    assert.deepEqual(local.calls, before.calls)
    assert.deepEqual(local.external, before.external)
    assert.deepEqual(local.requests.slice(before.requests.length).filter(r => !['baseline', 'getWorkspaceSetup'].includes(r.name)), [])
    const opener = page.getByRole('link', { name: 'Query 000', exact: true })
    assert.match(await opener.getAttribute('href'), /items\//)
    await tabTo(page, opener); await page.keyboard.press('Enter')
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.equal(await opener.getAttribute('aria-current'), 'true')
    assert.equal(await page.locator('.hp-board-card-selected').count(), 1)
    await capture(page, 'composed-board-selected-detail')
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await opener.evaluate(el => el === document.activeElement), true)
    await page.getByRole('searchbox').fill('no matching title')
    assert.equal(await cards(page).count(), 0); assert.equal(await page.locator('.hp-board-column').count(), 0)
    await page.getByText('当前已加载可读条目没有匹配项，请调整或清除条件。', { exact: true }).waitFor()
    assert.equal(await page.getByText(/没有匹配项|当前没有可显示的工作项/).count(), 1, 'one global filtered-zero explanation')
    await page.getByRole('searchbox').fill('Query 000'); await opener.click()
    await control(server, 'disconnect', true)
    await page.getByRole('dialog').getByText(/连接已中断/).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await cards(page).count(), 1)
    assert.match(await page.locator('.hp-work-items').innerText(), /最后已知值/)
    await capture(page, 'composed-authorized-offline')
    await control(server, 'disconnect', false)
    await page.waitForFunction(() => !document.body.innerText.includes('连接已中断'))
    const planning = server.byDomain.planning, seed = planning.state.items[0]
    planning.state.items.push({ ...seed, ref:{...seed.ref,objectKind:'project_item',externalId:'board-unanchored'}, membership:{...seed.membership,externalId:'board-unanchored'},content:{kind:'redacted',reason:'unavailable'} })
    await page.getByRole('button', { name:'刷新规划',exact:true }).click()
    await page.getByText('部分条目尚未确认，已显示的条目是当前值', { exact:true }).waitFor()
    assert.doesNotMatch(await page.locator('.hp-work-items').innerText(), /显示的是最后已知值/)
    assert.doesNotMatch(await page.locator('.hp-board-scroll').innerText(), /最后已知值/)
    await capture(page, 'composed-partial')
    await items(page)
    assert.doesNotMatch(await page.locator('.hp-work-items').innerText(), /显示的是最后已知值/)
    await board(page)
    const after = await control(server, 'inspect')
    assert.deepEqual(Object.entries(after.calls).filter(([key]) => key.startsWith('write:')), [])
    assert.deepEqual(after.external, before.external)
    if (output) await writeFile(output + '/composed-counters.json', JSON.stringify({ before, local, after }, null, 2))
  })
})

test('composed withdrawal removes Board groups and labels before a held old baseline is released', { timeout: 60000 }, async t => {
  await scenario(t, () => startExecutionServer({ seed: 'board' }), async (page, server) => {
    const opener = page.getByRole('link', { name: '规划项 issue-1', exact: true })
    await opener.waitFor(); await board(page)
    await page.getByText('Native review（未映射）', { exact: true }).waitFor()
    assert.match(await page.locator('.hp-work-items').innerText(), /example\/board#605/)
    const initial = await control(server, 'inspect')
    await opener.click(); await page.getByRole('dialog').waitFor()
    await control(server, 'hold', { domain: 'watch', method: 'baseline', enabled: true })
    await control(server, 'disconnect', true); await control(server, 'disconnect', false)
    await page.waitForFunction(async () => (await window.fixture.command('inspect')).held > 0)
    await control(server, 'hold', { domain: 'watch', method: 'baseline', enabled: false })
    await control(server, 'permission', { domain: 'planning', key: 'planning.item.read', enabled: false })
    const response = await fetch(server.url + '/remote', { method: 'POST', body: JSON.stringify({ name: 'refreshPlanning', input: { actorRef: { kind: 'user' } } }) })
    assert.equal((await response.json()).ok, true)
    await control(server, 'disconnect', true); await control(server, 'disconnect', false)
    await page.waitForFunction(() => !document.body.innerText.includes('规划项 issue-1') && !document.body.innerText.includes('Native review'))
    assert.equal(await cards(page).count(), 0); assert.equal(await page.locator('.hp-board-column').count(), 0)
    assert.doesNotMatch(await page.locator('body').ariaSnapshot(), /Native review|example\/board|规划项 issue/)
    await control(server, 'release')
    await page.waitForFunction(async () => (await window.fixture.command('inspect')).held === 0)
    assert.doesNotMatch(await page.locator('body').innerHTML(), /Native review|example\/board|规划项 issue|hp-board-card-selected/)
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.getByRole('heading', { name: '连接设置', exact: true }).evaluate(el => el === document.activeElement), true)
    const after = await control(server, 'inspect')
    assert.deepEqual(after.external, initial.external)
    assert.deepEqual(Object.entries(after.calls).filter(([key]) => key.startsWith('write:')), [])
    await capture(page, 'composed-denied')
    if (output) await writeFile(output + '/withdrawal-counters.json', JSON.stringify({ initial, after }, null, 2))
  })
})

test('Board renders reference content, transparent groups and natural cards with bounded scroll across themes and 200% text', { timeout: 60000 }, async t => {
  await scenario(t, startTableGeometryServer, async (page, server) => {
    const evidence = []
    for (const width of [1440, 1024, 390]) for (const dark of [false, true]) for (const zoom of [false, true]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(server.url + '/?header&reference' + (dark ? '&dark' : '') + (zoom ? '&zoom' : ''))
      await capture(page, 'before-list-' + width + '-' + (dark ? 'dark' : 'light') + '-' + (zoom ? '200' : '100'))
      await board(page)
      assert.equal(await cards(page).count(), 7)
      const hit = await page.getByRole('link', { name:'呈现真实规划数据的只读看板',exact:true }).evaluate(el => {
        const link=el.getBoundingClientRect(),card=el.closest('li').getBoundingClientRect(),source=el.closest('li').querySelector('.hp-board-meta').getBoundingClientRect(),fields=el.closest('li').querySelector('.hp-board-fields').getBoundingClientRect()
        return {height:link.height,inside:link.left>=card.left&&link.right<=card.right&&link.top>=source.bottom&&link.bottom<=fields.top}
      })
      assert.ok(hit.height>=44&&hit.inside, JSON.stringify({width,dark,zoom,hit}))
      assert.deepEqual(await page.locator('.hp-board-column h3').allTextContents(), ['待办3', '进行中2', '已完成1', '未知1'])
      assert.equal(await page.locator('.hp-board-column').evaluateAll(columns => columns.every(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)')), true)
      const geometry = await page.locator('.hp-board-scroll').evaluate(el => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }))
      assert.ok(geometry.page <= width + 1, JSON.stringify(geometry))
      assert.ok(geometry.height > 0)
      if (width === 390) assert.ok(geometry.scroll <= geometry.width + 1)
      assert.equal(await page.locator('.hp-board-card').evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth + 1)), true)
      await page.getByRole('searchbox').fill('604'); await items(page)
      assert.equal(await page.getByRole('searchbox').inputValue(), '604')
      await board(page); assert.equal(await cards(page).count(), 1)
      await page.getByRole('searchbox').fill('')
      await capture(page, 'board-' + width + '-' + (dark ? 'dark' : 'light') + '-' + (zoom ? '200' : '100'))
      evidence.push({ width, dark, zoom, geometry })
    }
    await page.getByRole('searchbox').fill('604')
    await page.evaluate(() => window.queryFixture.scope('another-workspace', 'another-binding'))
    assert.equal(await page.getByRole('searchbox').inputValue(), '')
    await page.evaluate(() => window.queryFixture.empty()); await page.getByText('当前快照没有工作项', { exact: true }).waitFor()
    assert.equal(await cards(page).count(), 0); await capture(page, 'empty')
    await page.evaluate(() => window.queryFixture.restore()); await page.evaluate(() => window.queryFixture.partial())
    assert.match(await page.locator('.hp-work-items').innerText(), /部分条目尚未确认，已显示的条目是当前值/)
    assert.doesNotMatch(await page.locator('.hp-work-items').innerText(), /最后已知值/)
    await capture(page, 'partial')
    await page.evaluate(() => window.queryFixture.stale())
    assert.match(await page.locator('.hp-work-items').innerText(), /最后已知值/); await capture(page, 'stale')
    await page.evaluate(() => window.queryFixture.unknown()); assert.equal(await cards(page).count(), 0)
    await capture(page, 'unknown-read-capability')
    if (output) await writeFile(output + '/layout-matrix.json', JSON.stringify(evidence, null, 2))
  })
})

test('Board clears revoked facets in the same publication, rejects hidden mutations and uses a safe heading when an opener disappears', { timeout: 60000 }, async t => {
  await scenario(t, startTableGeometryServer, async (page, server) => {
    await page.goto(server.url + '/?app&reference')
    await board(page)
    const surface = page.locator('.hp-work-items')
    const before = await surface.innerHTML()
    await page.evaluate(() => window.queryFixture.hidden())
    assert.equal(await surface.innerHTML(), before)
    const facet = page.getByRole('combobox', { name:'迭代筛选' })
    await facet.selectOption('value:现代看板')
    const opener = page.getByRole('link', { name:'呈现真实规划数据的只读看板', exact:true })
    assert.match(await opener.getAttribute('href'), /items\//)
    for (const modifier of ['metaKey','ctrlKey','shiftKey','altKey']) assert.equal(await opener.evaluate((el, key) => el.dispatchEvent(new MouseEvent('click', { bubbles:true,cancelable:true,[key]:true })), modifier), true)
    assert.equal(await opener.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles:true,cancelable:true,button:1 }))), true)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await opener.click(); await page.getByRole('dialog').waitFor()
    await page.evaluate(() => window.queryFixture.revokeFacet())
    assert.equal(await facet.inputValue(), 'all')
    assert.doesNotMatch(await surface.innerHTML(), /现代看板|Core 恢复|呈现真实规划|#605|hp-board-card-selected/)
    assert.equal(await cards(page).count(), 0)
    assert.equal(await surface.locator('[aria-current]').count(), 0)
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state:'detached' })
    assert.equal(await page.getByRole('heading', { name:'工作项', exact:true }).evaluate(el => el === document.activeElement), true)
    await page.evaluate(() => window.queryFixture.restore())
    assert.equal(await facet.inputValue(), 'all')
    await page.getByText(/部分筛选条件已不可用，已清除/).waitFor()
    await page.getByText('显示选项', { exact:true }).click()
    await page.getByRole('combobox', { name:'排序', exact:true }).selectOption('title:desc')
    await items(page); await board(page)
    assert.equal(await page.getByRole('combobox', { name:'排序', exact:true }).inputValue(), 'title:desc')
    await page.setViewportSize({width:390,height:900})
    await page.goto(server.url + '/?app')
    await board(page)
    const long = page.getByRole('link', { name:/Readable title/ })
    assert.match(await long.innerText(), /LongUnbrokenTitle/)
    assert.ok(await long.evaluate(el => el.getBoundingClientRect().height > 80))
    assert.equal(await long.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    await capture(page, 'long-card')
  })
})

for (const advertised of [false,true]) test('captured old Provider reply is rejected after denial with permission ' + (advertised ? 'advertised again' : 'still unavailable'), { timeout:60000 }, async t => {
  await scenario(t, () => startExecutionServer({ seed:'board' }), async (page, server) => {
    await board(page)
    await page.getByRole('combobox', { name:'规划状态筛选' }).selectOption('value:Native review（未映射）')
    const opener = page.getByRole('link', { name:'Board native unknown',exact:true })
    await opener.click(); await page.getByRole('dialog').waitFor()
    const initial = await control(server, 'inspect')
    let release, entered, returned = 0, first = true
    const gate = new Promise(resolve => { release = resolve }), taken = new Promise(resolve => { entered = resolve })
    const provider = server.byDomain.planning, read = provider.listPlanningItems.bind(provider)
    provider.listPlanningItems = async input => {
      const result = await read(input)
      if (first) { first = false; entered(result); await gate; returned++ }
      return result
    }
    try {
      await page.getByRole('dialog').getByRole('button', { name:'刷新规划',exact:true }).click()
      const old = await Promise.race([taken, new Promise((_, reject) => {
        AbortSignal.any([t.signal, AbortSignal.timeout(7000)]).addEventListener('abort', () => reject(new Error('Provider barrier not entered')), { once:true })
      })])
      assert.equal(old.ok, true)
      assert.ok(old.value.items.some(item => item.fields.nativeValues?.status?.name === 'Native review'))
      assert.equal(returned, 0)
      await control(server, 'permission', { domain:'planning',key:'planning.item.read',enabled:false })
      const denial = await page.evaluate(() => window.fixture.remote.bootstrapWorkspace({ kind:'user' }, 'board-late-denial'))
      assert.equal(denial.value.error.code, 'permission_denied')
      await page.waitForFunction(() => !document.body.innerText.includes('Board native unknown') && !document.body.innerText.includes('Native review'))
      assert.equal(returned, 0, 'old successful Provider value is still held after the newer denial')
      if (advertised) await control(server, 'permission', { domain:'planning',key:'planning.item.read',enabled:true })
      release()
      await page.waitForFunction(() => window.fixture.unaryObservations().some(value => value.name === 'refreshPlanning'))
      assert.equal(returned, 1, 'captured successful reply actually returned into the production read round')
      const replies = await page.evaluate(() => window.fixture.unaryObservations())
      const late = replies.find(value => value.name === 'refreshPlanning')
      assert.equal(late.errorCode, advertised ? 'stale_revision' : 'unavailable', JSON.stringify({returned,replies}))
      assert.equal(late.errorMessage, advertised ? '本轮 Planning 快照已被更新的同步轮次取代' : 'Planning 挂载尚未重新确认')
      assert.equal(late.writeState, 'failed')
      assert.ok((await server.storage.listPlanningProjections(server.workspaceId)).every(row => row.content.contentKind === 'redacted' && row.planningFields === undefined))
      assert.equal(await cards(page).count(), 0)
      assert.equal(await page.locator('.hp-board-column, .hp-table-controls option, .hp-board-card-selected, .hp-work-items [aria-current]').count(), 0)
      assert.doesNotMatch(await page.locator('body').ariaSnapshot(), /Board native unknown|Native review|example\/board#605|显示 5 项|共 5 项/)
      assert.doesNotMatch(await page.locator('body').innerHTML(), /Board native unknown|Native review|example\/board#605/)
      const after = await control(server, 'inspect')
      assert.deepEqual(after.external, initial.external)
      assert.deepEqual(Object.entries(after.calls).filter(([key]) => key.startsWith('write:')), [])
      await capture(page, 'composed-actual-late-reply-rejected-' + advertised)
      if (output) await writeFile(output + '/actual-late-reply-' + advertised + '.json', JSON.stringify({ providerReturned:returned,late,denialError:denial.value.error.code,replies,initial,after }, null, 2))
    } finally { release() }
  })
})


test('zero authorized items have identical composed List and Board DOM and AX for empty and all-redacted reads', { timeout:60000 }, async t => {
  await scenario(t, startTableGeometryServer, async (page, server) => {
    await page.goto(server.url + '/?app&reference')
    await page.getByRole('link', { name:'呈现真实规划数据的只读看板',exact:true }).waitFor()
    const observed = []
    for (const mode of ['list', 'board']) {
      if (mode === 'board') await board(page)
      await page.evaluate(() => window.queryFixture.empty())
      await page.getByText('当前快照没有工作项', { exact:true }).waitFor()
      const surface = page.locator('.hp-work-items')
      await capture(page, 'repair-zero-' + mode + '-empty')
      const empty = { dom:await surface.innerHTML(), ax:await surface.ariaSnapshot() }
      await page.evaluate(() => window.queryFixture.restore())
      await page.getByRole('link', { name:'呈现真实规划数据的只读看板',exact:true }).waitFor()
      await page.evaluate(() => window.queryFixture.revokeFacet())
      await page.waitForFunction(() => !document.body.innerText.includes('呈现真实规划数据的只读看板'))
      await capture(page, 'repair-zero-' + mode + '-redacted')
      observed.push({ mode, empty, redacted:{ dom:await surface.innerHTML(), ax:await surface.ariaSnapshot() } })
      await page.evaluate(() => window.queryFixture.restore())
    }
    for (const { mode,empty,redacted } of observed.toReversed()) assert.deepEqual(redacted, empty, mode + ' authorized-zero equivalence')
  })
})

test('Board clear preserves hidden List display columns while clearing only the shared query', { timeout:60000 }, async t => {
  await scenario(t, startTableGeometryServer, async (page, server) => {
    await page.goto(server.url + '/?app&reference')
    await page.getByText('显示选项', { exact:true }).click()
    const source = page.getByRole('checkbox', { name:'来源',exact:true })
    await source.check()
    await page.getByRole('combobox', { name:'排序',exact:true }).selectOption('title:desc')
    await page.getByRole('searchbox').fill('604')
    await board(page)
    await capture(page, 'repair-clear-before')
    await page.getByRole('button', { name:'清除条件',exact:true }).click()
    assert.equal(await page.getByRole('searchbox').inputValue(), '')
    assert.equal(await cards(page).count(), 7)
    await items(page)
    await capture(page, 'repair-clear-list')
    assert.equal(await source.isChecked(), true)
    assert.equal(await page.getByRole('columnheader', { name:/来源/ }).count(), 1)
    assert.equal(await page.getByRole('combobox', { name:'排序',exact:true }).inputValue(), '')
  })
})

test('Board explains within-group sorting and preserves an inherited List-only Planning sort honestly', { timeout:60000 }, async t => {
  await scenario(t, startTableGeometryServer, async (page, server) => {
    await page.goto(server.url + '/?app&reference')
    await page.getByText('显示选项', { exact:true }).click()
    const sort = page.getByRole('combobox', { name:'排序',exact:true })
    await sort.selectOption('planningStatus:desc')
    await board(page)
    await page.locator('.hp-board-scroll').waitFor()
    await capture(page, 'repair-sort-inherited')
    assert.equal(await sort.inputValue(), 'planningStatus:desc')
    await page.getByText('保留列表规划状态降序；规范列序固定', { exact:true }).waitFor({ state:'attached' })
    assert.equal(await sort.evaluate(el => el.selectedOptions[0].disabled), true)
    assert.match(await page.locator('.hp-table-controls').innerText(), /保留列表规划状态降序.*规范列序固定/)
    assert.equal(await sort.locator('option[value="planningStatus:asc"]').count(), 0)
    await items(page)
    assert.equal(await sort.locator('option[value="planningStatus:asc"]').isEnabled(), true)
    assert.equal(await page.locator('th[aria-sort="descending"]').innerText(), '规划状态')
    await board(page)
    await sort.selectOption('title:desc')
    assert.match(await page.locator('.hp-table-controls').innerText(), /组内卡片排序：工作项降序/)
    assert.deepEqual(await page.locator('.hp-board-column h3').allTextContents(), ['待办3','进行中2','已完成1','未知1'])
    assert.deepEqual(await page.locator('.hp-board-column').first().locator('h4').allTextContents(), ['确认本次发布的具体视觉目标','呈现真实规划数据的只读看板','删除发布前旧数据修复路径'])
    await capture(page, 'repair-sort-cards')
  })
})
