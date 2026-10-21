/**
 * Development 按仓库路由（#219、#353）。一个工作区可以挂多个 Development 连接（不变量 2）；命令按「仓库属于哪个连接」这条**持久化事实**
 * 选挂载：工作区的仓库挂载（`RepositoryRecord`）指向锚点身份，锚点实体在各连接下的 primary / alias 身份就是仓库的现行引用（ADR-0015），
 * 引用所在的挂载是路由候选。不按名字、URL 或探测猜（不变量 5），不另立路由表（同一事实的第二个权威源）；缺路由或歧义时返回结构化拒绝，绝不取第一个注册者。
 *
 * 只读 Storage、不调用 provider。路由结果带着**该挂载下的仓库引用**：调用方只用它调 provider，不得自己用请求串拼引用。
 * 一次操作只路由一次：锚点 key 选挂载，同一操作的其余门（`earlier`）都在选中的同一个挂载上判定，不再按 key 另行解析。
 */
import {
  CapabilityKey, ProjectErrorCode, bindingsForDomain, projectError,
  type DevelopmentProvider, type ExternalObjectRef, type ProviderRegistry, type RepositoryRecord, type ResolvedBinding, type Storage,
  type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  EntityKind, ExternalIdentityKind, IdentityRole, asBrandedId,
  type EntityId, type ExternalIdentity, type ProjectError, type ProviderBindingId, type WorkspaceId,
} from '@harness-projects/domain'
import { gateBinding, unsupportedCapability, type CommandMode } from './capabilities.ts'
import type { IdFactory } from './context.ts'

export interface DevelopmentRouteSource {
  readonly workspaceId: WorkspaceId
  readonly registry: ProviderRegistry
  readonly storage: Pick<Storage, 'listRepositories' | 'findExternalIdentity' | 'listIdentitiesForEntity'>
}

export type DevelopmentRoute =
  | { readonly ok: true; readonly binding: ResolvedBinding; readonly provider: DevelopmentProvider; readonly repository: ExternalObjectRef }
  | { readonly ok: false; readonly error: ProjectError }

/** 在选定挂载上要过的一道门：capability key 与读 / 写模式。 */
export type DevelopmentGate = readonly [CapabilityKey, CommandMode]

/** 一次操作：锚点 key 选挂载，前置门在同一挂载上按顺序先判；`reports` 是工作区元数据按本操作逐仓库报告的 key（每个 key 只由一个操作报告）。 */
export interface DevelopmentOperation { readonly anchor: DevelopmentGate; readonly earlier: readonly DevelopmentGate[]; readonly reports: readonly CapabilityKey[] }

/** 开始工作：锚点是工作树创建的写门；分支创建的写门（只读即拒绝）与仓库读、工作树读两个读门先于任何本地与外部写入，按这个顺序先于锚点判定。 */
export const START_WORK_ROUTE: DevelopmentOperation = {
  anchor: [CapabilityKey.DevelopmentWorktreeCreate, 'write'],
  earlier: [[CapabilityKey.DevelopmentBranchCreate, 'write'], [CapabilityKey.DevelopmentRepositoryRead, 'read'], [CapabilityKey.DevelopmentWorktreeRead, 'read']],
  reports: [CapabilityKey.DevelopmentWorktreeCreate, CapabilityKey.DevelopmentBranchCreate, CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentWorktreeRead],
}

/** 变更请求读：PR 谱系的变更请求与远端分支头都按它路由（#297），不单独按 `repository.read` 路由——那个 key 两个实现都声明，恒歧义。 */
export const CHANGE_REQUEST_READ_ROUTE: DevelopmentOperation = {
  anchor: [CapabilityKey.DevelopmentChangeRequestRead, 'read'], earlier: [[CapabilityKey.DevelopmentRepositoryRead, 'read']], reports: [CapabilityKey.DevelopmentChangeRequestRead],
}

