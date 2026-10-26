import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as harness from '@harness-projects/provider-execution-harness'

const bindingId = 'binding-harness'
const context = { bindingId, objectKind: 'execution_context', externalId: 'ctx-1', url: undefined }
const input = { context, command: 'task verify cmd-7f3a', environment: {}, workingDirectory: '/workspace/acked-tree' }
const requestId = 'ctx-1'
const runRef = { bindingId, objectKind: 'execution_run', externalId: JSON.stringify(['session-1', requestId]), url: undefined }
const events = (kind) => [{ seq: 1, type: 'turn/start', turn: 1 }, { seq: 2, type: 'user/message', rpcId: requestId },
  ...(kind ? [{ seq: 3, type: 'turn/end', turn: 1, reason: { kind } }] : [])]
function port({ history = events('completed'), running = false, ...overrides } = {}) {
  return { create: async () => ({ sessionId: 'session-1' }), prompt: async () => ({ accepted: true }),
    inspect: async () => ({ events: history }), list: async () => ({ items: [{ sessionId: 'session-1', running }] }),
    cancel: async () => ({ accepted: true }), ...overrides }
}
const provider = (sessions = port(), options = {}) => harness.createHarnessExecutionProvider({ bindingId, sessions, ...options })

test('Harness：Git ack 目录取代 Host cwd，且一次性输入不进入 run ref', async () => {
  assert.equal(typeof harness.createHarnessExecutionProvider, 'function', '缺少 SessionPort Execution 实现')
  let cwd, prompt
  const result = await provider(port({ create: async (arg) => { cwd = arg.cwd; return { sessionId: 'session-1' } },
    prompt: async (arg) => { prompt = arg; return { accepted: true } } })).startRun(input)
  assert.equal(result.ok, true)
  assert.equal(cwd, '/workspace/acked-tree')
  assert.notEqual(cwd, process.cwd())
  assert.deepEqual(prompt, { sessionId: 'session-1', requestId, mode: 'queue', content: [{ type: 'text', text: input.command }] })
  assert.deepEqual(result.value.ref, runRef)
  assert.doesNotMatch(JSON.stringify(result.value), /cmd-7f3a|acked-tree/)
})

test('Harness：非法目录、上下文、任务与非空环境在任何会话写入之前拒绝', async () => {
  let calls = 0
  const p = provider(port({ create: async () => { calls++; throw Error('不应调用') } }))
  for (const workingDirectory of [undefined, '', ' ', 'relative/tree', '/bad\0tree'])
    assert.equal((await p.startRun({ ...input, workingDirectory })).error?.code, 'invalid_input')
  for (const context of [null, { ...input.context, bindingId: 'foreign' }, { ...input.context, objectKind: 'work_item' }, { ...input.context, externalId: ' ' }])
    assert.equal((await p.startRun({ ...input, context })).error?.code, 'invalid_input')
  assert.equal((await p.startRun({ ...input, command: ' ' })).error?.code, 'invalid_input')
  assert.equal((await p.startRun({ ...input, environment: { TOKEN: 'env-7f3a' } })).error?.code, 'not_supported')
  assert.equal(calls, 0)
})

test('录制回放：重复键逐次消费，未知请求和剩余请求响亮失败', async () => {
  const { replay, recorded } = await import('./fixtures/harness-session/replay.js')
  const selected = recorded.exchanges.filter((x) => ['create', 'list', 'cancel'].includes(x.operation))
  const sessions = replay(selected)
  assert.throws(() => sessions.assertConsumed(), /未消费/)
  for (const x of selected) {
    if (x.outcome.ok) assert.deepEqual(await sessions[x.operation](x.request), x.outcome.value)
    else await assert.rejects(sessions[x.operation](x.request), (e) => e.code === x.outcome.error.code)
  }
  sessions.assertConsumed()
  await assert.rejects(sessions.create({ cwd: '/unknown' }), /未知请求/)
})

