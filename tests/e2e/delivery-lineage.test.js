/**
 * Batch C4 端到端：交付谱系（issue #78 / ExecPlan D5、D6）。全部离线：无凭据、无网络，provider 由测试层装配（ExecPlan D1）。用例名说明它保护哪条
 * 不变量：每一跳都是带显式 provenance 的关系且沿谱系传播（不变量 6）；确定性发现的关系先进候选、只有显式确认才升级；未观察过的链路读回 0 跳且本地
 * 不留骨架关系（事实/观察边界）；缺可选能力报 unavailable 而不是 error；只读交付方的写尝试返回 not supported 且不改任何状态。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CapabilityKey } from '@harness-projects/capabilities'
import { AccessLevel, RelationSource, RelationState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore, createContext, readDeliveryProjection, refreshDeliveryFacts } from '@harness-projects/core'
import { FaultKind, createFakeProviders, createFakeStorage, exportFakeStorageState, refOf } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
// 替身按仓库种下流水线运行：负向用例必须用这个有 CI 种子的仓库——若换空仓库，无条件读取同样读不到东西，用例就没有判别力。
const REPOSITORY = 'repo-alpha'
const REQUEST = { repositoryId: REPOSITORY, actor: { kind: 'agent' } }
const CHAIN_TYPES = ['tracks', 'has_worktree', 'derived_from', 'produced_by', 'runs_on']

const compose = (providers, extra = {}) => composeCore({ workspace: WORKSPACE, providers, ...extra })

/** 摄入的唯一调用点（#221 起）：此时查询委托唯一写者；#222 只把这一处换成 `core.commands.refreshDeliveryFacts(scope)`。 */
const ingest = (core, scope) => core.queries.getDeliveryProjection(scope)
const ciHops = (projection) => projection.hops.filter((hop) => hop.entityKind === 'pipeline_run' || hop.entityKind === 'check_run')
const ciFacts = (projection) => ciHops(projection).map((hop) => `${hop.externalId}:${hop.fact ?? '-'}:${hop.label}`).sort()
const tickingClock = () => { let n = 0; return () => new Date(Date.UTC(2026, 9, 8, 0, 0, n++)).toISOString() }
/** 在第一行之后追加 `count` 条同形状的行；默认 60 条，超过一页（`PAGE_LIMIT = 50`）：Development 的查找只读第一页，页带 `nextCursor`。 */
const flood = (rows, prefix, extra = () => ({}), count = 60) => { const [first] = rows; for (let n = 0; n < count; n += 1) rows.push({ ...first, ref: { ...first.ref, externalId: `${prefix}${n}` }, ...extra(n) }) }
/** 换掉 `target[method]`，返回恢复函数。 */
const stub = (target, method, impl) => { const original = target[method]; target[method] = impl; return () => { target[method] = original } }
/** Delivery 读不完：页永远带 `nextCursor` 且重复投递，#295 的完整分页把它读成本集合的缺口，不交出第一页。 */
const endless = (delivery, method) => { const list = delivery[method].bind(delivery); return stub(delivery, method, async (input) => { const page = await list({ ...input, cursor: undefined }); return { ...page, value: { ...page.value, nextCursor: 'again' } } }) }
/** 让事务内对 `method` 的调用抛错：事务体照常执行到那一步，此前的写入随回滚撤销。`once` 时只影响下一个事务；返回恢复函数。 */
function throwInside(providers, method, message, once = false) {
  const transaction = providers.storage.transaction.bind(providers.storage)
  const restore = stub(providers.storage, 'transaction', (work) => {
    if (once) restore()
    return transaction((tx) => work(new Proxy(tx, { get: (target, key) => key === method ? async () => { throw new Error(message) } : typeof target[key] === 'function' ? target[key].bind(target) : target[key] })))
  })
  return restore
}

