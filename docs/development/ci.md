# CI 结构与演进

## 当前已经实施

远端 main 当前的 workflow 与门禁归属：

| workflow | 触发与职责 | 门禁 |
|---|---|---|
| CI | pull_request、push main、手动运行；执行 install、typecheck、测试并发布 PR Fast Gate | PR Fast Gate 是唯一必需状态 |
| Merge Gate | pull_request（不声明 base 过滤器）、push main；四条 lane 各跑一层测试并点名它保护的不变量，聚合 job 发布 Merge Gate | advisory；是否加入分支保护由人类伙伴决定 |
| Issue policy | issue / PR 事件；检查标题、标签和 issue 关联 | advisory |
| Rule checks | PR 事件；发布面和 PR 体量 | advisory |
| Board invariants | 每日 schedule；两个 job：读取 Project 工作流启停并与裁决表比较，以及核对 `Engineering` 字段与 PR 真值 | advisory；需要 PROJECTS_TOKEN |
| Engineering state | pull_request_target（opened / reopened / ready_for_review / converted_to_draft / synchronize / closed）与 Engineering state signal 的 workflow_run；把 PR 生命周期写进看板的 `Engineering` 字段 | advisory；**不写 `Status`**（不变量 3） |
| Engineering state signal | pull_request_review（submitted / dismissed）；只上报一个信号，由 Engineering state 消费 | advisory；`permissions: {}` |
| GitHub review session | ready_for_review 的 pull_request_target；只转发 payload，不 checkout PR 代码；按 head 提交去重 | 不属于合并门禁 |

Board invariants 只从默认分支按日运行，使用 Project token，发现偏离就失败；它不 checkout PR ref，也不进入分支保护。Review session 是特例：它运行在 self-hosted runner 上，默认分支 workflow 固定定义，权限为空，secret 只经 env 进入签名过程，响应体写 $RUNNER_TEMP。普通 PR 代码 lane 使用 pull_request；不得把 pull_request_target 用作执行不可信 PR 代码的入口。

Board invariants 的 `on` **刻意只有 `schedule`**，由 `tests/contract/check-board-workflows-live.test.js` 钉在 `['schedule']` 上。`workflow_dispatch` 带一个 ref 选择器，而被选中的 ref 同时决定 workflow 定义与 checkout 出来的脚本——这两个 job 都持有长效 PAT，于是手选一个 PR 分支就能拿 token 执行任意代码。`merge-gate.yml` 可以用 `workflow_dispatch`，是因为那条 workflow 不读任何 secret；这条区分不是风格，是提权边界。

### Board invariants 的第二个 job：`Engineering` 字段漂移

`engineering-field` job 跑 `scripts/check-engineering-drift-live.mjs`：把看板上每个 issue 条目的 `Engineering` 与「引用它的 PR」的真值比较，不等就报 `::error::` 并 exit 1。

它存在的理由是一次实测：2026-09-22 发现 `scripts/sync-engineering-state.mjs` 的投影函数用 REST 语义校验 GraphQL 枚举（接受集合写成 `['OPEN','CLOSED']`，而 GraphQL 对已合并 PR 返回 `MERGED`），于是产出 `Merged` 的分支不可达、**每一次合并事件上的 reconcile 都失败**，而看板静静停在 `PR open`——44 个条目里 25 个与真值不符（issue #110）。那次故障四层防线全漏，漏掉的那一层就是这里：没有任何东西观察字段取值本身。失败发生在合并**之后**，拦不住合并；它不是必需检查；`Board workflow invariants` 只看工作流启停，不看字段取值；契约测试断言的又是错的行为。

判定规则在 `scripts/engineering-drift.mjs`（纯函数，进 `pnpm verify`）：只要有任一引用该 issue 的 PR 已合并就期望 `Merged`（已合并是终态且单调），否则取创建时间最新的 open PR 的投影，全 closed 未合并则期望为空；没有被任何 PR 引用的条目跳过——`Engineering` 为空是合法状态，不是漂移。

