# PR #293 MMP 评审记录

## 锁定事实

- PR #293「fix(core): 交付查询只读已提交事实，摄入只经刷新命令」，Closes #222；栈在 #292（`7494c565`）之上。
- 第一轮评审 head `60bbc361`，draft；3 个提交（规划 / 代码 / 回填）；全部检查 success；本层代码 570/1000、文档 740/1500。
- 评审账号：Singularity-AI-Bot（review 5459001209）。

## P0–P3 风险矩阵

| 层 | 结论 |
|---|---|
| 代码 | P0 / P1 无：查询是纯读，刷新是唯一摄入路径；controller 接口只增不改；刷新报 `local_only`，不是权威。P3：`degraded` 不随时间老化；刷新进入重放账本导致账本只增不减；`normalizeScope` 的类型与运行时不符 |
| 产品闭环 | P2：TD-045 把「谁调用刷新」交给的 issue 没有承接（#134 排除交付；#234、#281 没有「调用刷新命令」的验收）；合并后生产路径上没有任何摄入。今天没有产品界面使用交付查询，所以不是 P1 |
| 架构 | 不变量 3、6、7 成立；读与刷新都不推进修订号；单写者来自 #292；本层没有写入属于 #292 的事实 |
| 测试 | 判别力强；`refreshing(core)` 包装的「刷新本身不得失败」断言是承重的，加强了 #295 / #289 的保护 |
| 工作项 | P3：ADR-0011 第 8 条与 TD-048 指向过期；规划提交正文从半句开始 |

## 关键证据

- 复跑：head 1349/1349；代码提交单独 1349/1349；mvp0 7/7；typecheck、boundaries 通过；#222 验收命令 455/455；并集（main + #290 + #291 + #292 + #293）1453/1453。
- 纯读探针：15 个查询面 × 3 轮 × 5 个阶段 × 两个 Storage，provider 调用 0 次、写 0 次、整库逐字节不变；首读 base `2 → 9`、head `2 → 2`。并发探针 480 次查询无不一致。
- 变异 36 个全部 RED，包括 #295 与 #289 的守卫在包装后的判别。

## 整体结论

APPROVE，0 × P0 / P1、1 × P2、5 × P3。合并前：人类确认 Decision Log 第 1、16、17、19、25、29 行，并决定 P2 的验收承接（#234 / #281 补「调用刷新命令、每次新幂等键」的验收，或写决策评论；TD-045 中的 #134 换成实际承接的 issue）；随 #292 rebase；合并前用 range-diff 核对。

## 修复轮（2026-10-09）

修复前随 #292 的修复轮换基到它的新 head。修复在恢复锚点 `backup/delivery-query-pure-read-pre-r1fix` 之后以本地提交追加，再并回规划、代码、回填三个提交。标「协调者决定」的各项是协调者按人类授权调研后作出的，人类可推翻；依据与出处集中在来源 ExecPlan 的「调研依据」。证据与命令见同一计划的 r1 Progress 与 Decision Log 第 34–46 行。

| 发现 | 处置 | 证据 |
|---|---|---|
| P2 `tech-debt-tracker.md:41`：TD-045 的承接 issue 没有承接 | 人类裁决「Add boxes to #234 and #281 (Recommended)」：协调者在 #234、#281 各加验收框（2026-10-09 改写为不再要求新幂等键），TD-045 的承接改为 #234、#281 与 #233，引用两条验收框原文 | tracker 的 TD-045 行 |
| P3 `tech-debt-tracker.md:43`：ADR-0011 第 8 条与 TD-048 指向过期 | 第 8 条就地标 Superseded，指向 TD-048；TD-048 与 K2 行改为 Accepted、由 #224 统一 | ADR-0011 第 8 条；`lint_execplan.py` 输出 `OK` |
| P3 `delivery.ts:46`：`degraded` / `stale` 不随时间老化 | 协调者决定：注释写明只反映最近一次刷新、年龄只从 `confirmedAt` 起算；年龄规则是 `ui-model` 的纯函数。人类裁决「Add to #281 and #234 (Recommended)」，两条验收框原文引在 TD-045 | 不在投影里加随时间变化的字段，「纯读」的整库比较不受影响 |
| P3 `commands.ts:191`：刷新进重放账本，只增不减并缓存失败 | 协调者决定：刷新命令不进重放账本，签名去掉幂等键（`{ actorRef }`），天然幂等、不重放 | 红：同一请求第二次返回首次的对象（两条用例）；变异 RPL 2 红 |
| P3 `delivery.ts:63`：`normalizeScope` 的类型与运行时不符 | 返回 `NormalizedDeliveryScope`（`workItemId` 可为 `undefined`），写者与查询共用守卫 `isDeliveryScope`，tsc 强制先过守卫 | 变异 SC1 2 红、SC2 1 红、NULLSCOPE 3 红 |
| P3 规划提交正文从半句开始 | 整合时用 `git -c core.commentChar=';'` 重写，开头补完整，没有以 `#` 开头的行 | `git log --format=%B` 回读 |
| #292 的 P3 `delivery-facts.ts:86`（`confirmedAt` 是乱序令牌） | 协调者决定在本 PR 改存读取开始时的墙钟读数，`attemptedAt` 只定序；ADR-0011 第 3、5、7 条与 Rejected 表随之修订，新登记 TD-052；人类裁决「Adopt after #293's fixes (Recommended)」，ADR-0011 改为 Accepted | 红：时钟回拨后 `confirmedAt` 读回令牌；变异 W1 3 红、W2 1 红、W3 1 红 |
| #292 留给本 PR 的两格：T17、`.putRelation(` 静态守卫 | 「乱序」加「较新的读取遇到 Development 离线」变体；「唯一写者」加 `.putRelation(` 的调用点断言 | T17 4 红、G1 1 红 |

