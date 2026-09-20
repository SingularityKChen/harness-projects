#!/usr/bin/env node
// 把 AGENTS.md 里两条已经成文、但今天只靠人自觉的规则变成可执行的检查。
//
//   node scripts/rule-checks.mjs disclosure <base-ref>   # §8.6 发布面机械扫描
//   node scripts/rule-checks.mjs size <base-ref>         # §8.3 PR 体量上限
//
// <base-ref> 是判定基线，必须是**这个 PR 自己声明的 base**（CI 传的是
// github.base_ref，见 .github/workflows/rule-checks.yml）。栈上 PR 的 base 是
// 栈内上一层，传 origin/main 会把整个栈的累计读成这一个 PR 的体量：PR #95 的
// 真实改动是 900 行，用 main 当基线得到 7837 行（issue #96）。两个子命令都把
// 实际使用的基线打印在首行；栈累计另起一行，只记录、不判定、不设预算。
//
// disclosure 覆盖四个来源：对 base 的三点差异新增行、范围内每个提交单独引入
// 的新增行（捕捉「先加后删」）、每个提交信息、以及经 PR_BODY 传入的 PR 描述。
// 只看「相对 base 的本次改动」，不扫全树：规则约束的是本次要推上发布面的
// 东西，不是仓库里历史遗留的内容。
//
// PR 标题与分支名同样属于 §8.6 定义的发布面，尚未接入扫描：留作后续小 PR，
// 详见 .github/workflows/rule-checks.yml 里 types 那条注释（issue #40 评审项 2）。
//
// 纯函数导出给 tests/contract/rule-checks.test.js，使其无需 git 也能被验证；
// disclosure()/size() 本身也导出，接受注入的 git 数据源，让 exit code 契约
// （命中→1、干净→0）同样可以离线测试。

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// §8.6 发布面机械扫描
// ---------------------------------------------------------------------------

// 家目录前缀、内网后缀按片段拼装，绝不让完整字面量出现在本文件里：本文件不
// 再豁免扫描（见下方 SCAN_EXCLUDES 的说明），拼装是这条性质唯一的守卫，由
// 「自扫命中数为 0」的契约测试验证——新增的凭据/内网模式同样遵守这条纪律。
//
// 不含 'root'。这是把实现改回与 docs/development/publication.md canonical 正则一致——该正则
// 只认 Users 与 home 两个家目录段，从未包含 root；不是遗漏，是修正：root 是
// 这个脚本自己加的一段，代价是它在 root 的缓存目录这类标准 CI 路径上制造
// 误报（§9.2 判定准则下，误报会让「转为必需检查」的前置条件永远不成立）。
//
// 权衡（有意为之）：反过来，一个真实的、以 root 身份泄露的路径
// （例如 /root/.ssh/id_rsa）现在也不会被这条模式命中。如果之后认为 §8.6
// 应当反过来把 root 补进 canonical 正则，请同时改文档与这里的列表——
// 不要让两边再次各说各话，那正是这一整个 ExecPlan 要消灭的缺陷类型。
const HOME_SEGMENTS = ['Users', 'home']

// 紧跟在 /home/ 之后时不算命中的首段。不是「弱化用户名匹配」——每一条都有
// 各自可核实的理由，真实用户名（任何不在这张表里的段）仍然命中，见测试
// 「home 路径：非豁免用户名仍然命中」。
//   node:      官方 Docker node 镜像的 WORKDIR 惯例（/home/node/...），是一个
//              已知的系统/服务账户，不是个人身份。
//   dashboard: 已知误报来自一个应用内路由段（/home/dashboard），根本不是
//              文件系统路径；这条模式本身无法区分「路由」与「路径」，只能
//              按具体已知误报值逐条排除——它不是账户名，列在这里只是因为
//              它恰好长得像这个模式的「首段」形状。
const HOME_FIRST_SEGMENT_EXEMPT = ['node', 'dashboard']

const INTERNAL_TLDS = ['local', 'internal', 'lan', 'corp', 'home', 'intranet']

