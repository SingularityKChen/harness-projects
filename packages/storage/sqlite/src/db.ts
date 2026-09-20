import { DatabaseSync } from 'node:sqlite'

/** 并发访问同一个库时先等待，而不是立刻抛 SQLITE_BUSY。 */
export const BUSY_TIMEOUT_MS = 5000

/**
 * 迁移运行器需要的最小能力集合。
 * 刻意不暴露整个 DatabaseSync：调用方只应依赖这三件事。
 */
export type WorkspaceDatabase = Pick<DatabaseSync, 'exec' | 'prepare' | 'close'>

/**
 * 打开（必要时创建）数据库，并落实本包依赖的两条连接级设置。
 *
 * foreign_keys 必须显式打开：SQLite 默认不校验外键，悬空引用会被静默接受。
 */
export function openDatabase(location: string | ':memory:'): WorkspaceDatabase {
  const db = new DatabaseSync(location)
  db.exec('PRAGMA foreign_keys = ON')
  // BUSY_TIMEOUT_MS 是本地数值常量，不是外部输入。
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  return db
}
