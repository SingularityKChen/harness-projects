/** 私有呈现合同：由实际工作区入口装配；只继承 Host 主题，不持有第二份主题状态。 */
export const WORKSPACE_STYLES: string = `
.hp-workspace {
  --hp-accent:var(--dsw-alias-state-business-primary,CanvasText);
  --hp-focus-color:var(--dsw-focus-ring-color,var(--hp-accent));
  --hp-focus-width:var(--dsw-focus-ring-width,2px);
  --hp-base:var(--dsw-alias-bg-base,Canvas);
  --hp-surface:var(--dsw-alias-bg-layer-1,Canvas);
  --hp-primary:var(--dsw-alias-label-primary,CanvasText);
  --hp-secondary:var(--dsw-alias-label-secondary,var(--hp-primary));
  --hp-border:var(--dsw-alias-border-l2,CanvasText);
  --hp-border-strong:var(--dsw-alias-border-l4,CanvasText);
  --hp-hover:var(--dsw-alias-interactive-bg-hover-solid,Canvas);
  --hp-selected:var(--dsw-alias-bg-multi-select,Canvas);
  --hp-control-border:CanvasText;
  --hp-radius:.5rem;
  --hp-space-1:.25rem; --hp-space-2:.5rem; --hp-space-3:.75rem; --hp-space-4:1rem; --hp-space-6:1.5rem;
  box-sizing:border-box; min-width:0; max-width:100%; padding:min(1.714286rem,4vw);
  color:var(--hp-primary); background:var(--hp-base); font:inherit; line-height:1.57143;
}
/* main slot 是有界 flex 容器（中间 display:contents）；只约束 setup 入口。 */
.hp-workspace[data-workspace-setup] { display:flex; flex-direction:column; flex:1 1 0; block-size:100%; max-block-size:100%; min-block-size:0; min-inline-size:0; overflow:auto }
.hp-workspace-header { flex:none; display:flex; align-items:start; justify-content:space-between; gap:var(--hp-space-3); flex-wrap:wrap }
.hp-workspace-header h2 { margin:0 }
.hp-list-toolbar { display:flex; flex-wrap:wrap; align-items:start; justify-content:space-between; gap:.5rem }
.hp-list-toolbar h2 { margin:0 }
.hp-list-toolbar > div:first-child { flex:0 1 14rem }
.hp-project-list .hp-list-toolbar > .hp-list-actions { display:contents }
.hp-view-modes { margin-inline-end:auto; margin-inline-start:3rem }
.hp-workspace[data-workspace-setup]:has(.hp-project) .hp-workspace-body { margin-block-start:0 }
.hp-list-toolbar .hp-list-meta { margin:0; color:var(--hp-secondary); font-size:.857143rem; line-height:1.5 }
.hp-list-actions { display:flex; flex-wrap:wrap; gap:.5rem }
.hp-workspace-body { flex:1 1 auto; min-block-size:3rem; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; margin-block-start:var(--hp-space-3) }
.hp-workspace[data-workspace-setup] .hp-workspace-body > div > .hp-workspace { padding:0 }
.hp-workspace :where(section,div,header,nav,form,p,h2) { box-sizing:border-box; min-width:0; max-width:100% }
.hp-workspace :where(h2) { margin:0 0 var(--hp-space-3); font-size:1.57143rem; line-height:1.36364; font-weight:600; overflow-wrap:anywhere }
.hp-workspace :where(p) { margin:var(--hp-space-2) 0; overflow-wrap:anywhere }
.hp-workspace :where(button,.hp-action) {
  box-sizing:border-box; min-height:44px; max-width:100%; padding:var(--hp-space-2) var(--hp-space-3);
  border:1px solid var(--hp-control-border); border-radius:var(--hp-radius);
  color:inherit; background:var(--hp-surface); font:inherit; line-height:1.5;
  white-space:normal; overflow-wrap:anywhere; cursor:pointer;
}
.hp-workspace :where(button,.hp-action):disabled { cursor:default; border-style:dashed }
.hp-workspace :where(button,.hp-action):hover { background:var(--hp-hover) }
.hp-workspace .hp-action-primary { background:var(--dsw-alias-button-primary-fill,ButtonFace); color:var(--dsw-alias-label-primary-foreground,ButtonText); border-color:transparent; font-weight:600 }
.hp-workspace .hp-action-primary:hover { background:var(--dsw-alias-button-primary-hover,ButtonFace) }
.hp-list-actions .hp-action { background:transparent; border-color:transparent; font-weight:600 }
@supports (color:color-mix(in srgb,CanvasText,Canvas)) { .hp-workspace { --hp-control-border:color-mix(in srgb,var(--hp-primary) 54%,var(--hp-surface)) } }
.hp-workspace :focus-visible { outline:var(--hp-focus-width) solid var(--hp-focus-color); outline-offset:3px }
`
