/**
 * 工作区设置命令（#127）：创建工作区、连接账号、把规划来源挂到工作区。三条都是 create-or-verify：在**一个** Storage 事务里
 * 读自然键 → 判定 → 写——相同即零写入、返回由行算出的 id；不同即结构化拒绝（事务回滚）；缺席才写。只写本地事实、不调用 provider，
 * 写出的正是 Host 恢复时读取的行集（工作区、启用的规划挂载、挂载配置、锚点→账号关联、账号句柄）。幂等不靠持久回执：每个目标都有
 * 存储强制的自然键，已提交的行就是结果（ExecPlan D2）。模式辅助函数供 core 内后续的设置命令（#353）以相对路径复用，不进包入口。
 */
import { setPlanningMapping, type SetPlanningMappingRequest } from './planning-mapping.ts'
import { isDeepStrictEqual } from 'node:util'
import {
  CapabilityDomain, ConnectorConnectionState, ProjectErrorCode, projectError,
  type ConnectorAccountIdentity, type ProjectError, type ProviderBindingRecord, type SecretHandle, type Storage, type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  StatusPolicy, newConnectorAccountId, newProviderBindingId,
  type ConnectorAccountId, type ProviderBindingId, type WorkspaceId,
} from '@harness-projects/domain'
import { defaultIdFactory } from './context.ts'
import { registerRepository, repositoryReferences } from './development-route.ts'

export type SetupOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProjectError }
export interface CreateWorkspaceRequest { readonly workspaceId: WorkspaceId; readonly name: string; readonly statusPolicy: StatusPolicy }
export interface ConnectAccountRequest extends ConnectorAccountIdentity { readonly displayName: string; readonly secretHandle: string }
export interface BindPlanningSourceRequest {
  readonly workspaceId: WorkspaceId; readonly accountId: ConnectorAccountId
  readonly implementationKey: string; readonly configuration: Readonly<Record<string, string | boolean>>
}
/** 仓库在一条连接下的引用（#353）：挂载目标加能力域；本版本只接 Development 与交付。 */
export interface RepositoryReferenceRequest extends MountTarget { readonly domain: Extract<CapabilityDomain, 'development' | 'delivery'> }
export interface BindRepositoryRequest { readonly workspaceId: WorkspaceId; readonly repositoryId: string; readonly references: readonly RepositoryReferenceRequest[] }
/** `bindingIds` 与请求的引用一一对应、同序。 */
export interface RepositoryBinding { readonly repositoryId: string; readonly bindingIds: readonly ProviderBindingId[] }
export interface WorkspaceSetup {
  setPlanningMapping(request: SetPlanningMappingRequest): Promise<SetupOutcome<{ readonly bindingId: ProviderBindingId }>>
  createWorkspace(request: CreateWorkspaceRequest): Promise<SetupOutcome<{ readonly workspaceId: WorkspaceId }>>
  connectAccount(request: ConnectAccountRequest): Promise<SetupOutcome<{ readonly accountId: ConnectorAccountId }>>
  /** 工作区同一时刻只有一个启用的规划来源（不变量 1）：目标不同即 conflict；只剩停用挂载时是 #202 的切换，not_supported。 */
  bindPlanningSource(request: BindPlanningSourceRequest): Promise<SetupOutcome<{ readonly bindingId: ProviderBindingId }>>
  /** 一个仓库实体并列持有各连接下的引用（ADR-0015）：逐引用按 `(domain, implementationKey)` create-or-verify，只追加、不改绑、不替换交付来源。 */
  bindRepository(request: BindRepositoryRequest): Promise<SetupOutcome<RepositoryBinding>>
}

/** 设置命令的拒绝：只在 `runSetup` 的事务内抛出——异常令事务整笔回滚，`runSetup` 再把它还原成结果值。 */
class SetupRefusal extends Error {
  readonly failure: ProjectError
  constructor(failure: ProjectError) { super(failure.message); this.name = 'SetupRefusal'; this.failure = failure }
}

/** 存储校验拒绝（写口的 `RangeError`）的唯一文案：存储原文描述的是被拒的值，粘进句柄字段的令牌不能经结果上 wire。 */
const STORAGE_REJECTED = '设置请求被存储校验拒绝'

