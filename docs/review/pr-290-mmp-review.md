# PR #290 MMP 评审记录

## 锁定事实

- PR #290「fix(core): 修订号只随内容变化推进，同步异常转成结构化失败」，Closes #199、#220，Refs #216；标签 kind:fix、area:core、area:adr、area:exec-plan、gate:E1。
- 第一轮评审 head `3250f04f`，merge-base `6417d459`，draft；评审时 main 为 `ce423d9d`，测试合并无冲突。3 个提交，正文不含关闭关键字；代码 500/1000、文档 731/1500；ADR-0012 为 Proposed。
- 评审账号：Singularity-AI-Bot。

## P0–P3 风险矩阵

| 层 | 结论 |
|---|---|
| 代码 | P0 / P1 无。写前写后整体重读并深比较：增、改、删、清空快照、状态、规划字段、redacted 互转推进；相同输入、重启、重复或乱序观察、不可锚定条目、旧规划源残留不推进；两个 Storage 都有用例。整轮 catch 转结构化失败，提交原子，游标缺失或 idle 读作陈旧。P3：排序与深比较两道守卫没有用例钉住。既有残余 TD-031、TD-034 与 base 同形 |
| 产品闭环 | P2：内容不变的刷新不再产生帧，`lastUpdatedAt` 不动，对账时刻只写不读（#220 验收 3 只在 Storage 内成立）；P2：catch 不保留异常，可操作的修复提示与排障线索丢失（TD-030） |
| 架构 | 干净：7 条不变量成立，`advanceRevision` 只有两个调用方，依赖方向通过，ADR 未被当作已采纳 |
| 测试 | 判别力强：17 个变异杀死 15 个，X15（去排序）与 X16（`JSON.stringify` 替代深比较）存活，Proxy 重排探针证明二者非等价 |
| 工作项 | #220 验收 3 待人类裁决；TD 号段无冲突；修改已归档计划有理由；索引状态与文档规模数字过期；ADR 把仓库外契约当作「裁定」引用 |

## 关键证据

- 复跑：head 1256/1256；测试合并 1348/1348；mvp0 7/7；typecheck、boundaries、disclosure、diff-check 通过。本 PR 的三个测试文件在 base 源码上 52 红、24 绿；中间提交单独 1256/1256。
- 并集：与 #291 在 main 上 1383/1383；与 #292 / #293 1294/1294。
- 三边探针（base / head / 合并）：内容不变的刷新 `2→3` / `1→1` / `1→1`；被拒观察在 base 上裸抛且游标 healthy，在 head 与合并上为 `unavailable`、游标 degraded、读侧陈旧。只读 SQLite（TD-031）与宿主权威状态被同步覆盖（#273）在 base 与 head 同形，不是回归。

## 整体结论

APPROVE，0 × P0 / P1、2 × P2、3 × P3。合并前需要人类决定：ADR-0012 是否采纳；#220 验收 3 的解释与 `Closes` / `Refs`；TD-030 至 TD-034 是否接受延期。两条机械 P3 可在归档提交里一并修复。

## 修复轮（2026-10-08）

评审 review 5455297113（APPROVED）出 0 × P0 / P1、2 × P2、3 × P3。人类伙伴的四项裁决（2026-10-08 18:40 CST 前后，人类伙伴在协调者会话（负责迭代规划与交付这几个 PR 的会话）的一次四问提问中直接作答）与执行记录在来源 ExecPlan 的 Decision Log。分支先变基到 `origin/main@a357ef8`：无冲突，`git range-diff` 三个提交逐一等价，变基后 `tsc --noEmit` exit 0、`tests/contract tests/integration tests/e2e` 1365 / 1365，之后才开始修复。

