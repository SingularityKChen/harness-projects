import {
  AccessLevel, CapabilityKey, providerErr, providerError, providerOk,
  type ExecutionProvider, type ExternalObjectRef, type ProviderExecutionRun, type ProviderResult, type ProviderStartRunInput,
} from '@harness-projects/capabilities'
import { asBrandedId, ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import type { SessionEvent, SessionPort } from './session-port.ts'

export const HARNESS_EXECUTION_PROVIDER_DEFINITION = { implementationKey: 'execution.harness', domains: ['execution'] } as const
interface Options {
  readonly bindingId: string; readonly sessions: SessionPort; readonly clock?: () => string
  readonly timeoutMs?: number
}
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const errorCode = (error: unknown) => (error as { code?: unknown } | null)?.code
const mappedCode = (error: unknown) => errorCode(error) === 'gateway/bad-request' ? ProviderErrorCode.InvalidInput
  : errorCode(error) === 'session/not-found' ? ProviderErrorCode.NotFound : ProviderErrorCode.Unavailable
const failure = (code: ProviderErrorCode, phase: string) => providerErr(providerError(code, `Harness ${phase} 未确认`))

/** 同一公开操作共享绝对预算；底层晚到的 Promise 始终有 rejection handler。 */
async function budget<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error('deadline')) }, timeoutMs)
  })
  try { return await Promise.race([work(controller.signal), expired]) }
  finally { clearTimeout(timer) }
}
async function call<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  const value = await work()
  signal.throwIfAborted()
  return value
}

/** user/message 没有 turn：用 seq 所在的 turn/start 区间归属，禁止冒领后续 turn。 */
function statusFor(events: readonly SessionEvent[], requestId: string, running: boolean | undefined): string {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const message = sorted.find((e) => e.type === 'user/message' && e.rpcId === requestId)
  const starts = sorted.filter((e) => e.type === 'turn/start')
  const start = message === undefined ? undefined : starts.filter((e) => e.seq < message.seq).at(-1)
  if (start === undefined) {
    if (starts.length !== 0 || message !== undefined) return 'unknown'
    return running === true ? 'running' : running === false ? 'starting' : 'unknown'
  }
  if (!Number.isInteger(start.turn)) return 'unknown'
  const end = sorted.find((e) => e.type === 'turn/end' && e.turn === start.turn && e.seq > start.seq)
  if (end !== undefined) {
    switch (end.reason?.kind) {
      case 'completed': return 'succeeded'
      case 'error': return 'failed'
      case 'aborted': return 'canceled'
      default: return 'unknown'
    }
  }
  const later = starts.some((e) => e.seq > start.seq)
  return running && !later ? 'running' : 'unknown'
}

export function createHarnessExecutionProvider(options: Options): ExecutionProvider {
  const { sessions } = options
  const bindingId = asBrandedId<ProviderBindingId>(options.bindingId)
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!nonblank(bindingId) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Harness 配置无效')
  const refFor = (sessionId: string, requestId: string): ExternalObjectRef => ({
    bindingId, objectKind: 'execution_run', externalId: JSON.stringify([sessionId, requestId]), url: undefined,
  })
  const parse = (ref: ExternalObjectRef): [string, string] | undefined => {
    if (ref?.bindingId !== bindingId || ref?.objectKind !== 'execution_run' || typeof ref?.externalId !== 'string') return
    try {
      const value: unknown = JSON.parse(ref.externalId)
      if (Array.isArray(value) && value.length === 2 && value.every(nonblank)) return value as [string, string]
    } catch { /* 引用不是本 Provider 的编码。 */ }
    return undefined
  }
  const read = async (ids: [string, string], signal: AbortSignal): Promise<ProviderExecutionRun> => {
    const [sessionId, requestId] = ids
    const history = await call(signal, () => sessions.inspect(sessionId, signal))
    const listing = await call(signal, () => sessions.list({}, signal))
    const row = listing.items.find((item) => item.sessionId === sessionId)
    return { ref: refFor(sessionId, requestId), status: statusFor(history.events, requestId, row?.running),
      startedAt: undefined, finishedAt: undefined, exitCode: undefined, logUrl: undefined }
  }
  return {
    definition: HARNESS_EXECUTION_PROVIDER_DEFINITION,
    async describeCapabilities() {
      const capability = { [CapabilityKey.ExecutionRunStart]: AccessLevel.Available, [CapabilityKey.ExecutionRunRead]: AccessLevel.Available,
        [CapabilityKey.ExecutionRunCancel]: AccessLevel.Unavailable }
      return { bindingId, capability, permission: capability, observedAt: (options.clock ?? (() => new Date().toISOString()))() }
    },
    async startRun(input: ProviderStartRunInput): Promise<ProviderResult<ProviderExecutionRun>> {
      const ctx = input.context
      if (ctx?.bindingId !== bindingId || ctx?.objectKind !== 'execution_context' || !nonblank(ctx.externalId)
        || typeof input.workingDirectory !== 'string' || !input.workingDirectory.startsWith('/') || input.workingDirectory.includes('\0')
        || !nonblank(input.command) || input.environment === null || typeof input.environment !== 'object') return failure(ProviderErrorCode.InvalidInput, 'input')
      if (Object.keys(input.environment).length) return failure(ProviderErrorCode.NotSupported, 'environment')
      let phase = 'create'
      try {
        return providerOk(await budget(timeoutMs, async (signal) => {
          const { sessionId } = await call(signal, () => sessions.create({ cwd: input.workingDirectory }))
          if (!nonblank(sessionId)) throw Error('invalid session identity')
          phase = 'prompt'
          const requestId = ctx.externalId
          const ack = await call(signal, () => sessions.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: input.command }] }, signal))
          if (ack?.accepted === false) throw { code: 'rejected' }
          if (ack?.accepted !== true) throw Error('unconfirmed prompt ack')
          phase = 'read'
          return read([sessionId, requestId], signal)
        }))
      } catch (error) {
        const code = phase === 'read' || (phase === 'prompt' && !['gateway/bad-request', 'session/not-found', 'rejected'].includes(String(errorCode(error))))
          ? ProviderErrorCode.AmbiguousResult : mappedCode(error)
        return failure(code, phase)
      }
    },
    async getRun(ref) {
      const ids = parse(ref)
      if (ids === undefined) return failure(ProviderErrorCode.NotFound, 'identity')
      try { return providerOk(await budget(timeoutMs, (signal) => read(ids, signal))) }
      catch (error) { return failure(mappedCode(error), 'read') }
    },
    // Host cancel 只有 sessionId；无法保证所属 turn，任何输入均不得触发外部写入。
    async cancelRun() { return failure(ProviderErrorCode.NotSupported, 'cancel') },
  }
}
