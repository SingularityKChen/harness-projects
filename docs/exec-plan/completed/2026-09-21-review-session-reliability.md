# 评审会话可靠性 ExecPlan

> 状态：Active
> 创建：2026-09-21
> 范围：让 `.github/workflows/github-review.yml` 真的能创建评审会话，并且同一份代码只值一次会话。只改这一个 workflow、它的契约测试与文档；不碰任何产品包。
> 上游输入：issue #65、issue #49、`AGENTS.md` §9、`docs/development/ci.md`、`docs/review/github-runner.md`

## Purpose / Big Picture

完成后，把任意同仓 PR 标记为 ready 会产生**一次**评审会话：job 读到真实的事件负载文件、算出签名、POST 到本机端点并拿到 `202`；反复 draft → ready 不再堆出一串同样的 job。

最小成功证据（两条，缺一不可）：

```bash
# 1. 结构性证据：契约测试固定住两条性质
node --test tests/contract/github-review-workflow.test.js     # 期望 4 pass / 0 fail

# 2. 行为证据：把 workflow 里的转发脚本原样抽出，对真实端点排练
RUNNER_TEMP=/tmp GITHUB_EVENT_PATH=<真实 pull_request 负载> \
  ENDPOINT=http://127.0.0.1:3081/github DSH_GITHUB_WEBHOOK_SECRET=<本机凭据> \
  bash <从 workflow 抽出的转发脚本>
# 期望：endpoint responded: 202
```

合并进默认分支后还必须回读一次真实运行：同一 PR 连续 draft → ready 三次，`Create review session` 只出现一次运行，且该运行成功。

## Context and Orientation

### 术语

| 词 | 意思 |
|---|---|
| 评审会话 | 由 ready_for_review 事件触发、把事件负载转发给本机 DSH 端点后调度的一次 agent 评审 |
| `pull_request_target` | 用默认分支上的 workflow 定义处理 PR 事件；因此 workflow 的修复在合并前无法用真实事件验证 |
| 排练 | 把 workflow 里的转发脚本原样抽出、在本机对真实端点执行一次，作为合并前唯一可用的行为证据 |

### 当前事实（本计划开始时）

- `.github/workflows/github-review.yml` 的转发步骤把事件路径写成 `EVENT_PATH: ${{ github.event_path }}`；在这台自托管运行器上该表达式求值为空字符串，于是 `readFileSync("")` 抛 `ENOENT: no such file or directory, open ''`，job 在第一步崩掉（issue #65 记录了 2026-09-18 的连续五次失败；本轮置 ready 13 个 PR 时又复现三次）。
- `concurrency.group` 按 PR 号分组且 `cancel-in-progress: false`，分组本身不限制队列深度：反复 draft → ready 会排进多个内容相同的 job，而单台自托管运行器串行执行（issue #49）。
- 本机端点在 `127.0.0.1:3081/github` 正在监听（未签名请求返回 400），签名密钥由本机凭据提供、端点从环境变量读取。
- `scripts/workflow-check.mjs` 的 W1–W7 对本 workflow 全部通过；W5/W6 只约束"取消策略必须显式声明"，不约束分组键，因此这两条性质没有现成规则覆盖。

## Design / Spec

### D1. 负载路径只来自运行器导出的环境变量

`GITHUB_EVENT_PATH` 是运行器为每一步导出的真实路径；workflow 表达式里的事件路径在这台机器上不可靠。因此：

1. 脚本从 `${GITHUB_EVENT_PATH:-}` 取值；
2. 空路径与空文件分别被显式拒绝并打印 `::error::`，然后 `exit 1`——空路径必须是**可读的失败**，而不是一个只有空路径的 Node 栈；
3. 内联签名脚本读 `process.env.GITHUB_EVENT_PATH`。**这一点是排练抓出来的**：脚本里的 shell 变量不会继承到子进程，读 `process.env.EVENT_PATH` 会拿到 `undefined` 并抛 `ERR_INVALID_ARG_TYPE`。

