/** 连接账号与工作区配置的契约（#126）：账号身份、品牌化句柄、配置规则与两个适配器共用的纯解析器。唯一校验点；策略由受信组合根提供、构造时复制副本；错误一律 `RangeError` 且不回显输入。 */
import type { ConnectorAccountId, ProviderBindingId, WorkspaceId } from '@harness-projects/domain'

export type SecretHandle = string & { readonly __brand: 'SecretHandle' }
export const ConnectorIdentityKind = { Account: 'account', Installation: 'installation' } as const
export type ConnectorIdentityKind = (typeof ConnectorIdentityKind)[keyof typeof ConnectorIdentityKind]
export const ConnectorConnectionState = { Connected: 'connected', Disconnected: 'disconnected', ReauthRequired: 'reauth_required' } as const
export type ConnectorConnectionState = (typeof ConnectorConnectionState)[keyof typeof ConnectorConnectionState]

export interface ConnectorAccountIdentity {
  readonly platformFamily: string
  /** 规范 HTTPS origin：无 userinfo / 路径 / query / fragment，主机小写，默认端口归一；显式区分平台实例。 */
  readonly platformOrigin: string
  readonly identityKind: ConnectorIdentityKind
  readonly externalId: string
}
export interface ConnectorAccountRecord extends ConnectorAccountIdentity {
  readonly id: ConnectorAccountId
  readonly displayName: string
  /** `undefined` 表示无认证账号；有值时必须是受信 allowlist 的精确成员。 */
  readonly secretHandle: SecretHandle | undefined
  /** `connected` 只是观察状态：不承诺句柄可 resolve，也不承诺 Provider 权限仍有效。 */
  readonly connectionState: ConnectorConnectionState
}
export interface BindingConfigurationRecord {
  readonly ref: { readonly workspaceId: WorkspaceId; readonly bindingId: ProviderBindingId; readonly domain: string }
  readonly configuration: Readonly<Record<string, string | boolean>>
}
/** 配置规则三选一，全部由受信组合根提供，非任意回调。 */
export type BindingConfigurationRule =
  | { readonly kind: 'string'; readonly required: boolean; readonly pattern: string; readonly maxLength: number }
  | { readonly kind: 'enum'; readonly required: boolean; readonly values: readonly string[] }
  | { readonly kind: 'boolean'; readonly required: boolean }
export type BindingConfigurationSchema = Readonly<Record<string, BindingConfigurationRule>>
export interface StorageValidationPolicy {
  readonly allowedSecretHandles: ReadonlySet<string>
  /** 连接实现键 → 配置字段规则；配置读写只按**真实锚点**的 implementationKey 分派。 */
  readonly configurations: ReadonlyMap<string, BindingConfigurationSchema>
}
/** 空策略：每访存返回新空集合，且属性描述符冻结（getter 不可被 `defineProperty` 重定义）——对抗验证 P1-2 / P2-R3。 */
export const EMPTY_POLICY: StorageValidationPolicy = Object.freeze({ get allowedSecretHandles(): Set<string> { return new Set() }, get configurations(): Map<string, BindingConfigurationSchema> { return new Map() } })

const DEVICE_HANDLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ACCOUNT_FIELDS = ['id', 'platformFamily', 'platformOrigin', 'identityKind', 'externalId', 'displayName', 'secretHandle', 'connectionState'] as const
const RECORD_FIELDS = ['ref', 'configuration'] as const
const REF_FIELDS = ['workspaceId', 'bindingId', 'domain'] as const
const IDENTITY_KINDS: readonly unknown[] = Object.values(ConnectorIdentityKind)
const CONNECTION_STATES: readonly unknown[] = Object.values(ConnectorConnectionState)

