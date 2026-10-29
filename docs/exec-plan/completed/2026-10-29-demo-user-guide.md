# Demo 使用指南与人工记录准备 ExecPlan

> 状态：Completed；创建：2026-10-29（Asia/Singapore）
> 范围：完成可独立评审的 Demo 指南和空白证据记录，不代替人类安装、走查或父项验收。
> 规范：`PLANS.md`；交付 issue：#444（#236 下的独立文档准备子项）。

## Purpose / Big Picture

首次收到插件产物的操作者能从一页找到安装入口、理解 sandbox 第 1–12 步、识别当前限制，并使用记录表留下可归属的观察。文档链接与发布面检查可复跑；该文档准备闭环不等于真实安装、完整 walkthrough 或父项验收。

这是“指南与证据准备”的闭环。#236 的作者以外干净安装、#143 的人类走查，以及 #124/#72 的产品证据继续独立存在；文档、自动化与 Web 切片观察不能替它们通过。PR 使用 `Closes #444`、`Refs #236`、`Refs #143`、`Refs #124`、`Refs #72`，不关闭父项或更改其验收。

## Context and Orientation

在分支 `docs/demo-user-guide` 的工作树根（仓库相对位置 `.worktrees/demo-user-guide`）执行本计划。设计观察为 2026-10-29 14:12 +08，检出 `06d929017c8551e6b106fcbe7651f12ac26e4642`；实施前用 `git rev-parse HEAD` 与 issue 回读命令重新确认，不能把此快照当永久状态。

`docs/product/vertical-path.md` §2 拥有 1–12 用户动作定义，第 13 行是失败面要求；§2.1 明示混合历史快照，不能把旧的“未交付”或测试计数直接当当前产品状态。`docs/product/demo-install.md` 拥有唯一安装、凭据参考、显式启用执行、故障开关与卸载操作。它的 2026-10-26 Web 安装记录未配置模型、未发 prompt；2026-10-27 接线记录使用真实 Local Git 与会话录制回放，不能扩大为 Desktop、真实模型或完整人工验收。

当前可见入口与状态措辞从 `packages/ui/src/workspace-setup.ts`、`packages/ui/src/start-work-section.ts`、`packages/ui/src/work-item-app.ts` 核对；数据根从 `apps/harness-plugin/src/host.ts` 与 `host-composition.ts` 核对。数据库准入 owner 是 `packages/storage/sqlite/src/migrate.ts`：不兼容时返回 `incompatible_database` / `back_up_and_rebuild`，不授权删除原库。`docs/architecture/release-gates.md` 保留人类 UAT 和备份演练裁决权。

issue #236 的 2026-10-27 disposition 要求公开范围、综合限制、区分 Web/Desktop/真实模型，并以备份重建取代无条件删库。#143 明确第 9 步可以在 GitHub 或 Harness 会话创建 PR，再沿分支谱系关联；专用 PR 创建入口 #235 仍开放，不能把它的缺席写成整个第 9 步不允许。#124 保留真实 sandbox 1–5 步、三类身份、不重复及断网 stale 证据；#72 保留真实原生 PR 与实际 workflow checks 的产品展示。

## Design / Spec

采用单篇操作者指南，内嵌空白安装及走查表，顺序为适用范围与证据、准备和安装链接、12 步操作表、四项补充观察、已知限制、安全备份重建、可复制记录。安装命令只链接原手册，步骤定义只引用纵向路径；指南负责把定义翻译成当前界面动作和诚实的预期，不建立第二套规范。

12 步每行写“操作者动作／应观察到什么／失败或未观察时记录什么”，保留步骤号。第 6 步要写清 **开始工作** 打开表单、选择仓库、分支名可选、**提交开始工作** 才发送命令；`pending` / `unknown` 使用 **读回并恢复**，不可再次盲提交。详情抽屉谱系足够支撑最小 Demo，跨条目的 Delivery 和 Board 页面不能变成前置依赖。第 9 步写原生平台或会话创建及谱系关联的允许路径，同时注明专用创建功能的当前边界。没有本轮宿主观察的能力写为可尝试或待记录，不能把局部实现等同人工通过。

