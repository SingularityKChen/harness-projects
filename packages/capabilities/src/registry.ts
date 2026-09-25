/**
 * Provider 组合视图：绑定引用 + 已解析的 provider 实例 + 该绑定的有效能力。
 *
 * core 只通过这里回答“某个能力域由哪个绑定提供”，不 import 任何具体 provider（ExecPlan D1）。
 * 组合发生在测试层的组合根；本文件只提供数据结构与纯查询函数，不持有生命周期或 IO。
 */
import type { ProviderBindingId, WorkspaceId } from '@harness-projects/domain'
import { AccessLevel, type CapabilityDomain, type CapabilityKey, type EffectiveCapability } from './capability-keys.ts'
import type { DeliveryProvider } from './delivery-provider.ts'
import type { DevelopmentProvider } from './development-provider.ts'
import type { ExecutionProvider } from './execution-provider.ts'
import type { PlanningProvider } from './planning-provider.ts'
import type { Storage } from './storage.ts'

export interface BindingRef {
  readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: CapabilityDomain
}

/** 一个绑定解析后的全部形态：只有它声明的域非空，其余为 undefined。 */
export interface ResolvedBinding {
  readonly ref: BindingRef; readonly enabled: boolean; readonly capabilities: readonly EffectiveCapability[]
  readonly planning: PlanningProvider | undefined; readonly development: DevelopmentProvider | undefined
  readonly delivery: DeliveryProvider | undefined; readonly execution: ExecutionProvider | undefined
  readonly storage: Storage | undefined
}

export interface ProviderRegistry { readonly bindings: readonly ResolvedBinding[] }

export function providerRegistry(bindings: readonly ResolvedBinding[]): ProviderRegistry {
  return { bindings }
}

/** 某个能力域的全部启用绑定；planning 域期望长度为 1（不变量 1），由调用方或断言强制。 */
export function bindingsForDomain(registry: ProviderRegistry, domain: CapabilityDomain): readonly ResolvedBinding[] {
  return registry.bindings.filter((binding) => binding.enabled && binding.ref.domain === domain)
}

/** 一个工作空间同一时刻只有一个 planning 事实源；没有启用绑定时返回 undefined，不猜测。 */
export function singlePlanningBinding(registry: ProviderRegistry): ResolvedBinding | undefined {
  return bindingsForDomain(registry, 'planning')[0]
}

/** 按 capability key 找到第一个真正可用的绑定；unavailable 不算提供者。 */
export function bindingForCapability(registry: ProviderRegistry, key: CapabilityKey): ResolvedBinding | undefined {
  return registry.bindings.find((binding) =>
    binding.enabled &&
    binding.capabilities.some(
      (capability) => capability.key === key && capability.access !== AccessLevel.Unavailable,
    ),
  )
}

/** 五域 port 的编译期成员锁：`keyof` 与 golden 成员表双向相等，删或新增成员都会让 `tsc --noEmit` 失败。 */
type Expect<T extends true> = T; type Exact<A, B> = [A, B] extends [B, A] ? true : false
export type PlanningProviderSurface = Expect<Exact<keyof PlanningProvider, 'describeCapabilities' | 'getProject' | 'listPlanningItems' | 'getPlanningItem' | 'listFieldDefinitions' | 'listIterations' | 'createIssueWorkItem' | 'createDraftItem' | 'updateWorkItemContent' | 'updatePlanningFields' | 'movePlanningItem' | 'reconcile'>>
export type DevelopmentProviderSurface = Expect<Exact<keyof DevelopmentProvider, 'describeCapabilities' | 'getRepository' | 'listBranches' | 'getCommit' | 'getChangeRequest' | 'listChangeRequests' | 'createBranch' | 'createWorktree' | 'createChangeRequest' | 'removeWorktree' | 'reconcile'>>
export type DeliveryProviderSurface = Expect<Exact<keyof DeliveryProvider, 'describeCapabilities' | 'listPipelineRuns' | 'listChecks' | 'listDeployments' | 'listEnvironments' | 'rerunPipeline' | 'cancelPipeline' | 'reconcile'>>
export type ExecutionProviderSurface = Expect<Exact<keyof ExecutionProvider, 'describeCapabilities' | 'startRun' | 'getRun' | 'cancelRun'>>
export type StorageSurface = Expect<Exact<keyof Storage, 'transaction' | 'putWorkspace' | 'getWorkspace' | 'putProviderBinding' | 'listProviderBindings' | 'putEntity' | 'putExternalIdentity' | 'findExternalIdentity' | 'listIdentitiesForEntity' | 'putMembership' | 'getMembership' | 'listMemberships' | 'putFieldValue' | 'listFieldValues' | 'putPlanningProjection' | 'replacePlanningProjections' | 'getPlanningProjection' | 'listPlanningProjections' | 'putRepository' | 'listRepositories' | 'putExecutionContext' | 'getExecutionContext' | 'findActiveExecutionContext' | 'putExecutionRun' | 'getExecutionRun' | 'putRelation' | 'listRelations' | 'recordObservation' | 'getSyncCursor' | 'putSyncCursor' | 'getReconcileCursor' | 'putReconcileCursor' | 'findMutationAttempt' | 'putMutationAttempt' | 'listMutationAttempts' | 'currentRevision' | 'advanceRevision'>>
