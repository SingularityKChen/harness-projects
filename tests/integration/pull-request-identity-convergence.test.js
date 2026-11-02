/** #367：不同连接观察同一原生 PR，持久实体、规划成员与交付端点必须收敛。 */
import '../fixtures/resolution-preflight.mjs';
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { composeCore, createContext } from '@harness-projects/core'
import { readChainFacts } from '../../packages/core/src/chain-facts.ts'
import { newWorkspaceId } from '@harness-projects/domain'
import { createFakeProviders, createFakeStorage, exportFakeStorageState, refOf } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const dir = mkdtempSync(join(tmpdir(), 'pr-convergence-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const NATIVE = { namespace: 'github.com/graphql/PullRequest', id: 'opaque:PR/7|id' }
const POLICY = { allowedSecretHandles: new Set(), configurations: new Map([['test.planning', {}], ['test.development', {}]]) }
let file = 0
const port = (target, definition, overrides = {}) => new Proxy(target, { get(object, key) {
  if (key === 'definition') return definition
  if (Object.hasOwn(overrides, key)) return overrides[key]
  const value = Reflect.get(object, key, object)
  return typeof value === 'function' ? value.bind(object) : value
} })

async function world(label, t, storage, workspaceId = newWorkspaceId()) {
  const path = join(dir, `pr-${file++}.sqlite`)
  const providers = createFakeProviders()
  const prSeed = providers.planning.state.items.find((item) => item.ref.objectKind === 'change_request')
  prSeed.ref = { ...prSeed.ref, url: 'https://example.invalid/pr/7' }
  const control = { visible: false, planningNative: NATIVE, developmentNative: NATIVE, fault: undefined, declarationOnOther: undefined }
  const planning = port(providers.planning, { implementationKey: 'test.planning', domains: ['planning'] }, {
    listPlanningItems: async (input) => {
      const result = await providers.planning.listPlanningItems(input)
      return !result.ok ? result : { ...result, value: { ...result.value, items: result.value.items
        .filter((item) => item.ref.objectKind !== 'change_request' || control.visible)
        .map((item) => item.ref.objectKind === 'change_request' ? { ...item, nativeIdentity: control.planningNative } : item.ref.externalId === control.declarationOnOther ? { ...item, nativeIdentity: NATIVE } : item) } }
    },
  })
  const development = port(providers.development, { implementationKey: 'test.development', domains: ['development'] })
  const w = { providers, planning, development, control, workspace: { id: workspaceId, name: 'PR identity' },
    storage: storage ?? (label === 'Fake' ? createFakeStorage(undefined, POLICY) : createSqliteStorage(path, POLICY)) }
  let tick = 0
  w.compose = async () => {
    const storagePort = port(w.storage, w.storage.definition, { transaction: async (run) => {
      const before = control.beforeTransaction
      control.beforeTransaction = undefined
      await before?.()
      return w.storage.transaction((tx) => run(new Proxy(tx, { get(object, key) {
      const value = Reflect.get(object, key, object)
      return typeof value !== 'function' ? value : async (...args) => {
        const result = await value.apply(object, args)
        if (key === control.fault && (key !== 'putEntity' || args[0].kind === 'change_request')) throw new Error('injected write failure')
        return result
      }
    } }))) } })
    w.core = await composeCore({ workspace: w.workspace, storage: storagePort,
      providers: { planning, development, execution: providers.execution, delivery: providers.delivery },
      clock: () => new Date(Date.UTC(2026, 9, 28, 0, 0, tick++)).toISOString() })
  }
  w.reopen = async (recompose = true) => {
    if (label === 'Fake') w.storage = createFakeStorage(exportFakeStorageState(w.storage), POLICY)
    else { w.storage.close(); w.storage = createSqliteStorage(path, POLICY) }
    if (recompose) await w.compose()
  }
  w.entities = () => label === 'Fake' ? exportFakeStorageState(w.storage).entities.filter((row) => row.kind === 'change_request')
    : w.storage.db.prepare("SELECT id, kind FROM entity WHERE kind = 'change_request'").all()
  await createContext({ workspace: w.workspace, storage: w.storage,
    providers: { planning, development, execution: providers.execution, delivery: providers.delivery } })
  w.accountId = `account-${workspaceId}`
  await w.storage.putConnectorAccount({ id: w.accountId, platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account',
    externalId: w.accountId, displayName: 'fixture account', secretHandle: undefined, connectionState: 'connected' })
  await w.storage.setProviderBindingAccount(providers.planning.bindingId, w.accountId)
  await w.compose()
  const workItemId = (await w.core.queries.listPlanningItems()).find((item) => item.content.identity?.externalId === 'issue-1').entityId
  w.scope = { workItemId, repositoryId: 'repo-alpha' }
  const started = await w.core.commands.startWork({ ...w.scope, actor: { kind: 'agent' }, idempotencyKey: 'start' })
  assert.equal(started.confirmed, true)
  w.contextId = started.executionContextId
  const repository = refOf(providers.development.gate.bindingId, 'repository', 'repo-alpha')
  providers.development.state.branches = [{ repository, ref: refOf(providers.development.gate.bindingId, 'branch', started.branchExternalId), name: started.branchExternalId, headCommit: 'head-7' }]
  providers.development.state.changeRequests = [{ repository, ref: { ...refOf(providers.development.gate.bindingId, 'change_request', 'pr-7'), url: 'https://example.invalid/pr/7' },
    number: 7, title: 'PR seven', body: '', state: 'open', headBranch: started.branchExternalId, sourceVersion: 'head-7', reviewState: 'unknown' }]
  const originalList = providers.development.listChangeRequests.bind(providers.development)
  providers.development.listChangeRequests = async (input) => {
    const result = await originalList(input)
    return !result.ok ? result : { ...result, value: { ...result.value, items: result.value.items.map((item) => ({ ...item, nativeIdentity: control.developmentNative })) } }
  }
  for (const row of [...providers.delivery.state.runs, ...providers.delivery.state.checks]) row.commit = 'head-7'
  w.plan = async () => { control.visible = true; return w.core.commands.bootstrapWorkspace() }
  w.lineage = async () => {
    const before = [await w.storage.listPlanningProjections(w.workspace.id), await w.storage.currentRevision(w.workspace.id)]
    const result = await w.core.commands.refreshDeliveryFacts(w.scope)
    assert.deepEqual(result.gaps, [], 'fixture 必须成功读到远端事实')
    assert.deepEqual([await w.storage.listPlanningProjections(w.workspace.id), await w.storage.currentRevision(w.workspace.id)], before, 'Lineage 不改 Planning 状态、内容或业务 revision')
    return result
  }
  w.identity = () => w.storage.findExternalIdentity(providers.planning.bindingId, 'change_request', 'pr-7')
  w.developmentIdentity = () => w.storage.findExternalIdentity(providers.development.gate.bindingId, 'change_request', 'pr-7')
  w.record = () => w.storage.getDeliveryFacts(w.workspace.id, w.contextId)
  t.after(() => w.storage.close?.())
  return w
}

async function assertConverged(w) {
  const identity = await w.identity()
  const projection = (await w.storage.listPlanningProjections(w.workspace.id)).find((row) => row.entityId === identity.entityId)
  const member = (await w.storage.listMemberships(w.workspace.id, 'project-alpha')).find((row) => row.contentExternalId === 'pr-7')
  const facts = await w.record()
  const pr = facts.sets.find((set) => set.kind === 'change_request').nodes[0]
  assert.ok(pr, 'fixture 必须观察到 PR')
  assert.equal(pr.entityId, identity.entityId, 'Planning 与 Lineage 必须指向同一实体')
  assert.equal(projection.content.contentKind, 'change_request')
  assert.equal(member.contentKind, 'change_request')
  assert.equal(facts.sets.find((set) => set.kind === 'check_run').anchorId, identity.entityId, 'check anchor 必须收敛')
  assert.deepEqual(w.entities().map((row) => row.id), [identity.entityId], '只持久一个 ChangeRequest')
  assert.ok((await w.storage.listRelations(w.workspace.id)).some((edge) => edge.from === identity.entityId && edge.type === 'produced_by' && edge.state === 'candidate'))
  return identity.entityId
}

for (const label of ['Fake', 'SQLite']) for (const first of ['plan', 'lineage']) {
  test(`AC367 native PR converges (${label}, ${first} first)`, async (t) => {
    const w = await world(label, t)
    assert.notEqual(w.providers.planning.bindingId, w.providers.development.gate.bindingId)
    assert.notEqual(w.planning.definition.implementationKey, w.development.definition.implementationKey)
    assert.equal((await w[first]()).ok, true)
    await w.reopen()
    assert.equal((await w[first === 'plan' ? 'lineage' : 'plan']()).ok, true)
    const id = await assertConverged(w)
    assert.equal((await w.developmentIdentity()).entityId, id)
    assert.deepEqual((await w.storage.listIdentitiesForEntity(id)).map((row) => row.role).sort(), ['alias', 'primary'])
    const baseline = [w.entities(), await w.storage.listIdentitiesForEntity(id), await w.storage.currentRevision(w.workspace.id), await w.storage.listPlanningProjections(w.workspace.id)]
    w.control.developmentNative = undefined
    await w.reopen()
    for (let round = 0; round < 2; round++) {
      assert.equal((await w.plan()).ok, true)
      assert.equal((await w.lineage()).ok, true)
      assert.equal(await assertConverged(w), id)
    }
    assert.deepEqual([w.entities(), await w.storage.listIdentitiesForEntity(id), await w.storage.currentRevision(w.workspace.id), await w.storage.listPlanningProjections(w.workspace.id)], baseline, '重放不增实体/身份或业务 revision')
    const facts = await w.record()
    const relations = await w.storage.listRelations(w.workspace.id)
    await w.core.queries.getDeliveryProjection(w.scope)
    await w.core.queries.getDeliveryLineage(w.scope)
    assert.deepEqual(await w.record(), facts, '查询不写 facts')
    assert.deepEqual(await w.storage.listRelations(w.workspace.id), relations, '查询不写边')
  })
}

for (const label of ['Fake', 'SQLite']) {
  for (const [name, native, planningNative = NATIVE] of [['namespace', { ...NATIVE, namespace: 'other.example/graphql/PullRequest' }],
    ['opaque id', { ...NATIVE, id: `${NATIVE.id}-different` }],
    ['tuple boundaries', { namespace: 'service|object', id: 'id' }, { namespace: 'service', id: 'object|id' }],
    ['missing declaration', undefined]]) {
    test(`AC367 separates ${name} despite equal external id/URL/number (${label})`, async (t) => {
      const w = await world(label, t)
      w.control.developmentNative = native
      w.control.planningNative = planningNative
      if (native === undefined) w.control.planningNative = undefined
      assert.equal((await w.plan()).ok, true)
      assert.equal((await w.lineage()).ok, true)
      const pr = (await w.record()).sets.find((set) => set.kind === 'change_request').nodes[0]
      assert.notEqual(pr.entityId, (await w.identity()).entityId)
      assert.equal(w.entities().length, 2)
    })
  }

  test(`AC367 global entity with isolated memberships and one primary (${label})`, async (t) => {
    const a = await world(label, t)
    assert.equal((await a.plan()).ok, true)
    const b = await world(label, t, a.storage)
    assert.notEqual(a.accountId, b.accountId)
    assert.equal(await a.storage.getProviderBindingAccount(a.providers.planning.bindingId), a.accountId)
    assert.equal(await b.storage.getProviderBindingAccount(b.providers.planning.bindingId), b.accountId)
    assert.equal((await b.plan()).ok, true)
    assert.notEqual(a.providers.planning.bindingId, b.providers.planning.bindingId)
    const id = (await a.identity()).entityId
    assert.equal((await b.identity()).entityId, id, 'workspace 与连接账号不属于内容身份')
    assert.deepEqual((await a.storage.listIdentitiesForEntity(id)).map((row) => row.role).sort(), ['alias', 'primary'])
    for (const w of [a, b]) {
      const members = await w.storage.listMemberships(w.workspace.id, 'project-alpha')
      assert.equal(members.filter((row) => row.contentExternalId === 'pr-7').length, 1)
      assert.ok(members.every((row) => row.workspaceId === w.workspace.id))
      assert.ok((await w.storage.listPlanningProjections(w.workspace.id)).every((row) => row.workspaceId === w.workspace.id))
    }
    assert.equal(a.entities().length, 1)
  })

  for (const native of [null, {}, { namespace: '', id: 'x' }, { namespace: '  ', id: 'x' }, { namespace: NATIVE.namespace, id: '' }, { namespace: NATIVE.namespace, id: '  ' }, { namespace: NATIVE.namespace, id: 7 }]) {
    test(`AC367 rejects malformed declaration ${JSON.stringify(native)} (${label})`, async (t) => {
      const w = await world(label, t)
      const before = await w.storage.listPlanningProjections(w.workspace.id)
      w.control.planningNative = native
      const result = await w.plan()
      assert.deepEqual([result.ok, result.error?.code], [false, 'invalid_input'])
      assert.equal(await w.identity(), undefined)
      assert.deepEqual(await w.storage.listPlanningProjections(w.workspace.id), before)
      w.control.developmentNative = native
      const delivery = await w.core.commands.refreshDeliveryFacts(w.scope)
      assert.ok(delivery.gaps.some((gap) => gap.key === 'development.change_request.read'))
      assert.equal(w.entities().length, 0)
    })
  }

  test(`AC367 rejects changed native identity without migrating exact identity (${label})`, async (t) => {
    const w = await world(label, t)
    await w.plan()
    const identity = await w.identity()
    const before = await w.storage.listPlanningProjections(w.workspace.id)
    w.control.planningNative = { ...NATIVE, id: 'replacement' }
    const result = await w.plan()
    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'conflict')
    assert.deepEqual(await w.identity(), identity)
    assert.deepEqual(await w.storage.listPlanningProjections(w.workspace.id), before)
    assert.equal(w.entities().length, 1)
  })

  for (const [entry, methods] of [['plan', ['putEntity', 'putExternalIdentity']], ['lineage', ['putEntity', 'putExternalIdentity', 'putRelation', 'putDeliveryFacts']]]) {
    for (const method of methods) test(`AC367 rollback after ${entry}.${method} and retry (${label})`, async (t) => {
      const w = await world(label, t)
      const before = [await w.storage.listPlanningProjections(w.workspace.id), await w.storage.listMemberships(w.workspace.id, 'project-alpha'),
        await w.storage.listRelations(w.workspace.id), await w.storage.currentRevision(w.workspace.id)]
      const beforeFacts = await w.record()
      w.control.fault = method
      const result = await w[entry]()
      assert.equal(result.ok, false)
      assert.equal(await w.identity(), undefined)
      assert.equal(await w.developmentIdentity(), undefined, '事务回滚不得留下 Development 身份')
      assert.equal(w.entities().length, 0, '写后抛错也不得留下实体')
      assert.deepEqual([await w.storage.listPlanningProjections(w.workspace.id), await w.storage.listMemberships(w.workspace.id, 'project-alpha'),
        await w.storage.listRelations(w.workspace.id), await w.storage.currentRevision(w.workspace.id)], before, '整轮事务回滚')
      assert.deepEqual(await w.record(), beforeFacts, '失败不得留下部分 facts')
      w.control.fault = undefined
      await w.reopen(false)
      assert.equal(w.entities().length, 0, '重开确认失败事务没有落盘')
      await w.compose()
      assert.equal((await w.plan()).ok, true)
      assert.equal((await w.lineage()).ok, true)
      await assertConverged(w)
    })
  }
}

for (const label of ['Fake', 'SQLite']) for (const kind of ['issue', 'draft', 'project_item', 'redacted-pr']) {
  test(`AC367 rejects PR declaration on ${kind} (${label})`, async (t) => {
  const w = await world(label, t)
  const before = await w.storage.listPlanningProjections(w.workspace.id)
  const source = w.providers.planning.state.items.find((item) => item.ref.externalId === 'issue-1')
  source.ref = { ...source.ref, objectKind: kind === 'redacted-pr' ? 'change_request' : kind }
  if (kind === 'project_item' || kind === 'redacted-pr') source.content = { kind: 'redacted', reason: 'unavailable' }
  w.control.declarationOnOther = source.ref.externalId
  const result = await w.plan()
  assert.deepEqual([result.ok, result.error?.code], [false, 'invalid_input'])
  assert.deepEqual(await w.storage.listPlanningProjections(w.workspace.id), before)
  assert.equal(w.entities().length, 0)
  })
}

for (const label of ['Fake', 'SQLite']) test(`AC367 observed PR reader and persisted queries perform zero writes (${label})`, async (t) => {
  const w = await world(label, t)
  const context = await createContext({ workspace: w.workspace, storage: w.storage,
    providers: { planning: w.planning, development: w.development, delivery: w.providers.delivery, execution: w.providers.execution } })
  let writes = 0
  const readonly = new Proxy(w.storage, { get(object, key) {
    const value = Reflect.get(object, key, object)
    if (typeof value !== 'function') return value
    return /^(put|replace|advance|delete|transaction)/.test(String(key)) ? () => { writes++; throw new Error('read attempted write') } : value.bind(object)
  } })
  const facts = await readChainFacts({ ...context, storage: readonly }, w.scope)
  assert.equal(facts.changeRequest.observed, true)
  assert.equal((await w.storage.listIdentitiesForEntity(facts.changeRequest.id)).length, 0, 'reader 不登记 Development alias')
  assert.equal(w.entities().length, 0, 'reader 不持久实体')
  assert.equal(writes, 0)
  w.providers.development.state.changeRequests = []
  const skeleton = await readChainFacts({ ...context, storage: readonly }, w.scope)
  assert.equal(skeleton.changeRequest.observed, false)
  assert.equal(skeleton.changeRequest.externalId, undefined)
  assert.equal(w.entities().length, 0, '无观察骨架不得持久为 PR')
  w.providers.development.listBranches = w.providers.development.listChangeRequests = () => { throw new Error('query called provider') }
  await w.core.queries.getDeliveryProjection(w.scope)
  await w.core.queries.getDeliveryLineage(w.scope)
  assert.equal(writes, 0)
})

for (const label of ['Fake', 'SQLite']) test(`AC367 redacted membership without content identity creates no CR (${label})`, async (t) => {
  const w = await world(label, t)
  const source = w.providers.planning.state.items.find((item) => item.ref.objectKind === 'change_request')
  source.ref = { ...source.ref, objectKind: 'project_item', externalId: source.membership.externalId }
  source.content = { kind: 'redacted', reason: 'unavailable' }
  const result = await w.plan()
  assert.deepEqual([result.ok, result.unanchored], [true, 1])
  assert.equal(await w.identity(), undefined)
  assert.equal(w.entities().length, 0)
})

for (const label of ['Fake', 'SQLite']) test(`AC367 missing declaration preserves an exact registered native identity (${label})`, async (t) => {
  const w = await world(label, t)
  assert.equal((await w.plan()).ok, true)
  const identity = await w.identity()
  const before = [await w.storage.listPlanningProjections(w.workspace.id), await w.storage.currentRevision(w.workspace.id)]
  w.control.planningNative = undefined
  assert.equal((await w.plan()).ok, true)
  assert.deepEqual(await w.identity(), identity)
  assert.deepEqual([await w.storage.listPlanningProjections(w.workspace.id), await w.storage.currentRevision(w.workspace.id)], before)
  assert.equal(w.entities().length, 1)
})

for (const label of ['Fake', 'SQLite']) {
  test(`AC367 rejects explicit Development native identity conflict (${label})`, async (t) => {
    const w = await world(label, t)
    await w.plan(); await w.lineage()
    const id = await assertConverged(w)
    const before = await w.record()
    const identity = await w.developmentIdentity()
    w.control.developmentNative = { ...NATIVE, id: 'replacement' }
    const result = await w.core.commands.refreshDeliveryFacts(w.scope)
    assert.ok(result.gaps.some((gap) => gap.key === 'development.change_request.read'))
    for (const kind of ['change_request', 'check_run']) {
      const oldSet = before.sets.find((set) => set.kind === kind)
      assert.deepEqual((await w.record()).sets.find((set) => set.kind === kind), { ...oldSet, stale: true })
    }
    assert.deepEqual(await w.developmentIdentity(), identity)
    assert.deepEqual(w.entities().map((row) => row.id), [id])
  })

  for (const invalid of ['issue', 'draft', 'project_item', 'foreign-binding']) {
    test(`AC367 rejects Development ${invalid} reference without replacing known facts (${label})`, async (t) => {
      const w = await world(label, t)
      await w.plan(); await w.lineage()
      const before = await w.record()
      const identities = await w.storage.listIdentitiesForEntity((await w.identity()).entityId)
      const row = w.providers.development.state.changeRequests[0]
      row.ref = invalid === 'foreign-binding' ? { ...row.ref, bindingId: w.providers.planning.bindingId } : { ...row.ref, objectKind: invalid }
      const result = await w.core.commands.refreshDeliveryFacts(w.scope)
      assert.ok(result.gaps.some((gap) => gap.key === 'development.change_request.read'))
      for (const kind of ['change_request', 'check_run']) {
        assert.deepEqual((await w.record()).sets.find((set) => set.kind === kind), { ...before.sets.find((set) => set.kind === kind), stale: true })
      }
      assert.equal(w.entities().length, 1)
      assert.deepEqual(await w.storage.listIdentitiesForEntity((await w.identity()).entityId), identities)
    })
  }

  test(`AC367 revalidates Development identity inside the Delivery transaction (${label})`, async (t) => {
    const w = await world(label, t)
    await w.plan()
    const before = await w.record()
    const find = w.storage.findExternalIdentity.bind(w.storage)
    w.storage.findExternalIdentity = async (...args) => {
      const value = await find(...args)
      if (args[1] === 'change_request' && args[2] === 'pr-7') { w.storage.findExternalIdentity = find; w.control.beforeTransaction = inject }
      return value
    }
    const inject = () => w.storage.transaction(async (tx) => {
      await tx.putEntity({ id: 'concurrent-pr', kind: 'change_request' })
      await tx.putExternalIdentity({ id: 'concurrent-identity', entityId: 'concurrent-pr', bindingId: w.providers.development.gate.bindingId,
        externalKind: 'change_request', externalId: 'pr-7', role: 'primary' })
    })
    const result = await w.core.commands.refreshDeliveryFacts(w.scope)
    assert.deepEqual([result.ok, result.error?.code], [false, 'conflict'])
    assert.equal((await w.developmentIdentity()).entityId, 'concurrent-pr')
    assert.deepEqual(await w.record(), before)
    assert.ok(!(await w.storage.listRelations(w.workspace.id)).some((edge) => edge.type === 'produced_by'))
  })
}
