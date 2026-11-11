/** 列宽是局部展示偏好；本模块不访问 Provider、持久化或业务状态。 */
import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { TABLE_COLUMNS, type TableColumnId } from './table-columns.ts'

type Column = typeof TABLE_COLUMNS[number]
export type ColumnWidths = Partial<Record<TableColumnId, number>>

type Bounds = { readonly minWidth: number; readonly maxWidth: number; readonly defaultWidth: number }

export function clampColumnWidth(column: Bounds, value: number): number {
  return Math.min(column.maxWidth, Math.max(column.minWidth, Number.isFinite(value) ? value : column.defaultWidth))
}

export function widthForKey(column: Bounds, width: number, key: string, shift = false): number | undefined {
  if (key === 'Home') return column.minWidth
  if (key === 'End') return column.maxWidth
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return undefined
  return clampColumnWidth(column, width + (key === 'ArrowRight' ? 1 : -1) * (shift ? 32 : 8))
}

/** 唯一数值几何：自动分配空余宽；窄标题的渲染、slider与交互使用同一动态边界。 */
export function resolveColumnWidths(columns: readonly Column[], requested: ColumnWidths, available: number) {
  const bounds: Partial<Record<TableColumnId, Bounds>> = {}, widths: ColumnWidths = {}
  for (const column of columns) {
    const maxWidth = column.id === 'title' && available > 0 ? Math.min(column.maxWidth, Math.max(1, available - 114)) : column.maxWidth
    const range = { minWidth:Math.min(column.minWidth,maxWidth), maxWidth, defaultWidth:column.defaultWidth }
    bounds[column.id] = range
    widths[column.id] = clampColumnWidth(range,requested[column.id] ?? column.defaultWidth)
  }
  if (Object.keys(requested).length === 0) {
    let remaining = available - Object.values(widths).reduce((sum,width) => sum + width,0)
    let growing = columns.filter(column => 'grow' in column && widths[column.id]! < bounds[column.id]!.maxWidth)
    while (remaining > .001 && growing.length > 0) {
      const weight = growing.reduce((sum,column) => sum + ('grow' in column ? column.grow : 0),0)
      let allocated = 0
      for (const column of growing) {
        const share = Math.min(bounds[column.id]!.maxWidth-widths[column.id]!,remaining * ('grow' in column ? column.grow : 0) / weight)
        widths[column.id]! += share
        allocated += share
      }
      remaining -= allocated
      growing = growing.filter(column => widths[column.id]! < bounds[column.id]!.maxWidth)
    }
  }
  return { widths, bounds }
}

const useGeometryEffect = typeof (globalThis as { window?: unknown }).window === 'undefined' ? useEffect : useLayoutEffect
type Surface = { readonly clientWidth: number }
export function useColumnWidths(scopeKey: string | undefined, columns: readonly Column[] = TABLE_COLUMNS) {
  const [state, setState] = useState<{ scopeKey: string | undefined; widths: ColumnWidths; epoch: number }>({ scopeKey, widths: {}, epoch: 0 })
  const [surface, attach] = useState<Surface | null>(null), [available, measure] = useState(0)
  useGeometryEffect(() => {
    if (surface === null) return
    const update = () => measure(surface.clientWidth)
    const Observer = (globalThis as { ResizeObserver?: new (callback: () => void) => { observe(target: Surface): void; disconnect(): void } }).ResizeObserver
    const observer = Observer === undefined ? undefined : new Observer(update)
    update()
    observer?.observe(surface)
    return () => observer?.disconnect()
  }, [surface])
  // 同一 render 隔离 scope，返回旧 scope 时也不能复活旧偏好。
  if (state.scopeKey !== scopeKey) setState({ scopeKey, widths: {}, epoch: state.epoch + 1 })
  const requested = state.scopeKey === scopeKey ? state.widths : {}, effective = resolveColumnWidths(columns,requested,available)
  const freeze = () => Object.keys(requested).length === 0 ? effective.widths : requested
  return {
    ...effective, attach,
    interactionKey: JSON.stringify([scopeKey, state.epoch]),
    begin: (): (() => void) => {
      const before = requested, epoch = state.epoch
      return () => setState(previous => previous.scopeKey === scopeKey && previous.epoch === epoch ? { ...previous, widths:before } : previous)
    },
    setWidth: (column: Column, value: number): void => setState(previous => ({ ...previous, scopeKey,
      widths: { ...(previous.scopeKey === scopeKey && Object.keys(previous.widths).length > 0 ? previous.widths : freeze()), [column.id]:clampColumnWidth(effective.bounds[column.id] ?? column,value) } })),
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
type Drag = { id: number; x: number; width: number; target: CaptureTarget; rollback(): void }

/** 独立 slider hit area；未来排序按钮只占旁边的 label slot，不共享事件入口。 */
export function ColumnResizeHandle({ column, bounds = column, width, onChange, onBegin }: { column: Column; bounds?: Bounds | undefined; width: number; onChange(width: number): void; onBegin(): () => void }): ReactElement {
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
    if (rollback) drag.rollback()
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
    'aria-orientation': 'horizontal', 'aria-valuemin': bounds.minWidth, 'aria-valuemax': bounds.maxWidth,
    'aria-valuenow': width, 'aria-valuetext': `${width} 像素`,
    'aria-description': '拖动边界或用左右方向键调整；Shift 加大步长，Home 和 End 到边界。',
    onClick: stop, onDoubleClick: stop, onBlur: () => finish(true),
    onPointerDown: (event: PointerInput): void => {
      event.stopPropagation()
      if (!event.isPrimary || event.button !== 0 || active.current) return
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { return }
      event.currentTarget.focus({ preventScroll: true })
      active.current = { id: event.pointerId, x: event.clientX, width, target: event.currentTarget, rollback:onBegin() }
      event.currentTarget.classList.add('hp-resizing')
    },
    onPointerMove: (event: PointerInput): void => {
      event.stopPropagation()
      const drag = active.current
      if (drag?.id === event.pointerId) {
        const next = clampColumnWidth(bounds, drag.width + event.clientX - drag.x)
        if (next !== width) onChange(next)
      }
    },
    onPointerUp: (event: PointerInput): void => end(event, false),
    onPointerCancel: (event: PointerInput): void => end(event, true),
    onLostPointerCapture: (event: PointerInput): void => end(event, true),
    onKeyDown: (event: Interaction & { key: string; shiftKey: boolean }): void => {
      event.stopPropagation()
      if (event.key === 'Escape' && active.current) { event.preventDefault(); finish(true); return }
      const next = widthForKey(bounds, width, event.key, event.shiftKey)
      if (next !== undefined) { event.preventDefault(); reveal.current = true; if (next !== width) onChange(next) }
    },
  })
}
