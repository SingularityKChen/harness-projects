import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'

const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' })
const SELECTION = 'workspace-selection.json'
const selectionOf = async (h) => JSON.parse(await readFile(path.join(path.dirname(h.dataPath), SELECTION), 'utf8'))
const post = async (h, action, value) => {
  const response = await fetch(h.url + '/control', { method: 'POST', body: JSON.stringify({ action, value }) })
  assert.equal(response.status, 200); return response.json()
}
const focused = (page) => page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent ?? '' }))
async function scenario(t, run) {
  const outside = [], errors = []
  let h, browser, context, page
  const cleanup = async () => {
    await page?.evaluate(() => window.fixture?.unmount()).catch(() => {})
    await page?.close().catch(() => {}); await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await h?.close().catch(() => {})
  }
  t.after(cleanup)
  try {
    h = await startExecutionServer({ seed: 'restore' })
    browser = await chromium.launch({ timeout: 7000 }); context = await browser.newContext(); page = await context.newPage()
    page.setDefaultTimeout(7000)
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === h.url) return route.continue()
      outside.push(route.request().url()); return route.abort()
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(h.url + '/'); await page.waitForFunction(() => !!window.fixture)
    await run({ page, h })
    assert.deepEqual(outside, [], '浏览器不得访问业务网络'); assert.deepEqual(errors, [], '未捕获的界面错误不能通过')
  } catch (error) {
    await mkdir('test-results/composed-browser/workspace-restore', { recursive: true }).catch(() => {})
    await page?.screenshot({ path: 'test-results/composed-browser/workspace-restore/failure.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await cleanup() }
}

test('reopening restores the last confirmed project and a pathname deep link outranks the preference', { timeout: 120000 }, async (t) => {
  await scenario(t, async ({ page, h }) => {
    const home = page.getByRole('region', { name: '项目' })
    await home.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await home.locator('li').count(), 2, 'Home 列出两个已存项目')
    assert.equal(await home.locator('li[aria-current="true"]').count(), 0, '没有偏好时不假装已选中项目')
    assert.deepEqual(await focused(page), { tag: 'H2', text: '项目' }, '进入 Home 回焦标题')
    const openB = home.locator('li').filter({ hasText: '项目 B' }).getByRole('button', { name: '打开', exact: true })
    await openB.focus(); await page.keyboard.press('Enter')
    await visible(page, '项目 B 专属条目')
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目/, 'B 的页面不出现 A 的行')
    assert.equal((await selectionOf(h)).workspaceId, h.projectB, '成功打开后写入导航偏好')
    await post(h, 'rebuild')
    await visible(page, '项目 B 专属条目')
    const setup = (await page.evaluate(() => window.fixture.remote.getWorkspaceSetup())).value
    assert.equal(setup.workspace.id, h.projectB, '重开恢复到 B'); assert.equal(setup.restore, undefined, '恢复成功不带 restore')
    await page.goto(h.url + '/projects/' + h.workspaceId + '/items')
    await visible(page, '项目 A 条目')
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 B 专属条目/, '显式链接打开目标后不残留偏好项目')
    assert.equal((await selectionOf(h)).workspaceId, h.workspaceId, '显式链接切换同样写偏好')
  })
})

test('a corrupt preference degrades to Home with an explanation and a failed link never falls back', { timeout: 120000 }, async (t) => {
  await scenario(t, async ({ page, h }) => {
    const home = page.getByRole('region', { name: '项目' })
    await home.locator('li').filter({ hasText: '项目 A' }).getByRole('button', { name: '打开', exact: true }).click()
    await visible(page, '项目 A 条目')
    await writeFile(path.join(path.dirname(h.dataPath), SELECTION), '{"version":1,"workspaceId":"broken"', { mode: 0o600 })
    await page.goto(h.url + '/'); await page.waitForFunction(() => !!window.fixture)
    await post(h, 'rebuild')
    const restored = page.getByRole('region', { name: '项目' })
    await restored.getByText('上次打开的项目记录已损坏，请选择项目。', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await restored.locator('li[aria-current="true"]').count(), 0, '损坏偏好不得回退到任何项目')
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目|项目 B 专属条目/, 'Home 说明不打开其它项目')
    assert.equal(await restored.getByRole('button', { name: '创建工作区', exact: true }).count(), 1, 'Home 仍可创建项目')
    // 显式链接优先于（损坏的）偏好：即使 Home 是恢复失败状态，链接目标仍先被打开。
    await page.goto(h.url + '/projects/' + h.workspaceId + '/items')
    await visible(page, '项目 A 条目')
    await post(h, 'policy', { workspaceId: h.projectB, statusPolicy: 'manual_only' })
    await page.goto(h.url + '/projects/' + h.projectB + '/items')
    await page.getByRole('alert').getByText('无法打开链接中的项目，请回到项目列表。', { exact: true }).waitFor({ state: 'visible' })
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目|项目 B 专属条目/, '失败的链接不得回退到当前项目或偏好项目')
  })
})
test('production Gate consumes a failed deep link on return, create and explicit open', { timeout: 90000 }, async (t) => {
  await scenario(t, async ({ page, h }) => {
    await page.getByRole('region', { name: '项目', exact: true }).locator('li').filter({ hasText: '项目 A' }).getByRole('button', { name: '打开', exact: true }).click(); await visible(page, '项目 A 条目')
    for (const action of ['return', 'create', 'open']) {
      await post(h, 'policy', { workspaceId: h.projectB, statusPolicy: 'manual_only' })
      await page.goto(h.url + '/projects/' + h.projectB + '/items?gate')
      const home = page.getByRole('region', { name: '项目', exact: true })
      await home.getByRole('alert').getByText('无法打开链接中的项目，请回到项目列表。', { exact: true }).waitFor()
      if (action === 'return') { await home.getByRole('button', { name: '返回项目', exact: true }).click(); await visible(page, '项目 A 条目') }
      else if (action === 'create') { await home.getByRole('button', { name: '创建工作区', exact: true }).click(); await page.getByRole('form', { name: '创建工作区', exact: true }).waitFor({ state: 'visible' }) }
      else { await post(h, 'policy', { workspaceId: h.projectB, statusPolicy: 'provider_authoritative' }); await home.locator('li').filter({ hasText: '项目 B' }).getByRole('button', { name: '打开', exact: true }).click(); await visible(page, '项目 B 专属条目') }
      assert.equal(await page.getByRole('alert').filter({ hasText: '无法打开链接中的项目' }).count(), 0, 'manual navigation consumes the failed inbound link')
    }
  })
})
