# PR #560 MMP 交付评审

## Purpose / Big Picture

判断启用执行设置后用户能否在原页得到有界、诚实、可恢复的反馈；未知结果读回不重复安装、不启动任务，不把Planning连接当作执行恢复。

## Context and Orientation

2026-11-07 锁定 base `04af317ec3bda5084ab1e44ea5e3559fd4622079`、head `30d6907e8a0d47030fe46731f4a6a94467632dd7`。执行上下文为检出该head的 `.worktrees/execution-setup-feedback-20261107` 根目录。初始工作树干净；cached reviews/threads为空且分页完成，MERGEABLE。`PR Fast Gate`、Verify、Browser、Merge Gate均成功；可选review webhook失败为既有#364，取消检查有成功后继。最终发布前仍须重锁head/base/checks。

## Design / Spec

先建五层P0–P3矩阵，再采用Qian系统分析综合和First Principles Development审计用户结果。将安装意图/在途所有权、UI等待预算和Host当前装配分开是合理的最小控制结构。

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 未破坏主线 | 未发现重复安装、错scope发布、晚值覆盖较新读 | F1：activationError读回清除install恢复身份 | 无新增风格意见 |
| 产品闭环 | 安装/纯读入口可运行 | 无模型/StartWork/凭据泄露或规划Status修改 | F1：“重试”发起Planning connect，未走执行恢复 | 未完成新Desktop人验已明示 |
| 架构 | 依赖边与Host权威保持 | active fingerprint/disabled检查避免持久pair冒充激活 | F1：失败归属是UI控制接口，不能仅留setup错误 | 没有引入额外wire/schema，范围克制 |
| 测试 | 窄测85/85通过 | 四项标准变异均归因KILLED | 真实Host/SQLite/client/UI反例因connects=1红 | 既有activation测试未走下一次实际UI按钮 |
| 工作项 | 未把工程证据称发布接受 | #553标准与该闭环一致 | F1应先在#553闭环修复 | 规模284代码/测试行、171文档行，合规 |

Host既有barrier保留，client超时只结束交互、不取消外部写或释放防重；恢复调用独立getWorkspaceSetup。disabled/custom挂载不被覆盖，规划degraded与执行确认正交。无需扩成Host超时框架；F1是同一反馈状态机中遗漏的错误分支。

## Global Constraints

初轮只写评审文档与运行态文件；随后主评审依已记录的人类条件授权分配 P2-F1 修复。此次只改本 PR 的根因源码、相关判别测试、计划和本记录，没有 Git 提交/push、GitHub写入或合并；主评审拥有的跨PR记录未改。原用户数据库与真实模型未触及。

## Plan of Work

1. 锁定 immutable diff、所有线程、checks、issue 与 ExecPlan。
2. 沿 UI/client/Core/Host/Provider 复核生命周期、失败、恢复、身份、持久化与外部确认。
3. 跑窄测试、独立反例及标准变异；核对重叠 issue 后一次汇总。

## Validation and Acceptance

以下命令在上述head工作树根实际运行；主检出 `.superpowers/pr559-565-review-20261107/` 保存日志/spec。

```sh
pnpm test:file tests/contract/ui-workspace-setup.test.js tests/contract/ui-workspace-settings.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-host-execution.test.js
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/560-mutations.json
node --test --test-timeout=10000 .superpowers/review-execution/activation-recovery.test.mjs
```

结果：窄测85 pass/0 fail；变异exit0、基线与还原后均绿；独立产品反例1/1因实际connects=1而红。初次临时反例因React解析失败没有产品结论；按既有测试的createRequire绑定UI包后重跑，最终日志是有效断言失败。Git argv diff/check返回0。

| 变异 | 检查 | killedBy归因 | 结果 |
|---|---|---|---|
| E560-1 | deadline不解除pending | execution setup recovers through real Host after | KILLED |
| E560-2 | 不检查human mount disabled | reopened Host cannot confirm a pair | KILLED |
| E560-3 | 纯读按钮改再次install | unknown execution exposes an enabled pure read control | KILLED |
| E560-4 | 确认读不结束执行intent | execution current assembly confirmation stays orthogonal | KILLED |

#553 AC1的正常确认/未知/失败大部有证据，但activationError后的下一次恢复由F1阻断；AC2自然键/disabled/custom保持、AC3真实Host/client故障gate、AC4零模型/运行/Status副作用均有定向证据。新安装人类接受另属明确保留门。

## Progress

- [x] 2026-11-07：逐文件前建立风险矩阵并锁定head/base。
- [x] 2026-11-07：完整阅读diff、Host/client/UI控制流、issue/ExecPlan及所有空线程。
- [x] 2026-11-07：85项窄测、四项归因变异与独立真实产品反例完成。
- [x] 2026-11-07：全部P2与边界交主评审；没有自行修代码或写外部状态。

## Surprises & Discoveries

