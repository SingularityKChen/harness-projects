# 交付谱系按仓库与操作路由 ExecPlan

> 状态：Completed，实施与本地验收完成，等待独立实现审读及最终远端门禁。
> 创建：2026-10-22；关联：#297（#216 的独立闭环，解除 #233 的此项读路由阻塞）。
> 依据：根 `PLANS.md`、`AGENTS.md`、`docs/adr/ADR-0015-repository-references-side-by-side.md`。

## Purpose / Big Picture

一个仓库同时连接 Local Git 与 GitHub Development 时，刷新交付事实能经 GitHub 观察远端提交与 PR；本地工作树身份继续沿执行上下文传播。最小成功证据是两种 Storage 上的公开刷新命令均只调用持久引用选中的连接，提交与 PR 两跳进入投影；恢复旧接缝后同一用例变红。

本 PR 独立验收、合并和回滚；不依赖其他并行工作分支。它完成离线可验证的 core 读接线，真实 GitHub 权限、Harness 安装与完整 demo 验收仍由 #233 承担。

## Context and Orientation

“挂载”是工作区的 ProviderBinding；“现行引用”是同一仓库实体在该挂载下的 primary / alias 外部身份，historical 不参与外部读取。`RepositoryRecord.externalIdentityId` 指向锚点身份，路由沿实体查现行引用，名称相同的其他实体不能充当候选。

`packages/core/src/development-route.ts` 的 `routeDevelopment` 已实现此选择；`CHANGE_REQUEST_READ_ROUTE` 以 `DevelopmentChangeRequestRead` 的声明选连接，在该连接先过 `DevelopmentRepositoryRead` 读门，再过 CR 读门。多声明者 conflict，无声明者 not_supported；角色、顺序与可用性均不参与选择。

实施前 `packages/core/src/chain-facts.ts` 的 `developmentReadBinding` 以工作区 capability key 解析，多个 Development 连接时安全拒绝。`readChainFacts` 先读分支头，再由 `readChangeRequest` 第二次解析连接，因此只替换 PR 调用不足以完成接线。两个真实实现均声明 repository.read，按它选择并列引用恒歧义。该旧接缝的状态已由 Outcomes & Retrospective 的实施结果取代（2026-10-22）。

`packages/core/src/delivery-facts.ts` 的 `completeSets` 以 gap 能力键判定集合完整性：RepositoryRead gap 使 commit、change_request、pipeline_run、check_run 四集合均不完整，保留最后确认事实及 confirmedAt 并标 stale。CR provider 失败则只影响 PR 与检查。查询只消费持久快照，刷新是交付事实唯一写者。

事实来源是当前仓库代码、#297 正文与 2026-10-16 / 2026-10-21 的 issue 评论，以及 ADR-0015。2026-10-22 09:07 SGT 在 `feature/delivery-repository-routing`、基线 `d7e7bca6aae31a4329f3238d3b90274dd683516c` 实跑下列 Batch 3 五文件回归：130 tests、130 pass、0 fail；这只证明基线。

## Design / Spec

选择“一次刷新、一次完整 CR 操作路由”。`developmentReadBinding(context, repositoryId)` 去掉 key 参数，读取现有操作常量的 anchor 与 earlier，调用 `routeDevelopment`，保持成功值的 `{ binding, repository }` 形状。`readChainFacts` 只解析一次；`readHeadCommit` 与接收 route 的 `readChangeRequest` 使用同一结果，后者删除内部重解析。两次 provider 调用只能使用 route 返回的完整 repository ref。

| 方案 | 裁决与理由 |
|---|---|
| 仅把原接缝换成按入参 key 的仓库路由 | 拒绝：分支仍按 repository.read 选择，并列引用必 conflict。 |
| 两跳分别解析完整 CR 操作 | 可选到正确连接，但多读一次身份且可能在两次间改变选择；没有必要。 |
| 一次解析完整操作，两跳消费结果 | 采用：同次观察有唯一 Development 所有者，无新增接口或权威源。 |
| 按 CR 声明选连接，但延后 CR gate、先读分支 | 拒绝：只为旧降级粒度拆散既有操作契约，增加新的半授权路径。 |