const dir = mkdtempSync(join(tmpdir(), 'delivery-lineage-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
/** 两个 Storage 都要跑离线保留：替身接受悬空端点，掩盖了 SQLite 上首读就抛外键异常的缺陷（E6）。 */
const STORAGES = [
  ['内存替身', { open: (providers) => providers.storage, reopen: (storage) => createFakeStorage(exportFakeStorageState(storage)) }],
  ['SQLite', { open: () => createSqliteStorage(join(dir, `lineage-${files++}.sqlite`)), reopen: (storage) => { const at = storage.location; storage.close(); return createSqliteStorage(at) } }],
]

async function workItemIdOf(core, index = 0) {
  const item = (await core.queries.listPlanningItems()).filter((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item')[index] // redacted 条目的 kind 也是 work_item（issue-3），但没有可操作的规划条目，不能当开始工作的对象
  assert.ok(item, 'planning 种子里必须至少有一个工作项')
  return item.entityId
}

/** 走完 工作项 → 执行上下文 → 分支/工作树 → 提交 → 变更请求 的真实链路。 */
async function startChain(providers, core, idempotencyKey, index = 0) {
  const workItemId = await workItemIdOf(core, index)
  const started = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey })
  assert.equal(started.confirmed, true, 'git 步骤拿到 provider ack 才算链路推进')
  const created = await providers.development.createChangeRequest({
    repository: refOf(providers.development.gate.bindingId, 'repository', REPOSITORY),
    head: started.branchExternalId, base: 'main', title: '交付谱系占位', body: '占位正文' })
  assert.equal(created.ok, true, '变更请求必须创建成功')
  return { workItemId, started, scope: { workItemId, repositoryId: REPOSITORY } }
}

/** 走完链路，默认再摄入一次（在线确认的快照）；`providers` 与 `extra` 给要换 Storage、时钟或策略的用例。 */
async function chainOf(key, { providers = createFakeProviders(), extra, ingested = true } = {}) {
  const core = await compose(providers, extra)
  const chain = await startChain(providers, core, key)
  if (ingested) await ingest(core, chain.scope)
  return { providers, core, chain }
}

test('交付谱系：每一跳都是带显式 provenance 的关系，且按已记录身份传播（不变量 6）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-full-1')
  const before = await planningSnapshot(core)
  const hops = await core.queries.getDeliveryLineage(chain.scope)
  const types = new Set(hops.map((hop) => hop.relationType))
  for (const expected of CHAIN_TYPES) assert.ok(types.has(expected), `谱系缺少 ${expected} 跳，实际只有 ${[...types]}`)
  assert.ok(hops.every((hop) => hop.source === RelationSource.Lineage), '谱系跳必须标记为 lineage 来源')
  assert.ok(
    hops.every((hop) => hop.provenance !== undefined && hop.relationSource !== undefined && hop.relationState !== undefined),
    '每一跳都要带显式 provenance（来源 + 确认态 + 建立方式）')
  const contextHop = hops.find((hop) => hop.relationType === 'tracks')
  assert.equal(contextHop.to, chain.started.executionContextId, '上下文跳必须回指 startWork 返回的同一个 id，不重新识别')
  const worktreeHop = hops.find((hop) => hop.relationType === 'has_worktree')
  assert.equal(worktreeHop.externalId, chain.started.worktreeExternalId, '工作树跳必须回指已建工作树')
  assert.equal(worktreeHop.relationState, RelationState.Confirmed, '命令确认的系统事实是已确认边')
  const commitHop = hops.find((hop) => hop.entityKind === 'commit')
  assert.ok(commitHop.observed && typeof commitHop.externalId === 'string', '提交必须由 provider 读到')
  const ciHop = hops.find((hop) => hop.relationType === 'runs_on')
  assert.equal(ciHop.relationState, RelationState.Candidate, 'provider 读到的确定性事实只能先进候选')
  assert.equal(await planningSnapshot(core), before, '读交付谱系不得改写规划状态')
})

test('负向：锚点未观察时不读 CI 事实，读回 0 跳且本地无 CI 关系（评审 P1 / ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  // composeCore 只做首轮规划水合；此处不调用 bootstrapWorkspace，也不 startWork，链上没有已观察到的提交/变更请求。
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const scope = { workItemId, repositoryId: REPOSITORY }
  const projection = await core.queries.getDeliveryProjection(scope)
  assert.equal(projection.error, undefined, '查询必须成功：0 跳来自"没有观察"，不是降级或错误')
  assert.equal(projection.hops.length, 0, 'head 未观察到时不得以 commit: undefined 读取整个仓库的流水线')
  assert.equal((await core.queries.getDeliveryLineage(scope)).length, 0, '交付谱系必须同样是 0 跳')
  const relations = exportFakeStorageState(providers.storage).relations
  assert.equal(relations.length, 0, '本地不得落任何 artifact_relation 行：推断出的拓扑不是存储事实')
  assert.equal(relations.filter((relation) => relation.type === 'runs_on').length, 0, '存储里不得出现 CI 关系')
})

test('负向：未创建执行上下文时，即使同名分支有事实也不得制造工作树谱系', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const repository = refOf(providers.development.gate.bindingId, 'repository', REPOSITORY)
  const branch = await providers.development.createBranch({ repository, name: 'work/orphan', fromRef: 'main' })
  assert.equal(branch.ok, true)
  const changeRequest = await providers.development.createChangeRequest({
    repository, head: 'work/orphan', base: 'main', title: '孤立分支', body: '不应进入未创建工作树的谱系',
  })
  assert.equal(changeRequest.ok, true)

  const projection = await core.queries.getDeliveryProjection({ workItemId: 'orphan', repositoryId: REPOSITORY })
  assert.equal(projection.error, undefined)
  assert.equal(projection.hops.length, 0, '未观察到执行上下文时，同名分支不得成为谱系锚点')
  assert.equal((await core.queries.getDeliveryLineage({ workItemId: 'orphan', repositoryId: REPOSITORY })).length, 0)
  assert.equal(exportFakeStorageState(providers.storage).relations.length, 0, '骨架不得落成关系')
})

test('正向：真实链路走完后 CI 跳出现（无锚点不读不得削弱真实观察）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-positive-ci-1')
  const ci = (await core.queries.getDeliveryLineage(chain.scope)).filter((hop) => hop.relationType === 'runs_on')
  assert.ok(ci.length > 0, '提交被观察到之后必须读到该提交上的流水线运行')
  assert.ok(ci.every((hop) => hop.observed === true && typeof hop.externalId === 'string'), 'CI 跳必须是真实观察到的运行')
})

