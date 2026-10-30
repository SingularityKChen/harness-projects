import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { platform, input, repository, sha, ok, repositoryId } from '../fixtures/github-development-create.mjs'
import { collectBindings } from '@harness-projects/core'
import { developmentContractSuite } from './suites/development.js'

const CREATE = 'development.change_request.create', READ = 'development.repository.read'
const state = async (provider) => (await provider.describeCapabilities()).permission
const rejected = (result, code) => {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, code)
  if (code !== 'unavailable' && code !== 'rate_limited') assert.equal(result.error.retryable, false)
  assert.equal(JSON.stringify(result).includes('canary'), false)
}
const ledgers = new WeakMap()
developmentContractSuite({
  label: 'GitHub Development provider（严格合成创建平台）',
  makeProvider(scenario) { const fixture = platform(scenario); ledgers.set(fixture.provider, fixture); return fixture.provider },
  expect: {
    repository, baseBranch: 'main', headCommit: sha, pageSize: 1,
    changeRequest: { head: 'feature/topic', alternateBase: 'release', decoyHead: 'feature/decoy' },
    worktreeBranch: 'feature/topic', worktreeDupBranch: 'main', worktreePath: 'unused-worktree',
    worktreeRef: { ...repository, objectKind: 'worktree', externalId: 'unused-worktree' },
    objects: (provider) => structuredClone(ledgers.get(provider).objects),
  },
})

test('创建精确原生 ack、marker 与独立写权限；read 和 viewerPermission 不证明 write', async () => {
  const f = platform()
  assert.equal(typeof f.provider.createChangeRequest, 'function', '生产 provider 必须实现创建')
  assert.deepEqual(Object.values((await f.provider.describeCapabilities()).capability), ['available', 'available', 'available'])
  await f.provider.getRepository(repository)
  assert.deepEqual([(await state(f.provider))[READ], (await state(f.provider))[CREATE]], ['available', 'degraded'])
  const result = await f.provider.createChangeRequest(input)
  assert.equal(result.ok, true)
  assert.deepEqual([result.value.number, result.value.sourceVersion, result.value.headBranch, result.value.body], [1, sha, input.head, input.body])
  assert.deepEqual(result.value.nativeIdentity, { namespace: 'github.com/graphql/PullRequest', id: 'PR_1' })
  assert.equal((await state(f.provider))[CREATE], 'available')
  assert.deepEqual(f.mutations()[0].variables.input, { repositoryId, headRepositoryId: repositoryId, headRefName: input.head, baseRefName: input.base, title: input.title, body: input.body })
  assert.equal(f.mutations().length, 1)
})

test('本地拒绝外来引用和非法输入，零 transport', async () => {
  const f = platform()
  for (const patch of [{ bindingId: 'foreign' }, { objectKind: 'branch' }, { externalId: 'other' }]) {
    rejected(await f.provider.createChangeRequest({ ...input, repository: { ...repository, ...patch } }), 'not_found')
  }
  for (const patch of [{ head: '' }, { base: '' }, { title: '' }, { body: null }, { head: 'main' }, { head: sha }, { base: sha.toUpperCase() }, { head: 'fork:topic' }, { base: 'fork:main' }, { head: 7 }]) {
    rejected(await f.provider.createChangeRequest({ ...input, ...patch }), 'invalid_input')
  }
  assert.equal(f.calls.length, 0)
})

