/**
 * Host 的 provider 组合（ADR-0014）：编译期封闭目录（实现键 → 配置 schema + 构造函数）与按已存挂载恢复。
 * 唯一 import provider 包的文件；provider-fake 不得出现在这里。凭据只以句柄存在，值在每次 provider 操作内才经宿主解析。
 */
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  AccessLevel, CapabilityKey,
  type BindingConfigurationSchema, type ConnectorAccountRecord, type ProviderBindingRecord, type ProviderDefinition, type Storage, type StorageValidationPolicy,
} from '@harness-projects/capabilities'
import type { CoreProviderTable } from '@harness-projects/core'
import { ProjectErrorCode, projectError, type ProjectError, type WorkspaceId } from '@harness-projects/domain'
import { GITHUB_ACTIONS_DEFINITION, createGithubActionsDeliveryProvider, type GithubActionsTransport } from '@harness-projects/provider-delivery-github-actions'
import { GITHUB_DEVELOPMENT_DEFINITION, createGithubDevelopmentProvider } from '@harness-projects/provider-development-github'
import { LOCAL_GIT_PROVIDER_DEFINITION, createLocalGitDevelopmentProvider } from '@harness-projects/provider-development-local-git'
import {
  GITHUB_PROJECTS_PROVIDER_DEFINITION, createGithubProjectsPlanningProvider, type GraphqlTransport,
} from '@harness-projects/provider-planning-github-projects'

/** 宿主允许存进库的凭据句柄：宿主常量，不随目录收缩（带命名空间，避免误用用户环境里通用的 GITHUB_TOKEN）。 */
export const HOST_SECRET_HANDLES = ['HARNESS_PROJECTS_GITHUB_TOKEN'] as const

type HostFetch = (url: string, init: RequestInit) => Promise<Response>

export interface ProviderBuildInput {
  readonly binding: ProviderBindingRecord
  /** 未存配置时为 `{}`。 */
  readonly configuration: Readonly<Record<string, string | boolean>>
  readonly account: ConnectorAccountRecord | undefined
  /** 只绑定该账号的句柄；无账号或无句柄时 resolve `undefined`。每次调用都重新解析，不缓存。 */
  readonly credential: () => Promise<string | undefined>
  readonly worktreesDir: string
  readonly fetch: HostFetch
}

export interface CatalogEntry {
  readonly definition: ProviderDefinition
  readonly configuration: BindingConfigurationSchema
  create(input: ProviderBuildInput): Promise<object>
}
export type ProviderCatalog = ReadonlyMap<string, CatalogEntry>

/** 以实现键为键构造目录：键与定义因此不可能不一致。 */
export const catalogOf = (entries: readonly CatalogEntry[]): ProviderCatalog => new Map(entries.map((entry) => [entry.definition.implementationKey, entry]))

/** 条目拒绝构造该挂载：只禁用这个挂载，带结构化错误码。 */
export class BindingRefused extends Error {
  readonly code: ProjectErrorCode
  constructor(code: ProjectErrorCode, message: string) { super(message); this.code = code }
}

export interface DisabledBinding {
  readonly bindingId: ProviderBindingRecord['id']
  readonly domain: ProviderBindingRecord['domain']
  readonly implementationKey: string
  readonly error: ProjectError
}

const text = (configuration: ProviderBuildInput['configuration'], name: string): string => {
  const value = configuration[name]
  if (typeof value !== 'string') throw new BindingRefused(ProjectErrorCode.InvalidInput, `挂载配置缺少 ${name}`) // 形状已由存储按 schema 校验，这里只处理缺配置
  return value
}

/** 令牌只发往 `GITHUB_API`；GitHub 条目只接受来源恰为 `GITHUB_ORIGIN` 的连接账号（GHES 与其它来源禁用）。端点做成配置属 TD-067。 */
const GITHUB_API = 'https://api.github.com'
const GITHUB_ORIGIN = 'https://github.com'
interface GithubResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }

/**
 * 唯一的 GitHub 出口：每次请求从入口给凭据解析、fetch 与响应体同一个 30 s 预算，底层不响应 abort 时也结束等待；
 * 凭据 undefined 或空串即 reject、零 fetch，provider 自行归类为 unavailable 且不带原文；不跟随重定向；
 * provider 头名先归一为小写，宿主的 authorization 与 user-agent 最后写入、不可被覆盖；响应体不能解析时为 undefined。
 */
