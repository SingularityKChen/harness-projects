// 把 docs/product/board-semantics.md §4–§5 的推导规则（D2）变成一个可以离线核对的
// 纯函数：给定一份看板内置工作流清单与一份「必须保持关闭」的清单，找出违规项。
//
// 这不是完整的检查器。`projectV2.workflows` 是 user-level project 的数据，
// `GITHUB_TOKEN` 读不了，必须 `PROJECTS_TOKEN`——该 secret 至今不存在（见
// docs/product/board-semantics.md §8 与 issue #45）。因此本文件只交付
// D4（见控制本批次的 ExecPlan）划定的离线一半：判定逻辑本身。调用真实
// `gh api graphql` 取数据、接成一条 CI 检查的运行时接线，留给 PR #37——
// 那本来就是引入 PROJECTS_TOKEN 的那个 PR。本文件不发起任何网络请求，
// 不 import `child_process`，也不提供 CLI 入口。

/**
 * 必须保持 `enabled: false` 的内置工作流名单。
 *
 * 唯一权威来源是 docs/product/board-semantics.md §5 的九行裁决表——把「裁决」列
 * 标记为「关闭」的行取出来，一共 7 条。这不是评审时的估计数字：`Item closed`、
 * `Item reopened`、`Pull request linked to issue`、`Code review approved`、
 * `Code changes requested`、`Pull request merged` 六条直接落在 D2 规则的字面
 * 表述里（写 `Status`，触发事件属于工程轴）；`Auto-close issue` 写的不是
 * `Status`，是 issue 本身的 open/closed 状态，方向相反（规划 → 工程）且与
 * `Item closed` 构成回环，但同样违反「不允许跨轴写入」，因此一并计入。
 *
 * 改这份清单前先改 docs/product/board-semantics.md 那张表，并在同一个提交里
 * 保持两者一致——`tests/contract/board-workflow.test.js` 有一条测试把长度与
 * 内容钉死，防止两边漂移。
 */
export const MUST_BE_DISABLED = [
  'Item closed',
  'Item reopened',
  'Pull request linked to issue',
  'Code review approved',
  'Code changes requested',
  'Pull request merged',
  'Auto-close issue',
]

/**
 * 找出违反「必须保持关闭」清单的内置工作流。
 *
 * 纯函数、离线、不读取任何外部状态：`workflows` 是调用方已经取得的数据
 * （形状与 GitHub `projectV2.workflows { nodes { name enabled } }` 一致），
 * 本函数只做比对，不发起请求。
 *
 * Fail-closed 的两处（与 AGENTS.md §9.5「解析不了的 workflow 会让检查直接
 * 失败，不会静默放行」同一个立场）：
 *
 * - `mustBeDisabled` 里的某个名字如果在 `workflows` 里完全找不到，算一条
 *   finding——找不到就无法确认它是关闭的，缺失不等于合规。
 * - 输入形状不对（不是数组、条目缺字段或字段类型不对）不会被吞掉变成
 *   `[]`：一个解析不出结构的输入不代表「没有违规」，那是调用方或数据源本身
 *   坏了，必须显式抛错，不能被当成一次干净的检查结果。
 *
 * @param {Array<{name: string, enabled: boolean}>} workflows GitHub 返回的内置工作流清单
 * @param {string[]} mustBeDisabled 必须保持 enabled:false 的工作流名单
 * @returns {string[]} findings，每条违规工作流恰好一条，说明是哪个、为什么
 */
export function boardWorkflowFindings(workflows, mustBeDisabled) {
  if (!Array.isArray(workflows)) {
    throw new TypeError('boardWorkflowFindings: workflows 必须是数组，实际收到 ' + describeType(workflows))
  }
  if (!Array.isArray(mustBeDisabled)) {
    throw new TypeError('boardWorkflowFindings: mustBeDisabled 必须是数组，实际收到 ' + describeType(mustBeDisabled))
  }

  workflows.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`boardWorkflowFindings: workflows[${index}] 必须是 { name, enabled } 形状的对象，实际收到 ${describeType(item)}`)
    }
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new TypeError(`boardWorkflowFindings: workflows[${index}].name 必须是非空字符串`)
    }
    if (typeof item.enabled !== 'boolean') {
      throw new TypeError(`boardWorkflowFindings: workflows[${index}].enabled 必须是 boolean，实际收到 ${describeType(item.enabled)}`)
    }
  })

  mustBeDisabled.forEach((name, index) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError(`boardWorkflowFindings: mustBeDisabled[${index}] 必须是非空字符串`)
    }
  })

  const byName = new Map(workflows.map((item) => [item.name, item]))
  const findings = []

  for (const name of mustBeDisabled) {
    const item = byName.get(name)
    if (item === undefined) {
      findings.push(`${name}：在 workflows 清单里缺失，无法确认它是关闭的——缺失按违规处理（fail-closed）`)
      continue
    }
    if (item.enabled) {
      findings.push(`${name}：必须保持 enabled: false（写 Status 或与之构成回环，且触发事件属于工程轴），但当前是 enabled: true`)
    }
  }

  return findings
}

function describeType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
