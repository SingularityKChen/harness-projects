# PR #469 MMP 交付评审

> R4历史源码结论（2026-11-02，Superseded by 本文 R10 来源复核）：APPROVE；source c5a72d594faaeddcfe2375276c792c93ae77b633 / base 1744c22a，原 P1 与 fence F1–F4 已闭合。历史缺陷记录按轮次保留，最终远端 head/CI 另回读。

- 日期：2026-10-30；结论：**REQUEST_CHANGES：1 P1**。只评价相对 #466 的独立 Delivery 增量；#466 的 Planning 新发现归其所属 PR，不重复计数。
- Head：`f64e51446bd9fb07cdd899befd9d604f09a8a696`；base：`fix/planning-runtime-access@d9b669e5c3b2f29b185df8b8ae71ec2391670c10`。
- 执行上下文：`.worktrees/delivery-runtime-access`；评审账号约定为 `Singularity-AI-Bot`，作者侧为 `SingularityKChen`。
- 方法：Superpowers 独立子评审；Qian 按读健康、事实事务、目标投影和详情缓存综合；First Principles 从共享权限证据与迟到响应构造反例。

## 风险矩阵（先建后查）

| 等级 | 主要失效假设 | 检查层与最终结果 |
|---|---|---|
| P0 | 第二权限 authority、跨 target/key 永久泄漏或破坏事实所有权 | 查能力路由、Storage、身份与关系；本增量未发现 P0 |
| P1 | 旧响应、部分恢复、事务失败或重启暴露受限内容 | key/target/binding、历史 scope、ABA、存储 rollback 均有判别性绿证据；**跨 owner 已提交拒读后的返回窗口仍泄漏 CI** |
| P2 | 故障层归因、可恢复提示或局部可用性丢失 | permission/capability/policy 固定层、retry 与无关集合可读；未发现新增 P2 |
| P3 | 文案、闭集解码、维护与交接 | 无需扩大本轮变更的新增问题 |

## 锁定事实与验收

- 精确 head 快照含提交 `3f36514eb518a681c22b77bd2b634381973ebcae`、`f64e51446bd9fb07cdd899befd9d604f09a8a696`；base/head 与检出一致；Ready、MERGEABLE、UNSTABLE。
- PR Fast Gate、Verify、Merge Gate、规则与 CodeQL 均成功；唯一非成功为非必需 `Create review session`。本轮不将自动转发评审端点失败当作产品通过证据。
- reviewThreads `nodes=[]`、`hasNextPage=false`；双向 closing 为 #468。#468 仍开放；#457 的后续操作/production browser 总验收与 R1 不由本次子切片自动接受。
- #468 的 Pipeline/Check 独立撤权、仓库/PR 锚点依赖传播、offline stale、绑定/目标隔离、历史 scope 恢复、纯查询与生产 client token 都有当前证据；跨 owner 返回一致性仍阻塞自身闭环，不是后续 browser 范围。

## 分层证据与设计判断

结构化 gap 保留 code/key/binding，Provider 原文不出 wire。现有 SyncCursor 承载 binding/key/repository 健康，事实 writer 仍唯一；scope 恢复与事实同事务，ack 后安装，关系身份不删不重识别。repository accessVersion 驱动局部详情 token，避免 available→denied→available 合帧 ABA；目标/key 拒读只传播到实际依赖集合，设计方向适合本闭环。

风险在持久健康与内存投影的返回接缝：`getDeliveryAccessVersion()` 只有本 Core 的 epoch，另一个 owner 的持久拒读不会同步推进该值。一次纯读已拿到旧 cursor、或真实 Host 的最后可见性事务已提交而其 Promise 尚未返回时，最终 local-version 比较无法发现外部更新。下一次读能够遮蔽，不能补救已经外发的旧响应。

