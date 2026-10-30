import { AccessLevel, CapabilityKey, projectError, type ResolvedBinding, type ProviderRegistry } from '@harness-projects/capabilities'
import { ContentKind, NormalizedStatus, ProjectErrorCode, RedactionReason, type WorkspaceProjection } from '@harness-projects/domain'
export const PLANNING_DENIED = 'Core 读取层拒绝 planning.item.read；本地工程信息仍可浏览，请恢复授权后重新验证'
export function redactPlanning(row: WorkspaceProjection): WorkspaceProjection {
  const { planningFields: _fields, ...identity } = row
  return { ...identity, content: { contentKind: ContentKind.Redacted, reason: RedactionReason.PermissionDenied }, planningStatus: NormalizedStatus.Unknown }
}
export function createRuntimeAccess(base: ProviderRegistry, initialDenied = false) {
  let epoch = initialDenied ? 1 : 0, denied = initialDenied, tail: Promise<unknown> = Promise.resolve()
  return {
    get epoch() { return epoch },
    get denied() { return denied },
    get registry(): ProviderRegistry {
      if (!denied) return base
      return { bindings: base.bindings.map((binding) => binding.ref.domain !== 'planning' ? binding : {
        ...binding,
        capabilities: binding.capabilities.map((entry) => entry.key === CapabilityKey.PlanningItemRead
          ? { ...entry, access: AccessLevel.Unavailable, reason: PLANNING_DENIED } : entry),
      }) }
    },
    get probeRegistry() { return base },
    deny(captured: number): boolean {
      if (epoch !== captured) return false
      denied = true; epoch++
      return true
    },
    recover(captured: number, verified?: ResolvedBinding): void {
      if (epoch !== captured) return
      if (verified) base = { bindings: base.bindings.map((binding) => binding.ref.domain === 'planning' ? verified : binding) }
      if (denied) { denied = false; epoch++ }
    },
    error() { return denied ? projectError(ProjectErrorCode.PermissionDenied, PLANNING_DENIED) : undefined },
    local<T>(work: () => Promise<T>): Promise<T> {
      const task = tail.then(work); tail = task.catch(() => {})
      return task
    },
  }
}
export type RuntimeAccess = ReturnType<typeof createRuntimeAccess>
