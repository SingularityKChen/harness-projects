/** 离线 Planning provider：实现 A2 冻结的 PlanningProvider（读能力全套 + 可选写能力）。失败一律翻译成结构化 ProviderResult，故障开关打开时不抛裸错误；provider 只改外部 id：draft→issue 提升返回新的外部 id，内部实体 id 由调用方保持（AGENTS.md §1.1 不变量 1）。命名空间导入是本包唯一风格偏差：port 类型名很长，逐个具名导入会把文件推过 200 行上限。 */
import * as cap from '@harness-projects/capabilities'
import * as domain from '@harness-projects/domain'
import { createFaultSwitch, FaultKind, type FaultPlan, type FaultSwitch } from './faults.ts'
import { FakeFixtureName, seedFor } from './fixtures.ts'
import {
  emptyFields, enqueueObservation, findItem, itemKey, nextSourceVersion, removeItem, replaceItem,
  toPlanningItem, type FakePlanningItemRecord, type FakePlanningState, type ObservationDraft,
} from './state.ts'
export type FakePlanningCapabilities = { createIssue: boolean; createDraft: boolean; fields: boolean; reconcile?: boolean } // reconcile === false 时替身不声明该可选 port 成员
const ALL_CAPABILITIES: FakePlanningCapabilities = { createIssue: true, createDraft: true, fields: true }
/** 未启用的能力不出现在快照里；缺 permission 由 capabilities 层判定为 unavailable。 */
function declaredCapabilities(flags: FakePlanningCapabilities): Partial<Record<cap.CapabilityKey, cap.AccessLevel>> {
  const map: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {
    [cap.CapabilityKey.PlanningItemRead]: cap.AccessLevel.Available,
    [cap.CapabilityKey.PlanningIterationRead]: cap.AccessLevel.Available,
  }
  if (flags.createIssue) map[cap.CapabilityKey.PlanningItemCreateIssue] = cap.AccessLevel.Available
  if (flags.createDraft) map[cap.CapabilityKey.PlanningItemCreateDraft] = cap.AccessLevel.Available
  if (flags.fields) map[cap.CapabilityKey.PlanningStatusWrite] = cap.AccessLevel.Available
  // 内容写与移动在 A2 有 key（content.write）但本批未实现：键不声明，方法不提供。
  return map
}
/** patch 的三态：undefined = 不改；null = 清空；其它 = 覆盖。 */
function applyFieldPatch(f: cap.ProviderPlanningFields, p: cap.ProviderPlanningFieldPatch): cap.ProviderPlanningFields {
  const pick = <T>(next: T | null | undefined, current: T | undefined): T | undefined => (next === undefined ? current : (next ?? undefined))
  return {
    statusKey: p.statusKey ?? f.statusKey, priority: p.priority ?? f.priority, assigneeRefs: p.assigneeRefs ?? f.assigneeRefs,
    iterationId: pick(p.iterationId, f.iterationId), startDate: pick(p.startDate, f.startDate), targetDate: pick(p.targetDate, f.targetDate),
    customFields: f.customFields,
  }
}
export type FakePlanningProviderOptions = {
  bindingId?: domain.ProviderBindingId; fixture?: FakeFixtureName; faults?: Partial<FaultPlan>
  capabilities?: Partial<FakePlanningCapabilities>; observedAt?: string
}
export class FakePlanningProvider implements cap.PlanningProvider {
  readonly state: FakePlanningState
  readonly faultsSwitch: FaultSwitch
  readonly flags: FakePlanningCapabilities
  readonly bindingId: domain.ProviderBindingId
  readonly observedAt: string
  constructor(options: FakePlanningProviderOptions = {}) {
    this.bindingId = options.bindingId ?? domain.newProviderBindingId()
    this.observedAt = options.observedAt ?? '2026-09-20T00:00:00Z'
    this.state = seedFor(options.fixture ?? FakeFixtureName.IssueBacked, this.bindingId)
    this.faultsSwitch = createFaultSwitch(options.faults ?? {})
    this.flags = { ...ALL_CAPABILITIES, ...(options.capabilities ?? {}) }
    if (this.flags.reconcile === false) Object.defineProperty(this, 'reconcile', { value: undefined })
  }
  fail<T>(code: domain.ProviderErrorCode, message: string): cap.ProviderResult<T> { return cap.providerErr(cap.providerError(code, message)) }
  notFound<T>(what: string): cap.ProviderResult<T> { return this.fail(domain.ProviderErrorCode.NotFound, `${what}不存在`) }
  conflict<T>(record: FakePlanningItemRecord): cap.ProviderResult<T> { return this.fail(domain.ProviderErrorCode.Conflict, `source version 已过期：${record.sourceVersion}`) }
  /** port 方法共用闸门：先离线（可重发）再权限（需人补授权）。 */
  blocked<T>(): cap.ProviderResult<T> | undefined {
    if (this.faultsSwitch.isOn(FaultKind.Offline)) return this.fail(domain.ProviderErrorCode.Unavailable, '替身离线：请求未发出')
    if (this.faultsSwitch.isOn(FaultKind.PermissionDenied)) return this.fail(domain.ProviderErrorCode.PermissionDenied, '凭据没有规划项权限')
    return undefined
  }
  /** 写路径的统一戳记：source version 单调递增，供调用方做 compare-and-swap。 */
  stamp(): { sourceVersion: string; sourceUpdatedAt: string } { return { sourceVersion: nextSourceVersion(this.state), sourceUpdatedAt: this.observedAt } }
  describeCapabilities(): Promise<cap.ProviderCapabilitySnapshot> {
    const capability = declaredCapabilities(this.flags)
    const permission: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {}
    const denied = this.faultsSwitch.isOn(FaultKind.PermissionDenied)
    for (const key of Object.keys(capability) as cap.CapabilityKey[]) permission[key] = denied ? cap.AccessLevel.Unavailable : cap.AccessLevel.Available
    return Promise.resolve({ bindingId: this.bindingId, capability, permission, observedAt: this.observedAt })
  }
  async getProject(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderProject>> {
    const b = this.blocked<cap.ProviderProject>(); if (b !== undefined) return b
    const found = this.state.projects.find((p) => itemKey(p.ref) === itemKey(ref))
    return found === undefined ? this.notFound('项目') : cap.providerOk(found)
  }
  async listPlanningItems(input: cap.ProviderListPlanningItemsInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderPlanningItem>>> {
    const b = this.blocked<cap.ProviderPage<cap.ProviderPlanningItem>>(); if (b !== undefined) return b
    const all = this.state.items.filter((item) => itemKey(item.project) === itemKey(input.project))
      .sort((a, c) => (a.ref.externalId < c.ref.externalId ? -1 : 1))
    const offset = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10)
    const next = offset + input.limit
    return cap.providerOk({ items: all.slice(offset, next).map(toPlanningItem), nextCursor: next < all.length ? String(next) : undefined })
  }
  async getPlanningItem(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderPlanningItem>> {
    const b = this.blocked<cap.ProviderPlanningItem>(); if (b !== undefined) return b
    const record = findItem(this.state, ref)
    return record === undefined ? this.notFound('规划项') : cap.providerOk(toPlanningItem(record))
  }
  async listFieldDefinitions(_project: cap.ExternalObjectRef): Promise<cap.ProviderResult<readonly cap.ProviderPlanningFieldDefinition[]>> {
    return this.blocked<readonly cap.ProviderPlanningFieldDefinition[]>() ?? cap.providerOk(this.state.fields)
  }
  async listIterations(_project: cap.ExternalObjectRef): Promise<cap.ProviderResult<readonly cap.ProviderIteration[]>> {
    return this.blocked<readonly cap.ProviderIteration[]>() ?? cap.providerOk(this.state.iterations)
  }
  /** 新建外部对象；内容一律是 work_item，draft 与 issue 只差 objectKind。 */
  addItem(project: cap.ExternalObjectRef, objectKind: string, title: string, body: string): FakePlanningItemRecord {
    this.state.versionSeq += 1
    const content: cap.ProviderWorkItemContent = { externalId: `item-new-${this.state.versionSeq}`, title, body }
    const record: FakePlanningItemRecord = {
      ref: { bindingId: this.bindingId, objectKind, externalId: content.externalId, url: undefined },
      project, content: { kind: domain.ContentKind.WorkItem, workItem: content }, fields: emptyFields(), ...this.stamp(),
    }
    replaceItem(this.state, record)
    return record
  }
  async createIssueWorkItem(input: cap.ProviderCreateIssueInput): Promise<cap.ProviderResult<cap.ProviderCreatedWorkItem>> {
    const b = this.blocked<cap.ProviderCreatedWorkItem>(); if (b !== undefined) return b
    if (!this.flags.createIssue) return this.fail(domain.ProviderErrorCode.NotSupported, '未启用的能力：create.issue')
    if (this.faultsSwitch.isOn(FaultKind.AmbiguousCreate)) return this.fail(domain.ProviderErrorCode.AmbiguousResult, '创建结果不确定')
    const record = this.addItem(input.project, domain.ExternalIdentityKind.Issue, input.title, input.body)
    if (record.content.kind !== domain.ContentKind.WorkItem) return this.fail(domain.ProviderErrorCode.InvalidInput, '内部不一致')
    return cap.providerOk({ item: toPlanningItem(record), workItem: record.content.workItem })
  }
  async createDraftItem(input: cap.ProviderCreateDraftInput): Promise<cap.ProviderResult<cap.ProviderCreatedPlanningItem>> {
    const b = this.blocked<cap.ProviderCreatedPlanningItem>(); if (b !== undefined) return b
    if (!this.flags.createDraft) return this.fail(domain.ProviderErrorCode.NotSupported, '未启用的能力：create.draft')
    if (this.faultsSwitch.isOn(FaultKind.AmbiguousCreate)) return this.fail(domain.ProviderErrorCode.AmbiguousResult, '创建结果不确定')
    return cap.providerOk({ item: toPlanningItem(this.addItem(input.project, domain.ExternalIdentityKind.Draft, input.title, input.body)) })
  }
  async updatePlanningFields(input: cap.ProviderUpdatePlanningFieldsInput): Promise<cap.ProviderResult<cap.ProviderPlanningItem>> {
    const b = this.blocked<cap.ProviderPlanningItem>(); if (b !== undefined) return b
    if (!this.flags.fields) return this.fail(domain.ProviderErrorCode.NotSupported, '未启用的能力：field.write')
    const record = findItem(this.state, input.ref)
    if (record === undefined) return this.notFound('规划项')
    if (record.sourceVersion !== input.expectedSourceVersion) return this.conflict(record)
    const next = { ...record, fields: applyFieldPatch(record.fields, input.patch), ...this.stamp() }
    replaceItem(this.state, next)
    return cap.providerOk(toPlanningItem(next))
  }
  /** 观察流：离线时不投递观察（没有新事实，不是错误）；重复与乱序由故障开关构造。 */
  async *reconcile(_scope: cap.ProviderReconcileScope): AsyncIterable<cap.ProviderObservation> {
    if (this.faultsSwitch.isOn(FaultKind.Offline)) return
    const ordered = [...this.state.observations]
    if (this.faultsSwitch.isOn(FaultKind.OutOfOrder)) ordered.reverse()
    for (const observation of ordered) {
      yield observation
      if (this.faultsSwitch.isOn(FaultKind.DuplicateEvent)) yield observation
    }
  }
  faults(): FaultPlan { return this.faultsSwitch.plan() }
  setFault(kind: FaultKind, enabled: boolean): void { this.faultsSwitch.set(kind, enabled) }
  emitObservation(draft: ObservationDraft): cap.ProviderObservation { return enqueueObservation(this.state, draft) }
  /** draft→issue 提升只改外部 id；内部实体 id 由调用方按 domain.promoteDraftToIssue 保持（不变量 1）。 */
  promoteDraft(ref: cap.ExternalObjectRef, issueExternalId: string): cap.ProviderResult<cap.ProviderPlanningItem> {
    const b = this.blocked<cap.ProviderPlanningItem>(); if (b !== undefined) return b
    const record = findItem(this.state, ref)
    if (record === undefined) return this.notFound('草稿')
    const content: cap.ProviderPlanningContent = record.content.kind === domain.ContentKind.WorkItem
      ? { kind: domain.ContentKind.WorkItem, workItem: { externalId: issueExternalId, title: record.content.workItem.title, body: record.content.workItem.body } }
      : record.content
    const promoted: FakePlanningItemRecord = {
      ...record, ref: { ...record.ref, objectKind: domain.ExternalIdentityKind.Issue, externalId: issueExternalId }, content, ...this.stamp(),
    }
    removeItem(this.state, ref)
    replaceItem(this.state, promoted)
    return cap.providerOk(toPlanningItem(promoted))
  }
}
export function createFakePlanningProvider(options: FakePlanningProviderOptions = {}): FakePlanningProvider {
  return new FakePlanningProvider(options)
}
