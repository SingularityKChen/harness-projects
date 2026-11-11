# 真实来源日期投影与统一详情 ExecPlan

> 状态：Completed（来源能力独立验收通过；最终远端门禁以PR回读为准）
> 创建：2026-11-11；格式依据：根 `PLANS.md`。
> Issue：#606；检出：`feature/source-schedule`；初始基线：`main@063e427a`。

## Purpose / Big Picture

用户在唯一详情读到来源目标日和所属迭代窗口；SQLite关闭重开、wire/client往返后原值仍在，清空/撤权同次消失。它在Timeline之前独立可用；不从迭代成员关系编造任务工期。

## Context and Orientation

NativePlanningFieldValue已含iteration startDate/durationDays；`packages/core/src/planning-fields.ts`丢为title，SQLite workspace_projection仅三展示列。controller/client已透传PlanningFieldsSnapshot；ui-model详情从同一安全row取值，并有二次遮蔽门。现有planning_field_value没有生产Core消费者，不能假定它自动持久日期。#606是#147的Core叶子；#607将消费本契约。

## Design / Spec

两份独立方案经第三位独立评审收敛：在现有PlanningFieldsSnapshot加可选iterationStartDate:string、iterationDurationDays:number，与已有iterationTitle/targetDate同投影/UPSERT/revision/整行撤回。SQLite当前002基线加两nullable列，generation3→4；不新增历史迁移步骤、backfill或兼容层。**这是schema变动**：issue的“不为日期schema migration”按更高优先级用户未发布无需旧数据迁移兼容指令解释为禁升级程序。现行旧shape/generation拒绝并保留字节，新shape重开；不实际触碰用户DB。

拒绝激活unused原生字段表的替代：它需新增replace端口、双adapter、bootstrap集合替换、查询重建及revision职责；两列保留唯一事实owner且预算更小。不用观察ledger/内存补日期，不把JSON塞title。

共享Gregorian date-only工具接受0001–9999，保留原字符串，不转成本地Instant；安全整数duration，窗口内部[start,start+duration)，文字末日start+duration-1，duration0保留“零天，无可画区间”；最后一日9999-12-31单日合法，非法/溢出不进几何。安全ui-model的schedule target/iteration独立可共存，各自missing/invalid/zero明确；没有能力证据只说来源未提供可用排期。不造当前无Producer的任务range。详情复制同safe row并保留二次redaction，无新编辑器。

## Global Constraints

每PR技术新增＋删除严格小于800行，文档小于1300行，含测试、fixture、配置与删除；按实际base计量，不以net抵扣。保持Host权威、单Planning源、规划/工程正交、授权撤回、事务/revision与ack/reconcile。无正式发布兼容层、自动迁移/删库、真实安装或模型调用。只操作临时测试数据；不写Planning Status、Iteration或原生依赖。依赖及主题沿当前Host，不引入新库。

写集：`packages/domain/src/planning-fields.ts`、新`calendar-date.ts`与按需index；`packages/core/src/planning-fields.ts`；SQLite `migrations/002_identity_membership.sql`、`src/storage.ts`、`storage-rows.ts`、`migrate.ts`；ui-model `work-item-list-view.ts`、`work-item-detail-view.ts`与ui `work-item-detail.ts`；现有planning-fields/storage-baseline-admission/migration-runner及详情安全测试、新calendar契约；本计划与docs索引。独立验收修复扩展最小写集：`packages/providers/planning-github-projects/src/decode.ts`、现有 Provider mapping 契约与真实日期重开集成用例，用同一 domain 日历规则取代 Producer 的重复校验。额外写集为 `tests/contract/ui-safe-markdown.test.js` 共用详情 fixture、`ui-work-item-list-view.test.js` 浏览器安全出口白名单及 `tests/integration/identity-membership-schema.test.js` 两个来源日期列的显式安全审查，及 `tests/e2e/status-policy.test.js` 的 refresh 初始/刷新后精确字段预期，均由新契约必然带动。托管浏览器门禁修复的额外写集仅 `tests/browser/detail-expand.test.js`，用具名字段与非空值验收替代固定总行数，保留全部实际行的几何约束。无需无语义的wire/client改动。技术工作上限740、docs220–350。

