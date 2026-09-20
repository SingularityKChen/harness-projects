/**
 * 核心能力门：有效访问级别与命令入口的拒绝检查（issue #76 / ExecPlan D1）。
 *
 * 有效访问级别 = capability ∩ permission ∩ policy，由 `registerBindings` 用 capabilities 层的
 * `effectiveCapabilities` 算出；本文件只消费结论：read 命令在 read_only 下仍可执行，write 命令必须
 * 被拒绝，缺能力一律是结构化不可用。
 */
import { AccessLevel, type CapabilityKey, type ProviderRegistry } from '@harness-projects/capabilities'
import {
  ProjectErrorCode, projectError, type ProjectError, type ProviderBindingId,
} from '@harness-projects/domain'
import { resolveCapability } from './registry.ts'

export type CommandMode = 'read' | 'write'

/** 命令门结论：allowed 为 false 时 error 必须能回答"为什么"和"怎么恢复"。 */
export interface CommandGate {
  readonly allowed: boolean
  readonly access: AccessLevel
  readonly degraded: boolean
  readonly bindingId: ProviderBindingId | undefined
  readonly error: ProjectError | undefined
}

/** 有效访问级别：能力 ∩ 权限 ∩ 策略之后调用方真正拿得到的级别。 */
export function effectiveAccess(registry: ProviderRegistry, key: CapabilityKey): AccessLevel {
  const resolution = resolveCapability(registry, key)
  return resolution.available ? resolution.access : AccessLevel.Unavailable
}

/** 命令入口的拒绝检查：拒绝是结构化结果，不是异常；写命令不得在 read_only 下静默成功。 */
export function gateCommand(registry: ProviderRegistry, key: CapabilityKey, mode: CommandMode): CommandGate {
  const resolution = resolveCapability(registry, key)
  if (!resolution.available) return denied(AccessLevel.Unavailable, undefined, resolution.error)
  const bindingId = resolution.binding.ref.bindingId
  if (mode === 'write' && resolution.access === AccessLevel.ReadOnly) {
    const error = projectError(ProjectErrorCode.PermissionDenied, `能力 ${key} 当前只读，写命令被拒绝`)
    return denied(resolution.access, bindingId, error)
  }
  return {
    allowed: true, access: resolution.access, degraded: resolution.access === AccessLevel.Degraded,
    bindingId, error: undefined,
  }
}

function denied(
  access: AccessLevel, bindingId: ProviderBindingId | undefined, error: ProjectError,
): CommandGate {
  return { allowed: false, access, degraded: false, bindingId, error }
}
