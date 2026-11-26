/** 单工作区 setup source：Host 是事实源；这里只缓存读数、提交 intent 与安全失败。 */
import { parseConnectionFailure, type ConnectionFailure } from './connection-failure.ts'
export type { ConnectionFailure } from './connection-failure.ts'
import type { ActorRef } from '@harness-projects/controller'
import type { ProjectError, ProjectErrorCode, Recovery } from '@harness-projects/domain'
export interface WorkspaceSetupDTO {
  readonly workspace: null | { readonly id: string; readonly name: string }
  readonly planning: { readonly state: 'unbound' | 'configured' | 'confirmed' | 'degraded'; readonly bindingId?: string; readonly projectNodeId?: string }
  readonly executionInstalled?: boolean
  readonly mappingOrigin?: 'derived' | 'user'
  readonly activationError?: ProjectError
  readonly error?: ProjectError
}
export interface WorkspaceCatalogueDTO { readonly activeWorkspaceId: string | null; readonly workspaces: readonly WorkspaceCatalogueEntry[] }
export interface WorkspaceCatalogueEntry { readonly workspaceId: string; readonly name: string; readonly planning: 'none' | 'bound'; readonly policy: 'supported' | 'unsupported' }
/** adapter 先解包 RemoteResult；精确位置参数与 Host wire 同形，返回值仍必须严格解析。 */
export interface WorkspaceSetupPort {
  getWorkspaceSetup(): Promise<unknown>
  createWorkspace(actor: ActorRef, key: string, name: string): Promise<unknown>
  connectAccount(actor: ActorRef, key: string): Promise<unknown>
  bindPlanningSource(actor: ActorRef, key: string, accountId: string, projectNodeId: string): Promise<unknown>
  installExecutionBindings(actor: ActorRef, key: string): Promise<unknown>
  refreshPlanning(actor: ActorRef): Promise<unknown>
  /** 可选的 catalogue/open：旧嵌入方可只提供 setup；提供时必须与 Host 严格解析。 */
  listWorkspaces?(): Promise<unknown>
  openWorkspace?(workspaceId: string): Promise<unknown>
}
export interface WorkspaceSetupSnapshot {
  readonly setup?: WorkspaceSetupDTO
  /** 最近一次本地创建经 ack 与匹配的 Host 读取确认；后续发布保留，供 UI 关联当前创建交互。 */
  readonly createdWorkspaceId?: string
  /** 一轮 refresh 同时读取的项目目录；缺省表示端口未提供 catalogue。失败时保留最后已知列表。 */
  readonly catalogue?: WorkspaceCatalogueDTO
  readonly activating?: string
  readonly pending: boolean; readonly error?: ProjectError; readonly connectionFailure?: ConnectionFailure
  readonly failure?: 'read' | 'reconcile' | 'create' | 'connect' | 'install' | 'activate'
}
export interface WorkspaceSetupSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): WorkspaceSetupSnapshot
  installExecution(): Promise<void>
  recoverExecution(): Promise<void>
  create(name: string): Promise<void>
  connect(projectNodeId: string): Promise<void>
  /** 显式打开已存工作区：成功后 setup 必须已重读为目标；响应后不匹配即 failure='activate'。 */
  open(workspaceId: string): Promise<void>
  refresh(reconcile?: boolean): Promise<void>
  /** 接受新的 workspace/generation 后先撤销旧作用域的在途意图，再安排 refresh；不改变 Host 事实。 */
  invalidateScope(): void
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
  const dto = record(value, ['workspace', 'planning', 'executionInstalled', 'mappingOrigin', 'activationError', 'error'])
  const workspace = dto.workspace === null ? null : record(dto.workspace, ['id', 'name'])
  const planning = record(dto.planning, ['state', 'bindingId', 'projectNodeId'])
  const state = planning.state
  if (state !== 'unbound' && state !== 'configured' && state !== 'confirmed' && state !== 'degraded') throw new TypeError('设置状态不合契约')
  if ((workspace === null && state !== 'unbound') || (state === 'unbound' && (planning.bindingId !== undefined || planning.projectNodeId !== undefined))) throw new TypeError('设置 scope 不合契约')
  const binding = planning.bindingId === undefined ? {} : { bindingId: text(planning.bindingId) }
  const project = planning.projectNodeId === undefined ? {} : { projectNodeId: text(planning.projectNodeId) }
  if (state === 'confirmed' && (!binding.bindingId || !project.projectNodeId)) throw new TypeError('设置绑定缺失')
  if (dto.executionInstalled !== undefined && typeof dto.executionInstalled !== 'boolean') throw new TypeError('执行绑定状态不合契约')
  if (dto.mappingOrigin !== undefined && dto.mappingOrigin !== 'derived' && dto.mappingOrigin !== 'user') throw new TypeError('映射来源不合契约')
  const activationError = parseError(dto.activationError), error = parseError(dto.error)
  return Object.freeze({ workspace: workspace === null ? null : Object.freeze({ id: text(workspace.id), name: text(workspace.name) }), planning: Object.freeze({ state, ...binding, ...project }),
    ...(dto.executionInstalled === undefined ? {} : { executionInstalled: dto.executionInstalled as boolean }), ...(dto.mappingOrigin === undefined ? {} : { mappingOrigin: dto.mappingOrigin }), ...(activationError ? { activationError } : {}), ...(error ? { error } : {}) })
}
export function parseWorkspaceCatalogue(value: unknown): WorkspaceCatalogueDTO {
  const dto = record(value, ['activeWorkspaceId', 'workspaces'])
  if (dto.activeWorkspaceId !== null) text(dto.activeWorkspaceId)
  if (!Array.isArray(dto.workspaces)) throw new TypeError('项目目录不合契约')
  const workspaces = dto.workspaces.map((entry) => {
    const item = record(entry, ['workspaceId', 'name', 'planning', 'policy'])
    if (item.planning !== 'none' && item.planning !== 'bound') throw new TypeError('规划状态不合契约')
    if (item.policy !== 'supported' && item.policy !== 'unsupported') throw new TypeError('策略状态不合契约')
    return Object.freeze({ workspaceId: text(item.workspaceId), name: text(item.name), planning: item.planning, policy: item.policy })
  })
  return Object.freeze({ activeWorkspaceId: dto.activeWorkspaceId as string | null, workspaces: Object.freeze(workspaces) })
}
function command(value: unknown, valueKey?: string): { id?: string; error?: ProjectError; definitive?: boolean; connectionFailure?: ConnectionFailure } {
  const dto = record(value, ['writeState', 'saving', 'authoritative', 'value', 'error', 'activationError', 'connectionFailure'])
  if (typeof dto.writeState !== 'string' || !['pending', 'local_only', 'confirmed', 'reconciled', 'failed', 'conflict', 'unknown'].includes(dto.writeState) || dto.saving !== (dto.writeState === 'pending') || dto.authoritative !== (dto.writeState === 'confirmed' || dto.writeState === 'reconciled')) throw new TypeError('设置命令不合契约')
  const commandError = parseError(dto.error), activationError = parseError(dto.activationError), error = commandError ?? activationError
  const connectionFailure = parseConnectionFailure(dto, commandError)
  if (connectionFailure && valueKey !== 'accountId' && valueKey !== 'bindingId') throw new TypeError('连接失败 scope 不合契约')
  const detail = connectionFailure ? { connectionFailure } : {}
  const id = valueKey === undefined || dto.value === undefined ? undefined : text(record(dto.value, [valueKey])[valueKey])
  if (valueKey && dto.writeState !== 'local_only') return { ...detail, error: commandError ?? safeError(dto.writeState === 'unknown' || dto.writeState === 'pending' ? 'result_unknown' : dto.writeState === 'conflict' ? 'conflict' : 'unavailable'), definitive: commandError !== undefined && (dto.writeState === 'failed' || dto.writeState === 'conflict') }
  if (!commandError && valueKey && !id) throw new TypeError('设置命令缺少结果')
  return { ...detail, ...(id ? { id } : {}), ...(error ? { error } : {}), definitive: commandError !== undefined && activationError === undefined && (dto.writeState === 'failed' || dto.writeState === 'conflict') }
}
type Stage = 'create' | 'account' | 'bind'
type Intent = { payload: string; key: string; attempts: Partial<Record<Stage, number>>; workspaceId?: string }
type Mutation = { raw: Promise<void> | undefined; done: Promise<void> }
export function createWorkspaceSetupSource(port: WorkspaceSetupPort, options: { readonly actorRef: ActorRef; readonly key?: () => string; readonly interactionTimeoutMs?: number }): WorkspaceSetupSource {
  let snapshot: WorkspaceSetupSnapshot = Object.freeze({ pending: false }), disposed = false, revision = 0, scope = 0, mutationScope = 0
  let createIntent: Intent | undefined, connectIntent: Intent | undefined
  let executionIntent: { key: string; acknowledged: boolean } | undefined
  let executionAttempt = 0
  let executionPending: Promise<void> | undefined
  const timeoutMs = options.interactionTimeoutMs ?? 30_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new RangeError('设置等待预算无效')
  let mutationPending: Mutation | undefined, readPending: Promise<void> | undefined, reconcilePending: Promise<void> | undefined
  const listeners = new Set<() => void>(), key = options.key ?? (() => globalThis.crypto.randomUUID())
  const finishExecutionIntent = (intent: NonNullable<typeof executionIntent>): void => {
    if (executionIntent !== intent) return
    executionIntent = undefined; executionAttempt++
  }
  const publish = (next: WorkspaceSetupSnapshot): void => { if (!disposed) { snapshot = Object.freeze({ ...(snapshot.createdWorkspaceId === undefined ? {} : { createdWorkspaceId: snapshot.createdWorkspaceId }), ...next }); listeners.forEach((listener) => listener()) } }
  const readState = async (): Promise<{ setup: WorkspaceSetupDTO; catalogue?: WorkspaceCatalogueDTO }> => {
    const setup = parseWorkspaceSetup(await port.getWorkspaceSetup())
    const catalogue = port.listWorkspaces === undefined ? undefined : parseWorkspaceCatalogue(await port.listWorkspaces())
    return { setup, ...(catalogue === undefined ? {} : { catalogue }) }
  }
  const previous = () => ({ ...(snapshot.setup ? { setup: snapshot.setup } : {}), ...(snapshot.catalogue ? { catalogue: snapshot.catalogue } : {}) })
  const trackMutation = (raw: Promise<void>, confirm = false): Promise<void> => {
    const slot: Mutation = { raw, done: raw.then(async () => {
      slot.raw = undefined
      // 读取只等待 raw；释放它之后才让调用方等待新作用域的确认，避免互等。
      let following = readPending
      while (confirm && following) { await following; if (readPending === following) break; following = readPending }
      if (mutationPending === slot) mutationPending = undefined
    }) }
    mutationPending = slot
    return slot.done
  }
  const run = (kind: 'read' | 'reconcile' | 'create' | 'connect' | 'install' | 'activate', action: () => Promise<ProjectError | undefined>, detail?: () => ConnectionFailure | undefined, recover = false, requestedWorkspaceId?: string): Promise<void> => {
    if (disposed) return Promise.resolve()
    const version = ++revision, workspaceId = snapshot.setup?.workspace?.id
    let acceptedScope = scope
    let active = true
    const current = () => active && !disposed && version === revision && acceptedScope === scope
    publish({ ...previous(), pending: true, ...(kind === 'activate' && requestedWorkspaceId !== undefined ? { activating: requestedWorkspaceId } : {}) })
    const task = (async () => {
      let failure = kind
      try {
        const error = await action()
        // create/open 会确认自己的激活；其它旧作用域动作及任何旧读取都不得发布。
        if (kind === 'create' || kind === 'activate') acceptedScope = scope
        if (!current()) return
        // failure 决定 UI 的恢复路由；执行/打开失败必须保持各自的有界恢复路由，不能降为普通 refresh。
        if (kind !== 'install' && kind !== 'activate') failure = 'read'
        const confirmation = executionIntent?.acknowledged ? executionIntent : undefined
        const state = await readState(), setup = state.setup
        if (current()) {
          const expected = kind === 'install' ? workspaceId : requestedWorkspaceId
          if (expected !== undefined && (kind !== 'activate' || error === undefined) && setup.workspace?.id !== expected) throw new TypeError('设置工作区已变化')
          if (setup.workspace === null && setup.error) publish({ ...previous(), pending: false, error: kind === 'install' ? safeError('result_unknown') : setup.error, failure })
          else {
            // 所有恢复读取共享结算：只消费已 ack 且精确匹配的创建，未知 ack 不按名称猜测。
            const createdWorkspaceId = !error && !setup.error && !setup.activationError && createIntent?.workspaceId !== undefined
              && createIntent.workspaceId === setup.workspace?.id ? createIntent.workspaceId : undefined
            if (createdWorkspaceId !== undefined) createIntent = undefined
            // 当前 Host 装配读可独立确认配置；普通 refresh 仅结算已 ack 意图。规划读取错误与执行配置正交。
            if (!error && (confirmation || recover) && setup.executionInstalled && !setup.activationError && executionIntent) finishExecutionIntent(executionIntent)
            const connectionFailure = kind === 'connect' && error ? detail?.() : undefined
            const unresolved = error ?? (kind === 'install' ? setup.activationError ?? (!setup.executionInstalled ? safeError('result_unknown') : undefined) : undefined)
            publish({ setup, ...(state.catalogue === undefined ? {} : { catalogue: state.catalogue }), ...(createdWorkspaceId === undefined ? {} : { createdWorkspaceId }), pending: false, ...(unresolved ? { error: unresolved, failure: kind } : {}), ...(connectionFailure ? { connectionFailure } : {}) })
          }
        }
      } catch { if (current()) publish({ ...previous(), pending: false, error: safeError(failure === 'install' ? 'result_unknown' : 'unavailable'), failure }) }
    })()
    if (kind !== 'install') return task
    if (!recover) {
      executionPending = task
      void task.then(() => { if (executionPending === task) executionPending = undefined })
    }
    // 超时只结束交互；原命令仍占有安装槽，晚值不得发布或释放重复写保护。
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        active = false
        if (!disposed && version === revision && acceptedScope === scope) publish({ ...previous(), pending: false, error: safeError('result_unknown'), failure: 'install' })
        resolve()
      }, timeoutMs)
      void task.then(() => { clearTimeout(timer); resolve() })
    })
  }
  const submit = (kind: 'create' | 'connect', raw: string): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (mutationPending) return mutationPending.done
    const payload = raw.trim()
    if (!payload) { publish({ ...(snapshot.setup ? { setup: snapshot.setup } : {}), pending: false, error: safeError('invalid_input'), failure: kind }); return Promise.resolve() }
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
    const intentScope = scope
    let connectionFailure: ConnectionFailure | undefined
    const promise = run(kind, async () => {
      if (kind === 'create') {
        const created = accept('create', await port.createWorkspace(options.actorRef, stageKey('create'), payload), 'workspaceId')
        if (created.id !== undefined) active.workspaceId = created.id
        return created.error
      }
      const accountValue = await port.connectAccount(options.actorRef, stageKey('account'))
      if (disposed || intentScope !== scope) return undefined
      const account = accept('account', accountValue, 'accountId')
      connectionFailure = account.connectionFailure
      if (account.error || disposed || !account.id) return account.error
      const boundValue = await port.bindPlanningSource(options.actorRef, stageKey('bind'), account.id, payload)
      if (disposed || intentScope !== scope) return undefined
      const bound = accept('bind', boundValue, 'bindingId')
      connectionFailure = bound.connectionFailure
      return bound.error
    }, () => connectionFailure)
    mutationScope = intentScope
    return trackMutation(promise, kind === 'create')
  }
  const installExecution = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (mutationPending) return mutationPending.done
    if (executionPending) return Promise.resolve()
    const active = executionIntent ??= { key: `${key()}:execution${executionAttempt ? `:attempt-${executionAttempt + 1}` : ''}`, acknowledged: false }
    readPending = undefined
    let settle!: (task: Promise<void>) => void
    const promise = new Promise<void>((resolve) => { settle = resolve })
    const completion = trackMutation(promise)
    mutationScope = scope
    settle(run('install', async () => {
      const value = await port.installExecutionBindings(options.actorRef, active.key), dto = record(value, ['writeState', 'saving', 'authoritative', 'value', 'error', 'activationError'])
      const checked = command(value)
      if (checked.definitive) finishExecutionIntent(active)
      if (dto.writeState === 'local_only' && dto.error === undefined) {
        const pair = record(dto.value, ['bindingIds']).bindingIds
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some((id) => typeof id !== 'string' || !id.trim()) || pair[0] === pair[1]) throw new TypeError('执行绑定响应不合契约')
        active.acknowledged = true
      }
      if (checked.error) return checked.error
      if (dto.writeState !== 'local_only') return safeError(dto.writeState === 'unknown' || dto.writeState === 'pending' ? 'result_unknown' : 'unavailable')
      return undefined
    }))
    return completion
  }
  const refresh = (reconcile = false): Promise<void> => {
    if (reconcile && reconcilePending) return reconcilePending
    const waiting = mutationPending?.raw ?? readPending
    if (!reconcile && (readPending || mutationPending && mutationScope === scope)) return readPending ?? mutationPending!.done
    const refreshScope = scope
    // 先占任务槽，再发布 pending；同步订阅回调与普通重复调用都只能加入同一轮。
    let settle!: (task: Promise<void>) => void
    const promise = new Promise<void>((resolve) => { settle = resolve })
    if (reconcile) reconcilePending = promise
    readPending = promise
    const clear = (): void => {
      if (readPending === promise) readPending = undefined
      if (reconcilePending === promise) reconcilePending = undefined
    }
    void promise.then(clear, clear)
    const start = async (): Promise<void> => {
      // 等待期间可能加入了新的 mutation；不能让旧 read 的结算授权越过它。
      while (mutationPending?.raw) await mutationPending.raw
      if (disposed || refreshScope !== scope) return
      return run(reconcile ? 'reconcile' : 'read', async () => reconcile ? command(await port.refreshPlanning(options.actorRef)).error : undefined)
    }
    settle(waiting ? waiting.then(start) : start())
    return promise
  }
  const open = (workspaceId: string): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (mutationPending) return mutationPending.done
    if (typeof workspaceId !== 'string' || workspaceId === '' || port.openWorkspace === undefined) {
      publish({ ...previous(), pending: false, error: safeError('not_supported'), failure: 'activate' })
      return Promise.resolve()
    }
    const promise = run('activate', async () => {
      const dto = record(await port.openWorkspace!(workspaceId), ['state', 'requestedWorkspaceId', 'activeWorkspaceId', 'error'])
      if (dto.state !== 'activated' && dto.state !== 'failed') throw new TypeError('打开响应不合契约')
      if (text(dto.requestedWorkspaceId) !== workspaceId) throw new TypeError('打开响应目标不一致')
      if (dto.activeWorkspaceId !== undefined) text(dto.activeWorkspaceId)
      const error = parseError(dto.error)
      return dto.state === 'failed' ? error ?? safeError('unavailable') : undefined
    }, undefined, false, workspaceId)
    mutationScope = scope
    return trackMutation(promise, true)
  }
  return { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => snapshot,
    create: (name) => submit('create', name), connect: (project) => submit('connect', project), open,
    refresh, installExecution, recoverExecution: () => run('install', async () => undefined, undefined, true),
    invalidateScope: () => { scope++; connectIntent = undefined; executionIntent = undefined; readPending = undefined; reconcilePending = undefined },
    dispose: () => { disposed = true; revision += 1; const { connectionFailure: _detail, ...rest } = snapshot; snapshot = Object.freeze(rest); listeners.clear() } }
}
