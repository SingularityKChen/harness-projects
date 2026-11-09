import { createElement as h, useEffect, useRef, useState } from 'react'
import type { AssigneeRepositoryScope, AssigneeScope, AssigneeOperation, ChangeRequestAssignees } from '@harness-projects/client'
export function ChangeRequestAssigneePicker({ scope, port, connected, value, onChange, disabled = false, accessToken }: {
  readonly scope: AssigneeRepositoryScope; readonly port: ChangeRequestAssignees; readonly connected: boolean; readonly value: readonly string[]; readonly onChange: (ids: readonly string[]) => void; readonly disabled?: boolean; readonly accessToken?: string | undefined
}) {
  const key = JSON.stringify(scope), owner = useRef({ key, port, connected, accessToken, request: 0, busy: false, automatic: true, lifecycle: {} })
  const sameTarget = owner.current.key === key && owner.current.port === port && owner.current.connected === connected
  if (!sameTarget || owner.current.accessToken !== accessToken) owner.current = { key, port, connected, accessToken, request: 0, busy: false, automatic: !sameTarget, lifecycle: sameTarget ? owner.current.lifecycle : {} }
  const current = owner.current
  const [data, setData] = useState<{ owner: typeof current; items: { id: string; login: string }[]; stamp: string; cursor?: string | undefined; cursors: readonly string[] } | undefined>(), [filter, setFilter] = useState(''), [error, setError] = useState<{ owner: typeof current; message: string; safe: boolean; unconfirmed: boolean } | undefined>()
  const visible = data?.owner === current ? data : undefined
  const failure = error && (error.owner === current || error.safe && error.owner.lifecycle === current.lifecycle) ? error.message : undefined
  const load = async (more = false) => {
    if (!connected || current.busy) return; current.busy = true; const request = ++current.request
    try { const page = await port.options(scope, more ? visible?.cursor : undefined)
      if (owner.current !== current || request !== current.request) return
      if (more && (page.targetStamp !== visible?.stamp || (page.nextCursor !== undefined && visible.cursors.includes(page.nextCursor)))) throw Error('分页已变化')
      setData({ owner: current, items: [...(more ? visible?.items ?? [] : []), ...page.items].filter((u, i, all) => all.findIndex(v => v.id === u.id) === i), stamp: page.targetStamp, cursor: page.nextCursor, cursors: [...(more ? visible?.cursors ?? [] : []), ...(page.nextCursor ? [page.nextCursor] : [])] }); setError(undefined)
    } catch (reason) {
      const safe = ['not_supported', 'permission_denied', 'unavailable'].includes(reason as string)
      if (owner.current.lifecycle === current.lifecycle) {
        const message = reason === 'not_supported' ? '当前连接不支持负责人候选' : reason === 'permission_denied' ? '负责人候选读取被拒绝，请检查连接权限后重试' : '负责人候选读取不完整或暂时不可用，请重试'
        if (owner.current === current || safe) { setData(undefined); onChange([]) }
        setError(previous => !safe && previous?.safe && previous.owner.lifecycle === current.lifecycle ? { ...previous, unconfirmed: true }
          : owner.current === current || safe ? { owner: current, message, safe, unconfirmed: !safe } : previous)
      }
    } finally { current.busy = false }
  }
  useEffect(() => { setFilter(''); onChange([]); if (connected && current.automatic) void load(); return () => { current.request++ } }, [current])
  return h('fieldset', { disabled: !connected || disabled }, h('legend', null, '仓库允许的负责人'),
    h('label', null, '筛选已读取候选', h('input', { value: visible ? filter : '', onChange: (e: { target: { value: string } }) => setFilter(e.target.value) })),
    ...(visible?.items.filter(u => u.login.toLowerCase().includes(filter.toLowerCase())).map(u => h('label', { key: u.id }, h('input', { type: 'checkbox', checked: value.includes(u.id), disabled: !value.includes(u.id) && value.length >= 10, onChange: (e: { target: { checked: boolean } }) => onChange(e.target.checked ? [...value, u.id] : value.filter(id => id !== u.id)) }), u.login)) ?? []),
    visible?.cursor ? h('button', { type: 'button', onClick: () => void load(true) }, '加载更多负责人') : null,
    !visible && (failure || !current.automatic) ? h('button', { type: 'button', onClick: () => void load() }, '重新读取负责人候选') : null,
    !visible ? h('p', { role: 'status' }, failure && error?.safe && error.unconfirmed
      ? h('span', null, '最后已知失败：', h('span', null, failure), '；', h('span', null, '本次读取尚未确认，请重新读取'))
      : failure ?? (!current.automatic ? '负责人候选访问状态已变化，请重新读取' : '正在读取负责人候选')) : null)
}
export function ChangeRequestAssigneesSection({ scope, port, connected, accessToken }: { readonly scope: AssigneeScope; readonly port: ChangeRequestAssignees; readonly connected: boolean; readonly accessToken?: string | undefined }) {
  const key = JSON.stringify(scope), owner = useRef({ key, port, connected, request: 0, busy: false })
  if (owner.current.key !== key || owner.current.port !== port || owner.current.connected !== connected) owner.current = { key, port, connected, request: 0, busy: false }
  const current = owner.current
  const accessRef = useRef({ owner: current, token: accessToken })
  if (accessRef.current.owner !== current || accessRef.current.token !== accessToken) accessRef.current = { owner: current, token: accessToken }
  const access = accessRef.current
  const [state, setState] = useState<{ owner: typeof current; access: typeof access; selectionAccess: typeof access; operation: AssigneeOperation; selected: readonly string[]; message: string } | undefined>()
  const visible = state?.owner === current ? state : undefined
  const lookup = async (id?: string, message = '') => { const request = ++current.request, receipt = accessRef.current
    try { const operation = await port.operation(scope, id); if (owner.current === current && request === current.request && accessRef.current === receipt) setState({ owner: current, access: receipt, selectionAccess: receipt, operation, selected: [], message }) }
    catch { if (owner.current === current && request === current.request && accessRef.current === receipt) setState({ owner: current, access: receipt, selectionAccess: receipt, operation: { kind: 'blocked' }, selected: [], message: '负责人记录不可读取' }) }
  }
  useEffect(() => { if (connected) void lookup(); return () => { current.request++ } }, [current])
  const selected = visible?.selectionAccess === access ? visible.selected : []
  const op = visible?.operation, unresolved = op?.kind === 'operation' && ['pending', 'unknown'].includes(op.state)
  const run = async (resume: boolean) => {
    if (!connected || current.busy || !visible || op?.kind === 'blocked' || !resume && !selected.length) return
    current.busy = true; setState({ ...visible, message: '正在核对负责人' })
    const result = await (resume && op?.kind === 'operation' ? port.resume(scope, op.operationId) : port.add(scope, selected)).catch(() => ({ writeState: 'unknown', operationId: undefined }))
    if (owner.current !== current) return; current.busy = false
    void lookup(result.operationId, ['confirmed', 'reconciled'].includes(result.writeState) ? '负责人最后确认' : result.writeState === 'failed' ? '负责人添加被拒绝，请检查连接权限' : '负责人分配尚未确认')
  }
  return h('section', { 'aria-label': '负责人' }, h('h4', null, '负责人'),
    h('p', { role: 'status' }, !connected ? '连接已断开' : !visible ? '负责人记录尚未确认，请重新读取' : visible.access !== access ? '负责人访问状态已变化，旧确认暂不适用' : visible?.message || (op?.kind === 'blocked' ? '负责人记录当前不可读取' : op?.kind === 'operation' && op.state === 'failed' ? '负责人添加被拒绝，请检查连接权限' : unresolved ? '负责人分配尚未确认' : op?.kind === 'operation' && op.state === 'saved' ? '负责人最后确认；身份暂不可读取' : '选择负责人，最多 10 个')),
    !connected || !op || op.kind === 'blocked' ? null : h(ChangeRequestAssigneePicker, { scope: { workspaceId: scope.workspaceId, workItemId: scope.workItemId, repositoryId: scope.repositoryId }, port, connected, accessToken, value: selected, disabled: unresolved || current.busy, onChange: selected => setState(old => old?.owner === current ? { ...old, selected, selectionAccess: access } : old) }),
    !op || op.kind === 'blocked' ? h('button', { type: 'button', disabled: !connected || current.busy, onClick: () => void lookup() }, '重新读取负责人记录') : null,
    h('button', { type: 'button', disabled: !connected || !op || op.kind === 'blocked' || current.busy || (!unresolved && !selected.length), onClick: () => void run(unresolved) }, unresolved ? '核对原 PR 分配' : '添加负责人'))
}