| 发现 | 处置 | 证据 |
|---|---|---|
| P2 `bootstrap.ts:162`：#220 验收 3「记录新鲜度」只有写者没有读者，`Closes #220` 会把它当作已交付 | 人类裁决，不改代码：「Keep Closes, move display to #229 (Recommended)」。PR 仍 `Closes #220`；协调者在 #220 写决策评论、在 #229 的验收里加「刷新后页面上的最后确认时间可见地更新」；TD-032 的「下一步」改成指向这条验收；D5 就地标「已裁决」 | 外部写入由协调者执行并回读；`docs/exec-plan/tech-debt-tracker.md` 的 TD-032 行 |
| P2 `bootstrap.ts:69`：整轮 `catch` 不绑定异常，可操作的修复提示与排障线索全部丢失 | 修复，并按裁决「Add a host diagnostics hook in #290 (Recommended)」：`composeCore` 的 `CoreDeps` 新增可选 `diagnostics.syncRoundFailed(error)`，缺省 no-op；`catch (error)` 先把原异常（同一个对象）交给宿主、再 `fail`；钩子同步抛错或返回被拒绝的 promise 都被吞掉；返回值与 wire 仍是固定文案的 `unavailable`。TD-030 更新为「诊断出口已有；同码问题仍在，下一步不变」，TD-031 至 TD-034 按原文延期 | 红用例先行：修复前 I16×2、I17×2、I19 共 5 条红（钩子不被调用）；修复后 `sync-revision-freshness` 55 / 55。探针（本检出，带钩子）：X2 读回 `bootstrap false unavailable … host saw RangeError: sourceVersion 必须是规范载体…`，SQLite 旧载体读回 `legacy false unavailable … host saw Error has repairLegacySource=true`；`origin/main` 上同一探针读回裸抛且宿主无出口。变异 M30–M36（去掉调用、钩子抛错不吞、交给宿主的不是原异常、结构化失败也调用、不接住被拒绝的 promise、`createContext` 不放进钩子、钩子晚于 `fail`）各至少一条用例变红 |
| P3 `bootstrap.ts:176`：排序与 `isDeepStrictEqual` 两道守卫是承重的，全量用例钉不住 | 修复，只补测试：`scrambling` 代理让事务内 `listPlanningProjections` 的读回隔次倒序整表（行序）或隔次递归倒序键序（键序），I15 = 两种打乱 × 两个 Storage，断言相同引导三次不推进、代理确实改变了序列化形态、改一个标题仍恰好推进一次。评审的 X15、X16 编为 M28、M29，补进计划的 D10、D11 与变异表；原计划「去掉排序、`JSON.stringify` 比较是等价变异」就地标 Superseded（S30） | M28（去掉 sort）只被 I15 的行序 ×2 杀死，M29（`JSON.stringify` 相等）只被 I15 的键序 ×2 杀死，二者不重叠；每条先断言锚点恰好命中一处、`git diff --no-index -U0` 非空，还原后 `cmp` 一致、复跑 87 / 87 |
| P3 `docs/README.md:47`：索引状态与规模数字过时 | 修复：计划归档到 `docs/exec-plan/completed/`，索引行从 Active 表移到 Completed 表；计划里的规模、计数改为「回读命令 + 期望 + 观察时刻与 head」（A11；PR 描述由协调者在推送后同步改），A10 的 729 就地标 Superseded（S33） | `git grep -n 'exec-plan/activ[e]/2026-10-08-sync-revision-freshness'` 无命中；`lint_execplan.py` 通过 |
| P3 ADR-0012 第 24 行：Why 引用仓库外的协调者契约 K1 作「裁定」 | 修复并采纳：删去「协调者 … K1 裁定」，只留仓库内的理由（快照不含交付事实，推进只会产生空 delta），并写「交付写者的计划（#221、#222）引用本条」；按裁决「Adopt ADR-0012, keep ADR-0011 for #292's review (Recommended)」改为 Accepted，照 ADR-0010 的状态行格式写批准时刻与所选原话，`docs/adr/README.md` 的索引行与说明段同步 | `docs/adr/ADR-0012-business-revision-advances-only-on-content-change.md` 状态行与第 6 条的 Why；`docs/adr/README.md` 的 ADR-0012 行为 Accepted |

- 合并顺序（裁决「#290 → #291 first, #292 does the wiring (Recommended)」）：本 PR 先合并，#292 在其后变基并负责接线；本 PR 不做宿主侧接线。`context.ts` 因诊断出口进入本 PR 的文件集（计划的 Global Constraints 与 Decision Log 已就地标 Superseded），#292 变基时会遇到这三处新增。**更正（第二轮评审 P2，2026-10-08；Superseded）**：「#292 在其后变基并负责接线」与「#292 变基时会遇到这三处新增」写错了前提。该选项的原文是 “After fixes and a second review, merge #290 then #291. #292's rebase onto main also takes the K3 routing wiring (with a test that goes red if the seam isn't wired) and #289's pagination, then gets reviewed again.” 其中的「接线」指契约 K3：#292 在 #291 合并后把自己的 Development 路由缝 `developmentReadBinding` 换成 #291 的 `routeDevelopment`，与诊断出口无关；合并顺序本身不受影响。事实：今天没有宿主组合 core，`diagnostics.syncRoundFailed` 只有测试在消费；人类伙伴随后裁决「#132 compose host (Recommended)」，由 #132 在组合宿主时接线并承担脱敏（协调者已在 #132 的验收末尾加一条，TD-030 的下一步同步）。
- 判别力：三文件 87 条（原 76），对 `origin/main@a357ef8` 源码 63 红、24 绿（红的恰是计划 D11 的 T1–T6、W1、W2、I1–I19 按 Storage 展开）；变异 M1–M36 在最终树上整表重测，红集合逐条等于计划 D11，受影响的行（M1、M4、M7、M12、M13、M16、M23、M27）的新旧红数并列写在 D11 的变异表里；`docs/review/README.md` 没有评审记录的索引，不加行。
- 全量与发布面：`tests/contract tests/integration tests/e2e` 1376 / 1376、`tests/mvp0` 7 / 7、`tsc --noEmit` exit 0、`package-boundaries` 8 / 8；规模与发布面读数写在计划的 A11（观察时刻与 head 见该节，重算命令 `node scripts/rule-checks.mjs size origin/main`）。
- 新 head 与线程回复：本记录所在的提交即修复后的 head（提交无法记录自身的 SHA），具体 SHA 以 PR #290 推送后的回读与本轮线程回复为准。

