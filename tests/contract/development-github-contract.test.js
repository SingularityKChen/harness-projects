/**
 * GitHub Development provider 在录制夹具上的契约（不触网、不需要凭据；夹具来自私有沙箱的只读查询）。保护的不变量：
 * (1) 共享 Development 契约套件在真实平台形状上通过，回放未命中即 reject、账本为空；
 * (2) 夹具不失真：node id 必须已登记（provenance）、查询文本变了必须重录（漂移）、查询不取个人字段；
 * (3) Start Work 分支谱系：只按 head 分支（同仓库、字节精确）找 PR，从不按标题、不混入 fork 同名分支或放宽过滤带出的 PR；
 * (4) 身份：仓库引用用宿主配置的本地键，PR 用 node id（与规划夹具同值），仓库 node id 不出现在任何输出；
 * (5) 失去读权限：五个读方法结构化失败（固定文案、不回显正文），快照降级为 degraded，恢复后回到 available；
 * (6) 观察：sourceVersion 是定宽规范载体而不是 sha，全有或全无。
 */
import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { effectiveCapabilities, isComparableSourceVersion, sourceVersionFromTimestamp } from '@harness-projects/capabilities'
import { branchNameFor } from '@harness-projects/core'
import { createGithubDevelopmentProvider, DEVELOPMENT_QUERIES, GITHUB_DEVELOPMENT_DEFINITION } from '@harness-projects/provider-development-github'
import { createReplay, loadFixture } from './fixtures/github-projects/replay.js'
import { developmentContractSuite } from './suites/development.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/github-development/sandbox.json', import.meta.url), 'utf8'))
const exchangesOf = (operationName) => fixture.exchanges.filter((entry) => entry.operationName === operationName)
const bindingId = 'binding-github-development'
/** 宿主选定的工作区仓库键：core 把它写成仓库主键，绝不是 GitHub node id。 */
const LOCAL_REPOSITORY_KEY = 'repo-e1-sandbox'
const { owner: OWNER, name: NAME } = exchangesOf('DevelopmentRepository')[0].variables
const ABSENT_NAME = exchangesOf('DevelopmentRepository').find((entry) => entry.variables.name.endsWith('-absent')).variables.name
const GAMMA_HEAD = exchangesOf('DevelopmentBranches').find((entry) => entry.variables.first === 100).body.data.repository.refs.nodes
  .find((node) => node.name === 'fixture/gamma').target.oid
const PR_NODE = exchangesOf('DevelopmentChangeRequests').find((entry) => entry.variables.headRefName === null).body.data.repository.pullRequests.nodes[0]
const REPOSITORY_NODE_ID = exchangesOf('DevelopmentChangeRequest')[0].body.data.repository.id

/** 每个 provider 一份请求账本（未命中也记）；回放的 misses 账本在最后一条用例统一断言。时钟缺省每次调用递增 1 秒，需要精确时刻的用例传入固定时钟。 */
const replays = []
const ledgers = new WeakMap()
function build(transport, repository = { externalId: LOCAL_REPOSITORY_KEY, owner: OWNER, name: NAME }, clock) {
  const ledger = []
  let now = Date.parse('2026-10-15T00:00:00Z')
  const provider = createGithubDevelopmentProvider({ bindingId, repository, now: clock ?? (() => (now += 1000)), transport: async (request) => { ledger.push(request); return transport(request) } })
  ledgers.set(provider, ledger)
  return provider
}
const replayTransport = () => { const replay = createReplay(fixture); replays.push(replay); return replay.transport }
const replayProvider = (repository, clock) => build(replayTransport(), repository, clock)
const scripted = (handler, repository, clock) => build(async (request) => handler(request), repository, clock)

const repositoryRef = { bindingId, objectKind: 'repository', externalId: LOCAL_REPOSITORY_KEY, url: undefined }
const PR_REF = { bindingId, objectKind: 'change_request', externalId: PR_NODE.id, url: PR_NODE.url }
const commitRef = (sha) => ({ ...repositoryRef, objectKind: 'commit', externalId: sha })
const denied = { status: 401, headers: {}, body: { message: 'Bad credentials' } }
/** 合成响应：`data` 之外一律不带，平台行为（过滤、游标、评审结论）由各用例自己摆。 */
const ok = (data) => ({ status: 200, headers: {}, body: { data } })
const prPage = (nodes, pageInfo = { hasNextPage: false, endCursor: null }) => ok({ repository: { pullRequests: { pageInfo, nodes } } })
const branchPage = (nodes, pageInfo) => ok({ repository: { refs: { pageInfo, nodes } } })
const prNode = (id, overrides = {}) => ({ ...PR_NODE, id, ...overrides })

