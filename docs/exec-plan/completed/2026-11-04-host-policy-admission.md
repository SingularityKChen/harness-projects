# Core Host 持久规划策略准入 ExecPlan

> 状态：Completed；创建：2026-11-04；执行分支：`fix/host-policy-admission`。
> 范围：工程子项 #540；Core Host 装配只接纳 Provider 权威规划策略；保留数据并拒绝其它合法策略，字节原样承诺限打开前已标记当前 generation3 且通过 Storage 准入的库。
> 上游：#413 Core-first 范围、#459 边界审计、#273 未决策略语义；依照根 `PLANS.md`。

## Purpose / Big Picture

已有合法数据库采用 Host 权威或人工策略时，本 Core Host 在既有 Storage schema/generation 准入之后、构建任何 Provider 或开始同步之前明确停止装配，避免自动刷新覆盖本地规划状态。用户得到固定安全说明，业务数据、策略、配置和凭据句柄保留。

原表述“两种合法但不受此 Host 支持的策略被早期拒绝、全库不变且外部调用为零”中，无条件的“全库不变”字节解释 Superseded by 本节下方 Storage 准入边界（2026-11-04）。当前成功证据限两种打开前已标记当前 generation3、且通过既有 Storage 准入的合法库：Host 策略拒绝时全库字节不变、外部调用为零。支持的库和空库继续运行。每代候选装配复用该门；发现不支持策略后，旧 Host 也不能重新开启同步。

Storage 准入边界：完整合法但未标记（`user_version=0`）的库，仍先由既有 `packages/storage/sqlite/src/migrate.ts` 的 `migrate()` 执行 `0→3` 元数据标记，再进入 Host 策略准入。该既有步骤改变版本标记与数据库字节，不属于本 Host 拒绝的字节原样保证；业务行和策略不会由本改动转换。本改动不新增迁移、转换或删库，不扩大 legacy/untagged 兼容义务。

## Context and Orientation

本轮基线 `apps/harness-plugin/src/host-composition.ts` 的 `assemble()` 创建规划 lifetime 后读取 workspace，再恢复 Provider、发现映射、composeCore、启动 reconciler。`configure()` 已提交设置后才装配 candidate；普通装配失败被转换为 activationError，finally 重启旧调度器。准入和专用停止行为 Superseded by Design / Spec 与 Progress（2026-11-04），普通失败回退保留。

观察于 2026-11-04、基线 `f0883948f78a9bf0a28290e21c7b1c3842b54cf5`：边界审计使用生产 PROVIDER_CATALOG、录制 GitHub、SQLite 和手动 tick，合法 `host_authoritative` / `manual_only` 均被接纳，本地 done 随自动刷新变成 Provider todo，replay misses 为空；Provider 策略正控拒绝本地写而可刷新。复现原理见 #273 与独立审计 PR #536 的 P273 证据（该 PR 尚未合入；本闭环以本计划的具名红测重现，不依赖未合入文档路径）。

#273 要求人类先决定 policy×incoming（mapped / unmapped unknown / mapping removal）再修通用同步语义；当前人类矩阵未完成。本项只收窄 Core Host 支持集，不改变通用 Core 三策略语义。#413 允许实际 absence/refusal；用户允许 3–4 个紧急闭环，足以提出可审阅准入修复，不能写成这个具体 guard 已获逐字人类批准。

`host.ts` 仅在 createHostComposition 成功后安装 remote；`tests/integration/fixtures/host-seed.js` 提供 seedWorkspace、seedPlanning、replayFetch、dump。dump 仅覆盖表行，不能单独充当 schema 完整性证据。`packages/core/src/planning-reconcile.ts` 和既有 Host recomposition tests 是 stop/退役合同的读取入口。

## Design / Spec

比较：只停定时器遗漏首次 bootstrap 与显式刷新；散落 planning 分支制造第二策略 owner；修 Core 需要 #273 人类矩阵；强制改 policy / 迁移 / 删库违反原件保留。选择 A+：一个 Host 装配准入点，加已知拒绝的专用停止分支。