## 第二轮修复（2026-10-08）

第二轮评审（Singularity-AI-Bot）在修复后的 head `375d8a75` 上出 0 × P0 / P1、1 × P2、5 × P3；其中 PR 正文过时一条由协调者在整合与推送后处理。人类伙伴随后裁决「诊断出口接线的承接 issue」，所选答复原文「#132 compose host (Recommended)」。修复在恢复锚点 `backup/sync-revision-freshness-pre-rr2` 之后以本地提交追加，由协调者并入现有三提交布局。证据、变异整表与命令见来源 ExecPlan 的 Batch 6、S34–S37 与 A12。

| 发现 | 处置 | 证据 |
|---|---|---|
| P2 `sync-revision-freshness.md:547`：「#292 负责接线」的前提不成立，诊断出口没有消费方，宿主接线没有承接者 | 记录更正，不改代码：计划 Decision Log 的「合并顺序」行与本记录上文一条就地标 Superseded，引用选项原文（「接线」指 K3 路由缝，与诊断出口无关）；新增 Decision Log 一行记录人类裁决「#132 compose host (Recommended)」；TD-030 的下一步写成由 #132 在组合宿主时接线并承担脱敏，指向协调者写入 #132 的验收框 | `git grep -n syncRoundFailed -- packages apps` 只命中 core 自己；#132 的验收原文引在 Decision Log，写入后以 #132 回读为准 |
| P3 `bootstrap.ts:81`：只用 `instanceof Promise` 识别被拒绝的返回值，跨 realm 的 promise 让宿主进程崩溃；「不等待钩子」没有用例 | 修复：新增内部模块 `diagnostics.ts`，用 Promise 构造器吸收任何返回值（读取、调用 `then` 的同步抛出也变成它自己的拒绝），仍不等待；I18 增加跨 realm（`node:vm`）、thenable、读取 then 即抛错三种钩子，新增 I20（永不 resolve 的钩子，组合期与显式命令都须在期限内结束） | 红：先补用例，57 条里 I18×2 红（栈顶 `reportSyncRoundFailure`，未处理拒绝）；绿：57 / 57。变异（导出目录，锚点命中一处、`git diff --no-index -U0` 非空、还原后 `cmp` 一致）：M37（评审的 H8，`await` 钩子）只被 I20×2 杀死；M41（只认 `instanceof`）、M42（手写 `then` 探测在 `try` 之外）各被 I18×2 杀死，去掉 getter 钩子后 M42 存活 |
| P3 `sync-revision-freshness.test.js:56`：「原文不进命令结果」只钉 `error.message`，H11 / H11c 存活 | 只改测试：`assertRoundFailed` 改经 controller 发命令（一轮只跑一次），对 core 结果与 `CommandResult` 两层都做 `JSON.stringify` 与 `util.inspect(showHidden)` 的 `doesNotMatch`；不钉键集合，免得兄弟 PR 给 `BootstrapResult` 加字段时必改本文件 | 实现正确，补强后 55 / 55；红在变异：M38（H11，`cause: error`）17、M39（H11c，`detail` 副本）4、M40（`error` 对象挂 `cause`）17 |
| P3 `context.ts:55`：冷启动时 `fail` 自身的拒绝被 `composeCore` 的 `catch {}` 吞掉，钩子 0 次；没有写明脱敏义务 | 修复，没有收窄 D12：`composeCore` 的 `catch (error)` 在吞掉之前交给同一个钩子（同一调用约定，命令结果与 wire 不变；显式命令里的同一拒绝仍直接到调用方，TD-031 不变）；`CoreDiagnostics` 的注释写明「原异常可能含凭据片段、磁盘路径、SQL 与提供方原文，宿主写日志或遥测前负责脱敏，不得转发到 wire 或 UI」；D12、S32 就地更正，「双重故障」用例里宿主收到的次数由 2 更正为 3 | 红：补 I21、I22（两个 Storage），61 条里 5 红（I21×2、I22×2、「双重故障」次数）；绿：61 / 61。变异：M43（回到 `catch {}`）5、M44（交的不是原拒绝）5、M45（显式命令的拒绝也另交）4 |
| P3 `docs/adr/README.md:48`：ADR-0012 的批准出处与 ADR 状态行、Decision Log 矛盾 | 修复：`docs/adr/README.md` 说明段、ADR-0012 状态行、计划 Decision Log 的出处行与本记录上文，统一写成「人类伙伴 2026-10-08 18:40 CST 前后在协调者会话（负责迭代规划与交付这几个 PR 的会话）的一次四问提问中直接批准」；#220 上已发布评论里的「planning session」由协调者订正（外部写入） | `git grep -n 'PR #290 的修复会[话]中批准' -- docs` 读回 0 行（方括号写法让这条命令的文字不匹配自己） |
| P3 PR 正文仍是旧事实；计划的提交步骤与实际三提交不符 | 计划侧修复：Batch 5 第 10 步与回滚、Progress 末项就地标 Superseded，最终整合形态（规划、代码、归档三个提交，各自主题）记入 Decision Log；PR 正文（Accepted、`completed/` 路径、当前回滚 SHA）由协调者在推送后更新 | `c155db05` 单独检出（`git archive` 导出目录）：`tsc --noEmit` exit 0，全量 1375 / 1376，唯一失败是 S9 的环境性用例 |