developmentContractSuite({
  label: 'GitHub Development provider（录制夹具）',
  makeProvider(scenario = {}) {
    if (scenario.faults?.offline) return scripted(async () => { throw new Error('offline') })
    if (scenario.faults?.permissionDenied) return scripted(() => denied)
    return replayProvider()
  },
  expect: {
    repository: repositoryRef, baseBranch: 'main', headCommit: GAMMA_HEAD, pageSize: 1,
    // 三个工作树字段只是套件装配所需的占位：本 provider 省略全部工作树方法，套件只会在「未声明」路径上读到它们。
    worktreeBranch: 'fixture/gamma', worktreeDupBranch: 'main', worktreePath: 'unused-worktree-path',
    worktreeRef: { bindingId, objectKind: 'worktree', externalId: 'unused-worktree', url: undefined },
    preparedChangeRequest: { ref: PR_REF, headBranch: 'fixture/gamma', reviewState: 'unknown' },
    // 本 provider 只读：账本里不该出现查询集合之外的操作或 mutation。不用全量账本，`declares()` 的探针请求会让前后快照不同。
    objects: (provider) => ledgers.get(provider).filter((request) => !Object.hasOwn(DEVELOPMENT_QUERIES, request.operationName) || /^\s*mutation\b/.test(request.query)),
  },
})

test('start-work-branch-lineage（录制）：按 head 分支读回 PR，头部提交与分支头相等', async () => {
  const provider = replayProvider()
  // 与 core 的 readHeadCommit / readChangeRequest 同形的调用：首页 limit 50。
  const branches = await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit: 50 })
  const head = branches.value.items.find((branch) => branch.name === 'fixture/gamma').headCommit
  const listed = await provider.listChangeRequests({ repository: repositoryRef, headBranch: 'fixture/gamma', cursor: undefined, limit: 50 })
  assert.deepEqual(listed.value.items.map((item) => item.ref.externalId), [PR_NODE.id])
  assert.equal(listed.value.items[0].headBranch, 'fixture/gamma')
  assert.equal(listed.value.items[0].sourceVersion, head)
  assert.equal((await provider.getCommit(commitRef(head))).value.sha, head)
})

test('start-work-branch-lineage（合成）：Start Work 分支名、标题诱饵、fork 同名分支与放宽的过滤都不混入', async () => {
  const branch = branchNameFor('e1-fixture-delta')
  const target = prNode('PR_target', { number: 11, title: '与分支名无关的标题', headRefName: branch, isCrossRepository: false })
  // 近似名诱饵：前缀 / 后缀 / 包含 / 首尾空白 / 缺最后一个字符 / 多一层目录；平台放宽过滤时只有字节相等的后过滤能挡住它们。
  const near = [`${branch}-v2`, `x${branch}`, `${branch} `, ` ${branch}`, branch.slice(0, -1), `prefix/${branch}`]
    .map((name, index) => prNode(`PR_near_${index}`, { number: 20 + index, headRefName: name }))
  const all = [target, prNode('PR_fork', { number: 12, headRefName: branch, isCrossRepository: true, headRefOid: 'a'.repeat(40) }),
    prNode('PR_title', { number: 13, title: branch, headRefName: 'feature/other' }), prNode('PR_case', { number: 14, headRefName: branch.toUpperCase() }), ...near]
  const modes = {
    精确: (name) => all.filter((node) => name === null || node.headRefName === name),
    忽略: () => all,
  }
  for (const [mode, platform] of Object.entries(modes)) {
    const provider = scripted((request) => prPage(platform(request.variables.headRefName)))
    const listed = await provider.listChangeRequests({ repository: repositoryRef, headBranch: branch, cursor: undefined, limit: 50 })
    assert.deepEqual(listed.value.items.map((item) => item.ref.externalId), ['PR_target'], `平台${mode}过滤`)
    assert.equal(listed.value.items[0].headBranch, branch)
    assert.equal(listed.value.items[0].sourceVersion, target.headRefOid)
    assert.deepEqual(ledgers.get(provider).map((request) => request.variables.headRefName), [branch], '请求必须带 headRefName 过滤')
  }
  const everything = await scripted((request) => prPage(modes.精确(request.variables.headRefName)))
    .listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 50 })
  assert.deepEqual(everything.value.items.map((item) => [item.ref.externalId, item.headBranch]),
    all.map((node) => [node.id, node.isCrossRepository ? undefined : node.headRefName]), '不带过滤时 fork 的 PR 照常返回，只是没有分支身份')
})

const REQUEST_ID = 'ABCD:1234:5678:9ABC'

