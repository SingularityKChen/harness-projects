# PR #402 MMP 交付评审

> 状态：独立评审已完成，等待协调者提交统一 review；不包含合并授权。
> 日期：2026-10-26；执行上下文：检出 `feature/harness-execution` 的 `.worktrees/harness-execution` 根目录。

## Purpose / Big Picture

判断 issue #140 的可注入 Harness ExecutionProvider 是否形成离线可验收、可独立回滚的启动与读取闭环。评审覆盖正确性、产品结果、七条不变量、测试判别力和 issue 范围；不把绿色 CI 或归一端口测试等同于真实 Host / Desktop / 模型验收。

## Context and Orientation

- 锁定 Head：`dcbeef275e0069cabd196ca4b4050d484af3a201`；Base：`main` / `d470308bb42878fdf7b65e88095fed61bacd8289`。
- 协调者提供的锁定元数据：Open、Ready、mergeable；已有 review 与 review thread 均为空（完整分页）。远端事实由协调者最终回读，本记录不替代该步骤。
- 账号边界：评审账号 `Singularity-AI-Bot`；开发账号 `SingularityKChen`。本子评审没有提交远端 review、issue、commit 或 push。
- 已读取根 `AGENTS.md`、`PLANS.md`、`docs/review/mvp-review.md`、`docs/review/README.md`，并应用 Superpowers、Qian Systems Router 的系统边界与反馈分析、First Principles Development 的审计模式。
- 需求来源已于本轮直接读取 issue #140、#359、#365、#193、#304 的当前正文；事实与假设分开，既有恢复缺口不重复报作本 PR 新缺陷。

## Design / Spec

评审对象是纯端口适配器：Git ack 的工作目录 → 新 session → 稳定 requestId 的 prompt → 按所属 turn 的 inspect/list 状态。核心控制点是外部 prompt 结果不明时保持 `ambiguous_result` / `unknown`，并禁止第二执行者；规划轴不随执行变化。运行后的刷新由 #365 负责，原始 Host 信封到 SessionPort 的归一与 Host catalog 接线由 #359 负责。

## Global Constraints

只写本评审记录，反例与变异 spec/log 留在仓库外临时目录；不修改产品实现、不提交 GitHub review、不改 issue 或看板、不提交或推送。Git 命令用 Python `subprocess.run(['git', ...])` 的 argv 形式执行。

## Plan of Work

1. 锁定现场并在逐文件审查前建立 P0–P3 风险矩阵。
2. 审查全部 12 个 diff 文件，沿能力端口、Provider、Core、契约/集成/政策测试与 issue 验收追踪。
3. 运行最窄判别性测试、类型与依赖检查；以正式变异脚本验证关键断言，并确认产品文件还原。
4. 分离代码发现、范围限制与已跟踪事项，交协调者一次性提交 review。回滚仅丢弃本地评审记录；本轮无外部写入可回退。

## Validation and Acceptance

### 预先风险矩阵及最终分层证据

本矩阵在逐文件审查前建立，下面的结论在完成全矩阵之后回填。

| 级别 | 代码与反例 | 产品闭环 | 架构边界 | 测试与 issue 验收 | 最终结论 |
|---|---|---|---|---|---|
| P0 | 数据破坏、泄密、合入即破坏 main | 错报已保存或越权远端写入 | 第二权威源、规划状态被工程覆盖 | 硬约束未守住则阻断 | 未发现；无新存储/依赖/迁移，返回 ref 不含任务/环境/cwd，规划写入数为零 |
| P1 | 并发、重试、冷恢复、失败路径错误 | 用户主路径无法完成或结果不可信 | 身份/租约/持久化/信任边界失效 | 反例可复现且在本 issue 范围则阻断 | 未发现本 PR 新增阻塞；prompt 不明及接纳后读失败保持 unknown，重复 start 不创建第二执行者 |
| P2 | 可恢复的边界行为、诊断不足 | 非关键交互与恢复体验缺口 | 局部合同不清但无不变量破坏 | 缺判别性负控、已有追踪核验 | 未发现新的可复现 P2；见下方范围与重复追踪核验 |
| P3 | 易读性、证据表述与维护性 | 文案或展示小问题 | 无行为影响的一致性 | 文档、索引、细微验证改进 | F1：归档计划仍有未标注过期的 Active 状态头；Superseded by 本文「P3 修订独立复评」（2026-10-26），已关闭 |

### 全部 diff 文件审查

