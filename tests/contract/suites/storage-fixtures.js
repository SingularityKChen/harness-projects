/** Storage 契约套件的共享夹具：三组用例（地基 / 同步 / 执行）用同一份输入形状，避免各写一份而漂移。夹具本身不是断言，断言的判别力仍由各组自己保证。 */
import { ObservationState } from '@harness-projects/capabilities'

export const WORKSPACE = 'ws-1'
export const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
export const binding = (id, isDefault = false) => ({ id, workspaceId: WORKSPACE, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault })
// planning 域只允许一个启用的挂载（不变量 1），因此「同工作区多个启用绑定」的用例必须换域。
export const developmentBinding = (id, overrides = {}) => ({ ...binding(id), domain: 'development', ...overrides })
export const projection = {
  workspaceId: WORKSPACE, entityId: 'entity-1', planningStatus: 'todo', revision: 1, content: { contentKind: 'work_item', title: '标题', body: '正文' },
}
export const observation = (dedupeKey, state = ObservationState.Pending, overrides = {}) => ({ state, observation: {
  bindingId: 'binding-1', dedupeKey, type: 'issue.updated', eventTime: undefined, receivedTime: '2026-09-20T00:00:01Z',
  subject: { bindingId: 'binding-1', objectKind: 'issue', externalId: 'issue-1', url: undefined },
  sourceVersion: '2026-09-20T00:00:00.000000000Z', payloadHash: 'payload-hash', payload: {}, ...overrides } })
// 成员关系：定位键 (workspaceId, itemExternalId)；同一内容在两个工作区是两条（行为 1）。字段值：只存原样值，键不含可选值 id（R2）。
export const membership = (overrides = {}) => ({ workspaceId: WORKSPACE, projectExternalId: 'project-1', itemExternalId: 'item-1', contentKind: 'issue',
  contentExternalId: 'issue-1', membershipCreatedAt: '2026-09-20T00:00:00Z', membershipUpdatedAt: '2026-09-20T00:00:00Z', ...overrides })
export const fieldValue = (overrides = {}) => ({ workspaceId: WORKSPACE, itemExternalId: 'item-1', projectFieldId: 'field-1', value: 'In Progress',
  observedAt: '2026-09-20T00:00:02Z', ...overrides })
// 前置行：SQLite 实现打开 foreign_keys，成员关系/字段值/投影都以外键指向工作区、绑定与实体。
export const seedWorkspace = (storage, id = WORKSPACE) => storage.putWorkspace(workspace(id))
/** 源实体的合法测试种子；真实身份输入复用于 caller 的读回断言。 */
export const seedIdentity = (storage, identity, kind = 'work_item') => storage.transaction(async (tx) => {
  await tx.putEntity({ id: identity.entityId, kind, primaryIdentityId: identity.id }); await tx.putExternalIdentity(identity)
})
export const replacePrimary = (storage, previous, next, kind = 'work_item') => storage.transaction(async (tx) => {
  await tx.putExternalIdentity({ ...previous, role: 'historical' }); await tx.putExternalIdentity(next)
  await tx.putEntity({ id: previous.entityId, kind, primaryIdentityId: next.id })
})
/** 注意：本 helper 会创建 `fixture-binding`（禁用的 development 挂载）并登记一条 primary 身份；需要其它工作区/挂载断言的用例应显式自建 seed。 */
export async function seedEntity(storage, id) {
  await storage.putProviderBinding({ id: 'fixture-binding', workspaceId: WORKSPACE, domain: 'development', implementationKey: 'fake', enabled: false, isDefault: false })
  await seedIdentity(storage, { id: `fixture-${id}`, entityId: id, bindingId: 'fixture-binding', externalKind: 'issue', externalId: id, role: 'primary' })
}
