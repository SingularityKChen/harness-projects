/**
 * Host 远程操作的唯一声明处（#352，ADR-0013 Decision 2）。
 *
 * `OPERATIONS` 一次声明每个操作的名字、模式与参数；`remote.ts` 由它派生 descriptor 与 live service，
 * `host-composition.ts` 由它派生 `call` 分发，`host-surface.ts` 由它派生客户端代理类型。wire 校验函数也只有这一份。
 *
 * 零 import：本文件经 `client.ts → remote.ts` 被客户端 bundle 到达，不得拉入 core / controller（package-boundaries）。
 */

type JsonRecord = Record<string, unknown>

export function plainRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object') throw new TypeError(`${label} 必须是普通对象`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} 必须是普通对象`)
  return value as JsonRecord
}

/** 一次列出全部未知键，不只报第一个。 */
export function exactRecord(value: unknown, keys: readonly string[], label: string): JsonRecord {
  const record = plainRecord(value, label)
  const unknown = Object.keys(record).filter((key) => !keys.includes(key))
  if (unknown.length > 0) throw new TypeError(`${label} 含未知字段：${unknown.join(', ')}`)
  return record
}

export function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} 必须是非空字符串`)
  return value
}

/** 与 Controller 的 `ActorRef` 同形。 */
export interface ActorRefWire {
  readonly kind: string
  readonly id?: string
}

/** 规整为 `{ kind }` 或 `{ kind, id }`：Controller 实际收到的就是这个值。 */
function actorRef(value: unknown): ActorRefWire {
  const record = exactRecord(value, ['kind', 'id'], 'actorRef')
  const kind = nonEmptyString(record.kind, 'actorRef.kind')
  return record.id === undefined ? { kind } : { kind, id: nonEmptyString(record.id, 'actorRef.id') }
}

/**
 * 一个操作参数：`name` 同时是方法形参名、wire 名与 Host 输入记录的键；`type` 是 typeSymbol 的后缀。
 * `parse` 必须幂等（`parse(parse(x))` 与 `parse(x)` 相同）：同一个值会依次经网关 codec、`inputOfArguments` 与 Host 侧的 `parseInput` 各解析一次。
 */
export interface Param<N extends string = string, T = unknown> {
  readonly name: N
  readonly type: string
  readonly parse: (value: unknown) => T
}

export const param = <N extends string, T>(name: N, type: string, parse: (value: unknown) => T): Param<N, T> => ({ name, type, parse })

/** 与 Controller 的 `CommandEnvelope` 同形：需要幂等信封的命令展开它。 */
const ENVELOPE = [
  param('actorRef', 'ActorRef', actorRef),
  param('idempotencyKey', 'IdempotencyKey', (value) => nonEmptyString(value, 'idempotencyKey')),
] as const

/** 流在类型上不允许业务参数：Host 只会把取消 signal 追加为最后一个参数。 */
type Body =
  | { readonly mode: 'unary'; readonly params: readonly Param[] }
  | { readonly mode: 'stream'; readonly params: readonly [] }

export type Operation<N extends string = string, B extends Body = Body> = B & { readonly name: N }
export type Operations = Readonly<Record<string, Operation>>

/** 名字取自键、只写一次；键序即 descriptor 顺序。 */
export function defineOperations<const T extends Record<string, Body>>(bodies: T): { readonly [K in keyof T & string]: Operation<K, T[K]> } {
  const entries = Object.entries(bodies).map(([name, body]) => [name, Object.freeze({ ...body, name })])
  return Object.freeze(Object.fromEntries(entries)) as { readonly [K in keyof T & string]: Operation<K, T[K]> }
}

/** `watch` 追加在末尾：descriptor 的 `invocations[0]` 仍是 `baseline`。 */
export const OPERATIONS = defineOperations({
  baseline: { mode: 'unary', params: [] },
  bootstrapWorkspace: { mode: 'unary', params: ENVELOPE },
  watch: { mode: 'stream', params: [] },
})

export type UnaryName<O extends Operations> = { [K in keyof O & string]: O[K]['mode'] extends 'unary' ? K : never }[keyof O & string]
export type StreamName<O extends Operations> = { [K in keyof O & string]: O[K]['mode'] extends 'stream' ? K : never }[keyof O & string]
/** 客户端代理方法的位置参数。 */
export type ArgsOf<P extends readonly Param[]> = { readonly [I in keyof P]: P[I] extends Param<string, infer T> ? T : never }
/** Host 侧经 `parseInput` 校验后交给 handler 的输入记录。 */
export type InputOf<O extends Operation> = { readonly [P in O['params'][number] as P['name']]: ReturnType<P['parse']> }

/** 每个 unary 操作恰好一个 handler：漏写或多写过不了 `tsc`。`A` 是装配（今天是 Controller），由调用方在每次分发时给出。 */
export type UnaryHandlers<O extends Operations, A> = {
  readonly [K in UnaryName<O>]: (assembly: A, input: InputOf<O[K]>) => Promise<unknown>
}

/** 按声明校验并规整 Host 输入记录；label 是操作名。 */
export function parseInput(operation: Operation, input: unknown): JsonRecord {
  const record = exactRecord(input, operation.params.map((p) => p.name), operation.name)
  return Object.fromEntries(operation.params.map((p) => [p.name, p.parse(record[p.name])]))
}

/** live service 方法的位置参数 → 校验过的输入记录（与 Host 侧是同一套校验）。 */
export function inputOfArguments(operation: Operation, args: readonly unknown[]): JsonRecord {
  return parseInput(operation, Object.fromEntries(operation.params.map((p, index) => [p.name, args[index]])))
}

/**
 * Host 侧 `call` 的分发：输入校验在 `guard` 之外（固定中文文案，不含运行期原文），handler 在 `guard` 之内。
 * 装配由调用方每次传入，所以 handler 表可以放在模块级。
 */
export function dispatchOf<O extends Operations, A>(
  operations: O,
  handlers: UnaryHandlers<O, A>,
  guard: <T>(run: () => Promise<T>) => Promise<T>,
): (assembly: A, name: UnaryName<O>, input: unknown) => Promise<unknown> {
  const table = handlers as unknown as Readonly<Record<string, (assembly: A, input: JsonRecord) => Promise<unknown>>>
  return async (assembly, name, input) => {
    const parsed = parseInput(operations[name as keyof O] as Operation, input)
    return guard(() => table[name]!(assembly, parsed))
  }
}
