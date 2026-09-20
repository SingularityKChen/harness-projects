/**
 * 绑定解析：capability key → 提供它的 binding → provider 实例（ExecPlan D1）。
 *
 * core 只按 capability key 分支，不看 provider 名字；缺能力时返回结构化"不可用"（带恢复动作的
 * `ProjectError`），不是抛错。有效能力在这里由 `capability ∩ permission ∩ policy` 算出并登记到 binding 上。
 */
import {
  AccessLevel,
  bindingForCapability,
  effectiveCapabilities,
  projectError,
  type CapabilityDomain,
  type CapabilityKey,
  type DeliveryProvider,
  type DevelopmentProvider,
  type EffectiveCapability,
  type ExecutionProvider,
  type PlanningProvider,
  type ProviderRegistry,
  type ResolvedBinding,
  type Storage,
} from '@harness-projects/capabilities'
import {
  ProjectErrorCode,
  type ProjectError,
  type ProviderBindingId,
  type WorkspaceId,
} from '@harness-projects/domain'

/** 注入表：四个能力域各自一个可选 provider，外加本地 storage；core 不 import 任何实现。 */
export interface CoreProviderTable {
  readonly planning?: PlanningProvider
  readonly development?: DevelopmentProvider
  readonly delivery?: DeliveryProvider
  readonly execution?: ExecutionProvider
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
  providers: CoreProviderTable,
  domain: CapabilityDomain,
  bindingId: ProviderBindingId,
  workspaceId: WorkspaceId,
  capabilities: readonly EffectiveCapability[],
): ResolvedBinding {
  return {
    ref: { workspaceId, bindingId, domain },
    enabled: true,
    capabilities,
    storage: undefined,
    planning: domain === 'planning' ? providers.planning : undefined,
    development: domain === 'development' ? providers.development : undefined,
    delivery: domain === 'delivery' ? providers.delivery : undefined,
    execution: domain === 'execution' ? providers.execution : undefined,
  }
}

/** 登记注入的 provider，并把 provider 自述的能力收敛成有效访问级别；同域多个绑定只有一个默认。 */
export async function registerBindings(input: RegisterBindingsInput): Promise<readonly ResolvedBinding[]> {
  const bindings: ResolvedBinding[] = []
  for (const domain of PROVIDER_DOMAINS) {
    const provider = input.providers[domain]
    if (provider === undefined) continue
    const snapshot = await provider.describeCapabilities()
    const capabilities = effectiveCapabilities(snapshot, input.policy)
    await input.storage.putProviderBinding({
      id: snapshot.bindingId,
      workspaceId: input.workspaceId,
      domain,
      implementationKey: domain,
      enabled: true,
      isDefault: true,
    })
    bindings.push(resolvedBinding(input.providers, domain, snapshot.bindingId, input.workspaceId, capabilities))
  }
  return bindings
}

export type CapabilityResolution =
  | { readonly available: true; readonly access: AccessLevel; readonly binding: ResolvedBinding }
  | { readonly available: false; readonly reason: string; readonly error: ProjectError }

/** 按 capability key 找提供它的绑定；找不到或不可用时给出结构化结论，调用方据此降级或转人工。 */
export function resolveCapability(registry: ProviderRegistry, key: CapabilityKey): CapabilityResolution {
  const binding = bindingForCapability(registry, key)
  if (binding === undefined) return unavailableCapability(`没有绑定提供能力 ${key}`)
  const access =
    binding.capabilities.find((capability) => capability.key === key)?.access ?? AccessLevel.Unavailable
  if (access === AccessLevel.Unavailable) return unavailableCapability(`能力 ${key} 当前不可用`)
  return { available: true, access, binding }
}

function unavailableCapability(reason: string): CapabilityResolution {
  return { available: false, reason, error: projectError(ProjectErrorCode.NotSupported, reason) }
}
