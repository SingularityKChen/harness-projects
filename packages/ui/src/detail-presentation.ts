/** 私有详情呈现：只读取工作区矩形并写入 CSS，不保存业务或主题状态。 */
const PREVIEW_MAX_REM = 510 / 14
export const DETAIL_STYLES = `
.hp-project { position:relative; min-height:24rem }
.hp-project[data-detail-layout="wide"] > .hp-project-list { padding-right:calc(var(--hp-detail-preview-width) + 1rem) }
.hp-workspace.hp-detail {
  position:fixed; inset:auto 0 auto auto; top:0; margin:0; box-sizing:border-box;
  left:var(--hp-detail-left,auto); top:var(--hp-detail-top,0px);
  width:var(--hp-detail-width,min(${PREVIEW_MAX_REM}rem,100vw)); height:var(--hp-detail-height,100dvh);
  max-width:100vw; max-height:100dvh; padding:0; border:1px solid var(--hp-border);
  border-radius:var(--hp-radius); color:inherit; background:var(--hp-surface); overflow:auto;
}
.hp-detail[open] { display:flex; flex-direction:column }
.hp-detail::backdrop { background:color-mix(in srgb,CanvasText 15%,transparent) }
.hp-detail > .hp-detail-header { flex:none; display:flex; flex-wrap:wrap; align-items:start; gap:var(--hp-space-3); padding:1.714286rem; border-bottom:1px solid var(--hp-border) }
.hp-detail .hp-detail-heading { display:contents }
.hp-detail .hp-detail-number { order:0; flex:1 1 12rem; min-width:min(100%,12rem); align-self:center; margin:0; color:var(--hp-secondary); font-size:.857143rem; line-height:1.5 }
.hp-detail .hp-detail-title { order:2; flex:1 0 100%; min-width:0; margin:0; max-height:30dvh; overflow:auto; font-size:1.57143rem; line-height:1.36364; outline-offset:-3px }
.hp-detail .hp-detail-status { order:3; flex:1 0 100%; margin:0; color:var(--hp-secondary); font-size:.857143rem; line-height:1.5; font-weight:600 }
.hp-detail .hp-detail-mode { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap }
.hp-detail .hp-detail-actions { order:1; flex:0 1 auto; min-width:0; display:flex; flex-wrap:wrap; gap:var(--hp-space-2) }
.hp-detail > .hp-detail-body { flex:1; min-height:calc(max(3em,44px) + 3.428572rem); overflow:auto; padding:1.714286rem; font-size:1rem; line-height:1.57143; overscroll-behavior:contain }
.hp-detail :where(p,time,a,span,code,pre,h2,h3,h4) { overflow-wrap:anywhere; white-space:normal }
.hp-detail :where(input,select) { max-inline-size:100%; box-sizing:border-box }
.hp-detail .hp-detail-prose { white-space:pre-wrap }
.hp-detail .hp-detail-header button { flex:none; background:transparent; border-color:transparent }
.hp-detail .hp-detail-header button:hover { background:var(--hp-hover) }
.hp-detail .hp-detail-metadata { margin-block:var(--hp-space-6); padding-block:var(--hp-space-4); border-block:1px solid var(--hp-border) }
.hp-detail-metadata > div { display:flex; flex-wrap:wrap; gap:var(--hp-space-3); margin-block:var(--hp-space-2) }
.hp-detail-metadata dt { flex:1 1 4rem; min-width:0; color:var(--hp-secondary) }
.hp-detail-metadata dd { flex:3 1 12rem; margin:0; min-width:0; overflow-wrap:anywhere }
.hp-detail .hp-detail-derived { color:var(--hp-secondary); font-size:.857143rem; line-height:1.5 }
.hp-detail[data-detail-mode="expanded"] > .hp-detail-body > * { max-inline-size:78ch; margin-inline:auto }
`

export type DetailMode = 'preview' | 'expanded'

/** 可选 DOM 面保持 SSR 和最小 renderer 契约可用；真实浏览器具有完整接口。 */
export interface LayoutRoot {
  getBoundingClientRect?(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  readonly style?: { setProperty(name: string, value: string): void; removeProperty(name: string): void }
  setAttribute?(name: string, value: string): void
  removeAttribute?(name: string): void
}

/** 同一根上的 CSS 变量由 top-layer dialog 继承；resize/scroll 从不触发 React 重挂载或业务回调。 */
export function observeDetailLayout(root: LayoutRoot, mode: DetailMode = 'preview'): () => void {
  const browser = globalThis as { window?: {
    readonly innerWidth: number; readonly innerHeight: number
    getComputedStyle?(node: object): { readonly fontSize: string }
    addEventListener(type: string, listener: () => void, capture?: boolean): void
    removeEventListener(type: string, listener: () => void, capture?: boolean): void
  }; document?: { readonly documentElement?: object }; ResizeObserver?: new (callback: () => void) => { observe(node: LayoutRoot): void; disconnect(): void } }
  const viewport = browser.window
  if (viewport === undefined || root.getBoundingClientRect === undefined) return () => undefined
  const names = ['--hp-detail-left', '--hp-detail-top', '--hp-detail-width', '--hp-detail-height', '--hp-detail-preview-width']
  const update = (): void => {
    const rect = root.getBoundingClientRect?.()
    if (rect === undefined) return
    const left = Math.min(viewport.innerWidth, Math.max(0, rect.left)), top = Math.min(viewport.innerHeight, Math.max(0, rect.top))
    const right = Math.max(left, Math.min(viewport.innerWidth, rect.right))
    const bottom = Math.max(top, Math.min(viewport.innerHeight, rect.bottom))
    const rem = browser.document?.documentElement === undefined ? 16 : Number.parseFloat(viewport.getComputedStyle?.(browser.document.documentElement).fontSize ?? '16')
    const width = right - left, preview = Math.min(width, Math.max(22 * rem, Math.min(width * .38, PREVIEW_MAX_REM * rem)))
    const panel = mode === 'expanded' ? width : preview
    root.setAttribute?.('data-detail-layout', mode === 'preview' && width >= 1200 ? 'wide' : 'overlay')
    const values = [right - panel, top, panel, bottom - top, preview]
    names.forEach((name, index) => root.style?.setProperty(name, `${values[index]}px`))
  }
  update()
  const observer = browser.ResizeObserver === undefined ? undefined : new browser.ResizeObserver(update)
  observer?.observe(root)
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update, true)
  return () => {
    observer?.disconnect()
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update, true)
    root.removeAttribute?.('data-detail-layout')
    names.forEach((name) => root.style?.removeProperty(name))
  }
}
