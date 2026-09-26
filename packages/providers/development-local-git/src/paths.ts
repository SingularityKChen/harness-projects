/** 判定顺序固定：字符串拒绝 → 最近存在祖先 realpath → 允许根符号链接判定 → 落根判定 → 才允许调用 Git。
 * 允许根本身可以尚不存在（core 的默认工作树根 `<repo>/.worktrees` 在新仓库里就不存在），所以它与目标
 * 走同一套「最近存在祖先 + 拼回尾部」的规范化。
 *
 * **不变量**：允许根落在**仓库检出之内**的分量一律不得是符号链接。仓库内容是**不可信输入**——上游提交
 * 一条 `.worktrees -> src` / `.worktrees -> .git` 就能决定检出写到哪里，而 `realpath` 之后「仍在允许根内」
 * 照样成立（实测 git 自己也不拦：`git worktree add` 会照建）。判的是**写法**而不是解析结果，与 `..` 分量
 * 同一条口径（第四轮 P1 只判解析结果，于是指向仓库内部的链接绕过了它；第五轮 P1）。宿主注入检出之外的
 * 允许根由宿主负责。 */
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export type WorktreePathRejection = 'empty' | 'parent_segment' | 'outside_root' | 'symlinked_root' | 'unresolvable'

export type WorktreePathResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: WorktreePathRejection; readonly message: string }

export interface WorktreePathInput {
  readonly repositoryPath: string; readonly allowedRoot: string
}

const reject = (reason: WorktreePathRejection, message: string): WorktreePathResolution => ({ ok: false, reason, message })

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

  const joined = path.isAbsolute(raw) ? raw : path.resolve(input.repositoryPath, raw)
  const candidate = joined.replace(/[/\\]+$/, '') || joined
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
  if (!insideRoot(root.path, target.path)) return reject('outside_root', `规范化后逃出允许根：${target.path}`)
  return { ok: true, path: target.path }
}
