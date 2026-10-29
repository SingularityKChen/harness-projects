import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { PlanningMappingSource, PlanningRefreshSource, WorkspaceSetupSource, ExecutionContextReader, RepositoryBindingSource, StartWork, DeliveryLineageReader } from '@harness-projects/client'
import { workspaceSetupView } from '@harness-projects/ui-model'
import { PlanningMappingForm } from './planning-mapping.ts'
import { RepositoryBindingForm } from './repository-binding.ts'
import { WorkItemApp, type WorkspaceSource } from './work-item-app.ts'
import { WORKSPACE_STYLES } from './workspace-presentation.ts'
import { FORM_STYLES, focusFormError } from './form-presentation.ts'
import type { DOMElement } from './work-item-detail.ts'
/** 唯一工作区设置门：仅持草稿与导航；确认状态和工作区 identity 全部来自 Host。 */
export function WorkspaceSetupGate({ setupSource, source, executionReader, repositoryBindingSource, startWork, deliveryReader, mappingSource, refreshSource }: { readonly mappingSource?: PlanningMappingSource | undefined; readonly refreshSource?: PlanningRefreshSource | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly startWork?: StartWork | undefined; readonly repositoryBindingSource?: RepositoryBindingSource | undefined; readonly setupSource: WorkspaceSetupSource; readonly source: WorkspaceSource; readonly executionReader?: ExecutionContextReader | undefined }): ReactElement {
  const snapshot = useSyncExternalStore(setupSource.subscribe, setupSource.getSnapshot, setupSource.getSnapshot)
  const read = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const [name, setName] = useState(''), [project, setProject] = useState<string | undefined>(undefined), [settings, setSettings] = useState(false), [connecting, setConnecting] = useState(false)
  const root = useRef<DOMElement | null>(null), shown = useRef<string | undefined>(undefined)
  const form = useRef<DOMElement | null>(null), submitted = useRef(false)
  useEffect(() => {
    if (!snapshot.pending && submitted.current) { submitted.current = false; if (snapshot.error || snapshot.setup?.error || snapshot.setup?.activationError) focusFormError(form.current) }
  }, [snapshot])
  useEffect(() => () => { submitted.current = false }, [setupSource])
  const setup = snapshot.setup, view = workspaceSetupView(snapshot)
  const confirmed = setup?.planning.state === 'confirmed' && setup.workspace !== null
  const list = confirmed && read?.workspace.id === setup.workspace.id && !settings
  useEffect(() => {
    if (!list && mappingSource && setup?.workspace && setup.planning.bindingId && setup.planning.projectNodeId) void mappingSource.refresh({ workspaceId: setup.workspace.id, bindingId: setup.planning.bindingId, projectExternalId: setup.planning.projectNodeId })
  }, [list, mappingSource, setup?.workspace?.id, setup?.planning.bindingId, setup?.planning.projectNodeId])
  const stage = list ? 'list' : setup === undefined ? 'loading' : setup.workspace === null ? 'create' : connecting || setup.planning.state !== 'unbound' || settings ? 'connect' : 'summary'
  useEffect(() => {
    const previous = shown.current; shown.current = stage
    const doc = (globalThis as { document?: { activeElement?: DOMElement | null; body?: DOMElement | null } }).document
    if (previous && previous !== stage && (!doc?.activeElement || doc.activeElement === doc.body || doc.activeElement.isConnected === false)) root.current?.querySelector?.('h2')?.focus?.()
  }, [stage])
  const submit = (): void => { if (setup?.workspace === null) void setupSource.create(name); else void setupSource.connect(project ?? setup?.planning.projectNodeId ?? '') }
  const recovery = (): void => {
    if (snapshot.failure === 'install') void setupSource.installExecution()
    else if (snapshot.failure === 'read') void setupSource.refresh()
    else if (view.recovery?.action === 'refresh') void setupSource.refresh(setup?.planning.state === 'degraded')
    else if (snapshot.failure === 'create') void setupSource.create(name)
    else if (snapshot.failure === 'connect') void setupSource.connect(project ?? setup?.planning.projectNodeId ?? '')
    else if (!setup) void setupSource.refresh()
    else if (setup?.planning.state === 'degraded' && !setup.activationError) void setupSource.refresh(true)
    else submit()
  }
  const button = (label: string, action: () => void): ReactElement => h('button', { className: 'hp-action', type: 'button', disabled: snapshot.pending, onClick: action }, label)
  const errorSummary = view.error ? h('div', { id: 'setup-error', className: 'hp-form-notice', role: 'alert', tabIndex: -1, 'data-form-error': true }, h('strong', null, '工作区设置未完成'), h('p', null, view.error.code === 'result_unknown' || view.error.code === 'ambiguous_result' ? '结果未知，请重新读取确认。' : view.error.message), h('p', null, '草稿已保留，请按以下提示恢复。'), view.recovery?.action ? button(view.recovery.label, () => { submitted.current = true; recovery() }) : h('p', null, view.recovery?.label)) : null
  const children: ReactElement[] = [h('style', { key: 'styles' }, WORKSPACE_STYLES + FORM_STYLES), h('h2', { tabIndex: -1, key: 'heading' }, list ? '工作项' : stage === 'create' ? '创建工作区' : '连接设置')]
  if (list) children.push(button('连接设置', () => setSettings(true)), h(WorkItemApp, { source, refreshSource, executionReader, deliveryReader, startWork, onBindRepository: () => setSettings(true) }))
  else if (!setup) { if (!view.error) children.push(h('p', null, '正在读取工作区设置。')) }
  else if (confirmed && !settings) children.push(h('p', { role: 'status' }, '正在等待工作项。'))
  else {
    if (setup.workspace) children.push(h('p', null, `当前工作区：${setup.workspace.name}`))
    if (stage === 'summary') children.push(button('继续连接项目', () => setConnecting(true)))
    else {
      const creating = setup.workspace === null, id = creating ? 'workspace-name' : 'project-node-id'
      children.push(h('form', { className: 'hp-form', 'aria-label': creating ? '创建工作区' : '规划连接', ref: form, 'aria-busy': snapshot.pending, onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); submitted.current = true; submit() } },
        h('h3', null, creating ? '工作区' : '规划连接'), h('div', { className: 'hp-field' },
        h('label', { htmlFor: id }, creating ? '工作区名称' : 'GitHub Project node ID'),
        h('input', { id, 'aria-describedby': `${id}-help${view.error ? ' setup-error' : ''}`, value: creating ? name : project ?? setup.planning.projectNodeId ?? '', disabled: snapshot.pending, required: true, onChange: (event: { target: { value: string } }) => creating ? setName(event.target.value) : setProject(event.target.value) }),
        h('p', { id: `${id}-help` }, creating ? '为这个项目选择一个清楚的工作区名称。' : '从 GitHub 项目设置复制 Project node ID。')),
        h('div', { className: 'hp-form-actions' }, h('button', { className: 'hp-action hp-action-primary', type: 'submit', disabled: snapshot.pending }, snapshot.pending ? '正在处理' : creating ? '创建工作区' : '连接项目')), errorSummary))
    }
    if (setup.workspace && setup.planning.bindingId && mappingSource) children.push(h(PlanningMappingForm, { source: mappingSource }))
    if (setup.workspace) children.push(h('section', { className: 'hp-form', 'aria-label': '执行' }, h('h3', null, '执行'), setup.executionInstalled ? h('p', { role: 'status' }, 'Harness 执行绑定已启用') : button('启用 Harness 执行', () => { void setupSource.installExecution() })))
    if (setup.workspace && repositoryBindingSource) children.push(h(RepositoryBindingForm, { source: repositoryBindingSource }))
    if (confirmed) children.push(button('回到工作项', () => setSettings(false)))
    if (view.notice) children.push(h('p', { className: 'hp-form-notice', role: 'status', 'aria-live': 'polite' }, view.notice))
    if ((setup.planning.state === 'configured' || setup.planning.state === 'degraded') && !view.error) children.push(button('重新读取', () => { void setupSource.refresh(setup.planning.state === 'degraded') }))
  }
  if (errorSummary && (!setup || stage === 'summary' || list || (confirmed && !settings))) children.push(errorSummary)
  if (snapshot.pending) children.push(h('p', { role: 'status', 'aria-live': 'polite' }, '正在处理，请稍候。'))
  return h('section', { className: 'hp-workspace', 'data-workspace-setup': true, 'aria-label': 'Harness Projects', ref: root }, ...children)
}
export function bindWorkspaceSetupApp(setupSource: WorkspaceSetupSource, source: WorkspaceSource, executionReader?: ExecutionContextReader, options: { readonly mappingSource?: PlanningMappingSource | undefined; readonly refreshSource?: PlanningRefreshSource | undefined; readonly deliveryReader?: DeliveryLineageReader | undefined; readonly startWork?: StartWork | undefined; readonly repositoryBindingSource?: RepositoryBindingSource | undefined } = {}): () => ReactElement {
  return () => h(WorkspaceSetupGate, { setupSource, source, executionReader, repositoryBindingSource: options.repositoryBindingSource, startWork: options.startWork, deliveryReader: options.deliveryReader, mappingSource: options.mappingSource, refreshSource: options.refreshSource })
}
