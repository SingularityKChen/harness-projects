/**
 * 观察形状与去重键契约测试。
 *
 * 保护的不变量：没有平台事件 id 时，去重键必须由 type + 带 scope 的主体 + 事件时间 + 稳定 payload
 * 字段的哈希确定——相同输入得到同一键，重复观察只处理一次；不稳定 payload（如原始报文）不得影响
 * 去重键，否则同一事件会因报文抖动被重复处理。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareSourceVersion, isComparableSourceVersion, makeObservation, observationDedupeKey, scopedSubjectKey, stablePayloadHash } from '@harness-projects/capabilities'

const subject = (bindingId = 'binding-a', externalId = 'issue-1') => ({ bindingId, objectKind: 'issue', externalId, url: undefined })

const input = (overrides = {}) => ({
  subject: subject(),
  type: 'issue.updated',
  eventTime: '2026-09-20T10:00:00Z',
  receivedTime: '2026-09-20T10:00:05Z',
  sourceVersion: 'v1',
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

test('比较器边界：按码点序而非 UTF-16 码元序，undefined 最小，空串不是合法载体', () => {
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
  // 定义域是**非空** ASCII 可打印：空串与 undefined 是两个不同的东西，空串被拒绝。
  assert.equal(isComparableSourceVersion(''), false, '空串不是合法载体：undefined 是"没有版本"的唯一表达')
  assert.equal(isComparableSourceVersion('2026-09-21T07:11:54Z'), true)
  assert.equal(isComparableSourceVersion('~'), true, 'ASCII 可打印的最右端点仍在定义域内')
  assert.equal(isComparableSourceVersion('版本'), false, '非 ASCII 不是可比的载体')
  assert.equal(isComparableSourceVersion('\u007f'), false, 'DEL 不是可打印 ASCII')
})
