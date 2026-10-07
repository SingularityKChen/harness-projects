/**
 * 录制夹具的回放 transport（不触网、不需要凭据）。夹具是 `{ provenance, exchanges }`，exchange 为 `{ operationName, variables, status, body }`，
 * 不录响应头。回放键是 `[operationName, 按键排序的 variables]`；命中时记进 `calls` 并返回 body 的深拷贝，未命中时记进 `misses` 再 reject——
 * 使用回放的测试文件最后一条用例都断言 `misses` 为空，未命中因此不会被伪装成「离线」，故障用例也不会空转通过。
 *
 * 同一沙箱 Project A 有两份录制，各带自己的 provenance：`project-a.json`（项目与条目，含字段值）与 `project-fields.json`
 * （#133 的字段定义）。两份的交换互不重叠，`createReplay` 接受多份夹具并合成一张回放表。
 */
import { readFileSync } from 'node:fs'

const read = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
export const loadFixture = () => read('project-a.json')
export const loadFieldFixture = () => read('project-fields.json')
const keyOf = ({ operationName, variables }) => JSON.stringify([operationName, Object.entries(variables).sort(([left], [right]) => (left < right ? -1 : 1))])

export function createReplay(...fixtures) {
  const table = new Map(fixtures.flatMap((fixture) => fixture.exchanges).map((exchange) => [keyOf(exchange), exchange]))
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
