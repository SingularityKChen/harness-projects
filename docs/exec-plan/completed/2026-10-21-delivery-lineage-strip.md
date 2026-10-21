# 交付谱系条与共享新鲜度年龄规则 ExecPlan

> 状态：Completed（原实现已归档；2026-10-22 七条评审修复已完成本地验证，独立复评与最终 head 发布回读由协调者完成）
> 创建：2026-10-21
> 范围：issue #357。在 `packages/ui-model` 新增纯函数：把 core 的交付投影派生成六位置谱系条，并导出 #234、#281 共用的年龄规则；投影类型经 client 的纯类型子路径取得。不渲染（#234）、不做交付视图（#281）、不改 core 与在途 PR（#371、#372、#373）的文件。
> 上游输入：issue #357 的 4 条验收；`docs/adr/ADR-0011-delivery-facts-last-confirmed-snapshot.md` 第 3 条与 Consequences；`docs/product/vertical-path.md` §2 第 11 步；`packages/core/src/delivery.ts`、`packages/core/src/delivery-facts.ts`；tracker 的 TD-026、TD-042、TD-043、TD-045；消费方 #234、#281。

## Purpose / Big Picture

完成后，`@harness-projects/ui-model` 导出 `deriveDeliveryLineageStrip(projection, now, { thresholdMs? })`、`deliverySetFreshness(set, now, thresholdMs?)` 与 `DELIVERY_FRESHNESS_THRESHOLD_MS`（300 000）。谱系条按「执行上下文 → 工作树（分支）→ 提交 → 变更请求 → 流水线 → 检查」给出六个位置：每个位置要么恰好一个缺口，要么每跳一个节点；节点状态是单一枚举 `observed | passed | failed | unknown | stale`；可用性逐跳给出。#234 直接渲染它，#281 复用同一条年龄规则，渲染层不再自己判定 passed。

最小成功证据（在检出 `feature/delivery-lineage-strip` 的工作树根目录）：`node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js` 输出 `ℹ fail 0`；Validation 表的变异逐条先证明已生效、再被杀死；`pnpm verify` 退出码 0。

## Context and Orientation

- 交付投影 `DeliveryProjection`（`packages/core/src/delivery.ts:47-59`，controller 原样转发，`packages/controller/src/queries.ts:19`）：`hops[]`（`entityKind`、`externalId`、`label`、`fact`、`stale`、`unavailable` 及关系字段）、`freshness[]`（四个集合的 `{kind, confirmedAt, stale}`）、`gaps[]`（`{entityKind, reason}`，reason 为 `not_started`/`not_observed`/`not_refreshed`/`unconfirmed`）、`attemptedAt`（乱序令牌，可领先墙钟，不得展示、不得做减法）、`degraded`、`error`、`optional`。
- 命令位置 `execution_context`、`worktree` 只由开始工作写，`stale` 恒 false，worktree 跳的 `label` 是分支名；其余四个集合位置来自唯一写者 `refreshDeliveryFacts` 的快照，集合跳的 `stale` 就是集合的 `stale`（`delivery.ts:123-124`）。
- 写者不变量（`packages/core/src/delivery-facts.ts:30-40, 106-108`）：流水线集合完整当且仅当提交集合在同一次刷新里完整（检查依赖变更请求同理）；从未确认的集合 `nodes: []`；不完整的集合保留旧节点、旧锚点、旧 `confirmedAt` 并标 `stale`。`fact` 只有 `ci_passed`、`ci_failed`、undefined（`packages/core/src/chain-facts.ts` 的 `factFor`）。
- `WorkItemDetail.lineage`（`packages/ui-model/src/capability-access.ts` 的 `lineageEntryPoints`）按 capability key 判可用性；main 上只有测试消费，#373 把它作为 AC3 证据（`tests/e2e/repository-routing.test.js`）。
- ui-model 只能依赖 client 与 domain，type 导入也算（`tests/contract/package-boundaries.test.js`）；client 没有交付类型，已有纯值子路径 `./keys` 先例。浏览器包守卫 `tests/contract/ui-work-item-list-browser.test.js` 从 ui-model 根出口打包，client 只允许 `src/keys.ts` 进入。`tests/contract/ui-model-presentation.test.js` 禁止 ui-model 源码（含注释）出现平台名或界面框架名片段。
- ISO 8601 校验在 `packages/ui-model/src/derive.ts` 是私有的 `ISO_8601` + `assertTimestamp`，client 另有一份（TD-026）。
- 分支从 main@5a92c40a 切出，之后 #370 已合入 main；回读 `git rev-list --count HEAD..origin/main`，Batch 0 后期望 `0`。Superseded in part by S14（2026-10-21）：Batch 4 时 main 已前进（#372 合入），整合前须先追平。

## Design / Spec

接口（`packages/ui-model/src/delivery-lineage.ts`，经 `packages/ui-model/src/index.ts` 导出）：

```ts
export const DELIVERY_FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000
export const DeliveryFreshnessState = { Fresh: 'fresh', Stale: 'stale', Unconfirmed: 'unconfirmed' } as const
export const LineageNodeState = { Observed: 'observed', Passed: 'passed', Failed: 'failed', Unknown: 'unknown', Stale: 'stale' } as const
export type LineagePosition = 'execution_context' | 'worktree' | 'commit' | 'change_request' | 'pipeline_run' | 'check_run'
export interface LineageNode { readonly externalId: string | undefined; readonly label: string | undefined; readonly state: LineageNodeState; readonly available: boolean; readonly relationState: DeliveryProjection['hops'][number]['relationState'] }
export type LineageSlot =
  | { readonly position: LineagePosition; readonly kind: 'gap'; readonly reason: DeliveryProjection['gaps'][number]['reason'] | 'unknown' }
  | { readonly position: LineagePosition; readonly kind: 'nodes'; readonly nodes: readonly LineageNode[] }
export interface DeliveryLineageStrip { readonly slots: readonly LineageSlot[]; readonly nextFlipAt: number | undefined }
export function deliverySetFreshness(set: Pick<DeliveryProjection['freshness'][number], 'confirmedAt' | 'stale'> | null | undefined, now: string, thresholdMs?: number): DeliveryFreshnessState
export function deriveDeliveryLineageStrip(projection: DeliveryProjection, now: string, options?: { readonly thresholdMs?: number }): DeliveryLineageStrip
```

**类型来源**：新文件 `packages/client/src/delivery.ts` 只有 `export type DeliveryProjection = Awaited<ReturnType<ControllerQueries['getDeliveryProjection']>>`（`import type` 自 controller），`packages/client/package.json` 的 exports 加 `"./delivery"`；ui-model 只 `import type` 它。core 改字段名时 tsc 报错。

**年龄规则 `deliverySetFreshness`**（按序，先命中者生效）：
1. `now` 不是 ISO 8601 → `TypeError`；`thresholdMs` 不是有限非负 number → `RangeError`（0 合法，恒陈旧）。
2. 集合缺失（含 null），或 `confirmedAt` 缺失 / 不是 ISO 8601 → `unconfirmed`，不抛错。
3. `set.stale !== false`（含缺字段）→ `stale`。
4. `thresholdMs > max(0, now − confirmedAt)` → `fresh`，否则 `stale`（等于阈值即陈旧）。

入参类型只有 `confirmedAt` 与 `stale`，结构上拿不到 `attemptedAt`。ISO 校验搬到 `packages/ui-model/src/timestamp.ts` 的 `isIsoTimestamp`（不从 index 导出），`derive.ts` 的 `assertTimestamp` 改用它；D17 收紧不存在的月日，保留合法闰日、数值偏移与 `24:00`，非法 `now` 抛 TypeError、非法 `confirmedAt` 降为 unconfirmed。

**谱系条 `deriveDeliveryLineageStrip`**：先做第 1 步校验（`error` 投影也校验）；按六个固定位置迭代，不按 hops 迭代。没有跳的位置输出 `{position, kind: 'gap', reason}`，reason 取 `gaps` 里该位置的原因，没有则 `'unknown'`；有跳的位置输出 `{position, kind: 'nodes', nodes}`，每跳一个节点，保持 core 顺序。节点状态：`hop.stale !== false` 或集合判 `stale` → `stale`；集合判 `unconfirmed` → `unknown`；命令位置与提交、变更请求 → `observed`；CI 位置 `ci_passed` → `passed`、`ci_failed` → `failed`、其余 → `unknown`。命令位置不过年龄规则。`available = hop.unavailable === false`，不影响状态。不读 `attemptedAt`、`degraded`、`error`、`optional`、`from`、`to`、`relationType`、`relationSource`、`provenance`；运行时值只用字面量加 `satisfies`。

节点额外原样保留 `hop.relationState`，类型直接取 Core 投影；候选关系上的 `passed` 仅表示该节点 CI 事实通过，不确认它与工作项的关系。年龄判断与翻转时刻共享内部 `ageOf`：strip 输出 `nextFlipAt`（Unix 毫秒），取所有 fresh 集合 `confirmedAt + thresholdMs` 的最小值；没有 fresh 集合则 undefined。消费方在该时刻重新传当前 now 派生，并重排下一时刻；函数本身没有 timer 或时钟读取。

**不变量**：I1 `passed` ⇒ 集合新鲜、跳不陈旧且 `fact === 'ci_passed'`；I2 每个位置恰好一个 slot，缺口与节点二选一，节点数等于该位置 hops 数；I3 纯函数，不读时钟、不改入参、无模块级可变状态；I4 签名没有 capability 输入，输出没有动作或规划字段。

