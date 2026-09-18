// docs/product/board-semantics.md §4–§5（D2 的推导规则与九行裁决表）的可执行表述。
//
// 这一层测纯函数，不调用 gh、不联网：清单对不对与仓库当前的真实看板状态无关——
// 真实看板的运行时核对留给 PR #37（见 scripts/board-workflow-check.mjs 头部注释）。

import assert from 'node:assert/strict'
import test from 'node:test'

import { MUST_BE_DISABLED, boardWorkflowFindings } from '../../scripts/board-workflow-check.mjs'

const ALLOWED_TO_ENABLE = ['Item added to project', 'Auto-add sub-issues to project']

const allDisabled = () => MUST_BE_DISABLED.map((name) => ({ name, enabled: false }))

test('MUST_BE_DISABLED 与 docs/product/board-semantics.md 的九行裁决表一致（长度与顺序不漂移）', () => {
  // 来源真值是 docs/product/board-semantics.md §5：把九行裁决表里「裁决」列
  // 标记为「关闭」的行按表格顺序取出来，一共 7 行。这里把内容和长度都钉死，
  // 改动任意一边而没有同步改另一边，这条测试就会红——这正是它存在的理由。
  assert.deepEqual(MUST_BE_DISABLED, [
    'Item closed',
    'Item reopened',
    'Pull request linked to issue',
    'Code review approved',
    'Code changes requested',
    'Pull request merged',
    'Auto-close issue',
  ])
  assert.equal(MUST_BE_DISABLED.length, 7)
})

test('MUST_BE_DISABLED 不含重复项', () => {
  assert.equal(new Set(MUST_BE_DISABLED).size, MUST_BE_DISABLED.length)
})

test('规则允许开启的两条工作流不在 MUST_BE_DISABLED 里', () => {
  for (const name of ALLOWED_TO_ENABLE) {
    assert.ok(!MUST_BE_DISABLED.includes(name), `${name} 不应该出现在 MUST_BE_DISABLED`)
  }
})

test('不变量 3（规划轴与工程轴正交）：MUST_BE_DISABLED 中任意一条单独被打开，产生恰好一条 finding', () => {
  for (const name of MUST_BE_DISABLED) {
    const workflows = MUST_BE_DISABLED.map((n) => ({ name: n, enabled: n === name }))

    const findings = boardWorkflowFindings(workflows, MUST_BE_DISABLED)

    assert.equal(findings.length, 1, `${name} 单独打开时应当只产生一条 finding`)
    assert.ok(findings[0].includes(name), `finding 必须点名是哪个工作流：${findings[0]}`)
  }
})

test('不变量 3：多条同时被打开时，每条各自产生一条独立 finding，互不覆盖', () => {
  const opened = ['Item closed', 'Pull request merged', 'Auto-close issue']
  const workflows = MUST_BE_DISABLED.map((name) => ({ name, enabled: opened.includes(name) }))

  const findings = boardWorkflowFindings(workflows, MUST_BE_DISABLED)

  assert.equal(findings.length, opened.length)
  for (const name of opened) {
    assert.ok(findings.some((f) => f.includes(name)), `缺少 ${name} 的 finding`)
  }
})

test('不变量 3：MUST_BE_DISABLED 全部 enabled:false 时零 finding', () => {
  assert.deepEqual(boardWorkflowFindings(allDisabled(), MUST_BE_DISABLED), [])
})

test('规则允许开启的两条工作流（Item added to project / Auto-add sub-issues to project）enabled:true 时零 finding', () => {
  const workflows = [
    { name: 'Item added to project', enabled: true },
    { name: 'Auto-add sub-issues to project', enabled: true },
    ...allDisabled(),
  ]

  assert.deepEqual(boardWorkflowFindings(workflows, MUST_BE_DISABLED), [])
})

test('fail-closed：MUST_BE_DISABLED 中的工作流从 workflows 清单里整个缺失，算一条 finding，不是零', () => {
  const [missing, ...rest] = MUST_BE_DISABLED
  const workflows = rest.map((name) => ({ name, enabled: false })) // missing 完全不出现

  const findings = boardWorkflowFindings(workflows, MUST_BE_DISABLED)

  assert.equal(findings.length, 1)
  assert.ok(findings[0].includes(missing))
  assert.match(findings[0], /缺失/)
})

test('fail-closed：workflows 不是数组时抛错，而不是静默返回空数组', () => {
  assert.throws(() => boardWorkflowFindings(null, MUST_BE_DISABLED), TypeError)
  assert.throws(() => boardWorkflowFindings(undefined, MUST_BE_DISABLED), TypeError)
  assert.throws(() => boardWorkflowFindings('Item closed', MUST_BE_DISABLED), TypeError)
  assert.throws(() => boardWorkflowFindings({ name: 'Item closed', enabled: true }, MUST_BE_DISABLED), TypeError)
})

test('fail-closed：mustBeDisabled 不是数组时抛错', () => {
  assert.throws(() => boardWorkflowFindings(allDisabled(), null), TypeError)
  assert.throws(() => boardWorkflowFindings(allDisabled(), 'Item closed'), TypeError)
})

test('fail-closed：workflows 条目形状不对（缺 enabled 字段）时抛错，不会被当成关闭静默放行', () => {
  const workflows = [{ name: 'Item closed' }, ...MUST_BE_DISABLED.slice(1).map((name) => ({ name, enabled: false }))]

  assert.throws(() => boardWorkflowFindings(workflows, MUST_BE_DISABLED), TypeError)
})

test('fail-closed：enabled 字段不是 boolean（例如字符串 "false"）时抛错，不会被当成假值静默放行', () => {
  const workflows = [{ name: 'Item closed', enabled: 'false' }, ...MUST_BE_DISABLED.slice(1).map((name) => ({ name, enabled: false }))]

  assert.throws(() => boardWorkflowFindings(workflows, MUST_BE_DISABLED), TypeError)
})

test('fail-closed：workflows 条目不是对象（例如纯字符串数组）时抛错', () => {
  assert.throws(() => boardWorkflowFindings(['Item closed', 'Item reopened'], MUST_BE_DISABLED), TypeError)
})
