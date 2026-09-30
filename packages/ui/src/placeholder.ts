/**
 * 占位面板与入口图标：#227 的插件安装件只需要一个能被宿主挂进 `main` 插槽的组件。
 *
 * 用 `createElement` 而不是 JSX：仓库测试靠 Node 类型剥离运行，tsconfig 不启用 `jsx`；
 * 业务页面（#229）再决定是否引入 TSX。本文件不读数据、不接受 props、不调用任何平台 API。
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'

/** 入口 label、面板 aria-label 与标题共用这一处。 */
export const HARNESS_PANEL_TITLE = 'Harness Projects' as const

const PLACEHOLDER_DESCRIPTION = '项目交付工作台的占位面板，业务页面在后续版本接入。'

export function PlaceholderPanel(): ReactElement {
  return createElement(
    'section',
    { 'aria-label': HARNESS_PANEL_TITLE, 'data-harness-placeholder': '' },
    createElement('h2', null, HARNESS_PANEL_TITLE),
    createElement('p', null, PLACEHOLDER_DESCRIPTION),
  )
}

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
