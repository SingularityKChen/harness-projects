/**
 * Issue and pull request policy
 *
 * Protects the rules documented in AGENTS.md §8.7:
 * an issue title reads `<kind>(<area>): <imperative English summary>`, its
 * labels carry exactly one `kind:*`, at least one `area:*` and at most one
 * `gate:*`, the two representations agree, and a pull request names the issue
 * it delivers.
 *
 * The policy is advisory — the "Issue policy" check is not part of branch
 * protection — but the rules themselves are statements, so they are tested
 * here rather than only described in prose.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import path from 'node:path'

import {
  AREAS,
  GATES,
  KINDS,
  missingAreas,
  requiredAreas,
  checkLabels,
  checkPullRequestBody,
  checkTitle,
  hasPullRequestMetadata,
  linkRuleExemption,
  linkedIssues,
  titleParts,
} from '../../scripts/policy-check.mjs'

test('策略：合规的标题不报问题', () => {
  const title = 'feat(storage): add the SQLite schema and migration skeleton'
  assert.deepEqual(checkTitle(title), [])
  assert.deepEqual(titleParts(title), { kind: 'feat', area: 'storage' })
})

test('策略：标题缺少前缀、种类未知或区域未知都会失败', () => {
  assert.match(checkTitle('Add the SQLite schema')[0], /must match/)
  assert.match(checkTitle('build(storage): add the schema')[0], /unknown kind/)
  assert.match(checkTitle('feat(whatever): add the schema')[0], /unknown area/)
})

test('策略：标题必须是英文，且摘要不以句号结尾', () => {
  assert.match(checkTitle('feat(storage): 增加 SQLite 迁移骨架')[0], /English/)
  assert.match(checkTitle('feat(storage): add the schema.')[0], /period/)
})

test('策略：标签必须恰好一个 kind、至少一个 area、至多一个 gate', () => {
  const title = 'chore(ci): extend the merge gate'
  assert.deepEqual(checkLabels(['kind:chore', 'area:ci'], title), [])
  assert.match(checkLabels(['area:ci'], title)[0], /exactly one `kind:\*`/)
  assert.match(checkLabels(['kind:chore', 'kind:test', 'area:ci'], title)[0], /exactly one `kind:\*`/)
  assert.match(checkLabels(['kind:chore'], title)[0], /at least one `area:\*`/)
  assert.match(checkLabels(['kind:chore', 'area:ci', 'gate:E1', 'gate:R1'], title)[0], /at most one `gate:\*`/)
})

test('策略：标签必须与标题前缀一致，且不得越出词汇表', () => {
  assert.match(checkLabels(['kind:test', 'area:ci'], 'chore(ci): extend the merge gate')[0], /title says kind/)
  assert.match(checkLabels(['kind:chore', 'area:storage'], 'chore(ci): extend the merge gate')[0], /title says area/)
  assert.match(checkLabels(['kind:chore', 'area:ci', 'priority:p1'], 'chore(ci): x')[0], /outside the vocabulary/)
})

test('策略：词汇表里的每个区域都能在标题里出现', () => {
  for (const area of AREAS) {
    assert.deepEqual(checkTitle(`chore(${area}): keep the area vocabulary honest`), [], area)
  }
  for (const kind of KINDS) {
    assert.deepEqual(checkTitle(`${kind}(repo): keep the kind vocabulary honest`), [], kind)
  }
})

test('策略：area 词表必须覆盖仓库里每一个真实位置', () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  assert.deepEqual(missingAreas(rootDir), [])
})

test('策略：PR 正文必须 link 同仓 issue，Closes 与 Refs 都能识别', () => {
  assert.deepEqual(linkedIssues('Closes #12 and Refs #5'), { closes: [12], refs: [5] })
  assert.deepEqual(linkedIssues('fixes #7'), { closes: [7], refs: [] })
  assert.deepEqual(linkedIssues('no link here'), { closes: [], refs: [] })
  assert.deepEqual(checkPullRequestBody('Closes #42'), [])
  assert.deepEqual(checkPullRequestBody('Refs #42'), [])
  assert.match(checkPullRequestBody('just prose')[0], /must link the issue/)
  assert.match(checkPullRequestBody(undefined)[0], /must link the issue/)
})

test('策略：link issue 规则对机器开的 PR 豁免，对人开的 PR 不豁免', () => {
  // 豁免的理由是「没有可追溯的规划工作项」，不是「这个作者特殊」。
  // 因此判据取 GitHub 的 user.type，而不是一份需要人工维护的 bot 名单。
  const bot = linkRuleExemption({ authorType: 'Bot', authorLogin: 'dependabot[bot]' })
  assert.equal(bot.exempt, true)
  assert.match(bot.reason, /bot/)

  // 换一个 bot 也豁免——名单没有被写死
  assert.equal(linkRuleExemption({ authorType: 'Bot', authorLogin: 'renovate[bot]' }).exempt, true)

  // 人开的 PR 一律不豁免，哪怕登录名长得像 bot
  assert.equal(linkRuleExemption({ authorType: 'User', authorLogin: 'someone' }).exempt, false)
  assert.equal(linkRuleExemption({ authorType: 'User', authorLogin: 'not-a-dependabot' }).exempt, false)

  // 缺字段时不豁免：未知情形往收紧的方向倒（与 §9.5 对解析失败的立场一致）
  assert.equal(linkRuleExemption({}).exempt, false)
  assert.equal(linkRuleExemption({ authorType: undefined, authorLogin: 'x' }).exempt, false)

  // 豁免只影响 link 规则本身，不改变正文判定
  assert.match(checkPullRequestBody('just prose')[0], /must link the issue/)
})

// ── Batch D：gate:* 取值校验（issue #39 第 1 条） ───────────────────────────

test('策略：gate 标签的取值被限定为 E1 或 R1', () => {
  const title = 'chore(ci): extend the merge gate'
  assert.deepEqual(checkLabels(['kind:chore', 'area:ci', 'gate:E1'], title), [])
  assert.deepEqual(checkLabels(['kind:chore', 'area:ci', 'gate:R1'], title), [])
  assert.match(checkLabels(['kind:chore', 'area:ci', 'gate:E9'], title)[0], /unknown label `gate:E9`/)
  assert.match(checkLabels(['kind:chore', 'area:ci', 'gate:totally-made-up'], title)[0], /unknown label `gate:totally-made-up`/)
  // 空取值（标签就叫 `gate:`）同样必须被拦，而不是被 GATES.includes('') 悄悄放过
  assert.match(checkLabels(['kind:chore', 'area:ci', 'gate:'], title)[0], /unknown label `gate:`/)
  assert.deepEqual(GATES, ['E1', 'R1'])
})

// ── Batch D：requiredAreas 的命名过滤（issue #39 第 2 条） ──────────────────

test('策略：requiredAreas 只统计合法 area 名称，过滤点目录与下划线目录', () => {
  // 标题正则的 area 分组只接受 [a-z0-9-]+；.vitepress 与 ui_kit 这类名字永远
  // 不可能出现在合规标题里，因此也不该被计入"AREAS 必须覆盖"的核对范围——
  // 否则加进 AREAS 会让标题正则测试变红，不加又让这条覆盖率测试变红，两条
  // 断言互相矛盾、无法同时满足。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-check-areas-'))
  try {
    fs.mkdirSync(path.join(root, 'packages', 'ui_kit'), { recursive: true })
    fs.mkdirSync(path.join(root, 'docs', '.vitepress'), { recursive: true })
    fs.mkdirSync(path.join(root, 'docs', 'valid-sentinel'), { recursive: true })
    const areas = requiredAreas(root)
    assert.ok(!areas.includes('ui_kit'), `ui_kit 不应出现在 requiredAreas 里，实际：${JSON.stringify(areas)}`)
    assert.ok(!areas.includes('.vitepress'), `.vitepress 不应出现在 requiredAreas 里，实际：${JSON.stringify(areas)}`)
    // 过滤器只挡不合法的名字，合法名字必须照常被收进来——不能矫枉过正
    assert.ok(areas.includes('valid-sentinel'), `valid-sentinel 应当出现在 requiredAreas 里，实际：${JSON.stringify(areas)}`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('策略：requiredAreas 真的读了文件系统，不是写死的兜底列表', () => {
  // 把 requiredAreas 改成直接返回硬编码的 ['apps','tests','docs','ci','repo']
  // 之后，missingAreas 仍然是 []（这五个都已经在 AREAS 里）——覆盖率测试本身
  // 不会发现这个退化。断言几个只可能来自真实读盘的哨兵，让这类退化有牙。
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const areas = requiredAreas(rootDir)
  assert.ok(areas.includes('domain'), `期望包含 domain（来自 packages/domain），实际：${JSON.stringify(areas)}`)
  assert.ok(areas.includes('exec-plan'), `期望包含 exec-plan（来自 docs/exec-plan），实际：${JSON.stringify(areas)}`)
})

// ── Batch D：CLI 入口守卫加固（issue #39 第 3 条） ──────────────────────────

// 旧守卫是 `process.argv[1]?.endsWith('policy-check.mjs')`：把脚本复制成一个
// 不带扩展名的副本后，argv[1] 不再以 'policy-check.mjs' 结尾，main() 被静默
// 跳过——`areas` 子命令与无参调用都变成 exit 0、零输出。这里复现该副本场景，
// 确保新的 invokedDirectly()（realpath 比较）下两种调用都行为正确。
test('CLI：脚本被改名成不带扩展名的副本后，areas 子命令仍然真的执行', () => {
  const script = fileURLToPath(new URL('../../scripts/policy-check.mjs', import.meta.url))
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-check-cli-'))
  try {
    const copy = path.join(holder, 'policy-check') // 不带扩展名，对应 issue 里的复现步骤
    fs.copyFileSync(script, copy)

    const result = spawnSync(process.execPath, [copy, 'areas'], { encoding: 'utf8' })
    assert.equal(result.status, 0, `期望 exit 0，实际 ${result.status}；输出：${result.stdout}${result.stderr}`)
    const lines = result.stdout.trim().split('\n').filter(Boolean)
    assert.equal(lines.length, AREAS.length, `期望打印 ${AREAS.length} 行 area，实际：${JSON.stringify(result.stdout)}`)
  } finally {
    fs.rmSync(holder, { recursive: true, force: true })
  }
})

test('CLI：脚本被改名成不带扩展名的副本后，无参调用仍然 exit 2 并打印用法', () => {
  const script = fileURLToPath(new URL('../../scripts/policy-check.mjs', import.meta.url))
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-check-cli-noargs-'))
  try {
    const copy = path.join(holder, 'policy-check')
    fs.copyFileSync(script, copy)

    const result = spawnSync(process.execPath, [copy], { encoding: 'utf8' })
    assert.equal(result.status, 2, `期望 exit 2，实际 ${result.status}；输出：${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /usage: node scripts\/policy-check\.mjs/)
  } finally {
    fs.rmSync(holder, { recursive: true, force: true })
  }
})

// ── Batch D：空 API 响应与空 PR 正文可区分（issue #39 第 4 条） ────────────

test('策略：hasPullRequestMetadata 区分「没抓到数据」与「作者正文留空」', () => {
  // 缺 scope、--jq 落空等情况下 gh 仍可能 exit 0 并给出一个"能解析但没有作者
  // 字段"的 JSON——每个真实存在的 PR 都必然有作者，缺失作者字段是没抓到数据
  // 的信号，不是作者真的什么都没写。
  assert.equal(hasPullRequestMetadata({ body: null, authorType: null, authorLogin: null }), false)
  assert.equal(hasPullRequestMetadata({}), false)
  assert.equal(hasPullRequestMetadata(null), false)
  assert.equal(hasPullRequestMetadata(undefined), false)
  // 正文真的是空的，但作者字段仍然存在——这是合规判定该管的事，不是内部错误
  assert.equal(hasPullRequestMetadata({ body: null, authorType: 'User', authorLogin: 'someone' }), true)
  assert.equal(hasPullRequestMetadata({ body: '', authorType: 'Bot', authorLogin: 'dependabot[bot]' }), true)
})

// ── Batch D：补牙——80/81 边界、area 取值词表、requiredAreas 读盘（issue #39 第 5 条） ──

test('策略：摘要长度边界——80 通过，81 被拦', () => {
  const summary80 = 'a'.repeat(80)
  const summary81 = 'a'.repeat(81)
  assert.deepEqual(checkTitle(`chore(ci): ${summary80}`), [])
  assert.match(checkTitle(`chore(ci): ${summary81}`)[0], /keep it under 80/)
})

test('策略：area 标签的取值同样受词表限定，不只是"至少一个"的数量检查', () => {
  assert.deepEqual(
    checkLabels(['kind:chore', 'area:bogus'], 'chore(bogus): pick an area that does not exist'),
    ['unknown label `area:bogus`'],
  )
})

// ── Batch D：linkedIssues 的三处口径修正（issue #39 第 6 条） ──────────────

test('策略：linkedIssues 忽略围栏代码块里的 Closes #N，防止粘贴草稿或模板被误判为真实链接', () => {
  const body = ['见下方草稿：', '```markdown', 'Closes #42', '```', '', '正文里没有真正的链接。'].join('\n')
  assert.deepEqual(linkedIssues(body), { closes: [], refs: [] })
  assert.match(checkPullRequestBody(body)[0], /must link the issue/)
})

test('策略：linkedIssues 接受同仓完整 URL 关闭语法，拒绝跨仓 URL', () => {
  const repo = 'SingularityKChen/harness-projects'
  assert.deepEqual(linkedIssues(`Closes https://github.com/${repo}/issues/12`, repo), { closes: [12], refs: [] })
  // 跨仓 URL 必须拒绝，即便关键字与路径形态都齐全
  assert.deepEqual(linkedIssues(`Closes https://github.com/someone-else/other-repo/issues/12`, repo), { closes: [], refs: [] })
  // 不传 repo 时无法判定"同仓"，完整 URL 形态一律不生效
  assert.deepEqual(linkedIssues(`Closes https://github.com/${repo}/issues/12`), { closes: [], refs: [] })
  assert.deepEqual(checkPullRequestBody(`Closes https://github.com/${repo}/issues/12`, repo), [])
})

test('策略：linkedIssues 拒绝 #0，防止 fetchIssue(repo, 0) 抛出原始异常', () => {
  assert.deepEqual(linkedIssues('Closes #0'), { closes: [], refs: [] })
  assert.match(checkPullRequestBody('Closes #0')[0], /must link the issue/)
})

test('策略：linkedIssues 维持两个已有的正确判定——HTML 注释占位符与跨仓 owner/repo#N 都不算链接', () => {
  // 这两条在 Batch D 之前就是对的；回归它们和引入新缺陷一样糟。
  assert.deepEqual(linkedIssues('<!-- Closes #N -->'), { closes: [], refs: [] })
  assert.deepEqual(linkedIssues('Closes owner/repo#12'), { closes: [], refs: [] })
})
