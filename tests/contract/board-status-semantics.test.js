// 只检查权威定义的完整路径引用与目标存在性，不推断散文语义。

import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const BOARD_SEMANTICS = 'docs/product/board-semantics.md'
const REFERENCES = [
  { file: 'docs/project-management/README.md', target: '../product/board-semantics.md' },
  { file: 'docs/development/workflow.md', target: BOARD_SEMANTICS },
]

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8')

const hasPathToken = (source, target) => {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s(\\x60])${escaped}(?=$|[\\s)\\x60#])`).test(source)
}

test('Status 文档引用现存的权威语义定义', () => {
  assert.ok(existsSync(path.join(ROOT, BOARD_SEMANTICS)), `${BOARD_SEMANTICS} 不存在`)

  for (const { file, target } of REFERENCES) {
    assert.ok(hasPathToken(read(file), target), `${file} 必须完整引用 ${target}`)
  }
})
