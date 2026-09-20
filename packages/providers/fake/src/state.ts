/** 内存对象表：每个对象的 source version 与待投递观察队列。只保存外部事实的镜像；内部实体 id 不在替身里——provider 只认外部 id（AGENTS.md §1.1 不变量 1）。 */
import {
  makeObservation,
  type ExternalObjectRef,
  type ProviderIteration,
  type ProviderObservation,
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
