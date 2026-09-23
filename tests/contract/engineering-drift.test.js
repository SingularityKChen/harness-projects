// `Engineering` 漂移判定的契约。
//
// 两层：`engineering-drift.mjs` 是纯函数（离线、无凭据），
// `check-engineering-drift-live.mjs` 只负责取一份完整快照、交给纯函数、把任何不可信
// 输入或 finding 变成非零退出码。测试全程注入 fetch，不访问网络。
//
// 传输与结构故障用**表驱动**覆盖：这个 adapter 的契约是「任何结构异常都抛错而不是
// 跳过」，逐条写测试会把同一件事重复十几遍，而漏掉一条就等于给假绿留一扇门。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

import { describeFinding, engineeringDriftFindings } from '../../scripts/engineering-drift.mjs'
import { runEngineeringDriftCheck } from '../../scripts/check-engineering-drift-live.mjs'
// 投影与**选择策略**都来自投影权威：观察者没有自己的「谁说了算」实现（issue #115）。
import { expectedFor, MAX_PAGES, PR_STATES, stateForSnapshot } from '../../scripts/sync-engineering-state.mjs'

const OPEN_APPROVED = { state: 'OPEN', merged: false, isDraft: false, reviewDecision: 'APPROVED' }
const OPEN_PLAIN = { state: 'OPEN', merged: false, isDraft: false, reviewDecision: null }
const MERGED = { state: 'MERGED', merged: true, isDraft: false, reviewDecision: null }
const CLOSED_UNMERGED = { state: 'CLOSED', merged: false, isDraft: false, reviewDecision: null }

const REF = (number, createdAt, snapshot, closingIssues) => ({ number, createdAt, closingIssues, ...snapshot })
const item = ({ issue, engineering, itemId = `item-${issue}` }) => ({ itemId, issue, engineering })

// ── 选择规则：唯一实现在投影权威里，本文件只从观察者的入口验证它 ──────────────
//
// `expectedFor` 住在 `scripts/sync-engineering-state.mjs`（写入口的模块），观察者
// import 它。因此下面这些用例同时是**写入口**的规则用例：两侧没有第二份实现可以
// 各自漂移（issue #115）。

test('已合并 PR 的 issue 期望 Merged —— 2026-09-22 故障的形状', () => {
  // 故障当时 reconcile 在合并事件上每次都失败，看板停在 `PR open`。本检查必须报出来。
  const { findings, checked, skipped } = engineeringDriftFindings({
    pullRequests: [REF(104, '2026-09-22T00:00:00Z', MERGED, [10])],
    items: [item({ issue: 10, engineering: 'PR open' })],
  })

  assert.equal(checked, 1)
  assert.equal(skipped, 0)
  assert.deepEqual(findings, [
    { issue: 10, itemId: 'item-10', expected: 'Merged', actual: 'PR open', prNumber: 104, rule: 'merged' },
  ])
})

test('已合并是终态且单调：有已合并 PR 时不看 open PR', () => {
  // 判据是「任一已合并」，不是「最新创建的那个」——否则一个后开的 open PR 会把
  // 已经交付的工作读回未合并。
  const { findings } = engineeringDriftFindings({
    pullRequests: [
      REF(200, '2026-09-22T10:00:00Z', OPEN_PLAIN, [7]),
      REF(150, '2026-09-21T10:00:00Z', MERGED, [7]),
    ],
    items: [item({ issue: 7, engineering: 'Merged' })],
  })
  assert.deepEqual(findings, [])
})

test('多条已合并 PR 引用同一 issue 时取创建时间最新的，取值恒为 Merged', () => {
  assert.deepEqual(
    expectedFor({ references: [REF(100, '2026-09-20T00:00:00Z', MERGED, [3]), REF(120, '2026-09-21T00:00:00Z', MERGED, [3])] }),
    { value: 'Merged', prNumber: 120, rule: 'merged' },
  )
})

test('没有已合并 PR 时取创建时间最新的 open PR，投影交给 stateForSnapshot', () => {
  assert.deepEqual(
    expectedFor({ references: [REF(10, '2026-09-20T00:00:00Z', OPEN_PLAIN, [5]), REF(11, '2026-09-21T00:00:00Z', OPEN_APPROVED, [5])] }),
    { value: 'Approved', prNumber: 11, rule: 'open' },
  )
})

