// Host 组合测试的共享夹具（#132，`node --test` 不执行它）：`seed` 在 Host 之外直接写库，`dump` 只读转储全部表，`fakePlanningEntry` 是仅供测试的
// `harness.fake` 目录条目（provider-fake 不进 apps/harness-plugin 的 manifest 与源码），其余是 Host 测试共用的种子记录与 GitHub 录制回放。
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FAKE_PROVIDER_DEFINITION, createFakePlanningProvider } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { hostStoragePolicy } from '../../../apps/harness-plugin/src/host-providers.ts'
import { createReplay, loadFieldFixture, loadFixture } from '../../contract/fixtures/github-projects/replay.js'

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
