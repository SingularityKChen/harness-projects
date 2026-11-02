# PR #466 MMP 交付评审

> R5 当前交付状态（2026-11-02）：正式 review 5732397709 请求修改；已完成本地根因修复，source 67fdc746，等待 root 对新 head 独立复评。历史APPROVE/Ready均只属于各自版本，未用作者旧批准放行。

> 当前源码结论（2026-11-02）：APPROVE；最新 source 2025a22b036d5c10e5137e7d4d4f469dfaac8117 / base 554e6fef。历史 REQUEST_CHANGES 按轮次保留，下述最新补记取代其未修复状态。最终 GitHub head 及 CI 需发布后回读。

- 日期：2026-10-30；结论：**REQUEST_CHANGES：1 P1、1 P3**。只评价本 PR 相对父层的独立增量；未提交 GitHub review，未修改产品代码、测试、issue、Status 或关系。
- Head：`d9b669e5c3b2f29b185df8b8ae71ec2391670c10`；base：`fix/durable-write-intent@47de6dfd182766a08168abb73321532af254ad8d`。
- 执行上下文：`.worktrees/planning-runtime-access`；评审账号约定为 `Singularity-AI-Bot`，作者侧为 `SingularityKChen`。
- 方法：Superpowers 独立子评审；Qian 对权限观察、持久化、投影发布及恢复做接口综合；First Principles 从不可见内容不能被旧缓存恢复的不变量构造反例。

## 风险矩阵（先建后查）

| 等级 | 主要失效假设 | 检查层与最终结果 |
|---|---|---|
| P0 | 第二 Planning 权威源、规划状态被工程事实覆盖或 main 立即失效 | 查代码、产品与依赖边；本增量未发现 P0 |
| P1 | 拒读、ABA、落库失败或重启恢复后暴露受保护内容 | 同 owner 撤权、旧响应、首写前等待、gap/baseline 均有判别性绿证据；**失败 redaction 后顺序重启复活内容已复现** |
| P2 | 显式恢复入口、离线只读和局部可用性不闭合 | connected denied 可重验证；断连零 RPC；普通 offline 保留许可内容与确认时间；未发现新增 P2 |
| P3 | 状态文案、验收与交接记录矛盾 | **completed ExecPlan 状态头仍为 Active，需同步** |

## 锁定事实与验收

- 提供的精确 head 快照含提交 `0c09c7f8d0bce6d70d0ef1f90e6257ff1bb0a09d`、`d9b669e5c3b2f29b185df8b8ae71ec2391670c10`；base/head 与检出一致；Ready、MERGEABLE、UNSTABLE。
- PR Fast Gate、Verify、Merge Gate、规则与 CodeQL 均成功；唯一非成功为非必需 `Create review session`，PR 说明其评审转发端点 HTTP 404。此基础设施失败不当作产品测试失败，也不声称已修复。
- reviewThreads 全分页 `nodes=[]`、`hasNextPage=false`；双向 closing 为 #465。#465、父 #457、#144 和 R1 不因本地测试或 Ready 自动接受。
- #465 的同 Host 正常撤权/恢复、旧 saved replay、首写前拒绝、普通 offline 保留和真实 watch/client/apply 已有证据；failed redaction 的恢复证明仍缺跨重建闭环。父 #457 的 Delivery、后续逐步操作门和单 production browser 总矩阵不计入本 PR 已完成范围。

## 分层证据与设计判断

Core 用同一 runtime owner、既有 Planning round 和 publication 队列约束短本地读写，Provider I/O 不占队列；redaction/revision 同事务，来源名只在完整提交后发布。Start Work 复用父 #204 的唯一 durable write hook，在准入、replay、claim 事务和首次实际写前复验，边界合适。wire 复用 redacted 规则，不带 native locator；前端只消费权威帧，安全 baseline/gap 没有虚增 SQLite revision。

但 Planning denied 仅为 `runtime-access.ts:9–10` 新 owner 内存 latch。只让当前 Host 失效不足以保证同一工作区重启后的访问证据；普通 offline 初始化不能证明旧缓存仍获准。这个缺陷位于 #465 已要求的失败 redaction 和完整新读才恢复边界，不能以父 issue 尚未关闭作为豁免。