function reject(message: string): never { throw new RangeError(message) }
/** 本模块产出过的快照：幂等判据（P3-R3）。用 WeakSet 而非 `Object.isFrozen`——调用方自冻的外壳仍可能含可变嵌套规则。 */
const POLICY_SNAPSHOTS = new WeakSet<StorageValidationPolicy>()
/** 策略快照：Set / Map 换新，每条规则与 enum 的 `values` 也换冻结副本（浅拷会让构造后的 `values.push('EVIL')` 经共享引用扩权，P1-1）。每个属性只读一次（P3-R3），已快照对象直接返回。 */
export function snapshotPolicy(policy: StorageValidationPolicy): StorageValidationPolicy {
  if (policy !== null && typeof policy === 'object' && POLICY_SNAPSHOTS.has(policy)) return policy
  const handles: unknown = policy?.allowedSecretHandles
  const schemas: unknown = policy?.configurations
  if (!(handles instanceof Set) || !(schemas instanceof Map)) reject('storage validation policy must provide an allowedSecretHandles Set and a configurations Map')
  const copied = new Map<string, BindingConfigurationSchema>()
  for (const [key, schema] of schemas as Map<string, BindingConfigurationSchema>) {
    if (typeof key !== 'string' || key.trim() === '' || schema === null || typeof schema !== 'object') reject('configuration schema key must be a non-empty string')
    const fields: Record<string, BindingConfigurationRule> = {}
    for (const [name, rule] of Object.entries(schema)) fields[name] = copyRule(rule)
    copied.set(key, Object.freeze(fields))
  }
  const snapshot = Object.freeze({ allowedSecretHandles: new Set(handles as Set<string>), configurations: copied })
  POLICY_SNAPSHOTS.add(snapshot)
  return snapshot
}
/** 规则副本：三种 kind 各自深拷（enum 的 `values` 必换新数组）；未知外形在写入之前拒绝。 */
function copyRule(rule: unknown): BindingConfigurationRule {
  const candidate = rule as BindingConfigurationRule
  if (rule !== null && typeof rule === 'object') {
    if (candidate.kind === 'enum' && typeof candidate.required === 'boolean' && Array.isArray(candidate.values)) {
      return Object.freeze({ kind: 'enum', required: candidate.required, values: Object.freeze(candidate.values.map((value) => assertText(value, 'binding configuration enum value must be a non-empty string'))) })
    }
    if (candidate.kind === 'string' && typeof candidate.required === 'boolean' && typeof candidate.pattern === 'string' && Number.isInteger(candidate.maxLength) && candidate.maxLength >= 0) {
      // 坏正则/负长度必须在构造点以 `RangeError` 失败，而不是等首次写入才抛 `SyntaxError`（对抗验证 P3-R2）。
      try { new RegExp(`^(?:${candidate.pattern})$`) } catch { reject('binding configuration schema rule pattern must be a valid regular expression') }
      return Object.freeze({ kind: 'string', required: candidate.required, pattern: candidate.pattern, maxLength: candidate.maxLength })
    }
    if (candidate.kind === 'boolean' && typeof candidate.required === 'boolean') return Object.freeze({ kind: 'boolean', required: candidate.required })
  }
  return reject('binding configuration schema rule is not a declared kind')
}
const assertClosedFields = (value: object, allowed: readonly string[], message: string): void => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) reject(message)
}
function assertPlainObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(message)
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) reject(message)
  return value as Record<string, unknown>
}
function assertText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') reject(message)
  return value
}
/** `new URL` 归一后的 origin 必须与输入逐字相同（拒绝大写主机、路径、userinfo、默认端口写法）。 */
function canonicalOrigin(value: unknown): string {
  const raw = assertText(value, 'connector account platform origin must be a non-empty string')
  let origin: string
  try { origin = new URL(raw).origin } catch { reject('connector account platform origin must be a canonical https origin') }
  if (!origin.startsWith('https://') || origin !== raw) reject('connector account platform origin must be a canonical https origin')
  return origin
}

