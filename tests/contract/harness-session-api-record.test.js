/**
 * 宿主会话接口观测记录（issue #280）一致性契约（离线：只读仓库文件，不跑 git、不联网）。
 *
 * 规则来源是 ExecPlan `2026-10-15-harness-session-api-probe` 的预注册块（`session-rule`）与 Design / Spec §3–§5：
 * (a) 常量与预注册块逐项相等；(b) 记录 §6 的结论块由 §3 观测表与 §5 捷径台账机械推导；(c) 时间格式与「决定性行不早于 T0」；
 * (d) 夹具与记录一致：版本、结构、事件与会话行的键白名单；(e) 卫生（disclosure 扫不到的临时路径、令牌、端口、假密钥前缀）；
 * (f) 映射来源与两处索引；(g) 夹具与 §3 绑定：每个「已观测到 / S3」的行在夹具里有其判据的可投影部分，O0.1、O0.2 由记录 §8
 * 声明为只由记录证明；成功请求的 sessionId 来自此前的 create；映射来源的 O-ID 在夹具里有对应的结束原因或状态事件；
 * (h) §5 捷径的影响判定与块 §2.4 的预定性一致；§2 的版本来源都读到宿主版本。记录缺失时针对真实文件的用例响亮失败；
 * 夹具只在结论为 move-after-demo 时才允许缺失。
 *
 * 边界：块里的 §2.3 推导规则是散文，由 deriveConsequence 逐条手抄，测试不解析它；块自预注册提交以来是否被改，
 * 由计划 Validation and Acceptance 第 4 行对预注册提交的逐字节 diff 判定（离线测试不跑 git），不由本文件判定。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { ExecutionRunStatus } from '@harness-projects/domain'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RECORD = 'docs/architecture/harness-session-api.md'
const FIXTURE = 'tests/contract/fixtures/harness-session/session-api.json'
const PLAN = '2026-10-15-harness-session-api-probe.md'
const OK = '已观测到'
const CORE = ['O0.1', 'O0.2', 'O1.1', 'O1.2', 'O2.1', 'O2.2']
const IMPLEMENT = ['O3.1', 'O3.2']
const NON_DECISIVE = ['O4.1', 'O4.2', 'O4.3', 'O4.4']
const ALL = [...CORE, ...IMPLEMENT, ...NON_DECISIVE]
const TITLES = ['范围与口径', '观测环境', '观测表', '静态机制证据', '捷径台账', '对 #140 的结论', '交给 #140 的事实', '夹具与投影规则', '未观测到清单与复核方法']
const OBS_HEADER = ['ID', '问题', '判据', '命令或动作', '结果', '强度', '时间（UTC）']
const SHORTCUT_HEADER = ['捷径', '影响的 O-ID', '影响判定', '理由']
const MAPPING_HEADER = ['宿主状态', 'ExecutionRunStatus', '来源']
const FROZEN_SHORTCUT_HEADER = ['捷径', '影响判定', '理由']
const RECORD_ONLY = ['O0.1', 'O0.2'] // 安装退出码与 ready 行按 §8 不进夹具
const TURN_END_KINDS = ['completed', 'aborted', 'error', 'blocked', 'max-tokens', 'interrupted', 'forked']
const OPERATIONS = ['create', 'prompt', 'cancel', 'list', 'inspect']
const EVENT_TYPES = ['turn/start', 'turn/end', 'step/start', 'step/end', 'user/message']
const EVENT_KEYS = ['seq', 'type', 'turn', 'reason', 'rpcId']
const LIST_KEYS = ['sessionId', 'running', 'agentAvailable', 'blank']
const HYGIENE = /\/var\/folders|\/private\/(var|tmp)|\/tmp\/|token=|localhost:\d|127\.0\.0\.1:\d|\/Users\/|\/home\/|hp-probe-fake-|x-api-key/

// ---- 解析 ----
function isoMs(s) {
  const ms = Date.parse(s)
  assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s) && !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(s.slice(0, 19)), `不是 YYYY-MM-DDTHH:MM:SSZ：${s}`)
  return ms
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

/** 取节内第一张表头逐字等于 header 的表的数据行；同一节可以有别的表（如 §5 的附带写入）。 */
function tableAt(body, header, what) {
  const lines = body.split('\n').map((l) => l.trim())
  const at = lines.findIndex((l) => l.startsWith('|') && cells(l).join('|') === header.join('|'))
  assert.notEqual(at, -1, `${what} 缺少表头 | ${header.join(' | ')} |`)
  const rows = []
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith('|')) break
    if (!/^\|[\s:|-]+\|$/.test(l)) rows.push(cells(l))
  }
  return rows
}

