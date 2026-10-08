/**
 * Batch C3 端到端：Start Work 补偿序列（issue #77 / ExecPlan D4）。全部使用离线替身：无凭据、无网络。
 * 用例名说明它保护哪条不变量：不合法输入不落上下文、git 失败不启动执行、执行失败降级而不丢上下文、
 * 重复开始幂等、重启后仍可恢复（tests/README §2.3、§2.5）。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CapabilityKey } from '@harness-projects/capabilities'
import { AccessLevel, ExecutionContextStatus, WriteState, newWorkspaceId } from '@harness-projects/domain'
import { composeCore, contextIdFor } from '@harness-projects/core'
import {
  FaultKind, createFakeDevelopmentProvider, createFakeProviders, createFakeStorage, exportFakeStorageState, refOf,
} from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const WORKSPACE = { id: newWorkspaceId(), name: 'MVP-0' }
const REPOSITORY = 'repo-alpha'
const REQUEST = { repositoryId: REPOSITORY, actor: { kind: 'agent' } }

const compose = (providers, storage) =>
  composeCore(storage === undefined ? { workspace: WORKSPACE, providers } : { workspace: WORKSPACE, providers, storage })

async function workItemIdOf(core) {
  const item = (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item') // redacted 条目的 kind 也是 work_item（issue-3），但没有可操作的规划条目，不能当开始工作的对象
  assert.ok(item, 'planning 种子里必须至少有一个工作项')
  return item.entityId
}

test('开始工作：工作项或仓库形状不合法时不产生任何执行上下文（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const result = await core.commands.startWork({ ...REQUEST, workItemId: '   ', idempotencyKey: 'invalid-1' })
  assert.equal(result.executionContextId, undefined, '不合法输入不得产出执行上下文 id')
  assert.equal(result.writeState, WriteState.Failed)
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(exportFakeStorageState(providers.storage).contexts.length, 0, '不得写入任何执行上下文')
  assert.equal(await core.queries.getExecutionContext({ workItemId: '   ', repositoryId: REPOSITORY }), undefined)
})

test('工作树冲突：按幂等已存在资源复用且不覆盖工作树（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  const bindingId = providers.development.gate.bindingId
  const path = '.worktrees/c3-occupied'
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  // 预置同路径工作树：createWorktree 必须 conflict 而不是静默覆盖（脏工作树不自动清理的机械证据）。
  providers.development.state.worktrees.push({
    repository: refOf(bindingId, 'repository', REPOSITORY), ref: refOf(bindingId, 'worktree', path), path,
    branch: `work/${workItemId}`,
  })
  const runsBefore = providers.execution.state.runs.length
  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'git-fail-1', worktreePath: path })
  assert.equal(result.status, ExecutionContextStatus.Ready)
  assert.equal(result.writeState, WriteState.Saved)
  assert.equal(result.confirmed, true)
  assert.equal(result.error, undefined)
  assert.equal(result.worktreeExternalId, path)
  assert.equal(result.branchExternalId, `work/${workItemId}`, '已建分支仍要记录在上下文里')
  assert.equal(providers.execution.state.runs.length, runsBefore + 1, '复用工作树后应启动一次执行')
  assert.equal(providers.development.state.worktrees.length, 1, '既有工作树必须原样保留')
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.equal(view.status, ExecutionContextStatus.Ready)
})

test('执行启动失败：上下文与工作树/分支保留并降级 manual_fallback（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  providers.execution.faultsSwitch.set(FaultKind.HarnessFailure, true)
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const runsBefore = providers.execution.state.runs.length
  const result = await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'run-fail-1' })
  assert.equal(result.fallback, 'manual_fallback')
  assert.equal(result.degraded, true)
  assert.equal(result.error?.code, 'unavailable', '主执行启动失败的原因如实带回，不被降级吞掉')
  assert.equal(result.confirmed, true, 'git 写入已拿到 provider ack，此时 Saved 才被允许')
  assert.ok(result.worktreeExternalId !== undefined && result.branchExternalId !== undefined, '工作树与分支必须仍在')
  assert.equal(providers.execution.state.runs.length, runsBefore, '启动失败不得在 provider 侧产生运行')
  const view = await core.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.equal(view.status, ExecutionContextStatus.Ready)
  assert.equal(view.worktreeExternalId, result.worktreeExternalId)
  assert.equal(view.branchExternalId, result.branchExternalId)
  assert.equal(view.fallback, 'manual_fallback', '重查后仍要看到降级')
})

test('重复开始：同一工作项 + 仓库返回既有上下文，不产生第二份工作树或分支（ExecPlan D4）', async () => {
  const providers = createFakeProviders()
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const request = { ...REQUEST, workItemId }
  const first = await core.commands.startWork({ ...request, idempotencyKey: 'dup-1' })
  const branches = providers.development.state.branches.length
  const worktrees = providers.development.state.worktrees.length
  assert.equal(first.writeState, WriteState.Saved)
  assert.equal(first.confirmed, true)
  const second = await core.commands.startWork({ ...request, idempotencyKey: 'dup-2' })
  assert.equal(second.executionContextId, first.executionContextId, '重复开始必须复用同一个上下文 id')
  assert.equal(providers.development.state.branches.length, branches, '不得产生第二个分支')
  assert.equal(providers.development.state.worktrees.length, worktrees, '不得产生第二份工作树')
  const replay = await core.commands.startWork({ ...request, idempotencyKey: 'dup-1' })
  assert.equal(replay.executionContextId, first.executionContextId, '同键重放必须返回原结果')
  assert.equal(replay.writeState, first.writeState)
})

/** 挂起第一个事务，并给「事务必须在 2 秒内开始」一个清晰断言（否则注入非事务实现时只会挂住 CI）。 */
function pauseFirstTransaction(storage) {
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const original = storage.transaction.bind(storage)
  let calls = 0
  storage.transaction = async (work) => {
    if ((calls += 1) === 1) { entered.resolve(); await release.promise }
    return original(work)
  }
  const started = Promise.race([
    entered.promise.then(() => true),
    new Promise((resolve) => { setTimeout(() => resolve(false), 2000) }),
  ])
  return { release, entered: started.then((ok) => assert.ok(ok, '认领必须在存储事务内完成（2 秒内未开始事务）')) }
}

