/**
 * 类型化查询 API（issue #79 / ExecPlan D5）：把 core 的只读投影包成 wire DTO。
 *
 * 只读本地权威快照与缓存，不触发任何外部写入；provider 原生结构在 `wire.ts` 就被换成内部对象，
 * 调用方拿不到 provider 的实例、ref 形状或平台字段。
 */
import type {
  CoreApi, DeliveryLineageHop, DeliveryScope, ExecutionContextQuery, ExecutionContextView,
} from '@harness-projects/core'
import { toWireEntity, toWireSnapshot, type WireAuthority, type WireEntity, type WireSnapshot } from './wire.ts'

export interface ControllerQueries {
  /** 当前修订上的完整投影；修订号是客户端增量订阅的起点。 */
  snapshot(): Promise<WireSnapshot>
  getEntity(entityId: string): Promise<WireEntity | undefined>
  getExecutionContext(query: ExecutionContextQuery): Promise<ExecutionContextView | undefined>
  getDeliveryLineage(scope: DeliveryScope): Promise<readonly DeliveryLineageHop[]>
}

export function createControllerQueries(core: CoreApi, authority: WireAuthority): ControllerQueries {
  return {
    async snapshot(): Promise<WireSnapshot> {
      return toWireSnapshot(await core.queries.listPlanningItems(), authority)
    },
    async getEntity(entityId: string): Promise<WireEntity | undefined> {
      const views = await core.queries.listPlanningItems()
      const view = views.find((item) => item.entityId === entityId)
      return view === undefined ? undefined : toWireEntity(view, authority)
    },
    getExecutionContext: (query) => core.queries.getExecutionContext(query),
    getDeliveryLineage: (scope) => core.queries.getDeliveryLineage(scope),
  }
}
