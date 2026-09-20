/**
 * Delivery 能力域 port（流水线、检查、部署与环境）。
 *
 * MVP 的远端实现只声明读能力；写能力（重跑 / 取消）可选，缺失时必须由 capability key 报不可用，
 * 而不是静默成功或抛出平台错误。
 */
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation, ProviderReconcileScope } from './observation.ts'
import type { ProviderPage, ProviderResult } from './result.ts'

export interface ProviderPipelineRun {
  readonly ref: ExternalObjectRef; readonly status: string; readonly commit: string; readonly conclusion: string | undefined
}

export interface ProviderCheckRun {
  readonly ref: ExternalObjectRef; readonly name: string; readonly status: string; readonly conclusion: string | undefined
}

export interface ProviderDeployment {
  readonly ref: ExternalObjectRef; readonly environment: string; readonly status: string
}

export interface ProviderEnvironment {
  readonly ref: ExternalObjectRef; readonly name: string; readonly protected: boolean
}

export interface ProviderListPipelineRunsInput { readonly repository: ExternalObjectRef; readonly commit: string | undefined; readonly cursor: string | undefined; readonly limit: number }
export interface ProviderListChecksInput { readonly changeRequest: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }
export interface ProviderListDeploymentsInput { readonly repository: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }

export interface DeliveryProvider {
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  listPipelineRuns(input: ProviderListPipelineRunsInput): Promise<ProviderResult<ProviderPage<ProviderPipelineRun>>>
  listChecks(input: ProviderListChecksInput): Promise<ProviderResult<ProviderPage<ProviderCheckRun>>>
  listDeployments?(input: ProviderListDeploymentsInput): Promise<ProviderResult<ProviderPage<ProviderDeployment>>>
  listEnvironments?(repository: ExternalObjectRef): Promise<ProviderResult<readonly ProviderEnvironment[]>>
  rerunPipeline?(ref: ExternalObjectRef): Promise<ProviderResult<ProviderPipelineRun>>
  cancelPipeline?(ref: ExternalObjectRef): Promise<ProviderResult<void>>
  reconcile?(scope: ProviderReconcileScope): AsyncIterable<ProviderObservation>
}
