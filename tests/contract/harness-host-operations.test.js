import assert from 'node:assert/strict'
import test from 'node:test'

import { OPERATIONS, defineOperations, dispatchOf, nonEmptyString, param } from '../../apps/harness-plugin/src/host-operations.ts'
import { CLIENT_REMOTE, HOST_REMOTE, defineRemote, installHostRemote } from '../../apps/harness-plugin/src/remote.ts'

// 把函数值（codec 的 create / encode）换成 typeof：金样只钉住形状、键存在性与 wire 名，不依赖函数身份。
const shape = (value) => {
  if (typeof value === 'function') return typeof value
  if (Array.isArray(value)) return value.map(shape)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).map((key) => [key, shape(value[key])]))
  return value
}

// 字面量金样：unary 描述符没有 mode 与 cancellation 键，watch 两者都有。
const GOLDEN = [
  {
    id: '@harness-projects/app-harness-plugin#harnessProjects/baseline',
    service: 'harnessProjects',
    namespace: 'harnessProjects',
    method: 'baseline',
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#RemoteJsonOutput', create: 'function', encode: 'function' },
  },
  {
    id: '@harness-projects/app-harness-plugin#harnessProjects/bootstrapWorkspace',
    service: 'harnessProjects',
    namespace: 'harnessProjects',
    method: 'bootstrapWorkspace',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'actorRef', wire: 'actorRef', source: 'json', codec: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#ActorRef', create: 'function' } },
      { name: 'idempotencyKey', wire: 'idempotencyKey', source: 'json', codec: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#IdempotencyKey', create: 'function' } },
    ],
    result: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#RemoteJsonOutput', create: 'function', encode: 'function' },
  },
  {
    id: '@harness-projects/app-harness-plugin#harnessProjects/refreshPlanning',
    service: 'harnessProjects', namespace: 'harnessProjects', method: 'refreshPlanning', invocation: { kind: 'direct' },
    parameters: [{ name: 'actorRef', wire: 'actorRef', source: 'json', codec: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#ActorRef', create: 'function' } }],
    result: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#RemoteJsonOutput', create: 'function', encode: 'function' },
  },
  {
    id: '@harness-projects/app-harness-plugin#harnessProjects/watch',
    service: 'harnessProjects',
    namespace: 'harnessProjects',
    method: 'watch',
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#RemoteJsonOutput', create: 'function', encode: 'function' },
  },
]

test('generated descriptors are deep-equal to the hand-written ones they replaced (#352, ADR-0013)', () => {
  assert.deepEqual(shape(HOST_REMOTE.invocations.filter(({ method }) => GOLDEN.some((entry) => entry.method === method))), GOLDEN)
  assert.equal(CLIENT_REMOTE.descriptors, HOST_REMOTE.invocations)
  // descriptor 数组是 Host 与客户端共用的同一个对象，冻结才能保证任何一方都改不了另一方看到的 wire。
  assert.ok(Object.isFrozen(HOST_REMOTE.invocations))
  // 声明是唯一来源：键序即 descriptor 顺序，bootstrapWorkspace 的参数 codec 用的就是声明里的 parse 函数本身。
  assert.deepEqual(Object.keys(OPERATIONS), HOST_REMOTE.invocations.map(({ method }) => method))
  assert.ok(Object.isFrozen(OPERATIONS) && Object.values(OPERATIONS).every((operation) => Object.isFrozen(operation)))
  const parses = HOST_REMOTE.invocations[1].parameters.map((parameter) => parameter.codec.create().parse)
  assert.equal(parses.length, OPERATIONS.bootstrapWorkspace.params.length)
  parses.forEach((parse, index) => assert.equal(parse, OPERATIONS.bootstrapWorkspace.params[index].parse))
  // actor 规整为 { kind } 或 { kind, id }：Controller 收到的值里没有值为 undefined 的 id 键。
  assert.deepEqual(OPERATIONS.bootstrapWorkspace.params[0].parse({ kind: 'agent', id: undefined }), { kind: 'agent' })
})

test('one declaration adds an operation to the descriptors, the Host dispatch and the client proxy (#352)', async () => {
  // 夹具的 parse 会规整（去掉首尾空白），这样才能区分 handler 收到的是规整后的值还是调用方的原始记录。
  const fixture = defineOperations({ echoFixture: { mode: 'unary', params: [param('word', 'FixtureWord', (value) => nonEmptyString(value, 'word').trim())] } })
  const remote = defineRemote({ ...OPERATIONS, ...fixture })
  // Host 分发：夹具走生产同一段 dispatchOf；handler 只记下调用方给的装配与已校验的输入。
  const seen = []
  const handlers = { echoFixture: async (assembly, input) => { seen.push([assembly.tag, input]); return { echoed: input } } }
  const dispatch = dispatchOf(remote.operations, handlers, (run) => run())
  const registrations = []
  const ctx = { provide: () => () => {}, typert: { register: (contribution) => { registrations.push(contribution); return () => {} } } }
  const installed = await installHostRemote(ctx, { call: (name, input) => dispatch({ tag: 'a1' }, name, input), watch: async function* () {} }, remote)
  const service = installed.service

  // descriptor：声明顺序在末尾追加，第 4 条深等于同形金样，注册的就是 remote.host，Client 挂载同一个数组。
  assert.deepEqual(remote.client.descriptors.map(({ method }) => method), [...Object.keys(OPERATIONS), 'echoFixture'])
  assert.deepEqual(shape(remote.client.descriptors.find(({ method }) => method === 'echoFixture')), {
    id: '@harness-projects/app-harness-plugin#harnessProjects/echoFixture',
    service: 'harnessProjects',
    namespace: 'harnessProjects',
    method: 'echoFixture',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'word', wire: 'word', source: 'json', codec: { mode: 'strict', typeSymbol: '@harness-projects/app-harness-plugin#FixtureWord', create: 'function' } }],
    result: GOLDEN[0].result,
  })
  assert.equal(registrations[0], remote.host)
  assert.equal(remote.host.invocations, remote.client.descriptors)

  // live service 与分发：校验在 handler 之前，handler 看到的是声明的 parse 规整后的输入。
  assert.deepEqual(await service.echoFixture('hi'), { echoed: { word: 'hi' } })
  await assert.rejects(() => service.echoFixture(''), /word 必须是非空字符串/)
  await assert.rejects(() => dispatch({ tag: 'a1' }, 'echoFixture', { word: 'hi', extra: 1 }), /echoFixture 含未知字段：extra/)
  await assert.rejects(() => dispatch({ tag: 'a1' }, 'echoFixture', { word: 'hi', extra: 1, more: 2 }), /echoFixture 含未知字段：extra, more/, '一次列出全部未知键')
  // 绕过服务层直接分发（host.call 的调用面）：handler 拿到的也是 parse 的结果，不是原始记录。
  assert.deepEqual(await dispatch({ tag: 'a2' }, 'echoFixture', { word: ' hey ' }), { echoed: { word: 'hey' } })
  assert.deepEqual(seen, [['a1', { word: 'hi' }], ['a2', { word: 'hey' }]])

  // 客户端代理：网关替身逐参 create().parse、调 live service、结果只经 encode，失败 resolve 成 { ok: false }。
  const proxy = Object.fromEntries(remote.client.descriptors.filter(({ mode }) => mode !== 'stream').map((descriptor) => [descriptor.method, async (...args) => {
    try {
      const values = descriptor.parameters.map((parameter, index) => parameter.codec.create().parse(args[index]))
      return { ok: true, value: descriptor.result.encode(await service[descriptor.method](...values)) }
    } catch (error) { return { ok: false, error } }
  }]))
  assert.equal(JSON.stringify(await proxy.echoFixture('again')), '{"ok":true,"value":{"echoed":{"word":"again"}}}')
  assert.equal((await proxy.echoFixture(7)).ok, false)
  assert.deepEqual(seen.map(([, input]) => input), [{ word: 'hi' }, { word: 'hey' }, { word: 'again' }], '被拒绝的输入没有到达 handler')

  // 生产默认不受影响：不传第三个参数时装的是 OPERATIONS 的 remote，夹具操作不在其中。
  const production = []
  const stock = await installHostRemote({ ...ctx, typert: { register: (contribution) => { production.push(contribution); return () => {} } } }, { call: async () => ({}), watch: async function* () {} })
  assert.deepEqual([production[0] === HOST_REMOTE, 'echoFixture' in stock.service, Object.keys(stock.service)], [true, false, ['ctx', 'typertRemote', ...Object.keys(OPERATIONS)]])
  await Promise.all([installed.dispose(), stock.dispose()])
})

