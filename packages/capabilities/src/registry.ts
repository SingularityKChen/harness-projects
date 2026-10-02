/**
 * Provider 组合视图：绑定引用 + 已解析的 provider 实例 + 该绑定的有效能力。
 *
 * core 只通过这里回答“某个能力域由哪个绑定提供”，不 import 任何具体 provider（ExecPlan D1）。
 * 组合发生在测试层的组合根；本文件只提供数据结构与纯查询函数，不持有生命周期或 IO。
 */
import type { ProviderBindingId, WorkspaceId } from '@harness-projects/domain'
import { CapabilityDomain, CapabilityKey, type EffectiveCapability } from './capability-keys.ts'
import type { DeliveryProvider } from './delivery-provider.ts'
import type { DevelopmentProvider } from './development-provider.ts'
import type { ExecutionProvider } from './execution-provider.ts'
import type { PlanningProvider } from './planning-provider.ts'
import type { Storage } from './storage.ts'

/** 外部能力域：Storage 是 Host 注入的本地持久化，不经连接实现定义。 */
export type ExternalCapabilityDomain = Exclude<CapabilityDomain, 'storage'>

/**
 * 连接实现的静态定义：由实现作者声明，Core 只透传并验证，不从类名、包名、域或 URL 推断。
 * `implementationKey` 是一套连接语义兼容的实现族（可跨多个域），`domains` 是它提供的外部域集合；同 key 的域集合必须一致。
 */
export interface ProviderDefinition {
  readonly implementationKey: string
  readonly domains: readonly ExternalCapabilityDomain[]
}

export interface BindingRef {
  readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: CapabilityDomain
}

/** 一个绑定解析后的全部形态：只有它声明的域非空，其余为 undefined。 */
export interface ResolvedBinding {
  readonly ref: BindingRef; readonly enabled: boolean; readonly isDefault: boolean; readonly capabilities: readonly EffectiveCapability[]
  readonly planning: PlanningProvider | undefined; readonly development: DevelopmentProvider | undefined
  readonly delivery: DeliveryProvider | undefined; readonly execution: ExecutionProvider | undefined
  readonly storage: Storage | undefined
}

export interface ProviderRegistry { readonly bindings: readonly ResolvedBinding[] }

const PORT_DOMAINS = Object.values(CapabilityDomain)

/**
 * 发布一个 Registry：先验证再返回，非法输入拒绝而不是取第一条。同一工作区的 `(bindingId, domain)` 挂载唯一（同 id 跨域合法）；
 * 每域至多一个默认、至多一个备用，且 Execution 之外的域只有默认挂载（因此同一工作区至多一个 Planning 事实源，不变量 1）；每个挂载只带本域的 port。
 */
