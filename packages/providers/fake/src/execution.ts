/**
 * 离线 Execution provider：启动、查询、可选取消。
 *
 * 与 port 的 Decision Log 一致，本替身**不提供** reconcile：没有事件源就不假装有观察流，MVP 由调用方
 * 轮询 `getRun` 兜底。启动失败必须映射成**带阶段名**的结构化错误——只说"失败了"的调用方无法判断
 * 该原样重试还是换环境；阶段名取自离线 harness 的阶段计划（prepare / execute / collect）。
 */
import * as cap from '@harness-projects/capabilities'
import { EntityKind, ExecutionRunStatus, newProviderBindingId, ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { createFaultSwitch, FaultKind, type FaultPlan, type FaultSwitch } from './faults.ts'
import { FakeGate, providerFail } from './gate.ts'
import { itemKey, refOf } from './state.ts'

export type FakeExecutionCapabilities = { cancel: boolean }
const ALL_CAPABILITIES: FakeExecutionCapabilities = { cancel: true }

/** 离线 harness 的阶段计划：启动失败发生在第一个阶段之前，因此默认命名 `prepare`。 */
export const DEFAULT_FAILING_STAGE = 'prepare'
const TERMINAL_STATUSES: readonly string[] = [
  ExecutionRunStatus.Succeeded, ExecutionRunStatus.Failed, ExecutionRunStatus.Canceled, ExecutionRunStatus.TimedOut,
]

function declaredCapabilities(flags: FakeExecutionCapabilities): Partial<Record<cap.CapabilityKey, cap.AccessLevel>> {
  const map: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {
    [cap.CapabilityKey.ExecutionRunStart]: cap.AccessLevel.Available,
    [cap.CapabilityKey.ExecutionRunRead]: cap.AccessLevel.Available,
  }
  if (flags.cancel) map[cap.CapabilityKey.ExecutionRunCancel] = cap.AccessLevel.Available
  return map
}

export type FakeExecutionRunRecord = {
  readonly ref: cap.ExternalObjectRef; readonly status: string; readonly command: string; readonly startedAt: string | undefined
  readonly finishedAt: string | undefined; readonly exitCode: number | undefined; readonly logUrl: string | undefined
}
export type FakeExecutionState = { runs: FakeExecutionRunRecord[]; seq: number }

/** 默认种子：一次成功的运行与一次仍在运行的运行；新运行的序号从种子之后继续。 */
function seedExecutionState(bindingId: ProviderBindingId): FakeExecutionState {
  const run = (id: string, status: string, command: string, exitCode: number | undefined, finishedAt: string | undefined): FakeExecutionRunRecord =>
    ({ ref: refOf(bindingId, EntityKind.ExecutionRun, id), status, command, startedAt: '2026-09-20T00:00:00Z', finishedAt, exitCode, logUrl: `harness://runs/${id}/log` })
  return {
    runs: [
      run('run-1', ExecutionRunStatus.Succeeded, 'task verify', 0, '2026-09-20T00:01:00Z'),
      run('run-2', ExecutionRunStatus.Running, 'task test', undefined, undefined),
    ],
    seq: 2,
  }
}

export type FakeExecutionProviderOptions = {
  bindingId?: ProviderBindingId; faults?: Partial<FaultPlan>; capabilities?: Partial<FakeExecutionCapabilities>; failingStage?: string; observedAt?: string
}

export class FakeExecutionProvider implements cap.ExecutionProvider {
  readonly state: FakeExecutionState
  readonly faultsSwitch: FaultSwitch
  readonly flags: FakeExecutionCapabilities
  readonly gate: FakeGate
  readonly failingStage: string

  constructor(options: FakeExecutionProviderOptions = {}) {
    const bindingId = options.bindingId ?? newProviderBindingId()
    this.state = seedExecutionState(bindingId)
    this.faultsSwitch = createFaultSwitch(options.faults ?? {})
    this.flags = { ...ALL_CAPABILITIES, ...(options.capabilities ?? {}) }
    this.failingStage = options.failingStage ?? DEFAULT_FAILING_STAGE
    this.gate = new FakeGate(this.faultsSwitch, bindingId, options.observedAt ?? '2026-09-20T00:00:00Z')
  }

  describeCapabilities(): Promise<cap.ProviderCapabilitySnapshot> {
    return Promise.resolve(this.gate.snapshot(declaredCapabilities(this.flags)))
  }

  async startRun(input: cap.ProviderStartRunInput): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.gate.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return blocked
    if (this.faultsSwitch.isOn(FaultKind.HarnessFailure)) {
      return providerFail(ProviderErrorCode.Unavailable, `阶段 ${this.failingStage} 启动失败：执行 harness 未能启动`)
    }
    if (this.faultsSwitch.isOn(FaultKind.AmbiguousCreate)) return this.gate.ambiguous('启动运行')
    this.state.seq += 1
    const id = `run-${this.state.seq}`
    const record: FakeExecutionRunRecord = {
      ref: refOf(this.gate.bindingId, EntityKind.ExecutionRun, id), status: ExecutionRunStatus.Running,
      command: input.command, startedAt: this.gate.observedAt, finishedAt: undefined, exitCode: undefined,
      logUrl: `harness://runs/${id}/log`,
    }
    this.state.runs.push(record)
    return cap.providerOk(toRun(record))
  }

  async getRun(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.gate.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return blocked
    const found = this.state.runs.find((r) => itemKey(r.ref) === itemKey(ref))
    return found === undefined ? this.gate.notFound('运行') : cap.providerOk(toRun(found))
  }

  /** 可选取消：未声明时返回 not_supported；已结束的运行返回 conflict，不假装取消成功。 */
  async cancelRun(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderExecutionRun>> {
    const blocked = this.gate.blocked<cap.ProviderExecutionRun>()
    if (blocked !== undefined) return blocked
    if (!this.flags.cancel) return this.gate.unsupported(cap.CapabilityKey.ExecutionRunCancel)
    const found = this.state.runs.find((r) => itemKey(r.ref) === itemKey(ref))
    if (found === undefined) return this.gate.notFound('运行')
    if (TERMINAL_STATUSES.includes(found.status)) return providerFail(ProviderErrorCode.Conflict, `运行已结束：${found.status}`)
    const canceled: FakeExecutionRunRecord = { ...found, status: ExecutionRunStatus.Canceled, finishedAt: this.gate.observedAt }
    this.state.runs = this.state.runs.map((r) => (itemKey(r.ref) === itemKey(ref) ? canceled : r))
    return cap.providerOk(toRun(canceled))
  }
}

function toRun(record: FakeExecutionRunRecord): cap.ProviderExecutionRun {
  return {
    ref: record.ref, status: record.status, startedAt: record.startedAt,
    finishedAt: record.finishedAt, exitCode: record.exitCode, logUrl: record.logUrl,
  }
}

export function createFakeExecutionProvider(options: FakeExecutionProviderOptions = {}): FakeExecutionProvider {
  return new FakeExecutionProvider(options)
}
