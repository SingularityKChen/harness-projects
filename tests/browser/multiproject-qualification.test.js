/**
 * 多项目组合浏览器的端到端验收矩阵（#694，整合 #636 的验收组 2/3/6/7）。
 *
 * 用既有 composed-workspace 夹具与 seed（不新增主题或产品代码）把真实 Host + SQLite + client + UI 组合跑在
 * 真实 Chromium 里：0/1/多项目的 Home、创建 A/B、A↔B、失败切换保留 A、重开恢复、显式深链优先、不可读目标
 * 如实降级、键盘/焦点，以及 320/640 窄宽与明暗主题下的可读性（无横向溢出、动作目标 >= 44px）。
 * 夹具的 ?theme= 参数与既有 palette 变量是本文件唯一的主题入口；这里不新增任何主题样式。
 */
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'

const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' })
const SELECTION = 'workspace-selection.json'
const focused = (page) => page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent ?? '' }))
const post = async (h, action, value) => { const response = await fetch(h.url + '/control', { method: 'POST', body: JSON.stringify({ action, value }) }); assert.equal(response.status, 200); return response.json() }
const selectionOf = async (h) => JSON.parse(await readFile(path.join(path.dirname(h.dataPath), SELECTION), 'utf8'))
/** 进入 Projects Home：列表视图与设置视图各有一个「项目」入口，取当前可见的第一个。 */
const home = async (page) => {
  await page.getByRole('button', { name: '项目', exact: true }).filter({ visible: true }).first().click()
  const region = page.getByRole('region', { name: '项目' })
  await region.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
  return region
}
/** 组合浏览器的可读性量测：横向溢出、动作目标高度与主题标记，全部取自真实渲染，不注入样式。 */
const readability = (page) => page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  targets: [...document.querySelectorAll('button')].filter((button) => button.getClientRects().length > 0).map((button) => button.getBoundingClientRect().height),
  color: getComputedStyle(document.body).color,
}))

async function scenario(t, { seed, viewport = { width: 1280, height: 800 }, theme }, run) {
  const outside = [], errors = []
  let h, browser, context, page
  const cleanup = async () => {
    await page?.evaluate(() => window.fixture?.unmount()).catch(() => {})
    await page?.close().catch(() => {}); await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await h?.close().catch(() => {})
  }
  t.after(cleanup)
  try {
    h = await startExecutionServer({ seed })
    browser = await chromium.launch({ timeout: 7000 }); context = await browser.newContext({ viewport }); page = await context.newPage()
    page.setDefaultTimeout(7000)
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === h.url) return route.continue()
      outside.push(route.request().url()); return route.abort()
    })
    page.on('pageerror', (error) => errors.push(error.message))
    const suffix = theme === undefined ? '' : '?theme=' + theme
    await page.goto(h.url + '/' + suffix); await page.waitForFunction(() => !!window.fixture)
    await run({ page, h })
    assert.deepEqual(outside, [], '浏览器不得访问业务网络'); assert.deepEqual(errors, [], '未捕获的界面错误不能通过')
  } catch (error) {
    const name = seed + '-' + String(theme ?? 'light')
    await mkdir('test-results/composed-browser/multiproject-qualification', { recursive: true }).catch(() => {})
    await page?.screenshot({ path: 'test-results/composed-browser/multiproject-qualification/' + name + '.png', fullPage: true }).catch(() => {})
    throw error
  } finally { await cleanup() }
}

