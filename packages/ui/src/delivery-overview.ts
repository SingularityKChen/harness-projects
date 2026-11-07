import { createElement as h, useEffect, useRef, useState } from 'react'
import type { DeliveryLineageReader, DeliveryLineageScope } from '@harness-projects/client'
import type { DeliveryOverviewTargets } from '@harness-projects/ui-model'
import type { ItemNavigation } from './work-item-list.ts'
import { DeliveryLineageSection } from './delivery-lineage-section.ts'
type Job = { current: () => boolean; run: () => Promise<void>; resolve: () => void; reject: (error: Error) => void }
type Page = { key: string; source: DeliveryLineageReader | undefined; reader: DeliveryLineageReader; active: boolean; settled: Map<string, boolean> }
/** 队列只限制显式摄入；section 仍独占 refresh→read、时间、断连与迟到响应围栏。 */
export function DeliveryOverview({ targets, reader, connected, navigation, onBindRepository }: {
  readonly targets: DeliveryOverviewTargets; readonly reader: DeliveryLineageReader | undefined; readonly connected: boolean
  readonly navigation?: ItemNavigation | undefined; readonly onBindRepository?: (() => void) | undefined
}) {
  const [repository, setRepository] = useState<string | undefined>(undefined), [page, setPage] = useState(0), [refreshToken, setRefreshToken] = useState(0)
  const [, announce] = useState(0), queue = useRef<{ running: number; jobs: Job[] }>({ running: 0, jobs: [] }), current = useRef<Page | undefined>(undefined)
  const repositories = targets.kind === 'content' ? targets.repositoryIds : [], repositoryId = repository !== undefined && repositories.includes(repository) ? repository : repositories[0]
  const items = targets.kind === 'content' ? targets.items : [], pageCount = Math.max(1, Math.ceil(items.length / 20)), shownPage = Math.min(page, pageCount - 1), visible = items.slice(shownPage * 20, (shownPage + 1) * 20)
  const key = JSON.stringify([repositoryId, shownPage, refreshToken, connected, targets.kind, visible.map(item => [item.target, item.accessTokens])])
  const pump = () => {
    const state = queue.current
    while (state.running < 3 && state.jobs.length) {
      const job = state.jobs.shift()!
      if (!job.current()) { job.reject(new Error('Expired delivery scope')); continue }
      state.running++
      void Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { state.running--; pump() })
    }
  }
  if (current.current?.key !== key || current.current.source !== reader) {
    if (current.current) current.current.active = false
    const generation: Page = { key, source: reader, active: true, settled: new Map(), reader: {
      refresh: scope => new Promise<void>((resolve, reject) => { queue.current.jobs.push({ current: () => current.current === generation && generation.active, run: async () => { if (current.current !== generation || !generation.active) throw new Error('Expired delivery scope'); await reader?.refresh(scope) }, resolve, reject }); pump() }),
      read: scope => { if (current.current !== generation || !generation.active || reader === undefined) return Promise.reject(new Error('Expired delivery scope')); return reader.read(scope) },
    } }
    current.current = generation
  }
  const generation = current.current
  useEffect(() => { generation.active = true; return () => { generation.active = false; pump() } }, [generation])
  const settled = (id: string, failed: boolean) => { if (current.current !== generation || !generation.active) return; generation.settled.set(id, failed); announce(value => value + 1) }
  const status = !connected ? '连接中断，交付状态尚未确认' : reader === undefined ? '交付读取尚未就绪' : generation.settled.size < visible.length ? '正在刷新本页交付' : [...generation.settled.values()].some(Boolean) ? '部分行未确认' : '本页已刷新'
  const unavailable = targets.kind !== 'content' ? targets.kind === 'loading' ? '正在读取工作项' : '无法读取工作项，确认授权后重试' : items.length === 0 ? '没有可显示交付的工作项' : repositoryId === undefined ? '尚未连接仓库' : undefined
  return h('div', { className: 'hp-delivery-overview' },
    unavailable !== undefined ? h('p', null, unavailable) : h('div', null,
      h('div', { className: 'hp-list-actions' }, h('label', null, '仓库 ', h('select', { 'aria-label': '交付仓库', value: repositoryId, onChange: (event: { target: { value: string } }) => { setRepository(event.target.value); setPage(0) } }, ...repositories.map(id => h('option', { key: id, value: id }, id)))),
        h('button', { type: 'button', disabled: !connected || reader === undefined, onClick: () => setRefreshToken(value => value + 1) }, '刷新本页交付')),
      h('p', null, `第 ${shownPage + 1} / ${pageCount} 页 · 共 ${items.length} 项；仅展示工程事实，CI 不代表发布接受。`),
      h('p', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, status),
      ...visible.map(item => {
        const scope: DeliveryLineageScope = { workspaceId: item.target.workspaceId, workItemId: item.target.workItemId, repositoryId: repositoryId! }
        return h('article', { key: item.key, className: 'hp-delivery-row' }, h('div', null, h('h3', null, navigation === undefined ? item.title : h('a', { href: navigation.href(item.key), onClick: (event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigation.open(item.key) } } }, item.title)), item.numberLabel === undefined ? null : h('p', null, item.numberLabel)),
          reader === undefined ? h('p', null, '交付读取尚未就绪') : h(DeliveryLineageSection, { scope, reader: generation.reader, connected, accessToken: item.accessTokens[repositoryId!], presentation: 'summary', refreshToken, onSettled: failed => settled(item.key, failed) }))
      }),
      h('nav', { 'aria-label': '交付分页' }, h('button', { type: 'button', disabled: shownPage === 0, onClick: () => setPage(shownPage - 1) }, '上一页'), h('button', { type: 'button', disabled: shownPage + 1 >= pageCount, onClick: () => setPage(shownPage + 1) }, '下一页'))),
    repositoryId === undefined && onBindRepository !== undefined ? h('button', { type: 'button', onClick: onBindRepository }, '连接设置') : null,
    h('style', null, STYLES))
}
const STYLES = `
.hp-delivery-overview { min-width:0; overflow-wrap:anywhere }
.hp-delivery-overview select { max-width:100%; min-height:44px; font:inherit; color:inherit; background:Canvas }
.hp-delivery-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,3fr); gap:var(--hp-space-4); padding-block:var(--hp-space-4); border-block-start:1px solid var(--hp-border) }
.hp-delivery-row h3 { margin:0; font-size:1rem; overflow-wrap:anywhere }
.hp-delivery-row a { color:inherit; text-underline-offset:3px }
.hp-delivery-row .hp-delivery-summary { margin:0; padding:0; border:0 }
.hp-delivery-summary ol { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--hp-space-4); list-style:none; margin:0; padding:0 }
.hp-delivery-summary li { padding:0; margin:0 }
.hp-delivery-overview nav { display:flex; flex-wrap:wrap; gap:var(--hp-space-2) }
@media(max-width:48rem) { .hp-delivery-row,.hp-delivery-summary ol { grid-template-columns:minmax(0,1fr) } }
`
