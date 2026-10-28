# PR #438 MMP 交付评审

观察日期：2026-10-28（Asia/Singapore）。初评时状态：独立评审已完成、候选事件 APPROVE；随后由协调者提交 review 5681133780，发布记录见末节。

## 锁定事实与控制

- base：`main@88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；head：`eed2b9ff5339fb528333452c7c6029c46a8e2f73`；分支：`feature/execution-run-refresh`。
- 执行上下文：检出 `feature/execution-run-refresh` 的 `.worktrees/execution-run-refresh` 根目录。范围：运行刷新：签发者路由、持久健康度、取消竞争与详情闭环。
- 事实：当前 ready、可合并；关联 issue #365；所有 review/thread 已读取，均为空且无后续页。CI 结果按当前 head 单独回读。
- 硬约束：保持规划/工程轴正交、Host 权威、Provider ack/reconcile、全局身份与工作区成员分离、既定依赖边。局部测试通过不能代替 MMP 产品闭环。
- 方法：Superpowers 独立子评审；qian-systems-router 的接口/反馈与综合判断；first-principles-development 的事实、约束、反例与最小判别验证。
- 已有实现 owner：会话「规划迭代优先级与并行交付」。P0/P1 交该 owner，评审方不并行修改产品代码；P2/P3 按本次人类授权由评审方负责收尾。
- 人类直接指令覆盖 PR #438–#440：无阻塞时修复、独立复评、归档、整理提交、核对 issue 后执行 rebase merge；有 P0/P1 时 REQUEST_CHANGES 且不合并。

## 预建风险矩阵

以下为逐文件审查之前建立的风险假设，不能当作已发现缺陷。

| 层 | P0：main/硬约束破坏 | P1：交付阻塞 | P2：可修复非阻塞 | P3：局部改进 |
|---|---|---|---|---|
| 代码/反例 | 数据丢失、越权写入、不可恢复事务 | 错 issuer/身份、迟到覆盖、失败伪成功、越界清理 | 边缘错误诊断、无害冗余 | 命名/局部可读性 |
| 产品闭环 | 工程状态篡改规划权威 | 用户入口到权威回读/投影断裂；证据误归当前版本 | 恢复提示/限制表述欠清楚 | 文案与呈现 |
| 架构/设计 | 第二权威源、secret 入业务库 | 违反依赖、身份/工作区隔离、持久化原子性 | 可避免的耦合/超范围设计 | 局部简化 |
| 测试 | 发布门禁绕过且无证据 | 主张未被判别测试覆盖、失败/并发路径失守 | 已有行为的覆盖薄点 | 重复断言/命名 |
| issue/验收 | 无授权改变规划关系/发布边界 | scope/acceptance 未闭环却关闭；已有跟踪与本次归属混淆 | 索引/验收清单遗漏 | 说明精简 |

## 分层证据与反例

### 系统结果、事实与约束

审查目标是用户从详情点击刷新后，看到签发者实际读回的运行状态、当前状态的确认时间和持久陈旧标记；运行结束不能改变 Planning。当前为交付评审阶段，采用接口/反馈检查与反例验证。事实是 runStatus 已存在，新增变化集中在执行生命周期、Host 传输和详情展示；约束是正常同状态完全零写、Host 权威、完整引用路由及事务原子性。未假定单飞等于跨进程排序，也未把本地 Fake 成功当真实平台验收。

### 分层结论

| 层 | 证据 | 结论 |
|---|---|---|
| 代码与状态 | `execution-run.ts:76–110`：I/O 在事务外；事务内重读 context/run，完整引用、status、updatedAt 相同才提交。错误保留 known 状态，固定错误文案；run 和健康度同事务。两 Storage 故障/重开/取消交错测试通过。 | 未发现本 PR 新增 P0/P1/P2/P3。CAS 丢弃的响应不误写新身份；取消旧缺口见下文。 |
| 产品闭环 | 生产 `client.ts:51–58` 接刷新 port，Host 前后可见性门、Controller/Core、签发 Fake、白名单 DTO、严格解码、按钮及文案被组合测试贯通。初次打开只读；失败命令后仍重读持久 stale；多仓库、target cleanup、断连和迟到结果均有窄回归。 | #365 的用户入口闭环成立。已安装官方 Host 与真实会话服务仍为产品验收边界。 |
| 架构与设计 | 沿既有 Core → Controller → Host/client → ui-model/ui 路径，查询只读。复用 SyncCursor 记录健康度，不建立第二运行状态源、不增 schema/迁移/依赖；无 Planning 写入口。`package-boundaries` 9/9。 | 方案适当且规模收敛；无已证实的过度设计或依赖倒置。 |
| 测试判别力 | 64/64 聚焦；五项定向变异全部 KILLED 且 `killedBy` 归因匹配；还原后基线通过。 | 关键断言并非仅 smoke。完整本地回归由作者记录，本轮没有重新声称执行其 2361 项全套。 |
| 工作项与范围 | 读取 #365 原三条 acceptance、补充 disposition/forecast、当前 PR/commits/全部空 review/thread；搜索全部 open issues。#215 拥有取消命令与恢复，#193 拥有 Start Work 执行恢复，#151 拥有完整 provenance。 | 不由关闭 #365 接受这些独立工作项，也不把旧债重复列为本 PR inline。 |

### #365 逐条验收

| 原验收 | 本轮证据 | 判定 |
|---|---|---|
| 只问签发者；变化记录一次；相同状态重复零写 | fallback/default 切换用例只调用原签发者；完整响应引用三项分别拒绝。Fake/SQLite 持久写 spy 在健康重复、同错误重复时均为零，确认时间不变。M1/M2/M3 变异均被对应断言杀死。 | 满足仓库内可执行验收。 |
| Provider 不可达时保留最后确认状态并标 stale | 结构化/异常/unknown/畸形响应保留 known 与确认时间；SQLite close/reopen 保留 stale，成功同状态仅清健康度一次；失败信息不外泄原文。 | 满足仓库内可执行验收。 |
| finished run 在任一 status policy 下都不改 Planning | 三策略 × 四终态对 planning items、membership、field values、projection 和 revision 作刷新前后相等断言；另跑原 status-policy 回归。 | 满足，未把工程事实提升为规划事实。 |

### 关键反例与已跟踪边界

1. 刷新挂起，取消先提交 canceled，再释放旧 running：本地仍 canceled；full CAS 变异 M4 会让此测试失败。重新绑定 objectKind、健康度写失败和响应身份篡改也分别有断言，不能仅由绿色主路径代替。
2. Host 在刷新前已 redacted 时不调用命令；I/O 后才 redacted 时拒绝返回结果；目标切换早于排队命令执行时不触发旧目标刷新。M5 移除显式命令会杀死按钮链测试。
3. 反向取消探针：启动 ack 为 queued，挂起 cancel，刷新先读回并提交 running，再释放同签发者的 canceled ack（可带新 externalId）。实际取消结果为 `status: running`、`error: undefined`，存储继续保留 running 与原引用。原因是取消处 status/updatedAt CAS 拒绝该 ack；旧 main 已有 status CAS、ack 未落库后的诚实结果与 reconcile 缺口。该取消路径无新增用户入口，#215 的取消 ack 未持久化/恢复验收已拥有此问题；本 PR 不声称修好，不重复新增 inline。探针为 `.superpowers/review-438/cancel-refresh-probe.mjs`，exit 0，断言上述实际结果。
4. 跨 Core owner 的开始序、TTL、自动轮询、运行历史及未知启动结果恢复不在本次承诺。正常同状态不更新时间的语义已在计划和 UI 文案中明确为“此状态于 T 确认”，不是“最近一次读取时间”。

### 命令结果与变异表

所有命令均在检出 `feature/execution-run-refresh` 的 `.worktrees/execution-run-refresh` 根目录执行。

- `node --test --test-timeout=120000 tests/integration/execution-run-refresh.test.js tests/integration/execution-context-run-status.test.js tests/integration/harness-plugin-execution-drawer.test.js tests/contract/ui-execution-context.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/e2e/status-policy.test.js`：64 pass，0 fail。
- `node --test tests/contract/package-boundaries.test.js`：9 pass，0 fail。
- `node node_modules/typescript/bin/tsc --noEmit`：exit 0。
- `node scripts/review-mutate.mjs .superpowers/review-438/mutations.json`：最终树整表五项 KILLED；工具确认逐字节还原、还原后基线通过；生产源码逐字还原；协调者另有本轮控制计划及 docs 索引修改，未把这些文档变化当作产品源码变化。
- `git diff --check 88d21ae6e0f0afb1f18afc776f54efac3ff4723a...HEAD`：exit 0，无输出；本地 Git 均由 Python subprocess argv 调用。

| 变异 | `killedBy` | 结果 |
|---|---|---|
| M1 禁止状态变化写入 | `refresh changes once; healthy repeat writes nothing` | KILLED |
| M2 每次均写健康度 | `refresh changes once; healthy repeat writes nothing` | KILLED |
| M3 删除响应完整引用比较 | `bad observations preserve known; refs and capability route fail closed` | KILLED |
| M4 删除刷新 run 快照 CAS | `late refresh loses to cancel, full CAS prevents rebinding and health commit is atomic` | KILLED |
| M5 按钮跳过命令只重读 | `existing refresh button commands each repository then rereads durable stale even on command failure` | KILLED |

### 初评 head、CI 与意见（提交前快照）

末次本地 `rev-parse HEAD` 与远端 `gh pr view 438` 回读仍为 `eed2b9ff5339fb528333452c7c6029c46a8e2f73`，base 仍为 `88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；ready、MERGEABLE、closing reference 为 #365。当前 head 的 PR Fast Gate、CI Verify、Merge Gate、PR size、Disclosure scan 均 SUCCESS。Actions head-SHA 查询确认 Rule checks `40660381102`、Issue policy `40660381112`、Engineering state `40660382466` 的取消均已有同 head 成功后继（`40661223516`、`40661223370`、`40661224017`），不把 CANCELLED 当作未知失败放过。

