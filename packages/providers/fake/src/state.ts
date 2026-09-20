/** 内存对象表：每个对象的 source version 与待投递观察队列。只保存外部事实的镜像；内部实体 id 不在替身里——provider 只认外部 id（AGENTS.md §1.1 不变量 1）。 */
import type { ProviderBindingId } from '@harness-projects/domain'
import {
  makeObservation,
  type ExternalObjectRef,
  type ProviderIteration,
  type ProviderObservation,
  type ProviderPage,
  type ProviderPlanningContent,
  type ProviderPlanningFieldDefinition,
  type ProviderPlanningFields,
  type ProviderPlanningItem,
  type ProviderProject,
} from '@harness-projects/capabilities'
export type FakePlanningItemRecord = {
  ref: ExternalObjectRef; project: ExternalObjectRef; content: ProviderPlanningContent
  fields: ProviderPlanningFields; sourceVersion: string; sourceUpdatedAt: string
}

export type FakePlanningState = {
  projects: ProviderProject[]; items: FakePlanningItemRecord[]; fields: ProviderPlanningFieldDefinition[]
  iterations: ProviderIteration[]; observations: ProviderObservation[]; versionSeq: number
}

/** 对象键：binding 内 `(objectKind, externalId)` 唯一；数组序列化避免分隔符碰撞。 */
export function itemKey(ref: ExternalObjectRef): string { return JSON.stringify([ref.bindingId, ref.objectKind, ref.externalId]) }

/** 外部对象定位子构造器。url 一律 undefined：替身不伪造平台跳转链接（公开仓库的字符串都在发布面内）。 */
export function refOf(bindingId: ProviderBindingId, objectKind: string, externalId: string): ExternalObjectRef {
  return { bindingId, objectKind, externalId, url: undefined }
}

/** 分页输入的公共形状：工程域列表方法只依赖 cursor 与 limit，不关心其余过滤条件。 */
export interface FakePageInput { readonly cursor: string | undefined; readonly limit: number }

/** 游标分页与 Planning 替身同一规则：cursor 是十进制偏移，nextCursor 未定义即遍历结束。 */
export function paginate<T>(rows: readonly T[], input: FakePageInput): ProviderPage<T> {
  const offset = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10)
  const next = offset + input.limit
  return { items: rows.slice(offset, next), nextCursor: next < rows.length ? String(next) : undefined }
}

/** 分页前的稳定排序：列表顺序必须与游标推进一致，否则一次遍历会重复或漏掉对象。 */
export function byExternalId<T extends { readonly ref: ExternalObjectRef }>(a: T, b: T): number {
  return a.ref.externalId < b.ref.externalId ? -1 : 1
}

export function findItem(state: FakePlanningState, ref: ExternalObjectRef): FakePlanningItemRecord | undefined {
  const key = itemKey(ref)
  return state.items.find((item) => itemKey(item.ref) === key)
}

export function replaceItem(state: FakePlanningState, record: FakePlanningItemRecord): void {
  const index = state.items.findIndex((item) => itemKey(item.ref) === itemKey(record.ref))
  if (index === -1) state.items.push(record)
  else state.items[index] = record
}

/** 删除一个对象：draft→issue 提升会换外部 id，旧键必须消失而不是留在表里。 */
export function removeItem(state: FakePlanningState, ref: ExternalObjectRef): void {
  state.items = state.items.filter((item) => itemKey(item.ref) !== itemKey(ref))
}

export function nextSourceVersion(state: FakePlanningState): string {
  state.versionSeq += 1
  return `v${state.versionSeq}`
}
export function toPlanningItem(record: FakePlanningItemRecord): ProviderPlanningItem {
  return {
    ref: record.ref, project: record.project, content: record.content,
    fields: record.fields, sourceVersion: record.sourceVersion, sourceUpdatedAt: record.sourceUpdatedAt,
  }
}

export function emptyFields(): ProviderPlanningFields {
  return {
    statusKey: undefined, priority: undefined, assigneeRefs: [], iterationId: undefined,
    startDate: undefined, targetDate: undefined, customFields: {},
  }
}

export function defaultFieldDefinitions(): ProviderPlanningFieldDefinition[] {
  return [
    { id: 'status', name: '状态', kind: 'single_select', options: ['todo', 'in_progress', 'blocked', 'done'] },
    { id: 'priority', name: '优先级', kind: 'single_select', options: ['low', 'medium', 'high'] },
    { id: 'iteration', name: '迭代', kind: 'single_select', options: ['iter-1', 'iter-2'] },
  ]
}

export function defaultIterations(): ProviderIteration[] {
  return [
    { id: 'iter-1', title: '迭代一', startDate: '2026-09-01', targetDate: '2026-09-14' },
    { id: 'iter-2', title: '迭代二', startDate: '2026-09-15', targetDate: '2026-09-28' },
  ]
}

export function emptyPlanningState(): FakePlanningState {
  return { projects: [], items: [], fields: [], iterations: [], observations: [], versionSeq: 0 }
}

export type ObservationDraft = {
  ref: ExternalObjectRef; type: string; stableFields: Readonly<Record<string, unknown>>
  payload?: unknown; eventTime?: string; receivedTime?: string; sourceVersion?: string
}

/** dedupeKey 与 payloadHash 由 capabilities 的契约函数计算，替身不另发明规则。 */
export function enqueueObservation(state: FakePlanningState, draft: ObservationDraft): ProviderObservation {
  const observation = makeObservation({
    subject: draft.ref, type: draft.type,
    eventTime: draft.eventTime ?? '2026-09-20T00:00:00Z', receivedTime: draft.receivedTime ?? '2026-09-20T00:00:01Z',
    sourceVersion: draft.sourceVersion, stablePayloadFields: draft.stableFields, payload: draft.payload ?? draft.stableFields,
  })
  state.observations.push(observation)
  return observation
}
