/**
 * Host 的 provider 组合（ADR-0014）：编译期封闭目录（实现键 → 配置 schema + 构造函数）与按已存挂载恢复。
 * 唯一 import provider 包的文件；provider-fake 不得出现在这里。凭据只以句柄存在，值在每次 provider 操作内才经宿主解析。
 */
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  BindingConfigurationSchema, ConnectorAccountRecord, ProviderBindingRecord, ProviderDefinition, Storage, StorageValidationPolicy,
} from '@harness-projects/capabilities'
import type { CoreProviderTable } from '@harness-projects/core'
import { ProjectErrorCode, projectError, type ProjectError, type WorkspaceId } from '@harness-projects/domain'
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

/** GitHub GraphQL 传输：每次请求先解析凭据（空值即 reject，provider 自行归类为 unavailable 且不带原文），不跟随重定向，带超时。 */
function githubGraphqlTransport(fetch: HostFetch, credential: () => Promise<string | undefined>): GraphqlTransport {
  return async ({ operationName, query, variables }) => {
    const token = await credential()
    if (token === undefined || token === '') throw new Error('credential unavailable')
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'harness-projects' },
      body: JSON.stringify({ operationName, query, variables }),
    })
    const body: unknown = await response.json().catch(() => undefined)
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body }
  }
}

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
    if (account?.platformOrigin !== 'https://github.com' || account.secretHandle === undefined) {
      throw new BindingRefused(ProjectErrorCode.NotSupported, '规划挂载需要 github.com 上带凭据句柄的连接账号')
    }
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

export const PROVIDER_CATALOG: ProviderCatalog = catalogOf([GITHUB_PROJECTS_ENTRY, LOCAL_GIT_ENTRY])

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
  env: Pick<ProviderBuildInput, 'worktreesDir' | 'fetch'> & { readonly resolveCredential: (handle: string) => Promise<string | undefined> },
): Promise<{ table: CoreProviderTable; disabled: readonly DisabledBinding[] }> {
  const slots: Record<string, unknown> = {}
  const disabled: DisabledBinding[] = []
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
      port = await entry.create({
        binding, configuration, account, worktreesDir: env.worktreesDir, fetch: env.fetch,
        credential: async () => (handle === undefined ? undefined : env.resolveCredential(handle)),
      })
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
  return { table: slots as CoreProviderTable, disabled }
}
