/**
 * @harness-projects/provider-execution-human —— 人工执行 Provider
 *
 * Responsibility: 实现 Execution 能力契约：人工执行的启动、读回与取消。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 *
 * **交付边界**：本包提供的是**一个可绑定的人工执行 provider**——把它绑成 execution 绑定时，
 * `startWork` 成功、运行是 `running`。它**不是**"会话启动失败就降级为人工"那条链路的实现：core 的
 * `manualFallback` 只写一条 `failed` 运行、从不咨询执行 provider，且每个域只有一个执行绑定，所以
 * 真实 harness 失败后没有任何组装能转到这里（见 issue #171）。
 *
 * 人工执行 = **一次处于 `running` 的运行**，它由人推进、不由进程推进。三条纪律：
 *
 * 1. 不新增领域枚举取值：`ExecutionRunStatus` 里没有 `manual`，也不加——"这件事由人做"已经由 core 的
 *    `StartWorkFallback.Manual`（`manual_fallback`）表达，再加一个取值会让同一事实有两个权威。
 * 2. 不写 `Storage`：`packages/core/src/start-work.ts` 的 `recordRun` 是运行记录的唯一写入入口；
 *    provider 写库会造出同一事实的第二个写者。
 * 3. 无进程内状态、纯函数式：运行身份与起始时刻编进 ref（`manual-run:<context>@<时刻>`），
 *    `getRun(ref)` 从 ref 确定性派生标记，因此"**拿着同一个引用**在另一个**实例**里读回同一个标记"
 *    是构造性成立。测试证明到实例级；"没有模块级可变状态"由契约层的种子运行用例兜住——它读一个
 *    本进程从未启动过的运行（`seededRunExternalId`），任何依赖已记录状态的实现都会在那条上变红。
 *    代价有两条，都如实登记而不是回避：
 *    - 取消的作用域是**引用**而不是运行身份（见 `cancelRun`）：无状态 provider 撤销不了已经发出的
 *      `running` 标记，对同一个原始引用取消两次会得到两个各自成立的 `canceled` 引用；
 *    - 引用本身**不在 `Storage` 契约里**（`ExecutionRunRecord` 没有 `externalId`），所以重启后无法
 *      从 `Storage` 重建这个引用。**"重启后读回不变"对运行记录与执行上下文成立，对人工标记的引用
 *      不成立**，除非调用方自己把它存下来；`getRun`/`cancelRun` 因此在重启后不可达。补上这一步要改
 *      `packages/capabilities` 的 Storage 契约与 `packages/storage/sqlite` 的迁移，属跨层变更，
 *      已登记为 **#172**（降级触发点本身是 **#171**）。
 */
import * as cap from '@harness-projects/capabilities'
import {
  EntityKind, ExecutionRunStatus, ProviderErrorCode, newProviderBindingId, type ProviderBindingId,
} from '@harness-projects/domain'

export const packageId = '@harness-projects/provider-execution-human' as const

/** 人工执行的计划只有一个阶段：人推进。启动失败发生在它开始之前，因此错误信息点名它。 */
export const MANUAL_STAGE = 'manual'

/** 运行引用的形态：`manual-run:<contextExternalId>@<startedAt>[#canceled@<finishedAt>]`。 */
const RUN_PREFIX = 'manual-run:'
const CANCELED_MARK = '#canceled@'

export interface HumanExecutionCapabilities { readonly cancel: boolean }
const ALL_CAPABILITIES: HumanExecutionCapabilities = { cancel: true }

/** 声明式故障面：只读配置，不是可变开关（可变开关是进程状态，见文件头第 3 条）。 */
export interface HumanExecutionFaults {
  /** 离线：请求未发出，可原样重发。 */
  readonly offline?: boolean
  /**
   * **本执行 provider 无法启动运行**：启动失败发生在唯一阶段开始之前。
   *
   * 刻意不叫"人工接管通道不可用"：契约套件的 `harnessFailure` 场景说的是"执行 harness 起不来"，
   * 把它映射成"人工通道自己报告不可用"会让"已转人工"这个结论由**被转往的那一方**产生，是自相矛盾的
   * 降级场景。故障名与语义对齐后，这条用例证明的是"本 provider 起不来 → core 走 `manualFallback`"。
   */
  readonly startUnavailable?: boolean
}

export interface HumanExecutionProviderOptions {
  readonly bindingId?: ProviderBindingId
  readonly capabilities?: Partial<HumanExecutionCapabilities>
  readonly faults?: HumanExecutionFaults
  readonly fallback?: boolean
  /** 起始/结束时刻的来源；注入后行为完全确定，默认取真实时钟（与 core 的 `deps.clock` 同一范式）。 */
  readonly clock?: () => string
}

