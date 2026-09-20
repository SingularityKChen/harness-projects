/**
 * @harness-projects/capabilities —— 能力定义与注册契约
 *
 * Responsibility: 定义 Planning / Development / Delivery / Execution / Storage 的 port、稳定 capability key、四态访问级别、结构化错误模型、观察形状与绑定注册视图；不含任何实现。
 * Allowed imports: @harness-projects/domain，以及 Node 内建模块（node:crypto）
 *
 * 包内相对导入使用显式 `.ts` 扩展名：Node 直接执行 TS 源码，既不接受省略扩展名，也不把 `.js`
 * 映射到 `.ts`（与 packages/domain/src/index.ts 的同类说明一致）。
 */
export * from './result.ts'
export * from './capability-keys.ts'
export * from './observation.ts'
export * from './planning-provider.ts'
export * from './development-provider.ts'
export * from './delivery-provider.ts'
export * from './execution-provider.ts'
export * from './storage.ts'
export * from './registry.ts'
