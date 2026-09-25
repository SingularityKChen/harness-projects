// L3 集成层：003 控制事实 schema、R4/R5/R6/R8 与 D8 出处映射。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { RelationSource } from '@harness-projects/domain'
import { MIGRATIONS, migrate, openDatabase } from '@harness-projects/storage-sqlite'

// 每张表期望出现在**它自己的**出处注释里的 token 集合（D8）。
// 只断言"注释里有 R1..R8 之一"没有判别力：把两张表的出处对调、或把出处改成无关的 R 编号仍然全绿（L3 复验实测）。
const TABLE_PROVENANCE = {
  repository: ['AGENTS.md §1.1', 'Batch L3-A'],
  execution_context: ['AGENTS.md §1.1', 'Batch L3-A'],
  execution_run: ['release-gates.md R1', 'Batch L3-A'],
  relation: ['AGENTS.md §1.1', 'Batch L3-A'],
  candidate_relation: ['AGENTS.md §1.1'],
  sync_observation: ['R4'],
  sync_cursor: ['Batch L3-A'],
  reconcile_cursor: ['R5'],
  webhook_subscription: ['R6'],
  mutation_attempt: ['R8'],
  workspace_revision: ['AGENTS.md §1.1'],
}
// 出处 token 的完整词表：裁决的 R1…R8、AGENTS.md §1.1 不变量、发布门禁 R1 的逐条引用、本层计划的批次节。
// `release-gates.md R1` 是独立 token：编号漂移把"Start Work 失败恢复"从 AGENTS.md §9 挪到了发布门禁 R1 第 10 项。
const ALLOWED_TOKENS = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'AGENTS.md §1.1', 'release-gates.md R1', 'Batch L3-A', 'Batch L3-B'])
const TOKEN_PATTERN = /release-gates\.md R1|AGENTS\.md §1\.1|Batch L3-[AB]|R[1-8]/g
const literal = (token) => new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const MIGRATION_FILE = fileURLToPath(new URL('../../packages/storage/sqlite/migrations/003_control_facts.sql', import.meta.url))
const allTables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
const columns = (db, table) => db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY name').all(table).map((row) => row.name)
const fkTables = (db, table) => db.prepare('SELECT "table" AS target FROM pragma_foreign_key_list(?)').all(table).map((row) => row.target)
const rejects = (db, sql, expected) => assert.throws(() => db.exec(sql), expected)
function withDatabase(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-control-')); const db = openDatabase(join(dir, 'workspace.sqlite'))
  try { return run(db) } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
}
function seed(db) {
  db.exec(`INSERT INTO workspace VALUES ('ws-1','工作区','provider_authoritative');
    INSERT INTO workspace VALUES ('ws-2','工作区 2','provider_authoritative');
    INSERT INTO provider_binding VALUES ('binding-1','fake');
    INSERT INTO provider_binding VALUES ('binding-2','fake');
    INSERT INTO provider_binding VALUES ('binding-3','fake');
    INSERT INTO workspace_binding VALUES ('ws-1','binding-1','planning',1,1);
    INSERT INTO workspace_binding VALUES ('ws-1','binding-2','development',1,1);
    INSERT INTO entity VALUES ('entity-1','work_item'); INSERT INTO entity VALUES ('entity-2','repository');
    INSERT INTO external_identity VALUES ('identity-1','entity-2','binding-1','issue','repo-1','primary');
    INSERT INTO repository VALUES ('repo-1','ws-1','identity-1');
    INSERT INTO project_item_membership VALUES ('ws-1','project-1','item-1','issue','issue-1','x','x');
    INSERT INTO execution_context VALUES ('context-1','ws-1','entity-1','repo-1','ready',NULL,NULL,NULL);`)
}

test('空库建出 L3 十一张表，二次运行是 no-op', () => withDatabase((db) => {
  assert.deepEqual(migrate(db).applied, MIGRATIONS.map((entry) => entry.version))
  assert.deepEqual(allTables(db), [...Object.keys(TABLE_PROVENANCE), 'entity', 'external_identity', 'planning_field_value', 'project_item_membership', 'provider_binding', 'schema_migrations', 'workspace', 'workspace_binding', 'workspace_projection'].sort())
  const before = JSON.stringify(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all())
  assert.deepEqual(migrate(db).applied, []); assert.equal(JSON.stringify(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()), before)
}))