function parseRecord(text) {
  assert.match(text, /^# 宿主会话接口观测：插件能否启动、读取与取消一次运行$/m, '缺少一级标题')
  const heads = [...text.matchAll(/^## .*$/gm)]
  assert.deepEqual(heads.map((h) => h[0]), TITLES.map((t, i) => `## ${i + 1}. ${t}`), '九个二级标题必须按序为 ## 1. … ## 9.，缺节或重复都不行')
  const sec = heads.map((h, i) => text.slice(h.index, heads[i + 1]?.index))
  const rows = tableAt(sec[2], OBS_HEADER, '§3').map((c) => {
    assert.equal(c.length, OBS_HEADER.length, `§3 行格式错误：${c[0]}`)
    const [id, , criterion, command, result, strength, time] = c
    assert.ok(ALL.includes(id), `§3 出现未预注册的 O-ID：${id}`)
    assert.ok([OK, '未观测到'].includes(result) && /^S[0-3]$/.test(strength), `${id} 的结果或强度取值非法`)
    assert.ok(command.includes('`'), `${id} 的命令或动作单元格缺少反引号`)
    return { id, criterion, result, strength, time }
  })
  for (const id of ALL) assert.equal(rows.filter((r) => r.id === id).length, 1, `${id} 在 §3 必须恰好一行，实际 ${rows.filter((r) => r.id === id).length} 行`)
  const shortcuts = tableAt(sec[4], SHORTCUT_HEADER, '§5').map(([name, idCell, affects, reason]) => {
    assert.ok(['是', '否'].includes(affects), `捷径「${name}」的影响判定必须是 是 / 否`)
    assert.doesNotMatch(idCell, /O\d+\.(?:x|\d+\s*[–~-])/i, `捷径「${name}」的影响 O-ID 必须逐个列出（不写 O3.x 或范围）`)
    const ids = idCell.match(/O\d+\.\d+/g) ?? []
    assert.ok(ids.every((id) => ALL.includes(id)), `捷径「${name}」列出了未预注册的 O-ID`)
    assert.ok(affects === '否' || ids.length > 0, `捷径「${name}」影响判定为「是」却没有可解析的 O-ID`)
    return { name, ids, affects, reason }
  })
  const line = (re, what) => { const m = re.exec(sec[5]); assert.ok(m, `§6 缺少「${what}」行`); return m[1] }
  const missing = line(/^>\s*缺项：(.+?)\s*$/m, '缺项')
  const declared = {
    consequence: line(/^>\s*对 #140 的结论：`([^`]+)`\s*$/m, '对 #140 的结论'),
    reachable: line(/^>\s*插件可达：(.+?)\s*$/m, '插件可达'),
    missing: missing === '无' ? [] : missing.split('、'),
  }
  const version = /^\|\s*宿主版本\s*\|\s*`([^`]+)`\s*\|\s*$/m.exec(sec[1])?.[1]
  const prereg = /^- 预注册：`([0-9a-f]{40})` @ (\S+)$/m.exec(sec[1])
  const t0 = /^- T0：(\S+)$/m.exec(sec[1])
  assert.ok(version && prereg && t0, '§2 缺少「宿主版本」表格行、「预注册」行或「T0」行')
  const mapping = tableAt(sec[6], MAPPING_HEADER, '§7').map(([host, status, source]) => ({ host, status: status.replaceAll('`', ''), source, ids: source.match(/O\d+\.\d+/g) ?? [] }))
  assert.ok(mapping.length > 0, '§7 映射表没有数据行')
  return {
    rows, shortcuts, declared, mapping, version, preregMs: isoMs(prereg[2]), t0Ms: isoMs(t0[1]),
    hasWhyNot: /^### 6\.1 为何录不到/m.test(sec[5]),
    sources: sec[1].split('\n').filter((l) => /^\|\s*来源/.test(l)).map((l) => cells(l)[1]),
    recordOnly: /^- 只由本记录证明的 O-ID：(.+?)\s*$/m.exec(sec[7])?.[1].split('、'),
  }
}

// ---- 预注册块 ----
function ruleBlock(planText) {
  const block = /^<!-- session-rule:begin -->$([\s\S]*?)^<!-- session-rule:end -->$/m.exec(planText)
  assert.ok(block, '计划里找不到 session-rule 块（标记必须在行首）')
  return block[1]
}

function preregistered(planText) {
  const body = ruleBlock(planText)
  const list = (name) => {
    const l = new RegExp(`^- \`${name}\`：(.+)$`, 'm').exec(body)
    assert.ok(l, `session-rule 块缺少 ${name} 行`)
    return l[1].trim().split('、')
  }
  return { CORE: list('CORE'), IMPLEMENT: list('IMPLEMENT'), NON_DECISIVE: list('NON_DECISIVE') }
}

/** 预注册块的 O-ID 表：{ O-ID: 判据 }。 */
function preregisteredCriteria(planText) {
  const out = {}
  for (const line of ruleBlock(planText).split('\n')) {
    const c = line.startsWith('| O') ? cells(line) : []
    if (/^O\d+\.\d+$/.test(c[0] ?? '')) out[c[0]] = c[2]
  }
  return out
}

/** §3 的判据列是冻结判据本身，不是改写；比较前只折叠空白。 */
function checkCriteria(rec, criteria) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  for (const r of rec.rows) {
    assert.ok(criteria[r.id] !== undefined, `预注册块里没有 ${r.id} 的判据`)
    assert.equal(norm(r.criterion), norm(criteria[r.id]), `${r.id} 的判据与预注册块不一致（须逐字，只折叠空白）`)
  }
}

/** 块 §2.4 的捷径预定性：{ 捷径名: { affects: 是|否, ids: 判定格里点名的 O-ID } }。 */
function preregisteredShortcuts(planText) {
  return Object.fromEntries(tableAt(ruleBlock(planText), FROZEN_SHORTCUT_HEADER, 'session-rule 块 §2.4').map(([name, verdict]) => {
    assert.ok(['是', '否'].includes(verdict[0]), `块 §2.4 捷径「${name}」的影响判定必须以 是 / 否 开头`)
    return [name, { affects: verdict[0], ids: verdict.match(/O\d+\.\d+/g) ?? [] }]
  }))
}

/** §5 的同名捷径沿用块 §2.4 的判定；块外新增的由人判定，理由列注明「块外新增」。 */
function checkShortcuts(rec, frozen) {
  for (const s of rec.shortcuts) {
    const f = frozen[s.name]
    if (f === undefined) { assert.match(s.reason, /块外新增/, `捷径「${s.name}」不在块 §2.4，理由列须注明「块外新增」`); continue }
    assert.equal(s.affects, f.affects, `捷径「${s.name}」的影响判定与预注册 §2.4 不一致`)
    for (const id of f.ids) assert.ok(s.ids.includes(id), `捷径「${s.name}」须列出预注册 §2.4 点名的 ${id}`)
  }
}

function findPlan(exists = existsSync) {
  const hits = ['active', 'completed'].map((d) => path.join(ROOT, 'docs/exec-plan', d, PLAN)).filter(exists)
  assert.equal(hits.length, 1, `docs/exec-plan/{active,completed}/ 下必须恰好有一份本计划，实际 ${hits.length} 份`)
  return { dir: path.basename(path.dirname(hits[0])), text: readFileSync(hits[0], 'utf8') }
}

// ---- 一比一实现预注册的 §2.3 ----
function deriveConsequence(rows, shortcuts) {
  const blocked = new Set(shortcuts.filter((s) => s.affects === '是').flatMap((s) => s.ids))
  const counted = (id) => {
    const hits = rows.filter((r) => r.id === id)
    assert.equal(hits.length, 1, `${id} 必须恰好出现一次，实际 ${hits.length} 次`)
    return hits[0].result === OK && hits[0].strength === 'S3' && !blocked.has(id)
  }
  const reachable = counted('O0.1') && counted('O0.2') ? '是' : '否'
  const coreMissing = CORE.filter((id) => !counted(id))
  if (coreMissing.length > 0) return { consequence: 'move-after-demo', reachable, missing: coreMissing }
  const implementMissing = IMPLEMENT.filter((id) => !counted(id))
  return { consequence: implementMissing.length ? 'narrow' : 'implement', reachable, missing: implementMissing }
}

// ---- 检查 ----
const observedIds = (rec) => new Set(rec.rows.filter((r) => r.result === OK).map((r) => r.id))
const checkConclusion = (rec) => assert.deepEqual(rec.declared, deriveConsequence(rec.rows, rec.shortcuts), '§6 的结论块与观测表推导不一致')
const checkHygiene = (text, what) => assert.doesNotMatch(text, HYGIENE, `${what}含临时路径、令牌、回环端口、本机路径或假密钥前缀`)

function checkTimes(rec) {
  assert.ok(rec.preregMs < rec.t0Ms, '预注册时间必须早于 T0')
  for (const r of rec.rows) {
    const t = isoMs(r.time)
    assert.ok(t >= rec.preregMs, `${r.id} 的时间早于预注册`)
    if ([...CORE, ...IMPLEMENT].includes(r.id) && r.result === OK) assert.ok(t >= rec.t0Ms, `${r.id} 的决定性观测早于 T0`)
  }
}

function checkSources(rec) {
  assert.ok(rec.sources.length >= 3, `§2 至少要有三行版本来源，实际 ${rec.sources.length} 行`)
  for (const s of rec.sources) assert.ok(s.includes(`\`${rec.version}\``), `§2 的版本来源没有读到宿主版本 ${rec.version}：${s}`)
}

function checkMapping(rec) {
  const known = Object.values(ExecutionRunStatus)
  const observed = observedIds(rec)
  for (const m of rec.mapping) {
    assert.ok(known.includes(m.status), `映射「${m.host}」的 ${m.status} 不是 ExecutionRunStatus 的取值`)
    assert.ok(m.source.includes('S1') || m.ids.length > 0, `映射「${m.host}」的来源必须写 O-ID 或 S1`)
    for (const [kind, status] of [['`completed`', 'succeeded'], ['`error`', 'failed'], ['`aborted`', 'canceled']]) if (m.host.includes(kind)) assert.equal(m.status, status, `映射「${m.host}」应映射为 ${status}`)
    for (const id of m.ids) assert.ok(observed.has(id), `映射「${m.host}」的来源 ${id} 不是「已观测到」的行`)
  }
}

function checkIndexes({ arch, root, planDir }) {
  assert.ok(arch.includes('[harness-session-api.md](harness-session-api.md)'), 'docs/architecture/README.md 没有登记 harness-session-api.md')
  const link = new RegExp(`\\]\\(exec-plan/(active|completed)/${PLAN.replaceAll('.', '\\.')}\\)`).exec(root)
  assert.ok(link, 'docs/README.md 没有登记本计划')
  assert.equal(link[1], planDir, `docs/README.md 的链接目录 ${link[1]}/ 与计划所在目录 ${planDir}/ 不一致`)
}

const only = (obj, allowed, what) => {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k))
  assert.deepEqual(extra, [], `${what} 出现白名单外的键：${extra}`)
}