**嫁接与否决**（依据见 Decision Log）：采纳设计 1 的单一状态枚举、`client/delivery` 子路径与 `timestamp.ts`，设计 2 的坏 `confirmedAt` 降级为 unconfirmed，设计 3 的位置级 slot、`'unknown'` 回退与阈值 0 合法，设计 2/3 的真实 core 互通测试（合并为一个 e2e 文件）。否决：新鲜度与结论拆两字段及 `ageMs`/`cause`/`anchorId`/`errorCode`/`degraded`/`confirmedAt` 透出（设计 2、3），锚点比对（设计 3），未知 `entityKind` 抛错（设计 2），坏 `confirmedAt` 抛错（设计 1），阈值 0 被拒（设计 2），本 PR 预设「#234 删除 `lineageEntryPoints`」（设计 1、3）。

## Global Constraints

- **本 PR 文件集合（唯一声明处）**：新增 `packages/client/src/delivery.ts`、`packages/ui-model/src/delivery-lineage.ts`、`packages/ui-model/src/timestamp.ts`、`tests/contract/ui-delivery-lineage-strip.test.js`、`tests/e2e/delivery-lineage-strip.test.js`、本文件；修改 `packages/client/package.json`（exports 加 `./delivery`）、`packages/ui-model/src/derive.ts`（改用共享校验，D17 同时收紧日历日期）、`packages/ui-model/src/index.ts`（一行 export，职责说明补一句）、`docs/exec-plan/tech-debt-tracker.md`（TD-083、TD-084，TD-085 解决记录与 TD-026 现状订正）、`docs/README.md`（归档索引）、`docs/review/pr-389-mmp-review.md`（七条意见及修复证据）。
- **不改**：tracker 的其余既有行（尤其 TD-042、TD-043、TD-054）；`packages/core/**`、`packages/controller/**`；`packages/client/src/index.ts`（#372）、`packages/client/src/{store,sync,workspace-read}.ts`（#373）；`packages/ui-model/src/{capability-access,types,work-item-detail-view,work-item-list-view}.ts`；`packages/ui/**`、`apps/**`；`tests/contract/{ui-model-presentation,ui-work-item-list-view,ui-work-item-detail-browser}.test.js`；`docs/product/vertical-path.md`；ADR-0011；#371、#372、#373 文件清单里的其余文件。
- ui-model 只依赖 client 与 domain 且只用 `import type`；不新增依赖边，不扩 `@harness-projects/domain/values`；不出现 `Date.now` 或 `new Date(`；源码与注释不含平台名、界面框架名片段；首发前不写兼容层。
- Node v26 类型剥离，包内相对导入带 `.ts` 后缀；pnpm 用仓库 `packageManager` pin 的版本；提交身份经 `git -c user.name=… -c user.email=…` 单次传入，不写 git config。
- 规模：代码加测试 ≤ 800 行（预计约 360）；文档 ≤ 1300 行（预计约 300，含回填）。
- 人类专属：看板 Status、blocked-by / blocking 关系、ADR 状态变更；agent 不写，只记为待人类决定。

## Plan of Work

全部命令在检出 `feature/delivery-lineage-strip` 的工作树根目录（`.worktrees/delivery-lineage-strip`）运行。测试夹具：`T0 = '2026-10-21T07:00:00.000Z'`；`hop(kind, extra)` 生成字段齐全的跳（默认 `unavailable: false`、`stale: false`）；`set(kind, confirmedAt, stale = false)` 生成集合。

### Batch 0 · 对齐与规划提交
**最小闭环**：分支追平 main，本计划成为第一个提交。**涉及文件**：本文件。
- [x] `git fetch origin && git rebase origin/main`；`git rev-list --count HEAD..origin/main` 期望 `0`。
- [x] 提交 `docs(exec-plan): 规划交付谱系条与共享年龄规则`，正文末行 `Refs #357`。

**验证**：`git diff --check origin/main...HEAD` 无输出。**回滚**：另存本文件后 `git reset --hard origin/main`。

### Batch 1 · 类型出口与共享年龄规则
**最小闭环**：#281 可单独复用的 `deliverySetFreshness` 与常量。**涉及文件**：`packages/client/src/delivery.ts`、`packages/client/package.json`、`packages/ui-model/src/{timestamp,derive,delivery-lineage,index}.ts`。
- [x] 先红：在 `tests/contract/ui-delivery-lineage-strip.test.js` 写 A5「年龄规则」：299 999 ms → fresh、300 000 ms → stale；6 分钟前确认在默认阈值下 stale、`thresholdMs: 600000` 下 fresh、阈值 0 下 stale；`confirmedAt` 比 now 晚 1 小时在默认阈值下 fresh、阈值 0 下 stale（夹零）；集合缺失或 `confirmedAt` 为 undefined、`'2026-10-21'`、`'garbage'` → unconfirmed 且不抛；`stale: true` 与缺 `stale` 字段 → stale；`now` 为 undefined、`''`、`'2026'`、`'2026-10-21'`、`'2026-13-45T00:00:00Z'` → TypeError；阈值 NaN、-1、Infinity、`'300000'` → RangeError；常量等于 300000。运行 `node --test tests/contract/ui-delivery-lineage-strip.test.js`，期望非零退出并报 `does not provide an export named`。
- [x] 按 Design 实现类型别名、`isIsoTimestamp`、`deliverySetFreshness` 与常量，改 `derive.ts`、`index.ts`。

**验证**：A5 `ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`；`node --test tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/client-browser.test.js` `ℹ fail 0`。**回滚**：`git revert` 本批提交。

### Batch 2 · 谱系条派生
**最小闭环**：#234 可直接渲染的 `deriveDeliveryLineageStrip`。**涉及文件**：`packages/ui-model/src/delivery-lineage.ts`、`tests/contract/ui-delivery-lineage-strip.test.js`。
- [x] 先红 A1 正对照：完整链、两条流水线（`ci_passed`、undefined）、检查 `ci_failed`、now = T0 + 1 分钟 → 六个 slot 顺序固定，状态依次 observed×4、passed、unknown、failed，节点总数等于 `hops.length`。
- [x] 先红 A2 缺口：去掉提交跳、`gaps` 给提交 `not_observed`、流水线跳的 `to` 指向某提交实体 → 提交 slot 恰为 `{position:'commit', kind:'gap', reason:'not_observed'}`，无节点带该锚点，节点总数等于 `hops.length`；`error` 投影 → 六个 `'unknown'` 缺口。
- [x] 先红 A3 永不 passed 表（集合 stale 各行的 `hop.stale` 保持 false；全表断言只有正对照为 passed）：缺 freshness 条目 → unknown；`confirmedAt` undefined → unknown；集合 `stale: true` → stale；集合缺 `stale` 字段 → stale；年龄等于阈值 → stale；阈值减 1 ms → passed（正对照）；`hop.stale: true` 而集合新鲜 → stale；新鲜 `ci_failed` → failed；陈旧 `ci_failed` → stale；流水线集合新鲜而检查集合陈旧 → 流水线 passed、检查 stale（防映射错位）。
- [x] 先红 A4 只认 confirmedAt：`attemptedAt = now`、`confirmedAt` 为 10 分钟前 → stale；`attemptedAt` 为 `'garbage'` 或比 now 晚 1 天而 `confirmedAt` 新鲜 → passed。
- [x] 先红 A6 无规划控件：`Object.keys(...).sort()` 逐层精确等于 strip `['slots']`、缺口 `['kind','position','reason']`、节点 slot `['kind','nodes','position']`、节点 `['available','externalId','label','state']`；深度遍历无函数值。
- [x] 先红 A7 逐跳可用性：只翻转一条流水线跳的 `unavailable` → 只有对应节点 `available` 变 false 且状态不变；缺 `unavailable` 字段 → `available` 为 false；`delivery-lineage.ts` 的 import 说明符不含 `capability-access` 或 `client/keys`。反向（S9）：对 passed、failed、stale、unknown 四种 CI 状态（陈旧集合、年龄等于阈值、`hop.stale: true`、集合缺失、`confirmedAt` 缺失、无事实各一行）分别令 `unavailable` 取 false / true，断言 `available` 恒为 `!unavailable`、状态不变。
- [x] 先红 A8 纯度：深冻结入参调用两次结果 deepEqual；`packages/ui-model/src/{delivery-lineage,timestamp}.ts` 不含 `Date.now`、`new Date(`；坏 now 配 `error` 投影也抛 TypeError。
- [x] 先红 A9 非 CI 位置的降级（S9）：命令位置（`execution_context`、`worktree`）`hop.stale: true` 与缺 `stale` 字段 → stale，没有任何集合条目或集合早已超龄仍 observed；提交、变更请求位置——集合新鲜与年龄比阈值小 1 ms → observed（正对照），年龄等于阈值、集合 `stale: true`、`hop.stale: true`、缺 `stale` 字段 → stale，集合缺失、`confirmedAt` 缺失或不是 ISO 8601 → unknown，`hop.stale: true` 且集合未确认 → stale。
- [x] 实现 `deriveDeliveryLineageStrip` 与 `stateOf`。

**验证**：Batch 1 全部命令，加 `node --test tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-work-item-detail-browser.test.js`，期望 `ℹ fail 0`。**回滚**：`git revert` 本批提交，Batch 1 的年龄规则仍可用。

### Batch 3 · 真实 core 互通
**最小闭环**：手写 fixture 与真实投影的形状由同一组断言钉住。**涉及文件**：`tests/e2e/delivery-lineage-strip.test.js`（搭法照 `tests/e2e/delivery-lineage.test.js` 的 `startChain`：`composeCore` + `createFakeProviders()`，时钟固定 `() => T0`，仓库 `repo-alpha`）。
- [x] E1：刷新前四个集合位置是 `not_refreshed` 缺口、两个命令位置 observed；刷新后 T0 + 1 分钟流水线有 passed 与 unknown、检查有 passed；T0 + 299 999 ms 仍有 passed；T0 + 300 000 ms 无任何 passed，四个集合 slot 全部 stale。
- [x] E2：把 `providers.delivery.listPipelineRuns` 换成返回结构化失败后再刷新；T0 + 1 分钟流水线节点全 stale，检查仍有 passed，`attemptedAt` 晚于流水线集合的 `confirmedAt`。
- [x] 判别力：临时删掉 `stateOf` 的整个陈旧分支，确认 E2 变红后恢复（真实投影里 `hop.stale` 恒等于集合 `stale`，只删其一不会红，见 S6）。Superseded by S8（2026-10-21）：只删集合陈旧判定会被 E1 杀死，只有只删 `hop.stale` 判定在 e2e 上是等价变异。

