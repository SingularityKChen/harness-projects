/**
 * 工作项列表页面投影（issue #129）：Host 明确给出的读取过程 + 既有列表派生 → 只读列表的安全展示结构。
 * 这是页面状态的**唯一**归约点：renderer 只消费 `WorkItemListView`，不推导读取过程、能力或 redaction，也不
 * 持有 loading 布尔或 last-good 缓存。纯函数：不读时钟、不改入参、不返回原 `WorkItemRow`（它带着 redacted 字段）。
 */
import { AccessLevel, ContentKind, DerivedFlag, NormalizedStatus } from '@harness-projects/domain/values'
import { accessIndex } from './capability-access.ts'
import { deriveWorkItemList } from './derive.ts'
import type { WorkItemRow, WorkspaceRead } from './types.ts'

/** 列表读取经过的唯一读门（core 读规划条目的门）；契约测试与 `CapabilityKey` 逐字比对。 */
const READ_KEY = 'planning.item.read'

export type ListReadFailure = {
  readonly kind: 'permission_denied' | 'not_supported' | 'unknown' | 'offline' | 'error'
  /** Host 独立给出的安全说明：不含原异常、堆栈或对象权限细节。 */
  readonly safeMessage?: string
}
export type ListDisplayMetadata = {
  readonly planningSourceName?: string
  /** 来源显示名，以 bindingId 为关联键：键只用来查名，不显示、不参与权限或排序。 */
  readonly sourceNames: Readonly<Record<string, string>>
  readonly safeNotice?: string
}
/** 由 Host / 壳明确观察后给出：首个 baseline 是否到达不能由 revision、空数组或连接状态推断。 */
export type WorkItemListReadInput = {
  readonly read: WorkspaceRead
  readonly metadata: ListDisplayMetadata
} & (
  | { readonly phase: 'pending' }
  | { readonly phase: 'received'; readonly refreshing: boolean }
  | {
      readonly phase: 'failed'; readonly hasReceivedSnapshot: boolean
      readonly failure: ListReadFailure; readonly cacheVisibility: 'authorized' | 'unknown'
    }
)

/** 安全行：redacted 只剩占位；`key` 是内部条目键，只供框架做列表 key，不得进入任何属性或文字。`stale` = 行自身新鲜度 或 页面级保守降级（刷新 / Host 降级 / degraded / 失败保行），没有行能冒充当前值。 */
export type VisibleListRow =
  | { readonly kind: 'redacted'; readonly key: string }
  | {
      readonly kind: 'item'; readonly key: string; readonly title: string; readonly identity: string
      readonly planningStatus: string; readonly engineering: string; readonly source: string
      readonly authority: string; readonly stale: boolean
    }
export type WorkItemListView = {
  readonly workspaceName: string
  readonly planningSourceName: string
  readonly statusText: string
  readonly readOnly: boolean
  readonly degraded: boolean
  readonly body:
    | { readonly kind: 'loading' }
    | {
        readonly kind: 'unavailable'; readonly reason: ListReadFailure['kind']
        readonly message: string; readonly remaining: string
      }
    | {
        readonly kind: 'content'; readonly rows: readonly VisibleListRow[]
        readonly stale: boolean; readonly refreshing: boolean
        readonly lastUpdatedAt?: string; readonly notice?: string
      }
}

const UNAVAILABLE: Readonly<Record<ListReadFailure['kind'], readonly [message: string, remaining: string]>> = {
  permission_denied: [`没有读取工作项的权限（${READ_KEY}）。`, '请在规划来源恢复授权后重试；此前的缓存不会显示。'],
  not_supported: [`该规划来源不支持读取工作项（${READ_KEY}）。`, '补充授权无法解决，请改用支持读取的来源。'],
  unknown: [`尚未确认读取工作项的能力（${READ_KEY}）。`, '工作区与规划来源仍可查看；确认之前不显示条目，也不判断是否有工作项。'],
  offline: ['当前无法连接规划来源，且没有可显示的快照。', '连接恢复后会重新读取。'],
  error: ['读取工作项失败，且没有可显示的快照。', '请稍后重试；失败原因不在此展示。'],
}
/** 读门已观测但不可读、又没有结构化失败：能力已确认不可用，未知的只是原因；reason 仍报 unknown，不解析 reason 文字猜权限。 */
const GATE_BLOCKED = [`读取工作项的能力（${READ_KEY}）当前不可用，原因未提供。`, '工作区与规划来源仍可查看；读取能力恢复之前不显示条目，也不显示此前的缓存。'] as const
/** 明确的读取阻断：不借缓存、不等待；其余失败（offline / error）才看缓存是否被明确授权可见。 */
const EXPLICIT_BLOCK: readonly string[] = ['permission_denied', 'not_supported', 'unknown']
const READABLE: readonly string[] = [AccessLevel.Available, AccessLevel.ReadOnly, AccessLevel.Degraded]
const IDENTITY: Readonly<Record<string, string>> = { issue: 'Issue', draft: 'Draft', change_request: 'PR' }
const AUTHORITY: Readonly<Record<string, string>> = { provider: '提供方权威', host: 'Host 权威', manual: '手动维护' }
const HINTS: Readonly<Record<string, string>> = {
  [DerivedFlag.Attention]: '需要关注', [DerivedFlag.CiFailing]: 'CI 失败',
  [DerivedFlag.ExecutionFailed]: '执行失败', [DerivedFlag.Merged]: '已合并',
}
const STATUS: Readonly<Record<string, string>> = {
  [NormalizedStatus.Todo]: '待办', [NormalizedStatus.InProgress]: '进行中', [NormalizedStatus.Blocked]: '已阻塞',
  [NormalizedStatus.Done]: '已完成', [NormalizedStatus.Canceled]: '已取消', [NormalizedStatus.Unknown]: '未知',
}

