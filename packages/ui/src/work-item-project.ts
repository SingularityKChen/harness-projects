/**
 * 工作项项目页（issue #130）：只组合列表与唯一 `WorkItemDetailDrawer`，不持 store 或业务缓存。
 * 打开时记下 `document.activeElement` 与当时的列表容器，关闭后仅当 opener 仍是该容器成员才回焦，否则聚焦列表标题；
 * 用打开时的容器做包含检查，因为 React 重渲染可能替换容器节点。撤权只更新 content，不关闭重开。
 */
import { createElement, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { WorkItemDetailView, WorkItemListView } from '@harness-projects/ui-model'
import { WorkItemDetailDrawer, activeElement, type DOMElement } from './work-item-detail.ts'
import { WorkItemListPage, type ItemNavigation } from './work-item-list.ts'

export function WorkItemProjectPage({ listView, detailView, navigation, onCloseDetail }: {
  readonly listView: WorkItemListView
  readonly detailView: WorkItemDetailView | undefined
  readonly navigation: ItemNavigation | undefined
  readonly onCloseDetail: () => void
}): ReactElement {
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
  return createElement('div', null,
    createElement('div', { ref: list }, createElement(WorkItemListPage, { view: listView, navigation: routed, headingTabIndex: -1 })),
    detailView === undefined ? null : createElement(WorkItemDetailDrawer, { view: detailView, onClose: onCloseDetail }))
}
