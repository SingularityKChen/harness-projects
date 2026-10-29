import { Service, type Tracker } from '@deepseek-ai/cordis'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { HostAuthorityError, REMOTE_NAMESPACE } from './remote.ts'

/** Public Cordis tracing preserves the call-scoped receiver and the existing provide disposer. */
export function traceHostService(service: Record<string, unknown>): void {
  const tracker: Tracker = { property: 'ctx', associate: REMOTE_NAMESPACE }
  Object.defineProperty(service, Service.tracker, { value: tracker })
}

/** The launcher already resolved home, tilde and profile selection; never reconstruct them from env. */
export async function profileDataPath(ctx: { get?: (name: string) => unknown }): Promise<string> {
  const profile = ctx.get?.('profileContext') as { dir?: unknown } | undefined
  if (typeof profile?.dir !== 'string' || profile.dir.trim() === '' || !path.isAbsolute(profile.dir)) throw new HostAuthorityError('Host profile directory is unavailable')
  try {
    const directory = await realpath(profile.dir)
    if (!(await stat(directory)).isDirectory()) throw new Error('not a directory')
    return path.join(directory, 'harness-projects', 'workspace.sqlite')
  } catch { throw new HostAuthorityError('Host profile directory is unavailable') }
}
