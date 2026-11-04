# 停机备份与产物回滚演练 ExecPlan

> 状态：Completed；创建：2026-11-04；执行分支：`docs/backup-rollback-rehearsal`。
> 范围：工程子 issue #532 的流程与实际 sandbox 演练；Refs 父 #369、#73、#459。
> 依照根 `PLANS.md` 维护；PR 只 `Closes #532`，`Refs #369`、`Refs #73`、`Refs #459`；父项保留人类 R1-12 裁决。

## Purpose / Big Picture

维护者能在明确停止写入之后备份当前 profile 数据库，核对匹配的旧 tgz，回滚插件，再恢复数据库并从真实安装的产品读回原工作项和执行上下文。发生失败时可以返回保留的原件，用户仓库、分支、工作树和已发生的外部事实不被删除或假装撤销。

最小成功证据是一次官方固定 Web profile 的真实安装演练：非空工作项、context/run 和真实本地工作树，在备份→不同字节旧产物回滚→恢复之后保持身份与状态；记录 Host/source/artifact/schema 身份、实际步骤、读回和局限。文档测试、source Host fixture 或改版本文字不能代替实际安装。

## Context and Orientation

事实：`docs/product/demo-install.md` 固定官方 `@deepseek-ai/dsh@0.2.0-rc.2` Web profile、`DSH_HOME` 与 Documents overlay；当前数据库是 `profileContext.dir/harness-projects/workspace.sqlite`，worktrees 与 diagnostics 归同一插件数据目录。旧根不会自动迁移。

事实：`packages/storage/sqlite/src/migrate.ts` 对非空数据库执行当前 generation/schema/ledger 准入；不支持降级。`host-providers.ts` 将 Local Git allowedRoot 绑定到原 profile 数据根，持久 context 的 worktree handle 与 credential issuer 也有原身份。换目录能查到行不等于接管执行成功。

硬约束：父 #369 第三 AC 要求人类在 #73 判断条件12。假设：可取得两份同 Host ABI、同持久 schema/profile 语义而源码/产物字节不同的候选。未知：现有环境能否在官方 Web 安装中读取非空生产数据并生成真实 Local Git + 人工备用；Batch 1 只为解决这一个可行性问题。Superseded by Outcomes & Retrospective 的实际官方实装与非空读回结果（2026-11-04）。

技术依据：SQLite Backup API 会生成一致快照；选停机后通过 Python sqlite3 backup，而非复制可能缺 WAL 的活动主文件。备份目标不存在且为空路径，失败保留源文件。原始 SQLite sidecars、配置和用户 Git 状态另外归档，不把它们盲目混回恢复库。

## Design / Spec

比较三案：在线直接 cp 主文件存在 sidecar/写入不确定性，拒绝；加自动备份服务/逆向迁移超过需求且引入维护面，拒绝；选择停机、SQLite backup API、匹配产物、同一专用 sandbox 原路径恢复。新目录仅核验备份或隔离原件，不宣称跨 profile 执行迁移。

同一专用 scratch 内保存 current/rollback tgz、manifest、两份 hash 清单、原始数据隔离件及 backup。rollback tgz 必须由精确旧 source 构建或取得已知摘要；不能给同一包改名/改版本冒充。两个包先核对 schema、配置、Host ABI；旧包若拒绝当前库，记录失败并改选确实匹配的配对，禁止改 user_version 或删库。

非空正控通过真实安装产品路径建立：只读既有规划 Project，绑定专用临时 Git 仓库，显式启用执行，固定 issuer，设置主启动明确失败开关，实际 Start Work 进入人工备用；模型 create/prompt 为零。若需要合成规划数据，必须经生产 Storage/生产 catalog 记录并明确 synthetic，再由实际安装 Host 读回；fixture catalog 不进入 tgz。

备份前等待所有命令结束，停止该 profile 的 Host 与辅助写入者；用启动器 PID、退出结果、`lsof` 及核对数据文件的只读检查证明无 writer，不把关浏览器当停机。若无法可靠确认 writer，停止该步，不覆盖任何目标。

备份保存数据库逻辑快照、generation/schema/实体身份摘要、artifact SHA256、配置/目录清单；secret 仍留原 credential 服务。恢复前把当前库及 sidecars 隔离保留，确保同一 original dataPath，复制核验过的独立 backup 为新主库，禁止将旧 sidecars 附到新快照。旧产物只做读回，不自动 resume/cancel 已发生 run。

## Global Constraints

评审收尾写集扩展：`docs/review/pr-535-mmp-review.md`与本计划的最终评审/授权记录；不改变原能力范围。

