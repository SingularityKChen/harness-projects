/**
 * 交付谱系条与共享新鲜度年龄规则契约（issue #357，ADR-0011 第 3 条）：合成投影，不触网、不读时钟（now 是参数）。
 * 保护：年龄只从集合的 `confirmedAt` 起算（A4、A5）；未确认 / 标陈旧 / 超阈值的集合永不派生为 passed（A3）；
 * 缺跳是缺口、不是第二条关系（A2）；输出没有任何规划控件（A6）；可用性只来自逐跳标志、与节点状态双向正交（A7）；派生是纯函数（A8）；
 * 命令位置与提交 / 变更请求位置的降级（A9）。
 * 每组都带正对照（会派生出 passed 的那一行），防「全部不是 passed」的空绿。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createEntityStore } from '@harness-projects/client'

import {
  DELIVERY_FRESHNESS_THRESHOLD_MS,
  DeliveryFreshnessState,
  deliverySetFreshness,
  deriveDeliveryLineageStrip,
  deriveWorkItemList,
} from '@harness-projects/ui-model'

const T0 = '2026-10-21T07:00:00.000Z'
const MINUTE = 60_000
const THRESHOLD = DELIVERY_FRESHNESS_THRESHOLD_MS
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'ui-model', 'src')
/** 距 T0 `ms` 毫秒的 ISO 时刻（负数在 T0 之前）。 */
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString()
const set = (kind, confirmedAt, stale = false) => ({ kind, confirmedAt, stale })
/** 字段齐全的跳（形状同 core 的 `DeliveryLineageHop`）；`extra` 覆盖，缺字段用 `undefined` 之外的手段删掉。 */
const hop = (entityKind, extra = {}) => ({
  relationType: ({ execution_context: 'tracks', worktree: 'has_worktree', commit: 'derived_from', change_request: 'produced_by' })[entityKind] ?? 'runs_on',
  source: 'lineage', relationSource: ['execution_context', 'worktree'].includes(entityKind) ? 'explicit' : 'deterministic',
  relationState: ['execution_context', 'worktree'].includes(entityKind) ? 'confirmed' : 'candidate', provenance: ['execution_context', 'worktree'].includes(entityKind) ? 'command' : 'provider_read',
  from: `${entityKind}-from`, to: `${entityKind}-to`, entityKind, externalId: `${entityKind}-1`, label: undefined, observed: true,
  unavailable: false, detail: undefined, fact: undefined, stale: false, ...extra,
})
const SETS = ['commit', 'change_request', 'pipeline_run', 'check_run']
const freshSets = (confirmedAt = T0) => SETS.map((kind) => set(kind, confirmedAt))
const POSITIONS = ['execution_context', 'worktree', 'commit', 'change_request', 'pipeline_run', 'check_run']
/** 完整链：七个节点，流水线两条（ci_passed、无事实），检查一条 ci_failed。 */
const chain = () => [
  hop('execution_context', { externalId: 'ctx-1' }), hop('worktree', { externalId: 'wt-1', label: 'feature/x' }), hop('commit', { externalId: 'c1' }),
  hop('change_request', { externalId: 'cr1' }), hop('pipeline_run', { externalId: 'p1', fact: 'ci_passed' }), hop('pipeline_run', { externalId: 'p2' }),
  hop('check_run', { externalId: 'k1', fact: 'ci_failed' }),
]
const projection = (hops = chain(), extra = {}) => ({
  workItemId: 'wi-1', repositoryId: 'repo-alpha', hops, optional: [], degraded: false, error: undefined, attemptedAt: T0, freshness: freshSets(), gaps: [], ...extra,
})
const slotOf = (strip, position) => strip.slots.find((slot) => slot.position === position)
const statesOf = (strip, position) => slotOf(strip, position).nodes.map((node) => node.state)
const deepFreeze = (value) => { if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze) } return value }

