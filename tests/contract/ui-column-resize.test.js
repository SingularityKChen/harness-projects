import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampColumnWidth, widthForKey } from '../../packages/ui/src/column-resize.ts'
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
