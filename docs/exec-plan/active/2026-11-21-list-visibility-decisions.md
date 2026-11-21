# 列表可见性决策显式化（#314）ExecPlan

> 状态：Active（计划创建；实现批次尚未执行）
> 创建：2026-11-21
> 范围：把 `deriveWorkItemListView` 的入参校验、行可见性决策与展示装配在同一权威归约点内显式分离；公开输入/输出、全部文案、渲染结果与用户可见行为不变；不改 `packages/ui` 与 `apps`。
> 上游输入：issue #314 正文（含 2026-10-28 / 2026-10-29 的容量预测；验收标准与人类决策不变）。本计划自包含，不依赖仓库外文档。实现工作树 `.worktrees/list-visibility-decisions`，分支 `refactor/list-visibility-decisions`，基于 `main` @ `f74a3b8b`。

## Purpose / Big Picture

完成后，列表可见性优先级不再由 55 行混合函数的语句顺序隐式定义，而是由一张有序矩阵与一个纯决策函数显式定义；入参校验独立且仍在任何可见性结论之前；装配只消费决策结果，不再自行判断权限、缓存与失败。审查者在只读本计划与 `decideListVisibility` 的情况下，就能回答任一 phase × 读门 × 失败 × 快照 × 缓存组合「显示什么、为什么」。

最小成功证据（全部实跑）：

- `tests/contract/ui-work-item-list-view.test.js` 新增 20 行矩阵用例覆盖 6 段优先级，并在 M1–M6 变异下必红（记录红/绿后还原）。
- issue 验收命令（V1）通过：`tests 21 / pass 21 / fail 0`（基线 18）；`pnpm run typecheck` 通过（V2）。
- 15 个直接消费测试文件全绿（V9，基线 166，新增 3 个用例后 169）；六类 unavailable 文案、四类 statusText、readOnly/degraded、redaction 与 partial 语义逐字不变。
- 本 PR 的用户可见行为为零变化；成功不以 LOC 或复杂度分数定义（V5 只作体量上限）。

## Context and Orientation

术语与事实源：

- **归约点**：`deriveWorkItemListView`（`packages/ui-model/src/work-item-list-view.ts:155-209`，全文件 209 行）是 `WorkItemListView` 的唯一生产点；renderer 只消费 `view`，不推导读取过程、能力或 redaction。
- **读门**：`CapabilityKey.PlanningItemRead`（文件内 `READ_KEY`），由 `accessIndex(read.capabilities)` 取值；未观测 = 无该 key 条目，已观测不可读 = 值不属于 {available, read_only, degraded}（含非法枚举值）。
- **读取标记**：`phase`（pending / received / failed）、`refreshing`、`hasReceivedSnapshot`、`cacheVisibility`（authorized / unknown）、`failure.kind` 与可选 `safeMessage`。Host / 壳拥有这些观测事实；ui-model 只消费并校验其自洽。
- **明确阻断**：permission_denied / not_supported / unknown 三类，永不借授权缓存。
- **授权缓存**：仅 offline / error 可借；须 `hasReceivedSnapshot === true` ∧ `cacheVisibility === 'authorized'` ∧ 读门已观测可读。
- **partial**：整表未确认但每条可见 item 行都已确认；redacted 行的新鲜度不参与该结论（#366/#382 契约）。
- **消费面**：生产调用点 3 个（`packages/ui/src/work-item-app.ts:59`、`packages/ui-model/src/work-item-detail-view.ts:55`、`packages/ui-model/src/delivery-overview.ts:10`）加 renderer（`packages/ui/src/work-item-list.ts` 消费 `view`）；另有 15 个直接消费测试文件。
- **生产输入装配**：唯一构造点 `packages/ui/src/work-item-app.ts:56-57`，其中 `hasReceivedSnapshot: true` 与 `cacheVisibility: 'authorized'` 同时硬编码；`denied` 仅在 `read.reason === 'permission_denied'` 且读门 `unavailable` 时成立。生产路径上缓存门只作防御，不参与决策。

当前状态（2026-11-21 在 `f74a3b8b` 核对）：

