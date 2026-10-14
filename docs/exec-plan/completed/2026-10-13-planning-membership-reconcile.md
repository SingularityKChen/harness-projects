# Planning Membership Reconcile ExecPlan

> 状态：Completed（2026-10-14 归档，随 PR #330 收尾）
> 创建：2026-10-13
> 范围：完成 issue #332（从 #134 拆出的 membership scope 收敛前置，计划内曾称 #134A）：为 Planning 全量对账提供 scope 内 membership 收敛端口，删除 provider 已移除的 membership/field values，同时保持 entity/external identity 稳定。
> 上游输入：AGENTS.md、PLANS.md、issue #134、#332、#305、#220、#199、packages/core/src/bootstrap.ts、packages/capabilities/src/storage.ts。

## Purpose / Big Picture

完成后，一次成功的 Planning 全量读取会在同一 Storage transaction 内使 membership、projection 和 freshness 与 provider 完整集合一致：provider 删除条目后本地 membership 与 field values 消失，移除后重新加入保留原 content identity/entity id。失败或截断读取不做收敛。本计划交付并关闭 #332；它与 #134 及其他拆分 issue 的关系只在 `Global Constraints` 第一条写一处。本计划不实现 scheduler 或 explicit refresh command。

## Context and Orientation

当前 live origin/main=7c7e77cc 已包含 #305 round ordering、#220 revision freshness 与 #199 degraded failure。入口 packages/core/src/bootstrap.ts 会在一轮 full read 中 replace projections，但 project_item_membership 及其 field values 没有 scope replace；Fake 与 SQLite 的 Storage transaction 仅有 put/list，没有安全的 scope reconcile。#134 acceptance 的 provider 删除 item 后 membership 消失因此无法由当前接口满足。

Membership scope 必须是 workspaceId 加 planning project externalId，不能按 entity 全局删除；entity/external identity 要保留以支持 remove/re-add identity stability。#305 的 latest-started round fence、#220 的 same-projection revision policy 与 #199 的 failure retention 均保持不变。

## Design / Spec

- 在 capabilities Storage/StorageTransaction 契约新增 replacePlanningMemberships(scope, incoming)；输入是本轮完整 membership 集合。
- Fake 与 SQLite 在同一事务内删除 scope 中不在 incoming 的 membership 与 field values，再 upsert incoming；不删除 entity、external_identity、projection identity。
- bootstrap 的 commitSync 在 full read 成功且通过 #305 fence 后，先收敛 memberships，再 replace projections、cursor、health/revision；provider failure、分页不完整、Storage reject 不执行任何 scope deletion。
- 只接收已确认完整的 incoming 集合，redacted 也按其 membership 身份参与集合比较；不把 provider reconcile advisory stream 当作 correctness source。
- 不新增 migration；复用现有表和 delete/upsert SQL。若 SQLite 现有表约束证明无法表达 scope replace，暂停实现并记录阻塞，而不是偷偷引入双写/兼容层。

## Global Constraints

- 关闭关系（本计划唯一权威表述，2026-10-14 按现行拆分改写）：本层 PR #330 使用 `Closes #332` 并 `Refs #134`。Core refresh / bounded scheduling 由 issue #334 承接（栈顶 PR #331 以 #334 为关闭对象）；真实 Host 生命周期启动 scheduler 与 scheduled 验收由 issue #335 承接；#134 保持 OPEN 作为总跟踪，本层的提交与 PR 正文都不得出现会关闭 #134 的关键字。本层的交付与验收不依赖 #331、#334、#335 的任何实现。
- 代码≤800行、文档≤1300行；#134A 不修改 scheduler/controller/apps。
- 不改 #305 round token、#220 revision semantics、#199 error redaction。
- TDD 先写 Fake/SQLite contract red tests，再实现 port/adapter/core callsite。
- 不写 Project Status、blocked-by、blocking；外部 write 仅在人类批准后执行。

## Plan of Work

