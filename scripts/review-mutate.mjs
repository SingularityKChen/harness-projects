#!/usr/bin/env node
/**
 * 变异批：逐个施加锚点替换，跑测试，按原文字节还原。
 *
 *     node scripts/review-mutate.mjs <spec.json> [--root <dir>]
 *
 * spec 形状：
 *
 *     {
 *       "command": ["node", "--test", "tests/contract/x.test.js"],
 *       "runs": [{ "TZ": "UTC" }],
 *       "mutants": [
 *         { "id": "M1", "file": "packages/a/src/x.ts", "anchor": "…", "replacement": "…",
 *           "runs": [{ "TZ": "UTC" }, { "TZ": "Asia/Shanghai" }], "killedBy": "用例名片段" }
 *       ]
 *     }
 *
 * 它保护的是评审里反复出过错的三件事：
 *
 * 1. 「变异后仍绿」与「变异根本没施加」输出一样。锚点不是恰好出现一次（重叠的出现也算）就报
 *    NOT_APPLIED，不跑测试，也不计为存活。
 * 2. 用 `git checkout --` 还原会连同未提交的修复一起抹掉。这里在施加前把原文按字节读进内存，
 *    跑完写回并逐字节比对，不依赖 git，工作树脏、文件不是合法 UTF-8 也安全。SIGINT / SIGTERM /
 *    SIGHUP 在信号处理里同步还原，并把信号转给命令的整个进程组，不等孙进程关闭管道；命令不理会
 *    信号时再发一次，夹具 SIGKILL 整组并立即退出。
 * 3. 红了也要看是哪条用例红。给了 `killedBy` 时，红的那几次运行里没有一个失败名（用例或所在
 *    套件，子串匹配）含它，就报 KILLED_OTHER。失败名从 spec 与 TAP 两种报告格式里解析。不给
 *    `killedBy` 时，KILLED 只说明有运行变红（包括被信号杀死），不判归因。
 *
 * 夹具自己因为未捕获异常退出时（例如输出接到提前关闭的管道上），`exit` 钩子同步还原正在施加的
 * 变异；被中断收尾时 SIGKILL 命令进程组里剩下的进程，不留孤儿。
 *
 * 退出码：0 = 全部 KILLED；1 = 有 SURVIVED / KILLED_OTHER / NOT_APPLIED；2 = 夹具自身出错
 * （spec 不合法、文件不存在或在 root 之外、基线或还原后基线不绿、还原不等），此时结论一律不可用；
 * 130 = 被信号中断，已还原，结论不完整。
 */

import { spawn } from 'node:child_process'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

class HarnessError extends Error {}

function parseArgs(argv) {
  const args = { spec: undefined, root: process.cwd() }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = argv[++i]
    else if (args.spec === undefined) args.spec = argv[i]
    else throw new HarnessError(`多余的参数：${argv[i]}`)
  }
  if (!args.spec) throw new HarnessError('用法：review-mutate.mjs <spec.json> [--root <dir>]')
  return args
}

const isStringArray = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string')
const isRuns = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && Object.values(r).every((s) => typeof s === 'string'))

function validate(spec) {
  if (!isStringArray(spec.command)) throw new HarnessError('command 必须是非空字符串数组（argv，不经 shell）')
  if (spec.runs !== undefined && !isRuns(spec.runs)) throw new HarnessError('runs 必须是非空的环境变量对象数组')
  if (!Array.isArray(spec.mutants) || spec.mutants.length === 0) throw new HarnessError('mutants 必须非空')
  const ids = new Set()
  for (const m of spec.mutants) {
    for (const key of ['id', 'file', 'anchor', 'replacement']) {
      if (typeof m[key] !== 'string') throw new HarnessError(`变异 ${m.id ?? '?'} 缺少字符串字段 ${key}`)
    }
    if (ids.has(m.id)) throw new HarnessError(`变异 id 重复：${m.id}`)
    ids.add(m.id)
    if (m.anchor === '') throw new HarnessError(`${m.id}：anchor 不能为空`)
    if (m.anchor === m.replacement) throw new HarnessError(`${m.id}：replacement 与 anchor 相同，施加后文件不会变`)
    if (m.runs !== undefined && !isRuns(m.runs)) throw new HarnessError(`${m.id}：runs 必须是非空的环境变量对象数组`)
    if (m.killedBy !== undefined && (typeof m.killedBy !== 'string' || m.killedBy === '')) {
      throw new HarnessError(`${m.id}：killedBy 必须是非空字符串`)
    }
  }
}

