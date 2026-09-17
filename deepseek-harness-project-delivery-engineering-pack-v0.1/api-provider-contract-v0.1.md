# DeepSeek Harness 项目交付工作台：API & Provider Contract v0.1

> 日期：2026-09-17  
> 目标：冻结 `project-core` 与 Provider / Client 之间的稳定契约，避免 UI 或外部平台细节侵入领域层。

## 1. API 原则

本产品不从“GitHub API 长什么样”反推自己的接口。

核心 API 从用户与领域动作出发：

- Query：读取当前投影；
- Command：请求改变 Local 或 External state；
- Subscription：接收 Snapshot / Delta / Sync state；
- Provider Contract：由适配器把外部平台翻译成稳定能力。

任何具体 GitHub / Jira payload 都只能出现在 Provider implementation 内部或 `raw_json` 调试字段中。

## 2. ID 约定

所有 Project API 向客户端暴露内部稳定 ID：

```ts
type WorkspaceId = string
type ProjectId = string
type EntityId = string
type PlanningItemId = EntityId
type WorkItemId = EntityId
type ChangeRequestId = EntityId
type ExecutionContextId = EntityId
```

外部 ID 通过专门的 ref 展示：

```ts
interface ExternalRef {
  providerFamily: string
  objectKind: string
  externalId: string
  url?: string
}
```

客户端不得把 GitHub Node ID 当成本地主键。

## 3. ProjectItemProjection

项目列表、Board、Backlog 和 Roadmap 的基础行对象不是裸 WorkItem，而是 Project-specific PlanningItem projection。

```ts
type ProjectContentRef =
  | { kind: 'work_item'; id: WorkItemId }
  | { kind: 'change_request'; id: ChangeRequestId }
  | { kind: 'redacted' }

interface ProjectItemProjection {
  planningItemId: PlanningItemId
  projectId: ProjectId

  planning: {
    nativeStatusKey?: string
    nativeStatusName?: string
    normalizedStatus?: 'unstarted' | 'started' | 'completed' | 'canceled'
    priority?: string
    assignees: ActorRef[]
    iteration?: IterationRef
    milestone?: MilestoneRef
    rank?: string
    startDate?: string
    targetDate?: string
    customFields: Record<string, unknown>
  }

  content: ProjectContentRef
  workItem?: WorkItemSummary
  changeRequest?: ChangeRequestSummary

  engineering?: EngineeringSummary
  attention?: AttentionSummary

  source: SourceMetadata
}
```

这解决三类情况：

- Issue-backed Project item；
- Draft-backed Project item；
- PR-backed Project item。

只有 `content.kind = work_item` 才能执行 Start Work。

## 4. SourceMetadata

所有重要投影应能解释 freshness 与 authority：

```ts
interface SourceMetadata {
  authoritative: boolean
  derived: boolean
  bindingId?: string
  providerFamily?: string
  observedAt?: string
  sourceUpdatedAt?: string
  stale: boolean
}
```

## 5. Query API

逻辑接口如下。实际在 DeepSeek Harness 中可以实现为 generated typed remote methods；Standalone Web 通过 transport adapter 复用同一 wire types。

```ts
interface ProjectQueries {
  listWorkspaces(): Promise<WorkspaceSummary[]>

  getWorkspaceSnapshot(input: {
    workspaceId: WorkspaceId
  }): Promise<WorkspaceSnapshot>

  listProjectItems(input: {
    workspaceId: WorkspaceId
    filter?: ProjectItemFilter
    page?: PageRequest
  }): Promise<Page<ProjectItemProjection>>

  getProjectItem(input: {
    workspaceId: WorkspaceId
    planningItemId: PlanningItemId
  }): Promise<ProjectItemDetail>

  getWorkItem(input: {
    workspaceId: WorkspaceId
    workItemId: WorkItemId
  }): Promise<WorkItemDetail>

  getDeliveryProjection(input: {
    workspaceId: WorkspaceId
    filter?: DeliveryFilter
  }): Promise<DeliveryProjection>

  getCapabilities(input: {
    workspaceId: WorkspaceId
  }): Promise<EffectiveCapabilitySnapshot>

  getSyncStatus(input: {
    workspaceId: WorkspaceId
  }): Promise<WorkspaceSyncStatus>

  listActivity(input: {
    workspaceId: WorkspaceId
    filter?: ActivityFilter
    page?: PageRequest
  }): Promise<Page<ActivityEntry>>
}
```

