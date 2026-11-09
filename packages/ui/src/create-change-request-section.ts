import { createElement as h, useEffect, useRef, useState } from 'react'
import { ChangeRequestAssigneesSection } from './change-request-assignees-section.ts'
import type { ChangeRequestIssueOptions, IssueRelation, ChangeRequestCreation, ChangeRequestCreator, ChangeRequestOperationRead, DeliveryLineageScope } from '@harness-projects/client'
/** 恢复只观察原操作；确认后由谱系 section 纯读现有快照。 */
export function CreateChangeRequestSection({ scope, creator, connected, accessToken, assigneeAccessToken, onConfirmed, onConnect }: {
  readonly scope: DeliveryLineageScope; readonly creator: ChangeRequestCreator; readonly connected: boolean; readonly accessToken?: string | undefined; readonly assigneeAccessToken?: string | undefined; readonly onConfirmed: () => void; readonly onConnect?: (() => void) | undefined
}) {
  const key = JSON.stringify(scope), owner = useRef({ key, connected, creator, generation: 0, lookup: 0, probe: 0, pending: false })
  if (owner.current.key !== key || owner.current.connected !== connected || owner.current.creator !== creator) owner.current = { key, connected, creator, generation: owner.current.generation + 1, lookup: 0, probe: 0, pending: false }
  const current = owner.current
  const accessRef = useRef({ owner: current, token: accessToken })
  if (accessRef.current.owner !== current || accessRef.current.token !== accessToken) accessRef.current = { owner: current, token: accessToken }
  const access = accessRef.current, observed = useRef(access), opened = useRef<{ owner: typeof current; base: string } | undefined>(undefined)
  const [fields, setFields] = useState({ base: '', title: '', body: '', draft: false, issueRelation: undefined as IssueRelation | undefined })
  const [issueView, setIssueView] = useState<{ owner: typeof current; access: typeof access; base: string; value: ChangeRequestIssueOptions } | undefined>(undefined)
  const [view, setView] = useState<{ owner: typeof current; access?: typeof access; read?: ChangeRequestOperationRead; failed?: boolean } | undefined>(undefined)
  const [result, setResult] = useState<{ owner: typeof current; access: typeof access; value: ChangeRequestCreation } | undefined>(undefined), [pending, setPending] = useState(false)
  const valid = (generation: number, receipt: typeof access) => owner.current === current && current.generation === generation && current.connected && accessRef.current === receipt
  const lookup = async (operationId?: string, preserve = false) => {
    const generation = current.generation, readId = ++current.lookup, receipt = accessRef.current
    setView(old => preserve && old?.owner === current ? old : { owner: current })
    try { const read = await creator.operation(scope, operationId); if (valid(generation, receipt) && current.lookup === readId) setView({ owner: current, access: receipt, read }) }
    catch { if (valid(generation, receipt) && current.lookup === readId) setView({ owner: current, access: receipt, failed: true }) }
  }
  useEffect(() => { setFields({ base: '', title: '', body: '', draft: false, issueRelation: undefined as IssueRelation | undefined }); if (connected) void lookup(); return () => { current.generation++ } }, [current])
  // 权限 metadata 只重查 Host；用户草稿、进行中的写入和消费者身份保持。
  useEffect(() => { const previous = observed.current; observed.current = access; if (previous.owner === current && previous !== access && connected) void lookup(undefined, true) }, [access])
  const saved = view?.owner === current ? view.read?.operation : undefined
  const operation = saved?.kind === 'operation' && view?.access !== access ? { ...saved, issueTarget: undefined } : saved
  const options = issueView?.owner === current && issueView.access === access && issueView.base === fields.base ? issueView.value : undefined
  const issueRelation = fields.issueRelation ?? options?.defaultRelation ?? 'none'
  const loadOptions = () => {
    if (!connected || current.pending || operation?.kind !== 'none') return
    const generation = current.generation, base = fields.base, receipt = accessRef.current, probe = ++current.probe
    setIssueView(undefined)
    const accept = (value: ChangeRequestIssueOptions) => { if (valid(generation, receipt) && probe === current.probe) setIssueView({ owner: current, access: receipt, base, value }) }
    void creator.options(scope, base).then(accept, () => accept({ defaultRelation: 'none', relations: ['none'], reason: 'Issue 目标读取失败，可选择不关联' }))
  }
  useEffect(() => {
    if (!connected || operation?.kind !== 'none' || (opened.current?.owner === current && opened.current.base === fields.base)) return
    opened.current = { owner: current, base: fields.base }; loadOptions()
  }, [current, fields.base, operation?.kind])
  const value = result?.owner !== current ? undefined : result.access === access ? result.value
    : { ...result.value, relationState: result.value.relationState === undefined || result.value.relationState === 'none' ? result.value.relationState : 'unknown' as const }, busy = pending && current.pending
  const run = async (resume: boolean) => {
    if (!connected || current.pending || (resume ? view?.access !== access || operation?.kind !== 'operation' || !operation.currentTarget : operation?.kind !== 'none')) return
    if (!resume && (!options || !options.relations.includes(issueRelation))) return
    const generation = current.generation, receipt = access
    current.pending = true; setPending(true)
    let answer: ChangeRequestCreation
    try { answer = resume && operation?.kind === 'operation' ? await creator.resume(scope, operation.operationId) : await creator.submit({ ...scope, ...fields, issueRelation, issueTargetStamp: issueRelation === 'none' ? undefined : options?.targetStamp }) }
    catch { answer = { writeState: 'unknown' } }
    current.pending = false; if (owner.current === current) setPending(false)
    if (!valid(generation, receipt)) { if (owner.current === current && current.connected) void lookup(); return }
    setResult({ owner: current, access: receipt, value: answer })
    if (['confirmed', 'reconciled'].includes(answer.writeState)) onConfirmed()
    if (['unknown', 'pending', 'confirmed', 'reconciled'].includes(answer.writeState)) void lookup(answer.operationId)
  }
  const accepted = value?.writeState === 'confirmed' || value?.writeState === 'reconciled'
  const confirmed = accepted && view?.access === access && operation?.kind === 'operation' && operation.state === 'saved' && operation.currentTarget
    && operation.operationId === value.operationId && operation.targetStamp === value.targetStamp
  const message = !connected ? '连接已断开' : busy ? '正在读回原操作' : view?.owner === current && view.failed ? '原操作读取失败，请重试'
    : operation === undefined ? '正在读取原操作' : operation.kind === 'blocked' || (operation.kind === 'operation' && !operation.currentTarget) ? '原操作当前不可恢复，请检查连接和执行上下文'
      : confirmed ? value.lineageStale ? 'PR 已确认，谱系暂未刷新' : 'PR 已确认'
        : value?.recovery === 'fix_permission' && ['failed', 'conflict'].includes(value.writeState) ? '权限不足，请在连接设置修复后重试'
          : value?.writeState === 'failed' ? '创建 PR 失败，请先完成开始工作并检查输入后重试'
            : value?.writeState === 'conflict' ? 'PR 请求冲突，请检查执行上下文后重试'
          : operation.kind === 'none' ? '从当前执行上下文创建 PR' : accepted ? '原操作尚未确认，请重新读取'
          : '已保存原请求，请读回原操作确认'
  const relationMessage = value?.relationState === undefined || value.relationState === 'none' ? '' : ({ confirmed: '；Issue 关联已由来源确认', pending: '；Issue 关联待确认', denied: '；Issue 关联读取被拒绝', unknown: '；Issue 关联尚未确认' }[value.relationState])
  const status = h('p', { role: 'status' }, `${message}${confirmed ? relationMessage : ''}`)
  const repair = value?.recovery === 'fix_permission' && onConnect !== undefined ? h('button', { type: 'button', onClick: onConnect }, '打开连接设置') : null
  if (!connected || operation?.kind !== 'none') return h('section', { 'aria-label': '创建变更请求' }, h('h4', null, '创建变更请求'), status,
    operation?.kind === 'operation' ? h('p', null, `已保存原请求（${operation.draft ? '草稿 PR' : '普通 PR'}）：${operation.title}；${operation.head} → ${operation.base}；${operation.issueRelation === 'none' ? '不关联 Issue' : `${operation.issueTarget === undefined ? '原关联目标不可见，请重新验证来源' : `${operation.issueRelation === 'closing' ? 'Closes' : 'Refs'} ${operation.issueTarget.repositoryName}#${operation.issueTarget.number}`}`}`) : null, repair,
    h('button', { type: 'button', className: 'hp-action', disabled: !connected || busy || (operation?.kind === 'operation' && (view?.access !== access || !operation.currentTarget)), onClick: () => { if (operation?.kind === 'operation') void run(true); else void lookup() } }, operation?.kind === 'operation' ? '读回原操作' : '重新读取'),
    ...(connected && view?.access === access && operation?.kind === 'operation' && operation.currentTarget && operation.state === 'saved' && creator.assignees ? [h(ChangeRequestAssigneesSection, { key: JSON.stringify([key, accessToken]), scope: { ...scope, createOperationId: operation.operationId }, port: creator.assignees, connected, accessToken: assigneeAccessToken })] : []))
  return h('form', { onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void run(false) }, 'aria-label': '创建变更请求' },
    h('h4', null, '创建变更请求'),
    ...(['base', 'title', 'body'] as const).map((name) => h('label', { key: name }, { base: '目标分支', title: '标题', body: '正文' }[name],
      h(name === 'body' ? 'textarea' : 'input', { name, value: fields[name], required: name !== 'body', disabled: busy, onChange: (event: { target: { value: string } }) => setFields((old) => ({ ...old, [name]: event.target.value })) }))),
    h('label', null, '来源 Issue 关系', h('select', { name: 'issueRelation', value: issueRelation, disabled: busy || !options, onChange: (event: { target: { value: string } }) => setFields(old => ({ ...old, issueRelation: event.target.value as IssueRelation })) }, ...(['reference', 'closing', 'none'] as const).map(relation => h('option', { key: relation, value: relation, disabled: !options?.relations.includes(relation) }, { reference: '仅引用', closing: '合并时关闭', none: '不关联 Issue' }[relation])))),
    h('p', null, options?.target && issueRelation !== 'none' ? `${issueRelation === 'closing' ? 'Closes' : 'Refs'} ${options.target.repositoryName}#${options.target.number}` : '不添加 Issue 关联', options?.reason ? `；${options.reason}` : ''),
    h('button', { type: 'button', disabled: busy, onClick: loadOptions }, '重新验证来源 Issue'),
    h('label', null, '创建为草稿', h('input', { type: 'checkbox', name: 'draft', checked: fields.draft, disabled: busy, onChange: (event: { target: { checked: boolean } }) => setFields((old) => ({ ...old, draft: event.target.checked })) })),
    status, repair, h('button', { type: 'submit', className: 'hp-action', disabled: busy || !options || !options.relations.includes(issueRelation) || fields.base === '' || fields.title === '' }, fields.draft ? '创建草稿 PR' : '创建 PR'))
}
