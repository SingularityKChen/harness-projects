/**
 *
 */
import {
  ProjectErrorCode, projectError, providerRegistry,
  type AccessLevel, type CapabilityKey, type ExternalObjectRef, type ProviderRegistry, type Storage, type WorkspaceRecord,
} from '@harness-projects/capabilities'
import {
  NormalizedStatus, StatusPolicy, WriteState, newEntityId, newExternalIdentityId, newRelationId,
  newWorkspaceId, type EntityId, type ExternalIdentityId, type RelationId, type WorkspaceId, type WorkspacePlanningFieldMapping,
} from '@harness-projects/domain'
import { bootstrapWorkspace, type BootstrapResult } from './bootstrap.ts'
import { normalizeScope, rerunPipeline, type DeliveryScope, type DeliveryWriteAttempt } from './delivery.ts'
import { refreshDeliveryFacts, type DeliveryRefreshResult } from './delivery-facts.ts'
import { reportSyncRoundFailure } from './diagnostics.ts'
import { startWorkUnavailable, type ExecutionContextQuery, type StartWorkRequest, type StartWorkResult } from './execution-context.ts'
import { cancelExecutionRun, type CancelExecutionRunResult } from './execution-run.ts'
import { planningFieldMappingSnapshot } from './planning-fields.ts'
import { createQueries, type CoreQueries } from './queries.ts'
import { collectBindings, type CoreProviderTable } from './registry.ts'
import { confirmRelation, type RecordedEdge, type RelationRef } from './relations.ts'
import { startWork } from './start-work.ts'
import {
  StatusPolicyMode, writePlanningStatus, type PlanningStatusCommand, type StatusDecision,
} from './status-policy.ts'

export interface IdFactory {
  readonly entityId: () => EntityId
  readonly externalIdentityId: () => ExternalIdentityId
  readonly relationId: () => RelationId
}

export const defaultIdFactory: IdFactory = {
  entityId: newEntityId, externalIdentityId: newExternalIdentityId, relationId: newRelationId,
}

export interface CoreWorkspaceInput {
  /** 重启恢复要让新 core 读同一份工作区投影，必须复用同一 id。 */
  readonly id?: WorkspaceId
  readonly name: string
  readonly statusPolicy?: StatusPolicy
  /** 可选显式规划项目范围；不传时由 bootstrap 从 provider 观察中发现。 */
  readonly project?: ExternalObjectRef
  /**
   * 字段角色映射（#133）：与 `project` 一样是每次组装的输入，不持久化——它是 Host 自己的配置，不是外部写入，没有待确认态。
   * 省略即不归一任何原生状态（规划状态为 unknown），绝不按名称猜。
   */
  readonly planningFieldMapping?: WorkspacePlanningFieldMapping
}

/**
 * 宿主诊断出口（TD-030）：把 core 不能放进命令结果或 wire 的原始失败原因交给宿主自己的日志或遥测。全部可选，缺省即 no-op；
 * 钩子自己失败（同步抛出，或返回被拒绝的 promise / thenable）不改变 core 的任何结果，返回值也不被等待（慢的或永不 resolve 的钩子拖不住同步）。
 *
 * **脱敏义务在宿主**：交出的原异常可能含凭据片段、本机磁盘路径、SQL 与提供方原文（SQLite 旧载体的修复指令也在其中）。
 * 宿主写入日志或遥测前负责脱敏，不得把它（或由它派生的文字）转发到 wire 或 UI——命令结果与读侧只有固定文案，正是为了不外发它。
 */
export interface CoreDiagnostics {
  /**
   * 一轮规划同步没有提交，原因是异常（Storage 拒绝、provider 抛出、编程错误）：原异常原样（同一个对象）交给宿主；provider 的结构化失败与成功提交不调用它。
   * 另有一种情形同样调用它：组合期的首轮引导里，连「记录失败」本身也被 Storage 拒绝（双重故障，TD-031）——这个拒绝会被 `composeCore` 吞掉，
   * 吞掉之前交给宿主；显式命令里的同一拒绝直接到调用方，不另交。
   */
  readonly syncRoundFailed?: (error: unknown) => void
}

