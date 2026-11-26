import { createElement as h, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { WorkspaceSetupSource } from '@harness-projects/client'
import { workspaceProjectsView, workspaceSetupView } from '@harness-projects/ui-model'
import type { DOMElement } from './work-item-detail.ts'
const STYLES = `
.hp-project-intro{margin:0 0 .75rem;color:var(--dsw-alias-label-secondary,CanvasText)}
.hp-project-list{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.hp-project-list li{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;box-sizing:border-box;padding:.75rem;border:1px solid var(--dsw-alias-border-l2,CanvasText)}
.hp-project-list .hp-project-name{font-weight:600;overflow-wrap:anywhere}.hp-project-meta{color:var(--dsw-alias-label-secondary,CanvasText);font-size:.857143rem}
.hp-project-list button{min-block-size:44px;min-inline-size:44px;margin-inline-start:auto}
.hp-project-actions{margin:0 0 1rem}
`
/** Projects Home（#691）：只用 catalogue 的本地安全字段；打开/返回/创建都经唯一 setup root。 */
export function ProjectsHome({ setupSource, providerLabel = 'GitHub', onOpen, onReturn, onCreate }: {
  readonly setupSource: WorkspaceSetupSource; readonly providerLabel?: string
  readonly onOpen: (workspaceId: string) => void; readonly onReturn: () => void; readonly onCreate: () => void
}): ReactElement {
  const snapshot = useSyncExternalStore(setupSource.subscribe, setupSource.getSnapshot, setupSource.getSnapshot)
  const view = workspaceProjectsView(snapshot), failure = workspaceSetupView(snapshot, providerLabel)
  const heading = useRef<DOMElement | null>(null)
  // 进入 Home 回焦 h2：Home 是独立页面，标题是定义好的落点。
  useEffect(() => { heading.current?.focus?.() }, [])
  const row = (item: ReturnType<typeof workspaceProjectsView>['rows'][number]) => h('li', { key: item.workspaceId, 'aria-current': item.isActive ? 'true' : undefined },
    h('span', { className: 'hp-project-name' }, item.displayName),
    h('span', { className: 'hp-project-meta' }, [item.planningLabel, item.policyLabel].filter((text) => text !== '').join(' · ')),
    h('button', { className: 'hp-action', type: 'button', 'aria-busy': item.pending || undefined, disabled: snapshot.pending, onClick: () => { if (item.isActive) onReturn(); else onOpen(item.workspaceId) } }, item.isActive ? '返回项目' : '打开'))
  return h('section', { className: 'hp-workspace hp-projects', 'aria-label': '项目' },
    h('style', null, STYLES),
    h('h2', { tabIndex: -1, ref: heading }, '项目'),
    h('p', { className: 'hp-project-intro' }, '这里列出本机保存的全部项目；打开一个项目会切换当前工作区。'),
    // 创建入口必须留在 Home：创建第二个项目是 #692 的最小闭环，不能只在 0 项目时出现。
    h('div', { key: 'actions', className: 'hp-project-actions' },
      h('button', { className: 'hp-action hp-action-primary', type: 'button', disabled: snapshot.pending, onClick: onCreate }, '创建工作区')),
    h('ul', { className: 'hp-project-list', key: 'list' }, view.rows.map(row)),
    snapshot.pending ? h('p', { key: 'status', role: 'status' }, '正在打开项目，请稍候。') : null,
    failure.error ? h('div', { key: 'error', className: 'hp-form-notice', role: 'alert' },
      h('strong', null, failure.errorTitle), h('p', null, failure.error.message),
      h('button', { className: 'hp-action', type: 'button', disabled: snapshot.pending, onClick: () => { void setupSource.refresh() } }, '重新读取')) : null)
}