test('并发开始：认领事务交错时只供应一次（ExecPlan D1）', async () => {
  const providers = createFakeProviders()
  const branchesBefore = providers.development.state.branches.length
  const runsBefore = providers.execution.state.runs.length
  const contextsBefore = exportFakeStorageState(providers.storage).contexts.length
  const core = await compose(providers)
  const workItemId = await workItemIdOf(core)
  const gate = pauseFirstTransaction(providers.storage)
  const request = { ...REQUEST, workItemId }
  const firstPromise = core.commands.startWork({ ...request, idempotencyKey: 'race-1' })
  await gate.entered
  const secondPromise = core.commands.startWork({ ...request, idempotencyKey: 'race-2' })
  gate.release.resolve()
  const [first, second] = await Promise.all([firstPromise, secondPromise])
  const state = exportFakeStorageState(providers.storage)
  assert.equal(state.contexts.length, contextsBefore + 1, '并发调用只能留下一个上下文')
  assert.equal(providers.development.state.worktrees.length, 1, '并发调用只能创建一份工作树')
  assert.equal(providers.development.state.branches.length, branchesBefore + 1, '并发调用只能创建一个工作分支')
  assert.equal(providers.execution.state.runs.length, runsBefore + 1, '并发调用只能启动一个执行运行')
  assert.equal(second.executionContextId, first.executionContextId, '两个结果必须指向同一上下文')
})

test('跨 Core 实例：共享 Storage 的并发认领只供应一次（ExecPlan D1）', async () => {
  const firstProviders = createFakeProviders()
  const first = await compose(firstProviders)
  const workItemId = await workItemIdOf(first)
  const shared = firstProviders.storage
  const branchesBefore = firstProviders.development.state.branches.length
  const worktreesBefore = firstProviders.development.state.worktrees.length
  const runsBefore = firstProviders.execution.state.runs.length
  const second = await compose(firstProviders, shared)
  const gate = pauseFirstTransaction(shared)
  const request = { ...REQUEST, workItemId }
  const firstPromise = first.commands.startWork({ ...request, idempotencyKey: 'cross-1' })
  await gate.entered
  const secondPromise = second.commands.startWork({ ...request, idempotencyKey: 'cross-2' })
  gate.release.resolve()
  const [one, two] = await Promise.all([firstPromise, secondPromise])
  const state = exportFakeStorageState(shared)
  assert.equal(state.contexts.length, 1)
  assert.equal(firstProviders.development.state.worktrees.length, worktreesBefore + 1)
  assert.equal(firstProviders.development.state.branches.length, branchesBefore + 1)
  assert.equal(firstProviders.execution.state.runs.length, runsBefore + 1)
  assert.equal(one.executionContextId, two.executionContextId)
})

test('重启：同一份 Storage 内容上的新 core 仍按工作项 + 仓库查到上下文、工作树与分支（#77）', async () => {
  const providers = createFakeProviders()
  const first = await compose(providers)
  const workItemId = await workItemIdOf(first)
  const started = await first.commands.startWork({ ...REQUEST, workItemId, idempotencyKey: 'restart-1' })
  const restored = createFakeStorage(exportFakeStorageState(providers.storage))
  const second = await compose(providers, restored)
  const view = await second.queries.getExecutionContext({ workItemId, repositoryId: REPOSITORY })
  assert.ok(view, '重启后必须能按工作项与仓库查到执行上下文')
  assert.equal(view.id, started.executionContextId)
  assert.equal(view.worktreeExternalId, started.worktreeExternalId)
  assert.equal(view.branchExternalId, started.branchExternalId)
})

/** 记录组合期观察（`describeCapabilities`）之外的每次调用：方法名与它收到的引用（仓库或工作树）的 bindingId / externalId。 */
function recorded(port) {
  const calls = []
  const proxy = new Proxy(port, { get(target, key) {
    const value = Reflect.get(target, key, target)
    if (typeof value !== 'function') return value
    if (key === 'describeCapabilities') return value.bind(target)
    return (...args) => {
      const ref = args[0]?.repository ?? args[0]?.worktree ?? args[0]
      calls.push(`${String(key)} ${ref?.bindingId}/${ref?.externalId}`)
      return value.apply(target, args)
    }
  } })
  return { proxy, calls }
}

