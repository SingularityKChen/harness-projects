import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import type { StartWork, StartWorkOptions, StartWorkResult } from '@harness-projects/client'
import type { ExecutionTarget, StartWorkRepository } from '@harness-projects/ui-model'
import type { DOMElement } from './work-item-detail.ts'
import { executionStyles } from './execution-presentation.ts'
type FocusListener = (event: { readonly target?: DOMElement | null }) => void
type FocusDocument = { readonly body?: DOMElement; readonly activeElement?: DOMElement | null; addEventListener?(name: 'focusin', listener: FocusListener): void; removeEventListener?(name: 'focusin', listener: FocusListener): void }
type FormElement = DOMElement & { readonly ownerDocument?: FocusDocument }
const messages: Record<string, string> = {
  confirmed: '开始工作已确认', reconciled: '开始工作已对账确认', local_only: '本地已记录，外部结果尚未确认',
  pending: '正在处理，需读回确认', unknown: '结果未知，请先读回并恢复', failed: '开始工作失败，可修改后重试', conflict: '开始工作冲突，请检查工作树或连接设置后重试',
}
/** 唯一 dialog 内的显式表单；只持草稿与请求状态，执行结果由已有执行区重读。 */
export function StartWorkSection({ target, repositories, startWork, connected, onStarted, onBindRepository }: {
  readonly target: ExecutionTarget; readonly repositories: readonly StartWorkRepository[]; readonly startWork: StartWork; readonly connected: boolean
  readonly onStarted: () => void; readonly onBindRepository?: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false), [repository, setRepository] = useState(''), [branch, setBranch] = useState('')
  const [options, setOptions] = useState<StartWorkOptions | undefined>(undefined), [result, setResult] = useState<StartWorkResult | undefined>(undefined)
  const [pending, setPending] = useState(false), [failedRead, setFailedRead] = useState(false)
  const generation = useRef(0), field = useRef<DOMElement | null>(null), id = useId(), key = JSON.stringify([target.workspaceId, target.workItemId])
  const form = useRef<FormElement | null>(null), submitAction = useRef<DOMElement | null>(null), focusTicket = useRef<{ readonly version: number } | undefined>(undefined)
  useEffect(() => {
    const version = ++generation.current
    setOptions(undefined); setResult(undefined); setPending(false); setFailedRead(false)
    if (open && connected) void startWork.options(target).then((value) => { if (version === generation.current) setOptions(value) }, () => { if (version === generation.current) setFailedRead(true) })
    if (open) field.current?.focus?.()
    return () => { generation.current++; focusTicket.current = undefined }
  }, [key, open, connected, startWork])
  useEffect(() => {
    const ticket = focusTicket.current, doc = form.current?.ownerDocument
    if (!ticket || ticket.version !== generation.current || !open || !connected || !doc) return
    if (pending) {
      const moved: FocusListener = (event) => { if (event.target && event.target !== doc.body && focusTicket.current === ticket) focusTicket.current = undefined }
      doc.addEventListener?.('focusin', moved)
      return () => { doc.removeEventListener?.('focusin', moved) }
    }
    if (result !== undefined && focusTicket.current === ticket) {
      focusTicket.current = undefined
      if ((doc.activeElement == null || doc.activeElement === doc.body) && form.current?.isConnected === true && submitAction.current?.isConnected === true) submitAction.current.focus?.()
    }
  }, [key, open, connected, startWork, pending, result])
  const selected = repositories.find((entry) => entry.id === repository)
  const allowed = connected && !!options && selected?.available === true
  const submit = (): void => {
    if (!allowed) return
    const version = generation.current, focused = form.current?.ownerDocument?.activeElement
    focusTicket.current = focused && form.current?.contains?.(focused) ? { version } : undefined
    setPending(true)
    void startWork.submit({ workspaceId: target.workspaceId, workItemId: target.workItemId, repositoryId: repository, ...(branch === '' ? {} : { branchName: branch }) }).then((answer) => {
      if (version !== generation.current) return
      setPending(false); setResult(answer); onStarted()
    })
  }
  const failedContext = result?.writeState === 'local_only' && result.contextStatus === 'failed'
  const failed = result?.writeState === 'failed' || result?.writeState === 'conflict' || failedContext
  const bind = !repositories.length || (selected && !selected.available)
  return h('section', { className: 'hp-execution', 'aria-label': '开始工作' }, executionStyles(), h('h3', null, '开始工作'),
    !open ? h('button', { className: 'hp-action', type: 'button', onClick: () => setOpen(true) }, '开始工作') : h('form', { ref: form, className: 'hp-form', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); submit() } },
      h('p', null, options?.executionMode === 'harness' ? 'Harness 执行' : options ? '人工执行：在创建的工作树继续处理' : failedRead ? '暂时无法读取执行方式，请重新展开表单' : '正在读取执行方式'),
      h('div', { className: 'hp-field' }, h('label', { htmlFor: `${id}-repository` }, '已绑定仓库'), h('select', { id: `${id}-repository`, ref: field, value: repository, disabled: pending, onChange: (event: { target: { value: string } }) => { setRepository(event.target.value); setResult(undefined) } },
        h('option', { value: '' }, '请选择仓库'), ...repositories.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.id)))),
      h('div', { className: 'hp-field' }, h('label', { htmlFor: `${id}-branch` }, '分支名（可留空）'), h('input', { id: `${id}-branch`, value: branch, disabled: pending, onChange: (event: { target: { value: string } }) => { setBranch(event.target.value); setResult(undefined) } })),
      selected?.access === 'degraded' ? h('p', null, '仓库能力降级，结果需要确认') : null,
      bind ? h('p', null, '此仓库尚无可用路由或写权限。', onBindRepository ? h('button', { type: 'button', onClick: onBindRepository }, '绑定仓库') : '请在连接设置中绑定仓库') : null,
      result ? h('div', { className: 'hp-execution-notice', role: 'status', 'aria-live': 'polite' },
        h('p', null, failedContext ? '开始工作失败，本地记录已保留，可重新提交' : messages[result.writeState], result.degraded ? '（降级）' : ''),
        result.fallback ? h('p', null, '人工处理，可在工作树继续') : null) : null,
      h('div', { className: 'hp-form-actions' }, h('button', { ref: submitAction, className: 'hp-action', type: 'submit', disabled: !allowed || pending }, pending ? '正在提交' : result && ['unknown', 'pending'].includes(result.writeState) ? '读回并恢复' : failed ? '重新提交' : '提交开始工作'),
      h('button', { type: 'button', onClick: () => setOpen(false) }, '收起表单'))))
}