/** 从运行引用反解出的人工运行事实；反解不出来就说明这个引用不是本 provider 发出的。 */
export interface ManualRunFacts {
  readonly contextExternalId: string; readonly startedAt: string; readonly finishedAt: string | undefined
}

/**
 * 时刻必须是**本 provider 自己会生成的那种形态**：严格 ISO 8601 往返（`toISOString()` 逐字相等）。
 *
 * 用 `Date.parse` 不够：V8 接受 `foo 1`、`-1`、`0`、` 2020-01-01`，还会把 `2026-02-30T00:00:00Z`
 * 静默滚成 3 月 2 日。形状闸门的判据必须与**生成端**同形，否则 `getRun` 会接受并原样回显一堆不是
 * 时刻的字符串，而 `startRun` 永远只发 `toISOString()` 的形态（实测：这些输入在旧实现下全部
 * `ok: true`，`startedAt` 原样回显）。
 */
function isInstant(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

/**
 * 上下文 id 里出现保留标记时，派生出的引用会被切错字段——在写入之前拒绝。
 * 返回拒绝原因；合法 id 返回 undefined。
 */
function contextIdProblem(contextExternalId: string): string | undefined {
  if (contextExternalId.trim() === '') return '执行上下文缺少外部 id：无法派生运行身份'
  if (contextExternalId.includes(CANCELED_MARK)) {
    return `执行上下文的 id 含有运行引用的保留标记 ${CANCELED_MARK}：派生出的引用无法被自己反解`
  }
  return undefined
}

export function manualRunExternalId(contextExternalId: string, startedAt: string): string {
  return `${RUN_PREFIX}${contextExternalId}@${startedAt}`
}

/** 运行身份的反解：`manual-run:<context>@<时刻>`，可带 `#canceled@<时刻>` 后缀。 */
export function parseManualRunExternalId(externalId: string): ManualRunFacts | undefined {
  if (!externalId.startsWith(RUN_PREFIX)) return undefined
  const body = externalId.slice(RUN_PREFIX.length)
  const markAt = body.indexOf(CANCELED_MARK)
  const head = markAt === -1 ? body : body.slice(0, markAt)
  const finishedAt = markAt === -1 ? undefined : body.slice(markAt + CANCELED_MARK.length)
  if (finishedAt !== undefined && !isInstant(finishedAt)) return undefined
  const separator = head.lastIndexOf('@')
  if (separator <= 0) return undefined
  const contextExternalId = head.slice(0, separator)
  const startedAt = head.slice(separator + 1)
  if (contextExternalId.trim() === '' || !isInstant(startedAt)) return undefined
  // 结束时刻早于起始时刻不是一个事实，是形态错误：它只能由坏时钟或手工构造产生。
  if (finishedAt !== undefined && Date.parse(finishedAt) < Date.parse(startedAt)) return undefined
  return { contextExternalId, startedAt, finishedAt }
}

/**
 * 往返校验：派生出的引用必须能被 `parseManualRunExternalId` 反解回**同一组字段**。
 *
 * `manualRunExternalId` 把上下文 id 与时刻用 `@` 拼进同一个字符串，取消标记又是 `#canceled@`；
 * 任一分量里出现保留分隔符、或时刻不是生成端那种形态时，反解会失败或反解出别的字段（实测
 * `ctx-a#canceled@b` → `startRun` 成功、`getRun` 返回 `not_found`；`clock: () => 'garbage'` 时
 * `cancelRun` 返回 ok 而 `getRun` 读不回）。失败模式是"写入时静默、读取时才暴露"，所以在写入之前
 * 挡住。`startRun` 与 `cancelRun` 都过这一关——两个方向都会发出引用。
 */
function roundTrips(externalId: string, facts: ManualRunFacts): boolean {
  const parsed = parseManualRunExternalId(externalId)
  return parsed !== undefined
    && parsed.contextExternalId === facts.contextExternalId
    && parsed.startedAt === facts.startedAt
    && parsed.finishedAt === facts.finishedAt
}

/**
 * 往返失败时的**归因**：先把两个已知成因各问一遍，再落到"这是 provider 缺陷"。
 *
 * 分开归因不是措辞问题：`clock: () => 'garbage'` 的旧实现把时钟的问题报成"执行上下文的 id 含有
 * 保留标记"，调用方会去改一个没问题的输入。
 */
function roundTripProblem(facts: ManualRunFacts, instant: string, label: string): string {
  return contextIdProblem(facts.contextExternalId)
    ?? (isInstant(instant) ? '派生出的运行引用无法被自己反解：这是 provider 的缺陷，不是调用方输入的问题' : `${label}不是 ISO 8601 时刻：${instant}`)
}

/** 标记由 ref 派生：同一个引用永远得到同一组字段，因此读回不依赖任何进程内记忆。 */
function markerOf(ref: cap.ExternalObjectRef, facts: ManualRunFacts): cap.ProviderExecutionRun {
  return {
    ref,
    status: facts.finishedAt === undefined ? ExecutionRunStatus.Running : ExecutionRunStatus.Canceled,
    startedAt: facts.startedAt, finishedAt: facts.finishedAt, exitCode: undefined, logUrl: undefined,
  }
}

export class HumanExecutionProvider implements cap.ExecutionProvider {
  readonly bindingId: ProviderBindingId
  readonly flags: HumanExecutionCapabilities
  readonly faults: HumanExecutionFaults
  readonly clock: () => string
  readonly fallback: boolean

  constructor(options: HumanExecutionProviderOptions = {}) {
    this.bindingId = options.bindingId ?? newProviderBindingId()
    // 冻结：这两份都是"只读配置"，而只读若只写在类型里，运行时 `p.faults.startUnavailable = true`
    // 会生效——声明与事实不符。冻结之后类型层的说法才成立（测试用只读构造配置注入故障）。
    this.flags = Object.freeze({ ...ALL_CAPABILITIES, ...(options.capabilities ?? {}) })
    this.faults = Object.freeze({ ...(options.faults ?? {}) })
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.fallback = options.fallback ?? false
  }

  /** 只声明真正实现的三项能力；人工执行没有凭据，因此 permission 与 capability 是同一份事实（不存在"权限被拒"）。 */
  describeCapabilities(): Promise<cap.ProviderCapabilitySnapshot> {
    const capability: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {
      [cap.CapabilityKey.ExecutionRunStart]: cap.AccessLevel.Available,
      [cap.CapabilityKey.ExecutionRunRead]: cap.AccessLevel.Available,
      ...(this.fallback ? { [cap.CapabilityKey.ExecutionRunFallback]: cap.AccessLevel.Available } : {}),
    }
    if (this.flags.cancel) capability[cap.CapabilityKey.ExecutionRunCancel] = cap.AccessLevel.Available
    return Promise.resolve({
      bindingId: this.bindingId, capability, permission: capability, observedAt: this.clock(),
    })
  }

  /**
   * 启动一次由人推进的运行。
   *
   * **`command` 与 `environment` 有意不复制进引用**：对一次由人推进的运行来说，指令来源就是**执行
   * 上下文本身**——工作项、仓库与分支都在 core 的执行上下文与谱系里，ref 只是"这次运行存在"的外部
   * 标记。复制进来会让同一事实有两个载体，ref 的形状（`manual-run:<context>@<时刻>`）也会随之膨胀；
   * 指令的落点属于 core 的 `StartWorkRequest` 与执行上下文，不属于本 provider。
   */
  startRun(input: cap.ProviderStartRunInput): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return Promise.resolve(blocked)
    if (input.context.bindingId !== this.bindingId || input.context.objectKind !== EntityKind.ExecutionContext) {
      return Promise.resolve(this.fail(ProviderErrorCode.InvalidInput, '人工执行只能为属于本 binding 的执行上下文启动运行'))
    }
    if (this.faults.startUnavailable === true) {
      return Promise.resolve(this.fail(ProviderErrorCode.Unavailable, `阶段 ${MANUAL_STAGE} 启动失败：本执行 provider 无法启动运行`))
    }
    const startedAt = this.clock()
    const facts: ManualRunFacts = { contextExternalId: input.context.externalId, startedAt, finishedAt: undefined }
    const externalId = manualRunExternalId(facts.contextExternalId, facts.startedAt)
    if (!roundTrips(externalId, facts)) {
      return Promise.resolve(this.fail(ProviderErrorCode.InvalidInput, roundTripProblem(facts, startedAt, '时钟给出的起始时刻')))
    }
    return Promise.resolve(cap.providerOk(markerOf(this.runRef(externalId), facts)))
  }

  getRun(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return Promise.resolve(blocked)
    const facts = this.ownRun(ref)
    if (facts === undefined) return Promise.resolve(this.notFound())
    // 返回值里的引用由 provider **重新构造**，不原样回显调用方那个对象：形状闸门只校验 binding /
    // objectKind / externalId 三项，其余字段（`url`、任何额外字段）都不参与判定，回显它们等于把调用方
    // 的输入当 provider 的输出；回显同一个对象还会让调用方事后改写它，把已经返回的快照变成
    // `ref` 与 `startedAt` 自相矛盾的对象（第四轮 P3）。这与 `runRef` 自己构造引用时 `url` 恒为
    // undefined 的口径一致。
    return Promise.resolve(cap.providerOk(markerOf(this.runRef(ref.externalId), facts)))
  }

  /**
   * 取消：把权威新状态编进**返回的新引用**（`#canceled@<时刻>`），`getRun` 读回它是 `canceled`。
   *
   * **取消的作用域是引用，不是运行身份**——无状态 provider 只有调用方给的那一个引用，撤销不了已经
   * 发出的 `running` 标记。因此：
   * - 对**已取消的引用**再取消 → `conflict`（它自己已经带结束时刻）；
   * - 对**同一个原始引用**取消两次 → 两个各自成立的 `canceled` 引用（`finishedAt` 不同），而原始引用
   *   仍然读回 `running`。这不是本 provider 能消除的分叉：要让它成为"一个运行身份只有一个权威状态"，
   *   必须由**调用方**在取消后用返回的引用替换已存的 `externalId`，而 `ExecutionRunRecord` 今天没有
   *   这个字段（见 issue #172）。这个边界如实钉在用例里，不靠新增进程内状态去"修"——那会推翻第 3 条纪律。
   *
   * 与 `startRun` 一样过往返校验：取消也发出引用，也要保证发出去的一定读得回（坏时钟曾让这里返回 ok
   * 而 `getRun` 返回 `not_found`）。
   */
  cancelRun(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return Promise.resolve(blocked)
    if (!this.flags.cancel) return Promise.resolve(this.unsupported())
    const facts = this.ownRun(ref)
    if (facts === undefined) return Promise.resolve(this.notFound())
    if (facts.finishedAt !== undefined) {
      return Promise.resolve(this.fail(ProviderErrorCode.Conflict, `运行已结束：${ExecutionRunStatus.Canceled}`))
    }
    const finishedAt = this.clock()
    const canceled: ManualRunFacts = { ...facts, finishedAt }
    const canceledRef = this.runRef(`${ref.externalId}${CANCELED_MARK}${finishedAt}`)
    if (!roundTrips(canceledRef.externalId, canceled)) {
      return Promise.resolve(this.fail(ProviderErrorCode.InvalidInput, roundTripProblem(canceled, finishedAt, '时钟给出的结束时刻')))
    }
    return Promise.resolve(cap.providerOk(markerOf(canceledRef, canceled)))
  }

  /**
   * **形状闸门**（不是来源闸门）：只有本 binding 的 `execution_run`、且 externalId 能被
   * `parseManualRunExternalId` 反解的引用才认。
   *
   * 无状态 provider 区分不了"自己发出的引用"与"调用方凭空构造的同形引用"——引用本身就是唯一的产物，
   * 没有第二份记录可以对照。这个边界是设计后果而不是疏漏，因此如实钉在用例里
   * （`manual-run:never-started-by-me@…` 会被当作一条 `running` 运行），不假装它是来源闸门。
   * `startRun` 一侧的往返校验保证**发出去的**引用一定可读回；这一侧保证**读进来**的引用形态正确。
   */
  private ownRun(ref: cap.ExternalObjectRef): ManualRunFacts | undefined {
    if (ref.bindingId !== this.bindingId || ref.objectKind !== EntityKind.ExecutionRun) return undefined
    return parseManualRunExternalId(ref.externalId)
  }

  private runRef(externalId: string): cap.ExternalObjectRef {
    return { bindingId: this.bindingId, objectKind: EntityKind.ExecutionRun, externalId, url: undefined }
  }

  private blocked<T>(): cap.ProviderResult<T> | undefined {
    if (this.faults.offline === true) return this.fail(ProviderErrorCode.Unavailable, '人工执行 provider 离线：请求未发出')
    return undefined
  }

  private notFound<T>(): cap.ProviderResult<T> {
    return this.fail(ProviderErrorCode.NotFound, '运行不存在，或该引用不是本执行 provider 发出的')
  }

  private unsupported<T>(): cap.ProviderResult<T> {
    return this.fail(ProviderErrorCode.NotSupported, `未启用的能力：${cap.CapabilityKey.ExecutionRunCancel}`)
  }

  private fail<T>(code: ProviderErrorCode, message: string): cap.ProviderResult<T> {
    return cap.providerErr(cap.providerError(code, message))
  }
}

export function createHumanExecutionProvider(options: HumanExecutionProviderOptions = {}): HumanExecutionProvider {
  return new HumanExecutionProvider(options)
}
