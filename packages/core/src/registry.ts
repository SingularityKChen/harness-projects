/**
 * 绑定解析：capability key → 提供它的 binding → provider 实例（ExecPlan D1）。
 *
 * core 只按 capability key 分支，不看 provider 名字；缺能力时返回结构化"不可用"（带恢复动作的
 * `ProjectError`），不是抛错。有效能力在这里由 `capability ∩ permission ∩ policy` 算出。
 */
import {
  AccessLevel, CapabilityKey, bindingForCapability, effectiveCapabilities, projectError, providerRegistry,
  type DeliveryProvider, type DevelopmentProvider, type ExecutionProvider, type ExternalCapabilityDomain, type PlanningProvider,
  type ProviderBindingRecord, type ProviderCapabilitySnapshot, type ProviderDefinition, type ProviderRegistry, type ResolvedBinding, type Storage,
} from '@harness-projects/capabilities'
import {
  ProjectErrorCode, type ProjectError, type WorkspaceId,
} from '@harness-projects/domain'

/** 注入表：每个能力域一个可选 provider（Development 可以是多个），外加本地 storage；core 不 import 任何实现。 */
export interface CoreProviderTable {
  readonly planning?: PlanningProvider
  /** 单个与单元素数组同义；空数组即没有挂载。唯一挂载是默认，多个挂载一律非默认、命令按仓库路由（`development-route.ts`）。 */
  readonly development?: DevelopmentProvider | readonly DevelopmentProvider[]
  readonly delivery?: DeliveryProvider
  readonly execution?: ExecutionProvider
  readonly executionFallback?: ExecutionProvider
  readonly storage?: Storage
}

export interface CollectBindingsInput {
  readonly workspaceId: WorkspaceId
  readonly providers: CoreProviderTable
  readonly policy: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
}

/** 内存中准备好的注册结果：挂载与对应的持久化记录。它还不是已发布的 Registry，Storage 确认之前不得流出。 */
export interface PreparedBindings {
  readonly bindings: readonly ResolvedBinding[]
  readonly records: readonly ProviderBindingRecord[]
}

/** 注入槽位 → 挂载域与角色：主槽位 isDefault=true，执行备用 isDefault=false；Development 只在恰好一个挂载时是默认（`mountsOf`）。 */
const MOUNT_SLOTS = [
  ['planning', 'planning', true], ['development', 'development', true], ['delivery', 'delivery', true],
  ['execution', 'execution', true], ['executionFallback', 'execution', false],
] as const
const SLOT_NAMES: readonly string[] = [...MOUNT_SLOTS.map(([slot]) => slot), 'storage']
/** 各外部域 port 的 [必需成员, 可选成员]：必需缺失、可选存在却不是函数，都在读快照与写 Storage 之前拒绝。 */
const PORT_METHODS: Record<ExternalCapabilityDomain, readonly [readonly string[], readonly string[]]> = {
  planning: [['getProject', 'listPlanningItems', 'getPlanningItem', 'listFieldDefinitions', 'listIterations'], ['createIssueWorkItem', 'createDraftItem', 'updateWorkItemContent', 'updatePlanningFields', 'movePlanningItem', 'reconcile']],
  development: [['getRepository', 'listBranches', 'getCommit', 'getChangeRequest', 'listChangeRequests'], ['createBranch', 'createWorktree', 'getWorktree', 'createChangeRequest', 'removeWorktree', 'reconcile']],
  delivery: [['listPipelineRuns', 'listChecks'], ['listDeployments', 'listEnvironments', 'rerunPipeline', 'cancelPipeline', 'reconcile']],
  execution: [['startRun', 'getRun'], ['cancelRun']],
}
const EXTERNAL_DOMAINS: readonly unknown[] = Object.keys(PORT_METHODS)
const CAPABILITY_KEYS: ReadonlySet<string> = new Set(Object.values(CapabilityKey))
const ACCESS_LEVELS: ReadonlySet<unknown> = new Set(Object.values(AccessLevel))

function reject(message: string): never { throw new TypeError(message) }

