// `scripts/resolve-pr-base.mjs` 的离线契约测试。
//
// 这个脚本定义 Rule checks 的判定输入：一对不可变提交 `(base_sha, head_sha)`。
// 要守住的性质不是"能解析正常响应"，而是：
//   1. 任何不确定都 fail closed（响应不可用、SHA 缺失或形状不对），不回退 main、
//      github.base_ref 或当前的 origin/<base.ref>；
//   2. 判定对象是事件 head 而不是 API head：PR head 在解析期间前移不改变这对输入，
//      硬失败只会制造 flaky 红叉，因此那是 warning；
//   3. 契约里只有判定真正用到的两个值——`base.ref` 是来源说明，由 workflow 里持有
//      JSON 的那一步回显，不经过这里（也就没有"校验一个不被使用的值"这回事）。
//
// 纯函数直接 import；CLI 用 spawnSync 喂 stdin（不联网、不调用 gh）。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { formatOutputs, parsePrJson, shaProblems, validatePrBase } from '../../scripts/resolve-pr-base.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/resolve-pr-base.mjs', import.meta.url))
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const HEAD = 'b1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

/** 一份形状正确的 PR API 响应（只保留本脚本读的字段）。 */
const validPayload = () => ({
  number: 94,
  base: { ref: 'feat/core-start-work', sha: SHA },
  head: { ref: 'feat/core-delivery-lineage', sha: HEAD },
})

/** 把 JSON 文本喂给 CLI，返回 { status, stdout, stderr }。 */
function runCli(input, eventHeadSha = HEAD) {
  return spawnSync(process.execPath, [SCRIPT], {
    input,
    encoding: 'utf8',
    env: { ...process.env, EVENT_HEAD_SHA: eventHeadSha },
  })
}

// ---------------------------------------------------------------------------
// 纯函数契约
// ---------------------------------------------------------------------------

test('校验：成功时给出判定对象对，SHA 归一化成小写', () => {
  const upper = validPayload()
  upper.base.sha = SHA.toUpperCase()
  upper.head.sha = HEAD.toUpperCase()

  const result = validatePrBase(upper, { eventHeadSha: HEAD.toUpperCase() })
  assert.equal(result.ok, true, JSON.stringify(result.problems))
  assert.equal(result.baseSha, SHA)
  assert.equal(result.headSha, HEAD)
  assert.equal(result.apiHeadSha, HEAD)
  assert.deepEqual(result.problems, [])
})

test('校验：API head 与事件 head 不一致只 warning——判定对象是事件 head，不是 API head', () => {
  const moved = validPayload()
  moved.head.sha = 'c'.repeat(40)

  const result = validatePrBase(moved, { eventHeadSha: HEAD })
  assert.equal(result.ok, true, 'PR head 在解析期间前移不改变 (base_sha, head_sha)')
  assert.equal(result.headSha, HEAD)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /不一致/)
})

test('校验：API 没给可用的 head.sha 时也 warning，不失败', () => {
  for (const head of [undefined, null, { sha: 'not-a-sha' }]) {
    const result = validatePrBase({ base: { ref: 'main', sha: SHA }, head }, { eventHeadSha: HEAD })
    assert.equal(result.ok, true, `head=${JSON.stringify(head)}`)
    assert.equal(result.apiHeadSha, '')
    assert.match(result.warnings.join('\n'), /无法交叉核对/)
  }
})

test('校验：响应不是 PR 对象（非对象 / 缺 base / base 非对象）一律 fail closed', () => {
  const cases = [
    ['数组', []],
    ['字符串', 'nope'],
    ['null', null],
    ['缺 base', { number: 1 }],
    ['base 是数组', { base: [] }],
    ['base 是字符串', { base: 'main' }],
  ]
  for (const [label, payload] of cases) {
    const result = validatePrBase(payload, { eventHeadSha: HEAD })
    assert.equal(result.ok, false, label)
    assert.deepEqual(result.warnings, [], `${label}：失败时不该同时给 warning`)
  }
})

