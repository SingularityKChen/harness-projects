/**
 * Development 能力域 port（仓库、分支、工作树、提交、变更请求）。
 *
 * 读能力必需，写能力可选；本地 Git 与远端平台各自只实现一个子集，调用方按 capability key 判定，
 * 不得按 provider 名字分支。
 *
 * 可选方法的实现义务（契约测试逐条钉住）：
 *
 * 1. **能力判定先于身份判定**：能力未声明时，对**任何**输入都回答 `not_supported`——能力整体不存在时
 *    结论与输入无关。顺序反过来会让「能力没开 + 外来引用」答 `not_found`，而两个码指向不同的恢复动作
 *    （`not_supported` → 转人工，`not_found` → 去平台确认），把调用方引向错误的方向。
 * 2. **能力按方法各自声明**：同一族的读与写是两个独立 key（例如 `development.change_request.read` 与
 *    `development.change_request.create`）。「只声明读、不声明写」是合法的能力子集，实现不得用读的可用性
 *    代替写的可用性，调用方也不得用一族里的一个键去判定另一个方法。凭据权限（`permission` 为 `read_only`）
 *    是与能力声明正交的另一层，写调用在那一层答 `permission_denied`。
 * 3. **方法缺失必须由快照表达**：不实现某个可选方法时，快照**不得**把对应 key 声明为 `available`
 *    （`capability-keys.ts` 的约定是「未声明的 capability 不出现」）。
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
