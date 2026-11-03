/**
 * 只读工作项列表页面（issue #129）：消费 ui-model 已经算好的安全 view，不读 store / 时钟 / capability，也不推导读取
 * 过程。页面是一处标题、一处稳定的 role=status 区和一个 table；没有行按钮或连接入口；只在传入 navigation 时，安全 item 行的标题是打开详情的链接（ADR-0010），redacted 行没有。
 * `headingTabIndex` 只在组合页传入（-1）：让关闭详情后的回焦能落到列表标题，独立列表页不改变既有输出。
 * 本文件用 `createElement` 而不是 JSX（tsconfig 不启用 jsx）。
 */
import { Fragment, createElement, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { defaultLocalTableConditions, queryVisibleWorkItems, type LocalTableConditions, type LocalTableResult, type LocalTableSort, type VisibleListRow, type WorkItemListView } from '@harness-projects/ui-model'
import { EmptyState, FreshnessBadge, LoadingState, LIST_STYLES, SourceBadge, StaleBanner, UnavailableState } from './list-states.ts'

import { ColumnResizeHandle, useColumnWidths } from './column-resize.ts'
import { TableControls } from './table-controls.ts'
import { TABLE_COLUMNS } from './table-columns.ts'

const columnWidth = (column: typeof TABLE_COLUMNS[number]): string => column.id === 'title' ? 'var(--hp-title-width)' : `var(--hp-column-${column.id},${column.defaultWidth}px)`
type Column = typeof TABLE_COLUMNS[number]
const sortable = (id: string): id is LocalTableSort['column'] => ['title','planningStatus','iteration','targetDate'].includes(id)
type WidthControls = ReturnType<typeof useColumnWidths>
type QueryControls = { result: LocalTableResult; onChange(conditions: LocalTableConditions): void }

/** 列表页消费的导航契约（ui 无状态回调）：`href` 供真实 href 与修饰键点击，`open` 只在普通左键点击时调用。 */
export type ItemNavigation = { readonly href: (itemId: string) => string; readonly open: (itemId: string) => void }

/** 标题 anchor 只给安全 item 行：修饰键 / 中键保留真实 href 交给浏览器，普通左键才走 `open`。 */
function TitleLink({ itemId, title, navigation }: { itemId: string; title: string; navigation: ItemNavigation }): ReactElement {
  const onClick = (event: { preventDefault: () => void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void => {
    if (event.button !== undefined && event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigation.open(itemId)
  }
  return createElement('a', { href: navigation.href(itemId), onClick }, title)
}

/** redacted 行只显示占位：其它单元格是"—"，不透出是否撤权或删除；行 key 只给框架，不进任何属性。 */
function ItemRow({ row, navigation, columns }: { row: VisibleListRow; navigation: ItemNavigation | undefined; columns: readonly Column[] }): ReactElement {
  const values = row.kind === 'item' ? { title:row.title, identity:row.identity, planningStatus:row.planningStatus, iteration:row.iteration, targetDate:row.targetDate, engineering:row.engineering,
    source:createElement(SourceBadge, { name:row.source, authority:row.authority }), freshness:createElement(FreshnessBadge, { stale:row.stale }) } : undefined
  const title = row.kind === 'redacted' ? '内容不可见' : row.title
  return createElement('tr', null,
    createElement('th', { scope: 'row', className: 'hp-list-wrap' },
      row.kind === 'item' && navigation !== undefined ? createElement(TitleLink, { itemId: row.key, title, navigation }) : row.kind === 'item' ? createElement('details', null, createElement('summary', { className: 'hp-list-title-text' }, title)) : title),
    ...columns.slice(1).map(column => createElement('td', { key:column.id, className:column.id === 'iteration' || column.id === 'source' ? 'hp-list-wrap' : undefined }, values?.[column.id] ?? '—')))
}

/** 可聚焦的局部滚动容器，焦点轮廓使用公开 Host token，窄屏保留八列。 */
function ItemTable({ rows, navigation, query, sizes }: { rows: readonly VisibleListRow[]; navigation: ItemNavigation | undefined; query: QueryControls; sizes: WidthControls }): ReactElement {
  const { conditions } = query.result, columns = TABLE_COLUMNS.filter(column => conditions.visibleColumns.includes(column.id))
  const sort = (column: LocalTableSort['column']): void => query.onChange({ ...conditions, sort:conditions.sort?.column !== column ? {column,direction:'asc'} : conditions.sort.direction === 'asc' ? {column,direction:'desc'} : null })
  return createElement('div', { role: 'region', 'aria-label': '工作项表格，可横向和纵向滚动', tabIndex: 0, className: 'hp-list-scroll', style:Object.fromEntries(Object.entries(sizes.widths).map(([id,value])=>[`--hp-column-${id}`,`${value}px`])) as CSSProperties },
    createElement('table', { style: { width: `calc(${columns.map(columnWidth).join(' + ')})` } },
      createElement('colgroup', null, ...columns.map(column => createElement('col', { key: column.id, style: { width: columnWidth(column) } }))),
      createElement('caption', null, '工作项列表'),
      createElement('thead', null, createElement('tr', null, ...columns.map(column => createElement('th', { key:column.id, scope:'col', 'aria-sort':conditions.sort?.column === column.id ? conditions.sort.direction === 'asc' ? 'ascending' : 'descending' : undefined }, createElement('span', { className:'hp-column-label' }, sortable(column.id) ? createElement('button', { type:'button', className:'hp-column-sort', 'aria-label':`按${column.label}排序`, onClick:(event: {stopPropagation():void}) => { event.stopPropagation(); if (sortable(column.id)) sort(column.id) } }, column.label) : column.label), createElement(ColumnResizeHandle, {key:sizes.interactionKey,column,width:sizes.widths[column.id]??column.defaultWidth,onChange:value=>sizes.setWidth(column,value)}))))),
      createElement('tbody', null, ...rows.map((row) => createElement(ItemRow, { key: row.key, row, navigation, columns })))))
}

function bodyOf({ body, planningSourceName }: WorkItemListView, query: QueryControls, sizes: WidthControls, navigation?: ItemNavigation): ReactElement {
  if (body.kind === 'loading') return createElement(LoadingState)
  if (body.kind === 'unavailable') return createElement(UnavailableState, { message: body.message, remaining: body.remaining })
  const notConfirmed = (body.stale && !body.partial) || body.refreshing // 部分读取的可见行都已确认：不出「最后已知值」横幅
  return createElement(Fragment, null,
    notConfirmed ? createElement(StaleBanner, { source: planningSourceName, at: body.lastUpdatedAt ?? null }) : null,
    body.notice === undefined ? null : createElement('p', null, body.notice),
    body.rows.length === 0 ? createElement(EmptyState, { confirmed: !notConfirmed }) : createElement(ItemTable, { rows: query.result.rows, navigation, query, sizes }))
}

export function WorkItemListPage({ view, navigation, headingTabIndex, statusAnnouncement, presentationScopeKey }: { presentationScopeKey?: string | undefined; view: WorkItemListView; navigation?: ItemNavigation | undefined; headingTabIndex?: number | undefined; statusAnnouncement?: string | undefined }): ReactElement {
  const sizes=useColumnWidths(presentationScopeKey)
  const { body } = view
  const [local, setLocal] = useState({ scopeKey:presentationScopeKey, conditions:defaultLocalTableConditions(), adjusted:false })
  const sameScope = local.scopeKey === presentationScopeKey
  const computed = queryVisibleWorkItems(body.kind === 'content' ? body.rows : [], sameScope ? local.conditions : defaultLocalTableConditions())
  if (!sameScope) setLocal({ scopeKey:presentationScopeKey, conditions:defaultLocalTableConditions(), adjusted:false })
  else if (computed.conditionsAdjusted) setLocal({ scopeKey:presentationScopeKey, conditions:computed.conditions, adjusted:true })
  const query: QueryControls = { result:{...computed,conditionsAdjusted:computed.conditionsAdjusted || (sameScope && local.adjusted)},
    onChange:conditions => setLocal({scopeKey:presentationScopeKey,conditions,adjusted:false}) }
  const busy = body.kind === 'loading' || (body.kind === 'content' && body.refreshing)
  // 新鲜度只在已确认的内容旁声明（部分读取的可见内容也已确认）；未确认时由状态区宣告、横幅点名来源与时刻，页首不再重复。
  const confirmed = body.kind === 'content' && (!body.stale || body.partial === true) && !body.refreshing
  return createElement('section', { 'aria-label': '工作项列表', className: 'hp-work-items' },
    createElement('style', null, LIST_STYLES),
    createElement('div', { className: 'hp-list-context', role: 'region', 'aria-label': '工作项上下文', tabIndex: 0 },
    createElement('h2', { tabIndex: headingTabIndex }, view.workspaceName),
    body.kind === 'content' && body.rows.length > 0 ? createElement('div',{className:'hp-column-tools'},createElement('button',{type:'button',onClick:sizes.reset},'重置列宽'),createElement('span',null,'拖动列边界，或聚焦边界后用方向键调整。')):null,
    createElement('p', { className: 'hp-list-meta' }, '规划来源：', createElement(SourceBadge, { name: view.planningSourceName }),
      ...(view.mappingSourceText === undefined ? [] : ['；', view.mappingSourceText]),
      ...(confirmed ? ['；', createElement(FreshnessBadge, { stale: false, at: body.lastUpdatedAt ?? null })] : [])),
    body.kind === 'content' ? createElement('p', { className: 'hp-list-meta' }, '规划来源最后确认：', body.reconciledAt === undefined ? '未知' : createElement('time', { dateTime: body.reconciledAt }, body.reconciledAt)) : null,
    view.readOnly ? createElement('p', null, '只读：规划来源仅允许读取，此处展示规划内容。') : null,
    view.degraded ? createElement('p', null, '读取能力降级：显示的是保守的最后已知值。') : null,
    createElement('div', { role: 'status', 'aria-live': statusAnnouncement === undefined ? 'polite' : 'off', 'aria-atomic': 'true' }, view.statusText),
    statusAnnouncement === undefined ? null : createElement('span', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' } }, statusAnnouncement),
    body.kind === 'content' ? createElement(TableControls, query) : null),
    createElement('div', { 'aria-busy': busy, className: 'hp-list-body' }, bodyOf(view, query, sizes, navigation)))
}
