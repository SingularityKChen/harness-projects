# 交付谱系条与共享新鲜度年龄规则 ExecPlan

> 状态：Active
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
- 分支从 main@5a92c40a 切出，之后 #370 已合入 main；回读 `git rev-list --count HEAD..origin/main`，Batch 0 后期望 `0`。

## Design / Spec

接口（`packages/ui-model/src/delivery-lineage.ts`，经 `packages/ui-model/src/index.ts` 导出）：

```ts
export const DELIVERY_FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000
export const DeliveryFreshnessState = { Fresh: 'fresh', Stale: 'stale', Unconfirmed: 'unconfirmed' } as const
export const LineageNodeState = { Observed: 'observed', Passed: 'passed', Failed: 'failed', Unknown: 'unknown', Stale: 'stale' } as const
export type LineagePosition = 'execution_context' | 'worktree' | 'commit' | 'change_request' | 'pipeline_run' | 'check_run'
export interface LineageNode { readonly externalId: string | undefined; readonly label: string | undefined; readonly state: LineageNodeState; readonly available: boolean }
export type LineageSlot =
  | { readonly position: LineagePosition; readonly kind: 'gap'; readonly reason: DeliveryProjection['gaps'][number]['reason'] | 'unknown' }
  | { readonly position: LineagePosition; readonly kind: 'nodes'; readonly nodes: readonly LineageNode[] }
export interface DeliveryLineageStrip { readonly slots: readonly LineageSlot[] }
export function deliverySetFreshness(set: Pick<DeliveryProjection['freshness'][number], 'confirmedAt' | 'stale'> | undefined, now: string, thresholdMs?: number): DeliveryFreshnessState
export function deriveDeliveryLineageStrip(projection: DeliveryProjection, now: string, options?: { readonly thresholdMs?: number }): DeliveryLineageStrip
```

**类型来源**：新文件 `packages/client/src/delivery.ts` 只有 `export type DeliveryProjection = Awaited<ReturnType<ControllerQueries['getDeliveryProjection']>>`（`import type` 自 controller），`packages/client/package.json` 的 exports 加 `"./delivery"`；ui-model 只 `import type` 它。core 改字段名时 tsc 报错。

**年龄规则 `deliverySetFreshness`**（按序，先命中者生效）：
1. `now` 不是 ISO 8601 → `TypeError`；`thresholdMs` 不是有限非负 number → `RangeError`（0 合法，恒陈旧）。
2. 集合缺失，或 `confirmedAt` 缺失 / 不是 ISO 8601 → `unconfirmed`，不抛错。
3. `set.stale !== false`（含缺字段）→ `stale`。
4. `thresholdMs > max(0, now − confirmedAt)` → `fresh`，否则 `stale`（等于阈值即陈旧）。

入参类型只有 `confirmedAt` 与 `stale`，结构上拿不到 `attemptedAt`。ISO 校验搬到 `packages/ui-model/src/timestamp.ts` 的 `isIsoTimestamp`（不从 index 导出），`derive.ts` 的 `assertTimestamp` 改用它，行为不变。

**谱系条 `deriveDeliveryLineageStrip`**：先做第 1 步校验（`error` 投影也校验）；按六个固定位置迭代，不按 hops 迭代。没有跳的位置输出 `{position, kind: 'gap', reason}`，reason 取 `gaps` 里该位置的原因，没有则 `'unknown'`；有跳的位置输出 `{position, kind: 'nodes', nodes}`，每跳一个节点，保持 core 顺序。节点状态：`hop.stale !== false` 或集合判 `stale` → `stale`；集合判 `unconfirmed` → `unknown`；命令位置与提交、变更请求 → `observed`；CI 位置 `ci_passed` → `passed`、`ci_failed` → `failed`、其余 → `unknown`。命令位置不过年龄规则。`available = hop.unavailable === false`，不影响状态。不读 `attemptedAt`、`degraded`、`error`、`optional`、`from`、`to`、`relation*`、`provenance`；运行时值只用字面量加 `satisfies`。

**不变量**：I1 `passed` ⇒ 集合新鲜、跳不陈旧且 `fact === 'ci_passed'`；I2 每个位置恰好一个 slot，缺口与节点二选一，节点数等于该位置 hops 数；I3 纯函数，不读时钟、不改入参、无模块级可变状态；I4 签名没有 capability 输入，输出没有动作或规划字段。

