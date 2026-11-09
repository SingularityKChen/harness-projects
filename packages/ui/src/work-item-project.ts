/**
 * 工作项项目页（issue #130）：只组合列表与唯一 `WorkItemDetailDrawer`，不持 store 或业务缓存。
 * 打开时记下 `document.activeElement` 与当时的列表容器，关闭后仅当 opener 仍是该容器成员才回焦，否则聚焦列表标题；
 * 用打开时的容器做包含检查，因为 React 重渲染可能替换容器节点。撤权只更新 content，不关闭重开。
 */
import type { ExecutionContextReader, StartWork, DeliveryLineageReader, IssueClosingLinksReader, ChangeRequestCreator } from '@harness-projects/client'
import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DeliveryOverviewTargets, WorkItemDetailView, WorkItemListView } from '@harness-projects/ui-model'
import { WorkItemDetailDrawer, activeElement, type DOMElement } from './work-item-detail.ts'
import { WorkItemListPage, type ItemNavigation } from './work-item-list.ts'
import { DETAIL_STYLES, type LayoutRoot } from './detail-presentation.ts'
import { DeliveryOverview } from './delivery-overview.ts'
import { WORKSPACE_STYLES } from './workspace-presentation.ts'

export function WorkItemProjectPage({ listView, deriveOverviewTargets, detailView, navigation, onCloseDetail, executionReader, connected, startWork, onBindRepository, deliveryReader, issueClosingLinksReader, changeRequestCreator, refresh, statusAnnouncement, presentationScopeKey }: {
  readonly deriveOverviewTargets?: (() => DeliveryOverviewTargets) | undefined
  readonly presentationScopeKey?: string | undefined
  readonly refresh?: { readonly pending: boolean; readonly disabled: boolean; readonly run: () => void } | undefined; readonly issueClosingLinksReader?: IssueClosingLinksReader | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly changeRequestCreator?: ChangeRequestCreator | undefined;
  readonly statusAnnouncement?: string | undefined
  readonly startWork?: StartWork | undefined
  readonly onBindRepository?: (() => void) | undefined
  readonly executionReader?: ExecutionContextReader | undefined
  readonly connected?: boolean | undefined
  readonly listView: WorkItemListView
  readonly detailView: WorkItemDetailView | undefined
  readonly navigation: ItemNavigation | undefined
  readonly onCloseDetail: () => void
}): ReactElement {
  const [mode, setMode] = useState('items')
  const layoutRoot = useRef<LayoutRoot | null>(null)
  const list = useRef<DOMElement | null>(null)
  const opener = useRef<DOMElement | null>(null)
  const openerContainer = useRef<DOMElement | null>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    const open = detailView !== undefined
    const closed = !open && wasOpen.current
    wasOpen.current = open
    if (!closed) return
    const target = opener.current
    const usable = target !== null && target.isConnected === true && openerContainer.current?.contains?.(target) === true
    if (usable) target.focus?.()
    else list.current?.querySelector?.('h2')?.focus?.()
  }, [detailView])

  // opener 只在用户经列表入口打开时记录：抽屉标题会在挂载时抢焦点，若在 effect 里读 activeElement 会捕获到抽屉标题。
  const routed: ItemNavigation | undefined = navigation === undefined ? undefined : {
    href: navigation.href,
    open: (itemId) => { opener.current = activeElement(); openerContainer.current = list.current; navigation.open(itemId) },
  }
  const modes = createElement('div', { className: 'hp-list-actions hp-view-modes' }, ...(['items', 'delivery'] as const).map(value => createElement('button', { key: value, type: 'button', 'aria-pressed': mode === value, onClick: () => setMode(value) }, value === 'items' ? '工作项' : '工程交付')))
  const actions = createElement('div', { className: 'hp-list-actions' }, modes,
    refresh === undefined ? null : createElement('button', { className: 'hp-action', type: 'button', disabled: refresh.disabled, 'aria-busy': refresh.pending, onClick: refresh.run }, refresh.pending ? '正在刷新规划' : '刷新规划'),
    onBindRepository === undefined ? null : createElement('button', { className: 'hp-action', type: 'button', 'data-workspace-settings': true, onClick: onBindRepository }, '连接设置'))
  return createElement('div', { ref: layoutRoot, className: 'hp-workspace hp-project' },
    createElement('div', { ref: list, className: 'hp-project-list' }, createElement(WorkItemListPage, { view: listView, navigation: routed, headingTabIndex: -1, statusAnnouncement, presentationScopeKey, actions,
      ...(mode === 'delivery' && deriveOverviewTargets !== undefined ? { heading: '工程交付', label: '工程交付总览', content: createElement(DeliveryOverview, { key: presentationScopeKey, targets: deriveOverviewTargets(), reader: deliveryReader, connected: connected === true, navigation: routed, onBindRepository }) } : {}),
    })),
    // 列表的页面级说明也交给抽屉：模态打开时列表 inert，说明只在列表里就既看不到也不被宣告（#379）
    detailView === undefined ? null : createElement(WorkItemDetailDrawer, {
      view: detailView, layoutRoot, refresh, executionReader, deliveryReader, issueClosingLinksReader, changeRequestCreator, connected, startWork, onBindRepository, notice: listView.body.kind === 'content' ? listView.body.notice : undefined, onClose: onCloseDetail,
    }),
    createElement('style', null, WORKSPACE_STYLES, DETAIL_STYLES, '.hp-view-modes [aria-pressed=true] { font-weight:650; border-color:var(--hp-accent) }'))
}
