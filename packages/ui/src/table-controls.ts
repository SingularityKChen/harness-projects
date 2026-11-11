/** 受控局部查询工具栏。父组件持有 scope 与条件；此处不保留任何字段副本。 */
import { createElement, type ReactElement } from 'react'
import { defaultLocalTableConditions, type LocalTableConditions, type LocalTableResult, type LocalTableSort } from '@harness-projects/ui-model'
import { TABLE_COLUMNS } from './table-columns.ts'

export type TableControlsProps = { readonly presentation?: 'table' | 'board'; readonly result: LocalTableResult; readonly onResetWidths: () => void; readonly readOnly: boolean; readonly onChange: (conditions: LocalTableConditions) => void }
const SORT_LABELS = { title:'工作项', planningStatus:'规划状态', iteration:'迭代', targetDate:'目标日期' } as const
const labelOf = (value: string): string => value === '' || value === '—' ? '未提供/显示为空' : value
const STYLES = `
.hp-table-controls { display:flex; flex-wrap:wrap; gap:0 .5rem; align-items:center; padding:0; font:inherit }
.hp-table-controls :where(details,fieldset,label) { box-sizing:border-box; min-inline-size:0 }
.hp-table-controls details > label { flex-wrap:wrap }
.hp-table-controls label { display:inline-flex; align-items:center; gap:.35rem; max-width:100% }
.hp-table-controls > label { font-size:0 }
.hp-table-controls .hp-search-control { position:relative }
.hp-table-controls .hp-search-purpose { position:absolute; inset-inline-start:.75rem; inset-block-start:50%; transform:translateY(-50%); font-size:1rem; white-space:nowrap; color:var(--hp-secondary,CanvasText); pointer-events:none }
.hp-table-controls .hp-search-control input { padding-inline-start:3.5rem }
.hp-table-controls input, .hp-table-controls select, .hp-table-controls button { min-height:44px; font:inherit; color:var(--hp-primary,CanvasText); background:var(--hp-surface,Canvas); border:1px solid var(--hp-control-border,CanvasText); border-radius:.375rem; padding:.5rem .75rem; max-width:100%; box-sizing:border-box }
.hp-table-controls > label input, .hp-table-controls > label select { font-size:1rem }
.hp-table-controls input[type=search] { width:18.428571rem; min-width:0 }
.hp-table-controls select { min-width:0; width:12rem }
.hp-table-controls details { margin-inline-start:auto; max-width:100%; position:relative }
.hp-table-controls summary { cursor:pointer; min-height:44px; display:flex; align-items:center; padding-inline:.75rem; text-decoration:underline; text-underline-offset:3px; text-decoration-color:var(--dsw-alias-link,currentColor) }
.hp-table-controls details[open] { flex-basis:100%; padding:.75rem; background:var(--hp-surface,Canvas); border:1px solid var(--hp-border-strong,CanvasText) }
.hp-table-controls details[open] summary { padding:0 }
.hp-table-controls fieldset { display:flex; flex-wrap:wrap; gap:.5rem; margin:.4rem 0; border:1px solid var(--hp-border,CanvasText) }
.hp-table-controls .hp-query-summary { flex-basis:100%; margin:0; color:var(--hp-secondary,CanvasText); font-size:.857143rem; line-height:1.833333; overflow-wrap:anywhere }
.hp-table-controls > [role=status] { padding:0; margin:0; border:0 }
.hp-table-controls :focus-visible { outline:var(--hp-focus-width,var(--dsw-focus-ring-width,2px)) solid var(--hp-focus-color,var(--dsw-focus-ring-color,CanvasText)); outline-offset:2px }
`

