import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
import { createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'
import { createHarnessExecutionProvider } from '@harness-projects/provider-execution-harness'
import { createHumanExecutionProvider } from '@harness-projects/provider-execution-human'
import { newWorkspaceId } from '@harness-projects/domain'

const exec = promisify(execFile)
for (const fault of ['none', 'create', 'prompt', 'timeout', 'read']) test(`Harness→Core：${fault} 后工作树保留，明确失败人工降级，不明结果零第二执行者`, async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'harness-execution-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  const git = (args) => exec('git', args, { cwd: repo })
  await git(['init', '-b', 'main'])
  await writeFile(path.join(repo, 'README.md'), 'worktree evidence\n')
  await git(['add', 'README.md'])
  await git(['-c', 'user.name=Execution Test', '-c', 'user.email=execution@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'])
  const fakes = createFakeProviders()
  let cwd, requestId, creates = 0, prompts = 0, fallbacks = 0, fallbackCwd
  const sessions = {
    create: async (input) => { creates++; cwd = input.cwd; if (fault === 'create') throw Error('offline'); return { sessionId: 'session-core' } },
    prompt: async (input) => { prompts++; requestId = input.requestId; if (fault === 'prompt') throw Error('lost ack'); if (fault === 'timeout') return new Promise(() => {}); return { accepted: true } },
    inspect: async () => { if (fault === 'read') throw Error('read failed'); return { events: [
      { seq: 1, type: 'turn/start', turn: 1 }, { seq: 2, type: 'user/message', rpcId: requestId },
      { seq: 3, type: 'turn/end', turn: 1, reason: { kind: 'completed' } }] } },
    list: async () => ({ items: [{ sessionId: 'session-core', running: false }] }),
  }
  const execution = createHarnessExecutionProvider({ bindingId: 'harness-core', sessions, timeoutMs: 20 })
  const human = createHumanExecutionProvider({ bindingId: 'human-core', issuerKey: 'execution-test-issuer-key-at-least-32', fallback: true })
  const executionFallback = { ...human, definition: human.definition, describeCapabilities: () => human.describeCapabilities(), getRun: (ref) => human.getRun(ref),
    startRun: async (input) => { fallbacks++; fallbackCwd = input.workingDirectory; return human.startRun(input) } }
  const development = createLocalGitDevelopmentProvider({ bindingId: 'git-core', repository: { externalId: 'repo-alpha', path: repo }, allowedRoot: root })
  const core = await composeCore({ workspace: { id: newWorkspaceId(), name: 'Harness integration' }, providers: { ...fakes, development, execution, executionFallback } })
  const item = (await core.queries.listPlanningItems()).find((x) => x.kind === 'work_item' && x.content.contentKind === 'work_item')
  const request = { repositoryId: 'repo-alpha', workItemId: item.entityId, actor: { kind: 'agent' }, idempotencyKey: `harness-${fault}`, worktreePath: '.worktrees/execution' }
  const result = await core.commands.startWork(request)
  t.diagnostic(JSON.stringify({ actor: request.actor, targetBindingId: 'harness-core', intentKey: [result.executionContextId, request.idempotencyKey],
    requestId, sessionId: fault === 'create' ? undefined : 'session-core', providerAck: fault === 'none' || fault === 'read', readBack: fault === 'none',
    result: result.writeState, ref: result.runExternalId }))
  const acked = path.join(repo, '.worktrees/execution')
  assert.equal(result.worktreeExternalId, acked)
  assert.equal(cwd, acked, 'create.cwd 必须等于 Development ack 的规范路径')
  assert.notEqual(cwd, process.cwd())
  assert.equal(await readFile(path.join(acked, 'README.md'), 'utf8'), 'worktree evidence\n')
  const stored = await core.queries.getExecutionContext({ workItemId: item.entityId, repositoryId: 'repo-alpha' })
  assert.equal(stored.worktreeExternalId, acked)
  assert.equal(creates, 1)
  assert.equal(prompts, fault === 'create' ? 0 : 1)
  if (fault === 'prompt' || fault === 'timeout' || fault === 'read') {
    assert.equal(result.writeState, 'unknown')
    assert.equal(stored.runStatus, 'unknown')
    assert.equal(fallbacks, 0)
    await core.commands.startWork({ ...request, idempotencyKey: 'retry-unknown' })
    assert.equal(creates, 1)
    assert.equal(fallbacks, 0)
  } else {
    assert.equal(result.confirmed, true)
    assert.equal(stored.runStatus, fault === 'create' ? 'running' : 'succeeded')
    assert.equal(fallbacks, fault === 'create' ? 1 : 0)
    if (fault === 'create') { assert.equal(result.fallback, 'manual_fallback'); assert.equal(fallbackCwd, acked) }
  }
})

