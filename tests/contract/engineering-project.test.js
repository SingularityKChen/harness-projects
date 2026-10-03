// 全域 reconcile 的行为契约：只经唯一 writer 的 `main`，注入 fetch。
// 「世界」按 GitHub 的形态答对 Project 页、写前复读与 mutation，并真实改写字段，使写后再读看到写后状态。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

import { runEngineeringDriftCheck } from '../../scripts/check-engineering-drift-live.mjs'
import { main } from '../../scripts/reconcile-engineering-project.mjs'
import { STATES } from '../../scripts/sync-engineering-state.mjs'

const REPO = 'SingularityKChen/harness-projects'
const ENV = { PROJECTS_TOKEN: 'not-a-real-token', ENGINEERING_FIELD_ID: 'PVTF_engineering', GITHUB_REPOSITORY: REPO, RECONCILE_ID: '77-1' }
const OPTIONS = STATES.map((name, index) => ({ id: `option-${index}`, name }))
const pr = (number, over = {}) => ({
  id: `PR_${number}`, number, repository: { nameWithOwner: REPO }, state: 'OPEN', merged: false, isDraft: false,
  reviewDecision: null, createdAt: '2026-09-30T00:00:00Z', ...over,
})
const MERGED = { state: 'MERGED', merged: true }
const connection = (nodes) => ({ totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes })
const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) })

/** issues: { [number]: { engineering, refs } }；hooks 可在复读前改写世界、改写 ack、或让任何 mutation 立即失败。 */
function makeWorld(issues, hooks = {}) {
  const world = { issues, hooks, mutations: [], queries: [] }
  const nodeOf = (issue) => ({
    id: `item-${issue}`,
    content: {
      __typename: 'Issue', id: `I_${issue}`, number: Number(issue), repository: { nameWithOwner: REPO },
      closedByPullRequestsReferences: connection(issues[issue].refs),
    },
    fieldValueByName: issues[issue].engineering === null ? null : { name: issues[issue].engineering, field: { id: 'PVTF_engineering' } },
  })
  world.fetchImpl = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body)
    world.queries.push(query)
    if (query.includes('node(id:$fieldId)')) {
      return ok({
        user: { projectV2: { id: 'PVT_project' } },
        node: { id: 'PVTF_engineering', name: 'Engineering', dataType: 'SINGLE_SELECT', project: { id: 'PVT_project' }, options: OPTIONS },
      })
    }
    if (query.includes('archivedStates')) {
      return ok({ user: { projectV2: { id: 'PVT_project', items: connection(Object.keys(issues).map(nodeOf)) } } })
    }
    const issue = String(variables.itemId).slice(5)
    if (query.includes('node(id:$itemId)')) {
      world.hooks.onFresh?.(variables.itemId, issues)
      return ok({ node: issues[issue] ? { ...nodeOf(issue), project: { id: 'PVT_project' } } : null })
    }
    const clear = query.includes('clearProjectV2ItemFieldValue')
    const value = clear ? null : OPTIONS.find((option) => option.id === variables.optionId).name
    const { itemId, clientMutationId, projectId, fieldId } = variables
    world.mutations.push({ itemId, clientMutationId, value, target: `${projectId}/${fieldId}` })
    if (world.hooks.readOnly) throw new Error('只读运行不得发送 mutation')
    // 写侧的不变量 3：只写已校验的 Engineering 字段。clear 路径不校验 option，写错字段不会被 API 拒绝。
    if (projectId !== 'PVT_project' || fieldId !== 'PVTF_engineering') throw new Error(`写入目标不是已校验的 Engineering 字段：${projectId}/${fieldId}`)
    issues[issue].engineering = value
    const ackId = world.hooks.onMutation?.(variables.itemId) ?? variables.itemId
    return ok({ [clear ? 'clearProjectV2ItemFieldValue' : 'updateProjectV2ItemFieldValue']: { clientMutationId: variables.clientMutationId, projectV2Item: { id: ackId } } })
  }
  return world
}

async function run(world, argv = ['node', 'script'], env = ENV) {
  const lines = []
  const exitCode = await main({ env, argv, fetchImpl: world.fetchImpl, log: (line) => lines.push(line) })
  return { exitCode, logs: lines.join('\n') }
}

