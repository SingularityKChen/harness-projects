/**
 * 客户端半边：构建成 `window.__ModuleLoader__.load` 包装的 bundle，只导出 `apply` 与 `inject`。
 *
 * 先在根 Context 上挂载 Remote，再在 `ctx.inject` 子 Context 中同时读取
 * `remote.harnessProjects` 与 `slots`；根 Context 不直接读取 namespace（M17）。
 */
import { createPlanningMappingSource, createPlanningRefreshSource, createExecutionContextReader, createWorkspaceSetupSource, createRepositoryBindingSource, createStartWork, createDeliveryLineageReader, createIssueClosingLinksReader, createIssueDependenciesReader, createChangeRequestCreator, createChangeRequestAssignees } from '@harness-projects/client'
import { HARNESS_PANEL_TITLE, PlaceholderIcon, bindWorkspaceStatusApp } from '@harness-projects/ui'
import { observeRootDisposal, type ClientContext, type RemoteResult } from './host-surface.ts'
import { CLIENT_REMOTE } from './remote.ts'
import { openWorkspaceWatch } from './workspace-watch.ts'

const PANEL_ID = 'harness-projects'
const unwrap = async (response: Promise<RemoteResult<unknown>>): Promise<unknown> => {
  const result = await response
  if (result.ok !== true) throw new Error('暂时无法读取宿主结果')
  return result.value
}

export const inject = ['remote']

