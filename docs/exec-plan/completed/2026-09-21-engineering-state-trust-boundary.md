# 工程状态信任边界 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：修掉 PR #37 上两条未解决的 P1 评审意见，把"工程状态 reconcile"的输入信任边界收敛成一条可判定的规则；不改动已解决的首轮六条修复。
> 上游输入：issue #36、PR #37 的评审线程 `PRRT_kwDOUekeas6kFYev`（`continue-on-error`）与 `PRRT_kwDOUekeas6kFYfi`（artifact 未绑定触发 run）、`AGENTS.md` §1.1、§9、`docs/review/responding.md`

## Purpose / Big Picture

完成后，`Engineering state` 这条链路的每一个输入都有明确的权威来源，且**任何"拿不到就跳过"的路径都不存在**：

- 触发这次 reconcile 的 PR 编号来自**触发 run 自身的关联**（GitHub 记录的 run↔PR 关系），而不是来自 PR 可以改写的工作流上传的内容；
- "没有信号"与"信号拿不到"是两件不同的事：前者是被准入控制有意跳过的 no-op（有日志、有理由），后者是失败（非零退出、可见）；
- 结果是：看板上的 `Engineering` 要么按当前权威快照被确认写入，要么这次运行是红的——不存在"绿的但什么都没做"。

最小成功证据：

```bash
node --test tests/contract/engineering-state.test.js    # 期望全绿，且新增用例覆盖判定表
node scripts/workflow-check.mjs                          # 期望 no findings
node scripts/rule-checks.mjs size origin/main            # 期望在上限内
```

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| signal workflow | `.github/workflows/engineering-state-signal.yml`，在 PR 上下文里运行、无 secret、无权限，只负责"唤醒" |
| consumer workflow | `.github/workflows/engineering-state.yml`，来自默认分支、持有 PAT，负责重新查询快照并写入 `Engineering` |
| 准入控制 | signal 的 job 级 `if:`：只有 COLLABORATOR / MEMBER / OWNER 的评审才唤醒消费者 |
| 触发 run | 触发本次 `workflow_run` 事件的那次 signal 运行 |

### 当前事实（本计划开始时）

- PR #37 已 rebase 到最新 `main`（head 变基后重新验证）。
- 首轮六条评审意见已解决：W3 pin、传输层逐层 fail closed、字段按稳定 node ID 定位、仓库/PR 分层报错、事件不再决定写入值、测试改为后置条件。
- **未解决意见一**：消费者的 artifact 下载步骤带 `continue-on-error: true`。下载因权限/过期/名称不匹配/瞬时 API 错误失败时，下一步 `[ -f "$SIGNAL_PATH" ]` 为假 → `exit 0` → 整个 run 绿色，而 reconcile 被静默跳过。
- **未解决意见二**：`Resolve validated PR number` 只校验 artifact 里的编号是正整数，没有把它绑定到触发 run 的 PR。signal workflow 在 PR 上下文运行、可被同仓 PR 改写，因此 artifact 是"不可执行"但**可伪造**的输入；默认分支消费者会照它去对另一个 PR 的 items 写 `Engineering`。
- 契约测试文件 `tests/contract/engineering-state.test.js` 已有 304 行，覆盖传输层、字段解析与快照映射。

## Design / Spec

### D1. 权威输入只能来自 GitHub 记录的 run↔PR 关系

`workflow_run` 事件携带 `workflow_run.pull_requests[]`，由 GitHub 依据 run 的关联写入，PR 无法伪造。消费者据此取 PR 编号，并在"恰好一个"之外的一切情况（零个、多个、非正整数）**失败**。

由此 artifact 不再承载任何权威信息，它的存在价值归零：**直接删除 signal 的上传与 consumer 的下载**。删掉一个可伪造的输入比给它加校验更强，也更少活动部件。

### D2. "没有信号"必须由证据确立，不能由"文件不存在"推断

准入控制会跳过 signal job（不可信评审者）。被跳过的 job 让 run 的结论仍是 `success`，因此消费者必须查询触发 run 的 jobs 才能区分：

| 触发 run 的 signal job 结论 | 消费者行为 |
|---|---|
| `skipped` | no-op：打印理由（准入控制未通过），`exit 0` |
| `success` | reconcile |
| 其它，或 jobs API 失败 / 返回空 | **失败**（非零退出），因为"需要的输入拿不到"不是"没有输入" |

