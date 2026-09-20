/**
 * MVP-0 进度轨道：一条**故意失败**的端到端链路断言。
 *
 * 链路（issue #7）：工作区 → 规划条目 → 工作项 → 开始工作 → 执行上下文 → 分支/变更请求 → CI。
 * 每个节点一条断言；断言名说明它保护哪条不变量（tests/README.md §3），失败信息点名"哪个节点还没有实现"。
 *
 * 为什么失败不是语法或导入错误：包全部存在且可 import，断言只检查"所需导出是否已经存在、链路能不能走通"，
 * 所以现在的失败是 assert 失败，而不是 SyntaxError / TypeError。也不使用 skip——skip 不产生压力（issue #42）。
 *
 * 它当前**必须失败**；每实现一个节点，失败断言数单调下降。Batch C5 让它全绿并把它提升进 `pnpm verify`。
 * 本文件同时钉下期望的 CoreApi 表面：`composeCore(deps)` → `{ queries, commands }`，方法名沿用
 * capabilities 各 port 的动词。后续批次若不采用某个名字，必须显式改这条断言并说明原因，不允许改成
 * skip 或删除。完整说明见 tests/mvp0/README.md 与 ExecPlan Batch C1。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ContentKind, ExecutionContextStatus, RelationSource, WriteState, isAuthoritativeWriteState,
} from '@harness-projects/domain'
import * as core from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'

const CHAIN = '工作区 → 规划条目 → 工作项 → 开始工作 → 执行上下文 → 分支/变更请求 → CI'
const WORK_ITEM = { workItemId: '<work-item>', repositoryId: '<repository>' }

/** 未实现节点的统一失败：点名节点、缺了什么、以及该断言保护的不变量。 */
function notImplemented(node, missing, invariant, via) {
  const prefix = via === undefined ? '' : `（需要先由节点「${via}」补齐前序链路）`
  assert.fail(`节点「${node}」尚未实现：${missing}${prefix}。该断言保护的不变量：${invariant}。链路：${CHAIN}`)
}

/** 条件不成立时点名节点，避免 TypeError 掩盖真正的缺口。 */
function requireNode(node, invariant, condition, missing) {
  if (!condition) notImplemented(node, missing, invariant)
}

/** 读取组合根上的方法；缺失时点名调用方节点，而不是抛 TypeError。 */
function needMethod(api, methodPath, node, invariant) {
  let cursor = api
  for (const key of methodPath.split('.')) {
    cursor = cursor?.[key]
    if (typeof cursor !== 'function') notImplemented(node, `CoreApi.${methodPath} 还不是可调用的方法`, invariant)
  }
  return cursor
}

/** 组合根：core 只认识注入的 port，离线替身由测试层装配（ExecPlan D1 / Decision Log）。 */
async function composeFor(node, invariant) {
  if (typeof core.composeCore !== 'function') {
    notImplemented(node, '@harness-projects/core 尚未导出 composeCore', invariant, '工作区')
  }
  const providers = createFakeProviders()
  const api = await core.composeCore({ workspace: { name: 'MVP-0' }, providers })
  requireNode(node, invariant, api != null, 'composeCore 没有返回 CoreApi')
  return api
}

const has = (domainEnum, value) => Object.values(domainEnum).includes(value)

test('节点 1 · 工作区：同一工作空间同一时刻只有一个 Planning 事实源（不变量 1 / tests/README §2.2）', async () => {
  const invariant = '一个工作空间同一时刻只有一个 Planning 事实源'
  const api = await composeFor('工作区', invariant)
  const listBindings = needMethod(api, 'queries.listProviderBindings', '工作区', invariant)
  const bindings = await listBindings()
  requireNode('工作区', invariant, Array.isArray(bindings), 'listProviderBindings 必须返回绑定列表')
  const planning = bindings.filter((binding) => binding?.domain === 'planning' && binding?.isDefault === true)
  requireNode('工作区', invariant, planning.length === 1, `默认 Planning 绑定数为 ${planning.length}，必须恰好 1`)
})

test('节点 2 · 规划条目：内容与字段的事实源是 provider，本地投影只如实承载三态内容（tests/README §2.2）', async () => {
  const invariant = '规划内容与字段由 Planning provider 拥有，本地投影不得篡位为第二个事实源'
  const api = await composeFor('规划条目', invariant)
  const bootstrap = needMethod(api, 'commands.bootstrapWorkspace', '规划条目', invariant)
  const listItems = needMethod(api, 'queries.listPlanningItems', '规划条目', invariant)
  await bootstrap()
  const items = await listItems()
  requireNode('规划条目', invariant, Array.isArray(items) && items.length > 0, '引导后投影里必须至少有一个规划条目')
  requireNode(
    '规划条目', invariant,
    items.every((item) => has(ContentKind, item?.content?.contentKind)),
    '每个条目的内容必须是 work_item / change_request / redacted 三态之一，不能是本地合成值',
  )
})

