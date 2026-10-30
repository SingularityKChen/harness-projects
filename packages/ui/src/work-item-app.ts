/**
 * 工作项应用容器（issue #229）：插件 `main` 面板的唯一页面入口，持有三件事——唯一 scope 门、插件内导航（`useState`
 * 路由，片段 href）与页面被替换时的焦点。数据只经注入的 `WorkspaceSource`（形状与 client 监督者一致，ui 只引类型、不 import
 * client 运行时）；容器不持 store 副本，不写颜色、字体与 `document.title`，主题经继承，`<dialog>` 用 UA 的 Canvas / CanvasText。
 */
import type { PlanningRefreshSource, PlanningRefreshSnapshot } from '@harness-projects/client'
import type { ExecutionContextReader, StartWork, DeliveryLineageReader } from '@harness-projects/client'
import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { deriveWorkItemDetailView, deriveWorkItemListView, type WorkItemListReadInput, type WorkspaceRead } from '@harness-projects/ui-model'
import { itemPath, parseItemRoute } from './item-route.ts'
import { LoadingState } from './list-states.ts'
import { HARNESS_PANEL_TITLE } from './placeholder.ts'
import type { DOMElement } from './work-item-detail.ts'
import { WorkItemProjectPage } from './work-item-project.ts'
import { WORKSPACE_STYLES } from './workspace-presentation.ts'

/** 外部可订阅的读数源：快照在两次发布之间是同一对象（`useSyncExternalStore` 的前提），`undefined` = 还没有接受过帧。 */
export interface WorkspaceSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): WorkspaceRead | undefined
}

const IDLE_REFRESH: PlanningRefreshSnapshot = Object.freeze({ pending: false })
const noRefresh = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => IDLE_REFRESH }
const DISCONNECTED = '与宿主的连接已中断，正在自动重新连接；下面是最后已知值。'

/** 一屏：`key` 变化才算页面被替换（焦点规则的判据），`children` 是根 `section` 下的内容。 */
type Screen = { readonly key: string; readonly children: readonly ReactElement[] }

/** 屏的标题可聚焦（-1）：页面被替换后焦点需要一个定义好的落点，而不是 body。 */
const heading = (text: string): ReactElement => createElement('h2', { tabIndex: -1 }, text)

/**
 * 唯一 scope 门：路由的 `projectId` 必须等于当前快照的工作区 id，否则只出中性 unresolved（不回显路由、不读 store、不 derive、
 * 无 anchor）；href 只用过门的 `projectId`。宿主里没有地址栏与 Back，所以 unresolved 屏自带回到列表的按钮。
 */
