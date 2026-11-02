# PR #503 MMP 交付评审

观察日期：2026-11-02。检出 `test/composed-workspace-browser`；初始 head `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201`，base `fix/operation-runtime-browser` @ `b48dc2398c5d482a5ef028814e9e211a3c4ef040`。

## 先验风险矩阵

本矩阵在逐文件评审之前建立；各项为待证伪风险，并非已发现缺陷。

| 等级 | 代码与失败路径 | 产品闭环及 issue 验收 | 架构与状态所有权 | 测试、反例与设计 |
|---|---|---|---|---|
| P0 | 合并即破坏 main / 执行不可信代码 | 绕过发布硬门或伪造权威保存 | 凭据泄漏、第二规划事实源 | 门禁遇未知状态放行 |
| P1 | 丢失状态、取消/迟到资源泄漏 | 宣称未成立的用户闭环或关闭必要验收 | 跨层绕行、权限/代际围栏失效 | 关键故障绿测、聚合假成功 |
| P2 | 有界恢复或可维护性缺口 | 指南/操作证据轻微不一致 | 局部接口含混 | 非关键断言不足、重复设计 |
| P3 | 命名/冗余 | 术语、导航与可读性 | 无行为影响的组织问题 | 文档与诊断清晰度 |

## 分层证据与结论

结论：当前 immutable head 无新增 P0/P1/P2/P3。建议本层 `APPROVE`；这是本地浏览器能力评审，不是整个父栈或 R1 放行。评审者未修实现、提交 Git、写远端 review 或合并。

## 锁定事实

- 工作上下文：`.worktrees/composed-browser-read`，`test/composed-workspace-browser`。初始及验证后 `HEAD` 均为 `5f50b0da6ceedacc5b1c88b4afa7241da7f2c201`；直接 base 保持 `fix/operation-runtime-browser` @ `b48dc2398c5d482a5ef028814e9e211a3c4ef040`。仅一个交付提交，检出源码与远端 head 相同。
- 现场回读 PR 为 OPEN、Ready，`mergeable` / `mergeStateStatus` 均 UNKNOWN，不能据此称可立即合并。关联只 `Closes #498`；#450 保持 Refs。现有 reviews、inline comments、review threads、PR issue comments 均为空，threads 分页完整。
- 当前 head 的 commit check-runs 与实际 run 双向核对：CI run `41423088078` 的 Verify / PR Fast Gate、Merge Gate run `41423093411` 的 Integration / E2E / Boundaries / MVP-0 / 聚合均 success，事件是 `workflow_dispatch`。不能把它们写成本 PR 已持续调度 browser lane。
- `Create review session` run `41424970748` 为 failure：实际日志是本地端点拒绝连接、响应码 `000000`，与开放 #364 对应；这是可选建会，不替代代码验收。一次 engineering reconcile cancelled 后同 head 有多次 success（最新观察 run `41430385406`），不是源码失败。
- 相对直接 base：代码/测试/配置 347 行、文档 183 行，均为增删之和；lock 另审，精确 dev-only `playwright@1.64.1` 与 matching core，无额外运行依赖。本评审文档不在上述原始 PR 规模内，归档后须重算。

## 完整风险矩阵

| 层 | P0 / P1 结论 | P2 / P3 结论与证据 |
|---|---|---|
| 代码与失败路径 | 未发现破坏主线、数据或权限围栏的新增行为。fixture 的 rebuild 释放旧 installed/Host 并同库重建；默认路径不进入 showcase snapshot 分支 | `createLifetime` 先进入 closing，再逆序尝试全部释放；await 后发现已取消会释放晚到资源并拒绝，重复 close 复用同一 Promise。真实四阶段回归与短 timeout 反例通过 |
| 产品闭环 | 空库真实 UI 创建到 installed Host 和 SQLite 唯一记录；非空 Issue/Draft/遮蔽项、dialog/Escape/回焦、canonical/history/deep-link/reload/scope 拒绝、stale/重连、实际新 Host generation、撤权后 canary 不复活均可观察 | 创建先证空名不调用命令，再证有效输入只调用一次；撤权先证 canary 可见和 barrier 已进入，再查 DOM/AX、Back/reopen/reconnect、显式新权威读后恢复。没有把浏览器输入直接灌入 client store |
| 架构与状态所有权 | 生产 Host → controller → typed unary/watch → client supervisor/sync/store → ui-model/UI；Fake Provider 仅供输入与拒绝。无产品源码、Provider 依赖边、规划状态/工程状态、凭据或权威 Saved 语义变更 | `/projects/**` 只组合生产 History adapter 与页面，插件入口仍使用生产 apply；每入口一个 source/store。未把 Web history 冒称安装 Host 有地址栏/Back。边界 9/9 |
| 测试判别性与恢复 | 真实 Chromium 7/7；route、generation、permission、迟到 acquire 后代 mutant 都被对应具名用例杀死。空层、全 skip、缺 binary 均非零，无 fallback | 单删低 revision guard 仍存活；独立接受点/stream 单测保留其窄职责，不能将当前 browser 的 generation 负控写成该 guard 独立覆盖。未发现减弱断言以凑绿或复制第二业务 authority |
| 工作项及交付 | #498 本地子闭环可独立使用/撤销；#450 CI 接线由 #504 承担，父项不提前关闭。#472 的真实依赖与尚未合入事实保留 | ExecPlan 归档但明确区分历史工作副本证据、最终 head 与协调者远端责任；README 无空测试成功或 R1 误称。严格规模、发布面和差异检查通过 |