1. `deriveWorkItemListView` 混编入参校验（:158-167）、列表派生（:168）、读门索引（:169）、优先级阶梯与缓存门（:179-189）、行投影与文案（:193-207）。
2. 优先级仅由 :179-198 的 return 顺序隐式定义；仓库没有任何一处写出完整矩阵。
3. 同一失败分类事实拆在四处：`UNAVAILABLE`（5 类文案，:94-100）、`GATE_BLOCKED`（:102）、`EXPLICIT_BLOCK`（3 类不借缓存，:104）、`READABLE`（3 个 AccessLevel，:105）；「可否借缓存」不在文案表里。
4. 仓库无 eslint 配置、无 eslint 依赖、无复杂度或函数行数门禁；issue 的 47 行 / 复杂度 37 是审计 AST 估计，不是门。
5. 前置 #366、#429、#430 均已 CLOSED；并行 issue #191（core）、#396（tests 共享 walker）、#138（providers）与本 PR 写面不重叠。
6. 基线实跑（同日，`f74a3b8b`）：V1 `18 pass / 0 fail`；V3 `28 pass / 0 fail`；V4 `10 pass / 0 fail`；V9 `166 pass / 0 fail`；V2 exit 0；`rule-checks size origin/main` 代码 0/1000、文档 0/1500。
7. 本计划先于任何代码改动提交（issue 要求）；Batch 1 以本计划已入库为前置。

## Design / Spec

### 选择

只改 `packages/ui-model/src/work-item-list-view.ts`。在同一文件内新增 6 个私有声明（2 个类型、1 张表、3 个函数），`deriveWorkItemListView` 成为五步编排：

```ts
/** 已校验的读取标记：phase 判别后的收窄视图。 */
type ReadMarks =
  | { readonly phase: 'pending' }
  | { readonly phase: 'received'; readonly refreshing: boolean }
  | { readonly phase: 'failed'; readonly failure: ListReadFailure
      readonly hasReceivedSnapshot: boolean; readonly cacheVisibility: 'authorized' | 'unknown' }

/** 是否可显示行 + 原因 + 文案来源；不携带现成字符串或渲染字段。 */
type ListVisibility =
  | { readonly kind: 'loading'; readonly gateUnobserved: boolean }
  | { readonly kind: 'unavailable'; readonly reason: ListReadFailure['kind']
      readonly copy: 'failure' | 'gate_blocked' }
  | { readonly kind: 'content'; readonly degradedPage: boolean; readonly refreshing: boolean }

/** 文案 + remaining + 是否借授权缓存合并为同一事实。 */
const FAILURE: Readonly<Record<ListReadFailure['kind'],
  { readonly message: string; readonly remaining: string; readonly borrowsCache: boolean }>>

function validateReadInput(input: WorkItemListReadInput): ReadMarks
function decideListVisibility(marks: ReadMarks, access: AccessLevel | undefined, listStale: boolean): ListVisibility
function listStatusText(refreshing: boolean, partial: boolean, stale: boolean, readableCount: number): string
```

`deriveWorkItemListView` 正文固定为：① `const marks = validateReadInput(input)`；② `const list = deriveWorkItemList(read)`（时间戳校验保持在决策之前）；③ `const access = accessIndex(read.capabilities ?? []).get(READ_KEY)`；④ `const visibility = decideListVisibility(marks, access, list.stale)`；⑤ 装配。装配段落逐字保留：`shell`、`flags`、`nameOf`、`rowView`、`partial`、`listStatusText` 的输出、body 字段顺序与可选键（`lastUpdatedAt` / `reconciledAt` / `notice` / `partial`）。

`copy` 只有两值：`'failure'` 表示用 `FAILURE[reason]`（读门未观测且没有结构化失败时 reason 为 `unknown`，即「尚未确认」文案）；`'gate_blocked'` 表示用 `GATE_BLOCKED`（只出现在读门已观测不可读且没有结构化失败时）。`safeMessage` 仍只在 unavailable message 后追加。

### 有序优先级矩阵（本计划为唯一权威）

| # | 条件 | 决策 | 文案 | 行 |
|---|---|---|---|---|
| 0 | 坏 phase / failed 缺 failure 或 failure.kind 不属表 / 非布尔 refreshing 或 hasReceivedSnapshot / 非两值 cacheVisibility / 坏时间戳 | `TypeError`，无 view | — | — |
| 1 | failed 且 `FAILURE[kind].borrowsCache === false` | unavailable(reason=kind, copy=failure) | FAILURE[kind] | 无 |
| 2 | 读门未观测且 phase≠pending | unavailable(reason=failure?.kind ?? 'unknown', copy=failure) | FAILURE[reason]（无失败时即「尚未确认」） | 无 |
| 3 | 读门已观测但 ∉ {available, read_only, degraded} | unavailable(reason=failure?.kind ?? 'unknown', copy=失败存在?'failure':'gate_blocked') | GATE_BLOCKED 仅当无结构化失败 | 无 |
| 4 | phase=pending（读门可读或未观测） | loading(gateUnobserved = 读门未观测) | 首读文案；未观测时追加「，读取能力尚未确认」 | 无 |
| 5 | failed 且 ¬(hasReceivedSnapshot ∧ cacheVisibility=authorized) | unavailable(reason, copy=failure) | FAILURE[reason] | 无 |
| 6 | 其余（received；或 failed + 授权缓存） | content(degradedPage = failed ∨ 读门 degraded；refreshing = received ∧ refreshing) | 四级 statusText | 全部 |

