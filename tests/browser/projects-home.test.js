import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'

const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' })
async function scenario(t, run) {
  const outside = [], errors = []
  let h, browser, context, page
  const cleanup = async () => {
    await page?.evaluate(() => window.fixture?.unmount()).catch(() => {})
    await page?.close().catch(() => {}); await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await h?.close().catch(() => {})
  }
  t.after(cleanup)
  try {
    h = await startExecutionServer({ seed: 'projects' })
    browser = await chromium.launch({ timeout: 7000 }); context = await browser.newContext(); page = await context.newPage()
    page.setDefaultTimeout(7000)
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === h.url) return route.continue()
      outside.push(route.request().url()); return route.abort()
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(h.url + '/'); await page.waitForFunction(() => !!window.fixture)
    await run({ page })
    assert.deepEqual(outside, [], '浏览器不得访问业务网络'); assert.deepEqual(errors, [], '未捕获的界面错误不能通过')
  } catch (error) {
    await mkdir('test-results/composed-browser/projects-home', { recursive: true }).catch(() => {})
    await page?.screenshot({ path: 'test-results/composed-browser/projects-home/failure.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await cleanup() }
}
const homeOf = async (page) => {
  await page.getByRole('button', { name: '项目', exact: true }).first().click()
  const home = page.getByRole('region', { name: '项目' })
  await home.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
  return home
}

test('Projects Home lists saved projects and opening another renders only its rows', { timeout: 60000 }, async (t) => {
    await scenario(t, async ({ page }) => {
      await visible(page, '项目 A 条目')
      let home = await homeOf(page), current = home.locator('li[aria-current="true"]')
      assert.match(await current.innerText(), /Execution Fixture/, '当前项目行标记 aria-current')
      assert.equal(await current.getByRole('button', { name: '返回项目', exact: true }).count(), 1)
      assert.equal(await home.getByRole('button', { name: '打开', exact: true }).count(), 1, '只给其它项目打开动作')
      await current.getByRole('button', { name: '返回项目', exact: true }).click(); await visible(page, '项目 A 条目')
      home = await homeOf(page); await home.getByRole('button', { name: '打开', exact: true }).click(); await visible(page, '项目 B 专属条目')
      assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目/, 'A 的行不得出现在 B 下')
      home = await homeOf(page); assert.match(await home.locator('li[aria-current="true"]').innerText(), /项目 B/)
      await home.locator('li[aria-current="true"]').getByRole('button', { name: '返回项目', exact: true }).click(); await visible(page, '项目 B 专属条目')
    })
})
