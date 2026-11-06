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


// Catches whole-html-node deletion, source regex filtering, lost visible tails, and malformed scans crossing nodes.
test('HTML comment spans disappear while adjacent prose and inert attribute/code literals survive', () => {
  for (const [body, expected] of [
    ['left <!--COMMENT-inline--> right', '<p>left  right</p>'],
    ['<!--COMMENT-block-->尾部😀', '尾部😀'],
    ['<!--COMMENT-first-->中间 <!--COMMENT-second--> 末尾', '中间  末尾'],
    ['<!--COMMENT-multi\nline-->after', 'after'],
    ['<!--COMMENT-only-->', ''],
    ['<div title="<!--attribute-->"><!--COMMENT-nested--></div>', '&lt;div title=&quot;&lt;!--attribute--&gt;&quot;&gt;&lt;/div&gt;'],
    ["<div title='<!--single-->'><!--COMMENT-nested--></div>", '&lt;div title=&#x27;&lt;!--single--&gt;&#x27;&gt;&lt;/div&gt;'],
    ['<!--COMMENT-outer <!--inner-->tail', 'tail'],
    ['<!--COMMENT-a--b-->tail', 'tail'],
    ['<!--COMMENT-unclosed', ''],
    ['<!-->COMMENT-malformed', ''],
    ['<!--->COMMENT-malformed', ''],
  ]) {
    const prose = render(body).split('class="hp-markdown">')[1].split('</style>')[1].split('</div>')[0]
    assert.equal(prose, expected, body)
    assert.doesNotMatch(prose, /COMMENT/)
  }
  const literals = render('`<!--inline-code-->`\n\n```html\n<!--fenced-code-->\n```\n\n\\<!--escaped-->\n\nbefore <!--unclosed-text\n\n```\nindependent-code\n```')
  for (const literal of ['&lt;!--inline-code--&gt;', '&lt;!--fenced-code--&gt;', '&lt;!--escaped--&gt;', 'before &lt;!--unclosed-text', 'independent-code']) assert.ok(literals.includes(literal), literal)
  assert.match(literals, /<code>independent-code\n<\/code>/)
  const deep = render('> '.repeat(2000) + '<!--depth-literal-->')
  assert.ok(deep.includes('&lt;!--depth-literal--&gt;'), 'depth fallback remains the complete code literal')
})

// Catches treating raw-text/RCDATA or CDATA literals as comments, including inline sibling HTML nodes.
test('inert HTML literal contexts preserve comment-shaped text until their actual boundary', () => {
  for (const [body, expected] of [
    ['<textarea><!--TEXTAREA-LITERAL--></textarea><!--HIDE-->tail', '&lt;textarea&gt;&lt;!--TEXTAREA-LITERAL--&gt;&lt;/textarea&gt;tail'],
    ['<script>const s = "<!--SCRIPT-LITERAL-->";</script><!--HIDE-->tail', '&lt;script&gt;const s = &quot;&lt;!--SCRIPT-LITERAL--&gt;&quot;;&lt;/script&gt;tail'],
    ['<STYLE><!--STYLE-LITERAL--></sTyLe><!--HIDE-->tail', '&lt;STYLE&gt;&lt;!--STYLE-LITERAL--&gt;&lt;/sTyLe&gt;tail'],
    ['<![CDATA[<!--CDATA-FIRST--> <!--CDATA-SECOND-->]]><!--HIDE-->tail', '&lt;![CDATA[&lt;!--CDATA-FIRST--&gt; &lt;!--CDATA-SECOND--&gt;]]&gt;tail'],
    ['<textarea>unclosed <!--UNCLOSED-LITERAL-->', '&lt;textarea&gt;unclosed &lt;!--UNCLOSED-LITERAL--&gt;'],
    ['<![CDATA[<!--UNCLOSED-CDATA-A--> <!--UNCLOSED-CDATA-B-->', '&lt;![CDATA[&lt;!--UNCLOSED-CDATA-A--&gt; &lt;!--UNCLOSED-CDATA-B--&gt;'],
    ['before <textarea><!--INLINE-LITERAL--></textarea> <!--HIDE--> after', '<p>before &lt;textarea&gt;&lt;!--INLINE-LITERAL--&gt;&lt;/textarea&gt;  after</p>'],
    ['before <script>"<!--INLINE-SCRIPT-->"</script><!--HIDE--> after', '<p>before &lt;script&gt;&quot;&lt;!--INLINE-SCRIPT--&gt;&quot;&lt;/script&gt; after</p>'],
    ['<textarea><!--A--></textareax><!--B--></textarea><!--HIDE-->', '&lt;textarea&gt;&lt;!--A--&gt;&lt;/textareax&gt;&lt;!--B--&gt;&lt;/textarea&gt;'],
    ['<pre>before<!--HIDE-->after</pre>', '&lt;pre&gt;beforeafter&lt;/pre&gt;'],
  ]) {
    const prose = render(body).split('class="hp-markdown">')[1].split('</style>')[1].split('</div>')[0]
    assert.equal(prose, expected, body)
    assert.doesNotMatch(prose, /HIDE/)
  }
  const isolated = render('before <textarea><!--LOCAL-LITERAL-->\n\n<!--HIDE-independent-block-->')
  assert.ok(isolated.includes('&lt;!--LOCAL-LITERAL--&gt;'))
  assert.doesNotMatch(isolated, /HIDE-independent-block/)
})