test('A5 年龄规则：阈值严格大于年龄才新鲜，等于即陈旧；默认 5 分钟，可配置；阈值 0 合法', () => {
  assert.equal(DELIVERY_FRESHNESS_THRESHOLD_MS, 300_000)
  assert.deepEqual({ ...DeliveryFreshnessState }, { Fresh: 'fresh', Stale: 'stale', Unconfirmed: 'unconfirmed' })
  const confirmed = set('pipeline_run', T0)
  assert.equal(deliverySetFreshness(confirmed, T0), 'fresh', '年龄 0')
  assert.equal(deliverySetFreshness(confirmed, at(299_999)), 'fresh', '阈值减 1 ms：正对照')
  assert.equal(deliverySetFreshness(confirmed, at(300_000)), 'stale', '年龄等于阈值：陈旧')
  assert.equal(deliverySetFreshness(set('pipeline_run', at(-6 * MINUTE)), T0), 'stale', '6 分钟前确认，默认阈值')
  assert.equal(deliverySetFreshness(set('pipeline_run', at(-6 * MINUTE)), T0, 10 * MINUTE), 'fresh', '同一集合在 10 分钟阈值下新鲜')
  assert.equal(deliverySetFreshness(confirmed, T0, 0), 'stale', '阈值 0 合法，恒陈旧')
  assert.equal(deliverySetFreshness(confirmed, at(1), undefined), 'fresh', '显式 undefined 取默认阈值')
  const future = set('pipeline_run', at(60 * MINUTE))
  assert.equal(deliverySetFreshness(future, T0), 'fresh', '确认时刻晚于 now：年龄夹到 0，默认阈值下新鲜')
  assert.equal(deliverySetFreshness(future, T0, 0), 'stale', '夹零后年龄 0 不小于阈值 0：陈旧（不夹零会误判为新鲜）')
})

test('A5 未确认与标陈旧：缺集合或坏 confirmedAt 降级为 unconfirmed 且不抛；stale 非 false 先于年龄判陈旧', () => {
  assert.equal(deliverySetFreshness(undefined, T0), 'unconfirmed')
  assert.equal(deliverySetFreshness(null, T0), 'unconfirmed', 'JSON null 与缺集合采用同一降级')
  for (const confirmedAt of [undefined, '2026-10-21', 'garbage', '', '2026-13-45T00:00:00Z']) {
    assert.equal(deliverySetFreshness({ confirmedAt, stale: false }, T0), 'unconfirmed', String(confirmedAt))
  }
  assert.equal(deliverySetFreshness({ confirmedAt: undefined, stale: true }, T0), 'unconfirmed', '未确认先于标陈旧')
  assert.equal(deliverySetFreshness(set('commit', T0, true), T0), 'stale', 'stale: true，年龄 0')
  assert.equal(deliverySetFreshness({ confirmedAt: T0 }, T0), 'stale', '缺 stale 字段：失败关闭')
  assert.equal(deliverySetFreshness({ confirmedAt: T0, stale: 'false' }, T0), 'stale', 'stale 不是布尔 false：失败关闭')
  assert.equal(deliverySetFreshness({ confirmedAt: T0, stale: false }, T0), 'fresh', '正对照')
})

test('A5 坏参数响亮失败：now 非 ISO 8601 抛 TypeError（集合缺失时也抛），阈值非有限非负数抛 RangeError', () => {
  for (const now of [undefined, '', '2026', '2026-10-21', '2026-13-45T00:00:00Z', 1_792_566_000_000]) {
    assert.throws(() => deliverySetFreshness(set('commit', T0), now), TypeError, String(now))
    assert.throws(() => deliverySetFreshness(undefined, now), TypeError, `集合缺失：${String(now)}`)
  }
  for (const thresholdMs of [Number.NaN, -1, Number.POSITIVE_INFINITY, '300000', null]) {
    assert.throws(() => deliverySetFreshness(set('commit', T0), T0, thresholdMs), RangeError, String(thresholdMs))
  }
})

