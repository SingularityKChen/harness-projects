import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { newWorkspaceId } from '@harness-projects/domain'
import { composeCore, PLANNING_SYNC_SCOPE } from '@harness-projects/core'
import { FakeFixtureName, FaultKind, createFakePlanningProvider, createFakeProviders, createFakeStorage, exportFakeStorageState, fixtureProjectRef } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const CLOCK = '2026-11-20T00:00:00Z'
const ids = (views) => views.map((view) => view.content.identity.externalId).sort()
for (const [name, open] of [['Fake', createFakeStorage], ['SQLite', () => createSqliteStorage(':memory:')]]) {
  test(`${name}: switch serves only the enabled planning mount (#202)`, async (t) => {
    const storage = open(), id = newWorkspaceId(), providers = createFakeProviders(), clock = () => CLOCK
    t.after(() => storage.close?.())
    const old = await composeCore({ workspace: { id, name: 'switch' }, providers: { ...providers, storage }, clock })
    const before = await old.queries.listPlanningItems(), oldBindingId = providers.planning.bindingId
    assert.ok(before.length > 0, '前置：旧来源有已提交投影')
    assert.ok(before.every((view) => view.content.identity.bindingId === oldBindingId), '前置：旧投影来自旧挂载')
    const mount = (await storage.listProviderBindings(id)).find((row) => row.id === oldBindingId)
    await storage.putProviderBinding({ ...mount, enabled: false, isDefault: false })
    const planning = createFakePlanningProvider({ fixture: FakeFixtureName.DraftBacked })
    const core = await composeCore({ workspace: { id, name: 'switch' }, providers: { ...providers, planning, storage }, clock })
    const mounts = (await storage.listProviderBindings(id)).filter((row) => row.domain === 'planning')
    assert.deepEqual(mounts.filter((row) => row.enabled).map((row) => row.id), [planning.bindingId], '前置：恰好一个启用规划挂载')
    assert.deepEqual(mounts.filter((row) => !row.enabled).map((row) => row.id), [oldBindingId], '前置：旧挂载已停用')
    const after = await core.queries.listPlanningItems()
    assert.deepEqual(ids(after), ['draft-1', 'draft-2', 'issue-9'], '列表只返回启用挂载的条目')
    for (const view of after) assert.ok((await storage.listIdentitiesForEntity(view.entityId)).some((row) => row.bindingId === planning.bindingId), '每条都来自启用挂载')
    assert.deepEqual(after.filter((view) => before.some((row) => row.entityId === view.entityId)), [], '旧来源实体一条都不出现')
    assert.deepEqual((await core.queries.getPlanningSnapshot()).views.map((view) => view.entityId), after.map((view) => view.entityId), '快照与列表同源')
    assert.equal(await core.queries.getItemDetail(before[0].entityId), undefined, '旧来源条目详情不可读')
    assert.notEqual(await core.queries.getItemDetail(after[0].entityId), undefined, '启用来源条目详情仍可读')
    assert.equal((await core.queries.getWorkspaceMetadata()).planningSource.bindingId, planning.bindingId, '元数据指向启用挂载')
  })
}

const NATIVE_PR = { namespace: 'github.com/graphql/PullRequest', id: 'shared-planning-pr-7' }
const A_FIELDS = { title: 'A planning title', body: 'A planning body', status: 'todo', targetDate: '2026-11-24' }
const B_FIELDS = { title: 'B planning title', body: 'B planning body', status: 'done', targetDate: '2026-11-28' }
const FIELD_MAPPING = { status: { projectFieldId: 'status', options: { todo: 'todo', done: 'done' } }, targetDateFieldId: 'due' }
const payload = (view) => view === undefined ? undefined : {
  title: view.content.title, body: view.content.body, status: view.planningStatus, targetDate: view.planningFields?.targetDate,
}

