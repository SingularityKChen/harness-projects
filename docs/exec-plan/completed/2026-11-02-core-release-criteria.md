# MMP-Core 仓库范围与发布准则对齐 ExecPlan

> 状态：Completed（本地文档实施已交接；Draft PR 的最终审阅与Ready由协调者负责）；创建：2026-11-02（Asia/Singapore）
> 范围：完成 #500 有界文档子项，Refs #459/#73/#413；不完成完整边界审计或人类发布裁决。
> 规范：`PLANS.md`。本计划同时承载最终 spec 与实施批次；每批更新活章节。

## Purpose / Big Picture

只读仓库的维护者能分清本次获批 Core 首发路径、仍保留的后续完整工作台范围、全部 R1 判定义务和未完成证据。仓库规范不再与2026-10-29人类批准的分期矛盾。PR使用 Closes #500、Refs #459、Refs #73、Refs #413，不关闭完整 audit 或任何人类验收父项。

## Context and Orientation

在分支 `docs/core-release-criteria` 的工作树根 `.worktrees/core-release-criteria` 执行。2026-11-02观察main base为 `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`；实施前 `git rev-parse HEAD`、`git status --short --branch`，协调者按当前main更新直接base。

`docs/product/README.md` 拥有产品范围导航但仍说范围分级待补；`docs/product/vertical-path.md` 拥有1–12用户动作及混合历史观察；`docs/architecture/release-gates.md` 是十二条R1和十项不变量的权威表述，R1为合取，无法判定等同不满足，LLM不得裁决。#413于2026-10-29明确批准Core先发：GitHub Project→类型正确的WorkItem/detail→Start Work→真实会话或诚实人工备用→安全PR创建→PR/CI谱系，加基础设置/访问/恢复和现代已安装Host UI；保留后续完整工作台。该批准不豁免任何安全条件。

#459要求完整Host/policy/database/UI边界、全部正确性finding与current-RC 12+10证据、真实staffing/UAT和人类go/no-go；本子项只交付仓库规范对齐及审计入口。#450/#451生产浏览器、#449安装UI、#143/#124/#72实际产品观察、#369备份回滚与artifact/bundle证据仍独立。本次不重跑历史数百行探针，不将历史partial/反例批量升级。

## Design / Spec

选择新 `docs/product/core-release-scope.md` 作为唯一Core/后续范围owner，现有vertical-path与release-gates作窄修改。放弃把全部范围塞进已有两篇长历史材料：范围回答发什么，纵向路径回答走什么，门禁回答能否发，保持各自职责。

范围页自包含写明人类批准、Core用户路径和后续Planning写入/editor、Board/Kanban、Backlog/Sprint、Roadmap/Milestone、LocalPlanning、完整关系/诊断/设置/部署、预设/产物契约；后续不是取消，也不是known-safety豁免。候选必须注明源码/产物/profile身份，不能由TargetRelease标签或epic关闭数决定范围。

以当前 `apps/harness-plugin/src/host-operations.ts` 的 `OPERATIONS` 列出静态声明表：baseline、bootstrapWorkspace、refreshPlanning、getExecutionContext、refreshExecutionRun、getStartWorkOptions、startWork、createChangeRequest、getChangeRequestOperation、resumeChangeRequest、createWorkspace、connectAccount、bindPlanningSource、bindRepository、installExecutionBindings、getWorkspaceSetup、getPlanningMapping、setPlanningMapping、getDeliveryProjection、refreshDeliveryFacts、watch。每行写Host入口、用户功能与owning source；这是声明盘点，不声称已逐个运行/证明全部workspace/policy准入。数量只作为本观察，提供重算命令；新增操作必须重新审计。不得仅以隐藏导航证明后续能力不存在，也不得把内部Core API未列于Host等同所有边界不可达。

对后续候选操作和持久策略/旧库，区分“该Host声明中不存在”“真实边界已拒绝的证据”“尚未审计”。没有运行证据一律写缺口归#459，不伪造拒绝。`migrate.ts`/Host storage admission依据要引用owner，不能授权数据删除、政策强制转换或迁移兼容。

保留十二R1和十不变量原文/判定者。范围页建立十二条R1→证据类别/owner/未解gap表和十不变量→owning source/测试入口/核对义务表，状态统一为历史观察、候选在途、待当前RC核对或人类未执行，禁止仅凭测试存在写满足。#191/#202/#215/#273/#309/#313/#336/#340/#341逐项保留#459当前边界分类责任：可复现不可达/拒绝证据、阻塞修复或既有§3精确人类例外（原因/残余风险/失效日期）；Post-Core或known issues本身不接受风险。

