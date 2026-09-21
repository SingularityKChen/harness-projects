/**
 * 工作区引导：绑定 Planning provider → 读项目与条目 → 落成三态投影 → 写游标 → 修订号 +1（#76）。
 * 重复引导安全：身份按外部对象唯一键幂等，观察按 (binding, dedupeKey) 去重，投影按 (workspace, entity)
 * upsert。provider 失败只把同步游标标成 degraded 并返回结构化结果，最后已知值原样留给查询读。
 */
import {
  CapabilityKey, ObservationState, ProjectErrorCode, SyncState, projectCodeForProviderError,
  projectError, providerErr, providerError, providerOk, singlePlanningBinding,
  type ExternalObjectRef, type PlanningProvider, type ProviderError, type ProviderObservation,
  type ProviderPlanningContent, type ProviderPlanningItem, type ProviderResult, type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  ContentKind, EntityKind, ProviderErrorCode, normalizePlanningStatus,
  type EntityId, type PlanningContent, type ProjectError, type ProviderBindingId,
  type WorkspaceId, type WorkspaceProjection,
} from '@harness-projects/domain'
import { gateCommand } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { asExternalKind, ensureEntity, entityKindFor } from './identity.ts'

/** 一个工作空间只有一个 Planning 事实源（不变量 1），因此一个绑定只需要一条同步游标。 */
export const PLANNING_SYNC_SCOPE = 'planning.project'
const PAGE_LIMIT = 50

export interface BootstrapResult {
  readonly ok: boolean
  readonly entities: number
  readonly workItems: number
  readonly changeRequests: number
  readonly revision: number
  readonly degraded: boolean
  readonly error: ProjectError | undefined
}

interface SyncedItems { counts: SyncCounts; projections: readonly WorkspaceProjection[] }

interface SyncCounts {
  entities: number
  workItems: number
  changeRequests: number
}

export async function bootstrapWorkspace(context: CoreContext): Promise<BootstrapResult> {
  const binding = singlePlanningBinding(context.registry)
  const gate = gateCommand(context.registry, CapabilityKey.PlanningItemRead, 'read')
  const planning = binding?.planning
  if (binding === undefined || planning === undefined || !gate.allowed) {
    const error = gate.error ?? projectError(ProjectErrorCode.NotSupported, '没有可用的 Planning 绑定')
    return fail(context, binding?.ref.bindingId, error)
  }
  const observations = await collectObservations(planning)
  const project = await readProject(context, planning, observations)
  if (!project.ok) return fail(context, binding.ref.bindingId, toProjectError(project.error))
  const items = await readAllItems(planning, project.value)
  if (!items.ok) return fail(context, binding.ref.bindingId, toProjectError(items.error))
  return commitSync(context, binding.ref.bindingId, items.value, observations)
}

/** 项目范围优先用注入值；否则从观察主体反查条目取回 project，不猜外部 id。 */
async function readProject(
  context: CoreContext, planning: PlanningProvider, observations: readonly ProviderObservation[],
): Promise<ProviderResult<ExternalObjectRef>> {
  let ref = context.projectRef
  if (ref === undefined) {
    for (const observation of observations) {
      const item = await planning.getPlanningItem(observation.subject)
      if (item.ok) {
        ref = item.value.project
        break
      }
    }
  }
  if (ref === undefined) return providerErr(providerError(ProviderErrorCode.NotFound, '没有可发现的规划项目'))
  const result = await planning.getProject(ref)
  if (!result.ok) return result
  context.projectRef = result.value.ref
  return providerOk(result.value.ref)
}

/** 分页读全量条目：游标由 provider 给出，直到 nextCursor 未定义。 */
async function readAllItems(
  planning: PlanningProvider, project: ExternalObjectRef,
): Promise<ProviderResult<readonly ProviderPlanningItem[]>> {
  const items: ProviderPlanningItem[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await planning.listPlanningItems({ project, cursor, limit: PAGE_LIMIT })
    if (!page.ok) return page
    items.push(...page.value.items)
    cursor = page.value.nextCursor
    if (cursor === undefined) return providerOk(items)
  }
}