## 实际验证

以下均在本 worktree 根运行；临时证据根在命令中以 `$REVIEW_TMP` 表示，测试/变异产物不进入提交。未重复作者的全量 verify；当前 head 的 hosted Verify/Integration/E2E 已独立回读，评审运行最有判别力的相关层。

| 命令 / 探针 | 本次实际结果 |
|---|---|
| `pnpm test:browser` | 初次 7/7 / 8.89 秒；所有变异和故障负控结束后正常完整复测仍 7/7 / 11.58 秒，fail/cancel/skip/todo=0 |
| `pnpm test:file tests/e2e/runtime-access-browser.test.js` | 4/4，0 fail/cancel/skip/todo；严格 unary、真实 Host delta/拒读恢复、abort/hold、单权限键覆盖未退化 |
| `pnpm run boundaries` | 9/9，0 fail/cancel/skip/todo |
| `node --test tests/contract/run-test-layer.test.js tests/e2e/client-stream.test.js tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js` | 75/75，0 fail/cancel/skip/todo；包含同 generation 低 revision 拒绝、新 generation reset、迟到可见基线不能覆盖 redaction、close 后迟到帧不改 store、空/零/skip/todo/坏摘要 fail closed |
| `node scripts/review-mutate.mjs "$REVIEW_TMP/pr503-review-mutants.json"` | 基线和逐字还原后基线均 exit 0；4 KILLED、1 SURVIVED，整表 exit 1 如实表达存活项，未当成全 killed |
| `node scripts/review-mutate.mjs "$REVIEW_TMP/pr503-timeout-mutants.json"` | 针对创建用例临时改 100ms / 1ms，均由该用例 KILLED；基线及还原后基线绿，整批 exit 0 / 4.42 秒，自行退出，未触发 15 秒看门狗 |
| 从当前 `createLifetime` 原文执行清理错误探针 | pre-close 或 context release 抛错，page/context/browser/server 仍全部按逆序尝试；AggregateError 汇总，重复 close 不再释放，closed adopt 拒绝 |
| `PLAYWRIGHT_BROWSERS_PATH="$REVIEW_TMP/pr503-no-browser" node scripts/run-test-layer.mjs tests/browser "production browser missing binary must fail"` | 明确 missing executable，7 fail / 0 skip，exit 1，约 2.11 秒；无自动安装或系统浏览器回退 |
| `node scripts/run-test-layer.mjs <临时空目录或全skip目录> <invariant>` | 分别 exit 1；空目录无文件，全 skip 为 tests=1/skipped=1/执行0 |
| `node scripts/rule-checks.mjs disclosure b48dc2398c5d482a5ef028814e9e211a3c4ef040` / `size` / `git diff --check <base>...HEAD` | 均通过；人工五类目未发现真实凭据、本机身份、个人信息、内部系统或保密材料。测试公开数据与失败产物路径可分发；本轮生成的 route/generation/permission 截图和 trace 实际存在 |

缺 binary 的首次 `pnpm` 子进程被本机 package-manager 包装器的非 TTY 自动安装检查拒绝，不能归因为浏览器行为；表中使用 package script 的同一底层 Node runner 重新验证，才得到上述明确 binary failure。

## 最终树上的变异表

全部使用 `scripts/review-mutate.mjs`，每项 `killedBy` 都指向匹配具名测试；源码逐字还原后才接受结果。命令是完整 browser 文件，未用失败总数冒充归因。

| 变异 | 注入点 | 归因 / 结果 |
|---|---|---|
| `R503-route` | `packages/ui/src/item-route.ts` 移除 `port[kind](path)` | canonical history 具名例失败，KILLED |
| `R503-generation` | `packages/controller/src/queries.ts` 将每 Core UUID 固定 | held Provider / rebuilt Host 具名例失败，KILLED；这是代际唯一性，不是低 revision guard |
| `R503-permission` | `packages/core/src/runtime-access.ts` 的 `deny` 不再置 denied | 先可见/已 hold 的 permission canary 具名例失败，KILLED |
| `R503-lifetime-descendants` | `tests/browser/workspace-read.test.js` 晚到资源释放后返回、允许后代继续 | 四阶段 abort 具名例失败，KILLED |
| `R503-snapshot-guard` | `packages/client/src/sync.ts` 单独移除同代低 revision baseline guard | 7/7 GREEN、SURVIVED。合法流由旧 remote dispose/abort 和 follower 重开先阻断旧返回；计划已明确此边界。没有捏造不可能业务帧补杀 |

