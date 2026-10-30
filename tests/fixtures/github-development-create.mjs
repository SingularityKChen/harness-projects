/** 严格合成平台；不是真实 GitHub 录制。对象状态而非调用账本用于共享套件的副作用断言。 */
import assert from 'node:assert/strict'
import { createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'
import * as queries from '../../packages/providers/development-github/src/queries.ts'

export const bindingId = 'binding-github-create'
export const repository = { bindingId, objectKind: 'repository', externalId: 'local-repository', url: undefined }
export const input = { repository, head: 'feature/topic', base: 'main', title: 'Create native PR', body: '<!-- operation: fixture-create-436 -->\n正文' }
export const sha = 'a'.repeat(40)
export const ok = (data) => ({ status: 200, headers: {}, body: { data } })
export const repositoryId = 'R_synthetic'
export function platform(scenario = {}, options = {}) {
  const objects = [], calls = []
  const branches = ['main', 'release', 'feature/topic', 'feature/decoy']
  const commitOf = (name) => name === 'main' ? 'b'.repeat(40) : name === 'release' ? 'c'.repeat(40) : sha
  const ref = (name) => ({ name, prefix: 'refs/heads/', repository: { id: repositoryId }, target: { __typename: 'Commit', oid: commitOf(name) } })
  const preflight = { repository: { id: repositoryId, nameWithOwner: 'example/project', head: ref(input.head), base: ref(input.base) } }
  const node = (data, index) => ({
    __typename: 'PullRequest', id: `PR_${index}`, number: index, title: data.title, body: data.body, state: 'OPEN',
    url: `https://github.com/example/project/pull/${index}`, updatedAt: '2026-10-30T00:00:00Z',
    headRefName: data.headRefName, baseRefName: data.baseRefName, headRefOid: sha,
    isCrossRepository: false, reviewDecision: null, repository: { id: repositoryId }, headRepository: { id: repositoryId },
  })
  const transport = async (request) => {
    calls.push(structuredClone(request))
    const { operationName: operation, variables: v, query } = request
    assert.equal(query, queries.DEVELOPMENT_QUERIES[operation] ?? queries.DEVELOPMENT_CREATE_OPERATIONS?.[operation], `未知 query ${operation}`)
    if (operation !== 'DevelopmentCreateChangeRequest') assert.deepEqual([v.owner, v.name], ['example', 'project'])
    if (scenario.faults?.offline) throw new Error('offline canary')
    if (scenario.faults?.permissionDenied) return { status: 403, headers: {}, body: {} }
    if (operation === 'DevelopmentCreatePreflight') {
      assert.deepEqual(Object.keys(v).sort(), ['baseRef', 'headRef', 'name', 'owner'])
      const data = structuredClone(preflight)
      for (const [key, value] of [['head', v.headRef], ['base', v.baseRef]]) {
        const name = value.slice('refs/heads/'.length)
        assert.equal(value, `refs/heads/${name}`)
        data.repository[key] = branches.includes(name) ? ref(name) : null
      }
      return options.preflight ? options.preflight(data) : ok(data)
    }
    if (operation === 'DevelopmentCreateChangeRequest') {
      assert.deepEqual(Object.keys(v), ['input'])
      const data = v.input
      assert.deepEqual(Object.keys(data).sort(), ['baseRefName', 'body', 'headRefName', 'headRepositoryId', 'repositoryId', 'title'])
      assert.deepEqual([data.repositoryId, data.headRepositoryId], [repositoryId, repositoryId])
      assert.ok(branches.includes(data.headRefName) && branches.includes(data.baseRefName), '必须使用本仓分支')
      assert.notEqual(data.headRefName, data.baseRefName, 'GitHub 拒绝 head==base')
      assert.notEqual(commitOf(data.headRefName), commitOf(data.baseRefName), 'GitHub 拒绝没有差异提交的 pair')
      assert.ok(!objects.some((item) => item.state === 'OPEN' && item.headRefName === data.headRefName && item.baseRefName === data.baseRefName), 'GitHub 拒绝重复 OPEN pair')
      if (scenario.faults?.ambiguousCreate) throw new Error('unknown canary')
      if (options.mutation) return options.mutation(data)
      const created = node(data, objects.length + 1)
      objects.unshift(created)
      if (options.dropAck) throw new Error('dropped ack canary')
      return options.ack ? options.ack(structuredClone(created)) : ok({ createPullRequest: { pullRequest: structuredClone(created) } })
    }
    if (options.read) return options.read(request, objects)
    if (operation === 'DevelopmentRepository') return ok({ repository: { name: 'project', updatedAt: '2026-10-30T00:00:00Z', defaultBranchRef: { name: 'main' }, viewerPermission: 'ADMIN' } })
    if (operation === 'DevelopmentBranches') return ok({ repository: { refs: connection(branches.map((name) => ({ name, target: { oid: commitOf(name) } })), v) } })
    if (operation === 'DevelopmentCommit') return ok({ repository: { object: v.oid === sha ? { __typename: 'Commit', oid: sha, messageHeadline: 'head' } : null } })
    if (operation === 'DevelopmentChangeRequest') return ok({ repository: { id: repositoryId }, node: structuredClone(objects.find((item) => item.id === v.id) ?? null) })
    if (operation === 'DevelopmentChangeRequests') {
      const selected = objects.filter((item) => v.headRefName === null || item.headRefName === v.headRefName)
      return ok({ repository: { pullRequests: connection(selected, v) } })
    }
    throw new Error(`未注册操作 ${operation}`)
  }
  const connection = (items, v) => {
    const start = v.after === null ? 0 : Number(v.after)
    const end = start + v.first
    return { nodes: structuredClone(items.slice(start, end)), pageInfo: { hasNextPage: end < items.length, endCursor: String(end) } }
  }
  const make = (permissionMode = 'lazy') => createGithubDevelopmentProvider({ bindingId, repository: { externalId: repository.externalId, owner: 'example', name: 'project' }, transport, permissionMode, now: () => Date.parse('2026-10-30T00:00:00Z') })
  return { provider: make(), make, objects, calls, transport, preflight, node, mutations: () => calls.filter((call) => call.operationName === 'DevelopmentCreateChangeRequest') }
}