test('identity-shape：仓库引用用宿主配置的本地键，PR 用 node id 且与规划夹具同值，仓库 node id 不出现在任何输出', async () => {
  const replayed = replayTransport()
  const provider = build(async (request) => ({ ...(await replayed(request)), headers: { 'x-github-request-id': REQUEST_ID } }))
  const results = [await provider.getRepository(repositoryRef), await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit: 100 }),
    await provider.getCommit(commitRef(GAMMA_HEAD)), await provider.getChangeRequest(PR_REF), await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 100 })]
  assert.deepEqual(results.map((result) => [result.ok, result.requestId]), Array(5).fill([true, REQUEST_ID]), '五个读方法在录制夹具上都成功，并带出形状合法的 requestId')
  assert.equal(JSON.stringify(results).includes(REPOSITORY_NODE_ID), false, '仓库 node id 不得出现在任何输出')
  assert.deepEqual(results[0].value.ref, repositoryRef, '仓库 ref 就是 expect.repository：start-work 把它写成主键并比对 ack')
  assert.deepEqual(results[1].value.items.map((branch) => [branch.ref.externalId, branch.name]), [['fixture/gamma', 'fixture/gamma'], ['main', 'main']])
  assert.equal(results[0].value.sourceUpdatedAt, exchangesOf('DevelopmentRepository')[0].body.data.repository.updatedAt)
  assert.equal(results[2].value.ref.externalId, GAMMA_HEAD)
  assert.deepEqual(results[3].value.ref, PR_REF, 'PR 的 ref 带平台 url')
  const planningPr = loadFixture().exchanges.flatMap((entry) => entry.body.data?.node?.items?.nodes ?? []).map((node) => node.content).find((content) => content?.__typename === 'PullRequest')
  assert.equal(results[3].value.ref.externalId, planningPr.id, 'PR 的 externalId 与规划 provider 对同一 PR 给出的内容 id 逐字相同')
  assert.deepEqual(results[3].value, results[4].value.items[0], 'get 与 list 透出逐字段相同的事实')
})

test('review-state-projection（合成）：三种平台结论原样投影，null 与未知枚举为 unknown；状态小写投影', async () => {
  const decisions = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', null, 'DISMISSED_IN_FUTURE']
  const nodes = decisions.map((reviewDecision, index) => prNode(`PR_review_${index}`, { reviewDecision, state: ['OPEN', 'CLOSED', 'MERGED'][index % 3] }))
  const provider = scripted((request) => (request.operationName === 'DevelopmentChangeRequest'
    ? ok({ repository: { id: 'R_synthetic' }, node: { __typename: 'PullRequest', ...nodes[0], repository: { id: 'R_synthetic' } } }) : prPage(nodes)))
  const listed = await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 10 })
  assert.deepEqual(listed.value.items.map((item) => item.reviewState), ['approved', 'changes_requested', 'review_required', 'unknown', 'unknown'])
  assert.deepEqual(listed.value.items.map((item) => item.state), ['open', 'closed', 'merged', 'open', 'closed'])
  assert.equal((await provider.getChangeRequest({ ...PR_REF, externalId: 'PR_review_0' })).value.reviewState, 'approved')
})

test('change-request-membership（合成）：别的仓库的 PR、不是 PR 的 node 与 null node 都是 not_found', async () => {
  const node = (overrides) => ({ __typename: 'PullRequest', ...PR_NODE, repository: { id: 'R_here' }, ...overrides })
  const read = (found) => scripted(() => ok({ repository: { id: 'R_here' }, node: found })).getChangeRequest(PR_REF)
  assert.equal((await read(node({}))).ok, true, '同一仓库的 PR 读得到（对照）')
  for (const [what, found] of [['别的仓库的 PR', node({ repository: { id: 'R_elsewhere' } })], ['不是 PR 的 node', { __typename: 'Issue' }], ['node 为 null', null]]) {
    const result = await read(found)
    assert.equal(result.ok, false, what)
    assert.equal(result.error.code, 'not_found', what)
  }
})

test('input-gates-zero-requests：坏输入在 transport 之前结构化拒绝', async () => {
  const provider = scripted(() => { throw new Error('闸门之后才可能发请求') })
  const refused = []
  const expectRefused = (result, code) => { refused.push(result); assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(result.error.retryable, false) }
  for (const repository of [{ ...repositoryRef, bindingId: 'binding-foreign' }, { ...repositoryRef, objectKind: 'branch' }, { ...repositoryRef, externalId: 'repo-other' }]) {
    expectRefused(await provider.getRepository(repository), 'not_found')
    expectRefused(await provider.listBranches({ repository, cursor: undefined, limit: 10 }), 'not_found')
    expectRefused(await provider.listChangeRequests({ repository, cursor: undefined, limit: 10 }), 'not_found')
  }
  for (const limit of [0, -1, 1.5, '10']) {
    expectRefused(await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit }), 'invalid_input')
    expectRefused(await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit }), 'invalid_input')
  }
  for (const cursor of ['', 42]) {
    expectRefused(await provider.listBranches({ repository: repositoryRef, cursor, limit: 10 }), 'invalid_input')
    expectRefused(await provider.listChangeRequests({ repository: repositoryRef, cursor, limit: 10 }), 'invalid_input')
  }
  for (const headBranch of ['', 7]) expectRefused(await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 10, headBranch }), 'invalid_input')
  for (const sha of ['abc123', GAMMA_HEAD.toUpperCase(), `${GAMMA_HEAD}a`, `g${GAMMA_HEAD}`]) expectRefused(await provider.getCommit(commitRef(sha)), 'invalid_input')
  for (const overrides of [{ bindingId: 'binding-foreign' }, { objectKind: 'branch' }]) expectRefused(await provider.getCommit({ ...commitRef(GAMMA_HEAD), ...overrides }), 'not_found')
  expectRefused(await provider.getChangeRequest({ ...PR_REF, externalId: '' }), 'invalid_input')
  expectRefused(await provider.getChangeRequest({ ...PR_REF, objectKind: 'issue' }), 'not_found')
  assert.equal(refused.length, 31)
  assert.deepEqual(ledgers.get(provider), [], '坏输入一律在闸门拒绝，transport 调用次数为 0')
})

