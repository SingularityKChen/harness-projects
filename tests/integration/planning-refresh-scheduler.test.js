import assert from 'node:assert/strict'
import { test } from 'node:test'

import { composeCore, createPlanningReconciler } from '@harness-projects/core'
import { CommandWriteState, createController } from '@harness-projects/controller'
import { ContentKind, ProviderErrorCode, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { FaultKind, createFakeProviders, createFakeStorage, fixtureProjectRef } from '@harness-projects/provider-fake'

const actorRef = { kind: 'user', id: 'refresh-test' }
const OK = { ok: true, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, revision: 1, degraded: false }

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const turn = () => new Promise((resolve) => setImmediate(resolve))

/** 每轮让出事件循环且有上限：实现退化成不再读取时以断言失败结束，不会饿死 --test-timeout 的计时器。 */
async function waitFor(predicate, label) {
  for (let turns = 0; turns < 500; turns += 1) {
    if (await predicate()) return
    await turn()
  }
  assert.fail(`waited 500 event-loop turns for ${label}`)
}

function fakeTimers() {
  const handles = []
  const timers = { setInterval(fn) { const handle = { fn }; handles.push(handle); return handle }, clearInterval() {} }
  return { handles, timers }
}

async function collectUnhandled(run) {
  const seen = []
  const onUnhandled = (reason) => { seen.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  try {
    await run()
    await turn()
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  return seen
}

async function setup(deps = {}) {
  const providers = createFakeProviders()
  const workspace = {
    id: newWorkspaceId(), name: 'Planning refresh', statusPolicy: StatusPolicy.ProviderAuthoritative,
    project: fixtureProjectRef(providers.planning.bindingId),
  }
  const core = await composeCore({ workspace, providers, ...deps })
  return { core, providers, workspace }
}

function workItem(providers) {
  const item = providers.planning.state.items.find((candidate) => candidate.content.kind === ContentKind.WorkItem)
  assert.ok(item)
  return item
}

function rename(item, title) {
  assert.equal(item.content.kind, ContentKind.WorkItem)
  item.content = { ...item.content, workItem: { ...item.content.workItem, title } }
}

test('explicit refresh reads current provider state without invoking provider writes', async () => {
  const { core, providers } = await setup()
  const item = workItem(providers)
  rename(item, 'explicit refresh title')
  const writes = []
  // 端口的五个写方法全部装 spy；替身没实现的也直接赋值，`planning.x?.()` 形式的调用同样被看到。
  for (const name of ['createIssueWorkItem', 'createDraftItem', 'updateWorkItemContent', 'updatePlanningFields', 'movePlanningItem']) {
    const original = providers.planning[name]?.bind(providers.planning)
    providers.planning[name] = (...args) => { writes.push(name); return original?.(...args) }
  }

  const result = await core.commands.refreshPlanning()
  const rows = await core.queries.listPlanningItems()
  assert.equal(result.ok, true)
  assert.ok(rows.some((row) => row.content.title === 'explicit refresh title'))
  assert.deepEqual(writes, [])
})

test('same-state refresh keeps the workspace revision unchanged', async () => {
  const { core, providers } = await setup()
  const before = await providers.storage.currentRevision((await core.queries.getWorkspaceMetadata()).workspace.id)
  const result = await core.commands.refreshPlanning()
  const after = await providers.storage.currentRevision((await core.queries.getWorkspaceMetadata()).workspace.id)
  assert.equal(result.ok, true)
  assert.equal(after, before)
  assert.equal(result.revision, before)
})

test('failed refresh retains last-known rows as stale and the next success clears stale', async () => {
  const { core, providers } = await setup()
  const before = await core.queries.listPlanningItems()
  providers.planning.setFault(FaultKind.Offline, true)
  const failed = await core.commands.refreshPlanning()
  assert.deepEqual([failed.ok, failed.error?.code], [false, ProviderErrorCode.Unavailable])
  assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: true, reason: 'unavailable' })
  assert.deepEqual((await core.queries.listPlanningItems()).map((row) => row.entityId), before.map((row) => row.entityId))

  providers.planning.setFault(FaultKind.Offline, false)
  assert.equal((await core.commands.refreshPlanning()).ok, true)
  assert.deepEqual(await core.queries.getPlanningSync(), { degraded: false, stale: false, reason: undefined })
})

test('controller refresh is local-only and never replays an earlier provider read', async () => {
  const { core, providers } = await setup()
  const controller = createController(core)
  const original = providers.planning.listPlanningItems.bind(providers.planning)
  let reads = 0
  providers.planning.listPlanningItems = (input) => { reads += 1; return original(input) }

  const first = await controller.commands.refreshPlanning({ actorRef })
  const second = await controller.commands.refreshPlanning({ actorRef })
  assert.deepEqual([first.writeState, second.writeState], [CommandWriteState.LocalOnly, CommandWriteState.LocalOnly])
  assert.equal(reads, 2)
})

test('explicit and scheduled triggers share one in-flight refresh (Core command, Controller command, reconciler)', async () => {
  const { core, providers } = await setup()
  const original = providers.planning.listPlanningItems.bind(providers.planning)
  const gate = deferred()
  let reads = 0
  providers.planning.listPlanningItems = async (input) => {
    reads += 1
    const result = await original(input)
    await gate.promise
    return result
  }
  const reconciler = createPlanningReconciler(core, { intervalMs: 1000 })
  const scheduled = reconciler.triggerNow()
  await waitFor(() => reads > 0, 'the scheduled provider read')
  const explicit = core.commands.refreshPlanning()
  const viaController = createController(core).commands.refreshPlanning({ actorRef })
  const duplicate = reconciler.triggerNow()
  await turn()
  assert.equal(reads, 1)
  gate.resolve()
  assert.strictEqual(await explicit, await scheduled)
  assert.strictEqual(await duplicate, await scheduled)
  const controllerResult = await viaController
  assert.deepEqual([controllerResult.writeState, controllerResult.value === await scheduled], [CommandWriteState.LocalOnly, true])
  reconciler.dispose()
})

test('standalone refresh source is single-flight without relying on Core command state', async () => {
  const gate = deferred()
  let calls = 0
  const reconciler = createPlanningReconciler(async () => {
    calls += 1
    await gate.promise
    return OK
  }, { intervalMs: 1000 })

  const first = reconciler.triggerNow()
  await waitFor(() => calls > 0, 'the source call')
  const duplicate = reconciler.triggerNow()
  assert.strictEqual(duplicate, first)
  assert.equal(calls, 1)

  gate.resolve()
  assert.strictEqual(await first, OK)
  reconciler.dispose()
})

test('interval must be a positive finite millisecond count within the Node timer range; omitted means 60s', () => {
  for (const intervalMs of [0, -0, -1, Number.NaN, Infinity, -Infinity, 2 ** 31, 1e12]) {
    assert.throws(() => createPlanningReconciler(async () => OK, { intervalMs }), RangeError, String(intervalMs))
  }
  const scheduled = []
  const timers = { setInterval(fn, intervalMs) { scheduled.push(intervalMs); return {} }, clearInterval() {} }
  for (const intervalMs of [1, 2 ** 31 - 1, undefined]) {
    const reconciler = createPlanningReconciler(async () => OK, { intervalMs, timers })
    reconciler.start()
    reconciler.dispose()
  }
  assert.deepEqual(scheduled, [1, 2 ** 31 - 1, 60_000])
})

test('fake timer lifecycle is idempotent and cleared callbacks cannot start a refresh', async () => {
  const handles = []
  let clears = 0
  let calls = 0
  const timers = {
    setInterval(fn, intervalMs) {
      assert.equal(intervalMs, 1000)
      const handle = { fn, cleared: false }
      handles.push(handle)
      return handle
    },
    clearInterval(handle) {
      clears += 1
      handle.cleared = true
    },
  }
  const reconciler = createPlanningReconciler(async () => {
    calls += 1
    return OK
  }, { intervalMs: 1000, timers })

  reconciler.start()
  reconciler.start()
  assert.equal(handles.length, 1)
  const first = handles[0]
  reconciler.stop()
  reconciler.stop()
  assert.equal(clears, 1)
  first.fn()
  await turn()
  assert.equal(calls, 0)

  reconciler.start()
  const second = handles[1]
  first.fn()
  await turn()
  assert.equal(calls, 0)
  reconciler.dispose()
  reconciler.dispose()
  assert.equal(clears, 2)
  second.fn()
  await turn()
  assert.equal(calls, 0)
  await assert.rejects(reconciler.triggerNow(), /disposed/)
})

test('stop cancels periodic ticks without cancelling the in-flight round; dispose clears a restarted timer', async () => {
  const { core, providers } = await setup()
  const original = providers.planning.listPlanningItems.bind(providers.planning)
  const gate = deferred()
  let reads = 0
  providers.planning.listPlanningItems = async (input) => {
    reads += 1
    const result = await original(input)
    await gate.promise
    return result
  }
  let callback
  let cleared = 0
  let unrefed = 0
  const timers = {
    setInterval(fn, intervalMs) {
      assert.equal(intervalMs, 1000)
      callback = fn
      return { unref() { unrefed += 1 } }
    },
    clearInterval() { cleared += 1; callback = undefined },
  }
  const reconciler = createPlanningReconciler(core, { intervalMs: 1000, timers })
  reconciler.start()
  callback()
  await waitFor(() => reads > 0, 'the scheduled provider read')
  reconciler.stop()
  gate.resolve()
  const workspaceId = (await core.queries.getWorkspaceMetadata()).workspace.id
  await waitFor(async () => (await providers.storage.getPlanningSyncRound(workspaceId, providers.planning.bindingId, 'planning.project')).latestCommittedRound >= 2, 'the in-flight round to commit')
  assert.deepEqual([reads, cleared, unrefed], [1, 1, 1])
  reconciler.start()
  reconciler.dispose()
  assert.deepEqual([cleared, unrefed], [2, 2])
  assert.throws(() => reconciler.start(), /disposed/)
})

test('reconciler frees its slot after success, rejection and sync throw; each scheduled rejection reaches diagnostics', async () => {
  const rejected = new Error('rejected round')
  const thrown = new Error('thrown round')
  const steps = [() => Promise.resolve(OK), () => Promise.reject(rejected), () => { throw thrown }, () => Promise.resolve(OK)]
  let calls = 0
  const reported = []
  const { handles, timers } = fakeTimers()
  const reconciler = createPlanningReconciler(() => steps[calls++](), {
    intervalMs: 1000, timers, diagnostics: { syncRoundFailed: (error) => { reported.push(error) } },
  })
  const unhandled = await collectUnhandled(async () => {
    assert.strictEqual(await reconciler.triggerNow(), OK)
    reconciler.start()
    for (let tick = 0; tick < 3; tick += 1) {
      handles[0].fn()
      await turn()
    }
  })
  reconciler.dispose()
  assert.equal(calls, 4)
  assert.equal(reported.length, 2)
  assert.ok(reported[0] === rejected && reported[1] === thrown, 'the original rejection object reaches the host')
  assert.deepEqual(unhandled, [])
})

test('a failing diagnostics sink never stops the schedule, and an explicit trigger rejects to its caller only', async () => {
  const failure = new Error('round failed')
  const sinks = [() => { throw new Error('sink threw') }, () => Promise.reject(new Error('sink rejected')), () => new Promise(() => {})]
  let calls = 0
  let sinkCalls = 0
  const { handles, timers } = fakeTimers()
  const reconciler = createPlanningReconciler(async () => { calls += 1; throw failure }, {
    intervalMs: 1000, timers, diagnostics: { syncRoundFailed: () => sinks[sinkCalls++ % sinks.length]() },
  })
  const unhandled = await collectUnhandled(async () => {
    await assert.rejects(reconciler.triggerNow(), (error) => error === failure)
    assert.equal(sinkCalls, 0)
    reconciler.start()
    for (let tick = 0; tick < 4; tick += 1) {
      handles[0].fn()
      await turn()
    }
  })
  reconciler.dispose()
  assert.deepEqual([calls, sinkCalls, unhandled], [5, 4, []])
})

test('scheduled double fault (round failed, degraded cursor unwritable) reaches the host diagnostics sink once', async () => {
  const fault = new Error('disk full')
  const gate = { armed: false }
  const wrap = (target) => new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key)
      if (typeof value !== 'function') return value
      if (key === 'putSyncCursor') return (...args) => (gate.armed ? Promise.reject(fault) : value.apply(object, args))
      if (key === 'transaction') return (work) => value.call(object, (tx) => work(wrap(tx)))
      return value.bind(object)
    },
  })
  const reported = []
  const diagnostics = { syncRoundFailed: (error) => { reported.push(error) } }
  const { core, providers } = await setup({ storage: wrap(createFakeStorage()), diagnostics })
  const { handles, timers } = fakeTimers()
  const reconciler = createPlanningReconciler(core, { intervalMs: 1000, timers, diagnostics })
  gate.armed = true
  providers.planning.setFault(FaultKind.Offline, true)
  reconciler.start()
  handles[0].fn()
  await waitFor(() => reported.length > 0, 'the scheduled rejection to reach diagnostics')
  assert.ok(reported.length === 1 && reported[0] === fault)

  await assert.rejects(core.commands.refreshPlanning(), (error) => error === fault)
  await assert.rejects(createController(core).commands.refreshPlanning({ actorRef }), (error) => error === fault)
  assert.equal(reported.length, 1, 'explicit commands hand the same rejection to their caller, not to diagnostics')
  reconciler.dispose()
})
