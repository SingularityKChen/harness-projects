/** #297：公开刷新按持久仓库引用与完整 CR 操作选连接；所有 provider 均离线。 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CapabilityKey, providerErr, providerError } from '@harness-projects/capabilities'
import { AccessLevel, newEntityId, newExternalIdentityId, newWorkspaceId } from '@harness-projects/domain'
import { composeCore, createContext, createWorkspaceSetup } from '@harness-projects/core'
import { createFakeDevelopmentProvider, createFakeDeliveryProvider, createFakeExecutionProvider, createFakePlanningProvider, createFakeStorage, exportFakeStorageState, refOf } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { CHANGE_REQUEST_READ_ROUTE, routeDevelopment } from '../../packages/core/src/development-route.ts'

const REPOSITORY = 'repo-alpha'
const REMOTE_HEAD = 'remote-head'
const LOCAL_HEAD = 'local-head'
const LOCAL = 'test.route-local'
const REMOTE = 'test.route-remote'
const POLICY = { allowedSecretHandles: new Set(), configurations: new Map([[LOCAL, {}], [REMOTE, {}]]) }
const dir = mkdtempSync(join(tmpdir(), 'delivery-route-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
const STORAGES = ['Fake', 'SQLite']

function storeFor(label, t) {
  const path = join(dir, `route-${files++}.sqlite`)
  const store = { storage: label === 'Fake' ? createFakeStorage(undefined, POLICY) : createSqliteStorage(path, POLICY) }
  store.reopen = () => {
    if (label === 'Fake') store.storage = createFakeStorage(exportFakeStorageState(store.storage), POLICY)
    else { store.storage.close(); store.storage = createSqliteStorage(path, POLICY) }
  }
  t.after(() => store.storage.close?.())
  return store
}

/** 替身方法保留真实的 binding 隔离、过滤与分页；仅覆盖实现声明以匹配 Local Git / GitHub。 */
function development(type, bindingId) {
  const target = createFakeDevelopmentProvider({ bindingId, capabilities: {
    worktreeRemove: false, changeRequestCreate: false,
    ...(type === 'remote' ? { branchCreate: false, worktreeCreate: false, worktreeRead: false } : {}),
  } })
  const calls = []
  const controls = { denied: undefined, omitCR: false, localCR: false, failCR: false }
  const port = new Proxy(target, { get(object, key) {
    if (key === 'definition') return { implementationKey: type === 'local' ? LOCAL : REMOTE, domains: ['development'] }
    const method = Reflect.get(object, key, object)
    if (key === 'describeCapabilities') return async () => {
      const snapshot = await method.call(object)
      const levels = (entries) => Object.fromEntries(Object.entries(entries)
        .filter(([key]) => key !== CapabilityKey.DevelopmentChangeRequestRead || (type === 'remote' && !controls.omitCR) || controls.localCR)
        .map(([key, value]) => [key, key === controls.denied ? AccessLevel.Unavailable : value]))
      return { ...snapshot, capability: levels(snapshot.capability), permission: levels(snapshot.permission) }
    }
    if (typeof method !== 'function') return method
    return async (...args) => {
      calls.push({ method: String(key), input: args[0] })
      if (key === 'listChangeRequests' && controls.failCR) return providerErr(providerError('unavailable', 'raw-private-provider-error'))
      return method.apply(object, args)
    }
  } })
  return { target, port, calls, controls, bindingId }
}

/** 远端与本地故意给不同 head；每个诱饵都能成功返回，不能靠空页掩盖误路由。 */
function seed(dev, branch, head, prId) {
  const repository = refOf(dev.bindingId, 'repository', REPOSITORY)
  dev.target.state.branches = [{ repository, ref: refOf(dev.bindingId, 'branch', branch), name: branch, headCommit: head }]
  dev.target.state.changeRequests = [{ repository, ref: refOf(dev.bindingId, 'change_request', prId), number: 17,
    title: prId, body: '', state: 'open', head: branch, headBranch: branch, headCommit: head, sourceVersion: head, reviewState: 'unknown' }]
}

