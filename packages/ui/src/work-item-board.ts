/** 安全查询结果的只读呈现；不拥有查询、路由、权限或规划状态。 */
import { createElement, type ReactElement } from 'react'
import { derivePlanningBoard, type VisibleListRow } from '@harness-projects/ui-model'
import { NormalizedStatus } from '@harness-projects/domain/values'
import { TitleLink } from './item-link.ts'
import type { ItemNavigation } from './work-item-list.ts'

const STYLES = `
.hp-work-items .hp-list-body > .hp-board-scroll { flex:1 1 0; min-block-size:9.5rem; min-inline-size:0; max-inline-size:100%; overflow:auto; overscroll-behavior:contain; padding:0 0 1rem; scroll-padding:4px }
.hp-board-columns { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(18rem,1fr); gap:16px; min-block-size:100%; align-items:start }
.hp-board-column { min-inline-size:0; background:transparent }
.hp-board-column h3 { display:flex; align-items:center; gap:.5rem; font-size:.857143rem; font-weight:600; line-height:1.833333; color:var(--hp-secondary,CanvasText); margin:0 0 .5rem; padding:.5rem 0; border-block-end:1px solid var(--hp-border,CanvasText) }
.hp-board-count { margin-inline-start:auto }
.hp-board-cards { list-style:none; display:grid; gap:12px; padding:0; margin:0 }
.hp-board-card { display:flex; flex-direction:column; gap:12px; min-inline-size:0; padding:12px; border:1px solid var(--hp-border-strong,CanvasText); border-radius:.5rem; background:var(--hp-surface,Canvas); overflow-wrap:anywhere }
.hp-board-card:hover { background:var(--hp-hover,Canvas) }
.hp-board-card.hp-board-card-selected { background:var(--hp-selected,Canvas); box-shadow:inset 2px 0 var(--hp-secondary,CanvasText) }
.hp-board-card h4 { margin:0; font-size:1rem; line-height:1.57143; font-weight:600 }
.hp-board-card h4 a { display:block }
.hp-board-card .hp-board-meta, .hp-board-card footer { color:var(--hp-secondary,CanvasText); font-size:.857143rem; line-height:1.833333 }
.hp-board-fields { display:flex; flex-wrap:wrap; gap:.25rem .75rem }
.hp-work-items .hp-board-card p { margin:0 }
@container (max-width:40rem) { .hp-board-columns { grid-auto-flow:row; grid-auto-columns:auto; grid-template-columns:minmax(0,1fr); min-block-size:0 } }
`

type BoardItem = Extract<VisibleListRow, { kind:'item' }>
function Card({ item, navigation }: { item:BoardItem; navigation:ItemNavigation | undefined }): ReactElement {
  const selected = navigation?.currentItemId === item.key
  const fields = item.iteration === '—' && item.targetDate === '—' ? null : createElement('div', { className:'hp-board-meta hp-board-fields' },
    item.iteration === '—' ? null : createElement('span', null, item.iteration),
    item.targetDate === '—' ? null : createElement('time', { dateTime:item.targetDate }, item.targetDate))
  return createElement('li', { className:selected ? 'hp-board-card hp-board-card-selected' : 'hp-board-card' },
    createElement('p', { className:'hp-board-meta' }, item.numberLabel ?? `${item.source} · ${item.identity}`),
    createElement('h4', null, navigation ? createElement(TitleLink, { itemId:item.key, title:item.title, navigation }) : item.title),
    fields,
    item.planningStatusKey === NormalizedStatus.Unknown ? createElement('p', { className:'hp-board-meta' }, item.nativePlanningStatus ? `${item.nativePlanningStatus}（未映射）` : '规划状态未知') : null,
    createElement('footer', null, `工程 · ${item.engineering}`, item.stale ? ' · 最后已知值' : ''))
}

export function WorkItemBoard({ rows, navigation }: { rows:readonly VisibleListRow[]; navigation:ItemNavigation | undefined }): ReactElement {
  const groups = derivePlanningBoard(rows)
  if (!groups.length) return createElement('p', { className:'hp-list-state' }, '当前没有可显示的工作项')
  return createElement('div', { role:'region', 'aria-label':'只读规划看板，可横向和纵向滚动', tabIndex:0, className:'hp-board-scroll' },
    createElement('style', null, STYLES),
    createElement('div', { className:'hp-board-columns' }, ...groups.map(group =>
      createElement('section', { key:group.status, className:'hp-board-column', 'aria-label':group.label },
        createElement('h3', null,
          createElement('span', { 'aria-hidden':true, className:group.status === NormalizedStatus.Done ? 'hp-status-dot hp-status-done' : 'hp-status-dot' }),
          group.label,
          createElement('span', { className:'hp-board-count', 'aria-label':`${group.items.length} 项` }, group.items.length)),
        createElement('ul', { className:'hp-board-cards' }, ...group.items.map(item => createElement(Card, { key:item.key, item, navigation })))))))
}