/** 一个 Storage 事务；work 内 refuse 回滚并返回 { ok: false }；其余异常（含读口与程序错误的 `RangeError`）上抛，由 Host 的 guarded 记诊断。 */
export async function runSetup<T>(storage: Storage, work: (tx: StorageTransaction) => Promise<T>): Promise<SetupOutcome<T>> {
  try {
    return { ok: true, value: await storage.transaction(work) }
  } catch (error) {
    if (error instanceof SetupRefusal) return { ok: false, error: error.failure }
    throw error
  }
}

/** 结构化拒绝：只能在 `runSetup` 的 work 内调用（事务回滚，结果为 `{ ok: false }`）；在 work 之外调用会作为普通异常逃逸。message 不得含输入值。 */
export function refuse(code: ProjectErrorCode, message: string): never {
  throw new SetupRefusal(projectError(code, message))
}

/** 存储写口的 `RangeError` 是存储校验拒绝（句柄不在允许名单、配置不合 schema……）→ 固定文案 invalid_input；读口的（库里的坏行）与程序错误不经这里（#376）。 */
async function storageWrite(write: () => Promise<void>): Promise<void> {
  try { await write() } catch (error) {
    if (error instanceof RangeError) refuse(ProjectErrorCode.InvalidInput, STORAGE_REJECTED)
    throw error
  }
}

/** 非普通对象或含 allowed 之外的键 → refuse(invalid_input)，文案不含键名与值。 */
export function assertClosed(request: unknown, allowed: readonly string[]): void {
  const prototype = request !== null && typeof request === 'object' ? Object.getPrototypeOf(request) : undefined
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(request as object).some((key) => typeof key !== 'string' || !allowed.includes(key))) {
    refuse(ProjectErrorCode.InvalidInput, '设置请求必须是只含已声明字段的普通对象')
  }
}

/** 挂载的目标：实现键、关联账号与配置；是否同一挂载只由 `sameMountTarget` 判定（#353 的仓库挂载同样按它判定零写入）。 */
export interface MountTarget {
  readonly implementationKey: string; readonly accountId: ConnectorAccountId | undefined
  readonly configuration: Readonly<Record<string, string | boolean>>
}

/** 未存配置读作 `{}`，与 Host 恢复路径同一缺省。 */
export async function readMountTarget(tx: StorageTransaction, mount: ProviderBindingRecord): Promise<MountTarget> {
  const stored = await tx.getBindingConfiguration({ workspaceId: mount.workspaceId, bindingId: mount.id, domain: mount.domain })
  return { implementationKey: mount.implementationKey, accountId: await tx.getProviderBindingAccount(mount.id), configuration: stored?.configuration ?? {} }
}

/** 「相同即零写入、不同即 conflict」的唯一比较点：深等，但配置按值比较、不比原型——存储同样接受空原型配置，同值重放不是冲突（#384）。 */
export function sameMountTarget(stored: MountTarget, requested: MountTarget): boolean {
  const byValue = (target: MountTarget): MountTarget => ({ ...target, configuration: { ...target.configuration } })
  return isDeepStrictEqual(byValue(stored), byValue(requested))
}

/** 锚点 + 挂载 → 账号关联（accountId 有值时）→ 配置；只能在 runSetup 的事务内调用。 */
export async function writeMount(tx: StorageTransaction, mount: Omit<ProviderBindingRecord, 'implementationKey'>, target: MountTarget): Promise<void> {
  await storageWrite(async () => {
    await tx.putProviderBinding({ ...mount, implementationKey: target.implementationKey })
    if (target.accountId !== undefined) await tx.setProviderBindingAccount(mount.id, target.accountId)
    await tx.putBindingConfiguration({ ref: { workspaceId: mount.workspaceId, bindingId: mount.id, domain: mount.domain }, configuration: target.configuration })
  })
}

const WORKSPACE_FIELDS = ['workspaceId', 'name', 'statusPolicy'] as const
const IDENTITY_FIELDS = ['platformFamily', 'platformOrigin', 'identityKind', 'externalId'] as const
const ACCOUNT_FIELDS = [...IDENTITY_FIELDS, 'displayName', 'secretHandle'] as const
const BINDING_FIELDS = ['workspaceId', 'accountId', 'implementationKey', 'configuration'] as const
const REPOSITORY_FIELDS = ['workspaceId', 'repositoryId', 'references'] as const
const REFERENCE_FIELDS = ['domain', 'implementationKey', 'accountId', 'configuration'] as const
const REFERENCE_DOMAINS: readonly unknown[] = [CapabilityDomain.Development, CapabilityDomain.Delivery]
const STATUS_POLICIES: readonly unknown[] = Object.values(StatusPolicy)
const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() !== ''
const plainObject = (value: unknown): boolean => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
/** 一条引用的字段类型：能力域在两域内、实现键非空、账号缺省或非空、配置是普通对象（字段由存储按 schema 校验）。 */
const referenceShaped = (reference: RepositoryReferenceRequest): boolean => REFERENCE_DOMAINS.includes(reference.domain) && nonBlank(reference.implementationKey)
  && (reference.accountId === undefined || nonBlank(reference.accountId)) && plainObject(reference.configuration)

