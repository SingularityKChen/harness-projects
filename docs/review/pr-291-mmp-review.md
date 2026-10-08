# PR #291 MMP 评审记录

## 锁定事实

- PR #291「feat(core): 同域多个 Development 绑定按仓库路由」，Closes #219；标签 kind:feat、area:capabilities、area:core、area:exec-plan。
- 第一轮评审 head `eccfab2b`，merge-base `6417d459`，draft；评审时 main 为 `ce423d9d`，测试合并无冲突。3 个提交（规划 / 代码 / 回填）；代码 508/1000、文档 870/1500。
- 评审账号：Singularity-AI-Bot。

## P0–P3 风险矩阵

| 层 | 结论 |
|---|---|
| 代码 | P0 / P1 无。路由按持久化身份选挂载；歧义、缺路由、零挂载都在 provider 调用前拒绝；不改道；key 级解析在多挂载时 fail closed；写尝试记在路由到的连接。P3：歧义 conflict 的恢复动作是 `reapply`，重放必然再失败 |
| 产品闭环 | P2：多挂载时元数据报 `development.*` 不可用，而 `startWork` 成功，谱系只剩两跳；接手条件不在 #127 / #142 的验收里；目前没有生产路径组装多挂载 |
| 架构 | 依赖方向不变，`routeDevelopment` 是唯一写路由点，ADR-0006 的「启用默认唯一」仍成立。P3：K3 路由缝的接线没有机械护栏 |
| 测试 | 两种 Storage 都跑；独立变异 18/18 全红 |
| 工作项 | #219 验收 1–3 满足；TD 号段无碰撞；ExecPlan 状态行与 README 索引过期，文档行数与实测不符 |

## 关键证据

- 复跑：head 1241/1241；测试合并 1333/1333（main 1298 加 35）；与 #290 的并集 1383/1383；mvp0 7/7；typecheck、boundaries、disclosure、diff-check 通过；测试合并上 #288 的 Development 契约套件与 liar 矩阵全部通过。
- R1 三边复现：base `failed failed not_found failed`；head 与合并 `ready unknown result_unknown ready`，新连接零调用。
- 单挂载差分：354 个用例中，base 与 head 的错误码、恢复动作、文案、provider 调用序列与写尝试账本逐行相同。

## 整体结论

APPROVE，0 × P0 / P1、1 × P2、4 × P3。合并前需要：人类裁定 D6 / D7 / D9 / D19（以及可推翻的 D2 / D3 / D14）；在 #127 / #142 写决策评论并补验收；定下 K3 的合并顺序与接线方；归档提交顺带修复 P3；rebase 到最新 main 并复跑。

## 修复轮（2026-10-08）

评审 5455297771（APPROVED）的 1 × P2、4 × P3 逐条处理。修复者在 `.worktrees/development-repository-routing` 内工作：先建恢复锚点 `backup/development-repository-routing-pre-review-rebase`（`eccfab2b`，当时的远端 head），再 rebase 到 `origin/main@a357ef8c`——无冲突，`git range-diff` 三个提交都是 `=`；rebase 之后全量 1350 / 1350（`origin/main` 导出树 1315 / 1315，差正好是本 PR 的 35 条）。

