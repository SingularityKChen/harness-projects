import { AccessLevel, CapabilityKey, providerErr, providerError, providerOk, type DevelopmentProvider, type ExternalObjectRef, type ProviderAssignee, type ProviderPage, type ProviderResult } from '@harness-projects/capabilities'
import type { GraphqlRequest } from './transport.ts'
import { isRecord, type Obj } from './decode.ts'
const users = 'nodes { id login } pageInfo { hasNextPage endCursor }'
const queries = {
  DevelopmentAssignableUsers: `query DevelopmentAssignableUsers($owner:String!,$name:String!,$first:Int!,$after:String){repository(owner:$owner,name:$name){id nameWithOwner assignableUsers(first:$first,after:$after){${users}}}}`,
  DevelopmentAssignees: `query DevelopmentAssignees($owner:String!,$name:String!,$id:ID!,$after:String){repository(owner:$owner,name:$name){id nameWithOwner} node(id:$id){... on PullRequest{id repository{id} assignees(first:100,after:$after){${users}}}}}`,
  DevelopmentAddAssignees: 'mutation DevelopmentAddAssignees($input:AddAssigneesToAssignableInput!){addAssigneesToAssignable(input:$input){assignable{id}}}',
}
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const reject = (code: 'invalid_input' | 'not_found' | 'unavailable' | 'ambiguous_result' = 'invalid_input') => providerErr(providerError(code, '负责人身份、分页或结果未确认'))
export function assigneeMethods(bindingId: string, repository: { externalId: string; owner: string; name: string }, call: <T>(request: GraphqlRequest, decode: (data: Obj) => T | undefined) => Promise<ProviderResult<T>>) {
  const levels: Record<string, AccessLevel> = { [CapabilityKey.DevelopmentAssigneeList]: AccessLevel.Degraded, [CapabilityKey.DevelopmentChangeRequestAssigneeRead]: AccessLevel.Degraded, [CapabilityKey.DevelopmentChangeRequestAssigneeAdd]: AccessLevel.Degraded }
  const epochs: Record<string, number> = {}
  const snapshot = (input: { repository: ExternalObjectRef; changeRequest: ExternalObjectRef }) => {
    const clone = (ref: ExternalObjectRef) => Object.freeze({ bindingId: ref.bindingId, objectKind: ref.objectKind, externalId: ref.externalId, url: undefined })
    return { repository: clone(input.repository), changeRequest: clone(input.changeRequest) }
  }
  const owns = (ref: ExternalObjectRef, kind: string) => ref.bindingId === bindingId && ref.objectKind === kind && text(ref.externalId) && (kind !== 'repository' || ref.externalId === repository.externalId)
  const ask = (operationName: keyof typeof queries, variables: Obj) => ({ operationName, query: queries[operationName], variables: { owner: repository.owner, name: repository.name, ...variables } })
  const repo = (data: Obj) => { const r = data.repository; if (!isRecord(r) || !text(r.id) || typeof r.nameWithOwner !== 'string' || r.nameWithOwner.toLowerCase() !== `${repository.owner}/${repository.name}`.toLowerCase()) throw Error('repository'); return r }
  function page(value: unknown, after: string | undefined, limit: number) {
    if (!isRecord(value) || !Array.isArray(value.nodes) || value.nodes.length > limit || !isRecord(value.pageInfo) || typeof value.pageInfo.hasNextPage !== 'boolean') throw Error('page')
    const items: ProviderAssignee[] = value.nodes.map(u => { if (!isRecord(u) || !text(u.id) || !text(u.login)) throw Error('user'); return { id: u.id, login: u.login } })
    const next = value.pageInfo.hasNextPage ? value.pageInfo.endCursor : undefined
    if (new Set(items.map(u => u.id)).size !== items.length || (value.pageInfo.hasNextPage && (!text(next) || next === after))) throw Error('cursor')
    return { items, nextCursor: next as string | undefined }
  }
  async function track<T>(key: keyof typeof levels, run: () => Promise<ProviderResult<T>>) {
    const epoch = epochs[key] ?? 0, result = await run()
    if (!result.ok && result.error.code === 'permission_denied') { epochs[key] = (epochs[key] ?? 0) + 1; levels[key] = AccessLevel.Unavailable }
    else if (epoch !== (epochs[key] ?? 0)) return providerErr(providerError('permission_denied', '负责人读取授权已变化'))
    else levels[key] = result.ok ? AccessLevel.Available : AccessLevel.Degraded
    return result
  }
  const listAssignableUsers: NonNullable<DevelopmentProvider['listAssignableUsers']> = async input => {
    const { repository: source, cursor, limit } = input; input = { repository: { ...source }, cursor, limit }
    if (!owns(input.repository, 'repository')) return reject('not_found')
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return reject()
    let after: string | undefined
    try { if (input.cursor !== undefined) { const [scope, cursor] = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()); if (scope !== JSON.stringify([bindingId, repository.externalId, input.limit]) || !text(cursor)) return reject(); after = cursor } } catch { return reject() }
    return track(CapabilityKey.DevelopmentAssigneeList, async () => {
      const result = await call(ask('DevelopmentAssignableUsers', { first: input.limit, after: after ?? null }), data => page(repo(data).assignableUsers, after, input.limit))
      return result.ok ? providerOk({ items: result.value.items, nextCursor: result.value.nextCursor === undefined ? undefined : Buffer.from(JSON.stringify([JSON.stringify([bindingId, repository.externalId, input.limit]), result.value.nextCursor])).toString('base64url') }) : result
    })
  }
  async function scan(read: (cursor: string | undefined) => Promise<ProviderResult<ProviderPage<ProviderAssignee>>>): Promise<ProviderResult<readonly ProviderAssignee[]>> {
    const users: ProviderAssignee[] = [], seen = new Set<string | undefined>(); let cursor: string | undefined
    do {
      seen.add(cursor)
      const result = await read(cursor); if (!result.ok) return result
      if (result.value.items.some(u => users.some(old => old.id === u.id))) return reject('unavailable')
      users.push(...result.value.items); cursor = result.value.nextCursor
    } while (cursor !== undefined && !seen.has(cursor) && seen.size < 100)
    return cursor === undefined ? providerOk(users) : reject('unavailable')
  }
  const getChangeRequestAssignees: NonNullable<DevelopmentProvider['getChangeRequestAssignees']> = async input => {
    input = snapshot(input)
    if (!owns(input.repository, 'repository') || !owns(input.changeRequest, 'change_request')) return reject('not_found')
    const result = await track(CapabilityKey.DevelopmentChangeRequestAssigneeRead, () => scan(after => call(ask('DevelopmentAssignees', { id: input.changeRequest.externalId, after: after ?? null }), data => {
      const r = repo(data), node = data.node
      if (!isRecord(node) || node.id !== input.changeRequest.externalId || !isRecord(node.repository) || node.repository.id !== r.id) throw Error('PR identity')
      return page(node.assignees, after, 100)
    })))
    return result.ok ? providerOk({ changeRequest: { ...input.changeRequest, url: undefined }, users: result.value }) : result
  }
  const addChangeRequestAssignees: NonNullable<DevelopmentProvider['addChangeRequestAssignees']> = async input => {
    const ids = [...input.assigneeIds]; input = { ...snapshot(input), assigneeIds: ids }
    if (ids.length > 10 || !ids.every(text) || new Set(ids).size !== ids.length) return reject()
    const exact = await getChangeRequestAssignees(input); if (!exact.ok) return exact
    if (!ids.length) return providerOk(undefined)
    const listed = await scan(cursor => listAssignableUsers({ repository: input.repository, cursor, limit: 100 })); if (!listed.ok) return listed
    const allowed = new Set(listed.value.map(u => u.id)); if (!ids.every(id => allowed.has(id))) return reject()
    if (levels[CapabilityKey.DevelopmentChangeRequestAssigneeAdd] === AccessLevel.Unavailable) return providerErr(providerError('permission_denied', '负责人添加授权已被拒绝'))
    return track(CapabilityKey.DevelopmentChangeRequestAssigneeAdd, async () => {
      const result = await call(ask('DevelopmentAddAssignees', { input: { assignableId: input.changeRequest.externalId, assigneeIds: ids } }), data => {
        const mutation = data.addAssigneesToAssignable; if (!isRecord(mutation) || !isRecord(mutation.assignable) || mutation.assignable.id !== input.changeRequest.externalId) throw Error('ack'); return true
      })
      return result.ok ? providerOk(undefined) : result.error.code === 'permission_denied' ? result : reject('ambiguous_result')
    })
  }
  return { listAssignableUsers, getChangeRequestAssignees, addChangeRequestAssignees, levels, epochs }
}
