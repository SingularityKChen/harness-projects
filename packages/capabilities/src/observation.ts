/**
 * 统一观察形状与去重键计算契约。
 *
 * 外部世界的变化（webhook / poll / reconcile）全部先转成 `ProviderObservation`（ExecPlan D2）。
 * 平台没有事件 id 时，去重键由 provider 按以下规则计算：
 *
 *   dedupeKey = hash(type + scoped subject + event time + 稳定 payload 字段的哈希)
 *
 * 该规则由 provider 实现，并由 `tests/contract/capabilities-observation.test.js` 固定：相同输入必须
 * 得到同一键，主体的 scope、事件时间或任一稳定字段变化必须改变键。
 */
import { createHash } from 'node:crypto'
import type { ProviderBindingId } from '@harness-projects/domain'

/** 外部对象定位子：binding 内 `(objectKind, externalId)` 唯一；观察与读取共用同一形状。 */
export interface ExternalObjectRef {
  readonly bindingId: ProviderBindingId; readonly objectKind: string; readonly externalId: string; readonly url: string | undefined
}

/** 带 scope 的主体键：binding 参与其中，同一外部 id 在两个绑定下不得互相去重。 */
export function scopedSubjectKey(ref: ExternalObjectRef): string {
  return JSON.stringify([ref.bindingId, ref.objectKind, ref.externalId])
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    const body = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')
    return `{${body}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 稳定 payload 字段的规范化哈希：键序无关；同一个字段集合必须得到同一个哈希。 */
export function stablePayloadHash(fields: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(canonical(fields)).digest('hex')
}

export interface ObservationDedupeInput {
  readonly type: string; readonly subject: ExternalObjectRef; readonly eventTime: string | undefined
  readonly stablePayloadFields: Readonly<Record<string, unknown>>
}

/** 无平台事件 id 时的去重键；有事件 id 时 provider 可直接用它，两条路径都以 (binding, key) 唯一。 */
export function observationDedupeKey(input: ObservationDedupeInput): string {
  const material = JSON.stringify([
    input.type,
    scopedSubjectKey(input.subject),
    input.eventTime ?? null,
    stablePayloadHash(input.stablePayloadFields),
  ])
  return createHash('sha256').update(material).digest('hex')
}

/** reconcile 的增量范围：scopeKey 由调用方定义，cursor 由 provider 上次返回的观察推进。 */
export interface ProviderReconcileScope { readonly scopeKey: string; readonly cursor: string | undefined }

export interface ProviderObservation {
  readonly bindingId: ProviderBindingId; readonly dedupeKey: string; readonly type: string
  readonly eventTime: string | undefined; readonly receivedTime: string
  readonly subject: ExternalObjectRef; readonly sourceVersion: string | undefined
  readonly payloadHash: string; readonly payload: unknown
}

export interface ProviderObservationInput {
  readonly subject: ExternalObjectRef; readonly type: string; readonly eventTime: string | undefined
  readonly receivedTime: string; readonly sourceVersion: string | undefined
  readonly stablePayloadFields: Readonly<Record<string, unknown>>; readonly payload: unknown
}

/** 组装观察：dedupeKey 与 payloadHash 由契约函数计算，provider 不得自行发明另一套规则。 */
export function makeObservation(input: ProviderObservationInput): ProviderObservation {
  return {
    bindingId: input.subject.bindingId,
    dedupeKey: observationDedupeKey(input),
    type: input.type,
    eventTime: input.eventTime,
    receivedTime: input.receivedTime,
    subject: input.subject,
    sourceVersion: input.sourceVersion,
    payloadHash: stablePayloadHash(input.stablePayloadFields),
    payload: input.payload,
  }
}
