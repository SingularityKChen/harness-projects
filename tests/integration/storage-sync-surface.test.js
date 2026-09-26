// 集成层：Storage 端口的同步面在文件库上的用例（`tests/integration/README.md` 的 "event dedupe"，外加
// R1 的成员关系、R4 的观察定序与 committed 视图、R5 的游标作用域与引用完整性）。每个用例一个临时目录，
// 用例之间不共享状态；断言说明它保护哪条不变量，而不是它调用了哪个函数。
//
// 账本与 `committed_observation` 视图**没有端口读取接口**（控制计划 D6 刻意不新增观察查询），因此这里从
// 第二个连接直接读表与视图：committed 是由账本派生的当前事实，本层要钉住的是这个结构本身。账本主体与
// committed 的主体都是**端口主体** `(binding_id, object_kind, object_external_id)`，账本也不引用成员关系
// （L3 的 003）：观察只带内容引用，落点就是端口主体本身，**不解析成员关系**——对账先到、成员关系后到也能记账。
// 本层钉的是端口面：`recordObservation` 的 true / false、账本行数与 003 重写后的库自检。

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { makeObservation } from '@harness-projects/capabilities'
import { createSqliteStorage, openDatabase } from '@harness-projects/storage-sqlite'

async function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'storage-sync-surface-'))
  try { return await run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const WORKSPACE = 'ws-1'
const PROJECT = 'project-1'
const BINDING = 'binding-1'
const ITEM = 'item-1'
const OBJECT_KIND = 'issue'
const OBJECT = 'issue-1'
const V1 = '2026-09-21T07:10:00Z'
const V2 = '2026-09-21T07:11:00Z'
const V3 = '2026-09-21T07:11:54Z'
const workspace = (id = WORKSPACE, name = '工作区') => ({ id, name, statusPolicy: 'provider_authoritative' })
const binding = (id = BINDING, workspaceId = WORKSPACE) => ({ id, workspaceId, domain: 'planning', implementationKey: 'fake', enabled: true, isDefault: false })
const membership = (overrides = {}) => ({ workspaceId: WORKSPACE, projectExternalId: PROJECT, itemExternalId: ITEM, contentKind: 'issue',
  contentExternalId: OBJECT, membershipCreatedAt: '2026-09-20T00:00:00Z', membershipUpdatedAt: '2026-09-20T00:00:00Z', ...overrides })
const fieldValue = (overrides = {}) => ({ workspaceId: WORKSPACE, itemExternalId: ITEM, projectFieldId: 'field-1',
  value: 'In Progress', observedAt: '2026-09-20T00:00:02Z', ...overrides })
/** 观察由 capabilities 的契约函数组装：dedupeKey 与 payloadHash 不许测试自己发明一套规则。 */
const observation = (overrides = {}) => makeObservation({
  subject: { bindingId: BINDING, objectKind: OBJECT_KIND, externalId: OBJECT, url: undefined }, type: 'issue.updated',
  eventTime: undefined, receivedTime: V2, sourceVersion: V2, stablePayloadFields: { status: 'Todo' }, payload: { status: 'Todo' }, ...overrides })
const delivered = (overrides) => ({ observation: observation(overrides), state: 'processed' })

/** 最小前置行：工作区与绑定。观察的主体就是端口主体（连接级），**不要求成员关系存在**，因此成员关系与字段值由需要它们的用例自己走端口建。 */
async function seed(storage) {
  await storage.putWorkspace(workspace())
  await storage.putProviderBinding(binding())
}

/** 从第二个连接读账本 / committed 视图：视图不是端口面，但它是"乱序不覆盖"的结构保证。行映射成普通对象，断言不必知道驱动的行原型。 */
function readSync(location, sql, ...params) {
  const db = openDatabase(location)
  try { return db.prepare(sql).all(...params).map((row) => ({ ...row })) } finally { db.close() }
}
const ledger = (location) => readSync(location, 'SELECT object_external_id, observed_at, updated_at, state FROM sync_observation ORDER BY observed_at, dedupe_key')
const committed = (location) => readSync(location, `SELECT object_external_id, observed_at, updated_at, snapshot_json FROM committed_observation
  WHERE binding_id = ? AND object_kind = ? AND object_external_id = ? ORDER BY observed_at`, BINDING, OBJECT_KIND, OBJECT)

/** 同步面的可观测摘要：一次投递与 N 次投递必须得到同一份摘要（README 的 "event dedupe"）。 */
async function digest(storage, location) {
  return { ledger: ledger(location), committed: committed(location),
    memberships: await storage.listMemberships(WORKSPACE, PROJECT), fieldValues: await storage.listFieldValues(WORKSPACE, ITEM) }
}

test('观察账本：同一观察投递 N 次与一次相同，重开句柄后仍被去重', async () => {
  await withTempDir(async (dir) => {
    const once = createSqliteStorage(join(dir, 'once.sqlite'))
    const many = createSqliteStorage(join(dir, 'many.sqlite'))
    await seed(once); await seed(many)
    const record = delivered()
    assert.equal(await once.recordObservation(record), true, '首次投递必须被应用')
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal(await many.recordObservation(record), attempt === 1, `第 ${attempt} 次投递：只有第一次被应用，调用方据此不得重放副作用`)
    }
    many.close()
    const revived = createSqliteStorage(join(dir, 'many.sqlite'))
    try {
      assert.equal(await revived.recordObservation(record), false, '账本在文件上：重开句柄后同一观察仍必须被去重')
      assert.deepEqual(await digest(revived, join(dir, 'many.sqlite')), await digest(once, join(dir, 'once.sqlite')), '投递 N 次与一次的可观测摘要必须完全相同')
      assert.equal((await digest(revived, join(dir, 'many.sqlite'))).ledger.length, 1, '账本只追加：同一 (binding, dedupeKey) 只有一行')
    } finally { revived.close(); once.close() }
  })
})