/** 文件必须存在、是普通文件，并解析到 root 之内（含符号链接解析后），防止 spec 改写仓库外的文件。 */
function resolveInside(root, file) {
  let real
  try {
    real = realpathSync(path.resolve(root, file))
  } catch {
    throw new HarnessError(`${file} 不存在`)
  }
  if (real !== root && !real.startsWith(root + path.sep)) throw new HarnessError(`${file} 解析到 root 之外：拒绝`)
  if (!statSync(real).isFile()) throw new HarnessError(`${file} 不是普通文件`)
  return real
}

/** 出现次数，重叠的也算：`a, a` 在 `a, a, a` 里出现两次。 */
function occurrences(text, anchor) {
  let count = 0
  for (let i = text.indexOf(anchor); i !== -1; i = text.indexOf(anchor, i + 1)) count += 1
  return count
}

/**
 * 按字节施加：latin1 把每个字节映射成一个字符，锚点与替换文本先按 UTF-8 编码再同样映射，
 * 于是查找与替换都在字节上进行，文件里不合法的 UTF-8 序列原样保留。
 */
const asBytes = (text) => Buffer.from(text, 'utf8').toString('latin1')

/** spec 报告器的 `✖ 名字 (1.2ms)` 与 TAP 的 `not ok N - 名字`，去重。 */
function failingTests(output) {
  const names = [
    ...[...output.matchAll(/^\s*✖ (.+?) \(\d[\d.]*m?s\)\s*$/gm)].map((m) => m[1]),
    ...[...output.matchAll(/^\s*not ok \d+ - (.+?)(?: # .*)?$/gm)].map((m) => m[1]),
  ]
  return [...new Set(names)]
}

let activeChild
let activeGroup // 命令的进程组号；中断后命令自己先退出时仍保留，第二次信号与收尾据此结束剩下的进程
let applied // { file, original }：正在施加的变异，信号处理与 exit 钩子据此同步还原
let interrupted = false

function restore(file, original) {
  writeFileSync(file, original)
  if (!readFileSync(file).equals(original)) throw new HarnessError(`${file} 还原后与原文不等`)
}

/** 结束命令的整个进程组：包装进程（`sh -c …`）下的孙进程也一起结束。 */
function killGroup(signal) {
  if (activeGroup === undefined) return
  try {
    process.kill(-activeGroup, signal)
  } catch {
    activeChild?.kill(signal)
  }
}

/**
 * 子进程环境去掉 NODE_TEST_CONTEXT：在 `node --test` 之内再起 `node --test` 时，继承这个变量
 * 会让孙进程改用父 runner 的序列化输出，失败用例名就解析不到了。
 * `detached` 让命令自成进程组，中断时才能整组结束。
 */
function runOnce(command, cwd, env) {
  const childEnv = { ...process.env, ...env }
  delete childEnv.NODE_TEST_CONTEXT
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    activeChild = child
    activeGroup = child.pid
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    const done = (code, signal) => {
      activeChild = undefined
      if (interrupted) {
        // 孙进程可能还握着管道：不再读，事件循环才能结束。
        child.stdout.destroy()
        child.stderr.destroy()
      } else {
        activeGroup = undefined
      }
      resolve({ env, exit: code ?? (signal ? 128 : 1), failing: failingTests(output) })
    }
    // 中断时不等 stdio 关闭：继承了管道的孙进程可能还活着。
    child.on('exit', (code, signal) => { if (interrupted) done(code, signal) })
    child.on('close', done)
  })
}

/** 中断收尾：结束命令进程组里剩下的进程，结论不完整。 */
function finishInterrupted() {
  killGroup('SIGKILL')
  console.log('INTERRUPTED：已还原全部文件，结论不完整')
  return 130
}

const envLabel = (env) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ') || 'env=inherit'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = realpathSync(args.root)
  const spec = JSON.parse(readFileSync(args.spec, 'utf8'))
  validate(spec)
  const files = new Map(spec.mutants.map((m) => [m.id, resolveInside(root, m.file)]))
  const defaultRuns = spec.runs ?? [{}]
  const runsOf = (m) => m.runs ?? defaultRuns

  const distinct = [...new Map([defaultRuns, ...spec.mutants.map(runsOf)].flat().map((e) => [JSON.stringify(e), e])).values()]
  for (const env of distinct) {
    const r = await runOnce(spec.command, root, env)
    if (interrupted) return finishInterrupted()
    if (r.exit !== 0) throw new HarnessError(`基线在 ${envLabel(env)} 下不绿（exit ${r.exit}），变异结论不可用：${r.failing.join('；')}`)
  }

  const originals = new Map()
  const results = []
  for (const m of spec.mutants) {
    if (interrupted) break
    const file = files.get(m.id)
    const original = readFileSync(file)
    if (!originals.has(file)) originals.set(file, original)
    const text = original.toString('latin1')
    const count = occurrences(text, asBytes(m.anchor))
    if (count !== 1) {
      results.push({ id: m.id, status: 'NOT_APPLIED', reason: `锚点出现 ${count} 次`, runs: [] })
      console.log(`${m.id} NOT_APPLIED（锚点出现 ${count} 次）`)
      continue
    }
    const runs = []
    applied = { file, original }
    try {
      writeFileSync(file, Buffer.from(text.replace(asBytes(m.anchor), () => asBytes(m.replacement)), 'latin1'))
      if (readFileSync(file).equals(original)) throw new HarnessError(`${m.id}：写入后文件未变`)
      for (const env of runsOf(m)) {
        if (interrupted) break
        const r = await runOnce(spec.command, root, env)
        runs.push(r)
        console.log(`${m.id} [${envLabel(env)}] ${r.exit === 0 ? 'GREEN' : 'RED'} exit=${r.exit} failing=${JSON.stringify(r.failing)}`)
      }
    } finally {
      applied = undefined
      restore(file, original)
    }
    if (interrupted) break
    const red = runs.filter((r) => r.exit !== 0)
    const status = red.length === 0
      ? 'SURVIVED'
      : m.killedBy === undefined || red.some((r) => r.failing.some((name) => name.includes(m.killedBy)))
        ? 'KILLED'
        : 'KILLED_OTHER'
    results.push({ id: m.id, status, runs })
  }

  for (const [file, original] of originals) {
    if (!readFileSync(file).equals(original)) throw new HarnessError(`${path.relative(root, file)} 结束时与原文不等`)
  }
  if (interrupted) return finishInterrupted()
  for (const env of distinct) {
    const r = await runOnce(spec.command, root, env)
    if (interrupted) return finishInterrupted()
    if (r.exit !== 0) throw new HarnessError(`还原后基线在 ${envLabel(env)} 下不绿（exit ${r.exit}）`)
  }
  console.log(`SUMMARY ${JSON.stringify(results.map(({ id, status, reason }) => ({ id, status, ...(reason ? { reason } : {}) })))}`)
  return results.every((r) => r.status === 'KILLED') ? 0 : 1
}

// 未捕获异常（例如 stdout 的 EPIPE）会绕过 finally 与信号处理；exit 钩子是最后一道还原。
process.on('exit', () => {
  if (applied) restore(applied.file, applied.original)
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    // 第一次：同步还原、把信号转给命令的进程组，主循环随后以 130 收尾。
    // 命令不理会信号时夹具会一直等它；再来一次就 SIGKILL 整组并立即退出。
    if (applied) restore(applied.file, applied.original)
    applied = undefined
    if (interrupted) {
      killGroup('SIGKILL')
      process.exit(130)
    }
    interrupted = true
    killGroup(signal)
  })
}

main().then(
  (code) => { process.exitCode = code },
  (error) => {
    console.error(error instanceof HarnessError ? `HARNESS_ERROR ${error.message}` : error)
    process.exitCode = 2
  },
)
