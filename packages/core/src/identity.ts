/**
 * 身份解析：外部对象 → 稳定内部实体（AGENTS.md §1.1 不变量 1/3，ExecPlan D2）。
 *
 * 幂等由 (binding, externalKind, externalId) 唯一键保证：同一外部对象两次观察解析到同一个实体 id，
 * 重复登记保留已分配的 id 与 entityId。Draft→Issue 提升复用 domain 的纯函数：只改外部身份，
 * 内部实体 id 原样保持（`promoteDraftToIssue`）。
 */
import { createHash } from 'node:crypto'
import type { ExternalObjectRef, ProviderNativeIdentity, StorageTransaction } from '@harness-projects/capabilities'
import {
  asBrandedId,
  ContentKind,
  EntityKind,
  ExternalIdentityKind,
  IdentityRole,
  MembershipContentKind,
  promoteDraftToIssue,
  type EntityId,
  type ProviderBindingId,
} from '@harness-projects/domain'
import type { IdFactory } from './context.ts'

/** 外部对象定位子：与 capabilities 的 `ExternalObjectRef` 同形，但只保留身份需要的三个字段。 */
export interface ExternalObjectInput {
  readonly bindingId: ProviderBindingId
  readonly externalKind: ExternalIdentityKind
  readonly externalId: string
}

const PLANNING_CONTENT_KINDS: readonly string[] = Object.values(MembershipContentKind)

/** 规划条目 ref 的内容种类：只认 issue / draft / change_request；其余（含成员关系 ref）返回 undefined，调用方不得登记身份（裁决 R1）。 */
export function planningContentKind(objectKind: string): MembershipContentKind | undefined {
  return PLANNING_CONTENT_KINDS.includes(objectKind) ? (objectKind as MembershipContentKind) : undefined
}

/** 规划内容三态 → 实体种类：change_request 态（含被 redacted 的变更请求）绝不产生第二个工作项。 */
export function entityKindFor(contentKind: ContentKind, externalKind: ExternalIdentityKind): EntityKind {
  if (contentKind === ContentKind.ChangeRequest || externalKind === ExternalIdentityKind.ChangeRequest) {
    return EntityKind.ChangeRequest
  }
  return EntityKind.WorkItem
}

/** 声明缺省与非法是不同状态；不能把坏声明降级成另一个身份。 */
export function validNativeIdentity(value: unknown): value is ProviderNativeIdentity | undefined {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null) return false
  const identity = value as Record<string, unknown>
  return typeof identity.namespace === 'string' && identity.namespace.trim().length > 0
    && typeof identity.id === 'string' && identity.id.trim().length > 0
}

/** 全局 PR 身份的唯一解析点：数组编码防碰撞；opaque id 不解析、不归一。 */
export function changeRequestEntityId(ref: Pick<ExternalObjectRef, 'bindingId' | 'externalId'>, nativeIdentity?: ProviderNativeIdentity): EntityId {
  if (!validNativeIdentity(nativeIdentity)) throw new TypeError('invalid native identity')
  const key = nativeIdentity === undefined ? ['binding', ref.bindingId, ref.externalId]
    : ['native', nativeIdentity.namespace, nativeIdentity.id]
  const digest = createHash('sha256').update(JSON.stringify([EntityKind.ChangeRequest, ...key])).digest('hex').slice(0, 32)
  return asBrandedId<EntityId>(`${EntityKind.ChangeRequest}-${digest}`)
}

/** 已有自然键指向别的实体时整轮拒绝；不建立历史实体迁移或合并。 */
export class IdentityConflictError extends Error {}

/** 已登记则返回原 entityId；未登记才新建实体并登记一条 primary 身份。 */
export async function ensureEntity(
  tx: StorageTransaction,
  input: ExternalObjectInput,
  kind: EntityKind,
  ids: IdFactory,
  desiredId?: EntityId,
  // 缺省声明只复用 exact identity；明确的原生声明才可否决既有指向。
  requireDesiredIdMatch = true,
): Promise<EntityId> {
  const existing = await tx.findExternalIdentity(input.bindingId, input.externalKind, input.externalId)
  if (existing !== undefined) {
    if (requireDesiredIdMatch && desiredId !== undefined && existing.entityId !== desiredId) throw new IdentityConflictError('原生身份与已登记实体冲突')
    return existing.entityId
  }
  const entityId = desiredId ?? ids.entityId()
  const identities = await tx.listIdentitiesForEntity(entityId)
  await tx.putEntity({ id: entityId, kind })
  await tx.putExternalIdentity({
    id: ids.externalIdentityId(),
    entityId,
    bindingId: input.bindingId,
    externalKind: input.externalKind,
    externalId: input.externalId,
    role: identities.some((identity) => identity.role === IdentityRole.Primary) ? IdentityRole.Alias : IdentityRole.Primary,
  })
  return entityId
}

export interface PromotionOutcome {
  readonly ok: boolean
  readonly entityId: EntityId
  readonly reason: string | undefined
}

/** 提升只写身份：目标身份已被别的实体占用时返回冲突，不改任何一行。 */
export async function promoteEntityIdentity(
  tx: StorageTransaction,
  entityId: EntityId,
  issueExternalId: string,
): Promise<PromotionOutcome> {
  const identities = await tx.listIdentitiesForEntity(entityId)
  const result = promoteDraftToIssue({ entityId, identities, issueExternalId })
  if (!result.ok) return { ok: false, entityId, reason: result.conflict.reason }
  for (const identity of result.identities) await tx.putExternalIdentity(identity)
  return { ok: true, entityId: result.entityId, reason: undefined }
}
