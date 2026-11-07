import { providerErr, providerError, providerOk, type ProviderIssueLinkTargetInput, type ProviderIssueLinkTarget, type ProviderResult } from '@harness-projects/capabilities'
import { ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { classifyResponse, failure } from './classify.ts'
import type { GraphqlTransport } from './transport.ts'
const QUERY = `query PlanningIssueLinkTarget($project: ID!, $membership: ID!, $issue: ID!) {
  project: node(id: $project) { __typename id }
  membership: node(id: $membership) { __typename id ... on ProjectV2Item { type project { id } content { __typename ... on Issue { id number repository { id nameWithOwner } } } } }
  issue: node(id: $issue) { __typename ... on Issue { id number repository { id nameWithOwner } } }
}`
export function issueLinkTarget(bindingId: ProviderBindingId, projectNodeId: string, transport: GraphqlTransport, now: () => number) {
  return async (input: ProviderIssueLinkTargetInput): Promise<ProviderResult<ProviderIssueLinkTarget>> => {
    try {
      input = structuredClone(input)
      if (['project', 'membership', 'issue'].some(k => { const r = input[k as keyof typeof input]; return !r || r.bindingId !== bindingId || r.objectKind !== ({ project: 'project', membership: 'project_item', issue: 'issue' }[k]) || !r.externalId?.trim() }) || input.project.externalId !== projectNodeId) return providerErr(providerError(ProviderErrorCode.InvalidInput, '目标必须指向当前项目、成员关系与 Issue'))
      const response = await transport({ operationName: 'PlanningIssueLinkTarget', query: QUERY, variables: { project: input.project.externalId, membership: input.membership.externalId, issue: input.issue.externalId } })
      const error = classifyResponse(response, now()); if (error) return providerErr(error)
      type Issue = { __typename: string; id: string; number: number; repository: { id: string; nameWithOwner: string } }
      const data = response.body as { data: { project: { __typename: string; id: string }; membership: { __typename: string; id: string; type: string; project: { id: string }; content: Issue }; issue: { __typename: string; id: string; number: number; repository: { id: string; nameWithOwner: string } } } }
      const { project, membership: m, issue: i } = data.data
      if (project.__typename !== 'ProjectV2' || project.id !== input.project.externalId || m.__typename !== 'ProjectV2Item' || m.type !== 'ISSUE' || m.id !== input.membership.externalId || m.project.id !== project.id
        || i.__typename !== 'Issue' || i.id !== input.issue.externalId || m.content.__typename !== 'Issue' || m.content.id !== i.id || m.content.number !== i.number || m.content.repository.id !== i.repository.id || m.content.repository.nameWithOwner !== i.repository.nameWithOwner
        || !Number.isSafeInteger(i.number) || i.number < 1 || !i.repository.id?.trim() || !/^[\w.-]+\/[\w.-]+$/.test(i.repository.nameWithOwner)) throw new TypeError('目标来源不符')
      return providerOk({ source: input, nativeIssueIdentity: { namespace: 'github.com/graphql/Issue', id: i.id }, number: i.number, repository: { identity: { namespace: 'github.com/graphql/Repository', id: i.repository.id }, name: i.repository.nameWithOwner } })
    } catch { return providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response')) }
  }
}