/** 观察流是同步输入（D2）：provider 没有观察流时返回空表，不影响权威读取。 */
async function collectObservations(planning: PlanningProvider): Promise<readonly ProviderObservation[]> {
  if (planning.reconcile === undefined) return []
  const observations: ProviderObservation[] = []
  for await (const observation of planning.reconcile({ scopeKey: PLANNING_SYNC_SCOPE, cursor: undefined })) {
    observations.push(observation)
  }
  return observations
}

async function commitSync(
  context: CoreContext, bindingId: ProviderBindingId,
  items: readonly ProviderPlanningItem[], observations: readonly ProviderObservation[],
): Promise<BootstrapResult> {
  const committed = await context.storage.transaction(async (tx) => {
    const revision = await tx.advanceRevision(context.workspaceId)
    const synced = await upsertItems(tx, context, items, revision)
    await recordObservations(tx, observations)
    await tx.replacePlanningProjections({ workspaceId: context.workspaceId, bindingId }, synced.projections)
    await tx.putSyncCursor({
      bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined,
      state: SyncState.Healthy, lastErrorCode: undefined,
    })
    return { revision, counts: synced.counts }
  })
  return {
    ok: true, entities: committed.counts.entities, workItems: committed.counts.workItems,
    changeRequests: committed.counts.changeRequests, revision: committed.revision,
    degraded: false, error: undefined,
  }
}
/** 一个条目一个成员：先解析稳定内部实体，再把权威字段与三态内容写成工作区投影。 */
async function upsertItems(
  tx: StorageTransaction, context: CoreContext,
  items: readonly ProviderPlanningItem[], revision: number,
): Promise<SyncedItems> {
  const counts: SyncCounts = { entities: 0, workItems: 0, changeRequests: 0 }
  const projections: WorkspaceProjection[] = []
  for (const item of items) {
    const external = {
      bindingId: item.ref.bindingId,
      externalKind: asExternalKind(item.ref.objectKind),
      externalId: item.ref.externalId,
    }
    const kind = entityKindFor(item.content.kind, external.externalKind)
    const entityId = await ensureEntity(tx, external, kind, context.ids)
    const projection = toProjection(context.workspaceId, entityId, item, revision)
    await tx.putPlanningProjection(context.workspaceId, projection)
    projections.push(projection)
    counts.entities += 1
    if (kind === EntityKind.ChangeRequest) counts.changeRequests += 1
    else counts.workItems += 1
  }
  return { counts, projections }
}

function toProjection(
  workspaceId: WorkspaceId, entityId: EntityId, item: ProviderPlanningItem, revision: number,
): WorkspaceProjection {
  return {
    workspaceId, entityId, revision,
    planningStatus: normalizePlanningStatus(item.fields.statusKey ?? 'unknown'),
    content: toContent(item.content),
  }
}

/** provider 内容三态 → 领域三态；redacted 是一等状态，不回退到缓存或推断值。 */
function toContent(content: ProviderPlanningContent): PlanningContent {
  if (content.kind === ContentKind.WorkItem) {
    return { contentKind: ContentKind.WorkItem, title: content.workItem.title, body: content.workItem.body }
  }
  if (content.kind === ContentKind.ChangeRequest) {
    const cr = content.changeRequest
    return { contentKind: ContentKind.ChangeRequest, number: cr.number, title: cr.title, body: cr.body }
  }
  return { contentKind: ContentKind.Redacted, reason: content.reason }
}

async function recordObservations(
  tx: StorageTransaction, observations: readonly ProviderObservation[],
): Promise<void> {
  for (const observation of observations) {
    await tx.recordObservation({ observation, state: ObservationState.Processed })
  }
}

/** 失败只改同步游标：投影保持最后已知值，查询据此标记 degraded。 */
async function fail(
  context: CoreContext, bindingId: ProviderBindingId | undefined, error: ProjectError,
): Promise<BootstrapResult> {
  if (bindingId !== undefined) {
    await context.storage.putSyncCursor({
      bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined,
      state: SyncState.Degraded, lastErrorCode: error.code,
    })
  }
  return {
    ok: false, entities: 0, workItems: 0, changeRequests: 0, degraded: true, error,
    revision: await context.storage.currentRevision(context.workspaceId),
  }
}

function toProjectError(error: ProviderError): ProjectError {
  return projectError(projectCodeForProviderError(error.code), error.message)
}
