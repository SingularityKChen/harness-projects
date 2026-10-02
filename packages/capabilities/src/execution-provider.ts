/**
 * Execution 能力域 port（启动、查询、可选取消）。
 *
 * 契约**故意没有 reconcile**——这是本批次的显式决策，不是遗漏：MVP 由 core 轮询 `getRun` 兜底，
 * 因此执行域不承诺观察流；在平台侧出现可用的执行事件源之前，任何调用方都不得假设
 * `ExecutionProvider` 能产出 `ProviderObservation`。详见 ExecPlan 的 Decision Log。
 *
 * 实现义务（与 Development 域同源，契约套件逐条钉住）：
 *
 * 1. **能力判定先于身份判定**：`cancel` 能力关闭时，对**任何**输入（含外来 binding、错误 objectKind、
 *    形态不对的引用）都回答 `not_supported`。顺序反过来会让「能力没开 + 外来引用」答 `not_found`，
 *    而两个码指向不同的恢复动作（`not_supported` → 转人工，`not_found` → 去平台确认）。
 * 2. **返回值里的引用一律由 provider 构造**：闸门只校验参与判定的字段，其余（`url`、未知字段）不得回显；
 *    回显同一个对象还会让调用方事后改写它，污染已经返回的快照。
 * 3. **`command` / `environment` 是一次性输入**：不得编进返回的引用或标记。core 把 `ref` 原样落库为
 *    `ExecutionRunRecord.providerRef`，而 `environment` 可能携带凭据材料（凭据不进 Project 数据库）。
 *    交接所需的指令事实是执行上下文（工作项、仓库、分支、工作树），由 core 落库并经查询面暴露；
 *    调用方若要传递无法从这些事实推导的指令，必须先把它变成执行上下文的一部分。
 */
import type { ProviderCapabilitySnapshot } from './capability-keys.ts'
import type { ExternalObjectRef } from './observation.ts'
import type { ProviderResult } from './result.ts'
import type { ProviderDefinition } from './registry.ts'

export interface ProviderExecutionRun {
  readonly ref: ExternalObjectRef; readonly status: string
  readonly startedAt: string | undefined; readonly finishedAt: string | undefined
  readonly exitCode: number | undefined; readonly logUrl: string | undefined
}

export interface ProviderStartRunInput {
  readonly context: ExternalObjectRef; readonly command: string; readonly environment: Readonly<Record<string, string>>
}

export interface ExecutionProvider {
  /** 静态连接实现定义：由实现作者声明，Host 只注入实例与 id（见 `ProviderDefinition`）。 */
  readonly definition: ProviderDefinition
  describeCapabilities(): Promise<ProviderCapabilitySnapshot>
  startRun(input: ProviderStartRunInput): Promise<ProviderResult<ProviderExecutionRun>>
  getRun(ref: ExternalObjectRef): Promise<ProviderResult<ProviderExecutionRun>>
  cancelRun?(ref: ExternalObjectRef): Promise<ProviderResult<ProviderExecutionRun>>
}
