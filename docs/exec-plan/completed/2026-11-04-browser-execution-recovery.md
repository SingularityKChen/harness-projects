# 浏览器执行与 PR 恢复 ExecPlan

> 状态：Completed；创建：2026-11-04；执行分支：`test/browser-execution-recovery`。
> 范围：完整交付四个浏览器流程；PR `Closes #451`，`Refs #156`、`Refs #449`、`Refs #459`。
> 本计划依照根 `PLANS.md` 维护；公开前由协调者绑定 Draft PR 与 issue 关联。

## Purpose / Big Picture

用户点击开始工作、进入人工备用、创建 PR 或刷新交付状态时，浏览器必须展示 Host 已确认的事实。回执丢失、重复意图与重启之后，用户能读回同一结果；未知结果不能显示已保存或通过。成功的最小证据是四个具名真实浏览器流程同时核对 DOM、实际命令、SQLite 和外部副作用账单，并由删除真实防线的负控证明测试会失败。

本项是离线工程证据：真实 React、生产 apply/client/remote/Host/Controller/Core、临时 SQLite、真实 Local Git，加确定性的离线 PR 平台与执行端口。它不代表实际 GitHub 写入、模型调用、安装 Host 人类 UAT 或 R1 放行。

## Context and Orientation

事实：`tests/fixtures/execution-drawer-browser.mjs` 的 `startExecutionServer` 是既有唯一浏览器载体；`tests/browser/workspace-read.test.js` 已覆盖读取、断线、权限撤回和清理。2026-11-04 在本分支基线运行读取组，7/7 通过；实施前仍按本计划命令重读当前检出。

事实：现有非 empty/query 种子在页面打开前调用 `startWork`，且直接写 `fallback:true`；该种子不能证明 UI 命令或人工备用。catalog 每次重建创建新 Fake provider，现有 rebuild 还沿用 `fixture-peer`；写入恢复需保留外部状态并换新 peer。

入口导航：`apps/harness-plugin/src/client.ts` 装配产品命令；`host-operations.ts` 声明 wire；`host-composition.ts` 持有生产分发；`tests/integration/local-git-fixture.js` 提供临时 Git/argv 示例；`tests/fixtures/github-development-create.mjs` 提供实际 GitHub Development Provider 的离线平台。

假设：现有生产恢复语义足以满足 #451，主要增量在测试接线。未知：四个流程连同持久外部平台能否在 800 行 A+D 内闭合；Batch 1 必须验证，不将新增 helper 当作免费行数。

## Design / Spec

比较三案：新建独立应用或 fixture store 容易制造第二事实源，拒绝；真实 GitHub/模型网络引入凭据、费用和不确定性，拒绝；选择扩展同一 carrier，只有外部 Provider/传输被可控替代，生产快照和命令链复用。

新增 `execution` 种子，只创建工作空间、来源项、仓库/执行挂载；打开页面前 context、run、PR 对象与创建计数均为零。Local Git 在核对 realpath 的临时仓库及允许根内创建真实分支/工作树。执行主端口返回明确 unavailable 或 unknown；人工备用必须调用实际 human Provider，稳定测试 issuer 只在内存解析，不用 storage 写 fallback 冒充。

PR 使用实际 GitHub Development Provider 与离线 transport；外部 PR 对象集合独立于 Host 生命周期。创建成功后丢 ack，并暂时阻断 reconciliation，先断言“对象一个、产品未知”；恢复时关闭并重开 Host/SQLite，替换 peer，保留平台对象，通过原 operation 读回，不重新 create。

Delivery 的 failed/unknown/stale 和同作用域 passed 由 Provider 观察产生；UI 通过实际刷新命令读取。另一 workItem/repository/commit 的成功不得污染当前谱系。展示 scenario、client/store 直塞快照不参与权威验收。

键盘验收采用现有控件语义：打开抽屉、选仓库、填写表单、Escape、焦点返回 opener。故障同步靠可观察条件/hold，禁止固定 sleep。复用读取组的超时、abort 收尾、失败截图/trace 与禁止外网契约；不机械搬移整段旧 harness。

## Global Constraints

评审收尾写集扩展：`docs/review/pr-534-mmp-review.md`与本计划的最终评审/授权记录；不改变原能力范围。

