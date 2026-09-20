/**
 * 能力层错误模型契约测试。
 *
 * 保护的不变量：1) provider 错误码是恰好 8 个的闭集，没有任何“未知”逃生口；2) 每个码都带
 * retryable 与 recovery 语义，且与 domain 的判定一致；3) provider 结果的成功/失败分支可判别；
 * 4) 11 个调用方错误码全部被覆盖——8 个由 provider 码到达，3 个显式注明不可达。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PROJECT_CODES_NOT_FROM_PROVIDER,
  PROVIDER_ERROR_CODES,
  isProviderErr,
  isProviderOk,
  projectCodeForProviderError,
  projectError,
  providerErr,
  providerError,
  providerErrorSemantics,
  providerOk,
} from '@harness-projects/capabilities'
import { ProjectErrorCode, ProviderErrorCode, RECOVERY_BY_CODE, Recovery, isRetryable } from '@harness-projects/domain'

test('provider 错误码是闭集：恰好 8 个，取值逐字钉死，且没有一个码表示“未知”', () => {
  assert.equal(
    JSON.stringify(ProviderErrorCode),
    '{"NotSupported":"not_supported","PermissionDenied":"permission_denied","NotFound":"not_found","Conflict":"conflict","RateLimited":"rate_limited","Unavailable":"unavailable","InvalidInput":"invalid_input","AmbiguousResult":"ambiguous_result"}',
  )
  assert.equal(PROVIDER_ERROR_CODES.length, 8)
  assert.deepEqual([...PROVIDER_ERROR_CODES].sort(), Object.values(ProviderErrorCode).sort())
  for (const code of PROVIDER_ERROR_CODES) assert.doesNotMatch(code, /unknown/i)
})

test('每个 provider 码都带 retryable 与 recovery 语义，且与 domain 判定一致', () => {
  for (const code of PROVIDER_ERROR_CODES) {
    const semantics = providerErrorSemantics(code)
    assert.equal(semantics.code, code)
    assert.equal(typeof semantics.retryable, 'boolean')
    assert.ok(Object.values(Recovery).includes(semantics.recovery))
    assert.equal(semantics.retryable, isRetryable(projectCodeForProviderError(code)))
    assert.notEqual(semantics.description, '')
  }
  // 语义必须真的分得开：限流可原样重发，权限与非法输入不可重试，冲突要重放。
  assert.equal(providerErrorSemantics(ProviderErrorCode.RateLimited).retryable, true)
  assert.equal(providerErrorSemantics(ProviderErrorCode.Unavailable).retryable, true)
  assert.equal(providerErrorSemantics(ProviderErrorCode.PermissionDenied).retryable, false)
  assert.equal(providerErrorSemantics(ProviderErrorCode.InvalidInput).retryable, false)
  assert.equal(providerErrorSemantics(ProviderErrorCode.InvalidInput).recovery, Recovery.None)
  assert.equal(providerErrorSemantics(ProviderErrorCode.Conflict).recovery, Recovery.Reapply)
  assert.equal(providerErrorSemantics(ProviderErrorCode.PermissionDenied).recovery, Recovery.FixPermission)
})

test('provider 码到调用方码的映射覆盖 11 个调用方码：8 个可达，3 个显式不可达', () => {
  const allCodes = Object.values(ProjectErrorCode)
  assert.equal(allCodes.length, 11)
  const reachable = new Set(PROVIDER_ERROR_CODES.map((code) => projectCodeForProviderError(code)))
  assert.equal(reachable.size, 8)
  for (const code of reachable) assert.ok(allCodes.includes(code))
  // 不可达的那 3 个必须被显式列出，而不是悄悄漏掉或改名。
  assert.deepEqual([...allCodes].filter((code) => !reachable.has(code)).sort(), ['offline', 'result_unknown', 'stale_revision'])
  assert.deepEqual([...PROJECT_CODES_NOT_FROM_PROVIDER].sort(), ['offline', 'result_unknown', 'stale_revision'])
})

test('ProviderResult 成功/失败分支可判别，错误分支自带 code 与 retryable', () => {
  const ok = providerOk({ id: 'item-1' }, 'req-1')
  assert.equal(isProviderOk(ok), true)
  assert.equal(isProviderErr(ok), false)
  if (isProviderOk(ok)) assert.deepEqual(ok.value, { id: 'item-1' })
  else assert.fail('成功分支被误判为失败')

  const err = providerErr(providerError(ProviderErrorCode.Unavailable, '平台暂时不可用', { requestId: 'req-2', retryAfterMs: 500 }))
  assert.equal(isProviderOk(err), false)
  assert.equal(isProviderErr(err), true)
  if (isProviderErr(err)) {
    assert.equal(err.error.code, ProviderErrorCode.Unavailable)
    assert.equal(err.error.retryable, true)
    assert.equal(err.error.requestId, 'req-2')
    assert.equal(err.error.retryAfterMs, 500)
  } else assert.fail('失败分支被误判为成功')
})

/**
 * golden 表：错误码与恢复动作的字符串值会经契约层暴露给调用方，是公开取值，必须逐条钉死。
 *
 * 只断言“集合里有 11 个成员、每个成员都能查到恢复动作”挡不住改名：domain/errors.ts 用计算键
 * 构造映射表，把某个值从 rate_limited 改成 rate_limit_hit，成员名、数量、映射齐全性全都不变。
 * 因此这里用 JSON 逐字比对（同时锁定成员名、取值与顺序），任何取值改名都必须让用例失败。
 */
