import { decodeString } from 'micromark-util-decode-string'

export interface MarkdownSource { readonly namespace: string; readonly repository: string }
export interface MarkdownNode {
  readonly type: string; readonly tagName?: string; children?: MarkdownNode[]; value?: string; url?: string
  referenceStart?: number
  readonly position?: { readonly start: { readonly offset?: number | undefined }; readonly end: { readonly offset?: number | undefined } } | undefined
}

/** ASCII GitHub owner/repository；拒绝路径段、查询参数及用户名边界歧义。 */
function validRepository(repository: string): boolean {
  const [owner, name, extra] = repository.split('/')
  return extra === undefined && owner !== undefined && name !== undefined
    && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner) && !owner.includes('--')
    && /^[a-z\d_.-]{1,100}$/i.test(name) && name !== '.' && name !== '..'
}

/** 边界只读相邻完整 code point；向前最多检查一对 surrogate，不回扫整段正文。 */
function codePointAt(value: string, index: number): string {
  const point = value.codePointAt(index)
  return point === undefined ? '' : String.fromCodePoint(point)
}
function codePointBefore(value: string, index: number): string {
  let start = index - 1
  const trailing = value.charCodeAt(start), leading = value.charCodeAt(start - 1)
  if (trailing >= 0xdc00 && trailing <= 0xdfff && leading >= 0xd800 && leading <= 0xdbff) start--
  return codePointAt(value, start)
}

/** 仅扫描 parser 的 text leaf 原文；decodeString 只对齐已被 parser 解码的 escape/entity。 */
function references(node: MarkdownNode, source: string, repository: string): MarkdownNode[] {
  const start = node.position?.start.offset, end = node.position?.end.offset
  if (start === undefined || end === undefined || node.value === undefined) return [node]
  const raw = source.slice(start, end), nodes: MarkdownNode[] = []
  // Parser 已移除 blockquote/list 的续行前缀；逐行只接受能与该 text leaf 原值严格对齐的后缀。
  const lines = raw.split(/(?<=\n)|(?<=\r)(?!\n)/), values = node.value.split(/(?<=\n)|(?<=\r)(?!\n)/)
  if (lines.length !== values.length) return [node]
  let sourceOffset = start, valueOffset = 0, emitted = 0
  for (const [lineIndex, line] of lines.entries()) {
    const value = values[lineIndex]!, decoded = decodeString(line)
    if (!decoded.endsWith(value)) return [node]
    const tokens = /(?:[a-z\d_.-]{1,39}\/[a-z\d_.-]{1,100})?#[1-9]\d*/gi
    let rawCursor = 0, valueCursor = valueOffset - (decoded.length - value.length)
    for (const match of line.matchAll(tokens)) {
      const token = match[0], index = match.index
      const before = codePointBefore(line, index), after = codePointAt(line, index + token.length)
      const split = token.lastIndexOf('#'), qualified = token.slice(0, split), number = token.slice(split + 1)
      if (sourceOffset + index < (node.referenceStart ?? start) || /[\p{L}\p{N}\p{M}_@/#.&\\-]/u.test(before)
        || /[\p{L}\p{N}\p{M}_/#\\-]/u.test(after) || (after === '.' && /\d/.test(line[index + token.length + 1] ?? ''))
        || !Number.isSafeInteger(Number(number)) || (qualified !== '' && !validRepository(qualified))) continue
      valueCursor += decodeString(line.slice(rawCursor, index + token.length)).length
      rawCursor = index + token.length
      const valueStart = valueCursor - token.length
      if (node.value.slice(valueStart, valueCursor) !== token || /[\p{L}\p{N}\p{M}_@/#.\\-]/u.test(codePointBefore(node.value, valueStart))
        || /[\p{L}\p{N}\p{M}_/#\\-]/u.test(codePointAt(node.value, valueCursor))
        || (node.value[valueCursor] === '.' && /\d/.test(node.value[valueCursor + 1] ?? ''))) continue
      nodes.push({ type: 'text', value: node.value.slice(emitted, valueStart) },
        { type: 'link', url: `https://github.com/${qualified || repository}/issues/${number}`, children: [{ type: 'text', value: token }] })
      emitted = valueCursor
    }
    sourceOffset += line.length; valueOffset += value.length
  }
  if (nodes.length === 0) return [node]
  nodes.push({ type: 'text', value: node.value.slice(emitted) })
  return nodes
}

/** 无来源不链接；不进入已有链接、媒体、代码或原始 HTML，不读 cwd、不请求 Provider。 */
export function markdownReferences(markdownSource?: MarkdownSource): (tree: MarkdownNode, file: { readonly value: unknown }) => void {
  return (tree, file) => {
    if (markdownSource?.namespace !== 'github.com/graphql/Repository' || !validRepository(markdownSource.repository)) return
    const source = String(file.value), pending = [tree]
    while (pending.length > 0) {
      const node = pending.pop()!
      if (['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference', 'html'].includes(node.type)) continue
      if (node.children === undefined) continue
      node.children = node.children.flatMap(child => child.type === 'text' ? references(child, source, markdownSource.repository) : [child])
      for (const child of node.children) if (child.type !== 'text') pending.push(child)
    }
  }
}