唯一写集：`tests/fixtures/execution-drawer-browser.mjs`；按连续职责需要才新增 `tests/fixtures/composed-execution-platform.mjs`；`tests/browser/workspace-execution.test.js`；`tests/browser/README.md`；本计划。共享 `docs/README.md` 由协调者串行更新。其它两个 PR 不编辑本 carrier；本项不修改产品 API、schema、CI、依赖或其它测试套件。

代码/测试/config 的新增+删除目标 600–750、硬限 800；文档含计划/评审硬限 1300。若必要证据超限，保留测试，停在 Draft，按独立 execution 与 PR/delivery 闭环细化子 issue；不得删负控凑数。任何真实产品缺陷先记录根因与有界修复 issue，再重定所有权与预算。

未正式发布，不加兼容、双读写或实验库迁移。保留身份、权限、确认、事务和未知语义。临时密钥、session 地址、截图和原始日志只留忽略的运行目录；公开文件使用仓库相对路径。不得 merge、改 Project Status 或把 Ready 作为人类接受。

## Plan of Work

### Batch 1 · 未启动基线与红测

最小闭环：四个流程的前置条件与失败断言能阻止预造结果假绿。主文件为新增浏览器组和 carrier；先读取现有 API，增加未启动种子，记录零 context/run/PR。写 Start Work/fallback 与 PR 中间未知状态的红测，再补 Delivery 非空正控和坏状态矩阵。

在检出 `test/browser-execution-recovery` 的工作树根运行：

    pnpm test:file tests/browser/workspace-execution.test.js

期望：真实未接线点以具名断言失败；不能因导入、语法、无测试或超时算红测。记录失败名与预算估算。回滚为撤回本批未提交测试增量，不接触已存在资源。

### Batch 2 · 持久平台与真实副作用接线

最小闭环：四个 UI 流程经同一生产链可恢复。主文件为 carrier、可选平台 helper 与浏览器组。保留外部 PR 平台、真实 Git、稳定 issuer；rebuild 必须使原 Host/SQLite 句柄关闭并以新 peer 重开。重复开始/重复 PR 意图不增加 run/worktree/PR。

先跑上条浏览器命令，期望四个具名流程非空、无 skip、零外网；再运行：

    pnpm test:file tests/integration/harness-plugin-start-work.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/harness-plugin-delivery-lineage.test.js

期望既有生产语义全部通过；重启后原 operation/input/source identity 不变。回滚为撤回本批接线，仅清理本例 realpath 落在临时根内的资源。

### Batch 3 · 对抗、回归与可审阅交付

最小闭环：独立验收者能推翻失效实现。主文件为浏览器组、README 与本计划。在私有副本依次删除真实 startWork dispatch、使 resume 错走 create 或移除确认防线；对应具名测试必须非零失败，复原后再跑正常组。不得提交 mutation 框架。

在同一分支根运行：

    pnpm test:browser
    pnpm run typecheck
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望读取与执行浏览器组全部通过、无 skip；两个 mutant 被指定断言杀死；发布面机械/五类人工扫描通过，另按用户 800/1300 较严预算分类求 A+D。提交前及最终 push 前整理提交。最终 exact head 的 hosted checks、issue 关联、所有线程回读通过才 Ready；本 PR 完整满足原 AC 才 Closes #451。回滚为独立 revert 本 PR。

## Validation and Acceptance

| 名称 | 用户可观察结果 | 判定证据 |
|---|---|---|
| Start Work | 未启动项经真实点击生成唯一上下文/run，分支与工作树存在；重复意图只读回 | DOM、remote startWork 账单、SQLite ID、Git 磁盘/登记四者一致 |
| Manual fallback | 明确未接纳的主启动失败才人工备用；unknown 不启动备用 | 实际 human Provider 调用及 run.fallback、主/备用计数；unknown 零备用 |
| Safe PR recovery | 创建未知时不显示已确认，重启/新 peer 后恢复同一 PR | 外部对象始终 1、原 operation/input/fingerprint、无第二 create |
| Delivery truth | failed/unknown/stale 不呈现通过，同作用域 passed 为非空正控 | 实际刷新请求与 Provider 观察；异作用域成功负控 |
| Keyboard / identity | Tab/Enter/Space可打开drawer/表单；原生select键盘选择、输入/提交、Escape与焦点正常，保持来源身份 | Chromium真实键盘、activeElement/selected value及实际持久实体断言 |
| Adversarial | 删 dispatch 或确认防线会失败，复原成功 | 隔离 mutant 的非零退出、失败名与恢复后的通过记录 |