export function TableControls({ result, onChange, onResetWidths, readOnly, presentation = 'table' }: TableControlsProps): ReactElement {
  const { conditions, facets } = result
  const update = (patch: Partial<LocalTableConditions>): void => onChange({ ...conditions,...patch })
  const facet = (field: 'planningStatus' | 'iteration', label: string): ReactElement => createElement('label', null, label,
    createElement('select', { 'aria-label':`${label}筛选`, value:conditions[field] === null ? 'all' : `value:${conditions[field]}`,
      onChange:(event: { target: { value: string } }) => update({ [field]:event.target.value === 'all' ? null : event.target.value.slice(6) }) },
    createElement('option', { value:'all' }, `${label} · 全部`), ...facets[field].map(value => createElement('option', { key:value,value:`value:${value}` }, `${label} · ${labelOf(value)}`))))
  const listOnlySort = presentation === 'board' && conditions.sort?.column === 'planningStatus'
  const sortDescription = conditions.sort ? `${SORT_LABELS[conditions.sort.column]}${conditions.sort.direction === 'asc' ? '升序' : '降序'}` : '默认输入顺序'
  return createElement('div', { className:'hp-table-controls', role:'group', 'aria-label':'当前已加载可读条目的局部查询' },
    createElement('style', null, STYLES),
    createElement('label', { className:'hp-search-control' }, createElement('span', { className:'hp-search-purpose' }, '搜索'), createElement('input', { type:'search', 'aria-label':'搜索标题或编号', placeholder:'标题或编号', value:conditions.search,
      onChange:(event: { target: { value: string } }) => update({ search:event.target.value }) })),
    facet('planningStatus','规划状态'), facet('iteration','迭代'),
    createElement('details', { onToggle:(event: { currentTarget: { open: boolean; contains(node: unknown): boolean; querySelector(selector: string): { focus(): void } | null } }) => {
      const menu = event.currentTarget, active = (globalThis as { document?: { activeElement?: unknown } }).document?.activeElement
      if (!menu.open && menu.contains(active)) menu.querySelector('summary')?.focus()
    } }, createElement('summary', null, '显示选项'),
    createElement('label', null, presentation === 'board' ? '组内卡片排序' : '排序', createElement('select', { 'aria-label':'排序',value:conditions.sort ? `${conditions.sort.column}:${conditions.sort.direction}` : '',
      onChange:(event: { target: { value: string } }) => {
        const [column,direction] = event.target.value.split(':')
        update({ sort:column ? { column,direction } as LocalTableSort : null })
      } }, createElement('option', { value:'' }, '默认输入顺序'),
    listOnlySort ? createElement('option', { value:`planningStatus:${conditions.sort!.direction}`, disabled:true }, `保留列表${sortDescription}；规范列序固定`) : null,
    ...Object.entries(SORT_LABELS).filter(([column]) => presentation !== 'board' || column !== 'planningStatus').flatMap(([column,label]) => (['asc','desc'] as const).map(direction => createElement('option', { key:`${column}:${direction}`,value:`${column}:${direction}` }, `${label}${direction === 'asc' ? '升序' : '降序'}`))))),
      presentation === 'board' ? null : createElement('fieldset', null, createElement('legend', null, '显示列'), ...TABLE_COLUMNS.map(column => createElement('label', { key:column.id },
        createElement('input', { type:'checkbox', disabled:!column.optional, checked:conditions.visibleColumns.includes(column.id),
          onChange:(event: { target: { checked: boolean } }) => update({ visibleColumns:event.target.checked ? [...conditions.visibleColumns,column.id] : conditions.visibleColumns.filter(id => id !== column.id) }) }),
        column.label + (column.optional ? '' : '（必显）')))),
    createElement('button', { type:'button',onClick:() => onChange({ ...defaultLocalTableConditions(), ...(presentation === 'board' ? { visibleColumns:conditions.visibleColumns } : {}) }) }, presentation === 'board' ? '清除条件' : '清除条件并恢复默认显示列'),
    presentation === 'board' ? null : createElement('button', { type:'button', onClick:onResetWidths }, '重置列宽'),
    presentation === 'board' ? null : createElement('p', null, '拖动列边界，或聚焦边界后用方向键调整。'),
    createElement('p', { className:'hp-query-summary' }, `当前条件：${conditions.search.trim() ? `匹配“${conditions.search}”` : '标题与编号不限'}；规划状态：${conditions.planningStatus === null ? '全部' : labelOf(conditions.planningStatus)}；迭代：${conditions.iteration === null ? '全部' : labelOf(conditions.iteration)}；${presentation === 'board' ? '组内卡片排序' : '排序'}：${listOnlySort ? '保留列表' : ''}${sortDescription}${presentation === 'board' ? '；看板列按固定规划状态顺序' : ''}`)),
    createElement('p', { className:'hp-query-summary',role:'status','aria-live':'polite','aria-atomic':true },
      `当前已加载可读条目：显示 ${result.matchedReadableCount} 项，共 ${result.loadedReadableCount} 项。${readOnly ? ' 只读规划。' : ''}`,
      result.conditionsAdjusted ? '部分筛选条件已不可用，已清除。' : ''),
    result.hasQuery && result.loadedReadableCount > 0 && result.matchedReadableCount === 0 ? createElement('p', { className:'hp-query-summary' }, '当前已加载可读条目没有匹配项，请调整或清除条件。') : null)
}