test('A10 不存在的月日不能归一后变新鲜：坏 confirmedAt 是 unconfirmed，坏 now 抛 TypeError；闰日、时区跨日与 24:00 仍合法', () => {
  for (const confirmedAt of ['2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z', '1900-02-29T00:00:00Z', '2026-02-29T23:00:00-01:00']) {
    const now = new Date(Date.parse(confirmedAt) + MINUTE).toISOString()
    assert.equal(deliverySetFreshness({ confirmedAt, stale: false }, now), 'unconfirmed', confirmedAt)
    const input = projection([hop('pipeline_run', { fact: 'ci_passed' })], { freshness: [set('pipeline_run', confirmedAt)] })
    assert.deepEqual(statesOf(deriveDeliveryLineageStrip(input, now), 'pipeline_run'), ['unknown'], `${confirmedAt} 不能派生 passed`)
    assert.throws(() => deliverySetFreshness(undefined, confirmedAt), TypeError, `坏 now：${confirmedAt}`)
  }
  for (const [confirmedAt, now] of [
    ['2000-02-29T00:00:00Z', '2000-02-29T00:01:00Z'],
    ['2024-02-29T23:59:00+08:00', '2024-02-29T16:00:00Z'],
    ['2026-03-01T00:00:00+08:00', '2026-02-28T16:01:00Z'],
    ['2026-02-28T24:00:00Z', '2026-03-01T00:01:00Z'],
  ]) assert.equal(deliverySetFreshness({ confirmedAt, stale: false }, now), 'fresh', `合法正对照：${confirmedAt}`)
})

test('A1 完整链：六个位置按固定顺序，每跳一个节点，状态依次 observed×4、passed、unknown、failed（正对照）', () => {
  const input = projection()
  const strip = deriveDeliveryLineageStrip(input, at(MINUTE))
  assert.deepEqual(strip.slots.map((slot) => slot.position), POSITIONS)
  assert.ok(strip.slots.every((slot) => slot.kind === 'nodes'), '完整链没有缺口')
  assert.deepEqual(strip.slots.map((slot) => statesOf(strip, slot.position)), [['observed'], ['observed'], ['observed'], ['observed'], ['passed', 'unknown'], ['failed']])
  assert.equal(strip.slots.reduce((total, slot) => total + slot.nodes.length, 0), input.hops.length, '节点总数等于 hops 数')
  assert.deepEqual(slotOf(strip, 'worktree').nodes, [{ externalId: 'wt-1', label: 'feature/x', state: 'observed', available: true, relationState: 'confirmed' }], '工作树节点的标签是分支名')
  assert.deepEqual(slotOf(strip, 'pipeline_run').nodes.map((node) => node.externalId), ['p1', 'p2'], '同一位置的节点保持 core 的顺序')
})

test('A2 缺跳是缺口，不是第二条关系：缺口原因取自 gaps，没有则 unknown；节点不借邻居的锚点；error 投影六个 unknown 缺口', () => {
  const noCommit = chain().filter((entry) => entry.entityKind !== 'commit').map((entry) => entry.entityKind === 'pipeline_run' ? { ...entry, to: 'commit-ent-9' } : entry)
  const input = projection(noCommit, { gaps: [{ entityKind: 'commit', reason: 'not_observed' }] })
  const strip = deriveDeliveryLineageStrip(input, at(MINUTE))
  assert.deepEqual(slotOf(strip, 'commit'), { position: 'commit', kind: 'gap', reason: 'not_observed' })
  assert.equal(strip.slots.reduce((total, slot) => total + (slot.kind === 'nodes' ? slot.nodes.length : 0), 0), input.hops.length, '没有为缺口多造节点')
  assert.ok(!JSON.stringify(strip).includes('commit-ent-9'), '流水线跳指向的提交实体不会变成提交位置的节点，也不进输出')
  assert.deepEqual(strip.slots.filter((slot) => slot.kind === 'gap').map((slot) => slot.position), ['commit'], '其余位置照常是节点')
  const reasons = ['not_started', 'not_observed', 'not_refreshed', 'unconfirmed', 'not_refreshed', 'not_observed']
  const all = deriveDeliveryLineageStrip(projection([], { freshness: [], gaps: POSITIONS.map((entityKind, i) => ({ entityKind, reason: reasons[i] })) }), T0)
  assert.deepEqual(all.slots.map((slot) => [slot.position, slot.kind, slot.reason]), POSITIONS.map((position, i) => [position, 'gap', reasons[i]]))
  const failed = deriveDeliveryLineageStrip(projection([], { freshness: [], gaps: [], degraded: true, error: { code: 'invalid_input', message: 'x' } }), T0)
  assert.deepEqual(failed.slots, POSITIONS.map((position) => ({ position, kind: 'gap', reason: 'unknown' })), 'error 投影：没有缺口信息的位置回退 unknown')
})

