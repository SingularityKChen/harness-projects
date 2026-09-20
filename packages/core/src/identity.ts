/**
 * 身份解析：外部对象 → 稳定内部实体（AGENTS.md §1.1 不变量 1/3，ExecPlan D2）。
 *
 * 幂等由 (binding, externalKind, externalId) 唯一键保证：同一外部对象两次观察解析到同一个实体 id，
 * 重复登记保留已分配的 id 与 entityId。Draft→Issue 提升复用 domain 的纯函数：只改外部身份，
 * 内部实体 id 原样保持（`promoteDraftToIssue`）。
 */
import type { StorageTransaction } from '@harness-projects/capabilities'
import {
  ContentKind,
  EntityKind,
  ExternalIdentityKind,
  IdentityRole,
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

const KNOWN_EXTERNAL_KINDS: readonly string[] = Object.values(ExternalIdentityKind)

/** provider 的 objectKind 是自由字符串；MVP-0 只认识 issue/draft/change_request，未知一律按 issue 处理。 */
export function asExternalKind(raw: string): ExternalIdentityKind {
  return KNOWN_EXTERNAL_KINDS.includes(raw) ? (raw as ExternalIdentityKind) : ExternalIdentityKind.Issue
}

/** 规划内容三态 → 实体种类：change_request 态（含被 redacted 的变更请求）绝不产生第二个工作项。 */
export function entityKindFor(contentKind: ContentKind, externalKind: ExternalIdentityKind): EntityKind {
  if (contentKind === ContentKind.ChangeRequest || externalKind === ExternalIdentityKind.ChangeRequest) {
    return EntityKind.ChangeRequest
  }
  return EntityKind.WorkItem
}

/** 已登记则返回原 entityId；未登记才新建实体并登记一条 primary 身份。 */
export async function ensureEntity(
  tx: StorageTransaction,
  input: ExternalObjectInput,
  kind: EntityKind,
  ids: IdFactory,
): Promise<EntityId> {
  const existing = await tx.findExternalIdentity(input.bindingId, input.externalKind, input.externalId)
  if (existing !== undefined) return existing.entityId
  const entityId = ids.entityId()
  await tx.putEntity({ id: entityId, kind })
  await tx.putExternalIdentity({
    id: ids.externalIdentityId(),
    entityId,
    bindingId: input.bindingId,
    externalKind: input.externalKind,
    externalId: input.externalId,
    role: IdentityRole.Primary,
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