async function world(label, t, order) {
  const store = storeFor(label, t)
  const workspace = { id: newWorkspaceId(), name: 'Delivery route' }
  const setup = createWorkspaceSetup(store.storage)
  assert.equal((await setup.createWorkspace({ workspaceId: workspace.id, name: workspace.name, statusPolicy: 'manual_only' })).ok, true)
  let local, remote
  if (order) {
    const bound = await setup.bindRepository({ workspaceId: workspace.id, repositoryId: REPOSITORY,
      references: order.map((type) => ({ domain: 'development', implementationKey: type === 'local' ? LOCAL : REMOTE, configuration: {} })) })
    assert.equal(bound.ok, true)
    local = development('local', bound.value.bindingIds[order.indexOf('local')])
    remote = development('remote', bound.value.bindingIds[order.indexOf('remote')])
  } else {
    local = development('remote', 'binding-A')
    // A also provides Start Work, while still reading with the remote operation later.
    Object.assign(local.target.flags, { branchCreate: true, worktreeCreate: true, worktreeRead: true })
    remote = development('remote', 'binding-B')
  }
  const planning = createFakePlanningProvider()
  const execution = createFakeExecutionProvider()
  const delivery = createFakeDeliveryProvider()
  const ciCalls = []
  for (const name of ['listPipelineRuns', 'listChecks']) {
    const original = delivery[name].bind(delivery)
    delivery[name] = async (input) => { ciCalls.push(name); return original(input) }
  }
  let tick = 0
  const deps = (mounts) => ({ workspace, storage: store.storage, providers: { planning, execution, delivery, development: mounts.map((dev) => dev.port) },
    clock: () => new Date(Date.UTC(2026, 9, 22, 0, 0, tick++)).toISOString() })
  let core = await composeCore(deps(order ? [local, remote] : [local]))
  const workItemId = (await core.queries.listPlanningItems()).find((item) => item.kind === 'work_item' && item.content.contentKind === 'work_item').entityId
  const started = await core.commands.startWork({ workItemId, repositoryId: REPOSITORY, actor: { kind: 'agent' }, idempotencyKey: 'route-start' })
  assert.equal(started.confirmed, true, '前置：公开 Start Work 已确认并登记仓库')
  const branch = started.branchExternalId
  seed(local, branch, order ? LOCAL_HEAD : REMOTE_HEAD, order ? 'local-pr' : 'A-pr')
  seed(remote, branch, REMOTE_HEAD, order ? 'remote-pr' : 'B-pr')
  for (const row of [...delivery.state.runs, ...delivery.state.checks]) row.commit = REMOTE_HEAD
  const scope = { workItemId, repositoryId: REPOSITORY }
  const result = { store, workspace, local, remote, delivery, ciCalls, deps, scope, started, branch }
  result.compose = async (mounts = [remote, local]) => {
    core = await composeCore(deps(mounts))
    result.core = core
    local.calls.length = remote.calls.length = ciCalls.length = 0
    return core
  }
  result.record = () => store.storage.getDeliveryFacts(workspace.id, started.executionContextId)
  await result.compose()
  return result
}

const observedArtifacts = (projection) => projection.hops.filter((hop) => ['commit', 'change_request'].includes(hop.entityKind)).map((hop) => [hop.entityKind, hop.externalId, hop.observed])
const worktreeId = (projection) => projection.hops.find((hop) => hop.entityKind === 'worktree')?.to

async function assertObserved(w, selected, expectedPR) {
  const result = await w.core.commands.refreshDeliveryFacts(w.scope)
  const expected = { bindingId: selected.bindingId, objectKind: 'repository', externalId: REPOSITORY, url: undefined }
  for (const { input } of selected.calls) assert.deepEqual(input.repository, expected, '两跳都使用完整远端引用')
  assert.deepEqual([result.error, result.gaps], [undefined, []], '公开刷新必须经已登记仓库的唯一操作路由成功，无 capability gap')
  const projection = await w.core.queries.getDeliveryProjection(w.scope)
  assert.deepEqual(observedArtifacts(projection), [['commit', REMOTE_HEAD, true], ['change_request', expectedPR, true]], 'commit 与 PR 两跳均须观察到选中连接的事实')
  assert.deepEqual(selected.calls.map(({ method }) => method), ['listBranches', 'listChangeRequests'])
  return projection
}

for (const label of STORAGES) {
  test(`AC297 registered-repository-multi-development-read (${label})`, async (t) => {
    const w = await world(label, t)
    w.store.reopen()
    await w.compose([w.remote, w.local])
    await assertObserved(w, w.local, 'A-pr')
    assert.deepEqual(w.remote.calls, [], 'B 在前且有可成功诱饵，也不得读取')
  })

  for (const order of [['local', 'remote'], ['remote', 'local']]) {
    test(`AC297 side-by-side-local-github-operation (${order[0]} primary, ${label})`, async (t) => {
      const w = await world(label, t, order)
      w.store.reopen()
      await w.compose(order[0] === 'local' ? [w.remote, w.local] : [w.local, w.remote])
      const context = await createContext(w.deps([w.local, w.remote]))
      const repositoryRead = await routeDevelopment(context, REPOSITORY, CapabilityKey.DevelopmentRepositoryRead, 'read')
      assert.equal(repositoryRead.error?.code, 'conflict', 'repository.read 两实现均声明，不能作为锚点')
      const { anchor: [key, mode], earlier } = CHANGE_REQUEST_READ_ROUTE
      const operation = await routeDevelopment(context, REPOSITORY, key, mode, earlier)
      assert.equal(operation.ok && operation.binding.ref.bindingId, w.remote.bindingId)
      const before = await w.core.queries.getDeliveryProjection(w.scope)
      const after = await assertObserved(w, w.remote, 'remote-pr')
      assert.equal(worktreeId(after), worktreeId(before), '远端引用不改变本地工作树身份')
      assert.deepEqual(w.local.calls, [], '本地分支有不同 head 与 PR 诱饵，仍零调用')
    })
  }
}

