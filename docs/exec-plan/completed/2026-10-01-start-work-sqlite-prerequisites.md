# SQLite Start Work 前置与谱系闭环 ExecPlan

> 状态：Completed（2026-10-02）：B-1、B-2、B-3、四轮独立对抗验证、独立验收与第一轮 MVP 评审修订完成，已获批准并按人类授权 rebase merge；合并回执以 `gh pr view 253 -R SingularityKChen/harness-projects --json mergedAt,mergeCommit` 回读为准。各阶段的过程与证据见 `Progress` 与 `Artifacts and Notes`。
> 创建：2026-10-01；时区：Asia/Shanghai（CST）；格式依据根 `PLANS.md`。
> 范围：#187 + #188；前置为仓库身份契约 PR A，B 叠 A。
> 迭代：迭代 4 · Demo I：插件骨架、装配前置与 GitHub 读取，2026-10-08 至 2026-10-14。

## Purpose / Big Picture

实施后，一个经规划 bootstrap 登记的工作项，在 fake Development/Execution 与真实 SQLite 的组合上，从未登记仓库开始 Start Work，能先登记仓库及关系端点，再创建 Git 工作环境、提交可追溯谱系与账本，最后启动一次运行。正常同请求/同 key 重试及关库重开不创建第二份资源；外部已 ack 而本地结算失败、或历史 Ready 残缺状态，不再返回健康 Saved。

