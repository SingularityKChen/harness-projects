/**
 * 录制夹具的回放 transport（不触网、不需要凭据）。夹具是 `{ provenance, exchanges }`，exchange 为 `{ operationName, variables, status, body }`，
 * 不录响应头。回放键是 `[operationName, 按键排序的 variables]`；命中时记进 `calls` 并返回 body 的深拷贝，未命中时记进 `misses` 再 reject——
 * 使用回放的测试文件最后一条用例都断言 `misses` 为空，未命中因此不会被伪装成「离线」，故障用例也不会空转通过。
 *
 * 同一沙箱 Project A 有两份录制：`project-a.json`（#70 的条目读取）与 `project-fields.json`（#133 的字段读取）。
 * `loadAggregateFixture()` 把两者按键合并，较新的字段录制覆盖旧响应——因为 `PlanningItems` 的查询文本
 * 在 #133 变了形状（多了 `fieldValues`），旧录制的那条请求已经不再是当前查询的响应。
 * 单独 `loadFixture()` 仍是 #70 那份，供字段读取面之外的用例显式使用。
 */
import { readFileSync } from 'node:fs'

const read = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
export const loadFixture = () => read('project-a.json')
export const loadFieldFixture = () => read('project-fields.json')
const keyOf = ({ operationName, variables }) => JSON.stringify([operationName, Object.entries(variables).sort(([left], [right]) => (left < right ? -1 : 1))])

/** 合并多份对同一沙箱的录制：按 (operationName, variables) 去重，后一份覆盖前一份。 */
export function mergeFixtures(...fixtures) {
  const table = new Map()
  for (const fixture of fixtures) for (const exchange of fixture.exchanges) table.set(keyOf(exchange), exchange)
  return { provenance: fixtures.at(-1).provenance, exchanges: [...table.values()] }
}

/** 当前查询文本对应的完整回放夹具：条目夹具 + 字段夹具。 */
export const loadAggregateFixture = () => mergeFixtures(loadFixture(), loadFieldFixture())

export function createReplay(fixture) {
  const table = new Map(fixture.exchanges.map((exchange) => [keyOf(exchange), exchange]))
  const calls = []
  const misses = []
  const transport = async (request) => {
    const exchange = table.get(keyOf(request))
    if (exchange === undefined) {
      misses.push(keyOf(request))
      throw new Error('回放未命中')
    }
    calls.push({ operationName: request.operationName, variables: structuredClone(request.variables) })
    return { status: exchange.status, headers: {}, body: structuredClone(exchange.body) }
  }
  return { transport, calls, misses }
}