| 本次实际命令 | 结果 |
|---|---|
| `node --test --test-timeout=120000 tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js` | 48/48 通过，0 失败/取消 |
| `git diff --check 47de6dfd182766a08168abb73321532af254ad8d...HEAD` | exit 0 |
| `node --test --test-timeout=10000 "$REVIEW_EVIDENCE/probe-466-host-restart.test.mjs"` | 1 个内容安全断言失败；旧 Host 遮罩后，重启 baseline `hasCanary=true`、`reason=unavailable` |

`REVIEW_EVIDENCE` 指本轮仓库外临时证据目录；探针原文与 findings 交给协调者，不提交运行态内容。探针使用真实 `createHostComposition`、SQLite、`installHostRemote`，唯一权限输入是 Planning Provider 的结构化拒读/普通离线；仅对 redaction 存储方法注入故障，无 Controller 响应改写或合成 baseline。

### 发现

1. **P1，新增 `packages/core/src/runtime-access.ts:9–10`**：先成功缓存 title/body，Provider 整源拒读时让 `replacePlanningProjections` 事务失败；旧 Host 的 baseline 正确 redacted。关闭旧 Host，复用同一 SQLite 以 Provider `getProject=unavailable` 启动，新的真实 remote baseline 再次返回 canary title/body 和 native externalId。没有完整新读取成功。根因是拒读 latch 未耐久记录/重建，旧磁盘内容被重新解释为获准 offline cache。修复应复用同步健康事实保存未完成读/拒读证据并跨 owner 恢复，只有完整事实提交 ack 才恢复；保持普通 offline 的合法缓存语义。已有追踪：#465/#457/#144。
2. **P3，新增 `docs/exec-plan/completed/2026-10-30-planning-runtime-access.md:3`**：文件已归档，后文 Outcomes 已记录独立复评和交付，头部仍写 Active、独立复核及最终远端门尚未完成。按实际状态与本次新阻塞同步头部，避免交接误判。已有追踪：#465/所属 ExecPlan。

### 测试判别力

仅在仓库外的完整隔离副本使用正式 `scripts/review-mutate.mjs`；源码/测试不改，脚本逐字节还原并重跑基线。本次最终树整表一次运行 exit 0：

| 变异 | `killedBy` | 结果 |
|---|---|---|
| P-mask：redactPlanning 保留旧 content | `denial redacts atomically` | KILLED，14 个相关内容断言红 |
| P-local-deny：拒读观察不置 denied latch | `failed redaction transaction remains fail closed` | KILLED，18 个相关访问/内容断言红 |

正式测试能判别已实现的本地门，但未覆盖新发现的重启反例；不把负控击中解释为完整产品验收。

## 评审与后续

完整矩阵查完后统一回传全部发现，由现有实现 owner 修复。复评须锁定新 head/base，重跑原重启反例及普通 offline 正反 pair，再核对真实 Host/watch/client、checks 和 threads；本轮未代替人类合并，也未接受已安装 Host UAT、真实账号撤权或 R1。


## 第二轮候选复评 · `90e036bc37ebc981eeec295a2993f1232faa1dcf`

2026-10-30，本轮限定候选 base 仍为 `fix/durable-write-intent@47de6dfd182766a08168abb73321532af254ad8d`。只读代码/测试；确认原 review 文件近期未被 owner 修改后仅追加本节。结论 **REQUEST_CHANGES：原 P1 已解决，本候选新增 1 P1、1 P2，原 P3 状态同步仍未完整闭合**。此结论不能自动继承到后续 owner 修复 head，也未发布外部 review。

原 P1 的真实 Host 重启探针未修改断言，`node --test --test-timeout=10000 "$REVIEW_EVIDENCE/probe-466-host-restart.test.mjs"` 为 **1/1**；新 baseline `hasCanary=false`、`reason=permission_denied`。读前 Syncing marker/round 同事务，marker 未 ack 不调用事实 Provider；新 owner 从未结清 marker 或拒读 cursor 恢复 latch，healthy+条目缺口不被当作整源拒读。正式 real Host 普通 offline 重启正控、完整恢复与 marker失败零事实读取均通过。

然而保存旧 lastErrorCode 没有保住前次失败的准入语义，新增的状态覆盖产生新边界缺口：

