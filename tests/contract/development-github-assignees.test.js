import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'
const repository = { bindingId: 'dev', objectKind: 'repository', externalId: 'repo', url: undefined }, changeRequest = { ...repository, objectKind: 'change_request', externalId: 'PR_1' }
const user = { id: 'U_1', login: 'allowed' }, page = (nodes, after = null) => ({ nodes, pageInfo: { hasNextPage: after !== null, endCursor: after } })
function fixture(options = {}) {
  const f = { calls: [], foreign: false, denied: false, loop: false, ids: [], ...options }
  f.provider = createGithubDevelopmentProvider({ bindingId: 'dev', repository: { externalId: 'repo', owner: 'example', name: 'project' }, permissionMode: 'lazy', transport: async request => {
    f.calls.push(request); if (f.denied) return { status: 403, headers: {}, body: {} }
    const repository = { id: 'R_1', nameWithOwner: 'example/project', assignableUsers: page([user], f.loop ? 'loop' : null) }
    const node = { id: 'PR_1', repository: { id: f.foreign ? 'R_other' : 'R_1' }, assignees: page(f.ids.map(id => ({ id, login: 'allowed' }))) }
    if (f.pageInfo) { repository.assignableUsers.pageInfo = f.pageInfo; node.assignees.pageInfo = f.pageInfo }
    if (request.operationName === 'DevelopmentAddAssignees') { f.ids.push(...request.variables.input.assigneeIds); return { status: 200, headers: {}, body: { data: { addAssigneesToAssignable: { assignable: { id: 'PR_1' } } } } } }
    const result = { status: 200, headers: {}, body: { data: { repository, node } } }
    return f.respond ? f.respond(result) : result
  } }); return f
}
test('assignee candidates preserve paging scope and distinguish unsupported from denied', async () => {
  const f = fixture({ loop: true }), first = await f.provider.listAssignableUsers({ repository, limit: 1, cursor: undefined }); assert.equal(first.ok, true)
  assert.equal((await f.provider.listAssignableUsers({ repository, limit: 2, cursor: first.value.nextCursor })).ok, false)
  f.denied = true; assert.equal((await f.provider.listAssignableUsers({ repository, limit: 1, cursor: undefined })).error.code, 'permission_denied')
})
test('foreign repository or PR identity causes zero assignment mutations', async () => {
  const f = fixture(); assert.equal(typeof f.provider.addChangeRequestAssignees, 'function'); f.foreign = true
  assert.equal((await f.provider.addChangeRequestAssignees({ repository, changeRequest, assigneeIds: ['U_1'] })).ok, false)
  assert.equal(f.calls.filter(c => c.operationName === 'DevelopmentAddAssignees').length, 0)
  f.foreign = false; assert.equal((await f.provider.addChangeRequestAssignees({ repository, changeRequest, assigneeIds: ['U_other'] })).ok, false)
  assert.equal((await f.provider.addChangeRequestAssignees({ repository, changeRequest, assigneeIds: ['U_1'] })).ok, true)
  assert.deepEqual((await f.provider.getChangeRequestAssignees({ repository, changeRequest })).value.users, [user])
})

test('late candidate permission receipt cannot restore identities after another request was denied', async () => {
  const releases = [], f = fixture({ respond: value => new Promise(resolve => releases.push(() => resolve(value))) })
  const old = f.provider.listAssignableUsers({ repository, limit: 10, cursor: undefined }); f.denied = true
  assert.equal((await f.provider.listAssignableUsers({ repository, limit: 10, cursor: undefined })).error.code, 'permission_denied'); releases[0]()
  const late = await old; assert.equal(late.ok, false); assert.doesNotMatch(JSON.stringify(late), /allowed/)
})

test('Fake optional assignee capabilities reject unsupported before foreign identity and keep read/add independent', async () => {
  const { createFakeDevelopmentProvider } = await import('@harness-projects/provider-fake')
  for (const [flag, method] of [['assigneeList', 'listAssignableUsers'], ['assigneeRead', 'getChangeRequestAssignees'], ['assigneeAdd', 'addChangeRequestAssignees']]) {
    const provider = createFakeDevelopmentProvider({ capabilities: { [flag]: false } })
    assert.equal((await provider[method]({ repository, changeRequest, assigneeIds: ['U_1'], limit: 10, cursor: undefined })).error.code, 'not_supported')
  }
})


for (const cursor of [undefined, null, '', 'loop']) test(`incomplete assignee pages reject directory/read/add without mutation: ${String(cursor)}`, async () => {
  const f = fixture(); f.ids = ['U_1']; f.pageInfo = { hasNextPage: true, ...(cursor === undefined ? {} : { endCursor: cursor }) }
  let listed = await f.provider.listAssignableUsers({ repository, limit: 10, cursor: undefined })
  if (cursor === 'loop') listed = await f.provider.listAssignableUsers({ repository, limit: 10, cursor: listed.value.nextCursor })
  const read = await f.provider.getChangeRequestAssignees({ repository, changeRequest })
  const add = await f.provider.addChangeRequestAssignees({ repository, changeRequest, assigneeIds: ['U_1'] })
  assert.deepEqual([listed.ok, read.ok, add.ok, f.calls.filter(c => c.operationName === 'DevelopmentAddAssignees').length], [false, false, false, 0])
})

test('overlapping denials cannot roll permission epochs backwards and release a late identity', async () => {
  const releases = [], provider = createGithubDevelopmentProvider({ bindingId: 'dev', repository: { externalId: 'repo', owner: 'example', name: 'project' }, permissionMode: 'lazy', transport: () => new Promise(resolve => releases.push(resolve)) })
  const input = { repository, limit: 10, cursor: undefined }, deny = { status: 403, headers: {}, body: {} }
  const a = provider.listAssignableUsers(input), b = provider.listAssignableUsers(input); releases[1](deny); await b
  const c = provider.listAssignableUsers(input), d = provider.listAssignableUsers(input); releases[3](deny); await d
  releases[0](deny); await a
  releases[2]({ status: 200, headers: {}, body: { data: { repository: { id: 'R_1', nameWithOwner: 'example/project', assignableUsers: page([{ id: 'U_1', login: 'epoch-canary' }]) } } } })
  const late = await c; assert.equal(late.ok, false); assert.doesNotMatch(JSON.stringify(late), /epoch-canary/)
  assert.equal((await provider.describeCapabilities()).permission['development.assignee.list'], 'unavailable')
})