**验证**：`node --test tests/e2e/delivery-lineage-strip.test.js tests/e2e/delivery-lineage.test.js` `ℹ fail 0`；若残留 `apps/harness-plugin/dist`，后者会变红（#350），先删除。**回滚**：删除该测试文件。

### Batch 4 · 对抗验收、回填与整合
**最小闭环**：最终树上的完整变异表、回填证据、整合提交。**涉及文件**：本文件、`docs/exec-plan/tech-debt-tracker.md`。
- [x] Opus 独立验收：在 `rsync -a --exclude .git ./ <scratch>/` 得到的拷贝里重跑 Validation 表全部变异，每条先用 `grep -c` 证明已生效，再记录杀死它的测试。
- [x] tracker 表尾追加 TD-083、TD-084（措辞见 D9、D10）；回填 Progress、Surprises、Outcomes。Superseded in part by D14（2026-10-21）：另登记 TD-085。
- [x] `git update-ref refs/backup/delivery-lineage-strip HEAD` 后整合为三个提交：规划提交（`Refs #357`）；`feat(ui-model): 派生交付谱系条与按 confirmedAt 的共享年龄规则`（实现与两份测试，正文末行 `Closes #357`）；`docs(exec-plan): 回填验证读数、变异表与技术债`（`Refs #357`）。用 `comm` 比对整合前后 head 的文件集合，期望相同。Superseded in part by D15（2026-10-21）：三个提交正文末行都写 `Refs #357`，关闭由 PR 正文的 `Closes #357` 承担。

**验证**：`pnpm verify` 退出码 0；`node scripts/rule-checks.mjs disclosure origin/main` 与 `node scripts/rule-checks.mjs size origin/main` 退出码 0；`git diff --check origin/main...HEAD` 无输出；`git log --format=%B origin/main..HEAD | grep -c '^#'` 输出 `0`。**回滚**：`git reset --hard refs/backup/delivery-lineage-strip`。

### Batch 5 · 2026-10-22 全部评审意见修复

主文件为 `delivery-lineage.ts` 与两份谱系条测试；不改 Provider、Core、Planning 或页面。先补公共派生日期、候选态、null 与翻转边界断言，观察实现缺口，再最小修复；测试缺口以回退变异 RED 证明。执行 `node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js`、`pnpm run typecheck`、相关 UI/交付回归与 `node scripts/review-mutate.mjs "$REVIEW_TMP/pr389-repair-mutations.json"`；预期 0，变异全部 KILLED 且原字节恢复。修订 TD-083/084 和过时 Outcomes，七个 commentID 的证据集中记入 `docs/review/pr-389-mmp-review.md`。回滚为撤销本批未提交改动，不能删除其他任务记录。

## Validation and Acceptance

| # | 验收项 | 判定证据（具名测试；变异 → 应变红的测试；历史 M/V/N 结果为原观察快照，当前独立验收见下文 R 表） |
|---|---|---|
| 1 | 缺跳派生为缺口，不派生为第二条关系 | A2、E1 刷新前；M11 去掉 `'unknown'` 回退 → A2 error 行；M12 按 hops 迭代或借邻居 `to` 造节点 → A2。**最终树判定**：M11、M12、V5、V12、N7 → A2；E-M4 → E1 |
| 2 | 未确认、标 stale、超阈值的集合永不派生为 passed | A3 全表、A1 正对照、E1、E2；M1 `>` 改 `>=` → A3/A5 等值行；M3 去掉集合 stale 判定 → A3；M4 改 `set.stale === true` → A3 缺字段行；M5 unconfirmed 当 fresh → A3/A5；M7 忽略 `hop.stale` → A3；M15 进行中 CI 判 observed → A1；M16 流水线与检查集合映射对调 → A3 错位行。**最终树判定**：M1、M3、M4、M5、M7、M8b、M16、M25、M28、V13、N2、N6 → A3（M1、M3、M4、M5 另有 A5）；M15、M21 → A1；E-M1、E-M3 → E2；E-M2、E-S6b → E1；V11 → A9（e2e 上另被 E1 杀死） |
| 3 | 年龄只用 `confirmedAt`；`attemptedAt` 新而 `confirmedAt` 旧 → stale | A4；M6 把 `projection.attemptedAt` 当 `confirmedAt` 传入 → A4。**最终树判定**：M6、M6b → A4；它们在 e2e 上是等价变异（M6@e2e、M6b@e2e 存活，见 S10），不作本项证据 |
| 4 | 永不提供编辑规划状态的控件 | A6；M14 节点加 `actions: []` → A6。**最终树判定**：M14 → A6、A1；V15 缺口加 `editable: false` → A6、A2 |
| 5 | 默认 5 分钟、可配置 | A5、E1；M2 去掉夹零 → A5 阈值 0 未来行；M8 忽略 `thresholdMs` → A5；M9 不校验 now → A5/A8；M10 阈值只拦 `< 0` → A5 NaN/Infinity 行。**最终树判定**：M2、M8a、M27、V4、V8、V10、V14、V16、V18、N1、N3 → A5；M9、M10、V9、V17 → A5「坏参数响亮失败」（M9、M10、V9 另有 A8） |
| 6 | 可用性来自逐跳标志而非工作区 capability key，且与节点状态双向正交 | A7（含反向用例）；M13 `available` 恒 true 或改 `!hop.unavailable` → A7；M29–M32 `available` 随集合陈旧、`hop.stale`、未确认、`ci_failed` 变化 → A7 反向用例。**最终树判定**：M13a、M13b → A7「可用性来自逐跳标志」；M29–M32、V1 → A7「状态不改变可用性」 |
| 7 | 纯函数、不读时钟、依赖方向不变 | A8、`pnpm run boundaries`；M17 从 `@harness-projects/client` 根出口值导入 → `ui-work-item-list-browser`（评审原型实测 `ℹ fail 1`）；M18 用 `new Date().toISOString()` 代替 now → A8。**最终树判定**：M18、M26、V7 → A8；M17、V19、V20 → A8 与 `ui-work-item-list-browser`「完整路径」；V21 ui-model 直接 `import type` controller → `package-boundaries`「依赖：源码中的跨包 import 必须落在允许的边上」；位置名必须是实体种类由 tsc 守（S11 的 G1） |
| 8 | 非 CI 位置的降级：命令位置只认 `hop.stale`（缺字段陈旧、不过集合年龄规则），提交与变更请求位置过年龄规则、未确认为 unknown | A9；M33 命令位置忽略 `hop.stale`、M34 未确认只对 CI 位置判 unknown、M35 命令位置过年龄规则、M36 提交位置不过年龄规则、M37 变更请求位置读错集合 → A9。**最终树判定**：M33–M37、V2、V3、V11 → A9；E-M5 → E1 |

最终树判定的复现（在检出 `feature/delivery-lineage-strip` 的工作树根目录）：`rsync -a --exclude .git ./ <scratch>/` 得到拷贝，对运行态目录里的 `final-contract.json`（M1–M37 共 34 条，命令只跑 `tests/contract/ui-delivery-lineage-strip.test.js`）、`final-verify.json`（V1–V18 与 N1–N7 共 25 条，同一命令）、`final-bundle.json`（M17、V19–V21，加跑 `ui-work-item-list-browser`、`client-browser`、`package-boundaries`、`ui-model-presentation`）、`final-e2e.json`（E-M1–E-M5、E-S6b、V11@e2e，只跑 `tests/e2e/delivery-lineage-strip.test.js`）逐个运行 `node scripts/review-mutate.mjs <spec> --root <scratch>`，期望四次退出码都是 0（全部 KILLED 且 `killedBy` 命中，锚点恰好一次）；`final-e2e-equivalents.json`（E-S6a、M6@e2e、M6b@e2e）期望退出码 1、三条都 SURVIVED（已知等价，合约侧由 M7、M6、M6b 杀死）。spec 是运行态内容，不入库；变异的锚点与替换写在 spec 里，上表只给编号与要点。

编号说明：M1–M18 见上表，M8a / M8b、M13a / M13b、M21、M25–M28 见 Progress 的 Batch 2，M29–M37 见 S9 与上表第 6、8 行，M6b 见 S10，E-M1–E-M5 见 Progress 的 Batch 3，E-S6a / E-S6b 见 S8。V 由独立验证者设计：V1 可用性随集合陈旧；V2 命令位置忽略 `hop.stale`；V3 未确认只对 CI 位置判 unknown；V4 夹零改绝对值；V5 没有 gaps 条目时给空节点 slot；V6 节点逆序；V7 原地排序入参；V8 ISO 校验放行纯日期；V9 阈值放行 Infinity；V10 阈值拒绝 0；V11 提交 / 变更请求位置不随集合陈旧；V12 缺口原因取第一条 gap；V13 `ci_passed` 先于未确认；V14 未确认只看 `undefined`；V15 缺口带额外字段；V16 标陈旧先于未确认；V17 先判集合缺失再校验参数；V18 年龄减反；V19 `import type` 改 `import { type }`；V20 值导入 client 根出口；V21 ui-model 直接 `import type` controller。N 由最终验收者自加：N1 年龄规则默认阈值改 10 分钟；N2 谱系条默认阈值改 10 分钟；N3 常量偏 1 ms；N4 `label` 取 `externalId`；N5 `externalId` 取关系端点 `to`；N6 failed 先于陈旧；N7 缺口原因按集合名查（命令位置失配）。

### 当前独立对抗验收（2026-10-21，Codex / GPT-6）