function checkFixture(rec, fixture) {
  const { consequence } = deriveConsequence(rec.rows, rec.shortcuts)
  if (consequence !== 'move-after-demo') assert.ok(fixture !== undefined, '结论不是 move-after-demo 时必须有夹具')
  if (consequence === 'move-after-demo') assert.ok(rec.hasWhyNot, '结论为 move-after-demo 时记录须含「### 6.1 为何录不到」')
  if (fixture === undefined) return
  assert.equal(fixture.provenance?.hostVersion, rec.version, '夹具的 provenance.hostVersion 与记录 §2 的宿主版本不一致')
  const { exchanges, events } = fixture
  assert.ok(Array.isArray(exchanges) && Array.isArray(events), '夹具必须是 { provenance, exchanges, events }')
  const observed = observedIds(rec)
  for (const e of [...exchanges, ...events]) assert.ok(observed.has(e.observation), `夹具的 observation「${e.observation}」不指向「已观测到」的行`)
  const succeeded = (operation, ...oids) => exchanges.some((e) => e.operation === operation && oids.includes(e.observation) && e.outcome?.ok === true)
  const okValues = (operation, oid) => exchanges.filter((e) => e.operation === operation && e.observation === oid && e.outcome?.ok === true).map((e) => e.outcome.value)
  assert.ok(okValues('create', 'O1.1').some((v) => /^session-/.test(v?.sessionId ?? '')), 'start 缺失：夹具里没有 O1.1 的成功 create（sessionId 以 session- 开头）')
  assert.ok(okValues('prompt', 'O1.2').some((v) => v?.accepted === true), 'start 缺失：夹具里没有 O1.2 的成功 prompt（accepted: true）')
  assert.ok(succeeded('list', 'O2.1', 'O2.2') || succeeded('inspect', 'O2.1', 'O2.2'), 'status read 缺失：夹具里没有 O2.1 / O2.2 的成功 list 或 inspect')
  for (const e of exchanges) {
    only(e, ['observation', 'operation', 'request', 'outcome'], '交换')
    assert.ok(OPERATIONS.includes(e.operation), `operation 只能取 ${OPERATIONS}，实际 ${e.operation}`)
    assert.equal(typeof e.outcome?.ok, 'boolean', `${e.observation} 的 outcome 必须带布尔 ok`)
    if (!e.outcome.ok) { only(e.outcome.error, ['code', 'message', 'details', 'remote'], '失败的 error'); continue }
    if (e.operation === 'list') for (const item of e.outcome.value.items) only(item, LIST_KEYS, 'list 行')
    if (e.operation !== 'inspect') continue
    only(e.outcome.value, ['events'], 'inspect 的 value')
    for (const ev of e.outcome.value.events) {
      only(ev, EVENT_KEYS, 'inspect 事件')
      assert.ok(EVENT_TYPES.includes(ev.type), `inspect 事件类型只能取 ${EVENT_TYPES}，实际 ${ev.type}`)
      if (ev.reason === undefined) continue
      only(ev.reason, ['kind', 'reason', 'error'], 'turn/end 的 reason')
      if (ev.reason.reason) only(ev.reason.reason, ['kind'], 'reason.reason')
      if (ev.reason.error) only(ev.reason.error, ['code'], 'reason.error')
    }
  }
  for (const s of events) { only(s, ['observation', 'event', 'sessionId', 'running'], '状态事件'); assert.equal(s.event, 'api-session/status', '状态事件的 event 只能取 api-session/status') }
  checkHygiene(JSON.stringify(fixture), '夹具')
  checkEvidence(rec, fixture)
  checkLineage(fixture)
  checkMappingEvidence(rec, fixture)
}

// ---- 夹具与 §3 绑定：§3 每个「已观测到 / S3」的行，其判据里能投影进夹具的部分必须在夹具里成立 ----
const isOk = (e) => e.outcome?.ok === true
const sid = (e) => e.request?.sessionId
const ofObs = (fx, oid, operation) => fx.exchanges.filter((e) => e.observation === oid && e.operation === operation)
const createdBy = (fx, oid) => ofObs(fx, oid, 'create').find(isOk)?.outcome.value.sessionId
const okOn = (fx, oid, operation, s) => ofObs(fx, oid, operation).filter((e) => isOk(e) && s !== undefined && sid(e) === s)
const accepted = (fx, oid, s) => okOn(fx, oid, 'prompt', s).some((e) => e.outcome.value?.accepted === true)
const endsOf = (inspects) => inspects.flatMap((e) => e.outcome.value.events).filter((ev) => ev.type === 'turn/end')
const rowsOf = (fx, oid, s) => ofObs(fx, oid, 'list').filter(isOk).flatMap((e) => e.outcome.value.items).filter((i) => i.sessionId === s)
const trueThenFalse = (fx, oid, s) => {
  const seq = fx.events.filter((x) => x.observation === oid && x.sessionId === s).map((x) => x.running)
  return seq.includes(true) && seq.indexOf(false, seq.indexOf(true) + 1) !== -1
}
const reread = (fx, i, s) => fx.exchanges.slice(0, i).filter((e) => e.operation === 'inspect' && isOk(e) && sid(e) === s)

/** O-ID → [判据的可投影部分, 判定]；O0.1、O0.2 不在这里（RECORD_ONLY）。 */
const FIXTURE_EVIDENCE = {
  'O1.1': ['create({ cwd }) 返回以 session- 开头的 sessionId', (fx) => {
    const e = ofObs(fx, 'O1.1', 'create').find(isOk)
    return typeof e?.request.cwd === 'string' && /^session-/.test(e.outcome.value.sessionId ?? '')
  }],
  'O1.2': ['对 O1.1 的会话 prompt 返回 accepted: true', (fx) => accepted(fx, 'O1.2', createdBy(fx, 'O1.1'))],
  'O2.1': ['O1.1 的会话状态事件先 true 后 false，list 里该行 running: false', (fx) => {
    const s = createdBy(fx, 'O1.1')
    return trueThenFalse(fx, 'O2.1', s) && rowsOf(fx, 'O2.1', s).some((i) => i.running === false)
  }],
  'O2.2': ['O1.1 的会话 inspect 含 turn/start 与带 reason.kind 的 turn/end', (fx) => {
    const evs = okOn(fx, 'O2.2', 'inspect', createdBy(fx, 'O1.1')).flatMap((e) => e.outcome.value.events)
    return evs.some((ev) => ev.type === 'turn/start') && evs.some((ev) => ev.type === 'turn/end' && typeof ev.reason?.kind === 'string')
  }],
  'O3.1': ['新会话的 prompt 被接纳，inspect 的 turn/end 为 completed，list 里该行 running: false', (fx) => {
    const s = createdBy(fx, 'O3.1')
    return accepted(fx, 'O3.1', s) && endsOf(okOn(fx, 'O3.1', 'inspect', s)).some((ev) => ev.reason?.kind === 'completed') && rowsOf(fx, 'O3.1', s).some((i) => i.running === false)
  }],
  'O3.2': ['新会话的 prompt 被接纳，状态事件先 true 后 false，cancel 返回 accepted: true，turn/end 为 aborted 且 reason.reason.kind = user', (fx) => {
    const s = createdBy(fx, 'O3.2')
    return accepted(fx, 'O3.2', s) && trueThenFalse(fx, 'O3.2', s) && okOn(fx, 'O3.2', 'cancel', s).some((e) => e.outcome.value?.accepted === true)
      && endsOf(okOn(fx, 'O3.2', 'inspect', s)).some((ev) => ev.reason?.kind === 'aborted' && ev.reason.reason?.kind === 'user')
  }],
  'O4.1': ['同一 requestId 的第二次 prompt 返回 accepted: true，之后该会话每次 inspect 里带该 rpcId 的 user/message 恰好 1 条', (fx) => {
    const i = fx.exchanges.findIndex((e) => e.observation === 'O4.1' && e.operation === 'prompt' && isOk(e) && e.outcome.value?.accepted === true)
    if (i === -1) return false
    const { requestId, sessionId } = fx.exchanges[i].request
    const later = fx.exchanges.slice(i + 1).filter((e) => e.operation === 'inspect' && isOk(e) && sid(e) === sessionId)
    return fx.exchanges.slice(0, i).some((e) => e.operation === 'prompt' && e.request?.requestId === requestId && sid(e) === sessionId)
      && later.length > 0 && later.every((e) => e.outcome.value.events.filter((ev) => ev.type === 'user/message' && ev.rpcId === requestId).length === 1)
  }],
  'O4.2': ['五种失败各有一次失败的交换：create 同给 workspaceId 与 cwd；对已创建会话的空白 prompt；对未创建会话的 prompt、inspect、cancel', (fx) => {
    const created = new Set(fx.exchanges.filter((e) => e.operation === 'create' && isOk(e)).map((e) => e.outcome.value.sessionId))
    const failed = (operation, pred) => ofObs(fx, 'O4.2', operation).some((e) => e.outcome?.ok === false && pred(e.request ?? {}))
    const unknown = (r) => !created.has(r.sessionId)
    return failed('create', (r) => r.cwd !== undefined && r.workspaceId !== undefined)
      && failed('prompt', (r) => created.has(r.sessionId) && Array.isArray(r.content) && r.content.every((c) => c.type === 'text' && c.text.trim() === ''))
      && failed('prompt', unknown) && failed('inspect', unknown) && failed('cancel', unknown)
  }],
  'O4.3': ['对此前已读到 turn/end、list 里 agentAvailable: true 的会话 cancel，之后再 inspect 一次', (fx) => fx.exchanges.some((e, i) => {
    if (e.observation !== 'O4.3' || e.operation !== 'cancel' || sid(e) === undefined) return false
    const attached = fx.exchanges.slice(0, i).some((b) => b.operation === 'list' && isOk(b) && b.outcome.value.items.some((it) => it.sessionId === sid(e) && it.agentAvailable === true))
    return endsOf(reread(fx, i, sid(e))).length > 0 && attached && fx.exchanges.slice(i + 1).some((a) => a.observation === 'O4.3' && a.operation === 'inspect' && isOk(a) && sid(a) === sid(e))
  })],
  'O4.4': ['对 O1.1 的会话 inspect 冷读到与重启前最后一次 inspect 相同的 turn/end，cancel 报 session/not-found', (fx) => {
    const s = createdBy(fx, 'O1.1')
    const i = fx.exchanges.findIndex((e) => e.observation === 'O4.4' && e.operation === 'inspect' && isOk(e) && sid(e) === s)
    const cold = i === -1 ? [] : endsOf([fx.exchanges[i]])
    return cold.length > 0 && isDeepStrictEqual(cold, endsOf(reread(fx, i, s).slice(-1)))
      && ofObs(fx, 'O4.4', 'cancel').some((e) => sid(e) === s && e.outcome?.ok === false && e.outcome.error?.code === 'session/not-found')
  }],
}

