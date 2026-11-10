import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createContext } from '../../packages/core/src/context.ts'
import { refreshIssueDependencies } from '../../packages/core/src/issue-dependencies.ts'
import { issueSourceReadAccess, issueClosingLinksAccessVersion, issueAuthorityReadAccess } from '../../packages/core/src/issue-closing-links.ts'
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
import { CapabilityKey as K, providerOk, providerErr, providerError } from '@harness-projects/capabilities'
const gate = () => Promise.withResolvers()
const repository = { namespace: 'github.com/graphql/Repository', id: 'R' }
const target = (id = 'target', name = 'other/project') => ({ nativeIdentity: { namespace: 'github.com/graphql/Issue', id }, repository: { identity: { ...repository, id: name }, name }, number: 7, title: id, url: `https://github.com/${name}/issues/7`, state: 'closed' })
async function fixture(policy) {
  assert.equal(typeof K.PlanningIssueDependenciesRead, 'string', 'dependency capability must be declared')
  const p = createFakeProviders(), flags = {}, calls = [], original = p.planning.describeCapabilities.bind(p.planning)
  p.planning.describeCapabilities = async () => { const s = await original(); s.capability[K.PlanningIssueDependenciesRead] = 'available'; s.permission[K.PlanningIssueDependenciesRead] = flags.denied ? 'unavailable' : 'available'; return s }
  let page = input => providerOk({ source: { project: input.project, membership: input.membership, issue: input.issue, repository }, direction: input.direction, items: [target()] })
  p.planning.listIssueDependencies = async input => { calls.push(input); return page(input) }
  const core = await composeCore({ workspace: { name: 'Dependencies' }, providers: p, policy }), scope = { workItemId: (await core.queries.listPlanningItems()).find(i => i.content.title === '规划项 issue-1').entityId }, workspaceId = (await core.queries.getWorkspaceMetadata()).workspace.id
  assert.equal(typeof core.commands.refreshIssueDependencies, 'function', 'explicit read must reach production Core commands')
  return { p, core, flags, calls, scope, workspaceId, page: fn => page = fn, refresh: () => core.commands.refreshIssueDependencies(scope) }
}
test('two independent streams retain closed external targets and produce no storage writes', async () => {
  const h = await fixture(), before = await h.p.storage.currentRevision(h.workspaceId), relations = await h.p.storage.listRelations(h.workspaceId)
  const item = { ...target(), hiddenCount: 99, nativeIdentity: { ...target().nativeIdentity, secret: 'SECRET' } }
  h.page(input => providerOk({ source: { ...input, repository }, direction: input.direction, items: input.cursor ? [target('second', 'another/project')] : [item], nextCursor: input.cursor ? undefined : input.direction }))
  const v = await h.refresh();
  assert.doesNotMatch(JSON.stringify(v), /hiddenCount|SECRET/)
  assert.equal(v.blockedBy.state, 'complete');
  assert.equal(v.blocking.state, 'complete');
  assert.equal(v.blockedBy.items.length, 2)
  assert.deepEqual(h.calls.map(c => [c.direction, c.cursor]), [['blocked_by', undefined], ['blocked_by', 'blocked_by'], ['blocking', undefined], ['blocking', 'blocking']])
  assert.equal(await h.p.storage.currentRevision(h.workspaceId), before);
  assert.deepEqual(await h.p.storage.listRelations(h.workspaceId), relations)
})
test('source, malformed pages, cursor loops and later failures cannot claim empty complete', async () => {
  for (const fault of ['empty', 'proof', 'direction', 'null', 'url', 'loop', 'later', 'budget']) {
    const h = await fixture(); let n = 0
    h.page(input => {
      n++;
      if (fault === 'later' && input.cursor) return providerErr(providerError('unavailable', 'SECRET')); return providerOk({ source: { ...input, issue: fault === 'proof' ? { ...input.issue, externalId: 'SECRET' } : input.issue, repository }, direction: fault === 'direction' ? 'parent' : input.direction, items: fault === 'null' ? [null] : fault === 'url' ? [target('bad', '../project')] : [], nextCursor: ['loop', 'later', 'budget'].includes(fault) ? fault === 'budget' ? String(n) : 'next' : undefined })
    })
    const v = await h.refresh();
    assert.equal(v.blockedBy.state, fault === 'empty' ? 'complete' : 'partial');
    assert.deepEqual(v.blockedBy.items, []);
    assert.ok(h.calls.length <= 20);
    assert.doesNotMatch(JSON.stringify(v), /SECRET/)
  }
})
test('primary, redaction, membership and policy gates send zero requests', async () => {
  for (const fault of ['primary', 'redaction', 'membership', 'policy']) {
    const h = await fixture(fault === 'policy' ? { [K.PlanningIssueDependenciesRead]: 'unavailable' } : undefined)
    if (fault === 'primary') {
      const i = (await h.p.storage.listIdentitiesForEntity(h.scope.workItemId)).find(i => i.role === 'primary');
      await h.p.storage.putExternalIdentity({ ...i, role: 'historical' })
    }
    if (fault === 'redaction') {
      const i = await h.p.storage.getPlanningProjection(h.workspaceId, h.scope.workItemId);
      await h.p.storage.putPlanningProjection(h.workspaceId, { ...i, content: { contentKind: 'redacted', reason: 'permission_denied' } })
    }
    if (fault === 'membership') {
      const m = (await h.p.storage.listMemberships(h.workspaceId, h.p.planning.state.projects[0].ref.externalId))[0];
      await h.p.storage.putMembership({ ...m, contentExternalId: 'other' })
    }
    const v = await h.refresh();
    assert.deepEqual(v.blockedBy.items, []);
    assert.equal(h.calls.length, 0)
  }
})
test('committed A→B→A, request ordinal and denial invalidate pending success; explicit recovery works', async () => {
  for (const fault of ['fence', 'race', 'denial']) {
    const h = await fixture(), entered = gate(), release = gate(); let first = true
    h.page(async input => {
      if (first) {
        first = false; entered.resolve();
        await release.promise
      } return providerOk({ source: { ...input, repository }, direction: input.direction, items: [target('old')] })
    })
    const pending = h.refresh();
    await entered.promise
    if (fault === 'fence') {
      const i = (await h.p.storage.listIdentitiesForEntity(h.scope.workItemId)).find(i => i.role === 'primary');
      await h.p.storage.putExternalIdentity({ ...i, role: 'historical' });
      await h.p.storage.putExternalIdentity(i)
    }
    else if (fault === 'race') await h.refresh()
    else {
      h.page(() => providerErr(providerError('permission_denied', 'SECRET')));
      assert.equal((await h.refresh()).blockedBy.state, 'denied')
    }
    release.resolve();
    assert.deepEqual((await pending).blockedBy.items, [])
    h.page(input => providerOk({ source: { ...input, repository }, direction: input.direction, items: [target('new')] }));
    assert.equal((await h.refresh()).blockedBy.state, 'complete')
  }
})