| ID / 等级 | 新增行与反例 | 影响与修复方向 |
|---|---|---|
| R466-R2-F1 / P1 | `packages/core/src/bootstrap.ts:115–118` 将已 degraded 的游标改为 syncing；确认 offline 后重试 getProject 在途，旧 `unavailable` 仍在但 metadata从read_only变available，StartWork只挡degraded/failed | Memory/SQLite Core均Saved/ready并调用Provider；真实Host branches 1→2、worktrees 0→1且结果confirmed。retry不是完整恢复，marker必须保留先前read-only准入证据；仅完整事实事务ack恢复。归#465/#457/#144 |
| R466-R2-F2 / P2 | `packages/core/src/bootstrap.ts:80–82` 直接读取caught unknown的planningMarkerFailure；Provider throw null会抛新TypeError，诊断为空并残留syncing；普通marker Error在fail成功写degraded后也被跳过诊断 | 违反既有K2/TD030/TD031任意throw结构化失败与原值诊断。安全窄化/内部分类并按结算结果恰好一次上报，不能直接解引用unknown或靠变异异常对象区分调用方。归#465/#199 |
| R466-R2-F3 / P3 | `docs/exec-plan/completed/2026-10-30-planning-runtime-access.md:3` 已改Completed，但Progress164仍待本轮修复/当前head门，Outcomes先写P1已闭合、独立复评无P0/P1/P2 | 同步当前候选状态、Progress与Outcomes；本轮新P1/P2修复及当前head独立复验前不能沿用Completed结论。原状态摘要问题尚未完全解决 |

本轮实际证据：

| 命令 | 结果 |
|---|---|
| `node --test --test-timeout=120000 tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/integration/planning-round-order.test.js tests/integration/planning-snapshot.test.js` | 65/65；0 fail/cancel/skip |
| `node --test --test-timeout=120000 tests/integration/sync-revision-freshness.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/harness-plugin-host-planning-refresh.test.js` | 85/85；0 fail/cancel/skip |
| `node "$REVIEW_EVIDENCE/probe-466-marker-offline-admission.mjs"` | Memory/SQLite均cursor syncing+lastError unavailable、cap available、Saved/confirmed/ready；观察脚本exit0不代表安全通过 |
| `node --test --test-timeout=10000 "$REVIEW_EVIDENCE/probe-466-host-offline-admission.test.mjs"` | 1内容/准入断言失败；实际Host允许外部createBranch/createWorktree，无完整Planning恢复 |
| `node "$REVIEW_EVIDENCE/probe-466-null-rejection.mjs"` | null拒绝产生TypeError、seen=[]、cursor syncing；仅marker写Error后结果unavailable但markerDiagnosticCount=0 |

矩阵综合：本轮未发现P0；新P1在普通离线到retry过渡的产品/代码/准入闭环，新P2在异常/诊断恢复，P3为交接事实同步；原重启泄漏已解决，旧响应/并发轮次/partial读/普通启动与离线许可缓存的既有正反用例保持绿色。没有触碰#469开发文件或在实现owner修复期间改产品代码；完整发现一次性交协调者锁定候选head后处理，再由原owner修复。


## 第三轮冻结复评 · `9444354fb52a5cb6b9babbd0af6923b5ea9d91c6`

2026-10-30，base仍为 `47de6dfd182766a08168abb73321532af254ad8d`。从immutable Git对象导出隔离副本并使用本检出依赖；全部原探针仅重定位import，保留判别断言。源工作树仅本review未跟踪，owner未并发修改本记录。结论 **REQUEST_CHANGES：1 P1、3 P2**；未发现P0，未在首个P1停止。没有修改产品/测试、发布review或操作issue。

原项逐一核对：原单redaction故障重启探针1/1通过，但双故障安全仍未闭合；R2 offline retry的外部写准入已修复（Core memory/SQLite与真实Host均拒绝，Provider对象数不变），metadata只读解释仍未闭合；null异常已结构化并原值诊断，跨workspace原值分类污染已修；marker诊断和同context并发轮次分类仍失败。原P3的生命周期已同步为active且索引正确，最终收尾仍须按当前head改写历史Outcomes，不把旧局部绿色当944接受证据。