test('filter-before-pagination（合成）：命中之前与之间夹着 fork 同名 PR 时，limit 1 / 2 逐页读到的页都非空、拼接恰为全部命中、游标单调终止', async () => {
  const branch = 'work/e1-pages'
  const [fork, hit] = [(index) => prNode(`PR_fork_${index}`, { headRefName: branch, isCrossRepository: true }), (index) => prNode(`PR_hit_${index}`, { headRefName: branch })]
  const nodes = [fork(1), fork(2), hit(1), fork(3), hit(2), hit(3)]
  // 平台：headRefName 精确过滤但带出 fork（第 4 条），偏移游标 `C<偏移>`，严格遵守 first。
  const platform = ({ variables: { first, after } }) => {
    const offset = after === null ? 0 : Number(after.slice(1))
    return prPage(nodes.slice(offset, offset + first), { hasNextPage: offset + first < nodes.length, endCursor: `C${offset + first}` })
  }
  const requests = { 1: [[1, null], [1, 'C1'], [1, 'C2'], [1, 'C3'], [1, 'C4'], [1, 'C5']], 2: [[2, null], [2, 'C2'], [1, 'C4'], [2, 'C5']] }
  for (const limit of [1, 2]) {
    const provider = scripted(platform)
    const pages = []
    let cursor
    do {
      assert.ok(pages.length < nodes.length, `limit ${limit}：游标必须在 ${nodes.length} 页之内结束`)
      const page = await provider.listChangeRequests({ repository: repositoryRef, headBranch: branch, cursor, limit })
      pages.push(page.value.items.map((item) => item.ref.externalId))
      cursor = page.value.nextCursor
    } while (cursor !== undefined)
    assert.ok(pages.every((page) => page.length >= 1 && page.length <= limit), `limit ${limit}：每页都有命中且不超过 limit，实际 ${JSON.stringify(pages)}`)
    assert.deepEqual(pages.flat(), ['PR_hit_1', 'PR_hit_2', 'PR_hit_3'], `limit ${limit}：拼接恰为全部命中，不跳过、不重复`)
    assert.deepEqual(ledgers.get(provider).map(({ variables }) => [variables.first, variables.after]), requests[limit], `limit ${limit}：每次只取还差的条数，游标是完整消费的平台页的 endCursor`)
  }
  // 有界：fork 同名 PR 无穷无尽时一次调用至多 100 个平台请求，交出空页与最后的游标；游标成环、平台多给行都是形状错误。
  const endless = scripted(() => prPage([fork(0)], { hasNextPage: true, endCursor: `C${ledgers.get(endless).length}` }))
  const bounded = await endless.listChangeRequests({ repository: repositoryRef, headBranch: branch, cursor: undefined, limit: 1 })
  assert.deepEqual([bounded.value.items, bounded.value.nextCursor, ledgers.get(endless).length], [[], 'C100', 100])
  const cycle = scripted(({ variables: { after } }) => prPage([fork(0)], { hasNextPage: true, endCursor: { null: 'C1', C1: 'C2', C2: 'C1' }[after] }))
  const generous = scripted(() => prPage([hit(1), hit(2)]))
  // 续取页只差 1 条（first 1）却回 2 行：多给行要和「还差的条数」比，不是和 size 比。
  const generousLater = scripted(({ variables: { after } }) => (after === null ? prPage([hit(1), fork(1)], { hasNextPage: true, endCursor: 'C2' }) : prPage([hit(2), hit(3)])))
  for (const [what, provider, requestCount, limit] of [['游标成环', cycle, 3, 1], ['平台多给行', generous, 1, 1], ['续取页多给行', generousLater, 2, 2]]) {
    const result = await provider.listChangeRequests({ repository: repositoryRef, headBranch: branch, cursor: undefined, limit })
    assert.deepEqual([what, result.error?.rawClass, ledgers.get(provider).length], [what, 'malformed_response', requestCount])
  }
  // 页大小钳到 100：limit 101 时第一页凑满 100 个命中就交出，不为第 101 个再发请求。
  const plenty = scripted(({ variables: { first, after } }) => { const offset = after === null ? 0 : Number(after.slice(1)); return prPage(Array.from({ length: first }, (_, index) => hit(offset + index)), { hasNextPage: true, endCursor: `C${offset + first}` }) })
  const clamped = await plenty.listChangeRequests({ repository: repositoryRef, headBranch: branch, cursor: undefined, limit: 101 })
  assert.deepEqual([clamped.value.items.length, clamped.value.nextCursor, ledgers.get(plenty).map(({ variables }) => [variables.first, variables.after])], [100, 'C100', [[100, null]]])
})

