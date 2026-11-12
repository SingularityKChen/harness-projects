# 当前 observation-version 合同收敛 ExecPlan

> 状态：Completed · 联合实现、独立验收与当前实施 head CI 通过，待人类 PR 评审
> 创建：2026-11-11
> 范围：一个 PR 统一历史 repair/hook 退役、当前版本派生与 webhook 身份守卫证据。
> 上游：issues #415/#416、parent #223；目标 PR #623 同时 Closes #415 / Closes #416；根 `PLANS.md` 为规范。

## Purpose / Big Picture

当前观察账本保留唯一事实拥有者，写入排序只消费真正需要的每主体最大版本；历史实验库 repair/hook 与未消费的完整快照投影退出。坏输入/坏committed、去重、主体隔离、事务与重开合同继续成立，webhook-only连接不能补绑账号。

#415 已完成的本地验证不是 #416 新schema与联合head的证据。本计划是 PR #623 唯一实施/验收来源，#625 的 UI 闭环独立；#624 仅在完整实际预算确认后由协调者标注superseded并关闭，本次不写GitHub。工程结果不替代#223/#459或人类R1接受。

## Context and Orientation

账本主体是 `(binding_id, object_kind, object_external_id)`；规范 `sourceVersion` 为定宽UTC纳秒时间戳，缺失版本落空串。`recordObservation` 顺序为新输入校验、已见key去重、读取主体最大版本、校验该版本、比较、追加；当前坏committed的拒绝时机是写入，不是打开期全账本扫描。

#415 已删除历史carrier/repair及升级fixture、无动作data hooks与重复旧002/003 shape guards；`migrate`仍拥有完整DDL/版本/generation准入，constructor保留policy/metadata和失败关句柄。实施前#416 runtime直接排序取版本，旧anti-join view只供测试/inspection；现已由Batch2替换为被runtime实际消费的三维MAX版本派生。

原“保持schema/generation不变、#415/#416各main-base并可独立回滚”的结论 **Superseded by Design / Spec 与 Global Constraints（2026-11-11）**：新对象使旧fixture恢复依赖旧view名，单独revert415会破坏416，因此改为一个当前合同PR整体回滚。

## Design / Spec

保留#415已交付设计：历史归一/降级/备份修复不续留，`MigrationDataStep`仅在空schema上无动作因此退役；005注释文件与manifest所有version/file仍保留。当前内容guard、metadata/policy、队列/atomic和ack/reconcile边界不变。

`LEGACY_COMMITTED_VERSION_MESSAGE`保留现名，当前处置为停止相关写入、备份核对、用户决定新位置重建，不再推荐已删函数。U8已接管到当前sync集成：完整当前库污染`v9`后重开不归一，fresh-key写入拒绝且不追加，另一主体可写；文案RED与移除guard负控已实测，见Progress。

原“#committedVersion直接消费旧committed_observation、视图SQL不改” **Superseded by C最终方案（2026-11-11）**：旧anti-join同主体5000行局部探针约1171ms，direct约0.54ms，EXPLAIN有correlated nested subject scans，不接入写入热路径。

**C最终方案**：删除旧完整快照view，创建准确命名的 `committed_observation_version`，只输出三维主体与 `MAX(updated_at) AS updated_at`，按三维主体GROUP BY；runtime按主体读此版本，移除重复ORDER BY/LIMIT。MAX的当前BINARY文本序与规范载体比较一致；无行仍undefined，空串仍由columnToVersion处理。

端口没有committed快照读口；相同版本的received-time/rowid不影响返回版本，未使用的snapshot/tie投影不续留。原始snapshot_json仍随每条观察完整持久化，同版本不同key仍接受并追加，不删除/合并历史行。移除旧view专属投影断言，保留true/false、追加/原payload、三维主体、空版本与坏committed行为证据，不写SQL源码或私有实现镜像测试。

本节是唯一消费者台账：

| 对象 | writer / owner | reader与最终裁定 |
|---|---|---|
| sync_observation | recordObservation写唯一追加ledger | 去重、账号事实guard和版本派生；保留全部原始事实 |
| 旧committed_observation | 003 SQL派生完整快照 | 仅测试/inspection；随无需求snapshot/tie投影退役 |
| committed_observation_version | ledger三维MAX派生，无独立writer | 当前recordObservation真实版本reader；唯一SQLite最大版本选择规则 |
| webhook_subscription | 无当前公共写port/生产INSERT；fixture可写 | setProviderBindingAccount身份guard/FK/unique/R6；保留，不造CRUD |

