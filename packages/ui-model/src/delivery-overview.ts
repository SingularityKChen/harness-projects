import { ContentKind } from '@harness-projects/domain/values'
import type { ExecutionTarget } from './work-item-detail-view.ts'
import { deriveWorkItemListView, type WorkItemListReadInput } from './work-item-list-view.ts'
export type DeliveryOverviewTargets = { readonly kind: 'loading' | 'unavailable' } | {
  readonly kind: 'content'; readonly repositoryIds: readonly string[]
  readonly items: readonly { readonly key: string; readonly title: string; readonly numberLabel?: string; readonly target: ExecutionTarget; readonly accessTokens: Readonly<Record<string, string>> }[]
}
/** 一次列表安全门，再逐条核对当前实体类型；遮蔽 key 不进入 scope 或计数。 */
export function deriveDeliveryOverviewTargets(input: WorkItemListReadInput): DeliveryOverviewTargets {
  const { body } = deriveWorkItemListView(input)
  if (body.kind !== 'content') return { kind: body.kind }
  const repositories = input.read.repositories ?? []
  const repositoryIds = [...new Set(repositories.map(repository => repository.id))].sort()
  const accessTokens = Object.fromEntries(repositories.map(({ id, capabilities, accessVersion }) => [id, JSON.stringify([capabilities, accessVersion])]))
  const items = body.rows.flatMap(row => {
    if (row.kind !== 'item') return []
    const entry = input.read.store.get(row.key)
    // 保持详情的 TD-024 门：条目消失响亮失败，晚到遮蔽或类型变化绝不借安全行回填。
    if (entry === undefined) throw new TypeError(`详情接线缺陷：安全列表里有 ${JSON.stringify(row.key)} 的安全行，但详情读取已取不到该条目`)
    if (entry.entity.content.contentKind !== ContentKind.WorkItem || entry.entity.content.externalKind === 'draft') return []
    return [{ key: row.key, title: row.title, ...(row.numberLabel === undefined ? {} : { numberLabel: row.numberLabel }), target: { workspaceId: input.read.workspace.id, workItemId: row.key, repositoryIds }, accessTokens }]
  })
  return { kind: 'content', items, repositoryIds }
}
