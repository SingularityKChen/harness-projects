import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
const ref = (objectKind, externalId) => ({ bindingId: 'planning', objectKind, externalId, url: undefined })
const input = { project: ref('project', 'P'), membership: ref('project_item', 'M'), issue: ref('issue', 'I'), direction: 'blocked_by', limit: 100, cursor: undefined }
const repository = { id: 'R', nameWithOwner: 'example/source' }, target = { __typename: 'Issue', id: 'T', repository: { id: 'RO', nameWithOwner: 'other/project' }, number: 7, title: '<literal>', url: 'https://github.com/other/project/issues/7', state: 'CLOSED' }
const body = (nodes = [target], pageInfo = { hasNextPage: false, endCursor: null }) => ({
  data: {
    project: { __typename: 'ProjectV2', id: 'P' },
    membership: { __typename: 'ProjectV2Item', id: 'M', type: 'ISSUE', project: { id: 'P' }, content: { __typename: 'Issue', id: 'I', repository } },
    issue: { __typename: 'Issue', id: 'I', repository, blockedBy: { nodes, pageInfo }, blocking: { nodes, pageInfo } }
  }
})
function fixture(response = body()) {
  const requests = [], provider = createGithubProjectsPlanningProvider({ bindingId: 'planning', projectNodeId: 'P', transport: async request => { requests.push(request); return { status: 200, headers: {}, body: typeof response === 'function' ? await response(request) : response } } })
  assert.equal(typeof provider.listIssueDependencies, 'function', 'native Issue dependency port must exist')
  return { requests, provider, read: args => provider.listIssueDependencies(args === undefined ? input : args) }
}
test('native dependency streams preserve closed external Project targets and own their pagination', async () => {
  const h = fixture()
  for (const direction of ['blocked_by', 'blocking']) {
    const value = await h.read({ ...input, direction });
    assert.equal(value.ok, true)
    assert.equal(value.value.direction, direction);
    assert.equal(value.value.items[0].state, 'closed');
    assert.equal(value.value.items[0].repository.name, 'other/project')
    assert.deepEqual(value.value.source.issue, input.issue);
    assert.equal(value.value.items[0].nativeIdentity.namespace, 'github.com/graphql/Issue')
  }
  assert.match(h.requests[0].query, /blockedBy\(first: \$first, after: \$after\)/)
  assert.match(h.requests[1].query, /blocking\(first: \$first, after: \$after\)/)
  assert.ok(h.requests.every(r => !/mutation|totalCount|body|author/.test(r.query)))
})
test('input gates precede I/O and every empty page must prove the exact current source', async () => {
  const h = fixture()
  for (const args of [null, {}, { ...input, direction: 'hierarchy' }, { ...input, limit: 0 }, { ...input, cursor: '' }, ...['project', 'membership', 'issue'].map(k => ({ ...input, [k]: { ...input[k], bindingId: 'foreign' } }))]) assert.equal((await h.read(args)).ok, false)
  assert.equal(h.requests.length, 0)
  for (const mutate of [d => d.project.id = 'other', d => d.membership.id = 'other', d => d.membership.project.id = 'other', d => d.membership.content.id = 'alias', d => d.issue.id = 'other', d => d.membership.content.repository = { ...repository, id: 'other' }, d => d.issue = null]) {
    const response = structuredClone(body([])); mutate(response.data);
    assert.equal((await fixture(response).read()).ok, false)
  }
  assert.equal((await fixture(body([])).read()).ok, true)
})
test('malformed, restricted and partial GraphQL pages never become complete or leak diagnostics', async () => {
  for (const node of [null, { ...target, __typename: 'PullRequest' }, { ...target, state: 'UNKNOWN' }, { ...target, number: 0 }, { ...target, url: 'javascript:secret' }, { ...target, url: 'https://github.com/other/project/pull/7' }, { ...target, repository: null }]) assert.equal((await fixture(body([node])).read()).ok, false)
  for (const info of [{ hasNextPage: true, endCursor: null }, { hasNextPage: true, endCursor: 'same' }, { hasNextPage: 'false', endCursor: null }]) assert.equal((await fixture(body([], info)).read({ ...input, cursor: 'same' })).ok, false)
  const response = body(); response.errors = [{ type: 'FORBIDDEN', message: 'SECRET' }]
  const result = await fixture(response).read();
  assert.equal(result.error.code, 'permission_denied');
  assert.doesNotMatch(JSON.stringify(result), /SECRET/)
})

test('strict dependency client refuses unknown fields, wrong scope and stale completeness', async () => {
  const client = await import('@harness-projects/client')
  assert.equal(typeof client.createIssueDependenciesReader, 'function', 'production client must expose explicit refresh')
  const scope = { workspaceId: 'W', workItemId: 'I' }, stream = { state: 'complete', items: [], stale: false, observedAt: '2026-11-09T12:00:00.000Z' }
  const response = { workspaceId: 'W', workItemId: 'I', result: { writeState: 'local_only', saving: false, authoritative: false, value: { workItemId: 'I', blockedBy: stream, blocking: stream, parent: stream, children: stream } } }
  const reader = value => client.createIssueDependenciesReader({ refresh: async () => value })
  assert.equal((await reader(response).refresh(scope)).blockedBy.state, 'complete')
  for (const change of [v => v.workspaceId = 'foreign', v => v.result.value.hiddenCount = 9, v => v.result.value.blockedBy = { ...stream, stale: true }, v => v.result.value.blocking = { state: 'denied', items: [target], stale: true }]) {
    const v = structuredClone(response); change(v);
    await assert.rejects(() => reader(v).refresh(scope))
  }
})

