/** 读取保值集成（issue #130）：真实 composeCore→controller→transport→createSync/read()，固定时钟与受控 transport。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { composeCore } from '@harness-projects/core'
import { createController, toWireMetadata } from '@harness-projects/controller'
import { createEntityStore, createSync, createTransport } from '@harness-projects/client'
import { deriveWorkItemDetailView, deriveWorkItemListView } from '@harness-projects/ui-model'
import { createFakeProviders, fixtureProjectRef } from '@harness-projects/provider-fake'

const metadata = { planningSourceName: '规划源', sourceNames: {} }
const T = (n) => `2026-10-03T10:0${n}:00.000Z`
const client = (transport) => createSync(transport, createEntityStore(), { clock: clockOf(T(1), T(2), T(3)) })
const clockOf = (...times) => { let calls = 0; return () => times[Math.min(calls++, times.length - 1)] }

async function compose(providers) {
  const id = newWorkspaceId()
  const core = await composeCore({
    workspace: { id, name: 'MVP-0', statusPolicy: StatusPolicy.HostAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }, providers,
  })
  return { id, controller: createController(core) }
}
const scripted = (controller) => ({
  events: [],
  fetchBaseline: () => controller.baseline(),
  poll() { return Promise.resolve(this.events.shift()) },
  close() {},
})
const phaseOf = (read, extra = {}) => ({ read, metadata, phase: 'received', refreshing: false, ...extra })
const targetOf = (read, projectId) => {
  const body = deriveWorkItemListView(phaseOf(read)).body
  assert.equal(body.kind, 'content', '前置：读取必须已产生内容')
  const row = body.rows.find((candidate) => candidate.kind === 'item')
  assert.ok(row, '前置：种子必须含至少一条可见工作项')
  return { projectId, itemId: row.key }
}
const contentOf = (read, target, extra) => {
  const body = deriveWorkItemDetailView(phaseOf(read, extra), target).body
  assert.equal(body.kind, 'content')
  return body
}
const metaOf = (base, headFresh, rowFresh) => ({
  ...toWireMetadata(base), source: { ...base.source, freshness: headFresh ? 'fresh' : 'degraded' },
  entities: base.entities.map(({ entityId, source }) => ({ entityId, source: { ...source, freshness: rowFresh() ? 'fresh' : 'degraded' } })),
})

test('sync-loss-preserves-visible-detail：断线前后 title/body/status/identity/时间 deepEqual，stale 由 false 转 true', async () => {
  const { id, controller } = await compose(createFakeProviders())
  const sync = client(createTransport(controller))
  await sync.connect()
  const target = targetOf(sync.read(), id)
  const before = contentOf(sync.read(), target)
  assert.ok(before.title && before.body && before.identity, '前置：可见行必须带内容与来源身份')
  assert.equal(before.stale, false)

  sync.disconnect()
  const after = contentOf(sync.read(), target, { phase: 'failed', hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind: 'offline' } })
  assert.deepEqual(after, { ...before, stale: true }, '断线只改新鲜度：内容、身份与时间逐字保留')
  assert.equal(sync.read().connection.connected, false)
})

test('sync-source-degraded-retains-content：Provider 降级 metadata 帧后连接保持正常、所选行转 stale，内容与时间保留', async () => {
  const { id, controller } = await compose(createFakeProviders())
  const transport = scripted(controller)
  const sync = client(transport)
  await sync.connect()
  const base = await controller.baseline()
  const target = targetOf(sync.read(), id)
  const before = contentOf(sync.read(), target)

  transport.events.push({ kind: 'metadata', metadata: metaOf(base, false, () => false) })
  assert.equal((await sync.poll()).kind, 'metadata')
  const read = sync.read()
  assert.deepEqual([read.connection.connected, read.lastUpdatedAt], [true, T(1)], '降级不推进时间，连接仍是正常')
  assert.ok(read.reason, '来源降级必有解释')
  const after = contentOf(read, target)
  assert.deepEqual({ ...after, stale: false }, before, '降级只改新鲜度，正文与身份不得被清空')
  assert.equal(after.stale, true)
})

test('sync-recovery-reprojects：恢复帧与增量重新投影实际内容，不沿用缓存', async () => {
  const { id, controller } = await compose(createFakeProviders())
  const transport = scripted(controller)
  const sync = client(transport)
  await sync.connect()
  const base = await controller.baseline()
  const target = targetOf(sync.read(), id)
  const original = contentOf(sync.read(), target)

  transport.events.push({ kind: 'metadata', metadata: metaOf(base, false, () => false) })
  await sync.poll()
  assert.equal(contentOf(sync.read(), target).stale, true, '先降级：不能冒充当前值')

  transport.events.push({ kind: 'metadata', metadata: metaOf(base, true, () => true) })
  assert.equal((await sync.poll()).kind, 'metadata')
  const recovered = contentOf(sync.read(), target)
  assert.deepEqual([recovered.stale, recovered.lastUpdatedAt], [false, T(2)], '恢复推进确认时间并回到当前值')
  assert.deepEqual([recovered.title, recovered.body], [original.title, original.body], '恢复帧本身不改内容')

  const entity = base.entities.find((candidate) => candidate.entityId === target.itemId)
  const revision = base.revision + 1
  const source = { ...base.source, revision }
  transport.events.push({ kind: 'delta', delta: { previousRevision: base.revision, revision, source, upserts: [{ ...entity, content: { ...entity.content, title: '恢复后的新标题' }, source }], removed: [], workspace: base.workspace, capabilities: base.capabilities } })
  assert.equal((await sync.poll()).kind, 'delta')
  const reprojected = contentOf(sync.read(), target)
  assert.deepEqual([reprojected.title, reprojected.lastUpdatedAt], ['恢复后的新标题', T(3)], '新帧必须重新投影，而不是沿用缓存')
})
