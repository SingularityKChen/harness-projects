import type { ProjectError } from '@harness-projects/domain'
export type ConnectionFailure = { readonly cause: 'credential_rejected' | 'permission_missing' | 'target_unavailable' }
/** 仅设置失败 envelope 可携带，原文永远不是判别输入。 */
export function parseConnectionFailure(dto: Record<string, unknown>, error: ProjectError | undefined): ConnectionFailure | undefined {
  if (dto.connectionFailure === undefined) return undefined
  const value = dto.connectionFailure
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 1 || !Object.hasOwn(value, 'cause')) throw new TypeError('连接失败不合契约')
  const cause = (value as Record<string, unknown>).cause
  if (dto.writeState !== 'failed' || dto.activationError !== undefined || !error || error.retryable || (cause === 'target_unavailable'
    ? error.code !== 'not_found' || error.recovery !== 'open_provider'
    : (cause !== 'credential_rejected' && cause !== 'permission_missing') || error.code !== 'permission_denied' || error.recovery !== 'fix_permission')) throw new TypeError('连接失败组合不合契约')
  return Object.freeze({ cause }) as ConnectionFailure
}