四项补充观察原样承接 #143：强制启动失败后的人工回退；断网后列表和抽屉都保留最后值并标 stale；重启后执行上下文仍在；同一 Demo PR 加入 Project 只出现一次。记录真实、录制或替身来源；`unknown` 不写成失败后可盲重试，缺失/陈旧 CI 不写成通过。每项同时检查规划状态不被工程事件改写、无未确认 Saved、凭据只存句柄、用户仓库不被删除或覆盖、从产物安装。

已知限制按“用户症状／受影响步骤／现有避让或下一步／开放 owner issue／核对日期”组织。实施时逐项核对 #283、#144、#223、#278、#204/#420；#235、#281、#71、#145 作为范围边界按实际产品能力说明。#218 已关闭，不列开放缺陷，修复也不构成新的宿主走查证据；#396 是测试扫描整理，不列用户缺陷。不得只凭 issue 开放就断言源码完全未实现。

#236 原 AC 的“known issue 属于 M4.1 或以后”与当前 #223/#283 的 M2.1 归属有字面冲突。指南如实公开这些 owner 和已交付／剩余边界，不隐藏已知风险，也不搬动 milestone；文档准备验收不宣称该父项 AC 已满足。此差异留给父项验收处理。

2026-10-29 对基线 `main@06d9290` 的源码核对显示：插件 `apps/harness-plugin/src/host.ts` 在有效 `DSH_HOME` 下把 Project 数据库存于 `$DSH_HOME/harness-projects/workspace.sqlite`；`DSH_HOME` 未设置或为空时回退到 `~/.dsh/harness-projects/workspace.sqlite`。该数据根与安装指南为 native workspace 配置的 Documents 目录分开。实际备份位置以所用产物对应安装指南的当前数据位置为准；若指南明确 profile-specific 数据根，就使用该根下解析后的 `harness-projects/workspace.sqlite`，不要沿用基线路径。先停止所有使用实际数据根的 Harness 进程，复制整个 `harness-projects` 目录到原先不存在的目标，再比较源/副本的文件清单和每个文件摘要。保留原数据根和用户仓库、分支、工作树；由操作者决定是否在新 profile / 新数据位置重建。不得把旧 SQLite 复制进新库、手改 generation 或执行修复 SQL。重建不迁移旧执行上下文；稳定人工 issuer key 仍由原凭据管理器提供。完整恢复演练留在 #369 / R1 第 12 项，本任务不执行当前用户库操作。

记录表包含日期/时区、操作者及是否作者以外、head、宿主版本/profile、插件版本/tgz SHA-256、脱敏 sandbox/仓库引用、模型模式及实际调用、允许写范围、每步字面观察/证据、分开的失败原因（平台/权限/环境）和处置（基本/非基本/环境问题）、跟踪 issue、对 #143 和 M5 backlog 的影响、四项补充观察、不变量及待人类裁决。所有结果初值为“未执行”；表中区分“独立干净安装”和“完整走查”。发布前去掉凭据、访问型会话 URL 与本机绝对路径。

比较后放弃三个方案：独立记录文档会增加同步面，当前内嵌模板已足够；把安装全文合并进新页会复制操作权威；等人类走查完成才写指南会推迟已知限制告知。两份原始方案保持独立输入，评审不要求原作者互相修改提案。

## Global Constraints

实施写集仅为 `docs/product/demo.md`、已存在的 `docs/product/README.md`、`docs/README.md`，以及本控制计划的生命周期更新（完成时移到同名 `docs/exec-plan/completed/`）。不新增无必要的 README；索引只增加导航，不复制正文。预计指南约 180–220 行、计划约 150–200 行、索引数行，总文档变更优先小于 450 行，硬上限 1300 行，代码及测试变更为零。

中文正文，仓库相对路径，自包含。安装手册、产品代码、测试、脚本、门禁与公共接口均不改；不新增句子匹配测试或文档工具框架。若发现产物或安装命令本身有错误，记录来源和影响，另立修复闭环，不暗中扩充本任务。

不改 Project Iteration、Status、原生 blocked-by/blocking 边或父项 AC；不执行真实模型、当前用户库恢复或 GitHub 产品对象写入。本计划的文档准备授权不等于真实模型额度或人类验收授权。发布面按 `docs/development/publication.md` 机械及人工五类目检查；没有真实记录时保留未执行。

本次授权评审收尾增加文档证据写集 `docs/review/pr-445-mmp-review.md`、`docs/review/2026-10-29-pr445-pr456-mmp-review.md` 与 `docs/project-management/merge-queue.md`，不扩展产品实现范围。

