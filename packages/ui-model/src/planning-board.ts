/** 只读看板只消费查询后的安全行；规范状态来自 Host，不由显示名或工程提示推断。 */
import { NormalizedStatus } from '@harness-projects/domain/values'
import type { VisibleListRow } from './work-item-list-view.ts'

type BoardItem = Extract<VisibleListRow, { kind: 'item' }>
export type PlanningBoardGroup = { readonly status: NormalizedStatus; readonly label: string; readonly items: readonly BoardItem[] }
const GROUPS = [
  [NormalizedStatus.Todo, '待办'], [NormalizedStatus.InProgress, '进行中'], [NormalizedStatus.Blocked, '已阻塞'],
  [NormalizedStatus.Done, '已完成'], [NormalizedStatus.Canceled, '已取消'], [NormalizedStatus.Unknown, '未知'],
] as const

export function derivePlanningBoard(rows: readonly VisibleListRow[]): readonly PlanningBoardGroup[] {
  return GROUPS.flatMap(([status, label]) => {
    const items = rows.filter((row): row is BoardItem => row.kind === 'item' && row.planningStatusKey === status)
    return items.length ? [{ status, label, items }] : []
  })
}
