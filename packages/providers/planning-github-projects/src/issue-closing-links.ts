/** 当前 Issue 来源闭环：输入先限绑定，响应全页回证，任何坏行都不得发布为 complete。 */
import { AccessLevel, providerErr, providerError, providerOk, type ProviderIssueClosingLinksInput, type ProviderIssueClosingLinksPage, type ProviderResult } from '@harness-projects/capabilities'
import { ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { classifyResponse, failure } from './classify.ts'
import { isRecord, type Obj } from './decode.ts'
import { PLANNING_ISSUE_CLOSING_LINKS, PLANNING_ISSUE_REFERENCES } from './queries.ts'
import { referenceNodes } from './issue-references.ts'
import type { GraphqlTransport } from './transport.ts'

const fail = (): never => { throw new TypeError('响应形状不符') }
const obj = (v: unknown): Obj => isRecord(v) ? v : fail()
const str = (v: unknown): string => typeof v === 'string' ? v : fail()
const id = (v: unknown): string => str(v).trim() !== '' ? str(v) : fail()
const repository = (v: unknown) => ({ identity: { namespace: 'github.com/graphql/Repository', id: id(obj(v).id) }, name: id(obj(v).nameWithOwner) })
function decode(body: unknown, input: ProviderIssueClosingLinksInput): ProviderIssueClosingLinksPage {
  const data = obj(obj(body).data), member = obj(data.membership), issue = obj(data.issue), content = obj(member.content)
  if (obj(data.project).__typename !== 'ProjectV2' || obj(data.project).id !== input.project.externalId
    || member.__typename !== 'ProjectV2Item' || member.id !== input.membership.externalId || member.type !== 'ISSUE'
    || obj(member.project).id !== input.project.externalId || content.__typename !== 'Issue' || content.id !== input.issue.externalId
    || issue.__typename !== 'Issue' || issue.id !== input.issue.externalId) fail()
  const sourceRepository = repository(issue.repository), memberRepository = repository(content.repository)
  if (memberRepository.identity.id !== sourceRepository.identity.id || memberRepository.name !== sourceRepository.name) fail()
  const connection = obj(input.relationKind === 'native_reference' ? issue.timelineItems : issue.closedByPullRequestsReferences), info = obj(connection.pageInfo)
  if (!Array.isArray(connection.nodes) || connection.nodes.length > Math.min(input.limit, 100) || typeof info.hasNextPage !== 'boolean') fail()
  const identities = new Set<string>()
  const nodes = input.relationKind === 'native_reference' ? referenceNodes(connection.nodes as unknown[], input.issue.externalId) : connection.nodes
  const items = (nodes as unknown[]).map((raw) => {
    const node = obj(raw)
    if (node.__typename !== 'PullRequest' || !['OPEN', 'CLOSED', 'MERGED'].includes(str(node.state)) || typeof node.isDraft !== 'boolean'
      || !Number.isSafeInteger(node.number) || Number(node.number) < 1) fail()
    const url = str(node.url), parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username !== '' || parsed.password !== '') fail()
    const nativeIdentity = { namespace: 'github.com/graphql/PullRequest', id: id(node.id) }
    const key = JSON.stringify([nativeIdentity.namespace, nativeIdentity.id])
    if (input.relationKind === 'native_closing' && identities.has(key)) fail()
    identities.add(key)
    return { nativeIdentity, repository: repository(node.repository),
      number: Number(node.number), title: str(node.title), url, state: str(node.state).toLowerCase() as 'open' | 'closed' | 'merged',
      isDraft: node.isDraft as boolean, provenance: 'source_observed' as const, relation: input.relationKind, ...(input.relationKind === 'native_reference' ? { referenceWillCloseTarget: node.referenceWillCloseTarget as boolean } : {}) }
  })
  const nextCursor = info.hasNextPage ? id(info.endCursor) : undefined
  if (nextCursor !== undefined && nextCursor === input.cursor || !info.hasNextPage && info.endCursor !== null && typeof info.endCursor !== 'string') fail()
  return { source: { project: input.project, membership: input.membership, issue: input.issue, repository: sourceRepository.identity }, items, nextCursor }
}

export function issueClosingLinks(bindingId: ProviderBindingId, projectNodeId: string, transport: GraphqlTransport, now: () => number) {
  let permission: AccessLevel = AccessLevel.Degraded, denialEpoch = 0
  return {
    permission: () => permission,
    async read(input: ProviderIssueClosingLinksInput): Promise<ProviderResult<ProviderIssueClosingLinksPage>> {
      const copy = (ref: ProviderIssueClosingLinksInput['issue']) => Object.freeze({ bindingId: ref.bindingId, objectKind: ref.objectKind, externalId: ref.externalId, url: undefined })
      try { input = { project: copy(input.project), membership: copy(input.membership), issue: copy(input.issue), cursor: input.cursor, limit: input.limit, relationKind: input.relationKind } }
      catch { return providerErr(providerError(ProviderErrorCode.InvalidInput, '来源读取输入无法读取')) }
      const { project, membership, issue, cursor, limit } = input
      if ([project, membership, issue].some((ref) => ref.bindingId !== bindingId || typeof ref.externalId !== 'string' || ref.externalId.trim() === '')
        || project.objectKind !== 'project' || project.externalId !== projectNodeId || membership.objectKind !== 'project_item' || issue.objectKind !== 'issue'
        || !['native_reference', 'native_closing'].includes(input.relationKind)
        || !Number.isInteger(limit) || limit < 1 || cursor !== undefined && (typeof cursor !== 'string' || cursor === '')) {
        return providerErr(providerError(ProviderErrorCode.InvalidInput, '来源读取必须指向本绑定当前项目、成员关系和 Issue，并使用合法分页参数'))
      }
      const epoch = denialEpoch
      let requestId: string | undefined, rawClass = 'transport_error'
      let result: ProviderResult<ProviderIssueClosingLinksPage>
      try {
        const response = await transport({ operationName: input.relationKind === 'native_reference' ? 'PlanningIssueReferences' : 'PlanningIssueClosingLinks', query: input.relationKind === 'native_reference' ? PLANNING_ISSUE_REFERENCES : PLANNING_ISSUE_CLOSING_LINKS,
          variables: { project: project.externalId, membership: membership.externalId, issue: issue.externalId, first: Math.min(limit, 100), after: cursor ?? null } })
        rawClass = 'malformed_response'
        const rawId = response.headers['x-github-request-id']
        requestId = typeof rawId === 'string' && /^[0-9A-F]{1,8}(?::[0-9A-F]{1,16}){3,5}$/i.test(rawId) ? rawId : undefined
        const error = classifyResponse(response, now())
        result = error === undefined ? providerOk(decode(response.body, input), requestId) : providerErr({ ...error, requestId }, requestId)
      } catch { result = providerErr(failure(ProviderErrorCode.Unavailable, requestId, rawClass), requestId) }
      // 实际拒读使所有在途证明失效；dispatch、离线和拒读前启动的迟到成功都不能恢复权限。
      if (!result.ok && result.error.code === ProviderErrorCode.PermissionDenied) { denialEpoch++; permission = AccessLevel.Unavailable }
      else if (epoch === denialEpoch && (result.ok || permission !== AccessLevel.Unavailable)) permission = result.ok ? AccessLevel.Available : AccessLevel.Degraded
      return result
    },
  }
}
