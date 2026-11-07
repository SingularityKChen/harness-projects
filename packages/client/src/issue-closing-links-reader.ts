/** 只接受 Host 的闭集观察；无事实缓存，opaque receipt 仅用于拒绝错代的成功 query。 */
import type { ControllerQueries } from '@harness-projects/controller'
export interface IssueClosingLinksScope { readonly workspaceId: string; readonly workItemId: string }
export type IssueClosingLinksObservation = Awaited<ReturnType<ControllerQueries['getIssueClosingLinks']>>
export interface IssueClosingLinksRead extends IssueClosingLinksScope { readonly observation: IssueClosingLinksObservation }
export interface IssueClosingLinksReader {
  read(scope: IssueClosingLinksScope, receipt?: string): Promise<IssueClosingLinksRead>
  refresh(scope: IssueClosingLinksScope): Promise<string>
}
const INVALID = '来源关联响应不合契约'
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(INVALID)
  return value as Record<string, unknown>
}
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
function timestamp(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) return false
  const year = Number(v.slice(0, 4)), month = Number(v.slice(5, 7)), day = Number(v.slice(8, 10))
  return day >= 1 && day <= ([31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0)
}
function observation(input: unknown, scope: IssueClosingLinksScope): IssueClosingLinksObservation {
  const v = record(input, ['workItemId', 'scopeToken', 'state', 'links', 'stale', 'observedAt', 'coverage'])
  if (typeof v.state !== 'string' || v.workItemId !== scope.workItemId || !nonempty(v.scopeToken) || !Array.isArray(v.links) || typeof v.stale !== 'boolean') throw new TypeError(INVALID)
  if (['unread', 'denied', 'unsupported', 'unavailable'].includes(String(v.state))) {
    if (v.links.length || v.stale !== true || (Object.hasOwn(v, 'observedAt') || Object.hasOwn(v, 'coverage'))) throw new TypeError(INVALID)
  } else {
    if (!['complete', 'partial'].includes(String(v.state)) || !timestamp(v.observedAt)) throw new TypeError(INVALID)
    const coverage = record(v.coverage, ['native_reference', 'native_closing'])
    for (const kind of ['native_reference', 'native_closing']) {
      const c = record(coverage[kind], ['state', 'stale', 'observedAt'])
      if (!['complete', 'partial', 'unavailable'].includes(String(c.state)) || typeof c.state !== 'string' || typeof c.stale !== 'boolean' || c.stale !== (c.state !== 'complete') || !timestamp(c.observedAt)) throw new TypeError(INVALID)
    }
    const complete = Object.values(coverage).every(c => (c as { state: string }).state === 'complete')
    if ((v.state === 'complete') !== complete || v.state === 'partial' && !v.stale) throw new TypeError(INVALID)
    const identities = new Set<string>()
    for (const entry of v.links) {
      const link = record(entry, ['repositoryId', 'repositoryName', 'bindingId', 'externalId', 'number', 'title', 'url', 'state', 'isDraft', 'provenance', 'relations', 'referenceWillCloseTarget'])
      const key = JSON.stringify([link.repositoryId, link.bindingId, link.externalId]), relations = link.relations
      if (identities.has(key) || ['repositoryId', 'repositoryName', 'bindingId', 'externalId'].some(k => !nonempty(link[k])) || typeof link.title !== 'string' || typeof link.url !== 'string' || !Number.isSafeInteger(link.number) || Number(link.number) <= 0 || typeof link.state !== 'string' || !['open', 'closed', 'merged'].includes(link.state) || typeof link.isDraft !== 'boolean' || link.provenance !== 'source_observed' || !Array.isArray(relations) || relations.length < 1 || relations.length > 2 || relations.some((r, i) => !['native_reference', 'native_closing'].includes(r) || i > 0 && (r !== 'native_closing' || relations[0] !== 'native_reference')) || (relations.includes('native_reference') ? typeof link.referenceWillCloseTarget !== 'boolean' : Object.hasOwn(link, 'referenceWillCloseTarget'))) throw new TypeError(INVALID)
      identities.add(key)
    }
  }
  return v as unknown as IssueClosingLinksObservation
}
export function createIssueClosingLinksReader(port: { read(scope: IssueClosingLinksScope): Promise<unknown>; refresh(scope: IssueClosingLinksScope): Promise<unknown> }): IssueClosingLinksReader {
  return {
    refresh: async scope => {
      const v = record(await port.refresh(scope), ['writeState', 'saving', 'authoritative', 'value', 'error'])
      if (v.writeState !== 'local_only' || v.saving !== false || v.authoritative !== false || v.error !== undefined) throw new TypeError(INVALID)
      return observation(v.value, scope).scopeToken
    },
    read: async (scope, receipt) => {
      const v = record(await port.read(scope), ['workspaceId', 'workItemId', 'observation'])
      if (v.workspaceId !== scope.workspaceId || v.workItemId !== scope.workItemId) throw new TypeError(INVALID)
      const value = observation(v.observation, scope)
      if (receipt !== undefined && ['complete', 'partial'].includes(value.state) && value.scopeToken !== receipt) throw new TypeError(INVALID)
      return { workspaceId: scope.workspaceId, workItemId: scope.workItemId, observation: value }
    },
  }
}
