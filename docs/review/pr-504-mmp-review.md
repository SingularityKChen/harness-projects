# PR #504 MMP 交付评审

观察日期：2026-11-02；最终远端回读 11:13 UTC。检出 `test/composed-browser-ci`；初始 head `40f71164259b0c723d84fa0af73fa110350f4eca`，base `test/composed-workspace-browser` @ `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201`。

## 先验风险矩阵

本矩阵在逐文件评审之前建立；各项为待证伪风险，并非已发现缺陷。

| 等级 | 代码与失败路径 | 产品闭环及 issue 验收 | 架构与状态所有权 | 测试、反例与设计 |
|---|---|---|---|---|
| P0 | 合并即破坏 main / 执行不可信代码 | 绕过发布硬门或伪造权威保存 | 凭据泄漏、第二规划事实源 | 门禁遇未知状态放行 |
| P1 | 丢失状态、取消/迟到资源泄漏 | 宣称未成立的用户闭环或关闭必要验收 | 跨层绕行、权限/代际围栏失效 | 关键故障绿测、聚合假成功 |
| P2 | 有界恢复或可维护性缺口 | 指南/操作证据轻微不一致 | 局部接口含混 | 非关键断言不足、重复设计 |
| P3 | 命名/冗余 | 术语、导航与可读性 | 无行为影响的组织问题 | 文档与诊断清晰度 |

## 分层证据与结论

独立评审结论：未发现可归因于本层的 P0/P1/P2/P3 缺陷，建议 APPROVE。本评审没有提交 GitHub review、修改实现、提交或推送。方法使用 Superpowers、Qian Systems Router 的系统边界/分析综合，以及 First Principles Development 的审计/验证路径。

### 锁定与范围

- 最终 head 仍为 `40f71164259b0c723d84fa0af73fa110350f4eca`，直接 base 仍为 `test/composed-workspace-browser` @ `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201`；OPEN、非 Draft，`mergeable` / `mergeStateStatus` 为 UNKNOWN。本地与远端对象一致。
- 一条独有提交、五个改动文件；代码/配置/测试增删 128 行，文档增删 205 行，满足本轮严格 <800/<1300。没有 carrier、产品源码、依赖或 Merge Gate 行为改动。
- reviews、inline comments、issue comments 均为零；review threads 完整一页为零，`hasNextPage=false`。同仓 closing issue 为 #450，正文 Refs #498/#143；标题、标签、提交摘要及回滚单元符合规则。

| 风险层 | 实际检查及判定 |
|---|---|
| P0 · 信任与发布硬约束 | 新 browser 在 Ubuntu hosted runner 上执行普通 `pull_request` 代码，权限仅 `contents: read`；checkout 禁持久凭据，action 均为完整 SHA。`upload-artifact` pin 与官方 v7.0.2 tag 对象相符。聚合只有 needs 结果输出/exit，无 checkout、action、secret、env 或候选代码执行。没有修改 Planning、业务 Provider 写入或发布裁决。 |
| P1 · 执行与失败传播 | browser 与 Verify 并行；依赖安装→匹配 Chromium 安装→非空层入口顺序明确，job/命令无 skip 或 continue-on-error。聚合明确 needs 两条 lane；success/failure/cancelled/skipped 的全部 16 组合仅双 success 放行。真实 hosted 缺 binary 控制证明单独 Browser 红可使聚合红。 |
| P1 · 未知/缺失输入 | 专用契约约束恰好三个 job、jobs 映射、两个既存依赖和固定入口；W7/CLI 契约覆盖缺目录、零文件、解析失败、空 jobs 和未知 jobs 形状，均失败闭合。[GitHub 官方 contexts 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)把 `needs.<job_id>.result` 定义为上述四值；本地 16 组合只证明该平台契约内的表达式，不冒称任意未知字符串解析器。 |
| P1 · 产品与拥有权 | 规则层消费直接 base 的真实生产组合 suite；7 个具名用例实际执行，CI 自身不改保存、权限或规划事实。#450 的能力部分由 #503/#498 的独立验收承担，本层补齐持续 browser lane 与必需聚合证据；#143/#449/#73 的人类产品/安装/发布门独立。 |
| P2 · 触发与恢复 | 保留现有 `pull_request: branches: [main]`、push main、workflow_dispatch；本次栈成员没有 PR rollup 的 Browser/Fast Gate 投影，实际证据来自逐 SHA 的 dispatch 与 commit check-runs。最终 head 的两条 lane/聚合已绿，但这不证明普通非 main PR 自动触发或可立即合入 main。main push 不取消进行中的运行。 |
| P2 · 产物与成本 | 只在 failure 上传生成目录 PNG/ZIP，七天、排除隐藏文件，缺产物 ignore 不覆盖测试红。当前 hosted Browser job 约 52 秒，低于十分钟上界；准备/launch 前失败允许无 trace。正常成功和缺 binary 控制均无 artifact，未将“上传步骤成功”当成有截图证据。 |
| P3 · 设计与维护 | 复用既有 CI/稳定聚合、增加一条独立 lane，是满足必需覆盖的最小闭环；没有新 workflow、重复 Merge Gate lane、业务抽象或额外公共接口。通用 W1–W7 与新专用语义契约职责分明；拆成能力/规则两层可独立审阅与回滚，设计恰当。 |

