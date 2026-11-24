import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { composeCore, createContext } from '@harness-projects/core'
import { createFakeProviders, createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'

/**
 * #632 装配契约：Storage 只能经 `CoreProviderTable.storage` 进入 core。
 *
 * 两个用例的游离顶层 `storage` 键是退役第二入口的常驻回归护栏（先例：用运行时形状断言退役 API）：
 * JS 测试不经 tsc，删除 `CoreDeps.storage` 之后多余键不会报错，只有在这里才能钉住「同次装配的
 * 第二个 storage 不被选中、零写入」。
 *
 * 这是刻意设计而非疏忽：退役入口的运行时护栏必须故意传一个类型上非法的多余键。若未来把 `tests/`
 * 纳入 tsc（或给本文件加 `// @ts-check`），此处 excess property 会报错——届时改用具名类型断言或
 * `as` 断言保住运行时形状，不要删掉这条护栏。
 */
test('注入表 storage 是唯一入口，同次装配的游离顶层 storage 不被选中、零写入', async () => {
  const workspace = { name: 'Storage assembly' }
  const providers = createFakeProviders()
  const table = providers.storage
  const stray = createFakeStorage()
  const context = await createContext({ workspace, providers, storage: stray })
  // 表内实例被选中，且游离键没有参与任何写入。
  assert.equal(context.storage, table)
  const tableState = exportFakeStorageState(table)
  assert.equal(tableState.workspaces.length, 1)
  assert.equal(tableState.providerBindings.length, 4)
  const strayState = exportFakeStorageState(stray)
  assert.equal(strayState.workspaces.length, 0)
  assert.equal(strayState.providerBindings.length, 0)
})

test('表内没有 storage 时结构化不可用', async () => {
  const stray = createFakeStorage()
  const before = exportFakeStorageState(stray)
  const fence = stray.committedReadFence()
  for (const deps of [
    { providers: {} },
    { workspace: { name: 'Missing table storage' }, providers: {}, storage: stray },
  ]) {
    assert.equal(await createContext(deps), undefined)
    const core = await composeCore(deps)
    assert.deepEqual(await core.queries.getPlanningSync(), { degraded: true, stale: true, reason: '没有可用的 storage 绑定' })
    assert.equal((await core.queries.getStartWorkTargetError('missing')).code, 'not_supported')
  }
  assert.deepEqual(exportFakeStorageState(stray), before, '表内缺失时不得写入顶层游离实例')
  assert.equal(stray.committedReadFence(), fence, '顶层游离实例不得发生提交')
})
