import { createElement as h, type ReactNode } from 'react'
import { FORM_STYLES } from './form-presentation.ts'

/** 私有呈现：只接收调用者已有的枚举，不归并运行、CI、规划或写入结果。 */
type State = 'observed' | 'passed' | 'failed' | 'unknown' | 'stale' | 'queued' | 'starting' | 'running' | 'succeeded' | 'canceled' | 'timed_out'
export function executionBadge(state: State, label: string) {
  return h('span', { className: 'hp-execution-state', 'data-execution-state': state }, label)
}
export function executionSource(label: string, ...children: ReactNode[]) {
  return h('details', { className: 'hp-execution-source' }, h('summary', null, label), ...children)
}
export function executionStyles() {
  return h('style', null, FORM_STYLES + `
.hp-execution { min-width:0; margin-block:var(--hp-space-6); padding-block-start:var(--hp-space-4); border-block-start:1px solid var(--hp-border); line-height:1.6 }
.hp-execution :where(h3,h4) { margin:0; font-size:1rem; overflow-wrap:anywhere }
.hp-execution h3 { font-size:1.1rem; font-weight:650; margin-block-end:var(--hp-space-3) }
.hp-execution h4 { font-weight:600 }
.hp-execution :where(p,li,summary) { overflow-wrap:anywhere; min-width:0 }
.hp-execution .hp-execution-repository + .hp-execution-repository { margin-block-start:var(--hp-space-6) }
.hp-execution-state { font-weight:600 }
.hp-execution-meta { font-size:.9em }
.hp-execution-notice { padding-inline-start:var(--hp-space-3); border-inline-start:2px solid var(--hp-control-border) }
.hp-execution-source { margin-block:var(--hp-space-2) var(--hp-space-4) }
.hp-execution-source summary { cursor:pointer; box-sizing:border-box; min-height:44px; padding-block:var(--hp-space-2); font-size:.9em }
.hp-execution-source[open] { padding-block-end:var(--hp-space-2) }
.hp-execution-source p { font-size:.9em; margin-block:var(--hp-space-1) }
.hp-execution ol { padding-inline-start:var(--hp-space-6); margin-block:var(--hp-space-4) }
.hp-execution li { padding-inline-start:var(--hp-space-1); margin-block-end:var(--hp-space-4) }
.hp-execution .hp-form { margin:0; padding:0; border:0 }
`)
}
