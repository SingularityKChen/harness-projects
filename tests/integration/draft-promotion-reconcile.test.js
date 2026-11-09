import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeCore, contextIdFor, runIdFor, PLANNING_SYNC_SCOPE } from '@harness-projects/core'
import { createFakeProviders, FakeFixtureName } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

const workspace = { id: 'draft-promotion', name: 'Draft promotion' }
const sourceNumber = { sourceName: 'GitHub', scopeIdentity: { namespace: 'github.com/graphql/Repository', id: 'repository-one' }, scopeName: 'example/one', number: 449 }

async function setup(t, adapter) {
  const dir = mkdtempSync(join(tmpdir(), 'draft-promotion-'))
  const providers = createFakeProviders({ planning: { fixture: FakeFixtureName.DraftBacked } })
  const path = join(dir, 'data.sqlite')
  const w = { providers, workspace, storage: adapter === 'SQLite' ? createSqliteStorage(path) : providers.storage, clock: () => '2026-11-09T12:00:00Z' }
  t.after(() => { w.storage.close?.(); rmSync(dir, { recursive: true, force: true }) })
  w.core = await composeCore(w)
  w.draft = providers.planning.state.items.find(item => item.ref.externalId === 'draft-1')
  w.original = await w.storage.findExternalIdentity(providers.planning.bindingId, 'draft', 'draft-1')
  assert.ok(w.original, 'first production sync registers the draft')
  w.reopen = async () => { w.storage.close(); w.storage = createSqliteStorage(path); w.core = await composeCore(w) }
  return w
}

function convert(w, target = 'issue-promoted') {
  assert.equal(w.providers.planning.promoteDraft(w.draft.ref, target).ok, true)
  const item = w.providers.planning.state.items.find(item => item.ref.externalId === target)
  item.content.workItem = { ...item.content.workItem, title: 'Promoted issue', sourceNumber }
  return item
}

async function committed(w) {
  const binding = w.providers.planning.bindingId, round = await w.storage.getPlanningSyncRound(workspace.id, binding, PLANNING_SYNC_SCOPE)
  return {
    identities: await w.storage.listIdentitiesForEntity(w.original.entityId),
    issue: await w.storage.findExternalIdentity(binding, 'issue', 'issue-promoted'),
    memberships: await w.storage.listMemberships(workspace.id, w.draft.project.externalId),
    projections: await w.storage.listPlanningProjections(workspace.id),
    revision: await w.storage.currentRevision(workspace.id),
    reconcile: await w.storage.getReconcileCursor(workspace.id),
    committedRound: round.latestCommittedRound,
    relations: await w.storage.listRelations(workspace.id),
    attempts: await w.storage.listMutationAttempts(workspace.id),
  }
}

