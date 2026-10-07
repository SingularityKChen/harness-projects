/**
 * GitHub Projects 只读 Planning provider。失败一律是结构化 `ProviderResult`，任何路径都不抛错（`composeCore` 会吞掉裸异常
 * 且不写 degraded）。平台查询参数白名单（R7）：`PlanningProject` / `PlanningItems` / `PlanningFields` 只发 project node id
 * 与分页游标；`PlanningItemFields` 额外发**本次 Project 列表刚读到的成员关系 id**，从不拿内容 id、历史 Draft id 或内容
 * 别名回查。`getPlanningItem` 因此用扫描实现。写入（#71）、调度与退避（#134）不在这里。
 */
import {
  AccessLevel, CapabilityKey, PLANNING_MEMBERSHIP_OBJECT_KIND, makeObservation, providerErr, providerError, providerOk,
  type ExternalObjectRef, type PlanningProvider, type ProviderDefinition, type ProviderIteration, type ProviderObservation,
  type ProviderPlanningFieldDefinition, type ProviderResult,
} from '@harness-projects/capabilities'
import { MembershipContentKind, ProviderErrorCode, type NativePlanningFieldValue, type ProviderBindingId } from '@harness-projects/domain'
import { classifyResponse, failure } from './classify.ts'
import { decodeItemsPage, decodeProject, itemNode, projectNode, type ItemRow, type Obj } from './decode.ts'
import { FIELD_PAGE_SIZE, decodeFieldDefinitionsPage, decodeItemFieldPage } from './fields.ts'
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

/** 先内容观察（没有内容身份时省略），再成员关系观察；两类主体各用自己的版本（E1-1 实验 1），payload 与稳定字段相同。 */
function rowObservations({ item, content }: ItemRow, receivedTime: string): readonly ProviderObservation[] {
  const observe = (subject: ExternalObjectRef, type: string, sourceVersion: string | undefined, fields: Obj): ProviderObservation =>
    makeObservation({ subject, type, eventTime: sourceVersion, receivedTime, sourceVersion, stablePayloadFields: fields, payload: fields })
  const membership = observe(
    { bindingId: item.ref.bindingId, objectKind: PLANNING_MEMBERSHIP_OBJECT_KIND, externalId: item.membership.externalId, url: undefined },
    'planning.membership.observed', item.sourceVersion, {
      project: item.project.externalId, contentKind: content === undefined ? null : item.ref.objectKind,
      contentExternalId: content === undefined ? null : item.ref.externalId, createdAt: item.membership.createdAt ?? null,
      nativeValues: Object.fromEntries(Object.entries(item.fields.nativeValues ?? {}).sort(([left], [right]) => (left < right ? -1 : 1))),
    },
  )
  return content === undefined ? [membership] : [observe(item.ref, 'planning.content.observed', content.version, content.fields), membership]
}

export const GITHUB_PROJECTS_PROVIDER_DEFINITION: ProviderDefinition = Object.freeze({ implementationKey: 'planning.github-projects', domains: Object.freeze(['planning'] as const) })