| 文件或职责 | 已核查证据与结论 |
|---|---|
| `packages/capabilities/src/execution-provider.ts`、`packages/core/src/start-work.ts` | 必填 `workingDirectory` 来自 Development ack；主执行与人工 fallback 都传同一值；缺句柄不借 Host cwd；不改规划状态或执行状态策略 |
| `packages/providers/execution-harness/src/index.ts`、`provider.ts`、`session-port.ts` | 只依赖 capabilities/domain；create/prompt/read 单操作共享预算；晚 create ack 不再 prompt；prompt 明确拒绝与结果不明区分；ref 由 Provider 构造；所属 rpcId/turn 终态优先；未知原因保留 unknown；取消恒 not_supported 且先于身份检查 |
| `tests/contract/fixtures/harness-session/replay.js`、`tests/contract/harness-execution-contract.test.js` | 重复键逐次消费、未知及剩余请求失败；0.2.0-rc.2 录制 completed/error/外部 aborted 冷读与零网络；不把 aborted 取消后记录冒充初始读取；合成 running/crash 与录制分开 |
| `tests/contract/suites/execution.js` | 新增 startInput 支持空 environment；Fake/Human 原有一次性输入 canary 与可用 cancel 的 canceled 强断言仍保留；Harness 取消 unavailable 时不伪造成功 |
| `tests/integration/harness-execution-fallback.test.js` | 真实临时 Git 工作树仍可读，create.cwd 等于规范 ack；create 明确失败人工降级；prompt 丢回执/超时/read 失败均 unknown、fallback=0、重试不再 create；后续 turn/交错/foreign request 取消均零写入 |
| `tests/e2e/status-policy.test.js` | 三种规划政策 × completed/error 保存实际 execution 终态，同时规划原值不变且 writer 调用数为零 |
| `docs/README.md`、`docs/exec-plan/completed/2026-10-26-harness-execution.md` | 归档索引目标存在；计划明确限定归一端口、取消 unavailable 和 Host/刷新边界。F1 指向计划状态头与最终完成事实不一致 |

### issue #140 验收与范围

| 当前验收 | 证据 / 判断 |
|---|---|
| 启动明确失败返回结构化失败、保留工作树并人工降级 | 真实 Git + Harness Provider + Core 集成的 create 故障路径；已通过 |
| session 在 execution worktree 而非默认目录创建 | Git ack 目录集成 + 录制回放显式替换 request.cwd；已通过 |
| 完成 session 不改变规划 Status | 三种政策下 completed/error，规划原值和零 writer 断言；已通过 |
| 离线执行合同与录制 fixture | 共享 execution 套件和真实录制回放分别通过；共享套件使用合成 SessionPort，录制 completed/error/aborted 单独验证；未声称真实 SDK 兼容 |
| 每种归一状态恰好一个 run status | 明确 switch、unknown 原型键/未来原因、空 history running 优先、缺 turn、后续 turn、冷读及外部 aborted；已通过 |

本轮直接读取的 #140 明确写“optionally cancelling”；当前恒拒绝取消是安全范围内的实现，不作为缺陷。#359 当前承担 Host catalog 和真实调用接线；原始 ctx.sessionController 不是本 PR SessionPort，直接接入不受本轮验收支持。#365 当前承担启动后的刷新、stale/unknown 展示，不要求本 PR 提供它。#193 与 #304 已分别跟踪跨崩溃执行恢复、持久 intent 与过期活 owner 隔离；本 PR 不承诺跨崩溃 exactly-once，未把它们重复开成新发现。TD-065/TD-066 保留版本漂移、真实模型和 Desktop 未验证限制。

### 发现

**F1 · P3 · 更新归档计划的状态头。** `docs/exec-plan/completed/2026-10-26-harness-execution.md:3` 是本 diff 新增行，仍写“状态：Active · 本地实现与验证已完成，待协调者独立验收及最终 PR 回读”。同文件最终独立验收段已记录 F1–F4 关闭、阻塞为 0，文件也已移入 completed 并登记索引。只读状态头的接手者会误判仍在等实现验收。按 `PLANS.md` §4，应在原处标注被最终验收取代，或直接更新为已完成并将剩余动作准确表述为 PR 现场回读。无需产品代码修改；非阻塞。 **Superseded by 本文「P3 修订独立复评」（2026-10-26）：修订已独立验证，F1 已关闭。**

## Progress

- [x] 2026-10-26：现场 Git 指令检查完成；产品工作区仅有协调者预建的本评审文件未跟踪。
- [x] 2026-10-26：全部 12 个 diff 文件、Session API 原记录和五个相关 issue 读取完成。
- [x] 2026-10-26：定向 113 项、typecheck、boundaries 9 项与发布面/规模/diff 检查通过。
- [x] 2026-10-26：E1–E6 正式变异整表执行一次，全部精确 KILLED，产品实现逐字节还原。
- [x] 2026-10-26：独立评审结论交协调者，无本轮远端写入。

## Surprises & Discoveries

取消并非缺失实现：当前录制 Host 只有 session 粒度取消，无法按 turn 原子约束。实现已主动拒绝取消，Core 的 stale running、后续 turn 与读间交错测试都证实不会误伤后续运行。SessionPort 是 session-probe-v1 的归一合同，实际 Host 信封适配不是本轮已交付事实。

## Decision Log

- 2026-10-26 / 独立评审：以 #140 当前 Scope/Acceptance 判定本 PR，不把 #359/#365/#193/#304 和 TD-065/TD-066 的有界后续事项当成本 PR 新增阻塞。
- 2026-10-26 / 独立评审：没有 P0/P1/P2，仅 F1（P3）；建议统一 review 使用 APPROVE，合并仍由人类决定。远端 review 与最终当前 head/checks 由协调者负责。

