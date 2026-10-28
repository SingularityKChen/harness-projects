# PR #433 MMP 交付评审

> 状态：评审与本地收尾完成；创建：2026-10-28。该记录随本 PR 交付；远端交付以最终 head 回读为准。

## Purpose / Big Picture

验证 `fix(client): 隔离过期快照并保留真实宿主代际` 构成可独立验收、合并和回滚的 MMP 能力闭环。测试通过只是证据之一，必须同时核对产品结果、状态拥有、失败恢复和 issue 验收。

## Context and Orientation

观察于 2026-10-28：PR #433，head `51089898ee33d215992ef91fb7f08131d0c45965`，base `main@4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`，执行上下文为 `.worktrees/client-snapshot-ordering`、分支 `fix/client-snapshot-ordering`。关联 issue #218。易失事实重算：`gh pr view 433 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,mergeStateStatus,statusCheckRollup,closingIssuesReferences`，并完整读取 review threads。

## Design / Spec

先建立以下风险矩阵，再检查 diff、上下文、正常/失败路径、反例和验收。使用 Superpowers、Qian Systems Router、First Principles Development；子评审 gpt-6.1-sol 高推理，主评审综合裁决。替代方案为只读 diff 或只采信绿 CI，因无法证明产品闭环而不采用。

| 级别 | 风险假设 | 检查层与判定证据 |
|---|---|---|
| P0 | 打开库破坏数据、合并破坏 main、安全或硬约束失守 | 原子性、拒绝前后数据/结构、公开面、依赖和当前门禁 |
| P1 | 权威事实回退、异请求重放、跨代/并发失序、闭环核心失败 | 用户入口到 Host/Storage/Provider 的完整因果路径、反例、恢复、issue 验收 |
| P2 | 非核心错误处理或体验、测试判别力与验收遗漏 | 失败路径、反例、base/head 对照、现有 issue 承接 |
| P3 | 文档、命名与可维护性问题、设计复杂度不相称 | 设计取舍、重复实现、证据可复现与范围 |

## Global Constraints

首轮子评审只写本记录；后续主评审按本次授权更新本记录、所属 ExecPlan及 TD-059 技术债记录，产品与测试 blob 保持不变。遵守七条不变量，规划 Status 与依赖关系不随工程事件变更。评审账号 `gh-review`，开发和合并账号 `gh`。证据不写本机绝对路径或敏感信息。

## Plan of Work

### Batch 1 · 独立分层评审

检查代码、产品闭环、架构、测试、反例、issue 验收与重复追踪；锁定全部线程和 checks。命令在上述分支根目录执行：`git diff 4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc...HEAD`、受影响测试、`pnpm run boundaries`。预期为有判别力的证据及每项明确裁决。

### Batch 2 · 统一评审与收尾

主评审一次性提交全部 inline；P0/P1 则 REQUEST_CHANGES 并核实实现 owner，P2/P3 或无问题则 APPROVE 并按本次人类授权修复、独立复评、归档、整理提交与 rebase merge。最终 push 后重新锁定 head/base/checks/threads/issue。回滚：保留恢复 ref，整体撤回本 PR；不删除用户数据。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 完整矩阵和产品闭环 | 独立评审锁定上述 head/base；92 个定向用例、9 个边界用例、typecheck、5 项归因变异与 base/head 反例，见下文；主评审负责全局综合 |
| 当前 head 与线程、CI | 初审 head 全部 review threads 为空，分页已尽；PR Fast Gate、CI、Merge Gate、CodeQL 通过；可选自动派发失败已查明为本地端点拒绝连接。最终 push 后重读，不沿用初审状态。 |
| 修复与交付 | P3 仅修改 TD-059 记录；独立复评通过，最终 push 后按下文门禁回读。 |

## Progress

- [x] 2026-10-28：锁定初始 head/base，建立 P0–P3 风险矩阵。
- [x] 2026-10-28：独立评审完成代码、产品、架构、测试和 issue 闭环检查；没有确认的新增 P0/P1/P2 产品缺陷；与主评审交叉核实一项 P3 技术债收尾遗漏，见下文。未修改产品代码。
- [x] 2026-10-28：主评审完整交叉核对，Singularity-AI-Bot 一次性提交 APPROVE（review 5678411493），仅一项 P3。
- [x] 2026-10-28：P3 修复经另一子评审独立复评，无新增 findings；纠正一处测试文件归属，TD-032 与其余债务逐字不变，产品/测试 blob 未变；3 项文档契约通过。最终提交整理与远端回读按本记录门禁执行。

## Surprises & Discoveries

初审 head 的可选 `Create review session` 日志已读取，失败为 runner 无法连接本地 DSH 端点；主分支保护实时回读仅要求 `PR Fast Gate`（strict）。#433 的旧 Rule/Issue 取消有同 head success 后继，工程投影全局队列的后继在 #431/#432 成功；这些状态不充当产品验收。

