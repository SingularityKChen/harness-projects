/** Git 只接受 argv，不拼 shell 字符串；runner 可注入以记录调用或注入故障。
 * 路径安全的零调用断言数的是经此 runner 的调用；argv-only 由源码扫描保证。
 * 默认 runner 将启动失败也折叠为结构化结果，调用方不接裸异常。 */
import { execFile } from 'node:child_process'

export interface GitInvocation {
  readonly code: number; readonly stdout: string; readonly stderr: string
  readonly interrupted?: boolean
}

export type GitRunner = (args: readonly string[]) => Promise<GitInvocation>

/** git 不存在或无法启动也算一次调用结果（stderr 带上启动错误），调用方拿到的永远是结构化结果而不是裸异常。 */
export const defaultGitRunner: GitRunner = (args) => new Promise((resolve) => {
  execFile('git', [...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
    if (error === null) {
      resolve({ code: 0, stdout, stderr })
      return
    }
    resolve({
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: stdout ?? '',
      stderr: stderr === '' ? error.message : stderr,
      interrupted: error.killed === true || error.signal != null || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    })
  })
})

/** Node Stats 不暴露任意 reparse tag；原生数值属性探针只接受 stdin JSON，不解释路径或本地化输出。
 * 逐分量（含悬空链接）读属性；不存在是允许的新尾部，其余未知错误均关闭准入。 */
const WINDOWS_METADATA = `
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
$paths=([Console]::In.ReadToEnd()|ConvertFrom-Json)
$safe=$true
foreach($p in $paths){
  $root=[IO.Path]::GetPathRoot($p)
  $drive=[IO.DriveInfo]::new($root)
  if([int]$drive.DriveType -ne 3 -or $drive.DriveFormat -ne 'NTFS'){ $safe=$false; break }
  $current=$root
  $parts=@('')+@($p.Substring($root.Length).Split([char]'\\'))
  foreach($part in $parts){
    if($part){ $current=[IO.Path]::Combine($current,$part) }
    try { if(([int][IO.File]::GetAttributes($current) -band 1024) -ne 0){ $safe=$false; break } }
    catch { if(($_.Exception.GetBaseException().HResult -band 65535) -notin @(2,3)){ throw }; break }
  }
  if(-not $safe){ break }
}
$safe|ConvertTo-Json -Compress
`
export const windowsPathsArePlain = (paths: readonly string[]): Promise<boolean> => new Promise((resolve) => {
  const input = JSON.stringify(paths.map((entry) => entry.replaceAll('/', '\\')))
  if (Buffer.byteLength(input, 'utf8') > 65536) { resolve(false); return }
  let stdinFailed = false
  const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_METADATA],
    { encoding: 'utf8', maxBuffer: 65536, timeout: 10_000, windowsHide: true }, (error, stdout) => resolve(!stdinFailed && error === null && stdout.trim() === 'true'))
  child.stdin?.on('error', () => { stdinFailed = true; child.kill() })
  child.stdin?.end(input)
})
