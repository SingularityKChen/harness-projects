/**
 * 观察版本载体的世代步骤（issue #203，PR #240 评审 5352511875）：旧版本写过的库里，`sync_observation.updated_at`
 * 可能持有不再合法的载体（`v9`、秒级或带偏移的时间戳、sha）。入口断言只挡新观察，已持久化的旧值原样留在账本里，
 * 会让后写入的规范观察被码点序判成乱序、静默丢弃。这里让「已有行的版本列在定义域内」这条不变量有拥有者：
 *   - 分类规则只有一份（`classifyCarriers`，复用 capabilities 的归一函数）；迁移 005 的预检、005 的数据步骤与显式修复共用。
 *   - 能无损归一的，由迁移 005 在事务内改写（`snapshot_json` 不动，它是端口收到的原样记录）。
 *   - 不能定序的，整库在任何待应用迁移之前被拒绝，库文件逐字节不变（`LegacySourceVersionError`）。
 *   - 保留数据的恢复路径是 `repairLegacySourceVersions`：先 `VACUUM INTO` 备份并核对，再把不可定序值降为无版本。
 * 改写后端口写入的每一行满足：`updated_at === 规范化(snapshot.observation.sourceVersion)`，无版本与不可定序记为 `''`。
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { isComparableSourceVersion, sourceVersionFromTimestamp } from '@harness-projects/capabilities'
import { openDatabase, type WorkspaceDatabase } from './db.ts'
import type { MigrationDataStep } from './migrations.ts'

/** 重写前的 003 缺端口主体列与 `dedupe_key`，或仓库挂载键仍是单列 `id`（#187 / #188 之前），或同步游标主键不是 `(workspace_id, binding_id, scope_key)`（#189 之前）：显式报错，把「旧库」变成一句可执行的处置，而不是第一次写观察或第二个工作区挂载时的驱动级报错。 */
export const REWRITTEN_003_MESSAGE = '本地库是重写前的 003（sync_observation 缺端口主体列或 dedupe_key，repository 的主键不是 (workspace_id, id)，或 sync_cursor 的主键不是 (workspace_id, binding_id, scope_key)）：请显式决定并删除库文件重建（程序不会升级也不会删库）'

/**
 * `sync_observation` 存在而 003 不是重写后的形状（判据见 `REWRITTEN_003_MESSAGE`）时抛错；返回表是否存在（尚未迁移时不判定）。
 * 游标按 pk 序比较完整主键列名串：只看有无 workspace 列判不出「列在而主键仍两元」，只数列数判不出顺序错。
 */
