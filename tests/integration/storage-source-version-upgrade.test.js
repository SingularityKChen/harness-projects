// 集成层：跨版本重开（PR #240 评审 5352511875 的阻塞项，issue #203）。旧版本写过的库文件在本版本上重开时，已持久化的
// 非规范观察版本载体必须在任何业务写入之前被处理：能无损归一的由迁移 005 归一；不能的，整库在任何迁移之前被拒绝、
// 库文件逐字节不变，并有一条先备份、保留全部行的修复路径。
// 「旧库」由 main 等价写入器 `legacyDatabase` 构造（按 main 的 `recordObservation` 编码裸插入）；它与真 main 的一致性由
// 计划 R1 步骤 7 的一次性对照证明，因此不依赖 `origin/main`，在浅克隆的 CI 上也承重。新名字一律经 `sqlite.*` 引用：
// 文件在 base 上也能加载，每条用例各自变红，而不是整个文件加载失败。

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import * as cap from '@harness-projects/capabilities'
import * as sqlite from '@harness-projects/storage-sqlite'
import { MIGRATIONS, createSqliteStorage, migrate, openDatabase } from '@harness-projects/storage-sqlite'

async function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-source-version-upgrade-'))
  try { return await run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const [WORKSPACE, BINDING, KIND] = ['ws-1', 'binding-1', 'issue']
const T = (hour) => `2026-09-21T${String(hour).padStart(2, '0')}:00:00.000Z` // 定宽 receivedTime，同版本时的决胜键
const CANONICAL = (tail) => `2026-09-21T07:11:${tail}` // 例：CANONICAL('54.000000000Z')

/** 观察由 capabilities 的契约函数组装（dedupeKey 不许测试自己发明）；`n` 让同一主体的多条观察有不同的去重键。 */
const observation = (item, n, receivedTime, sourceVersion) => cap.makeObservation({
  subject: { bindingId: BINDING, objectKind: KIND, externalId: item, url: undefined }, type: 'issue.updated',
  eventTime: undefined, receivedTime, sourceVersion, stablePayloadFields: { n }, payload: { n },
})
const record = (...args) => ({ observation: observation(...args), state: 'processed' })

/** main 的落库形态：那时任意 ASCII 串都照常存。先按无版本组装（dedupeKey 与版本无关），再覆盖 `sourceVersion`，键序不变。 */
function insertLegacyObservation(db, { item, n, observedAt, legacy }) {
  const built = observation(item, n, observedAt, undefined)
  db.prepare('INSERT INTO sync_observation (binding_id, object_kind, object_external_id, observed_at, dedupe_key, updated_at, snapshot_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(BINDING, KIND, item, observedAt, built.dedupeKey, legacy ?? '', JSON.stringify({ observation: { ...built, sourceVersion: legacy }, state: 'processed' }), 'processed')
}

/** 一次性打开、执行、关闭。 */
function withDb(location, run) {
  const db = openDatabase(location)
  try { return run(db) } finally { db.close() }
}

/** main 等价写入器：只迁移到 `versions`，裸 SQL 写工作区与绑定，再按 main 的编码写观察（`legacy: undefined` 即无版本）。 */
const legacyDatabase = (location, versions, rows) => withDb(location, (db) => {
  migrate(db, { entries: MIGRATIONS.slice(0, versions) })
  db.prepare("INSERT INTO workspace (id, name, status_policy) VALUES (?, '工作区', 'provider_authoritative')").run(WORKSPACE)
  db.prepare("INSERT INTO provider_binding (id, implementation_key) VALUES (?, 'fake')").run(BINDING)
  db.prepare("INSERT INTO workspace_binding (workspace_id, binding_id, domain, enabled, is_default) VALUES (?, ?, 'planning', 1, 0)").run(WORKSPACE, BINDING)
  rows.forEach((row, index) => insertLegacyObservation(db, { n: index + 1, ...row }))
})

/** schema 文本与所有表的全部行（按 rowid）：用来证明「什么也没改」与「只改了这一列」。 */
function contents(db) {
  const all = (sql) => db.prepare(sql).all().map((row) => ({ ...row }))
  const schema = all("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
  return { schema, tables: Object.fromEntries(schema.filter((row) => row.type === 'table').map(({ name }) => [name, all(`SELECT * FROM ${name} ORDER BY rowid`)])) }
}
/** 库文件指纹：文件 sha256、所在目录的文件名列表（日志文件也算），以及 schema 与所有表的全部行。 */
const fingerprint = (location) => ({
  file: createHash('sha256').update(readFileSync(location)).digest('hex'), listing: readdirSync(join(location, '..')).sort(), ...withDb(location, contents),
})
const read = (location, sql) => withDb(location, (db) => db.prepare(sql).all().map((row) => ({ ...row })))
const versions = (location) => read(location, 'SELECT version FROM schema_migrations ORDER BY version').map((row) => row.version)
const updatedAt = (location) => read(location, 'SELECT updated_at FROM sync_observation ORDER BY rowid').map((row) => row.updated_at)

/** 端口写入：打开库、写一条观察、关闭，返回端口的 true / false。 */
async function write(location, ...args) {
  const storage = createSqliteStorage(location)
  try { return await storage.recordObservation(record(...args)) } finally { storage.close() }
}

/** R1-3 的不变量：每一行 `updated_at === 规范化(snapshot.observation.sourceVersion)`，无版本或不可定序记为 `''`。 */
function assertDerivedKeyInvariant(location) {
  const derive = (source) => { try { return source === undefined ? '' : cap.sourceVersionFromTimestamp(source) } catch { return '' } }
  for (const row of read(location, 'SELECT object_external_id, updated_at, snapshot_json FROM sync_observation ORDER BY rowid')) {
    assert.equal(row.updated_at, derive(JSON.parse(row.snapshot_json).observation.sourceVersion), `${row.object_external_id}：updated_at 必须由快照按唯一规则推导`)
  }
}

/** 把 `sync_observation` 退回重写前的列集合（与 storage-sync-surface.test.js 的同名辅助等价，不改那个文件）。 */
const rewriteObservationTable = (location) => withDb(location, (db) => db.exec(`PRAGMA foreign_keys = OFF; DROP VIEW committed_observation;
  DROP TABLE sync_observation; CREATE TABLE sync_observation (workspace_id TEXT NOT NULL, item_external_id TEXT NOT NULL, observed_at TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES provider_binding (id), updated_at TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','processed','ignored','failed')), PRIMARY KEY (workspace_id, item_external_id, observed_at))`))

test('U1 评审反例：旧库含 v9 时打开被拒绝，库逐字节不变，句柄不泄漏，旧清单仍能打开', async () => {
  await withTempDir((dir) => {
    const location = join(dir, 'legacy.sqlite')
    legacyDatabase(location, 4, [{ item: 'item-1', legacy: 'v9', observedAt: T(1) }])
    const before = fingerprint(location)
    assert.throws(() => createSqliteStorage(location), (error) => error instanceof sqlite.LegacySourceVersionError
      && error.code === 'legacy_source_version' && error.unorderableRows === 1 && error.samples[0].updatedAt === 'v9'
      && error.phase === 'preflight' && JSON.stringify(error.appliedVersions) === '[1,2,3,4]'
      && /库未被修改/.test(error.message) && /repairLegacySourceVersions/.test(error.message),
    '旧库含不可定序载体时必须整库拒绝，并给出结构化错误与恢复入口')
    assert.deepEqual(fingerprint(location), before, '拒绝必须零改动：文件哈希、目录列表、schema 与全部行都不变')
    const fds = readdirSync('/dev/fd').length
    for (let attempt = 1; attempt <= 5; attempt += 1) assert.throws(() => createSqliteStorage(location), (error) => error.code === 'legacy_source_version')
    assert.equal(readdirSync('/dev/fd').length, fds, '拒绝时必须关掉句柄：每次失败的打开都不得留下文件描述符')
    assert.deepEqual(withDb(location, (db) => migrate(db, { entries: MIGRATIONS.slice(0, 4) }).applied), [], '本修复之前的清单仍能打开这个未改动的库')
  })
})

test('U2 拒绝早于更早的待应用迁移：[1,2,3] 库含 v9 时 004 也不执行', async () => {
  await withTempDir((dir) => {
    const location = join(dir, 'legacy.sqlite')
    legacyDatabase(location, 3, [{ item: 'item-1', legacy: 'v9', observedAt: T(1) }])
    const before = fingerprint(location)
    assert.throws(() => createSqliteStorage(location), (error) => error instanceof sqlite.LegacySourceVersionError)
    assert.deepEqual(versions(location), [1, 2, 3], '预检必须先于任何待应用迁移：004 不得被应用')
    assert.deepEqual(fingerprint(location), before)
  })
})

test('U3 可归一的旧值被迁移并纠正定序；snapshot_json 不变', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'legacy.sqlite')
    legacyDatabase(location, 4, [
      { item: 'item-a', legacy: '2026-09-21T07:11:54Z', observedAt: T(1) },
      { item: 'item-b', legacy: '2026-09-21T07:11:55Z', observedAt: T(2) },
      // main 按码点序接受它（'15' > '07'）：已提交快照选了更早的时刻。
      { item: 'item-b', legacy: '2026-09-21T15:11:54+08:00', observedAt: T(3) },
      { item: 'item-c', legacy: undefined, observedAt: T(4) },
      { item: 'item-d', legacy: CANONICAL('54.250000000Z'), observedAt: T(5) },
    ])
    const snapshots = read(location, 'SELECT snapshot_json FROM sync_observation ORDER BY rowid')
    assert.deepEqual(withDb(location, (db) => migrate(db).applied), [5], '005 只执行一次，且是唯一待应用的迁移')
    assert.deepEqual(updatedAt(location), [CANONICAL('54.000000000Z'), CANONICAL('55.000000000Z'), CANONICAL('54.000000000Z'), '', CANONICAL('54.250000000Z')],
      '可归一的值改写为规范载体，无版本与规范值保持原样')
    assert.deepEqual(read(location, 'SELECT snapshot_json FROM sync_observation ORDER BY rowid'), snapshots, 'snapshot_json 是端口收到的原样记录，不得改写')
    const committed = read(location, "SELECT snapshot_json FROM committed_observation WHERE object_external_id = 'item-b'")
    assert.deepEqual(committed.map((row) => JSON.parse(row.snapshot_json).observation.sourceVersion), ['2026-09-21T07:11:55Z'], '纠正：item-b 的已提交快照是时间上真正最新的那一行')
    assert.equal(await write(location, 'item-a', 101, T(6), CANONICAL('54.500000000Z')), true, '归一后更新的规范观察必须被应用')
    assert.equal(await write(location, 'item-b', 102, T(6), CANONICAL('54.900000000Z')), false, '比已提交的 …55 更旧的观察仍是乱序')
    assert.equal(await write(location, 'item-c', 103, T(6), CANONICAL('54.000000000Z')), true, '无版本的旧行被任何规范观察胜过')
    assertDerivedKeyInvariant(location)
  })
})

