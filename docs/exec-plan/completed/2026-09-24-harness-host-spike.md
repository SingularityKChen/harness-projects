# 宿主承载能力探针 ExecPlan

> 状态：Completed
> 创建：2026-09-24（2026-09-24 验收后归档至 `docs/exec-plan/completed/`）
> 范围：只做**观测与记录**：宿主（host）能否承载 `packages/controller` 与一个页面；交付物是 `docs/architecture/harness-host-spike.md` 与一个 `embed` / `fallback-web` 裁决
> 上游输入：issue #125（本层的验收标准）、epic #124（本层是它的第一个子 issue）、`AGENTS.md` §1.1 不变量 7 / §2 / §7、`PLANS.md`、`docs/development/workflow.md`、`docs/development/publication.md`
> base：`origin/main`（`4d46559`）；分支：`test/harness-host-spike`
> 本文件自包含：所有引用都是仓库内相对路径或宿主运行时的服务键（`ctx.*`），不含宿主产品名与本机绝对路径（`AGENTS.md` §7）。

## Purpose / Big Picture

本产品要嵌在宿主里运行：权威状态在宿主侧，前端只是消费者（`AGENTS.md` §1.1 不变量 7）。仓库至今没有碰过宿主——`apps/harness-plugin` 只有 `packageId` 占位——所以"宿主能承载 controller 与一个页面"是**假设**，不是**观测**。MVP-1 的每一个 UI 与执行子 issue 都建在这个假设上。

完成后，世界上多出一份**可复核的记录** `docs/architecture/harness-host-spike.md`：四个承载问题逐条给出"观测到 / 未观测到 + 尝试过什么 + 失败在什么地方"，每条带确切命令或代码路径与观测时间；再加一个取值恰好为 `embed` 或 `fallback-web` 的裁决，并点名是四个答案里的哪一个决定了它。

