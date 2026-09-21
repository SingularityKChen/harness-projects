/**
 *
 * `result_unknown`。`conflict` 同时保留最后已知权威值与本次尝试值。
 *
 * 只有 `confirmWrite` / `reconcileWrite` 能产出 confirmed / reconciled，因此"权威 Saved"在类型流上
 * 必然有证据；`reportFor` 只是把阶段翻译成对外可见的 WriteState。
 */
import {
  ProjectErrorCode, projectError,
  type MutationAttemptRecord, type ProjectError, type Storage,
} from '@harness-projects/capabilities'
import { WriteState, type ProviderBindingId, type WorkspaceId } from '@harness-projects/domain'

export const WritePhase = {
  Validating: 'validating',
  Writing: 'writing',
  Confirmed: 'confirmed',
  Reconciled: 'reconciled',
  Unknown: 'unknown',
  Conflict: 'conflict',
  Failed: 'failed',
} as const
export type WritePhase = (typeof WritePhase)[keyof typeof WritePhase]

/** conflict 恢复时调用方要并列显示的两个值；没有证据的那一侧必须显式为 undefined。 */
export interface WriteValues {
  readonly attemptedValue: string | undefined
  readonly lastKnownAuthoritative: string | undefined
}

export interface WriteReport {
  readonly phase: WritePhase
  /** 恒等于"尚未确认"：为 true 时 writeState 只能是 pending。 */
  readonly saving: boolean
  readonly writeState: WriteState
  readonly confirmed: boolean
  readonly values: WriteValues
  readonly error: ProjectError | undefined
}

const WRITE_STATE_BY_PHASE: Readonly<Record<WritePhase, WriteState>> = {
  [WritePhase.Validating]: WriteState.Pending,
  [WritePhase.Writing]: WriteState.Pending,
  [WritePhase.Confirmed]: WriteState.Saved,
  [WritePhase.Reconciled]: WriteState.Saved,
  [WritePhase.Unknown]: WriteState.Unknown,
  [WritePhase.Conflict]: WriteState.Conflict,
  [WritePhase.Failed]: WriteState.Failed,
}

export function reportFor(phase: WritePhase, values: WriteValues, error: ProjectError | undefined): WriteReport {
  const saving = phase === WritePhase.Validating || phase === WritePhase.Writing
  return {
    phase, saving, writeState: WRITE_STATE_BY_PHASE[phase],
    confirmed: phase === WritePhase.Confirmed || phase === WritePhase.Reconciled,
    values, error,
  }
}

export function emptyValues(): WriteValues {
  return { attemptedValue: undefined, lastKnownAuthoritative: undefined }
}

export function beginWrite(attemptedValue: string | undefined): WriteReport {
  return reportFor(WritePhase.Validating, { attemptedValue, lastKnownAuthoritative: undefined }, undefined)
}

/** unknown 上重试创建：不改变阶段，只把"先 reconcile"的结论反馈给调用方。 */
export function markWriting(report: WriteReport): WriteReport {
  if (report.phase === WritePhase.Unknown) return writeUnknown(report)
  if (report.phase !== WritePhase.Validating) return report
  return reportFor(WritePhase.Writing, report.values, undefined)
}

/** provider ack 或 read-after-write 证据到达：这是唯一进入 confirmed 的入口。 */
export function confirmWrite(report: WriteReport, confirmedValue: string | undefined): WriteReport {
  if (report.phase !== WritePhase.Writing) return report
  const attemptedValue = report.values.attemptedValue
  return reportFor(WritePhase.Confirmed, { attemptedValue, lastKnownAuthoritative: confirmedValue ?? attemptedValue }, undefined)
}

export function markUnknown(report: WriteReport, error: ProjectError): WriteReport {
  if (report.phase !== WritePhase.Writing && report.phase !== WritePhase.Unknown) return report
  return reportFor(WritePhase.Unknown, report.values, error)
}

