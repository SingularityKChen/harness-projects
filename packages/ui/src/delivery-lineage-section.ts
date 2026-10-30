import { createElement as h, useEffect, useRef, useState } from 'react'
import type { DeliveryLineageRead, DeliveryLineageReader, DeliveryLineageScope } from '@harness-projects/client'
import { deriveDeliveryLineageStrip } from '@harness-projects/ui-model'
const LABELS = { execution_context: '执行上下文', worktree: '工作树（分支）', commit: '提交', change_request: '变更请求', pipeline_run: '流水线', check_run: '检查' }
const GAPS = { not_started: '尚未开始工作', not_observed: '尚未观察到', not_refreshed: '尚未刷新', unconfirmed: '尚未确认', permission_denied: '读取被拒绝', unknown: '原因未知' }
const STATES = { observed: '已观察', passed: '通过', failed: '失败', unknown: '未知', stale: '陈旧（最后已知）' }
type Refresh = { key: string; reader: DeliveryLineageReader; task?: Promise<boolean> }
type State = { key: string; reader: DeliveryLineageReader; thresholdMs: number | undefined; read?: DeliveryLineageRead; pending: boolean; failed: boolean }
/** 每个明确仓库 scope 一个消费者：只有 open/manual 才摄入；时间边界与恢复只纯读 Host。 */
export function DeliveryLineageSection({ scope, reader, connected, thresholdMs, accessToken }: { readonly accessToken?: string | undefined; readonly scope: DeliveryLineageScope; readonly reader: DeliveryLineageReader; readonly connected: boolean; readonly thresholdMs?: number }) {
  const scopeKey = JSON.stringify([scope.workspaceId, scope.workItemId, scope.repositoryId]), key = JSON.stringify([scopeKey, accessToken])
  const [state, setState] = useState<State>({ key, reader, thresholdMs, pending: true, failed: false })
  const refreshing = useRef<Refresh | undefined>(undefined)
  const opened = useRef<string | undefined>(undefined), action = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    const source: Refresh = refreshing.current?.key === key && refreshing.current.reader === reader ? refreshing.current : { key, reader }
    refreshing.current = source
    let active = true, generation = 0, timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
    const mark = () => { cancel(); generation++; if (active) setState((old) => ({ ...(old.key === key && old.reader === reader ? old : { key, reader }), thresholdMs, pending: true, failed: false })) }
    const load = async (refresh: boolean) => {
      if (!active) return
      mark(); const request = generation
      if (!connected) return
      let failed = false
      if (refresh) {
        // 同 scope 的命令生命期跨纯读请求/effect 重放；后来的时钟读必须等摄入完成。
        const task = Promise.resolve(source.task).then(async () => { try { await reader.refresh(scope); return false } catch { return true } })
        source.task = task
        void task.then(() => { if (source.task === task) delete source.task })
      }
      while (source.task !== undefined) {
        failed = await source.task || failed
        if (!active || request !== generation) return
      }
      if (!active || request !== generation) return
      try {
        const read = await reader.read(scope)
        if (!active || request !== generation) return
        const strip = deriveDeliveryLineageStrip(read.projection, read.now, thresholdMs === undefined ? {} : { thresholdMs })
        setState({ key, reader, thresholdMs, read, pending: false, failed })
        // 新对象只安装边界；不把接受结果作为下一次读取的依赖。
        if (strip.nextFlipAt !== undefined) timer = setTimeout(() => { void load(false) }, Math.max(0, strip.nextFlipAt - Date.parse(read.now)))
      } catch { if (active && request === generation) setState((old) => ({ ...(old.key === key && old.reader === reader ? old : { key, reader }), thresholdMs, pending: false, failed: true })) }
    }
    const doc = (globalThis as { document?: { visibilityState?: string; addEventListener?: (name: string, listener: () => void) => void; removeEventListener?: (name: string, listener: () => void) => void } }).document
    const win = (globalThis as { window?: { addEventListener?: (name: string, listener: () => void) => void; removeEventListener?: (name: string, listener: () => void) => void } }).window
    const resume = () => { if (doc?.visibilityState === 'hidden') mark(); else void load(false) }
    action.current = () => { void load(true) }
    const first = opened.current !== scopeKey; opened.current = scopeKey
    void load(first)
    doc?.addEventListener?.('visibilitychange', resume); win?.addEventListener?.('pageshow', resume)
    return () => { active = false; generation++; cancel(); action.current = undefined; doc?.removeEventListener?.('visibilitychange', resume); win?.removeEventListener?.('pageshow', resume) }
  }, [key, connected, reader, thresholdMs])
  const current = state.key === key && state.reader === reader ? state : undefined, blocked = !connected || current?.pending !== false || current.failed || current.thresholdMs !== thresholdMs || current.read?.projection.error !== undefined
  const strip = current?.read === undefined ? undefined : deriveDeliveryLineageStrip(current.read.projection, current.read.now, thresholdMs === undefined ? {} : { thresholdMs })
  return h('section', { 'aria-label': '交付谱系' }, h('h3', null, `交付谱系 · ${scope.repositoryId}`),
    blocked ? h('p', { role: 'status' }, !connected ? '连接中断，最后已知；正在核对新鲜度' : current?.failed ? '暂时无法确认谱系，最后已知' : '正在核对新鲜度') : null,
    current?.read?.projection.degraded || current?.read?.projection.error ? h('p', null, '谱系不完整，保留最后已知事实') : null,
    strip === undefined ? h('p', null, '尚无已读谱系') : h('ol', null, ...strip.slots.map((slot) => h('li', { key: slot.position, 'data-position': slot.position }, h('h4', null, LABELS[slot.position]),
      slot.kind === 'gap' ? h('p', { 'data-reason': slot.reason }, `缺口：${GAPS[slot.reason]}${slot.reason === 'permission_denied' ? ' · ' + current?.read?.projection.gaps.find((gap) => gap.entityKind === slot.position)?.key + ' · ' + current?.read?.projection.gaps.find((gap) => gap.entityKind === slot.position)?.layer + '；其它获准集合仍可读取，请恢复授权后刷新交付谱系' : ''}`) : slot.nodes.map((node, index) => {
        const state = blocked && node.state === 'passed' ? 'unknown' : node.state
        return h('p', { key: index, 'data-state': state }, node.label ?? node.externalId ?? '身份未知', ' · ', STATES[state], ' · ', node.relationState === 'candidate' ? '候选关系' : node.relationState === 'confirmed' ? '已确认关系' : '已拒绝关系', node.available ? '' : ' · 逐跳不可用', ['pipeline_run', 'check_run'].includes(slot.position) ? '（所属提交的最后已知 CI）' : '')
      })))),
    h('button', { type: 'button', disabled: !connected, onClick: () => action.current?.() }, '刷新交付谱系'))
}
