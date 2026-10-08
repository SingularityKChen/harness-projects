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
 * 4. **列表方法可以逐页读完**：从 `cursor: undefined` 起逐页读到 `nextCursor === undefined`，无并发写入时
 *    恰好枚举每个对象一次。core 据此把「读完仍没有」当作「不存在」（Start Work 的分支探测），把「读不完」
 *    当作「不知道」；游标不结束（包括循环回到旧游标）的 provider 会让对账停在 `unknown`。契约套件的分页用例钉住这一条。
 */
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef, ProviderObservation, ProviderReconcileScope } from './observation.ts'
import type { ProviderPage, ProviderResult } from './result.ts'
import type { ProviderDefinition } from './registry.ts'

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

/**
 * 变更请求快照里的**保守**评审状态。`unknown` 表示来源没有给出可靠审核结论；`review_required` 表示来源明确
 * 报告需要审核。二者不得由 PR 仍 open、CI 成功、没有审批或评论数量反推——把来源未知读成批准或读成待审核，
 * 都会让调用方按一个平台没说过的事实行动。来源将来出现本 union 之外的枚举时投影为 `unknown`，绝不默认 `approved`。
 */
export type ProviderReviewState = 'approved' | 'changes_requested' | 'review_required' | 'unknown'

export interface ProviderChangeRequest {
  readonly ref: ExternalObjectRef; readonly number: number; readonly title: string; readonly body: string
  readonly state: string
  /** 头部提交 sha：谱系只按**相等**比较，不是观察的定序载体（观察只认 `observation.ts` R4 的规范载体）。 */
  readonly sourceVersion: string | undefined
  /** 真实头部**分支身份**；以直接提交 sha 创建（provider 可选支持）、无法精确解析为本仓库分支时为 `undefined`，不按 sha 反推分支。 */
  readonly headBranch: string | undefined
  readonly reviewState: ProviderReviewState
}

export interface ProviderCreateBranchInput {
  readonly repository: ExternalObjectRef; readonly name: string; readonly fromRef: string
}

export interface ProviderCreateWorktreeInput {
  readonly repository: ExternalObjectRef; readonly path: string; readonly branch: string
}
export interface ProviderGetWorktreeInput { readonly worktree: ExternalObjectRef }

/** `head` 是分支名；是否也接受直接提交 sha 由 provider 决定，不接受时答结构化 `invalid_input` 且不留任何对象。 */
export interface ProviderCreateChangeRequestInput {
  readonly repository: ExternalObjectRef; readonly head: string; readonly base: string; readonly title: string; readonly body: string
}

export interface ProviderRemoveWorktreeInput { readonly worktree: ExternalObjectRef }
export interface ProviderListBranchesInput { readonly repository: ExternalObjectRef; readonly cursor: string | undefined; readonly limit: number }
/**
 * 列表过滤：`repository` 身份先于 `headBranch`，`headBranch` 是**字节精确**的可选分支过滤（不 trim、不
 * case-fold）；未提供表示不筛选，空串是调用方的输入错误。先过滤再分页，游标只可在同一
 * `(repository, headBranch, limit)` scope 内重用——改变 scope 必须从 `cursor: undefined` 重新开始。
 */
export interface ProviderListChangeRequestsInput {
  readonly repository: ExternalObjectRef
  readonly cursor: string | undefined
  readonly limit: number
  readonly headBranch?: string
}

export interface DevelopmentProvider {
  /** 静态连接实现定义：由实现作者声明，Host 只注入实例与 id（见 `ProviderDefinition`）。 */
  readonly definition: ProviderDefinition
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  getRepository(ref: ExternalObjectRef): Promise<ProviderResult<ProviderRepository>>
  listBranches(input: ProviderListBranchesInput): Promise<ProviderResult<ProviderPage<ProviderBranch>>>
  getCommit(ref: ExternalObjectRef): Promise<ProviderResult<ProviderCommit>>
  getChangeRequest(ref: ExternalObjectRef): Promise<ProviderResult<ProviderChangeRequest>>
  listChangeRequests(input: ProviderListChangeRequestsInput): Promise<ProviderResult<ProviderPage<ProviderChangeRequest>>>
  createBranch?(input: ProviderCreateBranchInput): Promise<ProviderResult<ProviderBranch>>
  createWorktree?(input: ProviderCreateWorktreeInput): Promise<ProviderResult<ProviderWorktree>>
  getWorktree?(input: ProviderGetWorktreeInput): Promise<ProviderResult<ProviderWorktree>>
  createChangeRequest?(input: ProviderCreateChangeRequestInput): Promise<ProviderResult<ProviderChangeRequest>>
  removeWorktree?(input: ProviderRemoveWorktreeInput): Promise<ProviderResult<void>>
  /** 观察的 `sourceVersion` 只取 `observation.ts` R4 的规范时间戳或 `undefined`；变更请求的头部 sha 不得填进去。 */
  reconcile?(scope: ProviderReconcileScope): AsyncIterable<ProviderObservation>
}