// Headings and GFM cells also own inline sibling HTML nodes; their raw context cannot leak to another block/cell.
test('heading and table cell raw HTML literals keep their inline scope', () => {
  const html = render('# before <textarea><!--HEADING-LITERAL--></textarea><!--HIDE-heading-->\n\n| first | second |\n| --- | --- |\n| <textarea><!--CELL-LITERAL--> | <!--HIDE-cell-->ordinary |')
  assert.ok(html.includes('&lt;!--HEADING-LITERAL--&gt;'))
  assert.ok(html.includes('&lt;!--CELL-LITERAL--&gt;'))
  assert.doesNotMatch(html, /HIDE-heading|HIDE-cell/)
  assert.match(html, /<td>ordinary<\/td>/)
})

// Script double-escaped content treats the first </script> as literal, then returns to escaped/normal states.
test('inert script escape states preserve literals until the effective closing tag', () => {
  for (const [body, expected] of [
    ['<script><!--<script> A </script><!--DOUBLE-LITERAL--></script><!--HIDE-->tail', '&lt;script&gt;&lt;!--&lt;script&gt; A &lt;/script&gt;&lt;!--DOUBLE-LITERAL--&gt;&lt;/script&gt;tail'],
    ['<script><!--<ScRiPt > A </sCrIpT ><!--CASE-LITERAL--></SCRIPT><!--HIDE-->tail', '&lt;script&gt;&lt;!--&lt;ScRiPt &gt; A &lt;/sCrIpT &gt;&lt;!--CASE-LITERAL--&gt;&lt;/SCRIPT&gt;tail'],
    ['<script><!--<scriptx> A </script><!--HIDE-->tail', '&lt;script&gt;&lt;!--&lt;scriptx&gt; A &lt;/script&gt;tail'],
    ['<script><!--<script> A --><!--NORMAL-LITERAL--></script><!--HIDE-->tail', '&lt;script&gt;&lt;!--&lt;script&gt; A --&gt;&lt;!--NORMAL-LITERAL--&gt;&lt;/script&gt;tail'],
  ]) {
    const prose = render(body).split('class="hp-markdown">')[1].split('</style>')[1].split('</div>')[0]
    assert.equal(prose, expected, body)
  }
  const inline = render('before <script><!--<script> A </script><!--INLINE-DOUBLE-LITERAL--></script><!--HIDE-->tail')
  assert.ok(inline.includes('&lt;!--INLINE-DOUBLE-LITERAL--&gt;'))
  assert.doesNotMatch(inline, /HIDE/)
  const split = render('before <script>`<!--`<script> A </script><!--SPLIT-LITERAL--></script><!--HIDE-->tail')
  assert.ok(split.includes('&lt;!--SPLIT-LITERAL--&gt;'))
  assert.match(split, /<code>&lt;!--<\/code>/)
  assert.doesNotMatch(split, /HIDE/)
  const encoded = render('before <script>`&lt;!--`<script> A </script><!--HIDE-->tail')
  assert.doesNotMatch(encoded, /HIDE/, 'script state follows source syntax, not decoded Markdown node values')
})

// Only HTML nodes may open literal contexts; intervening code/text may end an existing context only.
test('source gaps stop at the active raw close without opening code-only tags', () => {
  for (const body of [
    'before <script>`</script><textarea>`<!--HIDE-->tail',
    'before <script>`</script><script>`<!--HIDE-->tail',
    'before <textarea>`</textarea><script>`<!--HIDE-->tail',
    'before <style>`</style><textarea>`<!--HIDE-->tail',
  ]) {
    const html = render(body)
    assert.doesNotMatch(html, /HIDE/, body)
    assert.ok(html.includes('tail'))
    assert.match(html, /<code>&lt;\/(?:script|textarea|style)&gt;&lt;(?:textarea|script)&gt;<\/code>/)
  }
  const legitimate = render('before <script>`</script><textarea>`<textarea><!--HTML-NODE-LITERAL--></textarea><!--HIDE-->tail')
  assert.ok(legitimate.includes('&lt;!--HTML-NODE-LITERAL--&gt;'))
  assert.doesNotMatch(legitimate, /HIDE/)
})
