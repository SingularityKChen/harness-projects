# PR #432 MMP 交付评审

> 状态：评审与本地收尾完成；创建：2026-10-28。该记录随本 PR 交付；远端交付以最终 head 回读为准。

## Purpose / Big Picture

验证 `fix(core): 将开始工作幂等键绑定首次请求` 构成可独立验收、合并和回滚的 MMP 能力闭环。测试通过只是证据之一，必须同时核对产品结果、状态拥有、失败恢复和 issue 验收。

## Context and Orientation

观察于 2026-10-28：PR #432，head `2ae41668fc26798cf8de977bb22e727c2a29fce5`，base `main@4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`，执行上下文为 `.worktrees/start-work-request-binding`、分支 `fix/start-work-request-binding`。关联 issue #194。易失事实重算：`gh pr view 432 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,mergeStateStatus,statusCheckRollup,closingIssuesReferences`，并完整读取 review threads。

## Design / Spec

先建立以下风险矩阵，再检查 diff、上下文、正常/失败路径、反例和验收。使用 Superpowers、Qian Systems Router、First Principles Development；子评审 gpt-6.1-sol 高推理，主评审综合裁决。替代方案为只读 diff 或只采信绿 CI，因无法证明产品闭环而不采用。

| 级别 | 风险假设 | 检查层与判定证据 |
|---|---|---|
| P0 | 打开库破坏数据、合并破坏 main、安全或硬约束失守 | 原子性、拒绝前后数据/结构、公开面、依赖和当前门禁 |
| P1 | 权威事实回退、异请求重放、跨代/并发失序、闭环核心失败 | 用户入口到 Host/Storage/Provider 的完整因果路径、反例、恢复、issue 验收 |
| P2 | 非核心错误处理或体验、测试判别力与验收遗漏 | 失败路径、反例、base/head 对照、现有 issue 承接 |
| P3 | 文档、命名与可维护性问题、设计复杂度不相称 | 设计取舍、重复实现、证据可复现与范围 |

## Global Constraints

首轮子评审只写本记录；后续主评审按本次授权更新本记录、所属 ExecPlan，产品与测试 blob 保持不变。遵守七条不变量，规划 Status 与依赖关系不随工程事件变更。评审账号 `gh-review`，开发和合并账号 `gh`。证据不写本机绝对路径或敏感信息。

## Plan of Work

### Batch 1 · 独立分层评审

检查代码、产品闭环、架构、测试、反例、issue 验收与重复追踪；锁定全部线程和 checks。命令在上述分支根目录执行：`git diff 4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc...HEAD`、受影响测试、`pnpm run boundaries`。预期为有判别力的证据及每项明确裁决。

### Batch 2 · 统一评审与收尾

主评审一次性提交全部 inline；P0/P1 则 REQUEST_CHANGES 并核实实现 owner，P2/P3 或无问题则 APPROVE 并按本次人类授权修复、独立复评、归档、整理提交与 rebase merge。最终 push 后重新锁定 head/base/checks/threads/issue。回滚：保留恢复 ref，整体撤回本 PR；不删除用户数据。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 完整矩阵和产品闭环 | 独立评审已完成：源码、367 项相关测试、4 个独立故障探针及 8 项归因变异，未发现新增 P0–P3；主评审综合裁决待完成 |
| 当前 head 与线程、CI | 初审 head 全部 review threads 为空，分页已尽；PR Fast Gate、CI、Merge Gate、CodeQL 通过；可选自动派发失败已查明为本地端点拒绝连接。最终 push 后重读，不沿用初审状态。 |
| 修复与交付 | 无产品修复；补评审证据，收尾文档交叉复评无问题；最终 push 后按下文门禁回读。 |

## Progress

- [x] 2026-10-28：锁定初始 head/base，建立 P0–P3 风险矩阵。
- [x] 2026-10-28：独立评审完成，源码、相关回归、独立故障探针、变异与依赖边检查通过，具体证据见下节。
- [x] 2026-10-28：主评审完整交叉核对，Singularity-AI-Bot 一次性提交 APPROVE（review 5678411084），无 inline。
- [x] 2026-10-28：独立交叉复评收尾文档，无新增 findings；产品/测试 blob 未变，ExecPlan 已归档，3 项文档契约通过。最终提交整理与远端回读按本记录门禁执行。