003对象名/shape改变，`CURRENT_SCHEMA_GENERATION`明确4→5；manifest仍1–7。旧gen4拒绝，伪装gen5的旧view shape也由exact admission拒绝，拒绝前后库不变。只初始化空新库或接纳新当前库，不做兼容alias、迁移、降世代或自动清库。

webhook-only补一个SQLite当前场景：factory/端口建账号与两个未关联锚点，只给一个锚点SQL插disabled订阅，卸载挂载后事实仍在；初次补账号拒绝且关联空，重开仍拒绝，无事实锚点成功对照。不种其他external facts掩盖guard丢失；原实现应green，临时移除webhook SELECT应red，恢复green。

不选保留旧inspection view和重复runtime规则，因为无当前需求；不选启动内容扫描或给旧anti-join加index/cache/物化机制，因为扩大责任。只保留当前需要的MAX派生，局部性能与generation模型仅为设计证据，不能当作实施后通过。

## Global Constraints

2026-11-12 评审收尾扩展：R623-20261112-1 仅增加 `tests/contract/storage-contract.test.js` 既有跨 kind 用例的端口断言；新增 `docs/review/pr-623-mmp-review.md`、评审索引、合并队列与本计划记录。生产合同不变。

唯一实施分支 `chore/source-version-contract`、目录 `.worktrees/source-version-contract/`、PR #623 base main；两个原Storage实施范围现统一为一个Storage owner，recordObservation版本路径与setProviderBindingAccount安全路径由该owner整体处理，不再向#416工作树派实现。#625无共享技术文件。

唯一技术集合：删除 `packages/storage/sqlite/src/source-version-carrier.ts`、`tests/integration/storage-source-version-upgrade.test.js`；修改 `packages/storage/sqlite/src/index.ts`、`packages/storage/sqlite/src/migrations.ts`、`packages/storage/sqlite/src/migrate.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/src/storage.ts`、`packages/storage/sqlite/migrations/003_control_facts.sql`、`packages/storage/sqlite/migrations/005_source_version_carrier.sql`、`packages/capabilities/src/observation.ts`（说明）、`tests/integration/storage-sync-surface.test.js`、`tests/integration/storage-connector-account.test.js`、`tests/integration/execution-relation-write-schema.test.js`、`tests/integration/migration-runner.test.js`（当前世代并发断言）、`tests/integration/storage-baseline-admission.test.js`、`tests/integration/sync-revision-freshness.test.js`（已定位诊断/脱敏断言）。

唯一文档集合：本计划；`docs/architecture/release-gates.md`当前证据/处置；`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`的Batch5与前部dead-code候选原位订正；`docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md`旧对象名的取代说明；`docs/exec-plan/completed/2026-09-29-source-version-order.md`现884–900行P2（历史档1推荐repair、守卫恢复指令原处append Superseded，保留原文，指向当前停止写入/备份核对/用户决定新位置）；完成时协调者维护`docs/README.md`。P2正文由Storage owner统一修，本次设计者未修改。

完整技术新增+删除必须≤799，建议≤790；先重算当前586基线与C实际增量，再决定能否保全闭环。文档必须<1300。预算包含所有删除/测试/SQL注释，不按估算先承诺通过，不minify、不抛弃当前安全测试压线。超限先简化或向协调者重新划分明确依赖/反序回滚的交付，不能把一部分藏到零预算或旧PR。

禁止新增依赖、兼容层、生产webhook写口、用户库访问/改写、Planning Status或原生依赖写入；不自行merge。公开端口、Host ABI与schema其余约束保持。

## Plan of Work

### Batch 1 · 历史机制退役（本地已完成）

最小闭环为当前污染证据接管后整体退役repair/hook；主文件为原carrier模块、storage-sync与migrate。保留已完成真实进度、首次完整验证失败及修复记录，不把它们重写成未做；远端/联合验收尚待Batch2。

### Batch 2 · 当前版本派生、身份证据与联合交付（本地已实施）

主文件为003 SQL、migrate、storage-sync及当前schema/账号集成测试。原Storage owner在同分支继续：先实测完整diff预算，实施C与generation5、接管真实端口证据，补旧gen4/伪装gen5旧shape零改动拒绝和webhook-only负控/恢复；修Global Constraints所列P2原处Superseded，不重写历史。两个runtime责任与旧fixture删除在一个提交序列共同验收/回滚。

**唯一验证入口 V623**：在检出`chore/source-version-contract`的工作树根运行，记录当前HEAD/base；Batch1已有结果见Progress，以下为新联合head应执行的命令，不追认设计探针为通过。

