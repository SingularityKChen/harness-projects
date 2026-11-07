import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityKey } from '@harness-projects/capabilities'
import { createGithubProjectsPlanningProvider } from '@harness-projects/provider-planning-github-projects'

const ref = (objectKind, externalId) => ({ bindingId: 'planning', objectKind, externalId, url: undefined })
const input = { project: ref('project', 'P_current'), membership: ref('project_item', 'M_current'), issue: ref('issue', 'I_115'), cursor: undefined, limit: 10, relationKind: 'native_closing' }
const repository = { id: 'R_current', nameWithOwner: 'example/project' }
const pr = { __typename: 'PullRequest', id: 'PR_159', number: 159, title: '<b>literal</b>', url: 'https://github.com/example/project/pull/159', state: 'MERGED', isDraft: false, repository }
const body = (nodes = [pr], pageInfo = { hasNextPage: false, endCursor: null }) => structuredClone({ data: {
  project: { __typename: 'ProjectV2', id: 'P_current' },
  membership: { __typename: 'ProjectV2Item', id: 'M_current', type: 'ISSUE', project: { id: 'P_current' }, content: { __typename: 'Issue', id: 'I_115', repository } },
  issue: { __typename: 'Issue', id: 'I_115', repository, closedByPullRequestsReferences: { nodes, pageInfo } },
} })
const ok = (response) => ({ status: 200, headers: { 'x-github-request-id': 'ABCD:1234:5678:9ABC' }, body: response })
function setup(response = body()) {
  const requests = []
  const provider = createGithubProjectsPlanningProvider({ bindingId: 'planning', projectNodeId: 'P_current', transport: async (request) => {
    requests.push(request)
    // Strict request contract: explicitly retain CLOSED PR coverage. MERGED159 itself also appears with false in live readback.
    if (request.operationName === 'PlanningProject') return ok({ data: { node: { __typename: 'ProjectV2', id: 'P_current', title: 'Project', url: '', updatedAt: '2026-11-03T00:00:00Z' } } })
    assert.equal(request.operationName, 'PlanningIssueClosingLinks')
    assert.match(request.query, /closedByPullRequestsReferences\([^)]*includeClosedPrs: true/)
    assert.match(request.query, /userLinkedOnly: false/)
    assert.match(request.query, /excludeUserLinked: false/)
    assert.doesNotMatch(request.query, /timelineItems|willCloseTarget|totalCount|body|author|headRef/)
    return typeof response === 'function' ? response(request) : ok(response)
  } })
  return { provider, requests }
}
async function read(response, args = input) {
  const { provider } = setup(response)
  assert.equal(typeof provider.listIssueClosingLinks, 'function', 'optional source port must be implemented')
  return provider.listIssueClosingLinks(args)
}

test('closing source keeps historical159 and literal title with top-level proof even on empty page', async () => {
  for (const nodes of [[pr], []]) {
    const result = await read(body(nodes))
    assert.equal(result.ok, true)
    assert.equal(result.requestId, 'ABCD:1234:5678:9ABC')
    assert.deepEqual(result.value.source, { project: input.project, membership: input.membership, issue: input.issue,
      repository: { namespace: 'github.com/graphql/Repository', id: 'R_current' } })
    assert.equal(result.value.nextCursor, undefined)
    assert.deepEqual(result.value.items, nodes.length ? [{ nativeIdentity: { namespace: 'github.com/graphql/PullRequest', id: 'PR_159' },
      repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R_current' }, name: 'example/project' },
      number: 159, title: '<b>literal</b>', url: pr.url, state: 'merged', isDraft: false, provenance: 'source_observed', relation: 'native_closing' }] : [])
  }
})

test('closing source input binding/project/membership/Issue gates send zero requests', async () => {
  const { provider, requests } = setup()
  assert.equal(typeof provider.listIssueClosingLinks, 'function')
  for (const key of ['project', 'membership', 'issue']) for (const patch of [{ bindingId: 'foreign' }, { objectKind: 'change_request' }, { externalId: '' }]) {
    assert.equal((await provider.listIssueClosingLinks({ ...input, [key]: { ...input[key], ...patch } })).error.code, 'invalid_input')
  }
  for (const patch of [{ project: ref('project', 'P_other') }, { limit: 0 }, { limit: 1.5 }, { cursor: '' }, { cursor: 1 }]) {
    assert.equal((await provider.listIssueClosingLinks({ ...input, ...patch })).error.code, 'invalid_input')
  }
  assert.deepEqual(requests, [])
})