## 6. Command API

Command 必须带 Actor 与 idempotency key。

```ts
interface CommandContext {
  actorRef: string
  idempotencyKey: string
}
```

### 6.1 Workspace

```ts
createWorkspace(input, ctx): Promise<CommandResult<WorkspaceSnapshot>>
updateWorkspaceMethod(input, ctx): Promise<CommandResult<WorkspaceSnapshot>>
updateStatusPolicy(input, ctx): Promise<CommandResult<WorkspaceSnapshot>>
```

### 6.2 Planning

```ts
createIssueBackedWorkItem(input, ctx)
createDraftPlanningItem(input, ctx)
updateWorkItemContent(input, ctx)
updatePlanningFields(input, ctx)
movePlanningItem(input, ctx)
```

`updatePlanningFields` 输入必须支持预期版本：

```ts
interface UpdatePlanningFieldsInput {
  workspaceId: WorkspaceId
  planningItemId: PlanningItemId
  patch: {
    statusKey?: string
    priority?: string
    assigneeRefs?: string[]
    iterationId?: string | null
    milestoneId?: string | null
    startDate?: string | null
    targetDate?: string | null
  }
  expectedSourceVersion?: string
}
```

### 6.3 Start Work

```ts
interface StartWorkInput {
  workspaceId: WorkspaceId
  workItemId: WorkItemId
  repositoryId: EntityId
  baseBranch: string
  branchName?: string
  createWorktree: boolean
  executionMode: 'harness' | 'human'
}
```

结果：

```ts
CommandResult<ExecutionContextDetail>
```

如果 Harness 启动失败但 Git/worktree 已成功，Command 可以返回成功的 `ExecutionContext`，其 state 为 `manual_fallback`，并附带 warning。不能为了 Harness failure 回滚已经安全创建的开发上下文。

### 6.4 Engineering

```ts
completeImplementation(input, ctx)
createChangeRequest(input, ctx)
createSemanticRelation(input, ctx)
createPlanningRelation(input, ctx)
confirmCandidateRelation(input, ctx)
ignoreCandidateRelation(input, ctx)
```

### 6.5 Explicit refresh

```ts
refreshWorkspace(input, ctx): Promise<CommandResult<WorkspaceSyncStatus>>
```

Refresh 只拉取 Provider facts，不自动改变 status policy。

## 7. CommandResult

```ts
type CommandResult<T> =
  | {
      ok: true
      value: T
      writeState: 'confirmed' | 'reconciled' | 'local_only'
      warnings?: ProjectWarning[]
      mutationId: string
    }
  | {
      ok: false
      error: ProjectError
      mutationId?: string
    }
```

`ok: true` 不代表所有外部系统都一致，只代表本次 command 按 contract 成功。若 Provider write 只 ack 未完成 read-after-write，可返回 `writeState = confirmed`；后台 reconciliation 完成后通过 subscription 更新为最新 snapshot。

## 8. Error Contract

```ts
type ProjectErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'NOT_SUPPORTED'
  | 'PERMISSION_DENIED'
  | 'CONFLICT'
  | 'STALE_WRITE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'AMBIGUOUS_EXTERNAL_RESULT'
  | 'LOCAL_GIT_FAILURE'
  | 'EXECUTION_FAILURE'

interface ProjectError {
  code: ProjectErrorCode
  message: string
  retryable: boolean

  domain?: 'planning' | 'development' | 'delivery' | 'execution' | 'storage'
  providerFamily?: string
  bindingId?: string
  externalRequestId?: string

  currentValue?: unknown
  attemptedValue?: unknown

  recovery:
    | 'retry'
    | 'refresh'
    | 'reapply'
    | 'open_provider'
    | 'fix_permission'
    | 'manual_execution'
    | 'none'
}
```

Provider 原始错误可作为 server-side cause logging，不直接成为稳定 wire contract。

## 9. Capability Contract

Capability 描述实现理论能力，Permission 描述当前凭据权限，Policy 描述 Workspace 是否允许。

```ts
type AccessLevel = 'available' | 'read_only' | 'unavailable' | 'degraded'

interface EffectiveCapability {
  key: string
  access: AccessLevel
  reason?: string
  providerBindingId?: string
  externalActionUrl?: string
}
```

