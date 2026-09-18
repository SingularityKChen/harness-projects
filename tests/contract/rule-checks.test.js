// AGENTS.md §8.6（发布面）与 §8.3（PR 体量）两条规则的可执行表述。
//
// 这一层测纯函数，不调用 git、不联网：规则本身是否成立，与仓库当前有什么改动无关。

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUDGETS,
  DISCLOSURE_PATTERNS,
  SIZE_EXCLUDES,
  bucketOf,
  scanDiff,
  tally,
} from '../../scripts/rule-checks.mjs'

// 用拼装而不是字面量构造「坏路径」样本：本文件也在扫描范围内，
// 写成字面量会让这条规则在引入它的同一个 PR 上命中自己。
const homePath = (user, rest) => ['', 'Users', user, rest].join('/')
const internalHost = (name) => `${name}.internal`

test('发布面：新增行里的家目录路径会被命中，并归属到正确的文件', () => {
  const diff = [
    '--- a/docs/a.md',
    '+++ b/docs/a.md',
    `+数据库放在 ${homePath('alice', 'db/project.sqlite')}`,
  ].join('\n')

  const hits = scanDiff(diff)

  assert.equal(hits.length, 1)
  assert.equal(hits[0].file, 'docs/a.md')
  assert.equal(hits[0].pattern, '本机家目录路径')
  assert.match(hits[0].hint, /占位符/)
})

test('发布面：删除行与 diff 头部不算命中', () => {
  const diff = [
    '--- a/docs/a.md',
    `+++ b/docs/${homePath('bob', 'notes.md').slice(1)}`, // 文件头本身不扫描
    `-旧内容提到 ${homePath('bob', 'old/path')}`,
    '+改写后的内容用 ~/… 占位',
  ].join('\n')

  assert.deepEqual(scanDiff(diff), [])
})

test('发布面：内网主机名会被命中', () => {
  const diff = ['+++ b/docs/ops.md', `+端点是 ${internalHost('build-01')}`].join('\n')

  const hits = scanDiff(diff)

  assert.equal(hits.length, 1)
  assert.equal(hits[0].pattern, '内网主机名')
})

test('发布面：干净的 diff 不产生命中', () => {
  const diff = [
    '+++ b/docs/a.md',
    '+路径写成 `~/.config/<app>/db.sqlite`',
    '+主机写成 `<runner-name>`',
    '+提到 example.com 这种公开域名不应命中',
  ].join('\n')

  assert.deepEqual(scanDiff(diff), [])
})

test('发布面：规则文本本身不是豁免——模式表非空且每条都带修改建议', () => {
  assert.ok(DISCLOSURE_PATTERNS.length >= 2)
  for (const p of DISCLOSURE_PATTERNS) {
    assert.ok(p.name.length > 0)
    assert.ok(p.hint.length > 0, `${p.name} 缺少修改建议`)
  }
})

test('体量：文档与代码分桶', () => {
  assert.equal(bucketOf('docs/exec-plan/active/x.md'), 'docs')
  assert.equal(bucketOf('README.md'), 'docs')
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

test('体量：锁文件不计入', () => {
  const numstat = ['9000\t8000\tpnpm-lock.yaml', '1\t1\tpackages/core/src/a.ts'].join('\n')

  const { totals } = tally(numstat)

  assert.equal(totals.code, 2)
  assert.ok(SIZE_EXCLUDES.includes('pnpm-lock.yaml'))
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