test('候选关系：确定性发现先进候选，显式确认才升级，同一三元组不重复（issue #78）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const chain = await startChain(providers, core, 'lineage-candidate-1')
  const first = await core.queries.getDeliveryLineage(chain.scope)
  const discovered = first.find((hop) => hop.relationType === 'derived_from')
  assert.equal(discovered.relationState, RelationState.Candidate, '确定性发现的边必须先是候选')
  const stored = () => providers.storage.listRelations(WORKSPACE.id)
  const recorded = (await stored()).find((relation) =>
    relation.from === discovered.from && relation.to === discovered.to && relation.type === discovered.relationType)
  assert.equal(recorded.state, RelationState.Candidate, '候选边未确认前不得被读成已确认关系')
  const countBefore = (await stored()).length
  await core.queries.getDeliveryLineage(chain.scope)
  assert.equal((await stored()).length, countBefore, '重复读取不得产生第二个三元组')
  const confirmed = await core.commands.confirmRelation({ from: discovered.from, to: discovered.to, type: discovered.relationType })
  assert.equal(confirmed.relation.state, RelationState.Confirmed, '显式确认必须把候选升级为已确认')
  assert.equal(confirmed.created, false, '确认复用既有边，不新建关系')
  const reread = (await core.queries.getDeliveryLineage(chain.scope)).find((hop) => hop.relationType === 'derived_from')
  assert.equal(reread.relationState, RelationState.Confirmed, '确认后读回才是已确认')
  assert.equal(reread.source, RelationSource.Lineage, '确认不改变跳的谱系来源')
})

test('缺可选能力：部署与环境报 unavailable 而不是 error（ExecPlan D5）', async () => {
  const providers = createFakeProviders({ delivery: { capabilities: { deployments: false } } })
  const core = await compose(providers)
  // 必须先走完真实链路：CI 跳只在锚点被观察到之后才存在（ExecPlan D4），未观察时它不得出现。
  const chain = await startChain(providers, core, 'lineage-optional-1')
  const projection = await core.queries.getDeliveryProjection(chain.scope)
  assert.equal(projection.error, undefined, '缺可选能力不是错误')
  const deployment = projection.optional.find((entry) => entry.key === 'delivery.deployment.read')
  assert.equal(deployment.available, false, '未声明的可选能力必须报 unavailable')
  assert.ok(typeof deployment.reason === 'string' && deployment.reason.length > 0, '不可用必须带可回答的原因')
  assert.ok(projection.hops.some((hop) => hop.relationType === 'runs_on'), '必读能力仍在，CI 跳仍可查询')
})

test('只读交付方：改流水线请求返回 not supported 且不改任何状态（issue #78）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const providerState = JSON.stringify(providers.delivery.state)
  const storageState = JSON.stringify(exportFakeStorageState(providers.storage))
  const attempt = await core.commands.rerunPipeline(refOf(providers.delivery.gate.bindingId, 'pipeline_run', 'run-3'))
  assert.equal(attempt.supported, false)
  assert.equal(attempt.confirmed, false, '未支持的写尝试不得报告为已确认')
  assert.notEqual(attempt.writeState, 'saved', '未支持的写尝试不得显示权威已保存')
  assert.equal(attempt.error.code, 'not_supported')
  assert.equal(JSON.stringify(providers.delivery.state), providerState, 'provider 侧状态不得改变')
  assert.equal(JSON.stringify(exportFakeStorageState(providers.storage)), storageState, '本地状态不得改变')
})

