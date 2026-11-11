# Code scanning 修复 ExecPlan

> 状态：Completed（实现验收完成；Ready 发布仍按当前 head 门禁执行）
> 创建：2026-11-11
> 范围：修复可复现的正则回溯与 HTML 安全断言覆盖不足
> Issue：#617
> 规范：`PLANS.md`

## Purpose / Big Picture

工作树路径和 workflow 引用校验应在构造输入下及时给出原有类型化拒绝，安全断言应识别大小写及空白分隔的危险标签。成功证据是旧实现被有界回归判红、新实现通过同一回归、完整本地验证及最终 PR head 门禁通过。两条测试文本提取告警需要明确用途，不用产品清洗器或扫描排除来掩盖。

## Context and Orientation

2026-11-11 的 CodeQL analysis `2140858593` 在 `430a6f9363b7937c8d8d494a78ad301893d2df34` 报告六条 JavaScript/TypeScript 告警；开始实现时基线为 `063e427a719bd2ba2c50391279ee5b81f5f5bd56`，六个相关文件与扫描版本相同。#2 位于 `resolveWorktreePath` 的尾部分隔符删除；#3 位于 workflow W3 的固定提交引用校验；#5/#6 是 UI HTML 的负向断言；#7/#8 是测试读取单元格文本的辅助转换。#1/#4 已由平台标记 fixed。

本机 Node v26.13.0，仓库 `.nvmrc` 为 26。完整路径函数对六万分隔符输入耗时约 1.1 秒；93 字符的畸形 workflow 引用令原正则超过 1.5 秒诊断超时。这些是局部复现，不代表完整 Host、CI 或浏览器安全审计。#7/#8 的返回值只供断言比较，不进入 HTML/DOM 注入点。

事实：Issue #617 已创建并回读标题、标签与正文。硬约束：路径安全顺序、W1–W7、七项系统不变量与外部写入确认语义保持。假设：五秒子进程期限足以覆盖 Node 启动与正常线性输入处理；用明显更大输入分隔旧实现，避免依赖毫秒级基准。未知：独立评审与托管最终 head 结果，按后续证据更新。

## Design / Spec

方案一仅调整正则字符类，改动最少，但尾部删除仍需避免未锚定重试，W3 的 owner/repo/路径与 SHA 形状也不够直观。方案二采用线性尾部遍历与显式引用分解，局部增加少量代码却能清楚界定复杂度和输入语义，选此方案。方案三新增清洗/解析依赖或排除测试扫描，会扩大产品边界或掩盖告警，不采用。

路径只遍历并删除尾部的 `/` 与 `\\`；全部由分隔符组成时沿用原回退，其他 realpath、符号链接、根包含和拒绝顺序原样保留。W3 从最后一个 `@` 拆分路径与 ref，ref 长度必须恰为 40 且仅含十六进制字符，路径至少 owner/repo 两段且各段非空、不含 `@` 或空白。合法 action、子目录 action、可复用 workflow 和原有 `./` 豁免继续成立；畸形空段和额外 `@` 失败闭合。

两处 UI 测试增加大写、混合大小写、换行、tab 的恶意输入，危险标签断言采用大小写不敏感匹配并覆盖空白及闭合分隔。继续断言转义文本实际存在，防止仅隐藏内容得到假绿。#7/#8 在本计划记录误报理由，保留原测试行为，不自动 dismiss。

## Global Constraints

文件集合：`packages/providers/development-local-git/src/paths.ts`、`scripts/workflow-check.mjs`、`tests/integration/development-local-git.test.js`、`tests/contract/workflow-check.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/contract/ui-work-item-list.test.js`、`docs/development/ci.md`、`docs/README.md` 与本计划（验收后移入 completed）。不新增依赖、公共接口、workflow、数据迁移或事实所有者。代码与文档分别保持仓库规模上限。

所有操作在分支 `fix/code-scanning-hardening` 的 `.worktrees/code-scanning-hardening` 根目录执行，Git 操作使用 argv；允许根与目标已规范化 realpath，未经过符号链接。用户明确要求工作区位于仓库 `.worktrees/`，因此采用支持该位置的 Git worktree 创建方式。

## Plan of Work

### Batch 1 · 有界拒绝与安全断言闭环