```sh
pnpm test:file tests/integration/storage-sync-surface.test.js tests/integration/storage-baseline-admission.test.js tests/contract/storage-contract.test.js tests/integration/storage-connector-account.test.js tests/integration/storage-restart.test.js tests/integration/migration-runner.test.js tests/integration/harness-plugin-migrations.test.js tests/integration/execution-relation-write-schema.test.js
pnpm verify
rg -n 'repairLegacySourceVersions|LegacySourceVersionError|LegacyRepairResult|SOURCE_VERSION_CARRIER_STEP|MigrationDataStep|assert002Shape|assertRewritten003Shape' packages apps scripts tests --glob '!**/dist/**'
rg -n 'committed_observation|webhook_subscription' packages apps scripts tests --glob '!**/dist/**'
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
python3 -c "import subprocess; subprocess.run(['git', 'diff', '--check', 'origin/main...HEAD'], check=True)"
```

期望测试/规则/diff exit0、fail0；retired符号rg零命中(exit1)，consumer检索显示新view真实reader、旧view仅在拒旧fixture，webhookguard仍在。窄证据先过，再因schema世代影响打包/持久化执行一次完整verify。新库初始化/重开、旧库零改动拒绝、current内容guard/去重/排序/原始payload和webhook-only证据均通过。

复用同规模一次性探针/EXPLAIN检查最终MAX SQL无correlated逐行nested subject scan、结果与direct等同；不新增长期性能阈值测试。独立验收后按实际技术≤799/文档<1300及发布面复查交付；协调者更新#623为Closes两issue，预算确认后再处理#624 superseded，最终push后回读当前head/base/checks/关联/完整threads，通过才ready。

回滚整个#623提交序列；generation5新库被旧binary拒绝是明确边界，保留文件、使用匹配binary/旧备份或用户选择新位置，不做down migration或删库。不得拆开revert415来恢复不匹配旧fixture。

## Validation and Acceptance

以V623当前联合head与实际diff判定。当前内容guard/metadata/policy/atomic未丢，只有一个ledger和一份被runtime消费的MAX选择，webhook-only不补账号；没有旧snapshot inspection兼容壳或永久镜像断言。

P2历史原文保留但推荐repair及守卫恢复指令在原处标明当前取代关系；当前文档不继续推荐已删函数。最终预算、实际工厂/打包schema与独立验收都不可由Batch1旧green或设计模型替代。

## Progress
- [x] (2026-11-12) 全矩阵 MMP 首审、唯一 P2 最小修复与独立复评完成；已归档计划更新当前评审及直接条件授权，最终 push/合并按当前版本门执行。

- [x] (2026-11-11 18:33 SGT) 独立核对 owning source、两份备选与根 `PLANS.md`，完成设计审定。
- [x] (2026-11-11 18:33 SGT) 核对隔离工作树与既有窄基线，真实实现仍未开始。
- [x] (2026-11-11 18:48 SGT) Batch 1 本地实施：当前场景接管，历史机制整体退役；文案 RED、移除 guard 的负控均失败，恢复后 V415 七文件回归 451 passed，typecheck exit 0；retired 检索零命中。执行上下文为 `chore/source-version-contract`、计划提交 `e98a5217` 加本批未提交差异，`origin/main@29947425`。
- [x] (2026-11-11 18:53 SGT) 范围内实现自审与发布面五类人工检查通过；扩围诊断场景 1 passed。第二次完整 `pnpm verify` exit 0：contract 1566、integration 2232、e2e 226，均 fail 0。技术差异 586 行（增删之和，提交后按 V415 重算）；文档保持预算内。
- [x] Batch 1：已并入联合合同的最终验收与归档，不单独拆开回滚。
- [x] (2026-11-11 SGT) #415/#416已裁决统一为#623单一合同、单一Storage owner与本控制计划；#416尚未实施。
- [x] (2026-11-11 19:18 SGT) Batch 2：C/generation5、webhook-only与P2原处订正完成；V623八文件465 passed；最终完整verify exit0（contract1566、integration2233、e2e226，均fail0）。执行上下文为 `chore/source-version-contract`、`7ce81db3` 加本批差异，base `origin/main@29947425`。
- [x] (2026-11-11 19:18 SGT) webhook SELECT移除负控为Missing expected rejection；MAX改MIN使中间版本误接受，实际[true,true,true]；恢复后5项定向场景全绿。当前技术差异763行，发布面五类复查与实际diff扫描完成。
- [x] (2026-11-11 19:36 SGT @ 856c7b01) 独立验收、组合验收、双向 issue 关联及当前实施 head CI / PR Fast Gate 通过；完成归档。最终整理 head 仍按 Plan of Work 重新回读门禁再 Ready。