唯一写集：`docs/development/backup-rollback.md`；`docs/development/backup-rollback-rehearsal.md`；`docs/product/demo-install.md` 的一个短回链；`docs/architecture/release-gates.md` 条件12的单一链接；本计划。release-evidence owner 不编辑 release-gates；`docs/README.md` 由协调者串行维护。

代码/test/config A+D=0；文档含计划、演练记录和评审目标 650–1050、硬限1300。无产品脚本/备份自动化、依赖、迁移或兼容层。临时采集器只留忽略的运行目录；不为 Markdown 内容写镜像测试。

只操作新建 sandbox 的明确 realpath，拒绝 `..`、逃逸及未允许符号链接；不改常用 profile、全局工具、用户仓库或远端状态。备份不能声称恢复 credential 值、外部会话或平台对象。公开文档不含本机绝对路径、token、session URL、账号个人数据。

## Plan of Work

### Batch 1 · 最小可行性与产物配对

最小闭环：可实际安装一对可读同一合法库的不同 tgz，并有非空列表/context。主文件是流程初稿与本计划。先读 demo-install，构建当前候选；已定位旧源码候选`f5ae377d`及其tgz，七份migrations与当前一致；实现者仍需确认profile/Host ABI与非空读回。记录精确source/tree、包SHA256和ABI，不把migration相同自动叫已知良好。

在检出 `docs/backup-rollback-rehearsal` 的工作树根运行：

    pnpm --filter @harness-projects/app-harness-plugin pack:plugin
    shasum -a 256 apps/harness-plugin/dist/harness-projects-app-harness-plugin-0.1.0-demo.1.tgz
    pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-demo-artifact.test.js tests/integration/storage-baseline-admission.test.js
    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh --version

期望 pack/真实包合同通过、Host 输出 `0.2.0-rc.2`。执行记录中的 current/rollback 变量必须由已核验 manifest 解析为绝对路径；不存在文件、相同摘要或 schema/ABI 未确认即拒绝。

按 `docs/product/demo-install.md`“使用干净的 Web profile 安装”命令新建 scratch、设置 DSH_HOME、Documents overlay、dump-config核对，再执行下面的安装/启动。`HP_REHEARSAL_CURRENT`、`HP_REHEARSAL_ROLLBACK`、`HP_REHEARSAL_PATCH`、`HP_REHEARSAL_DB` 是本次 manifest 解析且 realpath 核对后的值：

    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web add "$HP_REHEARSAL_CURRENT"
    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_REHEARSAL_PATCH" --no-open --port 0

期望真实侧栏/产品 reader 非空，并创建真实 Local Git worktree 与人工备用 run。只读规划凭据经原 credentials 服务/子进程环境提供，不打印或写 manifest；issuer复用同一稳定值。一个启动/配对尝试后若关键前提不能满足，记录精确阻塞并保持该工程子项未完成，不把 source fixture 作为替代通过。回滚为停止本 sandbox，保留产物和原库。

### Batch 2 · 停机备份、产物回滚与原路径恢复

最小闭环：实际四步演练后从产品 reader 读回原 ID。主文件是流程和演练记录。先记录工作项/context/run/intent ID、状态、worktree realpath/分支头/用户文件摘要；停止并确认所有 writer 退出。SQLite source以 URI mode=ro 打开，backup 到不存在目标，关闭后只读做 integrity/FK/generation/schema/身份核验；备份文件和原件分别有摘要。

对 manifest 解析的 `HP_REHEARSAL_DB`、`HP_REHEARSAL_BACKUP`，流程正文应给出可复制 Python sqlite3 backup/restore 命令，断言源存在、目标不存在、路径在本次根内，并使用 `sqlite3.Connection.backup`。先在隔离副本做损坏、错generation、已存在目标负控，全部在接触原路径前失败；生产 schema准入负控复用现有 storage 测试，不改元数据骗准入。

按原 profile 执行：

    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web remove @harness-projects/app-harness-plugin
    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh plugin --profile web add "$HP_REHEARSAL_ROLLBACK"
    npx --yes --package @deepseek-ai/dsh@0.2.0-rc.2 dsh web --patch "$HP_REHEARSAL_PATCH" --no-open --port 0

期望 dump-config/安装文件 hash 证明实际旧包生效。只读核对旧包读到匹配库；随后再次停机，隔离保留当前库/sidecars，在原 dataPath 恢复核验快照并启动匹配包。产品列表/context/run读回同 ID/状态，Git worktree登记/用户文件未变，零新 run/外部执行。最后可用同 remove/add 流程恢复 current 包再次只读核对。