| 本次实际命令 | 结果 |
|---|---|
| `node --test --test-timeout=120000 tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/e2e/delivery-lineage.test.js` | 70/70 通过，0 失败/取消 |
| `git diff --check d9b669e5c3b2f29b185df8b8ae71ec2391670c10...HEAD` | exit 0 |
| `node "$REVIEW_EVIDENCE/probe-469-cross-owner-return.mjs"` | memory/SQLite 均返回 during=2、after=0，旧响应含 ci_passed；exit 0 为观察脚本正常完成 |
| `node --test --test-timeout=10000 "$REVIEW_EVIDENCE/probe-469-host-cross-owner.test.mjs"` | 1 个内容安全断言失败：returned=2、subsequent=0、facts 含 ci_passed |

`REVIEW_EVIDENCE` 指本轮仓库外临时证据目录，原文与 findings 交协调者。Host 探针以两个正常 `createHostComposition` 打开同一 SQLite，只有实际 Delivery Provider 返回 permission_denied。A 在最后 scopeGuard 的 baseline 事务 COMMIT 后、Promise 交回前等待；B 经真实 controller 刷新并提交拒读完成；再放行 A。没有 Controller-return override、第二权限 map 或人工合成响应。

### 发现

1. **P1，新增 `apps/harness-plugin/src/host-composition.ts:80–81`**：最终异步 scopeGuard 后只比较本 owner 的内存访问版本。另一个受支持 owner 已持久化拒读时，该比较仍相等，实际 remote 返回旧 pipeline label/externalId/ci_passed；下一次请求才返回 0 节点。纯 Core 的 getSyncCursor 取旧值后等待窗口，在 memory/SQLite 同样成立。根因是分次健康读取与本地 epoch fence 无法构成共享 authority 的返回一致性。修复需让最终返回复验同一共享健康版本或共享失效机制，保持纯查询与精确 key/target/scope，不以 UI 再读补救旧响应。已有追踪：#468 Acceptance 3/4/5/6、#457/#144。

该场景有明确当前契约：正式测试 `durable health survives close/reopen, cross-owner denial, offline and same-scope recovery` 已创建第二 Core 并要求第一 Core 观察较新拒读；本 PR Design「跨 owner 读健康与返回一致性」明确承诺每次查询读取其他 owner 的持久新版本。生产 Host/Storage 没有单 owner 排斥，探针正常打开成功。因此不是绕过单 Host 边界制造第二权限源。

### 测试判别力

只在仓库外隔离完整副本用 `scripts/review-mutate.mjs`；每个变异含 killedBy，逐字节还原并重跑基线。本次最终树整表一次 exit 0：

| 变异 | `killedBy` | 结果 |
|---|---|---|
| D-mask：取消集合 query mask | `offline retains facts; denial hides only its collection` | KILLED，相关内容/访问断言红 |
| D-epoch：currentDelivery 恒真 | `older local transaction awaits` | KILLED，仅该等待事务反例红 |
| D-host-fence：去掉最终 local version 比较 | `final visibility confirmation` | KILLED，仅该真实 Host 反例红 |

这证明原单 owner fence 不是无效测试；本次新跨 owner 反例揭示共享更新尚未进入该 fence。未修改原工作树产品源码或测试。

## 评审与后续

全矩阵已查完，完整发现交现有实现 owner。修复后独立复评应同时重跑 Core memory/SQLite 与真实 Host 新反例、既有同 owner final fence、持久健康失败/recovery rollback、历史 scope 和 ABA 正反 pair，并重新锁 head/base/checks/threads。本轮未提交 GitHub review、push/merge、issue Status 或关系；本地软件证据不替代真实账号、已安装 Host UAT、父 #457 或 R1 人类接受。


## 2026-10-30 冻结吸收版本独立复评（开始时矩阵）

锁定 head `db6b01df3bfa083a82722a119876c66eefd0f516`、base `07f150fff9e125eee856c0db4d20c00425938957`；原 owner 已冻结，产品树干净，评审记录仍未跟踪。本轮完整直接增量和反例重新检查，不继承旧批准。

