import type { ActorRef, BindRepositoryInput } from '@harness-projects/controller'
import type { ProjectErrorCode, ConnectorAccountId, ProjectError, Recovery } from '@harness-projects/domain'
import { CapabilityKey } from './keys.ts'
export interface RepositorySelection { readonly localPath: string; readonly owner: string; readonly name: string }
export interface RepositoryBindingSnapshot { readonly state: 'idle' | 'pending' | 'configured' | 'active' | 'failed'; readonly selection?: RepositorySelection; readonly repositoryId?: string; readonly error?: ProjectError; readonly activationBlocked?: boolean }
export interface RepositoryBindingPort {
  connectAccount(actor: ActorRef, key: string): Promise<unknown>
  bindRepository(actor: ActorRef, key: string, repositoryId: string, references: readonly (Omit<BindRepositoryInput['references'][number], 'accountId'> & { readonly accountId?: ConnectorAccountId })[]): Promise<unknown>
  baseline(): Promise<unknown>
}
export interface RepositoryBindingSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): RepositoryBindingSnapshot
  bind(selection: RepositorySelection): Promise<void>
  reset(): void
  cancelAttempt(): void
  dispose(): void
}
const recoveries: Record<ProjectErrorCode, Recovery> = { not_supported: 'manual_execution', permission_denied: 'fix_permission', not_found: 'open_provider', conflict: 'reapply', rate_limited: 'retry', unavailable: 'retry', invalid_input: 'none', ambiguous_result: 'refresh', result_unknown: 'refresh', stale_revision: 'reapply', offline: 'retry' }
const safe = (code: ProjectErrorCode = 'unavailable'): ProjectError => Object.freeze({ code, recovery: recoveries[code], retryable: recoveries[code] === 'retry', message: '暂时无法绑定仓库，请检查输入或宿主授权', confirmedValue: undefined, attemptedValue: undefined })
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('无效仓库响应'); return value as Record<string, unknown> }
function repositoryReady(repository: Record<string, unknown>): boolean {
  if (!Array.isArray(repository.capabilities)) return false
  const capabilities = repository.capabilities.map(object)
  return ([
    [CapabilityKey.DevelopmentBranchCreate, true], [CapabilityKey.DevelopmentWorktreeCreate, true],
    [CapabilityKey.DevelopmentRepositoryRead, false], [CapabilityKey.DevelopmentWorktreeRead, false],
  ] as const).every(([key, write]) => {
    const entries = capabilities.filter(entry => entry.key === key)
    return entries.length === 1 && (entries[0]!.access === 'available' || entries[0]!.access === 'degraded' || (!write && entries[0]!.access === 'read_only'))
  })
}
function command(raw: unknown, kind: 'account' | 'repository') {
  const value = object(raw), state = value.writeState
  if (Object.keys(value).some((k) => !['writeState', 'saving', 'authoritative', 'value', 'error', 'activationError'].includes(k)) || typeof state !== 'string' || !['pending', 'local_only', 'confirmed', 'reconciled', 'failed', 'conflict', 'unknown'].includes(state) || value.saving !== (state === 'pending') || value.authoritative !== ['confirmed', 'reconciled'].includes(state)) throw new TypeError('无效仓库命令')
  const failure = (raw: unknown): ProjectError | undefined => { if (raw === undefined) return; const e = object(raw); if (!(typeof e.code === 'string' && Object.hasOwn(recoveries, e.code))) throw new TypeError('无效仓库错误'); const fixed = safe(e.code as ProjectErrorCode); if (e.recovery !== fixed.recovery || e.retryable !== fixed.retryable || typeof e.message !== 'string' || Object.keys(e).some((k) => !['code', 'recovery', 'retryable', 'message', 'confirmedValue', 'attemptedValue'].includes(k))) throw new TypeError('无效仓库错误'); return fixed }
  const error = failure(value.error), activation = failure(value.activationError)
  if (state !== 'local_only' || error) return { error: error ?? safe(state === 'pending' || state === 'unknown' ? 'result_unknown' : 'unavailable'), definitive: !!error && ['failed', 'conflict'].includes(state) }
  const payload = object(value.value), key = kind === 'account' ? 'accountId' : 'repositoryId'
  if (Object.keys(payload).some((k) => ![key, ...(kind === 'repository' ? ['bindingIds'] : [])].includes(k)) || typeof payload[key] !== 'string' || !payload[key]) throw new TypeError('缺少仓库身份')
  if (kind === 'repository' && (!Array.isArray(payload.bindingIds) || payload.bindingIds.length !== 3 || new Set(payload.bindingIds).size !== 3 || !payload.bindingIds.every((id) => typeof id === 'string' && id))) throw new TypeError('缺少仓库引用')
  return { id: payload[key] as string, error: activation, definitive: false }
}
export function createRepositoryBindingSource(port: RepositoryBindingPort, options: { readonly actorRef: ActorRef; readonly key?: () => string }): RepositoryBindingSource {
  let snapshot: RepositoryBindingSnapshot = Object.freeze({ state: 'idle' }), disposed = false, revision = 0, pending: Promise<void> | undefined
  let submittedSelection: RepositorySelection | undefined, bindingSent = false
  let intent: { payload: string; key: string; account: number; bind: number } | undefined
  const listeners = new Set<() => void>(), key = options.key ?? (() => globalThis.crypto.randomUUID())
  const publish = (value: RepositoryBindingSnapshot) => { if (!disposed) { snapshot = Object.freeze({ ...(submittedSelection ? { selection: submittedSelection } : {}), ...value }); listeners.forEach((fn) => fn()) } }
  const reset = () => { revision++; pending = undefined; intent = undefined; submittedSelection = undefined; publish({ state: 'idle' }) }
  return { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => snapshot, reset,
    cancelAttempt: () => { revision++; pending = undefined; if (snapshot.state === 'pending') publish({ state: bindingSent ? 'failed' : 'idle', ...(snapshot.repositoryId ? { repositoryId: snapshot.repositoryId } : {}), ...(bindingSent ? { error: safe('result_unknown') } : {}) }) },
    dispose: () => { disposed = true; revision++; listeners.clear() },
    bind: (selection) => {
      if (disposed) return Promise.resolve()
      if (pending) return pending
      const owner = selection.owner.trim().toLowerCase(), name = selection.name.trim().toLowerCase(), localPath = selection.localPath
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(owner) || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(name) || !localPath.startsWith('/') || localPath !== localPath.trim()) { publish({ state: 'failed', error: safe('invalid_input') }); return Promise.resolve() }
      const repositoryId = `github.com/${owner}/${name}`, payload = JSON.stringify([localPath, owner, name])
      if (!intent || intent.payload !== payload) intent = { payload, key: key(), account: 0, bind: 0 }
      const active = intent, current = ++revision, live = () => !disposed && current === revision
      const stageKey = (stage: 'account' | 'bind') => `${active.key}:${stage}${active[stage] ? `:attempt-${active[stage] + 1}` : ''}`
      submittedSelection = Object.freeze({ localPath, owner, name }); bindingSent = false
      publish({ state: 'pending', repositoryId })
      const task = (async () => {
        let configured = false
        try {
          const account = command(await port.connectAccount(options.actorRef, stageKey('account')), 'account')
          if (!live()) return
          if (account.definitive) active.account++
          if (account.error || !account.id) { publish({ state: 'failed', repositoryId, error: account.error ?? safe() }); return }
          const configuration = { repositoryExternalId: repositoryId, repositoryOwner: owner, repositoryName: name }
          bindingSent = true
          const bound = command(await port.bindRepository(options.actorRef, stageKey('bind'), repositoryId, [
            { domain: 'development', implementationKey: 'development.local-git', configuration: { repositoryPath: localPath, repositoryExternalId: repositoryId } },
            { domain: 'development', implementationKey: 'development.github', accountId: account.id as ConnectorAccountId, configuration },
            { domain: 'delivery', implementationKey: 'github-actions', accountId: account.id as ConnectorAccountId, configuration },
          ]), 'repository')
          if (!live()) return
          if (bound.definitive) active.bind++
          configured = bound.id === repositoryId
          if (!configured || bound.error) { publish({ state: configured ? 'configured' : 'failed', repositoryId, error: bound.error ?? safe() }); return }
          publish({ state: 'configured', repositoryId })
          const baseline = object(await port.baseline())
          const repository = Array.isArray(baseline.repositories) ? baseline.repositories.map(object).find(entry => entry.id === repositoryId) : undefined
          const ready = repository !== undefined && repositoryReady(repository)
          if (live()) publish({ state: ready ? 'active' : 'configured', repositoryId, ...(!ready && repository ? { activationBlocked: true } : {}) })
        } catch { if (live()) publish({ state: configured ? 'configured' : 'failed', repositoryId, error: safe() }) }
      })()
      pending = task; void task.then(() => { if (pending === task) pending = undefined }); return task
    },
  }
}
