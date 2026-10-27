import { createElement as h, useState, useSyncExternalStore, type ReactElement } from 'react'
import { NormalizedStatus } from '@harness-projects/domain/values'
import type { WorkspacePlanningFieldMapping } from '@harness-projects/domain'
import type { PlanningMappingSource } from '@harness-projects/client'
/** 表单只持 ID intent；确认结果始终由 source 的 Host 读回给出。 */
export function PlanningMappingForm({ source }: { readonly source: PlanningMappingSource }): ReactElement {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot), data = snapshot.data
  const [draft, setDraft] = useState<{ data: typeof data; mapping: WorkspacePlanningFieldMapping } | undefined>(undefined)
  if (!data) return h('section', { 'aria-label': '字段映射' }, snapshot.error ? h('p', { role: 'alert' }, snapshot.error) : h('p', { role: 'status' }, '正在读取字段定义。'), snapshot.error && snapshot.scope ? h('button', { type: 'button', disabled: snapshot.pending, onClick: () => { if (snapshot.scope) void source.refresh(snapshot.scope) } }, '重试') : null)
  const unconfirmed = snapshot.intent !== undefined || !data.confirmed
  const notice = snapshot.intent
    ? snapshot.intentState === 'local_only' ? '本地已保存，来源尚未确认。' : snapshot.intentState === 'unknown' ? '映射提交结果未知，请重试确认。' : undefined
    : !data.confirmed ? data.origin ? '本地已保存，来源尚未确认。' : '来源尚未确认，请重试。' : undefined
  const mapping = draft?.data === data ? draft.mapping : snapshot.intent ?? data.mapping
  const change = (next: WorkspacePlanningFieldMapping) => setDraft({ data, mapping: next })
  const choose = (role: 'status' | 'iterationFieldId' | 'targetDateFieldId', kind: string, label: string) => {
    const value = role === 'status' ? mapping.status?.projectFieldId : mapping[role]
    const candidates = data.fields.filter((field) => field.kind === kind)
    return h('label', { key: role }, label, h('select', { value: value ?? '', disabled: snapshot.pending, onChange: (event: { target: { value: string } }) => {
      const next = { ...mapping }; delete next[role]
      if (event.target.value) { if (role === 'status') next.status = { projectFieldId: event.target.value, options: {} }; else next[role] = event.target.value }
      change(next)
    } }, h('option', { value: '' }, '不映射'), value && !candidates.some((field) => field.id === value) ? h('option', { value }, `当前定义中已不存在（${value}）`) : null,
    ...candidates.map((field) => h('option', { key: field.id, value: field.id }, `${field.name}（${field.id}）`))))
  }
  const status = mapping.status, field = data.fields.find((field) => field.id === status?.projectFieldId)
  const options = field?.options ?? [], orphanOptions = Object.keys(status?.options ?? {}).filter((id) => !options.some((option) => option.id === id))
  return h('form', { 'aria-label': '字段映射', onSubmit: (event: { preventDefault(): void }) => { event.preventDefault(); void source.save(mapping) } },
    h('h3', null, '字段映射'), choose('status', 'single_select', '状态字段'), choose('iterationFieldId', 'iteration', '迭代字段'), choose('targetDateFieldId', 'date', '目标日期字段'),
    ...[...options, ...orphanOptions.map((id) => ({ id, name: '当前定义中已不存在' }))].map((option) => h('label', { key: option.id }, `${option.name}（${option.id}）`, h('select', {
      value: status && Object.hasOwn(status.options, option.id) ? status.options[option.id] : '', disabled: snapshot.pending, onChange: (event: { target: { value: string } }) => {
        if (!status) return
        const next = { ...status.options, [option.id]: event.target.value as Exclude<NormalizedStatus, 'unknown'> }
        if (!event.target.value) delete next[option.id]
        change({ ...mapping, status: { ...status, options: next } })
      },
    }, h('option', { value: '' }, '未映射'), ...Object.values(NormalizedStatus).filter((value) => value !== 'unknown').map((value) => h('option', { key: value, value }, value))))),
    data.fields.length === 0 ? h('p', null, '当前项目没有字段定义。') : null,
    h('button', { type: 'submit', disabled: snapshot.pending }, snapshot.pending ? '正在应用映射' : '应用映射'),
    notice ? h('p', { role: 'status' }, notice) : null,
    snapshot.error ? h('p', { role: 'alert' }, snapshot.error) : null,
    snapshot.error || unconfirmed ? h('button', { type: 'button', disabled: snapshot.pending, onClick: () => { if (snapshot.recovery === 'refresh' && snapshot.scope) void source.refresh(snapshot.scope); else void source.save(mapping) } }, snapshot.recovery === 'refresh' ? '重新读取字段定义' : '重试') : null)
}
