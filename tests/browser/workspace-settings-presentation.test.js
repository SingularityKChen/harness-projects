import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { startServer } from '../fixtures/workspace-forms-browser.mjs'

test('real settings carrier retains four tasks, draft and pending/unknown recovery across the narrow chooser', async t => {
  const server = await startServer(), browser = await chromium.launch()
  t.after(() => server.close()); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), errors = []
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.url + '/?stage=configured&controls=hidden')
  await page.getByRole('heading', { name: '连接设置', exact: true }).waitFor()
  const nav = page.getByRole('navigation', { name: '设置任务' })
  for (const name of ['规划连接', '字段映射', '执行', '仓库']) {
    await nav.getByRole('button', { name, exact: true }).click()
    assert.equal(await page.locator('.hp-settings-panel:visible').count(), 1)
    assert.equal(await page.locator('.hp-settings-panel:visible').getByRole('heading', { name, exact: true }).count(), 1)
  }
  await nav.getByRole('button', { name: '规划连接', exact: true }).click()
  const project = page.getByLabel('GitHub Project node ID', { exact: true })
  await project.fill('PVT_draft'); await page.getByRole('button', { name: '连接项目', exact: true }).click()
  await page.waitForFunction(() => window.__forms.pending().includes('planning-account'))
  assert.equal(await project.isDisabled(), true)
  assert.doesNotMatch(await page.locator('#app').innerText(), /Saved|已保存|规划连接已确认/)
  await page.evaluate(() => window.__forms.release('planning-account', 'unknown'))
  await page.getByRole('alert').getByText('结果未知，请重新读取确认。', { exact: true }).waitFor()
  assert.equal(await project.inputValue(), 'PVT_draft')
  await page.setViewportSize({ width: 390, height: 900 })
  const chooser = page.getByRole('combobox', { name: '任务', exact: true }); await chooser.selectOption('repository')
  assert.equal(await page.getByLabel('本地仓库路径', { exact: true }).isVisible(), true)
  assert.equal(await page.getByRole('alert').isVisible(), true, 'task-independent unknown recovery remains reachable')
  const calls = await page.evaluate(() => window.__forms.calls().length)
  await page.evaluate(() => window.__forms.refresh())
  assert.equal(await page.evaluate(() => window.__forms.calls().length), calls, 'a background read never resends an unknown write')
  await chooser.selectOption('planning'); assert.equal(await project.inputValue(), 'PVT_draft')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  assert.doesNotMatch(await page.locator('#app').textContent(), /RAW-ERROR-CANARY|secret-token-canary/)
  assert.deepEqual(errors, [])
})

// A local Canvas override must never break the Host's primary foreground/fill pair.
test('real four-task settings uses Host primary pairs, one 720px column and independent 44px targets', async t => {
  const server = await startServer(), browser = await chromium.launch()
  t.after(() => server.close()); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  for (const theme of ['light', 'dark']) {
    await page.goto(server.url + '/?stage=configured&controls=hidden&roles=reference&theme=' + theme)
    const nav = page.getByRole('navigation', { name: '设置任务' }); await nav.waitFor()
    const layout = await page.locator('.hp-settings-layout').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat))
    assert.deepEqual(layout, [160, 720])
    for (const task of ['规划连接', '字段映射', '执行', '仓库']) {
      await nav.getByRole('button', { name: task, exact: true }).click()
      for (const button of await page.locator('.hp-settings-panel:visible .hp-action-primary').all()) {
        const actual = await button.evaluate(el => { const css = getComputedStyle(el); return [css.color, css.backgroundColor] })
        assert.deepEqual(actual, theme === 'dark' ? ['rgb(15, 17, 21)', 'rgb(249, 250, 251)'] : ['rgb(255, 255, 255)', 'rgb(15, 17, 21)'])
      }
      for (const control of await page.locator('.hp-settings :is(button,input,select):visible').all()) assert.ok((await control.boundingBox()).height >= 44)
    }
  }
})