横切规则：第 0 段的校验先于一切可见性结论，时间戳由 `deriveWorkItemList` 在决策前校验；第 1/2/3/5 段的 body 不含 `rows` 键；unavailable 页 `readOnly`/`degraded` 恒为 false；`stale = list.stale ∨ degradedPage`；行 stale = `row.freshness.stale ∨ degradedPage ∨ refreshing`（不能用 `body.stale`）；redacted 行恰为 `{kind, key}`；canary 不出现在文本、属性、对象键或 metadata。

第 2/3 段在存在结构化失败（只可能是 offline / error，因为第 1 段已拦截另外三类）时使用 FAILURE[reason] 文案而不是「尚未确认」/GATE_BLOCKED，这是现状行为，见 Decision Log D2。

### 不变量

- I1 唯一归约点：`deriveWorkItemListView` 仍是唯一可见性入口；新单元私有、纯、无时钟、无 memo、无 I/O。
- I2 接线先于决策、list 派生先于决策；阻断态不得掩盖坏接线。
- I3 明确阻断永不借缓存：可读读门 + 已收快照 + authorized 缓存下仍 0 行。
- I4 借缓存四条件同时成立（见 Context 的「授权缓存」）。
- I5 读门未观测或已观测不可读时永不出 content；pending 不无限等待（读门已观测不可读时直接 unavailable）。
- I6 输出等价：body 分支、reason、message/remaining、statusText、readOnly/degraded、rows 的键与顺序、stale/refreshing/partial、时间字段全部逐字不变。
- I7 遮蔽：redacted 行只为 `{kind, key}`；canary 不进入文本、属性、键或 metadata。
- I8 依赖与导出面不变：仍只依赖 `client` 与 `domain`；不新增公共导出、import 边、依赖或配置。

### 状态拥有者与语义边界

| 事实 | 拥有者 | 本次改动 |
|---|---|---|
| `WorkspaceRead`（workspace / connection / store / capabilities / lastUpdatedAt / reconciledAt / reason） | Host / 壳（`WorkspaceSource`） | 只读消费 |
| `phase` / `refreshing` / `failure` / `hasReceivedSnapshot` / `cacheVisibility` / `metadata` | Host / 壳（`work-item-app.ts` 或测试夹具） | 只读消费并校验 |
| 「是否可显示行、原因、确定性」 | **ui-model 归约点** | 收敛为 `decideListVisibility` |
| 「显示什么文案、行长什么样」 | **ui-model 归约点** | 留在装配段与 `listStatusText` |
| 渲染与 DOM 属性 | `packages/ui` | 不变 |

### 失败路径

1. 坏接线 → `TypeError`（宿主 bug 的响亮信号，不渲染半真状态）。
2. 读门未观测 → 阻断；无结构化失败时「尚未确认」，有 offline/error 时用其文案。
3. 读门已观测不可读 → 阻断；无结构化失败时用 `GATE_BLOCKED`（能力已确认不可用、原因未提供），有失败时用失败文案。
4. 明确阻断 → 对应分类文案，不借缓存、不等待。
5. 可借失败但缓存门未过 → 对应分类文案，无行。
6. 可借失败且缓存门通过 → content、整页 stale、全部行 stale、statusText 用「当前结果尚未确认，最后已知值不是当前值」。
7. 恢复：授权恢复 / 重连 / 读门后续观测后由下一轮 received 进入 content；刷新期间保行但全部行 stale 且 statusText 为刷新文案。

### 被否决的方案

1. **新模块 + 导出决策函数**：给同一权威加第二语义落点与额外导出，而 detail/overview 只需要 `View`；今天没有「要决策不要 View」的消费者。放弃。
2. **纯数据驱动真值表 / 谓词数组**：TS 对 5 维组合的收窄成本高、易漏组合；一张有序阶梯加矩阵测试已满足可审性。放弃。
3. **不拆结构（只补注释 + 合并表 + 矩阵）**：能满足验收 1/2/3/5，但验收 4 最弱。保留为预算或审查受阻时的回退（停止条件：`decideListVisibility` 需要超过 5 个参数或必须导出）。
4. **把文案元组放进决策 union**：把展示文案耦合进语义决策，装配侧无法独立演进；只保留 `copy` 选择器。放弃。
5. **content union 携带 `stale` 并用于行 stale 传播**：会让「整表原因只降级整表、已确认行保持 fresh」的既有契约失真（见 Surprises 第 6 条）。放弃。
6. **删除 `flags` / 修改 `work-item-app.ts` 的硬编码 / 删除 `safeMessage`**：前者不是死代码，后两者是行为或公共类型变化，超出行为保持重构。不做。
7. **新增 `docs/architecture/` 常驻矩阵页**：同一事实会出现第二份副本，且 issue 未要求；放弃（见 D6）。

