// AGENTS.md §8.6（发布面）与 §8.3（PR 体量）两条规则的可执行表述。
//
// 大部分测试只测纯函数，不调用 git、不联网：规则本身是否成立，与仓库当前
// 有什么改动无关。disclosure()/size() 的 exit code 契约与「先加后删」「提交
// 信息泄露」两类场景通过注入的 git 数据源验证，同样离线；只有两条 CLI 级
// 测试用 spawnSync 真的跑一次子进程（验证 exit code 边界，不涉及网络）。
//
// 「先加后删」与「提交信息泄露」在真实 git 仓库下的端到端行为，已经用
// scratchpad 里的真实 fixture 单独验证过（见 Batch E 的验收证据），不在这
// 里重复——这里验证的是 disclosure() 面对这两类场景时的纯函数契约。

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

import {
  BUDGETS,
  DEFAULT_BASE,
  DISCLOSURE_PATTERNS,
  SIZE_EXCLUDE_RULES,
  bucketOf,
  describeBaseline,
  disclosure,
  isSizeExcluded,
  normalizePath,
  scanDiff,
  size,
  tally,
} from '../../scripts/rule-checks.mjs'

// 用拼装而不是字面量构造「坏路径」「假凭据」样本：本文件也在扫描范围内，
// 写成完整字面量会让这条规则在引入它的同一个 PR 上命中自己，凭据形状的
// 字面量还可能触发 GitHub 自己的 push protection。
const homePath = (user, rest) => ['', 'Users', user, rest].join('/')
const internalHost = (name) => `${name}.internal`
const fakeGhToken = () => ['gh', 'p_', 'a'.repeat(36)].join('')
const fakeGhPat = () => ['github_pat_', 'B'.repeat(60)].join('')
const fakeAwsKey = () => ['AKIA', 'B'.repeat(16)].join('')
const fakePemHeader = () => ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ')
// RFC1918 地址与内网 TLD 的例子同样按片段拼装：它们是本次要新增的模式的
// 正例，字面量写在源码里会在本 PR 自己的 disclosure 扫描下命中自己——
// 这份测试文件不在 SCAN_EXCLUDES 里（只有 AGENTS.md 因为是规则文本本身被
// 排除），要用与脚本同样的拼装纪律让它对自身干净，而不是再加一条排除。
const rfc1918 = (...octets) => octets.join('.')
const internalTld = (label, tld) => `${label}.${tld}`

/** 拼一段带 hunk 头的最小统一 diff：真实 diff 的形状，不是手搓的行前缀。 */
function mkDiff(file, addedLines, { oldFile } = {}) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${oldFile ?? file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((l) => `+${l}`),
  ].join('\n')
}

function captureLogs(fn) {
  const original = console.log
  const lines = []
  console.log = (...args) => lines.push(args.join(' '))
  try {
    return { result: fn(), output: lines.join('\n') }
  } finally {
    console.log = original
  }
}

/** disclosure() 的空数据源：每条测试按需覆盖其中一两个字段。 */
const noGit = {
  readDiff: () => '',
  listCommits: () => [],
  readCommitDiff: () => '',
  readCommitMessage: () => '',
  resolveRef: () => 'deadbeef1234',
  prBody: '',
}

/** CLI 入口，供 exit code 契约用例复用。 */
const SCRIPT = fileURLToPath(new URL('../../scripts/rule-checks.mjs', import.meta.url))

/** 真实的 `.github/workflows/rule-checks.yml`，供 CI 接线断言复用。 */
function loadRuleChecksWorkflow() {
  const workflowPath = fileURLToPath(new URL('../../.github/workflows/rule-checks.yml', import.meta.url))
  return parseYaml(readFileSync(workflowPath, 'utf8'))
}

test('发布面：新增行里的家目录路径会被命中，并归属到正确的文件与行号', () => {
  const diff = mkDiff('docs/a.md', [`数据库放在 ${homePath('alice', 'db/project.sqlite')}`])

  const hits = scanDiff(diff)

  assert.equal(hits.length, 1)
  assert.equal(hits[0].file, 'docs/a.md')
  assert.equal(hits[0].lineNo, 1)
  assert.equal(hits[0].pattern, '本机家目录路径')
  assert.match(hits[0].hint, /占位符/)
})

test('发布面：删除行与 diff 文件头不算命中', () => {
  const diff = [
    '--- a/docs/a.md',
    `+++ b/docs/${homePath('bob', 'notes.md').slice(1)}`, // 文件头本身长得像坏路径，也不扫描
    '@@ -1 +1 @@',
    `-旧内容提到 ${homePath('bob', 'old/path')}`,
    '+改写后的内容用 ~/… 占位',
  ].join('\n')

  assert.deepEqual(scanDiff(diff), [])
})

test('发布面：内网主机名会被命中', () => {
  const hits = scanDiff(mkDiff('docs/ops.md', [`端点是 ${internalHost('build-01')}`]))

  assert.equal(hits.length, 1)
  assert.equal(hits[0].pattern, '内网主机名')
})

test('发布面：干净的 diff 不产生命中', () => {
  const diff = mkDiff('docs/a.md', [
    '路径写成 `~/.config/<app>/db.sqlite`',
    '主机写成 `<runner-name>`',
    '提到 example.com 这种公开域名不应命中',
  ])

  assert.deepEqual(scanDiff(diff), [])
})

test('发布面：规则文本本身不是豁免——模式表非空且每条都带修改建议', () => {
  assert.ok(DISCLOSURE_PATTERNS.length >= 2)
  for (const p of DISCLOSURE_PATTERNS) {
    assert.ok(p.name.length > 0)
    assert.ok(p.hint.length > 0, `${p.name} 缺少修改建议`)
  }
})

// ---------------------------------------------------------------------------
// 凭据、RFC1918、内网 TLD（issue #40 项 1）
// ---------------------------------------------------------------------------

test('披露：四类凭据形状会被命中——这是 §10 唯一写成硬约束的类目', () => {
  for (const secret of [fakeGhToken(), fakeGhPat(), fakeAwsKey(), fakePemHeader()]) {
    const hits = scanDiff(mkDiff('x.txt', [`发现：${secret}`]))
    assert.equal(hits.length, 1, `应命中：${secret.slice(0, 10)}…`)
  }
})

