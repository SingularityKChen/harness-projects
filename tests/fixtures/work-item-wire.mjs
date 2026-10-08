/** 工作项 wire 合成数据（issue #130）：可见条目 `wire` 与被遮蔽条目 `redacted`（字段全是 CANARY，泄露即被断言抓到；`content` 与第三个参数的状态 / 派生 / reason / planningFields 可覆盖；顶层 `planningFields` 显式承接，不静默丢弃）。 */
export const T = '2026-10-01T08:00:00.000Z'
export const CANARIES = ['CANARY-TITLE', 'CANARY-BODY', 'CANARY-EXT', 'CANARY-BIND', 'CANARY-REASON', '已完成', '需要关注']
export const wire = (entityId, { planningStatus = 'in_progress', derived = [], content = {}, source = {}, planningFields } = {}) => ({
  entityId, kind: 'work_item', planningStatus, derived,
  ...(planningFields === undefined ? {} : { planningFields }),
  content: { contentKind: 'work_item', title: `标题-${entityId}`, body: `正文-${entityId}`, bindingId: 'bind-1', externalKind: 'issue', externalId: `ext-${entityId}`, ...content },
  source: { revision: 1, freshness: 'fresh', authority: 'provider', reason: undefined, ...source },
})
export const redacted = (entityId = 'ent-bb', content = {}, { planningStatus = 'done', derived = ['attention'], reason = 'CANARY-REASON', planningFields } = {}) => wire(entityId, {
  planningStatus, derived, planningFields,
  content: { contentKind: 'redacted', title: 'CANARY-TITLE', body: 'CANARY-BODY', bindingId: 'CANARY-BIND', externalId: 'CANARY-EXT', ...content },
  source: { freshness: 'degraded', reason, authority: 'host' },
})
