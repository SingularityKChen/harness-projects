import type { SessionEvent, SessionPort } from '@harness-projects/provider-execution-harness'

type RawService = Partial<Record<'create' | 'prompt' | 'inspect' | 'list', (...args: unknown[]) => unknown>>
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const unavailable = () => new Error('Harness session service unavailable')

/** raw 服务只在操作内解析；保留 receiver，固定投影丢弃 prompt、模型错误原文与服务额外字段。 */
export function createHostSessionPort(resolve: () => unknown, forceStartFailure = false): SessionPort {
  const call = async (name: keyof RawService, args: unknown[], signal?: AbortSignal): Promise<Record<string, unknown>> => {
    signal?.throwIfAborted()
    let service: RawService | undefined
    try { service = resolve() as RawService | undefined } catch { throw unavailable() }
    const method = service?.[name]
    if (typeof method !== 'function') throw unavailable()
    const result = await method.apply(service, args)
    signal?.throwIfAborted()
    return object(result)
  }
  return {
    async create(input) {
      if (forceStartFailure) throw unavailable()
      const value = await call('create', [input])
      if (typeof value.sessionId !== 'string') throw unavailable()
      return { sessionId: value.sessionId }
    },
    async prompt(input, signal) {
      const value = await call('prompt', [input, signal], signal)
      if (typeof value.accepted !== 'boolean') throw unavailable()
      return { accepted: value.accepted }
    },
    async inspect(sessionId, signal) {
      const value = await call('inspect', [sessionId, signal], signal)
      if (!Array.isArray(value.events)) throw unavailable()
      const events: SessionEvent[] = []
      for (const raw of value.events) {
        const event = object(raw), data = object(event.data), source = object(data.source), reason = object(data.reason)
        if (!Number.isInteger(event.seq) || typeof event.type !== 'string') continue
        if (!['turn/start', 'turn/end', 'step/start', 'step/end', 'user/message'].includes(event.type)) continue
        if (event.type === 'user/message' && source.kind !== 'user') continue
        events.push({ seq: event.seq as number, type: event.type,
          ...(typeof data.turn === 'number' ? { turn: data.turn } : {}),
          ...(event.type === 'user/message' && typeof source.rpcId === 'string' ? { rpcId: source.rpcId } : {}),
          ...(event.type === 'turn/end' && typeof reason.kind === 'string' ? { reason: { kind: reason.kind } } : {}),
        })
      }
      return { events }
    },
    async list(input, signal) {
      const value = await call('list', [input, signal], signal)
      if (!Array.isArray(value.items)) throw unavailable()
      return { items: value.items.flatMap((raw) => {
        const row = object(raw)
        return typeof row.sessionId === 'string' && typeof row.running === 'boolean' ? [{ sessionId: row.sessionId, running: row.running }] : []
      }) }
    },
  }
}