/** 表里只认自有字符串键：原型链键（`constructor`）与非字符串值一律当作缺失。 */
function pick(table: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = Object.hasOwn(table, key) ? table[key] : undefined
  return typeof value === 'string' ? value : undefined
}

function rowView(row: WorkItemRow, names: ListDisplayMetadata['sourceNames'], stale: boolean): VisibleListRow {
  if (row.contentKind === ContentKind.Redacted) return { kind: 'redacted', key: row.entityId }
  const primary = row.source.primary
  return {
    kind: 'item', key: row.entityId, title: row.title || '标题未提供',
    identity: (primary && pick(IDENTITY, primary.externalKind)) ?? '身份未知',
    planningStatus: pick(STATUS, row.planningStatus) ?? '未知',
    engineering: row.derived.map((flag) => pick(HINTS, flag) ?? '未知提示').join('、') || '无',
    source: (primary && pick(names, primary.bindingId)) ?? '来源名称未提供',
    authority: pick(AUTHORITY, row.source.authority) ?? '来源权威未知',
    stale,
  }
}

/**
 * 优先级：明确阻断（permission_denied / not_supported / unknown）→ 读门阻断 → 读取过程。读门缺失只说明"未观测"：
 * pending 时继续 loading，收到快照后转不可用（尚未确认）；读门已观测不可读但没有结构化原因时 reason 只能是 unknown，
 * 文案说能力已确认不可用、原因未提供，不解析 reason 猜权限。坏 phase、failed 缺 failure 或坏 failure.kind、非布尔的
 * refreshing / hasReceivedSnapshot、非两值的 cacheVisibility 与坏时间一样是接线缺陷，响亮失败：它们都落在缓存门上。
 */
export function deriveWorkItemListView(input: WorkItemListReadInput): WorkItemListView {
  const { read, metadata } = input
  const phase: string = input.phase
  if (phase !== 'pending' && phase !== 'received' && phase !== 'failed') {
    throw new TypeError(`phase 必须是 pending / received / failed，收到 ${JSON.stringify(phase)}`)
  }
  const failure = input.phase === 'failed' ? input.failure : undefined
  if (input.phase === 'failed' && !Object.hasOwn(UNAVAILABLE, failure?.kind ?? '')) {
    throw new TypeError(`failure.kind 不合契约，收到 ${JSON.stringify(failure?.kind)}`)
  }
  const marksOk = input.phase === 'pending' || (input.phase === 'received' ? typeof input.refreshing === 'boolean'
    : typeof input.hasReceivedSnapshot === 'boolean' && ['authorized', 'unknown'].includes(input.cacheVisibility))
  if (!marksOk) throw new TypeError(`${input.phase} 的读取标记不合契约：refreshing / hasReceivedSnapshot 须为布尔，cacheVisibility 须为 authorized / unknown`)
  const list = deriveWorkItemList(read)
  const access = accessIndex(read.capabilities ?? []).get(READ_KEY)
  const shell = { workspaceName: read.workspace.name, planningSourceName: metadata.planningSourceName || '规划来源名称未提供' }
  const flags = { readOnly: access === AccessLevel.ReadOnly, degraded: access === AccessLevel.Degraded }
  const unavailable = (reason: ListReadFailure['kind'], [message, remaining] = UNAVAILABLE[reason]): WorkItemListView => {
    const safe = failure?.safeMessage
    return { ...shell, readOnly: false, degraded: false, statusText: '无法读取工作项', body: { kind: 'unavailable', reason, message: safe ? `${message} ${safe}` : message, remaining } }
  }
  if (failure !== undefined && EXPLICIT_BLOCK.includes(failure.kind)) return unavailable(failure.kind)
  // 读门未观测：pending 继续等候，之后一律当作尚未确认；读门已观测：只认三个可读级别，其余（含非枚举值）都阻断。
  if (access === undefined && input.phase !== 'pending') return unavailable(failure?.kind ?? 'unknown')
  if (access !== undefined && !READABLE.includes(access)) return failure ? unavailable(failure.kind) : unavailable('unknown', GATE_BLOCKED)
  if (input.phase === 'pending') {
    const note = access === undefined ? '，读取能力尚未确认' : ''
    return { ...shell, readOnly: flags.readOnly, degraded: false, statusText: `正在首次读取工作项${note}`, body: { kind: 'loading' } }
  }
  if (input.phase === 'failed' && !(input.hasReceivedSnapshot && input.cacheVisibility === 'authorized')) {
    return unavailable(input.failure.kind)
  }
  const degradedPage = read.reason !== undefined || input.phase === 'failed' || flags.degraded
  const stale = list.stale || degradedPage
  const refreshing = input.phase === 'received' && input.refreshing
  const rows = list.rows.map((row) => rowView(row, metadata.sourceNames, row.freshness.stale || degradedPage || refreshing))
  const statusText = refreshing ? '正在刷新，当前显示的是最后已知值'
    : stale ? '当前结果尚未确认，最后已知值不是当前值' : `已读取当前快照，共 ${rows.length} 项`
  return {
    ...shell, ...flags, statusText,
    body: {
      kind: 'content', rows, stale, refreshing,
      ...(list.lastUpdatedAt === undefined ? {} : { lastUpdatedAt: list.lastUpdatedAt }),
      ...(metadata.safeNotice ? { notice: metadata.safeNotice } : {}),
    },
  }
}