### 独立评审证据（2026-10-28，锁定 `51089898ee33d215992ef91fb7f08131d0c45965`）

以下命令均在检出 `fix/client-snapshot-ordering` 的 `.worktrees/client-snapshot-ordering` 根目录运行；base 为 `4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc`。采用 Qian 的接口与反馈检查、First Principles 的权威事实与失败边界分析；Superpowers 的子任务入口明确允许子评审跳过再次分派，验证先于结论。

| 层 / 风险 | 审查结论与判据 |
|---|---|
| P0 / 架构硬约束 | 无新增反向依赖、Provider 调用、Storage 写入、数据库迁移或规划状态写者。`pnpm run boundaries` 9/9、`node_modules/.bin/tsc --noEmit` exit 0；client 无 React 依赖。 |
| P1 / 迟到与恢复 | `operation` 在 connect/reconnect/poll 开始、disconnect 和有效 receive 后失效旧 pull；内部 poll 不调用公开 receive。旧成功/异常均不能改 rows/header/time/connected；poll 单飞与 Promise identity 清槽避免 watch 已消费而本地未接受。有效 receive 关闭旧 Transport，下一次 pull 从当前 store 游标重建。 |
| P1 / 代际与信任边界 | production token 来自按 CoreApi 对象索引的私有 WeakMap；同 Core 多 controller、物理重连稳定，新 Core 不同。baseline 才允许跨代低 revision；delta/metadata 同代校验；watch 在修订比较前切 gap。真实 Host 装配与 RemoteStream 消费者测试同时验证重组，不以人工 token 代替生产证据。 |
| P1 / 一致读取 | Core 原有事务扩展到 descriptor、仓库与引用；route 的 Storage 显式为 tx；Controller 仅一次 `getPlanningSnapshot()`。Fake/SQLite writer 屏障同时检验旧 rows/identity/sync/revision/descriptor/reference，根 metadata 读取数为零。authority 来自固定 controller 配置。 |
| P2 / 产品闭环与故障 | reconnect 当刻 stale、当前失败保留内容/引用/时间和安全原因，degraded/partial 的确认时间语义保持；redaction 断言覆盖 title/body/externalId/externalKind/planningFields。stream 物理代与 Host generation 分工明确，refresh 命令仍只保存交互状态，由 watch 发布确认事实。 |
| P3 / 设计与范围 | 两层 fence 分别约束 sync 接受权和 Transport seed/watch，职责不重复；利用现有事务补齐本地读域，没有新增调度器、持久 epoch 或兼容 adapter，复杂度与实测故障匹配。required generation 的 producer、DTO 转换、stream、metadata 白名单和夹具已一起迁移。 |
| 工作项 / 验收 | 逐项读 #218 本文与维护者评论，确认新代际/低 revision、disconnect 后迟到成功/失败、redaction 和已有 reconnect stale 的命名用例；历史 Planning triple 已由 #361/#412 承担，本 PR 只补 metadata 读域，不重复声称该旧机制为新交付。#216 是父级闭环，未因本 PR 推定全部完成。 |

运行结果：

- `node --test tests/e2e/client-sync.test.js tests/e2e/client-stream.test.js tests/e2e/workspace-stream.test.js tests/integration/planning-snapshot.test.js`：42/42 pass，0 fail/cancel/skip。
- `node --test tests/e2e/workspace-read-assembly.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-planning-mapping.test.js`：50/50 pass，0 fail/cancel/skip；包含同一个 remote 跟随新 Core、旧 baseline 屏障排空、映射激活失败及重试。
- `node_modules/.bin/tsc --noEmit`、`pnpm run boundaries`、`git diff --check 4be26d55e7d921676b79ad5abc1bbc2b2a4b71cc...HEAD`：全部 exit 0；边界 9/9。

独立运行态探针为 `.superpowers/review-433/probe.mjs`，日志与变异 spec 保存在同目录，不属于交付文档。base/head 均用各自生产 sync/store 模块：旧 poll 悬挂 → 新 reconnect 成功 → 旧 poll reject，base 回报 rejected 且 `connected=false`（探针 exit 1），head 回报 idle 且保持新连接（exit 0）。head 的第二反例在 pending reconnect 期间接受同 revision degraded metadata，旧基线随后结算 idle，`reason=unavailable` 保持。该探针只验证本地时序，不宣称真实网络或 hosted CI。

`node scripts/review-mutate.mjs .superpowers/review-433/mutations.json` 在最终产品树完整运行一次，exit 0；每项都含 `killedBy`，脚本验证基线和逐字节还原后的基线为绿：