test('披露：RFC1918 内网地址会被命中，公网地址不会', () => {
  const ips = [rfc1918(192, 168, 1, 42), `http://${rfc1918(10, 10, 224, 102)}`, rfc1918(172, 16, 0, 5), rfc1918(172, 31, 255, 254)]
  for (const ip of ips) {
    const hits = scanDiff(mkDiff('x.txt', [`端点 ${ip}`]))
    assert.equal(hits.length, 1, `应命中：${ip}`)
    assert.equal(hits[0].pattern, 'RFC1918 内网地址')
  }

  assert.deepEqual(scanDiff(mkDiff('x.txt', [`公网 DNS 是 ${rfc1918(8, 8, 8, 8)}`])), [])
})

test('披露：新增的内网 TLD（home/intranet）会被命中——标签含数字或连字符，形状像真实主机名', () => {
  for (const host of [internalTld('build-01', 'home'), internalTld('nas1', 'intranet')]) {
    const hits = scanDiff(mkDiff('x.txt', [`端点是 ${host}`]))
    assert.equal(hits.length, 1, `应命中：${host}`)
    assert.equal(hits[0].pattern, '内网主机名')
  }
})

// 协调者实测到的六个假阳性（issue #40 评审项 4 / RC2），packages/ui 落地后是惯用写法。
test('误报收窄：home/intranet 不再把普通 JS/TS 属性访问误判成内网主机名', () => {
  const propertyAccess = [
    'el.className = styles.home',
    'const label = messages.home',
    'if (route === routes.home)',
    '<Link to={paths.home}>',
    "t('nav.home')",
    'cfg.intranet = false',
  ]
  for (const line of propertyAccess) {
    assert.deepEqual(scanDiff(mkDiff('x.ts', [line])), [], `不应命中：${line}`)
  }
})

// ---------------------------------------------------------------------------
// 误报收窄（issue #40 项 7）——含协调者实测到的 ExecPlan 复现
// ---------------------------------------------------------------------------

test('误报收窄：dotenv/本地配置文件名、已知系统账户、CI 缓存路径、应用路由段均不命中', () => {
  const clean = [
    'add file .env.local to gitignore',
    '见 .claude/settings.local.json',
    'WORKDIR /home/node/app', // 官方 Docker node 镜像惯例
    'cache at /root/.cache/pnpm', // 标准 CI 缓存路径；root 已从 HOME_SEGMENTS 移除
    'route is /home/dashboard', // 应用内路由段，不是文件系统路径
  ]
  for (const line of clean) {
    assert.deepEqual(scanDiff(mkDiff('x.txt', [line])), [], `不应命中：${line}`)
  }
})

test('误报收窄：协调者复现的真实案例——ExecPlan 检查清单行描述模式，不是泄露', () => {
  // 这一行来自本仓库 docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md
  // 第 205 行（Batch E 自己的验收清单），在加固前会被自己命中——机械扫描
  // 的强度不能靠「排除这份文档」来凑，必须靠模式本身足够精确。
  const line =
    '- [ ] disclosure：收窄误报（`.env.local`、`*.local.json`、`/home/node`、`/root/.cache`）'
  const diff = mkDiff('docs/exec-plan/active/2026-09-18-rule-semantics-and-checker-convergence.md', [line])

  assert.deepEqual(scanDiff(diff), [])
})

test('误报收窄不是弱化用户名匹配：非豁免用户名（模拟真实家目录路径的形状）仍然命中', () => {
  for (const user of ['alice', 'bob', 'carol']) {
    const hits = scanDiff(mkDiff('x.txt', [`见 ${homePath(user, 'secret.db')}`]))
    assert.equal(hits.length, 1, `用户名 ${user} 应当仍然命中`)
    assert.equal(hits[0].pattern, '本机家目录路径')
  }
})

// ---------------------------------------------------------------------------
// hunk 解析（issue #40 项 4）
// ---------------------------------------------------------------------------

test('hunk 解析：内容以 ++ 开头的新增行不会被当成文件头丢弃', () => {
  // marker '+' 加上内容 "++仍然要命中 …"（内容自己以两个加号开头）在 diff 里
  // 长成三个连续的加号 "+++仍然要命中 …"；旧实现的 startsWith('+++') 判断
  // 会把它当文件头 continue 掉，整行（含泄露内容）直接消失，不产生命中。
  const diff = mkDiff('docs/a.md', [`++仍然要命中 ${homePath('carol', 'x')}`])

  const hits = scanDiff(diff)

  assert.equal(hits.length, 1)
  assert.equal(hits[0].file, 'docs/a.md')
})

test('hunk 解析：hunk 内容行伪造的 +++ 文件头不会篡改命中归属', () => {
  const diff = [
    '--- a/real.md',
    '+++ b/real.md',
    '@@ -0,0 +3 @@',
    '+第一行正常',
    // marker '+' 加内容 "++ b/fake/…"，在 diff 里长成 "+++ b/fake/…"——
    // 和一个真实文件头逐字节相同。旧实现按行前缀 raw.startsWith('+++ b/')
    // 判断文件头，会把 `file` 篡改成这个不存在的路径；新实现只在 hunk 外部
    // 识别文件头，这一行仍然只是内容（本身不含可命中的模式）。
    '+++ b/fake/does-not-exist.md 这不是真的文件头，只是内容长得像',
    // 真正的泄露在下一行，验证它仍然归属到 real.md 而不是上一行伪造的路径。
    `+真正的泄露在这里 ${homePath('dave', 'x')}`,
  ].join('\n')

  const hits = scanDiff(diff)

  assert.equal(hits.length, 1)
  assert.equal(hits[0].file, 'real.md')
})

test('hunk 解析：命中摘要打码匹配片段，不原样回显敏感值（公开 Actions 日志是发布面）', () => {
  const secret = fakeAwsKey()
  const hits = scanDiff(mkDiff('x.txt', [`key: ${secret}`]))

  assert.equal(hits.length, 1)
  assert.ok(!hits[0].excerpt.includes(secret), '摘要不应包含真实凭据值')
  assert.match(hits[0].excerpt, /█/)
  assert.match(hits[0].excerpt, /key:/)
})

