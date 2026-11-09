/**
 * 工作区引导：绑定 Planning provider → 读项目与条目 → 落成三态投影 → 写游标与对账时刻；快照内容变化才推进修订号，规则见 ADR-0012（#76、#220）。
 * 重复引导安全：身份按外部对象唯一键幂等，观察按 (binding, dedupeKey) 去重，投影按 (workspace, entity)
 * upsert。普通失败保留最后许可值；明确拒读原子提交 redacted 并推进内容修订，落库失败仍以内存拒读关闭读门。异常原文仅交宿主诊断出口（TD-030）。
 */
import {
  CapabilityKey, ObservationState, ProjectErrorCode, SyncState, projectCodeForProviderError,
  projectError, providerErr, providerError, providerOk, singlePlanningBinding, providerRegistry,
  type ExternalObjectRef, type MembershipRecord, type PlanningProvider, type PlanningSyncRoundRecord, type ProviderError, type ProviderObservation,
  type ProviderProject, type ResolvedBinding, type ProviderPlanningContent, type ProviderPlanningItem, type ProviderResult, type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  ContentKind, EntityKind, IdentityRole, MembershipContentKind, ProviderErrorCode, sourceNumberSnapshot,
  type EntityId, type PlanningContent, type ProjectError, type ProviderBindingId,
  type WorkspaceId, type WorkspacePlanningFieldMapping, type WorkspaceProjection,
} from '@harness-projects/domain'
import { isDeepStrictEqual } from 'node:util'
import { gateCommand } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { reportSyncRoundFailure } from './diagnostics.ts'
import { changeRequestEntityId, ensureEntity, entityKindFor, IdentityConflictError, planningContentKind, promoteEntityIdentity, validNativeIdentity } from './identity.ts'
import { planningFieldsOf } from './planning-fields.ts'
import { collectBindings } from './registry.ts'
import { redactPlanning, PLANNING_DENIED } from './runtime-access.ts'

/** 一个工作空间只有一个 Planning 事实源（不变量 1），因此每个（工作区，绑定）只需要一条同步游标。 */
export const PLANNING_SYNC_SCOPE = 'planning.project'
const PAGE_LIMIT = 50
/** 单次引导的页数上界（50 × 1000 = 5 万条）；与成环判定各自独立，任一命中都按不完整读取处理、不提交。 */
const MAX_PAGES = 1000
/** 一轮同步在读取或提交时异常中止的固定文案：不含驱动文字、SQL、provider 给的版本值或堆栈，因为命令结果会经 controller 发给 client（#199）。 */
const SYNC_ROUND_FAILED = '同步异常中止，本轮没有提交任何事实；读侧保留最后已知值'

export interface BootstrapResult {
  readonly ok: boolean
  readonly entities: number
  readonly workItems: number
  readonly changeRequests: number
  /** 没有内容身份、且按成员关系也找不回已登记实体的条目数：它们不进投影，其余照常提交，游标记为 healthy 加错误码（D23）。 */
  readonly unanchored: number
  /** 本轮结束时的工作区业务修订号：内容不变或未提交时就是当前值，内容变化时是推进后的值（ADR-0012）。 */
  readonly revision: number
  readonly degraded: boolean
  readonly error: ProjectError | undefined
}

/** 同步先算出不带修订号的行：行修订号由事务里的变化判定决定（ADR-0012 第 2 条）。 */
type UnstampedProjection = Omit<WorkspaceProjection, 'revision'>
interface SyncedItems { counts: SyncCounts; projections: readonly UnstampedProjection[]; memberships: readonly MembershipRecord[] }
/** 通过整批校验的完整读取：成员关系的删除 scope 只能取自这里的 project，与条目校验同源。 */
interface ValidatedPlanningRead { readonly project: ExternalObjectRef; readonly items: readonly ProviderPlanningItem[] }

interface SyncCounts {
  entities: number
  workItems: number
  changeRequests: number
  unanchored: number
}