每步失败都记录实际输出与“未完成”；不能因 backup PR 是文档就跳过真实操作。回滚为停止 sandbox、恢复已核验 current tgz 与保留的原数据配对；工作树原地保留，不依赖破坏性清理。

### Batch 3 · 独立操作审读与公开记录

最小闭环：未参与作者可按文档判断每个成功与拒绝条件。主文件为演练记录、短回链和本计划。独立验收者对照 raw evidence 核对 artifact/source/schema/Host、停机、四步顺序、产品读回和用户文件；区分实际安装、合成种子、局部测试、人类裁决。

在同一分支根运行：

    pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/storage-restart.test.js tests/integration/harness-plugin-demo-artifact.test.js
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望合同通过、链接指向真实文件、公开面机械与五类人工检查通过、文档 A+D≤1300。合同通过不替代安装演练；缺四步读回则保持 Draft。最终 push 后回读 exact head/base/checks/issue/threads才 Ready，请人类评审并在 #73 判断 R1-12。回滚为独立 revert 文档，不删除证据或用户数据。

## Validation and Acceptance

| 名称 | 通过条件 | 负控或证据边界 |
|---|---|---|
| Official installed pair | 固定官方 Web Host，两个不同字节匹配包，实际安装文件与摘要相符 | 仅 source composition、重命名同包、版本文字均不通过 |
| Offline backup | 全部writer退出，非空一致快照，integrity/FK/schema与ID核验通过 | writer不明、已有目标、缺失/损坏文件必须停止 |
| Artifact rollback | 实际remove/add旧tgz并在原profile读回 | 不兼容schema/ABI明确拒绝，不降级元数据、不删库 |
| Restore | 原dataPath恢复独立快照，产品列表/context/run同ID同状态 | 新profile行查询不叫执行接管；错路径不通过 |
| Git and external facts | 原worktree/分支/文件摘要未变；无新run/模型调用 | DB时间倒退不代表已接纳外部事实消失 |
| Human R1-12 | 仅人类在#73裁决 | 本工程子项与Ready均不关闭父#369/#73 |

## Progress

- [x] (2026-11-04 14:42 SGT) 完整阅读两份独立设计、当前安装指南和存储/Host路径合同，完成第三方综审。
- [x] (2026-11-04 14:42 SGT) 协调者已创建#532并原生关联父#369；此时尚未完成Draft和演练。Superseded by 本节后续实际演练记录（2026-11-04）。
- [x] (2026-11-04 15:04 SGT) Batch 1：Draft #535已关联#532；官方固定Web真实安装，非synthetic Project读取316项，UI Start Work创建真实Git worktree与人工备用run。
- [x] (2026-11-04 15:16 SGT) Batch 2：实际停机Backup API、旧tgz实装、原dataPath恢复、旧包与当前包产品reader/浏览器读回；六个负控拒绝，ID/状态/Git/用户文件不变。
- [x] (2026-11-04 16:02 SGT) Batch 3：实现者已完成脱敏流程与记录、本地公开面/文档命令核验（194+179合同用例均无skip；正文两段命令原样执行通过）；独立验收、exact-head CI与Ready由协调者接续，人类R1-12仍独立。

## Surprises & Discoveries

两份设计对“新profile恢复”有分歧；当前 allowedRoot 与持久worktree handle绑定原数据根，credentials issuer也不在库内，因此本计划采用专用sandbox原路径恢复。新位置只读核验不提升为迁移或继续执行证据。

安装指南已有历史安装/卸载记录，但没有本候选完整四步演练；历史摘要不能沿用。配对旧包若有已知执行缺陷，只做明确只读回滚验证，不能宣称可继续执行或称其已知良好。

首次设置曾长时间pending，正常停止并重启原profile后先读回executionInstalled，再读规划与绑定仓库；第二轮有typed请求/响应记录，Start Work confirmed。首次无请求级抓包，不认定产品根因，也不称全程无障碍安装。细节与局限见`docs/development/backup-rollback-rehearsal.md`。

相同版本号的两包实际字节不同；每轮12安装文件均与各自tgz匹配。恢复后context/run记录及未提交用户文件逐阶段相同。没有新兼容/迁移代码或备份自动化。

## Decision Log

Decision：停机后SQLite backup API、原sandbox profile恢复、原库/sidecars隔离保留。Rationale：一致快照与路径/issuer身份要分别成立，避免活动文件copy或跨根执行接管。Date/Author：2026-11-04 14:42 SGT / 独立设计综审。