执行上下文：检出 `feature/delivery-lineage-strip`，基线 `b357837d`，下述结果包含 D17 修复与 A10、A11（代码已提交为 `bb01788`）。历史 70 条变异的运行态 spec 已不在工作树，未声称本轮重跑历史整表；本轮重建 R01–R21，全部在最终代码树上通过 `node scripts/review-mutate.mjs .superpowers/pr389-acceptance/mutations.json` 运行，退出码 0、21 条均 KILLED，`killedBy` 命中且还原后基线通过。

| 层 / 风险 | 当前判定与证据 |
|---|---|
| P0 / 架构与发布安全 | 未发现；浏览器实打包与 package-boundaries 通过；未写远端、未合并、没有规划状态动作 |
| P1 / 正确性 | 未发现；六位置与逐跳节点、缺口、陈旧 / 未确认的 CI 不显示 passed 均由具名断言保护 |
| P2 / 非法日期 | 已修复：不存在的 `2026-02-30T00:00:00Z` 曾在 03-02 00:01 被派生为 fresh / passed；A10 先红后绿，TD-085 移至 Resolved |
| P3 / 消费接线 | TD-083 的双可用性入口与 TD-084 的重派生调度仍由 #234 / #281 承接；client 重复时间校验仍归 TD-026，不改它的运行时行为 |
| 工作项闭环 | live #357 的四项验收分别由 A2 / A3 / A4 / A6 覆盖，scope 不含渲染；远端 #389 仍为旧规划 head 的 draft，其旧 checks 不能证明本地实现 | Superseded by D19（2026-10-22）：该行是历史观察，最终 PR 状态、head/checks/threads 按发布回读决定。

| 当前变异 | 错误行为 | 判别测试 |
|---|---|---|
| R01–R02 | 阈值等值判新鲜、未来时间不夹零 | A5 年龄规则 |
| R03–R05 | 缺 stale 字段 / 标陈旧 / 未确认放行为新鲜 | A5 未确认 |
| R06 | 从 attemptedAt 起算 | A4 |
| R07–R09 | 忽略 hop / 集合陈旧、未确认只作用于 CI | A3、A9 |
| R10 | 无结论 CI 判 observed | A1 |
| R11–R12 | 状态改变可用性、缺 unavailable 字段放行 | A7 两个方向 |
| R13–R16 | 丢失 gap 原因、截断并行跳、按 externalId 去重、从关系端点重识别标签 | A2、A11 |
| R17–R18 | 检查读错集合、error 投影跳过参数校验 | A3、A8 |
| R19–R21 | 放行日溢出、1900 当闰年、拒绝 2000 合法闰日 | A10 |

## Progress

