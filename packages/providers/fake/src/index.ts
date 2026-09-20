/** @harness-projects/provider-fake —— 离线替身包。Responsibility: 为各能力域提供内存替身与故障注入计划，供契约套件与 MVP-0 链路在无凭据、无网络条件下使用。Allowed imports: @harness-projects/domain、@harness-projects/capabilities。
 * 替身集中在一个包里（ExecPlan D3）：拆成五个包只会多出五份仅供测试的 manifest 与锁文件改动，却没有任何独立验收价值。 */
import { createFakePlanningProvider, type FakePlanningProvider, type FakePlanningProviderOptions } from './planning.ts'

export * from './faults.ts'
export * from './state.ts'
export * from './fixtures.ts'
export * from './planning.ts'
export * from './storage.ts'

export interface FakeProvidersOptions {
  readonly planning?: FakePlanningProviderOptions
}

export interface FakeProviders {
  readonly planning: FakePlanningProvider
}

/** 组合根：一次拿到一组能一起工作的替身。 */
export function createFakeProviders(options: FakeProvidersOptions = {}): FakeProviders {
  return { planning: createFakePlanningProvider(options.planning ?? {}) }
}
