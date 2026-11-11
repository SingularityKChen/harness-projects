import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as model from '@harness-projects/ui-model'
import { calendarDateToDay, calendarIterationWindow } from '@harness-projects/domain/values'

const row = (key, target, iteration) => ({ kind:'item', key, title:key, targetDate:target ?? '—', iteration:'Sprint', schedule:{ target:target ? { kind:'date',date:target,day:calendarDateToDay(target) } : { kind:'missing' }, iteration:iteration ? {kind:iteration.durationDays ? 'window' : 'zero',title:'Sprint',...iteration} : {kind:'missing'} } })
const derive = (...args) => {
  assert.equal(typeof model.derivePlanningTimeline, 'function', 'safe seven-day source Timeline must be available')
  return model.derivePlanningTimeline(...args)
}

test('Timeline aligns independent source target and clipped iteration to a Monday window without dropping outside rows', () => {
  const input = [row('both','2026-11-11',calendarIterationWindow('2026-11-08',5)),row('far','9999-12-31'),row('none'),{kind:'redacted',key:'SECRET'}]
  const result = derive(input,'2026-11-10')
  assert.deepEqual(result.days.map(day=>day.date),['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'])
  assert.equal(result.rows.length,3)
  assert.equal(result.rows[0].targetPercent,100*2.5/7)
  assert.deepEqual(result.rows[0].band,{left:0,width:100*4/7})
  assert.match(result.rows[0].label,/来源目标日：2026-11-11.*所属迭代：Sprint · 2026-11-08 → 2026-11-12/)
  assert.equal(result.rows[1].targetPercent,undefined)
  assert.equal(result.rows[1].locateDate,'9999-12-31')
  assert.match(result.rows[1].label,/窗口外/)
  assert.match(result.rows[2].label,/未提供目标日.*未提供迭代窗口/)
  assert.doesNotMatch(JSON.stringify(result),/SECRET/)
})

test('Timeline calendar extremes stay seven cells and zero or invalid source values never invent geometry', () => {
  const zero = row('zero',undefined,calendarIterationWindow('0001-01-01',0))
  const invalid = {...row('invalid'),schedule:{target:{kind:'invalid'},iteration:{kind:'invalid'}}}
  const earliest = derive([zero,invalid],'0001-01-01'), latest = derive([row('last','9999-12-31')],'9999-12-31')
  assert.equal(earliest.previousDate,undefined)
  assert.equal(earliest.rows[0].locateDate,'0001-01-01')
  assert.equal(earliest.rows[0].band,undefined)
  assert.match(earliest.rows[0].label,/0 天，无结束日/)
  assert.doesNotMatch(earliest.rows[0].label,/窗口外/)
  assert.match(earliest.rows[1].label,/目标日无效.*迭代窗口无效/)
  assert.equal(latest.nextDate,undefined)
  assert.equal(latest.days.length,7)
  assert.deepEqual(latest.days.map(day=>day.date),['9999-12-27','9999-12-28','9999-12-29','9999-12-30','9999-12-31',undefined,undefined])
  assert.equal(latest.rows[0].targetPercent,100*4.5/7)
})
