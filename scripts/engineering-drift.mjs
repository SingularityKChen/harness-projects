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
//
// 投影（`stateForSnapshot`）与**选择策略**（`expectedFor`）都 import 自
// `sync-engineering-state.mjs`：观察者不再持有自己的「谁说了算」实现，两侧对同一
// 份引用集合由构造一致（issue #115）。

import { expectedFor, FIELD_NAME, MAX_PAGES, PAGE_SIZE } from './sync-engineering-state.mjs'

export { MAX_PAGES, PAGE_SIZE }

/**
 * 判定看板上的 `Engineering` 与 PR 真值的偏离。
 *
 * 期望值由 `expectedFor` 给出——**任一已合并 PR 优先**（终态且单调），否则创建时间
 * 最新的 open PR，否则最新的 closed PR（即清空）；规则本身与写入口共用同一份实现，
 * 因此这里不再复述。没有被任何 PR 引用的条目**不参与比较**：`Engineering` 为空是
 * 合法状态，不是漂移。
 */

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
    const expected = expectedFor({ references })
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