**投影是共享的，选择策略不是。** 单 PR 的 `snapshot → 取值` 投影 import 自 `sync-engineering-state.mjs`（`stateForSnapshot`），所以两侧对同一个快照必然一致；但「同一 issue 被多个 PR 引用时谁说了算」这条**选择策略是观察者独有的**——写入者 `sync-engineering-state.mjs` 只投影触发事件的那一个 PR，没有任何跨 PR 聚合。两者因此可能在多 PR 引用同一 issue 时给出不同取值，这是 issue #115 记录在案的已知缺口，不要把它读成「两侧必然一致」。

PR 列表与看板条目都分页读取，超过 5 页（500 条）上限就 fail closed，不把截断的输入读成「没有漂移」。看板条目按**来源仓库**过滤：项目是 user 级的，可以容纳任意仓库的条目，不过滤的话他仓的 issue #N 会与本仓库 close #N 的 PR 误配。

Review session 的两条结构性质由 `tests/contract/github-review-workflow.test.js` 固定，改 workflow 必须同时改它：

- **事件负载只从运行器导出的 `GITHUB_EVENT_PATH` 读**。workflow 表达式里的运行器事件路径在这台自托管运行器上会求值为空字符串，于是 `readFileSync("")` 抛 ENOENT，job 在第一步崩掉且报错里只有一个空路径（issue #65，2026-09-20 实测三次运行全部如此）。空路径与空文件都必须先被显式拒绝并打印 `::error::`，而不是留一个 Node 栈。内联签名脚本读的必须是 `process.env.GITHUB_EVENT_PATH`：脚本里那个 shell 变量不会继承到子进程。
- **并发按 head 提交去重**：`group` 是 head SHA，`cancel-in-progress: true`。`ready_for_review` 对每次 draft → ready 都发一个新事件，按 PR 号分组不限制队列深度，单台运行器会被排满（issue #49）。同一份代码只值一次评审会话，head 未变时后来的运行取消在先的运行。

`pull_request_target` 的代价必须记住：**workflow 定义永远取自默认分支，所以这类修复在合并进 `default branch` 之前无法用真实事件验证**。合并前的证据是本地排练——把 workflow 里的转发脚本原样抽出、用真实事件负载与本机凭据对 `127.0.0.1:3081/github` 执行，期望 `endpoint responded: 202`；合并后必须再回读一次真实运行，把"本地排练通过"当成"线上已修好"是不允许的。

CI workflow 的 action 必须 pin 到 40 位 commit；checkout 必须关闭 persist-credentials；权限最小；main push 运行不能因后续 push 被取消。新增 workflow 必须同时更新 workflow-check、契约测试和本文件。

### Rule checks 的判定基线来自 PR API，不来自触发器

`Rule checks` 的 `size` 与 `disclosure` 都以“当前 PR 自己声明的 base 分支”为判定基线（体量分桶的范围、发布面扫描的范围），来源是 PR 对象本身：

    # 取数：只读 GET，token 只在这一步；base.ref 这一来源说明也在这里回显
    # （它不参与判定，所以不进解析器的契约）
    gh api "repos/$REPO/pulls/$PR_NUMBER" > "$RUNNER_TEMP/pr.json"
    printf 'api_base_ref=%s\n' "$(jq -r '.base.ref // ""' "$RUNNER_TEMP/pr.json" | tr -d '\000-\037\177')" >> "$GITHUB_OUTPUT"

    # 解析：执行 PR 里的脚本，因此不持 token；EVENT_HEAD_SHA 是必需输入
    EVENT_HEAD_SHA=<事件 head sha> node scripts/resolve-pr-base.mjs < "$RUNNER_TEMP/pr.json" >> "$GITHUB_OUTPUT"

**两个 checkout 取 base 仓 + `refs/pull/<n>/head`。** 这个 ref 在 base 仓里一定存在（fork 来源的 PR 也有）：head 由它带来，base 对象由 `fetch-depth: 0` 取到的 base 仓分支头带来。取 fork 仓会让 **base 对象**不可达（fork 的 `main` 往往是旧的），检查于是**永远**没有结论；依赖"base 仓能否按裸 SHA 提供 fork 的 head 提交"则是未证实的前提。代价：checkout 拿到的是**当前** head，若它在事件与 checkout 之间前移，身份校验会 fail closed，并由下一次事件（同一 concurrency group）取代。