export async function bootstrapWorkspace(context: CoreContext): Promise<BootstrapResult> {
  let markerFailure = false, settling = false
  let captured = context.runtimeAccess.epoch
  const binding = singlePlanningBinding(context.runtimeAccess.probeRegistry)
  const gate = gateCommand(context.runtimeAccess.probeRegistry, CapabilityKey.PlanningItemRead, 'read')
  const planning = binding?.planning
  if (binding === undefined || planning === undefined || !gate.allowed) {
    const error = gate.error ?? projectError(ProjectErrorCode.NotSupported, '没有可用的 Planning 绑定')
    return fail(context, binding?.ref.bindingId, error)
  }
  const bindingId = binding.ref.bindingId
  let round: PlanningSyncRoundRecord | undefined
  let ownedRound: number | undefined
  try {
    const begun = await beginSyncRound(context, bindingId, (previous, markerPhase, epoch) => { markerFailure = markerPhase; round = previous; captured = epoch })
    round = begun.round; captured = begun.epoch; ownedRound = round.latestStartedRound
    context.runtimeAccess.beginPlanning(ownedRound)
    if (context.planningReadBaseline === Number.POSITIVE_INFINITY) context.planningReadBaseline = round.latestStartedRound - 1
    const result = await syncRound(context, bindingId, planning, round, captured)
    settling = true
    return result.ok ? result.value : await fail(context, bindingId, toProjectError(result.error), round, captured)
  } catch (error) {
    if (settling) throw error
    if (!markerFailure) reportSyncRoundFailure(context, error)
    const failed = await fail(context, bindingId, projectError(error instanceof IdentityConflictError ? ProjectErrorCode.Conflict : ProjectErrorCode.Unavailable, SYNC_ROUND_FAILED), round, captured)
    if (markerFailure) reportSyncRoundFailure(context, error)
    return failed
  } finally {
    if (ownedRound !== undefined) context.runtimeAccess.endPlanning(ownedRound)
  }
}

/** 一轮同步：读观察、读项目、分页读全部条目、在一个 Storage 事务里提交；provider 的结构化失败原样交回，异常由调用方整轮接住。 */
async function syncRound(
  context: CoreContext, bindingId: ProviderBindingId, planning: PlanningProvider, round: PlanningSyncRoundRecord, captured: number,
): Promise<ProviderResult<BootstrapResult>> {
  const observations = await collectObservations(planning)
  const project = await readProject(context, planning, observations)
  if (!project.ok) return providerErr(project.error)
  const items = await readAllItems(planning, project.value.ref)
  if (!items.ok) return providerErr(items.error)
  const validated = validatePlanningItems(bindingId, project.value.ref, items.value)
  if (!validated.ok) return validated
  let verified: ResolvedBinding | undefined
  if (context.runtimeAccess.denied || round.latestStartedRound > (round.latestCommittedRound ?? 0) + 1 || (await context.runtimeAccess.planning(context.storage)).masked) {
    const probe = await collectBindings({ workspaceId: context.workspaceId, providers: { planning }, policy: context.policy })
    verified = probe.bindings[0]
    if (verified?.ref.bindingId !== bindingId || !gateCommand(providerRegistry(probe.bindings), CapabilityKey.PlanningItemRead, 'read').allowed) {
      return providerErr(providerError(ProviderErrorCode.Unavailable, 'Planning 挂载尚未重新确认'))
    }
  }
  return providerOk(await commitSync(context, bindingId, validated.value, observations, round, captured, project.value, verified))
}

async function beginSyncRound(context: CoreContext, bindingId: ProviderBindingId, markFailure: (previous: PlanningSyncRoundRecord, markerPhase: boolean, epoch: number) => void): Promise<{ round: PlanningSyncRoundRecord; epoch: number }> {
  let previousRound: PlanningSyncRoundRecord = {
    workspaceId: context.workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE, latestStartedRound: 0, latestCommittedRound: undefined,
  }
  let markerPhase = false, epoch = context.runtimeAccess.epoch
  return context.storage.transaction(async (tx) => {
    const access = await context.runtimeAccess.planning(tx), previous = access.round
    epoch = context.runtimeAccess.epoch
    const round: PlanningSyncRoundRecord = {
      workspaceId: context.workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE,
      latestStartedRound: (previous?.latestStartedRound ?? 0) + 1,
      latestCommittedRound: previous?.latestCommittedRound,
    }
    previousRound = { ...round, latestStartedRound: round.latestStartedRound - 1 }
    markerPhase = true
    await tx.putSyncCursor({
      workspaceId: context.workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: access.masked ? SyncState.Failed : access.state,
      state: SyncState.Syncing, lastErrorCode: access.cursor?.lastErrorCode,
    })
    await tx.putPlanningSyncRound(round)
    return { round, epoch }
  }).catch((error) => { markFailure(previousRound, markerPhase, epoch); throw error })
}

