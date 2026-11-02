import { gateCommand } from './capabilities.ts'
import { AccessLevel, CapabilityKey, SyncState, projectError, type ResolvedBinding, type ProviderRegistry, type SyncCursorRecord, type Storage, type StorageTransaction, singlePlanningBinding } from '@harness-projects/capabilities'
import { ContentKind, NormalizedStatus, ProjectErrorCode, RedactionReason, type WorkspaceProjection, type WorkspaceId } from '@harness-projects/domain'
export const PLANNING_DENIED = 'Core 读取层拒绝 planning.item.read；本地工程信息仍可浏览，请恢复授权后重新验证'
export function planningReadState(cursor: SyncCursorRecord | undefined, owned = false): SyncState {
  if (cursor?.state !== SyncState.Syncing) return cursor?.state ?? SyncState.Idle
  if (!owned) return SyncState.Failed
  const prior = cursor.cursorValue
  return prior === SyncState.Healthy || prior === SyncState.Degraded || prior === SyncState.Failed ? prior : SyncState.Failed
}
export function redactPlanning(row: WorkspaceProjection): WorkspaceProjection {
  const { planningFields: _fields, ...identity } = row
  return { ...identity, content: { contentKind: ContentKind.Redacted, reason: RedactionReason.PermissionDenied }, planningStatus: NormalizedStatus.Unknown }
}
export function createRuntimeAccess(base: ProviderRegistry, storage: Storage, workspaceId: WorkspaceId, initialDenied = false, deniedRound = 0) {
  const ownedPlanning = new Set<number>()
  let epoch = initialDenied ? 1 : 0, denied = initialDenied, tail: Promise<unknown> = Promise.resolve()
  return {
    async planning(source: Pick<StorageTransaction, 'getSyncCursor' | 'getPlanningSyncRound'>) {
      const binding = singlePlanningBinding(base)
      const cursor = binding && await source.getSyncCursor(workspaceId, binding.ref.bindingId, 'planning.project')
      const round = binding && await source.getPlanningSyncRound(workspaceId, binding.ref.bindingId, 'planning.project')
      if (denied && (round?.latestCommittedRound ?? 0) > deniedRound && gateCommand(base, CapabilityKey.PlanningItemRead, 'read').allowed) { denied = false; epoch++ }
      const owned = round !== undefined && ownedPlanning.has(round.latestStartedRound)
      const state = planningReadState(cursor, owned)
      const masked = denied || state !== SyncState.Healthy && (cursor?.lastErrorCode === ProjectErrorCode.PermissionDenied || cursor?.cursorValue === SyncState.Failed || cursor?.state === SyncState.Syncing && !owned)
      const error = masked ? projectError(denied || cursor?.lastErrorCode === ProjectErrorCode.PermissionDenied ? ProjectErrorCode.PermissionDenied : ProjectErrorCode.Unavailable, PLANNING_DENIED)
        : ['degraded', 'failed'].includes(state) ? projectError(ProjectErrorCode.Unavailable, 'planning.item.read 尚未确认；本地工程信息仍可浏览，请重新验证') : undefined
      return { binding, cursor, round, state, masked, error }
    },
    beginPlanning(round: number) { ownedPlanning.add(round) },
    endPlanning(round: number) { ownedPlanning.delete(round) },
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
    fence(source: object): string | undefined {
      if (source !== storage) return undefined
      const value = storage.committedReadFence()
      if (typeof value !== 'string') throw new Error('Storage committed read fence must be synchronous')
      return value
    },
    deny(captured: number, observedRound = deniedRound): boolean {
      if (epoch !== captured) return false
      deniedRound = observedRound; denied = true; epoch++
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
