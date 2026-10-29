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
      // 同一个 id、同一个工作区跨域：用另一个实例，不污染上面的数组期望。同域重复写是覆盖同一行，所以重复挂载只能由 core 注册自己拒绝。
      const shared = makeStorage()
      await seedWorkspace(shared)
      await shared.putProviderBinding(binding('binding-1'))
      await shared.putProviderBinding(developmentBinding('binding-1'))
      await assert.rejects(shared.putProviderBinding(developmentBinding('binding-1', { implementationKey: 'other' })), '同 id 同工作区换域时仍不能换实现')
      await shared.putProviderBinding(developmentBinding('binding-1', { isDefault: true }))
      assert.deepEqual((await shared.listProviderBindings(WORKSPACE)).map((b) => `${b.domain}:${b.isDefault}`).sort(), ['development:true', 'planning:false'], '同一连接跨域是两个挂载，同域重复写覆盖同一行而不是追加')
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

    register(`${label}：identity id 与 natural key 双冲突必须拒绝且保留两个 owner`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putProviderBinding(binding('binding-1'))
      await seedEntity(storage, 'entity-1')
      await seedEntity(storage, 'entity-2')
      const first = { id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'alias' }
      const second = { id: 'identity-2', entityId: 'entity-2', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-2', role: 'alias' }
      await storage.putExternalIdentity(first)
      await storage.putExternalIdentity(second)
      await assert.rejects(storage.putExternalIdentity({ ...first, externalId: 'issue-2', role: 'primary' }), /external identity id already points at another object/)
      assert.deepEqual(await storage.findExternalIdentity('binding-1', 'issue', 'issue-1'), first, 'id owner must remain unchanged')
      assert.deepEqual(await storage.findExternalIdentity('binding-1', 'issue', 'issue-2'), second, 'natural-key owner must remain unchanged')
    })

    register(`${label}：合法 natural-key replay 只更新 role 且保留稳定身份`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putProviderBinding(binding('binding-1'))
      await seedEntity(storage, 'entity-1')
      const owner = { id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'alias' }
      await storage.putExternalIdentity(owner)
      await storage.putExternalIdentity({ ...owner, id: 'retry-id', entityId: 'entity-1', role: 'historical' })
      assert.deepEqual(await storage.findExternalIdentity('binding-1', 'issue', 'issue-1'), { ...owner, role: 'historical' })
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

    // #195：仓库必须能经端口登记。两个实现都要读回同一组稳定键（身份 id、实体 id、仓库记录引用的身份 id）。
    register(`${label}：仓库身份通过端口登记并读回稳定键`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await storage.putProviderBinding(binding('binding-1'))
      await storage.putEntity({ id: 'repo-entity-1', kind: 'repository' })
      const identity = { id: 'repo-identity-1', entityId: 'repo-entity-1', bindingId: 'binding-1', externalKind: 'repository', externalId: 'repo-1', role: 'primary' }
      await storage.putExternalIdentity(identity)
      await storage.putRepository({ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: identity.id })
      assert.deepEqual(await storage.findExternalIdentity('binding-1', 'repository', 'repo-1'), identity, '按 (连接, repository, 外部 id) 读回同一条身份：id 与 entityId 是稳定键')
      assert.equal(await storage.findExternalIdentity('binding-1', 'branch', 'repo-1'), undefined, '种类是自然键的分量：同名 branch 是另一个对象')
      assert.deepEqual(await storage.listRepositories(WORKSPACE), [{ id: 'repo-1', workspaceId: WORKSPACE, externalIdentityId: 'repo-identity-1' }], '仓库记录引用身份行的稳定键')
    })

    // #195：未知种类必须响亮失败，不得被归一成别的种类；非字符串（undefined / null / 数字）同样是未知种类——守卫只对字符串生效时，
    // 替身会静默接受它们。正控与反例在两个独立的库里、记录只差 kind 这一处，否则反例可能死于 id / primary 冲突而不是死于种类
    // （两种死因在拒绝断言里分不出来）。
    register(`${label}：未知身份种类拒绝且不得登记成 issue`, async () => {
      const seeded = async () => { const storage = makeStorage(); await seedWorkspace(storage); await storage.putProviderBinding(binding('binding-1')); await seedEntity(storage, 'entity-1'); return storage }
      const record = (externalKind) => ({ id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind, externalId: 'object-1', role: 'primary' })
      const control = await seeded()
      await control.putExternalIdentity(record('issue'))
      assert.equal((await control.findExternalIdentity('binding-1', 'issue', 'object-1'))?.id, 'identity-1', '同形状的合法写入必须成功并能按 issue 查回：否则「一律拒绝」的实现也能通过下面的断言')
      const storage = await seeded()
      for (const bogus of ['bogus', 'ProjectV2Item', undefined, null, 42]) {
        await assert.rejects(storage.putExternalIdentity(record(bogus)), { name: 'RangeError', message: 'unsupported external identity kind' }, `${String(bogus)} 必须以端口级的同一个错误被拒绝，而不是依赖驱动或库约束的措辞`)
      }
      assert.deepEqual(await storage.listIdentitiesForEntity('entity-1'), [], '被拒绝的写入不得留下任何行：写前写后身份总数不变')
      assert.equal(await storage.findExternalIdentity('binding-1', 'issue', 'object-1'), undefined, '未知种类不得被静默登记成 issue')
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

    register(`${label}：规划成员 scope replace 只收敛 workspace+project 并保留实体身份`, async () => {
      const storage = makeStorage()
      await seedWorkspace(storage)
      await seedWorkspace(storage, 'ws-2')
      await storage.putProviderBinding(binding('binding-1'))
      await seedEntity(storage, 'entity-1')
      await seedEntity(storage, 'entity-2')
      await storage.putExternalIdentity({ id: 'identity-1', entityId: 'entity-1', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
      await storage.putExternalIdentity({ id: 'identity-2', entityId: 'entity-2', bindingId: 'binding-1', externalKind: 'issue', externalId: 'issue-2', role: 'primary' })
      await storage.putMembership(membership({ itemExternalId: 'item-1', contentExternalId: 'issue-1' }))
      await storage.putMembership(membership({ itemExternalId: 'item-2', contentExternalId: 'issue-2' }))
      await storage.putMembership(membership({ projectExternalId: 'project-2', itemExternalId: 'item-3', contentExternalId: 'issue-2' }))
      await storage.putMembership(membership({ workspaceId: 'ws-2', itemExternalId: 'item-4', contentExternalId: 'issue-2' }))
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-2', value: 'stale' }))
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-3', value: 'other-project' }))
      await storage.putFieldValue(fieldValue({ workspaceId: 'ws-2', itemExternalId: 'item-4', value: 'other-workspace' }))

      await storage.transaction((tx) => tx.replacePlanningMemberships(
        { workspaceId: WORKSPACE, projectExternalId: 'project-1' },
        [membership({ itemExternalId: 'item-1', contentExternalId: 'issue-1' })],
      ))

      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-1'])
      assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-2'), [], '被移除成员的字段值必须一并删除')
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-2')).map((m) => m.itemExternalId), ['item-3'], '另一个 project 不得被全局清理')
      assert.deepEqual((await storage.listMemberships('ws-2', 'project-1')).map((m) => m.itemExternalId), ['item-4'], '另一个 workspace 不得被清理')
      assert.equal((await storage.findExternalIdentity('binding-1', 'issue', 'issue-2'))?.entityId, 'entity-2', '成员移除不得删除 entity/external identity')

      await assert.rejects(storage.transaction((tx) => tx.replacePlanningMemberships(
        { workspaceId: WORKSPACE, projectExternalId: 'project-1' },
        [membership({ workspaceId: 'ws-2', itemExternalId: 'item-4', contentExternalId: 'issue-2' })],
      )), 'incoming 成员越过 scope 必须拒绝')
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-1')).map((m) => m.itemExternalId), ['item-1'], 'scope 校验失败不得先删除原成员')

      await storage.transaction((tx) => tx.replacePlanningMemberships(
        { workspaceId: WORKSPACE, projectExternalId: 'project-1' },
        [membership({ itemExternalId: 'item-2', contentExternalId: 'issue-2' })],
      ))
      assert.equal((await storage.getMembership(WORKSPACE, 'item-2'))?.contentExternalId, 'issue-2', '移除后重新加入可登记')
      assert.deepEqual((await storage.listMemberships(WORKSPACE, 'project-2')).map((m) => m.itemExternalId), ['item-3'], '同内容在另一个 project 的成员关系仍须保留')
      assert.equal((await storage.findExternalIdentity('binding-1', 'issue', 'issue-2'))?.id, 'identity-2', '重新加入复用稳定 external identity')

      // provider 移走最后一个条目：空 incoming 是合法的完整集合，必须清空 scope，而不是被当成「没有输入」跳过。
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-2', value: 'last' }))
      await storage.transaction((tx) => tx.replacePlanningMemberships({ workspaceId: WORKSPACE, projectExternalId: 'project-1' }, []))
      assert.deepEqual({
        scope: await storage.listMemberships(WORKSPACE, 'project-1'), scopeValues: await storage.listFieldValues(WORKSPACE, 'item-2'),
        otherProject: (await storage.listFieldValues(WORKSPACE, 'item-3')).map((v) => v.value),
        otherWorkspace: (await storage.listFieldValues('ws-2', 'item-4')).map((v) => v.value),
        identity: (await storage.findExternalIdentity('binding-1', 'issue', 'issue-2'))?.entityId,
      }, { scope: [], scopeValues: [], otherProject: ['other-project'], otherWorkspace: ['other-workspace'], identity: 'entity-2' }, '空 incoming 清空 scope 内成员与字段值，scope 外与身份不动')
    })

    register(`${label}：duplicate-content-last-wins follows incoming order and removes displaced fields`, async () => {
      const run = async (incoming, expectedWinner) => {
        const storage = makeStorage()
        await seedWorkspace(storage)
        await seedWorkspace(storage, 'ws-2')
        const old = membership({ itemExternalId: 'item-old', contentExternalId: 'issue-obsolete', membershipCreatedAt: '2026-09-19T00:00:00Z', membershipUpdatedAt: '2026-09-19T00:00:01Z' })
        const independent = membership({ itemExternalId: 'item-0-keep', contentExternalId: 'issue-independent', membershipCreatedAt: '2026-09-18T00:00:00Z', membershipUpdatedAt: '2026-09-18T00:00:01Z' })
        const otherProject = membership({ projectExternalId: 'project-2', itemExternalId: 'item-other-project' })
        const otherWorkspace = membership({ workspaceId: 'ws-2', itemExternalId: 'item-other-workspace' })
        await storage.putMembership(old)
        await storage.putMembership(incoming[0])
        await storage.putMembership(independent)
        await storage.putMembership(otherProject)
        await storage.putMembership(otherWorkspace)
        await storage.putFieldValue(fieldValue({ itemExternalId: 'item-old', value: 'displaced' }))
        await storage.putFieldValue(fieldValue({ itemExternalId: incoming[0].itemExternalId, value: 'displaced-incoming' }))
        await storage.putFieldValue(fieldValue({ itemExternalId: 'item-other-project', value: 'other-project' }))
        await storage.putFieldValue(fieldValue({ workspaceId: 'ws-2', itemExternalId: 'item-other-workspace', value: 'other-workspace' }))

        await storage.transaction((tx) => tx.replacePlanningMemberships(
          { workspaceId: WORKSPACE, projectExternalId: 'project-1' }, [...incoming, independent],
        ))

        assert.deepEqual(await storage.listMemberships(WORKSPACE, 'project-1'), [independent, expectedWinner], '同内容只保留数组中最后一个完整成员记录，其他 incoming 内容保留')
        assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-old'), [], '被重复内容取代的旧成员字段值必须清除')
        assert.deepEqual(await storage.listFieldValues(WORKSPACE, incoming[0].itemExternalId), [], '同内容后项取代已存的前项时，前项字段值必须在循环内清除')
        assert.deepEqual(await storage.listMemberships(WORKSPACE, 'project-2'), [otherProject], '另一个 project 的同内容成员必须保留')
        assert.deepEqual(await storage.listMemberships('ws-2', 'project-1'), [otherWorkspace], '另一个 workspace 的同内容成员必须保留')
        assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-other-project'), [fieldValue({ itemExternalId: 'item-other-project', value: 'other-project' })], '另一个 project 中同内容成员的字段值必须保留')
        assert.deepEqual(await storage.listFieldValues('ws-2', 'item-other-workspace'), [fieldValue({ workspaceId: 'ws-2', itemExternalId: 'item-other-workspace', value: 'other-workspace' })], 'scope 外字段值必须保留')
      }
      const itemA = membership({ itemExternalId: 'item-a', membershipCreatedAt: '2026-09-21T00:00:00Z', membershipUpdatedAt: '2026-09-21T00:00:01Z' })
      const itemB = membership({ itemExternalId: 'item-b', membershipCreatedAt: '2026-09-22T00:00:00Z', membershipUpdatedAt: '2026-09-22T00:00:01Z' })
      await run([itemA, itemB], itemB)
      await run([itemB, itemA], itemA)
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