test('预检核对仓库、精确 ref 和 Commit；失败不发送 mutation', async () => {
  const changes = [
    ['not_found', (d) => { d.repository = null }], ['not_found', (d) => { d.repository.head = null }], ['not_found', (d) => { d.repository.base = null }],
    ['conflict', (d) => { d.repository.id = 'R_wrong' }], ['conflict', (d) => { d.repository.nameWithOwner = 'other/project' }], ['unavailable', (d) => { delete d.repository.id }],
    ['unavailable', (d) => { d.repository.head.name = 'other'; delete d.repository.head.repository }],
    ['conflict', (d) => { d.repository.head.name = 'Topic' }], ['conflict', (d) => { d.repository.base.prefix = 'refs/tags/' }],
    ['conflict', (d) => { d.repository.head.repository.id = 'R_fork' }], ['conflict', (d) => { d.repository.base.repository.id = 'R_other' }],
    ['unavailable', (d) => { d.repository.head.target.__typename = 'Tag' }], ['unavailable', (d) => { d.repository.base.target.oid = 'bad' }],
  ]
  for (const [code, mutate] of changes) {
    const f = platform({}, { preflight: (data) => { mutate(data); return ok(data) } })
    rejected(await f.provider.createChangeRequest(input), code)
    assert.equal(f.mutations().length, 0)
  }
  const f = platform({}, { preflight: (data) => { data.repository.nameWithOwner = 'EXAMPLE/PROJECT'; return ok(data) } })
  assert.equal((await f.provider.createChangeRequest(input)).ok, true)
})