- [x] 2026-10-21 15:05 +08 独立评审三份设计、核实事实、做原型并定稿本计划（协调者授权的独立评审者）。
- [x] 2026-10-21 15:54 +08 Batch 0 对齐与规划提交：协调者完成；实现者在检出 `feature/delivery-lineage-strip` 回读 `git rev-list --count HEAD..origin/main` 为 `0`、`apps/harness-plugin/dist` 不存在、`ls -l node_modules/@harness-projects/core` 指向 `../../packages/core`。
- [x] 2026-10-21 15:54 +08 Batch 1 类型出口与共享年龄规则（检出 `feature/delivery-lineage-strip`）。**红灯**：只有 A5 三个用例的 `tests/contract/ui-delivery-lineage-strip.test.js` 在实现前运行，`SyntaxError: The requested module '@harness-projects/ui-model' does not provide an export named 'DELIVERY_FRESHNESS_THRESHOLD_MS'`，`ℹ tests 1`、`ℹ fail 1`（文件加载失败，用例未执行）。**绿灯**：实现后同一命令 `ℹ tests 3`、`ℹ pass 3`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ tests 9`、`ℹ fail 0`；`node --test tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/client-browser.test.js` `ℹ tests 26`、`ℹ fail 0`；`node --test tests/contract/ui-*.test.js`（含 `derive.ts` 换 ISO 校验出处后的既有用例）`ℹ tests 74`、`ℹ fail 0`。
- [x] 2026-10-21 15:58 +08 Batch 2 谱系条派生（检出 `feature/delivery-lineage-strip`）。**红灯**：A1–A4、A6–A8 写完后 `node --test tests/contract/ui-delivery-lineage-strip.test.js` 先因 `does not provide an export named 'deriveDeliveryLineageStrip'` 加载失败（`ℹ fail 1`）；为看到逐用例的红，临时加一个返回 `{ slots: [] }` 的桩，读数 `ℹ tests 10`、`ℹ pass 3`、`ℹ fail 7`（只有 Batch 1 的 A5 三个用例绿，A1–A4、A6–A8 均因预期原因断言失败，桩随后删除）。**绿灯**：实现后同一命令 `ℹ tests 10`、`ℹ pass 10`、`ℹ fail 0`；加上 `tests/contract/ui-work-item-detail-browser.test.js`、`ui-model-presentation.test.js`、`ui-work-item-list-browser.test.js`、`client-browser.test.js` 共 `ℹ tests 39`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ tests 9`、`ℹ fail 0`。**变异**（`node scripts/review-mutate.mjs`，spec 在运行态目录，不入库）：Validation 表的 M1–M16、M18 加三条自加变异（M21 `ci_passed` 判定取反、M25 `hop.stale` 只认 `true`、M28 未确认先于陈旧）与 M26（谱系条不先校验参数）、M27（`isIsoTimestamp` 不查 `Date.parse`），共 24 条在合约测试上全部 KILLED 且 `killedBy` 归因命中；M13、M8 各拆成 a/b 两条；M17（从 `@harness-projects/client` 根出口取值导入）在 `tests/contract/ui-work-item-list-browser.test.js` 上 KILLED。最终树上的整表复核归 Batch 4。
- [x] 2026-10-21 16:02 +08 Batch 3 真实 core 互通（检出 `feature/delivery-lineage-strip`）。新增 `tests/e2e/delivery-lineage-strip.test.js`（E1、E2，`composeCore` + `createFakeProviders()`，时钟固定 `() => T0`）。**红灯**：实现在 Batch 2 已落地，e2e 只钉住真实形状，没有「未实现」的自然红；先在 Batch 1 版本的 `delivery-lineage.ts`（无 `deriveDeliveryLineageStrip`）上运行，`does not provide an export named 'deriveDeliveryLineageStrip'`、`ℹ fail 1`；判别力由变异补足：删掉 `stateOf` 的整个陈旧分支（E-M1）→ E1、E2 均红，阈值 `>` 改 `>=`（E-M2）→ E1 红，流水线与检查集合映射对调（E-M3）→ E2 红，缺口原因恒 `unknown`（E-M4）→ E1 红，命令位置过年龄规则（E-M5）→ E1 红，五条均 KILLED 且 `killedBy` 命中。**绿灯**：`node --test tests/e2e/delivery-lineage-strip.test.js tests/e2e/delivery-lineage.test.js` `ℹ tests 38`、`ℹ pass 38`、`ℹ fail 0`（`apps/harness-plugin/dist` 不存在）。
- [x] 2026-10-21 16:05 +08 Batch 1–3 全量门（检出 `feature/delivery-lineage-strip`，`apps/harness-plugin/dist` 不存在）：`pnpm verify` 退出码 0（`pnpm run test` `ℹ tests 1712`、`ℹ fail 0`，`pnpm run test:mvp0` `ℹ tests 7`、`ℹ fail 0`）；`node scripts/rule-checks.mjs size origin/main` 代码 380 / 1000、文档 186 / 1500；`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0；`git diff --check origin/main...HEAD` 无输出。
- [x] 2026-10-21 16:19 +08 处置独立验证者的 F1–F4（检出 `feature/delivery-lineage-strip`，修复前 head f50204a2，`apps/harness-plugin/dist` 不存在）。逐条复跑 condition 均属实：F1 的 V1、F2 的 V2、V3 在 `node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js` 上 GREEN exit=0（SURVIVED）；F3 的 M6、M6b 在只跑 e2e 时 GREEN（SURVIVED）；F4 的 grep 命中 Plan of Work 的判别力步骤且无 Superseded 标注（根因与证据见 S9、S10，处置见 D12）。**红灯**：F1、F2 是测试缺口、实现行为本就正确，新用例在现有实现上直接绿（`node --test tests/contract/ui-delivery-lineage-strip.test.js` `ℹ tests 12`、`ℹ pass 12`、`ℹ fail 0`），没有「未实现」的自然红；红由变异给出：M29–M37 九条逐条 RED（exit=1），锚点各恰好出现一次，`killedBy` 归因全部命中——M29–M32 失败的是「A7 状态不改变可用性」（M32 另有原 A7 同时变红），M33–M37 失败的是「A9 非 CI 位置的降级」。**处置**：F1 在 `tests/contract/ui-delivery-lineage-strip.test.js` 增 A7 反向用例（四种 CI 状态 × `unavailable` 取 false / true）；F2 增 A9；F3 删去 E2 标题与文件头里的「`attemptedAt` 领先不改变年龄」（M6、M6b 在合约上被 A4 杀死，e2e 上 GREEN 不再被当作证据）；F4 在 Plan of Work 判别力步骤追加 Superseded by S8，D11 追加 Superseded in part by S9；实现 `packages/ui-model/src/delivery-lineage.ts` 未改。**绿灯**：`node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js` `ℹ tests 14`、`ℹ fail 0`；加上 `tests/e2e/delivery-lineage.test.js`、`tests/contract/{ui-model-presentation,ui-work-item-list-browser,client-browser,ui-work-item-detail-browser}.test.js` 共 `ℹ tests 79`、`ℹ fail 0`；`pnpm run typecheck` 无输出；`pnpm run boundaries` `ℹ tests 9`、`ℹ fail 0`；`pnpm verify` 退出码 0（`pnpm run test` `ℹ tests 1714`、`ℹ fail 0`，`pnpm run test:mvp0` `ℹ tests 7`、`ℹ fail 0`）。
- [x] 2026-10-21 16:35 +08 Batch 4 最终验收与回填（最终验收者，Claude Opus 5.5；检出 `feature/delivery-lineage-strip`，验收前 head d05783e3，`apps/harness-plugin/dist` 不存在）。**既往发现按原 condition 复跑**（在 `rsync` 拷贝上）：F1 的 V1、F2 的 V2 与 V3 用验证者原样的锚点、原样的命令（合约加 e2e 两个文件）→ 三条 RED exit=1，失败项分别是「A7 状态不改变可用性」「A9 非 CI 位置的降级」（已修）；F3 的 M6@e2e、M6b@e2e 只跑 e2e 仍 GREEN，而 E2 标题与文件头已不再声称证明年龄来源（`grep -n attemptedAt tests/e2e/delivery-lineage-strip.test.js` 只剩文件头的「不在这里证明」与 E2 的「前置观察」），按原 condition 判已修；F4 的 `grep -n '只删其一不会红'` 命中的 Plan of Work 判别力步骤同一行带 `Superseded by S8`（已修）。**修复本身复评**：A7 反向用例与 A9 的每一行都有正对照，夹具与断言和实现一致；没有发现新缺陷。**重构**：位置表去掉与 `position` 逐字相同的 `entityKind` 列（D13、S11），提交 da9bbac7；重构后 `pnpm run typecheck` 退出码 0，`node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-model-presentation.test.js tests/contract/package-boundaries.test.js` `ℹ tests 47`、`ℹ fail 0`，`pnpm verify` 退出码 0（`pnpm run test` `ℹ tests 1714`、`ℹ fail 0`，`pnpm run test:mvp0` `ℹ tests 7`、`ℹ fail 0`）。**最终树整表变异**（与 da9bbac7 同内容的 `rsync` 拷贝，复现方式见 Validation and Acceptance 表下）：合约 34 条、验证者 V1–V18 加自加 N1–N7 共 25 条、打包与边界 4 条、e2e 7 条，共 70 条全部 KILLED 且 `killedBy` 命中，无 NOT_APPLIED；已知等价 3 条（E-S6a、M6@e2e、M6b@e2e）只在 e2e 上存活，合约侧的同一变异（M7、M6、M6b）被 A3、A4 杀死。**技术债**：tracker 表尾追加 TD-083、TD-084（D9、D10）与 TD-085（D14）。最终门禁的读数见下一条。
- [x] 2026-10-21 16:44 +08 最终门禁（观察时刻快照，head 是回填提交改写前的版本 39c021c9 与 d5cda96b，两者与最终 head 只差本文件的文字，代码与 da9bbac7 相同；检出 `feature/delivery-lineage-strip`，`apps/harness-plugin/dist` 不存在；重算用同样的命令）：`pnpm run typecheck` 退出码 0；`pnpm verify` 在 39c021c9 与 d5cda96b 上各跑一次，都是退出码 0（`pnpm run test` `ℹ tests 1714`、`ℹ fail 0`，`pnpm run test:mvp0` `ℹ tests 7`、`ℹ fail 0`）；`pnpm run boundaries` `ℹ tests 9`、`ℹ fail 0`；`node scripts/workflow-check.mjs` 输出 `no findings（已检查 8 个文件）`、退出码 0；`node scripts/rule-checks.mjs size origin/main` 代码 434 / 1000、文档 234 / 1500（回读同一命令，期望代码不超过 800、文档不超过 1300）；`node scripts/rule-checks.mjs disclosure origin/main` 退出码 0，人工五类目（凭据、本机路径与身份、账号与个人信息、内部系统、保密字样）对 `git diff origin/main...HEAD` 逐条过一遍无命中；`git diff --check origin/main...HEAD` 无输出；`git status --short` 为空；`git log --format=%B origin/main..HEAD | grep -c '^#'` 输出 `0`，提交正文没有关闭关键字加编号。**并集**（回读方式见 Interfaces and Dependencies 的「并集回读」）：与 `origin/main`（已含 #372）、与 `origin/feature/repository-binding`（#373）的 `git merge-tree` 冲突都只有 tracker 的 Open Items 表尾，按两边都保留解决后导出、离线安装：两棵树 `pnpm run typecheck` 都退出码 0；`node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js` 都是 `ℹ tests 14`、`ℹ fail 0`；`node --test tests/contract/ui-*.test.js tests/contract/client-*.test.js tests/contract/package-boundaries.test.js tests/e2e/delivery-lineage*.test.js` 在 main 并集上 `ℹ tests 137`、在 #373 并集上 `ℹ tests 132`，都 `ℹ fail 0`；main 并集上另跑三层全量 `ℹ tests 1725`、`ℹ fail 1`，`tests/mvp0` `ℹ tests 7`、`ℹ fail 0`。唯一失败是 `tests/contract/issue-policy.test.js` 的「CLI：脚本被改名成不带扩展名的副本后，无参调用仍然 exit 2 并打印用法」，原因是导出目录没有 `.git`（`fatal: not a git repository`）：同一文件在不含 `.git` 的 HEAD 拷贝上同样 `ℹ fail 1`，在本检出上 `ℹ tests 40`、`ℹ fail 0`，与本 PR 无关。main 再前进后（S14）对 `origin/main`@66870dfd 重做并集（冲突仍只有 tracker 表尾）：`pnpm run typecheck` 退出码 0，两个新测试文件 `ℹ tests 14`、`ℹ fail 0`，ui / client / 边界 / 交付一组 `ℹ tests 137`、`ℹ fail 0`，`tests/mvp0` `ℹ tests 7`、`ℹ fail 0`，三层全量 `ℹ tests 1739`、`ℹ fail 1`（同一条缺 `.git` 的 CLI 用例）。
- [x] Batch 4 整合提交（协调者，2026-10-21 17:05 +08，见 D15、D16 与 Plan of Work 的 Batch 4）；PR 置 ready 前回读 `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences`，期望含 #357

- [x] 2026-10-21 当前独立验收（Codex / GPT-6，检出 `feature/delivery-lineage-strip`@b357837d 加 D17 修复）：A10 红灯 `ℹ tests 1`、`ℹ fail 1`，实际 fresh / 预期 unconfirmed；修复后日期 / 既有展示 / 真实 core 一组 `ℹ tests 37`、`ℹ fail 0`。加入 A11 后 `pnpm verify` 退出码 0，三层 `ℹ tests 1777`、`ℹ fail 0`，MVP-0 `ℹ tests 7`、`ℹ fail 0`；R01–R21 变异全部 KILLED 且归因命中；最后重跑新合约 / 真实投影 / 三个 browser guard / presentation / package-boundaries 共 `ℹ tests 54`、`ℹ fail 0`，`node scripts/workflow-check.mjs` 输出 `no findings（已检查 8 个文件）`。代码树修改只有共享日期校验与两条验收用例，代码行为不涉及 client 旧副本。文档归档、债务现状与索引由 D18 记录。归档暂存树相对固定 base `d7e7bca6` 用 `scanDiff` 与 `tally`（`scripts/rule-checks.mjs` 同一实现）检查：无 disclosure findings，代码 475 / 1000、文档 274 / 1500；README 的 102 个本地相对链接均存在，计划无 Markdown 相对链接；`git diff --check --cached` 无输出。人工五类目检查本轮新增行无凭据、本机身份与路径、个人信息、内部系统或保密字样。最终提交后仍须由发布者对固定 base/head 重跑完整 rule-checks。

- [x] 2026-10-22 Batch 5 本地修复：null/确认态/翻转时刻先红后绿；公共列表日期用回退变异判别。19 项目标、100 项相关回归、typecheck 通过；D1–D8 8/8 KILLED 且恢复后基线通过。证据与 commentID 逐项映射见 `docs/review/pr-389-mmp-review.md`。独立复评、外部承接发布、最终 head checks 由协调者继续。

## Surprises & Discoveries

执行上下文：评审原型在 `feature/delivery-lineage-strip`@5a92c40a 工作树的拷贝上运行（不含 `.git`，不是仓库检出），只写了 Design 的代码，没写测试。

- S1：原型 `npx tsc --noEmit` 退出码 0；既有守卫（list/detail 浏览器包、client-browser、presentation、boundaries）`ℹ tests 38`、`ℹ fail 0`；实现约 79 行（`delivery-lineage.ts` 73，`timestamp.ts` 与 `client/src/delivery.ts` 各 3）。
- S2：真实 `composeCore` + 替身：刷新前四个集合位置是 `not_refreshed` 缺口；T0 + 1 分钟与 + 299 999 ms 流水线 `passed`、`unknown`，检查 `passed`、`unknown`、`unknown`；+ 300 000 ms 四个集合全部 `stale`；只让流水线读失败再刷新 → 流水线 stale、检查仍 passed，`attemptedAt` 比 `confirmedAt` 晚 1 ms。替身的检查读方法名是 `listChecks`。
- S3：设计 1 称去掉 `Math.max(0, …)` 是等价变异，不成立：只要阈值 0 合法，未来时刻的 `confirmedAt` 不夹零就判 fresh，M2 可杀。
- S4：设计 1、3 称 `lineageEntryPoints`「无消费者」只在 main 上成立；#373 把它作为 AC3 证据（`tests/e2e/repository-routing.test.js`），本 PR 不能删，也不能替人预设由谁删。
- S5：设计 3 的锚点比对冗余：按 `delivery-facts.ts:30-40`，新鲜的 CI 集合与其锚点集合在同一次刷新里完整，锚点必是当前锚点；陈旧集合本就不会 passed。
- S6：集合跳的 `hop.stale` 恒等于 `set.stale`（`delivery.ts:123-124`），从未确认的集合没有节点（`delivery-facts.ts:108`）；「两个陈旧标志不一致」与「未确认却有跳」只来自坏形状输入，由 A3 的 fixture 覆盖，E2 只能杀「两个判定都删」的变异。 Superseded in part by S8（2026-10-21）：只删集合陈旧判定会被 E1 杀死，只有只删 `hop.stale` 判定在 e2e 上是等价变异。
- S7：变异脚本用交互式 `cp` 恢复文件会卡在覆盖确认上；改用 `python3 -c "import shutil; …"` 或 `command cp -f`。
- S8：S6 在真实投影上的细化（`feature/delivery-lineage-strip`，e2e 变异）：只删 `stateOf` 里的 `hop.stale !== false` 判定（E-S6a）时 `tests/e2e/delivery-lineage-strip.test.js` 仍全绿（GREEN）——真实投影里 `hop.stale` 恒等于集合 `stale`，该判定在 e2e 上是等价变异，只由 A3「hop.stale: true 而集合新鲜」「hop 缺 stale 字段」两行与 M7 杀死；只删集合陈旧判定（E-S6b）则被 E1 杀死（过期路径靠年龄规则，`hop.stale` 为 false），E2 杀不死它（刷新失败路径靠 `hop.stale`），所以 S6 说的「只删其一不会红」对 E2 成立、对 E1 不成立。
- S9：独立验证 F1、F2（检出 `feature/delivery-lineage-strip`@f50204a2，`scripts/review-mutate.mjs`）：三条变异在原测试上 SURVIVED——`available` 加 `&& freshness !== DeliveryFreshnessState.Stale`（V1）；`stateOf` 首行加 `if (freshness === undefined) return LineageNodeState.Observed`，使命令位置忽略 `hop.stale`（V2）；`if (ci && freshness === DeliveryFreshnessState.Unconfirmed)`，使未确认只对 CI 位置判 unknown（V3）。原因：A7 只翻转 `unavailable` 且用新鲜集合；A3 的「hop 缺 stale 字段」等行都是 `pipeline_run` 的跳；没有用例拿陈旧 / 未确认的集合去读 `available`，也没有断言命令位置或提交、变更请求位置的降级。补 A7 反向用例与 A9 后，M29–M32（`available` 随集合陈旧、`hop.stale`、未确认、`ci_failed` 变化）、M33–M37（见 Validation 第 8 行）全部 KILLED，`killedBy` 归因命中，锚点各恰好出现一次（脚本对非恰好一次报 NOT_APPLIED，本次无）。实现代码没有改动：缺的是钉住它的判别用例。
- S10：独立验证 F3（同上检出）：E2 的标题与文件头曾写「`attemptedAt` 领先于 `confirmedAt` 不改变年龄」。M6（`{ confirmedAt: projection.attemptedAt, stale: false }`）与 M6b（取 `attemptedAt` 但保留集合 `stale`）在 `tests/e2e/delivery-lineage-strip.test.js` 上都是 GREEN：E2 里流水线节点本就因 `hop.stale` 为 true 而陈旧，年龄来源无关；真实写者不会产出「集合没标陈旧、`attemptedAt` 新而 `confirmedAt` 旧」的投影（见 Context and Orientation 的写者不变量），端到端无从区分。同样的变异在合约测试上被 A4 杀死（`killedBy` 命中），Validation 第 3 行也只列 A4。已删去过度声明，`attemptedAt` 领先改称前置观察。
- S11：位置表（`packages/ui-model/src/delivery-lineage.ts` 的 `POSITIONS`）六行的 `position` 与 `entityKind` 逐字相同，两列表达同一个事实（core 的跳与缺口按 `entityKind` 标位置，位置名正是这些实体种类）。去掉 `entityKind` 列后，`satisfies` 把 `position` 约束为 `LineagePosition & Hop['entityKind']`。判别实验（与检出 `feature/delivery-lineage-strip`@da9bbac7 同内容的 `rsync` 拷贝，`node_modules/.bin/tsc --noEmit`）：G1 把 `LineagePosition` 与位置表里的 `'worktree'` 同时改成不是实体种类的 `'branch_name'` → `error TS2322: Type '"branch_name"' is not assignable to type ...`，退出码 2；在 G1 之上再把约束改回只有 `LineagePosition`（去掉交集）→ 退出码 0。所以交集是承重的：它替代了旧 `entityKind` 列「必须是实体种类」的类型检查。
- S12：共享的 `isIsoTimestamp`（从 `derive.ts` 原样搬到 `packages/ui-model/src/timestamp.ts`）对日溢出宽容：Node v26.11.1 上 `node -e "console.log(new Date(Date.parse('2026-02-30T00:00:00Z')).toISOString())"` 输出 `2026-03-02T00:00:00.000Z`，`Date.parse('2026-04-31T00:00:00Z')` 也不是 NaN；`2026-13-45T00:00:00Z`、`2026-02-31T25:00:00Z` 是 NaN（被拒）。main 上 `derive.ts` 的 `ISO_8601` 加 `Date.parse` 已经如此，本 PR 没有引入，只是让年龄规则也继承了它。登记为 TD-085（D14）。Superseded by D17（2026-10-21）：年龄规则继承历史缺陷仍会违反本 PR 的非法日期契约，已在本 PR 修复。
- S13：V11（提交 / 变更请求位置不随集合陈旧）在 f50204a2 上只被 e2e 的 E1 杀死；加了 A9 之后，合约测试也杀死它（失败项「A9 非 CI 位置的降级」），e2e 上 V11@e2e 仍被 E1 杀死。e2e 上只存活三条已知等价变异（E-S6a、M6@e2e、M6b@e2e，见 S8、S10），它们在合约侧的同一变异都被杀死。
- S14：Batch 4 期间 main 两次前进（观察时刻快照：16:35 前后多了 #372 的计划、实现与归档 5 个提交，16:42 前后又多了工作区设置命令的 3 个提交；回读 `git log --oneline HEAD..origin/main`），`git rev-list --count HEAD..origin/main` 不再是 `0`。本分支没有追平（不改写既有提交），改为验证并集：在 da9bbac7 上 `git merge-tree --write-tree HEAD origin/main` 无冲突，且合并出的树与 HEAD 和 `origin/feature/plugin-work-item-pages` 的并集是同一棵树（#372 原样合入）；追加 TD-083–085 之后只在 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 表尾冲突——#372 在同一位置追加了 TD-072、TD-073，两边的行都保留即可。并集树上的类型检查与测试读数见 Progress 的最终门禁条目。追平 main 交给整合提交的协调者。

## Decision Log

以下 D1–D10 由协调者授权的独立评审者按调研决定，人类可推翻；日期 2026-10-21，作者：独立评审者（Claude）。

- D1 类型经 client 的纯类型子路径 `./delivery` 取得。Rationale：ui-model 不能依赖 controller 或 core，client 依赖 controller，类型别名不产生第二份形状定义（AGENTS.md §2）。否决：ui-model 复制结构类型（tests 不进 tsc，漂移只在运行时暴露）；改 `client/src/index.ts`（#372 的文件）；放进 `transport.ts`（语义不符）；扩 `domain/values`（其冻结测试 #372、#373 在改）。
- D2 六位置 slot 加单一状态枚举。Rationale：新鲜度与结论分成两个字段，渲染方就能画出「passed + 陈旧徽标」，等于把陈旧集合派生成 passed；按位置迭代从结构上保证一个缺口、不借邻居补关系。否决 `ageMs`、`cause`、`anchorId`、`errorCode`、`degraded` 等透出：4 条验收都不需要，#234 手里本来有原始投影。
- D3 阈值严格大于年龄才算新鲜，负年龄夹到 0，标陈旧优先于年龄。Rationale：RFC 9111 §4.2 `response_is_fresh = (freshness_lifetime > current_age)`，§4.2.3 `apparent_age = max(0, …)`（https://www.rfc-editor.org/rfc/rfc9111.html ）；TanStack Query 的 `timeUntilStale` 为 `Math.max(updatedAt + staleTime − now, 0)`，等值即陈旧（https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts ）。issue 原文是「older than」，等值取陈旧只差 1 ms 且失败关闭。
- D4 坏 `now` 抛 TypeError（宿主接线缺陷，与 `assertTimestamp` 同口径）；坏阈值抛 RangeError，0 合法（TanStack `isValidTimeout`：`value >= 0 && value !== Infinity`）；坏 `confirmedAt` 降级为 unconfirmed（RFC 9111 §5.3 无效日期按「已过期」处理、§4.2.1 无效新鲜度信息视为陈旧；ADR-0011 Consequences 规定坏形状按缺字段降级）。否决设计 1 的抛错（一个坏集合让整条谱系条崩掉）与设计 2 拒绝阈值 0（夹零无法验证）。
- D5 `unavailable` 只决定 `available`，不压状态；缺字段时 `available` 为 false。Rationale：可用性与结论正交；能力被摘后下一次刷新会把该集合标陈旧（`tests/e2e/delivery-lineage.test.js`「流水线读能力被摘掉」），在此之前年龄规则把窗口限制在阈值内。
- D6 超龄结论是「陈旧 / 未知」，不保留上次的「通过」；默认 5 分钟可配置。Rationale：Kubernetes 节点在 `node-monitor-grace-period`（默认 50s）内无心跳时 Ready 变 `Unknown`（https://kubernetes.io/docs/reference/node/node-status/ ）；Prometheus lookback 默认 5 分钟，可用 `--query.lookback-delta` 或逐查询覆盖（https://prometheus.io/docs/prometheus/latest/querying/basics/ ）。
- D7 不做锚点比对，也不按 `hop.to` 归组。Rationale：见 S5；TD-042 的「显示陈旧」由 stale 状态满足，按锚点归组仍归 TD-042 的承接方，本 PR 不改该行。
- D8 命令位置不过年龄规则。Rationale：它们是开始工作写下的命令事实，不在快照集合里，ADR-0011 也没给它们 `confirmedAt`。
- D9 预计登记 TD-083：谱系可用性两种口径并存（`WorkItemDetail.lineage` 按 key、#373 起按仓库；谱系条按逐跳 `available`）。延期理由：#373 正在使用并修改 `capability-access.ts`。影响：#234 若从 `detail.lineage` 取可用性，会与 core 实际经过的门分叉（变更请求跳 core 不设门，key 口径却要求 `development.change_request.read`）。下一步：#234 只用谱系条的 `available`，#373 合并后由 #234 决定 `detail.lineage` 保留或下线。 Superseded by D19 与 TD-083 当前事实（2026-10-22）：#373 已在旧 base d7e7bca6 合并；#297 已在本轮 main 中加入写者路由门，不能把投影 available 当成实时路由能力。
- D10 预计登记 TD-084：派生不给出下一次翻转时刻（无 `staleAt`）。延期理由：验收只要求纯函数，调度归宿主（ADR-0011 Consequences、TD-045）。影响：抽屉不重派生时 passed 会在超过阈值后仍挂着。下一步：#234 在打开、刷新与定时（间隔不大于阈值）时用新 now 重派生。TD-085 保留不用。Superseded in part by D14（2026-10-21）：TD-085 已用于 ISO 校验的日溢出。 Superseded by D19 与 TD-084 当前承接（2026-10-22）：当前输出 nextFlipAt，不再要求粗粒度轮询；渲染和生命周期调度仍由 #234/#281 实现。

以下由实现者在执行中追加，作者：实现者（Claude Sonnet 5.5），日期 2026-10-21。

- D11 命令位置的跳也按 `hop.stale !== false` 判陈旧（缺字段按陈旧，失败关闭），只是不过集合年龄规则。Rationale：Design 的状态判定首行对所有跳一视同仁；core 对 `tracks` / `has_worktree` 恒给 `stale: false`（`packages/core/src/delivery.ts`），对真实投影没有影响，坏形状输入则不会被画成 observed。由 A3「hop 缺 stale 字段」与「hop.stale: true 且集合未确认」两行钉住陈旧优先于未确认。Superseded in part by S9（2026-10-21）：这两行用的是 `pipeline_run` 的跳，并不钉住命令位置；命令位置的 `hop.stale` 判定与提交、变更请求位置的 unknown 降级此前没有任何测试，现由 A9 钉住（M33–M37）。

以下由修复者（Claude Sonnet 5.5）在处置独立验证者的 F1–F4 时追加，日期 2026-10-21。

- D12 F1、F2 只补测试、不改实现；F3 删去过度声明、不为 E2 伪造新形状；F4 就地标注；不登记技术债。Rationale：S9 的三条变异在实现上行为正确，缺的是判别用例，D5 已决定可用性与状态正交，所以按两个方向钉死——A7 原有用例钉「可用性变不改状态」，新增反向用例钉「状态变不改可用性」，A9 钉非 CI 位置的降级，并给 D11 补上它声称却没有的测试。F3：S10 证明真实写者造不出能区分年龄来源的投影，硬造只会换来一个测试合成输入的 e2e，与合约 A4 重复；验收 3 本来就只靠 A4。缺口已在本 PR 内补齐，不登记新的技术债（TD-083、TD-084 仍按 D9、D10 由 Batch 4 登记，TD-085 保留不用）。Superseded in part by D14（2026-10-21）：TD-085 已用于与 F1–F4 无关的 ISO 校验日溢出（S12）。

以下由最终验收者（Claude Opus 5.5）在 Batch 4 追加，日期 2026-10-21。

- D13 位置表去掉 `entityKind` 列，按位置名过滤跳与缺口，`satisfies` 把 `position` 约束为 `LineagePosition & Hop['entityKind']`。Rationale：两列逐字相同，是同一事实的两份副本，改一处忘一处会让某个位置静默失配；交集类型保留了旧列「必须是实体种类」的检查（S11 的 G1：去掉交集时同一改动 tsc 通过）。行为不变：重构后最终树整表变异全部 KILLED，`pnpm verify` 退出码 0。否决：把 `set` 列也并进位置名（只留「是否快照集合」布尔）——那会让命令位置与集合位置的区分只剩一个布尔，M16 一类映射错误虽然从结构上消失，但 Design 写明的「位置 → 集合」显式映射也随之消失，收益小于可读性损失。
- D14 登记 TD-083（D9 的措辞，补上 core 不给变更请求跳设门的出处）、TD-084（D10 的措辞）与 TD-085（S12：`isIsoTimestamp` 接受日溢出）。Rationale：TD-085 是 main 上既有的缺陷，本 PR 让年龄规则也继承了它；Global Constraints 规定 `derive.ts` 行为不变，只收紧 ui-model 一处又会和 client 的逐字相同正则分叉（TD-026），所以延期到处理 TD-026 时两处一起收紧。三行都写本计划的 `active/` 路径；归档到 `completed/` 时由归档者同步改这三行的 ExecPlan 列。Superseded in part by D17（2026-10-21）：TD-085 已在当前闭环内解决，不再延期。
- D15 整合后的三个提交正文末行都写 `Refs #357`，不写关闭关键字；关闭由 PR 正文的 `Closes #357` 承担（issue #357 的 `closed_by_pull_requests` 已列出该 PR）。Rationale：协调者为本轮提交定的规则是正文任何位置不写关闭关键字加编号；提交正文里的关闭关键字随 rebase merge 进 main 时会再关一次 issue，来源有两处就难以回溯是谁关的。这条只改 Batch 4 第 3 步的正文措辞（已就地标注），提交序列不变。