/** capability / permission / policy 共用的闭集校验：未知 key（含值为 undefined 的）与四态以外的等级都拒绝；已知 key 的 undefined 保持“未声明”。 */
function assertClosedLevels(what: string, levels: unknown): void {
  if (typeof levels !== 'object' || levels === null) reject(`${what} 必须是对象`)
  for (const [key, level] of Object.entries(levels)) {
    if (!CAPABILITY_KEYS.has(key)) reject(`${what} 含未知 capability key ${key}`)
    if (level !== undefined && !ACCESS_LEVELS.has(level)) reject(`${what} 的 ${key} 等级 ${String(level)} 不是四态之一`)
  }
}

interface Mount {
  readonly domain: ExternalCapabilityDomain; readonly isDefault: boolean; readonly port: object
  /** 准备期取下的 key 副本：之后外部再改 definition，不影响本次对同 id 实现的比较与落库。 */
  readonly implementationKey: string
}

/** 静态校验注入表：槽位、port 成员与 definition 在读任何快照、写任何 Storage 之前全部过一遍；同 key 的域集合必须一致。 */
function mountsOf(providers: CoreProviderTable): readonly Mount[] {
  if (typeof providers !== 'object' || providers === null) reject('providers 必须是注入表对象')
  for (const [slot, port] of Object.entries(providers)) if (port !== undefined && !SLOT_NAMES.includes(slot)) reject(`未知的 provider 槽位 ${slot}`)
  const mounts: Mount[] = []
  const domainSets = new Map<string, string>()
  // 每个槽位展开成 0..N 个挂载：只有 development 接受数组，其余槽位的数组照旧按「port 缺少必需方法」拒绝。
  const slots = MOUNT_SLOTS.flatMap(([name, domain, primary]) => {
    const value: unknown = providers[name]
    const peers = name === 'development' && Array.isArray(value)
    const ports: readonly unknown[] = peers ? value : value === undefined ? [] : [value]
    const isDefault = name === 'development' ? ports.length === 1 : primary
    return ports.map((port, index) => [peers ? `${name}[${index}]` : name, domain, isDefault, port] as const)
  })
  for (const [slot, domain, isDefault, raw] of slots) {
    const port = raw as Record<string, unknown>
    const [required, optional] = PORT_METHODS[domain]
    const callable = (name: string): boolean => typeof port[name] === 'function'
    if (typeof port !== 'object' || port === null || !callable('describeCapabilities') || !required.every(callable)) reject(`槽位 ${slot} 的 port 缺少必需方法`)
    const broken = optional.find((name) => port[name] !== undefined && !callable(name))
    if (broken !== undefined) reject(`槽位 ${slot} 的可选方法 ${broken} 不是函数`)
    const definition = port.definition as Partial<ProviderDefinition> | undefined
    if (typeof definition !== 'object' || definition === null) reject(`槽位 ${slot} 缺少 definition`)
    const { implementationKey: key, domains } = definition
    if (typeof key !== 'string' || key.trim() === '') reject(`槽位 ${slot} 的 definition.implementationKey 必须是非空字符串`)
    if (!Array.isArray(domains) || domains.length === 0 || new Set(domains).size !== domains.length) reject(`槽位 ${slot} 的 definition.domains 必须是非空且去重的数组`)
    const foreign = domains.find((name) => !EXTERNAL_DOMAINS.includes(name))
    if (foreign !== undefined) reject(`槽位 ${slot} 的 definition.domains 含非外部能力域 ${String(foreign)}`)
    if (!domains.includes(domain)) reject(`槽位 ${slot} 的 definition.domains 不含它挂载的域 ${domain}`)
    const signature = [...domains].sort().join(',')
    const declared = domainSets.get(key) ?? signature
    if (declared !== signature) reject(`实现 ${key} 的域集合不一致：${declared} ≠ ${signature}`)
    domainSets.set(key, signature)
    mounts.push({ domain, isDefault, port, implementationKey: key })
  }
  return mounts
}

/**
 * 收集 → 验证：先静态校验全部槽位与 policy，再逐个观察被挂载 port 的快照（同一对象只观察一次，不跨组合复用），按挂载域切出 capability /
 * permission、套 policy 与角色过滤（主执行不带 `execution.run.fallback`，备用不带 `execution.run.start`，备用才不会在主写门不可用时被当成主目标），
 * 最后用 `providerRegistry` 在写任何东西之前验证整批。不写 Storage；任何失败都以拒绝表达，不产出半份结果。
 */