// 整行遮蔽（issue #40 评审项 1）：一行命中 N 个模式，旧实现打印 N 条摘要，每条只遮自己那一段。
test('披露：一行命中三个模式时，每条命中的摘要都遮住全部三处敏感值，且没有字段携带未打码原文（不再保留 line 暗桩）', () => {
  const host = internalHost('build01')
  const token = fakeGhToken()
  const line = `runner at ${homePath('alice', 'actions-runner')} on ${host} key ${token}`

  const hits = scanDiff(mkDiff('x.txt', [line]))

  assert.equal(hits.length, 3, '家目录路径/内网主机名/GitHub 令牌各自成一条命中')
  for (const hit of hits) {
    assert.ok(!Object.hasOwn(hit, 'line'), '不应再存在未打码的 line 字段')
    const fields = Object.values(hit).filter((v) => typeof v === 'string')
    assert.ok(fields.every((v) => !v.includes(token) && !v.includes('alice/actions-runner') && !v.includes(host)))
  }
})

test('披露：同一行上同一模式出现两次时，两次都被遮蔽、都被报告（不是只取 regex.exec 的第一个匹配）', () => {
  const first = fakeGhToken()
  const second = ['gh', 'p_', 'b'.repeat(36)].join('') // 同类第二个 token，值不同于 first
  const hits = scanDiff(mkDiff('x.txt', [`first ${first} second ${second}`]))

  assert.equal(hits.length, 2, '同一行两个 GitHub 令牌应各自成一条命中')
  for (const hit of hits) {
    assert.ok(!hit.excerpt.includes(first) && !hit.excerpt.includes(second), `摘要不应原样回显任一令牌：${hit.excerpt}`)
  }
})

test('命中时的补救文案提到删除本次 workflow run（AGENTS.md §8.6 的恢复流程要求两者都做）', () => {
  const dirty = mkDiff('x.txt', [`见 ${homePath('alice', 'x')}`])

  const { output } = captureLogs(() => disclosure('base', { ...noGit, readDiff: () => dirty }))

  assert.match(output, /workflow run/)
})

// ---------------------------------------------------------------------------
// 自扫（issue #40 项 6）——不再豁免 scripts/rule-checks.mjs 自身
// ---------------------------------------------------------------------------

test('自扫：脚本自身源码在假想的新增 diff 下命中数为 0（拼装字面量的性质守卫）', () => {
  const selfPath = fileURLToPath(new URL('../../scripts/rule-checks.mjs', import.meta.url))
  const lines = readFileSync(selfPath, 'utf8').split('\n')
  const diff = mkDiff('scripts/rule-checks.mjs', lines)

  assert.deepEqual(scanDiff(diff), [])
})

test('自我豁免已移除：真实 git pathspec 下，脚本自身文件里的泄露仍会被扫到（不是靠拼装守住，靠没有排除）', () => {
  // 上一条测试守住的是「拼装写法让脚本对自己干净」这条性质本身；这一条
  // 测试守住的是另一条独立的性质——SCAN_EXCLUDES 不再包含
  // ':(exclude)scripts/rule-checks.mjs'。两条性质缺一都会让豁免的移除
  // 失去意义：只测前者，SCAN_EXCLUDES 悄悄加回豁免也不会被发现，因为
  // scanDiff() 本身不知道 pathspec 的存在。这里对默认（真实 git）依赖跑
  // 一次端到端：在一个临时仓库里，把「脚本自身文件」改出一处真实泄露，
  // 用默认依赖（不注入 readDiff）调用 disclosure()，验证它仍然可见。
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rule-checks-selfscan-'))
  const originalCwd = process.cwd()
  try {
    const run = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    mkdirSync(path.join(dir, 'scripts'))
    writeFileSync(path.join(dir, 'scripts', 'rule-checks.mjs'), '// placeholder\n')
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'base'])
    run(['checkout', '-q', '-b', 'feature'])
    // 往「脚本自身」文件里加一行真实会命中的内容：如果 SCAN_EXCLUDES 仍然
    // 豁免 scripts/rule-checks.mjs，这一行对 disclosure() 就是不可见的。
    appendFileSync(path.join(dir, 'scripts', 'rule-checks.mjs'), `// 调试用：见 ${homePath('erin', 'tmp')}\n`)
    run(['commit', '-aqm', 'debug leftover'])

    process.chdir(dir)
    const code = disclosure('main') // 不注入 readDiff：走真实 git 与真实 SCAN_EXCLUDES
    assert.equal(code, 1, 'scripts/rule-checks.mjs 自身的泄露应当仍被扫到，不应被豁免')
  } finally {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  }
})

// pathspec 锚定到仓库顶层（issue #40 评审项 3）：裸 `.` 是 cwd 相对的，子目录里运行会静默收窄范围。
test('pathspec：从子目录运行时仍能扫到仓库顶层的泄露，不会静默收窄范围（真实 git 仓库，不注入 readDiff）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rule-checks-pathspec-'))
  const originalCwd = process.cwd()
  try {
    const run = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    writeFileSync(path.join(dir, 'README.md'), '# fixture\n')
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'base'])
    run(['checkout', '-q', '-b', 'feature'])
    mkdirSync(path.join(dir, 'docs'))
    mkdirSync(path.join(dir, 'packages', 'core'), { recursive: true })
    // 泄露落在仓库顶层的 docs/a.md——协调者复现材料原样，不是本文件自己的泄露。
    writeFileSync(path.join(dir, 'docs', 'a.md'), `leak: ${homePath('alice', 'secret-db')}\n`)
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'add leak'])

    process.chdir(dir)
    assert.equal(disclosure('main'), 1, '从仓库根运行（对照组，这一直是对的）')

    process.chdir(path.join(dir, 'packages', 'core'))
    assert.equal(disclosure('main'), 1, '从子目录运行同样应当命中——旧实现因裸 `.` 是 cwd 相对的而静默放行')
  } finally {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  }
})

