# 当前 Core 候选边界证据 ExecPlan

> 状态：Completed；创建：2026-11-04；执行分支：`docs/core-release-evidence`。
> 范围：工程子 issue #533 的当前候选边界/风险/R1证据审计；Refs 父 #459、#73、#413。
> 依照根 `PLANS.md` 维护；PR只`Closes #533`，`Refs #459`、`Refs #73`、`Refs #413`，保留父#459的人类发布判断。

## Purpose / Big Picture

评审者能从一份当前候选矩阵判断实际暴露了哪些操作、哪些持久配置可达、每项已知风险怎样触发，以及十二条R1和十项不变量仍缺什么证据。可复现的拒绝、未修缺陷和未知都保留原样；没有证据的安全性不能通过“Post-Core”或隐藏导航变成已接受。

成功是准确、可证伪、绑定明确source/head的审计工程输入，不是自动发布决策。即使审计PR可Ready，发现的P0/P1与缺少的人类/UAT/真实平台证据仍使整个候选不可据此放行。

## Context and Orientation

事实：#500/#502已经对齐`docs/product/core-release-scope.md`的Core范围、R1责任与不变量。该文档明确静态operation清单不等于runtime/policy/database可达性审计，本项不重写同义scope说明。

事实：2026-11-04在`main@f0883948f78a9bf0a28290e21c7b1c3842b54cf5`实读`OPERATIONS`得到23项（22 unary与watch），旧清单21项不可作为当前全集。每次候选变化必须重新枚举，不固定此数。

入口：`apps/harness-plugin/src/host-operations.ts`拥有声明和参数解析；`remote.ts`拥有真实peer入口；`host-composition.ts`拥有handler/准入/持久装配；`host-providers.ts`拥有catalog和root策略；`packages/storage/sqlite/src/migrate.ts`拥有generation/schema准入。产品UI只是消费者。

事实：新workspace固定ProviderAuthoritative，但已有workspace将持久`statusPolicy`交给composeCore，schema允许其它策略。假设：现有窄suite覆盖多数反例，不必新造审计框架。未知：九项findings哪些仍可达；本计划要求逐项证据后定性，不在设计时预判安全或release P1。

## Design / Spec

比较三案：再写scope文档重复已合入工作，拒绝；自动release判定器接管人类风险决策并扩大CI，拒绝；选择单一候选证据矩阵，复跑既有生产入口测试，只有缺乏判别证据时补少量integration用例，不夹带产品修复。

每条矩阵含：观察时间/候选head、公开wire或直接Host层级、生产入口与状态owner、可达配置、具体正控/反例、命令与结果、证据层级、owner及未决下一门。静态源码定位只能证明入口/调用关系，不能独自证明runtime拒绝。

操作表按当次OPERATIONS全集逐项追踪parser→Host handler→Controller/Core→Provider/storage，标出UI调用者、peer授权、作用域、ack/reconcile和写入边界；watch按stream单独核对。不得将`cancel`或`setSourcePolicy`名字缺席直接等同全部内部路径不可达。

准入矩阵分别检查新建默认/三种持久statusPolicy、合法与disabled binding、production catalog/unknown implementation、repository/worktree允许根、空库/current库/旧generation/结构错库。记录真实拒绝位置或真实可达行为；不强制改写policy、删库或迁移以获得通过。

九项#191/#202/#215/#273/#309/#313/#336/#340/#341逐项读取当前issue和实现，用最小可运行反例分类为已修且有当前证据、公开边界实测拒绝、当前可达需保留remediation、仍unknown。另列#313的source-workspace与compiled Host适用面，不能把未实测工具链矛盾升级成已证实安装故障。#215/#336核对近期修复后再结论。

R1十二行与不变量十行引用现有规范而补本候选证据、owner、缺口；#450/#451、#369、#449及#143/#124/#72分别按工程/安装/真实平台/人类证据记录。未合并PR不装作当前RC；staffing/review/UAT availability无本人确认即未确认，日期建议不等于承诺。

## Global Constraints