export async function collectBindings(input: CollectBindingsInput): Promise<PreparedBindings> {
  const { workspaceId, providers, policy } = input
  const mounts = mountsOf(providers)
  assertClosedLevels('policy', policy)
  const observed = new Map<object, Promise<ProviderCapabilitySnapshot>>()
  const connectionKeys = new Map<string, string>()
  const bindings: ResolvedBinding[] = []
  const records: ProviderBindingRecord[] = []
  for (const { domain, isDefault, port, implementationKey } of mounts) {
    const pending = observed.get(port) ?? (port as { describeCapabilities(): Promise<ProviderCapabilitySnapshot> }).describeCapabilities()
    observed.set(port, pending)
    const snapshot = await pending
    const { bindingId } = snapshot
    if (typeof bindingId !== 'string' || bindingId.trim() === '') reject(`${domain} 的快照缺少非空 bindingId`)
    assertClosedLevels(`连接 ${bindingId} 快照的 capability`, snapshot.capability)
    assertClosedLevels(`连接 ${bindingId} 快照的 permission`, snapshot.permission)
    const known = connectionKeys.get(bindingId) ?? implementationKey
    if (known !== implementationKey) reject(`连接 ${bindingId} 的实现 key 不一致：${known} ≠ ${implementationKey}`)
    connectionKeys.set(bindingId, implementationKey)
    const slice = (levels: ProviderCapabilitySnapshot['capability']): ProviderCapabilitySnapshot['capability'] =>
      Object.fromEntries(Object.entries(levels).filter(([name]) => name.startsWith(`${domain}.`)))
    const withheld = domain !== 'execution' ? undefined : isDefault ? CapabilityKey.ExecutionRunFallback : CapabilityKey.ExecutionRunStart
    const capabilities = effectiveCapabilities({ ...snapshot, capability: slice(snapshot.capability), permission: slice(snapshot.permission) }, policy)
      .filter((item) => item.key !== withheld)
    const own = <T>(want: ExternalCapabilityDomain): T | undefined => (domain === want ? (port as T) : undefined)
    bindings.push({
      ref: { workspaceId, bindingId, domain }, enabled: true, isDefault, capabilities, storage: undefined,
      planning: own<PlanningProvider>('planning'), development: own<DevelopmentProvider>('development'),
      delivery: own<DeliveryProvider>('delivery'), execution: own<ExecutionProvider>('execution'),
    })
    records.push({ id: bindingId, workspaceId, domain, implementationKey, enabled: true, isDefault })
  }
  providerRegistry(bindings)
  return { bindings, records }
}

export type CapabilityResolution =
  | { readonly available: true; readonly access: AccessLevel; readonly binding: ResolvedBinding }
  | { readonly available: false; readonly reason: string; readonly error: ProjectError }

/** 按 key 找提供它的绑定；找不到或不可用给出结构化结论。 */
export function resolveCapability(registry: ProviderRegistry, key: CapabilityKey): CapabilityResolution {
  return resolveBinding(bindingForCapability(registry, key), key)
}

/**
 * 在一个已选定的挂载上判定 key：挂载缺失或没有声明该 key 是「没有绑定提供能力」（与按 key 解析时 `bindingForCapability` 对未声明 key 返回 undefined 的措辞一致），
 * 声明了但不可用是「当前不可用」；都是结构化不可用，绝不改找别的挂载。
 */
export function resolveBinding(binding: ResolvedBinding | undefined, key: CapabilityKey): CapabilityResolution {
  const declared = binding?.capabilities.find((capability) => capability.key === key)
  if (binding === undefined || declared === undefined) return unavailableCapability(`没有绑定提供能力 ${key}`)
  if (declared.access === AccessLevel.Unavailable) return unavailableCapability(`能力 ${key} 当前不可用`)
  return { available: true, access: declared.access, binding }
}

function unavailableCapability(reason: string): CapabilityResolution {
  return { available: false, reason, error: projectError(ProjectErrorCode.NotSupported, reason) }
}
