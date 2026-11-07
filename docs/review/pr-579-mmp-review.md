# PR #579 MMP 交付评审

## 锁定事实

- 日期：2026-11-07；审查及末次远端回读 head `ba6fb8ef9e7e8844070ec56cb4a6b547fcbcb2f2`，base `c1975c20aeffa960a980f01dd321e38261008f59`（`main`）。
- 目标：UI 消费投影、能力诊断、依赖边和真实交付路径。
- 评审范围：代码、产品闭环、架构、测试与反例、issue 验收、设计适度性和重复追踪。
- 两个提交为计划和最终实现；`MERGEABLE`、ready、尚无 review decision；关联 `Closes #574` 正确。初始 reviews/comments 均为空。
- 方法：Superpowers 独立代码评审、Qian 子系统职责/接口核对、First Principles 从最终页面与 selected-repository 授权反推所需投影。

## 预置风险矩阵（先于逐文件审查）

| 级别 | 风险假设 | 判别证据 | 当前结论 |
|---|---|---|---|
| P0 | 删除破坏 main、发布门禁或系统硬约束 | typecheck 与边界 9/9；无 CI、Host、Provider、Storage 或状态权威变更 | 无可行动项 |
| P1 | 退役误删仍在使用的行为、安全/恢复路径或 CI 覆盖 | 最终页面消费链、逐仓库四门、遮蔽/撕裂读/权限与恢复反例；139/139 | 无可行动项 |
| P2 | 验收遗漏、证据失真或边界说明不完整 | #574 acceptance、churn 361、真实删除清单与现 head checks 对照 | 无可行动项 |
| P3 | 文档、命名或维护成本问题 | private API 有意退役、无新增抽象，已说明 revert 与调用图 | 无可行动项 |

## 分层证据与反例

1. 代码：完整审读三个生产文件及四个测试文件的 diff。`deriveWorkItemList/Detail` 只删除工作区级 actions 计算，保留来源身份、visibleContent 遮蔽、规划字段与 freshness；`capability-access.ts` 将仅剩的开始工作用途内联，四个 key、读门 `read_only` 归一、求交优先级、available 判定、reason 顺序和结果字段均沿用原机制。
2. 产品：`packages/ui/src/work-item-app.ts` 仍消费 `deriveWorkItemListView/deriveWorkItemDetailView`；详情的 scope-before-store、列表读门、安全行、二次 redacted 检查仍在。仅 `work_item` 提供 `ExecutionTarget`，PR/redacted 不获得写入口；开始工作仍从选定仓库 capabilities 构建索引，不能借工作区或其他仓库权限。实际谱系条仍消费 `deriveDeliveryLineageStrip`，不依赖退役的导航入口。
3. 架构：删除测试专属 ProjectsHome、LineageTarget/EntryPoint 与 actions 字段，没有第二事实源或反向依赖；Host 权威、规划/工程正交、Provider ack、凭据句柄均不受影响。`rg -n 'deriveProjectsHome|lineageEntryPoints|LineageTarget|actionsFor' packages apps` 无命中（exit 1），typecheck 进一步覆盖类型/调用者。包为 private，退役导出为已披露的有意范围。
4. 测试与反例：移除四个仅验证旧投影输出的用例，其余能力断言直达真实 `startWorkAvailability`。仍覆盖缺 key fail closed、四态求交差分、read_only 读门放行/写门阻断、reason 逐 key，以及真实 detail 的跨 workspace 零 store 读取、显式拒绝不借缓存、redacted 全字段剥离、撕裂读再次遮蔽、partial 中选中行独立新鲜度、断网保留最后值和恢复。实跑 139/139，未将旧投影迁到 fixture。
5. 工作项/设计：#574 的无消费者、最终安全视图、开始工作契约、净删除与隔离要求成立；生产净删 115 行、完整代码/测试 churn 361，未触碰 delivery overview/assignee 实现。对现存少数消费点做删除和专用 helper 收敛，设计适度。
6. 重复追踪：标题搜索 projection/presentation 得 #574、#202（切换规划来源清理投影，独立 Core 缺陷）及已关闭 #448，未发现另一直接退役项。review-session 失败已有 open #364 承担。

## 验证与结论

执行上下文：`.worktrees/read-model-retirement-20261107`，上述 immutable head。独立复跑：

```text
pnpm test:file tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-start-work.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/workspace-read-assembly.test.js tests/e2e/repository-routing.test.js
tests 139; pass 139; fail/cancelled/skipped 0; exit 0
pnpm typecheck                            # exit 0
pnpm boundaries                           # 9/9, exit 0
git diff --check c1975c20...HEAD            # exit 0
```

现 head hosted `PR Fast Gate`、Verify、Browser、Merge Gate 与披露/规模成功。`Create review session` run `42352779045` 日志明确为回调端点返回 404（exit 1），属于 #364；被取消 Rule checks `42352460682` 有同 head 后继 `42352461150` 成功。没有把可选服务失败当作代码缺陷，也不称全部检查全绿。

未发现可行动 P0/P1/P2/P3；建议整合者在必要重新锁定后 APPROVE。未重复实现者记录的260组合差分；上述结论来自完整逻辑对照及独立现有测试。未提交 GitHub review、未提交或推送。本地/hosted 工程证据不代表安装产品、人类或 R1 接受；与 #578 重叠的两个测试文件在合并后的组合仍需由整合者验证。

## 最终树变异表

在上述 head 最终源码上执行一次整表：`node scripts/review-mutate.mjs .superpowers/mmp-review-final-mutation-20261107/spec.json`。仅使用既有 `tests/contract/ui-model-presentation.test.js`；基线和还原后基线由夹具检查为绿，夹具退出 0。

| ID | 位置/变异 | killedBy 与实际失败归因 | 结果 |
|---|---|---|---|
| M579-write-readonly | `packages/ui-model/src/capability-access.ts` 的 `startWorkAvailability`：将 available 条件改为仅排除 `Unavailable`，错误地允许写门 `ReadOnly` | `不变量：四态映射——read_only / unavailable 阻断，degraded 可用但带降级标记`；实际该用例及四态求交差分、读门预检共3项失败，mutated run exit 1 | KILLED（1/1） |

夹具按原字节恢复并自检；独立复核源码 SHA-256 前后同为 `548a437f468554dcb986587a8be895b3e9ad274850d43763b2f3918032ee5c46`。执行前 tracked 状态为空；执行后 tracked 差异仅为整合者同步补充的 completed ExecPlan 文档，整合者已确认其拥有权；相对 branch HEAD 没有生产/测试差异。运行日志与独立恢复回执位于同一运行目录的 `result.log`、`restore.json`；没有存活变异或新增测试/源码修改。