评审收尾写集扩展为本PR评审记录、四PR综审记录及索引、评审交付计划，和审计首页链接/后续#541准入增量。原f0883948历史探针不变，新source与原快照分开，不改变产品范围。

唯一写集：`docs/product/core-release-audit.md`；`docs/product/core-release-scope.md`的短回链/当前审计状态；必要时新增`tests/integration/core-release-boundary.test.js`；本计划。不得编辑`release-gates.md`、backup文档、browser carrier、产品代码、schema、CI、依赖；`docs/README.md`由协调者串行更新。

默认代码/test/config A+D=0；仅现有证据不能判别时，新integration测试预计≤180，用户硬限800。文档含计划/评审目标650–1100、硬限1300。新增test是有界证据，不扩大成修复/执行框架；超预算保留必要证据并细化工程子issue，PR保持Draft。

不引入兼容/迁移或自动风险豁免，不改Project Status/blocked-by。CodeBudget0父项不豁免人类判断或允许隐含修复。发现P0/P1记录准确复现和独立remediation；不得通过scope措辞接受缺陷。零模型/真实GitHub写入；公开面不含凭据、本机绝对路径或内部资料。

## Plan of Work

### Batch 1 · 锁定候选与缺口账本

最小闭环：当前操作、配置、九findings和门禁矩阵都有可追踪行，缺证据显式unknown。主文件为audit与本计划。协调者读取当前main/head与issues/comments/PR状态；本owner读取源码并生成表，保留已有#500/#502规范链接，不复制规范全文。

在检出`docs/core-release-evidence`的工作树根运行：

    node --input-type=module -e "import { OPERATIONS } from './apps/harness-plugin/src/host-operations.ts'; console.log(JSON.stringify(Object.values(OPERATIONS).map(({name,mode})=>({name,mode})), null, 2))"
    gh issue view 459 -R SingularityKChen/harness-projects --json number,state,body,comments
    gh issue view 369 -R SingularityKChen/harness-projects --json number,state,body,comments
    gh issue view 451 -R SingularityKChen/harness-projects --json number,state,body,comments

期望枚举非空且矩阵逐项对齐；九findings也用相同`gh issue view`参数逐一回读，不能只依赖旧snapshot。遇见指令/日期冲突记录原文与当前依据，不能自动覆盖人类决定。回滚为撤回本批文档，不改变产品事实。

### Batch 2 · 最窄生产边界反证

最小闭环：有非空正控并能观察当前真实拒绝或缺陷。主文件为audit，只有必要才增boundary integration test。先审读下面现有suite断言；实际Host composition和生产remote/gateway运行，明确wire与直接Host不同证据层级。

在同一分支根运行：

    pnpm test:file tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/storage-baseline-admission.test.js
    pnpm test:file tests/integration/harness-plugin-runtime-access.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/local-git-start-work-resume.test.js

期望全部非空通过，保留测试名、断言与层级。不能找到反例的行保持unknown；suite通过不等于同名finding全部修复。对未知operation必须实际调用wire/gateway或production dispatch拒绝；对current/schema/policy必须有匹配正控和真实输入。

若现有suite无法验证持久policy/disabled挂载等关键行，先写具名红测，使用生产SQLite/Host的最小composition，再运行：

    pnpm test:file tests/integration/core-release-boundary.test.js

期望合法输入能进入被审计路径，unknown/deferred/unsupported输入按实际生产边界拒绝；若反而可达，用独立失败探针和issue形成retained blocker，不能新增长期测试把不安全行为固化为正确结果；不把fixture拒绝当产品拒绝。删除所声称防线的隔离mutant必须使对应断言失败，复原后通过。无需新增测试的纯报告行不写镜像test。回滚为撤回新增测试/文档，不修产品。

### Batch 3 · 当前证据、独立挑战与Ready

最小闭环：每行结论都能被另一审阅者复现或明确识别缺口。主文件为audit、scope短回链和本计划。独立验收者挑选“未声明即安全”“Post-Core即豁免”“测试绿即UAT”的反命题检查，核对九findings和全部门禁行不丢项。