- D16 协调者整合（2026-10-21 17:05 +08，协调者 / Claude Opus 5.5）：不逐提交变基，按路径在 `origin/main`（`d7e7bca6`，已含 #371、#372、#373）上重建三个提交——规划（`3a018f1a` 的计划原文）、`feat(ui-model)` 交付物（Global Constraints 的全部代码与测试路径，取整合前 head）、回填（本计划终稿与 tracker 的 TD-083 至 TD-085，tracker 以 `main` 为底、三行接在 TD-078 之后）。核对：代码与测试路径与整合前 head 逐字节相同（`git diff refs/backup/delivery-lineage-strip-20261021 HEAD -- <路径>` 为空），回读 `git log --oneline origin/main..HEAD` 期望恰三行。Plan of Work 的步骤复选框（19 个）按 Progress 的实际完成情况一并勾上，此前只在 Progress 勾选。`Co-Authored-By` 统一写 Claude Opus 5.5，按协调会话的归属规则；实现与修复实际由 Sonnet 5.5 完成，记录在 Outcomes。Rationale：tracker 是唯一与 `main` 冲突的文件，按路径重建比逐提交解冲突少出错；#373 已合并，TD-083 的「#373 合并后」前提成立，由 #234 决定可用性规则。

- D17 独立验收者（Codex / GPT-6，2026-10-21）修复日溢出。调研：TC39 Date Time String Format 明确越界元素不构成合法格式，并允许 `24:00`（https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-time-string-format ）；MDN Date.parse 记录 `2014-02-30` 在不同引擎归一或拒绝的差异（https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse#non-standard_date_strings ）。Rationale：仅靠 `Date.parse` 可把不存在的确认日期当成 fresh、进而 passed；这属于新年龄 API 的错误接受，不能因代码源于 main 而延期。共享校验先验实际 Gregorian 月日与闰年，再保留原解析检查；不用 UTC 字段直接比原文本，避免误拒 offset 跨日或合法 `24:00`。否决引入日期库（当前边界只需月日校验）；否决只修年龄函数（会让本包两个校验口径分叉）；不扩到 client 旧副本或跨包出口（TD-026 单独承接）。A10 先红：预期 unconfirmed、实际 fresh；修复后绿，R19–R21 证明月日和闰年正负对照可判别。
- D18 独立验收者（Codex / GPT-6，2026-10-21）归档本计划并更新索引与债务：TD-083、TD-084 路径改为 completed，TD-085 移至 Resolved，TD-026 追加当前校验已分叉的事实。D16 的三提交整合记载是旧协调过程，当前接手时实际只有规划与实现两提交，计划存在 staged + unstaged 修改；完整保留其内容，最终提交边界、远端同步和 ready 回读由当前协调者完成，不把 D16 的旧 head / 提交数当成当前状态。