test('U4 同一时刻的不同写法归一后是同一版本（R4 ②）', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'legacy.sqlite')
    // main 按码点序接受这个顺序（'.' < 'Z'）；反过来的顺序会被 main 拒绝。
    legacyDatabase(location, 4, [
      { item: 'item-1', legacy: '2026-09-21T07:11:54.000Z', observedAt: T(1) },
      { item: 'item-1', legacy: '2026-09-21T07:11:54Z', observedAt: T(2) },
    ])
    withDb(location, (db) => migrate(db))
    assert.deepEqual(updatedAt(location), [CANONICAL('54.000000000Z'), CANONICAL('54.000000000Z')], '同一时刻的两种写法归一为同一版本')
    assert.equal(await write(location, 'item-1', 101, T(3), CANONICAL('54.000000000Z')), true, '同版本不同去重键：整快照替换，必须返回 true')
    assertDerivedKeyInvariant(location)
  })
})

test('U5 / U7 幂等与降级拒绝：005 只执行一次且不动定义域内的行；迁移到 5 的库不能被清单只到 4 的二进制打开', async () => {
  await withTempDir((dir) => {
    withDb(join(dir, 'fresh.sqlite'), (db) => {
      assert.deepEqual(migrate(db).applied, MIGRATIONS.map((entry) => entry.version))
      assert.ok(MIGRATIONS.some((entry) => entry.version === 5 && entry.data !== undefined), '005 是带数据步骤的载体世代标记')
      assert.deepEqual(migrate(db).applied, [], '第二次运行什么也不应用')
    })
    const location = join(dir, 'legacy.sqlite')
    legacyDatabase(location, 4, [{ item: 'item-1', legacy: CANONICAL('54.000000000Z'), observedAt: T(1) }, { item: 'item-2', legacy: undefined, observedAt: T(2) }])
    const before = read(location, 'SELECT * FROM sync_observation ORDER BY rowid')
    assert.deepEqual(withDb(location, (db) => migrate(db).applied), [5])
    assert.deepEqual(read(location, 'SELECT * FROM sync_observation ORDER BY rowid'), before, '已在定义域内的库：005 不改任何一行')
    assert.throws(() => withDb(location, (db) => migrate(db, { entries: MIGRATIONS.slice(0, 4) })), /已应用版本与迁移清单不一致/, 'U7：降级写入在结构上被挡住')
  })
})