// CI 接线（issue #40 评审项 2）：省略 types 时默认不含 edited，PR 描述编辑后 workflow 不重跑。
test('CI 接线：Rule checks 的 on.pull_request 声明 edited 触发类型', () => {
  const workflowPath = fileURLToPath(new URL('../../.github/workflows/rule-checks.yml', import.meta.url))
  const workflow = parseYaml(readFileSync(workflowPath, 'utf8'))
  const types = workflow.on?.pull_request?.types

  assert.ok(Array.isArray(types), 'on.pull_request 必须显式声明 types，否则默认值不含 edited')
  const required = ['opened', 'synchronize', 'reopened', 'edited']
  assert.ok(required.every((t) => types.includes(t)), `应包含 ${required}（与 issue-policy.yml 的既定写法一致）`)
})

// issue #96：`on.pull_request.branches` 是**准入谓词**：它让 workflow 只对 base
// 为 main 的 PR 触发。base 不是 main 的普通 PR（例如叠在特性分支上的 PR）因此连
// 一次结论都没有——#83 / #88 的 head 在修掉它之前从未出现在运行里。
//
// 注意措辞：过滤器**不会**改写 `github.base_ref`，它只是筛掉取值不是 main 的那些
// PR。栈成员的运行时 base 之所以是 main，是 stack 语义而不是这个过滤器造成的
// （issue #99 用 run 35511506461 证伪了旧说法）。这条断言仍然要留着：加回过滤器
// 会让非 main 的普通 PR 重新失去结论。
test('CI 接线：Rule checks 的 on.pull_request 不得声明分支过滤器（它会让非 main 的 PR 没有结论）', () => {
  const trigger = loadRuleChecksWorkflow().on?.pull_request

  assert.ok(trigger !== null && typeof trigger === 'object', 'on.pull_request 必须存在且是映射')
  for (const key of ['branches', 'branches-ignore']) {
    assert.equal(
      trigger[key],
      undefined,
      `on.pull_request.${key} 会让 base 不是 main 的 PR 完全不触发（issue #96），修掉它之前 #83 / #88 的 head 从未被检查`,
    )
  }
})

