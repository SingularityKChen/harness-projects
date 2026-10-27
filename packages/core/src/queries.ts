/**
 */
import {
  AccessLevel,
  CapabilityDomain,
  CapabilityKey,
  SyncState,
  bindingForCapability,
  bindingsForDomain,
  singlePlanningBinding,
  type EffectiveCapability,
  type ProviderBindingRecord,
  type StorageTransaction,
} from '@harness-projects/capabilities'
import { IdentityRole, type EntityId, type ExternalIdentity, type ProviderBindingId, type WorkspaceId } from '@harness-projects/domain'
import { gateCommand } from './capabilities.ts'
import { PLANNING_SYNC_SCOPE } from './bootstrap.ts'
import type { CoreContext } from './context.ts'
import {
  getDeliveryProjection, type DeliveryLineageHop, type DeliveryProjection, type DeliveryScope,
} from './delivery.ts'
import { CHANGE_REQUEST_READ_ROUTE, START_WORK_ROUTE, repositoryReferences, routeDevelopment } from './development-route.ts'
import { readExecutionContext, type ExecutionContextQuery, type ExecutionContextView } from './execution-context.ts'
import {
  toPlanningItemView,
  type PlanningItemDetail,
  type PlanningItemView,
  type SyncSummary,
} from './projection.ts'

/** 工作区读取的元数据：descriptor 来自已确认的 Storage 记录，能力来自本 Core 已确认的 registry；不含实例或凭据。 */
export interface WorkspaceMetadata {
  readonly workspace: { readonly id: WorkspaceId; readonly name: string } | undefined
  readonly capabilities: readonly EffectiveCapability[]
  /** 已登记的仓库，按 id 升序；没有登记时是空数组。 */
  readonly repositories: readonly RepositoryMetadata[]
  /** 规划来源（#383）：已组合的规划挂载与它的显示名（引导读到的项目标题）；没有规划挂载、或名字还未知（空标题同样算未知）时 undefined。 */
  readonly planningSource: { readonly bindingId: ProviderBindingId; readonly name: string; readonly mappingOrigin?: 'derived' | 'user' } | undefined
}

/**
 * 一个仓库的现行引用与逐操作的可用性（#353）：`capabilities` 的每个 key 恰好一条，来自该操作路由到的挂载（`bindingId` 即服务者）；
 * 路由被拒（歧义、缺路由、门拒绝）时这些 key 报 unavailable，`reason` 是拒绝文案。工作区级 `capabilities` 不变。
 */
export interface RepositoryMetadata {
  readonly id: string
  readonly references: readonly { readonly bindingId: ProviderBindingId; readonly role: IdentityRole }[]
  readonly capabilities: readonly EffectiveCapability[]
}

export interface CoreQueries {
  listProviderBindings(): Promise<readonly ProviderBindingRecord[]>
  listPlanningItems(): Promise<readonly PlanningItemView[]>
  getItemDetail(entityId: EntityId): Promise<PlanningItemDetail | undefined>
  getExecutionContext(query: ExecutionContextQuery): Promise<ExecutionContextView | undefined>
  /** 工作区级规划新鲜度：与逐条 freshness 同源；没有条目时它是表达「不完整 / 权限缺口」的唯一载体。 */
  getPlanningSync(): Promise<SyncSummary>
  getWorkspaceMetadata(): Promise<WorkspaceMetadata>
  /** 交付投影：链路事实 + 能力状态 + 新鲜度与缺口；纯读已提交事实，不调 provider、不写任何东西（#222）。 */
  getDeliveryProjection(scope: DeliveryScope): Promise<DeliveryProjection>
  /** 工作项 → 执行上下文 → 分支 → 提交 → 变更请求 → CI 的可查询谱系。 */
  getDeliveryLineage(scope: DeliveryScope): Promise<readonly DeliveryLineageHop[]>
}

export function createQueries(context: CoreContext): CoreQueries {
  return {
    listProviderBindings: () => context.storage.listProviderBindings(context.workspaceId),

    async listPlanningItems(): Promise<readonly PlanningItemView[]> {
      const sync = await syncSummary(context)
      const projections = await context.storage.listPlanningProjections(context.workspaceId)
      const views: PlanningItemView[] = []
      for (const projection of projections) {
        const identity = await primaryIdentity(context, projection.entityId)
        if (identity !== undefined) views.push(toPlanningItemView(projection, identity, sync))
      }
      return views.sort((left, right) => (left.entityId < right.entityId ? -1 : 1))
    },

    async getItemDetail(entityId: EntityId): Promise<PlanningItemDetail | undefined> {
      const projection = await context.storage.getPlanningProjection(context.workspaceId, entityId)
      if (projection === undefined) return undefined
      const identities = await context.storage.listIdentitiesForEntity(entityId)
      const primary = identities.find((identity) => identity.role === IdentityRole.Primary)
      if (primary === undefined) return undefined
      const sync = await syncSummary(context)
      return { ...toPlanningItemView(projection, primary, sync), identities }
    },

    getExecutionContext: (query) => readExecutionContext(context, query),
    getPlanningSync: () => syncSummary(context),
    getWorkspaceMetadata: () => workspaceMetadata(context),
    getDeliveryProjection: (scope) => getDeliveryProjection(context, scope),

    async getDeliveryLineage(scope: DeliveryScope): Promise<readonly DeliveryLineageHop[]> {
      return (await getDeliveryProjection(context, scope)).hops
    },
  }
}

