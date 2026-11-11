/** 受控七日窗口与展示时钟；窗口、查询、权限、路由与唯一详情仍由既有 owner 拥有。 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { derivePlanningTimeline, type VisibleListRow } from '@harness-projects/ui-model'
import { TitleLink } from './item-link.ts'
import type { ItemNavigation } from './work-item-list.ts'

const systemNow = (): Date => new Date()
const calendar = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'})
const todayAt = (now: () => Date): string => {
  const parts = calendar.formatToParts(now())
  return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value.padStart(type === 'year' ? 4 : 2,'0')).join('-')
}
const STYLES = `
.hp-work-items .hp-list-body > .hp-timeline { display:flex; flex-direction:column; flex:1 1 0; min-block-size:9.5rem; min-inline-size:0; container-type:inline-size }
.hp-timeline-toolbar { display:flex; flex-wrap:wrap; gap:0 .5rem; align-items:center }
.hp-timeline button { min-block-size:44px; padding:.5rem .75rem; border:1px solid var(--hp-control-border,CanvasText); border-radius:.375rem; background:var(--hp-surface,Canvas); color:var(--hp-primary,CanvasText); font:inherit; cursor:pointer }
.hp-timeline button:disabled { opacity:.5; cursor:default }
.hp-timeline .hp-timeline-window { margin:0; padding:0; border:0; font-weight:500; font-variant-numeric:tabular-nums; font-size:.857143rem }
.hp-timeline-guide { margin-inline-start:auto; color:var(--hp-secondary,CanvasText); font-size:.857143rem }
.hp-timeline-guide summary { min-block-size:44px; display:flex; align-items:center; cursor:pointer; text-decoration:underline; text-underline-offset:3px }
.hp-timeline-guide[open] { flex-basis:100%; margin:0 }
.hp-timeline-scroll { flex:1 1 0; min-block-size:8rem; min-inline-size:0; overflow:auto; overscroll-behavior:contain; scroll-padding:4px }
.hp-timeline table { width:100%; table-layout:fixed; border-collapse:collapse }
.hp-timeline caption,.hp-timeline .hp-timeline-source { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%) }
.hp-timeline th,.hp-timeline td { height:auto; border-block-end:1px solid var(--hp-border,CanvasText); vertical-align:top }
.hp-timeline thead th { height:auto; padding:.75rem .25rem; text-align:center; color:var(--hp-secondary,CanvasText); font-size:.857143rem; font-weight:500; overflow-wrap:anywhere }
.hp-timeline thead th:first-child { text-align:start; padding-inline:.75rem }
.hp-timeline tbody th { text-align:start; padding:.25rem .75rem; font-weight:400; overflow-wrap:anywhere }
.hp-timeline tbody td { padding:0; position:relative; background:repeating-linear-gradient(to right,var(--hp-border,CanvasText) 0 1px,transparent 1px calc(100% / 7)) }
.hp-timeline .hp-timeline-meta,.hp-timeline .hp-timeline-source { margin:0; font-size:.857143rem; line-height:1.6; color:var(--hp-secondary,CanvasText) }
.hp-timeline .hp-timeline-notes { margin:.25rem 0 0; color:var(--hp-secondary,CanvasText); font-size:.857143rem; line-height:1.6 }
.hp-timeline tbody th a { display:flex; align-items:center; min-block-size:44px; color:var(--hp-primary,CanvasText); font-weight:600; text-decoration:none; overflow-wrap:anywhere }
.hp-timeline [aria-current=true] { text-decoration:underline; text-underline-offset:3px }
.hp-timeline [data-selected=true] { background-color:var(--hp-selected,Canvas) }
.hp-timeline-locate { float:inline-end; margin-inline-start:.5rem; font-size:.857143rem }
.hp-timeline-unplaced { display:block; padding:1.2rem 1rem; color:var(--hp-secondary,CanvasText); font-size:.857143rem; overflow-wrap:anywhere }
.hp-timeline-marker { position:absolute; top:1.75rem; width:9px; height:9px; transform:translate(-50%,-50%) rotate(45deg); background:var(--dsw-alias-link,var(--hp-accent,LinkText)) }
.hp-timeline-date { position:absolute; top:1.05rem; padding-inline:.8rem; font-size:.857143rem; white-space:nowrap; color:var(--hp-secondary,CanvasText) }
.hp-timeline-band { position:absolute; top:3.3rem; height:1.4rem; box-sizing:border-box; border:1px dashed var(--hp-secondary,CanvasText); background:var(--hp-surface,Canvas) }
.hp-timeline-today { position:absolute; inset-block:0; border-inline-start:1px solid var(--dsw-alias-link,var(--hp-accent,LinkText)); pointer-events:none }
.hp-timeline :focus-visible { outline:var(--hp-focus-width,2px) solid var(--hp-focus-color,Highlight); outline-offset:2px }
@container (max-width:40rem) {
  .hp-timeline-window,.hp-timeline-toolbar > button,.hp-timeline-locate,.hp-timeline-notes,.hp-timeline colgroup,.hp-timeline thead,.hp-timeline tbody td { display:none }
  .hp-timeline-guide { margin-inline-start:0 }
  .hp-timeline table,.hp-timeline tbody,.hp-timeline tr,.hp-timeline tbody th { display:block; box-sizing:border-box; width:100% }
  .hp-timeline .hp-timeline-source { position:static; inline-size:auto; block-size:auto; overflow:visible; clip-path:none; margin:.25rem 0 }
}
`

type TimelineEntry = ReturnType<typeof derivePlanningTimeline>['rows'][number]
function TimelineRow({ entry, navigation, todayIndex, onLocate }: { entry:TimelineEntry; navigation:ItemNavigation | undefined; todayIndex:number; onLocate:()=>void }): ReactElement {
  const { item, label, locateOutside, iterationLabel, targetPercent, band } = entry
  const target = item.schedule.target
  const kind = target.kind === 'date' ? '来源目标日' : target.kind === 'invalid' ? '目标日无效' : '未提供任务日期'
  return createElement('tr', { className:'hp-timeline-row', 'data-selected':navigation?.currentItemId === item.key ? true : undefined },
    createElement('th', { scope:'row' },
      createElement('p', { className:'hp-timeline-meta' }, `${item.numberLabel ?? item.identity} · ${kind}`),
      locateOutside ? createElement('button', { type:'button', className:'hp-timeline-locate', onClick:onLocate }, '定位日期') : null,
      navigation ? createElement(TitleLink, { itemId:item.key, title:item.title, navigation }) : item.title,
      createElement('p', { className:'hp-timeline-source' }, label),
      iterationLabel === undefined ? null : createElement('p', { className:'hp-timeline-notes', 'aria-hidden':true }, iterationLabel)),
    createElement('td', { colSpan:7, 'aria-hidden':true },
      targetPercent !== undefined ? null : createElement('span', { className:'hp-timeline-unplaced' }, target.kind === 'date' ? `来源目标日：${target.date}（窗口外）` : target.kind === 'invalid' ? '来源目标日无效' : '未排期 · 不推测起止日期'),
      todayIndex < 0 ? null : createElement('span', { className:'hp-timeline-today', style:{ left:`${100 * (todayIndex + .5) / 7}%` } }),
      targetPercent === undefined ? null : createElement('span', { className:'hp-timeline-marker', style:{ left:`${targetPercent}%` } }),
      targetPercent === undefined ? null : createElement('span', { className:'hp-timeline-date',
        style:targetPercent > 70 ? { right:`${100 - targetPercent}%` } : { left:`${targetPercent}%` } }, item.targetDate),
      band === undefined ? null : createElement('span', { className:'hp-timeline-band', style:{ left:`${band.left}%`, width:`${band.width}%` } })))
}

export type TimelineWindow = { readonly anchorDate:string | undefined; readonly onAnchorChange:(date:string | undefined, origin?:string)=>void }
export function WorkItemTimeline({rows,navigation,anchorDate,onAnchorChange,now=systemNow}: TimelineWindow & {rows:readonly VisibleListRow[];navigation?:ItemNavigation|undefined;now?:()=>Date}): ReactElement {
  const [today,setToday] = useState(() => todayAt(now))
  useEffect(() => {
    setToday(todayAt(now))
    const timer = setInterval(() => setToday(todayAt(now)),60000)
    return () => clearInterval(timer)
  },[now])
  const view = derivePlanningTimeline(rows,anchorDate ?? today)
  const todayIndex = view.days.findIndex(day => day.date === today)
  return createElement('section',{className:'hp-timeline','aria-label':'来源日期时间线'},
    createElement('style',null,STYLES),
    createElement('div',{className:'hp-timeline-scroll',role:'region','aria-label':'来源日期，可纵向滚动',tabIndex:0},
    createElement('div',{className:'hp-timeline-toolbar'},
      createElement('span',{className:'hp-timeline-window',role:'status','aria-live':'polite'},`${view.days[0]?.date} → ${view.days.findLast(day => day.date !== undefined)?.date}`),
      createElement('button',{type:'button',disabled:view.previousDate===undefined,onClick:()=>onAnchorChange(view.previousDate)},'前一周'),
      createElement('button',{type:'button',onClick:()=>onAnchorChange(undefined)},'本周'),
      createElement('button',{type:'button',disabled:view.nextDate===undefined,onClick:()=>onAnchorChange(view.nextDate)},'后一周'),
      createElement('details',{className:'hp-timeline-guide'},createElement('summary',{className:'hp-timeline-calendar'},`今天 ${today} · Asia/Singapore · 日期说明`),
        createElement('p',null,'◆ 来源目标日；虚线为所属迭代窗口，不表示任务工期。窄区显示完整来源日期文字。'))),
      createElement('table',null,
        createElement('caption',null,`来源日期时间线。Asia/Singapore，今天 ${today}。菱形为来源目标日；虚线为所属迭代窗口，不表示任务工期。`),
        createElement('colgroup',null,createElement('col',{style:{width:'30%'}}),createElement('col',{span:7,style:{width:'10%'}})),
        createElement('thead',null,createElement('tr',null,createElement('th',{scope:'col'},'工作项 / 来源日期'),...view.days.map((day,index)=>createElement('th',{key:index,scope:'col'},day.date?.slice(5).replace('-','/') ?? '—')))),
        createElement('tbody',null,...view.rows.map(entry=>createElement(TimelineRow, {
          key:entry.item.key, entry, navigation, todayIndex, onLocate:()=>onAnchorChange(entry.locateDate,entry.item.key),
        }))))))
}
