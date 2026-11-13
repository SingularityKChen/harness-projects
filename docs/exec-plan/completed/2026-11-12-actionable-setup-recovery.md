# 启动与设置恢复引导 ExecPlan

> 状态：Completed（源码修复、迁移与实装读回完成；最终Ready按当前head门执行）
> 创建：2026-11-12
> Issue：#626
> 范围：可执行的恢复提示，以及用户明确授权的当前库副本迁移与原路径切换。

## Purpose / Big Picture

用户遇到插件启动或设置读取失败时，能知道下一步做什么，不被虚假的草稿/保存声明和无意义重试误导。本次同时把明确获准的旧库内容安全带入当前基线，保留配置、实体、执行历史和现有 Git 工作树位置。源码修复、私有迁移实证、人类视觉接受与 R1 分别记录。

## Context and Orientation

在 `fix/actionable-setup-recovery` 的 `.worktrees/actionable-setup-recovery` 根目录执行。起始产品基线 `main@29947425ba0174fe83c73f2ee8df3e29ea12429d`。最终发布前main并发前进至 `518cc6f7a9ff418b81f1020a60e5525b6f10d199`，当前目标基线为generation5；原generation3→4实证保留，后续接合见Batch3。用户提供的实装截图显示旧库拒绝和首次设置读取失败；只读检查旧库为 generation3，当前为4，完整表/约束差异另在本批私有审计中核对，不只改代际号。

关键入口：`packages/storage/sqlite/src/migrate.ts` 在 Host composition 成功前拒绝不兼容库，`apps/harness-plugin/src/host.ts` 之后才注册 typed remote，因此真正冷启动可能没有产品面板。`packages/ui-model/src/workspace-setup.ts` 拥有安全错误展示；`packages/ui/src/workspace-setup.ts` 拥有当前页输入和恢复操作。现有客户端只保留安全错误，不回显 Provider 原文。

## Design / Spec

比较三种方案。A补齐现有固定安全文案、当前页恢复说明和明确的重新读取动作；B在 remote 注入前另挂启动面板；C新增独立健康RPC。选A：直接覆盖截图已证实的缺口，不扩大公开接口、生命周期或权威状态。B/C涉及冷启动贡献与新的通信合同，本轮不引入。

首次读取失败必须明确未读到宿主设置、不能确认已有工作区，先检查宿主插件启动错误再重新读取；已有快照的读取失败不得把旧快照说成新确认。按钮“重新读取设置”只读，不调用 create/connect/install/reconcile。读取失败不能推断数据库不兼容。保留 connectionFailure 三种已证实原因的优先级；其余错误码给固定安全说明。当前 scope 真有编辑过的 name/project 时才说“本页输入仍保留，尚未确认保存”，不宣称持久保存。

数据库启动错误保留 code/reason/expected/actual/action 合同，说明原库保留、停机备份、保留数据走显式迁移或匹配旧版、新空库是另一个选择，并指向现有恢复文档。文档明确不要搬动整个数据目录/现有worktrees、不改 user_version 骗过准入；提供可操作的桌面定位、备份与恢复步骤。静态帮助链接只打开文档，不冒充宿主设置或一键迁移能力。

本次个人库迁移是受控运维动作：严格匹配实际源schema，按当前SQL初始化新候选，在副本逐表复制所有既有列及必要rowid，新增无已证实来源事实的nullable列保持NULL。保全全表逻辑摘要、原有列、对象关系、配置/上下文/run/意图及Git现场；做完整当前准入、integrity/FK、真实reader验证。任何丢行、键变化、私有JSON不可消费、锁定/副作用或未知schema都阻止切换。原文件和匹配旧包保留作回滚锚点；不增加自动迁移或通用历史兼容。

## Global Constraints

产品/文档写集：`packages/ui-model/src/workspace-setup.ts`、`packages/ui/src/workspace-setup.ts`、`packages/storage/sqlite/src/migrate.ts`、`packages/capabilities/src/storage.ts` 与必需的PR操作core/client/UI文件、相关既有 contract/integration/browser 测试、`docs/product/demo-install.md`、`docs/development/backup-rollback.md`、本计划、`docs/README.md` 及本批review记录。只为上述独有风险补最小判别测试，目标技术gross小于800，硬上限1000/1500。