UI 只依赖 capability key，例如：

```text
planning.item.read
planning.item.create.issue
planning.item.create.draft
planning.item.content.write
planning.field.status.write
planning.field.iteration.read
planning.field.iteration.write
planning.field.rank.write
planning.field.start_date.write
planning.field.target_date.write
planning.relation.parent.write
planning.relation.block.write

development.repository.read
development.branch.create
development.worktree.create
development.change_request.read
development.change_request.create
development.review.read

delivery.pipeline.read
delivery.check.read
delivery.deployment.read
delivery.pipeline.rerun

execution.run.start
execution.run.cancel
execution.run.read
```

前端禁止：

```ts
if (provider === 'github') { ... }
```

应写成：

```ts
if (caps['planning.field.iteration.write'].access === 'available') { ... }
```

## 10. Provider Result

Provider interface 不抛裸平台错误作为业务控制流。

```ts
type ProviderResult<T> =
  | { ok: true; value: T; requestId?: string }
  | { ok: false; error: ProviderError }

type ProviderErrorCode =
  | 'not_supported'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_input'
  | 'ambiguous_result'

interface ProviderError {
  code: ProviderErrorCode
  message: string
  retryable: boolean
  requestId?: string
  retryAfterMs?: number
  rawClass?: string
}
```

## 11. PlanningProvider

```ts
interface PlanningProvider {
  describeCapabilities(): Promise<PlanningCapabilitySnapshot>

  getProject(ref: ExternalProjectRef): Promise<ProviderResult<ProviderProject>>

  listPlanningItems(input: {
    project: ExternalProjectRef
    cursor?: string
    limit: number
  }): Promise<ProviderResult<ProviderPage<ProviderPlanningItem>>>

  getPlanningItem(ref: ExternalPlanningItemRef):
    Promise<ProviderResult<ProviderPlanningItem>>

  listFieldDefinitions(project: ExternalProjectRef):
    Promise<ProviderResult<ProviderPlanningFieldDefinition[]>>

  listIterations(project: ExternalProjectRef):
    Promise<ProviderResult<ProviderIteration[]>>

  createIssueWorkItem?(input: ProviderCreateIssueInput):
    Promise<ProviderResult<ProviderCreatedWorkItem>>

  createDraftItem?(input: ProviderCreateDraftInput):
    Promise<ProviderResult<ProviderCreatedPlanningItem>>

  updateWorkItemContent?(input: ProviderUpdateWorkItemInput):
    Promise<ProviderResult<ProviderWorkItem>>

  updatePlanningFields?(input: ProviderUpdatePlanningFieldsInput):
    Promise<ProviderResult<ProviderPlanningItem>>

  movePlanningItem?(input: ProviderMovePlanningItemInput):
    Promise<ProviderResult<ProviderPlanningItem>>

  reconcile?(scope: ProviderReconcileScope):
    AsyncIterable<ProviderObservation>
}
```

`ProviderPlanningItem.content` 必须是 discriminated union：

```ts
type ProviderPlanningContent =
  | { kind: 'work_item'; object: ProviderWorkItem }
  | { kind: 'change_request'; object: ProviderChangeRequest }
  | { kind: 'redacted' }
```

## 12. DevelopmentProvider

```ts
interface DevelopmentProvider {
  describeCapabilities(): Promise<DevelopmentCapabilitySnapshot>

  getRepository(ref): Promise<ProviderResult<ProviderRepository>>
  listBranches(input): Promise<ProviderResult<ProviderPage<ProviderBranch>>>
  getCommit(ref): Promise<ProviderResult<ProviderCommit>>
  getChangeRequest(ref): Promise<ProviderResult<ProviderChangeRequest>>
  listChangeRequests(input): Promise<ProviderResult<ProviderPage<ProviderChangeRequest>>>

  createBranch?(input): Promise<ProviderResult<ProviderBranch>>
  createWorktree?(input): Promise<ProviderResult<ProviderWorktree>>
  createChangeRequest?(input): Promise<ProviderResult<ProviderChangeRequest>>
  removeWorktree?(input): Promise<ProviderResult<void>>

  reconcile?(scope): AsyncIterable<ProviderObservation>
}
```

本地 Git 与 GitHub 都实现该 contract 的子集。

## 13. DeliveryProvider

