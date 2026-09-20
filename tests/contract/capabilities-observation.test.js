/**
 * 观察形状与去重键契约测试。
 *
 * 保护的不变量：没有平台事件 id 时，去重键必须由 type + 带 scope 的主体 + 事件时间 + 稳定 payload
 * 字段的哈希确定——相同输入得到同一键，重复观察只处理一次；不稳定 payload（如原始报文）不得影响
 * 去重键，否则同一事件会因报文抖动被重复处理。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { makeObservation, observationDedupeKey, scopedSubjectKey, stablePayloadHash } from '@harness-projects/capabilities'

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
