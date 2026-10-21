import assert from 'node:assert/strict'
import test from 'node:test'

import { CLIENT_REMOTE, HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'

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
  assert.deepEqual(shape(HOST_REMOTE.invocations), GOLDEN)
  assert.equal(CLIENT_REMOTE.descriptors, HOST_REMOTE.invocations)
})
