// 把 docs/product/board-semantics.md §4–§5 的推导规则变成一个可以离线核对的纯函数：
// 给定看板内置工作流的实际状态，找出与裁决表的偏离。
//
// 这不是完整的检查器。`projectV2.workflows` 是 user-level project 的数据，
// `GITHUB_TOKEN` 读不了，必须 `PROJECTS_TOKEN`（见 docs/product/board-semantics.md §8
// 与 issue #45）。因此本文件只交付判定逻辑：取数据（`gh api graphql`）与接成一条 CI
// 检查的运行时接线归 PR #61。本文件不发起任何网络请求、不 import `child_process`、
// 不提供 CLI 入口，因此可以进 `pnpm verify`——那是一条离线、无凭据的必需检查。

/**
 * 九条内置工作流各自的期望状态。
 *
 * 唯一权威来源是 docs/product/board-semantics.md §5 的九行裁决表；本常量是那张表的
 * 可执行形式。改这里之前先改那张表，并在同一个提交里保持两者一致——
 * `tests/contract/board-workflow.test.js` 有一条测试把条数与内容钉死，防止两边漂移。
 *
 * 为什么是**双向**声明（每条都写 `enabled`），而不是只列「必须关闭」的那几条：
 * 只查该关的会漏掉另一个方向——`Item added to project` 被误关之后，新上板的条目会停在
 * 空状态，而没有任何东西报出来。期望状态是完整的，检查才是完整的。
 *
 * `why` 与数据放在一起而不是只写在文档里，是为了让检查的输出自解释：看到红叉的人
 * 不需要先去翻文档才知道为什么这条必须关。
 */
export const EXPECTED = [
  {
    name: 'Auto-add sub-issues to project',
    enabled: true,
    why: '不写任何状态字段，只把子条目挂上看板——推导规则第 1 步「不写字段」即可开启',
  },
  {
    name: 'Item added to project',
    enabled: true,
    why: '写 Status，但触发事件（人把条目上板）本身属于规划轴，两轴一致；且只写初始值 Todo，不覆盖既有意图',
  },
  {
    name: 'Item closed',
    enabled: false,
    why: '写 Status，而 issue 关闭存在间接路径：合并带 Closes #N 的 PR 会自动关闭 issue，于是「PR 合并」经由「issue 关闭」写到规划状态。2026-09-18 合并 8 个 PR 时实测到 8 次（见 issue #45）',
  },
  {
    name: 'Item reopened',
    enabled: false,
    why: 'Item closed 的镜像：关闭侧既然不写 Status，重开侧同样不应写，否则同一条路径换个方向仍然成立',
  },
  {
    name: 'Pull request linked to issue',
    enabled: false,
    why: '写 Status，触发事件属于工程轴。实测曾把一个显式设定的 In Review 覆盖成 In Progress',
  },
  {
    name: 'Code review approved',
    enabled: false,
    why: '写 Status，而评审结论属于工程轴——它的落点是 Engineering 字段，不是 Status',
  },
  {
    name: 'Code changes requested',
    enabled: false,
    why: '同 Code review approved：评审过程的结论属于工程轴',
  },
  {
    name: 'Pull request merged',
    enabled: false,
    why: '写 Status，而合并是工程执行事实——不变量 3 明确点名禁止「PR 合并默认覆盖规划状态」',
  },
  {
    name: 'Auto-close issue',
    enabled: false,
    why: '方向相反的跨轴写入：把人写的 Status = Done 反推成一个工程事实（关闭 issue），并与 Item closed 首尾相接构成回环',
  },
]

/**
 * 必须保持 `enabled: false` 的工作流名单，由 EXPECTED **推导**而不是另行维护。
 *
 * 手写第二份清单就是再造一处会漂移的副本——那正是 AGENTS.md §8.7 为 area 词表
 * 消除掉的那类问题。当前推导结果是 7 条。
 */
export const MUST_BE_DISABLED = EXPECTED.filter((rule) => !rule.enabled).map((rule) => rule.name)