- D19 评审修复 owner（2026-10-22）：依据人类当前点名“继续走修复流程 PR #388–#391”的授权，修复 #389 全部七条 P2/P3；授权只用于源码、测试与证据收敛，不代写 Project Status 或 blocked-by。关系态采用 Core `DeliveryLineageHop['relationState']` 原样透传，与节点 state/available 正交；不重识别关系。比较“只写承接义务”“输出统一翻转时刻”“在纯函数内建 timer”后选择第二项：输出 `nextFlipAt`（Unix 毫秒，所有 fresh 集合中最早的 `confirmedAt + thresholdMs`，无则 undefined），消费方只调度与重派生，不复制年龄规则。公共日期判别测试、真实候选 E2E、null 降级先验证红绿，回退变异固定 killedBy。外部 #234/#281/#150 承接说明由协调者发布并回读（comments 6333217297 / 6333218148 / 6333219027）；最终提交、远端回读与独立复评也由协调者统筹。

## Idempotence and Recovery

- 所有测试都是纯函数或内存替身，可重复执行；变异只在 `rsync` 出来的拷贝里做，不碰工作树与 `.git`（拷贝里 node_modules 的工作区链接是相对路径，可直接运行）。
- 已知良好状态：Batch 1 之后年龄规则独立可用；Batch 4 整合前的 `refs/backup/delivery-lineage-strip`。
- 分支已推送后需要改写历史时，先建 backup ref，再用精确的 `--force-with-lease=<branch>:<sha>` 推送（AGENTS.md §6）。

## Interfaces and Dependencies