vertical-path增加当前Core映射与历史快照适用说明，保留1–12和失败面定义及旧证据原文，矛盾原处标Superseded指向新范围，不只在末尾追加订正。release-gates补Core分期适用/证据入口，不删除条件6的P0/P1零未决义务，不降低人工UAT、备份演练或离线/撤权要求。日期只写2026-11-06建议RC、11-07/08 UAT/修复/回滚/go-no-go、11-08目标SGT，缺gate即at risk/no-go；staffing可用性仍是未取得的人类事实。

## Global Constraints

所有产品身份、权限、原子性、owner 围栏、持久意图、Provider 确认、unknown/conflict 和恢复语义保持。没有正式发布，不增加实验 API/旧数据库兼容层、双写或静默迁移；旧库拒绝与备份保留。Host 是业务权威，规划状态与工程事实正交。agent 不合并 PR、不改 Project Status 或 native blocked-by/blocking，不调用真实模型或执行真实 GitHub 业务写入。

每个 PR 对其**直接 base**计算增删总和：代码、测试、配置、fixture 严格少于 800 行，文档严格少于 1300 行；锁文件按仓库政策排除但仍审查。仓库 size 脚本的 1000/1500 上限不足以证明本轮要求。新发现的产品缺陷单列证据交所属 owner，不能通过减弱测试、权限或事实边界满足行数。发布面不得含凭据、本机绝对路径、访问型会话 URL 或内部系统资料。

唯一写集：`docs/product/core-release-scope.md`、`docs/product/README.md`、`docs/product/vertical-path.md`、`docs/architecture/release-gates.md`、本计划和必要独立评审记录；共享 `docs/README.md`索引由协调者串行处理。`demo.md`与`demo-install.md`由指南PR独占，本PR只相对链接，不复制操作步骤。0代码，目标文档500–850行含计划/评审，严格少于1300。

## Plan of Work

### Batch 1 · Draft与规范差异核对

先提交本计划并由协调者创建 Draft PR，回读 head/base/draft/文件范围与 issue 关联，再开始实施。公开写入只由协调者执行；使用 Closes #500、Refs #459，回读 closingIssuesReferences 必须包含子项且不包含父项。已创建子项的事实与 ack 见 Decision Log；不提前关闭父项。

最终提交前收敛本地 commits，检查消息、diff、发布面和严格规模；已推历史如需整理，先建 backup ref，再由协调者按 git-expert-operations 使用精确 lease。最终 push 后回读当前 head/base/checks、closingIssuesReferences 和全部 review threads；只有当前 head 的独立验收与真实 hosted checks 通过才 Ready。Ready 是请求人类评审，不是合并、规划完成或发布。

本批主文件是范围页与产品索引。协调者已创建#500，其创建记录在Decision Log；先以只读 `gh issue view 500 -R SingularityKChen/harness-projects --json number,state,title,body`、`gh issue view 459 -R SingularityKChen/harness-projects --json number,state,title,body` 和 `gh issue view 413 -R SingularityKChen/harness-projects --json body,comments` 确认有界子项/父项与明确批准；期望未把提议当批准、父项OPEN。

从owning source静态回读：`rg -n "^  [A-Za-z].*: \{ mode:" apps/harness-plugin/src/host-operations.ts`。对照Host handlers、storage准入与Provider契约，仅写实际可证明边界；没有实测不可达就保留缺口，不为文档PR跑包行为全量回归。

### Batch 2 · 单一范围与门禁接口

本批主文件是scope、vertical-path、release-gates。先范围页，再现有规范的窄映射/链接与就地Superseded。逐行核对原12条R1、10不变量与判定者均保留；所有人类gate仍有人类owner。将21操作声明表与真正完整runtime/policy/DB audit分开，剩余gap和上述finding清单归#459。

独立读者只读仓库须能回答：当前Core包含什么、后续保留什么、CI全绿为何不能发布、旧库如何保留、缺失哪种人类证据。负控审读五种场景：后续功能仍Host可达、450全绿但143未走、一个R1项无证据、unknown显示Saved、全部child关闭但无人批准；文档在每种场景都不得推出release-ready。临时删一条R1或把未执行写满足，逐行差异审阅必须发现，不能用匹配字符串测试替代审读。

### Batch 3 · 文档验证与交付

主文件是所有本次改动Markdown。运行相对链接/锚点检查；新写只读命令逐条执行并记录检出/输出。检查新旧diff：`git diff 1dcf661c0db32495d583fbc0ebeedf62f68f2af6...HEAD -- docs/architecture/release-gates.md`，期望十二条件与十不变量无删除/弱化，观察不能升级成人类裁决。文档当前工作树变化可先用 `git diff -- docs/architecture/release-gates.md` 审读，再在提交后用三点式。

