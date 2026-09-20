/**
 *
 */
import {
  CapabilityKey, type ExternalObjectRef, type ResolvedBinding,
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
interface StepOutcome { readonly report: WriteReport; readonly ok: boolean; readonly value: string | undefined }

/** 补偿序列里 git 步骤的完整结果面；bindingId 同时用于写尝试账本的目标记录。 */
export interface GitOutcome {
  readonly contextId: ExecutionContextId
  readonly report: WriteReport
  readonly ok: boolean
  readonly bindingId: ProviderBindingId | undefined
  readonly status: ExecutionContextStatus
  readonly branchExternalId: string | undefined
  readonly worktreeExternalId: string | undefined
}

function slug(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'work-item' : cleaned
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
  contextId: ExecutionContextId, report: WriteReport, bindingId: ProviderBindingId | undefined, branch: string | undefined,
): GitOutcome {
  return {
    contextId, report, ok: false, bindingId, status: ExecutionContextStatus.Failed,
    branchExternalId: branch, worktreeExternalId: undefined,
  }
}

export function outcomeOf(git: GitOutcome, fallback?: StartWorkFallback, runExternalId?: string): StartOutcome {
  return {
    contextId: git.contextId, status: git.status, branchExternalId: git.branchExternalId,
    worktreeExternalId: git.worktreeExternalId, fallback, runExternalId,
  }
}

export async function provisionGit(
  context: CoreContext, request: StartWorkRequest, names: Names, contextId: ExecutionContextId,
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
  const branch = await ensureBranch(provider, repository, names.branch)
  if (!branch.ok || branch.value === undefined) return gitFailure(contextId, branch.report, bindingId, undefined)
  const worktree = await ensureWorktree(provider, repository, names.branch, names.path)
  if (!worktree.ok || worktree.value === undefined) return gitFailure(contextId, worktree.report, bindingId, branch.value)
  return {
    contextId, report: worktree.report, ok: true, bindingId, status: ExecutionContextStatus.Ready,
    branchExternalId: branch.value, worktreeExternalId: worktree.value,
  }
}

async function ensureBranch(provider: Development, repository: ExternalObjectRef, name: string): Promise<StepOutcome> {
  if (provider.createBranch === undefined) {
    return { report: markFailed(beginWrite(name), unsupportedCapability(CapabilityKey.DevelopmentBranchCreate)), ok: false, value: undefined }
  }
  const result = await provider.createBranch({ repository, name, fromRef: await baseRef(provider, repository) })
  if (result.ok) return { report: confirmWrite(markWriting(beginWrite(name)), name), ok: true, value: name }
  const error = toProjectError(result.error)
  if (result.error.code === ProviderErrorCode.Conflict) {
    const found = await branchProbe(provider, repository, name)
    if (found.found) return { report: confirmWrite(markWriting(beginWrite(name)), name), ok: true, value: name }
  }
  if (result.error.code !== ProviderErrorCode.AmbiguousResult) {
    return { report: markFailed(beginWrite(name), error), ok: false, value: undefined }
  }
  const report = reconcileWrite(markUnknown(markWriting(beginWrite(name)), error), await branchProbe(provider, repository, name))
  const reconciled = report.phase === WritePhase.Reconciled
  return { report, ok: reconciled, value: reconciled ? name : undefined }
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
      return { report: confirmWrite(markWriting(beginWrite(path)), path), ok: true, value: path }
    }
    return { report: markFailed(beginWrite(path), toProjectError(result.error)), ok: false, value: undefined }
  }
  return { report: confirmWrite(markWriting(beginWrite(path)), result.value.path), ok: true, value: result.value.path }
}

/** 基线分支读不到不是致命错误：用约定名继续，创建失败会得到结构化结果。 */
async function baseRef(provider: Development, repository: ExternalObjectRef): Promise<string> {
  const found = await provider.getRepository(repository)
  return found.ok ? found.value.defaultBranch ?? 'main' : 'main'
}

async function branchProbe(provider: Development, repository: ExternalObjectRef, name: string): Promise<ReconcileProbe> {
  const page = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
  if (!page.ok) return { found: false, value: undefined, error: toProjectError(page.error) }
  const found = page.value.items.find((item) => item.name === name)
  return { found: found !== undefined, value: found?.name, error: undefined }
}
