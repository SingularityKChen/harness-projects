/**
 * @harness-projects/provider-execution-human —— 人工执行 Provider
 *
 * Responsibility: 实现 Execution 能力契约：人工执行的启动、读回与取消。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 *
 * 人工执行 = **一次处于 `running` 的运行**，由人推进、不由进程推进；以 `fallback: true` 绑定时由 core 在主执行
 * 起不来之后启动。纪律：1. 不新增 `ExecutionRunStatus` 取值（"由人做"由 `manual_fallback` 表达）；2. 不写
 * `Storage`，运行记录的唯一写者是 core；3. 无进程内状态，运行身份编进 ref（`manual-run:<context>@<时刻>~<签名>`），
 * 撤销不了已发出的 `running` 引用，运行身份级的取消收敛归 core 的 `cancelExecutionRun`；4. 签发者身份
 * （`bindingId` + `issuerKey`）由宿主注入、缺一即拒绝构造，ref 带 `HMAC(issuerKey, [bindingId, 规范体])`，
 * 闸门判**来源**；两项重启前后不变，否则落库的 `providerRef` 路由不回来（ADR-0008）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import * as cap from '@harness-projects/capabilities'
import { EntityKind, ExecutionRunStatus, ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'

export const packageId = '@harness-projects/provider-execution-human' as const

/** 人工执行的计划只有一个阶段：人推进。启动失败发生在它开始之前，因此错误信息点名它。 */
export const MANUAL_STAGE = 'manual'

/** 运行引用：`manual-run:<contextExternalId>@<startedAt>[#canceled@<finishedAt>]~<签名>`。 */
const RUN_PREFIX = 'manual-run:'
const CANCELED_MARK = '#canceled@'
/** 签名是 base64url，字母表里没有 `~`，所以最后一个 `~` 一定是签名分隔符。 */
const SIGNATURE_MARK = '~'
/** HMAC-SHA256 的密钥至少与摘要等长；更短的密钥是宿主配置错误，不是可接受的弱配置。 */
const MIN_ISSUER_KEY_BYTES = 32

export interface HumanExecutionCapabilities { readonly cancel: boolean }
const ALL_CAPABILITIES: HumanExecutionCapabilities = { cancel: true }

/** 声明式故障面：只读配置，不是可变开关（可变开关是进程状态，见文件头第 3 条）。 */
export interface HumanExecutionFaults {
  /** 离线：请求未发出，可原样重发。 */
  readonly offline?: boolean
  /** 本执行 provider 无法启动运行（不叫"人工接管通道不可用"：那会让"已转人工"由被转往的一方给出）。 */
  readonly startUnavailable?: boolean
}

export interface HumanExecutionProviderOptions {
  /** 签发者身份：宿主取自 binding 注册的权威记录，重启前后同一个值。 */
  readonly bindingId: ProviderBindingId
  /** 签发密钥：宿主从 secret 服务解析后注入，只留在内存里、不进任何记录；至少 32 字节。 */
  readonly issuerKey: string | Uint8Array
  readonly capabilities?: Partial<HumanExecutionCapabilities>
  readonly faults?: HumanExecutionFaults
  /** 声明 `execution.run.fallback`：core 只在主执行起不来时启动声明了它的绑定。 */
  readonly fallback?: boolean
  /** 起始/结束时刻的来源；注入后行为完全确定，默认取真实时钟（与 core 的 `deps.clock` 同一范式）。 */
  readonly clock?: () => string
}

/** 从运行引用反解出的人工运行事实。 */
interface ManualRunFacts {
  readonly contextExternalId: string; readonly startedAt: string; readonly finishedAt: string | undefined
}