const engineeringOf = (world) => Object.fromEntries(Object.entries(world.issues).map(([issue, value]) => [issue, value.engineering]))
const STALE = () => ({
  34: { engineering: null, refs: [pr(200)] },
  35: { engineering: null, refs: [pr(201, { reviewDecision: 'APPROVED' })] },
  36: { engineering: 'PR open', refs: [pr(150, { state: 'CLOSED' })] },
})

test('A running、B 被取消、C 幸存：C 的运行修复 B 与 C 各自 issue 的全部差异，之后观察者无漂移', async () => {
  const world = makeWorld({
    ...STALE(), // 34 是 B 的目标（其事件被取消），35 是 C 的目标，36 的旧值已不符且没有任何事件
    37: { engineering: null, refs: [pr(151, MERGED), pr(202)] }, // 已合并优先于后开的 open
    38: { engineering: 'Merged', refs: [] }, // 最后一个关闭关联被移除
    39: { engineering: 'Approved', refs: [pr(203, { reviewDecision: 'APPROVED' })] }, // 已正确，不得多写
  })
  const { exitCode, logs } = await run(world)

  assert.equal(world.issues[34].engineering, 'PR open', 'B 的 issue 必须被 C 的运行修复')
  assert.equal(exitCode, 0, logs)
  assert.deepEqual(engineeringOf(world), { 34: 'PR open', 35: 'Approved', 36: null, 37: 'Merged', 38: null, 39: 'Approved' })
  assert.deepEqual(world.mutations.map((mutation) => mutation.itemId), ['item-34', 'item-35', 'item-36', 'item-37', 'item-38'])
  assert.deepEqual([...new Set(world.mutations.map((mutation) => mutation.target))], ['PVT_project/PVTF_engineering'])
  assert.equal(world.mutations[0].clientMutationId, '77-1:item-34')
  // 旧值来自写前复读：首次全域写之后，只有运行日志记得改掉了什么。
  assert.match(logs, /confirmed #38: Engineering=cleared; was=Merged; 依据 完整零引用（规则 unreferenced）/)
  assert.match(logs, /confirmed #34: Engineering=PR open; was=empty; 依据 PR #200/)
  assert.equal(world.queries.some((query) => /Status|fieldValues\b/.test(query)), false)

  const observer = await runEngineeringDriftCheck({
    env: { ...ENV, PROJECT_OWNER: 'SingularityKChen', PROJECT_NUMBER: '10' }, fetchImpl: world.fetchImpl, write: () => {}, argv: [],
  })
  assert.equal(observer, 0, '写者收敛后观察者读同一世界必须无漂移')
})

test('最后一个 hint 被取消：独立 schedule 准入不携 PR、不经 signal；PR 事件的非法号仍 fail closed', () => {
  const source = readFileSync(fileURLToPath(new URL('../../.github/workflows/engineering-state.yml', import.meta.url)), 'utf8')
  const workflow = parseYaml(source)
  const classify = workflow.jobs.sync.steps.find((step) => step.id === 'signal')
  const dir = mkdtempSync(join(tmpdir(), 'engineering-classify-'))
  const classified = (env) => {
    writeFileSync(join(dir, 'out'), '')
    const { status } = spawnSync('bash', ['-c', classify.run], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: join(dir, 'out'), ...env }, stdio: 'ignore' })
    return [status, readFileSync(join(dir, 'out'), 'utf8')]
  }
  assert.deepEqual(classified({ EVENT_NAME: 'schedule' }), [0, 'decision=reconcile\n'])
  assert.deepEqual(classified({ EVENT_NAME: 'pull_request_target', TARGET_PR_NUMBER: '37' }), [0, 'decision=reconcile\n'])
  assert.deepEqual(classified({ EVENT_NAME: 'pull_request_target', TARGET_PR_NUMBER: '' }), [1, ''])
  assert.deepEqual(workflow.on.schedule, [{ cron: '17,47 * * * *' }])
})