test('A11 并行谱系逐跳保留同名节点与确认态，不读取关系重识别或投影控制字段', () => {
  const hops = [
    hop('pipeline_run', { externalId: 'shared', label: 'second lineage', fact: 'ci_failed' }),
    hop('worktree', { externalId: 'tree-2' }), hop('commit', { externalId: 'same-commit', label: 'second context' }),
    hop('pipeline_run', { externalId: 'shared', label: 'first lineage', fact: 'ci_passed', relationState: 'confirmed' }),
    hop('worktree', { externalId: 'tree-1' }), hop('commit', { externalId: 'same-commit', label: 'first context' }),
  ]
  const unreadable = (target, keys) => keys.forEach((key) => Object.defineProperty(target, key, { get: () => { throw new Error(`禁止重新识别 ${key}`) } }))
  for (const entry of hops) unreadable(entry, ['from', 'to', 'relationType', 'relationSource', 'source', 'provenance'])
  const input = projection(hops)
  unreadable(input, ['attemptedAt', 'degraded', 'error', 'optional'])
  const strip = deriveDeliveryLineageStrip(input, T0)
  assert.deepEqual(slotOf(strip, 'commit').nodes.map(({ externalId, label }) => [externalId, label]), [['same-commit', 'second context'], ['same-commit', 'first context']])
  assert.deepEqual(slotOf(strip, 'pipeline_run').nodes.map(({ externalId, label, state }) => [externalId, label, state]), [['shared', 'second lineage', 'failed'], ['shared', 'first lineage', 'passed']])
  assert.deepEqual(slotOf(strip, 'pipeline_run').nodes.map(({ relationState }) => relationState), ['candidate', 'confirmed'])
  assert.deepEqual(slotOf(strip, 'worktree').nodes.map(({ externalId }) => externalId), ['tree-2', 'tree-1'])
  assert.deepEqual(slotOf(strip, 'change_request'), { position: 'change_request', kind: 'gap', reason: 'unknown' }, '相邻位置有节点也不补关系')
  assert.equal(strip.slots.reduce((count, slot) => count + (slot.kind === 'nodes' ? slot.nodes.length : 0), 0), 6)
})

/** 返回 [流水线第一个节点, 检查第一个节点] 的状态；`pipelineSet` / `checkSet` 覆盖对应集合（`null` 表示没有该条目），`hopExtra` 覆盖流水线跳。 */
const ciStrip = ({ pipelineSet = set('pipeline_run', T0), checkSet = set('check_run', T0), hopExtra = {}, fact = 'ci_passed', options } = {}) => {
  const hops = [hop('pipeline_run', { fact, ...hopExtra }), hop('check_run', { fact: 'ci_passed' })]
  const sets = [set('commit', T0), set('change_request', T0), pipelineSet, checkSet].filter((entry) => entry !== null)
  return deriveDeliveryLineageStrip(projection(hops, { freshness: sets, gaps: [] }), T0, options)
}
const ciCase = (args) => () => {
  const strip = ciStrip(args)
  return [statesOf(strip, 'pipeline_run')[0], statesOf(strip, 'check_run')[0]]
}
const AGED = (ms) => set('pipeline_run', at(-ms))
const without = (entry, key) => { const { [key]: _omitted, ...rest } = entry; return rest }