## Plan of Work

### Task 1 · Batch 1：可独立使用的指南

**最小闭环**：首次接收者能找到安装、按 1–12 步尝试并记录、识别已知限制；导航和控制计划随同闭环交付。**涉及主文件**：`docs/product/demo.md`。

先回读 owning source 和 issue，draft PR 关联 #444 和四个父项。按 Design / Spec 写指南及最少索引；不重新打包、启动宿主或调用模型。独立审读者只用指南模拟第一次接收产物，核对准备、动作、失败与恢复语义；审读结论与真实安装记录分开。

在上述任务分支工作树根执行以下 issue 回读，预期得到每项当前 state、milestone 和正文；读取失败则记录失败，不推断状态：

```sh
python3 - <<'PY'
import subprocess
for n in (444,236,143,124,72,283,144,223,278,218,204,420,235,281,71,145):
    subprocess.run(['gh','issue','view',str(n),'-R','SingularityKChen/harness-projects',
                    '--json','number,state,milestone,title,body'],check=True)
PY
```

本地相对链接与锚点用下列一次性检查；预期输出 `local links ok`、退出 0。它只核对改动文档，不作为产品或外部 URL 可用性测试：

```sh
python3 - <<'PY'
import pathlib,re,urllib.parse
root=pathlib.Path.cwd()
files=[root/'docs/product/demo.md',root/'docs/product/README.md',root/'docs/README.md']
files += list((root/'docs/exec-plan').glob('*/2026-10-29-demo-user-guide.md'))
def content(p):
    return re.sub(r'```[^\n]*\n.*?```','',p.read_text(),flags=re.S)
def anchors(p):
    seen={}; out=set()
    for h in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',content(p),re.M):
        h=re.sub(r'<[^>]*>','',h).lower().replace('`','')
        h=re.sub(r'[^\w\s\-]','',h).replace(' ','-')
        count=seen.get(h,0); seen[h]=count+1
        out.add(h+(f'-{count}' if count else ''))
    return out
for p in files:
    assert p.is_file(),f'missing document: {p.relative_to(root)}'
    for dest in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)',content(p)):
        u=urllib.parse.urlsplit(dest.strip('<>'))
        if u.scheme or u.netloc: continue
        target=(p.parent/urllib.parse.unquote(u.path)).resolve() if u.path else p
        assert target.exists(),f'missing link in {p.relative_to(root)}: {dest}'
        if u.fragment and target.suffix=='.md':
            assert urllib.parse.unquote(u.fragment) in anchors(target),f'missing anchor: {dest}'
print('local links ok')
PY
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望 disclosure 无发现、size 代码 0 且文档不超过 1300、diff 无空白错误。未提交的新页不被基于 Git diff 的检查完整覆盖，提交前人工审阅全页，提交后重新跑同一组命令并记录 head。人工五类目检查覆盖凭据、本机身份、账号个人信息、内部系统、保密字样；不以机械通过替代。

保持两份可审阅提交：先提交计划并建立 draft PR，再提交指南、导航与计划验收更新；最终 push 前移除临时 debug/fixup，不为提交数机械改写已清晰的历史。最终 push 后回读 `gh pr view -R SingularityKChen/harness-projects --json number,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup,reviewDecision`、`gh pr checks -R SingularityKChen/harness-projects`，并按 `docs/review/README.md` 读取全部 review threads。预期 base 正确、远端 head 等于最终本地 head、关联只关闭子项、当前 checks 通过、无未处理意见；满足后才 ready，不自行合并。记录文档验收后移计划到 completed 并更新索引。**回滚**：撤回本批文档变更或 revert 文档提交，不操作产品数据。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 首次操作者可执行 | 独立审读逐步指出前置、12 个动作、预期/失败位置；安装入口仅一个 |
| 当前事实可追溯 | 日期化来源，开放 owner 回读；第 9 步遵从 #143；#218 不再列开放缺陷；#223/#283 归属冲突公开 |
| 记录诚实 | 安装与走查表初值未执行；Web/Desktop/真实模型和真实/录制/替身分别标明 |
| 不变量和恢复 | 四项补充观察齐全；unknown 不盲重试；备份保原件、新位置重建，无删除或迁移承诺 |
| 文档质量 | 相对链接/锚点通过、disclosure 无发现、人工五类目无未处理项、规模及 diff 检查通过 |
| 交付边界 | PR 只关闭文档子项，四父项 Refs；当前远端证据回读；不宣称独立安装、人类 Demo 或 R1 完成 |