## Plan of Work

### Batch 1 · 唯一日期事实的持久链

最小闭环是mapped原生窗口经SQLite重开和当前安全详情可读。先扩真实GitHub replay→Core→文件SQLite重开红例，再加domain/Core字段、基线两列及白名单读写。补仅窗口变化revision推进/同值不变、field ID与project隔离、清空/遮蔽/撤权/旧轮不能恢复日期。当前生产decoder非法值仍fail closed。再将安全schedule随同一row进入详情。

在检出`feature/source-schedule`的工作树根运行：

    pnpm test:file tests/contract/calendar-date.test.js tests/integration/planning-fields.test.js tests/integration/storage-baseline-admission.test.js tests/integration/migration-runner.test.js tests/integration/ui-work-item-detail-read.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js
    pnpm typecheck
    pnpm boundaries
    pnpm verify

期望：初始真实重开窗口缺失RED；最终全绿。calendar在TZ=UTC与America/Los_Angeles等值，覆盖闰年/0001/9999/0/溢出。旧完整shape@3、伪装0/4拒绝，临时文件hash及逻辑行不变；新基线@4重开成功。回滚撤销能力；数据库不自动降级/迁移/删库。

### Batch 2 · 独立对抗验收与交付

浏览器门禁回归在同一检出运行 `pnpm test:file tests/browser/detail-expand.test.js`，再运行 `pnpm test:browser` 完整层；固定行数失配须先本地 RED，不以仅改 7→8 或放宽几何阈值交付。

独立验收者攻击真实reopen、旧shape无改动、日期算术和撤权。冻结schema/safe schedule接口后通知Timeline owner；后续修改下层须同步stack并重验接口消费者。

## Validation and Acceptance

真实目标日与迭代窗口同时保留，来源及“非任务工期”清楚；无日期/invalid/zero诚实。SQLite重开、同scope修订与安全撤回有判别证据；新旧shape准入保持无自动数据改写。使用Batch 1命令，不把局部UI绿代替持久链。#599安装/R1仍独立。

## Progress

- [x] (2026-11-11) 托管 Browser 回归：本地先复现 `8 !== 7`（0/1 RED），修具名字段/非空值验收；详情浏览器文件 10/10、完整 `pnpm test:browser` 107/107 及 typecheck 通过。远端门禁等待最终 head 推送后回读，不沿用本地结论。

- [x] (2026-11-11 14:41 SGT) 完成当前Project/PR取证、两份独立设计及第三位独立修订，建立隔离检出。
- [x] (2026-11-11) Batch 1：draft #620 后真实重开 RED→GREEN；Core/SQLite/日历/safe schedule/详情已实现，241 个定向测试通过；最终 `pnpm verify` 的 contract 1558、integration 2190、E2E 226 全通过。
- [x] (2026-11-11) Batch 2 独立验收修复：真实 Producer 的 0001/0099 反例先 RED，复用 domain 日历校验后最窄 97/97 与严格跨链探针 GREEN；fresh `pnpm verify` 退出 0：typecheck、contract 1560/1560、integration 2193/2193、E2E 226/226。
- [x] (2026-11-11) Batch 2：独立复评在 `d842078d` 接受完整工程闭环，唯一P2已修复；原strict反例和15项定向验证通过。最终提交整理、远端门禁与Ready由同一交付流程回读。

## Surprises & Discoveries

托管 run `42981069742` 的 Browser lane 在 `3e1c5f69` 为 106/107：窄屏 200% metadata 用例硬编码七个 `dd`，实际新增所属迭代窗口后为八个，`8 !== 7` 导致 PR Fast Gate 红。此前本地 `pnpm verify` 不含 browser 层，完整 107 项 Browser 验证遗漏；本地定向复现同一 RED（0/1）后，改为每个具名字段恰出现一次、所有实际值有语义标签且非空，新增窗口缺值文案也直接验证。所有实际 `dd` 继续执行原宽度、字形溢出、高度和列对齐断言，无产品改动或阈值放宽。