| ID / 等级 | 精确新增锚点 | 证据、根因与修复方向 |
|---|---|---|
| R466-R3-F1 / P1 | `packages/core/src/context.ts:156–157` | Healthy首读marker为syncing/null；Provider拒读后redaction和备用permission cursor都失败，真实Host重启ordinary offline再外发title/body/locator。错误码为空不能证明未结清读安全；新owner必须从marker本身关闭可见性，完整新读commit后才恢复。原P1在该必要故障组合仍UNRESOLVED |
| R466-R3-F2 / P2 | `packages/core/src/bootstrap.ts:77–79` | syncMarkerFailure为共享context字段；旧Provider deferred时另一轮marker失败置true，释放旧Provider Error后diagnostics=[]。单marker写Error但degraded可提交也诊断0。需要本operation局部阶段/内部结果，保留被消费异常的原值诊断；null裸异常和global污染修复不等于该诊断闭环已完成 |
| R466-R3-F3 / P2 | `packages/core/src/bootstrap.ts:111–114` | marker覆盖prior completed state，只复制错误码。offline→retry的metadata仍available；反向完整Healthy+行级permission缺口→正常refresh又被StartWork的syncing+任意错误码守卫误拒。两者来自同一前态语义丢失；metadata与命令须消费同一authority保留的prior许可/只读结论 |
| R466-R3-F4 / P2 | `packages/core/src/bootstrap.ts:345` | fallback permission cursor无epoch/round复验。旧失败备用transaction在入队前等待期间，新完整读取已提交并recover；旧写放行后Memory/SQLite都healthy→degraded/permission_denied。备用写也须在实际提交事务内复验当前版本，不得绕过恢复fence |

以上均属于#465/#457已要求的持久失败、offline只读、partial语义、旧失败不能推翻新恢复；诊断另对应既有#199/TD030/TD031。没有为这些反例新建重复issue，也不以父任务未关闭为豁免。

本轮实际命令与结果，以下探针均在仓库外 `snapshot-466-r3` 隔离副本根执行：

| 命令 | 结果 |
|---|---|
| `node --test --test-timeout=120000 tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/integration/planning-round-order.test.js tests/integration/planning-snapshot.test.js tests/integration/sync-revision-freshness.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/harness-plugin-host-planning-refresh.test.js` | 156/156，0 fail/cancel/skip |
| `node node_modules/typescript/bin/tsc --noEmit`；`node --test tests/contract/package-boundaries.test.js` | exit0；9/9 |
| `git diff --check 47de6dfd182766a08168abb73321532af254ad8d...9444354fb52a5cb6b9babbd0af6923b5ea9d91c6` | exit0；相同基准numstat为非docs799/docs271 |
| `node --test --test-timeout=10000 probe-466-host-restart.test.mjs probe-466-host-offline-admission.test.mjs probe-466-host-double-fault-restart.test.mjs` | 前两条通过；双故障重启1条失败，hasCanary=true、盘上syncing/null |
| `node probe-466-marker-offline-admission.mjs` | Memory/SQLite写准入均failed、零新外部对象；cap仍available |
| `node probe-466-null-rejection.mjs`；`node probe-466-marker-classification-pollution.mjs` | Provider null结构化seen[null]；marker诊断仍0；无关workspace后续null诊断1 |
| `node --test --test-timeout=10000 probe-466-round-classification.test.mjs` | 1诊断断言失败，独立旧Provider异常被另一轮marker失败抑制 |
| `node --test --test-timeout=10000 probe-466-fallback-old-failure.test.mjs probe-466-healthy-gap-marker.test.mjs` | 3状态断言失败：两Storage旧fallback覆盖新恢复，Healthy行缺口pending时误拒可见目标 |

最终隔离副本正式 `review-mutate.mjs` 整表一次：R3-marker-ack、R3-offline-admission、R3-reconstruct、R3-diagnostics均KILLED，各有killedBy归因，前/后基线绿色，exit0；bootstrap/context/start-work恢复后与冻结对象逐字节相同。它证明既有机制具有测试判别力，不覆盖上述新故障组合，不能替代产品闭环。

计划保持active恰当；当前无需第二authority、新账本或迁移。剩余问题集中在同一marker协议的前态、未结清事实、操作局部诊断和异常路径版本栅栏。完整意见由协调者锁定944后一次提交并交原owner；后续修复head须重新独立复评，本轮不继承未来CI/Ready/merge结果，也不接受真实账号、安装件UAT、父#457或R1。


## 第四轮最终冻结复评 · `07f150fff9e125eee856c0db4d20c00425938957`

2026-10-30，base为已合入#464/#467的 `main@417349a3b6504b73594362a3253d9ee1565ba5c5`。本轮从该Git对象导出独立副本亲跑验证，未使用owner的151+41或2759+7作为本轮执行计数。源工作树产品/测试clean，保留原未跟踪review且无并发写。**当前源码建议APPROVE：无新增P0/P1/P2/P3；原项全部ADDRESSED。** 此代码结论不替代具体预算、归档、最终push后CI/线程/issue回读或人类发布门。