关键行为如下：

1. 有 repositoryId 才路由；没有持久工作树句柄不读分支，未观察 head 不读 PR / CI，未观察 PR 不读 checks。原分页完整性与 sourceVersion 精确匹配保留。
2. 任何路由拒绝均记 RepositoryRead gap，零 Development 与 CI 读取。首次刷新只留骨架；已有四集合则保留节点、确认时刻与谱系并标 stale。公开刷新结果仍只输出 gap key，不转发 route/provider 原始错误文字。
3. 完整操作门已过、分支成功而 PR provider 返回结构化失败或查找未尽时，仍记 CR gap；commit 与流水线可更新，PR 与 checks 保留并 stale。成功完整空集合仍按既有规则清空下游。
4. **有意语义收敛**：CR gate 不可用或未声明时，远端 head 同样不读，四集合 stale。旧单挂载 completeness 行只 stale PR / checks 的期待被本节取代；单挂载正常路径与其他降级规则保留。不增加兼容开关、双读或迁移。
5. 不回退 primary、registry 首项、Local Git 或另一条可用连接；即使两个声明者之一 unavailable，仍是 conflict。ReadOnly / Degraded 读门沿用既有 gate 规则。
6. worktree ID 仍由执行上下文的 workspace/repository/work-item 三元组派生；commit / PR 沿选中远端引用派生。刷新不改变仓库引用、规划投影或规划修订号。

## Global Constraints

唯一变更文件集合及预算如下；additions + deletions 的代码与测试合计不得超过 800 行，文档不得超过 1300 行。目标约 450–650 代码测试行、约 200 文档行；不机械拆分连续算法。

| 文件 | 职责 |
|---|---|
| `packages/core/src/chain-facts.ts` | 唯一接缝、共享 route、同步注释。 |
| `packages/core/src/queries.ts` | 删除“#297 尚未接线”的过期元数据注释。 |
| `tests/integration/delivery-repository-routing.test.js`（新增） | 双 Storage 的公开刷新正反例与身份持久性。 |
| `tests/integration/github-development-lineage.test.js` | 经公共绑定命令补合法 GitHub alias。 |
| `tests/e2e/delivery-lineage.test.js` | 仅更新 CR gate 不可用的 completeness 预期与说明。 |
| 本 ExecPlan 与 `docs/README.md` | 设计、批次证据与索引，验收后原文件移 completed。 |

不改 schema、Storage 端口、路由算法、Provider 实现、controller、UI 或 CI 来源路由，不添加依赖。保留 `readRoute` 与 `refFor` 服务 Delivery 域；不新增通用路由抽象。公开材料不引用运行态报告或本机路径。

一个 owner 修改此 core 单元；共享索引与旧 completeness 文件的合入由总 owner 核对三方差异，不能宣称文件完全无重叠。不写 Project Status、blocked-by / blocking，也不自行合并 PR。

## Plan of Work

### Batch 1 · 两条判别性正例与接线

**最小闭环**：公开刷新在两个挂载与并列引用下观察正确的远端 commit / PR。
**主文件**：新专用集成测试、core 读接缝。

先为 Fake Storage 与真实 SQLite 文件定义同一组场景；SQLite 关闭重开，Fake export 后重建，均重新 compose，避免仅内存 registry 让测试通过。测试 helper 留本文件，不重构共享 suite。

新增 `AC297 registered-repository-multi-development-read`：单挂载 A Start Work 登记仓库并产生真实上下文，再组合 `[B, A]`；A/B 都具备可成功的同名仓库、分支与 PR 诱饵，但仓库只在 A 有现行引用。清空 setup 调用，公开 refresh 后断言只有 A 的 listBranches / listChangeRequests 各一次，repository 参数逐字段等于 A 的返回引用，投影两个 observed 跳属于 A，B 零读。

