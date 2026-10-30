import { createElement, useEffect, useState, useRef } from 'react'
import type { ExecutionContextDTO, ExecutionContextReader } from '@harness-projects/client'
import { executionContextText, type ExecutionTarget } from '@harness-projects/ui-model'
import { executionBadge, executionSource, executionStyles } from './execution-presentation.ts'

type Result = { readonly repositoryId: string; readonly context?: ExecutionContextDTO | null; readonly refreshing: boolean; readonly unavailable: boolean }
type State = { readonly key: string; readonly results: readonly Result[] }
const FAILED = '暂时无法读取执行状态'
export function ExecutionContextSection({ target, reader, connected, refreshToken }: { readonly target: ExecutionTarget; readonly reader: ExecutionContextReader; readonly connected: boolean; readonly refreshToken?: number | undefined }) {
  const repositories = [...target.repositoryIds].sort(), key = JSON.stringify([target.workspaceId, target.workItemId, repositories])
  const [state, setState] = useState<State>({ key, results: [] })
  const requested = useRef<string | undefined>(undefined)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    const explicit = requested.current === key; requested.current = undefined
    if (!connected) { setState((old) => ({ key, results: old.key === key ? old.results.map((result) => ({ ...result, refreshing: false })) : [] })); return }
    setState((old) => ({ key, results: repositories.map((repositoryId) => ({
      ...(old.key === key ? old.results.find((result) => result.repositoryId === repositoryId) : undefined), repositoryId, refreshing: true, unavailable: false,
    })) }))
    const update = (repositoryId: string, patch: Partial<Result>) => setState((old) => old.key === key
      ? { key, results: old.results.map((result) => result.repositoryId === repositoryId ? { ...result, ...patch } : result) } : old)
    for (const repositoryId of repositories) {
      const scope = { workspaceId: target.workspaceId, workItemId: target.workItemId, repositoryId }
      // 同步 throw 也变成已消费的拒绝；cleanup 后 resolve/reject 均不提交到下一目标。
      let failed = false
      void Promise.resolve().then(async () => {
        if (!current) return undefined
        if (explicit && reader.refresh !== undefined) { try { await reader.refresh(scope) } catch { failed = true } }
        return current ? reader(scope) : undefined
      }).then(
        (context) => { if (current && context !== undefined) update(repositoryId, { context, refreshing: false, unavailable: failed }) },
        () => { if (current) update(repositoryId, { refreshing: false, unavailable: true }) },
      )
    }
    return () => { current = false }
  }, [key, connected, reader, refresh, refreshToken])
  const results = state.key === key ? state.results : []
  const content = repositories.length === 0 ? createElement('p', null, '仓库信息尚未提供')
    : repositories.map((repositoryId) => {
      const result = results.find((entry) => entry.repositoryId === repositoryId)
      const known = result !== undefined && Object.hasOwn(result, 'context'), context = result?.context ?? null
      const text = context === null ? undefined : executionContextText(context)
      return createElement('div', { key: repositoryId, className: 'hp-execution-repository' }, createElement('h4', null, `仓库：${repositoryId}`),
        text === undefined ? createElement('p', null, known ? '尚未开始工作' : result?.unavailable ? FAILED : connected ? '正在读取执行状态' : '尚无已读执行状态')
          : createElement('div', null, createElement('p', null, '运行状态：', executionBadge(context?.runStatus ?? 'unknown', text.run)),
            text.confirmation === undefined ? null : createElement('p', { className: 'hp-execution-meta' }, text.confirmation),
            text.manual === undefined ? null : createElement('p', { className: 'hp-execution-notice' }, text.manual),
            executionSource('执行来源', createElement('p', null, '工作树：', text.path), createElement('p', null, '分支：', text.branch))),
        known && (result.refreshing || result.unavailable) ? createElement('p', { role: 'status' }, result.unavailable ? FAILED : '正在刷新执行状态', '（最后已读）') : null)
    })
  return createElement('section', { className: 'hp-execution', 'aria-label': '执行上下文' }, executionStyles(), createElement('h3', null, '执行上下文'),
    connected ? null : createElement('p', { role: 'status' }, '最后已读（连接已断开）'), content,
    createElement('button', { className: 'hp-action', type: 'button', disabled: !connected, onClick: () => { requested.current = key; setRefresh((value) => value + 1) } }, '刷新执行状态'))
}
