import { createElement, useEffect, useState } from 'react'
import type { ExecutionContextDTO, ExecutionContextReader } from '@harness-projects/client'
import { executionContextText, type ExecutionTarget } from '@harness-projects/ui-model'

type Result = { readonly repositoryId: string; readonly context?: ExecutionContextDTO | null; readonly refreshing: boolean; readonly unavailable: boolean }
type State = { readonly key: string; readonly results: readonly Result[] }
const FAILED = '暂时无法读取执行状态'
export function ExecutionContextSection({ target, reader, connected, refreshToken }: { readonly target: ExecutionTarget; readonly reader: ExecutionContextReader; readonly connected: boolean; readonly refreshToken?: number | undefined }) {
  const repositories = [...target.repositoryIds].sort(), key = JSON.stringify([target.workspaceId, target.workItemId, repositories])
  const [state, setState] = useState<State>({ key, results: [] })
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    if (!connected) { setState((old) => ({ key, results: old.key === key ? old.results.map((result) => ({ ...result, refreshing: false })) : [] })); return }
    setState((old) => ({ key, results: repositories.map((repositoryId) => ({
      ...(old.key === key ? old.results.find((result) => result.repositoryId === repositoryId) : undefined), repositoryId, refreshing: true, unavailable: false,
    })) }))
    const update = (repositoryId: string, patch: Partial<Result>) => setState((old) => old.key === key
      ? { key, results: old.results.map((result) => result.repositoryId === repositoryId ? { ...result, ...patch } : result) } : old)
    for (const repositoryId of repositories) {
      const scope = { workspaceId: target.workspaceId, workItemId: target.workItemId, repositoryId }
      // 同步 throw 也变成已消费的拒绝；cleanup 后 resolve/reject 均不提交到下一目标。
      void Promise.resolve().then(() => reader(scope)).then(
        (context) => { if (current) update(repositoryId, { context, refreshing: false, unavailable: false }) },
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
      return createElement('div', { key: repositoryId }, createElement('h4', null, `仓库：${repositoryId}`),
        text === undefined ? createElement('p', null, known ? '尚未开始工作' : result?.unavailable ? FAILED : connected ? '正在读取执行状态' : '尚无已读执行状态')
          : createElement('div', null, createElement('p', null, '工作树：', text.path), createElement('p', null, '分支：', text.branch), createElement('p', null, '运行状态：', text.run), text.manual === undefined ? null : createElement('p', null, text.manual)),
        known && (result.refreshing || result.unavailable) ? createElement('p', { role: 'status' }, result.unavailable ? FAILED : '正在刷新执行状态', '（最后已读）') : null)
    })
  return createElement('section', { 'aria-label': '执行上下文' }, createElement('h3', null, '执行上下文'),
    connected ? null : createElement('p', { role: 'status' }, '最后已读（连接已断开）'), content,
    createElement('button', { type: 'button', disabled: !connected, onClick: () => setRefresh((value) => value + 1) }, '刷新执行状态'))
}