test('全部 closed 且未合并时期望为空；草稿 open PR 同样期望为空', () => {
  assert.deepEqual(
    expectedFor({ references: [REF(9, '2026-09-20T00:00:00Z', CLOSED_UNMERGED, [4])] }),
    { value: null, prNumber: 9, rule: 'closed' },
  )
  const draft = { state: 'OPEN', merged: false, isDraft: true, reviewDecision: null }
  const { findings } = engineeringDriftFindings({
    pullRequests: [REF(12, '2026-09-20T00:00:00Z', draft, [6])],
    items: [item({ issue: 6, engineering: null })],
  })
  assert.deepEqual(findings, [])
})

test('没有被任何 PR 引用的条目跳过，不算漂移', () => {
  // `Engineering` 为空是合法状态。把未引用的条目也拿去比较，会把整块看板报成红的。
  const { findings, skipped, checked } = engineeringDriftFindings({
    pullRequests: [REF(104, '2026-09-22T00:00:00Z', MERGED, [10])],
    items: [item({ issue: 10, engineering: 'Merged' }), item({ issue: 99, engineering: null }), item({ issue: 98, engineering: null })],
  })
  assert.deepEqual(findings, [])
  assert.equal(skipped, 2)
  assert.equal(checked, 1)
})

test('选择规则对每个被接受的 PR state 都与 stateForSnapshot 一致', () => {
  // 这条按**行为**而不是按源码文本设防。源码正则（「禁止出现 PR_STATES 标识符」）
  // 既挡住正当复用，又能被换个写法绕过；而这里断言的是真正的性质：`PR_STATES` 的
  // 每个取值都必须有一个代表性快照，且选择结果与投影一致——否则该 state 会被
  // 选择规则静默忽略，正是本检查要防的那类假绿。
  const representatives = { OPEN: OPEN_PLAIN, CLOSED: CLOSED_UNMERGED, MERGED }

  assert.deepEqual(
    Object.keys(representatives).sort(),
    [...PR_STATES].sort(),
    '每个被 stateForSnapshot 接受的 state 都必须有代表性快照，新增 state 时这里会红',
  )
  for (const [state, snapshot] of Object.entries(representatives)) {
    const decision = stateForSnapshot(snapshot)
    const expected = expectedFor({ references: [REF(1, '2026-09-20T00:00:00Z', snapshot, [1])] })
    assert.equal(expected.value, decision.kind === 'clear' ? null : decision.value, `state ${state} 的选择结果与投影不一致`)
  }
})

test('畸形输入 fail closed，不读成"没有漂移"', () => {
  assert.deepEqual(engineeringDriftFindings({ pullRequests: [], items: [] }), { findings: [], skipped: 0, checked: 0 })

  const bad = [
    { pullRequests: null, items: [] },
    { pullRequests: [], items: null },
    { pullRequests: [{ number: 0, createdAt: '2026-09-20T00:00:00Z', closingIssues: [], ...MERGED }], items: [] },
    { pullRequests: [{ number: 1, createdAt: 'not-a-date', closingIssues: [], ...MERGED }], items: [] },
    { pullRequests: [{ number: 1, createdAt: '2026-09-20T00:00:00Z', closingIssues: 'x', ...MERGED }], items: [] },
    { pullRequests: [{ number: 1, createdAt: '2026-09-20T00:00:00Z', closingIssues: [1], state: 'OPEN', merged: 'no', isDraft: false }], items: [] },
    { pullRequests: [], items: [{ itemId: '', issue: 1, engineering: null }] },
    { pullRequests: [], items: [{ itemId: 'x', issue: 0, engineering: null }] },
  ]
  for (const input of bad) {
    assert.throws(() => engineeringDriftFindings(input), /必须是|不是可解析/)
  }
})

