/**
 * Execution 契约套件的两份适配器装配：离线替身与人工执行 provider，各带判别性用例。
 *
 * 替身侧保护的不变量：失败信息指明的正是替身计划里出错的阶段（把阶段名从错误信息里去掉，套件的
 * "带阶段名的结构化错误"用例必然失败）；port 没有 reconcile，替身也不提供假的观察流。
 *
 * 人工 provider 侧：人工运行是 `running`、不新增枚举取值；`getRun` 是 ref 的纯函数（种子运行用例读一个本进程
 * 从未启动、由测试按同一签发者配置独立签出的运行）；**来源闸门**与签发者配置 fail closed；发出的引用一定往返；
 * 一次性输入不进引用。运行身份级的取消收敛在集成用例里钉住。
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
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
// 套件的三条 scenario 用**只读构造配置**表达（故障是配置，不是可变开关）；`harnessFailure` 映射到
// `startUnavailable`（本 provider 起不来），不映射成"人工接管通道不可用"——那会让"已转人工"由被转往的一方给出。

const humanBindingId = 'binding-human-execution'
const humanIssuerKey = 'issuer-key-for-human-execution-contract-tests'
const humanContext = { bindingId: humanBindingId, objectKind: 'execution_context', externalId: 'context-human-1', url: undefined }
const humanRunRef = (externalId) => ({ ...humanContext, objectKind: 'execution_run', externalId })
/** 测试作为**独立签发者**按同一配置签出引用：签名格式因此是被钉住的契约，不是 provider 的私有细节。 */
const signed = (body, { bindingId = humanBindingId, issuerKey = humanIssuerKey } = {}) =>
  `${body}~${createHmac('sha256', issuerKey).update(JSON.stringify([bindingId, body])).digest('base64url')}`
const seededManualRun = signed('manual-run:context-human-1@2026-09-24T00:00:00.000Z')
const runningManualRun = signed('manual-run:context-human-2@2026-09-24T00:00:00.000Z')
const humanClock = () => '2026-09-24T00:00:00.000Z'

