/** 唯一安全投影（issue #130）：scope → 既有列表门 → 安全行 → 白名单 content；次序固定、阻断态不借缓存、纯函数。 */
import { repositoryAccessIndex, startWorkAvailability } from './capability-access.ts'
import { ContentKind } from '@harness-projects/domain/values'
import { deriveWorkItemDetail } from './derive.ts'
import { deriveWorkItemListView, type VisibleListRow, type WorkItemListReadInput } from './work-item-list-view.ts'

export interface ExecutionTarget { readonly workspaceId: string; readonly workItemId: string; readonly repositoryIds: readonly string[] }

export interface StartWorkRepository { readonly id: string; readonly available: boolean; readonly access: string }

export type WorkItemDetailTarget = { readonly projectId: string; readonly itemId: string }

/** 安全详情的精确字段面；`identity` / `derived` / `lastUpdatedAt` 可省略，其余恒有。 */
export type WorkItemDetailContent = {
  readonly executionTarget?: ExecutionTarget
  readonly startWorkRepositories?: readonly StartWorkRepository[]
  readonly kind: 'content'
  readonly title: string
  readonly body: string
  readonly planningStatus: string
  /** 迭代标题与 date-only 目标日期：与 `planningStatus` 同一次列表安全行复制，缺值由列表层统一占位 `—`。 */
  readonly iteration: string
  readonly targetDate: string
  readonly source: string
  readonly authority: string
  readonly identity?: { readonly kind: string; readonly externalId: string }
  readonly derived?: string
  readonly stale: boolean
  readonly refreshing: boolean
  readonly lastUpdatedAt?: string
}

export type WorkItemDetailView = {
  readonly body:
    | { readonly kind: 'loading' }
    | { readonly kind: 'unavailable'; readonly message: string; readonly remaining: string }
    | { readonly kind: 'unresolved' }
    | { readonly kind: 'redacted' }
    | WorkItemDetailContent
}

/** 详情投影；可见行与详情之间目标消失（TD-024）时抛 `TypeError`，绝不用旧 view 回填。 */
export function deriveWorkItemDetailView(input: WorkItemListReadInput, target: WorkItemDetailTarget): WorkItemDetailView {
  if (input.read.workspace.id !== target.projectId) return { body: { kind: 'unresolved' } }
  const view = deriveWorkItemListView(input)
  if (view.body.kind === 'loading') return { body: { kind: 'loading' } }
  if (view.body.kind === 'unavailable') return { body: { kind: 'unavailable', message: view.body.message, remaining: view.body.remaining } }
  const row: VisibleListRow | undefined = view.body.rows.find((candidate) => candidate.key === target.itemId)
  if (row === undefined) return { body: { kind: 'unresolved' } }
  if (row.kind === 'redacted') return { body: { kind: 'redacted' } }
  const detail = deriveWorkItemDetail(input.read, target.itemId)
  if (detail === undefined) {
    throw new TypeError(`详情接线缺陷：安全列表里有 ${JSON.stringify(target.itemId)} 的安全行，但详情读取已取不到该条目`)
  }
  // 撕裂读（TD-024）：列表行可见而详情已遮蔽时，按详情自己的 contentKind 再判一次，绝不用列表行回填内容。
  if (detail.planning.contentKind === ContentKind.Redacted) return { body: { kind: 'redacted' } }
  const primary = detail.source.primary
  const identity = primary === undefined ? undefined : { kind: row.identity, externalId: primary.externalId }
  const derived = row.engineering === '无' ? undefined : `派生提示：${row.engineering}`
  return {
    body: {
      ...(detail.planning.contentKind === ContentKind.WorkItem ? {
        ...(input.read.repositories?.length ? { startWorkRepositories: input.read.repositories.map((repository) => {
          // Development 四门必须来自选中仓库的路由；缺少元数据时不能借工作区里另一个连接放行。
          const { available, access } = startWorkAvailability(repositoryAccessIndex([], repository.capabilities ?? []))
          return { id: repository.id, available, access }
        }) } : {}),
        executionTarget: { workspaceId: target.projectId, workItemId: target.itemId, repositoryIds: [...new Set(input.read.repositories?.map((repository) => repository.id) ?? [])].sort() },
      } : {}),
      kind: 'content', title: row.title, body: detail.planning.body || '正文未提供',
      planningStatus: row.planningStatus, iteration: row.iteration, targetDate: row.targetDate,
      source: row.source, authority: row.authority,
      ...(identity === undefined ? {} : { identity }),
      ...(derived === undefined ? {} : { derived }),
      stale: row.stale, refreshing: view.body.refreshing,
      ...(view.body.lastUpdatedAt === undefined ? {} : { lastUpdatedAt: view.body.lastUpdatedAt }),
    },
  }
}
