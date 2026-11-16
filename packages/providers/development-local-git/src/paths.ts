/** 判定顺序固定：字符串拒绝 → 最近存在祖先 realpath → 允许根符号链接判定 → 落根判定 → 才允许调用 Git。
 * 允许根本身可以尚不存在（provider 的默认工作树根位于 checkout 外），所以它与目标
 * 走同一套「最近存在祖先 + 拼回尾部」的规范化。
 *
 * **不变量**：允许根落在**仓库检出之内**的分量一律不得是符号链接。仓库内容是**不可信输入**——上游提交
 * 一条 `.worktrees -> src` / `.worktrees -> .git` 就能决定检出写到哪里，而 `realpath` 之后「仍在允许根内」
 * 照样成立（实测 git 自己也不拦：`git worktree add` 会照建）。判的是**写法**而不是解析结果，与 `..` 分量
 * 同一条口径（第四轮 P1 只判解析结果，于是指向仓库内部的链接绕过了它；第五轮 P1）。宿主注入检出之外的
 * 允许根由宿主负责。 */
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { windowsPathsArePlain } from './git-runner.ts'

export type WorktreePathRejection = 'empty' | 'parent_segment' | 'outside_root' | 'symlinked_root' | 'unresolvable'

export type WorktreePathResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: WorktreePathRejection; readonly message: string }

export interface WorktreePathInput {
  readonly repositoryPath: string; readonly allowedRoot: string
}

const reject = (reason: WorktreePathRejection, message: string): WorktreePathResolution => ({ ok: false, reason, message })

