import assert from 'node:assert/strict'
import test from 'node:test'

import { providerErr, providerError } from '@harness-projects/capabilities'
import { bootstrapWorkspace, createContext } from '@harness-projects/core'
import { ContentKind, ProviderErrorCode, RedactionReason, StatusPolicy } from '@harness-projects/domain'
import { createFakeProviders, createFakeStorage, fixtureProjectRef, removeItem } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const STATUS_VALUE = { projectFieldId: 'status', value: 'todo', observedAt: '2026-10-13T00:00:00Z' }

/** 完整 bootstrap 一轮后给 issue-2 的成员挂一条字段值：后续用例都围绕这个条目判断「删 / 不删」。 */
async function seeded(label, makeStorage, tag) {
  const providers = createFakeProviders()
  const storage = makeStorage()
  const workspace = { id: `membership-reconcile-${tag}-${label}`, name: label, statusPolicy: StatusPolicy.ProviderAuthoritative, project: fixtureProjectRef(providers.planning.bindingId) }
  const context = await createContext({ workspace, providers, storage })
  assert.ok(context)
  assert.equal((await bootstrapWorkspace(context)).ok, true)
  const item = providers.planning.state.items.find((candidate) => candidate.ref.externalId === 'issue-2')
  assert.ok(item)
  await storage.putFieldValue({ workspaceId: workspace.id, itemExternalId: item.membership.externalId, ...STATUS_VALUE })
  return { providers, storage, workspace, context, item }
}

/** 未提交的一轮必须让成员关系、字段值与业务修订号三者一起保持最后已知值（#332 验收 3）。 */
const lastKnown = async ({ storage, workspace, item }) => ({
  membership: await storage.getMembership(workspace.id, item.membership.externalId),
  fieldValues: await storage.listFieldValues(workspace.id, item.membership.externalId),
  revision: await storage.currentRevision(workspace.id),
})

/** 只改写 provider 返回的条目列表，分页游标照旧。 */
function rewriteItems(providers, rewrite) {
  const original = providers.planning.listPlanningItems.bind(providers.planning)
  providers.planning.listPlanningItems = async (input) => {
    const page = await original(input)
    return page.ok ? { ...page, value: { ...page.value, items: rewrite(page.value.items) } } : page
  }
}

/** 每种故障都在 provider 端移除（或让本轮看不到）issue-2：一旦误提交，成员关系就会被删、修订号就会推进。 */
const UNCOMMITTED_ROUNDS = {
  'pagination cycle': [ProviderErrorCode.Unavailable, ({ providers, item }) => {
    const original = providers.planning.listPlanningItems.bind(providers.planning)
    removeItem(providers.planning.state, item.ref)
    providers.planning.listPlanningItems = async (input) => {
      const page = await original(input)
      return page.ok ? { ...page, value: { ...page.value, nextCursor: page.value.nextCursor ?? '0' } } : page
    }
  }],
  'provider error on a later page': [ProviderErrorCode.RateLimited, ({ providers, item }) => {
    const original = providers.planning.listPlanningItems.bind(providers.planning)
    removeItem(providers.planning.state, item.ref)
    providers.planning.listPlanningItems = async (input) => (input.cursor === undefined
      ? original({ ...input, limit: 1 })
      : providerErr(providerError(ProviderErrorCode.RateLimited, 'later page rejected')))
  }],
  // 更晚开始的一轮在本轮读取期间完整提交（provider 仍有 issue-2），本轮视图里没有 issue-2，只能以 stale_revision 放弃。
  'superseded round': ['stale_revision', ({ providers, context, item }) => {
    const original = providers.planning.listPlanningItems.bind(providers.planning)
    let nested = false
    providers.planning.listPlanningItems = async (input) => {
      const page = await original(input)
      if (!page.ok || nested) return page
      nested = true
      assert.equal((await bootstrapWorkspace(context)).ok, true, 'the newer round reads the full provider state and commits first')
      return { ...page, value: { ...page.value, items: page.value.items.filter((candidate) => candidate.membership.externalId !== item.membership.externalId) } }
    }
  }],
  'storage reject inside the commit transaction': [ProviderErrorCode.Unavailable, ({ providers, storage, item }) => {
    removeItem(providers.planning.state, item.ref)
    const transaction = storage.transaction.bind(storage)
    storage.transaction = (work) => transaction((tx) => work(new Proxy(tx, {
      get: (target, key) => (key === 'putReconcileCursor'
        ? async () => { throw new Error('reconcile cursor rejected') }
        : typeof target[key] === 'function' ? target[key].bind(target) : target[key]),
    })))
  }],
}