在同一分支根运行：

    pnpm run boundaries
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望边界/发布面通过、链接存在、800/1300较严A+D预算满足。文档改动不机械跑全verify；新增integration只补其最窄相关回归；若意外需改门禁/配置/产品，先独立重定scope，不能藏在本PR。

最终提交前整理commits；最终push后回读exact head/base/checks/closingIssuesReferences/review threads，全部工程证据通过才Ready。PR仅Closes #533、Refs #459/#73/#413。准确报告保留blocker可完成本工程审计，但不得关闭父#459、宣布RC或R1通过。回滚为独立revert本PR，发现的真实缺陷仍保留其issue。

## Validation and Acceptance

| 名称 | 通过条件 | 不得替代的证据 |
|---|---|---|
| Exposed operations | 动态全集每项有parser/handler/owner/UI/授权/副作用行 | 静态名称数不证明runtime不可达 |
| Admission | workspace/policy/catalog/binding/root/database各有正控、拒绝或明确unknown | UI隐藏、schema合法不等于semantic policy拒绝 |
| Findings disposition | 九项逐条有当前source/可运行反例/结论/owner下一门 | Closed/Post-Core标签不自动接受安全缺陷 |
| R1 and invariants | 十二+十行对应当前候选、证据层级、owner、缺口 | 旧green、未合并PR、SSR、测试数不等于当前RC/UAT |
| Adversarial | 新增关键拒绝断言能杀死其隔离mutant | 仅断言字符串/源码正则不能证明防线 |
| Human boundaries | staffing/UAT/风险例外未确认保持unknown，发布判断留人类 | Ready或审计子项关闭不推进Status或R1 |

## Progress

- [x] (2026-11-04 14:42 SGT) 完整阅读两份独立设计、当前scope与生产入口，完成第三方综审。
- [x] (2026-11-04 14:42 SGT) 实读当前OPERATIONS为23项；尚未执行当前候选全审计。
- [x] (2026-11-04 14:42 SGT) 协调者已创建#533并原生关联父#459；尚未完成Draft和全审计。
- [x] (2026-11-04 15:08 SGT) Batch 1：#536 Draft/Closes #533回读，锁定产品基线f0883948，23入口及完整矩阵已落盘。
- [x] (2026-11-04 15:08 SGT) Batch 2：六组1022个相关测试通过；五个探针验证，四个预期失败与诊断正控分开记录。现有用例足够，未新增代码或测试。
- [x] (2026-11-04 15:08 SGT) Batch 3本地部分：audit与scope回链完成，boundaries 9/9，文档内公开探针逐一复跑；文档链接、暂存区disclosure零命中、diff检查和较严预算均通过。
- [x] (2026-11-04 16:02 SGT) Batch 3剩余：协调者安排fresh独立验收、最终push、exact-head CI与Ready；父级发布判断保持开放。

## Surprises & Discoveries

旧scope的21项清单已不是当前操作数；`getIssueClosingLinks`与`refreshIssueClosingLinks`已成为真实入口。因此矩阵从动态声明生成，旧文档在原处用当前审计链接解释观察快照。

新建workspace默认策略与持久workspace准入是两条路径；仅检查UI或createWorkspace默认值会漏掉持久policy。初稿尚未完成的九项调查现由audit逐项记录；P273生产catalog/录制GitHub/SQLite自动tick复现Host/manual策略done→todo，已报告协调者并由其独立复跑。P202/P309/P341也保留条件性失败，不预填“已修复”。

当前compiled bundle实际target是node22，Node24.18.1是Host类型上限；source workspace engines≥22/.nvmrc26属于另一合同。六组测试绿仍不能证明最低source runtime或当前安装RC。

## Decision Log

Decision：以候选证据矩阵补全已有scope工作，默认只复跑现有suite。Rationale：#500/#502已合入，审计价值在可达性和反证，不在再写范围口号。Date/Author：2026-11-04 14:42 SGT / 独立设计综审。

