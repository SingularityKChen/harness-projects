/**
 *
 * 被拒绝，缺能力一律是结构化不可用。
 */
import {
  AccessLevel, projectCodeForProviderError,
  type CapabilityKey, type ProviderError, type ProviderRegistry, type ResolvedBinding,
} from '@harness-projects/capabilities'
import { ProjectErrorCode, projectError, type ProjectError } from '@harness-projects/domain'
import { resolveBinding, resolveCapability, type CapabilityResolution } from './registry.ts'

export type CommandMode = 'read' | 'write'

/** 命令门结论：allowed 为 false 时 error 必须能回答"为什么"和"怎么恢复"；允许态带同一次解析命中的完整挂载，调用方不得再按 id 重找。 */
export interface CommandGate {
  readonly allowed: boolean
  readonly access: AccessLevel
  readonly degraded: boolean
  readonly binding: ResolvedBinding | undefined
  readonly error: ProjectError | undefined
}

/** 有效访问级别：能力 ∩ 权限 ∩ 策略之后调用方真正拿得到的级别。 */
export function effectiveAccess(registry: ProviderRegistry, key: CapabilityKey): AccessLevel {
  const resolution = resolveCapability(registry, key)
  return resolution.available ? resolution.access : AccessLevel.Unavailable
}

/** 命令入口的拒绝检查：拒绝是结构化结果，不是异常；写命令不得在 read_only 下静默成功。 */
export function gateCommand(registry: ProviderRegistry, key: CapabilityKey, mode: CommandMode): CommandGate {
  return gateOn(resolveCapability(registry, key), key, mode)
}

/** 在一个已选定（例如按仓库路由到）的挂载上过门：一次操作只路由一次，其余 key 都在同一个挂载上判定。 */
export function gateBinding(binding: ResolvedBinding | undefined, key: CapabilityKey, mode: CommandMode): CommandGate {
  return gateOn(resolveBinding(binding, key), key, mode)
}

function gateOn(resolution: CapabilityResolution, key: CapabilityKey, mode: CommandMode): CommandGate {
  if (!resolution.available) return denied(AccessLevel.Unavailable, resolution.error)
  if (mode === 'write' && resolution.access === AccessLevel.ReadOnly) {
    return denied(resolution.access, projectError(ProjectErrorCode.PermissionDenied, `能力 ${key} 当前只读，写命令被拒绝`))
  }
  return {
    allowed: true, access: resolution.access, degraded: resolution.access === AccessLevel.Degraded,
    binding: resolution.binding, error: undefined,
  }
}

function denied(access: AccessLevel, error: ProjectError): CommandGate {
  return { allowed: false, access, degraded: false, binding: undefined, error }
}

/** 缺能力/缺绑定的统一结构化拒绝；调用方据此走降级而不是抛错。 */
export function unsupportedCapability(key: CapabilityKey): ProjectError {
  return projectError(ProjectErrorCode.NotSupported, `能力 ${key} 不可用`)
}

/** provider 结构化错误 → 调用方错误，保留错误码规定的恢复动作与 retryable 判定。 */
export function toProjectError(error: ProviderError): ProjectError {
  return projectError(projectCodeForProviderError(error.code), error.message)
}

/** 写命令的目标绑定：门拒绝或绑定缺失时 binding 为 undefined，error 一定可回答"为什么失败"。 */
export interface WriteTarget {
  readonly binding: ResolvedBinding | undefined
  readonly error: ProjectError | undefined
}

export function resolveWriteTarget(registry: ProviderRegistry, key: CapabilityKey): WriteTarget {
  const gate = gateCommand(registry, key, 'write')
  return gate.allowed ? { binding: gate.binding, error: undefined } : { binding: undefined, error: gate.error ?? unsupportedCapability(key) }
}
