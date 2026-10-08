/**
 * 宿主诊断出口的调用点（TD-030）：同步一轮把不能进命令结果或 wire 的失败原因交给 `CoreDeps.diagnostics`。
 * 内部模块，不经包入口导出：宿主只看到 `context.ts` 里的 `CoreDiagnostics` 契约。
 */
import type { CoreContext } from './context.ts'

/**
 * 把一个原异常交给 `diagnostics.syncRoundFailed`。出口只服务排障，不是同步的一部分，所以：
 * - 不等待它：慢日志或永不 resolve 的钩子不能拖住一轮同步，返回值只用来接住拒绝；
 * - 钩子同步抛出、返回的任何 thenable 拒绝（含另一个 realm 的 promise：`instanceof Promise` 认不出它，拒绝没人接就是进程级未处理拒绝）、
 *   读取 `then` 时同步抛出，全部吞掉：调用方（`bootstrapWorkspace` 的整轮 catch、`composeCore` 的水合 catch）的结果不因它改变。
 */
export function reportSyncRoundFailure(context: CoreContext, error: unknown): void {
  try {
    const pending: unknown = context.diagnostics?.syncRoundFailed?.(error)
    // 用 Promise 构造器吸收：读取 `then`、调用 `then` 的同步抛出都变成这个 promise 的拒绝，而不是从这里漏出去。
    if (pending !== undefined) new Promise((resolve) => { resolve(pending) }).catch(() => undefined)
  } catch {
    // 诊断出口自己的失败不得盖过本轮的结构化失败。
  }
}
