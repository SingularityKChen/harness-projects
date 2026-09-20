# 仓库指令与协作流程迁移 ExecPlan

> 状态：Active
> 创建：2026-09-20
> 范围：精简根指令、迁移详细规则、规范开发 / 评审 / 回复评审；不改变 CI 运行行为。

## Purpose / Big Picture

让新会话完整加载关键约束，并按任务只读一份相应操作文档。根 `AGENTS.md` 目标不超过 24 KiB，旧章节引用仍能定位；三个工作流有输入、责任、证据与停止条件，不能把示例中的模型或 merge 指令变成所有任务的授权。

## Context and Orientation

远端基线是 `origin/main@14d94757d27120526581f73451889a9b7fc07864`；本地 checkout 的 `main@8149095201c3377f2239c078f1b99cc378d2e952` 落后于远端，PR base 以远端 main 为准。远端根指令 580 行、46,975 字节；`CLAUDE.md` 是相对软链接。当前远端开放 PR 包括 #37 和 #69；#69 已 ready，当前 head 以 `gh api repos/SingularityKChen/harness-projects/pulls/69 --jq .head.sha` 的实时结果为准（本次写作时为 `e79a6cef22f361c21bf2d3ec2e272566c0aa269e`）。#37 改变工程状态同步、测试与交付计划，不改本次文档。#56–#63 已经在远端 main 的历史中合入，当前 workflow-check、rule-checks 和看板观察实现是本次文档的事实来源；不引用更早 PR 快照推断行为。

用户提供了仓库可维护性与分层 CI 两份参考材料，并在 2026-09-20 明确要求按更新后的 main 实施文档优化，提供三种协作提示词。它们是设计输入，公开文档重述适用结论，不依赖临时文件路径。

