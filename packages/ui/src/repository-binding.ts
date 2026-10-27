import { createElement as h, useState, useSyncExternalStore, useEffect } from 'react'
import type { ReactElement } from 'react'
import type { RepositoryBindingSource, RepositorySelection } from '@harness-projects/client'
import { repositoryBindingView } from '@harness-projects/ui-model'
export function RepositoryBindingForm({ source }: { readonly source: RepositoryBindingSource }): ReactElement {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const [draft, setDraft] = useState<RepositorySelection>(snapshot.selection ?? { localPath: '', owner: '', name: '' })
  useEffect(() => () => source.cancelAttempt(), [source])
  const view = repositoryBindingView(snapshot), pending = snapshot.state === 'pending'
  return h('form', { 'aria-label': '绑定仓库', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void source.bind(draft) } },
    h('h3', null, '绑定仓库'),
    ...([['localPath', '本地仓库路径'], ['owner', 'GitHub owner'], ['name', 'GitHub name']] as const).map(([field, label]) => h('div', { key: field },
      h('label', { htmlFor: `repository-${field}` }, label),
      h('input', { id: `repository-${field}`, value: draft[field], required: true, disabled: pending, onChange: (event: { target: { value: string } }) => { source.reset(); setDraft({ ...draft, [field]: event.target.value }) } }))),
    h('button', { type: 'submit', disabled: pending }, snapshot.state === 'configured' ? '恢复仓库连接' : '绑定仓库'),
    view.notice ? h('p', { role: 'status', 'aria-live': 'polite' }, view.notice) : null,
    snapshot.error ? h('div', { role: 'alert' }, snapshot.error.message, h('p', null, view.recovery)) : null)
}
