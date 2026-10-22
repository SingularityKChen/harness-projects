/**
 * Batch C4 端到端：状态策略（issue #78 / ExecPlan D6、AGENTS.md §1.1 不变量 3）。产品面的 source_managed / harness_managed / manual
 * 对应领域枚举的 provider_authoritative / host_authoritative / manual_only；三种策略下 CI 失败、执行完成、PR 合并都不得改写规划状态，
 * 唯一允许的联动是显式命令。每条负向用例都断言"存储里的规划状态原值不变"，而不只是看一眼决策函数的返回值。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { test } from 'node:test'
import { isDeepStrictEqual } from 'node:util'

import { ContentKind, DerivedFlag, EngineeringFactKind, NormalizedStatus, RedactionReason, StatusPolicy, newWorkspaceId } from '@harness-projects/domain'
import { StatusPolicyMode, composeCore, decideFromEngineeringFact, policyMatrix, withDeliveryLineage } from '@harness-projects/core'
import { createFakeProviders, createFakeStorage, refOf, removeItem } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const REPOSITORY = 'repo-alpha'
const MODES = [
  { mode: StatusPolicyMode.SourceManaged, policy: StatusPolicy.ProviderAuthoritative },
  { mode: StatusPolicyMode.HarnessManaged, policy: StatusPolicy.HostAuthoritative },
  { mode: StatusPolicyMode.Manual, policy: StatusPolicy.ManualOnly },
]
const FACT_KINDS = [EngineeringFactKind.CiFailed, EngineeringFactKind.ExecutionCompleted, EngineeringFactKind.ChangeRequestMerged]

async function composeFor(policy) {
  const providers = createFakeProviders()
  const workspace = { id: newWorkspaceId(), name: `MVP-0/${policy}`, statusPolicy: policy }
  const core = await composeCore({ workspace, providers })
  const workItemId = await workItemIdOf(core)
  return { providers, core, workItemId, workspaceId: workspace.id }
}

/** 投影按内部 entityId 排序，而 id 是随机的：必须显式挑一个未完成的工作项，否则断言会随排序抖动。 */
async function workItemIdOf(core) {
  const items = await core.queries.listPlanningItems()
  const item = items.find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item' && view.planningStatus !== NormalizedStatus.Done) // redacted 条目的 kind 也是 work_item（issue-3），但没有可操作的规划条目，不能当开始工作的对象
  assert.ok(item, 'planning 种子里必须有一个未完成的工作项')
  return item.entityId
}

async function statusOf(core, entityId) {
  return (await core.queries.getItemDetail(entityId))?.planningStatus
}

/**
 * #303 竞态：小范围调度探索 + 串行参照预言机。命令（applyPlanningStatus）与同步（bootstrapWorkspace）各跑一次。
 * 抢占点 = 某个 actor 不在自己事务体内时发出的每个 Storage 调用（含 transaction 入口）。事务体内不设点，依赖 Storage 契约
 * （tests/contract/suites/storage.js 的「重叠事务串行提交」与「事务未提交的写入不得被事务外的读看到」）：重叠事务整体串行、
 * 未提交写入对外不可见，事务体对另一方就是一个原子单元。每个调度只抢占一个 actor 一次：它停在第 k 个抢占点之前
 * （k = 0..N，k = N 即不停），另一个 actor 完整跑完后再放行它。每个调度的可观察结果都必须等于两种串行顺序之一；
 * 期望值来自同一实现的串行运行，因此断言不绑定读点位置，也不绑定 #273 的同步策略。
 */
const actor = new AsyncLocalStorage()
const STORAGES = [['Fake Storage', createFakeStorage], ['SQLite', () => createSqliteStorage(':memory:')]]
const redactedAs = (reason) => (_state, item) => { item.content = { kind: ContentKind.Redacted, reason } }
/**
 * 竞态夹具的工作项带原生字段（Fake 种子只有 statusKey，没有展示字段）：状态经映射取自 status 单选，另有迭代与目标日期两个
 * 展示字段，让「状态命令用旧展示字段覆盖新值」在成功写入路径上可观察。
 */
