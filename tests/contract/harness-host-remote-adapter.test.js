import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIENT_REMOTE,
  HOST_REMOTE,
  installHostRemote,
  REMOTE_NAMESPACE,
  REMOTE_PACKAGE,
} from '../../apps/harness-plugin/src/remote.ts'

function recordingContext() {
  const services = new Map()
  const registrations = []
  const events = []
  const ctx = {
    invocation: { peer: { id: 'adapter-peer' } },
    provide(name, value) {
      services.set(name, value)
      const dispose = async () => { events.push('provide-dispose-start'); services.delete(name); await Promise.resolve(); events.push('provide-dispose-end') }
      return dispose
    },
    typert: {
      register(contribution) {
        registrations.push(contribution)
        return async () => { events.push('remote-dispose') }
      },
    },
  }
  return { ctx, services, registrations, events }
}

test('typed remote contribution exposes the same strict descriptors (settings unary and one stream) on Host and Client', () => {
  assert.deepEqual([REMOTE_PACKAGE, HOST_REMOTE.package, HOST_REMOTE.face], ['@harness-projects/app-harness-plugin', '@harness-projects/app-harness-plugin', 'host'])
  assert.deepEqual(CLIENT_REMOTE, { package: REMOTE_PACKAGE, descriptors: HOST_REMOTE.invocations })
  assert.deepEqual(HOST_REMOTE.invocations.filter(({ method }) => !['getExecutionContext', 'refreshExecutionRun'].includes(method)).map(({ namespace, method }) => `${namespace}/${method}`), [
    `${REMOTE_NAMESPACE}/baseline`, `${REMOTE_NAMESPACE}/bootstrapWorkspace`, `${REMOTE_NAMESPACE}/refreshPlanning`, `${REMOTE_NAMESPACE}/getStartWorkOptions`, `${REMOTE_NAMESPACE}/startWork`, `${REMOTE_NAMESPACE}/getChangeRequestIssueOptions`, `${REMOTE_NAMESPACE}/createChangeRequest`, `${REMOTE_NAMESPACE}/getChangeRequestOperation`, `${REMOTE_NAMESPACE}/resumeChangeRequest`, `${REMOTE_NAMESPACE}/listChangeRequestAssigneeOptions`, `${REMOTE_NAMESPACE}/getChangeRequestAssigneeOperation`, `${REMOTE_NAMESPACE}/addChangeRequestAssignees`, `${REMOTE_NAMESPACE}/resumeChangeRequestAssignees`, `${REMOTE_NAMESPACE}/createWorkspace`, `${REMOTE_NAMESPACE}/connectAccount`, `${REMOTE_NAMESPACE}/bindPlanningSource`, `${REMOTE_NAMESPACE}/bindRepository`, `${REMOTE_NAMESPACE}/installExecutionBindings`, `${REMOTE_NAMESPACE}/getWorkspaceSetup`, `${REMOTE_NAMESPACE}/getPlanningMapping`, `${REMOTE_NAMESPACE}/setPlanningMapping`, `${REMOTE_NAMESPACE}/getIssueClosingLinks`, `${REMOTE_NAMESPACE}/refreshIssueDependencies`, `${REMOTE_NAMESPACE}/refreshIssueClosingLinks`, `${REMOTE_NAMESPACE}/getDeliveryProjection`, `${REMOTE_NAMESPACE}/refreshDeliveryFacts`, `${REMOTE_NAMESPACE}/watch`,
  ])
  assert.deepEqual(HOST_REMOTE.invocations.filter(({ method }) => !['getExecutionContext', 'refreshExecutionRun'].includes(method)).map(({ mode, cancellation, parameters }) => [mode, cancellation, parameters.length]),
    [[undefined, undefined, 0], [undefined, undefined, 2], [undefined, undefined, 1], [undefined, undefined, 1], [undefined, undefined, 6], [undefined, undefined, 4], [undefined, undefined, 11], [undefined, undefined, 4], [undefined, undefined, 4], [undefined, undefined, 5], [undefined, undefined, 5], [undefined, undefined, 6], [undefined, undefined, 5], [undefined, undefined, 3], [undefined, undefined, 2], [undefined, undefined, 4], [undefined, undefined, 4], [undefined, undefined, 2], [undefined, undefined, 0], [undefined, undefined, 0], [undefined, undefined, 5], [undefined, undefined, 1], [undefined, undefined, 2], [undefined, undefined, 2], [undefined, undefined, 2], [undefined, undefined, 3], ['stream', { parameter: 'signal' }, 0]], 'unary 没有 mode；watch 是带 signal 取消、无业务参数的 stream')
  // Host 网关对 strict 结果只调 `encode`（参数才走 `create().parse`）：非 JSON 值必须在边界报错，而不是被序列化静默降级。
  const nonJson = [JSON.parse('{"__proto__":{"injected":true}}'), new Date(0), { at: new Map() }, [undefined], Number.NaN]
  for (const descriptor of HOST_REMOTE.invocations) {
    const modes = [descriptor.invocation.kind, descriptor.result.mode, ...descriptor.parameters.map((parameter) => parameter.codec.mode)]
    assert.deepEqual(modes, ['direct', 'strict', ...descriptor.parameters.map(() => 'strict')])
    for (const value of nonJson) assert.throws(() => descriptor.result.encode(value), /可传输|普通对象|禁止字段/)
    assert.equal(JSON.stringify(descriptor.result.encode({ entities: [1, 'x'], skipped: undefined })), '{"entities":[1,"x"]}')
  }
})