test('malformed-shapes（合成）：任何形状不符整次 unavailable，不做过滤坏行后成功', async () => {
  const broken = [['isCrossRepository 缺失', { isCrossRepository: undefined }], ['headRefOid 不是 40 位小写十六进制', { headRefOid: 'ABC' }], ['number 不是正整数', { number: 0 }], ['title 不是字符串', { title: null }], ['body 是 null', { body: null }]]
  const results = []
  for (const [what, overrides] of broken) {
    const provider = scripted(() => prPage([prNode('PR_good'), prNode('PR_bad', overrides)]))
    results.push([what, await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 10 })])
  }
  results.push(['分支头不是 sha', await scripted(() => branchPage([{ name: 'main', target: { oid: 'xyz' } }], { hasNextPage: false, endCursor: null })).listBranches({ repository: repositoryRef, cursor: undefined, limit: 10 })],
    ['没有 data', await scripted(() => ({ status: 200, headers: {}, body: {} })).getRepository(repositoryRef)],
    ['正文不是对象', await scripted(() => ({ status: 200, headers: {}, body: 'not json' })).getChangeRequest(PR_REF)])
  for (const [what, result] of results) assert.deepEqual([what, result.ok, result.error?.code, result.error?.rawClass, result.error?.retryable], [what, false, 'unavailable', 'malformed_response', true])
})

test('constructor：宿主编程错误在构造期抛 TypeError，其余路径不抛错', () => {
  const good = { bindingId, repository: { externalId: LOCAL_REPOSITORY_KEY, owner: OWNER, name: NAME }, transport: async () => denied }
  for (const options of [{ ...good, repository: { ...good.repository, externalId: '' } }, { ...good, repository: { ...good.repository, owner: 7 } },
    { ...good, repository: { ...good.repository, name: undefined } }, { ...good, repository: undefined }, { ...good, transport: undefined }]) {
    assert.throws(() => createGithubDevelopmentProvider(options), TypeError)
  }
  assert.doesNotThrow(() => createGithubDevelopmentProvider(good))
})

test('cursor-stall（合成）：hasNextPage 为真而游标缺失或不前进时整页 unavailable', async () => {
  const stalls = [[undefined, { hasNextPage: true, endCursor: null }], [undefined, { hasNextPage: true, endCursor: '' }], ['C1', { hasNextPage: true, endCursor: 'C1' }], [undefined, { hasNextPage: 'yes', endCursor: 'C1' }]]
  for (const [cursor, pageInfo] of stalls) {
    const branches = await scripted(() => branchPage([], pageInfo)).listBranches({ repository: repositoryRef, cursor, limit: 10 })
    const changeRequests = await scripted(() => prPage([], pageInfo)).listChangeRequests({ repository: repositoryRef, cursor, limit: 10 })
    for (const result of [branches, changeRequests]) {
      assert.equal(result.ok, false, JSON.stringify(pageInfo))
      assert.equal(result.error.code, 'unavailable')
      assert.equal(result.error.rawClass, 'malformed_response')
    }
  }
})

const READ_KEYS = ['development.repository.read', 'development.change_request.read']
const CANARY = 'canary-not-a-token-231'
const MESSAGES = { permission_denied: 'GitHub 拒绝了当前凭据的访问', not_found: 'GitHub 上找不到目标，或对当前凭据不可见' }
const readAll = async (provider) => [await provider.getRepository(repositoryRef), await provider.listBranches({ repository: repositoryRef, cursor: undefined, limit: 10 }),
  await provider.getCommit(commitRef(GAMMA_HEAD)), await provider.getChangeRequest(PR_REF), await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 10 })]
const accessOf = async (provider) => Object.fromEntries(effectiveCapabilities(await provider.describeCapabilities()).map(({ key, access }) => [key, access]))
const bothAre = (level) => ({ [READ_KEYS[0]]: level, [READ_KEYS[1]]: level })

