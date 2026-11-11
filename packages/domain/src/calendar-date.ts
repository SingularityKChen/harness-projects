/** Gregorian date-only 运算：0001–9999，0001-01-01 为第 0 天；不借 Instant 或运行环境时区。 */
const leap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
const beforeYear = (year: number): number => {
  const previous = year - 1
  return previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400)
}
const monthDays = (year: number): readonly number[] => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const LIMIT = beforeYear(10000)

export function calendarDateToDay(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const months = monthDays(year)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (months[month - 1] ?? 0)) return undefined
  return beforeYear(year) + months.slice(0, month - 1).reduce((sum, count) => sum + count, 0) + day - 1
}

export function calendarDayToDate(day: number): string | undefined {
  if (!Number.isInteger(day) || day < 0 || day >= LIMIT) return undefined
  let low = 1, high = 10000
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (beforeYear(middle) <= day) low = middle; else high = middle
  }
  let remaining = day - beforeYear(low), month = 1
  for (const count of monthDays(low)) {
    if (remaining < count) break
    remaining -= count; month += 1
  }
  return `${String(low).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(remaining + 1).padStart(2, '0')}`
}

export type CalendarIterationWindow = {
  readonly startDate: string; readonly startDay: number; readonly endDayExclusive: number
} & ({ readonly durationDays: 0; readonly endDate?: never } | { readonly durationDays: number; readonly endDate: string })

/** 半开窗口的右端可到 10000 年边界，但可显示末日必须仍在 9999 年内；零天没有末日。 */
export function calendarIterationWindow(startDate: unknown, durationDays: unknown): CalendarIterationWindow | undefined {
  const startDay = calendarDateToDay(startDate)
  if (startDay === undefined || typeof durationDays !== 'number' || !Number.isSafeInteger(durationDays) || durationDays < 0 || durationDays > LIMIT - startDay) return undefined
  const base = { startDate: startDate as string, startDay, endDayExclusive: startDay + durationDays }
  if (durationDays === 0) return { ...base, durationDays: 0 }
  return { ...base, durationDays, endDate: calendarDayToDate(startDay + durationDays - 1)! }
}