```ts
interface DeliveryProvider {
  describeCapabilities(): Promise<DeliveryCapabilitySnapshot>

  listPipelineRuns(input): Promise<ProviderResult<ProviderPage<ProviderPipelineRun>>>
  listChecks(input): Promise<ProviderResult<ProviderPage<ProviderCheckRun>>>
  listDeployments?(input): Promise<ProviderResult<ProviderPage<ProviderDeployment>>>
  listEnvironments?(input): Promise<ProviderResult<ProviderEnvironment[]>>

  rerunPipeline?(input): Promise<ProviderResult<ProviderPipelineRun>>
  cancelPipeline?(input): Promise<ProviderResult<void>>

  reconcile?(scope): AsyncIterable<ProviderObservation>
}
```

MVP `delivery.github-actions` 只声明 read capabilities。

## 14. ExecutionProvider

```ts
interface ExecutionProvider {
  describeCapabilities(): Promise<ExecutionCapabilitySnapshot>

  startRun(input): Promise<ProviderResult<ProviderExecutionRun>>
  getRun(ref): Promise<ProviderResult<ProviderExecutionRun>>
  cancelRun?(ref): Promise<ProviderResult<ProviderExecutionRun>>
}
```

`execution.human` 可以实现为 Local Provider：

- `startRun` 创建 manual execution marker；
- `getRun` 返回 manually controlled state；
- 不需要外部服务。

## 15. ProviderObservation

所有 webhook / poll / reconcile 最终转换成统一 observation：

```ts
interface ProviderObservation {
  bindingId: string
  dedupeKey: string
  type: string

  eventTime?: string
  receivedTime: string

  subject: ExternalRef
  sourceVersion?: string
  payloadHash: string

  payload: unknown
}
```

Observation 只表示“外部发生或当前观察到了什么”，不会直接在 adapter 中做跨域业务编排。

## 16. Subscription / Client Model

Host 侧输出：

```ts
interface ProjectRemoteAPI {
  queries: ProjectQueries
  commands: ProjectCommands

  watchWorkspace(input: {
    workspaceId: WorkspaceId
    afterRevision?: number
  }): AsyncIterable<WorkspaceDelta>
}
```

每个 Workspace Snapshot 拥有单调递增的本地 `revision`。

Client 流程：

```text
pull baseline revision N
subscribe after N
apply N+1...
on gap / reconnect -> repull baseline
```

这避免 unary pull 与 later stream update 之间的竞态。

`WorkspaceDelta` 只传内部 wire object，不传 Provider 原生 payload。

## 17. 幂等性规则

### 17.1 Query

天然幂等。

### 17.2 Local command

以 `workspace_id + idempotency_key` 唯一约束去重。

### 17.3 External update

同一个 idempotency key：

- 已 reconciled：返回原成功结果；
- writing：返回 in-progress；
- failed definite：可由用户新 key 重试；
- unknown：必须先 reconcile，禁止盲目重复 create。

### 17.4 Provider event

以：

```text
(binding_id, dedupe_key)
```

唯一去重。

若 Provider 没有 event ID：

```text
dedupe_key = hash(event type + scoped subject + event time + stable payload fields)
```

hash 生成逻辑属于 Provider implementation，并通过 contract test 固定。

## 18. Conflict 语义

若 Provider 有 revision / updated_at / ETag：

- command 带 `expectedSourceVersion`；
- mismatch → `STALE_WRITE`。

若 Provider 没有可靠 compare-and-swap：

- mutation 前读取 latest；
- 比较用户编辑基线；
- 写入；
- read-after-write；
- 发现远端已被其他 actor 改动时返回 `CONFLICT` 并重新拉取。

不宣称 GitHub Projects mutation 具备数据库级 CAS。

## 19. API Acceptance

冻结本 Contract 前必须能用 Fake Provider 完成以下场景：

1. Issue-backed PlanningItem list。
2. PR-backed PlanningItem 不创建 WorkItem。
3. Draft → Issue 保持 WorkItem internal ID。
4. Status write confirmed。
5. Status write permission denied。
6. Status write unknown → reconcile。
7. Duplicate ProviderObservation 只处理一次。
8. Out-of-order observation 不覆盖新 snapshot。
9. Start Work Git success + Harness failure → manual_fallback。
10. Missing capability → stable `NOT_SUPPORTED` / read-only projection。