P0/P1/P2/P3 新发现均为 0；候选新增 inline 为 0，避免重复 #215。候选 review 事件为 `APPROVE`。截至该初评快照，子评审未提交 review、commit、push 或更改产品代码；协调者后续已提交 review，见末节。此结论仅对应上述 immutable head；若 head/base 改变则重新锁定和评审。

## 初评结论与当时的下一道门

初评建议 `APPROVE`：原三条验收有独立可执行证据，未发现本 PR 新增缺陷。初评时的下一道门是主评审者汇总后以评审账号提交当前 head 的 review，并按人类对 #438 的直接授权完成收尾；合并前仍须回读 head/base/checks。#215 及已安装 Host/真实平台验收继续独立跟踪。

## 协调者综合与发布回读

2026-10-28 +08，`gh-review` actor Singularity-AI-Bot 对本仓 PR #438 / head `eed2b9ff5339fb528333452c7c6029c46a8e2f73` 提交 `APPROVE` review `5681133780`；初次所有 inline 均随这一份 review 一次提交。幂等标识为 `mmp-review-20261028:438:eed2b9ff5339:initial`。P0/P1 均无新增；P2/P3 亦无新增可行动意见。

协调者重算三 PR 合并树 `14ccba46db29ccc81ebfac55f183533ebf31ca72`，与 `test/iteration9-independent-integration@b300535b418683e9910ac372b3ccc40f75467fb5` 的 apps/packages/tests/scripts/workflows 及配置 blob 一致（清单 SHA-256 `8a81e2f22c6cb4652eb37e37ca57074c7f8fbbae559be65f131cabe01cb19638`）。在该命名集成检出运行 `pnpm verify`：类型检查、2442/2442 主测试、7/7 MVP 通过，执行后检出仍 clean。这是本地并集证据，不能替代单 PR CI、官方安装件真人路径或 R1。

初评当前 head 的必需 PR Fast Gate、CI Verify、Merge Gate、规模与披露检查均成功。#439/#440 的可选 Create review session 日志分别为 run 40661235450 / 40661250684，已确认本地 loopback 服务连接拒绝；分支保护 API 当前 strict=true，仅要求 PR Fast Gate。最终 push 后仍执行当前 head/base/checks、issue 双向关联与 threads 回读。