async function githubRequest(
  fetch: HostFetch, credential: () => Promise<string | undefined>, url: URL,
  init: { readonly method: 'GET' | 'POST'; readonly headers: Readonly<Record<string, string>>; readonly body?: string },
): Promise<GithubResponse> {
  const signal = AbortSignal.timeout(30_000)
  let onAbort!: () => void
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([deadline, (async () => {
      signal.throwIfAborted()
      const token = await credential()
      signal.throwIfAborted() // 预算后凭据才到达：不再发送请求；race 消费这条分支的晚拒绝。
      if (token === undefined || token === '') throw new Error('credential unavailable')
      const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]))
      const response = await fetch(url.href, {
        method: init.method,
        redirect: 'error',
        signal,
        headers: { ...headers, authorization: `bearer ${token}`, 'user-agent': 'harness-projects' },
        ...(init.body === undefined ? {} : { body: init.body }),
      })
      signal.throwIfAborted()
      const body: unknown = await response.json().catch(() => undefined)
      signal.throwIfAborted()
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body }
    })()])
  } finally { signal.removeEventListener('abort', onAbort) }
}

/** 连接设置只接受真实 viewer 的两个必要身份字段，不保存响应或凭据值。 */
export async function githubViewer(fetch: HostFetch, credential: () => Promise<string | undefined>) {
  let code: ProjectErrorCode = ProjectErrorCode.Unavailable
  try {
    const response = await githubRequest(fetch, credential, new URL('/user', GITHUB_API), { method: 'GET', headers: { accept: 'application/vnd.github+json' } })
    if (response.status === 200 && typeof response.body === 'object' && response.body !== null) {
      const body = response.body as Record<string, unknown>
      if (typeof body.node_id === 'string' && body.node_id !== '' && typeof body.login === 'string' && body.login !== '') return { ok: true as const, value: { nodeId: body.node_id, login: body.login } }
    }
    code = response.status === 429 || (response.status === 403 && response.headers['x-ratelimit-remaining'] === '0') ? ProjectErrorCode.RateLimited
      : response.status === 401 || response.status === 403 ? ProjectErrorCode.PermissionDenied : response.status === 404 ? ProjectErrorCode.NotFound : ProjectErrorCode.Unavailable
  } catch { /* 固定错误不暴露凭据服务和响应原文 */ }
  return { ok: false as const, error: projectError(code, 'GitHub 账号身份尚未确认') }
}

/** GitHub GraphQL 传输：规划与研发 provider 共用（两者的 GraphqlTransport 结构逐字同形）。 */
function githubGraphqlTransport(fetch: HostFetch, credential: () => Promise<string | undefined>): GraphqlTransport {
  return ({ operationName, query, variables }) => githubRequest(fetch, credential, new URL('/graphql', GITHUB_API), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName, query, variables }),
  })
}

/**
 * GitHub REST 传输（Actions provider 用）：方法固定 GET；URL 以 pathname 赋值构造，origin 在结构上保持 api.github.com
 * （拼接会把 `.evil.example/x` 拼成别的主机）；query 逐项写进 searchParams。不请求响应里给出的任何 URL。
 */
export function githubRestTransport(fetch: HostFetch, credential: () => Promise<string | undefined>): GithubActionsTransport {
  return ({ path: pathname, query, headers }) => {
    const url = new URL(GITHUB_API)
    url.pathname = pathname
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value))
    return githubRequest(fetch, credential, url, { method: 'GET', headers })
  }
}

/** 规划与研发条目共用：账号必须在 github.com 上且带宿主句柄，否则只禁用该挂载。 */
function requireGithubCredential(account: ConnectorAccountRecord | undefined, role: string): void {
  if (account?.platformOrigin !== GITHUB_ORIGIN || account.secretHandle === undefined) {
    throw new BindingRefused(ProjectErrorCode.NotSupported, `${role}挂载需要 github.com 上带凭据句柄的连接账号`)
  }
}

