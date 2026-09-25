// 集成层：002 的 CHECK 取值集合与 packages 常量逐值绑定（归 Merge Gate）。DDL 字面量与枚举常量是同一事实的
// 两份存储，改一边不改另一边不会让现有用例变红（评审实测）。三条断言钉死两边：枚举值都能插入、哨兵值被
// **CHECK** 拒绝、字面量集合恰好相等。绑定表**逐列手写**：新增受 CHECK 约束的列就要加一行绑定。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CapabilityDomain } from '@harness-projects/capabilities'
import { ContentKind, EntityKind, ExternalIdentityKind, IdentityRole, MembershipContentKind, NormalizedStatus, StatusPolicy } from '@harness-projects/domain'
import { migrate, openDatabase } from '@harness-projects/storage-sqlite'

/** 枚举外的哨兵值。 */
const SENTINEL = '__not_a_domain_value__'

const CHECK_FAILURE = /CHECK constraint failed/

const CONSTRAINED_COLUMNS = [
  {
    table: 'entity', column: 'kind', values: Object.values(EntityKind),
    insert: (value) => `INSERT INTO entity VALUES ('entity-check-${value}', '${value}')`,
  },
  {
    table: 'workspace', column: 'status_policy', values: Object.values(StatusPolicy),
    insert: (value) => `INSERT INTO workspace VALUES ('ws-check-${value}', '工作区', '${value}')`,
  },
  {
    table: 'workspace_binding', column: 'domain', values: Object.values(CapabilityDomain),
    prepare: (value) => `INSERT INTO workspace VALUES ('ws-domain-${value}', '工作区', 'provider_authoritative')`,
    insert: (value) => `INSERT INTO workspace_binding VALUES ('ws-domain-${value}', 'binding-1', '${value}', 0, 0)`,
  },
  {
    table: 'external_identity', column: 'external_kind', values: Object.values(ExternalIdentityKind),
    insert: (value) => `INSERT INTO external_identity VALUES ('identity-check-${value}', 'entity-1', 'binding-1', '${value}', 'check-${value}', 'alias')`,
  },
  {
    table: 'external_identity', column: 'role', values: Object.values(IdentityRole),
    insert: (value) => `INSERT INTO external_identity VALUES ('identity-role-${value}', 'entity-1', 'binding-1', 'issue', 'role-${value}', '${value}')`,
  },
  {
    table: 'project_item_membership', column: 'content_external_kind', values: Object.values(MembershipContentKind),
    insert: (value) => `INSERT INTO project_item_membership VALUES ('ws-1', 'project-check', 'item-check-${value}', '${value}', 'content-${value}', 'x', 'x')`,
  },
  {
    table: 'workspace_projection', column: 'planning_status', values: Object.values(NormalizedStatus),
    prepare: (value) => `INSERT INTO entity VALUES ('entity-status-${value}', 'work_item')`,
    insert: (value) => `INSERT INTO workspace_projection VALUES ('ws-1', 'entity-status-${value}', '${value}', 'work_item', NULL, '正文', NULL, NULL, 1)`,
  },
  {
    table: 'workspace_projection', column: 'content_kind', values: Object.values(ContentKind),
    prepare: (value) => `INSERT INTO entity VALUES ('entity-kind-${value}', 'work_item')`,
    insert: (value) => `INSERT INTO workspace_projection VALUES ('ws-1', 'entity-kind-${value}', 'todo', '${value}', NULL, '正文', NULL, NULL, 1)`,
  },
]

/** 每个用例一个临时目录与数据库。 */
function withDatabase(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-enums-'))
  const db = openDatabase(join(dir, 'workspace.sqlite'))
  try {
    return run(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 满足全部外键的最小库。 */
function seed(db) {
  db.exec(`
    INSERT INTO workspace VALUES ('ws-1', '工作区', 'provider_authoritative');
    INSERT INTO provider_binding VALUES ('binding-1', 'fake');
    INSERT INTO workspace_binding VALUES ('ws-1', 'binding-1', 'planning', 1, 1);
    INSERT INTO entity VALUES ('entity-1', 'work_item');
  `)
}

function checkLiterals(db, table, column) {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', table)
  assert.ok(row, `${table} 不存在`)
  const match = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i').exec(row.sql)
  assert.ok(match, `${table}.${column} 缺少 CHECK (${column} IN (...)) 约束`)
  return [...match[1].matchAll(/'([^']*)'/g)].map((literal) => literal[1]).sort()
}

test('DDL 的 CHECK 取值集合与包常量逐值绑定，且每个值都能插入', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    for (const { table, column, values, prepare, insert } of CONSTRAINED_COLUMNS) {
      assert.deepEqual(checkLiterals(db, table, column), [...values].sort(),
        `${table}.${column} 的 CHECK 取值集合必须恰好等于枚举常量（多一个或少一个都变红）`)
      for (const value of values) {
        if (prepare !== undefined) db.exec(prepare(value))
        db.exec(insert(value))
      }
      if (prepare !== undefined) db.exec(prepare(SENTINEL))
      assert.throws(() => db.exec(insert(SENTINEL)), CHECK_FAILURE,
        `${table}.${column} 必须由 CHECK 拒绝枚举外的取值——被外键或唯一约束拒绝不算通过`)
    }
  })
})
