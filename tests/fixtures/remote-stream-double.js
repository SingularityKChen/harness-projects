/**
 * 宿主 `RemoteStream` 的替身与载体夹具（issue #276）。按 DeepSeek Harness 0.2.0-rc.2 的
 * `dsh-api-gateway/lib/types/client/remote-stream.js` 语义手写（ExecPlan Context H5，行号只对该版本成立），不依赖宿主包：
 * 每次打开 `++generation`；`restart()` 中止当前代并立即重开；只有 `RemoteStreamCarrierError` 先回调 `carrierFailed` 再重试；
 * 正常结束抛 `ended(accepted)`；`accept()` 清零重试计数；在线时未 accept 的连续第二次载体失败终止，离线时等上线；`dispose()` 幂等。
 * 宿主升级后可能漂移，CI 发现不了（TD-060）：本机设 `HARNESS_GATEWAY_CLIENT` 指向宿主 `lib/types/client` 目录，换成真实类重跑。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export class RemoteStreamCarrierError extends Error {}

export class RemoteStream {
  #lifetime = new AbortController()
  #current
  #iterator
  #closing
  #revision = 0

  constructor(connection, options) {
    this.connection = connection
    this.options = options
  }

  restart() {
    if (this.#lifetime.signal.aborted) return
    this.#revision += 1
    this.#current?.abort()
  }

  dispose() {
    this.#lifetime.abort()
    this.#current?.abort()
    return this.#closing ??= Promise.resolve(this.#iterator?.return()).then(() => undefined, () => undefined)
  }

  [Symbol.asyncIterator]() { return (this.#iterator = this.#read()) }

  #online(signal) {
    const { generation } = this.connection
    return generation.getSnapshot() !== undefined ? Promise.resolve() : new Promise((resolve) => {
      const stop = generation.subscribe(() => { if (generation.getSnapshot() !== undefined) { stop(); resolve() } })
      signal.addEventListener('abort', () => { stop(); resolve() }, { once: true })
    })
  }

  async *#read() {
    const lifetime = this.#lifetime.signal
    let generation = 0
    let failures = 0
    let seen = 0
    try {
      while (!lifetime.aborted) {
        if (seen !== this.#revision) { seen = this.#revision; failures = 0 }
        const own = (this.#current = new AbortController())
        const signal = AbortSignal.any([lifetime, own.signal])
        const id = (generation += 1)
        let accepted = false
        try {
          for await (const value of this.options.open(signal)) {
            if (lifetime.aborted) return
            if (seen !== this.#revision) break
            yield { generation: id, value, signal, accept: () => { if (this.#current === own && seen === this.#revision) { accepted = true; failures = 0 } } }
          }
          if (lifetime.aborted) return
          if (seen !== this.#revision) continue
          throw this.options.ended(accepted)
        } catch (error) {
          if (lifetime.aborted) return
          if (seen !== this.#revision) continue
          if (!(error instanceof RemoteStreamCarrierError)) throw error
          this.options.carrierFailed?.(error)
          failures += 1
          if (this.connection.generation.getSnapshot() !== undefined && failures > 1) throw error
          await this.#online(signal)
        } finally {
          own.abort()
          this.#current = undefined
        }
      }
    } finally {
      this.#lifetime.abort()
    }
  }
}

/** 起始在线；`generation.getSnapshot()` 在线时返回对象、离线返回 undefined；`setOnline` 通知订阅者。 */
export function createConnection() {
  let snapshot = {}
  const listeners = new Set()
  return {
    generation: { getSnapshot: () => snapshot, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) } },
    setOnline(value) { snapshot = value ? {} : undefined; for (const listener of [...listeners]) listener() },
  }
}

/** 载体：把 `service.watch` 当作 socket 上的一条流，每项 JSON 往返后交付并记入 `frames`；`break()` 中止当前 socket 并换新的。 */
export function createCarrier(CarrierError) {
  let socket = new AbortController()
  const carrier = {
    frames: [],
    opened: 0,
    break() { socket.abort(); socket = new AbortController() },
    open(service, signal) {
      carrier.opened += 1
      const own = socket
      const iterator = service.watch(AbortSignal.any([signal, own.signal]))
      const closed = new Promise((_, reject) => own.signal.addEventListener('abort', () => reject(new CarrierError('socket closed')), { once: true }))
      closed.catch(() => undefined)
      return (async function* () {
        try {
          for (let step = await Promise.race([iterator.next(), closed]); !step.done; step = await Promise.race([iterator.next(), closed])) {
            const value = JSON.parse(JSON.stringify(step.value))
            carrier.frames.push(value)
            yield value
          }
        } finally { await iterator.return() }
      })()
    },
  }
  return carrier
}

/** 本机交叉核对：`HARNESS_GATEWAY_CLIENT` 指向宿主 `lib/types/client` 目录时换成真实类；CI 不设。 */
export async function loadRemoteStream() {
  const dir = process.env.HARNESS_GATEWAY_CLIENT
  if (!dir) return { RemoteStream, RemoteStreamCarrierError }
  const load = (file) => import(pathToFileURL(path.join(dir, file)).href)
  const [stream, client] = await Promise.all([load('remote-stream.js'), load('stream-client.js')])
  return { RemoteStream: stream.RemoteStream, RemoteStreamCarrierError: client.RemoteStreamCarrierError }
}