for (const [label, makeStorage] of [['Fake Storage', () => createFakeStorage()], ['SQLite', () => createSqliteStorage(':memory:')]]) {
  test(`Planning full read：membership deletion converges and re-add preserves identity (${label})`, async () => {
    const { providers, storage, workspace, context, item } = await seeded(label, makeStorage, 'converge')
    const identity = await storage.findExternalIdentity(providers.planning.bindingId, 'issue', 'issue-2')
    assert.ok(identity)

    removeItem(providers.planning.state, item.ref)
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.equal(await storage.getMembership(workspace.id, item.membership.externalId), undefined)
    assert.deepEqual(await storage.listFieldValues(workspace.id, item.membership.externalId), [])
    assert.deepEqual(await storage.findExternalIdentity(providers.planning.bindingId, 'issue', 'issue-2'), identity)

    providers.planning.state.items.push(item)
    assert.equal((await bootstrapWorkspace(context)).ok, true)
    assert.deepEqual(await storage.findExternalIdentity(providers.planning.bindingId, 'issue', 'issue-2'), identity)
    assert.equal((await storage.getMembership(workspace.id, item.membership.externalId))?.contentExternalId, 'issue-2')
    assert.deepEqual(await storage.listFieldValues(workspace.id, item.membership.externalId), [], 'removed field values must not resurrect on re-add')
    storage.close?.()
  })

  for (const [name, [code, inject]] of Object.entries(UNCOMMITTED_ROUNDS)) {
    test(`Planning uncommitted round：${name} keeps membership, field values and revision (${label})`, async () => {
      const env = await seeded(label, makeStorage, name.replaceAll(' ', '-'))
      const before = await lastKnown(env)
      assert.ok(before.membership)
      inject(env)
      const result = await bootstrapWorkspace(env.context)
      assert.deepEqual([result.ok, result.error?.code], [false, code])
      assert.deepEqual(await lastKnown(env), before, '未提交的一轮不得删除成员关系、字段值，也不得推进修订号')
      env.storage.close?.()
    })
  }

  // 三个分量 × 两个通道各自独立判别：只比较 externalId 的校验会放过 binding 或 objectKind 不同的同名 project，
  // 只校验 redacted 通道的实现会让可见条目带着别的 project 直接提交。
  for (const channel of ['redacted', 'visible']) for (const [field, value] of [['externalId', 'project-other'], ['bindingId', 'binding-other'], ['objectKind', 'repository']]) {
    test(`Planning scope mismatch：${channel} item with another project ${field} fails closed before membership/projection writes (${label})`, async () => {
      const { providers, storage, workspace, context, item } = await seeded(label, makeStorage, `scope-${channel}-${field}`)
      const membershipBefore = await storage.getMembership(workspace.id, item.membership.externalId)
      assert.ok(membershipBefore)
      const projectionsBefore = await storage.listPlanningProjections(workspace.id)
      const foreign = channel === 'visible'
        ? { ...item, project: { ...item.project, [field]: value } }
        : {
            ...item,
            ref: { ...item.ref, objectKind: 'project_item', externalId: item.membership.externalId },
            project: { ...item.project, [field]: value },
            content: { kind: ContentKind.Redacted, reason: RedactionReason.PermissionDenied },
          }
      rewriteItems(providers, (items) => [...items.filter((candidate) => candidate.membership.externalId !== item.membership.externalId), foreign])

      const result = await bootstrapWorkspace(context)
      assert.deepEqual([result.ok, result.degraded, result.error?.code], [false, true, 'invalid_input'])
      assert.deepEqual(await storage.getMembership(workspace.id, item.membership.externalId), membershipBefore, 'scope mismatch must not delete the current project membership')
      assert.deepEqual(await storage.listFieldValues(workspace.id, item.membership.externalId), [{ workspaceId: workspace.id, itemExternalId: item.membership.externalId, ...STATUS_VALUE }])
      assert.deepEqual(await storage.listPlanningProjections(workspace.id), projectionsBefore, 'scope mismatch must not preserve a projection after deleting its membership')
      storage.close?.()
    })
  }
}
