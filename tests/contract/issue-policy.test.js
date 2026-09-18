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
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import path from 'node:path'

import {
  AREAS,
  KINDS,
  missingAreas,
  checkLabels,
  checkPullRequestBody,
  checkTitle,
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
