/**
 * 工作项深链 codec 与 History adapter（issue #130）：唯一路由为列表 `/projects/:projectId/items` 与详情
 * `/projects/:projectId/items/:itemId`。解析精确段数并拒绝空段、畸形编码、解码后的 slash/control 与多余路径，
 * 不反射错误 URL；close 用 replace 回列表而**绝不** history.back，直接深链打开时关闭不会离开应用。
 */
import type { WorkItemDetailTarget } from '@harness-projects/ui-model'

export type ItemRoute = { readonly projectId: string; readonly itemId?: string }

/** 浏览器 History 的最小端口：壳与 fixture 各自提供实现，adapter 不直接碰 `window`。 */
export type HistoryPort = {
  /** 当前 pathname（不含 query / hash）。 */
  pathname(): string
  push(path: string): void
  replace(path: string): void
  /** 订阅 popstate；返回的取消函数只释放这一个监听。 */
  subscribe(listener: () => void): () => void
}

/** 解码一段并拒绝畸形编码、`/`、反斜杠、control、空段与纯 `.`/`..`：它们产生的 pathname 不是 canonical 目标。 */
function decodeSegment(segment: string): string | undefined {
  if (segment === '' || segment === '.' || segment === '..') return undefined
  try {
    const decoded = decodeURIComponent(segment)
    return decoded === '' || decoded === '.' || decoded === '..' || /[/\\\u0000-\u001f\u007f]/.test(decoded) ? undefined : decoded
  } catch {
    return undefined
  }
}

/** query / hash 不作为目标：先截掉再按段解析。 */
export function parseItemRoute(pathname: string): ItemRoute | undefined {
  if (typeof pathname !== 'string') return undefined
  const segments = (pathname.split(/[?#]/)[0] ?? '').split('/')
  if (segments[0] !== '' || segments[1] !== 'projects' || segments[3] !== 'items') return undefined
  const projectId = decodeSegment(segments[2] ?? '')
  if (projectId === undefined) return undefined
  if (segments.length === 4) return { projectId }
  if (segments.length !== 5) return undefined
  const itemId = decodeSegment(segments[4] ?? '')
  return itemId === undefined ? undefined : { projectId, itemId }
}

/** canonical pathname：每段用与 `decodeSegment` 同一判据校验后编码；表达不出 canonical 目标就抛 `TypeError`。 */
export function itemPath(route: ItemRoute): string {
  const encode = (part: string | undefined): string => {
    const encoded = part === undefined ? '' : encodeURIComponent(part)
    if (encoded === '' || decodeSegment(encoded) === undefined) throw new TypeError(`非 canonical 段：${JSON.stringify(part)}`)
    return encoded
  }
  return `/projects/${encode(route.projectId)}/items${route.itemId === undefined ? '' : `/${encode(route.itemId)}`}`
}

/** 浏览器 History port：把 pathname/pushState/replaceState/popstate 映射为四项；无 DOM lib，按可选结构面声明宿主。 */
export function browserHistoryPort(): HistoryPort {
  const h = globalThis as { location?: { pathname: string }; history?: { pushState(d: unknown, u: string, p: string): void; replaceState(d: unknown, u: string, p: string): void };
    addEventListener?(t: string, l: () => void): void; removeEventListener?(t: string, l: () => void): void }
  return { pathname: () => h.location?.pathname ?? '', push: (path) => h.history?.pushState({}, '', path), replace: (path) => h.history?.replaceState({}, '', path),
    subscribe: (listener) => { h.addEventListener?.('popstate', listener); return () => h.removeEventListener?.('popstate', listener) } }
}

/** 真实 History adapter：创建即发布；open 同目标不重复 push；close 用 replace；dispose 幂等且后 0 回调。 */
export function createItemNavigation(port: HistoryPort, onRoute: (route: ItemRoute | undefined) => void): {
  open: (target: WorkItemDetailTarget) => void
  close: (projectId: string) => void
  dispose: () => void
} {
  let disposed = false
  let current = port.pathname()
  /** 发布时把 `current` 同步为真实 pathname：否则 popstate 回退后再次 open 原目标会被误判为“同目标”。 */
  const publish = (): void => { if (!disposed) { current = port.pathname(); onRoute(parseItemRoute(current)) } }
  const unsubscribe = port.subscribe(publish)
  publish()
  const navigate = (kind: 'push' | 'replace', path: string): void => {
    if (disposed || path === current) return
    port[kind](path)
    publish()
  }
  return { open: (target) => navigate('push', itemPath(target)), close: (projectId) => navigate('replace', itemPath({ projectId })),
    dispose(): void { if (!disposed) { disposed = true; unsubscribe() } } }
}