/** 研发与 Actions 条目共用的仓库配置：owner/name 与 provider 的单路径分量规则一致，坏值在写库时被拒（TD-055：已声明 schema 不宜再收紧）。 */
const GITHUB_REPOSITORY: BindingConfigurationSchema = {
  repositoryExternalId: { kind: 'string', required: true, pattern: '[^\\s]+', maxLength: 200 },
  repositoryOwner: { kind: 'string', required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*', maxLength: 100 },
  repositoryName: { kind: 'string', required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*', maxLength: 100 },
}
const githubRepository = (configuration: ProviderBuildInput['configuration']) =>
  ({ externalId: text(configuration, 'repositoryExternalId'), owner: text(configuration, 'repositoryOwner'), name: text(configuration, 'repositoryName') })

/** 检出根：自 `repositoryPath` 的 realpath 向上找 `.git`（目录或 gitfile），找不到就是它自己；仓库尚不存在时不向上借用外层检出。 */
async function checkoutRootOf(repositoryPath: string): Promise<string> {
  const start = await realpath(repositoryPath).catch(() => undefined)
  if (start === undefined) return path.resolve(repositoryPath)
  for (let dir = start; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    if (await stat(path.join(dir, '.git')).then(() => true, () => false)) return dir
  }
  return start
}

const GITHUB_PROJECTS_ENTRY: CatalogEntry = {
  definition: GITHUB_PROJECTS_PROVIDER_DEFINITION,
  configuration: { projectNodeId: { kind: 'string', required: true, pattern: 'PVT_[A-Za-z0-9_-]+', maxLength: 100 } },
  async create({ binding, configuration, account, credential, fetch }) {
    requireGithubCredential(account, '规划')
    return createGithubProjectsPlanningProvider({ bindingId: binding.id, projectNodeId: text(configuration, 'projectNodeId'), transport: githubGraphqlTransport(fetch, credential) })
  },
}

const LOCAL_GIT_ENTRY: CatalogEntry = {
  definition: LOCAL_GIT_PROVIDER_DEFINITION,
  configuration: {
    repositoryPath: { kind: 'string', required: true, pattern: '/[^\\n\\r]*', maxLength: 1024 },
    repositoryExternalId: { kind: 'string', required: true, pattern: '[^\\s]+', maxLength: 200 },
  },
  async create({ binding, configuration, worktreesDir }) {
    const repositoryPath = text(configuration, 'repositoryPath')
    // 允许根是数据根与 binding id 的纯函数（I5）：数据根被放进仓库检出（含 repositoryPath 是检出子目录、数据根或仓库路径经符号链接给出）时，允许根随之落进检出，禁用该挂载；数据根下的 worktrees 或摘要分量本身是符号链接时守卫看不到（#132 计划 D35）。
    const allowedRoot = path.join(worktreesDir, createHash('sha256').update(binding.id).digest('hex').slice(0, 16))
    const relative = path.relative(await checkoutRootOf(repositoryPath), allowedRoot)
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new BindingRefused(ProjectErrorCode.InvalidInput, '工作树允许根落在仓库检出之内')
    return createLocalGitDevelopmentProvider({ bindingId: binding.id, repository: { externalId: text(configuration, 'repositoryExternalId'), path: repositoryPath }, allowedRoot })
  },
}

/** github.com 账号和宿主句柄是 GitHub transport 的构造前提；lazy 模式不在组合期探针。 */
const GITHUB_DEVELOPMENT_ENTRY: CatalogEntry = {
  definition: GITHUB_DEVELOPMENT_DEFINITION,
  configuration: GITHUB_REPOSITORY,
  async create({ binding, configuration, account, credential, fetch }) {
    requireGithubCredential(account, '研发')
    return createGithubDevelopmentProvider({ bindingId: binding.id, repository: githubRepository(configuration), transport: githubGraphqlTransport(fetch, credential), permissionMode: 'lazy' })
  },
}

/**
 * 权限只取 Host 确知的账号事实、只在内存推导（计划 D1、D2）：github.com 账号带句柄 → degraded（未验证，照常读，逐次调用结果为准）；
 * 无账号或无句柄 → 组合但显式 unavailable（禁用后在 wire 上与「没有挂载」不可区分）；非 github.com 账号禁用，令牌只发往 api.github.com。
 */
const GITHUB_ACTIONS_ENTRY: CatalogEntry = {
  definition: GITHUB_ACTIONS_DEFINITION,
  configuration: GITHUB_REPOSITORY,
  async create({ binding, configuration, account, credential, fetch }) {
    if (account !== undefined && account.platformOrigin !== GITHUB_ORIGIN) throw new BindingRefused(ProjectErrorCode.NotSupported, 'Actions 挂载的连接账号必须在 github.com 上')
    const access = account?.secretHandle === undefined ? AccessLevel.Unavailable : AccessLevel.Degraded
    return createGithubActionsDeliveryProvider({
      bindingId: binding.id, repository: githubRepository(configuration), transport: githubRestTransport(fetch, credential), observedAt: new Date().toISOString(),
      permission: { [CapabilityKey.DeliveryPipelineRead]: access, [CapabilityKey.DeliveryCheckRead]: access },
    })
  },
}

export const PROVIDER_CATALOG: ProviderCatalog = catalogOf([GITHUB_PROJECTS_ENTRY, LOCAL_GIT_ENTRY, GITHUB_DEVELOPMENT_ENTRY, GITHUB_ACTIONS_ENTRY])

/** 存储打开期的受信策略：句柄取宿主常量，配置 schema 取目录各条目的声明。 */
export function hostStoragePolicy(catalog: ProviderCatalog): StorageValidationPolicy {
  return {
    allowedSecretHandles: new Set<string>(HOST_SECRET_HANDLES),
    configurations: new Map([...catalog].map(([key, entry]) => [key, entry.configuration])),
  }
}

/**
 * 按已存挂载恢复 provider 表。binding id 永远取自存储，启动时不生成任何 id；被停用（enabled=false）的挂载是用户意图，跳过且不计入 disabled；
 * 运行期无法构造的挂载（目录无该键、域不匹配、配置或账号不合格、槽位冲突、构造抛错）只出现在 disabled，不写库，实现回来后以原身份复活。
 */
export async function restoreProviders(
  storage: Storage, workspaceId: WorkspaceId, catalog: ProviderCatalog,
  env: Pick<ProviderBuildInput, 'worktreesDir' | 'fetch'> & { readonly resolveCredential: (handle: string) => Promise<string | undefined>; readonly development?: { readonly cache: Map<string, object>; readonly resolveCredential: (handle: string) => Promise<string | undefined>; readonly fetch: HostFetch } },
): Promise<{ table: CoreProviderTable; disabled: readonly DisabledBinding[] }> {
  const slots: Record<string, unknown> = {}
  const disabled: DisabledBinding[] = []
  const used = new Set<string>()
  for (const binding of await storage.listProviderBindings(workspaceId)) {
    if (!binding.enabled) continue
    const refuse = (code: ProjectErrorCode, message: string): void => {
      disabled.push({ bindingId: binding.id, domain: binding.domain, implementationKey: binding.implementationKey, error: projectError(code, message) })
    }
    const entry = catalog.get(binding.implementationKey)
    if (entry === undefined) { refuse(ProjectErrorCode.NotSupported, '宿主目录里没有这个实现'); continue }
    if (!(entry.definition.domains as readonly string[]).includes(binding.domain)) { refuse(ProjectErrorCode.InvalidInput, '实现不提供这个挂载的能力域'); continue }
    const configuration = (await storage.getBindingConfiguration({ workspaceId, bindingId: binding.id, domain: binding.domain }))?.configuration ?? {}
    const accountId = await storage.getProviderBindingAccount(binding.id)
    const account = accountId === undefined ? undefined : await storage.getConnectorAccount(accountId)
    const handle = account?.secretHandle
    let port: object
    try {
      const cache = binding.implementationKey === 'development.github' ? env.development : undefined
      const key = JSON.stringify([binding.id, binding.implementationKey, Object.entries(configuration).sort(([a], [b]) => a.localeCompare(b)), account?.id, account?.platformFamily, account?.platformOrigin, account?.identityKind, account?.externalId, handle])
      port = cache?.cache.get(key) ?? await entry.create({
        binding, configuration, account, worktreesDir: env.worktreesDir, fetch: cache?.fetch ?? env.fetch,
        credential: async () => (handle === undefined ? undefined : (cache ?? env).resolveCredential(handle)),
      })
      if (cache) { cache.cache.set(key, port); used.add(key) }
    } catch (error) {
      if (error instanceof BindingRefused) refuse(error.code, error.message)
      else refuse(ProjectErrorCode.Unavailable, '实现构造失败')
      continue
    }
    // development 可挂多个（Core 按仓库路由）；其余能力域一个槽位，已占即冲突。执行回退槽位随目录收录执行实现再加（TD-054）。
    if (binding.domain === 'development') ((slots.development ??= []) as object[]).push(port)
    else if (slots[binding.domain] === undefined) slots[binding.domain] = port
    else refuse(ProjectErrorCode.Conflict, '同一能力域的槽位已被占用')
  }
  if (env.development) for (const key of env.development.cache.keys()) if (!used.has(key)) env.development.cache.delete(key)
  return { table: slots as CoreProviderTable, disabled }
}