test('观察账本：同一主体、同一接收时刻的两条不同观察互不顶掉，已见 key 再投递仍是 false', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      // `observed_at` 是**本地接收时刻**：同一毫秒/秒收到两条不同观察是可能的（不同 payload、同版本）。
      // 账本的键必须含 dedupeKey，否则第二条走 ON CONFLICT 把第一行顶掉——账本永久丢一条，而第一行再投递
      // 会第二次返回 true，调用方据此重放副作用。这一格只有集成层看得见（端口没有观察读回接口）。
      const first = delivered({ receivedTime: V2, stablePayloadFields: { status: 'Todo' }, payload: { status: 'Todo' } })
      const second = delivered({ receivedTime: V2, stablePayloadFields: { status: 'Done' }, payload: { status: 'Done' } })
      assert.equal(await storage.recordObservation(first), true, '第一条观察必须被应用')
      assert.equal(await storage.recordObservation(second), true, '同主体、同接收时刻、同版本但**不同 key** 的观察是合法的新事实，必须被应用')
      assert.equal(ledger(location).length, 2, '两条不同观察都必须留在账本里：只追加，不互相顶掉')
      assert.equal(await storage.recordObservation(first), false, '第一条再投递必须返回 false——它的账本行没有被顶掉')
      assert.equal(ledger(location).length, 2, '重复投递不得再落一行')
      const rows = committed(location)
      assert.equal(rows.length, 1, '同一主体只有一个 committed 快照：同版本同接收时刻由追加序 tie-break')
      assert.equal(JSON.parse(rows[0].snapshot_json).observation.payload.status, 'Done', 'committed 取最后追加的那一行')
    } finally { storage.close() }
  })
})