function checkEvidence(rec, fx) {
  assert.deepEqual(rec.recordOnly, RECORD_ONLY, `§8 须写明只由本记录证明、不投影进夹具的 O-ID：${RECORD_ONLY.join('、')}`)
  for (const r of rec.rows) {
    if (r.result !== OK || r.strength !== 'S3' || RECORD_ONLY.includes(r.id)) continue
    const [what, holds] = FIXTURE_EVIDENCE[r.id]
    assert.ok(holds(fx), `${r.id} 在 §3 是「已观测到 / S3」，夹具却不支持：${what}`)
  }
}

/** 成功的请求只能指向此前某次 create 返回的会话；create 不重复返回；list 行与状态事件的会话都来自 create。 */
function checkLineage(fx) {
  const created = new Set()
  for (const e of fx.exchanges) {
    if (sid(e) !== undefined && isOk(e)) assert.ok(created.has(sid(e)), `${e.observation} 的 ${e.operation} 对 ${sid(e)} 成功，但此前没有 create 返回过它`)
    if (e.operation === 'list' && isOk(e)) for (const it of e.outcome.value.items) assert.ok(created.has(it.sessionId), `${e.observation} 的 list 行 ${it.sessionId} 不是此前 create 返回的会话`)
    if (e.operation !== 'create' || !isOk(e)) continue
    assert.ok(!created.has(e.outcome.value.sessionId), `create 重复返回 ${e.outcome.value.sessionId}`)
    created.add(e.outcome.value.sessionId)
  }
  for (const s of fx.events) assert.ok(created.has(s.sessionId), `状态事件的会话 ${s.sessionId} 不是 create 返回的会话`)
}

/** §7.1 映射行的来源 O-ID 要在夹具里有对应的东西：结果轴行对应该结束原因的 turn/end，生命周期行对应 running: true 的状态事件。 */
function checkMappingEvidence(rec, fx) {
  for (const m of rec.mapping) {
    const kinds = TURN_END_KINDS.filter((k) => m.host.includes(`\`${k}\``))
    for (const id of m.ids) {
      if (m.host.includes('`turn/end`')) assert.ok(endsOf(ofObs(fx, id, 'inspect').filter(isOk)).some((ev) => kinds.includes(ev.reason?.kind)), `映射「${m.host}」的来源 ${id} 在夹具里没有 reason.kind 为 ${kinds.join(' / ') || '（未写结束原因）'} 的 turn/end`)
      else if (m.host.includes('`running: true`')) assert.ok(fx.events.some((s) => s.observation === id && s.running === true), `映射「${m.host}」的来源 ${id} 在夹具里没有 running: true 的状态事件`)
      else assert.fail(`映射「${m.host}」的来源写了 ${id}，但宿主状态既不是 turn/end 也不是 running: true，无法在夹具里核对`)
    }
  }
}

// ---- fixture：合成记录与夹具 ----
const VERSION = '0.2.0-rc.2'
const T = { prereg: '2026-10-15T03:00:00Z', t0: '2026-10-15T04:00:00Z', obs: '2026-10-15T05:00:00Z' }
const row = (id, over = {}) => ({ id, result: OK, strength: 'S3', time: T.obs, ...over })
const passing = () => ALL.map((id) => row(id))
const patch = (id, over) => passing().map((r) => (r.id === id ? { ...r, ...over } : r))
const yes = (...ids) => [{ ids, affects: '是' }]
const MAPPING = [['已接纳、尚无 `turn/start`', '`starting`', 'S1'], ['`running: true`', 'running', 'O2.1、O3.2'], ['`turn/end`，`reason.kind` 为 `completed`', 'succeeded', 'O3.1'], ['`turn/end`，`reason.kind` 为 `aborted`', 'canceled', 'O3.2']]

function render({ rows = passing(), shortcuts = [['手写 JS 探针', '—', '否', '理由']], declared = ['implement', '是', '无'], mapping = MAPPING, prereg = T.prereg, t0 = T.t0, version = VERSION, sources = [1, 2, 3].map(() => `\`${version}\``), recordOnly = RECORD_ONLY, whyNot = false, titles = TITLES, body = '' } = {}) {
  const table = (header, data) => [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...data.map((d) => `| ${d.join(' | ')} |`)].join('\n')
  const bodies = [
    '范围',
    `- 预注册：\`${'a'.repeat(40)}\` @ ${prereg}\n- T0：${t0}\n\n| 项 | 值 |\n|---|---|\n| 宿主版本 | \`${version}\` |${sources.map((v, i) => `\n| 来源${'一二三四'[i]} | 读数：${v} |`).join('')}`,
    table(OBS_HEADER, rows.map((r) => [r.id, 'Q', r.criterion ?? '判据', '`cmd`', r.result, r.strength, r.time])),
    '静态',
    table(SHORTCUT_HEADER, shortcuts),
    `> 对 #140 的结论：\`${declared[0]}\`\n> 插件可达：${declared[1]}\n> 缺项：${declared[2]}${whyNot ? '\n\n### 6.1 为何录不到\n原因' : ''}`,
    table(MAPPING_HEADER, mapping),
    `夹具${recordOnly ? `\n\n- 只由本记录证明的 O-ID：${recordOnly.join('、')}` : ''}`,
    `未观测${body}`,
  ]
  return `${['# 宿主会话接口观测：插件能否启动、读取与取消一次运行', ...titles.map((t, i) => `## ${i + 1}. ${t}\n${bodies[i]}`)].join('\n\n')}\n`
}

