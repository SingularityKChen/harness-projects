import type { DeliveryProjection } from './delivery.ts'
import type { ExecutionContextScope } from './execution-context.ts'
export type DeliveryLineageScope = ExecutionContextScope
export interface DeliveryLineageRead extends DeliveryLineageScope { readonly projection: DeliveryProjection; readonly now: string }
export interface DeliveryLineageReader {
  read(scope: DeliveryLineageScope): Promise<DeliveryLineageRead>
  refresh(scope: DeliveryLineageScope): Promise<void>
}
const INVALID = '交付谱系响应不合契约'
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError(INVALID)
  return value as Record<string, unknown>
}
/** 仅解码 Host 权威投影；刷新结果无节点语义，不保存第二份事实缓存。 */
export function createDeliveryLineageReader(port: { read(scope: DeliveryLineageScope): Promise<unknown>; refresh(scope: DeliveryLineageScope): Promise<unknown> }): DeliveryLineageReader {
  return {
    refresh: async (scope) => {
      const result = await port.refresh(scope)
      if (result !== null && typeof result === 'object' && 'writeState' in result && result.writeState === 'failed') throw new TypeError('交付刷新未完成')
    },
    read: async (scope) => {
      const value = record(await port.read(scope), ['workspaceId', 'workItemId', 'repositoryId', 'projection', 'now'])
      for (const key of ['workspaceId', 'workItemId', 'repositoryId'] as const) if (typeof value[key] !== 'string' || value[key] === '' || value[key] !== scope[key]) throw new TypeError(INVALID)
      if (typeof value.now !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.now) || !Number.isFinite(Date.parse(value.now))) throw new TypeError(INVALID)
      const year = Number(value.now.slice(0, 4)), month = Number(value.now.slice(5, 7)), day = Number(value.now.slice(8, 10))
      const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      if (day < 1 || day > (days[month - 1] ?? 0)) throw new TypeError(INVALID)
      const p = record(value.projection, ['workItemId', 'repositoryId', 'hops', 'optional', 'degraded', 'error', 'attemptedAt', 'freshness', 'gaps'])
      if (p.workItemId !== scope.workItemId || p.repositoryId !== scope.repositoryId || typeof p.degraded !== 'boolean' || !Array.isArray(p.hops) || !Array.isArray(p.optional) || !Array.isArray(p.freshness) || !Array.isArray(p.gaps)) throw new TypeError(INVALID)
      const positions = ['execution_context', 'worktree', 'commit', 'change_request', 'pipeline_run', 'check_run']
      for (const entry of p.hops) {
        const hop = record(entry, ['relationType', 'source', 'relationSource', 'relationState', 'provenance', 'from', 'to', 'entityKind', 'externalId', 'label', 'observed', 'unavailable', 'detail', 'fact', 'stale'])
        if (!positions.includes(String(hop.entityKind)) || !['candidate', 'confirmed', 'rejected'].includes(String(hop.relationState)) || typeof hop.stale !== 'boolean' || typeof hop.unavailable !== 'boolean' || ['from', 'to'].some((key) => typeof hop[key] !== 'string') || ['externalId', 'label'].some((key) => hop[key] !== undefined && typeof hop[key] !== 'string')) throw new TypeError(INVALID)
      }
      for (const entry of p.freshness) { const set = record(entry, ['kind', 'confirmedAt', 'stale']); if (!positions.slice(2).includes(String(set.kind)) || typeof set.stale !== 'boolean' || (set.confirmedAt !== undefined && typeof set.confirmedAt !== 'string')) throw new TypeError(INVALID) }
      for (const entry of p.gaps) { const gap = record(entry, ['entityKind', 'reason', 'key', 'layer']); if (!positions.includes(String(gap.entityKind)) || !['not_started', 'not_observed', 'not_refreshed', 'unconfirmed', 'permission_denied'].includes(String(gap.reason)) || (gap.reason === 'permission_denied' && (!['development.repository.read', 'development.change_request.read', 'delivery.pipeline.read', 'delivery.check.read'].includes(String(gap.key)) || !['permission', 'capability', 'policy'].includes(String(gap.layer))))) throw new TypeError(INVALID) }
      return value as unknown as DeliveryLineageRead
    },
  }
}