test('U6 数据步骤在事务内重新分类：预检之后才出现的旧载体使 005 回滚', async () => {
  await withTempDir((dir) => {
    const location = join(dir, 'legacy.sqlite')
    legacyDatabase(location, 4, [{ item: 'item-1', legacy: 'v9', observedAt: T(1) }])
    const before = fingerprint(location)
    const step = MIGRATIONS.find((entry) => entry.version === 5)?.data
    withDb(location, (db) => {
      db.exec('BEGIN IMMEDIATE')
      try { assert.throws(() => step.apply(db), (error) => error instanceof sqlite.LegacySourceVersionError) } finally { db.exec('ROLLBACK') }
    })
    assert.deepEqual(fingerprint(location), before, '回滚之后行不变，版本 5 不记账')
  })
})

test('U8 迁移后混入的旧载体在评审锚点行被响亮拒绝，不再静默返回 false', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    // 迁移之前就已打开库的旧进程在 005 之后继续写入旧载体：模拟成迁移到最新版本之后的裸 SQL 写入。
    legacyDatabase(location, MIGRATIONS.length, [{ item: 'item-x', legacy: 'v9', observedAt: T(1) }])
    const storage = createSqliteStorage(location)
    try {
      await assert.rejects(storage.recordObservation(record('item-x', 2, T(2), CANONICAL('54.000000000Z'))),
        (error) => error.message === sqlite.LEGACY_COMMITTED_VERSION_MESSAGE, '已提交版本不是规范载体：必须响亮失败，而不是把更新的事实当作乱序丢弃')
      assert.deepEqual(updatedAt(location), ['v9'], '被拒绝的写入不留行')
      assert.equal(await storage.recordObservation(record('item-y', 3, T(2), CANONICAL('54.000000000Z'))), true, '其他主体不受影响')
    } finally { storage.close() }
  })
})

