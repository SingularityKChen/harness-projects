import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { MIGRATIONS, migrate, openDatabase } from '@harness-projects/storage-sqlite'

/** 表 → 出处：与实际表集合互相覆盖（D8）。 */
const TABLE_PROVENANCE = {
  workspace: 'AGENTS.md §1.1 不变量 1：工作区是"一个 Planning 事实源"的作用域',
  provider_binding: 'issue #27 Scope 的 connector accounts 与 ADR-0006：跨工作区的连接锚点，R1 的身份键挂在它上面',
  workspace_binding: 'AGENTS.md §1.1 不变量 1 与 2：工作区作用域的挂载，一个启用的 planning 挂载、一个启用的默认挂载',
  entity: 'AGENTS.md §1.1 不变量 6：内部实体锚点，外部身份变化不改变它（E1-2 实验 2）',
  external_identity: 'R1 / R7 与 ADR-0001：身份键 (binding, 对象种类, 平台全局 id)，故意不含工作区',
  project_item_membership: 'R1：成员关系是工作区作用域的挂载点，键 (workspace, item) 与 (workspace, project, 内容)',
  planning_field_value: 'R2 / R3：字段值挂成员关系，键 (workspace, item, projectField)，不设版本列',
  workspace_projection: 'AGENTS.md §1.1 不变量 1 / 3 与 ADR-0005：规划投影按 (workspace, entity) 锚定内容，分类推导归 core',
}
const MIGRATION_FILE = fileURLToPath(
  new URL('../../packages/storage/sqlite/migrations/002_identity_membership.sql', import.meta.url),
)