const FIELD_MAPPING = {
  status: { projectFieldId: 'status', options: { todo: NormalizedStatus.Todo, in_progress: NormalizedStatus.InProgress, done: NormalizedStatus.Done } },
  iterationFieldId: 'iteration', targetDateFieldId: 'target',
}
const NATIVE = (option, date) => ({
  status: { kind: 'single_select', optionId: option, name: option },
  iteration: { kind: 'iteration', iterationId: 'iter-1', title: '迭代一', startDate: '2026-09-01', durationDays: 14 },
  target: { kind: 'date', date },
})
const REFRESHED = { title: '刷新后的标题', planningFields: { statusName: 'todo', iterationTitle: '迭代一', targetDate: '2026-10-20' } }
/** 同步要提交的 provider 侧变化；refresh 改标题与目标日期，并把 provider 状态改成与命令的 Done 不同的值，#273 无论怎么定都不会被掩盖。 */
const CHANGES = {
  redact: redactedAs(RedactionReason.PolicyRestricted),
  remove: (state, item) => removeItem(state, item.ref),
  refresh: (_state, item) => {
    item.content = { ...item.content, workItem: { ...item.content.workItem, title: REFRESHED.title } }
    item.fields = { ...item.fields, statusKey: 'todo', nativeValues: NATIVE('todo', REFRESHED.planningFields.targetDate) }
  },
}

/** 按 actor（AsyncLocalStorage）记录每个 Storage 调用；arm({ who, k, park }) 后 who 在它第 k 个抢占点之前停在 park 上。 */
function instrument(storage) {
  let calls
  let pause
  const holding = new Set()
  const wrap = (target, scoped) => new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object)
      if (typeof value !== 'function') return value
      return async (...args) => {
        const who = actor.getStore()
        const atomic = scoped || holding.has(who)
        if (calls !== undefined) {
          calls.push({ who, method: String(key), atomic })
          const point = calls.filter((call) => call.who === who && !call.atomic).length - 1
          if (!atomic && who === pause?.who && point === pause.k) await pause.park()
        }
        if (key !== 'transaction') return value.apply(object, args)
        return value.call(object, async (tx) => {
          holding.add(who)
          try { return await args[0](wrap(tx, true)) } finally { holding.delete(who) }
        })
      }
    },
  })
  return {
    storage: wrap(storage, false),
    arm: (next) => { calls = []; pause = next },
    disarm: () => { const recorded = calls; calls = undefined; pause = undefined; return recorded },
  }
}

/** 每次都是全新且确定的工作区：固定 id、绑定与时钟，让不同运行的结果可以直接深比较，无需归一化。 */
async function raceFixture(makeStorage, change, native = (record) => NATIVE(record.fields.statusKey, '2026-10-01')) {
  let seq = 0
  const next = (prefix) => () => `${prefix}-${String(++seq).padStart(4, '0')}`
  const providers = createFakeProviders({ planning: { bindingId: 'planning' }, development: { bindingId: 'development' },
    delivery: { bindingId: 'delivery' }, execution: { bindingId: 'execution' } })
  for (const record of providers.planning.state.items) {
    if (record.content.kind === ContentKind.WorkItem) record.fields = { ...record.fields, nativeValues: native(record) }
  }
  const storage = makeStorage()
  const probe = instrument(storage)
  const workspace = { id: 'workspace-race', name: 'status-race', statusPolicy: StatusPolicy.HostAuthoritative, planningFieldMapping: FIELD_MAPPING }
  const core = await composeCore({ workspace, providers, storage: probe.storage, clock: () => '2026-10-15T00:00:00.000Z',
    ids: { entityId: next('entity'), externalIdentityId: next('identity'), relationId: next('relation') } })
  const entityId = await workItemIdOf(core)
  const { content: { identity } } = await core.queries.getItemDetail(entityId)
  const item = providers.planning.state.items.find((candidate) => candidate.content.kind === ContentKind.WorkItem
    && candidate.content.workItem.externalId === identity.externalId)
  assert.ok(item, '前置条件：目标工作项必须能对应到 provider 条目')
  const observe = async () => {
    const rows = await storage.listPlanningProjections(workspace.id)
    return {
      target: rows.find((row) => row.entityId === entityId),
      others: rows.filter((row) => row.entityId !== entityId),
      identities: await storage.listIdentitiesForEntity(entityId),
      detail: await core.queries.getItemDetail(entityId),
      revision: await storage.currentRevision(workspace.id),
    }
  }
  return {
    probe, observe,
    command: () => core.commands.applyPlanningStatus({ entityId, status: NormalizedStatus.Done }),
    sync: () => { change(providers.planning.state, item); return core.commands.bootstrapWorkspace() },
  }
}

