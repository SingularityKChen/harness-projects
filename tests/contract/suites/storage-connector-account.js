/** 连接账号与工作区配置的共享 Storage 契约套件（#126）：Fake 与 SQLite 跑同一组命名用例，不复制断言。判别性集中在三处：账号自然键不可重绑、配置按真实锚点的 implementationKey 分派、重登记/卸载只改挂载。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createContext } from '@harness-projects/core'
import { createFakePlanningProvider } from '@harness-projects/provider-fake'

export const WORKSPACE = 'ws-1'
export const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
export const binding = (id, domain, overrides = {}) => ({ id, workspaceId: WORKSPACE, domain, implementationKey: 'harness.fake', enabled: true, isDefault: true, ...overrides })
export const account = (overrides = {}) => ({ id: 'account-1', platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: 'octo-1', displayName: '账号', secretHandle: 'HARNESS_FAKE_TOKEN', connectionState: 'connected', ...overrides })
/** 受信策略的字段规则：字符串（pattern + maxLength）、枚举与布尔三种规则都用上。 */
export const policy = () => ({ allowedSecretHandles: new Set(['HARNESS_FAKE_TOKEN', 'LOCAL_GIT_DEPLOY_KEY']), configurations: new Map([
  ['harness.fake', { scope: { kind: 'enum', required: true, values: ['workspace', 'project'] } }],
  ['development.local-git', { repositoryPath: { kind: 'string', required: true, pattern: '/[^\\s]+', maxLength: 512 } }],
]) })
/** 空策略：无 allowlist、无 schema。既有无元数据合法，有句柄或配置的库必须拒绝。 */
export const EMPTY_POLICY = { allowedSecretHandles: new Set(), configurations: new Map() }
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
  const { label, makeStorage, restart } = adapter

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
    await assert.rejects(storage.putConnectorAccount(account({ id: 'account-2' })), '同自然键换 id 必须拒绝')
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
    assert.deepEqual(await storage.getBindingConfiguration(a), stored, '被拒绝的写入不得改动旧值')
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
  })
}
