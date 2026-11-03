/** 语义 table 的唯一本地 XY scroll owner；固定层使用不透明系统画布继承明暗。 */
import { TABLE_COLUMNS } from './table-columns.ts'

export const TABLE_STYLES = `
/* 200%文字时同时容纳固定表头、三行焦点标题与传统滚动条；短Host由setup纵向抵达。 */
.hp-workspace-body:has(.hp-list-scroll) { display:flex; flex-direction:column; min-block-size:16.5rem; overflow:hidden }
.hp-workspace-body:has(.hp-list-scroll) > div:not([hidden]),
.hp-workspace:has(> .hp-project), .hp-project:has(.hp-list-scroll), .hp-project-list:has(.hp-list-scroll) {
  display:flex; flex-direction:column; flex:1 1 0; min-block-size:0; min-height:0; max-block-size:100%; overflow:hidden;
}
.hp-workspace:has(> .hp-project) > .hp-project { padding:0 }
.hp-work-items { display:flex; flex-direction:column; flex:1 1 0; min-block-size:0; max-block-size:100%; container-type:inline-size }
.hp-work-items .hp-list-context { flex:0 1 auto; min-block-size:3rem; max-block-size:50%; overflow:auto }
.hp-work-items .hp-list-body { display:flex; flex-direction:column; flex:1 0 9.5rem; min-block-size:9.5rem }
.hp-work-items .hp-list-body > :not(.hp-list-scroll) { flex:none }
.hp-work-items .hp-list-scroll {
  --hp-title-width:min(var(--hp-column-title,${TABLE_COLUMNS[0].defaultWidth}px),max(1px,calc(100cqi - 114px)));
  box-sizing:border-box; flex:1 1 0; min-block-size:9.5rem; min-width:0; max-width:100%; overflow:auto;
  border:1px solid var(--hp-border,currentColor); border-radius:var(--hp-radius,.5rem);
  scroll-padding-block-start:3.6rem; scroll-padding-inline-start:calc(var(--hp-title-width) + 1rem);
}
.hp-work-items table { border-collapse:separate; border-spacing:0; table-layout:fixed; font:inherit }
.hp-work-items caption { padding:.75rem 1rem; text-align:left; font-size:.93em; font-weight:600 }
.hp-work-items th, .hp-work-items td { box-sizing:border-box; padding:.75rem .5rem; text-align:left; vertical-align:top; border-top:1px solid var(--hp-border,currentColor); overflow-wrap:anywhere; white-space:normal }
.hp-work-items thead th { padding-inline-end:28px; height:44px; position:sticky; top:0; z-index:2; background:Canvas; padding-block:.5rem; padding-inline-start:.4rem; font-size:.8rem; font-weight:600 }
.hp-work-items tbody th { position:sticky; inset-inline-start:0; z-index:1; background:Canvas; font-weight:600 }
.hp-work-items thead th:first-child { inset-inline-start:0; z-index:3 }
.hp-work-items .hp-list-title-text, .hp-work-items tbody th > a { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; overflow-wrap:anywhere }
.hp-work-items tbody th > a:focus, .hp-work-items details[open] > .hp-list-title-text { display:block; overflow:visible; -webkit-line-clamp:unset }
.hp-work-items summary { cursor:pointer }
.hp-work-items a, .hp-work-items summary { scroll-margin-block:0; outline-offset:-2px }
.hp-work-items td:last-child { font-size:.93em }
.hp-work-items .hp-column-sort { display:block; min-block-size:44px; max-width:100%; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:inherit; text-align:start; white-space:normal; overflow-wrap:anywhere; cursor:pointer }
.hp-work-items .hp-column-tools { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem; margin-block:.5rem }
.hp-work-items .hp-column-tools button { min-block-size:44px; padding:.4rem .7rem; color:inherit; background:Canvas; border:1px solid var(--hp-border,currentColor); border-radius:var(--hp-radius,.5rem); font:inherit; cursor:pointer }
.hp-work-items .hp-column-tools > span { font-size:.85em }
.hp-work-items .hp-column-resize { position:absolute; inset-block:0; inset-inline-end:0; inline-size:24px; min-block-size:44px; display:grid; place-items:center; cursor:col-resize; touch-action:none }
.hp-work-items .hp-column-resize::after { content:''; block-size:1.5rem; border-inline-end:2px solid var(--hp-border,currentColor) }
.hp-work-items .hp-column-resize:focus-visible { outline-offset:-3px }
.hp-work-items .hp-list-scroll:has(.hp-resizing) { user-select:none; cursor:col-resize }
`