async function outcomeOf(fx, decision, synced) {
  return { decision: { wrote: decision.wrote, status: decision.status, code: decision.error?.code },
    sync: { ok: synced.ok, code: synced.error?.code }, ...await fx.observe() }
}

/** 串行参照：两个操作按 order 依次完整执行；mid 是第一个操作之后的状态。 */
async function runSerial(makeStorage, change, order) {
  const fx = await raceFixture(makeStorage, change)
  const initial = await fx.observe()
  const results = {}
  let mid
  for (const op of order) {
    results[op] = await fx[op]()
    mid ??= await fx.observe()
  }
  return { initial, mid, outcome: await outcomeOf(fx, results.command, results.sync) }
}

/** 一个调度：who 停在第 k 个抢占点之前（k = Infinity 即不停），另一个 actor 完整跑完后再放行 who。 */
async function runSchedule(makeStorage, change, who, k) {
  const fx = await raceFixture(makeStorage, change)
  const other = who === 'command' ? 'sync' : 'command'
  const results = {}
  let reach
  const reached = new Promise((resolve) => { reach = resolve })
  fx.probe.arm({ who, k, park: () => new Promise((release) => reach(release)) })
  const running = actor.run(who, fx[who]).then((result) => { results[who] = result })
  const release = await Promise.race([reached, running.then(() => undefined)])
  results[other] = await actor.run(other, fx[other])
  release?.()
  await running
  const calls = fx.probe.disarm()
  return { paused: release !== undefined, calls, outcome: await outcomeOf(fx, results.command, results.sync) }
}

test('工程事实（CI 失败 / 执行完成 / PR 合并）：三种策略下规划状态都原值不变（不变量 3）', async () => {
  assert.equal(policyMatrix().length, 3, '策略矩阵必须覆盖三种策略')
  assert.deepEqual(policyMatrix().map((row) => row.engineeringFactWrites), [false, false, false])
  for (const { mode, policy } of MODES) for (const kind of FACT_KINDS) {
    const { providers, core, workItemId, workspaceId } = await composeFor(policy)
    const before = await statusOf(core, workItemId)
    const projection = await providers.storage.getPlanningProjection(workspaceId, workItemId)
    const decision = decideFromEngineeringFact({ projection, facts: [{ kind, subjectId: workItemId }], policy,
      incoming: NormalizedStatus.Done })
    const label = `${mode}/${kind}`
    assert.equal(decision.wrote, false, `${label}：工程事实不得写入规划状态`)
    assert.equal(decision.status, before, `${label}：决策必须原值返回，而不是 incoming`)
    assert.equal(decision.error, undefined, `${label}：工程事实不是错误`)
    const stored = await providers.storage.getPlanningProjection(workspaceId, workItemId)
    assert.equal(stored.planningStatus, before, `${label}：存储中的规划状态不得改变`)
    assert.equal(await statusOf(core, workItemId), before, `${label}：查询到的规划状态不得改变`)
  }
})