test('source targets refuse dot path navigation and client rejects impossible observation dates', async () => {
  const node = { ...target, repository: { ...target.repository, nameWithOwner: '../project' }, url: 'https://github.com/../project/issues/7' }
  assert.equal((await fixture(body([node])).read()).ok, false)
  const { createIssueDependenciesReader } = await import('@harness-projects/client')
  const stream = { state: 'complete', items: [], stale: false, observedAt: '2026-02-30T00:00:00.000Z' }
  const reader = createIssueDependenciesReader({ refresh: async () => ({ workspaceId: 'W', workItemId: 'I', result: { writeState: 'local_only', saving: false, authoritative: false, value: { workItemId: 'I', blockedBy: stream, blocking: stream, parent: stream, children: stream } } }) })
  await assert.rejects(() => reader.refresh({ workspaceId: 'W', workItemId: 'I' }))
})

test('strict client refuses a canonical-looking URL with navigation dot segments', async () => {
  const { createIssueDependenciesReader } = await import('@harness-projects/client')
  const item = { nativeIdentity: { namespace: 'github.com/graphql/Issue', id: 'T' }, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R' }, name: '../project' }, number: 7, title: 'bad', state: 'closed', url: 'https://github.com/../project/issues/7' }
  const stream = { state: 'complete', items: [item], stale: false, observedAt: '2026-11-09T12:00:00.000Z' }
  const reader = createIssueDependenciesReader({ refresh: async () => ({ workspaceId: 'W', workItemId: 'I', result: { writeState: 'local_only', saving: false, authoritative: false, value: { workItemId: 'I', blockedBy: stream, blocking: stream, parent: stream, children: stream } } }) })
  await assert.rejects(() => reader.refresh({ workspaceId: 'W', workItemId: 'I' }))
})


test('parent uses singular nullable source proof and children use their own bounded connection', async () => {
  const response = body(); response.data.issue.parent = target
  response.data.issue.subIssues = { nodes: [target], pageInfo: { hasNextPage: true, endCursor: 'child-next' } }
  const h = fixture(response), parent = await h.read({ ...input, direction: 'parent' }), children = await h.read({ ...input, direction: 'children' })
  assert.equal(parent.ok, true); assert.equal(parent.value.items.length, 1); assert.equal(parent.value.nextCursor, undefined)
  assert.equal(children.ok, true); assert.equal(children.value.nextCursor, 'child-next')
  assert.equal(h.requests[0].operationName, 'PlanningIssueParent'); assert.match(h.requests[0].query, /parent\s*\{/)
  assert.doesNotMatch(h.requests[0].query, /\$first|\$after|pageInfo/)
  assert.equal(h.requests[1].operationName, 'PlanningIssueChildren'); assert.match(h.requests[1].query, /subIssues\(first: \$first, after: \$after\)/)
  response.data.issue.parent = null
  assert.deepEqual((await h.read({ ...input, direction: 'parent' })).value.items, [])
  for (const mutate of [d => delete d.issue.parent, d => d.membership.content.id = 'wrong', d => d.issue.parent = { ...target, url: 'javascript:bad' }]) {
    const bad = structuredClone(response); mutate(bad.data)
    assert.equal((await fixture(bad).read({ ...input, direction: 'parent' })).ok, false)
  }
  response.errors = [{ type: 'FORBIDDEN', message: 'SECRET' }]
  assert.equal((await h.read({ ...input, direction: 'parent' })).error.code, 'permission_denied')
  assert.equal((await fixture(response).read({ ...input, direction: 'parent', cursor: 'invalid' })).ok, false)
})

test('strict hierarchy wire requires both streams and refuses plural or denied parent facts', async () => {
  const { createIssueDependenciesReader } = await import('@harness-projects/client')
  const item = { nativeIdentity: { namespace: 'github.com/graphql/Issue', id: 'T' }, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'RO' }, name: 'other/project' }, number: 7, title: 'parent', state: 'closed', url: target.url }
  const complete = { state: 'complete', items: [], stale: false, observedAt: '2026-11-10T00:00:00.000Z' }
  const value = { workItemId: 'I', blockedBy: complete, blocking: complete, parent: { ...complete, items: [item] }, children: complete }
  const read = v => createIssueDependenciesReader({ refresh: async () => ({ workspaceId: 'W', workItemId: 'I', result: { writeState: 'local_only', saving: false, authoritative: false, value: v } }) }).refresh({ workspaceId: 'W', workItemId: 'I' })
  assert.equal((await read(value)).parent.items[0].title, 'parent')
  for (const change of [v => delete v.children, v => v.parent.items.push({ ...item, nativeIdentity: { ...item.nativeIdentity, id: 'T2' } }), v => v.parent = { state: 'denied', items: [item], stale: true }]) {
    const bad = structuredClone(value); change(bad); await assert.rejects(() => read(bad))
  }
})
