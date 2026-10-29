// #414：准入拒绝不能改动任何既有 schema、行、账本或世代。
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as sqlite from '@harness-projects/storage-sqlite'

const versions = [1, 2, 3, 4, 5, 6, 7]
const quote = (name) => `"${name.replaceAll('"', '""')}"`
const fixture = (db, count = versions.length, transform = (sql) => sql) => {
  for (const entry of sqlite.MIGRATIONS.slice(0, count)) {
    db.exec(transform(sqlite.readMigrationSql(entry)))
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(entry.version, `fixed-${entry.version}`)
  }
}
const snapshot = (db) => {
  const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all()
  return { generation: db.prepare('PRAGMA user_version').get().user_version, schema,
    rows: schema.filter((row) => row.type === 'table').map(({ name }) => [name, (() => { const statement = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`); statement.setReadBigInts(true); return statement.all() })()]) }
}
const incompatible = (reason) => (error) => {
  assert.equal(error.constructor.name, 'IncompatibleDatabaseError')
  assert.equal(error.code, 'incompatible_database')
  if (reason) assert.equal(error.reason, reason)
  assert.equal(error.expectedGeneration, 2)
  assert.equal(typeof error.actualGeneration, 'number')
  assert.equal(error.action, 'back_up_and_rebuild')
  assert.match(error.message, /备份/)
  return true
}
const withoutOwner = (sql) => sql.replace(/^.*provisioning_generation.*\n/gm, '')
const cases = [
  ['old-generation-one', (db) => { fixture(db, versions.length, withoutOwner); db.exec("INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=1") }, 'generation'],
  ...[0, 2].map((generation) => [`masked-old-owner-shape-${generation}`, (db) => { fixture(db, versions.length, withoutOwner); db.exec(`INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=${generation}`) }, 'schema_shape']),
  ['prefix1', (db) => fixture(db, 1), 'version_list'],
  ['prefix2', (db) => fixture(db, 2), 'version_list'],
  ['prefix4', (db) => fixture(db, 4), 'version_list'],
  ['gap', (db) => { fixture(db); db.exec('DELETE FROM schema_migrations WHERE version=4') }, 'version_list'],
  ['future', (db) => { fixture(db); db.exec("INSERT INTO schema_migrations VALUES (8,'future')") }, 'version_list'],
  ['int64-max-version', (db) => { fixture(db); db.exec('UPDATE schema_migrations SET version=9223372036854775807 WHERE version=7') }, 'version_list'],
  ['int64-min-version', (db) => { fixture(db); db.exec('UPDATE schema_migrations SET version=-9223372036854775808 WHERE version=7') }, 'version_list'],
  ['quoted-workspace-primary-key', (db) => { fixture(db, versions.length, (sql) => sql.replace('CREATE TABLE workspace (\n  id TEXT PRIMARY KEY', 'CREATE TABLE workspace (\n  id TEXT "PRIMARY" "KEY"')); assert.equal(db.prepare('PRAGMA table_info(workspace)').all().find((row) => row.name === 'id').pk, 0) }, 'schema_shape'],
  ['quoted-ledger-primary-key', (db) => { fixture(db, versions.length, (sql) => sql.replace('version INTEGER PRIMARY KEY', 'version INTEGER "PRIMARY" "KEY"')); assert.equal(db.prepare('PRAGMA table_info(schema_migrations)').all().find((row) => row.name === 'version').pk, 0) }, 'schema_shape'],
  ['quoted-ledger-not-null', (db) => { fixture(db, versions.length, (sql) => sql.replace('applied_at TEXT NOT NULL', 'applied_at TEXT "NOT" "NULL"')); assert.equal(db.prepare('PRAGMA table_info(schema_migrations)').all().find((row) => row.name === 'applied_at').notnull, 0) }, 'schema_shape'],
  ['generation', (db) => db.exec('PRAGMA user_version=99'), 'generation'],
  ['marked-wrong', (db) => { fixture(db, 1); db.exec('PRAGMA user_version=2') }, 'version_list'],
  ['unknown', (db) => { fixture(db); db.exec('CREATE TABLE sqliteX_extra(value TEXT); INSERT INTO sqliteX_extra VALUES (\'keep\')') }, 'unknown_objects'],
  ['unicode-identifier', (db) => fixture(db, versions.length, (sql) => sql.replaceAll('workspace', 'worKspace')), 'unknown_objects'],
  ['malformed-ledger', (db) => db.exec('CREATE TABLE schema_migrations (garbage TEXT); INSERT INTO schema_migrations VALUES (\'keep\')'), 'schema_shape'],
  ['missing-column', (db) => { fixture(db); db.exec('ALTER TABLE workspace DROP COLUMN name') }, 'schema_shape'],
  ['check-literal', (db) => fixture(db, versions.length, (sql) => sql.replaceAll("'pending'", "'PENDING'")), 'schema_shape'],
  ['primary-key', (db) => fixture(db, versions.length, (sql) => sql.replace('version INTEGER PRIMARY KEY', 'version INTEGER UNIQUE')), 'schema_shape'],
  ['index-condition', (db) => fixture(db, versions.length, (sql) => sql.replace('WHERE is_default = 1', 'WHERE is_default = 0')), 'schema_shape'],
  ['missing-index', (db) => { fixture(db); const row = db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL LIMIT 1").get(); db.exec(`DROP INDEX ${quote(row.name)}`) }, 'schema_shape'],
]
for (const [name, build, reason] of cases) test(`拒绝 ${name}：两入口均结构化拒绝且全库不变`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-admission-')); const file = join(dir, 'workspace.sqlite')
  const db = sqlite.openDatabase(file)
  try {
    build(db); const before = snapshot(db)
    assert.throws(() => sqlite.migrate(db), incompatible(reason))
    assert.deepEqual(snapshot(db), before)
    assert.throws(() => sqlite.createSqliteStorage(file), incompatible(reason))
    assert.deepEqual(snapshot(db), before)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

// JavaScript \s 的 Unicode 成员在 SQLite 中属于名称/类型，不能静默丢弃。
const unicodeSpaces = [0x00a0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
for (const cp of unicodeSpaces) for (const shape of ['column', 'not-null', 'primary-key']) for (const entry of ['migrate', 'factory']) {
  test(`Unicode U+${cp.toString(16).toUpperCase()} ${shape} ${entry}：schema_shape 拒绝且全库不变`, () => {
    const space = String.fromCodePoint(cp), dir = mkdtempSync(join(tmpdir(), 'baseline-unicode-')), file = join(dir, 'workspace.sqlite')
    const db = sqlite.openDatabase(file)
    try {
      const original = shape === 'primary-key' ? 'version INTEGER PRIMARY KEY' : '  name TEXT NOT NULL,'
      const changed = shape === 'primary-key' ? `version INTEGER${space}PRIMARY KEY`
        : shape === 'column' ? `  name${space}TEXT NOT NULL,` : `  name TEXT${space}NOT NULL,`
      fixture(db, versions.length, (sql) => sql.replace(original, changed))
      const columns = db.prepare('PRAGMA table_info(workspace)').all()
      if (shape === 'column') {
        assert.ok(!columns.some((column) => column.name === 'name'))
        assert.ok(columns.some((column) => column.name === `name${space}TEXT`))
        db.prepare(`INSERT INTO workspace(id,${quote(`name${space}TEXT`)},status_policy) VALUES (?,?,?)`).run('kept', 'kept', 'provider_authoritative')
      } else {
        if (shape === 'not-null') assert.equal(columns.find((column) => column.name === 'name').notnull, 0)
        db.prepare('INSERT INTO workspace(id,name,status_policy) VALUES (?,?,?)').run('kept', shape === 'not-null' ? null : 'kept', 'provider_authoritative')
      }
      if (shape === 'primary-key') {
        assert.equal(db.prepare('PRAGMA table_info(schema_migrations)').all().find((column) => column.name === 'version').pk, 0)
        db.exec('SAVEPOINT duplicate_probe')
        db.exec("INSERT INTO schema_migrations VALUES (1,'duplicate permitted')")
        db.exec('ROLLBACK TO duplicate_probe; RELEASE duplicate_probe')
      }
      const before = snapshot(db)
      assert.throws(() => entry === 'migrate' ? sqlite.migrate(db) : sqlite.createSqliteStorage(file).close(), incompatible('schema_shape'))
      assert.deepEqual(snapshot(db), before)
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

for (const whitespace of [' ', '\t', '\n', '\f', '\r']) test(`SQLite ASCII 空白 ${JSON.stringify(whitespace)} 与合法引号：两入口仍接纳`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-ascii-')), file = join(dir, 'workspace.sqlite'), db = sqlite.openDatabase(file)
  try {
    fixture(db, versions.length, (sql) => sql.replace('  name TEXT NOT NULL,', `  "name"${whitespace}TEXT${whitespace}NOT${whitespace}NULL,`)
      .replace('version INTEGER PRIMARY KEY', `"version"${whitespace}INTEGER${whitespace}PRIMARY${whitespace}KEY`))
    db.exec("INSERT INTO workspace(id,name,status_policy) VALUES ('kept','kept','provider_authoritative')")
    const before = snapshot(db)
    assert.deepEqual(sqlite.migrate(db), { applied: [], version: 7 })
    sqlite.createSqliteStorage(file).close()
    assert.deepEqual(snapshot(db), { ...before, generation: 2 })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const quoted of [false, true]) test(`实际完整当前链有数据（引号标识符 ${quoted}）：只认可世代，随后重开不改任何行`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-current-')); const file = join(dir, 'workspace.sqlite')
  const db = sqlite.openDatabase(file)
  try {
    fixture(db, versions.length, (sql) => quoted ? sql.replace(/\bid\b/g, '"ID"') : sql); db.exec("INSERT INTO workspace(id,name,status_policy) VALUES ('kept','kept','provider_authoritative')")
    const before = snapshot(db)
    assert.deepEqual(sqlite.migrate(db), { applied: [], version: 7 })
    assert.deepEqual(snapshot(db), { ...before, generation: 2 })
    const stamped = snapshot(db)
    sqlite.createSqliteStorage(file).close()
    for (let i = 0; i < 2; i++) assert.deepEqual(sqlite.migrate(db), { applied: [], version: 7 })
    assert.deepEqual(snapshot(db), stamped)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const phase of ['late-ddl', 'ledger', 'marker', 'commit']) test(`空库 ${phase} 故障：全链回滚且可重试`, () => {
  const db = sqlite.openDatabase(':memory:'); const before = snapshot(db); const failure = new Error(`injected-${phase}`)
  const wrapped = { close: db.close.bind(db), prepare(sql) {
    const statement = db.prepare(sql)
    if (phase !== 'ledger' || !sql.startsWith('INSERT INTO schema_migrations')) return statement
    return { run(...args) { const result = statement.run(...args); if (args[0] === 7) throw failure; return result } }
  }, exec(sql) {
    if (phase === 'commit' && sql === 'COMMIT') throw failure
    const result = db.exec(sql)
    if ((phase === 'marker' && sql.startsWith('PRAGMA user_version =')) || (phase === 'late-ddl' && sql.includes('CREATE TABLE planning_sync_round'))) throw failure
    return result
  } }
  try {
    assert.throws(() => sqlite.migrate(wrapped), (error) => error === failure)
    assert.deepEqual(snapshot(db), before)
    assert.deepEqual(sqlite.migrate(db).applied, versions)
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close() }
})

test('清单选项不能提供不完整当前清单绕过准入', () => {
  const db = sqlite.openDatabase(':memory:')
  try {
    const before = snapshot(db)
    assert.throws(() => sqlite.migrate(db, { entries: sqlite.MIGRATIONS.slice(0, 1) }), /完整当前清单/)
    assert.deepEqual(snapshot(db), before)
  } finally { db.close() }
})

test('资源与写锁失败保留原错误，工厂失败释放句柄', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-resource-')); const file = join(dir, 'workspace.sqlite')
  try {
    const descriptors = readdirSync('/dev/fd').length
    assert.throws(() => sqlite.createSqliteStorage(file, undefined, { migrationsDir: join(dir, 'missing') }),
      (error) => error.code !== 'incompatible_database' && /迁移文件缺失/.test(error.message))
    assert.ok(readdirSync('/dev/fd').length <= descriptors)
    const db = sqlite.openDatabase(file)
    try {
      const before = snapshot(db); const failure = new Error('SQLITE_BUSY')
      const wrapped = { prepare: db.prepare.bind(db), close: db.close.bind(db), exec(sql) {
        if (sql === 'BEGIN IMMEDIATE') throw failure
        return db.exec(sql)
      } }
      assert.throws(() => sqlite.migrate(wrapped), (error) => error === failure)
      assert.deepEqual(snapshot(db), before)
      db.exec('BEGIN EXCLUSIVE; ROLLBACK')
    } finally { db.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