/** 每个用例一个临时目录与数据库。 */
function withDatabase(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-identity-'))
  const db = openDatabase(join(dir, 'workspace.sqlite'))
  try {
    return run(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

const tables = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
const columns = (db, table) => db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY name').all(table).map((row) => row.name)
const rejects = (db, sql, message) => assert.throws(() => db.exec(sql), message)

/** 满足全部外键的最小库。 */
function seed(db) {
  db.exec(`
    INSERT INTO workspace VALUES ('ws-1', '工作区', 'provider_authoritative'); INSERT INTO workspace VALUES ('ws-2', '工作区 2', 'provider_authoritative');
    INSERT INTO provider_binding VALUES ('binding-1', 'fake'); INSERT INTO workspace_binding VALUES ('ws-1', 'binding-1', 'planning', 1, 1);
    INSERT INTO workspace_binding VALUES ('ws-2', 'binding-1', 'planning', 1, 1); INSERT INTO entity VALUES ('entity-1', 'work_item');
    INSERT INTO entity VALUES ('entity-2', 'change_request'); INSERT INTO external_identity VALUES ('identity-1', 'entity-1', 'binding-1', 'issue', 'issue-1', 'primary');
    INSERT INTO project_item_membership VALUES ('ws-1', 'project-1', 'item-1', 'issue', 'issue-1', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z');
    INSERT INTO planning_field_value VALUES ('ws-1', 'item-1', 'field-1', 'In Progress', '2026-09-20T00:00:02Z'); INSERT INTO workspace_projection VALUES ('ws-1', 'entity-1', 'in_progress', 'work_item', '标题', '正文', NULL, NULL, 1);
  `)
}

test('空库建出八张表，二次运行是 no-op', () => {
  withDatabase((db) => {
    const first = migrate(db)
    assert.deepEqual(first.applied, MIGRATIONS.map((entry) => entry.version), '空库必须应用清单里的全部迁移')
    assert.deepEqual(tables(db), [...Object.keys(TABLE_PROVENANCE), 'schema_migrations'].sort())
    const snapshot = () => JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all())
    const before = snapshot()
    assert.deepEqual(migrate(db).applied, [], '重跑不得再应用任何迁移')
    assert.equal(snapshot(), before, '重跑必须不改动 schema')
  })
})

test('表 → 出处映射与实际表集合互相覆盖，且迁移文件里每张表都有出处注释', () => {
  const sql = readFileSync(MIGRATION_FILE, 'utf8')
  for (const [table, provenance] of Object.entries(TABLE_PROVENANCE)) {
    assert.ok(provenance.length > 0, `${table} 缺少出处`)
    assert.match(sql, new RegExp(`-- ${table}：`), `迁移文件里 ${table} 缺少出处注释（控制计划 D8）`)
  }
  for (const marker of ['R1', 'R2', 'R3', 'R7']) {
    assert.ok(sql.includes(marker), `迁移文件里缺少 ${marker} 的追溯注释`)
  }
  withDatabase((db) => {
    migrate(db)
    assert.deepEqual(tables(db).filter((name) => name !== 'schema_migrations'), Object.keys(TABLE_PROVENANCE).sort(), '多一张表或少一条映射都必须失败')
  })
})

test('出处注释覆盖到约束级：每条 CREATE 与每条表内约束（含行内 REFERENCES 外键）上方都有出处（#27 验收 4）', () => {
  const lines = readFileSync(MIGRATION_FILE, 'utf8').split('\n')
  const creates = []
  const undocumented = []
  lines.forEach((line, index) => {
    const create = /^CREATE (?:TABLE|UNIQUE INDEX|INDEX)\s+(\w+)/.exec(line)
    const constraint = /^\s{2}(?:PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\s*\(/.test(line) || /^\s{2}\w+[^,]*\sCHECK\s*\(|\sREFERENCES\s/.test(line)
    if (create === null && !constraint) return
    if (create !== null) creates.push(create[1])
    const above = lines.slice(Math.max(0, index - (create === null ? 1 : 3)), index + 1).join('\n')
    // 只检查"上方有 `--`"会被复制注释骗过（评审实测）；这里要求注释里有可解析的出处标记。
    if (!/--[^\n]*(?:R\d|不变量\s*\d|ADR-\d{4}|issue #\d+|裁决)/.test(above)) undocumented.push(create?.[1] ?? line.trim())
  })
  assert.ok(creates.length >= 10, `必须至少找到 10 条 CREATE 语句，实际 ${creates.length} 条`)
  assert.deepEqual(undocumented, [], '每条 CREATE TABLE / CREATE INDEX 与每条表内 PRIMARY KEY / FOREIGN KEY / UNIQUE / CHECK 都必须有写明出处的注释（控制计划 D8）')
})

test('行为 1：外部身份挂在连接锚点上，因此跨工作区只有一条（不变量 6）', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    assert.deepEqual(columns(db, 'provider_binding'), ['id', 'implementation_key'])
    assert.deepEqual(columns(db, 'external_identity'), ['binding_id', 'entity_id', 'external_id', 'external_kind', 'id', 'role'])
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspace_binding WHERE binding_id = 'binding-1'").get().n, 2,
      '同一条连接被两个工作区挂载（不变量 2）')
    // 判别性（评审）：重复登记必须用**另一个实体**，否则放宽唯一键仍然全绿。
    rejects(db, "INSERT INTO external_identity VALUES ('identity-9','entity-2','binding-1','issue','issue-1','alias')", '同一连接上的同一对象只有一条身份，无论从哪个工作区发起')
    assert.equal(db.prepare("SELECT COUNT(DISTINCT entity_id) AS n FROM external_identity WHERE external_id = 'issue-1'").get().n, 1, '同一外部对象只能解析出一个内部实体（ADR-0001 / 不变量 6）')
    db.exec("INSERT INTO project_item_membership VALUES ('ws-2','project-1','item-1','issue','issue-1','x','x')")
    db.exec("INSERT INTO workspace_projection VALUES ('ws-2','entity-1','todo','work_item','标题','正文',NULL,NULL,1)")
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_item_membership WHERE content_external_id = 'issue-1'").get().n, 2, '同一内容在两个工作区是两条成员关系')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspace_projection WHERE entity_id = 'entity-1'").get().n, 2, '每工作区一行投影')
  })
})

test('R1：成员关系的唯一约束按 (工作区, 项目, 内容) 拒绝重复，project 分量被钉住', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    rejects(db, "INSERT INTO project_item_membership VALUES ('ws-1','project-1','item-1','issue','issue-1','x','x')", '同一条目只允许一行')
    rejects(db, "INSERT INTO project_item_membership VALUES ('ws-1','project-1','item-3','issue','issue-1','x','x')", '(项目, 内容) 在平台侧唯一，本地不得留下第二条')
    db.exec("INSERT INTO project_item_membership VALUES ('ws-1','project-2','item-2','issue','issue-1','x','x')")
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_item_membership WHERE workspace_id = 'ws-1' AND content_external_id = 'issue-1'").get().n, 2, '同一工作区的两个 project 各有一条成员关系')
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'project_item_membership%'").all().map((row) => row.name),
      ['project_item_membership_project_content'])
  })
})

