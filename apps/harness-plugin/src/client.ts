/**
 * 客户端半边：构建成 `window.__ModuleLoader__.load` 包装的 bundle，只导出 `apply` 与 `inject`。
 *
 * 先在根 Context 上挂载 Remote，再在 `ctx.inject` 子 Context 中同时读取
 * `remote.harnessProjects` 与 `slots`；根 Context 不直接读取 namespace（M17）。
 */
import { HARNESS_PANEL_TITLE, PlaceholderIcon, bindWorkItemApp } from '@harness-projects/ui'
import type { ClientContext } from './host-surface.ts'
import { CLIENT_REMOTE } from './remote.ts'
import { openWorkspaceWatch } from './workspace-watch.ts'

const PANEL_ID = 'harness-projects'

export const inject = ['remote']

export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount(CLIENT_REMOTE)
  ctx.inject(['remote.harnessProjects', 'slots'], (child) => {
    // 监督者吸收一切终止、从不向调用方抛错：面板贡献是本 fiber 的 effect，回调抛错时 Cordis 卸载 fiber 会连带撤回面板（D38）
    const workspace = openWorkspaceWatch(child)
    child.effect(() => () => workspace.close(), 'harness-projects: workspace watch')
    const Panel = bindWorkItemApp(workspace)
    child.slots.inject('main', () => child.slots.register({ name: 'main', key: PANEL_ID }, Panel))
    child.slots.inject('sidebar.panellist', () =>
      child.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: HARNESS_PANEL_TITLE },
      PlaceholderIcon,
      ),
    )
  })
}
