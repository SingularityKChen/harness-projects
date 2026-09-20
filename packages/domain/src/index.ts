/**
 * @harness-projects/domain —— 领域实体、枚举、稳定标识与关系语义
 * Responsibility: 纯领域模型：实体、枚举、稳定标识、关系语义、状态归一化与错误码。
 * Allowed imports: 无（叶子包；仅 ids.ts 用 node:crypto）。包内相对导入写显式 `.ts` 扩展名（allowImportingTsExtensions）。
 */
export * from './ids.ts'
export * from './enums.ts'
export * from './identity.ts'
export * from './entities.ts'
export * from './relations.ts'
export * from './status.ts'
export * from './errors.ts'
