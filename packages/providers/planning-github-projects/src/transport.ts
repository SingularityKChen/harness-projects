/**
 * 注入的 GraphQL 传输：provider 不触网、不持有凭据；鉴权、超时与重试都属于实现方（宿主）。网络失败用 reject 表达。
 * `headers` 的键一律小写；`body` 是已解析的 JSON，不能解析时为 undefined。
 */
export interface GraphqlRequest { readonly operationName: string; readonly query: string; readonly variables: Readonly<Record<string, unknown>> }
export interface GraphqlResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }
export type GraphqlTransport = (request: GraphqlRequest) => Promise<GraphqlResponse>
