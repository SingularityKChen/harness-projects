# AGENTS.md —— harness-projects 工作约定

本文件是仓库根级指令入口。`CLAUDE.md` 是指向本文件的相对软链接；ExecPlan 格式以 `PLANS.md` 为准。根文件只保留跨任务都必须知道的导航、边界和门禁，详细流程按任务读取 `docs/` 下的文档。

## 0. 快速开始

| 任务 | 入口 |
|---|---|
| 设计、实现、验证跨步骤工作 | `docs/exec-plan/active/YYYY-MM-DD-<slug>.md`，格式见 `PLANS.md` |
| 理解架构和依赖 | `docs/architecture/`、本文件 §2 |
| 日常开发和验证 | `docs/development/workflow.md`、`docs/development/ci.md` |
| 记录长期决策 | `docs/adr/` |
| 提交 PR / 处理评审 | `docs/review/README.md`、`docs/review/responding.md` |
| 合并堆叠 PR | `docs/project-management/merge-queue.md` |
| 项目看板语义和 agent 写入 | `docs/product/board-semantics.md`、`docs/project-management/README.md` |
| 发布面与敏感信息 | `docs/development/publication.md` |
| 隔离工作区 | `.worktrees/<task-slug>/` |

## 1. 系统边界

这是一个项目交付工作台：Planning、Development、Delivery、Execution 和 Storage Provider 被显式组合，工程执行事实不能篡位规划事实。

### 1.1 不变量

任何实现、重构、依赖调整或自动化都必须保持：

1. 一个工作空间同一时刻只有一个 Planning 事实源。
2. 一个工作空间可以连接多个研发与交付提供方。
3. 规划状态与工程执行状态正交；CI、Agent、PR 合并不得默认覆盖规划状态。
4. 工程执行采用“阶段 + 并行门禁”模型。
5. 关键关联显式优先；LLM 不进入规划状态、关系语义或发布门禁控制路径。
6. 工程产物关系沿谱系传播，不反复重新识别。
7. Host 拥有权威状态，前端只是消费者。

实现级硬约束：外部写入得到 Provider ack / reconcile 前，本地不得显示权威 `Saved`；凭据只保存 secret 服务句柄，不进入 Project 数据库。

### 1.2 当前门禁

Gate E1（跨 Provider 对象身份与同步幂等性）通过前，不冻结本地数据模型 v1。当前优先交付不依赖真实 GitHub 的纵向切片。Gate R1 是 MVP 发布门禁。

## 2. 仓库地图与依赖

依赖方向：`providers/*` 与 `storage/*` → `capabilities` → `core` → `controller` → `client` → `ui-model` → `ui` → `apps/*`。`domain` 是叶子；ui 不调用 Provider；apps 只做壳。

- `packages/domain`：实体、枚举、稳定标识和关系语义，零外部层依赖。
- `packages/capabilities`：能力契约与错误模型，不 import Provider 实现。
- `packages/core`：生命周期、Provider 组合、状态策略、关系图和投影。
- `packages/controller` / `packages/client`：类型化 API、命令流、快照与重连；client 不依赖 React。
- `packages/ui-model` / `packages/ui`：展示结构与 React 页面；ui 不调用外部平台 API。
- `packages/providers/*`：能力域实现，只依赖 capabilities 与 domain，Provider 之间不互调。
- `packages/storage/sqlite`：首个 Storage 实现。
- `apps/*`：Harness/Web 壳；`tests/contract`、`tests/integration`、`tests/e2e` 按测试对象分层。

依赖边由 `tests/contract/package-boundaries.test.js` 保证。新增反向依赖、跨层跳跃或同一事实的第二个权威源，先写 ADR 和契约测试。

## 3. 文档与事实源

- 正式文档全部在 `docs/`；运行态 `.superpowers/` 和 `.worktrees/` 不进文档。
- spec 与 plan 合在同一份 active ExecPlan；完成后移到 `docs/exec-plan/completed/` 并更新 `docs/README.md`。
- 文档正文中文；代码标识符、路径和命令英文。公开 issue 标题和正文用英文。
- 上游设计输入只作为本地参考；仓库内 `docs/` 必须自包含，不能引用本机路径或内部系统。

