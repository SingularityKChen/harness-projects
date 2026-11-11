import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { createEntityStore } from '@harness-projects/client'
import { deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { WorkItemDetailDrawer } from '@harness-projects/ui'
import { wire } from '../fixtures/work-item-wire.mjs'

const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const render = (body, markdownSource) => renderToStaticMarkup(createElement(WorkItemDetailDrawer, {
  view: { body: { kind: 'content', title: 'Title', body, markdownSource, planningStatus: '状态', iteration: '—', targetDate: '—', schedule: { target: { kind: 'missing' }, iteration: { kind: 'missing' } }, source: 'Source', authority: 'provider', stale: false, refreshing: false } }, onClose() {},
}))
const hrefs = html => [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1])
const github = { namespace: 'github.com/graphql/Repository', repository: 'sample/alpha' }

// Catches missing context, token normalization, unsafe numbers and accepting extra GitHub syntax.
test('source references link only the two accepted literal forms in the current context', () => {
  const body = '(#328), sample/beta#329! #9007199254740991'
  assert.deepEqual(hrefs(render(body, github)), ['https://github.com/sample/alpha/issues/328', 'https://github.com/sample/beta/issues/329', 'https://github.com/sample/alpha/issues/9007199254740991'])
  assert.match(render(body, github), />sample\/beta#329<\/a>/)
  for (const source of [undefined, { namespace: 'other/Repository', repository: 'sample/alpha' }, { ...github, repository: '../alpha' }]) assert.deepEqual(hrefs(render(body, source)), [])
  const rejected = '#0 #01 #9007199254740992 #12a a#12 repo#12 GH-12 @sample deadbee owner@deadbee bad_owner/repo#12 a/../repo#12 /sample/alpha#12 #12/next #12.3'
  assert.deepEqual(hrefs(render(rejected, github)), [])
})

// Catches linkifying decoded escapes/entities, code, existing labels, or a text node inside raw HTML.
test('source references preserve escaped and inert ranges while keeping neighboring literal references', () => {
  for (const body of [
    String.raw`\#328 &#35;328 &#x23;328 #328`,
    String.raw`sample\/alpha#328 sample/alpha\#328 sample/alpha&#35;328 #328`,
    '`#328 sample/beta#328` #328',
    '```md\n#328 sample/beta#328\n```\n\n#328',
    '[#328](https://example.invalid/existing) #328',
    '[#328][ref] #328\n\n[ref]: https://example.invalid/existing',
    '![#328](https://example.invalid/image) #328',
    '<span title="#328"> #328',
    'before <textarea>#328 sample/beta#328</textarea> #328',
    'before <title>#328</title> #328',
    'before <script>#328 `<!--`<script>#328</script>#328</script> #328',
    'before <!-- #328 --> #328',
    '<![CDATA[#328]]>\n\n#328',
  ]) {
    const expected = body.includes('example.invalid/existing') ? ['https://example.invalid/existing', 'https://github.com/sample/alpha/issues/328']
      : body.includes('example.invalid/image') ? ['https://example.invalid/image', 'https://github.com/sample/alpha/issues/328'] : ['https://github.com/sample/alpha/issues/328']
    assert.deepEqual(hrefs(render(body, github)), expected, body)
  }
  for (const body of ['before <textarea>#328', '> '.repeat(80) + '#328', '<script>#328</script>', '<![CDATA[#328]]>']) assert.deepEqual(hrefs(render(body, github)), [], body)
  assert.deepEqual(hrefs(render('<https://github.com/sample/alpha/issues/328> #328', github)), ['https://github.com/sample/alpha/issues/328', 'https://github.com/sample/alpha/issues/328'])
  assert.deepEqual(hrefs(render('&#97;#328 #328&#49; #328&#46;9 #328', github)), ['https://github.com/sample/alpha/issues/328'])
})

// Catches treating text offsets as raw source offsets after parser-owned continuation prefixes.
test('references in multiline Markdown leaves preserve parser text and CRLF source positions', () => {
  for (const body of ['> first\n> #328', '- first\n  #328', 'line\r\n#328', '> &#35;328\n> #328']) {
    assert.deepEqual(hrefs(render(body, github)), ['https://github.com/sample/alpha/issues/328'], body)
  }
})

// Catches unbounded qualified-token backtracking on ordinary prose; timeout is a generous process guard, not a benchmark.
test('reference scanning stays bounded on long plain text and preserves repository length limits', () => {
  const module = new URL('../../packages/ui/src/markdown-references.ts', import.meta.url).href
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { markdownReferences } from ${JSON.stringify(module)}
    const source = 'a'.repeat(200000) + ' #328'
    const tree = { type: 'root', children: [{ type: 'text', value: source, position: { start: { offset: 0 }, end: { offset: source.length } } }] }
    markdownReferences({ namespace: 'github.com/graphql/Repository', repository: 'sample/alpha' })(tree, { value: source })
    console.log(JSON.stringify({ plain: tree.children[0].value.length, links: tree.children.filter(node => node.type === 'link').map(node => node.url) }))
  `], { encoding: 'utf8', timeout: 4000 })
  assert.deepEqual(JSON.parse(output), { plain: 200001, links: ['https://github.com/sample/alpha/issues/328'] })
  const maximum = 'a'.repeat(39) + '/' + 'b'.repeat(100)
  assert.deepEqual(hrefs(render(maximum + '#328', github)), ['https://github.com/' + maximum + '/issues/328'])
  assert.deepEqual(hrefs(render('a'.repeat(40) + '/repo#328 sample/' + 'b'.repeat(101) + '#328', github)), [])
})

// Catches ending the inert range at the opening '<' of a raw closing literal, including quoted '>'.
test('raw-text closing literals stay inert through the full quoted marker while trailing prose links', () => {
  for (const tag of ['textarea', 'title', 'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']) {
    for (const closing of [`</${tag} #2>`, `</${tag}\n#2>`, `</${tag} x="#2">`, `</${tag} x="> #2">`, `</${tag} x='> #2'>`]) {
      const body = `before <${tag}>#1${closing} #3`
      assert.deepEqual(hrefs(render(body, github)), ['https://github.com/sample/alpha/issues/3'], body)
    }
  }
})