执行以下只读链接检查，期望无missing输出且退出0；链接到Markdown的fragment另按目标heading逐一确认，异常slug保留人工判定证据：

    python3 - <<'PYLINK'
    from pathlib import Path
    from urllib.parse import unquote, urlsplit
    import re
    paths = ['docs/product/core-release-scope.md', 'docs/product/README.md', 'docs/product/vertical-path.md', 'docs/architecture/release-gates.md']
    missing = []
    for name in paths:
        source = Path(name)
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', source.read_text()):
            target = target.strip().split(' \"')[0].strip('<>')
            value = urlsplit(target)
            if value.scheme or value.netloc or not value.path:
                continue
            path = source.parent / unquote(value.path)
            if not path.exists():
                missing.append((name, target))
    print('missing', missing)
    assert not missing
    PYLINK

以下机械命令的直接base为 `1dcf661c0db32495d583fbc0ebeedf62f68f2af6`，重基后更新对象：

    node scripts/rule-checks.mjs disclosure 1dcf661c0db32495d583fbc0ebeedf62f68f2af6
    node scripts/rule-checks.mjs size 1dcf661c0db32495d583fbc0ebeedf62f68f2af6
    git diff --check 1dcf661c0db32495d583fbc0ebeedf62f68f2af6...HEAD
    git diff --numstat 1dcf661c0db32495d583fbc0ebeedf62f68f2af6...HEAD

以上命令使用本观察的直接 base 对象；重基后同步改成新的具体 SHA，不用累计栈底。把 numstat 的新增与删除相加，Markdown 计文档，其余受策略计数文件计代码；必须实际记录两项数值并分别验证 <1300、<800，不能只引用较宽脚本通过。

本地文档闭环完成后归档本计划并报告共享 `docs/README.md` 索引目标；协调者负责串行维护索引、独立验收、提交/推送与 Draft PR 最终 head/base/checks/关联/threads 回读。实施者不提交、不推送、不Ready；回滚整组本PR文档即可恢复原规范，不改真实release/Project字段或数据库。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 仓库可自包含解释Core/后续 | scope页与规范映射，独立读者回答，不依赖未分发材料 |
| 声明与完整audit分开 | OPERATIONS静态清单有owner/重算方式，未运行边界明确未核对归459 |
| 十二R1/十不变量保留 | 原文/判定者逐行diff与责任矩阵，无unknown→通过、无Post-Core安全豁免 |
| 人类证据保留 | 449/143/124/72/369、currentRC/bundle、staffing/go-no-go缺口可定位 |
| 独立文档闭环 | negative情境审读、链接/锚点、发布面、严格规模、仅Closes500 |

## Progress

- [x] (2026-11-02 16:18 +08) 两份设计独立评审收敛；明确只交付规范对齐，不冒充完整#459。
- [x] (2026-11-02) Batch 1：回读 Draft PR #502、子 issue #500、父项 #459 与 #413 批准范围；计划独立第二遍评审为 PASS。
- [x] (2026-11-02) Batch 2：新增单一范围页、21项静态 Host 声明盘点、12条 R1 / 10项不变量责任矩阵，并窄对齐产品索引、vertical-path 与 release-gates。
- [x] (2026-11-02) Batch 3：链接检查、规范逐行保持、机械发布面/规模检查、手工五类目审读与负控语义自审完成；最终 PR 审阅、提交、推送和 Ready 由协调者接手。
- [x] (2026-11-02 16:18 +08) 已确认#459完整audit与人类发布条件为本子项非目标，归父项保留。

## Surprises & Discoveries

远端已批准Core分期，但仓库product索引仍声明范围分级缺失；release-gates历史矩阵包含不同时点partial/反例。仅补一段远端链接不能自包含，亦不能把这些历史结论批量改成当前满足。21项Host声明也不等于全部持久策略/准入已审计。

实现时发现若干原拟引用的测试文件名与当前仓库路径不同，已对照 `rg --files tests/integration` 修正为现存文件。机械 disclosure/size 命令读取提交相对 base 的内容，不包含未提交的新文档；本次另按当前工作树 numstat 加入未跟踪范围页人工计算严格规模，不能把脚本对已提交计划的数字误报为完整 PR 规模。

## Decision Log

- 2026-11-02：本会话用户直接对 PR #501–#504 条件授权：无P0/P1或仅P2/P3，由评审会话修复、独立复评、归档与整理提交，核对issue后rebase合并；当前项由评审会话负责收尾，不包含其它PR合并或Planning字段写入。

Decision：选两份设计C1职责分离，统一文件名core-release-scope.md；吸收A静态21入口清单，采用B的完整audit边界。Rationale：新范围可独立读，Host声明盘点有价值且不冒充运行证明。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision：Closes #500，Refs #459/#73/#413，所有12+10与人类gate保留。Rationale：规范对齐是可回滚子闭环，完整风险审计/人类发布不可由文档或LLM代判。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision / 外部写入记录：协调者报告并提供回读：actor `SingularityKChen`，目标 `SingularityKChen/harness-projects` 的子 issue #500，父项 #459；创建与subissue链接已ack并回读，Project item已建立；未改Status/native依赖。独立修订者未执行远端写入。创建请求幂等记录由协调者在最终交付审计中补入，不凭空构造。Date/Author：2026-11-02 +08 / 协调者执行、独立修订者记录。

