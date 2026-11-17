// 集成层：SQLite 迁移运行器（见 tests/README.md §1，归 Merge Gate）。
//
// 每个用例使用自己的临时目录与数据库文件，用例之间不共享任何状态；
// 断言说明它在保护哪条不变量，而不是说明它调用了哪个函数。

import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Worker } from 'node:worker_threads'

import {
  BASELINE_VERSION,
  BUSY_TIMEOUT_MS,
  CURRENT_SCHEMA_GENERATION,
  MIGRATIONS,
  assertManifestIntegrity,
  migrate,
  openDatabase,
} from '@harness-projects/storage-sqlite'

/** 每个用例一个临时目录，结束时删除。 */
function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-migration-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** schema 内容 + 账本的快照，用来比较"重跑是否改动了任何东西"。 */
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

test('空目录上运行迁移：建库、记录单一基线版本、连接级设置生效', () => {
  withTempDir((dir) => {
    const file = join(dir, 'workspace.sqlite')
    assert.equal(existsSync(file), false, '前置条件：空目录里还没有数据库')
    withDatabase(dir, (db) => {
      const result = migrate(db)
      assert.deepEqual(result.applied, [BASELINE_VERSION], '空库必须只记一个逻辑基线版本')
      assert.equal(result.version, BASELINE_VERSION, '首建报告的版本就是基线版本')
      assert.deepEqual(appliedVersions(db), [BASELINE_VERSION], 'schema_migrations 必须恰好一行且等于基线版本')
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, '外键约束必须打开')
      assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, BUSY_TIMEOUT_MS)
    })
    assert.equal(existsSync(file), true, '空目录上运行后数据库文件必须存在')
  })
})

test('第二次运行是幂等的：schema、账本与文件字节都不变', () => {
  withTempDir((dir) => {
    const file = join(dir, 'workspace.sqlite')
    withDatabase(dir, (db) => {
      const first = migrate(db)
      const before = snapshot(db)
      const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex')
      const bytes = digest()
      const second = migrate(db)
      assert.deepEqual(second.applied, [], '重跑不得再应用任何迁移')
      assert.equal(second.version, BASELINE_VERSION, '重跑必须报告同一基线版本')
      assert.equal(snapshot(db), before, '重跑必须不改动 schema，也不新增版本记录')
      assert.equal(digest(), bytes, '重跑必须不改动数据库文件字节')
      assert.equal(first.version, second.version)
    })
  })
})

test('双 Worker 屏障同时打开空库：只有一个进程初始化完整链，账本只有一行基线', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storage-concurrent-'))
  const module = new URL('../../packages/storage/sqlite/src/index.ts', import.meta.url).href
  const workers = [0, 1].map(() => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.module).then(({ openDatabase, migrate }) => {
      const db = openDatabase(workerData.file);
      parentPort.once('message', () => {
        try { parentPort.postMessage(migrate(db)) } finally { db.close() }
      });
      parentPort.postMessage('ready');
    });
  `, { eval: true, workerData: { module, file: join(dir, 'workspace.sqlite') } }))
  const next = (worker) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker barrier timeout')), 15000)
    worker.once('message', (value) => { clearTimeout(timer); resolve(value) })
    worker.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
  try {
    assert.deepEqual(await Promise.all(workers.map(next)), ['ready', 'ready'])
    const results = workers.map(next)
    workers.forEach((worker) => worker.postMessage('go'))
    const applied = (await Promise.all(results)).map((result) => result.applied).sort((a, b) => a.length - b.length)
    assert.deepEqual(applied, [[], [BASELINE_VERSION]])
    withDatabase(dir, (db) => {
      assert.deepEqual(appliedVersions(db), [BASELINE_VERSION])
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, CURRENT_SCHEMA_GENERATION)
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    })
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); rmSync(dir, { recursive: true, force: true }) }
})

test('清单自检拦住空清单、重复文件名与缺失文件', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, '001_init.sql'), 'SELECT 1;\n')
    writeFileSync(join(dir, '002_next.sql'), 'SELECT 1;\n')
    assert.doesNotThrow(() => assertManifestIntegrity(['001_init.sql', '002_next.sql'], dir), '正例不得误报')
    assert.doesNotThrow(() => assertManifestIntegrity(), '包内真实清单必须自检通过')
    assert.throws(() => assertManifestIntegrity([], dir), /清单为空/, '空清单必须在应用任何迁移之前显式失败')
    assert.throws(() => assertManifestIntegrity(['001_init.sql', '001_init.sql'], dir), /重复/)
    assert.throws(() => assertManifestIntegrity(['missing.sql'], dir), /缺失/)
    assert.throws(() => assertManifestIntegrity([''], dir), /文件名/)
  })
})

test('包内清单是有序的非空文件名数组：空库按清单顺序建全部 schema', () => {
  assert.ok(MIGRATIONS.length > 0)
  for (const file of MIGRATIONS) assert.match(file, /\.sql$/)
  withTempDir((dir) => withDatabase(dir, (db) => {
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    assert.ok(tables.includes('planning_sync_round'), '清单最后一份资产（007）必须已应用')
    assert.deepEqual(appliedVersions(db), [BASELINE_VERSION])
  }))
})