**取数步骤刻意排在 `actions/checkout` 之前。** checkout 的 `fetch-depth: 0` 取的是**它执行那一刻**的所有分支头（refspec `+refs/heads/*:refs/remotes/origin/*`），而 `base.sha` 是取数**那一刻**的 tip。顺序反过来时，base 分支只要在这两步之间前进（本地变基后强推是常规操作，见 `merge-queue.md` §2.3），新 tip 就不在 clone 里，可达性校验失败、两个 advisory 检查因此没有结论——一个由**常规操作**触发的误报，而误报正是"能不能提升为必需检查"的判据（§9.2）。放在前面时，后面那次全量 fetch 必然包含刚读到的 tip，**本 job 的** clone 于是必然是快照的超集；顺带持 token 的步骤执行时工作区还是空的。注意这条保证的范围：检查 job 会在十几秒后自己再 fetch 一次，那个窗口里 base 分支若被删除（本仓库开了 `delete_branch_on_merge`），对象仍可能不可达——那时同样 fail closed，并由 retarget 触发的下一次事件自愈。`tests/contract/rule-checks.test.js` 有一条断言钉住这个顺序。

`resolve-base` job 是唯一的解析点，它一次解析出**一对不可变提交** `(base_sha, head_sha)`：`base_sha` 取自 API 快照，`head_sha` 取自事件负载（check run 就挂在它上面）。两个检查在同一个 matrix job 里（`checks`）`needs` 它、显式 checkout 到 `head_sha`、并在判定前校验 `HEAD == head_sha == 事件 head`、`base_sha` 等于取数步骤读到的 API 快照、且两个对象在本地可达；解析失败或对象不可达时它自己变红、检查被跳过，**不回退到 `main`、`github.base_ref` 或当前的 `origin/<base.ref>`**（失败分支由 `tests/contract/resolve-pr-base.test.js` 与 `tests/contract/rule-checks.test.js` 的 CLI 用例覆盖）。日志里 `github.base_ref` 与 `github.event.pull_request.base.ref` 只作诊断，判定对象单独标注——这条区分是刻意的，issue #99 的成因正是把运行时字段当成了权威值。

为什么不能用 `github.base_ref`：**GitHub 原生 stack 的成员 PR，其运行时 base 是栈的 base 分支（`main`），而不是它声明的父分支。** PR #94 的 API 说 `base.ref=feat/core-start-work`，而 run `35511506461` 的 job 日志回显 `BASE_REF: main`，于是整栈累计被读成单个 PR 的体量（真实 892 行被报成 4796 行）。这与触发器过滤器无关：过滤器只负责准入，它**不会改写** `base_ref`；PR #98 去掉过滤器之后，栈成员的运行时 base 仍然是 `main`。

准入侧的决策仍然保留：`on.pull_request` **刻意不声明 `branches` / `branches-ignore`**，否则 base 不是 `main` 的普通 PR 连一次结论都没有（#83 的 head `c55080ed5b` 与 #88 的 head `39285d938c` 在修掉它之前的运行里从未出现）。准入断言、判定对象来源断言与"没有一步用移动 ref"的断言都在 `tests/contract/rule-checks.test.js` 的「CI 接线」里。

**为什么连 `base.ref` 都不够：判定必须固定到对象，而不是 ref。** `git diff B...H` 的正确性只相对于**给定的两个对象**成立：它算的是"以 B 与 H 为端点时，H 一侧自共同祖先以来的改动"。如果只把分支名传下去，下游会解析**当时**的 `origin/<base.ref>`——那是一个会移动的对象。base 正常前进（fast-forward）时结果不变，但 base 被 force-push 到无关历史时共同祖先会后退，base 分支自己的提交会被算进这个 PR。`tests/contract/rule-checks.test.js` 里有一条真实 git 回归用例同时跑这两种情形：同一个 head，固定对象对得到 5 行（正确），移动的 branch tip 得到 1205 行（假红）。**"只要是三点差异就仍然只算本 PR"不是不变量**——这是 PR #100 评审的 P1，也是这条规则从"传 ref"改成"传一对提交"的原因。

因此 `base.sha` 与 `head.sha` 都不是诊断：它们是判定输入。API 的 `head.sha` 与事件 head 不一致时只打印 `::warning::`（PR head 在解析期间前移不改变 `(base_sha, head_sha)` 这对输入，判定对象是事件 head，硬失败只会制造 flaky 红叉）；真正硬失败的是"判定对象无法确定"——API 失败、两个 SHA 缺失或形状不对、`base_sha` 在本地不可达。

