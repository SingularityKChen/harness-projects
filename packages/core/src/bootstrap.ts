/**
 * 工作区引导：绑定 Planning provider → 读项目与条目 → 落成三态投影 → 写游标 → 修订号 +1（#76）。
 * 重复引导安全：身份按外部对象唯一键幂等，观察按 (binding, dedupeKey) 去重，投影按 (workspace, entity)
 * upsert。provider 失败只把同步游标标成 degraded 并返回结构化结果，最后已知值原样留给查询读。
 */
import {
  CapabilityKey, ObservationState, ProjectErrorCode, SyncState, projectCodeForProviderError,
  projectError, providerErr, providerError, providerOk, singlePlanningBinding,
  type ExternalObjectRef, type FieldValueRecord, type PlanningProvider, type ProviderError,
  type ProviderObservation, type ProviderPlanningContent, type ProviderPlanningFieldDefinition,
  type ProviderPlanningItem, type ProviderResult, type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  ContentKind, EntityKind, ProviderErrorCode, normalizePlanningStatus,
  type EntityId, type PlanningContent, type ProjectError, type ProviderBindingId,
  type WorkspaceId, type WorkspacePlanningFieldMapping, type WorkspaceProjection,
} from '@harness-projects/domain'
import { gateCommand } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { ensureEntity, entityKindFor, planningContentKind } from './identity.ts'
import { assertPlanningFieldRoleDefinitions, encodeNativePlanningFieldValue, projectPlanningFields } from './planning-fields.ts'

/** 一个工作空间只有一个 Planning 事实源（不变量 1），因此每个（工作区，绑定）只需要一条同步游标。 */
export const PLANNING_SYNC_SCOPE = 'planning.project'
const PAGE_LIMIT = 50
/** 单次引导的页数上界（50 × 1000 = 5 万条）；与成环判定各自独立，任一命中都按不完整读取处理、不提交。 */
const MAX_PAGES = 1000

export interface BootstrapResult {
  readonly ok: boolean
  readonly entities: number
  readonly workItems: number
  readonly changeRequests: number
  /** 没有内容身份、且按成员关系也找不回已登记实体的条目数：它们不进投影，其余照常提交，游标记为 healthy 加错误码（D23）。 */
  readonly unanchored: number
  readonly revision: number
  readonly degraded: boolean
  readonly error: ProjectError | undefined
}

interface SyncedItems { counts: SyncCounts; projections: readonly WorkspaceProjection[] }

interface SyncCounts {
  entities: number
  workItems: number
  changeRequests: number
  unanchored: number
}

/**
 * 引导入口。同一 CoreContext 的调用经 `bootstrapQueue` 串行：队列入口**捕获本次 pending 映射**，ack 之后才更新
 * 已确认值并清 pending；失败释放队列，下一次仍可用同一 pending 重试（#133）。待确认映射与字段定义在写任何行
 * 之前校验：定义不可用或角色/选项不合法即整次失败，旧映射与旧快照原样保留。
 */
export function bootstrapWorkspace(context: CoreContext): Promise<BootstrapResult> {
  const pending = context.pendingPlanningFieldMapping
  const run = context.bootstrapQueue.then(() => runBootstrap(context, pending), () => runBootstrap(context, pending))
  context.bootstrapQueue = run.then(() => undefined, () => undefined)
  return run
}

