# 纵向链路与 R1 门禁重述 ExecPlan

> 状态：Active
> 创建：2026-09-20
> 范围：纯文档。把"MVP-0 / MVP-1 / 首发范围"的判定方式、纵向链路的每一步、以及发布门禁 R1 的每一条，逐条重述进仓库，使 `AGENTS.md` §9 那句"门禁清单的可分发表述在 §9 与 `docs/architecture/`"为真。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/exec-plan/active/2026-09-20-mvp0-parallel-stacks.md`（控制计划）、issue #44

## Purpose / Big Picture

完成后，一个只读本仓库的人可以判定三件事，而不需要任何外部文档：

1. MVP-0 做完了没有——`node --test tests/mvp0` 全绿；
2. MVP-1 做完了没有——纵向链路的前十二步在一个 sandbox 项目上被人工走通，每一步都有仓库内的枚举与观察点；
3. 首发范围做完了没有——R1 门禁逐条列出，每条都有自己的判定证据。

最小成功证据：

```bash
git grep -n "十三步\|前 12 步\|十二条\|约二十行" -- '*.md'
# 期望：每个计数词命中处都能在同仓找到对应枚举；不再有裸计数
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| MVP-0 | 全部用离线 provider 跑通的那条链路；判定方式是 `node --test tests/mvp0` |
| MVP-1 | 同一条链路换成真实平台 provider，链路语义不变；判定方式是在 sandbox 项目上人工走通纵向链路 |
| 首发范围 | R1 门禁全部满足时具备发布资格的那个范围 |
| 纵向链路 | 从规划条目到部署可见的一串**用户可观察**步骤，不是技术分层 |

### 当前事实

- `docs/product/README.md` 把"目标与非目标"标为尚未补齐；MVP-0 的非目标因而无处可查。
- MVP-1 的判定在仓库内只以"前 12 步"这类裸计数出现，且该计数全仓只有一处命中。
- R1 门禁只在 issue #73 与讨论里出现，`docs/architecture/` 只有一个 README。
- 本栈与代码栈并行，只写文档，不碰 `packages/**`、不碰 CI。

## Design / Spec

### D1. 三份文档，各自回答一个问题

| 文档 | 回答 | 不回答 |
|---|---|---|
| `docs/product/vertical-path.md` | 纵向链路每一步是什么、用户观察到什么、MVP-0 与 MVP-1 的分界在哪里、MVP-0 的非目标是什么 | 门禁条目 |
| `docs/architecture/release-gates.md` | R1 的每一条、判定证据、谁判定 | 产品链路细节 |
| 两处 README 的索引 | 这些结论放在哪里 | 结论本身 |

### D2. 计数词必须指向枚举

任何"十三步""十二条"形态的计数，要么删除，要么指向仓库内的枚举小节。判定方式是一条 `git grep`：命中处都能在同仓找到枚举。这条规则的目的是消灭"只读仓库的人无法判定做完了没有"这个具体缺陷，而不是追求措辞一致。

### D3. 非目标是承重的另一半

MVP-0 的非目标至少包括：真实 GitHub / Git / Harness provider、SQLite 业务表、UI 页面、Backlog/Sprint/Kanban/Roadmap 等规划视图、Analytics、跨工作区全局工作项聚合、任何由 LLM 参与的状态或关系控制路径。把这些写清楚，才能让"MVP-0 做完了"不被误读成"MVP 做完了"。

### D4. 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 把 R1 门禁写进 `AGENTS.md` §9 正文 | §9 是执行门禁（CI / 合入门禁）的规范，R1 是发布资格清单，两者生命周期不同；写进 `docs/architecture/` 并让 §9 指向它更稳 |
| 只更新 issue #44 而不动文档 | issue 不是可分发表述（`AGENTS.md` §1.3）；判定必须能在 `git checkout` 出来的工作区里完成 |
| 从上游输入复制清单 | 上游输入不随仓库分发；本仓库必须自包含地重新表述 |

## Global Constraints

- 只改 `docs/**`；不改代码、不改 CI、不改 `AGENTS.md` 的既有结论。
- 不引用任何外部文档编号或本机路径。
- 文档变更 ≤ 1500 行。
- 文档正文中文，命令与路径英文。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch D1 · 重述纵向链路与 R1 门禁（Closes #44）

**最小闭环**：三份文档就位，裸计数消失，两处 README 索引指向它们。

**涉及文件**：`docs/product/vertical-path.md`、`docs/product/README.md`、`docs/architecture/release-gates.md`、`docs/architecture/README.md`、`docs/README.md`（仅在需要登记产品/架构主题文档时）

- [ ] `docs/product/vertical-path.md`：逐步枚举链路（每步：用户动作、可观察结果、失败的可见形态），并明确 MVP-0 / MVP-1 / 首发范围三者的判定方式
- [ ] 同文件补 MVP-0 非目标清单
- [ ] `docs/architecture/release-gates.md`：R1 逐条列出，每条给判定证据与判定者
- [ ] 两处 README 登记新文档
- [ ] 清理裸计数：让每个计数词指向同仓枚举

**验证**：

```bash
git grep -n "十三步\|前 12 步\|十二条" -- '*.md'    # 期望：命中处都能在同仓找到枚举
node scripts/rule-checks.mjs size origin/main        # 期望：文档行数在上限内
node scripts/workflow-check.mjs                      # 期望：no findings
```

**回滚**：`git revert` 本批提交；纯文档，无外部副作用。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 纵向链路逐步枚举且每步有观察点 | `docs/product/vertical-path.md` 的小节数与步骤表 | 待验证 |
| 2 | MVP-0 / MVP-1 / 首发范围各有不同判定方式 | 同文件的三行判定表 | 待验证 |
| 3 | MVP-0 非目标清单存在 | 同文件的 Non-goals 小节 | 待验证 |
| 4 | R1 门禁逐条可判定 | `docs/architecture/release-gates.md` 的条目表 | 待验证 |
| 5 | 裸计数消失或指向枚举 | `git grep` 命令的输出逐条核对 | 待验证 |
| 6 | 文档体量在上限内 | `node scripts/rule-checks.mjs size origin/main` | 待验证 |

## Progress

- [ ] Batch D1 · 重述纵向链路与 R1 门禁（#44）

## Surprises & Discoveries

（实现期间如实记录。）

## Decision Log

- **Decision**：R1 门禁落在 `docs/architecture/release-gates.md`，`AGENTS.md` §9 只保留指向。
  **Rationale**：§9 管的是每次改动要跑哪些检查，R1 管的是"这个版本能不能发"；把两者混在一处会让任何一次 R1 修订都变成对执行门禁规范的修订。
  **Date/Author**：2026-09-20 / agent

## Idempotence and Recovery

- 纯文档改动，验证命令只读且可重复。
- 回滚单位是单个提交：`git revert` 后仓库回到没有任何纵向链路枚举的状态。

## Interfaces and Dependencies

- 依赖 issue #44 的判据与 issue #7 的链路定义（七节点 / 五断言）。
- 与切片栈的接口：`tests/mvp0` 是 MVP-0 的判定载体，本文档必须引用它的路径而不是重述断言内容。

## Outcomes & Retrospective

完成后填写：实际落地的文档、与计划的偏差、仍然只存在于 issue 的结论。

## Bottom Change Note

- 2026-09-20：首次创建。原因：issue #44 指出仓库内无法判定 MVP-1 与首发范围；本栈把它变成两份可引用的文档。
