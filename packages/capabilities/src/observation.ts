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
 * 定序约定（R4）：`sourceVersion` 的**唯一合法载体**是规范载体——定宽 30 字节的 UTC 纳秒时间戳
 * `YYYY-MM-DDTHH:MM:SS.fffffffffZ`（如 `2026-09-21T07:11:54.500000000Z`）。在这个定义域上，码点序、UTF-16
 * 码元序、UTF-8 字节序（SQLite BINARY）与时间序四者相同，`compareSourceVersion` 与 `committed_observation`
 * 视图因此同判据（RFC 3339 §5.1：同一时区写法、同样小数位数时可以按字符串排序）。
 * 未归一的时间戳（小数位数不同的 `54Z` 与 `54.500Z`、带偏移的 `+08:00`）、不定长编号（`v9` / `v10`）、sha 都**不是**
 * 载体：它们会把更新的观察判成乱序而静默丢弃，所以入口直接拒绝（#203），不再返回 `false`。
 *
 * **归一是 provider 的义务，规则只在本文件有一份**：只有 provider 知道平台字段是时间戳、计数器还是不透明串。
 * 平台给的是 RFC 3339 时间戳时，观察的 `sourceVersion` 取 `sourceVersionFromTimestamp(平台更新时间)`；归一失败
 * （抛 `RangeError`）时 provider 报结构化 `ProviderError`，**不得**改填 `undefined`——`undefined` 是最小值，
 * 在已提交的有版本观察面前会被静默拒绝。平台只有不透明版本（ETag 一类）或没有版本时，填 `undefined`。
 * 同一主体不混用有版本与无版本的观察。归一是无损的：超过 9 位小数抛错而不截断，截断会把两个不同版本变成
 * 「相等」，按 R4 ② 相等即整快照替换，晚到的旧快照会顶掉新快照。
 *
 * `assertComparableSourceVersion` 是入口断言的唯一实现：`makeObservation`（生产端）与两个 Storage 的
 * `recordObservation`（存储端，防御不经 `makeObservation` 构造的观察）共同调用。**空串不是合法载体**——
 * `undefined` 是「没有版本」的**唯一**表达。`compareSourceVersion` 仍是任意串上的全函数（码点序），不会在存储
 * 事务中途抛错；JS 的 `<` 比较 UTF-16 **码元**，在 U+E000–U+FFFF 与增补平面字符之间与码点序结论相反，
 * **不得**用作判据。
 *
 * `ProviderPlanningItem.sourceVersion`（乐观并发）与 `ProviderChangeRequest.sourceVersion`（头部提交 sha，谱系
 * 按相等比较）是另外的字段，只做相等比较，不经过观察入口，不受本约定约束。
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

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/**
 * RFC 3339 date-time → 规范载体；解析失败返回 `undefined`（谓词不经过 try/catch）。全程只用 UTC 方法，
 * 与进程时区无关。不用 `Date.UTC`（把 0–99 年映射到 1900 年代），不用 `Date.parse`（无时区输入按本地时区解析）。
 */
function parseTimestamp(value: string): string | undefined {
  const match = RFC3339.exec(value)
  if (match === null) return undefined
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number]
  const fraction = match[7] ?? ''
  const sign = match[8] === '-' ? -1 : 1
  const offsetHour = Number(match[9] ?? 0)
  const offsetMinute = Number(match[10] ?? 0)
  // 闰秒 `:60` 被拒绝：Date 会把它进位成下一秒，与真实的下一秒碰撞。
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return undefined
  const t = new Date(0)
  t.setUTCFullYear(year, month - 1, day)
  // 日历往返：拒绝 02-30、非闰年 02-29、月 00 / 13、日 00（Date 会滚动到相邻日期）。
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return undefined
  t.setUTCHours(hour, minute - sign * (offsetHour * 60 + offsetMinute), second, 0)
  const utcYear = t.getUTCFullYear()
  if (utcYear < 0 || utcYear > 9999) return undefined
  return `${pad(utcYear, 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}T${pad(t.getUTCHours(), 2)}:${pad(t.getUTCMinutes(), 2)}:${pad(t.getUTCSeconds(), 2)}.${fraction.padEnd(9, '0')}Z`
}

/**
 * RFC 3339 date-time → 规范载体 `YYYY-MM-DDTHH:MM:SS.fffffffffZ`（UTC、9 位小数、年份 0000–9999），无损。
 * 缺偏移、非法日历、闰秒、偏移越界、超过 9 位小数、结果年份越界、非时间戳：抛 `RangeError`，不截断、不猜测。
 */
export function sourceVersionFromTimestamp(timestamp: string): string {
  const canonical = parseTimestamp(timestamp)
  if (canonical === undefined) throw new RangeError(`不是可归一的 RFC 3339 时间戳：${timestamp}`)
  return canonical
}

/** `sourceVersion` 是否是端口接受的载体：规范载体，即 `sourceVersionFromTimestamp` 的不动点（`undefined` 另由调用方处理）。不抛错。 */
export function isComparableSourceVersion(value: string): boolean {
  return parseTimestamp(value) === value
}

/** 入口断言的唯一实现：`undefined` 放行（没有版本）；其余非规范载体抛 `RangeError`。 */
export function assertComparableSourceVersion(value: string | undefined): void {
  if (value !== undefined && !isComparableSourceVersion(value)) {
    throw new RangeError(`sourceVersion 必须是规范载体（定宽 ASCII 的 UTC 纳秒时间戳 YYYY-MM-DDTHH:MM:SS.fffffffffZ，由 sourceVersionFromTimestamp 归一）：${value}`)
  }
}

/**
 * 版本定序的**唯一判据**（R4）：按码点序比较，`undefined` 视为最小。
 * 定义域是规范载体加 `undefined`：在这个域上码点序 = UTF-8 字节序（SQLite BINARY）= 时间序，storage 实现接入后
 * 必须与 `committed_observation` 视图同判据。在任意串上它仍是全函数（码点序），不会抛错。
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

/**
 * 组装观察：dedupeKey 与 payloadHash 由契约函数计算，provider 不得自行发明另一套规则；`sourceVersion` 只校验、
 * 不改写（非规范载体抛 `RangeError`，归一由 provider 用 `sourceVersionFromTimestamp` 完成）。
 */
export function makeObservation(input: ProviderObservationInput): ProviderObservation {
  assertComparableSourceVersion(input.sourceVersion)
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
