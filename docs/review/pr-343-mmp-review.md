# PR #343 MMP 交付评审

评审对象：PR #343，immutable head `818ee4ad6f75f4feffeeacbe7dff56b3db045322`，base `main@21cb29eb27ccc0cc6e0eebe61df6b6ae8c2f5bea`。评审日期：2026-10-15（第一轮）。评审账号：Singularity-AI-Bot。同批评审 #316、#342、#344 → #345。

## 锁定事实

| 项 | 当前事实 |
|---|---|
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=UNSTABLE（只因可选检查红） |
| commits | `8909c5ed` 预注册（02:46:26Z）→ `24eca6b2` test(architecture) 记录、夹具、契约测试 → `818ee4ad` 归档、索引、债务 |
| linkage | closingIssuesReferences=[#280] |
| checks | PR Fast Gate、Verify、Merge Gate 四 lane、CodeQL 成功；`matrix.check` 失败是被取消的重复运行（`38699202687` cancelled，后继 `38699210516`、`38701698863` success）；`Create review session` 失败是本地评审端点未运行 |
| 规模 | 代码 518 / 1000，文档 926 / 1500 |
| 宿主版本 | `npm view @deepseek-ai/dsh dist-tags`（08:12Z）：latest = next = `0.2.0-rc.2`，alpha = `0.2.1-alpha.3`；本机 Desktop `0.2.0-rc.2`，与记录一致 |

## 并集预演

见 #342 记录：五个 PR 两种顺序的并集均 1678/1678 + 7/7 全绿，冲突只在两个索引文件。本 PR 与合并顺序相关的陷阱：它的归档提交把 `docs/README.md` 的 Active 行从 `active/` 改成 `completed/`，逐个 rebase merge 时若机械「两边保留」，会残留旧 `active/` 行，本 PR 自带的 `harness-session-api-record` 用例「docs/README.md 的链接目录 active/ 与计划所在目录 completed/ 不一致」变红（评审复现：顺序 316→342→343→344→345 得 1677/1678）。**本 PR 先合并**（零冲突），其后各 PR 变基时去掉被取代的行。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 测试判别力 | 未见：24/24 绿，作者三张变异表 39/39 KILLED | 未见：结论块由 §3 / §5 推导，R09–R11、R16 KILLED | **F1** 夹具证据未绑定 §3「已观测到」；**F2** §5 影响判定未绑定冻结的 §2.4 | R12、R14、R17 存活（F1 附带） |
| 证据真实性与时序 | 未见 | 未见：夹具独立重建 exchanges 24/24、events 6/6 相等；预注册服务器侧时间早于 T0 | 未见 | 未见 |
| 结论推理（#140） | 未见 | 未见：按规则得 `implement` 成立，#140 契约可实现 | 未见 | **F4** #140 未指向记录；**F7** §7.1 映射无行间优先级 |
| issue 验收（#280） | 未见 | 未见：三条验收满足且观测过 | 未见 | 未见 |
| 交接与工作项 | 未见 | 未见：没有越权写 #140 范围、Status 或 `blocked-by` | **F3** TD-066 → #143 未登记 | **F5** 「open PR」措辞随合并顺序过期；**F8** Progress 末条未勾 |
| 安全叙述 | 未见 | 未见：读数与证据一致 | 未见 | **F6** 「全程没有非回环连接」强于证据 |
| 发布面 | 未见：disclosure（含 PR 正文）通过，人工五类目无命中 | 未见 | 未见 | 预注册提交正文有一行以 `#140` 开头（rebase merge 不受影响） |
| 架构与产品闭环 | 未见：不改 `apps/**`、`packages/**`，boundaries 9/9 | 未见 | 见 F3（demo 门禁前提未登记） | 未见 |

## 分层检查

### #280 验收逐条

1. 记录列出观测到的操作、精确命令、宿主版本与 UTC 时刻：12 条 O 行均到 S3，时间逐条对上探针 `at`；三处版本来源均为 `0.2.0-rc.2`。成立。
2. 一次 start 与一次 status read 的脱敏夹具：用评审脚本从探针行重建，exchanges 24/24、events 6/6 逐项相等，`recordedAt` 相同；卫生模式命中 0。成立。
3. 写明对 #140 的后果：`implement`，由预注册规则块机械推导；三条「不能依赖」不会让 `startRun` / `getRun` / `cancelRun` 不可实现（`cancel` 后读 `inspect`、包装未知会话的普通 `Error`、重启后 `session/not-found` 落 `unknown`）。成立。

### 预注册早于观测

`8909c5ed` 上的 CI run 在 02:47:40Z 由服务器创建，PR `createdAt` 02:47:37Z，均早于 T0 05:37:25Z；timeline 无 `head_ref_force_pushed`；`session-rule` 块的 sha256 `c3e36fb2…` 在预注册提交与 head 上相同。

### F1 / F2（P2）：判别力缺口

契约测试确实从记录推导结论（改 §6 结论、插件可达、缺项、§5 影响判定、§3 结果均被杀死），没有硬编码 `implement`。但 `checkFixture` 只检查 O1.1 create 成功、O1.2 `accepted`、O2.x 任一成功的 list / inspect、O3.x `turn/end`：夹具否定 CORE 判据（R01–R08）时测试仍绿；§5 与冻结 §2.4 不比对（R18）。当前数据正确，缺口在 TD-065 重录时拦不住漂移。提交 `24eca6b2` 正文「核对…预注册规则块未被改动」超出测试实际覆盖。

### F3（P2）：TD-066 的承接未登记

TD-066 写「#143 demo 门禁前补做」，#143 自 2026-10-07 未更新、无评论，五条验收没有 R4 或 desktop profile 复观测；#143 验收 3 的「forced session start failure」恰落在未观测路径。

## 变异表（head `818ee4ad`）

作者主表 M1–M17、补充表 H（16）、Batch 6 表 N（6）全部复跑：39/39 KILLED，归因一致。评审自加：

| id | 改动 | 结论 | killedBy |
|---|---|---|---|
| R01–R08 | 夹具否定 O2.x / O3.x / O4.x 的观测事实、`sessionId` 前后不一致、删 O4.1 | SURVIVED | —（F1） |
| R09 / R10 / R11 / R16 | §6 可达性、缺项、§5 影响判定、§3 结果 | KILLED | 真实记录：结论块等于推导 |
| R12 | §6 推导散文 `implement` 改 `narrow` | SURVIVED | — |
| R13 / R15 | T0 晚于观测 / O 行早于 T0 | KILLED | 真实记录：时间… |
| R14 | §2 来源三改 alpha 版本 | SURVIVED | — |
| R17 | 映射 `aborted` 行来源改 O4.3 | SURVIVED | — |
| R18 | 块 §2.4 `web` profile 否改是 | SURVIVED | —（F2） |
| R19 / R22 | 块 §2.3 规则散文、计入条件放宽 | SURVIVED | 设计边界：块完整性靠 sha256 人工比对 |
| R20 / R21 | 块常量、判据改字 | KILLED | 预注册常量 / 真实记录 §3 判据 |

## 命令与结果（head）

`harness-session-api-record` 24/24；`pnpm verify` 1602+7 exit 0；boundaries 9/9；workflow-check 无发现；`harness-host-reprobe-record` 25/25；size 518/926；`git diff --check` 无输出。

## 结论

P0 = 0，P1 = 0，P2 = 3（F1–F3），P3 = 5（F4–F8）+ 提交正文一行。APPROVE，进入修复：F1/F2 把判据绑定到夹具与冻结表；F3/F4 在承接 issue 登记；F5–F8 文档就地修正。**合并次序：本 PR 先合。**

## 修复与复评（2026-10-15）

按评审流程（只剩 P2/P3），评审会话负责修复：修复由评审会话派出的实施者完成，修复本身另派独立复评。预注册提交 `8909c5ed` 不作为修复目标，整合时保持原 SHA。

| 意见 | 处置 | 证据 |
|---|---|---|
| F1 夹具证据未绑定 §3 | `checkFixture` 按 O-ID 绑定 `FIXTURE_EVIDENCE`；新增 `checkLineage`、`checkMappingEvidence`、`checkSources`；O0.1、O0.2 由记录 §8 声明只由记录证明 | R01–R08、R14、R17 由存活变为被杀，失败信息指向对应 O-ID |
| F2 §5 未绑定冻结的 §2.4 | 解析块 §2.4，要求 §5 同名捷径判定一致；`24eca6b2` 正文改为准确描述 | R18 被杀；R19、R22 属离线设计边界，靠块的逐字节 diff |
| F3 TD-066 未登记到 #143 | 经人类批准（D46）由评审会话发出 #143 评论 | #143 评论 |
| F4 #140 未指向记录 | 经人类批准（D46）由评审会话发出 #140 评论 | #140 评论 |
| F5 「open PR」措辞随合并顺序过期 | §7.2 / §7.4 改为与合并顺序无关；复评后 §7.2 再改为「由 #132（PR #344）提出」 | 只合并本 PR 时句子仍为真 |
| F6 「无非回环连接」强于证据 | 改为与 H5 等强的表述，PR 正文同步 | — |
| F7 §7.1 无行间优先级 | 加四级取用次序 | 与 #140 验收 4「恰好一个」一致 |
| F8 Progress 末条未勾 | 勾选并回填 | — |
| 复评三条 P3 | Artifacts R 表引语订正；§7.2 措辞；Progress 引用出处 | — |

并集读数说明：评审子评审在本地把 main + #342 `79aef826` + #345 `6fc33768`（含 #344）+ 本 PR `818ee4ad` 合并，`pnpm verify` 1661 + 7、0 失败，与 PR 正文的四 PR 并集一致；五 PR（另含 #316）两种顺序的并集为 1678 + 7。修复后读数（整合前 head）：记录测试 31/31，`pnpm verify` 1609 + 7，作者 M/H/N 表与修复轮 X 表全杀，评审 R 表只剩 R12、R19、R22 存活；size 代码 738 / 1000、文档约 1120 / 1500。