新增 `AC297 side-by-side-local-github-operation`：仿照现有 repository-routing 测试，以 `createWorkspaceSetup.bindRepository` 建一个实体的 Local/GitHub 型引用，交换 primary 和 registry 顺序；声明集合应与真实两实现一致。Start Work 由 Local Git 型完成；本地 head 与远端 head 故意不同，PR 只匹配远端 head。对照调用 routeDevelopment，repository.read 必 conflict，完整 CR 操作必选 GitHub；公开刷新只读远端并产生两个 observed 跳，worktree ID 不变。

在未接线基线上运行 `node --test tests/integration/delivery-repository-routing.test.js`，期望两类正例因 gap / 缺少 observed 跳失败，记录具体断言；不得以 import 或夹具错误冒充 red。随后执行 Design 的最小改动，同命令应全 pass、exit 0。

**回滚**：撤销本批主文件差异即可，无迁移或外部写入；red / green 输出留运行态，计划只记命令、执行分支与结果。

### Batch 2 · 拒绝、恢复与真实适配器接缝

**最小闭环**：未授权观察不伪造或删除事实，正常绑定的 GitHub adapter 仍正确挂 PR。
**主文件**：专用集成测试、GitHub 集成夹具、旧 completeness 行。

新增 `AC297 missing-current-reference`：先在线形成四集合快照，再仅组合两个新 Development id；二者提供有效诱饵，但均无锚点实体的现行引用。刷新有 repository gap、Development/CI 零读，四集合内容与 confirmedAt 原样且 stale；首次未摄入时不造 commit/PR 关系。同名其他实体与 historical 身份各作小表反例；恢复原 id 后重试收敛。

新增 `AC297 selected-operation-gate-denial`：已有 Local/GitHub 并列引用与在线快照后，分别把选中 GitHub 的 repository gate / CR gate 置 Unavailable（并覆盖 CR key 未声明）；另一连接诱饵可用。断言零读、四集合 stale、确认时刻不变。两个 CR 声明者且其中一个 unavailable 仍拒绝，不按健康度重选。旧 completeness 表的 CR policy 行改为四集合 stale，明确命名“完整操作门拒绝”。

新增 `AC297 routed-read-failure-is-partial`：门均可用、远端分支成功，PR 方法结构化失败；断言 commit / pipeline 可更新，只有 PR / checks stale。这与上条区分 gate 拒绝和 provider 读取失败。重复刷新、重开 Storage 后，关系三元组不增殖、工作树 ID 不变；仓库/身份/规划数据与修订号不变，查询计数不触发 provider。

修正 GitHub 夹具：使用 `createFakeStorage(undefined, policy)` 构造接收 `development.github` 空配置 schema 的测试 Storage；第一轮 compose 与 Start Work 都用该 Storage。随后 `createWorkspaceSetup(storage).bindRepository({ workspaceId, repositoryId, references: [{ domain: 'development', implementationKey: 'development.github', configuration: {} }] })` 追加 GitHub alias，以返回的 bindingIds[0] 创建真实 adapter 并重新 compose。不要重写仓库锚点、删除 Fake 身份或手造第二实体；继续保留标题、fork、大小写、60 个分页诱饵及 node-id 不作主键的断言。

执行 `node --test tests/integration/delivery-repository-routing.test.js tests/integration/github-development-lineage.test.js tests/e2e/delivery-lineage.test.js tests/e2e/repository-routing.test.js`，期望 exit 0。旧 route 算法的完整矩阵由现有回归覆盖，避免复制整套测试。

**回滚**：撤销本批差异；若核心行为也回滚，同步恢复旧 completeness 期待，不能留下反向契约。

### Batch 3 · 变异验收与交付

**最小闭环**：证明关键错误实现会被新用例识别，并交付当前 head 的审阅证据。
**主文件**：core 元数据注释与计划验收记录。

在本工作树 `.superpowers/297-route-mutants.json` 写 argv 形式的 spec：command 为 `node --test tests/integration/delivery-repository-routing.test.js`，每个 mutant 指定唯一 anchor、replacement 与 killedBy 名称。M1 恢复 key 级 seam，由 registered-repository 用例杀；M2 改成 repository.read 单键，由 side-by-side 杀；M3 不用返回引用而拼 Local ref，由完整参数断言杀；M4 路由拒绝只记 CR gap，由 missing-current-reference 的四集合保留断言杀。