test('A3 永不 passed 表：未确认、标陈旧、超阈值的集合各行都不是 passed，只有正对照派生 passed', () => {
  const rows = [
    ['缺 freshness 条目', ciCase({ pipelineSet: null }), ['unknown', 'passed']],
    ['confirmedAt 为 undefined', ciCase({ pipelineSet: set('pipeline_run', undefined) }), ['unknown', 'passed']],
    ['confirmedAt 不是 ISO 8601', ciCase({ pipelineSet: set('pipeline_run', 'garbage') }), ['unknown', 'passed']],
    ['集合 stale: true', ciCase({ pipelineSet: set('pipeline_run', T0, true) }), ['stale', 'passed']],
    ['集合缺 stale 字段', ciCase({ pipelineSet: without(set('pipeline_run', T0), 'stale') }), ['stale', 'passed']],
    ['年龄等于阈值', ciCase({ pipelineSet: AGED(THRESHOLD) }), ['stale', 'passed']],
    ['年龄比阈值小 1 ms（正对照）', ciCase({ pipelineSet: AGED(THRESHOLD - 1) }), ['passed', 'passed']],
    ['hop.stale: true 而集合新鲜', ciCase({ hopExtra: { stale: true } }), ['stale', 'passed']],
    ['hop 缺 stale 字段', ciCase({ hopExtra: { stale: undefined } }), ['stale', 'passed']],
    ['hop.stale: true 且集合未确认', ciCase({ pipelineSet: null, hopExtra: { stale: true } }), ['stale', 'passed']],
    ['新鲜的 ci_failed', ciCase({ fact: 'ci_failed' }), ['failed', 'passed']],
    ['陈旧的 ci_failed', ciCase({ fact: 'ci_failed', pipelineSet: set('pipeline_run', T0, true) }), ['stale', 'passed']],
    ['新鲜但没有事实', ciCase({ hopExtra: { fact: undefined } }), ['unknown', 'passed']],
    ['流水线新鲜而检查集合陈旧', ciCase({ checkSet: set('check_run', T0, true) }), ['passed', 'stale']],
    ['检查集合缺失', ciCase({ checkSet: null }), ['passed', 'unknown']],
    ['阈值 600000 下 6 分钟前确认（正对照）', ciCase({ pipelineSet: AGED(6 * MINUTE), options: { thresholdMs: 10 * MINUTE } }), ['passed', 'passed']],
    ['阈值 0', ciCase({ options: { thresholdMs: 0 } }), ['stale', 'stale']],
  ]
  for (const [name, run, expected] of rows) assert.deepEqual(run(), expected, name)
  assert.deepEqual(rows.filter(([, run]) => run()[0] === 'passed').map(([name]) => name),
    ['年龄比阈值小 1 ms（正对照）', '流水线新鲜而检查集合陈旧', '检查集合缺失', '阈值 600000 下 6 分钟前确认（正对照）'], '流水线位置只有这四行派生 passed：集合新鲜、跳不陈旧且事实是 ci_passed')
})

test('A4 年龄只认 confirmedAt：attemptedAt 新而 confirmedAt 旧 → stale；attemptedAt 坏或在未来而 confirmedAt 新鲜 → 仍 passed', () => {
  const derive = (attemptedAt, confirmedAt) => statesOf(deriveDeliveryLineageStrip(projection(chain(), { attemptedAt, freshness: freshSets(confirmedAt) }), T0), 'pipeline_run')
  assert.deepEqual(derive(T0, at(-10 * MINUTE)), ['stale', 'stale'], 'attemptedAt 等于 now，但最后确认在 10 分钟前')
  for (const attemptedAt of ['garbage', at(24 * 60 * MINUTE), undefined]) assert.deepEqual(derive(attemptedAt, T0), ['passed', 'unknown'], String(attemptedAt))
})

