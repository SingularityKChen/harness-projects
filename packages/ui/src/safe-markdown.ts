/** 已通过详情安全门的正文；只产生 React 节点，HTML 保持文字，媒体必须显式打开。 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MARKDOWN_STYLES } from './markdown-presentation.ts'

/** 不使用 base，避免把相对路径升级为当前 Host 的导航；URL 解析前拒绝浏览器会忽略的字符。 */
function safeURL(value: string | undefined): string | undefined {
  if (value === undefined || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f-\u009f\\]|%(?:0[0-9a-f]|1[0-9a-f]|7f)|%c2%(?:8[0-9a-f]|9[0-9a-f])/i.test(value)) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '' ? url.href : undefined
  } catch { return undefined }
}

interface MarkdownNode { readonly type: string; readonly tagName?: string; children?: MarkdownNode[]; value?: string; readonly position?: { readonly start: { readonly offset?: number | undefined }; readonly end: { readonly offset?: number | undefined } } | undefined }
const MAX_STRUCTURE_DEPTH = 64

/** remark 阶段先迭代检查；超限时替换为原文 code 节点，避免后续递归 HAST/React 转换与深层 DOM。 */
function limitStructureDepth(): (tree: MarkdownNode, file: { readonly value: unknown }) => void {
  return (tree, file) => {
    const pending = [{ node: tree, depth: 0 }]
    while (pending.length > 0) {
      const entry = pending.pop()!
      if (entry.depth > MAX_STRUCTURE_DEPTH) {
        tree.children = [{ type: 'code', value: String(file.value) }]
        return
      }
      for (const child of entry.node.children ?? []) pending.push({ node: child, depth: entry.depth + 1 })
    }
  }
}

interface HTMLLiteralContext { rawTag: string | undefined; scriptState?: 'normal' | 'escaped' | 'double'; lastOffset?: number }

/** 有限 script-data 状态；双重转义中的 </script> 只退回 escaped，不结束元素。 */
function scriptEnd(value: string, index: number, context: HTMLLiteralContext): number {
  let state = context.scriptState ?? 'normal'
  const scriptTag = /<(\/?)(script)(?=[\t\n\f\r />])/iy
  while (index < value.length) {
    if (state !== 'normal' && value.startsWith('-->', index)) { state = 'normal'; index += 3; continue }
    if (state === 'normal' && value.startsWith('<!--', index)) { state = 'escaped'; index += 4; continue }
    if (value[index] === '<') {
      scriptTag.lastIndex = index
      const tag = scriptTag.exec(value)
      if (tag?.[1] === '/') {
        if (state !== 'double') { context.scriptState = state; return index }
        state = 'escaped'
      } else if (tag && state === 'escaped') state = 'double'
      if (tag) { index += tag[0].length; continue }
    }
    index++
  }
  context.scriptState = state
  return -1
}

/** 只推进已经开启的 raw context；有效结束后不再解释尾部，更不能开启新元素。 */
function rawTextEnd(value: string, index: number, context: HTMLLiteralContext): number {
  if (context.rawTag === 'script') return scriptEnd(value, index, context)
  if (context.rawTag === undefined || context.rawTag === 'plaintext') return -1
  const closing = new RegExp('</' + context.rawTag + '(?=[\\t\\n\\f\\r />])', 'ig')
  closing.lastIndex = index
  return closing.exec(value)?.index ?? -1
}