将目标 workspace 读取移到 `assemble()` 首部，在 createPlanningLifetime、restoreProviders、mapping discovery、composeCore 和 timer 创建之前检查。workspace 缺席允许设置入口；存在时仅 `StatusPolicy.ProviderAuthoritative` 通过。只读 `options.workspaceId`，不扫描其它 workspace，不另开 Storage，不重复引入策略判断。

同文件定义小型 `HostPolicyAdmissionError`，固定 name/code/reason：`HostPolicyAdmissionError` / `not_supported` / `unsupported_workspace_policy`。固定中文说明：“当前 Core Host 不支持此已存规划策略；原数据库保留，请停止使用并等待支持该策略的版本。”不拼入路径、名称、账号、策略原文、秘密或 Provider 错误；不复用带 backup/rebuild 建议的数据库兼容错误。

首次启动拒绝沿现有外层 catch→dispose，关闭已打开 Storage；guard 之前不创建 lifetime，因此没有半成品 Provider 或 scheduler。Storage 原有 schema / generation 准入错误仍先发生，不伪装成 policy 错误；完整合法未标记库的既有 `0→3` 元数据标记也先于 Host guard，保持原合同。

每次 configure candidate 均通过同一 assemble。只在 candidate catch 捕获该专用错误时同步调用现有 `stop()`，使 closed、watch abort、旧 lifetime/调度器退役，finally 不再重启；普通网络、Core 注册、timer 分配失败仍保留旧 assembly 并允许重试。**不得在 configure pending 内 await dispose**，其 pending 集含当前任务，会自等待；最终 Storage 关闭由现有 owner dispose 完成。

该分支保留已确认的本地配置结果及既有 unavailable activationError envelope，固定安全说明表达“本地配置已提交，当前 Host 已停止”。专用 not_supported 错误仅用于内部识别与启动拒绝；不改 domain 恢复映射、client 严格解析或 wire DTO。客户端既有重试若再次调用已停止Host，仍须被closed门拒绝，不得重启旧图。

没有受支持的 Host setPolicy 操作。重装配负控会在测试库外部改策略后触发真实设置入口，只证明“已检测到不支持值后停止”；不承诺检测无人触发装配的任意外部 SQL 写、不提供跨进程锁/轮询或在途任意篡库原子保证。

## Global Constraints

评审收尾写集扩展：`docs/review/pr-541-mmp-review.md`与本计划的最终评审/授权记录；不改变原能力范围。

唯一写集：`apps/harness-plugin/src/host-composition.ts`；新增 `tests/integration/harness-plugin-policy-admission.test.js`；`tests/integration/harness-plugin-host-providers.test.js` 的 AC2/AC4 单一种子与注释；`docs/product/core-release-scope.md` 顶部“首发边界”支持集短段；本计划。scope 第49行附近审计 backlink 由 audit owner 写，区域互不覆盖；`docs/README.md` 由协调者串行更新。

不改 Core、Storage/schema/migrations、Host 公共 API、依赖、CI 或其它 PR carrier；不写原用户库、不删数据、不转策略、不加实验兼容。工程状态不替代 Planning，LLM 不进入策略/关系/门禁权威路径。

代码/测试/config A+D 目标≤450、文档目标≤750；硬限800/1300，含 fixtures、删除和计划/评审。判别测试不能为预算删除。预估生产20–45、测试200–300；超目标先缩复杂度，超硬限保留证据并交协调者拆闭环。

独立 leaf 为 #540；PR 只 Closes #540（以 closingIssuesReferences 回读），Refs #273/#459/#413；父 #273 保持 open。不改 Project Status/原生依赖，不自行 merge 或声称 Ready、安装接受、R1。

## Plan of Work

### Batch 1 · 合法不支持库的判别红测

