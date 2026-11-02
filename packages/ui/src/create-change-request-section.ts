import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ChangeRequestCreation, ChangeRequestCreator, ChangeRequestOperationRead, DeliveryLineageScope } from '@harness-projects/client'
/** 恢复只观察原操作；确认后由谱系 section 纯读现有快照。 */
export function CreateChangeRequestSection({ scope, creator, connected, onConfirmed, onConnect }: {
  readonly scope: DeliveryLineageScope; readonly creator: ChangeRequestCreator; readonly connected: boolean; readonly onConfirmed: () => void; readonly onConnect?: (() => void) | undefined
}) {
  const key = JSON.stringify(scope), owner = useRef({ key, connected, creator, generation: 0, lookup: 0, pending: false })
  if (owner.current.key !== key || owner.current.connected !== connected || owner.current.creator !== creator) owner.current = { key, connected, creator, generation: owner.current.generation + 1, lookup: 0, pending: false }
  const current = owner.current
  const [fields, setFields] = useState({ base: '', title: '', body: '' })
  const [view, setView] = useState<{ owner: typeof current; read?: ChangeRequestOperationRead; failed?: boolean } | undefined>(undefined)
  const [result, setResult] = useState<{ owner: typeof current; value: ChangeRequestCreation } | undefined>(undefined), [pending, setPending] = useState(false)
  const valid = (generation: number) => owner.current === current && current.generation === generation && current.connected
  const lookup = async (operationId?: string) => {
    const generation = current.generation, readId = ++current.lookup
    setView({ owner: current })
    try { const read = await creator.operation(scope, operationId); if (valid(generation) && current.lookup === readId) setView({ owner: current, read }) }
    catch { if (valid(generation) && current.lookup === readId) setView({ owner: current, failed: true }) }
  }
  useEffect(() => { setFields({ base: '', title: '', body: '' }); if (connected) void lookup(); return () => { current.generation++ } }, [current])
  const operation = view?.owner === current ? view.read?.operation : undefined
  const value = result?.owner === current ? result.value : undefined, busy = pending && current.pending
  const run = async (resume: boolean) => {
    if (!connected || current.pending || (resume ? operation?.kind !== 'operation' || !operation.currentTarget : operation?.kind !== 'none')) return
    const generation = current.generation
    current.pending = true; setPending(true)
    let answer: ChangeRequestCreation
    try { answer = resume && operation?.kind === 'operation' ? await creator.resume(scope, operation.operationId) : await creator.submit({ ...scope, ...fields }) }
    catch { answer = { writeState: 'unknown' } }
    if (!valid(generation)) return
    current.pending = false; setPending(false); setResult({ owner: current, value: answer })
    if (['confirmed', 'reconciled'].includes(answer.writeState)) onConfirmed()
    if (['unknown', 'pending', 'confirmed', 'reconciled'].includes(answer.writeState)) void lookup(answer.operationId)
  }
  const accepted = value?.writeState === 'confirmed' || value?.writeState === 'reconciled'
  const confirmed = accepted && operation?.kind === 'operation' && operation.state === 'saved' && operation.currentTarget
    && operation.operationId === value.operationId && operation.targetStamp === value.targetStamp
  const message = !connected ? '连接已断开' : busy ? '正在读回原操作' : view?.owner === current && view.failed ? '原操作读取失败，请重试'
    : operation === undefined ? '正在读取原操作' : operation.kind === 'blocked' || (operation.kind === 'operation' && !operation.currentTarget) ? '原操作当前不可恢复，请检查连接和执行上下文'
      : confirmed ? value.lineageStale ? 'PR 已确认，谱系暂未刷新' : 'PR 已确认'
        : value?.recovery === 'fix_permission' && ['failed', 'conflict'].includes(value.writeState) ? '权限不足，请在连接设置修复后重试'
          : value?.writeState === 'failed' ? '创建 PR 失败，请先完成开始工作并检查输入后重试'
            : value?.writeState === 'conflict' ? 'PR 请求冲突，请检查执行上下文后重试'
          : operation.kind === 'none' ? '从当前执行上下文创建 PR' : accepted ? '原操作尚未确认，请重新读取'
          : '已保存原请求，请读回原操作确认'
  const status = h('p', { role: 'status' }, message)
  const repair = value?.recovery === 'fix_permission' && onConnect !== undefined ? h('button', { type: 'button', onClick: onConnect }, '打开连接设置') : null
  if (!connected || operation?.kind !== 'none') return h('section', { 'aria-label': '创建变更请求' }, h('h4', null, '创建变更请求'), status,
    operation?.kind === 'operation' ? h('p', null, `已保存原请求：${operation.title}；${operation.head} → ${operation.base}`) : null, repair,
    h('button', { type: 'button', className: 'hp-action', disabled: !connected || busy || (operation?.kind === 'operation' && !operation.currentTarget), onClick: () => { if (operation?.kind === 'operation') void run(true); else void lookup() } }, operation?.kind === 'operation' ? '读回原操作' : '重新读取'))
  return h('form', { onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void run(false) }, 'aria-label': '创建变更请求' },
    h('h4', null, '创建变更请求'),
    ...(['base', 'title', 'body'] as const).map((name) => h('label', { key: name }, { base: '目标分支', title: '标题', body: '正文' }[name],
      h(name === 'body' ? 'textarea' : 'input', { name, value: fields[name], required: name !== 'body', disabled: busy, onChange: (event: { target: { value: string } }) => setFields((old) => ({ ...old, [name]: event.target.value })) }))),
    status, repair, h('button', { type: 'submit', className: 'hp-action', disabled: busy || fields.base === '' || fields.title === '' }, '创建 PR'))
}
