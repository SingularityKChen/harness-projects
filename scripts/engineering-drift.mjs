// 把「看板上的 `Engineering` 是否等于 PR 真值」变成一个可以离线核对的纯函数。
//
// 为什么需要它：2026-09-22 实测发现 `Engineering` 的合并投影从未成功过——reconcile
// 在每一次合并事件上都失败，而失败发生在合并**之后**：它拦不住合并，也不是必需检查，
// 于是看板静静停在 `PR open`，44 个条目里 25 个与真值不符（issue #110）。四层防线
// 全漏的那一层就是这里——没有任何东西观察字段取值本身。
//
// 本文件只交付判定逻辑；取数与 CI 接线在 `check-engineering-drift-live.mjs`。
// 它不发起网络请求、不 import `child_process`、不提供 CLI 入口，因此可以进
// `pnpm verify`——那是一条离线、无凭据的必需检查。

import { FIELD_NAME, stateForSnapshot } from './sync-engineering-state.mjs'

/** 分页上限。超过就 fail closed，不把截断的输入当完整输入。 */
export const MAX_PAGES = 5
export const PAGE_SIZE = 100

/**
 * 期望值来自「引用这个 issue 的 PR」，规则按优先级：
 *
 * 1. **有任一 PR 已合并 → 取该 PR 的投影。** 已合并是**终态且单调**：一个 PR 合并之后
 *    不会再变回 open，所以这一条没有歧义。多个已合并 PR 时取创建时间最新的那个——
 *    取值必然都是 `Merged`，选谁只影响 finding 里回显的 PR 编号。
 * 2. **否则有任一 PR 处于 open → 取创建时间最新的那个 open PR 的投影。** 多个 open PR
 *    引用同一 issue 本身可疑，但「最新」是可机械判定且确定的；投影本身仍交给
 *    `stateForSnapshot`，本文件不复制那份规则。
 * 3. **否则（全部 closed 且未合并）→ 取创建时间最新的那个的投影**，也就是清空。
 *
 * 没有被任何 PR 引用的条目**不参与比较**：`Engineering` 为空是合法状态，不是漂移。
 */
function newestFirst(references) {
  return [...references].sort((a, b) => {
    const left = Date.parse(a.createdAt)
    const right = Date.parse(b.createdAt)
    if (left !== right) return right - left
    // createdAt 相同时用编号兜底，保证排序是确定的而不是依赖输入顺序。
    return b.number - a.number
  })
}

function projectionFor(reference) {
  let decision
  try {
    decision = stateForSnapshot({
      state: reference.state,
      merged: reference.merged,
      isDraft: reference.isDraft,
      reviewDecision: reference.reviewDecision,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`PR #${reference.number} 的快照无法投影：${message}`)
  }
  return decision.kind === 'clear' ? null : decision.value
}

/**
 * 给定引用同一 issue 的 PR 集合，返回 `{ value, prNumber, rule }`。
 * `value` 为 `null` 表示该 issue 的 `Engineering` 应当是空的。
 */
export function projectExpected({ references }) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error('projectExpected 需要至少一个引用 PR')
  }

  const merged = newestFirst(references.filter((reference) => reference.state === 'MERGED'))
  if (merged.length > 0) {
    return { value: projectionFor(merged[0]), prNumber: merged[0].number, rule: 'merged' }
  }

  const open = newestFirst(references.filter((reference) => reference.state === 'OPEN'))
  if (open.length > 0) {
    return { value: projectionFor(open[0]), prNumber: open[0].number, rule: 'open' }
  }

  const closed = newestFirst(references)
  return { value: projectionFor(closed[0]), prNumber: closed[0].number, rule: 'closed' }
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串`)
  }
  return value
}

function requiredNumber(value, path) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} 必须是正整数`)
  }
  return value
}

function requiredBoolean(value, path) {
  if (typeof value !== 'boolean') throw new Error(`${path} 必须是布尔值`)
  return value
}