Decision：PR只Closes #532、Refs父#369/#73/#459；工程子项只关闭流程与真实演练。Rationale：原AC明确区分准备记录与条件12裁决。Date/Author：2026-11-04 14:42 SGT / 独立设计综审。

Decision：第一轮设置pending后有界停止同profile，不重复Start Work或覆盖数据；重启先读自然键配置，再继续独立Git正控。Rationale：保留未知与已发生事实，实际产品读回可恢复设置但不据此清除未归因观察。Date/Author：2026-11-04 15:04 SGT / 实现者。

Decision：演练issuer只生成一次，驻控制进程内存并经宿主环境凭据适配跨所有重启复用；未复制secret存储或输出其值。Rationale：只验证本次固定身份配对，不声称数据库备份恢复了凭据或控制进程结束后的继续执行。Date/Author：2026-11-04 15:16 SGT / 实现者。

## Idempotence and Recovery

每次演练新建scratch与不存在的backup目标，禁止覆盖已有备份；重跑在新目录，保留失败样本。生产Git操作用argv/library并核对根；外部已发生事实只读，恢复后不自动续跑。

任一步失败先停Host，保留已知配对tgz、原库及sidecars、backup与manifest。恢复到原profile且确认安装和DB身份后才重新打开。清理由人类确认范围，默认保留sandbox原件与工作树供复核；不删库“修复”。

## Interfaces and Dependencies

依赖固定官方CLI、Node/pnpm、Python sqlite3、Git、平台可用的lsof、真实tgz和现有credentials服务。运行态manifest/日志/截图放`.superpowers/`，公开记录只保留脱敏摘要；session地址不进入文档。

缺凭据、官方包获取失败、非空产品读回或匹配产物对不可用是工程阻塞；记录可复现错误而非宣称演练通过。不新增backup服务或产品导入入口。独立验收者复核步骤，最终人类判断R1。

## Outcomes & Retrospective

当前已实际完成官方Web安装、非空正控、停机备份、不同字节旧包回滚、原profile恢复及换回当前包；独立产品reader与浏览器分别读回相同上下文。artifact/source/schema/步骤/负控和局限均在`docs/development/backup-rollback-rehearsal.md`自包含记录。

初轮194个产物/基线合同通过；流程正文两段Python命令从Markdown原样提取，在独立副本执行均退出0。首次设置pending与残留unknown提示是未归因观察，交协调者独立分诊；遵守唯一写集，不在本PR暗改产品或共享债务表。独立验收及最终head/CI/Ready尚由协调者接续（Superseded by 本节工程验收收敛，2026-11-04 16:02 SGT），#369/#73人类条件12未判定。

### 工程验收收敛（2026-11-04 16:02 SGT）

在本分支工作树根，以已独立验收的capability 01ce70722c898eed22493fd6c04d4b17c1496132 回读PR #535：必需PR Fast Gate与实际Verify、Browser、Merge Gate执行lane通过，issue关联及全部review threads已核对，远端已为Ready。独立验收原样执行公开命令、八个拒绝负控及179个恢复/产物合同；实际官方Web与原profile恢复证据成立。首次pending/unknown未归因观察保留，人类条件12、Desktop与凭据备份未判定。

归档只改文档；相对该capability的所有非docs文件不变。最终文档head按 gh pr view 535 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences 及 gh pr checks 535 -R SingularityKChen/harness-projects --required 回读，期望Ready且所需检查通过，不沿用历史head绿灯。没有新引入维护债；原产品和人工门仍由其issue拥有。

## Bottom Change Note

2026-11-04 14:42 SGT：依据两份独立设计与综审建立初版；明确官方Web真实安装、小型可行性、不同字节匹配产物、停机API备份、原profile恢复与人类门禁。

2026-11-04 15:16 SGT：更新实际官方Web演练、同路径恢复与六类负控结果；保留设置pending观察、临时issuer边界和独立验收待办，不提升为R1裁决。

2026-11-04 15:22 SGT：补记本地合同与正文命令通过、原生workspace registry隔离；通用技能lint的章节schema不适配，按仓库PLANS的13节逐条核验。独立验收仍由协调者安排。

2026-11-04 16:02 SGT：独立验收、capability托管门禁与Ready后归档；最终文档head继续回读，不改变产品代码或人类判定。

2026-11-04：本会话用户明确对PR #534/#535/#536/#541给出无P0/P1且独立复评通过后的rebase merge条件授权；本PR完整矩阵无新增P0–P3，初始APPROVE已由评审账号提交。原三个过程提交将整理为一个能力提交，备份ref与精确lease保留恢复路径。评审记录随本PR交付；最终head的checks/threads/issue关联仍须重新回读，不沿用初始head批准。
