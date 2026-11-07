/**
 * 客户端帧接受（issue #79 / #178）：按序接受宿主 baseline / delta / metadata，流与重连由 follower / supervisor 拥有。
 *
 * 缺口先被如实标记：store 整体置 stale，并通过 onGap 暴露这个窗口；消费者重开宿主流，下一代 baseline 恢复当前值。
 *
 * `accept` 是**唯一**接受点：先校验帧头、读并校验时钟，再改 store，全部成功后才一次发布头 / 能力 /
 * 时间 / 连接状态——被拒绝的帧不会留下半个新状态。消费者在载体失败时调用 `disconnect`：保留最后已知的
 * 内容、头与时间，只把连接标成断开、行标成 stale。
 */
import { WireFreshness } from '@harness-projects/controller/values'
import type { SourceMetadata, WireEntity, WireEvent, WireGap, WireSnapshot, WireWorkspaceHeader } from '@harness-projects/controller'
import { assertDeltaFrame, type EntityStore } from './store.ts'
import { assertHeader, readClock, type ClientWorkspaceRead } from './workspace-read.ts'

export interface SyncReport {
  readonly kind: 'baseline' | 'delta' | 'metadata' | 'gap'
  readonly revision: number
  /** gap 的原因，方便调用方解释这次跳变。 */
  readonly reason: string | undefined
}

export interface SyncOptions {
  /** 缺口已检测、store 已整体标 stale、消费者还没重开宿主流时调用；用于观测"旧值不是当前值"的窗口。 */
  readonly onGap?: (gap: WireGap, store: EntityStore) => void
  /** 接受时间的来源（ISO 8601）；默认系统时钟，测试注入固定值。 */
  readonly clock?: () => string
}

export interface WorkspaceSync {
  readonly revision: number
  readonly connected: boolean
  /** 标记断开；保留最后已知的内容、头与时间。 */
  disconnect(): void
  /**
   * 接受宿主流的一帧（#276）。baseline / delta / metadata 走唯一接受点，拒绝时抛错且状态不变；
   * gap（含越过本地修订的 delta）只整体标 stale、调 onGap 并回报 `kind: 'gap'`，由流的消费者重开下一代。
   */
  receive(frame: unknown): SyncReport
  /** 展示层的唯一输入；首个已确认的工作区 descriptor 之前是 undefined。 */
  read(): ClientWorkspaceRead | undefined
}

/** 安全散文：不含原异常、堆栈或平台细节。 */
const DISCONNECTED_REASON = '与宿主的连接已断开，显示的是最后已知值'
const NEUTRAL_REASON = '规划来源读取不完整，部分值可能不是当前值'

const isFresh = (source: SourceMetadata): boolean => source.freshness === WireFreshness.Fresh
/** baseline / delta 确认了当前值：整表 fresh（含真实空集），或 partial 帧确有 fresh 行。 */
const confirms = (source: SourceMetadata, rows: readonly WireEntity[]): boolean => isFresh(source) || rows.some((row) => isFresh(row.source))
const recovered = (before: SourceMetadata | undefined, after: SourceMetadata): boolean => before?.freshness === WireFreshness.Degraded && isFresh(after)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
function assertEventShape(event: unknown): asserts event is WireEvent {
  if (!isRecord(event) || !['delta', 'metadata', 'gap'].includes(event.kind as string)) {
    throw new TypeError('event 不合契约')
  }
  if (event.kind === 'delta') {
    const delta = event.delta
    if (!isRecord(delta) || !Array.isArray(delta.upserts) || !Array.isArray(delta.removed)
      || delta.upserts.some((row) => !isRecord(row))) throw new TypeError('delta 载体不合契约')
  } else if (event.kind === 'metadata') {
    const metadata = event.metadata
    if (!isRecord(metadata) || !isRecord(metadata.source) || !Array.isArray(metadata.entities)
      || metadata.entities.some((row) => !isRecord(row) || !isRecord(row.source))) {
      throw new TypeError('metadata 载体不合契约')
    }
  } else if (!isRecord(event.gap)) {
    throw new TypeError('gap 载体不合契约')
  }
}

