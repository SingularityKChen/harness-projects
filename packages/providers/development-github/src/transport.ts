/**
 * 注入的 GraphQL 传输：provider 不触网、不持有凭据；鉴权与超时属于实现方（宿主）。mutation 不允许自动重发；网络失败用 reject 表达。
 * `headers` 的键一律小写；`body` 是已解析的 JSON，不能解析时为 undefined。
 * 三个类型与 planning-github-projects 的 transport.ts 结构逐字同形：宿主可以用同一个 POST /graphql 实现服务两个 provider。
 */
export interface GraphqlRequest { readonly operationName: string; readonly query: string; readonly variables: Readonly<Record<string, unknown>> }
export interface GraphqlResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }
export type GraphqlTransport = (request: GraphqlRequest) => Promise<GraphqlResponse>
