// 集成层：SQLite 迁移运行器（见 tests/README.md §1，归 Merge Gate）。
//
// 每个用例使用自己的临时目录与数据库文件，用例之间不共享任何状态；
// 断言说明它在保护哪条不变量，而不是说明它调用了哪个函数。

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BUSY_TIMEOUT_MS,
  MIGRATIONS,
  assertManifestIntegrity,
  migrate,
  openDatabase,
} from '@harness-projects/storage-sqlite'

/** 真值来自包内迁移体本身，避免测试里复制一份会漂移的 DDL。 */
const REAL_INIT_SQL = fileURLToPath(
  new URL('../../packages/storage/sqlite/migrations/001_init.sql', import.meta.url),
)

/** 每个用例一个临时目录，结束时删除。 */
function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-migration-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** schema 内容 + 版本记录的快照，用来比较"重跑是否改动了任何东西"。 */
function snapshot(db) {
  return JSON.stringify({
    schema: db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(),
    versions: db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(),
  })
}

function appliedVersions(db) {
  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => row.version)
}

function withDatabase(dir, run) {
  const db = openDatabase(join(dir, 'workspace.sqlite'))
  try {
    return run(db)
  } finally {
    db.close()
  }
}

test('空目录上运行迁移：建库、记录版本、连接级设置生效', () => {
  withTempDir((dir) => {
    const file = join(dir, 'workspace.sqlite')
    assert.equal(existsSync(file), false, '前置条件：空目录里还没有数据库')
    withDatabase(dir, (db) => {
      const result = migrate(db)
      assert.deepEqual(
        result.applied,
        MIGRATIONS.map((entry) => entry.version),
        '空库必须应用清单里的全部迁移',
      )
      assert.equal(result.version, result.applied.at(-1))
      assert.deepEqual(appliedVersions(db), result.applied, 'schema_migrations 必须记录已应用版本')
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, '外键约束必须打开')
      assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, BUSY_TIMEOUT_MS)
    })
    assert.equal(existsSync(file), true, '空目录上运行后数据库文件必须存在')
  })
})

test('第二次运行是幂等的：schema 内容与版本都不变', () => {
  withTempDir((dir) => {
    withDatabase(dir, (db) => {
      const first = migrate(db)
      const before = snapshot(db)
      const second = migrate(db)
      assert.deepEqual(second.applied, [], '重跑不得再应用任何迁移')
      assert.equal(second.version, first.version, '重跑必须报告同一版本')
      assert.equal(snapshot(db), before, '重跑必须不改动 schema，也不新增版本记录')
    })
  })
})

/**
 * 让清单在被切片/遍历时确定性地触发一次回调，用来插桩"后到者读完版本、尚未执行 DDL"
 * 的时序点。
 *
 * 同步 SQLite 无法在单线程里真的让两个 migrate 并行，但并发启动的真实交错是可复现的：
 * 清单的 slice 访问必然发生在"读取已应用版本"之后、"执行任何 DDL"之前；第二次遍历
 * 作为兜底插桩点，条件相同。
 */
function withInterleave(entries, interleave) {
  let fired = false
  let iterations = 0
  const fire = () => {
    if (fired) return
    fired = true
    interleave()
  }
  return new Proxy(entries, {
    get(target, property) {
      if (property === 'slice') fire()
      if (property === Symbol.iterator) {
        iterations += 1
        if (iterations > 1) fire()
      }
      return Reflect.get(target, property, target)
    },
  })
}

test('两连接交错启动：后到者重读已提交版本后跳过，DDL 只执行一次', () => {
  withTempDir((dir) => {
    const migrationsDir = join(dir, 'migrations')
    mkdirSync(migrationsDir)
    writeFileSync(join(migrationsDir, '001_init.sql'), readFileSync(REAL_INIT_SQL, 'utf8'))
    // 版本 2 的副作用可观测：重复执行会让 ddl_probe 多出一行。
    writeFileSync(
      join(migrationsDir, '002_probe.sql'),
      'CREATE TABLE IF NOT EXISTS ddl_probe (id INTEGER PRIMARY KEY);\n' +
        'INSERT INTO ddl_probe (id) VALUES (1);\n',
    )
    const entries = [
      { version: 1, file: '001_init.sql' },
      { version: 2, file: '002_probe.sql' },
    ]

    const file = join(dir, 'workspace.sqlite')
    const early = openDatabase(file)
    const late = openDatabase(file)
    try {
      let earlyResult
      // 交错时序：late 先读到"空库"，随后 early 完整迁移并提交，late 才继续执行。
      // 事务外读版本的实现会拿着陈旧的"空库"结论重复执行 DDL；事务内重读的实现在
      // BEGIN IMMEDIATE 之后看到 [1, 2]，于是跳过。
      const lateResult = migrate(late, {
        entries: withInterleave(entries, () => {
          earlyResult = migrate(early, { entries, dir: migrationsDir })
        }),
        dir: migrationsDir,
      })

      assert.deepEqual(earlyResult.applied, [1, 2], '先到者必须应用全部缺失迁移')
      assert.deepEqual(lateResult.applied, [], '后到者不得重复应用已被并发提交的版本')
      assert.equal(lateResult.version, earlyResult.version, '两个连接看到的最终版本必须一致')
      assert.deepEqual(appliedVersions(early), appliedVersions(late), '两连接的版本记录必须一致')
      assert.equal(
        late.prepare('SELECT COUNT(*) AS n FROM ddl_probe').get().n,
        1,
        '同一段 DDL 只允许执行一次',
      )
    } finally {
      early.close()
      late.close()
    }
  })
})

test('抛错的迁移不留下版本记录，半写状态一并回滚', () => {
  withTempDir((dir) => {
    const migrationsDir = join(dir, 'migrations')
    mkdirSync(migrationsDir)
    writeFileSync(join(migrationsDir, '001_init.sql'), readFileSync(REAL_INIT_SQL, 'utf8'))
    writeFileSync(
      join(migrationsDir, '002_boom.sql'),
      'CREATE TABLE half_written (id INTEGER PRIMARY KEY);\nTHIS IS NOT VALID SQL;\n',
    )
    const entries = [
      { version: 1, file: '001_init.sql' },
      { version: 2, file: '002_boom.sql' },
    ]
    withDatabase(dir, (db) => {
      assert.throws(() => migrate(db, { entries, dir: migrationsDir }))
      assert.deepEqual(appliedVersions(db), [1], '失败的迁移不得写入版本记录')
      const halfWritten = db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'half_written'")
        .get()
      assert.equal(halfWritten, undefined, '失败迁移的半写状态必须回滚')
    })
  })
})

test('清单自检拦住重复版本、不递增的版本与缺失文件', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, '001_init.sql'), 'SELECT 1;\n')
    writeFileSync(join(dir, '002_next.sql'), 'SELECT 1;\n')
    const first = { version: 1, file: '001_init.sql' }
    const second = { version: 2, file: '002_next.sql' }
    assert.doesNotThrow(() => assertManifestIntegrity([first, second], dir), '正例不得误报')
    assert.doesNotThrow(() => assertManifestIntegrity(), '包内真实清单必须自检通过')
    assert.throws(() => assertManifestIntegrity([first, first], dir), /重复/)
    assert.throws(() => assertManifestIntegrity([second, first], dir), /递增/)
    assert.throws(() => assertManifestIntegrity([{ version: 1, file: 'missing.sql' }], dir), /缺失/)
  })
})
