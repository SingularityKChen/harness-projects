/**
 * 客户端半边：构建成 `window.__ModuleLoader__.load` 包装的 bundle，只导出 `apply` 与 `inject`。
 *
 * 只在根 Context 上读 `slots`（D16）；不读 `remote`。
 */
import { HARNESS_PANEL_TITLE, PlaceholderIcon, PlaceholderPanel } from '@harness-projects/ui'
import type { ClientContext } from './host-surface.ts'

const PANEL_ID = 'harness-projects'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PlaceholderPanel))
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: HARNESS_PANEL_TITLE },
      PlaceholderIcon,
    ),
  )
}
