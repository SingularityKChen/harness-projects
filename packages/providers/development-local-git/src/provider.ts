/** 本地 Git 只声明仓库读、分支建、工作树建：没有远端，不伪造变更请求；写未知失败为 ambiguous_result，
 * 读未知失败为 unavailable；一实例一仓库以保持引用归属明确。变更请求方法仍存在但返回 not_supported。
 * 工作树移除是破坏性操作，不在本层（issue #137 的 Out of scope、issue #138 交付），所以本 provider
 * 既不实现 `removeWorktree` 也不声明 `development.worktree.remove`。 */
import path from 'node:path'
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises'

import * as cap from '@harness-projects/capabilities'
import { ProviderErrorCode, newProviderBindingId, type ProviderBindingId } from '@harness-projects/domain'

import { branchNameProblem } from './branch-names.ts'
import { defaultGitRunner, type GitInvocation, type GitRunner } from './git-runner.ts'
import { resolveWorktreePath, type WorktreePathResolution } from './paths.ts'

export interface LocalGitRepositoryConfig {
  readonly externalId: string; readonly path: string; readonly name?: string; readonly defaultBranch?: string
}

export interface LocalGitCapabilityFlags {
  readonly branchCreate?: boolean; readonly worktreeCreate?: boolean
}

export interface LocalGitDevelopmentProviderOptions {
  readonly bindingId?: ProviderBindingId
  readonly repository: LocalGitRepositoryConfig
  /** 允许根：默认取仓库的 .worktrees 目录；测试与宿主都可显式注入，仓库文件里不写本机绝对路径。 */
  readonly allowedRoot?: string
  readonly capabilities?: LocalGitCapabilityFlags
  /** 注入点：测试用它记录 argv 或注入故障；生产路径用 `execFile` 的默认 runner。 */
  readonly runGit?: GitRunner
  readonly observedAt?: string
}

interface WorktreeRecord {
  readonly path: string; readonly branch: string | undefined; readonly prunable: boolean
}

interface BranchRecord {
  readonly name: string; readonly sha: string; readonly symbolic: boolean
}

/**
 * git 的确定性拒绝 → 错误码。**顺序有意义**：一个 message 命中多条时以靠前的为准。
 *
 * 只映射**创建路径**可能拿到的拒绝：`conflict` 不在此表里，创建路径的 `conflict` 一律由 `createWorktree`
 * 的复用判定产生，而且必须**正面确认**目标目录就是本仓库的链接工作树、检出的正是请求的分支
 * （`reuseBlockedBy`）。移除路径的 `conflict`（脏 / 被锁）随 `removeWorktree` 一起留给 #138。
 */
const REFUSALS: readonly (readonly [RegExp, ProviderErrorCode, string])[] = [
  [/not a git repository|unknown revision|bad revision|needed a single revision|not a valid object name|could not get object info|does not exist|no such (file|branch|ref|remote)|ambiguous argument|invalid refspec|is not a working tree|is not a symbolic ref/i, ProviderErrorCode.NotFound, 'Git 找不到目标'],
  [/cannot lock ref .*cannot create|a branch named .* already exists|not a valid branch name|invalid branch name|not a valid ref/i, ProviderErrorCode.InvalidInput, 'Git 拒绝的引用名'],
  [/already exists|already used by worktree|is already checked out|could not create leading directories|not a directory/i, ProviderErrorCode.InvalidInput, 'Git 拒绝了工作树操作'],
  [/permission denied|operation not permitted|eacces/i, ProviderErrorCode.PermissionDenied, 'Git 没有权限'],
  [/index\.lock|another git process|resource temporarily unavailable|eagain/i, ProviderErrorCode.Unavailable, 'Git 暂时不可用'],
]

/** 新工作分支基线的本地推断顺序：`init.defaultBranch` 配的那个 → 约定名。只在仓库没有 `origin/HEAD` 时用。 */
const CONVENTIONAL_BASES: readonly string[] = ['main', 'master', 'develop', 'trunk']

/** 默认允许根在仓库检出之内，所以要把 `/.worktrees/` 写进 `<git-common-dir>/info/exclude`：git 不会
 *  自动忽略嵌套工作树，否则主检出的 `git add -A` 会把它们当嵌入仓库收进索引。 */
const DEFAULT_ROOT_EXCLUDE = '/.worktrees/'
/** 目标位置上有没有东西；不可访问由路径解析负责（`paths.ts` 的 `目标不可访问`），这里不抛也不吞错。 */
async function occupied(target: string): Promise<boolean> {
  return stat(target).then(() => true, () => false)
}

/** 两侧都取 realpath 再比：仓库可以经符号链接访问，直接比字符串会把合法复用误判成"不是本仓库"。 */
const samePath = async (left: string, right: string): Promise<boolean> =>
  (await realpath(left).catch(() => left)) === (await realpath(right).catch(() => right))

export class LocalGitDevelopmentProvider implements cap.DevelopmentProvider {
  readonly bindingId: ProviderBindingId
  readonly repository: LocalGitRepositoryConfig
  readonly allowedRoot: string
  readonly flags: Required<LocalGitCapabilityFlags>
  readonly observedAt: string
  /** 派生（而非宿主注入）的默认允许根：它在仓库检出之内，所以要由本层写 `info/exclude`。路径安全本身不
   *  按这条分流——`paths.ts` 对**任何**落在检出内的允许根都要求分量不是符号链接。 */
  private readonly derivedRoot: boolean
  private readonly runGit: GitRunner