Decision：PR只Closes #533、Refs父#459/#73/#413；必要新测试限定证据职责，真实产品修复另建有界项。Rationale：保持独立验收/回滚和父项CodeBudget0边界，避免审计吸入未知实现。Date/Author：2026-11-04 14:42 SGT / 独立设计综审。

Decision：复用现有生产suite，不新增镜像测试或产品修复；公开附可复制反证，四个失败探针不算通过测试。Rationale：证据已足够，首要增量是准确审计和保留可达风险；Host准入修复另行有界评审。Date/Author：2026-11-04 15:08 SGT / release evidence owner。

## Idempotence and Recovery

源码/issue读取可重复；同候选结果记录精确head和时间，head变化后重算受影响行，旧观察原处标记Superseded。探针只用新的临时SQLite/Git副本与离线Provider，不更改用户库/策略/远端。

遇见P0/P1不覆盖旧结论，记录可复现输入并保留remediation；操作失败行保持unknown。撤回审计不会撤回真实缺陷。若新增test污染fixture，关闭所有句柄并仅清理realpath核对过的临时根；独立mutant不用共享工作树。

## Interfaces and Dependencies

依赖锁定Node/pnpm、Git、生产SQLite/Host/remote、既有离线Provider和只读GitHub issue/PR查询。所有gh命令带`-R SingularityKChen/harness-projects`；review侧由独立验收角色使用既有身份工具，公开写由协调者记录actor/目标/幂等键/ack。

#451/#369的未合并增量只作独立PR证据，不成为本审计候选一部分；形成真实集成候选后需重新锁定并复跑受影响行。人类UAT、实际平台、hosted RC两次通过等依原release-gates拥有者判断。

## Outcomes & Retrospective

本地审计已形成23操作、准入矩阵、九findings、十二R1和十不变量矩阵，复跑1022个相关测试及五个探针；没有产品/测试/config改动。P273是当前合法持久policy的可达P1候选，需独立有界修复与人类归级；其它发现按各自触发面保留原issue。没有声称当前候选安全或R1满足。

本项未新留维护债；已有问题继续由原issue拥有，不以普通债务隐藏安全缺口。fresh独立验收、远端最终head验证和Ready由协调者继续执行（Superseded by 本节工程验收收敛，2026-11-04 16:02 SGT），计划暂留active。

### 工程验收收敛（2026-11-04 16:02 SGT）

在本分支工作树根，以已独立验收的capability a761b410a383416dfa3d91b1454b80ba861bdac4 回读PR #536：必需PR Fast Gate与实际Verify、Browser、Merge Gate执行lane通过，issue关联及全部review threads已核对，远端已为Ready。独立验收复现全部五个公开探针及19个入口测试。审计绑定f0883948，P273产品风险仍保留；另案#541未合入，不能把其计划或测试充作本审计候选已修。R1、人类UAT与人员可用性未由本项接受。

归档只改文档；相对该capability的所有非docs文件不变。最终文档head按 gh pr view 536 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences 及 gh pr checks 536 -R SingularityKChen/harness-projects --required 回读，期望Ready且所需检查通过，不沿用历史head绿灯。没有新引入维护债；原产品和人工门仍由其issue拥有。

## Bottom Change Note

2026-11-04 14:42 SGT：依据两份独立设计及第三方综审建立初版；选择当前边界证据而非重复scope，动态23入口、九findings、十二R1/十不变量及明确人类门禁。

2026-11-04 15:08 SGT：完成本地工程审计与复现，补准确bundle/runtime区分、P273反例和独立验收交接；尚未push、Ready或人类门禁。

2026-11-04 16:02 SGT：独立验收、capability托管门禁与Ready后归档；最终文档head继续回读，不改变产品代码或人类判定。

2026-11-04：本会话独立MMP review只有一条归档链接P2，已修复并独立复评；后续#541已独立合入e6153dcb，审计保留原历史快照、原处Superseded并明确精确source复跑。四PR条件式rebase merge直接授权见评审交付计划，不包括R1或Project Status。