**嫁接与否决**（依据见 Decision Log）：采纳设计 1 的单一状态枚举、`client/delivery` 子路径与 `timestamp.ts`，设计 2 的坏 `confirmedAt` 降级为 unconfirmed，设计 3 的位置级 slot、`'unknown'` 回退与阈值 0 合法，设计 2/3 的真实 core 互通测试（合并为一个 e2e 文件）。否决：新鲜度与结论拆两字段及 `ageMs`/`cause`/`anchorId`/`errorCode`/`degraded`/`confirmedAt` 透出（设计 2、3），锚点比对（设计 3），未知 `entityKind` 抛错（设计 2），坏 `confirmedAt` 抛错（设计 1），阈值 0 被拒（设计 2），本 PR 预设「#234 删除 `lineageEntryPoints`」（设计 1、3）。

## Global Constraints

- **本 PR 文件集合（唯一声明处）**：新增 `packages/client/src/delivery.ts`、`packages/ui-model/src/delivery-lineage.ts`、`packages/ui-model/src/timestamp.ts`、`tests/contract/ui-delivery-lineage-strip.test.js`、`tests/e2e/delivery-lineage-strip.test.js`、本文件；修改 `packages/client/package.json`（exports 加 `./delivery`）、`packages/ui-model/src/derive.ts`（只换 ISO 校验出处）、`packages/ui-model/src/index.ts`（一行 export，职责说明补一句）、`docs/exec-plan/tech-debt-tracker.md`（只在表尾追加 TD-083、TD-084）。
- **不改**：`docs/README.md`；tracker 的任何既有行（尤其 TD-042、TD-043、TD-054）；`packages/core/**`、`packages/controller/**`；`packages/client/src/index.ts`（#372）、`packages/client/src/{store,sync,workspace-read}.ts`（#373）；`packages/ui-model/src/{capability-access,types,work-item-detail-view,work-item-list-view}.ts`；`packages/ui/**`、`apps/**`；`tests/contract/{ui-model-presentation,ui-work-item-list-view,ui-work-item-detail-browser}.test.js`；`docs/product/vertical-path.md`；ADR-0011；#371、#372、#373 文件清单里的其余文件。
- ui-model 只依赖 client 与 domain 且只用 `import type`；不新增依赖边，不扩 `@harness-projects/domain/values`；不出现 `Date.now` 或 `new Date(`；源码与注释不含平台名、界面框架名片段；首发前不写兼容层。
- Node v26 类型剥离，包内相对导入带 `.ts` 后缀；pnpm 用仓库 `packageManager` pin 的版本；提交身份经 `git -c user.name=… -c user.email=…` 单次传入，不写 git config。
- 规模：代码加测试 ≤ 800 行（预计约 360）；文档 ≤ 1300 行（预计约 300，含回填）。
- 人类专属：看板 Status、blocked-by / blocking 关系、ADR 状态变更；agent 不写，只记为待人类决定。

## Plan of Work

全部命令在检出 `feature/delivery-lineage-strip` 的工作树根目录（`.worktrees/delivery-lineage-strip`）运行。测试夹具：`T0 = '2026-10-21T07:00:00.000Z'`；`hop(kind, extra)` 生成字段齐全的跳（默认 `unavailable: false`、`stale: false`）；`set(kind, confirmedAt, stale = false)` 生成集合。

### Batch 0 · 对齐与规划提交
**最小闭环**：分支追平 main，本计划成为第一个提交。**涉及文件**：本文件。
- [ ] `git fetch origin && git rebase origin/main`；`git rev-list --count HEAD..origin/main` 期望 `0`。
- [ ] 提交 `docs(exec-plan): 规划交付谱系条与共享年龄规则`，正文末行 `Refs #357`。

**验证**：`git diff --check origin/main...HEAD` 无输出。**回滚**：另存本文件后 `git reset --hard origin/main`。

### Batch 1 · 类型出口与共享年龄规则
**最小闭环**：#281 可单独复用的 `deliverySetFreshness` 与常量。**涉及文件**：`packages/client/src/delivery.ts`、`packages/client/package.json`、`packages/ui-model/src/{timestamp,derive,delivery-lineage,index}.ts`。
- [ ] 先红：在 `tests/contract/ui-delivery-lineage-strip.test.js` 写 A5「年龄规则」：299 999 ms → fresh、300 000 ms → stale；6 分钟前确认在默认阈值下 stale、`thresholdMs: 600000` 下 fresh、阈值 0 下 stale；`confirmedAt` 比 now 晚 1 小时在默认阈值下 fresh、阈值 0 下 stale（夹零）；集合缺失或 `confirmedAt` 为 undefined、`'2026-10-21'`、`'garbage'` → unconfirmed 且不抛；`stale: true` 与缺 `stale` 字段 → stale；`now` 为 undefined、`''`、`'2026'`、`'2026-10-21'`、`'2026-13-45T00:00:00Z'` → TypeError；阈值 NaN、-1、Infinity、`'300000'` → RangeError；常量等于 300000。运行 `node --test tests/contract/ui-delivery-lineage-strip.test.js`，期望非零退出并报 `does not provide an export named`。
- [ ] 按 Design 实现类型别名、`isIsoTimestamp`、`deliverySetFreshness` 与常量，改 `derive.ts`、`index.ts`。

