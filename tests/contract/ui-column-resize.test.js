import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampColumnWidth, resolveColumnWidths, widthForKey } from '../../packages/ui/src/column-resize.ts'
import { TABLE_COLUMNS } from '../../packages/ui/src/table-columns.ts'

// Wrong clamp direction, lost finite-value fallback, or a key step outside the shared bounds fails here.
test('column width input and keyboard share finite min/default/max bounds',()=>{
  const identity=TABLE_COLUMNS[1]
  for(const [value,want] of [[-1,96],[96,96],[104,104],[999,240],[NaN,104],[Infinity,104]]) assert.equal(clampColumnWidth(identity,value),want)
  for(const [key,shift,want] of [['ArrowLeft',false,96],['ArrowRight',false,112],['ArrowRight',true,136],['Home',false,96],['End',false,240],['Enter',false,undefined]]) assert.equal(widthForKey(identity,104,key,shift),want)
  for(const column of TABLE_COLUMNS) {
    assert.equal(widthForKey(column,column.minWidth,'ArrowLeft'),column.minWidth)
    assert.equal(widthForKey(column,column.maxWidth,'ArrowRight',true),column.maxWidth)
  }
})

test('auto widths fill available space and manual requests preserve values under transient title caps', () => {
  const columns=TABLE_COLUMNS.filter(column=>!['identity','source','freshness'].includes(column.id))
  for (const available of [1152,1392]) {
    const result=resolveColumnWidths(columns,{},available)
    assert.ok(Math.abs(Object.values(result.widths).reduce((sum,width)=>sum+width,0)-available)<.01)
    for (const column of columns) assert.ok(result.widths[column.id]>=result.bounds[column.id].minWidth&&result.widths[column.id]<=result.bounds[column.id].maxWidth)
  }
  const requested={title:640,planningStatus:200},narrow=resolveColumnWidths(columns,requested,294),wide=resolveColumnWidths(columns,requested,1392)
  assert.equal(narrow.widths.title,180)
  assert.equal(narrow.bounds.title.maxWidth,180)
  assert.equal(wide.widths.title,640)
  assert.equal(wide.widths.planningStatus,200)
  assert.deepEqual(requested,{title:640,planningStatus:200})
})
