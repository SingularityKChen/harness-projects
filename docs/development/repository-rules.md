# 仓库规则详表

根 `AGENTS.md` 是跨任务入口；本文件承载不会放进根提示词的机械规则和证据要求。根规则与本文件冲突时，根规则更严格者优先，冲突必须记入 ExecPlan。

## 1. 发布面检查

`node scripts/rule-checks.mjs disclosure <base-ref>` 是机械判定入口。它检查四个来源：相对 base 的新增行、每个提交各自引入的新增行、commit message、以及通过 `PR_BODY` 环境变量传入的 PR 描述。workflow 中不得把事件负载直接插入 `run:`。

机械规则覆盖本机路径、内网主机名、常见 GitHub/AWS token 形状、私钥 PEM 头和 RFC1918 私网地址，并只输出打码摘要。命中“先加后删”时，树差异为零也不能放行；必须重写未发布历史，已发布历史由人类决定是否清理旧对象和 workflow run。

标题、分支名以及五类人工检查仍需人工核对：凭据、本机身份、账号个人信息、内部系统、保密字样。示例值必须使用 `<host>`、`<workspace>`、`<runner-name>` 等占位符。

## 2. Workflow 契约 W1–W7

规则实现是 `scripts/workflow-check.mjs`，契约测试在 `tests/contract/workflow-check.test.js`。规则变化必须同时更新二者和本节。

| 规则 | 约束 |
|---|---|
| W1 | 非 `jobs.<id>.uses` 的 job 声明整数 `timeout-minutes`，范围 1–15；可复用 workflow job 豁免。 |
| W2 | 精确匹配 owner/repo 为 `actions/checkout`（大小写不敏感）的 checkout step 必须设置 `persist-credentials: false`；相似名字不命中。 |
| W3 | step 和 job 的外部 `uses` 都固定到 40 位提交 SHA；本地 `./` 引用除外。 |
| W4 | workflow 顶层声明 permissions，任何层不得含 write；self-hosted 或未知 `runs-on` 形状按 self-hosted 处理，顶层权限须为空，job 不能覆盖出非空权限。 |
| W5 | push 覆盖 main 时，顶层和 job 级 concurrency 都不得使用布尔 `true` 或大小写/空白变化后的字符串 `true`；branches glob 与 branches-ignore glob 按 GitHub 语义判定。 |
| W6 | 顶层或 job 声明 concurrency 时必须显式声明 `cancel-in-progress`。 |
| W7 | workflow 顶层 `jobs` 必须是非空映射。 |

目录不存在、没有 yml/yaml、读取失败、解析失败、符号链接目标无法读取等检查器启动问题 fail closed，退出码 3；规则违规退出码 1；无 finding 退出码 0。检查符号链接时必须跟随目标。

## 3. 项目写入与状态拥有

运行时产品路径中，LLM 只能执行规则明确允许的辅助，不决定规划状态、关系语义或发布门禁。仓库自举时，agent 可以做机械推导的字段回填、索引和文档维护；`Status` 与 `blocked-by` / `blocking` 关系必须先有人类批准，批准记录点名目标字段或 issue 组合并落入所属 ExecPlan 的 Decision Log。

未找到这种具体批准的 agent 写入视为无效，应回滚或补批准；这条即时规则只约束 2026-09-18 之后新写入，历史 164 次字段写入和 18 条关系边由 issue #67 逐条复核。批准记录目前是人工复核项，不能声称脚本已保证。

自托管 runner 上凭据只经环境变量或文件描述符传递，绝不进 argv；临时文件只写 `$RUNNER_TEMP`；不调用 GitHub API 的 job 声明 `permissions: {}`；破坏性操作默认不做。

## 4. Git、PR 和 issue

工作区创建前检查 git-dir / git-common-dir、`git check-ignore -v .worktrees/` 和现有 worktree；隔离目录使用 `.worktrees/<task-slug>/`。分支前缀是 `feature/`、`fix/`、`docs/`、`chore/` 或 `project-management/`。不要直接推 main，不要自行合并；分支保护要求线性历史、PR Fast Gate、批准和 rebase merge。

执行任何 Git 操作前，先用 realpath 规范化 worktree 和目标路径，确认目标位于允许的 workspace 根目录内；拒绝 `..` 穿越、符号链接逃逸和未枚举的清理路径。涉及路径边界的实现必须有契约测试或可复制的人工检查，不能只依赖调用者自觉。

提交使用 `<type>(<scope>): <中文摘要>`，type 为 feat / fix / docs / refactor / test / chore / ci / perf；正文说明原因，末尾关联 issue。PR 描述使用 `.github/pull_request_template.md`，包含闭环、ExecPlan + Batch、Closes / Refs、真实验证证据、风险和回滚。代码 ≤1000 行、文档 ≤1500 行；用 `node scripts/rule-checks.mjs size <base-ref>` 判定。

Issue 标题格式是 `<kind>(<area>): <英文祈使句摘要>`，kind 必须是 feat / fix / docs / chore / refactor / test；area 由 `node scripts/policy-check.mjs areas` 提供。标签必须恰好一个 kind、至少一个 area、至多一个 gate；Task / Bug 表单的 Context、Scope、Acceptance criteria、References、Notes 字段必须完整。`node scripts/policy-check.mjs issue <n>` 检查 issue，`node scripts/policy-check.mjs pr <n>` 检查关联和被关联 issue；机器 PR 仅豁免关联检查。
