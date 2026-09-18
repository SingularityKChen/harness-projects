#!/usr/bin/env node
// 把 AGENTS.md 里两条已经成文、但今天只靠人自觉的规则变成可执行的检查。
//
//   node scripts/rule-checks.mjs disclosure <base-ref>   # §8.6 发布面机械扫描
//   node scripts/rule-checks.mjs size <base-ref>         # §8.3 PR 体量上限
//
// 两者都只看「相对 base 的本次改动」，不扫全树：规则约束的是本次要推上发布面
// 的东西，不是仓库里历史遗留的内容。
//
// 纯函数导出给 tests/contract/rule-checks.test.js，使其无需 git 也能被验证。

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// §8.6 发布面机械扫描
// ---------------------------------------------------------------------------

// 家目录前缀按片段拼装，绝不让完整字面量出现在本文件里。
// 否则本文件自己就会成为扫描的第一个命中项——AGENTS.md 正是因为同样的原因
// 必须把自己排除在扫描范围之外，而这里通过拼装避免了再加一条排除规则。
const HOME_SEGMENTS = ['Users', 'home', 'root']
const INTERNAL_TLDS = ['local', 'internal', 'lan', 'corp']

/** 本次扫描覆盖的可机械判定模式。 */
export const DISCLOSURE_PATTERNS = [
  {
    name: '本机家目录路径',
    regex: new RegExp(`/(?:${HOME_SEGMENTS.join('|')})/[^/\\s"'\`)\\]]+`),
    hint: '改写成 `~/…`、`$HOME/…` 或 `<workspace>/…` 这类占位符。',
  },
  {
    name: '内网主机名',
    regex: new RegExp(`\\b[A-Za-z0-9._-]+\\.(?:${INTERNAL_TLDS.join('|')})\\b`),
    hint: '改写成 `<host>`；需要说明拓扑时只写角色，不写真实主机名。',
  },
]

/**
 * 扫描 `git diff` 输出里的新增行。
 * @param {string} diff 统一 diff 文本
 * @returns {{file: string, line: string, pattern: string, hint: string}[]}
 */
export function scanDiff(diff) {
  const hits = []
  let file = '(unknown)'

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice('+++ b/'.length)
      continue
    }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue

    const line = raw.slice(1)
    for (const { name, regex, hint } of DISCLOSURE_PATTERNS) {
      if (regex.test(line)) hits.push({ file, line: line.trim(), pattern: name, hint })
    }
  }
  return hits
}

// AGENTS.md 与本文件都含有模式本身的描述，扫描它们只会命中规则文本自身。
// 这不是豁免：它们的内容由人工评审把关，见 AGENTS.md §8.6 的「人工逐条」。
const SCAN_EXCLUDES = [':(exclude)AGENTS.md', ':(exclude)scripts/rule-checks.mjs']

// ---------------------------------------------------------------------------
// §8.3 PR 体量上限
// ---------------------------------------------------------------------------

/** AGENTS.md §8.3：代码 ≤ 1000 行，文档 ≤ 1500 行（增删之和）。 */
export const BUDGETS = { code: 1000, docs: 1500 }

/** 锁文件与生成物不计入体量。 */
export const SIZE_EXCLUDES = ['pnpm-lock.yaml']

/** 一个路径算文档还是代码。 */
export function bucketOf(path) {
  return path.startsWith('docs/') || path.endsWith('.md') ? 'docs' : 'code'
}

/**
 * 按桶汇总 `git diff --numstat` 的输出。
 * @param {string} numstat 每行 `<added>\t<deleted>\t<path>`
 */
export function tally(numstat) {
  const totals = { code: 0, docs: 0 }
  const files = []

  for (const raw of numstat.split('\n')) {
    if (raw.trim() === '') continue
    const [added, deleted, path] = raw.split('\t')
    if (path === undefined || SIZE_EXCLUDES.includes(path)) continue
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
// CLI
// ---------------------------------------------------------------------------

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const annotate = (level, message) => console.log(`::${level}::${message}`)

function disclosure(base) {
  const hits = scanDiff(git(['diff', '-U0', `${base}...HEAD`, '--', '.', ...SCAN_EXCLUDES]))

  if (hits.length === 0) {
    console.log('机械扫描通过：本次改动的新增行中没有家目录路径或内网主机名。')
    console.log('')
    console.log('注意这只覆盖可机械判定的一类。AGENTS.md §8.6 的通过条件是人工把五个')
    console.log('类目（凭据 / 本机路径与身份 / 账号与个人信息 / 内部系统 / 保密字样）')
    console.log('逐条过一遍——这个检查不能替代那一步。')
    return 0
  }

  for (const hit of hits) {
    annotate('error', `${hit.file}: 命中「${hit.pattern}」—— ${hit.hint}`)
    console.log(`  ${hit.file}\n    ${hit.line}`)
  }
  console.log('')
  console.log('本仓库是 public：分支一经推送、PR 描述一经提交即等同公开发布，')
  console.log('事后删除无法从缓存视图、PR ref 与第三方镜像中回收。')
  console.log('改成占位符后重新提交；未推送的分支用 git commit --amend 重写。')
  return 1
}

function size(base) {
  const { totals, files } = tally(git(['diff', '--numstat', `${base}...HEAD`]))
  let failed = false

  for (const bucket of ['code', 'docs']) {
    const budget = BUDGETS[bucket]
    const used = totals[bucket]
    const label = bucket === 'code' ? '代码' : '文档'
    console.log(`${label}：${used} / ${budget} 行（增删之和）`)
    if (used > budget) {
      annotate('error', `${label}改动 ${used} 行，超过 AGENTS.md §8.3 的 ${budget} 行上限`)
      failed = true
    }
  }

  if (files.length > 0) {
    console.log('\n贡献最多的文件：')
    for (const f of files.slice(0, 10)) console.log(`  ${String(f.churn).padStart(6)}  ${f.path}`)
  }
  if (SIZE_EXCLUDES.length > 0) console.log(`\n已排除：${SIZE_EXCLUDES.join('、')}`)

  if (failed) {
    console.log('')
    console.log('超出即拆分（AGENTS.md §8.3 第 2 条）。拆分的依据是 §5.1 的四个判据，')
    console.log('不是「把同一个风险摊成更多文件提交」——每个子 PR 都要能单独验收。')
    console.log('看板上的 `Size` 字段用于在动手之前声明预计量级，避免在评审时才发现。')
    return 1
  }
  return 0
}

const commands = { disclosure, size }

// 只在被直接执行时跑 CLI。契约测试 import 本文件是为了验证纯函数，
// 不加这道判断，import 会立刻触发 git 调用并 process.exit。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, base = 'origin/main'] = process.argv.slice(2)
  if (!Object.hasOwn(commands, command)) {
    console.error(`用法：node scripts/rule-checks.mjs <${Object.keys(commands).join('|')}> [base-ref]`)
    process.exit(2)
  }
  process.exit(commands[command](base))
}