### 判别性测试策略

现有测试不改不删：`ui-work-item-list-view.test.js`（15 例）、`ui-work-item-list.test.js`（renderer HTML/属性/泄漏面）、`ui-work-item-list-browser.test.js`（esbuild 浏览器路径 + 真实 app/store 框架夹具）、detail/overview/board/integration/e2e 消费链。它们是行为等价的最强证据。

只在 `tests/contract/ui-work-item-list-view.test.js` 新增 3 个用例：

1. `可见性矩阵：按阶段 / 读门 / 失败 / 快照 / 缓存授权的顺序判定，每格恰有一个决策`：21 行表驱动（见 Surprises 第 12 条），逐行断言 `{readOnly, degraded, statusText, body.kind, body.reason, body.stale, body.refreshing, body.partial, rows(kind,key,stale), 'rows' in body}`，并对每行 `JSON.stringify(view)` 做 canary 扫描；覆盖第 1–6 段与下列边界格：明确阻断压过授权缓存、offline + 读门未观测与读门不可读、gate blocked 的两种文案来源（无失败 vs 有失败）、pending + gate blocked 不进 loading、pending + read_only / degraded、received + read_only / degraded / refreshing、failed + 授权缓存 + read_only、failed + ¬snapshot / ¬authorized、gap 的 partial 与混合新鲜度、全 redacted 的 partial 不成立。
2. `输出形状白名单：view、不可用 body、content body 与行对象的键集固定`：精确键集 + 可见行正控；新增调试字段、把 failure 或内部 cause 塞进 body 必红。
3. `坏接线先于可见性决策：阻断态不掩盖非法 phase / failure / 读取标记 / 时间戳`：新增 `failed(permission_denied) + lastUpdatedAt:'yesterday'` 抛 TypeError，以及 `failure.kind='constructor'` 抛 TypeError。

变异验证（在最终 head 上临时改源码，记录红/绿后还原，不提交）：

| 变异 | 期望变红的用例 |
|---|---|
| M1 明确阻断判断移到缓存门之后 | 矩阵第 1 段边界格 |
| M2 缓存门忽略 cacheVisibility | 矩阵 offline + cache unknown 格 |
| M3 gate_blocked 改用「尚未确认」文案 | 矩阵 gate blocked 格 |
| M4 把 `deriveWorkItemList` 移到决策之后 | 坏接线用例（坏时间戳） |
| M5 用 truthy 代替布尔标记校验 | 坏接线用例 |
| M6 行 stale 改用 `body.stale` | 矩阵 gap 混合新鲜度格 + 既有「行新鲜度」用例 |
| M7 loading 带 degraded=true | 既有「read_only 与 degraded」用例 |
| M8 body 增加内部字段 | 输出形状白名单用例 |

### 明确不在范围

- 历史数据库升级、兼容层、迁移脚本；保留实验性 pre-MMP fixture 为公开契约。
- 修改 `packages/ui` 的输入装配（含 `work-item-app.ts:56-57` 硬编码），或修改 reducer 以区分「从未读到」文案（见 D5、D11）。
- 修改 detail/overview/renderer/browser 测试、fixtures、配置、锁文件、生成物。
- 新增 eslint/复杂度门禁，或以 LOC/复杂度作为验收标准。

## Global Constraints

