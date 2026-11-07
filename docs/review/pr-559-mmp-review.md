# PR #559 MMP 交付评审

## Purpose / Big Picture

判断未来任务的 session/request 身份能否在 prompt 前持久接纳、在不重启任务的前提下恢复。工程修复、历史 installed 故障定位和人类接受分别判定。

## Context and Orientation

2026-11-07 锁定 base `04af317ec3bda5084ab1e44ea5e3559fd4622079`、head `1c83f6751346e8667e10da9f9ffceef677aea0ff`。执行上下文为检出该 head 的 `.worktrees/execution-start-identity-20261107` 根目录。初始工作树干净；cached reviews/threads 均为空且分页完成，MERGEABLE。`PR Fast Gate`、Verify、Browser、Merge Gate 均成功；可选 review webhook 失败为既有 #364，同名取消检查有成功后继。远端值属于当次观察，最终合并前须重新回读。

## Design / Spec

先建立下表再审文件。采用 Qian 系统分析综合与 First Principles Development 审计：目标是同一用户任务可恢复；Host/Core 是权威，Provider 只签发身份；测试绿色不能代替时序和安装态证据。

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 代码 | 无主线破坏证据 | 未发现重复 prompt、跨 owner/ref 覆盖或泄露 | F1：迟到初始结算覆盖较新终态与 receipt | 未新增风格意见 |
| 产品闭环 | 基础启动可运行 | 未发现身份丢失后盲目重启 | F1：刷新/第二Core恢复已成功仍被原调用降级 | 原无ref历史不自动修复，边界已披露 |
| 架构 | 七条不变量和依赖方向保持 | checkpoint 短事务、Provider I/O在事务外；撤权/代际围栏有测试 | F1：owner相同不代表观察仍新，缺结算版本围栏 | 无需新schema/账本，设计克制 |
| 测试 | 基线340/340通过 | 三个标准变异均归因KILLED | 独立8反例全红，覆盖失败与过时running成功 | 无需扩大全量掩盖定向失败 |
| 工作项 | 无发布门代替事实 | 未把缺原始栈当代码P1 | F2：Closes #554早于AC4；建议Refs | 规模302代码/测试行、153文档行，合规 |

checkpoint callback 只在调用栈存在，intent仍可序列化；同一runId与ref复用合理。page固定cut与反向连续seq检查符合当前安装包 `@deepseek-ai/dsh-api-session-controller@0.2.2-rc.1` 源码，原0.2.0录制没有被冒充为新录制。欠缺的是较新恢复事实与原始结算的时序接合，非增加兼容框架。

## Global Constraints

初轮只写评审文档与运行态文件；随后主评审依已记录的人类条件授权分配 P2-F1 修复。此次只改本 PR 的根因源码、相关判别测试、计划和本记录，没有 Git 提交/push、GitHub写入或合并；主评审拥有的跨PR记录未改。原用户数据库与真实模型未触及。

## Plan of Work

1. 锁定 immutable diff、所有线程、checks、issue 与 ExecPlan。
2. 沿 UI/client/Core/Host/Provider 复核生命周期、失败、恢复、身份、持久化与外部确认。
3. 跑窄测试、独立反例及标准变异；核对重叠 issue 后一次汇总。

## Validation and Acceptance

以下命令在上述head工作树根实际运行；主检出 `.superpowers/pr559-565-review-20261107/` 保存日志/spec。

```sh
pnpm test:file tests/contract/host-session-adapter.test.js tests/contract/harness-execution-contract.test.js tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/harness-plugin-host-execution.test.js
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/559-mutations.json
node --test --test-timeout=10000 .superpowers/review-execution/late-initial-read.test.mjs
```

结果：窄测340 pass/0 fail；变异脚本exit0，基线和还原后均绿；独立反例8/8因实际状态倒退而红，无import/timeout异常。Git argv diff/check返回0；独立读取安装包源码确认page的cursor/records/hasMore、连续事件和beforeSeq/throughSeq语义；没有真实Host调用或模型请求。

| 变异 | 检查 | killedBy归因 | 结果 |
|---|---|---|---|
| E559-1 | 删除prompt前checkpoint | preserves original identity across reopen | KILLED |
| E559-2 | 续页不带throughSeq | 当前 page ABI：固定 cut | KILLED |
| E559-3 | 缺request用session.running猜状态 | 状态只属于 rpcId 的 turn | KILLED |

issue #554 AC1–3有当前生产Provider/Core/SQLite工程证据；AC4只完成支持ABI源码核对，原installed失败方法仍未定位。F2要求保留该原标准，不能自动关闭。

## Progress

- [x] 2026-11-07：先创建五层P0–P3矩阵并锁定head/base。
- [x] 2026-11-07：读完immutable diff、调用路径、所有空线程、issue/plan及已有相关issue。
- [x] 2026-11-07：窄测、三项变异、八项独立反例与安装ABI源码核对完成。
- [x] 2026-11-07：全部意见已汇总交主评审；修复、外部review与最终门由主评审协调。

## Surprises & Discoveries

F1：保持原startRun的首page未返回，让同Core refreshExecutionRun或第二Core replay将原run读为succeeded；释放迟到首读。失败响应使succeeded→unknown，过时成功使succeeded→running；第二Core已saved的receipt可→unknown。Fake/SQLite两者一致，create=1/prompt=1。根因是 `start-work.ts:663` 只比ref，随后无条件put，receipt采样又发生在新事实之后。第二receipt事务中的当前比较无法补救第一事务已覆盖的新事实；不拆成重复意见。

F2：PR元数据Closes #554，而计划Decision默认Refs，且原installed失败边界仍缺证据。合并工程修复可以独立，但自动关闭原issue会掩盖未验收标准。

