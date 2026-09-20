/**
 * 领域状态契约测试（tests/README.md §2 优先级 2；ExecPlan A1 不变量 3、4）。保护的不变量：1) 归一化是纯函数，未知取值一律 unknown，不得猜测；2) 工程事实（CI 失败 / 执行完成 / PR 合并）在任何状态策略下都不改写规划状态；3) 派生标记只是投影，永远不能写回权威状态。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DerivedFlag,
  EngineeringFactKind,
  NormalizedStatus,
  StatusChangeSource,
  StatusPolicy,
  derivedFlagsFor,
  newEntityId,
  normalizePlanningStatus,
  planningStateFor,
  reconcilePlanningStatus,
} from '@harness-projects/domain'

const Todo = NormalizedStatus.Todo
const Done = NormalizedStatus.Done
const subjectId = newEntityId()
const fact = (kind) => ({ kind, subjectId })
const change = (current, incoming, source, policy) => ({ current, incoming, source, policy })
test('状态：归一化收敛到 6 个值，大小写与连字符不改变语义，未知取值不猜', () => {
  assert.equal(normalizePlanningStatus('  In Progress '), NormalizedStatus.InProgress)
  assert.equal(normalizePlanningStatus('in-progress'), NormalizedStatus.InProgress)
  assert.equal(normalizePlanningStatus('IN_PROGRESS'), NormalizedStatus.InProgress)
  assert.equal(normalizePlanningStatus('On-Hold'), NormalizedStatus.Blocked)
  assert.equal(normalizePlanningStatus('closed'), NormalizedStatus.Done)
  assert.equal(normalizePlanningStatus('wont-fix'), NormalizedStatus.Canceled)
  assert.equal(normalizePlanningStatus('nonsense'), NormalizedStatus.Unknown)
  assert.equal(normalizePlanningStatus(''), NormalizedStatus.Unknown)
})
test('状态：工程事实与派生标记在任何策略下都不改写规划状态（不变量 3）', () => {
  for (const policy of Object.values(StatusPolicy)) {
    for (const current of Object.values(NormalizedStatus)) {
      for (const incoming of Object.values(NormalizedStatus)) {
        for (const kind of Object.values(EngineeringFactKind)) {
          const next = reconcilePlanningStatus(
            change(current, incoming, StatusChangeSource.EngineeringFact, policy),
          )
          assert.equal(next, current, `${policy}/${kind} 不得把 ${current} 改成 ${incoming}`)
        }
        const projected = planningStateFor(current, [fact(EngineeringFactKind.CiFailed)])
        assert.equal(projected.status, current, '派生标记不得进入权威状态')
      }
    }
  }
})
test('状态：三态策略各自决定谁可以改写权威状态', () => {
  const matrix = {
    provider_authoritative: { planning_provider: 'in', host_user: 'keep', engineering_fact: 'keep' },
    host_authoritative: { planning_provider: 'keep', host_user: 'in', engineering_fact: 'keep' },
    manual_only: { planning_provider: 'keep', host_user: 'in', engineering_fact: 'keep' },
  }
  for (const [policy, expectations] of Object.entries(matrix)) {
    for (const [source, expectation] of Object.entries(expectations)) {
      const actual = reconcilePlanningStatus(change(Todo, Done, source, policy))
      assert.equal(actual, expectation === 'in' ? Done : Todo, `${policy} × ${source}`)
    }
    const unknown = reconcilePlanningStatus(
      change(Done, NormalizedStatus.Unknown, StatusChangeSource.HostUser, policy),
    )
    assert.equal(unknown, Done, '不可判定的 incoming 必须保持当前权威值')
  }
})
test('状态：派生标记只出现在 derived，顺序稳定且可复算', () => {
  const facts = [
    fact(EngineeringFactKind.CiFailed),
    fact(EngineeringFactKind.ChangeRequestMerged),
    fact(EngineeringFactKind.CiFailed),
  ]
  const merged = [DerivedFlag.Attention, DerivedFlag.CiFailing, DerivedFlag.Merged]
  assert.deepEqual(derivedFlagsFor(facts), merged)
  assert.deepEqual(planningStateFor(Todo, facts), { status: 'todo', derived: merged })
  assert.deepEqual(planningStateFor(Todo, [fact(EngineeringFactKind.CiPassed)]), {
    status: 'todo',
    derived: [],
  })
})
