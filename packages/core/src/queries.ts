/**
 * 查询 API：绑定列表、规划条目列表与详情（issue #76 / ExecPlan D5）。只读本地权威快照与缓存，不隐式
 * 触发外部写入。provider 最近一次同步失败（游标 degraded / failed）或规划读取能力不可用时，返回的是带
 * `degraded` 标记的最后已知投影，而不是抛错。
 */
import {
  CapabilityKey,
  SyncState,
  singlePlanningBinding,
  type ProviderBindingRecord,
} from '@harness-projects/capabilities'
import { IdentityRole, type EntityId, type ExternalIdentity } from '@harness-projects/domain'
import { gateCommand } from './capabilities.ts'
import { PLANNING_SYNC_SCOPE } from './bootstrap.ts'
import type { CoreContext } from './context.ts'
import {
  toPlanningItemView,
  type PlanningItemDetail,
  type PlanningItemView,
  type SyncSummary,
} from './projection.ts'

export interface CoreQueries {
  listProviderBindings(): Promise<readonly ProviderBindingRecord[]>
  listPlanningItems(): Promise<readonly PlanningItemView[]>
  getItemDetail(entityId: EntityId): Promise<PlanningItemDetail | undefined>
}

export function createQueries(context: CoreContext): CoreQueries {
  return {
    listProviderBindings: () => context.storage.listProviderBindings(context.workspaceId),

    async listPlanningItems(): Promise<readonly PlanningItemView[]> {
      const sync = await syncSummary(context)
      const projections = await context.storage.listPlanningProjections(context.workspaceId)
      const views: PlanningItemView[] = []
      for (const projection of projections) {
        const identity = await primaryIdentity(context, projection.entityId)
        if (identity !== undefined) views.push(toPlanningItemView(projection, identity, sync))
      }
      return views.sort((left, right) => (left.entityId < right.entityId ? -1 : 1))
    },

    async getItemDetail(entityId: EntityId): Promise<PlanningItemDetail | undefined> {
      const projection = await context.storage.getPlanningProjection(context.workspaceId, entityId)
      if (projection === undefined) return undefined
      const identities = await context.storage.listIdentitiesForEntity(entityId)
      const primary = identities.find((identity) => identity.role === IdentityRole.Primary)
      if (primary === undefined) return undefined
      const sync = await syncSummary(context)
      return { ...toPlanningItemView(projection, primary, sync), identities }
    },
  }
}

/** freshness 的唯一来源：能力门 + 最近一次同步游标状态；不靠猜测 provider 是否可达。 */
async function syncSummary(context: CoreContext): Promise<SyncSummary> {
  const gate = gateCommand(context.registry, CapabilityKey.PlanningItemRead, 'read')
  if (!gate.allowed) return { degraded: true, reason: gate.error?.message ?? '规划读取能力不可用' }
  const binding = singlePlanningBinding(context.registry)
  if (binding === undefined) return { degraded: true, reason: '没有默认 Planning 绑定' }
  const cursor = await context.storage.getSyncCursor(binding.ref.bindingId, PLANNING_SYNC_SCOPE)
  if (cursor === undefined) return { degraded: false, reason: undefined }
  const broken = cursor.state === SyncState.Degraded || cursor.state === SyncState.Failed
  return { degraded: broken, reason: broken ? cursor.lastErrorCode ?? cursor.state : undefined }
}

async function primaryIdentity(context: CoreContext, entityId: EntityId): Promise<ExternalIdentity | undefined> {
  const identities = await context.storage.listIdentitiesForEntity(entityId)
  return identities.find((identity) => identity.role === IdentityRole.Primary)
}