test('录制 0.2.0-rc.2：completed/error/aborted 与冷读保持原始结果，零网络', async (t) => {
  const { replay, recorded } = await import('./fixtures/harness-session/replay.js')
  const net = await import('node:net')
  let network = 0
  t.mock.method(globalThis, 'fetch', () => { network++; throw Error('network') })
  t.mock.method(net.Socket.prototype, 'connect', () => { network++; throw Error('network') })
  for (const [ids, want, cancel] of [[['O1.1', 'O1.2', 'O2.1', 'O2.2'], 'failed', false], [['O3.1'], 'succeeded', false], [['O3.2'], 'canceled', true]]) {
    const rows = structuredClone(recorded.exchanges.filter((x) => ids.includes(x.observation)))
    const recordedPrompt = rows.find((x) => x.operation === 'prompt').request
    // 明确替换 request.cwd；任务与上下文 id 对齐录制请求，不改写录制响应或事件。
    const adapted = { ...input, context: { ...context, externalId: recordedPrompt.requestId }, command: recordedPrompt.content[0].text }
    for (const row of rows) if (row.operation === 'create') row.request.cwd = input.workingDirectory
    const reads = rows.filter((x) => ['inspect', 'list'].includes(x.operation))
    // aborted 录制只有取消后的读取，不能伪造成 startRun 的取消前读取。
    const sessions = replay(cancel ? rows : [...rows, ...structuredClone(reads)])
    let ref, read
    if (cancel) {
      const created = await sessions.create({ cwd: input.workingDirectory })
      await sessions.prompt(recordedPrompt)
      ref = { ...runRef, externalId: JSON.stringify([created.sessionId, recordedPrompt.requestId]) }
      await sessions.cancel({ sessionId: created.sessionId }) // 模拟 Host 外部取消；Provider 只读取归一后的 aborted。
      read = await provider(sessions).getRun(ref)
    } else {
      const first = await provider(sessions).startRun(adapted)
      assert.equal(first.ok, true)
      ref = first.value.ref
      read = await provider(sessions).getRun(ref)
    }
    assert.equal(read.value.status, want)
    assert.deepEqual(read.value.ref, ref)
    assert.deepEqual([read.value.startedAt, read.value.finishedAt, read.value.exitCode, read.value.logUrl], Array(4).fill(undefined))
    sessions.assertConsumed()
  }
  assert.equal(network, 0)
})

test('Harness：状态只属于 rpcId 的 turn，终态优先；运行中与崩溃为合成证据', async () => {
  const later = [{ seq: 4, type: 'turn/start', turn: 2 }, { seq: 5, type: 'user/message', rpcId: 'user-later' },
    { seq: 6, type: 'turn/end', turn: 2, reason: { kind: 'completed' } }]
  for (const [history, running, want] of [[events('completed'), true, 'succeeded'], [events('error'), false, 'failed'],
    [events('aborted'), true, 'canceled'], [events('blocked'), true, 'unknown'], [events(), true, 'running'],
    [events(), false, 'unknown'], [[], false, 'starting'], [[...events(), ...later], false, 'unknown'],
    [[...events('error'), ...later], true, 'failed'], [later, false, 'unknown']]) {
    const read = await provider(port({ history, running })).getRun(runRef)
    assert.equal(read.ok, true)
    assert.equal(read.value.status, want, JSON.stringify([history, running]))
  }
})

test('Harness：get 校验完整身份，输出不回显额外字段，取消恒不支持且先于身份', async () => {
  let reads = 0
  const p = provider(port({ inspect: async () => { reads++; return { events: events('completed') } } }))
  for (const bad of [null, { ...runRef, bindingId: 'foreign' }, { ...runRef, objectKind: 'repository' },
    ...['{}', '[]', '["","x"]', '["s",1]', '["s","r",3]', 'broken'].map((externalId) => ({ ...runRef, externalId }))]) {
    assert.equal((await p.getRun(bad)).error?.code, 'not_found')
    assert.equal((await p.cancelRun(bad)).error?.code, 'not_supported')
    assert.equal((await provider(port(), { cancel: false }).cancelRun(bad)).error?.code, 'not_supported')
  }
  assert.equal(reads, 0)
  const read = await p.getRun({ ...runRef, url: 'https://evil.example/log', extra: 1 })
  assert.deepEqual(read.value.ref, runRef)
})

test('Harness：读取 Host 外部 aborted，既有 completed/error 不覆盖', async () => {
  for (const [history, running, want] of [[events(), true, 'running'], [events('aborted'), false, 'canceled'],
    [events('completed'), false, 'succeeded'], [events('error'), false, 'failed']])
    assert.equal((await provider(port({ history, running })).getRun(runRef)).value.status, want)
})

test('Harness：错误按调用阶段分类并脱敏，已调用 prompt 或接纳后的不明结果不能重启', async () => {
  const bomb = (code) => async () => { throw Object.assign(Error('secret-env-7f3a'), code ? { code } : {}) }
  for (const [overrides, want, stage] of [[{ create: bomb() }, 'unavailable', 'create'],
    [{ create: bomb('gateway/bad-request') }, 'invalid_input', 'create'],
    [{ prompt: bomb('session/not-found') }, 'not_found', 'prompt'], [{ prompt: bomb('gateway/bad-request') }, 'invalid_input', 'prompt'],
    [{ prompt: async () => ({ accepted: false }) }, 'unavailable', 'prompt'],
    [{ prompt: bomb() }, 'ambiguous_result', 'prompt'], [{ inspect: bomb() }, 'ambiguous_result', 'read']]) {
    const result = await provider(port(overrides)).startRun(input)
    assert.equal(result.error?.code, want)
    assert.match(result.error.message, new RegExp(stage))
    assert.doesNotMatch(JSON.stringify(result), /secret-env-7f3a/)
  }
  assert.equal((await provider(port({ inspect: bomb() })).getRun(runRef)).error?.code, 'unavailable')
  assert.equal((await provider(port({ inspect: bomb('session/not-found') })).getRun(runRef)).error?.code, 'not_found')
})

