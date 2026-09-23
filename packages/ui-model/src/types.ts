/**
 * 展示结构（issue #128）：页面消费的唯一结构面。wire 对象与 provider 原生形状不出现在这一层之外，
 * 平台名不参与任何分支。工作区身份与时间都由宿主注入（wire 与 client 都不带时间戳），展示层不读时钟，
 * 因此同一输入必然得到同一输出（不变量 7）。跨层约定的理由写在各自字段上，不外包给已归档的计划。
 */
import type { AccessLevel, ContentKind, DerivedFlag, EntityId, NormalizedStatus } from '@harness-projects/domain'
import type { EntityStore, StoredEntity } from '@harness-projects/client'

/** 客户端模型里一个条目的字段面；类型经 client 的 `StoredEntity` 取得，不新增依赖边。 */
export type ClientEntity = StoredEntity['entity']
/** 权威归属（provider / host / manual）：原样透出，页面不得把 host 权威显示成平台权威。 */
export type ClientAuthority = ClientEntity['source']['authority']
/** 外部身份种类（issue / draft / change_request / branch / worktree）。 */
export type ClientExternalKind = ClientEntity['content']['externalKind']

/** capability 快照的一项：与 capabilities 包的 `EffectiveCapability` 结构兼容，宿主可直接传入。 */
export interface CapabilitySnapshotEntry {
  /** capability key（跨层契约取值）；本层用到的取值由契约测试与 `CapabilityKey` 表逐字比对。 */
  readonly key: string
  readonly access: AccessLevel
  readonly reason?: string | undefined
}

export interface WorkspaceDescriptor { readonly id: string; readonly name: string }

/**
 * 一次"工作区读取"：客户端模型 + 宿主才知道的事实。
 *
 * `capabilities` 省略 = 未观测到任何能力（动作与谱系入口都不可用；权限未知不得当成可用）。
 * `lastUpdatedAt` 省略 = 宿主**从未成功读取到当前值**：合法的降级形态，不是错误；给了值但不合契约
 * 才是宿主接线缺陷（响亮失败）。展示层不读时钟，"没有最后更新时间"只能由宿主表达。
 * `reason` 与下游同名字段**全线是 display-ready 散文**，降级必有解释；**怎么显示**归页面。
 */
export interface WorkspaceRead {
  readonly workspace: WorkspaceDescriptor
  readonly store: EntityStore
  readonly connection: { readonly connected: boolean }
  /** 最后一次读到当前值的时刻（ISO 8601）；`undefined` = 从未读到。 */
  readonly lastUpdatedAt?: string | undefined
  readonly capabilities?: readonly CapabilitySnapshotEntry[] | undefined
  /** 宿主已知的连接降级原因；缺失时退回条目自身的原因，再退回本层的中性短语。 */
  readonly reason?: string | undefined
}

/** 连接状态是派生的，不是新的事实源：未连接 / 已连接但有降级 / 正常。 */
export const WorkspaceConnectionState = {
  Connected: 'connected',
  Degraded: 'degraded',
  Disconnected: 'disconnected',
} as const
export type WorkspaceConnectionState = (typeof WorkspaceConnectionState)[keyof typeof WorkspaceConnectionState]

/** 按内容三态计数；三个键恒存在，缺一类就是 0。 */
export type ContentKindCounts = Readonly<Record<ContentKind, number>>

export interface WorkspaceItems {
  readonly total: number
  /** 展示结论下算陈旧的条目数（与列表行的 `freshness.stale` 同一规则）。 */
  readonly stale: number
  readonly byContentKind: ContentKindCounts
}

export interface WorkspaceHome {
  readonly workspace: WorkspaceDescriptor; readonly connection: WorkspaceConnectionState
  readonly revision: number
  /** `undefined` = 从未读到当前值（与 `WorkspaceRead` 同义）。 */
  readonly lastUpdatedAt: string | undefined
  /** 与 `WorkItemList.reason` 同源同值：同一份读取不得给出相反解释。 */
  readonly reason: string | undefined
  /** 客户端模型里出现过的来源绑定，去重排序。 */
  readonly sources: readonly string[]
  readonly items: WorkspaceItems
}

export interface ProjectsHome { readonly workspaces: readonly WorkspaceHome[] }

/** 展示层能提供的动作；取值是稳定契约，文案归页面。 */
export const ActionId = { StartWork: 'start_work' } as const
export type ActionId = (typeof ActionId)[keyof typeof ActionId]

