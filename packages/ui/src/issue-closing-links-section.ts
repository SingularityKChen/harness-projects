import { createElement as h, useEffect, useRef, useState } from 'react'
import type { IssueClosingLinksRead, IssueClosingLinksReader } from '@harness-projects/client'
import { deriveIssueClosingLinksView, type IssueClosingLinksTarget } from '@harness-projects/ui-model'
type State = { key: string; reader: IssueClosingLinksReader; pending: boolean; failed?: boolean; read?: IssueClosingLinksRead }
/** 当前安全来源的唯一消费者；render 先比较权限签名，再等待 effect。失败不回填 UI last-good。 */
export function IssueClosingLinksSection({ target, reader, connected }: { readonly target: IssueClosingLinksTarget; readonly reader: IssueClosingLinksReader; readonly connected: boolean }) {
  const key = JSON.stringify([target.workspaceId, target.workItemId, target.accessToken]), sourceKey = JSON.stringify([target.workspaceId, target.workItemId, target.sourceToken])
  const [state, setState] = useState<State>({ key, reader, pending: true })
  const started = useRef<{ key: string; reader: IssueClosingLinksReader; task: Promise<string> } | undefined>(undefined)
  const opened = useRef<{ key: string; reader: IssueClosingLinksReader } | undefined>(undefined)
  const action = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    let active = true, ordinal = 0
    const load = async (manual = false) => {
      const request = ++ordinal
      setState({ key, reader, pending: true })
      if (!connected) { started.current = undefined; return }
      const first = opened.current?.key !== sourceKey || opened.current.reader !== reader
      opened.current = { key: sourceKey, reader }
      if (started.current?.key !== key || started.current.reader !== reader) started.current = undefined
      let receipt: string | undefined, failed = false
      // 同来源的权限 metadata 仅重查 Host，避免 deny/probe 循环；首次来源或用户按钮才实际探测。
      if (manual || first) started.current = { key, reader, task: Promise.resolve().then(() => reader.refresh(target)) }
      try { receipt = await started.current?.task } catch { failed = true }
      if (!active || request !== ordinal) return
      try {
        const read = await reader.read(target, receipt)
        if (!active || request !== ordinal) return
        if (read.workspaceId !== target.workspaceId || read.workItemId !== target.workItemId || read.observation.workItemId !== target.workItemId || (receipt !== undefined && ['complete', 'partial'].includes(read.observation.state) && read.observation.scopeToken !== receipt)) throw new TypeError('scope')
        setState({ key, reader, read, pending: false, failed })
      } catch { if (active && request === ordinal) setState({ key, reader, pending: false, failed: true }) }
    }
    action.current = () => { void load(true) }; void load()
    return () => { active = false; ordinal++; action.current = undefined }
  }, [key, sourceKey, reader, connected])
  const current = connected && state.key === key && state.reader === reader && !state.pending ? state : undefined
  const view = current?.read ? deriveIssueClosingLinksView(current.read.observation) : undefined
  return h('section', { className: 'hp-execution', 'aria-label': '来源关联的 PR' }, h('h3', null, '来源关联的 PR'),
    h('p', { role: 'status' }, !connected ? '连接中断，来源关联尚未确认' : view?.message ?? (current?.failed ? '当前无法读取来源关联，请重试' : '正在读取来源关联')),
    current?.failed && view ? h('p', null, '刷新未完成，以下为宿主仍允许读取的记录') : null,
    view?.stale ? h('p', null, '最后已知值，当前来源结果尚未确认') : null,
    view?.observedAt ? h('p', null, '观察时间：', h('time', { dateTime: view.observedAt }, view.observedAt)) : null,
    ...(view?.coverage ?? []).map(c => h('p', { key: c.label }, c.label, '：', c.state, ' · ', c.observedAt)),
    h('ul', null, ...(view?.links ?? []).map((link, index) => h('li', { key: index },
      h('p', null, link.repository, ' · #', link.number, ' · ', link.href ? h('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer' }, link.title) : link.title),
      h('p', null, link.draft ? '草稿 · ' : '', link.state, ' · ', link.relation)))),
    h('button', { className: 'hp-action', type: 'button', disabled: !connected, onClick: () => action.current?.() }, '刷新来源关联'))
}
