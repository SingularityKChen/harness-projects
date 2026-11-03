import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { createEntityStore } from '@harness-projects/client'
import { deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { WorkItemDetailDrawer } from '@harness-projects/ui'
import { wire } from '../fixtures/work-item-wire.mjs'

const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const render = body => renderToStaticMarkup(createElement(WorkItemDetailDrawer, {
  view: { body: { kind: 'content', title: 'Title', body, planningStatus: '状态', iteration: '—', targetDate: '—', source: 'Source', authority: 'provider', stale: false, refreshing: false } }, onClose() {},
}))
const hrefs = html => [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1])

// Catches replacing the presenter with plain text, omitting GFM, or normalizing code/Unicode.
test('detail renders semantic GFM with literal code, Unicode and empty content', () => {
  const html = render('# 标题😀\n\n- 一级\n  - 二级\n\n1. 顺序\n\n- [x] 已完成\n- [ ] 未完成\n\n> 引用\n\n`内联`\n\n```js\n  const x = "<b>"\n    next()\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 中文 | **加粗**与~~删除~~ |')
  for (const expected of [/<h1>标题😀<\/h1>/, /<ul>/, /<ol>/, /<blockquote>/, /<code>内联<\/code>/, /<table>/, /<th>名称<\/th>/, /<strong>加粗<\/strong>/, /<del>删除<\/del>/]) assert.match(html, expected)
  assert.match(html, /  const x = &quot;&lt;b&gt;&quot;\n    next\(\)\n/)
  assert.match(html, /<pre tabindex="0" role="region" aria-label="正文代码（可横向滚动）">/)
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2)
  for (const input of html.match(/<input[^>]+>/g)) assert.match(input, /disabled=""/)
  assert.doesNotMatch(html, /onchange|onclick/i)
  assert.match(render(''), /class="hp-markdown"/)
})

// Catches admitting relative URLs/schemes or passing unreviewed renderer props.
test('only absolute HTTP(S) destinations become explicit safe new-window links', () => {
  const rejected = ['javascript:alert%281%29', 'data:text/plain,hello', 'file:///tmp/a', 'custom:thing', 'mailto:a@example.invalid', '/root', './local', '../parent', '#fragment', '//example.invalid/path', 'https:relative', 'https://exa&#x09;mple.invalid/a', 'https://example.invalid/a&#x09;b', 'https://example.invalid/a%0Ab', 'https://example.invalid/a%00b']
  for (const url of rejected) {
    assert.deepEqual(hrefs(render(`[标签](${url})`)), [], url)
  }
  for (const url of ['https://example.invalid/a?q=1', 'http://example.invalid/a', 'HTTPS://example.invalid/a']) {
    const html = render(`[标签](${url})`)
    assert.equal(hrefs(html).length, 1, url)
    assert.match(html, /target="_blank" rel="noopener noreferrer"/)
    assert.match(html, />标签<\/a>/)
  }
  assert.deepEqual(hrefs(render('<https://example.invalid/auto>')), ['https://example.invalid/auto'])
})

// Catches introducing img/HTML execution, losing alt, or nested interactive anchors.
test('HTML stays inert and images expose only an explicit safe source action', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://example.invalid/raw" onerror="alert(1)">\n\n<svg onload="alert(1)"></svg>\n\n<iframe src="https://example.invalid/frame"></iframe>\n\n![替代😀](https://example.invalid/pixel.png)\n\n![本地](/relative.png)\n\n![危险](data:image/png;base64,AAAA)')
  assert.doesNotMatch(html, /<(?:img|picture|script|svg|iframe)\b|<[^>]+\bsrc(?:set)?=/i)
  for (const text of ['替代😀', '本地', '危险']) assert.ok(html.includes(text), text)
  assert.deepEqual(hrefs(html), ['https://example.invalid/pixel.png'])
  assert.match(html, />打开图片来源<\/a>/)
  const nested = render('[![内图](https://example.invalid/image)](https://example.invalid/outer)')
  assert.deepEqual(hrefs(nested), ['https://example.invalid/image'])
  assert.doesNotMatch(nested, /<a\b[^>]*>[^]*<a\b/)
})

// Catches placing the presenter above the existing safety projection or mounting it for blocked views.
test('redacted unavailable unresolved loading and wrong-workspace never mount the presenter', () => {
  const store = createEntityStore()
  const canary = '# CANARY-BODY\n\n![CANARY-ALT](https://example.invalid/CANARY-URL)'
  const entity = wire('ent-aa', { content: { body: canary } })
  store.applyBaseline({ revision: 0, entities: [entity], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
  const base = { read: { workspace: { id: 'ws-1', name: 'Workspace' }, store, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }, metadata: { planningSourceName: 'Source', sourceNames: {} }, phase: 'received', refreshing: false }
  const target = { projectId: 'ws-1', itemId: 'ent-aa' }
  const blocked = [
    deriveWorkItemDetailView(base, { ...target, projectId: 'wrong' }),
    deriveWorkItemDetailView(base, { ...target, itemId: 'missing' }),
    deriveWorkItemDetailView({ ...base, phase: 'pending' }, target),
    deriveWorkItemDetailView({ ...base, phase: 'failed', hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind: 'permission_denied' } }, target),
  ]
  store.applyBaseline({ revision: 1, entities: [{ ...entity, content: { ...entity.content, contentKind: 'redacted' } }], source: { revision: 1, freshness: 'fresh', authority: 'provider' } })
  blocked.push(deriveWorkItemDetailView(base, target))
  assert.deepEqual(blocked.map(view => view.body.kind), ['unresolved', 'unresolved', 'loading', 'unavailable', 'redacted'])
  for (const view of blocked) {
    const html = renderToStaticMarkup(createElement(WorkItemDetailDrawer, { view, onClose() {} }))
    assert.doesNotMatch(html, /CANARY|hp-markdown|example\.invalid/)
  }
})

// Catches uncontrolled recursive AST conversion and discarding the original body in the fallback.
test('ordinary nesting stays semantic while excessive structure falls back to the complete literal body', () => {
  const ordinary = render('> 外层\n> > 内层\n\n- 一级\n  - 二级')
  assert.equal((ordinary.match(/<blockquote>/g) ?? []).length, 2)
  assert.equal((ordinary.match(/<ul>/g) ?? []).length, 2)
  const body = '> '.repeat(2000) + 'text'
  const html = render(body)
  assert.doesNotMatch(html, /<blockquote>/)
  assert.ok(html.includes('&gt; '.repeat(2000) + 'text'), 'full original text remains escaped and untruncated')
  const literal = render(body + '\n\n![image](https://evil.invalid/image) <script>alert(1)</script>')
  assert.deepEqual(hrefs(literal), [])
  assert.doesNotMatch(literal, /<(?:img|script)\b/)
  assert.ok(literal.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
})

// Catches treating only images as interactive descendants of an outer anchor.
test('nested autolinks neutralize the outer link and preserve the safe inner action', () => {
  const html = render('[a <https://evil.invalid/in>](https://evil.invalid/out)')
  assert.deepEqual(hrefs(html), ['https://evil.invalid/in'])
  assert.match(html, /target="_blank" rel="noopener noreferrer"/)
  assert.doesNotMatch(html, /<a\b[^>]*>[^]*<a\b/)
})
