# PR #667 MMP 交付评审

> 状态：首审 APPROVE；工程归档完成，最终提交待重锁复评。评审日期：2026-11-21。

## Purpose / Big Picture

判断退役 `DeliveryLineageHop.observed/detail` 是否形成独立可验收、可回滚的合同清理闭环，保留真实谱系观测和纯读行为。

## Context and Orientation

锁定 PR #667，base `main@33fcde299ae16666ca936b61e7687041a1c0f35e`，head `7ba19b9ad6dc0a48162d9ca3c234dc7bc7cc1854`，分支 `refactor/delivery-lineage-hop-fields`，Closes #633。2026-11-21 初始观察：本地 HEAD 命中锁定值，工作树干净。远端快照：OPEN、非 draft、MERGEABLE、UNSTABLE；19 个 checks 中 18 SUCCESS，单项 `Create review session` FAILURE；无 reviews、无 threads。以上是观察值，最终必须重新回读。

提交序列：`912b94a`、`398aa8b`、`6c0c638`、`2cb8c5d`、`32ac7f0`、`2ee67f5`、`7ba19b9`。评审对象是该 immutable head 相对锁定 base 的最终差异，历史红提交不单独作为产品缺陷。

## Design / Spec

先建立下列初始矩阵，再逐文件阅读实现。方法：对齐 issue 验收，检查生产者→Host→Client→UI-model→UI 的接口流及保留的安全边界；用已有行为测试和少量变异验证断言判别力。拒绝以重复夹具形状作为字段必须保留的理由。

| 级别 | 风险假设 | 覆盖层 | 判定证据 / 初始状态 |
|---|---|---|---|
| P0 | 破坏 main 构建、依赖方向、Host 权威、确认写入或秘密句柄硬约束 | 代码 / 架构 | 检查实际 diff、类型与边界；待验证 |
| P1 | 真实消费者仍读取退役字段，或严格解码破坏当前 Host；观测、缺口、来源、权限、新鲜度、仓库隔离或纯读回归 | 代码 / 产品 / 架构 | 消费链审计、负对照、保留行为测试；待验证 |
| P2 | issue 验收、恢复界限或证据不全；测试替换丢失有价值语义 | 测试 / 工作项 | 对照 #633、ExecPlan 与断言；待验证 |
| P3 | 非阻塞文档、命名或提交整理问题 | 工作项 / 设计 | 规模与冗余检查；待验证 |

## Global Constraints

初始子评审唯一允许写入 `docs/review/pr-667-mmp-review.md`；后续协调者按人类条件授权更新实施计划、索引与本记录。执行上下文为检出锁定 head 的 `.worktrees/delivery-lineage-hop-fields` 根目录；不得修改产品、测试、其他文档或 Git 历史，不得发送 review/评论。HEAD 漂移或出现其他共享写入即停止并通知。变异仅使用 `scripts/review-mutate.mjs` 的恢复保证。

## Plan of Work

1. 锁定事实及初始风险矩阵（本次落盘在代码逐文件阅读前完成）。
2. 审阅最终 diff、消费路径、issue 与实施计划，按矩阵检查全部层。
3. 执行最窄有效测试、针对性变异，回读 head 与变异恢复状态；记录结论。

回滚：只新增评审文档；任何测试变异由仓库脚本原样恢复，不进行产品修复。

## Validation and Acceptance

所有命令都在上述锁定检出根目录执行；GitHub 命令显式 `-R SingularityKChen/harness-projects`。本轮独立执行结果如下；没有把作者自报的 `pnpm verify` 当成本轮全量执行。

| 命令 | 结果 |
|---|---|
| `pnpm run test:file tests/integration/harness-plugin-delivery-lineage.test.js tests/e2e/delivery-lineage.test.js tests/integration/github-development-lineage.test.js tests/integration/delivery-repository-routing.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-delivery-lineage-section.test.js tests/e2e/delivery-lineage-strip.test.js tests/e2e/controller-roundtrip.test.js tests/integration/provider-binding-registration.test.js` | exit 0；179 pass、0 fail、0 skipped |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | exit 0；10 pass、0 fail |
| `git diff --check 33fcde299ae16666ca936b61e7687041a1c0f35e...HEAD` | exit 0，无输出 |
| `node scripts/rule-checks.mjs size 33fcde299ae16666ca936b61e7687041a1c0f35e` | exit 0；code 35/1000、docs 171/1500（尚未计入本轮新增记录） |
| `node scripts/rule-checks.mjs disclosure 33fcde299ae16666ca936b61e7687041a1c0f35e` | exit 0；覆盖本地范围提交与新增行；未传 `PR_BODY`，PR 文本另经人工五类目阅读 |

