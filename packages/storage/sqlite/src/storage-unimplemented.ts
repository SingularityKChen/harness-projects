/** L4 范围之外的端口方法：显式抛出，而不是静默 no-op——静默会让"没有实现"读起来像"没有数据"，调用方会据此认为工作区里真的没有这些事实。 */
/** 20 个未实现方法只写一次名字：表驱动生成桩，补齐时删掉一个名字即可，不会留下 20 份各写各的手写签名。 */
const UNIMPLEMENTED_METHODS = ['putMembership', 'getMembership', 'listMemberships', 'putFieldValue', 'listFieldValues',
  'putExecutionContext', 'getExecutionContext', 'findActiveExecutionContext', 'putExecutionRun', 'getExecutionRun',
  'putRelation', 'listRelations', 'recordObservation', 'getSyncCursor', 'putSyncCursor', 'getReconcileCursor',
  'putReconcileCursor', 'findMutationAttempt', 'putMutationAttempt', 'listMutationAttempts'] as const

/** 类型层保留端口的形状（返回 `never` 可赋给任何端口返回类型），便于日后补齐时逐条对齐；参数刻意省略：端口签名允许少参实现，调用方仍按端口调用。 */
export interface UnimplementedPort extends Record<(typeof UNIMPLEMENTED_METHODS)[number], (...args: never[]) => never> {}

export class UnimplementedPort {
  /** 错误里带方法名：调用方一眼能看出缺的是哪一个端口方法。方法体是 `async`，因此抛错表现为 rejected promise 而不是同步抛出。 */
  constructor() {
    for (const method of UNIMPLEMENTED_METHODS) Object.defineProperty(this, method, { value: async () => { throw new Error(`not implemented in L4: ${method}`) } })
  }
}
