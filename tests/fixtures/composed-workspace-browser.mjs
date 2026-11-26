/** 同一真实 workspace supervisor/store 的 Web History 入口；只组合生产读模型与页面。 */
export const WEB_ENTRY = `
import { openWorkspaceWatch } from './apps/harness-plugin/src/workspace-watch.ts'
import { createPlanningRefreshSource } from '@harness-projects/client'
import { deriveWorkItemListView, deriveWorkItemDetailView } from '@harness-projects/ui-model'
import { WorkItemProjectPage, browserHistoryPort, createItemNavigation, itemPath, resolveWorkspaceLink } from '@harness-projects/ui'
function mountWeb(root, child, disposers) {
  const source = openWorkspaceWatch(child), remote = child.remote.harnessProjects
  const refresh = createPlanningRefreshSource({ source, refreshPlanning: async () => { const r = await remote.refreshPlanning({ kind: 'user' }); if (!r.ok) throw new Error('Host unavailable'); return r.value } })
  let navigation, route, link
  const render = () => {
    const read = source.getSnapshot(), state = refresh.getSnapshot(), target = route?.projectId
    if (target === undefined) { root.render(createElement('p', null, '链接无效，或不属于当前工作区。')); return }
    const known = link?.target === target ? link.state : undefined
    if (known === 'failed') {
      root.render(createElement('section', { 'aria-label': '项目' }, createElement('h2', { tabIndex: -1 }, '项目'),
        createElement('p', { role: 'alert' }, '无法打开链接中的项目，请回到项目列表。')))
      return
    }
    if ((known === 'opening' || known === 'open') && (read === undefined || read.workspace.id !== target)) {
      root.render(createElement('p', { role: 'status' }, '正在打开链接中的项目…')); return
    }
    if (known === 'invalid') { root.render(createElement('p', null, '链接无效，或不属于当前工作区。')); return }
    if (!read) { root.render(createElement('p', null, '正在连接宿主并读取工作项。')); return }
    if (read.workspace.id !== target) { root.render(createElement('p', null, '链接无效，或不属于当前工作区。')); return }
    const input = { read, metadata: { sourceNames: {}, ...(!read.connection.connected ? { safeNotice: '与宿主的连接已中断，正在自动重新连接；下面是最后已知值。' } : {}) }, phase: 'received', refreshing: state.pending }
    const listView = deriveWorkItemListView(input), projectId = target
    root.render(createElement(WorkItemProjectPage, {
      listView, detailView: route.itemId ? deriveWorkItemDetailView(input, route) : undefined,
      connected: read.connection.connected,
      navigation: { currentItemId: route.itemId, href: id => itemPath({ projectId, itemId: id }), open: id => navigation.open({ projectId, itemId: id }) },
      onCloseDetail: () => navigation.close(projectId),
      refresh: { pending: state.pending, disabled: state.pending || !read.connection.connected, run: () => { void refresh.refresh() } },
    }))
  }
  const resolve = async () => {
    const target = route?.projectId
    if (target === undefined || link?.target === target) return
    link = { target, state: 'opening' }; render()
    const state = await resolveWorkspaceLink({
      path: location.pathname,
      getSetup: async () => { const result = await remote.getWorkspaceSetup(); if (!result.ok) throw new Error('Host unavailable'); return result.value },
      listWorkspaces: async () => { const result = await remote.listWorkspaces(); if (!result.ok) throw new Error('Host unavailable'); return result.value },
      openWorkspace: async (workspaceId) => { const result = await remote.openWorkspace(workspaceId); return result.ok && result.value?.state === 'activated' ? 'activated' : 'failed' },
      isCurrent: () => route?.projectId === target,
    })
    if (state === undefined) return
    link = { target, state }; render()
  }
  navigation = createItemNavigation(browserHistoryPort(), value => { route = value; link = undefined; render(); void resolve() })
  const stop = source.subscribe(() => { render(); void resolve() }), stopRefresh = refresh.subscribe(render)
  disposers.push(() => { stop(); stopRefresh(); navigation.dispose(); refresh.dispose(); return source.close() })
}
`