test('D8：每张表的出处注释带该表期望的 token，且全文 token 均可解析', () => withDatabase((db) => {
  const sql = readFileSync(MIGRATION_FILE, 'utf8')
  // 全文扫描：表注释、索引注释与视图注释里的出处 token 都必须落在白名单内（覆盖 release-gates.md R1 这类引用）。
  const found = sql.match(TOKEN_PATTERN) ?? []
  assert.ok(found.length > 0, '003 里没有任何可解析的出处 token')
  for (const token of found) assert.ok(ALLOWED_TOKENS.has(token), `出处 token 不在白名单里：${token}`)
  // 逐表断言期望 token 出现在**该表自己的**出处注释里——这是 D8 追溯性唯一的机器证据。
  for (const [table, expected] of Object.entries(TABLE_PROVENANCE)) {
    assert.ok(expected.length > 0, `${table} 没有期望 token`)
    const comment = sql.split('\n').find((line) => line.startsWith(`-- ${table}：`))
    assert.ok(comment, `${table} 缺出处注释`)
    for (const token of expected) {
      assert.ok(ALLOWED_TOKENS.has(token), `${table} 的期望 token 不在白名单里：${token}`)
      assert.match(comment, literal(token), `${table} 的出处注释缺 ${token}：${comment}`)
    }
  }
  assert.deepEqual(allTables(db), [])
  migrate(db)
  const actual = allTables(db).filter((name) => !['schema_migrations','workspace','provider_binding','workspace_binding','entity','external_identity','project_item_membership','planning_field_value','workspace_projection'].includes(name))
  assert.deepEqual(actual, Object.keys(TABLE_PROVENANCE).sort())
}))

test('R4：账本主体是端口主体（绑定 + 对象种类 + 对象 id），定序规则写入出处注释', () => withDatabase((db) => {
  migrate(db); seed(db)
  assert.deepEqual(columns(db, 'sync_observation'), ['binding_id','dedupe_key','object_external_id','object_kind','observed_at','snapshot_json','state','updated_at'])
  const sql = readFileSync(MIGRATION_FILE, 'utf8'); assert.match(sql, /updated_at 更小者拒绝/); assert.match(sql, /相等时整快照替换/)
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-1','t','k1','v2','{\"x\":2}','processed')")
  // 判别性（2026-09-24 评审）：同主体、同接收时刻的两条**不同**观察必须并存——旧主键（主体+接收时刻）会把后一条顶掉，
  // 账本永久丢一条，前一条再投递还会第二次返回 true，调用方据此重放副作用。
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-1','t','k2','v1','{\"x\":1}','processed')")
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_observation').get().n, 2, 'dedupe_key 在主键里：同接收时刻的不同观察并存')
  // 端口的去重键是 (bindingId, dedupeKey)：库级唯一，同一观察物理上不可能落两行。
  rejects(db, "INSERT INTO sync_observation VALUES ('binding-1','issue','issue-2','t9','k1','v9','{}','pending')", /UNIQUE constraint failed: sync_observation/)
  // 主体不含条目 id 与工作区：账本是连接级事实，条目 id 是会被改写的当前挂载点。
  assert.equal(columns(db, 'sync_observation').includes('item_external_id'), false, '条目 id 不得进账本身份键')
  assert.equal(columns(db, 'sync_observation').includes('workspace_id'), false, '账本作用域是连接，不是工作区')
}))

test('R4：观察可以先于成员关系落账，成员关系被改写也不动账本', () => withDatabase((db) => {
  migrate(db); seed(db)
  // 判别性（2026-09-24 评审）：对账先到、成员关系后到必须能记账——旧主体要求成员关系存在，这条路径在端口上抛错。
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-orphan','t1','k1','v1','{}','processed')")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_observation WHERE object_external_id='issue-orphan'").get().n, 1, '没有成员关系也能记账')
  assert.equal(fkTables(db, 'sync_observation').includes('project_item_membership'), false, '账本不得以外键引用成员关系')
  // "换条目" = 成员关系被改写或消失；账本行必须活着——行一旦会被删，同一观察的第二次投递就会重新返回 true，
  // 调用方据此重放副作用（这正是 003 去掉这条外键的判据）。
  db.exec("DELETE FROM project_item_membership WHERE workspace_id='ws-1' AND item_external_id='item-1'")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_observation").get().n, 1, '成员关系消失后账本行仍在')
}))