test('节点 3 · 工作项：一个外部对象对应一个稳定内部实体，Draft→Issue 提升不换 id（tests/README §2.1）', async () => {
  const invariant = '身份不变量：Draft → Issue 提升后内部 Entity id 不变，同一实体任一时刻只有一个 primary 身份'
  const api = await composeFor('工作项', invariant)
  const listItems = needMethod(api, 'queries.listPlanningItems', '工作项', invariant)
  const getDetail = needMethod(api, 'queries.getItemDetail', '工作项', invariant)
  const items = await listItems()
  requireNode('工作项', invariant, Array.isArray(items) && items.length > 0, '先要有规划条目才谈得上工作项', '规划条目')
  const detail = await getDetail(items[0].entityId)
  requireNode('工作项', invariant, detail?.entityId === items[0].entityId, '详情必须回指同一个稳定内部 entityId')
  const primary = (detail.identities ?? []).filter((identity) => identity?.role === 'primary')
  requireNode('工作项', invariant, primary.length === 1, `primary 身份数为 ${primary.length}，必须恰好 1`)
})

test('节点 4 · 开始工作：拿到 provider 确认前不得报告为已保存（AGENTS.md §1.1 硬约束 / tests/README §2.3）', async () => {
  const invariant = '外部写入得到 Provider ack / reconcile 前，本地不得显示权威 Saved'
  const api = await composeFor('开始工作', invariant)
  const startWork = needMethod(api, 'commands.startWork', '开始工作', invariant)
  const result = await startWork({ ...WORK_ITEM, actor: { kind: 'agent' }, idempotencyKey: 'mvp0-start-work-1' })
  requireNode('开始工作', invariant, has(WriteState, result?.writeState), 'startWork 必须返回 domain 的 WriteState')
  requireNode(
    '开始工作', invariant,
    !isAuthoritativeWriteState(result.writeState) || result.confirmed === true,
    'writeState 为 saved 时必须有 provider 确认，否则只能显示 pending / unknown',
  )
})

test('节点 5 · 执行上下文：同一工作项 + 仓库重复开始不产生第二份上下文（ExecPlan D4 / tests/README §2.5）', async () => {
  const invariant = '同一工作项 + 仓库最多一个 active 执行上下文；重复开始复用而不是新建'
  const api = await composeFor('执行上下文', invariant)
  const startWork = needMethod(api, 'commands.startWork', '执行上下文', invariant)
  const getContext = needMethod(api, 'queries.getExecutionContext', '执行上下文', invariant)
  const request = { ...WORK_ITEM, actor: { kind: 'agent' }, idempotencyKey: 'mvp0-start-work-1' }
  const first = await startWork(request)
  const second = await startWork({ ...request, idempotencyKey: 'mvp0-start-work-2' })
  const context = await getContext(WORK_ITEM)
  requireNode('执行上下文', invariant, context != null, '按工作项与仓库必须能查回执行上下文')
  requireNode('执行上下文', invariant, has(ExecutionContextStatus, context.status), '执行上下文状态必须是 domain 的 ExecutionContextStatus')
  requireNode('执行上下文', invariant, first?.executionContextId === second?.executionContextId, '重复开始必须返回同一个执行上下文 id')
})

test('节点 6 · 分支/变更请求：谱系沿已记录关系传播，不反复重新识别对象（不变量 6 / tests/README §2.4）', async () => {
  const invariant = '工程产物关系沿谱系传播：分支 / 变更请求按已记录关系读回，不重新识别'
  const api = await composeFor('分支/变更请求', invariant)
  const lineage = needMethod(api, 'queries.getDeliveryLineage', '分支/变更请求', invariant)
  const hops = await lineage(WORK_ITEM)
  requireNode('分支/变更请求', invariant, Array.isArray(hops), '交付谱系必须是一个跳（hop）列表')
  const types = new Set(hops.map((hop) => hop?.relationType))
  requireNode('分支/变更请求', invariant, types.has('has_worktree'), `谱系缺少工作树跳，实际只有 ${[...types].join(', ')}`)
  requireNode('分支/变更请求', invariant, types.has('produced_by'), `谱系缺少变更请求跳，实际只有 ${[...types].join(', ')}`)
  requireNode('分支/变更请求', invariant, hops.every((hop) => hop?.source === RelationSource.Lineage), '谱系跳必须标记为 lineage 来源，不能重新识别')
})

test('节点 7 · CI：工程事实（CI 结果）不改写规划状态（不变量 3 / tests/README §2.2）', async () => {
  const invariant = '规划状态与工程执行状态正交：CI 事实不得默认覆盖规划状态'
  const api = await composeFor('CI', invariant)
  const lineage = needMethod(api, 'queries.getDeliveryLineage', 'CI', invariant)
  const listItems = needMethod(api, 'queries.listPlanningItems', 'CI', invariant)
  const snapshot = async () => (await listItems()).map((item) => `${item.entityId}:${item.planningStatus}`).sort().join('|')
  const before = await snapshot()
  const hops = await lineage(WORK_ITEM)
  requireNode('CI', invariant, Array.isArray(hops) && hops.some((hop) => hop?.relationType === 'runs_on'), '谱系里必须能看到 CI 事实（runs_on 跳）')
  requireNode('CI', invariant, before === (await snapshot()), '读取 CI 事实后规划状态发生了变化（前 ≠ 后）')
})