**最小成功证据**：`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0，且记录里四个问题各自的证据行能被第三方按记录里的命令复现到同一结论。

**最大的失败模式**（本计划的首要防御对象）：把"读了宿主运行时的类型声明"写成"宿主能承载"。因此本计划把每个答案拆成两半——**机制存在**（代码路径已读）与**承载能力已实测**（真跑通）——并且裁决只跟随后者。

## Context and Orientation

**术语**

| 词 | 含义 |
|---|---|
| 宿主（host） | 本产品要嵌入的那个已安装运行时。它在仓库里已有的称呼是 `apps/harness-plugin` 的"外壳"；本计划与记录一律写"宿主（host）"。 |
| 宿主运行时根 | 本机已安装的宿主运行时包所在目录（`node_modules` 的父目录）。按 `AGENTS.md` §7，它的绝对路径不写入仓库；探针用环境变量 `HOST_RUNTIME` 传入。 |
| 宿主拥有的目录 | 宿主为它自己的用户数据解析出的根目录及其子目录。解析入口是宿主运行时里的一个库函数（见 `Design / Spec` §3 的探针 P1）。 |
| 句柄（handle） | 指向一个密钥的**名义引用**（POSIX 环境变量名形状），不是密钥本身。宿主凭据缝的 `credentialRef(name)` 产出它。 |
| 承载能力已实测 | 在真实宿主插件运行时里跑通，而不是"类型上可行"。 |

**当前状态（已在 `origin/main` = `4d46559` 上核实）**

- `packages/controller/src/index.ts`：`createController(core, options)` 需要 `CoreApi`；`baseline()` / `watch()` 构成快照 + 增量。
- `packages/client/src/transport.ts`：`createTransport(source, options)` 只消费 `baseline()` + `watch()` 的结构面，不 import React。
- `packages/core/src/context.ts`：`composeCore(deps)` 取 `deps.storage ?? deps.providers.storage`；**没有 storage 就没有 core**。
- `packages/storage/sqlite/src/index.ts`：只导出 `db.ts` / `migrations.ts` / `migrate.ts`；`migrations/001_init.sql` 只建 `schema_migrations` 记账表，业务表按注释留给 #27/#28。
- `git grep -n "implements .*Storage" -- '*.ts'`（在检出 `test/harness-host-spike` 的工作树根目录运行；不要用裸 `grep -rn … .`，它会走进被忽略的 `.worktrees/` 造成误报，见记录 §3.3 的取法纪律）只命中 `packages/providers/fake/src/storage.ts` 的 `MemoryStorage`。**`packages/storage/sqlite` 目前不实现 `Storage` 能力契约**——这是 P1 的关键前置事实。
- `packages/providers/*/src/index.ts` 里除 fake 外全部只有 `packageId` 占位；**没有任何 provider 消费凭据**——这是 P2 的关键前置事实。
- `apps/harness-plugin/`：`package.json` 只有 `exports: { ".": "./src/index.ts" }`，没有宿主插件声明字段、没有 `./client` 导出、没有构建脚本；`src/index.ts` 只有 `packageId`。
- 宿主运行时（本机已安装）：是一个依赖注入式插件框架；宿主侧插件是导出 `apply(ctx)` / `inject` 的 ESM 模块，客户端插件是包清单里声明客户端面 + 一个浏览器 bundle。可用服务键：`ctx.credentials`（凭据缝）、`ctx.connection`（浏览器 ↔ 宿主 RPC 与 Fetch 路由）、`ctx.slots` / `ctx.layout`（浏览器侧插槽与主面板选择）、`ctx.typertGateway` / `ctx.remote`（类型化 Remote 调用）。

**上游依据**：issue #125 的 Scope / Acceptance criteria 就是本层的验收表；epic #124 的 Notes 规定"若探针结论是宿主承载不了，外壳子 issue 移到 `apps/web`，且该范围变化要先回到人类伙伴"。设计批次文档（本机只读参考，不进仓库）规定：探针代码不合并、`apps/harness-plugin` 必须恢复为占位、裁决与观测强度一致。

## Design / Spec

### 1. 交付物是记录，不是代码

本层**不产出可合并的代码**。理由：issue #125 的 Out of scope 第一条就是"production-quality code; spike code that is not kept is not merged"；把探针代码留下来会让"记录"与"实现"两份事实互相污染——记录说"宿主能承载"，代码却是个只能跑一次的脚本。因此：

- 探针脚本放在 `apps/harness-plugin/.spike/`（未跟踪、提交前删除）或系统临时目录。
- 最终工作区只允许有文档改动，用 `git status --short` 证明。
- 记录里给出探针的**结构**与**逐条命令**；宿主包名映射表写死在一次性脚本里，随脚本一起删除，不入库。

### 2. 四个问题 × 两半：机制存在 vs 承载能力已实测

这是本计划的核心设计。四个问题都容易被"读类型声明"糊弄过去，所以每个答案必须分开写两件事：

- **机制存在**：宿主运行时里确有这条代码路径（服务键、导出符号、文件角色）。这是**读代码**得到的，证据是路径与符号，不是能力。
- **承载能力已实测**：在真实宿主插件运行时里跑通。这是**跑命令**得到的。

裁决只跟随"承载能力已实测"。四个问题里任何一个缺后半，答案就写"未观测到"，并写清尝试过什么、失败在什么地方。

### 3. 探针设计（P1–P4）

探针统一在一个进程里跑：用宿主运行时的插件运行时建一个 `Context`，把探针插件挂上去（`ctx.plugin(...)`），在插件体里做观测。这样"宿主侧模块"就是**真的宿主插件**，而不是一个 import 了宿主包的普通脚本。

**P1 · 宿主侧模块能否用 `packages/storage/sqlite` 在宿主拥有的目录里建库并构造 controller**

三个子观测，缺一不可：

1. 宿主插件体里解析宿主拥有的目录（宿主运行时的 home 解析库函数），在其中创建子目录并 `openDatabase(<dir>/probe.db)` + `migrate()`，断言文件真的落盘、`schema_migrations` 有 1 行。
2. 同一个宿主插件体里 `composeCore({ workspace, providers: createFakeProviders() })` + `createController(core)`，跑一次 `controller.baseline()` 与一条命令，断言返回结构。
3. **组合**：把第 1 步的 sqlite 库作为 `storage` 传给 `composeCore`。预期失败——`packages/storage/sqlite` 不实现 `Storage` 契约。失败要按"确切的错误"记录，而不是按"大概不行"记录。

**P2 · provider 能否通过宿主 secret 服务解析的句柄拿到凭据，且密钥不进入 project 数据库**

1. 在探针组合里挂宿主凭据缝与其本地文件实现，凭据文件指向临时目录；预写一个**假**密钥值（形如 `probe-secret-value`，不是任何真实凭据）。
2. `credentialRef('<NAME>')` → `ctx.credentials.resolve(ref)`，断言拿到 `{ value, source }`；再 `describe(ref)`，断言返回里**没有** value 槽位。
3. 让一个内存里的替身 provider 接收解析出的值，然后 `grep` 第 1 步落盘的 project 数据库字节，断言假密钥值**不出现**；同时 `grep -rn "credential\|secret" packages/capabilities/src packages/domain/src` 断言能力与领域契约里没有凭据字段。
4. 仓库侧"provider 消费凭据"的路径不存在（provider 全是占位）——这一半按"未观测到"记录，不按"观测到"记。

**P3 · 插件客户端能否经宿主 transport 调用 controller 的查询与命令并收到 watch 增量**

1. **宿主半边（可实测）**：探针组合里挂宿主连接服务，用 `ctx.connection.rpc.intercept('/api', matches, handler)` 把 controller 的查询与命令注册进去，再用 `ctx.connection.createSharedFetchHandler('/api')` 手工构造一个 RPC 信封 `Request`，断言拿到 controller 的查询结果。这条不需要 HTTP 服务器，是本层唯一能真跑的 transport 观测。
2. **客户端半边（预期未观测到）**：浏览器侧的调用方（`ctx.connection.rpc.call` / `ctx.remote.$mount`）只随客户端 bundle 分发；探针尝试在 Node 里加载宿主外壳的已构建 SPA，记录**确切的失败**（预期是缺少浏览器内核的 `window`）。
3. **watch 增量（预期未观测到）**：宿主的流式 Remote（`@Remote({ mode: 'stream' })` + `ctx.remote.$stream()`）需要生成物描述符与浏览器载体；探针记录这两者各自的缺失点。

**P4 · 插件能否在一个 slot 里挂载一个页面**

1. 机制存在：宿主客户端运行时确有插槽注册面（`ctx.slots.inject(name, fn)` + `ctx.slots.register(descriptor, Component)`）与主面板选择面（`ctx.layout.selectPanel(id)`），并能在已安装的客户端插件里读到真实注册样例。证据是包内路径与符号。
2. 承载能力已实测：预期**未观测到**。三个具体缺口：插槽注册表只随宿主外壳的已构建 SPA 分发（不在可 import 的运行时包里）；客户端 bundle 必须由构建步骤产出（本仓库没有打包器，且本层禁止新增依赖）；渲染需要 React 与浏览器 DOM。探针逐条记录证据。

### 4. 裁决规则（先写死，避免事后解释）

| 观测结果 | 裁决 |
|---|---|
| 四个问题全部"承载能力已实测" | `embed` |
| 任何一个缺"承载能力已实测" | `fallback-web`，并点名缺的那一个（若多于一个，点名**最直接决定"能否嵌进去"**的那一个） |

`fallback-web` 时**必须**在 epic #124 上留一条评论，点名所有范围会变的子 issue，且必须在任何子 issue 开工之前发出。本批次里 #128 是 #124 的子 issue，它的 ExecPlan 必须记下这条评论的结论。

### 5. 被放弃的方案

- **把探针做成可合并的 `apps/harness-plugin` 实现**：放弃。issue #125 明确 spike 代码不合并；而且它会让记录与实现两份事实互相污染。
- **真的启动一个宿主应用（含 Web 服务）并用浏览器驱动**：放弃。原因有三：(a) 本机已有一个正在运行的宿主实例，再起一个会争用端口与用户数据根；(b) 需要把本仓库的插件装进宿主的组合，这要改本机用户数据根里的 profile 与补丁文件，属于对运行态的破坏性写入；(c) 时间盒内无法把"插件包缺客户端 bundle 与构建步骤"这件事补上，而这正是 P4 要观测的缺口。放弃的是**手段**，不是问题：P4 的缺口用可复核的静态证据 + 一次真实加载尝试的失败输出记录。
- **用假 DOM 在 Node 里跑客户端 bundle**：放弃。那不是宿主的真实载体，跑出来的绿是假的；本计划的全部价值在于不把推测写成观测。

### 6. 关键不变量

1. 记录里每一条"观测到"都能指到一条命令或一个符号，并带时间；每一条"未观测到"都带尝试与失败原因。
2. 裁决的取值只由 `Design / Spec` §4 的表决定，不由"希望 MVP-1 长什么样"决定。
3. 记录里不出现 token、密钥、宿主产品名、本机绝对路径。
4. 探针不合并；`apps/harness-plugin` 最终与 `origin/main` 逐字节一致。

## Global Constraints

- **本层改动的文件集合**（只此一份，`Plan of Work` 与 `Progress` 不复述）：新增 `docs/architecture/harness-host-spike.md`、新增本计划（落盘时在 `docs/exec-plan/active/`，验收后随本次归档移入 `docs/exec-plan/completed/`）、改 `docs/README.md`（索引表插一行，归档时从 Active 移到 Completed）、改 `docs/architecture/README.md`（主题文档索引插一行）。**不改任何 `packages/**`、`apps/**`、`scripts/**`、`tests/**`、`pnpm-lock.yaml`。**
- 代码 ≤1000 行、文档 ≤1500 行，按 `origin/main` 度量（`node scripts/rule-checks.mjs size origin/main`）；本层预期全是文档。
- 不新增依赖；不改 `pnpm-lock.yaml`；不改 `packages/**` 的行为。
- 沙箱下所有 pnpm 命令带前缀 `npm_config_manage_package_manager_versions=false`。
- 文档正文中文；代码标识符、路径、命令英文。
- 仓库文件里不写凭据、账号、内网信息、本机绝对路径、宿主产品名。宿主一律写"宿主（host）"；宿主运行时的包按**角色**指代（如"提供凭据缝的包"），不写包名。
- 不 push `main`；不自行合并；PR 保持 draft。
- 只在本工作树（`.worktrees/w13-d3a`）里改文件。

## Plan of Work

### Batch 1 · 计划与 PR 骨架

**最小闭环**：本计划进入 `docs/exec-plan/active/`，两个索引表各多一行，计划提交并推送，draft PR 建立且 issue 关联非空。
**涉及文件**：本计划（Batch 1 时落盘在 `docs/exec-plan/active/`，验收后归档到 `docs/exec-plan/completed/`）、`docs/README.md`、`docs/architecture/README.md`。

- [ ] 写本计划（spec + plan 合一）。
- [ ] `docs/README.md` 的 Active 表插一行；`docs/architecture/README.md` 的主题文档索引插一行。
- [ ] 提交 `docs(exec-plan): 为宿主承载能力探针写计划`，`git push -u origin test/harness-host-spike`。
- [ ] `gh pr create --draft --base main --title 'test(apps): 证明宿主能承载 controller 与一个页面' --label kind:test --label area:apps --label area:architecture --milestone 'M4 · MVP-1 真实 GitHub 纵向切片' --body-file <文件>`。
- [ ] 回读 `gh pr view <n> --json number,url,baseRefName,headRefOid,isDraft,labels,milestone,closingIssuesReferences` 与 `gh issue view 125 --json closedByPullRequestsReferences`。

**验证**：`gh issue view 125 --json closedByPullRequestsReferences` 的数组非空（期望包含本 PR）。为空就停下并报告。
**回滚**：`git reset --hard origin/main` 后删除远端分支；本批次不碰任何非文档文件。

### Batch 2 · 跑 P1–P4

**最小闭环**：四个问题各自落到"观测到 / 未观测到 + 原因"，每条都有确切命令与输出。
**涉及文件**：只在 `apps/harness-plugin/.spike/` 下建未跟踪的一次性脚本（提交前删除）；不改任何已跟踪文件。

- [ ] 建探针脚手架：`HOST_RUNTIME` 环境变量 → 宿主运行时根；按角色解析宿主包（映射表写死在脚本里）。
- [ ] P1 三个子观测；P2 四个子观测；P3 三个子观测；P4 两个子观测。
- [ ] 每条观测记录：命令、退出码、关键输出片段、时间（UTC）。
- [ ] 观测完立刻删掉 `.spike/`，用 `git status --short` 确认只剩文档改动。

**验证**：`git status --short` 只有 `docs/` 下的改动；`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0。
**回滚**：删 `.spike/` 即回到 Batch 1 的状态（探针从不入库，无历史可回滚）。

### Batch 3 · 写记录、给裁决、按需在 #124 留评论

**最小闭环**：`docs/architecture/harness-host-spike.md` 逐条满足 issue #125 的四条验收标准；裁决按 `Design / Spec` §4 得出。
**涉及文件**：`docs/architecture/harness-host-spike.md`、`docs/architecture/README.md`（索引行文案与最终文档标题一致）。

- [ ] 记录按"四问 + 裁决"结构写，每问两半（机制存在 / 承载能力已实测）。
- [ ] 裁决恰好一个取值，点名决定它的那一个答案。
- [ ] 若裁决是 `fallback-web`：读 #124 的子 issue 列表，逐条判断范围是否变化，写评论。
- [ ] 把评论 URL 与结论写进记录与 `Decision Log`。

**验证**：`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0；记录里能 grep 到四个问题的观测时间；裁决词恰好是 `embed` 或 `fallback-web` 之一。
**回滚**：`git checkout -- docs/architecture/harness-host-spike.md`（或删除该文件与索引行）；#124 的评论若已发出，只能追加订正评论，不能删除——这是本批次唯一不可逆的动作，所以它放在观测全部结束之后。

### Batch 4 · 验证、整理、交付

**最小闭环**：真实验证输出写进 PR 描述；提交序列干净；最终 push 后回读远端 head 与 issue 关联。
**涉及文件**：PR 描述（经 `gh pr edit --body-file`）；必要时订正 Batch 3 的两份文档。

- [ ] 跑 §`Validation and Acceptance` 的全部命令，保存**真实输出**。
- [ ] 整理提交（无 fixup / debug / 临时提交）。
- [ ] `git push`，`gh pr edit <n> --body-file <最终描述>`，回读。
- [ ] PR 描述含：闭环 / 关联（ExecPlan + Batch + `Closes #125` + Refs #124）/ 四问答案摘要 / 裁决与决定它的那一条 / 验证证据 / 风险与回滚 / 请评审。

**验证**：`gh pr view <n> --json headRefOid,closingIssuesReferences` 的 head 与本地 `git rev-parse HEAD` 一致；`gh issue view 125 --json closedByPullRequestsReferences` 非空。
**回滚**：`gh pr close <n>`（不合并即无副作用）；文档改动可整支回退。

## Validation and Acceptance

| # | 验收项（issue #125 的 Acceptance criteria） | 判定证据 |
|---|---|---|
| 1 | 记录回答四个问题，每个带确切的命令或代码路径与观测时间 | `docs/architecture/harness-host-spike.md` 的 §2–§5；每问的"证据"行含命令或符号 + UTC 时间 |
| 2 | 裁决恰好是 `embed` 或 `fallback-web` 之一，并点名四个答案里决定它的那一个 | 记录的 §7；裁决段（§7 的引用块）里取值只有一个：`fallback-web`。`grep -c "embed\|fallback-web" docs/architecture/harness-host-spike.md` = 10 行，其中只有 1 行在裁决段内承载取值，其余 9 行是问题陈述、规则复述与"翻成 embed 需要什么"的引用——所以判定不能写成"grep 只命中裁决段"，要人工看那一行。**这个计数随文档改动而变**，复核时以命令的实时输出为准，不要照抄本行数字 |
| 3 | `node scripts/rule-checks.mjs disclosure <base>` 无命中 | 命令退出码 0（在检出 `test/harness-host-spike` 的工作树根目录运行，base = `origin/main`）。**覆盖范围的边界**：它的七类模式不含宿主标识符，所以"记录里没有宿主产品名"这条没有机械兜底，只能人工过 |
| 4 | 若裁决是 `fallback-web`：#124 上有一条评论点名所有范围会变的子 issue | 评论 URL <https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5790974840> 写进记录 §8 与 `Decision Log`。**时限要求未满足**：原评论声明的"在任何子 issue 开工之前"被证伪。复核命令：`gh pr view 158 --json createdAt`（→ 2026-09-23T07:30:11Z，比评论的 07:39:04Z 早 8 分 53 秒）与 `gh api repos/SingularityKChen/harness-projects/issues/comments/5790974840 --jq '.created_at'`。订正回复：<https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5791408921>。原先写的 `gh issue view 124 --comments` **原理上无法验证这个排序**，已换成这两条命令 |
| 5 | 探针代码不合并；`apps/harness-plugin` 恢复为只有 `packageId` 的占位 | `git status --short` 只有 `docs/` 改动；`git diff origin/main...HEAD --stat` 不含 `apps/`、`packages/` |
| 6 | 文档规模 ≤1500 行；不新增依赖；锁文件不变 | `node scripts/rule-checks.mjs size origin/main`；`git diff --stat origin/main...HEAD -- pnpm-lock.yaml package.json` 为空 |
| 7 | 全仓库门禁仍绿 | `npm_config_manage_package_manager_versions=false pnpm verify` 退出码 0 |

## Progress

- [x] 2026-09-24 Batch 1 · 计划落盘（本文件）
- [x] 2026-09-24 Batch 1 · 索引两行 + 提交 + push + draft PR #162 + 回读 issue 关联（`closingIssuesReferences` 与 `closedByPullRequestsReferences` 双向非空）
- [x] 2026-09-24 Batch 2 · P1–P4 观测（窗口 2026-09-23T07:34:30Z – 07:35:40Z；探针已删除）
- [x] 2026-09-24 Batch 3 · 记录 + 裁决 `fallback-web` + #124 评论
- [x] Batch 4 · 验证 + 整理 + PR 描述 + 回读

## Surprises & Discoveries

1. **四个问题里三个的缺口在仓库侧，不在宿主侧**。P1 的组合那一步实测失败，报错是 `storage.putWorkspace is not a function`——`packages/storage/sqlite` 只提供"打开库 + 跑迁移"，没有实现 `Storage` 能力契约（`grep -rn "implements .*Storage" --include=*.ts .` 只命中 `packages/providers/fake/src/storage.ts` 的 `MemoryStorage`）。这条事实推翻了我最初"宿主是主要未知"的假设：**本层真正卡住的是本仓库还没有可被承载的 SQLite 存储实现**。
2. **宿主 transport 的宿主半边比预期强**：`ctx.connection.rpc.intercept('/api', …)` 不需要 HTTP 服务器就能登记，`createSharedFetchHandler('/api')` 能在普通 Node 进程里派发信封。于是"宿主 transport 承载 controller 的查询与命令"这一条成了本层唯一一条完整实测的承载能力（查询与命令各一次 200，注销后 404）。
3. **凭据缝有结构性保证**：`describe(ref)` 的返回类型里没有承载值的槽位，不是约定而是类型；凭据文件被强制 owner-only（探针第一次跑就被 `is readable beyond its owner (mode 644)` 拒绝）。
4. **插槽注册表不是运行时包**：按"插槽注册表"这个角色对 `$HOST_RUNTIME/node_modules` 搜索无输出，它只随宿主外壳的已构建 SPA 资产分发。这解释了为什么"挂一个页面"在 Node 里连第一步都走不到。
5. **宿主导航是面板选择，不是 URL 路由**：`grep -rln "history.pushState\|location.pathname\|createBrowserRouter\|useNavigate" "$HOST_RUNTIME"/node_modules/*/*/lib/client.js` 命中 0 个文件。这条只影响 #130 的深链路由复核，不影响裁决。
6. **观测时钟与文档日期差一天**：运行机器时钟给出 2026-09-23，计划与记录的日期是 2026-09-24。记录按机器时钟逐字写观测时间，不改成"看起来对"的日期。
7. **"在任何子 issue 开工之前"这条排序声明被证伪（对抗验证 P1）**。我写记录与 #124 评论时只核对了"#124 的 12 个子 issue 都是 OPEN"，没有核对批次起点的时间戳。实测：子 issue #128 的 PR #158 创建于 2026-09-23T07:30:11Z，比评论的 07:39:04Z **早 8 分 53 秒**；而 `docs/development/workflow.md` §1 把批次起点定义为"创建 draft PR"。订正做法按 `PLANS.md` §4：原文保留，在 #124 追加带日期的可见订正回复，记录 §8 改成实测能支撑的表述（评论早于各子 issue 今天存在的全部实现提交，但不早于 #158 的创建）。附带发现：#158 的 `base_ref_changed` 在 07:55:57Z——它创建时还没有以本分支为 base（本分支第一次提交 07:32:30Z）。
8. **`disclosure` 没有宿主标识符这一类的机械兜底**。验证者用"把宿主产品名注入新增行"的方式证伪了扫描覆盖：七类模式（令牌 / Access Key / PEM 头 / 家目录路径 / 内网主机名 / RFC1918 / …）里没有一条能命中宿主产品名或包名。所以"记录里不写宿主产品名"这条硬约束只能靠人工五类目与本记录的写法纪律；我把这条边界写进了记录 §2.4 与 Validation 第 3 行。
9. **`grep -c` 不是裁决唯一性的证据**：`grep -c "embed\|fallback-web"` 在记录里是 10 行，只有 1 行承载裁决取值。原先的 Validation 第 2 行把这条写成"grep 只命中裁决段"，是把一个弱证据写成了强证据；已改成人工判定 + 说明其余 8 行是什么。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D1 | 交付物只有记录，探针代码不合并 | issue #125 Out of scope 第一条；避免"记录"与"实现"两份事实互相污染 | 2026-09-24 / 本层执行者 |
| D2 | 每个答案拆成"机制存在"与"承载能力已实测"两半，裁决只跟随后者 | 本层最大的失败模式是把读类型声明当成能力观测 | 2026-09-24 / 本层执行者 |
| D3 | 不启动第二个宿主应用、不驱动浏览器 | 本机已有运行中的宿主实例；改本机用户数据根的 profile 属于对运行态的破坏性写入；时间盒内也补不上"插件缺客户端 bundle"这个 P4 要观测的缺口 | 2026-09-24 / 本层执行者 |
| D4 | 裁决规则先写死（§4 的表），再跑观测 | 事后解释会把"希望是 embed"写进裁决 | 2026-09-24 / 本层执行者 |
| D5 | 裁决 `fallback-web`，点名问题四决定它 | 问题四（插件在一个 slot 里挂载一个页面）未观测到，且它是四个问题里唯一直接决定"页面能不能出现在宿主里"的那一条；问题三的客户端半边与 watch 增量同样未观测到，独立支撑同一结论 | 2026-09-24 / 本层执行者 |
| D6 | 在 #124 留评论，范围变化的子 issue 只有 #135 | 判据：交付物、验收标准或所属外壳三者之一变化才算范围变化。#135 三者全变（外壳从宿主插件变成独立 Web 壳、验收项"inside the host"不成立、Out of scope 反转）；其余 11 个子 issue 的交付物与外壳无关 | 2026-09-24 / 本层执行者 |
| D7 | 不把裁决写成"宿主不能承载" | 三个缺口在仓库侧（SQLite 的 `Storage`、provider 占位、插件包缺客户端 bundle）；写成"宿主不行"会让后续复核找错方向 | 2026-09-24 / 本层执行者 |
| D8 | 排序声明被证伪后：保留原文 + 追加可见订正，不改写历史 | `PLANS.md` §4「被推翻的结论就地标注，而不是只在新处写订正」；GitHub 评论虽可编辑，但静默改写会让订正不可审计。订正回复 <https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5791408921> | 2026-09-24 / 本层执行者 |
| D9 | 维持 #132 为"范围不变"，但补措辞说明 | 本仓库的 "host" 指权威状态侧（`AGENTS.md` §1.1 不变量 7），不是插件宿主；`fallback-web` 下组合根仍在权威侧。判据是"交付物/验收标准/所属外壳"，措辞不改变交付物。若人类伙伴认为落点变化应算范围变化，这一条需要改判——已在记录 §8 显式留出改判口 | 2026-09-24 / 本层执行者 |
| D10 | 保留 `Closes #125`，勾选全部 4 条 AC，并**豁免 AC #4 的时序子句** | issue #125 的 AC #4 含"before any of them starts"，而 #158 创建于 2026-09-23T07:30:11Z、#124 评论发于 07:39:04Z（晚 8 分 53 秒）——该子句**无法事后满足**，AC #4 按原文永久不可达。AC #4 的**内容**要求（点名所有范围会变的子 issue）已满足，缺的只是时序。人类伙伴 @SingularityKChen 于 2026-09-24 显式决定豁免该子句并关闭 #125；豁免人、日期与范围即本行。记录 §8 保留"时限要求没有被满足"的原事实陈述，使豁免**可见**而不是被抹平——勾选 AC #4 应读作"内容要求已满足 + 时序子句经人类伙伴豁免"，不是"时序要求已达成" | 2026-09-24 / 人类伙伴 @SingularityKChen 决定，本层执行者记录 |