执行 `node scripts/review-mutate.mjs .superpowers/297-route-mutants.json --root .`，期望四项 KILLED、exit 0，还原后基线绿且源码按字节一致。NOT_APPLIED、KILLED_OTHER、夹具异常或还原失败都不计 mutation 证据。只把命令、失败测试名及结论写入 PR，spec / 日志不提交。

在检出 `feature/delivery-repository-routing` 的工作树根目录逐条运行：

    node --test tests/e2e/delivery-lineage.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/e2e/repository-routing.test.js tests/integration/github-development-lineage.test.js
    pnpm run typecheck
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

全部检查期望 exit 0；人工分类汇总代码测试 ≤800、文档 ≤1300（锁文件/生成目录按仓库规则），并核对发布面五类目。只有新失败或边界风险再扩大验证；不把本地绿等同真实 demo 闭环。

实施开始前依 `docs/development/workflow.md` 建仅含计划的 draft PR 并用 Closes #297 建同仓 issue 关联；本次计划审读不执行外部写入。最终 push 前收敛 debug/fixup，提交格式 `feat(core): <中文摘要>`、正文说明原因；本次实施提交按委派范围使用 `Refs #297`，PR 的 `Closes #297` 关联由最终交付 owner 回读。已推分支需改写时走 expert 流程建 backup ref 与精确 lease。

push 后用 `gh pr view --repo SingularityKChen/harness-projects --json number,headRefOid,baseRefOid,isDraft,mergeStateStatus,closingIssuesReferences,reviewDecision,statusCheckRollup` 定位并回读本分支 PR，再用 `gh pr checks --repo SingularityKChen/harness-projects` 检查本分支最新 head；所有 review threads 通过 `docs/review/README.md` 的命令回读。只有当前 head 验证通过才 `gh pr ready --repo SingularityKChen/harness-projects`；不沿用旧 checks / review。完成后移计划到 completed 并更新索引。

**回滚**：整个能力闭环可独立 revert；不清除用户仓库，不调整规划关系，不执行数据转换。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| A 已登记、B 在前亦只读 A | registered-repository，Fake/SQLite，完整参数、两 observed 跳与 B 零调用。 |
| 并列 Local/GitHub 读取远端 head 与 PR | side-by-side，两 Storage / 两顺序；repository.read conflict 对照；工作树身份稳定。 |
| 缺路由、gate 拒绝不误读/误删 | missing-current-reference 与 selected-operation-gate-denial；四集合 stale、confirmedAt 保留、零读、恢复收敛。 |
| 部分 provider 失败仍保持粒度 | routed-read-failure-is-partial；提交/流水线可更新，PR/检查 stale；完整空集合旧回归保留。 |
| 身份来自持久事实、查询纯读 | 重开 Storage、重复刷新关系稳定；规划/仓库/身份不变；查询 provider 零增量。 |
| 测试能拒绝旧接线和错误操作 | M1–M4 真实施加且 KILLED，恢复后绿；不是只测私有 helper。 |
| 单挂载回归与公开面可审阅 | Batch 3 相关回归和门禁全通过；仅 CR gate 期待按 Decision Log 收敛；PR 当前 head / issue / threads 回读。 |

## Progress

- [x] (2026-10-22 09:07 SGT) 完成两份独立设计与源码综合审读，确认 CR gate 语义张力及夹具身份缺口；五文件基线 130/130。
- [x] (2026-10-22 09:07 SGT) 保存自包含设计/实施计划与文档索引；文件集合见 Global Constraints。
- [x] (2026-10-22 09:22 SGT) Batch 1：未接线起点的 6 个正例全部因 repository gap 断言变红；最小接线后 6/6，扩展后专用双 Storage 26/26。
- [x] (2026-10-22 09:22 SGT) Batch 2：覆盖缺引用、historical、同名其他实体、首次拒绝、三类 gate 拒绝及 unavailable 声明者冲突、恢复、部分失败、重开和查询纯读；四文件回归 84/84。
- [x] (2026-10-22 09:22 SGT) `pnpm verify`：typecheck 通过，完整三层 1787/1787、MVP-0 7/7；本地产品验收完成。
- [x] (2026-10-22 09:22 SGT) Batch 3 本地判别：M1–M4 均 KILLED，按字节还原后基线绿；五文件回归 130/130，boundaries 9/9，workflow-check 无发现。

