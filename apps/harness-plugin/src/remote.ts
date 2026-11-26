/**
 * Harness Host/Client typed-remote seam.
 *
 * The descriptors are derived from the single declaration in `host-operations.ts`
 * (the repository does not ship the Typert generator). Host and Client must mount
 * the exact same descriptor objects.
 */

import { inputOfArguments, OPERATIONS, plainRecord, WORKSPACE_SWITCHED, type Operation, type Operations, type StreamName, type UnaryName } from './host-operations.ts'
import { drainUntil } from './host-planning-lifetime.ts'

export const REMOTE_PACKAGE = '@harness-projects/app-harness-plugin' as const
export const REMOTE_NAMESPACE = 'harnessProjects' as const
const REMOTE_SERVICE = REMOTE_NAMESPACE

type JsonRecord = Record<string, unknown>
type Schema = { parse(value: unknown): unknown }
type StrictCodec = {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly create: () => Schema
  readonly encode?: (value: unknown) => unknown
}

export interface InvocationDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  /** 缺省 = unary；`stream` 时 Host 把调用的 signal 追加为方法的最后一个参数（`cancellation`）。 */
  readonly mode?: 'stream'
  readonly invocation: { readonly kind: 'direct' }
  readonly cancellation?: { readonly parameter: 'signal' }
  readonly parameters: readonly {
    readonly name: string
    readonly wire: string
    readonly source: 'json'
    readonly acceptsUndefined?: true
    readonly codec: StrictCodec
  }[]
  readonly result: StrictCodec
}

export interface HostRemoteContribution {
  readonly package: string
  readonly face: 'host'
  readonly schemas: readonly []
  readonly model: { readonly services: readonly []; readonly events: readonly []; readonly objects: readonly [] }
  readonly invocations: readonly InvocationDescriptor[]
}

export interface ClientRemoteContribution {
  readonly package: string
  readonly descriptors: readonly InvocationDescriptor[]
}

export type HostCompositionCall = {
  /** acknowledge 仅由本次调用在串行区内成功确认装配时同步调用，不进入 wire。 */
  call(name: UnaryName<typeof OPERATIONS>, input: unknown, acknowledge?: (generation: string) => void): Promise<unknown>
  /** 当前装配的 Core generation：per-peer 栅栏判断已下发的流是否过期。 */
  currentGeneration(): string | undefined
} & {
  /** 宿主流的帧序列；remote.ts 只透传并逐帧 JSON 化，不认识帧的类型（不 import controller）。 */
  readonly [K in StreamName<typeof OPERATIONS>]: (signal: AbortSignal) => AsyncIterable<unknown>
}

export interface HostRemoteContext {
  readonly invocation?: { readonly peer?: { readonly id?: unknown } }
  provide(name: string, value: unknown): (() => void | Promise<void>) | void
  typert: { register(contribution: HostRemoteContribution): (() => void) | (() => Promise<void>) }
}

/** Fixed fail-closed error; the existing Gateway owns its transport error envelope. */
export class HostAuthorityError extends Error {
  constructor(message = 'Host connection identity is unavailable') { super(message); this.name = 'HostAuthorityError' }
}

function commandActor(ctx: HostRemoteContext): { readonly kind: 'harness_peer'; readonly id: string } {
  const id = ctx.invocation?.peer?.id
  if (typeof id !== 'string' || id.trim() === '') throw new HostAuthorityError()
  return { kind: 'harness_peer', id }
}

function jsonValue(value: unknown, label = 'Remote 值'): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${label} 不是可传输的 JSON 值`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => {
    if (item === undefined) throw new TypeError(`${label}[${index}] 不是可传输的 JSON 值`)
    return jsonValue(item, `${label}[${index}]`)
  })
  const record = plainRecord(value, label)
  const output: JsonRecord = Object.create(null) as JsonRecord
  for (const key of Object.keys(record)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new TypeError(`${label} 含禁止字段：${key}`)
    const item = record[key]
    if (item !== undefined) output[key] = jsonValue(item, `${label}.${key}`)
  }
  return output
}

function codec(name: string, parse: (value: unknown) => unknown): StrictCodec {
  return {
    mode: 'strict',
    typeSymbol: `${REMOTE_PACKAGE}#${name}`,
    create: () => ({ parse }),
  }
}

const toJson = (value: unknown): unknown => value === undefined ? undefined : jsonValue(value)
/** Host 网关对 strict 结果只调 `encode`；registry 仍要求每个 strict codec 带 `create()`，两者共用同一严格 JSON 化。 */
const jsonOutput: StrictCodec = { ...codec('RemoteJsonOutput', toJson), encode: toJson }