/**
 * 比对实际状态与裁决表，返回四类偏离。
 *
 * | kind | 含义 |
 * |---|---|
 * | `should-be-disabled` | 该关的开着——直接破坏不变量 3，排最前 |
 * | `unknown` | 裁决表里没有这条 |
 * | `should-be-enabled` | 该开的关着 |
 * | `missing` | 裁决表里有，看板上已不存在 |
 *
 * `unknown` 这一类值得单独说：GitHub 新增内置工作流时不会通知任何人，而新增的工作流
 * 默认没有被裁决过。一份只查「该关的有没有开」的清单会对第十条视而不见——所以未裁决
 * 的工作流必须让检查变红，逼一次显式判断，而不是默认放行。
 *
 * Fail-closed 的输入校验（与 AGENTS.md §9.5「解析不了的 workflow 会让检查直接失败，
 * 不会静默放行」同一立场）：输入形状不对不会被吞掉变成「没有偏离」。一个解析不出结构
 * 的输入不代表合规，那是调用方或数据源坏了，必须显式抛错——否则运行时接线出问题时，
 * 这条检查会安静地变绿，正好是它要防的那种失效。
 *
 * @param {Array<{name: string, enabled: boolean}>} actual GitHub `projectV2.workflows { nodes { name enabled } }` 的返回
 * @param {Array<{name: string, enabled: boolean, why: string}>} [expected] 裁决表，默认 EXPECTED
 * @returns {Array<{kind: string, name: string, message: string}>} 偏离项，破坏不变量的排前面
 */
export function boardWorkflowFindings(actual, expected = EXPECTED) {
  assertWorkflowList(actual, 'actual')
  assertRuleList(expected, 'expected')

  const byName = new Map(actual.map((item) => [item.name, item]))
  const findings = []

  for (const rule of expected) {
    const found = byName.get(rule.name)
    if (found === undefined) {
      findings.push({
        kind: 'missing',
        name: rule.name,
        message: '裁决表里有这条，但看板上已经不存在——GitHub 可能改了名字，需要重新裁决',
      })
      continue
    }
    if (found.enabled !== rule.enabled) {
      findings.push({
        kind: rule.enabled ? 'should-be-enabled' : 'should-be-disabled',
        name: rule.name,
        message: rule.enabled ? `应当开启但现在关着：${rule.why}` : `应当关闭但现在开着：${rule.why}`,
      })
    }
  }

  const ruled = new Set(expected.map((rule) => rule.name))
  for (const item of actual) {
    if (!ruled.has(item.name)) {
      findings.push({
        kind: 'unknown',
        name: item.name,
        message:
          `裁决表里没有这条（当前${item.enabled ? '开启' : '关闭'}）。` +
          'GitHub 新增内置工作流时不会通知任何人——必须按推导规则显式裁决它写不写 Status',
      })
    }
  }

  const severity = { 'should-be-disabled': 0, unknown: 1, 'should-be-enabled': 2, missing: 3 }
  return findings.sort((a, b) => severity[a.kind] - severity[b.kind])
}

function assertWorkflowList(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`boardWorkflowFindings: ${label} 必须是数组，实际收到 ${describeType(value)}`)
  }
  value.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(
        `boardWorkflowFindings: ${label}[${index}] 必须是 { name, enabled } 形状的对象，实际收到 ${describeType(item)}`,
      )
    }
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new TypeError(`boardWorkflowFindings: ${label}[${index}].name 必须是非空字符串`)
    }
    if (typeof item.enabled !== 'boolean') {
      throw new TypeError(
        `boardWorkflowFindings: ${label}[${index}].enabled 必须是 boolean，实际收到 ${describeType(item.enabled)}`,
      )
    }
  })
}

function assertRuleList(value, label) {
  assertWorkflowList(value, label)
  value.forEach((rule, index) => {
    if (typeof rule.why !== 'string' || rule.why.length === 0) {
      throw new TypeError(`boardWorkflowFindings: ${label}[${index}].why 必须是非空字符串——理由要随数据走`)
    }
  })
}

function describeType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
