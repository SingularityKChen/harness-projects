import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { composeCore, type CoreProviderTable, type CoreWorkspaceInput } from '@harness-projects/core'
import { createController, type Controller } from '@harness-projects/controller'
import { createSqliteStorage, type SqliteStorage } from '@harness-projects/storage-sqlite'
import type { CommandEnvelope } from '@harness-projects/controller'

export interface HostCompositionOptions {
  readonly dataPath: string
  readonly workspace: CoreWorkspaceInput
  readonly providers: CoreProviderTable
  readonly migrationsDir?: string
}
export interface HostComposition {
  readonly controller: Controller
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
  await mkdir(path.dirname(options.dataPath), { recursive: true })
  let storage: SqliteStorage | undefined
  let closed = false
  try {
    storage = createSqliteStorage(options.dataPath, undefined, options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir })
    const core = await composeCore({ ...options, providers: { ...options.providers, storage } })
    const controller = createController(core, { workspaceRevision: () => storage!.currentRevision(options.workspace.id!) })
    const handlers: Record<'baseline' | 'bootstrapWorkspace', Handler> = {
      baseline: async (input) => { if (closed) throw new Error('host 已关闭'); exactInput(input, [], 'baseline'); return controller.baseline() },
      bootstrapWorkspace: async (input) => { if (closed) throw new Error('host 已关闭'); return controller.commands.bootstrapWorkspace(assertEnvelope(input)) },
    }
    return {
      controller,
      call: async (name, input) => { if (closed) throw new Error('host 已关闭'); return handlers[name](input) },
      dispose: () => { if (closed) return; closed = true; storage?.close() },
    }
  } catch (error) { storage?.close(); throw error }
}
