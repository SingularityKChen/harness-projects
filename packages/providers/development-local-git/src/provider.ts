/** 本地 Git 只声明仓库读、分支建、工作树建：没有远端，不伪造变更请求；写未知失败为 ambiguous_result，
 * 读未知失败为 unavailable；一实例一仓库以保持引用归属明确。变更请求方法仍存在但返回 not_supported。
 * 工作树移除是破坏性操作，不在本层（issue #137 的 Out of scope、issue #138 交付），所以本 provider
 * 既不实现 `removeWorktree` 也不声明 `development.worktree.remove`。 */
import path from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'

import * as cap from '@harness-projects/capabilities'
import { ProviderErrorCode, newProviderBindingId, type ProviderBindingId } from '@harness-projects/domain'

import { branchNameProblem } from './branch-names.ts'
import { defaultGitRunner, type GitInvocation, type GitRunner } from './git-runner.ts'
import { resolveWorktreePath } from './paths.ts'

export interface LocalGitRepositoryConfig {
  readonly externalId: string; readonly path: string; readonly name?: string; readonly defaultBranch?: string
}

export interface LocalGitCapabilityFlags {
  readonly branchCreate?: boolean; readonly worktreeCreate?: boolean; readonly worktreeRead?: boolean
}
export interface LocalGitDevelopmentProviderOptions {
  readonly bindingId?: ProviderBindingId
  readonly repository: LocalGitRepositoryConfig
  readonly allowedRoot?: string
  readonly capabilities?: LocalGitCapabilityFlags
  readonly runGit?: GitRunner
  readonly observedAt?: string
}
interface WorktreeRecord {
  readonly path: string; readonly branch: string | undefined; readonly prunable: boolean
}
interface BranchRecord {
  readonly name: string; readonly sha: string; readonly symbolic: boolean
}
const REFUSALS: readonly (readonly [RegExp, ProviderErrorCode, string])[] = [
  [/cannot change to /i, ProviderErrorCode.Unavailable, 'Git 仓库目录暂时不可达'], // 先于 not_found：`git -C` 进不去仓库根是「此刻读不到」，不是「对象不存在」
  [/not a git repository|unknown revision|bad revision|needed a single revision|not a valid object name|could not get object info|does not exist|no such (file|branch|ref|remote)|ambiguous argument|invalid refspec|is not a working tree|is not a symbolic ref/i, ProviderErrorCode.NotFound, 'Git 找不到目标'],
  [/cannot lock ref .*cannot create|a branch named .* already exists|not a valid branch name|invalid branch name|not a valid ref/i, ProviderErrorCode.InvalidInput, 'Git 拒绝的引用名'],
  [/already exists|already used by worktree|is already checked out|could not create leading directories|not a directory/i, ProviderErrorCode.InvalidInput, 'Git 拒绝了工作树操作'],
  [/permission denied|operation not permitted|eacces/i, ProviderErrorCode.PermissionDenied, 'Git 没有权限'],
  [/index\.lock|another git process|resource temporarily unavailable|eagain/i, ProviderErrorCode.Unavailable, 'Git 暂时不可用'],
]
const CONVENTIONAL_BASES: readonly string[] = ['main', 'master', 'develop', 'trunk']
async function occupied(target: string): Promise<boolean> {
  return stat(target).then(() => true, () => false)
}
const samePath = async (left: string, right: string): Promise<boolean> =>
  (await realpath(left).catch(() => left)) === (await realpath(right).catch(() => right))
