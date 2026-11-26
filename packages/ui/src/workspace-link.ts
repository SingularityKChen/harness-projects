import type { WorkspaceCatalogueDTO, WorkspaceSetupDTO } from '@harness-projects/client'
import { parseItemRoute } from './item-route.ts'

export type WorkspaceLinkState = 'active' | 'open' | 'invalid' | 'failed'
export interface WorkspaceLinkPorts {
  readonly path: string | undefined
  getSetup(): Promise<WorkspaceSetupDTO>
  listWorkspaces(): Promise<WorkspaceCatalogueDTO>
  openWorkspace(workspaceId: string): Promise<'activated' | 'failed'>
  isCurrent?(): boolean
}
export async function resolveWorkspaceLink({ path, getSetup, listWorkspaces, openWorkspace, isCurrent = () => true }: WorkspaceLinkPorts): Promise<WorkspaceLinkState | undefined> {
  const target = path === undefined ? undefined : parseItemRoute(path)?.projectId
  if (target === undefined) return 'invalid'
  if (!isCurrent()) return undefined
  const setup = await getSetup()
  if (!isCurrent()) return undefined
  if (setup.workspace?.id === target) return 'active'
  const catalogue = await listWorkspaces()
  if (!isCurrent()) return undefined
  if (!catalogue.workspaces.some((entry) => entry.workspaceId === target)) return 'invalid'
  const opened = await openWorkspace(target)
  if (!isCurrent()) return undefined
  return opened === 'activated' ? 'open' : 'failed'
}