test('closing source verifies current membership/project/Issue/repository on every page including empty', async () => {
  const changes = [
    (d) => { d.project.id = 'P_other' }, (d) => { d.project.__typename = 'Issue' },
    (d) => { d.membership = null }, (d) => { d.issue = null },
    (d) => { d.membership.id = 'M_other' }, (d) => { d.membership.__typename = 'Issue' },
    (d) => { d.membership.project.id = 'P_other' }, (d) => { d.membership.type = 'PULL_REQUEST' },
    (d) => { d.membership.content.id = 'I_alias' }, (d) => { d.membership.content.__typename = 'PullRequest' },
    (d) => { d.issue.id = 'I_alias' }, (d) => { d.issue.__typename = 'PullRequest' },
    (d) => { d.membership.content.repository = { ...repository, id: 'R_other' } },
    (d) => { delete d.issue.repository.id },
  ]
  for (const change of changes) {
    const response = body([]); change(response.data)
    assert.equal((await read(response)).ok, false, change.toString())
  }
})

test('closing source strict decoding refuses null rows, bad enums, unsafe URLs, partial errors and stalled cursor', async () => {
  for (const nodes of [[null], [{ ...pr, __typename: 'Issue' }], [{ ...pr, state: 'FUTURE' }], [{ ...pr, isDraft: null }],
    [{ ...pr, number: 0 }], [{ ...pr, url: 'javascript:alert(1)' }], [{ ...pr, repository: null }]]) {
    assert.equal((await read(body(nodes))).error.rawClass, 'malformed_response')
  }
  for (const info of [{ hasNextPage: true, endCursor: null }, { hasNextPage: true, endCursor: '' }, { hasNextPage: true, endCursor: 'same' }, { hasNextPage: 'false', endCursor: null }]) {
    assert.equal((await read(body([], info), { ...input, cursor: 'same' })).ok, false)
  }
  const partial = body(); partial.errors = [{ type: 'FORBIDDEN', message: 'private secret' }]
  const failure = await read(partial)
  assert.equal(failure.error.code, 'permission_denied')
  assert.equal(JSON.stringify(failure).includes('private secret'), false)
})

test('closing source paginates source connection rows and clamps limit', async () => {
  const { provider, requests } = setup((request) => request.variables.after === null
    ? ok(body([pr], { hasNextPage: true, endCursor: 'page2' }))
    : ok(body([{ ...pr, id: 'PR_manual', number: 160, state: 'OPEN', isDraft: true }, { ...pr, id: 'PR_nondefault', number: 161, state: 'CLOSED' }])))
  assert.equal(typeof provider.listIssueClosingLinks, 'function')
  const first = await provider.listIssueClosingLinks({ ...input, limit: 1000 })
  const second = await provider.listIssueClosingLinks({ ...input, cursor: first.value.nextCursor })
  assert.deepEqual([first.value.items[0].number, ...second.value.items.map((x) => x.number)], [159, 160, 161])
  assert.deepEqual(requests.map((x) => x.variables), [
    { project: 'P_current', membership: 'M_current', issue: 'I_115', first: 100, after: null },
    { project: 'P_current', membership: 'M_current', issue: 'I_115', first: 10, after: 'page2' },
  ])
  assert.equal(second.value.nextCursor, undefined)
  assert.deepEqual(second.value.source, first.value.source)
})

test('closing source permission evidence is independent from Project visibility and recovers after actual ack', async () => {
  let deny = true
  const { provider } = setup(() => deny ? { status: 403, headers: {}, body: { message: 'denied' } } : ok(body([])))
  assert.equal(typeof provider.listIssueClosingLinks, 'function')
  const key = CapabilityKey.PlanningIssueClosingLinksRead
  assert.equal((await provider.describeCapabilities()).permission[key], 'degraded')
  assert.equal((await provider.listIssueClosingLinks(input)).error.code, 'permission_denied')
  assert.equal((await provider.describeCapabilities()).permission[key], 'unavailable')
  deny = false
  assert.equal((await provider.listIssueClosingLinks(input)).ok, true)
  assert.equal((await provider.describeCapabilities()).permission[key], 'available')
})


test('closing source snapshots identity before await and sanitizes response request IDs', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { provider } = setup(async () => { await gate; return { ...ok(body([])), headers: { 'x-github-request-id': 'secret-canary' } } })
  const mutable = structuredClone(input)
  const pending = provider.listIssueClosingLinks(mutable)
  mutable.issue.externalId = 'I_foreign'
  release()
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.value.source.issue.externalId, 'I_115')
  assert.equal(JSON.stringify(result).includes('secret-canary'), false)
})


