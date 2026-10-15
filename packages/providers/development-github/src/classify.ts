/**
 * 失败分类（ExecPlan 分类表，自上而下，命中即止）：判定顺序与固定文案同 planning-github-projects 的分类器（provider 之间不得互相 import，
 * 所以各存一份，分歧记在 TD-061）；多出 `requestId` 与 `retryAfterMs` 的形状校验。消息是固定文案，`rawClass` 只由整数状态码或匹配
 * `^[A-Z_]{1,40}$` 的 type 拼成；响应正文、请求头与异常文本只用来判定，不进入错误。二级限流以 403 或 200 加 errors 返回，只能看 message。
 */
import { providerError, type ProviderError } from '@harness-projects/capabilities'
import { ProviderErrorCode } from '@harness-projects/domain'
import { isRecord } from './decode.ts'
import type { GraphqlResponse } from './transport.ts'

const { RateLimited, PermissionDenied, NotFound, Unavailable } = ProviderErrorCode
type PlatformCode = typeof RateLimited | typeof PermissionDenied | typeof NotFound | typeof Unavailable
const MESSAGES: Readonly<Record<PlatformCode, string>> = {
  [RateLimited]: 'GitHub 触发限流', [PermissionDenied]: 'GitHub 拒绝了当前凭据的访问',
  [NotFound]: 'GitHub 上找不到目标，或对当前凭据不可见', [Unavailable]: 'GitHub 暂时不可用，或响应形状不符合预期',
}
const DECIMAL = /^\d+$/
/** 与 delivery-github-actions 相同的形状：防止 token 形态的头值进入结果。 */
const REQUEST_ID = /^[0-9A-F]{1,8}(?::[0-9A-F]{1,16}){3,5}$/i
const secondary = (message: unknown): boolean => typeof message === 'string' && /\bsecondary rate\b/i.test(message)

export function failure(code: PlatformCode, requestId: string | undefined, rawClass?: string, retryAfterMs?: number): ProviderError {
  return { ...providerError(code, MESSAGES[code]), requestId, rawClass, retryAfterMs }
}

/** `requestId` 取 `x-github-request-id`，只在形状匹配时保留。 */
export function requestIdOf(headers: Readonly<Record<string, string>>): string | undefined {
  const raw = headers['x-github-request-id']
  return typeof raw === 'string' && REQUEST_ID.test(raw) ? raw : undefined
}

/** `nowMs` 只用来把 reset 时刻换算成相对等待。 */
export function classifyResponse({ status, headers, body }: GraphqlResponse, nowMs: number): ProviderError | undefined {
  const requestId = requestIdOf(headers)
  if (!Number.isInteger(status)) return failure(Unavailable, requestId, 'malformed_response')
  const exhausted = headers['x-ratelimit-remaining'] === '0'
  const [retryAfter = '', reset = ''] = [headers['retry-after'], headers['x-ratelimit-reset']]
  const wait = DECIMAL.test(retryAfter) ? Number(retryAfter) * 1000 : exhausted && DECIMAL.test(reset) ? Math.max(0, Number(reset) * 1000 - nowMs) : undefined
  // 几百位的头值会换算成 Infinity（JSON 里是 null，定时器里是 1 毫秒）：只交出有限的等待，否则不给。
  const rateLimited = (): ProviderError => failure(RateLimited, requestId, undefined, Number.isFinite(wait) ? wait : undefined)
  if (status === 429 || (status === 403 && (headers['retry-after'] !== undefined || exhausted || isRecord(body) && secondary(body.message)))) return rateLimited()
  if (status === 401 || status === 403) return failure(PermissionDenied, requestId)
  if (!(status >= 200 && status <= 299)) return failure(Unavailable, requestId, `http_${status}`)
  if (!isRecord(body)) return failure(Unavailable, requestId, 'malformed_response')
  const { errors } = body
  if (errors === undefined || errors === null || (Array.isArray(errors) && errors.length === 0)) return undefined
  // 以下 errors 非空：不做部分成功，data 里有内容也整次失败。
  const types = Array.isArray(errors) ? errors.map((entry) => (isRecord(entry) ? entry.type : undefined)) : []
  if (exhausted || types.includes('RATE_LIMITED') || (Array.isArray(errors) && errors.some((entry) => isRecord(entry) && secondary(entry.message)))) return rateLimited()
  if (types.includes('FORBIDDEN') || types.includes('INSUFFICIENT_SCOPES')) return failure(PermissionDenied, requestId)
  if (types.includes('NOT_FOUND')) return failure(NotFound, requestId)
  const type = types.find((candidate) => typeof candidate === 'string' && /^[A-Z_]{1,40}$/.test(candidate))
  return failure(Unavailable, requestId, type === undefined ? 'graphql_error' : `graphql_${String(type)}`)
}
