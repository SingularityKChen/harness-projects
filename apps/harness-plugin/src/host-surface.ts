/**
 * 本壳用到的宿主 API 的最小结构类型。
 *
 * 不 import react 或任何 `@deepseek-ai/*` 类型包：锁文件与构建都不需要宿主包（D16）。
 * 组件写成 `(...args: never[]) => unknown`，任何函数组件都可赋值。
 */

import type { GenerationStream } from '@harness-projects/client'
import type { ArgsOf, OPERATIONS, StreamName, UnaryName } from './host-operations.ts'

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

/** 宿主 0.2.0-rc.2 的 unary 结果（dsh-api-gateway RemoteResult）：失败 resolve 成 `{ ok: false, error }`，不 reject。 */
export type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

type Ops = typeof OPERATIONS

/** 由 `OPERATIONS` 派生：unary 是带声明参数的 `Promise<RemoteResult>` 方法，stream 只接取消 signal。 */
export type RemoteNamespace = {
  readonly [K in UnaryName<Ops>]: (...args: ArgsOf<Ops[K]['params']>) => Promise<RemoteResult<unknown>>
} & {
  /** stream 描述符：同步返回宿主流，项原样交付（网关不 decode 流项）。 */
  readonly [K in StreamName<Ops>]: (signal: AbortSignal) => AsyncIterable<unknown>
}

/** 宿主 `remote.$stream` 的选项（0.2.0-rc.2）：只写本壳用到的成员。 */
export interface RemoteStreamOptions {
  readonly name: string
  open(signal: AbortSignal): AsyncIterable<unknown>
  ended(accepted: boolean): Error
  carrierFailed?(error: Error): void
}

export interface ClientRemote {
  $mount(contribution: unknown): Promise<() => Promise<void>>
}

export interface ClientInjectedContext {
  readonly remote: { readonly harnessProjects: RemoteNamespace; $stream(options: RemoteStreamOptions): GenerationStream }
  readonly slots: SlotsService
  /** Cordis Context 方法：fiber 卸载时执行 `execute()` 返回的 disposer。 */
  effect(execute: () => () => unknown, label?: string): unknown
}

/** 根 Context 只读 `remote`；namespace 与 slots 只能在注入子 Context 里读取。 */
export interface ClientContext {
  readonly remote: ClientRemote
  inject(names: readonly string[], callback: (ctx: ClientInjectedContext) => unknown): unknown
}