test('disabled binding cannot read and account/config changes fence a held result without relying on display names', async () => {
  for (const change of ['binding', 'account', 'configuration']) {
    const h = await fixture(), entered = gate(), release = gate()
    let account = 'actor-A', configuration = 'project-A'
    h.p.storage.getProviderBindingAccount = async () => 'account'
    h.p.storage.getConnectorAccount = async () => ({ id: 'account', externalId: account })
    h.p.storage.getBindingConfiguration = async () => ({ configuration: { project: configuration } })
    h.page(async input => {
      entered.resolve();
      await release.promise; return providerOk({ source: { ...input, repository }, direction: input.direction, items: [target()] })
    })
    const pending = h.refresh();
    await entered.promise
    if (change === 'account') account = 'actor-B'
    if (change === 'configuration') configuration = 'project-B'
    if (change === 'binding') {
      const b = (await h.p.storage.listProviderBindings(h.workspaceId)).find(b => b.domain === 'planning');
      await h.p.storage.putProviderBinding({ ...b, enabled: false, isDefault: false })
    }
    release.resolve();
    assert.deepEqual((await pending).blockedBy.items, [])
    if (change === 'binding') {
      h.calls.length = 0;
      await h.refresh();
      assert.equal(h.calls.length, 0)
    }
  }
})
for (const hang of ['provider', 'second scope', 'retired source']) test('absolute deadline bounds a hung ' + hang + ' and exposes no successful observation time', async t => {
  const h = await fixture(), entered = gate(), late = gate()
  if (hang !== 'second scope') h.page(() => { entered.resolve(); return late.promise })
  else { const original = h.p.storage.getPlanningProjection.bind(h.p.storage); let reads = 0
    h.p.storage.getPlanningProjection = async (...args) => ++reads === 2 ? (entered.resolve(), new Promise(() => {})) : original(...args)
  }
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] }); t.after(() => t.mock.timers.reset())
  const pending = h.refresh();
  let settled = false; void pending.then(() => { settled = true })
  await entered.promise; t.mock.timers.tick(10001); await new Promise(setImmediate)
  assert.equal(settled, true)
  const v = await pending;
  assert.equal(v.blockedBy.state, 'partial');
  assert.equal(v.blockedBy.observedAt, undefined);
  assert.deepEqual(v.blockedBy.items, [])
  if (hang !== 'second scope') {
    const version = (await h.core.queries.getWorkspaceMetadata()).nativeAccessVersion
    if (hang === 'retired source') await h.p.storage.putWorkspace({ ...await h.p.storage.getWorkspace(h.workspaceId), name: 'Changed' })
    late.resolve(providerErr(providerError('permission_denied', 'SECRET'))); await new Promise(setImmediate)
    const after = (await h.core.queries.getWorkspaceMetadata()).nativeAccessVersion
    if (hang === 'provider') assert.notEqual(after, version); else assert.equal(after, version)
  }
})

