# 持久化规划字段映射并恢复到 Host ExecPlan

> 状态：Completed · MMP 意见修复与独立复评通过，等待最终远端回读与授权合并
> 创建：2026-10-26
> 范围：issue #277；一个工作区的映射配置、有限默认派生、重启恢复与来源展示。
> 上游输入：issue #277、`docs/exec-plan/completed/2026-10-05-project-field-read.md`；按根 `PLANS.md` 维护。

## Purpose / Big Picture

用户连接 GitHub Project 后，约定字段可以自动显示规范状态、迭代和目标日期；重启 Host 不会丢失已经确认的映射。列表明确写出“字段映射：自动派生”或“字段映射：用户配置”。最小证明是在同一 SQLite 文件上重开两次 Host，字段重命名和定义读取失败后仍使用原 ID 映射，且没有任何 Provider 写调用。

## Context and Orientation

Planning Provider 报告原生字段值；Core 只按 `WorkspacePlanningFieldMapping` 中的字段 ID、选项 ID 投影，不负责猜名称。`packages/core/src/planning-fields.ts` 已有形状校验和纯投影。`apps/harness-plugin/src/host-composition.ts` 尚未传映射，工作区只有三字段记录。

2026-10-26 在 `origin/main@d470308` 观察到：`createContext()` 每次组装会重新 `putWorkspace(workspaceRecord(...))`，后者只保留 id/name/statusPolicy。把 mapping 直接加到 WorkspaceRecord 而不修所有写者，会被普通装配覆盖。配置独立于规划投影，其保存不推进 projection revision。

本 PR 基于 main，在分支 `feature/planning-field-mapping`、工作树 `.worktrees/planning-field-mapping` 根执行。开始前用 `git rev-parse HEAD`、`git status --short --branch` 回读真实状态；基线回归由协调者于上述 head 观察通过 1927+7 项，只是基线，不能记为本功能完成证据。

## Design / Spec

方案 A：独立工作区映射记录，Host 负责读取/有限派生，Core 继续消费显式 ID。方案 B：WorkspaceRecord 增 JSON 列并修全部 upsert 写者。选择 A：两份独立设计均推荐，避免把账号绑定自然键、工作区创建与未来 chooser 的更新语义耦合。方案 C 每次开机重新按名派生会随重命名漂移，舍弃。

增加 `WorkspacePlanningMappingRecord={workspaceId,bindingId,projectExternalId,origin,mapping}`，`origin` 只能是 `derived|user`，mapping 沿用现有 domain 类型。`Storage.getWorkspacePlanningMapping(workspaceId)` 和 `putWorkspacePlanningMapping(record)` 是唯一持久入口；SQLite 与 fake 都做闭集校验、深拷贝，并要求 workspace 及其 planning 挂载存在。记录按 workspace 唯一，不能跨 binding/project 套用。

把现有 mapping 形状校验移到 domain 纯模块并供 Core/Storage 共用，保持原校验语义；不复制两份 validator。SQLite 在 `002_identity_membership.sql` 原位加配置表，按首发前规则增加 shape guard：旧库明确拒绝、零自动删库、零隐式升级。重建必须由使用者决定。

`loadPlanningMapping()` 先查当前 binding/project 的记录。有记录直接使用，不请求字段定义；记录 scope 不匹配时拒绝套用并记录安全诊断，仍允许无映射降级。无记录才经 Planning read lifetime 调 `listFieldDefinitions(projectRef)`；projectRef 来自该挂载已存 `projectNodeId`，不靠条目发现，因此空 Project 也能派生。

派生词表固定为逐字匹配、区分大小写、无 trim/fuzzy：唯一且 kind 正确的 `Status`→single_select、`Iteration`→iteration、`Target date` 或 `Target Date`→date。两个日期别名同时出现也属歧义。Status options 只识别 `Todo→todo`、`In Progress→in_progress`、`Done→done`；同名重复选项不映射，其他选项 unknown。名称是本产品默认策略，绝非平台的语义保证。

字段读失败或没有任何明确角色时不持久空 mapping，下次组装可重试。部分明确角色可持久；后续增加角色由 #358 显式选择，不按开机时名称重新猜。派生后在一个事务内重查，已有 user 记录优先；调用方不能用迟到派生覆盖它。

