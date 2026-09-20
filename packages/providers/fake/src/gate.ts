/**
 * 工程域替身的共同闸门：离线、权限被拒与"能力未声明"三种失败的统一翻译，外加能力快照组装。
 *
 * 三个工程域共用一份映射（ExecPlan D3 的"一组能一起工作的替身"）：各 provider 只声明自己启用了
 * 哪些能力，错误码到 `ProviderResult` 的翻译不重复实现；裸异常一律不出现在这里，调用方拿到的
 * 永远是可以分支的结构化结果。
 */
import * as cap from '@harness-projects/capabilities'
import { ProviderErrorCode, type ProviderBindingId } from '@harness-projects/domain'
import { FaultKind, type FaultSwitch } from './faults.ts'

/** provider 层失败的唯一构造入口：错误码只能来自 8 码闭集。 */
export function providerFail<T>(code: ProviderErrorCode, message: string): cap.ProviderResult<T> {
  return cap.providerErr(cap.providerError(code, message))
}

export class FakeGate {
  readonly faults: FaultSwitch
  readonly bindingId: ProviderBindingId
  readonly observedAt: string

  /** 显式字段赋值而不是构造器参数属性：Node 的类型剥离不支持参数属性。 */
  constructor(faults: FaultSwitch, bindingId: ProviderBindingId, observedAt: string) {
    this.faults = faults
    this.bindingId = bindingId
    this.observedAt = observedAt
  }

  /** 读路径共用闸门：先离线（可原样重发）再权限（需人补授权）。 */
  blocked<T>(): cap.ProviderResult<T> | undefined {
    if (this.faults.isOn(FaultKind.Offline)) return providerFail(ProviderErrorCode.Unavailable, '替身离线：请求未发出')
    if (this.faults.isOn(FaultKind.PermissionDenied)) return providerFail(ProviderErrorCode.PermissionDenied, '凭据没有该域权限')
    return undefined
  }

  /** 未声明的可选能力：not_supported（转人工流程），不是可重试的平台错误，也不是静默成功。 */
  unsupported<T>(key: cap.CapabilityKey): cap.ProviderResult<T> {
    return providerFail(ProviderErrorCode.NotSupported, `未启用的能力：${key}`)
  }

  notFound<T>(what: string): cap.ProviderResult<T> { return providerFail(ProviderErrorCode.NotFound, `${what}不存在`) }
  ambiguous<T>(what: string): cap.ProviderResult<T> { return providerFail(ProviderErrorCode.AmbiguousResult, `${what}结果不确定`) }

  /** 能力已声明但凭据被撤销时 permission 必须显式 unavailable；调用方缺 permission 时结论同样是不可用。 */
  snapshot(capability: Partial<Record<cap.CapabilityKey, cap.AccessLevel>>): cap.ProviderCapabilitySnapshot {
    const permission: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {}
    const denied = this.faults.isOn(FaultKind.PermissionDenied)
    for (const key of Object.keys(capability) as cap.CapabilityKey[]) {
      permission[key] = denied ? cap.AccessLevel.Unavailable : cap.AccessLevel.Available
    }
    return { bindingId: this.bindingId, capability, permission, observedAt: this.observedAt }
  }
}
