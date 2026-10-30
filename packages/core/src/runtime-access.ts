import { AccessLevel, CapabilityKey, projectError, type ResolvedBinding, type ProviderRegistry, type Storage, type StorageTransaction } from '@harness-projects/capabilities'
import { ContentKind, NormalizedStatus, ProjectErrorCode, RedactionReason, type WorkspaceProjection, type WorkspaceId, type ProviderBindingId } from '@harness-projects/domain'
export const committedFence = (storage: Storage): string => {
  const value = storage.committedReadFence()
  if (typeof value !== 'string') throw new Error('Storage committed read fence must be synchronous')
  return value
}
export const PLANNING_DENIED = 'Core 读取层拒绝 planning.item.read；本地工程信息仍可浏览，请恢复授权后重新验证'
export function redactPlanning(row: WorkspaceProjection): WorkspaceProjection {
  const { planningFields: _fields, ...identity } = row
  return { ...identity, content: { contentKind: ContentKind.Redacted, reason: RedactionReason.PermissionDenied }, planningStatus: NormalizedStatus.Unknown }
}
export interface DeliveryReadTicket { readonly bindingId: string; readonly key: CapabilityKey; readonly target: string; version: number; started?: number; open?: boolean }
export const deliveryDeniedReason = (key: CapabilityKey) => `permission 层拒绝 ${key}；其它获准集合仍可读取，请恢复授权后刷新交付谱系`
/** 既有 SyncCursor 的读健康：pending 是未完成读的计数，不存请求或原异常；拒读换代时清 scope，成功事实与 scope 证明同事务提交。 */
type DeliveryHealth = { version: number; denied: boolean; scopes: Set<string>; pending: number }
export function createRuntimeAccess(base: ProviderRegistry, storage?: Storage, workspaceId?: WorkspaceId, initialDenied = false) {
  let deliveryEpoch = 0
  const delivery = new Map<string, DeliveryHealth>(), owned = new Map<string, number>()
  const scopeKey = (ticket: Pick<DeliveryReadTicket, 'key' | 'target'>) => JSON.stringify(['delivery.read', ticket.key, ticket.target])
  const load = async (ticket: DeliveryReadTicket, source: StorageTransaction): Promise<DeliveryHealth> => {
    const cursor = workspaceId && await source.getSyncCursor(workspaceId, ticket.bindingId as ProviderBindingId, scopeKey(ticket))
    const data = cursor && JSON.parse(cursor.cursorValue ?? '{}')
    if (data && (!Number.isSafeInteger(data.version) || data.version < 0 || typeof data.denied !== 'boolean' || !Number.isSafeInteger(data.pending) || data.pending < 0
      || !Array.isArray(data.scopes) || data.scopes.some((scope: unknown) => typeof scope !== 'string'))) throw new Error('Delivery read health is invalid')
    return data ? { version: data.version, denied: data.denied, scopes: new Set(data.scopes), pending: data.pending } : { version: 0, denied: false, scopes: new Set(), pending: 0 }
  }
  const save = (ticket: DeliveryReadTicket, health: DeliveryHealth, tx: StorageTransaction) => tx.putSyncCursor({ workspaceId: workspaceId!, bindingId: ticket.bindingId as ProviderBindingId, scopeKey: scopeKey(ticket),
    cursorValue: JSON.stringify({ ...health, scopes: [...health.scopes] }), state: health.denied ? 'degraded' : health.pending ? 'syncing' : 'healthy', lastErrorCode: health.denied ? 'permission_denied' : undefined })
  const install = (ticket: DeliveryReadTicket, health: DeliveryHealth) => {
    const prior = delivery.get(address(ticket))
    if (!prior || prior.version <= health.version) {
      if (JSON.stringify(prior && { ...prior, scopes: [...prior.scopes] }) !== JSON.stringify({ ...health, scopes: [...health.scopes] })) deliveryEpoch++
      delivery.set(address(ticket), health)
    }
  }
  const address = (ticket: Pick<DeliveryReadTicket, 'bindingId' | 'key' | 'target'>) => JSON.stringify([ticket.bindingId, ticket.key, ticket.target])
  const current = (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.version ?? 0) === ticket.version
  let epoch = initialDenied ? 1 : 0, denied = initialDenied, tail: Promise<unknown> = Promise.resolve()
  return {
    deliveryVersion(target: string): string | undefined {
      const versions = [...delivery].filter(([key, value]) => JSON.parse(key)[2] === target && value.version > 0).map(([key, value]) => [key, value.version])
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
    /** 读前 marker ack 后才调用 Provider；失败时不增加本 owner 的许可计数。 */
    async beginDelivery(ticket: DeliveryReadTicket): Promise<void> {
      if (!storage) return
      const health = await storage.transaction(async (tx) => {
        let health = await load(ticket, tx)
        const observed = delivery.get(address(ticket))
        if (observed && observed.version > health.version) health = { ...observed, scopes: new Set(observed.scopes) }
        health.pending++
        await save(ticket, health, tx); return health
      })
      ticket.version = health.version; ticket.started = health.version; ticket.open = true
      owned.set(address(ticket), (owned.get(address(ticket)) ?? 0) + 1); deliveryEpoch++; install(ticket, health)
    },
    /** 普通失败只结束读；恢复仅写调用者的事实事务，ack 后由 syncDelivery 发布。 */
    async settleDelivery(ticket: DeliveryReadTicket, denied: boolean, scope?: string, tx?: StorageTransaction): Promise<void> {
      if (!storage || !ticket.open && scope === undefined) return
      const settle = async (source: StorageTransaction) => {
        const health = await load(ticket, source)
        if (health.version !== ticket.started) return health
        if (ticket.open) health.pending = Math.max(0, health.pending - 1)
        if (denied || scope !== undefined && (health.denied || health.pending > 0)) {
          health.version++; health.pending = 0
          if (denied) { health.denied = true; health.scopes.clear() } else { health.denied = true; health.scopes.add(scope!) }
        }
        await save(ticket, health, source); return health
      }
      try {
        if (tx) await settle(tx)
        else { const health = await storage.transaction(settle); ticket.version = health.version; install(ticket, health) }
      }
      finally { if (!tx && ticket.open) { ticket.open = false; deliveryEpoch++; owned.set(address(ticket), Math.max(0, (owned.get(address(ticket)) ?? 0) - 1)) } }
    },
    captureDelivery(bindingId: string, key: CapabilityKey, target: string): DeliveryReadTicket {
      const ticket = { bindingId, key, target, version: 0 }; ticket.version = delivery.get(address(ticket))?.version ?? 0; return ticket
    },
    currentDelivery: current,
    denyDelivery(ticket: DeliveryReadTicket): void {
      if (!current(ticket)) return
      ticket.version++; deliveryEpoch++; delivery.set(address(ticket), { version: ticket.version, denied: true, scopes: new Set(), pending: 0 })
    },
    recoverDelivery(ticket: DeliveryReadTicket, scope: string): void {
      const entry = delivery.get(address(ticket))
      if (storage && ticket.open) { ticket.open = false; deliveryEpoch++; owned.set(address(ticket), Math.max(0, (owned.get(address(ticket)) ?? 0) - 1)) }
      if (!storage && entry && current(ticket)) { entry.scopes.add(scope); deliveryEpoch++; entry.version++; ticket.version = entry.version }
    },
    deliveryRegistry(target: string, scope?: string): ProviderRegistry {
      return { bindings: base.bindings.map((binding) => ({ ...binding, capabilities: binding.capabilities.map((entry) => {
        const blocked = delivery.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target }))
        return blocked && (blocked.pending > (owned.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target })) ?? 0) || blocked.denied && (scope === undefined ? blocked.scopes.size === 0 : !blocked.scopes.has(scope)))
          ? { ...entry, access: AccessLevel.Unavailable, reason: blocked.denied ? deliveryDeniedReason(entry.key) : `capability 层尚未完成 ${entry.key}` } : entry
      }) })) }
    },
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