- [x] (2026-11-11 19:27 SGT) 联合分支独立验收固定 `1a6abf04` 技术PASS，无P0/P1/P2；唯一P3 F623-1已机械订正release-gates当前验证标记为V623。目标计划与唯一命令入口已核对，源码树相对该head未变；文档补正后由协调者继续scoped复评。

## Surprises & Discoveries

原“183 行 repair”包含仍重要的当前 U8 对应守卫依赖；不能整删测试而不接管。完整 schema 准入与业务内容校验不同，重开成功不表示账本版本内容有效。

A/B 均把 003 的现存 hook 引用当作保留依据；独立复查当前分支控制流证明它只在空 schema 上无动作。调用点存在本身不足以证明当前行为价值。

首次完整 `pnpm verify`：contract 1566 passed；integration 2231 passed / 1 failed，失败为 `sync-revision-freshness` 的「诊断出口：SQLite 账本里的旧载体…宿主收到的原文含 repairLegacySource…」。堆栈第 527 行实际已收到新处置，仅旧正则要求退役函数名；e2e 因上游失败未执行。协调者核对后扩大唯一文件集合，最小订正既有诊断用例，保留具体恢复处置的正向与命令脱敏反向断言。

当前污染场景最初只改变 sourceVersion，因 dedupeKey 由稳定载荷派生而先返回 false；修正为不同稳定载荷后，RED 准确显示旧 repair 文案。该调整保留去重先于 committed 校验的原顺序。移除当前 guard 的负控为 Missing expected rejection，证明场景能捕获静默乱序丢弃。

旧anti-join在5000行局部探针约1171ms/direct0.54ms；三维GROUP BY/MAX约0.48ms/direct0.53ms，计划为单主体index scan。当前migrate仅替换世代5的设计模型拒旧gen4/伪装gen5旧shape且hash不变，新库幂等。均为设计证据，不是生产benchmark或#416实现结果。

2026-11-11 19:18 SGT / 最终生产schema一次性探针：同主体5000条，direct约0.663ms、派生MAX约0.601ms且值相同；EXPLAIN为CO-ROUTINE、按三维主体索引SEARCH、SCAN派生结果，无CORRELATED嵌套主体扫描。此为局部探针，不能推成生产benchmark。旧view的SQL投影套件随无消费能力退役，当前排序与主体隔离由端口契约保护，原始payload由账本断言接管。

V623 首次窄回归 464 passed / 1 failed：`migration-runner` 的「双 Worker 屏障同时打开空库」把当前 generation 写死为 4，实际值为 5。协调者核对后允许只改其当前代断言为公开常量，保留并发初始化、清单、外键与完整性检查。旧 gen4 拒绝场景仍显式 4。

## Decision Log

2026-11-12 / 人类伙伴（本次 #623/#625 评审会话）：直接要求无 P0/P1 时由本会话负责“修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并”。本 PR 满足条件后执行；Planning Status 与 R1 不在该授权范围。

2026-11-11 18:33 SGT / 独立设计审定者：退役全部 data hook 与旧 shape 子集检查，保留当前准入、metadata/policy 和写入期内容检查。Rationale：每种不变量只有明确当前拥有者，不保留无动作兼容壳。

2026-11-11 18:33 SGT / 独立设计审定者：保留错误常量名，仅改恢复处置；复用当前同步测试承接 U8。Rationale：减少无关 API / suite 改动，证据针对行为。

2026-11-11 18:33 SGT / 独立设计审定者：按 Project #10 实际 iteration 10（2026-11-09—15）执行本次选择；issue body 的 iteration 11（2026-11-16—22）为预测漂移。Rationale：当前 Project 选择优先，未批准改 Status 或关系。

2026-11-11 18:48 SGT / Storage 实施者：新场景通过工厂与端口建立当前库，仅以第二连接污染 committed 值；删除历史 fixture 而不复制其中升级矩阵。Rationale：用当前独有行为证据证明写入期 guard，准入、事务和重启由既有 V415 回归承担。

2026-11-11 18:51 SGT / 协调者与 Storage 实施者：根据完整验证的失败证据，允许最小订正既有诊断用例。Rationale：诊断边界行为有效，旧文案断言必须同步当前处置，不放宽为任意错误。

2026-11-11 SGT / 独立设计审定者与协调者：旧“无条件接anti-join/三main-base独立回滚” **Superseded by 本计划C/合并交付**。Rationale：局部扩展性反例推翻性能假设，revert415恢复旧view fixture推翻独立回滚；改为#623一个完整当前observation-version合同，#625独立。

