import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { build } from '../../apps/harness-plugin/scripts/build.mjs'
import { BASELINE_VERSION, MIGRATIONS, createSqliteStorage } from '@harness-projects/storage-sqlite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('packaged migrations create the single baseline schema from a clean profile without source-tree lookup', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'harness-host-package-'))
  try {
    const { packageDir, manifest } = await build({ outDir: scratch })
    assert.ok(MIGRATIONS.length > 0, 'inventory 不得为空：否则下面的派生断言会空转')
    assert.deepEqual([...MIGRATIONS], ['001_init.sql'], '物理基线必须只有一个资产')
    assert.deepEqual(manifest.files.filter((file) => file.startsWith('migrations/')).sort(),
      MIGRATIONS.map((file) => `migrations/${file}`).sort())
    assert.deepEqual((await readdir(path.join(packageDir, 'migrations'))).sort(), [...MIGRATIONS].sort())
    const dbPath = path.join(scratch, 'clean-profile.sqlite')
    const first = createSqliteStorage(dbPath, undefined, { migrationsDir: path.join(packageDir, 'migrations') })
    first.close()
    const db = new DatabaseSync(dbPath)
    try {
      assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(({ version }) => version), [BASELINE_VERSION])
      assert.equal(db.prepare('PRAGMA table_info(workspace_projection)').all().find(row => row.name === 'source_binding_id')?.notnull, 1, '打包基线也必须保存投影来源')
      assert.ok(db.prepare('PRAGMA foreign_key_list(workspace_projection)').all().some(row => row.from === 'source_binding_id' && row.table === 'provider_binding'))
    } finally { db.close() }
    const second = createSqliteStorage(dbPath, undefined, { migrationsDir: path.join(packageDir, 'migrations') })
    second.close()
    assert.doesNotMatch(await readFile(path.join(packageDir, 'lib/index.js'), 'utf8'), /packages\/storage\/sqlite\/migrations/)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('生产构建与 Host 不持有第二份 SQL 文件名清单：build.mjs 与 host.ts 没有 .sql 字面量', async () => {
  for (const file of ['apps/harness-plugin/scripts/build.mjs', 'apps/harness-plugin/src/host.ts']) {
    const source = await readFile(path.join(root, file), 'utf8')
    // 三种 JS 字符串字面量引号都要覆盖：模板字面量同样能重新引入第二份清单（独立验收 M5 实测过漏报）。
    assert.doesNotMatch(source, /(['"\x60])[0-9A-Za-z_]+\.sql\1/, `${file} 仍持有 SQL 文件名清单；唯一 inventory 只能来自 @harness-projects/storage-sqlite`)
  }
})