test('观察定序：v1 → v3 → v2 的到达顺序必须判成 [true, true, false]', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      // 判别性（2026-09-24 评审的 M2）：旧用例的乱序观察都比**全部**已见版本更旧，所以把判据从"取最大值"反过来
      // 写成"取最旧"也全绿。这一格必须落在**中间**：v2 比已提交的 v3 旧、比 v1 新，只有真的取最大值才会拒绝它。
      const at = (key, version) => delivered({ sourceVersion: version, receivedTime: version, stablePayloadFields: { status: version }, payload: { status: version } })
      const applied = [await storage.recordObservation(at('k1', V1)), await storage.recordObservation(at('k2', V3)), await storage.recordObservation(at('k3', V2))]
      assert.deepEqual(applied, [true, true, false], '介于中间的版本必须被拒绝：判据是已提交版本的最大值，不是最旧值')
      assert.equal(ledger(location).length, 2, '被拒绝的乱序观察不得落进账本')
      assert.equal(committed(location)[0]?.updated_at, V3, '乱序观察不得改变已提交快照')
      assert.equal(await storage.recordObservation(at('k4', V1)), false, '更旧的版本同样必须被拒绝')
    } finally { storage.close() }
  })
})

test('观察定序：更旧的版本不落账本，同版本整快照替换', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      assert.equal(await storage.recordObservation(delivered({ sourceVersion: V2 })), true)
      assert.equal(await storage.recordObservation(delivered({ sourceVersion: V1, stablePayloadFields: { status: 'Blocked' } })), false,
        '更旧的 sourceVersion 必须返回 false，调用方不得读成"已应用"')
      assert.equal(ledger(location).length, 1, '被拒绝的乱序观察不得落进账本')
      assert.equal(committed(location)[0]?.updated_at, V2, '乱序观察不得改变已提交快照')
      const replacement = delivered({ sourceVersion: V2, receivedTime: V3, stablePayloadFields: { status: 'Done' }, payload: { status: 'Done' } })
      assert.equal(await storage.recordObservation(replacement), true, '同版本、不同 dedupeKey 的观察必须被应用（整快照替换）')
      assert.equal(ledger(location).length, 2, '替换是追加一行，不是把已见 key 的账本行顶掉')
      const [latest] = committed(location)
      assert.equal(latest?.observed_at, V3, '同版本时 committed 取本地接收时刻最新的那一行')
      assert.equal(JSON.parse(latest.snapshot_json).observation.payload.status, 'Done', '同版本是整快照替换，不是逐字段合并')
    } finally { storage.close() }
  })
})

test('committed_observation：committed 是每个端口主体 updated_at 最大、同版本时 observed_at 最新的那一行', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      await storage.recordObservation(delivered({ sourceVersion: V2 }))
      await storage.recordObservation(delivered({ sourceVersion: V3, receivedTime: V3, stablePayloadFields: { status: 'In Progress' }, payload: { status: 'In Progress' } }))
      // 端口会拒绝乱序观察（上一条用例），但账本是结构：这里直接写一行更旧的版本，证明"乱序不覆盖"是**构造性**的。
      const db = openDatabase(location)
      try {
        db.prepare(`INSERT INTO sync_observation (binding_id, object_kind, object_external_id, observed_at, dedupe_key, updated_at, snapshot_json, state)
          VALUES (?, ?, ?, '2026-09-21T07:12:00Z', 'stale-key', '2026-09-21T07:09:00Z', '{"stale":true}', 'processed')`).run(BINDING, OBJECT_KIND, OBJECT)
      } finally { db.close() }
      const rows = committed(location)
      assert.equal(rows.length, 1, '每个主体只有一个 committed 快照')
      assert.equal(rows[0]?.updated_at, V3, '更旧的行即使落进账本，也永远不是 committed')
      assert.equal(JSON.parse(rows[0].snapshot_json).observation.payload.status, 'In Progress')
    } finally { storage.close() }
  })
})

