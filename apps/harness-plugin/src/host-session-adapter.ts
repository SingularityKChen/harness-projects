import type { SessionEvent, SessionPort } from '@harness-projects/provider-execution-harness'

type RawService = Partial<Record<'create' | 'prompt' | 'page' | 'list', (...args: unknown[]) => unknown>>
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
      const events: SessionEvent[] = []
      let cut: number | undefined, before: number | undefined
      for (let page = 0; page < 100; page++) {
        const value = await call('page', [{ address: { kind: 'session', sessionId }, maxMessages: 50,
          ...(cut === undefined ? {} : { throughSeq: cut, beforeSeq: before }) }, signal], signal)
        if (!Number.isSafeInteger(value.cursor) || (value.cursor as number) < -1 || !Array.isArray(value.records)
          || typeof value.hasMore !== 'boolean' || (cut !== undefined && value.cursor !== cut)) throw unavailable()
        cut = value.cursor as number
        let next = before === undefined ? cut : before - 1
        const projected: SessionEvent[] = []
        for (const raw of [...value.records].reverse()) {
          const record = object(raw), event = object(record.event), data = object(event.data), source = object(data.source), reason = object(data.reason)
          if (record.type !== 'event' || !Number.isSafeInteger(event.seq) || event.seq !== next || next < 0 || typeof event.type !== 'string') throw unavailable()
          next--
          if (!['turn/start', 'turn/end', 'step/start', 'step/end', 'user/message'].includes(event.type)) continue
          if (event.type === 'user/message' && source.kind !== 'user') continue
          projected.push({ seq: event.seq as number, type: event.type,
            ...(typeof data.turn === 'number' ? { turn: data.turn } : {}),
            ...(event.type === 'user/message' && typeof source.rpcId === 'string' ? { rpcId: source.rpcId } : {}),
            ...(event.type === 'turn/end' && typeof reason.kind === 'string' ? { reason: { kind: reason.kind } } : {}),
          })
        }
        events.unshift(...projected.reverse())
        if (!value.hasMore) { if (next !== -1) throw unavailable(); return { events } }
        if (value.records.length === 0 || next < 0) throw unavailable()
        before = next + 1
      }
      throw unavailable()
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