Host 将相同 mapping 与 origin 传给 Core；Core 仅把 origin 放入已有 planningSource 读数，wire/client 闭集接受 `mappingOrigin?: derived|user`，ui-model 生成来源短文本，UI 在来源旁显示。没有 mapping 时字段缺席。chooser、规划写入与 #273 状态政策不在本 PR。

外部写入规则：本功能只读 Provider；测试把所有 Provider 写方法设成 throw spy。记录中的 actor 是 Host 的 `system` 配置发现动作，target 是当前 workspace/planning ProviderBinding，幂等身份是 workspace+binding+project；本地 SQLite commit 是配置确认，不能伪造 Provider ack/reconcile 或 Saved。

官方依据已于 2026-10-26 通过 HTTP 读取：SQLite `https://www.sqlite.org/lang_transaction.html` 说明显式事务的 commit/rollback 边界；它不提供跨装配原子性。项目字段 ID/名称的具体合同以本仓库 Provider 类型和录制夹具为直接依据，默认词表是本计划决定。

## Global Constraints

代码加测试严格小于 800 行，文档严格小于 1300 行；预算生产/模式约 300、测试约 300、文档约 180。统计新增与删除，锁文件及生成物按仓规排除；先减少重复转换和测试装置，不能删重启、并发 user 优先或零写入证据。

唯一文件集合：`packages/domain/src/planning-fields.ts`；`packages/capabilities/src/storage.ts`、`registry.ts`；`packages/core/src/planning-fields.ts`、`context.ts`、`queries.ts`；`packages/storage/sqlite/migrations/002_identity_membership.sql`、`src/storage.ts`、`storage-rows.ts`、`storage-sync.ts`；`packages/providers/fake/src/storage.ts`、`state.ts`；`host-composition.ts`；`packages/controller/src/wire.ts`；`packages/client/src/workspace-read.ts`；`packages/ui-model/src/work-item-list-view.ts`；`packages/ui/src/work-item-list.ts`；`tests/contract/suites/storage.js`；`tests/integration/harness-plugin-host-planning-mapping.test.js`（新增）；`tests/integration/execution-relation-write-schema.test.js`、`tests/integration/planning-fields.test.js`、`tests/contract/storage-contract.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/contract/ui-work-item-list-view.test.js`；`docs/README.md`；`docs/review/pr-401-mmp-review.md`；本计划。

Host 文件只有一个 owner；#354 等本 PR 接线完成后顺序修改。#131 的 UI 设置页和 #140 的执行 Provider 可并行，但不得编辑此文件集合。凭据仅句柄；不改变 Status、blocked-by/blocking，不冻结新的数据模型版本。

## Plan of Work

### Batch 1 · 配置持久化合同

**最小闭环**：两个 Storage 都能在普通工作区写入及重启后保留 scoped mapping。
**涉及文件**：`packages/capabilities/src/storage.ts`、`packages/storage/sqlite/src/storage.ts`、`tests/contract/suites/storage.js`。
先写 RED：配置读写后普通 putWorkspace；SQLite close/reopen；输入/返回对象修改；非法 origin/mapping/scope；事务回滚。先运行新增用例，确认因缺入口或配置丢失而失败，再实现共享校验、两个存储和 schema guard 至 GREEN。旧 schema 拒绝不能写入版本或半张表。

    pnpm run test:file tests/contract/storage-contract.test.js tests/integration/storage-restart.test.js
    pnpm run typecheck

期望：新用例先失败、实现后全部 pass，零意外 throw，重开后的配置逐字相同。回滚本批新表读写及端口；保留原 SQLite 文件，不能自动降级或删除。

### Batch 2 · Host 默认发现与重启

**最小闭环**：没有配置的真实 GitHub Provider 回放完成有限派生，重启复用同一 ID。
**涉及文件**：`apps/harness-plugin/src/host-composition.ts`、`tests/integration/harness-plugin-host-planning-mapping.test.js`。
RED 案例：字段/选项乱序、重复名称、错 kind、未知选项；已存 user 完全跳过 definitions；定义失败不存空值；派生等待时 user 保存成功；重启后字段改名且 definitions 不可用；普通 compose 未擦配置；所有 Provider 写 spy 为零。实现 helper、scope 检查及唯一装配调用至 GREEN。

    pnpm run test:file tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/planning-fields.test.js

