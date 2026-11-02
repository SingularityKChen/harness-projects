# Demo 指南当前 PR 创建与恢复事实同步 ExecPlan

> 状态：Completed（指南修订、P2文字修复与本地验收；独立复评及PR commit/push/当前 hosted checks/Ready 由协调者完成）；创建：2026-11-02（Asia/Singapore）
> 范围：修正 #236 已有指南的事实漂移；不重复 #444，也不代替 #143 人类走查。
> 规范：`PLANS.md`。本计划同时承载最终 spec 与实施批次；每批更新活章节。

## Purpose / Big Picture

操作者按现有唯一 Demo 指南能找到当前已交付的 PR 创建入口，并在结果未知或重载后读回原操作，避免错误地绕开产品或盲目创建第二个请求。文档继续区分实现、机械证据和真实安装/人类走查。PR 使用 Closes #499，并使用 Refs #236、Refs #143、Refs #124、Refs #72，不关闭这些父项。

## Context and Orientation

在分支 `docs/demo-guide-readiness` 的工作树根 `.worktrees/demo-guide-readiness` 执行。2026-11-02 观察 base 为 main `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`；实施前运行 `git rev-parse HEAD`、`git status --short --branch`，由协调者按当前 main 更新直接base。

`docs/product/demo.md` 已由 #444/#445 交付完整12步、已知限制与空白记录；完成计划 `docs/exec-plan/completed/2026-10-29-demo-user-guide.md` 明确父项人类验收未完成。当前 `apps/harness-plugin/src/client.ts` 已装配 createChangeRequestCreator，`packages/ui/src/create-change-request-section.ts` 已有“创建变更请求”“目标分支”“标题”“正文”“创建 PR”“读回原操作”；指南原先仍说无专用PR入口。2026-11-02 live issue 回读确认 #204 closed by #467、#421 closed by #492、#437 closed by #491、#494 closed by #495；#235父项仍open，不能从父项open推断入口缺失，也不能从child closed推断人验完成。

`demo-install.md` 是唯一安装、credentials参考、显式执行启用和备份/旧库拒绝owner。`vertical-path.md` 的步骤定义、Core分期与 `release-gates.md` 由另一PR负责，本PR仅引用。#143允许在GitHub/Harness session创建PR作为Demo路径，原允许路径不被本次新UI说明取消。

## Design / Spec

选就地修订唯一指南，放弃新 Core quickstart/冻结旧指南双版本：当前没有用户需维护两份产品代际说明的证据，双文档会留下同artifact相反能力陈述。修改准备、第6/8/9步、已知限制与实施证据边界，保留12步和补充观察模板。

第9步以当前详情的创建入口说明：先有当前执行上下文，再填目标分支/标题/正文并显式创建。pending/unknown、读回失败、页面重载均先“读回原操作”；已保存原请求不得重输盲发新请求。“PR 已确认，谱系暂未刷新”只说明PR确认，不是CI通过。目标已变/作用域不可用按生产文案说明重新读取或连接设置，不能声称可绕过围栏。保留原生GitHub/session替代路径及其不同证据边界。

逐项回读issue和生产入口后更新known limits：已关闭#204/#421移出开放owner措辞，写有日期的已实现机制边界；仍不承诺任意外部环境恰好一次。#235仍open只表示其剩余交付/产品验收，#223/#283/#144/#278按当前开放范围保留。#466/#469/#472在途候选不能写成main已完成。所有安装/步骤/补充观察结果继续未执行；独立clean-profile安装与完整walk是两条不同证据，不将审稿当人验。

## Global Constraints

评审收尾新增文件为 `docs/review/pr-501-mmp-review.md`、`docs/review/2026-11-02-pr501-pr504-mmp-review.md`，并在 `docs/review/README.md` 登记批次。

所有产品身份、权限、原子性、owner 围栏、持久意图、Provider 确认、unknown/conflict 和恢复语义保持。没有正式发布，不增加实验 API/旧数据库兼容层、双写或静默迁移；旧库拒绝与备份保留。Host 是业务权威，规划状态与工程事实正交。agent 不合并 PR、不改 Project Status 或 native blocked-by/blocking，不调用真实模型或执行真实 GitHub 业务写入。