按 Batch 1–4 顺序执行：先写并观察 Fake/SQLite contract 红测，再实现 capabilities port 与两适配器，接入 bootstrap transaction，最后运行全套门禁并整理提交。每一步只在当前 worktree 内修改，保持 scheduler、controller、apps 不变（它们属于 #334 / #335）。

### Batch 1 · Storage contract red tests

最小闭环：在 Storage contract 中加入 provider deletion scope/identity stability 的失败用例。

涉及文件：tests/contract/suites/storage-identity-membership.js、tests/contract/storage-contract.test.js、tests/integration/planning-membership-reconcile.test.js。

- 构造两个实体、同一 project scope、不同 membership；删除一个 provider item 后运行完整 bootstrap。
- 断言现实现仍保留 stale membership/field values，且 remove/re-add identity baseline 失败。
- Fake/SQLite 各自运行，确保测试失败原因是缺失 scope replace，而非 fixture 错误。

验证命令：
node --test tests/contract/storage-contract.test.js tests/integration/planning-membership-reconcile.test.js
期望：新增 deletion/identity tests 在未实现时失败，现有 storage contract 不退化。

回滚：删除新增 red tests。

### Batch 2 · Scope replace port and adapters

最小闭环：Fake 与 SQLite 在 tx 内提供同名 scope replace，删除 stale membership/field values，保留 entity/identity。

涉及文件：packages/capabilities/src/storage.ts、packages/capabilities/src/registry.ts、packages/providers/fake/src/storage.ts、packages/storage/sqlite/src/storage-sync.ts。

- 按现有 Storage naming/transaction convention 固定参数与返回值。
- Fake 以 draft state 做删除/upsert；SQLite 以 scope predicate 做 delete/upsert。
- 验证删除范围只作用于 workspace+project external id；同 entity 出现在另一 scope 时不被误删。

验证命令：
node --test tests/contract/storage-contract.test.js tests/integration/identity-membership-schema.test.js
node_modules/.bin/tsc --noEmit
期望：Fake/SQLite 同一 contract 结果，删除 scope 外数据保持不变。

回滚：反向 port/adapter commit；无 migration。

### Batch 3 · Bootstrap convergence

最小闭环：成功 full read 将 incoming membership 传入 scope replace；失败/截断 round 保持 last-known state。

涉及文件：packages/core/src/bootstrap.ts、tests/integration/planning-membership-reconcile.test.js。

- 把 membership collection 与 projection upsert 共享同一 full-read completeness 判据。
- 保留 #305 latest-started fence；被拒绝旧 round 不执行 deletion。
- 添加 remove/re-add identity stability 与 field values 删除断言。

验证命令：
node --test tests/integration/planning-membership-reconcile.test.js tests/integration/planning-round-order.test.js tests/integration/sync-revision-freshness.test.js
pnpm run boundaries
期望：删除收敛、重加 identity 稳定、乱序/失败策略既有测试全绿。

回滚：反向 bootstrap callsite，保留已验证 port 可单独回滚。

### Batch 4 · 对抗验收与 draft linkage

最小闭环：验证截断、失败、scope 混淆与 mutation，创建 draft PR 作为 #332 的关闭载体（关闭关系见 `Global Constraints` 第一条）。

涉及文件：本计划、contract/integration tests。

- provider 后续页失败、page loop、superseded 轮次、提交事务内写入被拒都必须不删 membership / field values、不推进 revision；scope 校验的 bindingId、objectKind、externalId 三个分量各有判别用例。
- mutation：删除 scope predicate、把 incoming 传空（core 侧与 SQLite 空集合分支）、误用 entity-global delete、superseded 轮次照样收敛、部分读取被提交，均应被 contract/integration tests 杀死；在最终代码树上整表运行一次，读数写进 `Progress`。
- 运行发布门禁并创建 draft PR，使用 Closes #332 与 Refs #134，回读 issue↔PR 与 Project agent-owned fields。

验证命令：
node --test --test-timeout=120000 tests/contract/storage-contract.test.js tests/integration/planning-membership-reconcile.test.js
node scripts/review-mutate.mjs <spec.json> --root .（spec 按 `Progress` 2026-10-14 变异表的位置与替换构造，放在被 git 忽略的 `.superpowers/` 下）
pnpm verify
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
期望：全绿；变异表除 `Progress` 记录在案并说明原因的存活项外全部 KILLED；PR 只关闭 #332，不关闭 #134（见 `Global Constraints` 第一条）。

