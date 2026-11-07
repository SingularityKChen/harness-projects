import type { IssueClosingLinksObservation, IssueClosingLinksScope } from '@harness-projects/client'
export interface IssueClosingLinksTarget extends IssueClosingLinksScope { readonly sourceToken: string; readonly accessToken: string }
const MESSAGES = { unread: '尚未读取来源关联', denied: '来源关联读取被拒绝，请恢复授权后刷新', unsupported: '当前来源不支持原生关联读取', unavailable: '当前无法读取来源关联，请重试', partial: '来源关联读取不完整，以下仅为已获准观察的记录', complete: '来源关联读取已完成' }
/** 外链只接受显式绝对 http(s)，禁止凭据、空白和控制符；无效时仅显示文字。 */
function href(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f]/.test(value)) return undefined
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '' && url.username === '' && url.password === '' ? url.href : undefined } catch { return undefined }
}
/** display DTO 无 opaque 标识/计数/原始错误；只能说 complete 空集合已确认无关联。 */
export function deriveIssueClosingLinksView(value: IssueClosingLinksObservation) {
  const observed = value.state === 'complete' || value.state === 'partial'
  return {
    message: value.state === 'complete' && value.links.length === 0 ? '来源已确认无原生引用或关闭关联' : MESSAGES[value.state],
    coverage: observed ? Object.entries(value.coverage).map(([kind, c]) => ({ label: kind === 'native_reference' ? '原生引用' : '关闭关联', state: c.state === 'complete' ? '已完成' : c.state === 'partial' ? '不完整' : '不可用', observedAt: c.observedAt })) : [],
    stale: value.stale, ...(observed ? { observedAt: value.observedAt } : {}),
    links: observed ? value.links.map(link => ({ repository: link.repositoryName, number: link.number, title: link.title, href: href(link.url), state: { open: '打开', closed: '已关闭', merged: '已合并' }[link.state], draft: link.isDraft, relation: link.relations.includes('native_closing') ? (link.relations.includes('native_reference') ? '原生引用 · 合并时关闭' : '合并时关闭') : link.referenceWillCloseTarget ? '原生引用；关闭关系尚未确认' : '仅引用' })) : [],
  }
}
