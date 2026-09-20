/**
 * @harness-projects/controller —— 对外类型化 API 与增量流
 *
 * Responsibility: 对外类型化 Query / Command API、Host 与客户端模型之间的命令与增量流、权限边界；不复制业务规则。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities、@harness-projects/core
 */
import { StatusPolicyMode, type CoreApi } from '@harness-projects/core'
import { createControllerCommands, type ControllerCommands } from './commands.ts'
import { createControllerQueries, type ControllerQueries } from './queries.ts'
import { authorityFor, type WireAuthority, type WireSnapshot } from './wire.ts'
import { watchWorkspace, type WatchOptions, type WorkspaceWatch } from './watch.ts'

export const packageId = '@harness-projects/controller' as const
export * from './wire.ts'
export * from './queries.ts'
export * from './commands.ts'
export * from './watch.ts'

export interface ControllerOptions {
  /** 工作区的状态策略；wire 层的权威归属由它决定（source_managed / harness_managed / manual）。 */
  readonly authority?: StatusPolicyMode
}

export interface Controller {
  readonly authority: WireAuthority
  readonly queries: ControllerQueries
  readonly commands: ControllerCommands
  /** 当前修订上的完整投影，作为订阅起点。 */
  baseline(): Promise<WireSnapshot>
  watch(options: WatchOptions): WorkspaceWatch
}

export function createController(core: CoreApi, options: ControllerOptions = {}): Controller {
  const authority = authorityFor(options.authority ?? StatusPolicyMode.SourceManaged)
  const queries = createControllerQueries(core, authority)
  return {
    authority,
    queries,
    commands: createControllerCommands(core),
    baseline: () => queries.snapshot(),
    watch: (options) => watchWorkspace({ baseline: () => queries.snapshot() }, options),
  }
}