独立验收者逐行核对“测试证明的层级”和“尚缺 installed/human/真实平台证据”；不能用 mock 计数替代真实 Local Git，也不能把 SQLite 重开写成产品安装。

## Progress

- [x] (2026-11-04 14:42 SGT) 完整阅读两份独立设计、生产 carrier 和仓库规则，完成第三方设计综审。
- [x] (2026-11-04 14:42 SGT) 基线读取组已有本分支 7/7 通过记录；未实施执行组。
- [x] (2026-11-04) Batch 1：协调者建立 Draft #534 并回读 Closes #451；四个红测均在 context 1≠0 前置断言失败，证明旧种子预造结果不能假绿。
- [x] (2026-11-04) Batch 2：四流程通过；实际 Local Git、人类备用、原请求持久恢复及 CI 坏状态由各层证据核对；相关集成28/28通过。
- [x] (2026-11-04) Batch 3 本地：全浏览器46/46、typecheck、两项生产 mutation 的判别断言和私有副本复原4/4通过；交协调者执行 fresh independent acceptance。
- [x] (2026-11-04 15:58 SGT) 最终交付门：当前 head 的独立验收、hosted checks/threads/issue 回读与 Ready，由协调者负责。

## Surprises & Discoveries

Fix round1：独立评审在119b0a0d给生产开始工作按钮设置tabIndex=-1并阻止keydown，旧四flow仍4/4，证明原键盘验收不完整（P2）。原实现的鼠标/数据证据不受影响，但“完整键盘操作已覆盖”的推断撤回，Superseded by 本段与修复后的当前测试（2026-11-04）。首flow现从真实Tab/Enter打开drawer开始，再Tab/Space展开表单；原生select由键盘typeahead+Tab选择并断言实际value，branch键盘输入、Tab/Enter提交；没有测试程序化focus。浏览器native select的实际selected值是工程证据，不代表OS原生弹出菜单人工验收。修复后仍须独立复评，不能将implementer自测标记review clean。

既有读取种子直接预造执行结果；Fake catalog 重建与固定 peer 会使恢复测试绕过真正困难路径。证据是 carrier 的 `createExecutionFixture`、`rebuild`，因此写入种子不可沿用默认预热。

接线调查：GitHub Provider 不在对象属性上公开 bindingId，必须按已知持久 binding 显式装配，不能用可选对象属性搜索后悄悄禁用挂载。Core PR 正文会添加协议 operation marker，测试核对用户正文空白与 marker 形状，并在恢复前后比较完整不可变输入。Delivery 当前合同按 commit 归属，因此负控使用异 commit/repository 和另一未开始工作项，不把同 commit 的另一个 branch 擅自定义为外来 CI。以上均为夹具/测试假设修正，没有观察到产品缺陷。

真实 Git 示例的准确路径是 `tests/integration/local-git-fixture.js`。现有 7 个读取测试通过只作为基线，不证明四个新增写入流程。

## Decision Log

Decision：保留同一 carrier 与生产应用链，外部平台跨 Host 重开存活。Rationale：重启清空平台会掩盖重复创建；第二快照源会失去证据意义。Date/Author：2026-11-04 14:42 SGT / 独立设计综审。

Decision：坚持真实 Local Git 和实际 human Provider，不删必要负控；预算不足时精确拆分。Rationale：局部 seam 允许替身，不能让表层成功替代原 issue 的恢复闭环。Date/Author：2026-11-04 14:42 SGT / 独立设计综审。

## Idempotence and Recovery

每例独立临时目录、SQLite、Git 仓库与平台对象，可重复执行；同例重试保留原 intent。结束先释放 holds/streams、await Host/DB/browser 关闭，再清理核对过的临时根。超时也沿同一 abort 收尾，不因断言失败遗留子进程。

mutant 用独立副本并先记当前检出；不改共享工作树。发现重复、虚假成功或 unsafe replay 即保留失败证据，恢复原副本后复跑；不能清空数据库让同例重试过绿。发布后回滚用单 PR revert，不删除用户或远端对象。

