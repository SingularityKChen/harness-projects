# PR #441 MMP 交付评审

## Purpose / Big Picture
判断「重复成员内容替换」是否构成独立验收、合并与回滚的 MMP 增量；绿色代码测试不能替代用户闭环与 R1/Demo 验收。

## Context and Orientation
2026-10-29 初始锁定：`fix/membership-duplicate-content@4a927e1816bcaa0a642a058c456e1fefb84ae407`，base `main@bb9a7a259ab81ca89f01d03aa837555607a74fdd`。执行上下文为检出该分支的 `.worktrees/membership-duplicate-content` 根目录。回读：`gh pr view 441 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,statusCheckRollup,closingIssuesReferences`。

## Design / Spec
先建下列风险矩阵，再逐文件检查。重点：持久化原子性、末项胜出完整记录、作用域隔离与字段清理。采用 Superpowers 独立评审、Qian 系统边界与综合、First Principles 因果与最小反例；优先证明当前交付所承诺的用户结果。

| 等级 | 预先定义的风险 | 判据与最小证据 |
|---|---|---|
| P0 | 合并即破坏 main、数据/凭据泄漏或不可恢复损坏 | diff、事实源/信任边界与破坏性路径逐项检查 |
| P1 | 严重正确性/安全/不变量缺陷，承诺的 MMP 用户结果失效 | 正常/失败路径、跨作用域/身份反例及实际调用链 |
| P2 | 非阻塞的功能或测试判别力缺口 | base/head 对照、已有 issue 与可控修复范围 |
| P3 | 非阻塞的文档、证据或维护问题 | 精确定位，避免为风格扩大设计 |

| 分层 | 评审问题 | 初始状态 |
|---|---|---|
| 代码 | 正常/失败、错误传播、幂等、恢复与反例 | 150 契约、48 集成通过；回滚/拒绝/重试/重启探针通过 |
| 产品闭环 | 完整读取→Storage 替换→完整 winner 与字段清理 | 两实现同一共享用例；同内容不同作用域保留；不改变 Saved 或规划轴 |
| 架构 | 七条不变量、依赖边、状态拥有与信任边界 | 无 adapter/schema/依赖边变化；同成员键覆盖规则保持 |
| 测试 | 相关命令真实输出、缺失故障路径、必要变异判别性 | 三变异均 KILLED，精确归因新增共享用例，原字节恢复 |
| issue/设计 | #337 验收、重复 issue 与复杂度 | #337 完整闭环；#424/#201 更广约束矩阵保留；无额外生产 guard |

## Global Constraints
评审证据仅修改本文件；生产/测试修改进入明确修复批次。评审账号 `Singularity-AI-Bot`；开发/回复/合并账号 `SingularityKChen`。2026-10-29 用户在本会话点名 #441–#443，明确授权无 P0/P1 后的修复、独立复评、归档、提交整合、issue 核对与 rebase merge；不包含规划 Status 或依赖写入。

## Plan of Work
1. 锁 head/base、全量 review threads/checks/issue 与实现 owner；按矩阵独立评审。
2. 汇总并验证所有发现后，每 PR 一次性提交一份 inline review；P0/P1 为 REQUEST_CHANGES，其余 APPROVE。
3. 按用户指定 owner 分流；修复需独立复评，最终 push 后重锁全部事实；满足门禁才以 rebase 合并。
回滚：未提交证据可删除本文件；实现修改按所属交付闭环 revert，外部写入须回读确认。

## Validation and Acceptance
初始锁定 head 上独立执行：