## Idempotence and Recovery

- **可重复**：Batch 1 的文档写入、Batch 2 的全部探针、Batch 4 的全部验证命令都是幂等的（探针每次在临时目录重建数据库与凭据文件）。
- **已知良好状态**：`origin/main` = `4d46559`；本分支的 Batch 1 提交。任何一步失败，`git reset --hard <Batch 1 提交>` 就回到"只有计划"的状态。
- **不可逆动作**：只有 #124 的评论。它被刻意放在全部观测结束、裁决写定之后（Batch 3 的最后一步）；若发错，只能追加订正评论并在记录里标注，不能删除。
- **探针残留**：`.spike/` 是未跟踪目录，删除即净；若忘记删，`git status --short` 会把它显示为 `??`，是 Batch 2 验证的判定条件。

## Interfaces and Dependencies

- **外部工具**：`git`、`gh`（带 `-R` / `--repo` 或在本工作树根目录运行）、`node`（≥22，本机 26.x，能直接执行 `.ts` 源码）、`pnpm`（沙箱下必须带 `npm_config_manage_package_manager_versions=false`）。
- **宿主运行时**：本机已安装，通过环境变量 `HOST_RUNTIME` 指向其根目录。探针只**读**它、只在本进程里挂载它，不写它的用户数据根（唯一写入是探针自己在系统临时目录下建的目录，以及宿主凭据缝指向临时文件的配置）。
- **凭据**：本层不需要任何真实凭据。P2 用自造的假值（`probe-secret-value`），它既不是 token 也不进仓库。
- **命名契约**：记录文件名固定 `docs/architecture/harness-host-spike.md`（issue #125 的验收项）；计划文件名固定 `2026-09-24-harness-host-spike.md`，Active 期间在 `docs/exec-plan/active/`，验收后归档到 `docs/exec-plan/completed/`。
- **上游 issue**：`Closes #125`；`Refs #124`。