test('R2 / R3：字段值的列集合恰好等于声明的五个，定位键不含可选值 id 与版本列', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    assert.deepEqual(columns(db, 'planning_field_value'), ['item_external_id', 'observed_at', 'project_field_id', 'value', 'workspace_id'])
    rejects(db, "INSERT INTO planning_field_value VALUES ('ws-1','item-1','field-1','Done','x')", '同键只允许一行')
    db.exec("INSERT INTO planning_field_value VALUES ('ws-1','item-1','field-2','Todo','x')")
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM planning_field_value').get().n, 2, '同一成员关系的不同字段各一行')
    rejects(db, "INSERT INTO planning_field_value VALUES ('ws-1','item-9','field-1','x','x')", '字段值必须挂在成员关系上（R1 的连带影响）')
  })
})

test('R7：external_identity.role 只有三个取值，且 ProjectV2Item 不是身份种类', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    db.exec("UPDATE external_identity SET role = 'historical' WHERE id = 'identity-1'")
    db.exec("UPDATE external_identity SET role = 'primary' WHERE id = 'identity-1'")
    rejects(db, "UPDATE external_identity SET role = 'owner' WHERE id = 'identity-1'", 'role 取值集合受 CHECK 约束（R7）')
    rejects(db, "INSERT INTO external_identity VALUES ('identity-9','entity-1','binding-1','project_item','PVTI_1','alias')", 'R1：ProjectV2Item 不得成为外部身份种类')
  })
})

test('每个实体至多一个 primary 身份（库层面）；恰好一个由写入生命周期保证', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    db.exec("INSERT INTO external_identity VALUES ('identity-2','entity-1','binding-1','draft','draft-1','alias')")
    rejects(db, "INSERT INTO external_identity VALUES ('identity-3','entity-1','binding-1','issue','issue-3','primary')", '同一实体至多一个 primary（identity.ts 的 activePrimary）')
    db.exec("UPDATE external_identity SET role = 'historical' WHERE id = 'identity-1'")
    db.exec("INSERT INTO external_identity VALUES ('identity-3','entity-1','binding-1','issue','issue-3','primary')")
    assert.deepEqual(db.prepare("SELECT id FROM external_identity WHERE entity_id = 'entity-1' AND role = 'primary'").all().map((row) => row.id), ['identity-3'])
    db.exec("UPDATE external_identity SET role = 'alias' WHERE id = 'identity-3'")
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM external_identity WHERE entity_id = 'entity-1' AND role = 'primary'").get().n, 0,
      '库层面只保证至多一个：零个 primary 可插入，这正是「恰好一个」必须由生命周期保证的原因')
  })
})