function buildHomePathPattern() {
  const exempt = HOME_FIRST_SEGMENT_EXEMPT.join('|')
  return new RegExp(`/(?:${HOME_SEGMENTS.join('|')})/(?!(?:${exempt})\\b)[^/\\s"'\`)\\]]+`)
}

// (?<!\.)  ……前面不能是另一个点：挡掉 `.env.local`、`*.local.json` 这类点号
//            分隔文件名——它们的 TLD 段前面永远是另一个点，真正只有一层
//            标签的主机名（形如 `<label>.home`、`<label>.intranet`）前面不是。
// (?!\.[A-Za-z0-9])  ……后面不能紧跟「点 + 字母数字」：挡掉
//            `settings.local.json` 这类把 TLD 当中间段、后面还有真扩展名
//            的文件名；真正的主机名以这个词结尾，不会再接一段。
//
// 标签形状约束（issue #40 评审项 4 / RC2）：要求 TLD 前的标签含数字或连字符
// ——收窄决策域本身，不是加一份会过时的豁免名单。真实主机名习惯带编号/连
// 字符（build-01、nas1），JS/TS 属性访问的标签（styles、nav、cfg）几乎总是
// 纯字母；没选"要求 //、@、:port 等上下文"，因为常见披露就是纯文本提及。
function buildInternalHostPattern() {
  const label = '[A-Za-z0-9._-]*[0-9-][A-Za-z0-9._-]*'
  return new RegExp(`\\b(?<!\\.)${label}\\.(?:${INTERNAL_TLDS.join('|')})\\b(?!\\.[A-Za-z0-9])`)
}

// RFC1918 私网地址：10/8、172.16/12、192.168/16。八位组按合法范围校验，
// 不会把公网地址（例如 8.8.8.8）误判。
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d|0)'
function buildRfc1918Pattern() {
  return new RegExp(
    `\\b(?:10(?:\\.${OCTET}){3}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.${OCTET}){2}|192\\.168(?:\\.${OCTET}){2})\\b`,
  )
}

// 私钥 PEM 头按「五个短横线」与「BEGIN … PRIVATE KEY」分开拼装：两段字面量
// 单独出现时都不构成完整头部，完整字面量因此不会出现在本文件的源码里。
const PEM_DASHES = '-'.repeat(5)
const PEM_TAIL = ['PRIVATE', 'KEY'].join(' ')
function buildPemHeaderPattern() {
  return new RegExp(`${PEM_DASHES}BEGIN (?:[A-Z]+ )?${PEM_TAIL}${PEM_DASHES}`)
}

/** 本次扫描覆盖的可机械判定模式。§10 唯一写成硬约束的类目（凭据）排在前面。 */
export const DISCLOSURE_PATTERNS = [
  {
    name: 'GitHub 令牌',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    hint: '立即到 GitHub Settings 吊销该令牌，再改写成 `<token>` 占位符。',
  },
  {
    name: 'GitHub 细粒度 PAT',
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    hint: '立即到 GitHub Settings 吊销该令牌，再改写成 `<token>` 占位符。',
  },
  {
    name: 'AWS Access Key',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    hint: '立即在 AWS IAM 停用该密钥，再改写成 `<aws-access-key-id>` 占位符。',
  },
  {
    name: '私钥 PEM 头',
    regex: buildPemHeaderPattern(),
    hint: '私钥永不入库（AGENTS.md §10）；轮换该密钥并改用 secret 服务分发。',
  },
  {
    name: '本机家目录路径',
    regex: buildHomePathPattern(),
    hint: '改写成 `~/…`、`$HOME/…` 或 `<workspace>/…` 这类占位符。',
  },
  {
    name: '内网主机名',
    regex: buildInternalHostPattern(),
    hint: '改写成 `<host>`；需要说明拓扑时只写角色，不写真实主机名。',
  },
  {
    name: 'RFC1918 内网地址',
    regex: buildRfc1918Pattern(),
    hint: '改写成 `<internal-ip>`；举例用 TEST-NET（192.0.2.0/24 等）或占位符。',
  },
]