## Surprises & Discoveries

初审 head 的可选 `Create review session` 日志已读取，失败为 runner 无法连接本地 DSH 端点；主分支保护实时回读仅要求 `PR Fast Gate`（strict）。#433 的旧 Rule/Issue 取消有同 head success 后继，工程投影全局队列的后继在 #431/#432 成功；这些状态不充当产品验收。

### 独立评审证据（2026-10-28，锁定 head `2ae41668fc26798cf8de977bb22e727c2a29fce5`）

评审方法：按 Qian 的系统接口与控制点视角、First Principles 的事实/约束/未知分离以及 Superpowers 的证据先于结论原则，审查“调用方请求 → Host 首次认领 → Storage 耐久绑定 → Development 供应 → context/run 观察”的闭环。关键未知是同键不同请求是否可能先触发 `existingResult` 的本地修改，或两个不同 context 在首次未见账本时都获准供应。源码与下列反例测试均未发现新增缺陷；这不是对 R1、真实 Provider 或更大未知写入边界的接受。

| 风险层 | 独立审查及裁决 |
|---|---|
| P0 / 架构与安全 | 指纹留在现有 `mutation_attempt`，未新增第二个权威账本；规划状态不变；Provider ack 前仍不报权威 Saved。原子事务不调 Provider，跨包依赖检查 9/9。未发现新增 P0。 |
| P1 / 请求、并发与恢复 | `start-work-request.ts:6–23` 在首个 await 前复制声明字段，以固定 JSON 元组绑定完整 actor、workspace/binding、workItem/repository、显式 branch/path；`start-work.ts:84–89` 先比身份和目标再观察；`:199–223` 事务重读 key、复核 route、写 Pending 与父行/context；`:262–264` 仅推进原 receipt 状态。双 SQLite 句柄、Pending/branch-ack/settled 真重开、异请求零修改均有判别性证据。未发现新增 P1。 |
| P1 / 供应目标与状态拥有 | `provisionGit` 使用 admission route；在提交后加入另一 binding 的竞争测试证明不改道；只读 create 权限仍允许观察。Pending 精确重放只读 context/run，租约过期也不接管；恢复仍要求新 key。Failed/Unknown 不因 context Ready 被提升，ack 后本地失败仍 Unknown。 |
| P2 / 测试与产品闭环 | 修改既有 fixture 时保留 ack 后失败的故障阶段和 Unknown/Ready/run-gap 断言，Pending 新增后的第二次 attempt 写确实触发 settle 故障。Controller、真实本地 Git 与独立 Provider 故障探针通过。未发现新增 P2。 |
| P3 / 设计与命名 | 专用 25 行请求模块、共享路由选择和现有事务足以闭合本次范围；未扩展通用 durable replay 平台。命名仅以双向索引裁剪替换锚定回溯正则，语义表及百万内部连字符 Worker 通过。未发现新增 P3。 |

执行上下文：以下命令均在分支 `fix/start-work-request-binding` 的工作树根 `.worktrees/start-work-request-binding`、上述 head 运行；本地验证不代替 hosted CI。

| 命令 | 实际结果 |
|---|---|
| `pnpm test:file tests/integration/start-work-request-binding.test.js tests/contract/storage-contract.test.js tests/integration/start-work-names.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/execution-relation-write-schema.test.js` | 267/267，零失败/取消/跳过 |
| `pnpm test:file tests/e2e/controller-roundtrip.test.js tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-retry-identity.test.js tests/integration/start-work-step-recording.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/local-git-core-provisioning.test.js` | 100/100，零失败/取消/跳过 |
| `node --test .superpowers/review-432/probe.test.mjs` | 4/4：Fake/SQLite × 真实 Failed/Unknown；精确重放原状态、零新增变更调用；不同 actor（含分隔符、NUL、Unicode）冲突且整库快照不变 |
| `pnpm run boundaries` | 9/9 |
| `pnpm typecheck` | exit 0 |
| `git diff --check 4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc...HEAD` | exit 0 |

