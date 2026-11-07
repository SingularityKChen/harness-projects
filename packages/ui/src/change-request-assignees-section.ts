import { createElement as h, useEffect, useRef, useState } from 'react'
import type { AssigneeRepositoryScope, AssigneeScope, AssigneeOperation, ChangeRequestAssignees } from '@harness-projects/client'
export function ChangeRequestAssigneePicker({ scope, port, connected, value, onChange, disabled = false }: {
  readonly scope: AssigneeRepositoryScope; readonly port: ChangeRequestAssignees; readonly connected: boolean; readonly value: readonly string[]; readonly onChange: (ids: readonly string[]) => void; readonly disabled?: boolean
}) {
  const key = JSON.stringify(scope), owner = useRef({ key, port, connected, request: 0, busy: false })
  if (owner.current.key !== key || owner.current.port !== port || owner.current.connected !== connected) owner.current = { key, port, connected, request: 0, busy: false }
  const current = owner.current
  const [data, setData] = useState<{ owner: typeof current; items: { id: string; login: string }[]; stamp: string; cursor?: string | undefined; cursors: readonly string[] } | undefined>(), [filter, setFilter] = useState(''), [error, setError] = useState<typeof current | undefined>()
  const visible = data?.owner === current ? data : undefined
  const load = async (more = false) => {
    if (!connected || current.busy) return; current.busy = true; const request = ++current.request
    try { const page = await port.options(scope, more ? visible?.cursor : undefined)
      if (owner.current !== current || request !== current.request) return
      if (more && (page.targetStamp !== visible?.stamp || (page.nextCursor !== undefined && visible.cursors.includes(page.nextCursor)))) throw Error('分页已变化')
      setData({ owner: current, items: [...(more ? visible?.items ?? [] : []), ...page.items].filter((u, i, all) => all.findIndex(v => v.id === u.id) === i), stamp: page.targetStamp, cursor: page.nextCursor, cursors: [...(more ? visible?.cursors ?? [] : []), ...(page.nextCursor ? [page.nextCursor] : [])] }); setError(undefined)
    } catch { if (owner.current === current) { setData(undefined); setError(current); onChange([]) } } finally { current.busy = false }
  }
  useEffect(() => { setFilter(''); onChange([]); if (connected) void load(); return () => { current.request++ } }, [current])
  return h('fieldset', { disabled: !connected || disabled }, h('legend', null, '仓库允许的负责人'),
    h('label', null, '筛选已读取候选', h('input', { value: visible ? filter : '', onChange: (e: { target: { value: string } }) => setFilter(e.target.value) })),
    ...(visible?.items.filter(u => u.login.toLowerCase().includes(filter.toLowerCase())).map(u => h('label', { key: u.id }, h('input', { type: 'checkbox', checked: value.includes(u.id), disabled: !value.includes(u.id) && value.length >= 10, onChange: (e: { target: { checked: boolean } }) => onChange(e.target.checked ? [...value, u.id] : value.filter(id => id !== u.id)) }), u.login)) ?? []),
    visible?.cursor ? h('button', { type: 'button', onClick: () => void load(true) }, '加载更多负责人') : null,
    error === current ? h('button', { type: 'button', onClick: () => void load() }, '重新读取负责人候选') : null,
    !visible ? h('p', { role: 'status' }, error === current ? '负责人候选不可读取' : '正在读取负责人候选') : null)
}
export function ChangeRequestAssigneesSection({ scope, port, connected }: { readonly scope: AssigneeScope; readonly port: ChangeRequestAssignees; readonly connected: boolean }) {
  const key = JSON.stringify(scope), owner = useRef({ key, port, connected, request: 0, busy: false })
  if (owner.current.key !== key || owner.current.port !== port || owner.current.connected !== connected) owner.current = { key, port, connected, request: 0, busy: false }
  const current = owner.current
  const [state, setState] = useState<{ owner: typeof current; operation: AssigneeOperation; selected: readonly string[]; message: string } | undefined>()
  const visible = state?.owner === current ? state : undefined
  const lookup = async (id?: string, message = '') => { const request = ++current.request
    try { const operation = await port.operation(scope, id); if (owner.current === current && request === current.request) setState({ owner: current, operation, selected: [], message }) }
    catch { if (owner.current === current) setState({ owner: current, operation: { kind: 'blocked' }, selected: [], message: '负责人记录不可读取' }) }
  }
  useEffect(() => { if (connected) void lookup(); return () => { current.request++ } }, [current])
  const op = visible?.operation, unresolved = op?.kind === 'operation' && ['pending', 'unknown'].includes(op.state)
  const run = async (resume: boolean) => {
    if (!connected || current.busy || !visible || op?.kind === 'blocked') return
    current.busy = true; setState({ ...visible, message: '正在核对负责人' })
    const result = await (resume && op?.kind === 'operation' ? port.resume(scope, op.operationId) : port.add(scope, visible.selected)).catch(() => ({ writeState: 'unknown', operationId: undefined }))
    if (owner.current !== current) return; current.busy = false
    void lookup(result.operationId, ['confirmed', 'reconciled'].includes(result.writeState) ? '负责人最后确认' : result.writeState === 'failed' ? '负责人添加被拒绝，请检查连接权限' : '负责人分配尚未确认')
  }
  return h('section', { 'aria-label': '负责人' }, h('h4', null, '负责人'),
    h('p', { role: 'status' }, !connected ? '连接已断开' : visible?.message || (op?.kind === 'blocked' ? '负责人记录当前不可读取' : op?.kind === 'operation' && op.state === 'failed' ? '负责人添加被拒绝，请检查连接权限' : unresolved ? '负责人分配尚未确认' : op?.kind === 'operation' && op.state === 'saved' ? '负责人最后确认；身份暂不可读取' : '选择负责人，最多 10 个')),
    !connected || !op || op.kind === 'blocked' ? null : h(ChangeRequestAssigneePicker, { scope: { workspaceId: scope.workspaceId, workItemId: scope.workItemId, repositoryId: scope.repositoryId }, port, connected, value: visible!.selected, disabled: unresolved || current.busy, onChange: selected => setState(old => old?.owner === current ? { ...old, selected } : old) }),
    h('button', { type: 'button', disabled: !connected || !op || op.kind === 'blocked' || current.busy || (!unresolved && !visible?.selected.length), onClick: () => void run(unresolved) }, unresolved ? '核对原 PR 分配' : '添加负责人'))
}
