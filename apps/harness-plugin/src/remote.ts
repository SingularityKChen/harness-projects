/**
 * Harness Host/Client typed-remote seam.
 *
 * The descriptor is intentionally hand-written: #228 only needs two unary
 * JSON methods and the repository does not ship the Typert generator. Host
 * and Client must mount the exact same descriptor objects.
 */

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
  readonly invocation: { readonly kind: 'direct' }
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

export interface HostCompositionCall {
  call(name: 'baseline' | 'bootstrapWorkspace', input: unknown): Promise<unknown>
}

export interface HostRemoteContext {
  provide(name: string, value: unknown): (() => void | Promise<void>) | void
  typert: { register(contribution: HostRemoteContribution): (() => void) | (() => Promise<void>) }
}

function plainRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object') throw new TypeError(`${label} 必须是普通对象`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} 必须是普通对象`)
  return value as JsonRecord
}

function exactRecord(value: unknown, keys: readonly string[], label: string): JsonRecord {
  const record = plainRecord(value, label)
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new TypeError(`${label} 含未知字段：${key}`)
  return record
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

function actorRef(value: unknown): JsonRecord {
  const record = exactRecord(value, ['kind', 'id'], 'actorRef')
  if (typeof record.kind !== 'string' || record.kind.length === 0) throw new TypeError('actorRef.kind 必须是非空字符串')
  if (record.id !== undefined && (typeof record.id !== 'string' || record.id.length === 0)) {
    throw new TypeError('actorRef.id 必须是非空字符串')
  }
  return record
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} 必须是非空字符串`)
  return value
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
const actorRefCodec = codec('ActorRef', actorRef)
const idempotencyKeyCodec = codec('IdempotencyKey', (value) => nonEmptyString(value, 'idempotencyKey'))

const baselineDescriptor: InvocationDescriptor = {
  id: `${REMOTE_PACKAGE}#${REMOTE_NAMESPACE}/baseline`,
  service: REMOTE_SERVICE,
  namespace: REMOTE_NAMESPACE,
  method: 'baseline',
  invocation: { kind: 'direct' },
  parameters: [],
  result: jsonOutput,
}

const bootstrapDescriptor: InvocationDescriptor = {
  id: `${REMOTE_PACKAGE}#${REMOTE_NAMESPACE}/bootstrapWorkspace`,
  service: REMOTE_SERVICE,
  namespace: REMOTE_NAMESPACE,
  method: 'bootstrapWorkspace',
  invocation: { kind: 'direct' },
  parameters: [
    { name: 'actorRef', wire: 'actorRef', source: 'json', codec: actorRefCodec },
    { name: 'idempotencyKey', wire: 'idempotencyKey', source: 'json', codec: idempotencyKeyCodec },
  ],
  result: jsonOutput,
}

const descriptors = Object.freeze([baselineDescriptor, bootstrapDescriptor])

export const HOST_REMOTE: HostRemoteContribution = Object.freeze({
  package: REMOTE_PACKAGE,
  face: 'host',
  schemas: [] as const,
  model: { services: [] as const, events: [] as const, objects: [] as const },
  invocations: descriptors,
})

export const CLIENT_REMOTE: ClientRemoteContribution = Object.freeze({
  package: REMOTE_PACKAGE,
  descriptors,
})

export interface InstalledHostRemote {
  readonly service: { baseline(): Promise<unknown>; bootstrapWorkspace(actor: unknown, idempotencyKey: unknown): Promise<unknown> }
  dispose(): Promise<void>
}

/** Install the live Cordis service and its strict Typert contribution. */
export async function installHostRemote(ctx: HostRemoteContext, composition: HostCompositionCall): Promise<InstalledHostRemote> {
  let unregisterRemote: (() => void) | (() => Promise<void>)
  let provideDispose: (() => void | Promise<void>) | undefined
  let disposed = false
  let disposal: Promise<void> | undefined
  let activeCalls = 0
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

  const service = {
    ctx,
    typertRemote: undefined as unknown,
    baseline: async () => {
      beginCall()
      try { return await composition.call('baseline', {}) } finally { endCall() }
    },
    bootstrapWorkspace: async (actor: unknown, idempotencyKey: unknown) => {
      beginCall()
      try {
        const normalizedActor = actorRef(actor)
        const normalizedKey = nonEmptyString(idempotencyKey, 'idempotencyKey')
        return await composition.call('bootstrapWorkspace', { actorRef: normalizedActor, idempotencyKey: normalizedKey })
      } finally { endCall() }
    },
  }
  service.typertRemote = Object.freeze({ service, serviceKey: REMOTE_SERVICE, namespace: REMOTE_NAMESPACE })

  try {
    provideDispose = ctx.provide(REMOTE_SERVICE, service) ?? undefined
    unregisterRemote = ctx.typert.register(HOST_REMOTE)
  } catch (error) {
    await provideDispose?.()
    throw error
  }

  return {
    service,
    dispose: () => disposal ??= (async () => {
      disposed = true
      if (activeCalls > 0) await drained
      try { await unregisterRemote?.() } finally { await provideDispose?.() }
    })(),
  }
}