## Idempotence and Recovery

本轮验证没有网络模型调用；测试创建的临时工作树由用例清理。变异使用 `node scripts/review-mutate.mjs`，每项有 killedBy 并由脚本逐字节还原；最终 `git diff -- packages/providers/execution-harness/src/provider.ts` 为空。本轮无 remote mutation，也没有清理共享 worktree 或改写历史。

## Interfaces and Dependencies

关键接口是 `ExecutionProvider`、归一 `SessionPort`、Core 既有 `ambiguous_result`→unknown 分支和 Development 的工作树 ack；状态权威保留在 Host/Core。无新增依赖边，boundaries 9 项通过。真实 SDK、凭据、Host 版本及 Desktop 都未由本轮测试验证。

## Outcomes & Retrospective

下面命令在锁定 head 的 `.worktrees/harness-execution` 根目录执行；不是作者报告的转述。

| 命令 | 实际结果 |
|---|---|
| `pnpm run test:file tests/contract/harness-execution-contract.test.js tests/contract/harness-session-api-record.test.js tests/contract/execution-contract.test.js tests/integration/harness-execution-fallback.test.js tests/e2e/status-policy.test.js` | 113/113，exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | 9/9，exit 0 |
| `node scripts/rule-checks.mjs disclosure d470308bb42878fdf7b65e88095fed61bacd8289` | exit 0；本次未传 PR_BODY，PR 正文与五类公开面另经人工读查，未发现命中 |
| `node scripts/rule-checks.mjs size d470308bb42878fdf7b65e88095fed61bacd8289` | 代码 528 / 1000、文档 187 / 1500；满足本任务更严格的 <800 / <1300 预算 |
| `git diff --check d470308bb42878fdf7b65e88095fed61bacd8289...HEAD` | exit 0 |
| `node scripts/review-mutate.mjs <review-spec.json>` | exit 0；E1–E6 全 KILLED，每项精确归因；基线与还原后基线均绿 |

| 变异 | killedBy 用例片段 | 结果 |
|---|---|---|
| E1：用 Host cwd 代替 Git ack | `Git ack 目录取代 Host cwd` | KILLED |
| E2：prompt/read 不明降为 unavailable | `错误按调用阶段分类并脱敏` | KILLED |
| E3：foreign request 冒领首个 turn | `状态只属于 rpcId 的 turn` | KILLED |
| E4：aborted 误报 succeeded | `录制 0.2.0-rc.2` | KILLED |
| E5：未知结束原因误报 succeeded | `原型键和所有未知结束原因` | KILLED |
| E6：取消伪造成功 | `取消恒 unavailable` | KILLED |

没有重复运行全量 verify：本轮变化面已由 113 项定向行为、类型、依赖和六个判别变异覆盖；作者全量结果仅作为锁定 PR 元数据中的既有证据，未冒充本子评审实跑。

首轮结论：0 × P0、0 × P1、0 × P2、1 × P3。**Superseded by 本文「P3 修订独立复评」（2026-10-26）：F1 已关闭，当前所有级别均无未解决发现。** 建议 APPROVE，等待协调者回读当前 head/base/checks 并统一提交 review。

### P3 修订独立复评

2026-10-26，在检出 `feature/harness-execution`、产品基准仍为 `dcbeef275e0069cabd196ca4b4050d484af3a201` 的 `.worktrees/harness-execution` 根目录复评。修订仅在 `docs/exec-plan/completed/2026-10-26-harness-execution.md:3` 改为 Completed，并在 Bottom Change Note 记录状态头订正。独立读取当前文件和 diff，确认其与 completed 位置、`docs/README.md` 索引和既有最终独立验收事实一致；未引入新的范围或产品完成主张。`git diff -- packages tests` 为空。F1 已关闭，修复本身无新增问题。

按协调者要求，在最终产品树使用相同 spec 再完整运行一次 E1–E6：`node scripts/review-mutate.mjs <review-spec.json>` 返回 exit 0，六项均精确 KILLED；每项 killedBy 与上表相同，基线和还原后基线均通过，`git diff -- packages tests` 再确认空。本轮不重复全量 verify。文档契约和公开面再核查：全部强制章节保留，唯一索引目标存在，修订与评审记录无本机路径或凭据等五类发布面命中，最终 `git diff --check` 与机械 disclosure 通过。

复评结论：0 × P0、0 × P1、0 × P2、0 × P3 未解决，建议 APPROVE。记录中的 head 为复评产品基准；后续整合 commit、push 后的当前 head/base/checks 与最终 review/合并门由协调者处理，本复评不声称已完成这些外部步骤。

## Bottom Change Note

2026-10-26：预先矩阵完成逐层证据回填；登记唯一 P3 状态头问题、相关 issue 边界、113+9 实跑和 E1–E6 判别性变异；本轮无产品修改或远端写入。

2026-10-26：独立复评 P3 状态头修订并关闭 F1；在最终产品树再执行原 E1–E6 整表变异，六项精确 KILLED 且完整还原，确认无产品/测试持久改动。
