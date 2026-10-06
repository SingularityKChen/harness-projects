/** 连接账号与工作区配置的共享 Storage 契约套件（#126）：Fake 与 SQLite 同形跑 6 条命名用例；判别性集中在账号自然键不可重绑、配置按真实 implementationKey 分派、重登记/卸载只改挂载。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { EMPTY_POLICY, snapshotPolicy } from '@harness-projects/capabilities'
import { createContext } from '@harness-projects/core'
import { createFakePlanningProvider } from '@harness-projects/provider-fake'

export const WORKSPACE = 'ws-1'
export const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
export const binding = (id, domain, overrides = {}) => ({ id, workspaceId: WORKSPACE, domain, implementationKey: 'harness.fake', enabled: true, isDefault: true, ...overrides })
export const account = (overrides = {}) => ({ id: 'account-1', platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: 'octo-1', displayName: '账号', secretHandle: 'HARNESS_FAKE_TOKEN', connectionState: 'connected', ...overrides })
/** 受信策略的字段规则：字符串（pattern + maxLength）、枚举与布尔三种规则都用上。 */
export const policy = () => ({ allowedSecretHandles: new Set(['HARNESS_FAKE_TOKEN', 'LOCAL_GIT_DEPLOY_KEY']), configurations: new Map([
  ['harness.fake', { scope: { kind: 'enum', required: true, values: ['workspace', 'project'] }, label: { kind: 'string', required: false, pattern: '[a-z]+', maxLength: 8 } }],
  ['development.local-git', { repositoryPath: { kind: 'string', required: true, pattern: '/[^\\s]+', maxLength: 512 } }],
]) })
/** 计划 Validation and Acceptance 的 8 个命名用例：6 条共享（本文件）+ 2 条集成专属。 */
export const CONNECTOR_ACCOUNT_INTEGRATION_CASES = ['restart-and-empty-schema-repeatability', 'secret-canary-never-published']
export const CONNECTOR_ACCOUNT_SHARED_CASES = ['one-account-three-domains', 'immutable-account-and-anchor-identity', 'configuration-is-workspace-scoped', 'trusted-handle-only', 'registration-and-removal-preserve-account', 'metadata-transaction-and-copy-isolation']
export const CONNECTOR_ACCOUNT_NAMED_CASES = [...CONNECTOR_ACCOUNT_SHARED_CASES, ...CONNECTOR_ACCOUNT_INTEGRATION_CASES]
const ref = (workspaceId, bindingId, domain) => ({ workspaceId, bindingId, domain })
/** 只计数的注册器：用例体不执行——删掉一条 register(...) 会让条数守卫变红。 */
export function countConnectorAccountCases(suite) {
  let count = 0
  suite({ label: '计数', makeStorage: () => { throw new Error('计数不执行用例体') } }, () => { count += 1 })
  return count
}
/** 前置：一个账号 + 各域锚点；返回按序号取挂载引用的函数。 */
async function seedAccount(storage, domains) {
  await storage.putWorkspace(workspace())
  for (const [index, domain] of domains.entries()) await storage.putProviderBinding(binding(`conn-${index}`, domain))
  await storage.putConnectorAccount(account())
  return (index) => ref(WORKSPACE, `conn-${index}`, domains[index])
}
const attached = (storage, index) => storage.getProviderBindingAccount(`conn-${index}`)