- [x] (2026-10-22 09:37 SGT) 独立实现验收 PASS；实现 head `59ceff8696f3` 的 PR Fast Gate、四条 Merge Gate lane 与发布检查均通过；完成计划归档与索引同步。

## Surprises & Discoveries

- 旧 completeness 表在 CR key 被摘掉时只 stale PR / checks；完整 CR operation 在分支读取前就会拒绝。这是有意行为调整，不能把改期待掩饰成无回归；见 Decision Log D1。
- GitHub 集成夹具由 Fake Start Work 登记仓库后直接换硬编码 GitHub binding，Storage 没有其现行引用。旧 key seam 掩盖了缺失前提，新路由应拒绝；见 Batch 2 的公共绑定修复。
- 实施前专用双挂载正例缺失（已由新专用集成测试取代，2026-10-22）；现有 #197 的未登记仓库拒绝用例只能证明安全拒绝，不能证明接线。两份设计报告的基线均是调查证据；本计划独立重跑 130/130，不把未执行的 mutation 写成结果。

- 2026-10-22 实施后首次相关回归为 79/82：两种 Storage 的旧 completeness 行与 GitHub 夹具各失败，恰为设计已识别的三处期待/前提；按 D1 / D3 修正后 82/82，追加首次拒绝的两用例后为 84/84。未改生产路由来兼容夹具。

## Decision Log

- Decision：人类本次直接授权 PR #392–#395 在无 P0/P1 或仅 P2/P3 时，由评审会话负责“修复 → re-review → 归档 ExecPlan → … → merge_method=rebase 合并”。本 PR 全矩阵及独立复核无新增 finding，保持计划、实现、验收三个可独立审阅提交边界，补入评审证据并重锁最终 head 后执行授权收尾。Rationale：授权来自本会话，不改变 Planning Status 或 blocked-by。Date/Author：2026-10-22 / 评审协调者。


- Decision：最终 CI/ready 是易失的 PR 属性，归档文档保留回读命令，发布时重新锁定最新 head，不把实现 head 的绿灯转移给归档 head。Rationale：避免文档静态值与远端当前状态形成第二事实源。Date/Author：2026-10-22 09:37 SGT / 交付协调者。

- D1 / Decision：采纳完整 CR 操作门，CR 不可用或未声明时四集合 stale；只对 provider 读取失败保留原部分降级。Rationale：ADR-0015 已将远端 head 与 PR 定为同一操作，预发布可直接简化，无需为旧期待另建半授权协议。Date/Author：2026-10-22 09:07 SGT / 独立设计综合审读 agent；本裁决不授予任何规划字段/关系写权限。
- D2 / Decision：同次刷新只路由一次并传递原返回值。Rationale：排除两跳选择漂移与自行拼引用，保持工作树身份从执行上下文派生；不声称跨 Storage/provider 的快照事务。Date/Author：2026-10-22 09:07 SGT / 独立设计综合审读 agent。
- D3 / Decision：合法 alias 通过 bindRepository 补入测试，不放宽生产路由。Rationale：测试必须满足已登记仓库的身份前提，保留原 adapter 判别力；无解绑/改绑范围。Date/Author：2026-10-22 09:07 SGT / 独立设计综合审读 agent。

- D4 / Decision：实施批保留计划 Active，只提交本地实现与证据，交回独立审读。Rationale：用户授权的执行分工明确要求实施者不得 push / 外部写入，最终远端门禁与归档属于总 owner；不把本地测试通过当成全部交付完成。Date/Author：2026-10-22 09:22 SGT / 实施 agent。