回滚：反向提交，保留数据库不变；无 migration。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | provider deletion | membership 与 field values 消失 |
| 2 | identity stability | remove/re-add 保持 entity/external identity |
| 3 | failure safety | 后续页失败、分页成环、superseded 轮次、事务内写入被拒都不执行 deletion、不推进 revision |
| 4 | scope isolation | workspace+project scope 外数据保持 |
| 5 | adapter parity | Fake/SQLite contract 同结果 |
| 6 | revision policy | same-state 不增 revision，#305 fence 保持 |
| 7 | size/release | code≤800/docs≤1300，checks/disclosure/diff-clean |
| 8 | linkage | draft PR 使用 Closes #332 + Refs #134；#134 未被提前关闭 |

## Artifacts and Notes

实现产物集中在 capabilities Storage contract、Fake/SQLite adapters、core bootstrap 及 contract/integration tests；无数据库 migration。本计划关闭 #332；其余拆分 issue 的去向见 `Global Constraints` 第一条。

## Progress

- [x] 2026-10-13：两份独立 #134 设计与总审阅完成，确定必须先做 membership scope replace。
- [x] 2026-10-13：Batch 1 storage contract 红测先失败（Fake/SQLite 缺少 scope replace），实现后 146/146 契约与 membership 集成测试通过。
- [x] 2026-10-13：Batch 2/3 完成 Storage port、Fake/SQLite 原子 scope replace 与 bootstrap full-read convergence；规划 membership 集成测试覆盖删除、重加、失败/截断保留。
- [x] Batch 4：运行全套门禁并整理独立提交；#332 bottom PR linkage 由父任务处理，#134 保留给 top closure。（「#134 保留给 top closure」Superseded by `Global Constraints` 第一条（2026-10-14）：#134 不由栈顶 PR 关闭，保持 OPEN。）（2026-10-14 订正：勾选时 Batch 4 计划内的变异没有执行、没有读数，补做见下方 2026-10-14 变异条目。）
- [x] 2026-10-13：补充跨 project `project_item` 输入的 Fake/SQLite 共享反例；引导在任何 Storage 写入前校验完整读取的条目 project 与确认 project 一致，失败保持 membership、field values 与 projections 不变。
- [x] 2026-10-13：`pnpm verify`（typecheck、contract/integration/e2e 1518/1518、MVP-0 7/7）、`pnpm run boundaries`（8/8）、`node scripts/workflow-check.mjs`、disclosure、size、`git diff --check` 均通过；PR #330 native `closingIssuesReferences` 仅 #332，#134 保持 open。
- [x] 2026-10-14：人类伙伴在评审会话中把 #330 的修复与收尾指定由该会话负责（问「四个 PR 的修复与收尾由谁负责？」，答「本会话负责（推荐）」）。第二轮 MMP 评审（head `55a99494`）的关闭路线意见（P2）已处理：关闭关系见 `Global Constraints` 第一条，归档规则见 `Outcomes & Retrospective`。
- [x] 2026-10-14：第二轮 MMP 评审其余意见逐条处置（均判定属实，均已修）：
  - P2「#332 验收 3 的 superseded / provider 失败 / 不推进 revision 没有判别测试」：`tests/integration/planning-membership-reconcile.test.js` 把未提交轮次参数化为分页成环、后续页 provider 结构化错误（`rate_limited`）、superseded（读取期间嵌套一轮完整 bootstrap 先提交，本轮以 `stale_revision` 放弃）、提交事务内 `putReconcileCursor` 被拒四种，Fake/SQLite 各一条，断言 membership、field values 与 `currentRevision` 三者不变；原「failure or pagination cycle」标题按实际构造改名。
  - P2「incoming 为空的分支不受任何契约保护」：`tests/contract/suites/storage-identity-membership.js` 的 scope replace 契约用例末尾补 `replacePlanningMemberships(scope, [])`：scope 内成员与字段值清空，另一个 project、另一个 workspace 的字段值与外部身份不变；补在原用例内，`IDENTITY_CASE_COUNTS` 不变。
  - P3「binding / objectKind 两个比较没有判别测试」：scope-mismatch 用例按 externalId / bindingId / objectKind 三个分量参数化，Fake/SQLite 各三条。
  - P3「删除 scope 取自可变的 context.projectRef 并带 '' 兜底」：`packages/core/src/bootstrap.ts` 的 `validatePlanningItems` 返回把 project 与 items 绑在一起的 `ValidatedPlanningRead`，`commitSync` 的删除 scope 取 `read.project.externalId`；正常路径上二者是同一个 ref，行为不变。
  - P3「ExecPlan 执行记录与仓库事实有三处不符」：Batch 2 涉及文件订正为 `packages/storage/sqlite/src/storage-sync.ts`；批次归入 `Plan of Work`；Batch 4 的变异读数见下一条。
