import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'

test('native target proves the project membership, exact Issue and repository without relationship scanning', async () => {
  const ref = (objectKind, externalId) => ({ bindingId: 'p', objectKind, externalId, url: undefined })
  const input = { project: ref('project', 'P'), membership: ref('project_item', 'M'), issue: ref('issue', 'I') }
  const repo = { id: 'R', nameWithOwner: 'example/project' }
  const content = { __typename: 'Issue', id: 'I', number: 545, repository: repo }
  let calls = 0, defect
  const provider = createGithubProjectsPlanningProvider({ bindingId: 'p', projectNodeId: 'P', transport: async (request) => {
    calls++; assert.equal(request.operationName, 'PlanningIssueLinkTarget')
    assert.doesNotMatch(request.query, /timelineItems|closedByPullRequestsReferences/)
    return { status: 200, headers: {}, body: { data: { project: { __typename: 'ProjectV2', id: 'P' }, membership: { __typename: 'ProjectV2Item', id: 'M', type: 'ISSUE', project: { id: 'P' }, content: { ...content, ...(defect === 'membership' ? { id: 'other' } : {}) } }, issue: { ...content, ...(defect === 'repository' ? { repository: { ...repo, id: 'other' } } : {}) } } } }
  } })
  assert.equal(typeof provider.getIssueLinkTarget, 'function')
  const result = await provider.getIssueLinkTarget(input)
  assert.equal(result.ok, true); assert.deepEqual(result.value, { source: input, nativeIssueIdentity: { namespace: 'github.com/graphql/Issue', id: 'I' }, number: 545, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R' }, name: 'example/project' } })
  for (defect of ['membership', 'repository']) assert.equal((await provider.getIssueLinkTarget(input)).ok, false)
  const before = calls; assert.equal((await provider.getIssueLinkTarget({ ...input, issue: ref('issue', '') })).ok, false); assert.equal(calls, before)
})