- 判别力：三文件 93 条（原 87），对 `origin/main@a357ef8` 的源码 69 红、24 绿；变异 M1–M45 在最终树上整表重测，红集合逐条等于计划 D11，受影响的行（M4、M5、M8、M30、M32、M33、M35）的新旧红数并列写在 D11 变异表里。

## 第三轮修复（2026-10-08）

第三轮评审（Singularity-AI-Bot）在 head `47f76c7c` 上出 0 × P0 / P1 / P2、1 × P3。修复在恢复锚点 `backup/sync-revision-freshness-pre-r3` 之后以本地提交追加，由协调者并入现有三提交布局。证据、变异重测与命令见来源 ExecPlan 的 Batch 7、S38 与 A13。

| 发现 | 处置 | 证据 |
|---|---|---|
| P3 `context.ts:156`：`composeCore` 冷启动这个钩子调用点没有「不等待钩子」的用例；只在这里 `await` 钩子的 H8c 在全量下存活，冷启动双重故障加慢钩子会让组合永远挂起 | 只补测试，不改实现：新增 I20b（两个 Storage），沿用 I21 的坏存储（provider 离线 + `putSyncCursor` 拒绝同一个 `Error`），钩子返回永不 resolve 的 promise；`world.open()` 与显式命令都须先于 1 s 计时器 settle，钩子恰好 1 次，显式命令以同一拒绝结束。H8c 编为 M46 写进计划 D11 变异表；D10 那一行拆成两行（I20 / M37、I20b / M46），评审建议的「先收窄措辞」因用例同批落地而不需要 | 复现（探针 `cold-never.mjs`）：HEAD 读回 `composeCore settled`，H8c 下读回 `composeCore HUNG (>1s)`。红绿：导出目录里 H8c 在加用例前三文件 93 / 93、全量 1382 条里 1381 绿（唯一失败是 S9 的环境性用例）；加用例后同一变异 95 条里 I20b×2 红、其余 93 绿，还原后 95 / 95。M46 只被 I20b×2 杀死 |

- 判别力：三文件 95 条（原 93），对 `origin/main@a357ef8` 的源码 71 红、24 绿；M37、M43–M46 与可能受影响的 M8、M30–M36、M41、M42 在最终树上重测，红数变化的是 M8 5、M33 8、M35 14、M37 4、M43 7、M45 6（各加 I20b×2），其余不变，新旧数字并列写在计划 D11 变异表里；M1–M7、M9–M29、M38–M40 的变异点不在新用例的路径上，本轮没有重放。
- 全量与发布面：`tests/contract tests/integration tests/e2e` 1384 / 1384、`tests/mvp0` 7 / 7、`tsc --noEmit` exit 0、`pnpm run boundaries` 8 / 8；代码桶 800 / 1000（规划上限 800）；规模与发布面读数写在计划的 A13。