test('U9 恢复路径：先备份并核对，再保留全部行；降为无版本后评审的反例返回 true', async () => {
  await withTempDir(async (dir) => {
    mkdirSync(join(dir, 'db')); mkdirSync(join(dir, 'bak'))
    const location = join(dir, 'db', 'legacy.sqlite')
    legacyDatabase(location, 4, [
      { item: 'item-1', legacy: 'v9', observedAt: T(1) },
      { item: 'item-2', legacy: '2026-09-21T07:11:54Z', observedAt: T(2) },
      { item: 'item-3', legacy: CANONICAL('54.000000000Z'), observedAt: T(3) },
      { item: 'item-3', legacy: 'v10', observedAt: T(4) },
    ])
    // 本地独有事实的代表：只存在于这个库里，删库重建找不回。
    withDb(location, (db) => db.prepare('INSERT INTO workspace_revision (workspace_id, revision) VALUES (?, 7)').run(WORKSPACE))
    const before = fingerprint(location)
    const ledger = before.tables.sync_observation

    // 1 备份目标已存在：拒绝，不覆盖，原库不变。
    const taken = join(dir, 'bak', 'taken.sqlite')
    writeFileSync(taken, 'not a database')
    assert.throws(() => sqlite.repairLegacySourceVersions(location, { backupPath: taken }), /已存在/)
    assert.deepEqual(fingerprint(location), before, '备份目标已存在：原库不变')
    assert.equal(readFileSync(taken, 'utf8'), 'not a database', '已存在的文件不得被覆盖')

    // 2 返回值：归一 1 行；v9 与 v10 两行被降为无版本，带定位与去重键。
    const backupPath = join(dir, 'bak', 'backup.sqlite')
    assert.deepEqual(sqlite.repairLegacySourceVersions(location, { backupPath }), { backupPath, normalized: 1, demoted: [
      { bindingId: BINDING, objectKind: KIND, externalId: 'item-1', dedupeKey: ledger[0].dedupe_key, updatedAt: 'v9' },
      { bindingId: BINDING, objectKind: KIND, externalId: 'item-3', dedupeKey: ledger[3].dedupe_key, updatedAt: 'v10' },
    ] })

    // 3 备份：完整性通过，schema 与全部行都与修复前的原库相同（包括 v9 行）。
    const backup = new DatabaseSync(backupPath, { readOnly: true })
    try {
      assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      assert.deepEqual(contents(backup), { schema: before.schema, tables: before.tables }, '备份与修复前的原库逐表逐行相同')
    } finally { backup.close() }

    // 4 活库：只有非规范行的 updated_at 变化。
    const after = withDb(location, contents)
    const strip = ({ schema, tables }) => ({ schema, tables: { ...tables, sync_observation: tables.sync_observation.map(({ updated_at, ...rest }) => rest) } })
    assert.deepEqual(strip(after), strip(before), '修复只改 updated_at：schema、其他表、其他列（含 snapshot_json 与去重键）、行数与迁移记账都不变')
    assert.deepEqual(after.tables.sync_observation.map((row) => row.updated_at), ['', CANONICAL('54.000000000Z'), CANONICAL('54.000000000Z'), ''],
      'v9 与 v10 降为无版本，…54Z 归一，规范值不动')

    // 5 重开成功（应用 005）；评审的反例在修复后返回 true。
    assert.equal(await write(location, 'item-1', 101, T(5), '2026-09-30T00:00:00.000000000Z'), true, '评审的原输入：修复后更晚的规范观察被应用')
    assert.equal(await write(location, 'item-3', 102, T(5), CANONICAL('53.000000000Z')), false, '比已提交的规范值更旧的观察仍是乱序')
    assert.deepEqual(versions(location), [1, 2, 3, 4, 5])

    // 6 幂等：没有非规范值时什么也不做，也不备份。
    const second = join(dir, 'bak', 'second.sqlite')
    assert.deepEqual(sqlite.repairLegacySourceVersions(location, { backupPath: second }), { backupPath: undefined, normalized: 0, demoted: [] })
    assert.equal(existsSync(second), false, '无事可做时不创建备份')

    // 7 逆向 SQL 还原全部原值：原始载体仍在 snapshot_json。
    withDb(location, (db) => db.exec("UPDATE sync_observation SET updated_at = coalesce(json_extract(snapshot_json, '$.observation.sourceVersion'), '')"))
    assert.deepEqual(updatedAt(location).slice(0, 4), ledger.map((row) => row.updated_at), '逆向 SQL 逐行还原修复前的 updated_at')
  })
})