function descriptorOf(operation: Operation): InvocationDescriptor {
  const stream = operation.mode === 'stream'
  return {
    id: `${REMOTE_PACKAGE}#${REMOTE_NAMESPACE}/${operation.name}`,
    service: REMOTE_SERVICE,
    namespace: REMOTE_NAMESPACE,
    method: operation.name,
    ...(stream ? { mode: 'stream' as const } : {}),
    invocation: { kind: 'direct' },
    parameters: operation.params.map((p) => ({ name: p.name, wire: p.name, source: 'json' as const, ...(p.acceptsUndefined ? { acceptsUndefined: true as const } : {}), codec: codec(p.type, p.parse) })),
    ...(stream ? { cancellation: { parameter: 'signal' as const } } : {}),
    result: jsonOutput,
  }
}

/** Host 与 Client 两半共享同一冻结的 descriptor 数组；顺序即声明顺序。 */
export function defineRemote<O extends Operations>(operations: O): { operations: O; host: HostRemoteContribution; client: ClientRemoteContribution } {
  const descriptors = Object.freeze(Object.values(operations).map(descriptorOf))
  return {
    operations,
    host: Object.freeze({
      package: REMOTE_PACKAGE,
      face: 'host',
      schemas: [] as const,
      model: { services: [] as const, events: [] as const, objects: [] as const },
      invocations: descriptors,
    }),
    client: Object.freeze({ package: REMOTE_PACKAGE, descriptors }),
  }
}

const REMOTE = defineRemote(OPERATIONS)
export const HOST_REMOTE: HostRemoteContribution = REMOTE.host
export const CLIENT_REMOTE: ClientRemoteContribution = REMOTE.client

export interface InstalledHostRemote {
  /** 方法由声明派生，类型上只能是记录；唯一的消费者是测试。 */
  readonly service: Readonly<Record<string, unknown>>
  dispose(deadline?: number): Promise<void>
}

/** 帧的 generation：baseline / delta / metadata 带，gap 不带；只接受非空字符串。 */
function frameGeneration(value: unknown): string | undefined {
  const frame = value as Record<string, unknown> | null
  for (const kind of ['baseline', 'delta', 'metadata']) {
    const generation = (frame?.[kind] as { generation?: unknown } | undefined)?.generation
    if (typeof generation === 'string' && generation.trim() !== '') return generation
  }
}