export function providerRegistry(bindings: readonly ResolvedBinding[]): ProviderRegistry {
  const seen = new Set<string>()
  for (const binding of bindings) {
    const { ref } = binding
    const tuple = `${ref.bindingId}@${ref.domain}`
    if (ref.workspaceId !== bindings[0]?.ref.workspaceId) throw new TypeError(`挂载 ${tuple} 与其余挂载不在同一个工作区`)
    if (seen.has(tuple)) throw new TypeError(`挂载 ${tuple} 重复：同一工作区同一连接在同一能力域只能挂一次`)
    seen.add(tuple)
    const foreign = PORT_DOMAINS.find((name) => name !== ref.domain && binding[name] !== undefined)
    if (foreign !== undefined) throw new TypeError(`挂载 ${tuple} 带有其他域的 port ${foreign}`)
    if (!binding.isDefault && ref.domain !== 'execution') throw new TypeError(`挂载 ${tuple} 不是默认挂载：只有 Execution 允许备用`)
  }
  for (const domain of PORT_DOMAINS) {
    const mounts = bindings.filter((binding) => binding.ref.domain === domain)
    if (mounts.filter((binding) => binding.isDefault).length > 1) throw new TypeError(`能力域 ${domain} 有多个默认挂载`)
    if (mounts.filter((binding) => !binding.isDefault).length > 1) throw new TypeError(`能力域 ${domain} 有多个备用挂载：备用至多一个，读才有唯一备用可选`)
  }
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

/**
 * 按 capability key 找路由目标：先按 key 的域筛选，再按角色定位——`execution.run.fallback` 只选备用，`execution.run.start` 只选主，
 * 其余读写选主、主缺失才选备用。目标不声明该 key 时返回 undefined；目标声明了但 unavailable 也照样返回它，由调用方判拒绝，
 * 绝不另找一个可用实例（备用不因主不可用而升级）。
 */
export function bindingForCapability(registry: ProviderRegistry, key: CapabilityKey): ResolvedBinding | undefined {
  const mounts = bindingsForDomain(registry, key.split('.')[0] as CapabilityDomain)
  const primary = mounts.find((binding) => binding.isDefault)
  const spare = mounts.find((binding) => !binding.isDefault)
  const target = key === CapabilityKey.ExecutionRunFallback ? spare : key === CapabilityKey.ExecutionRunStart ? primary : primary ?? spare
  return target?.capabilities.some((capability) => capability.key === key) ? target : undefined
}

/** 严格按完整挂载引用（工作区 + 连接 + 域）取启用的挂载；缺失 undefined，重复输入拒绝而不是取第一条。 */
export function bindingForRef(registry: ProviderRegistry, ref: BindingRef): ResolvedBinding | undefined {
  const matches = registry.bindings.filter((binding) => binding.enabled
    && binding.ref.workspaceId === ref.workspaceId && binding.ref.bindingId === ref.bindingId && binding.ref.domain === ref.domain)
  if (matches.length > 1) throw new TypeError(`挂载 ${ref.bindingId}@${ref.domain} 重复：同一引用命中了多个挂载`)
  return matches[0]
}

/** 五域 port 的编译期成员锁：`keyof` 与 golden 成员表双向相等，删或新增成员都会让 `tsc --noEmit` 失败；外部四域改成员时同步 core 注册的 `PORT_METHODS`。 */
type Expect<T extends true> = T; type Exact<A, B> = [A, B] extends [B, A] ? true : false
export type PlanningProviderSurface = Expect<Exact<keyof PlanningProvider, 'definition' | 'describeCapabilities' | 'getProject' | 'listPlanningItems' | 'getPlanningItem' | 'listFieldDefinitions' | 'listIterations' | 'createIssueWorkItem' | 'createDraftItem' | 'updateWorkItemContent' | 'updatePlanningFields' | 'movePlanningItem' | 'reconcile'>>
export type DevelopmentProviderSurface = Expect<Exact<keyof DevelopmentProvider, 'definition' | 'describeCapabilities' | 'getRepository' | 'listBranches' | 'getCommit' | 'getChangeRequest' | 'listChangeRequests' | 'createBranch' | 'createWorktree' | 'getWorktree' | 'createChangeRequest' | 'removeWorktree' | 'reconcile'>>
export type DeliveryProviderSurface = Expect<Exact<keyof DeliveryProvider, 'definition' | 'describeCapabilities' | 'listPipelineRuns' | 'listChecks' | 'listDeployments' | 'listEnvironments' | 'rerunPipeline' | 'cancelPipeline' | 'reconcile'>>
export type ExecutionProviderSurface = Expect<Exact<keyof ExecutionProvider, 'definition' | 'describeCapabilities' | 'startRun' | 'getRun' | 'cancelRun'>>
export type StorageSurface = Expect<Exact<keyof Storage, 'transaction' | 'putWorkspace' | 'getWorkspace' | 'putProviderBinding' | 'listProviderBindings' | 'putEntity' | 'putExternalIdentity' | 'findExternalIdentity' | 'listIdentitiesForEntity' | 'putMembership' | 'getMembership' | 'listMemberships' | 'putFieldValue' | 'listFieldValues' | 'putPlanningProjection' | 'replacePlanningProjections' | 'getPlanningProjection' | 'listPlanningProjections' | 'putRepository' | 'listRepositories' | 'putExecutionContext' | 'getExecutionContext' | 'findActiveExecutionContext' | 'putExecutionRun' | 'getExecutionRun' | 'putRelation' | 'listRelations' | 'recordObservation' | 'getSyncCursor' | 'putSyncCursor' | 'getReconcileCursor' | 'putReconcileCursor' | 'findMutationAttempt' | 'putMutationAttempt' | 'listMutationAttempts' | 'currentRevision' | 'advanceRevision'>>