个人数据库、副本、原始截图和迁移日志只保存在本机受限私有目录；不进Git、PR、公开日志。Git工作区与用户worktrees不迁移、不删除，规划Status/原生依赖不写。只有主审切换个人库；其他agent只读原库或写隔离副本。修复前先建draft PR关联同仓Issue，最后独立复评与当前head门；新PR未经本会话明确合并授权保持Ready未合并。

## Plan of Work

### Batch 1 · 恢复引导

提交计划与draft PR；先用真实setup source/SSR和窄交互证明首次失败假草稿、generic Retry无具体引导，再实现最小固定文案与语义正确按钮。保护真实输入、scope变更、unknown执行纯读、精细连接原因和canary安全边界。更新已有恢复文档，不新增伪操作按钮。

### Batch 2 · 显式迁移与实装恢复

停止/禁用当前插件的数据打开者，验证不存在打开描述符后用SQLite Backup API保存独立快照，并保留源文件/sidecar摘要与Git定位信息。在当前schema候选上逐表复制，独立审计全表保全与目标reader；候选错误保持原库不动。独立验收通过后，把旧主库及sidecar归档到不存在目录，原dataPath发布0600候选；保留原worktrees路径。重新用产品开库/只读读数核对现有工作区与历史，不启动旧unknown操作或新模型。

**验证**：在本工作树执行 `pnpm install --frozen-lockfile`；`pnpm test:file tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-connect-diagnostics.test.js tests/integration/storage-baseline-admission.test.js tests/integration/harness-plugin-host-lifetime.test.js`；`pnpm typecheck`；`pnpm run boundaries`；对应设置Browser及真实plugin artifact验证；若改变持久化/Host/安全合同则扩大 `pnpm verify`。最终 `node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD` 及Markdown链接存在性必须通过。实际命令日志放本批忽略目录，私有库校验只输出摘要/计数。

**回滚**：产品按能力提交revert；已发布分支整理前backup ref+精确lease。切换前失败丢弃候选即可；切换后停用打开者，校验旧快照与匹配旧包，再恢复至原dataPath，不混用新旧WAL。原库归档和新候选都保留。

### Batch 3 · 最新基线接合

最终发布回读发现 #623/#625 已合入main，generation4→5只替换观察版本派生视图，24表/列/约束/索引相同。修复分支重放到实际main，历史合同/UX代码逐字保持；旧generation4原件及独立Backup API快照另存。使用当前7SQL构建新候选，全表所有值/类型/rowid/JSON完全复制，0行转换；旧新视图主体version双向EXCEPT为0，公共carrier合同、全部reader和历史禁写验证通过后才切。新包12文件逐字核对，实际库原路径再切generation5，保留3/4所有回滚锚点。

本次接合 `pnpm verify` 为1568/2243/226，共4037通过；安装件54项、最终串行Browser110项通过。首次新基线Browser109/110在Host acquisition发生一次HostAuthorityError；原权限源码未改，窄1/1、全文件6/6、纯观察1/1及最终整层110/110复跑通过，缺当时child诊断不能确认为超时或直接归类环境，原失败如实保留。独立最新接合259项和9项竞态反例通过。

## Validation and Acceptance

首次读取拒绝有明确原因边界和纯读下一步，未编辑时不声称保留草稿；已编辑失败输入仍在，raw异常/路径/secret canary不外泄。generation拒绝继续安全保留数据和无remote发布，错误及文档可以指导操作。迁移须全表旧列/rowid保全、FK/integrity/current准入/真实reader同时通过，原工作树位置与已有执行身份不变。本轮不把工程接受当成人类视觉或R1通过。

## Progress

