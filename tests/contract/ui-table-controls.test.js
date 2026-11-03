import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { queryVisibleWorkItems } from '@harness-projects/ui-model'
import * as controls from '../../packages/ui/src/table-controls.ts'
const require=createRequire(new URL('../../packages/ui/package.json',import.meta.url))
const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const rows=[{kind:'item',key:'opaque',title:'Visible',planningStatus:'进行中',iteration:'—',targetDate:'—',identity:'Issue',engineering:'无',source:'源',authority:'提供方权威',stale:false},{kind:'redacted',key:'private-key'}]
const render=result=>renderToStaticMarkup(createElement(controls.TableControls,{result,onChange:()=>{}}))

test('受控工具栏显示当前条件、可读计数、原生筛选与必显标题；无匹配不冒充源为空',()=>{
  const html=render(queryVisibleWorkItems(rows,{search:'missing',planningStatus:'进行中',sort:{column:'title',direction:'desc'}}))
  assert.match(html,/当前已加载可读条目：显示 0 项，共 1 项/)
  assert.match(html,/当前条件：标题包含“missing”；规划状态：进行中；迭代：全部；排序：工作项降序/)
  assert.match(html,/<input[^>]+type="search"[^>]+value="missing"/)
  assert.match(html,/<select aria-label="规划状态筛选"/)
  assert.match(html,/<option value="value:进行中" selected="">进行中<\/option>/)
  assert.match(html,/<option value="value:—">未提供\/显示为空<\/option>/)
  assert.match(html,/<fieldset><legend>显示列<\/legend>/)
  assert.match(html,/type="checkbox" disabled="" checked=""\/>工作项（必显）/)
  assert.match(html,/当前已加载可读条目没有匹配项/)
  assert.doesNotMatch(html,/当前快照没有工作项|private-key|opaque/)
})

test('撤权归一后首个静态 render 不携带旧 facet 文字；空或未知来源不显示无匹配结论',()=>{
  const html=render(queryVisibleWorkItems(rows,{planningStatus:'撤权状态',iteration:'撤权迭代'}))
  assert.doesNotMatch(html,/撤权状态|撤权迭代/)
  assert.match(html,/部分筛选条件已不可用，已清除/)
  assert.match(html,/清除条件并恢复默认显示列/)
  assert.doesNotMatch(render(queryVisibleWorkItems([])),/没有匹配项|当前快照没有工作项/)
})