test('committed 按端口主体定序：两个绑定观察同一内容时各自的版本序列互不影响', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      // 第二个启用的 planning 挂载会被部分唯一索引拒绝（不变量 1：一个工作区同一时刻只有一个 Planning 事实源），
      // 第二条连接挂在 development 域；committed 的定序主体只用到绑定与对象，与域无关。
      await storage.putProviderBinding({ ...binding('binding-2'), domain: 'development' })
      const second = (overrides = {}) => delivered({ subject: { bindingId: 'binding-2', objectKind: OBJECT_KIND, externalId: OBJECT, url: undefined }, ...overrides })
      // 一个工作区可以连接多个提供方（不变量 2），两个绑定会观察**同一个内容**。committed 的主体若不含 binding，
      // binding-2 的第一条观察会被拿去和 binding-1 的版本比大小，判成乱序后静默返回 `false`——调用方把一条合法的
      // 新事实读成"已经处理过"。
      assert.equal(await storage.recordObservation(delivered({ sourceVersion: V3, receivedTime: V3, stablePayloadFields: { status: 'In Progress' }, payload: { status: 'In Progress' } })), true)
      assert.equal(await storage.recordObservation(second({ sourceVersion: V2, stablePayloadFields: { status: 'Todo' }, payload: { status: 'Todo' } })), true,
        'binding-2 的首条观察必须被应用：它比的是**自己**绑定下的已提交版本，不是 binding-1 的')
      assert.equal(await storage.recordObservation(delivered({ sourceVersion: V1, stablePayloadFields: { status: 'Blocked' }, payload: { status: 'Blocked' } })), false,
        'binding-1 自己更旧的版本仍然必须被拒绝')
      assert.equal(await storage.recordObservation(second({ sourceVersion: V1, stablePayloadFields: { status: 'Blocked' }, payload: { status: 'Blocked' } })), false,
        'binding-2 自己更旧的版本同样必须被拒绝')
      assert.equal(ledger(location).length, 2, '只有被应用的两条落进账本：每条绑定一行')
    } finally { storage.close() }
  })
})

test('成员关系后者胜：同 (工作区, 项目, 内容) 的新条目取代旧条目，同条目重写保留挂载点', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      await storage.putMembership(membership())
      await storage.putFieldValue(fieldValue())
      // 账本只追加，换条目**不删**已处理观察的账本行。先投递再换条目，然后重投同一个观察：删了账本行的话
      // 这里会第二次返回 `true`，调用方据此重放副作用——"换条目不产生账本行"这种断言分辨不出这件事。
      const record = delivered()
      assert.equal(await storage.recordObservation(record), true, '首次投递必须被应用')
      assert.equal(ledger(location).length, 1, '前置：账本里已有这条观察的一行')
      await storage.putMembership(membership({ itemExternalId: 'item-2', membershipUpdatedAt: '2026-09-21T00:00:00Z' }))
      assert.deepEqual((await storage.listMemberships(WORKSPACE, PROJECT)).map((m) => m.itemExternalId), ['item-2'],
        '平台保证 (项目, 内容) 唯一：新观测取代旧行，裸 INSERT 会被唯一索引拒绝')
      assert.equal(await storage.getMembership(WORKSPACE, ITEM), undefined, '旧条目已经不存在')
      assert.deepEqual(await storage.listFieldValues(WORKSPACE, ITEM), [], '旧条目上的字段值随它一起消失，不留悬空行')
      assert.equal(await storage.recordObservation(record), false, '换条目不得清掉账本：同一观察再投递必须仍是 false')
      assert.equal(ledger(location).length, 1, '换条目后账本行数不变：只追加，不因换条目而删')
      await storage.putFieldValue(fieldValue({ itemExternalId: 'item-2', value: 'Done' }))
      await storage.putMembership(membership({ itemExternalId: 'item-2', membershipUpdatedAt: '2026-09-22T00:00:00Z' }))
      assert.equal((await storage.getMembership(WORKSPACE, 'item-2'))?.membershipUpdatedAt, '2026-09-22T00:00:00Z', '同 (工作区, 条目) 是幂等覆盖')
      assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-2'), [fieldValue({ itemExternalId: 'item-2', value: 'Done' })],
        '幂等覆盖不得清掉挂在同一条目上的字段值')
    } finally { storage.close() }
  })
})

