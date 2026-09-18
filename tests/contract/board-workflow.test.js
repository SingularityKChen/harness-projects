// docs/product/board-semantics.md §4–§5（推导规则与九行裁决表）的可执行表述。
//
// 这一层测纯函数，不调用 gh、不联网：裁决表对不对与仓库当前的真实看板状态无关——
// 真实看板的运行时核对留给 PR #61（见 scripts/board-workflow-check.mjs 头部注释）。

import assert from 'node:assert/strict'
import test from 'node:test'

import { EXPECTED, MUST_BE_DISABLED, boardWorkflowFindings } from '../../scripts/board-workflow-check.mjs'

/** 裁决表说该开启的那些，按 EXPECTED 推导，不另行手写。 */
const ALLOWED_TO_ENABLE = EXPECTED.filter((rule) => rule.enabled).map((rule) => rule.name)

/** 一份与裁决表完全一致的实际状态。 */
const conforming = () => EXPECTED.map((rule) => ({ name: rule.name, enabled: rule.enabled }))

const kinds = (findings) => findings.map((f) => f.kind)
const names = (findings) => findings.map((f) => f.name)

test('裁决表与 docs/product/board-semantics.md 的九行表一致（条数、名字、期望状态都不漂移）', () => {
  // 来源真值是 docs/product/board-semantics.md §5 的九行裁决表。这里把三样东西
  // 都钉死：九条的名字、每条的期望状态、以及推导出的「必须关闭」是 7 条。
  // 改动任意一边而没有同步改另一边，这条测试就会红——这正是它存在的理由。
  assert.deepEqual(
    EXPECTED.map((rule) => [rule.name, rule.enabled]),
    [
      ['Auto-add sub-issues to project', true],
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
  assert.equal(EXPECTED.length, 9)
  assert.equal(MUST_BE_DISABLED.length, 7)
  assert.equal(ALLOWED_TO_ENABLE.length, 2)
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
  // 未裁决的工作流默认放行，等于把「第十条写不写 Status」这个判断永久搁置。
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
