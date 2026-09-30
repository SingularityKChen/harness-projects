/**
 * 本壳用到的宿主 API 的最小结构类型。
 *
 * 不 import react 或任何 `@deepseek-ai/*` 类型包：锁文件与构建都不需要宿主包（D16）。
 * 组件写成 `(...args: never[]) => unknown`，任何函数组件都可赋值。
 */

export type SlotComponent = (...args: never[]) => unknown

export interface MainSlotOptions {
  readonly name: 'main'
  readonly key: string
}

export interface SidebarPanelListSlotOptions {
  readonly name: 'sidebar.panellist'
  readonly id: string
  readonly order: number
  readonly label: string
}

export type SlotRegisterOptions = MainSlotOptions | SidebarPanelListSlotOptions

export interface SlotsService {
  inject(name: SlotRegisterOptions['name'], callback: () => unknown): unknown
  register(options: SlotRegisterOptions, component: SlotComponent): unknown
}

/** 根 Context：只读 `slots`；读别的属性宿主会抛错（模块级 `inject` 声明了什么才能读什么）。 */
export interface ClientContext {
  readonly slots: SlotsService
}