## Progress

- [x] (2026-10-29 14:12 +08) 独立读取两份设计、仓库规范、owning source 与 live issue；完成方案综合和全章节计划。
- [x] (2026-10-29 14:12 +08) 主控报告文档子项 #444 创建成功并加入 #236；实际 ack 归属见 Decision Log。
- [x] 2026-10-29：新增产品指南和两处导航；保留 #444 子项与 #236/#143/#124/#72 的不同验收边界。
- [x] 2026-10-29：只读回读 #444、#236、#143、#124、#72 及已知限制 owner；记录 #218 已关闭，#223/#283/#204/#420 属 M2.1，#144/#278/#235 属 M4.1。
- [x] 2026-10-29：本地链接/锚点为 `local links ok`；`disclosure origin/main` 无发现；`size origin/main` 代码 0、文档在硬上限内；`git diff --check` 无输出；ExecPlan 13 个强制章节及顺序核对通过。
- [x] 2026-10-29：提交后最终树回读 `git rev-parse HEAD`，重跑链接/锚点、ExecPlan 章节结构、`disclosure origin/main`、`size origin/main`、`git diff --check origin/main...HEAD`；全部 exit 0。输出分别为 `local links ok`、`PLANS section structure ok`、disclosure 无 findings、代码 0 / 文档 277 行、diff 无输出。最终 head 通过上述回读命令获取。
- [x] 2026-10-29：第一轮独立终审提出三项 P2：补全 Start Work 表单提交/读回动作；明确插件 Project 数据库的数据根及可核对的备份流程；将失败原因、基本/非基本/环境处置、跟踪 issue 与 #143 backlog 影响分开记录。另为已知限制补上受影响步骤。以上修订后，链接/锚点、disclosure、size 和 diff 检查全部 exit 0，分别输出 `local links ok`、无 findings、代码 0 / 文档 287 行、无 whitespace findings。前一条实现提交的检查记录只代表当时内容；以本条复跑为准。
- [ ] #236 独立 clean-profile install、#143 人类完整 walk 和 #124/#72 产品观察仍待其他验收者/人类完成；不属于 #444 的文档准备完成条件。

人工发布面五类目（按 `docs/development/publication.md`）：凭据无真实值；本机路径/身份无绝对路径或用户名；账号/个人信息无私人身份资料；内部系统无内网地址或内部系统名；保密字样无命中。文档中的 GitHub issue 链接、官方产品名、仓库相对路径和版本号是本任务所需的公开来源，不含访问凭据。

外部验收明确延期到所属 issue：#236 独立干净安装、#143 人类 1–12 走查和 #124/#72 产品观察未执行，不属于 #444 的完成勾选，不阻塞有界文档准备验收。

## Surprises & Discoveries

live 回读显示 #218 已关闭，设计 B 保留它为开放缺陷的建议不成立。#223 仍开放但源码已具备准入拒绝，不能把整个 issue 未关闭写成保护完全不存在。#223/#283 位于 M2.1，和父项旧文字冲突。`vertical-path.md` 明示混合快照；#143 的当前 AC 比历史第 9 行更准确地界定 Demo 可用的外部 PR 路径。以上均按 Context 中的观察时点取得，提交前重核。

初次本地链接核对指出 `docs/README.md` 已指向 Completed 中的 ExecPlan，但文件当时仍在 Active。完成指南后将同名计划归档到 Completed 并复跑链接检查；最终检查必须包含计划目标存在性与锚点。

第一轮独立终审发现三个实际操作缺口：Start Work 表格未写出表单 opener 与提交动作；备份段将 Documents 目录与插件 Project SQLite 所在的数据根混在一起；失败记录虽有平台/权限/环境原因，缺少 #143 要求的基本/非基本/环境处置、跟踪 issue 和 backlog 影响。另发现 known-limit 表未标受影响步骤号。依据 `packages/ui/src/start-work-section.ts`、`apps/harness-plugin/src/host.ts` 和 #143 AC 作窄文档修订；没有扩展运行或验收范围。

