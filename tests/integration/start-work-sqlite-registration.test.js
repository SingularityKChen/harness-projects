/**
 * Start Work 在 SQLite 上的前置登记（#187 / #188）：同一个入口（`composeCore` + `commands.startWork`）在替身 Storage 与真实 SQLite 文件上各跑一遍。
 * 看护的不变量：外部写入之前，仓库挂载、canonical 身份、context 与 reserved worktree 实体已经提交；不合格的请求在任何写入之前被结构化拒绝；
 * 写前事务失败整笔回滚、零外部写入；ack 之后 Ready、关系与 Git 的 attempt 在同一个事务里同生共死，本地写失败是 Unknown 而不是半提交；残缺的 Ready（run 缺失或状态未知、必需边缺失）在重放与 Query 上都不报健康。断言业务结果（外部增量、context 对应的 run、边与 attempt），SQL 的 FK=[] 不当作闭环证据。
 * 失败注入走测试侧的 Storage 包装，每个注入点都有命中计数与无故障正控；不用 SQLite TRIGGER（`RAISE(ABORT)` 的回滚会把触发器自己写的命中记录一并回滚）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { composeCore, contextIdFor, runIdFor, worktreeEntityId } from '@harness-projects/core'
import { AccessLevel, newWorkspaceId } from '@harness-projects/domain'
import { FaultKind, createFakeProviders, exportFakeStorageState, providerFail } from '@harness-projects/provider-fake'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'

import { LEASE_EXPIRED_MS, controllableClock, registerWorkItem } from './local-git-fixture.js'

const dir = mkdtempSync(join(tmpdir(), 'start-work-sqlite-registration-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
const ADAPTERS = [['替身 Storage', (providers) => providers.storage], ['SQLite Storage', () => createSqliteStorage(join(dir, `w-${files++}.sqlite`))]]
const REQUEST = { repositoryId: 'repo-alpha', actor: { kind: 'agent' } }

async function setup(makeStorage, { policy, clock } = {}) {
  const providers = createFakeProviders()
  const workspaceId = newWorkspaceId()
  const storage = makeStorage(providers)
  const core = await composeCore({ workspace: { id: workspaceId, name: 'B-1' }, providers, storage, policy, clock })
  const items = await core.queries.listPlanningItems()
  const pick = (contentKind) => items.find((view) => view.content.contentKind === contentKind).entityId
  return { providers, storage, core, workspaceId, pick, bindingId: providers.development.gate.bindingId }
}
const start = (core, workItemId, key, overrides = {}) => core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: key, ...overrides })
const external = (p) => [p.development.state.branches.length, p.development.state.worktrees.length, p.execution.state.runs.length]
/** 端口没有按种类列实体的方法：SQLite 开第二个连接旁路读，替身读导出的内部状态。 */
function rawOf(storage) {
  if (storage.location === undefined) return { entities: exportFakeStorageState(storage).entities, fk: [] }
  const db = openDatabase(storage.location)
  try { return { entities: db.prepare('SELECT id, kind FROM entity ORDER BY id').all().map((row) => ({ ...row })), fk: db.prepare('PRAGMA foreign_key_check').all() } } finally { db.close() }
}
/** 外部增量与本地状态的快照：挂载、context、关系、attempt、实体全在里面，前后相等即零写入。 */
const world = async (p, s, ws, contextId) => JSON.stringify([external(p), await s.listRepositories(ws), await s.getExecutionContext(contextId), await s.getExecutionRun(runIdFor(contextId)), await s.listRelations(ws), await s.listMutationAttempts(ws), rawOf(s).entities])
/** 在 `method` 第 nth 次写之后抛错；nth 为 0 时从不触发，只计数（无故障正控）。同时包根方法（根上的写不在事务里，抛错时已落库）与 `transaction` 的 tx 代理（抛错时整笔回滚），共用一个命中计数。 */
function injectAfterWrite(storage, method, nth) {
  const hits = { calls: 0, thrown: 0 }
  const counted = (target, write) => async (...args) => {
    const out = await write.apply(target, args)
    hits.calls += 1
    if (hits.calls === nth) { hits.thrown += 1; throw new Error('注入的写后失败') }
    return out
  }
  storage[method] = counted(storage, storage[method])
  const original = storage.transaction.bind(storage)
  storage.transaction = (work) => original((tx) => work(new Proxy(tx, {
    get(target, key) {
      const value = Reflect.get(target, key, target)
      if (key !== method) return typeof value === 'function' ? value.bind(target) : value
      return counted(target, value)
    },
  })))
  return hits
}
/** 第 nth 次写不进去（抛错且不落库），其余原样透传；nth 为 0 时只计数（无故障正控）。与 injectAfterWrite 的区别：这里本地事实确实缺失。 */
function injectLostWrite(storage, method, nth) {
  const hits = { calls: 0, thrown: 0 }; const write = storage[method].bind(storage)
  storage[method] = async (...args) => { hits.calls += 1; if (hits.calls === nth) { hits.thrown += 1; throw new Error('注入的写失败') } return write(...args) }
  return hits
}
/** 事务里写入的 `type` 关系被静默丢掉（不抛错、不落库），或降成候选：写入方以为成功，只留下缺口——历史残缺的 Ready 的真实成因。 */
function dropRelation(storage, type, candidate = false) {
  const original = storage.transaction.bind(storage)
  storage.transaction = (work) => original((tx) => work(new Proxy(tx, { get(target, key) {
    const value = Reflect.get(target, key, target)
    return key === 'putRelation' ? async (workspaceId, relation) => { if (relation.type !== type) await value.call(target, workspaceId, relation); else if (candidate) await value.call(target, workspaceId, { ...relation, source: 'deterministic', state: 'candidate' }) } : typeof value === 'function' ? value.bind(target) : value
  } })))
}

