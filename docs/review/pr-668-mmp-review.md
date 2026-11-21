# PR #668 MMP 交付评审

> 状态：首审 REQUEST_CHANGES；人类已指定协调者接管，来源事实/在途提交守卫均通过独立复评，实施计划已归档，最终 head 门禁待回读。所有观察时间均为 SGT。

## Purpose / Big Picture

判断 #202 是否实现可独立验收的来源隔离：切换规划来源后，列表、快照和详情只服务当前启用挂载的投影内容，且 Fake / SQLite 一致。首审证明实体 identity 归属不足以证明投影 payload 来源；后续改为显式持久来源，由同一矩阵复核修复闭环。

## Context and Orientation

2026-11-21 10:02 初审锁定 PR #668：base `main@33fcde299ae16666ca936b61e7687041a1c0f35e`，head `c63e4575cae90d49b714cd8f02fdf700a4b2793b`；分支 `fix/planning-source-projection-filter`，工作树 `.worktrees/planning-source-projection-filter`。五个 commits 为 `bf655e7`、`f0077ca`、`8c863b5`、`113e9ee`、`c63e457`，关联 `Closes #202`。当时 Ready / MERGEABLE，reviews 与 threads 为空（hasNextPage=false）；19 条 checks 中 18 SUCCESS，仅可选 Create review session FAILURE，PR Fast Gate SUCCESS。10:10 本地/远端回读仍为同一 head/base；文档收尾未产生新 head。

