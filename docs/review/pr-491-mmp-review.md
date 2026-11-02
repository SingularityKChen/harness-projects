# PR #491 · 详情创建与重载恢复 MMP 评审

## Purpose / Big Picture

从工作项详情显式创建PR；Provider丢ack或整个成功回复丢失后，真正浏览器reload及Host/SQLite/Connection重建的新peer仍能找到原操作、无需重输原输入且不产生第二次mutation。确认文案服从当前读数。

## Context and Orientation

直接依赖PR #495，native stack #496。原单PR规格经两独立设计与独立综合细化为后端/HostUI两个闭环。完整独立初评 `3ecb6e7` 发现两个P1和一个P2；主要修复 `05ac0d6` 复评关闭原项、发现权限提示P2；最终 `5ac032f90fed9cc650b583106321bafcdf122255` 在 `.worktrees/pr491-reload-review` 窄复评零残留。正式规格为 `docs/exec-plan/completed/2026-11-02-pull-request-detail-creation.md`。

## Design / Spec

详情先纯本地query，none才开放新意图；未决或当前Saved展示最小原操作摘要、显式resume，不重造actor/key/body。loading/拒绝/非当前目标优先于缓存结果；仅最新同id/stamp且Saved/currentTarget的view支撑当前确认。合法none允许下一目标。Host沿可信peer位置ABI，最后await纯query再次验证；Core拥有唯一刷新，onConfirmed只读既有投影。严格枚举先typeof string。

## Global Constraints

本层只有Host/client/UI与其测试；后端单一状态机和SQL由#495拥有。代码技术对象542行，最终文档规模按直接base重算，严格<800/<1300；不改Planning Status/native blocking。不把loopback carrier或确定transport当installed Host人工UAT/live GitHub/R1。

## Plan of Work

保留原两个Host case和Unknown重建病例；补query-first/乱序/迟到/末尾窗口及当前产物；独立全矩阵发现后修原边界，真实Saved全成功回复丢失/新peer浏览器验证；最后权限说明窄修、独立回归/因果变异，再由协调者整理与发布。

## Validation and Acceptance

| 层 | 核对 | 最终技术结论 |
|---|---|---|
| 代码 | query/resume严格decode、单飞、owner代数、lookup排序 | PASS |
| 产品 | Unknown及Saved整回复全丢、无需重输、真实reload/newpeer、权限恢复 | PASS |
| 架构 | Host最后当前view、Core唯一刷新、无原输入browser缓存或第二权威 | PASS |
| 测试 | 原Host两case完整、actualtarget/auth窗口、正式变异、当前包操作 | PASS |
| 工作项 | #437完整详情闭环、父#494独立后端、规模/回滚边界 | PASS；最终远端与人工门另行回读 |

初评P1：Saved全成功回复丢失时scope返回none，后端修为全未决+当前Saved的完整合格并集；P1：最新target失效仍显示旧确认，修为当前view约束；P2：数组enum被String强转接纳，改primitive string；最后P2：合法none遮住failed权限说明，实际Host403回归窄修。全部因果反例已闭合。

## Progress

- [x] (2026-11-02 SGT) 独立设计/综合及范围细化，原覆盖逐项保留。
- [x] (2026-11-02 SGT) 原3独立反例、5补充探针、42窄回归最终GREEN。
- [x] (2026-11-02 SGT) 六关键guard变异与末轮权限局部变异按各自source有效KILLED并逐字恢复。
- [x] (2026-11-02 SGT) 两种真实Chromium故障路径、当前包与四能力组合验证通过。

## Surprises & Discoveries

Provider丢ack的Unknown证据不能覆盖Host成功Saved后整个回复丢失。浏览器reload不一定改变peer，故另外真正dispose Host/关闭重开SQLite并接纳peer-B。后续新事实必须撤下旧确认；合法none仍允许新目标，但不能吞掉当前失败的权限说明。

## Decision Log

2026-11-02：独立复核后纳入当前Saved发现，历史Saved不阻挡下一目标、全并集歧义拒绝first/latest；不新增历史平台或浏览器存储。确认与错误文案按最新query/当前结果顺序呈现，不以第二刷新修UI。核心guards未变的末轮权限修复只做窄复评，不冒称重跑旧形式化表。

## Idempotence and Recovery

resume结构无create分支，原身份/正文由Host持久事实拥有。回滚本层入口保留后端API、durable receipt、远端PR及用户数据，不重发原mutation。本层无SQL变化；若连父层回退，遵父层当前物理CHECK的停用/完整备份/匹配reader约束，不自动清库。

## Interfaces and Dependencies

Host query/resume使用现可信peer注入与位置参数；client creator提供operation/submit/resume，reader维持纯读。operation摘要只有id/state/targetStamp/head/base/title/currentTarget，不含actor/key/body/marker。DeliveryLineageSection确认回调仅load(false)，当前PR freshness由父层实际最终集合决定，UI消费lineageStale不重算。

## Outcomes & Retrospective

最终独立SPEC/QUALITY均PASS、P0–P3零残留。05ac0d6的124项含当前artifact与六正式变异全通过，5ac032f上原3反例+5补充+42永久窄回归+typecheck通过，权限分支回退变异由真实Host403用例killedBy击败。两轮文件均按字节恢复、tracked tree干净。

Saved Chromium录制绑定05ac0d6：actualHost先confirmed/receiptSaved再销毁整HTTP回复；reload无输入恢复原摘要；Host与SQLite真正重建、peer-A→B再reload仍得原摘要；显式resume才显示确认。createRPC1/resumeRPC1/mutation1，整个Saved attempt前后深度相同（含原creator/fingerprint/key/空格换行Unicode正文/marker/ref）；resume后只有getProjection与operationQuery，没有二次refresh。原Unknown录制绑定28307cf并单列，不混称最新录制。

协调者在 `test/iteration9-final-acceptance@4e70656` 运行 `pnpm verify` 为3020+7、边界9、当前组合产物/Host/谱系80项，零失败/跳过/取消。合并唯一共享start-work冲突经一谓词差异证明后保留#490完整实现。最终归并后本层current-head重新pack与artifact验证，以PR最终观察值为准，不复用05ac旧digest。

最终push后读取PR #491的当前head/base、必需checks、双向关闭引用和分页全部线程，通过才Ready；不自行merge，不提前关闭issue。真实GitHub写入、installed Desktop人工UAT、#143/#449及R1未由这些确定证据建立。无新增接受延期债务。

## Bottom Change Note

2026-11-02：归档累计全矩阵及四项因果修复、独立窄复评和真实浏览器证据，保留精确source/产物与人工门边界。
