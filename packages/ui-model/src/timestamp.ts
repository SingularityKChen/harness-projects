/** 契约是 ISO 8601，检查就必须是 ISO 8601：`Date.parse` 还接受 `'2026'` / `'09/24/2026'`。 */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** 本包内部共用；先校验实际月日，避免解析器把不存在的日期自动进位，再校验时间与偏移。不从 index 导出。 */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_8601.test(value) || Number.isNaN(Date.parse(value))) return false
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10))
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= (days[month - 1] ?? 0)
}