function humanProvider(scenario = {}) {
  return createHumanExecutionProvider({
    bindingId: humanBindingId,
    issuerKey: humanIssuerKey,
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
  const { ok, value } = await startHumanRun(humanProvider({}))
  // 状态是 running 不是终态；有起始时刻；没有平台日志页，不得伪造链接。
  assert.deepEqual([ok, value.status, value.startedAt, value.finishedAt, value.exitCode, value.logUrl, value.ref.objectKind],
    [true, ExecutionRunStatus.Running, humanClock(), undefined, undefined, undefined, 'execution_run'])
  assert.match(value.ref.externalId, /^manual-run:context-human-1@/)
})

test('人工执行 provider：command / environment 是一次性输入，不进入引用或标记（port 义务 3）', async () => {
  const started = await humanProvider({}).startRun({
    context: humanContext, command: 'deploy --token s3cr3t-value', environment: { API_TOKEN: 's3cr3t-value' },
  })
  assert.equal(started.ok, true)
  assert.doesNotMatch(JSON.stringify(started.value), /s3cr3t-value|deploy/,
    'environment 可能携带凭据材料：返回值（因此 core 落库的 providerRef）不得带上任何一次性输入')
})

test('人工执行 provider：getRun 不靠进程内存，同一签发者配置的新实例读回逐字段相同的标记', async () => {
  const started = await startHumanRun(humanProvider({}))
  const read = await humanProvider({}).getRun(started.value.ref)
  assert.equal(read.ok, true)
  assert.deepEqual(read.value, started.value, '读回必须逐字段等于启动时返回的标记（新实例没有共享内存）')
})

test('人工执行 provider：startRun 返回的引用同样由 provider 构造，不回显调用方 context 的字段', async () => {
  // 与 `getRun` 那条对偶（port 义务 2）：只测 `getRun` 时，把 `startRun` 改成展开 `context` 不会变红（栈级第六轮 P3）。
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

test('人工执行 provider：binding / objectKind / 形态任一不符即 not_found（签名有效也不放行）', async () => {
  const provider = humanProvider({})
  const foreignBinding = await provider.getRun({ ...humanRunRef(seededManualRun), bindingId: 'binding-someone-else' })
  assert.equal(foreignBinding.ok, false)
  assert.equal(foreignBinding.error.code, 'not_found')
  assert.equal(foreignBinding.error.retryable, false)
  const foreignKind = await provider.getRun({ ...humanRunRef(seededManualRun), objectKind: 'repository' })
  assert.equal(foreignKind.ok, false)
  assert.equal(foreignKind.error.code, 'not_found')
  // 每一条都**按正确配置签过名**：判的是形态本身（严格 ISO 8601 往返，`Date.parse` 会放过其中大半）。
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
    const read = await provider.getRun(humanRunRef(signed(malformed)))
    assert.equal(read.ok, false, `形态不符的引用必须 not_found：${malformed}`)
    assert.equal(read.error.code, 'not_found')
  }
  for (const ref of [{ ...humanRunRef(seededManualRun), externalId: 42 }, null]) assert.equal((await provider.getRun(ref)).error.code, 'not_found', '畸形引用结构化失败，不抛错')
  const foreignCancel = await provider.cancelRun({ ...humanRunRef(runningManualRun), bindingId: 'binding-someone-else' })
  assert.equal(foreignCancel.ok, false)
  assert.equal(foreignCancel.error.code, 'not_found')
})

test('人工执行 provider：身份闸门是**来源闸门**——未签、改过、换密钥或换 binding 签出的同形引用一律 not_found', async () => {
  const provider = humanProvider({})
  const started = await startHumanRun(provider)
  const body = started.value.ref.externalId.slice(0, started.value.ref.externalId.lastIndexOf('~'))
  const forgeries = {
    未签名: 'manual-run:never-started-by-me@2020-01-01T00:00:00.000Z',
    改起始时刻: `${body.replace('2026-09-24', '2020-01-01')}${started.value.ref.externalId.slice(body.length)}`,
    自加取消标记: `${body}#canceled@2026-09-25T00:00:00.000Z${started.value.ref.externalId.slice(body.length)}`,
    换密钥: signed(body, { issuerKey: 'another-issuer-key-of-at-least-32-bytes!' }),
    别的binding签出: signed(body, { bindingId: 'binding-other-human' }),
  }
  for (const [kind, externalId] of Object.entries(forgeries)) {
    for (const call of ['getRun', 'cancelRun']) {
      const result = await provider[call](humanRunRef(externalId))
      assert.equal(result.ok, false, `${kind} 的引用不得被 ${call} 当成本 provider 签发的运行`)
      assert.equal(result.error.code, 'not_found', `${kind}：${call} 必须 fail closed`)
    }
  }
  assert.equal((await provider.getRun(started.value.ref)).ok, true, '对照：真正签发的引用仍可读回')
})

test('人工执行 provider：签发者配置缺失即拒绝构造——随机 binding 或空密钥会让重启后的实例读不回已落库的引用', () => {
  const issuerKey = humanIssuerKey
  for (const [kind, options] of Object.entries({
    缺bindingId: { issuerKey }, 空bindingId: { bindingId: ' ', issuerKey },
    缺issuerKey: { bindingId: humanBindingId }, 过短issuerKey: { bindingId: humanBindingId, issuerKey: 'short' },
  })) {
    assert.throws(() => createHumanExecutionProvider(options), TypeError, `${kind} 必须拒绝构造`)
  }
})

test('人工执行 provider：getRun 返回的引用由 provider 重新构造，不回显调用方对象', async () => {
  // 不参与判定的字段不得回显，回显同一个对象还会让调用方事后改写已返回的快照（port 义务 2，第四轮 P3）。
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
  // 往返：含 `@` / `~` 但反解唯一的 id 也算正常——时刻不含 `@`、签名不含 `~`，反解都取**最后一个**分隔符。
  for (const externalId of ['context-human-1', 'ctx-9f2c', 'ctx.with.dots', 'ctx:with:colons', 'ctx@2020-01-01T00:00:00.000Z', 'ctx~tilde~x']) {
    const started = await provider.startRun({ context: { ...humanContext, externalId }, command: 'x', environment: {} })
    assert.equal(started.ok, true, `可反解的上下文 id 必须能启动：${externalId}`)
    const read = await provider.getRun(started.value.ref)
    assert.deepEqual(read.value, started.value, `startRun 发出的引用必须能被自己读回：${externalId}`)
  }
  // 反解不出来：上下文 id 含取消标记 `#canceled@` 会被切错字段，必须在写入之前拒绝，而不是发一个读不回的引用。
  for (const externalId of ['ctx-a#canceled@b', 'ctx#canceled@2026-09-24T00:00:00.000Z', 'ctx#canceled']) {
    const result = await provider.startRun({ context: { ...humanContext, externalId }, command: 'x', environment: {} })
    assert.equal(result.ok, false, `含保留标记的上下文 id 必须被拒：${externalId}`)
    assert.equal(result.error.code, 'invalid_input')
    assert.equal(result.error.retryable, false)
    assert.match(result.error.message, /保留标记/, `必须归因到上下文 id，而不是 provider 缺陷：${externalId}`)
  }
  const foreign = await provider.startRun({ context: { ...humanContext, bindingId: 'binding-someone-else' }, command: 'x', environment: {} })
  assert.equal(foreign.error?.code, 'invalid_input', '别的 binding 的执行上下文不得启动')
  const badClock = createHumanExecutionProvider({ bindingId: humanBindingId, issuerKey: humanIssuerKey, clock: () => 'garbage' })
  assert.match((await startHumanRun(badClock)).error.message, /起始时刻不是 ISO 8601/, '坏时钟在发出引用之前被拒，并归因到时钟')
})

test('人工执行 provider：取消签发带结束时刻的新引用；provider 层的作用域是**引用**，不是运行身份', async () => {
  // 时钟逐次前进，两次取消才可区分；如实钉住 provider 层的边界，运行身份级的收敛在集成用例里。
  let tick = 0
  const provider = createHumanExecutionProvider({
    bindingId: humanBindingId, issuerKey: humanIssuerKey, clock: () => new Date(Date.UTC(2026, 8, 24, 0, 0, tick++)).toISOString(),
  })
  const original = (await startHumanRun(provider)).value.ref
  const first = await provider.cancelRun(original)
  assert.deepEqual([first.ok, first.value.status, first.value.finishedAt], [true, ExecutionRunStatus.Canceled, '2026-09-24T00:00:01.000Z'])
  assert.notEqual(first.value.ref.externalId, original.externalId, '取消必须签发新的引用，而不是只改返回值')
  assert.deepEqual((await provider.getRun(first.value.ref)).value, first.value, '取消后的状态必须能从返回的引用读回')
  const again = await provider.cancelRun(first.value.ref)
  assert.deepEqual([again.ok, again.error?.code], [false, 'conflict'], '已带结束时刻的引用不可再取消')
  const second = await provider.cancelRun(original)
  assert.notEqual(second.value.ref.externalId, first.value.ref.externalId, '同一原始引用再取消会签出第二个 canceled 引用')
  assert.equal((await provider.getRun(original)).value.status, ExecutionRunStatus.Running, '原始引用仍读回 running')
})

test('人工执行 provider：cancelRun 也过往返校验——坏时钟不得发出读不回的引用，且错误归因到时钟', async () => {
  let calls = 0
  const provider = createHumanExecutionProvider({
    bindingId: humanBindingId, issuerKey: humanIssuerKey,
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
  assert.deepEqual([Object.isFrozen(provider.faults), Object.isFrozen(provider.flags)], [true, true], '只读构造配置冻结之后类型层的说法才成立')
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
  const fallback = createHumanExecutionProvider({ bindingId: humanBindingId, issuerKey: humanIssuerKey, fallback: true })
  assert.equal(accessOfKey(await fallback.describeCapabilities(), CapabilityKey.ExecutionRunFallback), 'available', '只有显式声明 fallback 的实例才承接降级')
})