**最小闭环**：四条可行动告警的根因修复、回归验证、误报处置依据与一个独立可回滚 PR。

**涉及文件**：上述集合内的两个实现入口与对应回归；文件全集仅由 Global Constraints 维护。

先提交计划并创建 draft PR 关联 #617；再先写两个子进程有界回归，确认旧路径函数与旧 workflow 校验分别超时判红。路径回归在子进程内构造三十万分隔符；workflow 回归使用八十组路径分隔加错误 SHA，分别经过 step 与可复用 job 入口。补合法引用与畸形引用矩阵，以及路径尾部/根的保真断言。随后实现线性逻辑，扩充两处 UI 断言，并通过生产代码突变验证这些断言能拒绝不安全 HTML 输出。

**验证**：在本分支工作树根运行以下命令，原始输出放 `.superpowers/code-scanning-hardening/`。这些命令也定义最终验收，不在别处复制。

    pnpm install --frozen-lockfile
    pnpm test:file tests/contract/workflow-check.test.js tests/integration/development-local-git.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-list.test.js
    node scripts/review-mutate.mjs .superpowers/code-scanning-hardening/mutations.json
    pnpm verify
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

预期：旧实现在新增有界测试中失败；最终窄测、完整验证与机械检查退出 0，变异被对应测试杀死且文件完整恢复。独立子评审检查无 P0/P1 未解决项。最终 push 后用 `gh pr view 618 -R SingularityKChen/harness-projects --json baseRefName,headRefOid,isDraft,closingIssuesReferences,mergeStateStatus,statusCheckRollup` 与 GraphQL reviewThreads 回读，期望 base main、head 等于本地 HEAD、关联 #617、所有相关 checks 成功且无未解决阻塞意见，再将 draft 标 ready。ready 后再次回读。不得合并。

**回滚**：发布前保留工作树修正；发布后若需要整理提交，先建立 backup ref，仅用远端精确旧 head lease 更新本任务分支。合入后可整体 revert 本 PR；无持久数据或外部业务状态需回退。

## Validation and Acceptance

Batch 1 的回归应证明恶意输入能在有界进程内完成且结果为类型化拒绝/W3，而合法路径与引用仍被接受。安全断言应同时检测危险标签变体和保留正确转义结果。完整本地验证、独立评审、最终远端 head 与 required check 为 Ready 依据；未合并扫描告警状态和人类产品/R1 接受单独保持。

## Progress

- [x] (2026-11-11 11:43 SGT) 完成告警复现，创建并回读 Issue #617，建立隔离分支及安装依赖。
- [x] (2026-11-11 11:54 SGT) 提交计划并创建 draft PR #618，回读 base main、head 与 closing issue #617；相关基线 153 项通过。
- [x] (2026-11-11 11:54 SGT) 旧实现的三个有界入口均超时，两个畸形引用矩阵失败；修复后相关 159 项通过。调整新增用例注册位置后，六项变异整表均 KILLED 且按原文字节恢复。
- [x] (2026-11-11 12:01 SGT) Batch 1：在实现候选 `24fcd6e5` 完成完整验证：typecheck 与契约 1558、集成 2187、E2E 226 项全部通过，0 失败/取消/跳过；边界 9 项和 7 份 workflow 检查通过。
- [x] (2026-11-11 12:01 SGT) 独立子评审审读全部差异，未发现 P0–P3 可行动项；独立聚焦 12 项通过，97,656 个短路径样本保真检查通过；归档实现计划。提交整理、最终 push 和 Ready 回读继续受 Batch 1 发布门约束。

## Surprises & Discoveries

扫描的 most_recent_instance 可能保留旧 commit；使用 analysis SARIF 与当前源码逐文件比较确认告警仍适用，不能仅依据告警首次创建时间判定已过期。依赖安装复用锁文件并退出 0，提示 esbuild 构建脚本未获准执行；目前未改变此安装策略。

宿主通用计划 lint 要求本仓库规范未列出的 Concrete Steps 与 Artifacts and Notes，首次执行退出 1。按根 `PLANS.md` 的 13 个固定章节检查本计划，不追加重复章节；这不是实现或测试失败。

新增路径用例最初注册在其他能力夹具的顶层 await 之前；名称筛选时先运行完这两项，after 清理可能抢先删除后续初始化使用的目录。首轮筛选变异基线因此退出 2，结论未采纳。将用例移到能力夹具初始化之后，最终筛选基线及六项变异通过；没有修改产品初始化或放宽超时。