test('dispatch rejects stream and undeclared names with a fixed message before the guard (#374)', async () => {
  // guard 是诊断日志的唯一写入口（`guarded`）：它与 handler 一次都没被调用，就等于没有日志增量、没有碰 Controller。
  const calls = []
  const handlers = { baseline: async () => { calls.push('handler') }, bootstrapWorkspace: async () => { calls.push('handler') } }
  const dispatch = dispatchOf(OPERATIONS, handlers, (run) => { calls.push('guard'); return run() })
  const canary = 'secret-canary-name'
  // stream 名字（已声明但不是 unary）、未声明名字、原型链上的键（`toString` 等不是声明）：同一条固定文案，不回显调用方给的名字。
  for (const name of ['watch', canary, 'toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    await assert.rejects(() => dispatch({}, name, {}), (error) => error instanceof TypeError && error.message === '操作名 必须是已声明的 unary 操作' && !error.message.includes(canary), name)
  }
  // 非字符串名字：每次转成属性键结果都可能不同（首次是 baseline、之后是 watch），或者是一个会被转成 baseline 的数组。
  let reads = 0
  const shifting = { toString: () => (reads++ === 0 ? 'baseline' : 'watch') }
  for (const name of [shifting, ['baseline']]) {
    await assert.rejects(() => dispatch({}, name, {}), (error) => error instanceof TypeError && error.message === '操作名 必须是已声明的 unary 操作')
  }
  assert.deepEqual(calls, [], 'guard 与 handler 都没有被触达')
  // 对照：声明过的 unary 名字照旧先 guard 再 handler。
  await dispatch({}, 'baseline', {})
  assert.deepEqual(calls, ['guard', 'handler'])
})

test('execution context unary declares two explicit IDs with strict non-empty wire codecs', () => {
  const descriptor = HOST_REMOTE.invocations.find(({ method }) => method === 'getExecutionContext')
  assert.ok(descriptor)
  assert.deepEqual(descriptor.parameters.map(({ name, wire }) => [name, wire]), [['workItemId', 'workItemId'], ['repositoryId', 'repositoryId']])
  for (const parameter of descriptor.parameters) { assert.equal(parameter.codec.create().parse('id'), 'id'); for (const value of ['', null, 3]) assert.throws(() => parameter.codec.create().parse(value), TypeError) }
})