/** freshness 的唯一来源：能力门 + 最近一次同步游标；composeCore 还要求本代既有轮次账本已确认一次提交，旧 healthy 游标不能充当新映射的读取成功证明；degraded / failed 表示什么都没提交（行 stale），healthy 加错误码表示提交了但有缺口；游标缺失或 state 为 idle（从未写进过任何结果、没有成功证据）即陈旧。 */
async function syncSummary(context: CoreContext, storage: StorageTransaction = context.storage): Promise<SyncSummary> {
  const gate = gateCommand(context.registry, CapabilityKey.PlanningItemRead, 'read')
  if (!gate.allowed) return { degraded: true, stale: true, reason: gate.error?.message ?? '规划读取能力不可用' }
  const binding = singlePlanningBinding(context.registry)
  if (binding === undefined) return { degraded: true, stale: true, reason: '没有默认 Planning 绑定' }
  const cursor = await storage.getSyncCursor(context.workspaceId, binding.ref.bindingId, PLANNING_SYNC_SCOPE)
  // syncing（一轮在途）今天没有写者，读侧语义待 #134 的调度器定义（TD-034）；这里只让「没有成功证据」的两种形态一致地读作陈旧。
  if (cursor === undefined || cursor.state === SyncState.Idle) return { degraded: true, stale: true, reason: SyncState.Idle }
  if (cursor.state === SyncState.Degraded || cursor.state === SyncState.Failed) {
    return { degraded: true, stale: true, reason: cursor.lastErrorCode ?? cursor.state }
  }
  if (context.planningReadBaseline !== undefined) {
    const round = await storage.getPlanningSyncRound(context.workspaceId, binding.ref.bindingId, PLANNING_SYNC_SCOPE)
    if (round?.latestCommittedRound === undefined || round.latestCommittedRound <= context.planningReadBaseline || round.latestCommittedRound !== round.latestStartedRound) return { degraded: true, stale: true, reason: 'unavailable' }
  }
  // 提交成功但有缺口：healthy 加 lastErrorCode，读取层 degraded，本次确认的行不 stale（D23）。
  return { degraded: cursor.lastErrorCode !== undefined, stale: false, reason: cursor.lastErrorCode }
}

/**
 * 逐个已知 key 按 `bindingForCapability` 路由到唯一挂载并读取其已求交的 access；没有目标的 key 明确 unavailable，不让备用覆盖主目标。
 * storage 域不经外部挂载，registry 里没有它的目标，因此不在此报告（报 unavailable 会说错）。
 */
async function workspaceMetadata(context: CoreContext): Promise<WorkspaceMetadata> {
  const record = await context.storage.getWorkspace(context.workspaceId)
  const keys = Object.values(CapabilityKey).filter((key) => !key.startsWith(`${CapabilityDomain.Storage}.`))
  const planning = singlePlanningBinding(context.registry)
  return {
    workspace: record === undefined ? undefined : { id: record.id, name: record.name },
    capabilities: keys.map((key) => bindingForCapability(context.registry, key)?.capabilities.find((entry) => entry.key === key)
      ?? { key, access: AccessLevel.Unavailable, reason: `没有挂载提供能力 ${key}`, bindingId: undefined, externalActionUrl: undefined }),
    repositories: await repositoryMetadata(context),
    planningSource: planning === undefined || !context.projectTitle ? undefined : { bindingId: planning.ref.bindingId, name: context.projectTitle, ...(context.planningMappingOrigin === undefined ? {} : { mappingOrigin: context.planningMappingOrigin }) },
  }
}

/**
 * 逐仓库可用性：每个已登记仓库按两个操作各路由一次。开始工作走的是同一个 `routeDevelopment`，所以开始工作的四个 key 报告的就是命令会用的那个挂载，不另算一份；
 * 变更请求读（`change_request.read`）与 PR 谱系的远端分支头读取共用完整 `CHANGE_REQUEST_READ_ROUTE`。
 * 路由成功：该操作报告的 key 取被选挂载的有效能力（门已过，key 必在其中）；被拒：这些 key 逐个 unavailable，原因是拒绝文案。每个 key 只由一个操作报告。
 */
async function repositoryMetadata(context: CoreContext): Promise<readonly RepositoryMetadata[]> {
  const mounts = bindingsForDomain(context.registry, CapabilityDomain.Development).map((mount) => mount.ref.bindingId)
  const records = [...await context.storage.listRepositories(context.workspaceId)].sort((left, right) => (left.id < right.id ? -1 : 1))
  const repositories: RepositoryMetadata[] = []
  for (const record of records) {
    const references = await repositoryReferences(context.storage, record, mounts)
    const capabilities: EffectiveCapability[] = []
    for (const { anchor, earlier, reports } of [START_WORK_ROUTE, CHANGE_REQUEST_READ_ROUTE]) {
      const route = await routeDevelopment(context, record.id, anchor[0], anchor[1], earlier)
      capabilities.push(...(route.ok
        ? route.binding.capabilities.filter((entry) => reports.includes(entry.key))
        : reports.map((key) => ({ key, access: AccessLevel.Unavailable, reason: route.error.message, bindingId: undefined, externalActionUrl: undefined }))))
    }
    repositories.push({ id: record.id, references: references.map(({ bindingId, role }) => ({ bindingId, role })), capabilities })
  }
  return repositories
}

async function primaryIdentity(context: CoreContext, entityId: EntityId): Promise<ExternalIdentity | undefined> {
  const identities = await context.storage.listIdentitiesForEntity(entityId)
  return identities.find((identity) => identity.role === IdentityRole.Primary)
}