/** 时刻必须是生成端的形态：严格 ISO 8601 往返。`Date.parse` 会放过 `foo 1`、`-1`，还把 `2026-02-30` 滚成 3 月 2 日。 */
function isInstant(value: string): boolean {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

/** 上下文 id 里出现保留标记时，派生出的引用会被切错字段——在写入之前拒绝。 */
function contextIdProblem(contextExternalId: string): string | undefined {
  if (contextExternalId.trim() === '') return '执行上下文缺少外部 id：无法派生运行身份'
  // 不只 `#canceled@`：`#canceled` 后面紧跟的正是起始时刻前的 `@`，拼起来一样会被切错字段。
  if (contextExternalId.includes('#canceled')) {
    return '执行上下文的 id 含有运行引用的保留标记 #canceled：派生出的引用无法被自己反解'
  }
  return undefined
}

/** 规范体：签名覆盖的就是它，取消也从事实重建它，而不是拼接调用方给的字符串。 */
function bodyOf(facts: ManualRunFacts): string {
  const running = `${RUN_PREFIX}${facts.contextExternalId}@${facts.startedAt}`
  return facts.finishedAt === undefined ? running : `${running}${CANCELED_MARK}${facts.finishedAt}`
}

/** 规范体的反解：`manual-run:<context>@<时刻>`，可带 `#canceled@<时刻>` 后缀。 */
function parseBody(body: string): ManualRunFacts | undefined {
  if (!body.startsWith(RUN_PREFIX)) return undefined
  const rest = body.slice(RUN_PREFIX.length)
  const markAt = rest.indexOf(CANCELED_MARK)
  const head = markAt === -1 ? rest : rest.slice(0, markAt)
  const finishedAt = markAt === -1 ? undefined : rest.slice(markAt + CANCELED_MARK.length)
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
 * 往返校验：发出去的规范体必须能被反解回**同一组字段**（否则"写入时静默、读取时才 `not_found`"），
 * `startRun` 与 `cancelRun` 都在发出引用之前过这一关，并把失败归因到真正的成因（上下文 id 还是时钟）。
 */
function roundTripProblem(facts: ManualRunFacts, instant: string, label: string): string | undefined {
  const parsed = parseBody(bodyOf(facts))
  if (parsed !== undefined && parsed.contextExternalId === facts.contextExternalId
    && parsed.startedAt === facts.startedAt && parsed.finishedAt === facts.finishedAt) return undefined
  return contextIdProblem(facts.contextExternalId)
    ?? (isInstant(instant) ? '派生出的运行引用无法被自己反解：这是 provider 的缺陷，不是调用方输入的问题' : `${label}不是 ISO 8601 时刻：${instant}`)
}

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
  readonly #issuerKey: Buffer

  constructor(options: HumanExecutionProviderOptions) {
    if (typeof options?.bindingId !== 'string' || options.bindingId.trim() === '') {
      throw new TypeError('人工执行 provider 需要宿主注入稳定的 bindingId：否则重启后的实例路由不回已落库的运行引用')
    }
    const key = options.issuerKey === undefined ? Buffer.alloc(0) : Buffer.from(options.issuerKey)
    if (key.length < MIN_ISSUER_KEY_BYTES) {
      throw new TypeError(`人工执行 provider 需要宿主注入至少 ${MIN_ISSUER_KEY_BYTES} 字节的 issuerKey：没有它引用无法证明来源`)
    }
    this.bindingId = options.bindingId
    this.#issuerKey = key
    // 冻结：只读若只写在类型里，运行时 `p.faults.startUnavailable = true` 会生效——声明与事实不符。
    this.flags = Object.freeze({ ...ALL_CAPABILITIES, ...(options.capabilities ?? {}) })
    this.faults = Object.freeze({ ...(options.faults ?? {}) })
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.fallback = options.fallback ?? false
  }

  /** 只声明真正实现的能力；人工执行没有凭据，因此 permission 与 capability 是同一份事实。 */
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

  /** 启动一次由人推进的运行；`command` / `environment` 按 port 义务 3 不进引用，交接事实在执行上下文里。 */
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
    const problem = roundTripProblem(facts, startedAt, '时钟给出的起始时刻')
    if (problem !== undefined) return Promise.resolve(this.fail(ProviderErrorCode.InvalidInput, problem))
    return Promise.resolve(cap.providerOk(markerOf(this.issue(facts), facts)))
  }

  /** 返回值里的引用由 provider 重新构造，不回显调用方对象（port 义务 2）。 */
  getRun(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return Promise.resolve(blocked)
    const facts = this.ownRun(ref)
    if (facts === undefined) return Promise.resolve(this.notFound())
    return Promise.resolve(cap.providerOk(markerOf(this.issue(facts), facts)))
  }

  /**
   * 取消：签发带结束时刻的新引用；已带结束时刻的引用再取消是 `conflict`。作用域是**引用**：同一原始引用可签出
   * 多个 canceled 引用、原始引用仍读回 `running`，运行身份级的收敛见文件头第 3 条。
   */
  cancelRun(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return Promise.resolve(blocked)
    // 能力先于身份（port 义务 1）：能力关闭时任何输入都答 not_supported。
    if (!this.flags.cancel) return Promise.resolve(this.unsupported())
    const facts = this.ownRun(ref)
    if (facts === undefined) return Promise.resolve(this.notFound())
    if (facts.finishedAt !== undefined) {
      return Promise.resolve(this.fail(ProviderErrorCode.Conflict, `运行已结束：${ExecutionRunStatus.Canceled}`))
    }
    const finishedAt = this.clock()
    const canceled: ManualRunFacts = { ...facts, finishedAt }
    const problem = roundTripProblem(canceled, finishedAt, '时钟给出的结束时刻')
    if (problem !== undefined) return Promise.resolve(this.fail(ProviderErrorCode.InvalidInput, problem))
    return Promise.resolve(cap.providerOk(markerOf(this.issue(canceled), canceled)))
  }

  /** **来源闸门**：binding、objectKind、签名三者都对，且规范体形态正确，才是本签发者发出的运行。 */
  private ownRun(ref: cap.ExternalObjectRef): ManualRunFacts | undefined {
    if (ref?.bindingId !== this.bindingId || ref.objectKind !== EntityKind.ExecutionRun || typeof ref.externalId !== 'string') return undefined
    const cut = ref.externalId.lastIndexOf(SIGNATURE_MARK)
    if (cut === -1) return undefined
    const body = ref.externalId.slice(0, cut)
    const given = Buffer.from(ref.externalId.slice(cut + 1))
    const expected = Buffer.from(this.sign(body))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
    return parseBody(body)
  }

  private sign(body: string): string {
    // JSON 数组分帧：`bindingId` 里带换行也拼不出另一个 (binding, 规范体) 的同一输入。
    return createHmac('sha256', this.#issuerKey).update(JSON.stringify([this.bindingId, body])).digest('base64url')
  }

  private issue(facts: ManualRunFacts): cap.ExternalObjectRef {
    const body = bodyOf(facts)
    return { bindingId: this.bindingId, objectKind: EntityKind.ExecutionRun, externalId: `${body}${SIGNATURE_MARK}${this.sign(body)}`, url: undefined }
  }

  private blocked<T>(): cap.ProviderResult<T> | undefined {
    if (this.faults.offline === true) return this.fail(ProviderErrorCode.Unavailable, '人工执行 provider 离线：请求未发出')
    return undefined
  }

  private notFound<T>(): cap.ProviderResult<T> {
    return this.fail(ProviderErrorCode.NotFound, '运行不存在，或该引用不是本签发者发出的')
  }

  private unsupported<T>(): cap.ProviderResult<T> {
    return this.fail(ProviderErrorCode.NotSupported, `未启用的能力：${cap.CapabilityKey.ExecutionRunCancel}`)
  }

  private fail<T>(code: ProviderErrorCode, message: string): cap.ProviderResult<T> {
    return cap.providerErr(cap.providerError(code, message))
  }
}

export function createHumanExecutionProvider(options: HumanExecutionProviderOptions): HumanExecutionProvider {
  return new HumanExecutionProvider(options)
}
