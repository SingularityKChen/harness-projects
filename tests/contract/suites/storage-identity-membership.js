/**
 * 身份与成员关系面：L2（#27）的判别性断言（每条配过一次注入实验）。本文件按端口面独立成文、L4 及以上原样继承；
 * 两个适配器（内存替身与 SQLite）现在都注册两组（地基组在 L4、同步组在 L5）。两个 suite 接受 `register` 参数
 * （默认 `test`），因此可以走 `storage-contract.test.js` 的 `assemble` 装配台账——直接注册会绕过"实际注册条数"
 * 守卫，删掉某一组装配时套件静默少跑（第四轮评审 P2 的缺陷形态）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const WORKSPACE = 'ws-1'
const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
const binding = (id, isDefault = false) => ({ id, workspaceId: WORKSPACE, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault })
/** planning 域只允许一个启用的挂载（不变量 1），跨域用例换域。 */
const developmentBinding = (id, overrides = {}) => ({ ...binding(id), domain: 'development', ...overrides })
const projection = {
  workspaceId: WORKSPACE, entityId: 'entity-1', planningStatus: 'todo', revision: 1, content: { contentKind: 'work_item', title: '标题', body: '正文' },
}
const membership = (overrides = {}) => ({ workspaceId: WORKSPACE, projectExternalId: 'project-1', itemExternalId: 'item-1', contentKind: 'issue',
  contentExternalId: 'issue-1', membershipCreatedAt: '2026-09-20T00:00:00Z', membershipUpdatedAt: '2026-09-20T00:00:00Z', ...overrides })
const fieldValue = (overrides = {}) => ({ workspaceId: WORKSPACE, itemExternalId: 'item-1', projectFieldId: 'field-1', value: 'In Progress',
  observedAt: '2026-09-20T00:00:02Z', ...overrides })
const seedWorkspace = (storage, id = WORKSPACE) => storage.putWorkspace(workspace(id))
const seedEntity = (storage, id) => storage.putEntity({ id, kind: 'work_item' })