export function createSync(store: EntityStore, options: SyncOptions = {}): WorkspaceSync {
  const clock = options.clock ?? ((): string => new Date().toISOString())
  let connected = false
  /** 最近一次被接受帧的整表头：整体替换，不跨帧拼字段（宿主不再确认 descriptor 时 read 回到 undefined）。 */
  let head: WireWorkspaceHeader | undefined
  let lastUpdatedAt: string | undefined
  let generation: string | undefined
  const validateFrame = (frame: WireWorkspaceHeader, allowGenerationReset = false): string => {
    assertHeader(frame)
    if (generation !== undefined && frame.generation !== generation && !allowGenerationReset) {
      throw new TypeError('frame generation 与当前连接不一致')
    }
    return frame.generation
  }

  const accept = (frame: WireWorkspaceHeader, apply: () => void, confirmed: boolean, allowGenerationReset = false): void => {
    try {
      const frameGeneration = validateFrame(frame, allowGenerationReset)
      const at = confirmed ? readClock(clock) : undefined
      apply()
      const { nativeAccessVersion, workspace, capabilities, repositories, planningSource, source } = frame
      const changedScope = head?.workspace?.id !== workspace?.id || head?.planningSource?.bindingId !== planningSource?.bindingId
      head = { generation: frameGeneration, ...(nativeAccessVersion === undefined ? {} : { nativeAccessVersion }), workspace, capabilities, ...(repositories === undefined ? {} : { repositories }), ...(planningSource === undefined ? {} : { planningSource }), source }
      if (changedScope) lastUpdatedAt = undefined
      if (at !== undefined) lastUpdatedAt = at
      generation = frameGeneration
      connected = true
    } catch (error) {
      throw new TypeError(error instanceof Error ? error.message : '帧拒绝')
    }
  }

  const lose = (): void => {
    connected = false
    store.markAllStale()
  }

  const acceptBaseline = (snapshot: WireSnapshot): SyncReport => {
    let nextGeneration: string
    try {
      nextGeneration = validateFrame(snapshot, true)
    } catch (error) {
      throw new TypeError(error instanceof Error ? error.message : 'generation 不合契约')
    }
    if (store.revision > snapshot.revision && nextGeneration === generation) {
      throw new TypeError(`baseline revision ${snapshot.revision} 低于本地 ${store.revision}，没有新的 generation evidence`)
    }
    accept(snapshot, () => store.applyBaseline(snapshot), confirms(snapshot.source, snapshot.entities), true)
    return { kind: 'baseline', revision: snapshot.revision, reason: undefined }
  }

  /** 缺口只标 stale 并回报，流的消费者负责重开下一代。 */
  const markGap = (gap: WireGap): SyncReport => {
    store.markAllStale()
    options.onGap?.(gap, store)
    return { kind: 'gap', revision: store.revision, reason: gap.reason }
  }

  const applyEvent = (event: unknown): SyncReport => {
    if (isRecord(event) && event.kind === 'baseline') return acceptBaseline(event.baseline as WireSnapshot)
    try {
      assertEventShape(event)
    } catch (error) {
      throw new TypeError(error instanceof Error ? error.message : 'event 不合契约')
    }
    if (event.kind === 'gap') return markGap(event.gap)
    if (event.kind === 'metadata') {
      const { metadata } = event
      const sameScope = head?.workspace?.id === metadata.workspace?.id && head?.planningSource?.bindingId === metadata.planningSource?.bindingId
      const confirmedAt = metadata.source.reconciledAt
      const advanced = sameScope && isFresh(metadata.source) && confirmedAt !== undefined
        && (head?.source.reconciledAt === undefined || Date.parse(confirmedAt) > Date.parse(head.source.reconciledAt))
      const improved = advanced || (sameScope && recovered(head?.source, metadata.source))
        || (sameScope && metadata.entities.some((row) => recovered(store.get(row.entityId)?.entity.source, row.source)))
      accept(metadata, () => store.applyMetadata(metadata), improved)
      return { kind: 'metadata', revision: store.revision, reason: undefined }
    }
    const { delta } = event
    if (!Number.isInteger(delta.previousRevision) || !Number.isInteger(delta.revision)
      || delta.revision <= delta.previousRevision || delta.previousRevision < store.revision) {
      throw new TypeError(`delta 必须从本地修订 ${store.revision} 严格前进`)
    }
    if (delta.previousRevision > store.revision) {
      try {
        validateFrame(delta)
        assertDeltaFrame(delta)
      } catch (error) {
        throw new TypeError(error instanceof Error ? error.message : '帧拒绝')
      }
      return markGap({
        requestedAfter: store.revision,
        currentRevision: delta.revision,
        reason: `增量从修订 ${delta.previousRevision} 起，本地停在 ${store.revision}`,
      })
    }
    accept(delta, () => store.applyDelta(delta), confirms(delta.source, delta.upserts))
    return { kind: 'delta', revision: store.revision, reason: undefined }
  }

  const sync: WorkspaceSync = {
    get revision(): number { return store.revision },
    get connected(): boolean { return connected },
    receive(event: unknown): SyncReport {
      return applyEvent(event)
    },
    disconnect(): void {
      lose()
    },
    read(): ClientWorkspaceRead | undefined {
      if (head?.workspace === undefined) return undefined
      const degraded = head.source.freshness === WireFreshness.Degraded
      return {
        ...(head.nativeAccessVersion === undefined ? {} : { nativeAccessVersion: head.nativeAccessVersion }),
        generation: head.generation, workspace: head.workspace, store, connection: { connected }, lastUpdatedAt,
        ...(head.source.reconciledAt === undefined ? {} : { reconciledAt: head.source.reconciledAt }), capabilities: head.capabilities,
        ...(head.repositories === undefined ? {} : { repositories: head.repositories }),
        ...(head.planningSource === undefined ? {} : { planningSource: head.planningSource }),
        reason: !connected ? DISCONNECTED_REASON : degraded ? head.source.reason ?? NEUTRAL_REASON : undefined,
      }
    },
  }
  return sync
}
