/** 外部身份与 Draft→Issue 提升（AGENTS.md §1.1 不变量 1 / 3）：外部身份按 (binding, externalKind, externalId) 全局唯一且故意不带 workspaceId；每个实体任一时刻最多一个 active primary；提升前必须查重（`findIdentityOccupant`），目标对象已挂在别的实体上时返回 conflict 并给出占用者；提升只改身份、不新建实体。 */
import { newExternalIdentityId, type EntityId, type ExternalIdentityId, type ProviderBindingId, type WorkspaceId } from './ids.ts'

export const IdentityRole = {
  Primary: 'primary', Alias: 'alias', Historical: 'historical',
} as const
export type IdentityRole = (typeof IdentityRole)[keyof typeof IdentityRole]

/** 外部对象种类：决定提升规则（draft → issue）。 */
export const ExternalIdentityKind = {
  Draft: 'draft', Issue: 'issue', ChangeRequest: 'change_request',
  Branch: 'branch', Worktree: 'worktree',
} as const
export type ExternalIdentityKind = (typeof ExternalIdentityKind)[keyof typeof ExternalIdentityKind]

/** 一个平台对象在系统内的唯一登记；加 workspaceId 就等于把同一对象复制成多份身份。 */
export interface ExternalIdentity {
  readonly id: ExternalIdentityId
  readonly entityId: EntityId
  readonly bindingId: ProviderBindingId
  readonly externalKind: ExternalIdentityKind
  readonly externalId: string
  readonly role: IdentityRole
}

/** 外部对象键：同一 binding 内的去重唯一依据（数组序列化，避免分隔符碰撞）。 */
export function externalObjectKey(bindingId: ProviderBindingId, externalKind: ExternalIdentityKind, externalId: string): string {
  return JSON.stringify([bindingId, externalKind, externalId])
}

/** 目标外部对象的描述：查重只按对象键，不看角色。 */
export interface ExternalObjectRef {
  readonly bindingId: ProviderBindingId
  readonly externalKind: ExternalIdentityKind
  readonly externalId: string
}

/** 目标外部身份查重（纯函数）：返回已占用该对象键的身份，未占用则 undefined；命中即冲突。 */
export function findIdentityOccupant(
  identities: readonly ExternalIdentity[],
  target: ExternalObjectRef,
): ExternalIdentity | undefined {
  const key = externalObjectKey(target.bindingId, target.externalKind, target.externalId)
  return identities.find((item) => externalObjectKey(item.bindingId, item.externalKind, item.externalId) === key)
}

/** 同一外部身份在每个工作区里的投影（工作区各自持有，互不覆盖）。 */
export interface IdentityProjection {
  readonly workspaceId: WorkspaceId
  readonly identityId: ExternalIdentityId
  readonly entityId: EntityId
}

export function projectIntoWorkspace(identity: ExternalIdentity, workspaceId: WorkspaceId): IdentityProjection {
  return { workspaceId, identityId: identity.id, entityId: identity.entityId }
}

/** 登记一次外部观察：同一对象只保留一份身份；重复观察保留已分配的 id 与 entityId，否则引用会断。 */
export function registerIdentity(registry: readonly ExternalIdentity[], incoming: ExternalIdentity): readonly ExternalIdentity[] {
  const key = externalObjectKey(incoming.bindingId, incoming.externalKind, incoming.externalId)
  const index = registry.findIndex(
    (item) => externalObjectKey(item.bindingId, item.externalKind, item.externalId) === key,
  )
  const existing = index === -1 ? undefined : registry[index]
  if (existing === undefined) return [...registry, incoming]
  const next = [...registry]
  next[index] = { ...incoming, id: existing.id, entityId: existing.entityId }
  return next
}

/** active primary：唯一被允许代表实体主身份的角色；必须按实体过滤，否则会读到别家的 primary。 */
export function activePrimary(identities: readonly ExternalIdentity[], entityId: EntityId): readonly ExternalIdentity[] {
  return identities.filter(
    (identity) => identity.entityId === entityId && identity.role === IdentityRole.Primary,
  )
}

export interface PromotionInput {
  readonly entityId: EntityId
  readonly identities: readonly ExternalIdentity[]
  readonly issueExternalId: string
}

/** 目标外部身份已被占用：同一 (binding, kind, externalId) 已登记在别的实体上。 */
export interface IdentityConflict {
  readonly reason: 'external_identity_occupied'
  readonly occupant: ExternalIdentity
}

/** 提升要么成功（ok: true）要么因目标身份被占用而拒绝（ok: false）——只有这两种结果。 */
export type PromotionResult =
  | {
      readonly ok: true
      readonly entityId: EntityId
      readonly identities: readonly ExternalIdentity[]
      readonly promoted: boolean
    }
  | { readonly ok: false; readonly conflict: IdentityConflict }

/** Draft→Issue 提升（纯函数，不修改入参）：primary draft 降为 historical（保留原 id），另加一条指向 issue 的 primary；entityId 原样返回。目标身份已挂在别的实体上时返回 conflict（附占用者），已挂在本实体上时复用原 id；幂等，提升后仍只有一个 active primary。 */
export function promoteDraftToIssue(input: PromotionInput): PromotionResult {
  const draft = input.identities.find(
    (identity) =>
      identity.entityId === input.entityId &&
      identity.role === IdentityRole.Primary &&
      identity.externalKind === ExternalIdentityKind.Draft,
  )
  if (draft === undefined) {
    return { ok: true, entityId: input.entityId, identities: input.identities, promoted: false }
  }
  const existing = findIdentityOccupant(input.identities, {
    bindingId: draft.bindingId,
    externalKind: ExternalIdentityKind.Issue,
    externalId: input.issueExternalId,
  })
  if (existing !== undefined && existing.entityId !== input.entityId) {
    return { ok: false, conflict: { reason: 'external_identity_occupied', occupant: existing } }
  }
  const target: ExternalIdentity = existing ?? {
    id: newExternalIdentityId(),
    entityId: input.entityId,
    bindingId: draft.bindingId,
    externalKind: ExternalIdentityKind.Issue,
    externalId: input.issueExternalId,
    role: IdentityRole.Primary,
  }
  // 同一实体至多一个 primary：目标身份升为 primary，其余 primary（含原 draft）一律降为 historical。
  const identities = input.identities.map((item) => {
    if (item.id === target.id) return { ...item, entityId: input.entityId, role: IdentityRole.Primary }
    if (item.entityId === input.entityId && item.role === IdentityRole.Primary) {
      return { ...item, role: IdentityRole.Historical }
    }
    return item
  })
  return {
    ok: true,
    entityId: input.entityId,
    identities: existing === undefined ? [...identities, target] : identities,
    promoted: true,
  }
}
