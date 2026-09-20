/** 结构化错误模型（ExecPlan D2）：provider 层 8 个码把平台失败翻译成结构化结果、不用异常做控制流；调用方层 11 个码 + retryable + recovery + 已确认值/尝试值；恢复动作 7 个取值，每个调用方码都必须映射到其中之一（没有建议也要显式写 none）。 */

/** provider 层错误码：8 个。 */
export const ProviderErrorCode = {
  NotSupported: 'not_supported', PermissionDenied: 'permission_denied', NotFound: 'not_found',
  Conflict: 'conflict', RateLimited: 'rate_limited', Unavailable: 'unavailable',
  InvalidInput: 'invalid_input', AmbiguousResult: 'ambiguous_result',
} as const
export type ProviderErrorCode = (typeof ProviderErrorCode)[keyof typeof ProviderErrorCode]

/** 调用方层错误码：8 个 provider 码的同名超集 + 3 个只有调用方才知道的码。 */
export const ProjectErrorCode = {
  ...ProviderErrorCode,
  ResultUnknown: 'result_unknown', StaleRevision: 'stale_revision', Offline: 'offline',
} as const
export type ProjectErrorCode = (typeof ProjectErrorCode)[keyof typeof ProjectErrorCode]

/** 恢复动作：调用方能提供的最小可选动作集合。 */
export const Recovery = {
  Retry: 'retry', Refresh: 'refresh', Reapply: 'reapply', OpenProvider: 'open_provider',
  FixPermission: 'fix_permission', ManualExecution: 'manual_execution', None: 'none',
} as const
export type Recovery = (typeof Recovery)[keyof typeof Recovery]

/** provider 码 → 调用方码。8 个码目前同名同值，仍显式写出，避免静默改名。 */
export const PROVIDER_TO_PROJECT: Readonly<Record<ProviderErrorCode, ProjectErrorCode>> = {
  [ProviderErrorCode.NotSupported]: ProviderErrorCode.NotSupported,
  [ProviderErrorCode.PermissionDenied]: ProviderErrorCode.PermissionDenied,
  [ProviderErrorCode.NotFound]: ProviderErrorCode.NotFound,
  [ProviderErrorCode.Conflict]: ProviderErrorCode.Conflict,
  [ProviderErrorCode.RateLimited]: ProviderErrorCode.RateLimited,
  [ProviderErrorCode.Unavailable]: ProviderErrorCode.Unavailable,
  [ProviderErrorCode.InvalidInput]: ProviderErrorCode.InvalidInput,
  [ProviderErrorCode.AmbiguousResult]: ProviderErrorCode.AmbiguousResult,
}
export function providerErrorToProjectError(code: ProviderErrorCode): ProjectErrorCode {
  return PROVIDER_TO_PROJECT[code]
}
/** 每个调用方码的默认恢复动作：retry = 原样重发；refresh = 先重读权威值；reapply = 以新 revision 重放；open_provider = 人去平台确认；fix_permission = 补授权；manual_execution = 转人工；none = 输入不合法。 */
export const RECOVERY_BY_CODE: Readonly<Record<ProjectErrorCode, Recovery>> = {
  [ProjectErrorCode.NotSupported]: Recovery.ManualExecution,
  [ProjectErrorCode.PermissionDenied]: Recovery.FixPermission,
  [ProjectErrorCode.NotFound]: Recovery.OpenProvider,
  [ProjectErrorCode.Conflict]: Recovery.Reapply,
  [ProjectErrorCode.RateLimited]: Recovery.Retry,
  [ProjectErrorCode.Unavailable]: Recovery.Retry,
  [ProjectErrorCode.InvalidInput]: Recovery.None,
  [ProjectErrorCode.AmbiguousResult]: Recovery.Refresh,
  [ProjectErrorCode.ResultUnknown]: Recovery.Refresh,
  [ProjectErrorCode.StaleRevision]: Recovery.Reapply,
  [ProjectErrorCode.Offline]: Recovery.Retry,
}
/** retryable：不改变输入即可安全重发同一请求（只有 retry 类恢复动作满足）。 */
export function isRetryable(code: ProjectErrorCode): boolean {
  return RECOVERY_BY_CODE[code] === Recovery.Retry
}
/** 调用方可见的错误值：确定性优先于猜测——没有确认值时必须显式为 undefined。 */
export interface ProjectError {
  readonly code: ProjectErrorCode
  readonly message: string
  readonly recovery: Recovery
  readonly retryable: boolean
  readonly confirmedValue: string | undefined
  readonly attemptedValue: string | undefined
}
export function projectError(code: ProjectErrorCode, message: string, values: { readonly confirmedValue?: string; readonly attemptedValue?: string } = {}): ProjectError {
  return {
    code,
    message,
    recovery: RECOVERY_BY_CODE[code],
    retryable: isRetryable(code),
    confirmedValue: values.confirmedValue,
    attemptedValue: values.attemptedValue,
  }
}
