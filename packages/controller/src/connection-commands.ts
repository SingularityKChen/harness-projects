import type { ConnectAccountRequest } from '@harness-projects/core'
import { projectError, type ConnectorAccountId, type ProviderBindingId, type ProjectErrorCode } from '@harness-projects/domain'
import { CommandWriteState, type BindPlanningSourceInput, type CommandEnvelope, type CommandResult, type SetupCommands } from './commands.ts'
export type ConnectionFailure = { readonly cause: 'credential_rejected' | 'permission_missing' | 'target_unavailable' }
export type ConnectionCheck<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: ProjectErrorCode; readonly cause?: ConnectionFailure['cause'] }
type ConnectionResult<T> = CommandResult<T> & { readonly connectionFailure?: ConnectionFailure }
/** 显式设置命令的只读授权边界：检查拒绝时不进入 Core 设置写口，远端原文不成为合同。 */
export function createConnectionCommands(setup: SetupCommands, ports: {
  resolveAccount(): Promise<ConnectionCheck<ConnectAccountRequest>>
  verifyProject(input: BindPlanningSourceInput): Promise<ConnectionCheck<void>>
}) {
  const refused = <T>(check: Extract<ConnectionCheck<unknown>, { ok: false }>): ConnectionResult<T> => {
    const compatible = check.cause === 'target_unavailable' ? check.code === 'not_found'
      : (check.cause === 'credential_rejected' || check.cause === 'permission_missing') && check.code === 'permission_denied'
    return { writeState: CommandWriteState.Failed, saving: false, authoritative: false, value: undefined,
      error: projectError(check.code, '暂时无法完成工作区设置。'), ...(compatible ? { connectionFailure: { cause: check.cause! } } : {}) }
  }
  return {
    async connectAccount(input: CommandEnvelope): Promise<ConnectionResult<{ readonly accountId: ConnectorAccountId }>> {
      const check = await ports.resolveAccount()
      return check.ok ? setup.connectAccount({ ...input, ...check.value }) : refused(check)
    },
    async bindPlanningSource(input: BindPlanningSourceInput): Promise<ConnectionResult<{ readonly bindingId: ProviderBindingId }>> {
      const check = await ports.verifyProject(input)
      return check.ok ? setup.bindPlanningSource(input) : refused(check)
    },
  }
}
