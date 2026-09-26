/** Git 只接受 argv，不拼 shell 字符串；runner 可注入以记录调用或注入故障。
 * 路径安全的零调用断言数的是经此 runner 的调用；argv-only 由源码扫描保证。
 * 默认 runner 将启动失败也折叠为结构化结果，调用方不接裸异常。 */
import { execFile } from 'node:child_process'

export interface GitInvocation {
  readonly code: number; readonly stdout: string; readonly stderr: string
}

export type GitRunner = (args: readonly string[]) => Promise<GitInvocation>

/** git 不存在或无法启动也算一次调用结果（stderr 带上启动错误），调用方拿到的永远是结构化结果而不是裸异常。 */
export const defaultGitRunner: GitRunner = (args) => new Promise((resolve) => {
  execFile('git', [...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error === null) {
      resolve({ code: 0, stdout, stderr })
      return
    }
    resolve({
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: stdout ?? '',
      stderr: stderr === '' ? error.message : stderr,
    })
  })
})