function planningSource(fields) {
  const provider = createFakePlanningProvider()
  // 种子的 content 被多个实例复用；替换本实例记录和嵌套值，不修改共享种子。
  provider.state.items = provider.state.items.filter((item) => item.ref.objectKind === 'change_request').map((item) => ({
    ...item, content: { ...item.content, changeRequest: { ...item.content.changeRequest, title: fields.title, body: fields.body } },
    fields: { ...item.fields, statusKey: fields.status, nativeValues: {
      status: { kind: 'single_select', optionId: fields.status }, due: { kind: 'date', date: fields.targetDate },
    } },
  }))
  const calls = { count: 0 }
  const port = new Proxy(provider, { get(target, key) {
    const value = Reflect.get(target, key, target)
    if (typeof value !== 'function') return value
    if (key !== 'listPlanningItems') return (...args) => { calls.count++; return value.apply(target, args) }
    return async (...args) => {
      calls.count++
      const result = await value.apply(target, args)
      return !result.ok ? result : {
        ...result, value: { ...result.value, items: result.value.items.map((item) => ({ ...item, nativeIdentity: NATIVE_PR })) },
      }
    }
  } })
  return { provider, port, calls }
}

async function sharedSourceWorld(name, t, clock = () => CLOCK) {
  const directory = name === 'SQLite' ? await mkdtemp(join(tmpdir(), 'planning-source-switch-')) : undefined
  const filename = directory === undefined ? undefined : join(directory, 'workspace.sqlite')
  let storage = name === 'Fake' ? createFakeStorage() : createSqliteStorage(filename)
  t.after(async () => { storage.close?.(); if (directory !== undefined) await rm(directory, { recursive: true, force: true }) })
  const id = newWorkspaceId(), providers = createFakeProviders()
  return {
    id,
    get storage() { return storage },
    async compose(source) {
      for (const mount of await storage.listProviderBindings(id)) {
        if (mount.domain === 'planning' && mount.enabled && mount.id !== source.provider.bindingId) {
          await storage.putProviderBinding({ ...mount, enabled: false, isDefault: false })
        }
      }
      const core = await composeCore({ workspace: { id, name: 'shared source', project: fixtureProjectRef(source.provider.bindingId), planningFieldMapping: FIELD_MAPPING },
        providers: { ...providers, planning: source.port, storage }, clock })
      assert.deepEqual((await storage.listProviderBindings(id)).filter((row) => row.domain === 'planning' && row.enabled).map((row) => row.id),
        [source.provider.bindingId], '前置：唯一启用来源对应当前 provider 和有效项目')
      return core
    },
    reopen() {
      if (name === 'Fake') storage = createFakeStorage(exportFakeStorageState(storage))
      else { storage.close(); storage = createSqliteStorage(filename) }
    },
  }
}

async function readSharedSource(w, core, source, entityId) {
  const before = [await w.storage.currentRevision(w.id), w.storage.committedReadFence(), source.calls.count]
  const list = await core.queries.listPlanningItems(), snapshot = await core.queries.getPlanningSnapshot(), detail = await core.queries.getItemDetail(entityId)
  assert.deepEqual([await w.storage.currentRevision(w.id), w.storage.committedReadFence(), source.calls.count], before,
    '三种查询均不调用 provider、不写 Storage 或推进业务 revision')
  return { list, snapshot: snapshot.views, detail }
}

