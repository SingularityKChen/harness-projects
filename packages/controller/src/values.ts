/** 浏览器安全的 wire 运行时值；不得导入 Host/Core/Storage/Provider 或 Node 内置模块。 */
export const WireFreshness = { Fresh: 'fresh', Degraded: 'degraded' } as const
export type WireFreshness = (typeof WireFreshness)[keyof typeof WireFreshness]

export const WireAuthority = { Provider: 'provider', Host: 'host', Manual: 'manual' } as const
export type WireAuthority = (typeof WireAuthority)[keyof typeof WireAuthority]
