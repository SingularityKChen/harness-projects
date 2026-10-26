/** 单工作区 setup source：Host 是事实源；这里只缓存读数、提交 intent 与安全失败。 */
import type { ActorRef } from '@harness-projects/controller'
import type { ProjectError, ProjectErrorCode, Recovery } from '@harness-projects/domain'
export interface WorkspaceSetupDTO {
  readonly workspace: null | { readonly id: string; readonly name: string }
  readonly planning: { readonly state: 'unbound' | 'configured' | 'confirmed' | 'degraded'; readonly bindingId?: string; readonly projectNodeId?: string }
  readonly mappingOrigin?: 'derived' | 'user'
  readonly activationError?: ProjectError
  readonly error?: ProjectError
}
/** adapter 先解包 RemoteResult；精确位置参数与 Host wire 同形，返回值仍必须严格解析。 */
export interface WorkspaceSetupPort {
  getWorkspaceSetup(): Promise<unknown>
  createWorkspace(actor: ActorRef, key: string, name: string): Promise<unknown>
  connectAccount(actor: ActorRef, key: string): Promise<unknown>
  bindPlanningSource(actor: ActorRef, key: string, accountId: string, projectNodeId: string): Promise<unknown>
  refreshPlanning(actor: ActorRef): Promise<unknown>
}
export interface WorkspaceSetupSnapshot { readonly setup?: WorkspaceSetupDTO; readonly pending: boolean; readonly error?: ProjectError; readonly failure?: 'read' | 'reconcile' | 'create' | 'connect' }
export interface WorkspaceSetupSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): WorkspaceSetupSnapshot
  create(name: string): Promise<void>
  connect(projectNodeId: string): Promise<void>
  refresh(reconcile?: boolean): Promise<void>
  dispose(): void
}
const recoveries: Record<ProjectErrorCode, Recovery> = { not_supported: 'manual_execution', permission_denied: 'fix_permission', not_found: 'open_provider', conflict: 'reapply', rate_limited: 'retry', unavailable: 'retry', invalid_input: 'none', ambiguous_result: 'refresh', result_unknown: 'refresh', stale_revision: 'reapply', offline: 'retry' }
const safeError = (code: ProjectErrorCode = 'unavailable'): ProjectError => Object.freeze({ code, recovery: recoveries[code], retryable: recoveries[code] === 'retry', message: code === 'invalid_input' ? '请检查输入。' : '暂时无法完成工作区设置。', confirmedValue: undefined, attemptedValue: undefined })
const isCode = (value: unknown): value is ProjectErrorCode => typeof value === 'string' && Object.hasOwn(recoveries, value)
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError('设置响应不合契约')
  return value as Record<string, unknown>
}
const text = (value: unknown): string => { if (typeof value !== 'string' || !value.trim()) throw new TypeError('设置字段不合契约'); return value }
function parseError(value: unknown): ProjectError | undefined {
  if (value === undefined) return undefined
  const dto = record(value, ['code', 'message', 'recovery', 'retryable', 'confirmedValue', 'attemptedValue'])
  if (!isCode(dto.code) || dto.recovery !== recoveries[dto.code] || dto.retryable !== (dto.recovery === 'retry') || typeof dto.message !== 'string'
    || ['confirmedValue', 'attemptedValue'].some((key) => dto[key] !== undefined && typeof dto[key] !== 'string')) throw new TypeError('设置错误不合契约')
  return safeError(dto.code)
}
export function parseWorkspaceSetup(value: unknown): WorkspaceSetupDTO {
  const dto = record(value, ['workspace', 'planning', 'mappingOrigin', 'activationError', 'error'])
  const workspace = dto.workspace === null ? null : record(dto.workspace, ['id', 'name'])
  const planning = record(dto.planning, ['state', 'bindingId', 'projectNodeId'])
  const state = planning.state
  if (state !== 'unbound' && state !== 'configured' && state !== 'confirmed' && state !== 'degraded') throw new TypeError('设置状态不合契约')
  if ((workspace === null && state !== 'unbound') || (state === 'unbound' && (planning.bindingId !== undefined || planning.projectNodeId !== undefined))) throw new TypeError('设置 scope 不合契约')
  const binding = planning.bindingId === undefined ? {} : { bindingId: text(planning.bindingId) }
  const project = planning.projectNodeId === undefined ? {} : { projectNodeId: text(planning.projectNodeId) }
  if (state === 'confirmed' && (!binding.bindingId || !project.projectNodeId)) throw new TypeError('设置绑定缺失')
  if (dto.mappingOrigin !== undefined && dto.mappingOrigin !== 'derived' && dto.mappingOrigin !== 'user') throw new TypeError('映射来源不合契约')
  const activationError = parseError(dto.activationError), error = parseError(dto.error)
  return Object.freeze({ workspace: workspace === null ? null : Object.freeze({ id: text(workspace.id), name: text(workspace.name) }), planning: Object.freeze({ state, ...binding, ...project }),
    ...(dto.mappingOrigin === undefined ? {} : { mappingOrigin: dto.mappingOrigin }), ...(activationError ? { activationError } : {}), ...(error ? { error } : {}) })
}
function command(value: unknown, valueKey?: string): { id?: string; error?: ProjectError; definitive?: boolean } {
  const dto = record(value, ['writeState', 'saving', 'authoritative', 'value', 'error', 'activationError'])
  if (typeof dto.writeState !== 'string' || !['pending', 'local_only', 'confirmed', 'reconciled', 'failed', 'conflict', 'unknown'].includes(dto.writeState) || dto.saving !== (dto.writeState === 'pending') || dto.authoritative !== (dto.writeState === 'confirmed' || dto.writeState === 'reconciled')) throw new TypeError('设置命令不合契约')
  const commandError = parseError(dto.error), activationError = parseError(dto.activationError), error = commandError ?? activationError
  const id = valueKey === undefined || dto.value === undefined ? undefined : text(record(dto.value, [valueKey])[valueKey])
  if (valueKey && dto.writeState !== 'local_only') return { error: commandError ?? safeError(dto.writeState === 'unknown' || dto.writeState === 'pending' ? 'result_unknown' : dto.writeState === 'conflict' ? 'conflict' : 'unavailable'), definitive: commandError !== undefined && (dto.writeState === 'failed' || dto.writeState === 'conflict') }
  if (!commandError && valueKey && !id) throw new TypeError('设置命令缺少结果')
  return { ...(id ? { id } : {}), ...(error ? { error } : {}) }
}
type Stage = 'create' | 'account' | 'bind'
type Intent = { payload: string; key: string; attempts: Partial<Record<Stage, number>> }
export function createWorkspaceSetupSource(port: WorkspaceSetupPort, options: { readonly actorRef: ActorRef; readonly key?: () => string }): WorkspaceSetupSource {
  let snapshot: WorkspaceSetupSnapshot = Object.freeze({ pending: false }), disposed = false, revision = 0
  let createIntent: Intent | undefined, connectIntent: Intent | undefined
  let mutationPending: Promise<void> | undefined, readPending: Promise<void> | undefined
  const listeners = new Set<() => void>(), key = options.key ?? (() => globalThis.crypto.randomUUID())
  const publish = (next: WorkspaceSetupSnapshot): void => { if (!disposed) { snapshot = Object.freeze(next); listeners.forEach((listener) => listener()) } }
  const read = async (): Promise<WorkspaceSetupDTO> => parseWorkspaceSetup(await port.getWorkspaceSetup())
  const run = (kind: 'read' | 'reconcile' | 'create' | 'connect', action: () => Promise<ProjectError | undefined>): Promise<void> => {
    if (disposed) return Promise.resolve()
    const current = ++revision
    publish({ ...(snapshot.setup ? { setup: snapshot.setup } : {}), pending: true })
    return (async () => {
      let failure = kind
      try {
        const error = await action()
        if (disposed || current !== revision) return
        failure = 'read'
        const setup = await read()
        if (current === revision) {
          if (setup.workspace === null && setup.error) publish({ ...(snapshot.setup ? { setup: snapshot.setup } : {}), pending: false, error: setup.error, failure: 'read' })
          else publish({ setup, pending: false, ...(error ? { error, failure: kind } : {}) })
        }
      } catch { if (current === revision) publish({ ...(snapshot.setup ? { setup: snapshot.setup } : {}), pending: false, error: safeError(), failure }) }
    })()
  }
  const submit = (kind: 'create' | 'connect', raw: string): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (mutationPending) return mutationPending
    const payload = raw.trim()
    if (!payload) { publish({ ...snapshot, error: safeError('invalid_input'), failure: kind }); return Promise.resolve() }
    let intent = kind === 'create' ? createIntent : connectIntent
    if (!intent || intent.payload !== payload) intent = { payload, key: key(), attempts: {} }
    if (kind === 'create') createIntent = intent; else connectIntent = intent
    const active = intent
    const stageKey = (stage: Stage): string => `${active.key}:${stage}${active.attempts[stage] ? `:attempt-${active.attempts[stage]! + 1}` : ''}`
    const accept = (stage: Stage, value: unknown, valueKey: string): ReturnType<typeof command> => {
      const result = command(value, valueKey)
      // 只为已校验的确定失败准备下一次显式提交；未知、畸形及激活失败保留原键。
      if (result.definitive) active.attempts[stage] = (active.attempts[stage] ?? 0) + 1
      return result
    }
    readPending = undefined
    const promise = run(kind, async () => {
      if (kind === 'create') return accept('create', await port.createWorkspace(options.actorRef, stageKey('create'), payload), 'workspaceId').error
      const account = accept('account', await port.connectAccount(options.actorRef, stageKey('account')), 'accountId')
      if (account.error || disposed || !account.id) return account.error
      const bound = accept('bind', await port.bindPlanningSource(options.actorRef, stageKey('bind'), account.id, payload), 'bindingId')
      return bound.error
    })
    mutationPending = promise
    void promise.then(() => { if (mutationPending === promise) mutationPending = undefined })
    return promise
  }
  const refresh = (reconcile = false): Promise<void> => {
    if (mutationPending) return reconcile ? mutationPending.then(() => refresh(true)) : mutationPending
    if (readPending) return reconcile ? readPending.then(() => refresh(true)) : readPending
    const promise = run(reconcile ? 'reconcile' : 'read', async () => reconcile ? command(await port.refreshPlanning(options.actorRef)).error : undefined)
    readPending = promise
    void promise.then(() => { if (readPending === promise) readPending = undefined })
    return promise
  }
  return { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => snapshot,
    create: (name) => submit('create', name), connect: (project) => submit('connect', project),
    refresh,
    dispose: () => { disposed = true; revision += 1; listeners.clear() } }
}
