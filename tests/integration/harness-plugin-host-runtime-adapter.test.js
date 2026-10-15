import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { apply as applyHost, inject as hostInject } from '../../apps/harness-plugin/src/host.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { HANDLE, replayFetch, seed, seedPlanning, seedWorkspace } from './fixtures/host-seed.js'

/** 宿主 Context 替身：`effect` 登记卸载 disposer，`provide` 发布 live service，`get` 起初回答不了任何服务（测试可在运行中换掉它）。 */
async function withHost(run, { register = () => async () => {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-entry-'))
  const services = new Map()
  const effects = []
  const ctx = {
    get: () => undefined,
    provide(name, value) { services.set(name, value); return () => { services.delete(name) } },
    typert: { register },
    effect(callback) { effects.push(callback()) },
  }
  process.env.DSH_HOME = root
  try { await run({ ctx, services, effects, dataDir: path.join(root, 'harness-projects') }) } finally {
    delete process.env.DSH_HOME
    await rm(root, { recursive: true, force: true })
  }
}

test('Host entry loads without the credentials service, resolves it per provider operation once it appears, and unload drains before closing storage', async (t) => {
  assert.deepEqual(hostInject, ['typert'], 'credentials 不进 inject：宿主缺这个服务时插件不得静默停在 PENDING')
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  let canary = 'credential-canary-1'
  let hold
  const references = []
  const credential = { resolve: async (reference) => { references.push(reference); return { value: canary, source: 'test' } } }
  // 回放进 globalThis.fetch：Host 的 GitHub transport 默认在调用时读取它；`hold` 让在途调用停在 provider 里。
  const replay = replayFetch(() => hold)
  t.mock.method(globalThis, 'fetch', replay.fetch)
  const received = () => replay.requests.map((request) => request.authorization)
  await withHost(async ({ ctx, services, effects, dataDir }) => {
    await seed(path.join(dataDir, 'workspace.sqlite'), PROVIDER_CATALOG, async (storage) => { await seedWorkspace(storage); await seedPlanning(storage) })
    close.mock.resetCalls() // 种子写库时关过一次
    await applyHost(ctx)
    const service = services.get('harnessProjects')
    const baseline = await service.baseline()
    const failed = await service.bootstrapWorkspace({ kind: 'agent', id: 'host-entry' }, 'host-entry-0')
    assert.deepEqual([baseline.workspace.name, baseline.entities.length, failed.writeState, received().length], ['Seeded Workspace', 0, 'failed', 0], '服务缺席：Host 照常加载、往返照常完成，规划操作结构化失败且不发请求')
    assert.ok((await readFile(path.join(dataDir, 'diagnostics.log'), 'utf8')).includes('"name":"CredentialServiceUnavailable"'), '诊断日志记下服务缺席')

    // 服务出现：不重载 Host，下一次操作就经 ctx.get 取到它并按句柄解析。
    ctx.get = (name) => (name === 'credentials' ? credential : undefined)
    const command = await service.bootstrapWorkspace({ kind: 'agent', id: 'host-entry' }, 'host-entry-1')
    assert.deepEqual([command.writeState, (await service.baseline()).entities.length > 0, received()[0]], ['local_only', true, 'bearer credential-canary-1'])

    canary = 'credential-canary-2' // 在途调用按操作解析，拿到的是新值
    // 卸载先排空在途调用再关闭 SQLite：provider 挂起期间不得 close。
    let release
    hold = new Promise((resolve) => { release = resolve })
    const inFlight = service.bootstrapWorkspace({ kind: 'agent', id: 'host-entry' }, 'host-entry-2')
    const unload = (async () => { for (const dispose of effects.reverse()) await dispose() })()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(close.mock.callCount(), 0, '在途调用结束前不得关闭 SQLite')
    release()
    await Promise.all([inFlight, unload])
    assert.deepEqual([close.mock.callCount(), services.has('harnessProjects')], [1, false])
    await assert.rejects(() => service.baseline(), /已卸载/)
    assert.deepEqual([received().at(-1), replay.misses], ['bearer credential-canary-2', []])
    assert.deepEqual(references, received().map(() => HANDLE), '每次 provider 操作各解析一次引用')
  })
})

test('Host entry closes storage and publishes nothing when composition or remote registration fails', async (t) => {
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  const cases = [
    // 组合失败：存储已打开、读已存工作区时被拒绝（宿主级失败，整体关闭）。
    [() => t.mock.method(SqliteStorage.prototype, 'getWorkspace', async () => { throw new Error('composition refused') }), undefined, /composition refused/],
    [() => undefined, () => { throw new Error('register refused') }, /register refused/],
  ]
  for (const [fault, register, reason] of cases) {
    await withHost(async ({ ctx, services, effects }) => {
      const before = close.mock.callCount()
      const injected = fault()
      try { await assert.rejects(() => applyHost(ctx), reason) } finally { injected?.mock.restore() }
      assert.deepEqual([close.mock.callCount() - before, services.size, effects.length], [1, 0, 0])
    }, register === undefined ? {} : { register })
  }
})
