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


// Catches visible/AX comment leakage without deleting ordinary prose or code in the actual App style order.
test('production App hides prose comments and preserves adjacent and literal text without media', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } }), requests = [], errors = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<style>:root{font:16px/1.5 system-ui}body{margin:0}#app{height:100dvh;display:flex;flex-direction:column}</style><div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true, composite: true }) })
  await page.evaluate(body => window.setMarkdown(body), 'before <!--PROSE-CANARY-inline--> after\n\n<!--PROSE-CANARY-block\nmultiline-->TAIL😀<!--PROSE-CANARY-second-->END\n\n<!--PROSE-CANARY-only-->\n\n`<!--CODE-POSITIVE-->`\n\n```html\n<!--FENCE-POSITIVE-->\n```\n\n\\<!--ESCAPED-POSITIVE-->\n\n<div title="<!--ATTRIBUTE-POSITIVE-->"><!--PROSE-CANARY-tag--></div>\n\n<img src="https://example.invalid/raw">')
  const prose = page.locator('.hp-markdown')
  const text = await prose.innerText(), ax = await prose.ariaSnapshot()
  for (const observed of [text, ax]) {
    assert.doesNotMatch(observed, /PROSE-CANARY/)
    for (const expected of ['before after', 'TAIL😀END', '<!--CODE-POSITIVE-->', '<!--FENCE-POSITIVE-->', '<!--ESCAPED-POSITIVE-->', '<!--ATTRIBUTE-POSITIVE-->']) assert.ok(observed.includes(expected), expected)
  }
  assert.equal(await prose.locator('img,script,svg,iframe,[src],[srcset]').count(), 0)
  assert.deepEqual(requests, []); assert.deepEqual(errors, [])
})

// Catches duplicate bullets, first-line-only checkbox indentation, and flex/grid flattening nested or loose task blocks.
test('production App task markers and hanging wraps survive theme size and detail mode changes', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage(), errors = [], requests = []
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message)); page.on('crash', () => errors.push('crash'))
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.setContent('<style>:root{font:16px/1.5 system-ui;color-scheme:light dark}body{margin:0}#app{height:100dvh;display:flex;flex-direction:column}</style><div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true, composite: true }) })
  const words = 'task words 中文😀 '.repeat(26)
  const body = '- [x] Tight ' + words + '\n  - [ ] Nested ' + words + '\n\n- [ ] Loose ' + words + '\n\n  second paragraph retained\n\n  - ordinary child\n\n- ordinary sibling\n\n1. ordered sibling'
  await page.evaluate(body => window.setMarkdown(body), body)
  for (const [width, font, theme, expanded] of [[320, 16, 'light', false], [320, 32, 'dark', true], [1024, 32, 'light', false], [1440, 16, 'dark', true]]) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme })
    await page.evaluate(font => { document.documentElement.style.fontSize = font + 'px' }, font)
    const button = page.getByRole('button', { name: expanded ? '展开详情' : '还原详情', exact: true })
    if (await button.count()) await button.click()
    await page.locator('.hp-detail-body').evaluate(body => {
      body.scrollTop += body.querySelector('.hp-markdown').getBoundingClientRect().top - body.getBoundingClientRect().top - parseFloat(getComputedStyle(body).paddingTop)
    })
    const observed = await page.locator('.hp-markdown').evaluate(prose => {
      const tasks = [...prose.querySelectorAll('.task-list-item')].map(li => {
        const input = li.querySelector('input'), container = input.parentElement
        const text = [...container.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        const lines = []
        for (let index = 0; index < text.length; index++) {
          const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 1)
          const rect = range.getBoundingClientRect()
          if (rect.width && !lines.some(line => Math.abs(line.y - rect.y) < 1)) lines.push({ x: rect.x, y: rect.y })
        }
        const checkbox = input.getBoundingClientRect()
        return { marker: getComputedStyle(li).listStyleType, display: getComputedStyle(li).display, lines, right: checkbox.right, disabled: input.disabled, readOnly: input.readOnly, checked: input.checked }
      })
      const ordinary = [...prose.querySelectorAll('li:not(.task-list-item)')].map(li => getComputedStyle(li).listStyleType)
      const styles = [...document.querySelectorAll('.hp-workspace style')]
      const bodyRect = document.querySelector('.hp-detail-body').getBoundingClientRect(), first = prose.querySelector('input').getBoundingClientRect()
      return { tasks, ordinary, paragraphs: prose.querySelectorAll('.task-list-item > p').length,
        nested: prose.querySelectorAll('.task-list-item .task-list-item').length, contained: document.documentElement.scrollWidth <= innerWidth,
        firstTaskVisible: first.top >= bodyRect.top && first.bottom <= bodyRect.bottom,
        visibleBody: document.querySelector('.hp-detail-body').clientHeight > parseFloat(getComputedStyle(prose).lineHeight),
        dialogHeight: document.querySelector('dialog').getBoundingClientRect().height,
        workspaceStyleLast: styles.at(-1).textContent.includes('.hp-workspace {') }
    })
    assert.equal(observed.firstTaskVisible, true); assert.equal(observed.visibleBody, true); assert.ok(observed.dialogHeight > 300, 'bounded Host must expose visible drawer content')
    assert.equal(observed.workspaceStyleLast, true, 'exercise production WorkItemApp style after the drawer style')
    assert.equal(observed.tasks.length, 3)
    for (const task of observed.tasks) {
      assert.equal(task.display, 'list-item'); assert.equal(task.disabled, true); assert.equal(task.readOnly, true)
      assert.ok(task.lines.length > 1, 'fixture must wrap in every representative viewport')
      assert.ok(task.right < task.lines[0].x, 'checkbox stays left of text without overlap')
      for (const line of task.lines.slice(1)) assert.ok(Math.abs(line.x - task.lines[0].x) <= 2, 'hanging wrap: ' + JSON.stringify(task.lines))
      assert.equal(task.marker, 'none', JSON.stringify({ width, font, theme, expanded }))
    }
    assert.deepEqual(observed.tasks.map(task => task.checked), [true, false, false])
    assert.ok(observed.ordinary.includes('disc')); assert.ok(observed.ordinary.includes('decimal'))
    assert.ok(observed.paragraphs >= 2); assert.equal(observed.nested, 1); assert.equal(observed.contained, true)
  }
  await page.getByRole('button', { name: '关闭详情', exact: true }).focus(); await page.keyboard.press('Tab')
  assert.equal(await page.locator('input').evaluateAll(nodes => nodes.some(node => node === document.activeElement)), false)
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.deepEqual(errors, []); assert.deepEqual(requests, [])
})


