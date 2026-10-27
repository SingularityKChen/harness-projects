import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'

test('生产目录提供 Harness 会话和人工备用执行', () => {
  assert.ok(PROVIDER_CATALOG.has('execution.harness'), 'Harness 执行必须能由生产目录恢复')
  assert.ok(PROVIDER_CATALOG.has('execution.human'), '人工备用必须能由生产目录恢复')
})

const signal = new AbortController().signal
const context = (bindingId) => ({ bindingId, objectKind: 'execution_context', externalId: 'request-1', url: undefined })
test('raw 嵌套事件白名单、同步 receiver 与 lazy 服务重载', async () => {
  assert.ok(PROVIDER_CATALOG.has('execution.harness'))
  const { createHostSessionPort } = await import('../../apps/harness-plugin/src/host-session-adapter.ts')
  let service, calls = 0
  const port = createHostSessionPort(() => service)
  await assert.rejects(port.create({ cwd: '/work' }), /unavailable/)
  service = {
    id: 'session-1', create() { calls++; return { sessionId: this.id, secret: 'drop' } },
    prompt() { assert.equal(this.id, 'session-1'); return { accepted: true, secret: 'drop' } },
    inspect() { return { events: [
      { seq: 1, type: 'turn/start', turn: 90, data: { turn: 1 } },
      { seq: 2, type: 'user/message', rpcId: 'wrong', data: { source: { kind: 'user', rpcId: 'request-1' }, content: 'drop' } },
      { seq: 3, type: 'user/message', data: { source: { kind: 'agent', rpcId: 'request-1' } } },
      { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', token: 'drop' } } } },
    ], secret: 'drop' } },
    list() { return { items: [{ sessionId: this.id, running: false, secret: 'drop' }] } },
  }
  assert.deepEqual(await port.create({ cwd: '/work' }), { sessionId: 'session-1' })
  assert.deepEqual(await port.prompt({}, signal), { accepted: true })
  assert.deepEqual(await port.inspect('session-1', signal), { events: [
    { seq: 1, type: 'turn/start', turn: 1 }, { seq: 2, type: 'user/message', rpcId: 'request-1' }, { seq: 4, type: 'turn/end', turn: 1, reason: { kind: 'error' } },
  ] })
  assert.deepEqual(await port.list({}, signal), { items: [{ sessionId: 'session-1', running: false }] })
  service = { create() { return { sessionId: 'replacement' } } }
  assert.equal((await port.create({ cwd: '/work' })).sessionId, 'replacement')
  service = undefined
  await assert.rejects(port.inspect('session-1', signal), /unavailable/)
  const aborted = AbortSignal.abort(); await assert.rejects(port.prompt({}, aborted))
  const forced = createHostSessionPort(() => { calls++; return service }, true)
  await assert.rejects(forced.create({ cwd: '/work' }), /unavailable/)
  assert.equal(calls, 1, 'force 不解析服务，也不发 create/prompt')
})

test('人工 wrapper 能力不读 key；每次解析固定句柄，坏 key 固定拒绝，同 key 重建可读', async () => {
  const entry = PROVIDER_CATALOG.get('execution.human'); assert.ok(entry)
  let key = 'issuer-canary-52a67f3a-324a-4e48-b075-aaf10db8f63e', reads = 0
  const input = { binding: { id: 'human-1' }, resolveCredential: async (handle) => { assert.equal(handle, 'HARNESS_PROJECTS_MANUAL_ISSUER_KEY'); reads++; return key } }
  const first = await entry.create(input)
  assert.equal((await first.describeCapabilities()).capability['execution.run.fallback'], 'available')
  assert.equal(reads, 0)
  const started = await first.startRun({ context: context('human-1'), command: 'work', workingDirectory: '/work', environment: {} })
  assert.equal(started.ok, true)
  const restarted = await entry.create(input)
  assert.deepEqual(await restarted.getRun(started.value.ref), started)
  for (key of [undefined, '', 'short']) {
    const result = await restarted.getRun(started.value.ref)
    assert.deepEqual([result.ok, result.error.code], [false, 'unavailable'])
    assert.doesNotMatch(JSON.stringify(result), /issuer-canary|short/)
  }
  assert.equal(reads, 5)
})

test('setup source 显式安装复用未知 intent key，并在 ack 后重新读取 Host', async () => {
  const { createWorkspaceSetupSource } = await import('@harness-projects/client')
  const calls = []; let installed = false
  const source = createWorkspaceSetupSource({ getWorkspaceSetup: async () => ({ workspace: { id: 'w', name: 'workspace' }, planning: { state: 'unbound' }, ...(installed ? { executionInstalled: true } : {}) }),
    installExecutionBindings: async (actor, key) => { calls.push([actor, key]); if (calls.length === 1) return { writeState: 'unknown', saving: false, authoritative: false }; installed = true; return { writeState: 'local_only', saving: false, authoritative: false, value: { bindingIds: ['h', 'm'] } } },
  }, { actorRef: { kind: 'user' }, key: () => 'install' })
  assert.equal(typeof source.installExecution, 'function')
  await source.installExecution(); assert.equal(source.getSnapshot().error?.code, 'result_unknown'); await source.installExecution()
  assert.deepEqual(calls, [[{ kind: 'user' }, 'install:execution'], [{ kind: 'user' }, 'install:execution']])
  assert.equal(source.getSnapshot().setup.executionInstalled, true)
  source.dispose(); await source.installExecution(); assert.equal(calls.length, 2)
})

test('人工密钥解析有操作预算，晚到 secret 不启动签发者', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  const entry = PROVIDER_CATALOG.get('execution.human')
  const provider = await entry.create({ binding: { id: 'human-budget' }, resolveCredential: () => new Promise((resolve) => { release = resolve }) })
  const pending = provider.startRun({ context: context('human-budget'), command: 'work', workingDirectory: '/work', environment: {} })
  let result; void pending.then((value) => { result = value })
  t.mock.timers.tick(30_000)
  await new Promise((resolve) => setImmediate(resolve))
  try { assert.deepEqual(result && [result.ok, result.error.code], [false, 'unavailable'], '预算结束必须返回固定 unavailable') }
  finally { release('issuer-canary-52a67f3a-324a-4e48-b075-aaf10db8f63e'); await pending }
})

