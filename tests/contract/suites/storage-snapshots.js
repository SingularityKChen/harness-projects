/** 普通端口快照、排队输入捕获与事务作用域：两个适配器共用行为断言。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { seedExecutionPrereqs } from './storage-execution.js'
import { WORKSPACE, workspace, developmentBinding, membership, fieldValue, projection, observation } from './storage-fixtures.js'
import { account, policy } from './storage-connector-account.js'

const context = { id: 'ctx-snapshot', workspaceId: WORKSPACE, workItemId: 'entity-1', repositoryId: 'repo-1', status: 'ready', branchExternalId: 'branch', worktreeExternalId: undefined, provisioningStartedAt: undefined }
const identity = { id: 'identity-snapshot', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' }
const facts = { workspaceId: WORKSPACE, contextId: context.id, attemptedAt: '2026-11-10T00:00:00Z', sets: [{ kind: 'commit', anchorId: 'entity-1', confirmedAt: undefined, stale: false, nodes: [{ entityId: 'entity-2', externalId: 'commit-1', label: 'original', fact: undefined }] }] }
const attempt = { id: 'attempt-1', workspaceId: WORKSPACE, bindingId: 'binding-1', commandName: 'startWork', idempotencyKey: 'key-1', state: 'pending', requestFingerprint: 'fingerprint', expectedSourceVersion: undefined, errorCode: undefined,
  externalIntent: { operation: 'createBranch', contextId: context.id, ownerGeneration: 1, bindingId: 'binding-1', state: 'pending', input: { repository: { bindingId: 'binding-1', objectKind: 'repository', externalId: 'repo-1', url: undefined }, name: 'original', fromRef: 'main' } } }
const assigneeAttempt = { ...attempt, id: 'assignee-attempt', commandName: 'addChangeRequestAssignees', idempotencyKey: 'assignee-key', externalIntent: {
  operation: 'addChangeRequestAssignees', sequence: 1, createOperationId: 'create', createReceipt: 'receipt', targetStamp: 'stamp', contextId: context.id, ownerGeneration: 1, bindingId: 'binding-1', state: 'pending', worktree: 'worktree',
  input: { repository: { bindingId: 'binding-1', objectKind: 'repository', externalId: 'repo-1' }, changeRequest: { bindingId: 'binding-1', objectKind: 'change_request', externalId: 'pr-1' }, assigneeIds: ['U_1'] }, confirmedIds: [] } }
const mapping = { workspaceId: WORKSPACE, bindingId: 'binding-1', projectExternalId: 'project-1', origin: 'user', mapping: { status: { projectFieldId: 'status', options: { done: 'done' } } } }
const ref = { workspaceId: WORKSPACE, bindingId: 'binding-config', domain: 'development' }
// 每行给出真实写入、可观察读口与会破坏业务值的修改；同一矩阵也验证 list 成员。
const cases = [
  ['workspace', workspace(), (s, v) => s.putWorkspace(v), (s) => s.getWorkspace(WORKSPACE), (v) => { v.name = 'changed' }],
  ['binding', developmentBinding('binding-2'), (s, v) => s.putProviderBinding(v), (s) => s.listProviderBindings(WORKSPACE), (v) => { v.enabled = false }],
  ['identity', identity, (s, v) => s.putExternalIdentity(v), (s) => s.findExternalIdentity('binding-1', 'issue', 'issue-1'), (v) => { v.externalId = 'changed' }, (s) => s.listIdentitiesForEntity('entity-1')],
  ['membership', membership(), (s, v) => s.putMembership(v), (s) => s.getMembership(WORKSPACE, 'item-1'), (v) => { v.membershipUpdatedAt = 'changed' }, (s) => s.listMemberships(WORKSPACE, 'project-1')],
  ['field', fieldValue(), (s, v) => s.putFieldValue(v), (s) => s.listFieldValues(WORKSPACE, 'item-1'), (v) => { v.value = 'changed' }],
  ['projection', projection, (s, v) => s.putPlanningProjection(WORKSPACE, v), (s) => s.getPlanningProjection(WORKSPACE, 'entity-1'), (v) => { v.content.title = 'changed' }, (s) => s.listPlanningProjections(WORKSPACE)],
  ['repository', { id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-1' }, (s, v) => s.putRepository(v), (s) => s.listRepositories(WORKSPACE), (v) => { v.id = 'changed' }],
  ['context', context, (s, v) => s.putExecutionContext(v), (s) => s.getExecutionContext(context.id), (v) => { v.branchExternalId = 'changed' }, (s) => s.findActiveExecutionContext(WORKSPACE, 'entity-1', 'repo-1')],
  ['run', { id: 'run-1', workspaceId: WORKSPACE, contextId: context.id, status: 'running', updatedAt: 'now', providerRef: { bindingId: 'binding-1', objectKind: 'execution_run', externalId: 'run-1' } }, (s, v) => s.putExecutionRun(v), (s) => s.getExecutionRun('run-1'), (v) => { v.providerRef.externalId = 'changed' }],
  ['relation', { from: 'entity-1', to: 'entity-2', type: 'implements', class: 'system_fact', state: 'confirmed', source: 'explicit' }, (s, v) => s.putRelation(WORKSPACE, v), (s) => s.listRelations(WORKSPACE), (v) => { v.to = 'changed' }],
  ['delivery', facts, (s, v) => s.putDeliveryFacts(v), (s) => s.getDeliveryFacts(WORKSPACE, context.id), (v) => { v.sets[0].nodes[0].label = 'changed' }],
  ['cursor', { workspaceId: WORKSPACE, bindingId: 'binding-1', scopeKey: 'scope', cursorValue: 'original', state: 'healthy', lastErrorCode: undefined }, (s, v) => s.putSyncCursor(v), (s) => s.getSyncCursor(WORKSPACE, 'binding-1', 'scope'), (v) => { v.cursorValue = 'changed' }],
  ['round', { workspaceId: WORKSPACE, bindingId: 'binding-1', scopeKey: 'scope', latestStartedRound: 1, latestCommittedRound: 1 }, (s, v) => s.putPlanningSyncRound(v), (s) => s.getPlanningSyncRound(WORKSPACE, 'binding-1', 'scope'), (v) => { v.latestStartedRound = 2 }],
  ['reconcile', { workspaceId: WORKSPACE, lastReconciledAt: 'original' }, (s, v) => s.putReconcileCursor(v), (s) => s.getReconcileCursor(WORKSPACE), (v) => { v.lastReconciledAt = 'changed' }],
  ['attempt', attempt, (s, v) => s.putMutationAttempt(v), (s) => s.findMutationAttempt(WORKSPACE, 'key-1'), (v) => { v.externalIntent.input.name = 'changed' }, (s) => s.listMutationAttempts(WORKSPACE)],
  ['assignee-intent', assigneeAttempt, (s, v) => s.putMutationAttempt(v), (s) => s.findMutationAttempt(WORKSPACE, 'assignee-key'), (v) => { v.externalIntent.input.assigneeIds.push('U_2') }],
  ['mapping', mapping, (s, v) => s.putWorkspacePlanningMapping(v), (s) => s.getWorkspacePlanningMapping(WORKSPACE), (v) => { v.mapping.status.options.done = 'changed' }],
  ['account', account(), (s, v) => s.putConnectorAccount(v), (s) => s.getConnectorAccount('account-1'), (v) => { v.displayName = 'changed' }, (s) => s.listConnectorAccounts()],
  ['configuration', { ref, configuration: { scope: 'workspace', label: 'before' } }, (s, v) => s.putBindingConfiguration(v), (s) => s.getBindingConfiguration(ref), (v) => { v.configuration.label = 'after' }],
  ['replace-memberships', { scope: { workspaceId: WORKSPACE, projectExternalId: 'project-1' }, items: [membership()] }, (s, v) => s.replacePlanningMemberships(v.scope, v.items), (s) => s.listMemberships(WORKSPACE, 'project-1'), (v) => { v.scope.workspaceId = 'changed'; v.items[0].membershipUpdatedAt = 'changed'; v.items.push(membership({ itemExternalId: 'injected' })) }],
  ['replace-projections', { scope: { workspaceId: WORKSPACE, bindingId: 'binding-1' }, items: [projection] }, (s, v) => s.replacePlanningProjections(v.scope, v.items), (s) => s.listPlanningProjections(WORKSPACE), (v) => { v.scope.workspaceId = 'changed'; v.items[0].content.title = 'changed'; v.items.length = 0 }],
]
async function seed(storage) {
  await seedExecutionPrereqs(storage); await storage.putExternalIdentity(identity); await storage.putExecutionContext(context); await storage.putMembership(membership())
  await storage.putProviderBinding({ ...developmentBinding('binding-config'), implementationKey: 'harness.fake' })
}
function corrupt(value) {
  if (Array.isArray(value)) { for (const item of value) corrupt(item); value.length = 0 }
  else if (value && typeof value === 'object') for (const key of Object.keys(value)) {
    if (typeof value[key] === 'object') corrupt(value[key]); else value[key] = 'changed'
  }
}
export function storageSnapshotSuite({ label, makeStorage }, register = test) {
  for (const [name, template, put, read, change, list] of cases) {
    register(`${label}：快照 ${name} 输入与 get/list 成员隔离`, async (t) => {
      const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
      const input = structuredClone(template); await put(storage, input)
      const expected = structuredClone(await read(storage)), fence = storage.committedReadFence()
      change(input); assert.deepEqual(await read(storage), expected, 'put 完成后调用方改入参不得改写事实')
      const output = await read(storage); corrupt(output); assert.deepEqual(await read(storage), expected, 'get/list 成员必须深拷贝')
      if (list) { const before = structuredClone(await list(storage)); corrupt(await list(storage)); assert.deepEqual(await list(storage), before) }
      assert.equal(storage.committedReadFence(), fence); assert.equal(await storage.currentRevision(WORKSPACE), 0)
    })
    register(`${label}：排队快照 ${name} 在入队前捕获`, async (t) => {
      const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
      const original = structuredClone(template); await put(storage, original); const expected = structuredClone(await read(storage))
      let release, mark; const gate = new Promise((r) => { release = r }), entered = new Promise((r) => { mark = r })
      const blocker = storage.transaction(async () => { mark(); await gate }); await entered
      const input = structuredClone(template), pending = put(storage, input); change(input); release()
      await blocker; await pending; assert.deepEqual(await read(storage), expected, '等候事务期间改入参不得影响随后提交')
      assert.equal(await storage.currentRevision(WORKSPACE), 0)
    })
  }
  register(`${label}：观察与实体在入队前捕获，已提交入参不留别名`, async (t) => {
    const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
    const entity = { id: 'captured-entity', kind: 'work_item' }, event = observation('captured-observation')
    const entityWrite = storage.putEntity(entity), eventWrite = storage.recordObservation(event)
    entity.id = 'changed'; event.observation.dedupeKey = 'changed'; event.observation.subject.externalId = 'changed'
    await entityWrite; assert.equal(await eventWrite, true)
    await storage.putExternalIdentity({ ...identity, id: 'captured-identity', externalId: 'captured-issue', entityId: 'captured-entity' })
    assert.equal((await storage.findExternalIdentity('binding-1', 'issue', 'captured-issue')).entityId, 'captured-entity')
    assert.equal(await storage.recordObservation(observation('captured-observation')), false, '观察的去重键捕获时点与持久事实一致')
    event.observation.sourceVersion = '2026-09-19T00:00:00.000000000Z'
    assert.equal(await storage.recordObservation(observation('older-observation', 'pending', { sourceVersion: '2026-09-19T12:00:00.000000000Z' })), false, '完成后修改观察入参不得倒退已提交版本')
  })
  register(`${label}：配置复制前拒绝原始非法容器且不推进 fence`, async (t) => {
    const p = policy(); p.configurations.set('optional', {})
    const storage = makeStorage(p); t.after(() => storage.close?.()); await seed(storage)
    const optional = { ...ref, bindingId: 'optional' }
    await storage.putProviderBinding({ ...developmentBinding('optional'), implementationKey: 'optional' })
    await storage.putBindingConfiguration({ ref, configuration: { scope: 'workspace' } })
    const before = await storage.getBindingConfiguration(ref), fence = storage.committedReadFence()
    for (const configuration of [Object.assign(new Date(), { scope: 'workspace' }), Object.assign(Object.create({}), { scope: 'workspace' }), Object.defineProperty({ scope: 'workspace' }, Symbol('forbidden'), { value: true })]) {
      await assert.rejects(storage.putBindingConfiguration({ ref, configuration }), /plain object/)
      assert.deepEqual(await storage.getBindingConfiguration(ref), before); assert.equal(storage.committedReadFence(), fence)
    }
    for (const configuration of [null, []]) {
      await assert.rejects(storage.putBindingConfiguration({ ref: optional, configuration }), /plain object/)
      assert.equal(await storage.getBindingConfiguration(optional), undefined); assert.equal(storage.committedReadFence(), fence)
    }
  })
  register(`${label}：复制不抹去原本应拒的非枚举约束字段`, async (t) => {
    const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
    const hidden = (record, key, value) => Object.defineProperty(record, key, { value, enumerable: false })
    const invalidContext = hidden({ ...context }, 'provisioningGeneration', 0)
    const invalidRound = hidden({ workspaceId: WORKSPACE, bindingId: 'binding-1', scopeKey: 'hidden', latestStartedRound: 1 }, 'latestCommittedRound', 0)
    const invalidObservation = observation('hidden'); hidden(invalidObservation.observation, 'sourceVersion', '')
    const invalidBinding = hidden({ ...developmentBinding('hidden'), enabled: false }, 'isDefault', true)
    const invalidAttempt = structuredClone(assigneeAttempt); Object.defineProperty(invalidAttempt.externalIntent, Symbol('forbidden'), { value: true }); hidden(invalidAttempt, 'externalIntent', invalidAttempt.externalIntent)
    const fence = storage.committedReadFence(), outcomes = []
    for (const call of [() => storage.putExecutionContext(invalidContext), () => storage.putPlanningSyncRound(invalidRound), () => storage.recordObservation(invalidObservation), () => storage.putProviderBinding(invalidBinding), () => storage.putMutationAttempt(invalidAttempt)]) outcomes.push(await call().then(() => false, () => true))
    assert.deepEqual(outcomes, [true, true, true, true, true]); assert.equal(storage.committedReadFence(), fence)
    assert.deepEqual(await storage.getExecutionContext(context.id), context); assert.equal(await storage.getPlanningSyncRound(WORKSPACE, 'binding-1', 'hidden'), undefined)
    assert.equal((await storage.listProviderBindings(WORKSPACE)).some((v) => v.id === 'hidden'), false); assert.equal(await storage.findMutationAttempt(WORKSPACE, 'assignee-key'), undefined)
    await storage.putExecutionContext(hidden({ ...context }, 'provisioningGeneration', 2)); assert.equal((await storage.getExecutionContext(context.id)).provisioningGeneration, 2)
    await storage.putPlanningSyncRound(hidden({ workspaceId: WORKSPACE, bindingId: 'binding-1', scopeKey: 'hidden', latestStartedRound: 1 }, 'latestCommittedRound', 1)); assert.equal((await storage.getPlanningSyncRound(WORKSPACE, 'binding-1', 'hidden')).latestCommittedRound, 1)
    const validObservation = observation('hidden-valid'); hidden(validObservation.observation, 'sourceVersion', '2026-09-20T00:00:00.000000000Z'); assert.equal(await storage.recordObservation(validObservation), true)
    await storage.putProviderBinding(hidden(developmentBinding('hidden-valid'), 'isDefault', true)); assert.equal((await storage.listProviderBindings(WORKSPACE)).find((v) => v.id === 'hidden-valid').isDefault, true)
    const validAttempt = structuredClone(assigneeAttempt); hidden(validAttempt, 'externalIntent', validAttempt.externalIntent); await storage.putMutationAttempt(validAttempt); assert.deepEqual((await storage.findMutationAttempt(WORKSPACE, 'assignee-key')).externalIntent.input.assigneeIds, ['U_1'])
  })
  register(`${label}：合法配置保留自身非枚举字段并支持尚未提交的挂载`, async (t) => {
    const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
    const queuedRef = { ...ref, bindingId: 'queued-config' }, configuration = Object.create(null)
    Object.defineProperty(configuration, 'scope', { value: 'workspace', writable: true })
    const bindingWrite = storage.putProviderBinding({ ...developmentBinding('queued-config'), implementationKey: 'harness.fake' })
    const configWrite = storage.putBindingConfiguration({ ref: queuedRef, configuration }); configuration.scope = 'project'
    await bindingWrite; await configWrite
    assert.deepEqual((await storage.getBindingConfiguration(queuedRef)).configuration, { scope: 'workspace' })
  })
  register(`${label}：intent 原始符号闭集在复制前拒绝且保留旧收据`, async (t) => {
    const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
    await storage.putMutationAttempt(structuredClone(assigneeAttempt))
    const before = await storage.findMutationAttempt(WORKSPACE, 'assignee-key'), fence = storage.committedReadFence()
    const invalid = structuredClone(assigneeAttempt); Object.defineProperty(invalid.externalIntent, Symbol('forbidden'), { value: true })
    await assert.rejects(storage.putMutationAttempt(invalid), /invalid Start Work external intent/)
    assert.deepEqual(await storage.findMutationAttempt(WORKSPACE, 'assignee-key'), before); assert.equal(storage.committedReadFence(), fence)
  })
  register(`${label}：事务内的配置读取在调用时捕获 ref`, async (t) => {
    const storage = makeStorage(policy()); t.after(() => storage.close?.()); await seed(storage)
    await storage.putBindingConfiguration({ ref, configuration: { scope: 'workspace' } })
    await storage.transaction(async (tx) => {
      const query = { ...ref }, pending = tx.getBindingConfiguration(query); query.bindingId = 'changed'
      assert.deepEqual((await pending)?.configuration, { scope: 'workspace' })
    })
  })
  for (const rollback of [false, true]) register(`${label}：事务${rollback ? '回滚' : '提交'}后旧 tx 读写拒绝且不推进 fence`, async (t) => {
    const storage = makeStorage(); t.after(() => storage.close?.()); await storage.putWorkspace(workspace()); let leaked
    const operation = storage.transaction(async (tx) => { leaked = tx; await tx.putWorkspace(workspace(WORKSPACE, 'committed')); await tx.advanceRevision(WORKSPACE); if (rollback) throw Error('rollback') })
    if (rollback) await assert.rejects(operation, /rollback/); else await operation
    const fence = storage.committedReadFence(), before = await storage.getWorkspace(WORKSPACE), revision = await storage.currentRevision(WORKSPACE)
    for (const call of [() => leaked.getWorkspace(WORKSPACE), () => leaked.listProviderBindings(WORKSPACE), () => leaked.currentRevision(WORKSPACE), () => leaked.putWorkspace(workspace(WORKSPACE, 'escaped')), () => leaked.advanceRevision(WORKSPACE)]) await assert.rejects(call(), /事务作用域已结算/)
    assert.deepEqual(await storage.getWorkspace(WORKSPACE), before); assert.equal(await storage.currentRevision(WORKSPACE), revision); assert.equal(storage.committedReadFence(), fence)
    await storage.transaction((tx) => tx.putWorkspace(workspace(WORKSPACE, 'next'))); assert.equal((await storage.getWorkspace(WORKSPACE)).name, 'next')
  })
  register(`${label}：事务执行时再查 token 拒绝漏 await 的迟到写入`, async (t) => {
    const storage = makeStorage(); t.after(() => storage.close?.()); let escaped, escapedRead
    const fence = storage.committedReadFence()
    await assert.rejects(storage.transaction(async (tx) => { escaped = (async () => { await null; return tx.putWorkspace(workspace('escaped')) })(); escapedRead = (async () => { await null; return tx.getWorkspace('escaped') })(); throw Error('rollback') }), /rollback/)
    await assert.rejects(escaped, /事务作用域已结算/); await assert.rejects(escapedRead, /事务作用域已结算/)
    assert.equal(await storage.getWorkspace('escaped'), undefined); assert.equal(storage.committedReadFence(), fence)
  })
}
