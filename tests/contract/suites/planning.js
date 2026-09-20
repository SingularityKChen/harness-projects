/** Planning 契约套件：接受任意 PlanningProvider 适配器 `{ label, makeProvider(scenario), expect }`。scenario 由本套件定义，适配器负责翻译成自己的构造参数：`{}` 全能力无故障；`{ capabilities: { createIssue: false } }` 可选能力未启用；`{ faults: { permissionDenied: true } }` 权限被拒；`{ faults: { offline: true } }` 离线；`{ faults: { duplicateEvent: true } }` 重复投递。`expect`：`{ project, pageSize, items: [{ externalId, objectKind, contentKind }], redactedReason }`。看护的不变量（tests/README.md §2.4、§3）：分页遍历不重不漏；redacted 不回退到缓存内容；失败是结构化结果而不是裸错误；重复观察收敛到同一稳定去重键。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'

const idsOf = (items) => items.map((item) => item.ref.externalId)
const sorted = (values) => [...values].sort()
const refFor = (project, item) => ({ ...project, objectKind: item.objectKind, externalId: item.externalId })
export function planningContractSuite(adapter) {
  const { label, makeProvider, expect } = adapter
  const expectedIds = expect.items.map((item) => item.externalId)

  test(`${label}：分页遍历不重不漏`, async () => {
    const provider = makeProvider({})
    const all = await provider.listPlanningItems({ project: expect.project, cursor: undefined, limit: 100 })
    assert.equal(all.ok, true)
    assert.deepEqual(sorted(idsOf(all.value.items)), sorted(expectedIds))

    const seen = []
    let cursor
    let pages = 0
    do {
      const page = await provider.listPlanningItems({ project: expect.project, cursor, limit: expect.pageSize })
      assert.equal(page.ok, true)
      seen.push(...idsOf(page.value.items))
      cursor = page.value.nextCursor
      pages += 1
      assert.ok(pages <= expectedIds.length, '游标必须单调推进，否则会死循环')
    } while (cursor !== undefined)
    assert.deepEqual(sorted(seen), sorted(expectedIds), '分页遍历必须与单页结果一致')
    assert.equal(new Set(seen).size, seen.length, '分页不得重复投递同一对象')
  })

  test(`${label}：内容三态判别，redacted 不得回退到缓存`, async () => {
    const provider = makeProvider({})
    for (const item of expect.items) {
      const result = await provider.getPlanningItem(refFor(expect.project, item))
      assert.equal(result.ok, true)
      assert.equal(result.value.content.kind, item.contentKind)
      if (item.contentKind === 'redacted') assert.equal(result.value.content.reason, expect.redactedReason)
      else if (item.contentKind === 'work_item') assert.equal(result.value.content.workItem.externalId, item.externalId)
      else assert.ok(result.value.content.changeRequest.number > 0, '变更请求必须带编号')
    }
  })

  test(`${label}：未启用的可选能力返回 not_supported`, async () => {
    const provider = makeProvider({ capabilities: { createIssue: false } })
    const snapshot = await provider.describeCapabilities()
    assert.notEqual(snapshot.capability[CapabilityKey.PlanningItemCreateIssue], 'available')
    // provider 也可以直接不实现该可选方法——对调用方是同一个契约结论（能力不存在）。
    if (typeof provider.createIssueWorkItem !== 'function') return
    const result = await provider.createIssueWorkItem({ project: expect.project, title: '标题', body: '正文' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'not_supported')
  })

  test(`${label}：权限被拒返回结构化 permission_denied`, async () => {
    const provider = makeProvider({ faults: { permissionDenied: true } })
    const result = await provider.listPlanningItems({ project: expect.project, cursor: undefined, limit: 10 })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'permission_denied')
    assert.equal(result.error.retryable, false)
  })

  test(`${label}：离线返回结构化 unavailable 且不抛裸错误`, async () => {
    const provider = makeProvider({ faults: { offline: true } })
    const results = await Promise.all([
      provider.getProject(expect.project),
      provider.listPlanningItems({ project: expect.project, cursor: undefined, limit: 10 }),
      provider.getPlanningItem(refFor(expect.project, expect.items[0])),
    ])
    for (const result of results) {
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'unavailable')
      assert.equal(result.error.retryable, true)
    }
  })

  test(`${label}：同一观察投递两次得到同一个稳定去重键`, async () => {
    const provider = makeProvider({ faults: { duplicateEvent: true } })
    const declined = makeProvider({ capabilities: { reconcile: false } })
    // reconcile 是可选成员：实现未声明时不得假装有观察流，调用方退回轮询且读路径必须仍完整。
    if (typeof declined.reconcile !== 'function') assert.deepEqual(sorted(idsOf((await declined.listPlanningItems({ project: expect.project, cursor: undefined, limit: 100 })).value.items)), sorted(expectedIds), '缺省观察流不得让全量读取退化')
    if (typeof provider.reconcile !== 'function') return
    const keys = []
    for await (const observation of provider.reconcile({ scopeKey: 'planning', cursor: undefined })) {
      keys.push(observation.dedupeKey)
    }
    assert.ok(keys.length >= 2, '重复投递场景必须有不止一条观察')
    assert.equal(keys[0], keys[1], '同一观察的两次投递必须得到同一个稳定键')
    const counts = new Map()
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
    assert.ok([...counts.values()].every((count) => count >= 2), '每条观察都必须被投递两次')
    assert.equal(counts.size, keys.length / 2, '不同观察不得塌成同一个键')
  })
}
