import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as calendar from '@harness-projects/domain/values'

test('date-only 公历日序数跨闰年与完整年界，时区不改变日历值', () => {
  assert.equal(typeof calendar.calendarDateToDay, 'function')
  const previous = process.env.TZ
  try {
    for (const tz of ['UTC', 'America/Los_Angeles']) {
      process.env.TZ = tz
      for (const [date, day] of [['0001-01-01', 0], ['0001-12-31', 364], ['2000-02-29', 730178], ['2026-03-08', 739682], ['9999-12-31', 3652058]]) {
        assert.equal(calendar.calendarDateToDay(date), day)
        assert.equal(calendar.calendarDayToDate(day), date)
      }
      for (const date of ['0000-01-01', '1900-02-29', '2026-02-29', '2026-04-31', '2026-1-01', '10000-01-01', '2026-01-01T00:00:00Z', null]) assert.equal(calendar.calendarDateToDay(date), undefined)
      for (const day of [-1, 3652059, 0.5, NaN]) assert.equal(calendar.calendarDayToDate(day), undefined)
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('迭代窗口采用半开天边界：零天显式保留，最大年最后一日单天合法，溢出与非安全整数拒绝', () => {
  assert.equal(typeof calendar.calendarIterationWindow, 'function')
  assert.deepEqual(calendar.calendarIterationWindow('2024-02-28', 3), { startDate: '2024-02-28', startDay: 738943, durationDays: 3, endDate: '2024-03-01', endDayExclusive: 738946 })
  assert.deepEqual(calendar.calendarIterationWindow('9999-12-31', 1), { startDate: '9999-12-31', startDay: 3652058, durationDays: 1, endDate: '9999-12-31', endDayExclusive: 3652059 })
  assert.deepEqual(calendar.calendarIterationWindow('0001-01-01', 0), { startDate: '0001-01-01', startDay: 0, durationDays: 0, endDayExclusive: 0 })
  for (const duration of [-1, 1.5, Number.MAX_SAFE_INTEGER, Infinity, '1']) assert.equal(calendar.calendarIterationWindow('9999-12-31', duration), undefined)
  assert.equal(calendar.calendarIterationWindow('9999-12-31', 2), undefined)
  assert.equal(calendar.calendarIterationWindow('2026-02-30', 1), undefined)
})