/** Windows 仅接受明确盘符路径，或在明确仓库下解析的相对工作树；先判写法再做任何 resolve。 */
export function localGitPathProblem(raw: string, absolute = false): string | undefined {
  if (raw.trim() === '' || raw !== raw.trim() || /[\u0000-\u001f\u007f]/.test(raw) || raw.split(/[/\\]+/).includes('..')) return '路径为空、含控制字符、首尾空白或 .. 分量'
  if (process.platform !== 'win32') return absolute && !path.isAbsolute(raw) ? '路径必须是绝对路径' : undefined
  const full = /^[a-z]:[/\\]/i.test(raw)
  if ((!full && (absolute || /^[/\\]|^[a-z]:/i.test(raw))) || raw.length > 32767) return 'Windows 路径必须使用完整盘符，拒绝网络或设备 namespace'
  const parts = (full ? raw.slice(3) : raw).split(/[/\\]+/).filter(Boolean)
  if (parts.some((part) => /[:<>"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) return 'Windows 路径包含 ADS、保留名或歧义分量'
  return undefined
}

/** 已存在对象由不丢精度的卷/文件身份判同；缺席对象只接受精确规范写法，不推断大小写别名。 */
export async function sameFilesystemPath(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([left, right].map((entry) => stat(entry, { bigint: true }).catch(() => undefined)))
  if (a !== undefined && b !== undefined && a.ino !== 0n && b.ino !== 0n) return a.dev === b.dev && a.ino === b.ino
  const canonical = (value: string) => realpath(value).catch(() => path.normalize(value))
  return (await canonical(left)) === (await canonical(right))
}

/** 不用 Windows path.relative 的大小写折叠作安全证明；现有根必须在目标现有祖先链上。
 * 根尚未存在时，两个最近存在祖先须是同一对象，且未存在的尾部分量精确包含。 */
async function windowsInsideRoot(root: string, target: string): Promise<boolean> {
  // 容错口径：暂态 stat/realpath 错误（EACCES/EBUSY/ELOOP 等）不得抛裸异常穿过 Provider 契约，一律 fail closed。
  try {
    return await windowsInsideRootChecked(root, target)
  } catch { return false }
}

async function windowsInsideRootChecked(root: string, target: string): Promise<boolean> {
  const [rootAncestor, targetAncestor] = await Promise.all([deepestExisting(root), deepestExisting(target)])
  if (rootAncestor === undefined || targetAncestor === undefined) return false
  if (rootAncestor !== root) {
    if (!(await sameFilesystemPath(rootAncestor, targetAncestor))) return false
    const suffix = (ancestor: string, value: string) => value.slice(ancestor.length).split(path.sep).filter(Boolean)
    const expected = suffix(rootAncestor, root), actual = suffix(targetAncestor, target)
    return expected.every((part, index) => actual[index] === part)
  }
  for (let current = targetAncestor; ; current = path.dirname(current)) {
    if (await sameFilesystemPath(root, current)) return true
    if (path.dirname(current) === current) return false
  }
}

/** `path.relative` 以 `..` 分量开头或是绝对路径都算逃出允许根；空相对路径（目标就是根本身）算落在根内。
 *  必须比 `..` **分量**而不是字符串前缀：`..wi` 是根内的合法名字，把它判成逃逸只是诊断信息错。 */
function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** 从目标向上找最近的存在目录：不存在的部分没有符号链接可展开，存在的部分必须被展开。 */
async function deepestExisting(target: string): Promise<string | undefined> {
  let current = target
  for (;;) {
    try {
      await stat(current)
      return current
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      const parent = path.dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

/** `ancestor` 到 `target` 之间第一个符号链接分量；`target` 不在 `ancestor` 之内、或走到不存在的分量就停下
 *  返回 undefined。悬空链接对 `stat` 不可见（ENOENT），只有逐分量 `lstat` 能看到。同一处判定服务两件事：
 *  目标的尾部不得是悬空链接（#137 验收 1），允许根在检出内的分量不得是任何链接（第五轮 P1）。 */
async function firstLink(ancestor: string, target: string): Promise<string | undefined> {
  const ancestorInfo = await lstat(ancestor).catch(() => undefined)
  if (ancestorInfo?.isSymbolicLink()) return ancestor
  const relative = path.relative(ancestor, target)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined
  let current = ancestor
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const info = await lstat(current).catch(() => undefined)
    if (info === undefined) return undefined
    if (info.isSymbolicLink()) return current
  }
  return undefined
}

/** 规范化 = 最近存在祖先的 realpath + 拼回不存在的尾部；`complete` 说明整条路径是否真的存在。
 *  不可访问与找不到祖先都返回 undefined，由调用方转成结构化拒绝，不抛裸异常。 */
async function canonicalize(raw: string): Promise<{ path: string; ancestor: string; complete: boolean } | undefined> {
  try {
    const ancestor = await deepestExisting(path.dirname(raw))
    if (ancestor === undefined) return undefined
    const joined = path.join(await realpath(ancestor), path.relative(ancestor, raw))
    const real = await realpath(joined).then((value) => value, () => undefined)
    return { path: real ?? joined, ancestor, complete: real !== undefined }
  } catch {
    return undefined
  }
}

export async function resolveWorktreePath(rawPath: string, input: WorktreePathInput): Promise<WorktreePathResolution> {
  const raw = typeof rawPath === 'string' ? rawPath : ''
  if (raw.trim() === '') return reject('empty', '工作树路径不能为空')
  // 首尾空白**拒绝而不是改写**：` .worktrees` 与 `.worktrees` 是两个不同的目录名，静默 trim 会把工作树建到
  // 调用方没指定的路径上，而 core 在 conflict 复用路径上回填的是调用方的原始字符串，两次拿到的值还会
  // 不一致（第四轮 P3）。这与分支名「不得包含空格」是同一条口径。
  if (raw !== raw.trim()) return reject('unresolvable', `工作树路径不得有首尾空白：${JSON.stringify(raw)}`)
  if (/[\u0000-\u001f\u007f]/.test(raw)) return reject('unresolvable', '工作树路径不得包含控制字符')
  // `..` 分量一律拒绝，哪怕它规范化后仍落在允许根内——拒绝的是写法本身，避免"看起来越界其实没事"的判定。
  if (raw.split(/[/\\]+/).includes('..')) return reject('parent_segment', '工作树路径不得包含 .. 分量')

  for (const [value, absolute] of [[raw, false], [input.repositoryPath, true], [input.allowedRoot, true]] as const) {
    const problem = localGitPathProblem(value, absolute)
    if (problem !== undefined) return reject('unresolvable', problem)
  }

  const joined = path.isAbsolute(raw) ? raw : path.resolve(input.repositoryPath, raw)
  // 从尾部单次扫描；未锚定起点的分隔符正则会在长输入不匹配时反复重试。
  let end = joined.length
  const rootLength = path.parse(joined).root.length
  while (end > rootLength && (joined[end - 1] === '/' || joined[end - 1] === '\\')) end -= 1
  const candidate = joined.slice(0, end) || joined
  if (process.platform === 'win32' && !(await windowsPathsArePlain([input.repositoryPath, input.allowedRoot, candidate]))) return reject('symlinked_root', 'Windows 路径必须位于本机固定 NTFS 且所有现有分量无 reparse 属性')
  const target = await canonicalize(candidate)
  const root = await canonicalize(path.resolve(input.allowedRoot))
  if (target === undefined) return reject('unresolvable', `目标不可访问或找不到可规范化的祖先目录：${candidate}`)
  if (root === undefined) return reject('unresolvable', `允许根不可访问或找不到可规范化的祖先目录：${path.resolve(input.allowedRoot)}`)
  // 允许根在检出内的分量不得是符号链接：拒绝的是**写法**，所以不等到解析结果跑出仓库才判（第五轮 P1）。
  const planted = await firstLink(path.resolve(input.repositoryPath), path.resolve(input.allowedRoot))
  if (planted !== undefined) return reject('symlinked_root', `允许根在仓库检出内是符号链接：${planted}；请删除该链接或注入仓库之外的 allowedRoot`)
  if (!target.complete) {
    const link = await firstLink(target.ancestor, candidate)
    if (link !== undefined) return reject('unresolvable', `路径分量是悬空符号链接：${link}`)
  }
  const inside = process.platform === 'win32' ? await windowsInsideRoot(root.path, target.path) : insideRoot(root.path, target.path)
  if (!inside) return reject('outside_root', `规范化后逃出允许根：${target.path}`)
  return { ok: true, path: target.path }
}