test('host adapter validates through the strict parser before reaching Core and unregisters idempotently', async () => {
  const calls = []
  const composition = {
    call: async (name, input) => { calls.push([name, input]); return { ok: true, name } },
  }
  const { ctx, services, registrations, events } = recordingContext()
  const installed = await installHostRemote(ctx, composition)
  assert.equal(registrations.length, 1)
  const service = services.get('harnessProjects')

  assert.deepEqual(await service.baseline(), { ok: true, name: 'baseline' })
  assert.deepEqual(
    await service.bootstrapWorkspace({ kind: 'agent', id: 'adapter-test' }, 'idempotency-1'),
    { ok: true, name: 'bootstrapWorkspace' },
  )
  assert.deepEqual(calls, [
    ['baseline', {}],
    ['bootstrapWorkspace', { actorRef: { kind: 'harness_peer', id: 'adapter-peer' }, idempotencyKey: 'idempotency-1' }],
  ])
  await assert.rejects(() => service.bootstrapWorkspace({ kind: 7 }, 'idempotency-2'), /actorRef/)
  await assert.rejects(() => service.bootstrapWorkspace({ kind: 'agent' }, ''), /idempotencyKey/)
  await assert.rejects(() => service.bootstrapWorkspace({ kind: 'agent', extra: true }, 'idempotency-3'), /未知字段/)
  assert.equal(calls.length, 2, 'strict adapter must reject malformed input before Core')

  await installed.dispose()
  await installed.dispose()
  assert.deepEqual(events, ['remote-dispose', 'provide-dispose-start', 'provide-dispose-end'], '二次 dispose 不再撤回')
  await assert.rejects(() => installed.service.baseline(), /已卸载/)
})

test('host adapter withdraws immediately and keeps disposal pending until the active call drains', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const composition = { call: async () => pending }
  const { ctx, events, services } = recordingContext()
  const installed = await installHostRemote(ctx, composition)
  const call = installed.service.baseline()
  let disposed = false
  const dispose = installed.dispose().then(() => { disposed = true })
  await Promise.resolve()
  assert.deepEqual([disposed, events, services.size], [false, ['remote-dispose', 'provide-dispose-start', 'provide-dispose-end'], 0])
  await assert.rejects(installed.service.baseline(), /已卸载/)
  release({ ok: true })
  await call
  await dispose
  assert.deepEqual([disposed, events], [true, ['remote-dispose', 'provide-dispose-start', 'provide-dispose-end']])
})

test('remote dispose releases a parked generator without another consumer action', async () => {
  let released = 0
  const diagnostics = [], { ctx, services } = recordingContext()
  const source = (async function* () { try { yield { n: 1 } } finally { released++ } })()
  const installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => source }, undefined, undefined, undefined, (event) => diagnostics.push(event))
  const frames = installed.service.watch(new AbortController().signal)
  try {
    assert.equal((await frames.next()).value.n, 1)
    await installed.dispose(Date.now() + 80)
    assert.equal(released, 1, 'dispose must resume the owned parked generator finally')
    assert.equal(services.size, 0)
    assert.deepEqual(diagnostics, [], 'cooperative parked streams drain without deadline diagnostics')
  } finally { await frames.return(); await installed.dispose() }
})

test('host adapter strictly JSON-encodes watch frames, withdraws the service and aborts / drains the open watch', async () => {
  let aborted
  const composition = {
    call: async () => undefined,
    watch: async function* (signal) {
      yield { kind: 'delta', delta: { skipped: undefined, n: 1 } }
      if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      aborted = signal.aborted
      yield { kind: 'delta', delta: { n: Number.NaN } } // 停止后的坏帧也不得编码或交付
    },
  }
  const { ctx, events } = recordingContext()
  const installed = await installHostRemote(ctx, composition)
  const frames = installed.service.watch(new AbortController().signal)
  const first = (await frames.next()).value
  assert.deepEqual([first.kind, Object.entries(first.delta)], ['delta', [['n', 1]]], 'undefined 键在进程内就被删掉，与线缆形状一致')
  const pulling = frames.next()
  const timeout = new Promise((resolve) => setTimeout(resolve, 1000, 'timeout').unref())
  assert.notEqual(await Promise.race([installed.dispose().then(() => 'disposed'), timeout]), 'timeout', '卸载必须先中止打开的流再排空')
  assert.equal((await pulling).done, true)
  assert.equal(aborted, true, '组合收到的是被中止的 signal')
  assert.deepEqual(events, ['remote-dispose', 'provide-dispose-start', 'provide-dispose-end'])
  await assert.rejects(() => installed.service.watch(new AbortController().signal).next(), /已卸载/)
})

