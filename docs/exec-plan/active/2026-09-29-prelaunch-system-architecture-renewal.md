# 发布前系统与架构收敛

> 状态：Active；Batch 0（#217）的实现与评审修复已验收，最终提交与合并状态用 `gh pr view 239 -R SingularityKChen/harness-projects --json headRefOid,state` 回读；Batch 1–7 待实施，控制计划继续 active。
> 创建：2026-09-29
> 控制依据：仓库根目录 `PLANS.md`；本文件是 spec 与实施计划合一的活文档，也是 epic #216 的控制计划，随 #217 落地。
> 范围：在尚未上线、无需维持旧数据库和旧 API 兼容性的条件下，先把产品链路的证据如实落账（Batch 0），再修事实所有权与真实行为偏差，再收敛 SQLite 基线、兼容形状、测试与文档。真实平台接入和 Gate E1 / R1 的裁决不会由"清理完成"自动推出。
> 观察基线：2026-09-29，`main@f6a33d2`（本计划分支 `docs/system-architecture-renewal` 起草时的 base）；2026-09-30 变基到 `main@699d715`，`vertical-path.md` §2.1 与 `release-gates.md` §2.1.1 已按新基线重新核对，下文「Batch 0 需要的代码事实」仍是 `main@f6a33d2` 上取的，其中 Start Work 一路的事实以那两处为准。每个实施 PR 开工时重新锁定 base/head，不沿用此值。

## Purpose / Big Picture

完成这一轮后，同一工作空间的用户在重连时不会看到较新的快照被迟到的旧快照覆盖；交付平台短暂离线时仍能看到最后已确认的 CI 与谱系事实，并明确看到陈旧标记；重复或乱序同步、同幂等键但不同参数的命令不会被误报为新成功。执行者能从空库建立一份与当前端口契约一致的 SQLite schema，并从测试与文档准确判断哪段产品链路已有生产入口证明、哪段仍只是替身或待交付。

Batch 0 先交付最后那一半：只读仓库的人能在 `docs/product/vertical-path.md` §2.1 逐行查到 13 个用户步骤（外加 Draft→Issue 附行）各自的生产入口、经入口的成功与失败用例、provider 真实性与当前结论；能在 `docs/architecture/release-gates.md` §2.1.1 查到 R1 §2.1 十条不变量各由哪条用例在哪一层断言、哪条有反例。`tests/mvp0` 7 条全绿从此不能再被读成"13 步都已交付"。

这是发布前恢复事实可信度的工作，不是把首发功能并进一个重构 PR。完成证据是逐批红→绿反例、空库和重启实验、生产入口矩阵、当前 head 的 CI，以及人类对 Gate E1 / R1 的独立裁决。`pnpm verify` 全绿只能证明现有断言通过，不能单独宣称 MVP-0、MVP-1 或 R1 通过。

## Context and Orientation

### 事实源与边界

`AGENTS.md` §1.1 的七条不变量是实现约束。依赖方向是 `packages/providers/*` 与 `packages/storage/sqlite` → `packages/capabilities` → `packages/core` → `packages/controller` → `packages/client` → `packages/ui-model` → `packages/ui` → `apps/*`；`tests/contract/package-boundaries.test.js` 检查包边界。`docs/product/vertical-path.md` 枚举 13 个用户可观察步骤并定义 MVP-0 / MVP-1 判定；`docs/architecture/release-gates.md` 定义 R1；`docs/architecture/gate-e1-ruling.md` 与 `docs/adr/`（ADR-0001 至 ADR-0008）记录身份、同步、写入与运行身份边界。早期设计输入不随仓库分发，本计划不依赖它；公开依据只有仓库内文件、代码与同仓 issue。

术语：**事实拥有者**是能决定某个状态真值的唯一写者；**观察账本**记录 Provider 观察的去重与顺序，不能代替工作空间投影的幂等；**快照代**用于区分一次连接/重连或工作空间重建；**基线迁移**是空库首次建表的 SQL，不承担旧库自动升级承诺。**生产入口**、**旁证**、**反例**与两套结论词表的定义见本文件 `Design / Spec` 的「0.2 证据规则与结论词表」。`Saved` 只在外部 Provider ack 或 reconcile 后成为权威。

### 原始意图与当前状态

