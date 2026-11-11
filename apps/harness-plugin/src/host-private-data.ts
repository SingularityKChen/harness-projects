import fs from 'node:fs'
import path from 'node:path'
import { assertPrivateAcl } from './host-private-acl.ts'
import { HostAuthorityError } from './remote.ts'

const ACL_STARTUP_BUDGET_MS = 3000
const unavailable = () => new HostAuthorityError('Host project data is unavailable')

function uid(): number {
  if (!['darwin', 'linux'].includes(process.platform) || typeof process.getuid !== 'function'
    || !fs.constants.O_NOFOLLOW || !fs.constants.O_DIRECTORY) throw unavailable()
  return process.getuid()
}

function owned(entry: fs.Stats, owner: number, directory: boolean): void {
  if (entry.uid !== owner || (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)) throw unavailable()
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
export async function preparePrivateProjectData(dataPath: string, signal?: AbortSignal): Promise<{ readonly directory: string; readonly logFd: number }> {
  let rootFd: number | undefined
  const files: number[] = []
  try {
    const owner = uid(), directory = path.dirname(dataPath), deadline = performance.now() + ACL_STARTUP_BUDGET_MS
    try { fs.mkdirSync(directory, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    rootFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW)
    owned(fs.fstatSync(rootFd), owner, true)
    await assertPrivateAcl([rootFd], deadline, signal)
    fs.fchmodSync(rootFd, 0o700)
    if ((fs.fstatSync(rootFd).mode & 0o777) !== 0o700) throw unavailable()
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
    file(path.join(directory, 'diagnostics.log'), true, true)
    await assertPrivateAcl(files, deadline, signal)
    for (const fd of files) {
      fs.fchmodSync(fd, 0o600)
      if ((fs.fstatSync(fd).mode & 0o777) !== 0o600) throw unavailable()
    }
    return { directory, logFd: files.pop()! }
  } catch { throw unavailable() }
  finally { for (const fd of files) fs.closeSync(fd); if (rootFd !== undefined) fs.closeSync(rootFd) }
}
