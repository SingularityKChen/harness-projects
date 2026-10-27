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
  assert.deepEqual(HOST_REMOTE.invocations.filter(({ method }) => method !== 'getExecutionContext').map(({ namespace, method }) => `${namespace}/${method}`), [
    `${REMOTE_NAMESPACE}/baseline`, `${REMOTE_NAMESPACE}/bootstrapWorkspace`, `${REMOTE_NAMESPACE}/refreshPlanning`, `${REMOTE_NAMESPACE}/getStartWorkOptions`, `${REMOTE_NAMESPACE}/startWork`, `${REMOTE_NAMESPACE}/createWorkspace`, `${REMOTE_NAMESPACE}/connectAccount`, `${REMOTE_NAMESPACE}/bindPlanningSource`, `${REMOTE_NAMESPACE}/bindRepository`, `${REMOTE_NAMESPACE}/installExecutionBindings`, `${REMOTE_NAMESPACE}/getWorkspaceSetup`, `${REMOTE_NAMESPACE}/getPlanningMapping`, `${REMOTE_NAMESPACE}/setPlanningMapping`, `${REMOTE_NAMESPACE}/getDeliveryProjection`, `${REMOTE_NAMESPACE}/refreshDeliveryFacts`, `${REMOTE_NAMESPACE}/watch`,
  ])
  assert.deepEqual(HOST_REMOTE.invocations.filter(({ method }) => method !== 'getExecutionContext').map(({ mode, cancellation, parameters }) => [mode, cancellation, parameters.length]),
    [[undefined, undefined, 0], [undefined, undefined, 2], [undefined, undefined, 1], [undefined, undefined, 1], [undefined, undefined, 5], [undefined, undefined, 3], [undefined, undefined, 2], [undefined, undefined, 4], [undefined, undefined, 4], [undefined, undefined, 2], [undefined, undefined, 0], [undefined, undefined, 0], [undefined, undefined, 5], [undefined, undefined, 2], [undefined, undefined, 3], ['stream', { parameter: 'signal' }, 0]], 'unary 没有 mode；watch 是带 signal 取消、无业务参数的 stream')
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
    ['bootstrapWorkspace', { actorRef: { kind: 'agent', id: 'adapter-test' }, idempotencyKey: 'idempotency-1' }],
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

test('host adapter drains an in-flight call before the provider service disposer completes', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const composition = { call: async () => pending }
  const { ctx, events } = recordingContext()
  const installed = await installHostRemote(ctx, composition)
  const call = installed.service.baseline()
  let disposed = false
  const dispose = installed.dispose().then(() => { disposed = true })
  await Promise.resolve()
  assert.deepEqual([disposed, events], [false, []])
  release({ ok: true })
  await call
  await dispose
  assert.deepEqual([disposed, events], [true, ['remote-dispose', 'provide-dispose-start', 'provide-dispose-end']])
})

test('host adapter strictly JSON-encodes every watch frame, aborts and drains an open watch before withdrawing the service', async () => {
  let aborted
  const composition = {
    call: async () => undefined,
    watch: async function* (signal) {
      yield { kind: 'delta', delta: { skipped: undefined, n: 1 } }
      if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      aborted = signal.aborted
      yield { kind: 'delta', delta: { n: Number.NaN } } // 卸载中途的坏帧：仍在边界报错，出错路径也把在途计数归零
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
  await assert.rejects(pulling, /可传输/)
  assert.equal(aborted, true, '组合收到的是被中止的 signal')
  assert.deepEqual(events, ['remote-dispose', 'provide-dispose-start', 'provide-dispose-end'])
  await assert.rejects(() => installed.service.watch(new AbortController().signal).next(), /已卸载/)
})

test('optional Start Work branch survives descriptor-derived named JSON serialization and strict live Host decoding', async () => {
  const descriptor = CLIENT_REMOTE.descriptors.find(({ method }) => method === 'startWork')
  const supplied = [{ kind: 'user' }, 'default-branch', 'work-item', 'repository', undefined]
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
