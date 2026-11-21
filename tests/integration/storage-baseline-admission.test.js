// #414/#595：准入拒绝不能改动任何既有 schema、行、账本或世代。
import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as sqlite from '@harness-projects/storage-sqlite'

const MIGRATION_COUNT = sqlite.MIGRATIONS.length
const quote = (name) => `"${name.replaceAll('"', '""')}"`
/** 当前布局夹具：按顺序应用前 `count` 份资产，账本只写一行基线（#595 之后新库的形状）。 */
const fixture = (db, count = MIGRATION_COUNT, transform = (sql) => sql) => {
  for (const file of sqlite.MIGRATIONS.slice(0, count)) db.exec(transform(sqlite.readMigrationSql(file)))
  db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(sqlite.BASELINE_VERSION, 'fixed-baseline')
}
/**
 * 旧 main 布局夹具（#596 D13、#663）：多行账本用例用完整 shape（旧链建出的 sqlite_schema 与
 * 单资产逐字相同，I3）并补当前世代；只应用过 001 记账表的旧库用 002 首表注释前的截断前缀。
 * 截断必须真的发生：标记被改写时 `split[0]` 会退化为整份资产，让「只应用 001」变成完整库。
 */
const legacyFixture = (db, ledgerRows = 7, transform = (sql) => sql) => {
  const sql = sqlite.readMigrationSql(sqlite.MIGRATIONS[0])
  const prefix = sql.split('-- 002_identity_membership：')[0]
  assert.notEqual(prefix, sql, '旧库截断标记失效：`-- 002_identity_membership：` 必须仍在单资产里')
  db.exec(transform(ledgerRows === 1 ? prefix : sql))
  if (ledgerRows > 1) db.exec(`PRAGMA user_version=${sqlite.CURRENT_SCHEMA_GENERATION}`)
  for (let version = 1; version <= ledgerRows; version += 1) db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(version, `fixed-${version}`)
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
  assert.equal(error.expectedGeneration, sqlite.CURRENT_SCHEMA_GENERATION)
  assert.equal(typeof error.actualGeneration, 'number')
  assert.equal(error.action, 'back_up_and_rebuild')
  assert.match(error.message, /备份/)
  assert.match(error.message, /原数据库已保留/)
  assert.match(error.message, /保留.*数据.*显式迁移|显式迁移.*保留.*数据/)
  assert.match(error.message, /不要仅修改数据库.*号/)
  assert.match(error.message, /https:\/\/github\.com\/SingularityKChen\/harness-projects\/blob\/main\/docs\/product\/demo-install\.md#database-recovery/)
  return true
}
const withoutOwner = (sql) => sql.replace(/^.*provisioning_generation.*\n/gm, '')
const withoutIntent = (sql) => sql.replace(/^.*external_intent_json.*\n/gm, '')
const oldSnapshotView = `CREATE VIEW committed_observation AS
SELECT ledger.* FROM sync_observation AS ledger
WHERE NOT EXISTS (
  SELECT 1 FROM sync_observation AS newer
  WHERE newer.binding_id = ledger.binding_id
    AND newer.object_kind = ledger.object_kind
    AND newer.object_external_id = ledger.object_external_id
    AND (newer.updated_at > ledger.updated_at
      OR (newer.updated_at = ledger.updated_at AND newer.observed_at > ledger.observed_at)
      OR (newer.updated_at = ledger.updated_at AND newer.observed_at = ledger.observed_at AND newer.rowid > ledger.rowid))
);`
const cases = [
  ...[0, 6, 7].map(generation => [`projection-without-source-${generation}`, db => {
    fixture(db, MIGRATION_COUNT, sql => {
      const old = sql.replace(/^.*source_binding_id TEXT NOT NULL.*\n/gm, '')
      assert.notEqual(old, sql, '旧 shape 夹具必须实际移除投影来源列')
      return old
    })
    db.exec(`INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=${generation}`)
  }, generation === 6 ? 'generation' : 'schema_shape']),
  ...[4, sqlite.CURRENT_SCHEMA_GENERATION].map((generation) => [`old-snapshot-view-${generation}`, (db) => {
    fixture(db, MIGRATION_COUNT, (sql) => sql.replace(/CREATE VIEW committed_observation_version AS[\s\S]*?;/, oldSnapshotView))
    db.exec(`INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=${generation}`)
  }, generation === 4 ? 'generation' : 'unknown_objects']),
  ['prior-start-work-only-intent-check', (db) => fixture(db, MIGRATION_COUNT, (sql) => sql.replace(/external_intent_json TEXT CHECK[^\n]+/, "external_intent_json TEXT CHECK (external_intent_json IS NULL OR (command_name = 'startWork' AND json_valid(external_intent_json) AND json_type(external_intent_json) = 'object')),")), 'schema_shape'],
  ['old-generation-two', (db) => { fixture(db, MIGRATION_COUNT, withoutIntent); db.exec("INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=2") }, 'generation'],
  ...[0, sqlite.CURRENT_SCHEMA_GENERATION].map((generation) => [`masked-old-intent-shape-${generation}`, (db) => { fixture(db, MIGRATION_COUNT, withoutIntent); db.exec(`INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=${generation}`) }, 'schema_shape']),
  ['old-generation-one', (db) => { fixture(db, MIGRATION_COUNT, withoutOwner); db.exec("INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=1") }, 'generation'],
  ...[0, sqlite.CURRENT_SCHEMA_GENERATION].map((generation) => [`masked-old-owner-shape-${generation}`, (db) => { fixture(db, MIGRATION_COUNT, withoutOwner); db.exec(`INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=${generation}`) }, 'schema_shape']),
  // #595 关键判别：只有「完整当前 shape + 7 行账本 + 当前世代（user_version=6）」才是真实旧 main 库；2/4 行是同一 shape 的合成对抗形状，1 行是旧 001 截断 shape（generation 0）。三类都必须被拒绝且零写入。
  ['legacy-ledger-7', (db) => legacyFixture(db), 'version_list'],
  ['legacy-ledger-4', (db) => legacyFixture(db, 4), 'version_list'],
  ['legacy-ledger-2', (db) => legacyFixture(db, 2), 'version_list'],
  // 旧 main 只应用首步的库：账本恰好是 [1]，与单基线账本无法区分；由完整 shape 准入拒绝（I4）。
  ['legacy-ledger-1', (db) => legacyFixture(db, 1), 'schema_shape'],
  ['gap-in-legacy-ledger', (db) => { legacyFixture(db); db.exec('DELETE FROM schema_migrations WHERE version=4') }, 'version_list'],
  ['extra-ledger-row', (db) => { fixture(db); db.exec("INSERT INTO schema_migrations VALUES (2,'future')") }, 'version_list'],
  ['empty-ledger', (db) => { fixture(db); db.exec('DELETE FROM schema_migrations') }, 'version_list'],
  ['wrong-baseline-7', (db) => { fixture(db); db.exec('UPDATE schema_migrations SET version=7') }, 'version_list'],
  ['wrong-baseline-0', (db) => { fixture(db); db.exec('UPDATE schema_migrations SET version=0') }, 'version_list'],
  ['int64-max-version', (db) => { fixture(db); db.exec('UPDATE schema_migrations SET version=9223372036854775807') }, 'version_list'],
  ['int64-min-version', (db) => { fixture(db); db.exec('UPDATE schema_migrations SET version=-9223372036854775808') }, 'version_list'],
  ['partial-initialization-marked-current', (db) => { legacyFixture(db, 1); db.exec(`PRAGMA user_version=${sqlite.CURRENT_SCHEMA_GENERATION}`) }, 'schema_shape'],
  ['quoted-workspace-primary-key', (db) => { fixture(db, MIGRATION_COUNT, (sql) => sql.replace('CREATE TABLE workspace (\n  id TEXT PRIMARY KEY', 'CREATE TABLE workspace (\n  id TEXT "PRIMARY" "KEY"')); assert.equal(db.prepare('PRAGMA table_info(workspace)').all().find((row) => row.name === 'id').pk, 0) }, 'schema_shape'],
  ['quoted-ledger-primary-key', (db) => { fixture(db, MIGRATION_COUNT, (sql) => sql.replace('version INTEGER PRIMARY KEY', 'version INTEGER "PRIMARY" "KEY"')); assert.equal(db.prepare('PRAGMA table_info(schema_migrations)').all().find((row) => row.name === 'version').pk, 0) }, 'schema_shape'],
  ['quoted-ledger-not-null', (db) => { fixture(db, MIGRATION_COUNT, (sql) => sql.replace('applied_at TEXT NOT NULL', 'applied_at TEXT "NOT" "NULL"')); assert.equal(db.prepare('PRAGMA table_info(schema_migrations)').all().find((row) => row.name === 'applied_at').notnull, 0) }, 'schema_shape'],
  ['previous-primary-generation', (db) => { fixture(db); db.exec("INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=5") }, 'generation'],
  ['generation', (db) => db.exec('PRAGMA user_version=99'), 'generation'],
  ['unknown', (db) => { fixture(db); db.exec('CREATE TABLE sqliteX_extra(value TEXT); INSERT INTO sqliteX_extra VALUES (\'keep\')') }, 'unknown_objects'],
  ['unicode-identifier', (db) => fixture(db, MIGRATION_COUNT, (sql) => sql.replaceAll('workspace', 'worKspace')), 'unknown_objects'],
  ['malformed-ledger', (db) => db.exec('CREATE TABLE schema_migrations (garbage TEXT); INSERT INTO schema_migrations VALUES (\'keep\')'), 'schema_shape'],
  ['missing-column', (db) => { fixture(db); db.exec('ALTER TABLE workspace DROP COLUMN name') }, 'schema_shape'],
  ['check-literal', (db) => fixture(db, MIGRATION_COUNT, (sql) => sql.replaceAll("'pending'", "'PENDING'")), 'schema_shape'],
  ['primary-key', (db) => fixture(db, MIGRATION_COUNT, (sql) => sql.replace('version INTEGER PRIMARY KEY', 'version INTEGER UNIQUE')), 'schema_shape'],
  ['index-condition', (db) => fixture(db, MIGRATION_COUNT, (sql) => sql.replace('WHERE is_default = 1', 'WHERE is_default = 0')), 'schema_shape'],
  ['missing-index', (db) => { fixture(db); const row = db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL LIMIT 1").get(); db.exec(`DROP INDEX ${quote(row.name)}`) }, 'schema_shape'],
]
for (const [name, build, reason] of cases) test(`拒绝 ${name}：两入口均结构化拒绝且全库不变`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-admission-')); const file = join(dir, 'workspace.sqlite')
  const db = sqlite.openDatabase(file)
  try {
    build(db); const before = snapshot(db), hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    assert.throws(() => sqlite.migrate(db), incompatible(reason))
    assert.deepEqual(snapshot(db), before)
    assert.throws(() => sqlite.createSqliteStorage(file), incompatible(reason))
    assert.deepEqual(snapshot(db), before)
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash)
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
      fixture(db, MIGRATION_COUNT, (sql) => sql.replace(original, changed))
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
    fixture(db, MIGRATION_COUNT, (sql) => sql.replace('  name TEXT NOT NULL,', `  "name"${whitespace}TEXT${whitespace}NOT${whitespace}NULL,`)
      .replace('version INTEGER PRIMARY KEY', `"version"${whitespace}INTEGER${whitespace}PRIMARY${whitespace}KEY`))
    db.exec("INSERT INTO workspace(id,name,status_policy) VALUES ('kept','kept','provider_authoritative')")
    const before = snapshot(db)
    assert.deepEqual(sqlite.migrate(db), { applied: [], version: sqlite.BASELINE_VERSION })
    sqlite.createSqliteStorage(file).close()
    assert.deepEqual(snapshot(db), { ...before, generation: sqlite.CURRENT_SCHEMA_GENERATION })
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const quoted of [false, true]) test(`实际完整当前链有数据（引号标识符 ${quoted}）：只认可单行基线账本，随后重开不改任何行`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-current-')); const file = join(dir, 'workspace.sqlite')
  const db = sqlite.openDatabase(file)
  try {
    fixture(db, MIGRATION_COUNT, (sql) => quoted ? sql.replace(/\b(id|registered|primary_role)\b/g, name => quote(name.toUpperCase())) : sql); db.exec("INSERT INTO workspace(id,name,status_policy) VALUES ('kept','kept','provider_authoritative')")
    const before = snapshot(db)
    assert.deepEqual(sqlite.migrate(db), { applied: [], version: sqlite.BASELINE_VERSION })
    assert.deepEqual(snapshot(db), { ...before, generation: sqlite.CURRENT_SCHEMA_GENERATION })
    const stamped = snapshot(db)
    sqlite.createSqliteStorage(file).close()
    for (let i = 0; i < 2; i++) assert.deepEqual(sqlite.migrate(db), { applied: [], version: sqlite.BASELINE_VERSION })
    assert.deepEqual(snapshot(db), stamped)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const phase of ['late-ddl', 'ledger', 'marker', 'commit']) test(`空库 ${phase} 故障：全链回滚且可重试`, () => {
  const db = sqlite.openDatabase(':memory:'); const before = snapshot(db); const failure = new Error(`injected-${phase}`)
  const wrapped = { close: db.close.bind(db), prepare(sql) {
    const statement = db.prepare(sql)
    if (phase !== 'ledger' || !sql.startsWith('INSERT INTO schema_migrations')) return statement
    return { run(...args) { const result = statement.run(...args); if (args[0] === sqlite.BASELINE_VERSION) throw failure; return result } }
  }, exec(sql) {
    if (phase === 'commit' && sql === 'COMMIT') throw failure
    const result = db.exec(sql)
    if ((phase === 'marker' && sql.startsWith('PRAGMA user_version =')) || (phase === 'late-ddl' && sql.includes('CREATE TABLE planning_sync_round'))) throw failure
    return result
  } }
  try {
    assert.throws(() => sqlite.migrate(wrapped), (error) => error === failure)
    assert.deepEqual(snapshot(db), before)
    assert.deepEqual(sqlite.migrate(db).applied, [sqlite.BASELINE_VERSION])
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
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

// 旧的完整 schema 即使伪装为当前 generation，也不得补列、盖章或改写文件。
for (const generation of [0, 3, 5, sqlite.CURRENT_SCHEMA_GENERATION]) test(`旧日期投影 shape @${generation}：拒绝后逻辑与文件 hash 均不变`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-schedule-')), file = join(dir, 'workspace.sqlite')
  const db = sqlite.openDatabase(file)
  let closed = false
  try {
    fixture(db, MIGRATION_COUNT, sql => sql.replace(/^.*field_iteration_(?:start_date|duration_days).*\n/gm, ''))
    db.exec(`INSERT INTO workspace VALUES ('kept','kept','provider_authoritative'); PRAGMA user_version=${generation}`)
    const before = snapshot(db)
    db.close(); closed = true
    const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex')
    const original = hash()
    assert.throws(() => sqlite.createSqliteStorage(file), incompatible(generation !== 0 && generation !== sqlite.CURRENT_SCHEMA_GENERATION ? 'generation' : 'schema_shape'))
    assert.equal(hash(), original)
    const reopened = sqlite.openDatabase(file)
    try { assert.deepEqual(snapshot(reopened), before) } finally { reopened.close() }
  } finally { if (!closed) db.close(); rmSync(dir, { recursive: true, force: true }) }
})
