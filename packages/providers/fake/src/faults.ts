/** 故障注入计划：离线替身的一等公民（ExecPlan D3）。`tests/README.md` §3 要求离线、权限被撤销、创建结果不确定、执行失败、重复事件、乱序事件都能被显式构造；默认全关，调用方按键打开，provider 把它们翻译成结构化 `ProviderResult` 失败。 */
export const FaultKind = {
  Offline: 'offline',
  PermissionDenied: 'permission_denied',
  AmbiguousCreate: 'ambiguous_create',
  HarnessFailure: 'harness_failure',
  DuplicateEvent: 'duplicate_event',
  OutOfOrder: 'out_of_order',
} as const
export type FaultKind = (typeof FaultKind)[keyof typeof FaultKind]
/** 与 FaultKind 一一对应的可读计划；默认全关。 */
export interface FaultPlan {
  readonly offline: boolean
  readonly permissionDenied: boolean
  readonly ambiguousCreate: boolean
  readonly harnessFailure: boolean
  readonly duplicateEvent: boolean
  readonly outOfOrder: boolean
}

export const NO_FAULTS: FaultPlan = {
  offline: false, permissionDenied: false, ambiguousCreate: false,
  harnessFailure: false, duplicateEvent: false, outOfOrder: false,
}

const PLAN_KEY: Readonly<Record<FaultKind, keyof FaultPlan>> = {
  [FaultKind.Offline]: 'offline', [FaultKind.PermissionDenied]: 'permissionDenied',
  [FaultKind.AmbiguousCreate]: 'ambiguousCreate', [FaultKind.HarnessFailure]: 'harnessFailure',
  [FaultKind.DuplicateEvent]: 'duplicateEvent', [FaultKind.OutOfOrder]: 'outOfOrder',
}

/** 对外只暴露只读快照，provider 每次请求读一次，避免同一请求中途故障状态漂移。 */
export type FaultSwitch = {
  plan(): FaultPlan; isOn(kind: FaultKind): boolean; set(kind: FaultKind, enabled: boolean): void; reset(): void
}

export function createFaultSwitch(initial: Partial<FaultPlan> = {}): FaultSwitch {
  let plan: FaultPlan = { ...NO_FAULTS, ...initial }
  return {
    plan: () => plan,
    isOn: (kind) => plan[PLAN_KEY[kind]],
    set: (kind, enabled) => {
      plan = { ...plan, [PLAN_KEY[kind]]: enabled }
    },
    reset: () => {
      plan = { ...NO_FAULTS }
    },
  }
}
