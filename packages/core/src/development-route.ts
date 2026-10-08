/**
 * Development 按仓库路由（#219）。一个工作区可以挂多个 Development 连接（不变量 2）；命令按「仓库属于哪个连接」这条**持久化事实**
 * 选挂载：工作区的仓库挂载（`RepositoryRecord`）指向一条外部身份，身份的 `bindingId` 就是路由目标。不按名字、URL 或探测猜（不变量 5），
 * 不另立路由表（同一事实的第二个权威源）；缺路由或歧义时返回结构化拒绝，绝不取第一个注册者。
 *
 * 只读 Storage、不调用 provider。路由结果带着**该挂载下的仓库引用**：调用方只用它调 provider，不得自己用请求串拼引用。
 * 一次操作只路由一次：锚点 key 与同一操作的其余门（`earlier`）都在选中的同一个挂载上判定，不再按 key 另行解析。#127 引入「一个仓库并列持有多个连接的引用」时
 * 只改本函数的内部（按 key 在引用之间选），签名与调用点不变。
 */
import {
  ProjectErrorCode, bindingsForDomain, projectError,
  type CapabilityKey, type DevelopmentProvider, type ExternalObjectRef, type ProviderRegistry, type ResolvedBinding, type Storage,
} from '@harness-projects/capabilities'
import { ExternalIdentityKind, type ProjectError, type WorkspaceId } from '@harness-projects/domain'
import { gateBinding, unsupportedCapability, type CommandMode } from './capabilities.ts'

export interface DevelopmentRouteSource {
  readonly workspaceId: WorkspaceId
  readonly registry: ProviderRegistry
  readonly storage: Pick<Storage, 'listRepositories' | 'findExternalIdentity'>
}

export type DevelopmentRoute =
  | { readonly ok: true; readonly binding: ResolvedBinding; readonly provider: DevelopmentProvider; readonly repository: ExternalObjectRef }
  | { readonly ok: false; readonly error: ProjectError }

/** 在选定挂载上要过的一道门：capability key 与读 / 写模式。 */
export type DevelopmentGate = readonly [CapabilityKey, CommandMode]

/**
 * 路由规则：先**选挂载**，再在它上面按顺序过门——`earlier` 里的门先判，最后判锚点 `[key, mode]`，所以拒绝的先后顺序由调用方的清单决定，
 * 与单挂载时按 key 逐个过门完全一致（错误码、恢复动作与文案都不变）。
 * 选挂载：仓库已登记 → 身份所在的那个挂载，挂载里找不到它 → conflict（缺路由：绑定 id 变了，或仓库来自另一个连接）；
 * 仓库未登记 → 唯一挂载（随后由开始工作登记），多个挂载 → conflict（歧义）。
 * 过门：缺能力或不可用 → not_supported，只读的写 → permission_denied，都不改道到另一个挂载。
 * 缺路由时只有一个挂载就先按它过门、过了再报 conflict（门 → 缺路由，与改动前「门 → ack → 缺路由」的先后一致，只是不再调 provider）；多个挂载没有可以过门的候选，直接 conflict。
 * 没有 Development 挂载时没有可选的挂载：第一道门（`earlier` 的第一项，没有就是锚点）报「没有绑定提供能力」，排在任何 conflict 之前。
 */
export async function routeDevelopment(
  source: DevelopmentRouteSource, repositoryId: string, key: CapabilityKey, mode: CommandMode, earlier: readonly DevelopmentGate[] = [],
): Promise<DevelopmentRoute> {
  const mounts = bindingsForDomain(source.registry, 'development')
  const refuse = (code: ProjectErrorCode, message: string): DevelopmentRoute => ({ ok: false, error: projectError(code, message) })
  const ids = mounts.map((mount) => mount.ref.bindingId).join('、')
  const registered = (await source.storage.listRepositories(source.workspaceId)).find((mount) => mount.id === repositoryId)
  let binding: ResolvedBinding | undefined
  let missing: DevelopmentRoute | undefined
  if (registered === undefined) {
    if (mounts.length > 1) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记在本工作区，而工作区有 ${mounts.length} 个 Development 挂载（${ids}）：不取第一个注册者；本版本还不能在多个连接之间登记仓库，也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来`)
    binding = mounts[0]
  } else {
    for (const mount of mounts) {
      const identity = await source.storage.findExternalIdentity(mount.ref.bindingId, ExternalIdentityKind.Repository, repositoryId)
      if (identity?.id === registered.externalIdentityId) binding = mount
    }
    if (binding === undefined) {
      missing = refuse(ProjectErrorCode.Conflict, `工作区已把仓库 ${repositoryId} 挂在外部身份 ${registered.externalIdentityId} 上，但当前 Development 绑定 ${ids} 下没有它的身份——绑定 id 变了，或仓库来自另一个连接：不猜映射，Development 绑定 id 必须跨重启稳定；本版本还不能把已登记的仓库改绑到别的连接，只能让原来的 Development 连接以原绑定 id 挂回来`)
      if (mounts.length > 1) return missing
      binding = mounts[0]
    }
  }
  for (const [gateKey, gateMode] of [...earlier, [key, mode] as const]) {
    const gate = gateBinding(binding, gateKey, gateMode)
    if (!gate.allowed) return { ok: false, error: gate.error ?? unsupportedCapability(gateKey) }
  }
  if (missing !== undefined) return missing
  const provider = binding?.development
  if (binding === undefined || provider === undefined) return { ok: false, error: unsupportedCapability(key) }
  return { ok: true, binding, provider, repository: { bindingId: binding.ref.bindingId, objectKind: 'repository', externalId: repositoryId, url: undefined } }
}