/** 项目范围优先用注入值；否则从观察主体反查条目取回 project，不猜外部 id。 */
async function readProject(
  context: CoreContext, planning: PlanningProvider, observations: readonly ProviderObservation[],
): Promise<ProviderResult<ProviderProject>> {
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
  return result
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

/**
 * 完整读取的所有条目必须属于同一个已确认的 project。尤其是没有内容身份的
 * `project_item`（redacted）不能借旧 membership 找回实体后再参与本轮写入；否则
 * scope replace 会删掉当前 project 的 membership，却留下旧 projection。先做整批校验，
 * 再进入任何 membership/projection 写入路径。
 */
function validatePlanningItems(
  bindingId: ProviderBindingId, project: ExternalObjectRef, items: readonly ProviderPlanningItem[],
): ProviderResult<ValidatedPlanningRead> {
  if (project.bindingId !== bindingId) return providerErr(providerError(ProviderErrorCode.InvalidInput, '规划项目不属于当前 Planning 绑定'))
  for (const item of items) {
    const c = item.content
    if (c.kind !== ContentKind.Redacted) {
      const visible = c.kind === ContentKind.WorkItem ? c.workItem : c.changeRequest
      try {
        if (visible.sourceNumber !== undefined) {
          const number = sourceNumberSnapshot(visible.sourceNumber)
          if (c.kind === ContentKind.ChangeRequest && number.number !== c.changeRequest.number) throw new TypeError()
        }
      } catch { return providerErr(providerError(ProviderErrorCode.InvalidInput, '原生编号不合契约')) }
    }
    if (!validNativeIdentity(item.nativeIdentity) || (item.nativeIdentity !== undefined
      && (item.ref.objectKind !== 'change_request' || item.content.kind !== ContentKind.ChangeRequest))) {
      return providerErr(providerError(ProviderErrorCode.InvalidInput, '原生 PR 身份声明不合法'))
    }
    if (item.ref.bindingId !== bindingId || item.project.bindingId !== project.bindingId
      || item.project.objectKind !== project.objectKind
      || item.project.externalId !== project.externalId) {
      return providerErr(providerError(ProviderErrorCode.InvalidInput, '规划条目所属项目与本轮确认项目不一致，本次读取不完整'))
    }
  }
  return providerOk({ project, items })
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
  read: ValidatedPlanningRead, observations: readonly ProviderObservation[], round: PlanningSyncRoundRecord, captured: number, project: ProviderProject, verified?: ResolvedBinding,
): Promise<BootstrapResult> {
  const { workspaceId } = context
  return context.runtimeAccess.local(async () => {
    const committed = await context.storage.transaction(async (tx) => {
      const latest = await tx.getPlanningSyncRound(workspaceId, bindingId, PLANNING_SYNC_SCOPE)
      if (context.runtimeAccess.epoch !== captured || latest?.latestStartedRound !== round.latestStartedRound) {
        return { stale: true as const, revision: await tx.currentRevision(workspaceId) }
      }
      const before = await tx.listPlanningProjections(workspaceId)
      let revision = await tx.currentRevision(workspaceId)
      const synced = await upsertItems(tx, context, read.items)
      await recordObservations(tx, observations)
      await tx.replacePlanningMemberships({ workspaceId, projectExternalId: read.project.externalId }, synced.memberships)
      // 先按原行修订号（新行用当前修订号）写一遍，再把事务前后的读回比较：内容变化才推进，并把本轮写入的行整批重盖（ADR-0012 第 1、2 条）。
      const scope = { workspaceId, bindingId }
      const kept = new Map(before.map((row) => [row.entityId, row.revision]))
      await tx.replacePlanningProjections(scope, synced.projections.map((row) => ({ ...row, revision: kept.get(row.entityId) ?? revision })))
      if (!sameProjections(before, await tx.listPlanningProjections(workspaceId))) {
        revision = await tx.advanceRevision(workspaceId)
        await tx.replacePlanningProjections(scope, synced.projections.map((row) => ({ ...row, revision })))
      }
      // 提交成功即 healthy；有缺口只带错误码，不写 degraded（degraded / failed 留给什么都没提交的读取，D23）。
      const incomplete = synced.counts.unanchored > 0
      await tx.putSyncCursor({
        workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined,
        state: SyncState.Healthy, lastErrorCode: incomplete ? ProjectErrorCode.PermissionDenied : undefined,
      })
      // 对账时刻（ADR-0003 第 3 条）只在提交成功时记：内容不变的刷新在 Storage 里只留这一笔新鲜度。
      await tx.putReconcileCursor({ workspaceId, lastReconciledAt: context.clock() })
      await tx.putPlanningSyncRound({ ...round, latestCommittedRound: round.latestStartedRound })
      if (context.runtimeAccess.epoch !== captured) throw new Error('Planning access changed during publication')
      return { stale: false as const, revision, counts: synced.counts }
    })
    if (committed.stale) {
      return {
        ok: false, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0,
        revision: committed.revision, degraded: true,
        error: projectError(ProjectErrorCode.StaleRevision, '本轮 Planning 快照已被更新的同步轮次取代'),
      }
    }
    context.projectRef = project.ref
    context.projectTitle = project.title
    context.runtimeAccess.recover(captured, verified)
    const { unanchored } = committed.counts
    return {
      ok: true, entities: committed.counts.entities, workItems: committed.counts.workItems,
      changeRequests: committed.counts.changeRequests, unanchored, revision: committed.revision, degraded: unanchored > 0,
      error: unanchored > 0 ? projectError(ProjectErrorCode.PermissionDenied, `${unanchored} 个条目对当前凭据不可见，按成员关系也找不回本地实体`) : undefined,
    }
  })
}

/** 已提交内容是否相同：两侧都是同一 Storage 的读回，去掉行修订号、按实体排序后深比较（不依赖键序）。 */
function sameProjections(left: readonly WorkspaceProjection[], right: readonly WorkspaceProjection[]): boolean {
  const content = (rows: readonly WorkspaceProjection[]) => rows.map(({ revision: _revision, ...row }) => row)
    .sort((a, b) => (a.entityId < b.entityId ? -1 : 1))
  return isDeepStrictEqual(content(left), content(right))
}

/** 一个条目一个成员：先解析稳定内部实体，再把权威字段（经工作区映射归一的状态与展示事实）与三态内容写成工作区投影。 */
async function upsertItems(
  tx: StorageTransaction, context: CoreContext,
  items: readonly ProviderPlanningItem[],
): Promise<SyncedItems> {
  const counts: SyncCounts = { entities: 0, workItems: 0, changeRequests: 0, unanchored: 0 }
  const projections: UnstampedProjection[] = []
  const memberships: MembershipRecord[] = []
  for (const item of items) {
    const contentKind = planningContentKind(item.ref.objectKind)
    if (contentKind !== undefined) {
      memberships.push({
        workspaceId: context.workspaceId, projectExternalId: item.project.externalId, itemExternalId: item.membership.externalId,
        contentKind, contentExternalId: item.ref.externalId,
        membershipCreatedAt: item.membership.createdAt, membershipUpdatedAt: item.membership.updatedAt,
      })
    } else {
      const known = await tx.getMembership(context.workspaceId, item.membership.externalId)
      if (known !== undefined && known.projectExternalId === item.project.externalId) memberships.push(known)
    }
    const anchor = await anchorOf(tx, context, item)
    if (anchor === undefined) {
      counts.unanchored += 1
      continue
    }
    projections.push(toProjection(context.workspaceId, anchor.entityId, item, context.planningFieldMapping))
    counts.entities += 1
    if (anchor.kind === EntityKind.ChangeRequest) counts.changeRequests += 1
    else counts.workItems += 1
  }
  return { counts, projections, memberships }
}

/**
 * 条目的本地锚点。有内容身份：用旧 membership 识别 Draft→Issue，再解析实体、登记本轮 membership。没有内容身份（project_item）：
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
  const known = await tx.getMembership(workspaceId, item.membership.externalId)
  let promotedId: EntityId | undefined
  if (known?.projectExternalId === item.project.externalId && known.contentKind === MembershipContentKind.Draft
    && contentKind === MembershipContentKind.Issue && (item.content.kind === ContentKind.WorkItem || item.content.kind === ContentKind.Redacted)) {
    const draft = await tx.findExternalIdentity(item.project.bindingId, MembershipContentKind.Draft, known.contentExternalId)
    if (draft?.role === IdentityRole.Primary) {
      const primaries = (await tx.listIdentitiesForEntity(draft.entityId)).filter(identity => identity.role === IdentityRole.Primary)
      if (primaries.length === 1 && primaries[0]?.id === draft.id) {
        const promotion = await promoteEntityIdentity(tx, draft.entityId, item.ref.externalId)
        if (!promotion.ok) throw new IdentityConflictError('Draft 提升目标身份已被占用')
        promotedId = promotion.entityId
      }
    }
  }
  const external = { bindingId: item.ref.bindingId, externalKind: contentKind, externalId: item.ref.externalId }
  const kind = entityKindFor(item.content.kind, contentKind)
  const entityId = promotedId ?? await ensureEntity(tx, external, kind, context.ids, kind === EntityKind.ChangeRequest ? changeRequestEntityId(item.ref, item.nativeIdentity) : undefined, item.nativeIdentity !== undefined)
  await tx.putMembership({
    workspaceId, projectExternalId: item.project.externalId, itemExternalId: item.membership.externalId, contentKind,
    contentExternalId: item.ref.externalId, membershipCreatedAt: item.membership.createdAt, membershipUpdatedAt: item.membership.updatedAt,
  })
  return { entityId, kind }
}

function toProjection(
  workspaceId: WorkspaceId, entityId: EntityId, item: ProviderPlanningItem,
  mapping: WorkspacePlanningFieldMapping | undefined,
): UnstampedProjection {
  return { workspaceId, entityId, content: toContent(item.content), ...planningFieldsOf(item, mapping) }
}

/** provider 内容三态 → 领域三态；redacted 是一等状态，不回退到缓存或推断值。 */
function toContent(content: ProviderPlanningContent): PlanningContent {
  if (content.kind === ContentKind.WorkItem) {
    return { contentKind: ContentKind.WorkItem, title: content.workItem.title, body: content.workItem.body, ...(content.workItem.sourceNumber === undefined ? {} : { sourceNumber: sourceNumberSnapshot(content.workItem.sourceNumber) }) }
  }
  if (content.kind === ContentKind.ChangeRequest) {
    const cr = content.changeRequest
    return { contentKind: ContentKind.ChangeRequest, number: cr.number, title: cr.title, body: cr.body, ...(cr.sourceNumber === undefined ? {} : { sourceNumber: sourceNumberSnapshot(cr.sourceNumber) }) }
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

async function fail(
  context: CoreContext, bindingId: ProviderBindingId | undefined, error: ProjectError, round?: PlanningSyncRoundRecord, captured = context.runtimeAccess.epoch,
): Promise<BootstrapResult> {
  const denied = error.code === ProjectErrorCode.PermissionDenied && context.runtimeAccess.deny(captured, round?.latestStartedRound)
  if (error.code === ProjectErrorCode.PermissionDenied) error = projectError(ProjectErrorCode.PermissionDenied, PLANNING_DENIED)
  if (bindingId !== undefined) {
    await context.runtimeAccess.local(() => context.storage.transaction(async (tx) => {
      if (!denied && context.runtimeAccess.epoch !== captured) return
      if (round !== undefined) {
        const latest = await tx.getPlanningSyncRound(context.workspaceId, bindingId, PLANNING_SYNC_SCOPE)
        if (denied ? (latest?.latestCommittedRound ?? 0) > round.latestStartedRound : (latest?.latestStartedRound ?? 0) !== round.latestStartedRound) return
      }
      const access = await context.runtimeAccess.planning(tx)
      if (access.masked && !context.runtimeAccess.denied) return
      if (context.runtimeAccess.denied) {
        const before = await tx.listPlanningProjections(context.workspaceId), redacted = before.map(redactPlanning)
        if (!sameProjections(before, redacted)) {
          const revision = await tx.advanceRevision(context.workspaceId)
          await tx.replacePlanningProjections({ workspaceId: context.workspaceId, bindingId }, redacted.map((row) => ({ ...row, revision })))
        }
      }
      await tx.putSyncCursor({
        workspaceId: context.workspaceId, bindingId, scopeKey: PLANNING_SYNC_SCOPE, cursorValue: undefined,
        state: SyncState.Degraded, lastErrorCode: context.runtimeAccess.denied || access.error?.code === ProjectErrorCode.PermissionDenied ? ProjectErrorCode.PermissionDenied : error.code,
      })
    }))
  }
  return {
    ok: false, entities: 0, workItems: 0, changeRequests: 0, unanchored: 0, degraded: true, error,
    revision: await context.storage.currentRevision(context.workspaceId),
  }
}

function toProjectError(error: ProviderError): ProjectError {
  return projectError(projectCodeForProviderError(error.code), error.message)
}