判定表做成纯函数并由契约测试钉住，而不是散在 YAML 的 `if:` 里。

### D3. 权限仍然最小

消费者需要读触发 run 的 jobs，因此 job 级 `permissions` 从 `contents: read` 增加 `actions: read`。仍然是只读、无 write；不新增 secret；PAT 只用于 GraphQL 写入路径（不变）。

### D4. 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 保留 artifact，下载失败即失败（去掉 `continue-on-error`） | 会把"准入控制跳过了 signal job"这个合法 no-op 变成红灯，训练人忽略红色 |
| 保留 artifact，用触发 run 的 PR 编号与它比对 | 仍然保留一个可伪造输入与一次下载；校验通过的收益只是"发现伪造"，而删除它直接让伪造不可能 |
| 让 signal job 在不可信评审时 `exit 1`，用 run 结论编码准入 | 每次外部评审都产生一条红色 run；红灯常态化比 no-op 更糟 |
| 在 YAML 里用 bash + jq 写判定 | 判定表无法离线测试，而这条链路的核心正是"判定要可证伪" |

## Global Constraints

- 只改 `.github/workflows/engineering-state-signal.yml`、`.github/workflows/engineering-state.yml`、`scripts/engineering-state-signal.mjs`（新增）、`tests/contract/engineering-state.test.js`、本文件。
- 不改 `scripts/sync-engineering-state.mjs` 的写入语义（首轮六条修复已验收）。
- workflow 必须继续通过 `scripts/workflow-check.mjs` 的 W1–W7；所有外部 action 保持 40 位 SHA pin。
- 公开面自查：不得出现凭据、本机路径、内部系统名。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 输入信任边界（Closes 无：本批服务于 #36 的 PR #37）

**最小闭环**：消费者的每一个输入都有权威来源；拿不到输入即失败；no-op 有证据与理由。

**涉及文件**：`.github/workflows/engineering-state-signal.yml`、`.github/workflows/engineering-state.yml`、`scripts/engineering-state-signal.mjs`、`tests/contract/engineering-state.test.js`

- [ ] 新增 `scripts/engineering-state-signal.mjs`：纯函数 `classifySignalRun({ jobs })` 与 `selectAssociatedPullRequest({ pullRequests })`，加一个 CLI 模式（读 `GITHUB_REPOSITORY` / `RUN_ID` / `GITHUB_TOKEN`，调 REST 取 jobs，把 `decision` 与 `number` 写进 `$GITHUB_OUTPUT`）；传输层与 `sync-engineering-state.mjs` 同样逐层 fail closed
- [ ] signal workflow：删除 artifact 上传，保留准入 `if:` 与一条打印准入结论的步骤
- [ ] consumer workflow：删除下载步骤（连同 `continue-on-error`），新增"判定触发 signal"与"从触发 run 取 PR 编号"两步；`permissions` 增加 `actions: read`
- [ ] 契约测试：判定表（skipped→noop / success→reconcile / failure→fail / jobs 为空→fail / API 失败→fail）与 PR 选择（0 个→fail / 2 个→fail / 非正整数→fail / 恰好 1 个→通过）
- [ ] 注入实验：把 `skipped` 改判为 reconcile、把"多个 PR"改判为取第一个、把 API 失败改判为 no-op，三种都必须让测试变红

**验证**：

```bash
node --test tests/contract/engineering-state.test.js
node --test tests/contract tests/integration tests/e2e
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs size origin/main
```

**回滚**：`git revert` 本批提交；workflow 回到"artifact + continue-on-error"的上一版（即当前 `main` 上 PR #37 的行为），无外部补偿。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 消费者不再读取任何 PR 可改写的输入 | `grep -RInE 'upload-artifact|download-artifact' .github/` 无命中 | 通过（2026-09-21） |
| 2 | 触发 run 的 PR 编号来自 run 关联 | `PULL_REQUESTS_JSON` 取自 `github.event.workflow_run.pull_requests`，为空回退 runs API；`selectAssociatedPullRequest` 用例 | 通过（2026-09-21） |
| 3 | 准入跳过是 no-op 且有理由 | `classifySignalRun` 的 skipped→noop 用例 + `::notice::` 理由输出 | 通过（2026-09-21） |
| 4 | 拿不到输入即失败 | API 失败、jobs 为空、关联 PR 非恰好一个三类用例；对抗验证实测 CLI 在这些情形下不写任何 `GITHUB_OUTPUT` 且非零退出 | 通过（2026-09-21） |
| 5 | 判定表有牙 | 三次注入实验（skipped→reconcile、多 PR 取第一个、失败→no-op）各自变红并已还原 | 通过（2026-09-21） |
| 6 | 门禁与体量 | `workflow-check` no findings；`size` 代码 787/1000、文档 207/1500 | 通过（2026-09-21） |

