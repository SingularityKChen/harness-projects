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

interface MarkdownNode { readonly type: string; readonly tagName?: string; children?: MarkdownNode[]; readonly value?: string }
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
    createElement(Markdown, { remarkPlugins: [remarkGfm, limitStructureDepth], components,
      allowedElements: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'em', 'strong', 'del', 'br', 'hr'],
      urlTransform: value => safeURL(value) ?? '', children: body }))
}