临时探针首次启动因评审夹具误从 capabilities 导入 `providerFail` 而失败，产品代码未执行；修正夹具后上述 4/4 通过。不将该夹具错误归为产品缺陷。运行态 spec/log 位于 `.superpowers/review-432/`，不作为正式文档内容提交。

变异执行：`node scripts/review-mutate.mjs .superpowers/review-432/mutation.json`，exit 0；所有项在最终未变的产品树整表重测一次，每项有 `killedBy`，结束时字节还原且还原后基线绿。

| 变异 | 目标断言（`killedBy`） | 结果 |
|---|---|---|
| M1 丢弃 actor.id | `first request binds every declared field` | KILLED |
| M2 把 Pending 当固定 supplied 报告 | `Pending exact replay observes` | KILLED |
| M3 忽略事务内已认领的 key | `dual handles read no attempt` | KILLED |
| M4 供应时丢弃 frozen route 再路由 | `admitted route stays frozen` | KILLED |
| M5 SQLite 不校验首次身份不可变 | `写尝试` | KILLED |
| M6 Fake 不校验首次身份不可变 | `写尝试` | KILLED |
| M7 请求保留调用方 actor 对象别名 | `validates actor and path primitives` | KILLED |
| M8 恢复多项式裁剪正则 | `valid long internal hyphen runs` | KILLED |

工作项核对：#194 两条原验收及 actor/target/binding/全部 branch/path/编码歧义/重启补充验收有上述有界自动化支持；本次不更新 issue 勾选。#306（完整 Controller envelope）与 #307（Controller live replay）当前已 Closed，相关回归通过，本 PR 没有新增第二份账本。#204 的不确定外部意图与 #420 的 stale-owner fencing、#193 的 Ready 缺口仍由既有 issue 承接，不能由本 PR 关闭或当成新发现重复开 issue；旧 schema 准入由同批 #431 / #414 承接。未发现需要新增跟踪的缺陷。

独立结论：当前 immutable head 未发现新增 P0/P1/P2/P3，无 inline finding；建议主评审在完成实时远端 head/base/checks、全部线程、issue 关联及组合证据后裁决。没有执行外部写入、产品修复、commit 或 push。

## Decision Log

- 2026-10-28：本 PR 无 P0/P1，按人类本会话直接授权，由主评审承担后续收尾与 rebase merge。原实现者会话「筛选迭代紧急重要 issues」仅接回 #431 的 P1，不并行修改本分支。初审后的变更只为证据，产品/测试零改动。

- 2026-10-28：人类在本会话明确要求评审 #431–#433，且“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，包含“修复 → re-review → 归档 ExecPlan → … → merge_method=rebase 合并”。本次授权只覆盖这三个 PR；存在 P0/P1 且有实现会话则交回该会话。

## Idempotence and Recovery

评审前后校验 immutable head；head/base 变化则旧结论失效。未核实的问题不 resolve。已发布历史整理前建立 backup ref，使用精确 lease。禁止自动修改规划 Status 或依赖关系。

## Interfaces and Dependencies

GitHub API/CLI、现有 worktree、pnpm 工具链和评审账号；外部写入记录 actor、目标仓库/PR、head、review 事件和结果。

## Outcomes & Retrospective

初审完整矩阵已完成，无新增 P0–P3。三 PR 六种合并顺序均得 tree `eba0400d`；在 `test/iteration-8-9-integration@5792f2a` 运行 `pnpm verify`，2226 主测试 + 7 MVP 全通过，其产品/测试 blob 与该并集完全一致，仅一份计划文本不同。该结果只证明初审产品树的组合；#431 另有已独立复现的 P1，已交回原实现会话修复，不能以组合绿测试代替准入反例。最终交付门为当前 head/base/checks、全部线程、issue 关联和公开面回读。

## Bottom Change Note

- 2026-10-28：在逐文件审查前建立矩阵、边界和授权记录。
- 2026-10-28：独立评审补齐源码因果路径、367 项相关回归、4 个独立探针、8 项变异、类型/边界结果与既有 issue 边界；远端/交叉裁决留给主评审。

- 2026-10-28：主评审登记首轮 review、组合验证、基础设施红/取消归因及本会话收尾授权。

- 2026-10-28：独立交叉复评确认全部章节、引用、归档索引、授权与 issue 边界；产品/测试零改动。
