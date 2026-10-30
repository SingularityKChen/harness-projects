/** 真实表单 + client source；受控 port 只提供可释放的结果，不代表安装 Host 或 Provider 验收。 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBundle } from './work-item-detail-browser.mjs'
const requireUi = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const ENTRY = `
import { createElement as h, useState } from 'react'
import { wire } from './tests/fixtures/work-item-wire.mjs'
import { WorkspaceSetupGate } from '@harness-projects/ui'
import { createWorkspaceSetupSource, createRepositoryBindingSource, createPlanningMappingSource, createEntityStore } from '@harness-projects/client'
const params = new URLSearchParams(location.search), barriers = new Map(), calls = []
let sequence = 0, visible = true, rerender, heldSetupRead = false, heldMappingRead = false
const diagnostics = () => { document.getElementById('diagnostics').textContent = 'pending: ' + [...barriers.keys()].join(', ') + '; calls: ' + calls.map(call => call[0]).join(', ') }
const options = { actorRef: { kind: 'human' }, key: () => 'fixture-' + ++sequence }
const workspace = { id: 'ws', name: params.get('workspace') || '浏览器工作区' }, scope = { workspaceId: 'ws', bindingId: 'binding', projectExternalId: 'PVT_fixture' }
let current = params.get('stage') === 'create' ? { workspace: null, planning: { state: 'unbound' } } : { workspace, planning: { state: params.get('stage') === 'list' ? 'confirmed' : 'configured', bindingId: scope.bindingId, projectNodeId: scope.projectExternalId } }
let mapping = { scope, confirmed: true, origin: 'user', mapping: { status: { projectFieldId: 'status', options: { open: 'todo', deleted: 'done' } } }, fields: [
  { id: 'status', name: 'Same', kind: 'single_select', options: [{ id: 'open', name: 'Open' }] },
  { id: 'status-2', name: 'Same', kind: 'single_select', options: [] }, { id: 'iteration', name: 'Sprint', kind: 'iteration' }, { id: 'date', name: 'Due', kind: 'date' } ] }
const result = (value, extra = {}) => ({ writeState: 'local_only', saving: false, authoritative: false, value, ...extra })
const error = { code: 'unavailable', recovery: 'retry', retryable: true, message: 'RAW-ERROR-CANARY secret-token-canary' }
const wait = (name, args, success) => { calls.push([name, ...args]); return new Promise((resolve, reject) => { barriers.set(name, outcome => {
  barriers.delete(name)
  if (outcome === 'failed' && (name === 'repository-baseline' || name.endsWith('-read'))) reject(new Error('RAW-ERROR-CANARY secret-token-canary'))
  else if (outcome === 'failed') resolve(result(undefined, { writeState: 'failed', error }))
  else if (outcome === 'conflict') resolve(result(undefined, { writeState: 'conflict', error: { ...error, code: 'conflict', recovery: 'reapply' } }))
  else if (outcome === 'unknown') resolve(result(undefined, { writeState: 'unknown' }))
  else resolve(success(outcome))
  diagnostics()
}); diagnostics() }) }
const setup = createWorkspaceSetupSource({ getWorkspaceSetup: async () => heldSetupRead ? wait('setup-read', [], () => current) : current,
  createWorkspace: (...args) => wait('create', args, () => { current = { workspace: { ...workspace, name: args[2] }, planning: { state: 'unbound' } }; return result({ workspaceId: 'ws' }) }),
  connectAccount: (...args) => wait('planning-account', args, () => result({ accountId: 'fixture-account' })),
  bindPlanningSource: (...args) => wait('connect', args, () => { current = { ...current, planning: { state: params.get('stage') === 'list' ? 'confirmed' : 'configured', bindingId: scope.bindingId, projectNodeId: args[3] } }; mapping = { ...mapping, scope: { ...scope, projectExternalId: args[3] } }; return result({ bindingId: 'binding' }) }),
  refreshPlanning: async () => { current = { ...current, planning: { ...current.planning, state: 'confirmed' } }; return result({ ok: true }) },
  installExecutionBindings: (...args) => wait('execution', args, () => { current = { ...current, executionInstalled: true }; return result({ bindingIds: ['exec-one', 'exec-two'] }) }),
}, options)
const repository = createRepositoryBindingSource({
  connectAccount: (...args) => wait('repository-account', args, () => result({ accountId: 'fixture-account' })),
  bindRepository: (...args) => wait('repository', args, outcome => result({ repositoryId: args[2], bindingIds: ['one', 'two', 'three'] }, outcome === 'local_only' ? { activationError: error } : {})),
  baseline: () => wait('repository-baseline', [], () => ({ repositories: [{ id: repository.getSnapshot().repositoryId, capabilities: ['development.branch.create', 'development.worktree.create', 'development.repository.read', 'development.worktree.read'].map(key => ({ key, access: 'available' })) }] })),
}, options)
const mappingSource = createPlanningMappingSource({ getPlanningMapping: async () => heldMappingRead ? wait('mapping-read', [], () => mapping) : mapping,
  setPlanningMapping: (...args) => wait('mapping', args, outcome => { mapping = { ...mapping, mapping: args[4], confirmed: outcome !== 'local_only' }; return result({ bindingId: 'binding' }, outcome === 'local_only' ? { activationError: error } : {}) }),
}, options)
const store = createEntityStore(); store.applyBaseline({ revision: 0, entities: params.get('items') === 'long' ? Array.from({ length: 289 }, (_, index) => wire('fixture-' + index, { content: { title: '工作项 ' + index } })) : [], source: { revision: 0, freshness: 'fresh', authority: 'provider' } })
const read = { ...(params.get('facts') === 'complete' ? { planningSource: { bindingId: scope.bindingId, name: 'Fixture planning source' }, lastUpdatedAt: '2026-10-30T08:00:00Z', reconciledAt: '2026-10-30T08:00:00Z' } : {}), workspace, store, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }] }
const source = { subscribe: () => () => {}, getSnapshot: () => params.get('stage') === 'list' ? read : undefined }
function App() { const [, render] = useState(0); rerender = () => render(n => n + 1); return visible ? h(WorkspaceSetupGate, { setupSource: setup, repositoryBindingSource: repository, mappingSource, source }) : h('p', null, '已离开连接设置') }
const controls = {
  release: (name, outcome = 'success') => { const release = barriers.get(name); if (!release) throw new Error('No pending operation: ' + name); release(outcome) },
  pending: () => [...barriers.keys()], calls: () => calls, snapshots: () => ({ setup: setup.getSnapshot(), repository: repository.getSnapshot(), mapping: mappingSource.getSnapshot() }),
  holdSetupRead: () => { heldSetupRead = true }, readMapping: () => { heldMappingRead = true; void mappingSource.refresh(scope) },
  refresh: () => setup.refresh(), leave: () => { visible = false; rerender() }, enter: () => { visible = true; rerender() },
}
window.__forms = controls
window.ReactDOM.createRoot(document.getElementById('app')).render(h(App))
void setup.refresh()
`
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace forms fixture</title>
<style>:root{color-scheme:light;color:#20242c;background:#fff;font:15px/1.5 system-ui;--dsw-focus-ring-color:#4176E6;--dsw-alias-state-business-primary:#4176E6} :root[data-theme=dark]{color-scheme:dark;color:#e3e5eb;background:#191b20;--dsw-focus-ring-color:#7AAAFF;--dsw-alias-state-business-primary:#7AAAFF}html,body{margin:0;height:100%;overflow:hidden}body{display:grid;grid-template-rows:auto minmax(0,1fr)}#app{grid-row:2;display:flex;flex-direction:column;min-height:0;overflow:hidden}#controls{padding:.25rem;max-height:5rem;overflow:auto;display:flex;gap:.5rem;flex-wrap:wrap}#controls button{min-height:44px;font:inherit}</style>
<div id="controls"><button id="leave">离开设置</button><button id="enter">进入设置</button><button id="refresh">后台刷新</button><button id="theme">切换主题</button><label>待处理步骤 <select id="operation">${['create','planning-account','connect','mapping','repository-account','repository','repository-baseline','execution','setup-read','mapping-read'].map(name => `<option>${name}</option>`).join('')}</select></label><label>返回结果 <select id="outcome">${['success','failed','unknown','conflict','local_only'].map(name => `<option>${name}</option>`).join('')}</select></label><button id="release">释放响应</button><output id="diagnostics" aria-live="polite">pending: none</output></div><div id="app"></div>
<script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light';if(new URLSearchParams(location.search).get('controls')==='hidden')document.getElementById('controls').style.display='none';if(new URLSearchParams(location.search).get('font')==='200')document.documentElement.style.fontSize='30px'</script>
<script src="/react.js"></script><script src="/react-dom.js"></script><script>window.require=id=>{if(id==='react')return React;throw Error(id)};var module={exports:{}};var exports=module.exports</script><script src="/bundle.js"></script>
<script>document.getElementById('release').onclick=()=>{const operation=document.getElementById('operation').value;if(window.__forms.pending().includes(operation))window.__forms.release(operation,document.getElementById('outcome').value);else document.getElementById('diagnostics').textContent='尚无此待处理步骤'};for(const name of ['leave','enter','refresh'])document.getElementById(name).onclick=()=>window.__forms[name]();document.getElementById('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'}</script></html>`
export async function startServer() {
  const umd = (id, file) => readFile(path.join(path.dirname(requireUi.resolve(id)), 'umd', file), 'utf8')
  const [bundle, react, dom] = await Promise.all([buildBundle(ENTRY), umd('react', 'react.development.js'), umd('react-dom/client', 'react-dom.development.js')])
  const scripts = { '/bundle.js': bundle.outputFiles[0].text, '/react.js': react, '/react-dom.js': dom }
  const server = createServer((request, response) => { const pathname = new URL(request.url, 'http://fixture.invalid').pathname, script = scripts[pathname]; response.writeHead(200, { 'content-type': script ? 'text/javascript' : 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(script ?? page) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const fixture = await startServer(); console.log('workspace-forms fixture: ' + fixture.url + '/?stage=create'); process.on('SIGINT', async () => { await fixture.close(); process.exit(0) }) }
