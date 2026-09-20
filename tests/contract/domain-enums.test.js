/**
 * 领域词汇契约测试：枚举取值、错误码与关系规则。保护的不变量：1) 枚举取值是跨层契约，成员名、取值与顺序全部钉死；2) provider 层 8 个错误码、调用方层 11 个、恢复动作 7 个，且每个 provider 码都有映射；3) 每个关系类型恰好属于一个类别，lineage 不与 system_fact 混同；4) 确定性发现只能进入候选态，依赖环检测只在 blocks / depends_on 上生效。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AccessLevel,
  ContentKind,
  DerivedFlag,
  EngineeringFactKind,
  EntityKind,
  ExecutionContextStatus,
  ExecutionRunStatus,
  ExternalIdentityKind,
  IdentityRole,
  NormalizedStatus,
  ProjectErrorCode,
  ProviderErrorCode,
  RECOVERY_BY_CODE,
  RELATION_CLASS_SEMANTICS,
  RELATION_TYPE_CLASS,
  Recovery,
  RedactionReason,
  RelationClass,
  RelationSource,
  RelationState,
  RelationType,
  StatusChangeSource,
  StatusPolicy,
  WriteState,
  detectDependencyCycle,
  initialRelationState,
  isAuthoritativeWriteState,
  isDependencyRelation,
  makeRelation,
  newEntityId,
  providerErrorToProjectError,
  relationClassOf,
} from '@harness-projects/domain'

const golden = (value) => JSON.stringify(value)
test('枚举：全部取值表被钉死（成员名 + 取值 + 顺序），改名即失败', () => {
  assert.equal(golden(EntityKind), '{"WorkItem":"work_item","ChangeRequest":"change_request","Repository":"repository","Branch":"branch","Worktree":"worktree","Commit":"commit","ExecutionContext":"execution_context","ExecutionRun":"execution_run","PipelineRun":"pipeline_run","CheckRun":"check_run"}')
  assert.equal(golden(ContentKind), '{"WorkItem":"work_item","ChangeRequest":"change_request","Redacted":"redacted"}')
  assert.equal(golden(NormalizedStatus), '{"Todo":"todo","InProgress":"in_progress","Blocked":"blocked","Done":"done","Canceled":"canceled","Unknown":"unknown"}')
  assert.equal(golden(RelationClass), '{"BusinessSemantics":"business_semantics","SystemFact":"system_fact","Lineage":"lineage"}')
  assert.equal(golden(RelationType), '{"Blocks":"blocks","DependsOn":"depends_on","RelatesTo":"relates_to","Duplicates":"duplicates","Implements":"implements","Tracks":"tracks","ProducedBy":"produced_by","HasWorktree":"has_worktree","RunsOn":"runs_on","DerivedFrom":"derived_from","SupersededBy":"superseded_by"}')
  assert.equal(golden(RelationSource), '{"Explicit":"explicit","Deterministic":"deterministic","Lineage":"lineage"}')
  assert.equal(golden(RelationState), '{"Candidate":"candidate","Confirmed":"confirmed"}')
  assert.equal(golden(ExecutionContextStatus), '{"Planned":"planned","Provisioning":"provisioning","Ready":"ready","Closed":"closed","Failed":"failed"}')
  assert.equal(golden(ExecutionRunStatus), '{"Queued":"queued","Starting":"starting","Running":"running","Succeeded":"succeeded","Failed":"failed","Canceled":"canceled","TimedOut":"timed_out","Unknown":"unknown"}')
  assert.equal(golden(AccessLevel), '{"Available":"available","ReadOnly":"read_only","Unavailable":"unavailable","Degraded":"degraded"}')
  assert.equal(golden(WriteState), '{"Pending":"pending","Saved":"saved","Unknown":"unknown","Conflict":"conflict","Failed":"failed"}')
  assert.equal(golden(IdentityRole), '{"Primary":"primary","Alias":"alias","Historical":"historical"}')
  assert.equal(golden(ExternalIdentityKind), '{"Draft":"draft","Issue":"issue","ChangeRequest":"change_request","Branch":"branch","Worktree":"worktree"}')
  assert.equal(golden(RedactionReason), '{"PermissionDenied":"permission_denied","Deleted":"deleted","Unavailable":"unavailable","PolicyRestricted":"policy_restricted"}')
  assert.equal(golden(StatusPolicy), '{"ProviderAuthoritative":"provider_authoritative","HostAuthoritative":"host_authoritative","ManualOnly":"manual_only"}')
  assert.equal(golden(StatusChangeSource), '{"PlanningProvider":"planning_provider","HostUser":"host_user","EngineeringFact":"engineering_fact"}')
  assert.equal(golden(EngineeringFactKind), '{"CiPassed":"ci_passed","CiFailed":"ci_failed","ExecutionCompleted":"execution_completed","ExecutionFailed":"execution_failed","ChangeRequestMerged":"change_request_merged"}')
  assert.equal(golden(DerivedFlag), '{"Attention":"attention","CiFailing":"ci_failing","ExecutionFailed":"execution_failed","Merged":"merged"}')
})
test('写入：只有拿到 ack/reconcile 的 saved 才是权威已保存', () => {
  assert.equal(isAuthoritativeWriteState(WriteState.Saved), true)
  for (const state of [WriteState.Pending, WriteState.Unknown, WriteState.Conflict, WriteState.Failed]) {
    assert.equal(isAuthoritativeWriteState(state), false, `${state} 不得显示为权威已保存`)
  }
})
test('错误码：provider 层 8 个、调用方层 11 个、恢复动作 7 个，且映射齐全', () => {
  assert.equal(Object.keys(ProviderErrorCode).length, 8)
  assert.equal(Object.keys(ProjectErrorCode).length, 11)
  assert.deepEqual(Object.values(Recovery).sort(), [
    'fix_permission', 'manual_execution', 'none', 'open_provider', 'reapply', 'refresh', 'retry',
  ])
  for (const code of Object.values(ProviderErrorCode)) {
    const mapped = providerErrorToProjectError(code)
    assert.ok(Object.values(ProjectErrorCode).includes(mapped), `${code} 必须映射到调用方码`)
    assert.ok(Object.values(Recovery).includes(RECOVERY_BY_CODE[mapped]), `${mapped} 缺少恢复动作`)
  }
})
test('关系：每个类型恰好属于一个类别，且三个类别都有冻结语义', () => {
  const types = Object.values(RelationType)
  assert.equal(Object.keys(RELATION_TYPE_CLASS).length, types.length)
  for (const type of types) {
    const relationClass = relationClassOf(type)
    assert.ok(Object.values(RelationClass).includes(relationClass), `${type} 的类别越界`)
    assert.ok(RELATION_CLASS_SEMANTICS[relationClass].length > 0, `${relationClass} 缺少语义说明`)
  }
  assert.equal(relationClassOf(RelationType.DependsOn), RelationClass.BusinessSemantics)
  assert.equal(relationClassOf(RelationType.HasWorktree), RelationClass.SystemFact)
  assert.equal(relationClassOf(RelationType.DerivedFrom), RelationClass.Lineage)
})
test('关系：确定性发现只能进入候选态，谱系传播必须显式继承父边状态', () => {
  const Candidate = RelationState.Candidate
  assert.equal(initialRelationState(RelationSource.Explicit, undefined), RelationState.Confirmed)
  assert.equal(initialRelationState(RelationSource.Deterministic, undefined), Candidate)
  assert.equal(
    initialRelationState(RelationSource.Deterministic, RelationState.Confirmed),
    Candidate,
    '确定性发现不得借继承升级为已确认',
  )
  const discovered = makeRelation({
    from: newEntityId(),
    to: newEntityId(),
    type: RelationType.Tracks,
    source: RelationSource.Deterministic,
    inheritedState: undefined,
  })
  assert.equal(discovered.state, Candidate)
  assert.equal(discovered.class, RelationClass.SystemFact)

  assert.equal(initialRelationState(RelationSource.Lineage, RelationState.Confirmed), RelationState.Confirmed)
  assert.equal(initialRelationState(RelationSource.Lineage, undefined), Candidate)
})
test('关系：依赖环检测只在 blocks / depends_on 上生效', () => {
  assert.equal(isDependencyRelation(RelationType.Blocks), true)
  assert.equal(isDependencyRelation(RelationType.DependsOn), true)
  assert.equal(isDependencyRelation(RelationType.Tracks), false)

  const [first, second, third] = [newEntityId(), newEntityId(), newEntityId()]
  const edge = (from, to, type) =>
    makeRelation({ from, to, type, source: RelationSource.Explicit, inheritedState: undefined })
  assert.deepEqual(
    detectDependencyCycle([
      edge(first, second, RelationType.DependsOn),
      edge(second, third, RelationType.DependsOn),
      edge(third, first, RelationType.Blocks),
    ]),
    [first, second, third],
  )
  assert.equal(
    detectDependencyCycle([edge(first, second, RelationType.DependsOn), edge(second, third, RelationType.Blocks)]),
    undefined,
  )
  assert.equal(
    detectDependencyCycle([edge(first, second, RelationType.Tracks), edge(second, first, RelationType.RunsOn)]),
    undefined,
    '系统事实边成环不是依赖环',
  )
})