| 变异 | 结果 | 实际 killedBy |
|---|---|---|
| M1 删除 baseline 接受前 ticket fence | KILLED | `迟到基线不能越过 disconnect`，并击中旧 success/metadata/redaction |
| M2 让过期异常继续 lose | KILLED | `过期成功与失败不能覆盖新重连：failure` |
| M3 旧 fetch 无条件发布 seed/关闭 watch | KILLED | `过期 Transport seed 不得关闭当前 watch` |
| M4 删除 watch generation 比较 | KILLED | `Host generation 在 revision` 的 0/1/2 三项 |
| M5 metadata 逃逸一致读到根 Storage | KILLED | Fake/SQLite `snapshot holds one read scope` 两项 |

范围边界：malformed frame 的既有全面校验由 #312 承担，browser runtime 依赖由 #308 承担；未将它们作为本 PR 新缺陷。Core 的 projectTitle 内存显示名仍不承诺与 Storage 提交原子一致，计划已明确；本次证明的读域为 Planning triple、存储 descriptor/仓库引用与固定 authority。尚须由主评审完成当前远端 head/base、全部线程、CI、公开面、规模与 issue 勾选的统一回读。

### 完整发现清单

- **P3 · 同步关闭已解决的 TD-059**。建议 inline 锚定本 PR 新增的 `docs/exec-plan/completed/2026-10-28-client-snapshot-ordering.md:173`（“全部 AC 已完成独立验收”收尾结论）。`docs/exec-plan/tech-debt-tracker.md:56` 的 TD-059 仍为 Open，且明确称 generation 建立后 metadata 永远被拒、仍待 #218。本 PR 的 `packages/client/src/store.ts:61` 已将 generation 加入 metadata 白名单，并用生产 Host token、跨代 reset 和 metadata 用例验证该机制；追踪表因未收尾而与实现及已完成计划相矛盾。归因：base 已有真实技术债，本 PR 解决了产品根因，遗漏的是随交付同步事实记录；无运行时风险，不阻塞。修复仅需将既有 TD-059 标为 Resolved，保留历史文字并追加本计划、日期与具名用例证据；继续由 #218 承担，不新建 issue。TD-024 已 Resolved；TD-032 尚有 #202 的通用换源范围，保持 Open。

## Decision Log

- 2026-10-28：本 PR 无 P0/P1，按人类本会话直接授权，由主评审承担后续收尾与 rebase merge。原实现者会话「筛选迭代紧急重要 issues」仅接回 #431 的 P1，不并行修改本分支。初审后的变更只为证据与 TD-059，产品/测试零改动。

- 2026-10-28：人类在本会话明确要求评审 #431–#433，且“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续”，包含“修复 → re-review → 归档 ExecPlan → … → merge_method=rebase 合并”。本次授权只覆盖这三个 PR；存在 P0/P1 且有实现会话则交回该会话。

## Idempotence and Recovery

评审前后校验 immutable head；head/base 变化则旧结论失效。未核实的问题不 resolve。已发布历史整理前建立 backup ref，使用精确 lease。禁止自动修改规划 Status 或依赖关系。

## Interfaces and Dependencies

GitHub API/CLI、现有 worktree、pnpm 工具链和评审账号；外部写入记录 actor、目标仓库/PR、head、review 事件和结果。

## Outcomes & Retrospective

初审完整矩阵已完成，仅 TD-059 收尾 P3，无运行时缺陷。三 PR 六种合并顺序均得 tree `eba0400d`；在 `test/iteration-8-9-integration@5792f2a` 运行 `pnpm verify`，2226 主测试 + 7 MVP 全通过，其产品/测试 blob 与该并集完全一致，仅一份计划文本不同。该结果只证明初审产品树的组合；#431 另有已独立复现的 P1，已交回原实现会话修复，不能以组合绿测试代替准入反例。最终交付门为当前 head/base/checks、全部线程、issue 关联和公开面回读。

## Bottom Change Note

- 2026-10-28：在逐文件审查前建立矩阵、边界和授权记录。
- 2026-10-28：补独立审查的 92 项定向测试、9 项边界、base/head 探针与 5 项归因变异证据；与主评审交叉核实 TD-059 的 P3 收尾遗漏。

- 2026-10-28：主评审登记首轮 review、组合验证、基础设施红/取消归因及本会话收尾授权。

- 2026-10-28：P3 文档修复经交叉复评，校正测试引用后无新增问题；TD-032 和其余债务不变，产品/测试零改动。

- 2026-10-28：#432 已合并为 `dcad6232`，本分支无冲突 rebase 到该 main；本 PR 产品/测试补丁未变，整树与 main 加初审 #433 的 merge-tree 产品/测试 blob 完全一致。此前“产品/测试 blob 未变”指本 PR 的独占修改范围，最终整树重新验证。

- 2026-10-28：rebase 后使用仓库固定 `npm exec --yes --package=pnpm@10.28.2 -- pnpm verify` 重跑，2199 主测试 + 7 MVP 全通过；五项具名归因变异整表重跑全部 KILLED、还原基线通过。默认 pnpm 11 曾在测试启动前因安装布局不匹配中止，未改源码或依赖；该环境失败未计为产品测试结果。
