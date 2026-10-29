/** 私有详情呈现：只读取工作区矩形并写入 CSS，不保存业务或主题状态。 */
export const DETAIL_STYLES = `
.hp-project { position:relative; min-height:24rem }
.hp-project > .hp-project-refresh { float:right; margin:0 0 var(--hp-space-3) var(--hp-space-3) }
.hp-project > .hp-project-list { clear:both }
.hp-project[data-detail-layout="wide"] > .hp-project-list { padding-right:356px }
.hp-detail {
  position:fixed; inset:auto 0 auto auto; top:0; margin:0; box-sizing:border-box;
  left:var(--hp-detail-left,auto); top:var(--hp-detail-top,0px);
  width:var(--hp-detail-width,min(340px,100vw)); height:var(--hp-detail-height,100dvh);
  max-width:100vw; max-height:100dvh; padding:0; border:1px solid var(--hp-border);
  border-radius:var(--hp-radius); color:inherit; background:Canvas; overflow:hidden;
}
.hp-detail[open] { display:flex; flex-direction:column }
.hp-detail::backdrop { background:color-mix(in srgb,CanvasText 15%,transparent) }
.hp-detail > .hp-detail-header { flex:none; display:flex; align-items:flex-start; gap:var(--hp-space-2); padding:var(--hp-space-4); border-bottom:1px solid var(--hp-border) }
.hp-detail .hp-detail-title { flex:1; margin:0; max-height:30dvh; overflow:auto; font-size:1.25rem; outline-offset:-3px }
.hp-detail > .hp-detail-body { flex:1; min-height:0; overflow:auto; padding:var(--hp-space-4); overscroll-behavior:contain }
.hp-detail :where(p,time,a,span,code,pre,h2,h3,h4) { overflow-wrap:anywhere; white-space:normal }
.hp-detail :where(input,select) { max-inline-size:100%; box-sizing:border-box }
.hp-detail .hp-detail-prose { white-space:pre-wrap }
.hp-detail .hp-detail-header button { flex:none }
`

/** 可选 DOM 面保持 SSR 和最小 renderer 契约可用；真实浏览器具有完整接口。 */
export interface LayoutRoot {
  getBoundingClientRect?(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  readonly style?: { setProperty(name: string, value: string): void; removeProperty(name: string): void }
  setAttribute?(name: string, value: string): void
  removeAttribute?(name: string): void
}

/** 同一根上的 CSS 变量由 top-layer dialog 继承；resize/scroll 从不触发 React 重挂载或业务回调。 */
export function observeDetailLayout(root: LayoutRoot): () => void {
  const browser = globalThis as { window?: {
    readonly innerWidth: number; readonly innerHeight: number
    addEventListener(type: string, listener: () => void, capture?: boolean): void
    removeEventListener(type: string, listener: () => void, capture?: boolean): void
  }; ResizeObserver?: new (callback: () => void) => { observe(node: LayoutRoot): void; disconnect(): void } }
  const viewport = browser.window
  if (viewport === undefined || root.getBoundingClientRect === undefined) return () => undefined
  const names = ['--hp-detail-left', '--hp-detail-top', '--hp-detail-width', '--hp-detail-height']
  const update = (): void => {
    const rect = root.getBoundingClientRect?.()
    if (rect === undefined) return
    const left = Math.min(viewport.innerWidth, Math.max(0, rect.left)), top = Math.min(viewport.innerHeight, Math.max(0, rect.top))
    const right = Math.max(left, Math.min(viewport.innerWidth, rect.right))
    const bottom = Math.max(top, Math.min(viewport.innerHeight, rect.bottom))
    const width = right - left, panel = Math.min(340, width)
    root.setAttribute?.('data-detail-layout', width >= 1200 ? 'wide' : 'overlay')
    const values = [right - panel, top, panel, bottom - top]
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