人工发布面：最终 diff、提交文本与 PR 描述未发现凭据、本机身份路径、额外个人信息、内部系统或保密字样泄漏。本轮未跑全量 verify/浏览器/Windows：源码只删两个字段且无壳、存储或平台代码变化；当前 immutable head 的远端 Verify、Browser、Windows Native 与 PR Fast Gate 均 SUCCESS，窄集补足本轮直接证据。

### 变异判别表

执行 `node scripts/review-mutate.mjs "$TMPDIR/review-667-mutations.json"`；spec 按下表构造，系统临时文件在完成后删除。命令在每项前后由脚本运行基线、按原文字节还原。初轮 M6 的 `killedBy` 错指存储提交失败用例，得到 KILLED_OTHER；改为直接检查 hop 陈旧标记的“无锚点的刷新（”用例，整表重测后才记录最终结论。

变异 spec 由下表的文件、单点替换与 `killedBy` 重建；基线命令为 `node --test --test-timeout=120000 tests/integration/harness-plugin-delivery-lineage.test.js tests/e2e/delivery-lineage.test.js`。

最终整表 exit 0；六项均 KILLED，未把编译错误或其他用例失败当作指定断言的证据：

| 变异 | killedBy / 具体判别路径 | 结果 |
|---|---|---|
| M1 `delivery-lineage-reader.ts` hop 白名单恢复 `observed` | `client delivery envelope rejects scope`，旧 observed: true 被错误接受 | KILLED |
| M2 同处恢复 `detail` | 同上，旧 detail: legacy 被错误接受 | KILLED |
| M3 `delivery.ts` hop 字面量恢复 `observed: true` | `Host delivery query is scoped and pure`，真实 Host JSON 旧键被当前 Client 拒绝 | KILLED |
| M4 `delivery-facts.ts` 把 `nodes.filter((node) => node.observed)` 改为 `nodes` | `缺口（`，缺失 CR/检查位置错误变成节点而非 gap | KILLED |
| M5 `delivery.ts` 把 `const mask = masks.get(kind)` 改为 `const mask = undefined` | `real Core route denial masks protected CR`，拒读后旧 CR 暴露 | KILLED |
| M6 `delivery.ts` hop 字面量把 `stale` 改为 `stale: false` | `无锚点的刷新（`，保留旧事实却错误标记为当前值 | KILLED |

脚本完成后基线 exit 0；`git diff --name-only` 无 tracked 变化、HEAD 不变，`git status --short` 仅本评审记录未跟踪。系统临时 spec 已删除；下表保存单点变异意图和失败归因，未删除预存 ignored/build 文件。

### Issue #633 验收映射

| 原始验收 | 判定与证据 |
|---|---|
| 区分真实消费者与形状夹具，记录去留 | 满足；生产消费链见 Surprises，实施 ExecPlan 已选择退役 |
| 生产者、类型、解码器与断言一致，无兼容旁路 | 满足；最终 diff 删除类型和字面量、Client 白名单收窄；正负对照有效 |
| 保留观测、缺口、来源、权限、新鲜度、隔离、纯读 | 满足；179 项包含真实节点、内存/SQLite 缺口、离线、新鲜度、Host 遮罩、两连接诱饵及重开纯读 |
| 保留 Host 操作、scope 与 errors，协调真实 payload 消费者 | 满足；Host 操作表不变；生产 Host JSON→Client→section 正常读取，错 scope、撤权与失败刷新仍拒绝 |
| Core、Client/Host、展示、typecheck、反例与独立回滚 | 满足工程范围；179 项与类型/边界绿；字段从未落库，合同清理可独立回滚；提交整合与计划归档由协调者收尾 |

#224 仍保留独立的 Storage 装配清理 #632，本 PR 不能关闭父项；部署/环境能力由 #153 承接，不为本次删除扩大范围。没有发现需要另开 issue 承接的新产品缺陷。Gate R1 与安装产品、人类接受均不由本轮测试替代。

## Progress

- [x] 2026-11-21：读取本 worktree 的 AGENTS、PLANS 与 MVP 评审约定；初始矩阵已落盘。
- [x] 2026-11-21：完成分层代码与 issue 验收审计；未发现产品阻塞项，变异验证继续。
- [x] 2026-11-21：完成 179 项窄验证、typecheck、10 项边界、6/6 定向变异、恢复核对及最终远端回读。

## Surprises & Discoveries

生产链实证：`packages/core/src/delivery-facts.ts:32-52` 仍用 `ChainNode.observed` 判断集合完整性并排除骨架；`packages/capabilities/src/storage.ts:266` 的 `DeliveryNodeFact` 从未持久化退役字段。`packages/core/src/delivery.ts:148-177` 的投影仅从已提交快照与关系表构造跳，退役字段不参与缺口、权限遮罩或新鲜度计算。

