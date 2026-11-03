/** 列宽是局部展示偏好；本模块不访问 Provider、持久化或业务状态。 */
import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { TABLE_COLUMNS, type TableColumnId } from './table-columns.ts'

type Column = typeof TABLE_COLUMNS[number]
export type ColumnWidths = Partial<Record<TableColumnId, number>>

export function clampColumnWidth(column: Column, value: number): number {
  return Math.min(column.maxWidth, Math.max(column.minWidth, Number.isFinite(value) ? value : column.defaultWidth))
}

export function widthForKey(column: Column, width: number, key: string, shift = false): number | undefined {
  if (key === 'Home') return column.minWidth
  if (key === 'End') return column.maxWidth
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined
  return clampColumnWidth(column, width + (key === 'ArrowRight' ? 1 : -1) * (shift ? 32 : 8))
}

export function useColumnWidths(scopeKey: string | undefined) {
  const [state, setState] = useState<{ scopeKey: string | undefined; widths: ColumnWidths; epoch: number }>({ scopeKey, widths: {}, epoch: 0 })
  // 同一 render 隔离 scope，返回旧 scope 时也不能复活旧偏好。
  if (state.scopeKey !== scopeKey) setState({ scopeKey, widths: {}, epoch: state.epoch + 1 })
  return {
    widths: state.scopeKey === scopeKey ? state.widths : {},
    interactionKey: JSON.stringify([scopeKey, state.epoch]),
    setWidth: (column: Column, value: number): void => setState(previous => ({ ...previous, scopeKey,
      widths: { ...(previous.scopeKey === scopeKey ? previous.widths : {}), [column.id]: clampColumnWidth(column, value) } })),
    reset: (): void => setState(previous => ({ scopeKey, widths: {}, epoch: previous.epoch + 1 })),
  }
}

type Interaction = { preventDefault(): void; stopPropagation(): void }
type HorizontalRect = { left: number; right: number }
type ScrollOwner = { scrollLeft: number; getBoundingClientRect(): HorizontalRect; querySelector(selector: string): { getBoundingClientRect(): HorizontalRect } | null }
type CaptureTarget = {
  setPointerCapture(id: number): void; hasPointerCapture(id: number): boolean; releasePointerCapture(id: number): void
  getBoundingClientRect(): HorizontalRect; closest(selector: string): ScrollOwner | null; ownerDocument: { activeElement: unknown }
  focus(options?: { preventScroll: boolean }): void; classList: { add(name: string): void; remove(name: string): void }
}
type PointerInput = Interaction & { pointerId: number; isPrimary: boolean; button: number; clientX: number; currentTarget: CaptureTarget }
type Drag = { id: number; x: number; width: number; target: CaptureTarget; change(width: number): void }

/** 独立 slider hit area；未来排序按钮只占旁边的 label slot，不共享事件入口。 */
export function ColumnResizeHandle({ column, width, onChange }: { column: Column; width: number; onChange(width: number): void }): ReactElement {
  const active = useRef<Drag | undefined>(undefined)
  const element = useRef<CaptureTarget | null>(null), reveal = useRef(false)
  const revealFocusedHandle = (): void => {
    const target = element.current, surface = target?.closest('.hp-list-scroll')
    if (!target || !surface || target.ownerDocument.activeElement !== target) return
    const rect = target.getBoundingClientRect(), bounds = surface.getBoundingClientRect()
    const start = column.id === 'title' ? bounds.left : surface.querySelector('thead th')?.getBoundingClientRect().right ?? bounds.left
    // 只移动 X；原生 scrollIntoView 会把 sticky header 的 Y 拉回其文档位置。
    if (rect.right > bounds.right) surface.scrollLeft += rect.right - bounds.right + 1
    else if (rect.left < start) surface.scrollLeft -= start - rect.left + 1
  }
  useEffect(() => {
    if (reveal.current) { reveal.current = false; revealFocusedHandle() }
  })
  const finish = (rollback: boolean): void => {
    const drag = active.current
    if (!drag) return
    active.current = undefined
    drag.target.classList.remove('hp-resizing')
    if (rollback) drag.change(drag.width)
    if (drag.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id)
  }
  useEffect(() => () => { finish(false) }, [])
  const stop = (event: Interaction): void => event.stopPropagation()
  const end = (event: PointerInput, rollback: boolean): void => {
    event.stopPropagation()
    if (active.current?.id === event.pointerId) { finish(rollback); if (!rollback) revealFocusedHandle() }
  }
  return createElement('span', {
    ref: element, role: 'slider', tabIndex: 0, className: 'hp-column-resize', 'aria-label': `调整${column.label}列宽`,
    'aria-orientation': 'horizontal', 'aria-valuemin': column.minWidth, 'aria-valuemax': column.maxWidth,
    'aria-valuenow': width, 'aria-valuetext': `${width} 像素`,
    'aria-description': '拖动边界或用左右方向键调整；Shift 加大步长，Home 和 End 到边界。',
    onClick: stop, onDoubleClick: stop, onBlur: () => finish(true),
    onPointerDown: (event: PointerInput): void => {
      event.stopPropagation()
      if (!event.isPrimary || event.button !== 0 || active.current) return
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { return }
      event.currentTarget.focus({ preventScroll: true })
      active.current = { id: event.pointerId, x: event.clientX, width, target: event.currentTarget, change: onChange }
      event.currentTarget.classList.add('hp-resizing')
    },
    onPointerMove: (event: PointerInput): void => {
      event.stopPropagation()
      const drag = active.current
      if (drag?.id === event.pointerId) drag.change(clampColumnWidth(column, drag.width + event.clientX - drag.x))
    },
    onPointerUp: (event: PointerInput): void => end(event, false),
    onPointerCancel: (event: PointerInput): void => end(event, true),
    onLostPointerCapture: (event: PointerInput): void => end(event, true),
    onKeyDown: (event: Interaction & { key: string; shiftKey: boolean }): void => {
      event.stopPropagation()
      if (event.key === 'Escape' && active.current) { event.preventDefault(); finish(true); return }
      const next = widthForKey(column, width, event.key, event.shiftKey)
      if (next !== undefined) { event.preventDefault(); reveal.current = true; onChange(next) }
    },
  })
}
