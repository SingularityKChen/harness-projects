import { deriveWorkItemDetailView, type ExecutionTarget } from './work-item-detail-view.ts'
import { deriveWorkItemListView, type WorkItemListReadInput } from './work-item-list-view.ts'
export type DeliveryOverviewTargets = { readonly kind: 'loading' | 'unavailable' } | {
  readonly kind: 'content'; readonly repositoryIds: readonly string[]
  readonly items: readonly { readonly key: string; readonly title: string; readonly numberLabel?: string; readonly target: ExecutionTarget; readonly accessTokens: Readonly<Record<string, string>> }[]
}
/** 只从列表/详情双重安全门复制白名单；遮蔽 key 不进入 scope 或计数。 */
export function deriveDeliveryOverviewTargets(input: WorkItemListReadInput): DeliveryOverviewTargets {
  const { body } = deriveWorkItemListView(input)
  if (body.kind !== 'content') return { kind: body.kind }
  const items = body.rows.flatMap(row => {
    if (row.kind !== 'item') return []
    const { body: detail } = deriveWorkItemDetailView(input, { projectId: input.read.workspace.id, itemId: row.key })
    if (detail.kind !== 'content' || detail.executionTarget === undefined) return []
    if (input.read.store.get(row.key)?.entity.content.externalKind === 'draft') return []
    return [{ key: row.key, title: detail.title, ...(detail.numberLabel === undefined ? {} : { numberLabel: detail.numberLabel }), target: detail.executionTarget, accessTokens: detail.deliveryAccessTokens ?? {} }]
  })
  return { kind: 'content', items, repositoryIds: [...new Set(input.read.repositories?.map(repository => repository.id) ?? [])].sort() }
}