test('#27 验收 1：第二个启用的 planning 挂载被数据库拒绝，且 domain 是受约束的枚举', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    db.exec("INSERT INTO provider_binding VALUES ('binding-2','fake')")
    db.exec("INSERT INTO provider_binding VALUES ('binding-3','fake')")
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-1','binding-2','planning',1,0)", '第二个启用的 planning 挂载必须被拒绝')
    db.exec("INSERT INTO workspace_binding VALUES ('ws-1','binding-2','planning',0,0)")
    db.exec("INSERT INTO workspace_binding VALUES ('ws-1','binding-2','development',1,1)")
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-1','binding-3','development',1,1)", '同域至多一个启用的默认挂载')
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-1','binding-3','delivery',0,1)", '默认绑定必然是启用的')
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-1','binding-3','Planning',1,0)", 'domain 的取值集合受 CHECK 约束')
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-2','binding-2','planning',1,0)", '同一个工作区里第二个启用的 planning 挂载必须被拒绝')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspace_binding WHERE binding_id = 'binding-1'").get().n, 2,
      '同一条连接被两个工作区各挂载一次（行为 1 的前提）')
  })
})

test('同一工作区里同一实体只有一行投影（storage 保证的那一条）', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    const count = () => db.prepare("SELECT COUNT(*) AS n FROM workspace_projection WHERE workspace_id = 'ws-1' AND entity_id = 'entity-1'").get().n
    assert.equal(count(), 1, 'seed 里该实体已有一行投影')
    db.exec("INSERT INTO workspace_projection VALUES ('ws-1','entity-1','todo','work_item','更新标题','更新正文',NULL,NULL,2) ON CONFLICT (workspace_id, entity_id) DO UPDATE SET content_title = excluded.content_title, content_body = excluded.content_body, revision = excluded.revision")
    assert.equal(count(), 1, '同一 (workspace, entity) 的第二行必须是更新')
    assert.equal(db.prepare("SELECT content_title FROM workspace_projection WHERE workspace_id = 'ws-1' AND entity_id = 'entity-1'").get().content_title, '更新标题')
    rejects(db, "INSERT INTO workspace_projection VALUES ('ws-1','entity-1','todo','change_request','另一个','正文',NULL,NULL,3)", '同一 (workspace, entity) 不得出现第二行')
    db.exec("INSERT INTO entity VALUES ('entity-3','work_item')")
    db.exec("INSERT INTO workspace_projection VALUES ('ws-1','entity-3','todo','work_item','另一项','正文',NULL,NULL,1)")
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspace_projection WHERE workspace_id = 'ws-1'").get().n, 2, '不同实体各自保留一行')
  })
})