export interface CoreDeps {
  readonly workspace: CoreWorkspaceInput
  readonly providers: CoreProviderTable
  readonly storage?: Storage
  readonly clock?: () => string
  readonly ids?: IdFactory
  readonly policy?: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
  readonly diagnostics?: CoreDiagnostics
}

export interface CoreContext {
  readonly storage: Storage
  readonly workspaceId: WorkspaceId
  readonly registry: ProviderRegistry
  readonly clock: () => string
  readonly ids: IdFactory
  readonly policy: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
  /** bootstrap 成功解析后回填；重启的实例靠 provider 观察重新发现。 */
  projectRef: ExternalObjectRef | undefined
  readonly planningFieldMapping: WorkspacePlanningFieldMapping | undefined
  readonly diagnostics: CoreDiagnostics | undefined
}

export interface CoreCommands {
  bootstrapWorkspace(): Promise<BootstrapResult>
  startWork(request: StartWorkRequest): Promise<StartWorkResult>
  /** 按运行身份取消：已取消原样返回，否则路由回签发者、ack 后原子替换状态与引用。 */
  cancelExecutionRun(query: ExecutionContextQuery): Promise<CancelExecutionRunResult>
  /** 显式确认一条候选边：唯一把 candidate 变成 confirmed 的入口；边不存在时不造关系。 */
  confirmRelation(ref: RelationRef): Promise<RecordedEdge | undefined>
  /** 对只读交付方的写尝试：只回结构化 not supported，不改任何状态。 */
  rerunPipeline(ref: ExternalObjectRef): Promise<DeliveryWriteAttempt>
  /** 交付事实唯一的摄入入口（#222）：读 provider、在一个事务里提交最后确认的事实；查询只读它提交的结果，不推进修订号。 */
  refreshDeliveryFacts(scope: DeliveryScope): Promise<DeliveryRefreshResult>
  /** 规划状态的唯一显式写入命令；工程事实无权调用它（不变量 3）。 */
  applyPlanningStatus(command: PlanningStatusCommand): Promise<StatusDecision>
}

/**
 */
export type CoreNamespace<T> = T & (() => T)

export interface CoreApi {
  readonly queries: CoreNamespace<CoreQueries>
  readonly commands: CoreNamespace<CoreCommands>
}

function namespace<T extends object>(members: T): CoreNamespace<T> {
  return Object.assign(() => members, members)
}

/** 装配入口的工作区校验：先把省略的 id / statusPolicy 归一为 WorkspaceRecord，再校验闭集，任何写之前拒绝。 */
function workspaceRecord(input: CoreWorkspaceInput): WorkspaceRecord {
  const record = { id: input.id ?? newWorkspaceId(), name: input.name, statusPolicy: input.statusPolicy ?? StatusPolicy.ProviderAuthoritative }
  if (typeof record.id !== 'string' || record.id.trim() === '') throw new TypeError('workspace.id 必须是非空字符串')
  if (typeof record.name !== 'string') throw new TypeError('workspace.name 必须是字符串')
  if (!Object.values(StatusPolicy).includes(record.statusPolicy)) throw new TypeError(`workspace.statusPolicy ${String(record.statusPolicy)} 不是合法的状态策略`)
  return record
}

/**
 * storage 缺失时返回 undefined，由 composeCore 转成结构化不可用。存在时：先全部校验与收集，再用**一个**事务写工作区与全部挂载，
 * Storage ack 之后才发布 Registry——任何一步失败都整批回滚，不留新工作区、孤儿锚点或半批挂载。
 */
