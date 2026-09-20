/**
 * 离线 Delivery provider：只读交付面——按提交查流水线、按变更请求查检查、可选的部署与环境。
 *
 * 写操作（重跑 / 取消）**一律**返回 not_supported 且不触碰任何状态：静默成功比失败更危险（调用方会
 * 以为远端已改变）。可选读能力缺失时报 unavailable 而不是平台错误；环境读与 deployment.read 共用能力面。
 */
import * as cap from '@harness-projects/capabilities'
import { EntityKind, newProviderBindingId, type ProviderBindingId } from '@harness-projects/domain'
import { createFaultSwitch, type FaultPlan, type FaultSwitch } from './faults.ts'
import { FakeGate } from './gate.ts'
import { byExternalId, itemKey, paginate, refOf } from './state.ts'

export type FakeDeliveryCapabilities = { deployments: boolean }
const ALL_CAPABILITIES: FakeDeliveryCapabilities = { deployments: true }

function declaredCapabilities(flags: FakeDeliveryCapabilities): Partial<Record<cap.CapabilityKey, cap.AccessLevel>> {
  const map: Partial<Record<cap.CapabilityKey, cap.AccessLevel>> = {
    [cap.CapabilityKey.DeliveryPipelineRead]: cap.AccessLevel.Available,
    [cap.CapabilityKey.DeliveryCheckRead]: cap.AccessLevel.Available,
  }
  if (flags.deployments) map[cap.CapabilityKey.DeliveryDeploymentRead] = cap.AccessLevel.Available
  // 写能力（rerun / cancel）故意不声明：本替身是只读交付面，调用方从快照就看到 unavailable。
  return map
}

export type FakePipelineRunRecord = { ref: cap.ExternalObjectRef; repository: cap.ExternalObjectRef; status: string; commit: string; conclusion: string | undefined }
export type FakeCheckRunRecord = { ref: cap.ExternalObjectRef; changeRequest: cap.ExternalObjectRef; name: string; status: string; conclusion: string | undefined }
export type FakeDeploymentRecord = { ref: cap.ExternalObjectRef; repository: cap.ExternalObjectRef; environment: string; status: string }
export type FakeEnvironmentRecord = { ref: cap.ExternalObjectRef; repository: cap.ExternalObjectRef; name: string; protected: boolean }
export type FakeDeliveryState = {
  runs: FakePipelineRunRecord[]; checks: FakeCheckRunRecord[]; deployments: FakeDeploymentRecord[]; environments: FakeEnvironmentRecord[]
}

/** 默认种子：同一提交上的成功与进行中运行、另一提交上的失败运行，以及检查、部署与环境各一组。 */
function seedDeliveryState(bindingId: ProviderBindingId): FakeDeliveryState {
  const repository = refOf(bindingId, EntityKind.Repository, 'repo-alpha')
  const changeRequest = refOf(bindingId, EntityKind.ChangeRequest, 'pr-1')
  const run = (id: string, commit: string, status: string, conclusion: string | undefined): FakePipelineRunRecord => ({ ref: refOf(bindingId, EntityKind.PipelineRun, id), repository, status, commit, conclusion })
  const check = (id: string, name: string, status: string, conclusion: string | undefined): FakeCheckRunRecord => ({ ref: refOf(bindingId, EntityKind.CheckRun, id), changeRequest, name, status, conclusion })
  const deployment = (id: string, environment: string, status: string): FakeDeploymentRecord => ({ ref: refOf(bindingId, 'deployment', id), repository, environment, status })
  const environment = (name: string, protectedFlag: boolean): FakeEnvironmentRecord => ({ ref: refOf(bindingId, 'environment', name), repository, name, protected: protectedFlag })

  return {
    runs: [run('run-1', 'sha-1', 'completed', 'success'), run('run-2', 'sha-1', 'in_progress', undefined), run('run-3', 'sha-2', 'completed', 'failure')],
    checks: [check('check-build', 'build', 'completed', 'success'), check('check-lint', 'lint', 'queued', undefined), check('check-test', 'test', 'in_progress', undefined)],
    deployments: [deployment('deploy-1', 'staging', 'succeeded'), deployment('deploy-2', 'production', 'pending')],
    environments: [environment('staging', false), environment('production', true)],
  }
}

export type FakeDeliveryProviderOptions = {
  bindingId?: ProviderBindingId; faults?: Partial<FaultPlan>; capabilities?: Partial<FakeDeliveryCapabilities>; observedAt?: string
}

