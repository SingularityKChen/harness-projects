/** 浏览器工具逐步执行；text 必须取自同一已挂载页面的实际 DOM。 */
export const browserScenario = Object.freeze({
  title: '规划项 issue-1', body: 'issue-1 正文占位',
  denial: { action: 'fault', value: { domain: 'planning', kind: 'permission_denied', enabled: true } },
  recovery: { action: 'fault', value: { domain: 'planning', kind: 'permission_denied', enabled: false } },
})
