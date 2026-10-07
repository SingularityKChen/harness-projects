/** 离线种子：issue-backed / draft-backed / change-request-backed 三件套。公开仓库，所有标识都是占位符：不含真实账号、仓库、token、主机名或本机路径（AGENTS.md §7）；每个种子带一条待投递观察，让重复事件与乱序事件场景无需外部输入即可构造。 */
import { ContentKind, ExternalIdentityKind, RedactionReason, type NativePlanningFieldValue, type ProviderBindingId } from '@harness-projects/domain'
import type { ExternalObjectRef, ProviderPlanningContent, ProviderProject } from '@harness-projects/capabilities'
import {
  defaultFieldDefinitions, defaultIterations, emptyFields, emptyPlanningState, enqueueObservation,
  nextSourceVersion, type FakePlanningState,
} from './state.ts'
export const FakeFixtureName = {
  IssueBacked: 'issue-backed',
  DraftBacked: 'draft-backed',
  ChangeRequestBacked: 'change-request-backed',
} as const
export type FakeFixtureName = (typeof FakeFixtureName)[keyof typeof FakeFixtureName]

export const FIXTURE_PROJECT_EXTERNAL_ID = 'project-alpha'
type ItemSeed = { objectKind: string; externalId: string; content: ProviderPlanningContent; statusKey: string; nativeValues: Readonly<Record<string, NativePlanningFieldValue>> }

const ref = (bindingId: ProviderBindingId, objectKind: string, externalId: string): ExternalObjectRef =>
  ({ bindingId, objectKind, externalId, url: undefined })

/** 原生选项 id → 平台展示名：与 `defaultFieldDefinitions()` 的 status 选项一致，未映射时由 core 原样透出。 */
const STATUS_NAMES: Readonly<Record<string, string>> = { todo: 'Todo', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done' }
const statusValue = (optionId: string): NativePlanningFieldValue => ({ kind: 'single_select', optionId, name: STATUS_NAMES[optionId] ?? null })
/** 种子必须给出实值：Status 单选 +（至少一个条目）迭代值与日期值，读取面完整（空对象只表示「读全了没有值」）。 */
const seedValues = (externalId: string, statusKey: string): Readonly<Record<string, NativePlanningFieldValue>> => {
  if (!Object.hasOwn(STATUS_NAMES, statusKey)) return {}
  const values: Record<string, NativePlanningFieldValue> = { status: statusValue(statusKey) }
  if (externalId === 'issue-1') {
    values.iteration = { kind: 'iteration', iterationId: 'iter-1', title: '迭代一', startDate: '2026-09-01', durationDays: 14 }
    values['target-date'] = { kind: 'date', date: '2026-09-24' }
  }
  if (externalId === 'issue-2') values['target-date'] = { kind: 'date', date: null }
  return values
}

function workItem(objectKind: string, externalId: string, statusKey: string): ItemSeed {
  const content: ProviderPlanningContent = { kind: ContentKind.WorkItem, workItem: { externalId, title: `规划项 ${externalId}`, body: `${externalId} 正文占位` } }
  return { objectKind, externalId, statusKey, nativeValues: seedValues(externalId, statusKey), content }
}

function changeRequest(externalId: string, number: number): ItemSeed {
  const content: ProviderPlanningContent = { kind: ContentKind.ChangeRequest, changeRequest: { externalId, number, title: `变更 ${externalId}`, body: '正文占位' } }
  return { objectKind: ExternalIdentityKind.ChangeRequest, externalId, statusKey: 'in_progress', nativeValues: seedValues(externalId, 'in_progress'), content }
}

const redacted = (externalId: string, reason: RedactionReason, objectKind: string = ExternalIdentityKind.Issue): ItemSeed =>
  ({ objectKind, externalId, statusKey: 'unknown', nativeValues: {}, content: { kind: ContentKind.Redacted, reason } })

const SEEDS: Readonly<Record<FakeFixtureName, readonly ItemSeed[]>> = {
  [FakeFixtureName.IssueBacked]: [
    workItem(ExternalIdentityKind.Issue, 'issue-1', 'in_progress'),
    workItem(ExternalIdentityKind.Issue, 'issue-2', 'todo'),
    changeRequest('pr-7', 7),
    redacted('issue-3', RedactionReason.PolicyRestricted),
    workItem(ExternalIdentityKind.Issue, 'issue-4', 'done'),
  ],
  [FakeFixtureName.DraftBacked]: [
    workItem(ExternalIdentityKind.Draft, 'draft-1', 'todo'),
    workItem(ExternalIdentityKind.Draft, 'draft-2', 'todo'),
    workItem(ExternalIdentityKind.Issue, 'issue-9', 'in_progress'),
  ],
  [FakeFixtureName.ChangeRequestBacked]: [
    changeRequest('pr-11', 11),
    changeRequest('pr-12', 12),
    redacted('pr-13', RedactionReason.PermissionDenied, ExternalIdentityKind.ChangeRequest),
  ],
}

export function fixtureProjectRef(bindingId: ProviderBindingId): ExternalObjectRef {
  return ref(bindingId, 'project', FIXTURE_PROJECT_EXTERNAL_ID)
}

/** 构造一份带种子的内存状态；同一 fixture 名称必须得到同样的外部 id 集合。 */
export function seedFor(name: FakeFixtureName, bindingId: ProviderBindingId): FakePlanningState {
  const state = emptyPlanningState()
  const projectRef = fixtureProjectRef(bindingId)
  const project: ProviderProject = { ref: projectRef, title: '项目 Alpha', sourceUpdatedAt: '2026-09-20T00:00:00Z' }
  state.projects.push(project)
  state.fields.push(...defaultFieldDefinitions())
  state.iterations.push(...defaultIterations())
  for (const seed of SEEDS[name]) {
    const itemRef = ref(bindingId, seed.objectKind, seed.externalId)
    state.items.push({
      ref: itemRef, project: projectRef, content: seed.content,
      membership: { externalId: `m-${seed.externalId}`, createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z' },
      fields: { ...emptyFields(), statusKey: seed.statusKey, nativeValues: seed.nativeValues },
      sourceVersion: nextSourceVersion(state), sourceUpdatedAt: '2026-09-20T00:00:00Z',
    })
    enqueueObservation(state, {
      ref: itemRef, type: `${seed.objectKind}.updated`,
      // 稳定负载包含原生字段值：同秒内的字段变化必须改变 dedupeKey（R4；`makeObservation` 只做键序无关的规范哈希）。
      stableFields: { externalId: seed.externalId, statusKey: seed.statusKey, nativeValues: seed.nativeValues },
    })
  }
  return state
}
