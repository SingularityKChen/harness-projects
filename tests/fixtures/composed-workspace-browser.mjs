/** 同一真实 workspace supervisor/store 的 Web History 入口；只组合生产读模型与页面。 */
export const WEB_ENTRY = `
import { openWorkspaceWatch } from './apps/harness-plugin/src/workspace-watch.ts'
import { createPlanningRefreshSource } from '@harness-projects/client'
import { deriveWorkItemListView, deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { WorkItemProjectPage, browserHistoryPort, createItemNavigation, itemPath } from '@harness-projects/ui'
function mountWeb(root, child, disposers) {
  const source = openWorkspaceWatch(child), remote = child.remote.harnessProjects
  const refresh = createPlanningRefreshSource({ source, refreshPlanning: async () => { const r = await remote.refreshPlanning({ kind: 'user' }); if (!r.ok) throw new Error('Host unavailable'); return r.value } })
  let navigation, route
  const render = () => {
    const read = source.getSnapshot(), state = refresh.getSnapshot()
    if (!read) { root.render(createElement('p', null, '正在连接宿主并读取工作项。')); return }
    if (!route || route.projectId !== read.workspace.id) { root.render(createElement('p', null, '链接无效，或不属于当前工作区。')); return }
    const input = { read, metadata: { sourceNames: {}, ...(!read.connection.connected ? { safeNotice: '与宿主的连接已中断，正在自动重新连接；下面是最后已知值。' } : {}) }, phase: 'received', refreshing: state.pending }
    const listView = deriveWorkItemListView(input), projectId = route.projectId
    root.render(createElement(WorkItemProjectPage, {
      listView, detailView: route.itemId ? deriveWorkItemDetailView(input, route) : undefined,
      connected: read.connection.connected,
      navigation: { href: id => itemPath({ projectId, itemId: id }), open: id => navigation.open({ projectId, itemId: id }) },
      onCloseDetail: () => navigation.close(projectId),
      refresh: { pending: state.pending, disabled: state.pending || !read.connection.connected, run: () => { void refresh.refresh() } },
    }))
  }
  navigation = createItemNavigation(browserHistoryPort(), value => { route = value; render() })
  const stop = source.subscribe(render), stopRefresh = refresh.subscribe(render)
  disposers.push(() => { stop(); stopRefresh(); navigation.dispose(); refresh.dispose(); return source.close() })
}
`
