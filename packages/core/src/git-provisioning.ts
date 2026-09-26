/**
 *
 */
import {
  CapabilityKey, ProjectErrorCode, projectError, type ExternalObjectRef, type ProjectError, type ResolvedBinding,
} from '@harness-projects/capabilities'
import { ExecutionContextStatus, ProviderErrorCode, type ExecutionContextId, type ProviderBindingId } from '@harness-projects/domain'
import { resolveWriteTarget, toProjectError, unsupportedCapability } from './capabilities.ts'
import type { CoreContext } from './context.ts'
import { StartWorkFallback, type StartOutcome, type StartWorkRequest } from './execution-context.ts'
import {
  beginWrite, confirmWrite, markFailed, markUnknown, markWriting, reconcileWrite, WritePhase,
  type ReconcileProbe, type WriteReport,
} from './write-machine.ts'

type Development = NonNullable<ResolvedBinding['development']>

interface Names { readonly branch: string; readonly path: string }
interface StepOutcome {
  readonly report: WriteReport; readonly ok: boolean; readonly value: string | undefined
  /** 被接管分支的头提交；只有分支步产得出它，工作树步为 undefined。 */
  readonly headCommit?: string | undefined
}

/** 补偿序列里 git 步骤的完整结果面；bindingId 同时用于写尝试账本的目标记录。 */
export interface GitOutcome {
  readonly contextId: ExecutionContextId
  readonly report: WriteReport
  readonly ok: boolean
  readonly bindingId: ProviderBindingId | undefined
  readonly status: ExecutionContextStatus
  readonly branchExternalId: string | undefined
  readonly worktreeExternalId: string | undefined
  /** 实际落地的分支头提交。接管一个既有分支时它是事实，不是可推导的值——所以要报出来。 */
  readonly branchHeadCommit: string | undefined
}

/**
 * 步骤回填钩子：每一步成功后由调用方落盘；默认 no-op，既有调用方不变。
 *
 * 钩子只决定**什么时候写**，写入本身仍然只有 `provision()` 一个调用方——provider 不落盘，
 * core 也不允许出现第二个写者。
 */
export type RecordStep = (outcome: GitOutcome) => Promise<void>

/** 归一化后的 slug；`undefined` 表示这个 id 归一化之后为空（退化输入）。 */
function slugOrUndefined(raw: string): string | undefined {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? undefined : cleaned
}

/** 谱系投影用的展示名：退化 id 用它兜底，只影响标签——写入路径由 `namesProblem` 拒绝。 */
function slug(raw: string): string {
  return slugOrUndefined(raw) ?? 'work-item'
}

/**
 * 写入路径的身份闸门（批次计划 D6）：`slug` 对退化输入会塌成共享字面量 `work-item`，
 * 于是两个不同的工作项共用同一个分支名——那是一个**可猜的身份**，与「名字即身份」冲突。
 * 返回拒绝原因；合法 id 返回 undefined。
 */
export function namesProblem(workItemId: string): string | undefined {
  if (typeof workItemId !== 'string' || workItemId.trim() === '') return '工作项 id 不能为空'
  return slugOrUndefined(workItemId) === undefined
    ? `工作项 id ${JSON.stringify(workItemId)} 归一化后为空，无法派生稳定的分支名与工作树路径`
    : undefined
}

/** 分支与工作树的默认命名：只由工作项 id 派生，不含任何本机路径；谱系投影复用同一权威。 */
export function branchNameFor(workItemId: string): string {
  return `work/${slug(workItemId)}`
}
export function worktreePathFor(workItemId: string): string {
  return `.worktrees/${slug(workItemId)}`
}

/** 分支名与工作树路径都可由调用方覆盖；默认值只由工作项 id 派生，不含任何本机路径。 */
export function namesFor(request: StartWorkRequest): Names {
  const path = request.worktreePath
  return {
    branch: request.branchName ?? branchNameFor(request.workItemId),
    path: path === undefined || path.trim() === '' ? worktreePathFor(request.workItemId) : path,
  }
}

function gitFailure(
  contextId: ExecutionContextId, report: WriteReport, bindingId: ProviderBindingId | undefined,
  branch: string | undefined, branchHeadCommit: string | undefined = undefined,
): GitOutcome {
  return {
    contextId, report, ok: false, bindingId, status: ExecutionContextStatus.Failed,
    branchExternalId: branch, worktreeExternalId: undefined, branchHeadCommit,
  }
}