### 独立平台证据

以下结果来自 Actions jobs/logs 与 commit check-runs 的现场回读，不采用 ExecPlan 自证：

| 证据 | 锁定对象与观察 |
|---|---|
| [先前正控 41423336481](https://github.com/SingularityKChen/harness-projects/actions/runs/41423336481) | `3a4c552611dda37d7471ea2cb81a41f16689422e`；workflow_dispatch，Verify/Browser/Fast Gate 均 success，实际 7 tests/7 pass、0 fail/cancel/skip/todo。 |
| [隔离负控 41424052263](https://github.com/SingularityKChen/harness-projects/actions/runs/41424052263) | `ccf85de4b3077e08634bdb84da89645b36615574`；与正控仅 CI 的 test 步骤增加 `PLAYWRIGHT_BROWSERS_PATH` 两行。安装 success、Verify success、实际 7 tests/7 fail、0 cancel/skip/todo，缺 binary 自然 exit 1；Browser failure、Fast Gate failure，聚合日志 `Needed job results: success, failure`。 |
| [负控后最终 CI 41427074486](https://github.com/SingularityKChen/harness-projects/actions/runs/41427074486) | 正式 `40f71164259b0c723d84fa0af73fa110350f4eca`；workflow_dispatch/completed/success，Verify/Browser/Fast Gate 全 success，实际 7 tests/7 pass、0 fail/cancel/skip/todo；聚合为 `success, success`。commit check-runs API 同 SHA 再确认。 |
| [最终 Merge Gate 41427079471](https://github.com/SingularityKChen/harness-projects/actions/runs/41427079471) | 同一正式 head，workflow_dispatch/completed/success，四 lane 和聚合全 success；本层没有改这条 workflow。 |
| 取消边界的只读抽查 | 既有 CI 的真实取消运行 `41408471020`、`41404089704` 中，Verify 和 Fast Gate 都为 cancelled，未观察到聚合成功。该继承表达式本层未改；本次没有新增 hosted skip/cancel 控制，不能把本地状态模型写成全部平台负控。 |
| [可选建会 41428276034](https://github.com/SingularityKChen/harness-projects/actions/runs/41428276034) | 同一正式 head 的失败由建会端点无法连接引起，已有开放 #364 覆盖。main 分支保护 API 现场仅 require `PR Fast Gate`，故这条失败不是代码 lane 或 required check 的失败。 |

正控与最终 head 的 CI YAML、专用契约、CI 文档 blob 分别相同；负控只改变 CI YAML。旧正控发生在负控之前，最终正式 head 的恢复绿由后置运行单独证明。dispatch actor/triggering_actor 均为仓库维护者，目标为本仓 CI；本评审只读回查。

### 本地验证与变异判别力

执行上下文：`.worktrees/composed-browser-ci` 根目录，检出上列正式 head。

- `pnpm test:file tests/contract/ci-browser-workflow.test.js tests/contract/workflow-check.test.js tests/contract/merge-gate-workflow.test.js`：exit 0，73/73，0 skip/todo。
- `node scripts/workflow-check.mjs`：exit 0，检查 8 个文件，0 findings。
- `pnpm test:browser`：exit 0，7/7，0 fail/cancel/skip/todo，约 8.6 秒。
- `pnpm verify`：本机 pnpm 自动依赖检查因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 在脚本执行前 exit 1；未记为通过，未改依赖来掩盖。随后直接执行同一验证组件：`node node_modules/typescript/bin/tsc --noEmit`、`node scripts/resolution-check.mjs`、`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`、`node --test --test-timeout=120000 tests/mvp0`，全部 exit 0，分别为 typecheck/resolution 成功、2882/2882 与 7/7，均无跳过。hosted Verify 的成功是独立证据。
- `node scripts/rule-checks.mjs disclosure 5f50b0da6ceedacc5b1c88b4afa7241da7f2c201`（含 PR_BODY）、`size` 与通过 Python subprocess argv 执行的 `git diff --check <base>...HEAD` 全 exit 0。人工逐项查凭据、本机身份、账号个人信息、内部系统、保密字样，未发现新增披露项。

最终树上用 `scripts/review-mutate.mjs` 执行以下完整变异表，命令为 `node --test --test-timeout=120000 tests/contract/ci-browser-workflow.test.js tests/contract/workflow-check.test.js`。每个 spec 均填写 `killedBy`；11/11 为 KILLED，无 KILLED_OTHER/NOT_APPLIED/SURVIVED；夹具整体 exit 0，前置与还原后基线均绿。

| ID | 单点变异 | killedBy 用例片段 |
|---|---|---|
| C1 | needs 移除 browser | Fast Gate 必须等候 |
| C2 | browser job `if: false` | browser job 与准备 |
| C3 | browser test 步骤 `if: false` | browser job 与准备 |
| C4 | browser job continue-on-error | browser job 与准备 |
| C5 | browser test 步骤 continue-on-error | browser job 与准备 |
| C6 | 安装与测试倒序 | CI 调度 verify |
| C7 | 聚合遗漏 skipped | 16 种结果 |
| C8 | 聚合遗漏 cancelled | 16 种结果 |
| C9 | artifact ZIP 路径扩成全仓 | browser 失败证据 |
| C10 | 聚合加入命令替换 | Fast Gate 必须等候 |
| C11 | upload action 改为移动 tag | 仓库当前的所有 workflow |

全部还原后直接重跑三份相关契约：73/73，exit 0、0 skip/todo；`git diff --exit-code HEAD -- .github/workflows/ci.yml tests/contract/ci-browser-workflow.test.js docs/development/ci.md` 为 0。最终仅本评审文档未跟踪，未遗留实现变异。

### Issue 边界与下一道门

#450 当前仍 OPEN，四条 AC 的 CI 部分在本层有实际证据；#498 当前仍 OPEN，其业务回归/载体闭环由直接父 PR #503 负责，合并本层前仍需父层独立评审成立。两层合起来的 browser 证据不代替 #451 写入链、#143 人类 Demo、#449 安装 Host 质量与 #73/R1 裁决。现有 #364 跟踪可选建会失败，不新增重复缺陷。

本层无待修缺陷；本次结论限定当前 immutable head 与直接 base。retarget/rebase/force-push 后重新锁定并复验，普通 PR/required 投影与 main 集成结论仍由当时平台状态确定。是否合并只由人类伙伴决定。


## 实际 main 整合复评

2026-11-02 21:37 +08，锁定本地候选 `0811933504afeda4dd4d32eacedfff67a256580d` / 直接 base `712ae31fba836e96a2afd305c2a70dfa7968a8f1`，检出 `.worktrees/composed-browser-ci`。现场远端 main 与该 base 相同；#503 已合入、#498 已 CLOSED，前文旧 head 的父层未闭合观察仅属于历史快照。本层仍为单一提交，代码128/文档314为本节加入前的提交规模；最终出版时重新计算含本节的规模。

独立核对 `range-diff` 和 source：CI YAML、`ci-browser-workflow.test.js`、CI 文档三个 blob 与旧批准 `0e0e7b3` 完全相同；README 相对实际 main 仅新增本层一行，没有丢弃 main 的索引。apps/packages、browser suite、两份 carrier、package/lock 逐字来自实际父层，无回退权限/恢复实现、无第二事实源。规则仍为两条执行 lane → 不执行候选代码的稳定聚合，main 触发及最小权限姿态未变。

在该候选根目录、直接 shell 使用 packageManager 声明的 pnpm 10.28.2，实际执行：

| 命令 | 本轮结果 |
|---|---|
| `CI=true pnpm install --frozen-lockfile` | exit 0，19 workspace、锁文件不变 |
| `CI=true pnpm verify` | exit 0；typecheck、主套件3385/3385与MVP-0 7/7，fail/cancel/skip/todo=0 |
| `CI=true pnpm test:file tests/contract/ci-browser-workflow.test.js tests/contract/workflow-check.test.js tests/contract/merge-gate-workflow.test.js` | exit 0，73/73，fail/cancel/skip/todo=0 |
| `node scripts/workflow-check.mjs` | exit 0，8文件、0 findings |
| `CI=true pnpm test:browser` | exit 0，7/7，fail/cancel/skip/todo=0，约7.1秒 |
| `node scripts/rule-checks.mjs disclosure 712ae31fba836e96a2afd305c2a70dfa7968a8f1`、`size`、`git diff --check <base>...HEAD` | 全部exit 0；五类发布面未见新增披露，Git通过Python subprocess argv只读调用 |

环境失败如实保留：首次用 Python subprocess 包装 pnpm verify 时，子进程误解析到外部 pnpm 11.25，额外安装并因未批准 build scripts 在测试前 exit 1，还附加两行 workspace 配置占位。已仅移除这两行附带变化，用直接 shell 的 pnpm10重新冻结安装并取得上表真实完整 GREEN；未批准额外构建脚本、未改变任何实现/配置，不能把首次环境失败当成已执行测试。上表验证后、添加本节前工作树完全干净。

旧11项变异与真实负控仍各归其固定 source：规则变异归原 `40f7116`，hosted 正控归 `3a4c552`、缺 binary 负控归 `ccf85de`，恢复绿归 `40f7116`。本轮 owning blob 全等，所以不重复旧变异表；这些旧平台运行不作为 `0811933` 的 hosted 结果。本轮实际执行了新父层组合的完整 verify 和7条真实 browser，不能仅由旧父层3380+7推断。

结论：当前 `0811933` 整合未发现新P0/P1，APPROVE。协调者并入本评审小delta后需重新锁定最终head，确认三个规则blob仍等同、发布面/规模/threads和实际新head Verify/Browser/Fast Gate后再按已授权流程收尾；非main旧栈dispatch不是自动触发证据。#450 的CI闭环不代替#451写入链、#143/#449安装人验或R1。除追加本节外，本评审没有保留实现、计划、配置或索引修改，也未Git mutation或远端写入。
