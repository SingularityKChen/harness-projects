/**
 * Execution 能力域 port（启动、查询、可选取消）。
 *
 * 契约**故意没有 reconcile**——这是本批次的显式决策，不是遗漏：MVP 由 core 轮询 `getRun` 兜底，
 * 因此执行域不承诺观察流；在平台侧出现可用的执行事件源之前，任何调用方都不得假设
 * `ExecutionProvider` 能产出 `ProviderObservation`。详见 ExecPlan 的 Decision Log。
 */
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef } from './observation.ts'
import type { ProviderResult } from './result.ts'

export interface ProviderExecutionRun {
  readonly ref: ExternalObjectRef; readonly status: string
  readonly startedAt: string | undefined; readonly finishedAt: string | undefined
  readonly exitCode: number | undefined; readonly logUrl: string | undefined
}

export interface ProviderStartRunInput {
  readonly context: ExternalObjectRef; readonly command: string; readonly environment: Readonly<Record<string, string>>
}

export interface ExecutionProvider {
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  startRun(input: ProviderStartRunInput): Promise<ProviderResult<ProviderExecutionRun>>
  getRun(ref: ExternalObjectRef): Promise<ProviderResult<ProviderExecutionRun>>
  cancelRun?(ref: ExternalObjectRef): Promise<ProviderResult<ProviderExecutionRun>>
}
