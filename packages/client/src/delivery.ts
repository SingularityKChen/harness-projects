import type { ControllerQueries } from '@harness-projects/controller'

/** 交付投影的类型出口（纯类型叶子）：形状只由 core 定义，经 controller 查询返回类型取得，不复制第二份；core 改字段名，依赖它的 ui-model 派生在 tsc 就报错。 */
export type DeliveryProjection = Awaited<ReturnType<ControllerQueries['getDeliveryProjection']>>
