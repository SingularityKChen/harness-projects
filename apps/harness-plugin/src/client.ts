/**
 * 客户端半边：构建成 `window.__ModuleLoader__.load` 包装的 bundle，只导出 `apply` 与 `inject`。
 *
 * 先在根 Context 上挂载 Remote，再在 `ctx.inject` 子 Context 中同时读取
 * `remote.harnessProjects` 与 `slots`；根 Context 不直接读取 namespace（M17）。
 */
import { HARNESS_PANEL_TITLE, PlaceholderIcon, PlaceholderPanel } from '@harness-projects/ui'
import type { ClientContext } from './host-surface.ts'
import { CLIENT_REMOTE } from './remote.ts'

const PANEL_ID = 'harness-projects'

export const inject = ['remote']

export async function apply(ctx: ClientContext): Promise<void> {
  await ctx.remote.$mount(CLIENT_REMOTE)
  ctx.inject(['remote.harnessProjects', 'slots'], (child) => {
    void child.remote.harnessProjects.baseline().then(
      (result) => result.ok ? console.info('[harness-projects] baseline received', result.value) : console.error('[harness-projects] baseline failed', result.error),
      (error) => console.error('[harness-projects] baseline failed', error),
    )
    child.slots.inject('main', () => child.slots.register({ name: 'main', key: PANEL_ID }, PlaceholderPanel))
    child.slots.inject('sidebar.panellist', () =>
      child.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: HARNESS_PANEL_TITLE },
      PlaceholderIcon,
      ),
    )
  })
}
