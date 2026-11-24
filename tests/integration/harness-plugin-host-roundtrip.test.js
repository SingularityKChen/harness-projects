import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import { newWorkspaceId } from '@harness-projects/domain'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'

test('host composition rejects malformed input before the Controller and disposes once', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-'))
  try {
    const host = await createHostComposition({
      dataPath: path.join(root, 'workspace.sqlite'),
      workspaceId: newWorkspaceId(),
      catalog: new Map(),
      resolveCredential: async () => undefined,
    })
    await assert.rejects(() => host.call('baseline', { extra: true }), /未知字段/)
    const polluted = Object.create({ injected: true })
    await assert.rejects(() => host.call('baseline', polluted), /普通对象/)
    await assert.rejects(() => host.call('bootstrapWorkspace', { actorRef: { kind: '' }, idempotencyKey: 'bad-actor' }), /actorRef.kind/)
    await assert.rejects(() => host.call('bootstrapWorkspace', { actorRef: { kind: 'agent', id: 7 }, idempotencyKey: 'bad-id' }), /actorRef.id/)
    await assert.rejects(() => host.call('bootstrapWorkspace', { actorRef: { kind: 'agent' }, idempotencyKey: '' }), /idempotencyKey/)
    host.dispose()
    host.dispose()
    await assert.rejects(() => host.call('baseline', {}), /已关闭/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('host composition injects its SQLite storage only through the provider table', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-storage-'))
  const workspaceId = newWorkspaceId()
  const dataPath = path.join(root, 'workspace.sqlite')
  let host
  try {
    host = await createHostComposition({ dataPath, workspaceId, catalog: new Map(), resolveCredential: async () => undefined })
    // 空数据根：Core 拿不到 storage，读侧只有尚未创建。
    assert.equal((await host.call('getWorkspaceSetup', {})).workspace, null)
    assert.equal((await host.call('createWorkspace', { actorRef: { kind: 'user' }, idempotencyKey: 'create', name: 'Storage assembly' })).writeState, 'local_only')
    const setup = await host.call('getWorkspaceSetup', {})
    const baseline = await host.call('baseline', {})
    const db = new DatabaseSync(dataPath, { readOnly: true })
    let rows
    try { rows = db.prepare('SELECT id FROM workspace').all() } finally { db.close() }
    // 真实 Host 只经 provider 表注入：三处（setup 读、core baseline、直接读库）必须是同一个工作区 id。
    assert.equal(setup.workspace.id, workspaceId)
    assert.equal(baseline.workspace.id, workspaceId)
    assert.deepEqual(rows.map((row) => row.id), [workspaceId])
  } finally {
    await host?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