## 4. ExecPlan

跨越设计、实现和验证的工作必须使用 ExecPlan。计划必须包含 `PLANS.md` 的全部章节，尤其是可执行的验证命令、Progress、Surprises & Discoveries、Decision Log、恢复路径和技术债务。每批遵循：对齐 → 隔离 → 实现 → 验证 → 记录 → 提交 → 汇报。计划已批准后，不为批次之间的继续执行重复询问；只有缺凭据、需求歧义或外部系统阻塞才暂停。

## 5. 执行原则（GPT-6 适配）

用户要求行动时，依据上下文推断范围并持续完成可逆工作；不要只确认能力、只给计划或在可执行时提前停下。只有缺失信息会改变不可逆操作、公开行为、安全边界、公共接口、数据迁移或高成本决策时才提问。若需要批准，先准备可审阅结果，把批准放在最后一步。

指令冲突时，用户指令优先于技能和仓库约定；仓库约定优先于普通建议。若技能导致暂停或偏离，说明具体技能路径、原文要求和它如何适用。发现事实推翻假设时更新计划和下一道门，不保护旧结论。

优先减少任务的 context radius：先搜索和定位 1–3 个核心模块，保持单一架构职责、显式状态拥有者和可定位接口；不要为满足 LOC 数字机械拆分连续算法。先跑最窄的有判别力验证，只有新失败、风险信号或跨边界变化才扩大范围。

并行只用于互不共享写入区域的调查或实现；同一架构单元由一个 owner 修改。多 agent 的模型、推理等级和任务边界由当前任务选择，不能把示例模型变成仓库默认。

## 6. 工作区与 Git

开始前检查 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain` 和 `git check-ignore -v .worktrees/`。

隔离工作区必须位于 `.worktrees/<task-slug>/`；保持任务文件集互不重叠。`main` 是唯一长期分支，工作分支使用 `feature/`、`fix/`、`docs/`、`chore/` 或 `project-management/` 前缀，名称不含工具品牌。不要直接推 `main`，不要自行合并 PR。共享历史改写、force-with-lease、复杂 rebase、worktree 清理交给 `git-expert-operations` 流程并先建立恢复锚点。

提交格式：`<type>(<scope>): <中文摘要>`，正文说明为什么，末尾用 `Closes #N` 或 `Refs #N`。每个 PR 必须关联同仓 issue，且是一个可独立验收、合并、回滚的能力闭环；代码变更 ≤1000 行、文档变更 ≤1500 行，排除锁文件和生成目录。合并时只使用 rebase merge；是否合并由人类伙伴决定。

开 PR 前、以及最终 push 前，必须先整理本地 commit：移除 debug / fixup / 临时提交，把同一批次收敛成可独立审阅的提交序列；整理后重新检查 diff、提交信息、规模和敏感信息。分支已推送时，先建立 backup ref，再使用精确的 force-with-lease 推送。最终 push 后回读远端 head、base、checks、issue 关联和 review threads；验证通过后才执行 `gh pr ready <n>`。如果 PR 已是 ready，仍需在最终 push 后重新回读，不把旧状态当作当前状态。

## 7. 发布面与外部写入

公开仓库的分支、标签、PR ref、PR 描述、commit message 和自托管日志都是发布面。提交和开 PR 前执行 `docs/development/publication.md` 的机械扫描和人工五类目检查：凭据、本机身份、账号个人信息、内部系统、保密字样。命中先改成占位符；已推送历史不要用追加删除假装修复。

本地 Git 使用 argv / library API，不拼接 shell 字符串；破坏性删除默认不做。外部写入记录 actor、目标 ProviderBinding、幂等键和结果。agent 可以执行机械推导的看板字段回填和索引维护；`Status`、`blocked-by` / `blocking` 关系必须有人类批准，批准要具体指向目标并写入所属 ExecPlan 的 Decision Log。

worktree 路径在交给 Git 操作前必须规范化为 realpath，拒绝 `..` 穿越、逃逸允许根目录和未经允许的符号链接；允许根目录、目标路径和清理范围必须逐项核对。