for (const [label, makeStorage] of ADAPTERS) {
  test(`${label}：空仓库集合上开始工作——外部写入之前父行已提交；挂载、实体、两条 confirmed 关系、attempt 与 context 对应的 run 一次到位`, async () => {
    const { providers, storage, core, workspaceId: ws, pick, bindingId } = await setup(makeStorage)
    const workItemId = pick('work_item'); const contextId = contextIdFor(ws, workItemId, REQUEST.repositoryId)
    const worktreeId = worktreeEntityId(ws, REQUEST.repositoryId, workItemId)
    let reads = 0; const getRepository = providers.development.getRepository.bind(providers.development)
    providers.development.getRepository = (ref) => { reads += 1; return getRepository(ref) }
    const seen = []; const createBranch = providers.development.createBranch.bind(providers.development)
    providers.development.createBranch = async (input) => {
      const kinds = Object.fromEntries(rawOf(storage).entities.map((e) => [e.id, e.kind]))
      seen.push({ mounts: await storage.listRepositories(ws), context: await storage.getExecutionContext(contextId), kinds })
      return createBranch(input)
    }
    const before = external(providers)
    const result = await start(core, workItemId, 'first')
    assert.equal(seen.length, 1, '分支创建被调用恰好一次')
    assert.deepEqual(seen[0].mounts.map((m) => m.id), [REQUEST.repositoryId], '写前：外部写入时挂载已提交')
    assert.equal(seen[0].context?.status, 'provisioning'); assert.ok(seen[0].context.provisioningStartedAt, '写前：Provisioning 上下文带租约')
    assert.deepEqual([seen[0].kinds[contextId], seen[0].kinds[worktreeId]], ['execution_context', 'worktree'], '写前：关系端点的实体已登记')
    assert.deepEqual([result.status, result.writeState, result.confirmed, result.error], ['ready', 'saved', true, undefined])
    assert.deepEqual(external(providers).map((n, i) => n - before[i]), [1, 1, 1], '分支、工作树、运行各恰好新增一个')
    assert.ok(reads >= 1, 'ack 必须真的问过 provider')
    const identity = await storage.findExternalIdentity(bindingId, 'repository', REQUEST.repositoryId)
    assert.equal(identity?.role, 'primary', '仓库的 canonical 身份已登记，角色是 primary')
    assert.deepEqual((await storage.listRepositories(ws)).map((m) => [m.id, m.externalIdentityId]), [[REQUEST.repositoryId, identity.id]], '挂载引用 canonical 身份')
    const raw = rawOf(storage); const kinds = Object.fromEntries(raw.entities.map((e) => [e.id, e.kind]))
    assert.deepEqual([kinds[identity.entityId], kinds[contextId], kinds[worktreeId]], ['repository', 'execution_context', 'worktree'])
    assert.deepEqual((await storage.listRelations(ws)).map((r) => `${r.from}|${r.type}|${r.to}|${r.state}`).sort(),
      [`${workItemId}|tracks|${contextId}|confirmed`, `${contextId}|has_worktree|${worktreeId}|confirmed`].sort())
    assert.equal((await storage.findMutationAttempt(ws, 'first'))?.state, 'saved')
    const run = await storage.getExecutionRun(runIdFor(contextId))
    assert.deepEqual([run?.status, run?.providerRef?.externalId], ['running', result.runExternalId], 'context 对应的 run 已记录并引用 provider 的 run')
    assert.deepEqual(raw.fk, [], 'SQLite 的外键完整（只是必要条件，不证明业务闭环）')
  })

  test(`${label}：工作项守卫——未知、别的工作区、变更请求、被扣下的条目在任何写入之前被拒绝，有效工作项仍可开始`, async () => {
    const { providers, storage, core, workspaceId: ws, pick } = await setup(makeStorage)
    await storage.putWorkspace({ id: 'ws-other', name: '另一个工作区', statusPolicy: 'provider_authoritative' })
    await registerWorkItem(storage, 'ws-other', 'other-item')
    for (const [workItemId, code] of [['no-such-item', 'not_found'], ['other-item', 'not_found'], [pick('change_request'), 'invalid_input'], [pick('redacted'), 'unavailable']]) {
      const contextId = contextIdFor(ws, workItemId, REQUEST.repositoryId); const before = await world(providers, storage, ws, contextId)
      const result = await start(core, workItemId, `guard-${workItemId}`)
      assert.deepEqual([result.writeState, result.executionContextId, result.error?.code], ['failed', undefined, code], workItemId)
      assert.equal(await world(providers, storage, ws, contextId), before, `${workItemId}：零外部写入、零本地新增`)
    }
    assert.equal((await start(core, pick('work_item'), 'guard-ok')).status, 'ready', '正控：有效工作项必须能开始，否则「一律拒绝」也能通过上面的断言')
  })

  const forged = (field) => (p) => {
    const real = p.development.getRepository.bind(p.development)
    p.development.getRepository = async (ref) => { const found = await real(ref); return found.ok ? { ...found, value: { ...found.value, ref: { ...found.value.ref, [field]: `${found.value.ref[field]}-forged` } } } : found }
  }
  const denied = (key, level) => ({ policy: { [key]: level }, code: level === AccessLevel.ReadOnly ? 'permission_denied' : 'not_supported', ack: false })
  const REJECTIONS = [
    ['仓库不存在', { code: 'not_found', ack: true, request: { repositoryId: 'no-such-repo' } }],
    ['仓库读无权限', { code: 'permission_denied', ack: true, tamper: (p) => p.development.faultsSwitch.set(FaultKind.PermissionDenied, true) }],
    ...['bindingId', 'objectKind', 'externalId'].map((field) => [`ack 回显的 ${field} 不符`, { code: 'conflict', ack: true, tamper: forged(field) }]),
    ['仓库读能力不可用', denied(CapabilityKey.DevelopmentRepositoryRead, AccessLevel.Unavailable)],
    ['工作树读能力不可用', denied(CapabilityKey.DevelopmentWorktreeRead, AccessLevel.Unavailable)],
    ['工作树创建只读', denied(CapabilityKey.DevelopmentWorktreeCreate, AccessLevel.ReadOnly)],
    ['分支创建只读', denied(CapabilityKey.DevelopmentBranchCreate, AccessLevel.ReadOnly)],
    ['分支创建不可用', denied(CapabilityKey.DevelopmentBranchCreate, AccessLevel.Unavailable)],
  ]
  test(`${label}：ack 与能力门——仓库读失败、回显不符、能力缺失都在任何写入之前结构化失败，且新请求不落 Failed 上下文`, async () => {
    for (const [name, row] of REJECTIONS) {
      const { providers, storage, core, workspaceId: ws, pick } = await setup(makeStorage, { policy: row.policy })
      let reads = 0; const getRepository = providers.development.getRepository.bind(providers.development)
      providers.development.getRepository = (ref) => { reads += 1; return getRepository(ref) }
      row.tamper?.(providers)
      const repositoryId = row.request?.repositoryId ?? REQUEST.repositoryId; const workItemId = pick('work_item')
      const contextId = contextIdFor(ws, workItemId, repositoryId); const before = await world(providers, storage, ws, contextId)
      const result = await start(core, workItemId, `reject-${name}`, { repositoryId })
      assert.deepEqual([result.writeState, result.error?.code], ['failed', row.code], name)
      assert.equal(reads > 0, row.ack, `${name}：能力门先于 ack，ack 行必须真的问过 provider`)
      assert.equal(await world(providers, storage, ws, contextId), before, `${name}：零外部写入、零本地行`)
    }
  })

  test(`${label}：只读的读能力（仓库读、工作树读）不挡开始工作`, async () => {
    for (const key of [CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentWorktreeRead]) {
      const { core, pick } = await setup(makeStorage, { policy: { [key]: AccessLevel.ReadOnly } })
      assert.equal((await start(core, pick('work_item'), `ro-${key}`)).status, 'ready', key)
    }
  })

  test(`${label}：挂载冲突预检——同工作区同 id 已挂在别的外部身份上，结构化 conflict、原挂载不变、零外部写入`, async () => {
    const { providers, storage, core, workspaceId, pick } = await setup(makeStorage)
    await storage.putProviderBinding({ id: 'binding-other', workspaceId, domain: 'development', implementationKey: 'other', enabled: false, isDefault: false })
    await storage.putEntity({ id: 'repo-entity-x', kind: 'repository' })
    await storage.putExternalIdentity({ id: 'repo-identity-x', entityId: 'repo-entity-x', bindingId: 'binding-other', externalKind: 'repository', externalId: REQUEST.repositoryId, role: 'primary' })
    const mount = { id: REQUEST.repositoryId, workspaceId, externalIdentityId: 'repo-identity-x' }
    await storage.putRepository(mount)
    const workItemId = pick('work_item'); const contextId = contextIdFor(workspaceId, workItemId, REQUEST.repositoryId); const before = await world(providers, storage, workspaceId, contextId)
    const result = await start(core, workItemId, 'conflict')
    assert.equal(result.error?.code, 'conflict')
    assert.deepEqual(await storage.listRepositories(workspaceId), [mount], '原挂载不变')
    assert.equal(await world(providers, storage, workspaceId, contextId), before, '零外部写入、零本地新增')
  })

  test(`${label}：写前事务中途失败——结构化失败、零外部写入、不留孤儿行，无故障正控成功`, async () => {
    const run = (nth, method = 'putRepository') => attempt(method, nth)
    const faulty = await run(1)
    assert.deepEqual(faulty.hits, { calls: 1, thrown: 1 }, '注入真的触发了')
    assert.deepEqual([faulty.result.writeState, faulty.result.error?.code, faulty.unchanged], ['failed', 'unavailable', true], '整笔回滚：canonical 实体、身份、挂载、context 都没有留下，外部零写入')
    const claim = await run(1, 'putExecutionContext')
    assert.deepEqual([claim.hits, claim.result.error?.code, claim.unchanged], [{ calls: 1, thrown: 1 }, 'unavailable', true], '认领自己的写失败：登记与认领同一个事务，整笔回滚、不留孤儿行')
    const control = await run(0)
    assert.deepEqual([control.hits, control.result.status, control.unchanged], [{ calls: 1, thrown: 0 }, 'ready', false], '同一场景无故障时成功')
  })

  test(`${label}：同一工作区的第二个工作项在已登记的仓库上开始工作——复用挂载与 canonical 身份`, async () => {
    const { providers, storage, core, workspaceId: ws } = await setup(makeStorage); const before = external(providers)
    const [a, b] = (await core.queries.listPlanningItems()).filter((view) => view.content.contentKind === 'work_item').map((view) => view.entityId)
    assert.deepEqual([(await start(core, a, 'a')).status, (await start(core, b, 'b')).status], ['ready', 'ready'])
    assert.deepEqual(external(providers).map((n, i) => n - before[i]), [2, 2, 2]); assert.equal((await storage.listRepositories(ws)).length, 1)
    assert.equal(rawOf(storage).entities.filter((e) => e.kind === 'repository').length, 1, '仍然只有一个 canonical 仓库实体')
  })

  test(`${label}：两个工作区挂同一个 binding 的同一个仓库——一个 canonical 实体与身份、两个挂载，彼此的上下文引用不被搬走`, async () => {
    const one = await setup(makeStorage); const { providers, storage } = one
    const second = newWorkspaceId(); const core2 = await composeCore({ workspace: { id: second, name: 'B-1 二' }, providers, storage })
    const items = (await one.core.queries.listPlanningItems()).filter((view) => view.content.contentKind === 'work_item').map((view) => view.entityId)
    assert.equal((await start(one.core, items[0], 'ws1')).status, 'ready')
    assert.equal((await start(core2, items[1], 'ws2')).status, 'ready')
    const [m1, m2] = [await storage.listRepositories(one.workspaceId), await storage.listRepositories(second)]
    assert.deepEqual([m1.length, m2.length], [1, 1], '每个工作区各有一个挂载')
    assert.equal(m2[0].externalIdentityId, m1[0].externalIdentityId, '两个挂载引用同一个 canonical 身份')
    assert.equal(rawOf(storage).entities.filter((e) => e.kind === 'repository').length, 1, '只有一个 canonical 仓库实体')
    assert.equal((await storage.getExecutionContext(contextIdFor(one.workspaceId, items[0], REQUEST.repositoryId)))?.status, 'ready', 'ws1 的上下文没有被搬走')
  })

  /** 一次开始工作：在 `method` 第 `nth` 次写之后注入失败（0 为无故障正控），返回结果与读回的本地、外部事实；`tamper` 先改 provider。 */
  async function attempt(method, nth, tamper = () => {}) {
    const { providers, storage, core, workspaceId: ws, pick } = await setup(makeStorage)
    tamper(providers); const hits = injectAfterWrite(storage, method, nth); const workItemId = pick('work_item'); const contextId = contextIdFor(ws, workItemId, REQUEST.repositoryId)
    const before = external(providers); const snapshot = await world(providers, storage, ws, contextId); const result = await start(core, workItemId, 'local')
    return { hits, result, unchanged: (await world(providers, storage, ws, contextId)) === snapshot, branch: `work/${workItemId}`, delta: external(providers).map((n, i) => n - before[i]), record: await storage.getExecutionContext(contextId),
      relations: (await storage.listRelations(ws)).map((r) => r.type).sort(), attempts: (await storage.listMutationAttempts(ws)).map((a) => a.state), run: await storage.getExecutionRun(runIdFor(contextId)) }
  }
  // ack 之后的本地写失败：[场景, 注入的写方法, 第几次写, 外部增量（分支、工作树、运行）, 无故障时该方法的总调用次数]。
  const LOCAL_FAILURES = [
    ['最终事务的最后一写：Git 的 mutation_attempt', 'putMutationAttempt', 1, [1, 1, 0], 1],
    ['最终事务的第二条关系 has_worktree，tracks 一并回滚', 'putRelation', 2, [1, 1, 0], 2],
    ['分支步的步骤回填，工作树步不得开始', 'putExecutionContext', 2, [1, 0, 0], 4],
    ['工作树步的步骤回填（写已生效、调用失败）', 'putExecutionContext', 3, [1, 1, 0], 4],
    ['最终事务自己的 context 写（事务里第一写）', 'putExecutionContext', 4, [1, 1, 0], 4],
  ]
  for (const [name, method, nth, delta, total] of LOCAL_FAILURES) {
    test(`${label}：ack 之后本地写失败（${name}）——Unknown、保留已 ack 的句柄、不起 run，最终事实同生共死`, async () => {
      const { hits, result, branch, record, ...rest } = await attempt(method, nth)
      assert.deepEqual(hits, { calls: nth, thrown: 1 }, '注入真的触发了')
      assert.deepEqual([result.writeState, result.confirmed, result.saving, result.degraded, result.error?.code, result.status, /本次外部调用的失败/.test(result.error.message)], ['unknown', false, false, true, 'result_unknown', 'provisioning', false], '外部调用没有失败过：文案不带「原始失败」后缀')
      assert.deepEqual(rest.delta, delta, '外部写入只到已 ack 的那一步，startRun 0 次')
      assert.deepEqual([record.status, record.branchExternalId, record.provisioningStartedAt !== undefined, record.worktreeExternalId !== undefined], ['provisioning', branch, true, delta[1] === 1], '停在 Provisioning，保留已 ack 的句柄与租约')
      assert.deepEqual([result.branchExternalId, result.worktreeExternalId], [record.branchExternalId, record.worktreeExternalId], '结果面带着最后已 ack 的句柄')
      assert.deepEqual([rest.relations, rest.attempts, rest.run], [[], [], undefined], '没有关系、attempt 与 run：Ready、关系与账本同一个事务，要么全在要么全无')
      const control = await attempt(method, 0)
      assert.deepEqual([control.hits, control.result.status, control.relations, control.attempts, control.record.provisioningStartedAt], [{ calls: total, thrown: 0 }, 'ready', ['has_worktree', 'tracks'], ['saved'], undefined], '同场景无故障正控（Ready 的租约已清空）')
    })
  }

  test(`${label}：工作树步失败——Failed、分支保留、tracks 在、has_worktree 不借分支句柄（#192）；结算的写失败时 Unknown 且整笔回滚`, async () => {
    const failWorktree = (p) => { p.development.createWorktree = async () => providerFail('unavailable', '注入的工作树失败') }
    const control = await attempt('putMutationAttempt', 0, failWorktree)
    assert.deepEqual([control.hits, control.result.status, control.result.error?.code, control.result.branchExternalId, control.record.status, control.record.branchExternalId, control.relations, control.attempts],
      [{ calls: 1, thrown: 0 }, 'failed', 'unavailable', control.branch, 'failed', control.branch, ['tracks'], ['failed']], '落 Failed、分支保留、只有 tracks、失败也记 attempt')
    const faulty = await attempt('putMutationAttempt', 1, failWorktree)
    assert.deepEqual([faulty.hits, faulty.result.writeState, faulty.result.error?.code, faulty.result.branchExternalId, faulty.record.status, faulty.relations, faulty.attempts],
      [{ calls: 1, thrown: 1 }, 'unknown', 'result_unknown', faulty.branch, 'provisioning', [], []], '失败结算的写失败：Failed 与 tracks 都不落')
    assert.match(faulty.result.error.message, /已 ack.*unavailable.*注入的工作树失败/, '有已 ack 的分支：文案如实说已 ack，并带上 provider 的原始失败')
  })

  test(`${label}：分支步被 provider 拒绝（没有任何 ack）再叠加结算写失败——Unknown，文案不称已 ack，带上 provider 的原始失败`, async () => {
    const failBranch = (p) => { p.development.createBranch = async () => providerFail('unavailable', '注入的分支失败') }
    const control = await attempt('putMutationAttempt', 0, failBranch); const faulty = await attempt('putMutationAttempt', 1, failBranch)
    assert.deepEqual([control.hits, control.result.writeState, control.result.error?.code], [{ calls: 1, thrown: 0 }, 'failed', 'unavailable'], '正控：没有本地故障时，provider 的拒绝就是 failed / unavailable')
    assert.deepEqual([faulty.hits, faulty.result.writeState, faulty.result.error?.code, faulty.delta, faulty.result.branchExternalId], [{ calls: 1, thrown: 1 }, 'unknown', 'result_unknown', [0, 0, 0], undefined])
    assert.doesNotMatch(faulty.result.error.message, /已 ack/, '没有任何 ack：不得说已 ack'); assert.match(faulty.result.error.message, /unavailable.*注入的分支失败/, '保留 provider 的原始失败')
  })

  /** 真实开始工作一次（key 为 'saved'）：`fault` 先改世界，返回注入的命中计数（或没有）。 */
  async function started(fault = () => {}) {
    const w = await setup(makeStorage); const workItemId = w.pick('work_item'); const hits = fault(w)
    const first = await start(w.core, workItemId, 'saved')
    return { ...w, workItemId, contextId: contextIdFor(w.workspaceId, workItemId, REQUEST.repositoryId), hits, first }
  }
  /** 同 key、新 key、关库重开后的新 key 各开始一次，两个 core 各读一次 Query（零 provider 调用：包装全部 provider 的方法计数）：结果与视图都是 `[writeState, confirmed, degraded]`，外部与本地事实一字不改。 */
  async function readBack(w, [writeState, confirmed, degraded]) {
    let calls = 0
    for (const p of [w.providers.planning, w.providers.development, w.providers.delivery, w.providers.execution]) for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(p))) if (k !== 'constructor' && typeof p[k] === 'function') { const call = p[k].bind(p); p[k] = (...args) => { calls += 1; return call(...args) } }
    const query = async (core) => { const before = calls; const view = await core.queries.getExecutionContext({ workItemId: w.workItemId, repositoryId: REQUEST.repositoryId }); assert.equal(calls, before, 'Query 是本地纯读：零 provider 调用'); return view }
    const before = await world(w.providers, w.storage, w.workspaceId, w.contextId)
    const results = [await start(w.core, w.workItemId, 'saved'), await start(w.core, w.workItemId, 'new-key')]; const views = [await query(w.core)]
    const storage = w.storage.location === undefined ? w.storage : (w.storage.close(), createSqliteStorage(w.storage.location))
    const core = await composeCore({ workspace: { id: w.workspaceId, name: 'B-3 重开' }, providers: w.providers, storage })
    results.push(await start(core, w.workItemId, 'reopen-key')); views.push(await query(core))
    for (const r of results) assert.deepEqual([r.writeState, r.confirmed, r.degraded, r.status, r.error?.code], [writeState, confirmed, degraded, 'ready', degraded ? 'result_unknown' : undefined])
    if (degraded) for (const r of results) assert.match(r.error.message, /^已 ready 的上下文（[^）]+）：外部执行是否已启动无法确认/, '缺口文案：缺口描述加括号，与前后文分开')
    assert.deepEqual(views.map((v) => [v.status, v.degraded]), [['ready', degraded], ['ready', degraded]], 'Query')
    assert.equal(await world(w.providers, storage, w.workspaceId, w.contextId), before, '外部没有新增 run / 分支 / 工作树，本地事实一字不改（不补边、不补 run）')
  }

  // run 的 ack 之后：本地 run 记录写不进去、或 ack 的状态不是已知取值；关系的写入被静默丢掉（历史残缺的 Ready 的真实成因）。
  const acking = (status) => ({ providers: { execution } }) => { const startRun = execution.startRun.bind(execution); execution.startRun = async (input) => { const run = await startRun(input); return run.ok ? { ...run, value: { ...run.value, status } } : run } }
  const SAVED = ['saved', true, false]; const UNKNOWN = ['unknown', false, true]
  // [场景, 世界的故障注入, 首次的 [writeState, confirmed, degraded], 本地 run 记录的状态, 注入的命中计数, 之后的 [writeState, confirmed, degraded]]
  const READY_WORLDS = [
    ['完整（正控）', (w) => injectLostWrite(w.storage, 'putExecutionRun', 0), SAVED, 'running', { calls: 1, thrown: 0 }, SAVED],
    ['run 的 ack 之后本地 run 记录写失败', (w) => injectLostWrite(w.storage, 'putExecutionRun', 1), UNKNOWN, undefined, { calls: 1, thrown: 1 }, UNKNOWN],
    ['run 的 ack 之后状态不是已知取值', acking('mystery'), UNKNOWN, 'unknown', undefined, UNKNOWN],
    ['主执行 ack 的是 failed：已确认的运行，不是缺口（不从 failed 反推）', acking('failed'), SAVED, 'failed', undefined, SAVED],
    ['has_worktree 关系的写入被静默丢掉', (w) => dropRelation(w.storage, 'has_worktree'), SAVED, 'running', undefined, UNKNOWN],
    ['tracks 关系的写入被静默丢掉', (w) => dropRelation(w.storage, 'tracks'), SAVED, 'running', undefined, UNKNOWN],
    ['has_worktree 关系只是候选（未确认）', (w) => dropRelation(w.storage, 'has_worktree', true), SAVED, 'running', undefined, UNKNOWN],
    ['tracks 关系只是候选（未确认）', (w) => dropRelation(w.storage, 'tracks', true), SAVED, 'running', undefined, UNKNOWN],
  ]
  for (const [name, fault, first, recorded, hits, later] of READY_WORLDS) {
    test(`${label}：Ready 之后的重放与读取（${name}）——同 key、新 key、重开后的新 key 与 Query 给出同一个答案，不起第二个 run、不补边`, async () => {
      const w = await started(fault)
      assert.deepEqual([w.first.writeState, w.first.confirmed, w.first.degraded, w.first.status, w.hits], [...first, 'ready', hits])
      assert.deepEqual([w.first.runExternalId, (await w.storage.getExecutionRun(runIdFor(w.contextId)))?.status], [w.providers.execution.state.runs.at(-1).ref.externalId, recorded], '结果带着已 ack 的 run 句柄供对账；本地 run 记录：正常 / 缺失 / unknown')
      await readBack(w, later)
    })
  }

  // 工作树读回的分类（评审 P2 与复评）：有缺口的 Ready 不读回、不改判；完整的 Ready 只在确定不存在或检出别的分支时判 Failed，其后接管有 run 记录、不起第二个 run。
  const reads = (read) => (w) => { w.providers.development.getWorktree = read }
  const WORKTREE_READS = [
    ['缺 run 记录时遇到 not_found（local Git 把仓库不可达也报成 not_found）', true, reads(async () => providerFail('not_found', '注入')), 'ready'],
    ['读失败', false, reads(async () => providerFail('unavailable', '注入')), 'ready'],
    ['权限被拒', false, reads(async () => providerFail('permission_denied', '注入')), 'ready'],
    ['没有工作树读方法', false, reads(undefined), 'ready'],
    ['工作树读能力被策略设为不可用', false, (w) => composeCore({ workspace: { id: w.workspaceId, name: '策略' }, providers: w.providers, storage: w.storage, policy: { [CapabilityKey.DevelopmentWorktreeRead]: AccessLevel.Unavailable } }), 'ready'],
    ['确定不存在', false, reads(async () => providerFail('not_found', '注入')), 'failed'],
    ['检出了别的分支', false, ({ providers: { development: d } }) => { const get = d.getWorktree.bind(d); d.getWorktree = async (input) => { const r = await get(input); return r.ok ? { ...r, value: { ...r.value, branch: 'work/other' } } : r } }, 'failed'],
  ]
  for (const [name, gapped, fault, status] of WORKTREE_READS) test(`${label}：Ready 的工作树读回（${name}）——${status === 'ready' ? '保留 Ready、报 Unknown' : '判 Failed'}，换新 key 也不起第二个 run（评审 P2）`, async () => {
    const w = await started(gapped ? (x) => injectLostWrite(x.storage, 'putExecutionRun', 1) : undefined); const runs = w.providers.execution.state.runs.length
    const original = w.providers.development.getWorktree; const core = (await fault(w)) ?? w.core; const replay = await start(core, w.workItemId, 'saved')
    assert.deepEqual([replay.status, replay.writeState, (await w.storage.getExecutionContext(w.contextId)).status], status === 'ready' ? ['ready', 'unknown', 'ready'] : ['failed', 'failed', 'failed'])
    if (status === 'ready') {
      await w.storage.putMutationAttempt({ id: 'write:startWork:first-failed', workspaceId: w.workspaceId, bindingId: w.bindingId, commandName: 'startWork', idempotencyKey: 'first-failed', state: 'failed', expectedSourceVersion: undefined, errorCode: 'unavailable' })
      const hit = await start(core, w.workItemId, 'first-failed')
      assert.deepEqual([hit.writeState, hit.status, (await w.storage.getExecutionContext(w.contextId)).status], ['failed', 'ready', 'ready'], '命中的 Failed 首次报告原样返回，记录也不被改判')
    }
    if (status === 'failed') w.providers.development.getWorktree = original // 读回恢复后接管才走得到 run 步
    const retake = await start(core, w.workItemId, 'retake')
    assert.deepEqual([retake.writeState, w.providers.execution.state.runs.length], [status === 'ready' ? 'unknown' : 'saved', runs], '换新 key 接管也不起第二个 run')
    if (status === 'failed') assert.equal(retake.runExternalId, w.first.runExternalId, '接管沿用已有的 run')
  })

  test(`${label}：主执行 startRun 结果不确定——记 unknown、顶层 Unknown、不转人工降级，重放、重开与 Query 同一个答案（评审 P2，ADR-0007）`, async () => {
    const w = await started((x) => { x.providers.execution.startRun = async () => providerFail('ambiguous_result', '注入的响应丢失') })
    const run = await w.storage.getExecutionRun(runIdFor(w.contextId))
    assert.deepEqual([w.first.writeState, w.first.confirmed, w.first.status, w.first.fallback, w.first.error?.code, run?.status, run?.fallback], ['unknown', false, 'ready', undefined, 'result_unknown', 'unknown', undefined])
    assert.match(w.first.error.message, /^运行状态未知（startRun 的结果不确定：/)
    await readBack(w, UNKNOWN)
    const lost = await started((x) => { x.providers.execution.startRun = async () => providerFail('ambiguous_result', '注入'); return injectLostWrite(x.storage, 'putExecutionRun', 1) })
    assert.deepEqual([lost.hits, lost.first.writeState, lost.first.status], [{ calls: 1, thrown: 1 }, 'unknown', 'ready'], 'unknown 的 run 记录写不进去：仍是 Unknown，不是拒绝')
  })

  test(`${label}：工作树步结果不确定——对账读回：已落地照常 Ready、读失败 Unknown、检出别的分支 Failed（评审 P3 与复评）`, async () => {
    const ambiguous = (read) => ({ providers: { development: d } }) => {
      const create = d.createWorktree.bind(d); const get = d.getWorktree.bind(d)
      d.createWorktree = async (input) => { const done = await create(input); return done.ok ? providerFail('ambiguous_result', '注入的响应丢失') : done }
      if (read) d.getWorktree = (input) => read(get, input)
    }
    const landed = await started(ambiguous())
    assert.deepEqual([landed.first.status, landed.first.confirmed, landed.first.error, external(landed.providers)[1], landed.first.worktreeExternalId !== undefined], ['ready', true, undefined, 1, true])
    assert.deepEqual((await landed.storage.listRelations(landed.workspaceId)).map((r) => `${r.type}:${r.state}`).sort(), ['has_worktree:confirmed', 'tracks:confirmed'])
    const unreadable = await started(ambiguous(async () => providerFail('unavailable', '注入的读失败')))
    assert.deepEqual([unreadable.first.writeState, unreadable.first.error?.code], ['unknown', 'unavailable'], '读不到不等于没落地：不判确定失败')
    const other = await started(ambiguous(async (get, input) => { const r = await get(input); return r.ok ? { ...r, value: { ...r.value, branch: 'work/other' } } : r }))
    assert.deepEqual([other.first.writeState, other.first.error?.code, other.first.status], ['failed', 'conflict', 'failed'], '检出别的分支：与 conflict 路径同一个判定，不报 Saved')
  })

  test(`${label}：Development 绑定 id 变了——已挂载仓库上的新工作项在任何外部写入之前 conflict，文案点名绑定 id（评审 P2）`, async () => {
    const w = await started(); const fresh = createFakeProviders(); const providers = { ...fresh, planning: w.providers.planning } // 规划绑定沿用，Development 换实例
    const storage = w.storage.location === undefined ? w.storage : (w.storage.close(), createSqliteStorage(w.storage.location))
    const core = await composeCore({ workspace: { id: w.workspaceId, name: '重启' }, providers, storage })
    const other = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item' && v.entityId !== w.workItemId).entityId
    const before = external(providers); const result = await start(core, other, 'after-restart')
    assert.deepEqual([result.writeState, result.error?.code, external(providers)], ['failed', 'conflict', before], '在任何外部写入之前拒绝')
    assert.match(result.error.message, /当前 Development 绑定 \S+ 下没有它的身份——绑定 id 变了/, '文案点名真实成因，而不是只指向 #219')
  })

  test(`${label}：同 key 重放先于预检、命中的 Failed / Unknown 首次报告原样返回，不被 Ready 提升（也不被完整性守卫改写）`, async () => {
    const w = await started((x) => injectLostWrite(x.storage, 'putExecutionRun', 1)) // Ready 但没有 run 记录
    await registerWorkItem(w.storage, w.workspaceId, w.workItemId, { contentKind: 'redacted', reason: 'permission_denied' }) // 工作项之后被扣下
    assert.equal((await start(w.core, w.workItemId, 'saved')).error?.code, 'result_unknown', '同 key 重放：首次的 saved 报告只过完整性守卫，不是被扣下的 unavailable')
    for (const [key, state, code] of [['first-failed', 'failed', 'unavailable'], ['first-unknown', 'unknown', 'result_unknown']]) {
      await w.storage.putMutationAttempt({ id: `write:startWork:${key}`, workspaceId: w.workspaceId, bindingId: w.bindingId, commandName: 'startWork', idempotencyKey: key, state, expectedSourceVersion: undefined, errorCode: code })
      const replay = await start(w.core, w.workItemId, key)
      assert.deepEqual([replay.writeState, replay.confirmed, replay.error?.code, replay.status], [state, false, code, 'ready'], `${key}：原样返回`)
    }
  })

  test(`${label}：租约内的在途不被完整性守卫改判，租约过期后接管把序列做完`, async () => {
    const { clock, advance } = controllableClock(); const w = await setup(makeStorage, { clock }); const workItemId = w.pick('work_item'); const before = external(w.providers)
    const delta = () => external(w.providers).map((n, i) => n - before[i])
    injectAfterWrite(w.storage, 'putMutationAttempt', 1); await start(w.core, workItemId, 'seed') // 最终事务失败：Provisioning、有句柄，租约从现在起算
    advance(1_000); const inFlight = await start(w.core, workItemId, 'in-flight')
    const view = await w.core.queries.getExecutionContext({ workItemId, repositoryId: REQUEST.repositoryId })
    assert.deepEqual([inFlight.writeState, inFlight.saving, inFlight.confirmed, inFlight.status, inFlight.error, delta(), view.degraded], ['pending', true, false, 'provisioning', undefined, [1, 1, 0], false], '租约内：还在途，不是 Ready，守卫不介入（命令与 Query 都不判），没有再写外部')
    advance(LEASE_EXPIRED_MS); const resumed = await start(w.core, workItemId, 'resume')
    assert.deepEqual([resumed.writeState, resumed.status, delta()], ['saved', 'ready', [1, 1, 1]], '过期后接管续跑：没有第二份分支与工作树，run 只起一次')
  })
  for (const [status, writeState] of [['failed', 'failed'], ['provisioning', 'pending']]) test(`${label}：同 key 的 saved attempt 遇到 ${status} 的记录——连续两次重放一致、不报 Saved`, async () => {
    const w = await started(); await w.storage.putExecutionContext({ ...(await w.storage.getExecutionContext(w.contextId)), status }); const replays = [await start(w.core, w.workItemId, 'saved'), await start(w.core, w.workItemId, 'saved')] // 记录不再是 Ready，saved 的 attempt 还在
    assert.deepEqual(replays.map((r) => [r.writeState, r.confirmed, r.status]), [[writeState, false, status], [writeState, false, status]])
  })
  // 接管（记录被判 Failed 之后换新 key）时已有 run：主执行可用走 `startExecution`、不可用走 `manualFallback`，两条分支都不起第二个 run，答案与这次接管自己的重放、Query 同一个。
  const TAKEOVERS = [
    ['主执行 ack 的状态未知', acking('mystery'), undefined, UNKNOWN],
    ['主执行 ack 的状态未知，接管时主执行不可用', acking('mystery'), { [CapabilityKey.ExecutionRunStart]: AccessLevel.Unavailable }, UNKNOWN],
    ['主执行 ack 的是 failed', acking('failed'), undefined, SAVED],
    ['首次只落了人工降级，接管时主执行已恢复', (w) => w.providers.execution.faultsSwitch.set(FaultKind.HarnessFailure, true), undefined, ['saved', true, true]],
  ]
  for (const [name, fault, policy, [writeState, confirmed, degraded]] of TAKEOVERS) test(`${label}：接管时已有 run（${name}）——${writeState}，不起第二个 run，与重放、Query 同一个答案`, async () => {
    const w = await started(fault); w.providers.execution.faultsSwitch.set(FaultKind.HarnessFailure, false); await w.storage.putExecutionContext({ ...(await w.storage.getExecutionContext(w.contextId)), status: 'failed' })
    const core = policy === undefined ? w.core : await composeCore({ workspace: { id: w.workspaceId, name: 'B-3 接管' }, providers: w.providers, storage: w.storage, policy })
    const runs = w.providers.execution.state.runs.length; const face = (r) => [r.writeState, r.confirmed, r.degraded, r.status, r.fallback, r.runExternalId, r.branchExternalId, r.worktreeExternalId]
    const taken = await start(core, w.workItemId, 'retake'); const view = await core.queries.getExecutionContext({ workItemId: w.workItemId, repositoryId: REQUEST.repositoryId })
    assert.deepEqual(face(taken), [writeState, confirmed, degraded, 'ready', w.first.fallback, w.first.runExternalId, w.first.branchExternalId, w.first.worktreeExternalId], '如实带回已有 run 的句柄与降级、分支与工作树的句柄；主执行 ack 的 failed 是已确认的运行，不从 failed 反推')
    assert.deepEqual([face(await start(core, w.workItemId, 'retake')), view.degraded, view.fallback, w.providers.execution.state.runs.length], [face(taken), degraded, w.first.fallback, runs], '与重放、Query 同一个答案，不起第二个 run')
    if (writeState === 'unknown') assert.deepEqual([/^运行状态未知（ack 的状态 mystery 不是已知取值）/.test(w.first.error.message), /^运行状态未知（已有的 run 记录是 unknown）/.test(taken.error.message)], [true, true], '文案陈述运行状态与原因，不称本地写失败')
  })
  test(`${label}：主执行 startRun 失败时并发的写者刚落了 run 记录——降级不覆盖它，如实带回`, async () => {
    const w = await started(({ providers, storage, workspaceId }) => { providers.execution.startRun = async ({ context }) => { await storage.putExecutionRun({ id: runIdFor(context.externalId), workspaceId, contextId: context.externalId, status: 'running', updatedAt: '2026-10-01T00:00:00.000Z', providerRef: { ...context, objectKind: 'execution_run', externalId: 'run-concurrent' } }); return providerFail('unavailable', '主执行启动失败') } })
    const run = await w.storage.getExecutionRun(runIdFor(w.contextId))
    assert.deepEqual([w.first.writeState, w.first.fallback, w.first.runExternalId, run.providerRef?.externalId, run.fallback], ['saved', undefined, 'run-concurrent', 'run-concurrent', undefined], '保留并发写入的 run：不起降级、不覆盖记录')
  })
}
