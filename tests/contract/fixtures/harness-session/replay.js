import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

export const recorded = JSON.parse(readFileSync(new URL('./session-api.json', import.meta.url), 'utf8'))
/** 同键按录制出现顺序消费；场景选择与占位替换由调用方显式完成。 */
export function replay(exchanges) {
  const remaining = structuredClone(exchanges)
  const take = async (operation, request) => {
    const at = remaining.findIndex((x) => x.operation === operation && isDeepStrictEqual(x.request, request))
    assert.notEqual(at, -1, `未知请求：${operation} ${JSON.stringify(request)}`)
    const { outcome } = remaining.splice(at, 1)[0]
    if (!outcome.ok) throw Object.assign(Error('录制远端错误'), outcome.error)
    return structuredClone(outcome.value)
  }
  return { create: (x) => take('create', x), prompt: (x) => take('prompt', x), cancel: (x) => take('cancel', x),
    inspect: (sessionId) => take('inspect', typeof sessionId === 'string' ? { sessionId } : sessionId), list: (x) => take('list', x),
    assertConsumed: () => assert.equal(remaining.length, 0, '场景存在未消费请求') }
}