export async function apply(ctx: ClientContext): Promise<void> {
  let unmount: (() => Promise<void>) | undefined, stopped = false, stopWait!: () => void
  const closed = new Promise<void>((resolve) => { stopWait = resolve })
  let disposal: Promise<void> | undefined
  const dispose = () => { stopped = true; stopWait(); return unmount ? disposal ??= Promise.resolve().then(unmount) : Promise.resolve() }
  ctx.effect(() => dispose, 'harness-projects: client remote')
  observeRootDisposal(ctx, dispose)
  await Promise.race([closed, ctx.remote.$mount(CLIENT_REMOTE).then((value) => { unmount = value; if (stopped) return dispose() })])
  if (stopped) return
  ctx.inject(['remote.harnessProjects', 'slots'], (child) => {
    try {
    // 监督者吸收一切终止、从不向调用方抛错：面板贡献是本 fiber 的 effect，回调抛错时 Cordis 卸载 fiber 会连带撤回面板（D38）
    const workspace = openWorkspaceWatch(child)
    child.effect(() => () => workspace.close(), 'harness-projects: workspace watch')
    const remote = child.remote.harnessProjects
    const planningRefresh = createPlanningRefreshSource({ source: workspace, refreshPlanning: () => unwrap(remote.refreshPlanning({ kind: 'user' })) })
    child.effect(() => () => planningRefresh.dispose(), 'harness-projects: planning refresh')
    const setup = createWorkspaceSetupSource({
      getWorkspaceSetup: () => unwrap(remote.getWorkspaceSetup()),
      createWorkspace: (...args) => unwrap(remote.createWorkspace(...args)),
      connectAccount: (...args) => unwrap(remote.connectAccount(...args)),
      bindPlanningSource: (...args) => unwrap(remote.bindPlanningSource(...args)),
      installExecutionBindings: (...args) => unwrap(remote.installExecutionBindings(...args)),
      refreshPlanning: () => planningRefresh.refresh(),
    }, { actorRef: { kind: 'user' } })
    child.effect(() => {
      let connected = false, seen = false
      const stop = workspace.subscribe(() => {
        const next = workspace.getSnapshot()?.connection.connected === true
        if (seen && !connected && next) void setup.refresh()
        seen ||= next; connected = next
      })
      void setup.refresh()
      return () => { stop(); setup.dispose() }
    }, 'harness-projects: workspace setup')
    const mapping = createPlanningMappingSource({ getPlanningMapping: () => unwrap(remote.getPlanningMapping()), setPlanningMapping: (actor, key, binding, project, mapping) => unwrap(remote.setPlanningMapping(actor, key, binding, project, { ...mapping })) }, { actorRef: { kind: 'user' } })
    child.effect(() => () => mapping.dispose(), 'harness-projects: planning mapping')
    const reader = createExecutionContextReader(async ({ workItemId, repositoryId }) => {
      const result = await child.remote.harnessProjects.getExecutionContext(workItemId, repositoryId)
      if (!result.ok) throw new Error('暂时无法读取执行状态')
      return result.value
    }, async ({ workItemId, repositoryId }) => {
      const result = await child.remote.harnessProjects.refreshExecutionRun({ kind: 'user' }, workItemId, repositoryId)
      if (!result.ok || result.value === null || typeof result.value !== 'object' || !('writeState' in result.value) || result.value.writeState !== 'local_only') throw new Error('暂时无法读取执行状态')
    })
    const repositoryBinding = createRepositoryBindingSource({ connectAccount: (...args) => unwrap(remote.connectAccount(...args)),
      bindRepository: (actor, key, id, refs) => unwrap(remote.bindRepository(actor, key, id, refs.map((ref) => ({ ...ref })))),
      baseline: () => unwrap(remote.baseline()),
    }, { actorRef: { kind: 'user' } })
    child.effect(() => () => repositoryBinding.dispose(), 'harness-projects: repository binding')
    const startWork = createStartWork({
      getStartWorkOptions: (...args) => unwrap(remote.getStartWorkOptions(...args)),
      startWork: (...args) => unwrap(remote.startWork(...args)),
    }, reader, { kind: 'user' })
    const assignees = createChangeRequestAssignees({
      options: (s, cursor) => unwrap(remote.listChangeRequestAssigneeOptions({ kind: 'user' }, s.workItemId, s.repositoryId, cursor, 50)),
      operation: (s, id) => unwrap(remote.getChangeRequestAssigneeOperation({ kind: 'user' }, s.workItemId, s.repositoryId, s.createOperationId, id)),
      add: (s, ids, key) => unwrap(remote.addChangeRequestAssignees({ kind: 'user' }, key, s.workItemId, s.repositoryId, s.createOperationId, [...ids])),
      resume: (s, id) => unwrap(remote.resumeChangeRequestAssignees({ kind: 'user' }, s.workItemId, s.repositoryId, s.createOperationId, id)),
    })
    const changeRequestCreator = { assignees, ...createChangeRequestCreator({ options: (...args) => unwrap(remote.getChangeRequestIssueOptions(...args)), create: (...args) => unwrap(remote.createChangeRequest(...args)), operation: (...args) => unwrap(remote.getChangeRequestOperation(...args)), resume: (...args) => unwrap(remote.resumeChangeRequest(...args)) }, { kind: 'user' }) }
    const deliveryReader = createDeliveryLineageReader({
      read: ({ workItemId, repositoryId }) => unwrap(remote.getDeliveryProjection(workItemId, repositoryId)),
      refresh: ({ workItemId, repositoryId }) => unwrap(remote.refreshDeliveryFacts({ kind: 'user' }, workItemId, repositoryId)),
    })
    const issueDependenciesReader = createIssueDependenciesReader({ refresh: ({ workItemId }) => unwrap(remote.refreshIssueDependencies({ kind: 'user' }, workItemId)) })
    const issueClosingLinksReader = createIssueClosingLinksReader({
      read: ({ workItemId }) => unwrap(remote.getIssueClosingLinks(workItemId)),
      refresh: ({ workItemId }) => unwrap(remote.refreshIssueClosingLinks({ kind: 'user' }, workItemId)),
    })
    const Panel = bindWorkspaceStatusApp(setup, workspace, reader, { repositoryBindingSource: repositoryBinding, startWork, deliveryReader, issueClosingLinksReader, issueDependenciesReader, changeRequestCreator, mappingSource: mapping, refreshSource: planningRefresh })
    child.slots.inject('main', () => child.slots.register({ name: 'main', key: PANEL_ID }, Panel))
    child.slots.inject('sidebar.panellist', () =>
      child.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 90, label: HARNESS_PANEL_TITLE },
      PlaceholderIcon,
      ),
    )
    } catch (error) { void dispose().catch(() => undefined); throw error }
  })
}