2026-11-21 10:12:02，协调者通过评审账号 `Singularity-AI-Bot` 提交 [review 6002114371](https://github.com/SingularityKChen/harness-projects/pull/668#pullrequestreview-6002114371)，状态 CHANGES_REQUESTED，commit_id 为锁定 head；P1 inline 锚定 `packages/core/src/queries.ts:121`。本次文档收尾已只读回查该 review。协调者当时已请求人类指定 owner，尚未获答。Superseded by 实施计划 D9（2026-11-21）：人类已指定本会话接管。

## Design / Spec

矩阵于代码阅读前先落盘，初始全部待审，现完整回填。事实、假设和约束分别为：#202 要求当前来源隔离；“任一当前 binding identity 足以证明 payload 来源”是已被 F1 反证的设计假设；单一 Planning 权威、Host 拥有状态与同源 D23 最后值是必须保留的约束。

| 严重度 | 层 | 风险 | 首审与修复复核结果 |
|---|---|---|---|
| P0 | 架构 / 代码 | 第二权威源、跨 workspace 泄露、依赖倒置、写入/schema 破坏 | 首审无 P0；当前持久来源与 schema 世代变更经过原子/准入验证，未引入第二权威或反向依赖 |
| P1 | 代码 / 产品 | 共享实体的历史 identity 掩盖停用来源 payload；失败切换回流 | 首审 F1；当前 required payload 来源过滤，双存储共享失败/重开/恢复反例通过 |
| P1 | 产品 / 架构 | 挂载类型遗漏或只看 primary，隐藏合法当前来源条目 | registry 按 planning 域解析；成功 B 同步时 A primary / B alias 的当前行正确保留；primary-only 不是修复 |
| P1 | 代码 / 测试 | list/snapshot/detail 不一致或适配器差异 | 首审共同命中 F1；修复后三 API 一致隐藏外来源，并保持纯读与本来源恢复 |
| P2 | 产品 / 工作项 | D23、#368 边界与 issue 验收遗漏 | 同源离线/无挂载控制保留；#202 两项工程验收有当前反例证据；旧库拒绝/恢复已明确，#368/#273 保持独立 |
| P2 | 测试 | 独立实体样例没有区分 identity 与 payload 来源 | 首审缺口并入 F1；当前 16 项来源场景和 7 项有归因变异覆盖失败/恢复/权限/修订 |
| P3 | 设计 / 工作项 | 过度设计、规模、可回滚性与计划收尾 | 单个持久来源事实，无双缓存/兼容层/切换命令；最终归档/规模/回滚按新 head 检查 |

## Global Constraints

初始评审只整理本记录与 Active ExecPlan，未在 owner 指定前修产品。Superseded by 实施计划 D9/D10（2026-11-21）：人类已指定协调者接管；产品/测试/Storage/schema 的精确文件集以实施计划 Global Constraints 为准，保留规划状态与人验/R1 边界。窄测与 CI 成功不替代来源正确性验收。

## Plan of Work

已完成：锁定事实与矩阵 → 追踪 identity / 写入 / 查询 → 双存储运行时反例及 D23 控制 → 全矩阵归纳。所有命令在上述锁定分支工作树根执行：

- V1：`gh-review pr view 668 -R SingularityKChen/harness-projects --json baseRefName,baseRefOid,headRefOid,mergeable,mergeStateStatus,isDraft,commits,closingIssuesReferences,statusCheckRollup,reviews`；GraphQL 读取 reviewThreads(first:100)，检查 hasNextPage。期望：锁定版本不变、线程无遗漏、必需检查成功。review 回读：`gh-review api repos/SingularityKChen/harness-projects/pulls/668/reviews/6002114371`。
- V2：`node --test --test-timeout=120000 tests/integration/planning-source-switch.test.js`。期望：两适配器现有场景通过。
- V3：`node --input-type=module` 从 stdin 调用现有公开 API，输入步骤见 F1；期望当前来源隔离，实际反例证明失败。没有创建临时程序或测试文件。
- V4：`node --test --test-timeout=120000 tests/integration/pull-request-identity-convergence.test.js tests/integration/runtime-planning-access.test.js tests/integration/planning-snapshot.test.js tests/integration/planning-membership-reconcile.test.js tests/integration/planning-round-order.test.js`。期望：相邻回归通过。
- V5：`git diff --check 33fcde299ae16666ca936b61e7687041a1c0f35e...c63e4575cae90d49b714cd8f02fdf700a4b2793b`，以及 `git status --short --branch`、`git rev-parse HEAD`。期望：无 whitespace、无产品变更、HEAD 不漂移。

首审未执行变异、未创建 spec，不把作者历史变异当独立证据。Superseded by 本记录“来源事实修复与内部复评”：修复候选已用恢复保证脚本执行最终七项变异，见对应表；产品与数据库回滚边界由实施计划 D10 / Batch 3 规定。

## Validation and Acceptance

V2：exit 0，tests 2 / pass 2 / fail 0。V4：exit 0，tests 322 / pass 322 / fail 0 / skipped 0。V3 在 Fake / SQLite 上复现 F1，成功共享、独立旧实体过滤、同源离线与无挂载 D23 控制均成立。V5 无 whitespace，锁定 head 未变。本轮未运行完整 verify、浏览器或真实 Provider；远端 CI 是已有证据。

首审 #202 第一项“只返回启用来源投影”未成立，双存储一致出错不能代替正确性。Superseded by 来源事实修复与内部复评（2026-11-21）：当前共享失败/恢复、内容/规划字段、D23 与双存储原子契约通过；最终门仍要求当前提交独立复评和远端 Fast Gate。

## Progress

- [x] 2026-11-21 10:02：代码阅读前完成基线与风险矩阵落盘。
- [x] 2026-11-21 10:10：完成全矩阵、324 个窄测试及双存储反例。
- [x] 2026-11-21 10:12：协调者已提交 REQUEST_CHANGES；随后取得第二位独立评审的交叉复现。
- [x] 人类指定协调者接管 F1，来源事实修复及内部独立复评已完成；原等待 owner 状态由实施计划 D9 取代。
- [x] 工程修复、内部独立复评、全量/定向实际验证与实施计划归档完成，验证限制如实记录。
- [ ] 最终交付提交的 head 复评与托管门禁、回复/resolve、#202 验收及条件合并收尾（按下述动态回读规则执行）。

## Surprises & Discoveries

### F1 · P1：历史实体身份不能证明当前投影来源

**新增行**：`packages/core/src/queries.ts:121` 的 `identities.some`；调用点为 `:99`、`:133`。A / B 观察同一 native PR 后共享实体；B 重写同一 `(workspaceId,entityId)` 的投影。切回 A 且首轮读取失败时，A 的旧 identity 仍在，使 helper 放行 B 已停用来源的内容。三 API 均受影响，stale/degraded 标记不能修正 title/body/status 的来源。

**根因**：`packages/core/src/identity.ts:55-60,81-93` 保留 A primary / B alias；`packages/core/src/bootstrap.ts:234-243,346,354-358` 重写共享行，失败不覆盖它；`packages/domain/src/entities.ts:91-99` 没有 payload 来源字段。Fake `packages/providers/fake/src/storage.ts:441-450` 与 SQLite `packages/storage/sqlite/src/storage.ts:181-192` 的 replace scope 选择“该 binding 身份所指实体”，并未记录最后写入来源。复用这个选择范围无法补出 provenance。

**可复核输入**：导入 `./tests/fixtures/resolution-preflight.mjs`，使用包导出的 composeCore、newWorkspaceId、createFakeProviders、createFakePlanningProvider、createFakeStorage、fixtureProjectRef、FaultKind、createSqliteStorage。两轮分别用 Fake 与 SQLite `:memory:`，finally 关闭 storage。

1. 新建同一 workspace，clock 固定 `2026-11-21T00:00:00Z`（测试 API 输入）。A 为 fake providers 的 planning，B 为另建 fake planning。
2. 包装两者 listPlanningItems：只对 change_request 返回值不可变复制，添加相同 `nativeIdentity={namespace:'github.com/graphql/PullRequest',id:'review-668-shared-pr'}`；title 分别设为 A payload / B payload，ref/project/membership 不变。
3. 每次 compose 使用同一 storage/workspace/其他 providers，注入所选 planning；workspace.project=`fixtureProjectRef(planning.bindingId)`。先 compose A，记录 PR entityId，确认 A payload。
4. 将 A setFault(Offline,true) 后重新 compose A，详情保留 A payload（同源 D23 控制）；恢复在线。以 putProviderBinding 停用 A 的 planning 行（enabled=false,isDefault=false），compose B；确认共享 entityId 返回 B payload、A 独有 issue-1 被过滤，身份为 A primary / B alias。
5. 停用 B，使 A Offline，compose A。断言 storage 唯一 enabled planning mount 与 metadata 的 planning.item.read capability binding 都为 A；三 API 读取共享 entityId。
6. 额外停用 A、compose 时省略 planning，确认既有无挂载最后值保留。此控制不代表无挂载来源策略已作新的产品裁决。

本评审实际输出（两适配器反例进程 exit 0，断言以捕捉缺陷为目标）：

| 适配器 | 唯一启用来源 | 身份 | list / snapshot / detail title | sync | D23 控制 |
|---|---|---|---|---|---|
| Fake | A | A primary / B alias | B payload / B payload / B payload | degraded=true, stale=true, unavailable | 同源离线保留 A；无挂载保留最后值 |
| SQLite | A | A primary / B alias | B payload / B payload / B payload | degraded=true, stale=true, unavailable | 同源离线保留 A；无挂载保留最后值 |

**独立交叉复现**：协调者转交第二位独立评审的结果：使用不同项目 A/B 与同一 native PR，切回 A 且 A 读取失败，三 API 仍返回 B 的 title、body、status=`done`，同时挂 A primary。它补足了本次 title 标记以外的规划数据证据，与 F1 根因一致；不冒充本评审亲自执行的第二组实验。

**承接与修复边界**：F1 是 #202 已有故障未被本 PR 完整修复，阻塞其关闭，并非宣称本 PR 新引入回归。#368 继续守护 Planning unbind；#273 处理 Host-authoritative/manual-only 状态策略，均不承接本反例。原先来源/代际事实或受控切换的原子失效是待 owner 设计选择；Superseded by 实施 ExecPlan D9/D10（2026-11-21）：采用必填持久 `sourceBindingId`；仅靠 any identity 或 primary 不足。成功 B 同步控制中 primary 仍属 A，primary-only 会丢掉合法当前行。“禁止 schema/port”不能豁免正确性；需要变更契约时应先更新计划与验证边界。

## Decision Log

- 2026-11-21 SGT / 独立评审：以 First Principles Development 与 Qian Systems Router 的来源事实闭环审计完成全矩阵，同根因测试缺口并入 F1，不重复开 P2。
- 2026-11-21 SGT / 协调者：REQUEST_CHANGES 已提交；等待人类指定 owner。Superseded by 实施 ExecPlan D9/D10（2026-11-21）：用户原话“由你接管并修复”，协调者据此修复，并沿用无 P0/P1 后复评、归档、核对 issue、rebase merge 的条件授权；Planning Status/R1 独立。

## Idempotence and Recovery

首审复核只读命令可重复；首审业务反例用内存数据库并已关闭，无临时程序/spec/运行态文件残留。当前候选的变异 spec/log 按后段规则在任务结束时清理。文档收尾可按 diff 回退；任何后续 head/base 改变都使本轮代码结论需要重新锁定。

## Interfaces and Dependencies

现有 Core / Storage API、Node 原生 TS 支持与 gh-review 只读查询；远端仓库显式为 SingularityKChen/harness-projects。初始评审未更改公共接口、数据或依赖。后续修复保留 get/list/put/replace 方法签名，WorkspaceProjection 新增必填来源，双存储/单资产 schema 同步更新；Host wire 不新增来源字段，schema 世代 7 的开库拒绝与配对恢复见实施计划。

## Outcomes & Retrospective

首审最终为 1 个 P1、无其他独立 actionable P0/P2/P3。最小 helper 规模合理，但 identity 与 payload 来源混用使交付目标仍失败；324 个绿测证明已有场景，不能替代 #202 验收。可选 Create review session 失败由协调者查明为本地 endpoint HTTP 404，不作为产品失败。后续 owner 已由人类指定，修复结果和最终版本回读规则见下一段；本段首审事实保留，不沿用旧 head 的批准。

### 来源事实修复与内部复评（2026-11-21 16:59 SGT）

当前候选在 `fix/planning-source-projection-filter`、基于 `main@471a991bebf77356d5d7e6f12d284fe98bbff019` 的隔离工作树实施：`WorkspaceProjection.sourceBindingId` 必填，与 payload 原子保存；双适配器按实际来源收敛、拒绝混批；查询按来源而非身份过滤，权限失败只脱敏本来源。SQLite schema 世代 7、单基线版本 1，旧库拒绝且原样保留；来源字段不进入 Host wire，不新增 UI 切换命令或双缓存。其它按 entityId 的命令与历史工程谱系保持既定范围，不据三查询修复声称全面来源准入。

最小测试先红后绿：共享 PR A→B→离线 A，Fake/SQLite 在关库重开前后三 API 原本返回 B title/body/done，当前隐藏；A 恢复后同实体重新服务 A title/body/status/日期字段，primary/alias 不变。同源离线保留已确认值；source-only 变更修订推进一次，同源重复不推进。初次修复该文件为 12/12；新增在途来源案例后的最终 16 项见后段。Storage 定向组合包含基础事务正控制，红为 2 pass/3 fail（误删 B、SQL 丢来源、Fake 导入缺来源未拒），当前 5/5；重启与捕获异常后原子性均包含其中。

初次内部独立 reviewer 完整复核 P0–P3（跨来源在途假设由后段反证取代）：来源事实没有引入第二规划权威、依赖倒置或 wire 扩张；共享覆盖、来源过滤、权限不改外来源、事务保存点、轮次/fence 与身份收敛成立，未发现产品 P0–P3。唯一文档 P2 为旧 Recovery/Interfaces 的无 schema 描述，已原处 Superseded，当前明确匹配旧包与原库备份；修正后另行复核，沿 #202 处理，无新 issue。

变异执行 `node scripts/review-mutate.mjs .superpowers/pr668-source-fix-20261121/mutations.json`，基线与还原后都通过；最终整表七项 KILLED、exit 0，无源码残留。spec 的全局命令只运行来源场景与 Storage 定向用例，包含 foundation 事务正控制：

| 变异 | 单点替换 | `killedBy` |
|---|---|---|
| M1 查询放行外来源 | `queries.ts` 来源相等判据改为 `return true` | `shared native PR rejects disabled payload` |
| M2 SQL 覆盖丢来源 | `storage.ts` UPSERT 移除 `source_binding_id = excluded.source_binding_id` | `投影来源独立于实体身份` |
| M3 Fake 按旧身份删除 | source 相等改为身份属于 scope | `投影来源独立于实体身份` |
| M4 权限全域脱敏 | `bootstrap.ts` 移除 before 的来源过滤 | `permission-denied source cannot` |
| M5 修订忽略来源 | `sameProjections` 比较中排除 sourceBindingId | `source change with equal native PR payload` |
| M6 Fake 导入漏校验 | constructor 移除投影来源验证 | `Fake import rejects projections without` |
| M7 撤销来源仍能结算 | `bootstrap.ts` 当前来源判据改为 `return true` | `disabled source's in-flight refresh` |

类型、10/10 包边界和 schema 19/19 通过。受影响 840 项首次只有新 SQL FK 缺出处编号失败，补“不变量1/#202/ADR-0006”注释后该文件通过，未弱化约束。完整 verify 首轮 contract 1619 pass/0 fail/1 cancelled，Development 子集矩阵120秒超时；独立该文件96/96通过，后续本机全层与窄重跑结果见下段，不声称全绿。

跨来源并发补证（2026-11-21 17:22 SGT）：独立公开 API probe 在 Fake/SQLite 发现，A 列表返回被挂起期间切到 B 并确认成功，再释放 A，旧 A 仍 `ok:true`，把 source=B/rev2/reconcile03 改回 source=A/rev3/reconcile04，B 三查询空但 sync fresh。#305 已完成 scope 明确为同 workspace/binding，#368 不承接切换。四个 barrier 回归（success/permission-denied × 双存储）先 4/4 RED；修复在成功提交和失败结算事务内共用持久唯一启用来源检查，撤销来源所有后续事实写入。当前来源及相邻同源轮序、权限、修订四文件 308/308 通过，保留既有错误代码/message；独立复评此新增守卫，最终整表包含绕过该判据的 M7，7/7全部KILLED且指定断言归因成立；源码恢复后基线通过。新增守卫独立复评无P0–P3，零写仅指来源撤销后的结算，切换前合法started/syncing marker保留。

完整本机记录：标准 verify 两次在同一 Development 子集矩阵120秒超时（各 contract1619 pass/0 fail/1cancelled），该文件单独96/96通过；相同用例与120秒阈值、concurrency2完整contract1620/1620通过。bounded集成层曾2337 tests/2303 pass/6 fail/28skip，失败集中开库前 Host 数据准备及一个执行空上下文；对应三文件单独72/72通过，未改 ACL/超时/断言。未把这些局部重跑冒充一次本机完整全绿；最终提交的托管标准 Verify/Browser/Windows Native/Fast Gate 必须通过。

最终发布规则：计划已归档；整理提交后回读 `gh pr view 668 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,commits,closingIssuesReferences,reviews,statusCheckRollup` 和完整 reviewThreads；源码/测试必须与已验证候选树相同。独立最终复评与当前 head 的 PR Fast Gate 通过后，作者回复/resolve F1、评审账号批准、开发账号 rebase merge。#202 两项工程验收只在该证据下核销，不推进规划状态、不代替人验或 R1。临时 spec/log 随任务结束清理；本表保留判别意图与实际结果。

## Bottom Change Note

- 2026-11-21 10:02 SGT：代码阅读前落盘 immutable 基线、矩阵与验证范围。
- 2026-11-21 10:10 SGT：回填全矩阵、F1 反例和324个窄测试，结论 REQUEST_CHANGES。
- 2026-11-21 10:23 SGT：凝练交接记录、统一 SGT，登记已提交 review、第二位独立交叉复现与等待 owner 状态；未产生新 head。

- 2026-11-21 16:59 SGT：记录人类接管、来源事实根因修复、独立复评、内部文档 P2 修正、6/6 变异及完整回归的真实进度。

- 2026-11-21 17:22 SGT：加入在途来源权威的独立反证、四项红绿及事务守卫，保留本机全层失败/重跑的实际边界，不用初次内部结论覆盖新证据。

- 2026-11-21 17:25 SGT：记录最终7/7变异、E2E226/226、D11后308/308与独立复评，归档实施计划；标准托管门禁和最终批准仍必须绑定整理后的head。