- 允许改动的 tracked 文件集合（唯一声明，他处不复述）：`packages/ui-model/src/work-item-list-view.ts`、`tests/contract/ui-work-item-list-view.test.js`、本计划（初始 `docs/exec-plan/active/2026-11-21-list-visibility-decisions.md`，验收后移到 `docs/exec-plan/completed/`）、`docs/README.md`（归档时新增 1 行）。
- 不新增依赖、公共导出、import 边、配置、锁文件、生成文件或迁移；不动 `packages/ui`、`apps`、providers、storage、controller、client、domain。
- 行为保持是硬性验收：全部文案、属性、键、顺序、可选字段与现有测试断言逐字不变；既有测试不削弱、不删除。
- 体量：单个 PR 技术改动 ≤800 行（仓库硬上限 1000）、文档 ≤1300 行（硬上限 1500）；本计划估算技术约 240–320 行、文档约 350–380 行。
- 预发布仓库：不设计向后兼容；不保留双实现；旧实验形状只有在证明是死代码后才删。
- 文档正文中文，代码标识符、路径、命令英文；计划内不写本机绝对路径；证据带执行上下文（分支 / head）。
- 提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，`Closes #314`；每个批次收敛成可独立审阅的提交；不 push `main`、不自行合并。
- 不修改历史证据文件中的源码 SHA-256（`docs/product/planning-board-evidence/README.md`、`docs/product/release-list-delivery-evidence/mmp-historical-width-manifest.json`）：它们记录过去捕获身份，且无测试校验。
- 不写看板 `Status`；合并与规划状态由人类伙伴决定。

## Plan of Work

### Batch 1 · 特性化矩阵与判别力证明（只改测试）

**最小闭环**：新用例在当前实现上全绿（特征化），并用临时变异证明可失败。
**涉及文件**：`tests/contract/ui-work-item-list-view.test.js`。

1. 新增 `VISIBILITY_MATRIX` 表（21 行，覆盖上文第 1–6 段与边界格）、归一化投影函数与逐行断言；每行附带 canary JSON 扫描。
2. 新增输出形状白名单用例与坏接线优先用例。
3. 跑 V1（期望 `tests 21 / pass 21 / fail 0`）、V2。
4. 在**当前实现**上做三个临时变异并各跑一次 V1：MA 从 `EXPLICIT_BLOCK` 去掉 `permission_denied`；MB 让缓存门忽略 `cacheVisibility`；MC 把 `GATE_BLOCKED` 换成 `UNAVAILABLE.unknown`。确认矩阵变红后逐项还原，再跑 V1 回到 21/21。
**验证**：V1、V2（命令见 Validation and Acceptance）。
**回滚**：撤回该测试提交；生产代码零改动。

### Batch 2 · 校验与失败表合并（源文件，行为不变）

**最小闭环**：校验独立，失败文案表与缓存政策表合并为 FAILURE（GATE_BLOCKED、READABLE 保留），行为与现有输出逐字相同。
**涉及文件**：`packages/ui-model/src/work-item-list-view.ts`。

1. 引入 `FAILURE`（5 类，含 `borrowsCache`）替换 `UNAVAILABLE` 与 `EXPLICIT_BLOCK`；`GATE_BLOCKED` 与 `READABLE` 保留。
2. 引入 `ReadMarks` 与 `validateReadInput`；failure.kind 校验继续用 `Object.hasOwn(FAILURE, …)`。
3. 现有 if 链改为消费 `marks`（顺序逐行对应矩阵），暂不提取决策函数；装配段逐字不动。
4. 跑 V1–V4。
**验证**：V1（21/21）、V2（exit 0）、V3（28/28）、V4（10/10）。
**回滚**：单提交 revert；Batch 1 用例继续通过。

### Batch 3 · 决策提取与装配收口（源文件）

**最小闭环**：可见性优先级集中为 `decideListVisibility`，导出函数只剩编排 + 装配。
**涉及文件**：`packages/ui-model/src/work-item-list-view.ts`。

1. 引入 `ListVisibility` 与 `decideListVisibility(marks, access, list.stale)`；导出函数改为五步编排。
2. 引入 `listStatusText` 承接四段文案；删除被搬走的死分支与重复收窄；不改任何字符串、字段或键。
3. 跑 V1–V4、V9。
4. 跑 M1–M8，记录每个变异的红/绿与具体失败用例；逐个还原后用 V1 与 `git diff --quiet` 确认工作树只余预期改动。
**验证**：V1（21/21）、V2（exit 0）、V3（28/28）、V4（10/10）、V9（169/169）。
**回滚**：单提交 revert 回到 Batch 2；无数据、配置或外部状态影响。

### Batch 4 · 文档归档、体量与发布面门禁

**最小闭环**：计划记录真实结果、归档完成，发布面门禁全绿，PR 可评审。
**涉及文件**：本计划、`docs/README.md`。

1. 更新 Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective：写入实际验证输出、变异结果与 V5 实际行数。
2. 把本计划移到 `docs/exec-plan/completed/2026-11-21-list-visibility-decisions.md`（文件名不变），在 `docs/README.md` 的 Completed 表新增 1 行索引。
3. 跑 V5–V8，再跑 V1、V2 作为最终 head 证据。
4. 整理本地提交（无 debug/fixup）；开 draft PR，描述含闭环、ExecPlan + 批次、真实证据、风险与回滚，`Closes #314`；请求人类评审，不自行合并。
**验证**：V5（exit 0，代码 ≤800、文档 ≤1300）、V6（exit 0）、V7（无输出）、V8（`#314 conforms`）、V1/V2 复跑通过。
**回滚**：revert 文档提交；代码结论不受影响。

