# Durable Start Work Evidence ExecPlan

> 状态：Completed（本计划工程验收完成；PR 评审及上层门禁独立）
> 创建：2026-11-10
> 范围：为 #141 补足真实 Local Git 与文件 SQLite 同时参与的 Start Work 恢复证据，不改生产行为。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/architecture/release-gates.md`、#141、#304。

## Purpose / Big Picture

Start Work 的关键失败与重启结果由真实 Git 工作树和重新打开的 SQLite 文件共同证明。完成后，四个 #141 行为均是命名清楚的 integration cases，数据库在恢复场景中确实关闭并重新打开，结果来自新组装的 Core 和持久记录，而不是内存导入或旧对象引用。

## Context and Orientation

R1 条件 10 要求 Start Work 失败恢复；#141 明确要求四项 integration 行为和真实文件重开。现有 `tests/integration/start-work-sqlite-registration.test.js` 在 SQLite 上覆盖生产 `commands.startWork`，但没有完整的 Local Git + 文件 SQLite 故障/重启组合。`tests/integration/local-git-fixture.js` 已支持注入 storage；本次优先新增组合用例，不为测试便利扩展生产接口。

本计划仅证明本地工程恢复。#304 仍包含旧 owner fencing、丢失句柄和 #554 installed recovery 接受；#141 通过不能关闭 #304、替代 Desktop 人验或形成 R1 通过结论。

## Design / Spec

新增一个 integration 文件，以 `composeCore`/公开命令入口、真实临时 Git 仓库、文件 SQLite 和离线 Execution fake 构造一个可重开的组合。覆盖：工作树创建确定失败时不启动执行；执行启动确定失败时保留已有 Git/context 并如实走人工 fallback；同键和新键重放不创建第二份 context/worktree/run；关闭数据库、重开同一路径并重组 Core 后恢复既有 context/relations/run 引用。

同键重放保留原操作的结论与身份，不要求瞬态分支头或错误文案逐字相等。Git 确定失败后可用新键恢复；已有 Ready/run 时，新键代表新任务，现有公开契约以 `conflict / existing_execution_task_not_sent` 拒绝，不能把旧运行当成已接收新任务。新键拒绝与同键 Saved 都必须保持本地事实、Git 总量及执行调用数不变。

优先严格按 #141 四项验收，不扩为额外基线前进情景矩阵。若 issue 现有验收项无法被四个场景判定，再先报告缺口给主控，不因技术好奇添加场景。断言磁盘上的分支/工作树、文件路径、持久关系和外部调用次数；不只断言命令返回值。测试若首次全绿是允许结果，记录为缺失组合证据，不制造虚假的 RED。

放弃把所有既有 Git 测试参数化到两个 Storage adapter：那会扩大迁移面且重复已有 Fake 覆盖。放弃真实插件/模型或 GitHub 写入：成本与不确定性更高，不能替代受控的本地恢复组合。

## Global Constraints

- 唯一 owner；允许变更的代码/测试文件仅为 `tests/integration/start-work-local-git-sqlite.test.js` 与必要时 `tests/integration/README.md`；主控另维护 `docs/architecture/release-gates.md` 的 #141 局部证据订正和 `docs/README.md` 索引。`tests/integration/local-git-fixture.js` 仅当现有 injection 接口确实不能构造该组合时才可改；生产 Core、Provider、Storage 和 Host 文件不在本计划范围，发现生产缺陷须停下报告。
- additions+deletions 的代码/测试总量不超过 800 行，文档不超过 1300 行；当前预估 300–450 / 160–280。不得为满足 TDD 形式而伪造先红；任何新增场景须对应 #141 的具体验收缺口。
- 每个恢复验证都关闭原 SQLite handle，再以相同文件路径创建新 storage 并重新组装 Core；不得从 Fake Storage export/import 证明磁盘持久化。
- 仅使用临时目录、真实本地 Git argv 调用和合成执行 Provider；不调用模型、GitHub 写入或用户 Profile，不改 Planning 状态、关系或 #304 native dependency。

## Plan of Work

### Batch 1 · Durable recovery evidence（#141）

**最小闭环**：同一 production Core 命令路径在真实 Git + 文件 SQLite 上证明 #141 的四项恢复行为，并记录可复跑结果。

**涉及文件**：`tests/integration/start-work-local-git-sqlite.test.js`。

