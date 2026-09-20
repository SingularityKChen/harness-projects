import type { WorkspaceDatabase } from './db.ts'
import type { Migration } from './migrations.ts'
import { MIGRATIONS, MIGRATIONS_DIR, assertManifestIntegrity, readMigrationSql } from './migrations.ts'

export interface MigrateOptions {
  /** 迁移清单，默认包内 MIGRATIONS；测试用它注入失败迁移。 */
  readonly entries?: readonly Migration[]
  /** 迁移体目录，默认包内 migrations/。 */
  readonly dir?: string
}

export interface MigrateResult {
  /** 本次真正应用的版本号，按应用顺序排列；重复运行时为 []。 */
  readonly applied: number[]
  /** 运行结束后的当前 schema 版本；空库为 0。 */
  readonly version: number
}

/**
 * 按清单顺序应用缺失迁移，返回本次应用的版本与结束版本。
 *
 * 每个迁移一个事务，顺序固定为：开启写事务 → 在事务内重新读取已应用版本 → 执行迁移体
 * → 写 schema_migrations → 提交。顺序与事务缺一不可：代码注释里的顺序被破坏、版本记录
 * 落在事务之外、或"版本是否已应用"只依据写事务之外的读取，都会让"半执行的库"被标记为
 * 已迁移，或让并发启动的两个进程重复执行同一段 DDL——这正是本模块要防的失败模式。
 *
 * 事务外的快路径读取只用于跳过"已确认应用"的版本：版本记录只增不减，读到即可信任。
 * 它绝不作为"某版本缺失"的最终依据——并发进程可能在这次读取之后提交同一版本，
 * 因此真正决定是否执行 DDL 的判定必须发生在 BEGIN IMMEDIATE 之内。
 */
export function migrate(db: WorkspaceDatabase, options: MigrateOptions = {}): MigrateResult {
  const entries = options.entries ?? MIGRATIONS
  const dir = options.dir ?? MIGRATIONS_DIR
  assertManifestIntegrity(entries, dir)

  const observed = readAppliedVersions(db)
  assertAppliedIsManifestPrefix(observed, entries)

  const settled = new Set(observed)
  const newlyApplied: number[] = []
  for (const entry of entries) {
    if (settled.has(entry.version)) continue
    if (applyIfMissing(db, entries, entry, dir)) newlyApplied.push(entry.version)
  }

  // 仅用于汇报运行结束后的已提交版本，不参与任何"是否应用"的判定。
  return { applied: newlyApplied, version: readAppliedVersions(db).at(-1) ?? 0 }
}

/**
 * 单元：迁移体与版本记录同生共死——失败时两者都不留下。
 *
 * BEGIN IMMEDIATE 先取得写锁，随后在锁内重新读取已提交版本。并发启动的后到者会在
 * BEGIN IMMEDIATE 处等待（受 busy_timeout 约束），拿到锁后看到先到者提交的版本而跳过，
 * 而不是拿着过期的读取结果重复执行 DDL。返回 true 表示本次真正应用了该迁移。
 */
function applyIfMissing(
  db: WorkspaceDatabase,
  entries: readonly Migration[],
  entry: Migration,
  dir: string,
): boolean {
  const sql = readMigrationSql(entry, dir)
  db.exec('BEGIN IMMEDIATE')
  try {
    const applied = readAppliedVersions(db)
    assertAppliedIsManifestPrefix(applied, entries)
    if (applied.includes(entry.version)) {
      db.exec('ROLLBACK')
      return false
    }
    db.exec(sql)
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      entry.version,
      new Date().toISOString(),
    )
    db.exec('COMMIT')
    return true
  } catch (error) {
    rollbackQuietly(db)
    throw error
  }
}

function rollbackQuietly(db: WorkspaceDatabase): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    // SQLite 可能已经自动回滚；此时不要用回滚错误覆盖真正的失败原因。
  }
}

/** 已应用版本升序读取；schema_migrations 还没建立时（空库）视为 0 个版本。 */
function readAppliedVersions(db: WorkspaceDatabase): number[] {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  if (table === undefined) return []
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    readonly version: number
  }[]
  return rows.map((row) => row.version)
}

/** 已应用版本必须恰好是清单的前缀：丢失、篡改或乱序都会在这里报错，而不是静默跳过。 */
function assertAppliedIsManifestPrefix(
  applied: readonly number[],
  entries: readonly Migration[],
): void {
  const expected = entries.slice(0, applied.length).map((entry) => entry.version)
  const mismatch =
    applied.length !== expected.length || applied.some((version, index) => version !== expected[index])
  if (mismatch) {
    const actual = applied.join(', ')
    const declared = entries.map((entry) => entry.version).join(', ')
    throw new Error(`数据库已应用版本与迁移清单不一致：库为 [${actual}]，清单为 [${declared}]`)
  }
}