## 8. PR、Issue 与规模

Issue 标题是 `<kind>(<area>): <英文祈使句摘要>`；kind 与提交类型一致，area 取 `node scripts/policy-check.mjs areas`，标签是 `kind:*` 恰好一个、`area:*` 至少一个、`gate:*` 至多一个。Issue 表单在 `.github/ISSUE_TEMPLATE/`，关联检查是 advisory。

PR 描述必须包含闭环、ExecPlan + Batch、`Closes` / `Refs`、真实验证证据、风险和回滚。机器 PR 按 `user.type == Bot` 豁免 issue 关联，标题与标签规则仍适用。

## 9. 验证与 CI

日常入口：`pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure <base-ref>`、`node scripts/rule-checks.mjs size <base-ref>` 和 `git diff --check <base>...HEAD`。

按改动风险选择最窄有效证据：文档只执行文档命令和链接检查；包行为跑相关测试；边界跑 `boundaries`；配置或门禁变更跑 `pnpm verify` 加相应检查；身份、持久化、并发、安全和外部写入再扩大到集成 / E2E 或人工回读。不要把“测试通过”当成完整产品闭环证据。

`PR Fast Gate` 是分支保护唯一必需检查。它由聚合 job 发布，不 checkout PR 代码、不读 secrets，只汇总执行 lane。现有 CI 与每个 workflow 的 W1–W7 约束以 `.github/workflows/`、`scripts/workflow-check.mjs` 和 `docs/development/ci.md` 为准；新增 workflow 必须同步规则、契约测试和文档。workflow 解析、目录、jobs 映射等未知情况 fail closed。

## 10. 三类协作工作流

- 开发：先读 `docs/development/workflow.md`，建立 facts / constraints / assumptions / invariants，形成 ExecPlan，开 draft PR 并 link issue，再按 disjoint ownership 并行实现，最后由指定验收者重构和验证；未经人类评审不得合并。
- MVP 评审：先锁定 PR head/base、所有线程和真实 checks，建立 P0/P1/P2/P3 风险矩阵，再分层查代码、产品、架构、测试和 issue 验收；一次性提交 inline 意见，不因首个 P1 提前收工。见 `docs/review/mvp-review.md`。
- 回复评审：先判断意见是否属实及是否改变系统不变量，再按根因修改，补判别性测试，整理 commits、push 后回读当前 head，逐条回复并 resolve thread；不能用表演式同意代替证据。见 `docs/review/responding.md`。

## 11. 参考入口

`PLANS.md`、`docs/README.md`、`docs/architecture/README.md`、`docs/development/README.md`、`docs/development/repository-rules.md`、`docs/development/ci.md`、`docs/development/publication.md`、`docs/review/README.md`、`docs/review/mvp-review.md`、`docs/review/responding.md`、`docs/project-management/merge-queue.md`。

## 12. 旧章节兼容映射

历史 ExecPlan、脚本注释和外部引用仍可能使用旧编号；这些编号的当前规范落点如下，避免引用静默失效：

| 旧引用 | 当前规范 |
|---|---|
| §1.3 | 本文件 §1.1 不变量 |
| §2.2 | 本文件 §2 依赖方向 |
| §3.3 | 本文件 §3 文档与事实源 |
| §5.1 | 本文件 §4 ExecPlan 批次与 docs/development/workflow.md |
| §6.2 | docs/review/README.md §2 证据选择 |
| §8.2 | 本文件 §6 提交格式 |
| §8.3 | 本文件 §6/§8 与 docs/development/repository-rules.md §4 |
| §8.6 | docs/development/publication.md 与 docs/development/repository-rules.md §1 |
| §8.7 | docs/development/repository-rules.md §4 Issue 规则 |
| §9.2 | 本文件 §9 风险驱动验证 |
| §9.5 | docs/development/repository-rules.md §2 W1–W7 |
| §10 | 本文件 §7 发布面与外部写入；`docs/development/repository-rules.md` §3 项目写入与状态拥有；其中自托管 runner 安全边界见 `docs/development/ci.md` 与 `docs/review/github-runner.md` |
