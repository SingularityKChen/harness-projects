/**
 * 列表读取状态的共享展示组件（issue #129）：只接收 ui-model 已算好的安全文字，不读 store、时钟、capability 或 transport，
 * 也没有动作、链接或事件处理器。状态一律用文字表达（颜色与图标至多是装饰）；时间用原样 ISO 文字加同值 dateTime。
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'

/** 局部样式只继承 Host 字体/前景/背景；焦点消费公开主题 token，无主题状态或额外导入。 */
export const LIST_STYLES = `
.hp-work-items { box-sizing:border-box; min-width:0; max-width:100%; color:inherit; font:inherit; line-height:1.5 }
.hp-work-items h2 { margin:0 0 12px; font-size:1.5em; line-height:1.3; font-weight:650 }
.hp-work-items p { margin:8px 0; overflow-wrap:anywhere }
.hp-work-items .hp-list-meta { font-size:.93em; opacity:.8 }
.hp-work-items [role=status] { margin:20px 0 12px; font-weight:600 }
.hp-list-scroll { box-sizing:border-box; min-width:0; max-width:100%; overflow-x:auto; border:1px solid #888; border-color:color-mix(in srgb,currentColor 18%,transparent); border-radius:8px }
.hp-list-scroll table { width:100%; min-width:76rem; border-collapse:collapse; table-layout:auto; font:inherit }
.hp-list-scroll caption { padding:12px 14px; text-align:left; font-size:.93em; font-weight:600 }
.hp-list-scroll th, .hp-list-scroll td { padding:12px 14px; text-align:left; vertical-align:top; border-top:1px solid #888; border-color:color-mix(in srgb,currentColor 16%,transparent) }
.hp-list-scroll thead th { font-size:.93em; font-weight:600; white-space:nowrap; background:color-mix(in srgb,currentColor 5%,transparent) }
.hp-list-scroll tbody th { font-weight:600 }
.hp-list-scroll td { white-space:nowrap }
.hp-list-scroll .hp-list-wrap { white-space:normal; overflow-wrap:anywhere }
.hp-list-scroll a { color:inherit; text-underline-offset:3px; text-decoration-thickness:1px }
.hp-list-scroll a:hover { text-decoration-thickness:2px }
.hp-work-items :focus-visible { outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4176e6)); outline-offset:3px }
.hp-list-scroll:focus-visible { outline-offset:2px }
.hp-list-state { padding:14px; border-inline-start:3px solid currentColor; background:color-mix(in srgb,currentColor 5%,transparent) }
.hp-list-scroll td:last-child { font-size:.93em }
`

const SKELETON_BAR = { height: '1rem', margin: '0.5rem 0', background: 'currentColor', opacity: 0.12 } as const

/** 首次读取：静态装饰 skeleton（aria-hidden）。它不是 empty，也没有任何业务行；文字说明由页面的状态区给出。 */
export function LoadingState(): ReactElement {
  return createElement('div', { 'aria-hidden': true }, ...[0, 1, 2].map((index) => createElement('div', { key: index, style: SKELETON_BAR })))
}

/** `confirmed` 才是真 empty；陈旧或刷新中的 0 行只能说"最后已知的快照"，不称当前结果已确认。 */
export function EmptyState({ confirmed }: { confirmed: boolean }): ReactElement {
  return createElement('p', { className: 'hp-list-state' }, confirmed ? '当前快照没有工作项' : '最后已知的快照没有工作项，当前结果尚未确认')
}

export function UnavailableState({ message, remaining }: { message: string; remaining: string }): ReactElement {
  return createElement('div', { className: 'hp-list-state' }, createElement('p', null, message), createElement('p', null, remaining))
}

export function SourceBadge({ name, authority }: { name: string; authority?: string }): ReactElement {
  return createElement('span', null, authority === undefined ? name : `${name}（${authority}）`)
}

/** `at`：省略 = 不显示时间；`null` = Host 从未读到当前值，显示"最后读取时间未知"，不用时钟补事实；字符串 = ISO 时刻。 */
export function FreshnessBadge({ stale, at }: { stale: boolean; at?: string | null }): ReactElement {
  const read = at === undefined ? [] : at === null ? ['（最后读取时间未知）'] : ['（最后读取：', createElement('time', { dateTime: at }, at), '）']
  return createElement('span', null, stale ? '最后已知值' : '当前值', ...read)
}

/** 只带来源与最后读取时间：“当前结果尚未确认”由页面的状态区宣告一次，这里不重复同一句断言。 */
export function StaleBanner({ source, at }: { source: string; at: string | null }): ReactElement {
  return createElement('div', { className: 'hp-list-state' }, createElement('p', null, '来源：', createElement(SourceBadge, { name: source }), '；', createElement(FreshnessBadge, { stale: true, at })))
}