export function storageConnectorAccountSuite(adapter, register = test) {
  const { label, makeStorage, restart, tamper } = adapter

  register(`${label}：one-account-three-domains`, async () => {
    const storage = makeStorage(); await seedAccount(storage, ['planning', 'development', 'execution'])
    for (const index of [0, 1, 2]) await storage.setProviderBindingAccount(`conn-${index}`, 'account-1')
    assert.deepEqual(await Promise.all([0, 1, 2].map((index) => attached(storage, index))), ['account-1', 'account-1', 'account-1'], '一个账号支持同工作区三个域，三条关联读回相同 accountId')
    await storage.putConnectorAccount(account({ id: 'account-2', platformOrigin: 'https://github.example.com' }))
    assert.deepEqual((await storage.listConnectorAccounts()).map((item) => item.id).sort(), ['account-1', 'account-2'], '另一平台 origin 的同 externalId 是另一账号')
  })
  register(`${label}：immutable-account-and-anchor-identity`, async () => {
    const storage = makeStorage(); await seedAccount(storage, ['planning', 'development', 'execution', 'delivery'])
    await storage.putWorkspace(workspace('ws-2', '工作区 2'))
    await storage.putProviderBinding(binding('conn-4', 'planning', { workspaceId: 'ws-2' }))
    await storage.putSyncCursor({ workspaceId: 'ws-2', bindingId: 'conn-4', scopeKey: 'scope-1', cursorValue: 'c', state: 'healthy', lastErrorCode: undefined })
    const before = await storage.listConnectorAccounts()
    await assert.rejects(storage.putConnectorAccount(account({ id: 'account-2' })), (error) => error instanceof RangeError && !/UNIQUE|constraint/i.test(error.message), '同自然键换 id 必须拒绝，且不暴露驱动文本')
    await assert.rejects(storage.putConnectorAccount(account({ externalId: 'octo-other' })), '同 id 换自然键必须拒绝')
    assert.deepEqual(await storage.listConnectorAccounts(), before, '拒绝后快照必须逐字段相等')
    await storage.setProviderBindingAccount('conn-0', 'account-1')
    await assert.rejects(storage.setProviderBindingAccount('conn-0', 'account-2'), '已关联的锚点换账号必须拒绝')
    assert.equal(await attached(storage, 0), 'account-1', '拒绝不得改动原关联')
    await storage.setProviderBindingAccount('conn-1', 'account-1') // 无事实锚点首次关联成功
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    await storage.putExternalIdentity({ id: 'identity-1', entityId: 'entity-1', bindingId: 'conn-2', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
    await assert.rejects(storage.setProviderBindingAccount('conn-2', 'account-1'), '已有外部身份事实的锚点不得补账号')
    await assert.rejects(storage.setProviderBindingAccount('conn-4', 'account-1'), '已有同步游标事实的锚点不得补账号')
    assert.equal(await attached(storage, 2), undefined, '被拒绝的初次关联不得留下关联')
    await storage.setProviderBindingAccount('conn-3', 'account-1')
    assert.equal(await attached(storage, 3), 'account-1', '无事实锚点仍可首次关联（对照）')
  })
  register(`${label}：configuration-is-workspace-scoped`, async () => {
    const storage = makeStorage()
    await storage.putWorkspace(workspace()); await storage.putWorkspace(workspace('ws-2', '工作区 2'))
    await storage.putProviderBinding(binding('conn-0', 'planning')); await storage.putProviderBinding(binding('conn-0', 'development', { workspaceId: 'ws-2' }))
    await storage.putProviderBinding(binding('conn-other', 'development', { implementationKey: 'harness.other', enabled: false, isDefault: false }))
    const a = ref(WORKSPACE, 'conn-0', 'planning'); const b = ref('ws-2', 'conn-0', 'development'); const stored = { ref: a, configuration: { scope: 'workspace' } }
    await storage.putBindingConfiguration(stored); await storage.putBindingConfiguration({ ref: b, configuration: { scope: 'project' } })
    assert.deepEqual(await storage.getBindingConfiguration(a), stored, '同锚点两工作区配置独立')
    assert.deepEqual(await storage.getBindingConfiguration(b), { ref: b, configuration: { scope: 'project' } })
    await assert.rejects(storage.putBindingConfiguration({ ref: ref(WORKSPACE, 'conn-0', 'delivery'), configuration: { scope: 'workspace' } }), '未知挂载必须拒绝')
    await assert.rejects(storage.putBindingConfiguration({ ref: ref(WORKSPACE, 'conn-other', 'development'), configuration: { scope: 'workspace' } }), '锚点真实实现键没有受信 schema：必须按 implementationKey 分派，不得落调用者声称的键')
    await assert.rejects(storage.putBindingConfiguration({ ref: a, configuration: { scope: 'workspace', extra: true } }), '未知字段必须拒绝')
    await assert.rejects(storage.putBindingConfiguration({ ref: a, configuration: {} }), '缺必填字段必须拒绝')
    await assert.rejects(storage.putBindingConfiguration({ ref: a, configuration: { scope: 'bogus' } }), '枚举外的值必须拒绝')
    await assert.rejects(storage.putBindingConfiguration({ ref: a, configuration: { scope: undefined } }), RangeError, '显式 undefined 不是字段缺省：必填字段必须拒绝')
    await assert.rejects(storage.putBindingConfiguration({ ref: a, configuration: { scope: 'workspace', label: undefined } }), RangeError, '显式 undefined 不是字段缺省：可选字段同样必须拒绝')
    // 畸形 ref / record 必须在解引用之前以 RangeError 拒绝（对抗验证 P3-1/P3-3），且在两个适配器上同形。
    for (const bad of [null, 5, 'x', [], { ref: null, configuration: { scope: 'workspace' } }, { ref: { workspaceId: WORKSPACE, bindingId: 'conn-0' }, configuration: { scope: 'workspace' } }]) {
      await assert.rejects(storage.putBindingConfiguration(bad), RangeError, `畸形配置输入必须 RangeError：${JSON.stringify(bad)}`)
    }
    const pending = storage.getBindingConfiguration(null) // 不 await：两适配器都必须返回被拒 Promise，而不是同步抛出（对抗验证 P3-R1）
    assert.ok(pending instanceof Promise, '畸形 ref 必须异步拒绝：同调用在两个适配器上都返回 Promise')
    await assert.rejects(pending, RangeError, '读口同样在解引用之前拒绝畸形 ref')
    assert.deepEqual(await storage.getBindingConfiguration(a), stored, '被拒绝的写入不得改动旧值')
    tamper(storage) // 裸写未知字段的配置：读口必须按真实锚点的 implementationKey 复验（对抗验证 P2-3）
    await assert.rejects(async () => storage.getBindingConfiguration(a), RangeError, '读口复验被裸写改坏的配置')
  })
  register(`${label}：trusted-handle-only`, async () => {
    const storage = makeStorage(); await storage.putConnectorAccount(account())
    assert.deepEqual(await storage.getConnectorAccount('account-1'), account(), '允许的 POSIX 引用必须原样读回')
    const rejected = (name, over) => assert.rejects(storage.putConnectorAccount(account({ id: `account-${name}`, externalId: `octo-${name}`, ...over })), RangeError)
    await rejected('forged', { secretHandle: 'FORGED_HANDLE' }) // 形状合法但不在 allowlist
    await rejected('token', { secretHandle: 'ghp_1234567890' }) // token 形状
    await rejected('nested', { secretHandle: { ref: 'HARNESS_FAKE_TOKEN' } }) // 嵌套字段
    await rejected('badchar', { secretHandle: 'HARNESS-FAKE' }) // 非 POSIX 名称形状
    await assert.rejects(storage.putConnectorAccount({ ...account({ id: 'account-password' }), password: 'x' }), RangeError, '闭集字段解析必须拒绝夹带的凭据列')
    assert.equal(await storage.getConnectorAccount('account-forged'), undefined, '被拒绝的句柄不得留下账号行')
    await storage.putConnectorAccount(account({ id: 'account-anon', externalId: 'octo-anon', secretHandle: undefined }))
    assert.equal((await storage.getConnectorAccount('account-anon')).secretHandle, undefined, 'undefined 表示无认证账号，合法')
    tamper(storage) // 裸写不允许的句柄：读口必须复验（对抗验证 P2-3），不能把非法行原样返回
    await assert.rejects(async () => storage.getConnectorAccount('account-1'), RangeError, '读口复验被裸写改坏的句柄')
    await assert.rejects(async () => storage.listConnectorAccounts(), RangeError, '列表读口同样复验')
    assert.throws(() => restart(storage, EMPTY_POLICY), RangeError, '缺策略重开：已存句柄必须被拒绝')
    assert.equal((await makeStorage(EMPTY_POLICY).listConnectorAccounts()).length, 0, '无元数据的空库在空策略下照常打开（对照）')
  })
  register(`${label}：registration-and-removal-preserve-account`, async () => {
    const storage = makeStorage(); const mount = await seedAccount(storage, ['planning', 'development'])
    await storage.setProviderBindingAccount('conn-0', 'account-1'); await storage.putBindingConfiguration({ ref: mount(0), configuration: { scope: 'workspace' } })
    for (let round = 0; round < 2; round += 1) { // core 固定 bindingId 的两次装配：重登记只更新角色字段，账号关联与配置必须保留
      await createContext({ workspace: { id: WORKSPACE, name: '工作区' }, providers: { planning: createFakePlanningProvider({ bindingId: 'conn-0' }) }, storage })
    }
    assert.equal(await attached(storage, 0), 'account-1', 'core 重登记不得清空账号关联')
    assert.deepEqual((await storage.getBindingConfiguration(mount(0))).configuration, { scope: 'workspace' }, 'core 重登记不得清空配置')
    await storage.putProviderBinding(binding('conn-0', 'planning', { enabled: false, isDefault: false }))
    assert.deepEqual((await storage.getBindingConfiguration(mount(0))).configuration, { scope: 'workspace' }, '禁用只改 enabled/isDefault，不删除配置')
    assert.equal(await attached(storage, 0), 'account-1', '禁用不删除账号关联')
    await storage.putEntity({ id: 'entity-1', kind: 'work_item' })
    await storage.putExternalIdentity({ id: 'identity-1', entityId: 'entity-1', bindingId: 'conn-0', externalKind: 'issue', externalId: 'issue-1', role: 'primary' })
    await storage.removeProviderBinding(mount(0))
    assert.equal(await storage.getBindingConfiguration(mount(0)), undefined, '卸载必须移除该挂载的配置')
    assert.equal(await attached(storage, 0), 'account-1', '账号关联在连接锚点上，卸载挂载不得删除')
    assert.equal((await storage.getConnectorAccount('account-1'))?.id, 'account-1', '账号必须保留')
    assert.equal((await storage.findExternalIdentity('conn-0', 'issue', 'issue-1'))?.id, 'identity-1', '外部身份必须保留')
    assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map((item) => item.id).sort(), ['conn-1'], '只移除指定挂载，其他挂载仍在')
    await storage.removeProviderBinding(mount(0)) // 重复移除是 no-op
    assert.deepEqual((await storage.listProviderBindings(WORKSPACE)).map((item) => item.id).sort(), ['conn-1'], '重复移除不得报错或改变其他挂载')
  })
  register(`${label}：metadata-transaction-and-copy-isolation`, async () => {
    const storage = makeStorage()
    await assert.rejects(storage.transaction(async (tx) => {
      await tx.putConnectorAccount(account({ id: 'account-tx', externalId: 'octo-tx' }))
      await tx.putConnectorAccount(account({ id: 'account-tx2', externalId: 'octo-tx2' }))
      throw new Error('事务内失败')
    }), /事务内失败/)
    assert.equal(await storage.getConnectorAccount('account-tx2'), undefined, '失败事务不得留下半行')
    await storage.transaction((tx) => tx.putConnectorAccount(account()))
    assert.equal((await storage.getConnectorAccount('account-1'))?.id, 'account-1', '事务内成功写入必须提交')
    let release; const blocked = new Promise((resolve) => { release = resolve })
    let marked; const markedP = new Promise((resolve) => { marked = resolve })
    const first = storage.transaction(async (tx) => { await tx.putConnectorAccount(account({ id: 'account-overlap', externalId: 'octo-overlap' })); marked(); await blocked })
    await markedP
    const direct = storage.putConnectorAccount(account({ id: 'account-direct', externalId: 'octo-direct' }))
    release(); await first; await direct
    assert.deepEqual((await storage.listConnectorAccounts()).map((item) => item.id).sort(), ['account-1', 'account-direct', 'account-overlap'], '重叠事务与排队直接写都必须落账')
    const mutable = account({ id: 'account-copy', externalId: 'octo-copy' }) // 输入副本：写入后改写调用方对象不得改变已存值
    await storage.putConnectorAccount(mutable); mutable.displayName = '写入后改写'
    const read = await storage.getConnectorAccount('account-copy')
    assert.equal(read.displayName, '账号', '写入必须捕获独立输入副本'); read.displayName = '读回后改写'
    assert.equal((await storage.getConnectorAccount('account-copy')).displayName, '账号', '读回必须是独立副本')
    const handles = new Set(['HARNESS_FAKE_TOKEN']) // 外部策略副本：构造后扩大调用方 allowlist 不得扩权
    const isolated = makeStorage({ allowedSecretHandles: handles, configurations: new Map() })
    handles.add('LATER_HANDLE')
    await assert.rejects(isolated.putConnectorAccount(account({ id: 'account-later', secretHandle: 'LATER_HANDLE' })), RangeError, '构造后修改调用方策略对象不得扩权')
    // 嵌套声明同样必须是快照：构造后 push 枚举值 / 追加剧则字段都不得改变该实例的授权（对抗验证 P1-1）。
    const values = ['workspace']; const schema = { scope: { kind: 'enum', required: true, values } }
    const nested = makeStorage({ allowedSecretHandles: new Set(), configurations: new Map([['harness.fake', schema]]) })
    await nested.putWorkspace(workspace()); await nested.putProviderBinding(binding('conn-conf', 'planning'))
    values.push('EVIL'); schema.injected = { kind: 'boolean', required: false }; schema.scope.pattern = '.*'
    const nestedRef = ref(WORKSPACE, 'conn-conf', 'planning')
    await assert.rejects(nested.putBindingConfiguration({ ref: nestedRef, configuration: { scope: 'EVIL' } }), RangeError, '构造后 push 枚举值不得扩权')
    await assert.rejects(nested.putBindingConfiguration({ ref: nestedRef, configuration: { scope: 'workspace', injected: true } }), RangeError, '构造后追加剧则字段不得扩权')
    await nested.putBindingConfiguration({ ref: nestedRef, configuration: { scope: 'workspace' } })
    assert.deepEqual((await nested.getBindingConfiguration(nestedRef)).configuration, { scope: 'workspace' }, '原声明仍可用且只落已声明字段')
    // 默认策略不得是进程内共享可变单例：改自己读到的空集合不能加宽别的默认实例（对抗验证 P1-2）。
    const shared = EMPTY_POLICY.allowedSecretHandles
    shared.add('ESCALATED')
    assert.equal((await makeStorage().listConnectorAccounts()).length, 0, '默认策略访问到的空集合不可被写入')
    assert.equal(EMPTY_POLICY.allowedSecretHandles.has('ESCALATED'), false, '改一份读到的空集合不得污染后续读取')
    // 属性描述符也要冻：重定义 getter 不得扩权（P2-R3）。
    assert.ok(Object.isFrozen(EMPTY_POLICY), '默认策略必须冻结属性描述符')
    assert.throws(() => Object.defineProperty(EMPTY_POLICY, 'allowedSecretHandles', { value: new Set(['ESCALATED']) }), TypeError, '默认策略 getter 不得被重定义')
    await assert.rejects(makeStorage().putConnectorAccount(account({ id: 'account-esc', secretHandle: 'ESCALATED' })), RangeError, '默认空策略仍拒绝任意句柄')
    // 坏正则/负长度必须在构造点以 RangeError 失败，不能等首次写入才抛 SyntaxError（P3-R2）。
    assert.throws(() => makeStorage({ allowedSecretHandles: new Set(), configurations: new Map([['harness.fake', { scope: { kind: 'string', required: true, pattern: '(', maxLength: 8 } }]]) }), RangeError, '坏正则必须构造失败')
    assert.throws(() => makeStorage({ allowedSecretHandles: new Set(), configurations: new Map([['harness.fake', { scope: { kind: 'string', required: true, pattern: '[a-z]+', maxLength: -1 } }]]) }), RangeError, '负 maxLength 必须构造失败')
    // 幂等只指「不重读 getter」：返回容器仍须是新副本（P1 / P3-R3）。
    let reads = 0; const snapshot = snapshotPolicy({ get allowedSecretHandles() { reads += 1; return new Set() }, get configurations() { reads += 1; return new Map() } })
    const cached = makeStorage(snapshot); assert.equal(reads, 2, '传入快照不得重读其 getter')
    snapshot.allowedSecretHandles.add('ESCALATED'); await assert.rejects(cached.putConnectorAccount(account({ id: 'account-snap', secretHandle: 'ESCALATED' })), RangeError, '改快照读到的容器不得扩权')
  })
}
