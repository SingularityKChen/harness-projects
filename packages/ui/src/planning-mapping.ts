import { createElement as h, useState, useSyncExternalStore, useId, useRef, useEffect, type ReactElement } from 'react'
import { NormalizedStatus } from '@harness-projects/domain/values'
import type { WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import type { PlanningMappingSource } from '@harness-projects/client'
import { FORM_STYLES, focusFormError } from './form-presentation.ts'
import type { DOMElement } from './work-item-detail.ts'
/** 表单只持 ID intent；确认结果始终由 source 的 Host 读回给出。 */
export function PlanningMappingForm({ source }: { readonly source: PlanningMappingSource }): ReactElement {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot), data = snapshot.data
  const [draft, setDraft] = useState<{ source: PlanningMappingSource; scope: string; mapping: WorkspacePlanningFieldMapping } | undefined>(undefined)
  const prefix = useId(), form = useRef<DOMElement | null>(null), submitted = useRef(false)
  useEffect(() => () => { submitted.current = false }, [source])
  useEffect(() => { if (data?.confirmed && !snapshot.intent && draft?.source === source && draft.scope === JSON.stringify(data.scope) && JSON.stringify(draft.mapping) === JSON.stringify(data.mapping)) setDraft(undefined) }, [data, snapshot.intent, draft, source])
  useEffect(() => { if (!snapshot.pending && submitted.current) { submitted.current = false; if (snapshot.error) focusFormError(form.current) } }, [snapshot])
  const described = (id: string) => `${id}-help${snapshot.error ? ` ${prefix}-error` : ''}`
  if (!data) return h('section', { className: 'hp-form', 'aria-label': '字段映射', 'aria-busy': snapshot.pending }, snapshot.error ? h('p', { role: 'alert' }, snapshot.error) : h('p', { role: 'status' }, '正在读取字段定义。'), snapshot.error && snapshot.scope ? h('button', { className: 'hp-action', type: 'button', disabled: snapshot.pending, onClick: () => { if (snapshot.scope) void source.refresh(snapshot.scope) } }, '重试') : null)
  const unconfirmed = snapshot.intent !== undefined || !data.confirmed
  const notice = snapshot.intent
    ? snapshot.intentState === 'local_only' ? '本地已保存，来源尚未确认。' : snapshot.intentState === 'unknown' ? '映射提交结果未知，请重试确认。' : undefined
    : !data.confirmed ? data.origin ? '本地已保存，来源尚未确认。' : '来源尚未确认，请重试。' : undefined
  const scope = JSON.stringify(data.scope), local = draft?.source === source && draft.scope === scope
  const mapping = local ? draft.mapping : snapshot.intent ?? data.mapping
  const unapplied = local && JSON.stringify(mapping) !== JSON.stringify(data.mapping)
  const change = (next: WorkspacePlanningFieldMapping) => setDraft({ source, scope, mapping: next })
  const choose = (role: 'status' | 'iterationFieldId' | 'targetDateFieldId', kind: string, label: string) => {
    const value = role === 'status' ? mapping.status?.projectFieldId : mapping[role]
    const candidates = data.fields.filter((field) => field.kind === kind)
    const id = `${prefix}-${role}`
    return h('div', { key: role, className: 'hp-field' }, h('label', { htmlFor: id }, label), h('select', { id, 'aria-describedby': described(id), value: value ?? '', disabled: snapshot.pending, onChange: (event: { target: { value: string } }) => {
      const next = { ...mapping }; delete next[role]
      if (event.target.value) { if (role === 'status') next.status = { projectFieldId: event.target.value, options: {} }; else next[role] = event.target.value }
      change(next)
    } }, h('option', { value: '' }, '不映射'), value && !candidates.some((field) => field.id === value) ? h('option', { value }, `当前定义中已不存在（${value}）`) : null,
    ...candidates.map((field) => h('option', { key: field.id, value: field.id }, `${field.name}（${field.id}）`))), h('p', { id: `${id}-help` }, '按字段类型选择；名称相同时请核对括号中的来源 ID。'))
  }
  const status = mapping.status, field = data.fields.find((field) => field.id === status?.projectFieldId)
  const options = field?.options ?? [], orphanOptions = Object.keys(status?.options ?? {}).filter((id) => !options.some((option) => option.id === id))
  return h('form', { className: 'hp-form', ref: form, 'aria-busy': snapshot.pending, 'aria-label': '字段映射', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); submitted.current = true; void source.save(mapping) } },
    h('style', null, FORM_STYLES), h('h3', null, '字段映射'), !snapshot.pending && !snapshot.error && !unconfirmed && !unapplied ? h('p', null, '当前字段映射已确认。') : null, choose('status', 'single_select', '状态字段'), choose('iterationFieldId', 'iteration', '迭代字段'), choose('targetDateFieldId', 'date', '目标日期字段'),
    ...[...options, ...orphanOptions.map((id) => ({ id, name: '当前定义中已不存在' }))].map((option, index) => h('div', { key: option.id, className: 'hp-field' }, h('label', { htmlFor: `${prefix}-option-${index}` }, `${option.name}（${option.id}）`), h('select', { id: `${prefix}-option-${index}`, 'aria-describedby': described(`${prefix}-option-${index}`),
      value: status && Object.hasOwn(status.options, option.id) ? status.options[option.id] : '', disabled: snapshot.pending, onChange: (event: { target: { value: string } }) => {
        if (!status) return
        const next = { ...status.options, [option.id]: event.target.value as Exclude<NormalizedStatus, 'unknown'> }
        if (!event.target.value) delete next[option.id]
        change({ ...mapping, status: { ...status, options: next } })
      },
    }, h('option', { value: '' }, '未映射'), ...Object.values(NormalizedStatus).filter((value) => value !== 'unknown').map((value) => h('option', { key: value, value }, value))), h('p', { id: `${prefix}-option-${index}-help` }, '选择该来源选项对应的规划状态；未映射不会改写来源选项。'))),
    data.fields.length === 0 ? h('p', null, '当前项目没有字段定义。') : null,
    h('div', { className: 'hp-form-actions' }, h('button', { className: 'hp-action hp-action-primary', type: 'submit', disabled: snapshot.pending }, snapshot.pending ? '正在应用映射' : '应用映射')),
    unapplied ? h('p', { className: 'hp-form-notice', role: 'status' }, '草稿尚未应用；重新读取字段定义不会覆盖草稿。') : null,
    notice ? h('p', { className: 'hp-form-notice', role: 'status', 'aria-live': 'polite' }, notice) : null,
    snapshot.error ? h('div', { id: `${prefix}-error`, className: 'hp-form-notice', role: 'alert', tabIndex: -1, 'data-form-error': true }, h('strong', null, '字段映射未完成'), h('p', null, snapshot.error), h('p', null, '草稿已保留，请重试或重新读取字段定义。')) : null,
    snapshot.error || unconfirmed ? h('button', { className: 'hp-action', type: 'button', disabled: snapshot.pending, onClick: () => { submitted.current = true; if (snapshot.recovery === 'refresh' && snapshot.scope) void source.refresh(snapshot.scope); else void source.save(mapping) } }, snapshot.recovery === 'refresh' ? '重新读取字段定义' : '重试') : null)
}
