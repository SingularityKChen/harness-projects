/**
 * Harness Host/Client typed-remote seam.
 *
 * The descriptors are derived from the single declaration in `host-operations.ts`
 * (the repository does not ship the Typert generator). Host and Client must mount
 * the exact same descriptor objects.
 */

import { inputOfArguments, OPERATIONS, plainRecord, type Operation, type Operations, type StreamName, type UnaryName } from './host-operations.ts'

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
  call(name: UnaryName<typeof OPERATIONS>, input: unknown): Promise<unknown>
} & {
  /** 宿主流的帧序列；remote.ts 只透传并逐帧 JSON 化，不认识帧的类型（不 import controller）。 */
  readonly [K in StreamName<typeof OPERATIONS>]: (signal: AbortSignal) => AsyncIterable<unknown>
}

export interface HostRemoteContext {
  provide(name: string, value: unknown): (() => void | Promise<void>) | void
  typert: { register(contribution: HostRemoteContribution): (() => void) | (() => Promise<void>) }
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
    parameters: operation.params.map((p) => ({ name: p.name, wire: p.name, source: 'json' as const, codec: codec(p.type, p.parse) })),
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
  dispose(): Promise<void>
}

/** Install the live Cordis service and its strict Typert contribution. `remote` 缺省为生产的 `OPERATIONS`；测试可注入带夹具操作的声明。 */
export async function installHostRemote(
  ctx: HostRemoteContext,
  composition: HostCompositionCall,
  remote: { readonly operations: Operations; readonly host: HostRemoteContribution } = REMOTE,
): Promise<InstalledHostRemote> {
  let unregisterRemote: (() => void) | (() => Promise<void>)
  let provideDispose: (() => void | Promise<void>) | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  let activeCalls = 0
  const lifetime = new AbortController() // 卸载时先中止所有打开的流，再等它们的 finally 把在途计数归零
  let drainResolve: (() => void) | undefined
  const drained = new Promise<void>((resolve) => { drainResolve = resolve })
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
      // beginCall 在生成器体内：网关在第一次 next() 之前取消时计数不会泄漏。toJson 是流上唯一的严格编码点（网关不编码流项）。
      ? async function* (signal: AbortSignal) {
        beginCall()
        try {
          const frames = composition[operation.name as StreamName<typeof OPERATIONS>](AbortSignal.any([signal, lifetime.signal]))
          for await (const frame of frames) yield toJson(frame)
        } finally { endCall() }
      }
      : async (...args: unknown[]) => {
        beginCall()
        try { return await composition.call(operation.name as UnaryName<typeof OPERATIONS>, inputOfArguments(operation, args)) } finally { endCall() }
      }
  }
  service.typertRemote = Object.freeze({ service, serviceKey: REMOTE_SERVICE, namespace: REMOTE_NAMESPACE })

  try {
    provideDispose = ctx.provide(REMOTE_SERVICE, service) ?? undefined
    unregisterRemote = ctx.typert.register(remote.host)
  } catch (error) {
    await provideDispose?.()
    throw error
  }

  return {
    service,
    dispose: () => disposal ??= (async () => {
      disposed = true
      lifetime.abort()
      if (activeCalls > 0) await drained
      try { await unregisterRemote?.() } finally { await provideDispose?.() }
    })(),
  }
}