test('显式命令是唯一允许的联动：harness_managed / manual 写入，source_managed 拒绝（D6）', async () => {
  for (const { mode, policy } of MODES) {
    const { core, workItemId } = await composeFor(policy)
    const before = await statusOf(core, workItemId)
    assert.notEqual(before, NormalizedStatus.Done, `${mode}：种子里第一个工作项应不是 done`)
    const decision = await core.commands.applyPlanningStatus({ entityId: workItemId, status: NormalizedStatus.Done })
    if (policy === StatusPolicy.ProviderAuthoritative) {
      assert.equal(decision.wrote, false, `${mode}：provider 拥有规划状态，显式命令也必须被拒绝`)
      assert.equal(decision.error.code, 'not_supported')
      assert.equal(await statusOf(core, workItemId), before, `${mode}：被拒绝的命令不得留下任何改动`)
      continue
    }
    assert.equal(decision.wrote, true, `${mode}：显式命令必须写入`)
    assert.equal(await statusOf(core, workItemId), NormalizedStatus.Done, `${mode}：显式命令的结果必须可查询`)
  }
})

/**
 * 不可见目标：[名称, provider 侧变化, 同步后目标行的内容类型, 同步后 redacted 行是否留着非 unknown 的状态]。没有原生字段时同步
 * 沿用 statusKey，redacted 行留着旧状态，所以可见性只能按内容判定，不能按「状态是 unknown」判定。带原生字段的 redacted 行
 * 现在同步为 unknown，但那取决于 #273 的同步策略，这里不断言。
 */
const withoutNativeFields = (change) => (state, item) => { item.fields = { ...item.fields, nativeValues: undefined }; change(state, item) }
const REFUSALS = [['remove', CHANGES.remove, undefined, false],
  ...Object.values(RedactionReason).map((reason) => [`redact/${reason}`, redactedAs(reason), ContentKind.Redacted, false]),
  ['redact（statusKey 分支）', withoutNativeFields(redactedAs(RedactionReason.PolicyRestricted)), ContentKind.Redacted, true]]

