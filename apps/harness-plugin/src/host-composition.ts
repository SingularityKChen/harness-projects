import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { composeCore, unavailableCore, type CoreApi } from '@harness-projects/core'
import { createController, type Controller } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { CommandEnvelope } from '@harness-projects/controller'
import type { WorkspaceId } from '@harness-projects/domain'
import { createDiagnosticLog, describeError } from './host-diagnostics.ts'
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
}
export interface HostComposition {
  readonly controller: Controller
  /** 运行期无法构造而被禁用的挂载；只在内存，不写库。 */
  readonly disabled: readonly DisabledBinding[]
  call(name: 'baseline' | 'bootstrapWorkspace', input: unknown): Promise<unknown>
  dispose(): void
}
type Handler = (input: unknown) => Promise<unknown>

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  const prototype = value !== null && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined
  if (typeof value !== 'object' || value === null || (prototype !== Object.prototype && prototype !== null)) throw new TypeError(`${label} 必须是普通对象`)
  return value as Record<string, unknown>
}
function exactInput(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = plainRecord(value, label)
  const unknown = Object.keys(record).filter((key) => !keys.includes(key))
  if (unknown.length > 0) throw new TypeError(`${label} 含未知字段：${unknown.join(', ')}`)
  return record
}
function assertEnvelope(value: unknown): CommandEnvelope {
  const input = exactInput(value, ['actorRef', 'idempotencyKey'], 'bootstrapWorkspace')
  const actor = exactInput(input.actorRef, ['kind', 'id'], 'actorRef')
  if (typeof actor.kind !== 'string' || actor.kind.length === 0) throw new TypeError('actorRef.kind 必须是非空字符串')
  if (actor.id !== undefined && (typeof actor.id !== 'string' || actor.id.length === 0)) throw new TypeError('actorRef.id 必须是非空字符串')
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) throw new TypeError('idempotencyKey 必须是非空字符串')
  return { actorRef: { kind: actor.kind, ...(actor.id === undefined ? {} : { id: actor.id as string }) }, idempotencyKey: input.idempotencyKey }
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
    const handlers: Record<'baseline' | 'bootstrapWorkspace', Handler> = {
      baseline: async (input) => { exactInput(input, [], 'baseline'); return guarded(() => controller.baseline()) },
      bootstrapWorkspace: async (input) => { const envelope = assertEnvelope(input); return guarded(() => controller.commands.bootstrapWorkspace(envelope)) },
    }
    return {
      controller,
      disabled,
      call: async (name, input) => { if (closed) throw new Error('host 已关闭'); return handlers[name](input) },
      dispose: () => { if (closed) return; closed = true; storage?.close() },
    }
  } catch (error) { storage?.close(); throw error }
}
