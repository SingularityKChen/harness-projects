/**
 * 宿主嵌入复探记录（issue #225）一致性契约（离线：只读文档，不跑 git、不联网）。
 *
 * 规则来源是 ExecPlan `2026-09-29-harness-plugin-reprobe` 的预注册块（Design / Spec §2）与 §5：
 * (a) §1–§10 逐字节不动；(b) §11.6 的裁决与决定它的答案由 §11.3 观测表机械推导；(c) transport 与
 * 裁决共存；(d) 时间格式与窗口；(e) 卫生（disclosure 扫不到的临时路径、令牌、端口）。
 * §11 缺失或出现第二个 `## 11.` 时，针对真实记录的用例响亮失败，不静默跳过。
 *
 * ORIGINAL_SHA256 = 基线文件「截到 `## 11.` 之前、去掉尾部空白、补一个换行」的 sha256。重算命令：
 *   git show f6a33d2:docs/architecture/harness-host-spike.md | node -e "const s=require('fs').readFileSync(0,'utf8');console.log(require('crypto').createHash('sha256').update(s.trimEnd()+'\n').digest('hex'))"
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const DOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs/architecture/harness-host-spike.md')
const ORIGINAL_SHA256 = '3c578ef914eb0d78ca675e7bd9b92bf28eaa4a21705c9c3b75451ee558d45280'
const DECISIVE = ['O0.1', 'O0.2', 'O0.3', 'O2.1', 'O2.2', 'O2.3', 'O3.1', 'O3.2', 'O3.3', 'O3.4', 'O3.5', 'O4.1', 'O4.2', 'O4.3']
const ALLOWED = [...DECISIVE, 'O2.4', 'O3.6', 'O3.7', 'O3.8', 'O3.9']
const CLIENT = ['O0.3', 'O3.1', 'O3.2', 'O3.3', 'O3.4', 'O4.1', 'O4.2', 'O4.3'] // 「所有客户端项」的展开
const TRANSPORTS = ['typed remote', 'host web route']
const OK = '已观测到'
const OBS_HEADER = ['ID', '问题', '判据', '命令或动作', '结果', '强度', '时间（UTC）']
const SHORTCUT_HEADER = ['捷径', '影响的 O-ID', '影响判定', '理由']
const HYGIENE = /\/var\/folders|\/private\/(var|tmp)|\/tmp\/|token=|localhost:\d|127\.0\.0\.1:\d|\/Users\/|\/home\//
const DAY_MS = 86_400_000

// ---- 解析 ----
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const problemOf = (id) => (id.startsWith('O2.') ? 'Q2' : id.startsWith('O3.') ? 'Q3' : 'Q4') // O0 失败算 Q4（§2.3.3）

function splitRecord(text) {
  const heads = [...text.matchAll(/^## 11\./gm)]
  assert.equal(heads.length, 1, `§11 ${heads.length ? '出现了多个' : '缺失'}：找到 ${heads.length} 个 "## 11." 标题`)
  return { original: text.slice(0, heads[0].index), section: text.slice(heads[0].index) }
}

function cells(line) {
  const out = []
  let cur = ''
  let tick = false
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '`') tick = !tick
    if (line[i] === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue }
    if (line[i] === '|' && !tick) { out.push(cur.trim()); cur = ''; continue }
    cur += line[i]
  }
  return out
}

function table(body, header, what) {
  const rows = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') && !/^\|[\s:|-]+\|$/.test(l)).map(cells)
  assert.deepEqual(rows[0], header, `${what} 的表头不符合格式契约`)
  assert.ok(rows.length > 1, `${what} 没有数据行`)
  return rows.slice(1)
}

function parseRecord(text) {
  const { section } = splitRecord(text)
  const [, ...parts] = section.split(/^### 11\.(\d+)\b.*$/m)
  const sub = {}
  for (let i = 0; i < parts.length; i += 2) {
    assert.equal(sub[parts[i]], undefined, `§11.${parts[i]} 重复`)
    sub[parts[i]] = parts[i + 1]
  }
  for (let n = 1; n <= 9; n++) assert.notEqual(sub[n], undefined, `§11.${n} 缺失`)
  const rows = table(sub[3], OBS_HEADER, '§11.3').map((c) => {
    assert.equal(c.length, OBS_HEADER.length, `§11.3 行格式错误：${c[0]}`)
    const [id, , , command, result, strength, time] = c
    assert.ok(ALLOWED.includes(id), `§11.3 出现未预注册的 O-ID：${id}`)
    assert.ok([OK, '未观测到'].includes(result) && /^S[0-3]$/.test(strength), `${id} 的结果或强度取值非法`)
    assert.ok(command.includes('`'), `${id} 的命令或动作单元格缺少反引号`)
    return { id, result, strength, time }
  })
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, '§11.3 有重复的 O-ID')
  const shortcuts = table(sub[5], SHORTCUT_HEADER, '§11.5').map(([name, idCell, affects]) => {
    assert.ok(['是', '否'].includes(affects), `捷径「${name}」的影响判定必须是 是 / 否`)
    assert.doesNotMatch(idCell, /O\d+\.(?:x|\d+\s*[–~-])/i, `捷径「${name}」的影响 O-ID 必须逐个列出（不写 O3.x 或 O3.1–O3.4），否则改判为「是」时推导会漏项`)
    const ids = [...idCell.matchAll(/O\d+\.\d+/g)].map((m) => m[0]).concat(/所有客户端项/.test(idCell) ? CLIENT : [])
    assert.ok(affects === '否' || ids.length, `捷径「${name}」影响判定为「是」却没有可解析的 O-ID`)
    return { ids, affects }
  })
  const pre = /^- 预注册：`([0-9a-f]{7,40})` @ (\S+)$/m.exec(sub[2])
  const t0 = /^- T0：(\S+)$/m.exec(sub[2])
  assert.ok(pre && t0, '§11.2 缺少「预注册」或「T0」行')
  const declared = {
    verdict: /^>\s*裁决：`([^`]+)`/m.exec(sub[6])?.[1],
    deciding: /^>\s*决定它的答案：(Q\d)/m.exec(sub[6])?.[1],
    transports: [...sub[6].matchAll(/^>\s*transport：(.*)$/gm)].map((m) => m[1]),
  }
  return { section, rows, shortcuts, declared, prereg: pre[2], t0: t0[1] }
}

// ---- 一比一实现预注册的 §2.3 ----
function deriveVerdict(rows, shortcuts) {
  const blocked = new Set(shortcuts.filter((s) => s.affects === '是').flatMap((s) => s.ids))
  const failed = new Set()
  for (const id of DECISIVE) {
    const hits = rows.filter((r) => r.id === id)
    assert.equal(hits.length, 1, `决定性观测 ${id} 必须恰好出现一次，实际 ${hits.length} 次`)
    if (hits[0].result !== OK || hits[0].strength !== 'S3' || blocked.has(id)) failed.add(problemOf(id))
  }
  return { verdict: failed.size ? 'fallback-web' : 'embed', deciding: ['Q4', 'Q3', 'Q2'].find((q) => failed.has(q)) ?? 'Q4' }
}

// ---- 检查 (a)–(e) ----
function checkOriginal(text, expected = ORIGINAL_SHA256) {
  const { original } = splitRecord(text)
  assert.equal(sha256(original.trimEnd() + '\n'), expected, '§1–§10 的字节与基线不一致')
}
function checkVerdict(rec) {
  assert.deepEqual({ verdict: rec.declared.verdict, deciding: rec.declared.deciding }, deriveVerdict(rec.rows, rec.shortcuts), '§11.6 的声明与观测表推导不一致')
}
function checkTransport({ declared: { verdict, transports } }) {
  if (verdict === 'embed') {
    assert.equal(transports.length, 1, 'embed 时必须恰好一行 transport')
    assert.ok(TRANSPORTS.some((t) => transports[0].startsWith(t)), `transport 只能取 ${TRANSPORTS.join(' / ')}`)
  } else assert.equal(transports.length, 0, 'fallback-web 时不能有 transport 行')
}
function checkTimes(rec) {
  const utc = (s) => {
    const ms = Date.parse(s)
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s) && new Date(ms).toISOString().startsWith(s.slice(0, 19)), `不是 YYYY-MM-DDTHH:MM:SSZ：${s}`)
    return ms
  }
  const [pre, t0] = [utc(rec.prereg), utc(rec.t0)]
  assert.ok(pre < t0, '预注册时间必须早于 T0')
  for (const r of rec.rows) {
    const t = utc(r.time)
    assert.ok(t >= pre, `${r.id} 的时间早于预注册`)
    if (DECISIVE.includes(r.id)) assert.ok(t >= t0 && t <= t0 + 4 * DAY_MS, `${r.id} 的时间不在 T0 ≤ t ≤ T0+4 天`)
  }
}
const checkHygiene = (rec) => assert.doesNotMatch(rec.section, HYGIENE, '§11 含临时路径、令牌、端口或本机路径')

// ---- fixture：合成观测表 ----
const row = (id, result = OK, strength = 'S3', time = '2026-10-01T02:00:00Z') => ({ id, result, strength, time })
const passing = () => DECISIVE.map((id) => row(id))
const patch = (id, over) => passing().map((r) => (r.id === id ? { ...r, ...over } : r))
const yes = (...ids) => [{ ids, affects: '是' }]
const HEAD = '# 原记录\n\n正文\n'

function render({ rows = passing(), shortcuts = [['手写 lib/client.js', '—', '否']], verdict = 'embed', deciding = 'Q4', transports = ['typed remote（手写描述符）'], prereg = '2026-10-01T00:00:00Z', t0 = '2026-10-01T01:00:00Z', head = HEAD, sections = [1, 2, 3, 4, 5, 6, 7, 8, 9], body = '' } = {}) {
  const obs = rows.map((r) => `| ${r.id} | Q | 判据 | \`cmd\` | ${r.result} | ${r.strength} | ${r.time} |`)
  const bodies = {
    2: `- 预注册：\`${'a'.repeat(40)}\` @ ${prereg}\n- T0：${t0}`,
    3: ['| ' + OBS_HEADER.join(' | ') + ' |', '|---|---|---|---|---|---|---|', ...obs].join('\n'),
    5: ['| ' + SHORTCUT_HEADER.join(' | ') + ' |', '|---|---|---|---|', ...shortcuts.map((s) => `| ${s.join(' | ')} |`)].join('\n'),
    6: [`> 裁决：\`${verdict}\``, `> 决定它的答案：${deciding}（原因）`, ...transports.map((t) => `> transport：${t}`)].join('\n'),
  }
  return head + '\n## 11. 复探\n' + sections.map((n) => `### 11.${n} 小节\n${bodies[n] ?? '正文'}\n`).join('\n') + body
}
const fails = (text, check, pattern) => assert.throws(() => check(parseRecord(text)), pattern)

test('deriveVerdict：全部 S3 且无捷径 → embed，答案写 Q4', () => {
  assert.deepEqual(deriveVerdict(passing(), []), { verdict: 'embed', deciding: 'Q4' })
})
test('deriveVerdict：某一行 Q3 失败 → fallback-web，答案 Q3', () => {
  assert.deepEqual(deriveVerdict(patch('O3.3', { result: '未观测到' }), []), { verdict: 'fallback-web', deciding: 'Q3' })
})
test('deriveVerdict：Q4 与 Q2 同时失败 → 答案取 Q4', () => {
  const rows = patch('O2.2', { result: '未观测到' }).map((r) => (r.id === 'O4.1' ? { ...r, result: '未观测到' } : r))
  assert.deepEqual(deriveVerdict(rows, []), { verdict: 'fallback-web', deciding: 'Q4' })
})
test('deriveVerdict：Q3 与 Q2 同时失败 → 答案取 Q3；O0 失败算 Q4', () => {
  const rows = patch('O2.1', { strength: 'S2' }).map((r) => (r.id === 'O3.5' ? { ...r, result: '未观测到' } : r))
  assert.equal(deriveVerdict(rows, []).deciding, 'Q3')
  assert.equal(deriveVerdict(patch('O0.2', { result: '未观测到' }), []).deciding, 'Q4')
})
test('deriveVerdict：指向决定性 O-ID 的「影响判定 = 是」捷径 → fallback；指向非决定项不算', () => {
  assert.deepEqual(deriveVerdict(passing(), yes('O0.1')), { verdict: 'fallback-web', deciding: 'Q4' })
  assert.deepEqual(deriveVerdict(passing(), [{ ids: ['O0.1'], affects: '否' }]), { verdict: 'embed', deciding: 'Q4' })
  assert.equal(deriveVerdict(passing(), yes('O2.4', 'O3.7')).verdict, 'embed')
})
test('deriveVerdict：某一行强度为 S2 → fallback-web（S1/S2 不参与判定）', () => {
  assert.deepEqual(deriveVerdict(patch('O4.2', { strength: 'S2' }), []), { verdict: 'fallback-web', deciding: 'Q4' })
})
test('deriveVerdict：决定性行缺失或重复 → 抛错，不默认通过', () => {
  assert.throws(() => deriveVerdict(passing().slice(1), []), /O0\.1.*恰好出现一次/)
  assert.throws(() => deriveVerdict([...passing(), row('O3.1')], []), /O3\.1.*恰好出现一次/)
})
// 预注册 §2.2 / §2.3 的字面量，与实现常量分开写：任何一方缩减或改名都会在这里变红，且在 diff 中显眼。
const PREREG_DECISIVE = { 'O0.1': 'Q4', 'O0.2': 'Q4', 'O0.3': 'Q4', 'O2.1': 'Q2', 'O2.2': 'Q2', 'O2.3': 'Q2', 'O3.1': 'Q3', 'O3.2': 'Q3', 'O3.3': 'Q3', 'O3.4': 'Q3', 'O3.5': 'Q3', 'O4.1': 'Q4', 'O4.2': 'Q4', 'O4.3': 'Q4' }
const PREREG_NON_DECISIVE = ['O2.4', 'O3.6', 'O3.7', 'O3.8', 'O3.9']
test('预注册常量：决定性集合、非决定项与「所有客户端项」展开被逐项钉住', () => {
  assert.deepEqual(DECISIVE, Object.keys(PREREG_DECISIVE))
  assert.deepEqual(ALLOWED.filter((id) => !DECISIVE.includes(id)), PREREG_NON_DECISIVE)
  assert.deepEqual(CLIENT, ['O0.3', 'O3.1', 'O3.2', 'O3.3', 'O3.4', 'O4.1', 'O4.2', 'O4.3'])
  assert.deepEqual(parseRecord(render({ shortcuts: [['x', '所有客户端项', '是', 'y']] })).shortcuts[0].ids, CLIENT)
})
test('deriveVerdict：每个决定性 ID 单独失败（未观测、S2、捷径）都使裁决转 fallback-web，答案是它的问题归属', () => {
  for (const [id, q] of Object.entries(PREREG_DECISIVE)) {
    const expected = { verdict: 'fallback-web', deciding: q }
    assert.deepEqual(deriveVerdict(patch(id, { result: '未观测到' }), []), expected, `${id} 未观测到`)
    assert.deepEqual(deriveVerdict(patch(id, { strength: 'S2' }), []), expected, `${id} 强度 S2`)
    assert.deepEqual(deriveVerdict(passing(), yes(id)), expected, `${id} 被捷径影响`)
  }
})
test('deriveVerdict：每个非决定项即使未观测或强度不足也不改变裁决', () => {
  for (const id of PREREG_NON_DECISIVE) {
    assert.deepEqual(deriveVerdict([...passing(), row(id, '未观测到', 'S1')], []), { verdict: 'embed', deciding: 'Q4' }, id)
  }
})
test('解析：捷径的影响 O-ID 写成通配或范围 → 失败（逐个列出才能机械推导）', () => {
  for (const cell of ['O3.x', 'O3.1–O3.4', 'O2.1-O2.3']) assert.throws(() => parseRecord(render({ shortcuts: [['x', cell, '否', 'y']] })), /逐个列出/, cell)
  assert.deepEqual(parseRecord(render({ shortcuts: [['x', 'O4.2、O3.1、O3.4', '否', 'y']] })).shortcuts[0].ids, ['O4.2', 'O3.1', 'O3.4'])
})
test('解析：非决定项 O2.4 重复出现 → 失败', () => {
  assert.throws(() => parseRecord(render({ rows: [...passing(), row('O2.4'), row('O2.4')] })), /重复的 O-ID/)
})
test('解析：合成记录通过 (a)–(e) 全部检查', () => {
  const text = render()
  const rec = parseRecord(text)
  checkOriginal(text, sha256(HEAD.trimEnd() + '\n'))
  ;[checkVerdict, checkTransport, checkTimes, checkHygiene].forEach((c) => c(rec))
})
test('解析：「所有客户端项」捷径展开成客户端 O-ID，并使推导翻转', () => {
  const rec = parseRecord(render({ shortcuts: [['jsdom', '所有客户端项', '是', '不是真实载体']], verdict: 'fallback-web', deciding: 'Q4', transports: [] }))
  checkVerdict(rec)
  fails(render({ shortcuts: [['jsdom', '所有客户端项', '是', 'x']] }), checkVerdict, /不一致/)
})
test('(a) §11 缺失、重复，或 §1–§10 被改动 → 失败', () => {
  assert.throws(() => checkOriginal(HEAD, sha256(HEAD.trimEnd() + '\n')), /§11 缺失/)
  assert.throws(() => checkOriginal(render() + render(), sha256(HEAD.trimEnd() + '\n')), /§11 出现了多个/)
  assert.throws(() => checkOriginal(render({ head: HEAD.replace('正文', '正丈') }), sha256(HEAD.trimEnd() + '\n')), /字节与基线不一致/)
})
test('(b) 声明的裁决或答案与推导不一致 → 失败', () => {
  fails(render({ verdict: 'fallback-web', transports: [] }), checkVerdict, /不一致/)
  fails(render({ rows: patch('O3.1', { result: '未观测到' }), verdict: 'fallback-web', deciding: 'Q2', transports: [] }), checkVerdict, /不一致/)
})
test('(c) transport 与裁决的共存关系', () => {
  fails(render({ transports: [] }), checkTransport, /恰好一行/)
  fails(render({ transports: ['typed remote', 'host web route'] }), checkTransport, /恰好一行/)
  fails(render({ transports: ['client resource stream'] }), checkTransport, /只能取/)
  fails(render({ verdict: 'fallback-web', deciding: 'Q3', transports: ['typed remote'] }), checkTransport, /不能有 transport/)
  checkTransport(parseRecord(render({ transports: ['host web route（SSE）'] })))
})
test('(d) 时间格式、预注册先于 T0、决定性行落在 T0 窗口内', () => {
  fails(render({ rows: patch('O0.1', { time: '2026-10-01 02:00' }) }), checkTimes, /YYYY-MM-DDTHH:MM:SSZ/)
  fails(render({ rows: [...passing(), row('O2.4', OK, 'S3', '2026-09-30T23:00:00Z')] }), checkTimes, /早于预注册/)
  fails(render({ rows: patch('O3.2', { time: '2026-10-05T01:00:01Z' }) }), checkTimes, /T0\+4 天/)
  fails(render({ rows: patch('O3.2', { time: '2026-10-01T00:30:00Z' }) }), checkTimes, /T0 ≤ t/)
  fails(render({ t0: '2026-10-01T00:00:00Z' }), checkTimes, /早于 T0/)
  checkTimes(parseRecord(render({ rows: patch('O3.2', { time: '2026-10-05T01:00:00Z' }) })))
})
test('(e) 卫生：临时路径、令牌、端口、本机路径 → 失败', () => {
  for (const leak of ['/var/folders/x', '/private/tmp/a', '/tmp/a', 'token=abc', 'localhost:3080', '127.0.0.1:5000', '/Us' + 'ers/x', '/ho' + 'me/x']) { // 拆开写，免得本文件自己命中 disclosure 的家目录模式
    fails(render({ body: `\n${leak}\n` }), checkHygiene, /临时路径|本机路径/)
  }
  checkHygiene(parseRecord(render({ body: '\n端口写作 <scratch-url>\n' })))
})
test('解析：非法结果、强度、未预注册 ID、缺失小节、缺失反引号 → 失败', () => {
  assert.throws(() => parseRecord(render({ rows: patch('O0.1', { result: '部分观测到' }) })), /取值非法/)
  assert.throws(() => parseRecord(render({ rows: patch('O0.1', { strength: 'S4' }) })), /取值非法/)
  assert.throws(() => parseRecord(render({ rows: [...passing(), row('O9.9')] })), /未预注册/)
  assert.throws(() => parseRecord(render({ sections: [1, 2, 3, 4, 5, 6, 7, 8] })), /§11\.9 缺失/)
  assert.throws(() => parseRecord(render().replace('`cmd`', 'cmd')), /反引号/)
})

// ---- 真实记录：§11 尚不存在时必须响亮失败 ----
const real = () => readFileSync(DOC, 'utf8')
test('真实记录 (a)：§11 存在且 §1–§10 逐字节不变', () => checkOriginal(real()))
test('真实记录 (b)：裁决与决定它的答案等于观测表的机械推导', () => checkVerdict(parseRecord(real())))
test('真实记录 (c)：transport 与裁决共存', () => checkTransport(parseRecord(real())))
test('真实记录 (d)：时间格式与窗口', () => checkTimes(parseRecord(real())))
test('真实记录 (e)：卫生', () => checkHygiene(parseRecord(real())))
