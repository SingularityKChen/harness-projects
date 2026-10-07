/** 唯一只读详情抽屉（issue #130）：原生 `<dialog>` showModal 承担焦点进入/背景 inert/焦点限制/Escape（W3C H102）。 */
import { createElement, useEffect, useId, useRef } from 'react'
import type { ReactElement } from 'react'
import type { WorkItemDetailView } from '@harness-projects/ui-model'
import { LoadingState, SourceBadge, UnavailableState } from './list-states.ts'

/** 浏览器 DOM 最小结构面：只声明真正用到的成员且全部可选；SSR 无 `document`，存在性由运行时判断。 */
export interface DOMElement {
  readonly isConnected?: boolean
  readonly open?: boolean
  contains?(other: DOMElement): boolean
  querySelector?(selectors: string): DOMElement | null
  querySelectorAll?(selectors: string): readonly DOMElement[]
  hasAttribute?(name: string): boolean
  focus?(): void
  close?(): void
  showModal?(): void
}

/** 当前焦点元素；SSR 无 `document` 时返回 null。 */
export function activeElement(): DOMElement | null {
  const doc = (globalThis as { document?: { activeElement?: DOMElement | null } }).document
  return doc?.activeElement ?? null
}

const UNRESOLVED = '当前快照未找到此条目，是否存在尚未确认。'
const ROW_STYLE = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const
const PANEL_STYLE = { maxWidth: '38rem', width: '100%', padding: '0 1rem', overflowWrap: 'anywhere' } as const
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'

/** 时间固定为“工作区最后接收确认帧”：未提供只说未知，不读时钟补事实。 */
function contentPanel(body: Extract<WorkItemDetailView['body'], { kind: 'content' }>): ReactElement {
  const at = body.lastUpdatedAt === undefined ? '读取时间未知' : createElement('time', { dateTime: body.lastUpdatedAt }, body.lastUpdatedAt)
  return createElement('div', null,
    createElement('p', null, '规划状态：', body.planningStatus),
    createElement('p', null, '来源身份：', createElement(SourceBadge, { name: body.source, authority: body.authority }),
      body.identity === undefined ? '（来源身份尚未提供）' : `（${body.identity.kind} ${body.identity.externalId}）`),
    createElement('p', { style: ROW_STYLE }, body.body),
    createElement('p', null, body.derived ?? '无派生提示'),
    createElement('p', null, body.stale || body.refreshing ? '最后已知值，当前结果尚未确认' : '当前值', '（工作区最后接收确认帧：', at, '）'))
}

function panelBody(body: WorkItemDetailView['body']): ReactElement {
  if (body.kind === 'loading') return createElement(LoadingState)
  if (body.kind === 'unavailable') return createElement(UnavailableState, { message: body.message, remaining: body.remaining })
  if (body.kind === 'unresolved') return createElement('p', null, UNRESOLVED)
  if (body.kind === 'redacted') return createElement('p', null, '内容不可见')
  return contentPanel(body)
}

/** Tab 循环：末元素回首、首元素 Shift+Tab 回末；Escape 只走原生 cancel，避免一次按键关两次。 */
function cycleFocus(dialog: DOMElement, shiftKey: boolean, event: { preventDefault?: () => void }): void {
  const focusable = Array.from(dialog.querySelectorAll?.(FOCUSABLE) ?? []).filter((node) => node.hasAttribute?.('disabled') !== true)
  const first = focusable[0] ?? dialog
  const last = focusable[focusable.length - 1] ?? dialog
  if (shiftKey && activeElement() === first) { event.preventDefault?.(); last.focus?.() }
  if (!shiftKey && activeElement() === last) { event.preventDefault?.(); first.focus?.() }
}

/** 唯一详情抽屉：view 变化只更新内容；Escape 只走原生 cancel（preventDefault 后一次 onClose）；cleanup 不导航。 */
export function WorkItemDetailDrawer({ view, onClose }: { view: WorkItemDetailView; onClose: () => void }): ReactElement {
  const dialog = useRef<DOMElement | null>(null)
  const title = useRef<DOMElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    if (element.open !== true) {
      if (typeof element.showModal !== 'function') throw new TypeError('showModal 不可用：当前环境不支持原生模态对话框')
      element.showModal()
    }
    title.current?.focus?.()
    return () => { if (element.open === true) element.close?.() }
  }, [])

  const onKeyDown = (event: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    if (event.key !== 'Tab') return
    const element = dialog.current
    if (element !== null) cycleFocus(element, event.shiftKey === true, event)
  }

  return createElement('dialog', {
    ref: dialog, 'aria-labelledby': titleId, onKeyDown,
    onCancel: (event: { preventDefault: () => void }) => { event.preventDefault(); onClose() },
  },
  createElement('div', { style: PANEL_STYLE },
    createElement('h2', { id: titleId, ref: title, tabIndex: -1 }, view.body.kind === 'content' ? view.body.title : '工作项详情'),
    panelBody(view.body),
    createElement('button', { type: 'button', onClick: onClose }, '关闭详情')))
}