/** 账号闭集解析，返回独立副本。同 id 换自然键、同自然键换 id 由适配器判定（需读既有行）。 */
export function parseConnectorAccount(value: unknown, policy: StorageValidationPolicy): ConnectorAccountRecord {
  const record = assertPlainObject(value, 'connector account must be a plain object')
  assertClosedFields(record, ACCOUNT_FIELDS, 'connector account contains an unknown field')
  const id = assertText(record.id, 'connector account id must be a non-empty string') as ConnectorAccountId
  const platformFamily = assertText(record.platformFamily, 'connector account platform family must be a non-empty string')
  const platformOrigin = canonicalOrigin(record.platformOrigin)
  if (!IDENTITY_KINDS.includes(record.identityKind)) reject('connector account identity kind is not a known value')
  const externalId = assertText(record.externalId, 'connector account external id must be a non-empty string')
  if (typeof record.displayName !== 'string') reject('connector account display name must be a string')
  if (!CONNECTION_STATES.includes(record.connectionState)) reject('connector account connection state is not a known value')
  let secretHandle: SecretHandle | undefined
  if (record.secretHandle !== undefined) {
    if (typeof record.secretHandle !== 'string' || !DEVICE_HANDLE.test(record.secretHandle) || !policy.allowedSecretHandles.has(record.secretHandle)) reject('connector account secret handle is not an allowed handle')
    secretHandle = record.secretHandle as SecretHandle
  }
  return { id, platformFamily, platformOrigin, identityKind: record.identityKind as ConnectorIdentityKind, externalId,
    displayName: record.displayName, secretHandle, connectionState: record.connectionState as ConnectorConnectionState }
}

/** 配置 `ref` 闭集解析：畸形 `ref` 在任何解引用之前以 `RangeError` 拒绝。 */
export function parseBindingRef(value: unknown): BindingConfigurationRecord['ref'] {
  const ref = assertPlainObject(value, 'binding configuration ref must be a plain object')
  assertClosedFields(ref, REF_FIELDS, 'binding configuration ref contains an unknown field')
  return {
    workspaceId: assertText(ref.workspaceId, 'binding configuration workspace id must be a non-empty string') as WorkspaceId,
    bindingId: assertText(ref.bindingId, 'binding configuration binding id must be a non-empty string') as ProviderBindingId,
    domain: assertText(ref.domain, 'binding configuration domain must be a non-empty string'),
  }
}
/** 定位阶段：先校验 record / ref 外形，返回 `ref` 让适配器查**真实锚点**的 implementationKey（不接收调用者声称的键）。 */
export function bindingRefOf(value: unknown): BindingConfigurationRecord['ref'] {
  const record = assertPlainObject(value, 'binding configuration record must be a plain object')
  assertClosedFields(record, RECORD_FIELDS, 'binding configuration record contains an unknown field')
  return parseBindingRef(record.ref)
}

/** 配置闭集解析：未知字段、原型对象、数组、嵌套对象、undefined 与符号一律拒绝，返回独立副本。 */
export function parseBindingConfiguration(value: unknown, policy: StorageValidationPolicy, implementationKey: string): BindingConfigurationRecord {
  const record = assertPlainObject(value, 'binding configuration record must be a plain object')
  assertClosedFields(record, RECORD_FIELDS, 'binding configuration record contains an unknown field')
  const ref = parseBindingRef(record.ref)
  const schema = policy.configurations.get(implementationKey)
  if (schema === undefined) reject('binding configuration is not declared for this implementation key')
  const configuration = assertPlainObject(record.configuration, 'binding configuration must be a plain object')
  for (const name of Object.keys(configuration)) if (configuration[name] === undefined) reject('binding configuration must not contain an undefined value')
  for (const name of Object.keys(configuration)) if (!Object.hasOwn(schema, name)) reject('binding configuration field is not declared')
  const copied: Record<string, string | boolean> = {}
  for (const [name, rule] of Object.entries(schema)) {
    const raw = configuration[name]
    if (raw === undefined) { if (rule.required) reject('binding configuration is missing a required field'); continue }
    if (rule.kind === 'boolean') { if (typeof raw !== 'boolean') reject('binding configuration boolean field must be a boolean') } else if (rule.kind === 'enum') {
      if (typeof raw !== 'string' || !rule.values.includes(raw)) reject('binding configuration enum field is not one of the declared values')
    } else {
      if (typeof raw !== 'string') reject('binding configuration string field must be a string')
      if (raw.length > rule.maxLength) reject('binding configuration string field exceeds the declared max length')
      if (!new RegExp(`^(?:${rule.pattern})$`).test(raw)) reject('binding configuration string field does not match the declared pattern')
    }
    copied[name] = raw as string | boolean
  }
  return { ref, configuration: copied }
}
