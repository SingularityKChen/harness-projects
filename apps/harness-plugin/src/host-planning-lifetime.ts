const READS = new Set<PropertyKey>(['describeCapabilities', 'getProject', 'getPlanningItem', 'listPlanningItems', 'listFieldDefinitions', 'listIterations'])
const MAX_TIMEOUT_MS = 2_147_483_647
const timeoutError = () => Object.assign(new Error('Planning read deadline exceeded'), { name: 'PlanningReadTimeout' })

/** 所有卸载阶段消费同一绝对期限；底层晚拒绝始终有人接收。 */
export async function drainUntil(tasks: readonly PromiseLike<unknown>[], deadline: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([Promise.allSettled(tasks).then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())) })]) }
  finally { clearTimeout(timer) }
}

/** Host 内部等待边界：丢弃晚值、消费晚拒绝；写的中止以抛错交给 Core 保留不确定性。 */
export function createPlanningLifetime(timeoutMs = 30_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw new RangeError('Planning read timeout is invalid')
  const controller = new AbortController(), signal = controller.signal
  const assertActive = (): void => { signal.throwIfAborted() }
  const wait = <T>(run: () => T | PromiseLike<T>, deadline = Date.now() + timeoutMs): Promise<T> => {
    assertActive()
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.reject(timeoutError())
    return new Promise<T>((resolve, reject) => {
      const clean = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      const abort = (): void => { clean(); reject(signal.reason) }
      const timer = Number.isFinite(remaining) ? setTimeout(() => { clean(); reject(timeoutError()) }, remaining) : undefined
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve().then(() => { assertActive(); return run() }).then(
        (value) => { clean(); if (signal.aborted) reject(signal.reason); else if (Date.now() >= deadline) reject(timeoutError()); else resolve(value) },
        (error: unknown) => { clean(); reject(error) },
      )
    })
  }
  return {
    assertActive,
    signal, wait,
    stop: (reason: unknown = new Error('host 已关闭')) => { controller.abort(reason) },
    wrap: <T extends object>(provider: T, track: (task: Promise<unknown>) => Promise<unknown> = (task) => task, domain?: 'planning'): T => new Proxy({} as T, {
      get: (_target, key) => {
        const value: unknown = Reflect.get(provider, key, provider)
        if (typeof value !== 'function') return value
        if (key !== 'reconcile') return (...args: unknown[]) => wait(() => {
          if (key === 'startRun' && args[1]) {
            const lifecycle = args[1] as { retainRunIdentity(ref: unknown): Promise<void> }
            args[1] = { retainRunIdentity: (ref: unknown) => {
              assertActive()
              return track(Promise.resolve().then(() => { assertActive(); return lifecycle.retainRunIdentity(ref) })).then(() => { assertActive() })
            } }
          }
          return value.apply(provider, args)
        }, domain === 'planning' && READS.has(key) ? Date.now() + timeoutMs : Infinity)
        return (...args: unknown[]) => ({
          [Symbol.asyncIterator]() {
            assertActive()
            const deadline = domain === 'planning' ? Date.now() + timeoutMs : Infinity
            const iterator = (value.apply(provider, args) as AsyncIterable<unknown>)[Symbol.asyncIterator]()
            let ended = false
            const finish = (): void => {
              if (ended) return
              ended = true
              // IteratorClose 不得再等待一个不合作的 return；同步抛出和晚拒绝都只消费。
              try { Promise.resolve(iterator.return?.()).catch(() => undefined) } catch { /* best effort */ }
            }
            return {
              next: async () => {
                if (ended) return { done: true as const, value: undefined }
                try {
                  const result = await wait(() => iterator.next(), deadline)
                  if (result.done) ended = true
                  return result
                } catch (error) { finish(); throw error }
              },
              return: async () => { finish(); return { done: true as const, value: undefined } },
            }
          },
        })
      },
      has: (_target, key) => key in provider,
    }),
  }
}