const evt = (seq, type, extra = {}) => ({ seq, type, turn: 0, ...extra })
const S = { core: 'session-1', reply: 'session-2', hold: 'session-3', unknown: 'session-0' }
const done = (ok, value) => (ok ? { ok, value } : { ok, error: { code: value, message: 'm', details: {}, remote: true } })
const x = (observation, operation, request, outcome) => ({ observation, operation, request, outcome })
const create = (observation, s) => x(observation, 'create', { cwd: '<scratch>/work' }, done(true, { sessionId: s }))
const prompt = (observation, s, requestId, text = 'p') => x(observation, 'prompt', { requestId, sessionId: s, mode: 'queue', content: [{ type: 'text', text }] }, done(true, { accepted: true }))
const listOf = (observation, ...items) => x(observation, 'list', {}, done(true, { items: items.map(([s, running]) => ({ sessionId: s, running, agentAvailable: true, blank: false })) }))
const inspectOf = (observation, s, rpcId, reason) => x(observation, 'inspect', { sessionId: s }, done(true, { events: [evt(0, 'turn/start'), evt(1, 'user/message', { rpcId }), evt(2, 'turn/end', { reason })] }))
const status = (observation, s, running) => ({ observation, event: 'api-session/status', sessionId: s, running })
const missing = () => ({ kind: 'error', error: { code: 'MISSING_CREDENTIAL' } })
const goodFixture = () => ({
  provenance: { hostVersion: VERSION, probe: 'hp-session-probe@0.0.0' },
  exchanges: [
    create('O1.1', S.core), prompt('O1.2', S.core, 'r1'), prompt('O4.1', S.core, 'r1'), listOf('O2.1', [S.core, false]), inspectOf('O2.2', S.core, 'r1', missing()),
    x('O4.3', 'cancel', { sessionId: S.core }, done(true, { accepted: true })), inspectOf('O4.3', S.core, 'r1', missing()),
    x('O4.2', 'create', { cwd: '<scratch>/work', workspaceId: 'w' }, done(false, 'gateway/bad-request')),
    { ...prompt('O4.2', S.core, 'r-blank', '   '), outcome: done(false, 'gateway/bad-request') },
    { ...prompt('O4.2', S.unknown, 'r-unknown'), outcome: done(false, 'session/not-found') },
    x('O4.2', 'inspect', { sessionId: S.unknown }, done(false, 'Error')),
    x('O4.2', 'cancel', { sessionId: S.unknown }, done(false, 'session/not-found')),
    inspectOf('O4.4', S.core, 'r1', missing()), x('O4.4', 'cancel', { sessionId: S.core }, done(false, 'session/not-found')),
    create('O3.1', S.reply), prompt('O3.1', S.reply, 'r2'), listOf('O3.1', [S.reply, false]), inspectOf('O3.1', S.reply, 'r2', { kind: 'completed' }),
    create('O3.2', S.hold), prompt('O3.2', S.hold, 'r3'), x('O3.2', 'cancel', { sessionId: S.hold }, done(true, { accepted: true })), inspectOf('O3.2', S.hold, 'r3', { kind: 'aborted', reason: { kind: 'user' } }),
  ],
  events: [status('O2.1', S.core, true), status('O2.1', S.core, false), status('O3.2', S.hold, true), status('O3.2', S.hold, false)],
})
/** 按观测与操作取夹具里的第 n 个交换（默认第一个），免得用下标。 */
const pick = (f, observation, operation, n = 0) => f.exchanges.filter((e) => e.observation === observation && e.operation === operation)[n]
const turnEndOf = (e) => e.outcome.value.events.find((ev) => ev.type === 'turn/end')
const fails = (text, check, pattern) => assert.throws(() => check(parseRecord(text)), pattern)
const withoutExchange = (pred) => ({ ...goodFixture(), exchanges: goodFixture().exchanges.filter((e) => !pred(e)) })

