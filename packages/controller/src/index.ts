/**
 * @harness-projects/controller —— 对外类型化 API 与增量流
 *
 * Responsibility: 对外类型化 Query / Command API、Host 与客户端模型之间的命令与增量流、权限边界；不复制业务规则。
 * Allowed imports: @harness-projects/domain、@harness-projects/capabilities、@harness-projects/core
 */

export const packageId = '@harness-projects/controller' as const
