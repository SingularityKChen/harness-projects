/** 语义 table 的唯一本地 XY scroll owner；固定层使用不透明系统画布继承明暗。 */
import { TABLE_COLUMNS } from './table-columns.ts'

export const TABLE_STYLES = `
/* 200%文字时同时容纳固定表头、三行焦点标题与传统滚动条；短Host由setup纵向抵达。 */
.hp-workspace-body:has(.hp-work-items) { display:flex; flex-direction:column; min-block-size:16.5rem; overflow:hidden }
.hp-workspace-body:has(.hp-work-items) > div:not([hidden]),
.hp-workspace:has(> .hp-project), .hp-project:has(.hp-work-items), .hp-project-list:has(.hp-work-items) {
  display:flex; flex-direction:column; flex:1 1 0; min-block-size:0; min-height:0; max-block-size:100%; overflow:hidden;
}
.hp-workspace:has(> .hp-project) > .hp-project { padding:0 }
.hp-work-items { display:flex; flex-direction:column; flex:1 1 0; min-block-size:0; max-block-size:100%; container-type:inline-size }
.hp-work-items .hp-list-context { flex:0 1 auto; min-block-size:3rem; max-block-size:50%; overflow:auto }
.hp-work-items .hp-list-body { display:flex; flex-direction:column; flex:1 0 9.5rem; min-block-size:9.5rem }
.hp-work-items .hp-list-body:has(> .hp-delivery-overview) { flex:1 1 0; overflow:auto; overscroll-behavior:contain }
.hp-work-items .hp-list-body > :not(.hp-list-scroll) { flex:none }
.hp-work-items .hp-list-scroll {
  --hp-title-width:var(--hp-column-title,${TABLE_COLUMNS[0].defaultWidth}px);
  box-sizing:border-box; flex:1 1 0; min-block-size:9.5rem; min-width:0; max-width:100%; overflow:auto;
  border:0; border-radius:0;
  scroll-padding-block-start:3.6rem; scroll-padding-inline-start:calc(var(--hp-title-width) + 1rem);
}
.hp-work-items table { border-collapse:separate; border-spacing:0; table-layout:fixed; font:inherit }
.hp-work-items caption { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%) }
.hp-work-items th, .hp-work-items td { box-sizing:border-box; padding:.607143rem min(1.142857rem,16px); height:58px; text-align:left; vertical-align:top; border-top:1px solid var(--hp-border,currentColor); overflow-wrap:anywhere; white-space:normal }
.hp-work-items thead th { padding-inline-end:28px; height:44px; position:sticky; top:0; z-index:2; background:var(--hp-base,Canvas); border-top:0; box-shadow:inset 0 -1px var(--hp-border,currentColor); padding-block:0; padding-inline-start:min(1.142857rem,16px); font-size:.857143rem; color:var(--hp-secondary,CanvasText); font-weight:600 }
.hp-work-items tbody th { position:sticky; inset-inline-start:0; z-index:1; background:var(--hp-base,Canvas); font-weight:500 }
.hp-work-items thead th:first-child { inset-inline-start:0; z-index:3 }
.hp-work-items .hp-list-title-text, .hp-work-items tbody th > a { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; overflow-wrap:anywhere }
.hp-work-items tbody th > a { text-decoration:none }
.hp-work-items tbody th > a:hover, .hp-work-items tbody th > a:focus-visible { text-decoration:underline; text-decoration-color:var(--dsw-alias-link,currentColor) }
.hp-work-items tbody th > a:focus, .hp-work-items details[open] > .hp-list-title-text { display:block; overflow:visible; -webkit-line-clamp:unset }
.hp-work-items summary { cursor:pointer }
.hp-work-items a, .hp-work-items summary { scroll-margin-block:0; outline-offset:-2px }
.hp-work-items td { color:var(--hp-secondary,CanvasText); font-size:1rem; line-height:1.57143 }
.hp-work-items .hp-list-number { display:block; color:var(--hp-secondary,CanvasText); font-size:.857143rem; font-weight:400; line-height:1.5 }
.hp-work-items .hp-planning-status { display:flex; align-items:baseline; gap:.5rem }
.hp-work-items .hp-status-dot { display:inline-block; flex:none; inline-size:.5rem; block-size:.5rem; border:1px solid currentColor; border-radius:50% }
.hp-work-items .hp-status-done { border-color:var(--dsw-alias-state-success-primary,currentColor); background:var(--dsw-alias-state-success-primary,currentColor) }
.hp-work-items tbody tr:hover > * { background:var(--hp-hover,Canvas) }
.hp-work-items tbody tr:has(a[aria-current=true]) > * { background:var(--hp-selected,Canvas) }
.hp-work-items tbody tr:has(a[aria-current=true]) > th { box-shadow:inset 2px 0 var(--hp-secondary,CanvasText) }
.hp-work-items .hp-column-sort { display:block; min-block-size:44px; max-width:100%; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:inherit; text-align:start; white-space:normal; overflow-wrap:anywhere; cursor:pointer }
.hp-work-items .hp-column-resize { position:absolute; inset-block:0; inset-inline-end:0; inline-size:24px; min-block-size:44px; display:grid; place-items:center; cursor:col-resize; touch-action:none }
.hp-work-items .hp-column-resize::after { content:''; block-size:1.5rem; border-inline-end:2px solid var(--hp-border,currentColor) }
.hp-work-items .hp-column-resize:focus-visible { outline-offset:-3px }
.hp-work-items .hp-list-scroll:has(.hp-resizing) { user-select:none; cursor:col-resize }
`