## Outcomes & Retrospective

**实际结果**：交付物是 `docs/architecture/harness-host-spike.md`（329 行；复核用 `wc -l docs/architecture/harness-host-spike.md`，不要照抄本数字）+ 一个裁决 `fallback-web`，无代码合并。四个问题逐条落到"观测到 / 未观测到 + 原因"：问题三的宿主半边完整实测（查询与命令各一次 200），问题一的建库与"controller 跑在宿主插件里"实测通过而组合失败，问题二的句柄解析与"密钥不入库"实测通过而 provider 那一半没有对象，问题四完全未观测到。

**与计划的偏差**：

1. 计划把 P1 的第三半写成"预期失败"；实际失败得更彻底——不是"sqlite 当 storage 类型不对"，而是 `packages/storage/sqlite` 根本没有 `Storage` 实现。偏差记在 `Surprises & Discoveries` 第 1 条。
2. 计划里 P3 的"宿主半边可实测"是唯一一条预计能跑通的 transport 观测；实际跑通并额外观测到注销后的 404 生命周期。
3. 计划未预料到插槽注册表**不是运行时包**（`Surprises` 第 4 条），这使问题四的失败点比预期更靠前。

**遗留问题**：

- 五条未观测到的东西与各自的复核方法见记录 §9。裁决翻成 `embed` 的四个前置条件见记录 §7。
- #130 的深链路由在 `embed` 下的宿主侧路由面未查明（记录 §8 已登记为待复核项）。
- 本计划已在人类伙伴验收 PR #162 后移入 `docs/exec-plan/completed/`，`docs/README.md` 索引已同步（Active 行移入 Completed）。