test('late old-source denial cannot invalidate the current account/configuration source', async () => {
  const h = await fixture(), entered = gate(), release = gate()
  let configuration = 'A'
  h.p.storage.getBindingConfiguration = async () => ({ configuration: { project: configuration } })
  h.page(async () => { entered.resolve(); await release.promise; return providerErr(providerError('permission_denied', 'SECRET')) })
  const old = h.refresh(); await entered.promise
  configuration = 'B'
  h.page(input => providerOk({ source: { ...input, repository }, direction: input.direction, items: [target('current')] }))
  assert.equal((await h.refresh()).blockedBy.state, 'complete')
  const version = (await h.core.queries.getWorkspaceMetadata()).nativeAccessVersion
  release.resolve(); assert.deepEqual((await old).blockedBy.items, [])
  assert.equal((await h.core.queries.getWorkspaceMetadata()).nativeAccessVersion, version)
  assert.equal((await h.refresh()).blockedBy.items[0].title, 'current')
})

for (const code of ['not_found', 'permission_denied', 'not_supported']) test('failed streams preserve ' + code + ', and descriptor denial invalidates native metadata', async () => {
  const h = await fixture(), context = await createContext({ workspace: { id: h.workspaceId, name: 'Cohort' }, providers: h.p })
  context.projectRef = h.p.planning.state.projects[0].ref
  const refresh = () => refreshIssueDependencies(context, h.scope), access = () => code === 'not_found' ? issueSourceReadAccess(context, h.calls.at(-1)).missing : issueAuthorityReadAccess(context, h.calls.at(-1).issue.bindingId, [K.PlanningIssueDependenciesRead]).denied
  h.page(() => providerErr(providerError(code, 'SECRET'))); await refresh(); assert.equal(access(), true)
  h.page(() => providerErr(providerError('unavailable', 'SECRET'))); await refresh(); assert.equal(access(), true)
  h.page(input => providerOk({ source: { ...input, repository }, direction: input.direction, items: [] })); await refresh(); assert.equal(access(), false)
  const before = issueClosingLinksAccessVersion(context); h.flags.denied = true
  assert.equal((await refresh()).blockedBy.state, 'denied'); assert.notEqual(issueClosingLinksAccessVersion(context), before)
})