  constructor(options: LocalGitDevelopmentProviderOptions) {
    this.bindingId = options.bindingId ?? newProviderBindingId()
    this.repository = options.repository
    this.derivedRoot = options.allowedRoot === undefined
    this.allowedRoot = options.allowedRoot ?? path.join(path.resolve(options.repository.path), '.worktrees')
    this.flags = {
      branchCreate: options.capabilities?.branchCreate ?? true,
      worktreeCreate: options.capabilities?.worktreeCreate ?? true,
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
    }
    return Promise.resolve({ bindingId: this.bindingId, capability, permission: capability, observedAt: this.observedAt })
  }

  async getRepository(ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderRepository>> {
    if (!this.ownsRepository(ref)) return this.notFound('仓库')
    // 读能力必须真的读：即使默认分支由宿主注入，也先确认仓库能被 Git 读到（离线时这里是结构化失败）。
    const probe = await this.git(['rev-parse', '--git-dir'])
    if (probe.code !== 0) return cap.providerErr(this.failureOf(probe, false))
    const branch = this.repository.defaultBranch ?? await this.baseBranch()
    return cap.providerOk({
      ref, name: this.repository.name ?? path.basename(this.repository.path),
      defaultBranch: branch === '' || branch === 'HEAD' ? undefined : branch, sourceUpdatedAt: undefined,
    })
  }

  /** 新工作分支的基线：注入值 → `origin/HEAD` → 本地推断。**不用当前检出分支**——那是环境状态而不是
   *  仓库事实（ExecPlan D14），会让同一个调用随开发者临时 checkout 漂移。返回 undefined 表示本地事实
   *  不足，此时宿主必须注入 `defaultBranch`；`createBranch` 会把缺失的起点 ref 点名报出来。 */
  private async baseBranch(): Promise<string | undefined> {
    const remote = await this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    if (remote.code === 0) return remote.stdout.trim().replace(/^origin\//, '')
    // 非 NotFound 的失败（权限、git 不可用）不在这里吞掉：交给调用方按结构化错误处理。
    if (this.failureOf(remote, false).code !== ProviderErrorCode.NotFound) return undefined
    const records = await this.branchRecords()
    if (records.error !== undefined) return undefined
    const names = records.records.map((record) => record.name)
    if (names.length === 1) return names[0]
    const configured = await this.git(['config', '--get', 'init.defaultBranch'])
    const guess = configured.code === 0 ? configured.stdout.trim() : ''
    if (guess !== '' && names.includes(guess)) return guess
    return CONVENTIONAL_BASES.find((name) => names.includes(name))
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
    // 只接受对象名：`HEAD`、`-x` 之类的 rev 不是稳定的外部身份，也不能进 argv。
    if (!/^[0-9a-f]{7,64}$/i.test(ref.externalId)) return this.invalidInput(`提交引用必须是对象名：${ref.externalId}`)
    const resolved = await this.probeRef(ref.externalId)
    if (resolved.error !== undefined) return cap.providerErr(resolved.error)
    if (!resolved.found || resolved.sha === undefined || !resolved.sha.toLowerCase().startsWith(ref.externalId.toLowerCase())) return this.notFound('提交')
    const log = await this.git(['log', '-1', '--format=%s', resolved.sha])
    if (log.code !== 0) return cap.providerErr(this.failureOf(log, false))
    const message = log.stdout.trim()
    // 回填解析后的真实 sha：短 sha / 别名不能变成第二个提交身份。
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

  async createWorktree(input: cap.ProviderCreateWorktreeInput): Promise<cap.ProviderResult<cap.ProviderWorktree>> {
    if (!this.flags.worktreeCreate) return this.notSupported(cap.CapabilityKey.DevelopmentWorktreeCreate)
    if (!this.ownsRepository(input.repository)) return this.notFound('仓库')
    const problem = branchNameProblem(input.branch)
    if (problem !== undefined) return this.invalidInput(problem)
    // 路径安全在**任何 Git 命令之前**：下面只做文件系统探测（stat / realpath），不调用 Git。
    const resolved = await this.resolveTarget(input.path)
    if (!resolved.ok) return this.invalidInput(resolved.message)
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
    const exclusion = await this.excludeDefaultRoot()
    if (exclusion !== undefined) return cap.providerErr(exclusion)
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

  /** 默认允许根在仓库检出之内时，把 `/.worktrees/` 幂等地写进 `<git-common-dir>/info/exclude`：git 不会
   *  自动忽略嵌套工作树，不写的话主检出的 `git add -A` 会把它们当嵌入仓库收进索引。写 `info/exclude`
   *  而不是 `.gitignore`，不动用户的跟踪文件；宿主注入的允许根由宿主负责。 */
  private async excludeDefaultRoot(): Promise<cap.ProviderError | undefined> {
    if (!this.derivedRoot) return undefined
    const located = await this.git(['rev-parse', '--git-path', 'info/exclude'])
    if (located.code !== 0) return this.failureOf(located, false)
    const file = path.resolve(this.repository.path, located.stdout.trim())
    const current = await readFile(file, 'utf8').catch(() => '')
    if (current.split('\n').includes(DEFAULT_ROOT_EXCLUDE)) return undefined
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await appendFile(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}${DEFAULT_ROOT_EXCLUDE}\n`)
    } catch {
      // 不能写就**拒绝创建**，不静默继续：把工作树放进用户的检出却不让它被忽略，是这条默认值引入的危险。
      return cap.providerError(ProviderErrorCode.Unavailable, `默认允许根在仓库检出内但写不进 ${file}；请让该文件可写，或注入仓库外的 allowedRoot`)
    }
    return undefined
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

  private resolveTarget(rawPath: string): Promise<WorktreePathResolution> {
    // 允许根是否落在检出内由 paths.ts 判定：检出内的分量不得是符号链接（仓库内容不可信），注入检出外由宿主负责。
    return resolveWorktreePath(rawPath, { repositoryPath: this.repository.path, allowedRoot: this.allowedRoot })
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