## Bottom Change Note

- 2026-09-24：创建。spec + plan 合一，四个探针按"机制存在 / 承载能力已实测"两半设计，裁决规则先写死。
- 2026-09-24：Batch 1–3 完成。追加 `Progress` 勾选、六条 `Surprises & Discoveries`、`Decision Log` D5–D7、`Outcomes & Retrospective`。裁决 `fallback-web`，#124 评论已发出（<https://github.com/SingularityKChen/harness-projects/issues/124#issuecomment-5790974840>）。计划本身未改批次划分。
- 2026-09-24：Batch 4 完成。验证全部通过：`pnpm verify` exit 0（446 + 7 pass / 0 fail）、`disclosure origin/main` exit 0（含 `PR_BODY`）、`size origin/main` 代码 0/1000、`git diff --check` exit 0、`git status --short` 无输出。提交整理为两个：计划的、记录的。PR #162 的描述已更新并回读（`headRefOid` 与本地 HEAD 一致，`closingIssuesReferences` 与 issue #125 的 `closedByPullRequestsReferences` 双向非空，`PR Fast Gate` pass）。
- 2026-09-24：对抗验证后订正（`partially_falsified`）。修了 1 条 P1 + 6 条 P3：①记录 §8 的"在任何子 issue 开工之前"被证伪，改为实测能支撑的表述并在 #124 追加可见订正回复；②Validation 第 4 行的复核命令换成能验证排序的两条；③Validation 第 2 行的 `grep -c` 证据描述改准（9 行，只有 1 行承载取值）；④`Outcomes` 的记录行数 299 → 301；⑤记录的 provider 枚举补上 `planning-local`；⑥记录 §6.2 / §5.3 的宿主包名片段改成角色指代，并记下 `disclosure` 七类模式不含宿主标识符；⑦记录 §8 的 #132 补措辞说明。验证摘要见本次订正后的 PR 描述。
- 2026-09-24：第二轮评审（GitHub inline review `5289300391` @ `5151f77`）后订正并归档。修了 2 条 P2 + 3 条 P3：①记录 §3.3 / §9 的复核命令改用 `git grep`——裸 `grep -rn … .` 会走进被 `.gitignore` 忽略的 `.worktrees/`，在仓库根目录实测 16 行且含其它分支的 `SqliteStorage` 实现，会把"仓库有没有 SQLite `Storage` 实现"这个判断**读反**；§9 的触发条件同时限定为"`main` 上出现**完整**的 `Storage` 实现"（只交付地基面、其余抛 `not implemented` 的实现不算触发）。②`Closes #125` 与永久不可达的 AC #4 时序子句冲突：按人类伙伴显式决定保留 `Closes`、勾选全部 4 条 AC 并豁免该子句，记入 `Decision Log` D10，记录 §8 补可见豁免说明。③`Outcomes` 的记录行数改为最终实测值并附可再生成的命令。④记录 §2.4 的 disclosure 模式列表补上漏掉的 `GitHub 细粒度 PAT`（原文说"七类"却只列六类）。⑤记录 §6.1 的"宿主没有 URL 路由面"收窄为"在 `lib/client.js` 这一面未命中"，并说明该负向结论不覆盖 §6.2 用到的已构建 SPA 资产面。⑥订正中**顺带发现同一类缺陷的第二处**：`Validation` 第 2 行与 `Surprises` 第 9 条自报的 `grep -c "embed\|fallback-web"` 计数（9 行）在 `5151f77` 上已是 **10** 行——与 ③ 同因，都是订正提交自己把数字改旧的；两处一并改准，并写明"以命令实时输出为准，不要照抄"。另：本计划按人类伙伴验收归档到 `docs/exec-plan/completed/`，`docs/README.md` 索引同步；PR #162 已 ready（不再是 draft）并按指示以 rebase merge 合并。
