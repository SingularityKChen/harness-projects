import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 逻辑基线版本：`schema_migrations` 里唯一一行的标记，表示「一个完整当前 schema 的基线」，
 * 不是迁移步号序列。首次建库把所有输入资产放在同一事务里执行完，才写这一行。
 */
export const BASELINE_VERSION = 1

/**
 * 有序的迁移体文件名清单：按依赖顺序排列，全部执行完得到一个完整当前 schema。
 * 刻意不扫描目录：目录扫描会把"文件被删或改名"变成静默的版本缺失，
 * 显式清单把同一件事变成一次可见的自检失败。物理碎片可以暂留为输入资产（#596 再折叠）。
 *
 * 决策（不实现 downgrade）：首次 MVP 发布前允许整份迁移体重写；发布后的变更另行评审，
 * 不在本清单里暗示兼容层或双写路径。回滚靠从备份恢复，而不是反向迁移。
 */
export const MIGRATIONS: readonly string[] = [
  '001_init.sql',
  '002_identity_membership.sql',
  '003_control_facts.sql',
  '004_execution_run_identity.sql',
  // 005 保留历史版本位置；载体归一与修复数据步骤已退役（#415）。
  '005_source_version_carrier.sql',
  '006_delivery_facts.sql',
  '007_planning_sync_round.sql',
]

/** 迁移体所在目录，按本模块位置解析，不依赖进程工作目录。 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

export function migrationPath(file: string, dir: string = MIGRATIONS_DIR): string {
  return join(dir, file)
}

export function readMigrationSql(file: string, dir: string = MIGRATIONS_DIR): string {
  return readFileSync(migrationPath(file, dir), 'utf8')
}

/**
 * 清单自检：清单非空、元素是非空文件名、无重复文件名，且对应迁移文件存在。
 * 在应用任何迁移之前调用，让"清单写错"表现为显式报错，而不是静默少应用一份资产；
 * 单基线之后不再有逐条版本号，故不再校验版本正整数/严格递增。
 */
export function assertManifestIntegrity(
  files: readonly string[] = MIGRATIONS,
  dir: string = MIGRATIONS_DIR,
): void {
  if (files.length === 0) throw new Error('迁移清单为空：必须至少包含一个当前基线资产')
  const seen = new Set<string>()
  for (const file of files) {
    if (typeof file !== 'string' || file.length === 0) throw new Error(`迁移清单文件名必须是非空字符串：${String(file)}`)
    if (seen.has(file)) throw new Error(`迁移清单文件名重复：${file}`)
    if (!existsSync(migrationPath(file, dir))) throw new Error(`迁移文件缺失：${file}`)
    seen.add(file)
  }
}
