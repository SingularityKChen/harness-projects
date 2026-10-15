import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
