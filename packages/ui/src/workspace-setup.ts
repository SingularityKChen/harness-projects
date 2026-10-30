import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { PlanningMappingSource, PlanningRefreshSource, WorkspaceSetupSource, ExecutionContextReader, RepositoryBindingSource, StartWork, DeliveryLineageReader } from '@harness-projects/client'
import { workspaceSetupView } from '@harness-projects/ui-model'
import { PlanningMappingForm } from './planning-mapping.ts'
import { RepositoryBindingForm } from './repository-binding.ts'
import { WorkItemApp, type WorkspaceSource } from './work-item-app.ts'
import { WorkspaceSettings } from './workspace-settings.ts'
import { WORKSPACE_STYLES } from './workspace-presentation.ts'
import { FORM_STYLES, focusFormError } from './form-presentation.ts'
import type { DOMElement } from './work-item-detail.ts'
type SettingsScrollElement = DOMElement & { scrollTop: number; getBoundingClientRect?(): { top: number; bottom: number } }
/** 唯一工作区设置门：仅持草稿与导航；确认状态和工作区 identity 全部来自 Host。 */
export function WorkspaceSetupGate({ setupSource, source, executionReader, repositoryBindingSource, startWork, deliveryReader, mappingSource, refreshSource }: { readonly mappingSource?: PlanningMappingSource | undefined; readonly refreshSource?: PlanningRefreshSource | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly startWork?: StartWork | undefined; readonly repositoryBindingSource?: RepositoryBindingSource | undefined; readonly setupSource: WorkspaceSetupSource; readonly source: WorkspaceSource; readonly executionReader?: ExecutionContextReader | undefined }): ReactElement {
  const snapshot = useSyncExternalStore(setupSource.subscribe, setupSource.getSnapshot, setupSource.getSnapshot)
  const read = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const [editScope, setEditScope] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<{ scope: string; name?: string; project?: string } | undefined>(undefined)
  const [navigation, setNavigation] = useState<{ source: WorkspaceSetupSource; view: 'workspace' | 'settings' } | undefined>(undefined), [visited, setVisited] = useState<string | undefined>(undefined)
  const identity = useRef({ setupSource, repositoryBindingSource, mappingSource, generation: 0 })
  if (identity.current.setupSource !== setupSource || identity.current.repositoryBindingSource !== repositoryBindingSource || identity.current.mappingSource !== mappingSource) identity.current = { setupSource, repositoryBindingSource, mappingSource, generation: identity.current.generation + 1 }
  const initiator = useRef<DOMElement | null>(null), returnFocus = useRef(false)
  const root = useRef<SettingsScrollElement | null>(null), body = useRef<SettingsScrollElement | null>(null), taskEntry = useRef(false), shown = useRef<string | undefined>(undefined)
  const form = useRef<DOMElement | null>(null), errors = useRef<DOMElement | null>(null), submitted = useRef(false), submittedFrom = useRef<DOMElement | null>(null)
  useEffect(() => {
    if (!snapshot.pending && submitted.current) {
      submitted.current = false
      const origin = submittedFrom.current, doc = (globalThis as { document?: { activeElement?: DOMElement | null; body?: DOMElement | null } }).document
      if ((snapshot.error || snapshot.setup?.error || snapshot.setup?.activationError) && !origin?.closest?.('[hidden],[inert]') && (!doc?.activeElement || doc.activeElement === doc.body || doc.activeElement === origin || origin?.contains?.(doc.activeElement))) focusFormError(errors.current)
    }
  }, [snapshot])
  useEffect(() => () => { submitted.current = false }, [setupSource])
  const setup = snapshot.setup, view = workspaceSetupView(snapshot, 'GitHub')
  const scope = JSON.stringify([identity.current.generation, setup?.workspace?.id, setup?.planning.bindingId, setup?.planning.projectNodeId])
  const name = draft?.scope === scope ? draft.name ?? '' : '', project = draft?.scope === scope ? draft.project : undefined
  const confirmed = setup?.planning.state === 'confirmed' && setup.workspace !== null
  const settings = navigation?.source === setupSource ? navigation.view === 'settings' : !setup || setup.workspace === null || !['unbound', 'confirmed'].includes(setup.planning.state)
  const mounted = settings || visited === scope || (setup?.planning.state === 'unbound' && repositoryBindingSource !== undefined)
  const readable = read?.capabilities?.some(entry => entry.key === 'planning.item.read' && ['available', 'read_only', 'degraded'].includes(entry.access)) === true
  const list = confirmed && read?.workspace.id === setup.workspace.id && readable && !settings
  const stage = settings ? setup === undefined ? 'loading' : setup.workspace === null ? 'create' : 'connect' : list ? 'list' : 'summary'
  useEffect(() => {
    if (mounted && mappingSource && setup?.workspace && setup.planning.bindingId && setup.planning.projectNodeId) void mappingSource.refresh({ workspaceId: setup.workspace.id, bindingId: setup.planning.bindingId, projectExternalId: setup.planning.projectNodeId })
  }, [mounted, mappingSource, setup?.workspace?.id, setup?.planning.bindingId, setup?.planning.projectNodeId])
  const enter = (): void => {
    initiator.current = (globalThis as { document?: { activeElement?: DOMElement } }).document?.activeElement ?? null
    if (body.current) body.current.scrollTop = 0
    taskEntry.current = true
    setVisited(scope); setNavigation({ source: setupSource, view: 'settings' })
  }
  const leave = (): void => { setVisited(scope); returnFocus.current = true; setNavigation({ source: setupSource, view: 'workspace' }) }
  useEffect(() => {
    const previous = shown.current; shown.current = stage
    const doc = (globalThis as { document?: { activeElement?: DOMElement | null; body?: DOMElement | null } }).document
    if (returnFocus.current) {
      returnFocus.current = false
      const target = initiator.current
      if (target?.isConnected !== false && target?.focus && !target.closest?.('[hidden],[inert]')) target.focus()
      else root.current?.querySelector?.('h2')?.focus?.()
    } else if (previous && previous !== stage && (!doc?.activeElement || doc.activeElement === doc.body || doc.activeElement.isConnected === false || doc.activeElement.closest?.('[hidden],[inert]'))) root.current?.querySelector?.('h2')?.focus?.()
    if (taskEntry.current) {
      taskEntry.current = false
      if (body.current) body.current.scrollTop = 0
      if (root.current) root.current.scrollTop = 0
      let target = body.current?.querySelector?.('.hp-settings-chooser') as SettingsScrollElement | null | undefined
      if (!target?.getClientRects?.().length) target = body.current?.querySelector?.('.hp-settings-nav [aria-current]') as SettingsScrollElement | null | undefined
      for (const frame of [body.current, root.current]) {
        const item = target?.getBoundingClientRect?.(), viewport = frame?.getBoundingClientRect?.()
        if (frame && item && viewport) frame.scrollTop += item.top < viewport.top ? item.top - viewport.top : item.bottom > viewport.bottom ? item.bottom - viewport.bottom : 0
      }
    }
  }, [stage])
  const submit = (): void => { if (setup?.workspace === null) void setupSource.create(name); else void setupSource.connect(project ?? setup?.planning.projectNodeId ?? '') }
  const recovery = (): void => {
    if (snapshot.failure === 'read') void setupSource.refresh()
    else if (view.recovery?.action === 'refresh') void setupSource.refresh(setup?.planning.state === 'degraded')
    else if (snapshot.failure === 'install') void setupSource.installExecution()
    else if (snapshot.failure === 'create') void setupSource.create(name)
    else if (snapshot.failure === 'connect') void setupSource.connect(project ?? setup?.planning.projectNodeId ?? '')
    else if (!setup) void setupSource.refresh()
    else if (setup?.planning.state === 'degraded' && !setup.activationError) void setupSource.refresh(true)
    else submit()
  }
  const button = (label: string, action: () => void, primary = false): ReactElement => h('button', { className: primary ? 'hp-action hp-action-primary' : 'hp-action', type: 'button', disabled: snapshot.pending, onClick: (event?: { currentTarget: DOMElement }) => { submitted.current = true; submittedFrom.current = event?.currentTarget ?? form.current; action() } }, label)
  const errorSummary = (id = 'setup-error'): ReactElement | null => view.error ? h('div', { id, className: 'hp-form-notice', role: 'alert', tabIndex: -1, 'data-form-error': true }, h('strong', null, '工作区设置未完成'), h('p', null, view.error.code === 'result_unknown' || view.error.code === 'ambiguous_result' ? '结果未知，请重新读取确认。' : view.error.message), h('p', null, '草稿已保留，请按以下提示恢复。'), view.recovery?.action ? button(view.recovery.label, recovery) : h('p', null, view.recovery?.label)) : null
  const recoveryOutlet = h('div', { key: 'setup-recovery', ref: errors }, errorSummary()), children: ReactElement[] = []
  if (!setup) { children.push(recoveryOutlet); if (!view.error) children.push(h('p', null, '正在读取工作区设置。')) }
  else {
    const creating = setup.workspace === null, id = creating ? 'workspace-name' : 'project-node-id'
    const editing = creating || !confirmed || editScope === scope || snapshot.pending || view.error !== undefined
    const planning: ReactElement[] = [h('div', { key: 'summary', hidden: editing },
      h('p', { role: 'status' }, '规划连接已确认。'), h('p', null, `GitHub Project：${setup.planning.projectNodeId ?? ''}`),
      h('button', { className: 'hp-action hp-action-primary', type: 'button', onClick: () => setEditScope(scope) }, '编辑连接'))]
    planning.push(h('form', { key: 'planning', hidden: !editing, className: 'hp-form', 'aria-label': creating ? '创建工作区' : '规划连接', ref: form, 'aria-busy': snapshot.pending, onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); submitted.current = true; submittedFrom.current = form.current; submit() } },
      h('h3', null, creating ? '工作区' : '规划连接'), h('div', { className: 'hp-field' },
      h('label', { htmlFor: id }, creating ? '工作区名称' : 'GitHub Project node ID'),
      h('input', { id, 'aria-describedby': `${id}-help${view.error ? ' setup-error' : ''}`, value: creating ? name : project ?? setup.planning.projectNodeId ?? '', disabled: snapshot.pending, required: true, onChange: (event: { target: { value: string } }) => { setEditScope(scope); setDraft({ ...(draft?.scope === scope ? draft : {}), scope, [creating ? 'name' : 'project']: event.target.value }) } }),
      h('p', { id: `${id}-help` }, creating ? '为这个项目选择一个清楚的工作区名称。' : '从 GitHub 项目设置复制 Project node ID。')),
      h('div', { className: 'hp-form-actions' }, h('button', { className: 'hp-action hp-action-primary', type: 'submit', disabled: snapshot.pending }, snapshot.pending ? '正在处理' : creating ? '创建工作区' : '连接项目'))))
    if (view.notice) planning.push(h('p', { key: 'notice', className: 'hp-form-notice', role: 'status', 'aria-live': 'polite' }, view.notice))
    if ((setup.planning.state === 'configured' || setup.planning.state === 'degraded') && !view.error) planning.push(button('重新读取', () => { void setupSource.refresh(setup.planning.state === 'degraded') }))
    if (creating) children.push(recoveryOutlet, ...planning)
    else children.push(h(WorkspaceSettings, { children: [
      h('div', { key: 'context' }, h('p', null, `当前工作区：${setup.workspace!.name}`), recoveryOutlet),
      h('div', { key: 'planning' }, ...planning),
      setup.planning.bindingId && setup.planning.projectNodeId && mappingSource ? h(PlanningMappingForm, { key: 'mapping', source: mappingSource }) : h('p', { key: 'mapping' }, !setup.planning.bindingId || !setup.planning.projectNodeId ? '先完成规划连接，确认项目后再设置字段映射。' : '当前宿主未提供字段映射。请检查宿主的规划设置能力。'),
      h('section', { key: 'execution', className: 'hp-form', 'aria-label': '执行' }, setup.executionInstalled ? h('p', { role: 'status' }, 'Harness 执行绑定已启用；会话与模型状态由执行时确认。') : h('div', null, h('p', null, '尚无已确认的执行绑定。'), !view.error ? button('启用 Harness 执行', () => { void setupSource.installExecution() }, true) : null)),
      repositoryBindingSource ? h(RepositoryBindingForm, { key: 'repository', source: repositoryBindingSource }) : h('p', { key: 'repository' }, '当前宿主未提供仓库绑定。请检查宿主的研发设置能力。')
    ] }))
  }
  if (snapshot.pending) children.push(h('p', { key: 'pending', role: 'status', 'aria-live': 'polite' }, '正在处理，请稍候。'))
  const workspace = list ? h(WorkItemApp, { source, refreshSource, executionReader, deliveryReader, startWork, onBindRepository: enter }) : h('section', { 'aria-label': '工作区摘要' },
    h('p', { role: 'status' }, setup?.workspace ? confirmed ? '正在等待工作项。' : '来源尚未确认，尚无可读工作项。' : '欢迎使用 Harness Projects。尚无可读工作区。'),
    setup?.workspace ? h('p', null, `当前工作区：${setup.workspace.name}`) : null,
    setup?.workspace && setup.planning.state === 'unbound' ? h('button', { type: 'button', className: 'hp-action', onClick: enter }, '继续连接项目') : null)
  return h('section', { className: 'hp-workspace', 'data-workspace-setup': true, 'aria-label': 'Harness Projects', ref: root },
    h('style', null, WORKSPACE_STYLES + FORM_STYLES),
    h('header', { className: 'hp-workspace-header' }, h('h2', { tabIndex: -1 }, settings ? stage === 'create' ? '创建工作区' : '连接设置' : list ? '工作项' : '工作区'),
      h('button', { className: 'hp-action', type: 'button', disabled: false, onClick: settings ? leave : enter }, settings ? '返回工作区' : '连接设置')),
    h('div', { className: 'hp-workspace-body', ref: body, role: 'region', 'aria-label': settings ? '连接设置内容' : '工作区内容', tabIndex: 0 },
      mounted ? h('div', { key: scope, hidden: !settings }, ...children) : null,
      !settings ? h('div', null, workspace, errorSummary('workspace-error')) : null))

}
export function bindWorkspaceSetupApp(setupSource: WorkspaceSetupSource, source: WorkspaceSource, executionReader?: ExecutionContextReader, options: { readonly mappingSource?: PlanningMappingSource | undefined; readonly refreshSource?: PlanningRefreshSource | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly startWork?: StartWork | undefined; readonly repositoryBindingSource?: RepositoryBindingSource | undefined } = {}): () => ReactElement {
  return () => h(WorkspaceSetupGate, { setupSource, source, executionReader, repositoryBindingSource: options.repositoryBindingSource, startWork: options.startWork, deliveryReader: options.deliveryReader, mappingSource: options.mappingSource, refreshSource: options.refreshSource })
}
