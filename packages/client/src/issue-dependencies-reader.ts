import type { ControllerCommands } from '@harness-projects/controller'
export interface IssueDependenciesScope { readonly workspaceId: string; readonly workItemId: string }
export type IssueDependenciesObservation = NonNullable<Awaited<ReturnType<ControllerCommands['refreshIssueDependencies']>>['value']>
export interface IssueDependenciesReader { refresh(scope: IssueDependenciesScope): Promise<IssueDependenciesObservation> }
const invalid = (): never => { throw new TypeError('来源依赖响应不合契约') }
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(k => typeof k !== 'string' || !keys.includes(k) || Object.getOwnPropertyDescriptor(value, k)?.get || Object.getOwnPropertyDescriptor(value, k)?.set)) invalid()
  return value as Record<string, unknown>
}
function timestamp(v: unknown) {
  if (!text(v) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) return false
  const [year, month, day] = v.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDate() === day
}
function identity(value: unknown, namespace: string) {
  const v = record(value, ['namespace', 'id']); if (v.namespace !== namespace || !text(v.id)) invalid()
}
function stream(value: unknown) {
  const v = record(value, ['state', 'items', 'stale', 'observedAt'])
  if (typeof v.state !== 'string' || !['unread', 'complete', 'partial', 'denied', 'unsupported', 'unavailable'].includes(String(v.state)) || !Array.isArray(v.items) || v.items.length > 1000 || v.stale !== (v.state !== 'complete')) invalid()
  if (v.state === 'complete' ? !timestamp(v.observedAt) : Object.hasOwn(v, 'observedAt')) invalid()
  if (!['complete', 'partial'].includes(String(v.state)) && (v.items as unknown[]).length) invalid()
  const seen = new Set<string>()
  for (const raw of v.items as unknown[]) {
    const item = record(raw, ['nativeIdentity', 'repository', 'number', 'title', 'url', 'state']), repo = record(item.repository, ['identity', 'name'])
    identity(item.nativeIdentity, 'github.com/graphql/Issue'); identity(repo.identity, 'github.com/graphql/Repository')
    if (typeof repo.name !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo.name) || !Number.isSafeInteger(item.number) || Number(item.number) <= 0 || typeof item.title !== 'string' || !['open', 'closed'].includes(String(item.state)) || item.url !== `https://github.com/${repo.name}/issues/${item.number}` || new URL(item.url as string).href !== item.url) invalid()
    const key = JSON.stringify([repo.identity, item.nativeIdentity]); if (seen.has(key)) invalid(); seen.add(key)
  }
}
export function createIssueDependenciesReader(port: { refresh(scope: IssueDependenciesScope): Promise<unknown> }): IssueDependenciesReader {
  return { refresh: async scope => {
    const response = record(await port.refresh(scope), ['workspaceId', 'workItemId', 'result'])
    if (response.workspaceId !== scope.workspaceId || response.workItemId !== scope.workItemId) invalid()
    const result = record(response.result, ['writeState', 'saving', 'authoritative', 'value', 'error'])
    if (result.writeState !== 'local_only' || result.saving !== false || result.authoritative !== false || result.error !== undefined) invalid()
    const value = record(result.value, ['workItemId', 'blockedBy', 'blocking', 'parent', 'children'])
    if (value.workItemId !== scope.workItemId) invalid()
    stream(value.blockedBy); stream(value.blocking); stream(value.parent); stream(value.children)
    if ((value.parent as { items: unknown[] }).items.length > 1) invalid()
    return value as unknown as IssueDependenciesObservation
  } }
}