export function createGithubProjectsPlanningProvider({ bindingId, projectNodeId, transport, now = Date.now }: GithubProjectsPlanningProviderOptions): PlanningProvider {
  const project: ExternalObjectRef = { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }
  const isBoundProject = (ref: ExternalObjectRef): boolean => ref.bindingId === bindingId && ref.objectKind === 'project' && ref.externalId === projectNodeId

  /**
   * 唯一的 try/catch：transport 抛错或 reject → transport_error；分类命中即失败；其余任何不符 → malformed_response。
   * `nodeShape` 是本次查询期望的节点类型：ProjectV2 查询在 node 不可见时报 not_found（项目不可见，不是空页），
   * 成员关系查询的 node 是 ProjectV2Item，形状由各自 decoder 断言（错形状是 malformed_response）。
   */
  async function call<T>(request: GraphqlRequest, decode: (node: Obj) => T, nodeShape: 'project' | 'item' = 'project'): Promise<ProviderResult<T>> {
    let rawClass = 'transport_error'
    let requestId: string | undefined
    try {
      const response = await transport(request)
      rawClass = 'malformed_response'
      requestId = response.headers['x-github-request-id']
      const error = classifyResponse(response, now())
      if (error !== undefined) return providerErr(error, requestId)
      const node = nodeShape === 'project' ? projectNode(response.body) : itemNode(response.body)
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

  /**
   * 字段定义连接：只发 project/first/after；游标成环或超过页数上界整次失败，绝不截断发布。
   * 跨页重复的 `id` 同样整次失败：后面按 id 解析映射，重复时「第一条胜出」会让同一个响应有两种解释。
   * 重复判定用 Set 而不是对已有数组 `some`：定义上界是 500 页 × 100/页，实测 `some` 的 O(n²) 在上界
   * 要 ~11.9s，而这条路径是每次同步都要走的。
   */
  async function scanFieldDefinitions(): Promise<ProviderResult<readonly ProviderPlanningFieldDefinition[]>> {
    const definitions: ProviderPlanningFieldDefinition[] = []
    const seen = new Set<string | undefined>()
    const ids = new Set<string>()
    let cursor: string | undefined
    do {
      seen.add(cursor)
      const result = await call(
        { operationName: 'PlanningFields', query: PLANNING_QUERIES.PlanningFields, variables: { project: projectNodeId, first: FIELD_PAGE_SIZE, after: cursor ?? null } },
        (node) => decodeFieldDefinitionsPage(node, cursor),
      )
      if (!result.ok) return result
      for (const definition of result.value.definitions) {
        if (ids.has(definition.id)) {
          return providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response'))
        }
        ids.add(definition.id)
        definitions.push(definition)
      }
      cursor = result.value.nextCursor
    } while (cursor !== undefined && !seen.has(cursor) && seen.size < MAX_SCAN_PAGES)
    return cursor === undefined ? providerOk(definitions) : providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response'))
  }

  /** 定义连接里的迭代按 `(projectFieldId, iterationId)` 定位：completed 配置要保留，不能被同 id 的 active 覆盖。 */
  const iterationsOf = (definitions: readonly ProviderPlanningFieldDefinition[]): readonly ProviderIteration[] =>
    definitions.flatMap((definition) => (definition.kind === 'iteration' ? [...definition.iterations, ...definition.completedIterations] : []))

  /**
   * 单个成员关系的字段值续页：只发本次列表刚读到的成员关系 id（R7），逐页核对返回的成员关系 id 与 project id。
   * 游标成环、重复字段、任何一页失败都整次失败，不发布部分字段。
   */
  async function continueFieldValues(row: ItemRow): Promise<ProviderResult<Record<string, NativePlanningFieldValue>>> {
    const membershipId = row.item.membership.externalId
    const values: Record<string, NativePlanningFieldValue> = { ...row.fieldValues.nativeValues }
    const sent = new Set<string | undefined>([undefined])
    let cursor = row.fieldValues.nextCursor
    while (cursor !== undefined) {
      if (sent.has(cursor) || sent.size >= MAX_SCAN_PAGES) return providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response'))
      sent.add(cursor)
      const result = await call(
        { operationName: 'PlanningItemFields', query: PLANNING_QUERIES.PlanningItemFields, variables: { item: membershipId, first: FIELD_PAGE_SIZE, after: cursor } },
        (node) => decodeItemFieldPage(node, project, membershipId, cursor),
        'item',
      )
      if (!result.ok) return result
      for (const [fieldId, value] of Object.entries(result.value.nativeValues)) {
        if (Object.hasOwn(values, fieldId)) return providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response'))
        values[fieldId] = value
      }
      cursor = result.value.nextCursor
    }
    return providerOk(values)
  }

  /** 把一页条目补成完整字段值：首页已铺平，`nextCursor` 定义时按成员关系 id 续读。 */
  async function fillFieldValues(rows: readonly ItemRow[]): Promise<ProviderResult<readonly ItemRow[]>> {
    const filled: ItemRow[] = []
    for (const row of rows) {
      if (row.fieldValues.nextCursor === undefined) { filled.push(row); continue }
      const values = await continueFieldValues(row)
      if (!values.ok) return values
      filled.push({ ...row, item: { ...row.item, fields: { ...row.item.fields, nativeValues: values.value } } })
    }
    return providerOk(filled)
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
      if (!result.ok) return result
      const filled = await fillFieldValues(result.value.rows)
      return filled.ok ? providerOk({ items: filled.value.map((row) => row.item), nextCursor: result.value.nextCursor }, result.requestId) : filled
    },
    async getPlanningItem(ref) {
      const byMembership = ref.objectKind === PLANNING_MEMBERSHIP_OBJECT_KIND
      if (ref.bindingId !== bindingId || !(byMembership || CONTENT_KINDS.includes(ref.objectKind))) return invalid('条目引用不属于本绑定')
      const scanned = await scan()
      if (!scanned.ok) return scanned
      const found = scanned.value.find(({ item }) => (byMembership
        ? item.membership.externalId === ref.externalId
        : item.ref.objectKind === ref.objectKind && item.ref.externalId === ref.externalId))
      if (found === undefined) return providerErr(failure(ProviderErrorCode.NotFound, undefined))
      const filled = await fillFieldValues([found])
      if (!filled.ok) return filled
      const row = filled.value[0]
      return row === undefined ? providerErr(failure(ProviderErrorCode.Unavailable, undefined, 'malformed_response')) : providerOk(row.item)
    },
    async listFieldDefinitions(ref) {
      return isBoundProject(ref) ? scanFieldDefinitions() : invalid('项目不是本绑定的项目')
    },
    async listIterations(ref) {
      if (!isBoundProject(ref)) return invalid('项目不是本绑定的项目')
      const definitions = await scanFieldDefinitions()
      return definitions.ok ? providerOk(iterationsOf(definitions.value), definitions.requestId) : definitions
    },
    /**
     * 全量比对（R5，忽略 scope.cursor），全有或全无：读完全部页并全部构造成功后才逐条产出；任何失败（含时钟与观察构造）
     * 一条不产出，也不抛错。失败通道归 #134；引导路径上紧随其后的列表读取会对同一故障给出结构化失败。
     */
    async *reconcile() {
      let observations: readonly ProviderObservation[] = []
      try {
        const scanned = await scan()
        const filled = scanned.ok ? await fillFieldValues(scanned.value) : scanned
        const receivedTime = new Date(now()).toISOString()
        if (filled.ok) observations = filled.value.flatMap((row) => rowObservations(row, receivedTime))
      } catch {
        return
      }
      yield* observations
    },
  }
  return provider
}