先复用 `local-git-fixture.js` 已有 Storage 注入和注册工作项能力，构造新测试文件。为每个场景使用独立临时仓库和 SQLite 文件；失败执行只用确定失败的合成 Provider。断言执行调用计数、真实 Git 状态和持久化的 context/relations/run。重启场景完整关闭 handle，重新打开同路径并重建 Core，再读取旧 key 与新 key。若新测试已绿，保留实际结果；若失败，定位最小真实根因，未获主控重规划前不得越界修改生产代码。

**验证**：在检出 `test/durable-start-work` 的 `.worktrees/durable-start-work` 根目录运行 `pnpm test:file tests/integration/start-work-local-git-sqlite.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/start-work-execution-recovery.test.js`（期望：新增与已有相关用例非空且全绿）。之后运行 `node --test tests/integration`（期望：非空、fail 0；这是 #141 原始集成层验收）。以一次定向有效性变异确认“重启读旧文件”断言能区分替换为新空数据库路径；恢复测试输入后复绿。最后按触及层级运行 `pnpm run boundaries`。

**回滚**：revert 新 integration 闭环及其必要文档；不触碰生产数据库或外部资源。

## Validation and Acceptance

只有四项行为均在 integration 层执行且断言真实 Git/SQLite 事实时才算工程闭环。提交报告必须区分测试组合证据与用户安装验收、#304 父接受、R1 人类裁决；完整命令结果以最终工作树为准。

## Progress

- [x] (2026-11-10 10:10 SGT) 完成独立调查和实现边界审查。
- [x] (2026-11-10 10:25 SGT) 新增真实组合与四项判别性 integration cases；定向四文件 346/346 通过。
- [x] (2026-11-10 10:27 SGT) 目标四文件 346/346、完整 integration 层 2175/2175、boundaries 9/9 通过；空文件变异按预期失败并恢复后四例复绿。

- [x] (2026-11-10 10:33 SGT) 独立对抗验收通过：新四例与既有任务交接五例均通过，无 P0–P3 发现。

## Surprises & Discoveries

- 当前 SQLite registration integration 已证明 `startWork` 一次到位，但其本身不替代 #141 指定的重开文件与真实 Git 组合。
- 现有真实 Git 恢复用例明确标注使用离线 Storage；文件 SQLite 重启因此仍是独有证据缺口。
- 测试不需要故意先失败：本工作首要缺少的是完整组合证据，正确实现可能使新场景首次运行即通过。
- 首轮新文件为 2 pass / 2 fail，失败来自测试对现有契约的错误假设：失败重放不逐字保留瞬态分支头/错误文案；Ready/run 后的新键明确拒绝为新任务。`packages/core/src/start-work.ts` 的 `claimContext` 与 `tests/integration/start-work-task-handoff.test.js` 保护这一行为，不是本次发现的生产缺陷。修正测试假设后四例通过，未改生产代码。
- 将重开输入临时替换为空 SQLite 文件，唯一重开用例在“新 Core 在任何命令之前从磁盘恢复完整旧事实”断言处失败（context/run/Query 缺失，relations/attempts/行集合为空）；恢复同文件输入后四例复绿。这是断言有效性变异，不是生产修复的 RED。

## Decision Log

- 决策（2026-11-10 / 本会话人类条件授权）：PR #601 无 P0/P1 后由评审会话继续收尾；用户直接指令为“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。
  理由：本轮完整 MMP 风险矩阵无新增 P0–P3；独立证据和当前版本门见 [本 PR 评审](../../review/pr-601-mmp-review.md)。合并授权仅覆盖本会话点名的 #600–#602，Planning Status 与父验收不随工程事件更新。

- 决策：新增窄 integration 文件，不参数化或重写现有 Local Git 用例。
  理由：现有 fixture 已支持 Storage 注入；共享 fixture 修改增加同一时刻多路写入风险，也不是证明目标所必需。
  日期/作者：2026-11-10 10:10 SGT / Codex。
- 决策：#141 的四项原始验收作为范围，不增加第五个分支前进矩阵。
  理由：先关闭明确缺失的 Git+SQLite 组合，避免把证据工作扩成新恢复策略设计。
  日期/作者：2026-11-10 10:10 SGT / Codex。