for (const [label, makeStorage] of STORAGES) {
  for (const [name, change, contentKind, keepsStatus] of REFUSALS) {
    test(`串行 sync→command：${name} 之后状态命令以 not_found 拒绝且没有任何副作用（#303，${label}）`, async () => {
      const { mid, outcome: { decision, sync, ...after } } = await runSerial(makeStorage, change, ['sync', 'command'])
      assert.equal(sync.ok, true, `${label}：同步必须提交`)
      assert.equal(mid.target?.content.contentKind, contentKind, `${label}：前置条件是已提交的 ${name}`)
      if (keepsStatus) assert.notEqual(mid.target.planningStatus, NormalizedStatus.Unknown, `${label}：前置条件是 redacted 行留着旧状态`)
      assert.deepEqual([decision.wrote, decision.code], [false, 'not_found'], `${label}：不可见目标必须统一拒绝`)
      assert.deepEqual(after, mid, `${label}：拒绝不得改写 content、identity、display、status、控制行或 revision`)
    })
  }

  // 状态选项从一开始就不在映射里（首次同步没有旧行，结果与 #273 无关）：条目可见、状态为 unknown，命令照常写入。
  test(`串行 command：可见但状态选项未映射（unknown）的条目照常写入（#303，${label}）`, async () => {
    const fx = await raceFixture(makeStorage, () => {}, () => NATIVE('triage', '2026-10-01'))
    const before = await fx.observe()
    assert.deepEqual([before.target.content.contentKind, before.target.planningStatus], [ContentKind.WorkItem, NormalizedStatus.Unknown], `${label}：前置条件是可见且状态为 unknown 的条目`)
    const decision = await fx.command()
    const { target, others, revision } = await fx.observe()
    assert.deepEqual([decision.wrote, decision.status, decision.error], [true, NormalizedStatus.Done, undefined], `${label}：状态 unknown 不等于不可见`)
    assert.deepEqual({ ...target, planningStatus: before.target.planningStatus, revision: before.target.revision }, before.target, `${label}：只改状态与行 revision`)
    assert.deepEqual([target.planningStatus, target.revision, revision], [NormalizedStatus.Done, before.revision + 1, before.revision + 1], `${label}：写入命令值并推进一次 revision`)
    assert.deepEqual(others, before.others, `${label}：不碰其它行`)
  })

  // 预言机只判「等于某个串行结果」：两个串行参照一致地错（例如同步丢掉可见刷新）时竞态用例照样全绿，所以 AC3 的参照本身要有绝对判据。
  test(`参照 refresh：两种先后顺序都保留新标题与新展示字段，目标行 revision 等于工作区 revision，其它行内容不变（#303 AC3，${label}）`, async () => {
    const commandFirst = await runSerial(makeStorage, CHANGES.refresh, ['command', 'sync'])
    const syncFirst = await runSerial(makeStorage, CHANGES.refresh, ['sync', 'command'])
    const { initial } = commandFirst
    const contentOf = (rows) => rows.map(({ revision: _revision, ...row }) => row)
    assert.deepEqual(syncFirst.initial, initial, '前置条件：两个参照从同一个确定的工作区出发')
    assert.notEqual(initial.target.content.title, REFRESHED.title, '前置条件：refresh 必须改变标题')
    assert.equal(initial.target.planningStatus, NormalizedStatus.InProgress, '前置条件：初始状态与 refresh 的 todo、命令的 done 都不同')
    assert.deepEqual(initial.target.planningFields, { statusName: 'in_progress', iterationTitle: '迭代一', targetDate: '2026-10-01' }, '前置条件：目标行带展示字段')
    for (const [order, { outcome }] of [['command→sync', commandFirst], ['sync→command', syncFirst]]) {
      const { decision, sync, target, others, revision } = outcome
      assert.deepEqual([decision.wrote, decision.status, decision.code, sync.ok], [true, NormalizedStatus.Done, undefined, true], `${order}：命令写入、同步提交`)
      assert.equal(target.content.title, REFRESHED.title, `${order}：可见内容刷新不得丢失`)
      assert.deepEqual(target.planningFields, REFRESHED.planningFields, `${order}：展示字段取刷新后的值`)
      assert.equal(target.revision, revision, `${order}：目标行 revision 等于工作区 revision`)
      assert.equal(revision, initial.revision + 2, `${order}：命令与内容变化的同步各推进一次工作区 revision`)
      assert.deepEqual(contentOf(others), contentOf(initial.others), `${order}：其它行内容不变（行 revision 按 ADR-0012 随推进的同步整批重盖）`)
    }
    assert.deepEqual(commandFirst.mid.others, initial.others, 'command→sync：命令不碰其它行（含行 revision）')
    assert.deepEqual(syncFirst.outcome.others, syncFirst.mid.others, 'sync→command：命令不碰其它行（含行 revision）')
    assert.equal(syncFirst.outcome.target.planningStatus, NormalizedStatus.Done, 'sync→command：状态是命令值')
    // #273 裁决前同步按 provider 值覆盖 Host 状态（todo）；裁决为同步保留 Host 状态后是命令值（done）。两者都是被允许的结果，#273 落地时收紧为其一。
    assert.ok([NormalizedStatus.Todo, NormalizedStatus.Done].includes(commandFirst.outcome.target.planningStatus),
      `command→sync：状态只能是 provider 值 todo 或命令值 done（#273），实际 ${commandFirst.outcome.target.planningStatus}`)
  })

  for (const [name, change] of Object.entries(CHANGES)) {
    test(`竞态：状态命令与 ${name} 同步在每个抢占点交错，结果都等于两种先后顺序之一（#303，${label}）`, async () => {
      const commandFirst = await runSerial(makeStorage, change, ['command', 'sync'])
      const syncFirst = await runSerial(makeStorage, change, ['sync', 'command'])
      assert.notDeepEqual(commandFirst.mid, commandFirst.initial, '防空转：命令单独执行必须改变工作区')
      assert.notDeepEqual(syncFirst.mid, syncFirst.initial, '防空转：同步单独执行必须改变工作区')
      const serial = [commandFirst.outcome, syncFirst.outcome]
      for (const [who, pausedFirst, unpaused] of [['command', syncFirst, commandFirst], ['sync', commandFirst, syncFirst]]) {
        const last = await runSchedule(makeStorage, change, who, Infinity)
        const n = last.calls.filter((call) => call.who === who && !call.atomic).length
        assert.ok(n > 0, `防空转：${who} 必须至少有一个抢占点`)
        const runs = []
        for (let k = 0; k < n; k += 1) runs.push(await runSchedule(makeStorage, change, who, k))
        runs.push(last)
        for (const [k, run] of runs.entries()) {
          assert.equal(run.paused, k < n, `防空转：${who} k=${k} 的停点必须真的命中`)
          assert.deepEqual(run.calls.filter((call) => call.who === undefined), [], `${who} k=${k}：每个 Storage 调用都必须归属某个 actor`)
          // 不等于任何串行结果时，挑决策相同的参照做 diff，失败信息才指得出哪里不同。
          const expected = serial.find((outcome) => isDeepStrictEqual(outcome, run.outcome))
            ?? serial.find((outcome) => isDeepStrictEqual(outcome.decision, run.outcome.decision)) ?? serial[0]
          assert.deepEqual(run.outcome, expected, `${who} k=${k}/${n}：交错结果必须等于某个串行顺序的结果`)
        }
        assert.deepEqual(runs[0].outcome, pausedFirst.outcome, `防空转：${who} 在 k=0 停住必须复现另一方先行的串行顺序`)
        assert.deepEqual(runs[n].outcome, unpaused.outcome, `防空转：${who} 不停必须复现自己先行的串行顺序`)
      }
    })
  }
}