test('lifecycle matrix: zero, one and many projects, create A/B, keyboard A↔B and a failed switch keeping A', { timeout: 120000 }, async (t) => {
  await scenario(t, { seed: 'create-switch' }, async ({ page, h }) => {
    // 0 个项目：直接落在创建表单，不伪造 Home 列表。
    await page.getByRole('heading', { name: '创建工作区', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('region', { name: '项目' }).count(), 0, '0 个项目不显示 Home')
    await page.locator('#workspace-name').fill('项目 A')
    await page.getByRole('button', { name: '创建工作区', exact: true }).click()
    await page.getByRole('form', { name: '规划连接' }).waitFor({ state: 'visible' })
    // 1 个项目：Home 只有一行，且它就是当前项目。
    let region = await home(page)
    assert.equal(await region.locator('li').count(), 1, '1 个项目：Home 恰好一行')
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/)
    assert.deepEqual(await focused(page), { tag: 'H2', text: '项目' }, '进入 Home 回焦标题')
    // 创建 B：已存 A 时 Home 仍能创建第二个项目。
    await region.getByRole('button', { name: '创建工作区', exact: true }).click()
    await page.locator('#workspace-name').fill('项目 B')
    await page.getByRole('button', { name: '创建工作区', exact: true }).click()
    await page.getByRole('form', { name: '规划连接' }).waitFor({ state: 'visible' })
    region = await home(page)
    assert.equal(await region.locator('li').count(), 2, '2 个项目：Home 两行、创建序稳定')
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 B/)
    assert.equal(await region.getByRole('button', { name: '打开', exact: true }).count(), 1)
    // 键盘 A↔B：只靠 focus + Enter，不点鼠标；打开后焦点落到项目标题。
    const openA = region.locator('li').filter({ hasText: '项目 A' }).getByRole('button', { name: '打开', exact: true })
    await openA.focus(); await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '连接设置', exact: true }).waitFor({ state: 'visible' })
    assert.deepEqual(await focused(page), { tag: 'H2', text: '工作区' }, '打开项目后焦点落到项目标题')
    // A 尚未连接规划，项目内只有「连接设置」入口；从设置页进 Home 与真实用户路径一致。
    await page.getByRole('button', { name: '连接设置', exact: true }).click()
    region = await home(page)
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/, '键盘切回 A')
    // 失败切换：把 B 的策略改成 Host 不支持；A 仍权威，Home 就地给出说明。
    const catalogue = (await page.evaluate(() => window.fixture.remote.listWorkspaces())).value.workspaces
    const b = catalogue.find((row) => row.name === '项目 B')
    await page.evaluate(async (value) => { await fetch('/control', { method: 'POST', body: JSON.stringify({ action: 'policy', value }) }) }, { workspaceId: b.workspaceId, statusPolicy: 'manual_only' })
    await region.getByRole('button', { name: '打开', exact: true }).click()
    await region.getByRole('alert').waitFor({ state: 'visible' })
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/, '失败的切换不改变当前项目')
    await region.getByRole('button', { name: '重新读取', exact: true }).click()
    await region.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
    assert.match(await region.locator('li[aria-current="true"]').innerText(), /项目 A/, '重新读取后 A 仍权威')
    assert.equal(h.requests.filter((request) => request.name === 'createWorkspace').length, 2, '恰好两次创建：没有重复提交')
  })
})

