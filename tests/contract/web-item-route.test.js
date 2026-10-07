/** 深链 codec 与 History adapter 契约（issue #130）：唯一路由 `/projects/:projectId/items[/:itemId]`；记录型 port 断言调用次序。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { browserHistoryPort, createItemNavigation, itemPath, parseItemRoute } from '@harness-projects/app-web'

/** 记录型 HistoryPort：push/replace 真的改写 pathname，subscribe 只保存监听器。 */
function port(initial) {
  const calls = { push: [], replace: [], unsubscribed: 0 }
  const listeners = new Set()
  let pathname = initial
  return {
    calls, listeners,
    pathname: () => pathname,
    push: (path) => { calls.push.push(path); pathname = path },
    replace: (path) => { calls.replace.push(path); pathname = path },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); calls.unsubscribed += 1 } },
    pop: () => [...listeners].forEach((listener) => listener()),
    setPath: (next) => { pathname = next },
  }
}

test('invalid-segments-no-echo：精确段数、空段、畸形编码、解码后 slash / control 与 query/hash 都不是目标，且不回声错误 URL', () => {
  const bad = [
    '/', '', 'projects/ws-1/items', '/projects/ws-1', '/projects/ws-1/items/ent-aa/extra', '/projects//items',
    '/projects/%2F/items', '/projects/ws-1/items/%E0%A4%A', '/projects/ws-1/items/a%2Fb', '/projects/ws-1%00/items',
    '/projects/ws-1%5Cx/items', '/other/ws-1/items', '/projects/ws-1/items/.', '/projects/ws-1/items/..', '/projects/%2e%2e/items', '/projects/ws-1/items/%2e', '/projects/ws-1/item/ent-aa',
  ]
  for (const pathname of bad) assert.equal(parseItemRoute(pathname), undefined, JSON.stringify(pathname))
  assert.deepEqual(parseItemRoute('/projects/ws-1/items'), { projectId: 'ws-1' })
  assert.deepEqual(parseItemRoute('/projects/ws%2D1/items/ent%2Daa'), { projectId: 'ws-1', itemId: 'ent-aa' })
  assert.deepEqual(parseItemRoute('/projects/ws-1/items?tab=2#note'), { projectId: 'ws-1' })
  assert.deepEqual(parseItemRoute('/projects/ws-1/items/ent-aa?tab=2'), { projectId: 'ws-1', itemId: 'ent-aa' })
})

test('canonical-open-close-idempotent：itemPath 逐段编码并生成 canonical pathname；open 同目标 0 次重复 push，close 只有 replace', () => {
  assert.equal(itemPath({ projectId: 'ws-1' }), '/projects/ws-1/items')
  for (const target of [{ projectId: 'ws 1' }, { projectId: 'ws-1', itemId: 'ent aa' }, { projectId: 'a+b', itemId: 'c%20d' }])
    assert.deepEqual(parseItemRoute(itemPath(target)), target, `合法转义段必须自往返：${JSON.stringify(target)}`)
  for (const bad of [{ projectId: 'ws 1', itemId: 'ent/aa' }, { projectId: '' }, { projectId: 'ws-1', itemId: '' }, { projectId: '..' }])
    assert.throws(() => itemPath(bad), TypeError, `生成侧与解析侧同一判据，无法 canonical 表达必须抛错：${JSON.stringify(bad)}`)

  const history = port('/projects/ws-1/items')
  const routes = []
  const navigation = createItemNavigation(history, (route) => routes.push(route))
  assert.deepEqual(routes, [{ projectId: 'ws-1' }], '构造函数即时发布初始 route')

  navigation.open({ projectId: 'ws-1', itemId: 'ent-aa' })
  assert.deepEqual(history.calls.push, ['/projects/ws-1/items/ent-aa'])
  assert.deepEqual(routes.at(-1), { projectId: 'ws-1', itemId: 'ent-aa' })
  navigation.open({ projectId: 'ws-1', itemId: 'ent-aa' })
  assert.deepEqual([history.calls.push.length, routes.length], [1, 2], '同目标不重复 push，也不产生新的 selection 发布')

  navigation.close('ws-1')
  assert.deepEqual(history.calls.replace, ['/projects/ws-1/items'])
  assert.deepEqual([history.calls.push.length, routes.at(-1)], [1, { projectId: 'ws-1' }], 'close 绝不调用 history.back')
  navigation.close('ws-1')
  assert.equal(history.calls.replace.length, 1, '已在列表路径时 close 幂等')
})