// ---- 合成用例 ----
test('推导：全部计入 → implement，插件可达 是，缺项为空', () => {
  assert.deepEqual(deriveConsequence(passing(), []), { consequence: 'implement', reachable: '是', missing: [] })
})
test('推导：缺 O3.2 → narrow，缺项 O3.2', () => {
  assert.deepEqual(deriveConsequence(patch('O3.2', { result: '未观测到' }), []), { consequence: 'narrow', reachable: '是', missing: ['O3.2'] })
  assert.deepEqual(deriveConsequence(patch('O3.1', { strength: 'S0' }), yes('O3.2')), { consequence: 'narrow', reachable: '是', missing: ['O3.1', 'O3.2'] })
})
test('推导：任一 CORE 未观测、强度 S2 或被捷径影响 → move-after-demo', () => {
  for (const id of CORE) {
    const reachable = id === 'O0.1' || id === 'O0.2' ? '否' : '是'
    for (const [how, rows, shortcuts] of [['未观测到', patch(id, { result: '未观测到' }), []], ['强度 S2', patch(id, { strength: 'S2' }), []], ['被捷径影响', passing(), yes(id)]]) {
      assert.deepEqual(deriveConsequence(rows, shortcuts), { consequence: 'move-after-demo', reachable, missing: [id] }, `${id} ${how}`)
    }
  }
})
test('推导：O0.2 未计入 → 插件可达 否', () => {
  assert.equal(deriveConsequence(patch('O0.2', { strength: 'S2' }), []).reachable, '否')
  assert.equal(deriveConsequence(patch('O0.1', { result: '未观测到' }), []).reachable, '否')
  assert.equal(deriveConsequence(passing(), yes('O0.2')).reachable, '否')
  assert.equal(deriveConsequence(patch('O1.1', { result: '未观测到' }), []).reachable, '是')
})
test('推导：非决定项不影响结论', () => {
  for (const id of NON_DECISIVE) {
    assert.deepEqual(deriveConsequence(patch(id, { result: '未观测到', strength: 'S0' }), yes(id)), { consequence: 'implement', reachable: '是', missing: [] }, id)
  }
})
test('推导：预注册 ID 缺失或重复 → 抛错', () => {
  assert.throws(() => deriveConsequence(passing().slice(1), []), /O0\.1 必须恰好出现一次，实际 0 次/)
  assert.throws(() => deriveConsequence([...passing(), row('O3.1')], []), /O3\.1 必须恰好出现一次，实际 2 次/)
  assert.throws(() => parseRecord(render({ rows: passing().slice(1) })), /O0\.1 在 §3 必须恰好一行，实际 0 行/)
  assert.throws(() => parseRecord(render({ rows: [...passing(), row('O4.4')] })), /O4\.4 在 §3 必须恰好一行，实际 2 行/)
})
test('推导：声明的结论块与推导不一致 → 失败；合成记录与夹具通过全部检查', () => {
  const text = render()
  const rec = parseRecord(text)
  for (const check of [checkConclusion, checkTimes, checkMapping]) check(rec)
  checkHygiene(text, '记录')
  checkFixture(rec, goodFixture())
  fails(render({ declared: ['narrow', '是', 'O3.2'] }), checkConclusion, /不一致/)
  fails(render({ declared: ['implement', '否', '无'] }), checkConclusion, /不一致/)
  assert.deepEqual(parseRecord(render({ declared: ['narrow', '是', 'O3.1、O3.2'] })).declared.missing, ['O3.1', 'O3.2'])
})
test('解析：表头、取值、未预注册 ID、反引号、捷径 O-ID 逐个列出', () => {
  assert.throws(() => parseRecord(render().replace('时间（UTC）', '时间')), /缺少表头/)
  assert.throws(() => parseRecord(render({ rows: patch('O0.1', { result: '部分观测到' }) })), /取值非法/)
  assert.throws(() => parseRecord(render({ rows: patch('O0.1', { strength: 'S4' }) })), /取值非法/)
  assert.throws(() => parseRecord(render({ rows: [...passing(), row('O9.9')] })), /未预注册的 O-ID：O9\.9/)
  assert.throws(() => parseRecord(render().replace('`cmd`', 'cmd')), /缺少反引号/)
  assert.throws(() => parseRecord(render().replace('| O0.1 | Q |', '| O0.1 | Q | 多余 |')), /§3 行格式错误：O0\.1/)
  assert.deepEqual(cells('| a `x|y` | b \\| c |'), ['a `x|y`', 'b | c']) // 反引号内与转义的竖线不切格
  assert.throws(() => parseRecord(render({ titles: TITLES.slice(0, 8) })), /九个二级标题/)
  assert.throws(() => parseRecord(render({ titles: [...TITLES, TITLES[8]] })), /九个二级标题/)
  for (const cell of ['O3.x', 'O3.1–O3.2', 'O2.1-O2.2']) assert.throws(() => parseRecord(render({ shortcuts: [['x', cell, '否', 'y']] })), /逐个列出/, cell)
  assert.throws(() => parseRecord(render({ shortcuts: [['x', 'O3.1', '部分', 'y']] })), /是 \/ 否/)
  assert.throws(() => parseRecord(render({ shortcuts: [['x', '—', '是', 'y']] })), /没有可解析的 O-ID/)
  assert.throws(() => parseRecord(render({ shortcuts: [['x', 'O9.9', '是', 'y']] })), /列出了未预注册的 O-ID/)
  assert.deepEqual(parseRecord(render({ shortcuts: [['x', 'O4.2、O3.1', '是', 'y']] })).shortcuts, [{ name: 'x', ids: ['O4.2', 'O3.1'], affects: '是', reason: 'y' }])
})
test('夹具：结论不是 move-after-demo 时夹具缺失 → 失败', () => {
  assert.throws(() => checkFixture(parseRecord(render()), undefined), /必须有夹具/)
  const madRecord = (whyNot) => parseRecord(render({ rows: patch('O1.1', { result: '未观测到' }), declared: ['move-after-demo', '是', 'O1.1'], whyNot }))
  checkFixture(madRecord(true), undefined)
  assert.throws(() => checkFixture(madRecord(false), undefined), /6\.1 为何录不到/)
})
test('夹具：start 或 status read 缺失 → 失败', () => {
  const rec = parseRecord(render())
  assert.throws(() => checkFixture(rec, withoutExchange((e) => e.operation === 'create')), /start 缺失.*create/)
  assert.throws(() => checkFixture(rec, withoutExchange((e) => e.operation === 'prompt')), /start 缺失.*prompt/)
  assert.throws(() => checkFixture(rec, withoutExchange((e) => ['list', 'inspect'].includes(e.operation) && ['O2.1', 'O2.2'].includes(e.observation))), /status read 缺失/)
  const failedCreate = goodFixture()
  pick(failedCreate, 'O1.1', 'create').outcome = done(false, 'gateway/bad-request')
  assert.throws(() => checkFixture(rec, failedCreate), /start 缺失/)
})
test('夹具：observation 指向未观测行 → 失败', () => {
  assert.throws(() => checkFixture(parseRecord(render({ rows: patch('O2.1', { result: '未观测到' }), declared: ['move-after-demo', '是', 'O2.1'], whyNot: true })), goodFixture()), /observation「O2\.1」不指向/)
  const stray = goodFixture()
  stray.events[0].observation = 'O9.9'
  assert.throws(() => checkFixture(parseRecord(render()), stray), /observation「O9\.9」不指向/)
})
test('夹具：inspect 事件出现白名单外的键 → 失败', () => {
  const rec = parseRecord(render())
  const mutate = (edit) => { const f = goodFixture(); edit(f); return f }
  for (const [what, edit] of [
    ['事件键', (f) => { pick(f, 'O2.2', 'inspect').outcome.value.events[0].time = 1 }],
    ['事件类型', (f) => { pick(f, 'O2.2', 'inspect').outcome.value.events[0].type = 'assistant/message' }],
    ['inspect 的 value', (f) => { pick(f, 'O2.2', 'inspect').outcome.value.meta = {} }],
    ['reason 的键', (f) => { turnEndOf(pick(f, 'O3.1', 'inspect')).reason.usage = {} }],
    ['list 行', (f) => { pick(f, 'O2.1', 'list').outcome.value.items[0].updatedAt = 1 }],
    ['状态事件', (f) => { f.events[0].at = '2026-10-15T05:00:00Z' }],
    ['交换', (f) => { pick(f, 'O1.1', 'create').at = '2026-10-15T05:00:00Z' }],
    ['operation', (f) => { pick(f, 'O4.2', 'cancel').operation = 'follow' }],
    ['reason.reason 的键', (f) => { turnEndOf(pick(f, 'O3.2', 'inspect')).reason.reason.message = 'x' }],
    ['reason.error 的键', (f) => { turnEndOf(pick(f, 'O2.2', 'inspect')).reason.error.message = 'x' }],
    ['失败的 error', (f) => { pick(f, 'O4.2', 'cancel').outcome.error.stack = 'x' }],
    ['状态事件的 event', (f) => { f.events[0].event = 'api-session/other' }],
    ['outcome.ok 的类型', (f) => { pick(f, 'O4.2', 'cancel').outcome.ok = 'no' }],
  ]) assert.throws(() => checkFixture(rec, mutate(edit)), /白名单|只能取|布尔/, what)
  assert.throws(() => checkFixture(rec, { ...goodFixture(), events: undefined }), /必须是 \{ provenance, exchanges, events \}/)
  const wrongValue = goodFixture()
  pick(wrongValue, 'O1.2', 'prompt').outcome.value.accepted = false
  assert.throws(() => checkFixture(rec, wrongValue), /start 缺失.*prompt/)
  const wrongPrefix = goodFixture()
  pick(wrongPrefix, 'O1.1', 'create').outcome.value.sessionId = 'x-1'
  assert.throws(() => checkFixture(rec, wrongPrefix), /start 缺失.*create/)
})
test('夹具：§3 写「已观测到 / S3」的行在夹具里找不到判据支撑 → 失败', () => {
  assert.deepEqual([...RECORD_ONLY, ...Object.keys(FIXTURE_EVIDENCE)], ALL) // 每个预注册 O-ID 要么有夹具判定，要么只由记录证明
  const rec = parseRecord(render())
  const mutate = (edit) => { const f = goodFixture(); edit(f); return f }
  const drop = (observation, operation) => (f) => { f.exchanges = f.exchanges.filter((e) => !(e.observation === observation && e.operation === operation)) }
  const coreRow = (f) => pick(f, 'O2.1', 'list').outcome.value.items[0]
  for (const [id, edit] of [
    ['O1.1', (f) => { delete pick(f, 'O1.1', 'create').request.cwd }],
    ['O1.2', (f) => { pick(f, 'O1.2', 'prompt').request.sessionId = S.reply }],
    ['O2.1', (f) => { f.events[0].running = false }],
    ['O2.1', (f) => { coreRow(f).running = true }],
    ['O2.2', (f) => { pick(f, 'O2.2', 'inspect').outcome.value.events.pop() }],
    ['O2.2', (f) => { pick(f, 'O2.2', 'inspect').outcome.value.events.shift() }],
    ['O3.1', (f) => { pick(f, 'O3.1', 'prompt').outcome.value.accepted = false }],
    ['O3.1', (f) => { turnEndOf(pick(f, 'O3.1', 'inspect')).reason = { kind: 'error', error: { code: 'X' } } }],
    ['O3.1', (f) => { pick(f, 'O3.1', 'list').outcome.value.items[0].running = true }],
    ['O3.2', (f) => { pick(f, 'O3.2', 'cancel').outcome.value.accepted = false }],
    ['O3.2', (f) => { turnEndOf(pick(f, 'O3.2', 'inspect')).reason.reason.kind = 'parent' }],
    ['O3.2', (f) => { f.events = f.events.filter((e) => !(e.observation === 'O3.2' && e.running)) }],
    ['O4.1', drop('O4.1', 'prompt')],
    ['O4.1', (f) => { pick(f, 'O4.1', 'prompt').request.requestId = 'r9' }],
    ['O4.1', (f) => { pick(f, 'O1.2', 'prompt').request.requestId = 'r0' }],
    ['O4.1', (f) => { pick(f, 'O4.3', 'inspect').outcome.value.events.push(evt(3, 'user/message', { rpcId: 'r1' })) }],
    ['O4.2', drop('O4.2', 'inspect')],
    ['O4.2', (f) => { pick(f, 'O4.2', 'cancel').request.sessionId = S.core }],
    ['O4.2', (f) => { pick(f, 'O4.2', 'prompt').request.content[0].text = 'x' }],
    ['O4.3', drop('O4.3', 'inspect')],
    ['O4.3', (f) => { coreRow(f).agentAvailable = false }],
    ['O4.4', (f) => { pick(f, 'O4.4', 'cancel').outcome = done(true, { accepted: true }) }],
    ['O4.4', (f) => { pick(f, 'O4.4', 'cancel').outcome = done(false, 'gateway/internal') }],
    ['O4.4', (f) => { turnEndOf(pick(f, 'O4.4', 'inspect')).reason = { kind: 'completed' } }],
  ]) assert.throws(() => checkFixture(rec, mutate(edit)), new RegExp(`${id.replace('.', '\\.')} 在 §3 是「已观测到 / S3」，夹具却不支持`), id)
  const without = (id) => mutate((f) => { f.exchanges = f.exchanges.filter((e) => e.observation !== id); f.events = f.events.filter((e) => e.observation !== id) })
  checkFixture(parseRecord(render({ rows: patch('O4.4', { result: '未观测到', strength: 'S0' }) })), without('O4.4')) // 只绑「已观测到 / S3」的行
  checkFixture(parseRecord(render({ rows: patch('O4.3', { strength: 'S2' }) })), without('O4.3'))
  assert.throws(() => checkFixture(parseRecord(render({ recordOnly: null })), goodFixture()), /§8 须写明只由本记录证明/)
  assert.throws(() => checkFixture(parseRecord(render({ recordOnly: [...RECORD_ONLY, 'O3.2'] })), goodFixture()), /§8 须写明只由本记录证明/)
})
test('夹具：成功请求、list 行或状态事件指向不是此前 create 返回的会话 → 失败', () => {
  const rec = parseRecord(render())
  const mutate = (edit) => { const f = goodFixture(); edit(f); return f }
  for (const [pattern, edit] of [
    [/O3\.1 的 prompt 对 session-2 成功，但此前没有 create 返回过它/, (f) => { const i = f.exchanges.indexOf(pick(f, 'O3.1', 'create')); [f.exchanges[i], f.exchanges[i + 1]] = [f.exchanges[i + 1], f.exchanges[i]] }],
    [/O2\.1 的 list 行 session-9 不是此前 create 返回的会话/, (f) => { pick(f, 'O2.1', 'list').outcome.value.items.push({ sessionId: 'session-9', running: false, agentAvailable: true, blank: false }) }],
    [/状态事件的会话 session-9 不是/, (f) => { f.events.push(status('O2.1', 'session-9', true)) }],
    [/create 重复返回 session-1/, (f) => { f.exchanges.push(create('O3.2', S.core)) }],
  ]) assert.throws(() => checkFixture(rec, mutate(edit)), pattern)
})
test('映射：来源 O-ID 在夹具里没有对应的结束原因或 running: true 事件 → 失败', () => {
  const withRow = (r) => parseRecord(render({ mapping: [...MAPPING, r] }))
  checkFixture(withRow(['`turn/end`，`reason.kind` 为 `error`', 'failed', 'O2.2、O4.4']), goodFixture())
  for (const [r, pattern] of [
    [['`turn/end`，`reason.kind` 为 `aborted`', 'canceled', 'O4.3'], /来源 O4\.3 在夹具里没有 reason\.kind 为 aborted 的 turn\/end/],
    [['`turn/end`，结束原因未写', 'unknown', 'O3.1'], /未写结束原因/],
    [['`running: true`', 'running', 'O3.1'], /来源 O3\.1 在夹具里没有 running: true 的状态事件/],
    [['`list` 里 `running: false`', 'succeeded', 'O3.1'], /无法在夹具里核对/],
  ]) assert.throws(() => checkFixture(withRow(r), goodFixture()), pattern, r[0])
})
test('捷径：§5 的影响判定与预注册 §2.4 不一致、漏列点名的 O-ID 或块外新增未注明 → 失败', () => {
  const block = '<!-- session-rule:begin -->\n| 捷径 | 影响判定 | 理由 |\n|---|---|---|\n| 探针 | 否 | r |\n| 绕闸门 | 是（O0.1） | r |\n| 假 `ctx` | 是（受影响的每一行） | r |\n<!-- session-rule:end -->\n'
  const frozen = preregisteredShortcuts(block)
  assert.deepEqual(frozen, { 探针: { affects: '否', ids: [] }, 绕闸门: { affects: '是', ids: ['O0.1'] }, '假 `ctx`': { affects: '是', ids: [] } })
  const rec = (...shortcuts) => parseRecord(render({ shortcuts }))
  checkShortcuts(rec(['探针', 'O1.1', '否', 'r'], ['绕闸门', 'O0.1、O0.2', '是', 'r'], ['新捷径', '—', '否', '块外新增：r']), frozen)
  assert.throws(() => checkShortcuts(rec(['探针', 'O1.1', '是', 'r']), frozen), /「探针」的影响判定与预注册 §2\.4 不一致/)
  assert.throws(() => checkShortcuts(rec(['绕闸门', 'O0.2', '是', 'r']), frozen), /「绕闸门」须列出预注册 §2\.4 点名的 O0\.1/)
  assert.throws(() => checkShortcuts(rec(['新捷径', '—', '否', 'r']), frozen), /「新捷径」不在块 §2\.4，理由列须注明「块外新增」/)
  assert.throws(() => preregisteredShortcuts(block.replace('| 否 | r |', '| 部分 | r |')), /必须以 是 \/ 否 开头/)
})
test('卫生：临时路径、令牌、回环端口、家目录、假密钥前缀 → 失败', () => {
  for (const leak of ['/var/folders/x', '/private/tmp/a', '/tmp/a', 'token=abc', 'localhost:3080', '127.0.0.1:5000', '/Us' + 'ers/x', '/ho' + 'me/x', 'hp-probe-fake-0', 'x-api-key']) { // 拆开写，免得本文件自己命中 disclosure 的家目录模式
    assert.throws(() => checkHygiene(`前 ${leak} 后`, '记录'), /含临时路径/, leak)
  }
  checkHygiene('端口写作 <port>，根目录写作 <scratch>/work', '记录')
  const leaky = goodFixture()
  leaky.provenance.leak = '127.0.0.1:5000'
  assert.throws(() => checkFixture(parseRecord(render()), leaky), /夹具含临时路径/)
})
test('时间：格式、预注册先于 T0、决定性行不早于 T0', () => {
  fails(render({ rows: patch('O0.1', { time: '2026-10-15 05:00' }) }), checkTimes, /YYYY-MM-DDTHH:MM:SSZ/)
  fails(render({ rows: patch('O4.1', { time: '2026-10-15T25:00:00Z' }) }), checkTimes, /YYYY-MM-DDTHH:MM:SSZ/)
  fails(render({ prereg: '2026-10-15T04:30:00Z' }), checkTimes, /预注册时间必须早于 T0/)
  fails(render({ t0: '2026-10-15T04:00' }), checkTimes, /YYYY-MM-DDTHH:MM:SSZ/)
  fails(render({ rows: patch('O4.1', { time: '2026-02-31T00:00:00Z' }) }), checkTimes, /YYYY-MM-DDTHH:MM:SSZ/)
  fails(render({ rows: patch('O4.1', { time: '2026-10-15T24:00:00Z' }) }), checkTimes, /YYYY-MM-DDTHH:MM:SSZ/)
  fails(render({ rows: patch('O4.1', { time: '2026-10-15T02:00:00Z' }) }), checkTimes, /O4\.1 的时间早于预注册/)
  fails(render({ rows: patch('O1.1', { time: '2026-10-15T03:30:00Z' }) }), checkTimes, /O1\.1 的决定性观测早于 T0/)
  fails(render({ rows: patch('O3.2', { time: '2026-10-15T03:30:00Z' }) }), checkTimes, /O3\.2 的决定性观测早于 T0/)
  checkTimes(parseRecord(render({ rows: patch('O4.1', { time: '2026-10-15T03:30:00Z' }) }))) // 非决定项可以早于 T0
  checkTimes(parseRecord(render({ rows: patch('O1.1', { result: '未观测到', strength: 'S0', time: '2026-10-15T03:30:00Z' }) }))) // 未观测到的行不受 T0 约束
})
test('版本：记录与夹具的宿主版本不一致 → 失败', () => {
  assert.throws(() => checkFixture(parseRecord(render({ version: '0.2.1-alpha.3' })), goodFixture()), /宿主版本不一致/)
  const noProvenance = goodFixture()
  delete noProvenance.provenance
  assert.throws(() => checkFixture(parseRecord(render()), noProvenance), /宿主版本不一致/)
  checkFixture(parseRecord(render({ version: '0.2.1-alpha.3' })), { ...goodFixture(), provenance: { hostVersion: '0.2.1-alpha.3' } })
})
test('版本：§2 的版本来源少于三行或没读到宿主版本 → 失败', () => {
  checkSources(parseRecord(render()))
  assert.throws(() => checkSources(parseRecord(render({ sources: ['`0.2.0-rc.2`', '`0.2.0-rc.2`', '`0.2.1-alpha.3`'] }))), /版本来源没有读到宿主版本 0\.2\.0-rc\.2：读数：`0\.2\.1-alpha\.3`/)
  assert.throws(() => checkSources(parseRecord(render({ sources: ['`0.2.0-rc.2`', '`0.2.0-rc.2`'] }))), /至少要有三行版本来源，实际 2 行/)
})
test('映射：来源引用未观测的 O-ID 或状态不在 ExecutionRunStatus → 失败', () => {
  checkMapping(parseRecord(render()))
  fails(render({ mapping: [['x', 'succeeded', 'O9.9']] }), checkMapping, /来源 O9\.9 不是「已观测到」/)
  fails(render({ rows: patch('O3.1', { result: '未观测到' }) }), checkMapping, /来源 O3\.1 不是「已观测到」/)
  fails(render({ mapping: [['x', 'done', 'S1']] }), checkMapping, /不是 ExecutionRunStatus/)
  fails(render({ mapping: [['`completed`', 'failed', 'O3.1']] }), checkMapping, /应映射为 succeeded/)
  fails(render({ mapping: [['x', 'running', '猜测']] }), checkMapping, /O-ID 或 S1/)
  assert.throws(() => parseRecord(render({ mapping: [] })), /没有数据行/)
})
test('索引：缺行或链接目录与计划所在目录不一致 → 失败', () => {
  const arch = '| [harness-session-api.md](harness-session-api.md) | 问题 |'
  const root = (dir) => `| [计划](exec-plan/${dir}/${PLAN}) | 范围 |`
  checkIndexes({ arch, root: root('active'), planDir: 'active' })
  assert.throws(() => checkIndexes({ arch: '| 无 |', root: root('active'), planDir: 'active' }), /没有登记 harness-session-api\.md/)
  assert.throws(() => checkIndexes({ arch, root: '| 无 |', planDir: 'active' }), /没有登记本计划/)
  assert.throws(() => checkIndexes({ arch, root: root('completed'), planDir: 'active' }), /链接目录 completed\/ 与计划所在目录 active\/ 不一致/)
})
test('判据：§3 的判据不是预注册块的原文或块里没有该 ID → 失败；只折叠空白', () => {
  const criteria = Object.fromEntries(ALL.map((id) => [id, `判据 ${id}`]))
  const withCriteria = (over = {}) => parseRecord(render({ rows: passing().map((r) => ({ ...r, criterion: over[r.id] ?? `判据  ${r.id}` })) }))
  checkCriteria(withCriteria(), criteria)
  assert.throws(() => checkCriteria(withCriteria({ 'O3.2': '压缩改写' }), criteria), /O3\.2 的判据与预注册块不一致/)
  assert.throws(() => checkCriteria(withCriteria(), { ...criteria, 'O1.1': undefined }), /预注册块里没有 O1\.1 的判据/)
  const block = '<!-- session-rule:begin -->\n| S3 | 定义 |\n| O0.1 | — | 判据 `a` |\n| O1.1 | R2 | 判据 `b` 之后 |\n<!-- session-rule:end -->\n'
  assert.deepEqual(preregisteredCriteria(block), { 'O0.1': '判据 `a`', 'O1.1': '判据 `b` 之后' })
})
test('计划定位：active 与 completed 下没有或有两份 → 失败', () => {
  assert.throws(() => findPlan(() => false), /实际 0 份/)
  assert.throws(() => findPlan(() => true), /实际 2 份/)
})