- [x] 2026-10-14：在最终代码树上整表运行一次变异：在检出 `docs/planning-membership-reconcile-plan` 的工作树根目录运行 `node scripts/review-mutate.mjs <spec.json> --root .`，spec 的测试命令是 `node --test --test-timeout=120000` 加 11 个文件（`tests/contract/storage-contract.test.js`；`tests/integration/` 下的 `planning-membership-reconcile`、`planning-round-order`、`sync-revision-freshness`、`github-projects-bootstrap`、`workspace-sync-scope`、`storage-sync-surface`、`identity-membership-schema`、`planning-fields`；`tests/e2e/` 下的 `chain-bootstrap`、`workspace-read-assembly`），未变异基线 333/333 通过。结果 13 KILLED、1 SURVIVED，见下表；M7 存活的原因见 `Surprises & Discoveries` 2026-10-14。
- [x] 2026-10-14：修复的独立复评（head `42888169`）：第二轮 6 条意见按原条件复核均已修，第一轮 P1（跨 project redacted 条目）以 R1–R4 复跑无回退；新提 3 条 P3 已就地处理：scope 校验用例扩为三个分量 × {redacted, visible} 两个通道（复评变异 X4「只校验 redacted 条目」由新增的 visible 用例杀死，Fake 与 SQLite 各三条），M7 存活理由的前提与 `ValidatedPlanningRead` 的 Decision Log 措辞按代码事实订正。
- [x] 2026-10-14：门禁在检出本分支的工作树根目录、代码树等于本轮最后一个代码提交时运行，全部通过：`pnpm verify`（typecheck、contract/integration/e2e 1528/1528、MVP-0 7/7）、`pnpm run boundaries`（8/8）、`node scripts/workflow-check.mjs`（no findings）、`node scripts/rule-checks.mjs disclosure 7c7e77cc`（机械扫描未命中）、`git diff --check 7c7e77cc...HEAD`（无输出）。规模在写入本条前观察为代码 296 / 文档 171 行，重算用 `node scripts/rule-checks.mjs size 7c7e77cc`。

| id | 位置与替换 | 结论 | killedBy（失败用例名片段） |
|---|---|---|---|
| M1 | `bootstrap.ts` 跳过 `validatePlanningItems` | KILLED | another project externalId fails closed |
| M2 | `validatePlanningItems` 只比较 externalId | KILLED | another project bindingId |
| M2a | 只去掉 bindingId 比较 | KILLED | another project bindingId |
| M2b | 只去掉 objectKind 比较 | KILLED | another project objectKind |
| M3 | redacted 条目的已知 membership 不进 incoming | KILLED | REDACTED（既有 REDACTED 生命周期用例） |
| M4 | SQLite 删除去掉 project 谓词，按 workspace 全局删除 | KILLED | 规划成员 scope replace |
| M5 | SQLite 空 incoming 直接返回 | KILLED | SQLite Storage（身份同步组）：规划成员 scope replace |
| M6 | Fake 不删 stale field values | KILLED | 规划成员 scope replace |
| M7 | SQLite replace 循环去掉同内容去重 | SURVIVED | — |
| M8 | superseded 分支照样 upsert 并收敛成员 | KILLED | superseded round keeps membership |
| M9 | core 以空集合调用 `replacePlanningMemberships` | KILLED | membership deletion converges |
| M10 | 吞掉提交事务内 `putReconcileCursor` 的拒绝 | KILLED | storage reject inside the commit transaction |
| M11 | 后续页 provider 错误时提交已读部分 | KILLED | provider error on a later page |
| M12 | 分页成环当作完整读取 | KILLED | pagination cycle keeps |
| X4 | 校验只对 redacted 条目生效（复评补充，单独运行 `tests/integration/planning-membership-reconcile.test.js`） | KILLED | visible item with another project |

