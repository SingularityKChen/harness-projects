import { createElement as h, useEffect, useRef, useState } from 'react'
import type { IssueDependenciesReader, IssueDependenciesObservation, IssueDependenciesScope } from '@harness-projects/client'
type Target = IssueDependenciesScope & { readonly sourceToken: string; readonly accessToken: string }
type State = { key: string; reader: IssueDependenciesReader; pending: boolean; value?: IssueDependenciesObservation }
/** render 先隔离权限与来源代际；metadata 清空事实但不会制造自动 probe 循环。 */
export function IssueDependenciesSection({ target, reader, connected }: { readonly target: Target; readonly reader: IssueDependenciesReader; readonly connected: boolean }) {
  const key = JSON.stringify([target.workspaceId, target.workItemId, target.accessToken]), sourceKey = JSON.stringify([target.workspaceId, target.workItemId, target.sourceToken])
  const [state, setState] = useState<State>({ key, reader, pending: true })
  const opened = useRef<{ sourceKey: string; reader: IssueDependenciesReader } | undefined>(undefined), action = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    let active = true, ordinal = 0
    const first = opened.current?.sourceKey !== sourceKey || opened.current.reader !== reader
    if (connected) opened.current = { sourceKey, reader }
    const load = async () => {
      const request = ++ordinal; setState({ key, reader, pending: true })
      try {
        const value = await reader.refresh(target)
        if (active && request === ordinal) setState({ key, reader, pending: false, value })
      } catch { if (active && request === ordinal) setState({ key, reader, pending: false }) }
    }
    action.current = connected ? () => { void load() } : undefined
    if (connected && first) void load(); else setState({ key, reader, pending: false })
    return () => { active = false; ordinal++; action.current = undefined; if (!connected) opened.current = undefined }
  }, [key, sourceKey, reader, connected])
  const value = connected && state.key === key && state.reader === reader && !state.pending ? state.value : undefined
  const render = (label: string, stream: IssueDependenciesObservation['blockedBy'] | undefined, empty: string) => h('section', { 'aria-label': label },
    h('h4', null, label), h('p', { role: 'status' }, stream?.state === 'complete' ? stream.items.length ? '当前可见来源读取完成' : empty
      : stream?.state === 'partial' ? '读取不完整，以下仅为本次已验证记录' : stream?.state === 'denied' ? '来源读取被拒绝，请恢复授权后刷新'
      : stream?.state === 'unsupported' ? '当前来源不支持阻塞读取' : stream?.state === 'unavailable' ? '来源阻塞关系暂不可用，请刷新重试' : state.pending && connected ? '正在读取来源阻塞关系' : '来源阻塞关系尚未确认，请刷新'),
    stream?.observedAt ? h('time', { dateTime: stream.observedAt }, stream.observedAt) : null,
    h('ul', null, ...(stream?.items ?? []).map(item => h('li', { key: JSON.stringify([item.repository.identity, item.nativeIdentity]) },
      h('p', null, `${item.repository.name} · #${item.number} · ${item.state === 'closed' ? '已关闭' : '未关闭'}`),
      h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.title)))))
  return h('section', { className: 'hp-execution', 'aria-label': '来源 Issue 阻塞关系' }, h('h3', null, '来源 Issue 阻塞关系'),
    render('阻塞此 Issue', value?.blockedBy, '来源未返回可见的阻塞此项'), render('此 Issue 阻塞', value?.blocking, '来源未返回可见的被此项阻塞项'),
    h('button', { className: 'hp-action', type: 'button', disabled: !connected, onClick: () => action.current?.() }, '刷新来源阻塞关系'))
}