**验证**：A5 `ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`；`node --test tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/client-browser.test.js` `ℹ fail 0`。**回滚**：`git revert` 本批提交。

### Batch 2 · 谱系条派生
**最小闭环**：#234 可直接渲染的 `deriveDeliveryLineageStrip`。**涉及文件**：`packages/ui-model/src/delivery-lineage.ts`、`tests/contract/ui-delivery-lineage-strip.test.js`。
- [ ] 先红 A1 正对照：完整链、两条流水线（`ci_passed`、undefined）、检查 `ci_failed`、now = T0 + 1 分钟 → 六个 slot 顺序固定，状态依次 observed×4、passed、unknown、failed，节点总数等于 `hops.length`。
- [ ] 先红 A2 缺口：去掉提交跳、`gaps` 给提交 `not_observed`、流水线跳的 `to` 指向某提交实体 → 提交 slot 恰为 `{position:'commit', kind:'gap', reason:'not_observed'}`，无节点带该锚点，节点总数等于 `hops.length`；`error` 投影 → 六个 `'unknown'` 缺口。
- [ ] 先红 A3 永不 passed 表（集合 stale 各行的 `hop.stale` 保持 false；全表断言只有正对照为 passed）：缺 freshness 条目 → unknown；`confirmedAt` undefined → unknown；集合 `stale: true` → stale；集合缺 `stale` 字段 → stale；年龄等于阈值 → stale；阈值减 1 ms → passed（正对照）；`hop.stale: true` 而集合新鲜 → stale；新鲜 `ci_failed` → failed；陈旧 `ci_failed` → stale；流水线集合新鲜而检查集合陈旧 → 流水线 passed、检查 stale（防映射错位）。
- [ ] 先红 A4 只认 confirmedAt：`attemptedAt = now`、`confirmedAt` 为 10 分钟前 → stale；`attemptedAt` 为 `'garbage'` 或比 now 晚 1 天而 `confirmedAt` 新鲜 → passed。
- [ ] 先红 A6 无规划控件：`Object.keys(...).sort()` 逐层精确等于 strip `['slots']`、缺口 `['kind','position','reason']`、节点 slot `['kind','nodes','position']`、节点 `['available','externalId','label','state']`；深度遍历无函数值。
- [ ] 先红 A7 逐跳可用性：只翻转一条流水线跳的 `unavailable` → 只有对应节点 `available` 变 false 且状态不变；缺 `unavailable` 字段 → `available` 为 false；`delivery-lineage.ts` 的 import 说明符不含 `capability-access` 或 `client/keys`。
- [ ] 先红 A8 纯度：深冻结入参调用两次结果 deepEqual；`packages/ui-model/src/{delivery-lineage,timestamp}.ts` 不含 `Date.now`、`new Date(`；坏 now 配 `error` 投影也抛 TypeError。
- [ ] 实现 `deriveDeliveryLineageStrip` 与 `stateOf`。

**验证**：Batch 1 全部命令，加 `node --test tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-work-item-detail-browser.test.js`，期望 `ℹ fail 0`。**回滚**：`git revert` 本批提交，Batch 1 的年龄规则仍可用。

### Batch 3 · 真实 core 互通
**最小闭环**：手写 fixture 与真实投影的形状由同一组断言钉住。**涉及文件**：`tests/e2e/delivery-lineage-strip.test.js`（搭法照 `tests/e2e/delivery-lineage.test.js` 的 `startChain`：`composeCore` + `createFakeProviders()`，时钟固定 `() => T0`，仓库 `repo-alpha`）。
- [ ] E1：刷新前四个集合位置是 `not_refreshed` 缺口、两个命令位置 observed；刷新后 T0 + 1 分钟流水线有 passed 与 unknown、检查有 passed；T0 + 299 999 ms 仍有 passed；T0 + 300 000 ms 无任何 passed，四个集合 slot 全部 stale。
- [ ] E2：把 `providers.delivery.listPipelineRuns` 换成返回结构化失败后再刷新；T0 + 1 分钟流水线节点全 stale，检查仍有 passed，`attemptedAt` 晚于流水线集合的 `confirmedAt`。
- [ ] 判别力：临时删掉 `stateOf` 的整个陈旧分支，确认 E2 变红后恢复（真实投影里 `hop.stale` 恒等于集合 `stale`，只删其一不会红，见 S6）。

