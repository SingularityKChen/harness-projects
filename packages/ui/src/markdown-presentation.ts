/** 局部正文阅读样式；Host 主题仍拥有颜色和字体，长代码与表格在自己的容器滚动。 */
export const MARKDOWN_STYLES = `
.hp-markdown { min-inline-size:0; max-inline-size:72ch; white-space:normal; overflow-wrap:anywhere; font-size:1rem; line-height:1.57143 }
.hp-markdown :where(h1,h2,h3,h4,h5,h6) { margin:var(--hp-space-4) 0 var(--hp-space-2); line-height:1.35; font-weight:650 }
.hp-markdown h1 { font-size:1.6em }
.hp-markdown h2 { font-size:1.4em }
.hp-markdown h3 { font-size:1.2em }
.hp-markdown :where(h4,h5,h6) { font-size:1em }
.hp-markdown :where(ul,ol) { padding-inline-start:1.5em }
.hp-markdown li { margin-block:var(--hp-space-1) }
.hp-markdown blockquote { margin-inline:0; padding-inline-start:var(--hp-space-3); border-inline-start:3px solid var(--hp-border) }
.hp-markdown :where(pre,code) { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.9em; background:var(--hp-surface) }
.hp-markdown code { padding:.1em .25em; border-radius:.2em }
.hp-markdown pre { max-inline-size:100%; overflow-x:auto; padding:var(--hp-space-3); border-radius:var(--hp-radius) }
.hp-markdown pre,.hp-markdown pre code { white-space:pre; overflow-wrap:normal; word-break:normal }
.hp-markdown pre code { padding:0; background:transparent; font-size:1em }
.hp-markdown-table { max-inline-size:100%; overflow-x:auto; margin-block:var(--hp-space-3) }
.hp-markdown table { border-collapse:collapse; inline-size:max-content; min-inline-size:100% }
.hp-markdown :where(th,td) { border:1px solid var(--hp-border); padding:var(--hp-space-2); text-align:start }
.hp-markdown th { background:var(--hp-surface) }
.hp-markdown-image { display:inline-flex; flex-wrap:wrap; gap:var(--hp-space-2); align-items:baseline }
.hp-markdown input[type="checkbox"] { margin-inline-end:var(--hp-space-2) }
.hp-markdown .task-list-item { list-style-type:none; position:relative; min-block-size:1lh }
.hp-markdown .task-list-item > p:first-child { position:relative; min-block-size:1lh }
.hp-markdown .task-list-item > input[type="checkbox"],.hp-markdown .task-list-item > p:first-child > input[type="checkbox"] {
  position:absolute; inset-inline-start:-1.4em; inset-block-start:0; inline-size:1em; block-size:1em; margin-block:.3em 0; margin-inline:0;
}
.hp-markdown a { color:inherit; text-decoration:underline; text-decoration-color:var(--dsw-alias-link,var(--hp-accent)); text-underline-offset:.15em }
`