test('交付谱系里的 CI 失败只进 derived 块：planningStatus 与内容逐字保留（不变量 3 / D5）', async () => {
  const providers = createFakeProviders()
  const workspace = { id: newWorkspaceId(), name: 'MVP-0/ci-failure', statusPolicy: StatusPolicy.ManualOnly }
  const core = await composeCore({ workspace, providers })
  const workItemId = await workItemIdOf(core)
  const started = await core.commands.startWork({ repositoryId: REPOSITORY, actor: { kind: 'agent' }, workItemId, idempotencyKey: 'ci-failure-1' })
  assert.equal(started.confirmed, true, 'git 步骤必须拿到 provider ack')
  providers.delivery.state.runs.push({
    ref: refOf(providers.delivery.gate.bindingId, 'pipeline_run', 'run-fail'),
    repository: refOf(providers.delivery.gate.bindingId, 'repository', REPOSITORY),
    status: 'completed', commit: providers.development.state.commits[0].sha, conclusion: 'failure' })
  const view = (await core.queries.listPlanningItems()).find((item) => item.entityId === workItemId)
  await core.commands.refreshDeliveryFacts({ workItemId, repositoryId: REPOSITORY }) // 查询纯读（#222）：交付事实只经刷新命令摄入
  const hops = await core.queries.getDeliveryLineage({ workItemId, repositoryId: REPOSITORY })
  assert.ok(hops.some((hop) => hop.fact === EngineeringFactKind.CiFailed), 'CI 失败必须作为工程事实出现在谱系里')
  const folded = withDeliveryLineage(view, hops, workItemId)
  assert.equal(folded.planningStatus, view.planningStatus, '折入交付谱系不得改写规划状态')
  assert.deepEqual(folded.content, view.content, '内容字段逐字保留')
  assert.deepEqual(
    folded.engineering.facts.map((fact) => fact.kind).sort(),
    [EngineeringFactKind.CiFailed, EngineeringFactKind.CiPassed].sort(), '谱系里的 CI 结论必须逐条折成工程事实')
  assert.ok(folded.engineering.derived.includes(DerivedFlag.CiFailing), 'CI 失败必须出现在派生标记里')
  assert.ok(folded.engineering.derived.includes(DerivedFlag.Attention))
  assert.equal(await statusOf(core, workItemId), view.planningStatus, '存储中的规划状态不变')
})
