/** 原生 timeline 只观察当前 Issue 的 PR 引用；不从正文推导关系。 */
import { isRecord, type Obj } from './decode.ts'
export function referenceNodes(nodes: readonly unknown[], issueId: string): Obj[] {
  const result: Obj[] = []
  for (const raw of nodes) {
    if (!isRecord(raw) || raw.__typename !== 'CrossReferencedEvent' || !isRecord(raw.target) || raw.target.__typename !== 'Issue' || raw.target.id !== issueId || typeof raw.willCloseTarget !== 'boolean' || !isRecord(raw.source)) throw new TypeError('响应形状不符')
    if (raw.source.__typename === 'Issue') continue
    if (raw.source.__typename !== 'PullRequest') throw new TypeError('响应形状不符')
    result.push({ ...raw.source, referenceWillCloseTarget: raw.willCloseTarget })
  }
  return result
}