export function assertRewritten003Shape(db: WorkspaceDatabase): boolean {
  if (db.prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'sync_observation'`).get() === undefined) return false
  const shape = db.prepare(`SELECT count(*) AS subject_columns FROM pragma_table_info('sync_observation') WHERE name IN ('object_kind','dedupe_key')`).get() as { subject_columns: number }
  const mount = db.prepare(`SELECT count(*) AS key_columns FROM pragma_table_info('repository') WHERE pk > 0`).get() as { key_columns: number }
  const cursorKey = (db.prepare(`SELECT name FROM pragma_table_info('sync_cursor') WHERE pk > 0 ORDER BY pk`).all() as { name: string }[]).map((row) => row.name).join(',')
  if (shape.subject_columns < 2 || mount.key_columns !== 2 || cursorKey !== 'workspace_id,binding_id,scope_key') throw new Error(REWRITTEN_003_MESSAGE)
  return true
}

export interface CarrierSample { readonly bindingId: string; readonly objectKind: string; readonly externalId: string; readonly updatedAt: string }

/** 恢复入口写进错误文案，文案里的步骤与 `repairLegacySourceVersions` 的行为一一对应。 */
const REPAIR_STEPS = '恢复步骤：停掉打开该库的进程，调用 repairLegacySourceVersions(<库文件>, { backupPath })（先备份并核对，再把这些行降为无版本，保留全部行），然后重新打开'

/** 旧载体拒绝：预检不执行迁移；事务内拒绝只回滚本条，先前成功提交的版本仍保留。 */
export class LegacySourceVersionError extends Error {
  readonly code: 'legacy_source_version'
  readonly unorderableRows: number
  readonly samples: readonly CarrierSample[]
  readonly phase: 'preflight' | 'migration'
  readonly appliedVersions: readonly number[]
  constructor(unorderableRows: number, samples: readonly CarrierSample[], phase: 'preflight' | 'migration' = 'preflight', appliedVersions: readonly number[] = []) {
    const shown = samples.map((sample) => `${sample.updatedAt}（${sample.bindingId}/${sample.objectKind}/${sample.externalId}）`).join('、')
    const state = phase === 'preflight' ? '库未被修改，本修复之前的版本仍可打开它。'
      : `拒绝发生在载体迁移事务内；迁移运行器只回滚本条，先前已提交的迁移不会撤销。当前已提交版本为 [${appliedVersions.join(', ')}]。`
    super(`旧库里有 ${unorderableRows} 行观察的版本载体无法无损归一为规范载体，例如 ${shown}。${state}${REPAIR_STEPS}`)
    this.name = 'LegacySourceVersionError'
    this.code = 'legacy_source_version'
    this.unorderableRows = unorderableRows
    this.samples = samples
    this.phase = phase
    this.appliedVersions = appliedVersions
  }
}

interface Unorderable { readonly value: string; readonly rows: number }
export interface CarrierClassification {
  /** 原值 → 规范值（原值不是规范载体，但能无损归一）。 */
  readonly normalizable: ReadonlyMap<string, string>
  readonly unorderable: readonly Unorderable[]
}

/**
 * 分类规则的唯一实现：`''`（无版本）与规范载体保留；`sourceVersionFromTimestamp` 成功的是可归一值；抛 `RangeError` 的是不可定序值。
 * 表不存在时返回空结果；先做旧形状检查，保证 005 绝不改写一张随后会被拒绝的旧形状表。
 */
export function classifyCarriers(db: WorkspaceDatabase): CarrierClassification {
  const normalizable = new Map<string, string>()
  const unorderable: Unorderable[] = []
  if (!assertRewritten003Shape(db)) return { normalizable, unorderable }
  const groups = db.prepare('SELECT updated_at, count(*) AS rows FROM sync_observation GROUP BY updated_at').all() as { updated_at: string; rows: number }[]
  for (const { updated_at: value, rows } of groups) {
    if (value === '' || isComparableSourceVersion(value)) continue
    try { normalizable.set(value, sourceVersionFromTimestamp(value)) } catch (error) {
      if (!(error instanceof RangeError)) throw error
      unorderable.push({ value, rows: Number(rows) })
    }
  }
  return { normalizable, unorderable }
}

const SAMPLE_LIMIT = 5

function legacyError(db: WorkspaceDatabase, unorderable: readonly Unorderable[], phase: 'preflight' | 'migration'): LegacySourceVersionError {
  const samples: CarrierSample[] = []
  const select = db.prepare('SELECT binding_id, object_kind, object_external_id FROM sync_observation WHERE updated_at = ? ORDER BY rowid LIMIT ?')
  for (const { value } of unorderable) {
    if (samples.length >= SAMPLE_LIMIT) break
    for (const row of select.all(value, SAMPLE_LIMIT - samples.length) as { binding_id: string; object_kind: string; object_external_id: string }[]) {
      samples.push({ bindingId: row.binding_id, objectKind: row.object_kind, externalId: row.object_external_id, updatedAt: value })
    }
  }
  const hasVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() !== undefined
  const applied = hasVersions ? (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((row) => row.version) : []
  return new LegacySourceVersionError(unorderable.reduce((sum, item) => sum + item.rows, 0), samples, phase, applied)
}

/**
 * 重新分类并改写 `updated_at`。`reject`：有不可定序值即抛 `LegacySourceVersionError`，否则只归一；`demote`：不可定序值降为 `''`。
 * 只改 `updated_at`（它是从 `snapshot_json` 推导出的排序键，不在任何键里，原地改写不会冲突）。事务由调用方负责。
 */
export function rewriteCarriers(db: WorkspaceDatabase, policy: 'reject' | 'demote'): { readonly normalized: number } {
  const { normalizable, unorderable } = classifyCarriers(db)
  if (policy === 'reject' && unorderable.length > 0) throw legacyError(db, unorderable, 'migration')
  const update = db.prepare('UPDATE sync_observation SET updated_at = ? WHERE updated_at = ?')
  let normalized = 0
  for (const [value, canonical] of normalizable) normalized += Number(update.run(canonical, value).changes)
  if (policy === 'demote') for (const { value } of unorderable) update.run('', value)
  return { normalized }
}

/** 迁移 005 的数据步骤：预检只读，权威判定在 005 的 `BEGIN IMMEDIATE` 之内（`apply` 重新分类）。 */
export const SOURCE_VERSION_CARRIER_STEP: MigrationDataStep = {
  preflight(db) {
    const { unorderable } = classifyCarriers(db)
    if (unorderable.length > 0) throw legacyError(db, unorderable, 'preflight')
  },
  apply(db) { rewriteCarriers(db, 'reject') },
}

export interface LegacyRepairResult {
  /** 备份文件路径；库里没有非规范载体时不备份，为 `undefined`。 */
  readonly backupPath: string | undefined
  /** 被归一的行数。 */
  readonly normalized: number
  /** 被降为无版本的行（按 rowid 序）；操作者应对这些绑定触发全量对账。`updatedAt` 是降级前的原值。 */
  readonly demoted: readonly { readonly bindingId: string; readonly objectKind: string; readonly externalId: string; readonly dedupeKey: string; readonly updatedAt: string }[]
}

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`
const tablesOf = (db: WorkspaceDatabase): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
const rowCount = (db: WorkspaceDatabase, table: string): number => Number((db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get() as { n: number }).n)

/** 备份核对：`integrity_check` 为 `ok` 且每张表的行数与原库相等；不等即抛错，调用方回滚，原库不变。 */
function verifyBackup(source: WorkspaceDatabase, backupPath: string): void {
  const backup = new DatabaseSync(backupPath, { readOnly: true })
  try {
    const check = (backup.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
    if (check !== 'ok') throw new Error(`备份未通过完整性检查：${check}`)
    for (const table of tablesOf(source)) {
      const expected = rowCount(source, table)
      const actual = rowCount(backup, table)
      if (actual !== expected) throw new Error(`备份核对失败：表 ${table} 行数为 ${actual}，原库为 ${expected}`)
    }
  } finally { backup.close() }
}

/**
 * 保留数据的恢复路径，由人调用，不会自动触发。库里没有非规范载体时什么也不做（幂等，不备份）。否则：备份目标已存在即拒绝，
 * `VACUUM INTO` 备份（它不能在事务里执行），再在一个写事务里先核对备份、后把可归一的归一、不可定序的**降为无版本**（`updated_at = ''`），
 * 行、去重历史和其他表都留在活库里，原始载体仍在 `snapshot_json` 与备份里。降为无版本让之后任何规范观察都能胜过这些行，
 * 但丢掉了这些行之间的相对次序，所以只在明确调用、备份已核对之后发生。它不要求版本 5 未应用。
 */
export function repairLegacySourceVersions(location: string, options: { readonly backupPath: string }): LegacyRepairResult {
  if (location === ':memory:') throw new Error('内存库没有可备份的文件，无法修复')
  if (!existsSync(location)) throw new Error(`库文件不存在：${location}`)
  const db = openDatabase(location)
  try {
    const found = classifyCarriers(db)
    if (found.normalizable.size === 0 && found.unorderable.length === 0) return { backupPath: undefined, normalized: 0, demoted: [] }
    if (existsSync(options.backupPath)) throw new Error(`备份目标已存在，拒绝覆盖：${options.backupPath}`)
    db.prepare('VACUUM INTO ?').run(options.backupPath)
    db.exec('BEGIN IMMEDIATE')
    try {
      // 在写锁之内核对：VACUUM INTO 之后若有并发写入，行数不等即回滚；核对之后到提交之前不会再有别的写入。
      verifyBackup(db, options.backupPath)
      const demotedValues = new Set(classifyCarriers(db).unorderable.map((item) => item.value))
      const demoted: LegacyRepairResult['demoted'][number][] = []
      for (const row of db.prepare('SELECT binding_id, object_kind, object_external_id, dedupe_key, updated_at FROM sync_observation ORDER BY rowid').iterate() as Iterable<{ binding_id: string; object_kind: string; object_external_id: string; dedupe_key: string; updated_at: string }>) {
        if (demotedValues.has(row.updated_at)) demoted.push({ bindingId: row.binding_id, objectKind: row.object_kind, externalId: row.object_external_id, dedupeKey: row.dedupe_key, updatedAt: row.updated_at })
      }
      const { normalized } = rewriteCarriers(db, 'demote')
      db.exec('COMMIT')
      return { backupPath: options.backupPath, normalized, demoted }
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* SQLite 可能已自动回滚；不要用回滚错误覆盖真正的失败原因 */ }
      throw error
    }
  } finally { db.close() }
}
