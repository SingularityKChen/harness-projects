import { gateCommand } from './capabilities.ts'
import { AccessLevel, CapabilityKey, SyncState, effectiveCapabilities, projectError, type ResolvedBinding, type ProviderRegistry, type SyncCursorRecord, type Storage, type StorageTransaction, singlePlanningBinding } from '@harness-projects/capabilities'
import { ContentKind, NormalizedStatus, ProjectErrorCode, RedactionReason, type WorkspaceProjection, type WorkspaceId, type ProviderBindingId } from '@harness-projects/domain'
export const committedFence = (storage: Storage): string => {
  const value = storage.committedReadFence()
  if (typeof value !== 'string') throw new Error('Storage committed read fence must be synchronous')
  return value
}
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
export interface DeliveryReadTicket { readonly bindingId: string; readonly key: CapabilityKey; readonly target: string; version: number; observation?: number; denialVersion?: number; cohort?: number; started?: number; open?: boolean }
export const deliveryDeniedReason = (key: CapabilityKey) => `permission 层拒绝 ${key}；其它获准集合仍可读取，请恢复授权后刷新交付谱系`
export const operationDeniedReason = (key: CapabilityKey, layer = 'permission') => `${layer} 层拒绝 ${key}；其它获准操作仍可用，请恢复授权后重新验证并显式重试`
/** 既有 SyncCursor 的读健康：pending 是未完成读的计数，不存请求或原异常；拒读换代时清 scope，成功事实与 scope 证明同事务提交。 */
type DeliveryHealth = { version: number; denialVersion: number; confirmedVersion: number; denied: boolean; scopes: Set<string>; pending: number }
export function createRuntimeAccess(base: ProviderRegistry, storage: Storage, workspaceId: WorkspaceId, initialDenied = false, deniedRound = 0) {
  const ownedPlanning = new Set<number>()
  let deliveryEpoch = 0
  const delivery = new Map<string, DeliveryHealth>(), owned = new Map<string, number>()
  // 未 ack 的实际拒读只保留因果起点与单调观察号；只有较新的完整事实确认可清遮罩，不生成持久版本。
  const readDenials = new Map<string, { observation: number; cause?: number }>()
  const operations = new Map<string, { version: number; reason?: string; layer?: string }>()
  const scopeKey = (ticket: Pick<DeliveryReadTicket, 'key' | 'target'>) => JSON.stringify(['delivery.read', ticket.key, ticket.target])
  const load = async (ticket: DeliveryReadTicket, source: StorageTransaction): Promise<DeliveryHealth> => {
    const cursor = workspaceId && await source.getSyncCursor(workspaceId, ticket.bindingId as ProviderBindingId, scopeKey(ticket))
    const data = cursor && JSON.parse(cursor.cursorValue ?? '{}')
    if (data && (!Number.isSafeInteger(data.version) || data.version < 0 || typeof data.denied !== 'boolean' || !Number.isSafeInteger(data.pending) || data.pending < 0
      || !Number.isSafeInteger(data.confirmedVersion ?? 0) || (data.confirmedVersion ?? 0) < 0 || Math.max(data.denialVersion ?? 0, data.confirmedVersion ?? 0) > data.version || !Number.isSafeInteger(data.denialVersion ?? 0) || (data.denialVersion ?? 0) < 0 || !Array.isArray(data.scopes) || data.scopes.some((scope: unknown) => typeof scope !== 'string'))) throw new Error('Delivery read health is invalid')
    return data ? { version: data.version, denialVersion: data.denialVersion ?? 0, confirmedVersion: data.confirmedVersion ?? 0, denied: data.denied, scopes: new Set(data.scopes), pending: data.pending } : { version: 0, denialVersion: 0, confirmedVersion: 0, denied: false, scopes: new Set(), pending: 0 }
  }
  const save = (ticket: DeliveryReadTicket, health: DeliveryHealth, tx: StorageTransaction) => tx.putSyncCursor({ workspaceId: workspaceId!, bindingId: ticket.bindingId as ProviderBindingId, scopeKey: scopeKey(ticket),
    cursorValue: JSON.stringify({ ...health, scopes: [...health.scopes] }), state: health.denied ? 'degraded' : health.pending ? 'syncing' : 'healthy', lastErrorCode: health.denied ? 'permission_denied' : undefined })
  const install = (ticket: DeliveryReadTicket, health: DeliveryHealth) => {
    const prior = delivery.get(address(ticket))
    if (!prior || prior.version <= health.version && prior.denialVersion <= health.denialVersion && prior.confirmedVersion <= health.confirmedVersion) {
      if (JSON.stringify(prior && { ...prior, scopes: [...prior.scopes] }) !== JSON.stringify({ ...health, scopes: [...health.scopes] })) deliveryEpoch++
      delivery.set(address(ticket), health)
      const local = readDenials.get(address(ticket))
      if (local?.cause !== undefined && health.confirmedVersion > local.cause) { delete local.cause; deliveryEpoch++ }
    }
  }
  const address = (ticket: Pick<DeliveryReadTicket, 'bindingId' | 'key' | 'target'>) => JSON.stringify([ticket.bindingId, ticket.key, ticket.target])
  const cohort = (health?: DeliveryHealth) => Math.max(health?.denialVersion ?? 0, health?.confirmedVersion ?? 0)
  const ownership = (ticket: DeliveryReadTicket) => JSON.stringify([address(ticket), ticket.cohort ?? cohort(delivery.get(address(ticket)))])
  const observation = (ticket: Pick<DeliveryReadTicket, 'bindingId' | 'key' | 'target'>) => readDenials.get(address(ticket))?.observation ?? 0
  const current = (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.version ?? 0) === ticket.version && observation(ticket) === (ticket.observation ?? 0)
  let epoch = initialDenied ? 1 : 0, denied = initialDenied, tail: Promise<unknown> = Promise.resolve()
  return {
    async operation(binding: ResolvedBinding, key: CapabilityKey, target: string, policy: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>, mode: 'read' | 'write' = 'write', captured = operations.get(address({ bindingId: binding.ref.bindingId, key, target }))?.version ?? 0) {
      const provider = binding.development ?? binding.execution
      if (!provider) return projectError(ProjectErrorCode.NotSupported, `capability 层拒绝 ${key}`)
      let snapshot
      try { snapshot = await provider.describeCapabilities() } catch { return projectError(ProjectErrorCode.Unavailable, `${key} 暂时无法验证；其它获准操作仍可用，请重新验证`)}
      const current = operations.get(address({ bindingId: binding.ref.bindingId, key, target }))
      if ((current?.version ?? 0) !== captured) return projectError(ProjectErrorCode.StaleRevision, current?.reason ?? `${key} 准入版本变化，请重新验证`)
      if (snapshot.bindingId !== binding.ref.bindingId) return projectError(ProjectErrorCode.Conflict, `${key} 连接身份变化，请重新验证`)
      const access = effectiveCapabilities(snapshot, policy).find(entry => entry.key === key)?.access ?? AccessLevel.Unavailable
      if (access === AccessLevel.Unavailable || (mode === 'write' && access === AccessLevel.ReadOnly)) {
        const layer = snapshot.capability[key] === undefined || snapshot.capability[key] === AccessLevel.Unavailable || (mode === 'write' && snapshot.capability[key] === AccessLevel.ReadOnly) ? 'capability'
          : snapshot.permission[key] === undefined || snapshot.permission[key] === AccessLevel.Unavailable || snapshot.permission[key] === AccessLevel.ReadOnly ? 'permission' : 'policy'
        const reason = operationDeniedReason(key, layer)
        const location = address({ bindingId: binding.ref.bindingId, key, target })
        if (mode === 'write' || key !== CapabilityKey.DevelopmentRepositoryRead || layer !== 'permission') {
          operations.set(location, { version: (operations.get(location)?.version ?? 0) + 1, reason, layer }); deliveryEpoch++
        } else if (layer === 'permission') {
          const ticket = this.captureDelivery(binding.ref.bindingId, key, target)
          await this.beginDelivery(ticket, true); this.denyDelivery(ticket); await this.settleDelivery(ticket, true)
        }
        return projectError(layer === 'permission' ? ProjectErrorCode.PermissionDenied : ProjectErrorCode.NotSupported, reason)
      }
      // 仓库读的 Map 只镜像非 permission 声明；同版本 descriptor 可恢复它，实际拒读仍仅由事实事务恢复。
      if (mode === 'read' && key === CapabilityKey.DevelopmentRepositoryRead && current?.layer && current.layer !== 'permission') {
        operations.set(address({ bindingId: binding.ref.bindingId, key, target }), { version: current.version }); deliveryEpoch++
      }
      return undefined
    },
    operationVersion(bindingId: string, key: CapabilityKey, target: string): number { return operations.get(address({ bindingId, key, target }))?.version ?? 0 },
    observeOperation(bindingId: string, key: CapabilityKey, target: string, denied: boolean, version?: number): void {
      const location = address({ bindingId, key, target })
      const current = operations.get(location)?.version ?? 0
      if (denied) { operations.set(location, { version: current + 1, reason: operationDeniedReason(key) }); deliveryEpoch++ }
      else if (version === current && operations.get(location)?.reason) { operations.set(location, { version: current }); deliveryEpoch++ }
    },
    deliveryVersion(target: string): string | undefined {
      const versions = [...delivery].filter(([key, value]) => JSON.parse(key)[2] === target && value.version > 0).map(([key, value]) => [key, value.version])
      versions.push(...[...readDenials].filter(([key]) => JSON.parse(key)[2] === target).map(([key, value]) => [key, `observed:${value.observation}`]))
      versions.push(...[...operations].filter(([key, value]) => JSON.parse(key)[2] === target && value.version > 0).map(([key, value]) => [key, value.version]))
      return versions.length ? JSON.stringify(versions) : undefined
    },
    get deliveryEpoch() { return deliveryEpoch },
    async syncDelivery(target: string, source: StorageTransaction = storage!): Promise<void> {
      if (!source) return
      for (const binding of base.bindings) for (const key of [CapabilityKey.DevelopmentRepositoryRead, CapabilityKey.DevelopmentChangeRequestRead, CapabilityKey.DeliveryPipelineRead, CapabilityKey.DeliveryCheckRead]) {
        if (!binding.capabilities.some((entry) => entry.key === key)) continue
        const ticket = { bindingId: binding.ref.bindingId, key, target, version: 0 }
        install(ticket, await load(ticket, source))
      }
    },
    /** 读前 marker ack 后才调用 Provider；marker 阻止旧事实恢复新读取，拒绝或完整确认才换代结算 pending。 */
    async beginDelivery(ticket: DeliveryReadTicket, supersede = false): Promise<void> {
      if (!storage) return
      const health = await storage.transaction(async (tx) => {
        const health = await load(ticket, tx)
        if (supersede) health.version++
        health.pending++
        await save(ticket, health, tx); return health
      })
      ticket.version = health.version; ticket.denialVersion = health.denialVersion; ticket.cohort = cohort(health); ticket.started = health.version; ticket.open = true
      owned.set(ownership(ticket), (owned.get(ownership(ticket)) ?? 0) + 1); deliveryEpoch++; install(ticket, health)
    },
    /** 普通失败只结束读；恢复仅写调用者的事实事务，ack 后由 syncDelivery 发布。 */
    async settleDelivery(ticket: DeliveryReadTicket, denied: boolean, scope?: string, tx?: StorageTransaction): Promise<void> {
      if (!storage || !ticket.open && scope === undefined) return
      const settle = async (source: StorageTransaction) => {
        const health = await load(ticket, source)
        if (scope !== undefined && health.version !== ticket.started) return health
        if (denied && health.confirmedVersion > (ticket.started ?? ticket.version)) return health
        if (!denied && scope === undefined && cohort(health) !== (ticket.cohort ?? 0)) return health
        if (ticket.open) health.pending = Math.max(0, health.pending - 1)
        if (denied || scope !== undefined && (health.denied || health.pending > 0)) {
          health.version++; health.pending = 0
          if (denied) { health.denialVersion = health.version; health.denied = true; health.scopes.clear() } else { health.denied = true; health.scopes.add(scope!) }
        }
        if (scope !== undefined) health.confirmedVersion = health.version
        await save(ticket, health, source); return health
      }
      try {
        if (tx) await settle(tx)
        else { const health = await storage.transaction(settle); ticket.version = health.version; install(ticket, health) }
      }
      finally { if (!tx && ticket.open) { ticket.open = false; deliveryEpoch++; owned.set(ownership(ticket), Math.max(0, (owned.get(ownership(ticket)) ?? 0) - 1)) } }
    },
    captureDelivery(bindingId: string, key: CapabilityKey, target: string): DeliveryReadTicket {
      const ticket = { bindingId, key, target, version: 0, observation: observation({ bindingId, key, target }) }; ticket.version = delivery.get(address(ticket))?.version ?? 0; return ticket
    },
    currentOperationRead: (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.denialVersion ?? 0) === (ticket.denialVersion ?? 0) && observation(ticket) === (ticket.observation ?? 0),
    currentDelivery: current,
    /** 拒绝票据可继续提交脱敏事实；其它旧票据保留原观察号，恢复遮罩也不能复活它们。 */
    denyDelivery(ticket: DeliveryReadTicket): void {
      const health = delivery.get(address(ticket))
      if ((health?.confirmedVersion ?? 0) > (ticket.started ?? ticket.version)) return
      const local = readDenials.get(address(ticket))
      readDenials.set(address(ticket), { observation: observation(ticket) + 1, cause: Math.max(local?.cause ?? 0, ticket.started ?? ticket.version) }); ticket.observation = observation(ticket); deliveryEpoch++
    },
    recoverDelivery(ticket: DeliveryReadTicket, scope: string): void {
      const entry = delivery.get(address(ticket))
      if (storage && ticket.open) { ticket.open = false; deliveryEpoch++; owned.set(ownership(ticket), Math.max(0, (owned.get(ownership(ticket)) ?? 0) - 1)) }
      if (!storage && entry && current(ticket)) { entry.scopes.add(scope); deliveryEpoch++; entry.version++; ticket.version = entry.version }
    },
    deliveryRegistry(target: string, scope?: string): ProviderRegistry {
      return { bindings: base.bindings.map((binding) => ({ ...binding, capabilities: binding.capabilities.map((entry) => {
        const reason = operations.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target }))?.reason
        if (reason) return { ...entry, access: AccessLevel.Unavailable, reason }
        if (readDenials.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target }))?.cause !== undefined) return { ...entry, access: AccessLevel.Unavailable, reason: deliveryDeniedReason(entry.key) }
        const blocked = delivery.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target }))
        return blocked && (blocked.pending > (owned.get(ownership({ bindingId: binding.ref.bindingId, key: entry.key, target, version: blocked.version })) ?? 0) || blocked.denied && (scope === undefined ? blocked.scopes.size === 0 : !blocked.scopes.has(scope)))
          ? { ...entry, access: AccessLevel.Unavailable, reason: blocked.denied ? deliveryDeniedReason(entry.key) : `capability 层尚未完成 ${entry.key}` } : entry
      }) })) }
    },
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