export function outcomeOf(git: GitOutcome, fallback?: StartWorkFallback, runExternalId?: string): StartOutcome {
  return {
    contextId: git.contextId, status: git.status, branchExternalId: git.branchExternalId,
    worktreeExternalId: git.worktreeExternalId, branchHeadCommit: git.branchHeadCommit,
    fallback, runExternalId,
  }
}

/** 分步回填用的中间结果面：序列没走完，状态仍是 `Provisioning`，不得报 `Ready`。 */
function stepRecord(
  contextId: ExecutionContextId, report: WriteReport, bindingId: ProviderBindingId | undefined,
  branchExternalId: string | undefined, branchHeadCommit: string | undefined,
): GitOutcome {
  return {
    contextId, report, ok: true, bindingId, status: ExecutionContextStatus.Provisioning,
    branchExternalId, worktreeExternalId: undefined, branchHeadCommit,
  }
}

export async function provisionGit(
  context: CoreContext, request: StartWorkRequest, names: Names, contextId: ExecutionContextId,
  recordStep: RecordStep = async () => {},
): Promise<GitOutcome> {
  const target = resolveWriteTarget(context.registry, CapabilityKey.DevelopmentWorktreeCreate)
  const provider = target.binding?.development
  const bindingId = target.binding?.ref.bindingId
  if (target.binding === undefined || provider === undefined) {
    const error = target.error ?? unsupportedCapability(CapabilityKey.DevelopmentWorktreeCreate)
    return gitFailure(contextId, markFailed(beginWrite(names.path), error), bindingId, undefined)
  }
  const repository: ExternalObjectRef = {
    bindingId: target.binding.ref.bindingId, objectKind: 'repository', externalId: request.repositoryId, url: undefined,
  }
  // 恢复：上下文里已经记录了分支步的结果就**整个跳过它**——不解析 `fromRef`，因此「基线是否
  // 前进」不进入判定。分支名是身份，我们记录的那一行是所有权（批次计划 D1 / D2）。
  const recorded = await context.storage.getExecutionContext(contextId)
  const decided = recorded?.branchExternalId
  // 调用方在重放时声明一个**不同**的分支名是**矛盾**，不是新输入：序列已经决定了身份，静默采纳新名字
  // 会让「报出去的身份」与「磁盘上的事实」分叉——工作树落在新名字上、而 `branchExternalId` 报的是旧名字，
  // 与 PR #160 第二轮 P1 是同一形态。所以拒绝并点名两个名字，而不是忽略调用方的输入。
  if (decided !== undefined && request.branchName !== undefined && request.branchName !== decided) {
    const message = `本次请求声明的分支名 ${request.branchName} 与已经决定的分支身份 ${decided} 不一致：`
      + '重放不得改变已经决定的身份，请去掉 branchName 或另开一次供应'
    return gitFailure(
      contextId, markFailed(beginWrite(names.branch), projectError(ProjectErrorCode.InvalidInput, message)),
      bindingId, decided,
    )
  }
  const branch = decided === undefined
    ? await ensureBranch(provider, repository, names.branch)
    : {
      report: confirmWrite(markWriting(beginWrite(decided)), decided),
      ok: true, value: decided,
      headCommit: (await branchProbe(provider, repository, decided)).headCommit,
    }
  if (!branch.ok || branch.value === undefined) return gitFailure(contextId, branch.report, bindingId, undefined)
  // 分支步已经成功：立刻回填，然后才跑工作树步。中断在两步之间时，重放因此能跳过它。
  // 工作树步用的是**序列已经决定的分支**（`branch.value`），不是本次请求重新算出来的 `names.branch`：
  // 序列一旦决定了身份，后续每一步都必须用它，否则「报出去的」与「落盘的」会指向两个分支。
  // 工作树步本身**故意不跳过**——它必须重跑才能保证工作树真的在（PR #160 的 F1 教训）；幂等由稳定的
  // 实体身份提供，不由跳过提供。
  await recordStep(stepRecord(contextId, branch.report, bindingId, branch.value, branch.headCommit))
  const worktree = await ensureWorktree(provider, repository, branch.value, names.path)
  if (!worktree.ok || worktree.value === undefined) {
    return gitFailure(contextId, worktree.report, bindingId, branch.value, branch.headCommit)
  }
  const done: GitOutcome = {
    contextId, report: worktree.report, ok: true, bindingId, status: ExecutionContextStatus.Ready,
    branchExternalId: branch.value, worktreeExternalId: worktree.value, branchHeadCommit: branch.headCommit,
  }
  await recordStep(done)
  return done
}