test('观察不解析落点：没有成员关系的内容也必须被应用，且不凭空造一条成员关系', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      // 账本主体是端口主体 `(binding, objectKind, externalId)`：观察只带内容引用，**不解析**成员关系。要求成员关系
      // 存在会让"对账先到、成员关系后到"这条真实路径在端口上抛错，而静默丢弃会让"没落账"读成"没有这条事实"。
      const record = delivered()
      assert.equal(await storage.recordObservation(record), true, '没有成员关系的观察必须被应用')
      assert.equal(ledger(location).length, 1, '账本里必须有这一行')
      assert.deepEqual(await storage.listMemberships(WORKSPACE, PROJECT), [], '观察不得凭空造一条成员关系')
      assert.equal(await storage.recordObservation(record), false, '同一观察再投递仍必须被去重')
      // 成员关系随后到达：它改写的是当前挂载点，账本行（只追加的历史）不受影响。
      await storage.putMembership(membership())
      assert.equal(ledger(location).length, 1, '成员关系到达不得改动账本行')
      assert.equal(await storage.recordObservation(record), false, '成员关系到达后同一观察仍必须是 false')
    } finally { storage.close() }
  })
})

test('引用完整性：成员关系必须属于存在的工作区，字段值必须挂在存在的成员关系上', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      await storage.putMembership(membership())
      await assert.rejects(storage.putMembership(membership({ workspaceId: 'ws-none' })), '悬空的成员关系必须被拒绝')
      assert.deepEqual(await storage.listMemberships('ws-none', PROJECT), [], '被拒绝的写入不得留下任何行')
      await assert.rejects(storage.putFieldValue(fieldValue({ itemExternalId: 'item-none' })), '悬空的字段值必须被拒绝')
      assert.deepEqual(await storage.listFieldValues(WORKSPACE, 'item-none'), [], '被拒绝的字段值不得留下任何行')
      assert.deepEqual(readSync(location, 'SELECT item_external_id FROM project_item_membership ORDER BY item_external_id'),
        [{ item_external_id: ITEM }], '拒绝路径不得动到已有的成员关系')
      assert.deepEqual(readSync(location, 'SELECT project_field_id FROM planning_field_value'), [], '字段值表里没有半写行')
    } finally { storage.close() }
  })
})

/** 把 `sync_observation` 退回重写前的列集合：`migrate()` 只按版本号判断是否已应用，因此旧库一直"看起来是新的"。 */
function rewriteObservationTable(db, columns) {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('DROP VIEW committed_observation')
  db.exec('DROP INDEX sync_observation_dedupe')
  db.exec(`CREATE TABLE sync_observation_pre_rewrite (${columns})`)
  db.exec('DROP TABLE sync_observation')
  db.exec('ALTER TABLE sync_observation_pre_rewrite RENAME TO sync_observation')
  return db.prepare(`SELECT name FROM pragma_table_info('sync_observation') ORDER BY cid`).all().map((row) => row.name)
}

const PRE_REWRITE_COLUMNS = `workspace_id TEXT NOT NULL, item_external_id TEXT NOT NULL, observed_at TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES provider_binding (id), updated_at TEXT NOT NULL, snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','processed','ignored','failed')), PRIMARY KEY (workspace_id, item_external_id, observed_at)`

