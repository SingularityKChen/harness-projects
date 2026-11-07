/** 受控局部查询工具栏。父组件持有 scope 与条件；此处不保留任何字段副本。 */
import { createElement, type ReactElement } from 'react'
import { defaultLocalTableConditions, type LocalTableConditions, type LocalTableResult, type LocalTableSort } from '@harness-projects/ui-model'
import { TABLE_COLUMNS } from './table-columns.ts'

export type TableControlsProps = { readonly result: LocalTableResult; readonly onChange: (conditions: LocalTableConditions) => void }
const SORT_LABELS = { title:'工作项', planningStatus:'规划状态', iteration:'迭代', targetDate:'目标日期' } as const
const labelOf = (value: string): string => value === '' || value === '—' ? '未提供/显示为空' : value
const STYLES = `
.hp-table-controls { display:flex; flex-wrap:wrap; gap:.5rem 1rem; align-items:center; padding:.5rem 0; font:inherit }
.hp-table-controls label { display:inline-flex; align-items:center; gap:.35rem; max-width:100% }
.hp-table-controls input, .hp-table-controls select, .hp-table-controls button { font:inherit; color:inherit; background:var(--hp-surface,Canvas); border:1px solid var(--hp-border,currentColor); border-radius:.25rem; padding:.3rem; max-width:100%; box-sizing:border-box }
.hp-table-controls input[type=search] { width:14rem; min-width:0 }
.hp-table-controls select { min-width:0; width:12rem }
.hp-table-controls details { max-width:100% }
.hp-table-controls summary { cursor:pointer }
.hp-table-controls fieldset { display:flex; flex-wrap:wrap; gap:.5rem; margin:.4rem 0; border:1px solid var(--hp-border,currentColor) }
.hp-table-controls .hp-query-summary { flex-basis:100%; margin:.2rem 0; overflow-wrap:anywhere }
.hp-table-controls :focus-visible { outline:var(--hp-focus-width,var(--dsw-focus-ring-width,2px)) solid var(--hp-focus-color,var(--dsw-focus-ring-color,currentColor)); outline-offset:2px }
`

export function TableControls({ result, onChange }: TableControlsProps): ReactElement {
  const { conditions, facets } = result
  const update = (patch: Partial<LocalTableConditions>): void => onChange({ ...conditions,...patch })
  const facet = (field: 'planningStatus' | 'iteration', label: string): ReactElement => createElement('label', null, label,
    createElement('select', { 'aria-label':`${label}筛选`, value:conditions[field] === null ? 'all' : `value:${conditions[field]}`,
      onChange:(event: { target: { value: string } }) => update({ [field]:event.target.value === 'all' ? null : event.target.value.slice(6) }) },
    createElement('option', { value:'all' }, '全部'), ...facets[field].map(value => createElement('option', { key:value,value:`value:${value}` }, labelOf(value)))))
  const sortDescription = conditions.sort ? `${SORT_LABELS[conditions.sort.column]}${conditions.sort.direction === 'asc' ? '升序' : '降序'}` : '默认输入顺序'
  return createElement('div', { className:'hp-table-controls', role:'group', 'aria-label':'当前已加载可读条目的局部查询' },
    createElement('style', null, STYLES),
    createElement('label', null, '搜索标题或编号', createElement('input', { type:'search', 'aria-label':'搜索标题或编号', placeholder:'搜索标题或编号', value:conditions.search,
      onChange:(event: { target: { value: string } }) => update({ search:event.target.value }) })),
    facet('planningStatus','规划状态'), facet('iteration','迭代'),
    createElement('label', null, '排序', createElement('select', { 'aria-label':'排序',value:conditions.sort ? `${conditions.sort.column}:${conditions.sort.direction}` : '',
      onChange:(event: { target: { value: string } }) => {
        const [column,direction] = event.target.value.split(':')
        update({ sort:column ? { column,direction } as LocalTableSort : null })
      } }, createElement('option', { value:'' }, '默认输入顺序'),
    ...Object.entries(SORT_LABELS).flatMap(([column,label]) => (['asc','desc'] as const).map(direction => createElement('option', { key:`${column}:${direction}`,value:`${column}:${direction}` }, `${label}${direction === 'asc' ? '升序' : '降序'}`))))),
    createElement('details', null, createElement('summary', null, '选择显示列'),
      createElement('fieldset', null, createElement('legend', null, '显示列'), ...TABLE_COLUMNS.map(column => createElement('label', { key:column.id },
        createElement('input', { type:'checkbox', disabled:!column.optional, checked:conditions.visibleColumns.includes(column.id),
          onChange:(event: { target: { checked: boolean } }) => update({ visibleColumns:event.target.checked ? [...conditions.visibleColumns,column.id] : conditions.visibleColumns.filter(id => id !== column.id) }) }),
        column.label + (column.optional ? '' : '（必显）'))))),
    createElement('button', { type:'button',onClick:() => onChange(defaultLocalTableConditions()) }, '清除条件并恢复默认显示列'),
    createElement('p', { className:'hp-query-summary' }, `当前条件：${conditions.search.trim() ? `匹配“${conditions.search}”` : '标题与编号不限'}；规划状态：${conditions.planningStatus === null ? '全部' : labelOf(conditions.planningStatus)}；迭代：${conditions.iteration === null ? '全部' : labelOf(conditions.iteration)}；排序：${sortDescription}`),
    createElement('p', { className:'hp-query-summary',role:'status','aria-live':'polite','aria-atomic':true },
      `当前已加载可读条目：显示 ${result.matchedReadableCount} 项，共 ${result.loadedReadableCount} 项。`,
      result.conditionsAdjusted ? '部分筛选条件已不可用，已清除。' : ''),
    result.hasQuery && result.loadedReadableCount > 0 && result.matchedReadableCount === 0 ? createElement('p', { className:'hp-query-summary' }, '当前已加载可读条目没有匹配项，请调整或清除条件。') : null)
}