- 决策：不把可选的额外分支前进场景表述为已覆盖；若实施揭示原始四项不足，先报告主控再修订计划。
  理由：保持 #141 原验收边界，避免无声扩大或虚报证据。
  日期/作者：2026-11-10 10:15 SGT / Codex。
- 决策：新键在 Ready/run 后按既有任务交接契约断言 fail-closed conflict，并断言 SQLite/Git/执行调用不变；同键保持原操作结论与身份。
  理由：#141 要求不重复创建，没有要求把新任务误报 Saved。主控确认该验收解释，恢复证明仍由重开后的命令前持久事实及原键重放承担；不扩大为生产改动。
  日期/作者：2026-11-10 10:24 SGT / Codex。

## Idempotence and Recovery

测试每次使用独立临时目录，关闭数据库后再清理目录；重复运行不会写用户仓库、持久 profile 或外部 Provider。失败时保留最小失败断言并修复夹具/真实缺陷，不得放宽验收；发现生产修复需求则在本批停止并交回主控决定新范围。

## Interfaces and Dependencies

依赖 Node.js `node:test`、pnpm workspace、Git CLI argv、安全的 Local Git Provider、SQLite Storage、`local-git-fixture.js` 的现有 storage 注入和合成 Execution Provider。无需凭据或网络。命令在指定 worktree 根目录执行。

## Outcomes & Retrospective

2026-11-10 10:27 SGT，在检出 `test/durable-start-work` 的 `.worktrees/durable-start-work`（计划提交 `fb93e603` 加未提交实现）完成 Batch 1 的本地工程验证：目标四文件 346 tests、完整 integration 层 2175 tests / 8 suites、boundaries 9 tests 全部 fail 0。变异用例为 1 test / 1 fail，失败原因见 `Surprises & Discoveries`；恢复输入后的新文件为 4 tests / fail 0。完整 integration 日志保存在本地运行态目录 `.superpowers/sdd/2026-11-10-durable-start-work/integration.log`。

生产代码与共享夹具零改动；新增四例均使用相同真实 Local Git + 文件 SQLite 组合，合成主执行确定拒绝，fallback 由离线替身确认。真实关库重开后，命令前完整事实及原键重放共同证明恢复，新键拒绝只证明不会重复派发。未覆盖可选第五个基线前进矩阵，未操作原故障数据库；#304 native prerequisite、installed recovery 人验、R1 裁决与最终 PR 独立验收仍由各自门禁承担。

上述“最终 PR 独立验收仍待完成”的时点记录已由本段取代（2026-11-10 10:33 SGT）：独立审阅者确认四项原始验收均满足，无 P0–P3 发现；代码为纯测试闭环，没有生产改动。当前远端状态以 `gh pr view 601 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,mergeStateStatus,closingIssuesReferences` 与 `gh pr checks 601 -R SingularityKChen/harness-projects` 回读为准，期望 head 对应本分支、base 为 main、关联 #141 且执行检查通过。

## Bottom Change Note

- 2026-11-10 10:10 SGT：依据 #141 原始验收和当前 Fixture/Storage 分布创建最小组合证据计划；明确真实文件重开且不伪造 RED。
- 2026-11-10 10:10 SGT：按主控交付边界统一 Batch 标签为 `Durable recovery evidence`。
- 2026-11-10 10:15 SGT：将已完成设计调查标为完成，并记录可选恢复场景未声称覆盖。
- 2026-11-10 10:25 SGT：记录四例实现、首轮测试假设修正及空文件变异证据，明确同键结论与新键任务拒绝语义；完整 integration 层验证继续运行。
- 2026-11-10 10:27 SGT：记录完整 integration 与边界检查通过的实际证据，完成本批本地实施；保留独立验收与原人类门禁。

- 2026-11-10 10:33 SGT：登记独立验收，计划移入 completed 并维护文档索引；工程接受不替代 #304 或 R1 人类裁决。

- 2026-11-10 10:41 SGT：仅订正 release-gates 历史第 10 行中“无真实 Git/SQLite 组合”的陈述，保留原行其余观察和上层裁决，未重判全部 R1 快照。

- 2026-11-10：登记 PR #601 完整矩阵、独立变异与直接条件收尾授权；计划保持 completed，公开提交按独立交付物整理，最终 head 的 checks/review/issue 与 rebase 结果按评审回读门判定。
