/**
 * 离线 Development provider：仓库身份、分支、工作树、提交与变更请求。
 *
 * 原生谱系是一等事实（AGENTS.md §1.1 不变量 6）：变更请求的 `sourceVersion` 就是它头部提交的 sha，
 * 提交记录反向持有自己的变更请求，因此 工作树→分支→提交→变更请求 全程按外部 id 传播，调用方
 * 不需要重新识别任何对象。失败一律是结构化 `ProviderResult`；未声明的可选能力返回 not_supported。
 * 身份按 binding 隔离：按仓库操作的成员先校验仓库属于本 binding 且已注册，外来引用一律 not_found——
 * 读侧静默空页、写侧静默创建都会把别的 binding 的谱系混进本 provider（AGENTS.md §1.1 不变量 6）。
 */
import * as cap from '@harness-projects/capabilities'
import { EntityKind, newProviderBindingId, ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { createFaultSwitch, FaultKind, type FaultPlan, type FaultSwitch } from './faults.ts'
import { FakeGate, providerFail } from './gate.ts'
import { byExternalId, itemKey, paginate, refOf } from './state.ts'

export type FakeDevelopmentCapabilities = {
  branchCreate: boolean; worktreeCreate: boolean; worktreeRead: boolean; worktreeRemove: boolean; changeRequestCreate: boolean
}
const ALL_CAPABILITIES: FakeDevelopmentCapabilities = {
  branchCreate: true, worktreeCreate: true, worktreeRead: true, worktreeRemove: true, changeRequestCreate: true,
}

/** 未启用的能力不出现在快照里：调用方据此提前得到 unavailable，而不是等一次失败才知道。 */
function declaredCapabilities(flags: FakeDevelopmentCapabilities): Partial<Record<cap.CapabilityKey, cap.AccessLevel>> {
  const map: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {
    [cap.CapabilityKey.DevelopmentRepositoryRead]: cap.AccessLevel.Available,
    [cap.CapabilityKey.DevelopmentChangeRequestRead]: cap.AccessLevel.Available,
  }
  if (flags.branchCreate) map[cap.CapabilityKey.DevelopmentBranchCreate] = cap.AccessLevel.Available
  if (flags.worktreeCreate) map[cap.CapabilityKey.DevelopmentWorktreeCreate] = cap.AccessLevel.Available
  if (flags.worktreeRead) map[cap.CapabilityKey.DevelopmentWorktreeRead] = cap.AccessLevel.Available
  // 移除是破坏性能力，单独声明：能创建不等于能移除（AGENTS.md §7 破坏性删除默认不做）。
  if (flags.worktreeRemove) map[cap.CapabilityKey.DevelopmentWorktreeRemove] = cap.AccessLevel.Available
  if (flags.changeRequestCreate) map[cap.CapabilityKey.DevelopmentChangeRequestCreate] = cap.AccessLevel.Available
  // review.read 在 port 里没有对应方法：键不声明，方法不提供（与 Planning 的 content.write 同一处理）。
  return map
}

export type FakeRepositoryRecord = { ref: cap.ExternalObjectRef; name: string; defaultBranch: string | undefined; sourceUpdatedAt: string | undefined }
export type FakeBranchRecord = { repository: cap.ExternalObjectRef; ref: cap.ExternalObjectRef; name: string; headCommit: string | undefined }
export type FakeCommitRecord = { ref: cap.ExternalObjectRef; sha: string; message: string | undefined; changeRequest: cap.ExternalObjectRef | undefined }
export type FakeWorktreeRecord = { repository: cap.ExternalObjectRef; ref: cap.ExternalObjectRef; path: string; branch: string }
export type FakeChangeRequestRecord = {
  ref: cap.ExternalObjectRef; repository: cap.ExternalObjectRef; number: number
  title: string; body: string; state: string; head: string; headCommit: string; sourceVersion: string
}
export type FakeDevelopmentState = {
  repositories: FakeRepositoryRecord[]; branches: FakeBranchRecord[]; commits: FakeCommitRecord[]
  worktrees: FakeWorktreeRecord[]; changeRequests: FakeChangeRequestRecord[]; seq: number
}

/** 默认种子：一个仓库、main 分支与其上的初始提交；变更请求由调用方创建，编号从 0 继续。 */
function seedDevelopmentState(bindingId: ProviderBindingId): FakeDevelopmentState {
  const repository = refOf(bindingId, EntityKind.Repository, 'repo-alpha')
  const base = refOf(bindingId, EntityKind.Commit, 'sha-1')
  return {
    repositories: [{ ref: repository, name: 'alpha', defaultBranch: 'main', sourceUpdatedAt: '2026-09-20T00:00:00Z' }],
    branches: [{ repository, ref: refOf(bindingId, EntityKind.Branch, 'main'), name: 'main', headCommit: base.externalId }],
    commits: [{ ref: base, sha: base.externalId, message: '初始提交', changeRequest: undefined }],
    worktrees: [], changeRequests: [], seq: 0,
  }
}

export type FakeDevelopmentProviderOptions = {
  bindingId?: ProviderBindingId; faults?: Partial<FaultPlan>; capabilities?: Partial<FakeDevelopmentCapabilities>; observedAt?: string }

export class FakeDevelopmentProvider implements cap.DevelopmentProvider {
  readonly state: FakeDevelopmentState
  readonly faultsSwitch: FaultSwitch
  readonly flags: FakeDevelopmentCapabilities
  readonly gate: FakeGate

  constructor(options: FakeDevelopmentProviderOptions = {}) {
    const bindingId = options.bindingId ?? newProviderBindingId()
    this.state = seedDevelopmentState(bindingId)
    this.faultsSwitch = createFaultSwitch(options.faults ?? {})
    this.flags = { ...ALL_CAPABILITIES, ...(options.capabilities ?? {}) }
    this.gate = new FakeGate(this.faultsSwitch, bindingId, options.observedAt ?? '2026-09-20T00:00:00Z')
  }

  describeCapabilities(): Promise<cap.ProviderCapabilitySnapshot> {
    return Promise.resolve(this.gate.snapshot(declaredCapabilities(this.flags)))
  }

  /** 分支定位必须限定在同一仓库内：跨仓库读同一 externalId 不是同一个对象。 */
  private branchOf(repository: cap.ExternalObjectRef, name: string): FakeBranchRecord | undefined {
    return this.state.branches.find((b) => b.name === name && itemKey(b.repository) === itemKey(repository))
  }

  /** 外部引用必须属于本 binding。`itemKey` 已含 bindingId，这里把身份不变量显式成一处判定。 */
  private owns(ref: cap.ExternalObjectRef): boolean {
    return ref.bindingId === this.gate.bindingId
  }

  /**
   * 仓库身份闸门：外来 binding 或未在本 provider 注册过的仓库引用一律不认。
   * 读侧静默返回空页、写侧静默创建，都会把别的 binding 的谱系混进本 provider，必须显式 not_found。
   */
  private knownRepository(repository: cap.ExternalObjectRef): FakeRepositoryRecord | undefined {
    if (!this.owns(repository)) return undefined
    return this.state.repositories.find((r) => itemKey(r.ref) === itemKey(repository))
  }

  async getRepository(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderRepository>> {
    const blocked = this.gate.blocked<cap.ProviderRepository>()
    if (blocked !== undefined) return blocked
    const found = this.knownRepository(ref)
    return found === undefined ? this.gate.notFound('仓库') : cap.providerOk(found)
  }

  async listBranches(input: cap.ProviderListBranchesInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderBranch>>> {
    const blocked = this.gate.blocked<cap.ProviderPage<cap.ProviderBranch>>()
    if (blocked !== undefined) return blocked
    if (this.knownRepository(input.repository) === undefined) return this.gate.notFound('仓库')
    const rows = this.state.branches.filter((b) => itemKey(b.repository) === itemKey(input.repository)).sort(byExternalId)
    return cap.providerOk(paginate(rows.map(toBranch), input))
  }

  async getCommit(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderCommit>> {
    const blocked = this.gate.blocked<cap.ProviderCommit>()
    if (blocked !== undefined) return blocked
    if (!this.owns(ref)) return this.gate.notFound('提交')
    const found = this.state.commits.find((c) => itemKey(c.ref) === itemKey(ref))
    return found === undefined ? this.gate.notFound('提交') : cap.providerOk({ ref: found.ref, sha: found.sha, message: found.message })
  }

  async getChangeRequest(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderChangeRequest>> {
    const blocked = this.gate.blocked<cap.ProviderChangeRequest>()
    if (blocked !== undefined) return blocked
    if (!this.owns(ref)) return this.gate.notFound('变更请求')
    const found = this.state.changeRequests.find((c) => itemKey(c.ref) === itemKey(ref))
    return found === undefined ? this.gate.notFound('变更请求') : cap.providerOk(toChangeRequest(found))
  }

  async listChangeRequests(input: cap.ProviderListChangeRequestsInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderChangeRequest>>> {
    const blocked = this.gate.blocked<cap.ProviderPage<cap.ProviderChangeRequest>>()
    if (blocked !== undefined) return blocked
    if (this.knownRepository(input.repository) === undefined) return this.gate.notFound('仓库')
    const rows = this.state.changeRequests.filter((c) => itemKey(c.repository) === itemKey(input.repository)).sort(byExternalId)
    return cap.providerOk(paginate(rows.map(toChangeRequest), input))
  }

  async createBranch(input: cap.ProviderCreateBranchInput): Promise<cap.ProviderResult<cap.ProviderBranch>> {
    const blocked = this.gate.blocked<cap.ProviderBranch>()
    if (blocked !== undefined) return blocked
    // **能力判定先于身份判定**（port 契约）：未声明的能力对任何输入都答 not_supported，能力整体不存在时
    // 结论与输入无关；顺序反过来会让「能力没开 + 外来引用」答 not_found，把调用方引向错误的恢复动作。
    if (!this.flags.branchCreate) return this.gate.unsupported(cap.CapabilityKey.DevelopmentBranchCreate)
    if (this.knownRepository(input.repository) === undefined) return this.gate.notFound('仓库')
    if (this.faultsSwitch.isOn(FaultKind.AmbiguousCreate)) return this.gate.ambiguous('创建分支')
    if (this.branchOf(input.repository, input.name) !== undefined) return providerFail(ProviderErrorCode.Conflict, `分支已存在：${input.name}`)
    const record: FakeBranchRecord = {
      repository: input.repository, ref: refOf(this.gate.bindingId, EntityKind.Branch, input.name),
      name: input.name, headCommit: this.branchOf(input.repository, input.fromRef)?.headCommit,
    }
    this.state.branches.push(record)
    return cap.providerOk(toBranch(record))
  }

  async createWorktree(input: cap.ProviderCreateWorktreeInput): Promise<cap.ProviderResult<cap.ProviderWorktree>> {
    const blocked = this.gate.blocked<cap.ProviderWorktree>()
    if (blocked !== undefined) return blocked
    if (!this.flags.worktreeCreate) return this.gate.unsupported(cap.CapabilityKey.DevelopmentWorktreeCreate)
    if (this.knownRepository(input.repository) === undefined) return this.gate.notFound('仓库')
    if (this.faultsSwitch.isOn(FaultKind.AmbiguousCreate)) return this.gate.ambiguous('创建工作树')
    if (this.branchOf(input.repository, input.branch) === undefined) return this.gate.notFound('分支')
    const ref = refOf(this.gate.bindingId, EntityKind.Worktree, input.path)
    // 同一路径重复创建必须 conflict：静默复用会把两次"创建"折成同一条记录，调用方无法察觉第二次其实没生效。
    if (this.state.worktrees.some((w) => itemKey(w.ref) === itemKey(ref))) return providerFail(ProviderErrorCode.Conflict, `工作树路径已存在：${input.path}`)
    const record: FakeWorktreeRecord = {
      repository: input.repository, ref, path: input.path, branch: input.branch,
    }
    this.state.worktrees.push(record)
    return cap.providerOk({ ref: record.ref, path: record.path, branch: record.branch })
  }

  async getWorktree(input: cap.ProviderGetWorktreeInput): Promise<cap.ProviderResult<cap.ProviderWorktree>> {
    const blocked = this.gate.blocked<cap.ProviderWorktree>()
    if (blocked !== undefined) return blocked
    if (!this.flags.worktreeRead) return this.gate.unsupported(cap.CapabilityKey.DevelopmentWorktreeRead)
    if (!this.owns(input.worktree)) return this.gate.notFound('工作树')
    const found = this.state.worktrees.find((w) => itemKey(w.ref) === itemKey(input.worktree))
    return found === undefined
      ? this.gate.notFound('工作树')
      : cap.providerOk({ ref: found.ref, path: found.path, branch: found.branch })
  }

  async removeWorktree(input: cap.ProviderRemoveWorktreeInput): Promise<cap.ProviderResult<void>> {
    const blocked = this.gate.blocked<void>()
    if (blocked !== undefined) return blocked
    if (!this.flags.worktreeRemove) return this.gate.unsupported(cap.CapabilityKey.DevelopmentWorktreeRemove)
    if (!this.owns(input.worktree)) return this.gate.notFound('工作树')
    const index = this.state.worktrees.findIndex((w) => itemKey(w.ref) === itemKey(input.worktree))
    if (index === -1) return this.gate.notFound('工作树')
    // 移除必须真的把记录删掉：否则第二次移除会"成功"，而它其实什么都没做
    // （工作树已经不在，静默成功是最难发现的一类假绿）。
    this.state.worktrees.splice(index, 1)
    return cap.providerOk(undefined)
  }

  /** head 可以是分支名，也可以直接是提交 sha；sourceVersion 锚定头部提交，谱系由此原生可读。 */
  async createChangeRequest(input: cap.ProviderCreateChangeRequestInput): Promise<cap.ProviderResult<cap.ProviderChangeRequest>> {
    const blocked = this.gate.blocked<cap.ProviderChangeRequest>()
    if (blocked !== undefined) return blocked
    if (!this.flags.changeRequestCreate) return this.gate.unsupported(cap.CapabilityKey.DevelopmentChangeRequestCreate)
    if (this.knownRepository(input.repository) === undefined) return this.gate.notFound('仓库')
    if (this.faultsSwitch.isOn(FaultKind.AmbiguousCreate)) return this.gate.ambiguous('创建变更请求')
    const head = this.branchOf(input.repository, input.head)?.headCommit ?? input.head
    if (!this.state.commits.some((c) => c.sha === head)) return this.gate.notFound('头部提交')
    this.state.seq += 1
    const record: FakeChangeRequestRecord = {
      ref: refOf(this.gate.bindingId, EntityKind.ChangeRequest, `pr-${this.state.seq}`), repository: input.repository,
      number: this.state.seq, title: input.title, body: input.body, state: 'open', head: input.head, headCommit: head, sourceVersion: head,
    }
    this.state.changeRequests.push(record)
    // 反向谱系：提交记住自己属于哪个变更请求（AGENTS.md §1.1 不变量 6）。
    this.state.commits = this.state.commits.map((c) => (c.sha === head ? { ...c, changeRequest: record.ref } : c))
    return cap.providerOk(toChangeRequest(record))
  }
}

function toBranch(record: FakeBranchRecord): cap.ProviderBranch {
  return { ref: record.ref, name: record.name, headCommit: record.headCommit }
}
function toChangeRequest(record: FakeChangeRequestRecord): cap.ProviderChangeRequest {
  return {
    ref: record.ref, number: record.number, title: record.title, body: record.body,
    state: record.state, sourceVersion: record.sourceVersion,
  }
}

export function createFakeDevelopmentProvider(options: FakeDevelopmentProviderOptions = {}): FakeDevelopmentProvider {
  return new FakeDevelopmentProvider(options)
}
