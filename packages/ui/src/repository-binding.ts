import { createElement as h, useState, useSyncExternalStore, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { RepositoryBindingSource, RepositorySelection } from '@harness-projects/client'
import { repositoryBindingView } from '@harness-projects/ui-model'
import { FORM_STYLES, focusFormError } from './form-presentation.ts'
import type { DOMElement } from './work-item-detail.ts'
export function RepositoryBindingForm({ source }: { readonly source: RepositoryBindingSource }): ReactElement {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const [draft, setDraft] = useState<RepositorySelection>(snapshot.selection ?? { localPath: '', owner: '', name: '' })
  const form = useRef<DOMElement | null>(null), submitted = useRef<Promise<void> | undefined>(undefined)
  useEffect(() => () => { submitted.current = undefined; source.cancelAttempt() }, [source])
  const view = repositoryBindingView(snapshot), pending = snapshot.state === 'pending'
  const bind = (): void => {
    const task = source.bind(draft)
    if (submitted.current === task) return
    submitted.current = task
    void task.then(() => { if (submitted.current === task) { submitted.current = undefined; if (source.getSnapshot().error) focusFormError(form.current) } })
  }
  return h('form', { className: 'hp-form', ref: form, 'aria-busy': pending, 'aria-label': '绑定仓库', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); bind() } },
    h('style', null, FORM_STYLES), h('h3', null, '绑定仓库'),
    ...([['localPath', '本地仓库路径'], ['owner', 'GitHub owner'], ['name', 'GitHub name']] as const).map(([field, label]) => h('div', { key: field, className: 'hp-field' },
      h('label', { htmlFor: `repository-${field}` }, label),
      h('input', { id: `repository-${field}`, 'aria-describedby': `repository-${field}-help${snapshot.error ? ' repository-error' : ''}`, value: draft[field], required: true, disabled: pending, onChange: (event: { target: { value: string } }) => { source.reset(); setDraft({ ...draft, [field]: event.target.value }) } }), h('p', { id: `repository-${field}-help` }, field === 'localPath' ? '填写宿主可访问的绝对路径，保留现有仓库内容。' : field === 'owner' ? '填写 GitHub 组织或用户名称。' : '填写仓库名称，不含 owner 或 URL。'))),
    h('div', { className: 'hp-form-actions' }, h('button', { className: 'hp-action hp-action-primary', type: 'submit', disabled: pending }, pending ? '正在绑定仓库' : snapshot.state === 'configured' ? '恢复仓库连接' : '绑定仓库')),
    view.notice ? h('p', { className: 'hp-form-notice', role: 'status', 'aria-live': 'polite' }, view.notice) : null,
    snapshot.error ? h('div', { id: 'repository-error', className: 'hp-form-notice', role: 'alert', tabIndex: -1, 'data-form-error': true }, h('strong', null, '仓库绑定未完成'), h('p', null, snapshot.error.code === 'result_unknown' || snapshot.error.code === 'ambiguous_result' ? '结果未知，请重试读取并恢复绑定。' : snapshot.error.message), h('p', null, '草稿已保留。', view.recovery)) : null)
}