test('reopen and deep links: the last confirmed project is restored, an explicit link outranks it and an unreadable target degrades honestly', { timeout: 150000 }, async (t) => {
  await scenario(t, { seed: 'restore' }, async ({ page, h }) => {
    const start = page.getByRole('region', { name: '项目' })
    await start.getByRole('heading', { name: '项目', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await start.locator('li').count(), 2, '两个已存项目都在 Home')
    assert.equal(await start.locator('li[aria-current="true"]').count(), 0, '没有偏好时不假装已选中项目')
    assert.deepEqual(await focused(page), { tag: 'H2', text: '项目' })
    // 打开 B，写入导航偏好。
    await start.locator('li').filter({ hasText: '项目 B' }).getByRole('button', { name: '打开', exact: true }).click()
    await visible(page, '项目 B 专属条目')
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目/, 'B 的页面不出现 A 的行')
    assert.equal((await selectionOf(h)).workspaceId, h.projectB, '成功打开后写入导航偏好')
    // 重开（fixture rebuild）：恢复到 B，不带 restore。
    await post(h, 'rebuild')
    await visible(page, '项目 B 专属条目')
    const setup = (await page.evaluate(() => window.fixture.remote.getWorkspaceSetup())).value
    assert.equal(setup.workspace.id, h.projectB, '重开恢复到 B'); assert.equal(setup.restore, undefined, '恢复成功不带 restore')
    // 显式深链优先于偏好：链接指向 A。
    await page.goto(h.url + '/projects/' + h.workspaceId + '/items')
    await visible(page, '项目 A 条目')
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 B 专属条目/, '显式链接打开目标后不残留偏好项目')
    assert.equal((await selectionOf(h)).workspaceId, h.workspaceId, '显式链接切换同样写偏好')
    // 不可读的链接目标：B 的策略被改成 Host 不支持，链接失败必须如实说明且不回退到 A。
    await post(h, 'policy', { workspaceId: h.projectB, statusPolicy: 'manual_only' })
    await page.goto(h.url + '/projects/' + h.projectB + '/items')
    await page.getByRole('alert').getByText('无法打开链接中的项目，请回到项目列表。', { exact: true }).waitFor({ state: 'visible' })
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目|项目 B 专属条目/, '失败的链接不得回退到当前或偏好项目')
    // 不可读的恢复偏好：损坏文件必须降级为安全 Home 说明，不打开任何项目。
    await writeFile(path.join(path.dirname(h.dataPath), SELECTION), '{"version":1,"workspaceId":"broken"', { mode: 0o600 })
    await page.goto(h.url + '/'); await page.waitForFunction(() => !!window.fixture)
    await post(h, 'rebuild')
    const degraded = page.getByRole('region', { name: '项目' })
    await degraded.getByText('上次打开的项目记录已损坏，请选择项目。', { exact: true }).waitFor({ state: 'visible' })
    assert.equal(await degraded.locator('li[aria-current="true"]').count(), 0, '损坏偏好不得回退到任何项目')
    assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目|项目 B 专属条目/, 'Home 说明不打开其它项目')
    assert.equal(await degraded.getByRole('button', { name: '创建工作区', exact: true }).count(), 1, 'Home 仍可创建项目')
  })
})

test('narrow 320/640 and light/dark themes keep Home and the project header readable without horizontal overflow', { timeout: 180000 }, async (t) => {
  for (const width of [320, 640]) {
    for (const theme of ['light', 'dark']) {
      await scenario(t, { seed: 'projects', viewport: { width, height: 720 }, theme }, async ({ page }) => {
        await visible(page, '项目 A 条目')
        const region = await home(page)
        assert.equal(await region.locator('li').count(), 2, width + 'px/' + theme + '：Home 两行都在')
        const atHome = await readability(page)
        assert.equal(atHome.theme, theme, '主题来自既有 fixture 参数')
        assert.ok(atHome.overflow <= 0, width + 'px/' + theme + '：Home 不得出现横向溢出，实际 ' + atHome.overflow)
        assert.ok(atHome.targets.length > 0 && Math.min(...atHome.targets) >= 44, width + 'px/' + theme + '：动作目标 >= 44px，实际 ' + Math.min(...atHome.targets))
        // 打开另一个项目后，项目标题与列表同样保持可读、无溢出。
        await region.getByRole('button', { name: '打开', exact: true }).click()
        await visible(page, '项目 B 专属条目')
        const atProject = await readability(page)
        assert.equal(atProject.theme, theme)
        assert.ok(atProject.overflow <= 0, width + 'px/' + theme + '：项目页不得出现横向溢出，实际 ' + atProject.overflow)
        assert.notEqual(atProject.color, '', '正文颜色必须可计算')
        assert.doesNotMatch(await page.locator('body').innerText(), /项目 A 条目/, '项目页不混入另一项目的行')
      })
    }
  }
})