// issue #99（含评审 P1）：判定输入是一对**不可变提交**。这组断言把三件事钉在配置层：
// 解析只有一个来源、两个检查 job 消费同一对值、判定对象不是任何会移动的 ref。
test('CI 接线：判定对象对来自 PR API 与事件 head，两个检查 job 消费同一次解析结果，且没有一步用移动 ref', () => {
  const jobs = loadRuleChecksWorkflow().jobs ?? {}

  const resolver = jobs['resolve-base']
  assert.ok(resolver, '必须有 resolve-base job：它是判定输入的唯一定义点')
  assert.equal(resolver.outputs?.base_sha, '${{ steps.resolve.outputs.base_sha }}')
  assert.equal(resolver.outputs?.head_sha, '${{ steps.resolve.outputs.head_sha }}', 'head 也必须由解析 job 统一给出')
  assert.equal(
    resolver.outputs?.api_base_sha,
    '${{ steps.fetch.outputs.api_base_sha }}',
    'base 也要有独立锚点：它决定两个检查量的范围，而它同样由解析器输出',
  )
  assert.ok(!('base_ref' in (resolver.outputs ?? {})), '解析器不再产出 base_ref：判定输入只有两个提交')
  assert.ok(!('api_base_ref' in (resolver.outputs ?? {})), 'base.ref 只给诊断用，不必经过 job output')

  // 取数与解析必须分两步：token 只出现在不执行 PR 代码的那一步。
  const apiStep = (resolver.steps ?? []).find((step) => typeof step.run === 'string' && step.run.includes('gh api'))
  assert.ok(apiStep, '基线必须来自 PR API')
  assert.match(apiStep.run, /set -euo pipefail/, 'gh 失败必须让这一步直接失败')
  assert.equal(apiStep.env?.GH_TOKEN, '${{ github.token }}', 'token 只在取数步骤里')
  assert.match(apiStep.run, /\$RUNNER_TEMP/, '响应写进 runner 临时目录，不经 shell 拼接传递')
  assert.match(apiStep.run, /api_base_ref=/, '来源说明由这一步回显，解析器的契约里没有它')
  assert.match(apiStep.run, /tr -d/, '回显前去掉控制字符，保证它是一行')
  assert.match(apiStep.run, /api_base_sha=/, 'base.sha 也要在这一步读出：它是判定基线的独立锚点')

  const resolveStep = (resolver.steps ?? []).find((step) => step.id === 'resolve')
  assert.ok(resolveStep, 'resolve-base 必须有一个 id 为 resolve 的步骤')
  assert.match(resolveStep.run, /scripts\/resolve-pr-base\.mjs/, '解析与校验交给脚本，不写成多行 shell')
  assert.match(resolveStep.run, /\$GITHUB_OUTPUT/, '判定输入写入 GITHUB_OUTPUT 供下游消费')
  assert.ok(!('GH_TOKEN' in (resolveStep.env ?? {})), '执行 PR 代码的步骤不得持有 token')
  assert.equal(
    resolveStep.env?.EVENT_HEAD_SHA,
    '${{ github.event.pull_request.head.sha }}',
    '判定 head 取自事件负载，而不是 github.sha（后者在 pull_request 事件里可能是测试合并提交）',
  )

  // 取数必须发生在 checkout **之前**。checkout 的 fetch-depth: 0 取的是当时的所有
  // 分支头，而 base_sha 是取数那一刻的 tip：顺序反过来时，期间前进过的 base 分支
  // （本地变基后强推是常规操作）会让可达性校验失败、两个 advisory 检查没有结论——
  // 一个由常规操作触发的误报（§9.2）。放在前面时，后面那次全量 fetch 必然包含刚
  // 读到的 tip，而且持 token 的步骤执行时工作区还是空的。
  const steps = resolver.steps ?? []
  const tokenIndex = steps.findIndex((step) => 'GH_TOKEN' in (step.env ?? {}))
  const checkoutIndex = steps.findIndex((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))
  assert.ok(tokenIndex >= 0 && checkoutIndex >= 0, '取数步骤与 checkout 都必须存在')
  assert.ok(tokenIndex < checkoutIndex, '持 token 的取数步骤必须早于 checkout')
  // base 仓 + `refs/pull/<n>/head`：fork PR 也成立；取 fork 仓会让 base 对象不可达。
  for (const jobId of ['resolve-base', 'checks']) {
    const ck = (jobs[jobId].steps ?? []).find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'))
    assert.equal(ck?.with?.repository, '${{ github.repository }}', `${jobId}：必须取 base 仓`)
    assert.equal(
      ck?.with?.ref,
      'refs/pull/${{ github.event.pull_request.number }}/head',
      `${jobId}：必须取 PR head ref（同仓与 fork 都成立）`,
    )
  }
  assert.doesNotMatch(steps[tokenIndex].run, /scripts\//, '持 token 的步骤不得执行 PR 代码')

  // 判定对象由事件 head 定义；checkout 只负责把对象取到本地，取的是 PR head ref
  // （fork 也能取到），身份校验再确认它与事件 head 一致。

  // 解析 job 先确认两个对象在本地可达：缺一个就没有可判定的范围（fail closed）。
  const reachability = (resolver.steps ?? []).find((step) => typeof step.run === 'string' && step.run.includes('cat-file'))
  assert.ok(reachability, 'resolve-base 必须校验两个判定对象在本地可达')
  assert.match(reachability.run, /exit 1/, '不可达必须失败，不能继续')
  assert.match(reachability.run, /诊断（不参与判定）：API base\.ref=/, '三个来源要在同一处对照，且逐行标注"不参与判定"')
  assert.match(reachability.run, /判定对象：base \$\{BASE_SHA\}/, '判定对象单独标注')

  // 两个检查是同一个判定的两种输出，因此只有一个 matrix job：校验只写一处，
  // 两个检查不可能各用一份基线。检查名必须保持 `PR size` / `Disclosure scan`。
  const checks = jobs.checks
  assert.ok(checks, '必须有一个 checks job 承载两个检查')
  assert.deepEqual(checks.needs, 'resolve-base', 'checks 必须消费 resolve-base 的结果，不能自己解析')
  assert.deepEqual(
    (checks.strategy?.matrix?.include ?? []).map((entry) => `${entry.check}:${entry.command}`),
    ['PR size:size', 'Disclosure scan:disclosure'],
    'matrix 必须恰好是这两个检查，名字与命令一一对应',
  )

  const checkout = (checks.steps ?? []).find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'))
  assert.ok(checkout, 'checks 必须有 checkout')
  assert.equal(
    checkout.with?.ref,
    'refs/pull/${{ github.event.pull_request.number }}/head',
    '取 PR head ref 而不是默认的测试合并提交（后者的父结构随 base 移动）',
  )

  // 身份校验与判定在同一个步骤里：两者是同一个命题的两半，分开写会漂移。
  const step = (checks.steps ?? []).find((s) => typeof s.run === 'string' && s.run.includes('rule-checks.mjs'))
  assert.ok(step, 'checks 必须有一个跑 rule-checks.mjs 的步骤')
  assert.equal(step.env?.BASE_SHA, '${{ needs.resolve-base.outputs.base_sha }}', 'base 必须是不可变对象')
  assert.equal(step.env?.HEAD_SHA, '${{ needs.resolve-base.outputs.head_sha }}', 'head 必须是同一个对象')
  assert.equal(step.env?.COMMAND, '${{ matrix.command }}', '命令经 env 传入，不插值进 run')
  assert.match(step.run, /git rev-parse HEAD/, '必须在判定前校验工作树落在 head 上')
  assert.match(step.run, /cat-file/, '必须同时校验 base 对象可达')
  assert.match(step.run, /"\$COMMAND" "\$BASE_SHA" "\$HEAD_SHA"/, '三个输入都经 env 传入并在 shell 里引用')
  assert.equal(step.env?.EVENT_HEAD_SHA, '${{ github.event.pull_request.head.sha }}', '身份校验要有独立于解析器输出的锚点')
  assert.match(step.run, /"\$actual" = "\$EVENT_HEAD_SHA"/, '工作树也要与事件 head 比对，解析器"诚实地搞错 head"才会暴露')
  assert.equal(step.env?.API_BASE_SHA, '${{ needs.resolve-base.outputs.api_base_sha }}', 'base 也要有锚点')
  assert.match(step.run, /"\$BASE_SHA" = "\$API_BASE_SHA"/, '判定基线要与取数步骤读到的快照比对')
  // 断言整个表达式而不是子串：GitHub 的 `a && b || c` 在 b 是空串时会落到 c，
  // 所以操作数顺序反了（`… && '' || <body>`）等于两格都给——子串匹配抓不到。
  assert.equal(
    step.env?.PR_BODY,
    "${{ matrix.command == 'disclosure' && github.event.pull_request.body || '' }}",
    'PR 描述只给用它的那一格：GitHub 会把整个 env 块打进公开日志',
  )

  // 判定步骤的输入只能是两个不可变 SHA：`origin/<ref>`、`HEAD^1`、`github.base_ref`
  // 都会把判定绑到会移动的对象或未文档化的合并结构上（评审 P1）。
  const offenders = []
  for (const [jobId, job] of Object.entries(jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== 'string' || !step.run.includes('rule-checks.mjs')) continue
      for (const [key, value] of Object.entries(step.env ?? {})) {
        if (typeof value === 'string' && /origin\/|HEAD\^|github\.base_ref|github\.sha/.test(value)) {
          offenders.push(`${jobId}/${step.name ?? '?'}: ${key}=${value}`)
        }
      }
      if (/origin\/\$|HEAD\^/.test(step.run)) offenders.push(`${jobId}/${step.name ?? '?'}: run 里出现移动 ref`)
    }
  }
  assert.deepEqual(offenders, [], '判定对象必须固定到不可变提交')
})

test('CI 接线：permissions 含 pull-requests: read，且没有任何 write', () => {
  const workflow = loadRuleChecksWorkflow()

  assert.equal(workflow.permissions?.contents, 'read')
  assert.equal(workflow.permissions?.['pull-requests'], 'read', '读 PR 对象自己的 base 需要 pull-requests: read')
  for (const [key, value] of Object.entries(workflow.permissions ?? {})) {
    assert.ok(!String(value).startsWith('write'), `permissions.${key} 不得是 write（W4）`)
  }
})

