import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { build } from '../../apps/harness-plugin/scripts/build.mjs'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'

test('packaged migrations create schema 1-7 from a clean profile without source-tree lookup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'harness-host-package-'))
  try {
    const { packageDir, manifest } = await build({ outDir: root })
    assert.ok(manifest.files.some((file) => file.startsWith('migrations/')))
    assert.deepEqual((await readdir(path.join(packageDir, 'migrations'))).sort(), [
      '001_init.sql', '002_identity_membership.sql', '003_control_facts.sql', '004_execution_run_identity.sql',
      '005_source_version_carrier.sql', '006_delivery_facts.sql', '007_planning_sync_round.sql',
    ])
    const dbPath = path.join(root, 'clean-profile.sqlite')
    const first = createSqliteStorage(dbPath, undefined, { migrationsDir: path.join(packageDir, 'migrations') })
    first.close()
    const db = new DatabaseSync(dbPath)
    try {
      assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(({ version }) => version), [1, 2, 3, 4, 5, 6, 7])
    } finally { db.close() }
    const second = createSqliteStorage(dbPath, undefined, { migrationsDir: path.join(packageDir, 'migrations') })
    second.close()
    assert.doesNotMatch(await readFile(path.join(packageDir, 'lib/index.js'), 'utf8'), /packages\/storage\/sqlite\/migrations/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