/** 只扫描 parser 已识别的 HTML；raw-text/RCDATA、CDATA 和属性仍是惰性字面量。 */
function withoutCommentSpans(value: string, context: HTMLLiteralContext): string {
  const pieces: string[] = []
  let start = 0, index = 0, inTag = false, quote = ''
  let openingRawTag: string | undefined
  const rawOpening = /<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)(?=[\t\n\f\r />])/iy
  while (index < value.length) {
    if (context.rawTag !== undefined) {
      const end = rawTextEnd(value, index, context)
      if (end === -1) break
      index = end
      context.rawTag = undefined
    }
    if (!inTag && value.startsWith('<![CDATA[', index)) {
      const closing = value.indexOf(']]>', index + 9)
      index = closing === -1 ? value.length : closing + 3
      continue
    }
    if (!inTag && value.startsWith('<!--', index)) {
      pieces.push(value.slice(start, index))
      const closing = value.indexOf('-->', index + 4)
      index = closing === -1 ? value.length : closing + 3
      start = index
      continue
    }
    const character = value[index]!
    if (inTag) {
      if (quote) { if (character === quote) quote = '' }
      else if (character === '"' || character === "'") quote = character
      else if (character === '>') {
        inTag = false; context.rawTag = openingRawTag
        if (openingRawTag === 'script') context.scriptState = 'normal'
      }
    } else if (character === '<' && /[a-zA-Z/!?]/.test(value[index + 1] ?? '')) {
      inTag = true
      rawOpening.lastIndex = index
      openingRawTag = rawOpening.exec(value)?.[1]?.toLowerCase()
    }
    index++
  }
  pieces.push(value.slice(start))
  return pieces.join('')
}

/** 深度 guard 之后迭代过滤；code/text 节点（包括超深原文 fallback）不变。 */
function hideHTMLComments(): (tree: MarkdownNode, file: { readonly value: unknown }) => void {
  return (tree, file) => {
    const source = String(file.value)
    const pending: { node: MarkdownNode; context: HTMLLiteralContext | undefined }[] = [{ node: tree, context: undefined }]
    while (pending.length > 0) {
      const { node, context } = pending.pop()!
      if (node.type === 'html' && node.value !== undefined) {
        const start = node.position?.start.offset, end = node.position?.end.offset
        // Gaps may advance/end existing raw text; only HTML nodes may OPEN another context.
        if (context?.rawTag !== undefined && context.lastOffset !== undefined && start !== undefined) {
          if (rawTextEnd(source.slice(context.lastOffset, start), 0, context) !== -1) context.rawTag = undefined
        }
        node.value = withoutCommentSpans(node.value, context ?? { rawTag: undefined })
        if (context && end !== undefined) context.lastOffset = end
      }
      // Phrasing siblings share context; independent Markdown blocks and table cells do not.
      const childContext = ['paragraph', 'heading', 'tableCell'].includes(node.type) ? { rawTag: undefined } : context
      for (let index = (node.children?.length ?? 0) - 1; index >= 0; index--) pending.push({ node: node.children![index]!, context: childContext })
    }
  }
}

function containsInteractiveDescendant(node: MarkdownNode | undefined): boolean {
  const pending = [...(node?.children ?? [])]
  while (pending.length > 0) {
    const child = pending.pop()!
    if (child.tagName === 'img' || child.tagName === 'a') return true
    for (const descendant of child.children ?? []) pending.push(descendant)
  }
  return false
}

const components: Components = {
  a: ({ href, node, children }) => {
    const safe = safeURL(href)
    // 图像来源与内层 autolink 保留自己的动作，外层链接降为文字容器。
    return safe === undefined || containsInteractiveDescendant(node) ? createElement('span', null, children)
      : createElement('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, children)
  },
  img: ({ src, alt }) => {
    const safe = safeURL(src)
    return createElement('span', { className: 'hp-markdown-image' }, alt ?? '', safe === undefined ? null
      : createElement('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, '打开图片来源'))
  },
  input: ({ checked }) => createElement('input', { type: 'checkbox', disabled: true, readOnly: true, checked: checked === true }),
  pre: ({ children }) => createElement('pre', { tabIndex: 0, role: 'region', 'aria-label': '正文代码（可横向滚动）' }, children),
  table: ({ children }) => createElement('div', { className: 'hp-markdown-table', tabIndex: 0, role: 'region', 'aria-label': '正文表格（可横向滚动）' }, createElement('table', null, children)),
}

/** 唯一入参是已获准的 body；不接触 Provider、raw store 或来源 URL。 */
export function SafeMarkdown({ body }: { readonly body: string }): ReactElement {
  return createElement('div', { className: 'hp-markdown' },
    createElement('style', null, MARKDOWN_STYLES),
    createElement(Markdown, { remarkPlugins: [remarkGfm, limitStructureDepth, hideHTMLComments], components,
      allowedElements: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'em', 'strong', 'del', 'br', 'hr'],
      urlTransform: value => safeURL(value) ?? '', children: body }))
}
