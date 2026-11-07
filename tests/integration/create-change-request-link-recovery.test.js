import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from '../fixtures/change-request-world.mjs'

async function eligible(w) {
  w.providers.planning.getIssueLinkTarget = async (source) => ({ ok: true, value: { source, nativeIssueIdentity: { namespace: 'github.com/graphql/Issue', id: source.issue.externalId }, number: 545, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' }, name: 'example/project' } } })
  await w.compose()
}
for (const label of ['Fake', 'SQLite']) test(`reference is default, durable and independently unconfirmed without replay (${label})`, async (t) => {
  const w = await world(t, label, { dropAck: true }); await eligible(w)
  const before = await w.storage.listPlanningProjections(w.workspace.id)
  const options = await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'release' })
  assert.equal(options.defaultRelation, 'reference'); assert.equal(options.target.number, 545); assert.deepEqual(options.relations, ['reference', 'none'])
  assert.equal((await w.run({ base: 'release', issueRelation: 'closing' })).writeState, 'failed'); assert.equal(w.f.mutations().length, 0)
  assert.equal((await w.run({ issueRelation: 'reference', body: 'User body\nRefs #999' })).writeState, 'unknown')
  const saved = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  assert.equal(saved.externalIntent.issueSelection.relation, 'reference'); assert.match(saved.externalIntent.input.body, /^User body\nRefs #999\nRefs example\/project#545\n<!-- harness-pr-operation:/)
  await w.reopen()
  const result = await w.core.commands.resumeChangeRequest({ ...w.scope, operationId: saved.id, observer: { kind: 'user' } })
  assert.equal(result.phase, 'reconciled'); assert.equal(result.ref.externalId, 'PR_1'); assert.equal(result.relationState, 'unknown')
  assert.equal((await w.run({ issueRelation: 'closing' })).writeState, 'conflict'); assert.equal(w.f.mutations().length, 1)
  assert.deepEqual(await w.storage.listPlanningProjections(w.workspace.id), before)
})
test('none preserves text; forged, changed or inaccessible source cannot create an association', async (t) => {
  const w = await world(t); await eligible(w)
  assert.equal((await w.run({ issueRelation: 'none', body: 'Refs #999\n' })).writeState, 'confirmed')
  assert.match(w.f.objects[0].body, /^Refs #999\n\n<!-- harness-pr-operation:/)
  const other = await world(t); await eligible(other)
  other.providers.planning.getIssueLinkTarget = async (source) => ({ ok: true, value: { source: { ...source, issue: { ...source.issue, externalId: 'foreign' } }, nativeIssueIdentity: { namespace: 'github.com/graphql/Issue', id: 'foreign' }, number: 999, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' }, name: 'example/project' } } })
  assert.equal((await other.run({ issueRelation: 'reference' })).writeState, 'failed'); assert.equal(other.f.mutations().length, 0)
})
for (const relation of ['reference', 'closing']) test(`selected ${relation} fresh stream confirms independently of an unavailable other stream; denial keeps the created PR`, async t => {
  const w = await world(t); await eligible(w)
  const describe = w.providers.planning.describeCapabilities.bind(w.providers.planning)
  w.providers.planning.describeCapabilities = async () => { const s = await describe(); s.capability['planning.issue_closing_links.read'] = 'available'; s.permission['planning.issue_closing_links.read'] = 'available'; return s }
  let denied = false, visible = false, kind = relation === 'reference' ? 'native_reference' : 'native_closing'
  w.providers.planning.listIssueClosingLinks = async input => denied ? { ok: false, error: { code: 'permission_denied' } } : input.relationKind !== kind ? { ok: false, error: { code: 'unavailable' } } : { ok: true, value: { source: { project: input.project, membership: input.membership, issue: input.issue, repository: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' } }, items: (visible ? w.f.objects : []).map(pr => ({ nativeIdentity: { namespace: 'github.com/graphql/PullRequest', id: pr.id }, repository: { identity: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' }, name: 'example/project' }, number: pr.number, title: pr.title, url: pr.url, state: 'open', isDraft: pr.isDraft, provenance: 'source_observed', relation: kind, ...(kind === 'native_reference' ? { referenceWillCloseTarget: false } : {}) })) } }
  await w.compose()
  const created = await w.run({ issueRelation: relation }); assert.equal(created.writeState, 'confirmed'); assert.equal(created.value.relationState, 'unknown')
  const op = await w.core.queries.getChangeRequestOperation(w.scope)
  assert.equal(op.issueRelation, relation); assert.deepEqual(op.issueTarget, { repositoryName: 'example/project', number: 545 })
  visible = true
  assert.equal((await w.core.commands.resumeChangeRequest({ ...w.scope, operationId: op.operationId, observer: { kind: 'user' } })).relationState, 'confirmed')
  denied = true
  const retry = await w.core.commands.resumeChangeRequest({ ...w.scope, operationId: op.operationId, observer: { kind: 'user' } })
  assert.equal(retry.phase, 'reconciled'); assert.equal(retry.ref.externalId, 'PR_1'); assert.equal(retry.relationState, 'denied'); assert.equal(w.f.mutations().length, 1)
})
for (const defect of ['cross-repository', 'denied', 'draft', 'changed-after-save', 'stale-preview']) test(`association rejects ${defect} before native creation`, async t => {
  const w = await world(t); await eligible(w)
  const original = w.providers.planning.getIssueLinkTarget; let reads = 0
  const preview = await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })
  w.providers.planning.getIssueLinkTarget = async source => {
    const ack = await original(source); reads++
    if (defect === 'denied') return { ok: false, error: { code: 'permission_denied' } }
    if (defect === 'cross-repository') ack.value.repository.identity.id = 'foreign'
    if (defect === 'changed-after-save' && reads > 1 || defect === 'stale-preview') ack.value.number = 546
    return ack
  }
  if (defect === 'draft') { const id = (await w.storage.listIdentitiesForEntity(w.scope.workItemId)).find(i => i.role === 'primary'); await w.storage.putExternalIdentity({ ...id, role: 'historical' }); await w.storage.putExternalIdentity({ ...id, id: crypto.randomUUID(), externalKind: 'draft' }) }
  if (defect === 'stale-preview') assert.equal(typeof preview.targetStamp, 'string')
  const result = await w.run({ issueRelation: 'reference', ...(defect === 'stale-preview' ? { issueTargetStamp: preview.targetStamp } : {}) })
  assert.ok(['failed', 'conflict'].includes(result.writeState), JSON.stringify(result)); assert.equal(w.f.mutations().length, 0)
})
test('explicit close uses default branch, preserves unrelated user references and confirms only native closing', async t => {
  const w = await world(t); await eligible(w)
  const options = await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })
  assert.deepEqual(options.relations, ['reference', 'closing', 'none'])
  const result = await w.run({ issueRelation: 'closing', body: 'Refs #999\nCloses #123' })
  assert.equal(result.writeState, 'confirmed'); assert.equal(result.value.relationState, 'unknown')
  assert.match(w.f.objects[0].body, /^Refs #999\nCloses #123\nCloses example\/project#545\n<!-- harness-pr-operation:/)
})
for (const fault of ['before', 'during', 'item-cohort', 'during-cohort', 'policy']) test(`F1 current source denial ${fault} blocks options and associated mutation`, async t => {
  const w = await world(t); await eligible(w)
  let deny = fault === 'before' || fault === 'item-cohort'
  const describe = w.providers.planning.describeCapabilities.bind(w.providers.planning), target = w.providers.planning.getIssueLinkTarget
  w.providers.planning.describeCapabilities = async () => { const s = await describe(); s.permission['planning.item.read'] = deny ? 'unavailable' : 'available'; s.capability['planning.issue_closing_links.read'] = 'available'; s.permission['planning.issue_closing_links.read'] = 'available'; return s }
  w.providers.planning.getIssueLinkTarget = async source => { const ack = await target(source); if (fault === 'during') deny = true; if (fault === 'during-cohort') { deny = true; assert.equal((await w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })).state, 'denied'); deny = false } return ack }
  w.providers.planning.listIssueClosingLinks = async input => ({ ok: true, value: { source: { project: input.project, membership: input.membership, issue: input.issue, repository: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' } }, items: [] } })
  if (fault === 'policy') { w.policy = { 'planning.item.read': 'unavailable' }; await w.compose() }
  if (fault === 'item-cohort') assert.equal((await w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })).state, 'denied')
  if (fault === 'item-cohort') deny = false
  assert.equal((await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })).target, undefined)
  assert.equal((await w.run({ issueRelation: 'reference' })).writeState, 'failed'); assert.equal(w.f.mutations().length, 0)
  if (fault === 'item-cohort') { assert.equal((await w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })).state, 'complete'); assert.equal((await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })).target.number, 545) }
})
test('F2 target denial and restart hide durable target until explicit same-source proof restores disclosure', async t => {
  const w = await world(t, 'SQLite'); await eligible(w)
  assert.equal((await w.run({ issueRelation: 'reference' })).writeState, 'confirmed')
  const original = await w.storage.findMutationAttempt(w.workspace.id, 'create-1'), target = w.providers.planning.getIssueLinkTarget
  for (let attempt = 0; attempt < 2; attempt++) {
  let entered, release; const ready = new Promise(resolve => { entered = resolve }), hold = new Promise(resolve => { release = resolve })
  w.providers.planning.getIssueLinkTarget = async source => { entered(); await hold; return target(source) }
  const old = w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' }); await ready
  w.providers.planning.getIssueLinkTarget = async () => ({ ok: false, error: { code: 'permission_denied' } })
  assert.equal((await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })).target, undefined)
  assert.equal((await w.core.queries.getChangeRequestOperation(w.scope)).issueTarget, undefined)
  release(); assert.equal((await old).target, undefined)
  assert.equal((await w.core.queries.getChangeRequestOperation(w.scope)).issueTarget, undefined)
  }
  w.providers.planning.getIssueLinkTarget = target; await w.reopen()
  const masked = await w.core.queries.getChangeRequestOperation(w.scope); assert.equal(masked.issueRelation, 'reference'); assert.equal(masked.issueTarget, undefined)
  assert.equal((await w.core.commands.resumeChangeRequest({ ...w.scope, operationId: original.id, observer: { kind: 'user' } })).ref.externalId, 'PR_1')
  assert.deepEqual((await w.core.queries.getChangeRequestOperation(w.scope)).issueTarget, { repositoryName: 'example/project', number: 545 })
  assert.deepEqual((await w.storage.findMutationAttempt(w.workspace.id, 'create-1')).externalIntent, original.externalIntent); assert.equal(w.f.mutations().length, 1)
})
for (const state of ['pending', 'saved']) for (const stamped of [false, true]) test(`F3 changed current source conflicts with same-key ${state} create, stamp=${stamped}`, async t => {
  const w = await world(t, 'SQLite', { dropAck: state === 'pending' }); await eligible(w)
  await w.run({ issueRelation: 'reference' })
  const row = await w.storage.findMutationAttempt(w.workspace.id, 'create-1')
  if (state === 'pending') await w.storage.putMutationAttempt({ ...row, state: 'pending', externalIntent: { ...row.externalIntent, state: 'pending' } })
  const source = (await w.storage.listIdentitiesForEntity(w.scope.workItemId)).find(i => i.role === 'primary')
  await w.storage.putExternalIdentity({ ...source, role: 'historical' }); await w.storage.putExternalIdentity({ ...source, id: crypto.randomUUID(), externalId: 'replacement' })
  const member = (await w.storage.listMemberships(w.workspace.id, w.providers.planning.state.projects[0].ref.externalId)).find(m => m.contentExternalId === source.externalId)
  await w.storage.putMembership({ ...member, contentExternalId: 'replacement' })
  const options = await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' }); assert.equal(options.target.source.issue.externalId, 'replacement')
  assert.equal((await w.run({ issueRelation: 'reference', ...(stamped ? { issueTargetStamp: options.targetStamp } : {}) })).writeState, 'conflict')
  assert.equal((await w.core.commands.resumeChangeRequest({ ...w.scope, operationId: row.id, observer: { kind: 'user' } })).ref.externalId, 'PR_1')
  assert.equal(w.f.mutations().length, 1)
})