- Decision Log 第 1、16、17、19、25、29 行由协调者在调研后全部维持，各行末尾补了决定与依据；第 29 行的集成包装改名为 `refreshBeforeRead`。
- 规模：代码 630 / 1000（规划上限 800）；变异主表 49 条、集成层 6 条全部被杀死；全量 1458 / 1458、`tests/mvp0` 7 / 7、`tsc --noEmit` exit 0、`pnpm run boundaries` 8 / 8。合并前的回读以推送后的 head 为准。

## 复评轮（2026-10-09）

复评在修复轮之后的 head 上逐条复跑上一轮的修复，两个 PR 均 APPROVE，本 PR 留下 4 条 P3。修复前随 #292 的复评轮修复（`f32488ec`）换基；在恢复锚点 `backup/delivery-query-pure-read-pre-rr2`（`9ba1af5f`）之后以本地提交追加，再并回规划、代码、回填三个提交。证据与命令见来源 ExecPlan 的 rr2 Progress 与 Decision Log 第 47、48 行。

| 发现 | 处置 | 证据 |
|---|---|---|
| P3 `commands.ts:149`：模块头仍写每条命令都带 `idempotencyKey`、同键重放由账本兜住 | 第 2、8 行补上刷新命令的例外：天然幂等，只带 `actorRef`，不带键、不进账本；只改注释 | `git grep` 只有这一处旧说法 |
| P3 迁移 006 的 `attempted_at` 列注释仍是「读取开始时刻」 | 归属 #292：在它的复评轮里改成乱序令牌的说明，本 PR 换基后继承 | 迁移与端口注释一致 |
| P3 `tech-debt-tracker.md:18`：ADR-0011 转为 Accepted 后，`docs/README.md:28`、TD-009、TD-014、TD-049 仍是旧说法 | README 状态列、TD-009、TD-014 就地改成已 Accepted（来源 Decision Log 第 39 行），TD-014 维持 Superseded；TD-049 的范围改成实际改过的第 3、5、7（前半）、8、9 条与 Rejected 表，第 7 条末句未动 | 与 `git diff` 里 ADR-0011 的改动逐条对照 |
| P3 `2026-10-08-delivery-query-pure-read.md:716`：#134 仍被写成定时刷新的承接方（ADR Consequences、接口条目、Outcomes） | ADR Consequences 改为「#234、#281 的打开与手动刷新调用同一个命令；定时、节流与合并由宿主或调度器持有」；接口条目标 Superseded by Decision Log 第 40 行；Outcomes 遗留条加订正 | 与 TD-045、Decision Log 第 40 行一致 |
| P3 `2026-10-08-delivery-query-pure-read.md:651`：Decision Log 第 37 行的理由与测试不符 | 理由改成「查询结果保持确定」：同一份已提交事实读出同一个投影，投影相等的断言与调用方缓存依赖它；年龄依赖 now，放在 `ui-model` 的纯函数里；决定不变 | 「纯读」用例比较的是存储转储，不受读时算出的字段影响 |
| #292 复评轮留给本层的判别用例：变更请求页形非法 | 完整性表新增「变更请求页形非法」一行（#292 的代码桶 800 已在规划上限）；只合并 #292 时这一格没有用例 | 变异 R1 在 #292 单独存活，在本 PR 2 红 |

- 规模：见来源 ExecPlan 的 rr2 Progress；变异 H5 2 红、B2 2 红、T11 1 红、T17 4 红、G1 1 红、R1 2 红，全部变红。
- 合并前的回读以推送后的 head 为准。
