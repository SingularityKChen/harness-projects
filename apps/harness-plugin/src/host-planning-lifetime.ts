const READS = new Set<PropertyKey>(['describeCapabilities', 'getProject', 'getPlanningItem', 'listPlanningItems', 'listFieldDefinitions', 'listIterations'])
const MAX_TIMEOUT_MS = 2_147_483_647
const timeoutError = () => Object.assign(new Error('Planning read deadline exceeded'), { name: 'PlanningReadTimeout' })

/** 只结束 Core 等待的读边界；底层 Promise 的晚值被丢弃、晚拒绝被消费。写方法保持原 this 与确认语义。 */
export function createPlanningLifetime(timeoutMs = 30_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) throw new RangeError('Planning read timeout is invalid')
  let stopped = false
  const assertActive = (): void => { if (stopped) throw new Error('host 已关闭') }
  const wait = <T>(run: () => T | PromiseLike<T>, deadline = Date.now() + timeoutMs): Promise<T> => {
    assertActive()
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.reject(timeoutError())
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError()), remaining)
      Promise.resolve().then(run).then(
        (value) => { clearTimeout(timer); if (Date.now() >= deadline) reject(timeoutError()); else resolve(value) },
        (error: unknown) => { clearTimeout(timer); reject(error) },
      )
    })
  }
  return {
    assertActive,
    stop: () => { stopped = true },
    wrap: <T extends object>(provider: T): T => new Proxy({} as T, {
      get: (_target, key) => {
        const value: unknown = Reflect.get(provider, key, provider)
        if (typeof value !== 'function') return value
        if (READS.has(key)) return (...args: unknown[]) => wait(() => value.apply(provider, args))
        if (key !== 'reconcile') return value.bind(provider)
        return (...args: unknown[]) => ({
          [Symbol.asyncIterator]() {
            assertActive()
            const deadline = Date.now() + timeoutMs
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