最小闭环：用受信、非空、打开前已标记当前 generation3 的库证明现在缺门。主文件为新增 integration test；使用生产 catalog 和录制 transport，计数器记录而不抛替代性错误，不能因缺 token、导入或超时算红。

对 host/manual 各建打开前已标记 generation3 的独立临时库，预存 workspace、非空 projection/本地 done、绑定、账号句柄、配置和映射；Provider 录制值持续不同。补合法 context/run/intent 时复用当前存储契约，不造兼容行。捕获启动前数据库 SHA256、schema SQL、PRAGMA user_version、全部表稳定排序行及目录配置文件摘要。

在检出 `fix/host-policy-admission` 的工作树根运行：

    pnpm test:file tests/integration/harness-plugin-policy-admission.test.js

期望两个策略因“未以专用错误拒绝 / 已构建 Provider”业务断言失败；不接受无测试或全 skip。记录失败名和实际调用，不把旧覆盖探针的失败称新测试红。回滚仅撤回新测试，原库永不参与。

### Batch 2 · 最早准入与支持集正控

最小闭环：生产 guard 使上述红测变绿，支持能力不退化。主文件为 host-composition 与新增 test；将 workspace 读取前移，新增专用错误，保持外层 cleanup。

断言两种策略各重复拒绝两次，name/code/reason/message 固定且不含 canary；Provider factory、fetch、resolveCredential、sessionController、timer 创建均为0，remote 尚未注册。mock Storage.close 核对失败句柄关闭，再以独立连接可读/BEGIN IMMEDIATE/ROLLBACK；对上述已标记当前 generation3、通过既有 Storage 准入的样本，原DB字节、schema、user_version、所有行、配置和句柄逐项不变。完整合法未标记库的既有元数据标记先发生，不以这些样本的字节断言覆盖它。

加入四类正控：空库进入设置并实际 createWorkspace 默认 Provider 策略；provider 库录制 baseline 非空、显式 refresh 和真实 scheduler tick 可用且仅一个 timer；目标 provider 而旁 workspace 为 host/manual 仍可用；目标缺席但旁 workspace 非默认仍能设置。重开 provider 库身份不变，dispose 后 timer 为0。

重跑 Batch 1 命令，期望全部绿、零 skip、replay misses 空；guard 必须在任何 factory 前，不以抛凭据错误侥幸满足拒绝。回滚为独立撤回本批 patch，保留失败证据。

### Batch 3 · 重装配拒绝的停止与对抗闭环

最小闭环：已发现不受支持策略后，旧生产图不再运行。主文件为同一 Host 模块、新 test 和支持集短段；加入专用 stop，保持普通 activation failure 恢复。

先启动合法 provider Host、保存旧 callback/watch；在测试专用库用 Storage 将目标改为 host/manual，再调用真实 `installExecutionBindings` 引发 fingerprint 变化及 candidate。检查配置 local_only 可已提交、activationError 安全且符合既有client错误合同；candidate factory/network/credential/session/timer 增量0，旧 timer 清除、旧 callback 不再刷新、watch 结束、后续 wire 明确 closed，最后 owner dispose 可完成且无自等待。

此例不声称“已提交配置未变”；只核对策略、既有业务记录/句柄未被改写及设置命令的预期差异。普通 candidate failure 的旧 scheduler 重新启动与同键重试合同由既有测试证明，不能为了本例把所有激活失败全停。

在隔离副本用仓库 `node scripts/review-mutate.mjs <spec.json>`：删除 guard、将 guard 后移至 restoreProviders 后、删除专用 stop；分别绑定 killedBy 到拒绝、零 factory、旧 Host 停止的具名断言，复原后全绿。spec/日志仅留忽略运行目录，不提交框架。

顺序运行下列窄集及完整风险验证，期望无 fail/skip；更新计划和源/包身份后交 fresh independent review：

    pnpm test:file tests/integration/harness-plugin-policy-admission.test.js
    pnpm test:file tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/storage-baseline-admission.test.js tests/e2e/status-policy.test.js
    pnpm run typecheck
    pnpm run boundaries
    pnpm verify
    pnpm test:browser
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

