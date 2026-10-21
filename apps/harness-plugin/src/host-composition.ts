import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { composeCore, unavailableCore, type CoreApi } from '@harness-projects/core'
import { createController, streamWorkspace, type Controller, type WireStreamFrame } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { WorkspaceId } from '@harness-projects/domain'
import { createDiagnosticLog, describeError } from './host-diagnostics.ts'
import { dispatchOf, OPERATIONS, type UnaryHandlers, type UnaryName } from './host-operations.ts'
import { hostStoragePolicy, restoreProviders, type DisabledBinding, type ProviderCatalog } from './host-providers.ts'

/** Controller 失败上 wire 的唯一文案：原因只写进宿主诊断日志。 */
const OPERATION_FAILED = 'harness-projects：操作失败，原因已写入宿主诊断日志'

export interface HostCompositionOptions {
  readonly dataPath: string
  readonly workspaceId: WorkspaceId
  readonly catalog: ProviderCatalog
  /** 句柄 → 凭据值；每次 provider 操作才调用，Host 不缓存。 */
  readonly resolveCredential: (handle: string) => Promise<string | undefined>
  readonly migrationsDir?: string
  /** 缺省为调用时才读取的 `globalThis.fetch`（测试可替换）。 */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  /** watch 流两次 poll 之间的间隔（毫秒），缺省 1000；测试传 5。 */
  readonly watchIntervalMs?: number
}
export interface HostComposition {
  readonly controller: Controller
  /** 运行期无法构造而被禁用的挂载；只在内存，不写库。 */
  readonly disabled: readonly DisabledBinding[]
  call(name: UnaryName<typeof OPERATIONS>, input: unknown): Promise<unknown>
  /** 一代宿主流（#276）：每次 `next()` 都经 `guarded`；`signal` 中止即正常结束。 */
  watch(signal: AbortSignal): AsyncIterable<WireStreamFrame>
  dispose(): void
}

/** 每个 unary 操作一个 handler：只把已校验的输入透传给 Controller，结果与 `writeState` 不加工（Host 拥有权威状态）。 */
const HANDLERS: UnaryHandlers<typeof OPERATIONS, Controller> = {
  baseline: (controller) => controller.baseline(),
  bootstrapWorkspace: (controller, input) => controller.commands.bootstrapWorkspace(input),
}

export async function createHostComposition(options: HostCompositionOptions): Promise<HostComposition> {
  const dataDir = path.dirname(options.dataPath)
  await mkdir(dataDir, { recursive: true })
  const worktreesDir = path.join(await realpath(dataDir), 'worktrees')
  const log = createDiagnosticLog(path.join(dataDir, 'diagnostics.log'))
  /** Controller 的任何拒绝上 wire 前都经这里：原因先进诊断日志，调用方只看到固定文案。`closed` 与输入校验留在它之外（固定中文文案，不含运行期原文）。 */
  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run() } catch (error) {
      log.write('operationFailed', describeError(error))
      throw new Error(OPERATION_FAILED)
    }
  }
  let storage: SqliteStorage | undefined
  let closed = false
  try {
    storage = createSqliteStorage(options.dataPath, hostStoragePolicy(options.catalog), options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir })
    const workspace = await storage.getWorkspace(options.workspaceId)
    const { table, disabled } = workspace === undefined ? { table: {}, disabled: [] } : await restoreProviders(storage, workspace.id, options.catalog, {
      // 解析失败（例如宿主凭据服务缺席）只留允许名单字段；provider 随后把它归类为结构化 unavailable，不带原文。
      resolveCredential: (handle) => options.resolveCredential(handle).catch((error: unknown) => { log.write('credentialFailed', describeError(error)); throw error }),
      worktreesDir, fetch: options.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    })
    for (const item of disabled) log.write('bindingDisabled', { bindingId: item.bindingId, domain: item.domain, implementationKey: item.implementationKey, code: item.error.code })
    // 空数据根：不向 Core 传 storage，不写任何行；工作区的创建属于挂载写者（#127、#131）。
    const core: CoreApi = workspace === undefined ? unavailableCore('工作区尚未创建') : await composeCore({
      workspace: { id: workspace.id, name: workspace.name, statusPolicy: workspace.statusPolicy },
      providers: { ...table, storage },
      diagnostics: { syncRoundFailed: (error) => log.write('syncRoundFailed', describeError(error)) },
    })
    const controller = createController(core, { workspaceRevision: () => storage!.currentRevision(options.workspaceId) })
    const dispatch = dispatchOf(OPERATIONS, HANDLERS, guarded)
    return {
      controller,
      disabled,
      call: async (name, input) => { if (closed) throw new Error('host 已关闭'); return dispatch(controller, name, input) },
      watch: (signal) => {
        if (closed) throw new Error('host 已关闭')
        const frames = streamWorkspace(controller, { signal, intervalMs: options.watchIntervalMs ?? 1000 })
        return { [Symbol.asyncIterator]: () => ({ next: () => guarded(() => frames.next()), return: () => frames.return() }) }
      },
      dispose: () => { if (closed) return; closed = true; storage?.close() },
    }
  } catch (error) { storage?.close(); throw error }
}