for (const failure of ['frame', 'next']) test(`running watch rejects invalid ${failure} and closes its source once`, async () => {
  let returns = 0
  const { ctx } = recordingContext()
  const installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { if (failure === 'next') throw Error('running next failure'); return { value: NaN, done: false } }, return: async () => { returns++; return { done: true } } }) }) })
  try {
    await assert.rejects(installed.service.watch(new AbortController().signal).next(), failure === 'next' ? /running next failure/ : /可传输/)
    assert.equal(returns, 1)
  } finally { await installed.dispose() }
})

test('watch terminal paths settle once and an unstarted watch never opens a source', async () => {
  const { ctx } = recordingContext(), diagnostics = []
  let opens = 0, returns = 0
  const installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => {
    opens++
    return { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: 1, done: opens === 1 }), return: async () => { returns++; return { done: true } } }) }
  } }, undefined, undefined, undefined, (event) => diagnostics.push(event))
  const unstarted = installed.service.watch(new AbortController().signal)
  await unstarted.return()
  assert.equal(opens, 0)
  const completed = installed.service.watch(new AbortController().signal)
  assert.equal((await completed.next()).done, true)
  await completed.return()
  const early = installed.service.watch(new AbortController().signal)
  await early.next(); await early.return(); await early.return()
  const thrown = installed.service.watch(new AbortController().signal)
  await thrown.next(); await assert.rejects(thrown.throw(Error('consumer stopped')), /consumer stopped/)
  const deferred = installed.service.watch(new AbortController().signal)
  await installed.dispose(Date.now() + 80)
  await assert.rejects(deferred.next(), /卸载/)
  assert.deepEqual([opens, returns, diagnostics], [3, 3, []])
})

for (const mode of ['sync', 'async', 'late']) test(`watch ${mode} return failure is consumed and diagnosed once`, async () => {
  let returns = 0, reject
  const diagnostics = [], { ctx } = recordingContext()
  const installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => ({ [Symbol.asyncIterator]: () => ({
    next: async () => ({ value: 1, done: false }),
    return: () => {
      returns++
      const error = Error('synthetic cleanup failure')
      if (mode === 'sync') throw error
      return mode === 'async' ? Promise.reject(error) : new Promise((_, fail) => { reject = fail })
    },
  }) }) }, undefined, undefined, undefined, (event) => diagnostics.push(event))
  const frames = installed.service.watch(new AbortController().signal)
  try {
    await frames.next()
    await installed.dispose(Date.now() + 40)
    assert.deepEqual(diagnostics, [mode === 'late' ? 'shutdownDeadlineExceeded' : 'shutdownFailed'])
    if (reject) { reject(Error('late cleanup rejection')); await new Promise((resolve) => setImmediate(resolve)) }
    await frames.return()
    assert.equal(returns, 1)
    assert.equal(diagnostics.filter((event) => event === 'shutdownFailed').length, 1)
  } finally { reject?.(Error('fixture cleanup')); await installed.dispose() }
})

for (const late of ['value', 'reject', 'never-return']) test(`pending watch ${late} closes the real source immediately within one deadline`, async () => {
  let release, fail, finishReturn, returned = 0, reads = 0
  const diagnostics = [], { ctx, services } = recordingContext()
  const installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => ({ [Symbol.asyncIterator]: () => ({
    next: () => { reads++; return new Promise((resolve, reject) => { release = resolve; fail = reject }) },
    return: () => { returned++; return late === 'never-return' ? new Promise((resolve) => { finishReturn = resolve }) : Promise.resolve({ done: true }) },
  }) }) }, undefined, undefined, undefined, (event) => diagnostics.push(event))
  const frames = installed.service.watch(new AbortController().signal), next = frames.next()
  void next.catch(() => undefined)
  const start = Date.now(), disposal = installed.dispose(start + 60)
  try {
    assert.equal(returned, 1, 'owned return must start while next is still pending')
    assert.equal(services.size, 0)
    assert.equal(disposal, installed.dispose())
    await disposal
    assert.ok(Date.now() - start < 160)
    assert.deepEqual(diagnostics, ['shutdownDeadlineExceeded'])
    if (late === 'reject') fail(Error('late source rejection'))
    else release({ value: late === 'value' ? 2 : NaN, done: false })
    if (late !== 'never-return') assert.equal((await next).done, true)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual([returned, reads], [1, 1])
  } finally { release({ done: true }); finishReturn?.({ done: true }); await next; await installed.dispose() }
})