test('initial-route-and-popstate：每次 popstate 按当前 pathname 重新解析并发布，未知路由发布 undefined，不绑定旧 store', () => {
  const history = port('/projects/ws-1/items/ent-aa')
  const routes = []
  const navigation = createItemNavigation(history, (route) => routes.push(route))
  assert.deepEqual(routes, [{ projectId: 'ws-1', itemId: 'ent-aa' }])

  history.setPath('/projects/ws-1/items')
  history.pop()
  assert.deepEqual(routes.at(-1), { projectId: 'ws-1' })
  history.setPath('/projects/ws-1/items/ent-bb')
  history.pop()
  assert.deepEqual(routes.at(-1), { projectId: 'ws-1', itemId: 'ent-bb' })
  history.setPath('/nowhere')
  history.pop()
  assert.equal(routes.at(-1), undefined, '未知路由发布 undefined，由挂载者显示中性 unresolved')
  navigation.open({ projectId: 'ws-1', itemId: 'ent-cc' })
  assert.deepEqual(routes.at(-1), { projectId: 'ws-1', itemId: 'ent-cc' })

  // popstate 必须先同步 current：否则 Back 回列表后再次 open 原目标会被误判为"同目标"而不 push（verify-269 P1）。
  history.setPath('/projects/ws-1/items')
  history.pop()
  navigation.open({ projectId: 'ws-1', itemId: 'ent-aa' })
  assert.deepEqual(history.calls.push, ['/projects/ws-1/items/ent-cc', '/projects/ws-1/items/ent-aa'], 'Back 后再次点击同一条目必须真实 push')
  assert.deepEqual(routes.at(-1), { projectId: 'ws-1', itemId: 'ent-aa' }, '必须重新发布详情 selection')
})

test('browser-history-port：产品 port 映射 pathname/pushState/replaceState/popstate，且不需仓库 DOM lib', () => {
  const log = { push: [], replace: [], on: 0, off: 0 }
  globalThis.location = { pathname: '/projects/ws-1/items' }
  globalThis.history = { pushState: (_d, _u, url) => { log.push.push(url); globalThis.location.pathname = url }, replaceState: (_d, _u, url) => { log.replace.push(url); globalThis.location.pathname = url } }
  globalThis.addEventListener = (type) => { if (type === 'popstate') log.on += 1 }
  globalThis.removeEventListener = (type) => { if (type === 'popstate') log.off += 1 }
  try {
    const routes = []
    const navigation = createItemNavigation(browserHistoryPort(), (route) => routes.push(route))
    navigation.open({ projectId: 'ws-1', itemId: 'ent-aa' })
    navigation.close('ws-1')
    navigation.dispose()
    assert.deepEqual([log.push, log.replace, log.on, log.off, routes.at(-1)], [['/projects/ws-1/items/ent-aa'], ['/projects/ws-1/items'], 1, 1, { projectId: 'ws-1' }])
  } finally {
    delete globalThis.location; delete globalThis.history; delete globalThis.addEventListener; delete globalThis.removeEventListener
  }
})

test('dispose-stops-listeners：dispose 可重复、释放监听且不再触发回调，也不再 push/replace', () => {
  const history = port('/projects/ws-1/items')
  const routes = []
  const navigation = createItemNavigation(history, (route) => routes.push(route))
  navigation.dispose()
  assert.deepEqual([history.calls.unsubscribed, history.listeners.size], [1, 0])
  navigation.dispose()
  assert.equal(history.calls.unsubscribed, 1, 'dispose 可重复且只释放一次')

  history.setPath('/projects/ws-1/items/ent-aa')
  history.pop()
  navigation.open({ projectId: 'ws-1', itemId: 'ent-bb' })
  navigation.close('ws-1')
  assert.deepEqual([routes.length, history.calls.push, history.calls.replace], [1, [], []], 'dispose 后没有任何回调或导航')
})