test('permission-loss-degrades（录制 + 合成）：失去读权限时快照降级、五个读方法结构化失败、恢复后回到可用', async () => {
  const invisible = replayProvider({ externalId: LOCAL_REPOSITORY_KEY, owner: OWNER, name: ABSENT_NAME })
  const lost = await invisible.getRepository(repositoryRef)
  assert.deepEqual([lost.ok, lost.error.code, lost.error.retryable], [false, 'not_found', false], '录制的「仓库不可见」回答')
  const snapshot = await invisible.describeCapabilities()
  assert.deepEqual(snapshot.capability, bothAre('available'), '只声明两个读 key，不声明 review.read 与任何写 key')
  assert.deepEqual(snapshot.permission, bothAre('degraded'))
  assert.deepEqual(await accessOf(invisible), bothAre('degraded'))

  // 同一个实例、可切换的 transport：撤权与恢复都发生在同一次组合之后，快照不缓存。
  const replayed = replayTransport()
  let serve = replayed
  const provider = build((request) => serve(request))
  assert.deepEqual(await accessOf(provider), bothAre('available'))
  const errors = (type) => ({ status: 200, headers: {}, body: { data: type === 'NOT_FOUND' ? { repository: null } : null, errors: [{ type, message: CANARY }] } })
  const faults = [['401', 'permission_denied', { status: 401, headers: {}, body: { message: CANARY } }], ['403（无限流证据）', 'permission_denied', { status: 403, headers: {}, body: { message: CANARY } }],
    ['FORBIDDEN', 'permission_denied', errors('FORBIDDEN')], ['INSUFFICIENT_SCOPES', 'permission_denied', errors('INSUFFICIENT_SCOPES')], ['NOT_FOUND', 'not_found', errors('NOT_FOUND')]]
  for (const [what, code, response] of faults) {
    serve = async () => response
    const results = await readAll(provider)
    for (const result of results) assert.deepEqual([what, result.ok, result.error.code, result.error.retryable, result.error.message], [what, false, code, false, MESSAGES[code]])
    assert.equal(JSON.stringify(results).includes(CANARY), false, `${what}：不回显平台正文`)
    assert.deepEqual(await accessOf(provider), bothAre('degraded'), what)
  }
  serve = replayed
  assert.deepEqual(await accessOf(provider), bothAre('available'), '权限恢复后同一实例再次描述即回到 available')

  // 控制组：限流与传输失败不被误读成权限，可重试；它们同样让快照降级（权限无法确认时不声称可用）。
  const limited = scripted(() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: CANARY } }))
  const thrown = scripted(() => { throw new Error(CANARY) })
  for (const [what, controlled, code, rawClass] of [['限流', limited, 'rate_limited', undefined], ['传输抛错', thrown, 'unavailable', 'transport_error']]) {
    const results = await readAll(controlled)
    for (const result of results) assert.deepEqual([what, result.ok, result.error.code, result.error.retryable, result.error.rawClass], [what, false, code, true, rawClass])
    assert.equal(JSON.stringify(results).includes(CANARY), false, `${what}：不回显平台正文或异常文本`)
    assert.deepEqual(await accessOf(controlled), bothAre('degraded'), what)
  }
  // requestId 只在形状匹配（整串）时保留，外层结果与错误对象都是：token 形态或夹带合法 id 的头值不得进入结果。
  const withRequestId = (value) => scripted(() => ({ status: 401, headers: { 'x-github-request-id': value }, body: {} })).getRepository(repositoryRef)
  const kept = await withRequestId(REQUEST_ID)
  assert.deepEqual([kept.requestId, kept.error.requestId], [REQUEST_ID, REQUEST_ID])
  for (const value of [CANARY, `${CANARY} ${REQUEST_ID}`]) assert.equal(JSON.stringify(await withRequestId(value)).includes(CANARY), false, value)
})

const reconcileAll = async (provider) => { const all = []; for await (const observation of provider.reconcile({ scopeKey: 'development', cursor: undefined })) all.push(observation); return all }

