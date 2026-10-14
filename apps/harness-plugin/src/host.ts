import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CoreProviderTable } from '@harness-projects/core'
import { createHostComposition } from './host-composition.ts'
import { installHostRemote, type HostRemoteContext } from './remote.ts'

export const inject = ['typert', 'harnessProjectsProviders', 'credentials']

export interface HostCredentialService { resolve(reference: string): Promise<{ value: string; source: string } | undefined> }
/** 由 #132 实现。返回表的 binding id 必须跨启动稳定：WORKSPACE_ID 固定，随机 binding id 在同一数据根上再次 apply 会撞 workspace_binding 唯一约束。 */
export interface HostProviderFactory {
  create(input: { resolveCredential(reference: string): Promise<string | undefined> }): CoreProviderTable | Promise<CoreProviderTable>
}

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000228' as never

function dataPath(): string {
  const root = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
  return path.join(root, 'harness-projects', 'workspace.sqlite')
}

function migrationsDir(): string {
  const packaged = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
  if (existsSync(path.join(packaged, '001_init.sql'))) return packaged
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'storage', 'sqlite', 'migrations')
}

async function providerTableOf(ctx: HostRemoteContext & { get?: (name: string) => unknown; harnessProjectsProviders?: unknown; credentials?: HostCredentialService }): Promise<CoreProviderTable> {
  const supplied = ctx.get?.('harnessProjectsProviders') ?? ctx.harnessProjectsProviders
  if (typeof supplied !== 'object' || supplied === null || !('create' in supplied) || typeof supplied.create !== 'function') {
    throw new Error('Harness provider factory unavailable; #132 must supply the Host provider composition')
  }
  const credentialService = (ctx.get?.('credentials') ?? ctx.credentials) as HostCredentialService | undefined
  if (typeof credentialService !== 'object' || credentialService === null || typeof credentialService.resolve !== 'function') {
    throw new Error('Harness credential resolver unavailable; #132 must supply the Host credential service')
  }
  const table = await (supplied as HostProviderFactory).create({
    resolveCredential: async (reference) => {
      if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) throw new TypeError('credential reference is invalid')
      const hit = await credentialService.resolve(reference)
      return hit?.value
    },
  })
  if (typeof table !== 'object' || table === null) throw new Error('Harness provider factory unavailable; #132 must supply the Host provider composition')
  return table as CoreProviderTable
}

/** Host composition root: all stateful resources are created before the typed remote is registered. */
export async function apply(ctx: HostRemoteContext & { effect(callback: () => (() => void) | Promise<() => void>, label?: string): unknown; get?: (name: string) => unknown; harnessProjectsProviders?: unknown; credentials?: HostCredentialService }): Promise<void> {
  const providers = await providerTableOf(ctx)
  const composition = await createHostComposition({
    dataPath: dataPath(),
    workspace: { id: WORKSPACE_ID, name: 'Harness Projects' },
    providers,
    migrationsDir: migrationsDir(),
  })
  let remote: Awaited<ReturnType<typeof installHostRemote>> | undefined
  try {
    remote = await installHostRemote(ctx, composition)
    const installedRemote = remote
    ctx.effect(() => async () => {
      try { await installedRemote.dispose() } finally { composition.dispose() }
    }, 'harness-projects: host composition')
    console.info('[harness-projects] host ready')
  } catch (error) {
    try { await remote?.dispose() } finally { composition.dispose() }
    throw error
  }
}

export { createHostComposition } from './host-composition.ts'
