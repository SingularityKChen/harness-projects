/** 连接账号与工作区配置的共享契约装配（#126）：6 条共享用例在 Fake 与 SQLite 上同形运行；条数守卫独立写死 6，删掉一条 register(...) 或整组不再装配都会变红。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createFakeStorage, exportFakeStorageState } from '@harness-projects/provider-fake'
import { createSqliteStorage } from '@harness-projects/storage-sqlite'
import { CONNECTOR_ACCOUNT_NAMED_CASES, CONNECTOR_ACCOUNT_SHARED_CASES, countConnectorAccountCases, policy, storageConnectorAccountSuite } from './suites/storage-connector-account.js'

const sqliteDir = mkdtempSync(join(tmpdir(), 'connector-account-contract-'))
after(() => rmSync(sqliteDir, { recursive: true, force: true }))
let files = 0
/** 每个用例一个库文件；`restart` 真的关句柄再打开同一个文件，且按同一份受信策略打开。 */
const sqliteAdapter = (suffix = '') => {
  const locations = new Map()
  return {
    label: `SQLite Storage${suffix}`,
    makeStorage: (p = policy()) => { const location = join(sqliteDir, `connector-account${suffix}-${files++}.sqlite`); const storage = createSqliteStorage(location, p); locations.set(storage, location); return storage },
    restart: (storage, p = policy()) => { const location = locations.get(storage); storage.close(); return createSqliteStorage(location, p) },
    // 裸写通道（等价于旧版本进程 / 运维 SQL）：读口必须复验而不是原样返回（对抗验证 P2-3）。
    tamper: (storage) => storage.db.exec("UPDATE connector_account SET secret_handle = 'DISALLOWED_HANDLE'; UPDATE workspace_binding SET configuration_json = '{\"bogus\":true}'"),
  }
}
const fakeAdapter = (suffix = '') => ({
  label: `内存 Storage 替身${suffix}`,
  makeStorage: (p = policy()) => createFakeStorage(undefined, p),
  restart: (storage, p = policy()) => createFakeStorage(exportFakeStorageState(storage), p),
  tamper: (storage) => { if (storage.data.accounts[0]) storage.data.accounts[0].secretHandle = 'DISALLOWED_HANDLE'; if (storage.data.bindingConfigurations[0]) storage.data.bindingConfigurations[0].configuration = { bogus: true } },
})
storageConnectorAccountSuite(sqliteAdapter())
storageConnectorAccountSuite(fakeAdapter())

test('连接账号契约套件守卫：8 个具名用例覆盖共享组与集成专属，且 6 条共享用例在两个适配器上都注册', () => {
  assert.deepEqual(CONNECTOR_ACCOUNT_NAMED_CASES, ['one-account-three-domains', 'immutable-account-and-anchor-identity', 'configuration-is-workspace-scoped',
    'trusted-handle-only', 'registration-and-removal-preserve-account', 'metadata-transaction-and-copy-isolation',
    'restart-and-empty-schema-repeatability', 'secret-canary-never-published'])
  assert.equal(countConnectorAccountCases(storageConnectorAccountSuite), CONNECTOR_ACCOUNT_SHARED_CASES.length, '套件条数必须等于独立写死的具名用例表：删掉一条 register(...) 会在这里变红')
  for (const adapter of [sqliteAdapter('-count'), fakeAdapter('-count')]) {
    let registered = 0
    storageConnectorAccountSuite(adapter, () => { registered += 1 })
    assert.equal(registered, CONNECTOR_ACCOUNT_SHARED_CASES.length, `${adapter.label} 必须注册全部 6 条共享用例`)
  }
})