test('Harness：每次操作有有限预算，prompt 晚拒绝被消费并保持 ambiguous_result', async () => {
  let calls = 0, signal
  const result = await provider(port({ prompt: async (_arg, s) => { calls++; signal = s; await new Promise((r) => setTimeout(r, 25)); throw Error('late') } }), { timeoutMs: 5 }).startRun(input)
  assert.equal(result.error?.code, 'ambiguous_result')
  assert.equal(signal.aborted, true)
  await new Promise((r) => setTimeout(r, 35))
  assert.equal(calls, 1)
})

const { executionContractSuite } = await import('./suites/execution.js')
executionContractSuite({ label: 'Harness SessionPort', startInput: { environment: {}, workingDirectory: input.workingDirectory },
  makeProvider: (scenario = {}) => {
    const history = events('completed')
    const offline = async () => { throw Error('offline') }
    return provider(port({ create: scenario.faults?.harnessFailure || scenario.faults?.offline ? offline : async () => ({ sessionId: 'session-1' }),
      inspect: scenario.faults?.offline ? offline : async () => ({ events: history }) }))
  },
  expect: { context, stages: ['create', 'prompt', 'read'], failedStage: 'create', seededRunExternalId: runRef.externalId,
    seededRunStatus: 'succeeded', runningRunExternalId: runRef.externalId },
})

test('Harness：所属终态不依赖 list 留存；缺 turn 身份不能用 undefined 匹配', async () => {
  const missingRow = await provider(port({ list: async () => ({ items: [] }) })).getRun(runRef)
  assert.equal(missingRow.value.status, 'succeeded')
  const missingTurn = events('completed').map(({ turn: _turn, ...event }) => event)
  assert.equal((await provider(port({ history: missingTurn })).getRun(runRef)).value.status, 'unknown')
})

test('Harness：create 超时不会在晚 ack 后再 prompt，read 同样有绝对预算', async () => {
  let prompts = 0
  const delayed = provider(port({ create: async () => { await new Promise((r) => setTimeout(r, 25)); return { sessionId: 'late' } },
    prompt: async () => { prompts++; return { accepted: true } } }), { timeoutMs: 5 })
  assert.equal((await delayed.startRun(input)).error?.code, 'unavailable')
  await new Promise((r) => setTimeout(r, 35))
  assert.equal(prompts, 0)
  const never = () => new Promise(() => {})
  assert.equal((await provider(port({ inspect: never }), { timeoutMs: 5 }).getRun(runRef)).error?.code, 'unavailable')
  assert.equal((await provider(port({ cancel: never }), { timeoutMs: 5 }).cancelRun(runRef)).error?.code, 'not_supported')
})

test('Harness：缺失 accepted 不是明确拒绝，不能让 Core 再启动执行者', async () => {
  for (const ack of [{}, null, { accepted: undefined }])
    assert.equal((await provider(port({ prompt: async () => ack })).startRun(input)).error?.code, 'ambiguous_result')
})


test('Harness：取消恒 unavailable，任何引用或 cancel:true 选项均零会话调用', async () => {
  const { CapabilityKey, effectiveCapabilities } = await import('@harness-projects/capabilities')
  let calls = 0
  const write = async () => { calls++; return { accepted: true } }
  const p = provider(port({ cancel: write, inspect: async () => { calls++; return { events: events('completed') } } }), { cancel: true })
  const access = effectiveCapabilities(await p.describeCapabilities()).find((x) => x.key === CapabilityKey.ExecutionRunCancel)?.access
  assert.equal(access, 'unavailable')
  for (const ref of [undefined, null, runRef, { ...runRef, externalId: JSON.stringify(['session-1', 'foreign-request']) },
    { ...runRef, bindingId: 'foreign' }, { ...runRef, objectKind: 'repository' }, { ...runRef, externalId: 'broken' }]) {
    const result = await p.cancelRun(ref)
    assert.equal(result.error?.code, 'not_supported')
    assert.equal(result.error.retryable, false)
  }
  assert.equal(calls, 0)
})

test('Harness：原型键和所有未知结束原因都返回唯一字符串 unknown', async () => {
  for (const kind of ['toString', 'constructor', '__proto__', 'blocked', 'max-tokens', 'interrupted', 'forked', 'future']) {
    const result = await provider(port({ history: events(kind) })).getRun(runRef)
    assert.equal(result.value.status, 'unknown', kind)
    assert.equal(typeof result.value.status, 'string')
  }
})

test('Harness：已接纳但 history 尚空时，running=true 优先于 starting', async () => {
  const p = provider(port({ history: [], running: true }))
  assert.equal((await p.startRun(input)).value.status, 'running')
  assert.equal((await p.getRun(runRef)).value.status, 'running')
})
