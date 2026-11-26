import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'

const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' })
const home = async (page) => {
  await page.getByRole('button', { name: '项目', exact: true }).first().click()
  const region = page.getByRole('region', { name: '项目' })
  await region.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
  return region
}
/** 空 profile（create-switch）从 create 面板开始：创建 A/B、Home 切换、失败保留 A、焦点回退。 */
async function scenario(t, run) {
  const outside = [], errors = []
  let h, browser, context, page
  const cleanup = async () => {
    await page?.evaluate(() => window.fixture?.unmount()).catch(() => {})
    await page?.close().catch(() => {}); await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await h?.close().catch(() => {})
  }
  t.after(cleanup)
  try {
    h = await startExecutionServer({ seed: 'create-switch' })
    browser = await chromium.launch({ timeout: 7000 }); context = await browser.newContext(); page = await context.newPage()
    page.setDefaultTimeout(7000)
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === h.url) return route.continue()
      outside.push(route.request().url()); return route.abort()
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(h.url + '/'); await page.waitForFunction(() => !!window.fixture)
    await run({ page, server: h })
    assert.deepEqual(outside, [], '浏览器不得访问业务网络'); assert.deepEqual(errors, [], '未捕获的界面错误不能通过')
  } catch (error) {
    await mkdir('test-results/composed-browser/project-switch', { recursive: true }).catch(() => {})
    await page?.screenshot({ path: 'test-results/composed-browser/project-switch/failure.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await cleanup() }
}
const createProject = async (page, name) => {
  await page.locator('#workspace-name').fill(name)
  await page.getByRole('button', { name: '创建工作区', exact: true }).click()
  await page.getByRole('form', { name: '规划连接' }).waitFor({ state: 'visible' })
}
const focused = (page) => page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent ?? '' }))

test('empty profile creates A/B, Home switches A↔B, a failed switch keeps A and focus falls back', { timeout: 90000 }, async (t) => {
  await scenario(t, async ({ page, server }) => {
    // 空 profile：0 个项目 → 现有 create 表单（不是 Home 列表）。
    await page.getByRole('heading', { name: '创建工作区', exact: true }).waitFor({ state: 'visible' })
    await createProject(page, '项目 A')
    // 创建成功后进入新项目的连接/设置流程：只提供可恢复的部分配置，不声称已完全配置。
    assert.equal(await page.getByRole('button', { name: '连接项目', exact: true }).count(), 1)
    assert.match(await page.locator('body').innerText(), /连接设置/)
    assert.doesNotMatch(await page.locator('body').innerText(), /配置已记录|激活失败/)
    // Home 列出 A 并把它标成当前项目。
    let region = await home(page)
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/)
    assert.deepEqual(await focused(page), { tag: 'H2', text: '项目' }, '进入 Home 回焦标题')
    // Home 的创建入口创建 B（A 仍存在时也必须能创建第二个项目）。
    await region.getByRole('button', { name: '创建工作区', exact: true }).click()
    await createProject(page, '项目 B')
    region = await home(page)
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 B/, '创建 B 后 B 是当前项目')
    assert.equal(await region.getByRole('button', { name: '打开', exact: true }).count(), 1, '只剩 A 可打开')
    assert.equal(await region.getByRole('button', { name: '返回项目', exact: true }).count(), 1)
    // 打开 A：A 权威，切换后焦点回落到项目标题。
    await region.getByRole('button', { name: '打开', exact: true }).click()
    await page.getByRole('button', { name: '连接设置', exact: true }).waitFor({ state: 'visible' })
    assert.deepEqual(await focused(page), { tag: 'H2', text: '工作区' }, '打开项目后焦点落到项目标题')
    await page.getByRole('button', { name: '连接设置', exact: true }).click()
    await visible(page, '当前工作区：项目 A')
    region = await home(page)
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/, 'A↔B 回到 A')
    // 失败切换：B 的策略变成 Host 不支持；A 仍是当前项目，Home 就地给出失败反馈。
    const catalogue = (await page.evaluate(() => window.fixture.remote.listWorkspaces())).value.workspaces
    const b = catalogue.find((row) => row.name === '项目 B')
    for (const row of catalogue) assert.match(row.workspaceId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, '两个项目都得到稳定的 UUID v5 形状 id')
    await page.evaluate(async (value) => { await fetch('/control', { method: 'POST', body: JSON.stringify({ action: 'policy', value }) }) }, { workspaceId: b.workspaceId, statusPolicy: 'manual_only' })
    await region.getByRole('button', { name: '打开', exact: true }).click()
    const alert = region.getByRole('alert')
    await alert.waitFor({ state: 'visible' })
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/, '失败的切换不改变当前项目')
    assert.equal(await region.getByRole('button', { name: '返回项目', exact: true }).count(), 1, 'A 仍可返回')
    await region.getByRole('button', { name: '重新读取', exact: true }).click()
    await region.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/, '重新读取后 A 仍权威')
    assert.equal(server.requests.filter((request) => request.name === 'createWorkspace').length, 2, '恰好两次创建：创建 A 与创建 B 各一次，没有重复提交')
  })
})