// ---------------------------------------------------------------------------
// exit code 契约、先加后删、提交信息、PR 描述（issue #40 项 2/3/5）
// ---------------------------------------------------------------------------

test('exit code 契约：disclosure 命中时返回 1，四个来源都干净时返回 0', () => {
  const dirty = mkDiff('x.txt', [`见 ${homePath('alice', 'x')}`])

  assert.equal(disclosure('base', { ...noGit, readDiff: () => dirty }), 1)
  assert.equal(disclosure('base', noGit), 0)
})

test('先加后删：树对树的三点差异干净，但某个提交自己引入的新增行仍会命中，并带提交 SHA', () => {
  const sha = 'deadbeef1234deadbeef1234deadbeef1234dead'
  const addDiff = mkDiff('notes.txt', [`leak: ${fakeAwsKey()}`], { oldFile: '/dev/null' })

  const { result: code, output } = captureLogs(() =>
    disclosure('base', {
      ...noGit,
      readDiff: () => '', // 净变化为零：树对树差异看不见
      listCommits: () => [sha],
      readCommitDiff: (s) => (s === sha ? addDiff : ''),
    }),
  )

  assert.equal(code, 1)
  assert.match(output, new RegExp(sha.slice(0, 12)), '报告应带提交 SHA，指向需要改写历史的那个提交')
})

test('提交信息泄露：文件全干净，但提交信息本身含家目录路径会被扫到', () => {
  const sha = 'cafef00dcafef00dcafef00dcafef00dcafef00d'

  const code = disclosure('base', {
    ...noGit,
    listCommits: () => [sha],
    readCommitMessage: () => `fix: 数据库路径改回 ${homePath('alice', 'project/db.sqlite')}`,
  })

  assert.equal(code, 1)
})

test('PR 描述泄露：经 prBody 注入的内容同样被扫描（CI 里经 env 传入，不插值进 run:）', () => {
  const code = disclosure('base', { ...noGit, prBody: `端点是 ${internalHost('build-01')}` })

  assert.equal(code, 1)
})

test('通过时的横幅如实列出四个来源，不能读成「§8.6 已经做完」', () => {
  const { result: code, output } = captureLogs(() => disclosure('base', noGit))

  assert.equal(code, 0)
  assert.match(output, /提交/)
  assert.match(output, /PR 描述/)
  assert.match(output, /人工/)
})

// 判定自描述（issue #96 / #99）：判定对象是**一对提交**，读者必须能一眼看出这次
// 判的是哪两个对象，而不是从「7837 行」这个结果反推。
test('披露：输出写明判定对象对，读者不需要反推', () => {
  const { output } = captureLogs(() => disclosure('origin/feat/stack-parent', noGit))

  assert.match(output, /^判定对象：origin\/feat\/stack-parent @ deadbeef1234 · head HEAD @ deadbeef1234$/m)
})

test('exit code 契约：size 超预算返回 1，未超返回 0', () => {
  const over = `${BUDGETS.code + 1}\t0\tpackages/core/src/a.ts`
  const under = '10\t0\tpackages/core/src/a.ts'
  const stub = { resolveRef: () => 'deadbeef1234' }

  assert.equal(size('base', { ...stub, readNumstat: () => over }), 1)
  assert.equal(size('base', { ...stub, readNumstat: () => under }), 0)
})

// ---------------------------------------------------------------------------
// 判定基线（issue #96）
// ---------------------------------------------------------------------------

test('基线：DEFAULT_BASE 是 origin/main；判定范围以传入的 head 为端点，base 就是 main tip 时不打印栈累计', () => {
  assert.equal(DEFAULT_BASE, 'origin/main')

  const MAIN = 'c0ffee'.repeat(6) + 'c0ff' // 40 位，模拟 CI 传进来的 base.sha
  const BASE = 'beef01'.repeat(6) + 'beef01'
  const HEAD = 'b'.repeat(40)

  // 同一个数据源服务两个范围：判定范围给本 PR 的，栈累计范围给整栈的。
  const run = (base, { head, cumulative = '10\t0\ta.ts' }) => {
    const ranges = []
    const { output } = captureLogs(() =>
      size(base, {
        head,
        readNumstat: (range) => {
          ranges.push(range)
          return range.startsWith(`${DEFAULT_BASE}...`) ? cumulative : '10\t0\ta.ts'
        },
        // main 的几种写法都解析成同一个提交；SHA 解析成自己（真实 git 的行为）。
        resolveRef: (ref) => (ref.endsWith('main') ? MAIN : ref),
      }),
    )
    return { ranges, output }
  }

  const explicit = run(BASE, { head: HEAD, cumulative: `${BUDGETS.code * 8}\t0\tc.ts` })
  assert.deepEqual(explicit.ranges, [`${BASE}...${HEAD}`, `${DEFAULT_BASE}...${HEAD}`], '三点差异，且两个范围都以传入的 head 为端点')
  assert.match(explicit.output, new RegExp(`判定对象：${BASE} @ ${BASE.slice(0, 12)} · head ${HEAD} @ ${HEAD.slice(0, 12)}`))
  assert.match(explicit.output, /代码：10 \/ 1000 行/, '栈累计再大也不参与判定')
  assert.match(explicit.output, /^栈累计（相对 origin\/main，仅记录，不计入判定）：代码 8000 行、文档 0 行$/m)

  // base 就是 main 的 tip：累计值与判定值逐字相同，那一行只是噪声。门控必须比较
  // **解析后的提交**——CI 传进来的是 40 位 SHA，按 ref 名字比较会让它每次都打印。
  for (const base of ['origin/main', 'main', MAIN]) {
    const same = run(base, { head: HEAD })
    assert.deepEqual(same.ranges, [`${base}...${HEAD}`], `${base} 是 main tip：不读栈累计范围`)
    assert.doesNotMatch(same.output, /栈累计/, `${base} 是 main tip：不打印栈累计行`)
  }

  // head 省略时端点回到 HEAD（本地手工跑的形状）。
  const implicit = run(DEFAULT_BASE, {})
  assert.deepEqual(implicit.ranges, [`${DEFAULT_BASE}...HEAD`])
})

