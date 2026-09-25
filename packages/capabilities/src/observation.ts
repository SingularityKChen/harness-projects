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

/**
 * 定序约定（R4）：`sourceVersion` 是平台版本载体，必须是**非空 ASCII 可打印**串，且**码点序即目标序**——这只对
 * 定宽、固定小数位、以 `Z` 结尾的 ISO-8601 UTC 时间戳（如 `2026-09-21T07:11:54Z`）与定宽计数器成立。变精度
 * （`54Z` → `54.500Z`）、带偏移（`+08:00`）、不定长编号（`v9` / `v10`）都会把更新的观察判成乱序而静默丢弃，
 * provider 必须先归一（#203；本合并点没有 provider 给观察填 `sourceVersion`，缺口尚不可达）。
 *
 * **「字典序即目标序」是 provider 的义务**，storage 只保证一条可判定的性质：`compareSourceVersion`（本文件
 * 导出，按**码点序**比较）与 SQLite 默认 BINARY collation（对 UTF-8 做 memcmp）逐字节等价，因此比较器与
 * `committed_observation` 视图的判据一致。JS 的 `<` 比较的是 UTF-16 **码元**，在 U+E000–U+FFFF 与增补平面
 * 字符之间与码点序结论相反，**不得**用作判据。
 *
 * `recordObservation` 在入口拒绝非 ASCII 可打印（含空串）的 `sourceVersion`：把"载体必须是可比的 ASCII
 * 形式"从注释变成契约。**空串不是合法载体**——`undefined` 是"没有版本"的**唯一**表达。
 *
 * **development 域把提交 sha 当 `sourceVersion` 时，sha 不是可定序载体**：sha 是哈希，字典序与提交先后无关，
 * 把"字典序即目标序"当成事实是 provider 侧的缺口，本层不替它兜底——storage 只按同一个比较器执行。
 *
 * **payload 不得含凭据材料**：`payload` 由 provider 完全控制，而 storage 会把它**原样**持久化
 * （`sync_observation.snapshot_json`）。provider 必须在组装观察前完成脱敏——凭据只保存 secret 服务句柄，
 * 不进入 Project 数据库（AGENTS.md §1.1 实现级硬约束）；`snapshot_json` 里出现 token / 请求头这类材料
 * 是 provider 的缺陷，storage 不裁剪、不改写、不丢弃（在 storage 层裁剪会变成第二个权威源）。
 */
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

/** 版本载体允许的字符集：**非空** ASCII 可打印。非 ASCII 或空串会让"字典序"在不同实现下含义不同，入口直接拒绝。 */
const ASCII_SOURCE_VERSION = /^[\x20-\x7e]+$/

/** `sourceVersion` 是否是端口接受的载体：非空 ASCII 可打印（`undefined` 表示"没有版本"，另由调用方处理）。 */
export function isComparableSourceVersion(value: string): boolean {
  return ASCII_SOURCE_VERSION.test(value)
}

/**
 * 版本定序的**唯一判据**（R4）：按码点序比较，`undefined` 视为最小。
 * 码点序与 UTF-8 字节序（SQLite BINARY）等价；storage 实现接入后必须与 `committed_observation` 视图同判据。
 */
export function compareSourceVersion(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0
  if (left === undefined) return -1
  if (right === undefined) return 1
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    const a = left.codePointAt(i) as number
    const b = right.codePointAt(j) as number
    if (a !== b) return a < b ? -1 : 1
    i += a > 0xffff ? 2 : 1
    j += b > 0xffff ? 2 : 1
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1
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
