import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHostComposition } from './host-composition.ts'
import { PROVIDER_CATALOG } from './host-providers.ts'
import { createPlanningLifetime, drainUntil } from './host-planning-lifetime.ts'
import { observeRootDisposal, type RootDisposalContext } from './host-surface.ts'
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
export async function apply(ctx: HostRemoteContext & RootDisposalContext & { effect(callback: () => (() => void) | Promise<() => void>, label?: string): unknown; get?: (name: string) => unknown }): Promise<void> {
  const lifetime = createPlanningLifetime(), acquisitions: Promise<unknown>[] = []
  let composition: Awaited<ReturnType<typeof createHostComposition>> | undefined
  let remote: Awaited<ReturnType<typeof installHostRemote>> | undefined
  let deadline: number | undefined, failure: unknown, disposal: Promise<void> | undefined
  const stop = (error?: unknown): number => {
    if (deadline === undefined) { deadline = Date.now() + 1000; failure = error; lifetime.stop(error); composition?.stop() }
    return deadline
  }
  const owner = { signal: lifetime.signal, stop }
  const dispose = () => disposal ??= (async () => {
    const end = stop(), withdrawing = remote?.dispose(end)
    await drainUntil(acquisitions, end)
    try { await withdrawing; await remote?.dispose(end) } finally { await composition?.dispose(end) }
  })()
  // 获取资源前建立根 owner；迟到 acquisition 自行释放，绝不向已停止根发布端点。
  ctx.effect(() => dispose, 'harness-projects: host composition')
  observeRootDisposal(ctx, dispose)
  try {
    const dataPath = await lifetime.wait(() => profileDataPath(ctx), Infinity)
    const opening = createHostComposition({
      owner, dataPath, workspaceId: WORKSPACE_ID, catalog: PROVIDER_CATALOG,
      sessionController: () => ctx.get?.('sessionController'),
      forceSessionStartFailure: process.env.HARNESS_PROJECTS_FORCE_SESSION_START_FAILURE === '1',
      resolveCredential: credentialResolverOf(ctx), migrationsDir: migrationsDir(),
    }).then(async (value) => { composition = value; if (lifetime.signal.aborted) await value.dispose(stop()); return value })
    acquisitions.push(opening)
    composition = await lifetime.wait(() => opening, Infinity)
    const installing = installHostRemote(ctx, composition, undefined, traceHostService, owner, composition.diagnoseShutdown)
      .then(async (value) => { remote = value; if (lifetime.signal.aborted) await value.dispose(stop()); return value })
    acquisitions.push(installing)
    await lifetime.wait(() => installing, Infinity)
    lifetime.assertActive()
    console.info('[harness-projects] host ready')
  } catch (error) {
    if (!lifetime.signal.aborted) stop(error)
    await dispose()
    if (failure !== undefined) throw failure
  }
}
