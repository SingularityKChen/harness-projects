import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { bootstrapWorkspace, createContext, createQueries } from '@harness-projects/core'
import { ContentKind, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { createFakeProviders, createFakeStorage, exportFakeStorageState, fixtureProjectRef } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const STORAGES = [['Fake Storage', () => createFakeStorage()], ['SQLite', () => createSqliteStorage(':memory:')]]

function deferred() {
  let resolve
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

for (const [label, makeStorage] of STORAGES) {
  test(`共享 Planning provider：两个 workspace 的并发 round 顺序彼此隔离（#305，${label}）`, async () => {
    const providers = createFakeProviders()
    const storage = makeStorage()
    const firstWorkspace = { id: newWorkspaceId(), name: `planning-round-shared-a/${label}`, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
    const secondWorkspace = { id: newWorkspaceId(), name: `planning-round-shared-b/${label}`, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
    const first = await createContext({ workspace: firstWorkspace, providers, storage })
    const second = await createContext({ workspace: secondWorkspace, providers, storage })
    assert.ok(first && second, `${label}：两个 workspace 必须共享同一 provider 但各自创建 context`)

    const item = providers.planning.state.items.find((candidate) => candidate.content.kind === ContentKind.WorkItem)
    assert.ok(item, `${label}：fixture 必须有 work item`)
    const original = providers.planning.listPlanningItems.bind(providers.planning)
    const gates = [deferred(), deferred()]
    let calls = 0
    providers.planning.listPlanningItems = async (input) => {
      const snapshot = await original(input)
      const gate = gates[calls++]
      assert.ok(gate, `${label}：只允许两个 workspace 各读取一次`)
      await gate.promise
      return snapshot
    }

    const oldRound = bootstrapWorkspace(first)
    while (calls < 1) await Promise.resolve()
    item.content = { ...item.content, workItem: { ...item.content.workItem, title: `new-${label}` } }
    const newRound = bootstrapWorkspace(second)
    while (calls < 2) await Promise.resolve()

    gates[1].resolve()
    const newer = await newRound
    assert.equal(newer.ok, true, `${label}：第二个 workspace 的新 snapshot 必须提交`)
    gates[0].resolve()
    const older = await oldRound
    assert.equal(older.ok, true, `${label}：第一个 workspace 的旧 snapshot 不得被共享 binding 的新 round 取代`)

    const firstRows = await createQueries(first).listPlanningItems()
    const secondRows = await createQueries(second).listPlanningItems()
    assert.ok(firstRows.some((row) => row.content.title !== `new-${label}`), `${label}：workspace A 应保留自己的旧 snapshot`)
    assert.ok(secondRows.some((row) => row.content.title === `new-${label}`), `${label}：workspace B 应提交自己的新 snapshot`)
    assert.deepEqual(await storage.getPlanningSyncRound(firstWorkspace.id, providers.planning.bindingId, 'planning.project'), {
      workspaceId: firstWorkspace.id, bindingId: providers.planning.bindingId, scopeKey: 'planning.project', latestStartedRound: 1, latestCommittedRound: 1,
    })
    assert.deepEqual(await storage.getPlanningSyncRound(secondWorkspace.id, providers.planning.bindingId, 'planning.project'), {
      workspaceId: secondWorkspace.id, bindingId: providers.planning.bindingId, scopeKey: 'planning.project', latestStartedRound: 1, latestCommittedRound: 1,
    })
    assert.equal(await storage.currentRevision(firstWorkspace.id), 1, `${label}：workspace A revision 独立`)
    assert.equal(await storage.currentRevision(secondWorkspace.id), 1, `${label}：workspace B revision 独立`)
    assert.ok(await storage.getReconcileCursor(firstWorkspace.id), `${label}：workspace A reconcile cursor 独立`)
    assert.ok(await storage.getReconcileCursor(secondWorkspace.id), `${label}：workspace B reconcile cursor 独立`)
    storage.close?.()
  })

  test(`Planning round：状态可重启读回且值域拒绝非法提交（#305，${label}）`, async () => {
    const providers = createFakeProviders()
    const workspace = { id: newWorkspaceId(), name: `planning-round-restart/${label}`, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
    const directory = mkdtempSync(join(tmpdir(), 'harness-planning-round-'))
    const location = label === 'SQLite' ? join(directory, 'round.sqlite') : undefined
    const storage = location === undefined ? makeStorage() : createSqliteStorage(location)
    const context = await createContext({ workspace, providers, storage })
    assert.ok(context)
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    const round = await storage.getPlanningSyncRound(workspace.id, providers.planning.bindingId, 'planning.project')
    assert.ok(round && round.latestStartedRound >= 2)
    await assert.rejects(storage.transaction((tx) => tx.putPlanningSyncRound({
      workspaceId: workspace.id, bindingId: providers.planning.bindingId, scopeKey: 'planning.project',
      latestStartedRound: round.latestStartedRound, latestCommittedRound: round.latestStartedRound + 1,
    })), /invalid|CHECK constraint/i)
    await assert.rejects(storage.transaction((tx) => tx.putPlanningSyncRound({
      workspaceId: workspace.id, bindingId: providers.planning.bindingId, scopeKey: 'planning.project',
      latestStartedRound: round.latestStartedRound - 1, latestCommittedRound: 1,
    })), /must not move backwards/i)
    await assert.rejects(storage.transaction((tx) => tx.putPlanningSyncRound({
      workspaceId: workspace.id, bindingId: providers.planning.bindingId, scopeKey: 'planning.project',
      latestStartedRound: round.latestStartedRound + 1, latestCommittedRound: (round.latestCommittedRound ?? 1) - 1,
    })), /must not move backwards/i)
    let reopened
    if (label === 'SQLite') {
      storage.close?.()
      reopened = createSqliteStorage(location)
    } else {
      reopened = createFakeStorage(exportFakeStorageState(storage))
    }
    assert.deepEqual(await reopened.getPlanningSyncRound(workspace.id, providers.planning.bindingId, 'planning.project'), round)
    const reopenedContext = await createContext({ workspace, providers, storage: reopened })
    assert.ok(reopenedContext)
    assert.equal((await bootstrapWorkspace(reopenedContext)).ok, true, `${label}：重启后的新实例必须能接管下一轮`)
    const takenOver = await reopened.getPlanningSyncRound(workspace.id, providers.planning.bindingId, 'planning.project')
    assert.ok(takenOver && takenOver.latestStartedRound > round.latestStartedRound, `${label}：重启后的 round 必须单调前进`)
    reopened.close?.(); storage.close?.()
    rmSync(directory, { recursive: true, force: true })
  })

  test(`全量同步：较旧 Planning snapshot 在较新 snapshot 后提交时被拒绝（#305，${label}）`, async () => {
    const providers = createFakeProviders()
    const storage = makeStorage()
    const workspace = { id: newWorkspaceId(), name: `planning-round/${label}`, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
    const context = await createContext({ workspace, providers, storage })
    assert.ok(context, `${label}：必须能创建 core context`)
    const before = await bootstrapWorkspace(context)
    assert.equal(before.ok, true, `${label}：先建立已确认基线`)
    const item = providers.planning.state.items.find((candidate) => candidate.content.kind === ContentKind.WorkItem)
    assert.ok(item, `${label}：fixture 必须有 work item`)

    const original = providers.planning.listPlanningItems.bind(providers.planning)
    const gates = [deferred(), deferred()]
    let calls = 0
    providers.planning.listPlanningItems = async (input) => {
      const snapshot = await original(input)
      const gate = gates[calls++]
      assert.ok(gate, `${label}：只允许两轮受控读取`)
      await gate.promise
      return snapshot
    }

    const oldRound = bootstrapWorkspace(context)
    while (calls < 1) await Promise.resolve()
    item.content = { ...item.content, workItem: { ...item.content.workItem, title: '新快照标题' } }
    const newRound = bootstrapWorkspace(context)
    while (calls < 2) await Promise.resolve()

    gates[1].resolve()
    const newer = await newRound
    assert.equal(newer.ok, true, `${label}：新轮必须提交`)
    const committedRevision = await storage.currentRevision(workspace.id)
    const committedReconcile = await storage.getReconcileCursor(workspace.id)
    gates[0].resolve()
    const older = await oldRound
    assert.deepEqual([older.ok, older.error?.code], [false, 'stale_revision'], `${label}：旧轮必须结构化为 superseded`)
    assert.equal(await storage.currentRevision(workspace.id), committedRevision, `${label}：旧轮不得推进 revision`)

    const rows = await createQueries(context).listPlanningItems()
    assert.ok(rows.some((row) => row.content.title === '新快照标题'), `${label}：新标题必须保留`)
    assert.deepEqual(await storage.getReconcileCursor(workspace.id), committedReconcile, `${label}：旧轮不得改写 reconcile time`)
    storage.close?.()
  })

  test(`全量同步：旧失败轮晚于新成功轮不能覆盖 healthy cursor（#305，${label}）`, async () => {
    const providers = createFakeProviders()
    const storage = makeStorage()
    const workspace = { id: newWorkspaceId(), name: `planning-round-failure/${label}`, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
    const context = await createContext({ workspace, providers, storage })
    assert.ok(context, `${label}：必须能创建 core context`)
    const before = await bootstrapWorkspace(context)
    assert.equal(before.ok, true, `${label}：先建立已确认基线`)

    const original = providers.planning.listPlanningItems.bind(providers.planning)
    const oldGate = deferred()
    const newGate = deferred()
    const failureReadEntered = deferred()
    const failureReadRelease = deferred()
    let calls = 0
    providers.planning.listPlanningItems = async (input) => {
      const snapshot = await original(input)
      if (calls++ === 0) {
        await oldGate.promise
        throw new Error('injected old round failure')
      }
      await newGate.promise
      return snapshot
    }

    const originalRoundRead = storage.getPlanningSyncRound.bind(storage)
    // 根读 gate 复现旧实现的 split read/write 窗口；修复后失败结算在 tx 内读取，SQLite 的事务锁会使该窗口不存在。
    const originalTransaction = storage.transaction.bind(storage)
    let transactionRoundReads = 0
    storage.transaction = (work) => originalTransaction(async (tx) => work(new Proxy(tx, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (key === 'getPlanningSyncRound') {
          return async (...args) => {
            transactionRoundReads += 1
            return value.apply(target, args)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })))
    const rootRoundReads = []
    let pauseFailureRead = false
    storage.getPlanningSyncRound = async (...args) => {
      const round = await originalRoundRead(...args)
      rootRoundReads.push(round?.latestStartedRound)
      if (pauseFailureRead) {
        pauseFailureRead = false
        failureReadEntered.resolve()
        await failureReadRelease.promise
      }
      return round
    }

    const oldRound = bootstrapWorkspace(context)
    while (calls < 1) await Promise.resolve()
    pauseFailureRead = true
    oldGate.resolve()
    const oldState = await Promise.race([
      oldRound.then(() => 'completed'),
      failureReadEntered.promise.then(() => 'paused'),
    ])

    const newRound = bootstrapWorkspace(context)
    while (calls < 2) await Promise.resolve()
    newGate.resolve()
    const newer = await newRound
    assert.equal(newer.ok, true, `${label}：新轮必须成功提交`)

    if (oldState === 'paused') failureReadRelease.resolve()
    const older = await oldRound
    assert.equal(older.ok, false, `${label}：旧轮必须失败`)

    const sync = await createQueries(context).getPlanningSync()
    assert.ok(transactionRoundReads >= 3, `${label}：begin/commit 的 round 读取必须经 transaction scope`)
    assert.equal(rootRoundReads.length, 0, `${label}：失败结算不得在 transaction 外读取 round`)
    assert.deepEqual(
      [sync.degraded, sync.stale, sync.reason],
      [false, false, undefined],
      `${label}：旧失败轮不得覆盖新成功轮的 healthy cursor`,
    )
    storage.close?.()
  })

  test(`全量同步：新失败轮后旧成功 snapshot 仍被拒绝且保持 degraded（#305，${label}）`, async () => {
    const providers = createFakeProviders()
    const storage = makeStorage()
    const workspace = { id: newWorkspaceId(), name: `planning-round-new-failure/${label}`, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
    const context = await createContext({ workspace, providers, storage })
    assert.ok(context, `${label}：必须能创建 core context`)
    assert.equal((await bootstrapWorkspace(context)).ok, true, `${label}：先建立已确认基线`)
    const original = providers.planning.listPlanningItems.bind(providers.planning)
    const oldGate = deferred()
    const newGate = deferred()
    let calls = 0
    providers.planning.listPlanningItems = async (input) => {
      const snapshot = await original(input)
      if (calls++ === 0) {
        await oldGate.promise
        return snapshot
      }
      await newGate.promise
      throw new Error('injected latest round failure')
    }

    const oldRound = bootstrapWorkspace(context)
    while (calls < 1) await Promise.resolve()
    const newRound = bootstrapWorkspace(context)
    while (calls < 2) await Promise.resolve()
    newGate.resolve()
    const newer = await newRound
    assert.equal(newer.ok, false, `${label}：最新轮必须失败`)
    oldGate.resolve()
    const older = await oldRound
    assert.deepEqual([older.ok, older.error?.code], [false, 'stale_revision'], `${label}：旧成功轮仍必须 superseded`)
    const sync = await createQueries(context).getPlanningSync()
    assert.deepEqual([sync.degraded, sync.stale, sync.reason], [true, true, 'unavailable'], `${label}：最新失败状态必须保持 degraded`)
    storage.close?.()
  })
}
