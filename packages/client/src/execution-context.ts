/** 按需读取 Host 的最后执行记录；React-free，不建立第二份事实缓存。 */
import { ExecutionContextStatus, ExecutionRunStatus } from '@harness-projects/domain/values'

export interface ExecutionContextScope {
  readonly workspaceId: string
  readonly workItemId: string
  readonly repositoryId: string
}
export interface ExecutionContextDTO extends ExecutionContextScope {
  readonly status: ExecutionContextStatus
  readonly branchExternalId?: string
  readonly worktreeExternalId?: string
  readonly runConfirmedAt?: string
  readonly runStale?: boolean
  readonly runStatus?: ExecutionRunStatus
  readonly fallback?: 'manual_fallback'
}
export type ExecutionContextReader = ((scope: ExecutionContextScope) => Promise<ExecutionContextDTO | null>) & { readonly refresh?: (scope: ExecutionContextScope) => Promise<void> }
const INVALID = '执行上下文响应不合契约'
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError(INVALID)
  return value as Record<string, unknown>
}
/** 调用方先解包 RemoteResult；这里只接受精确 nullable wire，与请求的三个 scope 键逐项对照。 */
export function createExecutionContextReader(call: (scope: ExecutionContextScope) => Promise<unknown>, refresh?: (scope: ExecutionContextScope) => Promise<void>): ExecutionContextReader {
  const reader: ExecutionContextReader = async (scope) => {
    const response = record(await call(scope), ['context'])
    if (response.context === null) return null
    const dto = record(response.context, ['workspaceId', 'workItemId', 'repositoryId', 'status', 'branchExternalId', 'worktreeExternalId', 'runStatus', 'runConfirmedAt', 'runStale', 'fallback'])
    for (const key of ['workspaceId', 'workItemId', 'repositoryId'] as const) {
      if (typeof dto[key] !== 'string' || dto[key] === '' || dto[key] !== scope[key]) throw new TypeError(INVALID)
    }
    if (!Object.values(ExecutionContextStatus).includes(dto.status as ExecutionContextStatus)
      || (dto.runStatus !== undefined && !Object.values(ExecutionRunStatus).includes(dto.runStatus as ExecutionRunStatus))
      || (dto.runStale !== undefined && typeof dto.runStale !== 'boolean')
      || (dto.runConfirmedAt !== undefined && (typeof dto.runConfirmedAt !== 'string' || !Number.isFinite(Date.parse(dto.runConfirmedAt))))) throw new TypeError(INVALID)
    if ((dto.fallback !== undefined && dto.fallback !== 'manual_fallback')
      || ['branchExternalId', 'worktreeExternalId'].some((key) => dto[key] !== undefined && typeof dto[key] !== 'string')) throw new TypeError(INVALID)
    return dto as unknown as ExecutionContextDTO
  }
  return Object.assign(reader, refresh === undefined ? {} : { refresh })
}