- [x] 2026-11-12：发布前接合实际main518的generation5，4037 verify/54 artifact/110最终串行Browser通过；24表全值/类型/rowid/JSON保全，25组reader、11组真实history/API和9权限竞态通过，停机备份4、安装12文件核对和4→5原路径切换完成。原3/4库及独立备份/匹配包都保留；真实Harness可打开原列表及规划连接，来源不完整状态如实保留。

- [x] 2026-11-12：创建并回读Issue #626，确认两个原始症状，建立本任务隔离工作树。
- [x] 2026-11-12：独立设计复现首次失败假草稿和无行动说明；确定不增加RPC的最小方案。
- [x] 2026-11-12：UX TDD 6项RED后33/33 GREEN，相关36项、数据库准入157项通过；两位独立复核纯读/草稿/cause边界。
- [x] 2026-11-12：补齐可执行Desktop备份模板并从Markdown原样提取，正控及打开者/悬空sidecar/可写根/lsof错误负控通过；实际旧库独立备份全表含rowid/schema摘要相等且FK/integrity通过，原件未改。
- [x] 2026-11-12：完整verify：typecheck、1568 contract、2251 integration、226 E2E，共4045通过；历史撤权P1用7永久反例修复并经9项独立竞态复评接受，候选全部reader及11组零Provider/网络/数据库写入反证通过。
- [x] 2026-11-12：Browser最终110/110、安装件54/54通过；独立复评已接受，公开面与远端发布门按最终提交回读。
- [x] 2026-11-12：旧库完整审计和结构候选保全通过；当前decoder发现旧saved PR receipt缺新字段并触发停止切换。
- [x] 2026-11-12：显式只读历史合同及副本全部reader/身份保全/零写入门通过；已停机备份、安装固定候选并逐字核对12文件，原路径切换generation4。归档原库与独立备份保留，未知状态及Git位置不变；实际Harness已显示非空原列表、宿主连接与来源读取确认，原规划连接可读。
- [x] 2026-11-12：工程计划归档；本轮整合为一个能力提交，最终push后只以当前head checks/全部线程/双向issue及Ready回读作为发布门，不预写远端结果。

## Surprises & Discoveries

首轮完整verify因连接诊断集成仍匹配旧generic文案而失败，按11码新语义更新相应期望，不删除cause/无泄漏/零写入断言。独立历史收据复核又发现最后lineage异步读取期间撤权仍返回history，候选因此继续隔离；新增精确撤权反例并修返回前的读准入围栏后再复评。

旧库24表/既有rowid、committed view、FK/integrity可在当前结构候选全部保全，但旧saved createChangeRequest缺issueSelection。独立核对旧canonical与原fingerprint/body marker/confirmed identity全部匹配。补造selection会改变指纹语义；单纯schema通过仍不可切换。采用显式requestFormat标记的独立已确认历史收据变体，只读投影，禁止进入finish/settle/observe及任何创建/负责人写口；未标记缺字段和非saved继续拒绝。未知执行保持原状态。

原库除了generation差异还有早于当前的source-number投影形状；只加排期字段或只改user_version不成立。Host开库失败早于remote注册，不能从普通unavailable推断具体数据库原因；静态帮助必须同时覆盖宿主启动错误出口。

## Decision Log

- Decision：2026-11-13 用户直接要求按流程评审 PR #627；无 P0/P1 或仅 P2/P3 时由本会话修复、复评并 rebase merge。Rationale：这是本 PR 的具体条件合并授权，覆盖原计划保留未合并的边界；不改变 #599/R1 或 Planning Status。评审证据见 `docs/review/pr-627-mmp-review.md` 的本轮独立矩阵。Date/Author：2026-11-13 / 用户、主审。

- Decision：增加闭合的旧版已确认PR历史收据变体，仅用于本次显式迁移；原fingerprint/body/marker/key/refs不改。Rationale：当前decoder不能读取这条合法历史，必须以独立history分支零写入保留，而不是伪造新选择或重发请求。副本current decoder及直接API零写入反证未通过前禁止切库。Date/Author：2026-11-12 / 主审、独立审计/设计者。

