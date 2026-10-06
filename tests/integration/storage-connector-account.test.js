/** 连接账号与工作区配置的集成验收（#126）：重启/重开逐字段相等、空库迁移可重复、旧 002 形状在 migrate 之前被拒绝，以及 canary 不出现在任何发布面。共享 6 条用例由 `tests/contract/storage-connector-account.test.js` 在两个适配器上执行。 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createContext } from '@harness-projects/core'
import { createFakeStorage, createFakePlanningProvider, exportFakeStorageState } from '@harness-projects/provider-fake'
import { EMPTY_POLICY } from '@harness-projects/capabilities'
import { MIGRATIONS, SqliteStorage, createSqliteStorage, migrate, openDatabase } from '@harness-projects/storage-sqlite'
import { CONNECTOR_ACCOUNT_NAMED_CASES, CONNECTOR_ACCOUNT_SHARED_CASES, WORKSPACE, account, binding, policy, workspace } from '../contract/suites/storage-connector-account.js'

const dirs = []
const tempDir = (prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); dirs.push(dir); return dir }
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })
const ref = { workspaceId: WORKSPACE, bindingId: 'conn-restart', domain: 'planning' }
const seed = async (storage) => {
  await storage.putWorkspace(workspace())
  await storage.putProviderBinding(binding('conn-restart', 'planning'))
  await storage.putConnectorAccount(account())
  await storage.setProviderBindingAccount('conn-restart', 'account-1')
  await storage.putBindingConfiguration({ ref, configuration: { scope: 'workspace' } })
}
const snapshot = async (storage) => ({ accounts: await storage.listConnectorAccounts(),
  linked: await storage.getProviderBindingAccount('conn-restart'), configuration: await storage.getBindingConfiguration(ref) })

test('连接账号命名用例守卫：8 个具名用例覆盖共享组与集成专属', () => {
  assert.deepEqual(CONNECTOR_ACCOUNT_NAMED_CASES, [...CONNECTOR_ACCOUNT_SHARED_CASES, 'restart-and-empty-schema-repeatability', 'secret-canary-never-published'])
})

test('restart-and-empty-schema-repeatability', async () => {
  const path = join(tempDir('connector-account-restart-'), 'restart.sqlite')
  const storage = createSqliteStorage(path, policy())
  await seed(storage); const before = await snapshot(storage); storage.close()
  const reopened = createSqliteStorage(path, policy())
  try { assert.deepEqual(await snapshot(reopened), before, 'SQLite close/reopen 后账号、关联与配置逐字段相等') } finally { reopened.close() }
  const fake = createFakeStorage(undefined, policy())
  await seed(fake)
  assert.deepEqual(await snapshot(createFakeStorage(exportFakeStorageState(fake), policy())), await snapshot(fake), 'Fake export/import 后逐字段相等')
  for (const name of ['fresh-a', 'fresh-b']) { // 两个新临时目录各迁移两次：第二次 applied 为空，schema 逐字节不变
    const db = openDatabase(join(tempDir(`connector-account-${name}-`), 'workspace.sqlite'))
    try {
      assert.deepEqual(migrate(db).applied, MIGRATIONS.map((entry) => entry.version), `${name}：空库应用全部迁移`)
      const schema = JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all())
      assert.deepEqual(migrate(db).applied, [], `${name}：第二次迁移 applied 必须为空`)
      assert.equal(JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all()), schema, `${name}：重跑不得改动 schema`)
    } finally { db.close() }
  }
  // 旧 002 形状（版本 2 已记账但没有连接账号表/列）：工厂必须在 migrate 之前只读拒绝，句柄关闭，schema/行/记账零改动。
  const legacyPath = join(tempDir('connector-account-legacy-002-'), 'legacy.sqlite')
  const legacy = openDatabase(legacyPath)
  try {
    legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);'
      + "INSERT INTO schema_migrations VALUES (1, 'x'); INSERT INTO schema_migrations VALUES (2, 'x');"
      + 'CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, status_policy TEXT NOT NULL);'
      + 'CREATE TABLE provider_binding (id TEXT PRIMARY KEY, implementation_key TEXT NOT NULL);'
      + 'CREATE TABLE workspace_binding (workspace_id TEXT NOT NULL, binding_id TEXT NOT NULL, domain TEXT NOT NULL, enabled INTEGER NOT NULL, is_default INTEGER NOT NULL, PRIMARY KEY (workspace_id, binding_id, domain));'
      + "INSERT INTO workspace_binding VALUES ('ws-legacy', 'binding-legacy', 'planning', 1, 1);")
  } finally { legacy.close() }
  const fingerprint = (location) => { const db = openDatabase(location); try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name)
    return JSON.stringify(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all())
      + JSON.stringify(tables.map((name) => db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()))
  } finally { db.close() } }
  const legacyBefore = fingerprint(legacyPath)
  for (let attempt = 0; attempt < 2; attempt += 1) assert.throws(() => createSqliteStorage(legacyPath, policy()), /连接账号/, '旧 002 形状必须在 migrate 之前被只读拒绝并关闭句柄')
  assert.equal(fingerprint(legacyPath), legacyBefore, '拒绝必须零写入：schema 与既有行逐字节不变')
  const after = openDatabase(legacyPath)
  try { assert.deepEqual(after.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2], '拒绝必须零写入：不落 003/004/005 的迁移版本') } finally { after.close() }
  // 版本 2 已记账但**表整体缺失**的损坏库（对抗验证 P2-2）：判据不能只在 `provider_binding` 存在时生效，否则 003–005 会被部分应用。
  const truncatedPath = join(tempDir('connector-account-legacy-truncated-'), 'truncated.sqlite')
  const truncated = openDatabase(truncatedPath)
  try { truncated.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1, 'x'); INSERT INTO schema_migrations VALUES (2, 'y');") } finally { truncated.close() }
  const truncatedBefore = fingerprint(truncatedPath)
  assert.throws(() => createSqliteStorage(truncatedPath, policy()), /连接账号/, '版本 2 但表缺失必须在 migrate 之前拒绝')
  assert.equal(fingerprint(truncatedPath), truncatedBefore, '表缺失变体的拒绝也必须零写入')
  const truncatedAfter = openDatabase(truncatedPath)
  try { assert.deepEqual(truncatedAfter.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2], '表缺失变体不得先落 003–005') } finally { truncatedAfter.close() }
  // 版本 2 且表和两个新列都在、但 `connector_account` 只有一个 id 的残缺库（对抗验证 P2-R2）：只查表存在性会放过它。
  const partialPath = join(tempDir('connector-account-legacy-partial-'), 'partial.sqlite')
  const partial = openDatabase(partialPath)
  try {
    partial.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);'
      + "INSERT INTO schema_migrations VALUES (1, 'x'); INSERT INTO schema_migrations VALUES (2, 'y');"
      + 'CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, status_policy TEXT NOT NULL);'
      + 'CREATE TABLE connector_account (id TEXT PRIMARY KEY);'
      + 'CREATE TABLE provider_binding (id TEXT PRIMARY KEY, implementation_key TEXT NOT NULL, connector_account_id TEXT);'
      + 'CREATE TABLE workspace_binding (workspace_id TEXT NOT NULL, binding_id TEXT NOT NULL, domain TEXT NOT NULL, enabled INTEGER NOT NULL, is_default INTEGER NOT NULL, configuration_json TEXT, PRIMARY KEY (workspace_id, binding_id, domain));')
  } finally { partial.close() }
  const partialBefore = fingerprint(partialPath)
  assert.throws(() => createSqliteStorage(partialPath, policy()), /连接账号/, '残缺列集的 connector_account 必须在 migrate 之前拒绝')
  assert.equal(fingerprint(partialPath), partialBefore, '残缺列集的拒绝必须零写入（含零新增表）')
  const partialAfter = openDatabase(partialPath)
  try { assert.deepEqual(partialAfter.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version), [1, 2], '残缺列集不得先落 003–005') } finally { partialAfter.close() }
})

test('constructor-failure-releases-handle-and-policy-is-frozen', () => {
  // 非法策略必须在任何 IO 之前失败：不迁移、不留记账、不泄漏句柄（P2-R1 / P2-R3）。
  const badPolicies = [
    { allowedSecretHandles: new Set(), configurations: new Map([['impl.x', { scope: { kind: 'nope', required: true } }]]) },
    { allowedSecretHandles: new Set(), configurations: new Map([['impl.x', { scope: null }]]) },
    null,
  ]
  for (const [index, bad] of badPolicies.entries()) {
    const path = join(tempDir(`connector-account-bad-policy-${index}-`), 'bad.sqlite')
    const before = readdirSync('/dev/fd').length
    for (let attempt = 0; attempt < 3; attempt += 1) assert.throws(() => createSqliteStorage(path, bad), RangeError, '非法策略必须构造失败')
    assert.ok(readdirSync('/dev/fd').length - before <= 0, '失败构造不得逐次泄漏句柄')
    const db = openDatabase(path)
    try { assert.equal(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(), undefined, '非法策略必须先于 migrate 失败：不得落迁移记账') } finally { db.close() }
  }
  // 直接构造的调用方同样受保护。
  const directPath = join(tempDir('connector-account-direct-ctor-'), 'direct.sqlite')
  const raw = openDatabase(directPath)
  assert.throws(() => new SqliteStorage(directPath, raw, false, undefined, undefined, badPolicies[0]), RangeError, '直接构造非法策略必须拒绝')
  assert.throws(() => raw.prepare('SELECT 1 AS ok').get(), '直接构造失败后调用方句柄必须已关闭')
  // 默认策略不可被重定义属性扩权（P2-R3）。
  assert.ok(Object.isFrozen(EMPTY_POLICY), '默认策略必须冻结属性描述符')
  assert.throws(() => Object.defineProperty(EMPTY_POLICY, 'allowedSecretHandles', { value: new Set(['ESCALATED']) }), '默认策略的 getter 不得被重定义')
  createSqliteStorage(join(tempDir('connector-account-frozen-policy-'), 'frozen.sqlite')).close()
})

test('secret-canary-never-published', async () => {
  const CANARY = 'ghp_CANARY_5ecr3t_do_not_persist'; const encoded = Buffer.from(CANARY, 'utf8').toString('base64')
  const scan = (text) => text.includes(CANARY) || text.includes(encoded)
  const controlDir = tempDir('connector-account-canary-control-') // 阳性对照：扫描器必须能发现真的写进文件的 canary
  writeFileSync(join(controlDir, 'control.txt'), `token=${CANARY}`)
  assert.ok(readdirSync(controlDir).some((name) => scan(readFileSync(join(controlDir, name), 'latin1'))), '阳性对照：扫描器必须发现写入文件的 canary')
  const dir = tempDir('connector-account-canary-'); const storage = createSqliteStorage(join(dir, 'workspace.sqlite'), policy())
  const messages = []
  const attempt = async (work) => { try { await work() } catch (error) { messages.push(String(error?.message ?? error)) } }
  await attempt(() => storage.putConnectorAccount(account({ id: 'account-canary', secretHandle: CANARY })))
  await attempt(() => storage.putConnectorAccount(account({ id: 'account-canary-hidden', secretHandle: { ref: CANARY } })))
  await attempt(() => storage.putBindingConfiguration({ ref, configuration: { scope: CANARY } }))
  assert.equal((await storage.listConnectorAccounts()).length, 0, 'canary 句柄必须被拒绝，不留行')
  storage.close()
  const dbFiles = readdirSync(dir).map((name) => readFileSync(join(dir, name), 'latin1'))
  assert.ok(dbFiles.length > 0, '前置：库文件必须存在')
  assert.equal(dbFiles.filter(scan).length, 0, 'DB/WAL/SHM 中不得出现 canary 原文或 base64')
  for (const message of messages) assert.ok(!scan(message), `错误文本不得回显输入：${message}`)
  const fake = createFakeStorage(undefined, policy())
  await assert.rejects(fake.putConnectorAccount(account({ id: 'account-canary', secretHandle: CANARY })), RangeError)
  assert.ok(!scan(JSON.stringify(exportFakeStorageState(fake))), 'Fake export 不得出现 canary')
  await seed(fake)
  const published = await (await createContext({ workspace: { id: WORKSPACE, name: '工作区' }, providers: { planning: createFakePlanningProvider({ bindingId: 'conn-restart' }) }, storage: fake })).storage.listProviderBindings(WORKSPACE)
  assert.deepEqual(published.map((record) => Object.keys(record).sort()), [['domain', 'enabled', 'id', 'implementationKey', 'isDefault', 'workspaceId'].sort()], '发布面只含原挂载字段：不得出现句柄或配置')
  assert.ok(!scan(JSON.stringify(published)), '发布面不得出现 canary')
})
