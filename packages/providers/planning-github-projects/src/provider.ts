/**
 * GitHub Projects 只读 Planning provider。失败一律是结构化 `ProviderResult`，任何路径都不抛错（`composeCore` 会吞掉裸异常
 * 且不写 degraded）。平台查询参数只有 project node id 与游标（R7），`getPlanningItem` 因此用扫描实现。
 * 字段与迭代（#133）、写入（#71）、调度与退避（#134）不在这里。
 */
import {
  AccessLevel, CapabilityKey, PLANNING_MEMBERSHIP_OBJECT_KIND, makeObservation, providerErr, providerError, providerOk,
  type ExternalObjectRef, type PlanningProvider, type ProviderDefinition, type ProviderObservation, type ProviderResult,
} from '@harness-projects/capabilities'
import { MembershipContentKind, ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { classifyResponse, failure } from './classify.ts'
import { decodeItemsPage, decodeProject, projectNode, type ItemRow, type Obj } from './decode.ts'
import { PLANNING_QUERIES } from './queries.ts'
import type { GraphqlRequest, GraphqlTransport } from './transport.ts'

export interface GithubProjectsPlanningProviderOptions {
  readonly bindingId: ProviderBindingId; readonly projectNodeId: string; readonly transport: GraphqlTransport
  /** 返回有限的毫秒数（否则 describeCapabilities 会在组装时抛错，见 TD13）；缺省 `Date.now`。 */
  readonly now?: () => number
}

/** 平台单页上限；调用方给的 limit 钳位到这里。扫描至多 MAX_SCAN_PAGES 页（5 万条）。 */
const [MAX_PAGE_SIZE, MAX_SCAN_PAGES] = [100, 500]
const CONTENT_KINDS: readonly string[] = Object.values(MembershipContentKind)
const invalid = <T>(message: string): ProviderResult<T> => providerErr(providerError(ProviderErrorCode.InvalidInput, message))
const notSupported = async <T>(): Promise<ProviderResult<T>> => providerErr(providerError(ProviderErrorCode.NotSupported, '字段与迭代读取尚未实现'))

/** 先内容观察（没有内容身份时省略），再成员关系观察；两类主体各用自己的版本（E1-1 实验 1），payload 与稳定字段相同。 */
function rowObservations({ item, content }: ItemRow, receivedTime: string): readonly ProviderObservation[] {
  const observe = (subject: ExternalObjectRef, type: string, sourceVersion: string | undefined, fields: Obj): ProviderObservation =>
    makeObservation({ subject, type, eventTime: sourceVersion, receivedTime, sourceVersion, stablePayloadFields: fields, payload: fields })
  const membership = observe(
    { bindingId: item.ref.bindingId, objectKind: PLANNING_MEMBERSHIP_OBJECT_KIND, externalId: item.membership.externalId, url: undefined },
    'planning.membership.observed', item.sourceVersion, {
      project: item.project.externalId, contentKind: content === undefined ? null : item.ref.objectKind,
      contentExternalId: content === undefined ? null : item.ref.externalId, createdAt: item.membership.createdAt ?? null,
    },
  )
  return content === undefined ? [membership] : [observe(item.ref, 'planning.content.observed', content.version, content.fields), membership]
}

export const GITHUB_PROJECTS_PROVIDER_DEFINITION: ProviderDefinition = Object.freeze({ implementationKey: 'planning.github-projects', domains: Object.freeze(['planning'] as const) })

export function createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport, now = Date.now }: GithubProjectsPlanningProviderOptions): PlanningProvider {
  const project: ExternalObjectRef = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
  const isBoundProject = (ref: ExternalObjectRef): boolean => ref.bindingId === bindingId && ref.objectKind === 'project' && ref.externalId === projectNodeId

  /** 唯一的 try/catch：transport 抛错或 reject → transport_error；分类命中即失败；项目不可见 → not_found；其余任何不符 → malformed_response。 */
  async function call<T>(request: GraphqlRequest, decode: (node: Obj) => T): Promise<ProviderResult<T>> {
    let rawClass = 'transport_error'
    let requestId: string | undefined
    try {
      const response = await transport(request)
      rawClass = 'malformed_response'
      requestId = response.headers['x-github-request-id']
      const error = classifyResponse(response, now())
      if (error !== undefined) return providerErr(error, requestId)
      const node = projectNode(response.body)
      return node === undefined ? providerErr(failure(ProviderErrorCode.NotFound, requestId), requestId) : providerOk(decode(node), requestId)
    } catch {
      return providerErr(failure(ProviderErrorCode.Unavailable, requestId, rawClass), requestId)
    }
  }

  const page = (cursor: string | undefined, limit: number) => call(
    { operationName: 'PlanningItems', query: PLANNING_QUERIES.PlanningItems, variables: { project: projectNodeId, first: Math.min(limit, MAX_PAGE_SIZE), after: cursor ?? null } },
    (node) => decodeItemsPage(node, project, cursor),
  )

  /** 读完全部页；游标回到已发送过的值（成环）或超过页数上界按形状错误处理，不死循环。 */
  async function scan(): Promise<ProviderResult<readonly ItemRow[]>> {
    const rows: ItemRow[] = []
    const sent = new Set<string | undefined>()
    let cursor: string | undefined
    do {
      sent.add(cursor)
      const result = await page(cursor, MAX_PAGE_SIZE)
      if (!result.ok) return result
      rows.push(...result.value.rows)
      cursor = result.value.nextCursor
    } while (cursor !== undefined && !sent.has(cursor) && sent.size < MAX_SCAN_PAGES)
    return cursor === undefined ? providerOk(rows) : providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response'))
  }

  const provider: PlanningProvider = {
    definition: GITHUB_PROJECTS_PROVIDER_DEFINITION,
    async describeCapabilities() {
      const probe = await provider.getProject(project)
      const code = probe.ok ? undefined : probe.error.code
      const permission = code === undefined ? AccessLevel.Available
        : code === ProviderErrorCode.PermissionDenied || code === ProviderErrorCode.NotFound ? AccessLevel.Unavailable : AccessLevel.Degraded
      return {
        bindingId, capability: { [CapabilityKey.PlanningItemRead]: AccessLevel.Available },
        permission: { [CapabilityKey.PlanningItemRead]: permission }, observedAt: new Date(now()).toISOString(),
      }
    },
    async getProject(ref) {
      if (!isBoundProject(ref)) return invalid('项目不是本绑定的项目')
      return call({ operationName: 'PlanningProject', query: PLANNING_QUERIES.PlanningProject, variables: { project: projectNodeId } }, (node) => decodeProject(node, project))
    },
    async listPlanningItems({ project: ref, cursor, limit }) {
      if (!isBoundProject(ref)) return invalid('项目不是本绑定的项目')
      if (!Number.isInteger(limit) || limit < 1) return invalid('limit 必须是不小于 1 的整数')
      const result = await page(cursor, limit)
      return result.ok ? providerOk({ items: result.value.rows.map((row) => row.item), nextCursor: result.value.nextCursor }, result.requestId) : result
    },
    async getPlanningItem(ref) {
      const byMembership = ref.objectKind === PLANNING_MEMBERSHIP_OBJECT_KIND
      if (ref.bindingId !== bindingId || !(byMembership || CONTENT_KINDS.includes(ref.objectKind))) return invalid('条目引用不属于本绑定')
      const scanned = await scan()
      if (!scanned.ok) return scanned
      const found = scanned.value.find(({ item }) => (byMembership
        ? item.membership.externalId === ref.externalId
        : item.ref.objectKind === ref.objectKind && item.ref.externalId === ref.externalId))
      return found === undefined ? providerErr(failure(ProviderErrorCode.NotFound, undefined)) : providerOk(found.item)
    },
    listFieldDefinitions: notSupported,
    listIterations: notSupported,
    /**
     * 全量比对（R5，忽略 scope.cursor），全有或全无：读完全部页并全部构造成功后才逐条产出；任何失败（含时钟与观察构造）
     * 一条不产出，也不抛错。失败通道归 #134；引导路径上紧随其后的列表读取会对同一故障给出结构化失败。
     */
    async *reconcile() {
      let observations: readonly ProviderObservation[] = []
      try {
        const scanned = await scan()
        const receivedTime = new Date(now()).toISOString()
        if (scanned.ok) observations = scanned.value.flatMap((row) => rowObservations(row, receivedTime))
      } catch {
        return
      }
      yield* observations
    },
  }
  return provider
}
