/** 单飞刷新只保存交互状态；来源内容和确认时间仍由 watch 接受。 */
import type { ClientWorkspaceRead } from './workspace-read.ts'
export interface PlanningRefreshSnapshot { readonly pending: boolean; readonly error?: string }
export interface PlanningRefreshSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): PlanningRefreshSnapshot
  refresh(): Promise<unknown>
  dispose(): void
}
const ERROR_KEYS = ['code', 'message', 'recovery', 'retryable', 'confirmedValue', 'attemptedValue']
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError('刷新响应不合契约')
  return value as Record<string, unknown>
}
/** ok=true 既可能完整提交，也可能提交可见部分；仅后者允许一致的权限缺口错误。 */
function assertCommittedRefresh(value: unknown): void {
  const response = record(value, ['writeState', 'saving', 'authoritative', 'value', 'error'])
  const result = record(response.value, ['ok', 'entities', 'workItems', 'changeRequests', 'unanchored', 'revision', 'degraded', 'error'])
  if (response.writeState !== 'local_only' || response.saving !== false || response.authoritative !== false || result.ok !== true
    || !['entities', 'workItems', 'changeRequests', 'unanchored', 'revision'].every((key) => Number.isInteger(result[key]) && (result[key] as number) >= 0)) throw new TypeError('刷新没有合法提交证据')
  if (result.degraded === false && result.unanchored === 0 && response.error === undefined && result.error === undefined) return
  const error = record(response.error, ERROR_KEYS), nested = record(result.error, ERROR_KEYS)
  const denied = (entry: Record<string, unknown>): boolean => entry.code === 'permission_denied' && entry.recovery === 'fix_permission'
    && entry.retryable === false && typeof entry.message === 'string'
    && ['confirmedValue', 'attemptedValue'].every((key) => entry[key] === undefined || typeof entry[key] === 'string')
  if (result.degraded !== true || (result.unanchored as number) <= 0 || !denied(error) || !denied(nested)
    || !ERROR_KEYS.every((key) => error[key] === nested[key])) throw new TypeError('刷新部分提交证据不一致')
}
const readable = (read: ClientWorkspaceRead | undefined): boolean => read?.capabilities?.some((entry) => entry.key === 'planning.item.read' && ['available', 'read_only', 'degraded'].includes(entry.access)) === true
const confirmationTime = (read: ClientWorkspaceRead | undefined): number => {
  const at = Date.parse(read?.reconciledAt ?? '')
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY
}
export function createPlanningRefreshSource(options: {
  readonly source: { subscribe(listener: () => void): () => void; getSnapshot(): ClientWorkspaceRead | undefined }
  readonly refreshPlanning: () => Promise<unknown>
}): PlanningRefreshSource {
  let snapshot: PlanningRefreshSnapshot = Object.freeze({ pending: false }), disposed = false, epoch = 0
  let pending: Promise<unknown> | undefined, failedAt = Number.NEGATIVE_INFINITY
  const listeners = new Set<() => void>()
  const scopeOf = (): string => JSON.stringify([options.source.getSnapshot()?.workspace.id, options.source.getSnapshot()?.planningSource?.bindingId])
  let scope = scopeOf()
  const publish = (next: PlanningRefreshSnapshot): void => { snapshot = Object.freeze(next); listeners.forEach((listener) => listener()) }
  const stop = options.source.subscribe(() => {
    if (disposed) return
    const next = scopeOf(), read = options.source.getSnapshot()
    if (next !== scope) { scope = next; epoch++; pending = undefined; publish({ pending: false }) }
    // 失败前已经见过的 fresh 读数、改名与降级都不是新确认；只采信同来源的后续 Host 成功。
    else if (snapshot.error && !snapshot.pending && read?.connection.connected && read.reason === undefined && readable(read)
      && confirmationTime(read) > failedAt) publish({ pending: false })
  })
  return {
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    refresh(): Promise<unknown> {
      if (pending) return pending
      const read = options.source.getSnapshot()
      if (disposed || !read?.connection.connected || !readable(read)) return Promise.resolve()
      const current = epoch, requestedScope = scope
      const active = (): boolean => !disposed && current === epoch && requestedScope === scopeOf()
      const task = Promise.resolve().then(() => active() ? options.refreshPlanning() : undefined).then((result) => {
        if (!active()) return undefined
        assertCommittedRefresh(result)
        return result
      }).catch(() => {
        if (active()) {
          failedAt = confirmationTime(options.source.getSnapshot())
          publish({ pending: false, error: '暂时无法刷新规划，显示的是最后已知值。' })
        }
        return undefined
      }).finally(() => {
        if (!disposed && current === epoch && pending === task) { pending = undefined; if (snapshot.pending) publish({ pending: false }) }
      })
      pending = task
      publish({ pending: true })
      return task
    },
    dispose(): void { disposed = true; epoch++; pending = undefined; stop(); listeners.clear() },
  }
}
