/**
 * 工作区同步游标作用域（#189，ExecPlan `2026-10-03-workspace-sync-scope`）。同一条连接挂在两个工作区时，
 * 一个工作区的同步结算不得覆盖另一个工作区的健康度。全部走真实的 `composeCore` + `bootstrapWorkspace` + controller 查询，
 * 在内存替身与 `:memory:` SQLite 上同形运行；用例名说明它保护哪条不变量，不重复共享契约套件已证明的键语义。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { providerErr, providerError } from '@harness-projects/capabilities'
import { ProviderErrorCode } from '@harness-projects/domain'
import { PLANNING_SYNC_SCOPE, composeCore } from '@harness-projects/core'
import { createController } from '@harness-projects/controller'
import { createFakeProviders, createFakeStorage } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const STORAGES = [['内存 Storage 替身', () => createFakeStorage()], ['SQLite Storage', () => createSqliteStorage(':memory:')]]
const ORDERS = [['ws-a', 'ws-b'], ['ws-b', 'ws-a']]

/** 通过 Proxy 给共享 planning provider 套一层「按工作区」的故障与闸门：只有被点名的工作区在 getProject 上失败或等待，其余原样透传。 */
async function mount(providers, storage, id) {
  const knob = { down: false, gate: undefined }
  const planning = new Proxy(providers.planning, {
    get(target, key) {
      if (key === 'getProject') {
        return async (...args) => {
          await knob.gate
          return knob.down ? providerErr(providerError(ProviderErrorCode.Unavailable, `${id} 离线`)) : target.getProject(...args)
        }
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const core = await composeCore({ workspace: { id, name: id }, providers: { ...providers, planning }, storage })
  return { id, knob, core, controller: createController(core, { workspaceRevision: () => storage.currentRevision(id) }) }
}

const cursorOf = (storage, providers, id) => storage.getSyncCursor(id, providers.planning.bindingId, PLANNING_SYNC_SCOPE)
/** 行的身份与规划状态：同步失败与另一个工作区的结算都不得改写它们，只有 freshness 随本工作区的游标变化。 */
const facts = (views) => views.map((row) => [row.entityId, row.planningStatus])

for (const [label, makeStorage] of STORAGES) {
  for (const [failing, healthy] of ORDERS) {
    test(`工作区健康：另一个工作区成功不恢复当前失败（${label}，${failing} 失败、${healthy} 成功）`, async () => {
      const storage = makeStorage(); const providers = createFakeProviders()
      const f = await mount(providers, storage, failing); const h = await mount(providers, storage, healthy)
      const rows = await f.core.queries.listPlanningItems()
      assert.ok(rows.length > 0 && rows.every((row) => !row.freshness.degraded), '前置：先正常水合，保留可降级的行')
      const revision = await storage.currentRevision(failing)

      f.knob.down = true
      const failed = await f.core.commands.bootstrapWorkspace()
      assert.equal(failed.ok, false)
      assert.equal(await storage.currentRevision(failing), revision, '失败结算不推进业务修订号')
      const stale = { degraded: true, stale: true, reason: 'unavailable' }
      assert.deepEqual(await f.core.queries.getPlanningSync(), stale)

      const ok = await h.core.commands.bootstrapWorkspace()
      assert.equal(ok.ok, true, '另一个工作区同步成功')
      assert.deepEqual(await f.core.queries.getPlanningSync(), stale, '另一个工作区成功不得恢复当前工作区，reason 逐字保持')
      assert.equal(await storage.currentRevision(failing), revision)
      const after = await f.core.queries.listPlanningItems()
      assert.deepEqual(facts(after), facts(rows), '失败保留最后已知行，规划状态不变')
      assert.ok(after.every((row) => row.freshness.degraded && row.freshness.reason === 'unavailable'), '每条行都 degraded 且带原因')
      assert.deepEqual(facts(await h.core.queries.listPlanningItems()), facts(rows), '跨工作区实体身份仍是一份，只有同步摘要各自独立')
      assert.equal((await f.core.queries.getItemDetail(after[0].entityId)).freshness.degraded, true)
      const snapshot = await f.controller.baseline()
      assert.deepEqual([snapshot.source.freshness, snapshot.source.reason], ['degraded', 'unavailable'], '整表来源与逐行 freshness 一致')
      assert.ok(snapshot.entities.every((entity) => entity.source.freshness === 'degraded'))
      assert.equal((await h.controller.baseline()).source.freshness, 'fresh', '成功的工作区自己保持 fresh')

      const healthyCursor = await cursorOf(storage, providers, healthy)
      f.knob.down = false
      assert.equal((await f.core.commands.bootstrapWorkspace()).ok, true)
      assert.deepEqual(await f.core.queries.getPlanningSync(), { degraded: false, stale: false, reason: undefined }, '只有自己成功才恢复自己')
      assert.deepEqual(await cursorOf(storage, providers, healthy), healthyCursor, '恢复 A 不改变 B 的完整游标')
    })

    for (const delayed of ['failing', 'healthy']) {
      test(`工作区健康：并发结算后两个工作区各留一条游标（${label}，${failing} 失败、${healthy} 成功，后结算方：${delayed}）`, async () => {
        const storage = makeStorage(); const providers = createFakeProviders()
        const f = await mount(providers, storage, failing); const h = await mount(providers, storage, healthy)
        const [late, early] = delayed === 'failing' ? [f, h] : [h, f]
        f.knob.down = true
        let release; late.knob.gate = new Promise((resolve) => { release = resolve })
        const pending = new Map([[f, f.core.commands.bootstrapWorkspace()], [h, h.core.commands.bootstrapWorkspace()]])
        await pending.get(early)
        release()
        const [failed, ok] = await Promise.all(pending.values())
        assert.deepEqual([failed.ok, ok.ok], [false, true])
        assert.deepEqual([(await f.core.queries.getPlanningSync()).degraded, (await h.core.queries.getPlanningSync()).degraded], [true, false], '后结算的一方不得覆盖先结算的一方')
        assert.equal((await cursorOf(storage, providers, failing))?.state, 'degraded')
        assert.equal((await cursorOf(storage, providers, healthy))?.state, 'healthy', '两条游标都必须存在')
      })
    }
  }
}