| 原项 | 本轮独立结论与证据 |
|---|---|
| 原P1／R3-F1：双写故障重启 | ADDRESSED。原真实Host单故障和双故障探针均通过，Syncing/null遗留marker也恢复mask，不外发canary。普通已结清offline的正式正控继续保留许可缓存 |
| R2-F1／R3-F3：offline准入与前态丢失 | ADDRESSED。SyncCursor.cursorValue保存结清前态，嵌套begin保留；同一planningReadState供metadata、freshness、StartWork。Memory/SQLite/真实Host在offline retry均read_only且零副作用；Healthy行级gap的可见目标仍允许 |
| R2-F2／R3-F2：unknown与诊断污染 | ADDRESSED。markerFailure为本次bootstrap局部状态；null结构化且原值诊断；marker-only成功结算后原值恰好一次。真实并发两轮分别诊断，无跨context/全局原值污染 |
| R3-F4：旧fallback覆盖恢复 | ADDRESSED。删除备用writer，失败与提交共用事务内epoch/round裁决；旧fallback专用探针因入口删除不再适用，没有伪记通过。独立跑过begin五阶段×初次/已有round×两Storage的20用例；已有round10项保护新Healthy，去guard负控逐项红 |
| 原P3：计划事实与阶段 | ADDRESSED。计划/索引保持Active，精确列当前854行及31增量预算/最终远端门；历史owner报告与当前冻结代码、协调者职责分开，不提前宣称Ready/合并/R1 |

风险综合：P0层未发现第二Planning事实源、反向依赖、迁移或身份破坏；P1层实际Host/SQLite/watch/client恢复、重启、直接/重放/首次写、旧响应fence均有本轮验证；P2层begin全部失败阶段、诊断与正常/离线/行缺口的双向判别通过；P3层当前文档阶段和证据边界准确。设计仍是同一Core runtime owner和既有SyncCursor/PlanningSyncRound，不增加第二权限authority、账本、迁移或异常补写。#465技术闭环具备代码接受证据，#457后续Delivery/操作/browser、真实账号/安装件UAT与R1仍独立。

本轮实际执行（命令在immutable副本根，Git命令在所属工作树）：

| 命令 | 真实结果 |
|---|---|
| `node --test --test-timeout=120000 tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/integration/planning-round-order.test.js tests/integration/planning-snapshot.test.js tests/integration/sync-revision-freshness.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/harness-plugin-host-planning-refresh.test.js` | 180/180，0 fail/cancel/skip |
| `node --test --test-timeout=10000 probe-466-host-restart.test.mjs probe-466-host-offline-admission.test.mjs probe-466-host-double-fault-restart.test.mjs probe-466-round-classification.test.mjs probe-466-healthy-gap-marker.test.mjs` | 原外部反例5/5；双故障hasCanary=false，离线重试metadata仍read_only，两个并发原异常各上报一次 |
| `node probe-466-marker-offline-admission.mjs`；`node probe-466-null-rejection.mjs`；`node probe-466-marker-classification-pollution.mjs` | 两Storage准入拒绝且外部对象不增；seen[null]/markerDiagnosticCount=1；无关workspace后续诊断=1 |
| `node node_modules/typescript/bin/tsc --noEmit`；`node --test tests/contract/package-boundaries.test.js` | exit0；9/9 |
| `git diff --check 417349a3b6504b73594362a3253d9ee1565ba5c5...07f150fff9e125eee856c0db4d20c00425938957` | exit0；同基准实际非docs854/docs179，未包含本未跟踪review |

正式变异仅在隔离副本用review-mutate.mjs执行，最终具名用例整表4/4 KILLED、每项带killedBy、前后基线绿且源码与Git对象逐字节还原：未结清marker必须mask、prior-state解释、marker原值诊断、begin失败结算round守卫。首次宽变异命令在变异破坏健康路径后进入无关等待，主动终止exit130并恢复，不计接受证据；改用对应具名判别用例后最终整表exit0，无超时归因。

