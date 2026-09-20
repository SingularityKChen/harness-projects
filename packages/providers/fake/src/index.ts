/** @harness-projects/provider-fake —— 离线替身包。Responsibility: 为各能力域提供内存替身与故障注入计划，供契约套件与 MVP-0 链路在无凭据、无网络条件下使用。Allowed imports: @harness-projects/domain、@harness-projects/capabilities。
 * 替身集中在一个包里（ExecPlan D3）：拆成五个包只会多出五份仅供测试的 manifest 与锁文件改动，却没有任何独立验收价值。 */
import { createFakeDeliveryProvider, type FakeDeliveryProvider, type FakeDeliveryProviderOptions } from './delivery.ts'
import { createFakeDevelopmentProvider, type FakeDevelopmentProvider, type FakeDevelopmentProviderOptions } from './development.ts'
import { createFakeExecutionProvider, type FakeExecutionProvider, type FakeExecutionProviderOptions } from './execution.ts'
import { createFakePlanningProvider, type FakePlanningProvider, type FakePlanningProviderOptions } from './planning.ts'
import { createFakeStorage, type FakeStorageData, type MemoryStorage } from './storage.ts'

export * from './faults.ts'
export * from './state.ts'
export * from './fixtures.ts'
export * from './planning.ts'
export * from './gate.ts'
export * from './development.ts'
export * from './delivery.ts'
export * from './execution.ts'
export * from './storage.ts'

export interface FakeProvidersOptions {
  readonly planning?: FakePlanningProviderOptions
  readonly development?: FakeDevelopmentProviderOptions
  readonly delivery?: FakeDeliveryProviderOptions
  readonly execution?: FakeExecutionProviderOptions
  readonly storage?: FakeStorageData
}

export interface FakeProviders {
  readonly planning: FakePlanningProvider
  readonly development: FakeDevelopmentProvider
  readonly delivery: FakeDeliveryProvider
  readonly execution: FakeExecutionProvider
  readonly storage: MemoryStorage
}

/** 组合根：一次拿到五个域能一起工作的替身；每个域各自分配 binding，跨域不共享外部身份。 */
export function createFakeProviders(options: FakeProvidersOptions = {}): FakeProviders {
  return {
    planning: createFakePlanningProvider(options.planning ?? {}),
    development: createFakeDevelopmentProvider(options.development ?? {}),
    delivery: createFakeDeliveryProvider(options.delivery ?? {}),
    execution: createFakeExecutionProvider(options.execution ?? {}),
    storage: createFakeStorage(options.storage),
  }
}
