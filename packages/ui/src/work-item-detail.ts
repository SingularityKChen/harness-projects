import { IssueDependenciesSection } from './issue-dependencies-section.ts'
/** 唯一只读详情抽屉（issue #130）：原生 `<dialog>` showModal 承担焦点进入/背景 inert/焦点限制/Escape（W3C H102）。 */
import type { ExecutionContextReader, StartWork, DeliveryLineageReader, IssueClosingLinksReader, IssueDependenciesReader, ChangeRequestCreator } from '@harness-projects/client'
import { IssueClosingLinksSection } from './issue-closing-links-section.ts'
import { StartWorkSection } from './start-work-section.ts'
import { DeliveryLineageSection } from './delivery-lineage-section.ts'
import { ExecutionContextSection } from './execution-context-section.ts'
import { createElement, useEffect, useId, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { WorkItemDetailView } from '@harness-projects/ui-model'
import { LoadingState, SourceBadge, UnavailableState } from './list-states.ts'
import { DETAIL_STYLES, observeDetailLayout, type DetailMode, type LayoutRoot } from './detail-presentation.ts'
import { WORKSPACE_STYLES } from './workspace-presentation.ts'
import { SafeMarkdown } from './safe-markdown.ts'

/** 浏览器 DOM 最小结构面：只声明真正用到的成员且全部可选；SSR 无 `document`，存在性由运行时判断。 */
export interface DOMElement {
  readonly isConnected?: boolean
  readonly open?: boolean
  contains?(other: DOMElement): boolean
  querySelector?(selectors: string): DOMElement | null
  querySelectorAll?(selectors: string): readonly DOMElement[]
  hasAttribute?(name: string): boolean
  closest?(selectors: string): DOMElement | null
  getClientRects?(): ArrayLike<unknown>
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
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'

/** 时间固定为“工作区最后接收确认帧”：未提供只说未知，不读时钟补事实。 */
function contentPanel(body: Extract<WorkItemDetailView['body'], { kind: 'content' }>): ReactElement {
  const at = body.lastUpdatedAt === undefined ? '读取时间未知' : createElement('time', { dateTime: body.lastUpdatedAt }, body.lastUpdatedAt)
  const field = (label: string, value: ReactElement | string): ReactElement => createElement('div', { key: label }, createElement('dt', null, label), createElement('dd', null, value))
  return createElement('div', { className: 'hp-detail-content' },
    createElement(SafeMarkdown, { body: body.body, markdownSource: body.markdownSource }),
    createElement('dl', { className: 'hp-detail-metadata' },
      field('迭代：', body.iteration), field('目标日期：', body.targetDate),
      field('来源身份：', createElement('span', null, createElement(SourceBadge, { name: body.source, authority: body.authority }),
        body.identity === undefined ? '（来源身份尚未提供）' : `（${body.identity.kind} ${body.identity.externalId}）`)),
      field('规划来源最后确认：', body.reconciledAt === undefined ? '未知' : createElement('time', { dateTime: body.reconciledAt }, body.reconciledAt)),
      field('读取状态：', body.stale || body.refreshing ? '最后已知值，当前结果尚未确认' : '当前值'),
      field('工作区最后接收确认帧：', at)),
    createElement('p', { className: 'hp-detail-derived' }, body.derived ?? '无派生提示'))
}

function panelBody(body: WorkItemDetailView['body']): ReactElement {
  if (body.kind === 'loading') return createElement(LoadingState)
  if (body.kind === 'unavailable') return createElement(UnavailableState, { message: body.message, remaining: body.remaining })
  if (body.kind === 'unresolved') return createElement('p', null, UNRESOLVED)
  if (body.kind === 'redacted') return createElement('p', null, '内容不可见')
  return contentPanel(body)
}

/** Tab 循环：末元素回首、首元素 Shift+Tab 回末；Escape 只走原生 cancel，避免一次按键关两次。 */
function cycleFocus(dialog: DOMElement, title: DOMElement | null, shiftKey: boolean, event: { preventDefault?: () => void }): void {
  const focusable = Array.from(dialog.querySelectorAll?.(FOCUSABLE) ?? []).filter((node) => node.hasAttribute?.('disabled') !== true && node.closest?.('[hidden],[inert]') == null && (node.getClientRects === undefined || node.getClientRects().length > 0))
  const first = focusable[0] ?? dialog
  const last = focusable[focusable.length - 1] ?? dialog
  if (shiftKey && (activeElement() === first || activeElement() === title)) { event.preventDefault?.(); last.focus?.() }
  if (!shiftKey && activeElement() === last) { event.preventDefault?.(); first.focus?.() }
}

/**
 * 唯一详情抽屉：view 变化只更新内容；Escape 只走原生 cancel（preventDefault 后一次 onClose）；cleanup 不导航。
 * `notice` 是页面级说明（如断开重连）：模态打开时背景 inert，所以抽屉在自己稳定的状态区里再说一次，打开期间出现也会被宣告。
 */
export function WorkItemDetailDrawer({ view, notice, onClose, executionReader, connected, startWork, onBindRepository, deliveryReader, issueClosingLinksReader, issueDependenciesReader, changeRequestCreator, refresh, layoutRoot }: { readonly layoutRoot?: { readonly current: LayoutRoot | null } | undefined; readonly refresh?: { readonly pending: boolean; readonly disabled: boolean; readonly run: () => void } | undefined; readonly issueClosingLinksReader?: IssueClosingLinksReader | undefined; readonly issueDependenciesReader?: IssueDependenciesReader | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly changeRequestCreator?: ChangeRequestCreator | undefined; startWork?: StartWork | undefined; onBindRepository?: (() => void) | undefined; executionReader?: ExecutionContextReader | undefined; connected?: boolean | undefined; view: WorkItemDetailView; notice?: string | undefined; onClose: () => void }): ReactElement {
  const dialog = useRef<DOMElement | null>(null)
  const title = useRef<DOMElement | null>(null)
  const titleId = useId()
  const [executionRefresh, setExecutionRefresh] = useState(0)
  const [mode, setMode] = useState<DetailMode>('preview')
  const body = useRef<{ scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number } | null>(null)
  const restore = useRef<number | undefined>(undefined)

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

  useEffect(() => {
    const root = layoutRoot?.current
    const cleanup = root == null ? undefined : observeDetailLayout(root, mode)
    const element = body.current
    if (element !== null && restore.current !== undefined) {
      // 读取 scrollHeight 使新矩形完成布局，再把读位恢复到可达区间。
      element.scrollTop = Math.max(0, Math.min(restore.current, element.scrollHeight - element.clientHeight))
      restore.current = undefined
    }
    return cleanup
  }, [layoutRoot, mode])

  const toggleMode = (): void => {
    const next = mode === 'preview' ? 'expanded' : 'preview'
    restore.current = body.current?.scrollTop ?? 0
    setMode(next)
  }

  const onKeyDown = (event: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    if (event.key !== 'Tab') return
    const element = dialog.current
    if (element !== null) cycleFocus(element, title.current, event.shiftKey === true, event)
  }

  const target = view.body.kind === 'content' ? view.body.executionTarget : undefined
  return createElement('dialog', {
    ref: dialog, className: 'hp-workspace hp-detail', 'data-detail-mode': mode, 'aria-labelledby': titleId, onKeyDown,
    onCancel: (event: { preventDefault: () => void }) => { event.preventDefault(); onClose() },
  },
  createElement('style', null, WORKSPACE_STYLES, DETAIL_STYLES),
  createElement('header', { className: 'hp-detail-header' },
    createElement('div', { className: 'hp-detail-heading' },
      view.body.kind === 'content' && view.body.numberLabel !== undefined ? createElement('p', { className: 'hp-detail-number' }, view.body.numberLabel) : null,
      createElement('h2', { className: 'hp-detail-title', id: titleId, ref: title, tabIndex: -1 }, view.body.kind === 'content' ? view.body.title : '工作项详情'),
      view.body.kind === 'content' ? createElement('p', { className: 'hp-detail-status' }, '规划状态：', view.body.planningStatus) : null,
      createElement('p', { className: 'hp-detail-mode', id: `${titleId}-mode` }, mode === 'preview' ? '当前为预览模式' : '当前为展开模式')),
    createElement('div', { className: 'hp-detail-actions' },
      createElement('button', { className: 'hp-action', type: 'button', onClick: toggleMode, 'aria-describedby': `${titleId}-mode` }, mode === 'preview' ? '展开详情' : '还原详情'),
      createElement('button', { className: 'hp-action', type: 'button', onClick: onClose }, '关闭详情'))),
  createElement('div', { ref: body, className: 'hp-detail-body' },
    createElement('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, notice),
    ...(refresh === undefined ? [] : [createElement('button', { type: 'button', disabled: refresh.disabled, 'aria-busy': refresh.pending, onClick: refresh.run }, refresh.pending ? '正在刷新规划' : '刷新规划')]),
    panelBody(view.body),
    view.body.kind !== 'content' || !view.body.issueDependenciesTarget || !issueDependenciesReader ? null
      : createElement(IssueDependenciesSection, { target: view.body.issueDependenciesTarget, reader: issueDependenciesReader, connected: connected === true }),
    view.body.kind !== 'content' || view.body.issueClosingLinksTarget === undefined || issueClosingLinksReader === undefined ? null
      : createElement(IssueClosingLinksSection, { target: view.body.issueClosingLinksTarget, reader: issueClosingLinksReader, connected: connected === true }),
    target === undefined || deliveryReader === undefined ? null
      : target.repositoryIds.length === 0 ? createElement('p', null, '仓库信息尚未提供')
      : target.repositoryIds.map((repositoryId) => createElement(DeliveryLineageSection, { key: repositoryId,
        scope: { workspaceId: target.workspaceId, workItemId: target.workItemId, repositoryId }, reader: deliveryReader, accessToken: view.body.kind === 'content' ? view.body.deliveryAccessTokens?.[repositoryId] : undefined, creatorAccessToken: view.body.kind === 'content' ? view.body.changeRequestAccessToken : undefined, creator: changeRequestCreator, creationRefreshToken: executionRefresh, onConnect: onBindRepository, connected: connected === true })),
    view.body.kind !== 'content' || view.body.executionTarget === undefined || executionReader === undefined ? null
      : createElement(ExecutionContextSection, { key: `execution:${JSON.stringify(view.body.executionTarget)}`, target: view.body.executionTarget, reader: executionReader, connected: connected === true, refreshToken: executionRefresh }),
    view.body.kind !== 'content' || !view.body.executionTarget || !startWork ? null : createElement(StartWorkSection, { key: `start-work:${JSON.stringify(view.body.executionTarget)}`, target: view.body.executionTarget, repositories: view.body.startWorkRepositories ?? [], startWork, connected: connected === true, onStarted: () => setExecutionRefresh((value) => value + 1), onBindRepository })))
}
