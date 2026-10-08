/**
 * Delivery 能力域 port（流水线、检查、部署与环境）。
 *
 * MVP 的远端实现只声明读能力；写能力（重跑 / 取消）可选，缺失时必须由 capability key 报不可用，
 * 而不是静默成功或抛出平台错误。
 */
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation, ProviderReconcileScope } from './observation.ts'
import type { ProviderPage, ProviderResult } from './result.ts'
import type { ProviderDefinition } from './registry.ts'

/**
 * 流水线运行与检查共用的 `status` / `conclusion` 词表契约：provider 交出 GitHub Actions / Checks 的原生小写值，
 * core 的唯一 CI 映射只认这份词表（2026-10-08 按 GitHub 文档核对）。
 * - status：`queued`、`in_progress`、`completed`、`waiting`、`requested`、`pending`；只有 `completed` 是终态。
 * - conclusion：终态时为 `success`、`failure`、`timed_out`、`action_required`、`startup_failure`、`cancelled`、`neutral`、
 *   `skipped`、`stale` 之一；未完成时为 undefined。
 * 别的平台（例如 GitLab 的 `failed`）必须先在 provider 内归一化到这份词表；词表外的值保守地不产生任何 CI 事实。
 * `commit` 是对象所属的完整提交：core 发现任一项与已观察的 head 不符，就作废整次集合。
 */
export interface ProviderPipelineRun {
  readonly ref: ExternalObjectRef; readonly status: string; readonly commit: string
  /** 原生 head_branch；平台没有给出时为 undefined，不猜分支。 */
  readonly branch: string | undefined; readonly conclusion: string | undefined
}

export interface ProviderCheckRun {
  readonly ref: ExternalObjectRef; readonly name: string; readonly status: string
  /** 检查所属的完整提交：调用方据此证明检查属于它已观察到的 head（词表契约见 `ProviderPipelineRun`）。 */
  readonly commit: string; readonly conclusion: string | undefined
}

export interface ProviderDeployment {
  readonly ref: ExternalObjectRef; readonly environment: string; readonly status: string
}

export interface ProviderEnvironment {
  readonly ref: ExternalObjectRef; readonly name: string; readonly protected: boolean
}

export interface ProviderListPipelineRunsInput {
  readonly repository: ExternalObjectRef; readonly commit: string | undefined
  /** 可选的原生分支过滤；缺省即不按分支筛选。 */
  readonly branch?: string
  readonly cursor: string | undefined; readonly limit: number
}
export interface ProviderListChecksInput { readonly repository: ExternalObjectRef; readonly commit: string; readonly cursor: string | undefined; readonly limit: number }
export interface ProviderListDeploymentsInput { readonly repository: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }

export interface DeliveryProvider {
  /** 静态连接实现定义：由实现作者声明，Host 只注入实例与 id（见 `ProviderDefinition`）。 */
  readonly definition: ProviderDefinition
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  listPipelineRuns(input: ProviderListPipelineRunsInput): Promise<ProviderResult<ProviderPage<ProviderPipelineRun>>>
  listChecks(input: ProviderListChecksInput): Promise<ProviderResult<ProviderPage<ProviderCheckRun>>>
  listDeployments?(input: ProviderListDeploymentsInput): Promise<ProviderResult<ProviderPage<ProviderDeployment>>>
  listEnvironments?(repository: ExternalObjectRef): Promise<ProviderResult<readonly ProviderEnvironment[]>>
  rerunPipeline?(ref: ExternalObjectRef): Promise<ProviderResult<ProviderPipelineRun>>
  cancelPipeline?(ref: ExternalObjectRef): Promise<ProviderResult<void>>
  reconcile?(scope: ProviderReconcileScope): AsyncIterable<ProviderObservation>
}