for (const condition of ['unknown', 'pending', 'malformed', 'activation-command', 'activation-read', 'read-failure']) test(`未确认安装保留原 intent：${condition}`, async () => {
  const { createWorkspaceSetupSource } = await import('@harness-projects/client')
  const { projectError } = await import('@harness-projects/domain')
  const activationError = projectError('unavailable', 'activation unavailable'), keys = []
  let reads = 0
  const source = createWorkspaceSetupSource({
    getWorkspaceSetup: async () => {
      reads++
      if (condition === 'read-failure' && reads === 1) throw new Error('read unavailable')
      return { workspace: { id: 'w', name: 'workspace' }, planning: { state: 'unbound' }, executionInstalled: true, ...(condition === 'activation-read' && reads === 1 ? { activationError } : {}) }
    },
    installExecutionBindings: async (_actor, key) => {
      keys.push(key)
      if (keys.length === 1) {
        if (condition === 'malformed') return { unexpected: true }
        if (condition === 'unknown' || condition === 'pending') return { writeState: condition, saving: condition === 'pending', authoritative: false }
      }
      return { writeState: 'local_only', saving: false, authoritative: false, value: { bindingIds: ['h', 'm'] }, ...(condition === 'activation-command' && keys.length === 1 ? { activationError } : {}) }
    },
  }, { actorRef: { kind: 'user' }, key: () => 'retained-install' })
  await source.installExecution(); await source.installExecution()
  assert.deepEqual(keys, ['retained-install:execution', 'retained-install:execution'])
  assert.equal(source.getSnapshot().error, undefined)
  assert.equal(source.getSnapshot().setup.executionInstalled, true)
  source.dispose()
})