/** 地基面：绑定、身份与投影。 */
export function storageIdentityFoundationSuite(adapter, register = test) {
  const { label, makeStorage } = adapter

    register(`${label}：绑定锚点跨工作区共享，挂载规则由工作区与域决定`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putProviderBinding(binding('binding-1'))
      await assert.rejects(storage.putProviderBinding({ ...binding('binding-1'), implementationKey: 'other' }), '同一个 id 换 provider 实现必须被拒绝')
      assert.equal((await storage.listProviderBindings(WORKSPACE)).find((b) => b.id === 'binding-1')?.implementationKey, 'fake', '被拒绝的写入不得改动原连接')
      await assert.rejects(storage.putProviderBinding({ ...binding('binding-2'), implementationKey: 'leaked' }), '同一工作区第二个启用的 planning 挂载必须被拒绝')
      assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map((b) => b.id), ['binding-1'], '被拒绝的挂载不得留下任何行')
      await storage.putProviderBinding(developmentBinding('binding-2'))
      assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map((b) => b.id).sort(), ['binding-1', 'binding-2'], '同一条连接换域挂载必须成功：上一次拒绝不得留下 leaked 锚点')
      await storage.putProviderBinding({ ...binding('binding-3'), enabled: false })
      assert.equal((await storage.listProviderBindings(WORKSPACE)).find((b) => b.id === 'binding-3')?.enabled, false, '禁用的 planning 挂载不占用启用槽')
      await assert.rejects(storage.putProviderBinding({ ...binding('binding-3'), enabled: false, isDefault: true }), 'is_default = 1 蕴含 enabled = 1')
      await assert.rejects(storage.putProviderBinding({ ...binding('binding-4'), enabled: false, isDefault: true }), '被拒绝的默认挂载不得留下任何行')
      assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map((b) => b.id).sort(), ['binding-1', 'binding-2', 'binding-3'])
      await storage.putProviderBinding(developmentBinding('binding-4', { enabled: false }))
      await storage.putProviderBinding(developmentBinding('binding-5', { isDefault: true }))
      const bindings = await storage.listProviderBindings(WORKSPACE)
      assert.deepEqual(bindings.filter((b) => b.isDefault).map((b) => b.id), ['binding-5'], '禁用的挂载不占用默认槽，新的启用默认是唯一的默认')
      assert.equal(bindings.find((b) => b.id === 'binding-4')?.isDefault, false, '禁用挂载不得被当成默认')
    })

    register(`${label}：每个实体至多一个 primary 身份，同一个身份 id 不得换对象键`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putProviderBinding(binding('binding-1'))
      await seedEntity(storage, 'entity-1')
      await seedEntity(storage, 'entity-2')
      const identity = (overrides = {}) => ({ id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1',
        externalKind: 'issue', externalId: 'issue-1', role: 'primary', ...overrides })
      await storage.putExternalIdentity(identity())
      await storage.putExternalIdentity(identity())
      assert.deepEqual((await storage.listIdentitiesForEntity('entity-1')).map((i) => i.id), ['identity-1'], '同一对象键的幂等重写不得被自己的唯一性检查误伤')
      await assert.rejects(storage.putExternalIdentity(identity({ id: 'identity-2', externalId: 'issue-2' })), '同一实体第二个 primary 必须被拒绝')
      assert.deepEqual((await storage.listIdentitiesForEntity('entity-1')).map((i) => i.id), ['identity-1'], '被拒绝的写入不得留下任何行')
      await storage.putExternalIdentity(identity({ id: 'identity-3', externalKind: 'branch', externalId: 'branch-1', role: 'alias' }))
      assert.deepEqual((await storage.listIdentitiesForEntity('entity-1')).map((i) => i.id).sort(), ['identity-1', 'identity-3'], 'alias / historical 不受 primary 唯一约束限制')
      await assert.rejects(storage.putExternalIdentity(identity({ entityId: 'entity-2', externalKind: 'issue', externalId: 'issue-9' })), '同一个身份 id 换对象键必须被拒绝')
      assert.equal(await storage.findExternalIdentity('binding-1', 'issue', 'issue-9'), undefined, '被拒绝的写入不得留下任何行')
      await storage.putExternalIdentity(identity({ id: 'identity-99', entityId: 'entity-2', role: 'alias' }))
      const found = await storage.findExternalIdentity('binding-1', 'issue', 'issue-1')
      assert.equal(found?.id, 'identity-1', '同对象幂等覆盖保留已分配的 id')
      assert.equal(found?.entityId, 'entity-1', '同对象幂等覆盖保留已分配的 entityId')
      assert.deepEqual(await storage.listIdentitiesForEntity('entity-2'), [], '覆盖不得把身份搬到另一个实体')
    })

    register(`${label}：投影指向不存在的工作区或实体必须被拒绝且不留行`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await assert.rejects(storage.putPlanningProjection(WORKSPACE, projection), '投影的实体必须先存在')
      assert.deepEqual(await storage.listPlanningProjections(WORKSPACE), [], '被拒绝的写入不得留下任何行')
      await seedEntity(storage, 'entity-1')
      await assert.rejects(storage.putPlanningProjection('ws-none', projection), '投影必须属于存在的工作区')
      assert.deepEqual(await storage.listPlanningProjections('ws-none'), [], '被拒绝的写入不得留下任何行')
      await storage.putPlanningProjection(WORKSPACE, projection)
      assert.deepEqual((await storage.listPlanningProjections(WORKSPACE)).map((p) => p.entityId), ['entity-1'], '工作区与实体都存在时同一写入必须成功')
    })

    register(`${label}：引用完整性——指向不存在的父行必须被拒绝且不留行`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await seedEntity(storage, 'entity-1')
      await storage.putProviderBinding(binding('binding-1'))
      await storage.putExternalIdentity({ id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'alias' })
      const rejected = async (write, read, message) => { await assert.rejects(write, message); assert.deepEqual(await read(), [], '被拒绝的写入不得留下任何行') }
      await rejected(() => storage.putProviderBinding({ ...binding('binding-9'), workspaceId: 'ws-none' }), () => storage.listProviderBindings('ws-none'), '挂载必须属于存在的工作区')
      await rejected(() => storage.putExternalIdentity({ id: 'identity-2', entityId: 'entity-none', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-2', role: 'alias' }), () => storage.listIdentitiesForEntity('entity-none'), '身份必须指向存在的实体')
      await rejected(() => storage.putExternalIdentity({ id: 'identity-3', entityId: 'entity-1', bindingId: 'binding-none', externalKind: 'issue', externalId: 'issue-3', role: 'alias' }), () => storage.listIdentitiesForEntity('entity-1').then((rows) => rows.filter((i) => i.bindingId === 'binding-none')), '身份必须指向存在的连接锚点')
      await rejected(() => storage.putRepository({ id: 'repo-1', workspaceId: 'ws-none', externalIdentityId: 'identity-1' }), () => storage.listRepositories('ws-none'), '仓库必须属于存在的工作区')
      await rejected(() => storage.putRepository({ id: 'repo-2', workspaceId: WORKSPACE, externalIdentityId: 'identity-none' }), () => storage.listRepositories(WORKSPACE), '仓库必须指向存在的身份')
      await rejected(() => storage.advanceRevision('ws-none'), async () => (await storage.currentRevision('ws-none')) === 0 ? [] : ['revision'], '修订号必须属于存在的工作区')
    })
}

/** 同步面：成员关系与字段值。 */
export function storageIdentitySyncSuite(adapter, register = test) {
  const { label, makeStorage } = adapter

    register(`${label}：同一条连接被两个工作区挂载时，同一外部对象只有一条身份、两个工作区各有成员关系`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await seedWorkspace(storage, 'ws-2')
      await storage.putProviderBinding(binding('binding-1'))
      await storage.putProviderBinding({ ...binding('binding-1'), workspaceId: 'ws-2' })
      assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map((b) => b.id), ['binding-1'], '连接锚点必须留在第一个工作区')
      assert.deepEqual((await storage.listProviderBindings('ws-2')).map((b) => b.id), ['binding-1'], '同一条连接必须能被第二个工作区挂载')
      await seedEntity(storage, 'entity-1')
      const identity = { id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' }
      await storage.putExternalIdentity(identity)
      await storage.putExternalIdentity({ ...identity, id: 'identity-2' })
      assert.equal((await storage.findExternalIdentity('binding-1', 'issue', 'issue-1'))?.id, 'identity-1')
      assert.deepEqual((await storage.listIdentitiesForEntity('entity-1')).map((i) => i.id), ['identity-1'], '同一对象不得在两个工作区各登记一条身份')
      await storage.putMembership(membership())
      await storage.putMembership(membership({ workspaceId: 'ws-2', itemExternalId: 'item-2' }))
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-1'])
      assert.deepEqual((await storage.listMemberships('ws-2', 'project-1')).map((m) => m.itemExternalId), ['item-2'], '成员关系是工作区作用域的：同一对象在两个工作区各有自己的挂载点')
    })

    register(`${label}：project 是成员关系的定位分量——同工作区两个 project 的同内容各自成条`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putMembership(membership({ projectExternalId: 'project-1', itemExternalId: 'item-1' }))
      await storage.putMembership(membership({ projectExternalId: 'project-2', itemExternalId: 'item-2' }))
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-1'], '第二个 project 的同内容不得取代第一个 project 的成员关系')
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-2')).map((m) => m.itemExternalId), ['item-2'], 'project 过滤不得混入别的 project')
      assert.equal((await storage.getMembership(WORKSPACE, 'item-1'))?.projectExternalId, 'project-1')
      assert.equal((await storage.getMembership(WORKSPACE, 'item-2'))?.projectExternalId, 'project-2')
    })

    register(`${label}：listMemberships 按 itemExternalId 升序返回`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putMembership(membership({ itemExternalId: 'item-b', contentExternalId: 'issue-b' }))
      await storage.putMembership(membership({ itemExternalId: 'item-a', contentExternalId: 'issue-a' }))
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-a', 'item-b'], '顺序是契约：乱序插入也必须按 itemExternalId 升序返回')
      // 边界（2026-09-24 评审）：U+FF5E 的码点小于 U+1F600，但码元 0xFF5E 大于代理对首元 0xD83D——只有码点序与 SQLite BINARY 一致。
      await storage.putMembership(membership({ itemExternalId: 'item-\uFF5E', contentExternalId: 'issue-c' }))
      await storage.putMembership(membership({ itemExternalId: 'item-\u{1F600}', contentExternalId: 'issue-d' }))
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-a', 'item-b', 'item-\uFF5E', 'item-\u{1F600}'], '码点序：U+FF5E 在增补平面字符之前（UTF-16 码元序会给出相反结果）')
    })

    register(`${label}：成员关系被取代时旧条目名下的字段值一并删除`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putMembership(membership({ itemExternalId: 'item-1' }))
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-1', value: 'In Progress' }))
      assert.equal((await storage.listFieldValues(WORKSPACE, 'item-1')).length, 1, '前置：旧条目名下有字段值')
      await storage.putMembership(membership({ itemExternalId: 'item-9' }))
      assert.equal(await storage.getMembership(WORKSPACE, 'item-1'), undefined, '旧成员关系已被取代')
      assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-1'), [], '被取代的条目不得返回孤儿字段值')
      await storage.putMembership(membership({ itemExternalId: 'item-1' }))
      assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-1'), [], '字段值是被删除而不是读取时过滤：旧 item id 重新加入不得让旧值复活')
    })

    register(`${label}：item 是字段值的定位分量——两个条目同一 projectFieldId 各自一条`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putMembership(membership({ itemExternalId: 'item-1' }))
      await storage.putMembership(membership({ itemExternalId: 'item-2', contentExternalId: 'issue-2' }))
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-1', value: 'In Progress' }))
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-2', value: 'Todo' }))
      const rows = async (item) => (await storage.listFieldValues(WORKSPACE, item)).map((v) => [v.itemExternalId, v.projectFieldId, v.value])
      assert.deepEqual(await rows('item-1'), [['item-1', 'field-1', 'In Progress']], '第二个条目的同名字段不得覆盖第一条')
      assert.deepEqual(await rows('item-2'), [['item-2', 'field-1', 'Todo']], 'item-2 只返回自己的字段值')
    })
}
