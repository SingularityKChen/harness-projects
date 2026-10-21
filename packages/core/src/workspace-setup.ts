/**
 * 工作区设置命令（#127）：创建工作区、连接账号、把规划来源挂到工作区。三条都是 create-or-verify：在**一个** Storage 事务里
 * 读自然键 → 判定 → 写——相同即零写入、返回由行算出的 id；不同即结构化拒绝（事务回滚）；缺席才写。只写本地事实、不调用 provider，
 * 写出的正是 Host 恢复时读取的行集（工作区、启用的规划挂载、挂载配置、锚点→账号关联、账号句柄）。幂等不靠持久回执：每个目标都有
 * 存储强制的自然键，已提交的行就是结果（ExecPlan D2）。模式辅助函数供 core 内后续的设置命令（#353）以相对路径复用，不进包入口。
 */
import { isDeepStrictEqual } from 'node:util'
import {
  CapabilityDomain, ConnectorConnectionState, ProjectErrorCode, projectError,
  type ConnectorAccountIdentity, type ProjectError, type ProviderBindingRecord, type SecretHandle, type Storage, type StorageTransaction,
} from '@harness-projects/capabilities'
import {
  StatusPolicy, newConnectorAccountId, newProviderBindingId,
  type ConnectorAccountId, type ProviderBindingId, type WorkspaceId,
} from '@harness-projects/domain'

export type SetupOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProjectError }
export interface CreateWorkspaceRequest { readonly workspaceId: WorkspaceId; readonly name: string; readonly statusPolicy: StatusPolicy }
export interface ConnectAccountRequest extends ConnectorAccountIdentity { readonly displayName: string; readonly secretHandle: string }
export interface BindPlanningSourceRequest {
  readonly workspaceId: WorkspaceId; readonly accountId: ConnectorAccountId
  readonly implementationKey: string; readonly configuration: Readonly<Record<string, string | boolean>>
}
export interface WorkspaceSetup {
  createWorkspace(request: CreateWorkspaceRequest): Promise<SetupOutcome<{ readonly workspaceId: WorkspaceId }>>
  connectAccount(request: ConnectAccountRequest): Promise<SetupOutcome<{ readonly accountId: ConnectorAccountId }>>
  /** 工作区同一时刻只有一个启用的规划来源（不变量 1）：目标不同即 conflict；只剩停用挂载时是 #202 的切换，not_supported。 */
  bindPlanningSource(request: BindPlanningSourceRequest): Promise<SetupOutcome<{ readonly bindingId: ProviderBindingId }>>
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
const STATUS_POLICIES: readonly unknown[] = Object.values(StatusPolicy)
const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() !== ''
const plainObject = (value: unknown): boolean => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))

export function createWorkspaceSetup(storage: Storage): WorkspaceSetup {
  return {
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
  }
}