test('change-request-observations：reconcile 产出定宽规范 sourceVersion，不是 sha；全有或全无', async () => {
  const provider = replayProvider()
  const listed = (await provider.listChangeRequests({ repository: repositoryRef, cursor: undefined, limit: 100 })).value.items
  const observed = await reconcileAll(provider)
  assert.equal(observed.length, listed.length, '条数等于不过滤页的 PR 数')
  const [first] = observed
  assert.equal(first.type, 'development.change_request.observed')
  assert.deepEqual(first.subject, listed[0].ref)
  assert.equal(first.sourceVersion, sourceVersionFromTimestamp(PR_NODE.updatedAt))
  assert.ok(isComparableSourceVersion(first.sourceVersion) && first.sourceVersion.length === 30, 'R4 的定宽 30 字节规范载体')
  assert.notEqual(first.sourceVersion, PR_NODE.headRefOid, '变更请求的头部 sha 不得当作观察版本')
  assert.equal(first.eventTime, first.sourceVersion)
  assert.deepEqual(first.payload, { number: PR_NODE.number, state: 'open', title: PR_NODE.title, body: PR_NODE.body, headBranch: 'fixture/gamma', headCommit: GAMMA_HEAD, reviewState: 'unknown' })
  const again = await reconcileAll(provider)
  assert.deepEqual(again.map((entry) => entry.dedupeKey), observed.map((entry) => entry.dedupeKey), '重复读取的去重键逐条相同')
  assert.notEqual(again[0].receivedTime, first.receivedTime, '时钟递增：receivedTime 不属于去重键')

  // 全有或全无：离线、一页里有坏时间戳、第二页失败，三种情况一条都不产出，迭代也不抛错。
  const second = (page) => scripted((request) => (request.variables.after === null ? prPage([prNode('PR_one')], { hasNextPage: true, endCursor: 'C1' }) : page))
  const twoPages = await reconcileAll(second(prPage([prNode('PR_two', { number: 2 })])))
  assert.deepEqual(twoPages.map((entry) => entry.subject.externalId), ['PR_one', 'PR_two'], '对照：两页都成功时全部产出')
  assert.deepEqual(await reconcileAll(scripted(async () => { throw new Error('offline') })), [])
  assert.deepEqual(await reconcileAll(scripted(() => prPage([prNode('PR_good'), prNode('PR_bad', { updatedAt: '2026-13-01T00:00:00Z' })]))), [])
  assert.deepEqual(await reconcileAll(second({ status: 500, headers: {}, body: {} })), [], '第二页失败时不产出已读的第一页')
  // 扫描有界：游标永远前进也只读 100 页；页非空，所以「超限仍交出已读的行」会被看见。超限一条不产出。
  const endless = scripted(() => prPage([prNode(`PR_${ledgers.get(endless).length}`)], { hasNextPage: true, endCursor: `C${ledgers.get(endless).length}` }))
  assert.deepEqual(await reconcileAll(endless), [])
  assert.equal(ledgers.get(endless).length, 100)
  // 游标成环 C1 → C2 → C1：第三次请求即停。传输侧的上限只是防止回归时挂死，用例会因请求数不是 3 而红。
  const cycle = scripted((request) => {
    if (ledgers.get(cycle).length > 40) throw new Error('safety cap')
    return prPage([prNode(`PR_${ledgers.get(cycle).length}`)], { hasNextPage: true, endCursor: { null: 'C1', C1: 'C2', C2: 'C1' }[request.variables.after] })
  })
  assert.deepEqual(await reconcileAll(cycle), [])
  assert.equal(ledgers.get(cycle).length, 3)
  // fork 上同名分支的 PR 没有分支身份：观察 payload 里是 null，不是缺失。
  const [forked] = await reconcileAll(scripted(() => prPage([prNode('PR_fork', { isCrossRepository: true })])))
  assert.equal(forked.payload.headBranch, null)
})

test('classification-table：失败分类表逐行——状态、限流证据与换算、errors 各类型、部分成功、rawClass 净化', async () => {
  const NOW = Date.parse('2026-10-15T00:00:00Z')
  const data = { repository: { name: 'r', updatedAt: '2026-10-15T00:00:00Z', defaultBranchRef: null } }
  const reply = (status, headers = {}, body = { data }) => ({ status, headers, body })
  const withErrors = (errors, headers = {}) => reply(200, headers, { data, errors })
  const exhausted = (seconds) => ({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + seconds) })
  const rows = [ // [说明, 响应, code, retryable, rawClass, retryAfterMs]
    ['429', reply(429), 'rate_limited', true, undefined, undefined],
    ['429 + retry-after', reply(429, { 'retry-after': '7' }), 'rate_limited', true, undefined, 7000],
    ['429 + 超长 retry-after', reply(429, { 'retry-after': '9'.repeat(400) }), 'rate_limited', true, undefined, undefined],
    ['403 + retry-after', reply(403, { 'retry-after': '3' }), 'rate_limited', true, undefined, 3000],
    ['403 + secondary rate 文案', reply(403, {}, { message: 'You have exceeded a secondary rate limit.' }), 'rate_limited', true, undefined, undefined],
    ['403 + 额度耗尽，reset 在 30 秒后', reply(403, exhausted(30)), 'rate_limited', true, undefined, 30000],
    ['403 + 额度耗尽，reset 已过', reply(403, exhausted(-5)), 'rate_limited', true, undefined, 0],
    ['errors RATE_LIMITED', withErrors([{ type: 'RATE_LIMITED' }]), 'rate_limited', true, undefined, undefined],
    ['errors 里的 secondary rate 文案', withErrors([{ type: 'OTHER', message: 'a secondary rate limit' }]), 'rate_limited', true, undefined, undefined],
    ['errors + 额度耗尽头', withErrors([{ type: 'OTHER' }], exhausted(30)), 'rate_limited', true, undefined, 30000],
    ['500，正文看似有效', reply(500), 'unavailable', true, 'http_500', undefined],
    ['status 不是整数', reply('200'), 'unavailable', true, 'malformed_response', undefined],
    ['有效 data + 其他 errors：不做部分成功', withErrors([{ type: 'SERVICE_UNAVAILABLE' }]), 'unavailable', true, 'graphql_SERVICE_UNAVAILABLE', undefined],
    ['errors.type 带响应文本：rawClass 被净化', withErrors([{ type: CANARY, message: CANARY }]), 'unavailable', true, 'graphql_error', undefined],
  ]
  for (const [what, response, ...expected] of rows) {
    const result = await scripted(() => response, undefined, () => NOW).getRepository(repositoryRef)
    assert.deepEqual([what, result.ok, result.error?.code, result.error?.retryable, result.error?.rawClass, result.error?.retryAfterMs], [what, false, ...expected])
    assert.equal(JSON.stringify(result).includes(CANARY), false, `${what}：不回显响应文本`)
  }
})

