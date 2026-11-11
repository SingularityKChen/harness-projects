/** 七日来源日期轴：只消费安全查询行，图形裁剪不丢弃窗口外条目。0001-01-01 是周一。 */
import { calendarDateToDay, calendarDayToDate } from '@harness-projects/domain/values'
import type { VisibleListRow } from './work-item-list-view.ts'

const LAST_DAY = calendarDateToDay('9999-12-31')!
export function derivePlanningTimeline(rows: readonly VisibleListRow[], anchorDate: string) {
  const anchor = calendarDateToDay(anchorDate) ?? 0
  const start = anchor - anchor % 7, end = start + 7
  const inside = (day: number): boolean => day >= start && day < end
  return {
    days: Array.from({ length:7 }, (_, index) => ({ date:calendarDayToDate(start + index) })),
    previousDate: calendarDayToDate(start - 7), nextDate: calendarDayToDate(start + 7),
    rows: rows.flatMap(item => {
      if (item.kind !== 'item') return []
      const { target, iteration } = item.schedule
      const targetText = target.kind === 'date' ? `来源目标日：${target.date}${inside(target.day) ? '' : '（窗口外）'}`
        : target.kind === 'invalid' ? '来源目标日无效' : '未提供目标日，不推测起止日期'
      const window = iteration.kind === 'window' || iteration.kind === 'zero' ? iteration : undefined
      const outside = window && (window.kind === 'zero' ? !inside(window.startDay) : window.endDayExclusive <= start || window.startDay >= end)
      const iterationText = window ? `所属迭代：${window.title} · ${window.startDate} → ${window.kind === 'zero' ? '0 天，无结束日' : window.endDate}${outside ? '（窗口外）' : ''}`
        : iteration.kind === 'invalid' ? '迭代窗口无效' : '未提供迭代窗口'
      const left = window ? Math.max(window.startDay, start) : 0, right = window ? Math.min(window.endDayExclusive, end, LAST_DAY + 1) : 0
      return [{ item, label:`${targetText}；${iterationText}`,
        locateDate:target.kind === 'date' ? target.date : window?.startDate,
        locateOutside:target.kind === 'date' ? !inside(target.day) : window !== undefined && !inside(window.startDay),
        iterationLabel:iteration.kind === 'missing' ? undefined : iterationText,
        targetPercent:target.kind === 'date' && inside(target.day) ? 100 * (target.day - start + .5) / 7 : undefined,
        band:window?.kind === 'window' && right > left ? {left:100 * (left - start) / 7,width:100 * (right - left) / 7} : undefined,
      }]
    }),
  }
}
