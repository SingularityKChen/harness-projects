/** 导航偏好（#693）：私有根 workspace-selection.json 的严格编解码；只存不透明 id 与确认时刻。 */
import fs from 'node:fs'

export const WORKSPACE_SELECTION_FILE = 'workspace-selection.json'
/** 严格闭集的大小上限；超过即视为损坏，不尝试解析。 */
export const WORKSPACE_SELECTION_MAX_BYTES = 4096

export interface WorkspaceSelection {
  readonly workspaceId: string
  readonly confirmedAt: string
}
export type WorkspaceSelectionRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'corrupt' | 'unreadable' }
  | { readonly kind: 'selection'; readonly selection: WorkspaceSelection }

/** 与客户端展示校验同一口径的 ISO 8601 时间（toISOString 形状，毫秒 + Z）。 */
const CONFIRMED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const KEYS = ['version', 'workspaceId', 'confirmedAt'] as const

/** 严格闭集：恰好三个键、version 1、非空不透明 id 与合法时间；其它一律视为损坏（不猜、不修复）。 */
export function parseWorkspaceSelection(text: string): WorkspaceSelection | undefined {
  if (text.length === 0 || text.length > WORKSPACE_SELECTION_MAX_BYTES) return undefined
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== KEYS.length || !KEYS.every((key) => Object.hasOwn(record, key))) return undefined
  if (record.version !== 1) return undefined
  const { workspaceId, confirmedAt } = record
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '' || workspaceId.length > 256) return undefined
  if (typeof confirmedAt !== 'string' || !CONFIRMED_AT.test(confirmedAt) || Number.isNaN(Date.parse(confirmedAt))) return undefined
  return Object.freeze({ workspaceId, confirmedAt })
}

export function readWorkspaceSelection(fd: number): WorkspaceSelectionRead {
  try {
    const size = fs.fstatSync(fd).size
    if (size === 0) return { kind: 'none' }
    if (size > WORKSPACE_SELECTION_MAX_BYTES) return { kind: 'corrupt' }
    const buffer = Buffer.alloc(size)
    if (fs.readSync(fd, buffer, 0, size, 0) !== size) return { kind: 'unreadable' }
    const selection = parseWorkspaceSelection(buffer.toString('utf8'))
    return selection === undefined ? { kind: 'corrupt' } : { kind: 'selection', selection }
  } catch { return { kind: 'unreadable' } }
}

/** 覆盖写同一 fd：先写满（覆盖旧内容）再 fsync，最后把残留旧尾部截到精确长度再 fsync。
 * 任何崩溃窗口只可能留下可解析的旧值或 corrupt，不会变成「0 字节 = 无偏好」而静默打开唯一已存项目。
 * 写失败由调用方只记诊断，不改变切换结果。 */
export function writeWorkspaceSelection(fd: number, selection: WorkspaceSelection): void {
  const bytes = Buffer.from(JSON.stringify({ version: 1, workspaceId: selection.workspaceId, confirmedAt: selection.confirmedAt }), 'utf8')
  if (bytes.length > WORKSPACE_SELECTION_MAX_BYTES) throw new RangeError('workspace selection is too large')
  let offset = 0
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset)
    if (written <= 0) throw new Error('workspace selection write failed')
    offset += written
  }
  fs.fsyncSync(fd)
  if (fs.fstatSync(fd).size > bytes.length) { fs.ftruncateSync(fd, bytes.length); fs.fsyncSync(fd) }
}

/** 关闭启动期打开的偏好 fd；重复关闭不抛错。 */
export function closeWorkspaceSelection(fd: number | undefined): void {
  if (fd === undefined) return
  try { fs.closeSync(fd) } catch { /* 关闭失败不改变 Host 结果 */ }
}