官方依据：[GPT-6 提示词迁移](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#prompting-best-practices)强调持续执行、指令冲突透明、按风险验证；[Codex 指令发现](https://developers.openai.com/codex/guides/agents-md)说明 `project_doc_max_bytes` 默认 32 KiB，这是 Codex 加载限制，不是模型上下文窗口。

## Design / Spec

选择“根规则 + 按任务读取的操作文档”。根文件保留 §0–§11 与关键子节编号，明确其委托的细则归属，避免迁移后仍宣称所有细节只能写在根文件。七条不变量、依赖矩阵、发布限制、批准范围保持有效。

备选一是继续往根文件追加提示词，会扩大截断风险；备选二是重建目录、CI 与模型路由，超出当前文档闭环，且没有实测慢测试支撑。所选方案使用现有目录与 pnpm 入口，优先减少理解一个任务需要读取的内容。

详细规则迁往 `docs/development/repository-rules.md`、`docs/development/ci.md`、`docs/development/publication.md`；开发流程在 `docs/development/workflow.md`，评审标准保留在 `docs/review/README.md` 并新增 `docs/review/mvp-review.md`，回复流程在 `docs/review/responding.md`。入口索引同步 `docs/README.md` 与 `docs/development/README.md`。CI 文档区分远端 main 已实施的 workflow、现行 W1–W7 和尚待 #10 评估的未来层；#37 仅作为未合并的依赖背景，不移植其代码。

## Global Constraints

- 依据根 `PLANS.md`，spec 与 plan 同文件；正文中文，issue 英文，提交中文 Conventional Commits。
- 在 `.worktrees/repository-guidance/`、`docs/repository-guidance` 分支工作，不改其他 worktree 或发布分支历史。
- 一 PR 为一个文档可用性闭环；代码不超过 1000 行，文档增删之和不超过 1500 行，验证命令是 `node scripts/rule-checks.mjs size origin/main`。
- 不合并 PR、不改变 `Status` 或依赖边，不把参考提示词视为执行这些动作的授权。
- 不修改包、脚本、测试、workflow、`PLANS.md` 或工具配置。没有 API 调用模型配置需要迁移。

## Plan of Work

### Batch A · 建立可评审的变更边界

读取 `git rev-parse main`、`git rev-parse origin/main`、开放 PR、官方文档与现行约定；建立同仓 issue #68，使用 `gh issue view 68 --json title,labels` 回读标题和标签。先创建 draft PR，描述用 `Closes #68`，回读 `baseRefName`、`headRefOid`、`isDraft` 与 `closingIssuesReferences`。记录 base、head 与文件 ownership。使用 `pnpm install --frozen-lockfile` 和 `pnpm verify` 建立基线，期望 exit 0。以仅含计划的提交回滚本批。

### Batch B · 迁移规则并整理三个工作流

修改 `AGENTS.md` 和 Design 指定的 docs 文件。对照旧 §0–§11 建立保留矩阵：§1–§4 的不变量 / ExecPlan；§6 的 worktree / Git；§8 的 PR / issue / 规模；§8.6 的五类公开面与 checker 入口；§9.5 的 W1–W7 和 exit code；§10 的运行时 LLM 边界、确定性自举写入、批准记录、旧写入复核和 self-hosted runner 约束。历史事故和长模板只迁移到 docs，不改变脚本行为。补充模型可用性核实、独立对抗验证、stack base / issue 关闭语义、全风险矩阵、完整 review threads、根因修复、push 后回读与 resolve 顺序。按根约定记录本批提交；整体 revert 恢复旧入口与细则。

### Batch C · 验收、整理与交付评审

测量根文件字节数，检查相对链接和旧章节锚点、`CLAUDE.md` 软链接、diff 中敏感值与总规模；逐一演练三个流程的正常、阻塞、授权不足场景。运行 `pnpm verify`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`、`python3 -c "from pathlib import Path; s=Path('docs/exec-plan/active/2026-09-20-repository-guidance.md').read_text(); required=['## Purpose / Big Picture','## Context and Orientation','## Plan of Work','## Concrete Steps','## Validation and Acceptance','## Progress','## Decision Log','## Bottom Change Note']; assert all(x in s for x in required); print('ExecPlan structure OK')"`，均应 exit 0。用脚本核对新增相对链接存在、旧 §8.6/§9.5/§10 锚点仍有去向。对最终 diff 做独立审读，修正冲突表述后回填并归档本计划，推送当前 head，回读 CI 与 PR 的 issue 关联，最后请求人类评审。文档中的写操作示例只校验结构，不为验证示例而执行未授权操作。

## Concrete Steps

1. 以 origin/main 为 PR base，确认 issue #68 的标题、标签和 PR closingIssuesReferences。
2. 用旧章节到新文档的迁移矩阵核对硬规则；对当前远端脚本运行 workflow、disclosure 和 size 检查。
3. 检查根文件不超过 24 KiB、所有新增相对链接、软链接和 ExecPlan lint；超过 1500 行文档预算时拆分而不是压缩验证。
4. 提交、push、回读当前 head 与 checks，最后只请求人类评审，不执行合并。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 根指令可加载且不漏硬约束 | UTF-8 字节数 ≤ 24 KiB；§1–§4、§6、§8.6、§9.5、§10 保留矩阵通过；软链接未变 |
| 三种工作流可操作 | 开发、评审、回复文档及场景审读记录；合并须单独有授权 |
| 新 main / #37 兼容 | 基线 SHA、开放 PR 文件对照；本次不覆盖 #37 的文件 |
| 无断链或公开面问题 | 本次新增相对链接存在；扫描 + 人工五类目检查 |
| 可验收、合并与回滚 | `pnpm verify`、PR 规模、当前 head CI、同仓 issue 关联 |

## Progress

- [x] (2026-09-20 Asia/Shanghai) 核实 `origin/main@14d9475`、本地 main@8149095、当时开放的 PR 与官方指南，创建隔离工作分支。
- [x] (2026-09-20 Asia/Shanghai) 建立 issue #68；PR #69 先以 draft 创建，完成首个可审阅文档提交后转为 ready。
- [x] (2026-09-20 Asia/Shanghai) Batch A：issue #68、ready PR #69、base/head 与文件 ownership 已建立；closingIssuesReferences 受 GitHub GraphQL 限流，REST 已回读 PR 创建结果。
- [x] (2026-09-20 Asia/Shanghai) Batch B：根规则与按需文档迁移完成，根文件 10,057 bytes。
- [x] (2026-09-20 Asia/Shanghai) Batch C：本地验证、公开面扫描、文档链接检查和 PR ready 前检查完成；等待人类评审，未合并。

## Surprises & Discoveries

- 上轮仅作调查，没有实施。当前根文件从 36,420 字节增长至 46,975；晚出现的安全条款仍有默认加载截断风险。
- 远端 main 已把 #56–#63 的工作合入并继续整理；当前事实必须从远端 main 的脚本和 workflow 读取，不能把更早 PR 快照当作规范。
- 当前工作分支基于远端 main；本地 main@8149095 是旧 checkout，不能作为 PR base。

## Decision Log

- Decision：直接实施已讨论的文档分层，并以本轮三份提示词完善流程。Rationale：用户已明确要求优化，不再为已授权的本地可逆工作增加一轮确认。Date/Author：2026-09-20 Asia/Shanghai / 人类伙伴需求、agent 落地。
- Decision：保留旧编号与关键安全规则；细则按需读取。Rationale：脚本、测试、issue 表单广泛引用 §8 与 §9，迁移不能使这些引用失效。Date/Author：2026-09-20 Asia/Shanghai / agent。
- Decision：模型名称保留为用户选择的工作流配置示例，并要求实际可用性验证。Rationale：文档不能假定宿主具备外部模型，也不能以模型替换为名绕过验收。Date/Author：2026-09-20 Asia/Shanghai / agent。
- Decision：以 origin/main@14d9475 作为 PR base，并明确本地 main@8149095 的陈旧状态。Rationale：GitHub PR 和分支保护针对远端 default branch；混用两个 tip 会把已合入规则误判为未合入。Date/Author：2026-09-20 Asia/Shanghai / agent。

## Idempotence and Recovery

只读检查可重复。创建 issue / PR 前先查询，已存在即更新，不重复创建。中断后从本文件的 Progress 与 git 状态恢复。回滚本次文档提交即可恢复旧指令；已发布的 issue / PR 记录不因 revert 消失。任何共享历史改写或清理先核对授权和目标，不执行通配清理。

## Interfaces and Dependencies

Node / pnpm 版本取 `.nvmrc` 与 `package.json`。`scripts/` 的规则枚举、退出码与现有门禁名保持不变。官方网页可读取；GitHub 写入由当前认证身份完成，只用于本任务 issue / draft PR。独立审读使用可用审读代理，本任务不要求切换开发模型或调用真实外部 Provider。

## Artifacts and Notes

预期产物是根 AGENTS、四份 development 文档、两份 review 工作流文档、docs 索引和本 ExecPlan。代码、workflow、脚本、测试、分支保护和项目字段不属于本批。#10 的 merge / weekly CI 扩展与 #67 的批准记录机械化仍由各自 issue 跟踪。

## Outcomes & Retrospective

实现与本地验收已完成；PR #69 保持 ready，下一道门是人类评审，不执行合并。分层 CI 的实际启用已有 #10 跟踪，审批记录机械化已有 #67 跟踪，本任务不宣称交付这些能力。

## Bottom Change Note

- Change Note (2026-09-20 Asia/Shanghai)：根据远端 main、用户三种提示词和 GPT-6 官方指南建立文档迁移计划；明确本地 main 与远端 PR base 的分叉，并把 CI 目标态与当前行为分开。