test('definition-and-snapshot：导出定义与快照的 bindingId、observedAt 被钉住（宿主目录条目依赖 implementationKey）', async () => {
  assert.deepEqual(GITHUB_DEVELOPMENT_DEFINITION, { implementationKey: 'development.github', domains: ['development'] })
  const provider = replayProvider(undefined, () => Date.parse('2026-10-15T08:00:00Z'))
  assert.equal(provider.definition, GITHUB_DEVELOPMENT_DEFINITION)
  const snapshot = await provider.describeCapabilities()
  assert.deepEqual([snapshot.bindingId, snapshot.observedAt], [bindingId, '2026-10-15T08:00:00.000Z'])
})

test('projection-pins：录制的未知提交、空仓库、空提交说明与非 Commit 对象', async () => {
  const unknown = await replayProvider().getCommit(commitRef('0'.repeat(40)))
  assert.deepEqual([unknown.ok, unknown.error.code, unknown.error.retryable], [false, 'not_found', false], '录制的全零提交')
  const commit = (object) => scripted(() => ok({ repository: { object } })).getCommit(commitRef(GAMMA_HEAD))
  assert.equal((await commit({ __typename: 'Commit', oid: GAMMA_HEAD, messageHeadline: '' })).value.message, undefined)
  assert.equal((await commit({ __typename: 'Tree' })).error.code, 'not_found')
  const empty = await scripted(() => ok({ repository: { name: 'empty', updatedAt: '2026-10-15T00:00:00Z', defaultBranchRef: null } })).getRepository(repositoryRef)
  assert.deepEqual([empty.ok, empty.value?.defaultBranch], [true, undefined], '空仓库没有默认分支，不是形状错误')
})

test('provenance：夹具里的平台 node id 都已在沙箱定义登记，没有手工篡改', () => {
  const sandboxDoc = readFileSync(new URL('../../docs/architecture/gate-e1-sandbox.md', import.meta.url), 'utf8')
  const text = readFileSync(new URL('./fixtures/github-development/sandbox.json', import.meta.url), 'utf8')
  assert.equal(fixture.provenance.repository, '$E1_OWNER/$E1_REPO', 'provenance 只写变量名，不写仓库地址')
  const tokens = new Set(text.match(/[A-Za-z0-9_-]+/g).filter((token) => token.length >= 10 && /^(R_kg|PR_kw|I_kw|PVT|DI_)/.test(token)))
  assert.ok(tokens.has(REPOSITORY_NODE_ID) && tokens.has(PR_NODE.id), `仓库与 PR 的 node id 都应出现在夹具里：只找到 ${[...tokens]}`)
  assert.deepEqual([...tokens].filter((token) => !sandboxDoc.includes(token)), [], '夹具里出现了沙箱定义里没有登记的 id')
})

test('query-drift：夹具记录的查询哈希等于当前查询文本，查询不取个人字段', () => {
  const sha256 = (text) => createHash('sha256').update(text).digest('hex')
  assert.deepEqual(fixture.provenance.queryHashes, Object.fromEntries(Object.entries(DEVELOPMENT_QUERIES).map(([name, text]) => [name, sha256(text)])),
    '查询文本变了，必须按 ExecPlan 的录制程序重录夹具')
  const all = Object.values(DEVELOPMENT_QUERIES).join('\n')
  assert.doesNotMatch(all, /creator|assignees|login|author|email/i)
  assert.doesNotMatch(all, /\bsearch\s*\(|\bmutation\b/i)
})

test('replay-ledger：本文件所有回放都没有未命中的请求', () => {
  assert.ok(replays.length > 0, '至少有一个回放，否则「没有未命中」是空话')
  assert.deepEqual(replays.flatMap((replay) => replay.misses), [])
})
