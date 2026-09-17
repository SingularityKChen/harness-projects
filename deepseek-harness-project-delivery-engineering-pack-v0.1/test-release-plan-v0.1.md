# DeepSeek Harness Project Delivery：Test & Release Plan v0.1

> 日期：2026-09-17  
> 目标：测试真实用户链路与系统不变量，而不是只追求 coverage 数字。

## 1. 测试原则

测试优先级从高到低：

1. 身份不变量；
2. 事实所有权；
3. 外部 mutation 安全；
4. sync 幂等与恢复；
5. Start Work 跨域编排；
6. Provider capability contract；
7. Client reconnect / stale；
8. UI 展示一致性。

Coverage 是结果指标，不是设计输入。

## 2. 必测不变量

### I-01 单 Planning Source

一个 Workspace 不能同时存在两个 enabled Planning Binding。

证明：

- SQLite partial unique index；
- Core command validation；
- migration test。

### I-02 Membership 与内容身份分离

同一 Issue 同时属于 Project A / B，并映射为两个 Project Workspace：

```text
ExternalIdentity(issue) = 1
PlanningItem = 2
WorkItem local projection = 1 per Workspace
```

MVP 不构建跨 Workspace global WorkItem aggregate。

### I-03 PR-backed Item

Project 中的 PR：

```text
PlanningItem → ChangeRequest
```

不得创建 WorkItem duplicate。

### I-04 Draft → Issue

转换前后：

```text
internal WorkItem ID 不变
```

### I-05 Planning / Engineering 正交

CI failure、Agent completion、PR merge 不得默认直接覆盖 Planning status。

### I-06 External write authority

Provider write 未 confirmed / reconciled 时，不得把 attempted value 标记为 authoritative saved。

### I-07 Duplicate event

同一 ProviderEvent 处理 N 次，最终实体与 relation 数量与处理一次相同。

### I-08 Out-of-order observation

旧 `source_version / updated_at` 不得覆盖较新 snapshot。

### I-09 Capability enforcement

UI 隐藏按钮与 Core 拒绝 command 必须同时存在。Core 是安全边界。

### I-10 Start Work recovery

Harness failure 后：

- worktree / branch 保留；
- ExecutionContext = manual_fallback；
- 用户可以继续人工执行。

## 3. 测试层级

### 3.1 Domain Unit Tests

覆盖：

- normalized planning status；
- capability intersection；
- relation semantics；
- dependency cycle detection；
- release readiness projection；
- attention derivation；
- write state machine。

要求无 network、无 SQLite。

### 3.2 SQLite Integration Tests

每个测试使用临时 DB。

覆盖：

- migration from empty；
- foreign keys；
- partial unique Planning Binding；
- external identity alias；
- Draft → Issue identity；
- relation FK；
- event dedupe；
- mutation idempotency；
- restart restore；
- rollback on failed transaction。

### 3.3 Provider Contract Tests

每个 Provider 实现共享 contract suite。

Planning suite：

- list pagination；
- typed content union；
- missing capability；
- permission denied；
- stale / unavailable；
- duplicate observation stable key。

Development suite：

- repository identity；
- branch create；
- worktree create/remove；
- CR read/create；
- native lineage。

Delivery suite：

- workflow run by SHA；
- check mapping；
- deployment optional capability；
- read-only mutation returns not_supported。

Execution suite：

- start；
- query；
- cancel optional；
- failure mapping。

### 3.4 Fake Provider End-to-End

CI 默认执行，不需要外部 credential。

跑完整链路：

```text
Workspace
→ Planning Item
→ WorkItem
→ Start Work
→ Fake Branch
→ Fake PR
→ Fake CI
→ Delivery projection
```

故障注入：

- provider offline；
- permission revoked；
- duplicate event；
- out-of-order event；
- ambiguous create；
- Harness start failure。

### 3.5 Local Git Integration

在临时 repo 中验证：

- worktree create；
- branch naming；
- retry；
- existing branch；
- dirty worktree；
- cleanup refusal；
- path escaping；
- repository outside allowed root。

### 3.6 Live GitHub Spike / Opt-in Tests

不放在普通 PR CI 中自动运行。

需要测试 sandbox：

- ProjectV2 content union；
- same Issue multi-project；
- Draft conversion；
- field write；
- PR-backed membership；
- webhook；
- Actions run mapping。