### D2. 并发按 head 提交去重

`group: github-review-${{ github.event.pull_request.head.sha }}` + `cancel-in-progress: true`。语义上这是"同一份代码只值一次评审会话"，也正好是队列深度的上界：head 未变时深度恒为 1。

### D3. 两条性质由契约测试固定，而不是靠记忆

W1–W7 是通用 workflow 不变量，不覆盖这两条。因此新增 `tests/contract/github-review-workflow.test.js`：解析 workflow YAML，断言触发方式、安全姿态（顶层权限为空、不 checkout PR 代码、只接受同仓 PR）、负载来源与响亮失败、以及并发分组与取消策略。测试必须**有牙**：把任一条改回去必须让它失败。

### D4. 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 在 `env:` 里写 `EVENT_PATH: ${{ github.event_path || env.GITHUB_EVENT_PATH }}` | workflow 表达式里 `env` 上下文取的是 workflow 级变量，不是运行器环境；看起来兼容两种运行器，实际仍是猜测 |
| 把分组键改成 `github.run_id` | 每个事件都有新 run_id，等于不去重 |
| 用 `pull_request` 而不是 `pull_request_target` | 会执行 PR 分支上的 workflow 定义；自托管运行器不得跑不可信代码 |
| 只改 workflow、不加契约测试 | 这两条性质都曾经"看起来没问题"却实际失效；没有测试就会再退回去 |

## Global Constraints

- 只改 `.github/workflows/github-review.yml`、`tests/contract/github-review-workflow.test.js`、`docs/development/ci.md`、`docs/README.md` 与本文件。
- 不改变既有安全姿态：`pull_request_target`、顶层 `permissions: {}`、不 checkout、只接受同仓 PR、secret 只经 env。
- 文档发布面自查照旧；不得出现凭据或本机路径。
- 只允许 rebase merge；不自行合并 PR。

## Plan of Work

### Batch 1 · 修负载来源与队列上界（Closes #65 #49）

**最小闭环**：转发步骤从运行器导出的环境变量读负载并在缺失时响亮失败；并发按 head 提交去重且取消在先；两条性质各有契约测试与注入实验。

**涉及文件**：`.github/workflows/github-review.yml`、`tests/contract/github-review-workflow.test.js`、`docs/development/ci.md`

- [x] 去掉 workflow 表达式形式的事件路径，改为 `GITHUB_EVENT_PATH` + 空路径/空文件守卫
- [x] 内联签名脚本改读 `process.env.GITHUB_EVENT_PATH`
- [x] `concurrency` 改为 head SHA + `cancel-in-progress: true`
- [x] 契约测试 4 条；两次注入实验（改回表达式、改回 PR 号分组）都让测试变红
- [x] 排练：旧脚本 + 空路径复现 `ENOENT ... path: ''`；新脚本 + 真实负载与真实密钥得到 `202`

**验证**：

```bash
node --test tests/contract/github-review-workflow.test.js
node scripts/workflow-check.mjs
node --test tests/contract tests/integration tests/e2e
node scripts/rule-checks.mjs size main
```

**回滚**：`git revert` 本批提交；workflow 回到崩溃状态（即当前 `main` 的行为），不需要任何外部补偿。

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 转发步骤不再使用 workflow 表达式形式的事件路径 | 契约测试第二条；注入实验一 | 通过 |
| 2 | 空路径/空文件响亮失败而非 Node 栈 | 排练 B/C：`::error::` + `exit 1` | 通过 |
| 3 | 真实负载 + 真实密钥得到 202 | 排练 D：`endpoint responded: 202` | 通过 |
| 4 | 并发按 head 提交去重且取消在先 | 契约测试第四条；注入实验二 | 通过 |
| 5 | 安全姿态未被破坏 | 契约测试第一条与第三条 | 通过 |
| 6 | 门禁与体量 | `workflow-check` no findings；`size main` 在上限内 | 通过 |
| 7 | 合并后真实运行只出现一次且成功 | 同一 PR 连续 draft → ready 三次后 `gh run list` | **待合并后回读** |