| 等级 | 当前复核假设 | 开始状态 |
|---|---|---|
| P0 | 新 Storage 能力破坏提交/rollback、引入第二事实源或越层依赖 | 待验证 |
| P1 | 跨 owner 最终返回仍外发旧 CI、partial/offline/scope/ABA 绕过拒读 | 待验证 |
| P2 | F1/F2/F3/F5、事务结束后作用域误判、正式测试判别力及 cleanup/timeout 回归 | 待验证 |
| P3 | 吸收拓扑、计划自包含、发布面与提交边界；未完成的 root 门是否如实标明 | 待验证 |


## 2026-10-30 冻结吸收版本独立复评（结论）

当前 head `db6b01df3bfa083a82722a119876c66eefd0f516`、base `07f150fff9e125eee856c0db4d20c00425938957`：**未发现新增 P0/P1/P2/P3，建议当前本地版本 APPROVE**。本结论重新审查了直接增量，不继承首轮或中间 #481 的批准。最终 push/归档后的真实 head、base、CI、全部线程与 closing 仍须协调者重锁；#466 父层若变化，应先核对产品 blob 与必要组合。

| 等级 | 冻结版本矩阵结论 |
|---|---|
| P0 | 未发现。Storage 契约仍由 Memory/SQLite 实现；无迁移/删除、domain 反向依赖或第二权限权威。 |
| P1 | 原共享 owner 最终返回泄漏已解决。Core 两种 Storage 与真实同库双 Host 正式/外部反例均当次返回零受限 pipeline；partial、offline、scope、ABA、持久化失败与旧结果的断言保留。 |
| P2 | F1 direct atomic、F2 非字符串 fail-open、F3 正式返回 barrier、F5 settled AsyncLocal 后代误拒绝均有本轮独立 GREEN 和具名反控。未发现其它 P2。 |
| P3 | 原中间计划与提交文本已在吸收时整理：一份自包含 Active 计划、中文能力/文档两提交、真实换行与关联尾段。明确待协调者处理的远端门未被声称完成。 |

### 原发现逐项复核

- **原 #469 P1：ADDRESSED。** 共享 committed fence 进入 Core 投影/metadata 与 Host 最终返回；最终同步比较后无 await。原外部 Core 探针 Memory/SQLite 均 `during=0, after=0`；原真实双 Host 探针 `returned=0, subsequent=0`。正式 Core 两案与 Host 一案已移入现有测试，受限内容在本次响应即消失。
- **FENCE-F1 / P2：ADDRESSED。** 直接 root atomic 成功提交明确计入本地代次，SQLite `1:1→2:1`；只读 transaction 和 rollback 保持代次，scoped 写事务推进。删除 `commitOnSuccess` 的变异由 exact atomic 用例杀死。
- **FENCE-F2 / P2：ADDRESSED。** 非字符串同步 fence 响亮拒绝；独立探针逐项拒绝 undefined、null、number、Promise，普通同步 string 正常；现有通用 Storage wrapper 保留新同步方法，不再使用 `undefined` / `wrapped` 绕过。
- **FENCE-F3 / P2：ADDRESSED。** 原来只在运行态的最终返回窗口已成为正式 Core Memory/SQLite 与真实双 Host 测试。共享 fence 改常量及删除 Host 最终比较，分别在对应内容安全断言 RED；不再是 accessor 变动单测冒充返回安全。
- **FENCE-F5 / P2：ADDRESSED。** Memory 使用可结算 token，SQLite 比较 `active`；活跃 root/scoped 调用仍拒绝，COMMIT/ROLLBACK 后的异步后代可正常读取根 fence。原两份独立 false-positive 探针均返回正常行和 string fence；四个正式 settled callback 子例及负控保留。
- **FENCE-F4 / P3：ADDRESSED 于当前本地交付物。** 原 #481 调查计划统一进 #469，临时本机命令不再作为正式复跑前提；提交为 `fix(core): 闭合交付读健康与共享返回栅栏` 和中文文档摘要，body 为真实段落、`Closes #468` / `Refs #457` 尾段。#481 远端关闭、最终发布与归档继续由协调者串行操作，不是已完成产品状态。

