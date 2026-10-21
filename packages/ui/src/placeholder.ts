/**
 * 面板标题与入口图标：插件安装件（#227）只需要一个能被宿主挂进 `sidebar.panellist` 的图标；`main` 面板自 #229 起是
 * `WorkItemApp`（`work-item-app.ts`）。
 *
 * 用 `createElement` 而不是 JSX：仓库测试靠 Node 类型剥离运行，tsconfig 不启用 `jsx`。本文件不读数据、不接受 props、
 * 不调用任何平台 API。
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'

/** 入口 label、面板 aria-label 与标题共用这一处。 */
export const HARNESS_PANEL_TITLE = 'Harness Projects' as const

export function PlaceholderIcon(): ReactElement {
  return createElement(
    'svg',
    {
      'aria-hidden': true,
      focusable: 'false',
      width: 20,
      height: 20,
      viewBox: '0 0 20 20',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
    },
    createElement('rect', { x: 3, y: 3, width: 14, height: 14, rx: 3 }),
    createElement('path', { d: 'M7 8h6M7 12h4' }),
  )
}