test('#27 验收 5：显式 schema 审查——没有列能存 token / key / password', () => {
  withDatabase((db) => {
    migrate(db)
    // 逐列白名单（评审订正）：与 `pragma_table_info` **互相覆盖**，未审计的新列即失败（旧版正则两个方向都不准）。
    const AUDITED = {
      'workspace.id': '标识', 'workspace.name': '展示名', 'workspace.status_policy': '枚举：状态归属策略',
      'provider_binding.id': '标识', 'provider_binding.implementation_key': 'provider 实现标识（不是凭据材料）',
      'workspace_binding.workspace_id': '标识', 'workspace_binding.binding_id': '标识',
      'workspace_binding.domain': '枚举：能力域', 'workspace_binding.enabled': '标志', 'workspace_binding.is_default': '标志',
      'entity.id': '标识', 'entity.kind': '枚举：实体种类',
      'external_identity.id': '标识', 'external_identity.entity_id': '标识', 'external_identity.binding_id': '标识',
      'external_identity.external_kind': '枚举：身份种类', 'external_identity.external_id': '平台原样值', 'external_identity.role': '枚举：身份角色',
      'project_item_membership.workspace_id': '标识', 'project_item_membership.project_external_id': '平台原样值',
      'project_item_membership.item_external_id': '平台原样值', 'project_item_membership.content_external_kind': '枚举：内容种类',
      'project_item_membership.content_external_id': '平台原样值', 'project_item_membership.membership_created_at': '时间戳',
      'project_item_membership.membership_updated_at': '时间戳',
      'planning_field_value.workspace_id': '标识', 'planning_field_value.item_external_id': '平台原样值',
      'planning_field_value.project_field_id': '平台原样值', 'planning_field_value.value': '平台原样值',
      'planning_field_value.observed_at': '时间戳',
      'workspace_projection.workspace_id': '标识', 'workspace_projection.entity_id': '标识',
      'workspace_projection.planning_status': '归一化状态', 'workspace_projection.content_kind': '枚举：内容三态',
      'workspace_projection.content_title': '内容', 'workspace_projection.content_body': '内容',
      'workspace_projection.content_number': '内容', 'workspace_projection.redaction_reason': '枚举：脱敏原因',
      'workspace_projection.revision': '修订号',
    }
    // 只审计 **002 建出的表**：本用例的验收对象是 #27 的迁移，后续迁移（003 起）由各自的用例审计。
    const owned = new Set(Object.keys(TABLE_PROVENANCE))
    const actual = tables(db).filter((table) => owned.has(table))
      .flatMap((table) => columns(db, table).map((column) => `${table}.${column}`)).sort()
    assert.deepEqual(actual, Object.keys(AUDITED).sort(), '每一条列都必须被显式审计：新增列要同步写进 AUDITED，否则这份审查只是声明')
    const credentialLike = /token|password|passwd|secret|credential|private_?key|access_?key|api_?key/i
    assert.deepEqual(actual.filter((qualified) => credentialLike.test(qualified) && !/_(?:handle|ref)$/.test(qualified)), [], '没有任何列能存凭据材料（#27 验收 5）；凭据只保存 secret 服务句柄，_handle / _ref 后缀的句柄列不算凭据材料')
  })
})

test('每张表的外键指向存在的表，且悬空引用被拒绝', () => {
  withDatabase((db) => {
    migrate(db); seed(db)
    const known = new Set(tables(db))
    for (const table of known) {
      for (const fk of db.prepare('SELECT "table" AS target FROM pragma_foreign_key_list(?)').all(table)) {
        assert.ok(known.has(fk.target), `${table} 的外键指向不存在的表 ${fk.target}`)
      }
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], '前置行不得留下悬空引用')
    db.exec("INSERT INTO provider_binding VALUES ('binding-9','fake')")
    assert.deepEqual(columns(db, 'provider_binding'), ['id', 'implementation_key'], '连接锚点不含工作区外键——它本来就跨工作区')
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-none','binding-1','planning',1,0)", '挂载必须属于存在的工作区')
    // 判别性（评审）：用 development 域；写 planning 会先被唯一索引拒绝，外键删掉也不变红。
    rejects(db, "INSERT INTO workspace_binding VALUES ('ws-1','binding-none','development',0,0)", /FOREIGN KEY constraint failed/, '挂载必须指向存在的连接锚点')
    rejects(db, "INSERT INTO external_identity VALUES ('identity-fk','entity-1','binding-none','issue','issue-fk','alias')", /FOREIGN KEY constraint failed/, '身份必须挂在存在的连接锚点上（ADR-0006 的核心外键）')
    rejects(db, "INSERT INTO external_identity VALUES ('identity-fk','entity-none','binding-1','issue','issue-fk','alias')", /FOREIGN KEY constraint failed/, '身份必须指向存在的实体')
    rejects(db, "INSERT INTO project_item_membership VALUES ('ws-none','project-1','item-9','issue','issue-9','x','x')", '成员关系必须属于存在的工作区')
    rejects(db, "INSERT INTO workspace_projection VALUES ('ws-1','entity-none','todo','work_item','标题','正文',NULL,NULL,1)", '工作区投影必须指向存在的实体')
  })
})
