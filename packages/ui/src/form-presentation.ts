import type { DOMElement } from './work-item-detail.ts'
/** 只移动到调用表单的安全摘要；提交归属由各表单局部 ref 管理。 */
export function focusFormError(root: DOMElement | null): void {
  root?.querySelector?.('[data-form-error]')?.focus?.()
}
export const FORM_STYLES: string = `
.hp-workspace[data-workspace-setup] > .hp-workspace { padding:0 }
.hp-form { display:grid; gap:var(--hp-space-4); margin-block:var(--hp-space-6); padding-block:var(--hp-space-4); border-block-start:1px solid var(--hp-border) }
.hp-form h3 { margin:0; font-size:1.15rem }
.hp-field { display:grid; gap:var(--hp-space-1); min-width:0 }
.hp-field label { font-weight:600; overflow-wrap:anywhere }
.hp-field :where(input,select) { box-sizing:border-box; width:100%; min-width:0; min-height:44px; padding:var(--hp-space-2); border:1px solid var(--hp-control-border); border-radius:var(--hp-radius); color:inherit; background:var(--hp-surface); font:inherit; line-height:1.5 }
.hp-field select option { color:CanvasText; background:Canvas }
.hp-field :disabled { border-style:dashed }
.hp-field p { font-size:.9em; margin:0; overflow-wrap:anywhere }
.hp-form-actions { display:flex; gap:var(--hp-space-2); flex-wrap:wrap }
.hp-form-notice { padding:var(--hp-space-3); border-inline-start:3px solid var(--hp-control-border); overflow-wrap:anywhere }
.hp-form-notice p { margin-block:var(--hp-space-1) }
.hp-form-notice:focus { outline:var(--hp-focus-width) solid var(--hp-focus-color); outline-offset:3px }
@media(max-width:36rem) { .hp-form-actions { flex-direction:column } .hp-form-actions > button { width:100% } }
`