**校验边界只覆盖判定需要的东西。** 解析器的契约里**只有** `base_sha` 与 `head_sha`：它输出的就是判定输入本身，因此它校验的也只有这两个值（40 位十六进制）。`base.ref` 是**来源说明（provenance）**，不是判定输入——它不参与判定，也不进解析器的契约，由持有 JSON 的取数步骤回显（那一步不执行 PR 代码），去掉控制字符后写一行 output。这样"分支名长什么样"根本不进入校验路径：合法的 CJK/`@`/`+` 分支名不会把 advisory 检查判红，也不需要一份字符集规则去说明为什么可以放行（§9.2）。

**来源不等于信任边界。** 两个检查执行的 `scripts/rule-checks.mjs` 与 `scripts/resolve-pr-base.mjs` 都来自 PR 自己的 checkout，而解析器的 stdout 就是 `$GITHUB_OUTPUT`：一个改写解析器的 PR 可以声称 `base_sha == head_sha`，让自己的 advisory 检查变绿。这是"检查跑 PR 代码"的固有性质，不是本设计引入的——仓库对**必需**检查的答案一直是 `ci.yml` 的 `fast-gate`（不 checkout PR 代码、只汇总 lane 结论）。因此若将来要把 `Rule checks` 提升为必需检查，前置条件是判定结论不能由 PR 代码产生；在那之前，"唯一权威来源"说的是这个值**从哪来**，不是它**可信**。

复核历史时有两个陷阱。其一：`runs` API 的 `pull_requests[].base.ref` 与 `.head.sha` 是**实时快照**，不是运行时的值——直接列出来会得到“‘base 非 main’的运行有 14 个”，看上去像过滤器从没挡住任何东西；运行时的基线只能从 `.head_sha` 加 job 日志回显读。其二：**不要用 `HEAD^1`**（测试合并提交的第一个父提交）当声明 base——它依赖 GitHub 生成合并提交的内部结构，实测 #84 的 `HEAD^1` 是 #81 的 merge commit，冲突 PR 还可能没有合并提交。同理，检查 job 也不 checkout 默认的测试合并提交，而是显式 `ref: head_sha`。

三点差异（`<base_sha>...<head_sha>`）本身也是被测试钉住的性质，但要按它的真实范围理解：它保证"以这两个对象为端点时，只算 head 一侧自共同祖先以来的改动"。base 分支前进（fast-forward）时共同祖先仍在分叉点，结论不变；base 被 force-push 到无关历史时共同祖先后退，base 自己的提交会被算进来。`tests/contract/rule-checks.test.js` 有一条真实 git 用例同时钉住这两种情形：base 前进（fast-forward）时只算子分支自己的 5 行；base 被 force-push 到无关历史时，固定对象对给 5 行、移动的 tip 给 1205 行，并断言两者不同。

`CI` workflow 仍保留 `pull_request: branches: [main]`。它造成的是另一件事：非栈、base 非 `main` 的 PR 拿不到 `Verify` / `PR Fast Gate`（栈成员因为运行时 base 是 `main` 反而有）。放开它同时改变运行次数与门禁覆盖面，属于独立决策，尚未执行。

### Merge Gate 的四条 lane，以及与 `CI` 的重复为什么是刻意的

`.github/workflows/merge-gate.yml` 把四层测试各自放上一条 lane，每条 lane 点名它保护的不变量：

| job | check 名 | 跑什么 | 保护的不变量 |
|---|---|---|---|
| `integration` | Merge Gate · Integration | `node scripts/run-test-layer.mjs tests/integration …` | 迁移可从空库重复执行、失败不留版本记录 |
| `boundaries` | Merge Gate · Boundaries | `node scripts/run-test-layer.mjs tests/contract/package-boundaries.test.js …` | 依赖方向不反向、不跨层 |
| `mvp0` | Merge Gate · MVP-0 | `node scripts/run-test-layer.mjs tests/mvp0 …` | 纵向链路每节点有断言，未实现节点必须失败并点名 |
| `e2e` | Merge Gate · E2E | `node scripts/run-test-layer.mjs tests/e2e …` | 端到端链路与故障降级 |
| `merge-gate` | Merge Gate | 不 checkout、不读 secrets，只汇总 `needs.*.result` | 任一 lane 未成功即失败 |

