# CI 结构与演进

## 当前已经实施

远端 main 当前有五类 workflow：

| workflow | 触发与职责 | 门禁 |
|---|---|---|
| CI | pull_request、push main、手动运行；执行 install、typecheck、测试并发布 PR Fast Gate | PR Fast Gate 是唯一必需状态 |
| Issue policy | issue / PR 事件；检查标题、标签和 issue 关联 | advisory |
| Rule checks | PR 事件；发布面和 PR 体量 | advisory |
| Board invariants | 每日 schedule；读取 Project 工作流启停并与裁决表比较 | advisory；需要 PROJECTS_TOKEN |
| GitHub review session | ready_for_review 的 pull_request_target；只转发 payload，不 checkout PR 代码；按 head 提交去重 | 不属于合并门禁 |

Board invariants 只从默认分支按日运行，使用 Project token 读取九条内置 workflow，发现 unknown / missing / 状态偏离就失败；它不 checkout PR ref，也不进入分支保护。Review session 是特例：它运行在 self-hosted runner 上，默认分支 workflow 固定定义，权限为空，secret 只经 env 进入签名过程，响应体写 $RUNNER_TEMP。普通 PR 代码 lane 使用 pull_request；不得把 pull_request_target 用作执行不可信 PR 代码的入口。

Review session 的两条结构性质由 `tests/contract/github-review-workflow.test.js` 固定，改 workflow 必须同时改它：

- **事件负载只从运行器导出的 `GITHUB_EVENT_PATH` 读**。workflow 表达式里的运行器事件路径在这台自托管运行器上会求值为空字符串，于是 `readFileSync("")` 抛 ENOENT，job 在第一步崩掉且报错里只有一个空路径（issue #65，2026-09-20 实测三次运行全部如此）。空路径与空文件都必须先被显式拒绝并打印 `::error::`，而不是留一个 Node 栈。内联签名脚本读的必须是 `process.env.GITHUB_EVENT_PATH`：脚本里那个 shell 变量不会继承到子进程。
- **并发按 head 提交去重**：`group` 是 head SHA，`cancel-in-progress: true`。`ready_for_review` 对每次 draft → ready 都发一个新事件，按 PR 号分组不限制队列深度，单台运行器会被排满（issue #49）。同一份代码只值一次评审会话，head 未变时后来的运行取消在先的运行。

`pull_request_target` 的代价必须记住：**workflow 定义永远取自默认分支，所以这类修复在合并进 `default branch` 之前无法用真实事件验证**。合并前的证据是本地排练——把 workflow 里的转发脚本原样抽出、用真实事件负载与本机凭据对 `127.0.0.1:3081/github` 执行，期望 `endpoint responded: 202`；合并后必须再回读一次真实运行，把"本地排练通过"当成"线上已修好"是不允许的。

CI workflow 的 action 必须 pin 到 40 位 commit；checkout 必须关闭 persist-credentials；权限最小；main push 运行不能因后续 push 被取消。新增 workflow 必须同时更新 workflow-check、契约测试和本文件。

### Rule checks 的判定基线不由触发器决定

`Rule checks` 的 `size` 与 `disclosure` 两个 job 都把 `github.base_ref` 当作判定基线（体量分桶的范围、发布面扫描的范围）。因此 `.github/workflows/rule-checks.yml` 的 `on.pull_request` **刻意不声明 `branches` / `branches-ignore`**：那个过滤器不只是“哪些 PR 进入本 workflow”的准入谓词，它同时决定 `base_ref` 的取值。声明成 `[main]` 之后，能跑的时候基线必然是 `main`，`${base}...HEAD` 退化成“这个 head 分支里还没进 `main` 的全部内容”，于是栈上 PR 被量成整个栈相对 `main` 的累计（PR #95 的真实改动 900 行被报成 7837 行），而 base 不是 `main` 的 PR 完全不触发，连一次结论都没有（#83 / #88 的 head 在 73 次运行里没有出现）。两种后果的实测记录见 issue #96，防复发断言是 `tests/contract/rule-checks.test.js` 里的两条「CI 接线」测试。

`CI` workflow 目前仍保留 `pull_request: branches: [main]`，栈内 PR 因此拿不到 `Verify` / `PR Fast Gate`。放开它同时改变运行次数与门禁覆盖面，属于独立决策，尚未执行；在那之前栈内 PR 的门禁缺口按遗留项记录，不要读成“检查是绿的”。

## W1–W7

详细判定和 fail-closed 退出码见 repository-rules.md。CI 必须使 workflow-check 通过后才宣称门禁完整。解析失败、未知 jobs 结构、无 workflow 文件和空 jobs 都是检查失败，不可当作“没有需要检查的内容”。

## 合并后的演进

Merge queue / merge_group、integration、E2E 和 weekly regression 只有在仓库出现对应真实测试、耗时基线和稳定入口后才新增。新增 lane 先写 ExecPlan，证明它提供新的系统反馈；不得把同一组契约测试复制到多个 workflow 来制造覆盖率。

未来若启用 merge_group，复用 PR Fast Gate 的稳定聚合检查名，确保 required check 在 queue 中有状态上报。慢测和组合矩阵应放到非必需的 main / weekly workflow；不取消 main 的验证记录。self-hosted lane 需要隔离 workspace、临时目录、端口、数据库和子进程，并避免在长期 runner 上执行不可信 fork 代码。

CI 效率以 time-to-first-failure、队列等待、job 耗时、flake 和重复验证衡量；coverage 是风险信号，不是单独的质量目标。没有实际慢测试前不创建 weekly workflow。