/**
 * 按 hunk 解析一段统一 diff：只有在 hunk 头（`@@ … @@`）之后才把行当作
 * 内容行，marker 只取第一个字符。这样内容本身长得像 `+++ …` 或以 `++`
 * 开头也不会被误当成文件头丢弃或篡改归属；hunk 之外只识别 `+++ ` 文件头，
 * 不把其它元数据行（index/mode/…）当内容扫描。
 * @param {string} diff
 * @returns {{file: string, lineNo: number, text: string}[]} 新增的行
 */
function parseAddedLines(diff) {
  const added = []
  let mode = 'outside'
  let file = '(unknown)'
  let newLineNo = 1

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      mode = 'outside'
      continue
    }
    if (mode === 'outside') {
      if (raw.startsWith('+++ ')) {
        const rest = raw.slice('+++ '.length)
        file = rest.startsWith('b/') ? rest.slice(2) : rest
      } else if (raw.startsWith('@@')) {
        mode = 'hunk'
        newLineNo = parseHunkStart(raw)
      }
      continue
    }
    // mode === 'hunk'：只有新 hunk 头会把我们带回「仍在同一个文件里」的状态，
    // 其余任何内容——哪怕文本本身长得像 `+++ ` 或 `diff --git `——都只按
    // marker 处理，不重新解释成 diff 元数据。
    if (raw.startsWith('@@')) {
      newLineNo = parseHunkStart(raw)
      continue
    }
    const marker = raw.slice(0, 1)
    const text = raw.slice(1)
    if (marker === '+') {
      added.push({ file, lineNo: newLineNo, text })
      newLineNo += 1
    } else if (marker === ' ') {
      newLineNo += 1
    }
    // marker 为 '-'（删除行）或 '\'（无换行符标记）：不推进新文件行号。
  }
  return added
}

function parseHunkStart(header) {
  const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header)
  return m ? Number(m[1]) : 1
}