期望：status/iteration/date 和 origin 重开后不变，歧义保持 unknown，零 Provider writes。失败恢复先停 Host，保留文件与诊断；同配置可重跑，禁止删除用户配置“修复”测试。

### Batch 3 · 来源展示与独立交付

**最小闭环**：真实 baseline→client→列表明确区分 derived/user，未配置仍保持既有展示。
**涉及文件**：`packages/controller/src/wire.ts`、`packages/client/src/workspace-read.ts`、`packages/ui/src/work-item-list.ts`。
先写端到端来源文本和非法 origin 拒绝测试，再沿已有 planningSource 做薄透传；不建立第二份 mapping store。保留 Core“不按名称归一”的原测试，派生只在 Host。

    pnpm run test:file tests/integration/harness-plugin-host-planning-mapping.test.js tests/contract/ui-work-item-list-view.test.js
    pnpm run boundaries
    pnpm verify
    git diff --check

期望：所有命令 exit 0；完整回归只在最终 head 跑一次，有新失败才扩大重跑。回滚整个 PR 恢复原无映射装配；配置表是本地数据，保留而不触碰外部项目。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 同 SQLite 文件两次 Host 装配得到同 mapping | Batch 2 的重启用例，definition 读取失败也不重派生 |
| 默认来自字段定义且显示 derived | Batch 2 的乱序/歧义断言 + Batch 3 真实读链文本 |
| user 配置优先且不被 compose 擦除 | 两存储共享合同与派生竞争用例 |
| 永不调用 Provider write | 全路径 throw spies，调用数为 0 |
| 不改变规划语义及 scope | 既有 planning-fields/status-policy 回归；外来 scope 不套用 |
| 独立可合并/回滚 | 相对真实 base 的 code+test <800、doc <1300，单 issue，回滚不需外部补偿 |