## Validation and Acceptance

以下命令在本工作树根目录（`.worktrees/list-visibility-decisions`）执行；编号在批次中引用，不重复展开。

**V1 归约点契约（issue 验收命令的超集）**

```
node scripts/resolution-check.mjs && node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js
```

期望：`ℹ tests 21`、`ℹ pass 21`、`ℹ fail 0`，exit 0。基线（改动前）为 18 pass / 0 fail；新增 3 个用例。该命令先跑 `resolution-check`，随后就是 issue 原文的 `node --test` 两个文件。

**V2 类型检查**

```
pnpm run typecheck
```

期望：exit 0，tsc 无错误输出。

**V3 下游等价（renderer + 详情）**

```
node scripts/resolution-check.mjs && node --test tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-detail-view.test.js
```

期望：`ℹ tests 28`、`ℹ pass 28`、`ℹ fail 0`（这两个文件测试不得修改，数量应与基线一致）。

**V4 依赖边界**

```
pnpm run boundaries
```

期望：`ℹ tests 10`、`ℹ pass 10`、`ℹ fail 0`。

**V5 体量**

```
node scripts/rule-checks.mjs size origin/main
```

期望：exit 0；输出 `代码：N / 1000 行` 且 N ≤800（本计划预计 240–320），`文档：M / 1500 行` 且 M ≤1300（预计约 350–380）。

**V6 发布面机械扫描**

```
node scripts/rule-checks.mjs disclosure origin/main
```

期望：exit 0，输出「机械扫描通过」；人工五类目检查另按 `docs/development/publication.md` 执行。

**V7 空白与冲突标记**

```
git diff --check origin/main...HEAD
```

期望：无输出，exit 0。

**V8 issue 约定检查**

```
node scripts/policy-check.mjs issue 314
```

期望：输出 `#314 conforms: refactor(ui-model): make list visibility decisions explicit`，exit 0（需要已登录的 `gh`；离线时跳过并在 PR 证据中写明）。

**V9 全部直接消费测试文件**

```
node scripts/resolution-check.mjs && node --test --test-timeout=180000 $(grep -rl 'deriveWorkItemListView' tests --include='*.test.js' | sort | tr '\n' ' ')
```

期望：`ℹ tests 169`、`ℹ pass 169`、`ℹ fail 0`（15 个文件；基线 166，新增 3 个用例）。该命令覆盖 renderer、浏览器打包、detail、overview、board、integration 与 e2e 消费链。

**不使用 `pnpm test` 作为本地门**：clean `main` 上它已有 2 个与本改动无关的失败（见 Surprises 第 7 条）；本计划用 V1–V4、V9 作为可复现的本地证据，合并门仍是 CI `PR Fast Gate`。

**验收标准映射（issue 原文）**

1. 矩阵记录优先级并覆盖 permission withdrawal / unknown / unsupported / redaction / offline authorized cache / refresh freshness → Design 的有序矩阵 + Batch 1 的 `VISIBILITY_MATRIX` 逐格用例。
2. 坏接线被拒绝、redacted/denied canary 不出现在文本/属性/键/metadata → Batch 1 坏接线用例 + 矩阵逐行 canary 扫描 + 既有 renderer 属性扫描与 view JSON 用例。
3. 许可输入上行为与公开输入/输出等价，由现有与新增判别用例证明 → V1、V3、V9 + 现有测试零修改 + M1–M8。
4. 归约点决策职责更易审查；不以 LOC ≤50 或复杂度 ≤20 为成功定义 → `decideListVisibility` 有序阶梯 + 矩阵；V5 只作体量上限。
5. `node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js` 与 typecheck 通过 → V1、V2。

## Progress

- [x] Batch 1 · 特性化矩阵与判别力证明（2026-11-21，本提交）：新增 3 个用例（21 行矩阵 + 输出形状白名单 + 坏接线优先），当前实现上全绿；V1 `ℹ tests 21 / pass 21 / fail 0`、V2 exit 0；临时变异 MA（EXPLICIT_BLOCK 去掉 permission_denied）→ 矩阵等 3 用例红，MB（缓存门忽略 cacheVisibility）→ 5 用例红，MC（GATE_BLOCKED 换成 FAILURE.unknown）→ 3 用例红，均已还原且 `git diff --quiet` 通过。
- [ ] Batch 2 · 校验与失败表合并
- [ ] Batch 3 · 决策提取与装配收口
- [ ] Batch 4 · 文档归档、体量与发布面门禁
- 2026-11-21：计划创建；事实在 `f74a3b8b` 独立核实（基线见 Surprises 第 9 条）；实现未开始。

