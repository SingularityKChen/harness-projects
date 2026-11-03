/**
 * 只读工作项列表页面（issue #129）：消费 ui-model 已经算好的安全 view，不读 store / 时钟 / capability，也不推导读取
 * 过程。页面是一处标题、一处稳定的 role=status 区和一个 table；没有行按钮或连接入口；只在传入 navigation 时，安全 item 行的标题是打开详情的链接（ADR-0010），redacted 行没有。
 * `headingTabIndex` 只在组合页传入（-1）：让关闭详情后的回焦能落到列表标题，独立列表页不改变既有输出。
 * 本文件用 `createElement` 而不是 JSX（tsconfig 不启用 jsx）。
 */
import { Fragment, createElement } from 'react'
import type { ReactElement } from 'react'
import type { VisibleListRow, WorkItemListView } from '@harness-projects/ui-model'
import { EmptyState, FreshnessBadge, LoadingState, LIST_STYLES, SourceBadge, StaleBanner, UnavailableState } from './list-states.ts'

import { TABLE_COLUMNS } from './table-columns.ts'

const columnWidth = (column: typeof TABLE_COLUMNS[number]): string => column.id === 'title' ? 'var(--hp-title-width)' : `var(--hp-column-${column.id},${column.defaultWidth}px)`
const TABLE_WIDTH = `calc(${TABLE_COLUMNS.map(columnWidth).join(' + ')})`

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
function ItemRow({ row, navigation }: { row: VisibleListRow; navigation: ItemNavigation | undefined }): ReactElement {
  const cells = row.kind === 'redacted'
    ? TABLE_COLUMNS.slice(1).map(() => '—')
    : [row.identity, row.planningStatus, row.iteration, row.targetDate, row.engineering,
      createElement(SourceBadge, { name: row.source, authority: row.authority }), createElement(FreshnessBadge, { stale: row.stale })]
  const title = row.kind === 'redacted' ? '内容不可见' : row.title
  return createElement('tr', null,
    createElement('th', { scope: 'row', className: 'hp-list-wrap' },
      row.kind === 'item' && navigation !== undefined ? createElement(TitleLink, { itemId: row.key, title, navigation }) : row.kind === 'item' ? createElement('details', null, createElement('summary', { className: 'hp-list-title-text' }, title)) : title),
    ...cells.map((cell, index) => createElement('td', { key: index, className: index === 2 || index === 5 ? 'hp-list-wrap' : undefined }, cell)))
}

/** 可聚焦的局部滚动容器，焦点轮廓使用公开 Host token，窄屏保留八列。 */
function ItemTable({ rows, navigation }: { rows: readonly VisibleListRow[]; navigation: ItemNavigation | undefined }): ReactElement {
  return createElement('div', { role: 'region', 'aria-label': '工作项表格，可横向和纵向滚动', tabIndex: 0, className: 'hp-list-scroll' },
    createElement('table', { style: { width: TABLE_WIDTH } },
      createElement('colgroup', null, ...TABLE_COLUMNS.map(column => createElement('col', { key: column.id, style: { width: columnWidth(column) } }))),
      createElement('caption', null, '工作项列表'),
      createElement('thead', null, createElement('tr', null, ...TABLE_COLUMNS.map(column => createElement('th', { key: column.id, scope: 'col' }, column.label)))),
      createElement('tbody', null, ...rows.map((row) => createElement(ItemRow, { key: row.key, row, navigation })))))
}

function bodyOf({ body, planningSourceName }: WorkItemListView, navigation?: ItemNavigation): ReactElement {
  if (body.kind === 'loading') return createElement(LoadingState)
  if (body.kind === 'unavailable') return createElement(UnavailableState, { message: body.message, remaining: body.remaining })
  const notConfirmed = (body.stale && !body.partial) || body.refreshing // 部分读取的可见行都已确认：不出「最后已知值」横幅
  return createElement(Fragment, null,
    notConfirmed ? createElement(StaleBanner, { source: planningSourceName, at: body.lastUpdatedAt ?? null }) : null,
    body.notice === undefined ? null : createElement('p', null, body.notice),
    body.rows.length === 0 ? createElement(EmptyState, { confirmed: !notConfirmed }) : createElement(ItemTable, { rows: body.rows, navigation }))
}

export function WorkItemListPage({ view, navigation, headingTabIndex, statusAnnouncement }: { view: WorkItemListView; navigation?: ItemNavigation | undefined; headingTabIndex?: number | undefined; statusAnnouncement?: string | undefined }): ReactElement {
  const { body } = view
  const busy = body.kind === 'loading' || (body.kind === 'content' && body.refreshing)
  // 新鲜度只在已确认的内容旁声明（部分读取的可见内容也已确认）；未确认时由状态区宣告、横幅点名来源与时刻，页首不再重复。
  const confirmed = body.kind === 'content' && (!body.stale || body.partial === true) && !body.refreshing
  return createElement('section', { 'aria-label': '工作项列表', className: 'hp-work-items' },
    createElement('style', null, LIST_STYLES),
    createElement('div', { className: 'hp-list-context', role: 'region', 'aria-label': '工作项上下文', tabIndex: 0 },
    createElement('h2', { tabIndex: headingTabIndex }, view.workspaceName),
    createElement('p', { className: 'hp-list-meta' }, '规划来源：', createElement(SourceBadge, { name: view.planningSourceName }),
      ...(view.mappingSourceText === undefined ? [] : ['；', view.mappingSourceText]),
      ...(confirmed ? ['；', createElement(FreshnessBadge, { stale: false, at: body.lastUpdatedAt ?? null })] : [])),
    body.kind === 'content' ? createElement('p', { className: 'hp-list-meta' }, '规划来源最后确认：', body.reconciledAt === undefined ? '未知' : createElement('time', { dateTime: body.reconciledAt }, body.reconciledAt)) : null,
    view.readOnly ? createElement('p', null, '只读：规划来源仅允许读取，此处展示规划内容。') : null,
    view.degraded ? createElement('p', null, '读取能力降级：显示的是保守的最后已知值。') : null,
    createElement('div', { role: 'status', 'aria-live': statusAnnouncement === undefined ? 'polite' : 'off', 'aria-atomic': 'true' }, view.statusText),
    statusAnnouncement === undefined ? null : createElement('span', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' } }, statusAnnouncement)),
    createElement('div', { 'aria-busy': busy, className: 'hp-list-body' }, bodyOf(view, navigation)))
}