type TargetResolution = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string }
const statOf = (target: string) => stat(target).catch(() => undefined)
/** 与 `is_git_directory` 同口径的 Git 目录判定：`HEAD` 文件 + `objects/` + `refs/`。 */
const isGitDirectory = async (dir: string) => {
  const [head, objects, refs] = await Promise.all(['HEAD', 'objects', 'refs'].map((name) => statOf(path.join(dir, name))))
  return head?.isFile() === true && objects?.isDirectory() === true && refs?.isDirectory() === true
}
/** Git 认得的检出标记：`.git` 是 Git 目录，或是以 `gitdir:` 开头的 gitfile；空 `.git/`、杂项文件 Git 自己也不认。 */
const hasGitMarker = async (dir: string) => {
  const marker = path.join(dir, '.git')
  const info = await statOf(marker)
  if (info?.isDirectory() === true) return isGitDirectory(marker)
  return info?.isFile() === true && (await readFile(marker, 'utf8').catch(() => '')).startsWith('gitdir:')
}
/** 默认根 `<checkout>.worktrees` 只给**独立检出**派生，只做文件系统探测：从 `repository.path` 的 realpath 起逐级先找
 *  Git 认得的 `.git`、再看目录本身是不是 bare Git 目录（Git 仓库发现的同一顺序）。仓库目录缺席时不向上借用外层检出；
 *  bare、找不到检出、检出位于另一个 Git 检出之内（submodule、嵌套仓库、dotfiles `$HOME` 下的仓库、另一检出里的链接
 *  工作树）时兄弟目录会落进别人的检出或无处可放，一律 fail closed，由宿主显式注入 `allowedRoot`（#132）。 */
