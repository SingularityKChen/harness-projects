/**
 * 列表读取状态的共享展示组件（issue #129）：只接收 ui-model 已算好的安全文字，不读 store、时钟、capability 或 transport，
 * 也没有动作、链接或事件处理器。状态一律用文字表达（颜色与图标至多是装饰）；时间用原样 ISO 文字加同值 dateTime。
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'

const SKELETON_BAR = { height: '1rem', margin: '0.5rem 0', background: 'currentColor', opacity: 0.12 } as const

/** 首次读取：静态装饰 skeleton（aria-hidden）。它不是 empty，也没有任何业务行；文字说明由页面的状态区给出。 */
export function LoadingState(): ReactElement {
  return createElement('div', { 'aria-hidden': true }, ...[0, 1, 2].map((index) => createElement('div', { key: index, style: SKELETON_BAR })))
}

/** `confirmed` 才是真 empty；陈旧或刷新中的 0 行只能说"最后已知的快照"，不称当前结果已确认。 */
export function EmptyState({ confirmed }: { confirmed: boolean }): ReactElement {
  return createElement('p', null, confirmed ? '当前快照没有工作项' : '最后已知的快照没有工作项，当前结果尚未确认')
}

export function UnavailableState({ message, remaining }: { message: string; remaining: string }): ReactElement {
  return createElement('div', null, createElement('p', null, message), createElement('p', null, remaining))
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
  return createElement('div', null, createElement('p', null, '来源：', createElement(SourceBadge, { name: source }), '；', createElement(FreshnessBadge, { stale: true, at })))
}