| 主题 | 已验证判断 | 当前依据与门槛 |
|---|---|---|
| Host 权威、规划/工程正交、身份与成员分离 | 主轴仍在；当前 schema 与早期表形不同有 Gate E1 和 ADR 的后续理由，不自动算漂移 | `AGENTS.md` §1、`docs/adr/ADR-0002-membership-identity-separate-from-content.md`、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md` |
| 独立 Web 先落地 | 宿主探针选择的有意调整，并非放弃 Host 权威 | `docs/architecture/harness-host-spike.md` 的 `fallback-web` 裁决；宿主与 UI 尚未交付 |
| 多 Development 来源 | core 注册表每域一个实例，`implementationKey` 取的是域名 | `packages/core/src/registry.ts`；#197、#219 |
| 同步与交付事实 | 已复现：交付 Query 发现并写关系、离线时丢最后已知 CI；重复 bootstrap 推进 revision | `packages/core/src/delivery.ts`、`chain-facts.ts`、`bootstrap.ts`；复现命令 P2、P3 |
| 客户端连接 | 重连期间可把 revision 2 覆盖回迟到 baseline 1，旧值仍报 current | `packages/client/src/sync.ts`、`store.ts`；#218 |
| MVP-0 / 首发 | 7 条节点测试不等于 13 步都有生产入口；第 9 步与 Draft→Issue 没有生产入口 | Batch 0 的矩阵；真实 Provider、Host、UI 未交付属于分期，不是已实现后退 |

### Batch 0 需要的代码事实（行号以 `main@f6a33d2` 为准）

- `CoreCommands` 只有 `bootstrapWorkspace`、`startWork`、`cancelExecutionRun`、`confirmRelation`、`rerunPipeline`、`applyPlanningStatus`（`packages/core/src/context.ts:63-74`）；`CoreQueries` 有 `listProviderBindings`、`listPlanningItems`、`getItemDetail`、`getExecutionContext`、`getDeliveryProjection`、`getDeliveryLineage`（`packages/core/src/queries.ts:24-33`）。`composeCore` 在组合时建工作区、登记绑定并做一次引导（`context.ts:91-118`）。
- `ControllerCommands` 不暴露 `cancelExecutionRun`（`packages/controller/src/commands.ts:128-137`）；`ControllerQueries` 只有 `snapshot`、`getEntity`、`getExecutionContext`、`getDeliveryLineage`，没有 `getItemDetail`，也不转发交付投影的 `degraded` / `optional`（`packages/controller/src/queries.ts:12-18`）。
- `git grep -n createChangeRequest -- packages/core/src packages/controller/src packages/client/src` 无输出；`tests/mvp0/chain.test.js:70` 与 `tests/e2e/delivery-lineage.test.js:32`、`:84` 直接调用 `providers.development.createChangeRequest`。
- `promoteEntityIdentity`（`packages/core/src/identity.ts:71`）唯一调用在 `tests/e2e/chain-bootstrap.test.js:142`；`decideFromEngineeringFact`（`packages/core/src/status-policy.ts:44`）只被 `tests/e2e/status-policy.test.js` 与 `tests/mvp0/chain.test.js` 调用。`git grep -ci membership -- packages/core/src` 无命中；`ProviderPlanningItem` 没有成员关系字段（`packages/capabilities/src/planning-provider.ts:32-35`）。
- `bootstrap.ts:110` 无条件 `advanceRevision`；`delivery.ts:108` 在查询里 `recordEdges`；交付链上的变更请求实体按 `chainEntityId` 哈希得到（`relations.ts:34-37`、`chain-facts.ts:175-178`），不查外部身份表。
- `packages/providers/{planning-github-projects,development-github,delivery-github-actions,execution-harness,planning-local}/src/index.ts` 与 `apps/*/src/index.ts` 都是 8 行占位；真实实现只有 `development-local-git` 与 `execution-human`。经 `composeCore` 装配真实 provider 的只有 `tests/integration/human-execution-provider.test.js`；`tests/integration/local-git-core-provisioning.test.js` 的多数用例走 `createContext` + `provisionGit`（core 内部函数）。`main@699d715` 起另有 `local-git-start-work-resume.test.js`、`local-git-branch-probe.test.js`，它们与 `local-git-core-provisioning.test.js` 的 `startWork` 用例一起，在真实 Git 上调用 core 导出的 `startWork` 函数（`commands.startWork` 直接委托的那个），上下文是手工 `createContext`、没有 Planning 绑定，不经 `composeCore` 与 `commands`：按 0.2 仍是旁证，但覆盖的是完整供应序列，不只是 `provisionGit`。没有任何测试把 core 组合在 SQLite Storage 上。
- 故障注入：`FaultKind.OutOfOrder` 从未被测试使用；`duplicateEvent` 只在 `tests/contract/suites/planning.js`（provider 契约层）；`permissionDenied` 经 core 只出现在执行域（`human-execution-provider.test.js`）。
- 会读 active 计划的契约测试：`tests/contract/e1-evidence-consistency.test.js` 按内容发现携带 Gate E1 沙箱 id 字面量的计划；`tests/contract/board-status-semantics.test.js` 扫描旧的 Status 读法；`tests/integration/execution-relation-write-schema.test.js:16-29` 把 `release-gates.md R1` 与"R1 第 10 项"当出处 token。

## Design / Spec

### 总体路线

采用 **证据落账 → 修行为和权威边界 → 模型裁决 → 空库基线 → 删除旧形状 → 测试与文档收口**。放弃"一次重写 core 与 SQLite"：它会同时改变外部写入、同步、查询与迁移，失败时无法定位哪条不变量被破坏，也超出单 PR 的规模与回滚边界。放弃"先删代码/合 SQL 再看测试"：当前绿色测试未覆盖已复现的重连与离线反例，机械删减会固化错误语义。

目标读路径有两种入口：增量事件先经观察账本去重和定序，再触发或辅助刷新；全量权威快照即使没有事件也必须独立收敛。两者按已裁决的连接/工作空间/项目作用域更新本地事实，只有有效内容变化才推进业务 revision，刷新尝试与 freshness 另记。同一事务提交工作空间事实、关系和修订号；普通 Query 只消费已提交事实，带 freshness/degraded 元数据。目标写路径是 actor + 目标 binding + 请求指纹 + 幂等键先落待处理尝试，再调用 Provider，收到 ack 或 reconcile 后推进结果；未知结果不得盲重试创建或报 `Saved`。客户端以快照代和修订号共同判新旧，重连失败须显式 stale。一个事实一个拥有者：不加第二套缓存遮住交付查询副作用；不让 UI、脚本或 LLM 成为规划真值控制者；能力与权限按 `Capability ∩ Permission ∩ Policy` 检查。

SQLite 目标是发布前单一空库建表基线。允许不支持旧开发库的自动升级，但不得静默丢弃本机数据：压缩前列出实际库文件与持有人，逐项判可重建或需导出；发现真实不可丢数据、已部署实例或用户不接受重建时停止压缩，另设计向前迁移。保留 `migrate.ts` 的事务内版本复读、原子记账和失败回滚。新 001 建立 `schema_generation` 表，在同一事务内写唯一一行 `(id=1, baseline='prelaunch-v1')`；迁移运行器在跳过任何已应用版本前校验标记与预期清单，旧 [1] 与 [1,2,3,4] 均 fail closed，空库以外的未知表也拒绝。新空库运行 `PRAGMA foreign_key_check` 与 `PRAGMA integrity_check` 并断言无错误。

"dead code"经过定义、导出/调用点、运行时入口、测试替身、公共契约五重排查。`CoreNamespace<T>` 的可调用形状和 `DeliveryScope` 的字符串形状只是候选；`committed_observation` 视图与 `webhook_subscription` 表可能承载 Gate E1 正式事实，先决定保留消费者或删除后的设计修订；`git-provisioning.ts` 的默认 `recordStep` 有直接测试消费者，不列为 dead code。测试分三类：业务不变量、公开契约与发布门禁必须保留或加强；仅锁句式或源码行文本的断言改为结构化/行为判据；承担防漂移职责的历史证据测试保留明确的 authority 与反例。

### Batch 0 规格（#217）

#### 0.1 边界与状态拥有者

- 只改 `.md` 文件，代码改动为 0。`docs/product/vertical-path.md` §2 的 13 行步骤表是产品规格，本批不改其行、列与编号；新增 §2.1 是带观察基线的证据快照。`docs/architecture/release-gates.md` §2 与 §2.1 的原表、编号与"判定方式"列不动；新增 §2.1.1 是证据快照。本文件 `Validation and Acceptance` 表第 1–10 行的编号与文字冻结（#216 与里程碑 M2.1 按"十项"引用它）。
- 证据不是裁决：MVP-0 通过条件、R1 第 3 条是否满足、断言在哪一层才算数，都由人类伙伴判定（`release-gates.md` §1 与 §2 第 3 条"判定者"列）。矩阵与映射只用下面的封闭词表，不出现"通过""已证明""已完成"。
- 矩阵的结论只按该行自己的"可观察结果"与"失败时的可见形态"两列判；R1 不变量的反例记在 §2.1.1，矩阵行在"承接"列交叉引用，不把 R1 反例算成该行反例（例如 #220 属于 R1 第 7 条，不是第 3 行的反例）。
- 正文引用用例用"文件 + 用例标题前缀"，代码入口用"路径 + 导出名"，不写行号；观察基线（日期与 base 提交）写在小节头。

#### 0.2 证据规则与结论词表

- **生产入口**：`CoreApi.commands.*` / `CoreApi.queries.*`（`packages/core/src/context.ts`、`queries.ts`）、`Controller.commands.*` / `Controller.queries.*`（`packages/controller/src/commands.ts`、`queries.ts`）或 client 同步入口（`packages/client/src/sync.ts`）。`composeCore` 只能作为第 1、2 行的入口，并标"组合期"。
- **经入口的证据**：用例从生产入口出发抵达被测行为（`composeCore` 装配后调用 `commands` / `queries`）。**旁证**：直接调用 `providers.<域>.<方法>`、core 内部导出函数（`provisionGit`、`promoteEntityIdentity`、`decideFromEngineeringFact`、手工 `createContext`）、provider 契约套件或 ui-model fixture。旁证写进单元格时加"（旁证）"，不能单独支撑"已交付"或"已断言（core 入口）"。
- **反例**：有可复现违例，给出同仓 issue 或本文件的复现命令编号（P1–P5）；issue 记录但本轮未复跑的，写"（issue 记录的复现）"。
- **矩阵结论词表**：`已交付（替身）`｜`已交付（替身 + 真实 <包名>，集成）`｜`部分：<缺口>`｜`反例：<#n 或 Pn>`｜`未交付`。已交付＝有入口、成功与失败两列都有经入口的用例、无已知反例；部分＝有入口但某一观察面只有旁证或没有用例；未交付＝没有生产入口。
- **R1 映射结论词表**：`已断言（<层>）`｜`部分（<缺什么>）`｜`反例（<#n 或 Pn>）`｜`未验证`。层取 `纯函数`、`端口（内存 + SQLite 两适配器）`、`SQLite`、`core 入口`、`controller 入口`。一行多种情况时按"反例 > 未验证 > 部分 > 已断言"取最弱者。"已断言"行须有变异证据（本文件 `Validation and Acceptance` 的变异规程）。
- 结论只能往更保守的方向修正：实施者打开用例后若发现断言不成立，可把"已交付/已断言"降为"部分/反例"，反向升级须在 Decision Log 写明证据。

#### 0.3 纵向路径矩阵：列与结论落点

`docs/product/vertical-path.md` 在 §2 末（"第 13 行不是新增用户动作"一段之后、`## 3.` 之前）新增 `### 2.1 逐步证据矩阵（观察快照）`：小节头写观察基线、0.2 的规则与词表（改写为产品文档口吻）、以及用例回读命令 `node --test-reporter=spec --test-name-pattern="<前缀>" <文件>`（测试文件当脚本直接运行，不加 `--test`；期望退出码 0、有一行 `✔` 开头且标题包含该前缀的用例、无 `✖`、`ℹ tests` ≥ 1 且 `ℹ fail 0`，并配伪造前缀读回 `ℹ tests 0` 的负对照；加 `--test` 时无匹配也读回 `ℹ tests 1`，见 S-11；不依赖 `--test-isolation`，见 S-15）；表列为 `# | 用户动作 | 生产入口 | 成功形态用例 | 失败形态用例 | Provider | 当前结论 | 承接`；表后写"与 `tests/mvp0` 七个节点的对应"一段（节点 1→行 1/2，2→3/4，3→3/5 且不执行提升，4→6，5→6/7，6→11 且变更请求由直接调用替身种下，7→10/12；行 8、9、13 与附行没有节点），结论句是"7 条全绿是 MVP-0 的必要条件、不是充分条件"。附行 Draft→Issue 的反例写成可复制的 P1 命令。

逐行的入口、用例、Provider 与结论以 `docs/product/vertical-path.md` §2.1 为准（B0.5 以它替换了本节原有的初值表；初值与落地值的差异及依据见 Decision Log）。

#### 0.4 R1 §2.1 逐条映射：列与结论落点

`docs/architecture/release-gates.md` 在 §2.1 末（"只有 10 条全部被找到且全部通过"一段之后、`### 2.2` 之前）新增 `#### 2.1.1 逐条核对快照（观察快照）`：小节头写观察基线与 0.2 的 R1 词表；表列为 `# | 断言用例（文件 + 标题前缀） | 断言所在层 | 变异证据 | 缺口或反例 | 当前结论`；表后一句汇总各结论计数，并写明"以上是证据，不是 R1 裁决；按 §1，反例与未验证都等同不满足，第 3 条由 §2 表的判定者裁决"。

逐条的用例、层、变异证据与结论以 `docs/architecture/release-gates.md` §2.1.1 为准（B0.5 以它替换了本节原有的初值表；差异及依据见 Decision Log）。

#### 0.5 原地 Superseded 清单

格式沿用 `docs/project-management/merge-queue.md`：紧跟原文另起一段 `> **Superseded by <新结论位置>（2026-09-29，#217）**：<被推翻的是什么、现在是什么>`，原文一字不删。只标被推翻的结论，不标仍然成立的事实，也不改 `docs/exec-plan/completed/` 与 `docs/review/` 下的带日期历史记录。

| 位置（`main@f6a33d2`） | 原结论 | 标注 |
|---|---|---|
| `docs/product/vertical-path.md` §2 首段（"MVP-0 的每一行都由 … 离线替身完成"） | 每一行都由替身完成 | Superseded by §2.1：第 2、9 行与附行没有生产入口；第 9 行由测试直接调用替身完成 |
| 同文件 §2 步骤表第 9 行"MVP-0 完成者"格（表后另起一段） | 第 9 步由 Development / Delivery 替身（含"创建结果不确定"注入）完成 | Superseded by §2.1 第 9 行：没有生产入口，"创建结果不确定"注入未经 core 走过 |
| 同文件 §2"MVP-0 不在步骤表上删行"段 | 13 行全部在替身上可判定，`tests/mvp0` 覆盖每个节点 | Superseded by §2.1 与其"与 tests/mvp0 七个节点的对应"段 |
| 同文件 §3 判定表（表后另起一段） | 不是 Superseded；写"注（2026-09-29，#217）"：§1 的 MVP-0 定义与 §3 的机械判定互相不充分，判定命令原样保留，是否改通过条件由人类伙伴裁决（H1） | 注 |
| `tests/mvp0/README.md` §1（"链路已由切片栈实现"） | 链路已实现 | Superseded by `docs/product/vertical-path.md` §2.1 |
| 同文件 §3 表第 3 行（表后另起一段） | 节点 3 保护 Draft→Issue 提升不换 id | Superseded by `docs/product/vertical-path.md` §2.1 附行：节点 3 不执行提升；提升的断言在 `tests/e2e/chain-bootstrap.test.js`（旁证层），见 TD-001 |
| `docs/architecture/release-gates.md` §2.1"当前结论（2026-09-26 …）"两段 | 第 3 条"无法判定"，文件计数 | Superseded by §2.1.1：逐条核对后多条有反例，第 3 条仍按 §1 为不满足；文件计数以 `ls` 回读为准 |
| 同文件 §2.2"当前结论（2026-09-26 随 #175 更新…）"段（B0.5 补） | 文件与用例计数（integration 8 个 / 69 条） | 不是 Superseded：计数过期但"两层非空且全绿"仍成立，写"注（2026-09-29，#217）"给出同一回读命令的现值 |

#### 0.6 登记的技术债

`docs/exec-plan/tech-debt-tracker.md` 的 Open Items 新增三行（字段按该文件表头），导言句改为"已有经批次决策接受的延期项"：

- **TD-001**：`tests/mvp0/chain.test.js` 节点 3 的标题声称"Draft→Issue 提升不换 id"而用例体不执行提升（变异 M1 下 mvp0 仍 7/7），文件头注释仍写"当前必须失败"。延期理由：#217 只改文档。影响：MVP-0 全绿被读成 Draft→Issue 已受保护。下一步：#224 的测试规则 PR 改名并去掉过时文件头，或由 Draft→Issue 生产入口的承接 issue（H2）改成真实晋升用例。
- **TD-002**：`tests/mvp0/chain.test.js` 的 `chainFor` 与 `tests/e2e/delivery-lineage.test.js` 的 `startChain` 直接调用 `providers.development.createChangeRequest`，节点 6/7 与交付谱系正向用例建立在这次直接调用上。延期理由：第 9 步没有生产入口。影响：交付谱系证据绕过第 9 步。下一步：#235 落地时改走生产命令。
- **TD-003**：`vertical-path.md` §2.1 与 `release-gates.md` §2.1.1 引用的用例标题和 issue 状态没有机械守卫。延期理由：守卫属于测试基础设施，另成闭环。影响：用例改名或 issue 关闭后矩阵静默过期。下一步：并入 #182；此前靠 `Global Constraints` 的"同 PR 更新矩阵行"纪律。

#### 0.7 取舍：采纳与放弃

- 采纳"纵向矩阵"设计的生产入口判据、复现探针与"必要非充分"结论；采纳"计划校准"设计的批次 → issue 单表、易失基线只写一处、作者列写角色、Validation 行号冻结、#223/#224 各两个 PR 与下游依赖；采纳"R1 映射"设计的分层封闭词表、变异证据与"只标被推翻结论、不改历史记录"。
- 放弃把行级结论与 R1 反例混判（例如因 #220 把第 3 行判反例）：矩阵行只按自身观察面判，R1 反例归 §2.1.1。
- 放弃在第 6 行、R1 第 6 条写"已交付/已断言"：P4 在 `main@f6a33d2` 复现同键异请求报 `saved` 且没有为第二个工作项建上下文，正是 `AGENTS.md` §1.1 的硬约束失效形态。
- 放弃把 R1 第 4 条判"已断言（辅助层）"：辅助层断言存在且 M1 能打红，但经生产入口在替身上复现 P1；也放弃"真实 GitHub 下结果一样"的推断——`planning-github-projects` 是占位包，真实形态记为假设（S-3）。
- 放弃在本批改 `tests/mvp0/chain.test.js`、`docs/architecture/README.md` 与"上游能力意图"表：#217 排除行为变更；"上游能力意图"依赖不随仓库分发的输入，移到 Batch 7（#9）并用仓库内文字重述。
- 放弃在本批给矩阵加机械守卫：登记 TD-003，归 #182。
- 放弃在工作树里直接做变异：`.worktrees/<slug>` 没有自己的 `node_modules`，包解析会落到上级 checkout（S-1）；变异只在导出的临时目录做。

#### 0.8 评审者会怎么打破它

1. 某格写"已交付/已断言"，但正向用例直接调用替身或内部函数 → 0.2 旁证规则；对抗验证逐个打开被引用例，检索 `providers\.\w+\.(create|promote)` 与内部函数名。
2. 被引用的标题前缀拼错、被改名或含正则元字符 → B0-2 直接运行测试文件并用 `--test-name-pattern` 逐条回读，`ℹ tests` ≥ 1 且有 `✔` 标题行，并以伪造前缀读回 `ℹ tests 0` 作对照（S-11、S-15）；前缀不含 `( ) [ ] . * + ? | \ ^ $ { }`。
3. Superseded 删改了原文 → B0-5：三个文件的 `git diff --numstat` 删除列为 0。
4. 重排 R1 编号打破出处 token → B0-6 跑 `execution-relation-write-schema`，并核对 §2 与 §2.1 原表在 diff 中无删除行。
5. 证据其实跑在上级 checkout 的代码上 → 先跑解析守卫；本批改动只有 `.md`，用 B0-9 的"非 .md 改动为空"证明包代码与 base 相同。
6. 变异"看似生效实则没应用" → 规程要求先打出非空 diff，还原后 `cmp` 核对并复跑变绿。
7. 把证据写成门禁裁决 → 封闭词表；汇总句写明"证据，不是裁决"；§3 判定表只加注、不改命令。
8. 行级结论把 R1 反例混进来，或把 R1 反例漏掉 → 0.1 的行语义规则，承接列交叉引用。
9. 矩阵在 #218–#224 合并后过期 → `Global Constraints` 的同 PR 更新纪律与 TD-003。
10. 计划触发会读 active 计划的契约测试 → 计划不写 Gate E1 沙箱 id 字面量、不写 Status 旧读法；B0-11 跑相关契约测试。
11. 提交正文或文档出现关闭关键字，合并时误关 issue → B0-10 关键字扫描；只有 PR 正文尾注关闭 #217。
12. 附行被读成第 14 步 → 附行标"附"，不编号，表后说明它不是步骤承诺。

## Global Constraints

- 本轮只控制发布前架构收敛。真实 GitHub Provider、Host/UI 交付、Gate E1 与 R1 的人类裁决仍按既有 issue 与门禁执行；本计划不批准发布，不冻结数据模型，不写 Project `Status` 或 `blocked-by` / `blocking`。
- 每个 PR 关联同仓 issue，是一个可独立验收、合并、回滚的闭环：规模有两层上限，并存不冲突：代码 1000 / 文档 1500 是 CI 硬上限（`AGENTS.md` §6，`scripts/rule-checks.mjs` 的 `BUDGETS` 由 `size` 检查强制）；代码 800 / 文档 1300 是规划弹性上限，给评审与后续优化留余量（人类伙伴 2026-09-29 指令；#216 期望每个 PR 约 500–800 行代码）。`size` 通过只说明没破硬上限，弹性上限另跑 B0-9 的按桶求和命令核对。超出时先找 dead code 与可简化处，不拆 issue 凑数。最终只做 rebase merge，是否合并由人类决定。
- MMP 前不做兼容层与迁移；依赖方向不新增反向边；涉及跨层依赖、同一事实第二权威或公共契约重定义，先写 ADR 与契约测试。外部写入记录 actor、binding、幂等键与 ack/reconcile；凭据只留 secret 句柄。
- 行为变更先写在 base 上失败、在 head 上通过的判别性用例；变异实验先证明变异已应用。文档正文中文，路径、标识符、命令英文；`docs/` 自包含，不写本机绝对路径，不引用内部系统。
- `main` 不直接推送；每批在 `.worktrees/<task-slug>/` 隔离，分支前缀只用 `feature/`、`fix/`、`docs/`、`chore/`、`test/`、`project-management/`。开工前重新锁 base/head、开放 PR、相关 issue 与工作树状态。
- 本计划不写 Gate E1 沙箱 id 字面量（`tests/contract/e1-evidence-consistency.test.js` 会把携带者当作 E1 证据计划），不写关闭关键字加 issue 编号的字面组合；关闭关系只写在 PR 正文尾注并用 `closingIssuesReferences` 回读。
- 凡关闭 `vertical-path.md` §2.1 或 `release-gates.md` §2.1.1 所引 issue 的 PR，必须在同一 PR 里更新对应行与观察基线。

### 批次 → issue（唯一映射）

| 批次 | issue | PR 数与前置 |
|---|---|---|
| Batch 0 | #217 | 1；无前置 |
| Batch 1 | #218 | 1 |
| Batch 2A / 2B | #197 / #219 | 各 1；2B 在 2A 之后 |
| Batch 2C / 2D / 2E | #189 #198 #203 / #202 / #199 #220 | 各自独立 |
| Batch 3A / 3B | #221 / #222 | 3A 在 2A、2C 之后；3B 在 3A 之后 |
| Batch 4 | #194、#204、#191 | 至少三个 PR |
| Batch 5 | #223 | 两个 PR（世代守卫，再合并迁移）；前置 #4 #190 #195 #196 #221 |
| Batch 6 | #224 | 两个 PR（代码形状；测试规则，不混合）；前置 #222 |
| Batch 7 | #9 #8 | 行为批次合入后 |

#215（执行运行取消的记账与对账，M4）、#201、#205 不在 #216 子 issue 图内，只作 Context；是否纳入由人类决定（H5）。

### 唯一计划写入集合

批次叙述只点主文件；新增测试或主题文档若超出此集合，先在本节与 Decision Log 写明理由并重做规模与边界评审。

| 责任面 | 计划写入路径 |
|---|---|
| 控制与产品/架构事实 | `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`、`docs/exec-plan/tech-debt-tracker.md`、`docs/README.md`、`docs/product/{vertical-path,board-semantics}.md`、`docs/project-management/README.md`、`docs/development/content-placement.md`、`docs/architecture/{README,release-gates,gate-e1-ruling}.md`、`tests/mvp0/README.md`、经独立决策新增的 `docs/architecture/*.md` / `docs/adr/ADR-*.md` |
| Client 时序 | `packages/client/src/sync.ts`、`packages/client/src/store.ts`、`tests/e2e/client-sync.test.js` |
| Core 事实/编排 | `packages/core/src/{registry,context,identity,bootstrap,queries,delivery,chain-facts,relations,start-work,write-machine,execution-run}.ts`、`packages/controller/src/{commands,queries}.ts` |
| 能力/持久化 | `packages/capabilities/src/{storage,planning-provider,development-provider,observation}.ts`、`packages/providers/fake/src/{development,state}.ts`、`packages/providers/execution-human/src/index.ts`、`packages/storage/sqlite/migrations/{001_init,002_identity_membership,003_control_facts,004_execution_run_identity,005_delivery_facts}.sql`（005 仅在 Batch 3 需要新持久事实时创建）、`packages/storage/sqlite/src/{migrations,migrate,storage,storage-sync,storage-execution,storage-rows}.ts` |
| 判别性测试/规则 | `tests/mvp0/chain.test.js`、`tests/e2e/{chain-bootstrap,client-sync,delivery-lineage,start-work,write-machine,start-work-recovery}.test.js`、`tests/integration/{migration-runner,storage-sync-surface,identity-membership-schema,execution-relation-write-schema,human-execution-provider}.test.js`、`tests/contract/{package-boundaries,capabilities-keys,capabilities-observation,storage-contract,content-placement,board-status-semantics}.test.js`、`tests/contract/suites/storage-execution.js` |

### Batch 0 文件所有权

| 所有者 | 写入文件 | 分支（本地，不推送） |
|---|---|---|
| 定稿评审者（已完成） | 本计划、`docs/README.md` 索引行 | `docs/system-architecture-renewal` |
| B0-T1 矩阵 | `docs/product/vertical-path.md`、`tests/mvp0/README.md` | `docs/prelaunch-b0-matrix` |
| B0-T2 R1 映射 | `docs/architecture/release-gates.md` | `docs/prelaunch-b0-r1` |
| B0-T3 债务 | `docs/exec-plan/tech-debt-tracker.md` | `docs/prelaunch-b0-debt` |
| B0-T4 对抗验证 | 无写入 | 读 T1–T3 的分支 |
| 验收者 | 本计划（Progress、Surprises、Decision Log、Outcomes、Change Note，替换 0.3/0.4 初值表）、`docs/README.md` 状态列 | `docs/system-architecture-renewal` |

## Plan of Work

每一批按 `docs/development/workflow.md` 的"对齐 → 隔离 → 实现 → 验证 → 记录 → 提交 → 汇报"执行。开工先在该批工作树根目录运行 `git status --short --branch` 与 `git rev-parse HEAD origin/main`，再跑解析守卫 `node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))"`：输出不在当前 checkout 内时，行为批次必须先在该工作树执行 `pnpm install --frozen-lockfile`（不要在含其他任务依赖的目录里为绕过非 TTY 提示而设 `CI=true`），纯文档批次改用 B0-9 证明包代码与 base 相同。行为批次在指定测试文件加一条具名新用例并先看红，修复后同一命令转绿，再按该批列出的相邻层扩展；记录实际命令、退出码与可判别输出。批内分两个 PR 时，前一个必须可独立运行与回滚，后一个在前一个合并后重锁基线。

### Batch 0 · 纵向路径证据矩阵与 R1 映射（#217）

**最小闭环**：只读仓库即可查清 13 步与附行的生产入口、经入口的用例、provider 真实性与当前结论，以及 R1 §2.1 十条的断言与反例；过强结论原地标注。**涉及文件**：见 `Global Constraints` 的「Batch 0 文件所有权」。

- [x] B0.1 定稿：三份独立设计经评审定稿，本计划与 `docs/README.md` 索引行按定稿改写（定稿评审者；未提交）。
- [x] B0.2 提交与 draft PR（验收者，2026-09-29）：`81a2cbc` 与 B0.1 改动合成 `a50d7b8`（本地备份引用 `backup/system-architecture-renewal-81a2cbc` 指向 `81a2cbc`；改写前后 `git diff --name-only origin/main...` 的文件集合相同），已推送并开 draft PR #239，回读 `closingIssuesReferences` = [217]、#217 的 `closedByPullRequestsReferences` = [239]。Batch 0 的恢复锚点是 `a50d7b8`。原计划文字如下：分支尚未推送，先建本地引用 `backup/system-architecture-renewal-81a2cbc`，再把 `81a2cbc` 与 B0.1 的改动合成一个 `docs(exec-plan)` 提交——正文说明为什么，尾注 `Refs #216`，删掉原来的 `Refs #9`，不写任何关闭关键字；用 `comm` 比对改写前后 `git diff --name-only origin/main...<head>` 的文件集合（期望两者相同：B0.1 只改了 `81a2cbc` 已含的两个文件）；推送后开 draft PR，正文尾注以 `Closes` 指向 #217、以 `Refs` 指向 #216，回读两侧关闭引用。记录此时的 head 作为 Batch 0 的恢复锚点。
- [x] B0.3 并行开发：B0-T1、B0-T2、B0-T3 各在 `.worktrees/prelaunch-b0-{matrix,r1,debt}/` 从 B0.2 推送后的 head 分出本地分支，按 0.3–0.6 写入各自文件并各自提交一次（提交尾注 `Refs #217`）；T1 复跑 P1、P3、P4，T2 复跑 P1、P2、P4、P5 并做变异 M1、M3、M9、M10，把输出写进交接消息。
- [x] B0.4 对抗验证：B0-T4 读取三条分支，按 0.8 逐条尝试打破，并独立复跑 `Validation and Acceptance` 的 B0-1 至 B0-11；只报告，不写文件。
- [x] B0.5 验收重构与收口（验收者）：把三条分支的提交按 T3 → T2 → T1 摘到 `docs/system-architecture-renewal`，处理 T4 的发现（只往保守方向改），把 0.3、0.4 两张初值表替换为指向 `vertical-path.md` §2.1 与 `release-gates.md` §2.1.1 的一句话，更新 Progress、Surprises、Decision Log、Outcomes 与 Bottom Change Note，提交尾注一律 `Refs #217`（提交正文不写关闭关键字，关闭关系只在 PR 正文尾注，见 `Global Constraints`）；跑完 B0-1 至 B0-11、做发布面人工五类目检查后推送（快进，不改写已推送历史），回读 head、base、checks、review threads 与两侧关闭引用，更新 PR 描述的验证证据；`gh pr ready` 与合并由人类伙伴决定。
- [x] B0.6 评审响应（review 5353108706；执行者改、验收者复核）：在变基到 `main@699d715` 的分支上只改 `.md`，按 P1（第 13 行）、P2（回读判据兼容 Node 22）与总述（第 7 行）修改；验收者独立复跑后追加订正，快进推送，在两条评审线程下回复并在验证通过后 resolve，同步 PR 描述；不合并、不改看板、不写 issue。
- [x] B0.7 评审修复：`vertical-path.md` 的正反回读块放进启用 `set -e -o pipefail` 的子 shell，`release-gates.md` 同步过滤输出的退出状态规则。在 bash 与 zsh 上正常块退出 0，匹配用例通过但 `process.exitCode=7` 的进程级反例使整个块退出 7；文档契约与 MVP-0 27/27。人类已明确要求修复、整理后 rebase merge；B0.6 的“不合并”仅是当时的交接限制，现由此指令取代。

**验证**：`Validation and Acceptance` 的 B0-1 至 B0-11，期望逐条满足。**回滚**：合并前删除三条本地子分支，把 `docs/system-architecture-renewal` 退回 B0.2 记录的恢复锚点（已推送时按 `Idempotence and Recovery` 的 force-with-lease 流程）；合并后用一次反向提交整体撤回，不关闭也不重开功能 issue，#217 如被关闭由人类决定是否重开。

### Batch 1 · Client 快照代与重连时序（#218）

最小闭环是迟到 baseline、并发 poll、重连失败均不能让较新事实回退或把陈旧值报 current。主文件 `packages/client/src/sync.ts`、`store.ts`、`tests/e2e/client-sync.test.js`。先加入受控延迟反例：connect 得 revision 1，reconnect baseline 悬置，poll 接受 revision 2，再释放 baseline 1；当前实现回退到 1，新用例必须先红。设计连接代或串行化协议，定义工作空间重建时的合法 revision 重置与跨代丢弃条件；重连开始立即 stale，失败保留最后已知值并提示失败。不能只用 `revision >= current`，那会误拒绝合法重建。验收 `node --test tests/e2e/client-sync.test.js` 新反例与既有用例全过、`node_modules/.bin/tsc --noEmit` exit 0；修改 controller 快照协议时先加契约并确认 client 不依赖 React。回滚为独立 PR 的 revert，同步更新第 4 行矩阵。

### Batch 2 · Binding、工作空间同步与观察幂等（#197 #219 #189 #198 #203 #202 #199 #220）

2A（#197）在 `packages/core/src/registry.ts`、`context.ts` 与 ADR-0006 对齐连接锚点、工作区挂载、binding 角色和 implementationKey 的 owner；契约用例证明同一连接挂两个工作空间不会把域名误作实现身份，输出明确的持久键/路由契约，先于 Batch 3 的交付缓存键设计。验证 `node --test tests/contract/capabilities-keys.test.js tests/contract/package-boundaries.test.js`，新增身份反例先红后绿。

2B（#219）在 2A 合并后处理同域多实例：`packages/core/src/registry.ts` 与 `packages/capabilities/src/development-provider.ts` 允许 Local Git 与 GitHub 两个 Development binding 并存，按 repository/binding 显式路由，缺路由或歧义时拒绝。用两个可区分的测试 provider 注入 core，断言各自收到自己的请求；不实现真实 GitHub Provider。验证 `node --test tests/e2e/start-work.test.js tests/contract/capabilities-keys.test.js`。

2C（#189 #198 #203）在 `packages/core/src/bootstrap.ts`、`queries.ts`、`packages/capabilities/src/{storage,observation}.ts`、`packages/storage/sqlite/src/storage-sync.ts` 定义连接级观察账本、工作空间级 freshness/投影与项目成员关系；`packages/providers/fake/src/development.ts` 的 commit SHA 不是可排序版本，换成可排序载体或停止声明它有顺序；版本比较按载体正确定序。先加入"ws1 degraded 不覆盖 ws2 healthy""无观察流也能全量对账""ws1 已接受的事件不阻止 ws2 刷新"与 #203 边界用例的红用例。验证 `node --test tests/integration/storage-sync-surface.test.js tests/e2e/chain-bootstrap.test.js tests/contract/capabilities-observation.test.js`；合并时更新 R1 第 8 行。

**2026-09-29 人类伙伴决定**：#203 单独成 PR，作为 `#203 → #70` 两层栈的栈底先行交付（#70 是第一个设置 `sourceVersion` 的真实 provider，排序规则必须先于它落地）。2C 其余部分（#189 #198）照常，开工时以 #203 已合入的比较规则为前提重新锁定接口。

2D（#202）让换 Planning 源时收敛禁用源投影而保留应留内容身份；反例覆盖同一内容在新旧源之间切换、源失败、重启。验证 `node --test tests/e2e/chain-bootstrap.test.js tests/contract/storage-contract.test.js`；P5 应变为不增；合并时更新 R1 第 1 行。回滚不删除原始身份。

2E（#199 #220）：storage 拒绝观察时返回结构化同步失败；同一观察 N 次业务 revision 等同一次，较旧观察不能覆盖较新快照，相同全量内容的手动刷新只记 freshness。先定义业务修订与刷新轮次的不同语义，再改 `packages/core/src/bootstrap.ts`。验证 `node --test tests/e2e/chain-bootstrap.test.js tests/integration/storage-sync-surface.test.js`，P2 应变为 revision 不变；合并时更新矩阵第 3 行与 R1 第 7 行。

每个子批另跑 `node --test tests/contract/package-boundaries.test.js` 与相邻层测试，独立 revert。#4 的 Gate E1 仍由人类裁决。2A/2C 的键形改变后，Batch 3 的缓存设计在它们合并后重新锁定接口。

### Batch 3 · 交付观察与 Query 事实所有权（#221 #222）

必须等 2A 与 2C 合并才可定缓存键。总体闭环是首次读取交付视图不写关系，Delivery 离线时读到最近确认的 CI/谱系节点与 stale 标记，刷新才可能更新持久事实。主文件 `packages/core/src/delivery.ts`、`chain-facts.ts`、`relations.ts`、`queries.ts`、`packages/capabilities/src/storage.ts`、`packages/storage/sqlite/src/storage-execution.ts`、`tests/e2e/delivery-lineage.test.js`；以 ADR 定义交付事实缓存的键、来源、freshness 与唯一写者。分页截断、权限下降或网络失败不得把缓存误写成"已确认不存在"。

3A（#221）增加持久交付事实（需要时先加 `005_delivery_facts.sql`）与唯一的 `refreshDeliveryFacts` 写入口；旧 Query 只委托这个入口，自身不再 `recordEdges`。新增"离线保留已知事实""写入路径只有一个""失败不清空完整缓存"的回归断言，先红后绿、合并时全绿；"Query 纯读"的红用例不进 3A，也不以 skip/todo 消音。运行 `node --test tests/e2e/delivery-lineage.test.js tests/contract/storage-contract.test.js tests/integration/execution-relation-write-schema.test.js`；P3 离线 CI 应保留并标陈旧；合并时更新矩阵第 10、13 行。

3B（#222）开工时把"首读前后关系与 revision 不变"反例加入 `tests/e2e/delivery-lineage.test.js` 先见红；由显式 bootstrap/refresh 命令触发同一 ingest 入口，普通 Query 只读已提交事实并带 stale/degraded 元数据，controller 查询面转发这些元数据。另验证重复/乱序交付观察、完整空集合才允许删除、缺失节点显示为缺口。运行 `node --test tests/e2e/delivery-lineage.test.js tests/e2e/chain-bootstrap.test.js`、`node --test tests/integration tests/e2e` 与 `pnpm run boundaries`；合并时更新矩阵第 11 行。

### Batch 4 · 外部写入与 Start Work 的持久命令身份（#194 #204 #191）

最小闭环是同一个幂等键只代表同一 actor、目标与参数；同键不同请求显式 conflict，崩溃/重启后返回原结果或待对账，未知外部创建不盲重试。主文件 `packages/core/src/start-work.ts`、`write-machine.ts`、`execution-run.ts`、`packages/controller/src/commands.ts`、`packages/capabilities/src/storage.ts`、`tests/e2e/write-machine.test.js`、`tests/e2e/start-work-recovery.test.js`。按事实拥有者至少三次独立交付：请求指纹与 durable in-flight claim（#194，P4 应变为结构化拒绝）；外部写尝试/ack/reconcile 与 `Saved` 边界（#204）；重启后重跑对账而不是存储"怎样被解决"（#191）。运行取消的记账（#215）若经人类纳入，作为第四次交付，依据 `docs/adr/ADR-0008-run-identity-is-the-core-run-record.md`。每次先运行新反例，再运行 `node --test tests/contract tests/integration tests/e2e`；出现不确定外部结果时停在可见 pending/uncertain。合并时更新矩阵第 6、13 行与 R1 第 6 行。

### Batch 5 · Gate E1 裁决后的 SQLite 基线合并（#223）

前置是人类对 #4 的具体裁决、#190 #195 #196 #221 合并、当前端口与关系模型定案，以及"本机有哪些库、是否可重建"的逐项清单；缺任一前置只做空库原型。第一个 PR 加世代守卫，第二个 PR 合并迁移。主文件 `packages/storage/sqlite/migrations/*.sql`、`src/migrations.ts`、`src/migrate.ts`、`src/storage-sync.ts` 及 schema/runner/端口测试。在可丢弃临时库把现行 001–004（若 Batch 3 新增 005，也包括它）重写成一份 001 完整建库基线；保留活合同的 `execution_run.provider_ref_json` / `fallback`、连接/成员约束和原子版本记账。`migrate.ts` 在判断"版本 1 已应用，可跳过"之前先验证：空库无用户表才允许建库；非空库必须有匹配的 generation 与完整清单；否则以结构化"旧库需备份并重建"失败，不执行 DDL 或业务写入。测试分别构造旧 [1]、[1,2]、[1,2,3,4]、旧 003 表形、未知用户表和损坏版本表，断言拒绝前后 schema/行数据未变。新库执行两次迁移（第一次 [1]、第二次 []），用第二连接、进程重启、并发启动和故障注入验证；`PRAGMA foreign_key_check` 零行、`PRAGMA integrity_check` 为 `ok`。正式删除前分别裁定 `committed_observation` 视图与 `webhook_subscription` 表的消费者。运行 `node --test tests/integration/migration-runner.test.js tests/integration/storage-sync-surface.test.js tests/integration/identity-membership-schema.test.js tests/integration/execution-relation-write-schema.test.js tests/contract/storage-contract.test.js` 与 `pnpm verify`。

### Batch 6 · 兼容形状、dead code 与测试规则（#224）

两个 PR，前置 #222。代码形状 PR：以 package exports、调用图、TypeScript 未用检查、运行时动态装配、测试 fixture 和公共 API 消费者建立"删除候选 → 最后使用者 → 删除后行为"登记，再删除 `CoreNamespace<T>` 的可调用形状与 `DeliveryScope` 的字符串分支等无消费者形状；运行 `node_modules/.bin/tsc --noEmit`、`node --test tests/contract tests/e2e`。测试规则 PR：`content-placement.test.js` 保留路由与路径存在性、改掉句式断言；`board-status-semantics.test.js` 改为从单一权威表求值；`storage-contract.test.js` 的源码行多重集与硬编码用例数改为具名场景；同时处理 TD-001（节点 3 改名、去掉过时文件头）；以三种变异证明能抓真实漏项。运行这三个测试文件、`node scripts/workflow-check.mjs`、`node --test tests/contract` 与 `git diff --check origin/main...HEAD`。

### Batch 7 · 架构文档、证据链与系统验收（#9 #8）

行为批次合入后，把当前 owner、连接/绑定路由、同步/写入/查询数据流、SQLite 新基线、Client 重连契约和失败恢复自包含地写入 `docs/architecture/`、必要 ADR 与 `docs/product/`；用仓库内文字重述"能力意图 → 首发范围 → 延后理由/退出条件"；过期结论原地标 `Superseded by`。系统验收把矩阵与 R1 映射逐行复核，运行 `node_modules/.bin/tsc --noEmit`、`node --test tests/contract tests/integration tests/e2e`、`node --test tests/mvp0`、`node scripts/workflow-check.mjs`、`pnpm run boundaries`，并用 P1–P5 与重连竞态反例核对。真实 GitHub sandbox、浏览器 E2E 与 UAT 只在相应 Host、UI、Provider 可用后执行；缺项留为 R1 不满足，由人类裁决。全部验收后把本计划移到 `docs/exec-plan/completed/` 并更新索引。

## Validation and Acceptance

| # | 完成条件 | 判定证据 |
|---|---|---|
| 1 | 13 步与首发范围不再互相冒充 | 每步有生产入口或明确"未交付"，正/失败测试与 Provider 类型可查；第 9 步和 Draft→Issue 不靠 fake 直接调用宣称闭环 |
| 2 | 重连不回退已接受的快照 | revision 1/2/迟到 baseline 1 用例先红后绿；失败 stale、合法新快照代重置各有用例 |
| 3 | Query 不写交付关系，离线保留最后确认 CI | 首读前后关系与 revision 不变；离线后 CI 节点仍在且标 stale；明确刷新才改变确认事实 |
| 4 | 两个 Development 实现可共存且路由明确 | Local Git + GitHub 绑定装配用例通过；歧义拒绝；单连接跨工作空间的锚点与角色不混 |
| 5 | 重复/乱序观察不改写较新工作空间事实 | 同一观察 N 次的实体、关系和业务 revision 与一次相同；无事件的全量对账仍收敛，ws1 事件已接受不阻止 ws2，ws1 失败不污染 ws2 |
| 6 | 写入确认和命令身份可信 | 同键不同请求 conflict、同键并发一条外部写、ack 后落库失败可对账、actor/binding/尝试可追溯、unknown 不盲重试 |
| 7 | 空库得到当前单一 schema，旧库全部拒绝 | 一次建库、二次零变更、并发与失败回滚；旧 [1]/[1,2]/[1,2,3,4] 与未知表均在业务写前失败且不改原数据；外键检查零行、完整性检查 ok、两个 Storage 适配器往返一致 |
| 8 | 删除代码确实不承担契约 | 每个候选有调用/导出/动态入口审计与最终用例；保留的视图/表有 owner 和消费者 |
| 9 | 测试和文档断言反映行为而非句式 | 正面变异抓真缺陷，纯中文改写不导致假红；当前架构/产品结论可从仓库内复核 |
| 10 | 规模、发布面与发布门禁不混淆 | 各 PR 的 size/disclosure/diff/CI 当前 head 有输出；Gate E1/R1 按各自人工门禁裁决，未知等于不通过 |

### Batch 0 验收（#217）

除特别说明，命令在检出 `docs/system-architecture-renewal`（或 B0 子分支）的工作树根目录运行。

| # | 验收项 | 命令与期望 |
|---|---|---|
| B0-1 | 13 行与附行各有入口或"未交付"；第 9 行与附行是"未交付"；第 13 行按故障面拆到具体入口，无入口的故障面单列"未交付" | 读 `vertical-path.md` §2.1：13 个编号行 + 1 个"附"行，第 13 行的入口格逐项指向 `commands` / `queries` 并链到表后 13.1–13.10 的故障面表（13.7、13.10 标"未交付"，其余每面有入口、经入口的用例与旁证之分）；`git grep -n createChangeRequest -- packages/core/src packages/controller/src packages/client/src` 无输出；#217 验收第 1 条 |
| B0-2 | 每个被引用例可回读 | 对 §2.1 与 §2.1.1 的每个"文件 + 前缀"直接运行测试文件（不加 `--test`）：`node --test-reporter=spec --test-name-pattern="<前缀>" <文件>`，期望退出码 0、`ℹ tests` ≥ 1、`ℹ fail 0`，且有一行以 `✔` 开头（嵌套用例有缩进）、标题包含该前缀，无 `✖`（`storage-contract` 两个适配器各一条，读回 2）；对照：同一命令配伪造前缀（例如 `不存在的前缀`）必须读回 `ℹ tests 0` 且无 `✔` 行。加 `--test` 时无匹配也读回 `ℹ tests 1` / `ℹ fail 0`（S-11），那样的回读没有判别力；该命令不依赖 `--test-isolation`，因为 Node 22 没有这个选项（S-15） |
| B0-3 | R1 十行各有用例或"未验证" | §2.1.1 恰 10 行，结论全部落在 0.2 的 R1 词表；#217 验收第 2 条 |
| B0-4 | "已断言"行有判别力 | 变异规程 M1、M3、M9、M10：每个先打出非空 diff、指定用例变红、还原后 `cmp` 一致并复跑变绿 |
| B0-5 | Superseded 只追加 | `git diff --numstat origin/main...HEAD -- docs/product/vertical-path.md docs/architecture/release-gates.md tests/mvp0/README.md` 删除列全为 0；`git grep -c "Superseded by" -- docs/product/vertical-path.md` ≥ 3 |
| B0-6 | R1 编号与出处 token 不漂移 | `node --test tests/integration/execution-relation-write-schema.test.js` exit 0 |
| B0-7 | 计划章节齐全 | `grep -n '^## ' docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 依次为 `PLANS.md` §3 的 13 个标题，无其他 `##` 标题；#217 验收第 3 条 |
| B0-8 | #217 验收第 4 条 | `node --test tests/mvp0` 为 `ℹ tests 7`、`ℹ fail 0`；`node --test tests/contract/content-placement.test.js` exit 0；`git diff --check origin/main...HEAD` exit 0 |
| B0-9 | 规模与"只改文档" | 下方 B0-9 代码块：非 `.md` 改动为空；docs ≤ 1300、code 0；`node scripts/rule-checks.mjs size origin/main` exit 0 |
| B0-10 | 发布面与关闭关键字 | 下方 B0-10 代码块：本机路径无命中；关闭关键字无命中（提交正文不写关闭关键字，关闭 #217 只在 PR 正文尾注）；`node scripts/rule-checks.mjs disclosure origin/main` exit 0 并完成人工五类目 |
| B0-11 | 读 active 计划的契约测试 | `node --test tests/contract/plan-facts-consistency.test.js tests/contract/e1-evidence-consistency.test.js tests/contract/board-status-semantics.test.js tests/contract/content-placement.test.js` exit 0；`node --test tests/contract` 在工作树里只允许 S-1 记录的那条环境失败 |

```bash
# B0-9
git diff --name-only origin/main...HEAD | grep -v '\.md$'          # 期望：无输出
git diff --numstat origin/main...HEAD | awk '{ if ($3 ~ /^docs\// || $3 ~ /\.md$/) d += $1 + $2; else c += $1 + $2 } END { print "docs", d + 0, "code", c + 0 }'
# 期望：docs ≤ 1300，code 0
# B0-10
git diff origin/main...HEAD | grep -nE '/(Users|home|private)/'    # 期望：无输出（正则不含字面路径，避免命中本行）
git log --format=%B origin/main..HEAD | grep -niE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+#[0-9]+'
# 期望：无输出（关闭 #217 只写在 PR 正文尾注）
```

### 复现命令（P1–P5）

在装好依赖的 checkout 根目录运行（`.worktrees/<slug>` 下先跑解析守卫，并用 B0-9 证明包代码与 base 相同）。期望值是 `main@f6a33d2` 上 2026-09-29 的观察；对应批次修复后应改变。

```bash
# P1 Draft→Issue：替身侧晋升后，生产同步路径新建实体（附行、R1 第 4 条）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders, fixtureProjectRef } from '@harness-projects/provider-fake'
const providers = createFakeProviders(); const { planning } = providers
planning.addItem(fixtureProjectRef(planning.bindingId), 'draft', '草稿项', '草稿正文')
const api = await composeCore({ workspace: { name: 'probe' }, providers })
const draft = (await api.queries.listPlanningItems()).find((v) => v.content.identity.externalKind === 'draft')
const n0 = providers.storage.data.entities.length
planning.promoteDraft(planning.state.items.find((i) => i.ref.externalId === draft.content.identity.externalId).ref, 'issue-100')
await api.commands.bootstrapWorkspace()
const promoted = (await api.queries.listPlanningItems()).find((v) => v.content.identity.externalId === 'issue-100')
console.log('entities', n0, '->', providers.storage.data.entities.length, '| same entity?', promoted?.entityId === draft.entityId)
"
# 观察：entities 6 -> 7 | same entity? false

# P2 相同输入的引导推进修订号（#220、R1 第 7 条）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
const api = await composeCore({ workspace: { name: 'probe' }, providers: createFakeProviders() })
const a = await api.commands.bootstrapWorkspace(); const b = await api.commands.bootstrapWorkspace()
console.log('revision', a.revision, '->', b.revision, '| entities', a.entities, '->', b.entities)
"
# 观察：revision 2 -> 3 | entities 5 -> 5（组合时已引导一次，修订号从 1 起）

# P3 交付首读写关系、离线丢 CI（#221、#222；第 10、13 行）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { FaultKind, createFakeProviders, refOf } from '@harness-projects/provider-fake'
const providers = createFakeProviders()
const api = await composeCore({ workspace: { name: 'probe' }, providers })
const workItemId = (await api.queries.listPlanningItems()).find((v) => v.kind === 'work_item').entityId
const started = await api.commands.startWork({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'p3' })
await providers.development.createChangeRequest({ repository: refOf(providers.development.gate.bindingId, 'repository', 'repo-alpha'), head: started.branchExternalId, base: 'main', title: 'p3', body: 'p3' })
const scope = { workItemId, repositoryId: 'repo-alpha' }
const ci = (p) => p.hops.filter((h) => h.entityKind === 'pipeline_run' || h.entityKind === 'check_run').length
const r0 = providers.storage.data.relations.length
const online = await api.queries.getDeliveryProjection(scope)
const r1 = providers.storage.data.relations.length
providers.delivery.faultsSwitch.set(FaultKind.Offline, true)
const offline = await api.queries.getDeliveryProjection(scope)
console.log('relations', r0, '->', r1, '| ci online', ci(online), '| ci offline', ci(offline), '| degraded', offline.degraded)
"
# 观察：relations 2 -> 9 | ci online 5 | ci offline 0 | degraded true

# P4 同幂等键换工作项仍报 saved（#194；第 6 行、R1 第 6 条）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { createFakeProviders } from '@harness-projects/provider-fake'
const api = await composeCore({ workspace: { name: 'probe' }, providers: createFakeProviders() })
const [a, b] = (await api.queries.listPlanningItems()).filter((v) => v.kind === 'work_item')
const req = (workItemId) => ({ workItemId, repositoryId: 'repo-alpha', actor: { kind: 'agent' }, idempotencyKey: 'same-key' })
await api.commands.startWork(req(a.entityId))
const second = await api.commands.startWork(req(b.entityId))
const ctx = await api.queries.getExecutionContext({ workItemId: b.entityId, repositoryId: 'repo-alpha' })
console.log('second', second.writeState, '| context for b?', ctx !== undefined)
"
# 观察：second saved | context for b? false

# P5 换 Planning 源后旧源投影残留（#202；R1 第 1 条）
node --input-type=module -e "
import { composeCore } from '@harness-projects/core'
import { newWorkspaceId } from '@harness-projects/domain'
import { createFakePlanningProvider, createFakeProviders } from '@harness-projects/provider-fake'
const workspace = { id: newWorkspaceId(), name: 'probe' }
const providers = createFakeProviders()
const first = await composeCore({ workspace, providers })
const before = (await first.queries.listPlanningItems()).length
const old = (await providers.storage.listProviderBindings(workspace.id)).find((b) => b.domain === 'planning')
await providers.storage.putProviderBinding({ ...old, enabled: false, isDefault: false })
const second = await composeCore({ workspace, providers: { ...providers, planning: createFakePlanningProvider() }, storage: providers.storage })
console.log('items', before, '->', (await second.queries.listPlanningItems()).length)
"
# 观察：items 5 -> 10
```

### 变异规程（M1、M3、M9、M10）

变异只在导出的临时目录做，不改任何 checkout 或工作树里的文件。`SCRATCH` 是执行者自己的、仓库之外的临时目录；本机 `cp` 可能带交互别名，一律写 `/bin/cp`。

```bash
common=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)   # 装有 node_modules 的主 checkout
rm -rf "$SCRATCH/export" && mkdir -p "$SCRATCH/export/node_modules/@harness-projects"
git archive HEAD | tar -x -C "$SCRATCH/export"
for l in "$common"/node_modules/@harness-projects/*; do /bin/cp -P "$l" "$SCRATCH/export/node_modules/@harness-projects/"; done
cd "$SCRATCH/export" && node --input-type=module -e "console.log(import.meta.resolve('@harness-projects/core'))"
# 期望：路径以 $SCRATCH/export/packages/core/ 开头；随后 node --test tests/mvp0 为 ℹ tests 7 / ℹ fail 0
```

每个变异：用 `node -e` 做字符串替换，替换前后内容相同即以 `MUTATION NOT APPLIED` 失败退出；`git -C "$common" show HEAD:<path> | diff - <path>` 打出非空 diff；跑指定用例；用 `git -C "$common" show HEAD:<path> > <path>` 还原，`cmp` 一致后复跑该用例变绿。

| 编号 | 变异 | 期望变红 | 期望不变 |
|---|---|---|---|
| M1 | `packages/core/src/identity.ts` 的 `promoteEntityIdentity` 成功分支返回另一个 `entityId`（2026-09-29 定稿时用同样的导出方式实测：该用例 1/1 变红、mvp0 7/7；当时用副本还原并 `diff -q` 核对） | chain-bootstrap「身份：Draft→Issue 提升只换外部 id」 | `node --test tests/mvp0` 仍 7/7（TD-001 的证据） |
| M3 | `packages/core/src/status-policy.ts` 的 `decideFromEngineeringFact` 返回 `incoming` 且 `wrote: true` | status-policy「工程事实（CI 失败 / 执行完成 / PR 合并）」；mvp0「节点 7」 | — |
| M9 | `rerunPipeline` 在交付方不支持时仍写一次本地状态（例如推进修订号）；若该用例比较的存储导出抓不到任何一种本地写入，R1 第 9 行降为"部分" | delivery-lineage「只读交付方」 | — |
| M10 | `packages/providers/fake/src/storage.ts` 导出状态时丢掉执行上下文 | start-work「重启：同一份 Storage 内容上的新 core」；human-execution-provider「重启：同一份 Storage 上重建 core」 | — |

## Progress

- [x] (2026-09-30) #240 关闭 #203 前更新 R1 第 8 行：旧 v9/v10 端口反例变为入口拒绝，规范时间戳在两个 Storage 上按时间序；旧库迁移、拒绝与备份恢复已验证。R1 汇总当前为部分 6、反例 4，core 乱序注入仍缺，控制计划与人工门禁继续 active。

- [x] (2026-09-30) B0.7：修复 review `5360350058` 的管道退出状态建议，按文档原样执行正反对照，并在两个 shell 上复跑进程级失败；27 条聚焦测试通过。共享历史整理前保存完整树，按一个文档交付物收敛提交，再以精确 lease 推送；最终 head 的 checks、线程、issue 和 reviewer 批准均需重新回读。

- [x] (2026-09-29 08:55 CST) 建立隔离工作树与 ExecPlan 骨架；调查仓库权威文档、代码、迁移、测试与开放 issue，区分真实偏移与有意分期。
- [x] (2026-09-29 09:18 CST) 两轮作者侧语义复审，修订旧 [1] 库逃逸、事件正确性依赖、缓存键先后、过渡双写与文件边界。
- [x] (2026-09-29 14:15 CST，`main@f6a33d2`，分支 `docs/system-architecture-renewal@81a2cbc`) 基线观察：在主 checkout 根目录 `node --test tests/contract tests/integration tests/e2e` 为 `ℹ tests 757` / `ℹ fail 0`；在本工作树根目录 `node --test tests/mvp0` 为 `ℹ tests 7` / `ℹ fail 0`，`node --test tests/contract/content-placement.test.js` 为 6/6，`git diff --check origin/main...HEAD` exit 0，`node scripts/workflow-check.mjs` exit 0。重算即重跑同一命令；Node 版本 v26.10.0。
- [x] (2026-09-29) Batch 0 的 B0.1：三份独立设计（纵向矩阵、计划校准、R1 映射）经独立评审定稿；P1–P5 在主 checkout 复现，M1 按变异规程的导出方式实测；0.3、0.4 初值引用的 47 个"文件 + 前缀"在本工作树逐条回读，每条 `ℹ tests` 为 1（`storage-contract` 的套件用例为 2，两个适配器各一）、`ℹ fail 0`；本计划与 `docs/README.md` 索引行按定稿改写，B0-7、B0-8、B0-11 与 `node scripts/workflow-check.mjs` 在未提交的工作区上通过。（B0.5 注：这次回读没有带 `--test-isolation=none`，无匹配也会读回 `ℹ tests 1`，因此不能证明引用有效，见 S-11；B0.5 用判别命令重跑。）
- [x] (2026-09-29) Batch 0 的 B0.2：见 `Plan of Work` 的 B0.2 条目；恢复锚点 `a50d7b8`，推送后 head `15c338a`，draft PR #239。
- [x] (2026-09-29 19:25 CST) Batch 0 的 B0.3：三条本地子分支都从 `15c338a` 分出，各在 `.worktrees/prelaunch-b0-{debt,r1,matrix}/`。T3 `docs/prelaunch-b0-debt` 登记 TD-001 至 TD-003；T2 `docs/prelaunch-b0-r1` 写 §2.1.1 与两段 Superseded，复跑 P1、P2、P4、P5 与 #203 端口探针，在导出目录做 M1、M3、M9、M10；T1 `docs/prelaunch-b0-matrix` 写 §2.1、三段 Superseded、§3 注与 `tests/mvp0/README.md` 两段 Superseded，复跑 P1、P3、P4 并新增 X1。计划写"各提交一次"，实际各两次：对抗验证第一轮后三条分支各追加一次订正回读命令的提交。
- [x] (2026-09-29) Batch 0 的 B0.4：B0-T4 只读三条分支。第一轮 fail：P2——B0-2 的回读命令不能发现失效引用（S-11），三条分支各自修正；P3——R1 第 5、10 行"已断言"偏强（同一行的缺口写明断言没有触达生产路径或真实持久化）、矩阵第 3 行成功列有两条用例没有经过 `commands.bootstrapWorkspace`、`release-gates.md` §2.2 的过期计数没有标注、提交的 Co-Authored-By 模型名不一致。复验 pass，余一条 P3：本计划的 B0-2 判据仍是旧命令（三处）。子任务留下的待定：第 3 行是否改判为 #199 反例、第 4 行 #218 与第 6 行 #196 只有 issue 记录、R1 第 8 条 #203 只在端口层可复现。
- [x] (2026-09-29 19:39 CST 起) Batch 0 的 B0.5（验收者）：先建本地引用 `backup/system-architecture-renewal-b05-15c338a` 指向 `15c338a`；按 T3 → T2 → T1 摘取 6 个提交，`comm` 比对摘取前后 `git diff --name-only origin/main...HEAD`：摘取前 3 个文件（本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`）不变，新增恰为 `docs/architecture/release-gates.md`、`docs/product/vertical-path.md`、`tests/mvp0/README.md`，与 Batch 0 文件所有权逐一相等，且每个文件与其子分支上的同名文件 `git diff --quiet` 相同。按 B0.4 的发现只往保守方向改（清单见 Decision Log 的 B0.5 条目）；在导出目录复跑 P1–P5、#203 端口探针、X1、X2（#199）、X3（#218），观察值与文档一致；M1、M3、M9、M10 按变异规程重做，每个先打出非空 diff、指定用例 `ℹ fail 1`、还原后 `cmp` 一致并复跑 `ℹ fail 0`，M1 下 `node --test tests/mvp0` 仍 7/7。B0-1 至 B0-11 的结果见 `Outcomes & Retrospective`；摘取与收口整理成按所有者划分的提交，在 `15c338a` 之后快进推送，最终 head 以 PR #239 的回读为准。

- [x] (2026-09-30) Batch 0 的 B0.6（评审响应，review 5353108706；执行者）：主会话已把分支变基到 `main@699d715`（变基前 head `045365d`，文件集合不变），本批在其上只改 `.md`。① P1（第 13 行）：入口格与用例格改为逐项指向 `commands` / `queries`，表后新增 13.1–13.10 故障面表（已交付 2、部分 3、反例 3、未交付 2），行级结论按最弱者仍为反例（P3、P4），行级计数不变（已交付 0、部分 6、反例 5、未交付 3）；B0-1 的验收表述同步。② P2（回读命令）：改为直接运行测试文件（不加 `--test`）加 `--test-reporter=spec`，不依赖 `--test-isolation`；`vertical-path.md`、`release-gates.md` §2.1.1、本计划 0.3 / 0.8 / B0-2、TD-003 同步，负对照保留。引用的"文件 + 前缀"现为 71 组（B0.5 时 62 组，新增 9 组：resume 三条、branch-probe 两条、write-machine reconcile、取消两条、development-contract 权限被拒与离线），在本机 Node v26.10.0 上逐条回读，全部退出码 0、`ℹ tests` ≥ 1（`storage-contract` 5 组读回 2）、`ℹ fail 0`、有含前缀的 `✔` 标题行；22 个被引用文件的伪造前缀各读回 `ℹ tests 0` 且无 `✔` 行。③ 第 7 行：`main@699d715` 新增的 `local-git-start-work-resume`、`local-git-branch-probe` 调用 core 的 `startWork` 函数（手工 `createContext`、没有 Planning 绑定），按 0.2 仍是旁证，行结论仍是部分；R1 第 9、10 行的缺口同批改写，结论不变。④ 观察基线改为 `main@699d715`：P1–P5、X1–X3 与 #203 探针在 `git archive` 导出目录里重跑，观察值与原文一致；M1、M3、M9、M10 在同一导出目录重做，每个先打出非空 diff、指定用例 `ℹ fail 1`、还原后一致并复跑 `ℹ fail 0`，M1 下 `node --test tests/mvp0` 仍 7/7。B0-1 至 B0-11 的结果见 `Outcomes & Retrospective`。
- [x] (2026-09-30 00:34 CST 起) Batch 0 的 B0.6（验收者复核）：执行者提交 `f7909e1` 未推送；验收者按评审原条件独立复跑。① P1：逐个打开第 13 行引用的用例体，确认 13.1、13.2、13.4、13.6、13.9 的用例经 `composeCore` + `commands` / `queries`（或 controller `baseline()`），13.8 的 `FaultKind.OutOfOrder` 无用例、`DuplicateEvent` 不经 core；在工作树（包解析落在主 checkout，其 HEAD 为 `main@699d715` 且干净，本 PR 不改测试代码）按文档命令重跑 P1、P3、P4、X1、X2、X3，观察值与文档逐字一致。订正两处：13.3 原写"经入口的用例：无"，但 start-work-retry-identity「重试：可清除的失败之后」与 start-work-step-recording「conflict 后列表读取失败只报 unknown」都经 `commands.startWork` 让 Development 方法返回 `unavailable`（替身离线故障的同一错误码），改为引用这两条（简称表补 `start-work-step-recording`）并把缺口写窄为"权限被拒没有经入口的用例；离线只有手工注入"（S-18）；13.7 的入口格原写 `commands.applyPlanningStatus`、结论却是"未交付"，改为"无"并写明该命令不调用 Planning provider 的任何写方法（`git grep` 五个写方法名在 core / controller / client 无命中）。两处结论与计数都不变。② P2：用脚本从 §2.1 与 §2.1.1 抽出全部"文件 + 前缀"（表内另有两处「」是节内回指，不是用例引用），执行者提交上去重后 71 组、22 个文件，13.3 订正后 72 组、23 个文件；按新命令在 Node v26.10.0 逐条回读：72/72 退出码 0、`ℹ fail 0`、有含前缀的 `✔` 标题行、无 `✖`，`ℹ tests` 为 1 的 67 组、为 2 的 5 组（`storage-contract`）；23 个文件的伪造前缀全部读回 `ℹ tests 0` 且无 `✔`；对照组加 `--test` 时伪造前缀读回 `ℹ tests 1`。Node 22 的文档核对见 S-15 的补注；未实跑。③ 第 7 行：打开 `local-git-start-work-resume`、`local-git-branch-probe` 与 `local-git-fixture.js`，二者从 `@harness-projects/core` 导入 `startWork`，经 `coreContextFor`（`createContext`，只接 Development）调用，不经 `composeCore` / `commands`，按 0.2 仍是旁证，不改判。④ 其余订正：TD-003 遗留影响列的旧判据措辞、Decision Log 里被取代的 `--test-isolation=none` 一行加取代标注、`vertical-path.md` 的 Node 说明补文档依据。

**待人类裁决**（除 H1 外都不改变 Batch 0 的写入文件；未裁决前按括号里的默认做法执行，裁决后写入 Decision Log）：

- H1：MVP-0 通过条件是否从"`tests/mvp0` 全绿且计数非零"改为同时要求 `vertical-path.md` §2.1 每行不为"未交付"或"反例"，并据此确认 MVP-0 当前不满足（默认：只加"注"，不改判定命令；另一份 active 计划的同义表述见 S-9）。
- H2：Draft→Issue 生产入口没有承接 issue；是否新建（例如 `feat(core): carry membership identity through bootstrap so a converted draft keeps its work item`），挂在 #216 还是 M4 的 #70 / #134 下，是否阻塞 #70（默认：矩阵附行写"无承接 issue"，agent 不写 GitHub）。
- H3：第 9 步在 Demo 期间是否把 MVP-1 口径改为"关联已有变更请求"、"创建"留到 #235（默认：不改 §2 产品规格）。
- H4：R1 §2.1 的断言在哪一层才算数（端口、纯函数、core 辅助函数是否算"已断言"）（默认：写明层，不替人类判定）。B0.5 起：第 5 条只在纯函数层、第 10 条只在内存 Storage 上，按缺口所在层记为"部分"；第 8 条的反例（#203）只在 Storage 端口层可复现、当前没有生产路径触达，仍记"反例"；三者都随 H4 的裁决复核。
- H5：#215 是否纳入 #216 作为 Batch 4 的第四次交付（默认：不纳入）。
- H7：是否允许本 PR 顺带修改 mvp0 节点 3 标题与文件头（约 5 行测试代码）（默认：不改，归 TD-001 / #224）。
- [ ] Batch 1（#218）。
- [ ] Batch 2：2A–2E（#197 #219 #189 #198 #203 #202 #199 #220）。
- [ ] Batch 3：3A/3B（#221 #222）。
- [ ] Batch 4（#194 #204 #191）。
- [ ] Batch 5（#223）。
- [ ] Batch 6（#224）。
- [ ] Batch 7（#9 #8）与归档。

## Surprises & Discoveries

- **S-19 管道可吞进程级失败**：原配方在用例通过但 Node `process.exitCode=7` 时输出 `✔ / tests 1 / fail 0` 且整个管道退出 0。只读输出不能代替 Node 退出码；B0.7 在子 shell 中同时启用 `errexit` 与 `pipefail` 后，同一反例使整个块退出 7，正常与零匹配对照仍退出 0。

- **现有全绿仍有可复现反例**。在内存替身上观察到：重连期间接受 revision 2 后，迟到的 revision 1 baseline 把 store 回退（#218）；交付首次查询使关系数 2→9、Delivery 离线后 5 条 CI 跳消失（P3）；相同 bootstrap 输入使 revision 前进而实体仍为 5（P2）。
- **S-1 工作树的包解析落在上级 checkout**。`.worktrees/system-architecture-renewal` 没有 `node_modules`，`import.meta.resolve('@harness-projects/core')` 解析到主 checkout 的 `packages/core/src/index.ts`（#186）。纯文档分支无害，但行为批次在工作树里的红→绿与变异会测到别的代码。同一原因使 `node --test tests/contract` 在工作树里有 1 条环境失败：`tests/contract/workflow-check.test.js`「CLI：脚本路径含空格时仍然真的执行检查」符号链接不存在的 `node_modules`（工作树 607/608；主 checkout 全过）。
- **S-2 Draft→Issue 在生产同步路径上换了实体**。P1：替身侧 `promoteDraft` 后再 `bootstrapWorkspace`，实体 6→7、新 issue 的 `entityId` 与原 draft 不同。根因事实：core 以条目 ref（内容身份）调 `ensureEntity`，`packages/core/src` 没有任何成员关系读写，`ProviderPlanningItem` 也不携带成员关系 id；`docs/architecture/gate-e1-ruling.md` §2.3 记录平台侧成员关系 id 不变、内容 id 改变。
- **S-3 真实平台下 Draft→Issue 的表现是假设**。`planning-github-projects` 是 8 行占位；真实 provider 把成员关系 id 还是内容 id 放进 `ref`、core 是否据此保持实体，都未实现也未验证，不能写成"真实平台结果相同"。
- **S-4 #194 在 `main@f6a33d2` 仍可复现**（P4）：同幂等键换工作项得到 `saved`，第二个工作项没有执行上下文。它同时是矩阵第 6 行与 R1 第 6 条的反例。
- **S-5 #202 可复现**（P5）：停用旧 Planning 挂载、换新源后 `listPlanningItems` 从 5 变 10。
- **S-6 controller 查询面比 core 窄**：没有 `getItemDetail`、不暴露 `cancelExecutionRun`、不转发交付投影的 `degraded` / `optional`。
- **S-7 故障注入覆盖不均**：`OutOfOrder` 从未被测试使用；`duplicateEvent` 只在 provider 契约层；`permissionDenied` 经 core 只在执行域。
- **S-8 mvp0 节点 3 标题过强**：M1 下 chain-bootstrap 的提升用例变红而 `tests/mvp0` 仍 7/7（TD-001）。
- **S-9 另一份 active 计划复述了 MVP-0 判定**：`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` 的里程碑表写 MVP-0 以 `node --test tests/mvp0` 全绿判定；它由该计划的所有者维护，本批不改，并入 H1 一起裁决。
- **S-10 会读 active 计划的契约测试**：`e1-evidence-consistency`、`board-status-semantics`、`plan-facts-consistency`（只管 09-23/24 计划）按内容或文件名扫描计划；写计划时要避开 E1 沙箱 id 字面量与 Status 旧读法。
- **旧迁移"版本号一致"不代表表形一致**。`packages/storage/sqlite/src/migrate.ts` 只按版本清单跳过已应用版本；四版压为一版后，旧 [1] 会被误判为已完成，新基线必须带世代标记。
- **源码扫描也可能制造假证据**。`tests/contract/content-placement.test.js` 只检查两张表与反引号 token，不是通用链接检查；`board-status-semantics.test.js` 部分断言锁句式；`storage-contract.test.js` 有大段源码行多重集。
- **本机 `pnpm verify` 的环境阻塞发生在测试前**：非 TTY 下拒绝清理 `node_modules`，退出 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`；直接的 TypeScript 与 Node 测试可跑通。
- **S-11 按名回读在默认进程隔离下恒为绿**（B0.4 发现，B0.5 复核）。Node v26.10.0 上 `node --test --test-name-pattern="<前缀>" <文件>` 在前缀一条用例都没匹配上时仍输出 `ℹ tests 1` / `ℹ pass 1` / `ℹ fail 0`、退出 0：测试文件本身被计成一条通过的测试，`✔` 行是文件路径。加 `--test-isolation=none` 后无匹配读回 `ℹ tests 0`。B0.1 的"47 条逐条回读"因此没有判别力；B0.5 用判别命令对 §2.1 与 §2.1.1 的 62 组"文件 + 前缀"逐条重跑，全部 `ℹ tests` ≥ 1、`ℹ fail 0` 且有标题行，伪造前缀读回 `ℹ tests 0`。（B0.5 选的 `--test-isolation=none` 在 Node 22 上不可用，B0.6 已换成不依赖它的判据，见 S-15。）
- **S-12 组合期引导会遮住生产入口**。`composeCore` 在组合时已经引导一次，只在组合后读 `listPlanningItems` 的用例没有经过 `commands.bootstrapWorkspace`；矩阵第 3 行成功列的「引导：一个条目一个成员」「内容三态：redacted 条目」就是这种情况（改记旁证：组合期）。"PR 条目成为变更请求实体、不产生第二个工作项"目前只有这条组合期旁证。
- **S-13 #199、#218、#196 在替身上经生产入口可复现**。X2：替身 Planning 投递一个非 ASCII 的 `sourceVersion` 后，`commands.bootstrapWorkspace` 抛出裸 `Error`，同步游标仍是 healthy，列表不标陈旧；X3：重连期间迟到的基线把 client 从修订 2 退回 1，旧值仍报 current；X1：不存在的工作项报 `saved` 并落 ready 上下文。另：经 `composeCore` 装配 SQLite Storage 后，连已登记工作项的 `startWork` 也抛驱动层 `FOREIGN KEY constraint failed`（仓库没有登记，#188），所以 #196 的 SQLite 侧形态在当前组合下无法单独归因，矩阵第 6 行只以替身侧 X1 为据；这也是 R1 第 10 条"core 与 SQLite 组合无用例"（#141）之外的又一个缺口。
- **S-14 `tests/integration` 在 #175 之后增长**：11 个文件、`ℹ tests 110`（`release-gates.md` §2.2 原记 8 个、69 条）；`tests/e2e` 仍为 8 个、39 条。
- **S-15 B0.5 的回读判据在受支持的 Node 22 上跑不了**（评审发现，B0.6 处理）。`package.json` 声明 Node ≥ 22.0.0，而据 Node 官方 CLI 文档，`--test-isolation` 到 v23.6 才出现，v22 系列只有 v22.8 起的 `--experimental-test-isolation`（v22.0 至 v22.7 两者都没有），所以 B0.5 把 `--test-isolation=none` 写进 §2.1、§2.1.1、B0-2 与 TD-003，等于把验收前置抬到了未声明的 Node 版本。B0.6 的做法：不再用 `node --test`，直接把测试文件当脚本运行（`node --test-reporter=spec --test-name-pattern=… <文件>`），没有文件级包装，无匹配就读回 `ℹ tests 0`；只用两个 Node 22 之前就有的选项。本机只有 Node v26.10.0，这条命令与全部回读只在它上面实跑，Node 22 的行为（尤其是 spec 报告是否带 `ℹ tests` 摘要行）依据官方文档、未实跑；文档里给了摘要行缺失时的兜底判据（退出码 0、含前缀的 `✔` 标题行、无 `✖`）。验收者补注（只读官方文档，未安装其他 Node）：Node 仓库 `v22.x` 分支的 `doc/api/cli.md` 只有 `--experimental-test-isolation`，记 `added: v22.8.0`；`v23.6.0` 标签下同一文件记该选项在 v23.6.0 由 `--experimental-test-isolation` 改名为 `--test-isolation`；v22.0.0 的 CLI 文档已有 `--test-name-pattern`（v18.11.0 起）与 `--test-reporter`（v19.6.0、v18.15.0 起），两种隔离选项都没有；v22.0.0 的 test 文档写明未被执行的用例不出现在报告输出里、非 TTY 下默认 tap 报告。所以负对照按文档在 v22.0 上也应读回 0，命令必须显式写 `--test-reporter=spec`。
- **S-16 第 13 行的形态与结论不对齐**（评审发现，B0.6 处理）。原第 13 行的入口格写"无新增动作；横跨第 3–12 行的失败面"，结论却是"反例"：既没有入口，也没有标"未交付"，读者无法复现第 13 步的生产路径。这一行其实是十个互不相同的故障面，各自的入口、经入口的证据与结论并不一致（有 2 面已交付、2 面没有生产入口），并成一行会把它们的差别抹平，也让"反例"的来源（P3 的 `queries.getDeliveryProjection`、P4 的 `commands.startWork`）看不出来。
- **S-17 `main@699d715` 新增的真实 Git 用例调用的是 core 的 `startWork` 函数，不是 `commands.startWork`**。`local-git-start-work-resume.test.js` 与 `local-git-branch-probe.test.js` 经 `createContext`（手工装配，只接 Development 一个 provider，没有 Planning 绑定）调用 `startWork(context, request)`；`commands.startWork` 在 `composeCore` 里正是对同一个函数的一行委托，但 `composeCore` 还会先引导一次规划、经 `commands` 命名空间暴露。这些用例覆盖完整供应序列（认领、分支步、回填、接管、失败保留分支），强于只跑 `provisionGit` 的旧用例，仍是 0.2 意义上的旁证：工作项 id 是任意字符串，core 不校验它是否存在（X1）。它们没有覆盖脏工作树拒绝，因此第 7 行仍是"部分"。
- **S-18 按故障开关搜索会漏掉手工注入的同类失败**（B0.6 验收发现）。替身的 `FaultKind.Offline` 在 `gate.ts` 与 `planning.ts` 里就是返回 `ProviderErrorCode.Unavailable`；`tests/integration/start-work-retry-identity.test.js` 与 `start-work-step-recording.test.js` 不用故障开关，而是手工替换 `createWorktree` / `listBranches` 让它返回同一个错误码，并且都经 `composeCore` + `commands.startWork`。只 `grep FaultKind` 得出的"13.3 经入口的用例：无"因此偏强（原文已订正）。以后核对"某故障没有经入口的用例"时，要同时按故障开关与 `ProviderErrorCode.*` 搜索。

## Decision Log

2026-09-30 / 执行者：#203 的修复由后合并的 #240 同步更新 `release-gates.md` 第 8 行和历史探针取代标注，满足本计划的同 PR 更新纪律；原 Batch 0 的部分 5 / 反例 5 是历史快照，**Superseded by** 新表当前部分 6 / 反例 4。其余用户链路反例没有因载体修复消失。

2026-09-30 / 人类伙伴与执行者：人类明确要求 #239、#240 修复并 rebase merge。#239 的 Batch 0 文档是一个可回滚交付物，最终提交整合为一笔；原先保留八提交和“不合并”的记录仅描述当时阶段，**Superseded by B0.7**。先保留本地备份，核对产品代码零变化及文档差异，再精确 lease 推送；控制计划仍 active，功能批次没有因此交付。

| 日期/作者 | 决策 | 理由 |
|---|---|---|
| 2026-09-29 / 计划作者 | 一份 Active ExecPlan 控制本轮，由多个独立 PR 按事实边界交付 | 一个巨型 PR 不满足规模、回滚与评审约束 |
| 2026-09-29 / 计划作者 | 公开依据以 `AGENTS.md`、产品/架构文档、ADR、代码与测试为准，不依赖不随仓库分发的输入 | 仓库 `docs/` 必须自包含；Gate E1 实测已正当地修订早期表形 |
| 2026-09-29 / 计划作者 | 先修权威/行为，再合 SQL 与删兼容形状 | 已有绿色测试漏掉用户可见的重连与交付离线偏移；先删会锁住错误 |
| 2026-09-29 / 计划作者 | 允许发布前旧库不兼容，但以库清单与数据保留判据作执行门 | 未上线取消兼容承诺，不授权静默丢本机开发或证据数据 |
| 2026-09-29 / 计划作者 | 前置 Binding/作用域裁决；事件去重与全量权威对账分开 | 交付缓存键依赖连接/工作空间身份；事件可缺失，不是正确性的唯一来源 |
| 2026-09-29 / 计划作者 | 新空库 001 保留版本号 1，但增加 schema generation 预检 | 旧 [1] 与新 [1] 仅按版本不可区分 |
| 2026-09-29 / 计划作者 | 3A 只合入已实现行为的绿测试，3B 再把纯读反例先红后绿 | 每个 PR 必须可独立合并；不以 skip/todo 掩盖过渡状态 |
| 2026-09-29 / 人类伙伴 | 指定流程：多个独立子 agent 设计 → 独立评审定稿写 ExecPlan → draft PR 关联 issue → Sonnet 在各自 worktree 并行 TDD 与对抗验证 → Opus 验收重构 → 请人类评审 PR | 人类伙伴本轮指令；Batch 0 的 B0.1–B0.5 按此排布；模型分工只适用于本轮，不是仓库默认（`AGENTS.md` §5） |
| 2026-09-29 / 人类伙伴 | 规划弹性上限：每个 PR 代码 ≤ 800、文档 ≤ 1300 行；CI 硬上限代码 1000 / 文档 1500 保持不变 | 本轮指令。人类伙伴同日订正：1000/1500 是 CI 硬上限，800/1300 是给评审与后续优化留余量的弹性上限，二者不冲突，不同步根规则（原待裁决项 H6 因此撤销） |
| 2026-09-29 / 人类伙伴 | 看板 `Status`：#217 由 `Todo` 改为 `In Progress`，由 agent 在开 draft PR 时写入并回读 | `AGENTS.md` §7：点名目标（#217）的人类批准，记入本表；工程事件本身不推进 `Status` |
| 2026-09-29 / 人类伙伴 | #203 从 2C 拆出，作为 `#203 → #70` 栈底单独交付；#227 叠在 #225 上 | 迭代 3 的并行 / 堆叠划分：#70 与 #227 各自只被一条 issue 阻塞，叠栈可把 Demo 关键路径前移；2C 其余部分不变 |
| 2026-09-29 / 定稿评审者 | Batch 0 收窄到 #217：只改 `.md`；不改 `tests/mvp0/chain.test.js`、`docs/architecture/README.md`，"上游能力意图"表移到 Batch 7 | #217 排除行为变更；该表依赖不随仓库分发的输入 |
| 2026-09-29 / 定稿评审者 | 采用 0.2 的生产入口判据、旁证规则与两套封闭词表；多情况取最弱者；只能往保守方向修正 | 三份设计对同一行给出三种结论，根因是没有共同判据；词表让证据与裁决分离 |
| 2026-09-29 / 定稿评审者 | 矩阵行只按自身观察面判，R1 反例归 §2.1.1 并在承接列交叉引用 | 避免把 #220 这类 R1 第 7 条反例记成第 3 行反例，也避免漏记 |
| 2026-09-29 / 定稿评审者 | 第 6 行与 R1 第 6 条判反例（#194），R1 第 4 条判反例（P1），R1 第 1 条判反例（#202） | P4、P1、P5 在 `main@f6a33d2` 实测复现；R1 §1 规定存在反例即不满足 |
| 2026-09-29 / 定稿评审者 | §3 判定表只加"注"、不标 Superseded，也不改判定命令 | 命令仍如实执行；是否改 MVP-0 通过条件是门禁定义变更，归人类（H1） |
| 2026-09-29 / 定稿评审者 | 变异只在导出临时目录做，规程见 `Validation and Acceptance` | S-1：工作树解析落到主 checkout，就地变异会改到别人的代码或测不到自己的代码 |
| 2026-09-29 / 定稿评审者 | #215 移出 Batch 4 的默认范围 | #215 在 M4，不在 #216 子 issue 图内；是否纳入待定（H5） |
| 2026-09-29 / B0-T1 实施者 | 矩阵第 8 行由初值"已交付（替身 + 真实 execution-human、development-local-git，集成）"降为"部分：会话状态没有经查询的可见面" | `ExecutionContextView` 没有运行状态字段，运行状态只能经 `storage.getExecutionRun` / `provider.getRun` 读（旁证）；属保守修正，验收者接受 |
| 2026-09-29 / 验收者 | R1 第 5、10 条由"已断言"降为"部分"，并写明缺口所在层：第 5 条只在纯函数层（决策函数没有生产调用者），第 10 条只在内存 Storage 上（core 与 SQLite 组合无用例，#141） | B0.4 的 P3：同一行的缺口已写明断言没有触达生产路径或真实持久化，"已断言"偏强；0.2 允许往保守方向修正。M3、M10 仍能打红，保留为补充证据。R1 汇总变为已断言 0、部分 5、反例 5、未验证 0 |
| 2026-09-29 / 验收者 | 矩阵第 3 行由"部分：写侧拒绝"改为"反例：#199（X2）"；成功列的「引导：一个条目一个成员」「内容三态：redacted 条目」改记"旁证：组合期" | X2 在替身上经 `commands.bootstrapWorkspace` 复现 #199：同步失败时游标仍是 healthy、列表不标陈旧，违反该行"读侧降级并标记陈旧"；两条用例只读组合期那次引导（S-12），按 0.2 不能算经入口的成功形态 |
| 2026-09-29 / 验收者 | 第 4 行 #218、第 6 行 #196 由"issue 记录的复现"改为本轮复跑（X3、X1），结论不变 | X3、X1 在 `main@f6a33d2` 的导出目录复跑，观察与 issue 描述同形态；#196 的 SQLite 侧不引用（S-13） |
| 2026-09-29 / 验收者 | R1 第 8 条保持"反例（#203）" | 端口探针在内存与 SQLite 两个适配器上都复现；当前没有生产路径触达只说明现在不可达，改成"部分"是往乐观方向改，没有新证据；哪一层算数归 H4 |
| 2026-09-29 / 验收者 | B0-2 判据改为 `--test-isolation=none` 下 `ℹ tests` ≥ 1、`ℹ fail 0`、有 `✔` 标题行，并以伪造前缀读回 `ℹ tests 0` 作对照；0.3、0.8 第 2 条、B0-2 三处同步（已被 2026-09-30 的直接运行判据取代，见 S-15） | S-11：原命令对失效引用恒为绿 |
| 2026-09-29 / 验收者 | `release-gates.md` §2.2 的过期计数加"注"，不标 Superseded；0.5 清单补一行 | 计数过期但"两层非空且全绿"仍成立，0.5 只标被推翻的结论 |
| 2026-09-29 / 验收者 | 0.3、0.4 的初值表删除，改为指向 `vertical-path.md` §2.1 与 `release-gates.md` §2.1.1 的一句话 | 结论只保留一个事实源；初值与落地值的差异记在本表 |
| 2026-09-29 / 验收者 | B0.5 的提交尾注用 `Refs #217`、提交正文不写关闭关键字，B0-10 的期望改为无输出；`gh pr ready` 不在 B0.5 执行 | 原 B0.5 文字要求最后一个提交以 `Closes` 指向 #217，与 `Global Constraints`"关闭关系只写在 PR 正文尾注"冲突，按后者；协调者本轮指令不执行 ready，是否 ready 与合并由人类伙伴决定 |
| 2026-09-29 / 验收者 | 摘取的 6 个提交与收口改动按所有者整理成少量提交，快进追加在 `15c338a` 之后；Co-Authored-By 统一 | 已推送的 `a50d7b8`、`15c338a` 不改写；子分支的订正提交是同一批次的修补，合并后每个提交可独立审阅；B0.4 指出子分支提交的模型名不一致 |
| 2026-09-30 / 执行者 | 第 13 行拆成 13.1–13.10 十个故障面，每面给生产入口、经入口的用例与旁证；13.7（Planning 外部写入失败）与 13.10（LLM 不进控制路径）没有生产入口，列"未交付"；行级结论仍取最弱者"反例：#221（P3）、#194（P4）"，行级计数不变，另给故障面粒度的计数（已交付 2、部分 3、反例 3、未交付 2） | 评审 5353108706 的 P1：入口格写"无新增动作"而结论是"反例"，两种验收形态都不满足。逐个打开用例核对后，故障面间的证据强度不一致，拆开才能让读者复现每个面的入口；不在主表加编号行，保持 §2 的 13 行规格与 B0-1 的"13 个编号行 + 1 个附行" |
| 2026-09-30 / 执行者 | 回读命令改为直接运行测试文件（不加 `--test`）加 `--test-reporter=spec --test-name-pattern`，判据为退出码 0、含前缀的 `✔` 标题行、无 `✖`、`ℹ tests` ≥ 1 且 `ℹ fail 0`，负对照保留；不提高 Node 前置版本，不改 `package.json` | 评审 5353108706 的 P2、S-15：该选项到 v23.6 才有，v22 系列只有 v22.8 起的实验参数。直接运行在 Node 26 上有判别力（负对照读回 0），且只用旧选项；提高前置版本要改 `engines` 与 CI、超出只改 `.md` 的 #217。局限：Node 22 未实跑，依据官方文档 |
| 2026-09-30 / 执行者 | 第 7 行把 `local-git-start-work-resume`、`local-git-branch-probe` 与 `local-git-core-provisioning` 的 `startWork` 用例记为旁证（`startWork` 函数 + 手工 `createContext`），结论仍为"部分"，缺口改为"脏工作树拒绝；真实 Git 上的恢复与失败只有旁证"；Provider 格把真实 Git 用例分成 `startWork` 函数与 `provisionGit` 两档 | 评审总述：原文"只有 human-execution-provider 经 composeCore，其余真实 Git 用例都是内部函数旁证"不再准确，它们现在跑完整供应序列。按 0.2 逐个打开：都不经 `composeCore` / `commands`、没有 Planning 绑定，不能升级为经入口的证据（反向升级需要新证据，这里没有）；覆盖面比 `provisionGit` 旁证宽，所以分档写明 |
| 2026-09-30 / 执行者 | 观察基线由 `main@f6a33d2` 改为 `main@699d715`（vertical-path §2.1、release-gates §2.1.1、§2.2 与 Superseded 段的计数）；本计划的「Batch 0 需要的代码事实」保留 `main@f6a33d2`，只在头部与第 43 项加注 | 变基后在导出目录重跑 P1–P5、X1–X3、#203 探针，观察值不变，62 组回读扩到 71 组仍全绿；integration 现为 13 个文件、`ℹ tests 119`，旧计数已过期。计划内的行号与代码事实是起草期史料，改它会与 0.5 的 Superseded 表基线不一致 |
| 2026-09-30 / 执行者 | R1 第 9、10 行的缺口按新增真实 Git 用例改写（R2 只是旁证，且落下的是 failed 上下文，不是"无本地写入"；R1 的恢复只在内存 Storage 上），结论仍为"部分" | 第 9 行原文"`worktreeCreate: false` 只在 provider 层断言"因 R2 不再准确；但它不经 `commands`，也不满足不变量 9 的"无本地写入"；第 10 行的"core 与 SQLite 组合无用例（#141）"不变 |
| 2026-09-30 / 验收者 | 13.3 的经入口用例由"无"改为引用 start-work-retry-identity「重试：可清除的失败之后」与 start-work-step-recording「conflict 后列表读取失败只报 unknown」，结论仍为"部分"，缺口改为"权限被拒没有经入口的用例；离线只由手工替换方法返回的 `unavailable` 覆盖"；第 13 行失败列同步 | S-18：两条用例都经 `composeCore` + `commands.startWork`，注入的错误码与替身离线故障相同，"无"与第 7 行已引用的同一用例矛盾；证据变多但仍缺权限被拒，所以不升级，故障面计数不变 |
| 2026-09-30 / 验收者 | 13.7 的入口格由 `commands.applyPlanningStatus` 改为"无"，并写明该命令不调用 Planning provider 的写方法 | 原文入口格有命令、结论却是"未交付"，与 0.2"未交付＝没有生产入口"自相矛盾；`git grep` Planning 的五个写方法在 core / controller / client 无命中，所以"承载 Planning 外部写入的入口"不存在，结论不变 |
| 2026-09-30 / 验收者 | 第 7 行维持执行者的"旁证"归类，不改判 | 逐个打开 `local-git-start-work-resume`、`local-git-branch-probe` 与 `local-git-fixture.js`：从包入口导入 `startWork` 函数，经 `coreContextFor`（`createContext`，只接 Development）调用，0.2 明确把手工 `createContext` 列为旁证；评审总述指出的"内部函数旁证"措辞已改为分档描述。若人类伙伴认为 `startWork` 函数算入口，需要改 0.2 本身并在本表记录 |
| 2026-09-30 / 验收者 | B0.6 的订正追加为新提交，不改写已推送的 `045365d` 与执行者的 `f7909e1` | `AGENTS.md` §6：已推送历史不改写；`f7909e1` 未推送但已经过独立复核，保留它可让评审者分开看执行者改动与验收订正 |

## Idempotence and Recovery

调查、调用图清点、P1–P5 与变异规程都可重跑，不改仓库状态；变异目录在仓库之外，删除即复原。每批开工前检查 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`，工作树路径规范化为 realpath 后逐项核对允许根与清理范围；保留不属于该批的工作树、分支和未跟踪内容。

Batch 0 有两个恢复锚点：B0.2 改写前的本地引用 `backup/system-architecture-renewal-81a2cbc`（指向尚未推送的 `81a2cbc`），以及 B0.2 推送后记录的 head。三条子分支各自只含一个文档提交，摘取失败时丢弃摘取结果、从子分支重摘；B0.5 只做快进推送。已推送后如确需改写，先建 backup ref 再用精确的 force-with-lease，交给 `git-expert-operations` 流程。合并后回滚用明确反向提交；Superseded 注只追加，单独撤回矩阵提交后原文仍完整自洽。

SQLite 压缩先在临时库验证，再登记实际库文件、备份方式与重建范围；未明确可丢弃的库不重建。新程序拒绝旧版本时，恢复方式是旧提交 + 原库备份，或在明确允许丢弃时创建新库；本计划不安排自动 downgrade。Provider 已 ack 而本地未落库时执行 reconcile，不用 Git revert 作为外部写入回滚。每次重锁 PR base/head 后再引用 CI、规模或 disclosure 结论。

## Interfaces and Dependencies

开发入口为仓库根目录的 Node ≥ 22（本轮观察 v26.10.0）、pnpm 锁文件（`packageManager: pnpm@10.28.2`）、`node:test`、TypeScript 与 SQLite；标准命令见 `package.json`、`AGENTS.md` §9、`docs/development/ci.md`。`gh` 命令一律带 `-R SingularityKChen/harness-projects`。前六批不要求真实 GitHub token；真实 Provider/UAT 缺凭据时保持未验证。SQL 使用 `packages/storage/sqlite/src/migrate.ts` 的版本与事务契约，Gate E1 模型裁决后才写定基线。运行取消与运行身份以 `docs/adr/ADR-0008-run-identity-is-the-core-run-record.md` 为依据。

下游依赖（#216 的排序规则）：binding 身份（2A/2B）先于连接与组合子 issue（#127 #131 #132）；同步作用域（2C）先于规划对账（#134）；交付事实（Batch 3）先于 #72，#233 依赖 #219 与 #222；命令身份（Batch 4）先于 #71；#235（第 9 步生产入口）被 #231 与 #204 阻塞，#231 依赖 #219。

技术债入口 `docs/exec-plan/tech-debt-tracker.md` 的每项记录 id、当地日期、状态、关联计划、子系统、分支、记录者、延期原因、影响与下一步；Batch 0 登记 TD-001 至 TD-003（本文件 `Design / Spec` 的 0.6）。关闭关系：本计划所在 PR 的正文尾注以 `Closes` 指向 #217、以 `Refs` 指向 #216，合并后用 `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences` 与 `gh issue view 217 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences` 两侧回读。

## Outcomes & Retrospective

B0.7 的实际修复是回读块保留 Node 真实退出状态：bash / zsh 正常对照退出 0，进程级失败退出 7；MVP-0 与文档契约 27/27。#217 的四项验收按已交付的入口矩阵、R1 映射和完整计划判定；后续 Gate E1 / R1、Batch 1–7 仍按各自 issue 与人工门禁执行。#240 后合并时须同步刷新 R1 第 8 行，不能让本快照的 #203 旧反例变成现状。

**Batch 0（#217）已落地，待人类评审。** 作者阶段完成只读设计对照、代码与测试调查与一份按依赖顺序执行的计划；定稿阶段在三份独立设计之间逐项复核，纠正了三处互相矛盾的结论（R1 第 1、4、6 条与矩阵第 6 行），并以 P1–P5 与 M1 的实测作依据。Batch 0 没有修改产品实现、schema、公共能力契约、看板或 issue。

实际结论（观察基线 `main@f6a33d2`）：`docs/product/vertical-path.md` §2.1 的 13 行加附行为已交付 0、部分 6、反例 5、未交付 3；`docs/architecture/release-gates.md` §2.1.1 的十条为已断言 0、部分 5、反例 5、未验证 0。没有一行能读成"已交付"或"已断言"，7 条 `tests/mvp0` 全绿只是 MVP-0 的必要条件。Gate E1、MVP-0、MVP-1、R1 都没有判定，H1–H5、H7 仍待人类裁决。

与计划的偏差：结论只往保守方向走——初值里的矩阵第 8 行"已交付"、R1 第 5、10 条"已断言"都降为"部分"，第 3 行由"部分"改为"反例（#199）"；子分支各多一次订正提交；B0-2 原判据没有判别力（S-11），B0.1 的回读结论因此作废并重跑；B0.5 的提交尾注与 ready 步骤按 `Global Constraints` 和协调者指令调整（Decision Log）。

B0.5 在最终提交上的验收结果：B0-1 为 13 个编号行加 1 个附行、第 9 行与附行为"未交付"、`createChangeRequest` 在 core / controller / client 源码中无命中；B0-2 为 62 组引用全部 `ℹ tests` ≥ 1、`ℹ fail 0` 且有标题行，伪造前缀读回 `ℹ tests 0`；B0-3 为 §2.1.1 恰 10 行、结论全在词表内；B0-4 为 M1、M3、M9、M10 各自先红后绿；B0-5 为三个文件删除列全为 0、`Superseded by` 计数 3；B0-6、B0-8、B0-11 通过（工作树里 `node --test tests/contract` 只有 S-1 那条环境失败）；B0-7 为 13 个 `##` 标题；B0-9 为非 `.md` 改动为空、`size` 通过；B0-10 为本机路径与关闭关键字均无命中、`disclosure` 通过。命令输出与规模数字写在 PR #239 描述的"验证证据"一节。

经验：按名回读需要一个必然为 0 的对照，否则"计数 ≥ 1"会被文件级计数冒充；组合期隐式引导会让"经入口"的判断失真；issue 记录的反例在同一基线上复跑一次成本很低，能把"待定"变成可引用的证据。遗留：TD-001 至 TD-003，以及 Batch 1–7。

**B0.6 评审响应（review 5353108706）**：P1 把第 13 行拆到 13.1–13.10 的具体入口（未交付的 13.7、13.10 单列），行级计数不变（已交付 0、部分 6、反例 5、未交付 3），故障面计数为已交付 2、部分 3、反例 3、未交付 2；P2 把回读命令改成不依赖 `--test-isolation` 的直接运行判据，71 组在 Node v26.10.0 上全绿、22 个文件的伪造前缀负对照全部读回 0，Node 22 未实跑；总述里的第 7 行按新用例改写，结论仍为部分。PR 描述里的计数口径（由验收者更新）：13 行 + 附行为已交付 0、部分 6、反例 5、未交付 3；13.x 故障面 10 个为已交付 2、部分 3、反例 3、未交付 2；B0-2 为 71 组引用。验收者复核后订正 13.3（补引两条经入口的 `unavailable` 用例）与 13.7（入口格改为"无"），两种粒度的计数都不变；B0-2 变为 72 组、23 个文件，全部回读通过，伪造前缀在 23 个文件上全部读回 0。

## Bottom Change Note

- 2026-09-30：B0.7 修复管道吞退出码的 P2；记录两个 shell 的正常、负对照与进程级失败结果，说明本次合并授权、提交整合与控制计划保持 active 的边界。

- 2026-09-29 08:55 CST：用 `exec-plan` 脚手架建骨架，因用户要求先调研并给出发布前系统/架构清理计划。
- 2026-09-29 09:00 CST：根据原始意图对照、当前代码/测试、Gate E1/ADR、独立调查与反例，把骨架改成分阶段控制计划。
- 2026-09-29 09:04 CST：补逐批可执行命令与证据说明。
- 2026-09-29 09:14 CST：独立复审发现旧 [1] 库可绕过新基线、事件被误设为正确性依赖、交付缓存先于键裁决、过渡写者不唯一；重排 Batch 2/3，增加世代拒绝、2A–2E/3A–3B 判据和唯一文件集。
- 2026-09-29 09:18 CST：把 3A 的独立通过项与 3B 才加入的纯读红→绿用例分开。
- 2026-09-29 14:40 CST：按人类伙伴指定的流程定稿 Batch 0（#217）。原因：原计划只写了 CI 硬上限（1000/1500），缺本轮的弹性规划上限（800/1300）、Batch 0 超出 #217 范围、易失基线写了四处、没有引用 #216 子 issue、Decision Log 作者写成工具品牌、两个非强制章节重复事实，且三份独立设计对同一行给出互相矛盾的结论。改动：新增 Batch 0 规格（证据规则、矩阵与 R1 初值、Superseded 清单、技术债、评审者会怎么打破它）；把批次 → issue 映射与 Batch 0 文件所有权收进 `Global Constraints`；Validation 表第 1–10 行原样保留并冻结，另立 Batch 0 验收、P1–P5 与变异规程；删去 Concrete Steps 与 Artifacts and Notes 两节（内容并入 Plan of Work、Progress 与 Surprises）；#223/#224 各按两个 PR 计划，#215 移出默认范围。
- 2026-09-29 19:39 CST 起：B0.5 验收收口。原因：三条子分支需要按所有者摘取，B0.4 留下 P3 与待定项。改动：按 T3 → T2 → T1 摘取并以 `comm` 核对文件集合；R1 第 5、10 条降为"部分"、矩阵第 3 行改为"反例：#199（X2）"并把两条组合期用例记旁证，第 4、6 行改为本轮复跑（X3、X1）；§2.2 过期计数加注；0.3、0.4 初值表换成指向矩阵与 R1 快照的一句话；B0-2 判据三处改为带对照的判别命令，B0-10 与 B0.5 的关闭关系只留在 PR 正文；Progress、Surprises（S-11 至 S-14）、Decision Log、Outcomes 与 `docs/README.md` 索引行随之更新。
- 2026-09-30：B0.6 评审响应。原因：评审 5353108706（CHANGES_REQUESTED）指出第 13 行既无入口也未标"未交付"、回读判据依赖 Node 22 没有的 `--test-isolation`，并要求变基后刷新第 7 行。改动：第 13 行拆成 13.1–13.10 故障面并同步 B0-1；回读命令改为直接运行测试文件的判别命令（`vertical-path.md`、`release-gates.md` §2.1.1、0.3、0.8、B0-2、TD-003 五处同步）；第 7 行与 R1 第 9、10 行按 `main@699d715` 的新增用例改写；观察基线改为 `main@699d715` 并重跑 P1–P5、X1–X3、M1、M3、M9、M10；Progress（B0.6）、Surprises（S-15 至 S-17）、Decision Log、Outcomes 随之更新。
- 2026-09-30 00:34 CST 起：B0.6 验收复核。原因：执行者的 `f7909e1` 要按评审原条件独立复跑。改动：13.3 补引两条经入口用例、13.7 入口格改为"无"、简称表补 `start-work-step-recording`、`vertical-path.md` 的 Node 说明补文档依据、TD-003 遗留影响列与被取代的 Decision Log 行订正；Plan of Work 补 B0.6 条目，Progress、Surprises（S-15 补注、S-18）、Decision Log、Outcomes 随之更新。

- 2026-09-30：#240 合入前按同 PR 纪律刷新 #203 的端口反例与 R1 汇总，保留历史快照和探针，记录仍缺的 core 乱序注入。