export function createWorkspaceSetup(storage: Storage): WorkspaceSetup {
  return {
    setPlanningMapping: (request) => setPlanningMapping(storage, request),
    // 先读后写：SQLite 的 putWorkspace 是 upsert，盲写会静默改名或改策略。
    createWorkspace: (request) => runSetup(storage, async (tx) => {
      assertClosed(request, WORKSPACE_FIELDS)
      const { workspaceId, name, statusPolicy } = request
      if (!nonBlank(workspaceId) || !nonBlank(name) || !STATUS_POLICIES.includes(statusPolicy)) refuse(ProjectErrorCode.InvalidInput, '工作区 id 与名称必须是非空字符串，状态策略必须是已知取值')
      const existing = await tx.getWorkspace(workspaceId)
      if (existing === undefined) await tx.putWorkspace({ id: workspaceId, name, statusPolicy })
      else if (existing.name !== name || existing.statusPolicy !== statusPolicy) refuse(ProjectErrorCode.Conflict, '该工作区已以另一名称或状态策略存在')
      return { workspaceId }
    }),

    // 账号自然键已由存储强制；同键换显示名或句柄不静默改指凭据。句柄缺省在存储里表示「无认证账号」，设置命令不登记这种账号。
    connectAccount: (request) => runSetup(storage, async (tx) => {
      assertClosed(request, ACCOUNT_FIELDS)
      if (typeof request.secretHandle !== 'string') refuse(ProjectErrorCode.InvalidInput, '连接账号必须带宿主允许的凭据句柄')
      const existing = (await tx.listConnectorAccounts()).find((account) => IDENTITY_FIELDS.every((field) => account[field] === request[field]))
      if (existing !== undefined) {
        if (existing.displayName !== request.displayName || existing.secretHandle !== request.secretHandle) refuse(ProjectErrorCode.Conflict, '该连接账号已以另一显示名或凭据句柄登记')
        return { accountId: existing.id }
      }
      const accountId = newConnectorAccountId()
      await storageWrite(() => tx.putConnectorAccount({
        id: accountId, platformFamily: request.platformFamily, platformOrigin: request.platformOrigin, identityKind: request.identityKind, externalId: request.externalId,
        displayName: request.displayName, secretHandle: request.secretHandle as SecretHandle, connectionState: ConnectorConnectionState.Connected,
      }))
      return { accountId }
    }),

    // 不变量 1 两层保证：这里的事务内预检给出结构化错误，存储的唯一约束兜底并发。
    bindPlanningSource: (request) => runSetup(storage, async (tx) => {
      assertClosed(request, BINDING_FIELDS)
      if (!nonBlank(request.implementationKey) || !plainObject(request.configuration)) refuse(ProjectErrorCode.InvalidInput, '实现键必须是非空字符串，配置必须是普通对象')
      if (await tx.getWorkspace(request.workspaceId) === undefined) refuse(ProjectErrorCode.NotFound, '工作区不存在')
      if (await tx.getConnectorAccount(request.accountId) === undefined) refuse(ProjectErrorCode.NotFound, '连接账号不存在')
      const target: MountTarget = { implementationKey: request.implementationKey, accountId: request.accountId, configuration: request.configuration }
      const planning = (await tx.listProviderBindings(request.workspaceId)).filter((mount) => mount.domain === CapabilityDomain.Planning)
      const enabled = planning.find((mount) => mount.enabled)
      if (enabled !== undefined) {
        if (sameMountTarget(await readMountTarget(tx, enabled), target)) return { bindingId: enabled.id }
        refuse(ProjectErrorCode.Conflict, '工作区已有启用的规划来源，同一时刻只能有一个')
      } else if (planning.length > 0) {
        refuse(ProjectErrorCode.NotSupported, '工作区已有停用的规划来源：切换规划来源尚不支持')
      }
      const bindingId = newProviderBindingId()
      await writeMount(tx, { id: bindingId, workspaceId: request.workspaceId, domain: CapabilityDomain.Planning, enabled: true, isDefault: true }, target)
      return { bindingId }
    }),

    // 先只读地逐引用判定（复用 / 拒绝 / 新建），全部通过才写挂载——所以拒绝零写入；挂载与账号关联写完，唯一写者再登记仓库与身份（关联须先于锚点上的身份）。
    bindRepository: (request) => runSetup(storage, async (tx) => {
      assertClosed(request, REPOSITORY_FIELDS)
      const { workspaceId, repositoryId, references } = request
      if (!nonBlank(repositoryId) || !Array.isArray(references) || references.length === 0) refuse(ProjectErrorCode.InvalidInput, '仓库键必须是非空字符串，引用必须是非空数组')
      for (const reference of references) assertClosed(reference, REFERENCE_FIELDS)
      const keys = new Set(references.map((reference) => `${reference.domain} ${reference.implementationKey}`))
      if (!references.every(referenceShaped) || keys.size !== references.length || references.filter((reference) => reference.domain === CapabilityDomain.Delivery).length > 1) {
        refuse(ProjectErrorCode.InvalidInput, '每条引用须是 Development 或交付域、实现键非空、配置是普通对象；同一实现至多一条，交付引用至多一条')
      }
      if (await tx.getWorkspace(workspaceId) === undefined) refuse(ProjectErrorCode.NotFound, '工作区不存在')
      for (const { accountId } of references) if (accountId !== undefined && await tx.getConnectorAccount(accountId) === undefined) refuse(ProjectErrorCode.NotFound, '连接账号不存在')
      const registered = (await tx.listRepositories(workspaceId)).find((mount) => mount.id === repositoryId)
      if (registered === undefined && !references.some((reference) => reference.domain === CapabilityDomain.Development)) refuse(ProjectErrorCode.InvalidInput, '仓库尚未登记：首次绑定必须带一条 Development 引用')
      const mounts = await tx.listProviderBindings(workspaceId)
      const current = registered === undefined ? [] : await repositoryReferences(tx, registered, mounts.map((mount) => mount.id))
      if (registered !== undefined && !current.some((identity) => identity.id === registered.externalIdentityId)) refuse(ProjectErrorCode.Conflict, '仓库已登记，但它的锚点不在本工作区任何挂载下：不猜实体')
      const bindingIds: ProviderBindingId[] = []
      const created: { readonly id: ProviderBindingId; readonly reference: RepositoryReferenceRequest; readonly target: MountTarget }[] = []
      for (const reference of references) {
        const target: MountTarget = { implementationKey: reference.implementationKey, accountId: reference.accountId, configuration: reference.configuration }
        const existing = mounts.find((mount) => mount.domain === reference.domain && mount.implementationKey === reference.implementationKey && current.some((identity) => identity.bindingId === mount.id))
        if (existing !== undefined) {
          if (!sameMountTarget(await readMountTarget(tx, existing), target)) refuse(ProjectErrorCode.Conflict, '仓库在该实现下已有引用而目标不同：本版本不改绑')
          bindingIds.push(existing.id)
          continue
        }
        // 交付读取按 key 取工作区默认的交付挂载（TD-074）：写新默认会静默降级旧的，所以不替换交付来源。
        if (reference.domain === CapabilityDomain.Delivery && mounts.some((mount) => mount.domain === CapabilityDomain.Delivery && mount.enabled)) refuse(ProjectErrorCode.Conflict, '工作区已有启用的交付来源：不替换')
        const id = newProviderBindingId()
        bindingIds.push(id)
        created.push({ id, reference, target })
      }
      for (const { id, reference, target } of created) {
        await writeMount(tx, { id, workspaceId, domain: reference.domain, enabled: true, isDefault: reference.domain === CapabilityDomain.Delivery }, target)
      }
      // 未登记时第一条 Development 引用成为锚点（primary），其余是 alias。
      const anchorFirst = [...created.filter(({ reference }) => reference.domain === CapabilityDomain.Development), ...created.filter(({ reference }) => reference.domain !== CapabilityDomain.Development)]
      await registerRepository(tx, defaultIdFactory, workspaceId, repositoryId, anchorFirst.map(({ id }) => id))
      return { repositoryId, bindingIds }
    }),
  }
}
