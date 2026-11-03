import { createElement as h } from 'react'
import type { ReactElement } from 'react'
/** 只格式化已有观察；不以浏览器时钟填补事实。目标日期不使用此组件。 */
export function ObservedTime({ at, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: { at: string; timeZone?: string }): ReactElement {
  const value = new Date(at)
  if (!Number.isFinite(value.getTime())) return h('span', null, '时间未知')
  const text = new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(value)
  return h('time', { dateTime: at }, `${text} ${timeZone}`)
}