/** 路由拒绝必须保留四个完整集合；先检查内容，防止用换 gap 标签掩盖删除。 */
async function assertRefused(w, baseline, mounts) {
  const relations = await w.store.storage.listRelations(w.workspace.id)
  const result = await w.core.commands.refreshDeliveryFacts(w.scope)
  const current = await w.record()
  if (baseline) assert.deepEqual(current.sets, baseline.sets.map((set) => ({ ...set, stale: true })), '路由拒绝保留四集合节点、锚点与 confirmedAt，全部 stale')
  else assert.ok(current.sets.every((set) => set.stale && set.nodes.length === 0 && set.confirmedAt === undefined), '首次拒绝只留骨架，不伪造确认')
  assert.deepEqual(result.gaps, [{ key: CapabilityKey.DevelopmentRepositoryRead }], '拒绝整个操作只输出 repository gap，不泄露原始理由')
  assert.equal(result.error, undefined)
  assert.deepEqual(mounts.flatMap((dev) => dev.calls), [], '所有 Development 诱饵零读取')
  assert.deepEqual(w.ciCalls, [], '没有 head / PR，CI 零读取')
  assert.deepEqual(await w.store.storage.listRelations(w.workspace.id), relations, '拒绝不新增或删除谱系关系')
}

async function immutableFacts(w) {
  const storage = w.store.storage
  const repositories = await storage.listRepositories(w.workspace.id)
  const anchor = await storage.findExternalIdentity(w.local.bindingId, 'repository', REPOSITORY)
  return { repositories, identities: await storage.listIdentitiesForEntity(anchor.entityId),
    planning: await storage.listPlanningProjections(w.workspace.id), revision: await storage.currentRevision(w.workspace.id) }
}
const relationTriples = async (w) => (await w.store.storage.listRelations(w.workspace.id)).map(({ from, to, type }) => `${from}|${type}|${to}`).sort()

