// Host 组合测试的共享夹具（#132，`node --test` 不执行它）：`seed` 在 Host 之外直接写库，`dump` 只读转储全部表，`fakePlanningEntry` 是仅供测试的
// `harness.fake` 目录条目（provider-fake 不进 apps/harness-plugin 的 manifest 与源码），其余是 Host 测试共用的种子记录与 GitHub 录制回放。
import { mkdirSync, readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FAKE_PROVIDER_DEFINITION, createFakePlanningProvider } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { hostStoragePolicy } from '../../../apps/harness-plugin/src/host-providers.ts'
import { createReplay, loadFieldFixture, loadFixture } from '../../contract/fixtures/github-projects/replay.js'
import { COMMIT, OWNER, REPO_NAME, REPOSITORY_EXTERNAL_ID, checksPath, recordedPages, runsPath, suitesPath } from '../../fixtures/github-actions.mjs'

/** 以 Host 同一份策略打开库，让 `build(storage)` 写入工作区、挂载、账号、关联与配置，然后关闭。 */
export async function seed(dataPath, catalog, build) {
  mkdirSync(path.dirname(dataPath), { recursive: true })
  const storage = createSqliteStorage(dataPath, hostStoragePolicy(catalog))
  try { await build(storage) } finally { storage.close() }
}

/** 只读转储：按 `sqlite_master` 遍历全部表，每表一个 `JSON.stringify(SELECT *)`。 */
export function dump(dataPath) {
  const db = new DatabaseSync(dataPath, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    return Object.fromEntries(tables.map(({ name }) => [name, JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())]))
  } finally { db.close() }
}

/** 数据目录下扫描时在场的全部文件里 needle 的出现次数（存储不开 WAL，不会有 -wal、-shm；扫了哪些文件由调用方断言）。 */
export async function occurrences(dir, needle) {
  let count = 0
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && (await readFile(path.join(entry.parentPath, entry.name))).includes(needle)) count += 1
  }
  return count
}

/** `harness.fake` 的目录条目；`onCreate(provider)` 返回非 `undefined` 时替换交给 Core 的实例（例如包一层 Proxy 注入故障）。 */
export function fakePlanningEntry(onCreate = () => undefined) {
  return {
    definition: FAKE_PROVIDER_DEFINITION,
    configuration: {},
    create: async ({ binding }) => {
      const provider = createFakePlanningProvider({ bindingId: binding.id })
      return onCreate(provider) ?? provider
    },
  }
}

export const WORKSPACE = '00000000-0000-4000-8000-000000000228'
export const GITHUB = '00000000-0000-4000-8000-0000000000a1'
export const ACCOUNT = 'account-github-1'
export const HANDLE = 'HARNESS_PROJECTS_GITHUB_TOKEN'
/** 沙箱 Project A 的节点 id 取自回放夹具，不写字面值（计划 F12）。 */
export const projectNodeId = loadFixture().exchanges.find((exchange) => exchange.operationName === 'PlanningProject').variables.project
export const account = (overrides = {}) => ({ id: ACCOUNT, platformFamily: 'github', platformOrigin: 'https://github.com', identityKind: 'account', externalId: 'octo-1', displayName: 'Octo', secretHandle: HANDLE, connectionState: 'connected', ...overrides })
export const mount = (id, domain, implementationKey, overrides = {}) => ({ id, workspaceId: WORKSPACE, domain, implementationKey, enabled: true, isDefault: true, ...overrides })
export const ref = (id, domain) => ({ workspaceId: WORKSPACE, bindingId: id, domain })
export async function seedWorkspace(storage, statusPolicy = 'provider_authoritative') { await storage.putWorkspace({ id: WORKSPACE, name: 'Seeded Workspace', statusPolicy }) }
/** 规划挂载 P：连接账号只存句柄，配置只有 projectNodeId（库里没有凭据值）。 */
export async function seedPlanning(storage, accountOverrides = {}) {
  await storage.putProviderBinding(mount(GITHUB, 'planning', 'planning.github-projects'))
  await storage.putConnectorAccount(account(accountOverrides))
  await storage.setProviderBindingAccount(GITHUB, ACCOUNT)
  await storage.putBindingConfiguration({ ref: ref(GITHUB, 'planning'), configuration: { projectNodeId } })
}