F1：实际Host先落执行pair，再模拟装配失败与客户端ack丢失；install结束为result_unknown。调用recoverExecution读回真实Host的activationError后，snapshot变成failure=null、snapshotError=null、activationError=unavailable。实际WorkspaceSetupGate的“重试”落到submit/connect，观测installs=1、connects=1；预期connects=0。原因在 `workspace-setup.ts:116–117`：activationError排除了unresolved，但没有保留install失败归属。既有F1修复只保持read rejection/null error的身份，未覆盖这个同样经过独立读的分支。

## Decision Log

- 2026-11-07：无P0/P1，F1按P2交原owner修复。它引发可恢复的错误操作路由，没有重复模型执行、身份泄露或Planning Status写入。
- 2026-11-07：F1由#553直接承接；#338/#422的Host shutdown/remote生命周期是独立既有问题，不重复开同一发现。可选review webhook红检查由#364承接。

## Idempotence and Recovery

所有验证只操作临时SQLite/合成Provider，最终清理；没有接触原安装数据库或真实模型。标准变异逐字节还原且还原后基线通过。评审文件可单独撤回，不改变产品或Git历史。

## Interfaces and Dependencies

依赖Node/pnpm、本地UI包自己的React解析和Host replay fixture。F1源码锚点为 `packages/client/src/workspace-setup.ts:116–117`；实际消费者位于 `packages/ui/src/workspace-setup.ts:78–87`。修复必须同时保留执行归属、原意图与在途防重。

## Outcomes & Retrospective

初轮全矩阵完成：无P0/P1，F1一P2。设计已修复无限busy的大部分闭环，当前遗漏说明“错误被安全显示”不等于“下一次按钮作用于正确子系统”。修复后独立复评须走丢ack→activationError纯读→实际重试按钮，并断言Planning connect=0、安装意图不被替换。当前结论不是Desktop接受或合并授权。

**本轮 MMP P2-F1 修复（2026-11-07）**：client 在 install 类读回中将 activationError 作为 unresolved 错误保留，从而携带 failure=install；实际 UI 的 Retry 回到 installExecution，保留原 key。原未知/在途槽及纯读恢复逻辑未改。

在本分支工作树执行 `node --test --test-timeout=10000 --test-name-pattern="execution activation readback" tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-workspace-setup.test.js`：2 fail→2 pass；F1修正后的同一五文件窄测 87/87。真实 Host/SQLite 用例保持 pair=2、run=0；实际 UI 用例 Planning 写入=0、两次显式 install 使用同 key。`node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/560-mutations-final.json`：5/5 归因 KILLED、还原后基线绿；新增变异恢复旧 unresolved 分支，准确命中两条新测试。新 Desktop 安装人验未执行，仍按原接受门保留。

修复状态：本地验证已完成，等待另一评审者独立复评；初轮矩阵的 F1 不再作为未处理问题，但初轮证据保持有效。

### 独立 scoped 复评 · 560-F1（2026-11-07）

独立评审者未参与修复。锁定原 head `30d6907e8a0d47030fe46731f4a6a94467632dd7` 上当前未提交的 `packages/client/src/workspace-setup.ts` 及两条 activation readback 测试差异；在 `.worktrees/execution-setup-feedback-20261107`、检出 `fix/execution-setup-feedback` 的工作树根执行：

```sh
node --test --test-timeout=10000 tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-workspace-setup.test.js .superpowers/review-execution/activation-recovery.test.mjs
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/560-independent-scoped-mutations.json
```

实际为 **49/49**、零失败/跳过；包括原实际 UI/Host/SQLite 反例和新增两条行为测试。E560-5 独立变异 **1/1 归因 KILLED**，恰由两条新增用例失败；baseline/还原后 baseline 通过，生产文件还原字节一致。日志为 `560-independent-rereview.log` 与 `560-independent-scoped-mutations.log`。
安装类确认读的 activationError 保留 failure=install，实际 Retry 继续原 execution intent/key，不触发 Planning connect；已存在 unknown 的纯读恢复与装配确认语义保持。修复只改变已有失败结算的一行，不新增持久状态或第二恢复框架。**560-F1 ADDRESSED，无新增 P0/P1/P2/P3**。没有改实现或 tracked tests，没有 commit/push/GitHub 写入；本地结果不替代实际安装或人类接受。

## Bottom Change Note

- 2026-11-07：进入文件审查前创建矩阵；完成后加入窄测/变异及实际UI恢复反例的一项P2结论。

- 2026-11-07：本轮 MMP P2-F1 保留 activationError 的执行恢复归属；加入真实 Host 与实际 UI 红绿测试、87/87和最终5项变异证据。

- 2026-11-07：补 560-F1 修复的独立 scoped 复评，记录最窄实际回归、归因变异和生产字节还原；外部当前 head/安装接受仍分开。

2026-11-07 SGT：根协调者在独立复评后归档本工程切片。当前 install 激活错误保持原执行恢复归属；#553 工程 AC 由真实 Host/SQLite/client/UI 判别测试验证，新安装与人类接受单列。 只以最终 push 的当前 head/base、checks、全部线程及 issue 关联进入条件合并，不沿用初轮批准。
