/**
 * 绑定解析：capability key → 提供它的 binding → provider 实例（ExecPlan D1）。
 *
 * core 只按 capability key 分支，不看 provider 名字；缺能力时返回结构化"不可用"（带恢复动作的
 * `ProjectError`），不是抛错。有效能力在这里由 `capability ∩ permission ∩ policy` 算出。
 */
import {
  AccessLevel, CapabilityKey, bindingForCapability, effectiveCapabilities, projectError,
  type CapabilityDomain, type DeliveryProvider, type DevelopmentProvider,
  type EffectiveCapability, type ExecutionProvider, type PlanningProvider, type ProviderRegistry,
  type ResolvedBinding, type Storage,
} from '@harness-projects/capabilities'
import {
  ProjectErrorCode, type ProjectError, type ProviderBindingId, type WorkspaceId,
} from '@harness-projects/domain'

/** 注入表：四个能力域各自一个可选 provider，外加本地 storage；core 不 import 任何实现。 */
export interface CoreProviderTable {
  readonly planning?: PlanningProvider
  readonly development?: DevelopmentProvider
  readonly delivery?: DeliveryProvider
  readonly execution?: ExecutionProvider
  readonly executionFallback?: ExecutionProvider
  readonly storage?: Storage
}

const PROVIDER_DOMAINS = ['planning', 'development', 'delivery', 'execution'] as const

export interface RegisterBindingsInput {
  readonly storage: Storage
  readonly workspaceId: WorkspaceId
  readonly providers: CoreProviderTable
  readonly policy: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
}

/** 一个绑定解析后的全部形态：只有它自己的域非空，避免调用方从别的域误取 provider。 */
function resolvedBinding(
  providers: CoreProviderTable, domain: CapabilityDomain, bindingId: ProviderBindingId,
  workspaceId: WorkspaceId, capabilities: readonly EffectiveCapability[],
): ResolvedBinding {
  return {
    ref: { workspaceId, bindingId, domain }, enabled: true, capabilities, storage: undefined,
    planning: domain === 'planning' ? providers.planning : undefined,
    development: domain === 'development' ? providers.development : undefined,
    delivery: domain === 'delivery' ? providers.delivery : undefined,
    execution: domain === 'execution' ? providers.execution : undefined,
  }
}

/**
 * 登记注入的 provider。执行域两个角色按能力键分开：主执行不带 `execution.run.fallback`，fallback 绑定不带
 * `execution.run.start`——否则主执行 start 不可用时 fallback 会被当成主执行选中，降级结论随之消失。
 */
export async function registerBindings(input: RegisterBindingsInput): Promise<readonly ResolvedBinding[]> {
  const bindings: ResolvedBinding[] = []
  const register = async (providers: CoreProviderTable, domain: typeof PROVIDER_DOMAINS[number], isDefault: boolean, withheld?: CapabilityKey) => {
    const snapshot = await providers[domain]!.describeCapabilities()
    if (bindings.some((item) => item.ref.bindingId === snapshot.bindingId)) throw new TypeError(`binding id ${snapshot.bindingId} 重复：两个绑定共用一个身份会让落库引用路由错`)
    const capabilities = effectiveCapabilities(snapshot, input.policy).filter((item) => item.key !== withheld)
    await input.storage.putProviderBinding({ id: snapshot.bindingId, workspaceId: input.workspaceId, domain, implementationKey: domain, enabled: true, isDefault })
    bindings.push(resolvedBinding(providers, domain, snapshot.bindingId, input.workspaceId, capabilities))
  }
  for (const domain of PROVIDER_DOMAINS) {
    if (input.providers[domain] !== undefined) await register(input.providers, domain, true, domain === 'execution' ? CapabilityKey.ExecutionRunFallback : undefined)
  }
  const fallback = input.providers.executionFallback
  if (fallback !== undefined) await register({ ...input.providers, execution: fallback }, 'execution', false, CapabilityKey.ExecutionRunStart)
  return bindings
}

export type CapabilityResolution =
  | { readonly available: true; readonly access: AccessLevel; readonly binding: ResolvedBinding }
  | { readonly available: false; readonly reason: string; readonly error: ProjectError }

/** 按 key 找提供它的绑定；找不到或不可用给出结构化结论。 */
export function resolveCapability(registry: ProviderRegistry, key: CapabilityKey): CapabilityResolution {
  const binding = bindingForCapability(registry, key)
  if (binding === undefined) return unavailableCapability(`没有绑定提供能力 ${key}`)
  const access = binding.capabilities.find((capability) => capability.key === key)?.access ?? AccessLevel.Unavailable
  if (access === AccessLevel.Unavailable) return unavailableCapability(`能力 ${key} 当前不可用`)
  return { available: true, access, binding }
}

function unavailableCapability(reason: string): CapabilityResolution {
  return { available: false, reason, error: projectError(ProjectErrorCode.NotSupported, reason) }
}
