import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHostComposition } from './host-composition.ts'
import { PROVIDER_CATALOG } from './host-providers.ts'
import { installHostRemote, type HostRemoteContext } from './remote.ts'
import { profileDataPath, traceHostService } from './host-authority.ts'

/** provider 由 `host-providers.ts` 的编译期目录构造（ADR-0014）；凭据服务不进 inject：必需服务缺席时 Cordis 让插件静默停在 PENDING。 */
export const inject = ['typert']

export interface HostCredentialService { resolve(reference: string): Promise<{ value: string; source: string } | undefined> }

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000228' as never

function migrationsDir(): string {
  const packaged = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
  if (existsSync(path.join(packaged, '001_init.sql'))) return packaged
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'storage', 'sqlite', 'migrations')
}

/** 凭据适配器：每次解析都经 `ctx.get` 取当前活跃的服务，服务与值都不缓存；服务缺席时该次解析以 `CredentialServiceUnavailable` 拒绝。 */
function credentialResolverOf(ctx: { get?: (name: string) => unknown }): (reference: string) => Promise<string | undefined> {
  return async (reference) => {
    if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) throw new TypeError('credential reference is invalid')
    const service = ctx.get?.('credentials') as HostCredentialService | undefined
    if (typeof service?.resolve !== 'function') throw Object.assign(new Error('Harness credential service unavailable'), { name: 'CredentialServiceUnavailable' })
    const hit = await service.resolve(reference)
    return hit?.value
  }
}

/** Host composition root: all stateful resources are created before the typed remote is registered. */
export async function apply(ctx: HostRemoteContext & { effect(callback: () => (() => void) | Promise<() => void>, label?: string): unknown; get?: (name: string) => unknown }): Promise<void> {
  const composition = await createHostComposition({
    dataPath: await profileDataPath(ctx),
    workspaceId: WORKSPACE_ID,
    catalog: PROVIDER_CATALOG,
    sessionController: () => ctx.get?.('sessionController'),
    forceSessionStartFailure: process.env.HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE === '1',
    resolveCredential: credentialResolverOf(ctx),
    migrationsDir: migrationsDir(),
  })
  let remote: Awaited<ReturnType<typeof installHostRemote>> | undefined
  try {
    remote = await installHostRemote(ctx, composition, undefined, traceHostService)
    const installedRemote = remote
    // I7：先撤回 remote 并等在途调用排空，再关闭 SQLite；两者不得交换。
    ctx.effect(() => async () => {
      composition.stop()
      try { await installedRemote.dispose() } finally { await composition.dispose() }
    }, 'harness-projects: host composition')
    console.info('[harness-projects] host ready')
  } catch (error) {
    composition.stop()
    try { await remote?.dispose() } finally { await composition.dispose() }
    throw error
  }
}
