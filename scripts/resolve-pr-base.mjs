#!/usr/bin/env node
// 把一份 PR JSON 解析成 Rule checks 的判定输入：一对**不可变提交** `(base_sha, head_sha)`。
//
//   gh api "repos/$REPO/pulls/$PR_NUMBER" | EVENT_HEAD_SHA=<事件 head sha> node scripts/resolve-pr-base.mjs >> "$GITHUB_OUTPUT"
//
// 为什么需要它，以及为什么是"一对提交"而不是"一条基线 ref"：
//
//   `github.base_ref` 是运行时上下文里的值。对 GitHub 原生 stack 的成员 PR，它是
//   **栈的 base 分支**（main），而不是该 PR 声明的父分支；按它度量会把整栈累计当成
//   单个 PR 的体量（issue #99 有 run 35511506461 的实测）。
//
//   但"换成 API 的 base.ref"也不够：只把分支名传下去，下游会在自己的 checkout 里
//   解析出**当时**的 `origin/<base.ref>`，判定就依赖一个会移动的 ref。三点差异
//   `git diff B...H` 的正确性只相对于**给定的对象对**成立：base 被 force-push 到
//   无关历史时 merge-base 会移动，结果会纳入不属于本 PR 的提交（评审 P1，回归测试
//   见 docs/exec-plan/active/2026-09-21-rule-checks-api-base.md）。
//
// 契约：stdin 是 PR API 响应，stdout 是**判定输入本身**——`base_sha` 与 `head_sha`
// 两行 GITHUB_OUTPUT 格式。`base.ref` 不在契约里：它只是来源说明（provenance），
// 判定用不到它，因此由持有 JSON 的取数步骤负责回显（见 docs/development/ci.md）。
// 校验因此也只覆盖真正被用到的值——两个 SHA——加上"失败时不得产出半份结果"。
//
// 刻意不联网、不读事件负载文件、不调用 gh：JSON 从 stdin 进，校验过的两行从 stdout
// 出。于是每条失败分支都能在离线单元测试里覆盖，`gh` 留在 workflow 里。
//
// 纪律：
//   - fail closed：判定输入无法确定时非零退出，绝不回退到 main、github.base_ref 或
//     "当前的 origin/<base.ref>"；
//   - 本脚本执行的是 PR 里的代码：它给出的是**来源**，不是信任边界。若 Rule checks
//     将来要提升为必需检查，判定结论不能由 PR 代码产生（见 docs/development/ci.md）；
//   - 不回显响应内容：错误信息只说字段、规则和长度，不打印原始值，免得不小心把
//     token 或整段 payload 写进公开的 Actions 日志。
//
// exit code：0 通过；1 输入不合法；2 用法错误；3 未预期错误。

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SHA_HEX = /^[0-9a-fA-F]{40}$/

/** 40 位十六进制提交；失败信息只给长度，不回显值。`field` 用于定位是哪一个输入。 */
export function shaProblems(sha, field) {
  if (typeof sha !== 'string' || sha === '') return [`${field} 缺失或不是非空字符串`]
  if (!SHA_HEX.test(sha)) return [`${field} 必须是 40 位十六进制字符串（实际长度 ${sha.length}）`]
  return []
}

/**
 * 校验一份 PR API 响应与事件 head，产出判定用的不可变对象对。
 *
 * 硬失败（problems）只覆盖"判定对象无法确定"的情形；API 的 `head.sha` 与事件 head
 * 不一致**不是**硬失败——判定对象是事件 head（check run 挂在它上面），PR head 在解析
 * 期间前移并不改变 (base_sha, head_sha) 这对输入，硬失败只会制造 flaky 红叉。
 *
 * @param {unknown} payload PR API 响应
 * @param {{eventHeadSha?: string}} options 事件负载里的 `pull_request.head.sha`
 * @returns {{ok: true, baseSha: string, headSha: string, apiHeadSha: string, warnings: string[], problems: string[]}
 *   | {ok: false, warnings: string[], problems: string[]}}
 */
export function validatePrBase(payload, options = {}) {
  const { eventHeadSha } = options

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, warnings: [], problems: ['响应不是 JSON 对象'] }
  }
  const base = payload.base
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return { ok: false, warnings: [], problems: ['响应缺少 base 对象——它应当是 PR 对象而不是搜索结果的条目'] }
  }

  const problems = [...shaProblems(base.sha, 'base.sha'), ...shaProblems(eventHeadSha, '事件 head sha')]
  if (problems.length > 0) return { ok: false, warnings: [], problems }

  const headSha = eventHeadSha.toLowerCase()
  const rawApiHead = payload.head !== null && typeof payload.head === 'object' ? payload.head.sha : undefined
  const apiHeadSha = typeof rawApiHead === 'string' && SHA_HEX.test(rawApiHead) ? rawApiHead.toLowerCase() : ''

  const warnings = []
  if (apiHeadSha === '') {
    warnings.push('API 未返回可用的 head.sha：无法交叉核对事件 head，判定对象仍以事件 head 为准')
  } else if (apiHeadSha !== headSha) {
    warnings.push('API 的 head.sha 与事件 head 不一致：PR head 在解析期间前移了；本次判定针对事件 head，下一次事件会用新快照重跑')
  }

  return { ok: true, baseSha: base.sha.toLowerCase(), headSha, apiHeadSha, warnings, problems: [] }
}

/** 解析 stdin 文本。JSON.parse 的报错会带输入片段，因此只给固定措辞。 */
export function parsePrJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, problems: ['stdin 为空：gh api 没有输出，通常意味着它失败了'] }
  }
  try {
    return { ok: true, payload: JSON.parse(text) }
  } catch {
    return { ok: false, problems: ['stdin 不是合法 JSON'] }
  }
}

/** GITHUB_OUTPUT 格式：每个 output 一行 `name=value`。两行就是全部的判定输入。 */
export function formatOutputs({ baseSha, headSha }) {
  return `base_sha=${baseSha}\nhead_sha=${headSha}\n`
}

function fail(problems) {
  console.error('无法确定 Rule checks 的判定对象，按 fail closed 处理（不回退 main、github.base_ref 或移动的 origin/<base.ref>）：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
}

function main() {
  if (process.argv.slice(2).length > 0) {
    console.error('用法：gh api repos/<owner>/<repo>/pulls/<number> | EVENT_HEAD_SHA=<sha> node scripts/resolve-pr-base.mjs')
    process.exitCode = 2
    return
  }

  let input
  try {
    input = readFileSync(0, 'utf8')
  } catch (error) {
    console.error(`内部错误：无法读取 stdin（${error?.code ?? 'unknown'}）`)
    process.exitCode = 3
    return
  }

  const parsed = parsePrJson(input)
  if (!parsed.ok) {
    fail(parsed.problems)
    return
  }

  const result = validatePrBase(parsed.payload, { eventHeadSha: process.env.EVENT_HEAD_SHA })
  for (const warning of result.warnings) console.error(`::warning::${warning}`)
  if (!result.ok) {
    fail(result.problems)
    return
  }

  process.stdout.write(formatOutputs(result))
}

// 只在被直接执行时跑 CLI：契约测试 import 本文件是为了验证纯函数，
// 不加这道判断，import 会立刻去读 stdin。
//
// 用 pathToFileURL 而不是 `file://${process.argv[1]}`：后者在路径含空格等字符时
// 与 import.meta.url 的百分号编码不相等，main() 会被静默跳过——对本报数脚本而言
// 那就是"什么都不做但退出 0"。
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