// 评审 P1 的判别性回归用例（issue #99）：**三点差异不是不变量**。
//
// 它保证的是"以给定的两个对象为端点时，只算 head 一侧自共同祖先以来的改动"；
// 一旦判定用的是"当前的 origin/<base.ref>"，base 被 force-push 到无关历史就会让
// 共同祖先后退，把 base 分支自己的提交算成本 PR 的改动。下面对同一个 head 跑两次：
// 固定对象对得到 5 行（正确），移动的 branch tip 得到 1205 行（假红）。
test('体量：base 被改写到无关历史时，固定对象对只算本 PR，移动的 branch tip 会假红（真实 git 仓库）', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rule-checks-frozen-'))
  const originalCwd = process.cwd()
  try {
    const run = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const rev = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).trim()
    const lines = (prefix, count) =>
      Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n')

    run(['init', '-q', '-b', 'main'])
    run(['config', 'user.email', 'test@example.com'])
    run(['config', 'user.name', 'Test'])
    writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'seed'])

    run(['checkout', '-q', '-b', 'stack-parent'])
    writeFileSync(path.join(dir, 'parent.js'), lines('p', 1200))
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'parent'])
    const baseSnapshot = rev('stack-parent')

    run(['checkout', '-q', '-b', 'child'])
    writeFileSync(path.join(dir, 'child.js'), lines('c', 5))
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'child'])
    const head = rev('child')

    // 常规形状：base 分支在子分支分出之后继续前进（fast-forward）。判定用冻结的
    // 快照，所以共同祖先仍是分叉点，只算子分支自己的 5 行——这一条与下面那条
    // force-push 的情形是同一性质的两端。
    run(['checkout', '-q', 'stack-parent'])
    writeFileSync(path.join(dir, 'advance.js'), lines('a', 40))
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'parent advances'])
    const advancedTip = rev('stack-parent')

    // base 被 force-push 到无关历史：stack-parent 不再包含它自己的那次提交。
    run(['checkout', '-q', 'stack-parent'])
    run(['reset', '-q', '--hard', 'main'])
    writeFileSync(path.join(dir, 'unrelated.js'), lines('u', 20))
    run(['add', '-A'])
    run(['commit', '-q', '-m', 'unrelated rewrite'])
    const movedTip = rev('stack-parent')
    assert.notEqual(baseSnapshot, movedTip, '前置条件：base 的 tip 必须已经变化')

    process.chdir(dir)

    // 常规形状：base 前进（fast-forward）后，冻结快照仍是分叉点，只算子分支的 5 行。
    const fastForward = captureLogs(() => size(advancedTip, { head }))
    assert.equal(fastForward.result, 0, 'base 前进不改变判定：仍是子分支自己的改动')
    assert.match(fastForward.output, /代码：5 \/ 1000 行/)

    const frozen = captureLogs(() => size(baseSnapshot, { head }))
    assert.equal(frozen.result, 0, '固定对象对：本 PR 只有 5 行')
    assert.match(frozen.output, /代码：5 \/ 1000 行/)
    assert.match(frozen.output, new RegExp(`判定对象：${baseSnapshot} @ ${baseSnapshot.slice(0, 12)}`))

    const moved = captureLogs(() => size(movedTip, { head }))
    assert.equal(moved.result, 1, '移动的 branch tip：共同祖先后退，base 自己的 1200 行被算进本 PR')
    assert.match(moved.output, /代码：1205 \/ 1000 行/)
    assert.match(moved.output, new RegExp(`· head ${head} @ ${head.slice(0, 12)}`), '两次运行的 head 相同、base 不同')

    // 默认解析器必须真的被接上：CI 传进来的是 SHA、mainRef 是分支名，比较要落在
    // **解析后的提交**上。这里不注入 resolveRef，走真实 git——`size()` 的
    // destructuring 曾经漏掉默认值，异常被吞掉后栈累计行在每次运行都打印。
    const sameTip = captureLogs(() => size(rev('main'), { head, mainRef: 'main' }))
    assert.doesNotMatch(sameTip.output, /栈累计/, 'base 就是 main 的 tip 时不打印栈累计行')
  } finally {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI：base 或 head 任一无法解析成提交时 exit 3，不静默改用别的对象', () => {
  const missing = 'f'.repeat(40)
  const cases = [
    ['size', [missing]],
    ['size', ['HEAD', missing]],
    ['disclosure', [missing]],
    ['disclosure', ['HEAD', missing]],
  ]

  for (const [command, args] of cases) {
    const result = spawnSync(process.execPath, [SCRIPT, command, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 3, `${command} ${args.join(' ')} 期望 exit 3，实际 ${result.status}`)
    assert.match(result.stderr, /无法解析成提交/)
  }
})

test('基线：git 输出的结尾换行不会把基线行拆成两行，解析失败也不抛错', () => {
  // 真实 git 的 stdout 带结尾换行；不 trim 会让「判定对象：…」那一行被拆成两行。
  assert.equal(describeBaseline('origin/main', { resolveRef: () => 'abc123def456\n' }), 'origin/main @ abc123def456')
  assert.equal(
    describeBaseline('origin/gone', {
      resolveRef: () => {
        throw new Error('bad revision')
      },
    }),
    'origin/gone（无法解析成提交）',
  )
})

test('体量：base 不是 main 时栈累计算不出来也只降级，不影响判定', () => {
  const { result: code, output } = captureLogs(() =>
    size('origin/feat/stack-parent', {
      readNumstat: (range) => {
        if (range.startsWith(`${DEFAULT_BASE}...`)) throw new Error('unknown revision')
        return '10\t0\tpackages/client/src/sync.ts'
      },
      resolveRef: (ref) => (ref === DEFAULT_BASE ? 'main-tip' : 'base-tip'),
    }),
  )

  assert.equal(code, 0)
  assert.match(output, /栈累计：相对 origin\/main 计算失败/)
  assert.match(output, /判定不受影响/)
})

// ---------------------------------------------------------------------------
// 体量分桶（issue #41）
// ---------------------------------------------------------------------------

