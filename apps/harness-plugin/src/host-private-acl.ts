import childProcess from 'node:child_process'

// Darwin libc / sys/acl.h: ACL_TYPE_EXTENDED=256, ACL_EXTENDED_DENY=2,
// ENOENT=2 means no extended ACL on this open fd; valid ACL iteration ends with EINVAL=22.
// Query typed ACE tags, never names/text: inherited and only_inherit allow entries still refuse.
const QUERY = `
ObjC.bindFunction('acl_get_fd_np',['void *',['int','int']]);
ObjC.bindFunction('__error',['int *',[]]);
ObjC.bindFunction('acl_valid',['int',['void *']]);
ObjC.bindFunction('acl_get_entry',['int',['void *','int','void **']]);
ObjC.bindFunction('acl_get_tag_type',['int',['void *','int *']]);
ObjC.bindFunction('acl_free',['int',['void *']]);
function admit(fd) {
  var err = $.__error();
  err[0] = 0;
  var acl = $.acl_get_fd_np(fd, 256);
  if (err[0] === 2) return;
  if (err[0] !== 0) throw Error('acl_read_failed');
  try {
    if ($.acl_valid(acl) !== 0) throw Error('acl_invalid');
    var entry = Ref(), tag = Ref();
    for (var i = 0; i <= 169; i++) {
      err[0] = 0;
      var status = $.acl_get_entry(acl, i, entry);
      if (status === -1 && err[0] === 22) return;
      if (status !== 0 || $.acl_get_tag_type(entry[0], tag) !== 0 || tag[0] !== 2) {
        throw Error('acl_not_deny_only');
      }
    }
    throw Error('acl_limit');
  } finally {
    $.acl_free(acl);
  }
}
function run(argv) {
  if (argv.length !== 1 || !/^([1-9]|[1-5][0-9]|6[0-4])$/.test(argv[0])) throw Error('acl_fd_count');
  for (var i = 0; i < Number(argv[0]); i++) admit(3 + i);
  return 'private-acl-v1';
}`

/** 只读已验证 fd；系统 JXA 仅桥接 libc，不调用 GUI/Apple Events，无 pathname 输入。 */
export async function assertPrivateAcl(fds: readonly number[], deadline: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (process.platform === 'linux') return // Linux POSIX access ACL 的 named-user/group 受 chmod 的 group mask 约束。
  const remaining = deadline - performance.now()
  if (process.platform !== 'darwin' || remaining <= 0 || fds.length === 0 || fds.length > 64) throw new Error('acl_unavailable')
  await new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', QUERY, '--', String(fds.length)], {
      stdio: ['ignore', 'pipe', 'pipe', ...fds], env: { LANG: 'C', LC_ALL: 'C' }, signal,
      timeout: Math.min(1000, remaining), killSignal: 'SIGKILL',
    })
    let failed = !child.stdout || !child.stderr, bytes = 0, output = ''
    const consume = (chunk: Buffer, stderr: boolean): void => {
      bytes += chunk.length
      if (bytes > 1024) { failed = true; child.kill('SIGKILL') }
      else if (stderr) failed = true
      else output += chunk.toString('utf8')
    }
    child.stdout?.on('data', (chunk: Buffer) => consume(chunk, false))
    child.stderr?.on('data', (chunk: Buffer) => consume(chunk, true))
    child.once('error', () => { failed = true })
    // 等 close 而非 error：abort/timeout 后，继承的 fd 与子进程必须已释放再交回 owner。
    child.once('close', (code) => {
      if (!failed && code === 0 && output === 'private-acl-v1\n') resolve()
      else reject(new Error('acl_unavailable'))
    })
  })
}