每个 PR 对其**直接 base**计算增删总和：代码、测试、配置、fixture 严格少于 800 行，文档严格少于 1300 行；锁文件按仓库政策排除但仍审查。仓库 size 脚本的 1000/1500 上限不足以证明本轮要求。新发现的产品缺陷单列证据交所属 owner，不能通过减弱测试、权限或事实边界满足行数。发布面不得含凭据、本机绝对路径、访问型会话 URL 或内部系统资料。

唯一写集：`docs/product/demo.md`、仅出现直接矛盾时的 `docs/product/demo-install.md`、本计划和必要独立评审记录。`demo.md`/`demo-install.md`本轮由本PR独占；不改Core范围、vertical-path或release-gates。共享 `docs/README.md`索引由协调者串行最小更新并记录本PR归属。0代码；目标文档260–520行含计划/评审，不为行数或PR数扩写。

## Plan of Work

### Batch 1 · Draft与事实对照

先提交本计划并由协调者创建 Draft PR，回读 head/base/draft/文件范围与 issue 关联，再开始实施。公开写入只由协调者执行；使用 Closes #499、Refs #236，回读 closingIssuesReferences 必须包含子项且不包含父项。已创建子项的事实与 ack 见 Decision Log；不提前关闭父项。

最终提交前收敛本地 commits，检查消息、diff、发布面和严格规模；已推历史如需整理，先建 backup ref，再由协调者按 git-expert-operations 使用精确 lease。最终 push 后回读当前 head/base/checks、closingIssuesReferences 和全部 review threads；只有当前 head 的独立验收与真实 hosted checks 通过才 Ready。Ready 是请求人类评审，不是合并、规划完成或发布。**责任分界：**本实施者完成文档与本地验收后归档本计划；协调者 root 负责后续 commit 整理、push、远端当前head/checks/reviewThreads回读和Ready，本实施者不做这些外部/共享历史操作。

主文件是 `docs/product/demo.md`。对照上述生产源与 `apps/harness-plugin/src/host-operations.ts` 的 createChangeRequest/getChangeRequestOperation/resumeChangeRequest。逐项执行只读命令 `gh issue view 204 -R SingularityKChen/harness-projects --json number,state,title,closedByPullRequestsReferences`，对421、235、437、494、144、278、283、223替换同一命令的数字；记录观察日期和范围，不把返回closed扩大成人类通过。期望回读成功且文案只反映本次实际状态。

### Batch 2 · 修订与独立读者验收

主文件是现有指南，安装页只修确切矛盾。完成当前动作/恢复语义、closed修复与open残余的区分。独立审阅者仅按文档处理四个情境：已有unknown PR后重载、创建权限丢失但确认事实可读、原生PR作为Demo替代路径、独立安装未执行。若文档指向盲重创、绕过scope、父项关闭或把测试算人验即失败；直接修正文案。临时把第9步还原“无专用入口”/unknown写“重试创建”时，人工source对照必须发现矛盾；不添加镜像字符串测试。

### Batch 3 · 文档验证与交付

在本分支根检查所有新增/改变的相对链接和锚点：用只读Markdown解析器解析本PR文件，再以目标文件heading slug逐项确认；对公开issue链接匿名GET应可访问，失败明确记录，不编造可访问。文档新提供的命令均只读执行一次并记录环境/输出；不执行真实createPR/模型/安装来假装验收。

执行以下只读链接检查，期望无missing输出且退出0；链接到Markdown的fragment另按目标heading逐一确认，异常slug保留人工判定证据：

    python3 - <<'PYLINK'
    from pathlib import Path
    from urllib.parse import unquote, urlsplit
    import re
    paths = ['docs/product/demo.md', 'docs/product/demo-install.md']
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

以下机械命令的直接base为 `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`，重基后更新该对象：

    node scripts/rule-checks.mjs disclosure ea3790315ae3d96dffb04dd5c2c4127cc558bb7d
    node scripts/rule-checks.mjs size ea3790315ae3d96dffb04dd5c2c4127cc558bb7d
    git diff --check ea3790315ae3d96dffb04dd5c2c4127cc558bb7d...HEAD
    git diff --numstat ea3790315ae3d96dffb04dd5c2c4127cc558bb7d...HEAD