test('source return synchronously aborting its consumer still releases once', async () => {
  const consumer = new AbortController(), diagnostics = [], { ctx } = recordingContext()
  let returns = 0
  const installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => ({ [Symbol.asyncIterator]: () => ({
    next: async () => ({ value: 1, done: false }),
    return: () => {
      returns++
      if (returns > 1) throw Error('double release')
      consumer.abort()
      return { done: true }
    },
  }) }) }, undefined, undefined, undefined, (event) => diagnostics.push(event))
  const frames = installed.service.watch(consumer.signal)
  try {
    await frames.next(); await frames.return(); await installed.dispose(Date.now() + 80)
    assert.equal(returns, 1, 'abort reentry must share the already published close task')
    assert.deepEqual(diagnostics, [])
  } finally { await frames.return(); await installed.dispose() }
})

test('a source acquired during synchronous stop is still closed once', async () => {
  let installed, returns = 0, disposal
  const { ctx } = recordingContext()
  installed = await installHostRemote(ctx, { call: async () => undefined, watch: () => {
    disposal = installed.dispose(Date.now() + 80)
    return { [Symbol.asyncIterator]: () => ({ next: async () => { throw Error('late source must not be read') }, return: async () => { returns++; return { done: true } } }) }
  } })
  const frames = installed.service.watch(new AbortController().signal)
  assert.equal((await frames.next()).done, true)
  await disposal
  assert.equal(returns, 1)
})

test('optional Start Work branch survives descriptor-derived named JSON serialization and strict live Host decoding', async () => {
  const descriptor = CLIENT_REMOTE.descriptors.find(({ method }) => method === 'startWork')
  const supplied = [{ kind: 'user' }, 'default-branch', 'work-item', 'repository', 'Synthetic explicit task', undefined]
  const wire = JSON.parse(JSON.stringify(Object.fromEntries(descriptor.parameters.map((parameter, index) => [parameter.wire, supplied[index]]))))
  assert.equal(Object.hasOwn(wire, 'branchName'), false, 'JSON omits undefined optional positional values')
  const required = descriptor.parameters.filter((parameter) => parameter.acceptsUndefined !== true).map(({ wire }) => wire).sort()
  assert.deepEqual(Object.keys(wire).sort(), required, 'every omitted strict wire argument must be declared acceptsUndefined')
  assert.equal(descriptor.parameters.find(({ name }) => name === 'branchName').acceptsUndefined, true)
  assert.ok(descriptor.parameters.filter(({ name }) => name !== 'branchName').every((parameter) => parameter.acceptsUndefined === undefined), 'required identity/envelope inputs stay required')
  const calls = [], { ctx } = recordingContext(), installed = await installHostRemote(ctx, { call: async (name, input) => { calls.push([name, input]); return {} } })
  try {
    const decode = (args) => descriptor.parameters.map((parameter) => parameter.codec.create().parse(args[parameter.wire]))
    await installed.service.startWork(...decode(wire)); assert.equal(calls[0][1].branchName, undefined)
    await installed.service.startWork(...decode({ ...wire, branchName: ' work/verbatim ' })); assert.equal(calls[1][1].branchName, ' work/verbatim ')
    for (const branchName of [null, '', 1, {}]) assert.throws(() => decode({ ...wire, branchName }), TypeError)
  } finally { await installed.dispose() }
})

test('operation lookup and resume use admitted observer and strict selector without create envelope', async () => {
  const calls = [], { ctx } = recordingContext()
  const installed = await installHostRemote(ctx, { call: async (name, input) => { calls.push([name, input]); return {} } })
  try {
    await installed.service.getChangeRequestOperation({ kind: 'forged' }, 'wi', 'repo')
    await installed.service.resumeChangeRequest({ kind: 'forged' }, 'wi', 'repo', 'op')
    assert.deepEqual(calls, [['getChangeRequestOperation', { actorRef: { kind: 'harness_peer', id: 'adapter-peer' }, workItemId: 'wi', repositoryId: 'repo', operationId: undefined }], ['resumeChangeRequest', { actorRef: { kind: 'harness_peer', id: 'adapter-peer' }, workItemId: 'wi', repositoryId: 'repo', operationId: 'op' }]])
    delete ctx.invocation.peer
    await assert.rejects(() => installed.service.getChangeRequestOperation({ kind: 'user' }, 'wi', 'repo'), /identity/)
    await assert.rejects(() => installed.service.resumeChangeRequest({ kind: 'user' }, 'wi', 'repo', 'op'), /identity/)
  } finally { await installed.dispose() }
})