- D5 / Decision：只同步 `queries.ts` 的过期说明，不改元数据算法或投影接口。Rationale：元数据原已按完整 CR 操作报告可用性；本批接通事实读取后，旧注释所称“尚未接线”不再属实。该文件在 Global Constraints 既有集合内。Date/Author：2026-10-22 09:22 SGT / 实施 agent。

## Idempotence and Recovery

复用既有 `.worktrees/delivery-repository-routing`，检出分支必须是 `feature/delivery-repository-routing`。从仓库根确认 realpath 位于允许的 `.worktrees/` 根内且非额外符号链接；进入后执行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`，期望独立 Git dir、共享 common dir、正确分支且目录已忽略。继续执行前用 `git rev-parse HEAD` 与 `git merge-base HEAD origin/main` 回读基线；有无关脏文件则保留并缩小 staging，不能 reset。

从仓库根逐条执行隔离定位；realpath 输出只在本地核对，不贴入公开材料：

    realpath .worktrees/delivery-repository-routing
    git -C .worktrees/delivery-repository-routing branch --show-current
    cd .worktrees/delivery-repository-routing

期望第二条输出 `feature/delivery-repository-routing`；与预期不符先定位既有检出，不创建重复分支或覆盖工作树。

安装依赖可重复 `pnpm install --frozen-lockfile`；测试使用临时 SQLite 文件并显式关闭。相同 scope 重复刷新遵循现有 attemptedAt 排序与快照事务；本任务不增加外部写入。每批失败先保留证据再定点撤销所属改动，禁止用全工作树 restore 抹掉别人的文件。变异由现有脚本按字节还原，中断后先核对源码再继续。

## Interfaces and Dependencies

Node ≥22，pnpm 10.28.2；现有 `@harness-projects/core`、Fake 与 SQLite workspace 包，无真实凭据或网络依赖。路由参数取既有操作常量；对外 API、wire、gap 形状、Storage schema 与 Delivery 挂载规则不变。测试夹具配置 schema 只在测试 Storage policy 内声明，生产配置验证不放宽。

既有技术债务继续见 `docs/exec-plan/tech-debt-tracker.md`：CI 按仓库路由属 TD-074，分页查找属 TD-040，gap 原因码属 TD-046；本 PR 不新增规避方案，也不替它们宣告解决。若实际实施发现影响本闭环的新债务，当批记录 tracker 再决定是否仍满足验收。

## Outcomes & Retrospective

最小实现已将 Development 两跳接到同一次完整 CR 操作路由；成功参数与引用不再重算，Delivery 域的 key 路由保持原职责。专用集成测试为 26 例，两种 Storage 均经过关闭重开 / export 重建；真实 GitHub adapter 夹具经公共绑定命令建立 alias，原标题、fork、大小写、分页与 node-id 主键反例保持不变。CR gate 拒绝四集合 stale 是 D1 的有意调整，PR provider 结构化失败仍保留部分降级粒度。没有新技术债务。

以下均在检出 `feature/delivery-repository-routing` 的工作树根目录执行，实施起点为计划提交 `ee5350060e211062e967dac00af2876ec2b53c1e`；2026-10-22 09:22 SGT 记录。验证命令按 Batch 1–3 可复跑，不依赖运行态报告：

| 证据 | 实际结果 |
|---|---|
| Batch 1 专用测试，修改生产代码前 | 6 tests / 0 pass / 6 fail；`AC297 registered-repository-multi-development-read (Fake)` 与四个 side-by-side、SQLite registered 同因 `AssertionError: 公开刷新必须经已登记仓库的唯一操作路由成功，无 capability gap` 失败，actual gap 为 `development.repository.read`。不是 import 或夹具异常。 |
| Batch 1 最小接线后同命令 | 6/6；补齐负向、持久性后同命令 26/26。 |
| Batch 2 四文件回归 | 84 tests / 84 pass / 0 fail，exit 0。 |
| Batch 3 五文件相关回归 | 130 tests / 130 pass / 0 fail，exit 0。 |
| `pnpm verify`（shell 入口） | typecheck 通过；contract / integration / e2e 为 1787/1787，MVP-0 为 7/7，exit 0。 |
| `pnpm run boundaries` / `node scripts/workflow-check.mjs` | 9/9 / no findings，exit 0。 |
| 提交前 `scanDiff(git diff --cached -U0 origin/main)` / `scanText(提交信息)` | 两项均零命中；代码测试 332 行，小于本计划 800 行；文档小于本计划 1300 行。 |

`node scripts/review-mutate.mjs .superpowers/297-route-mutants.json --root .` 的四项真实变异均为 KILLED，exit 0；基线与还原后基线均绿，源码字节一致。另用 `node --test --test-name-pattern=<下表用例前缀> tests/integration/delivery-repository-routing.test.js` 在各变异施加期间取出断言原因，随后立即按字节还原：

| 变异 | 失败用例（Fake / SQLite 同因） | 实际断言错误 |
|---|---|---|
| M1 恢复 key 级 seam | `AC297 registered-repository-multi-development-read (Fake)` | `AssertionError: 公开刷新必须经已登记仓库的唯一操作路由成功，无 capability gap`。 |
| M2 改用 repository.read 锚点 | `AC297 side-by-side-local-github-operation (local primary, Fake)` | 同上：actual 为 repository gap，未观察远端两跳。 |
| M3 选对连接却拼 Local ref | `AC297 side-by-side-local-github-operation (local primary, Fake)` | `AssertionError: 两跳都使用完整远端引用`；bindingId 是 Local，expected 是 GitHub 型连接。 |
| M4 拒绝只记 CR gap | `AC297 missing-current-reference (missing, Fake)` | `AssertionError: 路由拒绝保留四集合节点、锚点与 confirmedAt，全部 stale`；错误 key 导致已确认集合被清空或更新。 |

提交前人工核对凭据、本机路径与身份、账号与个人信息、内部系统、保密字样五类发布面，无发现；机械检查须覆盖最终提交范围。本批交回后已由本节最终交付记录取代（Superseded by 本节最终交付记录，2026-10-22）。真实 GitHub 权限、Harness 安装和完整 demo 仍由 #233 验收；本地离线替身与脚本化平台不能证明这些外部条件。

最终交付记录（2026-10-22 09:37 SGT @ `59ceff8696f3`）：独立验收通过，当前实现 head 的 PR Fast Gate、Integration/E2E/MVP-0/Boundaries 四 lane 及发布检查成功。归档只改变文档，产品文件与该验收树相同。最终归档提交仍须重新执行 `gh pr checks 392 -R SingularityKChen/harness-projects`，并回读 head/base、issue 双向关联和 review threads；通过后执行 `gh pr ready 392 -R SingularityKChen/harness-projects`。ready 和合并状态只以 PR 实时结果为准，Git 回滚不撤销 Project 元数据。

独立验收仅发现索引仍写“尚未实施”的 P3，本次归档已同步；无额外生产重构需要。

## Bottom Change Note

Change Note (2026-10-22 09:07 SGT)：首次整合 #297 两份独立设计与源码证据；明确完整操作门裁决、合法 alias 夹具、双 Storage TDD、变异归因、尺寸与当前 head 交付门。

Change Note (2026-10-22 09:22 SGT)：记录真实 TDD、拒绝/恢复、公共 alias、相关回归与四项 mutation 结果，明确实施批与最终远端交付的分工；保留 Active 等待独立实现审读。

2026-10-22 09:37 SGT：回填独立验收、实现 head 远端门、收敛提交边界并归档；最终归档 head 与 ready 使用实时回读命令，不继承旧绿。

2026-10-22：MMP 初审与独立复核未发现 P0/P1/P2/P3；证据归档于 `docs/review/pr-392-mmp-review.md`。本计划维持 completed；最终 push 后重新核对 head/base、checks、issue 关联和 review threads，再按本次人类直接授权以 rebase 合并。没有用代码测试替代真实产品走查。