for (const adapter of ['Fake Storage', 'SQLite']) {
  // Missing production promotion would replace the entity and strand the existing execution lineage.
  test(`${adapter}: refreshPlanning promotes the same membership without changing entity or execution lineage`, async t => {
    const w = await setup(t, adapter), id = w.original.entityId
    assert.equal((await w.core.commands.startWork({ workItemId: id, repositoryId: 'repo-alpha', task: 'Synthetic explicit task', actor: { kind: 'human' }, idempotencyKey: 'draft-work' })).writeState, 'saved')
    const contextId = contextIdFor(workspace.id, id, 'repo-alpha'), runId = runIdFor(contextId)
    const context = await w.storage.getExecutionContext(contextId), run = await w.storage.getExecutionRun(runId)
    const relations = await w.storage.listRelations(workspace.id), attempts = await w.storage.listMutationAttempts(workspace.id)
    assert.ok(context); assert.ok(run); assert.equal(relations.length, 2)
    convert(w)
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    const assertContinuity = async () => {
      const issue = await w.storage.findExternalIdentity(w.providers.planning.bindingId, 'issue', 'issue-promoted')
      assert.equal(issue?.entityId, id, 'production refresh must retain the original draft entity')
      assert.deepEqual(await w.storage.findExternalIdentity(w.providers.planning.bindingId, 'draft', 'draft-1'), { ...w.original, role: 'historical' })
      const identities = await w.storage.listIdentitiesForEntity(id)
      assert.deepEqual(identities.filter(i => i.role === 'primary').map(i => [i.externalKind, i.externalId]), [['issue', 'issue-promoted']])
      assert.equal(identities.length, 2)
      assert.deepEqual(await w.storage.getExecutionContext(contextId), context)
      assert.deepEqual(await w.storage.findActiveExecutionContext(workspace.id, id, 'repo-alpha'), context)
      assert.deepEqual(await w.storage.getExecutionRun(runId), run)
      assert.deepEqual(await w.storage.listRelations(workspace.id), relations)
      assert.deepEqual(await w.storage.listMutationAttempts(workspace.id), attempts)
      const view = (await w.core.queries.listPlanningItems()).find(item => item.entityId === id)
      assert.equal(view?.content.title, 'Promoted issue')
      assert.equal(view?.content.identity.externalId, 'issue-promoted')
      assert.deepEqual(view?.content.sourceNumber, sourceNumber)
      assert.equal((await w.storage.getMembership(workspace.id, w.draft.membership.externalId)).contentExternalId, 'issue-promoted')
    }
    await assertContinuity()
    const first = await committed(w)
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    assert.equal((await committed(w)).revision, first.revision, 'same snapshot must not advance content revision')
    await assertContinuity()
    if (adapter === 'SQLite') { await w.reopen(); await assertContinuity() }
  })

  // A known Issue ref proves identity even when its content is hidden; gating on visibility strands the lineage.
  test(`${adapter}: known redacted Issue promotes identity and keeps content hidden through recovery and reopen`, async t => {
    const w = await setup(t, adapter), id = w.original.entityId
    w.draft.content.workItem = { ...w.draft.content.workItem, title: 'DRAFT-PRIVATE-TITLE', body: 'DRAFT-PRIVATE-BODY' }
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    assert.equal((await w.core.commands.startWork({ workItemId: id, repositoryId: 'repo-alpha', task: 'Synthetic explicit task', actor: { kind: 'human' }, idempotencyKey: 'redacted-draft-work' })).writeState, 'saved')
    const contextId = contextIdFor(workspace.id, id, 'repo-alpha'), runId = runIdFor(contextId)
    const context = await w.storage.getExecutionContext(contextId), run = await w.storage.getExecutionRun(runId)
    const relations = await w.storage.listRelations(workspace.id), attempts = await w.storage.listMutationAttempts(workspace.id)
    assert.ok(context); assert.ok(run); assert.equal(relations.length, 2)
    const item = convert(w)
    item.content.workItem.body = 'ISSUE-PRIVATE-BODY'
    const visible = structuredClone(item.content)
    item.content = { kind: 'redacted', reason: 'permission_denied' }
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    const assertContinuity = async () => {
      assert.equal((await w.storage.findExternalIdentity(w.providers.planning.bindingId, 'issue', 'issue-promoted'))?.entityId, id, 'known Issue identity must retain the original draft entity while redacted')
      assert.deepEqual(await w.storage.findExternalIdentity(w.providers.planning.bindingId, 'draft', 'draft-1'), { ...w.original, role: 'historical' })
      assert.deepEqual((await w.storage.listIdentitiesForEntity(id)).filter(identity => identity.role === 'primary').map(identity => [identity.externalKind, identity.externalId]), [['issue', 'issue-promoted']])
      assert.deepEqual(await w.storage.getExecutionContext(contextId), context)
      assert.deepEqual(await w.storage.findActiveExecutionContext(workspace.id, id, 'repo-alpha'), context)
      assert.deepEqual(await w.storage.getExecutionRun(runId), run)
      assert.deepEqual(await w.storage.listRelations(workspace.id), relations)
      assert.deepEqual(await w.storage.listMutationAttempts(workspace.id), attempts)
      assert.equal((await w.storage.getMembership(workspace.id, item.membership.externalId)).contentExternalId, 'issue-promoted')
    }
    const assertHidden = async () => {
      await assertContinuity()
      const projections = await w.storage.listPlanningProjections(workspace.id), views = await w.core.queries.listPlanningItems()
      assert.deepEqual(projections.find(row => row.entityId === id)?.content, { contentKind: 'redacted', reason: 'permission_denied' })
      const content = views.find(row => row.entityId === id)?.content
      assert.equal(content?.contentKind, 'redacted')
      assert.equal(content.title, undefined); assert.equal(content.body, undefined); assert.equal(content.sourceNumber, undefined)
      assert.doesNotMatch(JSON.stringify([projections, views]), /DRAFT-PRIVATE|ISSUE-PRIVATE|Promoted issue/)
    }
    await assertHidden()
    const revision = await w.storage.currentRevision(workspace.id)
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    assert.equal(await w.storage.currentRevision(workspace.id), revision, 'repeat hidden observation is idempotent')
    await assertHidden()
    if (adapter === 'SQLite') { await w.reopen(); await assertHidden() }
    item.content = visible
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    await assertContinuity()
    const restored = (await w.core.queries.listPlanningItems()).find(row => row.entityId === id)
    assert.equal(restored?.content.title, 'Promoted issue'); assert.equal(restored?.content.body, 'ISSUE-PRIVATE-BODY')
    assert.equal(restored?.content.identity.externalId, 'issue-promoted'); assert.deepEqual(restored?.content.sourceNumber, sourceNumber)
    if (adapter === 'SQLite') { await w.reopen(); await assertContinuity() }
  })

  test(`${adapter}: occupied issue identity rejects the whole promotion round`, async t => {
    const w = await setup(t, adapter), binding = w.providers.planning.bindingId
    const occupied = await w.storage.findExternalIdentity(binding, 'issue', 'issue-9')
    const before = await committed(w)
    convert(w, 'issue-9')
    const result = await w.core.commands.refreshPlanning()
    assert.deepEqual([result.ok, result.error?.code], [false, 'conflict'])
    assert.deepEqual(await committed(w), before, 'no identity, membership, projection or committed cursor may partially publish')
    assert.deepEqual(await w.storage.findExternalIdentity(binding, 'issue', 'issue-9'), occupied)
  })

  test(`${adapter}: failure on the second promotion identity write rolls back the first`, async t => {
    const w = await setup(t, adapter), before = await committed(w)
    convert(w)
    const transaction = w.storage.transaction.bind(w.storage)
    let writes = 0
    w.storage.transaction = work => transaction(tx => work(new Proxy(tx, {
      get(target, key) {
        if (key === 'putExternalIdentity') return async identity => {
          writes++
          if (writes === 2) throw new Error('synthetic second identity write failure')
          return target.putExternalIdentity(identity)
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })))
    const result = await w.core.commands.refreshPlanning()
    assert.deepEqual([result.ok, result.error?.code], [false, 'unavailable'])
    assert.equal(writes, 2, 'fault is reached after one identity write, not during fixture setup')
    assert.deepEqual(await committed(w), before)
    w.storage.transaction = transaction
    assert.equal((await w.core.commands.refreshPlanning()).ok, true, 'same provider snapshot can retry after rollback')
    assert.equal((await w.storage.findExternalIdentity(w.providers.planning.bindingId, 'issue', 'issue-promoted')).entityId, w.original.entityId)
  })

  test(`${adapter}: promotion reuses a target issue alias already owned by the original entity`, async t => {
    const w = await setup(t, adapter)
    await w.storage.putExternalIdentity({ ...w.original, id: 'existing-issue-alias', externalKind: 'issue', externalId: 'issue-promoted', role: 'alias' })
    convert(w)
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    const identities = await w.storage.listIdentitiesForEntity(w.original.entityId)
    assert.equal(identities.length, 2)
    assert.deepEqual(identities.filter(identity => identity.role === 'primary').map(identity => identity.id), ['existing-issue-alias'])
  })

  test(`${adapter}: mixed content ref binding cannot promote a foreign registered draft`, async t => {
    const w = await setup(t, adapter)
    const foreignProviders = createFakeProviders({ planning: { bindingId: 'planning-foreign', fixture: FakeFixtureName.DraftBacked } })
    const foreignWorkspace = { id: 'foreign-workspace', name: 'Foreign workspace' }
    await composeCore({ ...w, workspace: foreignWorkspace, providers: foreignProviders })
    const foreign = await w.storage.findExternalIdentity('planning-foreign', 'draft', 'draft-1')
    assert.ok(foreign)
    const foreignFacts = async () => ({
      identities: await w.storage.listIdentitiesForEntity(foreign.entityId),
      target: await w.storage.findExternalIdentity('planning-foreign', 'issue', 'issue-promoted'),
      memberships: await w.storage.listMemberships(foreignWorkspace.id, w.draft.project.externalId),
      projections: await w.storage.listPlanningProjections(foreignWorkspace.id),
      revision: await w.storage.currentRevision(foreignWorkspace.id),
      reconcile: await w.storage.getReconcileCursor(foreignWorkspace.id),
      round: await w.storage.getPlanningSyncRound(foreignWorkspace.id, 'planning-foreign', PLANNING_SYNC_SCOPE),
    })
    const before = await committed(w), foreignBefore = await foreignFacts()
    convert(w).ref.bindingId = 'planning-foreign'
    const result = await w.core.commands.refreshPlanning()
    assert.deepEqual([result.ok, result.error?.code], [false, 'invalid_input'])
    assert.deepEqual(await committed(w), before, 'current binding must publish no business facts')
    assert.deepEqual(await foreignFacts(), foreignBefore, 'foreign binding must retain its primary draft and all committed facts')
  })

  test(`${adapter}: persisted issue alias before draft primary promotes without depending on row order`, async t => {
    const w = await setup(t, adapter), entityId = 'alias-first-entity', bindingId = w.providers.planning.bindingId
    await w.storage.transaction(async tx => {
      await tx.putEntity({ id: entityId, kind: 'work_item' })
      await tx.putExternalIdentity({ id: 'earlier-issue-alias', entityId, bindingId, externalKind: 'issue', externalId: 'issue-promoted', role: 'alias' })
      await tx.putExternalIdentity({ id: 'later-draft-primary', entityId, bindingId, externalKind: 'draft', externalId: 'draft-alias-first', role: 'primary' })
      const membership = await tx.getMembership(workspace.id, w.draft.membership.externalId)
      await tx.putMembership({ ...membership, contentExternalId: 'draft-alias-first' })
    })
    convert(w)
    assert.equal((await w.core.commands.refreshPlanning()).ok, true, 'valid alias-first persistent state must promote')
    const identities = await w.storage.listIdentitiesForEntity(entityId)
    assert.deepEqual(identities.map(identity => [identity.id, identity.externalKind, identity.role]).sort(), [
      ['earlier-issue-alias', 'issue', 'primary'], ['later-draft-primary', 'draft', 'historical'],
    ])
    assert.equal((await w.core.queries.listPlanningItems()).find(item => item.content.identity.externalId === 'issue-promoted')?.entityId, entityId)
    assert.equal((await w.core.commands.refreshPlanning()).ok, true)
    assert.deepEqual(await w.storage.listIdentitiesForEntity(entityId), identities, 'repeat refresh preserves the existing identity ids')
  })

  for (const control of ['same title only', 'different project', 'different binding', 'missing draft identity', 'mismatched visible content', 'unknown project item', 'unseen project item', 'historical draft', 'alias draft']) {
    test(`${adapter}: ${control} is insufficient evidence for promotion`, async t => {
      const w = await setup(t, adapter)
      const item = convert(w)
      if (control === 'same title only') item.membership = { ...item.membership, externalId: 'other-membership' }
      if (control === 'different project' || control === 'missing draft identity') {
        const membership = await w.storage.getMembership(workspace.id, w.draft.membership.externalId)
        await w.storage.putMembership({ ...membership, ...(control === 'different project' ? { projectExternalId: 'project-other' } : { contentExternalId: 'draft-unknown' }) })
      }
      if (control === 'different binding') {
        const old = (await w.storage.listProviderBindings(workspace.id)).find(binding => binding.domain === 'planning')
        await w.storage.putProviderBinding({ ...old, enabled: false, isDefault: false })
        const providers = createFakeProviders({ planning: { bindingId: 'planning-other', fixture: FakeFixtureName.DraftBacked } })
        providers.planning.promoteDraft(providers.planning.state.items.find(i => i.ref.externalId === 'draft-1').ref, 'issue-promoted')
        w.core = await composeCore({ ...w, providers })
      }
      if (control === 'mismatched visible content') item.content = { kind: 'change_request', changeRequest: { externalId: item.ref.externalId, number: 449, title: 'Mismatched content', body: '' } }
      if (control.endsWith('project item')) {
        if (control === 'unseen project item') item.membership = { ...item.membership, externalId: 'unseen-membership' }
        item.ref = { ...item.ref, objectKind: 'project_item', externalId: item.membership.externalId }
        item.content = { kind: 'redacted', reason: 'permission_denied' }
      }
      if (control.endsWith('draft')) {
        await w.storage.putExternalIdentity({ ...w.original, role: control.startsWith('historical') ? 'historical' : 'alias' })
      }
      assert.equal((await w.core.commands.refreshPlanning()).ok, true)
      const binding = control === 'different binding' ? 'planning-other' : w.providers.planning.bindingId
      assert.notEqual((await w.storage.findExternalIdentity(binding, 'issue', 'issue-promoted'))?.entityId, w.original.entityId)
      assert.equal((await w.storage.findExternalIdentity(w.providers.planning.bindingId, 'draft', 'draft-1')).role, control.startsWith('historical') ? 'historical' : control.startsWith('alias') ? 'alias' : 'primary')
      if (control.endsWith('project item')) {
        assert.equal(await w.storage.findExternalIdentity(binding, 'project_item', item.membership.externalId), undefined, 'unknown content identity must not be invented from membership')
        assert.equal(await w.storage.findExternalIdentity(binding, 'issue', 'issue-promoted'), undefined)
        const view = (await w.core.queries.listPlanningItems()).find(row => row.entityId === w.original.entityId)
        if (control === 'unknown project item') assert.equal(view?.content.contentKind, 'redacted')
        else assert.equal(view, undefined, 'unseen membership cannot create a content entity')
      }
    })
  }
}
