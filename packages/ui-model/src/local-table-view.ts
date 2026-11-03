/** 局部查询仅消费安全展示行；条件不是规划事实，不访问 store / Provider。 */
import type { VisibleListRow } from './work-item-list-view.ts'

export type LocalTableColumnId = 'title' | 'identity' | 'planningStatus' | 'iteration' | 'targetDate' | 'engineering' | 'source' | 'freshness'
export type LocalTableSort = { readonly column: 'title' | 'planningStatus' | 'iteration' | 'targetDate'; readonly direction: 'asc' | 'desc' }
export type LocalTableConditions = {
  readonly search: string
  readonly planningStatus: string | null
  readonly iteration: string | null
  readonly sort: LocalTableSort | null
  readonly visibleColumns: readonly LocalTableColumnId[]
}
export type LocalTableResult = {
  readonly rows: readonly VisibleListRow[]
  readonly conditions: LocalTableConditions
  readonly facets: { readonly planningStatus: readonly string[]; readonly iteration: readonly string[] }
  readonly loadedReadableCount: number
  readonly matchedReadableCount: number
  readonly hasQuery: boolean
  /** 当前输入中的 facet 已失效；公告不复述已撤权的 label/value。 */
  readonly conditionsAdjusted: boolean
}
const COLUMNS: readonly LocalTableColumnId[] = ['title','identity','planningStatus','iteration','targetDate','engineering','source','freshness']
const SORT_COLUMNS = ['title','planningStatus','iteration','targetDate']
export function defaultLocalTableConditions(): LocalTableConditions {
  return { search:'', planningStatus:null, iteration:null, sort:null, visibleColumns:['title','planningStatus','iteration','targetDate','engineering'] }
}
const folded = (value: string): string => value.normalize('NFC').toLowerCase()
const missing = (value: string): boolean => value === '' || value === '—'
function dateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,31,30,31,30,31,31,30,31,30,31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
}

/** 撤权后的 facet 与条件在同一次纯计算中归一，不依赖 effect 清理旧文字。 */
export function queryVisibleWorkItems(rows: readonly VisibleListRow[], input: Partial<LocalTableConditions> = {}): LocalTableResult {
  const items = rows.filter((row): row is Extract<VisibleListRow, { kind:'item' }> => row.kind === 'item')
  const facets = {
    planningStatus:[...new Set(items.map(row => row.planningStatus))],
    iteration:[...new Set(items.map(row => row.iteration))],
  }
  const planningStatus = typeof input.planningStatus === 'string' && facets.planningStatus.includes(input.planningStatus) ? input.planningStatus : null
  const iteration = typeof input.iteration === 'string' && facets.iteration.includes(input.iteration) ? input.iteration : null
  const sort = input.sort && SORT_COLUMNS.includes(input.sort.column) && ['asc','desc'].includes(input.sort.direction) ? input.sort : null
  const selected = input.visibleColumns ?? defaultLocalTableConditions().visibleColumns
  const conditions: LocalTableConditions = {
    search:typeof input.search === 'string' ? input.search : '', planningStatus, iteration, sort,
    visibleColumns:COLUMNS.filter(column => column === 'title' || selected.includes(column)),
  }
  const needle = folded(conditions.search.trim())
  const matches = items.filter(row => (!needle || folded(row.title).includes(needle))
    && (planningStatus === null || row.planningStatus === planningStatus) && (iteration === null || row.iteration === iteration))
  if (sort) matches.sort((left, right) => {
    const a = left[sort.column], b = right[sort.column]
    const am = missing(a) || (sort.column === 'targetDate' && !dateOnly(a))
    const bm = missing(b) || (sort.column === 'targetDate' && !dateOnly(b))
    if (am || bm) return am === bm ? 0 : am ? 1 : -1
    const af = folded(a), bf = folded(b), compared = af < bf ? -1 : af > bf ? 1 : 0
    return sort.direction === 'asc' ? compared : -compared
  }) // ES 稳定排序：同值保输入顺序；key 从不进入比较。
  return {
    rows:[...matches,...rows.filter(row => row.kind === 'redacted')], conditions, facets,
    loadedReadableCount:items.length, matchedReadableCount:matches.length,
    hasQuery:Boolean(needle || planningStatus !== null || iteration !== null),
    conditionsAdjusted:(input.planningStatus != null && planningStatus === null) || (input.iteration != null && iteration === null),
  }
}