### 完整直接增量、夹具与验收边界

逐项审查 34 个直接变更文件及必要消费者。SyncCursor 继续是 binding/key/repository 健康和恢复 scope 的持久家，token 仅作共享变更信号，资源事实仍归既有 writer。非存储 RuntimeAccess 模式只为现有直接算法测试保留，生产 Core 从唯一 Storage 构造。新公共方法的闭集类型、StorageTransaction 排除和 package boundaries 均有当前证据。

正式三案的夹具复用保留了真实 `composeCore`、同文件两个 `createHostComposition`、两个 remote service、真实 controller 刷新与 SQLite 提交；没有 controller 返回覆盖或第二权限 map。Core/Host barrier 有 5 秒到达失败边界和 finally 释放；Host 的两个 owner 及 stream/数据库/临时目录均注册清理，watchInterval=60 秒仅避免 watcher 干扰本次精确事务屏障。Host 案仍断言许可 check 保留、无成功事实。未通过压算法行或删除安全断言换预算。

本轮只读回读 #468 和 #457：#468 六项技术验收均有本增量中的当前证据；#457 还包含 #466、#472 的 write-step/browser 与父级产品范围。两 issue 仍 Open，不由本次局部测试或 Ready 描述推导关闭、Planning Status、真实账号 UAT 或 R1。远端 body 中旧规模预测及 ready 文案的最终对齐，属于已明确留给协调者的串行发布门；当前具体 1000 行授权记录在本计划 Decision Log。

### 本轮独立验证（不是 owner 报告）

在锁定版本的隔离完整副本运行，工作区包解析守卫通过，产品/测试 32 个变更路径与 immutable head 逐字核对。以下命令均 exit 0，未重跑完整 `pnpm verify`：

    node --test --test-timeout=120000 tests/integration/delivery-read-fence.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/storage-sync-surface.test.js tests/contract/storage-contract.test.js tests/integration/planning-snapshot.test.js tests/e2e/status-policy.test.js tests/integration/delivery-repository-routing.test.js tests/integration/provider-binding-registration.test.js tests/integration/harness-plugin-delivery-lineage.test.js tests/e2e/controller-roundtrip.test.js tests/e2e/delivery-lineage.test.js

结果 **370/370**，0 fail/cancel/skip。

    node --test --test-timeout=120000 tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/integration/pull-request-identity-convergence.test.js tests/integration/harness-plugin-host-github-catalog.test.js

结果 **142/142**，0 fail/cancel/skip。两组共 **512** 项；另有 boundaries **9/9**，typecheck exit 0。原 Core/Host 外部反例和 Storage lifetime/invalid-fence 探针另计，不混入正式 suite 数量。

    node node_modules/typescript/bin/tsc --noEmit
    node --test tests/contract/package-boundaries.test.js
    node scripts/rule-checks.mjs size 07f150fff9e125eee856c0db4d20c00425938957
    node scripts/rule-checks.mjs disclosure 07f150fff9e125eee856c0db4d20c00425938957
    git diff --check 07f150fff9e125eee856c0db4d20c00425938957...db6b01df3bfa083a82722a119876c66eefd0f516

机械规模 **979/1000 code A+D、218 docs A+D**（尚未计入未跟踪评审记录，最终由协调者重算）；机械 disclosure 与 diff 检查通过。人工审读当前新增文件与两个提交，未见凭据、本机身份、个人信息、内部系统或保密材料。原 #481 中间提交的英文/literal 换行未进入本分支两提交。

### 正式变异判别

在最终 immutable 产品树隔离副本，整表一次运行 `node scripts/review-mutate.mjs <spec.json>`；command 为三套正式 fence/runtime/真实 Host 测试加非法同步契约探针。七项均提供 killedBy，全部 KILLED、runner exit 0；前/后基线 GREEN，按原文字节还原后与锁定 head 逐字相同。

