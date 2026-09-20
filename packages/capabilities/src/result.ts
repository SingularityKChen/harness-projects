/**
 * provider 层结果与错误模型。
 *
 * Provider 把平台失败翻译成结构化结果，不用异常做控制流（ExecPlan D2）。8 个 provider 错误码、
 * 11 个调用方错误码、7 个恢复动作与 retryable 判定全部复用 `@harness-projects/domain` 的 errors.ts，
 * 本文件只补齐 provider 特有的结果封装与语义查询，不新增第二份错误码真源。
 */
import {
  ProjectErrorCode,
  ProviderErrorCode,
  RECOVERY_BY_CODE,
  isRetryable,
  providerErrorToProjectError,
  type Recovery,
} from '@harness-projects/domain'

/** 只依赖 capabilities 的调用方也必须能并列显示“最后已知权威值 vs 本次尝试值”，无需再 import domain。 */
export { ProjectErrorCode, projectError, type ProjectError, type Recovery } from '@harness-projects/domain'

/** 闭集：恰好 8 个 provider 错误码；由 tests/contract/capabilities-errors.test.js 逐字钉死。 */
export const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = Object.values(ProviderErrorCode)

/** 调用方码里**不可**由 provider 码到达的 3 个：它们描述宿主侧写入与连接状态，provider 观察不到。 */
export const PROJECT_CODES_NOT_FROM_PROVIDER: readonly ProjectErrorCode[] = [
  ProjectErrorCode.ResultUnknown,
  ProjectErrorCode.StaleRevision,
  ProjectErrorCode.Offline,
]

export interface ProviderError {
  readonly code: ProviderErrorCode; readonly message: string; readonly retryable: boolean
  readonly requestId: string | undefined; readonly retryAfterMs: number | undefined; readonly rawClass: string | undefined
}

export interface ProviderErrorSemantics {
  readonly code: ProviderErrorCode; readonly retryable: boolean; readonly recovery: Recovery; readonly description: string
}

const DESCRIPTIONS: Readonly<Record<ProviderErrorCode, string>> = {
  [ProviderErrorCode.NotSupported]: '该能力未实现或未声明，调用方必须走降级路径',
  [ProviderErrorCode.PermissionDenied]: '当前凭据没有权限，需要人补授权或换凭据',
  [ProviderErrorCode.NotFound]: '目标对象不存在，或对当前凭据不可见',
  [ProviderErrorCode.Conflict]: '远端已被其他 actor 改动，需重新读取后重放',
  [ProviderErrorCode.RateLimited]: '触发平台限流，退避后可原样重发',
  [ProviderErrorCode.Unavailable]: '平台或网络暂时不可用，可原样重发',
  [ProviderErrorCode.InvalidInput]: '输入不合法，原样重发没有意义',
  [ProviderErrorCode.AmbiguousResult]: '写入结果不确定，必须先 reconcile 再决定是否重试',
}

/** 每个 provider 码都必须能回答“能不能原样重发”和“调用方能提供哪种恢复动作”。 */
export function providerErrorSemantics(code: ProviderErrorCode): ProviderErrorSemantics {
  const project = providerErrorToProjectError(code)
  return {
    code,
    retryable: isRetryable(project),
    recovery: RECOVERY_BY_CODE[project],
    description: DESCRIPTIONS[code],
  }
}

/** provider 码 → 调用方码；映射表在 domain，本函数只是 provider 作者可用的稳定入口。 */
export function projectCodeForProviderError(code: ProviderErrorCode): ProjectErrorCode {
  return providerErrorToProjectError(code)
}

export interface ProviderErrorOptions {
  readonly requestId?: string; readonly retryAfterMs?: number; readonly rawClass?: string
}

export function providerError(code: ProviderErrorCode, message: string, options: ProviderErrorOptions = {}): ProviderError {
  return {
    code,
    message,
    retryable: providerErrorSemantics(code).retryable,
    requestId: options.requestId,
    retryAfterMs: options.retryAfterMs,
    rawClass: options.rawClass,
  }
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T; readonly requestId: string | undefined }
  | { readonly ok: false; readonly error: ProviderError; readonly requestId: string | undefined }

export function providerOk<T>(value: T, requestId?: string): ProviderResult<T> {
  return { ok: true, value, requestId }
}

export function providerErr<T = never>(error: ProviderError, requestId?: string): ProviderResult<T> {
  return { ok: false, error, requestId }
}

export function isProviderOk<T>(result: ProviderResult<T>): result is Extract<ProviderResult<T>, { ok: true }> {
  return result.ok
}

export function isProviderErr<T>(result: ProviderResult<T>): result is Extract<ProviderResult<T>, { ok: false }> {
  return !result.ok
}

/** 游标分页：nextCursor 为 undefined 表示没有下一页；调用方不得解析游标结构。 */
export interface ProviderPage<T> { readonly items: readonly T[]; readonly nextCursor: string | undefined }