## Progress

- [x] (2026-09-21) Batch 1 · 修负载来源与队列上界（#65 #49）
- [ ] (2026-09-21) 合并后回读真实运行（验收项 7）

## Surprises & Discoveries

- **Observation**：排练抓到一个契约测试抓不到的缺陷——把路径从 `env:` 挪进 shell 变量之后，内联 Node 读 `process.env.EVENT_PATH` 拿到 `undefined`，抛 `ERR_INVALID_ARG_TYPE`。**静态测试看不出这个；只有把脚本真的跑一次才会暴露。**
  **Evidence**：`/tmp/step-new.sh: ... code: 'ERR_INVALID_ARG_TYPE'`；改为读 `process.env.GITHUB_EVENT_PATH` 后同一命令输出 `endpoint responded: 202`。
  **Decision impact**：契约测试增加两条断言（必须读 `GITHUB_EVENT_PATH`、不得读 `EVENT_PATH`）；文档写明"本地排练是合并前唯一可用的行为证据"。

- **Observation**：workflow 自己的注释里出现 `${{ github.event_path }}` 会让"不得出现该表达式"的断言失败。
  **Evidence**：首次运行契约测试 `pass 3 / fail 1`，断言指向 `run` 块里的注释行。
  **Decision impact**：注释改写为不含该字面量的表述。这不是放宽断言——放宽会让一次真实回归混在注释里溜过去。

## Decision Log

- **Decision**：两条性质放进新增的契约测试，而不是扩成 W8/W9。
  **Rationale**：W1–W7 是跨 workflow 的通用不变量，编号被 `AGENTS.md` §12 与 `docs/development/repository-rules.md` §2 引用；把两个 workflow 特有的性质塞进去会让编号的含义漂移。专用契约测试同样机械、同样有牙，且改 workflow 的人一定会看到它。
  **Date/Author**：2026-09-21 / agent

- **Decision**：合并前用"原样抽出脚本 + 真实端点排练"作为行为证据，并把它写进 `docs/development/ci.md`。
  **Rationale**：`pull_request_target` 的定义永远取自默认分支，PR 上的改动不可能被真实事件触发；没有这条排练，"改完了"就只是静态推断。
  **Date/Author**：2026-09-21 / agent

## Idempotence and Recovery

- 契约测试与 `workflow-check` 都是只读、可重复执行的。
- 排练只向本机端点发一次请求；`x-github-delivery` 每次带时间戳，重复执行不会互相覆盖。
- 若 rehearsal 打到真实的评审规则上并意外创建了会话，撤销方式是关闭对应会话；workflow 本身没有外部副作用。
- 回滚单位是单个提交：`git revert` 后 `main` 回到"ready 事件必然崩在第一步"的状态。

## Interfaces and Dependencies

- 本机端点：`http://127.0.0.1:3081/github`，签名 `x-hub-signature-256`，事件头 `x-github-event: pull_request`，幂等键 `x-github-delivery`。
- 仓库 secret `DSH_GITHUB_WEBHOOK_SECRET`（签名用）与自托管运行器标签 `self-hosted, macos`。
- 合并后必须回读真实运行；这条依赖人类合并动作，不由 agent 触发。

## Outcomes & Retrospective

待合并后回填：真实运行是否只出现一次、是否成功、端点返回码，以及 issue #49 的验收（连续三次 draft/ready 只出现一次运行）是否成立。

## Bottom Change Note

- 2026-09-21：首次创建。原因：issue #65 让评审会话每次都在第一步崩溃，issue #49 让队列深度不受限；两者是同一段转发逻辑的两个缺陷，合成一个批次修复并补上此前不存在的契约测试。