async function runBootstrap(context: CoreContext, pending: WorkspacePlanningFieldMapping | null | undefined): Promise<BootstrapResult> {
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
  // 定义一次只取一次；读取面不提供定义时映射角色全部降级为 unset（不按名称猜字段）。
  const definitionResult = await planning.listFieldDefinitions(project.value)
  if (!definitionResult.ok) return fail(context, binding.ref.bindingId, toProjectError(definitionResult.error))
  const definitions = definitionResult.value
  const confirmed = pending === undefined ? context.planningFieldMapping : (pending ?? undefined)
  try {
    if (confirmed !== undefined && confirmed.projectExternalId !== project.value.externalId) {
      throw new TypeError(`planningFieldMapping 的 projectExternalId ${confirmed.projectExternalId} 与实际发现项目 ${project.value.externalId} 不符`)
    }
    if (pending !== undefined && pending !== null) assertPlanningFieldRoleDefinitions(pending, definitions)
  } catch (error) {
    return fail(context, binding.ref.bindingId, projectError(ProjectErrorCode.InvalidInput, error instanceof Error ? error.message : String(error)))
  }
  let result: BootstrapResult
  try {
    result = await commitSync(context, binding.ref.bindingId, items.value, observations, definitions, confirmed, pending)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result = await fail(context, binding.ref.bindingId, projectError(ProjectErrorCode.ResultUnknown, `规划同步事务失败：${message}`))
  }
  if (result.ok) {
    context.planningFieldMapping = confirmed
    context.pendingPlanningFieldMapping = undefined
  }
  return result
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

/** 分页读全量条目，直到 nextCursor 未定义；游标回到已发送过的值（成环）或超过页数上界时返回结构化失败。 */
async function readAllItems(
  planning: PlanningProvider, project: ExternalObjectRef,
): Promise<ProviderResult<readonly ProviderPlanningItem[]>> {
  const items: ProviderPlanningItem[] = []
  const sent = new Set<string>()
  let cursor: string | undefined
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await planning.listPlanningItems({ project, cursor, limit: PAGE_LIMIT })
    if (!page.ok) return page
    items.push(...page.value.items)
    cursor = page.value.nextCursor
    if (cursor === undefined) return providerOk(items)
    if (sent.has(cursor)) break
    sent.add(cursor)
  }
  return providerErr(providerError(ProviderErrorCode.Unavailable, '规划条目分页成环或超过页数上界，本次读取不完整'))
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
  definitions: readonly ProviderPlanningFieldDefinition[],
  confirmedMapping: WorkspacePlanningFieldMapping | undefined,
  pendingMapping: WorkspacePlanningFieldMapping | null | undefined,
): Promise<BootstrapResult> {
  const committed = await context.storage.transaction(async (tx) => {
    const revision = await tx.advanceRevision(context.workspaceId)
    const synced = await upsertItems(tx, context, items, revision, definitions, confirmedMapping)
    await recordObservations(tx, observations)
    await tx.replacePlanningProjections({ workspaceId: context.workspaceId, bindingId }, synced.projections)
    // 映射与字段、投影同事务确认：待确认输入在这一笔里才成为已确认配置；省略输入保留注册时读回的旧映射。
    const workspace = await tx.getWorkspace(context.workspaceId)
    if (workspace !== undefined) {
      const mapping = pendingMapping === undefined ? workspace.planningFieldMapping : (pendingMapping ?? undefined)
      await tx.putWorkspace(mapping === undefined ? { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy } : { ...workspace, planningFieldMapping: mapping })
    }
    // 提交成功即 healthy；有缺口只带错误码，不写 degraded（degraded / failed 留给什么都没提交的读取，D23）。
    const incomplete = synced.counts.unanchored > 0
    await tx.putSyncCursor({
      workspaceId: context.workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined,
      state: SyncState.Healthy, lastErrorCode: incomplete ? ProjectErrorCode.PermissionDenied : undefined,
    })
    return { revision, counts: synced.counts }
  })
  const { unanchored } = committed.counts
  return {
    ok: true, entities: committed.counts.entities, workItems: committed.counts.workItems,
    changeRequests: committed.counts.changeRequests, unanchored, revision: committed.revision, degraded: unanchored > 0,
    error: unanchored > 0 ? projectError(ProjectErrorCode.PermissionDenied, `${unanchored} 个条目对当前凭据不可见，按成员关系也找不回本地实体`) : undefined,
  }
}
/**
 * 一个条目一个成员：先解析稳定内部实体，再把权威字段与三态内容写成工作区投影，并在同一事务里整组替换该成员的
 * 原生字段值（空组 = 清空）。`fields.nativeValues` 缺省 = Provider 没有读取面，投影不带 `planningFields`；空对象 =
 * 完整读回且没有值（投影 `status: unset`，不残留旧日期/迭代）。redacted 条目按空组处理（不依赖 Provider 记得发
 * 空对象），因此整组替换会清掉上次可见时留下的行：被平台扣下的值不得继续留在库里，否则一次诊断或导出就能把
 * Provider 已收回的值读出来。
 */
