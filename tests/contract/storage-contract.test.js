/**
 * 内存 Storage 替身的契约套件装配，外加一条判别性用例。
 *
 * `restart` 用导出/导入内部状态模拟重启——删掉导出实现后，套件里"换一个实例读同一份内容"必然失败。
 * 额外用例保护事务隔离：未提交的写入在事务外读不到，否则回滚就只是假象。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { storageContractSuite } from './suites/storage.js'

storageContractSuite({
  label: '内存 Storage 替身',
  makeStorage: () => createFakeStorage(),
  restart: (storage) => createFakeStorage(exportFakeStorageState(storage)),
})

test('内存 Storage 替身：事务未提交前外部读不到写入，提交后才可见', async () => {
  const storage = createFakeStorage()
  let seenInside
  await storage.transaction(async (tx) => {
    await tx.putWorkspace({ id: 'ws-1', name: '工作区', statusPolicy: 'provider_authoritative' })
    seenInside = await storage.getWorkspace('ws-1')
  })
  assert.equal(seenInside, undefined, '未提交的写入不得被事务外读到')
  assert.equal((await storage.getWorkspace('ws-1'))?.name, '工作区')
})

const DUPLICATE_OBSERVATION = { state: 'pending', observation: { bindingId: 'binding-1', dedupeKey: 'dedupe-1', type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z', subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined }, sourceVersion: 'v1', payloadHash: 'payload-hash', payload: {} } } // 与 suites/storage.js 同形状；同一 (binding, dedupeKey) 的第二次投递必须整笔 no-op

test('内存 Storage 替身：同一观察记录两次后身份/实体/成员计数与只记录一次完全相同', async () => {
  const ingest = async (storage, identityId) => storage.transaction(async (tx) => {
    if (!(await tx.recordObservation(DUPLICATE_OBSERVATION))) return false
    await tx.putEntity({ id: 'entity-1', kind: 'work_item' })
    await tx.putExternalIdentity({ id: identityId, entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
    return true
  })
  const once = createFakeStorage(); const twice = createFakeStorage()
  assert.equal(await ingest(once, 'identity-1'), true); assert.equal(await ingest(twice, 'identity-1'), true)
  assert.equal(await ingest(twice, 'identity-2'), false, '重复投递必须被去重，调用方据此不再登记第二个身份')
  const counts = async (storage, state) => [state.observations.length, state.entities.length, state.identities.length, (await storage.listIdentitiesForEntity('entity-1')).length]
  assert.deepEqual(await counts(twice, exportFakeStorageState(twice)), await counts(once, exportFakeStorageState(once)), '观察/实体/身份/成员计数必须与只记录一次完全相同')
})