`pnpm test` 已经跑过 integration、`package-boundaries.test.js` 与 e2e，所以这个 workflow 与 `CI` 有重复。重复的理由不是覆盖率，而是**判定对象不同**：`CI` 判定“这个 head 的代码是否可用”，`Merge Gate` 判定“这条不变量在候选 head 上是否被断言且非空”。因此重复面被刻意压到最小——只取 `package-boundaries.test.js` 一个文件，不复制其余契约测试（见下面“不得把同一组契约测试复制到多个 workflow”）。`tests/mvp0` 是唯一在 `CI` 里完全缺席的层，它在这里第一次进入门禁。

空层判定放在 `scripts/run-test-layer.mjs`，不放在 YAML 里数文件：`node --test` 对“没有用例”退出 0，在 YAML 里 `find | wc -l` 只能判“有文件”，判不了“用例数非零”。脚本先数 `*.test.js` 文件，再解析 `node --test` 的汇总行，判“真正执行的用例数 = `tests` − `skipped` − `todo`”是否 ≥ 1；任何一步判不出来都 fail closed（exit 1 + `::error::`，并把被保护的不变量写进注解）。Node 26 实测：只有 `describe` 没有用例的文件汇总行是 `ℹ tests 0`，只有 `skip` 的文件是 `ℹ tests 1` / `ℹ skipped 1`，所以只看 `tests` 会把“整层被 skip 掉”读成绿的。

`on.pull_request` 刻意不声明 `branches`：理由与 `Rule checks` 相同（见上一节）——本车道不依赖 `base_ref`，只依赖事件本身，声明过滤器只会让基线不是 `main` 的 PR 拿不到结论。`push` 只限 `main`，且 `concurrency.cancel-in-progress` 是 `${{ github.event_name == 'pull_request' }}`：合并到 `main` 的验证记录不得被后续合并取消（W5）。另声明 `workflow_dispatch`：加入分支保护前要在目标 head 上观察到连续两次绿（见下一段），第二次运行需要一个人工入口，不能只靠重跑同一个 job。

`Merge Gate` 目前是 advisory，不是分支保护里的必需检查。是否加入由人类伙伴决定，且加入前要在目标 head 上观察到连续两次绿（`docs/architecture/release-gates.md` §2.2）。本车道**不**改变 `PR Fast Gate` 的唯一必需状态，也不改 `ci.yml`。

## W1–W7

详细判定和 fail-closed 退出码见 repository-rules.md。CI 必须使 workflow-check 通过后才宣称门禁完整。解析失败、未知 jobs 结构、无 workflow 文件和空 jobs 都是检查失败，不可当作“没有需要检查的内容”。

## 合并后的演进

Merge queue / merge_group、integration、E2E 和 weekly regression 只有在仓库出现对应真实测试、耗时基线和稳定入口后才新增。新增 lane 先写 ExecPlan，证明它提供新的系统反馈；不得把同一组契约测试复制到多个 workflow 来制造覆盖率。

integration 与 E2E 的前置条件现已成立：`tests/integration`、`tests/e2e` 各有用例文件，`pnpm verify` 是既有稳定入口，`Merge Gate` 车道按本节顺序（先 ExecPlan）落地。merge queue / merge_group 与 weekly regression 仍然没有对应事实（分支保护只允许 rebase merge，仓库没有 merge queue，也没有实测的慢测试），因此未新增。

未来若启用 merge_group，复用 PR Fast Gate 的稳定聚合检查名，确保 required check 在 queue 中有状态上报。慢测和组合矩阵应放到非必需的 main / weekly workflow；不取消 main 的验证记录。self-hosted lane 需要隔离 workspace、临时目录、端口、数据库和子进程，并避免在长期 runner 上执行不可信 fork 代码。

CI 效率以 time-to-first-failure、队列等待、job 耗时、flake 和重复验证衡量；coverage 是风险信号，不是单独的质量目标。没有实际慢测试前不创建 weekly workflow。
