/** 写入组只替换外部端口：Git/SQLite/Host 和 UI 命令均走生产实现。 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { composeCore, defaultIdFactory } from '@harness-projects/core'
import { createFakeProviders, FAKE_PROVIDER_DEFINITION, refOf } from '@harness-projects/provider-fake'
import { createLocalGitDevelopmentProvider, LOCAL_GIT_PROVIDER_DEFINITION } from '@harness-projects/provider-development-local-git'
import { createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'
import { createHumanExecutionProvider, HUMAN_EXECUTION_PROVIDER_DEFINITION } from '@harness-projects/provider-execution-human'
import { providerErr, providerError } from '@harness-projects/capabilities'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { catalogOf, hostStoragePolicy } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { platform, repository, sha } from './github-development-create.mjs'
const exec = promisify(execFile), REPOSITORY = repository.externalId
export async function createComposedExecutionPlatform() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'composed-execution-')))
  const repositoryPath = path.join(root, 'repo'), allowedRoot = path.join(root, 'worktrees'), dataPath = path.join(root, 'workspace.sqlite')
  const git = async (args, cwd = repositoryPath) => (await exec('git', args, { cwd })).stdout.trim()
  let storage, host, installed, peer = 0
  const close = async () => { await installed?.dispose(); await host?.dispose(); storage?.close(); await rm(root, { recursive: true, force: true }) }
  try {
    await mkdir(repositoryPath); await git(['init', '-b', 'main'])
    await writeFile(path.join(repositoryPath, 'README.md'), 'Browser Git fixture\n')
    await git(['add', 'README.md'])
    await git(['-c', 'user.name=Browser Fixture', '-c', 'user.email=browser@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'])
    const flags = { execution: 'normal', dropAck: false, issueTarget: false, issueDenied: false }, counts = { branches: 0, worktrees: 0, primary: 0, manual: 0 }
    const f = platform(), providers = createFakeProviders({ planning: { bindingId: 'planning-browser' }, delivery: { bindingId: 'delivery-browser' }, execution: { bindingId: 'execution-browser' } })
    providers.execution.state.runs = []; providers.execution.state.seq = 0
    providers.planning.getIssueLinkTarget = async source => flags.issueDenied ? providerErr(providerError('permission_denied', 'synthetic source denied')) : flags.issueTarget ? { ok: true, value: { source, nativeIssueIdentity: { namespace: 'fixture/Issue', id: source.issue.externalId }, number: 545, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' }, name: 'example/project' } } } : providerErr(providerError('not_supported', 'synthetic issue target disabled'))
    const startPrimary = providers.execution.startRun.bind(providers.execution)
    providers.execution.startRun = async input => {
      counts.primary++
      if (flags.execution !== 'normal') return providerErr(providerError(flags.execution === 'unknown' ? 'ambiguous_result' : 'unavailable', 'controlled external execution refusal'))
      return startPrimary(input)
    }
    const human = createHumanExecutionProvider({ bindingId: 'manual-browser', issuerKey: 'browser-only-stable-test-issuer-at-least-32-bytes', fallback: true })
    const startManual = human.startRun.bind(human); human.startRun = input => { counts.manual++; return startManual(input) }
    const local = createLocalGitDevelopmentProvider({ bindingId: 'local-browser', repository: { externalId: REPOSITORY, path: repositoryPath }, allowedRoot })
    for (const [method, count] of [['createBranch', 'branches'], ['createWorktree', 'worktrees']]) {
      const run = local[method].bind(local); local[method] = input => { counts[count]++; return run(input) }
    }
    const assignment = { ids: [], adds: 0, drop: false, offline: false, denied: '', failure: '', more: false }, users = [{ id: 'U_browser', login: 'browser-assignee' }]
    const github = createGithubDevelopmentProvider({ bindingId: repository.bindingId, repository: { externalId: REPOSITORY, owner: 'example', name: 'project' }, permissionMode: 'lazy', transport: async request => {
      if (request.operationName === assignment.denied) return { status: 403, headers: {}, body: {} }
      if (flags.dropAck && f.objects.length && request.operationName !== 'DevelopmentCreateChangeRequest') throw Error('creation reconciliation temporarily unavailable')
      if (request.operationName.startsWith('DevelopmentAssign') || request.operationName === 'DevelopmentAddAssignees') {
        const page = nodes => ({ nodes, pageInfo: { hasNextPage: assignment.more || assignment.failure === 'unavailable', endCursor: assignment.failure === 'unavailable' ? null : assignment.more ? 'next-directory-page' : null } })
        if (request.operationName === 'DevelopmentAssignableUsers' && assignment.failure === 'permission_denied') return { status: 403, headers: {}, body: { message: 'candidate-private-canary' } }
        if (assignment.offline && assignment.drop) throw Error('assignment acknowledgement lost')
        if (request.operationName === 'DevelopmentAddAssignees') { assignment.adds++; assignment.ids.push(...request.variables.input.assigneeIds); if (assignment.drop) { assignment.offline = true; throw Error('assignment acknowledgement lost') } }
        return { status: 200, headers: {}, body: { data: { repository: { id: 'R_synthetic', nameWithOwner: 'example/project', assignableUsers: page(users) }, node: { id: f.objects[0]?.id, repository: { id: 'R_synthetic' }, assignees: page(users.filter(u => assignment.ids.includes(u.id))) }, addAssigneesToAssignable: { assignable: { id: f.objects[0]?.id } } } } }
      }
      const result = await f.transport(request)
      if (flags.dropAck && request.operationName === 'DevelopmentCreateChangeRequest') throw Error('created remotely; acknowledgement lost')
      return result
    } })
    const directory = github.listAssignableUsers
    github.listAssignableUsers = input => assignment.failure === 'not_supported' ? Promise.resolve(providerErr(providerError('not_supported', 'candidate-private-canary'))) : directory(input)
    const table = { planning: providers.planning, delivery: providers.delivery, execution: providers.execution, executionFallback: human, development: [local, github] }
    const byId = new Map([['planning-browser', providers.planning], ['delivery-browser', providers.delivery], ['execution-browser', providers.execution], ['manual-browser', human], ['local-browser', local], [repository.bindingId, github]])
    const catalog = catalogOf([FAKE_PROVIDER_DEFINITION, HUMAN_EXECUTION_PROVIDER_DEFINITION, LOCAL_GIT_PROVIDER_DEFINITION, github.definition].map(definition => ({
      definition, configuration: definition === FAKE_PROVIDER_DEFINITION ? { projectNodeId: { kind: 'string', required: false, pattern: '.+', maxLength: 100 } } : {},
      create: async ({ binding }) => { const port = byId.get(binding.id); assert.ok(port); return port },
    })))
    const policy = hostStoragePolicy(catalog), workspaceId = '00000000-0000-4000-8000-000000000282'
    storage = createSqliteStorage(dataPath, policy)
    const core = await composeCore({ workspace: { id: workspaceId, name: 'Execution Fixture' }, providers: table, storage })
    await storage.putBindingConfiguration({ ref: { workspaceId, bindingId: 'planning-browser', domain: 'planning' }, configuration: { projectNodeId: providers.planning.state.projects[0].ref.externalId } })
    await storage.transaction(tx => registerRepository(tx, defaultIdFactory, workspaceId, REPOSITORY, [local.bindingId, repository.bindingId]))
    const itemId = (await core.queries.listPlanningItems()).find(item => item.content.title === '规划项 issue-1').entityId
    const rebuild = async () => {
      await installed?.dispose(); await host?.dispose(); storage.close(); storage = createSqliteStorage(dataPath, policy)
      host = await createHostComposition({ dataPath, workspaceId, catalog, resolveCredential: async () => undefined, fetch: async () => { throw Error('Business network forbidden') }, watchIntervalMs: 5 })
      installed = await installHostRemote({ invocation: { peer: { id: 'execution-peer-' + ++peer } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
    }
    const delivery = mode => {
      providers.delivery.faultsSwitch.set('offline', mode === 'stale')
      if (mode === 'stale') return
      const ref = (kind, id) => refOf('delivery-browser', kind, id), repo = ref('repository', REPOSITORY)
      const conclusion = mode === 'passed' ? 'success' : mode === 'failed' ? 'failure' : undefined
      const run = (id, commit, branch, repository = repo, value = conclusion) => ({ ref: ref('pipeline_run', id), repository, commit, branch, status: 'completed', conclusion: value })
      providers.delivery.state.runs = [run('target-ci', sha, 'feature/topic'), run('foreign-success-commit', 'b'.repeat(40), 'feature/topic', repo, 'success'), run('foreign-success-repo', sha, 'feature/topic', ref('repository', 'foreign'), 'success')]
      providers.delivery.state.checks = [{ ref: ref('check_run', 'target-check'), repository: repo, commit: sha, name: 'target-check', status: 'completed', conclusion }]
    }
    delivery('failed'); await rebuild()
    const world = { flags, assignment, github, delivery, get prCreates() { return f.mutations().length }, get peer() { return peer }, effects: () => ({ ...counts, prs: f.objects.length }),
      async gitFacts() { const worktrees = (await git(['worktree', 'list', '--porcelain'])).split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9)); assert.equal(worktrees.length, 2); const worktree = worktrees.find(p => p !== repositoryPath); return { path: await realpath(worktree), branch: await git(['branch', '--show-current'], worktree), worktrees: worktrees.length } },
    }
    return { dataPath, workspaceId, itemId, get storage() { return storage }, get host() { return host }, get installed() { return installed }, rebuild, platform: world,
      mounted: [], byDomain: { planning: providers.planning, development: local, delivery: providers.delivery, execution: providers.execution }, close }
  } catch (error) { await close(); throw error }
}