2026-11-11 SGT / 独立设计审定者：两个原Storage实施范围并入同一owner/技术集合；#624只在实际预算确认后由协调者superseded关闭。Rationale：执行事实与当前合同必须一起验收，不因既建PR保护旧粒度；不自动改规划Status或依赖。

2026-11-11 19:18 SGT / 协调者与Storage实施者：仅将失效的当前世代并发断言扩入唯一集合并复用公开世代常量；旧世代拒绝仍显式4。Rationale：修复本次schema演进产生的期望漂移，保留并发、完整清单与原子性证据。

## Idempotence and Recovery

检索、临时库测试与负控可重复，负控恢复源码并核对diff后再复验；不降级版本或改变fixture掩盖失败。用户数据库始终不打开、不删除、不升级。

代码整体回滚与新旧数据库兼容是两件事；gen4/gen5各用匹配binary/备份，不提供迁移、降世代或修复工具。保留数据处置始终是停止相关写入、备份核对、用户决定新位置重建。

## Interfaces and Dependencies

复用Node SQLite、pnpm与capabilities版本函数，Storage公共端口/Host ABI保持；内部SQL对象有意改名且generation4→5。recordObservation的版本派生和setProviderBindingAccount的安全reader由同一Storage owner整合，后者现有guard保留。

#624旧计划仅保留历史设计依据，禁止再派独立实现；本计划覆盖两issue并在同一head验收。#625 UI没有共享技术文件，协调者统一维护索引和最终远端元数据。

## Outcomes & Retrospective

2026-11-12 MMP 首审无 P0/P1，仅 R623-20261112-1（首审 GitHub 简称 F623-1，与前日同名 P3 分开）：现有共享跨 kind 用例增加一行旧观察拒绝断言，修复后三文件 278 passed、独立契约复跑 260 passed，五项最终变异全部 KILLED。生产实现不变，原 Storage reviewer 独立复评 APPROVE；版本、全矩阵和后续当前 head 门见 [评审记录](../../review/pr-623-mmp-review.md)。

#415历史退役与#416当前版本派生已在同一能力闭环完成，本地联合验证、负控恢复与预算见Progress；独立全分支技术验收与组合验收已通过，当前实施 head Hosted CI / PR Fast Gate 已通过；最终整理 head 重新回读后 Ready。安装态人类验收与 R1 仍独立。没有新增兼容层或性能框架；generation5与旧库明确拒绝，整体回滚边界已说明；物理基线折叠仍属#417/#595/#596。

## Bottom Change Note

2026-11-11 18:33 SGT：审定首版，合并 spec 与 plan，删除无动作 hook 方案，明确 current corruption 的实际拒绝时机和最小证据。

2026-11-11 SGT：核正基线记录，仅保留观察日期，避免把 triage 时间误作测试时间。

2026-11-11 18:48 SGT：记录当前场景的文案 RED、guard 负控与恢复回归，更新现行证据指针；保留 active 等待协调者验收与归档。2026-11-11 18:51 SGT：完整验证暴露范围外旧 repair 文案断言，记录根因并按协调者授权扩大唯一集合，准备重跑完整验证。2026-11-11 18:53 SGT：记录第二次完整验证全绿与首次失败的最小订正；实施自审完成，维持 active 交给独立验收与远端交付。

来源：当前 owning source 与根 `PLANS.md`；SQLite 官方 `https://www.sqlite.org/schematab.html`、`https://www.sqlite.org/lang_transaction.html`（2026-11-11 核对）。

2026-11-11 SGT：依据新查询/回滚证据合并415+416为#623单一控制计划，保留415真实进度与失败订正，补C/generation5、webhook-only、完整预算及P2原处Superseded责任；#416旧计划退出实施入口。

2026-11-11 SGT：补当前世代并发断言的失效发现与最小扩围；P2 历史推荐和守卫恢复指令原处标明已退役。

2026-11-11 19:18 SGT：记录联合465项窄验证、1566/2233/226完整验证、两项真实负控及恢复、最终SQL局部探针和实际预算，维持active等待协调者独立验收与交付。

2026-11-11 19:27 SGT：按最终独立验收F623-1仅订正当前验证入口标记V415→V623，更新Progress；保留技术实现与既有测试证据，不因文档补正重跑完整测试。

2026-11-11 19:36 SGT：记录全分支独立验收与226项组合验收通过，当前实施head远端门禁通过，归档计划并更新索引；最终整理仅改变文档与提交描述，保存backup ref后按精确lease发布。

2026-11-12：补录 MMP 全矩阵首审、R623-20261112-1 最小判别证据修复范围和逐 PR 条件合并授权，完成归档继续有效。