## Interfaces and Dependencies

依赖仓库锁定的 Node/pnpm、Chromium/Playwright、Git、生产 SQLite/Host 与现有离线 Provider fixtures。运行 `pnpm install --frozen-lockfile` 仅在本工作树依赖缺失时需要；本次协调者已完成安装。无 GitHub/模型凭据；所有业务网络拒绝。

上游 `#449`、`#459` 与 R1 仍由各 owner 判定。本项的测试数据不写外部平台或 Project；远端 Draft、回复、Ready 由协调者记录 actor/目标/幂等键/ack。

## Outcomes & Retrospective

本地实现交付四个具名写入/恢复流程，未修改产品 API、schema、依赖或 CI。实际 Git/SQLite/Host 链与合成 PR/CI、离线执行端口的证据边界已分开；真实平台、安装 Host 与人类 UAT 仍未由本项建立。最终独立验收、hosted checks 与 Ready 由协调者继续（Superseded by 本节工程验收收敛，2026-11-04 15:58 SGT），不能把本地绿测写成 #451 已关闭或 R1 满足。

在本分支检出根，基于计划提交 `2eec7dfa` 加本次受限写集的本地候选，`pnpm test:browser` 为46/46，相关四文件集成为28/28，`pnpm run typecheck`退出0；全部无skip/todo。私有副本删掉真实Host Start Work dispatch，具名流程在context数量0≠1断言失败；Core resume错误重发create，PR流程在平台mutation请求2≠1断言失败；复原副本后四流程4/4通过。原始运行记录仅留忽略的SDD目录。以上是执行时观察，最终head与差异规模由协调者按本计划命令重新锁定，不能把未执行的hosted验证写成通过。

### 工程验收收敛（2026-11-04 15:58 SGT）

在本分支工作树根，以已独立验收的capability `5333f433257ff1230318cc7052a920804fc216b1` 回读PR #534：必需PR Fast Gate与实际Verify、Browser、Merge Gate执行lane通过，issue闭合关联及全部review threads已核对，远端已为Ready。独立首评发现的键盘覆盖P2已补齐，原变异被具名Tab断言杀死；独立复评四流程4/4，既有全浏览器46/46与相关集成28/28证据保留。真实平台、安装Host与人类UAT/R1仍不在本闭环内。

本次归档只改文档；相对上述capability的所有非docs文件逐字节不变。最终文档head的易失状态按 `gh pr view 534 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences` 及 `gh pr checks 534 -R SingularityKChen/harness-projects --required` 回读，期望Ready且所需检查通过，不沿用历史head的绿灯。没有新增本实现引入的维护债；原有产品/人工门由其issue继续拥有。

## Bottom Change Note

2026-11-04 14:42 SGT：依据两份独立设计及第三方综审建立初版；明确零预造结果、平台持久、新 peer/SQLite 重开、真实 Git、人类备用和严格预算。

2026-11-04：执行 Batches 1–2，记录四项判别红测、四flow绿测、相关集成与夹具合同修正；保留独立验收/hosted/人类门。

2026-11-04：完成本地46项浏览器、28项集成、typecheck及两个生产防线负控/复原验证；将独立验收与远端Ready明确保留为下一门。

2026-11-04 fix round1：按独立评审P2补全首flow真实Tab/Enter/Space、原生select键盘选择及输入提交；保留全部故障与SQL/Git/remote/identity判据，等待exact-head独立复评。

2026-11-04 fix round1本地验证：四flow4/4、受影响全browser46/46；独立评审原KEYBOARD_START_UNREACHABLE spec在私有副本返回KILLED，harness包含四flow正常基线、字节复原与复原后四flow；原始证据保留SDD目录。独立复评仍待执行。

2026-11-04 15:58 SGT：协调者收敛独立验收、当前capability托管门禁与Ready后归档；最终文档head继续执行回读门，不改变产品代码或人类判定。

2026-11-04：本会话用户明确对PR #534/#535/#536/#541给出无P0/P1且独立复评通过后的rebase merge条件授权；本PR完整矩阵无新增P0–P3，初始APPROVE已由评审账号提交。原三个过程提交将整理为一个能力提交，备份ref与精确lease保留恢复路径。评审记录随本PR交付；最终head的checks/threads/issue关联仍须重新回读，不沿用初始head批准。