## 验收边界、设计判断与下一道门

已回读 #498/#450 原验收和 #451/#453/#457/#472/#364 的现有追踪。#498 所需创建/非空/导航/焦点、真实边界恢复/拒读、固定浏览器/无凭据/有界清理/负控都在本地成立。#450 仍需后继 #504 规则层与 hosted browser 证据，不能从当前普通 Verify 绿推断；#451 执行/PR/CI 用户流、#453 重复 fixture 退休、#143 Demo、#449 安装 Host UAT 和 #73/R1 均没有被本层替代。上游 #472 尚未合入是栈集成门，不是本层新增缺陷。

设计恰当：复用一个已有 carrier、一个 Node runner/非空协议，新增 29 行 Web 组合而不改插件导航；生命周期 helper 修复具体获取/取消竞态，没有引入通用资源框架。不存在为未来接口或兼容历史数据库的额外抽象。低 revision guard 的 browser 独立证据有限，但已说明保护分工且已有接受点反例；不应继续扩成伪造 snapshot 的第二权威。

最终验树：`git diff --exit-code` exit 0，tracked 源码已全部还原；`git status --short --branch` 仅本评审文档为 untracked，HEAD/base 未变，`git diff --check <base>...HEAD` exit 0。本记录未含本机绝对路径。

下一道门由协调者负责：归档本记录后重新计算文档规模/发布面，确认远端 head/base 未漂移、全部当前线程/checks，再提交单次整体 review。协调者已确认上游 #472 另有 P1 由另一会话处理；本层不替其复评或越过父栈合并。实际合并仍需人类逐 PR 授权及父栈顺序。任何 head/base 改变都使本记录的源码结论失效。

## 实际 main 重放组合复评

2026-11-02 SGT，锁定当前 `bdd4c6cc996f18f885d3ad2fdcabc358c4eb8106` / 实际直接base `4c30c1092524daba44346caf6a3bbf7c68cb49b1`，检出 `.worktrees/composed-browser-read`。以原cut `b48dc23`只重放本层一提交；carrier、Web entry、browser suite、package/lock blob均与原批准 `152e9de`一致。Host composition、runtime access、guarded Provider读与Delivery事实实现逐字来自当前已合入父层，没有回退C1/C2修复或引入第二authority。原记录的“#472 P1未闭合”仅属当时观察；现场#457已CLOSED，当前组合重新实际验证如下。

| 本worktree实际命令 | 结果 |
|---|---|
| `CI=true pnpm install --frozen-lockfile` | exit0；19个workspace，pnpm10.28.2，lock已同步，正常本地依赖准备，无NO_TTY失败或其它cwd替代 |
| `pnpm verify` | exit0；typecheck、主套件3380/3380和MVP-0 7/7，fail/cancel/skip/todo=0 |
| `pnpm test:browser` | 实际Chromium7/7，约7.62秒；六业务场景和四阶段迟到资源取消回归均执行，fail/cancel/skip/todo=0 |
| `pnpm test:file tests/e2e/runtime-access-browser.test.js` | 4/4，strict unary、真实watch/拒读恢复、abort/hold及单键权限均通过 |
| `node --test --test-timeout=30000 --test-name-pattern='actual refusal remains masked through a delayed committed marker acknowledgement\|complete proof clears a failed refusal mask\|failed actual refusal invalidates an older full read\|operation read denial shares durable Delivery health' tests/integration/runtime-delivery-access.test.js` | 7/7，Memory迟到marker ack、两adapter完整proof恢复和旧operation/fullread不复活均通过；0 fail/cancel/skip/todo |
| `pnpm run boundaries` | 9/9，0 fail/cancel/skip/todo |
| disclosure / size / `git diff --check`，均以当前base `4c30c109`为准 | 通过；代码347、归档前文档294增删行，lock另审；人工五类目无新增问题 |

README唯一冲突保留双方索引，将四项已为Completed且链接本就指向completed文件的记录移至Completed；未改四份计划正文，全部ExecPlan索引目标存在。新文档只记录实际base、直接用户接管授权及当前head/CI/关联回读门，没有扩大产品或人验接受。现场#498/#450仍OPEN；本层只Closes #498，#450持续CI由#504补齐，#143/#449/R1各自独立。测试前后`HEAD`未变、tracked源码diff为空；仅本addendum随后写入。未重跑整表mutants，原负控与低revision guard存活边界仍按原source记录，不冒称本轮新证据。

本轮完整矩阵结论 **APPROVE，findings=[]，无新增P0/P1/P2/P3**。真实当前权限owner与旧browser层组合成立；本轮是本地实际整合证据，不是hosted CI或人类UAT。协调者并入本addendum后须对最终仅文档head再次核产品等价、规模/发布面，并在发布后回读新head必需checks、全部线程与issue关联后按已授权流程收尾。未修改实现、计划、Git或远端。