test('native relation denial alone preserves independently readable Issue options and summary', async t => {
  const w = await world(t); await eligible(w)
  const describe = w.providers.planning.describeCapabilities.bind(w.providers.planning)
  w.providers.planning.describeCapabilities = async () => { const s = await describe(); s.capability['planning.issue_closing_links.read'] = 'available'; s.permission['planning.issue_closing_links.read'] = 'available'; return s }
  w.providers.planning.listIssueClosingLinks = async () => ({ ok: false, error: { code: 'permission_denied' } })
  const created = await w.run({ issueRelation: 'reference' }); assert.equal(created.writeState, 'confirmed'); assert.equal(created.value.relationState, 'denied')
  assert.equal((await w.core.queries.getChangeRequestOperation(w.scope)).issueTarget.number, 545)
  assert.equal((await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })).target.number, 545)
  assert.equal((await w.core.queries.getIssueClosingLinks({ workItemId: w.scope.workItemId })).state, 'denied'); assert.equal(w.f.mutations().length, 1)
})
for (const relation of ['reference', 'closing']) test(`same-key create rechecks fresh target and default choice after ${relation}`, async t => {
  const w = await world(t); await eligible(w); await w.run({ issueRelation: relation })
  if (relation === 'reference') { const target = w.providers.planning.getIssueLinkTarget; w.providers.planning.getIssueLinkTarget = async source => { const ack = await target(source); ack.value.number = 546; return ack } }
  assert.equal((await w.run()).writeState, 'conflict'); assert.equal(w.f.mutations().length, 1)
})
for (const waiting of ['target', 'native']) test(`F4 newer exact-source not_found fences older ${waiting} success across callers`, async t => {
  const w = await world(t, 'SQLite'); await eligible(w)
  const target = w.providers.planning.getIssueLinkTarget, describe = w.providers.planning.describeCapabilities.bind(w.providers.planning)
  w.providers.planning.describeCapabilities = async () => { const s = await describe(); s.capability['planning.issue_closing_links.read'] = 'available'; s.permission['planning.issue_closing_links.read'] = 'available'; return s }
  w.providers.planning.listIssueClosingLinks = async () => ({ ok: false, error: { code: 'unavailable' } })
  assert.equal((await w.run({ issueRelation: 'reference' })).writeState, 'confirmed')
  const missing = async () => ({ ok: false, error: { code: 'not_found' } }), sourcePage = async input => ({ ok: true, value: { source: { project: input.project, membership: input.membership, issue: input.issue, repository: { namespace: 'github.com/graphql/Repository', id: 'R_synthetic' } }, items: [] } })
  w.providers.planning.listIssueClosingLinks = missing
  await w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })
  let entered, release; const ready = new Promise(resolve => { entered = resolve }), hold = new Promise(resolve => { release = resolve })
  if (waiting === 'target') w.providers.planning.getIssueLinkTarget = async input => { entered(); await hold; return target(input) }
  else w.providers.planning.listIssueClosingLinks = async input => { entered(); await hold; return sourcePage(input) }
  const old = waiting === 'target' ? w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' }) : w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })
  await ready
  if (waiting === 'target') await w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })
  else { w.providers.planning.getIssueLinkTarget = missing; assert.equal((await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })).target, undefined) }
  release(); const late = await old
  waiting === 'target' ? assert.equal(late.target, undefined) : assert.notEqual(late.state, 'complete')
  assert.equal((await w.core.queries.getChangeRequestOperation(w.scope)).issueTarget, undefined)
  w.providers.planning.getIssueLinkTarget = target; w.providers.planning.listIssueClosingLinks = sourcePage
  assert.equal((await w.core.commands.refreshIssueClosingLinks({ workItemId: w.scope.workItemId })).state, 'complete')
  assert.equal((await w.core.queries.getChangeRequestIssueOptions({ ...w.scope, base: 'main' })).target.number, 545)
  assert.equal((await w.core.queries.getChangeRequestOperation(w.scope)).issueTarget.number, 545); assert.equal(w.f.mutations().length, 1)
})