const DELIVERY_SETS = ['change_request', 'check_run', 'commit', 'pipeline_run']
const CI_SETS = ['check_run', 'pipeline_run']
// 完整性（`completeSets`）：在线确认一次后注入一种情形，再刷新、读、重启。`stale` 是应当逐跳标陈旧的集合；没有 `ci` / `kinds` 时，已确认的 CI 事实与六种跳原样保留。
// 查找（分支、变更请求）目标在第一页即完整，不在第一页且还有下一页才是缺口（TD-040），变更请求先按本分支过滤（#287）；Delivery 读不完与页形非法由 #295 的完整分页报成该集合的缺口；路由失败没有任何 provider 调用，同样是「没看到」（K3）。
const COMPLETENESS = [
  ['Delivery 离线', (providers) => { providers.delivery.faultsSwitch.set(FaultKind.Offline, true) }, { stale: CI_SETS }],
  ['Delivery 权限被拒', (providers) => { providers.delivery.faultsSwitch.set(FaultKind.PermissionDenied, true) }, { stale: CI_SETS }],
  ['Development 离线', (providers) => { providers.development.faultsSwitch.set(FaultKind.Offline, true) }, { stale: DELIVERY_SETS }],
  ['检查分页读不完', (providers) => endless(providers.delivery, 'listChecks'), { stale: ['check_run'] }],
  ['流水线页形非法', (providers) => stub(providers.delivery, 'listPipelineRuns', async () => ({ ok: true, value: { items: null, nextCursor: undefined } })), { stale: ['pipeline_run'] }],
  ['分支查找，目标在第一页', (providers) => flood(providers.development.state.branches, 'zz-', (n) => ({ name: `zz-${n}` })), { stale: [] }],
  ['分支查找，目标不在第一页', (providers) => flood(providers.development.state.branches, 'aa-', (n) => ({ name: `aa-${n}` })), { stale: DELIVERY_SETS }],
  ['变更请求查找，目标在第一页', (providers) => flood(providers.development.state.changeRequests, 'zz-', (n) => ({ sourceVersion: `other-${n}` })), { stale: [] }],
  ['变更请求查找，目标不在第一页', (providers) => flood(providers.development.state.changeRequests, 'aa-', (n) => ({ sourceVersion: `other-${n}` })), { stale: ['change_request', 'check_run'] }],
  ['变更请求查找，别的分支的 60 条排在前面', (providers) => flood(providers.development.state.changeRequests, 'aa-', (n) => ({ headBranch: `other-${n}`, sourceVersion: `other-${n}` })), { stale: [] }],
  // 分支存在而头部提交未知：不是「没有头部提交」，不能当作锚点确认不存在。
  ['分支头部提交缺失', (providers) => providers.development.state.branches.filter((branch) => branch.name !== 'main').forEach((branch) => { branch.headCommit = undefined }), { stale: DELIVERY_SETS }],
  // 端口约定 provider 失败是结构化的；违约抛出裸异常时，写者也不得把它转给查询，更不得转发原文（K2）。
  ['provider 抛出裸异常', (providers) => { providers.delivery.listPipelineRuns = async () => { throw new Error('PROVIDER-RAW /secret/path') } }, { stale: DELIVERY_SETS, error: 'unavailable' }],
  ['Development 读能力被摘掉', undefined, { policy: CapabilityKey.DevelopmentRepositoryRead, stale: DELIVERY_SETS }],
  ['流水线读能力被摘掉', undefined, { policy: CapabilityKey.DeliveryPipelineRead, stale: ['pipeline_run'], unavailable: ['pipeline_run'] }],
  ['检查读能力被摘掉', undefined, { policy: CapabilityKey.DeliveryCheckRead, stale: ['check_run'], unavailable: ['check_run'] }],
  ['变更请求读能力被摘掉', undefined, { policy: CapabilityKey.DevelopmentChangeRequestRead, stale: ['change_request', 'check_run'] }],
  // 命令事实（tracks / has_worktree）不随上下文状态隐藏（TD-009）。
  ['上下文 Failed', async (providers, chain, storage) => { const record = await storage.getExecutionContext(chain.started.executionContextId); await storage.putExecutionContext({ ...record, status: 'failed', provisioningStartedAt: undefined }) }, { stale: [] }],
  // 正控：完整读到的空集合才删除；锚点被完整读到并确认不存在时，下游一并删除。
  ['确认没有运行', (providers) => { providers.delivery.state.runs.length = 0 }, { stale: [], ci: (fact) => fact.startsWith('check-'), kinds: ['change_request', 'check_run', 'commit', 'execution_context', 'worktree'] }],
  ['分支确认不存在', (providers, chain) => { const branches = providers.development.state.branches; branches.splice(0, branches.length, ...branches.filter((branch) => branch.name !== chain.started.branchExternalId)) },
    { stale: [], ci: () => false, kinds: ['execution_context', 'worktree'] }],
  // 列表完整，只剩本分支上头提交不同的变更请求，且排在前面：它不得被挂进本链（只认 sourceVersion === head；「别的分支的 60 条」那一行守的是 headBranch 过滤）。
  ['变更请求确认不存在', (providers) => { const requests = providers.development.state.changeRequests; requests.splice(0, requests.length, { ...requests[0], ref: { ...requests[0].ref, externalId: 'a-foreign' }, sourceVersion: 'sha-other' }) },
    { stale: [], ci: (fact) => fact.startsWith('run-'), kinds: ['commit', 'execution_context', 'pipeline_run', 'worktree'] }],
]
for (const [label, { open, reopen }] of STORAGES) {
  test(`离线保留（${label}）：离线、权限被拒、分页读不完、查找未尽、头部提交缺失、读异常、路由失败与上下文 Failed 都不把最后确认的事实记成不存在，逐跳标陈旧，重启后仍在；只有完整读到的空集合才删除（#221 验收 1、3）`, async () => {
    for (const [name, inject, expected] of COMPLETENESS) {
      const providers = createFakeProviders()
      const storage = open(providers)
      const { core, chain } = await chainOf(`lineage-complete-${name}`, { providers, extra: { storage } })
      const online = await core.queries.getDeliveryProjection(chain.scope)
      const confirmed = ciFacts(online)
      assert.ok(confirmed.length === 5 && ciHops(online).every((hop) => hop.stale === false && /\S/.test(hop.label ?? '')), `${name}：前置，在线时五条 CI 事实（两条流水线运行加三条检查），不陈旧，带显示用的 label`)
      await inject?.(providers, chain, storage)
      const faulted = expected.policy === undefined ? core : await compose(providers, { storage, policy: { [expected.policy]: AccessLevel.Unavailable } })
      const refreshed = await ingest(faulted, chain.scope)
      assert.deepEqual([JSON.stringify(refreshed).includes('/secret/path'), refreshed.error?.code], [false, expected.error], `${name}：只有读取或提交失败才带结构化错误，且不转发异常原文`)
      const projection = await faulted.queries.getDeliveryProjection(chain.scope)
      assert.deepEqual(ciFacts(projection), confirmed.filter(expected.ci ?? (() => true)), `${name}：不完整的读取不得删除、增补或改写已确认的 CI 事实`)
      assert.deepEqual([[...new Set(projection.hops.map((hop) => hop.entityKind))].sort(), projection.degraded, projection.hops.filter((hop) =>
        hop.stale !== expected.stale.includes(hop.entityKind) || hop.unavailable !== (expected.unavailable ?? []).includes(hop.entityKind))],
      [expected.kinds ?? [...DELIVERY_SETS, 'execution_context', 'worktree'].sort(), expected.stale.length > 0, []], `${name}：保留的跳、降级，以及逐跳的陈旧与 unavailable`)
      const restarted = await compose(providers, { storage: reopen(storage) })
      assert.deepEqual(ciFacts(await restarted.queries.getDeliveryProjection(chain.scope)), ciFacts(projection), `${name}：重启后仍读到同样的事实`)
    }
  })
}

