import { openDatabase, type WorkspaceDatabase } from './db.ts'
import { BASELINE_VERSION, MIGRATIONS, MIGRATIONS_DIR, assertManifestIntegrity, readMigrationSql } from './migrations.ts'

export interface MigrateOptions {
  /** 受信打包迁移体目录；参考结构与建库使用同一批 SQL。 */
  readonly dir?: string
}

/** 首建空库：`applied=[BASELINE_VERSION]`、`version=BASELINE_VERSION`；重开：`applied=[]`、同一基线版本。 */
export interface MigrateResult {
  readonly applied: number[]
  readonly version: number
}

export const CURRENT_SCHEMA_GENERATION = 6
export type IncompatibleDatabaseReason = 'generation' | 'version_list' | 'schema_shape' | 'unknown_objects'
export class IncompatibleDatabaseError extends Error {
  readonly code = 'incompatible_database'
  readonly expectedGeneration = CURRENT_SCHEMA_GENERATION
  readonly action = 'back_up_and_rebuild'
  readonly reason: IncompatibleDatabaseReason
  readonly actualGeneration: number
  constructor(reason: IncompatibleDatabaseReason, actualGeneration: number) {
    super('数据库不符合当前基线，原数据库已保留。请先退出使用该库的宿主并备份。保留现有数据需要显式迁移，或恢复与该库匹配的旧版；新位置重建会得到空工作区。不要仅修改数据库世代号。具体操作：https://github.com/SingularityKChen/harness-projects/blob/main/docs/product/demo-install.md#database-recovery')
    this.name = 'IncompatibleDatabaseError'
    this.reason = reason
    this.actualGeneration = actualGeneration
  }
}

type SchemaObject = { type: string; name: string; tbl_name: string; sql: string }
function schema(db: WorkspaceDatabase): SchemaObject[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all() as SchemaObject[]
}

const fold = (value: string): string => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())

/** 仅忽略 SQLite 的五个 ASCII 空白；其它字符、字符串原文与词边界保留。 */
function normalized(sql: string, identifiers: ReadonlySet<string>): string {
  const tokens = sql.match(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\p{L}\p{N}_$]+|[^ \t\n\f\r]/gu) ?? []
  return JSON.stringify(tokens.filter((token) => !token.startsWith('--') && !token.startsWith('/*')).map((token) => {
    if (token.startsWith("'")) return token
    if (token.startsWith('"') || token.startsWith('`') || token.startsWith('[')) {
      const identifier = fold(token.slice(1, -1).replaceAll(token.charAt(0) + token.charAt(0), token.charAt(0)))
      // 只把参考结构中的已知名字视为标识符；引号里的约束词/标点保留类别。
      return identifiers.has(identifier) ? identifier : ['quoted', identifier]
    }
    return fold(token)
  }))
}
function sameObject(actual: SchemaObject, expected: SchemaObject, identifiers: ReadonlySet<string>): boolean {
  return actual.type === expected.type && fold(actual.name) === fold(expected.name)
    && fold(actual.tbl_name) === fold(expected.tbl_name) && normalized(actual.sql, identifiers) === normalized(expected.sql, identifiers)
}
function assertCurrent(db: WorkspaceDatabase, expected: SchemaObject[], identifiers: ReadonlySet<string>, generation: number): void {
  const actual = schema(db)
  const byName = new Map(expected.map((row) => [fold(row.name), row]))
  const refuse = (reason: IncompatibleDatabaseReason): never => { throw new IncompatibleDatabaseError(reason, generation) }
  if (actual.some((row) => !byName.has(fold(row.name)))) refuse('unknown_objects')
  const ledger = actual.find((row) => fold(row.name) === 'schema_migrations')
  if (!ledger || !sameObject(ledger, byName.get('schema_migrations')!, identifiers)) refuse('schema_shape')
  // 单基线账本：恰好一行且值等于 BASELINE_VERSION。CAST 保留 int64 边界的拒绝语义（不先转 JS number）。
  const versions = (db.prepare('SELECT CAST(version AS TEXT) AS version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map((row) => row.version)
  if (versions.length !== 1 || versions[0] !== String(BASELINE_VERSION)) refuse('version_list')
  if (actual.length !== expected.length || actual.some((row) => !sameObject(row, byName.get(fold(row.name))!, identifiers))) refuse('schema_shape')
}

/** 唯一打开期准入：非空库只认可完整当前基线；空库一次原子建立全链。 */
export function migrate(db: WorkspaceDatabase, options: MigrateOptions = {}): MigrateResult {
  const dir = options.dir ?? MIGRATIONS_DIR
  assertManifestIntegrity(MIGRATIONS, dir)
  const sql = MIGRATIONS.map((file) => readMigrationSql(file, dir))
  const reference = openDatabase(':memory:')
  let expected: SchemaObject[]
  const identifiers = new Set<string>()
  try {
    for (const body of sql) reference.exec(body)
    expected = schema(reference)
    for (const object of expected) {
      identifiers.add(fold(object.name))
      if (object.type === 'table' || object.type === 'view') {
        const columns = reference.prepare('SELECT name FROM pragma_table_xinfo(?)').all(object.name) as { name: string }[]
        for (const column of columns) identifiers.add(fold(column.name))
      }
    }
  } finally { reference.close() }

  db.exec('BEGIN IMMEDIATE')
  try {
    const generation = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (generation !== 0 && generation !== CURRENT_SCHEMA_GENERATION) throw new IncompatibleDatabaseError('generation', generation)
    const empty = schema(db).length === 0
    if (empty) {
      for (const body of sql) db.exec(body)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(BASELINE_VERSION, new Date().toISOString())
    }
    assertCurrent(db, expected, identifiers, generation)
    if (generation === 0) db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_GENERATION}`)
    db.exec('COMMIT')
    return { applied: empty ? [BASELINE_VERSION] : [], version: BASELINE_VERSION }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 原始失败优先；SQLite 可能已回滚。 */ }
    throw error
  }
}