for (const state of ['unknown', 'pending']) test(`未 ack 安装不能由既有配置读数结束：${state}`, async () => {
  const { createWorkspaceSetupSource } = await import('@harness-projects/client')
  const keys = [], setup = { workspace: { id: 'w', name: 'workspace' }, planning: { state: 'unbound' }, executionInstalled: true }
  const source = createWorkspaceSetupSource({ getWorkspaceSetup: async () => setup,
    installExecutionBindings: async (_actor, key) => { keys.push(key); return { writeState: state, saving: state === 'pending', authoritative: false } },
  }, { actorRef: { kind: 'user' }, key: () => 'unacked-install' })
  try {
    await source.installExecution(); await source.refresh(); await source.installExecution()
    assert.deepEqual(keys, ['unacked-install:execution', 'unacked-install:execution'], '未 ack 命令不能借旧配置读数换键')
  } finally { source.dispose() }
})

test('已 ack 安装的激活错误由后续干净读取结算', async () => {
  const { createWorkspaceSetupSource } = await import('@harness-projects/client')
  const { projectError } = await import('@harness-projects/domain')
  const activationError = projectError('unavailable', 'activation unavailable'), keys = []
  let activation = true, installed = true
  const source = createWorkspaceSetupSource({
    getWorkspaceSetup: async () => ({ workspace: { id: 'w', name: 'workspace' }, planning: { state: 'unbound' }, ...(installed ? { executionInstalled: true } : {}), ...(activation ? { activationError } : {}) }),
    installExecutionBindings: async (_actor, key) => { keys.push(key); return { writeState: 'local_only', saving: false, authoritative: false, value: { bindingIds: ['h', 'm'] }, ...(activation ? { activationError } : {}) } },
  }, { actorRef: { kind: 'user' }, key: () => 'activated-install' })
  try {
    await source.installExecution(); await source.refresh(); await source.installExecution()
    assert.equal(keys[0], keys[1], '激活尚未恢复必须沿用已 ack 意图')
    activation = false; await source.refresh()
    installed = false; await source.refresh(); await source.installExecution()
    assert.notEqual(keys[1], keys[2], '激活恢复的确认读数必须结束旧意图')
  } finally { source.dispose() }
})

test('旧读取不得发布或结算后续安装意图', async () => {
  const { createWorkspaceSetupSource } = await import('@harness-projects/client')
  const { projectError } = await import('@harness-projects/domain')
  const setup = { workspace: { id: 'w', name: 'workspace' }, planning: { state: 'unbound' } }, keys = []
  let hold = false, release
  const source = createWorkspaceSetupSource({
    getWorkspaceSetup: async () => hold ? (hold = false, new Promise((resolve) => { release = resolve })) : setup,
    installExecutionBindings: async (_actor, key) => {
      keys.push(key)
      if (keys.length === 2) return { writeState: 'failed', saving: false, authoritative: false, error: projectError('unavailable', 'install unavailable') }
      if (keys.length >= 3) return { writeState: 'unknown', saving: false, authoritative: false }
      return { writeState: 'local_only', saving: false, authoritative: false, value: { bindingIds: ['h', 'm'] } }
    },
  }, { actorRef: { kind: 'user' }, key: () => 'versioned-install' })
  try {
    await source.installExecution()
    hold = true; const oldRead = source.refresh()
    await new Promise((resolve) => setImmediate(resolve))
    await source.installExecution(); await source.installExecution()
    release({ ...setup, executionInstalled: true }); await oldRead
    assert.equal(source.getSnapshot().setup.executionInstalled, undefined, '旧版本的确认读数不得覆盖当前快照')
    await source.installExecution()
    assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]); assert.equal(keys[2], keys[3], '旧意图的读数不得结算新 unknown 意图')
  } finally { source.dispose() }
})
