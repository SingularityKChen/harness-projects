/**
 * 源码树扫描的共享来源（issue #350、ExecPlan 2026-10-21-scans-skip-build-output）。
 *
 * 遍历 `packages/`、`apps/` 的测试一律经这里：什么算构建产物只由根 `.gitignore` 回答，各测试不再各抄一份跳过名单。
 * 否则本机跑过 `pack:plugin` 之后，被忽略的 `apps/harness-plugin/dist/` 会被扫描当成源码，扫描看到的集合与 CI 的干净检出不一致。
 *
 * 只认 `.gitignore` 里的裸目录规则（`name/`，不含斜杠以外的路径成分，不含通配、取反、锚定）：按 gitignore 语义它匹配任意深度的同名目录。
 * 其余规则一律不收，对应目录照常扫描——宁可多扫，不可少扫。对支持的裸目录规则，文本处理只去行尾的 CR 和空格，
 * 行首空白与制表符都算规则本身（`  dist/` 不是 `dist/`），文件开头的 BOM 忽略。取反规则只看末段，其中的 `*`、`?`
 * 都当任意字符：末段匹配到的目录名整个不剪（`!packages/p/dist/` 让所有 `dist/` 不剪，`!dis*` 让 `dist` 不剪，末段是单个 `*` 时每个目录都不剪），宁多扫。
 * 取反包含反斜杠或闭合方括号时停止全部剪枝：不解析任何字符类（含字面右括号与 POSIX 类），也不能把未理解的取反当作剪枝依据。
 * Git 规则比 helper 更宽时可能少扫（例如未跟踪文件被子目录 `.gitignore` 重新包含、或 `core.ignorecase` 生效）；C4 在 Git 检出里
 * 用 `git ls-files -co --exclude-standard` 作 oracle，保证 Git 不忽略的源码 ⊆ 遍历结果。跟踪到 scope 内 symlink 时 C4 显式失败；不跟随它们，避免逃逸与循环。
 *
 * 同步实现，只用 `node:fs` 与 `node:path`，不调用 git；没有模块级状态，每个函数都接受根目录。
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const SOURCE_FILE = /\.[cm]?[jt]sx?$/
const BARE_DIRECTORY_RULE = /^([\w.-]+)\/$/
const LAST_SEGMENT = /(?:^|\/)([^/]+)\/?$/

/** 简单取反规则末段的宽松匹配；字符类已在调用前停止剪枝，未闭合方括号按字面处理。 */
function looseSegmentPattern(segment) {
  const source = segment
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/[[\]]/g, '\\$&')
    .replace(/\*+/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${source}$`)
}

/**
 * 根 `.gitignore` 里的裸目录规则名，减去被某条取反规则的末段匹配到的名字。
 * 文件缺失时抛错（ENOENT）：没有这份来源就不知道什么算构建产物，不能悄悄少剪。
 */
export function ignoredDirectoryNames(root) {
  const names = new Set()
  const negated = []
  const text = readFileSync(path.join(root, '.gitignore'), 'utf8').replace(/^\uFEFF/, '')
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').replace(/ +$/, '')
    const bare = BARE_DIRECTORY_RULE.exec(line)
    if (bare !== null) names.add(bare[1])
    else if (line.startsWith('!')) {
      if (line.includes('\\') || (line.includes('[') && line.includes(']'))) return new Set()
      const last = LAST_SEGMENT.exec(line.slice(1))
      if (last !== null) negated.push(looseSegmentPattern(last[1]))
    }
  }
  for (const name of names) if (negated.some((pattern) => pattern.test(name))) names.delete(name)
  return names
}

/** 在每个 scope 下列出源码文件，被忽略的目录整棵剪掉。`file` 是相对 scope 的 posix 路径。 */
export function listSourceFiles(root, scopes) {
  const ignored = ignoredDirectoryNames(root)
  const found = []
  const visit = (scope, relative) => {
    for (const entry of readdirSync(path.join(root, scope, relative), { withFileTypes: true })) {
      const child = relative === '' ? entry.name : path.posix.join(relative, entry.name)
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(scope, child)
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        found.push({ scope, file: child })
      }
    }
  }
  for (const scope of scopes) visit(scope, '')
  return found
}

/** 内容命中 `pattern` 的源码文件，已排序，形如 `core/src/delivery-facts.ts`。 */
export function callSites(root, scopes, pattern) {
  return listSourceFiles(root, scopes)
    .filter(({ scope, file }) => pattern.test(readFileSync(path.join(root, scope, file), 'utf8')))
    .map(({ file }) => file)
    .sort()
}