/** 远端权威值与本尝试不一致：两个值都留下，恢复动作是 refresh / reapply。 */
export function markConflict(report: WriteReport, confirmedValue: string | undefined): WriteReport {
  const attemptedValue = report.values.attemptedValue
  const error = projectError(ProjectErrorCode.Conflict, '远端权威值与本尝试不一致，需重新读取后重放', {
    ...(confirmedValue === undefined ? {} : { confirmedValue }),
    ...(attemptedValue === undefined ? {} : { attemptedValue }),
  })
  return reportFor(WritePhase.Conflict, { attemptedValue, lastKnownAuthoritative: confirmedValue }, error)
}

export function markFailed(report: WriteReport, error: ProjectError): WriteReport {
  return reportFor(WritePhase.Failed, report.values, error)
}

export interface ReconcileProbe {
  readonly found: boolean
  readonly value: string | undefined
  readonly error: ProjectError | undefined
}

/** reconcile 是 unknown 的唯一出口：找到同值 → reconciled；找到异值 → conflict；找不到 → failed。 */
export function reconcileWrite(report: WriteReport, probe: ReconcileProbe): WriteReport {
  if (report.phase !== WritePhase.Unknown) return report
  if (probe.error !== undefined) return reportFor(WritePhase.Unknown, report.values, probe.error)
  if (!probe.found) {
    return markFailed(report, projectError(ProjectErrorCode.NotFound, 'reconcile 未发现写入结果：创建未生效，需显式重新发起'))
  }
  const attemptedValue = report.values.attemptedValue
  if (probe.value === attemptedValue) {
    return reportFor(WritePhase.Reconciled, { attemptedValue, lastKnownAuthoritative: probe.value }, undefined)
  }
  return markConflict(report, probe.value)
}

function writeUnknown(report: WriteReport): WriteReport {
  const error = projectError(ProjectErrorCode.ResultUnknown, '写入结果未知：必须先 reconcile，禁止盲目重试创建')
  return reportFor(WritePhase.Unknown, report.values, error)
}

export interface WriteAttemptInput {
  readonly workspaceId: WorkspaceId
  readonly bindingId: ProviderBindingId
  readonly commandName: string
  readonly idempotencyKey: string
  readonly report: WriteReport
}

/** 写尝试账本：以 (workspace, idempotencyKey) 去重，同键重放返回首次尝试的结果。 */
export interface WriteLedger {
  replay(workspaceId: WorkspaceId, idempotencyKey: string): Promise<WriteReport | undefined>
  record(input: WriteAttemptInput): Promise<void>
}

const PHASE_BY_WRITE_STATE: Readonly<Record<WriteState, WritePhase>> = {
  [WriteState.Pending]: WritePhase.Writing,
  [WriteState.Saved]: WritePhase.Confirmed,
  [WriteState.Unknown]: WritePhase.Unknown,
  [WriteState.Conflict]: WritePhase.Conflict,
  [WriteState.Failed]: WritePhase.Failed,
}

export function createWriteLedger(storage: Storage): WriteLedger {
  return {
    async replay(workspaceId, idempotencyKey) {
      const attempt = await storage.findMutationAttempt(workspaceId, idempotencyKey)
      return attempt === undefined ? undefined : replayReport(attempt)
    },
    async record(input) {
      await storage.putMutationAttempt({
        id: `write:${input.commandName}:${input.idempotencyKey}`,
        workspaceId: input.workspaceId, bindingId: input.bindingId, commandName: input.commandName,
        idempotencyKey: input.idempotencyKey, state: input.report.writeState,
        expectedSourceVersion: undefined, errorCode: input.report.error?.code,
      })
    },
  }
}

function replayReport(attempt: MutationAttemptRecord): WriteReport {
  const phase = PHASE_BY_WRITE_STATE[attempt.state]
  const error = attempt.errorCode === undefined
    ? undefined
    : projectError(attempt.errorCode, '重放的写尝试：结果取自首次尝试')
  return reportFor(phase, emptyValues(), error)
}
