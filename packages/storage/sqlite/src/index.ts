/**
 * @harness-projects/storage-sqlite —— SQLite 存储实现
 *
 * Responsibility: 实现 Storage 能力契约：迁移、当前状态投影、事件收件箱与外部写入记录。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities
 *
 * 包内相对导入一律带 `.ts` 后缀：Node 直接执行 TS 源码，无后缀无法解析；
 * tsconfig 的 allowImportingTsExtensions 是本仓库对此的显式配置。
 */

export * from './db.ts'
export * from './migrations.ts'
export * from './migrate.ts'
export * from './storage.ts'

export const packageId = '@harness-projects/storage-sqlite' as const