## Surprises & Discoveries

1. issue 引用 `9a4ead3aa968…:124` 在当前基线已漂移到 `work-item-list-view.ts:155`；引用仍有效，但本计划所有行号以 `f74a3b8b` 为准。
2. 仓库没有 eslint 配置、没有 eslint 依赖、没有复杂度或函数行数门禁；issue 的 55 行 / 复杂度 37 是审计用 AST 估计，不是可执行门。
3. 生产装配同时硬编码 `hasReceivedSnapshot: true` 与 `cacheVisibility: 'authorized'`（`packages/ui/src/work-item-app.ts:56-57`）。探针 P9 显示 `failed(error)+authorized+lastUpdatedAt undefined+读门可读` → content、0 行、整表 stale；探针 P10 在读门未观测时则是 `unavailable(error)`「且没有可显示的快照」。两种文案都可达，属 Host 装配语义而非 reducer 已确认缺陷（见 D5、D11）。
4. 读门分支在存在结构化失败时使用失败文案：`failed(offline)+读门未观测` 与 `+读门已观测不可读` 都返回 `unavailable(offline)` + FAILURE.offline（探针 P2/P3），不是「尚未确认」或 GATE_BLOCKED。矩阵第 2/3 段按现状钉住。
5. `failure.kind='constructor'` 与 `cacheVisibility='Authorized'` 都抛 `TypeError`（探针 P6/P7）：合并表必须保留 `Object.hasOwn`，不能用原型链查找。
6. `body.stale` 与行 staleness 不同源：gap 输入下 `body.stale=true` 而 item 行 `stale=false`（探针 M17，既有「行新鲜度」用例同样断言）。行传播只能用 `degradedPage`。
7. clean `main` @ `f74a3b8b` 上 `pnpm test` 失败 2 个与本改动无关的用例：`tests/contract/development-contract.test.js:289`（120s 超时）与 `tests/contract/review-mutation-harness.test.js:485`（`基线没有启动`）。因此本计划用 V9 消费面套件作为本地门。
8. `docs/product/planning-board-evidence/README.md` 与 `docs/product/release-list-delivery-evidence/mmp-historical-width-manifest.json` 记录了本文件某次捕获的 SHA-256，但测试/脚本不校验；它们是历史捕获身份，不得更新。
9. 基线与环境（2026-11-21）：`main` 工作树干净 @ `f74a3b8b211f`；Node v26.13.1；V1 18/18、V3 28/28、V4 10/10、V9 166/166（改后预期 169）、V2 exit 0、V5 0/0；实现工作树 `.worktrees/list-visibility-decisions` 已在分支 `refactor/list-visibility-decisions`。
10. #366/#429/#430 已 CLOSED；并行 #191/#396/#138 的写面（core 重协调、tests 共享 walker、providers worktree）与本 PR 不重叠。
11. issue 验收命令点名的是 2 个测试文件（view + browser），不是 3 个。
12. 矩阵实际为 21 行而非创建时的 20 行：把「gap 混合新鲜度」「gap 部分读取」「全 redacted 且 partial 不成立」拆成三个独立格，避免同一格同时承担三种决策；逐行证据见 Batch 1 提交。

## Decision Log