test('R5：对账游标列集合恰好声明集合且 workspace 唯一', () => withDatabase((db) => {
  migrate(db); seed(db); assert.deepEqual(columns(db, 'reconcile_cursor'), ['last_reconciled_at','workspace_id'])
  db.exec("INSERT INTO reconcile_cursor VALUES ('ws-1','now')")
  rejects(db, "INSERT INTO reconcile_cursor VALUES ('ws-1','later')", /UNIQUE constraint failed: reconcile_cursor\.workspace_id/)
  db.exec("UPDATE reconcile_cursor SET last_reconciled_at='later' WHERE workspace_id='ws-1'")
  assert.equal(db.prepare("SELECT last_reconciled_at FROM reconcile_cursor WHERE workspace_id='ws-1'").get().last_reconciled_at, 'later')
}))

test('R6：字段值与成员关系没有 webhook_subscription 外键', () => withDatabase((db) => {
  migrate(db); assert.equal(fkTables(db, 'planning_field_value').includes('webhook_subscription'), false); assert.equal(fkTables(db, 'project_item_membership').includes('webhook_subscription'), false)
}))

test('R8：写尝试一行一键，写入是幂等覆盖，id 在工作区内唯一', () => withDatabase((db) => {
  migrate(db); seed(db)
  const check = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='mutation_attempt'").get().sql
  // 词表恰好等于 domain 的 WriteState（不先 filter：多一个取值必须变红）。
  assert.deepEqual([...check.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort(), ['conflict','failed','pending','saved','unknown'])
  const insert = "INSERT INTO mutation_attempt VALUES ('ws-1','content-1','write-1','binding-1','addItem',?,NULL,NULL,'x','x')"
  db.exec(insert.replace('?', "'unknown'"))
  // 一行一键：同 (工作区, 幂等键) 的第二行被主键拒绝；状态经 UPDATE 原地推进（这正是端口与 core 的模型）。
  rejects(db, "INSERT INTO mutation_attempt VALUES ('ws-1','content-1','write-2','binding-1','addItem','saved',NULL,NULL,'x','x')", /UNIQUE constraint failed: mutation_attempt/)
  db.exec("UPDATE mutation_attempt SET state='saved' WHERE workspace_id='ws-1' AND idempotency_key='content-1'")
  assert.deepEqual(db.prepare("SELECT state FROM mutation_attempt WHERE idempotency_key='content-1'").all().map((r) => r.state), ['saved'], '同键只有一行，状态原地推进')
  // failed 允许重试 = 同键可以被写回 pending（不是落第二行）。
  db.exec("UPDATE mutation_attempt SET state='failed' WHERE idempotency_key='content-1'")
  db.exec("UPDATE mutation_attempt SET state='pending' WHERE idempotency_key='content-1'")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mutation_attempt").get().n, 1, '重试不产生第二行')
  // id 在工作区内唯一：同一工作区两条不同键用同一个 id 必须被拒绝（core 的派生 id 不含工作区维度）。
  db.exec("INSERT INTO mutation_attempt VALUES ('ws-1','content-2','write-9','binding-1','addItem','pending',NULL,NULL,'x','x')")
  rejects(db, "INSERT INTO mutation_attempt VALUES ('ws-1','content-3','write-9','binding-1','addItem','pending',NULL,NULL,'x','x')", /UNIQUE constraint failed: mutation_attempt/)
  // 跨工作区同键同 id 必须被接受：幂等键由调用方给出，作用域是工作区。
  db.exec("INSERT INTO mutation_attempt VALUES ('ws-2','content-1','write-1','binding-1','addItem','pending',NULL,NULL,'x','x')")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mutation_attempt WHERE idempotency_key='content-1'").get().n, 2, '同一幂等键在两个工作区各有一行')
}))

test('R4：committed_observation 的主体与端口 subject 逐字相同，每个主体只给最新的一行', () => withDatabase((db) => {
  migrate(db); seed(db)
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-1','t1','k1','2026-09-21T07:11:54Z','{\"v\":2}','processed')")
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-1','t2','k2','2026-09-21T07:10:00Z','{\"v\":1}','processed')")
  // 主体含 binding_id：两个绑定观察同一内容时各有一行 committed（AGENTS.md §1.1 不变量 2 允许一个工作区连多个提供方）。
  db.exec("INSERT INTO sync_observation VALUES ('binding-2','issue','issue-1','t9','k3','2026-09-21T07:12:00Z','{\"v\":3}','processed')")
  const subjects = db.prepare("SELECT binding_id, updated_at FROM committed_observation ORDER BY binding_id").all().map((row) => ({ ...row }))
  assert.deepEqual(subjects, [{ binding_id: 'binding-1', updated_at: '2026-09-21T07:11:54Z' }, { binding_id: 'binding-2', updated_at: '2026-09-21T07:12:00Z' }], '主体 = 端口 subject，两个绑定各有一行 committed')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM committed_observation WHERE binding_id='binding-1'").get().n, 1, '每个主体只有一行 committed：旧行永远不是 committed')
  // 同版本时取 observed_at 最新的一行（R4 的"相等时整快照替换"）。
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-1','t3','k4','2026-09-21T07:11:54Z','{\"v\":22}','processed')")
  assert.equal(db.prepare("SELECT snapshot_json FROM committed_observation WHERE binding_id='binding-1'").get().snapshot_json, '{"v":22}')
  // 版本载体缺失落空串：空串小于任何合法载体，因此它永远不是 committed（读回时由端口还原成 undefined）。
  db.exec("INSERT INTO sync_observation VALUES ('binding-3','issue','issue-1','t4','k5','','{\"v\":0}','processed')")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM committed_observation WHERE binding_id='binding-3'").get().n, 1, '只有一条时它就是 committed')
  db.exec("INSERT INTO sync_observation VALUES ('binding-3','issue','issue-1','t5','k6','2026-09-21T07:13:00Z','{\"v\":9}','processed')")
  assert.equal(db.prepare("SELECT updated_at FROM committed_observation WHERE binding_id='binding-3'").get().updated_at, '2026-09-21T07:13:00Z', '空串编码必须小于任何合法载体')
  // 定序主体是三元组（第五轮评审）：同一 binding 下另一个对象的更旧版本、同 id 不同种类，都各自是 committed，互不遮蔽。
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','issue','issue-2','t6','k7','2026-09-21T07:00:00Z','{\"v\":5}','processed')")
  db.exec("INSERT INTO sync_observation VALUES ('binding-1','draft','issue-1','t7','k8','2026-09-21T07:00:00Z','{\"v\":6}','processed')")
  assert.deepEqual(db.prepare("SELECT object_kind, object_external_id FROM committed_observation WHERE binding_id='binding-1' ORDER BY object_kind, object_external_id").all()
    .map((row) => `${row.object_kind}/${row.object_external_id}`), ['draft/issue-1', 'issue/issue-1', 'issue/issue-2'], '主体的三个维度缺任何一个，都会有一行被遮蔽')
}))

test('不变量 5：两张关系表的 source 词表恰好是 domain 的 RelationSource（候选表去掉 explicit），LLM 进不了关系语义', () => withDatabase((db) => {
  migrate(db)
  const vocabulary = (table) => [...db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql.match(/source TEXT NOT NULL CHECK \(source IN \(([^)]*)\)\)/)[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
  assert.deepEqual(vocabulary('relation'), Object.values(RelationSource).sort(), '多一个取值（例如 llm）必须变红')
  assert.deepEqual(vocabulary('candidate_relation'), Object.values(RelationSource).filter((value) => value !== RelationSource.Explicit).sort(), '显式关系不进候选表')
}))

test('已钉住的约束变异：每条拒绝用例只因目标约束失败，且匹配该约束的错误文本（未钉住的见 #201）', () => withDatabase((db) => {
  migrate(db); seed(db)
  // relation_class CHECK（两张表）
  rejects(db, "INSERT INTO relation VALUES ('ws-1','entity-1','entity-2','depends_on','bogus','explicit','confirmed')", /CHECK constraint failed: relation_class/)
  rejects(db, "INSERT INTO candidate_relation VALUES ('ws-1','entity-1','entity-2','depends_on','bogus','deterministic','candidate')", /CHECK constraint failed: relation_class/)
  // state CHECK：候选表恒为 candidate；观察账本、同步游标、执行上下文的词表都按 domain 完整列出
  rejects(db, "INSERT INTO candidate_relation VALUES ('ws-1','entity-1','entity-2','depends_on','business_semantics','deterministic','confirmed')", /CHECK constraint failed: state = 'candidate'/)
  rejects(db, "INSERT INTO sync_observation VALUES ('binding-1','issue','issue-9','t9','k9','v9','{}','bogus')", /CHECK constraint failed: state IN \('pending','processed','ignored','failed'\)/)
  rejects(db, "INSERT INTO sync_cursor VALUES ('binding-1','scope-9','c','bogus',NULL)", /CHECK constraint failed: state IN \('idle','syncing','healthy','degraded','failed'\)/)
  rejects(db, "INSERT INTO execution_context VALUES ('context-9','ws-1','entity-1','repo-1','bogus',NULL,NULL,NULL)", /CHECK constraint failed: status IN \('planned','provisioning','ready','closed','failed'\)/)
  // 部分索引 execution_context_active 的 WHERE：active 状态被覆盖，closed 不被覆盖（去掉 WHERE 会让下面这条变红）
  rejects(db, "INSERT INTO execution_context VALUES ('context-2','ws-1','entity-1','repo-1','provisioning',NULL,NULL,NULL)", /UNIQUE constraint failed: execution_context\.workspace_id, execution_context\.work_item_id, execution_context\.repository_id/)
  db.exec("INSERT INTO execution_context VALUES ('context-3','ws-1','entity-1','repo-1','closed',NULL,NULL,NULL)")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM execution_context WHERE status='closed'").get().n, 1, 'closed 不在部分索引的 WHERE 里，可与 active 上下文并存')
  // webhook_subscription 的唯一键含 workspace_id（ADR-0006：订阅是工作区级事实）
  db.exec("INSERT INTO webhook_subscription VALUES ('wh-1','ws-1','binding-1','scope-1','issues',1)")
  rejects(db, "INSERT INTO webhook_subscription VALUES ('wh-2','ws-1','binding-1','scope-1','issues',1)", /UNIQUE constraint failed: webhook_subscription\.workspace_id, webhook_subscription\.binding_id, webhook_subscription\.scope_key, webhook_subscription\.event_name/)
  db.exec("INSERT INTO webhook_subscription VALUES ('wh-3','ws-2','binding-1','scope-1','issues',1)")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM webhook_subscription").get().n, 2, '同一连接在两个工作区各自订阅（旧的三列唯一键会让先写的工作区占位）')
  // binding_id 外键：观察账本、同步游标、订阅都必须挂在存在的连接锚点上
  rejects(db, "INSERT INTO sync_observation VALUES ('binding-none','issue','issue-1','t1','k1','v1','{}','pending')", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO sync_cursor VALUES ('binding-none','scope-1','c','idle',NULL)", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO webhook_subscription VALUES ('wh-4','ws-1','binding-none','scope-1','issues',1)", /FOREIGN KEY constraint failed/)
}))

test('关系候选分表、执行 active 唯一、修订删除实体不倒退，外键目标均存在', () => withDatabase((db) => {
  migrate(db); seed(db)
  const known = new Set(allTables(db)); for (const table of known) for (const target of fkTables(db, table)) assert.ok(known.has(target))
  rejects(db, "INSERT INTO relation VALUES ('ws-1','entity-1','entity-2','depends_on','business_semantics','deterministic','candidate')", /CHECK constraint failed: state = 'confirmed'/)
  db.exec("INSERT INTO candidate_relation VALUES ('ws-1','entity-1','entity-2','depends_on','business_semantics','deterministic','candidate')")
  // 端口按 state 路由：候选升为 confirmed 时进 relation 表（source 保留 deterministic），候选行由端口删除（SQLite 实现在 L6 接入；本用例只对 DDL 断言）。
  db.exec("INSERT INTO relation VALUES ('ws-1','entity-1','entity-2','depends_on','business_semantics','deterministic','confirmed')")
  db.exec("DELETE FROM candidate_relation WHERE workspace_id='ws-1' AND from_entity_id='entity-1' AND to_entity_id='entity-2' AND relation_type='depends_on'")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate_relation").get().n, 0, '候选行必须消失')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM relation WHERE state='confirmed'").get().n, 1, '确定性候选升为 confirmed 必须能落库')
  // 判别性（2026-09-24 评审）：这些约束此前没有任何只因它失败的用例。
  rejects(db, "INSERT INTO relation VALUES ('ws-1','ghost-a','entity-2','depends_on','business_semantics','explicit','confirmed')", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO relation VALUES ('ws-1','entity-1','ghost-b','depends_on','business_semantics','explicit','confirmed')", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO relation VALUES ('ghost-ws','entity-1','entity-2','depends_on','business_semantics','explicit','confirmed')", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO candidate_relation VALUES ('ws-1','entity-1','entity-2','depends_on','business_semantics','explicit','candidate')", /CHECK constraint failed/)
  rejects(db, "INSERT INTO mutation_attempt VALUES ('ws-1','k1','w1','binding-none','addItem','pending',NULL,NULL,'x','x')", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO mutation_attempt VALUES ('ws-1',NULL,'w1','binding-1','addItem','pending',NULL,NULL,'x','x')", /NOT NULL constraint failed/)
  rejects(db, "INSERT INTO mutation_attempt VALUES ('ws-1','k1','w1','binding-1','addItem','bogus',NULL,NULL,'x','x')", /CHECK constraint failed/)
  rejects(db, "INSERT INTO execution_context VALUES ('context-2','ws-1','entity-1','repo-1','planned',NULL,NULL,NULL)", /UNIQUE constraint failed/)
  // 部分索引的 WHERE 只覆盖 active 状态：去掉 WHERE 会让下面这条 closed 插入变红（部分性由"closed 可并存"钉住）。
  rejects(db, "INSERT INTO execution_context VALUES ('context-2b','ws-1','entity-1','repo-1','provisioning',NULL,NULL,NULL)", /UNIQUE constraint failed: execution_context\.workspace_id, execution_context\.work_item_id, execution_context\.repository_id/)
  db.exec("INSERT INTO execution_context VALUES ('context-2c','ws-1','entity-1','repo-1','closed',NULL,NULL,NULL)")
  // 工作区作用域经复合外键传递：仓库属于另一个工作区时必须被拒绝（不变量 5）。
  db.exec("INSERT INTO repository VALUES ('repo-2','ws-2','identity-1')")
  rejects(db, "INSERT INTO execution_context VALUES ('context-3','ws-1','entity-1','repo-2','planned',NULL,NULL,NULL)", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO execution_run VALUES ('run-2','ws-2','context-1','running','now')", /FOREIGN KEY constraint failed/)
  rejects(db, "INSERT INTO webhook_subscription VALUES ('wh-2','ws-1','binding-1','s','issues',2)", /CHECK constraint failed/)
  db.exec("INSERT INTO workspace_revision VALUES ('ws-1',4)")
  rejects(db, "INSERT INTO workspace_revision VALUES ('ws-2',-1)", /CHECK constraint failed/)
  assert.equal(db.prepare("SELECT revision FROM workspace_revision WHERE workspace_id='ws-1'").get().revision, 4)
  // 单调增长是端口职责（见迁移注释与契约套件的修订号用例）；库层只保证非负，这里断言的就是这一条。
}))

test('003 显式 schema 审查：十一张表的 63 列全部在白名单内，没有列能存凭据材料', () => withDatabase((db) => {
  migrate(db)
  // 逐列白名单（与 L2 的 `identity-membership-schema.test.js` 同形）：与 `pragma_table_info` **互相覆盖**，
  // 多一列、少一列都失败——新增列必须同步写进这里，否则这份审查只是声明。
  const AUDITED = {
    'repository.external_identity_id': '标识', 'repository.id': '标识', 'repository.workspace_id': '标识',
    'execution_context.branch_external_id': '平台原样值', 'execution_context.id': '标识',
    'execution_context.provisioning_started_at': '时间戳', 'execution_context.repository_id': '标识',
    'execution_context.status': '枚举：执行上下文状态', 'execution_context.work_item_id': '标识',
    'execution_context.workspace_id': '标识', 'execution_context.worktree_external_id': '平台原样值',
    'execution_run.context_id': '标识', 'execution_run.id': '标识', 'execution_run.status': '枚举：运行状态',
    'execution_run.updated_at': '时间戳', 'execution_run.workspace_id': '标识',
    'relation.from_entity_id': '标识', 'relation.relation_class': '枚举：关系类别', 'relation.relation_type': '语义：关系类型',
    'relation.source': '枚举：关系来源', 'relation.state': '枚举：确认态', 'relation.to_entity_id': '标识', 'relation.workspace_id': '标识',
    'candidate_relation.from_entity_id': '标识', 'candidate_relation.relation_class': '枚举：关系类别',
    'candidate_relation.relation_type': '语义：关系类型', 'candidate_relation.source': '枚举：候选来源',
    'candidate_relation.state': '枚举：候选态', 'candidate_relation.to_entity_id': '标识', 'candidate_relation.workspace_id': '标识',
    'sync_observation.binding_id': '标识', 'sync_observation.dedupe_key': '端口去重键',
    'sync_observation.object_external_id': '平台原样值', 'sync_observation.object_kind': '平台原样值',
    'sync_observation.observed_at': '时间戳', 'sync_observation.snapshot_json': 'provider 控制的 payload（脱敏责任在 provider）',
    'sync_observation.state': '枚举：观察处理态', 'sync_observation.updated_at': '平台版本载体',
    'sync_cursor.binding_id': '标识', 'sync_cursor.cursor_value': 'provider 游标值', 'sync_cursor.last_error_code': '错误码',
    'sync_cursor.scope_key': '调用方 scope 键', 'sync_cursor.state': '枚举：同步态',
    'reconcile_cursor.last_reconciled_at': '时间戳', 'reconcile_cursor.workspace_id': '标识',
    'webhook_subscription.binding_id': '标识', 'webhook_subscription.enabled': '标志', 'webhook_subscription.event_name': '平台事件名',
    'webhook_subscription.id': '标识', 'webhook_subscription.scope_key': '调用方 scope 键', 'webhook_subscription.workspace_id': '标识',
    'mutation_attempt.binding_id': '标识', 'mutation_attempt.command_name': '命令名', 'mutation_attempt.created_at': '时间戳',
    'mutation_attempt.error_code': '错误码', 'mutation_attempt.expected_source_version': '平台版本载体',
    'mutation_attempt.id': '标识', 'mutation_attempt.idempotency_key': '调用方幂等键', 'mutation_attempt.state': '枚举：WriteState',
    'mutation_attempt.updated_at': '时间戳', 'mutation_attempt.workspace_id': '标识',
    'workspace_revision.revision': '修订号', 'workspace_revision.workspace_id': '标识',
  }
  // 只审计 **003 建出的表**：002 的列由 `identity-membership-schema.test.js` 审计，后续迁移各审各的。
  const owned = new Set(Object.keys(TABLE_PROVENANCE))
  const actual = allTables(db).filter((table) => owned.has(table))
    .flatMap((table) => columns(db, table).map((column) => `${table}.${column}`)).sort()
  assert.deepEqual(actual, Object.keys(AUDITED).sort(),
    '每一条列都必须被显式审计：新增列要同步写进 AUDITED，否则这份审查只是声明')
  assert.equal(actual.length, 63, '003 建出的十一张表共 63 列')
  const credentialLike = /token|password|passwd|secret|credential|private_?key|access_?key|api_?key/i
  assert.deepEqual(actual.filter((qualified) => credentialLike.test(qualified)), [],
    '没有任何列能存凭据材料；凭据只保存 secret 服务句柄')
}))