独立验收在 `97947f72` 用录制仅替换日期的反例证明：0100/9999 可跨真实 Producer→SQLite 重开→wire/client/detail，0001/0099 却 unavailable；严格探针退出 1。补入正式集成用例后同样 0/2 RED；Producer 共用 domain 校验后 97/97 与严格探针通过，0000 的 target/iteration 均仍拒绝。早先“完整日期域闭环”的判断由本轮真实来源证据替代。

真实 GitHub replay→文件 SQLite 重开初次失败，明确缺 `iterationStartDate`/`iterationDurationDays`。新实现定向 241/241 通过；原旧 shape 在 generation 0/3/4 拒绝后逻辑和文件 SHA-256 不变。首轮 `pnpm verify` 的 18 个契约失败来自新增必需 schedule 后手工详情 fixture 缺字段（17）与 `/values` 精确白名单（1）；补两处测试输入/白名单，未添加兼容 fallback，最终第四轮完整复跑已全绿。

基线检出`feature/source-schedule`的planning-fields/安全list/detail/board定向46/46通过。已确认仅修改TS会被SQLite三列白名单静默丢弃；现有原生字段表无生产Core读写。

## Decision Log

- Decision：2026-11-11 用户在本评审会话直接点名 PR#618–621，并授权无 P0/P1（或只有 P2/P3）时由本会话完成修复、独立复评、归档、提交整理、issue 核对与 `merge_method=rebase` 合并；该条件明确覆盖 #620。Rationale：原实施阶段禁止自行合并的约束由这条直接条件授权更新；Planning Status/原生依赖不在授权内。Date/Author：2026-11-11 / 用户、主审。

2026-11-11 / Browser CI 修复：元数据保护针对必需字段和全部真实几何，不针对固定总行数；仅改浏览器测试，不改已验收的日历/schedule/Host/Timeline 接口。Completed 计划就地追加门禁修复证据，不重建过时 Active 计划。

2026-11-11 / 独立验收修复：Producer 使用 `Date.UTC` 将 0001–0099 重映到 1901–1999，导致合法来源整次 unavailable；原先仅 helper 的低年测试不足以证明来源闭环。扩展 Provider decoder 与既有测试写集，统一使用 `calendarDateToDay`，删除重复 DATE_ONLY/Date.UTC 算法；target 与 iteration startDate 继续经过同一个 dateOnly，无年份特判/兼容层，calendar/safe schedule 对外接口不变。

选择两原子列与generation4，明确承认schema变化；理由是未发布、用户不需旧设计/旧数据迁移兼容，现有准入已安全拒旧，比激活多责任原生集合更小。无升级/真实DB操作。记录日期/作者：2026-11-11 14:41 SGT / 协调者，第三位独立评审裁决后执行。

## Idempotence and Recovery

新临时库建库与重复同步可重跑；同值不增revision，值清空整行覆盖。旧shape拒绝后用户数据保持，程序不备份迁移/删除。回滚代码不降级generation4数据库，需用户明确决定新位置重建。若真实数据迁移成为必要，停止该路径并重新细化。

## Interfaces and Dependencies

冻结接口：domain 根与 `/values` 导出 `calendarDateToDay`、`calendarDayToDate`、`calendarIterationWindow`；日序数从 0001-01-01=0 起。窗口右界 exclusive，末日文字 inclusive，零天没有 endDate。安全 item row 的 `schedule:SourceSchedule` 含独立 target（missing/invalid/date）与 iteration（missing/invalid/zero/window）两槽，详情直接复制；redacted 无字段。#607 按此消费。