本轮没有重跑全量verify、真实平台mutation或安装态UAT。854行比人类具体已批823多31行，已知待裁定，不能因本轮APPROVE自动扩大；无需重复提问。归档/发布/CI/逐线程处理和最终合并由协调者按实际当前head完成；#465/#457已有追踪未另开重复issue。只追加本review和仓库外结果JSON，产品、测试、计划与外部状态未改。

## 2026-11-02 最新 main 接合与 Ready 复评

源码 `2025a22b036d5c10e5137e7d4d4f469dfaac8117`、base `554e6fefb1ad9781becf879b9f96e367e9f6ceff`，执行上下文 `fix/planning-runtime-access`。独立评审建议 APPROVE，无剩余已知 P0–P3；原 Core/client/Start Work 与 07f150f 逐字相同。

新 main 的 WorkspaceSetupGate 在 denied 时卸载 WorkItemApp，导致真实 Panel 恢复按钮消失。先新增真实 Wire DTO 与 actual apply Panel 判别，14 pass/2 fail；最小接合修复保留同工作区、已确认挂载、明确 PermissionDenied 的安全容器。planningSource 在拒读时有意隐藏，若存在则需匹配当前挂载；unknown、foreign workspace/source、无已确认挂载不放行。它只维持视图与显式重验证入口，不授予业务权限，内容继续由 Host redacted 与 UI-model failed 分支遮罩，旧未决命令不因容器卸载丢失。

独立实际命令在该分支工作树根：`node --test --test-timeout=120000 tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/contract/ui-workspace-status.test.js tests/integration/harness-plugin-workspace-status.test.js tests/contract/ui-workspace-settings.test.js tests/contract/ui-workspace-shell.test.js`，116/116，0 fail/cancel/skip；额外真实 DTO 六组正反判别通过。owner 完整 `pnpm verify` 2799/2799 加 MVP-0 7/7，typecheck 通过。source 仅在 UI 接合、Host 测试合法配置与 Gate/Panel 回归有新增，完整代码增删 883；所有既有安全断言保留。

人类在具体候选规模说明后指示“继续并完成 ready 交付”；该决定和新 main 必要接合已写归档 ExecPlan。当前产品结论与人类 UAT/R1 接受分开，最终提交整理/发布后仍按当前 head 核 CI、双向 issue、完整 review threads，才置 Ready。


## 2026-11-02 R5：当前 Ready 候选全矩阵复评

本节取代本文件此前“当前候选无开放finding”的结论；旧阶段证据保留为历史。冻结head `1744c22a3e02cc476fbe58515decb24bc73dfcf6`，review actor为 `Singularity-AI-Bot`。

当前结论 **REQUEST_CHANGES**，新增 **R466-CURRENT-F1 / P1**，锚点 `packages/core/src/start-work.ts:91–92`。普通 offline refresh 已完成、metadata/read precheck 为 read_only/unavailable，但等待首次外部写 preflight 的请求仍创建 branch/worktree/run 并返回 Saved。Fake/SQLite 独立计数 `[1,0,2]→[2,1,3]`，真实 Host/SQLite/remote/client.apply 亦复现；Saved replay 的等待窗同根因穿透。首次实际 Provider 写尚未开始，修复不要求撤销在途副作用。

全矩阵未新增 P0；既有 denial/marker/epoch/source 容器、Healthy gap 与普通 offline 缓存正控通过。正式窄验收112/112、boundaries9/9、typecheck通过，3项具名变异KILLED；新窗口2 pass/4 fail、真实Host first-write 0 pass/1 fail、无cancel。不能用既有绿色CI或旧批准覆盖新反例。

#465 的 completed ExecPlan 路径及历史预测说明已按现有 Decision Log 同步，原6项AC勾选原样保留。后续由实现owner统一修复当前只读准入、更新ExecPlan当前阶段并独立复评；不得机械清空offline缓存或把所有健康刷新在途都拒绝。

同批正式review已提交并回读：review `5732397709`、状态 `CHANGES_REQUESTED`，新增inline 1条。完整矩阵、原始日志、探针及具名变异表位于该工作树运行态 `.superpowers/mmp-review-current-20261102/`，不进入公开分支。

本轮未修改产品或正式测试、未push或merge；本节文档由原owner在后续修复批次一并提交。源码或父层变化后须重锁head/base、受影响验证及正式复评。Issue关闭、规划接受、真实账号/安装件人类UAT与R1均独立。

## R5 作者修复批次冻结（待 root 独立复评）