/** 路由用例在替身 Storage 与真实 SQLite 文件上各跑一遍：路由只读 Storage，两种实现的读回必须给出同一个选择。 */
const dir = mkdtempSync(join(tmpdir(), 'start-work-routing-'))
after(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
const ADAPTERS = [['替身 Storage', (providers) => providers.storage], ['SQLite Storage', () => createSqliteStorage(join(dir, `w-${files++}.sqlite`))]]

/**
 * 两条 conflict 文案从判别措辞到句尾的整段动作，用 `$` 锚定句尾（相等，不是包含）。「只写今天走得通的步骤」不能只靠禁词表守：禁词表挡得住已知的坏词，
 * 挡不住换个说法重新许诺，或在动作后面再追加一个不存在的动作（评审第三轮 Y3、Y4）。文案里每多一个动作，就得多一条用例逐字执行它（E15、E3、E7 的末段）。
 */
const AMBIGUOUS_ACTION = /：不取第一个注册者；本版本还不能在多个连接之间登记仓库，也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来$/
const MISSING_ROUTE_ACTION = /Development 绑定 id 必须跨重启稳定；本版本还不能把已登记的仓库改绑到别的连接，只能让原来的 Development 连接以原绑定 id 挂回来$/

/** 登记一条 `bindingId` 连接下的仓库外部身份；`mount` 为真时工作区同时把仓库挂到它上面。#127 的绑定仓库命令之前，「仓库属于哪个连接」只能经 Storage 端口种入（旁证，TD-038）。 */
async function bindRepository(storage, bindingId, repositoryId, { mount = true } = {}) {
  const entityId = `entity-${bindingId}-${repositoryId}`; const id = `identity-${bindingId}-${repositoryId}`
  await storage.putEntity({ id: entityId, kind: 'repository' })
  await storage.putExternalIdentity({ id, entityId, bindingId, externalKind: 'repository', externalId: repositoryId, role: 'primary' })
  if (mount) await storage.putRepository({ id: repositoryId, workspaceId: WORKSPACE.id, externalIdentityId: id })
}

/** 可区分的 Development 替身（`c` 给了才加第三个挂载）：每个种子里都有 repo-alpha（误路由也能「成功」，只有调用记录能区分），dev-b 另有 repo-beta 与它的 main 分支。 */
async function developments(makeStorage, { a = {}, b = {}, c } = {}) {
  const providers = createFakeProviders()
  const storage = makeStorage(providers)
  const devA = createFakeDevelopmentProvider({ bindingId: 'dev-a', ...a })
  const devB = createFakeDevelopmentProvider({ bindingId: 'dev-b', ...b })
  const beta = refOf('dev-b', 'repository', 'repo-beta')
  devB.state.repositories.push({ ref: beta, name: 'beta', defaultBranch: 'main', sourceUpdatedAt: undefined })
  devB.state.branches.push({ repository: beta, ref: refOf('dev-b', 'branch', 'beta-main'), name: 'main', headCommit: 'sha-1' })
  const A = recorded(devA); const B = recorded(devB)
  const C = c === undefined ? undefined : recorded(createFakeDevelopmentProvider({ bindingId: 'dev-c', ...c }))
  const core = await compose({ ...providers, development: [A.proxy, B.proxy, ...(C === undefined ? [] : [C.proxy])] }, storage)
  return { providers, storage, core, devA, devB, A, B, C, workItemId: await workItemIdOf(core) }
}
/** 单挂载组合并开始工作一次（Ready）；后续用例在同一份 Storage 上换连接重组或改写记录。 */
async function readyOnce(makeStorage, idempotencyKey) {
  const providers = createFakeProviders()
  const storage = makeStorage(providers)
  const core = await compose(providers, storage)
  const workItemId = await workItemIdOf(core)
  assert.equal((await core.commands.startWork({ ...REQUEST, workItemId, idempotencyKey })).writeState, WriteState.Saved)
  return { providers, storage, core, workItemId }
}
const recompose = (w, development, policy) => composeCore({ workspace: WORKSPACE, providers: { ...w.providers, development }, storage: w.storage, policy })
/** 规划种子里除 `skip` 之外的第一个工作项：换一个新工作项开始，而不是重放同一个。 */
const anotherWorkItem = async (core, ...skip) =>
  (await core.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item' && !skip.includes(view.entityId)).entityId
/** `(工作项, 仓库)` 的上下文与工作区登记的仓库挂载数：拒绝发生在写前，这两样都不得新增。 */
const localRows = async (storage, workItemId, repositoryId = REPOSITORY) =>
  [await storage.getExecutionContext(contextIdFor(WORKSPACE.id, workItemId, repositoryId)), (await storage.listRepositories(WORKSPACE.id)).length]
const attemptKeys = async (storage) => (await storage.listMutationAttempts(WORKSPACE.id)).map((attempt) => attempt.idempotencyKey)
const markFailed = async (storage, workItemId, repositoryId = REPOSITORY) => {
  const id = contextIdFor(WORKSPACE.id, workItemId, repositoryId)
  await storage.putExecutionContext({ ...(await storage.getExecutionContext(id)), status: ExecutionContextStatus.Failed, worktreeExternalId: undefined })
}

for (const [label, makeStorage] of ADAPTERS) {
  test(`${label}：两个 Development 挂载：每个仓库的开始工作只进路由给它的挂载，写尝试记各自的连接，换新键的工作树读回也一样（#219 验收 1）`, async () => {
    const w = await developments(makeStorage)
    await bindRepository(w.storage, 'dev-a', REPOSITORY); await bindRepository(w.storage, 'dev-b', 'repo-beta')
    const alpha = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'route-a' })
    const beta = await w.core.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: w.workItemId, idempotencyKey: 'route-b' })
    assert.deepEqual([alpha.writeState, beta.writeState], [WriteState.Saved, WriteState.Saved])
    assert.deepEqual([w.devA.state.branches.length, w.devA.state.worktrees.length, w.devB.state.branches.length, w.devB.state.worktrees.length], [2, 1, 3, 1], '分支与工作树各进自己的挂载')
    assert.ok(w.A.calls.length > 0 && w.A.calls.every((call) => call.includes(' dev-a/')), `dev-a 只收到本连接的引用：${w.A.calls}`)
    assert.ok(w.B.calls.length > 0 && w.B.calls.every((call) => call.includes(' dev-b/')), `dev-b 只收到本连接的引用：${w.B.calls}`)
    assert.ok([...w.A.calls, ...w.B.calls].filter((call) => !call.startsWith('getWorktree')).every((call) => call.endsWith(call.includes('dev-a') ? REPOSITORY : 'repo-beta')), '仓库级调用带的是路由给它的那个仓库')
    const attempts = (await w.storage.listMutationAttempts(WORKSPACE.id)).map((attempt) => [attempt.commandName, attempt.idempotencyKey, attempt.bindingId, attempt.state]).sort()
    assert.deepEqual(attempts, [['startWork', 'route-a', 'dev-a', 'saved'], ['startWork', 'route-b', 'dev-b', 'saved']], '外部写入记录的目标连接是路由到的那个，不是工作区里的第一个 Development 挂载（AGENTS.md §7）')
    const before = [w.A.calls.length, w.B.calls.length]
    for (const [repositoryId, idempotencyKey] of [[REPOSITORY, 'route-a-2'], ['repo-beta', 'route-b-2']]) {
      const replay = await w.core.commands.startWork({ ...REQUEST, repositoryId, workItemId: w.workItemId, idempotencyKey })
      assert.deepEqual([replay.writeState, replay.status], [WriteState.Saved, ExecutionContextStatus.Ready], `${repositoryId}：新键的读回确认工作树仍在`)
    }
    assert.deepEqual([w.A.calls.slice(before[0]), w.B.calls.slice(before[1])].map((calls) => calls.map((call) => call.split(' ')[0])), [['getWorktree'], ['getWorktree']], '两个读回各问自己的挂载一次')
  })

  test(`${label}：两个 Development 挂载、仓库没有登记：结构化 conflict，两个挂载零调用、不落上下文也不登记仓库（#219 验收 2，歧义）`, async () => {
    const w = await developments(makeStorage)
    const result = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'ambiguous' })
    assert.deepEqual([result.writeState, result.executionContextId, result.error?.code], [WriteState.Failed, undefined, 'conflict'])
    assert.match(result.error.message, /dev-a、dev-b/); assert.match(result.error.message, /不取第一个注册者/)
    assert.match(result.error.message, /先只挂载拥有这个仓库的那个 Development 连接，开始工作一次/); assert.match(result.error.message, /再把其余连接挂回来/)
    assert.match(result.error.message, /还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载/, '第一次登记在本版本里撤不回：步骤之前就要告诉用户，两个连接都能服务这个仓库时选错就锁死（评审第三轮）')
    assert.match(result.error.message, AMBIGUOUS_ACTION, '句尾逐字锚定：在步骤后面追加一个今天不存在的动作也会红')
    assert.doesNotMatch(result.error.message, /#\d+|绑定仓库|重新绑定|绑定到/, '文案只写今天走得通的步骤：不把内部 issue 号当指引，也不承诺还不存在的绑定命令（走法由下一条用例逐步执行）')
    assert.deepEqual([w.A.calls, w.B.calls, await localRows(w.storage, w.workItemId)], [[], [], [undefined, 0]])
  })

  test(`${label}：歧义 conflict 的文案按步骤走得通：只挂载仓库所属的连接开始工作一次（登记仓库属于它），再把其余连接挂回来，之后这个仓库照旧只进它所属的连接（#219 验收 2，文案可执行）`, async () => {
    const w = await developments(makeStorage)
    const refused = await w.core.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: w.workItemId, idempotencyKey: 'steps-1' })
    assert.deepEqual([refused.writeState, refused.error?.code], [WriteState.Failed, 'conflict'])
    assert.match(refused.error.message, /还不能把已登记的仓库改绑到别的连接.*先只挂载拥有这个仓库的那个 Development 连接，开始工作一次.*再把其余连接挂回来/, '先说登记撤不回，再给三步；下面三步就是这句文案的字面执行')
    const solo = await recompose(w, w.B.proxy) // 第一步：只挂载拥有 repo-beta 的 dev-b
    const registered = await solo.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: w.workItemId, idempotencyKey: 'steps-2' }) // 第二步：开始工作一次，惰性登记（D7）记下 repo-beta 属于 dev-b
    assert.deepEqual([registered.writeState, registered.status], [WriteState.Saved, ExecutionContextStatus.Ready])
    const mount = (await w.storage.listRepositories(WORKSPACE.id)).find((record) => record.id === 'repo-beta')
    assert.equal((await w.storage.findExternalIdentity('dev-b', 'repository', 'repo-beta'))?.id, mount?.externalIdentityId, '登记下来的仓库挂载指向 dev-b 下的身份')
    const both = await recompose(w, [w.A.proxy, w.B.proxy]) // 第三步：把其余连接挂回来
    const [replay, fresh] = [await both.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: w.workItemId, idempotencyKey: 'steps-3' }), await both.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: await anotherWorkItem(both, w.workItemId), idempotencyKey: 'steps-4' })]
    assert.deepEqual([replay, fresh].map((result) => [result.writeState, result.status, result.error]), [[WriteState.Saved, ExecutionContextStatus.Ready, undefined], [WriteState.Saved, ExecutionContextStatus.Ready, undefined]], '重放确认 Saved，新工作项照常开始')
    assert.deepEqual(w.A.calls, [], 'repo-beta 属于 dev-b：dev-a 从头到尾一次调用都没收到')
    assert.ok(w.B.calls.length > 0 && w.B.calls.every((call) => call.includes(' dev-b/')), `只进 dev-b：${w.B.calls}`)
  })

  test(`${label}：路由到的挂载缺工作树创建能力：not_supported，不改道到另一个声明了它的挂载（#219 验收 2）`, async () => {
    const w = await developments(makeStorage, { a: { capabilities: { worktreeCreate: false } } })
    await bindRepository(w.storage, 'dev-a', REPOSITORY)
    const result = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'no-reroute' })
    assert.deepEqual([result.writeState, result.error?.code], [WriteState.Failed, 'not_supported'])
    assert.deepEqual([w.A.calls, w.B.calls, await localRows(w.storage, w.workItemId)], [[], [], [undefined, 1]])
  })

  test(`${label}：两个 Development 挂载：锚点之前的注册门（分支创建、工作树读）也在仓库所属的挂载上判定，排在前面的挂载声明了也不放行（#219 验收 1、2）`, async () => {
    for (const [flags, key] of [[{ branchCreate: false }, 'development.branch.create'], [{ worktreeRead: false }, 'development.worktree.read']]) {
      const w = await developments(makeStorage, { b: { capabilities: flags } })
      await bindRepository(w.storage, 'dev-b', 'repo-beta')
      const result = await w.core.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: w.workItemId, idempotencyKey: `gate-${key}` })
      assert.deepEqual([result.writeState, result.error?.code, result.error?.message], [WriteState.Failed, 'not_supported', `没有绑定提供能力 ${key}`], key)
      assert.deepEqual([w.A.calls, w.B.calls, await localRows(w.storage, w.workItemId, 'repo-beta')], [[], [], [undefined, 1]], key)
    }
  })

  test(`${label}：重组后换了 Development 连接：已登记仓库上的新工作项写前 conflict，已 Ready 的上下文保持 Ready 报 Unknown，新连接零调用（#219 验收 1、2，缺路由）`, async () => {
    const w = await readyOnce(makeStorage, 'moved-1')
    const moved = recorded(createFakeDevelopmentProvider({ bindingId: 'dev-moved' }))
    const second = await recompose(w, moved.proxy)
    const other = (await second.queries.listPlanningItems()).find((view) => view.kind === 'work_item' && view.content.contentKind === 'work_item' && view.entityId !== w.workItemId).entityId
    const refused = await second.commands.startWork({ ...REQUEST, workItemId: other, idempotencyKey: 'moved-2' })
    assert.deepEqual([refused.writeState, refused.error?.code], [WriteState.Failed, 'conflict']); assert.match(refused.error.message, /绑定 id 变了/)
    assert.match(refused.error.message, /只能让原来的 Development 连接以原绑定 id 挂回来/); assert.match(refused.error.message, /还不能把已登记的仓库改绑到别的连接/)
    assert.match(refused.error.message, MISSING_ROUTE_ACTION, '句尾逐字锚定：在「挂回来」后面追加一个今天不存在的动作（例如改挂到当前连接）也会红')
    assert.doesNotMatch(refused.error.message, /#\d+|绑定仓库|重新绑定/, '文案只写今天走得通的步骤：不把内部 issue 号当指引，也不许诺 Storage 会拒绝的「重新绑定到当前连接」')
    const replay = await second.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'moved-3' })
    const view = await second.queries.getExecutionContext({ workItemId: w.workItemId, repositoryId: REPOSITORY })
    assert.deepEqual([replay.status, replay.writeState, view.status], [ExecutionContextStatus.Ready, WriteState.Unknown, ExecutionContextStatus.Ready], '不能确认不等于不存在：不改判 Failed')
    assert.deepEqual(moved.calls, [], '仓库不属于新连接：新连接一次调用都不收到')
    const lacking = recorded(createFakeDevelopmentProvider({ bindingId: 'dev-moved', capabilities: { branchCreate: false } }))
    const gated = await (await recompose(w, lacking.proxy)).commands.startWork({ ...REQUEST, workItemId: other, idempotencyKey: 'moved-5' })
    assert.deepEqual([gated.error?.code, gated.error?.message, lacking.calls], ['not_supported', '没有绑定提供能力 development.branch.create', []], '单挂载：能力门先于缺路由（与改动前的先后一致，只是不再调 provider）')
    const none = await recompose(w, undefined)
    const absent = await none.commands.startWork({ ...REQUEST, workItemId: other, idempotencyKey: 'moved-4' })
    assert.deepEqual([absent.error?.code, absent.error?.message], ['not_supported', '没有绑定提供能力 development.branch.create'], '没有任何 Development 挂载：按第一道门报缺能力，不报「绑定 id 变了」')
    const back = await recompose(w, w.providers.development) // 按文案走：让原来的 Development 连接以原绑定 id 挂回来
    const [confirmed, resumed] = [await back.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'moved-6' }), await back.commands.startWork({ ...REQUEST, workItemId: other, idempotencyKey: 'moved-7' })]
    assert.deepEqual([confirmed, resumed].map((result) => [result.writeState, result.status, result.error]), [[WriteState.Saved, ExecutionContextStatus.Ready, undefined], [WriteState.Saved, ExecutionContextStatus.Ready, undefined]], '挂回原连接即恢复：已 Ready 的上下文读回确认为 Saved，被拒的新工作项照常开始')
  })

  test(`${label}：工作树读能力只读：已 Ready 的上下文换新键开始工作，读回按读门放行并确认 Saved，不当作「无法确认」（#219 读回的路由模式）`, async () => {
    const w = await readyOnce(makeStorage, 'readonly-1')
    const same = recorded(w.providers.development)
    const replay = await (await recompose(w, same.proxy, { [CapabilityKey.DevelopmentWorktreeRead]: AccessLevel.ReadOnly })).commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'readonly-2' })
    assert.deepEqual([replay.writeState, replay.status, same.calls.map((call) => call.split(' ')[0])], [WriteState.Saved, ExecutionContextStatus.Ready, ['getWorktree']], '读回是读门：只读的工作树读照样验证，调一次 getWorktree')
  })

  test(`${label}：终态接管：换了连接时写前 conflict，新连接零调用、上下文仍是 Failed；锚点只读同样被拒（#219 D8）`, async () => {
    const w = await readyOnce(makeStorage, 'take-1')
    await markFailed(w.storage, w.workItemId)
    const moved = recorded(createFakeDevelopmentProvider({ bindingId: 'dev-moved' }))
    const refused = await (await recompose(w, moved.proxy)).commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'take-2' })
    const status = async () => (await w.storage.getExecutionContext(contextIdFor(WORKSPACE.id, w.workItemId, REPOSITORY))).status
    assert.deepEqual([refused.writeState, refused.error?.code, await status(), moved.calls], [WriteState.Failed, 'conflict', ExecutionContextStatus.Failed, []], '终态接管也不向新连接建分支、建工作树')
    const same = recorded(w.providers.development)
    const readonly = await (await recompose(w, same.proxy, { [CapabilityKey.DevelopmentWorktreeCreate]: AccessLevel.ReadOnly })).commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'take-3' })
    assert.deepEqual([readonly.writeState, readonly.error?.code, await status(), same.calls], [WriteState.Failed, 'permission_denied', ExecutionContextStatus.Failed, []], '接管的锚点是写门：只读即拒绝，不调 provider')
    assert.deepEqual(await attemptKeys(w.storage), ['take-1'], '路由拒绝不记写尝试：没有收到调用的连接不是写入目标（AGENTS.md §7）')
  })

  test(`${label}：过期续跑（Provisioning、租约已过期）：换了连接时写前 conflict，新连接零调用、不建分支也不建工作树（#219 D8）`, async () => {
    const w = await readyOnce(makeStorage, 'stale-1')
    const id = contextIdFor(WORKSPACE.id, w.workItemId, REPOSITORY)
    await w.storage.putExecutionContext({ ...(await w.storage.getExecutionContext(id)), status: ExecutionContextStatus.Provisioning, provisioningStartedAt: '2000-01-01T00:00:00.000Z', worktreeExternalId: undefined })
    const moved = recorded(createFakeDevelopmentProvider({ bindingId: 'dev-moved' }))
    const resumed = await (await recompose(w, moved.proxy)).commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'stale-2' })
    assert.deepEqual([resumed.writeState, resumed.error?.code, moved.calls], [WriteState.Failed, 'conflict', []], '续跑与终态接管同走 provisionGit 的路由：不向新连接发 listBranches / createWorktree')
    assert.deepEqual(await attemptKeys(w.storage), ['stale-1'], '路由拒绝不记写尝试')
  })

  test(`${label}：两个 Development 挂载：终态接管也只进仓库所属的挂载（#219 验收 1）`, async () => {
    const w = await developments(makeStorage)
    await bindRepository(w.storage, 'dev-a', REPOSITORY); await bindRepository(w.storage, 'dev-b', 'repo-beta')
    for (const [repositoryId, idempotencyKey] of [[REPOSITORY, 'retake-a'], ['repo-beta', 'retake-b']]) await w.core.commands.startWork({ ...REQUEST, repositoryId, workItemId: w.workItemId, idempotencyKey })
    await markFailed(w.storage, w.workItemId, 'repo-beta')
    const before = [w.A.calls.length, w.B.calls.length]
    const retaken = await w.core.commands.startWork({ ...REQUEST, repositoryId: 'repo-beta', workItemId: w.workItemId, idempotencyKey: 'retake-b-2' })
    const added = [w.A.calls.slice(before[0]), w.B.calls.slice(before[1])]
    assert.deepEqual([retaken.writeState, retaken.status], [WriteState.Saved, ExecutionContextStatus.Ready])
    assert.deepEqual(added[0], [], 'dev-a 一次都没收到')
    assert.ok(added[1].length > 0 && added[1].every((call) => call.includes(' dev-b/')), `接管的供应只进 dev-b：${added[1]}`)
  })

  test(`${label}：两个 Development 挂载：仓库挂载的身份属于未挂载的连接时 conflict，即使某个挂载下恰有同 id 的别家身份、第一个挂载还缺能力，两个挂载零调用（#219 验收 2，缺路由）`, async () => {
    const w = await developments(makeStorage, { a: { capabilities: { worktreeCreate: false } } }) // 缺路由要先于任何挂载的能力门：多个挂载没有可过门的候选
    await w.storage.putProviderBinding({ id: 'dev-old', workspaceId: WORKSPACE.id, domain: 'development', implementationKey: 'harness.fake', enabled: false, isDefault: false }) // 实现键与替身一致：下面「原来的连接挂回来」是同一个实现回到同一个绑定 id
    await bindRepository(w.storage, 'dev-old', REPOSITORY) // 本工作区的 repo-alpha 挂在未挂载连接 dev-old 的身份上
    await bindRepository(w.storage, 'dev-a', REPOSITORY, { mount: false }) // dev-a 下另有同 externalId 的身份（别的工作区登记的）：按「有没有同名身份」选挂载会被它带偏
    const refused = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'old-binding' })
    assert.deepEqual([refused.writeState, refused.error?.code], [WriteState.Failed, 'conflict']); assert.match(refused.error.message, /绑定 id 变了/)
    assert.deepEqual([w.A.calls, w.B.calls, await localRows(w.storage, w.workItemId)], [[], [], [undefined, 1]])
    const old = recorded(createFakeDevelopmentProvider({ bindingId: 'dev-old' }))
    const restored = await (await recompose(w, [w.A.proxy, w.B.proxy, old.proxy])).commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'old-binding-2' }) // 按文案走：原来的连接以原绑定 id 挂回来
    assert.equal(restored.writeState, WriteState.Saved)
    assert.deepEqual([w.A.calls, w.B.calls], [[], []], '挂回之后仍只进仓库所属的 dev-old')
    assert.ok(old.calls.length > 0 && old.calls.every((call) => call.includes(' dev-old/')), `只进 dev-old：${old.calls}`)
  })

  test(`${label}：两个 Development 挂载：仓库挂载按 id 精确匹配，id 里含有请求 id 的别的仓库不带偏路由（#219 验收 1）`, async () => {
    const w = await developments(makeStorage)
    await bindRepository(w.storage, 'dev-b', 'repo-alpha-2') // 先登记：列表里排在 repo-alpha 之前，id 包含 repo-alpha
    await bindRepository(w.storage, 'dev-a', REPOSITORY)
    const started = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'exact-id' })
    assert.equal(started.writeState, WriteState.Saved)
    assert.deepEqual(w.B.calls, [], 'dev-b 只登记了 repo-alpha-2，不收 repo-alpha 的请求')
    assert.ok(w.A.calls.length > 0 && w.A.calls.every((call) => call.includes(' dev-a/')))
  })

  test(`${label}：三个 Development 挂载、仓库没有登记：conflict 列出三个候选，三个挂载零调用、不落上下文（歧义不是「恰好两个」才拒绝，#219 验收 2）`, async () => {
    const w = await developments(makeStorage, { c: {} })
    const result = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'ambiguous-3' })
    assert.deepEqual([result.writeState, result.executionContextId, result.error?.code], [WriteState.Failed, undefined, 'conflict'])
    assert.match(result.error.message, /dev-a、dev-b、dev-c/); assert.match(result.error.message, /不取第一个注册者/)
    assert.deepEqual([w.A.calls, w.B.calls, w.C.calls, await localRows(w.storage, w.workItemId)], [[], [], [], [undefined, 0]])
  })

  test(`${label}：三个 Development 挂载：登记在第三个挂载上的仓库只进第三个，排在前面的挂载缺能力也不影响、不改道（#219 验收 1）`, async () => {
    const w = await developments(makeStorage, { a: { capabilities: { worktreeCreate: false } }, c: {} })
    await bindRepository(w.storage, 'dev-c', REPOSITORY)
    const started = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'third' })
    assert.equal(started.writeState, WriteState.Saved)
    assert.deepEqual([w.A.calls, w.B.calls], [[], []], '前两个挂载一次都没收到')
    assert.ok(w.C.calls.length > 0 && w.C.calls.every((call) => call.includes(' dev-c/')), `只进 dev-c：${w.C.calls}`)
  })

  test(`${label}：三个 Development 挂载：仓库挂载的身份属于未挂载的连接时 conflict，不是排在第一的挂载的缺能力，三个挂载零调用（#219 验收 2，缺路由）`, async () => {
    const w = await developments(makeStorage, { a: { capabilities: { worktreeCreate: false } }, c: {} })
    await w.storage.putProviderBinding({ id: 'dev-old', workspaceId: WORKSPACE.id, domain: 'development', implementationKey: 'old', enabled: false, isDefault: false })
    await bindRepository(w.storage, 'dev-old', REPOSITORY)
    const refused = await w.core.commands.startWork({ ...REQUEST, workItemId: w.workItemId, idempotencyKey: 'old-binding-3' })
    assert.deepEqual([refused.writeState, refused.error?.code], [WriteState.Failed, 'conflict']); assert.match(refused.error.message, /绑定 id 变了/)
    assert.deepEqual([w.A.calls, w.B.calls, w.C.calls, await localRows(w.storage, w.workItemId)], [[], [], [], [undefined, 1]])
  })
}