test('校验：base.sha 与事件 head 的形状不对都失败，且错误信息点名是哪一个', () => {
  const cases = [
    ['base.sha 缺失', (p) => { p.base.sha = undefined }, 'base.sha'],
    ['base.sha 太短', (p) => { p.base.sha = 'a'.repeat(39) }, 'base.sha'],
    ['base.sha 太长', (p) => { p.base.sha = 'a'.repeat(41) }, 'base.sha'],
    ['base.sha 非十六进制', (p) => { p.base.sha = 'z'.repeat(40) }, 'base.sha'],
  ]
  for (const [label, mutate, field] of cases) {
    const payload = validPayload()
    mutate(payload)
    const result = validatePrBase(payload, { eventHeadSha: HEAD })
    assert.equal(result.ok, false, label)
    assert.ok(result.problems.some((p) => p.includes(field)), `${label} 的错误信息要点名 ${field}`)
  }

  // 事件 head 不在 payload 里，而是校验时的第二个输入。
  for (const eventHeadSha of [undefined, null, '', 'abc', 'z'.repeat(40), 'b'.repeat(39)]) {
    const result = validatePrBase(validPayload(), { eventHeadSha })
    assert.equal(result.ok, false, `事件 head=${JSON.stringify(eventHeadSha)} 必须被拒绝`)
    assert.ok(result.problems.some((p) => p.includes('事件 head')), '错误信息要点名是事件 head')
  }
})

test('解析：空 stdin、纯空白、非 JSON 都给出固定措辞，不夹带输入片段', () => {
  for (const [label, text] of [['空串', ''], ['纯空白', '   \n'], ['非 JSON', 'gh: Not Found (HTTP 404)']]) {
    const parsed = parsePrJson(text)
    assert.equal(parsed.ok, false, label)
    assert.equal(parsed.problems.length, 1)
    assert.ok(!parsed.problems[0].includes('404'), `${label}：不得回显输入片段`)
  }
})

test('不回显：错误信息只说字段与长度，不回显响应里的值', () => {
  const secretish = `ghp_${'A'.repeat(36)}`
  const payload = { base: { ref: 'main', sha: secretish } }

  const result = validatePrBase(payload, { eventHeadSha: HEAD })
  const text = [...result.problems, ...result.warnings].join('\n')
  assert.equal(result.ok, false)
  assert.ok(!text.includes('ghp_'), '不得回显值')
  assert.match(text, /实际长度 40/)
})

// ---------------------------------------------------------------------------
// CLI 契约
// ---------------------------------------------------------------------------

test('CLI：成功时 stdout 只有判定输入两行，warning 走 stderr', () => {
  const moved = validPayload()
  moved.head.sha = 'c'.repeat(40)

  const ok = runCli(JSON.stringify(validPayload()))
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(ok.stdout, `base_sha=${SHA}\nhead_sha=${HEAD}\n`)
  assert.equal(ok.stderr, '')

  const warned = runCli(JSON.stringify(moved))
  assert.equal(warned.status, 0)
  assert.equal(warned.stdout, `base_sha=${SHA}\nhead_sha=${HEAD}\n`, 'warning 不得污染 stdout')
  assert.match(warned.stderr, /^::warning::/m, 'GitHub 从 stderr 也解析 workflow command')
})

test('CLI：失败输入 exit 1、stdout 为空、stderr 说明原因', () => {
  const cases = [
    ['事件 head 缺失', JSON.stringify(validPayload()), '', /fail closed/],
    ['base.sha 形状不对', JSON.stringify({ base: { sha: 'nope' } }), HEAD, /fail closed/],
    ['空 stdin', '', HEAD, /stdin 为空/],
    ['非 JSON', 'not json', HEAD, /不是合法 JSON/],
  ]
  for (const [label, input, eventHead, stderrPattern] of cases) {
    const result = runCli(input, eventHead)
    assert.equal(result.status, 1, `${label} 期望 exit 1，实际 ${result.status}`)
    assert.equal(result.stdout, '', `${label}：失败时不得输出半份结果，否则 workflow 会拿到残缺的判定对象`)
    assert.match(result.stderr, stderrPattern, label)
  }
})

test('CLI：带参数是用法错误 exit 2；formatOutputs 只产出行数固定的两行', () => {
  const result = spawnSync(process.execPath, [SCRIPT, 'main'], {
    input: JSON.stringify(validPayload()),
    encoding: 'utf8',
    env: { ...process.env, EVENT_HEAD_SHA: HEAD },
  })
  assert.equal(result.status, 2, '不接受任何位置参数：判定对象只能来自 stdin 与事件 head')
  assert.equal(formatOutputs({ baseSha: SHA, headSha: HEAD }).split('\n').length, 3, '两行 + 末尾换行')
})

test('shaProblems：合法输入返回空数组，字段名出现在错误信息里', () => {
  assert.deepEqual(shaProblems(SHA, 'base.sha'), [])
  assert.deepEqual(shaProblems(SHA.toUpperCase(), 'base.sha'), [], '大写十六进制合法，归一化在校验之后')
  assert.match(shaProblems('', 'base.sha')[0], /^base\.sha /)
})