source `67fdc7465caf9e2675a661f7d94351bfee2822e0`、base `554e6fefb1ad9781becf879b9f96e367e9f6ceff`。R466-CURRENT-F1的ordinary offline不改变denied/epoch，故旧纯runtime检查遗漏只读处置；现在复用startTargetError当前projection/cursor/planningReadState，异步准入前后检查旧epoch，claim与intent事务尾仅使用tx，首次写hook提交前后再读同一判定。

正式矩阵保留Healthy/no-error、Healthy行级gap、healthy-pending正控和offline缓存，offline各等待窗阻止未发Provider写或旧Saved返回。初始新反例43pass/9fail，修复后相关矩阵GREEN；原Core与真实Host外部探针7/7。扩查Host已confirmed cache不进入Core ledger，补同Assembly的已有Core目标query在前后返回边界；新/缓存×四处置先6pass/2fail后8/8，保留已ack结果value/句柄和原ledger，恢复原键确认且外部计数不变。

在检出`fix/planning-runtime-access`的工作树根运行`node --test --test-timeout=10000 tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-execution.test.js`为149/149；`pnpm verify`2866/2866加MVP-0 7/7、typecheck通过。只读当前Storage读取是复验线性化点；没有第二权限authority或public remote command，没有取消已发I/O。完整代码993，文档门与最终远端证据仍由最终提交回读。

本作者记录报告修复与本地证据，不自行给新版本评审批准或resolve线程；正式review的完整原R5发现已保留，待root独立复评当前source后继续交付。

## R7 作者最终源码冻结（等待独立当前版本结论）

2026-11-02 SGT，冻结 source `5e498eb153ec6456f0c642ff5093ba7d04e61566`、base `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`。普通失败仅在当前轮事务 ack 后推进 admissionEpoch，access epoch 继续裁决可信拒读/恢复；最终 cursor 返回、ledger/replay 和 Host 缓存窗口统一失效。较新 ordinary offline 不再吞掉旧可信 deny；Healthy、行级 gap 和健康在途刷新保持正控。新 main 的 PR 操作共用完整 Core context，无第二准入事实源。

实际代码1000，文档小于1300。完整 `pnpm verify` 3171/3171 加 MVP0 7/7；原两探针7项与独立最后cursor探针2项通过。顶层组合又复跑这9项并加入472原6项，15/15；隔离变异中当前准入与双版本各被具名用例检出，基线与还原后均GREEN。首次合并参数遗漏被typecheck发现并修正；旧失败不作为完成证据。固定 source 证据不代替最终远端 head CI、root新版本评审或 UAT/R1；尚未 resolve 本轮线程。

## R9 独立复评阻塞：同一F1的跨owner处置

前述R7作者冻结不是最终接受。协调者在source5e498eb/baseea37903独立复评仍REQUEST_CHANGES：peer Core双Storage与真实同文件双Host的三个反例失败，同owner10项仍通过；另一owner已提交ordinaryoffline，但当前owner旧HealthyPromise仍能首次创建。另独立两设计者锁定稳定foreignSyncing的actualdeny/redactionrollback、来源名、未知marker重试以及peer完整确认恢复的相邻边界。正在统一共享Disposition，不以本地admissionEpoch或新Storagefencealone冒充闭合；新候选完整测试、规模裁定及独立复评后再交付。原正式远端F1线程保持open。

## R10 / R11 当前共享处置复评

R10 source `70b17e6`、等价 Foundation R2 restack `79daa4b` 的完整独立复评确认原跨ownerF1 ADDRESSED，own无P0/P1；299正式+13原反例+4合法after-firstclaim+2own-lifetime、typecheck/boundaries9及8具名负控通过。唯一新增P2 R466-SHARED-F1：直接首次新操作在lazy peerproof对齐前捕获epoch，首StartWork stale、首refresh留下unowned marker。

R11 source `b2a17a7`（2026-11-02 SGT，base Foundation `451457b`）先在原initial target与planning(tx)对齐后捕版本；begin marker失败同源回传捕获epoch，不在catch获取最新版本。正式新增6项RED→GREEN，正式280、原反例4、真实worktree完整3278+7/typecheck通过。独立协议复评20正式+2 marker期间后到真实拒读诊断通过，无新finding；协调者当前source评审仍待回读。实际1178 A+D比已批准1165增13，原批准不扩大；最终预算、当前headCI与正式review/作者resolve/Ready仍是门。未取消已发I/O或改规划Status/原生依赖/UAT/R1。