test('任何不完整或错身份 ack 都是不可重试的 ambiguous，真实 ack SHA 可在预检后移动', async () => {
  const changes = [
    (n) => { n.repository.id = 'R_other' }, (n) => { n.headRepository.id = 'R_fork' }, (n) => { n.isCrossRepository = true },
    (n) => { n.headRefName = 'other' }, (n) => { n.baseRefName = 'other' }, (n) => { n.title = 'other' }, (n) => { n.body = 'other' },
    (n) => { n.number = 0 }, (n) => { n.number = '1' }, (n) => { n.headRefOid = 'bad' }, (n) => { delete n.id }, (n) => { delete n.headRepository }, (n) => { n.__typename = 'Issue' },
    (n) => { delete n.updatedAt }, (n) => { delete n.url }, (n) => { n.number = Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const mutate of changes) {
    const f = platform({}, { ack: (node) => { mutate(node); return ok({ createPullRequest: { pullRequest: node } }) } })
    rejected(await f.provider.createChangeRequest(input), 'ambiguous_result')
    assert.equal((await state(f.provider))[CREATE], 'degraded')
    assert.equal(f.mutations().length, 1)
  }
  for (const data of [{}, { createPullRequest: null }, { createPullRequest: { pullRequest: null } }]) {
    rejected(await platform({}, { mutation: () => ok(data) }).provider.createChangeRequest(input), 'ambiguous_result')
  }
  const f = platform({}, { ack: (node) => ok({ createPullRequest: { pullRequest: { ...node, headRefOid: 'b'.repeat(40) } } }) })
  assert.equal((await f.provider.createChangeRequest(input)).value.sourceVersion, 'b'.repeat(40))
})

const response = (status, type, payload) => ({ status, headers: { 'x-github-request-id': 'ABCD:1234:5678:9ABC', 'retry-after': '2' },
  body: { data: payload, errors: type ? [{ type, message: 'canary' }] : undefined } })
test('写错误分类不泄漏正文，partial payload 优先 ambiguous；不自动重发', async () => {
  const cases = [
    [response(401), 'permission_denied', 'read_only'], [response(200, 'NOT_FOUND'), 'ambiguous_result', 'degraded'], [response(403, 'FORBIDDEN'), 'rate_limited', 'degraded'],
    [response(200, 'FORBIDDEN'), 'permission_denied', 'read_only'], [response(200, 'INSUFFICIENT_SCOPES'), 'permission_denied', 'read_only'],
    [response(429), 'rate_limited', 'degraded'], [response(200, 'RATE_LIMITED'), 'rate_limited', 'degraded'],
    [response(500), 'ambiguous_result', 'degraded'], [{ ...response(403), headers: {} }, 'permission_denied', 'read_only'],
    [{ ...response(200), body: { errors: [{ message: 'secondary rate limit canary' }] } }, 'rate_limited', 'degraded'], [response(200, 'UNKNOWN'), 'ambiguous_result', 'degraded'],
    [response(200, 'FORBIDDEN', { createPullRequest: { pullRequest: { id: 'PR_partial' } } }), 'ambiguous_result', 'degraded'],
    [response(429, 'RATE_LIMITED', { createPullRequest: { pullRequest: { id: 'PR_partial' } } }), 'ambiguous_result', 'degraded'],
  ]
  for (const [reply, code, permission] of cases) {
    const f = platform({}, { mutation: () => reply })
    const result = await f.provider.createChangeRequest(input)
    rejected(result, code)
    assert.equal((await state(f.provider))[CREATE], permission)
    assert.equal(f.mutations().length, 1)
    assert.equal(result.requestId, reply.headers['x-github-request-id'])
    if (code === 'rate_limited') assert.equal(result.error.retryAfterMs, 2000)
  }
})

test('写拒绝在同实例 read/eager/lazy describe 后仍冷拒；新实例只恢复未知', async () => {
  let denied = true
  const f = platform({}, { mutation: (data) => denied ? { status: 403, headers: {}, body: { message: 'canary' } } : ok({ createPullRequest: { pullRequest: f.node(data, 1) } }) })
  const collect = (provider) => collectBindings({ workspaceId: 'workspace-fixture', providers: { development: provider }, policy: {} })
  const before = await collect(f.provider)
  const access = (prepared) => prepared.bindings[0].capabilities.find((entry) => entry.key === CREATE).access
  assert.equal(access(before), 'degraded')
  rejected(await f.provider.createChangeRequest(input), 'permission_denied')
  denied = false
  await f.provider.getRepository(repository)
  const count = f.calls.length
  assert.equal((await state(f.provider))[CREATE], 'read_only')
  assert.equal(f.calls.length, count, 'lazy describe 不探测')
  rejected(await f.provider.createChangeRequest(input), 'permission_denied')
  assert.equal(f.calls.length, count, '旧 registry 未刷新也不能再次发送')
  assert.equal(access(before), 'degraded', 'registry 是组合时快照')
  assert.equal(access(await collect(f.provider)), 'read_only')
  const restored = f.make('eager')
  assert.equal(access(await collect(restored)), 'degraded', '新实例和新组合只恢复未知')
  assert.equal((await restored.createChangeRequest(input)).ok, true)
  assert.equal(access(await collect(restored)), 'available')
  assert.equal((await state(f.provider))[CREATE], 'read_only', '新实例不能改写旧实例')

})

test('平台已创建后丢 ack：只发一次，get/list/reconcile 保留同一 marker；fork 与第二候选跨页可读', async () => {
  const f = platform({}, { dropAck: true })
  rejected(await f.provider.createChangeRequest(input), 'ambiguous_result')
  assert.equal(f.mutations().length, 1)
  assert.equal(f.objects.length, 1)
  const ref = { ...repository, objectKind: 'change_request', externalId: f.objects[0].id }
  assert.equal((await f.provider.getChangeRequest(ref)).value.body, input.body)
  const observations = []
  for await (const observation of f.provider.reconcile({})) observations.push(observation)
  assert.equal(observations[0].payload.body, input.body)
  f.objects.push(f.node({ ...f.mutations()[0].variables.input, baseRefName: 'release' }, 2))
  f.objects.unshift({ ...f.objects[0], id: 'PR_fork', isCrossRepository: true })
  const first = await f.provider.listChangeRequests({ repository, headBranch: input.head, cursor: undefined, limit: 1 })
  const second = await f.provider.listChangeRequests({ repository, headBranch: input.head, cursor: first.value.nextCursor, limit: 1 })
  assert.deepEqual([first.value.items[0].body, second.value.items[0].body], [input.body, input.body])
  assert.notEqual(first.value.items[0].ref.externalId, second.value.items[0].ref.externalId)
  assert.equal(second.value.nextCursor, undefined)
  assert.equal(f.mutations().length, 1)
})


test('mutation reject/timeout 和畸形响应都是未知；read 失败不清除已确认的 create 权限', async () => {
  for (const mutation of [() => { throw new Error('timeout canary') }, () => Promise.reject(new Error('network canary')), () => undefined,
    () => ({ status: 200, headers: {}, body: 'canary' }), () => response(200, 'FORBIDDEN', { createPullRequest: {} })]) {
    const f = platform({}, { mutation })
    rejected(await f.provider.createChangeRequest(input), 'ambiguous_result')
    assert.equal(f.mutations().length, 1)
  }
  let fail = false
  const f = platform({}, { read: () => fail ? { status: 401, headers: {}, body: {} } : ok({ repository: { name: 'project', updatedAt: '', defaultBranchRef: null } }) })
  assert.equal((await f.provider.createChangeRequest(input)).ok, true)
  fail = true
  await f.provider.getRepository(repository)
  assert.deepEqual([(await state(f.provider))[READ], (await state(f.provider))[CREATE]], ['degraded', 'available'])
})

test('strict fixture 拒绝 head==base、fork 和重复 OPEN pair，拒绝后对象集合不变', async () => {
  const f = platform()
  await f.provider.createChangeRequest(input)
  const request = f.mutations()[0], before = structuredClone(f.objects)
  for (const patch of [{}, { headRefName: 'main' }, { headRepositoryId: 'R_fork' }, { headRefName: 'feature/decoy', baseRefName: 'feature/topic' }]) {
    await assert.rejects(() => f.transport({ ...request, variables: { input: { ...request.variables.input, ...patch } } }))
    assert.deepEqual(f.objects, before)
  }
})

test('marker 读面遇第二页失败、循环或扫描上限，不能把部分观察当成完整对账', async () => {
  for (const mode of ['failed-page', 'cycle', 'budget']) {
    const f = platform({}, { dropAck: true, read: (request, objects) => {
      const after = request.variables.after
      if (mode === 'failed-page' && after !== null) return { status: 503, headers: {}, body: {} }
      return ok({ repository: { pullRequests: { nodes: structuredClone(objects), pageInfo: {
        hasNextPage: true, endCursor: mode === 'cycle' ? '1' : String(Number(after ?? 0) + 1),
      } } } })
    } })
    rejected(await f.provider.createChangeRequest(input), 'ambiguous_result')
    const first = await f.provider.listChangeRequests({ repository, headBranch: input.head, cursor: undefined, limit: 1 })
    assert.equal(first.value.items[0].body, input.body)
    assert.notEqual(first.value.nextCursor, undefined, '还有未完成的 scope')
    if (mode !== 'budget') rejected(await f.provider.listChangeRequests({ repository, headBranch: input.head, cursor: first.value.nextCursor, limit: 1 }), 'unavailable')
    const observations = []
    for await (const observation of f.provider.reconcile({})) observations.push(observation)
    assert.deepEqual(observations, [], mode)
    assert.ok(f.calls.length <= 105, '扫描有界')
    assert.equal(f.mutations().length, 1)
  }
})

test('ack 只核对一次读取的 primitive 意图，变化 getter 不能确认未发送字段', async () => {
  for (const wrongAck of [false, true]) {
    const reads = {}, mutable = {}
    for (const [key, value] of Object.entries(input)) {
      Object.defineProperty(mutable, key, { get: () => { reads[key] = (reads[key] ?? 0) + 1; return key === 'title' && reads[key] > 1 ? 'ack-only title' : value } })
    }
    const f = platform({}, { ack: (node) => ok({ createPullRequest: { pullRequest: { ...node, title: wrongAck ? 'ack-only title' : input.title } } }) })
    const result = await f.provider.createChangeRequest(mutable)
    if (wrongAck) rejected(result, 'ambiguous_result')
    else assert.equal(result.ok, true, '正确 ack 不受 caller getter 后续变化影响')
    assert.deepEqual(reads, { repository: 1, head: 1, base: 1, title: 1, body: 1 })
    assert.equal(f.mutations()[0].variables.input.title, input.title)
  }
})

test('caller 在预检或 mutation 等待期间修改意图，发送与 ack 仍使用原始快照', async () => {
  for (const phase of ['preflight', 'mutation']) {
    for (const wrongAck of [false, true]) {
      const mutable = { ...input, repository: { ...repository } }
      const changeCaller = () => { mutable.head = 'feature/decoy'; mutable.base = 'release'; mutable.title = 'later title'; mutable.body = 'later marker'; mutable.repository.externalId = 'other' }
      const f = platform({}, {
        preflight: async (data) => { if (phase === 'preflight') { await Promise.resolve(); changeCaller() } return ok(data) },
        ack: async (node) => { if (phase === 'mutation') { await Promise.resolve(); changeCaller() } return ok({ createPullRequest: { pullRequest: { ...node, body: wrongAck ? mutable.body : node.body } } }) },
      })
      const result = await f.provider.createChangeRequest(mutable)
      if (wrongAck) rejected(result, 'ambiguous_result')
      else assert.equal(result.ok, true, `${phase} 的正确 ack 必须保持成功`)
      assert.deepEqual(f.mutations()[0].variables.input, { repositoryId, headRepositoryId: repositoryId, headRefName: input.head, baseRefName: input.base, title: input.title, body: input.body })
    }
  }
})

test('输入或仓库身份 getter 抛错时结构化拒绝且零 transport，身份 getter 仅读一次', async () => {
  for (const key of ['repository', 'head', 'base', 'title', 'body', 'bindingId', 'objectKind', 'externalId']) {
    const f = platform(), mutable = { ...input, repository: { ...repository } }
    const target = key in input ? mutable : mutable.repository
    Object.defineProperty(target, key, { get: () => { throw new Error('getter canary') } })
    rejected(await f.provider.createChangeRequest(mutable), 'invalid_input')
    assert.equal(f.calls.length, 0)
  }
  const reads = {}, ref = {}
  for (const key of ['bindingId', 'objectKind', 'externalId']) Object.defineProperty(ref, key, { get: () => { reads[key] = (reads[key] ?? 0) + 1; return reads[key] === 1 ? repository[key] : 'foreign' } })
  const f = platform()
  assert.equal((await f.provider.createChangeRequest({ ...input, repository: ref })).ok, true)
  assert.deepEqual(reads, { bindingId: 1, objectKind: 1, externalId: 1 })
})

test('transport 修改其 mutation input 不能改变 ack oracle', async () => {
  const f = platform({}, { mutation: (data) => { data.body = 'transport marker'; data.title = 'transport title'; return ok({ createPullRequest: { pullRequest: f.node(data, 1) } }) } })
  rejected(await f.provider.createChangeRequest(input), 'ambiguous_result')
  assert.equal(f.mutations().length, 1)
})

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
for (const mode of ['preflight', 'ack', 'ambiguous', 'malformed-ack', 'rate-limited']) {
  test(`ReadOnly 黏住：并发 ${mode} 迟到不能解封同实例写入`, async () => {
    const arrived = deferred(), release = deferred()
    let preflights = 0, writes = 0
    const f = platform({}, {
      preflight: async (data) => { if (++preflights === 1 && mode === 'preflight') { arrived.resolve(); await release.promise } return ok(data) },
      mutation: async (data) => {
        const index = ++writes
        if (index === 1 && mode !== 'preflight') {
          arrived.resolve(); await release.promise
          if (mode === 'ambiguous') throw new Error('late canary')
          if (mode === 'malformed-ack') return ok({ createPullRequest: null })
          if (mode === 'rate-limited') return { status: 429, headers: {}, body: {} }
          return ok({ createPullRequest: { pullRequest: f.node(data, 1) } })
        }
        return { status: 403, headers: {}, body: {} }
      },
    })
    const late = f.provider.createChangeRequest({ ...input, title: 'old call' })
    await arrived.promise
    rejected(await f.provider.createChangeRequest({ ...input, title: 'new refusal' }), 'permission_denied')
    assert.equal((await state(f.provider))[CREATE], 'read_only')
    release.resolve()
    const result = await late
    if (mode === 'ack') assert.equal(result.ok, true, '已发送且真实成功的对象仍须如实返回')
    else rejected(result, mode === 'preflight' ? 'permission_denied' : mode === 'rate-limited' ? 'rate_limited' : 'ambiguous_result')
    assert.equal(writes, mode === 'preflight' ? 1 : 2, '已知拒绝后不得再发送等待预检的 mutation')
    assert.equal((await state(f.provider))[CREATE], 'read_only')
    const before = f.calls.length
    rejected(await f.provider.createChangeRequest(input), 'permission_denied')
    assert.equal(f.calls.length, before, '第三次调用零 transport')
    assert.equal((await state(f.make()))[CREATE], 'degraded', '新实例才能恢复未知')
  })
}
