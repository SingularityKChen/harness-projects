import { createElement, type ReactElement } from 'react'
import type { ItemNavigation } from './work-item-list.ts'

/** 标题 anchor 只给安全 item 行：修饰键 / 中键保留真实 href 交给浏览器，普通左键才走 `open`。 */
export function TitleLink({ itemId, title, navigation }: { itemId: string; title: string; navigation: ItemNavigation }): ReactElement {
  const onClick = (event: { preventDefault: () => void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void => {
    if (event.button !== undefined && event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigation.open(itemId)
  }
  return createElement('a', { href: navigation.href(itemId), onClick, 'aria-current': navigation.currentItemId === itemId ? 'true' : undefined }, title)
}