## R11 协调者当前源码接受与归档

2026-11-02 SGT，source `b2a17a77f750954bb43a53fa7713523947bdcd4d` / base `451457b` 获协调者独立APPROVE，R466-SHARED-F1/P2 ADDRESSED，findings=[]。原4/4、新6含在窄46/46、typecheck0、三新fix具名负控KILLED、410文件还原一致；协调者另独立重放refresh原2/2，首次Healthy5/5、后续恢复正控零新增effects。未重跑旧299或冒用旧全量；owner当前完整3278+7和十一负控已保留。人类明确批准本source1178（较旧1165增加13），计划归档completed。最终产品等价文档head仍需CI/双向issue/线程和正式当前head批准回读，再作者resolve/Ready，不merge。

## 2026-11-02 接手复核 · R12 已批准交付

锁定 head `8bd4457ae2d83a45234d9486b2b35a200d6301a5` / 直接 base `5bd94d017cc6d261043dcdd2770d59b15fcca00b`。实际检出与当前远端一致，两个提交为能力与文档；10个线程均resolved、分页结束，当前head存在独立APPROVED，PR仅Closes #465。接手复核建议 **APPROVE，无新增P0/P1/P2/P3**；可以进入文档整理与新head重新CI门，后续rebase或push必须重新锁定。

先读原P0–P3矩阵及全部最新R10/R11结论，再核对R12交接。对已接受 source `b2a17a77f750954bb43a53fa7713523947bdcd4d` 执行 `git diff --name-status <source> HEAD`，全部漂移均在docs，整个产品/测试/配置/workflow无漂移；逐个当前变更代码blob相同。复查共享cursor/round处置、owned round寿命、root同步fence、begin对齐后捕获epoch、marker异常携带同源版本、commit ack后恢复、StartWork首写/重放及Host缓存返回门；UI只保留同一确认工作区的安全恢复容器，未授业务权限。一个Planning事实源、规划/工程正交、阶段/并行门禁、显式关联、谱系传播、Host权威与无LLM门控均保留，无第二权限账本、迁移或扩大API设计。

具体规模授权另行核实：completed ExecPlan Decision Log记录原话“批准这两个具体候选，继续 Ready”，明确限source `b2a17a7` 的1178行（比旧1165多13）；当前#465正文同样记录精确source/count及例外边界。当前产品与该source完全等价、实测仍1178，故适用该具体授权；不是从当前APPROVED或本次合并授权推导预算豁免，更不外推未来范围。

本次在 `.worktrees/planning-runtime-access` 实际运行：

- `node --test --test-timeout=120000 --test-name-pattern='after-peer-recovery|peer denied|unclosed foreign|healthy row-gap|peer Host actual denial' tests/integration/runtime-planning-access.test.js tests/integration/harness-plugin-runtime-access.test.js`：17/17，fail/cancel/skip均0；涵盖两Storage首start/refresh/marker失败恢复、actual deny与redaction rollback、foreign未结清marker、健康行缺口正控，以及真实peer Host零泄漏/零新effect。
- `node scripts/rule-checks.mjs disclosure 5bd94d017cc6d261043dcdd2770d59b15fcca00b`：exit0；人工复核当前新增面，未发现新增敏感披露。
- `node scripts/rule-checks.mjs size 5bd94d017cc6d261043dcdd2770d59b15fcca00b`：**exit1**，如实报告代码1178/1000、文档481 A+D；不改规则、不伪记通过，具体例外依据见上一段。数字不含本addendum。
- `git diff --check 5bd94d017cc6d261043dcdd2770d59b15fcca00b...HEAD`：exit0；当前变更Markdown相对链接missing=[]。
- 当前 `gh pr view`、完整threads与#465/#457回读成功；原六项AC仍未勾选、父项边界未被本评审接受。PR Fast Gate、Verify与Merge Gate各lane为SUCCESS；advisory size保留FAILURE。可选review run41439334093实际日志为endpoint 000000连接失败，按既有#364/手册排除为本产品缺陷。

原R11完整3278+7、280正式和11具名隔离负控按等价源码证据保留，本轮未重复大套验证或冒充亲跑。#465的Planning闭环与#457的Delivery/逐步写权限/production browser、人类真实账号/安装态验收、R1分别保留；本次无新增真实缺陷或重复issue需求。仅追加此记录，未改实现/计划/index/Git或远端。