test('late older source success cannot erase a newer denial receipt', async () => {
  let release, calls = 0
  const gate = new Promise((resolve) => { release = resolve })
  const { provider } = setup(async () => ++calls === 1 ? (await gate, ok(body([]))) : { status: 403, headers: {}, body: {} })
  const older = provider.listIssueClosingLinks(input)
  assert.equal((await provider.listIssueClosingLinks(input)).error.code, 'permission_denied')
  release(); await older
  assert.equal((await provider.describeCapabilities()).permission[CapabilityKey.PlanningIssueClosingLinksRead], 'unavailable')
})


test('source proof never promotes caller supplied URLs into an authoritative receipt', async () => {
  const args = { ...input, issue: { ...input.issue, url: 'javascript:secret-canary' } }
  const result = await read(body([]), args)
  assert.equal(result.ok, true)
  assert.equal(result.value.source.issue.url, undefined)
})


test('closing source refuses identical and conflicting duplicate native identities in one page', async () => {
  for (const patch of [{}, { number: 160 }, { state: 'OPEN' }, { repository: { id: 'R_foreign', nameWithOwner: 'foreign/repository' } }]) {
    const { provider } = setup(body([pr, { ...pr, ...patch }]))
    const result = await provider.listIssueClosingLinks(input)
    assert.equal(result.ok, false)
    assert.equal(result.error.rawClass, 'malformed_response')
    assert.equal(result.value, undefined, 'no partial source page is published')
    assert.equal((await provider.describeCapabilities()).permission[CapabilityKey.PlanningIssueClosingLinksRead], 'degraded')
  }
})


test('closing source malformed input returns safe invalid_input with zero transport', async () => {
  const { provider, requests } = setup()
  const cases = [null, undefined, {}, ...['project', 'membership', 'issue'].flatMap((key) => [{ ...input, [key]: null }, { ...input, [key]: undefined }])]
  for (const args of cases) {
    const result = await provider.listIssueClosingLinks(args)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid_input')
  }
  assert.deepEqual(requests, [])
})

test('closing source throwing input accessors never reject or expose raw errors', async () => {
  const canary = 'raw-private-error-canary'
  const trap = (value, key) => Object.defineProperty({ ...value }, key, { get() { throw new Error(canary) } })
  const { provider, requests } = setup()
  for (const args of [trap(input, 'issue'), trap(input, 'cursor'), trap(input, 'limit'), { ...input, issue: trap(input.issue, 'externalId') }]) {
    const result = await provider.listIssueClosingLinks(args)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid_input')
    assert.equal(JSON.stringify(result).includes(canary), false)
  }
  assert.deepEqual(requests, [])
})


for (const scope of ['same Issue', 'another Issue']) for (const finish of ['offline', 'success', 'success before denial']) {
  test(`source actual denial survives newer pending ${scope}: ${finish}; only a post-denial read recovers`, async () => {
    let resolveOlder, resolveNewer, rejectNewer, calls = 0
    const olderGate = new Promise((resolve) => { resolveOlder = resolve })
    const newerGate = new Promise((resolve, reject) => { resolveNewer = resolve; rejectNewer = reject })
    const pageFor = (request) => {
      const response = body([]), { membership, issue } = request.variables
      response.data.membership.id = membership; response.data.membership.content.id = issue; response.data.issue.id = issue
      return ok(response)
    }
    let newerRequest
    const { provider } = setup((request) => ++calls === 2 ? olderGate : calls === 3 ? (newerRequest = request, newerGate) : pageFor(request))
    const read = (args = input) => provider.listIssueClosingLinks(args)
    const permission = async () => (await provider.describeCapabilities()).permission[CapabilityKey.PlanningIssueClosingLinksRead]
    assert.equal((await read()).ok, true); assert.equal(await permission(), 'available')
    const older = read(), newer = read(scope === 'same Issue' ? input : { ...input, membership: ref('project_item', 'M_other'), issue: ref('issue', 'I_other') })
    let newerResult
    if (finish === 'success before denial') {
      resolveNewer(pageFor(newerRequest)); newerResult = await newer
      assert.equal(await permission(), 'available')
    }
    resolveOlder({ status: 403, headers: {}, body: {} })
    assert.equal((await older).error.code, 'permission_denied')
    const afterDenial = await permission()
    if (!newerResult) {
      if (finish === 'offline') rejectNewer(new Error('offline-canary'))
      else resolveNewer(pageFor(newerRequest))
      newerResult = await newer
    }
    const afterInflight = await permission()
    assert.equal(newerResult.ok, finish !== 'offline')
    if (!newerResult.ok) assert.equal(newerResult.error.code, 'unavailable')
    assert.equal((await read()).ok, true)
    assert.deepEqual({ afterDenial, afterInflight, recovered: await permission() }, { afterDenial: 'unavailable', afterInflight: 'unavailable', recovered: 'available' })
  })
}
