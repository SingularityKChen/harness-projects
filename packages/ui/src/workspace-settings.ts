import { createElement as h, useId, useState } from 'react'
import type { ReactElement } from 'react'
const TASKS = [
  ['planning', '规划连接', '选择工作区使用的规划来源，确认项目连接。'],
  ['mapping', '字段映射', '将来源字段对应到工作台使用的规划语义。'],
  ['execution', '执行', '启用此工作区使用的 Harness 执行绑定。'],
  ['repository', '仓库', '连接项目代码仓库，供后续研发操作使用。']
] as const
type Task = typeof TASKS[number][0]
/** 私有固定任务组合：分类只改变可见性，表单与未决操作由原 owner 保持。 */
export function WorkspaceSettings({ children }: { readonly children: readonly [ReactElement, ReactElement, ReactElement, ReactElement, ReactElement] }): ReactElement {
  const [active, setActive] = useState<Task>('planning'), id = useId()
  return h('div', { className: 'hp-settings' }, h('style', null, SETTINGS_STYLES),
    h('div', { className: 'hp-settings-layout' },
      h('div', { className: 'hp-settings-navigation' },
        h('label', { className: 'hp-settings-compact', htmlFor: `${id}-task` }, '任务', h('select', { id: `${id}-task`, className: 'hp-settings-chooser', value: active, 'aria-controls': `${id}-${active}`, onChange: (event: { target: { value: string } }) => setActive(event.target.value as Task) }, ...TASKS.map(([key, label]) => h('option', { key, value: key }, label)))),
      h('nav', { className: 'hp-settings-nav', 'aria-label': '设置任务' },
        ...TASKS.map(([key, label]) => h('button', { key, type: 'button', 'aria-current': active === key ? 'page' : undefined, 'aria-controls': `${id}-${key}`, onClick: () => setActive(key) }, label)))),
      h('div', { className: 'hp-settings-tasks' }, children[0], ...TASKS.map(([key, label, purpose], index) => h('section', { key, id: `${id}-${key}`, className: 'hp-settings-panel', hidden: active !== key, 'aria-labelledby': `${id}-${key}-heading` },
        h('header', null, h('h3', { id: `${id}-${key}-heading` }, label), h('p', null, purpose)), children[index + 1])))))
}
const SETTINGS_STYLES = `
.hp-settings { container:hp-settings / inline-size; inline-size:100%; min-inline-size:0 }
.hp-settings-layout { display:grid; grid-template-columns:10rem minmax(0,46rem); gap:2rem; align-items:start }
.hp-settings-compact { display:none }
.hp-settings-chooser { flex:1 1 6em; min-inline-size:0; inline-size:100%; min-block-size:44px; padding:.5rem; border:1px solid var(--hp-control-border); border-radius:var(--hp-radius); color:inherit; background:var(--hp-surface); font:inherit; line-height:1.5 }
.hp-settings-nav { display:flex; flex-direction:column; gap:.25rem }
.hp-settings-nav button { text-align:start; border-color:transparent; background:transparent }
.hp-settings-nav button[aria-current] { background:var(--hp-surface); border-color:var(--hp-border); font-weight:650 }
.hp-settings-tasks,.hp-settings-panel { min-inline-size:0 }
.hp-settings-panel[hidden],.hp-settings-panel [hidden] { display:none }
.hp-settings-panel > header h3 { margin:0; font-size:1.15rem; line-height:1.4 }
.hp-settings-panel > header p { margin-block:.5rem 1.5rem; opacity:.8 }
.hp-settings-panel .hp-form { margin-block:0; padding-block:0; border:0 }
.hp-settings-panel .hp-form > h3 { display:none }
.hp-settings-panel .hp-action-primary { background:CanvasText; color:Canvas; border-color:CanvasText }
@container hp-settings (max-width:44rem) {
  .hp-settings-layout { grid-template-columns:minmax(0,1fr); gap:.75rem }
  .hp-settings-compact { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; white-space:nowrap }
  .hp-settings-nav { display:none }
}
`