for (const name of ['Fake', 'SQLite']) {
  for (const outcome of ['success', 'permission-denied']) test(`${name}: disabled source's in-flight refresh (${outcome}) cannot replace the current shared PR (#202)`, async (t) => {
    let now = '2026-11-20T00:00:01Z'
    const w = await sharedSourceWorld(name, t, () => now), a = planningSource(A_FIELDS), b = planningSource(B_FIELDS)
    const oldCore = await w.compose(a), entityId = (await oldCore.queries.listPlanningItems())[0].entityId
    const committedA = (await w.storage.getPlanningSyncRound(w.id, a.provider.bindingId, PLANNING_SYNC_SCOPE)).latestCommittedRound
    let listRead, release
    const entered = new Promise((resolve) => { listRead = resolve }), gate = new Promise((resolve) => { release = resolve })
    const list = a.provider.listPlanningItems.bind(a.provider)
    a.provider.listPlanningItems = async (...args) => {
      const result = await list(...args)
      listRead()
      await gate
      if (outcome === 'permission-denied') { a.provider.setFault(FaultKind.PermissionDenied, true); return list(...args) }
      return result
    }
    now = '2026-11-20T00:00:02Z'
    const pending = oldCore.commands.refreshPlanning()
    try {
      await entered
      now = '2026-11-20T00:00:03Z'
      const current = await w.compose(b)
      const saved = await w.storage.getPlanningProjection(w.id, entityId), revision = await w.storage.currentRevision(w.id)
      const reconciled = await w.storage.getReconcileCursor(w.id), sync = await current.queries.getPlanningSync()
      const cursorA = await w.storage.getSyncCursor(w.id, a.provider.bindingId, PLANNING_SYNC_SCOPE)
      assert.equal(saved.sourceBindingId, b.provider.bindingId, '前置：B 已提交共享实体的当前 payload')
      assert.deepEqual([revision, sync.degraded, sync.stale], [2, false, false], '前置：B 第二次业务修订已确认且同步健康')
      now = '2026-11-20T00:00:04Z'
      release()
      const result = await pending, read = await readSharedSource(w, current, b, entityId)
      assert.deepEqual({
        result: { ok: result.ok, ...(outcome === 'success' ? { code: result.error?.code } : {}) },
        projection: await w.storage.getPlanningProjection(w.id, entityId), revision: await w.storage.currentRevision(w.id),
        reconciled: await w.storage.getReconcileCursor(w.id),
        committedA: (await w.storage.getPlanningSyncRound(w.id, a.provider.bindingId, PLANNING_SYNC_SCOPE)).latestCommittedRound,
        cursorA: await w.storage.getSyncCursor(w.id, a.provider.bindingId, PLANNING_SYNC_SCOPE),
        views: { list: read.list.map(payload), snapshot: read.snapshot.map(payload), detail: payload(read.detail) },
        sync: await current.queries.getPlanningSync(),
      }, {
        result: { ok: false, ...(outcome === 'success' ? { code: 'stale_revision' } : {}) }, projection: saved, revision, reconciled, committedA, cursorA,
        views: { list: [B_FIELDS], snapshot: [B_FIELDS], detail: B_FIELDS }, sync,
      }, '停用来源的晚到轮次必须失效，不能覆盖 B、推进修订或确认 A 轮次')
    } finally {
      release()
      await pending.catch(() => {})
    }
  })

  test(`${name}: shared native PR rejects disabled payload through offline switch, restart and recovery (#202)`, async (t) => {
    const w = await sharedSourceWorld(name, t), a = planningSource(A_FIELDS), b = planningSource(B_FIELDS)
    assert.notEqual(a.provider.bindingId, b.provider.bindingId)
    let core = await w.compose(a)
    const first = await core.queries.listPlanningItems(), entityId = first[0].entityId
    assert.deepEqual(first.map(payload), [A_FIELDS], '前置：A 实际提交 title、body 与 todo')
    a.provider.setFault(FaultKind.Offline, true)
    assert.equal((await core.commands.refreshPlanning()).ok, false)
    const sameSource = await readSharedSource(w, core, a, entityId)
    assert.deepEqual([sameSource.list.map(payload), sameSource.snapshot.map(payload), payload(sameSource.detail)],
      [[A_FIELDS], [A_FIELDS], A_FIELDS], '同源离线保留最后已确认的 A 内容和状态')

    core = await w.compose(b)
    const fromB = await core.queries.listPlanningItems()
    assert.deepEqual(fromB.map((view) => view.entityId), [entityId], 'A/B 原生 PR 收敛为同一实体')
    assert.deepEqual(fromB.map(payload), [B_FIELDS], '前置：B 实际覆盖 title、body 与 done')
    assert.deepEqual((await w.storage.listIdentitiesForEntity(entityId)).map((row) => [row.bindingId, row.role]).sort(),
      [[a.provider.bindingId, 'primary'], [b.provider.bindingId, 'alias']].sort(), '前置：A primary 与 B alias 并存')
    core = await w.compose(a)
    assert.equal((await core.queries.getPlanningSync()).stale, true, '切回 A 的首轮同步失败')
    for (const phase of ['before restart', 'after restart']) {
      if (phase === 'after restart') { w.reopen(); core = await w.compose(a) }
      await t.test(phase, async () => {
        const read = await readSharedSource(w, core, a, entityId)
        assert.deepEqual({ list: read.list.map(payload), snapshot: read.snapshot.map(payload), detail: payload(read.detail) },
          { list: [], snapshot: [], detail: undefined }, '当前 A 未确认，三 API 必须隐藏已停用 B 的 title/body/done')
      })
    }
    a.provider.setFault(FaultKind.Offline, false)
    assert.equal((await core.commands.refreshPlanning()).ok, true)
    const restored = await readSharedSource(w, core, a, entityId)
    assert.deepEqual(restored.list.map((view) => view.entityId), [entityId], '恢复后仍是同一个实体')
    assert.deepEqual([restored.list.map(payload), restored.snapshot.map(payload), payload(restored.detail)],
      [[A_FIELDS], [A_FIELDS], A_FIELDS], 'A 恢复后替换 B 内容并恢复 todo')
    const revision = await w.storage.currentRevision(w.id)
    assert.equal((await core.commands.refreshPlanning()).ok, true)
    assert.equal(await w.storage.currentRevision(w.id), revision, '相同来源与 payload 重复刷新不推进修订')
  })

  test(`${name}: permission-denied source cannot redact or relabel another source's shared PR (#202)`, async (t) => {
    const w = await sharedSourceWorld(name, t), a = planningSource(A_FIELDS), b = planningSource(B_FIELDS)
    let core = await w.compose(a)
    const entityId = (await core.queries.listPlanningItems())[0].entityId
    core = await w.compose(b)
    assert.deepEqual((await core.queries.listPlanningItems()).map(payload), [B_FIELDS], '前置：B 已确认内容、状态与展示字段')
    const saved = await w.storage.getPlanningProjection(w.id, entityId), identities = await w.storage.listIdentitiesForEntity(entityId)
    assert.equal(saved.sourceBindingId, b.provider.bindingId, '前置：持久 payload 来源确为 B')
    // 保持已声明的 read capability，让下一轮实际 provider 拒读命中权限失败路径。
    a.provider.setFault(FaultKind.Offline, true)
    core = await w.compose(a)
    a.provider.setFault(FaultKind.Offline, false)
    a.provider.setFault(FaultKind.PermissionDenied, true)
    const result = await core.commands.refreshPlanning()
    assert.deepEqual([result.ok, result.degraded, result.error?.code, result.revision], [false, true, 'permission_denied', saved.revision],
      'A 权限失败返回结构化结果，不抛异常或推进内容修订')
    assert.deepEqual(await w.storage.getPlanningProjection(w.id, entityId), saved,
      'A 权限失败不得脱敏、改写字段或重标 B 的来源，整行保持不变')
    const hidden = await readSharedSource(w, core, a, entityId)
    assert.deepEqual({ list: hidden.list.map(payload), snapshot: hidden.snapshot.map(payload), detail: payload(hidden.detail) },
      { list: [], snapshot: [], detail: undefined }, 'A 拒读时三 API 隐藏属于 B 的 payload')
    a.provider.setFault(FaultKind.PermissionDenied, false)
    assert.equal((await core.commands.refreshPlanning()).ok, true)
    const restored = await readSharedSource(w, core, a, entityId)
    assert.deepEqual(restored.list.map((view) => view.entityId), [entityId], '恢复确认仍指向原实体')
    assert.deepEqual([restored.list.map(payload), restored.snapshot.map(payload), payload(restored.detail)],
      [[A_FIELDS], [A_FIELDS], A_FIELDS], '授权恢复后确认 A 的内容、状态与展示字段')
    assert.equal((await w.storage.getPlanningProjection(w.id, entityId)).sourceBindingId, a.provider.bindingId)
    assert.deepEqual(await w.storage.listIdentitiesForEntity(entityId), identities, '权限失败与恢复均保持原 primary/alias 身份')
  })

  test(`${name}: source change with equal native PR payload advances revision exactly once (#202)`, async (t) => {
    const w = await sharedSourceWorld(name, t), a = planningSource(A_FIELDS), b = planningSource(A_FIELDS)
    const first = await w.compose(a), entityId = (await first.queries.listPlanningItems())[0].entityId
    const before = await w.storage.currentRevision(w.id)
    const next = await w.compose(b)
    const read = await readSharedSource(w, next, b, entityId)
    assert.deepEqual(read.list.map((view) => [view.entityId, payload(view)]), [[entityId, A_FIELDS]], '同 payload 切源保持实体与字段')
    assert.equal(await w.storage.currentRevision(w.id), before + 1, '来源变化影响业务可见性，修订推进一次')
    assert.equal((await next.commands.refreshPlanning()).ok, true)
    assert.equal(await w.storage.currentRevision(w.id), before + 1, '同源相同 payload 重复刷新不再推进')
  })
}