const sources = ['packages', 'apps'].map((name) => fileURLToPath(new URL(`../../${name}/`, import.meta.url))).flatMap((root) => readdirSync(root, { recursive: true }).filter((file) => /\.(ts|tsx|js|mjs)$/.test(file) && !file.split('/').includes('node_modules')).map((file) => [root, file]))
const callers = (pattern) => sources.filter(([root, file]) => pattern.test(readFileSync(join(root, file), 'utf8'))).map(([root, file]) => file).sort()

test('唯一写者：交付事实与谱系边只经 refreshDeliveryFacts 在一个事务里写入；重复刷新收敛，关系、事实与修订号不变，不写游标、不改规划状态（#221、#222、CONTRACTS K1、K5）', async () => {
  assert.deepEqual(callers(/\.putDeliveryFacts\(/), ['core/src/delivery-facts.ts'], '交付事实只有一个写入调用点')
  assert.deepEqual(callers(/(?<!function )\brecordEdges\(/), ['core/src/delivery-facts.ts', 'core/src/start-work.ts'], '谱系边只由开始工作与交付写者记录')
  const { providers, core, chain } = await chainOf('lineage-single-writer', { ingested: false })
  const state = async () => [(await providers.storage.listRelations(WORKSPACE.id)).length, await providers.storage.currentRevision(WORKSPACE.id)]
  const cursors = () => JSON.stringify(['cursors', 'reconcileCursors'].map((key) => exportFakeStorageState(providers.storage)[key]))
  const [untouched, planning] = [cursors(), await planningSnapshot(core)]
  const calls = [] // 事务内的写入走事务自己的实例，不经过这里的包装
  for (const method of ['putRelation', 'putEntity', 'putDeliveryFacts', 'transaction']) {
    const original = providers.storage[method].bind(providers.storage)
    providers.storage[method] = (...args) => { calls.push(method); return original(...args) }
  }
  await ingest(core, chain.scope)
  assert.deepEqual(calls, ['transaction'], '一次刷新恰好一个事务，事务之外没有任何关系、实体或交付事实写入')
  const [once, facts] = [await state(), ciFacts(await core.queries.getDeliveryProjection(chain.scope))]
  await ingest(core, chain.scope)
  await ingest(core, chain.scope)
  assert.deepEqual(await state(), once, '重复刷新不增加关系，也不推进修订号')
  assert.deepEqual(ciFacts(await core.queries.getDeliveryProjection(chain.scope)), facts, '事实不变')
  assert.equal(await planningSnapshot(core), planning, '交付刷新不改写规划状态')
  assert.equal(cursors(), untouched, '交付写者不写同步游标与对账游标（CONTRACTS K5）')
})

test('提交失败：写者事务被拒时返回结构化结果，已确认事实逐字保留并标陈旧（#221、CONTRACTS K2）', async () => {
  const { providers, core, chain } = await chainOf('lineage-commit-failure')
  const setsOf = (record) => record.sets.map(({ kind, nodes }) => ({ kind, nodes }))
  const prior = exportFakeStorageState(providers.storage)
  flood(providers.delivery.state.runs, 'run-new-', undefined, 1) // 这次读取会在事务里先写新实体与新边，再写快照
  throwInside(providers, 'putDeliveryFacts', '注入的提交失败 /secret/path', true)
  const result = await ingest(core, chain.scope)
  assert.equal(result.error?.code, 'unavailable', '前置：注入点被命中，提交失败是结构化结果')
  assert.ok(!JSON.stringify(result).includes('/secret/path'), '结果不得转发异常原文')
  const { relations, deliveryFacts: [record] } = exportFakeStorageState(providers.storage)
  assert.equal(relations.length, prior.relations.length, '事务里已写的边随回滚撤销（I2、I3）')
  assert.ok(record.attemptedAt > prior.deliveryFacts[0].attemptedAt, '失败的尝试也推进 attemptedAt：此后更旧的读取不得覆盖这次的陈旧标记')
  assert.deepEqual(setsOf(record), setsOf(prior.deliveryFacts[0]), '提交失败后已确认事实逐字保留')
  assert.ok(record.sets.every((set) => set.stale === true), '全部集合标陈旧')
})

test('刷新结果与快照时刻：没有锚点什么也不写，完整集合带本次读取时刻，陈旧集合保留上次确认时刻，重启后时钟回拨与同一对象内并发都不丢刷新，提交失败返回结构化错误（#221、CONTRACTS K2）', async () => {
  const { providers, chain } = await chainOf('lineage-refresh-result', { ingested: false })
  const context = await createContext({ workspace: WORKSPACE, providers, clock: tickingClock() })
  const record = () => exportFakeStorageState(providers.storage).deliveryFacts[0]
  assert.deepEqual(await refreshDeliveryFacts(context, { workItemId: 'no-context', repositoryId: REPOSITORY }),
    { ok: true, anchored: false, applied: false, gaps: [], error: undefined }, '没有已观察的执行上下文：什么也不写，也不算失败')
  const original = await providers.storage.getExecutionContext(chain.started.executionContextId)
  await providers.storage.putExecutionContext({ ...original, worktreeExternalId: undefined })
  assert.equal((await refreshDeliveryFacts(context, chain.scope)).anchored, false, '有执行上下文、没有工作树句柄：没有锚点，什么也不写')
  assert.equal(record(), undefined)
  await providers.storage.putExecutionContext(original)
  const first = await refreshDeliveryFacts(context, chain.scope)
  assert.deepEqual([first.ok, first.anchored, first.applied, first.gaps], [true, true, true, []])
  let confirmedAt = record().attemptedAt
  const early = await createContext({ workspace: WORKSPACE, providers, clock: () => '2000-01-01T00:00:00.000Z' }) // 重启后时钟早于已提交时刻，且不前进
  assert.deepEqual((await Promise.all([refreshDeliveryFacts(early, chain.scope), refreshDeliveryFacts(early, chain.scope)])).map((result) => result.applied), [true, true],
    '令牌按已提交的 attemptedAt 递增：重启后时钟回拨的刷新照常生效，不等时钟追上；同一对象内同一毫秒的两次并发刷新也各取各的令牌，后提交的不被当作平手放弃')
  assert.ok(record().attemptedAt > confirmedAt)
  confirmedAt = record().attemptedAt
  assert.deepEqual(record().sets.map((set) => [set.kind, set.stale, set.confirmedAt]), ['commit', 'change_request', 'pipeline_run', 'check_run'].map((kind) => [kind, false, confirmedAt]), '四个完整集合按固定顺序，都带本次读取时刻')
  providers.delivery.faultsSwitch.set(FaultKind.Offline, true)
  const second = await refreshDeliveryFacts(context, chain.scope)
  assert.deepEqual(second.gaps.map((gap) => gap.key).sort(), ['delivery.check.read', 'delivery.pipeline.read'], '缺口只来自 Delivery 的两处读取')
  assert.equal((await readDeliveryProjection(context, chain.scope)).degraded, true, '纯读路径自己据快照里的陈旧集合降级，不靠刷新结果')
  assert.deepEqual(record().sets.map((set) => [set.kind, set.stale, set.confirmedAt === confirmedAt]), [['commit', false, false], ['change_request', false, false], ['pipeline_run', true, true], ['check_run', true, true]],
    'Development 的两个集合重新确认；Delivery 的两个集合保留上次确认的时刻并标陈旧')
  let restore = stub(providers.storage, 'transaction', () => Promise.reject(new Error('注入的提交失败 /secret/path')))
  const failed = await refreshDeliveryFacts(context, chain.scope)
  restore()
  assert.deepEqual([failed.ok, failed.anchored, failed.applied, failed.error?.code], [false, true, false, 'unavailable'], '提交失败是结构化结果，不裸抛；锚点在提交之前已确认')
  assert.ok(!JSON.stringify(failed).includes('/secret/path'), '不转发异常原文')
  restore = stub(providers.storage, 'getDeliveryFacts', () => Promise.reject(new Error('注入的读失败 /secret/path')))
  const unreadable = await refreshDeliveryFacts(context, chain.scope) // 取令牌用的那次读失败：退回墙钟与本对象的上一次时刻
  restore()
  providers.delivery.listPipelineRuns = async () => { throw new Error('PROVIDER-RAW /secret/path') }
  const unrecorded = await refreshDeliveryFacts(context, chain.scope)
  assert.deepEqual([unreadable.ok, unrecorded.ok, unrecorded.anchored, unrecorded.error?.code], [true, false, false, 'unavailable'], '取令牌用的存储读失败不阻断刷新也不裸抛；provider 读异常是结构化失败，读取阶段就失败时还不知道有没有锚点')
})

test('两个上下文共享同一头提交：每个上下文的 CI 跳回指自己的提交，不是先写入的那一个（#221）', async () => {
  const { providers, core, chain: first } = await chainOf('lineage-shared-head-1')
  const second = await startChain(providers, core, 'lineage-shared-head-2', 1)
  await ingest(core, second.scope)
  const own = async (chain) => { const hops = await core.queries.getDeliveryLineage(chain.scope); return { hops, commit: hops.find((hop) => hop.entityKind === 'commit').from } }
  const [a, b] = [await own(first), await own(second)]
  assert.notEqual(a.commit, b.commit, '前置：两个上下文是两条分支，提交实体不同；同一个 sha 上的运行是同一个流水线实体')
  const kinds = new Map(exportFakeStorageState(providers.storage).entities.map((entity) => [entity.id, entity.kind]))
  for (const [chain, { hops }] of [[first, a], [second, b]]) {
    const [tracks, worktree] = ['tracks', 'has_worktree'].map((type) => hops.find((hop) => hop.relationType === type))
    assert.deepEqual([tracks.to, tracks.externalId], [chain.started.executionContextId, chain.started.executionContextId], '上下文跳回指自己的上下文')
    assert.deepEqual([worktree.from, worktree.externalId, worktree.label], [chain.started.executionContextId, chain.started.worktreeExternalId, chain.started.branchExternalId], '工作树跳挂在自己的上下文上、指向自己的工作树与分支')
    assert.equal(hops.find((hop) => hop.entityKind === 'change_request').externalId, providers.development.state.changeRequests.find((request) => request.headBranch === chain.started.branchExternalId).ref.externalId, '变更请求按本上下文的分支匹配，不是同一头提交上先建的那一个（TD-050）')
    const of = (kind) => hops.find((hop) => hop.entityKind === kind).from
    const anchors = { commit: worktree.to, change_request: worktree.to, pipeline_run: of('commit'), check_run: of('change_request') }
    const fromProvider = hops.filter((hop) => hop.provenance === 'provider_read')
    assert.ok(fromProvider.length === 7 && fromProvider.every((hop) => hop.to === anchors[hop.entityKind] && kinds.get(hop.from) === hop.entityKind), '提交与变更请求挂工作树、流水线挂本上下文自己的提交（不是先写入的那一个）、检查挂变更请求，端点实体按自己的种类登记')
  }
})

test('读路径先读快照再读关系：两次读取之间提交了新刷新，快照里的节点也不会因关系还是旧的而被悄悄丢掉（#221）', async () => {
  const { providers, chain } = await chainOf('lineage-read-order')
  const context = await createContext({ workspace: WORKSPACE, providers })
  flood(providers.delivery.state.runs, 'run-new-', undefined, 1) // 下一次刷新引入新的节点与新的边
  const read = providers.storage.getDeliveryFacts.bind(providers.storage)
  // 刷新恰好提交在两次读取之间：第一次读快照时先跑一次刷新，之后的读取照常。
  providers.storage.getDeliveryFacts = async (...args) => { providers.storage.getDeliveryFacts = read; await refreshDeliveryFacts(context, chain.scope); return read(...args) }
  const projection = await readDeliveryProjection(context, chain.scope)
  assert.equal(ciHops(projection).length, 6, '快照里的六个 CI 节点都有跳：读到新快照时关系不会还是旧的')
  assert.equal(projection.degraded, false, '短暂的不一致不得被读成「确认不存在」')
})

/** 让第一次流水线读取读完原状态后停住，`release` 放行：这次读取开始得早、提交得晚，就是「较旧的读取」。之后的读取照常。 */
function holdFirstRead(providers) {
  const list = providers.delivery.listPipelineRuns.bind(providers.delivery)
  const [entered, gate] = [Promise.withResolvers(), Promise.withResolvers()]
  providers.delivery.listPipelineRuns = async (input) => {
    providers.delivery.listPipelineRuns = list
    const read = await list(input)
    entered.resolve()
    await gate.promise
    return read
  }
  return { waiting: entered.promise, release: gate.resolve }
}

// 同一毫秒是常态（替身上连续两次刷新就拿到同一时刻，S4）：守卫不能靠时间戳的先后分高下。时钟不前进是最难的一种，令牌只能来自已提交的快照与对象内计数；
// 递增与回拨两种时钟杀死的变异它都杀死（S34），不另列。最后一行是两个 core 上下文对象共用这只时钟：令牌取自已提交的快照，与上下文对象、墙钟无关，两次读取拿到平手的令牌，较旧的提交失败时也只有 `>=` 不把较新的快照标陈旧。
const CLOCKS = [
  ['时钟不前进', () => () => '2026-10-08T00:00:00.000Z', 1],
  ['两个 core 上下文对象', () => () => '2026-10-08T00:00:00.000Z', 2],
]
for (const [clockName, makeClock, objects] of CLOCKS) {
  for (const commits of [true, false]) {
    test(`乱序（${clockName}，较旧的读取${commits ? '提交成功' : '提交失败'}）：不覆盖也不标陈旧较新已提交的事实，被放弃的刷新与没有锚点的刷新让仍显示的旧快照逐跳标陈旧并降级（#221，#222 的收敛性质由唯一写者承担）`, { timeout: 5000 }, async () => {
      const providers = createFakeProviders()
      const clock = makeClock()
      const { core: a, chain } = await chainOf('lineage-out-of-order', { providers, extra: { clock } })
      const b = objects === 2 ? await compose(providers, { clock }) : a
      const { waiting, release } = holdFirstRead(providers)
      const older = ingest(a, chain.scope)
      await waiting
      providers.delivery.state.runs.find((run) => run.ref.externalId === 'run-1').conclusion = 'failure'
      await ingest(b, chain.scope) // 较新的读取先提交：run-1 现在是失败
      if (!commits) { const restore = stub(providers.storage, 'transaction', () => (restore(), Promise.reject(new Error('注入的提交失败')))) } // 只拒绝较旧读取的那一次提交
      release()
      const dropped = await older
      const record = exportFakeStorageState(providers.storage).deliveryFacts[0]
      assert.equal(record.sets.find((set) => set.kind === 'pipeline_run').nodes.find((node) => node.externalId === 'run-1').fact, 'ci_failed', '较旧的读取晚提交时不得覆盖较新的事实')
      assert.ok(record.sets.every((set) => !set.stale), '较旧读取的失败也不得把较新已确认的集合标陈旧')
      const fromProvider = (projection) => projection.hops.filter((hop) => hop.provenance === 'provider_read')
      assert.ok(fromProvider(dropped).length === 7 && fromProvider(dropped).every((hop) => hop.stale === true) && dropped.degraded, '被放弃或失败的刷新不能证明显示的是最新：四个集合的跳（controller 转发的就是跳）全部 stale')
      assert.ok(dropped.hops.filter((hop) => hop.provenance === 'command').every((hop) => hop.stale === false), 'tracks / has_worktree 是命令事实，不因刷新被放弃而陈旧')
      const context = await providers.storage.getExecutionContext(chain.started.executionContextId) // 失败的重新供应会清空工作树句柄（start-work 的 saveContext）
      await providers.storage.putExecutionContext({ ...context, worktreeExternalId: undefined })
      const unanchored = await ingest(b, chain.scope)
      assert.ok(fromProvider(unanchored).length === 7 && fromProvider(unanchored).every((hop) => hop.stale === true) && unanchored.degraded, '没有锚点的刷新什么也没读：旧快照照样显示，但逐跳标陈旧并降级')
    })
  }
}

test('没有可提交的快照时：首次刷新失败、只有缺口、首次读取就读不完，都让投影降级且不展示未确认的事实（#221、K2、TD-040）', async () => {
  const { providers, core, chain } = await chainOf('lineage-no-snapshot', { ingested: false })
  const restore = stub(providers.delivery, 'listPipelineRuns', async () => { throw new Error('PROVIDER-RAW /secret/path') })
  const failed = await ingest(core, chain.scope)
  assert.deepEqual([failed.degraded, failed.error?.code, failed.hops.map((hop) => hop.relationType).sort()], [true, 'unavailable', ['has_worktree', 'tracks']], '首次刷新就失败：没有快照，仍降级并带结构化错误；命令事实照常显示')
  assert.equal(exportFakeStorageState(providers.storage).deliveryFacts.length, 0)
  restore()
  endless(providers.delivery, 'listPipelineRuns')
  const truncated = await ingest(core, chain.scope)
  assert.deepEqual([truncated.degraded, truncated.hops.filter((hop) => hop.entityKind === 'pipeline_run').length, truncated.hops.filter((hop) => hop.entityKind === 'check_run').length], [true, 0, 3],
    '首次读取就读不完：流水线集合从未确认，不展示读到的部分；检查集合完整读到')
  assert.deepEqual(exportFakeStorageState(providers.storage).deliveryFacts[0].sets.map((set) => [set.kind, set.stale]), [['commit', false], ['change_request', false], ['pipeline_run', true], ['check_run', false]],
    '从未确认的集合存成陈旧，不是「确认为空」：PR-D 的纯读只看快照')
  const second = await workItemIdOf(core, 1) // 没有执行上下文的另一个工作项：Development 路由失败只产生缺口，不产生快照
  const blind = await ingest(await compose(providers, { policy: { [CapabilityKey.DevelopmentRepositoryRead]: AccessLevel.Unavailable } }), { workItemId: second, repositoryId: REPOSITORY })
  assert.deepEqual([blind.degraded, blind.hops.length, blind.error], [true, 0, undefined], '只有缺口、没有快照：降级，不是错误')
})

test('谱系写者不写命令边：开始工作的最终事务失败后刷新不补写 tracks / has_worktree（TD-009、TD-014）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  // 最终事务（settle）写写账本：让它抛错，开始工作就停在 Provisioning，已建的分支与工作树留在外部。
  const restore = throwInside(providers, 'putMutationAttempt', '注入的最终事务失败')
  await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'lineage-half-commit' })
  restore()
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.equal(view.status, 'provisioning', '前置：最终事务失败，上下文停在 Provisioning')
  assert.ok(view.worktreeExternalId !== undefined, '前置：工作树已在外部建好')
  await ingest(core, { workItemId, repositoryId: REPOSITORY })
  const types = (await providers.storage.listRelations(WORKSPACE.id)).map((relation) => relation.type)
  assert.ok(!types.includes('tracks') && !types.includes('has_worktree'), `刷新不得把半提交"修复"成命令边，实际 ${types}`)
  assert.ok((await providers.storage.listRelations(WORKSPACE.id)).every((relation) => relation.state === RelationState.Candidate), '半提交的上下文上只会写出候选边，不会写出已确认的边（候选链边随 #222 的纯读一并取消，TD-009）')
})

async function planningSnapshot(core) {
  return (await core.queries.listPlanningItems()).map((item) => `${item.entityId}:${item.planningStatus}`).sort().join('|')
}