## Surprises & Discoveries

- 2026-10-13：现有 replacePlanningProjections 只删 projection，不删 project_item_membership/field values；这是 issue #134 deletion acceptance 的直接根因。
- 2026-10-13：按 entity 全局删除会破坏跨 project scope，必须按 workspace+planning project external id 收敛。
- 2026-10-13：完整 membership incoming 只能在 provider full read 成功且分页完整后应用；失败 round 不能用空集合清空。
- 2026-10-13：独立底层 issue 改为 #332；PR 关闭 #332 并引用 #134，避免 stack bottom 提前关闭总 issue。
- 2026-10-13：评审发现 `project_item` redacted 条目可借旧 membership 穿过 anchor，再由 scope replace 删除当前 project membership；改为整批 preflight 校验，避免在错误 scope 输入上产生任何提交。
- 2026-10-14：2026-10-13 勾选 Batch 4 时没有执行计划内的变异。第二轮评审在 head `55a99494` 上实测 M2、M5、M8 存活；行为本身正确（评审者在 Fake 与 SQLite 上复现过 superseded 保留、后续页失败保留、事务回滚），缺的是判别测试。
- 2026-10-14：M7（SQLite `replacePlanningMemberships` 循环内的同内容去重）补用例后仍存活。core 路径上 `anchorOf` 先对每个内容条目调用 `putMembership`，后者已按 `(workspace, project, content)` 后者胜去重；`replacePlanningMemberships` 的循环去重只在同一轮 incoming 含「同内容、不同 item id」的两条时可达，此时变异版 SQLite 撞唯一索引 `project_item_membership_project_content` 整轮失败，Fake 则后者胜。非快照分页里，条目在分页期间被移出再以新 item id 加回就能产生这种输入（复评订正，原写「合规 provider 不会产生」不准确）；后果是变异版 SQLite 整轮 fail closed、下一轮收敛，不会删错数据。

## Decision Log

- 2026-10-13：#134 拆为 A/B 两个 PR；A 只做 storage membership convergence，B 只做 refresh/scheduler。理由是共享契约、两适配器、core、controller、timer 一起改会超过 800 行且无法独立回滚。
- 2026-10-13：A 使用 scope replace 而不是 tx 外比较后逐条删除；同一事务内由完整 incoming 集合决定删除，避免竞态。
- 2026-10-13：A 使用 Refs #134；B 在完整能力交付后使用 Closes #134，防止 stack bottom 过早关闭 issue。Superseded by `Global Constraints` 第一条（2026-10-14）。
- 2026-10-13：A 的底层 storage closure 使用 Closes #332 + Refs #134；#134 仍由 top PR 在完整能力交付后关闭。（后半句 Superseded by `Global Constraints` 第一条（2026-10-14）。）
- 2026-10-14：关闭关系按现行拆分改写为 `Global Constraints` 第一条。Rationale：#334、#335 已于 2026-10-13 创建，原「B 用 Closes #134」与本 PR 正文、栈顶计划三方矛盾，只合并本层时会在 main 上给出错误的关闭路线。作者：本计划的修复会话（owner 指定见 `Progress` 2026-10-14）。
- 2026-10-14：本计划随 #330 收尾归档，不等待栈顶 PR。Rationale：#332 的全部验收由本层交付；栈顶 PR 不回写本计划，把归档挂在它的合并上会让本计划无人收尾。
- 2026-10-14：删除 scope 用 `ValidatedPlanningRead` 在类型上与条目校验绑定，而不是给 `commitSync` 多传一个 `project` 参数。Rationale：scope 决定删哪些成员，必须与校验依据同源；绑成一个值后删除 scope 与校验依据取自同一处。`commitSync` 仍能读到 `context`，这一约束不由类型强制，靠 scope 用例与评审维持（复评订正，原写「拿不到另一个 project」与代码不符）。
- 2026-10-14：M7 不在本层修，记为跟进候选。Rationale：只在同一轮 incoming 含同内容的两条时可达（例如非快照分页期间移出再加回），变异版的后果是整轮 fail closed，不会删错数据；补齐需要先定义重复内容输入的端口语义，超出 #332 验收。