test('未知 PR 枚举在监测里也响亮失败，并回显是哪个 PR', () => {
  assert.throws(
    () => expectedFor({ references: [REF(42, '2026-09-20T00:00:00Z', { state: 'DRAFT', merged: false, isDraft: false, reviewDecision: null }, [1])] }),
    /PR #42 的快照无法投影：未知 PR state/,
  )
})

test('未被选中的引用带未知枚举时同样响亮失败，不把它当成 closed', () => {
  // 只投影被选中的那一个时，一个带未知 state 的引用会掉进 closed 桶被读成
  // 「未合并」——一次真实的枚举漂移于是静默变成「期望清空」。
  assert.throws(
    () => engineeringDriftFindings({
      pullRequests: [
        REF(104, '2026-09-22T00:00:00Z', MERGED, [10]),
        REF(105, '2026-09-23T00:00:00Z', { state: 'DRAFT', merged: false, isDraft: false, reviewDecision: null }, [10]),
      ],
      items: [item({ issue: 10, engineering: 'Merged' })],
    }),
    /PR #105 的快照无法投影：未知 PR state/,
  )
})

test('诊断文案同时给出期望、实际与依据', () => {
  const text = describeFinding({ issue: 10, itemId: 'i', expected: 'Merged', actual: 'PR open', prNumber: 104, rule: 'merged' })
  assert.match(text, /issue #10/)
  assert.match(text, /PR #104/)
  assert.match(text, /实际为「PR open」/)
  assert.match(text, /期望「Merged」/)
})

// ── 运行时 adapter ─────────────────────────────────────────────────────────

const SCRIPT_URL = new URL('../../scripts/check-engineering-drift-live.mjs', import.meta.url)
const WORKFLOW_URL = new URL('../../.github/workflows/board-invariants.yml', import.meta.url)

const validEnv = {
  PROJECTS_TOKEN: 'test-token',
  PROJECT_OWNER: 'octo-user',
  PROJECT_NUMBER: '10',
  GITHUB_REPOSITORY: 'owner/repo',
}

const response = (body, { ok = true, status = 200, jsonError } = {}) => ({
  ok,
  status,
  json: async () => {
    if (jsonError) throw jsonError
    return body
  },
})

const pullRequestsBody = (nodes, { totalCount = nodes.length, hasNextPage = false, endCursor = null } = {}) => ({
  data: { repository: { pullRequests: { totalCount, pageInfo: { hasNextPage, endCursor }, nodes } } },
})

const itemsBody = (nodes, { totalCount = nodes.length } = {}) => ({
  data: { user: { projectV2: { items: { totalCount, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } },
})

const graphqlNode = ({ number = 104, closingIssues = [10], ...snapshot } = {}) => ({
  number,
  state: 'MERGED',
  merged: true,
  isDraft: false,
  reviewDecision: null,
  createdAt: '2026-09-22T00:00:00Z',
  ...snapshot,
  closingIssuesReferences: { totalCount: closingIssues.length, nodes: closingIssues.map((n) => ({ number: n })) },
})

const itemNode = ({ id = 'item-10', issue = 10, engineering = 'PR open', repository = 'owner/repo' } = {}) => ({
  id,
  content: { number: issue, repository: { nameWithOwner: repository } },
  fieldValues: {
    nodes: engineering === null ? [] : [{ name: engineering, field: { name: 'Engineering' } }],
  },
})

/** 默认给一份「一条已合并 PR + 一个漂移条目」的快照，各用例按需覆盖。 */
const okFetch = (pullRequests = [graphqlNode()], items = [itemNode()]) =>
  async (_url, options) => response(
    JSON.parse(options.body).query.includes('EngineeringDriftPullRequests')
      ? pullRequestsBody(pullRequests)
      : itemsBody(items),
  )

async function run({ env = validEnv, fetchImpl = okFetch(), argv = [] } = {}) {
  const output = []
  const exitCode = await runEngineeringDriftCheck({ env, fetchImpl, write: (line) => output.push(line), argv })
  return { exitCode, output: output.join('\n') }
}

test('漂移时 exit 1 并输出可行动诊断；无漂移时 exit 0', async () => {
  const drifted = await run()
  assert.equal(drifted.exitCode, 1)
  assert.equal(drifted.output.split('\n').filter((line) => line.startsWith('::error::')).length, 1)
  assert.match(drifted.output, /issue #10/)
  assert.match(drifted.output, /1 \/ 1 个条目与 PR 真值不符/)

  const clean = await run({ fetchImpl: okFetch([graphqlNode()], [itemNode({ engineering: 'Merged' })]) })
  assert.equal(clean.exitCode, 0)
  assert.match(clean.output, /已比较 1 个看板条目/)
})

test('--json 只输出一行结构化结果', async () => {
  const { exitCode, output } = await run({ argv: ['--json'] })
  assert.equal(exitCode, 1)
  assert.equal(output.split('\n').length, 1)
  assert.equal(JSON.parse(output).findings[0].issue, 10)
})

test('只比较本仓库的看板条目，他仓 issue 与非 issue 条目都不参与', async () => {
  // 项目是 user 级的：他仓的 issue #10 若不按来源仓库过滤，会与本仓库 close #10 的
  // PR 误配（假红），或恰好匹配上而掩盖真漂移（假绿）。非 issue 条目没有 repository。
  const { exitCode, output } = await run({
    fetchImpl: okFetch(
      [graphqlNode()],
      [
        itemNode({ engineering: 'Merged' }),
        itemNode({ id: 'foreign', engineering: null, repository: 'someone-else/other' }),
        { id: 'pr-item', content: {}, fieldValues: { nodes: [] } },
      ],
    ),
  })
  assert.equal(exitCode, 0)
  assert.match(output, /已比较 1 个看板条目/)
})

test('分页成功路径：cursor 逐页传递，跨页结果拼接后一起比较', async () => {
  const cursors = []
  let page = 0
  const { exitCode, output } = await run({
    fetchImpl: async (_url, options) => {
      const { query, variables } = JSON.parse(options.body)
      if (!query.includes('EngineeringDriftPullRequests')) {
        return response(itemsBody([
          itemNode({ id: 'i10', issue: 10, engineering: 'Merged' }),
          itemNode({ id: 'i11', issue: 11, engineering: 'Merged' }),
        ]))
      }
      cursors.push(variables.cursor)
      page += 1
      return page === 1
        ? response(pullRequestsBody([graphqlNode({ number: 1, closingIssues: [10] })], { totalCount: 2, hasNextPage: true, endCursor: 'CURSOR-1' }))
        : response(pullRequestsBody([graphqlNode({ number: 2, closingIssues: [11] })], { totalCount: 2 }))
    },
  })

  assert.deepEqual(cursors, [null, 'CURSOR-1'])
  assert.equal(exitCode, 0)
  assert.match(output, /已比较 2 个看板条目/)
})

test('必需环境变量、仓库名与 project number 畸形时 fail closed', async (t) => {
  for (const [name, env] of [
    ['PROJECTS_TOKEN 缺失', { ...validEnv, PROJECTS_TOKEN: '' }],
    ['PROJECT_OWNER 缺失', { ...validEnv, PROJECT_OWNER: '' }],
    ['PROJECT_NUMBER 缺失', { ...validEnv, PROJECT_NUMBER: '' }],
    ['PROJECT_NUMBER 非正整数', { ...validEnv, PROJECT_NUMBER: '1.5' }],
    ['GITHUB_REPOSITORY 缺 owner', { ...validEnv, GITHUB_REPOSITORY: 'owner' }],
    ['GITHUB_REPOSITORY 多段', { ...validEnv, GITHUB_REPOSITORY: 'a/b/c' }],
  ]) {
    await t.test(name, async () => {
      const { exitCode, output } = await run({ env, fetchImpl: async () => { throw new Error('不应发起请求') } })
      assert.equal(exitCode, 1)
      assert.match(output, /^::error::/)
    })
  }
})

test('传输与响应结构故障全部 fail closed', async (t) => {
  const cases = [
    ['不提供 fetch', null],
    ['网络请求失败', async () => { throw new Error('socket closed') }],
    ['请求未成功', async () => response({}, { ok: false, status: 403 })],
    ['响应不是有效 JSON', async () => response(undefined, { jsonError: new SyntaxError('unexpected token') })],
    ['响应根不是对象', async () => response([1, 2])],
    ['errors 字段不是数组', async () => response({ errors: 'denied' })],
    ['返回 errors', async () => response({ errors: [{ message: 'denied' }] })],
    ['data 不是对象', async () => response({ data: null })],
    ['repository 为 null', async () => response({ data: { repository: null } })],
    ['pullRequests 为 null', async () => response({ data: { repository: { pullRequests: null } } })],
    ['pullRequests.nodes 不是数组', async () => response({ data: { repository: { pullRequests: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: 'x' } } } })],
    ['totalCount 不是非负整数', async () => response(pullRequestsBody([graphqlNode()], { totalCount: -1 }))],
    ['响应不完整', async () => response(pullRequestsBody([graphqlNode()], { totalCount: 5 }))],
    ['pageInfo 为 null', async () => response({ data: { repository: { pullRequests: { totalCount: 1, pageInfo: null, nodes: [graphqlNode()] } } } })],
    ['closingIssuesReferences 为 null', async () => response(pullRequestsBody([{ ...graphqlNode(), closingIssuesReferences: null }]))],
    ['closingIssuesReferences 快照不完整', async () => response(pullRequestsBody([
      { ...graphqlNode(), closingIssuesReferences: { totalCount: 5, nodes: [{ number: 10 }] } },
    ]))],
    ['user 为 null', async () => response({ data: { user: null } })],
    ['projectV2 为 null', async () => response({ data: { user: { projectV2: null } } })],
    ['items 为 null', async () => response({ data: { user: { projectV2: { items: null } } } })],
    ['fieldValues 为 null', async () => response(itemsBody([{ ...itemNode(), fieldValues: null }]))],
    ['fieldValues.nodes 不是数组', async () => response(itemsBody([{ ...itemNode(), fieldValues: { nodes: 'x' } }]))],
    ['多个 Engineering 字段值', async () => response(itemsBody([{
      ...itemNode(),
      fieldValues: { nodes: [{ name: 'Merged', field: { name: 'Engineering' } }, { name: 'PR open', field: { name: 'Engineering' } }] },
    }]))],
    ['item id 为空', async () => response(itemsBody([{ ...itemNode(), id: '' }]))],
    ['issue 号不是正整数', async () => response(itemsBody([{ ...itemNode(), content: { number: 0, repository: { nameWithOwner: 'owner/repo' } } }]))],
  ]

  for (const [name, fetchImpl] of cases) {
    await t.test(name, async () => {
      const { exitCode, output } = await run({ fetchImpl })
      assert.equal(exitCode, 1, `${name} 应 exit 1，实际输出：${output}`)
      assert.match(output, /^::error::/)
    })
  }
})

test('分页超过上限时 fail closed，不按截断输入判定', async () => {
  const endless = pullRequestsBody([graphqlNode()], { totalCount: 999, hasNextPage: true, endCursor: 'next' })
  let calls = 0
  const { exitCode, output } = await run({
    fetchImpl: async (_url, options) => {
      if (!JSON.parse(options.body).query.includes('EngineeringDriftPullRequests')) return response(itemsBody([]))
      calls += 1
      return response(endless)
    },
  })

  assert.equal(exitCode, 1)
  assert.equal(calls, MAX_PAGES)
  assert.match(output, /拒绝在截断的输入上判定/)
})

// ── CI 接线 ────────────────────────────────────────────────────────────────

test('漂移 job 挂在 Board invariants 上，且不引入手选 ref 的入口', () => {
  const source = readFileSync(fileURLToPath(WORKFLOW_URL), 'utf8')
  const workflow = parseYaml(source)

  // 不新增 workflow，只新增 job：触发、凭据与门禁姿态与既有 job 完全相同。
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['board-workflows', 'engineering-field'])

  // `workflow_dispatch` 带 ref 选择器，而被选中的 ref 同时决定 workflow 定义与
  // checkout 的脚本——这个 workflow 持有长效 PAT，所以那是一个真实的提权路径。
  assert.deepEqual(Object.keys(workflow.on), ['schedule'])

  const job = workflow.jobs['engineering-field']
  assert.equal(job['timeout-minutes'], 5)
  assert.equal(job.if, undefined)
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(job.steps[0].uses, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')
  assert.equal(job.steps[0].with['persist-credentials'], false)
  assert.equal(job.steps[1].uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')

  const runStep = job.steps.find((step) => step.run)
  assert.equal(runStep.run, 'node scripts/check-engineering-drift-live.mjs')
  assert.deepEqual(runStep.env, { PROJECTS_TOKEN: '${{ secrets.PROJECTS_TOKEN }}' })
  // token 只经 env 进入那一步，不进 job 级 env。
  assert.equal(job.env.PROJECTS_TOKEN, undefined)
  assert.equal(job.env.GITHUB_REPOSITORY, '${{ github.repository }}')
})

test('观察者与写入口共用同一份选择策略，自身不引入网络或子进程', () => {
  const source = readFileSync(fileURLToPath(new URL('../../scripts/engineering-drift.mjs', import.meta.url)), 'utf8')

  // 选择策略的唯一实现在投影权威里；观察者 import 它，而不是自带一份。
  assert.match(source, /import \{ expectedFor, FIELD_NAME, MAX_PAGES, PAGE_SIZE \} from '\.\/sync-engineering-state\.mjs'/)
  assert.doesNotMatch(source, /export function projectExpected/)
  // 纯函数模块不得引入网络或子进程，否则它进不了离线的 pnpm verify。
  assert.doesNotMatch(source, /from '(node:)?(child_process|http|https|net)'/)
  assert.doesNotMatch(source, /\bfetch\s*\(/)
})

/**
 * 相对 import 的**闭包**：从入口源码出发，递归跟随 `from './…'` 直到不再有本地依赖。
 *
 * 为什么不是只扫入口自己：观察者在 issue #115 之后 import 了投影权威，而「离线、无凭据
 * 的 `pnpm verify`」这条契约保护的是**整张 import 图**，不是某一个文件的文本。只扫入口
 * 时，往被 import 的模块里加一个顶层 `fetch()` 或 `child_process`，守卫仍然全绿。
 */
function relativeImportClosure(entryUrl) {
  const modules = new Map()
  const queue = [entryUrl]
  while (queue.length > 0) {
    const url = queue.shift()
    if (modules.has(url.href)) continue
    const source = readFileSync(fileURLToPath(url), 'utf8')
    modules.set(url.href, { url, source })
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('.')) queue.push(new URL(specifier, url))
    }
  }
  return modules
}

/**
 * 源码里出现的全部 import 说明符：`… from 'x'`、副作用 `import 'x'`、动态 `import('x')`，单双引号都算。
 * 只认 `from '…'` 时，换一种引号或换一种 import 写法就能把网络 / 子进程模块带进闭包而守卫全绿。
 */
function importSpecifiers(source) {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g)].map((match) => match[2])
}

const NETWORK_OR_PROCESS = /^(node:)?(child_process|http|https|net)$/

test('守卫覆盖 import 闭包，而不只是观察者自己的源码文本', () => {
  const entry = new URL('../../scripts/engineering-drift.mjs', import.meta.url)
  const closure = relativeImportClosure(entry)
  const paths = [...closure.values()].map((module) => fileURLToPath(module.url))

  // 闭包必须真的走通了那条 import 边：退化成「只有一个文件」时，下面的扫描会变成与
  // 上面那条重复的弱断言，而它本来要防的正是这个。
  assert.equal(closure.size, 2, `观察者的 import 闭包应恰好是它与投影权威两个模块，实际：${paths.join(', ')}`)
  assert.ok(paths.some((path) => path.endsWith('/sync-engineering-state.mjs')), '闭包必须含投影权威')

  for (const [href, module] of closure) {
    assert.deepEqual(importSpecifiers(module.source).filter((specifier) => NETWORK_OR_PROCESS.test(specifier)), [],
      `${href} 不得 import 网络或子进程模块`)
    assert.doesNotMatch(module.source, /\bfetch\s*\(/,
      `${href} 不得出现 fetch(...) 调用：闭包里的任何一处都会破坏离线 pnpm verify 的前提`)
  }
})