| 编号 | 决策 | Rationale | 日期 / 来源 |
|---|---|---|---|
| D1 | 同文件私有单元 + 单张失败表；不新建模块、不导出决策函数 | issue 要求 within the same authoritative reducer；detail/overview 只需要 `View`；导出会成为第二语义落点 | 2026-11-21 计划评审 |
| D2 | 原样保留两处历史优先级行为（读门分支用失败文案；pending + gate blocked 直接 unavailable），矩阵标注「现状契约」，另开 issue 讨论 | 行为保持验收优先；修正会改变用户可见文案 | 2026-11-21 计划评审 |
| D3 | 决策 union 只携带 `copy: 'failure' \| 'gate_blocked'` 选择器，不携带文案元组或 safeMessage | 装配拥有展示文案；避免语义决策与展示耦合 | 2026-11-21 计划评审 |
| D4 | content 携带 `degradedPage` 而非 `stale`；行 staleness 由 `degradedPage` 传播 | 保护 #366/#382 的 partial 契约（整表原因只降级整表，已确认行保持 fresh） | 2026-11-21 计划评审（探针 M17） |
| D5 | 保留 `flags`、`safeMessage`；不改 `work-item-app.ts` 的硬编码标记 | 非死代码 / 公共安全通道 / 行为变化超出范围 | 2026-11-21 计划评审 |
| D6 | 矩阵唯一权威在本计划；测试表按 6 段生成；代码 JSDoc 只留优先级摘要 | 避免三份完整副本漂移（PLANS「一个事实只写一处」） | 2026-11-21 计划评审 |
| D7 | 只新增测试，不改不删现有测试；用「特征化绿 + 变异必红」证明判别力 | 行为保持重构没有可先红的缺陷；变异是可失败的证据 | 2026-11-21 计划评审 |
| D8 | 本地门用 V1/V3/V4/V9，不用 clean `main` 已失败的 `pnpm test`；CI `PR Fast Gate` 为最终门 | 证据必须在本仓可复现；不把环境噪声当成回归 | 2026-11-21 计划评审 |
| D9 | 历史证据 SHA-256 文件不更新 | 记录的是过去捕获身份，不属于本 PR 的当前字节契约 | 2026-11-21 计划评审 |
| D10 | 本计划先以 active 路径提交，Batch 4 验收后移到 completed 并加 `docs/README.md` 一行 | PLANS §2 生命周期；与既有归档提交一致 | 2026-11-21 计划评审 |
| D11 | 待人类批准：两处历史优先级 quirk 是否长期作为产品契约；生产装配硬编码是否需要另立 issue | 默认选择（保留 + 记录）不阻塞本 PR；不擅自扩大范围 | 2026-11-21 计划评审 |

## Idempotence and Recovery

- V1–V9 全部幂等、可重复执行；新增测试不依赖执行顺序或外部网络（V8 除外，需要 `gh` 登录）。
- 每个 Batch 对应一个可 revert 的提交：B3 revert 回到 B2；B2 revert 回到仅测试状态；B1 revert 后生产零改动；B4 revert 只影响文档。
- 变异步骤必须还原后再提交：用 `git diff --quiet -- packages/ui-model/src/work-item-list-view.ts` 判定（期望 exit 0）；若不为 0，执行 `git checkout -- packages/ui-model/src/work-item-list-view.ts`，再跑 V1 确认回到 21 pass。
- 若与并行 issue 发生同文件冲突（当前无）：rebase 到最新 `main` 后重跑 V1–V4；不 force-push 共享历史。
- 无数据、配置、迁移或外部状态影响，回滚不需要外部协调；提交前整理本地提交（移除 debug/fixup），不 push `main`、不自行合并。

## Interfaces and Dependencies

- 运行环境：Node.js v26.13.1（观察值），pnpm scripts（`test:file` / `typecheck` / `boundaries`），`node scripts/resolution-check.mjs` 作为测试解析前置，`gh` 已登录（仅 V8）。
- 无新增依赖、包导出、import 边、锁文件或配置变更；`ui-model` 依赖方向仍是 `client` + `domain`。
- 公共接口不变：`WorkItemListReadInput`、`WorkItemListView`、`body`、`VisibleListRow`、`ListReadFailure`、`ListDisplayMetadata`、`SourceSchedule` 的形状与语义不变；不涉及 Host / Provider / Storage ABI、命令、事务、幂等键或外部写入。
- 唯一新增的内部契约是 `ReadMarks` / `ListVisibility` / `FAILURE` / `validateReadInput` / `decideListVisibility` / `listStatusText`，均为文件私有，不进入 `packages/ui-model/src/index.ts` 的公开面。

## Outcomes & Retrospective

创建时（2026-11-21）：实现批次尚未执行，本计划不预先声称实现结果。执行完成后本节必须记录以下事实（逐项写入实际值）：① V5 实际代码 / 文档行数；② 各批次实际偏差与恢复次数；③ M1–M8 与 MA–MC 实际红/绿及失败用例名；④ PR 编号、最终 head、`gh pr checks` 回读结果与人类合并决定；⑤ 若矩阵收窄，说明保留与放弃的格及理由。无法本地验证的项（真实 CI lane、人类视觉验收、安装验收）写成阻塞或明确遗留，不使用「应该可以」这类措辞。

## Bottom Change Note

- 2026-11-21：创建。收敛两份本地独立设计，按 `f74a3b8b` 独立重核源码、测试、脚本与 issue 事实；确定同文件私有单元 + 单失败表的最终方案，记录被否决方案、有序矩阵、判别性测试、变异、批次回滚点与本地 `pnpm test` 的基线失败。