// Catches absolute markers collapsing after filtering the only prose, including a first paragraph before other blocks.
for (const [name, body, checked] of [
  ['tight', '- [ ] <!--hidden-a-->\n- [x] <!--hidden-b-->\n- [ ] following', [false, true, false]],
  ['loose', '- [ ] <!--hidden-a-->\n\n- [x] <!--hidden-b-->\n\n- [ ] following', [false, true, false]],
  ['multiblock', '- [x] <!--hidden-a-->\n\n  visible second paragraph', [true]],
]) test(`comment-only ${name} tasks retain separate current-font marker lines`, async t => {
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } })
  await page.setContent('<style>:root{font:16px/1.5 system-ui}body{margin:0}#app{height:100dvh;display:flex;flex-direction:column}</style><div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true, composite: true }) })
  await page.evaluate(body => window.setMarkdown(body), body)
  for (const font of [16, 32]) {
    await page.evaluate(font => { document.documentElement.style.fontSize = font + 'px' }, font)
    const rows = await page.locator('.task-list-item').evaluateAll(nodes => nodes.map(li => {
      const input = li.querySelector('input'), rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
      return { ...rect(li), lineHeight: parseFloat(getComputedStyle(li).lineHeight), marker: rect(input), checked: input.checked,
        paragraphs: [...li.querySelectorAll(':scope > p')].map(p => ({ ...rect(p), text: p.textContent.trim() })) }
    }))
    assert.deepEqual(rows.map(row => row.checked), checked)
    for (const [index, row] of rows.entries()) {
      assert.ok(row.height >= row.lineHeight - 1, name + ': task reserves a current-font line')
      const first = row.paragraphs[0]
      if (first) {
        assert.ok(first.height >= row.lineHeight - 1, name + ': first paragraph reserves its own line')
        assert.ok(row.marker.top >= first.top && row.marker.bottom <= first.bottom, 'marker stays inside the first paragraph')
      }
      if (index > 0) assert.ok(rows[index - 1].marker.bottom < row.marker.top, 'consecutive task markers do not overlap vertically')
    }
    if (name === 'multiblock') {
      const [first, second] = rows[0].paragraphs
      assert.equal(first.text, ''); assert.equal(second.text, 'visible second paragraph')
      assert.ok(second.top > first.bottom + 1, 'second block remains separated from the empty marker paragraph')
    }
  }
})

