import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 一次迁移：单调递增的版本号 + 迁移体文件名。 */
export interface Migration {
  readonly version: number
  readonly file: string
}

/**
 * 有序迁移清单。刻意不扫描目录：目录扫描会把"文件被删或改名"变成静默的版本缺失，
 * 显式清单把同一件事变成一次可见的自检失败。
 *
 * 决策（不实现 downgrade）：已应用过的迁移文件不得再修改，新变更使用新版本号；
 * 回滚靠从备份恢复，而不是反向迁移。这是决策，不是遗漏。
 */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, file: '001_init.sql' }]

/** 迁移体所在目录，按本模块位置解析，不依赖进程工作目录。 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

export function migrationPath(entry: Migration, dir: string = MIGRATIONS_DIR): string {
  return join(dir, entry.file)
}

export function readMigrationSql(entry: Migration, dir: string = MIGRATIONS_DIR): string {
  return readFileSync(migrationPath(entry, dir), 'utf8')
}

/**
 * 清单自检：版本必须是正整数、严格递增、无重复，且对应迁移文件存在。
 * 在应用任何迁移之前调用，让"清单写错"表现为显式报错，而不是静默少应用一个版本。
 */
export function assertManifestIntegrity(
  entries: readonly Migration[] = MIGRATIONS,
  dir: string = MIGRATIONS_DIR,
): void {
  const seen = new Set<number>()
  let previous = 0
  for (const entry of entries) {
    if (!Number.isInteger(entry.version) || entry.version <= 0) {
      throw new Error(`迁移清单版本必须是正整数：${entry.version}`)
    }
    if (seen.has(entry.version)) {
      throw new Error(`迁移清单版本重复：${entry.version}`)
    }
    if (entry.version <= previous) {
      throw new Error(`迁移清单版本必须严格递增：${previous} → ${entry.version}`)
    }
    if (!existsSync(migrationPath(entry, dir))) {
      throw new Error(`迁移文件缺失：${entry.file}`)
    }
    seen.add(entry.version)
    previous = entry.version
  }
}
