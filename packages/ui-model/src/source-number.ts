import type { SourceNumber } from '@harness-projects/domain'

/** 单一展示格式，永远保留来源与 scope，不能从不透明身份推算。 */
export function formatSourceNumber(value: SourceNumber): string {
  return `${value.sourceName} ${value.scopeName}#${value.number}`
}
