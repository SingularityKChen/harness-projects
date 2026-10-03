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
import { CLOSED_MESSAGE, SqliteStorage, createSqliteStorage, migrate, openDatabase } from '@harness-projects/storage-sqlite'

import { seedExecutionPrereqs } from '../contract/suites/storage-execution.js'
import { WORKSPACE } from '../contract/suites/storage-fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'storage-work-item-rejection-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
const open = () => createSqliteStorage(join(dir, `w-${files++}.sqlite`))

const context = (overrides = {}) => ({ id: 'context-1', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'ready',
  branchExternalId: undefined, worktreeExternalId: undefined, provisioningStartedAt: undefined, ...overrides })
const UNREGISTERED = { workItemId: 'work-item-unregistered' }

/**
 * 计数包装：包的是**真实**的 `WorkspaceDatabase`（不是产品里的故障开关）。`counts` 记录 `BEGIN` 与会写的语句（INSERT / UPDATE / DELETE 的执行次数）；
 * 播种完成后调 `reset()`，fixture 自己的写入因此不会被算成失败方法的副作用。
 */
function countingStorage() {
  const location = join(dir, `w-${files++}.sqlite`)
  const real = openDatabase(location); migrate(real)
  const counts = { begin: 0, dml: 0 }
  const mutating = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i
  const db = {
    close: () => real.close(),
    exec: (sql) => { if (/^\s*BEGIN\b/i.test(sql)) counts.begin += 1; return real.exec(sql) },
    prepare: (sql) => {
      const statement = real.prepare(sql)
      if (!mutating.test(sql)) return statement
      return new Proxy(statement, { get(target, key) {
        const value = Reflect.get(target, key, target)
        if (key !== 'run' && key !== 'get' && key !== 'all') return typeof value === 'function' ? value.bind(target) : value
        return (...args) => { counts.dml += 1; return value.apply(target, args) }
      } })
    },
  }
  return { storage: new SqliteStorage(location, db), location, counts, reset: () => { counts.begin = 0; counts.dml = 0 } }
}
const staged = { id: 'ws-staged', name: '暂存工作区', statusPolicy: 'provider_authoritative' }

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

test('SQLite：根调用的未登记工作项在自己的 BEGIN 之前被拒绝，零事务零写入；合法正控开事务并写入', async () => {
  const { storage, counts, reset } = countingStorage()
  await seedExecutionPrereqs(storage)
  reset()
  await assert.rejects(storage.putExecutionContext(context(UNREGISTERED)), StorageInputError)
  assert.deepEqual({ ...counts }, { begin: 0, dml: 0 }, '预检失败：没有 BEGIN，也没有任何会写的语句')
  await storage.putExecutionContext(context())
  assert.equal(counts.begin, 1, '正控：父行存在时同一入口照常开一个事务（计数器不是恒零）')
  assert.ok(counts.dml >= 1)
  storage.close()
})

test('SQLite：事务内未 catch 的拒绝整笔回滚——外层只有一个 BEGIN，失败方法无写，暂存行与上下文重开后都不存在', async () => {
  const { storage, location, counts, reset } = countingStorage()
  await seedExecutionPrereqs(storage)
  reset()
  let dmlBefore
  await assert.rejects(storage.transaction(async (tx) => {
    await tx.putWorkspace(staged)
    dmlBefore = counts.dml
    await tx.putExecutionContext(context(UNREGISTERED))
  }), StorageInputError)
  assert.equal(counts.begin, 1, '只有外层事务的那一个 BEGIN，putExecutionContext 没有嵌套 BEGIN')
  assert.equal(counts.dml, dmlBefore, '失败方法本身零写入')
  storage.close()
  const revived = createSqliteStorage(location)
  try {
    assert.equal(await revived.getWorkspace('ws-staged'), undefined, '先于拒绝暂存的写入随整笔事务回滚')
    assert.equal(await revived.getExecutionContext('context-1'), undefined)
  } finally { revived.close() }
})

test('SQLite：事务内 catch 住拒绝时失败方法零写入，随后的合法写入按现有语义随事务提交', async () => {
  const { storage, location, counts, reset } = countingStorage()
  await seedExecutionPrereqs(storage)
  reset()
  await storage.transaction(async (tx) => {
    await tx.putWorkspace(staged)
    const dmlBefore = counts.dml
    await assert.rejects(tx.putExecutionContext(context(UNREGISTERED)), StorageInputError)
    assert.equal(counts.dml, dmlBefore, '被 catch 的拒绝：失败方法零写入')
    await tx.putExecutionContext(context({ id: 'context-ok' }))
  })
  assert.equal(counts.begin, 1)
  storage.close()
  const revived = createSqliteStorage(location)
  try {
    assert.equal((await revived.getWorkspace('ws-staged'))?.name, '暂存工作区', '通用事务语义不变：catch 之后事务未被标毒，暂存写入随提交生效')
    assert.equal((await revived.getExecutionContext('context-ok'))?.status, 'ready')
    assert.equal(await revived.getExecutionContext('context-1'), undefined, '被拒绝的上下文没有行')
  } finally { revived.close() }
})
