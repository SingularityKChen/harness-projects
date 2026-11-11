/**
 * 只读工作项列表页面（issue #129）：消费 ui-model 已经算好的安全 view，不读 store / 时钟 / capability，也不推导读取
 * 过程。页面是一处标题、一处稳定的 role=status 区和一个 table；没有行按钮或连接入口；只在传入 navigation 时，安全 item 行的标题是打开详情的链接（ADR-0010），redacted 行没有。
 * `headingTabIndex` 只在组合页传入（-1）：让关闭详情后的回焦能落到列表标题，独立列表页不改变既有输出。
 * 组合页可替换只读 body 与标题/region 标签；context/toolbar 持续挂载，替换时不显示列表专属控件或计数。
 * 本文件用 `createElement` 而不是 JSX（tsconfig 不启用 jsx）。
 */
import { NormalizedStatus } from '@harness-projects/domain/values'
import { Fragment, createElement, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
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
export type ItemNavigation = { readonly currentItemId?: string | undefined; readonly href: (itemId: string) => string; readonly open: (itemId: string) => void }

/** 标题 anchor 只给安全 item 行：修饰键 / 中键保留真实 href 交给浏览器，普通左键才走 `open`。 */
function TitleLink({ itemId, title, navigation }: { itemId: string; title: string; navigation: ItemNavigation }): ReactElement {
  const onClick = (event: { preventDefault: () => void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void => {
    if (event.button !== undefined && event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigation.open(itemId)
  }
  return createElement('a', { href: navigation.href(itemId), onClick, 'aria-current': navigation.currentItemId === itemId ? 'true' : undefined }, title)
}

/** redacted 行只显示占位：其它单元格是"—"，不透出是否撤权或删除；行 key 只给框架，不进任何属性。 */
function ItemRow({ row, navigation, columns }: { row: VisibleListRow; navigation: ItemNavigation | undefined; columns: readonly Column[] }): ReactElement {
  const readable = row.kind === 'item'
  const values = readable ? {
    title:row.title, identity:row.identity,
    planningStatus:createElement('span', { className:'hp-planning-status' },
      createElement('span', { 'aria-hidden':true, className:row.planningStatusKey === NormalizedStatus.Done ? 'hp-status-dot hp-status-done' : 'hp-status-dot' }),
      row.planningStatus),
    iteration:row.iteration, targetDate:row.targetDate, engineering:row.engineering,
    source:createElement(SourceBadge, { name:row.source, authority:row.authority }),
    freshness:createElement(FreshnessBadge, { stale:row.stale }),
  } : undefined
  const title = readable ? row.title : '内容不可见'
  const titleContent = readable && navigation !== undefined
    ? createElement(TitleLink, { itemId:row.key, title, navigation })
    : readable ? createElement('details', null, createElement('summary', { className:'hp-list-title-text' }, title)) : title
  return createElement('tr', { 'data-selected':readable && navigation?.currentItemId === row.key ? true : undefined },
    createElement('th', { scope:'row', className:'hp-list-wrap' },
      readable && row.numberLabel !== undefined ? createElement('span', { className:'hp-list-number' }, row.numberLabel) : null,
      titleContent),
    ...columns.slice(1).map(column => createElement('td', {
      key:column.id, className:column.id === 'iteration' || column.id === 'source' ? 'hp-list-wrap' : undefined,
    }, values?.[column.id] ?? '—')))
}

type HeaderControl = { closest(selector: string): HeaderControl | null; getBoundingClientRect(): { left: number; right: number }; focus(options: { preventScroll: boolean }): void }
type HeaderSurface = HeaderControl & { scrollLeft: number; querySelector(selector: string): HeaderControl | null; querySelectorAll(selector: string): ArrayLike<HeaderControl> }

/** 可聚焦的局部滚动容器，焦点轮廓使用公开 Host token，窄屏保留八列。 */
function ItemTable({ rows, navigation, query, sizes }: { rows: readonly VisibleListRow[]; navigation: ItemNavigation | undefined; query: QueryControls; sizes: WidthControls }): ReactElement {
  const { conditions } = query.result, columns = TABLE_COLUMNS.filter(column => conditions.visibleColumns.includes(column.id))
  const sort = (column: LocalTableSort['column']): void => query.onChange({ ...conditions, sort:conditions.sort?.column !== column ? {column,direction:'asc'} : conditions.sort.direction === 'asc' ? {column,direction:'desc'} : null })
  const revealHeader = ({ target, currentTarget }: { target: HeaderControl; currentTarget: HeaderSurface }): void => {
    if (!target.closest('thead')) return
    const rect = target.getBoundingClientRect(), bounds = currentTarget.getBoundingClientRect()
    const start = target.closest('th') === currentTarget.querySelector('th') ? bounds.left : currentTarget.querySelector('th')!.getBoundingClientRect().right
    if (rect.right > bounds.right) currentTarget.scrollLeft += rect.right - bounds.right
    else if (rect.left < start) currentTarget.scrollLeft -= start - rect.left
  }
  const tabHeader = (event: { key: string; shiftKey: boolean; target: HeaderControl; currentTarget: HeaderSurface; preventDefault(): void }): void => {
    if (event.key !== 'Tab' || !event.target.closest('thead')) return
    const controls = Array.from(event.currentTarget.querySelectorAll('thead button, thead [tabindex="0"]'))
    const next = controls[controls.indexOf(event.target) + (event.shiftKey ? -1 : 1)]
    if (next) { event.preventDefault(); next.focus({ preventScroll:true }) }
  }
  return createElement('div', { role: 'region', 'aria-label': '工作项表格，可横向和纵向滚动', tabIndex: 0, ref:sizes.attach, onFocus:revealHeader, onKeyDownCapture:tabHeader, className: 'hp-list-scroll', style:Object.fromEntries(Object.entries(sizes.widths).map(([id,value])=>[`--hp-column-${id}`,`${value}px`])) as CSSProperties },
    createElement('table', { style: { width: `calc(${columns.map(columnWidth).join(' + ')})` } },
      createElement('colgroup', null, ...columns.map(column => createElement('col', { key: column.id, style: { width: columnWidth(column) } }))),
      createElement('caption', null, '工作项列表'),
      createElement('thead', null, createElement('tr', null, ...columns.map(column => createElement('th', { key:column.id, scope:'col', 'aria-sort':conditions.sort?.column === column.id ? conditions.sort.direction === 'asc' ? 'ascending' : 'descending' : undefined }, createElement('span', { className:'hp-column-label' }, sortable(column.id) ? createElement('button', { type:'button', className:'hp-column-sort', 'aria-label':`按${column.label}排序`, onClick:(event: {stopPropagation():void}) => { event.stopPropagation(); if (sortable(column.id)) sort(column.id) } }, column.label) : column.label), createElement(ColumnResizeHandle, {key:sizes.interactionKey,column,bounds:sizes.bounds[column.id],width:sizes.widths[column.id]??column.defaultWidth,onBegin:sizes.begin,onChange:value=>sizes.setWidth(column,value)}))))),
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

export function WorkItemListPage({ view, navigation, headingTabIndex, statusAnnouncement, presentationScopeKey, actions, content, heading = '工作项', label = '工作项列表' }: { content?: ReactNode; heading?: string; label?: string; actions?: ReactNode; presentationScopeKey?: string | undefined; view: WorkItemListView; navigation?: ItemNavigation | undefined; headingTabIndex?: number | undefined; statusAnnouncement?: string | undefined }): ReactElement {
  const { body } = view
  const [local, setLocal] = useState({ scopeKey:presentationScopeKey, conditions:defaultLocalTableConditions(), adjusted:false })
  const sameScope = local.scopeKey === presentationScopeKey
  const computed = queryVisibleWorkItems(body.kind === 'content' ? body.rows : [], sameScope ? local.conditions : defaultLocalTableConditions())
  if (!sameScope) setLocal({ scopeKey:presentationScopeKey, conditions:defaultLocalTableConditions(), adjusted:false })
  else if (computed.conditionsAdjusted) setLocal({ scopeKey:presentationScopeKey, conditions:computed.conditions, adjusted:true })
  const query: QueryControls = { result:{...computed,conditionsAdjusted:computed.conditionsAdjusted || (sameScope && local.adjusted)},
    onChange:conditions => setLocal({scopeKey:presentationScopeKey,conditions,adjusted:false}) }
  const sizes = useColumnWidths(presentationScopeKey,TABLE_COLUMNS.filter(column => computed.conditions.visibleColumns.includes(column.id)))
  const showingList = content === undefined
  const busy = body.kind === 'loading' || (body.kind === 'content' && body.refreshing)
  return createElement('section', { 'aria-label': label, className: 'hp-work-items' },
    createElement('style', null, LIST_STYLES),
    createElement('div', { className: 'hp-list-context', role: 'region', 'aria-label': `${heading}上下文`, tabIndex: 0 },
    createElement('header', { className: 'hp-list-toolbar' }, createElement('div', null, createElement('h2', { tabIndex: headingTabIndex }, heading), body.kind === 'content' ? createElement('p', { className:'hp-list-meta' }, view.planningSourceName) : null), actions),
    showingList && view.readOnly ? createElement('p', { className:'hp-list-read-only' }, '只读：规划来源仅允许读取，此处展示规划内容。') : null,
    showingList && view.degraded ? createElement('p', null, '读取能力降级：显示的是保守的最后已知值。') : null,
    !showingList ? null : createElement('div', { className:body.kind === 'content' && !body.stale && !body.refreshing ? 'hp-list-confirmed' : undefined, role: 'status', 'aria-live': statusAnnouncement === undefined ? 'polite' : 'off', 'aria-atomic': 'true' }, view.statusText),
    !showingList || statusAnnouncement === undefined ? null : createElement('span', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' } }, statusAnnouncement),
    showingList && body.kind === 'content' ? createElement(TableControls, { ...query, onResetWidths:sizes.reset, readOnly:view.readOnly }) : null),
    createElement('div', { 'aria-busy': showingList ? busy : undefined, className: 'hp-list-body' }, showingList ? bodyOf(view, query, sizes, navigation) : content))
}