**验证**：`node --test tests/e2e/delivery-lineage-strip.test.js tests/e2e/delivery-lineage.test.js` `ℹ fail 0`；若残留 `apps/harness-plugin/dist`，后者会变红（#350），先删除。**回滚**：删除该测试文件。

### Batch 4 · 对抗验收、回填与整合
**最小闭环**：最终树上的完整变异表、回填证据、整合提交。**涉及文件**：本文件、`docs/exec-plan/tech-debt-tracker.md`。
- [ ] Opus 独立验收：在 `rsync -a --exclude .git ./ <scratch>/` 得到的拷贝里重跑 Validation 表全部变异，每条先用 `grep -c` 证明已生效，再记录杀死它的测试。
- [ ] tracker 表尾追加 TD-083、TD-084（措辞见 D9、D10）；回填 Progress、Surprises、Outcomes。
- [ ] `git update-ref refs/backup/delivery-lineage-strip HEAD` 后整合为三个提交：规划提交（`Refs #357`）；`feat(ui-model): 派生交付谱系条与按 confirmedAt 的共享年龄规则`（实现与两份测试，正文末行 `Closes #357`）；`docs(exec-plan): 回填验证读数、变异表与技术债`（`Refs #357`）。用 `comm` 比对整合前后 head 的文件集合，期望相同。

**验证**：`pnpm verify` 退出码 0；`node scripts/rule-checks.mjs disclosure origin/main` 与 `node scripts/rule-checks.mjs size origin/main` 退出码 0；`git diff --check origin/main...HEAD` 无输出；`git log --format=%B origin/main..HEAD | grep -c '^#'` 输出 `0`。**回滚**：`git reset --hard refs/backup/delivery-lineage-strip`。

## Validation and Acceptance

| # | 验收项 | 判定证据（具名测试；变异 → 应变红的测试） |
|---|---|---|
| 1 | 缺跳派生为缺口，不派生为第二条关系 | A2、E1 刷新前；M11 去掉 `'unknown'` 回退 → A2 error 行；M12 按 hops 迭代或借邻居 `to` 造节点 → A2 |
| 2 | 未确认、标 stale、超阈值的集合永不派生为 passed | A3 全表、A1 正对照、E1、E2；M1 `>` 改 `>=` → A3/A5 等值行；M3 去掉集合 stale 判定 → A3；M4 改 `set.stale === true` → A3 缺字段行；M5 unconfirmed 当 fresh → A3/A5；M7 忽略 `hop.stale` → A3；M15 进行中 CI 判 observed → A1；M16 流水线与检查集合映射对调 → A3 错位行 |
| 3 | 年龄只用 `confirmedAt`；`attemptedAt` 新而 `confirmedAt` 旧 → stale | A4；M6 把 `projection.attemptedAt` 当 `confirmedAt` 传入 → A4 |
| 4 | 永不提供编辑规划状态的控件 | A6；M14 节点加 `actions: []` → A6 |
| 5 | 默认 5 分钟、可配置 | A5、E1；M2 去掉夹零 → A5 阈值 0 未来行；M8 忽略 `thresholdMs` → A5；M9 不校验 now → A5/A8；M10 阈值只拦 `< 0` → A5 NaN/Infinity 行 |
| 6 | 可用性来自逐跳标志而非工作区 capability key | A7；M13 `available` 恒 true 或改 `!hop.unavailable` → A7 |
| 7 | 纯函数、不读时钟、依赖方向不变 | A8、`pnpm run boundaries`；M17 从 `@harness-projects/client` 根出口值导入 → `ui-work-item-list-browser`（评审原型实测 `ℹ fail 1`）；M18 用 `new Date().toISOString()` 代替 now → A8 |

## Progress

- [x] 2026-10-21 15:05 +08 独立评审三份设计、核实事实、做原型并定稿本计划（协调者授权的独立评审者）。
- [ ] Batch 0 对齐与规划提交
- [ ] Batch 1 类型出口与共享年龄规则
- [ ] Batch 2 谱系条派生
- [ ] Batch 3 真实 core 互通
- [ ] Batch 4 对抗验收、回填与整合；PR 置 ready 前回读 `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences`，期望含 #357

## Surprises & Discoveries

执行上下文：评审原型在 `feature/delivery-lineage-strip`@5a92c40a 工作树的拷贝上运行（不含 `.git`，不是仓库检出），只写了 Design 的代码，没写测试。