以上命令使用本观察的直接 base 对象；重基后同步改成新的具体 SHA，不用累计栈底。把 numstat 的新增与删除相加，Markdown 计文档，其余受策略计数文件计代码；必须实际记录两项数值并分别验证 <1300、<800，不能只引用较宽脚本通过。

文档不改变包行为，不为它写镜像测试或机械跑全套产品回归。最终独立审阅按source/issue差异清单确认无过期入口、无越权成功宣称；本实施者完成本地文档门禁，协调者再按当前远端事实完成Ready门。回滚为本PR文档提交整体revert。

## Validation and Acceptance

| 验收 | 判定证据 |
|---|---|
| 当前操作事实 | 所有控件/状态来自当前生产源码，第9步不再否认已交付入口 |
| unknown/重载安全路径 | PR原操作读回明确，无盲重创、无跳过scope；Start Work仅在恢复按钮可用时读回；按钮禁用时保留现有事实并通过工作区设置恢复同一仓库访问；PR确认不等于CI通过 |
| 真实已知限制 | 当前issue回读与实现边界分开；closed不列开放owner，open父不证明缺功能 |
| 人类边界保留 | #236独立安装、#143十二步/四观察、#124/#72产品观察仍开放，表格未执行 |
| 文档质量 | 独立情境审读/反例、links/anchors、公开面、严格规模与工作区 diff check |
| 远端交付门 | 当前head/base/hosted checks/全部review threads/issue关联和Ready；由协调者 root 在commit/push后执行 |

## Progress

- [x] (2026-11-02 16:18 +08) 两份设计独立审阅后确认这是现有指南事实修订，不重复#444。
- [x] (2026-11-02 Asia/Singapore) Batch 1：root创建 Draft PR #501，初始head `e268bb5f4bd42afb0ced10d5c17824eb36cb42fe`、base `main`；root回读PR→#499与#499→PR双向关联，仅关闭引用子项。产品/已知issue读回见 Outcomes。
- [x] (2026-11-02 Asia/Singapore) Batch 2：更新唯一产品指南，完成四种情境的源码对照自审；未改安装页、模板或产品代码。
- [x] (2026-11-02 Asia/Singapore) Batch 3 本地部分：链接/公开issue GET/公开面/规模/diff检查均完成；具体输出见 Outcomes。远端提交、push、当前head checks与Ready由root接手，未由本实施者执行。
- [x] (2026-11-02 Asia/Singapore) 独立完整验收后修复第6步P2：源码确认按钮可因仓库写门禁用；文档区分可用/禁用路径并保留同一目标与原intent。root后续安排独立复评。
- [x] (2026-11-02 16:18 +08) 已确认父项独立安装/人类walk是本子项非目标，实际结果继续未执行。

## Surprises & Discoveries

原指南已完整，但PR入口与开放风险owner滞后于main；#235仍open而#437/#494已closed说明必须按实现与验收分层，不能按父项状态写功能缺席。#236 issue正文当前验收仍要求非作者仅凭指南完成干净profile安装；本次没有此人验收证据，因此父项保持open。#444已交付指南与空白表，不能再包装同一个准备任务。

独立完整验收在 checkpoint `cf2ada668e9bce808ddca8773c176d214e87d895` 发现唯一 P2：第6步把 `pending`/`unknown` 一概写成点击 **读回并恢复**，没有说明仓库写权限失效时该按钮会禁用。核对 `packages/ui/src/start-work-section.ts:44,69`，`allowed` 要求 connected、options 已读且所选仓库 `available`；提交按钮用 `disabled: !allowed || pending`。`packages/ui-model/src/capability-access.ts:14-20,73-93` 将开始工作的分支/工作树写门与读门分开；`packages/ui-model/src/work-item-detail-view.ts:63-69` 的执行上下文谱系本地只读入口不依赖这些写门，因此已有读取事实仍可显示。