## Progress

- [x] Batch 1 · 输入信任边界（2026-09-21：删除 artifact，改由触发 run jobs 与关联 PR 判定；契约测试与注入实验完成）
- [x] (2026-09-21) 分支已 rebase 到最新 `main`（`e32b86e`），工作区干净

## Surprises & Discoveries

- **Observation**：实现改对之后，**计划文档本身变成了不一致源**——`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` 的 D5 段落、一条 Surprise 的 Evidence、一条 Decision Log 与一条 Bottom Change Note 仍在描述「用 inert artifact 传递 PR 编号」。
  **Evidence**：对抗验证者用 `grep -nE 'artifact.*PR|PR.*artifact|inert artifact'` 命中 5 处；其中 D5 是设计正文。
  **Decision impact**：这正是 `PLANS.md` 把 spec 与 plan 合进一份文件要消灭的失败模式（计划变了、设计说明还在描述旧世界）。处置：D5 正文改写为当前设计；历史记录（Observation / Decision / Bottom Change Note）**保留原文并追加「订正（2026-09-21）」**，不静默改写历史。

## Decision Log

- **Decision**：删除 artifact，而不是给它加绑定校验。
  **Rationale**：artifact 里唯一的信息（PR 编号）在触发 run 的关联里已经存在且不可伪造；保留它等于保留一个需要被校验的可伪造输入，而删除它让整类攻击不存在。更少活动部件 = 更少失效点，这是本仓库反复用到的判据。
  **Date/Author**：2026-09-21 / agent

- **Decision**：把判定表放进纯函数并配契约测试，而不是写在 YAML 的 `if:` 里。
  **Rationale**：这条链路的价值在于"拿不到输入必须失败"，而 YAML 里的分支无法离线证伪；本仓库对门禁类改动的既有做法就是纯函数 + 契约测试。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 契约测试与 `workflow-check` 只读、可重复执行。
- 判定脚本的 CLI 模式只读 GitHub API，不写任何状态；写入仍只发生在 `sync-engineering-state.mjs` 的 mutation 路径，且带 `clientMutationId` 与 ack 校验。
- 回滚单位是单个提交：`git revert` 后回到上一版；看板字段不受代码回滚影响（写入是幂等的同值写）。

## Interfaces and Dependencies

- 触发事件：`workflow_run`（`Engineering state signal` 完成）与 `pull_request_target`（PR 生命周期）。
- 需要的权限：`contents: read`（checkout 默认分支）、`actions: read`（读触发 run 的 jobs）。
- 需要的 secret / 变量：`PROJECTS_TOKEN`、仓库变量 `PROJECTS_ENGINEERING_FIELD_ID`（不变）。
- 上游：#36；本计划服务于 PR #37 的两条未解决 P1 线程。

## Outcomes & Retrospective

- 判定表：signal job `skipped` 为带理由的 `noop`，`success` 为 `reconcile`，其它结论、空 jobs、缺少唯一 signal job 均失败。
- 三次注入实验均按预期让契约测试失败：A skipped 改判 reconcile；B 多 PR 取第一个；C API 失败改为 no-op。
- 与设计无偏差；workflow_run 的 jobs 与 run↔PR 关联是唯一权威输入，PR 上下文仅用于 pull_request_target 的同仓生命周期事件。

## Bottom Change Note

- 2026-09-21：首次创建。原因：PR #37 的两条未解决 P1 属于同一个根因——消费者把"PR 上下文可改写的内容"当成了权威输入，并把"拿不到输入"当成了"没有输入"。两处一起改，才能让这条链路只有一种失败形态。