## Decision Log

- 2026-11-07：无P0/P1；两项P2交原owner修复/调整，原代码未改。原因：F1可通过再次只读恢复且无第二执行，F2为证据/关联归属问题。
- 2026-11-07：F1归#554直接闭环；#215/#284/#304是较宽生命周期父项，不据此免除本次新竞态。#459/#73保留发布与人类门。

## Idempotence and Recovery

窄测试与只读复现可重复；标准变异逐字节还原，终表全KILLED并完成还原后基线。运行态反例只创建临时Fake/SQLite，均清理。回退评审只删除本记录/运行态文件，产品行为与历史不变。

## Interfaces and Dependencies

依赖本地Node/pnpm、工作树内依赖解析守卫和临时SQLite。公开评审锚点：F1 `packages/core/src/start-work.ts:663–668`；F2 `docs/exec-plan/active/2026-11-07-execution-start-identity.md:108`，意见实质是PR closing元数据。

## Outcomes & Retrospective

初轮全矩阵完成：无P0/P1，F1/F2两P2。好设计保留显式身份与Host权威，但绿色340测试/三变异未覆盖“新确认先到、原结算后到”的用户流程。F1修复后需独立复评这八种时序；F2需远端readback确认Refs且#554继续保留未完成标准。当前结论不是安装接受或合并授权。

**本轮 MMP P2-F1 修复（2026-11-07）**：`start-work.ts` 在 checkpoint 事务中保存完整 run/receipt 快照，原始结算只在两者均仍匹配时写 journal；receipt 事务对该 journal 与 receipt 再次条件比较，失配只读回较新事实。没有按终态特殊放行；新 running 同样受保护。保留 journal/receipt 两阶段持久化，未引入新 schema、状态权威或 Provider 调用。

在本分支工作树执行 `node --test --test-timeout=10000 --test-name-pattern="checkpoint late|checkpoint final receipt" tests/integration/start-work-execution-recovery.test.js`：20 fail→20 pass；Batch 2 同一六文件窄测 360/360。首次相关回归 358 pass/2 fail，两条 `receipt-only finalization retains newer cancel state` 指出围栏不应扩大到无 checkpoint 路径；收窄后 360/360。`node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/559-mutations-final.json`：6/6 归因 KILLED、还原后基线绿；新增三变异分别去掉初次 run 比较、receipt 前 journal 比较、初次 receipt 比较，均命中各自测试。F2 的 `Refs #554` 和原 AC4 保留由主评审处理；原 installed 失败边界与安装接受仍未补证。

修复状态：本地验证已完成，等待另一评审者独立复评；初轮矩阵的 F1 不再作为未处理问题，但初轮证据保持有效。

### 独立 scoped 复评 · 559-F1（2026-11-07）

独立评审者未参与修复。锁定原 head `1c83f6751346e8667e10da9f9ffceef677aea0ff` 上当前未提交的 `packages/core/src/start-work.ts` 与 `tests/integration/start-work-execution-recovery.test.js` 差异；在 `.worktrees/execution-start-identity-20261107`、检出 `fix/execution-start-identity` 的工作树根执行：

```sh
node --test --test-timeout=10000 tests/integration/start-work-execution-recovery.test.js .superpowers/review-execution/late-initial-read.test.mjs
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/559-independent-scoped-mutations.json
```

实际为 **221/221**、零失败/跳过；包括新20例、原8例竞态反例与原无 checkpoint 的两条 cancel 用例。新增守卫的 E559-4/5/6 独立变异 **3/3 归因 KILLED**，baseline/还原后 baseline 通过；生产文件还原字节一致。日志为 `559-independent-rereview.log` 与 `559-independent-scoped-mutations.log`。
run 与 receipt 在 checkpoint 捕获同一提交快照，journal 前比较二者，receipt 前再次比较 journaled run；有更新时返回较新事实。此机制保护新 running、succeeded 和独立 receipt，不只按终态枚举特判。第二次 run 比较限于 checkpoint，保留旧 journal/receipt 独立容错与 cancel 语义。修复范围和设计适度，**559-F1 ADDRESSED，无新增 P0/P1/P2/P3**。
559-F2 的 `Refs #554` / 原 installed-boundary AC4 归根协调者处理，此 scoped 代码复评未据此声称 metadata 或原安装接受已结项。没有改实现或 tracked tests，没有 commit/push/GitHub 写入；最终提交后仍须锁定新 head 与外部门。

## Bottom Change Note

- 2026-11-07：逐文件前创建矩阵；完成后加入实际窄测、归因变异、独立反例与两P2结论。

- 2026-11-07：本轮 MMP P2-F1 按真实并发反例修复；记录20红绿、首次回归失配及收窄后的360/360、最终6项变异。修复独立复评与远端门仍待主评审。

- 2026-11-07：补 559-F1 修复的独立 scoped 复评，记录最窄实际回归、归因变异和生产字节还原；外部当前 head/安装接受仍分开。

2026-11-07 SGT：根协调者在独立复评后归档本工程切片。本 PR 和最终 commit 使用 Refs #554，原 installed Host 实际失败边界 AC4 未满足，#554 保持 OPEN；其余 source/ABI 与离线恢复证据不升级为原现场根因或旧无引用记录修复。 只以最终 push 的当前 head/base、checks、全部线程及 issue 关联进入条件合并，不沿用初轮批准。

2026-11-07 SGT 559-F2：PR 正文和最终交付提交均使用 Refs #554，#554 AC4 保持未完成；旧无引用记录与原 installed 失败边界没有被源码或离线证据冒充修复。合并前必须执行 `gh pr view 559 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,closingIssuesReferences`，期望 closing 为空，并回读 #554 仍 OPEN；不满足即停止本条合并。