提交/PR 阶段在本分支根运行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`，再人工核查凭据、本机身份、账号个人信息、内部系统、保密字样。脚本仓规阈值更宽，另人工核对本轮严格预算。未提交文件另用 `git diff --no-index /dev/null <文件>` 检查。最终 push 后用 `gh pr view -R SingularityKChen/harness-projects <实际PR号>` 和 `gh pr checks -R SingularityKChen/harness-projects <实际PR号>` 回读当前 head/base、issue 关联、checks 和全部 review threads；通过后才 ready，人类决定合并。

## Progress

- [x] 2026-10-26 MMP：过期 Active 抬头已订正；独立复评 231/231、最终 4/4 变异精确 KILLED，无新增发现。

- [x] (2026-10-26 16:32 +08) 读完两份独立设计、现有存储/装配/投影源码，选定独立记录与有限默认；文件集合见 Global Constraints。
- [x] (2026-10-26) Batch 1：缺少映射端口的 RED 为 153 pass / 4 fail；实现后 Storage + restart 为 157/157。追加卸载一致性 RED（fake 遗留映射）及非法快照导入 RED（缺失异常），GREEN 已纳入最窄回归。
- [x] (2026-10-26) Batch 2：Host 断言得到未持久映射、缺失 user origin 与真实回放无字段投影的 RED；Host + planning-fields GREEN 20/20，覆盖重启、竞争、降级与零 Provider 写。
- [x] (2026-10-26) Batch 3 本地实现：真实 client→ui-model→列表 SSR 来源文本与非法 origin 拒绝通过；最终八文件回归 244/244，原 boundaries 9/9，`pnpm verify` 的 typecheck、完整测试 1941/1941 与 MVP 7/7 通过。
- [x] (2026-10-26) 首轮独立对抗验收 PASS，P0/P1 为 0；所发现 P2 的 fake 重复 workspace 配置导入缺口已安排本轮修复。
- [x] (2026-10-26) 修复波次最终：新增反例 1/1、独立反例 5/5、原八文件窄回归加新用例 245/245、typecheck exit 0、原 boundaries 9/9、`pnpm verify` 完整测试 1942/1942 与 MVP 7/7，diff 空白检查通过。
- [x] (2026-10-26 17:17 +08) scoped 复评 PASS：245/245 与 5/5，全部发现关闭；本地闭环完成并归档。PR #401 的当前 head、checks、ready 与人类评审属于下述发布回读门禁。

## Surprises & Discoveries

`createContext()` 三字段 upsert 会覆盖 WorkspaceRecord 扩展，这是选择独立表的直接反例。既有字段读夹具有自定义 `E1 Iteration/E1 Date`，不满足默认词表时应保持未映射，不能为了让夹具变绿扩大词表。

SQLite 原位改写不代表自动迁移；现有 `assert002Shape()` 是旧库拒绝机制，新增表必须在首次读前纳入该判据。新增 schema 守卫已由旧库拒绝用例验证，版本表与既有数据不改。

最窄六文件回归已执行 216/216。首次 boundaries 发现新增 Host helper 未列入现有 `HOST_ENTRY.files`；这是文件级登记缺口，不是新依赖边。临时登记已撤销。按评审规则把 helper 放入现有 Host 装配文件，不修改边界矩阵。首轮完整回归为 1937 pass / 3 fail：新增表未进入两份 schema 库存、约束缺出处注释。更新 Global Constraints 的 schema 库存测试并补逐约束 issue #277 注释，不改断言规则。

独立对抗验收复现：fake 快照可导入同 workspace 的 derived 与 user 两行，读取按数组顺序遮蔽 user；SQLite 主键不允许此状态。新增合同真实 RED 为 `Missing expected exception (RangeError)`。构造时以 workspaceId Set 拒绝重复后 GREEN；相同配置重复同样拒绝，不自动选择或合并。

## Decision Log

D1 · 2026-10-26 16:32 +08 / 独立计划评审者：独立 scoped mapping 记录。Rationale：隔离配置更新，避免 Core 普通工作区写入覆盖；两个候选均已审查。

D2 · 同时 / 独立计划评审者：精确英文词表、部分明确角色可保存、origin 经已有来源链显示。Rationale：可解释且稳定；不把产品默认升级为平台保证，不引入 chooser。

D3 · 同时 / 独立计划评审者：#277→#354→#131，#140 独立；这是实现顺序，不是获批的看板依赖写入。Rationale：最少共享 Host 文件栈，所有规划字段仍由人类拥有。

D4 · 2026-10-26 / 实现 owner：将新 helper 登记到既有 Host 文件例外。Rationale：真实 boundaries 拒绝其 capabilities 类型 import；只补文件名，不扩大允许依赖集合。Superseded by D5（2026-10-26）。

D5 · 2026-10-26 / 协调者：撤销新增 Host 文件例外，55 行映射恢复职责收回既有 Host 装配文件。Rationale：`docs/review/README.md` §6 的边界矩阵变更必须独立，当前闭环不需要扩张边界。

D6 · 2026-10-26 / 协调者：本轮修复重复 workspace 配置导入 P2，并收窄 `use` 参数、缓存唯一 iteration/date 候选。Rationale：落实两存储一致的每工作区唯一配置合同，删除不可达分支和重复扫描，不扩大需求。

## Idempotence and Recovery

派生读取可重试，事务内重查保证迟到派生不覆盖 user；已保存记录优先。测试只用临时库和录制 transport。旧库拒绝时保留原文件并返回安全错误，不自动删库、不承诺 downgrade。失败的字段发现不留下“空配置已确认”状态。

回滚只撤代码和安装件；已经持久的 mapping 不外发、不产生远端补偿。确有新遗留时按 `docs/exec-plan/tech-debt-tracker.md` 登记原因/影响/下一步，chooser #358、写入 #71 和政策 #273 已是独立范围，不伪称本 PR 完成。

## Interfaces and Dependencies

接口为本计划 Design / Spec 中两个 Storage 方法与现有 planningSource 的可选 mappingOrigin。无新第三方运行库，无新凭据；只复用已存 Planning binding、projectNodeId 和宿主 credential resolver。Host 交给 Core 的 project 必须是同一 binding/project，避免空项目无法发现身份。

#354 在本 PR 之上消费 `loadPlanningMapping`；该 helper 不拥有 SQLite、不启动 scheduler。#131 消费来源短文本及独立 setup read。#140 不依赖本 PR。未来发布后迁移策略需单独决策，不能把首发前原位改写带入发布后承诺。

## Outcomes & Retrospective

本地实现与修复波次完成，最终 `pnpm verify` 为 typecheck 通过、完整测试 1942/1942、MVP 7/7；最窄八文件 245/245、独立反例 5/5 与 boundaries 9/9 通过。首次完整回归的三处 schema 追溯失败均修正；收回 helper 时的重复类型 import 曾被 typecheck 拒绝，合并 import 后最终重跑通过。`git diff --check` 与相对 `origin/main` 的检查均 exit 0。公开面脚本针对已提交计划通过，另人工检查未提交实现与新增测试的五类发布面无敏感命中；未提交实现的机械范围需协调者提交后重跑。首轮独立对抗验收 PASS 并发现重复导入 P2；已通过本轮 RED→GREEN 修复，该等待结论 Superseded by 本节末的最终验收（2026-10-26）。当前执行上下文为 `.worktrees/planning-field-mapping`，可用 `git diff` 与 `git status --short` 重算实际范围。

最终验收（2026-10-26 17:17 +08）：原独立验收者复评 PASS，P0/P1/P2/P3 均为 0；245 项窄回归与 5 项对抗反例通过，来源、scope 与 user 竞争保护未回退。两处精简已删除不可达分支与重复角色扫描。未产生新延期技术债；#358/#71/#273 的原范围保留。公开面完整工作树（含新增测试）机械扫描零命中，五类人工检查通过。

发布回读在检出 `feature/planning-field-mapping` 的工作树根执行：`gh pr view 401 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`，期望当前 head 与本地一致、base=main、关闭关联只有 #277、所有执行 checks 通过；再回读全部 review threads 并确认无未处理项后 ready。issue 的 `closedByPullRequestsReferences` 也须包含 #401。回读与 `gh pr ready 401` 的实际结果由 PR 现场提供，不把此处静态文字当现值；人类保留合并决定。

外部元数据写入已于 2026-10-26 执行并回读：actor=SingularityKChen，target=本仓 PR #401、issue #277 与 Project #10 对应 item；幂等身份=`iteration8-277-draft`，结果为双向关联、标签/里程碑/assignee 及 ExecPlan/Batch 投影。Status 与 blocked-by/blocking 未写入；归档后机械更新 ExecPlan 路径，再回读。

## Bottom Change Note

2026-10-26 16:32 +08：综合两份独立设计及源码反例创建；固定独立配置记录、保守词表、来源展示和最少 Host 顺序，避免重启覆盖与虚假 Provider 确认。

2026-10-26：记录 Storage/Host RED→GREEN 与来源链测试，依据 boundaries 真实失败把唯一新增 Host helper 登记纳入文件集合；保持 active 等待独立验收。

2026-10-26：就地订正 D4 为 D5；恢复边界文件，记录首轮完整回归三处 schema 追溯失败，补新表库存与来源注释，等待最终重跑。

2026-10-26：补空 Project、definition lifetime timeout 与 fake 导入工作区父边证据；记录最终 244 + 9 + 1941 + 7 项及 typecheck 通过，保留 active 等待协调者验收。

2026-10-26：依据独立验收修复 fake 重复 workspace 映射导入，新增相同/冲突配置负控；按原语义收窄 use 并缓存角色候选，保留全部 scope、late-user 与来源用例。

2026-10-26：记录修复波次最终 typecheck、245 项窄回归、5 项独立反例、9 项原边界及 1942 + 7 项完整回归通过；保持 active 等待原验收者 scoped 复评。

2026-10-26 17:17 +08：根据独立 scoped PASS 归档，记录发现闭合、发布回读门禁与外部元数据审计；保留人类合并边界。

- 2026-10-26：MMP 评审订正过期 Active 抬头，使其与最终验收、completed 位置及索引一致；不改变产品范围。

- 2026-10-26：MMP 非阻塞修复完成独立复评后归档，评审记录纳入 Global Constraints；最终提交与远端证据另行回读，不预写合并结果。
