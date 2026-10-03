/**
 * 浏览器安全的纯值出口（`@harness-projects/domain/values`）：只 re-export 既有词表，不复制常量，也不触达 ids / identity。
 * 根出口经 ids.ts 依赖 node:crypto，浏览器 bundle 因此不能从根出口取运行时值。
 */
export { AccessLevel, ContentKind, NormalizedStatus } from './enums.ts'
export { DerivedFlag } from './status.ts'