- 接口见 Design / Spec；坏 `now` 抛 TypeError、坏阈值抛 RangeError，都在任何派生之前抛出。
- 消费方义务（#234、#281）：打开、投影/阈值变化、刷新后及 `nextFlipAt` 到达时，用当前 now 重派生并重排 timer；页面恢复时先重派生再显示 passed，切换目标/卸载取消旧 timer。`available` 只描述逐跳读门，不能推断变更请求写者路由可用；`state: stale` 的最后读数必须保持 stale 提示（TD-083）。`relationState: candidate` 不能画成 confirmed。worktree 的 externalId 仍可能是本机路径，展示由页面决定。
- 依赖：controller 的 `ControllerQueries['getDeliveryProjection']` 返回类型；`apps/harness-plugin` 的 esbuild（只用于浏览器包测试）；Node v26。
- PR 元数据：标签 `kind:feat`、`area:ui-model`、`area:client`；milestone M4；`Closes #357`；回读 `gh pr view <n> -R SingularityKChen/harness-projects --json labels,milestone,closingIssuesReferences`。
- 并集回读（在检出 `feature/delivery-lineage-strip` 的工作树根目录，先 `git fetch origin`）：#372 已合入 main。`git merge-tree --write-tree --name-only HEAD origin/main` 与 `git merge-tree --write-tree --name-only HEAD origin/feature/repository-binding`（#373）期望冲突列表至多只有 `docs/exec-plan/tech-debt-tracker.md`（Open Items 表尾追加行相撞），本 PR 的其他文件不出现。合并出的树用 `git archive <tree> | tar -x -C <scratch>` 导出、`pnpm install --frozen-lockfile --offline` 后跑 `pnpm run typecheck` 与 `node --test tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/delivery-lineage-strip.test.js`，期望退出码 0、`ℹ fail 0`；有冲突的树先按「两边追加行都保留」解决 tracker 再跑同样的命令。 Superseded by Batch 5（2026-10-22）：本轮已基于 main@0d8d6094；不再预设在途 #373 并集或旧冲突列表，发布时重新取当前 base/head 做必要整合验证。

## Outcomes & Retrospective

**实际结果**（2026-10-21，检出 `feature/delivery-lineage-strip`@da9bbac7，回读 `git diff --numstat origin/main...HEAD`）：issue #357 的 4 条验收与本计划 Validation 表 8 行都有具名测试与最终树变异证据（见该表的「最终树判定」）。`@harness-projects/ui-model` 导出 `deriveDeliveryLineageStrip`、`deliverySetFreshness`、`DELIVERY_FRESHNESS_THRESHOLD_MS`、`DeliveryFreshnessState`、`LineageNodeState` 与谱系条类型；投影类型经 `@harness-projects/client/delivery` 纯类型子路径取得。行数（增 / 删）：实现 `packages/ui-model/src/delivery-lineage.ts` 100 / 0、`timestamp.ts` 5 / 0、`derive.ts` 2 / 4、`index.ts` 2 / 1、`packages/client/src/delivery.ts` 4 / 0、`packages/client/package.json` 2 / 1，合计 115 / 6；测试 `tests/contract/ui-delivery-lineage-strip.test.js` 244、`tests/e2e/delivery-lineage-strip.test.js` 69，合计 313；`node scripts/rule-checks.mjs size origin/main` 的代码口径 434 / 1000（计划上限 800，预计约 360）。文档是本文件与 tracker 的三行，规模以同一命令的文档口径回读（期望不超过 1300）。

**与计划的偏差**：
- 命令位置的跳也按 `hop.stale` 判陈旧（D11），原计划只写了「命令位置不过年龄规则」。
- 独立验证者的 F1–F4：A7 增反向用例、新增 A9（M29–M37），E2 删去年龄来源的过度声明，Plan of Work 与 D11 就地标注（D12、S9、S10）。代码口径比预计（约 360）多约 70 行，主要是 A7 反向与 A9 两张表。
- 最终验收的重构只有一处：位置表去掉重复的 `entityKind` 列（D13），实现多 2 行（注释写明交集约束），位置表少一列重复。
- 技术债多登记一条 TD-085（D14），原计划 TD-085 保留不用。
- 整合提交不写关闭关键字（D15）。
- S6 的「只删其一不会红」对 E1 不成立（S8），已就地标注。

**遗留问题**：
- TD-083（谱系可用性两种口径，等 #373 合并后由 #234 定）、TD-084（无 `staleAt`，消费方重派生）、TD-085（ISO 日溢出，随 TD-026 处理）。 Superseded by D17、D19 与 TD-083/084 当前行（2026-10-22）：TD-085 在本 PR 已解决，client 副本留给 TD-026；#373 已合并（d7e7bca6）；当前增加 nextFlipAt，剩余是消费方 timer/重派生闭环。
- e2e 上三条已知等价变异（E-S6a、M6@e2e、M6b@e2e）由合约测试承担判别力：真实写者产不出能区分它们的投影（S8、S10）。
- 合约测试里「hop 缺 stale 字段」各行用 `{ stale: undefined }` 表达缺字段，与夹具 `hop` 的注释（缺字段用 `undefined` 之外的手段删掉）措辞不一致；实现的判定是 `hop.stale !== false`，两种写法结论相同，没有改。
- 与 main 及在途 PR 的并集（回读方式见 Interfaces and Dependencies 下的「并集回读」，读数见 Progress 的最终门禁条目）：本分支落后 main（#372 已合入，S14）；与 main、与 #373 的并集都只在 tracker 的 Open Items 表尾冲突（#372 的 TD-072、TD-073，#373 的 TD-070、TD-071、TD-074–TD-078 与本 PR 的 TD-083–TD-085 都追加在那里），两边的行都保留。#373 与 main 自身另有 `docs/product/vertical-path.md`、`packages/ui-model/src/work-item-list-view.ts` 的冲突，不在本 PR 的文件里，由 #373 追平 main 时解决。 Superseded by D16、D19（2026-10-22）：旧归档 base d7e7bca6 已含 #372/#373；本轮 base 为 0d8d6094，这段仅保留历史协调过程，不能作为当前落后/冲突结论。
- 提交尾注不一致：规划提交与实现者的三个提交尾注写 Opus 5.5（实现者自述实际运行的是 Sonnet 5.5），修复者的两个写 Sonnet 5.5，最终验收者的两个写 Opus 5.5；整合成三个提交时由协调者决定尾注。已决定：三个提交统一写 Claude Opus 5.5（D16），实际分工以本节与 Progress 的作者记录为准。
- 归档时同步 tracker 三行的 ExecPlan 路径（D14）。已由 D18 完成，TD-085 同时移至 Resolved。

完成补记（D17、D18）：当前独立验收修复非法月日的 fresh / passed 误判并补并行谱系逐跳保留用例；没有渲染与宿主定时，消费风险仍见 TD-083、TD-084。client 与 ui-model 校验重复的分叉如实追加到 TD-026。最终发布前的 base/head/checks/threads 由协调者回读。

**2026-10-22 修复结果（D19）**：原始七条 P2/P3 的源码和文档修复已完成；relationState 是已有 Core 事实的透传，nextFlipAt 与现行年龄规则同源，null 降级明确。真实 Core E1 钉住 explicit/confirmed 命令跳与 deterministic/candidate 读取跳。承接义务的英文评论已由协调者发布并回读：#234/#281/#150，comments 6333217297 / 6333218148 / 6333219027；这些仅为消费方验收承接；本地测试不代替消费者定时渲染、人类产品走查或最终远端门禁。

## Bottom Change Note

- 2026-10-21 15:05 +08 创建：独立评审设计 1–3 后定稿；取舍见 Design / Spec 与 D1–D10，原型证据见 S1、S2。
- 2026-10-21 16:05 +08 实施 Batch 1–3：计划本身未变，新增 D11（命令位置的跳也判陈旧）与 S8（S6 的细化，并就地标注 S6）。
- 2026-10-21 16:17 +08 处置独立验证者的 F1–F4：A7 增反向用例、新增 A9、Validation 第 6 行补充并新增第 8 行（M29–M37）；E2 删去年龄来源的过度声明；Plan of Work 的判别力步骤就地标注 Superseded by S8，D11 就地标注 Superseded in part by S9；新增 S9、S10、D12。
- 2026-10-21 16:38 +08 Batch 4 最终验收与回填（最终验收者）：Validation 表每行补「最终树判定」与变异编号说明；Progress 增最终验收与最终门禁条目，Batch 4 拆出待协调者的整合项；新增 S11–S14、D13–D15；Plan of Work 的 Batch 4 第 2、3 步与 D10、D12 就地标注 Superseded；Context and Orientation 的「期望 `0`」就地标注 Superseded by S14；Interfaces and Dependencies 增并集回读；Outcomes & Retrospective 填写实际结果、偏差与遗留问题；tracker 表尾追加 TD-083、TD-084、TD-085。
- 2026-10-21 17:05 +08 协调者整合提交并变基到含 #371、#372、#373 的 `main`（D16），勾上 Plan of Work 已完成步骤，决定提交尾注。

- 2026-10-21 当前独立验收（Codex / GPT-6）：D17 修复日溢出并补 A10、A11 与 R01–R21 判别证据；D18 归档计划、订正既有结论并同步 docs 索引与债务，保留旧协调阶段的全部现场记录。

- 2026-10-22 评审修复：新增 D19 与 Batch 5；按人类继续修复授权处理七条意见，保留历史初审与现行主线边界。

2026-10-22独立修复复评APPROVE：19项目标、八项临时副本变异和三项独立反例均通过，产品哈希保持，外部承接回读成立。最终新head仍需重锁CI/threads、issue关联与发布门，旧批准不转移。

2026-10-22修复并集证据：在独立检出`test/repair-queue-pr388@7e5ab3d6a8093a3521a8d759c5b8a7a9507c2b52`先执行真实pack:plugin，随后CI=true pnpm verify为1886+7、fail0。四PR产品输入及清单指纹见各自评审记录；该记录不继承到之后变基的新head，最终发布仍回读CI、threads与原生issue关联。
