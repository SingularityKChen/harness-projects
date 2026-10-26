/** 0.2.0-rc.2 的 session-probe-v1 归一投影合同，不是原始 ctx.sessionController。
 * Host 接线须从 event.data 提取 turn/reason、从 data.source.rpcId 提取用户身份并过滤非 user 消息，
 * 同步方法须包装为 Promise；本端口不声称已有该适配或新版 Host/Desktop 兼容。
 */
export interface SessionEvent {
  readonly seq: number; readonly type: string; readonly turn?: number; readonly rpcId?: string
  readonly reason?: { readonly kind: string }
}
export interface SessionPort {
  create(input: { cwd: string }): Promise<{ sessionId: string }>
  prompt(input: { requestId: string; sessionId: string; mode: 'queue'; content: readonly { type: 'text'; text: string }[] }, signal: AbortSignal): Promise<{ accepted: boolean }>
  inspect(sessionId: string, signal: AbortSignal): Promise<{ events: readonly SessionEvent[] }>
  list(input: Record<string, never>, signal: AbortSignal): Promise<{ items: readonly { sessionId: string; running: boolean }[] }>
}