结果必须保存精简 fixture，用于普通 CI contract regression。

### 3.7 Client Model Tests

覆盖：

- baseline revision N + delta N+1；
- unary / stream race；
- reconnect；
- gap detection；
- repull；
- identity-stable objects；
- stale flag；
- provider health change。

### 3.8 UI Component Tests

优先测试行为：

- Capability unavailable 时 action 隐藏 / disabled；
- Stale banner；
- Conflict view；
- Drawer deep link；
- Loading skeleton 不闪成 empty；
- PR-backed PlanningItem 不出现 Start Work；
- Engineering summary 不可编辑成 Planning state。

### 3.9 Browser E2E

MVP 最少覆盖：

1. workspace create；
2. list items；
3. edit planning field；
4. start work；
5. manual fallback；
6. create PR；
7. delivery state；
8. permission degradation；
9. conflict；
10. reconnect。

## 4. 故障矩阵

| 故障 | 预期行为 |
|---|---|
| Planning Provider offline | 保留 Last Known State，标记 Stale，禁止外部写 |
| Development Provider offline | Planning 继续可用，Start Work / PR actions 降级 |
| Delivery Provider offline | Planning/Dev 正常，Delivery 显示 stale/unknown |
| Harness unavailable | Start Work 可降级 Human / manual_fallback |
| SQLite write failure | Command 失败，不继续后续 side effect |
| Git worktree create failure | 不启动 Harness，记录 ExecutionContext failed |
| Provider write 403 | PERMISSION_DENIED，保留 authoritative value |
| Provider write timeout | AMBIGUOUS_EXTERNAL_RESULT，先 reconcile |
| duplicate webhook | no duplicate entity / relation |
| out-of-order webhook | old state ignored |
| client reconnect | repull on revision gap |
| capability removed | UI 实时降级，不 crash |

## 5. CI 分层

### PR Fast Gate

目标：快且确定。

包含：

- typecheck；
- lint；
- domain unit；
- SQLite integration；
- fake provider contract；
- key client tests；
- selected component tests。

### Merge Gate

增加：

- all provider fixture tests；
- Local Git integration；
- browser E2E；
- migration upgrade test；
- package boundary / dependency rule tests。

### Scheduled Regression

增加：

- larger fixture data；
- duplicate / reorder event stress；
- reconnect loops；
- migration compatibility；
- optional GitHub sandbox canary；
- performance trend。

## 6. Release Gate R1

MVP Release Candidate 只有在以下条件全部满足时进入发布：

- Gate E1 identity spike passed；
- migration from empty passes；
- all 10 invariants have automated tests；
- PR Fast Gate stable；
- Merge Gate stable；
- no open P0 / P1 correctness bug；
- no known path where local cache can silently override external authority；
- no known path where LLM participates in control state；
- provider offline scenarios verified；
- Start Work recovery verified；
- manual UAT completes；
- rollback / DB backup procedure documented。

## 7. Manual UAT

UAT 必须从用户视角执行，不允许只看测试报告。

场景：

1. 连接一个真实 GitHub Project；
2. 验证 Issue / Draft / PR-backed items；
3. 新建 Issue-backed item；
4. 改 Status / Iteration；
5. 在 GitHub 原页面核对；
6. Start Work；
7. 在本地核对 worktree / branch；
8. 打开 Harness Session；
9. 创建 PR；
10. 让一个 CI check 失败；
11. 验证 Planning Status 不被覆盖；
12. 修复 CI；
13. Review；
14. Delivery view 完整；
15. 临时撤销 GitHub Projects write permission；
16. 验证 Workspace 退化只读而非崩溃；
17. 关闭 webhook receiver；
18. 验证 reconciliation 最终修正状态；
19. 重启 Host；
20. 验证 identity / relations / contexts 恢复。

## 8. Rollback

MVP 升级采用 additive migration。

若 release 后发现严重问题：

- 停止新的 external write command；
- 保持 read projection；
- 备份 SQLite；
- 回滚应用代码；
- 不自动回滚已成功发生在 GitHub / Git 的外部 side effect；
- 通过 mutation/activity log 辅助人工核对外部结果。

这也是为什么外部 mutation 必须可追踪，而不能被 UI 层直接调用。