test('U10 重写前 003 形状的库在任何迁移之前被拒绝', async () => {
  await withTempDir((dir) => {
    const location = join(dir, 'stale.sqlite')
    legacyDatabase(location, 3, [])
    rewriteObservationTable(location)
    const before = fingerprint(location)
    assert.throws(() => createSqliteStorage(location), /重写前的 003/)
    assert.deepEqual(versions(location), [1, 2, 3], '004 不得先于拒绝被应用')
    assert.deepEqual(fingerprint(location), before, '拒绝零改动')
  })
})

test('U11 预检后的旧写者插入：完整迁移拒绝时报告阶段与已提交版本，不误称整库未修改', async () => {
  await withTempDir((dir) => {
    const location = join(dir, 'legacy.sqlite')
    legacyDatabase(location, 3, [])
    withDb(location, (db) => {
      let inserted = false
      const wrapped = { prepare: db.prepare.bind(db), close: db.close.bind(db), exec(sql) {
        if (sql === 'BEGIN IMMEDIATE' && !inserted) {
          withDb(location, (writer) => insertLegacyObservation(writer, { item: 'late', n: 1, observedAt: T(1), legacy: 'v9' }))
          inserted = true
        }
        return db.exec(sql)
      } }
      assert.throws(() => migrate(wrapped), (error) => error instanceof sqlite.LegacySourceVersionError
        && error.phase === 'migration' && JSON.stringify(error.appliedVersions) === '[1,2,3,4]'
        && !/库未被修改/.test(error.message) && /先前已提交/.test(error.message),
      '005 回滚不撤销已提交的 004：错误必须报告实际阶段与版本，不能承诺整库零变化')
      assert.equal(inserted, true, '前置条件：第二连接确实在只读预检之后写入旧载体')
    })
    assert.deepEqual(versions(location), [1, 2, 3, 4], '004 已提交，005 未误记账')
    assert.deepEqual(updatedAt(location), ['v9'], '拒绝不丢掉迟到观察，也不自动降级其版本')
  })
})