test('单 Development 挂载：拒绝的先后与措辞和按 key 逐个过门时一致——未声明报「没有绑定提供能力」，没有挂载按第一道门报缺能力（单挂载行为不变，D8 除外）', async () => {
  const gated = [['branchCreate', 'development.branch.create'], ['worktreeRead', 'development.worktree.read'], ['worktreeCreate', 'development.worktree.create']]
  for (const [flags, key] of [...gated.map(([flag, name]) => [{ [flag]: false }, name]), [{ branchCreate: false, worktreeCreate: false }, 'development.branch.create']]) {
    const providers = createFakeProviders()
    const core = await compose({ ...providers, development: createFakeDevelopmentProvider({ bindingId: providers.development.gate.bindingId, capabilities: flags }) })
    const result = await core.commands.startWork({ ...REQUEST, workItemId: await workItemIdOf(core), idempotencyKey: 'undeclared' })
    assert.deepEqual([result.error?.code, result.error?.message], ['not_supported', `没有绑定提供能力 ${key}`], JSON.stringify(flags))
  }
  const providers = createFakeProviders()
  const core = await compose({ ...providers, development: undefined })
  const none = await core.commands.startWork({ ...REQUEST, workItemId: await workItemIdOf(core), idempotencyKey: 'no-mount' })
  assert.deepEqual([none.error?.code, none.error?.message], ['not_supported', '没有绑定提供能力 development.branch.create'])
})