- Decision：用户原话“创建 Issue，修复。然后帮我做库的迁移”明确授权创建同仓Issue、修复与当前个人库的显式迁移。Rationale：本次保留数据的授权覆盖此前仅能提供手动新库/旧版路径的边界；不授权自动启动迁移、删除用户数据、模型执行、规划Status或新PR合并。Date/Author：2026-11-12 / 用户、主审。
- Decision：采用方案A，保留现有生命周期与严格数据准入。Rationale：真实冷启动只能经宿主错误出口；新增健康服务不是修复这两处引导的必要条件。Date/Author：2026-11-12 / 主审、独立设计者。
- Decision：所有外部写入使用SingularityKChen；目标本仓库GitHub管理面，同一#626/本分支幂等更新，不涉及产品ProviderBinding。评审使用gh-review；Status/原生依赖不写。Date/Author：2026-11-12 / 主审。
- Decision：本任务按根约定使用仓库内.worktrees位置，通用native创建器不提供自定义路径参数，因此用已规范化允许根的Git argv创建，不创建额外平行检出。Date/Author：2026-11-12 / 主审。

## Idempotence and Recovery

读测和副本审计可重复；备份/候选/归档目标必须不存在，不覆盖旧证据。个人库操作前后再次核对原路径、owner/type/nlink与打开者，发生并发变化停止。已归档旧库不改写，切换失败保持插件停用；回滚用经核对的独立备份和匹配安装包。Git恢复锚点与数据恢复锚点分别保管。

## Interfaces and Dependencies

现有Node/pnpm/React/SQLite/Host peer，保持既有RPC及ProjectError/recovery枚举；仅为显式迁移保留旧已确认PR引入闭合的只读history摘要；无新增npm依赖。当前表结构以当前7份SQL和migrate准入为唯一目标。临时迁移工具只处理审计过的明确源/目标schema，不进入Host自动执行路径。

## Outcomes & Retrospective

最终结果以Batch3为准：generation5候选已在原路径发布，所有表数据完全保全、0额外JSON转换；严格准入和25组生产reader/carrier检查通过，原unknown run/attempt仍各一条。已安装的固定候选源码为923718af，实际12文件与tarball相同。真实Harness已加载原非空列表和原规划连接，来源读取确认/不完整随实际刷新变化，不把暂存/不完整状态说成人类接受。最终文档整合不改变此候选产品对象；最终PR未合并。

Superseded by Progress 的2026-11-12修复与候选验证记录。原计划创建时仅完成复现/设计，当前产品修复、副本全部门、原路径切换和实际Harness非空列表/设置读回均已完成；原库及独立备份保留，未重发原未知执行、改外部PR或移动Git工作树。原始截图及数据库材料按私有运维证据保管。后续每批只记录实际通过或失败及独立审计结论；不预写用户数据切换成功或安装接受。

## Bottom Change Note

2026-11-12：建立自包含计划，记录用户显式迁移授权、两类恢复缺陷、Host可达性边界、最小方案、验证和数据恢复门。

2026-11-12：纳入结构保全后发现的旧已确认PR协议差异，记录停止切换和最小只读history方案；公开文档明确备份、迁移与新建空库的边界。

2026-11-12：记录UX与备份实证、整体验证旧文案期望失败和历史收据撤权反例，保持切库门未通过前原件不变。

2026-11-12：记录4045项完整verify、历史撤权P1修复及独立复评、候选v2所有数据/reader和零写入门；私有库切换尚未执行。

2026-11-12：记录最终4045/110/54本地证据、私有库原路径切换与实际Harness读回；固定候选源码9cdfce67和tarball摘要由私有receipt保管，最终仅文档整理且产品对象逐一保持。归档计划，保留新PR的人类评审/合并门。

2026-11-12：最终main并发升为generation5后新增Batch3，记录已审最新接合、第二次无行变换迁移、一次Host acquisition初始失败与最终复跑、实际安装/库和UI结果；原3→4记录作为历史保留。

2026-11-13：记录本 PR 条件合并授权及三路独立复核，计划保持归档；当前产品树无新缺陷，最终远端门与合并结果按回读取得。