test('003 重写后的库自检：旧库必须显式报错，且自检失败必须关掉句柄（缺端口主体列或 dedupe_key；连续失败不泄漏 fd）', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'stale.sqlite')
    createSqliteStorage(location).close()
    // 重写前的 003：主体是 (工作区, 条目)，既没有 `object_kind` 也没有 `dedupe_key`。`migrate()` 不会重放 003，
    // 所以这个库一直"看起来是新的"，直到第一次写观察才炸在驱动层（实测：`recordObservation -> no such column`）。
    const db = openDatabase(location)
    try {
      assert.deepEqual(rewriteObservationTable(db, PRE_REWRITE_COLUMNS),
        ['workspace_id', 'item_external_id', 'observed_at', 'binding_id', 'updated_at', 'snapshot_json', 'state'], '前置：库已退回重写前的 003 形状')
    } finally { db.close() }
    assert.throws(() => createSqliteStorage(location), /重写前的 003/,
      '旧库必须在打开时就显式报错并给出处置（删除重建）；否则调用方拿到的是第一次写观察时的驱动层报错')
    const before = readdirSync('/dev/fd').length // R4-3 ②：连续失败 5 次 fd 数不得增加（实测关掉 +0、删掉 this.db.close() +5）。
    for (let attempt = 1; attempt <= 5; attempt += 1) assert.throws(() => createSqliteStorage(location), /重写前的 003/)
    assert.equal(readdirSync('/dev/fd').length, before, '自检失败必须关掉句柄：每次失败的打开都不得留下一个文件描述符')
    // 判别性：自检要同时看**主体列**与 `dedupe_key`。中间形状（主体仍是工作区 + 条目，但已有 `dedupe_key`）只靠
    // "有没有 dedupe_key"判不出来，会在第一次写观察时以 `no such column: object_kind` 炸在驱动层。
    const intermediate = join(dir, 'intermediate.sqlite')
    createSqliteStorage(intermediate).close()
    const legacy = openDatabase(intermediate)
    try { rewriteObservationTable(legacy, PRE_REWRITE_COLUMNS.replace('observed_at TEXT NOT NULL,', "observed_at TEXT NOT NULL, dedupe_key TEXT NOT NULL,")) } finally { legacy.close() }
    assert.throws(() => createSqliteStorage(intermediate), /重写前的 003/, '只有 dedupe_key、没有端口主体列的旧库同样必须在打开时报错')
    const current = createSqliteStorage(join(dir, 'current.sqlite'))
    try { assert.deepEqual(await current.listMemberships(WORKSPACE, PROJECT), [], '正方向：当前形状的库照常打开，自检不得挡住新库') } finally { current.close() }
  })
})

test('游标按作用域隔离：绑定的 scopeKey 与工作区的对账游标互不覆盖', async () => {
  await withTempDir(async (dir) => {
    const location = join(dir, 'workspace.sqlite')
    const storage = createSqliteStorage(location)
    try {
      await seed(storage)
      await storage.putWorkspace(workspace('ws-2', '另一个工作区'))
      await storage.putProviderBinding(binding('binding-2', 'ws-2'))
      const cursors = [
        { bindingId: BINDING, scopeKey: 'scope-1', cursorValue: 'cursor-1', state: 'healthy', lastErrorCode: undefined },
        { bindingId: BINDING, scopeKey: 'scope-2', cursorValue: 'cursor-2', state: 'idle', lastErrorCode: undefined },
        { bindingId: 'binding-2', scopeKey: 'scope-1', cursorValue: 'cursor-3', state: 'degraded', lastErrorCode: 'provider_unavailable' },
      ]
      for (const cursor of cursors) await storage.putSyncCursor(cursor)
      for (const cursor of cursors) assert.deepEqual(await storage.getSyncCursor(cursor.bindingId, cursor.scopeKey), cursor,
        '同一个 scopeKey 在不同绑定下是两条游标，不同 scopeKey 互不覆盖')
      assert.equal(await storage.getSyncCursor(BINDING, 'scope-none'), undefined)
      await storage.putSyncCursor({ ...cursors[0], cursorValue: 'cursor-1b', state: 'failed', lastErrorCode: 'rate_limited' })
      assert.equal((await storage.getSyncCursor(BINDING, 'scope-1'))?.cursorValue, 'cursor-1b', '同键重写覆盖自身')
      assert.equal((await storage.getSyncCursor(BINDING, 'scope-2'))?.cursorValue, 'cursor-2', '重写一个 scope 不得动到另一个')
      await storage.putReconcileCursor({ workspaceId: WORKSPACE, lastReconciledAt: '2026-09-20T00:00:00Z' })
      await storage.putReconcileCursor({ workspaceId: 'ws-2', lastReconciledAt: '2026-09-21T00:00:00Z' })
      assert.equal((await storage.getReconcileCursor(WORKSPACE))?.lastReconciledAt, '2026-09-20T00:00:00Z', '对账游标按工作区隔离')
      assert.equal((await storage.getReconcileCursor('ws-2'))?.lastReconciledAt, '2026-09-21T00:00:00Z')
    } finally { storage.close() }
  })
})