消费链实证：`packages/core/src/projection.ts:108-112` 仅消费 `hop.fact`；controller 转发（`packages/controller/src/queries.ts:51-52`）、Host 作用域守卫与原样返回（`apps/harness-plugin/src/host-composition.ts:139-148`）、插件 reader wiring（`apps/harness-plugin/src/client.ts:83-86`）均无字段消费。ui-model 的 `stateOf` 与 `deriveDeliveryLineageStrip`（`packages/ui-model/src/delivery-lineage.ts:85-116`）使用真实的 stale/freshness/fact/unavailable/relationState。全仓生产代码检索没有退役字段读取。

唯一 wire 变化是 hop 键收窄；Host 操作名、参数、作用域、错误与刷新调用保持原样，当前 Host 通过 JSON 往返进入严格 Client 解码器。仓库预发布明确允许这次形状翻转，无需另建兼容分支。

可选 CI 红项已查真实失败日志：run `44754152394` 的本地评审转发端点返回 HTTP 404；`.github/workflows/github-review.yml` 只转发 ready 事件、不 checkout PR 代码。不得把 404 扩写成已经证实“服务未运行”。

一次变异入口误把系统临时目录当成 `/tmp`，脚本以 `HARNESS_ERROR ENOENT` / exit 2 结束，未施加任何变异；改用真实 spec 路径重跑，最终表仅采用完整批次结果。

## Decision Log

- 2026-11-21，评审者：按明确授权仅写本 PR 评审记录；不对分支实施修复。使用 First Principles Development 的审计路由与 Qian Systems Router 的接口流分析；using-superpowers 对 dispatched subagent 明确允许跳过总入口仪式。

## Idempotence and Recovery

只读命令与测试可重复执行；变异执行前后核对 HEAD、目标文件哈希及 `git status`，出现恢复失败即停止。评审结论仅适用于锁定 head/base；任何重写或重定向使结论失效。

## Interfaces and Dependencies

使用 Node、pnpm、Git、GitHub CLI 与仓库提供的变异脚本。开发账号与评审账号不同；本子任务不执行任何 GitHub 写入。

## Outcomes & Retrospective

最终风险矩阵（初始矩阵的“待验证”仅保留启动时记录）：

| 级别 | 最终判定 | 支撑 |
|---|---|---|
| P0 | 无发现 | 类型/包边界通过；无规划、写确认、凭据与持久层改动 |
| P1 | 无发现 | 生产消费链闭合；当前 Host JSON 解码成功；旧键拒绝；观测、权限、陈旧、隔离与纯读既有行为通过 |
| P2 | 无发现 | #633 全部工程验收映射完成；未因字段清理削弱真实状态断言 |
| P3 | 无新增可行动项 | 范围适当；提交整合与计划归档已属于协调者安排的收尾 |

代码、产品、架构、测试和工作项已完成全矩阵审查，当前没有可行动的 P0/P1/P2/P3 产品或测试缺陷。退役范围适当：四行生产合同改动加小范围测试替换，无新抽象、兼容层、校验框架或存储迁移。字段实际无消费者，以外部标识、来源、陈旧与关系状态替代恒真断言保留了更有判别力的行为证据。

提交整合、实施 ExecPlan 归档和 issue 勾选是协调者已经安排的收尾，尚未执行不是本轮新增 inline 问题。最终建议 APPROVE；本子任务未向 GitHub 发出 review，也未提交、push 或合并。2026-11-21 最终回读 head/base 与锁定值相同，Closes #633，19 项 checks 中 18 SUCCESS，唯一 FAILURE 仍是可选评审端点 HTTP 404。当前无 review threads；任何后续整理提交、归档或 rebase 都必须重锁并独立复评。首审本身不授予合并权限；后续权限来自人类本次点名条件授权，见归档 ExecPlan D8。

## Bottom Change Note

- 2026-11-21：在逐文件审查前建立锁定事实、P0–P3 初始矩阵、验证边界与恢复规则。
- 2026-11-21：补齐消费链、issue 验收、实测与 6/6 变异、失败归因纠正、恢复核对和最终结论。

### 最终收尾规则（2026-11-21 10:14 SGT）

首审 GitHub review 为 `6002120779`，actor 为评审账号。人类直接条件授权见 `docs/exec-plan/completed/2026-11-20-delivery-lineage-hop-fields.md` D8；#633 只核对工程验收，父项和规划 Status 不自动推进。协调者只更改归档/证据并整理提交，产品与测试树须和首审字节相同。最终 push 后由独立 reviewer 重锁 head/base，检查 `gh pr view 667 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,commits,closingIssuesReferences,reviews,statusCheckRollup` 及完整 reviewThreads；当前 head 的 PR Fast Gate 必须成功，然后由评审账号重新 APPROVE、开发账号 rebase merge。历史 HTTP 404 只属于可选转发，不可略过新出现的其他失败。

- 2026-11-21 10:14 SGT：记录首审批准与人类条件授权，精简变异证据，归档实施计划；最终提交及远端门禁由上述回读规则重算。
