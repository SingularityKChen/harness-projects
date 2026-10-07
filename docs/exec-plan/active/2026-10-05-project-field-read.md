# GitHub Project 字段读取与列表展示 ExecPlan

> 状态：Active；精简重写已实施，经独立对抗复评与本地验证，等待 PR #268 评审。
> 创建：2026-10-05 CST；重写：2026-10-07 CST；规范：`PLANS.md`。
> 关联：[issue #133](https://github.com/SingularityKChen/harness-projects/issues/133)；字段写入归 #71，Host 挂载归 #229。
> 执行上下文：检出 `feature/project-field-read` 的工作树根目录。本次重写在 `.worktrees/project-fields-lean`（分支 `feature/project-field-read-lean`）完成，再以精确 lease 替换 PR #268 的分支内容。

## Purpose / Big Picture

用户在工作项列表看到每个条目来自 GitHub Project 原生字段的规划状态、迭代和目标日期：

- 状态只按工作区显式映射归一：映射列出的 option 显示规范状态，没列出的显示「原生名（未映射）」，没有配置状态字段时显示「未知」；绝不按字段名或选项名猜。
- 归一结果写进投影唯一的 `planningStatus`：列表、详情和状态策略读同一个值，Host 的显式状态写入立即反映到列表。
- 两个 Project 即使复用 option id，字段值也按 project field id 各自独立（Gate E1 R2）。

最小成功证据：沙箱 Project A 的录制响应在不联网的条件下经 GitHub provider、core、Memory/SQLite、controller、client、ui-model，由真实 `WorkItemListPage` 渲染出「In Progress（未映射）」「E1 Sprint 1」「2026-09-24」；随后 `applyPlanningStatus(blocked)` 让同一行显示「已阻塞」。证据是 `tests/integration/github-projects-bootstrap.test.js` 的 #133 用例。

## Context and Orientation

术语：**成员关系**是条目挂在 Project 上的那一行（`ProjectV2Item`），**内容**是它指向的 Issue / Draft / PR。**原生字段值**是平台报告的单选、迭代、日期值，以 **project field id** 为键。**工作区映射**由 Host 给出：哪个字段承载状态、每个 option id 对应哪个 `NormalizedStatus`、哪个字段是迭代、哪个是目标日期。

上游依据：`docs/architecture/gate-e1-ruling.md` §4 的 R2（字段值按 `(workspace, item, project field id)` 定位，不得用 option id）、R3（不设 revision / CAS，权威值由一次独立读回支撑，读回写入 `sync_observation`）、R7（平台查询参数只用 primary id 与游标）。#70 已交付条目读取、GraphQL transport 与录制回放（`docs/exec-plan/completed/2026-09-29-github-projects-read.md`）。

`main` 上的现状：`PlanningProvider.listFieldDefinitions` / `listIterations` 已在端口里，但 GitHub provider 返回 `not_supported`，fake 的字段定义只有字符串选项。`bootstrap.ts` 用 `normalizePlanningStatus(statusKey)` 写 `planningStatus`，GitHub provider 从不给 `statusKey`，所以 GitHub 条目的状态恒为 unknown。`planning_field_value` 表与 `putFieldValue` / `listFieldValues` 端口存在，但没有生产写方和读方。`status-policy.ts` 的 `writePlanningStatus` 是规划状态唯一的显式写入口，详情（`packages/ui-model/src/derive.ts` 的 `planningSectionOf`）读 `planningStatus`。目前没有任何 `apps/*` 组装 core，Host 挂载归 #229。

历史：PR #268 的第一版实现（2026-10-05/06，head `8115211`）代码 1826 行，超过 `AGENTS.md` §8 的 1000 行；评审账号以 `CHANGES_REQUESTED` 阻塞。2026-10-07 的机械三层拆分（#271、#272）只切分同一份代码、没有改设计，人类伙伴当日撤回并恢复单 PR。随后按用户要求重新评估第一版的设计，结论与证据见 `Surprises & Discoveries`，取舍见 `Design / Spec` 与 `Decision Log`。

## Design / Spec

### 权威链

1. **Provider 只报告原生事实**。`PlanningItems` 为每个条目带回 `fieldValues(first: 100)`，解码成 `ProviderPlanningFields.nativeValues`，以 project field id 为键；只解码单选、迭代、日期三种值，其余跳过，缺 `__typename` 的节点是形状错误。`PlanningFields` 读字段定义与迭代配置（含已完成迭代），供 `listFieldDefinitions` / `listIterations` 使用。成员关系观察的 payload 与去重键都带 `nativeValues`，原样落在 `sync_observation.snapshot_json`：同秒内的字段变化也会留下各自的观察。
2. **core 是映射的唯一使用者**。`packages/core/src/planning-fields.ts` 的纯函数 `planningFieldsOf` 把原生值与映射变成 `{ planningStatus, planningFields? }`：状态 option 在映射里才归一，否则为 unknown；`planningFields` 只是展示事实 `{ statusName?, iterationTitle?, targetDate? }`。没有 `nativeValues` 的 Provider（fake）沿用 `statusKey`。redacted 内容不取任何字段值。
3. **Storage 存投影**。展示事实随投影在同一同步事务里确认并整行覆盖：SQLite 是 `workspace_projection` 的三个可空列，Memory 存对象本身。投影表在、却缺这三列的旧库（#133 之前建的 002）在打开时以可执行处置拒绝，与 #126 同一闸门（`assert002Shape`），不写兼容迁移。
4. **消费链只读已确认投影**。`toWireEntity` 不让 redacted 行带出字段事实，ui-model 的 `visibleContent` 再剥一次；列表规范状态文案只看 `planningStatus`，只有它是 unknown 且有原生名时才显示「原生名（未映射）」。

### 关键取舍

- **规范状态只有一个事实源**。映射结果写进 `planningStatus`，展示事实里不存第二份 normalized。第一版把映射后的状态放进 JSON 快照，`planningStatus` 恒为 unknown，列表又优先读快照，结果是列表与详情不一致，Host 写入在列表上不可见（复现见 `Surprises & Discoveries`）。
- **映射是组装输入，不持久化**。`CoreWorkspaceInput.planningFieldMapping` 与 `project` 一样由 Host 每次组装时给出；`createContext` 先深拷贝再校验并冻结（调用方事后改自己的对象不影响已校验的映射），以 `TypeError` 拒绝映射到非规范状态或 unknown 的输入，与 `workspaceRecord` 对 `statusPolicy` 的校验同一风格。它是 Host 自己的配置，不是外部写入，没有待确认态。映射引用的字段或选项不存在时降级为 unknown 或无该展示值，不按名称替代。持久化与配置界面由提供映射来源的工作（#229 或后续设置 issue）承担。
- **单页读取，前提被打破就整次失败**。GitHub 文档：「Projects support up to 50 fields in total. Issue fields and system fields count toward this limit.」因此 `fields(first: 100)` 与 `fieldValues(first: 100)` 一页必然读全。解码要求 `hasNextPage === false`，否则 `malformed_response`，不截断发布。R7 的参数白名单保持 project id + 游标。`PlanningFields` 保留 `$after` 变量，是为了让查询文本与录制哈希逐字一致。
- **不写 `planning_field_value`**。它没有读方。观察账本记录的是同一次引导里 reconcile 扫描读到的原生值；投影来自紧随其后的列表扫描，两次扫描之间平台若有变化，账本要到下一次同步才追上——这与内容标题、正文的现状相同，属于同步机制（#134）的范围。R3 针对的是写入确认：字段写入 #71 需要按 `(workspace, item, project field id)` 读回确认时，再连同读方一起引入原生值的持久化。
- **redaction 三层**：core 不为 redacted 内容产出字段事实（即使 Provider 违约带着值），wire 与 ui-model 各剥一次；renderer 对 redacted 行只画占位。

### 被放弃的方案

- **第一版的映射生命周期**（省略 / 对象 / null 三态、pending → ack → confirmed、bootstrap Promise 队列、`workspace.planning_field_mapping` 列、用定义校验让整次同步失败）：把本地配置当外部写入；为一个尚不存在的「重启时省略映射」调用方增加约 150 行产品代码，并给每次同步加一次定义扫描和一个新失败模式。
- **逐条目续页 `PlanningItemFields` 与 500 页定义扫描**：平台上限使其不可达；还把成员关系 id 引入查询参数，扩大了 R7 的面。
- **`replaceFieldValues` 整组落库**：只写不读，并且制造了「redacted 条目残留上次可见的字段值」这类缺陷面。
- **JSON 快照列 `planning_fields_json`**：既要解析校验，又让 normalized 有两份。显式列与「列清单只写一次」的既有风格一致。
- **读时拼接原生值**：每次查询都要关联成员关系与字段值，还会引入投影与字段值之间的撕裂读；同步时物化进投影更简单，也天然一致。
- **按目录机械拆成三层 stack、或记录规模例外**：两者都不改变设计；精简后单 PR 已在 800 行规划预算内。

### 不变量

- 一个工作区只有一个规划状态事实源：`WorkspaceProjection.planningStatus`。
- 映射之外不归一；option id 不跨字段使用。
- redacted 内容不带任何原生值或展示事实。
- 字段读取不新增外部写入，也不新增查询参数种类。

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量；不改 Project `Status`、`blocked-by` / `blocking`；人类决定是否合并。
- 规模：代码 ≤800、文档 ≤1300 是规划上限；代码 ≤1000、文档 ≤1500 是 `node scripts/rule-checks.mjs size` 的 CI 上限。两者都要满足。
- MMP 前没有需要保护的数据：直接改 `002_identity_membership.sql`，不写兼容迁移；旧形状的库在打开时以可执行处置拒绝（删除库文件重建），沿用 #126 的闸门。
- CI 只用录制回放，不联网、不读凭据；查询文本改动必须重录夹具（哈希漂移测试会变红）。
- 不为压规模删除判别性测试；每个守卫都要有能被变异杀死的用例。

文件集合（只在此处声明）：

| 区域 | 文件 |
|---|---|
| 领域与契约 | `packages/domain/src/planning-fields.ts`（新）、`packages/domain/src/entities.ts`、`packages/domain/src/index.ts`、`packages/capabilities/src/planning-provider.ts` |
| Provider | `packages/providers/planning-github-projects/src/queries.ts`、`decode.ts`、`provider.ts`；`packages/providers/fake/src/state.ts` |
| core 与 Storage | `packages/core/src/planning-fields.ts`（新）、`bootstrap.ts`、`context.ts`、`projection.ts`；`packages/storage/sqlite/migrations/002_identity_membership.sql`、`packages/storage/sqlite/src/storage.ts`、`storage-rows.ts`、`storage-sync.ts`、`migrations.ts` |
| 展示 | `packages/controller/src/wire.ts`、`packages/ui-model/src/derive.ts`、`types.ts`、`work-item-list-view.ts`、`packages/ui/src/work-item-list.ts` |
| 夹具 | `tests/contract/fixtures/github-projects/project-a.json`（含字段值的重录）、`project-fields.json`（新，字段定义）、`replay.js` |
| 测试 | `tests/contract/planning-fields.test.js`（新）、`planning-github-projects-contract.test.js`、`planning-github-projects-mapping.test.js`、`ui-work-item-list.test.js`、`ui-work-item-list-view.test.js`、`ui-model-presentation.test.js`；`tests/integration/github-projects-bootstrap.test.js`、`identity-membership-schema.test.js`、`identity-membership-enums.test.js` |
| 文档 | 本计划、`docs/README.md`、`docs/architecture/gate-e1-sandbox.md`（登记字段录制里的内置字段 id） |

## Plan of Work

三个批次在同一 PR 里按层提交，每个提交单独通过类型检查与全量测试；以下命令都在检出该提交的工作树根目录运行。

### Batch 1 · Provider 原生字段事实

**最小闭环**：GitHub provider 从录制夹具离线读出字段定义、迭代与条目原生值；坏形状、续页与重复字段整次失败。
**主文件**：`packages/providers/planning-github-projects/src/decode.ts`、`packages/capabilities/src/planning-provider.ts`、`tests/contract/planning-github-projects-mapping.test.js`。

    ./node_modules/.bin/tsc --noEmit
    node --test tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js

期望：类型检查无输出；两份测试 0 fail，回放账本 `misses` 为空。**回滚**：revert 本批提交，端口恢复 `not_supported`，无数据需要恢复。

### Batch 2 · Host 映射与权威状态

**最小闭环**：工作区映射把原生状态归一进 `planningStatus`，展示事实随投影在 Memory 与 SQLite 上同事务确认并逐字读回。
**主文件**：`packages/core/src/planning-fields.ts`、`packages/storage/sqlite/src/storage-rows.ts`、`tests/contract/planning-fields.test.js`。

    node --test tests/contract/planning-fields.test.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js

期望：两种 Storage 的用例 0 fail。**回滚**：先回滚 Batch 3，再 revert 本批；SQLite 实验库按 002 重建。

### Batch 3 · 列表展示

**最小闭环**：已确认的状态与展示事实经 wire、client、ui-model 到达真实列表 HTML，redacted 行不泄漏，Host 写入立即可见。
**主文件**：`packages/ui-model/src/work-item-list-view.ts`、`packages/ui/src/work-item-list.ts`、`tests/integration/github-projects-bootstrap.test.js`。

    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e
    node --test --test-timeout=120000 tests/mvp0
    node --test tests/contract/package-boundaries.test.js
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs size origin/main
    node scripts/rule-checks.mjs disclosure origin/main
    git diff --check origin/main...HEAD

期望：全部测试 0 fail；`size` 报代码 ≤800、文档 ≤1300；其余命令 exit 0。**回滚**：revert 本批提交，列表回到六列，Host 侧已确认的数据不受影响。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 两个 Project 的状态 option 共享 option id、字段 id 不同时，字段值互相独立（#133） | `planning-fields.test.js`「同一 Issue 在两个 Project 的状态按各自的字段 id 定位」：issue-shared（#2）在 A（录制）得 in_progress、在 B（按沙箱登记与 E1-2 实验 1 读回合成）得 done，A 的映射套到 B 上得 unknown——即 E1-2 实验 1 的期望投影；`planning-github-projects-mapping.test.js` 的 R2 合成用例 |
| 2 | 未映射的状态只作为原生值出现，没有规范状态，绝不猜（#133） | `planning-fields.test.js`：无映射时 9 条全为 unknown（名字恰为 Todo 也不归一），In Progress 未映射时为 unknown + 原生名；列表显示「In Progress（未映射）」「Done（未映射）」 |
| 3 | 沙箱 Project 的迭代与目标日期出现在列表（#133） | `github-projects-bootstrap.test.js` 的 #133 用例：Memory 与 SQLite 各渲染一次真实 HTML，含 `E1 Sprint 1` 与 `2026-09-24` |
| 4 | 规划契约套件在录制夹具上离线通过（#133） | `planning-github-projects-contract.test.js`：契约套件、查询哈希漂移、provenance、字段定义与条目原生值逐字回读，回放账本 `misses` 为空 |
| 5 | 规范状态只有一个来源，Host 写入立即可见 | 同 #3 的用例：`applyPlanningStatus(blocked)` 后该行显示「已阻塞」；ui-model 用例「规范状态是唯一权威」 |
| 6 | redacted 不泄漏，再次同步不留旧值 | core（转为 redacted 且违约 Provider 仍带值时不产出、也不留下字段事实，SQLite 整行覆盖）、wire、ui-model、renderer 四处用例 |
| 7 | 旧形状的库不会带病运行 | `identity-membership-schema.test.js` 的 #133 用例：缺展示列的 002 在打开时被拒绝且零写入 |
| 8 | 守卫有判别力 | 22 条变异全部被杀死，见 `Surprises & Discoveries` |
| 9 | 规模 | `node scripts/rule-checks.mjs size origin/main`：代码 ≤800（弹性）、文档 ≤1300；CI 上限 1000 / 1500 |

## Progress

- [x] (2026-10-05 CST) 创建计划；第一版设计与实现（PR #268）。
- [x] (2026-10-06 CST) 第一版完成，代码 1826 行，记录规模例外。Superseded by 2026-10-07 重写。
- [x] (2026-10-07 CST) 机械三层 stack（#271、#272）发布后按人类决定撤回，恢复单 PR。
- [x] (2026-10-07 CST) 评估第一版设计：在 PR head `8115211` 复现双状态源；核对 GitHub 字段上限、观察账本内容与现有调用方；人类批准两项取舍（见 `Decision Log`）。
- [x] (2026-10-07 CST) 在 `.worktrees/project-fields-lean` 从 `origin/main@d911cc9` 重写三个批次。基线：`main` 上 contract/integration/e2e 1149 / 1149。
- [x] (2026-10-07 CST) 本地验证（提交整理前的检查点 `9f919de`）：contract/integration/e2e 1169 / 1169，MVP-0 7 / 7，包边界 8 / 8，`tsc --noEmit` 无输出；`size origin/main` 代码 730 / 1000。复跑命令见 Batch 3。
- [x] (2026-10-07 CST) 变异表 14 / 14 被杀死。
- [x] (2026-10-07 CST) 独立对抗复评（另一个模型、独立工作树）：P0/P1 为 0；4 条 P2、6 条 P3 的处置见 `Surprises & Discoveries`。修复后在检出 `feature/project-field-read-lean` 的工作树根目录复跑：contract/integration/e2e 全部通过、MVP-0 7 / 7、包边界 8 / 8、`tsc --noEmit` 无输出；变异表扩到 22 条，全部被杀死；`size origin/main` 代码 801 / 1000、文档 196 / 1500（含本计划）。复跑命令见 Batch 3。
- [ ] 按批次整理提交，复跑全量门禁，发布面扫描。
- [ ] 经人类批准后以精确 lease 更新 PR #268，回读 head、base、checks、issue 关联与评审线程。

## Surprises & Discoveries

- **第一版的双状态源（已复现）**。在检出 `feature/project-field-read@8115211` 的工作树根目录，以录制夹具、`host_authoritative`、完整映射组装 core：同步后同一条目 `planningStatus` 为 `unknown`、列表显示「进行中」、详情显示 unknown；`applyPlanningStatus(blocked)` 返回 `wrote=true` 后，详情变为 blocked，列表仍是「进行中」。根因是映射结果只写进 JSON 快照，而 `statusText` 优先读快照。
- **平台字段上限让分页不可达**。GitHub 文档写明一个 Project 最多 50 个字段（含系统字段）；沙箱 Project A 有 16 个。
- **原生值已经在观察账本里，但来自另一次扫描**。`packages/storage/sqlite/src/storage-sync.ts` 把整条 `ProviderObservation` 原样存进 `sync_observation.snapshot_json`，成员关系观察带着 `nativeValues`。复评指出：同一次引导里观察来自 reconcile 扫描、投影来自列表扫描，两次之间的平台变化会让账本暂时落后于投影（内容标题、正文同样如此）。这修正了「`planning_field_value` 只是账本的第二份副本」的说法；删除它的理由是没有读方，写入确认留给 #71。
- **录制可以原样复用**。三段查询文本与第一版逐字相同，哈希 `8aa35989…`、`413ec3e3…`、`0dd9923b…` 与 provenance 一致。`project-a.json` 已按含字段值的查询重录；`project-fields.json` 只保留 `PlanningFields`（first 100）这一条交换，provenance 的哈希表随之只列这一段。删掉的是重复的条目响应、不再使用的分页定义与逐条目续页，没有改写任何响应内容。
- **既有缺口，不在本 PR 范围**：`bootstrap.ts` 每次同步直接写 `planningStatus`，没有调用 `packages/domain/src/status.ts` 的 `reconcilePlanningStatus`，所以 `host_authoritative` 下 Host 写入会在下一次同步被覆盖。`main` 上已是如此（当时覆盖成 unknown），本 PR 不改变它。直接套用该函数还会让「移除映射后保留旧状态」，与验收 #2 冲突，需要先定语义，已另起后续任务。
- **独立复评的发现与处置**（P0/P1 为 0）：P2——SQLite 的 upsert 不覆盖展示列时没有用例变红（补「再次同步整行覆盖」用例）；去重键是否包含原生值没有用例（补同秒变化用例）；002 原位改写后旧库会在第一次读投影时炸在驱动层（补打开时拒绝，沿用 #126 闸门）；账本与投影来自两次扫描（修正计划措辞，见上一条）。P3——映射按引用保存，注册后可被调用方改掉（改为深拷贝、校验、冻结）；provenance 的 id 前缀不含字段 id（扩到 `PVTF_` / `PVTSSF_` / `PVTIF_`，两份录制里的字段 id 均已在沙箱文档登记）；合成的 Project B 与沙箱登记不一致（改用登记的 issue-shared 与 E1-2 实验 1 的读回）；解码器静默跳过缺 `__typename` 的值节点、`__proto__` 字段 id 会落到原型上（改为形状错误与自有键）；没有「有迭代无日期」的用例（补上）；同步不尊重 `StatusPolicy`（既有缺口，已另起后续）。
- **变异表**（逐条应用、确认文件已改、跑相关用例、从内存原文复原）：删 core 的 redacted 守卫、未映射时按名称归一、列表优先原生名、不检查 `hasNextPage`、不拒绝重复字段值、redacted 行读字段值、按 option id 定位、wire 不剥 redacted、ui-model 不剥 redacted、SQLite 不读回展示列、不校验映射、观察不带原生值、不拒绝重复定义 id、接受不存在的日历日，以及复评补充的 SQLite upsert 不覆盖展示列、去重键不含原生值、录制里伪造字段 id、迭代起始日冒充目标日期、映射按引用保存、缺 `__typename` 静默跳过、字段 id 赋值到普通对象、不拒绝旧形状库：22 条全部有用例变红。

## Decision Log

| 日期 / 作者 | 决策与理由 |
|---|---|
| 2026-10-05 / 人类 + 规划评审 | Provider 只报告原生事实，角色与规范状态映射属于 Host；不按名称猜（R2、不变量 5）。保留。 |
| 2026-10-06 / 人类 | 单 PR 规模例外。**Superseded by 2026-10-07 重写**：精简后无需例外。 |
| 2026-10-07 / 人类 | 撤回机械三层 stack，恢复单 PR，先判断实现本身是否合理再谈拆分。 |
| 2026-10-07 / 人类批准 | 删除只写不读的 `planning_field_value` 整组落库，原生值持久化交给 #71 与其读方一起引入。 |
| 2026-10-07 / 人类批准 | 工作区映射作为组装输入、不持久化，持久化与配置来源留给 #229 或后续设置工作。 |
| 2026-10-07 / Claude | 映射结果写进唯一的 `planningStatus`，展示事实只存原生名、迭代 title、目标日期。理由：修复双状态源（P1），不变量 1 / 7。 |
| 2026-10-07 / Claude | 字段定义与条目值单页读取，`hasNextPage` 即失败；删除逐条目续页与多页定义扫描。理由：平台 50 字段上限；不扩 R7 参数面。 |
| 2026-10-07 / Claude | 展示事实存三列显式列，不用 JSON 列。理由：无需解析校验，沿用「列清单只写一次」。 |
| 2026-10-07 / Claude（独立复评后） | 旧 002 形状在打开时拒绝，不写兼容迁移；判据只看「投影表在、展示列缺」，与 #126 共用 `assert002Shape`，不改动 #126 的判据本身。 |
| 2026-10-07 / Claude（独立复评后） | 引导里账本与投影来自两次扫描的现状不在本 PR 改：它同样影响内容字段，属于同步机制；本计划只修正措辞。 |

## Idempotence and Recovery

重复引导幂等：投影按 `(workspace, entity)` upsert，展示事实整行覆盖；失败的同步不推进 revision、不改已确认投影（沿用 `commitSync` 的单事务）。映射改变后，下一次同步按新映射重算全部投影。

历史改写的恢复锚点：`backup/pr268-before-stack-20261007` → `8115211`（第一版 head）。发布时先读远端旧 head，再精确 lease：

    locked_old_sha=$(gh pr view 268 -R SingularityKChen/harness-projects --json headRefOid --jq .headRefOid)
    git push origin HEAD:feature/project-field-read --force-with-lease=feature/project-field-read:"$locked_old_sha"

lease 失败即停止并重新读取远端，不改用裸 `--force`。整理提交前后用 `git diff <检查点> HEAD -- packages tests` 确认产品与测试树不变（期望无输出）。

## Interfaces and Dependencies

Node ≥ 22，pnpm 10.28.2（`pnpm install --frozen-lockfile`）；验证用 `./node_modules/.bin/tsc` 与 `node --test`。GitHub provider 依赖既有 `GraphqlTransport`；字段形状以 GitHub Projects GraphQL schema 为准，验收以仓库内录制为准。新增的公共接口：`NativePlanningFieldValue`、`WorkspacePlanningFieldMapping`、`PlanningFieldsSnapshot`（`packages/domain`），`ProviderPlanningFields.nativeValues`、判别联合 `ProviderPlanningFieldDefinition`、`ProviderIteration` 新形状（`packages/capabilities`），`CoreWorkspaceInput.planningFieldMapping`、`PlanningItemView.planningFields`（`packages/core`），`WireEntity.planningFields`（`packages/controller`）。PR 与 issue 写入使用 `SingularityKChen`，评审使用评审账号。

## Outcomes & Retrospective

本地结果：代码 801 / 1000（第一版 1826；规划上限 800，超出 1 行），全部 #133 验收与额外的权威状态、redaction、R2、旧库拒绝用例通过，22 条变异全部被杀死。与第一版相比少了：映射生命周期与持久列、逐条目续页查询、多页定义扫描、原生值落库链、JSON 快照编解码，以及为它们写的测试与夹具；独立复评补上的四条判别用例与旧库闸门约 70 行。

遗留：原生值持久化与读方（#71）；映射的来源与持久化（#229 或后续设置工作）；同步尊重 `StatusPolicy`（后续任务）。

回顾：第一版的 800 行停止门写在计划里却没有执行，规模问题被当成记账问题处理（例外、TD），没有回头质疑设计。超门时的第一反应应该是逐个机制问「它保护的是哪条验收或不变量」。

## Bottom Change Note

- 2026-10-05 CST：创建计划，收敛原生字段、Host 映射、同事务确认与列表展示方案。
- 2026-10-06 CST：记录第一版实现、评审修复与单 PR 规模例外。
- 2026-10-07 CST：评估第一版设计并复现双状态源；按人类批准的两项取舍重写为精简设计（单 PR、730 行），撤销规模例外与 TD-030 / TD-031 / TD-032 的登记需求。
- 2026-10-07 CST：处理独立对抗复评（P0/P1 为 0）：补四条判别用例、旧库打开时拒绝、映射快照冻结、解码器两处收紧，修正「账本是第二份副本」的说法；代码 801 行，变异表 22 条全部被杀死。
