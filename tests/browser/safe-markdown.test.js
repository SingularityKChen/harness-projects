import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { markdownBundle } from '../fixtures/safe-markdown-browser.mjs'

// Removing the explicit code focus target makes the drawer cycle on its only button.
test('code-only read-only detail exposes long fenced code to Tab and horizontal arrow scrolling', async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 480 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true }) })
  await page.evaluate(body => window.setMarkdown(body), '```\n' + 'x'.repeat(600) + '\n```')
  const code = page.locator('pre'), close = page.getByRole('button', { name: '关闭详情', exact: true })
  assert.equal(await code.evaluate(node => node.scrollWidth > node.clientWidth), true)
  await close.focus()
  await page.keyboard.press('Tab')
  assert.equal(await code.evaluate(node => node === document.activeElement), true, 'Tab must reach long code rather than cycle on close')
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('pre').scrollLeft > 0)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await close.evaluate(node => node === document.activeElement), true)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const firstAction = page.locator('.hp-detail-header').getByRole('button', { disabled: false }).first()
  assert.equal(await firstAction.evaluate(node => node === document.activeElement), true, 'the last code target cycles to the first accessible header action')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
})

// Catches detail reset collapsing fenced code, table overflow escaping the prose, image requests, and active HTML.
test('real detail browser preserves code and contains tables without automatic media or unsafe navigation', async t => {
  const bundle = await markdownBundle(), requests = [], errors = []
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } })
  page.setDefaultTimeout(5000)
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle })
  const code = '  const spaced = "' + 'long'.repeat(70) + '"\n    second()\n'
  const body = '# 可读😀\n\n- [x] 已做\n- [ ] 待做\n\n```js\n' + code + '```\n\n| 长列 | 第二列 |\n| --- | --- |\n| ' + 'long'.repeat(90) + ' | text |\n\n[安全链接](https://example.invalid/open)\n\n![图片替代](https://example.invalid/pixel.png)\n\n[![内图](https://example.invalid/nested.png)](https://example.invalid/outer)\n\n[本地](/local) [危险](javascript:alert%281%29)\n\n<img src="https://example.invalid/raw" onerror="window.attacked=true">\n\n<svg onload="window.attacked=true"></svg>\n\n<iframe src="https://example.invalid/frame"></iframe>\n\n<script>window.attacked=true</script>'
  await page.evaluate(body => window.setMarkdown(body), body)
  await page.getByRole('heading', { name: '可读😀', exact: true }).waitFor()
  assert.equal(await page.locator('pre code').textContent(), code)
  const geometry = await page.locator('.hp-markdown').evaluate(prose => {
    const pre = prose.querySelector('pre'), code = pre.querySelector('code'), table = prose.querySelector('table'), wrapper = table.parentElement
    return { pre: getComputedStyle(pre).whiteSpace, code: getComputedStyle(code).whiteSpace, wrap: getComputedStyle(code).overflowWrap,
      preScroll: pre.scrollWidth > pre.clientWidth, tableScroll: wrapper.scrollWidth > wrapper.clientWidth,
      contained: prose.scrollWidth <= prose.clientWidth + 1, body: document.documentElement.scrollWidth <= innerWidth }
  })
  assert.deepEqual(geometry, { pre: 'pre', code: 'pre', wrap: 'normal', preScroll: true, tableScroll: true, contained: true, body: true })
  assert.equal(await page.locator('input:disabled').count(), 2)
  assert.equal(await page.locator('img,picture,iframe,svg').count(), 0)
  assert.equal(await page.locator('.hp-markdown a a').count(), 0)
  assert.equal(await page.locator('.hp-markdown [src],.hp-markdown [srcset]').count(), 0)
  assert.deepEqual(await page.locator('.hp-markdown a').evaluateAll(nodes => nodes.map(node => node.href)), ['https://example.invalid/open', 'https://example.invalid/pixel.png', 'https://example.invalid/nested.png'])
  assert.equal(await page.evaluate(() => window.attacked), undefined)
  assert.deepEqual(requests, [], 'zero media requests before an explicit click')
  const link = page.getByRole('link', { name: '安全链接', exact: true })
  await page.getByRole('button', { name: '关闭详情', exact: true }).focus()
  const focused = []
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press('Tab')
    focused.push(await page.evaluate(() => document.activeElement.className))
    if (await link.evaluate(node => node === document.activeElement)) break
  }
  assert.ok(focused.includes('hp-markdown-table'), 'keyboard reaches the horizontally scrollable table')
  assert.equal(await link.evaluate(node => node === document.activeElement), true)
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer')
  assert.equal(await link.getAttribute('target'), '_blank')
  for (const mode of ['redacted', 'unavailable', 'unresolved', 'loading', 'wrong-workspace']) {
    await page.evaluate(({ body, mode }) => window.setMarkdown(body, mode), { body: '# CANARY-BODY\n\n![CANARY-ALT](https://example.invalid/CANARY-URL)', mode })
    assert.equal(await page.locator('.hp-markdown').count(), 0, mode + ': presenter mount=0')
    assert.doesNotMatch(await page.locator('body').innerHTML(), /CANARY/, mode)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
})

// Catches renderer-process crashes before an ErrorBoundary could run and overlapping nested navigation.
test('production browser survives excessive nesting, preserves the body and closes normally', { timeout: 30000 }, async t => {
  const browser = await chromium.launch()
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } })
  const crashes = [], errors = []
  page.on('crash', () => crashes.push('crash'))
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true }) })
  await page.evaluate(() => window.setMarkdown('> normal\n> > nested\n\n- outer\n  - inner'))
  assert.equal(await page.locator('.hp-markdown blockquote blockquote').count(), 1)
  assert.equal(await page.locator('.hp-markdown ul ul').count(), 1)
  const body = '> '.repeat(2000) + 'text'
  await page.evaluate(body => window.setMarkdown(body), body)
  assert.equal(await page.locator('.hp-markdown blockquote').count(), 0)
  assert.ok((await page.locator('.hp-markdown').textContent()).includes(body))
  await page.screenshot({ timeout: 5000 })
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.evaluate(() => window.setMarkdown('[a <https://evil.invalid/in>](https://evil.invalid/out)'))
  assert.equal(await page.locator('.hp-markdown a a').count(), 0)
  assert.deepEqual(await page.locator('.hp-markdown a').evaluateAll(nodes => nodes.map(node => node.href)), ['https://evil.invalid/in'])
  assert.deepEqual(crashes, [])
  assert.deepEqual(errors, [])
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})
