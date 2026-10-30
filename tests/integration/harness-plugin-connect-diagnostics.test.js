import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { SqliteStorage } from '@harness-projects/storage-sqlite'
import { createWorkspaceSetupSource } from '@harness-projects/client'
import { WorkspaceSetupGate } from '@harness-projects/ui'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { WORKSPACE, projectNodeId, replayFetch } from './fixtures/host-seed.js'
const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const actor = { kind: 'user' }, canary = 'RAW-CONNECTION-CANARY'
const cases = [
  ['credential', 401, {}, 'credential_rejected', 'permission_denied', 'GitHub 拒绝了当前凭据'],
  ['scope', 200, { errors: [{ type: 'INSUFFICIENT_SCOPES', message: canary }] }, 'permission_missing', 'permission_denied', 'GitHub 明确报告所需权限不足'],
  ['missing', 200, { errors: [{ type: 'NOT_FOUND', message: canary }] }, 'target_unavailable', 'not_found', '项目不存在或当前授权不可见'],
  ['null', 200, { data: { node: null } }, 'target_unavailable', 'not_found', '项目不存在或当前授权不可见'],
  ['forbidden', 200, { errors: [{ type: 'FORBIDDEN', message: 'INSUFFICIENT_SCOPES ' + canary }] }, undefined, 'permission_denied', '当前访问被拒绝'],
  ['http403', 403, {}, undefined, 'permission_denied', '当前访问被拒绝'],
  ['mixed', 200, { errors: [{ type: 'NOT_FOUND' }, { type: 'INSUFFICIENT_SCOPES' }] }, undefined, 'unavailable', '暂时无法完成工作区设置'],
  ['rate', 429, {}, undefined, 'rate_limited', '暂时无法完成工作区设置'],
  ['secondary-no-headers', 403, { message: 'You have exceeded a secondary rate limit. ' + canary }, undefined, 'rate_limited', '暂时无法完成工作区设置'],
  ['secondary-no-type', 200, { errors: [{ message: 'You have exceeded a secondary rate limit. ' + canary }] }, undefined, 'rate_limited', '暂时无法完成工作区设置'],
  ['viewer-secondary-no-headers', 403, { message: 'You have exceeded a secondary rate limit. ' + canary }, undefined, 'rate_limited', '暂时无法完成工作区设置', {}, true],
  ['viewer-secondary-no-type', 200, { node_id: 'U_canary', login: canary, errors: [{ message: 'You have exceeded a secondary rate limit. ' + canary }] }, undefined, 'rate_limited', '暂时无法完成工作区设置', {}, true],
  ['secondary-near-miss', 403, { message: 'Secondary permission denied ' + canary }, undefined, 'permission_denied', '当前访问被拒绝'],
  ['project401', 401, {}, 'credential_rejected', 'permission_denied', 'GitHub 拒绝了当前凭据'],
  ['viewer403', 403, {}, undefined, 'permission_denied', '当前访问被拒绝', {}, true],
  ['viewer-rate200', 200, { node_id: 'U_canary', login: canary, errors: [{ type: 'RATE_LIMITED' }] }, undefined, 'rate_limited', '暂时无法完成工作区设置', {}, true],
  ['viewer-rate', 403, {}, undefined, 'rate_limited', '暂时无法完成工作区设置', { 'retry-after': '1' }, true],
  ['exhausted', 403, {}, undefined, 'rate_limited', '暂时无法完成工作区设置', { 'x-ratelimit-remaining': '0' }],
  ['secondary', 200, { errors: [{ type: 'RATE_LIMITED', message: canary }, { type: 'INSUFFICIENT_SCOPES' }] }, undefined, 'rate_limited', '暂时无法完成工作区设置'],
  ['partial', 200, { data: { node: { __typename: 'ProjectV2', id: projectNodeId } }, errors: [{ type: 'INSUFFICIENT_SCOPES' }] }, 'permission_missing', 'permission_denied', 'GitHub 明确报告所需权限不足'],
  ['network', 0, {}, undefined, 'unavailable', '暂时无法完成工作区设置'],
  ['malformed', 200, { data: { node: { __typename: 'ProjectV2', id: 'PVT_hidden', title: canary } } }, undefined, 'unavailable', '暂时无法完成工作区设置'],
]
async function open(t, resolveCredential = async () => canary) {
  const dir = await mkdtemp(path.join(tmpdir(), 'connect-diagnostics-')), dataPath = path.join(dir, 'workspace.sqlite'), replay = replayFetch(), requests = []
  let scenario, reads = 0
  const host = await createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, resolveCredential,
    planningTimers: { setInterval: () => 1, clearInterval: () => {} }, fetch: async (url, init) => {
      requests.push([url, init]); const viewer = url.endsWith('/user')
      if (viewer && scenario?.[0] !== 'credential' && !scenario?.[7]) return new Response(JSON.stringify({ node_id: 'U_canary', login: canary }))
      if (scenario) { if (scenario[1] === 0) throw Error(canary); return new Response(JSON.stringify(scenario[2]), { status: scenario[1], headers: scenario[6] }) }
      return replay.fetch(url, init)
    } })
  const installed = await installHostRemote({ invocation: { peer: { id: 'fixture-peer' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  const source = createWorkspaceSetupSource({ ...installed.service, getWorkspaceSetup: () => { reads++; return installed.service.getWorkspaceSetup() } }, { actorRef: actor, key: () => 'intent' })
  t.after(async () => { source.dispose(); host.stop(); await installed.dispose(); await host.dispose(); await rm(dir, { recursive: true, force: true }) })
  await source.create('Connection fixture')
  const count = (table) => { const db = new DatabaseSync(dataPath); try { return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n } finally { db.close() } }
  return { service: installed.service, source, count, requests, scenario: (value) => { scenario = value }, reads: () => reads }
}
for (const scenario of cases) test(`actual Host/controller/remote/client/renderer rejects ${scenario[0]} before binding`, async (t) => {
  const h = await open(t); h.scenario(scenario)
  const account = await h.service.connectAccount(actor, 'direct-account')
  const direct = scenario[0] === 'credential' || scenario[7] ? account : await h.service.bindPlanningSource(actor, 'direct-bind', account.value.accountId, projectNodeId)
  assert.equal(direct.writeState, 'failed'); assert.equal(direct.error.code, scenario[4]); assert.deepEqual(direct.connectionFailure, scenario[3] ? { cause: scenario[3] } : undefined)
  assert.equal(h.count('workspace_binding'), 0)
  if (scenario[0] === 'credential' || scenario[7]) assert.equal(h.count('connector_account'), 0)
  await h.source.connect(projectNodeId)
  const snapshot = h.source.getSnapshot(), html = renderToStaticMarkup(React.createElement(WorkspaceSetupGate, { setupSource: h.source, source: { subscribe: () => () => {}, getSnapshot: () => undefined } }))
  assert.equal(snapshot.error.code, scenario[4]); assert.deepEqual(snapshot.connectionFailure, direct.connectionFailure); assert.match(html, new RegExp(scenario[5])); assert.equal(snapshot.setup.planning.state, 'unbound')
  if (scenario[4] === 'rate_limited') { assert.equal(snapshot.error.retryable, true); assert.equal(snapshot.error.recovery, 'retry'); assert.match(html, /<button[^>]*>重试<\/button>/) }
  for (const output of [JSON.stringify(direct), JSON.stringify(snapshot), html]) for (const secret of [canary, 'U_canary', 'PVT_hidden', 'secretHandle', 'authorization']) assert.equal(output.includes(secret), false)
  assert.doesNotMatch(html, /Saved|已连接/)
  assert.ok(h.requests.every(([url, init]) => new URL(url).origin === 'https://api.github.com' && init.redirect === 'error' && init.signal instanceof AbortSignal))
  await h.source.refresh(); assert.equal(h.source.getSnapshot().connectionFailure, undefined)
})
test('successful preflight continues actual transaction and confirmation; later failure carries no prior cause', async (t) => {
  const h = await open(t); await h.source.connect(projectNodeId)
  assert.equal(h.source.getSnapshot().setup.planning.state, 'confirmed'); assert.equal(h.count('workspace_binding'), 1)
  h.scenario(cases[1]); await h.source.connect(projectNodeId); assert.equal(h.source.getSnapshot().connectionFailure.cause, 'permission_missing')
  h.scenario(undefined); await h.source.connect(projectNodeId); assert.equal(h.source.getSnapshot().connectionFailure, undefined); assert.equal(h.source.getSnapshot().setup.planning.state, 'confirmed')
})

test('missing credentials, credential service errors and exhausted request budget stay unavailable with zero fetch', async (t) => {
  for (const resolve of [async () => undefined, async () => { throw Error(canary) }]) {
    const h = await open(t, resolve); await h.source.connect(projectNodeId)
    assert.equal(h.source.getSnapshot().error.code, 'unavailable'); assert.equal(h.source.getSnapshot().connectionFailure, undefined); assert.equal(h.requests.length, 0); assert.equal(h.count('connector_account'), 0)
  }
  const h = await open(t), timeout = t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort())
  try { await h.source.connect(projectNodeId); assert.equal(h.source.getSnapshot().error.code, 'unavailable'); assert.equal(h.requests.length, 0) } finally { timeout.mock.restore() }
})
test('preflight success followed by assembly failure stays configured with activationError and no proven cause', async (t) => {
  const h = await open(t), original = SqliteStorage.prototype.putWorkspace; let once = true
  t.mock.method(SqliteStorage.prototype, 'putWorkspace', function (...args) { if (once) { once = false; throw Error(canary) } return original.apply(this, args) })
  await h.source.connect(projectNodeId)
  const snapshot = h.source.getSnapshot()
  assert.equal(h.count('workspace_binding'), 1); assert.equal(snapshot.setup.planning.state, 'configured'); assert.equal(snapshot.setup.activationError.code, 'unavailable'); assert.equal(snapshot.connectionFailure, undefined); assert.doesNotMatch(JSON.stringify(snapshot), /RAW-CONNECTION-CANARY/)
})
