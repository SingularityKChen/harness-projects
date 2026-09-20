/**
 * Development 能力域 port（仓库、分支、工作树、提交、变更请求）。
 *
 * 读能力必需，写能力可选；本地 Git 与远端平台各自只实现一个子集，调用方按 capability key 判定，
 * 不得按 provider 名字分支。
 */
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation, ProviderReconcileScope } from './observation.ts'
import type { ProviderPage, ProviderResult } from './result.ts'

export interface ProviderRepository {
  readonly ref: ExternalObjectRef; readonly name: string
  readonly defaultBranch: string | undefined; readonly sourceUpdatedAt: string | undefined
}

export interface ProviderBranch {
  readonly ref: ExternalObjectRef; readonly name: string; readonly headCommit: string | undefined
}

export interface ProviderWorktree {
  readonly ref: ExternalObjectRef; readonly path: string; readonly branch: string
}

export interface ProviderCommit {
  readonly ref: ExternalObjectRef; readonly sha: string; readonly message: string | undefined
}

export interface ProviderChangeRequest {
  readonly ref: ExternalObjectRef; readonly number: number; readonly title: string; readonly body: string
  readonly state: string; readonly sourceVersion: string | undefined
}

export interface ProviderCreateBranchInput {
  readonly repository: ExternalObjectRef; readonly name: string; readonly fromRef: string
}

export interface ProviderCreateWorktreeInput {
  readonly repository: ExternalObjectRef; readonly path: string; readonly branch: string
}

export interface ProviderCreateChangeRequestInput {
  readonly repository: ExternalObjectRef; readonly head: string; readonly base: string; readonly title: string; readonly body: string
}

export interface ProviderRemoveWorktreeInput { readonly worktree: ExternalObjectRef }
export interface ProviderListBranchesInput { readonly repository: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }
export interface ProviderListChangeRequestsInput { readonly repository: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }

export interface DevelopmentProvider {
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  getRepository(ref: ExternalObjectRef): Promise<ProviderResult<ProviderRepository>>
  listBranches(input: ProviderListBranchesInput): Promise<ProviderResult<ProviderPage<ProviderBranch>>>
  getCommit(ref: ExternalObjectRef): Promise<ProviderResult<ProviderCommit>>
  getChangeRequest(ref: ExternalObjectRef): Promise<ProviderResult<ProviderChangeRequest>>
  listChangeRequests(input: ProviderListChangeRequestsInput): Promise<ProviderResult<ProviderPage<ProviderChangeRequest>>>
  createBranch?(input: ProviderCreateBranchInput): Promise<ProviderResult<ProviderBranch>>
  createWorktree?(input: ProviderCreateWorktreeInput): Promise<ProviderResult<ProviderWorktree>>
  createChangeRequest?(input: ProviderCreateChangeRequestInput): Promise<ProviderResult<ProviderChangeRequest>>
  removeWorktree?(input: ProviderRemoveWorktreeInput): Promise<ProviderResult<void>>
  reconcile?(scope: ProviderReconcileScope): AsyncIterable<ProviderObservation>
}