| 变异 | killedBy | 结果 |
|---|---|---|
| D469-M1 去掉 root atomic 的提交计数 | `SQLite atomic SQL writes advance the committed fence` | KILLED |
| D469-M2 非 string 改回 wrapped | 非法 fence 独立探针文件 | KILLED |
| D469-M3 共享 fence 改常量 | `Core read retries after another owner commits Delivery denial` | KILLED，正式 Core 两案与双 Host 案内容断言均红 |
| D469-M4 去掉 Host 最终比较 | `real Host return fence retries after another Host commits denial during final scope guard` | KILLED |
| D469-M5 Memory 忽略 active | `memory settled commit callback can read the fence` | KILLED，commit/rollback 两例红 |
| D469-M6 SQLite 忽略 active | `sqlite settled commit callback can read the fence` | KILLED，commit/rollback 两例红 |
| D469-M7 取消集合 query mask | `offline retains facts; denial hides only its collection` | KILLED |

没有观察到正常 shipped 工作负载的无限重读/饥饿，故不把未证实的 seqlock 活性风险报成缺陷；本轮也不将 global token 当 Provider 权限证据。当前结论交协调者串行归档与远端当前版本门，本评审未提交 review/评论、commit、push、merge 或写 issue 状态。

## 2026-11-02 当前 main 安全栈接合复评

source `c5a72d594faaeddcfe2375276c792c93ae77b633`、base `1744c22a3e02cc476fbe58515decb24bc73dfcf6`，工作分支 `fix/delivery-runtime-access`。独立只读逐字核对 Delivery 生产增量与旧 db6b01d 一致；Host runtime fixture 冲突合并保留真实 Planning 配置/Panel 和 Delivery provider/watch 两边，所有安全断言保留。

独立运行 `node --test --test-timeout=120000 tests/integration/delivery-read-fence.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js`，51/51，0 fail/cancel/skip；原 shared fence、恢复 ack、scope 隔离、双 Host 最终 guard 及新真实 Panel 均覆盖。当前源码建议 APPROVE，无新增 P0–P3。owner完整复跑2842/2842加MVP-0 7/7与typecheck通过；首次全量的Gateway并发单项失败另在ExecPlan如实记录，未改用例绕过。

代码仍979，未因接合删断言或压缩算法；完整481候选将由本PR保存，远端双向closing确认后再关闭中间PR。用户最新“继续并完成 ready 交付”已记入归档计划，本轮仅Ready请求人类评审，不执行合并。


## 2026-11-02 R5：当前 Ready 候选全矩阵复评

本节取代本文件此前“当前候选无开放finding”的结论；旧阶段证据保留为历史。冻结head `57a9f77d039ba9a63ef02af35ae17d903cd8caf6`，review actor为 `Singularity-AI-Bot`。

当前结论 **APPROVE（仅本层Delivery直接增量）**，无新增P0/P1/P2/P3技术finding。完整35文件与共享read-health、Storage committed fence、Core/真实Host返回、scope/ABA、独立集合遮罩、offline保值、Planning Status不变量均重新检查。

本轮正式窄测283/283、独立非法token/跨owner ABA探针3/3、boundaries9/9与typecheck通过；7项具名mutation KILLED且源码逐字还原。当前精确head的dispatch Verify/PR Fast Gate成功已重新回读；本轮没有重跑完整verify或冒充人类UAT。

#468旧active计划路径/预测的P3已同步，原6项AC勾选不变，#481仍CLOSED且closing468仅属469。父层#466以及栈顶#472另有当前阻断P1，整栈不得合并；本层批准不接受#457整体。父层修复/rebase后需重锁并复核当前组合。

同批正式review已提交并回读：review `5732398075`、状态 `APPROVED`，新增inline 0条。完整矩阵、原始日志、探针及具名变异表位于该工作树运行态 `.superpowers/mmp-review-current-20261102/`，不进入公开分支。

