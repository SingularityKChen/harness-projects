/**
 * 未登记工作项的 Storage 拒绝（#196）在 SQLite 文件库上的集成用例。共享拒绝矩阵（两个实现 × ready / failed / closed × 根 / 事务）在契约套件
 * `tests/contract/suites/storage-execution.js`；本文件钉住契约套件管不到的三类事实：类型化拒绝**没有吞掉**别的失败（总 catch 变异的判别点）、
 * 拒绝之后同一实例的队列仍可用、零 BEGIN 与整笔回滚（SQLite 专属，经计数包装观察）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { StorageInputError } from '@harness-projects/capabilities'
import { CLOSED_MESSAGE, createSqliteStorage } from '@harness-projects/storage-sqlite'

import { seedExecutionPrereqs } from '../contract/suites/storage-execution.js'
import { WORKSPACE } from '../contract/suites/storage-fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'storage-work-item-rejection-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
const open = () => createSqliteStorage(join(dir, `w-${files++}.sqlite`))

const context = (overrides = {}) => ({ id: 'context-1', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'ready',
  branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined, ...overrides })
const UNREGISTERED = { workItemId: 'work-item-unregistered' }

test('SQLite：其他失败保持原身份，类型化拒绝只认工作项父边', async () => {
  const storage = open()
  await seedExecutionPrereqs(storage)
  // 工作项合法、仓库悬空：驱动的外键失败原样抛出，不被改写成 StorageInputError / invalid_input。
  await assert.rejects(storage.putExecutionContext(context({ repositoryId: 'repo-none' })), (error) => !(error instanceof StorageInputError) && /FOREIGN KEY/.test(error.message))
  // 关闭后：未登记工作项也以关闭文案失败（预检在槽内、关闭检查之后，不抢先报输入错误）。
  storage.close()
  await assert.rejects(storage.putExecutionContext(context(UNREGISTERED)), { message: CLOSED_MESSAGE })
})

test('SQLite：拒绝之后同一实例的队列仍可用，合法写入照常提交', async () => {
  const storage = open()
  await seedExecutionPrereqs(storage)
  const rejected = storage.putExecutionContext(context(UNREGISTERED))
  const accepted = storage.putExecutionContext(context({ id: 'context-ok' }))
  await assert.rejects(rejected, StorageInputError)
  await accepted
  assert.equal((await storage.getExecutionContext('context-ok'))?.status, 'ready')
  assert.equal(await storage.getExecutionContext('context-1'), undefined)
  storage.close()
})