// Catches HTML leaves inside quoted raw closing attributes reopening or shortening the inert interval.
test('raw closing attributes keep nested HTML inert and restore real trailing references', () => {
  for (const tag of ['textarea', 'title', 'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']) {
    for (const [closing, number] of [
      [`</${tag} x="<title>#2"> #3`, 3],
      [`</${tag} x="<title>#2</title #3> #4"> #5`, 5],
      [`</${tag} x='<title>#2</title #3> #4'> #5`, 5],
      [`</${tag} x="<title>#2"> <textarea>#3</textarea> #4`, 4],
    ]) {
      const body = `before <${tag}>#1${closing}`
      assert.deepEqual(hrefs(render(body, github)), ['https://github.com/sample/alpha/issues/' + number], body)
    }
  }
  const comment = render('before <textarea>#1</textarea x="<!--INERT #2"> #3 --> <!--HIDE--> #4', github)
  assert.deepEqual(hrefs(comment), ['https://github.com/sample/alpha/issues/4'])
  assert.ok(comment.includes('&lt;!--INERT #2'))
  assert.doesNotMatch(comment, /HIDE/)
})

// Catches testing surrogate halves instead of complete letters/numbers/marks around either reference form.
test('supplementary Unicode and decoded entity word boundaries stay plain while emoji punctuation links', () => {
  const adjacent = ['中', '𠀀', '𝟡', '𝅥', '&#x20000;', '&#131072;', '&#x1D7E1;', '&#120801;', '&#x1D165;', '&#119141;']
  for (const token of ['#328', 'sample/beta#328']) {
    const body = adjacent.map(character => `${character}${token} ${token}${character}`).join(' ') + ' (#329)'
    assert.deepEqual(hrefs(render(body, github)), ['https://github.com/sample/alpha/issues/329'], body)
  }
  assert.deepEqual(hrefs(render('😀#330 #331😀 &#x1F600;#332 #333&#128512;', github)), [
    'https://github.com/sample/alpha/issues/330', 'https://github.com/sample/alpha/issues/331',
    'https://github.com/sample/alpha/issues/332', 'https://github.com/sample/alpha/issues/333',
  ])
})

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
