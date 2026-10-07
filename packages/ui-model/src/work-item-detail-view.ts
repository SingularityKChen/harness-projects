/** 唯一安全投影（issue #130）：scope → 既有列表门 → 安全行 → 白名单 content；次序固定、阻断态不借缓存、纯函数。 */
import { ContentKind } from '@harness-projects/domain/values'
import { deriveWorkItemDetail } from './derive.ts'
import { deriveWorkItemListView, type VisibleListRow, type WorkItemListReadInput } from './work-item-list-view.ts'

export type WorkItemDetailTarget = { readonly projectId: string; readonly itemId: string }

/** 安全详情的精确字段面；`identity` / `derived` / `lastUpdatedAt` 可省略，其余恒有。 */
export type WorkItemDetailContent = {
  readonly kind: 'content'
  readonly title: string
  readonly body: string
  readonly planningStatus: string
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
      kind: 'content', title: row.title, body: detail.planning.body || '正文未提供',
      planningStatus: row.planningStatus, source: row.source, authority: row.authority,
      ...(identity === undefined ? {} : { identity }),
      ...(derived === undefined ? {} : { derived }),
      stale: row.stale, refreshing: view.body.refreshing,
      ...(view.body.lastUpdatedAt === undefined ? {} : { lastUpdatedAt: view.body.lastUpdatedAt }),
    },
  }
}