async function upsertItems(
  tx: StorageTransaction, context: CoreContext,
  items: readonly ProviderPlanningItem[], revision: number,
  definitions: readonly ProviderPlanningFieldDefinition[],
  mapping: WorkspacePlanningFieldMapping | undefined,
): Promise<SyncedItems> {
  const counts: SyncCounts = { entities: 0, workItems: 0, changeRequests: 0, unanchored: 0 }
  const projections: WorkspaceProjection[] = []
  for (const item of items) {
    const anchor = await anchorOf(tx, context, item)
    if (anchor === undefined) {
      counts.unanchored += 1
      continue
    }
    const redacted = item.content.kind === ContentKind.Redacted
    // 被扣下的内容一律按「完整读回且没有任何值」处理，不依赖 Provider 记得发空对象：Provider 只报告事实，
    // 「不得把已收回的值留在库里」是 core 的义务。原生字段值缺省表示没有读取面，但 redacted 条目即使缺省
    // 也必须清空——否则上一次可见时落库的行会留在诊断/导出里（见上方函数注释）。
    const nativeValues = redacted ? {} : item.fields.nativeValues
    if (nativeValues !== undefined) {
      // 空组同样走整组替换：旧日期 / 旧迭代必须被清掉。
      const observedAt = item.sourceUpdatedAt ?? context.clock()
      const values: FieldValueRecord[] = Object.entries(nativeValues).map(([projectFieldId, value]) => ({
        workspaceId: context.workspaceId, itemExternalId: item.membership.externalId, projectFieldId,
        value: encodeNativePlanningFieldValue(value), observedAt,
      }))
      await tx.replaceFieldValues(context.workspaceId, item.membership.externalId, values)
    }
    const projection = toProjection(context.workspaceId, anchor.entityId, item, revision,
      nativeValues === undefined ? undefined : projectPlanningFields(nativeValues, definitions, mapping))
    await tx.putPlanningProjection(context.workspaceId, projection)
    projections.push(projection)
    counts.entities += 1
    if (anchor.kind === EntityKind.ChangeRequest) counts.changeRequests += 1
    else counts.workItems += 1
  }
  return { counts, projections }
}

/**
 * 条目的本地锚点。有内容身份：先记下成员关系 → 内容的映射，再解析（必要时新建）实体。没有内容身份（REDACTED / content 为 null）：
 * 只读地按成员关系找回上次可见时登记的实体，投影内容仍取本次读到的 redacted，不回退缓存；找不到返回 undefined。
 */
async function anchorOf(
  tx: StorageTransaction, context: CoreContext, item: ProviderPlanningItem,
): Promise<{ entityId: EntityId; kind: EntityKind } | undefined> {
  const { workspaceId } = context
  const contentKind = planningContentKind(item.ref.objectKind)
  if (contentKind === undefined) {
    const known = await tx.getMembership(workspaceId, item.membership.externalId)
    const identity = known && await tx.findExternalIdentity(item.ref.bindingId, known.contentKind, known.contentExternalId)
    return identity && { entityId: identity.entityId, kind: entityKindFor(item.content.kind, identity.externalKind) }
  }
  await tx.putMembership({
    workspaceId, projectExternalId: item.project.externalId, itemExternalId: item.membership.externalId, contentKind,
    contentExternalId: item.ref.externalId, membershipCreatedAt: item.membership.createdAt, membershipUpdatedAt: item.membership.updatedAt,
  })
  const external = { bindingId: item.ref.bindingId, externalKind: contentKind, externalId: item.ref.externalId }
  const kind = entityKindFor(item.content.kind, contentKind)
  return { entityId: await ensureEntity(tx, external, kind, context.ids), kind }
}

function toProjection(
  workspaceId: WorkspaceId, entityId: EntityId, item: ProviderPlanningItem, revision: number,
  planningFields: WorkspaceProjection['planningFields'],
): WorkspaceProjection {
  return {
    workspaceId, entityId, revision,
    planningStatus: normalizePlanningStatus(item.fields.statusKey ?? 'unknown'),
    content: toContent(item.content),
    ...(planningFields === undefined ? {} : { planningFields }),
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
      workspaceId: context.workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined,
      state: SyncState.Degraded, lastErrorCode: error.code,
    })
  }
  return {
    ok: false, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, degraded: true, error,
    revision: await context.storage.currentRevision(context.workspaceId),
  }
}

function toProjectError(error: ProviderError): ProjectError {
  return projectError(projectCodeForProviderError(error.code), error.message)
}