for (const interleaving of ['later-turn-before-cancel', 'later-turn-during-core-read']) test(`Harness→Core：stale running 与 ${interleaving} 不允许 session 取消`, async () => {
  const providers = createFakeProviders()
  let requestId, calls = 0, reads = 0, armed = false, laterAborted = false
  const history = []
  const later = () => history.push({ seq: 3, type: 'turn/end', turn: 1, reason: { kind: 'completed' } },
    { seq: 4, type: 'turn/start', turn: 2 }, { seq: 5, type: 'user/message', rpcId: 'foreign-user-request' })
  const sessions = {
    create: async () => ({ sessionId: 'stale-session' }),
    prompt: async (input) => { requestId = input.requestId; history.push({ seq: 1, type: 'turn/start', turn: 1 },
      { seq: 2, type: 'user/message', rpcId: requestId }); return { accepted: true } },
    inspect: async () => {
      reads++
      const snapshot = structuredClone(history)
      return { events: snapshot }
    },
    list: async () => ({ items: [{ sessionId: 'stale-session', running: true }] }),
    cancel: async () => { calls++; laterAborted = true; return { accepted: true } },
  }
  const execution = createHarnessExecutionProvider({ bindingId: 'harness-stale', sessions, cancel: true })
  providers.execution = execution
  const core = await composeCore({ workspace: { id: newWorkspaceId(), name: 'Harness stale cancellation' }, providers })
  const item = (await core.queries.listPlanningItems()).find((x) => x.kind === 'work_item' && x.content.contentKind === 'work_item')
  const query = { repositoryId: 'repo-alpha', workItemId: item.entityId }
  const result = await core.commands.startWork({ ...query, actor: { kind: 'agent' }, idempotencyKey: interleaving, worktreePath: '/workspace/stale-tree' })
  assert.equal(result.confirmed, true)
  assert.equal((await core.queries.getExecutionContext(query)).runStatus, 'running')
  if (interleaving === 'later-turn-before-cancel') later()
  armed = true
  const getRun = providers.storage.getExecutionRun.bind(providers.storage)
  providers.storage.getExecutionRun = async (...args) => {
    const stale = await getRun(...args)
    if (armed && interleaving === 'later-turn-during-core-read') { armed = false; later() }
    return stale
  }
  const before = reads
  const canceled = await core.commands.cancelExecutionRun(query)
  assert.equal(canceled.error?.code, 'not_supported')
  assert.equal(canceled.status, 'running', '拒绝取消不冒充刷新后的终态')
  for (const id of [requestId, 'foreign-user-request', 'never-in-session'])
    assert.equal((await execution.cancelRun({ bindingId: 'harness-stale', objectKind: 'execution_run', externalId: JSON.stringify(['stale-session', id]) })).error?.code, 'not_supported')
  assert.equal(reads, before, '不做无法消除 TOCTOU 的 preflight')
  assert.equal(calls, 0)
  assert.equal(history.some((event) => event.rpcId === 'foreign-user-request'), true, '后续 turn 确实在命令前或在 Core 读取 stale 状态期间开始')
  assert.equal(laterAborted, false)
})