恢复入口核对：`packages/ui/src/start-work-section.ts:65` 在仓库路由/写权限不可用时显示 **绑定仓库**；`packages/ui/src/workspace-setup.ts:45-50,112,118-120` 将其路由到工作区 **连接设置**，标题栏连接设置也可到达。该导航会离开工作项列表，故指南要求记录当前事实/提示、恢复同一仓库访问后重新打开同一工作项并保留原仓库/分支；没有声称 Start Work 表单内有一个始终可用的设置按钮，也没有指示换目标或新建 intent。

## Decision Log

- 2026-11-02：本会话用户直接对 PR #501–#504 条件授权：无P0/P1或仅P2/P3，由评审会话修复、独立复评、归档与整理提交，核对issue后rebase合并；当前项由评审会话负责收尾，不包含其它PR合并或Planning字段写入。

Decision：选择两方案共同推荐的就地B1，Demo文件由本PR独占。Rationale：一份当前操作事实源，减少重复；Core规范另PR引用指南。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision：Closes #499，Refs #236/#143/#124/#72；所有人类结果保持未执行。Rationale：文档修复可独立评审/回滚，不能完成 #236/#143 的实际人工标准。Date/Author：2026-11-02 16:18 +08 / 独立spec修订者。

Decision / 外部写入记录：协调者报告并提供回读：actor `SingularityKChen`，目标 `SingularityKChen/harness-projects` 的子 issue #499，父项 #236；创建与subissue链接已ack并回读，Project item已建立；未改Status/native依赖。独立修订者未执行远端写入。创建请求幂等记录由协调者在最终交付审计中补入，不凭空构造。Date/Author：2026-11-02 +08 / 协调者执行、独立修订者记录。

Decision：归档边界限定为文档实现与本地验收；commit/push/当前远端状态回读/Ready由root执行。Rationale：本实施者被明确要求不提交、不推送、不做公开写入，root需统一整理commit和最终PR门禁。Date/Author：2026-11-02 +08 / root协调者指令，由实施者记录。

Decision / P2修复：第6步只在 **读回并恢复** 可用时才指导用原仓库/分支按原 intent 读回；若按钮因连接或写路由/权限受阻而禁用，记录当前事实/拒绝提示，通过工作区 **连接设置** 恢复同一仓库访问，再返回同一工作项和目标继续恢复。理由：UI禁用条件包含选中仓库写可用性；执行上下文本地读取与外部写操作有不同门。禁止新仓库/分支/intent绕过原恢复。Date/Author：2026-11-02 +08 / 实施者按独立复评核实。

## Idempotence and Recovery

issue回读和链接检查可重复；状态变化时就地更新日期/结论并追加change note。只对当前生产实现写操作承诺，候选变动不抢先发布。文档可整体revert，不触及数据库、工作树、Provider或远端业务对象。发现新风险仅记录owner，不自动改milestone/Status；维护债务若本轮新增并决定延迟，记 `docs/exec-plan/tech-debt-tracker.md`。

## Interfaces and Dependencies

依赖main已合入的生产UI/Host操作、gh只读issue接口和唯一安装指南；不依赖#472或browser/CI PR合入。外部写入仅协调者创建有界子issue/Draft/Ready与记录ack，未授权产品写/模型调用。范围文档通过相对链接对接，索引由协调者串行。

## Outcomes & Retrospective

已在 `docs/product/demo.md` 就地修订：移除“没有专用PR入口”和#204/#421仍开放的过期描述；补充详情页创建字段、原操作摘要/显式读回恢复、unknown/permission/scope边界、PR确认与谱系新鲜度分离，以及仍可用的GitHub/Harness session替代路径。#437/#494的交付事实分别由#491/#495关闭；#204/#421分别由#467/#492关闭。#235仍open，其GitHub milestone字段是M4.1、issue正文当前处置字段写TargetRelease MMP-Core，指南保留该差异且不替它裁决剩余范围。#283（M2.1）、#144/#278（M4.1）、#223（M2.1）仍open并留在限制表；#143/#236仍open。