test('A6 无规划控件：strip、缺口、节点 slot、节点的键逐层精确；输出里没有函数值', () => {
  const strip = deriveDeliveryLineageStrip(projection(chain().filter((entry) => entry.entityKind !== 'commit'), { gaps: [{ entityKind: 'commit', reason: 'not_observed' }] }), at(MINUTE))
  assert.deepEqual(Object.keys(strip).sort(), ['nextFlipAt', 'slots'])
  const gap = slotOf(strip, 'commit'), nodes = slotOf(strip, 'pipeline_run')
  assert.deepEqual([gap.kind, nodes.kind], ['gap', 'nodes'], '前置：两种 slot 都在')
  assert.deepEqual(Object.keys(gap).sort(), ['kind', 'position', 'reason'])
  assert.deepEqual(Object.keys(nodes).sort(), ['kind', 'nodes', 'position'])
  for (const node of strip.slots.flatMap((slot) => slot.kind === 'nodes' ? slot.nodes : [])) assert.deepEqual(Object.keys(node).sort(), ['available', 'externalId', 'label', 'relationState', 'state'])
  const walk = (value) => { assert.notEqual(typeof value, 'function'); if (value !== null && typeof value === 'object') Object.values(value).forEach(walk) }
  walk(strip)
})

test('A7 可用性来自逐跳标志：只翻转一条流水线跳的 unavailable，只有它的 available 变 false 且状态不变；缺字段按不可用；不依赖工作区能力键', () => {
  const base = deriveDeliveryLineageStrip(projection(), at(MINUTE))
  const flipped = deriveDeliveryLineageStrip(projection(chain().map((entry) => entry.externalId === 'p2' ? { ...entry, unavailable: true } : entry)), at(MINUTE))
  const flat = (strip) => strip.slots.flatMap((slot) => slot.nodes.map((node) => [node.externalId, node.available, node.state]))
  assert.deepEqual(flat(base).filter(([, available]) => !available), [], '前置：基线全部可用')
  assert.deepEqual(flat(flipped).filter(([, available]) => !available), [['p2', false, 'unknown']], '只有 p2 不可用，状态仍是 unknown')
  assert.deepEqual(flat(flipped).map(([id, , state]) => [id, state]), flat(base).map(([id, , state]) => [id, state]), '可用性不改变任何节点状态')
  const missing = chain().map((entry) => entry.externalId === 'p1' ? without(entry, 'unavailable') : entry)
  assert.equal(slotOf(deriveDeliveryLineageStrip(projection(missing), at(MINUTE)), 'pipeline_run').nodes[0].available, false, '缺字段：失败关闭')
  const source = readFileSync(path.join(SRC, 'delivery-lineage.ts'), 'utf8')
  const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
  assert.ok(specifiers.length > 0, '前置：解析到了 import 说明符')
  assert.deepEqual(specifiers.filter((specifier) => /capability-access|client\/keys/.test(specifier)), [], '谱系条不引用按工作区 capability key 判可用性的模块')
})

test('A7 状态不改变可用性：陈旧、未知、passed、failed 的节点 available 都只由自己的 unavailable 决定（与上一条互为反向）', () => {
  const rows = [
    ['新鲜且 ci_passed', {}, 'passed'],
    ['新鲜的 ci_failed', { fact: 'ci_failed' }, 'failed'],
    ['集合 stale: true', { pipelineSet: set('pipeline_run', T0, true) }, 'stale'],
    ['年龄等于阈值', { pipelineSet: AGED(THRESHOLD) }, 'stale'],
    ['hop.stale: true 而集合新鲜', { hopExtra: { stale: true } }, 'stale'],
    ['缺 freshness 条目', { pipelineSet: null }, 'unknown'],
    ['confirmedAt 为 undefined', { pipelineSet: set('pipeline_run', undefined) }, 'unknown'],
    ['新鲜但没有事实', { hopExtra: { fact: undefined } }, 'unknown'],
  ]
  assert.deepEqual([...new Set(rows.map(([, , state]) => state))].sort(), ['failed', 'passed', 'stale', 'unknown'], '前置：覆盖四种 CI 位置状态')
  for (const [name, args, state] of rows) {
    for (const unavailable of [false, true]) {
      const node = slotOf(ciStrip({ ...args, hopExtra: { ...args.hopExtra, unavailable } }), 'pipeline_run').nodes[0]
      assert.deepEqual([node.state, node.available], [state, !unavailable], `${name}，unavailable: ${unavailable}`)
    }
  }
})

