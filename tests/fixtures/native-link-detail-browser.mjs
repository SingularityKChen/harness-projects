/** 真实 GitHub providers → Core/Host remote → production apply 的离线浏览器夹具。只替换 HTTP transport。 */
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createHostComposition } from '../../apps/harness-plugin/src/host-composition.ts'
import { installHostRemote } from '../../apps/harness-plugin/src/remote.ts'
import { PROVIDER_CATALOG } from '../../apps/harness-plugin/src/host-providers.ts'
import { OPERATIONS, parseInput } from '../../apps/harness-plugin/src/host-operations.ts'
import { registerRepository } from '../../packages/core/src/development-route.ts'
import { WORKSPACE, seed, seedWorkspace, seedPlanning, seedRepositoryMount, developmentFixture, githubFetch, REPOSITORY_MOUNTS, dump } from '../integration/fixtures/host-seed.js'
const repoRoot = new URL('../../', import.meta.url).pathname, require = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const ENTRY = `
import { createElement } from 'react'
import { apply } from './apps/harness-plugin/src/client.ts'
import { OPERATIONS } from './apps/harness-plugin/src/host-operations.ts'
export async function mount(root) {
  const disposers = [], streams = new Set(), frames = []
  const remote = Object.fromEntries(Object.values(OPERATIONS).filter(op => op.mode === 'unary').map(op => [op.name, async (...args) =>
    (await fetch('/remote', { method:'POST', body:JSON.stringify({ name:op.name, input:Object.fromEntries(op.params.map((p,i)=>[p.name,args[i]])) }) })).json()]))
  remote.watch = async function* (signal) {
    const response = await fetch('/watch', { signal }), reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = ''
    try { for (;;) { const chunk = await reader.read(); if(chunk.done) return; buffer += chunk.value
      for(let end; (end=buffer.indexOf('\\n'))>=0;) { const line=buffer.slice(0,end);buffer=buffer.slice(end+1);yield JSON.parse(line) }
    } } finally { await reader.cancel().catch(()=>{}) }
  }
  const child = { effect:run=>disposers.push(run()), slots:{ inject:(_,run)=>run(), register:(slot,Panel)=>{if(slot.name==='main')root.render(createElement(Panel))} }, remote:{ harnessProjects:remote,
    $stream:options=>{let abort,stopped=false,restart=false,generation=0
      const stream={restart(){restart=true;abort?.abort()},dispose:async()=>{stopped=true;abort?.abort();streams.delete(stream)},async *[Symbol.asyncIterator](){
        while(!stopped){abort=new AbortController();restart=false;let accepted=false;generation++
          try{for await(const value of options.open(abort.signal)){const frame=value.baseline??value.delta??value.metadata;if(frame)frames.push({kind:value.kind,generation:frame.generation,revision:frame.revision,nativeAccessVersion:frame.nativeAccessVersion});yield{generation,value,accept(){accepted=true}}}}catch(error){if(!stopped&&!restart)throw error}
          if(!stopped&&!restart)throw options.ended(accepted)
        }
      }};streams.add(stream);return stream
    }
  }}
  await apply({ effect:child.effect,remote:{$mount:async()=>async()=>{}},inject:(_,run)=>run(child) })
  return { frames:()=>frames.slice(), unmount:async()=>{root.unmount();await Promise.all(disposers.reverse().map(run=>run()));await Promise.all([...streams].map(s=>s.dispose()))} }
}`
export async function startNativeDetailServer() {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-detail-')), dataPath = path.join(dir, 'workspace.sqlite'), fallback = githubFetch()
  const repository = developmentFixture.exchanges.find(e => e.operationName === 'DevelopmentRepository').body.data.repository
  const rawPr = developmentFixture.exchanges.find(e => e.operationName === 'DevelopmentChangeRequest').body.data.node
  const flags = {}, requests = [], operations = [], streams = new Set(), held = []
  await seed(dataPath, PROVIDER_CATALOG, async storage => {
    await seedWorkspace(storage); await seedPlanning(storage); await seedRepositoryMount(storage, 'development-native', 'development.github')
    await registerRepository(storage, { entityId: randomUUID, externalIdentityId: randomUUID }, WORKSPACE, REPOSITORY_MOUNTS['development.github'][1].repositoryExternalId, ['development-native'])
  })
  const transport = async (url, init) => {
    const request = JSON.parse(init.body), { operationName: op, variables: v } = request; requests.push(request)
    if (/mutation\s/.test(request.query)) throw new Error('Business write forbidden')
    if (flags.offline && ['PlanningIssueParent', 'PlanningIssueChildren', 'PlanningIssueBlockedBy', 'PlanningIssueBlocking', 'PlanningIssueClosingLinks', 'PlanningIssueReferences', 'DevelopmentRepository', 'DevelopmentChangeRequest'].includes(op)) throw new Error('SECRET network error')
    if (flags.hold && flags.holdOperation === 'PlanningProject' && op === 'PlanningProject') { flags.hold = false; await new Promise(resolve => held.push(resolve)) }
    if (flags.deny === op || (op === (flags.denySource ?? 'PlanningIssueClosingLinks') && flags.denyIssue === v.issue)) return new Response(JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'SECRET' }] }), { status: 403 })
    if (['PlanningIssueBlockedBy', 'PlanningIssueBlocking', 'PlanningIssueParent', 'PlanningIssueChildren'].includes(op)) {
      const direction = { PlanningIssueBlockedBy: 'blockedBy', PlanningIssueBlocking: 'blocking', PlanningIssueParent: 'parent', PlanningIssueChildren: 'subIssues' }[op]
      const target = { __typename: 'Issue', id: direction + '-outside', number: 7, title: direction + ' target', state: 'CLOSED', url: 'https://github.com/other/project/issues/7', repository: { id: 'R_outside', nameWithOwner: 'other/project' } }
      if (direction === 'parent') { target.title = 'parent target'; target.repository = { id: 'R_parent', nameWithOwner: 'parent/project' }; target.url = 'https://github.com/parent/project/issues/7' }
      if (direction === 'subIssues' && flags.childrenFailure && v.after) throw new Error('SECRET later page')
      const content = { __typename: 'Issue', id: v.issue, repository }
      const result = { data: { project: { __typename: 'ProjectV2', id: v.project }, membership: { __typename: 'ProjectV2Item', id: v.membership, type: 'ISSUE', project: { id: v.project }, content }, issue: { ...content, [direction]: direction === 'parent' ? flags.dependenciesEmpty ? null : target : { nodes: flags.dependenciesEmpty || v.after ? [] : [target], pageInfo: { hasNextPage: !!flags.dependenciesPages && !v.after, endCursor: flags.dependenciesPages && !v.after ? direction + '-second' : null } } } } }
      if (flags.hold && flags.holdOperation === op) { flags.hold = false; await new Promise(resolve => held.push(resolve)) }
      return new Response(JSON.stringify(result))
    }
    if (op === 'PlanningIssueLinkTarget') {
      const content = { __typename: 'Issue', id: v.issue, number: 545, repository }
      return new Response(JSON.stringify({ data: { project: { __typename: 'ProjectV2', id: v.project }, membership: { __typename: 'ProjectV2Item', id: v.membership, type: 'ISSUE', project: { id: v.project }, content }, issue: content } }))
    }
    if (op === 'PlanningIssueReferences') {
      const result = { data: { project: { __typename: 'ProjectV2', id: v.project }, membership: { __typename: 'ProjectV2Item', id: v.membership, type: 'ISSUE', project: { id: v.project }, content: { __typename: 'Issue', id: v.issue, repository } }, issue: { __typename: 'Issue', id: v.issue, repository, timelineItems: {
        nodes: flags.reference && !v.after ? [{ __typename: 'CrossReferencedEvent', target: { __typename: 'Issue', id: v.issue }, source: { ...rawPr, repository, isDraft: true }, willCloseTarget: false }] : [],
        pageInfo: { hasNextPage: !!flags.referencePages && !v.after, endCursor: flags.referencePages && !v.after ? 'reference-second' : null },
      } } } }
      if (flags.hold && flags.holdOperation === op) { flags.hold = false; await new Promise(resolve => held.push(resolve)) }
      return new Response(JSON.stringify(result))
    }
    if (op === 'PlanningIssueClosingLinks') {
      const result = { data: { project: { __typename: 'ProjectV2', id: v.project }, membership: { __typename: 'ProjectV2Item', id: v.membership, type: 'ISSUE', project: { id: v.project }, content: { __typename: 'Issue', id: v.issue, repository } }, issue: { __typename: 'Issue', id: v.issue, repository, closedByPullRequestsReferences: { nodes: v.after || flags.empty ? [] : [{ ...rawPr, repository, isDraft: true }], pageInfo: { hasNextPage: !!flags.partial || (!!flags.pages && !v.after), endCursor: flags.partial ? (v.after ? null : 'second') : flags.pages && !v.after ? 'second' : null } } } } }
      if (flags.hold && (!flags.holdOperation || flags.holdOperation === op)) { flags.hold = false; await new Promise(resolve => held.push(resolve)) }
      return new Response(JSON.stringify(result))
    }
    return fallback.fetch(url, init)
  }
  const makeHost = () => createHostComposition({ dataPath, workspaceId: WORKSPACE, catalog: PROVIDER_CATALOG, fetch: transport, resolveCredential: async () => 'fixture-token', watchIntervalMs: 20, planningTimers: { setInterval: run => run, clearInterval() {} } })
  const install = host => installHostRemote({ invocation: { peer: { id: 'fixture' } }, provide: () => () => {}, typert: { register: () => () => {} } }, host)
  let host = await makeHost(), installed = await install(host)
  const rebuild = async () => { host.stop(); await installed.dispose(); await host.dispose(); host = await makeHost(); installed = await install(host) }
  const baseline = await installed.service.baseline(), items = baseline.entities.filter(e => e.content.contentKind === 'work_item' && e.content.externalKind === 'issue'), item = baseline.entities.find(e => e.content.contentKind === 'work_item' && e.content.externalKind === 'issue')
  const before = dump(dataPath)
  const { build } = createRequire(new URL('../../apps/harness-plugin/package.json', import.meta.url))('esbuild')
  const bundle = await build({ stdin: { contents: ENTRY, resolveDir: repoRoot }, absWorkingDir: repoRoot, platform: 'browser', bundle: true, format: 'cjs', external: ['react'], write: false, metafile: true })
  const vendor = (id, file) => readFile(path.join(path.dirname(require.resolve(id)), 'umd', file), 'utf8')
  const [react, dom] = await Promise.all([vendor('react', 'react.development.js'), vendor('react-dom/client', 'react-dom.development.js')])
  // JSX runtime 来自官方模块，React 继续使用页面唯一 UMD；不依赖其它 feature 的 fixture helper。
  const jsx = await build({ entryPoints: [require.resolve('react/jsx-runtime')], bundle: true, platform: 'browser', format: 'cjs', external: ['react'], write: false })
  const jsxText = `(function(){const module={exports:{}};const exports=module.exports;const require=id=>{if(id==='react')return window.React;throw Error(id)};${jsx.outputFiles[0].text}\nwindow.ReactJSX=module.exports;})()`
  const scripts = { '/react.js': react, '/dom.js': dom, '/jsx-runtime.js': jsxText, '/bundle.js': bundle.outputFiles[0].text }
  const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#app{height:100%;margin:0;min-width:0}#app{display:flex;flex-direction:column}:root{font:15px/1.5 system-ui;color-scheme:light dark}</style><div id="app"></div><script src="/react.js"></script><script src="/dom.js"></script><script src="/jsx-runtime.js"></script><script>window.require=id=>{if(id==='react')return window.React;if(id==='react/jsx-runtime')return window.ReactJSX;throw Error(id)};var module={exports:{}};var exports=module.exports</script><script src="/bundle.js"></script><script>module.exports.mount(ReactDOM.createRoot(document.getElementById('app'))).then(value=>window.fixture=value)</script></html>`
  const server = createServer(async (request, response) => {
    try {
      const route = new URL(request.url, 'http://fixture.invalid').pathname
      if (scripts[route]) { response.setHeader('content-type', 'text/javascript'); response.end(scripts[route]); return }
      if (route === '/') { response.setHeader('content-type', 'text/html;charset=utf-8'); response.end(page); return }
      if (route === '/watch') {
        const abort = new AbortController(); streams.add(abort); response.on('close', () => abort.abort()); abort.signal.addEventListener('abort', () => response.end(), { once: true }); response.setHeader('content-type', 'application/x-ndjson'); response.flushHeaders()
        try { for await (const frame of installed.service.watch(abort.signal)) { if (!abort.signal.aborted) response.write(JSON.stringify(frame) + '\n') } } finally { streams.delete(abort); response.end() }; return
      }
      if (route === '/remote') {
        let raw = ''; for await (const chunk of request) raw += chunk
        const input = JSON.parse(raw), op = OPERATIONS[input.name], parsed = parseInput(op, input.input); operations.push(input.name)
        const result = await installed.service[input.name](...op.params.map(p => parsed[p.name]))
        if ((input.name === 'getIssueClosingLinks' || input.name === 'refreshIssueDependencies') && flags.holdUi) { flags.holdUi = false; await new Promise(resolve => held.push(resolve)) }
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ok: true, value: result })); return
      }
      response.writeHead(404); response.end()
    } catch { if (response.headersSent) { response.end(); return }; response.writeHead(200); response.end(JSON.stringify({ ok: false, error: 'Host unavailable' })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { flags, requests, operations, rawPr, repository, item, items, dataPath, before, inputs: Object.keys(bundle.metafile.inputs), get service() { return installed.service }, held, rebuild,
    release: () => held.splice(0).forEach(resolve => resolve()), url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { held.splice(0).forEach(resolve => resolve()); for (const abort of streams) abort.abort(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await installed.dispose(); await host.dispose(); await rm(dir, { recursive: true, force: true }) } }
}
