import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { createFakeProviders } from '@harness-projects/provider-fake'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { apply as applyHost } from '../../apps/harness-plugin/src/host.ts'
import { HOST_REMOTE } from '../../apps/harness-plugin/src/remote.ts'

/** 宿主 Context 替身：`effect` 登记卸载 disposer，`provide` 发布 live service，`get` 只回答两个注入名。 */
async function withHost(factory, run, { credential = { resolve: async () => undefined }, register = () => async () => {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-entry-'))
  const services = new Map()
  const effects = []
  const ctx = {
    get: (name) => (name === 'harnessProjectsProviders' ? factory : name === 'credentials' ? credential : undefined),
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

test('Host entry resolves credentials per provider operation, keeps values out of SQLite and results, and unload closes storage once', async (t) => {
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  let canary = 'credential-canary-1'
  let hold
  const references = []
  const received = []
  const credential = { resolve: async (reference) => { references.push(reference); return { value: canary, source: 'test' } } }
  // 断言放在 provider 外：Core 会把 provider 内抛出的异常转成结构化降级，provider 里的 assert 失败不会让测试失败。
  const factory = { create: async ({ resolveCredential }) => {
    const providers = createFakeProviders()
    return { ...providers, planning: new Proxy(providers.planning, { get(target, property, receiver) {
      if (property === 'getProject') return async (ref) => { await hold; received.push(await resolveCredential('HARNESS_FAKE_TOKEN')); return target.getProject(ref) }
      return Reflect.get(target, property, receiver)
    } }) }
  } }
  await withHost(factory, async ({ ctx, services, effects, dataDir }) => {
    await applyHost(ctx)
    const service = services.get('harnessProjects')
    const baseline = await service.baseline()
    canary = 'credential-canary-2'
    const command = await service.bootstrapWorkspace({ kind: 'agent', id: 'host-entry' }, 'host-entry-1')
    // 组合期水合必须成功（否则 provider 收到的值没有被使用），workspace 输入原样交给 Core。
    assert.deepEqual([baseline.workspace.name, baseline.entities.length > 0, command.writeState], ['Harness Projects', true, 'local_only'])
    assert.deepEqual([received[0], received.at(-1)], ['credential-canary-1', 'credential-canary-2'])
    assert.deepEqual(references, received.map(() => 'HARNESS_FAKE_TOKEN'), '每次 provider 操作各解析一次引用')
    const encode = HOST_REMOTE.invocations[0].result.encode
    assert.equal(JSON.stringify([encode(baseline), encode(command)]).includes('credential-canary'), false)

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
    const db = new DatabaseSync(path.join(dataDir, 'workspace.sqlite'), { readOnly: true })
    const persisted = [db.prepare('SELECT id, name FROM workspace').all().map(({ id, name }) => [id, name]), db.prepare('SELECT count(*) AS n FROM entity').get().n]
    db.close()
    assert.deepEqual(persisted, [[['00000000-0000-4000-8000-000000000228', 'Harness Projects']], baseline.entities.length], 'Core 必须写进 Host 的 SQLite，注入表里的 storage 不得压过它')
    for (const file of await readdir(dataDir)) {
      assert.equal((await readFile(path.join(dataDir, file), 'latin1')).includes('credential-canary'), false, file)
    }
  }, { credential })
})

test('Host entry closes storage and publishes nothing when composition or remote registration fails', async (t) => {
  const close = t.mock.method(SqliteStorage.prototype, 'close')
  const cases = [
    [{ create: async () => ({ ...createFakeProviders(), planning: {} }) }, undefined, /缺少必需方法/],
    [{ create: async () => createFakeProviders() }, () => { throw new Error('register refused') }, /register refused/],
  ]
  for (const [factory, register, reason] of cases) {
    await withHost(factory, async ({ ctx, services, effects }) => {
      const before = close.mock.callCount()
      await assert.rejects(() => applyHost(ctx), reason)
      assert.deepEqual([close.mock.callCount() - before, services.size, effects.length], [1, 0, 0])
    }, register === undefined ? {} : { register })
  }
})