使用仓库Node/pnpm/Git/gh及现有Host ABI。GitHub写入以当前认证actor、同仓issue/PR和Project条目为目标；幂等键为issue编号＋分支，创建前查询已有PR，写后回读结果。机械回填ExecPlan/Batch、分类、负责人和既有milestone；Status与依赖由人类拥有。draft后TDD，最终push后读取head/base/checks、双向issue关联及完整review threads，当前head验证通过才Ready；人类决定合并。

公开检查在本计划指定检出的工作树根执行：`node scripts/rule-checks.mjs disclosure <base>`、`node scripts/rule-checks.mjs size <base>`、`git diff --check <base>...HEAD`，另人工核查凭据、本机身份、个人信息、内部系统、保密内容。最终提交整理为可独立理解/回滚的Conventional Commits；已推送改写先backup ref，再精确lease。

## Outcomes & Retrospective

托管 Browser 修复轮在 `feature/source-schedule`、修复基线 `3e1c5f69` 的工作树根运行：`pnpm test:file tests/browser/detail-expand.test.js` 10/10、`pnpm test:browser` 107/107、`pnpm typecheck` 退出 0。仅测试断言与本计划变化；所有实际元数据行（含新增窗口）仍经原几何保护，无阈值放宽。托管 run 的既有失败保留，最终远端 checks 仍须最终 push 后回读。

初轮实现在 `97947f72` 的证据如下；完整日期域判断已由上文 P2 修复替代。在 `feature/source-schedule` 工作树根当轮运行 `pnpm verify`：typecheck 通过，contract 1558/1558、integration 2190/2190、E2E 226/226，共 3974 项通过。`pnpm boundaries`、`node scripts/workflow-check.mjs`、发布面扫描及 diff 检查通过。第二轮 Host 生命周期时间断言 195ms 超过 160ms；本检出窄跑与基线 `063e427a` 单例复跑均通过，最终整仓也通过，保留历史失败而不宣称基线已复现。

修复轮在同一检出运行最窄 Provider/日期链 97/97、严格跨链探针（含 39996 oracle 比较）与 fresh `pnpm verify`（typecheck、1560 contract、2193 integration、226 E2E，共 3979）均通过；boundaries 9/9、workflow-check 无 findings。

独立复评在 `d842078d` 接受完整工程闭环，唯一P2已解决；原严格跨链反例与15项定向测试通过，未机械重复旧shape hash或全量测试。最终head/base/checks/双向issue/review threads按Interfaces的规则回读；源能力完成不替代安装、人类或R1接受。无新增延期技术债。

## Bottom Change Note

2026-11-11：托管Browser的固定元数据行数断言改为具名语义字段与所有实际值的可读性保护；完整107项通过。独立scoped复评接受，真实12场景及四项合成断言负控通过；产品代码没有变化，最终托管状态继续按当前head回读。

2026-11-11：追加托管 Browser 门禁失败、本地复现与语义断言根因修复，补此前遗漏的完整浏览器层验证；不改产品接口或重开计划。

2026-11-11：独立复评接受后归档；将必然随动的测试写集合并回唯一Global Constraints，整理为完整能力提交，最终远端状态保留可执行回读而非写死历史check值。

2026-11-11：按独立验收 P2 扩展唯一来源校验写集并记录 RED→GREEN；固定修复基线为 `97947f72bdcef8c9f531defcf42e158bddabc175`，生产公开接口保持冻结，等待新 head scoped 复评。

2026-11-11：实现完成，冻结接口已供 #607 消费；补充日期字段按 Project/field id 隔离、仅窗口变化 revision、清空后旧轮拒绝及真实 wire/client 详情证据。独立评审、远端当前 head 回读及 Ready 由协调者继续，本检出保持 Active 至验收。

2026-11-11 14:41 SGT：从两份独立方案及第三位修订形成首版，自包含约束/接口/验证与恢复路径；用户已授权必要时采用下一迭代内容并持续交付。

2026-11-11：追加本轮直接条件收尾授权；独立评审证据保存在本 PR 自己工作树的 review 记录，实施计划继续保留 completed。
