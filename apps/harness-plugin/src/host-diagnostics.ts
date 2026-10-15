/**
 * 宿主自有的诊断日志（TD-030、TD-031）：Desktop 看不到宿主 stderr，所以写数据目录下的文件。只依赖 Node 内置模块（不是 Host 入口）。
 * 记录是允许名单投影：异常只留 name、code、errcode，永远不写 message、stack、path、cause 与其它属性——它们可能带凭据、本机路径与提供方原文。
 */
import { appendFileSync } from 'node:fs'

const NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

export function describeError(error: unknown): { readonly name: string; readonly code?: string; readonly errcode?: number } {
  if (!(error instanceof Error)) return { name: 'NonError' }
  try {
    const { name, code, errcode } = error as Error & { code?: unknown; errcode?: unknown }
    return {
      name: typeof name === 'string' && NAME.test(name) ? name : 'Error',
      ...(typeof code === 'string' && CODE.test(code) ? { code } : {}),
      ...(typeof errcode === 'number' && Number.isSafeInteger(errcode) ? { errcode } : {}),
    }
  } catch {
    return { name: 'Error' } // 读属性本身抛错（例如恶意 getter）：宁可少记也不外泄
  }
}

/** 向文件追加 JSON 行 `{ at, event, ...fields }`；写失败吞掉，诊断出口不得改变宿主行为。 */
export function createDiagnosticLog(file: string): { write(event: string, fields: Record<string, unknown>): void } {
  return {
    write(event, fields) {
      try { appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`) } catch { /* 诊断写失败不得影响宿主 */ }
    },
  }
}