- S1：原型 `npx tsc --noEmit` 退出码 0；既有守卫（list/detail 浏览器包、client-browser、presentation、boundaries）`ℹ tests 38`、`ℹ fail 0`；实现约 79 行（`delivery-lineage.ts` 73，`timestamp.ts` 与 `client/src/delivery.ts` 各 3）。
- S2：真实 `composeCore` + 替身：刷新前四个集合位置是 `not_refreshed` 缺口；T0 + 1 分钟与 + 299 999 ms 流水线 `passed`、`unknown`，检查 `passed`、`unknown`、`unknown`；+ 300 000 ms 四个集合全部 `stale`；只让流水线读失败再刷新 → 流水线 stale、检查仍 passed，`attemptedAt` 比 `confirmedAt` 晚 1 ms。替身的检查读方法名是 `listChecks`。
- S3：设计 1 称去掉 `Math.max(0, …)` 是等价变异，不成立：只要阈值 0 合法，未来时刻的 `confirmedAt` 不夹零就判 fresh，M2 可杀。
- S4：设计 1、3 称 `lineageEntryPoints`「无消费者」只在 main 上成立；#373 把它作为 AC3 证据（`tests/e2e/repository-routing.test.js`），本 PR 不能删，也不能替人预设由谁删。
- S5：设计 3 的锚点比对冗余：按 `delivery-facts.ts:30-40`，新鲜的 CI 集合与其锚点集合在同一次刷新里完整，锚点必是当前锚点；陈旧集合本就不会 passed。
- S6：集合跳的 `hop.stale` 恒等于 `set.stale`（`delivery.ts:123-124`），从未确认的集合没有节点（`delivery-facts.ts:108`）；「两个陈旧标志不一致」与「未确认却有跳」只来自坏形状输入，由 A3 的 fixture 覆盖，E2 只能杀「两个判定都删」的变异。
- S7：变异脚本用交互式 `cp` 恢复文件会卡在覆盖确认上；改用 `python3 -c "import shutil; …"` 或 `command cp -f`。

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
- D9 预计登记 TD-083：谱系可用性两种口径并存（`WorkItemDetail.lineage` 按 key、#373 起按仓库；谱系条按逐跳 `available`）。延期理由：#373 正在使用并修改 `capability-access.ts`。影响：#234 若从 `detail.lineage` 取可用性，会与 core 实际经过的门分叉（变更请求跳 core 不设门，key 口径却要求 `development.change_request.read`）。下一步：#234 只用谱系条的 `available`，#373 合并后由 #234 决定 `detail.lineage` 保留或下线。
- D10 预计登记 TD-084：派生不给出下一次翻转时刻（无 `staleAt`）。延期理由：验收只要求纯函数，调度归宿主（ADR-0011 Consequences、TD-045）。影响：抽屉不重派生时 passed 会在超过阈值后仍挂着。下一步：#234 在打开、刷新与定时（间隔不大于阈值）时用新 now 重派生。TD-085 保留不用。

## Idempotence and Recovery

- 所有测试都是纯函数或内存替身，可重复执行；变异只在 `rsync` 出来的拷贝里做，不碰工作树与 `.git`（拷贝里 node_modules 的工作区链接是相对路径，可直接运行）。
- 已知良好状态：Batch 1 之后年龄规则独立可用；Batch 4 整合前的 `refs/backup/delivery-lineage-strip`。
- 分支已推送后需要改写历史时，先建 backup ref，再用精确的 `--force-with-lease=<branch>:<sha>` 推送（AGENTS.md §6）。

## Interfaces and Dependencies

- 接口见 Design / Spec；坏 `now` 抛 TypeError、坏阈值抛 RangeError，都在任何派生之前抛出。
- 消费方义务（#234、#281）：用新 now 重派生（TD-084）；可用性只取节点 `available`；worktree 节点的 `externalId` 是工作树句柄（可能是本机路径），是否展示由页面决定。
- 依赖：controller 的 `ControllerQueries['getDeliveryProjection']` 返回类型；`apps/harness-plugin` 的 esbuild（只用于浏览器包测试）；Node v26。
- PR 元数据：标签 `kind:feat`、`area:ui-model`、`area:client`；milestone M4；`Closes #357`；回读 `gh pr view <n> -R SingularityKChen/harness-projects --json labels,milestone,closingIssuesReferences`。

## Outcomes & Retrospective

尚未实施。Batch 4 完成后回填实际行数（实现、测试、文档分列）、与计划的偏差和遗留问题。

## Bottom Change Note

- 2026-10-21 15:05 +08 创建：独立评审设计 1–3 后定稿；取舍见 Design / Spec 与 D1–D10，原型证据见 S1、S2。
