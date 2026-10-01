// docs/product/board-semantics.md §4–§5（推导规则与十行裁决表）的可执行表述。
//
// 这一层测纯函数，不调用 gh、不联网：裁决表对不对与仓库当前的真实看板状态无关——
// 真实看板的运行时核对留给 PR #61（见 scripts/board-workflow-check.mjs 头部注释）。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  EXPECTED,
  MUST_BE_DISABLED,
  boardWorkflowFindings,
  manualPreconditions,
} from '../../scripts/board-workflow-check.mjs'

const SEMANTICS = new URL('../../docs/product/board-semantics.md', import.meta.url)

/**
 * 从 docs/product/board-semantics.md §5 读出裁决表的 [名字, 是否开启]。
 * 按位置识别表格：§5 标题后的第一张表，跳过表头与 `|---|` 分隔行，取到第一个
 * 不以 `|` 开头的行为止。每一行都必须读出「工作流」列的第一段反引号作为名字、
 * 最后一列是 **开启** / **关闭**；任何一行读不出就直接失败，而不是跳过——
 * 跳过会让文档侧新增的一行裁决静默漏判。
 */
function rulingTableFromDocs() {
  const lines = readFileSync(SEMANTICS, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^## 5\. /.test(line))
  assert.ok(start >= 0, 'board-semantics.md 缺 §5 裁决表')
  const header = lines.findIndex((line, index) => index > start && line.startsWith('|'))
  assert.ok(header > start, '§5 下没有表格')
  assert.match(lines[header + 1] ?? '', /^\|[-| ]+\|$/, '§5 表头下一行应是 |---| 分隔行')
  const rows = []
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const name = /`([^`]+)`/.exec(cells[0])?.[1]
    const ruling = cells.at(-1)
    assert.ok(name, `§5 行读不出工作流名：${line}`)
    assert.ok(ruling === '**开启**' || ruling === '**关闭**', `§5 行的裁决不是 **开启** / **关闭**：${line}`)
    rows.push([name, ruling === '**开启**'])
  }
  return rows
}

/** 裁决表说该开启的那些，按 EXPECTED 推导，不另行手写。 */
const ALLOWED_TO_ENABLE = EXPECTED.filter((rule) => rule.enabled).map((rule) => rule.name)

/** 一份与裁决表完全一致的实际状态。 */
const conforming = () => EXPECTED.map((rule) => ({ name: rule.name, enabled: rule.enabled }))

const kinds = (findings) => findings.map((f) => f.kind)
const names = (findings) => findings.map((f) => f.name)

test('裁决表与 docs/product/board-semantics.md 的十行表一致（条数、名字、期望状态都不漂移）', () => {
  // 来源真值是 docs/product/board-semantics.md §5 的十行裁决表。这里把三样东西
  // 都钉死：十条的名字、每条的期望状态、以及推导出的「必须关闭」是 7 条。
  // 改动任意一边而没有同步改另一边，这条测试就会红——这正是它存在的理由。
  assert.deepEqual(
    EXPECTED.map((rule) => [rule.name, rule.enabled]),
    [
      ['Auto-add sub-issues to project', true],
      ['Auto-add to project', true],
      ['Item added to project', true],
      ['Item closed', false],
      ['Item reopened', false],
      ['Pull request linked to issue', false],
      ['Code review approved', false],
      ['Code changes requested', false],
      ['Pull request merged', false],
      ['Auto-close issue', false],
    ],
  )
  assert.equal(EXPECTED.length, 10)
  assert.equal(MUST_BE_DISABLED.length, 7)
  assert.equal(ALLOWED_TO_ENABLE.length, 3)
})

test('Auto-add to project 的开启以「过滤条件不含 PR」为前提，且理由写明该前提只能人工核对', () => {
  // 开启的依据是它只加 issue：PR 是工程产物，被自动加进规划看板就是跨轴写入成员关系。
  // projectV2.workflows 不返回过滤条件，检查器只能核对 enabled，所以前提必须留在理由里，
  // 读到这条裁决的人才知道「开着」本身不证明合规。
  const rule = EXPECTED.find((r) => r.name === 'Auto-add to project')
  assert.ok(rule, '裁决表缺 Auto-add to project')
  assert.equal(rule.enabled, true)
  assert.ok(rule.why.includes('不含 PR'), '理由应写明过滤条件不含 PR 这一前提')
  assert.ok(rule.why.includes('人工核对'), '理由应写明 API 读不到过滤条件、只能人工核对')
  assert.equal(typeof rule.precondition, 'string', '只能人工核对的前提要单列成 precondition，检查通过时才能被输出')
  assert.ok(rule.precondition.includes('不含 PR'), 'precondition 应写明过滤条件不含 PR')
})

test('裁决表与 docs/product/board-semantics.md §5 逐行一致——文档侧漂移同样变红', () => {
  // 上一条测试钉住的是 EXPECTED 与测试里手写的列表；这一条直接读 §5 表本身，
  // 删掉文档里的一行或翻转它的裁决都会让这里失败。
  const fromDocs = rulingTableFromDocs()
  const fromCode = EXPECTED.map((rule) => [rule.name, rule.enabled])
  const byName = (a, b) => a[0].localeCompare(b[0])
  assert.deepEqual([...fromDocs].sort(byName), [...fromCode].sort(byName))
})

test('manualPreconditions：只列出带人工前提的裁决，供检查通过时输出', () => {
  assert.deepEqual(
    manualPreconditions().map((item) => item.name),
    ['Auto-add to project'],
  )
  for (const item of manualPreconditions()) {
    assert.equal(item.precondition, EXPECTED.find((rule) => rule.name === item.name).precondition)
  }
})

test('fail-closed：precondition 存在时必须是非空字符串', () => {
  const broken = EXPECTED.map((rule) => ({ ...rule }))
  broken[0].precondition = ''
  assert.throws(() => boardWorkflowFindings(conforming(), broken), /precondition/)
})

test('每条裁决都带 why——理由随数据走，检查输出才能自解释', () => {
  for (const rule of EXPECTED) {
    assert.equal(typeof rule.why, 'string', `${rule.name} 缺 why`)
    assert.ok(rule.why.length > 10, `${rule.name} 的 why 太短，说明不了为什么`)
  }
})

test('裁决表不含重复项', () => {
  assert.equal(new Set(EXPECTED.map((r) => r.name)).size, EXPECTED.length)
})

test('实际状态与裁决表一致时，没有任何偏离', () => {
  assert.deepEqual(boardWorkflowFindings(conforming()), [])
})

test('不变量 3：该关的工作流开着，必须被报出来', () => {
  for (const name of MUST_BE_DISABLED) {
    const actual = conforming().map((w) => (w.name === name ? { ...w, enabled: true } : w))
    const findings = boardWorkflowFindings(actual)
    assert.deepEqual(kinds(findings), ['should-be-disabled'], `${name} 开着时应当恰好报一条 should-be-disabled`)
    assert.equal(findings[0].name, name)
    // 消息里要带上理由，读到红叉的人不必回去翻文档
    assert.ok(findings[0].message.includes('应当关闭但现在开着'), `${name} 的消息应说明方向`)
  }
})

test('七条同时开着时，七条都被报出来——不会只报第一条就停', () => {
  const actual = conforming().map((w) => (MUST_BE_DISABLED.includes(w.name) ? { ...w, enabled: true } : w))
  const findings = boardWorkflowFindings(actual)
  assert.equal(findings.length, 7)
  assert.deepEqual(names(findings).sort(), [...MUST_BE_DISABLED].sort())
})

test('双向：该开的工作流被误关，同样必须被报出来', () => {
  // 只查「该关的有没有开」会漏掉这个方向：Item added to project 被误关之后，
  // 新上板的条目会停在空状态，而没有任何东西报出来。
  for (const name of ALLOWED_TO_ENABLE) {
    const actual = conforming().map((w) => (w.name === name ? { ...w, enabled: false } : w))
    const findings = boardWorkflowFindings(actual)
    assert.deepEqual(kinds(findings), ['should-be-enabled'], `${name} 被关掉时应当恰好报一条 should-be-enabled`)
    assert.equal(findings[0].name, name)
  }
})

test('unknown：裁决表里没有的工作流必须变红，而不是默认放行', () => {
  // GitHub 新增内置工作流时不会通知任何人；本仓库实测过两次读取之间新增三条。
  // 未裁决的工作流默认放行，等于把「新增的那一条写不写 Status」这个判断永久搁置。
  const actual = [...conforming(), { name: 'Some New Built-in Workflow', enabled: true }]
  const findings = boardWorkflowFindings(actual)
  assert.deepEqual(kinds(findings), ['unknown'])
  assert.equal(findings[0].name, 'Some New Built-in Workflow')
  assert.ok(findings[0].message.includes('裁决表里没有这条'))
})

test('unknown：新增的工作流即使是关闭状态，也要报——关闭不等于已被裁决', () => {
  const actual = [...conforming(), { name: 'Another New Workflow', enabled: false }]
  assert.deepEqual(kinds(boardWorkflowFindings(actual)), ['unknown'])
})

test('missing：裁决表里有但看板上已不存在，报出来而不是当成已关闭', () => {
  // 缺失不等于合规：名字被 GitHub 改掉时，静默跳过会让这条裁决永久失效。
  const actual = conforming().filter((w) => w.name !== 'Item closed')
  const findings = boardWorkflowFindings(actual)
  assert.deepEqual(kinds(findings), ['missing'])
  assert.equal(findings[0].name, 'Item closed')
})

test('排序：破坏不变量的 should-be-disabled 排在其它类别之前', () => {
  const actual = conforming()
    .map((w) => (w.name === 'Item added to project' ? { ...w, enabled: false } : w))
    .map((w) => (w.name === 'Pull request merged' ? { ...w, enabled: true } : w))
    .filter((w) => w.name !== 'Auto-close issue')
    .concat([{ name: 'Brand New Workflow', enabled: true }])
  const findings = boardWorkflowFindings(actual)
  assert.deepEqual(kinds(findings), ['should-be-disabled', 'unknown', 'should-be-enabled', 'missing'])
})

test('fail-closed：actual 不是数组时抛错，而不是静默返回空结果', () => {
  // 运行时接线取数失败时，这条检查绝不能安静变绿——那正是它要防的失效形态。
  for (const bad of [undefined, null, 'x', 42, {}]) {
    assert.throws(() => boardWorkflowFindings(bad), TypeError)
  }
})

test('fail-closed：actual 条目不是对象、缺 name、或 enabled 不是 boolean 时抛错', () => {
  assert.throws(() => boardWorkflowFindings(['Item closed']), TypeError)
  assert.throws(() => boardWorkflowFindings([{ enabled: false }]), TypeError)
  assert.throws(() => boardWorkflowFindings([{ name: '', enabled: false }]), TypeError)
  // 字符串 "false" 是假值陷阱：被当成假值就会把一条开着的工作流读成关着的
  assert.throws(() => boardWorkflowFindings([{ name: 'Item closed', enabled: 'false' }]), TypeError)
})

test('fail-closed：expected 形状不对时抛错，含缺 why 的裁决', () => {
  const actual = conforming()
  assert.throws(() => boardWorkflowFindings(actual, 'not-an-array'), TypeError)
  assert.throws(() => boardWorkflowFindings(actual, [{ name: 'X', enabled: false }]), TypeError)
  assert.throws(() => boardWorkflowFindings(actual, [{ name: 'X', enabled: false, why: '' }]), TypeError)
})

test('纯函数：不联网、不读外部状态——同一输入重复调用结果相同', () => {
  const actual = conforming().map((w) => (w.name === 'Item closed' ? { ...w, enabled: true } : w))
  assert.deepEqual(boardWorkflowFindings(actual), boardWorkflowFindings(actual))
})