## Idempotence and Recovery

scope replace 在同一 tx 内可重复；相同集合不推进 revision。rebase/stack 冲突使用 git rebase --abort 和 backup ref。无 migration；回滚不删除 entity/external identity。

## Interfaces and Dependencies

Storage capability contract、Fake/SQLite adapters、bootstrap commitSync、#305 round fence、#220/#199 semantics。本层不依赖任何 refresh / scheduler 回调；依赖方向相反：#334（Core refresh / scheduling）以本层的 membership 收敛为前置。不得依赖 #228/#214 文件。

## Outcomes & Retrospective

- 交付结果：Fake/SQLite 共享 `replacePlanningMemberships` 契约（含空 incoming）与 bootstrap 全量读收敛；provider 删除后 membership 与 field values 消失，remove/re-add 保持 entity / external identity；后续页失败、分页成环、superseded 轮次、事务内写入被拒都不删 membership、不推进 revision；scope 校验三个分量在 redacted 与 visible 两个通道上都 fail closed。证据见 `Progress` 2026-10-14 条目与变异表。
- 与计划的偏差：2026-10-13 勾选 Batch 4 时没有跑变异；2026-10-14 补判别用例后在最终代码树上整表运行一次（13 KILLED / 1 SURVIVED）。
- 遗留：M7 存活（见 `Surprises & Discoveries` 与 `Decision Log` 2026-10-14），记为跟进候选。
- 归档：#332 的全部验收由本层交付；2026-10-14 修复的独立复评通过后，本计划移到 `docs/exec-plan/completed/` 并更新 `docs/README.md` 索引行，不等待栈顶 PR #331 合并。原「在 B 合并前保持 Active」Superseded by 本条（2026-10-14）。
- 评审：第二轮 MMP 评审与修复复评的锁定事实、矩阵与变异表见 `docs/review/pr-330-mmp-review.md`。

## Bottom Change Note

- Change Note (2026-10-13)：完成 #332 bottom storage closure，补充 scope replace、bootstrap 收敛、Fake/SQLite 对抗测试，并将 issue linkage 更新为 Closes #332 + Refs #134。
- 2026-10-13：创建 #134A ExecPlan，记录 membership scope replace 为 #134 的必要前置能力。
- Change Note (2026-10-14)：按第二轮评审 P2 统一关闭关系。`Global Constraints` 第一条成为唯一权威表述；Purpose、Plan of Work、Artifacts、Interfaces、Outcomes 中的「#134B 使用 Closes #134」「#134 由后续 top PR 关闭」「#134B refresh callback」「在 B 合并前保持 Active」改为引用该条或现行事实；Progress 与 Decision Log 的历史条目就地标注 Superseded。
- Change Note (2026-10-14)：按第二轮评审 P3 对齐执行记录：Batch 2 涉及文件订正为 `packages/storage/sqlite/src/storage-sync.ts`；删去空 `Plan of Work` 之后多出的 `Concrete Steps` 标题，批次归入 `Plan of Work`；Batch 4 与验收第 3 行补 superseded、后续页失败与不推进 revision，补变异命令；Progress 回填意见处置、最终代码树变异表与门禁，Surprises、Decision Log、Outcomes 记录 M7 与偏差。