test('A8 纯度：深冻结入参两次派生结果相等；源码不读时钟；运行时值不从 client 取；坏 now / 坏阈值在任何派生之前抛出（error 投影也抛）', () => {
  const input = deepFreeze(projection())
  assert.deepEqual(deriveDeliveryLineageStrip(input, at(MINUTE)), deriveDeliveryLineageStrip(input, at(MINUTE)))
  for (const file of ['delivery-lineage.ts', 'timestamp.ts']) {
    const source = readFileSync(path.join(SRC, file), 'utf8')
    assert.doesNotMatch(source, /Date\.now|new Date\(/, `${file} 不读时钟`)
    for (const line of source.split('\n').filter((entry) => /^import\s/.test(entry) && entry.includes('@harness-projects/'))) assert.match(line, /^import type /, `${file}：${line}`)
  }
  const failedProjection = deepFreeze(projection([], { freshness: [], error: { code: 'invalid_input', message: 'x' } }))
  for (const now of [undefined, '', '2026-10-21', 'garbage']) assert.throws(() => deriveDeliveryLineageStrip(failedProjection, now), TypeError, String(now))
  for (const thresholdMs of [Number.NaN, -1, Number.POSITIVE_INFINITY, '300000']) assert.throws(() => deriveDeliveryLineageStrip(failedProjection, T0, { thresholdMs }), RangeError, String(thresholdMs))
  assert.equal(deriveDeliveryLineageStrip(failedProjection, T0, { thresholdMs: 0 }).slots.length, 6, '阈值 0 合法')
})

test('A9 非 CI 位置的降级：命令位置只认 hop.stale（缺字段也陈旧、不过集合年龄规则），提交 / 变更请求再过集合年龄规则，未确认是 unknown；各行带 observed 正对照', () => {
  const stateOf = (position, hopExtra, sets) => statesOf(deriveDeliveryLineageStrip(projection([hop(position, hopExtra)], { freshness: sets, gaps: [] }), T0), position)[0]
  for (const position of ['execution_context', 'worktree']) {
    assert.equal(stateOf(position, {}, freshSets()), 'observed', `${position}：正对照`)
    assert.equal(stateOf(position, { stale: true }, freshSets()), 'stale', `${position}：hop.stale: true`)
    assert.equal(stateOf(position, { stale: undefined }, freshSets()), 'stale', `${position}：hop 缺 stale 字段，失败关闭`)
    assert.equal(stateOf(position, {}, []), 'observed', `${position}：没有任何 freshness 条目也是 observed（命令位置没有集合）`)
    assert.equal(stateOf(position, {}, freshSets(at(-10 * MINUTE))), 'observed', `${position}：所有集合早已超龄也是 observed`)
  }
  for (const position of ['commit', 'change_request']) {
    const withSet = (entry) => [...freshSets().filter((other) => other.kind !== position), ...(entry === null ? [] : [entry])]
    const rows = [
      ['集合新鲜（正对照）', {}, set(position, T0), 'observed'],
      ['年龄比阈值小 1 ms（正对照）', {}, set(position, at(1 - THRESHOLD)), 'observed'],
      ['年龄等于阈值', {}, set(position, at(-THRESHOLD)), 'stale'],
      ['集合 stale: true', {}, set(position, T0, true), 'stale'],
      ['缺 freshness 条目', {}, null, 'unknown'],
      ['confirmedAt 为 undefined', {}, set(position, undefined), 'unknown'],
      ['confirmedAt 不是 ISO 8601', {}, set(position, 'garbage'), 'unknown'],
      ['hop.stale: true 而集合新鲜', { stale: true }, set(position, T0), 'stale'],
      ['hop 缺 stale 字段', { stale: undefined }, set(position, T0), 'stale'],
      ['hop.stale: true 且集合未确认', { stale: true }, null, 'stale'],
    ]
    for (const [name, hopExtra, entry, expected] of rows) assert.equal(stateOf(position, hopExtra, withSet(entry)), expected, `${position}：${name}`)
  }
})

test('A12 公共列表派生拒绝不存在的日历日期，合法闰日仍可展示', () => {
  const read = { store: createEntityStore(), connection: { connected: true } }
  for (const lastUpdatedAt of ['2026-02-30T00:00:00Z', '1900-02-29T00:00:00Z']) {
    assert.throws(() => deriveWorkItemList({ ...read, lastUpdatedAt }), TypeError, lastUpdatedAt)
  }
  assert.equal(deriveWorkItemList({ ...read, lastUpdatedAt: '2024-02-29T00:00:00Z' }).lastUpdatedAt, '2024-02-29T00:00:00Z')
})

test('A13 关系确认态与节点 CI 状态正交，候选通过不能升级成已确认', () => {
  for (const relationState of ['candidate', 'confirmed']) {
    const fresh = deriveDeliveryLineageStrip(projection([hop('pipeline_run', { fact: 'ci_passed', relationState })]), T0)
    const old = deriveDeliveryLineageStrip(projection([hop('pipeline_run', { fact: 'ci_passed', relationState })]), at(THRESHOLD))
    assert.deepEqual(slotOf(fresh, 'pipeline_run').nodes.map(({ state, relationState }) => [state, relationState]), [['passed', relationState]])
    assert.deepEqual(slotOf(old, 'pipeline_run').nodes.map(({ state, relationState }) => [state, relationState]), [['stale', relationState]])
  }
})

test('A14 最早翻转时刻只来自 fresh 集合，边界重派生使 passed 消失并更新下个时刻', () => {
  const input = projection([hop('pipeline_run', { fact: 'ci_passed' }), hop('check_run', { fact: 'ci_passed' })], {
    freshness: [set('commit', at(-MINUTE), true), set('change_request', undefined), set('pipeline_run', T0), set('check_run', at(MINUTE))],
  })
  const first = deriveDeliveryLineageStrip(input, T0)
  assert.equal(first.nextFlipAt, Date.parse('2026-10-21T07:05:00.000Z'))
  assert.deepEqual(statesOf(deriveDeliveryLineageStrip(input, new Date(first.nextFlipAt - 1).toISOString()), 'pipeline_run'), ['passed'])
  const expired = deriveDeliveryLineageStrip(input, new Date(first.nextFlipAt).toISOString())
  assert.deepEqual(statesOf(expired, 'pipeline_run'), ['stale'])
  assert.deepEqual(statesOf(expired, 'check_run'), ['passed'])
  assert.equal(expired.nextFlipAt, Date.parse('2026-10-21T07:06:00.000Z'))
  assert.equal(deriveDeliveryLineageStrip(input, at(THRESHOLD + MINUTE)).nextFlipAt, undefined)
  assert.equal(deriveDeliveryLineageStrip(input, T0, { thresholdMs: 0 }).nextFlipAt, undefined)
  assert.equal(deriveDeliveryLineageStrip(projection([], { freshness: [] }), T0).nextFlipAt, undefined)
  assert.equal(deriveDeliveryLineageStrip(input, T0, { thresholdMs: 2 * MINUTE }).nextFlipAt, Date.parse('2026-10-21T07:02:00.000Z'))
})