回滚单位为整个 PR 的独立 revert；旧覆盖入口会再开放，必须恢复为已知 blocker，不把回滚当安全发版。最终 push 前整理 commits、复扫规模/发布面，push 后回读 exact head/base/checks/issue/threads，之后才由协调者处理 Ready。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 两合法不支持策略最早拒绝 | 固定专用错误；factory/network/credential/session/timer/remote 注册均0 |
| 启动拒绝保留原件（打开前已标记当前 generation3 且通过既有 Storage 准入） | 字节hash、完整schema/user_version/全部表行、配置文件摘要/secret-handle不变；二次拒绝相同；不覆盖完整未标记库先行的0→3标记 |
| 正常与旁 workspace | 四类正控，非空录制 baseline / refresh / tick / 重开身份，misses 空 |
| 每代已检测拒绝后停止 | 真实 configure→candidate；旧 callback无效、watch结束、后续closed、dispose完成 |
| 普通失败继续原恢复 | 既有 failure / timer allocation / same-key retry tests通过；不全局stop |
| 判别性与清理 | 三生产mutant具名KILLED、复原绿；失败句柄close，timer0；只清理本例临时根 |
| 权威与交付边界 | 通用三策略测试保留；无LLM权威、无273矩阵裁决、无父项关闭/人类UAT/R1宣称 |

## Progress

- [x] (2026-11-04 15:23 SGT) 独立综审两案、当前Host入口和旧失败恢复测试，读取live273/413及失败探针/原始输出，选择有界A+。
- [x] (2026-11-04 15:23 SGT) 完成13章设计计划与ownership；尚未写产品代码或执行新TDD。
- [x] (2026-11-04 16:03 +08) 协调者绑定#540/Draft #541；Batch 1有效红测证明两合法策略原Host实际构造Provider、读取录制来源并注册remote，而未拒绝。
- [x] (2026-11-04 16:03 +08) Batch 2最早guard绿；两策略各重复拒绝两次，已标记 generation3 样本的原库字节/schema/generation/全表行/配置/句柄保持；四类支持集正控及lifetime前置顺序通过。
- [x] (2026-11-04 16:03 +08) Batch 3重装配两条判别红测从旧timer仍活跃变为绿；专用stop、watch结束、旧callback失效、closed门与有界dispose通过；普通同名外部错误仍回退且同键恢复。
- [x] (2026-11-04 16:03 +08) 新10项+原Host14项通过；相关206项、typecheck、boundaries9项、pnpm verify（3592+8）均无fail/skip，隔离三mutant具名KILLED且复原绿。
- [x] (2026-11-04 16:07 +08) 全browser一次42项通过，无fail/skip；源/测试未再改动，准备最终公开面与本地能力提交。
- [x] (2026-11-04 16:35 +08) fixround1精确限定generation3字节承诺，文档链接/13章/diff核验通过；生产/测试未改，定向独立复评仍待安排。
- [x] (2026-11-04 16:52 SGT) fresh independent review、exact-head hosted检查与Ready；安装/UAT/R1保持对应人类门。

## Surprises & Discoveries

两案都识别默认 createWorkspace 固定Provider策略不等于持久库仅有该策略；实际覆盖探针提供了当前可达反例。A案的“restoreProviders之前”仍在lifetime之后，综审将其前移，确保拒绝没有半个assembly。

B案发现configure会吞candidate错误并restart旧scheduler；选择仅专用错误stop，复用现有closed/retire而不另建协议。通用not_supported默认recovery为manual_execution，且client严格核对code/recovery对应；因此不另改wire合同，专用错误只在Host内部/启动传播，已提交设置保留既有unavailable envelope。