test('写前新鲜复读：初读后源变了就按新的 expected 写，已被别处写对的项不再多写', async () => {
  const world = makeWorld(
    { 34: STALE()[34], 35: STALE()[35] },
    {
      onFresh: (itemId, issues) => {
        if (itemId === 'item-34') {
          issues[34].refs = [pr(200, MERGED)] // 初读之后 B 被合并
          issues[34].engineering = 'Changes requested' // 初读时为空：was= 必须取复读值，而不是初读快照
        }
        if (itemId === 'item-35') issues[35].engineering = 'Approved' // 初读之后别处已写对
      },
    },
  )
  const { exitCode, logs } = await run(world)

  assert.equal(exitCode, 0, logs)
  assert.deepEqual(world.mutations.map(({ itemId, value }) => [itemId, value]), [['item-34', 'Merged']])
  assert.match(logs, /confirmed #34: Engineering=Merged; was=Changes requested;/)
  assert.match(logs, /unchanged=\[#35\]/)
})

test('复读时 item 已移出 Project：停止本轮，已写的保留 confirmed，其余如实记 unread/remaining', async () => {
  const world = makeWorld(STALE(), { onFresh: (itemId, issues) => { if (itemId === 'item-35') delete issues[35] } })
  const { exitCode, logs } = await run(world)

  assert.equal(exitCode, 1)
  assert.deepEqual(world.mutations.map((mutation) => mutation.itemId), ['item-34'])
  assert.match(logs, /已不在目标 project/)
  assert.match(logs, /confirmed=\[#34\] unchanged=\[\] unknown=\[\] unread=\[#35\] remaining=\[#36\]/)
})

test('第 2 项 ack 不匹配：仅第 1 项 confirmed，第 2 项 unknown，第 3 项 remaining；复跑只修仍有差异的项', async () => {
  const world = makeWorld(STALE(), { onMutation: (itemId) => (itemId === 'item-35' ? 'wrong-item' : undefined) })
  const failed = await run(world)

  assert.equal(failed.exitCode, 1)
  assert.deepEqual(world.mutations.map((mutation) => mutation.itemId), ['item-34', 'item-35'])
  assert.match(failed.logs, /confirmed=\[#34\] unchanged=\[\] unknown=\[#35\] unread=\[\] remaining=\[#36\]/)
  assert.doesNotMatch(failed.logs, /confirmed #35/)

  world.hooks.onMutation = undefined
  world.mutations.length = 0
  const rerun = await run(world)
  assert.equal(rerun.exitCode, 0, rerun.logs)
  assert.deepEqual(world.mutations.map((mutation) => mutation.itemId), ['item-36'])
  assert.deepEqual(engineeringOf(world), { 34: 'PR open', 35: 'Approved', 36: null })
})

test('整批预读：后项的未知枚举在任何 mutation 之前使本轮失败', async () => {
  const world = makeWorld({ ...STALE(), 37: { engineering: null, refs: [pr(204, { state: 'DRAFT' })] } })
  const { exitCode, logs } = await run(world)

  assert.equal(exitCode, 1)
  assert.deepEqual(world.mutations, [])
  assert.match(logs, /PR #204 的快照无法投影：未知 PR state/)
})

test('--dry-run 只读：零 mutation，仍报告差异数与读取成本', async () => {
  const world = makeWorld(STALE(), { readOnly: true })
  const { exitCode, logs } = await run(world, ['node', 'script', '--dry-run'], { ...ENV, RECONCILE_ID: undefined })

  assert.equal(world.mutations.length, 0, 'dry-run 不得发送任何 mutation')
  assert.equal(exitCode, 0, logs)
  assert.match(logs, /dry-run=true queries=\d+ pages=1 referenceEdges=3 changed=3/)
})

test('argv 只接受 --dry-run，缺凭据或字段 ID 也在任何请求之前被拒', async () => {
  for (const argv of [['node', 'script', '200'], ['node', 'script', '--force'], ['node', 'script', '--dry-run', '--dry-run']]) {
    const world = makeWorld(STALE())
    assert.equal((await run(world, argv)).exitCode, 1, argv.join(' '))
    assert.equal(world.queries.length, 0)
  }
  for (const key of ['PROJECTS_TOKEN', 'ENGINEERING_FIELD_ID', 'RECONCILE_ID']) {
    const world = makeWorld(STALE())
    assert.equal((await run(world, undefined, { ...ENV, [key]: '' })).exitCode, 1, key)
    assert.equal(world.queries.length, 0)
  }
})

test('CLI 入口真的执行 main，失败映射为非零退出码（无网络：缺字段 ID 在任何请求前失败）', () => {
  const script = fileURLToPath(new URL('../../scripts/reconcile-engineering-project.mjs', import.meta.url))
  const { status, stdout } = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: 'utf8' })

  assert.equal(status, 1)
  assert.match(stdout, /::error::未配置 ENGINEERING_FIELD_ID[\s\S]*reconcile 结果：/)
})