最小成功证据为同一入口 fixture 在 fake/SQLite 上运行，SQLite 的首次成功、完成事务故障、同文件重开，以及 context 对应 run 与两条关系的读回。只补 repository FK 会暴露下一处外部写后关系 FK，因此 [#187](https://github.com/SingularityKChen/harness-projects/issues/187) 和 [#188](https://github.com/SingularityKChen/harness-projects/issues/188) 组成一个 PR 闭环。当前交付仅设计与计划；closing 关联表示后续实现的关闭目标，当前不关闭 issue。Superseded by Decision Log 第一条新决策与 `Progress`（2026-10-01）：「当前交付仅设计与计划」不再成立，人类伙伴已指示按本 spec/plan 实施；closing 关联仍由 PR 描述负责，issue 在人类合并后才关闭。最小成功证据按批次分摊：B-1 是同一入口在两个适配器上从空仓库集合首启成功、外部写入之前父行已提交；「完成事务故障、同文件重开」属于 B-2 / B-3，见 `Plan of Work`。

## Context and Orientation

取证基线为 2026-10-01 的 `origin/main@cec5264f1b99757c78354f4c9ebb04442a01d930`。文档 B 建于 A 的本地文档提交后；实施命令在检出 `fix/start-work-sqlite-prerequisites` 的工作树根运行，目录可为 `.worktrees/start-work-sqlite-prerequisites`。先运行 `git rev-parse HEAD fix/repository-identity origin/main` 与 `git status --short --branch`；A 实施/重写后重新锁定其 tree 与证据。文档 stack 本身不代表 A 的产品接口已经实现。Superseded by `Progress`（2026-10-01）：A 已实现并验证，B 已重基到 A 的实现之上（A 的 `66b842a` 在 B 的文档提交之下），A 的接口现已存在。

上游是 [仓库身份契约 ExecPlan](2026-10-01-repository-identity-contract.md)，其实施提供 repository kind、unknown runtime guard 和受控 rebuild runner。Superseded by Decision Log「按 D10 订正」（2026-10-01）：A 按 D10 原位改 002，没有 rebuild runner；B 依赖的 A 接口见 `Interfaces and Dependencies`。上游的急迫/重要矩阵解释本轮只选这三 issue；B 执行仍需重复掌握：#195 是正确 repository 登记的契约前置，#187/#188 是连续两处 FK 断点；#129 的独立 UI、#197 的 binding 解析、#189 的同步作用域可以另设 owner，不能与 B 共享写入区域。#4 是聚合 Gate，当前不完成 E1/R1。

`packages/core/src/start-work.ts` 的 `startWork` 先重放 Git 账本，再在 `claimContext` 事务只写 execution_context；没有 `putRepository`。SQLite `execution_context` 对 `(workspace_id, repository_id)` 的 FK 指向 repository；fake 不检查该父边。`provisionGit` 的工作树末步 hook 提前写 Ready，之后 `provision` 才依次写关系、Git mutation_attempt、run。`recordStartFacts` 使用未登记的 context/worktree entity，SQLite 关系 FK 失败后留下 Ready，却没有相应边、attempt 或 run。

`contextIdFor(workspaceId,workItemId,repositoryId)` 与 `worktreeEntityId(workspaceId,repositoryId,workItemId)` 是稳定槽位函数；worktreeExternalId 为路径句柄，不是实体身份。`repository.id` 虽品牌为 EntityId，当前请求/Provider lookup 视它为原始仓库定位字符串；fixture 已分别使用 repo-1、repo-entity-1、repo-identity-1。SQLite rowid 不能替代这些稳定 TEXT 键。

003 中 repository.id 是全局单列主键，另外已有 UNIQUE(workspace,id)、UNIQUE(workspace,external_identity_id)。两个 adapter 目前按 id 覆盖 workspace，可能移动旧挂载；外部身份的自然键 `(bindingId,'repository',externalId)` 却跨工作区共享。正确挂载 scope 不能通过修改外部身份自然键解决。（以上是改前的取证基线；本批按 D10 原位改成复合主键，见 `Design / Spec` 的订正段。）

`createWriteLedger` 接受完整 Storage，`recordEdges` 接受完整 CoreContext；各自实际只用两种存储方法。SQLite 事务内必须用 tx，不能在回调调用外层 Storage 或 cast tx 为包含 transaction 的完整实例。fake 的关系端点仍与 SQLite 分叉；`delivery.ts/chainEdges` 的 commit/change_request/pipeline/check 写者尚未登记全部 entity，故不能全局收紧 fake 关系 FK。

基线真实探针与主控复跑按增量记录：缺 repository 时首次 FK 失败，branch/worktree/run 均无增量；仅测试性地预登记仓库后，branch+1/worktree+1、该 context 的 run 未记录，随后关系 FK 失败。Ready 的 relations=[]、attempts=[]，same-key 及 SQLite 关库重开都返回 confirmed/saved/degraded=false 且无 runExternalId。fake 起始已有2个 run，不能把这个反例写成“全库run=0”。SQL 的 FK=[]、integrity=ok 仍不证明业务闭环。

## Design / Spec

两位独立设计者各提出两方案。设计 A 的 B1 使用工作区复合挂载键和原子前置/完成；B2 保持全局仓库键并跨工作区 Conflict。设计 B 的 B1 将 preflight、getEntity、未知/Query 守卫内置 Start Work，但仍拒绝跨工作区同定位；B2 引入 prepareRepository 公共命令、返回内部定位键并迁移 controller/client/Host 调用。独立评审按同一结果、状态拥有、失败边界与总成本裁决。

| 候选 | 作用与代价 | 裁决 |
|---|---|---|
| 工作区挂载 + 内部 preflight + 原子完成 | 新增007，保持公开request/Query与slot函数；符合现有复合FK；风险集中于已受控的rebuild和本地结算 | 采纳设计A的B1，加设计B的已知实体、Query及unknown守卫 |
| 全局repository键 + 跨工作区Conflict | 少一个迁移，安全保留旧数据；但把工作区挂载变成仅一工作区，未来还需收敛scope | 拒绝设计A的B2及设计B B1的这个局部选择；若预算/迁移证据失败，回到该候选重新评审，不暗中采用 |
| prepareRepository公共命令 | 长期明确internal/external键，但波及controller/client/Host及全部fixture，独立估算810行且无余量 | 拒绝设计B的B2，本轮不用修FK来重定义公共流程 |
| 全局fake relation端点FK | 局部看似更强，会让delivery其它写者失败并牵入#221 | 拒绝设计B B1的该实现部分；两adapter核心正控直接证明本路径端点登记 |

上表第 1 行 Superseded by Decision Log「按 D10 订正」与「不新增 getEntity」（2026-10-01）：采纳的是「工作区挂载 + 内部 preflight + 原子完成」本身，「新增007」与「设计B的已知实体」两处作废；其余各行的裁决不变。

综合后的控制链是：Provider 拥有外部 ack，Host core 拥有身份登记/claim/推进，Storage 拥有本地事务和引用，Query 只读降级，UI 消费结果；工程事件不修改 Planning Status。主要不确定性是007非空升级与最终事实原子性，先做真实小库红→绿证明，再扩回归。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不再有 007 非空升级，主要不确定性只剩最终事实原子性（B-2）。

repository 是连接 scope 的 canonical Entity + ExternalIdentity；RepositoryRecord 是工作区挂载，键改为 `(workspaceId,id)`。本轮 id 仍保留请求定位字符串，不强制等于 canonical entityId，不改 StartWorkRequest、Query、contextIdFor 或 worktreeEntityId。同 workspace/id 不得换 identity，同 workspace/identity 不得登记另一个 id；不同 binding 的同 raw locator 在同 workspace 冲突，不猜映射，#219 多 binding 路由仍另案。

将新增 `007_repository_workspace_mount.sql`，保留全部旧 id/workspace/identity 及关联上下文，仅把 repository PK 改为 `(workspace_id,id)`；保留两条父 FK 与 UNIQUE(workspace,external_identity_id)，删除与新PK重复的 UNIQUE(workspace,id)。旧003不改。复用 A 的 Migration.rebuild 生命周期；`REPOSITORY_WORKSPACE_REBUILD` 的只读 preflight 支持合法0–6前缀，DDL 前锁内 before 要求已知v6形状；拒绝未知额外对象、null/不合法挂载键、损坏引用，不能猜测转换。显式复制三列及rowid→drop旧→rename新，事务内检查旧行/child引用、FK与integrity后才记7；finally恢复FK。规范依据 [SQLite受控结构变更](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)。Superseded by Decision Log「按 D10 订正」（2026-10-01）：不新增 007，原位修改 `003_control_facts.sql`；`Migration.rebuild`、`REPOSITORY_WORKSPACE_REBUILD`、旧库升级验收全部取消，订正后的挂载语义见本节末的「订正后的设计要点」第 5 条。

新增最窄端口 `getEntity(id: EntityId): Promise<Entity | undefined>`，两个实现通过既有读队列/状态返回；缺失返回undefined，不触发写入。工作项必须已经是 EntityKind.WorkItem，且当前workspace的planning projection为可操作的ContentKind.WorkItem；未知或别workspace答NotFound，wrong entity kind或change_request投影答InvalidInput，redacted内容不可操作答Unavailable。依据 `docs/product/vertical-path.md` 第6行及 `packages/ui-model/src/derive.ts/actionsFor`，Start Work只提供给work_item；change_request是工程产物，redacted没有可操作规划条目。拒绝不改变规划三态或实体分类：redacted保留原entity.kind，redacted CR仍为ChangeRequest；不能新造第二work_item或用缓存内容把redacted改成可操作条目。Superseded by Decision Log「不新增 getEntity」（2026-10-01）：不改端口，预检用已有的 `getPlanningProjection`，「wrong entity kind → InvalidInput」一格作废（entity 与投影不一致的状态 core 造不出来），见「订正后的设计要点」第 2 条。

入口先完成 request/actor/slug 检查，再做只读工作项检查。没有有效工作项不得产生 context、repo、branch、worktree、run。未命中完整既有结果时解析 DevelopmentWorktreeCreate 写目标，相关 RepositoryRead、WorktreeRead 及新建分支所需 BranchCreate 的能力/权限也必须可用且来自同一 binding；只检查方法存在不足以越过能力门。新建分支才要求 BranchCreate/defaultBranch，已有决定分支的resume不重依赖fromRef；冲突/歧义探针仍用同一个Provider的RepositoryRead/listBranches。Superseded in part by Decision Log「预检、能力门与 ack 只对新请求运行」（2026-10-01）：「未命中完整既有结果时」改为「没有 context 记录时」，已有记录沿用原路径，见「订正后的设计要点」第 1、3 条。

在此绑定调用 getRepository，ack 的 ref 必须 bindingId相同、objectKind=repository、externalId精确等于request定位；错binding/kind/id为Conflict，permission/not_found映射现有结构化错误。读取在事务外；不接受静默canonicalize别名。后续供应用同一 prepared target/ref/defaultBranch，不重新resolve到另一Provider或重复getRepository换事实。Superseded in part by Decision Log「prepared 取最小」（2026-10-01）：prepared 只含同一个 Development provider 实例的 binding id，`defaultBranch` 不透传（仅当某个测试需要时才加参数），见「订正后的设计要点」第 3 条。

能力前置失败需保留既有结果面契约：新请求不创建context；对于同一合法工作项/仓库已有、且按原租约规则可接管的终态或过期Provisioning，在短本地事务复判资格后记录Failed并保留已决定branch，返回该记录的真实句柄。未过期在途不可被另一个请求改成Failed，仍返回in-flight；完整Ready走existing验证而非重新claim。这样保留local-git resume的R2“能力失败仍报已决定分支、恢复后基线前进也可续”证据，不能只返回无context/无branch的startWorkUnavailable。Superseded by Decision Log「预检、能力门与 ack 只对新请求运行」（2026-10-01）：已有记录走原 `claimContext` 路径，不重新预检、不复判资格、不新记 Failed；R2 的契约本身由原路径原样提供，零改动。新请求没有能力时不创建 context。

一个短前置 transaction 复判工作项/当前workspace投影、旧挂载与实体kind，复用已有外部身份或以ensureEntity登记canonical repository、挂载行、context Entity、reserved worktree Entity，最后claim Provisioning与租约。已存在的entity必须kind一致，不能用putEntity UPSERT覆盖其它kind；旧仓库身份若为branch伪装，结构化Conflict并保留。事务失败整笔回滚且零外部write。只有commit后调用createBranch/createWorktree。reserved实体只表示本地槽位，不能作为工作树observed/confirmed证据。Superseded in part by Decision Log「不新增 getEntity」「按 D10 订正」（2026-10-01）：工作项/投影复判改为事务外的只读预检；「已存在的 entity 必须 kind 一致」因没有 getEntity 而不实施；「旧仓库身份为 branch 伪装」按 D10 不存在（旧库删库重建，自然键含 `repository` 种类）。写前登记本身保留（Decision Log「保留写前登记」），见「订正后的设计要点」第 4 条。

保留每步ack后的分步回填：分支身份保留、租约不清；工作树末步hook将句柄写回Provisioning，不能提前Ready。`provisionGit` 保持返回 GitOutcome Ready 表示外部供应完成，但hook收到的存储记录仍为Provisioning。现有独立provisionGit调用可保留参数形状，通过可选prepared参数接受Start Work的锁定target；独立入口沿同一解析机制，不改变测试直接供应的职责。（可选 prepared 参数的部分 Superseded by Decision Log「prepared 取最小」：不为「计划里写了 prepared」而加形状。）

Git成功后一个短 final transaction 写Ready、tracks、已ack的has_worktree、该次Git mutation_attempt；任何失败全部rollback。`recordEdges` 的context参数收窄为workspaceId及storage的listRelations/putRelation结构，现有其它调用仍适配；Start Work传 `{workspaceId, storage:tx}`。`createWriteLedger` 收窄为Pick<Storage,'findMutationAttempt'|'putMutationAttempt'>，在final用tx创建。不得在事务里调用root Storage、外部Provider，或开启嵌套transaction。

Git失败以短本地结算记录Failed/本次错误，保留已决定分支；tracks可以记录本地context，has_worktree仅以本次真实worktree ack的worktreeExternalId为证据。删除 `worktreeExternalId ?? branchExternalId` 的伪工作树fallback；这是#187闭环必要辅改，Closes #192（第一轮 MVP 评审订正，2026-10-02：#192 的两条验收都由本 PR 满足——工作树步失败后 confirmed has_worktree 为零的集成用例在两个适配器上各跑一遍，把关系写回 ack 之前的变异 M35 让它变红；原文「Refs #192，当前不关闭」Superseded）。其它关系写者和candidate确认策略不改。本地结算也要在结算事务内写该次 `mutation_attempt`（订正后的设计要点第 6 条）。

本地step/final/recordRun写入失败要显式返回 ResultUnknown、WritePhase.Unknown、WriteState.Unknown、confirmed=false、degraded=true，保留最后已ack句柄和上下文，禁止自动删除资源。不能调用 `markUnknown(git.report,...)` 后就认为转换成功：现有markUnknown只接受Writing/Unknown，Confirmed输入会原样返回；本路径使用 `reportFor(WritePhase.Unknown, git.report.values, error)` 建报告。前置事务失败且还没有外部write则返回Failed/Unavailable，无半行，不能冒充外部结果未知。

正常 ProviderResult 错误继续走既有结构化策略；test注入的进程中断/Provider抛异常仍可以中断调用并保留Provisioning。只在明确的本地写调用点标记并转换Storage失败，不用一个宽catch吞掉所有Provider中断，把原有crash/recovery测试的意义改掉。即使catch拿不到完整数据库，也不能因失败再写Saved账本。

final成功才调用startExecution，外部startRun在SQLite事务外；ack后以现有runIdFor/context、providerRef/status写运行记录。primary ack的failed仍是已确认运行，fallback按已有显式flag，不能由failed反推。run.status Unknown或ack后本地run写失败必须顶层Unknown，不自动启动第二执行者；运行失败的既有manual fallback规则保留。

existingResult与ledger replay在Ready时检查确切tracks/has_worktree的confirmed、context对应run及其已知状态。supplied Saved不能覆盖完整性守卫；命中的同key报告仍按已保存状态处理，不能因Ready把Failed/Unknown提升为Saved。无run/unknown run/必需边缺失时返回Unknown并保留Ready与句柄，不起新run、不凭名字制造历史边。已完整Ready的命令路径用挂载身份校验所选读取binding，verifyExistingWorktree走同Provider；读到明确不匹配/不存在沿现有失败处理。

MutationAttemptRecord当前没有contextId或请求指纹，不能实现“列出该context的Git账本”。新key未命中报告时，命令以确切本地边、已知run及同Provider工作树读回验证已有上下文；禁止从workspace任意Saved记录猜归属。Query readExecutionContext保持本地纯读，只查确切两边与run状态，Ready缺run/未知run/必需边时degraded=true，不调用Provider、不触发写者。历史仅缺Git账本但其他事实完整的记录，现端口无法精确判断归属；该细粒度校验留给#194/#204，不作为本次成功承诺。新的成功路径仍在final事务同时记录Git attempt，测试经本次请求key直接读回该行。

这没有解决Git final至run落盘之间的全部窗口。历史残缺Ready或run ack未知只显示待对账状态；#193将提供外部operation identity/reconcile。#194的请求fingerprint/actor校验、#204的在途pending/cross-context同key互斥仍未实施；同请求重启成功不等于所有错误请求/崩溃窗口恢复成功。

订正后的设计要点（2026-10-01，主控对预审的裁决，均写入 Decision Log；与上文冲突处以本段为准，上文被推翻处已就地标注）：

1. 流程顺序。`startWork` 依次是：validate（含 `namesProblem`：退化的工作项 id 在这里得到 `invalid_input`，不落任何行）→ `ledger.replay`（仍在预检之前：同 key 重放返回首次报告，不依赖当前投影；已有 context 不预检，所以这个顺序只对「同 key 换请求」可见，那是 #194 的范围——两者对调窄组仍全绿，是等价变异体，不加用例；保持 replay 在前是更安全的默认）→ 读 context 记录 →【没有记录：工作项预检 → 能力门 → `getRepository` ack → 挂载冲突预检】→ 写前短事务 → 供应；【已有记录：原 `claimContext` 路径，不预检、不 ack】。预检、能力门与 ack 全部发生在任何本地写入与外部写入之前。
2. 工作项预检（不新增 `getEntity`）。用已有的工作区作用域读 `storage.getPlanningProjection(workspaceId, workItemId)`：没有投影（含只在别的工作区有投影）→ `not_found`；内容种类 `change_request` → `invalid_input`；`redacted` → `unavailable`；`work_item` 通过。投影是「可操作内容」的权威来源（`docs/product/vertical-path.md` 第 6 行、`packages/ui-model/src/derive.ts` 的 `actionsFor`：Start Work 只提供给 `work_item`）。`getEntity` 只多防「实体与投影不一致」，core 造不出这种状态，却要改端口、`packages/capabilities/src/registry.ts` 的 `StorageSurface` 精确成员锁、两个适配器与共享契约（约 40 行）。
3. 能力门与 ack。能力门要求写门 `DevelopmentBranchCreate`（只读 → `permission_denied`）与读门 `DevelopmentRepositoryRead`、`DevelopmentWorktreeRead`，不可用 → `not_supported`；`DevelopmentWorktreeCreate` 的写门由随后解析写目标的 `resolveWriteTarget` 检查，不在门表里重复（变异实验证明重复一项是等价代码）。随后向同一个 Development provider 实例（`CoreProviderTable.development` 是单槽，同 binding 由构造保证；多 binding 路由是 #219）调用 `getRepository`：ack 的 `ref` 必须 `bindingId`、`objectKind`、`externalId` 逐字等于请求，否则 `conflict`；provider 错误经 `toProjectError` 映射。ack 因此要求请求里的仓库定位就是规范定位（与 `docs/adr/ADR-0001-external-identity-key-shape.md` 一致）：将来返回规范 node id 的 GitHub provider 需要调用方传那个 id。已有记录（终态接管、过期 Provisioning 续跑、在途、Ready）沿用原路径，因此 `tests/integration/README.md` 与 local-git 的 R1 / R2 / R3 契约（重试期间没有 `symbolic-ref`、能力失败仍报已决定分支）零改动。新请求没有能力时不再落一条 Failed context，是对原行为（能力失败也落 Failed context）的有意改变。
4. 写前短事务（保留写前登记）。canonical 仓库实体与 primary 身份（已登记则复用）、工作区挂载、context 实体、reserved worktree 实体（`worktreeEntityId`）与 claim Provisioning + 租约在同一个 `storage.transaction` 里提交，之后才有外部写入。context 与 reserved worktree 实体不能延到 final 事务：`getDeliveryProjection` 对「Provisioning + 已记录工作树句柄」的 context 会写谱系边（`chain-facts.ts` 以记录里的 `worktreeExternalId` 判定已观察，`delivery.ts` 的 `recordEdges` 落边），实体未登记时 SQLite 上一次读谱系就抛外键错误；读路径不得因写路径的中间态抛错。事务失败整笔回滚，返回结构化 Failed / `unavailable`，零外部写入，不冒充外部结果未知。挂载冲突（同工作区同 id 已挂在别的外部身份上）在事务外的读阶段预检为 `conflict`，写入时仍由 Storage 强制，竞态下事务失败即整笔回滚。
5. 挂载语义（D10）。003 原位把 `repository` 主键改为 `(workspace_id, id)`，`id` 为 `NOT NULL`（SQLite 的复合主键允许 NULL），删除重复的 `UNIQUE (workspace_id, id)`，保留 `UNIQUE (workspace_id, external_identity_id)` 与两条父 FK，列序不变（既有测试用位置 INSERT），`-- repository：` 出处注释行不动（D8 审计）。两个适配器的 `putRepository` 同语义：同值重复登记是 no-op；同 `(工作区, id)` 换外部身份、同 `(工作区, 身份)` 换 id 都被拒绝且不覆盖；同一个 `id` 可以挂在多个工作区上、互不影响。新主键下 `ON CONFLICT (id)` 非法，SQLite 的 `putRepository` 先比对已有行，再 `ON CONFLICT (workspace_id, id) DO NOTHING`（该子句对「同键换身份」是静默忽略而不是报错）。fake 的 `putExecutionContext` 补上仓库父边（与 SQLite 的复合外键同语义），分叉格因此从「接受悬空」翻成「拒绝」，翻转与 fake 实现、core 登记同一个提交（见 `Plan of Work` 的 B-1 提交 4）。
6. 失败结算要写账本（B-2）。Git 失败的本地结算也在结算事务内写 `mutation_attempt`，保持 `start-work-retry-identity` 的「同 key 不重新尝试」（同 key 重放返回失败报告）。
7. 读谱系会写关系（B-2 / B-3 的测试纪律）。`getDeliveryProjection` 对「Provisioning + 已记录工作树句柄」的 context 写 confirmed 的 tracks / has_worktree；B-2 把 Ready 推迟到 final 之后，final 失败留下的 Provisioning + 句柄会被一次读谱系「修复」，绕过「无新边」。因此断言 `relations=[]` 之前不得读谱系；必要时在 observed 判定里要求 `status = Ready`（一行）。SQLite 上读谱系对 commit / 变更请求端点仍会外键失败（#221），验收不扩到它。另外，谱系读会给 Provisioning 的 context 写 confirmed 的 tracks，**即使没有已记录的工作树句柄也写**（relations 从 0 条变成 1 条）：观察 2026-10-01 18:51 CST @ `0de571b`（检出 `fix/start-work-sqlite-prerequisites`），在分支步之后中断、只有分支句柄的 Provisioning context 上读一次谱系，期望输出 `{"before":[],"after":["tracks:confirmed"]}`：

    node --disable-warning=ExperimentalWarning --input-type=module -e "import { composeCore } from '@harness-projects/core'; import { createFakeProviders } from '@harness-projects/provider-fake'; import { newWorkspaceId } from '@harness-projects/domain'; const providers = createFakeProviders(); const workspaceId = newWorkspaceId(); const core = await composeCore({ workspace: { id: workspaceId, name: 'p' }, providers }); const workItemId = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId; providers.development.createWorktree = async () => { throw new Error('中断') }; await core.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'k' }).catch(() => {}); const types = async () => (await providers.storage.listRelations(workspaceId)).map((r) => r.type + ':' + r.state); const before = await types(); await core.queries.getDeliveryLineage({ workItemId, repositoryId: 'repo-alpha' }); console.log(JSON.stringify({ before, after: await types() }))"

因此「断言 relations=[] / 无新边之前不得读谱系」不只针对已记录的工作树句柄。
8. 规模闸与退路。B-3 的 Query 完整性与重放诚实性留在本 PR，但每批结束后核对相对 A 的累计 code（含测试）行数，超过 800 即停止并汇报；退路是 T0：只保留 B-1（已满足 #187 / #188 的字面关闭条件），B-2 / B-3 另开 PR（栈深仍 ≤3）。

## Global Constraints

旧版（25 项文件表、766 行预算，含 007 SQL、`migrations.ts`、两个迁移模块、`repository-workspace-upgrade.test.js`、`storage-source-version-upgrade.test.js`，以及 `getEntity` 的端口、适配器与共享契约）已作废：Superseded by Decision Log「按 D10 订正」「不新增 getEntity」（2026-10-01）；原文留在 git 历史里本文件的首个提交。

本批（B 相对 A）的代码加测试合计（SQL、测试、既有 fixture、守卫都计入 code，不另建镜像 fixture，不靠拆文件或排除测试躲预算）按增删之和计，硬停线 800；文档（含 `docs/product/vertical-path.md`、`tests/integration/README.md` 与技术债行）≤1300。下表「实测」列是相对 A 的累计增删之和，观察 2026-10-01 23:22 CST @ `912954f`（独立复评之后的小修；其后只有文档提交，代码行数不再变），重算：`git diff --numstat fix/repository-identity...<提交>` 与 `node scripts/rule-checks.mjs size fix/repository-identity`（期望：代码低于 800、文档低于 1300）。原先的观察点 `c7a6738`（748）Superseded by 本句（2026-10-01 22:14 CST），`0dcd129`（767）Superseded by 本句（2026-10-01 23:22 CST）。累计口径比逐批相加小，因为后一批改写前一批新增的行只算一次：B-2 之后（`98bb08c`）累计 613，B-3 之后（`12212a1`）727，B-2 对抗验证修复之后（`ebc6c11`）735，终局对抗验证修复之后（`c7a6738`）748，独立验收的接管修复之后（`0dcd129`）767，独立复评的小修之后（`912954f`）774，余量 26。独立验收的净增 +19：生产代码 +8（两条分支共用的 `existingRun` 连说明 +5，`startExecution` 删一行 B 自己加的 unknown 判断 −1，`startExecution` 与 `manualFallback` 各改一行原有的返回、按一增一删各计 2），用例 +11（接管用例从两行的内联数组改成四行的表，并加「与重放、Query 一致」的断言）。独立复评的小修目标是净增不超过 8（累计不超过 775），实际净增 +7：用例 +7（并发的写者先落 run 记录的一条 +5，e2e 里降级首次结果的错误码断言 +1，缺口文案格式的断言 +1；接管用例的结果面与期望、两条文案正则都改原行、不加行），生产代码 0（缺口文案补括号只改原行）。B-3 相对批次起点的增删之和是 138，低于 150 的批次硬停线；B-2 对抗验证的修复轮目标是净增不超过 0（累计不超过 725），实际净增 +8：补丁（缺口用例 +2、挂载一格 0、`run()` 并入 `attempt()` −6）合计 −4，失败结算 Unknown 的文案修复加它的两条用例合计 +12。清理过 dead code 与重复用例：没有发现可删的生产代码，把两条相似的失败结算用例合成表驱动最多再省约 3 行，却要改写已被对抗验证过的用例，没有做。终局对抗验证之后的小修目标是净增不超过 12（累计不超过 750），实际净增 +13：生产代码 +4（接管时已有 run 为 unknown 的一行 +1，`unknownRun` +4，删一行旧注释 −1，重放的守卫改写原行不加行），用例 +9（重放的表驱动 +4，接管的表驱动 +5），其中接管用例多出的 1 行是为杀掉「已有 run 不是 running 就报 Unknown」这一放宽的变异。逼近硬停线先找 dead code、重复用例与可合并的守卫；超过即停止，在汇报里说明并由主控裁决（Decision Log「范围与规模闸」）。预算是增删估算，不是删判别性测试的目标。

本批文件集是下表，这是它唯一的声明处；`Plan of Work`、`Progress`、`Decision Log` 与 `Bottom Change Note` 只写「见 `Global Constraints`」。

| 文件 | 批 | 职责 | 实测 |
|---|---|---|---|
| `packages/core/src/start-work.ts` | B-1 / B-2 / B-3 | B-1：预检、能力门、ack、挂载冲突预检、写前事务、`claimContext` 接收登记、`namesProblem` 移入请求校验；B-2：final 事务、失败结算、Unknown 报告；B-3：`existingResult` 的完整性守卫，run 记录写失败与 ack 状态未知转带 run 句柄的 Unknown；对抗验证后：失败结算 Unknown 的文案按事实陈述；终局对抗验证后：同 key 的 saved 报告遇到非 Ready 的记录、接管时已有的 run 为 unknown，都不再报 Saved，run 状态未知的文案陈述运行状态（`unknownRun`）；独立验收后：接管时已有 run 的两条分支（`startExecution`、`manualFallback`）共用 `existingRun`；独立复评后：缺口文案的缺口描述加全角括号分隔 | 198 |
| `packages/core/src/git-provisioning.ts` | B-2 | 工作树末步不再提前 Ready（hook 收到的记录仍为 Provisioning） | 3 |
| `packages/core/src/execution-context.ts` | B-3 | `readyGap`（Ready 的完整性谓词，命令的重放与 Query 共用）与 Query 的 `degraded` | 22 |
| `packages/core/src/relations.ts` | B-2 | `recordEdges` 收窄 storage 结构（`RelationStore`）；B-3 不再需要共享谓词 | 6 |
| `packages/core/src/write-machine.ts` | B-2 | ledger 窄依赖 | 2 |
| `packages/capabilities/src/storage.ts` | B-1 | `putRepository` 的挂载语义注释（不改端口方法集） | 1 |
| `packages/storage/sqlite/src/storage.ts` | B-1 | `putRepository`：复合键、先比对再写 | 7 |
| `packages/storage/sqlite/migrations/003_control_facts.sql` | B-1 | 原位：`repository` 复合主键与 `id NOT NULL` | 6 |
| `packages/providers/fake/src/storage.ts` | B-1 | 挂载冲突语义；执行上下文的仓库父边 | 17 |
| `tests/integration/start-work-sqlite-registration.test.js` | B-1 / B-2 / B-3 | 两适配器：登记、守卫、失败注入、重放、重开、读取诚实性、重放与接管的非 Ready / 未知运行；独立验收后：接管时已有 run 的四种世界（表驱动），断言接管、重放与 Query 一致；独立复评后：接管的结果面补分支与工作树句柄、两条文案正则各钉住原因，主执行 `startRun` 失败时并发写入的 run 记录不被降级覆盖，缺口文案的格式断言 | 351 |
| `tests/contract/suites/storage-execution.js` | B-1 | 挂载契约两条（第二条在两个工作区挂另一个外部身份）；分叉格改成 per-edge（含两处注释同步，悬空仓库一格改成只挂在另一个工作区，对抗验证后先在那个工作区挂另一个 id） | 64 |
| `tests/contract/storage-contract.test.js` | B-1 | 台账（执行组 +2）、分叉格能力位与错误文本、terminal 用例补父行 | 19 |
| `tests/contract/suites/storage.js` | B-1 | `ADDED_CASE_COUNT`（+2）与说明同步 | 4 |
| `tests/integration/execution-relation-write-schema.test.js` | B-1 | 钉住 `repository.id` 的 NOT NULL（复合主键允许 NULL） | 2 |
| `tests/integration/local-git-fixture.js` | B-1 | `registerWorkItem`：实体加当前工作区的 work_item 投影 | 8 |
| `tests/integration/local-git-core-provisioning.test.js`、`tests/integration/local-git-start-work-resume.test.js`、`tests/integration/local-git-branch-probe.test.js` | B-1 | 裸 ID 的 Start Work 用例先登记工作项 | 17 |
| `tests/integration/human-execution-provider.test.js` | B-1 | `WORK_ITEMS` 统一登记 | 5 |
| `tests/integration/start-work-retry-identity.test.js` | B-1 | scope 用例改写（先供应成功，再在同一 Storage 上重组读能力失效的 core）与选取器过滤 | 27 |
| 选取器过滤：`tests/e2e/delivery-lineage.test.js`、`tests/e2e/start-work-recovery.test.js`、`tests/e2e/start-work.test.js`、`tests/e2e/status-policy.test.js`、`tests/e2e/write-machine.test.js`、`tests/integration/start-work-step-recording.test.js`、`tests/mvp0/chain.test.js` | B-1 | 每处 +1 / −1，只取内容种类为 `work_item` 的条目；独立复评后 `tests/e2e/start-work.test.js` 另加降级首次结果的错误码断言 +1 | 15 |
| 小计 / 余量 / 硬上限 | | | 774 / 26 / 800（Superseded by Decision Log「评审修订的规模」，2026-10-02：评审修订后实测 967 / CI 硬上限 1000） |

文档（不计入上表）：本计划与 `docs/README.md` 的 B 索引行（每批更新）；`tests/integration/README.md`（B-1：新文件行与选取器 / 登记约定；B-3：读取诚实性、run 记录写失败、重放先于预检、租约内在途与失败结算文案的行；独立验收：接管时已有 run 一行；独立复评：并发写者一行与两处措辞）；`docs/product/vertical-path.md`（B-3：按 §2.1 的同 PR 更新义务更新第 6 / 7 行、探针 P3 / P4 / X1 与观察基线，增删之和 22，低于 80 的上限；独立验收没有改它）；`docs/exec-plan/tech-debt-tracker.md`（TD-005 至 TD-014，相对 A 只有新增行；TD-005、TD-006、TD-009 是本分支自己新增的行，被后来的轮次就地订正）。

保持包依赖方向、稳定 ID 与 public Request / Query、Planning 状态、Provider ack 门；不删除外部 branch / worktree / run，不用真实 GitHub 写作验收；不新增 Storage 端口方法；B 依赖 A 交付的接口，不改它们的行为（见 `Interfaces and Dependencies`），发现 A 的缺陷时停下汇报。A 的 owner 已交接，B 接管相邻的 storage / fake 文件，禁止并行混写。本轮只关闭 #187 / #188 的目标；Refs #192 / #193 / #194 / #196 / #204 / #219 / #221 均保留，#4 Gate 未完成。PR 整体建议 L；两 issue 可按登记与谱系 / 守卫两责任分别建议 M，保持现场 Priority P0 与 M4 Milestone，Gate 沿现有 labels，不新造 E1 完成值。当前元数据是建议，只有主控实际回读后才记已投影。

## Plan of Work

旧版（B-1 含 007、`getEntity`、旧库升级与 `Migration.rebuild` 前缀检查，B-3 含 fixture 前提更新）已作废：Superseded by Decision Log「按 D10 订正」「fixture 前提先行」「不新增 getEntity」（2026-10-01）。设计评审门已按 Decision Log 第一条新决策开启，不再另设批准阻塞。批次改动的文件集合只在 `Global Constraints` 声明。每批遵循对齐 → 隔离 → 实现 → 验证 → 记录 → 提交 → 汇报；每个提交在其树上为绿；每个实施者只读本计划与仓库，证据写进本计划；每批结束后核对相对 A 的累计 code 行数（`Design / Spec` 订正段第 8 条）。

### Batch B-1 · 计划订正、前提先行、挂载与写前登记

**最小闭环**：SQLite 空库上的 Start Work 从空仓库集合首启全链路成功（Ready、两条 confirmed 关系、`saved` 的 attempt、context 对应的 run），外部写入之前仓库挂载、context 与 reserved worktree 实体已提交；不合格请求在任何写入之前被结构化拒绝。这已满足 #187 / #188 的字面关闭条件；失败窗口（B-2 / B-3）仍是旧行为，本批不改。
**涉及文件**：见 `Global Constraints` 中批为 B-1 的行。
- 提交 1，docs：本计划按 D10 与预审订正。
- 提交 2，test(core)：fixture 前提先行。没有 RED：它是「让改动变容易」，必须在无守卫的基线上就为绿——先跑前提组确认基线全绿，再 apply，再跑一遍确认用例数不变。内容：显式登记 Start Work 的工作项（`registerWorkItem`）、8 个选取器只取内容种类为 `work_item` 的条目、`start-work-retry-identity` 的 scope 用例改写、terminal 用例补仓库父行。
- 提交 3，fix(storage)：挂载契约 RED → GREEN（R1.5）。先在 `tests/contract/suites/storage-execution.js` 写两条共享用例（两适配器各跑，台账 +2）：挂载以 `(工作区, id)` 为键，换身份与换 id 都被拒绝且不覆盖，同值重复登记是 no-op；同一个 id 可以挂在两个工作区上、互不影响（含已有子行引用时）。亲眼看它们在旧代码上因功能缺失而红，再改 003、SQLite 与 fake 的 `putRepository`、端口注释；003 的 `id NOT NULL` 由 schema 集成用例的一条裸 SQL 断言钉住（变异实验见 `Artifacts and Notes`）。
- 提交 4，fix(core)：写前登记 RED → GREEN。新文件 `tests/integration/start-work-sqlite-registration.test.js`（两适配器参数化）的判别性清单：R1.1 空集合首启成功（外部 +1 / +1 / +1、挂载、三个实体的种类、2 条 confirmed 关系、attempt、context 对应的 run、SQLite 的 FK=[]）；R1.2 外部写前父行已提交（包 `createBranch`，回调内反读挂载与 Provisioning + 租约；Superseded in part by Decision Log「父行断言并入首启用例」（2026-10-01）：现在是 R1.1 里的一组断言，不再是独立用例）；R1.3 工作项守卫表（未知 / 别的工作区 / 变更请求 / 被扣下 → `not_found` / `not_found` / `invalid_input` / `unavailable`，加有效正控；每行零外部写、零本地新增）；R1.4 ack 与能力门表（`getRepository` 的 `not_found` / `permission_denied`；ack 回显的 `bindingId` / `objectKind` / `externalId` 不符，须包装 provider 伪造 → `conflict`；仓库读、工作树读不可用，工作树创建、分支创建只读，分支创建不可用 → 结构化失败；每行零外部写、零本地行；`getRepository` 被询问的正控）；R1.6 写前事务注入（`injectAfterWrite(storage, 'putRepository', 1)` → 结构化失败、零外部写、无孤儿行；命中计数与无故障正控；对抗验证后参数化，再加认领自己的写 `putExecutionContext`）；R1.7 两个工作区同 binding 同仓库（一个 canonical 实体与身份、两个挂载、ws1 的 context 引用不被搬走）；R1.8 挂载冲突预检（同工作区同 id 已挂在别的外部身份上 → `conflict`，原挂载不变，零外部写）。失败注入走测试侧的 Storage 包装：包 `transaction` 的 tx 代理并共用命中计数，不用 SQLite TRIGGER（`RAISE(ABORT)` 的回滚会把触发器自己写的命中记录一并回滚）。GREEN：`start-work.ts` 的预检、能力门、ack、冲突预检与写前事务；fake 的 `putExecutionContext` 仓库父边与分叉格翻转并入本提交——若在提交 3 落地，fake 上所有 `startWork` 用例在那个提交上都会红（core 此时还不登记仓库），违反「每个提交在其树上为绿」。`namesProblem` 移入请求校验，退化 id 先于工作项预检得到 `invalid_input`。
- 提交 5，docs：证据回填（Progress、Surprises、Artifacts、变异表、宽验证、Bottom Change Note）。
**验证**：`Validation and Acceptance` 的命令一、二、三与宽验证；`pnpm verify` 里的随机性已被提交 2 消除，窄组连跑 3 次不再随机红。
**回滚**：回退对应提交；没有数据迁移（D10），旧开发库删库重建。

### Batch B-2 · ack 之后的本地最终事实同生共死

**最小闭环**：Git 外部写入 ack 之后，Ready、tracks / has_worktree 与该次 Git `mutation_attempt` 在同一个 final 事务里提交；任何本地失败返回 Unknown 并保留已 ack 的句柄与 Provisioning，不显示 Saved，不自动删除外部资源。
**涉及文件**：见 `Global Constraints` 中批为 B-2 的行。
- harness：沿用 B-1 的 `injectAfterWrite`，扩成同时包根 Storage 的方法与 `transaction` 的 tx 代理（共用命中计数）——`ledger.record` 与 `saveContext` 走根 Storage。每个注入点都要有命中计数断言与同场景的无故障正控。B-2 实施时 harness 与新用例留在 B-1 的测试文件，不提取独立的 fixture 文件，见 Decision Log「B-2 的测试留在 B-1 的测试文件」。
- RED 清单：R2.1 注入 `putMutationAttempt` 第 1 次写：返回 Unknown / `result_unknown`、`confirmed=false`、`degraded=true`、`saving=false`；存储里 context 仍是 Provisioning 且留 branch 与 worktree 句柄和租约，relations=[]、attempts=[]、没有 run；外部 branch / worktree 各 +1、`startRun` 0 次；Ready、两条关系与 attempt 在同一个事务（事务序号相同；Superseded in part by Decision Log「同一个事务用回滚证明」（2026-10-01）：不记事务序号，由注入最后一写后其余全部回滚证明）；正控无故障时 Ready、两条关系与一条 attempt，命中数为 1；基线红：Ready 与关系已落、promise 被拒。R2.2 注入第 2 次 `putRelation`（has_worktree）：tracks 也被回滚。R2.3 `createWorktree` 返回 `unavailable`：Failed、分支保留、tracks 在、has_worktree 不在（不借分支句柄）；基线红：写出 has_worktree（#192）。R2.4 分支 ack 后 step 回填的 `putExecutionContext` 抛错：Unknown，`createWorktree` 0 次，结果带分支句柄；基线红：promise 被拒；断言 relations=[] 之前不得读谱系（订正段第 7 条）。
- 实现：`provisionGit` 的工作树末步 hook 收到的仍是 Provisioning；`provision` 在 final 事务里写 Ready、tracks、已 ack 的 has_worktree 与 attempt；Git 失败的本地结算同样在事务内写 attempt（订正段第 6 条）；本地写失败用 `reportFor(WritePhase.Unknown, …)` 建报告（`markUnknown` 对 Confirmed 输入原样返回）；删除 `worktreeExternalId ?? branchExternalId` 的 fallback；`recordEdges` 与 `createWriteLedger` 收窄成各自实际用到的两种存储方法，事务内只用 tx。
- 对抗验证后的补充（verify-b2，2026-10-01）：注入点表（`LOCAL_FAILURES`）扩成 5 行，加入 `putExecutionContext` 第 3 次（工作树步的步骤回填，写已生效、调用失败）与第 4 次（最终事务自己的 context 写，事务里第一写），正控断言 Ready 的租约已清空；失败结算的 Unknown 文案按事实陈述；理由与变异证据见 Decision Log「采纳 verify-b2 的补丁 1、2、4」「失败结算 Unknown 的文案按事实陈述」。
**验证**：命令一、二与宽验证。
**回滚**：回退本批提交；只撤本地未提交事实，不删外部资源。

### Batch B-3 · 读取与重放的诚实状态、移交

**最小闭环**：`existingResult`、同 key 重放与 Query 不再把残缺的 Ready 报成健康 Saved；`startRun` ack 后本地 run 写失败返回 Unknown，且重放不起第二个执行者；正常完成后 same / new key 与 SQLite 重开稳定。
**涉及文件**：见 `Global Constraints` 中批为 B-3 的行。
- RED 清单：R3.1 播种表（Ready 无 run / run=unknown / 缺 has_worktree / 缺 tracks）× 同 key（附 saved attempt）/ 新 key / SQLite 关库重开：全部 Unknown、`confirmed=false`，runs 增量 0；Query `degraded=true` 且零 provider 调用（包装全部 provider，计数为 0）；基线红：全部 `confirmed / saved / degraded=false`；正控：完整 context → Saved。Superseded in part by Decision Log「B-3 的用例世界由真实开始工作加故障注入产生」（2026-10-01）：不手工播种，改成真实开始工作加故障注入——run 记录写不进去（`injectLostWrite`）、ack 的状态不是已知取值（`acking`）、事务里的关系写入被静默丢掉或降成候选（`dropRelation`），另加完整与「主执行 ack 为 `failed`」两个正控；7 行 × 两个适配器，每行的同 key / 新 key / 关库重开后的新 key 与 Query 给出同一个答案，外部与本地事实一字不改。R3.2 注入根方法 `putExecutionRun` 第 1 次：Unknown、外部 run +1、本地无 run，同 key / 新 key / 重开仍 Unknown，`startRun` 总次数为 1；基线红：promise 被拒。Superseded in part：「写后失败」改成「写不进去」（`injectAfterWrite` 对根方法是写后失败，会把 run 留在库里，与「本地无 run」矛盾），并入同一张表的第 2 行，另加 ack 状态不是已知取值的第 3 行。R3.3 同 key 命中 Failed / Unknown 报告时 Ready 不提升：基线已绿，是回归守卫，不是 RED；用例在残缺的 Ready 上做，所以同时钉住守卫不改写它们。R3.4 正常完成后 same / new key / 重开稳定（基线 SQLite 红于首启）：并入表的第 1 行正控，外部与本地快照逐字不变。R3.5 租约：未过期的在途不被完整性守卫改判（命令与 Query 都不判），过期的 resume 完成（可控时钟）。
- 实现：`existingResult` 与 ledger replay 在 Ready 时检查确切的 tracks / has_worktree 的 confirmed、context 对应的 run 及其已知状态，supplied Saved 不能覆盖守卫；`readExecutionContext` 保持本地纯读，Ready 缺 run、未知 run 或缺必需边时 `degraded=true`；`startRun` ack 后的 `recordRun` 失败转 Unknown。历史上只缺 Git 账本、其余事实完整的记录无法精确归属，留给 #194 / #204。已实现：谓词 `readyGap` 在 `execution-context.ts`，命令的重放与 Query 共用；`existingResult` 只对会报 Saved 的 Ready 过它；主执行 ack 之后的 `recordRun` 失败与 ack 的状态不是已知取值都是带已 ack 的 run 句柄的 Unknown（Decision Log 的 B-3 各条）。
- 文档：按 `docs/product/vertical-path.md` §2.1 的同 PR 更新义务更新第 6 / 7 行（含探针 P3 / P4 / X1：它们的选取器同样随机，X1 的观察值——不存在的工作项报 saved、落一条 ready 上下文——会被本 PR 改变，须按新选取器重跑）；新 SQLite 用例必须经 `composeCore` 与 `commands.startWork`，手工 `createContext` / `provisionGit` 仍标旁证；`tests/integration/README.md` 补全新文件行。已完成，观察与回读证据见 `Artifacts and Notes`。
- 对抗验证修复轮（verify-b2 对 `98bb08c` 的验证，2026-10-01）：三个提交，`test(core)` 补缺口用例（补丁 1、2、4），`fix(core)` 失败结算 Unknown 的文案，`docs(exec-plan)` 本计划的证据回填与技术债；补丁 3（读谱系只对 Ready 算已观察）在 B 的文件集之外，由人类裁决，登记 TD-009。
- 终局对抗验证后的小修（verify-b3，BASE `98bb08c` → HEAD `dee1d5f`，无 P0 / P1，三处 P2，2026-10-01）：`fix(core)` 同 key 的 saved 报告遇到非 Ready 的记录不再原样返回 Saved（P2-2）、接管时已有的 run 为 unknown 报 Unknown（P2-3）、run 状态未知的文案陈述运行状态而不是本地写失败；`test(core)` 钉住主执行 ack 为 failed 的接管仍是 Saved；`docs(exec-plan)` 订正文字并登记 TD-012（Ready 之后的启动窗口里重试得到 Unknown，P2-1）与 TD-013（controller 的 `StartWorkView` 没有 `runExternalId`）；不做把 `worktreeEntityId` 下沉以消除循环 import（Decision Log）。
- 独立验收（accept-b，被验 `a93d572..271e497`，结论附注接受，2026-10-01）：`fix(core)` 接管时已有 run 的两条分支共用 `existingRun`——主执行不可用时接管走 `manualFallback`，遇到 unknown 的 run 原先报健康 Saved；主执行可用时接管走 `startExecution`，原先丢掉人工降级标记与 run 句柄（Decision Log「接管时已有 run 的两条分支共用一个答案」）；`docs(exec-plan)` 回填验收结论、各取舍的裁决与交接事实，订正 TD-006、登记 TD-014。
- 独立复评后的小修（verify-b4，被验 `0dcd129`，BASE `271e497` → HEAD `569d759`，PASS_WITH_FINDINGS，无 P0 / P1 / P2、六条 P3，2026-10-01）：`test(core)` 补接管与降级路径的判别性缺口（接管用例的结果面补分支与工作树句柄、两条文案正则各钉住原因、主执行 `startRun` 失败时并发写入的 run 记录不被降级覆盖、e2e 里降级首次结果的错误码），`fix(core)` 缺口文案的缺口描述加全角括号分隔，`docs(exec-plan)` 订正验收证据的措辞（扫描范围、提交计数、TD-006 与 TD-005 的数字、验收附注①）并记录这次复评；行为不变，没有新债。
**验证**：命令一、二与宽验证。
**回滚**：回退本批提交。

## Validation and Acceptance

旧版（含 `repository-workspace-upgrade`、`repository-identity-upgrade`、`storage-source-version-upgrade` 的命令，「007 非空升级 / 故障 / 并发 / 重开」一行，以及「wrong entity kind」一格）已作废：Superseded by Decision Log「按 D10 订正」「不新增 getEntity」（2026-10-01）。

下列命令在检出 `fix/start-work-sqlite-prerequisites` 的工作树根运行，前三条依次称命令一、命令二、命令三；A 已实现并已重基。该工作树必须有自己的 `node_modules`（`ls -l node_modules/@harness-projects/core` 期望指向 `../../packages/core`，见 `tests/README.md`）。新测试先写、先看它因功能缺失而红，再实现、再跑绿，随后因持久化 / 并发 / 外部写风险扩大。

    node --test tests/integration/start-work-sqlite-registration.test.js tests/contract/storage-contract.test.js
    node --test tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-step-recording.test.js tests/integration/start-work-retry-identity.test.js tests/integration/local-git-core-provisioning.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/local-git-branch-probe.test.js tests/integration/human-execution-provider.test.js
    node --test tests/e2e tests/integration tests/mvp0 tests/contract/storage-contract.test.js tests/contract/development-contract.test.js tests/contract/execution-contract.test.js tests/contract/delivery-contract.test.js
    pnpm run typecheck
    pnpm run boundaries
    pnpm verify
    node scripts/rule-checks.mjs size fix/repository-identity
    node scripts/rule-checks.mjs disclosure fix/repository-identity
    git diff --check fix/repository-identity...HEAD
    git diff --numstat fix/repository-identity...HEAD
    node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js

结构 lint 用的是仓库外 exec-plan 技能的 `scripts/lint_execplan.py`（输出 `OK: ExecPlan passed lint checks.`），不列为可复跑命令；仓库内的等价检查是最后一条文档契约（第一轮 MVP 评审 P3，2026-10-02）。

第三条是「前提组」：29 个相关文件，基准是未改动生产代码的同一棵树上的结果（观察时刻、head 与用例数见 `Artifacts and Notes` 的「计数基准」），fixture 提交与每个守卫提交前后都要重跑；期望是用例数与基准的关系，不是某个孤立的值。期望：窄组与前提组全绿，判别性新增用例在旧基线红、实现后绿，每个失败注入有命中计数与无故障正控；typecheck、boundaries、verify 退出 0；size 与 disclosure 通过；`git diff --numstat` 的 code 行数低于 `Global Constraints` 的硬停线（800，相对 A 累计）、docs ≤1300（Superseded by Decision Log「评审修订的规模」：评审与复评修订后代码 983 / CI 硬上限 1000、文档低于 1500）；lint 输出 `OK: ExecPlan passed lint checks.`（仓库外工具，见上段说明，不作为可复跑的判据）；最后一条文档契约全绿。

| 场景 / 风险 | 必须观察的结果 |
|---|---|
| 从空repository集合成功（B-1） | repo ack→前置父行commit→branch/worktree ack→Ready+2 confirmed系统关系+Git attempt→context对应run；FK=[]、integrity=ok |
| 工作项缺失/CR/别workspace/redacted（B-1） | `not_found` / `invalid_input` / `not_found` / `unavailable`；0外部write/0context/0repo新增，不造work_item，不改Planning三态或CR实体 |
| repo read错误/ref错binding/kind/id/缺能力（B-1） | 现有结构化错误或 `conflict`；0 branch/worktree/run增量，不能Saved；新请求不落 Failed context |
| 挂载冲突/前置事务失败（B-1） | 原mount/context值不变，无孤儿；外部write未发生 |
| 两workspace同binding同仓库（B-1） | 一canonical entity+identity，两mount，旧workspace/context引用不搬走；不声称完成所有多Provider路径 |
| 旧开发库删库重建（D10，B-1） | 已应用旧 003 的库首次出现跨工作区同 id 挂载时由旧主键响亮拒绝（一次性探针，不入库、不写成永久测试，输出记在 `Surprises & Discoveries`）；处置为删库重建 |
| branch ack后的本地记录失败（B-2） | 明确Unknown，分支真实存在，Provisioning线索保留；不写Saved、不自动删分支 |
| worktree ack后final关系/账本失败（B-2） | Provider资源存在；本地仍Provisioning和已ack句柄，无Ready/新边/attempt半提交，无新run |
| worktree失败但branch成功（B-2） | 无confirmed has_worktree；reserved entity不等于observed工作树，Refs #192（Superseded：#192 由本 PR 关闭，见 `Design / Spec`） |
| Ready缺run/必需边或run Unknown（B-3） | 同key/newkey/reopen都Unknown/degraded；supplied Saved不覆盖guard；Query仅本地降级，无Provider调用；不补startRun |
| 同key命中Unknown/Failed，或new key无报告（B-3） | 命中报告不被Ready提升；未命中则命令验证本地边/run及同Provider工作树，不猜context账本归属；仅缺账本的历史关联校验留#194/#204 |
| startRun ack后本地run失败（B-3） | 外部run+1，本地未记录；Unknown并保留资源，同key/reopen不发第二run，Refs #193 |
| 正常完成后same/new key/reopen（B-1 首启、B-3 完整） | context/entity/identity/run/ref/两关系不变，branch/worktree/run无增量；用context对应run，勿把seed计数当结论 |
| 租约与既有重试契约（每批） | in-flight阻挡；过期resume保留已决定分支，不重新解析fromRef；fake全局关系分叉仍显式 |
| 完整性守卫不误伤（B-3） | 完整的 Ready（含主执行 ack 为 `failed`，不从 `failed` 反推）在同 key / 新 key / 重开与 Query 上稳定为 Saved / `degraded=false`；租约内的在途仍是 `pending`、不被改判；同 key 命中的 Failed / Unknown 首次报告原样返回 |
| 失败结算的 Unknown 文案（B-2 对抗验证后） | 没有任何 ack（分支创建被 provider 拒绝）时文案不称已 ack、带上 provider 的原始失败；有已 ack 的分支时说已 ack 并带上原始失败；注入有命中计数与无故障正控 |
| 非 Ready 的记录上同 key 的 saved attempt（终局对抗验证后） | 记录已是 Failed（工作树消失后被判）或 Provisioning（被新 key 接管）时，同 key 重放不报 Saved，连续两次一致：Failed 报 `failed`，Provisioning 报 `pending` |
| 接管时已有的 run（终局对抗验证后；独立验收后扩到两条分支） | 主执行可用（`startExecution`）与不可用（`manualFallback`）两条分支答案相同，且与这次接管自己的重放、Query 一致：已有的 run 为 unknown 报 Unknown（带已有 run 的句柄，文案陈述运行状态未知），主执行 ack 的 failed 仍是 Saved 并带 run 句柄，人工降级如实带回 `fallback` 与 `degraded`；都不起第二个 run |
| 降级窗口里并发写入的 run、缺口文案的格式（独立复评后） | 主执行 `startRun` 失败之后、降级之前别处刚落了一条 run 记录：`manualFallback` 的二次检查保留它并如实带回（`saved`、不带 `fallback`、run 句柄是那条记录的），不起降级、不覆盖那条记录；Ready 之后的缺口文案都以「已 ready 的上下文（缺口描述）：」开头，缺口描述放进全角括号 |
| Ready 的工作树一时读不到（第一轮 MVP 评审 P2） | 工作树读失败或读能力缺失：同 key 与新 key 都报 Unknown、记录仍是 Ready、不起第二个 run；provider 确定不存在（`not_found`）或检出别的分支才判 Failed |
| 主执行 `startRun` 结果不确定（第一轮 MVP 评审 P2，ADR-0007） | 本地 run 记 `unknown`、不转人工降级、不起 fallback，顶层 Unknown；同 key、新 key、重开与 Query 同一个答案 |
| 工作树步结果不确定（第一轮 MVP 评审 P3） | 与分支步同一个对账出口：读回同路径、检出同一分支即 reconciled 并照常 Ready；确定不存在才 Failed（`not_found`，来自对账），读失败报 Unknown |
| Development 绑定 id 变了（第一轮 MVP 评审 P2） | 已挂载仓库上的新工作项在任何外部写入之前 `conflict`，文案点名「绑定 id 变了」；装配固定 bindingId 归 #228（TD-015） |

人类验收在fake Provider+SQLite临时文件上启动真实规划工作项、读工作环境/关系/运行、关库重开同请求（可复跑命令见 `Concrete Steps` 的「人工验收命令」：composeCore + 真实 SQLite 文件 + 真实 local Git，第一轮 MVP 评审 P3 补入）；再触发一个final写失败验证Unknown与本地rollback（可复跑：`node --test --test-reporter=spec --test-name-pattern='ack 之后本地写失败' tests/integration/start-work-sqlite-registration.test.js`，替身与 SQLite 各五个注入点，期望 `ℹ tests 10`、`ℹ fail 0`）。尚未确认外部run的历史Ready只允许人工核对，不盲目再次启动。全部产品证据及最终push后head/base/checks/issue/thread回读才是ready门；本轮draft保持draft，合并由人类决定（Superseded 2026-10-02：人类授权 ready 与 rebase merge，见顶部状态）。

## Progress

- [x] (2026-10-01 13:10 CST) 重读两位设计者各两种B方案并核实startWork/Provider/端口/DDL/真实case前提。
- [x] (2026-10-01 13:10 CST) 采纳工作区mount与内部完成屏障，拒绝全局fake关系收紧及公共prepare命令；写本spec+plan。
- [x] (2026-10-01 15:24 CST) 完成磁盘语义审读，原生awk核算原23项预算721/余79；修正账本归属、纯读Query、suite台账与既有能力失败句柄契约；技能lint通过。
- [x] (2026-10-01 15:35 CST) 补齐两个旧fixture与未来产品证据矩阵文档义务；确认WorkItem动作资格及Planning三态不变；未来code预算25项766/余34，重新审读并lint。
- [x] (2026-10-01 15:39 CST) 主控完成索引、技能lint、13章次序与本地链接；文档契约9/9、暂存diff及公开面扫描通过，人工五类目未命中。
- [x] (2026-10-01 15:39 CST) 已取消：~~后续实施交接前重新回读本分支draft PR、stack、双向issue关联及非Status元数据；发布状态以GitHub当前快照为准。~~ Superseded by `Concrete Steps` 末段（2026-10-01）：实施已完成，发布状态的回读写成规则式，由主控 push 之后执行。
- [x] (2026-10-01 13:10 CST) 已取消：~~后续B-1/B-2/B-3实现、真实红→绿/非空升级/重启/人工验收；当前未执行。~~ Superseded by 下列各项（2026-10-01）：非空升级验收取消（D10），其余按批次拆分，人工验收与 ready 门在 B-3 之后。
- [x] (2026-10-01 17:33 CST) 设计评审门已开启（Decision Log 第一条新决策）；读取公共规则、批次 brief、预审与本计划全文，在未改动的树上跑前提组建立基线（计数见 `Artifacts and Notes` 的「计数基准」）。
- [x] (2026-10-01 17:33 CST) B-1 提交 1：本计划按 D10 与预审订正——文件表、批次、验收、恢复与依赖换成有效内容，被推翻处就地 Superseded，追加 Decision Log。
- [x] (2026-10-01 17:34 CST) B-1 提交 2：fixture 前提先行——无 RED，前后各跑前提组，全部通过且用例数不变（计数见 `Artifacts and Notes` 的「计数基准」）。
- [x] (2026-10-01 17:36 CST) B-1 提交 3：挂载契约先红（131 个里 4 个新用例失败）后绿（131 / 131）；003 原位改复合主键、SQLite 与替身的 `putRepository`、端口注释、schema 的 NOT NULL 断言。
- [x] (2026-10-01 17:41 CST) B-1 提交 4：core 写前登记先红（14 / 14 失败）后绿（14 / 14）；替身的仓库父边与分叉格翻转并入（先红一条后绿）；前提组全绿，`pnpm verify` 退出 0（计数见「计数基准」）。
- [x] (2026-10-01 17:53 CST) B-1 提交 5：证据回填——30 个变异（29 个被抓住，1 个等价变异体已删重复条目）、旧库探针、宽验证、B-2 / B-3 的估算更新。SQLite 空库首启全链路成功，已满足 #187 / #188 的字面关闭条件。
- [x] (2026-10-01 18:57 CST) B-1 对抗验证修复（verify-b1，B-1 head `55b6952`，无 P0 / P1）：补 7 个真缺口的用例（第二个工作项、认领写注入、只读读能力、primary 身份、挂载契约两处按工作区），认领失败转结构化收窄到新请求，R1.2 并进 R1.1，文字订正；每个缺口用变异证明新用例会红，见 `Artifacts and Notes`；这一轮的提交先于 B-2 的提交。
- [x] (2026-10-01 18:06 CST) B-2 对齐：读公共规则、批次 brief、预审、账本与本计划全文，在 `55b6952` 上建基线（新文件 14 / 14，命令三见 `Artifacts and Notes` 的「计数基准」）并建备份 ref。
- [x] (2026-10-01 18:08 CST) B-2 RED：先写 8 个判别性用例（两个适配器各 4 个：三个 Unknown 注入行与工作树步失败行）并扩 harness 同时包根方法，亲眼看它们失败：14 通过 / 8 失败，6 个以注入的错误原样拒绝，2 个读到借了分支句柄的 `has_worktree`；基线探针见 `Artifacts and Notes`。
- [x] (2026-10-01 18:12 CST) B-2 GREEN：窄依赖、末步钩子、最终事务与失败结算、Unknown 映射、删除 fallback，新文件 22 / 22（当时 B-1 的修复尚未做，原有 14 个）。
- [x] (2026-10-01 18:30 CST) B-2 变异：28 个变异首轮全部被抓住，没有存活（`Artifacts and Notes` 的变异表）。
- [x] (2026-10-01 18:37 CST) 按主控要求，B-1 对抗验证的修复提交排在 B-2 之前：先把分支退回 B-1 的 head、做完修复，再在其上重建 B-2 的提交（用普通编辑重做，原提交留在备份 ref `backup/fix-start-work-b2-code-1837`）；重建后的生产代码与原提交相比只差 B-1 修复里认领失败收窄的那一行。
- [x] (2026-10-01 18:51 CST) B-2 重建后：新文件 24 / 24（先在 B-1 修复的树上重现同样的 RED：24 个里 8 个失败，原因同上），`pnpm verify` 退出 0，变异在最终树上整表重跑、28 个全部被抓住，B-1 修复的缺口用变异再证一遍，见 `Artifacts and Notes`。
- [x] (2026-10-01 19:18 CST) B-3 对齐：读公共规则、批次 brief、预审、账本与本计划全文，在 `98bb08c` 上建基线（新文件 24 / 24）并建备份 ref。
- [x] (2026-10-01 19:24 CST) B-3 RED：先写判别性用例，并在未改动的生产代码上亲眼看它们因功能缺失而红：Ready 之后的重放与读取 4 行（run 记录写失败 / ack 状态未知 / 两条关系的写入被静默丢掉）× 两个适配器，38 个里 8 个失败——run 记录写失败时 `startWork` 以注入的错误拒绝，ack 状态未知时首次报 saved，关系写入被丢掉时同 key 重放报 saved、`confirmed`、`degraded=false`；其余 30 个（含完整正控、重放先于预检、租约内在途三个回归守卫）为绿。
- [x] (2026-10-01 19:26 CST) B-3 GREEN：`readyGap`（`execution-context.ts`，命令的重放与 Query 共用）、`existingResult` 的完整性守卫、run 记录写失败与 ack 状态未知转带 run 句柄的 Unknown；`pnpm verify` 退出 0。
- [x] (2026-10-01 19:44 CST) B-3 变异：26 个变异在 B-3 的代码提交（`b230a73`）上整表重跑，全部被新用例抓住、无存活，还原后树干净；对抗验证的修复轮之后在最终代码提交 `ebc6c11` 上又整表重跑（20:35 CST，26 + 12 个，仍全部被抓住），见 `Artifacts and Notes`。
- [x] (2026-10-01 19:46 CST) B-3 产品证据：`docs/product/vertical-path.md` 第 6、7 行与探针 P3、P4、X1 已更新；被引用的 25 个用例前缀逐个读回，全部解析并通过，伪造前缀读回 `ℹ tests 0`。
- [x] (2026-10-01 19:48 CST) 技术债登记：`docs/exec-plan/tech-debt-tracker.md` 追加 TD-005 至 TD-008，既有行零改动。
- [x] (2026-10-01 20:23 CST) 主控恢复后接手：读 B-2 对抗验证报告（verify-b2，被验 `98bb08c`，无 P0 / P1，三处 P2）与四个补丁，在 `12212a1`（工作树干净）上建基线与备份 ref，落实验证结论并完成本计划的证据回填。
- [x] (2026-10-01 20:27 CST) 缺口用例（补丁 1、2、4，提交 `test(core): 补 B-2 的事务提交点与租约判别性缺口`）：先在补丁之前的树上跑 B18 / B20 / B22 / B40 / X1 / Y2 六个变异，全部存活（三组用例 0 红），R56 红 1；应用补丁（`git apply --check` 通过）后各红 2 / 2 / 10 / 2 / 1 / 1，R56 仍红 1，全量 975 / 975。
- [x] (2026-10-01 20:29 CST) 失败结算 Unknown 的文案（P3①，提交 `fix(core): 失败结算 Unknown 的文案按事实陈述`）：先写两条用例并看它们红（文案恒称已 ack、provider 的原始失败被盖掉），再最小实现，新文件 48 / 48；Q1 – Q5 五个变异各被抓住。
- [x] (2026-10-01 20:40 CST) 技术债登记：`docs/exec-plan/tech-debt-tracker.md` 追加 TD-009 至 TD-011（读谱系「修复」Unknown 的半提交，补丁 3 在 B 的文件集之外、需人类裁决、未应用；事务回调里误用根 Storage；`localWrite` 把闭包内任何抛出当本地写失败），既有行零改动。
- [x] (2026-10-01 20:55 CST) 本计划的证据回填（交接项的六条全部完成）：`Global Constraints` 的文件表按实测，`Plan of Work` 的 B-3 就地 Superseded，`Surprises & Discoveries`、`Decision Log`、`Artifacts and Notes`（含 B-3 的 26 个变异与修复轮 12 个变异的整表）、`Idempotence and Recovery`、`Interfaces and Dependencies`、`Outcomes & Retrospective`、`Concrete Steps`、`Bottom Change Note`；顶部状态改为 `Active；实现与验证完成，待人类评审`。
- [x] (2026-10-01 21:26 CST) 终局对抗验证（verify-b3，BASE `98bb08c` → HEAD `dee1d5f`，PASS_WITH_FINDINGS，无 P0 / P1，三处 P2）：读报告，在 `dee1d5f`（工作树干净）上建基线。
- [x] (2026-10-01 21:30 CST) 先写用例并看它们红（生产代码未改）：重放的 failed / provisioning 两行与接管的 unknown 一行 × 两个适配器，54 个里 6 个失败，其余 48 个为绿（Q6 的断言在现有实现上本来通过，价值在杀变异）。
- [x] (2026-10-01 21:32 CST) 最小实现（提交 `fix(core): 重放与接管不再把非 Ready 或未知运行报成 Saved`）：重放的守卫改写原行（supplied 为 Saved 而记录不是 Ready 时用记录自己的报告）、接管时已有的 run 为 unknown 报 Unknown、run 状态未知的文案改用 `unknownRun`；54 / 54，全量 983 / 983。
- [x] (2026-10-01 21:34 CST) 变异证明：N1 – N10 与 Q6，只有 N8（已有 run 不是 running 就报 Unknown）起初存活——接管用例只有 unknown 一行；改成表驱动（unknown / failed 两行）后被抓住，提交 `test(core): 钉住接管时主执行 ack 为 failed 的运行仍是已确认的运行`；56 / 56。
- [x] (2026-10-01 21:48 CST) 文档订正与技术债：`tests/integration/README.md` 的注入点行与新增行，TD-005（三个模块的强连通分量）、TD-006（`startExecution` 的 `existing` 分支已修）、TD-009（补丁内容写进文字，不引用运行态路径）订正，追加 TD-012（Ready 之后的启动窗口）与 TD-013（controller 缺 `runExternalId`），本计划的 Surprises、Decision Log、Idempotence and Recovery、Outcomes 与 Artifacts 补终局对抗验证的内容。
- [x] (2026-10-01 21:56 CST) 独立验收对齐（accept-b）：读 brief、账本、三份对抗验证报告、本计划全文与 `a93d572..271e497` 的全部改动；在 `271e497`（工作树干净）上第一手跑命令一至三、typecheck、boundaries，`pnpm verify` 连跑 3 次，见 `Artifacts and Notes` 的「独立验收证据」。
- [x] (2026-10-01 22:05 CST) 逐提交为绿：A 的 `a93d572` 与 B 的 22 个提交逐个在一次性检出上跑 30 文件组、typecheck、`pnpm verify` 与两条文档契约，全部为绿，含终局小修里没有单独跑全套的 `8bd80e0`。
- [x] (2026-10-01 22:08 CST) 验证者发现的关闭复现：在 `271e497` 的副本上，每个变异先用 `git diff -U0` 证明生效，verify-b1、verify-b2 的缺口变异与终局小修的 N1 – N10、Q6 逐个复现被抓住（N4 等价），B-3 守卫的变异复跑；verify-b3 的三个 P2 探针在干净副本上复跑与修复后的预期一致。
- [x] (2026-10-01 22:11 CST) 四路径一致性扫描（首次、同 key 重放、新 key 接管、Query）找到接管路径上终局对抗验证 P2-3 的同类遗漏（`Surprises & Discoveries`）：先写用例并看它红（60 个里 6 个失败，都是功能缺失），再最小实现，60 / 60，10 个变异全部被抓住；提交 `fix(core): 接管时已有的 run 在两条分支上与重放、Query 同一个答案`。
- [x] (2026-10-01 22:25 CST) 文档：本计划的验收回填（裁决、交接事实、证据）、`tests/integration/README.md` 的接管一行、TD-006 就地订正、追加 TD-014、`docs/README.md` 的索引行状态。
- [x] (2026-10-01 23:11 CST) 独立复评（verify-b4，Sonnet，被验 `0dcd129`，BASE `271e497` → HEAD `569d759`）：PASS_WITH_FINDINGS，无 P0 / P1 / P2、六条 P3；35 个变异杀 32、活 3（M11、O10、O13）；四路径扫描 140 个世界 × 2 个存储，`271e497` 不一致 78，`569d759` 剩 44（候选边，TD-014）。
- [x] (2026-10-01 23:16 CST) 复评小修对齐：读复评报告，在 `569d759`（工作树干净）上建基线——新文件 60 / 60、`tests/e2e/start-work.test.js` 7 / 7，补强前的变异 O14 / O10 / M11 / O13 / O13b 红数 1 / 0 / 0 / 0 / 0（O14 只被一条无关用例抓住）。
- [x] (2026-10-01 23:19 CST) 发现 1 – 4 的用例补强（提交 `test(core): 补接管与降级路径的判别性缺口`）：接管结果面补分支与工作树句柄、两条文案正则各钉住原因、并发写入的 run 记录不被降级覆盖（一条 × 两个适配器）、e2e 降级首次结果的错误码；新文件 62 / 62，补强后 O14 / O10 / M11 / O13 / O13b 红 8 / 2 / 1 / 4 / 4。
- [x] (2026-10-01 23:21 CST) 发现 6：缺口文案补分隔（提交 `fix(core): gap 文案补分隔`）：先写格式断言并看它红（10 个，五个有缺口的世界 × 两个适配器，生产代码未改），再把缺口描述放进全角括号；62 / 62，去掉分隔与丢掉缺口描述的变异各红 10。没有既有断言依赖旧文案。
- [x] (2026-10-01 23:29 CST) 文档（发现 5 与附注）：本计划订正扫描范围、提交计数、TD-005 终裁的累计数与验收附注①，补独立复评的记录与小修证据；TD-006 的「约 3 行」就地订正；`tests/integration/README.md` 与 `docs/README.md` 的索引行同步。
- [x] (2026-10-02 CST) 第一轮 MVP 评审（review 5391344982：4 条 P2、16 条 P3，无 P0 / P1）并获批准（review 5391435733）。按意见修复：Ready 的工作树一时读不到不改判 Failed；`startRun` 结果不确定记 unknown、报 Unknown；工作树步结果不确定时对账；绑定 id 变化的冲突文案点名成因并加用例（TD-015）；ui-model 的开始工作补两个读门；003 自检补 repository 主键；TD-004、TD-013 解决，TD-010 加测试超时；测试缺口（替身父边的非 active 状态、tracks 候选）补齐；文档订正（TD-009 裁决、TD-008 补登、vertical-path 基线与限定、#192 改 Closes、prelaunch 计划的探针选取器）。证据见 `Artifacts and Notes` 的「评审修订证据」。
- [x] (2026-10-02 CST) 修复复评（独立 agent，被验整理后的 head）：无 P0 / P1，1 条 P2、5 条 P3 与几处部分修复；按 Decision Log「采纳修复复评」修订，证据见 `Artifacts and Notes` 的「复评修订证据」。
- [x] (2026-10-02 CST) 第二轮修复复评（独立 agent，被验 `86d7e69`）：无 P0 / P1 / P2，4 条 P3 与 2 处 nit，全部修复（Decision Log「采纳第二轮修复复评」），证据见 `Artifacts and Notes` 的「第二轮复评修订证据」。
- [x] (2026-10-02 CST) 提交整理为可独立回滚的交付物并变基到新的 #251（栈底同样整理并变基到 `main@df199a5`）；人类授权 ready 与 rebase merge（`merge_method=rebase`），本计划随本 PR 移入 `docs/exec-plan/completed/`。

## Surprises & Discoveries

三份独立探针/主控复跑都证明，SQL FK完整与业务完整是两回事。首次repo FK阻止外部write，预种repo后却在外部成功与账本/run之间失败，重放绕开修复返回健康Saved；因此#188不应先单独合入演示成功。

独立评审发现设计B的全局fake关系FK建议会让delivery写者未登记的commit/CR等报错，风险外溢至#221；采纳设计A的本路径直接实体读回，保留显式通用分叉。Repository mount的复合scope已有context FK支撑，007无须改请求定位或派生ID。

当前markUnknown对Confirmed输入无效；本地ack后失败必须显式构造Unknown报告。另发现RepositoryRead能力新门与`start-work-retry-identity`的一条旧前提冲突，以及local-git core fixture裸工作项；实施预算已包括有判别力的前提修正，不能只改生产入口后忽略旧suite。

磁盘最终审读发现MutationAttemptRecord没有contextId/请求指纹，原“new key读取该context的Git账本”不可实现；已在Design、批次与矩阵就地删除该承诺。same-key只核验命中的报告；new-key命令可以读回工作树，Query仅检查本地边/run，避免借完整性守卫带入#194/#204或新的Query同步写者。

预审（2026-10-01，只读，在本分支 `b07fbe9` 的树上）补出原计划漏列的三处 P1。其一，8 个旧文件里共 36 个用例用 `find((view) => view.kind === 'work_item')` 取工作项（start-work 6、start-work-recovery 1、write-machine 2、delivery-lineage 4、status-policy 1、retry-identity 9、step-recording 10、mvp0 chain 3）；默认种子里 `kind` 为 `work_item` 的条目有四个，其中 `issue-3` 的内容是 redacted（另有变更请求 `pr-7`），而 `listPlanningItems()` 的顺序随机，所以预检对它答 `unavailable` 之后，这些用例几乎每次都会随机变红。观察 2026-10-01 17:32 CST @ `b07fbe9`，在检出根运行下面一条（400 次抽样，首个 `kind` 为 `work_item` 的条目是 redacted 的次数；期望约 100，预审抽样 2000 次为 24.6%，本次为 95）：

    node --input-type=module -e "import { composeCore } from '@harness-projects/core'; import { createFakeProviders } from '@harness-projects/provider-fake'; let n = 0; for (let i = 0; i < 400; i += 1) { const core = await composeCore({ workspace: { name: 'p' }, providers: createFakeProviders() }); if ((await core.queries.listPlanningItems()).find((v) => v.kind === 'work_item').content.contentKind === 'redacted') n += 1 } console.log(n)"

其二，`tests/integration/human-execution-provider.test.js` 的 8 个用例全部用裸 ID（`wi-manual-1` 等 9 个），原计划只点名一部分。其三，若 ack 在 resume 路径也调 `getRepository`，local-git 的 R1 必红：`packages/providers/development-local-git/src/provider.ts` 的 `getRepository` 在默认分支没有注入时会发出 `symbolic-ref`，而 `tests/integration/README.md` 把「重试期间的 Git argv 里没有 `symbolic-ref`」写成契约；预审在原型上验证，ack-always 时 R2 / R3 也红（能力失败返回没有 context 的结构化失败，正是原计划要避免的），而只对没有 context 记录的新请求做预检、能力门与 ack 时，R1 – R3 的断言零改动全绿，因此裁决为 Decision Log「预检、能力门与 ack 只对新请求运行」。

预审的 P2 发现：加 `getEntity` 会让 `packages/capabilities/src/registry.ts` 的 `StorageSurface` 精确成员锁在 `tsc` 报 TS2344，原文件表漏了它；新主键下 `ON CONFLICT (id)` 非法，复合主键还允许 NULL，`ON CONFLICT (workspace_id, id) DO NOTHING` 对「同键换身份」是静默忽略。观察 2026-10-01 17:32 CST（Node 内置 SQLite，内存库，复合主键 `(workspace_id, id)` 外加 `UNIQUE (workspace_id, 身份)`）：`ON CONFLICT (id)` 报 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`；`id` 未声明 `NOT NULL` 时复合主键接受 `NULL`；同键异身份的插入 `changes` 为 0 且不报错；同身份异 id 报 `UNIQUE constraint failed`。因此 003 写 `id TEXT NOT NULL`，`putRepository` 先比对已有行再写。

读谱系会写关系：预审实测对「Provisioning + 已记录工作树句柄」的 context，一次 `getDeliveryLineage` 把 relations 从 0 条写到 2 条（confirmed 的 tracks 与 has_worktree），因为 `chain-facts.ts` 以记录里的 `worktreeExternalId` 判定「已观察到」，`delivery.ts` 的 `getDeliveryProjection` 再对已观察的跳调用 `recordEdges`。后果有两个：B-1 必须在写前事务里登记 context 与 reserved worktree 实体，否则 SQLite 上读谱系抛外键错误；B-2 把 Ready 推迟到 final 之后，final 失败留下的 Provisioning + 句柄会被一次读谱系「修复」，所以断言 relations=[] 之前不得读谱系。

预算：预审按 D10 订正后的文件集实估约 795（±60），主要超支在 `start-work-sqlite-registration.test.js`（原估 200，实估约 330）与 `start-work.ts`（原估 140，实估约 185）；采纳「不新增 getEntity」「只对新请求预检」「prepared 取最小」后约 720，本计划的文件表按此重算为 730。

旧库探针（一次性，2026-10-01 17:47 CST，检出 `fix/start-work-sqlite-prerequisites` 的工作树根，新代码）：把 `git show cec5264:packages/storage/sqlite/migrations/003_control_facts.sql`（旧 003，本批起点上与它逐字相同）连同其余迁移文件复制到仓库外的临时目录，用 `migrate(db, { dir: <临时目录> })` 建旧库文件（返回 `{"applied":[1,2,3,4,5],"version":5}`，库内 `repository` 是 `id TEXT PRIMARY KEY`），再用新代码 `createSqliteStorage(<库文件>)` 打开并经端口写仓库挂载。观察：同工作区首次登记 `(ws-1, repo-alpha)` 成功，同值重复登记成功（no-op）；第二个工作区挂同一个 id 被拒绝，错误文本 `UNIQUE constraint failed: repository.id`；ws-1 的挂载原样保留，ws-2 没有挂载。与 D10 一致：旧开发库的失效方式是响亮的而不是静默分叉，处置为删库重建。

变异实验发现门表里 `DevelopmentWorktreeCreate` 一项与随后的 `resolveWriteTarget` 重复：去掉它 206 个用例仍全绿（M07，等价变异体）。`resolveWriteTarget` 对同一个键做同样的写门检查并返回同样的错误，「工作树创建只读」一行仍被它挡住，所以门表只留分支创建的写门与仓库读、工作树读两个读门。

对抗验证（verify-b1，2026-10-01，B-1 head `55b6952`）有效变异 66 个，57 个被抓住，9 个存活，其中 7 个是用例缺口：①预检的身份查找种类写成 branch 时，每个已挂载仓库的第二次开始工作都会被当成挂载冲突，而全套仍全绿——首个工作项的用例看不见它；②把登记移出认领事务、先于它单独提交，只注入 `putRepository` 的写前事务用例判别不到；③门表把仓库读误写成写门，只读的读能力被误拒，没有用例；④canonical 身份的角色写成 alias 没有断言；⑤SQLite 先比对的读与替身的 mounts 都漏了按工作区限定，原契约用例的两个工作区挂的是同一个外部身份，错读到另一个工作区的行也恰好相等；⑥替身 `putExecutionContext` 的仓库父边漏了按工作区限定，原悬空用例用的是任何工作区都没有的 id。另两个存活是取舍而非缺口：认领失败转结构化的范围（本轮收窄到新请求），以及 `ledger.replay` 与预检的顺序（等价变异体）。

B-2 的事实（2026-10-01）：①基线上本地写失败的形态比「调用方拿到拒绝」更糟——对根 Storage 的 `putMutationAttempt` 注入写后失败，`startWork` 以注入的错误拒绝，库里已是 `ready`、两条 confirmed 关系与 `saved` 的 attempt，context 对应的 run 却没有记录（观察 2026-10-01 18:10 CST，生产代码同 `55b6952`，替身与 SQLite 相同）；B-2 之后同一场景返回 Unknown，库里是 Provisioning、无关系、无 attempt（回读命令见 `Artifacts and Notes`）。②三个注入点在无故障时的调用次数不同：`putMutationAttempt` 1 次、`putRelation` 2 次、`putExecutionContext` 4 次（认领 1、两步回填 2、最终 1），所以「第 2 次 `putExecutionContext`」就是分支步的回填写，各行的无故障正控断言各自的总次数。③事务里误用根 Storage 在两个适配器上都不会静默通过，但形态不同：SQLite 在入口以作用域标记拒绝，返回结构化失败；替身把根上的写排在进行中的事务之后，于是死锁，测试挂住直到 `--test-timeout` 把它判为取消（变异 M46 – M48）。④没有任何既有用例断言「工作树步之后即 Ready」：`provisionGit` 的钩子只有 `start-work.ts` 一个调用方，其余用例直接调用时用默认的空钩子，所以 brief 预期可能要改的旧前提实测为 0 处，没有放宽任何旧断言。

B-3 的事实（2026-10-01，检出 `fix/start-work-sqlite-prerequisites`）：①预审写的「注入 `putExecutionRun` 第 1 次（根方法）→ 本地无 run」按 `injectAfterWrite` 的语义做不到：根方法的写后失败会把 run 留在库里，之后的重放读到它就报 Saved，与预期相反；「本地无 run」要用写不进去的形态（`injectLostWrite`，抛错且不落库）。②历史残缺的 Ready 不必手工播种：run 记录写不进去、ack 的状态不是已知取值、事务里的关系写入被静默丢掉或降成候选，都能经真实的开始工作产生同样的状态；用例世界因此全是真实流程加故障注入，预审设想的手工播种表要直接写端口、绕过适配器的外键约束，约多 15 行。③既有用例钉不住新守卫的两个方向：「主执行 ack 为 failed」的既有用例只断言运行记录与 fallback 字段、不断言 `degraded` / `confirmed`，把 failed 的运行也当缺口的变异（E11）原先全套仍绿；在途的既有用例只断言「不是 Saved」，Unknown 也满足它，守卫误伤 Provisioning 的变异（S3）与 Query 对任何状态都算缺口的变异（E8）原先同样抓不住——新用例分别断言 Saved / `degraded=false` 与 `pending`（命令与 Query 都不判）。④`readExecutionContext` 为取 `worktreeEntityId` 引用了 `chain-facts.ts`，而后者引用前者：运行时循环 import，今天安全（双方只在函数体里互相调用，`pnpm verify` 全绿），TD-005。⑤Query 的完整性要读回整个工作区的关系（端口没有按端点读关系的方法），TD-007。⑥`docs/product/vertical-path.md` 的旧选取器会随机命中内容被扣下的 `issue-3`：X1 在新代码上的输出随之随机（命中它时，仓库不存在报 `unavailable` 而不是 `not_found`），P3、P4 不受影响；新选取器上各跑 6 次输出一致。同一份文档里另有两处在该检出上已过期的陈述（第 1 行、第 13.3 行），TD-008。⑦`ledger.replay` 与预检的顺序单独对调仍是等价变异体（同一请求已有 context，两种顺序都不预检）；会改变结果的是「对已有记录也预检」，变异 S14 抓住它，同 key 重放先于预检的用例是它的回归守卫。⑧Failed 的接管路径下若 run 记录缺失（run 的 ack 之后本地写失败，随后工作树消失被判 Failed），换新 key 的接管会再起一个 run；这是 #193 的外部执行恢复范围，登记在 TD-006。

B-2 对抗验证（verify-b2，被验 `98bb08c`，65 个行为变异杀 55、活 10，其中 6 个是真缺口）的发现：P2-1「同一个事务」的判别证明有洞——「注入最后一写、其余回滚」只证明被注入那一写之前的写在同一个事务里，证明不了事务之后才发生的写（B18 把 context 的 Ready 写挪到提交之后、B20 工作树步回填失败时结果面丢句柄、B22 Ready 保留租约、B40 吞掉末步回填的写失败，全套仍绿）；P2-2 对抗验证修复把挂载契约的悬空仓库一格改成「只挂在另一个工作区」，覆盖被互换而不是叠加（替身仓库父边只查工作区、不查仓库 id 的 X1，与同身份换 id 的检查不按工作区过滤的 Y2 存活）；P2-3 读谱系会把 Unknown 的半提交「修复」成 confirmed 边（计划已知，TD-009）；P3 失败结算 Unknown 的文案恒称已 ack、且丢掉 provider 的原始失败；事务回调里误用根 Storage 在替身上静默死锁、`tsc` 与脚本都拦不住（TD-010）；`localWrite` 把闭包内任何抛出当本地写失败（TD-011）。前两条与文案已修，见 Decision Log。

终局对抗验证（verify-b3，BASE `98bb08c` → HEAD `dee1d5f`，62 个变异杀 56、活 6：3 个等价、1 个按裁决接受、2 个测试缺口）的发现：P2-1 `settle` 提交 Ready 之后、`startRun` 返回之前的窗口里，同 key 重试、新 key 与 Query 得到 Unknown / `degraded`——B-3 新增的行为，对照 `98bb08c` 同一窗口里给的是过早的 saved，保守且诚实但没有「在途」语义，TD-012；P2-2 完整性守卫只管 Ready：同 key 的 saved attempt 遇到 Failed / Provisioning 的记录时原样返回 Saved（第一次重放 `failed`、第二次 `saved`；对抗验证对状态 × run × 边 × attempt 192 种组合的扫描里，Ready 的 48 种全部正确，非 Ready 且 attempt 为 saved 的 36 种都报 Saved，`98bb08c` 上相同，所以是既有、相邻的缺口，与 B 要消灭的「健康 Saved 谎言」同类）；P2-3 接管路径上 `startExecution` 见到已有的 run 记录就直接返回，run 为 unknown 时报 Saved、下一次调用才回到 Unknown；P3：失败结算 Unknown 的「原始失败」后缀没有断言（变异 Q6，所有 Unknown 用例只断言错误码）、run 状态未知的文案沿用「本地结算失败」、`makeRelation` 是未用导入、`tests/integration/README.md` 的「三个注入点」过期且缺文案行、controller 的 `StartWorkView` 没有 `runExternalId`（TD-013）、循环 import 实为三个模块的强连通分量（TD-005 订正）、TD-009 引用了运行态路径（改成自包含）。没有既有用例断言 run 状态未知的旧文案（只断言错误码），所以文案改写不需要更新任何旧断言。另：对抗验证的变异 D4（「Ready + 缺口 + 工作树已消失」先验证工作树还是先判守卫）无用例钉住，它是 TD-006「Failed 接管后缺 run 记录会再起第二个 run」的入口，不改变本轮结论。本轮自己的发现：接管用例起初只有 unknown 一行，「已有 run 不是 running 就报 Unknown」这一放宽的变异（N8）存活，补了 failed 一行（主执行 ack 的 failed 是已确认的运行，接管仍报 Saved）。

独立验收（accept-b，被验 `271e497`，2026-10-01）的四路径一致性扫描：在替身上直接播种记录状态（Ready / Failed / 租约内在途 / 租约过期的 Provisioning）× run（无 / running / 主执行 ack 的 failed / unknown / 人工降级的 running / 人工降级的 failed）× 边（完整 / 缺 tracks / 缺 has_worktree / has_worktree 只是候选）× 同 key 的 attempt（saved / failed / unknown / pending / 无）共 480 种组合，每种依次调同 key、新 key、新 key 的重放、第二个新 key 与 Query，比对各条路径的答案。Ready 与租约内在途两类全部一致；不一致的 170 种全在接管与续跑（Failed、租约过期）上，来自接管遇到已有 run 的两条分支：①主执行不可用时接管走 `manualFallback`，已有 run 为 unknown 仍报 `saved / confirmed / degraded=false`，它自己的重放与 Query 却是 Unknown / `degraded`——与终局对抗验证的 P2-3 同类，P2-3 只修了 `startExecution` 那一条；②主执行可用时接管走 `startExecution`，已有 run 是人工降级时报 `degraded=false`、不带 `fallback`，已有 run 正常时不带 run 句柄，而重放与 Query 都如实给出。①②都在替身与 SQLite 上用真实流程复现（主执行 ack 的状态未知、或主执行起不来只落了人工降级，之后记录被判 Failed，换新 key 接管；①在同一 Storage 上重组一个主执行不可用的 core）。修复之后在这 480 种里剩下 46 种，全是「has_worktree 只是候选」（这 480 种的边只有「完整 / 缺 tracks / 缺 has_worktree / has_worktree 只是候选」四档，没有 tracks 候选，所以这句只对这 480 种成立）：`recordEdges` 只写缺失的边、不升级已有的候选，接管后的 Ready 缺 confirmed 的 tracks 或 has_worktree，接管却答 Saved；verify-b4 另用 140 个真实流程世界扫同样的四条路径（状态 × 已有 run × 主执行可用性 × 边，边含 tracks 与 has_worktree 只是候选），修复之后剩下 44 种（has_worktree 候选 20、tracks 候选 24），所以机制的范围是「tracks 或 has_worktree 只是候选」；今天没有生产写者会写这类候选，登记 TD-014（它写的就是这个范围）。另：verify-b3 的 D4（「Ready 有缺口且工作树已消失」先读回工作树判 Failed，还是先判守卫报 Unknown）仍存活，它是 TD-006「Failed 接管时 run 记录缺失会再起一个 run」的入口；把守卫挪到读回之前（移动 3 行、再给读回加一个 `gap === undefined` 的条件，+4 / −4，规模口径 8）就能堵住这个入口，代价是这类上下文一直停在 Unknown、直到 #193 提供对账——这是活性与安全的取舍，不在验收里改，写进 TD-006 的下一步。

独立复评（verify-b4，Sonnet，被验 `0dcd129`，BASE `271e497` → HEAD `569d759`，PASS_WITH_FINDINGS，无 P0 / P1 / P2、六条 P3）的发现：`existingRun` 的行为正确——两条分支与重放、Query 在 140 个真实流程世界 × 2 个存储上一致，唯一的残余是候选边（TD-014，描述准确、今天不可达）。35 个变异杀 32、活 3，都是测试缺口：①接管用例的结果面不含分支与工作树句柄，`existingRun` 两个分支丢掉它们的变异（O14）只被一条无关的老用例抓住；②`manualFallback` 在主执行 `startRun` 失败之后的二次已有 run 检查没有用例钉住（O10：把检查提到 `startExecution` 开头、删掉这一处——顺序场景下等价，并发的写者在主执行 `startRun` 里先落一条 run 记录再失败时，现行代码保留并如实带回它，备选会用 failed 的降级记录覆盖它；Decision Log 正是以此否决备选，原先却只靠文字守着）；③降级首次结果的 `error` 没有断言（既有缺口，非本次引入；M11：`manualFallback` 末端的失败返回误走 `existingRun`，丢掉主执行的错误）；④文案正则 `/^运行状态未知/` 不钉原因（O13，首次路径同类）。以上四条都已用用例补强，变异证明见 `Artifacts and Notes` 的「复评之后的小修证据」。⑤文档精度：扫描范围（见上）、`start-work.ts` 的代码提交数（6 个应为 7 个）、TD-006 的「约 3 行」（实为移动 3 行加改 1 行，+4 / −4，规模口径 8）、TD-005 终裁的累计数（约 817 是毛值，净值约 810）、验收附注①，都在本轮订正。⑥范围外（B-3 的 `b230a73`）：缺口文案缺分隔，输出成「已 ready 的上下文run 状态未知」，已补全角括号；没有既有用例断言过缺口文案，所以不需要更新旧断言。

## Decision Log

Decision：采用设计A B1的007与原子登记/完成，加入设计B B1的getEntity、run未知与Query守卫；拒绝保留global mount的Conflict缩小版与公共prepareRepository。Rationale：既有复合FK/稳定locator支持正确scope，最小闭环仍在core/storage，避免公共调用链迁移。Date/Author：2026-10-01 13:10 CST / 独立评审者。Superseded in part by Decision Log「按 D10 订正」「不新增 getEntity」（2026-10-01，见下文新决策）：007 与 getEntity 两处作废，其余（工作区挂载、原子登记 / 完成、run 未知与 Query 守卫）保留。

Decision：只收紧fake repository父边，不全局收紧relation。Rationale：本路径父实体用两adapter读回证明；其它关系写者由#221负责，未知workItem adapter错误由#196负责。Date/Author：2026-10-01 13:10 CST / 独立评审者。

Decision（#192 部分 Superseded by 第一轮 MVP 评审，2026-10-02：#192 的两条验收由本 PR 满足，改为 Closes）：Refs #192仅has_worktree ack必要辅改，Refs #193只暴露未知/残缺，不自动恢复run；不关闭未选issue。Rationale：端点登记不能制造Provider事实，run创建无法与SQLite原子提交；诚实Unknown是本轮安全出口。Date/Author：2026-10-01 13:10 CST / 独立评审者。

Decision：本次已授权spec/plan与draft持续完成，产品实施等待人类设计评审；不写Status/原生blocking。Rationale：具体可审阅草案是后续实施批准的输入，工程stack不替代规划权限。Date/Author：2026-10-01 13:10 CST / 主控授权、独立评审记录。Superseded in part by 下文第一条新决策（2026-10-01）：设计评审门已开启；不写 Status / 原生 blocking 的部分保留。

Decision：不引入context→mutation_attempt关联字段，也不由workspace账本推断归属；new-key命令与Query使用各自真实可取得的证据。Rationale：当前端口没有该关联，本轮局部#187反例由边/run守卫足以阻断，命令协议仍留#194/#204；Query保持本地纯读。Date/Author：2026-10-01 15:24 CST / 独立评审者。

Decision：人类伙伴 2026-10-01 在会话中指示按本 spec/plan 实施，视为设计评审门已开启。Rationale：该门的唯一目的是让人类接受设计，指令本身即接受。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：按控制计划 D10 订正——不追加 007，原位修改 003 的 repository 主键为 (workspace_id, id) 并要求 id NOT NULL，取消 Migration.rebuild 复用、repository-workspace-migration、旧库升级测试与备份恢复流程。Rationale：①D10（`docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`）与 003 文件头明确首次 MVP 发布前不承担迁移与兼容成本；②SQLite 上 Start Work 从未成功（#187 / #188），库中不存在 repository 行与执行上下文，没有被保护的真实数据；③这些专为旧库的内容约 146 行；④旧库在首次跨 workspace 同 id 挂载时由旧主键拒绝（响亮、非静默），处置为删库重建；⑤同类工具（SQLite 官方 12 步重建、Alembic batch、Prisma RedefineTables）的重建机制都是为已发布 schema 准备的，首发前通行做法是重置基线，出处链接见 `docs/exec-plan/completed/2026-10-01-repository-identity-contract.md` 的 Decision Log 同名决策。Cost if wrong：需要保留旧库升级时，追加 007，并补上 A 同样按 D10 取消的 006 与受控 rebuild runner（B 约 146 行，加 A 的约 500 行），本批的挂载语义、核心逻辑与测试不返工。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：fixture 前提更新（显式登记工作项、选取器只取可操作条目）先于新守卫落地，作为独立提交，在无守卫的基线上为绿。Rationale：预审实测 36 个用例的「首个 work_item」选取器 24.6% 概率命中 redacted 条目（`issue-3`），守卫落地后整套随机红；human-execution 8 / 8 个用例用裸 ID；先让改动变容易，守卫才能 RED → GREEN 且每个提交为绿。Cost if wrong：回退该提交即可，没有生产代码依赖。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：不新增 getEntity 端口方法；工作项预检用工作区作用域的 getPlanningProjection（缺失 → NotFound、change_request → InvalidInput、redacted → Unavailable）。Rationale：投影是「可操作内容」的权威来源，getEntity 只多防「实体与投影不一致」这种 core 造不出来的状态，却要改端口、registry 的 StorageSurface 锁、两个适配器与共享契约（约 40 行）。Cost if wrong：将来需要 entity 种类防御时再加 getEntity，是加法，不返工。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：工作项预检、能力门与 getRepository ack 只对没有 context 记录的新请求运行；已有记录走原 claimContext 路径。Rationale：ack 的目的是在登记新仓库挂载之前校验身份，已有记录意味着已校验过；对 resume 也 ack 会破坏 local-git R1 的「重试期间没有 symbolic-ref」契约（`tests/integration/README.md`），并让 R2 / R3 返回没有 context 的 startWorkUnavailable（预审实测）。新请求因此在任何写入之前失败且不创建 context，这是对原行为（能力失败也落一条 Failed context）的有意改变。ack 要求请求里的仓库定位是规范定位，与 ADR-0001（`external_id` 存平台全局 node id）一致。Cost if wrong：若要在 resume 路径也复判，加一个只读的 ack 步骤，不改存储。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：保留写前登记 context 与 reserved worktree 实体，不延后到 final 事务。Rationale：getDeliveryLineage 对「Provisioning + 已记录工作树句柄」的 context 会写谱系边；实体未登记时 SQLite 上一次读谱系即抛外键错误，读路径不得因写路径的中间态抛错。Cost if wrong：约多 12 行，可在后续把登记并入 final 事务并给读路径加防御。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：prepared 取最小：同一个 Development provider 实例（`CoreProviderTable.development` 单槽），只含 binding id；ack 读到的 `defaultBranch` 不透传，仅当某个测试需要时才加参数。Rationale：不为「计划里写了 prepared」而加形状；单槽使「同一 binding」由构造保证。Cost if wrong：需要避免二次 `getRepository` 时加一个可选参数，不改公共 Request / Query。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：范围与规模闸：B-1 / B-2 / B-3 保持同一 PR，每批后核对相对 A 的累计 code 行数，超 800 停止重定闭环；退路 T0 是只保留 B-1（已满足 #187 / #188 的字面关闭条件）。Rationale：用户指令按本计划实施；预审实测 B-1 对应的最小实现约 70 行代码即可让 SQLite 空库全链路闭环，B-2 / B-3 是同一不变量（外部 ack 后本地失败不得显示 Saved）在失败窗口上的加固。Cost if wrong：超规模时把 B-2 / B-3 拆为栈上层 PR（栈深仍 ≤3），需要新建 issue。Date/Author：2026-10-01 17:33 CST / 主控（Claude）。

Decision：fake 的 `putExecutionContext` 仓库父边与分叉格翻转，并入 core 写前登记的提交（B-1 提交 4），不放进挂载契约提交（提交 3）。Rationale：core 登记仓库之前，fake 一旦要求仓库父边，fake 上所有 `startWork` 用例都会失败，违反「每个提交在其树上为绿」；翻转与 fake 实现、core 登记同一个提交，三者互为因果。Cost if wrong：若主控要求 fake 父边先于 core 登记，把提交顺序改成先 core 登记、后 fake 父边与分叉格翻转即可，内容不变（core 登记先落地时 fake 仍接受悬空，提交同样为绿）。Date/Author：2026-10-01 17:33 CST / 实施者（Claude，dev-b1）。

Decision：`namesProblem` 移入请求校验，退化的工作项 id 在预检之前得到 `invalid_input`，不落任何行。Rationale：工作项预检会对未登记的退化 id 先答 `not_found`，使 `start-work-step-recording` 的「退化 id 被拒」用例的 `invalid_input` 断言变红；输入形状错误应先于存在性判定，也先于 `ledger.replay`；原先的位置（`provision()` 里、claim 之后）会先落一条 Provisioning 再改成 Failed，在 SQLite 上那一条还会因工作项外键被拒。原位置随之成为不可达代码，一并删除。Cost if wrong：把检查放回 `provision()`，并让预检跳过退化 id。Date/Author：2026-10-01 17:33 CST / 实施者（Claude，dev-b1）。

Decision：挂载契约两条用例放进 `storageExecutionSuite`（执行组），台账按**增量**记：`CASE_LEDGER.execution.added` +2（10 → 12），`ADDED_CASE_COUNT` +2（17 → 19），`suites/storage.js` 里的说明加一句。Rationale：挂载是执行事实的前置，执行组在替身与 SQLite（执行组）两个适配器上都装配；放进身份地基组虽然不动台账，但那一组是 A 登记仓库身份种类的地方，挂载语义（键与冲突）是另一件事。台账数字必须按增量合并：A 的更新也改了 `storage-contract.test.js` 的装配与台账附近，重基后沿用任一边的绝对值都会盖掉另一边。Cost if wrong：改放身份地基组则台账不动，用例体原样搬过去。Date/Author：2026-10-01 17:53 CST / 实施者（Claude，dev-b1）。

Decision：`claimContext` 的任何失败（新请求的写前登记、终态接管、过期续跑）统一转结构化 Failed / `unavailable`，不只对带登记的新请求。Rationale：认领事务在任何外部写入之前，失败整笔回滚、零外部写入，各条路径的诚实性相同；只给新请求加 catch 会让同一种本地事务失败在两条路径上一个返回结构化结果、一个抛 promise 拒绝。catch 只包 claim 这一次本地调用，不含 Provider 调用，不会吞掉测试注入的进程中断。Cost if wrong：把 catch 收窄到有登记的路径，已有记录的路径恢复拒绝语义。Date/Author：2026-10-01 17:53 CST / 实施者（Claude，dev-b1）。Superseded by Decision Log「认领失败转结构化只针对新请求」（2026-10-01 18:57 CST）：转换范围收窄，下面的 Rationale 对已有记录的路径不成立。

Decision：写前准备（预检、能力门、ack、冲突预检）与写前登记写在 `start-work.ts` 里，不新建 core 模块；登记内联「查找或新建」canonical 仓库身份，不复用 `ensureEntity`。Rationale：本批文件集里没有新增 core 源文件，也没有 `identity.ts`；`ensureEntity` 只返回 entityId，挂载还要身份 id，复用它要么多一次读、要么改它的返回值（它的另一个调用者是 bootstrap）。代价：`start-work.ts` 在 B-1 后为 373 行，B-2 / B-3 会继续增长；若主控认为登记是独立职责，把 `prepareRegistration` 与 `registerParents` 原样移到新模块即可，不改行为。Cost if wrong：移动两个函数，净增行数约为 0。Date/Author：2026-10-01 17:53 CST / 实施者（Claude，dev-b1）。

Decision：core 的挂载冲突预检只检查「同工作区同 id 已挂在别的外部身份上」；「同工作区同身份另挂别的 id」不在 core 预检。Rationale：core 登记时挂载 id 恒等于请求的仓库定位（也就是身份的 externalId），后一种只可能来自绕过 core 的端口直写，由 Storage 在写入时拒绝，共享契约用例钉住。Cost if wrong：将来挂载 id 不再等于外部 id 时补这一半预检。Date/Author：2026-10-01 17:53 CST / 实施者（Claude，dev-b1）。

Decision：采纳对抗验证对 B-1 用例缺口的补充，并入 B-1 的测试：同一工作区第二个工作项在已登记的仓库上开始工作、写前事务注入参数化并加认领自己的写（`putExecutionContext`）、只读的读能力（仓库读、工作树读）不挡开始、canonical 身份角色为 primary、挂载契约在第二个工作区挂另一个外部身份、悬空仓库一格改成只挂在另一个工作区。Rationale：这些用例在现有实现上都通过，价值在杀变异——见 `Surprises & Discoveries` 的 7 个缺口，各自用变异证明新用例会红（`Artifacts and Notes`）。Cost if wrong：只删用例，生产代码不受影响。Date/Author：2026-10-01 18:57 CST / 主控裁决、实施者（Claude，dev-b2）。

Decision：认领失败转结构化 `unavailable` 只针对新请求（带写前登记的路径）；已有记录的路径（终态接管、过期续跑、在途、Ready）保持原行为，原样抛出。Rationale：统一转换的文案「没有发起任何外部写入」对续跑只对本次认领成立，此前的尝试可能已经建过分支或工作树，会误导；预检、能力门与 ack 本来就只对新请求运行（Decision Log「预检、能力门与 ack 只对新请求运行」），转换范围与它一致。续跑路径的认领失败本来就没有用例钉住，不补用例。Cost if wrong：去掉 `startWork` 里 `if (prepared === undefined) throw error` 那一行即回到统一转换。Date/Author：2026-10-01 18:57 CST / 主控裁决、实施者（Claude，dev-b2）。

Decision：不采纳对抗验证建议的「删掉 core 的挂载冲突预检，让 Storage 的拒绝经认领失败转成 `unavailable`」（省约 5 行）。Rationale：永久冲突（同工作区同 id 已挂在别的外部身份上）会被误报成可重试的 `unavailable`，是产品语义退化，5 行不值；`ledger.replay` 与预检顺序对调是等价变异体，不加用例。Cost if wrong：删掉预检，测试期望改成 `unavailable`。Date/Author：2026-10-01 18:57 CST / 主控裁决。

Decision：父行断言并入首启用例：「外部写入之前父行已提交」不再是独立用例，而是空仓库首启用例里的一组断言（同一次开始工作里包 `createBranch` 取外部写入瞬间的快照），两组断言都保留，消息分别写明属性。Rationale：两个用例搭同一份场景，各自重复装配；并后少 2 个用例（两个适配器各 1）、净少 6 行，断言一条不少——变异实验里去 context 实体、reserved worktree 实体、挂载仍被合并后的用例杀死，替身一侧只有它杀死前两者。Cost if wrong：拆回两个用例。Date/Author：2026-10-01 18:57 CST / 主控裁决、实施者（Claude，dev-b2）。

Decision：本地写失败用标记类 `LocalWriteFailed` 与显式的调用点包装 `localWrite`（步骤回填写、最终事务两处）标记，转换集中在 `startWork` 的一个 `.catch`，用 `instanceof` 判定，其余异常（Provider 的抛出、测试注入的进程中断）原样传出。标记携带最后一个已 ack 的步骤结果，`status` 是本地记录此刻的状态：回填写失败时是该步结果（Provisioning），最终事务失败时压回 Provisioning。Rationale：计划要求只在明确的本地写调用点转换；备选是（a）在钩子与最终事务里各自 try / catch 并返回结果，要把 `RecordStep` 钩子改成返回结果并让 `provisionGit` 提前返回，侵入它的控制流；（b）宽 catch，会吞掉崩溃与中断，使既有恢复用例失去意义（变异 M40 让 11 个既有用例变红）。B-3 的 `recordRun` 失败只需再包一个 `localWrite(git, …)`。Cost if wrong：改成返回结果值要动钩子签名与 `provisionGit` 两处。Date/Author：2026-10-01 18:12 CST / 实施者（Claude，dev-b2）。

Decision：步骤回填的状态由 `provisionGit` 保证恒为 Provisioning（末步交给钩子的拷贝是 Provisioning，返回值仍是 Ready），不在 `provision()` 的钩子里写死。Rationale：约束放在调用钩子的地方，钩子的调用方不会写错；返回值的 Ready 只表示外部供应完成。Cost if wrong：要让某个调用方在末步就看到 Ready 时，把这一行改回传 `done`（变异 M31 即此改动，被 4 个用例抓住）。Date/Author：2026-10-01 18:12 CST / 实施者（Claude，dev-b2）。

Decision：最终事务与 Git 失败结算共用一个 `settle` 事务：context 记录（成功 Ready、失败 Failed）、tracks、has_worktree（只在真实的工作树 ack 时）与该次 Git 的 mutation_attempt；失败结算的本地写失败同样是 Unknown，即使这次没有任何外部 ack，错误文案不声称「已 ack」。Rationale：两条路径要的是同一种原子性；失败也记 attempt 才能保持 `start-work-retry-identity` 的「同 key 不重新尝试」；没有外部 ack 时 Unknown 偏保守，但本地记录停在 Provisioning，租约过期后续跑会重走序列，不会留下错误的终态。Cost if wrong：需要区分「没有外部写入」时，在结算失败处按 `git` 是否带句柄返回 Failed / `unavailable`，约 +4 行。Date/Author：2026-10-01 18:12 CST / 实施者（Claude，dev-b2）。Superseded in part by Decision Log「失败结算 Unknown 的文案按事实陈述」（2026-10-01 20:29 CST）：「错误文案不声称已 ack」在 B-2 的实现里没有兑现（文案恒称已 ack），由那一条修复。

Decision：B-2 的测试留在 B-1 的测试文件，不提取独立的 fixture 文件（偏离 brief 的提取建议）。Rationale：提取是纯搬运，按增删之和约 90 行（装配约 43 行删、约 48 行增），占本批 150 行的 60%，不增加任何判别力；`Global Constraints` 的文件表本来就把 B-2 的测试放在同一文件。Cost if wrong：之后需要时再做一次纯重构提交，约 90 行，计入当时批次的预算。Date/Author：2026-10-01 18:08 CST / 实施者（Claude，dev-b2）。

Decision：同一个事务用回滚证明，不记事务序号：注入最后一写，其余写全部被回滚，等价于它们与它在同一个事务里。Rationale：回滚证明原子性本身，事务序号只是代理量；记序号要多约 10 行 harness。误用根 Storage 的形态由两个适配器自己拒绝或死锁（`Surprises & Discoveries` 的③），变异 M46 – M48 被抓住。Cost if wrong：需要「哪些写落在哪个事务里」的诊断时，harness 加一个按事务记录写方法名的数组，约 +6 行。Date/Author：2026-10-01 18:08 CST / 实施者（Claude，dev-b2）。

Decision：Unknown 结果面的句柄取最后已 ack 的内存值，不读回记录。Rationale：本地写失败时读回很可能同样失败；Unknown 的用途是告诉调用方哪些外部资源要对账。记录与查询面的完整性另行以记录为准（B-3）。回填写失败时记录里可能没有这一步的句柄，而结果面带着它。Cost if wrong：要求结果与记录严格同源时，读回并在读失败时退回内存值，约 +8 行。Date/Author：2026-10-01 18:12 CST / 实施者（Claude，dev-b2）。

Decision：`readyGap`（Ready 的完整性谓词：已知状态的 run 记录，加 confirmed 的 tracks 与 has_worktree）放在 `execution-context.ts`，命令的重放（`existingResult`）与 Query（`readExecutionContext`）共用这一处，并接受 `execution-context.ts` 与 `chain-facts.ts` 之间的运行时循环 import（登记 TD-005）。Rationale：谓词需要 `worktreeEntityId`（工作树实体的唯一身份定义，在 `chain-facts.ts`），而 `chain-facts.ts` 已经引用 `execution-context.ts`。备选：（a）把 `worktreeEntityId` 连同约 20 行说明下沉到 `relations.ts`，增删之和约 50 行，且要改文件集之外的 `chain-facts.ts`；（b）has_worktree 只查 `from` 不查 `to`，可达状态下等价，但弱于「只查确切两条边」；（c）让调用方传回调，是为绕开循环而绕开。循环只在函数体里互相调用、模块求值时不使用，`pnpm verify` 全绿。Cost if wrong：模块求值时使用对方的导出会得到未初始化的绑定；修法是下沉 `worktreeEntityId`（TD-005）。Date/Author：2026-10-01 19:20 CST / 实施者（Claude，dev-b3）。

Decision：Query 的 `degraded` 在 `readExecutionContext` 里与命令同源计算（Ready 有缺口即 true），不在 `queries.ts` 另算一份。Rationale：同一个事实一个出口，重放与 Query 不会给出两个答案；`queries.ts` 不在文件集内，另算还要再读一遍 run。代价是 `readChainFacts` 也经过它，每次多读一次工作区的关系（TD-007）。Cost if wrong：拆回 `queries.ts` 包装，约 +6 行且多一次读。Date/Author：2026-10-01 19:20 CST / 实施者（Claude，dev-b3）。

Decision：完整性守卫只作用于会报 Saved 的 Ready：`record.status === Ready` 且报告 `confirmed`（同 key 命中的 Saved 报告，或没有报告时 Ready 的默认报告）；同 key 命中的 Failed / Unknown 首次报告原样返回，既不被 Ready 提升、也不被守卫改写；Provisioning（含租约内在途）不判。Rationale：brief 的「supplied 不被提升」「只有 Ready 才做完整性守卫」；变异 S2、S3、S10、S11、S13 与「同 key 重放先于预检…」「租约内的在途…」两条用例钉住。Cost if wrong：守卫改成对所有报告生效，Failed 的首次报告会被改写成 Unknown，信息变少但仍不报 Saved。Date/Author：2026-10-01 19:20 CST / 实施者（Claude，dev-b3）。

Decision：B-3 的用例世界由真实开始工作加故障注入产生，不手工播种（`injectLostWrite`、`dropRelation`、`acking`，另有完整与主执行 ack 为 failed 两个正控）。Rationale：残缺的 Ready 的真实成因就是这些故障；手工播种要直接写端口、绕过适配器的外键，约多 15 行，且「没有 run」「run 为 unknown」两行与真实流程里的两个故障行是同一个状态，合并后用例更少、更真实；这些 helper 都在测试侧，不给生产代码加故障开关。Cost if wrong：改回手工播种约 +15 行，并依赖端口细节。Date/Author：2026-10-01 19:24 CST / 实施者（Claude，dev-b3）。

Decision：`recordRun` 失败转 Unknown 只在主执行 ack 的调用点（`startExecution` 里的 `localWrite`），manual fallback 里的两处 `recordRun` 失败仍以拒绝抛出（登记 TD-006）。Rationale：计划只要求主执行 ack 路径；把转换并进 `recordRun` 要多约 11 行（签名与三处调用），B-3 的预算已贴着 150；拒绝是响亮的、不是假的 Saved，且之后的重放与 Query 对「Ready 没有 run 记录」一律 Unknown。Cost if wrong：约 +11 行，把 `localWrite` 并进 `recordRun` 并补 fallback 的用例。Date/Author：2026-10-01 19:26 CST / 实施者（Claude，dev-b3）。

Decision：ack 的 run 状态不是已知取值时，本地记成 `unknown`，顶层结果也是 Unknown；Unknown 结果面带着已 ack 的 run 句柄（`runExternalId`）。Rationale：重放与 Query 对 run 为 unknown 的 Ready 一律 Unknown，首次若报 Saved，就是同一请求前后矛盾；run 记录写不进去时，这个句柄只存在于内存里，结果面是唯一能把它交给调用方对账的地方（计划的「保留最后已 ack 句柄」）。主执行 ack 为 `failed` 仍是已确认的运行，不从 `failed` 反推降级或缺口（变异 E11 与用例「主执行 ack 的是 failed」钉住）。Cost if wrong：去掉 `LocalWriteFailed.runExternalId` 约 −11 行（Unknown 不再带 run 句柄）。Date/Author：2026-10-01 19:26 CST / 实施者（Claude，dev-b3）。

Decision：`docs/product/vertical-path.md` 只更新第 6、7 行、探针 P3 / P4 / X1 与观察基线，其余行保留原基线，混合快照写明，并点名两处已知过期的陈述（TD-008）；第 6 行的结论词不变，仍是「反例：#194（P4）」，#196 只留在 Storage 层。反向升级证据（第 6 行的反例列表去掉 #196 / X1）：X1 在 `b230a73` 上输出 `no repo failed not_found | no item failed not_found | contexts 0`（旧值 `no item saved ready | contexts 2`），对应用例是 `start-work-sqlite-registration` 的「工作项守卫」「ack 与能力门」；同一检出上直接 `putExecutionContext` 一个未登记的工作项，替身接受、SQLite 报裸外键错误（#196 的验收标准仍未满足，不关闭）。Rationale：该节的规则是「关闭所引用 issue 的 PR 必须同 PR 更新对应行与基线」「只往保守方向修正，反向升级写证据」，预算只够回读第 6、7 行与三个探针，不把混合快照伪装成整体重新核对。Cost if wrong：把整节在同一检出上重新回读，约 +40 行。Date/Author：2026-10-01 19:46 CST / 实施者（Claude，dev-b3）。

Decision：采纳 verify-b2 的补丁 1、2、4（缺口用例、挂载契约一格、`run()` 并入 `attempt()`），不应用补丁 3（`readChainFacts` 只对 Ready 的上下文算已观察）。Rationale：补丁 1、2、4 只改测试，对应的 6 个变异在补丁前全部存活、补丁后各被抓住（`Artifacts and Notes`），并入 `attempt()` 净省约 6 行；补丁 3 改 `chain-facts.ts`，在文件集之外，且改变谱系读的行为（与 #221 / #222 / #233 相邻），由人类裁决，登记 TD-009，裁决前保持「断言 `relations=[]` 之前不得读谱系」的纪律。Cost if wrong：应用补丁 3 约 2 行，再加一条「Unknown 之后读谱系不写边」的用例，并去掉测试里的纪律。Date/Author：2026-10-01 20:27 CST / 主控裁决、实施者（Claude，dev-b3）。

Decision：失败结算 Unknown 的文案按事实陈述（verify-b2 的 P3①）：有分支句柄才说「已 ack 的外部资源保留、不自动删除，需先对账、不要盲目重试」，否则说「本次没有外部写入被 ack」；本次外部调用失败过时（失败结算），原始失败的错误码与文案一并带上。Rationale：上文「失败结算共用 `settle` 事务」一条写的是文案不声称已 ack，B-2 的实现恒称已 ack；分支创建被 provider 拒绝时本次没有任何 ack，provider 的 `unavailable` 还被「本地结算失败」盖掉，调用方无从区分「什么都没写」与「写了但没记下」。判据取分支句柄：工作树与 run 的 ack 都在分支之后，写成「分支、工作树、run 任一」会多出两个不可达的分支。Cost if wrong：回到恒称已 ack，信息变少；要更细（区分步骤）时加一个字段，约 +4 行。Date/Author：2026-10-01 20:29 CST / 主控裁决、实施者（Claude，dev-b3）。

Decision：规模：B-3 之后累计 727，对抗验证的修复轮净 +8 到 735（目标不超过 725 未达到，硬线 800）。Rationale：补丁合计 −4，文案修复与它的两条用例 +12（有 ack / 无 ack 两个方向各要一个用例，每个注入点要命中计数与无故障正控）；清理过 dead code 与重复用例，生产代码没有可删的，合并两条相似的失败结算用例最多再省约 3 行，却要改写已被对抗验证的用例。Cost if wrong：主控要求压到 725 时，把两条失败结算用例合成表驱动（约 −3）并去掉 `LocalWriteFailed.runExternalId`（约 −11，见上文）。Date/Author：2026-10-01 20:37 CST / 实施者（Claude，dev-b3）。

Decision：同 key 命中 Saved 的首次报告时，只有记录仍是 Ready 才把它当 Saved：记录是 Failed 报 Failed，是 Provisioning 报在途（`reportForExisting`），Closed 照旧 Saved；Ready 走既有的完整性守卫（上文「完整性守卫只作用于会报 Saved 的 Ready」一条在非 Ready 上的补充，不是推翻）。Rationale：重放必须与记录同向——记录说失败或在途，调用方不能拿到 `saved / confirmed`，与 B 要消灭的「健康 Saved 谎言」同类；一行改写原行（`let report = …`），不另起守卫；`Closed` 不必排除，`reportForExisting(Closed)` 本来就是 Saved，排除是死条件。变异 N1 – N5 钉住；N4（Ready 也改用记录自己的报告）是等价变异体，Ready 的默认报告就是 Saved。Cost if wrong：回到原样返回 Saved，调用方在 Failed / 在途的记录上看到 saved。Date/Author：2026-10-01 21:32 CST / 主控裁决、实施者（Claude，dev-b3）。

Decision：接管时已有的 run 为 unknown 报 Unknown（`startExecution` 的 `existing` 分支加一行，不动其余状态）；run 状态未知的两条路径（ack 的状态不是已知取值、接管时已有 run 为 unknown）共用 `unknownRun`，文案陈述运行状态未知、需对账，不再借 `LocalWriteFailed`，后者回到只由 `localWrite` 抛出。Rationale：与重放、Query 对 run 为 unknown 的 Ready 一律 Unknown 一致；没有本地写失败，文案不该说本地结算失败。主执行 ack 的 failed 不是缺口，接管仍报 Saved（变异 N8 与接管用例的 failed 行钉住）；`manualFallback` 的 `existing` 分支仍不看状态（TD-006 的文字已订正）。Cost if wrong：约 −5 行回到原样。Date/Author：2026-10-01 21:32 CST / 主控裁决、实施者（Claude，dev-b3）。Superseded in part by Decision Log「接管时已有 run 的两条分支共用一个答案」（2026-10-01 22:14 CST）：「`manualFallback` 的 `existing` 分支仍不看状态」不再成立，两条分支共用 `existingRun`。

Decision：采纳 verify-b3 的 P2-2、P2-3、Q6、未用导入与文案；P2-1（Ready 之后的启动窗口里重试得到 Unknown）与 controller 缺口只记债（TD-012、TD-013），不改代码。Rationale：P2-1 的真修要在 run 启动窗口设在途标记或租约，属 #193；现在的 Unknown 保守且诚实（不起第二个 run，完成后自愈），且是 B-3 相对 `98bb08c` 的有意变化（那里给的是过早的 saved）；controller 缺口跨包、不在 B 的文件集。Cost if wrong：P2-1 要在本 PR 修，需要新的 run 记录状态与 `startExecution` 对它的认知，约 +30 行并改变 R3.5 的边界。Date/Author：2026-10-01 21:26 CST / 主控裁决、实施者（Claude，dev-b3）。

Decision：不把 `worktreeEntityId` 下沉到 `relations.ts` 以消除循环 import（TD-005 保留，订正为三个模块的强连通分量），由验收者最终裁决。Rationale：对抗验证实测循环在 17 个 core 入口、18 个包入口与 esbuild 打包下都没有未初始化的绑定；下沉要增删之和 53 行，累计会到约 790，余量只剩约 10 行。Cost if wrong：验收者要求消除时按 TD-005 的下一步做，约 +43 行（累计约 790，仍低于 800）。Date/Author：2026-10-01 21:26 CST / 主控裁决、实施者（Claude，dev-b3）。

Decision：规模：终局对抗验证之后累计 748（累计不超过 750 达到，净增目标不超过 12 实际 +13）。Rationale：接管用例表驱动多 1 行，为杀「已有 run 不是 running 就报 Unknown」这一放宽的变异（N8）；其余按目标。Cost if wrong：去掉接管用例的 failed 行（−1），N8 复活。Date/Author：2026-10-01 21:34 CST / 实施者（Claude，dev-b3）。

Decision：接管时已有 run 的两条分支共用一个答案（`existingRun`）：已有 run 的状态为 unknown 报 Unknown（带已有 run 的句柄），其余如实带回 `fallbackOf` 的降级标记与 run 句柄；`startExecution`（主执行可用）与 `manualFallback`（主执行不可用）都调它，「已有就不起第二个 run」的策略不变。Rationale：同一状态在接管、这次接管自己的重放与 Query 上必须是同一个答案——`provision()` 的注释把「调用返回一个答案、记录与 `existingResult` 返回另一个」称作 Host 权威状态分叉（`AGENTS.md` §1.1 不变量 7）；P2-3 只修了一条分支，主执行不可用时接管仍对 unknown 的 run 报健康 Saved，违反本计划「run.status Unknown 必须顶层 Unknown」的设计；降级标记与 run 句柄的丢失是同一个分叉的信息面（controller 的 `StartWorkView` 转发 `fallback` 与 `degraded`，界面会看到不同的结论）。收在两条分支共用的一处，以后只有一个地方决定「已有 run 怎么答」。备选：把已有 run 的检查挪到 `startExecution` 开头、删掉 `manualFallback` 里那一行——主执行 `startRun` 失败之后到 `manualFallback` 之间的并发窗口里会覆盖别人刚写的 run 记录（`putExecutionRun` 按 run id 覆盖），不取；独立复评之后这条取舍由用例钉住（并发的写者在主执行 `startRun` 里先落 run 记录再失败，降级不起、也不覆盖那条记录；备选的变异 O10 红 2），不再只靠文字。证据：用例先红（60 个里 6 个）后绿，10 个变异全部被抓住，四路径扫描的不一致从 170 种降到 46 种（剩下的是 TD-014），见 `Artifacts and Notes` 的「独立验收证据」。Cost if wrong：回到两条分支各自的写法（约 −8 行）；若人类认为接管遇到人工降级的 failed 标记、而主执行已恢复时应改起主执行，那是 #193 的策略变化，不在本条。Date/Author：2026-10-01 22:14 CST / 独立验收者（Claude Opus，accept-b）。

Decision：TD-005 终裁——保留 `{chain-facts, execution-context, git-provisioning}` 的运行时循环，不下沉 `worktreeEntityId`。Rationale：①verify-b3 的实测（17 个 core 入口、18 个包入口、esbuild 的 ESM 与 CJS 产物都没有未初始化的绑定）；②失效形态是响亮的：环上三个模块的顶层只有本模块的字面常量（`PAGE_LIMIT`、`StartWorkFallback`、`PROBE_PAGE_SIZE`、`PROBE_MAX_PAGES`）与函数声明，函数声明在模块实例化时就已初始化；只有将来某个模块在顶层读对方的 `const` 导出才会在加载时抛 `ReferenceError`，任何导入 core 的用例都会立刻全红，不会静默出错；③下沉按增删之和约 50 行（毛值；verify-b3 在副本里实测净增 43），加上验收之后的累计 767，累计毛值约 817、净值约 810，两者都超过 800 的弹性上限，而它不改变任何行为（独立复评核对了这个口径，结论不变）。Cost if wrong：出现顶层互相引用时按 TD-005 的下一步下沉（约 50 行），并加文件级循环检查。Date/Author：2026-10-01 22:20 CST / 独立验收者（Claude Opus，accept-b）。

Decision（验收者的建议，待人类裁决）：TD-009（读谱系把 Unknown 的半提交「修复」成 confirmed 边）不并入 B，另开 issue 或随 #221 处理，补丁不应用。Rationale：①它不破坏 B 的硬约束：读谱系写出的 tracks / has_worktree 指向 provider 已 ack 的分支与工作树（步骤回填只在 ack 之后写句柄），是真事实而不是假 Saved；命令侧的 Unknown 不变（记录仍是 Provisioning、没有 attempt；租约内同 key 在途，租约过期后续跑由 `settle` 补 Ready 与 attempt，`recordEdges` 跳过已有的边），Query 也不报 Saved。②不变量 6 不受影响：读路径与写路径用同一个 `worktreeEntityId` 与 `contextIdFor`，沿谱系传播、不重新识别。③受影响的是不变量 7 一侧的「Query 只读」与 B-2 的「最终事实同生共死」，写者是谱系读本身（`getDeliveryProjection` 设计上读时落边，SQLite 上还会在提交 / 变更请求端点因 #221 抛外键错误），这是交付谱系读路径的语义问题，不是开始工作的命令协议。④两行补丁把「上下文存在」与「上下文 Ready」混为一谈：独立验收在补丁副本上实测，工作树步失败后的 Failed 上下文（库里有一条 confirmed 的 tracks）读谱系得到 0 跳，不打补丁是 1 跳 tracks——补丁会造出新的展示失真；正确的修法要在 #221 一起决定「谱系读对非 Ready 的上下文只读不落边」还是「只有 has_worktree 一跳要求 Ready」。⑤它在 B 的文件集之外（`chain-facts.ts`、`delivery.ts`），并入要扩文件集并补「Unknown 之后读谱系不写边」的用例，约 +10 行。Cost if wrong：若人类要求在 B 内收口，按上面④的两种之一修并补用例（约 +10 至 +30 行，累计仍低于 800）；不并入时，测试里「断言 relations=[] 之前不得读谱系」的纪律继续有效。Date/Author：2026-10-01 22:25 CST / 独立验收者（Claude Opus，accept-b）。

Decision（Superseded by 下文「评审修订的提交整理」，2026-10-02：第一轮 MVP 评审指出 `912954f`、`ea2127e` 是对本 PR 内提交的修补，提交序列已整理）：提交序列保持原样（观察 `569d759`：B 的 22 个提交加验收的两个；独立复评的小修在其后追加提交，个数以回读为准；重算：`git log --oneline fix/repository-identity..HEAD`），不用 `git reset --soft` 重组。Rationale：每个提交在其树上为绿（独立验收逐提交实测，见「独立验收证据」），没有 debug、fixup 或临时提交，每个提交有单一目的与 `Refs`；同一批的文件在多个提交里反复改（`start-work.ts` 在 7 个代码提交里改过，观察 `569d759`，重算：`git log --oneline fix/repository-identity..<提交> -- packages/core/src/start-work.ts`；缺口文案的分隔修复之后是 8 个），按文件归属重组只能把存储与 core 并成一个大提交（替身的仓库父边必须与 core 的写前登记同一个提交，Decision Log 已记），可审阅性反而下降，且重组曾静默丢过计划与断言；A（PR #251）的验收同样保留了实施、订正、验收各自的提交。Cost if wrong：人类要更少的提交时，在推送前由主控按 `AGENTS.md` §6 建备份 ref 后重组，并逐提交重跑与比对文件集合。Date/Author：2026-10-01 22:25 CST / 独立验收者（Claude Opus，accept-b）。

Decision：独立验收维持本计划的十一项取舍（不加 `getEntity`、预检 / 能力门 / ack 只对新请求、写前登记 context 与 worktree 实体、保留挂载冲突预检、新请求没有能力不落 Failed 上下文、`namesProblem` 移入请求校验、认领失败转结构化只针对新请求、`LocalWriteFailed` 只标记显式本地写点、失败结算的本地写失败也报 Unknown、harness 不提取、B-3 的 Query 完整性范围），并确认 TD-012 的文字与归属（#193）、TD-013 的文字与归属（controller 跨包）准确。Rationale 与各项的判错代价见 `Artifacts and Notes` 的「独立验收证据」裁决表。Cost if wrong：各项的代价都是加法或局部回退，表里逐项写明。Date/Author：2026-10-01 22:25 CST / 独立验收者（Claude Opus，accept-b）。

Decision：采纳 verify-b4 的发现 1 – 4 与 6，发现 5 与附注只订正文字。Rationale：发现 1 – 4 是测试缺口（变异存活，或只被无关用例抓住），行为本身经复评确认正确，补强只加断言与一条 5 行的用例；发现 6 是 B-3 引入的文案缺陷（缺口描述以拉丁字母开头时粘在前文上），改一行并加一条格式断言；发现 5 与附注是文档精度（扫描范围、提交计数、TD-006 与 TD-005 的数字、验收附注①）。没有重构、没有新行为；规模净增 +7（目标不超过 8，累计 774，目标不超过 775，硬线 800）。首次路径的原因文案与接管路径是同一类缺口（O13b），一并钉住，不加行。Cost if wrong：去掉这些断言与用例（−7）即回到 `569d759` 的测试面，O10、M11、O13 复活，O14 回到只被一条无关用例抓住；文案回到无分隔。Date/Author：2026-10-01 23:22 CST / 实施者（Claude，dev-b3）。

Decision：缺口文案把缺口描述放进全角括号：「已 ready 的上下文（缺口描述）：外部执行是否已启动无法确认……」，不用逗号或空格分隔。Rationale：与 `unknownRun` 的「运行状态未知（原因）」同一写法；缺口描述有三种（「没有 run 记录」「run 状态未知」「缺少 confirmed 的 tracks / has_worktree 边」），其中一种以拉丁字母开头，括号在三种上都清楚，逗号会与句内已有的多个逗号混在一起。Cost if wrong：改一行文案与一条格式断言。Date/Author：2026-10-01 23:21 CST / 实施者（Claude，dev-b3）。

Decision：第一轮 MVP 评审的 TD-009 裁决——不并入本 PR，随 #221 处理，两行补丁不单独应用。Rationale：写边的是谱系读，它在 main 上对任何有记录的上下文都落 confirmed 边（base 与 head 同一脚本对照：给 Provisioning 上下文写 tracks 在 base 上同样发生）；落下的边指向已 ack 的资源，命令、重放与 Query 都不报 Saved，恢复不走错路；两行补丁会把 Failed 上下文的 tracks 跳也藏掉。TD-009 的「延期理由」与「下一步」已就地 Superseded。Cost if wrong：若 #221 迟迟不落，读谱系的部分写入在 SQLite 上继续以外键错误暴露，测试继续靠「断言前不读谱系」的纪律。Date/Author：2026-10-02 / 评审者裁决（Singularity-AI-Bot 的 review 5391344982），实施记录（Claude）。

Decision：采纳第一轮 MVP 评审的四条 P2 与可修的 P3，在本 PR 内修复，不另开 issue（用户 2026-10-02 指示「尽量修复」）。四条 P2：①`existingResult` 对 Ready 的工作树读回区分「确定」与「此刻无法确认」，后者保留 Ready、报 Unknown（原先一次瞬时读失败就判 Failed，换新 key 接管会再起一个 run）；②`startRun` 返回 `ambiguous_result` 时本地记 unknown、报 Unknown，不再记 failed + 人工降级（ADR-0007：ambiguous 表示必须对账；D9 只规定不起 fallback）；③绑定 id 变化的冲突文案点名成因，绑定 id 稳定登记为 TD-015 交 #228；④TD-009 文字按裁决订正。P3：工作树步 ambiguous 走与分支步同一个对账出口；ui-model 的开始工作补仓库读、工作树读两个读门（只按读判定，与 `gateCommand(..., 'read')` 一致）；003 自检补 repository 主键；TD-004（挂载必须引用 repository 身份）与 TD-013（controller 转发 run 句柄）解决；TD-010 的测试超时；替身仓库父边补非 active 状态的反例与 tracks 候选一行。不采纳：「ack 之后结算失败的 Unknown 不持久」——本地存储刚失败，无法可靠写下 Unknown 标记，行为已是保守的（不报 Saved、租约过期后续跑），并入 TD-012 的说明。Cost if wrong：①②的判定若过于保守，读能力长期缺失的 Ready 会一直停在 Unknown，直到对账（#193）。Date/Author：2026-10-02 / 评审修订（Claude）。

Decision：评审修订的规模——修订后相对 #251 的代码为 967 / 1000（CI 硬上限；复评修订后 983，第二轮复评修订后 1000，见 `Artifacts and Notes` 的「第二轮复评修订证据」），超过本计划自设的 800 硬停线（`Global Constraints` 第 8 条）。Rationale：用户 2026-10-02 指示评审意见尽量在本 PR 修复而不是转 issue；800 是规划弹性上限，1000 是 CI 硬上限，两者并存；修订的每一处都有撤销即变红的变异证据。Cost if wrong：后续复评若还要改代码，余量只有约 30 行，需要先压缩重复用例而不是继续加；此超出已向用户汇报。Date/Author：2026-10-02 / 评审修订（Claude）。

Decision：评审修订的提交整理——原 28 个提交（含 `912954f`、`ea2127e` 这类对本 PR 内提交的修补与多次文档回填）与评审修订按可独立回滚的交付物重组，变基到整理后的 #251；文中引用的提交 SHA 是整理前 PR 分支上的提交（PR 时间线的 force-push 记录可回看），落到 main 的提交以 rebase merge 回执为准。Rationale：根规则要求开 PR 与最终 push 前移除 fixup、收敛成可独立审阅与回滚的序列；逐提交为绿在整理后的序列上重新验证。Date/Author：2026-10-02 / 评审修订（Claude）。

Decision：采纳修复复评（无 P0 / P1，1 条 P2、5 条 P3）。P2 的根因不在错误码分类：真实 local Git 把仓库不可达也报成 `not_found`，只要「有缺口的 Ready」还能被改判 Failed，换新 key 接管就会在缺 run 记录时再起一个 run。改为 TD-006 早已写下的止血：`existingResult` 先算 `readyGap`，有缺口的 Ready 不读回、不改判，停在 Unknown 直到 #193 的对账；完整的 Ready 才读回工作树，确定不存在或检出别的分支判 Failed，此时 run 记录在，接管走 `existingRun`、不起第二个 run。读回失败只改写原本会报 Saved 的报告，命中的 Failed / Unknown 首次报告原样返回。工作树对账读到别的分支与 conflict 路径同判 Failed。分类与对账的每一处都由表驱动用例钉住（复评列出的 7 个存活变异与「先算缺口」「不看 supplied」两个变异现在都变红）。Cost if wrong：有缺口而工作树确实已不在的 Ready 失去自动接管，要等 #193 的对账；这是安全优先于活性的取舍，记在 TD-006。Date/Author：2026-10-02 / 复评修订（Claude）。

Decision：采纳第二轮修复复评（无 P0 / P1 / P2，4 条 P3 与 2 处 nit）。①缺口对任何 supplied 都要算：只在 supplied 已确认时才算缺口的半回退会从「重放旧的 Failed key」重新打开第一轮的 P2，用例改为同时断言记录不被改判；②读回分类表里两行 Failed 改为恢复读回后再接管，断言沿用已有的 run（原先接管跑在故障里、走不到 run 步，是空断言）；③根因的既有残留在 provider：`development-local-git` 把 `git -C` 进不去仓库根（「cannot change to」）归成 `not_found`，完整的 Ready 会被误判 Failed——改为 `unavailable`（先于 not_found 匹配），这是本计划文件集之外的一行映射加一条 provider 用例，按用户「尽量修复」的指示在本 PR 收口；④TD-006 的「遗留影响」与「下一步」两列订正；对账冲突的文案带上读到的与期望的分支，`existingResult` 的注释改为「缺口对任何 supplied 都要算」。Cost if wrong：③若别的 Git 版本用不同措辞，仓库根缺失会退回 not_found 的旧行为（判 Failed，接管沿用已有 run，不起第二个 run）。Date/Author：2026-10-02 / 第二轮复评修订（Claude）。

## Idempotence and Recovery

旧版（007 重复 migrate、`VACUUM INTO` 备份与冷快照、备份克隆预演、007 失败的 FK 生命周期、成功后旧 manifest 拒绝 7、回滚备份恢复）已作废：Superseded by Decision Log「按 D10 订正」（2026-10-01）。

B 不迁移旧库：003 原位改成复合主键，已应用旧 003 的开发库删库重建（首发前没有需保住的数据，D10；SQLite 上 Start Work 从未成功，库里没有 repository 行与执行上下文）。预期的失效方式是响亮的：旧库里第二个工作区再挂同一个 id 时由旧的 `id` 主键拒绝，同一工作区的首次登记在旧库上也能成功，所以不存在静默分叉；这条预期由 `Validation and Acceptance` 的一次性探针核对，输出记在 `Surprises & Discoveries`。本批回滚：回退对应提交，没有数据迁移要撤销。需要保留旧库升级时的路径见 Decision Log「按 D10 订正」的 Cost if wrong。

登记的可重复性：写前事务重复使用自然键与稳定槽位——canonical 仓库身份按 `(binding, 'repository', 请求定位)` 复用，同值挂载重复登记是 no-op，context 与 reserved worktree 实体按确定性 id 覆盖写；同 workspace / id 换身份、同 workspace / 身份换 id 都冲突且不覆盖。事务失败整笔回滚，可原样重试；没有 context 记录的请求被预检拒绝时没有留下任何行，同一个 key 之后仍可重试。

外部资源与本地事务不原子（B-2 起落地）：final 失败保留已 ack step 的 Provisioning 与句柄，租约过期后可 resume，Git 供应用稳定的分支 / 工作树探针，但这不证明 run 恢复。Ready 残缺或 run ack 后本地失败一律 Unknown，不起第二个执行者；人工核对 Provider 结果后由 #193 的恢复设计决定下一动作。代码撤回不删除用户 Git 资源。B-2 的恢复路径实测（旁证探针，不入库；入库验证属 B-3 的 R3.1 / R3.4）：最终事务的 `putMutationAttempt` 写后失败得到 Unknown 后，库里是 Provisioning（带分支与工作树句柄与租约）、无关系、无 attempt、无 run，外部增量为分支 +1、工作树 +1、运行 0；租约内用同一个 key 再试返回 `pending` / Provisioning（在途），外部零增量；租约过期后换新 key 把同一个 context 做完：`saved` / Ready、`has_worktree` 与 `tracks` 两条关系、新 key 的 attempt 为 `saved`、运行 `running`，外部总增量为 1 / 1 / 1（没有第二份分支与工作树）；替身与 SQLite 两个适配器结果相同（观察 2026-10-01 19:01 CST @ `cf1a9cb`，检出 `fix/start-work-sqlite-prerequisites`）。

B-3 的幂等与恢复：残缺的 Ready（run 记录缺失、run 状态未知、tracks / has_worktree 缺失或只是候选）在同 key 重放、新 key、关库重开与 Query 上给出同一个答案——Unknown（`confirmed=false`、`degraded=true`，保留 Ready 与已 ack 的句柄），三条路径都只读本地、不写、不起第二个 run，所以可以任意次重复读取而不改变任何事实；run 的 ack 之后本地 run 记录写失败时，首次结果就是这个 Unknown，带着已 ack 的 run 句柄，之后的重放与重开不再起 run（外部总共一个 run）。完整的 Ready 在三条路径上稳定为 Saved，外部与本地快照逐字不变。恢复路径是人工对账：核对外部 run 与本地记录之后，由 #193 的外部执行恢复设计决定下一动作（补记、取消或重新关联）；本批不自动恢复，也不删除外部资源。已知缺口：Failed 的接管路径下 run 记录缺失时会再起一个 run（TD-006，#193）。

终局对抗验证之后的补充：同 key 重放必须与记录同向——同 key 命中 saved 的首次报告时，只有记录仍是 Ready 才返回 Saved（Ready 再过完整性守卫），记录是 Failed 报 `failed`、是 Provisioning 报 `pending`，所以工作树消失后连续两次重放得到同一个答案；接管（换新 key 取走 Failed 的上下文）时已有的 run 为 unknown 报 Unknown，带已有 run 的句柄，不起第二个 run，下一次调用同样是 Unknown。独立验收之后，主执行不可用（接管走人工降级的分支）时同样如此；接管遇到人工降级的 run 如实带回 `fallback` 与 `degraded`，遇到正常的 run 带回 run 句柄——接管的答案与它自己的重放、Query 一致，可以任意次重复读取。主执行 `startRun` 失败之后，`manualFallback` 在降级之前会再读一次已有的 run：并发的写者在这个窗口里落下的记录被保留并如实带回（`saved`、不带 `fallback`、run 句柄是那条记录的），不被降级的 failed 记录覆盖（独立复评补了用例）。

Ready 之后的启动窗口（TD-012）：`settle` 提交 Ready 之后、`startRun` 返回并写 run 记录之前，同 key 重试、新 key 与 Query 都命中「Ready 且没有 run 记录」，得到 Unknown / `degraded`；放行后首次调用报 `saved`，之后全部 Saved，`startRun` 共 1 次（对抗验证的窗口探针，替身与 SQLite 相同）。这是保守且诚实的：本地无法区分「正常在途」与「崩溃留下的残缺」，所以不报 Saved、不起第二个 run；它没有「在途」语义，真修（run 启动窗口的在途标记或租约）属 #193。它是 B-3 相对 `98bb08c` 的有意变化：那里同一窗口里重试得到 `saved / confirmed`，而 run 其实还没起——过早的 Saved。

需要请求 fingerprint、actor 全链传播、pending ledger、run 创建对账 / 取消流水、全面关系写者、multi-binding 路由或未知 workItem 的统一 adapter 错误时停止扩大本实现，回到 issue 划分；#194 / #204 / #193 / #221 / #219 / #196 保持开放。累计 code 超过 800 或同 binding 的 ack 无法保持时重新评审候选（退路 T0，见 Decision Log「范围与规模闸」），不能删判别性测试继续发布。

## Interfaces and Dependencies

Node 按 `.nvmrc`（当前 26）、pnpm 按 package.json；现有 node:sqlite、Fake Provider 与 Local Git 临时 fixture 足够。B 依赖 A 交付的接口：`ExternalIdentityKind.Repository`、`parseExternalIdentityKind`、两个适配器的 `putExternalIdentity` 对未知种类的写前守卫（`RangeError`，Promise 拒绝）、002 的 `external_kind` CHECK 含 `'repository'`；B 不依赖 `Migration.rebuild`（A 没有它）。B 不新增 Storage 端口方法（`packages/capabilities/src/registry.ts` 的 `StorageSurface` 精确成员锁不动），只补 `putRepository` 的挂载语义。prepared 只含同一个 Development provider 实例的 binding id；ExecutionRun 的 providerRef / status / fallback 保持既有语义。B-3 新增的内部接口：`packages/core/src/execution-context.ts` 导出 `readyGap(context, record, run)`（返回缺口描述或 `undefined`，只读本地、不问 Provider），它引用 `chain-facts.ts` 的 `worktreeEntityId`，与后者互相引用（TD-005）；`start-work.ts` 的 `LocalWriteFailed`（只由 `localWrite` 抛出）带可选的 `runExternalId`；run 状态未知的结果由 `unknownRun` 构造，不是本地写失败；接管时已有 run 的答案只由 `existingRun` 构造（`startExecution` 与 `manualFallback` 共用，独立验收加入）；`readyGap` 的描述由 `existingResult` 放进全角括号：「已 ready 的上下文（缺口描述）：外部执行是否已启动无法确认……」（独立复评加入）。公共 Request / Query 的形状不变，`ExecutionContextView.degraded` 的含义扩大为「降级（fallback）或 Ready 残缺」。

外部公开写由主控执行，actor 及目标 PR / issue 记录在实际发布证据。只允许三个已选 issue 现有 milestone / labels / iteration 来源的 ExecPlan、Batch、Kind、Area、Gate、Priority、Size 机械投影；Status、blocked-by / blocking 和新增 PR Project 条目不写。PR 双向关联在 B 检出根回读：

    gh pr view 253 -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup
    gh issue view 187 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences
    gh issue view 188 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences

期望 B 仍 draft、base 为 A 当前分支、closing 双向仅 #187 / #188 目标；主控另读 reviewThreads 和实际 checks。非 main stack base 的 closing keyword 若未建立关联，可由主控使用 GitHub 原生 addCloseIssueReferences 显式补连再回读；不能把 PR 正文词句当关联已经成功。该发布门不表示实施或 issue 已关闭。（PR 编号订正，2026-10-01 22:30 CST：原写法 `gh pr view -R … --json …` 不带编号，`gh` 在带 `--repo` 时要求编号，实测报 `argument required when using the --repo flag`。）

交接事实（独立验收，2026-10-01）：①B 对 A 的依赖就是上文第一段列出的 A 的接口，B 不改它们的行为；②B 的最终 head 以 `git rev-parse fix/start-work-sqlite-prerequisites` 回读，不在本计划里写死；③重跑触发条件：在 B 的检出根运行 `git merge-base --is-ancestor fix/repository-identity HEAD`，退出码非零说明 A 又变了、B 需要重基到 A 的新 head，之后重跑 `Validation and Acceptance` 的命令与逐提交为绿；④B 之后的开放项（#192 已由本 PR 关闭，见 `Design / Spec`）：#193（外部执行恢复与对账，含 TD-006 的「Failed 接管时 run 记录缺失会再起一个 run」与 TD-012 的启动窗口）、#194 / #204（请求指纹、在途与跨上下文同 key 互斥）、#196（Storage 端口层面未登记工作项的统一错误）、#219（多 binding 路由）、#221（通用关系写者与 SQLite 上谱系读的端点外键，含 TD-009、TD-014）、#4（聚合门禁，E1 / R1 未完成）、TD-004（`putRepository` 不约束身份种类）。

前置条件（第一轮 MVP 评审，2026-10-02）：Development 绑定 id 必须跨重启稳定。canonical 仓库身份按 `(Development bindingId, repository, 请求定位)` 查找，`development-local-git` 与替身的 bindingId 默认每个实例随机生成；装配不固定它时，重启后已挂载仓库上的新工作项在写前得到 `conflict`（零外部写入、文案点名成因）。固定 bindingId 是装配的职责，交给 #228（TD-015）。

## Outcomes & Retrospective

当前生产code/test变动0。已有研究仅基线反例与设计验证；新007、getEntity、final事务与正式测试未创建/未执行。2026-10-01 15:24 CST完成磁盘独立审读及技能lint；15:35 CST补齐未来两个旧fixture和产品证据矩阵义务后再次审读/lint，code预算25项766/余34；15:39 CST主控文档门通过。未实施的矩阵不能标绿。Superseded by 下一段（2026-10-01 17:33 CST）。

订正后的状态（2026-10-01 17:33 CST）：计划已按 D10 与预审订正，生产 code / test 变动仍为 0；B-1 的实施结果与偏差在 B-1 提交 5 回填，B-2 / B-3 由后续实施者接手。未实施的矩阵不能标绿。Superseded by 下一段（2026-10-01 17:53 CST）。

B-1 实施结果（2026-10-01 17:53 CST，检出 `fix/start-work-sqlite-prerequisites`）：SQLite 空库上的 Start Work 经 `composeCore` 与 `commands.startWork` 从空仓库集合首启全链路成功（Ready、两条 confirmed 关系、`saved` 的 attempt、context 对应的 run，外部分支 / 工作树 / 运行各 +1）；外部写入之前挂载、canonical 身份、context 与 reserved worktree 实体已提交；不合格请求（未知 / 别的工作区 / 变更请求 / 被扣下的工作项，ack 失败或回显不符，能力缺失，挂载冲突）在任何写入之前被结构化拒绝，新请求不落 Failed 上下文；写前事务整笔回滚。这已满足 #187 / #188 的字面关闭条件；失败窗口（final 事务、Unknown、重放诚实性）仍是旧行为，由 B-2 / B-3 负责。003 原位改成复合主键，旧开发库删库重建（探针见 `Surprises & Discoveries`）。验证结果见 `Artifacts and Notes`。

与计划的偏差：①替身的仓库父边与分叉格翻转并入 core 登记的提交，不放进挂载契约的提交（每个提交为绿）；②`namesProblem` 移入请求校验；③认领失败转结构化（B-1 起初对所有路径统一转换，对抗验证后收窄到新请求，见 Decision Log）；④挂载契约放进执行组，台账按增量 +2；⑤门表去掉与 `resolveWriteTarget` 重复的一项（变异实验发现）；⑥schema 集成用例补一条 NOT NULL 断言，文件集增加一行；⑦规模：B-1 实测代码 477 行（对 `004470e`），超出原估的部分见 `Global Constraints`。

B-2 / B-3 估算更新（据实）：`start-work.ts` 再加约 100（final 事务与失败结算 45、Unknown 映射 30、`existingResult` 守卫 25），新测试文件再加约 140（R2.1 – R2.4 与 R3.1 – R3.5，复用 B-1 的 `setup` / `world` / `injectAfterWrite`，后者要扩成同时包根 Storage 的方法），`git-provisioning.ts` 20、`execution-context.ts` 25、`relations.ts` 12、`write-machine.ts` 8，共约 305，累计预计 782、余量 18。任何一批超出估算就按 Decision Log「范围与规模闸」重定闭环，首先考虑把 B-3 的 Query 完整性另开 PR。Superseded by 下一段（B-2，2026-10-01）。

B-2 实施结果（2026-10-01，检出 `fix/start-work-sqlite-prerequisites`）：Git 外部写入 ack 之后，Ready（或 Failed）、tracks / has_worktree 与该次 Git 的 mutation_attempt 在同一个最终事务里提交，任何一步失败整笔回滚；步骤回填写或最终事务的本地写失败返回 Unknown / `result_unknown`（`confirmed=false`、`degraded=true`、`saving=false`），context 停在 Provisioning 并保留已 ack 的句柄与租约，没有关系、attempt、run，`startRun` 0 次，不自动删除外部资源；has_worktree 只由真实的工作树 ack 产生，借分支句柄的 fallback 已删除（Refs #192，不关闭）。验证结果见 `Artifacts and Notes`。

与计划的偏差（B-2）：①测试留在 B-1 的测试文件，不提取 fixture（Decision Log）；②同一个事务用回滚证明，不记事务序号（Decision Log）；③除 R2.1 – R2.4 外，R2.3 的用例同时覆盖失败结算的写失败（Unknown 且整笔回滚）；④没有既有用例前提需要修改；⑤规模：B-2 的 code（含测试）相对批次起点（B-1 修复之后的 head）为 138 行（增 104、删 34），低于 150 的硬停线；相对 A 的累计为 613 行（含 B-1 的对抗验证修复），文档另计。

B-3 估算更新（据 B-2 实测）：`start-work.ts` 现 399 行（相对 A 净 170），B-3 再加约 35（`existingResult` 完整性守卫 25；`recordRun` 失败转 Unknown 只需再包一个 `localWrite(git, …)`，约 10），`execution-context.ts` 约 25，测试约 90（R3.1 – R3.5，复用 `setup` / `attempt` / `injectAfterWrite`），共约 150，累计预计 763、余量 37。B-3 要注意：①`unknownAfterAck` 用标记里 `acked.status` 作结果面状态，`recordRun` 失败发生在最终事务之后，传 `git`（Ready）即可；②谱系读会给 Provisioning 的 context 写 confirmed tracks（无句柄也写），B-3 的「无新边」断言前同样不得读谱系；③SQLite 上读谱系对 commit / 变更请求端点仍会外键失败（#221）。Superseded by 下一段（B-3 实施结果，2026-10-01）。

B-3 实施结果（2026-10-01，检出 `fix/start-work-sqlite-prerequisites`）：残缺的 Ready（没有 run 记录、run 状态未知、tracks 或 has_worktree 缺失或只是候选）在同 key 重放、新 key 命中既有记录、SQLite 关库重开后的新 key 与 `queries.getExecutionContext` 上都不再被报成健康的 Saved：命令返回 Unknown（`confirmed=false`、`degraded=true`，保留 Ready 与已 ack 的句柄），Query 的 `degraded=true`，三条路径都只读本地、不写、不起第二个 run，Query 零 provider 调用；同 key 命中的 Failed / Unknown 首次报告原样返回；Provisioning 在途不被判。`startRun` ack 之后本地 run 记录写失败、或 ack 的状态不是已知取值，首次即返回带已 ack 的 run 句柄的 Unknown，之后同 key / 新 key / 重开都不起第二个 run（外部总共一个 run）；主执行 ack 为 `failed` 仍是已确认的运行。失败结算的 Unknown 文案按事实陈述，带上 provider 的原始失败。`docs/product/vertical-path.md` 第 6、7 行与探针 P3、P4、X1 按新检出更新，第 6 行结论词不变（反例：#194（P4））。验证结果见 `Artifacts and Notes`。

与计划的偏差（B-3）：①用例世界由真实开始工作加故障注入产生，不手工播种（Decision Log）；R3.2 用「写不进去」而不是「写后失败」；②`readyGap` 放在 `execution-context.ts` 并接受与 `chain-facts.ts` 的运行时循环（TD-005），而不是计划设想的 `relations.ts`；③`recordRun` 的转换只在主执行 ack 路径（TD-006）；④Unknown 结果面带 run 句柄、ack 状态未知时顶层 Unknown，是计划里隐含、实现时明确下来的两处；⑤规模：B-3 相对批次起点 138（低于 150），累计 727；对抗验证修复轮净 +8，累计 735，余量 65，目标 725 未达到；⑥对抗验证的修复轮多出两个提交（缺口用例、失败结算文案），补丁 3 未应用（TD-009，需人类裁决）。

遗留与新债：TD-005（`execution-context.ts` 与 `chain-facts.ts` 的运行时循环）、TD-006（fallback 路径的 `recordRun` 失败仍是拒绝；Failed 接管路径下 run 记录缺失会再起 run）、TD-007（Query 完整性读全部关系）、TD-008（`vertical-path.md` 第 1 行与 13.3 行的已知过期陈述）、TD-009（读谱系「修复」Unknown 的半提交，需人类裁决）、TD-010（事务回调里误用根 Storage，替身静默死锁且测试脚本没有超时）、TD-011（`localWrite` 把闭包内任何抛出当本地写失败）。`start-work.ts` 现 413 行（观察 2026-10-01 21:36 CST @ `c7a6738`；重算：`wc -l packages/core/src/start-work.ts`），登记整体移成独立模块仍是可选项（Decision Log 的原条目）。

终局对抗验证之后（2026-10-01，verify-b3，PASS_WITH_FINDINGS，无 P0 / P1）：同 key 命中 saved 的首次报告时，记录不是 Ready 就不再原样返回 Saved（Failed 报 `failed`，Provisioning 报 `pending`，连续两次重放一致）；接管时已有的 run 为 unknown 报 Unknown（带句柄、不起第二个 run），主执行 ack 的 failed 仍是 Saved；run 状态未知的文案陈述运行状态未知，不称本地写失败；失败结算 Unknown 的「原始失败」后缀补了断言，未用导入删掉，`tests/integration/README.md` 的过期行订正。偏差：累计 748（目标不超过 750 达到），净增 +13（目标不超过 12），多出的 1 行是接管用例的 failed 行；循环 import 没有消除（Decision Log，TD-005 订正为三个模块的强连通分量，由验收者最终裁决）。新债：TD-012（Ready 之后的启动窗口里重试与 Query 得到 Unknown，真修属 #193）、TD-013（controller 的 `StartWorkView` 没有 `runExternalId`，「供对账」的句柄经 controller 拿不到）；TD-006、TD-009 的文字就地订正。验证结果见 `Artifacts and Notes`。

遗留：`start-work.ts` 增至 399 行（B-2 之后）且会继续增长，登记可整体移成独立模块（Decision Log）；旧库没有「repository 主键不是 `(workspace_id, id)` 就提示删库重建」的自检（仿 `assertRewritten003Shape`），D10 下不做，旧库的失效方式见探针；能力门的「同一 binding」由 `CoreProviderTable.development` 单槽保证，多 binding 路由是 #219。

独立验收（2026-10-01，accept-b，被验 `a93d572..271e497`）：结论为附注接受（ACCEPT_WITH_NOTES）。#187 / #188 的字面关闭条件成立——SQLite 空库上经 `composeCore` 与 `commands.startWork` 首启全链路（外部分支、工作树、运行各 +1，挂载、canonical 身份、两条 confirmed 关系、`saved` 的 attempt、context 对应的 run），挂载契约与执行组的仓库父边在两个适配器上各跑一遍；B 的 22 个提交逐个在其树上为绿；三位对抗验证者的 P2 及以上发现在最终树上逐个复现为已关闭。验收自己的四路径一致性扫描找到接管路径上的一处同类遗漏并修复（`existingRun`，Decision Log）。附注：①这一处修复由验收者实施并自证（先红后绿、10 个变异、探针），随后已由 verify-b4（Sonnet）独立复评 `0dcd129`，结论 PASS_WITH_FINDINGS（35 个变异杀 32、活 3，即独立复评小修补上的 M11、O10、O13，O14 是发现 1；四路径扫描 140 个世界 × 2 个存储，`271e497` 不一致 78、`569d759` 剩 44，全是候选边），证据见 `Artifacts and Notes`；②TD-009 的补丁是否并入等人类裁决（验收者建议不并入，Decision Log）；③TD-006 剩下的「Failed 接管时 run 记录缺失会再起一个 run」与 TD-012 的启动窗口属 #193；④TD-014 今天不可达；⑤TD-005 保留（Decision Log 的终裁）。规模：代码 774 / 1000（弹性上限 800；观察 2026-10-01 23:22 CST @ `912954f`，重算：`node scripts/rule-checks.mjs size fix/repository-identity`，独立验收之后的 767 Superseded by 本句），文档的观察值与重算命令见 `Artifacts and Notes` 的「复评之后的小修证据」；`start-work.ts` 现 417 行（观察 2026-10-01 23:22 CST @ `912954f`；重算：`wc -l packages/core/src/start-work.ts`）。B 之后的开放项见 `Interfaces and Dependencies` 的「交接事实」。

独立复评之后（2026-10-01，verify-b4，Sonnet，被验 `0dcd129`，PASS_WITH_FINDINGS，无 P0 / P1 / P2、六条 P3）：`existingRun` 的行为经复评确认正确；四条测试缺口已补强（接管结果面的分支与工作树句柄、并发写者先落 run 记录时降级不覆盖它、降级首次结果的错误码、两条文案正则各钉住原因），缺口文案补了全角括号分隔，文档精度（扫描范围、提交计数、TD-006 与 TD-005 的数字、验收附注①）已订正。偏差：没有；净增 +7（目标不超过 8），累计 774（目标不超过 775）；没有新债，TD-006 的「约 3 行」就地订正。验证结果见 `Artifacts and Notes` 的「复评之后的小修证据」。

仍开放：#196直接Storage未知workItem错误、#192完整ack修复、#193外部执行恢复、#194/#204命令协议、#219多binding、#221通用关系写者、#4 Gate。当前局部honest Unknown与两adapter登记正控不等于这些问题解决。实施产生的新债务按根规则登记 `docs/exec-plan/tech-debt-tracker.md`，本次只在本计划说明，未改tracker或旧计划。Superseded by 上文「遗留与新债」（B-3，2026-10-01）：新债务已登记 TD-005 至 TD-011，tracker 已追加行。

## Concrete Steps

现在重开保存的本文件，独立检查result/owner/接口/失败矩阵与预算求和，lint后交主控补索引、文档门、提交和draft stack；后续产品按B-1→B-2→B-3，每批记录当前base/head、命令、red→green、注入命中及真实计数/重开读回。实施与产品验证完成且最终head回读通过后才请求人类review；本次不ready不merge。Superseded by 下一段（2026-10-01）：设计评审门已开启，产品按 B-1 → B-2 → B-3 实施。

每批开始前在检出 `fix/start-work-sqlite-prerequisites` 的工作树根确认：`git log --oneline -6`（A 的实现提交在 B 的提交之下）、`git status --short --branch`（工作树干净）、前提组全绿；每批先写判别性测试并亲眼看它因功能缺失而红，再实现，再跑绿，随后跑宽验证。每批结束：记录当前 head、命令、RED → GREEN 摘要、注入命中计数、真实的外部增量与重开读回，更新本计划（`Progress`、`Surprises & Discoveries`、`Decision Log`、`Artifacts and Notes`、`Bottom Change Note`），核对相对 A 的累计 code 行数，整理成 1 – 3 个可独立审阅且各自为绿的提交后交主控。实施与产品验证完成且最终 head 回读通过后才请求人类 review；本批不 push、不 ready、不 merge。

实施与验证已在 2026-10-01 完成（最终代码提交与观察见 `Artifacts and Notes` 的「B-3 证据」与「独立验收证据」）。剩余步骤由主控与人类完成，回读命令写成规则式，在检出 `fix/start-work-sqlite-prerequisites` 的工作树根运行：

    git status --short --branch                                  # 期望：工作树干净
    git rev-parse fix/start-work-sqlite-prerequisites            # B 的最终 head，以回读为准，不写死
    git merge-base --is-ancestor fix/repository-identity HEAD && echo STACK_OK    # 期望：STACK_OK；退出码非零说明 A 变了，B 要重基并重跑
    git log --oneline fix/repository-identity..HEAD              # 期望：B 的全部提交叠在 A 之上，A 的提交不在其中
    pnpm verify                                                  # 期望：退出 0，用例数等于「计数基准」加上之后新增的用例数
    node scripts/rule-checks.mjs size fix/repository-identity    # 期望：代码低于 CI 硬上限 1000、文档低于 1500（原期望「代码低于 800、文档低于 1300」Superseded by Decision Log「评审修订的规模」）
    gh pr view 253 -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup    # 主控 push 之后；期望：仍 draft，head 等于本地 head，base 为 A 的分支，closing 仅 #187 / #188，checks 全部 pass

push、回读远端 head / base / checks / issue 关联 / review threads、请求人类评审与 `gh pr ready` 由主控与人类决定（`AGENTS.md` §6）；本计划不 ready、不 merge。

人工验收命令（第一轮 MVP 评审 P3 补入，2026-10-02）：在检出根运行，composeCore + 真实 SQLite 文件 + 真实 local Git，首启后关库重开再开始一次（同 key 与新 key）：

    node --input-type=module <<'EOF'
    import { mkdtempSync, rmSync } from 'node:fs'
    import { tmpdir } from 'node:os'
    import { join } from 'node:path'
    import { composeCore } from '@harness-projects/core'
    import { newWorkspaceId } from '@harness-projects/domain'
    import { createFakeProviders } from '@harness-projects/provider-fake'
    import { createSqliteStorage } from '@harness-projects/storage-sqlite'
    import { makeFixture, providerFor, worktreePaths, REPOSITORY_ID } from './tests/integration/local-git-fixture.js'
    const cleanups = []; const fx = await makeFixture((c) => cleanups.push(c)); const dir = mkdtempSync(join(tmpdir(), 'b-accept-'))
    const file = join(dir, 'w.sqlite'); const workspace = { id: newWorkspaceId(), name: 'accept' }
    const providers = { ...createFakeProviders(), development: providerFor(fx) }
    let storage = createSqliteStorage(file); let core = await composeCore({ workspace, providers, storage })
    const item = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item')
    const req = { workItemId: item.entityId, repositoryId: REPOSITORY_ID, actor: { kind: 'agent' }, idempotencyKey: 'k1' }
    const face = (r) => `${r.writeState}/${r.status}/${r.degraded}`
    const counts = async () => [(await worktreePaths(fx)).length, providers.execution.state.runs.length]; const before = await counts()
    const first = await core.commands.startWork(req)
    const relations = (await storage.listRelations(workspace.id)).map((r) => `${r.type}:${r.state}`).sort().join(',')
    storage.close(); storage = createSqliteStorage(file); core = await composeCore({ workspace, providers, storage })
    const again = await core.commands.startWork(req); const fresh = await core.commands.startWork({ ...req, idempotencyKey: 'k2' })
    const view = await core.queries.getExecutionContext({ workItemId: item.entityId, repositoryId: REPOSITORY_ID })
    console.log(`first ${face(first)} | ${relations} | reopen ${face(again)} ${face(fresh)} | query ${view.status}/${view.degraded} | 工作树 / run 增量 ${(await counts()).map((n, i) => n - before[i]).join(' / ')}`)
    storage.close(); for (const c of cleanups) await c(); rmSync(dir, { recursive: true, force: true })
    EOF

期望（2026-10-02 在 #253 合入前的最终树上连跑 3 次一致）：`first saved/ready/false | has_worktree:confirmed,tracks:confirmed | reopen saved/ready/false saved/ready/false | query ready/false | 工作树 / run 增量 1 / 1`。

## Artifacts and Notes

观察快照（2026-10-01 15:39 CST；检出 `fix/start-work-sqlite-prerequisites` 的暂存工作树，base为A文档提交）：技能lint为OK，13章次序与本地Markdown链接解析通过；`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed /0 failed；`git diff --cached --check` 退出0。暂存diff复用仓库 `scanDiff` / `tally` 检查为公开面0命中、code=0、docs=246，这是记录前的一次观察；最终体量重算 `git diff --numstat fix/repository-identity...HEAD`。人工检查凭据、本机身份、账号个人信息、内部系统与保密内容均无命中。

正式证据只保存检出分支/观察head、仓库相对路径、可复制命令与关键读回；本地独立设计/探针包不发布其绝对路径。真正验收对照context对应runId与外部增量，记录preflight、stepack、final、run各边界；不能仅写total test count、SQL完整性或Ready来替代业务闭环。

B-1 基线（2026-10-01 17:33 CST，检出 `fix/start-work-sqlite-prerequisites` @ `b07fbe9`，仅本计划有未提交的订正）：前提组（`Validation and Acceptance` 的命令三）为 tests 411 / suites 7 / pass 411 / fail 0 / cancelled 0；期望同值，B-1 每个提交前后重算。

B-1 证据（2026-10-01，检出 `fix/start-work-sqlite-prerequisites`；提交一律以主题行指代，SHA 在主控重基后会变）。

度量基准：B 实施期间叠在 A 的 `004470e` 上，`fix/repository-identity` 此后被更新（提交被重写），所以本批行数对 `004470e` 度量：`node scripts/rule-checks.mjs size 004470e` 为代码 477 / 文档 345（本批的证据提交之前）；对已更新的 `fix/repository-identity` 度量会把 A 的旧提交算进 B（当时为代码 578），重基之后再对它度量才是 B 自己的行数。各提交的代码行数：前提先行 76，挂载契约 58，core 写前登记 343。

RED → GREEN（每个判别性用例在旧生产代码上因功能缺失而红，不是拼写或导入错误）：

- 前提先行：前后各跑前提组，tests 411 / pass 411 / fail 0，用例数不变；该提交没有 RED，它在无守卫的基线上就为绿。
- 挂载契约：RED（只写测试与台账，生产代码未改）`node --test tests/contract/storage-contract.test.js` 为 tests 131 / pass 127 / fail 4，四个失败都是新用例（两个适配器各两条）：同键换身份时 `Missing expected rejection`（替身与 SQLite 都被静默覆盖）；同一个 id 挂到第二个工作区时，替身的 `listRepositories` 为空（旧挂载被搬走），SQLite 在已有上下文引用时报 `FOREIGN KEY constraint failed`。GREEN：131 / 131，前提组 415 / 415。
- 写前登记：RED `node --test tests/integration/start-work-sqlite-registration.test.js` 为 tests 14 / pass 0 / fail 14。SQLite 的七条都以 `FOREIGN KEY constraint failed` 失败：六条死在认领上下文时的复合外键（#188），挂载冲突一条因为预置了挂载、认领通过后死在外部写入之后的关系端点外键（#187，栈在 `#upsertRelation`）；替身的七条各自死在功能缺失：canonical 身份没有登记、外部写入时挂载为空、不存在的工作项报 saved 并落一条 ready 上下文、不存在的仓库落一条 failed 上下文并写出 tracks 边与 failed 的 attempt、挂载冲突没有预检（`error.code` 为 undefined）、写前注入从不触发（命中 `{ calls: 0, thrown: 0 }`）、第二个工作区没有挂载。GREEN：14 / 14；前提组 429 / 429（411 + 契约 4 + 新用例 14）；既有 Start Work 契约组（`Validation and Acceptance` 的命令二）tests 49 / pass 49，连跑三次都不随机红。
- 分叉格翻转：先改共享用例与适配器能力位，RED 恰好一条（替身的「执行上下文 → 仓库」仍被接受），再补替身的仓库父边，GREEN 131 / 131。

注入点与外部增量：写前事务注入 `injectAfterWrite(storage, 'putRepository', 1)` 在两个适配器上都是 `{ calls: 1, thrown: 1 }`，同场景无故障正控是 `{ calls: 1, thrown: 0 }` 且 Ready；注入后的外部增量（分支、工作树、运行）与本地快照（挂载、context、关系、attempt、实体）和注入前逐字相同。空仓库集合首启的外部增量是 `[1, 1, 1]`，工作项守卫与 ack / 能力门表的每个拒绝行都是 0 外部写入、0 本地新增。

变异表：每个变异先用 `git diff -U0` 证明已生效，再跑窄组（新用例、`storage-contract`、schema 用例与既有 Start Work 契约组；基线 tests 206 / pass 206 / fail 0），随后 `git checkout` 还原并确认树干净。30 个变异里 29 个被抓住；唯一存活的 M07 是等价变异体，已在 core 写前登记的提交里删除重复条目。

| 编号 | 变异 | 文件 | 红的用例 |
|---|---|---|---|
| M01 | 去掉工作项预检 | `start-work.ts` | 工作项守卫 2 |
| M02 | 预检放行 change_request | `start-work.ts` | 工作项守卫 2 |
| M03 | 预检放行 redacted | `start-work.ts` | 工作项守卫 2 |
| M04 | ack 不比对 bindingId | `start-work.ts` | ack 与能力门 2 |
| M05 | ack 不比对 objectKind | `start-work.ts` | ack 与能力门 2 |
| M06 | ack 不比对 externalId | `start-work.ts` | ack 与能力门 2 |
| M07 | 去掉门表里的 DevelopmentWorktreeCreate | `start-work.ts` | 0（存活：`resolveWriteTarget` 做同一道写门，重复条目已删除） |
| M08 | 去掉分支创建的门 | `start-work.ts` | ack 与能力门 2 |
| M09 | 去掉仓库读的门 | `start-work.ts` | ack 与能力门 2 |
| M10 | 去掉工作树读的门 | `start-work.ts` | ack 与能力门 2 |
| M11 | 分支创建的门从写门降成读门 | `start-work.ts` | ack 与能力门 2 |
| M12 | 能力门挪到 ack 之后 | `start-work.ts` | ack 与能力门 2 |
| M13 | 写前事务去掉挂载 `putRepository` | `start-work.ts` | 49（新用例与既有 Start Work 用例） |
| M14 | 写前事务去掉 context 实体 | `start-work.ts` | 7 |
| M15 | 写前事务去掉 reserved worktree 实体 | `start-work.ts` | 7 |
| M16 | 写前事务总是新建 canonical 身份 | `start-work.ts` | 两个工作区同一个仓库 2 |
| M17 | 去掉挂载冲突预检 | `start-work.ts` | 挂载冲突预检 2 |
| M18 | 认领事务不调用写前登记 | `start-work.ts` | 49 |
| M19 | 写前登记晚于 Provisioning 写入 | `start-work.ts` | 49 |
| M20 | 认领失败不转结构化 | `start-work.ts` | 写前事务中途失败 2 |
| M21 | 退化 id 不在请求校验里拒绝 | `start-work.ts` | 退化 id 被拒 1 |
| M22 | 已有记录的请求也预检与 ack | `start-work.ts` | local-git 的 R1 / R2 / R3 共 3 |
| M23 | 替身去掉仓库父边 | `providers/fake/src/storage.ts` | 分叉格 1 |
| M24 | 替身不拒绝同键换身份 | `providers/fake/src/storage.ts` | 挂载契约 1 |
| M25 | 替身不拒绝同身份换 id | `providers/fake/src/storage.ts` | 挂载契约 1 |
| M26 | 替身的覆盖键退回只按 id | `providers/fake/src/storage.ts` | 挂载契约与两个工作区同一个仓库 2 |
| M27 | SQLite `putRepository` 去掉先比对 | `storage/sqlite/src/storage.ts` | 挂载契约 1 |
| M28 | SQLite 的 `ON CONFLICT` 目标改回 `(id)` | `storage/sqlite/src/storage.ts` | 25 |
| M29 | 003 退回旧主键 | `003_control_facts.sql` | 3（挂载契约、两个工作区同一个仓库、schema 用例） |
| M30 | 003 去掉 `id TEXT NOT NULL` 的 NOT NULL | `003_control_facts.sql` | schema 用例 1 |

宽验证（观察时刻 2026-10-01 17:49 CST，在 A 的旧 head `004470e` 之上 core 写前登记的提交上，检出 `fix/start-work-sqlite-prerequisites` 的工作树根；命令与期望见 `Validation and Acceptance`）：`pnpm run typecheck` 退出 0；`pnpm run boundaries` 为 tests 8 / pass 8 / fail 0；`pnpm verify` 退出 0，contract + integration + e2e 为 tests 935 / pass 935 / fail 0，mvp0 为 tests 7 / pass 7 / fail 0；`node scripts/workflow-check.mjs` 无发现；窄组一为 tests 145 / pass 145（新用例 14 与 `storage-contract` 131）；`node scripts/rule-checks.mjs disclosure 004470e` 与 `git diff --check 004470e...HEAD` 退出 0。人工五类目（凭据、本机路径与身份、账号与个人信息、内部系统、保密字样）：对相对 `004470e` 的新增行与提交作者逐项检查，无命中；提交作者使用既有 GitHub no-reply 邮箱。

计数基准（观察时刻与基准；重算命令见 `Validation and Acceptance` 的命令一至三与 `pnpm verify`）：上文 B-1 的各计数观察于 A 的旧 head `004470e` 之上；B 重基到 A 的最终 head `a93d572` 之后，凡含 A 新增共享契约用例的计数各 +1：前提组基线 411 → 412，`storage-contract` 131 → 132，窄组一 145 → 146，整套 935 → 936（对抗验证观察于 `55b6952`，整套为 `pnpm verify` 里 contract + integration + e2e 的 tests 数）。数字是观察，不是期望：期望是同一棵树上改动前后用例数的关系——前提提交不增减，每个新用例各增 1——重基或后续批次改动之后以当时的基准重算，不沿用这里的值。

B-1 对抗验证修复的证据（2026-10-01 18:5x CST，检出 `fix/start-work-sqlite-prerequisites`；提交以主题行指代）：新用例在现有实现上通过，价值在杀变异。每个变异先用 `git diff -U0` 证明已生效，再跑相关窄组，随后 `git checkout` 还原并确认树干净；编号取对抗验证的原编号，`V` 前缀表示本批在同一树上复跑：

| 编号 | 变异 | 文件 | 红的用例 |
|---|---|---|---|
| V58 | 预检的身份查找种类写成 branch（已挂载的仓库被当作冲突） | `start-work.ts` | 同一工作区的第二个工作项 2 |
| V31 | 登记移出认领事务，先于它单独提交 | `start-work.ts` | 写前事务中途失败（认领写注入）2 |
| V11 | 仓库读门从读升成写 | `start-work.ts` | 只读的读能力 2 |
| V11b | 工作树读门从读升成写（同类） | `start-work.ts` | 只读的读能力 2 |
| V26 | canonical 身份角色写成 alias | `start-work.ts` | 空仓库首启 2 |
| V45 | SQLite 先比对的读不按工作区限定 | `storage/sqlite/src/storage.ts` | 挂载契约：同一个仓库 id 挂在两个工作区 1 |
| V54 | 替身 `putRepository` 的 mounts 不按工作区过滤 | `providers/fake/src/storage.ts` | 同上 1 |
| V56 | 替身 `putExecutionContext` 的仓库父边不按工作区限定 | `providers/fake/src/storage.ts` | 分叉格：执行上下文 → 仓库 1 |
| V22 / V23 / V24 | 登记去掉 context 实体 / reserved worktree 实体 / 挂载（F7 之后合并用例仍须杀它们） | `start-work.ts` | 分别 7 / 7 / 12，合并后的首启用例在两个适配器上都红 |

认领失败收窄的行为观察（2026-10-01 18:4x CST @ `c466282`，替身 Storage）：分支步之后中断、租约过期后续跑时，认领事务写后失败，`startWork` 以原错误拒绝（`{"rejected":"认领写后失败"}`），不再返回「没有发起任何外部写入」的结构化失败；新请求的认领失败仍是结构化 `unavailable`（既有写前事务注入用例钉住）。

B-2 证据（2026-10-01，检出 `fix/start-work-sqlite-prerequisites`；提交以主题行指代，编号 M31 起接 B-1 的变异表）。

基线探针（观察 2026-10-01 18:10 CST，生产代码同 `55b6952`）：对根 Storage 的 `putMutationAttempt` 注入写后失败，替身与 SQLite 的读回相同：`startWork` 被拒，context 为 `ready`，关系为 `tracks:confirmed` 与 `has_worktree:confirmed`，attempt 为 `saved`，context 对应的 run 没有记录，外部分支 / 工作树已建好。B-2 之后的回读命令（在检出根运行；期望 `{"outcome":"unknown","context":"provisioning","relations":[],"attempts":[]}`；在基线上同一场景期望 `outcome` 为 `rejected`、`context` 为 `ready`、`relations` 为两条 confirmed、`attempts` 为 `["saved"]`）：

    node --disable-warning=ExperimentalWarning --input-type=module -e "import { composeCore, contextIdFor } from '@harness-projects/core'; import { createFakeProviders } from '@harness-projects/provider-fake'; import { newWorkspaceId } from '@harness-projects/domain'; const providers = createFakeProviders(); const workspaceId = newWorkspaceId(); const core = await composeCore({ workspace: { id: workspaceId, name: 'p' }, providers }); const workItemId = (await core.queries.listPlanningItems()).find((v) => v.content.contentKind === 'work_item').entityId; const write = providers.storage.putMutationAttempt.bind(providers.storage); const tx = providers.storage.transaction.bind(providers.storage); providers.storage.putMutationAttempt = async (r) => { await write(r); throw new Error('注入') }; providers.storage.transaction = (work) => tx((t) => work(new Proxy(t, { get(o, k) { const v = Reflect.get(o, k, o); return k === 'putMutationAttempt' ? async (r) => { await v.call(o, r); throw new Error('注入') } : typeof v === 'function' ? v.bind(o) : v } }))); const outcome = await core.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'k' }).then((r) => r.writeState, (e) => 'rejected'); console.log(JSON.stringify({ outcome, context: (await providers.storage.getExecutionContext(contextIdFor(workspaceId, workItemId, 'repo-alpha')))?.status, relations: (await providers.storage.listRelations(workspaceId)).map((r) => r.type + ':' + r.state).sort(), attempts: (await providers.storage.listMutationAttempts(workspaceId)).map((a) => a.state) }))"

RED → GREEN：先只写测试与 harness（生产代码未改），`node --test tests/integration/start-work-sqlite-registration.test.js` 为 14 通过 / 8 失败，失败的恰好是 8 个新用例，原因都是功能缺失：三个 Unknown 用例（最终事务的最后一写、第二条关系、分支步回填）两个适配器各一，都以注入的错误原样拒绝（调用方拿到 promise 拒绝而不是结构化结果）；工作树步失败的用例两个适配器各一，读到 `tracks` 与 `has_worktree` 两条边而不是只有 `tracks`（借了分支句柄，#192）。实现后 24 / 24（B-1 修复提交之后的树上：16 个原有加 8 个新增）。重排提交之后在 B-1 修复的树上重现了同样的 RED（24 个里 8 个失败，原因相同）。

注入点命中计数与外部增量（外部增量按分支、工作树、运行，两个适配器相同）：`putMutationAttempt` 第 1 次 `{ calls: 1, thrown: 1 }`，增量 `[1, 1, 0]`，无故障正控 `{ calls: 1, thrown: 0 }`；`putRelation` 第 2 次 `{ calls: 2, thrown: 1 }`，增量 `[1, 1, 0]`，正控 `{ calls: 2, thrown: 0 }`；分支步回填的 `putExecutionContext` 第 2 次 `{ calls: 2, thrown: 1 }`，增量 `[1, 0, 0]`（工作树步没有开始），正控 `{ calls: 4, thrown: 0 }`；工作树步失败的结算写 `putMutationAttempt` 第 1 次 `{ calls: 1, thrown: 1 }`，正控 `{ calls: 1, thrown: 0 }`。无故障的空仓库首启增量仍是 `[1, 1, 1]`。

变异表：每个变异先用 `git diff -U0` 证明已生效，再跑窄组（新文件、`storage-contract`、既有 Start Work 契约组与 `write-machine`；基线 tests 208 / pass 208 / fail 0），随后 `git checkout` 还原并确认树干净；在最终树上整表重跑，28 个变异全部被抓住，没有存活。第一版的 M39 是语法错误（箭头函数里 `await`），10 个文件整体变红不算行为击杀，已改成 `async` 回调后重跑。

| 编号 | 变异 | 文件 | 红的用例 |
|---|---|---|---|
| M31 | 工作树末步的钩子写回 Ready | `git-provisioning.ts` | 最终事务两行 4 |
| M32 | 最终事务里把 `putMutationAttempt` 挪出事务（提交后用根 Storage 写） | `start-work.ts` | 最终事务最后一写 2、工作树步失败 2 |
| M33 | 最终事务里去掉 has_worktree | `start-work.ts` | 14（三行注入、首启、既有 has_worktree 用例） |
| M34 | 最终事务里去掉 tracks | `start-work.ts` | 10 |
| M35 | slot 的分支句柄 fallback 恢复（#192） | `start-work.ts` | 工作树步失败 2（只有它） |
| M36 | 本地写失败不转 Unknown（让它拒绝） | `start-work.ts` | 8 |
| M37 | 本地写失败报成 Saved | `start-work.ts` | 8 |
| M38 | 失败结算不写 attempt | `start-work.ts` | 工作树步失败 2、同 key 幂等 1 |
| M39 | Unknown 路径仍调用 `startRun` | `start-work.ts` | 三行注入 6 |
| M40 | 在 Provider 调用外加宽 catch，吞掉非本地写的异常 | `start-work.ts` | 11（既有崩溃 / 恢复用例） |
| M41 | 钩子对两步都写 Ready | `start-work.ts` | 19 |
| M42 | 步骤回填写没有 `localWrite` 标记 | `start-work.ts` | 分支步回填行 2 |
| M43 | 最终事务没有 `localWrite` 标记 | `start-work.ts` | 6 |
| M44 | 结算失败的 Unknown 结果面带 Ready | `start-work.ts` | 最终事务两行 4 |
| M45 | 最终事务总是写 Ready（失败也写） | `start-work.ts` | 7 |
| M46 | 最终事务里 context 记录用根 Storage 写 | `start-work.ts` | 10 失败 + 50 取消（替身死锁，SQLite 结构化失败） |
| M47 | 最终事务里关系用根 Storage 写 | `start-work.ts` | 10 失败 + 50 取消 |
| M48 | 最终事务里账本用根 Storage 写 | `start-work.ts` | 10 失败 + 49 取消 |
| M49 | Unknown 的错误码不是 `result_unknown` | `start-work.ts` | 8 |
| M50 | Unknown 结果面丢掉工作树句柄 | `start-work.ts` | 最终事务两行 4 |
| M51 | 失败路径也继续 `startExecution` | `start-work.ts` | 2（既有：local-git R2、#77 ambiguous） |
| M52 | 工作树末步不回填句柄 | `git-provisioning.ts` | 6 |
| M53 | 步骤回填写丢掉租约 | `start-work.ts` | 7 |
| M54 | 分支步回填写失败被吞掉（`provisionGit` 里 catch） | `git-provisioning.ts` | 分支步回填行 2 |
| M55 | 最终事务不是事务（直接用根 Storage 逐条写） | `start-work.ts` | 6 |
| M56 | Unknown 结果面 `degraded=false` | `start-work.ts` | 6 |
| M57 | `createWriteLedger` 参数还原为完整 `Storage` | `write-machine.ts` | `tsc` TS2345 |
| M58 | `recordEdges` 参数还原为完整 `CoreContext` | `relations.ts` | `tsc` TS2345 |

宽验证（观察时刻 2026-10-01 19:02 CST @ `cf1a9cb`，检出 `fix/start-work-sqlite-prerequisites` 的工作树根；命令与期望见 `Validation and Acceptance`）：`pnpm run typecheck` 退出 0；`pnpm run boundaries` 为 tests 8 / pass 8 / fail 0；`pnpm verify` 退出 0，contract + integration + e2e 为 tests 946 / pass 946 / fail 0，mvp0 为 tests 7 / pass 7 / fail 0；命令一（新文件与 `storage-contract`）为 tests 156 / pass 156 / fail 0；命令二为 tests 49 / pass 49 / fail 0；命令三为 tests 440 / pass 440 / fail 0；`node scripts/workflow-check.mjs` 退出 0；`node scripts/rule-checks.mjs size fix/repository-identity` 的代码为 613 / 1000（相对 A 的累计，含 B-1 的对抗验证修复；本批相对批次起点 `git diff --numstat 81cef51...cf1a9cb` 的 code 为 138，增 104、删 34）；`node scripts/rule-checks.mjs disclosure fix/repository-identity` 与 `git diff --check fix/repository-identity...HEAD` 退出 0。人工五类目（凭据、本机路径与身份、账号与个人信息、内部系统、保密字样）：对相对 A 的新增行与提交作者逐项检查，无命中；提交作者使用既有 GitHub no-reply 邮箱。这些是观察，重算命令与期望见上，基准关系见「计数基准」（B-1 修复之后的树 @ `81cef51` 为整套 938、命令三 432、命令一 148；B-2 的 8 个新用例使这三个计数各 +8）。

B-3 证据（2026-10-01，检出 `fix/start-work-sqlite-prerequisites`；提交以主题行指代，最终代码提交是 `ebc6c11`，其后只有文档提交）。

RED → GREEN：先只写测试与 harness（生产代码未改），`node --test tests/integration/start-work-sqlite-registration.test.js` 为 tests 38 / pass 30 / fail 8（观察 2026-10-01 19:24 CST @ `98bb08c` 的生产代码），失败的恰好是「Ready 之后的重放与读取」表里的 4 个故障行 × 两个适配器，原因都是功能缺失：run 记录写失败——`startWork` 以注入的错误 `注入的写失败` 原样拒绝（调用方拿到拒绝，而外部 run 已经起来）；ack 的状态不是已知取值——首次报 `saved / confirmed / degraded=false`；两条关系的写入被静默丢掉（has_worktree、tracks 各一行）——首次正常 Saved，同 key 重放仍报 `saved / confirmed / degraded=false`（守卫缺失）。其余 30 个为绿：原有 24 个，加完整正控、同 key 重放先于预检、租约内在途三个回归守卫（各 × 2）。实现后 38 / 38；之后为杀变异补两行（主执行 ack 为 `failed`、关系只是候选）得到 42 / 42；对抗验证修复轮再加缺口行与文案用例，得到 48 / 48。

注入点与外部增量：`putExecutionRun` 第 1 次写不进去 `{ calls: 1, thrown: 1 }`，无故障正控 `{ calls: 1, thrown: 0 }`；首次开始工作后外部增量是分支、工作树、运行各 +1（`[1, 1, 1]`），本地没有 run 记录；ack 状态不是已知取值一行没有命中计数，由本地 run 记录为 `unknown` 与外部增量 `[1, 1, 1]` 证明注入生效；之后同 key / 新 key / 关库重开后的新 key 三次开始工作，`world` 快照（外部增量、挂载、context、run、关系、attempt、实体）逐字不变，Query 在两个 core 上各读一次、包装全部 provider 的方法计数为 0。失败结算文案：`putMutationAttempt` 第 1 次 `{ calls: 1, thrown: 1 }`，无故障正控 `{ calls: 1, thrown: 0 }`，分支创建被拒绝的外部增量 `[0, 0, 0]`。

读回证据（观察 2026-10-01 20:42 CST @ `ebc6c11`；回读命令见 `docs/product/vertical-path.md` §2.1「用例回读」，期望：每个前缀 `ℹ tests` 不小于 1、`ℹ fail 0`，伪造前缀读回 `ℹ tests 0` 且没有 `✔` 行）：第 6、7 行引用的 25 个用例前缀全部满足；新增前缀读回的用例数：「空仓库集合上开始工作」2、「工作项守卫」2、「ack 与能力门」2、「ack 之后本地写失败」10、「Ready 之后的重放与读取」14、「工作树步失败」2、「租约内的在途」2。

探针观察（观察 2026-10-01 19:4x CST @ `b230a73`，新选取器，各 6 次输出一致；命令在 `docs/product/vertical-path.md` §2.1「复现命令」）：P3 `relations 2 -> 9 | ci online 5 | ci offline 0 | degraded true`；P4 `second saved | context for b? false`；X1 `no repo failed not_found | no item failed not_found | contexts 0`（旧值 `no item saved ready | contexts 2`）。旧选取器（`v.kind === 'work_item'`）在 `ebc6c11` 上跑 24 次，X1 的第一项 16 次是 `no repo failed not_found`、8 次是 `no repo failed unavailable`（命中内容被扣下的 `issue-3`），观察值随机，这是改选取器的原因。同一检出上直接 `putExecutionContext` 一个未登记的工作项：替身 `resolved`，SQLite 抛 `FOREIGN KEY constraint failed`（#196 仍开放）。

B-3 变异表（观察 2026-10-01 21:38 – 21:43 CST @ `c7a6738`，整表重跑（S2、S7 的锚点随代码改写而更新，变异内容不变）；每个变异先用 `git diff -U0` 证明已生效，再跑三组：新文件、命令二、e2e 加 mvp0，随后按原文还原并核对 `git status --short` 为空；26 个全部被抓住，没有存活；「红的用例」是失败的用例数，两个适配器各一份，所以多数是 2 的倍数）：

| 编号 | 变异 | 文件 | 红的用例 |
|---|---|---|---|
| E1 | 去掉 run 缺失检查（无 run 当作完整） | `execution-context.ts` | 新文件 4 |
| E2 | 去掉 run Unknown 检查 | `execution-context.ts` | 新文件 2 |
| E3 | 去掉 has_worktree 必需边 | `execution-context.ts` | 新文件 4 |
| E4 | 去掉 tracks 必需边 | `execution-context.ts` | 新文件 2 |
| E5 | 边只要存在就算（不要求 confirmed） | `execution-context.ts` | 新文件 2 |
| E6 | has_worktree 的 to 写错成 context 实体 | `execution-context.ts` | 新文件 4；命令二 1；e2e / mvp0 2 |
| E7 | Query 的 degraded 不看缺口 | `execution-context.ts` | 新文件 10 |
| E8 | Query 对任何状态都算缺口 | `execution-context.ts` | 新文件 2 |
| E9 | Query 里调用 provider（getRepository） | `execution-context.ts` | 新文件 14 |
| E10 | Query 里补写缺的 tracks 边（读路径修复） | `execution-context.ts` | 新文件 2 |
| E11 | 把 failed 的 run 也当缺口（不能由 failed 反推） | `execution-context.ts` | 新文件 2 |
| E12 | tracks 边的 from / to 写反 | `execution-context.ts` | 新文件 4；命令二 1；e2e / mvp0 2 |
| S1 | 完整性守卫去掉（Ready 即 Saved） | `start-work.ts` | 新文件 12 |
| S2 | supplied 的 Failed / Unknown 被 Ready 提升（忽略 supplied） | `start-work.ts` | 新文件 2 |
| S3 | 守卫误伤 Provisioning（对非 Failed 一律判） | `start-work.ts` | 新文件 4 |
| S4 | recordRun 失败不转 Unknown（去掉 localWrite） | `start-work.ts` | 新文件 4 |
| S5 | recordRun 失败被吞掉 | `start-work.ts` | 新文件 2 |
| S6 | Unknown 结果不带已 ack 的 run 句柄 | `start-work.ts` | 新文件 2 |
| S7 | run 状态未知时顶层仍是 Saved | `start-work.ts` | 新文件 4 |
| S8 | Unknown 路径仍起第二个 run（有缺口的 Ready 被重新认领） | `start-work.ts` | 新文件 10 |
| S9 | 守卫在读路径上降级 context（写 Failed） | `start-work.ts` | 新文件 12 |
| S10 | 守卫只管同 key 的 supplied（无 supplied 的新 key 不判） | `start-work.ts` | 新文件 10 |
| S11 | 守卫忽略 supplied Saved（只判 reportForExisting 的新 key） | `start-work.ts` | 新文件 12 |
| S12 | run 记录写失败的 Unknown 结果面带 Provisioning（不是 Ready） | `start-work.ts` | 新文件 2 |
| S13 | 守卫不看 supplied 是否会报 Saved（Failed / Unknown 报告也被改写） | `start-work.ts` | 新文件 2 |
| S14 | 预检先于同 key 重放，且对已有记录也预检 | `start-work.ts` | 新文件 2；命令二 3 |

对抗验证修复轮的变异表（verify-b2 的缺口与文案修复；「补丁前」是 `12212a1` 的树（观察 2026-10-01 20:2x CST），「补丁后」是 `c7a6738` 的树（观察 2026-10-01 21:38 – 21:43 CST）；每个先用 `git diff -U0` 证明已生效；三组：新文件、存储契约 `storage-contract`、命令二，下表列出有失败的组）：

| 编号 | 变异 | 文件 | 补丁前 | 补丁后 |
|---|---|---|---|---|
| B18 | context 的 Ready 写在事务提交之后（根 Storage，关系与账本已先提交） | `start-work.ts` | 0（存活） | 新文件 2 |
| B20 | 工作树步回填写失败时，Unknown 结果面丢掉工作树句柄 | `start-work.ts` | 0（存活） | 新文件 2 |
| B22 | Ready 记录保留租约（keepLease 恒取 existing） | `start-work.ts` | 0（存活） | 新文件 10 |
| B40 | 末步（工作树）回填写失败被吞 | `git-provisioning.ts` | 0（存活） | 新文件 2 |
| X1 | 替身 putExecutionContext 的仓库父边只查工作区、不查仓库 id | `providers/fake/src/storage.ts` | 0（存活） | 契约 1 |
| Y2 | 替身 putRepository 的「同身份换 id」检查不按工作区过滤 | `providers/fake/src/storage.ts` | 0（存活） | 契约 1 |
| R56 | 替身 putExecutionContext 的仓库父边不按工作区（verify-b1 的 F3 缺口） | `providers/fake/src/storage.ts` | 契约 1 | 契约 1 |
| Q1 | Unknown 文案恒称已 ack（没有任何 ack 也说） | `start-work.ts` | —（用例随修复一起写，先红后绿） | 新文件 2 |
| Q2 | Unknown 文案恒不称已 ack（有已 ack 的分支也不说） | `start-work.ts` | — | 新文件 2 |
| Q3 | 失败结算时 provider 的原始失败被「本地结算失败」盖掉 | `start-work.ts` | — | 新文件 4 |
| Q4 | 原始失败只带 message、不带错误码 | `start-work.ts` | — | 新文件 4 |
| Q5 | 已 ack 的判据看工作树句柄而不是分支句柄 | `start-work.ts` | — | 新文件 2 |

文案用例的 RED（观察 2026-10-01 20:27 CST @ `efbd096` 的生产代码）：新文件 tests 48 / pass 44 / fail 4（两条用例 × 两个适配器）；失败的断言是：有已 ack 的分支一行，实际文案 `本地结算失败，已 ack 的外部资源保留、不自动删除，需先对账、不要盲目重试：注入的写后失败` 不含 provider 的原始失败（期望匹配 `已 ack.*unavailable.*注入的工作树失败`）；没有任何 ack 一行，同一句话仍称「已 ack」（期望不含），原始失败同样缺失。

宽验证（观察 2026-10-01 20:3x CST @ `ebc6c11`，检出 `fix/start-work-sqlite-prerequisites` 的工作树根；命令与期望见 `Validation and Acceptance`）：`pnpm run typecheck` 退出 0；`pnpm run boundaries` 为 tests 8 / pass 8 / fail 0；`node scripts/workflow-check.mjs` 退出 0；`pnpm verify` 连跑三次都退出 0，contract + integration + e2e 为 tests 970 / pass 970 / fail 0，mvp0 为 tests 7 / pass 7 / fail 0；命令一为 tests 180 / pass 180、命令二 49 / 49、命令三 464 / 464、新文件 48 / 48；`node --test tests/contract tests/integration tests/e2e tests/mvp0` 连跑三次都是 tests 977 / pass 977 / fail 0 / cancelled 0。`node scripts/rule-checks.mjs size fix/repository-identity` 的代码为 735 / 1000；`node scripts/rule-checks.mjs disclosure fix/repository-identity` 与 `git diff --check fix/repository-identity...HEAD` 退出 0；ExecPlan lint 输出 `OK: ExecPlan passed lint checks.`；`tests/contract/plan-facts-consistency.test.js` 与 `tests/contract/content-placement.test.js` 为 9 / 9。人工五类目（凭据、本机路径与身份、账号与个人信息、内部系统、保密字样）：对相对 A 的新增行与提交作者逐项检查，无命中；提交作者使用既有 GitHub no-reply 邮箱。这些是观察，重算命令与期望见上，基准关系见下一段。

计数基准（观察 2026-10-01 20:37 CST @ `ebc6c11`；重算命令见 `Validation and Acceptance`）：新文件 48，`storage-contract` 132，命令一 180，命令二 49，命令三 464，`pnpm verify` 为 970 加 mvp0 7，contract + integration + e2e + mvp0 共 977。相对 B-2 之后（`98bb08c`：命令三 440、命令一 156、`pnpm verify` 946 加 7）各 +24：B-3 的 18 个用例（表 7 行 × 2、同 key 重放先于预检 × 2、租约内在途 × 2）、对抗验证补的 4 个（`LOCAL_FAILURES` 两行 × 2）与失败结算文案的 2 个。期望是同一棵树上改动前后用例数的关系（每个新用例各增 1），后续改动之后以当时的基准重算，不沿用这里的值。Superseded by 下文「终局对抗验证后的小修证据」的计数基准（2026-10-01 21:37 CST @ `c7a6738`）。

终局对抗验证后的小修证据（2026-10-01；verify-b3 对 `dee1d5f` 的验证，PASS_WITH_FINDINGS，无 P0 / P1；提交 `fix(core): 重放与接管不再把非 Ready 或未知运行报成 Saved` 与 `test(core): 钉住接管时主执行 ack 为 failed 的运行仍是已确认的运行`，最终代码提交是 `c7a6738`，其后只有文档提交）。

RED → GREEN：先只写测试（生产代码未改，观察 2026-10-01 21:30 CST @ `dee1d5f`），`node --test tests/integration/start-work-sqlite-registration.test.js` 为 tests 54 / pass 48 / fail 6，失败的恰好是重放的两行（`failed`、`provisioning`）与接管的 unknown 一行 × 两个适配器，原因都是功能缺失：同 key 的 saved attempt 遇到 Failed 或 Provisioning 的记录，两次重放都是 `saved / confirmed=true`（期望 `failed / false` 与 `pending / false`；记录的状态是 failed、provisioning，结果面却说 saved）；接管已有的 unknown run，返回 `saved / confirmed`、不带 run 句柄，文案断言也不成立。其余 48 个为绿，含 Q6 的断言（现有实现在没有原始失败时本来就不拼后缀，价值在杀变异）。实现后 54 / 54；接管用例改成表驱动（run 为 unknown / failed 两行）后 56 / 56。

对抗验证者的探针在修复后的树上复跑（观察 2026-10-01 21:3x CST @ `c7a6738`；这些探针是验证者的运行态脚本，不在仓库，这里只记观察）：工作树消失后的重放探针，第二次重放得 `failed`（修复前为 `saved / confirmed=true`，状态却写着 failed），替身与 SQLite 相同；接管探针：run 为 unknown 时接管得 `unknown / confirmed=false`，文案「运行状态未知（已有的 run 记录是 unknown）……」，下一次新 key 同为 `unknown`，`startRun` 共 1 次；状态 × run × 边 × attempt 的 192 种组合扫描里「不该报 Saved 却报了」的组合为 0（修复前 36）；Ready 之后的启动窗口探针输出不变（TD-012）。

终局对抗验证后的变异表（观察 2026-10-01 21:38 – 21:43 CST @ `c7a6738`；每个变异先用 `git diff -U0` 证明已生效，再跑三组：新文件、命令二、e2e 加 mvp0，还原后核对树干净；N4 是等价变异体，其余全部被抓住）：

| 编号 | 变异 | 文件 | 红的用例 |
|---|---|---|---|
| N1 | 同 key 的 saved 报告在非 Ready 的记录上原样返回（去掉 P2-2 的修复） | `start-work.ts` | 新文件 4 |
| N2 | 只改判 Failed 的记录（Provisioning 仍报 Saved） | `start-work.ts` | 新文件 2 |
| N3 | 只改判 Provisioning 的记录（Failed 仍报 Saved） | `start-work.ts` | 新文件 2 |
| N4 | Ready 的记录也用记录自己的报告（等价：Ready 的默认报告就是 Saved） | `start-work.ts` | 0（存活：等价变异体） |
| N5 | 非 Ready 的记录改判成 Ready 的报告（仍是 Saved） | `start-work.ts` | 新文件 4 |
| N6 | 接管时已有的 run 为 unknown 仍报 Saved（去掉 P2-3 的修复） | `start-work.ts` | 新文件 2 |
| N7 | 接管时 Unknown 结果不带已有 run 的句柄 | `start-work.ts` | 新文件 2 |
| N8 | 接管时已有的 run 只要不是 running 就报 Unknown（连主执行 ack 的 failed 也算） | `start-work.ts` | 新文件 2 |
| N9 | 运行状态未知的文案沿用「本地结算失败」 | `start-work.ts` | 新文件 2 |
| N10 | 接管时 Unknown 报告丢掉 Ready 状态（带 Provisioning） | `start-work.ts` | 新文件 2 |
| Q6 | 无原始失败时仍拼出「本次外部调用的失败：undefined」后缀 | `start-work.ts` | 新文件 10 |

宽验证（观察 2026-10-01 21:37 CST @ `c7a6738`，检出 `fix/start-work-sqlite-prerequisites` 的工作树根；命令与期望见 `Validation and Acceptance`）：`pnpm run typecheck` 退出 0；`pnpm run boundaries` 为 tests 8 / pass 8 / fail 0；`node scripts/workflow-check.mjs` 退出 0；`pnpm verify` 连跑三次都退出 0，contract + integration + e2e 为 tests 978 / pass 978 / fail 0，mvp0 为 tests 7 / pass 7 / fail 0；命令一为 tests 188 / pass 188、命令二 49 / 49、命令三 472 / 472、新文件 56 / 56；`node --test tests/contract tests/integration tests/e2e tests/mvp0` 连跑三次都是 tests 985 / pass 985 / fail 0 / cancelled 0。`node scripts/rule-checks.mjs size fix/repository-identity` 的代码为 748 / 1000（`c7a6738` 之后只有文档提交，代码行数不再变）。`disclosure`、`git diff --check fix/repository-identity...HEAD`、ExecPlan lint 与文档契约的期望见 `Validation and Acceptance`（退出 0、`OK: ExecPlan passed lint checks.`、9 / 9）。

计数基准（观察 2026-10-01 21:37 CST @ `c7a6738`；重算命令见 `Validation and Acceptance`）：新文件 56，`storage-contract` 132，命令一 188，命令二 49，命令三 472，`pnpm verify` 为 978 加 mvp0 7，contract + integration + e2e + mvp0 共 985。相对 B-2 之后（`98bb08c`：命令三 440、命令一 156、`pnpm verify` 946 加 7）各 +32：B-3 的 18 个用例、对抗验证补的 4 个与文案的 2 个，加这一轮的 8 个（重放的两行 × 2、接管的两行 × 2）。期望仍是同一棵树上改动前后用例数的关系（每个新用例各增 1），后续改动之后以当时的基准重算。Superseded by 下文「独立验收证据」的计数基准（2026-10-01 22:14 CST @ `0dcd129`）。

独立验收证据（2026-10-01，accept-b；在检出 `fix/start-work-sqlite-prerequisites` 的工作树根、一次性检出 `.worktrees/verify-b` 与仓库外的 `git archive` 副本上运行；提交以 SHA 前缀指代，只在本分支未被改写时有效，以 `git log --oneline fix/repository-identity..fix/start-work-sqlite-prerequisites` 回读；探针与变异脚本是验收者的运行态脚本，不在仓库，这里只记观察）。

第一手命令（观察 2026-10-01 21:55 – 21:56 CST @ `271e497`，工作树干净）：命令一 tests 188 / pass 188；命令二 49 / 49；命令三 472 / 472；`pnpm run typecheck` 退出 0；`pnpm run boundaries` 8 / 8；`pnpm verify` 连跑三次都退出 0，每次 contract + integration + e2e 为 978 / 978、mvp0 为 7 / 7。

逐提交为绿（观察 2026-10-01 21:58 – 22:22 CST；在 `.worktrees/verify-b` 上逐个 `git checkout --detach <提交>`，每个提交跑 30 文件组——预审的 29 个相关文件加新文件，逐文件 `node --test --test-timeout=20000`——以及 `pnpm run typecheck`、`pnpm verify` 与两条文档契约；结束时 `git status --short` 为空）：

| 提交 | 30 文件组 | typecheck | `pnpm verify`（contract + integration + e2e / mvp0） | 文档契约 |
|---|---|---|---|---|
| `a93d572`（A，基线）、`1340cad`、`389ced5`、`e88d063` | 412 / 412（新文件尚不存在） | 0 | 918 / 7，退出 0 | 9 / 9 |
| `154cf79` | 416 / 416 | 0 | 922 / 7，退出 0 | 9 / 9 |
| `67cac60`、`55b6952` | 430 / 430 | 0 | 936 / 7，退出 0 | 9 / 9 |
| `fddb7ee`、`86554e4`、`c466282` | 434 / 434 | 0 | 940 / 7，退出 0 | 9 / 9 |
| `0de571b`、`81cef51` | 432 / 432 | 0 | 938 / 7，退出 0 | 9 / 9 |
| `cf1a9cb`、`98bb08c` | 440 / 440 | 0 | 946 / 7，退出 0 | 9 / 9 |
| `b230a73`、`7d2fe42`、`12212a1` | 458 / 458 | 0 | 964 / 7，退出 0 | 9 / 9 |
| `efbd096` | 462 / 462 | 0 | 968 / 7，退出 0 | 9 / 9 |
| `ebc6c11`、`dee1d5f` | 464 / 464 | 0 | 970 / 7，退出 0 | 9 / 9 |
| `8bd80e0`（终局小修的生产代码，此前没有单独跑全套） | 470 / 470 | 0 | 976 / 7，退出 0 | 9 / 9 |
| `c7a6738`、`271e497` | 472 / 472 | 0 | 978 / 7，退出 0 | 9 / 9 |
| `0dcd129`（验收的接管修复） | 476 / 476 | 0 | 982 / 7，退出 0 | 9 / 9 |
| `0dcd129`、`569d759`（verify-b4 的独立复跑，复评者的观察） | 476 / 476（新文件 60 / 60） | 0 | 982 / 7，退出 0 | 9 / 9 |
| `a07724a`、`912954f`（独立复评之后的小修，观察 2026-10-01 23:19 – 23:21 CST，每个提交前在其树上跑门） | 478 / 478（新文件 62 / 62） | 0 | 984 / 7，退出 0 | 9 / 9 |

验证者发现的关闭复现（观察 2026-10-01 22:04 – 22:08 CST，在 `271e497` 的 `git archive` 副本上；每个变异先用 `git diff -U0` 证明已生效，再跑 30 文件组（基线 472 / 472），`git checkout --` 还原并核对 `git status --short` 为空；数字是红的用例数，两个适配器各一份）：

| 来源 | 变异与红的用例数 | 结论 |
|---|---|---|
| verify-b1 的缺口（编号同上文 B-1 对抗验证修复的变异表） | V58 2、V31 2、V45 1、V54 2、V56 1、V11 2、V11b 2、V26 2 | 全部被抓住 |
| verify-b2 的缺口与文案（编号同上文对抗验证修复轮的变异表） | B18 2、B20 2、B22 10、B40 2、X1 1、Y2 1、Q1 2、Q2 2、Q3 4、Q4 4、Q5 2 | 全部被抓住，与该表「补丁后」一列逐项相同 |
| 终局小修（编号与锚点同上文终局对抗验证后的变异表） | N1 4、N2 2、N3 2、N5 4、N6 2、N7 2、N8 2、N9 2、N10 2、Q6 10；N4 0 | 与原表逐项相同，N4 是等价变异体 |
| B-3 守卫与 Query 复跑（对应上文 B-3 变异表的同名项，变异写法是验收者独立写的、意图相同） | S1 12、S13 2、S4 4、S5 2、S7 4、E1 4、E2 2、E3 4、E4 2、E5 2、E7 10、E8 2；另加 S2 的一个变体（只对 Ready 忽略 supplied，非 Ready 退回原样返回）6 | 全部被抓住，与 B-3 表的数字逐项相同 |
| 已知存活 | D4 0（TD-006 的入口，见 `Surprises & Discoveries`）；撤销「认领失败转结构化只针对新请求」的收窄 0（按裁决接受，Decision Log 同名决策） | 与 verify-b3 的结论相同 |
| verify-b4 的缺口（O14、O10、M11、O13，另加首次路径的 O13b；观察 2026-10-01 23:16 – 23:21 CST，`569d759` 的树补强前、`a07724a` 的树补强后） | O14 8、O10 2、M11 1、O13 4、O13b 4（补强前 1 / 0 / 0 / 0 / 0，O14 的 1 是一条无关用例） | 全部被抓住，细节见「复评之后的小修证据」 |

verify-b3 的三个 P2 探针在干净的副本上复跑（观察 2026-10-01 22:09 CST @ `271e497`）：工作树消失后的第二次同 key 重放得 `failed`（修复前 `saved / confirmed=true`）；unknown run 的接管得 `unknown / confirmed=false`、下一次新 key 同为 `unknown`、`startRun` 共 1 次；状态 × run × 边 × attempt 192 种组合里「不该报 Saved 却报了」的为 0。

四路径一致性扫描（替身，480 种组合，组合与判据见 `Surprises & Discoveries`）：`271e497` 上不一致 170 种，`0dcd129` 上 46 种，剩下的全是「has_worktree 只是候选」（TD-014；这 480 种里没有 tracks 候选这一档，verify-b4 的 140 个真实流程世界含 tracks 候选，范围是 tracks 或 has_worktree，见下文「独立复评证据」）。接管的五种世界（主执行 ack 的状态未知且接管时主执行可用 / 不可用、只落了人工降级、主执行正常、主执行 ack 为 failed）在替身与 SQLite 上用真实流程各跑一遍：`271e497` 上三种的接管答案与它自己的重放、Query 不一致（主执行不可用时报健康 Saved；人工降级时 `degraded=false` 且不带 `fallback`；正常与 failed 时不带 run 句柄），`0dcd129` 上五种全部一致，外部 run 数都不变。

接管修复的 RED → GREEN：先只写用例（`271e497` 的生产代码），新文件 tests 60 / pass 54 / fail 6，失败的恰好是三个新行为 × 两个适配器，原因都是功能缺失——主执行不可用时接管实际 `saved / true / false`（期望 `unknown / false / true`）、主执行 ack 为 failed 时接管不带 run 句柄、人工降级时接管 `degraded=false` 且不带 `fallback`；实现后 60 / 60。修复的变异（观察 2026-10-01 22:11 CST，在带修复的副本上，基线 476 / 476）：

| 编号 | 变异 | 红的用例 |
|---|---|---|
| A1 | `manualFallback` 的已有 run 分支退回旧写法（不看 unknown） | 主执行不可用的接管 2 |
| A2 | `startExecution` 的已有 run 分支退回旧写法（unknown 仍报 Unknown，其余丢降级与句柄） | 主执行 ack 为 failed、人工降级的接管 4 |
| A3 | 接管结果丢掉降级标记 | 人工降级的接管 2，`human-execution-provider`「主执行起不来、fallback 绑定承接」1 |
| A4 | 接管结果丢掉 run 句柄 | 主执行 ack 为 failed 的接管 2，同上的 fallback 用例 1 |
| A5 | 降级标记从 failed 反推 | 主执行 ack 为 failed 的接管 2，同上的 fallback 用例 1 |
| A6 | 接管时已有 run 也再起一个 | 三类接管 6 |
| N6 | 已有 run 为 unknown 仍报 Saved | 两条 unknown 的接管 4 |
| N7 | unknown 的结果不带已有 run 的句柄 | 4 |
| N8 | 已有 run 只要不是 running 就报 Unknown | failed 与人工降级的接管 4，`local-git-core-provisioning`「恢复供应：同一工作树只保留一条 has_worktree 关系」1 |
| N10 | unknown 的结果丢掉 Ready 状态 | 4 |

文档声明的复现（观察 2026-10-01 22:14 – 22:16 CST @ `0dcd129`）：`docs/product/vertical-path.md` 第 6、7 行引用的 25 个用例前缀逐个按 §2.1 的回读命令读回，都 `ℹ tests` 不小于 1、`ℹ fail 0`，伪造前缀读回 `ℹ tests 0`（脚本另把第 7 行括注里的「工作树冲突」误归到 local-git，它指的是同一格里 start-work 的「工作树冲突：按幂等已存在资源复用」，按 start-work 读回为 1 / 0）；P3、P4、X1 各跑 3 次与文档逐字一致；本计划里的三条内联回读命令分别输出 `{"before":[],"after":["tracks:confirmed"]}`、`81`（400 次抽样里命中被扣下条目的次数，期望约 100）与 `{"outcome":"unknown","context":"provisioning","relations":[],"attempts":[]}`。

计数基准（观察 2026-10-01 22:14 CST @ `0dcd129`；重算命令见 `Validation and Acceptance`）：新文件 60，命令一 192，命令二 49，命令三 476，`pnpm verify` 为 982 加 mvp0 7。相对 `c7a6738`（新文件 56、命令一 188、命令三 472、`pnpm verify` 978 加 7）各 +4：接管用例从两行 × 2 变成四行 × 2。Superseded by 下文「复评之后的小修证据」的计数基准（2026-10-01 23:23 CST @ `912954f`）。

验收的裁决表（`Decision Log`「独立验收维持本计划的十一项取舍」的展开；判错代价指裁决错时要付的代价）：

| 取舍 | 裁决与独立核对 | 判错代价 |
|---|---|---|
| 不加 `getEntity`（Decision Log「不新增 getEntity」） | 维持：投影是「可操作内容」的权威（`actionsFor` 只给 `work_item` 提供开始工作），core 的引导把实体与投影一起写，造不出两者不一致；工作项守卫用例与 M01 – M03 钉住三种拒绝 | 别的写者造出「投影是 work_item、实体是别的种类」时开始工作照常进行；补 `getEntity` 是加法，约 40 行（含 `StorageSurface` 锁） |
| 预检、能力门与 ack 只对新请求（Decision Log 同名决策） | 维持：已有记录在建立时已校验；对续跑也 ack 会破坏 local-git R1 的「重试期间没有 `symbolic-ref`」与 R2 / R3（上文的 M22、S14 证明） | 已有记录的仓库在上游被改名或删除时续跑不重新校验，失败是 provider 的结构化错误而不是静默；需要时给续跑加只读 ack |
| 写前登记 context 与 reserved worktree 实体（Decision Log「保留写前登记」） | 维持：#187 的字面关闭条件就是 core 登记关系端点实体；读谱系在 Provisioning + 句柄时会落边，端点未登记时 SQLite 在读路径抛外键（M14、M15 与首启用例的「写前」断言钉住） | 没走完的上下文留下两行实体，无害；延到 final 要给读路径加防御 |
| 保留挂载冲突预检（不采纳「删掉挂载冲突预检」） | 维持：永久冲突报 `conflict`（不可重试），而不是 `unavailable`（可重试）；上文的 M17、V58 钉住 | 删掉预检可省 5 行，冲突码语义退化 |
| 新请求没有能力不落 Failed 上下文 | 维持（有意改变）：拒绝不留行，修好能力后同一个 key 可重试；旧行为在 SQLite 上本来就会因父边外键写不进去 | 依赖「能力失败也有一条 Failed 记录」的调用方改看结果面的错误（Query 读到 `undefined`） |
| `namesProblem` 移入请求校验 | 维持：输入形状错误先于存在性与任何写入；M21 钉住 | 放回 `provision()` 并让预检跳过退化 id |
| 认领失败转结构化只针对新请求 | 维持：只有新请求的认领能如实说「没有发起任何外部写入」；撤销收窄的变异存活（没有用例钉住已有记录路径的拒绝），在裁决之内 | 已有记录路径的认领失败仍以拒绝抛出（原行为） |
| `LocalWriteFailed` / `localWrite` 只标记显式本地写点 | 维持：没有宽 catch，Provider 的抛出原样传出（在 Provider 调用外加宽 catch 让 11 个既有崩溃恢复用例变红，即上文 B-2 变异表的 M40）；`localWrite` 的闭包只含存储调用 | 闭包里的程序错误被报成 Unknown（TD-011） |
| 失败结算的本地写失败也报 Unknown | 维持：记录停在 Provisioning、不留错误终态，租约过期可续跑；文案已按事实区分有没有 ack（Q1 – Q5） | 「什么都没写」时客户端多做一次对账；要区分约 +4 行 |
| harness 留在 B-1 的测试文件 | 维持：提取是纯搬运（增删之和约 90 行），没有判别力；文件头注释写明了三类职责 | 文件名比内容窄（登记、结算、读取诚实性三类）；之后可做纯重构提交 |
| B-3 的 Query 完整性范围 | 维持：Query 只读本地、零 provider 调用（上文的 E9 钉住），只查确切两条边与 run 状态，与命令同源（`readyGap`） | 每次读 Ready 都读整个工作区的关系（TD-007） |
| TD-012、TD-013 的文字与归属 | 准确：启动窗口探针在副本上复现（窗口内同 key、新 key 为 Unknown，Query `degraded`，放行后首次 saved，`startRun` 共 1 次），真修属 #193；controller 的 `StartWorkView` 只转发 `fallback` 与 `degraded`、没有 run 句柄，跨包 | — |

独立复评证据（verify-b4，Sonnet，被验 `0dcd129`，BASE `271e497` → HEAD `569d759`，2026-10-01；复评者在一次性检出 `.worktrees/verify-b` 与仓库外的 `git archive` 副本上运行，没有写 B 与 A 的检出，探针与变异脚本是它的运行态脚本、不在仓库；以下数字是复评者的观察，本计划转录）：结论 PASS_WITH_FINDINGS，无 P0 / P1 / P2、六条 P3（`Surprises & Discoveries`）。`0dcd129` 与 `569d759` 各跑 30 文件组 476 / 476（新文件 60 / 60）、typecheck 0、`pnpm verify` 982 / 7 退出 0、文档契约 9 / 9，另在 `569d759` 上复跑命令一 192 / 192、命令二 49 / 49、命令三 476 / 476（连跑三次）、`node --test tests/contract tests/integration tests/e2e tests/mvp0` 989 / 989（连跑三次，fail 0、cancelled 0），`pnpm verify` 共三次退出 0（`0dcd129` 一次、`569d759` 两次，每次 982 / 7）；`569d759` 只改文档与 README 的索引行，不改 `packages/` 与测试代码。把 `271e497` 的生产代码与 `569d759` 的测试放在一起，新文件 tests 60 / pass 54 / fail 6，恰是三个新行为 × 两个适配器，原因都是功能缺失。变异 35 个（点名的 13 个变体、复评者自己的 O01 – O20、A5 与 N10）杀 32、活 3（M11、O10、O13，均为测试缺口），O14 只被一条无关用例抓住；本计划验收的变异表 10 项逐项复现。四路径扫描（复评者重写的脚本，没有复用验收的）：真实流程的 140 个世界 × 2 个存储，`271e497` 不一致 78，`569d759` 剩 44（has_worktree 候选 20、tracks 候选 24），其余 96 个世界的首次、同 key 重放、新 key、Query、原 key 重放与关库重开全部一致；手工播种的 480 格按本计划的描述重写，`271e497` 为 170、`569d759` 为 46，与验收相同、全是 has_worktree 候选；并发接管（2 – 3 个新 key 同时接管，32 个世界）一个赢家、其余 `pending`、`startRun` 增量 0。TD-014 准确且今天不可达，范围是 tracks 或 has_worktree；TD-006 的订正与「约 3 行」的止血方案在副本上实测，文字准确，规模口径是 +4 / −4。

复评之后的小修证据（2026-10-01）：发现 1 – 4 是对已经正确的行为补断言，它们的「红」靠变异证明；缺口文案的分隔先写断言再改代码。补强前后的变异（观察 2026-10-01 23:16 – 23:21 CST，在工作树上，补强前是 `569d759` 的树、补强后是 `a07724a` 的树；每个变异先用 `git diff -U0` 证明已生效，再跑三组：新文件、命令二、e2e 加 mvp0；还原后核对树干净。G1、G2 在 `912954f` 的树上跑，先暂存修复再变异，使 `git diff -U0` 只显示变异本身）：

| 编号 | 变异 | 补强前红 | 补强后红 |
|---|---|---|---|
| O14 | `existingRun` 两个分支的结果面丢掉分支与工作树句柄 | 命令二 1（`local-git-core-provisioning` 的无关用例） | 新文件 8（接管表四行 × 2），另加同一条无关用例 1 |
| O10 | 设计备选：已有 run 的检查提到 `startExecution` 开头、删掉 `manualFallback` 里那一处 | 0 | 新文件 2（并发写者一条 × 2） |
| M11 | `manualFallback` 末端的失败返回误走 `existingRun`（丢主执行的错误） | 0 | 命令二 1（e2e 的降级用例；e2e 加 mvp0 一组里也是它） |
| O13 | 接管时 Unknown 的原因文案改成「x」 | 0 | 新文件 4（两条 unknown 的接管行 × 2） |
| O13b | 首次路径（ack 的状态不是已知取值）的原因文案改成「x」（复评没有列，O13 的同类） | 0 | 新文件 4 |
| G1 | 缺口文案去掉分隔（回到「已 ready 的上下文run 状态未知」） | —（此前没有用例看这句文案，既有用例只断言错误码与降级标记） | 新文件 10 |
| G2 | 缺口文案丢掉缺口描述 | — | 新文件 10 |

缺口文案的 RED → GREEN：先只写格式断言（生产代码未改，观察 2026-10-01 23:20 CST），新文件 tests 62 / pass 52 / fail 10，失败的恰好是 Ready 之后的重放与读取里五个有缺口的世界 × 两个适配器，actual 是不带分隔的旧文案（「已 ready 的上下文没有 run 记录：……」「已 ready 的上下文run 状态未知：……」）；改后 62 / 62。O10 的红因另行核对：备选把已有 run 的检查提前后，并发写入的记录被降级的 failed 记录覆盖（actual 为 `saved`、`manual_fallback`、无 run 句柄、记录 `fallback=true`，期望为 `saved`、无降级、`run-concurrent`）。

宽验证（观察 2026-10-01 23:23 – 23:25 CST @ `912954f`，检出 `fix/start-work-sqlite-prerequisites` 的工作树根；命令与期望见 `Validation and Acceptance`）：`pnpm run typecheck` 退出 0；`pnpm run boundaries` 为 tests 8 / pass 8 / fail 0；`node scripts/workflow-check.mjs` 退出 0；`pnpm verify` 连跑三次都退出 0，contract + integration + e2e 为 tests 984 / pass 984 / fail 0，mvp0 为 tests 7 / pass 7 / fail 0；命令一为 tests 194 / pass 194、命令二 49 / 49、命令三 478 / 478、新文件 62 / 62；`node --test tests/contract tests/integration tests/e2e tests/mvp0` 连跑三次都是 tests 991 / pass 991 / fail 0 / cancelled 0。`node scripts/rule-checks.mjs size fix/repository-identity` 的代码为 774 / 1000（`912954f` 之后只有文档提交，代码行数不再变），文档为 841 / 1500（观察 2026-10-01 23:30 CST @ `912954f`），加上独立复评的文档提交 `7b10b03` 为 882 / 1500（观察 2026-10-01 23:32 CST）；文档计数随每个文档提交变化，以最终 head 上的重算为准。`disclosure`、`git diff --check fix/repository-identity...HEAD`、ExecPlan lint 与文档契约的期望见 `Validation and Acceptance`（退出 0、`OK: ExecPlan passed lint checks.`、9 / 9）。

计数基准（观察 2026-10-01 23:23 CST @ `912954f`；重算命令见 `Validation and Acceptance`）：新文件 62，`storage-contract` 132，命令一 194，命令二 49，命令三 478，`pnpm verify` 为 984 加 mvp0 7，contract + integration + e2e + mvp0 共 991。相对 `0dcd129`（新文件 60、命令一 192、命令二 49、命令三 476、`pnpm verify` 982 加 7、全量 989）各 +2：并发写者的一条用例 × 两个适配器；其余补强只加断言、不加用例，命令二不变。期望仍是同一棵树上改动前后用例数的关系，后续改动之后以当时的基准重算。

评审修订证据（2026-10-02，检出 `fix/start-work-sqlite-prerequisites` 的工作树根，修订后的树；`node --test` 都加 `--test-timeout=120000`）：命令一 `tests 204 / pass 204 / fail 0`（新文件 72 个用例：原 62 个加五条新用例 × 两个适配器）；命令二 `tests 49 / pass 49`；命令三 `tests 488 / pass 488`；`pnpm test` `tests 995 / pass 995 / fail 0`；typecheck 退出 0。判别力：每处修复撤销后对应用例变红，每次先打印改动行证明生效，跑完 `git checkout --` 还原且工作树干净——瞬时读不改判（新文件 2 红）、`startRun` 不确定记 unknown（新文件 2 红，`human-execution-provider` 1 红）、工作树步对账（新文件 2 红，`write-machine` 1 红）、绑定冲突文案（新文件 2 红）、controller 转发 run 句柄（`controller-roundtrip` 1 红）、ui-model 读门（1 红）、003 自检的 repository 主键（`storage-sync-surface` 1 红）、替身与 SQLite 的 TD-004 种类检查（`storage-contract` 各 1 红）、替身父边只对 active 检查的变异 Sc（第一轮评审时存活，现 `storage-contract` 1 红）、`readyGap` 不查 tracks（新文件 4 红，含新增的 tracks 候选一行）。探针 P3、P4、X1 与第 6、7 行引用的用例前缀在修订后的树上回读，与 `docs/product/vertical-path.md` 一致；`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 的 P3、P4 改用 `content.contentKind` 选取器后各跑 3 次，输出与记录一致。

复评修订证据（2026-10-02，修订后的树；`node --test` 都加 `--test-timeout=120000`）：命令一 `tests 216 / fail 0`（新文件 84 个用例）、命令二 `tests 49 / fail 0`、命令三 `tests 500 / fail 0`；`pnpm verify` 退出 0（`tests 1007 / pass 1007`，mvp0 7 / 7）。变异（每个先打印改动行，在已提交的基线上 `git checkout --` 还原）：读能力不可用判确定、读方法缺失判确定、只有 unavailable 算非确定、检出别的分支判非确定、去掉「先算缺口」、`startRun` 不确定的 unknown 记录去掉 `localWrite`、对账读失败当成不存在、对账不比分支，新文件各 2 红；读回失败改写命中的 Failed 首次报告，8 红。

第二轮复评修订证据（2026-10-03，修订后的树；`node --test` 都加 `--test-timeout=120000`）：命令一 `tests 216 / fail 0`、命令二 `tests 49 / fail 0`、命令三 `tests 501 / fail 0`；`pnpm verify` 退出 0（`tests 1008 / pass 1008`，mvp0 7 / 7）。变异（在已提交的基线上，先打印改动行，`git checkout --` 还原）：只在 supplied 已确认时才算缺口（半回退）新文件 2 红；接管时无视已有 run 新文件 10 红（读回表的两行 Failed 现在也抓它）；去掉 provider 的「cannot change to」映射 `development-local-git` 1 红。复评的真实 local Git 复现（完整的 Ready、仓库目录被临时挪走）由 `failed/failed/not_found` 变为 `unknown/ready`，provider 直接读回得到 `unavailable`。体量：代码 1000 / 1000（CI 硬上限，`rule-checks` 的判据是 ≤ 1000），用户 2026-10-03 确认可以接受；测试已逐条审视，没有能删的重复用例。

## Bottom Change Note

Change Note (2026-10-01 13:10 CST)：独立比较四种候选并采纳正确工作区mount+内部preflight/final；加入同binding读取、事务内tx窄依赖、Confirmed→Unknown真实转换、局部ack守卫、旧fixture前提修正及未选issue边界；修改集与预算仅见Global Constraints。

Change Note (2026-10-01 15:24 CST)：最终磁盘审读逐项核算23项721行、余量79；修正无context关联的账本不能按上下文查询，同步Design/批次/矩阵；明确new-key命令允许同Provider工作树读回，Query只读本地边/run，以及identityFoundation注册不计入错误继承账；保留eligible既有context在能力失败时的Failed/分支句柄契约，未过期在途不被覆盖。

Change Note (2026-10-01 15:35 CST)：补入未来vertical-path对应第6/7行与观察基线的同PR更新义务，当前不改矩阵；补齐branch-probe/human-execution旧裸ID fixture允许集与20/25行预算，code合计766/余34；明确只有可操作WorkItem可开始，保留CR/redacted身份与Planning三态。

Change Note (2026-10-01 15:39 CST)：主控补入已执行的文档验证、暂存公开面与更严规模门；后续实施与API回读仍为下一门。本轮文件编辑使用原生补丁工具，Git/gh直接操作，专用lint按技能入口运行。

Change Note (2026-10-01 17:33 CST)：按控制计划 D10 与预审结论订正（B-1 提交 1）。`Global Constraints` 的文件表换成订正后的有效版本（去掉 007、迁移模块、旧库升级测试与 `getEntity`，加 003 原位改、fixture 前提与 `tests/integration/README.md`、`docs/product/vertical-path.md`，预算 730 / 硬停线 800）；`Plan of Work` 改成 B-1（五个提交，含 docs 先行与 fixture 先行）、B-2、B-3 并写出各批的判别性测试清单与注入点；`Validation and Acceptance`、`Idempotence and Recovery`、`Interfaces and Dependencies` 换成有效内容；`Design / Spec` 被推翻处就地 Superseded 并新增「订正后的设计要点」；追加预审发现与十条决策（含 fake 仓库父边并入 core 登记提交、`namesProblem` 移入请求校验两条实施者决策）；顶部状态改为 B-1 实施中。

Change Note (2026-10-01 17:53 CST)：B-1 证据回填（提交 5）。`Global Constraints` 的预算按 B-1 实测与 B-2 / B-3 估算重算为 782 / 余量 18，并新增 schema 用例一行、更新三行上限；`Design / Spec` 订正段第 3 条改写能力门的实际形状；`Plan of Work` 的提交 3 补 NOT NULL 断言；追加旧库探针、等价变异体的发现与四条实施者决策（挂载契约进执行组且台账按增量、认领失败统一转结构化、登记留在 `start-work.ts`、冲突预检只比对同 id 一半）；`Outcomes & Retrospective` 回填 B-1 结果、偏差与 B-2 / B-3 估算；`Artifacts and Notes` 回填 RED → GREEN、注入命中、30 个变异与宽验证；顶部状态不变（B-1 完成，B-2 / B-3 待接手）。

Change Note (2026-10-01 18:57 CST)：B-1 对抗验证修复（先于 B-2 的提交）。`Global Constraints` 的三行按修复后的实测更新；`Plan of Work` 的 R1.2 / R1.6 就地订正；`Design / Spec` 订正段第 1 条改写 replay 在预检前的理由、第 7 条补「谱系读在没有工作树句柄时也写 tracks」并附可执行的复现命令；`Progress` 取消项改成「已取消：~~…~~」写法、孤立的计数改指「计数基准」；`Surprises & Discoveries` 记 9 个存活变异；`Decision Log` 追加四条决策（含不采纳「删挂载冲突预检」）并把「统一转结构化」就地标注为被推翻；`Artifacts and Notes` 追加计数基准与变异证据；`Outcomes & Retrospective` 的偏差③改写。

Change Note (2026-10-01 19:10 CST)：B-2 证据回填。顶部状态改为 B-1、B-2 完成；`Global Constraints` 的 B-2 行按实测更新（`start-work.ts` 170、`git-provisioning.ts` 3、`relations.ts` 6、`write-machine.ts` 2、测试文件 241），汇总改为 763 / 余量 37，B-3 仍是估算；`Plan of Work` 的 B-2 就地标注（事务序号改由回滚证明、harness 留在 B-1 的测试文件）；`Idempotence and Recovery` 补 B-2 的恢复路径实测；`Progress`、`Surprises & Discoveries`（基线半提交、调用次数、事务里误用根 Storage 的两种形态、没有旧前提需要改）；`Decision Log` 追加六条实施者决策；`Outcomes & Retrospective` 回填 B-2 结果、偏差与 B-3 估算（含交接注意）；`Artifacts and Notes` 回填基线探针与可执行回读命令、RED → GREEN、注入命中计数、28 个变异与宽验证。

Change Note (2026-10-01 20:55 CST)：B-3 与两轮对抗验证的收尾。顶部状态改为 `Active；实现与验证完成，待人类评审`；`Global Constraints` 的预算段与文件表按实测改写（`上限` 列换成相对 A 的累计 `实测`，小计 735 / 余量 65，说明累计口径与批次口径的差别、修复轮净 +8 与目标未达到的原因），文档清单补技术债行与两处新增；`Plan of Work` 的 B-2 补对抗验证后的注入点表、B-3 的 R3.1 / R3.2 / R3.3 / R3.4 / R3.5 就地标注（真实流程加故障注入、写不进去）并写已实现的内容与修复轮；`Validation and Acceptance` 补「完整性守卫不误伤」「失败结算的 Unknown 文案」两行；`Progress` 把交接项换成已完成的各条；`Surprises & Discoveries` 追加 B-3 的八条事实与 verify-b2 的发现；`Decision Log` 追加十条决策并在「失败结算共用 settle 事务」一条上就地标注文案部分已被修复；`Idempotence and Recovery`、`Interfaces and Dependencies` 补 B-3 的内容；`Outcomes & Retrospective` 补 B-3 实施结果、偏差、遗留与新债（TD-005 至 TD-011）并在旧估算与旧「仍开放」处就地 Superseded；`Concrete Steps` 补剩余步骤的规则式回读；`Artifacts and Notes` 补 B-3 的 RED → GREEN、注入命中、读回、探针、26 + 12 个变异的整表、文案用例的 RED、宽验证与计数基准。

Change Note (2026-10-01 21:48 CST)：终局对抗验证（verify-b3）的小修与文字订正。顶部状态补三轮对抗验证；`Global Constraints` 的预算段与文件表按实测更新（`start-work.ts` 190、测试文件 334，小计 748 / 余量 52，说明净增 +13 比目标多 1 行的原因）；`Plan of Work` 的 B-3 补终局对抗验证后的小修一条；`Validation and Acceptance` 补「非 Ready 的记录上同 key 的 saved attempt」「接管时已有的 run」两行；`Progress` 订正过期的未勾选项并补本轮各条；`Surprises & Discoveries` 追加 verify-b3 的发现；`Decision Log` 追加五条决策（非 Ready 上的重放、接管与 run 状态未知的文案、P2-1 与 controller 缺口只记债、不下沉 `worktreeEntityId`、规模）；`Idempotence and Recovery` 补非 Ready 重放、接管与 Ready 之后启动窗口的说明；`Interfaces and Dependencies` 补 `unknownRun`；`Outcomes & Retrospective` 补本轮结果、偏差与新债（TD-012、TD-013）并把 `start-work.ts` 的行数写成观察时刻加提交加重算命令；`Artifacts and Notes` 的两张旧变异表在最终树上重跑后更新，补本轮的 RED → GREEN、探针观察、变异表、宽验证与计数基准。

Change Note (2026-10-01 22:25 CST)：独立验收（accept-b）的结论、修复与交接。顶部状态改为实现、对抗验证与独立验收完成；`Global Constraints` 的预算段与文件表按 `0dcd129` 实测更新（`start-work.ts` 198、测试文件 345，小计 767 / 余量 33，说明验收的净增 +19），原观察点就地标 Superseded，文档清单改到 TD-014；`Plan of Work` 的 B-3 补独立验收一条；`Validation and Acceptance` 的「接管时已有的 run」扩到两条分支；`Progress` 补验收各条；`Surprises & Discoveries` 追加四路径一致性扫描的发现与 D4 的取舍；`Decision Log` 追加五条（接管两条分支共用 `existingRun`、TD-005 终裁、TD-009 的建议、提交序列保持原样、维持十一项取舍），并在「接管时已有的 run 为 unknown 报 Unknown」一条上就地标注被取代的部分；`Idempotence and Recovery` 补主执行不可用时的接管；`Interfaces and Dependencies` 补 `existingRun`、订正 `gh pr view` 缺编号的命令并写交接事实；`Outcomes & Retrospective` 补验收结论与附注；`Concrete Steps` 补最终 head 与重跑触发条件的回读、订正 `gh pr view`；`Artifacts and Notes` 补「独立验收证据」（第一手命令、逐提交为绿、关闭复现、扫描、修复的 RED → GREEN 与变异、文档声明复现、计数基准、裁决表），旧计数基准就地标 Superseded。

Change Note (2026-10-01 23:29 CST)：独立复评（verify-b4）的小修与文字订正。顶部状态补独立复评；`Global Constraints` 的预算段与文件表按 `912954f` 实测更新（测试文件 351、`tests/e2e/start-work.test.js` 的选取器行 15、`start-work.ts` 仍 198，小计 774 / 余量 26，说明独立复评小修的净增 +7），原观察点 `0dcd129` 就地标 Superseded，文档清单补独立复评的两处；`Plan of Work` 的 B-3 补独立复评后的小修一条；`Validation and Acceptance` 补「降级窗口里并发写入的 run、缺口文案的格式」一行；`Progress` 补复评各条；`Surprises & Discoveries` 追加复评的发现，并订正四路径扫描「剩下 46 种」的范围（480 格只对 has_worktree 候选成立，140 个真实流程世界含 tracks 候选、共 44 种）；`Decision Log` 追加两条（采纳发现 1 – 4 与 6、缺口文案的括号写法），并订正「提交序列」条的提交数、TD-005 终裁的累计数（毛值与净值）与接管条的备选取舍（现由用例钉住）；`Idempotence and Recovery` 补并发写入的 run 在降级窗口里被保留；`Interfaces and Dependencies` 补缺口文案的写法；`Outcomes & Retrospective` 订正验收附注①并补复评结果；`Artifacts and Notes` 补验收证据的复评记录（逐提交为绿两行、关闭复现一行、独立复评证据一段）与「复评之后的小修证据」（变异表、RED → GREEN、宽验证、计数基准），旧计数基准就地标 Superseded，四路径扫描补范围。tracker 只就地订正 TD-006「约 3 行」的写法，不新增行；`tests/integration/README.md` 补并发写者一行与两处措辞；`docs/README.md` 的索引行状态补独立复评。

Change Note (2026-10-01 23:33 CST)：补上一条文档提交遗漏的文档规模观察值（`912954f` 为 841、`7b10b03` 为 882，见「复评之后的小修证据」的宽验证），并把「独立复评的小修再加三个提交」改成回读命令，避免个数随提交变化。

Change Note (2026-10-02 CST)：第一轮 MVP 评审修订与归档。顶部状态改为 Completed；#192 改为 Closes；验证命令去掉仓库外占位、验收表补四行、人工验收补可复跑命令（`Concrete Steps`）；`Interfaces and Dependencies` 补绑定 id 稳定的前提；Decision Log 追加 TD-009 裁决、修订范围、规模与提交整理四条，原「提交序列保持原样」与预算行就地 Superseded；`Progress` 追加评审与授权两行；`Artifacts and Notes` 追加评审修订证据。计划随本 PR 从 `active/` 移入 `completed/`。整理后的提交序列（按可独立回滚的交付物，自下而上；第二轮复评后在 storage 之上插入 `fix(development-local-git): 仓库目录一时不可达报 unavailable，不当成确定不存在`，共七个）：`fix(storage): 仓库挂载键改为 (工作区, id)，冲突不覆盖，只认 repository 身份`；`fix(core): 开始工作在外部写入前登记仓库与谱系端点，ack 之后本地失败不报 Saved`；`fix(ui-model): 开始工作的可用性补上写前预检的两个读门`；`fix(controller): 开始工作的视图转发已 ack 的 run 句柄`；`chore(test): 测试脚本加超时，死锁的用例变红而不是挂住`；以及归档本计划的文档提交。每个提交在其树上 `pnpm verify` 退出 0（第二轮复评修订并重新整理之后：storage 922、development-local-git 923、core 1007、其余 1008，mvp0 均 7；更早两次整理分别是 922 / 994 / 995 与 922 / 1006 / 1007）。

Change Note (2026-10-02 CST，复评之后)：按修复复评订正——`existingResult` 先算缺口、有缺口不读回；工作树对账读到别的分支判 Failed；读回分类改成表驱动用例；四处被推翻的结论（验证期望段的 lint 与 800 / 1300、验收表的 Refs #192、Decision 的 Refs #192、「draft 保持 draft」）就地标注；人工验收补「最终写失败」那一半的可复跑命令；Decision Log、Progress、Artifacts 各追加一条。

Change Note (2026-10-03 CST，第二轮复评之后)：缺口对任何 supplied 都要算、读回表两行 Failed 改为恢复后接管、provider 的仓库目录不可达映射、TD-006 两列订正、对账冲突文案；Decision Log、Progress、Artifacts 各追加一条，提交序列重新整理为七个。