技能自带 `lint_execplan.py` 与仓库 `PLANS.md` 不同，要求额外 Concrete Steps / Artifacts and Notes 并拒绝仓库示例允许的内部命令围栏。本次运行因此 exit 1；按仓库规范保留规定的 13 章节，改用结构核对与独立语义审读，不添加冲突章节以迎合技能脚本。

## Decision Log

- Decision：依用户授权将指南准备做成可评审交付，不因尚无人类安装/走查而停写；不代替其验收。Rationale：文档准备与实际体验是不同成果。Date/Author：2026-10-29 14:12 +08 / 主控授权、独立综合评审者记录。
- Decision：独立文档子项承载本闭环，PR 仅关闭子项并 Refs 四父项，保留现有 Iteration、Status 和原生依赖。Rationale：防止工程交付冒充父项人类验收；不新增阻塞关系。Date/Author：2026-10-29 14:12 +08 / 主控决定、评审者记录。
- Decision / 外部写入记录：actor `SingularityKChen`，目标 GitHub repo `SingularityKChen/harness-projects` 的 issue #236，幂等键 `iteration-delivery-20261029:demo-guide-prep-v1`；主控报告创建 #444 并添加父项 #236，REST ack 成功（exit 0）。未写 Project 字段、Iteration、Status 或 blocked-by/blocking 边。Rationale：用户授权优先准备可交付指南，子项边界保留所有父项人类标准；本评审者未执行外部写入。Date/Author：2026-10-29 14:12 +08 / 主控执行报告、评审者记录。
- Decision：采用设计 A 的内嵌操作者表与记录、设计 B 的唯一安装 owner；修订 B 的历史能力判断和 #218 状态，取消 A 对安装手册的条件扩展。Rationale：当前源码、live #236/#143/#124/#72 与 owner issue 优先于提案假设；保持最小写集。Date/Author：2026-10-29 14:12 +08 / 独立综合评审者。
- Decision：不把 milestone 字面冲突自动“修正”为看板写入，也不删去风险。Rationale：#236 要求公开 #223/#283；父项 AC 和规划归属裁决仍由人类负责。Date/Author：2026-10-29 14:12 +08 / 独立综合评审者。
- Decision：指南同时说明 M2.1 与 M4.1 的仍开放限制，并将 #218 排除在开放缺陷表之外。Rationale：2026-10-29 只读 issue 回读与 #444 范围要求优先于旧 #236 文字；不移动任何 issue，也不改父项 AC。Date/Author：2026-10-29 / 实施者。
- Decision：第 9 步允许操作者在 GitHub 或 Harness session 创建 PR 并沿分支谱系查看。Rationale：#143 当前 AC 明确允许两处创建；#235 仍是插件内专用创建能力的 owner。Date/Author：2026-10-29 / 实施者。
- Decision：数据库恢复指导要求保留原件并在新位置重建。Rationale：当前 `migrate.ts` 对不兼容库返回 `incompatible_database` / `back_up_and_rebuild`；旧的无条件删库表述不安全，且代码不承诺迁移实验数据。Date/Author：2026-10-29 / 实施者。
- Decision：恢复指导记录 `main@06d9290` / 2026-10-29 的 Host 数据根源码观察（Superseded by 最终组合后 `docs/product/demo.md` 的当前 profile 数据根与安装指南锚点，2026-10-29），但实际备份位置以所用产物对应安装指南的当前数据位置为准；profile-specific 路径优先于基线推导。Rationale：避免组合更新安装指南后将旧数据路径误当当前事实；native Documents 与插件 Project 数据仍需区分。Date/Author：2026-10-29 / 第二轮文档协调。
- Decision：失败原因（平台/权限/环境）与验收处置（基本/非基本/环境问题）独立记录；每项携跟踪 issue 与 #143 backlog 影响。Rationale：issue #143 的验收需要 human disposition 才能指导 M5；agent 仅准备记录，不裁决分类或 backlog。Date/Author：2026-10-29 / 评审修复者。

- Decision：独立验收的三项操作缺口与后续本机绝对路径记录均已修复，第二轮复评在候选 `5bf2899` 通过；此后仅补交付账目，不改指南行为。Rationale：文档可执行性、公开面和人类验收界限均有独立证据。Date/Author：2026-10-29 +08 / 主控记录。
- Decision：外部写入 actor 为 SingularityKChen，目标为 GitHub 的本仓 issue #444／父 #236、Project #10、PR #445；幂等关联键 `iteration-delivery-20261029:demo-guide-prep-v1` 与 `iteration-delivery-20261029:tracking-v1`。创建、父子链接、PR Closes #444、反向关闭引用和 ExecPlan/Batch 分类字段已得到 ack 并回读；现有 Status、Iteration、原生阻塞边未写入。Date/Author：2026-10-29 +08 / 主控记录。