async function ensureBranch(provider: Development, repository: ExternalObjectRef, name: string): Promise<StepOutcome> {
  if (provider.createBranch === undefined) {
    return { report: markFailed(beginWrite(name), unsupportedCapability(CapabilityKey.DevelopmentBranchCreate)), ok: false, value: undefined }
  }
  const base = await baseRef(provider, repository)
  if (!base.ok) return { report: markFailed(beginWrite(name), base.error), ok: false, value: undefined }
  const result = await provider.createBranch({ repository, name, fromRef: base.value })
  if (result.ok) {
    return { report: confirmWrite(markWriting(beginWrite(name)), name), ok: true, value: name, headCommit: result.value.headCommit }
  }
  const error = toProjectError(result.error)
  if (result.error.code === ProviderErrorCode.Conflict) {
    const found = await branchProbe(provider, repository, name)
    if (found.probe.found) {
      return { report: confirmWrite(markWriting(beginWrite(name)), name), ok: true, value: name, headCommit: found.headCommit }
    }
  }
  if (result.error.code !== ProviderErrorCode.AmbiguousResult) {
    return { report: markFailed(beginWrite(name), error), ok: false, value: undefined }
  }
  const probed = await branchProbe(provider, repository, name)
  const report = reconcileWrite(markUnknown(markWriting(beginWrite(name)), error), probed.probe)
  const reconciled = report.phase === WritePhase.Reconciled
  return { report, ok: reconciled, value: reconciled ? name : undefined, headCommit: probed.headCommit }
}

async function ensureWorktree(
  provider: Development, repository: ExternalObjectRef, branch: string, path: string,
): Promise<StepOutcome> {
  if (provider.createWorktree === undefined) {
    return { report: markFailed(beginWrite(path), unsupportedCapability(CapabilityKey.DevelopmentWorktreeCreate)), ok: false, value: undefined }
  }
  const result = await provider.createWorktree({ repository, path, branch })
  if (!result.ok) {
    if (result.error.code === ProviderErrorCode.Conflict) {
      if (provider.getWorktree === undefined) {
        return { report: markFailed(beginWrite(path), projectError(ProjectErrorCode.NotSupported, '工作树冲突无法在当前 provider 上确认')), ok: false, value: undefined }
      }
      const ref = { bindingId: repository.bindingId, objectKind: 'worktree', externalId: path, url: undefined }
      const observed = await provider.getWorktree({ worktree: ref })
      if (observed.ok && observed.value.branch === branch) {
        return { report: confirmWrite(markWriting(beginWrite(path)), observed.value.path), ok: true, value: observed.value.path }
      }
      return { report: markFailed(beginWrite(path), observed.ok ? projectError(ProjectErrorCode.Conflict, '工作树冲突但分支不匹配') : toProjectError(observed.error)), ok: false, value: undefined }
    }
    return { report: markFailed(beginWrite(path), toProjectError(result.error)), ok: false, value: undefined }
  }
  return { report: confirmWrite(markWriting(beginWrite(path)), result.value.path), ok: true, value: result.value.path }
}

/** 基线分支读不到不是致命错误：用约定名继续，创建失败会得到结构化结果。 */
async function baseRef(provider: Development, repository: ExternalObjectRef): Promise<{ readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: ProjectError }> {
  const found = await provider.getRepository(repository)
  if (!found.ok) return { ok: false, error: toProjectError(found.error) }
  if (found.value.defaultBranch !== undefined && found.value.defaultBranch !== '') {
    return { ok: true, value: found.value.defaultBranch }
  }
  return {
    ok: false,
    error: projectError(ProjectErrorCode.NotFound, '无法确定仓库基线；请在 provider binding 注入 defaultBranch，或提供 origin/HEAD、唯一本地分支或约定分支'),
  }
}

interface BranchProbe { readonly probe: ReconcileProbe; readonly headCommit: string | undefined }

async function branchProbe(provider: Development, repository: ExternalObjectRef, name: string): Promise<BranchProbe> {
  const page = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
  if (!page.ok) return { probe: { found: false, value: undefined, error: toProjectError(page.error) }, headCommit: undefined }
  const found = page.value.items.find((item) => item.name === name)
  return {
    probe: { found: found !== undefined, value: found?.name, error: undefined },
    headCommit: found?.headCommit,
  }
}