/**
 * 一个能力组合的结论。`available` 只由 capability key 决定，按用途分两种（与 core 的 `gateCommand`
 * 同一约定）：写动作被 `read_only` 与 `unavailable` 阻断；只读目标只被 `unavailable` 阻断。未声明的
 * key 一律 `unavailable`。`requiredKeys` 必须**精确**等于 core 读该事实时真正经过的门；空列表表示
 * 没有门、恒可用。`reason` 在 `access !== available` 时逐 key 给出**它自己的**级别。
 */
export interface CapabilityDecision {
  readonly available: boolean
  readonly access: AccessLevel
  readonly reason: string | undefined
  readonly requiredKeys: readonly string[]
}

/** 一个**已被提供**的动作的可用性；动作是否出现由内容种类决定。 */
export interface ActionAvailability extends CapabilityDecision { readonly id: ActionId }

/** 来源身份：客户端模型暴露的外部身份三元组。 */
export interface SourceIdentity {
  readonly bindingId: string; readonly externalKind: ClientExternalKind; readonly externalId: string
}

export interface SourcePresentation {
  /** 主内容身份：这一条内容来自哪个来源对象的哪个外部 id。 */
  readonly primary: SourceIdentity
  readonly authority: ClientAuthority
  /** 客户端模型当前暴露的全部身份；今天恒为 `[primary]`。 */
  readonly identities: readonly SourceIdentity[]
}

/**
 * 新鲜度结论：客户端模型的条目标记 **与** 宿主连接状态的合成——`stale` = 条目已陈旧 **或** 连接
 * 不可用 **或** 从未读到当前值（任一降级即降级，fail closed）。它是展示结论，不是第二个事实源。
 * `reason` 与整表 `reason` 同源（优先条目自身的原因）。
 */
export interface FreshnessPresentation {
  readonly stale: boolean
  readonly lastUpdatedAt: string | undefined
  readonly reason: string | undefined
}

/** 列表行：以规划条目（`entityId`）为键。 */
export interface WorkItemRow {
  readonly entityId: EntityId
  /** 内容种类：work_item / change_request / redacted。 */
  readonly contentKind: ContentKind
  /** redacted 恒为 undefined：页面显示占位，不得回退到缓存标题。 */
  readonly title: string | undefined
  readonly planningStatus: NormalizedStatus
  /** 派生标记：只用于展示，永不参与规划状态判定（不变量 3）。 */
  readonly derived: readonly DerivedFlag[]
  readonly source: SourcePresentation
  readonly freshness: FreshnessPresentation
  /** 该行**提供**的动作；可用性只来自 capability key。 */
  readonly actions: readonly ActionAvailability[]
}

/** 工作项列表：`stale` / `connection` / `reason` 三者同出一处降级决策，`stale` 是**整表**结论。 */
export interface WorkItemList {
  readonly rows: readonly WorkItemRow[]
  readonly stale: boolean
  readonly connection: WorkspaceConnectionState
  readonly reason: string | undefined
  /** `undefined` = 从未读到当前值（与 `WorkspaceRead` 同义）。 */
  readonly lastUpdatedAt: string | undefined
}

/** 谱系入口的导航目标；取值是稳定契约，文案归页面。 */
export const LineageTarget = {
  ExecutionContext: 'execution_context',
  ChangeRequest: 'change_request',
  PipelineRun: 'pipeline_run',
  CheckRun: 'check_run',
} as const
export type LineageTarget = (typeof LineageTarget)[keyof typeof LineageTarget]

/** 谱系入口：工程谱系视图的**只读导航目标**（`CapabilityDecision` 的只读用途实例）。 */
export interface LineageEntryPoint extends CapabilityDecision { readonly target: LineageTarget }

/** 详情里的规划段：规划字段是权威值，派生标记只用于展示。 */
export interface PlanningSection {
  readonly entityId: EntityId; readonly contentKind: ContentKind; readonly title: string | undefined
  readonly body: string | undefined; readonly status: NormalizedStatus; readonly derived: readonly DerivedFlag[]
}

/** 统一详情；工程段与交付段不在本增量范围内（#128 Out of scope）。 */
export interface WorkItemDetail {
  readonly entityId: EntityId; readonly planning: PlanningSection; readonly source: SourcePresentation
  readonly lineage: readonly LineageEntryPoint[]; readonly freshness: FreshnessPresentation
  readonly actions: readonly ActionAvailability[]
}