独立情境自审：未知PR重载后在有授权且找到原operation时显示原请求摘要与读回动作，不重输正文或发第二个create；读回失败、PR写权限修复和失效scope分别按当前提示处理，不声称绕过保护。补充核对 Start Work 的 disabled 状态：恢复按钮不可用时记录仍可见上下文/状态，进入可达的工作区连接设置恢复同一仓库访问，返回原工作项/仓库/分支再恢复；不点击禁用按钮、不换目标、不起新intent。GitHub/Harness session仍可作为原生路径；#236非作者干净profile安装和#143完整人工walk、四补充观察均保持“未执行”。不修改 `demo-install.md`、`docs/README.md`、产品/CI/测试文件，不添加镜像测试。 Superseded by 本节“2026-11-02 · MMP 独立评审与收尾”（2026-11-02）；协调者已按Global Constraints补齐索引与必要评审记录。

验证快照（直接base `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`）：第一次交接时未含root的README索引，估算文档162 A+D、代码0；root checkpoint `cf2ada668e9bce808ddca8773c176d214e87d895` 含索引后为163 A+D、代码0。P2修复后的当前未提交工作树 `git diff --numstat <base>` 为README 1+0、计划150+0、指南11+10，共172个文档A+D、代码0；相对`cf2ada6`的局部补丁为计划14+5、指南1+1，共21个A+D。上述数字只对应各自明确的快照；root在后续commit/索引/计划编辑后必须重新计数，不能将其沿用为永久最终值。计划链接脚本输出 `missing []`；指南中所有GitHub issue链接匿名GET均为HTTP 200（#71/#145/#143/#204/#218/#223/#235/#236/#278/#283/#420/#421/#437/#494）；相对锚点人工核对到 `vertical-path.md` 的“2. 纵向链路步骤枚举”和 `demo-install.md` 的“当前数据根与旧库保留”。checkpoint上的 `node scripts/rule-checks.mjs disclosure <base>`无机械命中；本次两文档增量经人工五类发布面审读无新增敏感信息。`git diff --check <base>`通过。文档不触及包行为，因此未跑产品测试。

归档只表示本计划范围内文档实现、P2文字修复及本地验收完成。独立reviewer对P2修复的局部复评由root安排；PR #501远端仍为初始Draft，root需按计划完成commit整理、push、当前head/base/hosted checks/review threads/issue引用回读与Ready。没有新增安装、人类walk、模型或真实GitHub PR创建证据，#236/#143及R1边界保持开放。


### 2026-11-02 · MMP 独立评审与收尾

初审输入、P0–P3矩阵、反例、实际命令和issue验收见 `docs/review/pr-501-mmp-review.md`。独立评审未发现真实P0/P1/P2/P3，源码/文档核对与文档门通过；文档子项验收不接受任何未执行的安装、人类走查或R1。评审会话接管后续的证据归档和提交整理。旧实施交接中的Draft及待提交状态是历史快照，Superseded by 本小节（2026-11-02）。

最终push后，在本分支检出根运行 `gh pr view 501 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,baseRefOid,reviews,closingIssuesReferences`、`gh pr checks 501 -R SingularityKChen/harness-projects` 并回读全部review threads；只有实际当前head门禁与独立批准成立才执行已授权rebase merge，再回读子issue和父验收状态。恢复引用为 `refs/backup/pr501-before-mmp-review-20261102`，精确lease拒绝并发覆盖。

## Bottom Change Note

2026-11-02 16:18 +08：独立综合A/B，选唯一指南就地修订，限定当前PR恢复事实；保留#444历史交付与#236/#143人类验收边界。

2026-11-02 +08：按root指令完成指南事实修订和本地验收后归档；将最终commit/push/远端门禁/Ready明确交由root，`docs/README.md`索引不由本PR实施者改动。

2026-11-02 +08：按独立完整验收的P2修订第6步权限受阻时的恢复指引；只读核对Start Work可用性门与工作区设置导航，保留同仓库/分支/原intent及现有事实，不改产品代码或新增测试。最终行数须由root在当前提交前重新计算。

2026-11-02：补充本轮MMP独立评审入口、用户条件授权和收尾回读/恢复门；历史实施快照由本轮收尾记录接续，不宣称未执行的人类验收。