- Decision：2026-10-29 用户在本会话直接授权评审 PR #445、#454–#456，且无 P0/P1 时“你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并”。本 PR #445 首轮完整评审无新增缺陷，故主控接手该分支的提交整理、最终复评和有界 issue 收尾；不重复请求 owner/merge 批准。Rationale：这是覆盖本 PR 的本次人类直接授权，优先于评审手册的默认逐次询问；有未修复 P0/P1 则不合并。原计划已经 Completed，本轮保留归档并将证据放入 `docs/review/pr-445-mmp-review.md`。Date/Author：2026-10-29 / 主控记录。

- Decision：先行 #454/#455/#456 已在 main 实际合并，指南据此移除 #420 的开放 owner 缺陷、保留 #204/#421 外部不确定性，并将当前备份源直接指向 profile 专属目录和安装指南，不继续用历史共享路径推导。Rationale：已交付保障与开放恢复问题必须区分，安全备份步骤仍保留；本改动不接受人工走查或 R1。Date/Author：2026-10-29 / 主控。

## Idempotence and Recovery

文档和链接检查可重复；issue 在编辑期间变化时更新限制及日期再核对。不复制证据记录成通过状态；错误断言删除或收窄，并在本计划原处标 Superseded。安装与模型未授权项维持未执行。文档提交可整体 revert；无 schema、数据迁移或产品副作用。提交前后发现范围扩张时停止扩张、保存事实并拆为独立闭环。

## Interfaces and Dependencies

需要 Git、Python 3、Node 与只读已认证 `gh`；所有 GitHub 命令显式 `-R SingularityKChen/harness-projects`。依赖安装手册、纵向路径、R1 和当前 issue 的职责如 Context 所述。技术债按 `docs/exec-plan/tech-debt-tracker.md` 处理；本任务不接受新的实现债务，既有未交付产品项保持 owner issue，不能把它们改名为新文档债务。

## Outcomes & Retrospective

指南、两处导航和本轮评审修订均为文档变更。在分支 `docs/demo-user-guide` 工作树根，Python 本地相对链接与锚点脚本输出 `local links ok`；`node scripts/rule-checks.mjs disclosure origin/main` exit 0、无 findings；`node scripts/rule-checks.mjs size origin/main` exit 0、代码 `0 / 1000`、文档 `287 / 1500`；`git diff --check origin/main...HEAD` exit 0、无输出。所有结果针对本轮修订后的工作树读取，提交 amend 后再复跑同四项。人工五类目结果见 Progress。无产品代码、测试、依赖或运行态数据变更。

本批没有执行 Harness、重打包、模型调用、当前用户数据库操作或 GitHub issue/Project 写入。表单所有步与补充观察均为 `未执行`。独立 adversarial review 由协调者另行派发；#236 的独立安装、#143 的人类走查、#124/#72 的产品证据和 R1 仍未完成。本计划只记录文档子项 #444 的边界，不关闭父项验收。

## Bottom Change Note

- 2026-10-29 +08：主控记录第二轮独立复评通过与实际 GitHub 跟踪回读，整理最终文档提交；最终远端检查按 PR 当前 head 回读。

- 2026-10-29 14:12 +08：综合两份独立方案并按 live issue / owning source 修订；收敛为单一指南闭环，保留人类验收、规划事实和已知风险边界。
- 2026-10-29：实施操作者指南、更新产品索引、完成文档检查并归档本计划；保留人类验收为未执行。
- 2026-10-29：按独立验收首轮 P2 修正 Start Work 操作、插件数据库备份路径与完整性步骤、#143 失败处置/issue/backlog 记录，并在 known limits 增加步骤追踪。
- 2026-10-29：将 Host 数据路径明确标记为基线源码观察，并规定所用产物的安装指南对实际备份源拥有优先权。

- 2026-10-29：追加本次人类授权、独立全矩阵评审与收尾证据引用；源代码变异已还原，无未修复新缺陷。

- 2026-10-29：按先行三项实际合并结果更新指南与合并记录，重新进行独立文档复评。