既有 Host providers 的 AC2/AC4 将 `host_authoritative` 当作正常启动的身份/凭据/重启种子；早期 guard 生效后该文件14项只有这一项明确以专用准入错误拒绝。该旧支持集假设与新 Host 边界冲突，不是 Core 三策略语义回归。协调者授权只将该种子改为受支持的 Provider 策略并更新注释，保留全部既有身份、凭据、修订、实体和重启断言；非默认策略不被强制改写由新增两种拒绝的完整原件断言承担。

fresh 独立评审的 P2 F1 指出原“合法库原样”文案可能覆盖完整合法但未标记库。协调者的真实探针与 `migrate()` 源码一致：Storage 先完成既有准入与 `user_version=0→3` 标记，再到 Host 策略拒绝，所以物理字节和版本标记会先变化。该广义解释 Superseded by Purpose / Big Picture 的 Storage 准入边界（2026-11-04）；本轮 fixround1 只修承诺范围，生产/测试与 `5910c895` 保持逐 blob 相同，等待定向独立复评。

## Decision Log

Decision：选择A+，guard在assemble首部且只对专用拒绝stop。Rationale：单一准入点覆盖启动/每代候选，并关闭已发现的旧图恢复漏洞；不推演任意外部改库协议。Date/Author：2026-11-04 15:23 SGT / 独立设计综审。

Decision：只作为Core Host支持集收窄，不处理#273矩阵。Rationale：Core-first允许refusal，当前授权不是该具体guard逐字批准或通用策略裁决。Date/Author：2026-11-04 15:23 SGT / 独立设计综审。

Decision：扩入单一直接消费者测试的种子/注释，不改其断言或 Core 三策略用例。Rationale：正常重启证据应针对当前 Host 支持集，合法非默认库的原件保留在新拒绝矩阵单独判定；实际14项中的1项失败提供精确变更依据。Date/Author：2026-11-04 / 协调者授权，实现者记录。

Decision：字节原样保证只覆盖打开前已标记当前 generation3、且通过既有 Storage schema/generation 准入的库；保持完整合法未标记库先行0→3元数据标记的原合同。Rationale：Host guard 在 Storage 打开之后，不能将既有 Storage 写入包装为字节不变；本轮不扩展 legacy/untagged 兼容义务，不改固定安全错误或 wire。Date/Author：2026-11-04 / P2 F1 定向修订，协调者核实、实现者记录。

## Idempotence and Recovery

原“拒绝启动可重复且原库原样”的无条件字节解释 Superseded by Purpose / Big Picture 的 Storage 准入边界（2026-11-04）。对打开前已标记当前 generation3 且通过既有 Storage 准入的库，重复 Host 策略拒绝保持数据库字节原样；完整合法未标记库仍先执行既有0→3标记。不要由操作者改policy、user_version、mapping或凭据来“修复”拒绝。用户保留原profile，等待支持原策略的版本；另建profile必须走操作者显式流程，不在本PR自动执行。

configure已提交设置保持确认事实，Host停止后依正常owner顺序撤remote、排空pending、关闭Storage；不await自身dispose。测试失败也释放barrier/临时资源。若发现超出准入的实际Core缺陷，保留#273 blocker并在`docs/exec-plan/tech-debt-tracker.md`按现行流程登记，不静默扩大本PR。

## Interfaces and Dependencies

使用现有Node/pnpm/Git/SQLite、production catalog、录制replay、planningTimers和Host remote；不新增依赖、不需真实网络/凭据/模型配额。测试mock仅观测边界，不能替代生产Storage准入或Core状态。

## Outcomes & Retrospective

初版“目前仅完成设计综审；没有新红/绿测、mutation或hosted结果”的状态已过期。Superseded by Progress 中本地TDD、隔离变异与完整验证记录（2026-11-04）。

当前实现只在目标工作区最早准入，并在已检测专用拒绝后停止旧Host；本地已验证打开前已标记当前 generation3、通过既有 Storage 准入的合法不支持库原件保持、所有外部构造为零、支持集正控与普通激活失败恢复。新10项/Host消费者14项与相关206项均通过；完整verify包含3592项主层与8项MVP0，全部无fail/skip，boundaries9项通过。三类生产变异仅在隔离副本施加，具名KILLED，基线/复原绿且owner源字节不变。