- `pnpm test:file tests/contract/storage-contract.test.js`：150/150；membership reconcile、storage sync surface、identity membership schema 集成三文件：48/48。
- `review-mutate.mjs` 最终整表：M7（SQLite 循环去重）、M8（Fake 循环字段清理）、M9（SQLite 循环字段清理）均 KILLED，`killedBy` 为 `duplicate-content-last-wins follows incoming order and removes displaced fields`；每项各只有对应 adapter 用例失败，源文件逐字节恢复。
- 独立反例：替换后抛错恢复完整旧成员/字段；混合 wrong-scope 批次 direct/transaction 原子拒绝；失败后重试；winner 缺省时刻、同 external id 不同 contentKind、SQLite 关闭重开均通过。
- 父评审重新执行相同反例确认跨项目 item-id 覆盖事实；注释修复后重跑 Storage 契约 150/150，独立复评再次执行反例为 ADDRESSED。
- 组合预演检出与 `test/iteration9-parallel-integration@f4387cf444e554399d00bdeed36449fd8b5403cc` 的产品/测试 blob 全等；父评审在后者重新执行 `pnpm verify`：typecheck、2459/2459 与 MVP0 7/7，`pnpm run boundaries` 9/9。此后仅新增评审记录和端口注释修正；不将代码回归当作人工 Demo/R1。

| 发现 | 严重度 | 证据与处置 |
|---|---|---|
| 新增「只影响 scope」契约过强 | P2 | 同 workspace 的另一 project 复用 itemExternalId 时，两 adapter 都迁移旧成员并保留字段；现将保证收窄到 scope 内缺失成员/字段的删除，并明确同键覆盖。无生产修改。 |

首轮 P0=0 / P1=0 / P2=1 / P3=0。评审账号一次提交 review `5693105866`，包含全部 inline 意见并 APPROVE。修复经原独立评审重新对照实现与反例，结论 ADDRESSED，无新增问题。

## Progress
- [x] 2026-10-29 锁定初始 head/base，先建立 P0–P3 风险矩阵。
- [x] 2026-10-29 完成五层独立评审、三变异及额外恢复/身份反例。
- [x] 2026-10-29 一次性 APPROVE 后修复唯一 P2，并独立复评 ADDRESSED。
- 2026-10-29 最终整理/push/门禁/合并采用本记录的回读验收；实际 merge 与 issue 状态由 GitHub 持有，不在文档复制易失值。

## Surprises & Discoveries
初始当前 head：必需 `PR Fast Gate` SUCCESS；可选 `GitHub review session` run `40805235778` 因本地端点不可达失败。Rule checks `40804084369` 与 Issue policy `40804084376` 取消，各有同 head 成功后继 `40804086487` / `40804086431`。完整 comments/reviews/threads 初始为空，无分页遗漏。

新增 scope 说明与上一行同键覆盖规则冲突，属于本 PR 新增说明而非新生产缺陷；选择收窄文档，避免把 #337 扩大成跨项目 guard 设计。

## Decision Log
- 2026-10-29：用户直接授权本批三个 PR 通过门禁后的 rebase merge，覆盖原仓库「由人类决定是否合并」要求；规划轴保持人类所有。
- 2026-10-29：实现会话「规划迭代优先 Issues」持有三条实现分支；有 P0/P1 时回交该会话；无 P0/P1 时由本评审按本次用户指令负责收尾。

## Idempotence and Recovery
每次 head/base 变化均重读 diff/checks/threads，旧结论仅保留为带 SHA 的历史。本次改写前恢复锚点为 `refs/backup/pr441-before-mmp-review-20261029`，指向初始已发布 head；以精确旧 head lease 发布，禁止覆盖其他推送。

## Interfaces and Dependencies
GitHub PR/reviews/issues/Actions；本地 Git、pnpm 与相关测试。评审提交指定 immutable head。

## Outcomes & Retrospective
首轮无阻塞项，唯一 P2 已修复并独立复评；原 ExecPlan 已位于 completed，验收和回滚边界成立。最终 head、base、checks、thread 与 issue 关闭状态均按记录中的回读命令确认；R1、#143、#236 仍不由本轮接受。

## Bottom Change Note
- 2026-10-29：在读实现前建立风险矩阵与本轮证据入口。

- 2026-10-29：补充独立测试、变异与父评审复现；记录一次性评审及 P2 根因修正、独立复评。