const GOLDEN_CODES = {
  ProviderErrorCode: {
    NotSupported: 'not_supported',
    PermissionDenied: 'permission_denied',
    NotFound: 'not_found',
    Conflict: 'conflict',
    RateLimited: 'rate_limited',
    Unavailable: 'unavailable',
    InvalidInput: 'invalid_input',
    AmbiguousResult: 'ambiguous_result',
  },
  ProjectErrorCode: {
    NotSupported: 'not_supported',
    PermissionDenied: 'permission_denied',
    NotFound: 'not_found',
    Conflict: 'conflict',
    RateLimited: 'rate_limited',
    Unavailable: 'unavailable',
    InvalidInput: 'invalid_input',
    AmbiguousResult: 'ambiguous_result',
    ResultUnknown: 'result_unknown',
    StaleRevision: 'stale_revision',
    Offline: 'offline',
  },
  Recovery: {
    Retry: 'retry',
    Refresh: 'refresh',
    Reapply: 'reapply',
    OpenProvider: 'open_provider',
    FixPermission: 'fix_permission',
    ManualExecution: 'manual_execution',
    None: 'none',
  },
}

/** 调用方码 → 恢复动作的完整映射；key 就是 ProjectErrorCode 的字面值。 */
const GOLDEN_RECOVERY_BY_CODE = {
  not_supported: 'manual_execution',
  permission_denied: 'fix_permission',
  not_found: 'open_provider',
  conflict: 'reapply',
  rate_limited: 'retry',
  unavailable: 'retry',
  invalid_input: 'none',
  ambiguous_result: 'refresh',
  result_unknown: 'refresh',
  stale_revision: 'reapply',
  offline: 'retry',
}

test('错误码字面值 golden 表：provider 8 个、调用方 11 个、恢复动作 7 个逐条写死', () => {
  assert.equal(JSON.stringify(ProviderErrorCode), JSON.stringify(GOLDEN_CODES.ProviderErrorCode))
  assert.equal(JSON.stringify(ProjectErrorCode), JSON.stringify(GOLDEN_CODES.ProjectErrorCode))
  assert.equal(JSON.stringify(Recovery), JSON.stringify(GOLDEN_CODES.Recovery))
})

test('RECOVERY_BY_CODE 完整映射 golden 表：11 个调用方码逐条钉死恢复动作', () => {
  assert.equal(JSON.stringify(RECOVERY_BY_CODE), JSON.stringify(GOLDEN_RECOVERY_BY_CODE))
})

test('没有确认值时必须显式为空：capabilities 调用方能并列显示最后已知权威值与本次尝试值', () => {
  const error = projectError(ProjectErrorCode.Conflict, '远端已被改动', { attemptedValue: 'Done' })
  assert.deepEqual([Object.hasOwn(error, 'confirmedValue'), error.confirmedValue, error.attemptedValue], [true, undefined, 'Done'])
})
