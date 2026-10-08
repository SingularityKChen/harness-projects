/**
 * 观察形状与去重键契约测试。
 *
 * 保护的不变量：没有平台事件 id 时，去重键必须由 type + 带 scope 的主体 + 事件时间 + 稳定 payload
 * 字段的哈希确定——相同输入得到同一键，重复观察只处理一次；不稳定 payload（如原始报文）不得影响
 * 去重键，否则同一事件会因报文抖动被重复处理。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as cap from '@harness-projects/capabilities'
import { compareSourceVersion, isComparableSourceVersion, makeObservation, observationDedupeKey, scopedSubjectKey, stablePayloadHash } from '@harness-projects/capabilities'
import { createFakeDevelopmentProvider } from '@harness-projects/provider-fake'

const subject = (bindingId = 'binding-a', externalId = 'issue-1') => ({ bindingId, objectKind: 'issue', externalId, url: undefined })

const input = (overrides = {}) => ({
  subject: subject(),
  type: 'issue.updated',
  eventTime: '2026-09-20T10:00:00Z',
  receivedTime: '2026-09-20T10:00:05Z',
  sourceVersion: '2026-09-20T10:00:00.000000000Z',
  stablePayloadFields: { state: 'open', assignee: 'actor-1' },
  payload: { raw: 'x'.repeat(64) },
  ...overrides,
})

test('去重键：相同输入得到同一 64 位十六进制键，主体 scope 变化必须改变键', () => {
  const first = observationDedupeKey(input())
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(observationDedupeKey(input()), first)
  // 同一外部 id 出现在两个 binding 下是两个不同对象，不得互相去重。
  assert.notEqual(observationDedupeKey(input({ subject: subject('binding-b') })), first)
  assert.notEqual(observationDedupeKey(input({ type: 'issue.closed' })), first)
  assert.notEqual(observationDedupeKey(input({ eventTime: '2026-09-20T11:00:00Z' })), first)
  assert.notEqual(observationDedupeKey(input({ stablePayloadFields: { state: 'closed', assignee: 'actor-1' } })), first)
})

test('稳定 payload 哈希与键序无关，不稳定 payload 不参与去重键', () => {
  assert.equal(stablePayloadHash({ a: 1, b: { c: 2, d: 3 } }), stablePayloadHash({ b: { d: 3, c: 2 }, a: 1 }))
  assert.notEqual(stablePayloadHash({ a: 1 }), stablePayloadHash({ a: 2 }))
  const first = makeObservation(input())
  const replayed = makeObservation(input({ payload: { raw: '完全不同的原始报文' } }))
  assert.equal(replayed.dedupeKey, first.dedupeKey)
  assert.equal(first.bindingId, 'binding-a')
  assert.equal(first.payloadHash, stablePayloadHash({ state: 'open', assignee: 'actor-1' }))
})

test('scopedSubjectKey 在同一 binding 内唯一标识对象，且带 binding 前缀', () => {
  assert.equal(scopedSubjectKey(subject()), scopedSubjectKey(subject()))
  assert.notEqual(scopedSubjectKey(subject('binding-a')), scopedSubjectKey(subject('binding-b')))
  assert.notEqual(scopedSubjectKey(subject()), scopedSubjectKey({ ...subject(), objectKind: 'draft' }))
})

test('比较器边界：码点序、undefined 最小；合法载体只有规范 UTC 纳秒时间戳', () => {
  // U+FF5E 与 U+1F600：码点序是 U+FF5E < U+1F600，而 JS 的 `<` 比 UTF-16 码元（0xFF5E > 0xD83D）给出相反结论。
  assert.equal(compareSourceVersion('\uff5e', '\u{1F600}'), -1)
  assert.equal(compareSourceVersion('\u{1F600}', '\uff5e'), 1)
  assert.ok(!('\uff5e' < '\u{1F600}'), 'JS 的 < 是 UTF-16 码元序，不得用作版本判据')
  // undefined 最小：没有版本排在所有合法载体之前。
  assert.equal(compareSourceVersion(undefined, 'v1'), -1)
  assert.equal(compareSourceVersion('v1', undefined), 1)
  assert.equal(compareSourceVersion(undefined, undefined), 0)
  // ASCII 内部的顺序同样钉住（第五轮评审）：大小写按码点（'Z' < 'z'，localeCompare 会给出相反结论），前缀更短者更小。
  assert.equal(compareSourceVersion('2026-09-21T07:11:54Z', '2026-09-21T07:11:54z'), -1)
  assert.equal(compareSourceVersion('v1', 'v10'), -1)
  assert.equal(compareSourceVersion('v1', 'v1'), 0)
  // 定义域只有规范载体：空串、秒级、非 ASCII、日历非法、小写 t/z 都不是；`undefined` 是"没有版本"的唯一表达。
  assert.equal(isComparableSourceVersion(''), false, '空串不是合法载体：undefined 是"没有版本"的唯一表达')
  assert.equal(isComparableSourceVersion('2026-09-21T07:11:54Z'), false, '秒级未归一，与 .500Z 比较会被判成乱序')
  assert.equal(isComparableSourceVersion('~'), false, 'ASCII 可打印不再是载体的充分条件')
  assert.equal(isComparableSourceVersion('版本'), false, '非 ASCII 不是可比的载体')
  assert.equal(isComparableSourceVersion('\u007f'), false, 'DEL 不是可打印 ASCII')
  assert.equal(isComparableSourceVersion('2026-09-21T07:11:54.000000000Z'), true)
  assert.equal(isComparableSourceVersion('2026-02-30T00:00:00.000000000Z'), false, '形状对但日历非法')
  assert.equal(isComparableSourceVersion('2026-09-21t07:11:54.000000000z'), false, '小写 t/z 不是不动点')
})

test('sourceVersionFromTimestamp 把 RFC 3339 无损归一成定宽 UTC 纳秒形态', () => {
  const cases = [
    ['2026-09-21T07:11:54Z', '2026-09-21T07:11:54.000000000Z'],
    ['2026-09-21T07:11:54.5Z', '2026-09-21T07:11:54.500000000Z'],
    ['2026-09-21T07:11:54.500Z', '2026-09-21T07:11:54.500000000Z'],
    ['2026-09-21T07:11:54.51Z', '2026-09-21T07:11:54.510000000Z'],
    ['2026-09-21T07:11:54.123456789Z', '2026-09-21T07:11:54.123456789Z'],
    ['2026-09-21T15:11:54+08:00', '2026-09-21T07:11:54.000000000Z'],
    ['2026-09-21T07:11:54-00:00', '2026-09-21T07:11:54.000000000Z'],
    ['2026-09-21t07:11:54z', '2026-09-21T07:11:54.000000000Z'],
    ['0050-01-01T00:00:00Z', '0050-01-01T00:00:00.000000000Z'],
    ['2026-12-31T23:30:00-01:00', '2027-01-01T00:30:00.000000000Z'],
  ]
  for (const [raw, expected] of cases) {
    const out = cap.sourceVersionFromTimestamp(raw)
    assert.equal(out, expected, raw)
    assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/)
    assert.equal(cap.sourceVersionFromTimestamp(out), out, `规范载体是自身的不动点：${raw}`)
    assert.equal(isComparableSourceVersion(out), true)
  }
})

test('归一与进程时区无关：同一输入在 UTC、东八区与有夏令时的时区下逐字相同', () => {
  // 必需检查在 UTC 下运行，本地时间方法（setHours 一类）的回归在那里与 UTC 方法同值、看不出来。这里在进程内
  // 切换 TZ（Node 在给 process.env.TZ 赋值时重读时区），让「只用 UTC 方法」在任何运行环境下都承重。
  // `2026-03-08T02:30:00Z` 落在洛杉矶夏令时跳变的空档（当地 02:00–03:00 不存在）：全程改用本地方法的实现会把它挪走一小时。
  const cases = [
    ['2026-09-21T15:11:54+08:00', '2026-09-21T07:11:54.000000000Z'],
    ['2026-12-31T23:30:00-01:00', '2027-01-01T00:30:00.000000000Z'],
    ['2026-03-08T02:30:00Z', '2026-03-08T02:30:00.000000000Z'],
    ['0050-01-01T00:00:00Z', '0050-01-01T00:00:00.000000000Z'],
  ]
  const original = process.env.TZ
  try {
    for (const tz of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = tz
      for (const [raw, expected] of cases) assert.equal(cap.sourceVersionFromTimestamp(raw), expected, `${tz}：${raw}`)
      assert.equal(isComparableSourceVersion('2026-09-21T07:11:54.000000000Z'), true, `${tz}：规范载体仍是不动点`)
      assert.throws(() => cap.sourceVersionFromTimestamp('9999-12-31T23:59:59-01:00'), RangeError, `${tz}：年份越界`)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

test('无法无损归一的输入一律抛 RangeError，不截断、不猜测', () => {
  const invalid = [
    '2026-09-21T07:11:54', '2026-09-21', '2026-09-21 07:11:54Z', '2026-09-21T07:11:54+0800',
    '2026-02-30T00:00:00Z', '2100-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-09-00T00:00:00Z',
    '2026-09-21T24:00:00Z', '2016-12-31T23:59:60Z', '2026-09-21T07:60:00Z', '2026-09-21T07:11:54+24:00', '2026-09-21T07:11:54+08:60',
    '2026-09-21T07:11:54.1234567891Z', '0000-01-01T00:30:00+01:00', '9999-12-31T23:59:59-01:00',
    '9', '10', 'v9', 'v10', '0123456789abcdef0123456789abcdef01234567', '',
    '２０２６-09-21T07:11:54Z',
  ]
  for (const raw of invalid) assert.throws(() => cap.sourceVersionFromTimestamp(raw), RangeError, JSON.stringify(raw))
  assert.doesNotThrow(() => cap.sourceVersionFromTimestamp('2024-02-29T00:00:00Z'))
  assert.doesNotThrow(() => cap.sourceVersionFromTimestamp('2000-02-29T12:00:00Z'))
})

test('#203 的反例经归一后码点序即时间序（比较器不变）', () => {
  const norm = cap.sourceVersionFromTimestamp
  const pairs = [
    ['2026-09-21T07:11:54Z', '2026-09-21T07:11:54.500Z'],
    ['2026-09-21T07:11:54.5Z', '2026-09-21T07:11:54.51Z'],
    ['2026-09-21T15:11:54+08:00', '2026-09-21T08:00:00Z'],
    // 钉住右侧补零的方向：`.49` 补成 `.490000000`，`.5` 补成 `.500000000`。
    ['2026-09-21T07:11:54.49Z', '2026-09-21T07:11:54.5Z'],
  ]
  for (const [older, newer] of pairs) assert.equal(compareSourceVersion(norm(older), norm(newer)), -1, `${older} < ${newer}`)
  // 同一时刻不同写法归一后逐字相等。
  assert.equal(compareSourceVersion(norm('2026-09-21T07:11:54Z'), norm('2026-09-21T07:11:54.000Z')), 0)
  assert.equal(compareSourceVersion(norm('2026-09-21T15:11:54+08:00'), norm('2026-09-21T07:11:54Z')), 0)
  // 对照：原始串直接比较会把更新的判成更旧，这就是必须先归一的原因。
  assert.equal(compareSourceVersion('2026-09-21T07:11:54.500Z', '2026-09-21T07:11:54Z'), -1)
  for (const raw of ['9', '10', 'v9', 'v10']) assert.equal(isComparableSourceVersion(raw), false, raw)
})

test('development-observation-version-remains-canonical：CR 的 SHA 身份不进观察定序，只按引用相等读回', async () => {
  // 判别性内核只有两点：① sha / v9 / v10 永远不是观察 sourceVersion（CR 的 sourceVersion 是另一字段）；
  // ② 两个词法顺序相反的 sha 作为 CR 身份各自按**引用**相等读回，不因任何排序 / 比较器回归串味。② 按两种创建
  // 顺序各跑一次：只跑升序时「取最大」类回归恰好读回正确值，只跑降序时「取最小」类回归同样漏网。
  // 观察侧的乱序拒绝与「sha 不是载体」的主判据在 tests/contract/suites/storage-sync.js 的两个 Storage 实现组上，
  // ① 只是 Development 侧的护栏。
  const shaSmall = '0'.repeat(40)
  const shaLarge = 'f'.repeat(40)
  assert.ok(shaSmall < shaLarge, '两个 sha 的词法顺序是前提，用它证明读取不走排序')
  for (const version of [shaSmall, shaLarge, 'v9', 'v10']) {
    assert.throws(() => makeObservation(input({ sourceVersion: version })), /规范载体/,
      `${version} 不得成为观察 sourceVersion`)
  }

  const repository = { bindingId: 'binding-a', objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
  for (const order of [[shaSmall, shaLarge], [shaLarge, shaSmall]]) {
    const provider = createFakeDevelopmentProvider({ bindingId: 'binding-a' })
    for (const sha of order) {
      provider.state.commits.push({ ref: { ...repository, objectKind: 'commit', externalId: sha }, sha, message: undefined, changeRequest: undefined })
    }
    const created = []
    for (const sha of order) {
      const result = await provider.createChangeRequest({ repository, head: sha, base: 'main', title: '标题占位', body: '正文占位' })
      assert.equal(result.ok, true)
      assert.equal(result.value.headBranch, undefined, '直接 sha 输入不反推分支，因此两个 CR 都是 detached 身份')
      created.push([sha, result.value.ref])
    }
    for (const [sha, ref] of created) {
      assert.equal((await provider.getChangeRequest(ref)).value.sourceVersion, sha,
        `创建顺序 ${order.map((item) => item[0]).join('→')}：读取按引用相等，不按版本排序`)
    }
  }
})

test('makeObservation 与入口断言拒绝非规范 sourceVersion', () => {
  assert.throws(() => makeObservation(input({ sourceVersion: '2026-09-21T07:11:54Z' })), /规范载体/)
  assert.throws(() => makeObservation(input({ sourceVersion: 'v1' })), /规范载体/)
  const withoutVersion = makeObservation(input({ sourceVersion: undefined }))
  const canonical = makeObservation(input({ sourceVersion: '2026-09-21T07:11:54.000000000Z' }))
  assert.equal(withoutVersion.sourceVersion, undefined)
  assert.equal(canonical.sourceVersion, '2026-09-21T07:11:54.000000000Z')
  assert.equal(canonical.dedupeKey, withoutVersion.dedupeKey, 'sourceVersion 不参与去重键')
  assert.doesNotThrow(() => cap.assertComparableSourceVersion(undefined))
  assert.throws(() => cap.assertComparableSourceVersion('\uff5e'), /规范载体/)
  assert.throws(() => cap.assertComparableSourceVersion('\uff5e'), /ASCII/)
})