export async function createContext(deps: CoreDeps): Promise<CoreContext | undefined> {
  const storage = deps.storage ?? deps.providers.storage
  if (storage === undefined) return undefined
  const workspace = workspaceRecord(deps.workspace)
  const planningFieldMapping = deps.workspace.planningFieldMapping === undefined ? undefined : planningFieldMappingSnapshot(deps.workspace.planningFieldMapping)
  const policy = deps.policy ?? {}
  const prepared = await collectBindings({ workspaceId: workspace.id, providers: deps.providers, policy })
  await storage.transaction(async (tx) => {
    await tx.putWorkspace(workspace)
    for (const record of prepared.records) await tx.putProviderBinding(record)
  })
  return {
    storage, workspaceId: workspace.id, registry: providerRegistry(prepared.bindings),
    clock: deps.clock ?? (() => new Date().toISOString()),
    ids: deps.ids ?? defaultIdFactory, policy,
    projectRef: deps.workspace.project, planningFieldMapping, diagnostics: deps.diagnostics,
  }
}

/** 装配 CoreApi：组合时做一次首轮水合，查询随后保持纯本地只读（D5）。 */
export async function composeCore(deps: CoreDeps): Promise<CoreApi> {
  const context = await createContext(deps)
  if (context === undefined) return unavailableCore('没有可用的 storage 绑定')
  try {
    await bootstrapWorkspace(context)
  } catch (error) {
    // port 契约要求失败是结构化 ProviderResult；裸异常只阻断本次水合，降级交给游标状态表达。
    // 这里能漏出来的只有「记录失败本身也被拒绝」（双重故障，TD-031）：吞掉之前交给宿主的诊断出口，否则冷启动时没有别的路径让宿主知道原因。
    reportSyncRoundFailure(context, error)
  }
  return {
    queries: namespace(createQueries(context)),
    commands: namespace({
      bootstrapWorkspace: () => bootstrapWorkspace(context),
      startWork: (request: StartWorkRequest) => startWork(context, request),
      cancelExecutionRun: (query: ExecutionContextQuery) => cancelExecutionRun(context, query),
      confirmRelation: (ref: RelationRef) => confirmRelation(context, ref),
      rerunPipeline: (ref: ExternalObjectRef) => rerunPipeline(context, ref),
      refreshDeliveryFacts: (scope: DeliveryScope) => refreshDeliveryFacts(context, normalizeScope(scope)),
      applyPlanningStatus: (command: PlanningStatusCommand) => writePlanningStatus(context, command),
    }),
  }
}

function unavailableCore(reason: string): CoreApi {
  const error = projectError(ProjectErrorCode.NotSupported, reason)
  const queries: CoreQueries = {
    listProviderBindings: async () => [],
    listPlanningItems: async () => [],
    getItemDetail: async () => undefined,
    getExecutionContext: async () => undefined,
    getPlanningSync: async () => ({ degraded: true, stale: true, reason }),
    getWorkspaceMetadata: async () => ({ workspace: undefined, capabilities: [] }),
    getDeliveryProjection: async (scope) => ({
      ...normalizeScope(scope), hops: [], optional: [], degraded: true, error, attemptedAt: undefined, freshness: [], gaps: [],
    }),
    getDeliveryLineage: async () => [],
  }
  const commands: CoreCommands = {
    bootstrapWorkspace: async () => ({
      ok: false, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, revision: 0, degraded: true, error,
    }),
    startWork: async () => startWorkUnavailable(error),
    cancelExecutionRun: async () => ({ status: undefined, runExternalId: undefined, error }),
    confirmRelation: async () => undefined,
    rerunPipeline: async () => ({ supported: false, writeState: WriteState.Failed, saving: false, confirmed: false, error }),
    refreshDeliveryFacts: async () => ({ ok: false, anchored: false, applied: false, gaps: [], error }),
    applyPlanningStatus: async (command: PlanningStatusCommand) => ({
      entityId: command.entityId, status: NormalizedStatus.Unknown, derived: [], wrote: false,
      policy: StatusPolicy.ProviderAuthoritative, mode: StatusPolicyMode.SourceManaged, reason: reason, error,
    }),
  }
  return { queries: namespace(queries), commands: namespace(commands) }
}