test('单 Development 挂载：两个注册能力同时被拒时点名谁，先后是 分支创建 → 仓库读 → 工作树读 → 工作树创建，路由不得把锚点提到最前', async () => {
  const { DevelopmentBranchCreate: BC, DevelopmentRepositoryRead: RR, DevelopmentWorktreeRead: WR, DevelopmentWorktreeCreate: WC } = CapabilityKey
  const { ReadOnly: RO, Unavailable: UN } = AccessLevel
  for (const [name, [first, firstLevel], [second, secondLevel], code] of [
    ['分支创建只读先于仓库读不可用', [BC, RO], [RR, UN], 'permission_denied'], ['分支创建只读先于工作树创建不可用', [BC, RO], [WC, UN], 'permission_denied'],
    ['分支创建不可用先于工作树创建只读', [BC, UN], [WC, RO], 'not_supported'], ['仓库读不可用先于工作树创建只读', [RR, UN], [WC, RO], 'not_supported'],
    ['工作树读不可用先于工作树创建只读', [WR, UN], [WC, RO], 'not_supported'], ['仓库读不可用先于工作树读不可用', [RR, UN], [WR, UN], 'not_supported'],
  ]) {
    const core = await composeCore({ workspace: WORKSPACE, providers: createFakeProviders(), policy: { [first]: firstLevel, [second]: secondLevel } })
    const result = await core.commands.startWork({ ...REQUEST, workItemId: await workItemIdOf(core), idempotencyKey: name })
    assert.deepEqual([result.writeState, result.error?.code], [WriteState.Failed, code], name)
    assert.ok(result.error.message.includes(first), `${name}：点名先判的那个能力 ${first}，实际 ${result.error.message}`) // 两个能力的错误码相同时，只有文案分得出谁先判
  }
})
