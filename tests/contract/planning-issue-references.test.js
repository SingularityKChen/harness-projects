import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'
const ref = (objectKind, externalId) => ({ bindingId: 'planning', objectKind, externalId, url: undefined })
const input = { project: ref('project', 'P'), membership: ref('project_item', 'M'), issue: ref('issue', 'I545'), relationKind: 'native_reference', cursor: undefined, limit: 10 }
const repository = { id: 'R', nameWithOwner: 'example/project' }
const source = { __typename: 'PullRequest', id: 'PR555', number: 555, title: 'Refs only', url: 'https://github.com/example/project/pull/555', state: 'OPEN', isDraft: true, repository }
const event = (over = {}) => ({ __typename: 'CrossReferencedEvent', target: { __typename: 'Issue', id: 'I545' }, source, willCloseTarget: false, ...over })
const body = (nodes, pageInfo = { hasNextPage: false, endCursor: null }) => ({ data: { project: { __typename: 'ProjectV2', id: 'P' }, membership: { __typename: 'ProjectV2Item', id: 'M', type: 'ISSUE', project: { id: 'P' }, content: { __typename: 'Issue', id: 'I545', repository } }, issue: { __typename: 'Issue', id: 'I545', repository, timelineItems: { nodes, pageInfo } } } })
async function read(nodes, pageInfo, patch = {}) {
  const provider = createGithubProjectsPlanningProvider({ bindingId: 'planning', projectNodeId: 'P', transport: async request => {
    assert.equal(request.operationName, 'PlanningIssueReferences')
    assert.match(request.query, /timelineItems\(first: \$first, after: \$after, itemTypes: \[CROSS_REFERENCED_EVENT\]\)/)
    assert.doesNotMatch(request.query, /body|author|headRef/)
    return { status: 200, headers: {}, body: body(nodes, pageInfo) }
  } })
  return provider.listIssueClosingLinks({ ...input, ...patch })
}
test('native false reference #555 to #545 is visible and non PR sources are filtered', async () => {
  const result = await read([event(), event({ source: { __typename: 'Issue', id: 'I_other' } })])
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.items.map(x => [x.number, x.relation, x.referenceWillCloseTarget]), [[555, 'native_reference', false]])
})
test('reference source validates target, event Boolean, outer proof and independent cursor', async () => {
  for (const bad of [event({ target: { __typename: 'Issue', id: 'I_other' } }), event({ target: { __typename: 'PullRequest', id: 'I545' } }), event({ willCloseTarget: undefined }), event({ source: null }), null]) assert.equal((await read([bad])).ok, false)
  assert.equal((await read([event()], { hasNextPage: true, endCursor: 'next' })).value.nextCursor, 'next')
  for (const endCursor of ['', null, 'same']) assert.equal((await read([], { hasNextPage: true, endCursor }, { cursor: 'same' })).ok, false)
  assert.equal((await read([], undefined, { relationKind: 'implements' })).error.code, 'invalid_input')
})