/**
 * 路由规则：先**选挂载**，再在它上面按顺序过门——`earlier` 里的门先判，最后判锚点 `[key, mode]`，所以拒绝的先后顺序由调用方的清单决定，
 * 与单挂载时按 key 逐个过门完全一致（错误码、恢复动作与文案都不变）。
 * 选挂载：仓库已登记 → 恰一条现行引用就用它；多条时取唯一声明锚点 key 的那条（不论访问级别），没有声明者 → not_supported（锚点 key），
 * 多个声明者 → conflict（歧义，零 provider 调用）；角色与登记顺序都不是输入。没有现行引用 → conflict（缺路由：绑定 id 变了，或仓库来自另一个连接）；
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
    const references = await repositoryReferences(source.storage, registered, mounts.map((mount) => mount.ref.bindingId))
    const serving = mounts.filter((mount) => references.some((identity) => identity.bindingId === mount.ref.bindingId))
    const declarers = serving.filter((mount) => mount.capabilities.some((capability) => capability.key === key))
    // 两种拒绝都带出连接 id（ADR-0015 约束③）：not_supported 带服务该仓库的连接，conflict 带声明者。
    if (serving.length > 1 && declarers.length === 0) return refuse(ProjectErrorCode.NotSupported, `能力 ${key} 不可用：仓库 ${repositoryId} 在 ${serving.length} 个 Development 连接（${serving.map((mount) => mount.ref.bindingId).join('、')}）下的引用都没有声明它，不改道到别的连接`)
    if (serving.length > 1 && declarers.length > 1) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 在 ${declarers.length} 个 Development 连接（${declarers.map((mount) => mount.ref.bindingId).join('、')}）下的引用都声明 ${key}：不取第一个注册者；本版本还不能解绑或改绑仓库的引用`)
    binding = serving.length > 1 ? declarers[0] : serving[0]
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

/**
 * 仓库的现行引用（ADR-0015）：各连接下与仓库键同名、角色是 primary / alias 的身份，只留锚点所在实体上的那些——同名但属于别的实体的身份不算。
 * 锚点所在的连接不在 `bindingIds` 里（例如没有组合）时，经 `listIdentitiesForEntity` 确认候选实体是否持有锚点；找不到锚点实体即没有现行引用。
 */
export async function repositoryReferences(
  storage: Pick<Storage, 'findExternalIdentity' | 'listIdentitiesForEntity'>, record: RepositoryRecord, bindingIds: readonly ProviderBindingId[],
): Promise<readonly ExternalIdentity[]> {
  const found: ExternalIdentity[] = []
  for (const bindingId of new Set(bindingIds)) {
    const identity = await storage.findExternalIdentity(bindingId, ExternalIdentityKind.Repository, record.id)
    if (identity !== undefined && identity.role !== IdentityRole.Historical) found.push(identity)
  }
  let entityId = found.find((identity) => identity.id === record.externalIdentityId)?.entityId
  for (const candidate of entityId === undefined ? found : []) {
    if ((await storage.listIdentitiesForEntity(candidate.entityId)).some((identity) => identity.id === record.externalIdentityId)) { entityId = candidate.entityId; break }
  }
  return found.filter((identity) => identity.entityId === entityId)
}

/**
 * 仓库实体、引用身份与仓库挂载的唯一写者（ADR-0015 决定 5）：绑定命令与开始工作的懒登记共用，只在调用方的事务内调用。
 * 未登记：第一个连接下找到或新建身份（新建即新实体上的 primary），其余连接补 alias，最后仓库挂载指向第一个。
 * 已登记：锚点不改指、不碰仓库挂载；各连接下已有的身份必须在锚点实体上（否则抛错，事务回滚，不重新识别），缺的补 alias——所以已有引用的连接零写入。
 */
export async function registerRepository(
  tx: StorageTransaction, ids: Pick<IdFactory, 'entityId' | 'externalIdentityId'>, workspaceId: WorkspaceId, repositoryId: string, bindingIds: readonly ProviderBindingId[],
): Promise<void> {
  const registered = (await tx.listRepositories(workspaceId)).find((mount) => mount.id === repositoryId)
  let anchor = registered?.externalIdentityId
  let entityId: EntityId | undefined
  if (registered !== undefined) {
    const mounts = (await tx.listProviderBindings(workspaceId)).map((mount) => mount.id)
    entityId = (await repositoryReferences(tx, registered, mounts))[0]?.entityId
    if (entityId === undefined) throw new Error(`仓库 ${repositoryId} 已登记，但本工作区的挂载下找不到它的锚点：不猜实体`)
  }
  for (const bindingId of bindingIds) {
    let identity = await tx.findExternalIdentity(bindingId, ExternalIdentityKind.Repository, repositoryId)
    if (identity !== undefined && entityId !== undefined && identity.entityId !== entityId) throw new Error(`连接 ${bindingId} 下的仓库 ${repositoryId} 属于另一个实体：不重新识别`)
    if (identity === undefined) {
      identity = {
        id: ids.externalIdentityId(), entityId: entityId ?? ids.entityId(), bindingId,
        externalKind: ExternalIdentityKind.Repository, externalId: repositoryId, role: entityId === undefined ? IdentityRole.Primary : IdentityRole.Alias,
      }
      if (entityId === undefined) await tx.putEntity({ id: identity.entityId, kind: EntityKind.Repository })
      await tx.putExternalIdentity(identity)
    }
    entityId = identity.entityId
    anchor ??= identity.id
  }
  if (registered === undefined && anchor !== undefined) await tx.putRepository({ id: asBrandedId<EntityId>(repositoryId), workspaceId, externalIdentityId: anchor })
}
