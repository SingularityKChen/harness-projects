/**
 * Execution 契约套件的两份适配器装配：离线替身与人工执行 provider，各带判别性用例。
 *
 * 替身侧保护的不变量：失败信息指明的正是替身计划里出错的阶段（把阶段名从错误信息里去掉，套件的
 * "带阶段名的结构化错误"用例必然失败）；port 没有 reconcile，替身也不提供假的观察流。
 *
 * 人工 provider 侧保护的不变量：人工运行是一次处于 `running` 的运行而不是终态、不新增领域枚举取值；
 * `getRun` 是 ref 的纯函数（同一 binding 的**新实例**拿着同一个引用读回逐字段相同的标记，不靠**实例**
 * 内存——"没有模块级可变状态"这半边由套件的种子运行用例兜住：它读一个本进程从未启动过的运行）；
 * **身份闸门是形状闸门**——无状态 provider 判不了来源，只判 binding / objectKind / 形态（严格 ISO 8601
 * 往返，不是宽松的 `Date.parse`），这个边界如实钉住而不是假装成来源闸门；`startRun` 与 `cancelRun`
 * 发出的引用都一定可被自己反解（往返），否则是 `invalid_input`，且错误归因到真正的成因；取消把权威
 * 状态写进返回的引用，而它的作用域是**引用**不是运行身份（对同一个原始引用取消两次会得到两个各自
 * 成立的 canceled 引用，收口条件见 issue #172）。套件与替身适配器都未因此改动。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'
import { ExecutionRunStatus } from '@harness-projects/domain'
import { createFakeExecutionProvider } from '@harness-projects/provider-fake'
import { MANUAL_STAGE, createHumanExecutionProvider } from '@harness-projects/provider-execution-human'
import { executionContractSuite } from './suites/execution.js'

const bindingId = 'binding-fake-execution'
const context = { bindingId, objectKind: 'execution_context', externalId: 'context-1', url: undefined }

executionContractSuite({
  label: '离线 Execution 替身',
  makeProvider: (scenario = {}) => createFakeExecutionProvider({ bindingId, ...scenario }),
  expect: {
    context, stages: ['prepare', 'execute', 'collect'], failedStage: 'prepare',
    seededRunExternalId: 'run-1', seededRunStatus: 'succeeded', runningRunExternalId: 'run-2',
  },
})

test('Execution 替身：失败信息指明的就是替身计划中出错的阶段', async () => {
  const provider = createFakeExecutionProvider({ bindingId, faults: { harnessFailure: true }, failingStage: 'execute' })
  const result = await provider.startRun({ context, command: 'task verify', environment: {} })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'unavailable')
  assert.ok(result.error.message.includes('execute'), `错误信息必须点名 execute（实际：${result.error.message}）`)
  assert.equal(result.error.message.includes('prepare'), false, '不得把别的阶段说成失败阶段')
})

test('Execution 替身：已结束的运行不允许被取消，返回 conflict 而不是假装成功', async () => {
  const provider = createFakeExecutionProvider({ bindingId })
  const finished = { ...context, objectKind: 'execution_run', externalId: 'run-1' }
  const result = await provider.cancelRun(finished)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'conflict')
  const read = await provider.getRun(finished)
  assert.equal(read.value.status, 'succeeded', '被拒的取消不得改动运行状态')
})

test('Execution 替身：不提供 reconcile，没有事件源就不假装有观察流', () => {
  const provider = createFakeExecutionProvider({ bindingId })
  assert.equal(provider.reconcile, undefined)
})

// ── 人工执行 provider：与替身并列的第二份适配器 ───────────────────────────────
//
// 套件的 scenario 是固定的三条（harness 启动失败 / 可选取消未启用 / 离线）。人工 provider 用**只读
// 构造配置**表达它们，因此套件本身与替身适配器都不需要改动：故障是配置，不是可变开关。
//
// 映射时故障名与语义对齐：套件的 `harnessFailure`（"执行 harness 起不来"）映射到 provider 的
// `startUnavailable`（"本执行 provider 无法启动运行"）。**不要**映射成"人工接管通道不可用"——那会让
// "已转人工"这个结论由被转往的那一方产生，是自相矛盾的降级场景。

const humanBindingId = 'binding-human-execution'
const humanContext = { bindingId: humanBindingId, objectKind: 'execution_context', externalId: 'context-human-1', url: undefined }
const humanRunRef = (externalId) => ({ ...humanContext, objectKind: 'execution_run', externalId })
const seededManualRun = 'manual-run:context-human-1@2026-09-24T00:00:00.000Z'
const runningManualRun = 'manual-run:context-human-2@2026-09-24T00:00:00.000Z'
const humanClock = () => '2026-09-24T00:00:00.000Z'

function humanProvider(scenario = {}) {
  return createHumanExecutionProvider({
    bindingId: humanBindingId,
    clock: humanClock,
    capabilities: scenario.capabilities,
    faults: {
      offline: scenario.faults?.offline === true,
      startUnavailable: scenario.faults?.harnessFailure === true,
    },
  })
}

const startHumanRun = (provider) =>
  provider.startRun({ context: humanContext, command: 'harness run work/x', environment: {} })

executionContractSuite({
  label: '人工执行 provider',
  makeProvider: humanProvider,
  expect: {
    context: humanContext, stages: [MANUAL_STAGE], failedStage: MANUAL_STAGE,
    seededRunExternalId: seededManualRun, seededRunStatus: 'running',
    runningRunExternalId: runningManualRun,
  },
})

const accessOfKey = (snapshot, key) => effectiveCapabilities(snapshot).find((item) => item.key === key)?.access ?? 'unavailable'

test('人工执行 provider：startRun 标记的是一次由人推进的 running 运行，不新增领域枚举取值', async () => {
  const started = await startHumanRun(humanProvider({}))
  assert.equal(started.ok, true)
  assert.equal(started.value.status, ExecutionRunStatus.Running, '人工运行由人推进：状态是 running，不是终态')
  assert.equal(started.value.startedAt, humanClock(), '人工运行也要有起始时刻')
  assert.equal(started.value.finishedAt, undefined)
  assert.equal(started.value.exitCode, undefined)
  assert.equal(started.value.logUrl, undefined, '人工执行没有平台日志页，不得伪造链接')
  assert.equal(started.value.ref.objectKind, 'execution_run')
  assert.match(started.value.ref.externalId, /^manual-run:context-human-1@/)
})

test('人工执行 provider：getRun 不靠进程内存，同一 binding 的新实例读回逐字段相同的标记', async () => {
  const started = await startHumanRun(humanProvider({}))
  const read = await humanProvider({}).getRun(started.value.ref)
  assert.equal(read.ok, true)
  assert.deepEqual(read.value, started.value, '读回必须逐字段等于启动时返回的标记（新实例没有共享内存）')
})

test('人工执行 provider：startRun 返回的引用同样由 provider 构造，不回显调用方 context 的字段', async () => {
  // 与 `getRun` 那条对偶：`getRun` / `cancelRun` 收的是调用方直接给的 `ref`，`startRun` 收的是调用方给的
  // `context`——入口不同，不变量是同一条「返回值里的引用一律由 provider 构造」。只有 `getRun` 有判别性
  // 用例时，把 `startRun` 改成展开 `context` 不会有任何用例变红（栈级第六轮 P3）。
  const provider = humanProvider({})
  const started = await provider.startRun({
    context: { ...humanContext, url: 'https://evil.example/fake-log', bogusExtra: { nested: ['x'] } },
  })
  assert.equal(started.ok, true)
  assert.equal(started.value.ref.url, undefined, '调用方塞进 context 的 url 不得被当成 provider 的输出')
  assert.equal('bogusExtra' in started.value.ref, false, '未知字段同样不得回显')
  assert.deepEqual(started.value.ref, humanRunRef(started.value.ref.externalId), '引用必须逐字段等于 provider 自己构造的那一个')
  const read = await provider.getRun(started.value.ref)
  assert.deepEqual(read.value, started.value, '启动后可读回同一运行（不回显不得破坏往返）')
})

test('人工执行 provider：身份闸门是**形状闸门**——binding / objectKind / 形态任一不符即 not_found', async () => {
  const provider = humanProvider({})
  const foreignBinding = await provider.getRun({ ...humanRunRef(seededManualRun), bindingId: 'binding-someone-else' })
  assert.equal(foreignBinding.ok, false)
  assert.equal(foreignBinding.error.code, 'not_found')
  assert.equal(foreignBinding.error.retryable, false)
  const foreignKind = await provider.getRun({ ...humanRunRef(seededManualRun), objectKind: 'repository' })
  assert.equal(foreignKind.ok, false)
  assert.equal(foreignKind.error.code, 'not_found')
  // 形态不符：没有 `manual-run:` 前缀、前缀之后反解不出上下文 id，或时刻不是**生成端那种形态**。
  // 后一类必须用严格 ISO 8601 往返判定——`Date.parse` 会放过 `foo 1` / `-1` / `0` / ` 2020-01-01`，
  // 还会把 `2026-02-30T00:00:00Z` 静默滚成 3 月 2 日，于是 `getRun` 会接受并原样回显不是时刻的字符串。
  for (const malformed of [
    'run-1', 'manual-run:', 'manual-run:ctx@not-an-instant',
    'manual-run:@2026-09-24T00:00:00.000Z', 'manual-run: @2026-09-24T00:00:00.000Z',
    'manual-run:ctx@foo 1', 'manual-run:ctx@-1', 'manual-run:ctx@0',
    'manual-run:ctx@2026-02-30T00:00:00Z', 'manual-run:ctx@ 2020-01-01',
    'manual-run:ctx@2026-09-24T00:00:00Z', 'manual-run:ctx@2026-09-24T00:00:00.000+00:00',
    'manual-run:ctx@2026-09-24T00:00:00.000Z#canceled@x',
    // 结束时刻早于起始时刻不是一个事实，只能由坏时钟或手工构造产生。
    'manual-run:ctx@2026-09-24T00:00:05.000Z#canceled@2026-09-24T00:00:01.000Z',
  ]) {
    const read = await provider.getRun(humanRunRef(malformed))
    assert.equal(read.ok, false, `形态不符的引用必须 not_found：${malformed}`)
    assert.equal(read.error.code, 'not_found')
  }
  const foreignCancel = await provider.cancelRun({ ...humanRunRef(runningManualRun), bindingId: 'binding-someone-else' })
  assert.equal(foreignCancel.ok, false)
  assert.equal(foreignCancel.error.code, 'not_found')
})

test('人工执行 provider：形状正确但并非本 provider 发出的引用会被当成一条 running 运行——这是被钉住的边界', async () => {
  // 无状态 provider 区分不了"自己发出的引用"与"调用方构造的同形引用"：引用本身就是唯一产物，
  // 没有第二份记录可以对照。这里如实断言这个边界，而不是留白或假装它是来源闸门。
  const provider = humanProvider({})
  const forged = humanRunRef('manual-run:never-started-by-me@2020-01-01T00:00:00.000Z')
  const read = await provider.getRun(forged)
  assert.equal(read.ok, true, '形状正确的引用被当作一条人工运行：无状态 provider 判不了来源')
  assert.equal(read.value.status, ExecutionRunStatus.Running)
  assert.equal(read.value.startedAt, '2020-01-01T00:00:00.000Z', '起始时刻来自引用本身，不是 provider 的记忆')
  // 取消同样只看形状：伪造引用也能被"取消"，得到的 finishedAt 来自 provider 的时钟。
  const canceled = await provider.cancelRun(forged)
  assert.equal(canceled.ok, true)
  assert.equal(canceled.value.status, ExecutionRunStatus.Canceled)
  assert.equal(canceled.value.finishedAt, humanClock())
})

test('人工执行 provider：getRun 返回的引用由 provider 重新构造，不回显调用方对象', async () => {
  // 形状闸门只校验 binding / objectKind / externalId 三项，其余字段（`url`、任何额外字段）不参与判定。
  // 原样回显它们等于把调用方的输入当 provider 的输出；回显同一个对象还会让调用方事后改写它，把已经
  // 返回的快照变成 ref 与 startedAt 自相矛盾的对象（第四轮 P3）。
  const provider = humanProvider({})
  const started = await provider.startRun({ context: humanContext })
  assert.equal(started.ok, true)
  const tampered = { ...started.value.ref, url: 'https://evil.example/fake-log', bogusExtra: { nested: ['x'] } }
  const read = await provider.getRun(tampered)
  assert.equal(read.ok, true)
  assert.notEqual(read.value.ref, tampered, '返回值不得是调用方那个对象本身')
  assert.equal(read.value.ref.url, undefined, '调用方塞进来的 url 不得被当成 provider 的输出')
  assert.equal('bogusExtra' in read.value.ref, false, '未知字段同样不得回显')
  assert.deepEqual(read.value, started.value, '重新构造之后读回仍必须逐字段等于 startRun 的返回值')
  // 别名：调用方事后改写自己那个 ref，已经返回的快照不得跟着变。
  const snapshot = await provider.getRun(started.value.ref)
  tampered.externalId = 'manual-run:ctx-other@2020-01-01T00:00:00.000Z'
  assert.equal(snapshot.value.ref.externalId, started.value.ref.externalId, '已返回的快照不得被调用方事后改写')
})

test('人工执行 provider：startRun 发出的引用一定可被自己反解（往返），反解不出来的上下文 id 是 invalid_input', async () => {
  const provider = humanProvider({})
  // 往返：正常上下文 id 上，startRun → getRun 必须逐字段读回同一个标记。含 `@` 但反解唯一的 id 也算正常：
  // `startedAt` 是 ISO 时刻、自身不含 `@`，所以反解取的是**最后一个** `@`，`ctx@<时刻>` 不会被误切。
  for (const externalId of ['context-human-1', 'ctx-9f2c', 'ctx.with.dots', 'ctx:with:colons', 'ctx@2020-01-01T00:00:00.000Z']) {
    const started = await provider.startRun({ context: { ...humanContext, externalId }, command: 'x', environment: {} })
    assert.equal(started.ok, true, `可反解的上下文 id 必须能启动：${externalId}`)
    const read = await provider.getRun(started.value.ref)
    assert.deepEqual(read.value, started.value, `startRun 发出的引用必须能被自己读回：${externalId}`)
  }
  // 反解不出来：上下文 id 含取消标记 `#canceled@`，派生出的引用会被切错字段（实测 `ctx-a#canceled@b` →
  // startRun 成功、getRun 返回 not_found）。必须在写入之前拒绝，而不是发一个读不回的引用出去。
  for (const externalId of ['ctx-a#canceled@b', 'ctx#canceled@2026-09-24T00:00:00.000Z']) {
    const result = await provider.startRun({ context: { ...humanContext, externalId }, command: 'x', environment: {} })
    assert.equal(result.ok, false, `含保留标记的上下文 id 必须被拒：${externalId}`)
    assert.equal(result.error.code, 'invalid_input')
    assert.equal(result.error.retryable, false)
  }
})

test('人工执行 provider：取消把权威状态写进返回的引用，重复取消是 conflict', async () => {
  const provider = humanProvider({})
  const canceled = await provider.cancelRun(humanRunRef(runningManualRun))
  assert.equal(canceled.ok, true)
  assert.equal(canceled.value.status, ExecutionRunStatus.Canceled)
  assert.equal(canceled.value.finishedAt, humanClock())
  assert.notEqual(canceled.value.ref.externalId, runningManualRun, '取消必须发出一个新的标记引用，而不是只改返回值')
  const read = await provider.getRun(canceled.value.ref)
  assert.deepEqual(read.value, canceled.value, '取消后的状态必须能从返回的引用读回')
  const again = await provider.cancelRun(canceled.value.ref)
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'conflict', '终态不可再取消')
  // 已知代价（ExecPlan D4）：无状态 provider 撤销不了已经发出的 running 标记；权威记录在 Storage。
  const stale = await provider.getRun(humanRunRef(runningManualRun))
  assert.equal(stale.value.status, ExecutionRunStatus.Running)
})

test('人工执行 provider：取消的作用域是**引用**——对同一个原始引用取消两次得到两个各自成立的 canceled 引用', async () => {
  // 无状态 provider 只有调用方给的那一个引用，撤销不了已经发出的 running 标记。这里如实钉住这个边界，
  // 而不是靠新增进程内状态去"修"——那会推翻"无进程内状态"这条纪律。
  let tick = 0
  const provider = createHumanExecutionProvider({
    bindingId: humanBindingId,
    clock: () => new Date(Date.UTC(2026, 8, 24, 0, 0, tick++)).toISOString(),
  })
  const started = await startHumanRun(provider)
  const original = started.value.ref
  const first = await provider.cancelRun(original)
  const second = await provider.cancelRun(original)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.notEqual(first.value.finishedAt, second.value.finishedAt, '两次取消各取一次时钟，是两个不同的事实')
  assert.notEqual(first.value.ref.externalId, second.value.ref.externalId)
  const originalRead = await provider.getRun(original)
  assert.equal(originalRead.value.status, ExecutionRunStatus.Running, '取消没有、也无法撤销原始引用上的 running')
  // 只有"已经带结束时刻的引用"再取消才是 conflict——描述里的"重复取消是 conflict"说的是这一种。
  const again = await provider.cancelRun(first.value.ref)
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'conflict')
  // 收口条件（issue #172）：core 必须在取消后用返回的引用替换已存的 externalId，否则一个运行身份
  // 会同时留下 running 与多个 canceled 事实。这条要求属于 #172 的验收，不属于本 provider。
})

test('人工执行 provider：cancelRun 也过往返校验——坏时钟不得发出读不回的引用，且错误归因到时钟', async () => {
  let calls = 0
  const provider = createHumanExecutionProvider({
    bindingId: humanBindingId,
    clock: () => (calls++ === 0 ? humanClock() : 'garbage'),
  })
  const started = await startHumanRun(provider)
  assert.equal(started.ok, true, '第一次调用取到合法时刻，启动成功')
  const canceled = await provider.cancelRun(started.value.ref)
  assert.equal(canceled.ok, false, '坏时钟下取消不得返回 ok 与一个 getRun 读不回的引用')
  assert.equal(canceled.error.code, 'invalid_input')
  assert.match(canceled.error.message, /时刻/, '错误必须归因到时钟')
  assert.doesNotMatch(canceled.error.message, /保留标记/, '上下文 id 没有问题，不得归因给它')
})

test('人工执行 provider：只读配置真的只读——faults 与 capabilities 被冻结', async () => {
  const provider = humanProvider({ faults: { startUnavailable: false } })
  assert.equal(Object.isFrozen(provider.faults), true, 'faults 是只读构造配置，冻结之后类型层的说法才成立')
  assert.equal(Object.isFrozen(provider.flags), true)
  assert.throws(() => { provider.faults.startUnavailable = true }, TypeError)
  const started = await startHumanRun(provider)
  assert.equal(started.ok, true, '运行时改不动 faults，启动仍然成功')
})

test('人工执行 provider：能力快照恰好声明真正实现的三项，且每项都有 permission', async () => {
  const provider = humanProvider({})
  const snapshot = await provider.describeCapabilities()
  assert.deepEqual(
    Object.keys(snapshot.capability).sort(),
    [CapabilityKey.ExecutionRunCancel, CapabilityKey.ExecutionRunRead, CapabilityKey.ExecutionRunStart].sort(),
  )
  for (const key of Object.values(CapabilityKey)) {
    if (Object.hasOwn(snapshot.capability, key)) assert.equal(accessOfKey(snapshot, key), 'available')
  }
  assert.equal(provider.reconcile, undefined, 'port 故意没有 reconcile，人工 provider 也不提供观察流')
})