export class FakeDeliveryProvider implements cap.DeliveryProvider {
  readonly state: FakeDeliveryState
  readonly faultsSwitch: FaultSwitch
  readonly flags: FakeDeliveryCapabilities
  readonly gate: FakeGate

  constructor(options: FakeDeliveryProviderOptions = {}) {
    const bindingId = options.bindingId ?? newProviderBindingId()
    this.state = seedDeliveryState(bindingId)
    this.faultsSwitch = createFaultSwitch(options.faults ?? {})
    this.flags = { ...ALL_CAPABILITIES, ...(options.capabilities ?? {}) }
    this.gate = new FakeGate(this.faultsSwitch, bindingId, options.observedAt ?? '2026-09-20T00:00:00Z')
  }

  describeCapabilities(): Promise<cap.ProviderCapabilitySnapshot> {
    return Promise.resolve(this.gate.snapshot(declaredCapabilities(this.flags)))
  }

  async listPipelineRuns(input: cap.ProviderListPipelineRunsInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderPipelineRun>>> {
    const blocked = this.gate.blocked<cap.ProviderPage<cap.ProviderPipelineRun>>()
    if (blocked !== undefined) return blocked
    const rows = this.state.runs.filter((r) => itemKey(r.repository) === itemKey(input.repository))
      .filter((r) => input.commit === undefined || r.commit === input.commit).sort(byExternalId)
    return cap.providerOk(paginate(rows.map(toRun), input))
  }

  async listChecks(input: cap.ProviderListChecksInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderCheckRun>>> {
    const blocked = this.gate.blocked<cap.ProviderPage<cap.ProviderCheckRun>>()
    if (blocked !== undefined) return blocked
    const rows = this.state.checks.filter((c) => itemKey(c.changeRequest) === itemKey(input.changeRequest)).sort(byExternalId)
    return cap.providerOk(paginate(rows.map(toCheck), input))
  }

  async listDeployments(input: cap.ProviderListDeploymentsInput): Promise<cap.ProviderResult<cap.ProviderPage<cap.ProviderDeployment>>> {
    const blocked = this.gate.blocked<cap.ProviderPage<cap.ProviderDeployment>>()
    if (blocked !== undefined) return blocked
    if (!this.flags.deployments) return this.gate.unsupported(cap.CapabilityKey.DeliveryDeploymentRead)
    const rows = this.state.deployments.filter((d) => itemKey(d.repository) === itemKey(input.repository)).sort(byExternalId)
    return cap.providerOk(paginate(rows.map(toDeployment), input))
  }

  async listEnvironments(repository: cap.ExternalObjectRef): Promise<cap.ProviderResult<readonly cap.ProviderEnvironment[]>> {
    const blocked = this.gate.blocked<readonly cap.ProviderEnvironment[]>()
    if (blocked !== undefined) return blocked
    if (!this.flags.deployments) return this.gate.unsupported(cap.CapabilityKey.DeliveryDeploymentRead)
    const rows = this.state.environments.filter((e) => itemKey(e.repository) === itemKey(repository)).sort(byExternalId)
    return cap.providerOk(rows.map(toEnvironment))
  }

  /** 只读交付面的写尝试：**无条件** not_supported——离线与否都不改变这个结论，也不改动任何状态。 */
  rerunPipeline(_ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<cap.ProviderPipelineRun>> {
    return Promise.resolve(this.gate.unsupported<cap.ProviderPipelineRun>(cap.CapabilityKey.DeliveryPipelineRerun))
  }

  cancelPipeline(_ref: cap.ExternalObjectRef): Promise<cap.ProviderResult<void>> {
    return Promise.resolve(this.gate.unsupported<void>(cap.CapabilityKey.DeliveryPipelineRerun))
  }
}

function toRun(record: FakePipelineRunRecord): cap.ProviderPipelineRun {
  return { ref: record.ref, status: record.status, commit: record.commit, conclusion: record.conclusion }
}
function toCheck(record: FakeCheckRunRecord): cap.ProviderCheckRun {
  return { ref: record.ref, name: record.name, status: record.status, conclusion: record.conclusion }
}
function toDeployment(record: FakeDeploymentRecord): cap.ProviderDeployment {
  return { ref: record.ref, environment: record.environment, status: record.status }
}
function toEnvironment(record: FakeEnvironmentRecord): cap.ProviderEnvironment {
  return { ref: record.ref, name: record.name, protected: record.protected }
}

export function createFakeDeliveryProvider(options: FakeDeliveryProviderOptions = {}): FakeDeliveryProvider {
  return new FakeDeliveryProvider(options)
}