function screenOf(read: WorkspaceRead | undefined, path: string | undefined, setPath: (path: string | undefined) => void, executionReader?: ExecutionContextReader, startWork?: StartWork, onBindRepository?: () => void, deliveryReader?: DeliveryLineageReader, refreshSource?: PlanningRefreshSource, refresh: PlanningRefreshSnapshot = IDLE_REFRESH): Screen {
  if (read === undefined) return { key: 'loading', children: [heading(HARNESS_PANEL_TITLE), createElement('p', null, '正在连接宿主并读取工作项。'), createElement(LoadingState)] }
  const route = path === undefined ? { projectId: read.workspace.id } : parseItemRoute(path)
  if (route === undefined || route.projectId !== read.workspace.id) {
    return { key: 'unresolved', children: [heading('无法显示此页面'), createElement('p', null, '链接无效，或不属于当前工作区。'),
      createElement('button', { type: 'button', className: 'hp-action hp-action-primary', onClick: () => setPath(undefined) }, '回到工作项列表')] }
  }
  const { projectId, itemId } = route
  const notice = refresh.error ?? (refresh.pending ? '正在刷新，当前显示的是最后已知值' : read.connection.connected ? undefined : DISCONNECTED)
  const denied = read.reason === 'permission_denied' && read.capabilities?.some((entry) => entry.key === 'planning.item.read' && entry.access === 'unavailable')
  const input: WorkItemListReadInput = { read, metadata: { sourceNames: {}, ...(notice ? { safeNotice: notice } : {}) },
    ...(denied || refresh.error ? { phase: 'failed', hasReceivedSnapshot: true, cacheVisibility: 'authorized', failure: { kind: denied ? 'permission_denied' : 'error' } } as const : { phase: 'received', refreshing: refresh.pending } as const) }
  const canRefresh = read.reason === 'permission_denied' || read.capabilities?.some((entry) => entry.key === 'planning.item.read' && ['available', 'read_only', 'degraded'].includes(entry.access)) === true
  return {
    key: `page:${projectId}`,
    children: [createElement(WorkItemProjectPage, {
      listView: deriveWorkItemListView(input),
      detailView: itemId === undefined ? undefined : deriveWorkItemDetailView(input, { projectId, itemId }),
      navigation: { href: (id) => `#${itemPath({ projectId, itemId: id })}`, open: (id) => setPath(itemPath({ projectId, itemId: id })) },
      onCloseDetail: () => setPath(undefined), executionReader, deliveryReader, startWork, onBindRepository, connected: read.connection.connected,
      refresh: refreshSource === undefined ? undefined : { pending: refresh.pending, disabled: refresh.pending || !read.connection.connected || !canRefresh, run: () => { void refreshSource.refresh() } },
    })],
  }
}

/** 页面被替换后焦点已丢失：无焦点元素、落在 body（元素被卸载后浏览器的归宿）或元素已脱离文档；宿主持有的焦点不算。 */
function focusLost(): boolean {
  const doc = (globalThis as { document?: { activeElement?: DOMElement | null; body?: DOMElement | null } }).document
  const active = doc?.activeElement ?? null
  return active === null || active === doc?.body || active.isConnected === false
}

/** `initialPath` 只在挂载时读一次（`undefined` = 当前工作区列表）；之后路由是容器自己的局部状态，不是事实。 */
export function WorkItemApp({ source, initialPath, executionReader, startWork, onBindRepository, deliveryReader, refreshSource }: { readonly refreshSource?: PlanningRefreshSource | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly startWork?: StartWork | undefined; readonly onBindRepository?: (() => void) | undefined; readonly source: WorkspaceSource; readonly initialPath?: string | undefined; readonly executionReader?: ExecutionContextReader | undefined }): ReactElement {
  const read = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const refresh = useSyncExternalStore(refreshSource?.subscribe ?? noRefresh.subscribe, refreshSource?.getSnapshot ?? noRefresh.getSnapshot, refreshSource?.getSnapshot ?? noRefresh.getSnapshot)
  const [path, setPath] = useState(initialPath)
  const root = useRef<DOMElement | null>(null)
  const shown = useRef<string | undefined>(undefined)
  const { key, children } = screenOf(read, path, setPath, executionReader, startWork, onBindRepository, deliveryReader, refreshSource, refresh)
  // 首挂（含 StrictMode 的二次挂载）与同一屏内的变化都不动焦点；抽屉关闭后的回焦仍归 WorkItemProjectPage。
  useEffect(() => {
    const previous = shown.current
    shown.current = key
    if (previous !== undefined && previous !== key && focusLost()) root.current?.querySelector?.('h2')?.focus?.()
  }, [key])
  return createElement('section', { 'aria-label': HARNESS_PANEL_TITLE, className: 'hp-workspace', ref: root }, ...children, createElement('style', null, WORKSPACE_STYLES))
}

/** 壳只拿到一个无 hook 的组件：不写 `createElement`、不 import react，面板只算一次。 */
export function bindWorkItemApp(source: WorkspaceSource, executionReader?: ExecutionContextReader, deliveryReader?: DeliveryLineageReader): () => ReactElement {
  return () => createElement(WorkItemApp, { source, executionReader, deliveryReader })
}