// ---- 真实文件：缺失时必须响亮失败 ----
const readReal = (rel, what) => {
  assert.ok(existsSync(path.join(ROOT, rel)), `${what}缺失：${rel}`)
  return readFileSync(path.join(ROOT, rel), 'utf8')
}
test('预注册常量：CORE、IMPLEMENT、NON_DECISIVE 与计划的 session-rule 块逐项相等', () => {
  const synthetic = '| 行内 `<!-- session-rule:begin -->` |\n<!-- session-rule:begin -->\n- `CORE`：O0.1、O0.2\n- `IMPLEMENT`：O3.1\n- `NON_DECISIVE`：O4.1\n<!-- session-rule:end -->\n'
  assert.deepEqual(preregistered(synthetic), { CORE: ['O0.1', 'O0.2'], IMPLEMENT: ['O3.1'], NON_DECISIVE: ['O4.1'] })
  assert.throws(() => preregistered('正文里的 <!-- session-rule:begin --> 不在行首'), /找不到 session-rule 块/)
  assert.deepEqual(preregistered(findPlan().text), { CORE, IMPLEMENT, NON_DECISIVE })
})
test('真实记录：结论块等于推导', () => checkConclusion(parseRecord(readReal(RECORD, '真实记录'))))
test('真实记录：§3 判据逐字取自预注册块', () => checkCriteria(parseRecord(readReal(RECORD, '真实记录')), preregisteredCriteria(findPlan().text)))
test('真实记录：时间、卫生、映射与索引登记', () => {
  checkIndexes({ arch: readReal('docs/architecture/README.md', '架构索引'), root: readReal('docs/README.md', '文档地图'), planDir: findPlan().dir })
  const text = readReal(RECORD, '真实记录')
  const rec = parseRecord(text)
  checkTimes(rec)
  checkHygiene(text, '记录')
  checkMapping(rec)
})
test('真实记录：§2 三处版本来源都读到宿主版本', () => checkSources(parseRecord(readReal(RECORD, '真实记录'))))
test('真实记录：§5 捷径的影响判定与预注册 §2.4 一致', () => checkShortcuts(parseRecord(readReal(RECORD, '真实记录')), preregisteredShortcuts(findPlan().text)))
test('真实夹具：与记录一致、版本、白名单与卫生', () => {
  const rec = parseRecord(readReal(RECORD, '真实记录'))
  checkFixture(rec, existsSync(path.join(ROOT, FIXTURE)) ? JSON.parse(readReal(FIXTURE, '真实夹具')) : undefined)
})