// Catches visible/AX data loss when raw HTML literal contexts share a node or span inline HTML siblings.
test('production App preserves inert raw HTML literals without exposing adjacent real comments', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } }), requests = [], errors = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<style>:root{font:16px/1.5 system-ui}body{margin:0}#app{height:100dvh;display:flex;flex-direction:column}</style><div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true, composite: true }) })
  await page.evaluate(body => window.setMarkdown(body), '<textarea><!--TEXTAREA-POSITIVE--></textarea><!--PROSE-CANARY-->tail\n\n<script src="https://example.invalid/script">const s="<!--SCRIPT-POSITIVE-->";</script><!--PROSE-CANARY-->\n\n<![CDATA[<!--CDATA-FIRST--> <!--CDATA-SECOND-->]]><!--PROSE-CANARY-->end\n\nbefore <textarea><!--INLINE-POSITIVE--></textarea> <!--PROSE-CANARY--> after\n\n<style><!--STYLE-POSITIVE--></style>')
  const prose = page.locator('.hp-markdown')
  for (const observed of [await prose.innerText(), await prose.ariaSnapshot()]) {
    for (const literal of ['<!--TEXTAREA-POSITIVE-->', '<!--SCRIPT-POSITIVE-->', '<!--CDATA-FIRST-->', '<!--CDATA-SECOND-->', '<!--INLINE-POSITIVE-->', '<!--STYLE-POSITIVE-->', 'tail', 'end', 'after']) assert.ok(observed.includes(literal), literal)
    assert.doesNotMatch(observed, /PROSE-CANARY/)
  }
  assert.equal(await prose.locator('textarea,script,img,iframe,svg,[src],[srcset]').count(), 0)
  assert.equal(await prose.locator('style').count(), 1, 'only the trusted Markdown stylesheet is active')
  assert.deepEqual(requests, []); assert.deepEqual(errors, [])
})

// Script-data escape states must not expose/erase literal comment text or keep comments after the effective close.
test('production App preserves double-escaped script literals in visible and AX text', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } }), requests = [], errors = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<style>:root{font:16px/1.5 system-ui}body{margin:0}#app{height:100dvh;display:flex;flex-direction:column}</style><div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true, composite: true }) })
  await page.evaluate(body => window.setMarkdown(body), '<script><!--<script> A </script><!--DOUBLE-POSITIVE--></script><!--PROSE-CANARY-->tail\n\nbefore <script><!--<ScRiPt > A </sCrIpT ><!--INLINE-DOUBLE-POSITIVE--></script><!--PROSE-CANARY-->end\n\nbefore <script>`<!--`<script> A </script><!--SPLIT-POSITIVE--></script><!--PROSE-CANARY-->after')
  const prose = page.locator('.hp-markdown')
  for (const observed of [await prose.innerText(), await prose.ariaSnapshot()]) {
    for (const literal of ['<!--DOUBLE-POSITIVE-->', '<!--INLINE-DOUBLE-POSITIVE-->', '<!--SPLIT-POSITIVE-->', 'tail', 'end', 'after']) assert.ok(observed.includes(literal), literal)
    assert.doesNotMatch(observed, /PROSE-CANARY/)
  }
  assert.equal(await prose.locator('script,textarea,img,iframe,svg,[src],[srcset]').count(), 0)
  assert.deepEqual(requests, []); assert.deepEqual(errors, [])
})

// A closing tag in code may end active raw text, but code-only opening tags must not hide later prose comments.
test('production App keeps code gap tags from opening HTML literal contexts', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } }), requests = [], errors = []
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<style>:root{font:16px/1.5 system-ui}body{margin:0}#app{height:100dvh;display:flex;flex-direction:column}</style><div id="app"></div>')
  await page.addScriptTag({ content: await markdownBundle({ production: true, composite: true }) })
  await page.evaluate(body => window.setMarkdown(body), 'before <script>`</script><textarea>`<!--PROSE-CANARY-->tail\n\nbefore <textarea>`</textarea><script>`<!--PROSE-CANARY-->end\n\nbefore <script>`</script><textarea>`<textarea><!--HTML-NODE-POSITIVE--></textarea><!--PROSE-CANARY-->after')
  const prose = page.locator('.hp-markdown')
  for (const observed of [await prose.innerText(), await prose.ariaSnapshot()]) {
    assert.doesNotMatch(observed, /PROSE-CANARY/)
    for (const literal of ['</script><textarea>', '</textarea><script>', '<!--HTML-NODE-POSITIVE-->', 'tail', 'end', 'after']) assert.ok(observed.includes(literal), literal)
  }
  assert.equal(await prose.locator('script,textarea,img,iframe,svg,[src],[srcset]').count(), 0)
  assert.deepEqual(requests, []); assert.deepEqual(errors, [])
})