test('体量：文档与代码分桶，.md 大小写不敏感', () => {
  assert.equal(bucketOf('docs/exec-plan/active/x.md'), 'docs')
  assert.equal(bucketOf('README.md'), 'docs')
  assert.equal(bucketOf('README.MD'), 'docs')
  assert.equal(bucketOf('AGENTS.md'), 'docs')
  assert.equal(bucketOf('packages/core/src/index.ts'), 'code')
  assert.equal(bucketOf('.github/workflows/ci.yml'), 'code')
})

test('体量：按桶累加增删之和', () => {
  const numstat = ['10\t5\tpackages/core/src/a.ts', '100\t0\tdocs/plan.md'].join('\n')

  const { totals } = tally(numstat)

  assert.equal(totals.code, 15)
  assert.equal(totals.docs, 100)
})

test('体量：二进制文件的 numstat 破折号不会变成 NaN', () => {
  const numstat = ['-\t-\tdocs/diagram.png', '3\t1\tdocs/plan.md'].join('\n')

  const { totals } = tally(numstat)

  assert.equal(totals.docs, 4)
  assert.ok(Number.isFinite(totals.code))
})

test('体量：文件按改动量降序，便于一眼看出该拆哪里', () => {
  const numstat = ['1\t1\ta.ts', '50\t50\tb.ts', '5\t5\tc.ts'].join('\n')

  const { files } = tally(numstat)

  assert.deepEqual(
    files.map((f) => f.path),
    ['b.ts', 'c.ts', 'a.ts'],
  )
})

test('体量：预算与 AGENTS.md §8.3 的数字一致', () => {
  assert.equal(BUDGETS.code, 1000)
  assert.equal(BUDGETS.docs, 1500)
})

test('体量：git 给 CJK 路径加的引号能正确解引号（core.quotePath 的八进制字节转义）', () => {
  // 用 git diff --numstat 对一个真实仓库里的 docs/中文文档.md 实测得到的原始字段
  // （scratchpad fixture，见 Batch E 验收证据），逐字节还原后应得到原始 UTF-8 文件名。
  const quoted = '"docs/\\344\\270\\255\\346\\226\\207\\346\\226\\207\\346\\241\\243.md"'

  assert.equal(normalizePath(quoted), 'docs/中文文档.md')
})

test('体量：CJK 文件名的文档落进 docs 桶，不是 code（这正是 core.quotePath 制造的假红）', () => {
  const quoted = '"docs/\\344\\270\\255\\346\\226\\207\\346\\226\\207\\346\\241\\243.md"'
  const numstat = `600\t0\t${quoted}`

  const { totals } = tally(numstat)

  assert.equal(totals.docs, 600)
  assert.equal(totals.code, 0)
})

test('体量：重命名语法按新路径分桶，不是把整段组合字符串当路径', () => {
  assert.equal(normalizePath('{docs/a.md => packages/a.md}'), 'packages/a.md')
  assert.equal(bucketOf(normalizePath('{docs/a.md => packages/a.md}')), 'docs')
  assert.equal(normalizePath('{docs => packages}/base.md'), 'packages/base.md')
  assert.equal(normalizePath('old/full/path.md => new/full/path.md'), 'new/full/path.md')
})

test('体量：重命名后的路径在 tally 里正确分桶（旧实现把整段组合字符串落进 code）', () => {
  const numstat = '12\t3\t{docs/a.md => packages/a.md}'

  const { totals, files } = tally(numstat)

  assert.equal(totals.docs, 15)
  assert.equal(totals.code, 0)
  assert.equal(files[0]?.path, 'packages/a.md')
  assert.equal(files[0]?.bucket, 'docs')
})

test('体量：排除规则覆盖规则文本点名的类目（锁文件与生成目录），且是可导出的判定而非精确字符串表', () => {
  const labels = SIZE_EXCLUDE_RULES.map((r) => r.label)
  for (const label of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'dist/', 'generated/']) {
    assert.ok(labels.includes(label), `应覆盖：${label}`)
  }
})

test('体量：生成物排除按路径前缀/目录段判定，覆盖嵌套锁文件与其它包管理器', () => {
  assert.ok(isSizeExcluded('pnpm-lock.yaml'))
  assert.ok(isSizeExcluded('packages/core/pnpm-lock.yaml'))
  assert.ok(isSizeExcluded('package-lock.json'))
  assert.ok(isSizeExcluded('yarn.lock'))
  assert.ok(isSizeExcluded('apps/web/yarn.lock'))
  assert.ok(isSizeExcluded('dist/bundle.js'))
  assert.ok(isSizeExcluded('src/generated/api.ts'))
  assert.ok(!isSizeExcluded('packages/core/src/index.ts'))
})

test('体量：tally 用同一套排除规则，嵌套锁文件与生成目录不计入代码预算', () => {
  const numstat = [
    '9000\t8000\tpackages/core/pnpm-lock.yaml',
    '5800\t0\tdist/bundle.js',
    '10\t0\tsrc/generated/api.ts',
    '7000\t0\tapps/web/yarn.lock',
    '1\t1\tpackages/core/src/a.ts',
  ].join('\n')

  const { totals } = tally(numstat)

  assert.equal(totals.code, 2)
})

// ---------------------------------------------------------------------------
// CLI 级 exit code 边界（issue #41 项 3：base ref 解析失败取 exit 3）
// ---------------------------------------------------------------------------

test('CLI：base ref 无法解析成提交时 exit 3，不是内部报错的裸退出 1', () => {
  const script = fileURLToPath(new URL('../../scripts/rule-checks.mjs', import.meta.url))

  const result = spawnSync(process.execPath, [script, 'size', 'origin/does-not-exist-xyz'], { encoding: 'utf8' })

  assert.equal(result.status, 3, `期望 exit 3，实际 ${result.status}；stderr：${result.stderr}`)
})

test('CLI：未知子命令是用法错误，exit 2', () => {
  const script = fileURLToPath(new URL('../../scripts/rule-checks.mjs', import.meta.url))

  const result = spawnSync(process.execPath, [script, 'bogus'], { encoding: 'utf8' })

  assert.equal(result.status, 2)
})
