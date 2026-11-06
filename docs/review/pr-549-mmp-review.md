# PR #549 MMP 交付评审

## Purpose / Big Picture

独立审查 Start Work 显式任务交接的工程闭环：操作者填写的任务逐字符进入执行 session，任务身份在外部写前固定，重放/恢复不以旧运行冒认新任务。使用 Superpowers、Qian Systems Router 与 First Principles Development 的 audit / analysis-synthesis 方法；不把源码测试当作已安装 Desktop、真实模型、父项或 R1 验收。

## Context and Orientation

日期：2026-11-06（Asia/Singapore）。执行上下文：`.worktrees/iteration9-task-handoff`。
固定 base：`609463d8ee78a0cc83352512994e2b943e6e57bc`（main）；head：`3d80acfd087e5f3594446835e5fe76ee5ec698ca`。
协调者快照为 OPEN / Ready / MERGEABLE，mergeStateStatus 为 UNSTABLE；两提交分别为 `2043f9c731956b7af33004c385f781f73e4fc0c3` 与上述 head。reviews、comments 与 reviewThreads 均为空，threads 分页结束。closingIssuesReferences 只含同仓 #547。当前 checks 与最终审查发布由协调者锁定，本文不以快照替代最终远端门禁。

初始执行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`：HEAD 与指定值一致，工作树起始干净，隔离目录被忽略。审查过程中出现的其它 owner 新增计划未修改。

## Design / Spec

### 初始风险矩阵（详细 diff 前建立）

| 层 | P0 | P1 | P2 | P3 | 验证焦点与最终结果 |
|---|---|---|---|---|---|
| 代码 | main 必经路径全面失效 | 内容丢失、错误任务、重复执行 | 边界输入或分类遗漏 | 局部冗余 | 正常、失败、重试、恢复、幂等均审查；无新增发现 |
| 产品闭环 | 工程事实篡改规划事实 | 声称交接成功而没有任务 | 少数入口内容不完整 | 术语不清 | exact task 与 provider ack；人工/UAT 门保留；无新增发现 |
| 架构 | Host 权威/信任边界失守 | UI 第二事实源、跨层依赖 | 契约遗漏 | 不必要抽象 | 七不变量、请求拥有者、持久化；无新增发现 |
| 测试 | 必需 gate 无效 | 核心回归伪通过 | 故障路径缺失 | 断言组织 | scoped suites、浏览器及独立反例通过；无新增发现 |
| 工作项 | 错关父级发布门 | 宣称满足未执行验收 | 链接/范围/规模遗漏 | 文档措辞 | #547、#545、#72/#143、重复追踪与回滚；无新增发现 |

P0/P1 阻塞；P2/P3 为非阻塞问题，但仅报告真实、由 diff 引入且可定位的问题。本轮最终 P0/P1/P2/P3 均为0，inline finding 集为空。

## Global Constraints

仅读实现、元数据与测试；仅写本记录及忽略目录中的审查实验/日志。不修改实现、Git 历史或外部系统，不提交 review / issue comment，不合并。初始矩阵先于详细 diff；发现首项问题也须完成全部层。结论仅适用于上述 immutable head/base。

## Plan of Work

### Batch 1 · 固定事实与先行矩阵

完成根 AGENTS、`docs/review/mvp-review.md`、评审标准及所要求技能的读取；固定 SHA、工作树、全部初始线程和工作项边界，写入矩阵。

### Batch 2 · 分层审查与反例

审读全部9处生产文件增量和关联测试/文档，按调用链检查 UI → client → Host codec → controller → Core claim/intent → execution Provider → session port；重点复核 first-claim 窗口、租约续跑、离线路由、unknown 外部效果、旧 owner 与已有 run。执行最窄相关测试和独立反例。

### Batch 3 · 综合与交接

将全部发现一次性回传协调者。协调者负责最新 head/base、远端 checks、owner、正式评审和人类授权的收尾。

## Validation and Acceptance

### 代码、产品、架构与设计证据

- `start-work-request.ts` 单次捕获 primitive task；v2 fingerprint 在首次 claim 事务绑定任务、actor、scope、branch/path 与 Development binding。后续 intent 保存完整 input；`start-work.ts` 主执行与人工 fallback 都传 `command: request.task`，cwd 仍取 Git ack，不从 issue 正文、标题或当前 checkout 推断任务。
- `pendingClaim` 覆盖尚无 external intent 的认领窗口；同完整身份只观察，异任务冲突。`safeResume` 外层及 claim 事务内核对原 fingerprint/binding、Provisioning 租约、无 run/无 unresolved 外部步骤；确定拒绝与原 receipt 同事务结算。未决 create/start 只读恢复，known handle 只 getRun；owner generation 防止迟到写覆盖。
- 新 key 遇 Ready/context 或已有 run 返回固定 `existing_execution_task_not_sent`，Host 仅投影固定原因，client 转成明确“本次任务未发送”。原 key 的恢复保持原运行事实。已有 run 的后继 Git 补偿用例被替换为 Fake/SQLite × 主/备用 × Ready/Failed × running/unknown 零写冲突矩阵，符合批准的行为收窄；仍保留真正无 run 的安全恢复和迟到 owner 覆盖。
- UI 初始任务为空，限制16,384 UTF-16单元，只用 trim 判空而不改原文；pending/unknown 冻结，收起/重开保留原任务，item/连接/client owner 改变清空任务并隔离迟回复。client 在 await 前捕获全部任务字段，身份包含 task，unknown 先 reader 再原键 replay。
- 真实 Host/remote → Core → Harness Provider 的录制 SessionPort 测试断言 prompt.content 精确匹配多行 Unicode/前后空白，Git cwd 为真实已确认规范路径，create/prompt 唯一。人工 fallback 保持明确分类，不声称模型已收到任务。
- 依赖方向未改变，无新增 DDL、Provider 互调、第二任务表、规划事实源或 LLM 门禁。Planning/Execution 两轴仍独立，Provider ack 才能权威确认，凭据仍只使用原 secret handle 路径。
- 设计只增加显式任务字段、复用 fingerprint/intent/owner 与固定错误原因；没有模板系统、自动 Issue 解释、追加会话协议或兼容迁移。新增认领扫描复用原 mutation ledger；与独立可回滚能力闭环相称。

### 本轮实际命令与观察

以下命令均在指定 worktree、上述 head 执行，全部 exit0；测试均无 fail / skip / cancelled。

| 命令 | 结果 |
|---|---|
| `pnpm test:file tests/integration/start-work-task-handoff.test.js tests/integration/start-work-execution-uniqueness.test.js tests/integration/start-work-execution-recovery.test.js tests/contract/ui-start-work.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/e2e/controller-roundtrip.test.js` | 282/282 |
| `pnpm test:file tests/integration/harness-plugin-host-execution.test.js tests/integration/harness-plugin-start-work.test.js tests/integration/start-work-request-binding.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/runtime-planning-access.test.js tests/integration/runtime-operation-access.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/e2e/start-work-recovery.test.js` | 464/464 |
| `pnpm test:file tests/browser/workspace-execution.test.js tests/browser/detail-expand.test.js` | 9/9 |
| `pnpm typecheck` | 通过 |
| `pnpm boundaries` | 9/9 |
| `node --input-type=module`（独立 task probes，stdin 执行） | 8/8 |
| `node scripts/rule-checks.mjs size 609463d8ee78a0cc83352512994e2b943e6e57bc` | 799代码/测试/config、208文档；符合 #547 的800/1300及仓库1000/1500上限 |
| `node scripts/rule-checks.mjs disclosure 609463d8ee78a0cc83352512994e2b943e6e57bc` | 机械扫描通过；未传 PR_BODY，不以此声称扫描描述 |
| `git diff --check 609463d8ee78a0cc83352512994e2b943e6e57bc...3d80acfd087e5f3594446835e5fe76ee5ec698ca` | 通过 |

8项独立反例：8,193 emoji 超限零启动；8,192 emoji（恰好16,384单元）逐字符启动；同键另一等长任务冲突且启动数不变；确定 worktree 拒绝如实 Failed；失败原键更换任务冲突零新写；新键明确替代任务在无 run 时恢复并原文持久化；Development 离线且原启动未决时异任务冲突且账本不变；相同任务新键只观察且不消耗新键/改写账本。

运行源与日志在仓库根忽略目录 `.superpowers/pr549-551-mmp-review-20261106/agent549/`。本轮遵守只读实现边界，未施加代码变异，因而不声明 mutation killed / RED-GREEN；现有测试判别力按断言和独立状态反例审查。没有重复全量 verify，也没有沿用作者测试数量冒充本轮执行。

人工五类目审查生产、测试、计划、提交消息与已读 PR 描述：未见新增凭据、本机身份路径、非必要个人信息、内部系统或保密内容。代码规模为固定候选，不包含本轮新增审查记录；协调者纳入记录后须重新扫描规模与发布面。

### 工作项与验收边界

现场读取 #72、#143 与 #546，并按 all-state 搜索 `task handoff`、`Start Work task`；#545/#547 与 PR 元数据使用协调者取得的完整快照。#546 为同一缺口的更早跟踪，和 #547 有范围重叠，仍 OPEN；本 PR 仅 Closes #547，不重复新建、不擅自关闭 #546。

#547 六组验收均有源码与本轮自动化证据对应：实际 session prompt、显式非法输入与限制、同/异键与 caller 变更、restart/唯一性、UI/client uncertainty 与 scope 切换、工件边界记录。completed ExecPlan 自包含，demo 第6步说明明确任务与恢复路径。#545 的真实付费模型任务仍未执行；#72 的真实 PR/CI 显示和 #143 的人类完整走查仍 OPEN。本轮没有安装候选或变更 Planning Status / blocking 关系。

## Progress

- [x] 锁定工作树、SHA、元数据与初始矩阵。
- [x] 完成代码、产品、架构、测试、设计及工作项全层审查。
- [x] 完成 scoped suites、浏览器、类型、边界、8项独立反例与发布面检查。
- [x] 汇总全部发现（空集）并交接协调者。

## Surprises & Discoveries

`Ready` 无 run 的崩溃残留仍可能停在 Unknown；这是未改动的 `readyGap` / `existingResult` 保守路径，已有 TD-006 / TD-012 与 #193 承接，不能把本 PR 的 Provisioning 安全续跑扩大解释为所有崩溃都可自动恢复。此限制在 base 已存在，本轮不将其伪报为新增 finding。未知外部结果继续优先防重复启动。

## Decision Log

- 2026-11-06：以实际任务输入与 durable identity 为审查结果，保留工程证据、安装件、模型结果及人工发布门的区别。
- 2026-11-06：全矩阵无新增 P0–P3；建议协调者在最终 head/base/checks 锁定后 APPROVE，工程能力可独立合并及回滚。本文不构成合并授权。

## Idempotence and Recovery

审查不修改生产数据、实现或 Git 历史。仅本记录新增，运行实验使用内存 SQLite / 测试临时资源。实现撤销按整 PR revert；不删除已 ack 的分支/工作树/session，不抹除未知回执。本轮未新增技术债；上述已有限制继续由原跟踪项管理。

## Interfaces and Dependencies

`StartWorkIntent` / `StartWorkCommandInput` / `StartWorkRequest` 增加 required task，Host positional ABI 由4–5参数变为5–6参数。`ProviderStartRunInput.command` 继续为文本任务，现有 Harness Provider 原样发 prompt。无新外部依赖或 schema 迁移，未经批准不维持旧实验请求可写兼容。

## Outcomes & Retrospective

完成独立工程闭环审查，无 actionable inline finding；建议可进入协调者最终门禁。结论限于固定源码候选，不包括本轮未运行的全量 verify、真实模型、实际 Desktop 安装、人工 #72/#143/#545 或 R1 接受。远端 head/base、required checks、review 发布与最终 merge 均由协调者处理。

## Bottom Change Note

2026-11-06：先建立矩阵，再完成独立分层审查、8项反例与 scoped 验证；保留 #546 重复追踪和现有 Ready-gap 限制的准确边界，未修改实现或外部状态。
