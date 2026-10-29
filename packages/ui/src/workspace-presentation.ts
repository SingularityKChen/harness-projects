/** 私有呈现合同：由实际工作区入口装配；只继承 Host 主题，不持有第二份主题状态。 */
export const WORKSPACE_STYLES: string = `
.hp-workspace {
  --hp-accent:var(--dsw-alias-state-business-primary,currentColor);
  --hp-focus-color:var(--dsw-focus-ring-color,var(--hp-accent));
  --hp-focus-width:var(--dsw-focus-ring-width,2px);
  --hp-surface:color-mix(in srgb,currentColor 4%,transparent);
  --hp-border:color-mix(in srgb,currentColor 22%,transparent);
  --hp-control-border:color-mix(in srgb,currentColor 58%,transparent);
  --hp-radius:.5rem;
  --hp-space-1:.25rem; --hp-space-2:.5rem; --hp-space-3:.75rem; --hp-space-4:1rem; --hp-space-6:1.5rem;
  box-sizing:border-box; min-width:0; max-width:100%; padding:var(--hp-space-4);
  color:inherit; font:inherit; line-height:1.6;
}
.hp-workspace :where(section,div,header,nav,form,p,h2) { box-sizing:border-box; min-width:0; max-width:100% }
.hp-workspace :where(h2) { margin:0 0 var(--hp-space-3); font-size:1.55rem; line-height:1.35; font-weight:650; overflow-wrap:anywhere }
.hp-workspace :where(p) { margin:var(--hp-space-2) 0; overflow-wrap:anywhere }
.hp-workspace :where(button,.hp-action) {
  box-sizing:border-box; min-height:44px; max-width:100%; padding:var(--hp-space-2) var(--hp-space-3);
  border:1px solid var(--hp-control-border); border-radius:var(--hp-radius);
  color:inherit; background:var(--hp-surface); font:inherit; line-height:1.5;
  white-space:normal; overflow-wrap:anywhere; cursor:pointer;
}
.hp-workspace :where(button,.hp-action):disabled { cursor:default; border-style:dashed }
.hp-workspace .hp-action-primary { border-color:var(--hp-accent); font-weight:650 }
.hp-workspace :focus-visible { outline:var(--hp-focus-width) solid var(--hp-focus-color); outline-offset:3px }
`
