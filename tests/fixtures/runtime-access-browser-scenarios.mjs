import assert from 'node:assert/strict'

/** 浏览器工具逐步执行；text 必须取自同一已挂载页面的实际 DOM。 */
export const browserScenario = Object.freeze({
  title: '规划项 issue-1', body: 'issue-1 正文占位',
  denial: { action: 'fault', value: { domain: 'planning', kind: 'permission_denied', enabled: true } },
  recovery: { action: 'fault', value: { domain: 'planning', kind: 'permission_denied', enabled: false } },
  refreshButton: '刷新规划', deniedKey: 'planning.item.read',
})
export const planningBrowserSteps = Object.freeze([
  { action: 'openItem', name: browserScenario.title, expect: 'visible' },
  { action: 'control', input: browserScenario.denial },
  { action: 'clickButton', name: browserScenario.refreshButton, expect: 'denied' },
  { action: 'control', input: browserScenario.recovery },
  { action: 'clickButton', name: browserScenario.refreshButton, expect: 'visible' },
])
export function assertPlanningBrowserSnapshot(state, text) {
  if (state === 'denied') {
    assert.ok(!text.includes(browserScenario.title)); assert.ok(!text.includes(browserScenario.body))
    assert.ok(text.includes(browserScenario.deniedKey)); assert.ok(text.includes(browserScenario.refreshButton))
  } else {
    assert.ok(text.includes(browserScenario.title)); assert.ok(text.includes(browserScenario.body))
  }
}