for (const label of STORAGES) {
  for (const decoy of ['missing', 'historical', 'other-entity']) {
    test(`AC297 missing-current-reference (${decoy}, ${label})`, async (t) => {
      const w = await world(label, t)
      await assertObserved(w, w.local, 'A-pr')
      const baseline = await w.record()
      assert.ok(baseline.sets.every((set) => set.nodes.length > 0 && !set.stale), '前置：四个集合均有确认事实')
      const strangers = [development('remote', 'new-C'), development('remote', 'new-D')]
      for (const dev of strangers) seed(dev, w.branch, REMOTE_HEAD, 'stranger-pr')
      await w.compose(strangers) // 先登记连接锚点，身份写入遵守两个 Storage 的外键。
      if (decoy !== 'missing') {
        const anchor = await w.store.storage.findExternalIdentity(w.local.bindingId, 'repository', REPOSITORY)
        const entityId = decoy === 'historical' ? anchor.entityId : newEntityId()
        await w.store.storage.transaction(async (tx) => {
          if (decoy === 'other-entity') await tx.putEntity({ id: entityId, kind: 'repository' })
          await tx.putExternalIdentity({ id: newExternalIdentityId(), entityId, bindingId: strangers[0].bindingId,
            externalKind: 'repository', externalId: REPOSITORY, role: decoy === 'historical' ? 'historical' : 'primary' })
        })
      }
      await assertRefused(w, baseline, strangers)
      w.store.reopen()
      await w.compose(strangers)
      await assertRefused(w, baseline, strangers)
      await w.compose([w.remote, w.local])
      const restored = await assertObserved(w, w.local, 'A-pr')
      assert.ok(restored.freshness.every((set) => !set.stale), '恢复原 binding id 后重新确认')
    })
  }

  test(`AC297 missing-current-reference-first-refresh (${label})`, async (t) => {
    const w = await world(label, t)
    const strangers = [development('remote', 'new-C'), development('remote', 'new-D')]
    for (const dev of strangers) seed(dev, w.branch, REMOTE_HEAD, 'stranger-pr')
    await w.compose(strangers)
    await assertRefused(w, undefined, strangers)
    assert.equal((await w.store.storage.listRelations(w.workspace.id)).filter((r) => ['derived_from', 'produced_by'].includes(r.type)).length, 0)
  })

  for (const denial of ['repository', 'change-request', 'undeclared', 'ambiguous-unavailable']) {
    test(`AC297 selected-operation-gate-denial (${denial}, ${label})`, async (t) => {
      const w = await world(label, t, ['local', 'remote'])
      await assertObserved(w, w.remote, 'remote-pr')
      const baseline = await w.record()
      if (denial === 'repository') w.remote.controls.denied = CapabilityKey.DevelopmentRepositoryRead
      if (denial === 'change-request') w.remote.controls.denied = CapabilityKey.DevelopmentChangeRequestRead
      if (denial === 'undeclared') w.remote.controls.omitCR = true
      if (denial === 'ambiguous-unavailable') {
        w.local.controls.localCR = true
        w.remote.controls.denied = CapabilityKey.DevelopmentChangeRequestRead
      }
      await w.compose()
      await assertRefused(w, baseline, [w.local, w.remote])
      w.remote.controls.denied = undefined
      w.remote.controls.omitCR = w.local.controls.localCR = false
      await w.compose()
      await assertObserved(w, w.remote, 'remote-pr')
    })
  }

  test(`AC297 routed-read-failure-is-partial (${label})`, async (t) => {
    const w = await world(label, t, ['local', 'remote'])
    await assertObserved(w, w.remote, 'remote-pr')
    const before = await w.record()
    w.remote.target.state.branches[0].headCommit = 'remote-next'
    for (const row of w.delivery.state.runs) row.commit = 'remote-next'
    w.remote.controls.failCR = true
    w.local.calls.length = w.remote.calls.length = w.ciCalls.length = 0
    const result = await w.core.commands.refreshDeliveryFacts(w.scope)
    assert.deepEqual([result.error, result.gaps], [undefined, [{ key: CapabilityKey.DevelopmentChangeRequestRead }]])
    assert.equal(JSON.stringify(result).includes('raw-private-provider-error'), false)
    const after = await w.record()
    assert.deepEqual(after.sets.map(({ kind, stale }) => [kind, stale]), [['commit', false], ['change_request', true], ['pipeline_run', false], ['check_run', true]])
    for (const kind of ['change_request', 'check_run']) assert.deepEqual(after.sets.find((set) => set.kind === kind), { ...before.sets.find((set) => set.kind === kind), stale: true })
    assert.equal(after.sets[0].nodes[0].externalId, 'remote-next', '分支成功，commit 更新')
    for (const index of [0, 2]) assert.notEqual(after.sets[index].confirmedAt, before.sets[index].confirmedAt, 'commit / pipeline 推进确认时刻')
    assert.deepEqual([w.local.calls, w.ciCalls], [[], ['listPipelineRuns']], '只更新流水线，不读缺 PR 锚点的 checks')
  })

  test(`AC297 persistent-lineage-and-pure-query (${label})`, async (t) => {
    const w = await world(label, t, ['remote', 'local'])
    const immutable = await immutableFacts(w)
    const initial = await w.core.queries.getDeliveryProjection(w.scope)
    const first = await assertObserved(w, w.remote, 'remote-pr')
    const triples = await relationTriples(w)
    for (let round = 0; round < 2; round++) {
      w.local.calls.length = w.remote.calls.length = w.ciCalls.length = 0
      await assertObserved(w, w.remote, 'remote-pr')
      assert.deepEqual(await relationTriples(w), triples, '重复刷新不会增殖关系三元组')
      assert.deepEqual(await immutableFacts(w), immutable, '刷新不改仓库、引用、规划与修订号')
    }
    const snapshot = await w.record()
    w.store.reopen()
    await w.compose()
    const reopened = await w.core.queries.getDeliveryProjection(w.scope)
    assert.deepEqual(observedArtifacts(reopened), observedArtifacts(first))
    assert.deepEqual([worktreeId(initial), worktreeId(first), worktreeId(reopened)], [worktreeId(first), worktreeId(first), worktreeId(first)])
    await w.core.queries.getDeliveryLineage(w.scope)
    await w.core.queries.getExecutionContext(w.scope)
    assert.deepEqual([w.local.calls, w.remote.calls, w.ciCalls], [[], [], []], '查询只读持久快照，零 provider 调用')
    assert.deepEqual(await w.record(), snapshot, '查询不写快照')
    assert.deepEqual(await relationTriples(w), triples)
    await assertObserved(w, w.remote, 'remote-pr')
    assert.deepEqual(await relationTriples(w), triples, '重启再刷新仍复用谱系')
  })
}