/** Install the live Cordis service and its strict Typert contribution. `remote` 缺省为生产的 `OPERATIONS`；测试可注入带夹具操作的声明。 */
export async function installHostRemote(
  ctx: HostRemoteContext,
  composition: HostCompositionCall,
  remote: { readonly operations: Operations; readonly host: HostRemoteContribution } = REMOTE,
  decorate: (service: Record<string, unknown>) => void = () => {},
  owner?: { readonly signal: AbortSignal; stop(error?: unknown): number },
  diagnostic?: (event: 'shutdownDeadlineExceeded' | 'shutdownFailed', error?: unknown) => void,
): Promise<InstalledHostRemote> {
  let unregisterRemote: (() => void) | (() => Promise<void>)
  let provideDispose: (() => void | Promise<void>) | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  let activeCalls = 0
  const delivered = new Map<string, string>()
  const lifetime = new AbortController()
  const streams = new Set<() => Promise<unknown>>()
  let drainResolve: (() => void) | undefined
  const drained = new Promise<void>((resolve) => { drainResolve = resolve })
  const report = (event: 'shutdownDeadlineExceeded' | 'shutdownFailed', error?: unknown): void => { try { diagnostic?.(event, error) } catch { /* 诊断不得中断其它清理 */ } }
  const beginCall = (): void => {
    if (disposed) throw new Error('host remote 已卸载')
    activeCalls += 1
  }
  const endCall = (): void => {
    activeCalls -= 1
    if (disposed && activeCalls === 0) drainResolve?.()
  }

  const service: Record<string, unknown> = { ctx, typertRemote: undefined }
  for (const operation of Object.values(remote.operations)) {
    service[operation.name] = operation.mode === 'stream'
      // 首次 next 才登记调用；真实 source 先关，避免 pending next 把 outer.return 排在队尾。
      ? function (this: { readonly ctx?: HostRemoteContext } | undefined, signal: AbortSignal) {
        const invoker = this
        const combined = AbortSignal.any([signal, lifetime.signal])
        let frames: AsyncIterator<unknown> | undefined, closing = false, exhausted = false
        let sourceClose: Promise<void> | undefined, stopped: Promise<unknown> | undefined
        const closeSource = (): Promise<void> => {
          closing = true
          if (!frames) return Promise.resolve()
          if (!sourceClose) {
            let settle!: (value: unknown) => void
            let fail!: (error: unknown) => void
            // 先发布唯一任务；return 可同步 abort 重入，但真实关闭仍在当前调用栈发起。
            sourceClose = new Promise<unknown>((resolve, reject) => { settle = resolve; fail = reject })
              .then(() => undefined, (error) => report('shutdownFailed', error))
            try { settle(frames.return?.()) } catch (error) { fail(error) }
          }
          return sourceClose
        }
        const stop = (): Promise<unknown> => {
          closeSource()
          return stopped ??= outer.return(undefined).catch((error) => report('shutdownFailed', error))
        }
        const abort = (): void => { void stop() }
        const outer = (async function* () {
          beginCall()
          streams.add(stop)
          combined.addEventListener('abort', abort, { once: true })
          try {
            if (combined.aborted) return
            frames = composition[operation.name as StreamName<typeof OPERATIONS>](combined)[Symbol.asyncIterator]()
            if (combined.aborted || closing) return
            for (;;) {
              let frame: IteratorResult<unknown>
              try { frame = await frames.next() }
              catch (error) { if (combined.aborted || closing) return; throw error }
              if (combined.aborted || closing) return
              if (frame.done) { exhausted = true; return }
              const generation = frameGeneration(frame.value), peer = invoker?.ctx?.invocation?.peer?.id
              if (generation !== undefined && typeof peer === 'string' && peer.trim() !== '') delivered.set(peer, generation)
              yield toJson(frame.value)
            }
          } finally {
            if (!exhausted) await closeSource()
            combined.removeEventListener('abort', abort)
            streams.delete(stop)
            endCall()
          }
        })()
        return outer
      }
      : async function (this: { ctx: HostRemoteContext }, ...args: unknown[]) {
        beginCall()
        try {
          const input = inputOfArguments(operation, args)
          if (operation.params.some(({ name }) => name === 'actorRef')) input.actorRef = commandActor(this.ctx)
          const peer = this.ctx.invocation?.peer?.id
          if (operation.scope !== 'host' && operation.scope !== 'transition' && typeof peer === 'string' && peer.trim() !== ''
            && delivered.has(peer) && typeof composition.currentGeneration === 'function' && delivered.get(peer) !== composition.currentGeneration()) throw new Error(WORKSPACE_SWITCHED)
          return await composition.call(operation.name as UnaryName<typeof OPERATIONS>, input, (generation) => {
            if (typeof peer === 'string' && peer.trim() !== '' && delivered.has(peer)) delivered.set(peer, generation)
          })
        } finally { endCall() }
      }
  }
  service.typertRemote = Object.freeze({ service, serviceKey: REMOTE_SERVICE, namespace: REMOTE_NAMESPACE })

  const dispose = (deadline?: number): Promise<void> => {
    if (disposal) return disposal
    let settle!: () => void
    let fail!: (error: unknown) => void
    // 先发布唯一任务，再执行可能同步重入的 owner、abort 和撤注册回调。
    disposal = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject })
    disposed = true
    void (async () => {
      const until = deadline ?? owner?.stop() ?? Date.now() + 1000
      lifetime.abort()
      // 同步撤准入；撤注册、service 与流清理共用剩余预算，单个失败不阻断其它清理。
      const cleanup = [unregisterRemote, provideDispose, ...streams].map((dispose) => {
        let task: Promise<unknown>
        try { task = Promise.resolve(dispose?.()) } catch (error) { task = Promise.reject(error) }
        return task.catch((error) => report('shutdownFailed', error))
      })
      if (!await drainUntil([...cleanup, ...(activeCalls > 0 ? [drained] : [])], until)) report('shutdownDeadlineExceeded')
    })().then(settle, fail)
    return disposal
  }
  try {
    owner?.signal.throwIfAborted()
    decorate(service)
    provideDispose = ctx.provide(REMOTE_SERVICE, service) ?? undefined
    owner?.signal.throwIfAborted()
    unregisterRemote = ctx.typert.register(remote.host)
  } catch (error) {
    await dispose(owner?.stop(error))
    throw error
  }
  return { service, dispose }
}
