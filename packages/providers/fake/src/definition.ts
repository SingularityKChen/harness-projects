/** 离线替身的静态连接实现定义：四个外部域共用这一份，同 id 跨域挂载时各 fake 类引用同一个对象。 */
import type { ProviderDefinition } from '@harness-projects/capabilities'

export const FAKE_PROVIDER_DEFINITION: ProviderDefinition = Object.freeze({
  implementationKey: 'harness.fake',
  domains: Object.freeze(['planning', 'development', 'delivery', 'execution'] as const),
})