首次创建 Issue 时漏加与标题 area 对应的 `area:repo`，草稿的 Issue policy 失败；补齐标签并回读后，`node scripts/policy-check.mjs pr 618` 返回 conforms。未改变标题校验规则。

## Decision Log

- Decision：2026-11-11 用户在本评审会话直接点名 PR#618–621，并授权无 P0/P1（或只有 P2/P3）时由本会话完成修复、独立复评、归档、提交整理、issue 核对与 `merge_method=rebase` 合并；该条件明确覆盖 #618。Rationale：原实施阶段禁止自行合并的约束由这条直接条件授权更新；Planning Status/原生依赖不在授权内。Date/Author：2026-11-11 / 用户、主审。

- Decision：用户原话“创建一个Issue，并开始实现流程进行修复、提交 PR”授权 #617 的创建、实现、提交与 PR；沿用已给出的四条行动项与两条误报处置。Rationale：范围明确且可逆，不重复确认。Date/Author：2026-11-11 11:43 SGT / 用户、实现者。
- Decision：采用显式线性处理与完整入口的有界子进程回归。Rationale：消除回溯根因，测试不依赖源码快照或脆弱的毫秒阈值。Date/Author：2026-11-11 11:43 SGT / 实现者。
- Decision：Issue/PR 外部写入 actor 为 SingularityKChen，目标为本仓库 GitHub 管理面；不涉及产品 ProviderBinding。Issue 幂等定位为已存在的 #617 与本任务分支，后续更新同一对象。Rationale：保留写入目标、关联及结果，避免重复创建。Date/Author：2026-11-11 11:43 SGT / 实现者。

## Idempotence and Recovery

测试与检查均可重跑，子进程有五秒上限，临时 fixture 在 finally/t.after 中清理。变异工具负责字节级恢复，不与同一文件的编辑并行。Issue 与 PR 通过既有编号更新。历史整理先 backup，恢复比较 tree 与远端 lease；保留其他分支和工作区，不清理无关内容。

## Interfaces and Dependencies

使用仓库 Node/pnpm、内置文件系统与子进程 API、现有 yaml 解析器、gh 与已认证开发账号。只改变私有校验逻辑和测试；不新增包依赖或跨层反向依赖。W3 的失败仍为 finding，路径失败仍为 WorktreePathResolution，不抛新的裸错误。

## Outcomes & Retrospective

实现候选 `24fcd6e5` 通过完整本地验证与独立审读，两个正则回溯根因被移除，两个 HTML 负向断言已补强。六项变异覆盖旧路径正则、尾部分隔符保留、旧 workflow 正则、畸形路径误放行，以及详情/列表的混合大小写脚本输出，均由对应具名测试 KILLED。原始日志与 spec 位于本工作树 `.superpowers/code-scanning-hardening/`，不是发布产物。

本计划归档时工程实现验收已完成；PR #618 的最新 head、托管 checks、CodeQL 结果与 Ready 状态属于后续发布回读，按 Batch 1 的命令取得，不能使用旧计划提交的绿色检查替代。最终提交只整理同一修复与文档；若源代码变化，必须重新验证和独立复评。人工五类公开面检查应在最终 push 前与机械扫描共同完成。

未发现需要延期的技术债；#7/#8 是已说明用途的误报，不是延期修复项。没有新增完整 GitHub uses 语法/仓库存在性校验，本地 `./` 豁免属于原有 W3 职责边界。未执行告警关闭、合并或规划字段更新；人类评审和 R1 接受保持独立。

## Bottom Change Note

2026-11-11 11:43 SGT：建立计划，记录授权、根因、取舍、文件边界、有界回归、公开面与恢复路径。

2026-11-11 11:54 SGT：记录 draft、TDD 红绿、测试注册修正与最终六项变异归因，保留完整验证及独立评审门。

2026-11-11 12:01 SGT：记录完整本地验证、独立审读和作用域边界，归档工程实现计划；保留当前 head 的 Ready 发布门。

2026-11-11：追加本轮直接条件收尾授权；独立评审证据保存在本 PR 自己工作树的 review 记录，实施计划继续保留 completed。