/** 录制回放包成 fetch：每次请求先 `await gate()`（可让在途调用停在 provider 里），再记录鉴权头、redirect 模式与 signal，把请求体交给回放。 */
export function replayFetch(gate = () => undefined) {
  const replay = createReplay(loadFixture(), loadFieldFixture())
  const requests = []
  const fetch = async (url, init) => {
    await gate()
    requests.push({ url, authorization: init.headers.authorization, redirect: init.redirect, signal: init.signal })
    const { status, body } = await replay.transport(JSON.parse(init.body))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, requests, misses: replay.misses }
}

/** GitHub 研发的沙箱录制（#231）；仓库 owner/name 取自它的 `DevelopmentRepository` 成功交换，不写字面值。 */
export const developmentFixture = JSON.parse(readFileSync(new URL('../../contract/fixtures/github-development/sandbox.json', import.meta.url), 'utf8'))
const sandbox = developmentFixture.exchanges.find((exchange) => exchange.operationName === 'DevelopmentRepository' && exchange.body.data.repository !== null).variables
/** 仓库挂载的实现键 → [能力域, 配置]；配置恰为 #373 写入的三个字段。 */
export const REPOSITORY_MOUNTS = {
  'development.github': ['development', { repositoryExternalId: REPOSITORY_EXTERNAL_ID, repositoryOwner: sandbox.owner, repositoryName: sandbox.name }],
  'github-actions': ['delivery', { repositoryExternalId: REPOSITORY_EXTERNAL_ID, repositoryOwner: OWNER, repositoryName: REPO_NAME }],
}
/** REST 路由白名单：只认 Actions 夹具仓库的这三条路径（`recordedPages` 对任何路径都应答，白名单必须由这里守，计划 S4）。 */
const REST_ROUTES = new Map([[runsPath(), recordedPages('runs')], [checksPath(COMMIT), recordedPages('checks')], [suitesPath(COMMIT), recordedPages('checks')]])
/** 仓库挂载（研发或 Actions）：`linked` 为 false 时不关联账号（账号由调用方先写）。 */
export async function seedRepositoryMount(storage, id, implementationKey, { linked = true, ...overrides } = {}) {
  const [domain, configuration] = REPOSITORY_MOUNTS[implementationKey]
  await storage.putProviderBinding(mount(id, domain, implementationKey, overrides))
  if (linked) await storage.setProviderBindingAccount(id, ACCOUNT)
  await storage.putBindingConfiguration({ ref: ref(id, domain), configuration })
}

/**
 * 宿主出口看到的 GitHub：`/graphql` 回放规划两份与研发一份录制，REST 只按白名单路由到 Actions 的脱敏真实形状两页。
 * 账本逐请求记 origin、path、query、method、operationName、经 `Headers` 归一后的全部请求头（即 fetch 实际会发的头）、redirect 与 signal；
 * 未命中记进 `misses` 再 reject。
 */
export function githubFetch() {
  const replay = createReplay(loadFixture(), loadFieldFixture(), developmentFixture)
  const requests = []
  const fetch = async (href, init) => {
    const url = new URL(href)
    const body = url.pathname === '/graphql' && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({
      href, origin: url.origin, path: url.pathname, query: Object.fromEntries(url.searchParams), method: init.method, operationName: body?.operationName,
      headers: Object.fromEntries(new Headers(init.headers)), redirect: init.redirect, signal: init.signal,
    })
    const route = REST_ROUTES.get(url.pathname)
    if (body === undefined && route === undefined) {
      replay.misses.push(`${init.method} ${url.pathname}`)
      throw new Error('回放未命中')
    }
    if (body === undefined) { // 查询串里的纯数字还原成数字，与 provider 交给 transport 的 query 同形
      const query = Object.fromEntries([...url.searchParams].map(([key, value]) => [key, /^\d+$/.test(value) ? Number(value) : value]))
      const { status, headers, body: payload } = route({ method: init.method, path: url.pathname, query })
      return new Response(JSON.stringify(payload), { status, headers })
    }
    const { status, body: payload } = await replay.transport(body)
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, requests, misses: replay.misses }
}