本轮未修改产品或正式测试、未push或merge；本节文档由原owner在后续修复批次一并提交。源码或父层变化后须重锁head/base、受影响验证及正式复评。Issue关闭、规划接受、真实账号/安装件人类UAT与R1均独立。

## R7 新父层与主线接合冻结

2026-11-02 SGT，source `3c8b8da155d71ce977f340cf1eca280d23b71209`，直接父层 `5e498eb153ec6456f0c642ff5093ba7d04e61566`。保持完整 read-health、同步 committed fence、共享 Storage 返回复验与唯一 Closes #468。接合新 main 时同时保留 PR creator/onConnect、纯读 action(false)、accessToken 与 scopeKey；不是用新操作覆盖返回fence。

代码979，完整 `pnpm verify` 3214/3214 加 MVP0 7/7；原七项隔离具名变异全部KILLED。首次复跑缺少独立外部probe导致 invalid-fence 变异存活，补回未改断言的原 probe 后七项全检出；不将缺fixture的结果冒充产品RED。最终当前head CI、root复评与远端关联仍待串行确认。

## R10 来源复核与 Storage 前置

2026-11-02 SGT，独立review source `570c3aad6b1ead023b21f8aab11c27a300684078` / base `79daa4b`，本层 findings=[]、可接受。当前本层833代码/389文档；相对`cdb1143`仅四Foundation R2产品文件变，且与前置#510 source`d44b10a`全等。规范化相对R5的Delivery生产/Host正式测试增量逐字一致，Core消费者第12案和父Planning双Host尾段完整保留，Host assert/test没有删除。原11纯Storage合同完整移入#510并扩为16正式，全部Storage实现归其权威；本层保留Core/Host共享返回fence，没有削弱范围。

本轮来源审查未重跑旧全量/负控，不冒充新证据。当前父层PlanningP2和顶层operation C1/C2各归本层修复，#469接受不解除整栈门。最终source/head/base/受影响验证、CI/远端review另锁；#481保持CLOSED，唯一Closes468仍为469，未改变PlanningStatus/AC/UAT/R1。

## R12 接手复核 · 逐层 main 重放前

2026-11-02 SGT，锁定 `f0e9c7db564a2e6b44a154a98326d24778ee057e` / 直接父 `8bd4457ae2d83a45234d9486b2b35a200d6301a5`。重读原 P0–P3 矩阵与 R10/R11/R12 来源后，独立比对已接受 source `4cf723b085b8cf63faeddae83a9305fab7d75f5c`：全部439个非docs tree项逐字相同，无产品/测试/config/workflow漂移；能力与文档两提交，本层833代码/405文档，diff-check通过。

当前源码 **APPROVE，findings=[]，可进入逐层真实 main 重放**。Storage同步root fence/事务排除仍归#510，#466的Planning disposition/round与本层共享返回围栏相接；Host最后同步版本比较后无await，scope恢复仍要求facts/Storage ack。设计延续既有读健康与唯一事实writer，无第二权限账本或Planning Status写入，未见新增设计不足/过度。既有完整矩阵和具名负控保持原source归属。

本次实际窄验：`node --test --test-timeout=30000 --test-name-pattern='two Memory Core owners|Core read retries after another owner commits Delivery denial|real Host return fence retries after another Host commits denial' tests/integration/delivery-read-fence.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js`，4/4、0 fail/cancel/skip/todo；Memory/SQLite Core与真实双Host的共享提交返回窗口保持关闭，未重跑全量/旧负控。

现场远端仍为上述head/base、Ready/APPROVED，正式R12 review `5736246297`指向同head；唯一原线程resolved、分页完整，唯一Closes #468。Verify/PR Fast Gate/Merge Gate/CodeQL/disclosure当前成功，可选建会和重复cancelled保持原分类。#468六项AC仍未勾选；本子评审不写issue或推导人类UAT/R1。根协调者负责本轮授权范围内的顺序重放与合并，每次新base/head仍须独立差异复核、当前检查与关联回读。本次只追加本记录，未改实现/计划/索引、Git或远端。
