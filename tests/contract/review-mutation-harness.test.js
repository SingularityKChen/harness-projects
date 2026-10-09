/**
 * 评审变异夹具契约测试（`scripts/review-mutate.mjs`）。
 *
 * 保护的性质：变异表是评审定级的证据，夹具自己出错时结论会朝两个方向错——把「没施加」
 * 读成「用例没牙」，或者把修复连同变异一起还原掉。2026-09-18 到 2026-10-07 之间这两类
 * 各发生过多次（见 `docs/review/` 的批次记录）。本文件固定：
 *
 * 1. 锚点出现 0 次或多于 1 次（重叠的出现也算）→ NOT_APPLIED，不跑测试，退出码非 0；
 * 2. 只在某个时区才红的变异，只给 UTC 时报 SURVIVED，加上该时区才报 KILLED；
 * 3. `killedBy` 指定的用例没红而别的用例红了 → KILLED_OTHER；spec 与 TAP 两种报告格式都解析；
 * 4. spec 不合法、文件不存在或解析到 root 之外 → 夹具错误（退出码 2），在跑任何命令之前；
 *    基线或还原后基线不绿 → 夹具错误；
 * 5. 每次运行结束被变异的文件与运行前逐字节相同，包括不是合法 UTF-8 的文件——临时目录不是
 *    git 仓库，证明还原不依赖 git；
 * 6. SIGINT / SIGTERM / SIGHUP 中断时（包括基线运行期间），即使命令经过 `sh -c` 包装、孙进程
 *    还活着或不理会信号，也在数秒内还原、不留孤儿进程并以 130 退出；
 * 7. 输出管道被提前关闭、夹具因未捕获异常退出时，正在施加的变异照样还原；
 * 8. 被信号杀死的运行算红。
 *
 * 这些用例自己有没有牙，用夹具变异夹具来证明（在仓库根目录运行，期望全部 KILLED、退出码 0）：
 *
 *     node scripts/review-mutate.mjs tests/contract/fixtures/review-mutate-self.json
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HARNESS = fileURLToPath(new URL('../../scripts/review-mutate.mjs', import.meta.url))

const LIB = [
  'export const add = (a, b) => a + b',
  "export const label = 'ok'",
  "export const left = 'x'",
  "export const right = 'x'",
  'export const hourOf = (ms) => new Date(ms).getUTCHours()',
  'export const unused = 1',
  "export const triple = 'a, a, a'",
  '',
].join('\n')

const TESTS = [
  "import assert from 'node:assert/strict'",
  "import test from 'node:test'",
  "import { add, label, hourOf } from './lib.mjs'",
  "test('add sums', () => assert.equal(add(2, 3), 5))",
  "test('label is ok', () => assert.equal(label, 'ok'))",
  "test('epoch hour is zero', () => assert.equal(hourOf(0), 0))",
  '',
].join('\n')

const COMMAND = ['node', '--test', 'lib.test.mjs']

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mutate-harness-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'lib.mjs'), LIB)
  writeFileSync(path.join(root, 'lib.test.mjs'), TESTS)
  return root
}

function start(root, spec) {
  const specPath = path.join(root, 'spec.json')
  writeFileSync(specPath, JSON.stringify(spec))
  const child = spawn(process.execPath, [HARNESS, specPath, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, output })))
  return { child, done, output: () => output }
}

const harness = (root, spec) => start(root, spec).done

const bytesOf = (root, file = 'lib.mjs') => readFileSync(path.join(root, file))
const sameBytes = (root, expected, file = 'lib.mjs') => assert.ok(bytesOf(root, file).equals(Buffer.from(expected)), `${file} 与原文字节不同`)

const summary = (output) => {
  const line = output.split('\n').find((l) => l.startsWith('SUMMARY '))
  assert.ok(line, `没有 SUMMARY 行：\n${output}`)
  return Object.fromEntries(JSON.parse(line.slice('SUMMARY '.length)).map((r) => [r.id, r.status]))
}

const PLUS = { file: 'lib.mjs', anchor: 'a + b', replacement: 'a - b' }
const LOCAL_HOURS = { file: 'lib.mjs', anchor: 'getUTCHours', replacement: 'getHours' }

test('五种结论各自可区分，且结束时文件逐字节还原', async (t) => {
  const root = fixture(t)
  const { code, output } = await harness(root, {
    command: COMMAND,
    runs: [{ TZ: 'UTC' }],
    mutants: [
      { id: 'killed', ...PLUS, killedBy: 'add sums' },
      { id: 'other', ...PLUS, killedBy: 'label is ok' },
      { id: 'survived', file: 'lib.mjs', anchor: 'unused = 1', replacement: 'unused = 2' },
      { id: 'missing', file: 'lib.mjs', anchor: 'no such anchor', replacement: 'x' },
      { id: 'ambiguous', file: 'lib.mjs', anchor: "'x'", replacement: "'y'" },
      { id: 'overlap', file: 'lib.mjs', anchor: 'a, a', replacement: 'b, b' },
      { id: 'utc-only', ...LOCAL_HOURS },
      { id: 'two-zones', ...LOCAL_HOURS, runs: [{ TZ: 'UTC' }, { TZ: 'Asia/Shanghai' }], killedBy: 'epoch hour' },
    ],
  })

  assert.equal(code, 1, output)
  assert.deepEqual(summary(output), {
    killed: 'KILLED',
    other: 'KILLED_OTHER',
    survived: 'SURVIVED',
    missing: 'NOT_APPLIED',
    ambiguous: 'NOT_APPLIED',
    overlap: 'NOT_APPLIED',
    'utc-only': 'SURVIVED',
    'two-zones': 'KILLED',
  })
  assert.match(output, /ambiguous NOT_APPLIED（锚点出现 2 次）/)
  assert.match(output, /overlap NOT_APPLIED（锚点出现 2 次）/)
  sameBytes(root, LIB)
})

test('全部 KILLED 时退出码为 0；只多一个 NOT_APPLIED 也不是 0', async (t) => {
  const root = fixture(t)
  const killed = { id: 'm', ...PLUS, killedBy: 'add sums' }
  const all = await harness(root, { command: COMMAND, mutants: [killed] })
  assert.equal(all.code, 0, all.output)
  assert.deepEqual(summary(all.output), { m: 'KILLED' })

  const stale = await harness(root, {
    command: COMMAND,
    mutants: [killed, { id: 'stale', file: 'lib.mjs', anchor: 'a * b', replacement: 'a / b' }],
  })
  assert.equal(stale.code, 1, stale.output)
  assert.deepEqual(summary(stale.output), { m: 'KILLED', stale: 'NOT_APPLIED' })
})

test('基线不绿时是夹具错误，不施加任何变异', async (t) => {
  const root = fixture(t)
  writeFileSync(path.join(root, 'lib.test.mjs'), `${TESTS}test('red', () => assert.fail('baseline'))\n`)
  const { code, output } = await harness(root, { command: COMMAND, mutants: [{ id: 'm', ...PLUS }] })
  assert.equal(code, 2, output)
  assert.match(output, /HARNESS_ERROR 基线/)
  assert.doesNotMatch(output, /SUMMARY/)
  sameBytes(root, LIB)
})

test('解析到 root 之外的文件（含符号链接）被拒绝，已施加的变异照常还原', async (t) => {
  const root = fixture(t)
  const outside = mkdtempSync(path.join(os.tmpdir(), 'mutate-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(path.join(outside, 'victim.mjs'), 'export const v = 1\n')
  symlinkSync(path.join(outside, 'victim.mjs'), path.join(root, 'link.mjs'))

  for (const file of ['../' + path.basename(outside) + '/victim.mjs', 'link.mjs']) {
    const { code, output } = await harness(root, {
      command: COMMAND,
      mutants: [
        { id: 'inside', ...PLUS },
        { id: 'escape', file, anchor: 'v = 1', replacement: 'v = 2' },
      ],
    })
    assert.equal(code, 2, output)
    assert.match(output, /root 之外/)
    sameBytes(outside, 'export const v = 1\n', 'victim.mjs')
    sameBytes(root, LIB)
    assert.doesNotMatch(output, /^inside /m, '文件校验应当在跑任何变异之前')
  }
})

test('非 UTF-8 字节与多字节锚点都按字节施加、按字节还原', async (t) => {
  const root = fixture(t)
  const original = Buffer.concat([
    Buffer.from("// note\nexport const n = 1\nexport const word = '标签'\nexport const legacy = 'caf"),
    Buffer.from([0xe9]),
    Buffer.from("'\n"),
  ])
  writeFileSync(path.join(root, 'lib.mjs'), original)
  writeFileSync(
    path.join(root, 'lib.test.mjs'),
    [
      "import assert from 'node:assert/strict'",
      "import test from 'node:test'",
      "import { readFileSync } from 'node:fs'",
      "import { n, word } from './lib.mjs'",
      "test('n is one', () => assert.equal(n, 1))",
      "test('word is 标签', () => assert.equal(word, '标签'))",
      // 施加期间文件里的其他字节必须原样：Latin-1 的 0xE9 仍在，没有被重新编码。
      "test('legacy byte intact', () => assert.ok(readFileSync('lib.mjs').includes(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x27]))))",
      '',
    ].join('\n'),
  )
  const { code, output } = await harness(root, {
    command: COMMAND,
    mutants: [
      { id: 'ascii', file: 'lib.mjs', anchor: 'n = 1', replacement: 'n = 2', killedBy: 'n is one' },
      { id: 'multibyte', file: 'lib.mjs', anchor: "'标签'", replacement: "'标记'", killedBy: 'word is' },
      // 只改注释：字节写对了就没有用例变红。
      { id: 'inert', file: 'lib.mjs', anchor: '// note', replacement: '// nota' },
    ],
  })
  assert.equal(code, 1, output)
  assert.deepEqual(summary(output), { ascii: 'KILLED', multibyte: 'KILLED', inert: 'SURVIVED' })
  sameBytes(root, original)
})

test('spec 不合法、文件不存在或不是普通文件，在跑任何命令之前就报夹具错误', { timeout: 120_000 }, async (t) => {
  const root = fixture(t)
  const ok = { id: 'm', ...PLUS }
  const cases = [
    [{ command: 'node --test lib.test.mjs', mutants: [ok] }, /command 必须是非空字符串数组/],
    [{ command: [], mutants: [ok] }, /command 必须是非空字符串数组/],
    [{ command: COMMAND, runs: [], mutants: [ok] }, /runs 必须是非空/],
    [{ command: COMMAND, runs: [{ TZ: 1 }], mutants: [ok] }, /runs 必须是非空/],
    [{ command: COMMAND, mutants: [] }, /mutants 必须非空/],
    [{ command: COMMAND, mutants: [ok, ok] }, /变异 id 重复/],
    [{ command: COMMAND, mutants: [{ id: 'm', file: 'lib.mjs', replacement: 'x' }] }, /缺少字符串字段 anchor/],
    [{ command: COMMAND, mutants: [{ ...ok, anchor: '' }] }, /anchor 不能为空/],
    [{ command: COMMAND, mutants: [{ ...ok, replacement: ok.anchor }] }, /replacement 与 anchor 相同/],
    [{ command: COMMAND, mutants: [{ ...ok, runs: [] }] }, /runs 必须是非空/],
    [{ command: COMMAND, mutants: [{ ...ok, killedBy: '' }] }, /killedBy 必须是非空字符串/],
    [{ command: COMMAND, mutants: [{ ...ok, killedBy: 1 }] }, /killedBy 必须是非空字符串/],
    [{ command: COMMAND, mutants: [ok, { id: 'ghost', file: 'nope.mjs', anchor: 'x', replacement: 'y' }] }, /HARNESS_ERROR nope\.mjs 不存在/],
    [{ command: COMMAND, mutants: [ok, { id: 'dir', file: '.', anchor: 'x', replacement: 'y' }] }, /不是普通文件/],
  ]
  for (const [spec, message] of cases) {
    // 校验漏掉时夹具可能挂死（例如空锚点让计数死循环）：超时就 SIGKILL，不让用例跟着挂住。
    const run = start(root, spec)
    let timer
    const outcome = await Promise.race([
      run.done,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          run.child.kill('SIGKILL')
          resolve({ code: 'timeout', output: run.output() })
        }, 10_000)
      }),
    ])
    clearTimeout(timer)
    assert.equal(outcome.code, 2, `${message}：${outcome.output}`)
    assert.match(outcome.output, message)
    assert.doesNotMatch(outcome.output, /^m /m, `${message}：校验应当在跑任何变异之前`)
  }
  sameBytes(root, LIB)
})

test('被信号杀死的运行算红', async (t) => {
  const root = fixture(t)
  writeFileSync(
    path.join(root, 'selfkill.mjs'),
    "import { readFileSync } from 'node:fs'\nif (readFileSync('lib.mjs', 'utf8').includes('a - b')) process.kill(process.pid, 'SIGKILL')\n",
  )
  const { code, output } = await harness(root, { command: ['node', 'selfkill.mjs'], mutants: [{ id: 'm', ...PLUS }] })
  assert.equal(code, 0, output)
  assert.deepEqual(summary(output), { m: 'KILLED' })
  assert.match(output, /m \[env=inherit\] RED exit=128/)
})

test('输出管道提前关闭、夹具因 EPIPE 退出时，正在施加的变异照样还原', async (t) => {
  const root = fixture(t)
  const many = [{ A: '1' }, { A: '2' }, { A: '3' }]
  const run = start(root, {
    command: COMMAND,
    mutants: [
      { id: 'm1', ...PLUS, runs: many },
      { id: 'm2', ...LOCAL_HOURS, runs: many },
      { id: 'm3', file: 'lib.mjs', anchor: 'unused = 1', replacement: 'unused = 2', runs: many },
    ],
  })
  // 读到第一行就关掉读端，相当于 `| head -1`。
  run.child.stdout.once('data', () => run.child.stdout.destroy())
  await run.done
  sameBytes(root, LIB)
})

test('TAP 报告格式下同样能按用例名区分 KILLED 与 KILLED_OTHER', async (t) => {
  const root = fixture(t)
  const { code, output } = await harness(root, {
    command: ['node', '--test', '--test-reporter=tap', 'lib.test.mjs'],
    mutants: [
      { id: 'right', ...PLUS, killedBy: 'add sums' },
      { id: 'wrong', ...PLUS, killedBy: 'label is ok' },
    ],
  })
  assert.equal(code, 1, output)
  assert.deepEqual(summary(output), { right: 'KILLED', wrong: 'KILLED_OTHER' })
})

test('变异运行污染了环境、还原后基线变红时是夹具错误', async (t) => {
  const root = fixture(t)
  // 看到变异后的源码就留下 poison：之后每次运行都红，模拟会污染状态的测试。
  writeFileSync(
    path.join(root, 'lib.test.mjs'),
    [
      "import assert from 'node:assert/strict'",
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
      "import test from 'node:test'",
      "if (readFileSync('lib.mjs', 'utf8').includes('a - b')) writeFileSync('poison', '1')",
      "test('not poisoned', () => assert.ok(!existsSync('poison')))",
      '',
    ].join('\n'),
  )
  const { code, output } = await harness(root, { command: COMMAND, mutants: [{ id: 'm', ...PLUS }] })
  assert.equal(code, 2, output)
  assert.match(output, /HARNESS_ERROR 还原后基线/)
  sameBytes(root, LIB)
})

test('三种信号中断时，包装进程下也在数秒内还原并以 130 退出', { timeout: 120_000 }, async (t) => {
  const root = fixture(t)
  const flag = path.join(root, 'applied.flag')
  // 只在看到变异后的源码时挂起：基线照常秒过，变异期间留下标志并等待被中断。
  // `sh -c '…; true'` 让 sh 留在中间，sleeper 是孙进程并继承输出管道。
  writeFileSync(
    path.join(root, 'sleeper.mjs'),
    [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "if (readFileSync('lib.mjs', 'utf8').includes('a - b')) {",
      `  writeFileSync(${JSON.stringify(flag)}, String(process.pid))`,
      '  setTimeout(() => {}, 30_000)',
      '}',
      '',
    ].join('\n'),
  )
  // 不理会信号的命令：夹具会一直等它，还原只能靠信号处理里的同步写回。
  writeFileSync(
    path.join(root, 'stubborn.mjs'),
    `for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => {})\n${readFileSync(path.join(root, 'sleeper.mjs'), 'utf8')}`,
  )
  const alive = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  // 最后一种：命令不理会信号。第一次信号后命令还活着、夹具还在等，文件必须已经还原；
  // 第二次信号让夹具 SIGKILL 整组并立即退出。
  // SIGTERM 配不理会信号的孙进程：sh 先退出，夹具收尾时仍要结束剩下的孙进程。
  const cases = [
    ['SIGINT', 1, 'sleeper.mjs'],
    ['SIGTERM', 1, 'sleeper.mjs'],
    ['SIGHUP', 1, 'sleeper.mjs'],
    ['SIGINT', 2, 'stubborn.mjs'],
    ['SIGTERM', 1, 'stubborn.mjs'],
  ]
  for (const [signal, times, script] of cases) {
    rmSync(flag, { force: true })
    const run = start(root, { command: ['sh', '-c', `node ${script}; true`], mutants: [{ id: 'm', ...PLUS }] })
    t.after(() => run.child.kill('SIGKILL'))
    const deadline = Date.now() + 20_000
    while (!existsSync(flag) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(existsSync(flag), `${signal}×${times}：变异期间的子进程没有启动：\n${run.output()}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const sleeper = Number(readFileSync(flag, 'utf8'))
    assert.ok(!bytesOf(root).equals(Buffer.from(LIB)), `${signal}×${times}：中断前变异应当已经施加`)

    run.child.kill(signal)
    if (times === 2) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.ok(alive(sleeper), '不理会信号的命令应当还活着')
      sameBytes(root, LIB)
      run.child.kill(signal)
    }
    const outcome = await Promise.race([
      run.done,
      new Promise((resolve) => setTimeout(() => resolve({ code: 'timeout', output: run.output() }), 8_000)),
    ])
    assert.equal(outcome.code, 130, `${signal}×${times}：${outcome.output}`)
    if (times === 1) assert.match(outcome.output, /INTERRUPTED/)
    sameBytes(root, LIB)
    const gone = Date.now() + 3_000
    while (alive(sleeper) && Date.now() < gone) await new Promise((resolve) => setTimeout(resolve, 50))
    assert.ok(!alive(sleeper), `${signal}×${times}：命令的孙进程在中断后仍然存活`)
  }
})

test('命令派生出脱离进程组的孙进程时，中断后夹具不被它握着的管道拖住', { timeout: 60_000 }, async (t) => {
  const root = fixture(t)
  const flag = path.join(root, 'escaped.flag')
  // 变异期间派生一个自成进程组、继承输出管道、不理会信号的孙进程，然后自己挂起。
  // 进程组 SIGKILL 够不着它；夹具只能靠不再读管道才能退出。
  writeFileSync(
    path.join(root, 'escape.mjs'),
    [
      "import { spawn } from 'node:child_process'",
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "if (readFileSync('lib.mjs', 'utf8').includes('a - b')) {",
      "  const g = spawn(process.execPath, ['-e', \"for (const s of ['SIGINT','SIGTERM','SIGHUP']) process.on(s, () => {}); setTimeout(() => {}, 30000)\"], { detached: true, stdio: 'inherit' })",
      `  writeFileSync(${JSON.stringify(flag)}, String(g.pid))`,
      '  setTimeout(() => {}, 30_000)',
      '}',
      '',
    ].join('\n'),
  )
  const run = start(root, { command: ['node', 'escape.mjs'], mutants: [{ id: 'm', ...PLUS }] })
  t.after(() => run.child.kill('SIGKILL'))
  const deadline = Date.now() + 20_000
  while (!existsSync(flag) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.ok(existsSync(flag), `变异期间的子进程没有启动：\n${run.output()}`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const escaped = Number(readFileSync(flag, 'utf8'))
  t.after(() => {
    try {
      process.kill(escaped, 'SIGKILL')
    } catch {}
  })

  run.child.kill('SIGINT')
  const outcome = await Promise.race([
    run.done,
    new Promise((resolve) => setTimeout(() => resolve({ code: 'timeout', output: run.output() }), 8_000)),
  ])
  assert.equal(outcome.code, 130, outcome.output)
  sameBytes(root, LIB)
})

test('基线运行期间被中断时以 130 退出，不报基线不绿', { timeout: 60_000 }, async (t) => {
  const root = fixture(t)
  const flag = path.join(root, 'baseline.flag')
  // 只在看到原文时挂起：基线就卡住，等待被中断。
  writeFileSync(
    path.join(root, 'stall.mjs'),
    [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "if (readFileSync('lib.mjs', 'utf8').includes('a + b')) {",
      `  writeFileSync(${JSON.stringify(flag)}, '1')`,
      '  setTimeout(() => {}, 30_000)',
      '}',
      '',
    ].join('\n'),
  )
  const run = start(root, { command: ['node', 'stall.mjs'], mutants: [{ id: 'm', ...PLUS }] })
  t.after(() => run.child.kill('SIGKILL'))
  const deadline = Date.now() + 20_000
  while (!existsSync(flag) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  assert.ok(existsSync(flag), `基线没有启动：\n${run.output()}`)
  run.child.kill('SIGINT')
  const { code, output } = await run.done
  assert.equal(code, 130, output)
  assert.match(output, /INTERRUPTED/)
  assert.doesNotMatch(output, /HARNESS_ERROR/)
  sameBytes(root, LIB)
})