| # | 级别 | 发现 | 处置 | 证据 |
|---|---|---|---|---|
| 1 | P2 | 多 Development 挂载时 Host 自相矛盾（`startWork` 成功，元数据却把 `development.*` 全报 `unavailable`），TD-035 的接手条件不在 #127 / #142 的验收里 | 人类裁决（ExecPlan D23）：#127 / #142 的决策评论与验收由协调者写——元数据按绑定给出，以「绑定仓库」恢复动作取代 `reapply`；ExecPlan 的 Purpose 写明「Local Git 与 GitHub」指各管不同的仓库、同一仓库的并列引用归 #127；TD-035 的「下一步」改写指向这两条承接。不改代码（K3 不让本 PR 动 `queries.ts`） | `grep -n "^| TD-035" docs/exec-plan/tech-debt-tracker.md`；ExecPlan `Purpose / Big Picture` 第二条与 `Decision Log` D23；决策评论以 `gh issue view 127 -R SingularityKChen/harness-projects --comments`、`gh issue view 142 …` 回读 |
| 2 | P3 | K3 路由缝的接线没有机械护栏，并集预演基线过期 | 人类裁决（D23）：合并顺序 #290 → #291 → #292，接线与正例由 #292 在 rebase 到 main 时承担，#292 的正例必须在缝没接上时变红；本 PR 不接线（Superseded by 第二轮修复 #3 与 ExecPlan D27：接线与正例改由 #297 承担，#292 不再等本 PR）。D23、K3 条目、TD-037 的「下一步」与验收第 10 行同步；I1 的缺口断言保留，用例名与注释写明接线前后都成立、不是接线的护栏。预演基线以 rebase 之后的回读为准 | `grep -n "接线前后都成立" tests/integration/provider-binding-registration.test.js`；`git diff origin/main...HEAD --stat` 不含 `chain-facts.ts`；全量 1350 / 1350 |
| 3 | P3 | 歧义与缺路由的恢复动作是 `reapply`，重放必然再失败；文案把内部 issue 号当指引 | 人类裁决（D23）：D6 的错误码与恢复动作保持原样，「绑定仓库」恢复动作随 #127 / #142；修复（D24）：两条文案改成用户能执行的动作且不含 issue 号（Superseded by 第二轮修复 #1：这一版的动作仍然不存在，已重写）——歧义时「先把这个仓库绑定到其中一个 Development 连接再开始工作」，缺路由时「先让原来的 Development 连接以原绑定 id 挂回来，或把这个仓库重新绑定到当前的 Development 连接」，保留「不取第一个注册者」「绑定 id 变了」 | E2、E3 断言新文案并禁止 `#\d+`；变异 M43、M44 各红 2 条（替身与 SQLite 各一）；四文件命令 163 / 163 |
| 4 | P3 | ExecPlan 状态行与「未做」仍写「整合、推送待做」，与 Progress 相反；行数没有观察时刻与 head | 修复：状态行、「未做」与规模段改写成事实并就地标 Superseded；行数改成回读命令加带树标识的观察（树对象在整合提交后不变） | ExecPlan 状态行、`Outcomes & Retrospective` 的「未做」与「规模」条；评审者在 `eccfab2` 上实测文档 870 而不是 868 的订正也在其中 |
| 5 | P3 | `docs/README.md` 索引状态列「待整合推送与评审」已过期 | 修复：评审已 APPROVED、只剩 P2 / P3，随 PR 归档——计划移到 `docs/exec-plan/completed/`，索引行移到 Completed 表，全仓引用（控制计划两处、技术债务表五行、计划内副本）改为 completed 路径 | `git grep -n "exec-plan/active/2026-10-08-development-repository-routing" -- . ':!docs/review'` 无输出；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` 通过 |

## 修复轮验证

（第一轮修复时的观察；第二轮修复之后的数字见下面「第二轮修复」一节。）

- 在检出本分支的工作树根目录（基线 `origin/main@a357ef8c`；被验证的代码由 `git rev-parse HEAD:packages HEAD:tests` 标识）：`tsc --noEmit` 无输出；四文件命令 163 / 163，五文件 170 / 170；`tests/contract`、`tests/integration`、`tests/e2e` 1350 / 1350；`tests/mvp0` 7 / 7；包边界 8 / 8；R1 复现输出 `saved` 与 `ready unknown result_unknown ready`。
- 变异表 M1–M44 在 `git archive HEAD` 导出树上整表重跑：每条先用 `cmp` 与 `git diff --no-index -U0` 证明已生效，点名的用例都在红集合里，红的条数与表中「实测」列逐条相同；还原后 163 / 163；导出目录用完已删除。
- `size origin/main`、`disclosure origin/main`、`workflow-check`、`git diff --check origin/main...HEAD`、ExecPlan lint 的数字见 ExecPlan `Artifacts and Notes` 的「评审修复轮的复跑」，不在这里重复（易失值只写一处）。

## 修复轮结论与待办

- 本轮代码改动只有两条 conflict 文案、两条文案断言以及 I1 的用例名与注释；错误码、恢复动作、可重试性与路由行为不变。
- 修复本身（文案、断言、文档重写）尚未经独立复评；按「修复本身也要独立复评」，建议整合推送后由评审账号在新 head 上复跑 M43、M44 并回读文案。
- 待协调者：整合本轮提交并推送，推送后回读 head、base、checks、issue 关联与评审线程，逐条回复并 resolve；在 #127 / #142 写决策评论并补验收（D23）；更新 PR 描述里的合并顺序。Superseded by 第二轮修复：决策评论与验收框已写、已加（D26）；PR 描述要改的不止合并顺序，清单见「第二轮结论与待办」。
- 待 #292：rebase 到 main 时接线并带正例（D23）。Superseded by D27（第二轮修复）：接线与正例改由 #297 承担，#292 不再等本 PR。合并由人类伙伴决定，rebase merge。
- 新 head：本记录所在的提交即修复后的 head（提交无法记录自身的 SHA），具体 SHA 以 PR #291 推送后的回读与本轮线程回复为准。

## 第二轮修复（2026-10-08）

第二轮评审（Singularity-AI-Bot）的 5 × P3 逐条处理。修复者在 `.worktrees/development-repository-routing` 内工作：先建恢复锚点 `backup/development-repository-routing-pre-rr2`（`cbc767b1`，第一轮修复后的 head），本地小提交，不 push、不写 GitHub。

| # | 级别 | 发现 | 处置 | 证据 |
|---|---|---|---|---|
| 1 | P3 | 两条 conflict 文案许诺的动作今天都不存在：没有绑定仓库的命令，「重新绑定到当前连接」会被 `Storage.putRepository` 拒绝 | 属实。评审者的探针在 `cbc767b1` 的导出树上复现（`CoreCommands` 只有六个命令；改绑被拒；只挂载拥有仓库的连接开始一次再挂回全部走得通）。文案按今天走得通的路径重写（ExecPlan D25）：歧义 =「先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来」；缺路由 =「只能让原来的 Development 连接以原绑定 id 挂回来」，并明说本版本还不能改绑。不含 issue 号，不承诺不存在的命令。E2、E3 钉新文案并禁止「绑定仓库」「重新绑定」；新增 E15 逐字执行歧义三步，E3、E7 末段在被拒之后把原连接挂回来 | 红：只改 E2、E3 的期望并新增 E15，39 条里 6 条失败；绿：改两条文案后 39 / 39；变异 M43–M48 各红（4、2、4、2、2、2 条）；歧义三步与缺路由的恢复在替身与 SQLite 上都走通 |
| 2 | P3 | TD-035 写「已补验收」，#127 / #142 的验收框都没改，#142 的决策评论也没有「按选中仓库的路由结果判定开始工作是否可用」 | 属实。先按事实订正（只有评论 id），随后人类裁决「Add both (Recommended)」，协调者已在两个 issue 的 Acceptance criteria 末尾各加一条验收框（ExecPlan D26，原文在其中）；TD-035 写成事实：先有决策评论（#127 issuecomment-6058141177、#142 issuecomment-6058141929），再补验收框 | `gh issue view 127 -R SingularityKChen/harness-projects --comments`、`gh issue view 142 …` 回读验收框；`grep -n "^| TD-035" docs/exec-plan/tech-debt-tracker.md` |
| 3 | P3 | K3 交接只记在 #291 这一侧：#221 无记录，#292 的 PR 描述写着相反的安排 | 属实。人类裁决「Separate small PR (Recommended)」：接线与正例改由新 issue #297（`feat(core): route delivery lineage reads through repository routing`，#216 的子 issue）承担，等 #219 与 #221 都进 main 之后再做；#221 已写决策评论 issuecomment-6060231866；#292 不再需要等 #291（ExecPlan D27）。TD-037、D23、K3 条目、验收第 10 行、交接表与 I1 用例注释就地更正或标 Superseded | `grep -n "#297" docs/exec-plan/tech-debt-tracker.md tests/integration/provider-binding-registration.test.js`；`gh issue view 221 -R SingularityKChen/harness-projects --comments`；`gh issue view 297 …` |
| 4 | P3 | 规格里 `routeDevelopment` 的代码副本还是旧文案，没有标 Superseded | 属实。代码块下方就地标「Superseded by D24 / D25」，给出现行两条文案的句尾，其余以代码为准（代码块本身保留首版以便对照） | ExecPlan `Design / Spec` 路由一节代码块之后的标注 |
| 5 | P3 | PR 描述多处是第一轮的事实（回滚点名的提交、路径、计数、待确认项、闭环、控制计划验收行） | PR 描述由协调者改；本记录里与当前提交不符的计数、结论与待办已就地更正（第一轮的数字标明是第一轮的观察，第二轮的数字在下面）。「控制计划验收第 5 行」核对为：控制计划验收表里「两个 Development 实现可共存且路由明确」是 `| 4 |` 行，本计划验收表里与它对应的是第 5 行，仓库文档写的都是「控制计划验收第 4 行」，写成「第 5 行」的只在 PR 描述里 | `sed -n 255p docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`；ExecPlan 头部关联行与验收第 5 行 |

## 第二轮修复验证

（第二轮修复时的观察；第三轮修复之后的数字见下面「第三轮修复验证」。）

- 在检出本分支的工作树根目录（基线 `origin/main@a357ef8`；被验证的代码由 `git rev-parse HEAD:packages HEAD:tests` 标识）：`tsc --noEmit` 无输出；四文件命令 165 / 165，五文件 172 / 172；`tests/contract`、`tests/integration`、`tests/e2e` 1352 / 1352（`origin/main` 同一命令 1315 / 1315；导出树里两边都跳过依赖 `.git` 的那条 CLI 用例后差正好是本 PR 的 37 条，口径见 ExecPlan）；`tests/mvp0` 7 / 7；包边界 8 / 8；R1 复现输出 `saved` 与 `ready unknown result_unknown ready`。
- 变异表 M1–M48 在 `git archive HEAD` 导出树上整表重跑：每条先用 `cmp` 与 `git diff --no-index -U0` 证明已生效，点名的用例都在红集合里，红的条数与表中「实测」列逐条相同；还原后 165 / 165；评审者的 `mutate.mjs`（X1–X18 与文案变异，文案锚点改成新文案）：22 条（X1–X18、M43、M44、Y1、Y2）全部 KILLED，点名的用例都在红集合里；基线 165 / 165，还原后 165 / 165。
- `size origin/main`、`disclosure origin/main`、`workflow-check`、`git diff --check origin/main...HEAD`、ExecPlan lint 的数字见 ExecPlan `Artifacts and Notes` 的「第二轮评审修复的复跑」，不在这里重复（易失值只写一处）。

## 第二轮结论与待办

- 本轮代码改动只有两条 conflict 文案、E2 / E3 / E7 的断言与新增的 E15，外加 I1 的一条注释；错误码、恢复动作、可重试性与路由行为不变。
- 修复本身（文案、新用例、变异）尚未经独立复评；按「修复本身也要独立复评」，建议整合推送后由评审账号在新 head 上复跑 M43–M48、逐步执行两条文案的走法，并回读文案原文。
- 待协调者：整合第二轮提交并推送（协调者把它们整合进现有三个提交，整合后比对新旧 head 的文件集合），推送后回读 head、base、checks、issue 关联与评审线程，逐条回复并 resolve；重写 PR 描述（它是发布面，重写后按 publication 流程用 `PR_BODY` 重新扫描一次）：
  1. 「风险与回滚」：改为 revert 现在的提交，或 revert 整个 PR，不再点名已不在分支上的 `cb0ed3f` 与 `eccfab2`；
  2. 「关联」：ExecPlan 路径改为 `docs/exec-plan/completed/…`，删去「归档在人类评审、合并后进行」；
  3. 验证证据表：换成本记录第二轮的回读，或只保留一处并指向 ExecPlan，不再并存 1241、508 / 868、M1–M42 与 1350、512 / 970、M1–M44 两套数字；
  4. 「需要人类确认」：D7、D9、D19、D2、D3、D6、D14 已由 D23 裁定保持原样，只剩 D10；
  5. 「控制计划验收第 5 行」改为第 4 行（或「本计划验收第 5 行」）；
  6. 「闭环」与合并顺序：K3 接线改成 D27 的 #297，#292 不再等本 PR。
- 合并由人类伙伴决定，rebase merge。
- 新 head：本记录所在的提交即第二轮修复后的 head（提交无法记录自身的 SHA），具体 SHA 以 PR #291 推送后的回读为准。

## 第三轮修复（2026-10-08）

第三轮评审（Singularity-AI-Bot）的 4 × P3（其中 1 条非机械）逐条处理。修复者在 `.worktrees/development-repository-routing` 内工作：先建恢复锚点 `backup/development-repository-routing-pre-r3`（`482c5dc3`，第二轮修复后的 head），本地小提交，不 push、不写 GitHub。

| # | 级别 | 发现 | 处置 | 证据 |
|---|---|---|---|---|
| 1 | P3 | 「只写走得通的步骤」只靠禁词表守：在句尾追加一个动作（Y3 缺路由追加「改挂到当前的 Development 连接」、Y4 歧义追加「在设置里为它选一个连接」）四文件命令全绿 | 属实。评审者的 `mutate3.mjs` 在 `482c5dc3` 的导出树上复现（两条都 SURVIVED 165 / 165）。E2、E3 各加一条 `$` 锚定、从判别措辞到句尾的相等断言（常量 `AMBIGUOUS_ACTION`、`MISSING_ROUTE_ACTION`），禁词表保留作补充；ExecPlan D25 与 Surprises 里的「反向钉住」就地订正为「句尾逐字锚定」（D28） | 加断言后基线仍 165 / 165；Y3、Y4 各红 2 条（变异表 M49、M50），M47、M48 照样各红 2 条 |
| 2 | P3（非机械） | 歧义文案让用户做一次本版本撤不回的登记，却没说：两个连接都能服务同一个仓库时，第一次选择就是永久的；缺路由文案自己写着还不能改绑，可这句只出现在事后那条拒绝里 | 属实；协调者决定补一句，写法对齐缺路由文案。歧义文案在步骤之前加「也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：」，步骤原文不动；仍无 issue 号、不承诺不存在的命令；错误码、恢复动作、可重试性与路由行为不变。E2 断言提示在步骤之前，E15 断言提示先于三步（D28）。否决了「只在 D25 记一笔不提示」与「把用它开 PR 写进文案」 | 红：只改 E2、E15 的期望，165 条里 4 条失败；绿：改文案后 165 / 165；变异 M51 去掉提示红 4 条；评审者的 `steps.mjs` 在修复前后的导出树上结果相同（B1 登记在 dev-a 后，B3 想换到 dev-b 得到 `conflict`），修复后 A0 / B0 的歧义文案多了这句提示 |
| 3 | P3 | 变异表下的说明还写着 M12 红 119 条、M31 红 102 条；方法段落还是 42 条、163 | 属实。改为 M12 红 121 条、M31 红 104 条，方法段落改为 51 条、165 | 变异表整表重跑，红的条数与「实测」列逐条相同（M12 121、M31 104） |
| 4 | P3 | Surprises 里的正例还写着「由接线方 #292 带（D23）」，没有按 D27 更正 | 属实。就地改为「由接线方带（D23 原定 #292，Superseded by D27：更正为 #297）」 | `grep -n '#292' docs/exec-plan/completed/2026-10-08-development-repository-routing.md`：每一处都带 D27、Superseded、更正或「不再」字样 |

## 第三轮修复验证

- 在检出本分支的工作树根目录（基线 `origin/main@a357ef8`；被验证的代码由 `git rev-parse HEAD:packages HEAD:tests` 标识，`fa8359e`、`15946a6`）：`tsc --noEmit` 无输出；四文件命令 165 / 165，五文件 172 / 172；`tests/contract`、`tests/integration`、`tests/e2e` 1352 / 1352；`tests/mvp0` 7 / 7；包边界 8 / 8。
- 变异表 M1–M51 在 `git archive HEAD` 导出树上整表重跑：每条先用 `cmp` 与 `git diff --no-index -U0` 证明已生效，点名的用例都在红集合里，红的条数与表中「实测」列逐条相同；还原后 165 / 165；评审者的 `mutate3.mjs`（X1–X18、M43r2、M44r2、Y1–Y5、Z1 加表里的 51 条，M43r2 的锚点改成新文案）77 条全部 KILLED。
- `size origin/main`、`disclosure origin/main`、`workflow-check`、`git diff --check origin/main...HEAD`、ExecPlan lint 的数字见 ExecPlan `Artifacts and Notes` 的「第三轮评审修复的复跑」，不在这里重复（易失值只写一处）。

## 第三轮结论与待办

- 本轮代码改动只有歧义那一条 conflict 文案；测试只改断言（E2、E3 的句尾锚定，E2、E15 的提示断言），用例数不变；错误码、恢复动作、可重试性与路由行为不变。
- 修复本身（新文案、句尾锚定断言、M49–M51）尚未经独立复评；按「修复本身也要独立复评」，建议整合推送后由评审账号在新 head 上复跑 M47–M51、`steps.mjs`，并回读歧义文案原文。
- 待协调者：整合第三轮提交并推送（整合后比对新旧 head 的文件集合），推送后回读 head、base、checks、issue 关联与评审线程，逐条回复并 resolve；PR 描述若引用变异表范围（M1–M48）或歧义文案原文，同步改为 M1–M51 与新文案，重写后按 publication 流程用 `PR_BODY` 重新扫描一次。
- 合并由人类伙伴决定，rebase merge。
- 新 head：本记录所在的提交即第三轮修复后的 head（提交无法记录自身的 SHA），具体 SHA 以 PR #291 推送后的回读为准。