/** 一行里全部模式、全部匹配的位置——不止每个模式的第一个（旧实现用 `regex.exec` 只取一个，issue #40 评审项 1）。 */
function findMatches(text) {
  const matches = []
  for (const { name, regex, hint } of DISCLOSURE_PATTERNS) {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`
    const global = new RegExp(regex.source, flags)
    let m
    while ((m = global.exec(text))) {
      matches.push({ start: m.index, end: m.index + m[0].length, name, hint })
      if (m[0].length === 0) global.lastIndex += 1 // 防御：这组模式不会真的产生零宽匹配
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}

/** 已经打码的整行太长时，围绕锚点截取一个窗口，只保留能定位问题的上下文。 */
function windowAround(maskedLine, anchor) {
  const MAX = 160
  if (maskedLine.length <= MAX) return maskedLine.trim()
  const windowStart = Math.max(0, anchor - 40)
  return `${windowStart > 0 ? '…' : ''}${maskedLine.slice(windowStart, windowStart + MAX).trim()}…`
}

/**
 * 一行文本里全部模式的全部命中：单趟从左到右扫描遮蔽全部匹配区间，不只是
 * 某条命中自己那一段（P1-1：旧实现一行命中 N 个模式就打印 N 条摘要，各遮
 * 一段、露其余）。不保留 `line` 字段——旧实现里它是没人打印却装原文的暗桩。
 */
function matchPatterns(text) {
  const matches = findMatches(text)
  let maskedLine = ''
  let cursor = 0
  const anchors = matches.map(({ start, end }) => {
    const from = Math.max(cursor, start)
    maskedLine += text.slice(cursor, from)
    const anchor = maskedLine.length
    const to = Math.max(from, end)
    maskedLine += '█'.repeat(Math.min(Math.max(to - from, 3), 12))
    cursor = to
    return anchor
  })
  maskedLine += text.slice(cursor)

  return matches.map(({ name, hint }, i) => ({
    pattern: name,
    hint,
    excerpt: windowAround(maskedLine, anchors[i]),
  }))
}

/**
 * 扫描 `git diff` 输出里的新增行（按 hunk 解析，见 {@link parseAddedLines}）。
 * @param {string} diff 统一 diff 文本
 * @returns {{file: string, lineNo: number, pattern: string, hint: string, excerpt: string}[]}
 */
export function scanDiff(diff) {
  const hits = []
  for (const { file, lineNo, text } of parseAddedLines(diff)) {
    for (const hit of matchPatterns(text)) hits.push({ file, lineNo, ...hit })
  }
  return hits
}

/** 扫描一段普通文本（提交信息、PR 描述）——每一行都算「新增」，因为它本身就是本次改动引入的。 */
export function scanText(text, fileLabel) {
  const hits = []
  text.split('\n').forEach((line, idx) => {
    for (const hit of matchPatterns(line)) hits.push({ file: fileLabel, lineNo: idx + 1, ...hit })
  })
  return hits
}

// AGENTS.md 含有规则文本本身对这些模式的描述，扫描它只会命中规则文本自身——
// 这不是豁免：它的内容由人工评审把关（docs/development/publication.md「人工逐条」）。
//
// scripts/rule-checks.mjs 不在这张表里：上面的拼装写法已经让它对自己干净
// （由「自扫命中数为 0」的契约测试守住），豁免反而会让这个文件变成全仓库
// 唯一不被扫描的地方——而它正是最可能长出临时本机路径的文件。
//
// `:(top,exclude)` 而不是 `:(exclude)`（issue #40 评审项 3）：裸的写法和
// 下面 disclosure() 里裸的 `.` 一样是 cwd 相对，子目录里排除不掉仓库根的 AGENTS.md。
const SCAN_EXCLUDES = [':(top,exclude)AGENTS.md']

// ---------------------------------------------------------------------------
// §8.3 PR 体量上限
// ---------------------------------------------------------------------------

/** AGENTS.md §8：代码 ≤ 1000 行，文档 ≤ 1500 行（增删之和）。 */
export const BUDGETS = { code: 1000, docs: 1500 }

/**
 * git 对含非 ASCII 字节的路径默认加引号并转成八进制转义
 * （core.quotePath，例如中文文件名变成 `"docs/\344\270\255…md"`）。
 * 按 git 的 C 风格转义规则逐字节还原，再以 UTF-8 解码——不能用
 * `JSON.parse`：JSON 不认识 `\NNN` 八进制转义，会直接抛错。
 */
function unquoteGitPath(raw) {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw

  const inner = raw.slice(1, -1)
  const bytes = []
  const simple = { '\\': 92, '"': 34, t: 9, n: 10, a: 7, b: 8, f: 12, r: 13, v: 11 }

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch !== '\\') {
      bytes.push(ch.codePointAt(0))
      continue
    }
    const next = inner[++i]
    if (next === undefined) break
    if (Object.hasOwn(simple, next)) {
      bytes.push(simple[next])
      continue
    }
    if (next >= '0' && next <= '7') {
      let octal = next
      while (octal.length < 3 && /[0-7]/.test(inner[i + 1] ?? '')) octal += inner[++i]
      bytes.push(Number.parseInt(octal, 8))
      continue
    }
    bytes.push(next.codePointAt(0))
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * numstat 对重命名的路径字段写成 `{old => new}`（有公共前后缀时）或
 * `old/full/path => new/full/path`（没有时）。取「新」路径参与分桶与排除
 * 判定——否则整个组合字符串既不 `startsWith('docs/')` 也不 `endsWith('.md')`，
 * 落进默认桶 `code`。
 */
function resolveRenamedPath(raw) {
  if (!raw.includes(' => ')) return raw
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw)
  if (brace) {
    const [, prefix, , toPart, suffix] = brace
    return `${prefix}${toPart}${suffix}`
  }
  const parts = raw.split(' => ')
  return parts[parts.length - 1]
}

/** numstat 路径字段 → 参与分桶/排除判定用的真实路径（解引号 + 解重命名）。 */
export function normalizePath(raw) {
  return resolveRenamedPath(unquoteGitPath(raw))
}

/** 一个路径算文档还是代码；`.md` 大小写不敏感（`README.MD` 同样算文档）。 */
export function bucketOf(path) {
  return path.startsWith('docs/') || /\.md$/i.test(path) ? 'docs' : 'code'
}

/**
 * AGENTS.md §8「排除 pnpm-lock.yaml 与生成物」的可判定表述：按路径前缀/
 * 目录段判定而不是精确字符串匹配，覆盖嵌套锁文件、其它包管理器的锁文件、
 * 以及常见生成目录。导出给契约测试断言「规则文本 ↔ 实现」一致。
 */
export const SIZE_EXCLUDE_RULES = [
  { label: 'pnpm-lock.yaml', test: (p) => /(^|\/)pnpm-lock\.yaml$/.test(p) },
  { label: 'package-lock.json', test: (p) => /(^|\/)package-lock\.json$/.test(p) },
  { label: 'yarn.lock', test: (p) => /(^|\/)yarn\.lock$/.test(p) },
  { label: 'dist/', test: (p) => /(^|\/)dist\//.test(p) },
  { label: 'generated/', test: (p) => /(^|\/)generated\//.test(p) },
]

export function isSizeExcluded(path) {
  return SIZE_EXCLUDE_RULES.some((rule) => rule.test(path))
}

/**
 * 按桶汇总 `git diff --numstat` 的输出。
 * @param {string} numstat 每行 `<added>\t<deleted>\t<path>`（path 可能带引号或重命名箭头）
 */
export function tally(numstat) {
  const totals = { code: 0, docs: 0 }
  const files = []

  for (const raw of numstat.split('\n')) {
    if (raw.trim() === '') continue
    const [added, deleted, rawPath] = raw.split('\t')
    if (rawPath === undefined) continue

    const path = normalizePath(rawPath)
    if (isSizeExcluded(path)) continue
    // 二进制文件的 numstat 是 `-`，不计入行数统计。
    if (added === '-' || deleted === '-') continue

    const churn = Number(added) + Number(deleted)
    const bucket = bucketOf(path)
    totals[bucket] += churn
    files.push({ path, churn, bucket })
  }

  files.sort((a, b) => b.churn - a.churn)
  return { totals, files }
}

// ---------------------------------------------------------------------------
// 判定基线的可观测性
// ---------------------------------------------------------------------------

/**
 * 未显式传 base-ref 时的默认基线。它只在「PR 面向 main」的日常场景下正确，
 * 因此输出必须打印实际使用的基线：在栈上裸跑会把整个栈的累计读成这个 PR 的
 * 体量（issue #96），而读者需要能一眼看出量的是哪一段。
 */
export const DEFAULT_BASE = 'origin/main'

/**
 * `origin/main`、`refs/remotes/origin/main`、`refs/heads/main` 与 `main` 指向同一
 * 条基线；比较前归一化。归一化只影响"要不要多打印一行栈累计"，不影响判定。
 * `origin/main~1` 这类**不是**同一个提交的写法故意不归一：它确实不是 main 的
 * tip，按非 main 处理才是对的。
 */
export function normalizeBaseRef(ref) {
  return String(ref)
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/[^/]+\//, '')
    .replace(/^origin\//, '')
}

/**
 * 让判定自描述：给出基线 ref 与它解析到的提交。
 *
 * 解析失败不抛错——这只是给读者的定位信息；「基线不存在」的 fail-closed 判定
 * 在 CLI 的 baseRefExists() 里（exit 3），报告层不重复一次，也不回退到任何
 * 默认基线：回退会把「量错了」变成永久的静默错误。
 */
export function describeBaseline(base, deps = {}) {
  const { resolveRef = (ref) => git(['rev-parse', '--verify', '--short=12', `${ref}^{commit}`]) } = deps
  try {
    // git 的输出带结尾换行：不 trim 会把这一行拆成两行，读起来像两条信息。
    return `${base} @ ${String(resolveRef(base)).trim()}`
  } catch {
    return `${base}（无法解析成提交）`
  }
}

// ---------------------------------------------------------------------------
// CLI（与可注入 git 数据源的导出函数）
// ---------------------------------------------------------------------------

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const annotate = (level, message) => console.log(`::${level}::${message}`)

/**
 * §8.6 发布面机械扫描：覆盖四个来源。
 * @param {string} base
 * @param {{readDiff?: Function, listCommits?: Function, readCommitDiff?: Function, readCommitMessage?: Function, resolveRef?: Function, prBody?: string}} deps
 *   全部可注入，默认调用真实 git 与 `process.env.PR_BODY`——测试借此离线验证
 *   exit code 契约与「先加后删」「提交信息泄露」两类不经文件内容就能发生的场景。
 */
export function disclosure(base, deps = {}) {
  const {
    // `:(top)` 而不是裸 `.`：后者是 cwd 相对的，子目录里运行会静默收窄范围。
    readDiff = (range) => git(['diff', '-U0', range, '--', ':(top)', ...SCAN_EXCLUDES]),
    listCommits = (range) => git(['log', '--format=%H', range]).split('\n').filter(Boolean),
    readCommitDiff = (sha) => git(['diff', '-U0', `${sha}^!`, '--', ':(top)', ...SCAN_EXCLUDES]),
    readCommitMessage = (sha) => git(['log', '-1', '--format=%B', sha]),
    resolveRef,
    prBody = process.env.PR_BODY ?? '',
  } = deps

  // 扫描范围取决于基线：base 不是 main 时，这里的「新增行」与「每个提交」都
  // 只是本 PR 相对栈内上一层的改动。打印出来，免得把它读成整个栈。
  console.log(`基线：${describeBaseline(base, { resolveRef })}（扫描范围 ${base}...HEAD）`)

  const treeHits = scanDiff(readDiff(`${base}...HEAD`))

  // 树对树的三点差异看不见「A 提交加、B 提交删」：净变化是零。因此额外逐个
  // 扫描范围内每个提交自己引入的新增行，命中时带上提交 SHA——这是先加后删
  // 情形下唯一能告诉作者「需要改写历史」而不是「再提交一次删除」的信息。
  const commits = listCommits(`${base}..HEAD`)
  const commitDiffHits = commits.flatMap((sha) =>
    scanDiff(readCommitDiff(sha)).map((hit) => ({ ...hit, commit: sha })),
  )
  const commitMessageHits = commits.flatMap((sha) =>
    scanText(readCommitMessage(sha), '(commit message)').map((hit) => ({ ...hit, commit: sha })),
  )
  const prBodyHits = scanText(prBody, '(PR description)')

  const hits = [...treeHits, ...commitDiffHits, ...commitMessageHits, ...prBodyHits]

  if (hits.length === 0) {
    console.log('机械扫描通过，覆盖范围：对 base 的新增行、范围内每个提交单独引入的新增行、')
    console.log('每个提交信息、PR 描述（经 PR_BODY 传入时）——以上均未命中任何已知模式。')
    console.log('')
    console.log('注意这只覆盖可机械判定的一类。docs/development/publication.md 的通过条件是人工把五个')
    console.log('类目（凭据 / 本机路径与身份 / 账号与个人信息 / 内部系统 / 保密字样）')
    console.log('逐条过一遍——这个检查不能替代那一步。')
    return 0
  }

  for (const hit of hits) {
    const where = hit.commit ? `${hit.file}@${hit.commit.slice(0, 12)}` : hit.file
    annotate('error', `${where}:${hit.lineNo} 命中「${hit.pattern}」—— ${hit.hint}`)
    console.log(`  ${where}:${hit.lineNo}\n    ${hit.excerpt}`)
  }
  console.log('')
  console.log('本仓库是 public：分支一经推送、PR 描述一经提交即等同公开发布，')
  console.log('事后删除无法从缓存视图、PR ref 与第三方镜像中回收。')
  console.log('未推送的分支用 git commit --amend 或交互式 rebase 重写；已推送的分支光靠')
  console.log('「再提交一次删除」不够——上面列出的提交仍可按 SHA 取到旧内容，需要改写历史。')
  console.log('同时删除本次 workflow run（docs/development/publication.md 的恢复流程，日志本身也是发布面）。')
  return 1
}

/**
 * §8.3 PR 体量上限。
 *
 * 判定范围是 `${base}...HEAD`：PR 相对它声明的 base 的三点差异。base 由调用方
 * 传入（CI 传 `github.base_ref`），不由本函数或触发器的分支过滤器决定——两者
 * 一旦混同，栈上 PR 就会被量成整个栈的累计（issue #96）。
 *
 * @param {string} base
 * @param {{readNumstat?: Function, resolveRef?: Function, mainRef?: string}} deps
 *   `readNumstat` 会被用于两个范围：判定范围 `${base}...HEAD`，以及 base 不是
 *   `mainRef` 时的栈累计范围 `${mainRef}...HEAD`。默认实现读真实 git。
 */
export function size(base, deps = {}) {
  const {
    readNumstat = (range) => git(['diff', '--numstat', range]),
    resolveRef,
    mainRef = DEFAULT_BASE,
  } = deps
  const { totals, files } = tally(readNumstat(`${base}...HEAD`))
  let failed = false

  console.log(`基线：${describeBaseline(base, { resolveRef })}（判定范围 ${base}...HEAD）`)

  for (const bucket of ['code', 'docs']) {
    const budget = BUDGETS[bucket]
    const used = totals[bucket]
    const label = bucket === 'code' ? '代码' : '文档'
    console.log(`${label}：${used} / ${budget} 行（增删之和）`)
    if (used > budget) {
      annotate('error', `${label}改动 ${used} 行，超过 AGENTS.md §8 的 ${budget} 行上限`)
      failed = true
    }
  }

  // 栈累计：base 不是 main 时，额外记录「这个 head 相对 main 还有多少没进」。
  // 它只记录、不判定——AGENTS.md §8 的预算是单个 PR 的闭环规模，栈累计是另一
  // 个量，因此这里不设阈值、不影响 exit code（ExecPlan 2026-09-20 的 Decision
  // Log：栈累计不设预算）。算不出来也只降级成一行说明。
  if (normalizeBaseRef(base) !== normalizeBaseRef(mainRef)) {
    try {
      const cumulative = tally(readNumstat(`${mainRef}...HEAD`))
      console.log(
        `栈累计（相对 ${mainRef}，仅记录，不计入判定）：代码 ${cumulative.totals.code} 行、文档 ${cumulative.totals.docs} 行`,
      )
    } catch (error) {
      console.log(`栈累计：相对 ${mainRef} 计算失败（${error.message}）——这一行只是记录，判定不受影响`)
    }
  }

  if (files.length > 0) {
    console.log('\n本 PR 贡献最多的文件：')
    for (const f of files.slice(0, 10)) console.log(`  ${String(f.churn).padStart(6)}  ${f.path}`)
  }
  console.log(`\n已排除：${SIZE_EXCLUDE_RULES.map((r) => r.label).join('、')}`)

  if (failed) {
    console.log('')
    console.log('超出即拆分（AGENTS.md §8 第 2 条）。拆分的依据是 AGENTS.md §4 的批次判据，')
    console.log('不是「把同一个风险摊成更多文件提交」——每个子 PR 都要能单独验收。')
    console.log('看板上的 `Size` 字段用于在动手之前声明预计量级，避免在评审时才发现。')
    return 1
  }
  return 0
}

const commands = { disclosure, size }

/** base ref 在本地是否能解析成一个提交——区分「环境/用法错误」与「真实违规」。 */
function baseRefExists(base) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// 只在被直接执行时跑 CLI。契约测试 import 本文件是为了验证纯函数，
// 不加这道判断，import 会立刻触发 git 调用并 process.exit。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // 默认基线只在「当前分支的 PR 面向 main」时正确。在栈上省略 base-ref 会把
  // 整个栈的累计读成这个 PR 的体量，所以两个子命令都会把实际用的基线打印
  // 出来；DEFAULT_BASE 的说明见上。
  const [command, base = DEFAULT_BASE] = process.argv.slice(2)
  if (!Object.hasOwn(commands, command)) {
    console.error(`用法：node scripts/rule-checks.mjs <${Object.keys(commands).join('|')}> [base-ref]`)
    process.exit(2)
  }
  if (!baseRefExists(base)) {
    console.error(`内部错误：base ref "${base}" 无法解析成提交——是否忘记 fetch，或分支名拼错？`)
    process.exit(3)
  }
  try {
    process.exit(commands[command](base))
  } catch (error) {
    console.error(`内部错误：${error.message}`)
    process.exit(3)
  }
}