全browser一次42项也已通过，无fail/skip；接续最终公开面和本地提交后交fresh review（Superseded by 本节工程验收收敛，2026-11-04 16:52 SGT）。未执行本候选实际安装、托管CI、人类UAT或R1（Superseded by 本节工程验收收敛，2026-11-04 16:52 SGT）。遗留#273人类矩阵、完整Core语义及#459/R1实际接受继续由原owner承担，不借leaf关闭推导parent完成。

fixround1：只将原样承诺精确限定，保留 Storage 先行准入和完整未标记库的既有0→3行为；不增加迁移/转换/删库或兼容义务。生产与测试 blob 均保持 `5910c895`，本轮只做文档链接、13章、发布面和diff检查；未重复全套执行。独立定向复评仍待协调者安排，未标记 review clean（Superseded by 本节工程验收收敛，2026-11-04 16:52 SGT）。

### 工程验收收敛（2026-11-04 16:52 SGT）

在本分支工作树根，以已独立验收的capability 95b3c5a1118e4c3cc400e044865e36ffbeaff89d 回读PR #541：必需PR Fast Gate与实际Verify、Browser、Merge Gate执行lane通过，issue关联及全部review threads已核对，远端已为Ready。独立验收239项、类型检查和额外文本分类变异通过；F1世代字节范围文案已限定并复评，当前世代generation3原件证据与既有未标记库先行准入分开。父#273完整策略矩阵、实际安装与人类R1继续独立。组合源码在test/iteration9-evidence-integration检出验证14项定向与46项浏览器均通过；组合仅覆盖runtime/tests，不作为官方文档已合并的证据。

归档只改文档；相对该capability的所有非docs文件不变。最终文档head按 gh pr view 541 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences 及 gh pr checks 541 -R SingularityKChen/harness-projects --required 回读，期望Ready且所需检查通过，不沿用历史head绿灯。没有新引入维护债；原产品和人工门仍由其issue拥有。

## Bottom Change Note

2026-11-04 15:23 SGT：综合独立A/B和真实configure恢复路径建立初版；选最早guard+专用stop，分开启动原件不变与设置已提交证据；二次设计检查确认client严格错误合同，保留原activationError envelope，不扩大公共接口。

2026-11-04 SGT：协调者绑定工程子项、补充未合入审计的PR引用；不改变综审后的设计。

2026-11-04 SGT：记录 AC2/AC4 的真实旧合同冲突与协调者授权，只扩单一种子/注释写集；保留全部原断言及 Core 三策略证据，计入 A+D 预算。

2026-11-04 16:03 +08：更新两个有效TDD阶段、四类正控、专用停止与普通错误分界、隔离三mutation和当前完整验证；不提升为托管CI、安装或人类接受。

2026-11-04 16:07 +08：补齐全browser42项通过的本地证据；不再扩大测试，转公开面、规模、本地能力提交和独立验收交接。

2026-11-04 16:33 +08：fixround1按P2 F1修订Purpose/Batch2/验收/Recovery等字节原样边界，原广义解读就地标Superseded；保持生产/测试、Storage原合同及公共错误不变，交定向独立复评。

2026-11-04 16:52 SGT：独立验收、capability托管门禁与Ready后归档；最终文档head继续回读，不改变产品代码或人类判定。

2026-11-04：本会话用户明确对PR #534/#535/#536/#541给出无P0/P1且独立复评通过后的rebase merge条件授权；本PR完整矩阵无新增P0–P3，初始APPROVE已由评审账号提交。原三个过程提交将整理为一个能力提交，备份ref与精确lease保留恢复路径。评审记录随本PR交付；最终head的checks/threads/issue关联仍须重新回读，不沿用初始head批准。
