import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { deriveWorkspaceStatus } from '@harness-projects/ui-model'
import { ObservedTime } from './observed-time.ts'
import { WorkspaceSetupGate, bindWorkspaceSetupApp } from './workspace-setup.ts'
const idleRefresh = { pending: false }
const noRefresh = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => idleRefresh }
const noSource = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => undefined }
const styles = `
.hp-status-panel{container:hp-status / inline-size;display:flex;flex-direction:column;block-size:100%;min-block-size:0;min-inline-size:0;color:inherit;font:inherit}
.hp-status-summary{position:relative;flex:0 1 auto;box-sizing:border-box;min-block-size:0;max-block-size:50%;overflow:auto;overscroll-behavior:contain;box-shadow:inset 0 -1px var(--dsw-alias-border-l2,CanvasText);color:var(--dsw-alias-label-secondary,CanvasText);background:var(--dsw-alias-bg-base,Canvas);font-size:.857143rem;line-height:1.5;overflow-wrap:anywhere}
.hp-status-summary summary{padding:.857143rem 1.714286rem;min-block-size:44px;box-sizing:border-box;cursor:pointer}
.hp-status-line{display:inline-grid;align-items:start;grid-template-columns:minmax(0,1fr) auto auto;gap:0 .75em;inline-size:calc(100% - 1.5em);vertical-align:top}
@container hp-status (max-width:40rem){.hp-status-summary summary{padding:.6rem .75rem}.hp-status-line{grid-template-columns:repeat(2,minmax(0,1fr))}.hp-status-line>span:first-child{grid-column:1/-1;grid-row:2}}
.hp-status-summary :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:-3px}
.hp-status-summary dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:.25rem 1rem;margin:.5rem .75rem}
.hp-status-summary dl>div{display:flex;flex-wrap:wrap;gap:0 .4em;min-inline-size:0;max-inline-size:100%}
.hp-status-summary dt::after{content:"："}.hp-status-summary dd{margin:0;min-inline-size:0}
.hp-status-summary p{margin:.25rem .75rem}
.hp-status-body{display:flex;flex-direction:column;flex:1;min-block-size:0;min-inline-size:0;overflow:auto}
.hp-status-body>.hp-workspace{flex:1;min-block-size:0}
.hp-status-announcement{position:absolute;inline-size:1px;block-size:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
`
type Props = Parameters<typeof WorkspaceSetupGate>[0]
/** 薄生产消费层：只订阅既有快照；Gate 仍拥有导航、表单及操作播报。 */
function WorkspaceStatusPanel(props: Props): ReactElement {
  const setup = useSyncExternalStore(props.setupSource.subscribe, props.setupSource.getSnapshot, props.setupSource.getSnapshot)
  const read = useSyncExternalStore(props.source.subscribe, props.source.getSnapshot, props.source.getSnapshot)
  const refreshSource = props.refreshSource ?? noRefresh
  const refresh = useSyncExternalStore(refreshSource.subscribe, refreshSource.getSnapshot, refreshSource.getSnapshot)
  const map = props.mappingSource ?? noSource, repo = props.repositoryBindingSource ?? noSource
  const mapping = useSyncExternalStore(map.subscribe, map.getSnapshot, map.getSnapshot)
  const repository = useSyncExternalStore(repo.subscribe, repo.getSnapshot, repo.getSnapshot)
  const workspaceId = setup.setup?.workspace?.id
  const observed = useRef({ workspaceId, earlier: false, state: repository?.state })
  if (workspaceId !== undefined && observed.current.workspaceId !== undefined && workspaceId !== observed.current.workspaceId) observed.current.earlier = true
  if (repository?.state === 'idle' || repository?.state === 'active' || (repository?.state === 'pending' && observed.current.state !== 'pending' && observed.current.state !== 'configured')) observed.current.earlier = false
  observed.current = { workspaceId: workspaceId ?? observed.current.workspaceId, earlier: observed.current.earlier, state: repository?.state }
  const view = deriveWorkspaceStatus({ setup, read, refresh, mapping, repository, repositoryFromEarlierWorkspace: observed.current.earlier })
  const observation = `${view.transport}。${view.sourceObservation}。${view.refreshStatus ?? ''}`, scope = `${workspaceId ?? ''}:${setup.setup?.planning.bindingId ?? ''}`
  const last = useRef({ scope, observation }), [announcement, announce] = useState('')
  useEffect(() => {
    if (last.current.scope !== scope) announce('')
    else if (last.current.observation !== observation) announce(observation)
    last.current = { scope, observation }
  }, [scope, observation])
  const fact = (label: string, value: string): ReactElement => h('div', { key: label }, h('dt', null, label), h('dd', null, value))
  return h('section', { className: 'hp-status-panel', 'aria-label': 'Harness Projects' }, h('style', null, styles),
    h('section', { className: 'hp-status-summary', 'aria-label': '工作区状态' },
      ...view.operations.map(text => h('p', { key: text }, text)),
      h('details', { key: scope }, h('summary', null, h('span', { className: 'hp-status-line' }, h('span', null, view.workspace), h('span', null, `宿主：${view.transport}`), h('span', null, `来源：${view.sourceObservation}`))),
        h('dl', null, fact('规划', view.planning), fact('来源', view.source),
          ...(view.mappingSource ? [fact('字段映射', view.mappingSource)] : []),
          ...(view.confirmedAt ? [h('div', { key: 'confirmed' }, h('dt', null, '来源最后完整确认'), h('dd', null, h(ObservedTime, { at: view.confirmedAt }), h('span', null, `（${view.confirmedAt}）`)))] : []))),
      h('span', { className: 'hp-status-announcement', 'aria-live': 'polite', 'aria-atomic': true }, announcement)),
    h('div', { className: 'hp-status-body' }, h(WorkspaceSetupGate, { ...props, announceListStatus: false })))
}
export const bindWorkspaceStatusApp: typeof bindWorkspaceSetupApp = (setupSource, source, executionReader, options = {}) =>
  () => h(WorkspaceStatusPanel, { setupSource, source, executionReader, ...options })