async function deriveDefaultRoot(repositoryPath: string): Promise<TargetResolution> {
  const refuse = (why: string): TargetResolution => ({ ok: false, code: ProviderErrorCode.InvalidInput, message: `${why}，拒绝派生默认工作树根；请显式注入 allowedRoot（宿主注入入口见 #132）` })
  const start = await realpath(repositoryPath).catch(() => undefined)
  if (start === undefined || (await statOf(start))?.isDirectory() !== true) {
    return { ok: false, code: ProviderErrorCode.Unavailable, message: `仓库目录暂时不可达：${repositoryPath}；不借用外层检出派生默认工作树根` }
  }
  let checkout = start
  while (!(await hasGitMarker(checkout))) {
    if (await isGitDirectory(checkout)) return refuse(`${checkout} 是没有工作区的 bare 仓库`)
    if (path.dirname(checkout) === checkout) return refuse(`${start} 之上找不到 Git checkout 根`)
    checkout = path.dirname(checkout)
  }
  for (let outer = path.dirname(checkout); ; outer = path.dirname(outer)) {
    if (await hasGitMarker(outer)) return refuse(`检出 ${checkout} 位于另一个 Git 检出 ${outer} 之内，兄弟目录会落进外层检出`)
    if (path.dirname(outer) === outer) break
  }
  return { ok: true, path: path.join(path.dirname(checkout), `${path.basename(checkout)}.worktrees`) }
}
/** 本地 Git 的静态连接实现定义：单域实现族，key 由本实现作者声明。 */
export const LOCAL_GIT_PROVIDER_DEFINITION: cap.ProviderDefinition = Object.freeze({
  implementationKey: 'development.local-git', domains: Object.freeze(['development'] as const),
})
export class LocalGitDevelopmentProvider implements cap.DevelopmentProvider {
  readonly definition = LOCAL_GIT_PROVIDER_DEFINITION
  readonly bindingId: ProviderBindingId
  readonly repository: LocalGitRepositoryConfig
  /** Explicit host-injected root only; undefined means derive from the real checkout marker. */
  readonly allowedRoot: string | undefined
  readonly flags: Required<LocalGitCapabilityFlags>
  readonly observedAt: string
  private readonly runGit: GitRunner
  constructor(options: LocalGitDevelopmentProviderOptions) {
    this.bindingId = options.bindingId ?? newProviderBindingId()
    this.repository = options.repository
    this.allowedRoot = options.allowedRoot
    this.flags = {
    branchCreate: options.capabilities?.branchCreate ?? true,
    worktreeCreate: options.capabilities?.worktreeCreate ?? true,
      worktreeRead: options.capabilities?.worktreeRead ?? true,
    }
    this.runGit = options.runGit ?? defaultGitRunner
    this.observedAt = options.observedAt ?? new Date().toISOString()
  }
  describeCapabilities(): Promise<cap.ProviderCapabilitySnapshot> {
    const available = cap.AccessLevel.Available
    const capability: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {
      [cap.CapabilityKey.DevelopmentRepositoryRead]: available,
      ...(this.flags.branchCreate ? { [cap.CapabilityKey.DevelopmentBranchCreate]: available } : {}),
      ...(this.flags.worktreeCreate ? { [cap.CapabilityKey.DevelopmentWorktreeCreate]: available } : {}),
      ...(this.flags.worktreeRead ? { [cap.CapabilityKey.DevelopmentWorktreeRead]: available } : {}),
    }
    return Promise.resolve({ bindingId: this.bindingId, capability, permission: capability, observedAt: this.observedAt })
  }
  async getRepository(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderRepository>> {
    if (!this.ownsRepository(ref)) return this.notFound('仓库')
    const probe = await this.git(['rev-parse', '--git-dir'])
    if (probe.code !== 0) return cap.providerErr(this.failureOf(probe, false))
    const branch = this.repository.defaultBranch === undefined ? await this.baseBranch() : { value: this.repository.defaultBranch, error: undefined }
    if (branch.error !== undefined) return cap.providerErr(branch.error)
    return cap.providerOk({
      ref, name: this.repository.name ?? path.basename(this.repository.path),
      defaultBranch: branch.value === '' || branch.value === 'HEAD' ? undefined : branch.value, sourceUpdatedAt: undefined,
    })
  }
  private async baseBranch(): Promise<{ readonly value: string | undefined; readonly error: cap.ProviderError | undefined }> {
    const remote = await this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    if (remote.code === 0) return { value: remote.stdout.trim().replace(/^origin\//, ''), error: undefined }
    const remoteError = this.failureOf(remote, false)
    if (remoteError.code !== ProviderErrorCode.NotFound) return { value: undefined, error: remoteError }
    const records = await this.branchRecords()
    if (records.error !== undefined) return { value: undefined, error: records.error }
    const names = records.records.map((record) => record.name)
    if (names.length === 1) return { value: names[0], error: undefined }
    const configured = await this.git(['config', '--get', 'init.defaultBranch'])
    const guess = configured.code === 0 ? configured.stdout.trim() : ''
    if (guess !== '' && names.includes(guess)) return { value: guess, error: undefined }
    return { value: CONVENTIONAL_BASES.find((name) => names.includes(name)), error: undefined }
  }
  async listBranches(input: cap.ProviderListBranchesInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderBranch>>> {
    if (!this.ownsRepository(input.repository)) return this.notFound('仓库')
    const listed = await this.branchRecords()
    if (listed.error !== undefined) return cap.providerErr(listed.error)
    const rows = listed.records
      .map((record) => ({ ref: this.refOf('branch', record.name), name: record.name, headCommit: record.sha }))
      .sort((a, b) => (a.ref.externalId < b.ref.externalId ? -1 : 1))
    const offset = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10)
    const start = Number.isNaN(offset) || offset < 0 ? 0 : offset
    const next = start + Math.max(1, input.limit)
    return cap.providerOk({ items: rows.slice(start, next), nextCursor: next < rows.length ? String(next) : undefined })
  }
  async getCommit(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderCommit>> {
    if (ref.bindingId !== this.bindingId || ref.objectKind !== 'commit') return this.notFound('提交')
    if (!/^[0-9a-f]{7,64}$/i.test(ref.externalId)) return this.invalidInput(`提交引用必须是对象名：${ref.externalId}`)
    const resolved = await this.probeRef(ref.externalId)
    if (resolved.error !== undefined) return cap.providerErr(resolved.error)
    if (!resolved.found || resolved.sha === undefined || !resolved.sha.toLowerCase().startsWith(ref.externalId.toLowerCase())) return this.notFound('提交')
    const log = await this.git(['log', '-1', '--format=%s', resolved.sha])
    if (log.code !== 0) return cap.providerErr(this.failureOf(log, false))
    const message = log.stdout.trim()
    return cap.providerOk({ ref: this.refOf('commit', resolved.sha), sha: resolved.sha, message: message === '' ? undefined : message })
  }

  /** 本地 Git 没有远端对象：能力整体不存在，所以对任何输入都回答 not_supported（先于身份闸门）。 */
  async getChangeRequest(_ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderChangeRequest>> {
    return this.notSupported(cap.CapabilityKey.DevelopmentChangeRequestRead)
  }
  async listChangeRequests(_input: cap.ProviderListChangeRequestsInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderChangeRequest>>> {
    return this.notSupported(cap.CapabilityKey.DevelopmentChangeRequestRead)
  }

  async createBranch(input: cap.ProviderCreateBranchInput): Promise<cap.ProviderResult<cap.ProviderBranch>> {
    if (!this.flags.branchCreate) return this.notSupported(cap.CapabilityKey.DevelopmentBranchCreate)
    if (!this.ownsRepository(input.repository)) return this.notFound('仓库')
    const problem = branchNameProblem(input.name)
    if (problem !== undefined) return this.invalidInput(problem)
    const start = await this.probeRef(input.fromRef)
    if (start.error !== undefined) return cap.providerErr(start.error)
    if (!start.found || start.sha === undefined) return this.notFound(`起点 ${input.fromRef}`)
    const listed = await this.branchRecords()
    if (listed.error !== undefined) return cap.providerErr(listed.error)
    // 大小写折叠比较的是**全部**既有分支名：松散引用时 git 自己会拒绝变体，`pack-refs` 之后却会接受
    // （第四轮 P2 实测），只查 `refs/heads/<name>` 也拦不住打包形态。身份必须跨文件系统可移植，一律硬失败。
    const folded = input.name.toLowerCase()
    const variant = listed.records.find((record) => record.name !== input.name && record.name.toLowerCase() === folded)
    if (variant !== undefined) {
      return this.invalidInput(`分支 ${input.name} 与既有分支 ${variant.name} 只差大小写，会让两份工作树共用同一条底层引用；请更换分支名`)
    }
    const existing = listed.records.find((record) => record.name === input.name)
    if (existing?.symbolic === true) return this.invalidInput(`分支 ${input.name} 是符号引用，不是可复用的分支身份`)
    // 同名分支只在它指向请求声明的起点时才复用；报 conflict 会让 core 的 ensureBranch 静默复用它。
    if (existing !== undefined && existing.sha === start.sha) {
      return cap.providerOk({ ref: this.refOf('branch', input.name), name: input.name, headCommit: existing.sha })
    }
    if (existing !== undefined) {
      return this.invalidInput(`分支 ${input.name} 已存在且指向 ${existing.sha}，与请求起点 ${start.sha} 不一致；请更换分支名或更新请求起点`)
    }
    const created = await this.git(['branch', input.name, start.sha])
    if (created.code !== 0) return cap.providerErr(this.failureOf(created, true))
    // 写入后按精确名回读：报成功之前必须确认磁盘上真有一条**精确等于请求名**、指向请求起点的引用。
    const reread = await this.branchRef(input.name)
    if (reread.error !== undefined) return cap.providerErr(reread.error)
    if (!reread.found || reread.sha !== start.sha) {
      return this.fail(ProviderErrorCode.AmbiguousResult, `分支 ${input.name} 的写入结果不确定：请 reconcile 后再决定是否重试`)
    }
    return cap.providerOk({ ref: this.refOf('branch', input.name), name: input.name, headCommit: start.sha })
  }

  async preflightWorktree(input: cap.ProviderCreateWorktreeInput): Promise<cap.ProviderResult<{ readonly path: string }>> {
    if (!this.flags.worktreeCreate) return this.notSupported(cap.CapabilityKey.DevelopmentWorktreeCreate)
    if (!this.ownsRepository(input.repository)) return this.notFound('仓库')
    const resolved = await this.resolveInputTarget(input)
    if (!resolved.ok) return this.fail(resolved.code, resolved.message)
    return cap.providerOk({ path: resolved.path })
  }

  async createWorktree(input: cap.ProviderCreateWorktreeInput): Promise<cap.ProviderResult<cap.ProviderWorktree>> {
    if (!this.flags.worktreeCreate) return this.notSupported(cap.CapabilityKey.DevelopmentWorktreeCreate)
    if (!this.ownsRepository(input.repository)) return this.notFound('仓库')
    const problem = branchNameProblem(input.branch)
    if (problem !== undefined) return this.invalidInput(problem)
    // 路径安全在**任何 Git 命令之前**：下面只做文件系统探测（stat / realpath），不调用 Git。
    const resolved = await this.resolveInputTarget(input)
    if (!resolved.ok) return this.fail(resolved.code, resolved.message)
    const target = resolved.path
    const branch = await this.branchRef(input.branch)
    if (branch.error !== undefined) return cap.providerErr(branch.error)
    if (!branch.found) return this.notFound('分支')
    if (branch.symbolic) return this.invalidInput(`分支 ${input.branch} 是符号引用，不是可复用的分支身份`)
    const registered = await this.listWorktrees()
    if (registered.error !== undefined) return cap.providerErr(registered.error)
    // 分支已被别处检出时没有可复用对象；core 把任意 Conflict 当"已创建 → 复用成功"，这一支必须硬失败。
    const holder = registered.records.find((r) => r.path !== target && r.branch === `refs/heads/${input.branch}`)
    if (holder !== undefined) return this.invalidInput(`分支 ${input.branch} 已被另一份工作树检出：${holder.path}；请更换分支名或先移除那处登记`)
    const entry = registered.records.find((record) => record.path === target)
    if (entry !== undefined) {
      if (entry.prunable || !(await occupied(target))) {
        return this.invalidInput(`工作树登记仍在但目录不可复用：${target}；请先执行 git worktree prune`)
      }
      if (entry.branch !== `refs/heads/${input.branch}`) {
        return this.invalidInput(`工作树路径已登记但检出分支不是 ${input.branch}：${target}；请更换路径或先移除登记`)
      }
      const blocked = await this.reuseBlockedBy(target, input.branch)
      if (blocked !== undefined) return this.invalidInput(`工作树登记不可复用：${target}；${blocked}`)
      return this.fail(ProviderErrorCode.Conflict, `工作树路径已登记且与分支 ${input.branch} 一致：${target}`)
    }
    if (await occupied(target)) return this.invalidInput(`路径已存在但不是工作树：${target}；请更换路径`)
    const added = await this.git(['worktree', 'add', target, input.branch])
    if (added.code !== 0) return cap.providerErr(this.failureOf(added, true))
    // 判定与写入之间目标可以被换掉（TOCTOU）：报成功前回读登记，报告的必须是写入**之后**的事实
    // （AGENTS.md §1.1）。窗口本身按 D19 接受，但"接受窗口"不等于"可以报告判定时的路径"。
    const landed = await this.listWorktrees()
    if (landed.error !== undefined) return cap.providerErr(landed.error)
    const here = await Promise.all(landed.records.map((record) => samePath(record.path, target)))
    if (!here.some(Boolean)) {
      return this.fail(ProviderErrorCode.AmbiguousResult, `工作树写入结果不确定：登记里没有 ${target}，请 reconcile 后再决定是否重试`)
    }
    return cap.providerOk({ ref: this.refOf('worktree', target), path: target, branch: input.branch })
  }

  async getWorktree(input: cap.ProviderGetWorktreeInput): Promise<cap.ProviderResult<cap.ProviderWorktree>> {
    if (!this.flags.worktreeRead) return this.notSupported(cap.CapabilityKey.DevelopmentWorktreeRead)
    if (input.worktree.bindingId !== this.bindingId || input.worktree.objectKind !== 'worktree') return this.notFound('工作树')
    const resolved = await this.resolveTarget(input.worktree.externalId)
    if (!resolved.ok) return this.fail(resolved.code, resolved.message)
    const listed = await this.listWorktrees()
    if (listed.error !== undefined) return cap.providerErr(listed.error)
    const target = listed.records.find((record) => record.path === resolved.path || record.path === input.worktree.externalId)
    if (target === undefined || target.prunable || !(await occupied(target.path)) || target.branch === undefined) return this.notFound('工作树')
    return cap.providerOk({ ref: input.worktree, path: target.path, branch: target.branch.replace(/^refs\/heads\//, '') })
  }

  private async git(args: readonly string[]): Promise<GitInvocation> {
    return this.runGit(['-C', this.repository.path, ...args])
  }

  private failureOf(result: GitInvocation, write: boolean): cap.ProviderError {
    const text = `${result.stderr}\n${result.stdout}`
    const lines = (result.stderr === '' ? result.stdout : result.stderr).split('\n').map((line) => line.trim()).filter((line) => line !== '')
    // `worktree add` 的第一行是 `Preparing worktree (…)`，真正的原因在后面的 `fatal:` / `error:` 行。
    const detail = lines.find((line) => /\b(fatal|error):/i.test(line)) ?? lines[0] ?? ''
    const refusal = REFUSALS.find(([pattern]) => pattern.test(text))
    if (refusal !== undefined) return cap.providerError(refusal[1], `${refusal[2]}：${detail}`)
    return write
      ? cap.providerError(ProviderErrorCode.AmbiguousResult, `Git 写命令结果不确定：${detail}`)
      : cap.providerError(ProviderErrorCode.Unavailable, `Git 读命令失败：${detail}`)
  }

  private async probeRef(ref: string): Promise<{ found: boolean; sha: string | undefined; error: cap.ProviderError | undefined }> {
    const missing = { found: false, sha: undefined, error: undefined }
    // `--end-of-options` 是 git 对「名字来自不可信来源」的推荐写法：以 `-` 开头的 ref 因此只会被当成
    // revision 解析并答 not_found，不会被解释成 rev-parse 的选项（`^{commit}` 后缀只是偶然挡住它）。
    const result = await this.git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
    if (result.code !== 0) {
      const error = this.failureOf(result, false)
      return error.code === ProviderErrorCode.NotFound ? missing : { ...missing, error }
    }
    const sha = result.stdout.trim()
    return sha === '' ? missing : { found: true, sha, error: undefined }
  }

  private async listWorktrees(): Promise<{ records: readonly WorktreeRecord[]; error: cap.ProviderError | undefined }> {
    const listed = await this.git(['worktree', 'list', '--porcelain', '-z'])
    if (listed.code !== 0) return { records: [], error: this.failureOf(listed, false) }
    const records = listed.stdout.split('\0\0').flatMap((block) => {
      const fields = block.split('\0').filter(Boolean)
      const worktree = fields.find((line) => line.startsWith('worktree '))
      if (worktree === undefined) return []
      const fieldOf = (prefix: string) => fields.find((line) => line.startsWith(prefix))?.slice(prefix.length)
      // prunable 字段总是带原因（`prunable gitdir file points to non-existent location`），只能按前缀判。
      return [{ path: worktree.slice('worktree '.length), branch: fieldOf('branch '), prunable: fields.some((line) => line.startsWith('prunable')) }]
    })
    return { records, error: undefined }
  }

  /** 分支身份的唯一权威：一次枚举 `refs/heads` 的全部记录，`listBranches`、精确查找、大小写变体判定与
   *  写入后回读都从这一处派生（同一事实只有一个来源）。格式必须用 `%(refname:lstrip=2)`：`:short` 在
   *  同名标签存在时会给出 `heads/<name>`；`rev-parse` 在大小写不敏感文件系统上会把变体解析成既有分支。 */
  private async branchRecords(): Promise<{ records: readonly BranchRecord[]; error: cap.ProviderError | undefined }> {
    const listed = await this.git(['for-each-ref', '--format=%(refname:lstrip=2)%09%(objectname)%09%(symref)', 'refs/heads'])
    if (listed.code !== 0) return { records: [], error: this.failureOf(listed, false) }
    const records = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const [name = '', sha = '', symref = ''] = line.split('\t')
        return { name, sha, symbolic: symref !== '' }
      })
      .filter((record) => record.name !== '' && record.sha !== '')
    return { records, error: undefined }
  }

  /** 按**精确名**查找一条分支记录；`found: false` 与"读失败"分开返回，调用方不把平台错误当"不存在"。 */
  private async branchRef(name: string): Promise<{ found: boolean; sha: string | undefined; symbolic: boolean; error: cap.ProviderError | undefined }> {
    const listed = await this.branchRecords()
    if (listed.error !== undefined) return { found: false, sha: undefined, symbolic: false, error: listed.error }
    const found = listed.records.find((record) => record.name === name)
    if (found === undefined) return { found: false, sha: undefined, symbolic: false, error: undefined }
    return { found: true, sha: found.sha, symbolic: found.symbolic, error: undefined }
  }

  /** 正面确认「这个目录就是本仓库的链接工作树、且检出的正是请求的分支」：core 把 `conflict` 当
   *  「已创建 → 复用成功」，而登记记录只说明 git 的账本里有一条。返回 undefined 表示可以安全复用。 */
  private async reuseBlockedBy(target: string, branch: string): Promise<string | undefined> {
    const probe = await this.runGit(['-C', target, 'rev-parse', '--git-dir', '--git-common-dir', '--symbolic-full-name', 'HEAD'])
    if (probe.code !== 0) return '目录不是可读的 Git 工作树'
    const [gitDir = '', commonDir = '', head = ''] = probe.stdout.trim().split('\n')
    const mine = await this.git(['rev-parse', '--git-common-dir'])
    if (mine.code !== 0) return '读不到本仓库的 Git 目录'
    const at = (value: string) => path.resolve(target, value)
    if (!(await samePath(at(commonDir), path.resolve(this.repository.path, mine.stdout.trim())))) return '目录不是本仓库的工作树'
    if (await samePath(at(gitDir), at(commonDir))) return '目录是主检出，不是链接工作树'
    return head === `refs/heads/${branch}` ? undefined : `目录检出的分支不是 ${branch}`
  }

  /** 默认根每次重新判定、不缓存：标记会随 `git init`、submodule 初始化出现或消失，缓存会把首次调用的结论固化。 */
  private async allowedRootForUse(): Promise<TargetResolution> {
    return this.allowedRoot === undefined ? deriveDefaultRoot(this.repository.path) : { ok: true, path: this.allowedRoot }
  }

  private async resolveTarget(rawPath: string | undefined, worktreeKey = ''): Promise<TargetResolution> {
    // 允许根是否落在检出内由 paths.ts 判定：检出内的分量不得是符号链接（仓库内容不可信），注入检出外由宿主负责。
    const root = await this.allowedRootForUse()
    if (!root.ok) return root
    const resolved = await resolveWorktreePath(rawPath ?? path.join(root.path, worktreeKey), { repositoryPath: this.repository.path, allowedRoot: root.path })
    return resolved.ok ? resolved : { ok: false, code: ProviderErrorCode.InvalidInput, message: resolved.message }
  }

  private async resolveInputTarget(input: cap.ProviderCreateWorktreeInput): Promise<TargetResolution> {
    const worktreeKey = input.worktreeKey ?? (input.path === undefined ? '' : path.basename(input.path))
    const invalid = (message: string): TargetResolution => ({ ok: false, code: ProviderErrorCode.InvalidInput, message })
    if (typeof worktreeKey !== 'string' || worktreeKey.trim() === '' || worktreeKey !== worktreeKey.trim()) return invalid('工作树 key 不能为空或带首尾空白')
    if (/[/\\]|\.\.|[\u0000-\u001f\u007f]/.test(worktreeKey)) return invalid('工作树 key 不得包含路径分隔符、.. 或控制字符')
    return this.resolveTarget(input.path, worktreeKey)
  }

  private ownsRepository(ref: cap.ExternalObjectRef): boolean {
    return ref.bindingId === this.bindingId
      && ref.objectKind === 'repository'
      && ref.externalId === this.repository.externalId
  }

  private refOf(objectKind: string, externalId: string): cap.ExternalObjectRef {
    return { bindingId: this.bindingId, objectKind, externalId, url: undefined }
  }

  private fail<T>(code: ProviderErrorCode, message: string): cap.ProviderResult<T> {
    return cap.providerErr(cap.providerError(code, message))
  }

  private notFound<T>(what: string): cap.ProviderResult<T> { return this.fail(ProviderErrorCode.NotFound, `${what}不存在`) }
  private notSupported<T>(key: cap.CapabilityKey): cap.ProviderResult<T> { return this.fail(ProviderErrorCode.NotSupported, `未启用的能力：${key}`) }
  private invalidInput<T>(message: string): cap.ProviderResult<T> { return this.fail(ProviderErrorCode.InvalidInput, message) }
}

export function createLocalGitDevelopmentProvider(
  options: LocalGitDevelopmentProviderOptions,
): LocalGitDevelopmentProvider {
  return new LocalGitDevelopmentProvider(options)
}