## Idempotence and Recovery

只读取数与文档检查可重复，事实变化时原处标Superseded并更新change note。无迁移、数据删除、政策修改、真实Provider写或release；文档整体revert即可。若实际源码揭示安全反例，记录精确入口交父audit/独立修复，不在此夹代码或自动接受例外。新增有意延迟的维护风险记 `docs/exec-plan/tech-debt-tracker.md`，已有#459义务不重复包装新债。

## Interfaces and Dependencies

输入为#413明确人类批准、#459要求、当前main的Host声明/准入owner与仓库12+10标准；不依赖#472、browser或CI PR合入。只引用它们的证据责任，候选状态需当前RC回读。输出scope为范围唯一owner，vertical-path保留动作定义，release-gates保留能否发布的裁决权，Demo另PR唯一操作指南。

## Outcomes & Retrospective

完成了四份文档的本地差异：新增 `docs/product/core-release-scope.md` 95 行；修改 `docs/product/README.md`、`docs/product/vertical-path.md`、`docs/architecture/release-gates.md`。`OPERATIONS` 静态重算为 21 行；scope 页恰有 12 条 R1 和 10 项不变量矩阵。release-gates 权威 12 条与 10 项原表在本次 diff 中均无改动。

验证：相对 base 的 `git diff --check` 退出 0；Markdown 相对链接检查输出 `missing []`；新文档所列测试路径逐一存在；disclosure 机械规则通过（只覆盖已提交计划，人工检查扩展到当前工作树）；规则脚本报告已提交文档 140 行。实施者交接前的工作树观察为文档增删 254 行、代码 0 行，未包含协调者后续索引；协调者补索引后的检查点 `b10b1f9` 经 size 规则回读为文档 256 行、代码 0 行。两者均是各自观察时点，不是最终 PR 的永久数值；最终规模按本计划直接 base 的回读命令复算，并严格低于本轮 1300/800 上限。人工检查凭据、本机路径/身份、账号个人信息、内部系统、保密字样均未发现命中。未运行产品测试套件，也未做完整 Host/policy/database/security audit；没有 staffing、UAT、#369 演练或 go/no-go 证据。#459、#143、#449、#450/#451、#369、#73 与其它父项保持独立未完成状态。

本地文档实施已完成并交协调者处理索引与 Draft PR 的最终验收；此归档不表示 PR Ready、R1 满足或产品发布获准。


### 2026-11-02 · MMP 独立评审与收尾

2026-11-02实际观察：#501 已rebase合入；本层已重放到 `main@1dcf661c0db32495d583fbc0ebeedf62f68f2af6`，无冲突且本层仍为一个交付提交。新导航包含双方记录；原Core产品文档与初审blob相同。初始base快照由本小节接续；批次机械命令已更新为此直接base。

初审输入、P0–P3矩阵、反例、实际命令和issue验收见 `docs/review/pr-502-mmp-review.md`。独立评审未发现真实P0/P1/P2/P3，源码/文档核对与文档门通过；文档子项验收不接受任何未执行的安装、人类走查或R1。评审会话接管后续的证据归档和提交整理。旧实施交接中的Draft及待提交状态是历史快照，Superseded by 本小节（2026-11-02）。

最终push后，在本分支检出根运行 `gh pr view 502 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,baseRefOid,reviews,closingIssuesReferences`、`gh pr checks 502 -R SingularityKChen/harness-projects` 并回读全部review threads；只有实际当前head门禁与独立批准成立才执行已授权rebase merge，再回读子issue和父验收状态。恢复引用为 `refs/backup/pr502-before-mmp-review-20261102`，精确lease拒绝并发覆盖。

## Bottom Change Note

2026-11-02 16:18 +08：第三独立agent收敛A/B为一份范围owner加既有规范窄映射；限定静态声明盘点，保留完整459、12+10与人类发布边界。

2026-11-02：完成文档改动与局部验证；最终提交、推送、PR审阅/Ready及 `docs/README.md` 索引由协调者串行执行。

2026-11-02：独立对抗审读后补全规模观察的执行上下文，区分实施者交接与协调者索引检查点；未改变产品范围或发布判据。

2026-11-02：补充本轮MMP独立评审入口、用户条件授权和收尾回读/恢复门；历史实施快照由本轮收尾记录接续，不宣称未执行的人类验收。

2026-11-02：#501合入后，按实际main重放本层并更新可执行直接base命令；重新进行独立复评及当前head平台验证。
