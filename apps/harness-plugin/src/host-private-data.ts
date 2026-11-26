import fs from 'node:fs'
import path from 'node:path'
import { assertPrivateAcl } from './host-private-acl.ts'
import { WORKSPACE_SELECTION_FILE } from './host-selection.ts'
import { prepareWindowsProjectData } from './host-private-windows.ts'
import { HostAuthorityError } from './remote.ts'

const ACL_STARTUP_BUDGET_MS = 3000
const unavailable = () => new HostAuthorityError('Host project data is unavailable')
export interface PreparedPrivateData {
  readonly directory: string
  readonly logFd: number
  /** 导航偏好文件 fd：启动期打开并校验，运行期只重写它（不按路径重开）。 */
  readonly selectionFd: number
  readonly lease?: Awaited<ReturnType<typeof prepareWindowsProjectData>>
}

function uid(): number {
  if (!['darwin', 'linux'].includes(process.platform) || typeof process.getuid !== 'function'
    || !fs.constants.O_NOFOLLOW || !fs.constants.O_DIRECTORY) throw unavailable()
  return process.getuid()
}

function owned(entry: fs.Stats, owner: number, directory: boolean): void {
  if (entry.uid !== owner || (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)) throw unavailable()
}

/** 创建或收紧同一个已验证对象；失败路径也关闭本次获得的 fd。 */
async function privateDirectory(directory: string, owner: number, deadline: number, signal?: AbortSignal): Promise<number> {
  let fd: number | undefined
  try {
    signal?.throwIfAborted()
    try { fs.mkdirSync(directory, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
    owned(fs.fstatSync(fd), owner, true)
    await assertPrivateAcl([fd], deadline, signal)
    fs.fchmodSync(fd, 0o700)
    if ((fs.fstatSync(fd).mode & 0o777) !== 0o700) throw unavailable()
    return fd
  } catch (error) { if (fd !== undefined) fs.closeSync(fd); throw error }
}

/** 只准备 Host 指定的固定两层，不遍历或改变 Git 后代；调用方须已保护插件根。 */
export async function preparePrivateWorktreeDirectories(worktreesDir: string, allowedRoot: string, signal?: AbortSignal, lease?: PreparedPrivateData['lease']): Promise<void> {
  if (process.platform === 'win32') {
    if (!lease) throw unavailable()
    return lease.assertDirectories([worktreesDir, allowedRoot], signal)
  }
  const fds: number[] = []
  try {
    const owner = uid(), deadline = performance.now() + ACL_STARTUP_BUDGET_MS
    if (path.basename(worktreesDir) !== 'worktrees' || path.dirname(allowedRoot) !== worktreesDir) throw unavailable()
    const root = fs.openSync(path.dirname(worktreesDir), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
    fds.push(root)
    const entry = fs.fstatSync(root)
    owned(entry, owner, true)
    if ((entry.mode & 0o777) !== 0o700) throw unavailable()
    await assertPrivateAcl([root], deadline, signal)
    for (const directory of [worktreesDir, allowedRoot]) fds.push(await privateDirectory(directory, owner, deadline, signal))
  } catch { throw unavailable() }
  finally { for (const fd of fds) fs.closeSync(fd) }
}

/** profileContext 已由 Host canonicalize；逐级只验证，不改 profile 或祖先权限。 */
export async function assertPrivateDataParent(directory: string, signal?: AbortSignal): Promise<void> {
  const fds: number[] = []
  try {
    const owner = uid(), deadline = performance.now() + ACL_STARTUP_BUDGET_MS
    const open = (location: string): number => {
      if (fds.length >= 64) throw unavailable()
      const fd = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
      fds.push(fd); return fd
    }
    let child = fs.fstatSync(open(directory))
    owned(child, owner, true)
    if (child.mode & 0o022) throw unavailable()
    let location = directory
    while (path.dirname(location) !== location) {
      location = path.dirname(location)
      const ancestor = fs.fstatSync(open(location))
      if (!ancestor.isDirectory() || ![owner, 0].includes(ancestor.uid)) throw unavailable()
      // sticky 保护受信 child 的名字（例如 root 拥有的 /tmp）；其它可写祖先可被异 uid rename。
      if ((ancestor.mode & 0o022) && (!(ancestor.mode & 0o1000) || ![owner, 0].includes(child.uid))) throw unavailable()
      child = ancestor
    }
    await assertPrivateAcl(fds, deadline, signal)
  } catch { throw unavailable() }
  finally { for (const fd of fds) fs.closeSync(fd) }
}

/** 只管理受信 Host 选定的插件根和固定文件；隔离其它 OS uid，不隔离同 uid 进程。 */
export async function preparePrivateProjectData(dataPath: string, signal?: AbortSignal, rawProfile?: string): Promise<PreparedPrivateData> {
  if (process.platform === 'win32') {
    if (!rawProfile || dataPath !== rawProfile + path.sep + 'harness-projects' + path.sep + 'workspace.sqlite') throw unavailable()
    const lease = await prepareWindowsProjectData(rawProfile, signal)
    // 原生 helper 已 Ensure 并校验该固定文件；这里只取一个持久 fd，运行期不按路径重开（与 logFd 同模式）。
    // 打开失败时回收已取得的 Node fd，再释放 helper lease；两者分别拥有资源。
    let selectionFd: number
    try { selectionFd = fs.openSync(path.join(lease.directory, WORKSPACE_SELECTION_FILE), fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600) }
    catch (error) {
      try { fs.closeSync(lease.logFd) } catch { /* 获取失败仍是权威错误；继续释放 helper。 */ }
      try { await lease.dispose() } catch { /* 不把清理原文带出安全边界。 */ }
      throw error instanceof HostAuthorityError ? error : unavailable()
    }
    return { directory: lease.directory, logFd: lease.logFd, selectionFd, lease }
  }
  let rootFd: number | undefined
  const files: number[] = []
  try {
    const owner = uid(), directory = path.dirname(dataPath), deadline = performance.now() + ACL_STARTUP_BUDGET_MS
    rootFd = await privateDirectory(directory, owner, deadline, signal)
    const file = (location: string, create: boolean, append = false): number | undefined => {
      // 不打开已知 device/FIFO；nofollow + fstat 仍是最终判定，O_NONBLOCK 防止替换为 FIFO 后挂起。
      try { owned(fs.lstatSync(location), owner, false) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (!create) return }
      const flags = fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
        | (append ? fs.constants.O_WRONLY | fs.constants.O_APPEND : fs.constants.O_RDWR)
        | (create ? fs.constants.O_CREAT : 0)
      const fd = fs.openSync(location, flags, 0o600)
      files.push(fd)
      owned(fs.fstatSync(fd), owner, false)
      return fd
    }
    file(dataPath, true)
    for (const suffix of ['-wal', '-shm', '-journal']) file(dataPath + suffix, false)
    const selectionFd = file(path.join(directory, WORKSPACE_SELECTION_FILE), true)!
    file(path.join(directory, 'diagnostics.log'), true, true)
    await assertPrivateAcl(files, deadline, signal)
    for (const fd of files) {
      fs.fchmodSync(fd, 0o600)
      if ((fs.fstatSync(fd).mode & 0o777) !== 0o600) throw unavailable()
    }
    // 两个 fd 交给调用方；其余（含 sidecar）在 finally 关闭。
    files.splice(files.indexOf(selectionFd), 1)
    return { directory, logFd: files.pop()!, selectionFd }
  } catch { throw unavailable() }
  finally { for (const fd of files) fs.closeSync(fd); if (rootFd !== undefined) fs.closeSync(rootFd) }
}
