import { AccessLevel, CapabilityKey, providerErr, providerError, type ExecutionProvider } from '@harness-projects/capabilities'
import { ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { createHumanExecutionProvider } from '@harness-projects/provider-execution-human'

export const MANUAL_ISSUER_HANDLE = 'HARNESS_PROJECTS_MANUAL_ISSUER_KEY'
/** 描述能力不解析 secret；真正操作按当前稳定句柄构造签发者，密钥永不进入配置或 DTO。 */
export function createHostHumanExecution(bindingId: ProviderBindingId, resolve: (handle: string) => Promise<string | undefined>): ExecutionProvider {
  const invoke = async <T>(work: (provider: ExecutionProvider) => Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_yes, reject) => { timer = setTimeout(() => reject(new Error('credential unavailable')), 30_000) })
      const key = await Promise.race([resolve(MANUAL_ISSUER_HANDLE), deadline])
      if (typeof key !== 'string' || Buffer.byteLength(key) < 32) throw new Error('key unavailable')
      return await work(createHumanExecutionProvider({ bindingId, issuerKey: Buffer.from(key), fallback: true }))
    } catch { return providerErr(providerError(ProviderErrorCode.Unavailable, '人工备用密钥不可用')) }
    finally { clearTimeout(timer) }
  }
  return {
    definition: { implementationKey: 'execution.human', domains: ['execution'] },
    async describeCapabilities() {
      const capability = { [CapabilityKey.ExecutionRunStart]: AccessLevel.Available, [CapabilityKey.ExecutionRunRead]: AccessLevel.Available,
        [CapabilityKey.ExecutionRunCancel]: AccessLevel.Available, [CapabilityKey.ExecutionRunFallback]: AccessLevel.Available }
      return { bindingId, capability, permission: capability, observedAt: new Date().toISOString() }
    },
    startRun: (input) => invoke((provider) => provider.startRun(input)),
    getRun: (ref) => invoke((provider) => provider.getRun(ref)),
    cancelRun: (ref) => invoke((provider) => provider.cancelRun!(ref)),
  }
}