function normalizePullRequest(node, index) {
  const path = `pullRequests[${index}]`
  const number = requiredNumber(node?.number, `${path}.number`)
  const state = requiredString(node?.state, `${path}.state`)
  const merged = requiredBoolean(node?.merged, `${path}.merged`)
  const isDraft = requiredBoolean(node?.isDraft, `${path}.isDraft`)
  const createdAt = requiredString(node?.createdAt, `${path}.createdAt`)
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error(`${path}.createdAt 不是可解析的时间：${createdAt}`)
  }
  const reviewDecision = node?.reviewDecision ?? null
  if (reviewDecision !== null && typeof reviewDecision !== 'string') {
    throw new Error(`${path}.reviewDecision 必须是字符串或 null`)
  }
  if (!Array.isArray(node?.closingIssues)) {
    throw new Error(`${path}.closingIssues 必须是数组`)
  }
  const closingIssues = node.closingIssues.map((issue, at) =>
    requiredNumber(issue, `${path}.closingIssues[${at}]`))

  return { number, state, merged, isDraft, createdAt, reviewDecision, closingIssues }
}

function normalizeItem(node, index) {
  const path = `items[${index}]`
  const itemId = requiredString(node?.itemId, `${path}.itemId`)
  const issue = requiredNumber(node?.issue, `${path}.issue`)
  const engineering = node?.engineering ?? null
  if (engineering !== null && typeof engineering !== 'string') {
    throw new Error(`${path}.engineering 必须是字符串或 null`)
  }
  return { itemId, issue, engineering }
}

/**
 * 判定看板上的 `Engineering` 与 PR 真值的偏离。
 *
 * 返回 `{ findings, skipped, checked }`：
 * - `findings`：`{ issue, itemId, expected, actual, prNumber, rule }`，`expected` / `actual`
 *   为 `null` 表示空值；
 * - `skipped`：没有被任何 PR 引用的条目数（`Engineering` 为空是合法状态）；
 * - `checked`：真正参与比较的条目数。
 *
 * 任何结构异常都抛错而不是跳过——把畸形输入读成「没有漂移」正是本检查要防的那种假绿。
 */
export function engineeringDriftFindings({ pullRequests, items }) {
  if (!Array.isArray(pullRequests)) throw new Error('pullRequests 必须是数组')
  if (!Array.isArray(items)) throw new Error('items 必须是数组')

  const normalizedPullRequests = pullRequests.map(normalizePullRequest)
  const normalizedItems = items.map(normalizeItem)

  const byIssue = new Map()
  for (const pullRequest of normalizedPullRequests) {
    for (const issue of pullRequest.closingIssues) {
      if (!byIssue.has(issue)) byIssue.set(issue, [])
      byIssue.get(issue).push(pullRequest)
    }
  }

  const findings = []
  let skipped = 0
  let checked = 0

  for (const item of normalizedItems) {
    const references = byIssue.get(item.issue)
    if (references === undefined || references.length === 0) {
      skipped += 1
      continue
    }
    checked += 1
    const expected = projectExpected({ references })
    if (expected.value !== item.engineering) {
      findings.push({
        issue: item.issue,
        itemId: item.itemId,
        expected: expected.value,
        actual: item.engineering,
        prNumber: expected.prNumber,
        rule: expected.rule,
      })
    }
  }

  return { findings, skipped, checked }
}

/** 供运行时 adapter 与测试共用的诊断文案，避免两处各写一份。 */
export function describeFinding(finding) {
  const expected = finding.expected === null ? `空（按规则 ${finding.rule}）` : finding.expected
  const actual = finding.actual === null ? '空' : finding.actual
  return `issue #${finding.issue}（item ${finding.itemId}，依据 PR #${finding.prNumber}）`
    + `：${FIELD_NAME} 实际为「${actual}」，期望「${expected}」`
}
