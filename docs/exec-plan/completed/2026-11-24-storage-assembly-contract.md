# storage 装配契约收敛 ExecPlan

> 状态：Completed（2026-11-24 追加本轮 P2 F1 测试护栏修复；独立修复复评与最终发布门仍待根协调方完成）
> 创建：2026-11-24
> 范围：issue #632 —— 把 core 的 Storage 注入从「顶层 direct + provider 表」双入口收敛为 provider 表唯一入口：删除 `CoreDeps.storage`，迁移全部测试组合点，真实 Host 零改动（`apps/` 零 diff）。交付一个可独立回滚的装配契约 PR，PR 以 closingIssuesReferences 关闭 #632，父项 #224 保持开放。
> 上游输入：issue #632、父项 #224；Lead 决策记录 .superpowers/iteration12/decisions.md；三份独立设计 .superpowers/iteration12/632/design-{engineering,skeptic,system}.md 与 brief.md；AGENTS.md、PLANS.md、docs/development/workflow.md、docs/review/README.md。
> 执行检出：工作树 .worktrees/iteration12-storage-assembly，分支 refactor/storage-assembly-20261124，base main@c24d1491。

## Purpose / Big Picture

完成后，一次 core 组合只有一个 Storage 实例，唯一装配入口是 `CoreProviderTable.storage`；`CoreDeps` 不再有第二个 storage 字段，双入口选择表达式消失；真实 Host 代码零改动，`apps/` 零 diff 成为 Host 未被改写的机械证据；所有测试组合点改用 provider 表形式，行为与既有断言逐字等价；缺 storage 仍返回逐字相同的结构化不可用。一个只读本文件的实现者能按批次完成迁移、在「迁移后、删字段前」与「删字段后」两个检查点分辨迁移错误与契约错误，并知道何时可交给人类评审。

成功的最小证据：新判别文件 2/2 绿（base 上用例 1 红）；真实 Host 文件 2/2 绿；`pnpm test` 三层 fail 0；`pnpm typecheck` exit 0；`pnpm run boundaries` 10/10；`git diff --stat origin/main...HEAD -- apps/` 无输出；`git grep -n 'deps.storage' -- packages apps` 无输出。

## Context and Orientation

- **CoreDeps / provider 表**：`CoreDeps` 是 `composeCore` / `createContext` 的装配入参；`CoreProviderTable` 是 core 的注入表，槽位为 planning/development/delivery/execution/executionFallback 与本地 storage。当前选择式在 `packages/core/src/context.ts:147`：`deps.storage ?? deps.providers.storage`；`CoreDeps.storage` 在 `:75`，`CoreProviderTable.storage` 在 `packages/core/src/registry.ts:24`，`SLOT_NAMES` 在 `:44` 已把 storage 排除出外部挂载。
- **真实 Host**：唯一生产组合根是 `apps/harness-plugin/src/host-composition.ts`；`:320` 把 `storage: storage!` 并进 provider 表，`:325` 调 `composeCore` 且不传顶层 storage。`git grep` 生产代码只有这一个 composeCore 调用点；`apps/web` 不 import core。
- **standalone 消费者**：仓库没有独立生产 app。可称为 standalone 组合根的只有 `tests/fixtures/*.mjs` 的组装函数与 `packages/providers/fake` 的组合夹具；`createFakeProviders()`（`packages/providers/fake/src/index.ts:33,43`）把 storage 与 port 打成一个对象，正是旧 direct 入口的测试便利来源。
- **ack 与不可用语义**：`createContext` 先校验、收集，再用一个事务写工作区与全部挂载，Storage ack 后才发布 Registry；缺 storage 时 `createContext` 返回 `undefined`，`composeCore` 返回 `unavailableCore('没有可用的 storage 绑定')`（`context.ts:174,219`），查询 degraded/stale、命令 `not_supported`，不抛错。
- **既有判别证据（不改断言，只改入参形状）**：`tests/integration/provider-binding-registration.test.js` 的 32 条双存储矩阵（事务 ack 前不发布、后序挂载写入被拒整批回滚、同 id 异实现整批回滚且不留孤儿锚点）；`tests/integration/github-projects-bootstrap.test.js`（表路径）；`tests/integration/runtime-planning-access.test.js`（direct 路径迁移）；`tests/e2e/chain-bootstrap.test.js:121`（缺 storage 文案）。`tests/e2e/controller-roundtrip.test.js:567` 已用 provider 表 `storage: undefined` 表达缺 storage，无需改动。
- **测试不受 typecheck 保护**：`tsconfig.json` 的 include 只含 `packages/**/src` 与 `apps/**/src`；JS 测试迁移的正确性只能靠整套测试、迁移检查点与变异，不能靠 tsc。

## Design / Spec

### 可判定的装配契约（head）

1. **选择**：`providers.storage = S` 时 `createContext(...).storage === S`；工作区与全部挂载写进 S 的同一个事务，组合期不存在第二个被触碰的 Storage。
2. **竞争输入**：`CoreDeps` 没有 storage 字段；JS 调用方多传顶层 `storage` 键也不被选中、零写入（JS 不校验多余键）。
3. **缺失**：表内无 storage 时，即使 JS 入参带有效顶层 stray storage，也不得回退选择；stray 的完整存储状态与提交读栅栏不变（零写入）。`createContext` 返回 `undefined`；`composeCore` 返回结构化不可用，`getPlanningSync()` 为 `{ degraded: true, stale: true, reason: '没有可用的 storage 绑定' }`，`getStartWorkTargetError(...)` 的 code 为 `not_supported`，不抛错。
4. **真实 Host**：`createHostComposition` 的 core 只从注入表拿到 Host 的 SQLite Storage；空数据根创建工作区后，`getWorkspaceSetup` / `baseline` 与直接读库三处 workspace id 一致。

### 消费者记录（AC1）

| 消费者 | 位置 | 现状 | 本计划处置 |
|---|---|---|---|
| 真实 Host（唯一生产组合根） | `apps/harness-plugin/src/host-composition.ts:320,325` | 只走 provider 表 | 0 行；apps/ 零 diff 验收 |
| standalone 组合根 | `tests/fixtures/` 4 文件；`packages/providers/fake/src/index.ts:33,43` 组合夹具 | 顶层 storage（与表内 storage 并存时顶层胜出） | 迁移为 provider 表覆写 |
| test 消费者 | 188 个 compose/createContext 调用；84 个对象字面量站点/36 文件，其余顶层键分布在 11 个 world/options/helper/条件 spread 文件 | 顶层 storage | 迁移为 provider 表覆写 |
| 既有 canonical 站点 | `tests/integration/github-projects-bootstrap.test.js:63`、`tests/integration/planning-fields.test.js:39` 等；`tests/e2e/controller-roundtrip.test.js:567` | 已经只经表 | 0 行 |
| 领域相邻死字段 | `packages/capabilities` 的 `ResolvedBinding.storage`（恒 undefined 无读者） | 与本契约无关 | 非目标，登记给后续小清理 |

### 备选方案与选定（AC1）

| 维度 | A direct-only（删 provider 表槽） | **B provider-table-only（选定）** | C 双入口 + 显式选择语义 |
|---|---|---|---|
| 边界 | 改唯一生产 Host + fake 组合形状 + 约 90–120 处表调用整形 | 只改 core 字段/一行/注释 + 测试入参 | 两入口保留，写死顶层优先 |
| 状态拥有 | Host 仍拥有实例，但测试组合根失去单一形状 | 不变：Host 拥有实例，表携带唯一入口 | 两个 storage 事实源并存 |
| 失败路径 | Host 忘传即退化为 unavailable（新错误点）；providers.storage 变未知槽位 | 缺 storage 语义逐字不变 | 竞争时静默取一个，正是要消除的歧义 |
| 可逆性/验证成本 | 需同时改 Host 与 fake 面，>500 行，超 CodeBudget 400 | 唯一行为变更 3–8 行，迁移可逐目录验证 | 低改动但删不掉第二入口 |
| 结论 | 拒：收益为零、爆炸半径含唯一生产路径 | **选：真实 Host 已是 canonical consumer，风险集中在可验证的测试迁移** | 拒：AC2 的「无真实职责的第二入口」不成立 |

### 选定契约与符号变更

- `packages/core/src/context.ts`：删 `CoreDeps.storage?: Storage`（:75）；`const storage = deps.storage ?? deps.providers.storage` 改为 `const storage = deps.providers.storage`；`createContext` 注释改为「storage 只来自 provider 表，缺失时由 composeCore 转成结构化不可用」；保留 `CoreContext.storage` 与 `Storage` import。
- 编译期哨兵（保留）：沿用 `packages/domain/src/ids.ts` 的 `IdBrandIsolationCheck` 惯用法，在 context.ts 增加已导出的 `CoreStorageEntryCheck`，用 `@ts-expect-error` 在 tsc 下锁住 `CoreDeps['storage']` 不存在；只被 tsc 检查、运行时不产码。它是「字段被无声加回」的编译期哨兵，不是不可绕过机制：把指令改成 `@ts-ignore` 或删除接口本身不会让 tsc 失败，指令原样存续由评审把关（P3-2，S15/D13）；它是可逆的 5 行，故保留。
- `packages/core/src/registry.ts`：`CoreProviderTable.storage` 注释改为「唯一的 Storage 装配入口；一个组合一个实例；不属于外部域挂载」；`SLOT_NAMES` / `mountsOf` 行为不变。
- 不新增运行时生产 API、error code、配置、依赖、测试 helper；唯一公共面变化是 type-only 自检接口 `CoreStorageEntryCheck`（无运行时导出）。不保留 deprecated 别名、shim 或旧形状双实现。缺 storage 的固定文案与 `ProjectErrorCode.NotSupported` 不变。

### 迁移规则（评审可机械核对）

- **R1** 只改 compose 入参；断言、storage 句柄、被测语义逐字不动。
- **R2（关键）** 顶层值搬进表并覆写表槽：`providers: { ...providers, storage }`，这里的 storage 即原顶层值。站点 providers 表内自带 storage（`createFakeProviders()`、world 对象、sqlite 替代）时，覆写决定选举结果；不覆写会让 core 读到表内旧实例，是静默换存储的唯一来源。
- **R3** world 形（`composeCore(w)`）：`composeCore({ ...w, providers: { ...w.providers, storage: w.storage } })`；同文件 ≥3 处可用文件内局部 `depsOf(w, over)`，不建共享 helper。
- **R4** 条件 helper：`storage === undefined ? providers : { ...providers, storage }`；`createContext` 单点 helper 同规则。
- **R5** 过期快照陷阱：`tests/integration/execution-run-refresh.test.js` 的 deps 对象在 reopen 后仍指向旧 storage；迁移必须从实时变量组装，不能用创建时快照。验收期 E1 反向变异（把 deps 改回创建时快照）曾 SURVIVED（既有用例只在 reopen 前组装、之后显式换句柄），故补了一条「reopen 后重新组装」正控用例；该变异现为 KILLED（P3-1，V14）。

### 判别性验证与变异锚点（设计期已确认，执行时复跑）

- **RED（base，c24d1491）**：新用例 1 断言「表内 storage 被选中且写工作区+4 挂载，顶层游离 storage 零写入」；base 实际相反。设计期只读探针实测输出见 Surprises S1。
- **变异锚点**：M1 恢复顶层优先选择式 → 新用例 1 红；M2 从 Host 注入表删 `storage: storage!` → 真实 Host 用例红（组合退化为 unavailable）；M3 删 `@ts-expect-error` 行 → typecheck 红（TS2339）；M4 把 storage 加回 `CoreDeps` → typecheck 红（TS2578 unused directive）；M5 把任一已迁移覆写站点改回顶层键 → 该站点文件红（选中表内旧实例）。全部经 `scripts/review-mutate.mjs` 施加并逐字节还原，不提交变异。

### 本轮 F1 负对照补齐（2026-11-24）

现有缺失用例只传空表，竞争用例总有表内 storage；表优先但回退顶层的选择式会存活。只扩展现有缺失用例，同时保留纯缺失输入和加入“有效 workspace + 空表 + 顶层 stray”输入，逐项断言 context 缺席、查询 degraded/stale 和命令 not_supported，并对照 stray 完整状态与提交读栅栏。有效 workspace 确保 F1 变异因违规选择/写入被杀，而非因工作区形状错误失败；不改生产选择式或新增兼容入口。

F1 可复现 spec（保存到 `.superpowers/iteration12/632/f1-retired-entry.json`；运行态不入库）：

~~~json
{"command":["node","--test","--test-timeout=120000","tests/integration/core-storage-assembly.test.js"],"mutants":[{"id":"F1","file":"packages/core/src/context.ts","anchor":"  const storage = deps.providers.storage","replacement":"  const storage = deps.providers.storage ?? (deps as { storage?: Storage }).storage","killedBy":"表内没有 storage 时结构化不可用"}]}
~~~

复现命令：`node scripts/review-mutate.mjs .superpowers/iteration12/632/f1-retired-entry.json`，修复前预期 SURVIVED（exit 1）；修复后预期 F1 RED、归因命中该现有缺失用例、SUMMARY KILLED（exit 0），脚本还原后基线 2/2。只跑此判别面；未改生产行为，不重复此前 328 相关用例或全量门禁，最终组合验证由根协调方执行。

### 非目标与规模

- 非目标：不改 registry 槽位校验与 `CoreProviderTable` 形状；不删 `ResolvedBinding.storage`；不做 #368 unbind、#336、#314、#223；不新增 Host wire/UI；不为未发布 API 做兼容；不重写历史证据文档；不需要 ADR（不变量未变、无 schema/外部 ABI，决策记本计划 Decision Log）。
- 规模预算：技术新增+删除约 290–360（迁移 210–250、新用例 75–95、生产 3–12）；文档约 210–235（本计划约 210 行 + 索引 1 行）。PR 技术 ≤800、含文档 ≤1300；仓库硬上限 1000/1500。

## Global Constraints

- **唯一入口**：Storage 只能经 `CoreProviderTable.storage` 进入 core；不得保留第二个字段、别名、默认值回退、兼容分支或「测试用」旁路。
- **零 Host 改动**：`apps/` 是只读面；最终 `git diff origin/main...HEAD -- apps/` 必须为空且 `git diff --quiet` exit 0。若实现中发现 Host 必须改，说明方案选错，停止并回到 Design/Spec 重新裁决。
- **缺 storage 逐字不变**：`createContext` 返回 undefined、`composeCore` 文案与 `not_supported` 不变；不新增错误码。
- **测试不受 tsc 保护**：所有迁移以整套测试 + 迁移检查点 + 变异为准；不得删断言或降低既有矩阵覆盖。
- **分支与基线**：分支 `refactor/storage-assembly-20261124`，base `main@c24d1491`；所有证据在检出 `.worktrees/iteration12-storage-assembly` 的工作树根目录运行，记录分支名与 base；`gh` 命令带 `-R SingularityKChen/harness-projects`。
- **体积与发布面**：技术增删 ≤800、含文档 ≤1300（用户本轮预算）；仓库硬上限 1000/1500；提交前跑 size/disclosure 与发布面人工五类目扫描；不写 Project Status / blocked-by / blocking。
- **唯一文件集合（全任务唯一一次声明）**：生产 2 个 `packages/core/src/context.ts`、`packages/core/src/registry.ts`（仅注释）；测试新增 1 个 `tests/integration/core-storage-assembly.test.js`；测试改动 2 个：`tests/integration/harness-plugin-host-roundtrip.test.js`（新增 1 条 Host 用例）、`tests/integration/execution-run-refresh.test.js`（迁移之外另补 1 条 R5 正控用例，见 D12）；迁移集合 47 个（按目录）——`tests/integration/` 36 个：runtime-delivery-access、runtime-planning-access、planning-refresh-scheduler、planning-round-order、start-work-sqlite-registration、harness-plugin-start-work、planning-source-switch、pull-request-identity-convergence、provider-binding-registration、source-number-restart、change-request-assignees、create-change-request-assignees、development-local-git-windows、execution-context-run-status、github-development-lineage、harness-plugin-delivery-lineage、human-execution-provider、local-git-fixture、original-pr-receipt、planning-membership-reconcile、planning-snapshot、runtime-operation-access、start-work-execution-uniqueness、start-work-local-git-sqlite、start-work-request-binding、start-work-retry-identity、storage-connector-account、sync-revision-freshness、workspace-sync-scope、delivery-repository-routing、draft-promotion-reconcile、execution-run-refresh、start-work-execution-recovery、start-work-external-intent、start-work-owner-fencing、start-work-task-handoff；`tests/e2e/` 6 个：chain-bootstrap、start-work、start-work-recovery、delivery-lineage、repository-routing、status-policy；`tests/fixtures/` 4 个：change-request-world.mjs、lineage-refresh.mjs、composed-execution-platform.mjs、execution-drawer-browser.mjs；`tests/contract/suites/` 1 个：storage-connector-account.js；文档 2 个：本计划、docs/README.md；验收处置新增文档 1 个：docs/review/pr-677-mmp-review.md（独立验收 P3 处置记录，见 D11）。除此之外不改任何文件（含 tests/integration/README.md、历史文档、在跑计划）。
- **迁移检查点（硬门）**：① Batch 3 完成、字段仍在时，既有测试（除新判别文件用例 1 外）必须全绿，唯一预期红是新判别文件用例 1（Batch 2 已记录红，Batch 4 翻绿）；出现第二个失败即迁移错误。② Batch 4 完成、字段删除后，`pnpm test` 三层全绿且新用例 1 翻绿。③ 最终 head 上 V1–V14 全过。
- **迁移改写纪律**：只改 compose/createContext 入参；表内自带 storage 的站点必须 R2 覆写；违反这两条的 diff 在评审中直接判为缺陷。

## Plan of Work

### Batch 1 · ExecPlan 入库 + draft PR

**最小闭环**：契约、消费者与批次先于任何公共装配面改动落盘（AC1），并建立可回读的 draft PR 承载 issue 关联。
**涉及文件**：本计划、docs/README.md（Active 索引 1 行）。
**步骤**：1) 提交这两个文档；2) push 分支；3) 创建 draft PR（base main，title 镜像 issue 英文标题，body 含闭环、ExecPlan + Batch 引用、closingIssuesReferences 关闭 #632、真实验证证据、风险与回滚）；4) 设置 labels = kind:refactor + area:core/area:apps/area:tests、milestone 与 issue 一致、assignee SingularityKChen；5) 按 V13 回读。不合并、不写 Project 字段。
**验证**：V0、V9、V13；本批特有期望：V13 显示 `baseRefName=main`、`isDraft=true`、`closingIssuesReferences` 含 #632。
**回滚**：分支未推送时删除本批两个文档改动；已推送则 revert 本批提交（纯文档，无运行时影响）。

### Batch 2 · 新判别用例与真实 Host 用例（记录 base 红/绿）

**最小闭环**：把唯一入口、竞争输入与缺 storage 契约固化成可失败的新用例，并加真实 Host 回归锁；生产代码仍为 base。
**涉及文件**：tests/integration/core-storage-assembly.test.js（新建）、tests/integration/harness-plugin-host-roundtrip.test.js（新增 1 条）。
**步骤**：1) 新文件首行 `import '../fixtures/resolution-preflight.mjs';`；2) 用例 1「注入表 storage 是唯一入口，同次装配的游离顶层 storage 不被选中、零写入」：`providers = createFakeProviders()`，`table = providers.storage`，`stray = createFakeStorage()`，`createContext({ workspace, providers, storage: stray })`，断言 `context.storage === table`、`exportFakeStorageState(table)` 有 1 个 workspace 与 4 条 providerBindings、`stray` 两者均为 0；3) 用例 2「表内没有 storage 时结构化不可用」：`createContext({ providers: {} })` 为 undefined，`composeCore({ providers: {} })` 的 `getPlanningSync()` 逐字等于 `{ degraded: true, stale: true, reason: '没有可用的 storage 绑定' }`、`getStartWorkTargetError('missing')` code 为 `not_supported`；4) 用例 1 内注释说明游离键是退役第二入口的常驻回归护栏（先例：用运行时形状断言退役 API），JS 测试不经 tsc；5) Host 用例：空 catalog 起 createHostComposition，getWorkspaceSetup 初始 workspace 为 null，call('createWorkspace') 返回 local_only，随后 getWorkspaceSetup、baseline 与只读 SQLite 的 workspace 行三处 id 一致；6) 生产代码未动时按 V1 记录 base 红、按 V2 记录 Host 用例 base 绿。
**验证**：V1 的 base 行（tests 2 / pass 1 / fail 1，失败必须是用例 1）；V2 的 base 行（2/2，GREEN-only 回归锁）。
**回滚**：revert 本批提交（纯测试新增，零生产影响）。

### Batch 3 · 迁移调用点（字段仍在）

**最小闭环**：47 个迁移文件的 compose/createContext 入参全部改为 provider 表携带；旧字段与旧选择式仍在，迁移正确性由「既有测试全绿」与「恰一新用例红」共同判别。
**涉及文件**：Global Constraints 的 47 个迁移文件。
**步骤**：1) 按 R1–R5 逐目录执行；2) 表内自带 storage 的站点一律 R2 覆写，world 形按 R3 组装，条件 helper 按 R4；3) 不得改新判别文件里的游离键、`tests/e2e/controller-roundtrip.test.js:567` 的既有表形状与任何断言；4) 完成后按目录走查 diff，确认只剩「加覆写 + 删顶层键」，迁移后仍带顶层 storage 的站点只有新判别文件的游离键；5) 记录 V1 仍为 base 行、V5 除新用例 1 外全绿。
**验证**：V1（base 行，恰 1 红）；V5（唯一失败必须是新用例 1）；V2、V3、V6、V7 全绿。出现第二个失败即停止修复，不放行。
**回滚**：revert 本批提交；字段与选择式未动，测试回到 base 形状。

### Batch 4 · 删除字段 + 选择式 + 编译期自检（全套绿）

**最小闭环**：删除 direct 入口与双入口选择式，新契约从「预期红」翻绿，字段无法被无声加回。
**涉及文件**：packages/core/src/context.ts、packages/core/src/registry.ts；新判别文件与 Host 用例已在 Batch 2 就位。
**步骤**：1) 删 `CoreDeps.storage`，选择式改为 `deps.providers.storage`，更新注释；2) 加 `CoreStorageEntryCheck`（导出接口 + `@ts-expect-error` + 中文说明）；3) `packages/core/src/registry.ts` 注释改为唯一入口；4) 跑 V1 翻绿、V4 与变异 M1–M5；5) 确认 V11 无输出、V10 为空。
**验证**：V1 head 行（2/2）；V4（exit 0；M3 红为 TS2339、M4 红为 TS2578）；V12（M1–M5 全部 KILLED）；V5 三层全绿；V3、V6、V7、V10、V11 按表通过。
**回滚**：合法回滚单位是本批 + Batch 2 新用例（单独 revert 本批会让用例 1 重新变红）；或整分支回退。

### Batch 5 · 文档收口与整理提交

**最小闭环**：回填 Progress/Surprises/Decision Log/Outcomes，计划归档到 completed/ 并移动索引行，整理提交并回读远端状态。
**涉及文件**：本计划（移动到 docs/exec-plan/completed/2026-11-24-storage-assembly-contract.md）、docs/README.md。
**步骤**：1) 回填执行事实与偏差；2) 状态改 Completed，`git mv` 归档，Active 行移到 Completed；3) 整理提交（去除 debug/fixup/临时变异，保留可独立审阅的提交序列），重跑 V4–V14；4) push 后按 V13 回读 head/base/checks/closingIssuesReferences；5) 全部通过后 `gh pr ready`，请求人类评审；不合并、不写 Project 字段。
**验证**：V0（completed 路径可解析）、V4–V14 全绿；V13 显示最终 head 与 issue 关联。
**回滚**：revert 本批文档提交；计划可移回 active/ 并还原索引。

## Validation and Acceptance

所有命令在检出分支 refactor/storage-assembly-20261124 的工作树 .worktrees/iteration12-storage-assembly 根目录运行；除非注明，期望 exit 0。设计期基线为 2026-11-24 @ c24d1491 的只读实测；计数为易失量，以实际输出为准，任何与期望的差异必须解释或停下。

| ID | 命令 | 期望输出 |
|---|---|---|
| V0 | `test -f "docs/$(grep -o 'exec-plan/[^)]*2026-11-24-storage-assembly-contract.md' docs/README.md \| head -1)"` | exit 0（索引链接目标存在；Batch 1 为 active 路径，Batch 5 为 completed 路径） |
| V1 | `node scripts/resolution-check.mjs && node --test --test-timeout=120000 tests/integration/core-storage-assembly.test.js` | head：ℹ tests 2 / ℹ pass 2 / ℹ fail 0；base 的 Batch 2 读数：tests 2 / pass 1 / fail 1（用例 1） |
| V2 | `node --test --test-timeout=120000 tests/integration/harness-plugin-host-roundtrip.test.js` | ℹ tests 2 / ℹ pass 2 / ℹ fail 0（既有 1 条 + 新增 1 条；base 上同样 2/2，作为 Host 回归锁） |
| V3 | `node scripts/resolution-check.mjs && node --test --test-timeout=120000 tests/integration/provider-binding-registration.test.js tests/integration/github-projects-bootstrap.test.js tests/integration/runtime-planning-access.test.js tests/e2e/chain-bootstrap.test.js` | ℹ tests 275 / ℹ pass 275 / ℹ fail 0（设计期基线；迁移不改断言与用例数） |
| V4 | `pnpm typecheck` | exit 0、无输出；M3 删自检指令后：TS2339: Property 'storage' does not exist on type 'CoreDeps' 且 exit ≠ 0；M4 加回字段后：TS2578: Unused '@ts-expect-error' directive 且 exit ≠ 0 |
| V5 | `pnpm test` | 三层 fail 0：contract tests 1625 / pass 1625；integration tests 2379 / pass 2351 / skipped 28（基线 2376/2348/28 + 新增 3 条）；e2e tests 226 / pass 226；Batch 3 期间唯一允许失败是新判别文件用例 1 |
| V6 | `pnpm test:browser` | ℹ tests 111 / ℹ pass 111 / ℹ fail 0（fixtures 在迁移集合，必须跑） |
| V7 | `pnpm run boundaries` | ℹ tests 10 / ℹ pass 10 / ℹ fail 0 |
| V8 | `node scripts/rule-checks.mjs size origin/main && node scripts/rule-checks.mjs disclosure origin/main` | size：代码 ≤800 / 1000、文档 ≤1300 / 1500；disclosure：机械扫描通过；均 exit 0 |
| V9 | `git diff --check origin/main...HEAD` | 无输出 |
| V10 | `git diff --stat origin/main...HEAD -- apps/ && git diff --quiet origin/main...HEAD -- apps/` | 无输出且 git diff --quiet exit 0（真实 Host 零改动） |
| V11 | `git grep -n 'deps.storage' -- packages apps` | 无输出（最终 head 的一次性证据；base 上命中 context.ts:147） |
| V12 | `node scripts/review-mutate.mjs .superpowers/iteration12/632/storage-assembly-mutants.json` | M1–M5 全部 KILLED、exit 0；spec 属运行态不入库；跑后 V10 仍为空（证明 apps/ 已还原） |
| V13 | `gh pr view -R SingularityKChen/harness-projects --json baseRefName,headRefOid,isDraft,mergeStateStatus,closingIssuesReferences,labels,milestone,assignees,statusCheckRollup` | baseRefName=main；isDraft 在 ready 前为 true；closingIssuesReferences 含 #632；labels 含 kind:refactor 与 area:core/area:apps/area:tests；milestone 与 issue 一致；statusCheckRollup 中必需检查 `PR Fast Gate` 为 SUCCESS、无失败或取消项（观察时刻快照，重算即再跑本命令） |
| V14 | `node --test --test-timeout=120000 tests/integration/execution-run-refresh.test.js` | ℹ tests 11 / ℹ pass 11 / ℹ fail 0（既有 10 条 + P3-1 R5 正控 1 条）；E1 反向变异（deps 改回创建时快照）必须被该正控 KILLED |

**AC 对照**：AC1 → Design/Spec 的消费者记录与备选表 + Batch 1 先落盘；AC2 → 删除 direct 入口、无第二入口（V11、Design/Spec）；AC3 → 既有 ack/回滚矩阵不改断言（V3）、单实例与否决竞争输入（V1）、真实 Host（V2、V10）；AC4 → 新判别文件 + Host 用例 + 缺 storage 用例（V1、V2）；AC5 → V4–V10 与回滚边界。**验收门**：V4–V14 最终 head 全过，且 Batch 3/4 两个检查点按其期望出现；任何未过项写成阻塞，不以「应该可以」代替。

## Progress

- [x] Batch 1 · ExecPlan + 索引 + draft PR（提交 b1ce84b0；push 与 draft PR 创建按分工由 Lead 执行，本实现会话不写远端）
- [x] Batch 2 · 新判别用例 + Host 用例 + 记录 base 红/绿（提交 dc08a62）——V1 base：tests 2 / pass 1 / fail 1，失败为用例 1；V2 base：2/2 绿
- [x] Batch 3 · 迁移 47 个组合点（字段仍在；提交 8d793b6）——V1 仍为 base 行；V5 contract 1625/1625、integration 2379（2350 pass、唯一失败 = 新用例 1、28 skipped）；e2e 层单独跑 226/226、browser 111/111、boundaries 10/10
- [x] Batch 4 · 删字段/选择式/编译期自检（提交 17e93b4）——V1 head 2/2 翻绿；V4 typecheck exit 0；V5 三层全绿（contract 1625、integration 2379/2351/28 skipped、e2e 226）；M1–M5 全 KILLED
- [x] Batch 5 · 文档收口、归档、整理提交（本地完成；push、PR 描述更新与 gh pr ready 按分工交给 Lead，本实现会话不写远端、不写 Project 字段）
- [x] Batch 6 · 独立验收处置（无 P0/P2；P1-1 交付门交 Lead；P3-1 补 R5 正控、P3-2 收窄编译期哨兵表述、P3-3/P3-4/P3-5 记录处置，见 D11–D14 与 Outcomes 第 7 条；处置提交见分支末尾）

- [x] 2026-11-24 本轮 F1：现有缺失用例扩展 direct-only 负对照；同一 fallback 变异由 SURVIVED 转 KILLED（具名归因），还原后 2/2、零 skip；测试与最终证据待根协调方安排独立修复复评。

## Surprises & Discoveries

以下均为设计期只读证据（2026-11-24，检出 .worktrees/iteration12-storage-assembly，分支 refactor/storage-assembly-20261124 @ c24d1491；未改仓库文件）：

1. **S1 双入口竞争在 base 可运行复现**：以两份 MemoryStorage 同时作为 provider 表 storage 与顶层 storage 调 createContext，实测输出 `{"selectedIsTable":false,"selectedIsStray":true,"tableWorkspaces":0,"tableBindings":0,"strayWorkspaces":1,"strayBindings":4}` —— 顶层胜出、表内实例零写入。探针经 stdin 执行、未落盘；其可执行形式由 Batch 2 用例固化。
2. **S2 真实 Host 空数据根路径可行**：以空 catalog 调 createHostComposition，getWorkspaceSetup 初始 workspace=null；call('createWorkspace') 返回 local_only；随后 getWorkspaceSetup、baseline 与只读 SQLite 的 workspace 行三处 id 一致。该探针未落盘，Batch 2 的 Host 用例据此固化。
3. **S3 代码实测**：`packages/core/src/context.ts:147` 是唯一双入口选择式；生产 composeCore 调用点只有 `apps/harness-plugin/src/host-composition.ts:325` 一处；apps/web 不 import core；registry.ts:24,44 的 storage 槽已从外部挂载中排除，因此 registry 不需要行为改动。
4. **S4 迁移计数口径不一**：三份设计分别给出 86/97/110 处；设计期 AST 只读统计为 188 个 compose/createContext 调用，其中 84 个对象字面量站点直接带顶层 storage（36 文件），其余顶层键分布在 11 个 world/options/helper/条件 spread 文件（含 `composeCore({ ...w, ... })`、`extra: { storage }`、helper 参数等），去重后 47 个迁移文件。差异来自「行/调用/文件」三种口径，且设计清单漏了 3 个 helper 形文件；执行时以实现时 git grep 与 AST 清单为准，文件集合见 Global Constraints。
5. **S5 测试基线（设计期实测）**：pnpm test 三层 contract 1625/1625、integration 2376 tests（2348 pass、28 skipped）、e2e 226/226，总耗时约 69–75s；pnpm typecheck exit 0（约 2s）；pnpm run boundaries 10/10；四文件相关套件 275/275；pnpm test:browser 111/111（约 62s）。
6. **S6 JS 测试不受 tsc 保护**：tsconfig.json include 只含 packages/apps 的 src；漏迁移的站点若表内也带 storage 会静默换实例，故必须靠迁移检查点、整套测试与 M5 判别，不能只靠类型。
7. **S7 既有证据已覆盖不变量**：provider-binding-registration 的 32 条双存储矩阵覆盖 ack 前不发布、后序挂载拒绝整批回滚、同 id 异实现整批回滚；缺 storage 文案当前唯一断言在 tests/e2e/chain-bootstrap.test.js:121；tests/e2e/controller-roundtrip.test.js:567 已有表内 undefined 形状。
8. **S8 历史文档的过时句子保留**：docs/architecture/harness-host-spike.md 的记录写有「composeCore 取 deps.storage ?? deps.providers.storage」。它是 2026-09-24 固定日期观测记录且自述「不是对 packages/** 的修改建议」，按 Lead 决策不改写原文；本计划的契约落点是代码注释与本文，历史文档零 diff 由 Global Constraints 的文件集合保证。
9. **S9 @ts-expect-error 自检的代价与收益**：新增 1 个导出类型符号（约 5 行）换取「字段被加回」的编译期失败；沿用 `packages/domain/src/ids.ts` / `packages/capabilities/src/capability-keys.ts` 先例，不新增运行时行为。设计期用 TypeScript 编译器 API 在内存中编译同形片段验证了该机制：字段不存在时无诊断，字段加回后报 TS2578；若评审判定其脆弱，删除它只需回滚该 5 行并将本轮结论记入 Decision Log。验收期实测其绕过面（`@ts-ignore`/删接口，S15），故 D13 把表述收窄为「编译期哨兵 + 评审门」，不声称硬保证。

实现期补充（2026-11-24，同一检出，全部为实测）：

10. **S10 迁移集合实测与计划一致**：AST 扫描 + `git grep` 实测 194 个 compose/createContext 调用点、47 个迁移文件（integration 36、e2e 6、fixtures 4、contract suites 1，与 Global Constraints 逐文件对齐）。其中 34 个文件 82 处对象字面量直接站点由一次性 codemod 做「删顶层键 + 表内覆写/追加」的文本手术；另有 3 处对象字面量站点（human-execution-provider、start-work-execution-uniqueness、start-work-request-binding，因带 clock 条件 / 无 providers 键 / 自定义 spread 被 codemod 跳过）和 2 个条件表达式 helper（e2e chain-bootstrap、start-work）手工迁移；11 个文件是 world 形或 `...extra` 间接形（文件内局部 depsOf/deps 函数）。与 S4 的设计期口径互补，没有出现需要偏离计划的新文件。
11. **S11 R5 确认为真实陷阱**：`execution-run-refresh.test.js` 的 deps 对象在 reopen 后仍指向旧 Storage；改成 `const deps = () => ({ ..., providers: { ...providers, storage } })` 后同一用例两适配器全绿。其余 world 形文件（draft-promotion-reconcile、start-work-execution-recovery、start-work-external-intent、start-work-owner-fencing、start-work-task-handoff、start-work-execution-uniqueness、start-work-request-binding）用文件内局部 `depsOf(w, over)` 从实时 `w.storage` 组装；reopen 后被替换的句柄都读到了新实例。
12. **S12 M1 变异需要类型断言才能检验运行时选择语义**：字段删除后直接写回 `deps.storage` 会先被 tsc 拦住（TS2339），新用例 1 不会运行，M1 就只被类型检查而非判别用例击穿。改用 `(deps as { storage?: Storage }).storage ?? deps.providers.storage` 保留运行时选择式后，M1 由新用例 1 击穿（KILLED 归因正确）。M3/M4 由 tsc 以 exit 2 击穿：M3 输出 TS2339、M4 输出 TS2578，均已人工复跑捕获原文。
13. **S13 Batch 3 的 e2e 层被 fail-fast 跳过**：`pnpm test` 的层链在 integration 出现唯一预期失败处停下，e2e 不会执行；为拿到「迁移未破坏 e2e」证据单独跑 `node scripts/run-test-layer.mjs tests/e2e`（226/226 绿）。Batch 4 后三层一次通过，与期望一致。
14. **S14 验收期 E1 反向变异暴露 R5 无判别**：独立验收把 `execution-run-refresh.test.js` 的 deps 改回「创建时对象快照」，原树全绿（SURVIVED）——既有用例只在 reopen 前组装，之后用 `{ ...ctx, storage }` 显式换句柄，函数形与对象快照在现有用例下等价。补一条「reopen 后重新调用 `h.context()`」正控后，同一变异 KILLED；R5 表述与 V14 相应更新（P3-1/D12）。
15. **S15 编译期哨兵的绕过面**：把 context.ts 的 `@ts-expect-error` 改成 `@ts-ignore`（或删除整个自检接口）时 `pnpm typecheck` exit 0，甚至 `@ts-ignore` + 把 `storage` 加回 `CoreDeps` 也不报错；只有让指令失效但仍保留指令的写法（如加 `[key: string]: unknown`）会以 TS2578 被抓住。因此 S9/D3 的「硬保证」表述按 D13 收窄为「编译期哨兵 + 评审门」。

16. **S16 本轮 MMP F1**：独立首审发现表优先但回退顶层的选择式在 328 个 focused cases 中 SURVIVED；修复 owner 以新判别文件两用例独立复现 SURVIVED（exit 1）。加入有效 workspace + 空表 + stray 的输入后，同一变异 RED，失败名仅为“表内没有 storage 时结构化不可用”，SUMMARY KILLED（exit 0）；基线及还原后基线绿，生产源码无未提交 diff。

## Decision Log

| # | 决策 | Rationale | 日期/来源 |
|---|---|---|---|
| D1 | 选方案 B：provider 表唯一入口，删除 CoreDeps.storage | 真实 Host 已是 canonical consumer；A 超预算且改唯一生产路径，C 无法满足 AC2 的「保留需真实职责」 | 2026-11-24，Lead 决策 + 三份设计收敛 |
| D2 | 不保留第二入口/别名/兼容分支 | direct 入口仅有测试便利，无生产职责；未发布产品无兼容义务 | 同上 |
| D3 | 保留 @ts-expect-error 编译期自检 | 防字段被无声加回；沿用仓库既有 idiom；M3/M4 证明指令在时的失败；成本 5 行。它是哨兵不是硬保证，指令本身可被改写绕过（S15、D13） | 2026-11-24，本评审（Lead 已预授权保留，脆弱则由评审去掉并记录） |
| D4 | 以本计划 + `packages/core/src/context.ts` / `packages/core/src/registry.ts` 注释承载契约，不改历史 spike 文档，不写 ADR | 不变量未变、无 schema/外部 ABI；历史文档是固定日期证据 | 2026-11-24，Lead 决策 + 本评审确认 |
| D5 | 新判别文件是「唯一入口/竞争输入/缺 storage」契约的唯一住处；e2e 的缺 storage 断言迁入，Host 用例加在既有 `tests/integration/harness-plugin-host-roundtrip.test.js` 文件 | 避免同一契约两处断言；Host 用例是 GREEN-only 回归锁，不新增文件 | 2026-11-24，本评审 |
| D6 | 迁移后、删字段前必须既有测试全绿，唯一允许失败是新判别用例 1 | 迁移是机械等价改写，仅删字段改变行为；单一已知红才能区分迁移错误 | 2026-11-24，设计/Lead 收敛 |
| D7 | 与 #368 的合并顺序假设：#632 先合，则 #368 新增 compose 调用必须写 provider 表形状（providers: { ...providers, storage }） | 两 PR 生产文件不重叠；表形状在 base/head 同义，避免 #368 引入旧入口 | 2026-11-24，Lead 决策 |
| D8 | 本计划由独立评审会话收敛，实现/验收另起上下文 | 宿主只暴露一个模型路由，独立性靠上下文与角色分离取得 | 2026-11-24，Lead 决策记录 |
| D9 | M1 变异用类型断言恢复运行时选择式 | 字段已删，直接写 `deps.storage` 会先被 tsc 拦住，M1 就绕过新用例只检验类型；M1 要检验的是运行时「谁胜出」 | 2026-11-24，实现时补充 |
| D10 | Batch 3 检查点的 e2e 层单独执行 | `pnpm test` 层链在唯一预期失败处 fail-fast，e2e 不会运行；单独跑 e2e 拿到迁移未破坏端到端的证据 | 2026-11-24，实现时补充 |
| D11 | 新增 `docs/review/pr-677-mmp-review.md` 并纳入 Global Constraints 文件集合 | 独立验收的 P0–P3 处置需要长期可查记录；单 PR 记录按 docs/review/README.md §8 不进索引表；计划已归档，故按 completed 路径回填而非新建 active 计划 | 2026-11-24，本验收处置 |
| D12 | P3-1 选择补 R5 正控用例，不把 S11 降级为「评审注意点」 | 成本仅 1 条用例、不改既有断言、不扩生产范围；补后 E1 反向变异由 SURVIVED 转 KILLED，R5 从「无判别」变为可回归（V14）；降级只会留下无法判别的声明 | 2026-11-24，本验收处置 |
| D13 | P3-2 把编译期自检表述改为「哨兵而非不可绕过机制」 | `@ts-ignore`/删接口可静默绕过（S15）；文档不应声称硬保证；不改实现，指令存续由评审把关 | 2026-11-24，本验收处置 |
| D14 | P3-3/P3-4/P3-5 不修（历史决定；P3-5 后被 D16 supersede） | P3-3 非法多余键是退役入口的刻意运行时护栏（tests 不受 tsc），只加注释说明；P3-4 已由 R3 显式取舍（文件内局部 helper）；P3-5 当时按 apps/ 零 diff 硬约束登记为后续小清理观察。该判断于 2026-11-24 经条件分支复核撤回：空 workspace 不调用 `composeCore`，原注释准确，无清理项；不新建 issue、不写 Project | 2026-11-24，本验收处置；P3-5 由 D16 supersede |

| D15 | 本轮按 review `6036636080` 的 P2 F1 扩展现有缺失测试，保持生产零改动；计划继续 Completed，独立修复复评与最终发布仍是前置 | 用户直接指定根会话负责 #674–#677 的修复、独立复评、归档、提交整理、issue 核对、rebase 合并与清理；本 owner 只执行其委派的测试/计划/评审记录修复，不自行 commit/push/外部写入，不变更 Planning Status 或关系 | 2026-11-24，本轮用户授权经根会话分工 |
| D16 | 撤回历史 P3-5：Host 注释不构成 defect/debt；记录父项关闭门 | `host-composition.ts:324` 只注释 `workspace === undefined` 的空数据根。此分支在 `:325` 返回 `unavailableCore`，不会调用 `composeCore`；只有非空分支把 `providers` 交给 Core。故原注释准确，无需 Host 改动或新 issue。父 #224 的 #633 已于 2026-11-21 经 #667 关闭；#632 仍 OPEN 并由 PR #677 承接，待 PR 实际 merge 后由 root 回读并处理 #632 与父项；不代表 R1/UAT/产品接受 | 2026-11-24，上下文复核；root 协调方负责合并后回读 |

## Idempotence and Recovery

- 批次可重复执行：Batch 3 的迁移是「加覆写 + 删顶层键」，若已部分应用，先回读 diff 与所有 storage: 出现位置，再补齐缺失站点；不得重复包一层 { ...providers }。
- 变异验证可重复：V12 由 review-mutate 按字节还原；跑后必须 V10 为空、git status 干净，否则停止。
- 无 schema、数据格式、配置、wire 或外部写入变更；失败恢复的最短路径是 git revert 当前批次或整分支回到 main@c24d1491。Batch 4 单独回滚会让新用例 1 重新变红，合法回滚单位是 Batch 4 + Batch 2 的新用例，或整个分支。
- 易失状态（head SHA、checks、PR 状态）不写入正文值；按 V13 回读。

## Interfaces and Dependencies

- 运行时：Node >= 22（仓库 engines），pnpm 10.28.2；无新增依赖或配置。
- 外部工具：git、GitHub CLI（V13 回读与 PR 操作）；无凭据需求，测试全部离线。
- 与 #368 并行：本 PR 生产改动仅 `packages/core/src/context.ts` 与 `packages/core/src/registry.ts` 注释；#368 改 workspace-setup/controller 与测试文件，互不重叠。假设本 PR 先合并：若 #368 在本 PR 之后 rebase，其新增 composeCore/createContext 调用必须写成 providers: { ...providers, storage }，不得新增顶层 storage:，也不得断言顶层优先级；若 #368 先合并，本 PR rebase 后按实现时 git grep 清单补迁其新增站点。两份 PR 都按 rebase merge 由人类决定。
- 文档契约：docs/README.md 的 Active/Completed 索引行与本计划文件位置必须一致（V0）；归档时 Active 行移入 Completed 表。

## Outcomes & Retrospective

实现于 2026-11-24 在同一检出（.worktrees/iteration12-storage-assembly，分支 refactor/storage-assembly-20261124，base main@c24d1491）完成 Batch 2–5 的本地部分。预先登记的核对项结果：

1. **体积**：V8 的 size 与 disclosure 均 exit 0；技术代码与文档分桶都低于预算（仓库硬上限技术 1000/文档 1500，本轮用户预算技术 800/含文档 1300）。按提交累计：Batch 2 测试 +63 行；Batch 3 迁移 47 文件 +178/−135；Batch 4 生产 +13/−5（其中运行时行为只有选择式一行，其余为注释与类型级自检）。
2. **迁移文件数**：实现时 AST/git grep 实测 47 个迁移文件（integration 36、e2e 6、fixtures 4、contract suites 1），与 Global Constraints 的清单逐文件一致，无偏差。
3. **S4 计数口径**：实测 194 个 compose/createContext 调用点、其中 34 个文件 82 处为对象字面量直接站点、11 个文件为间接形；「调用/文件」两种口径的差异已由逐文件清单覆盖。
4. **apps/ 零 diff**：`git diff --stat origin/main...HEAD -- apps/` 无输出、`git diff --quiet origin/main...HEAD -- apps/` exit 0；变异 M2 施加与还原后复查仍为空（review-mutate 按字节还原），证明真实 Host 未被改写。
5. **变异判别力**：V12 的 M1–M5 全部 KILLED——M1 由新判别用例 1、M2 由新增 Host 用例、M5 由 SQLite 交付谱系 5 条用例击穿；M3/M4 由 tsc exit 2 击穿（人工复跑捕获 TS2339 / TS2578 原文）。没有 SURVIVED / KILLED_OTHER / NOT_APPLIED。
6. **偏差与阻塞**：① Batch 1 的 push/draft PR 与 Batch 5 的 push/PR 描述/ready 按分工不由本实现会话执行（不写远端、不写 Project 字段）；② Batch 3 检查点的 e2e 层因 `pnpm test` fail-fast 单独执行（S13），Batch 4 后三层一次通过；③ 无其他偏差、无阻塞项。
7. **独立验收与 P3 处置（2026-11-24）**：独立 agent 对抗验收（verification-1）结论为无 P0/P2 代码缺陷；P1-1 是交付门（远端 PR 仍只有 Batch 1 文档提交，现有 checks/body 不覆盖实现 head），push/PR 描述/ready 按分工由 Lead 执行。P3 五项处置：P3-1 补 R5 正控用例（V14 11/11，E1 反向变异由 SURVIVED 转 KILLED）；P3-2 把编译期自检表述收窄为哨兵（S15/D13）；P3-3 在测试注释与评审记录说明非法多余键是刻意运行时护栏；P3-4 按 R3 显式取舍不修；P3-5 当时因 apps/ 零 diff 登记为后续小清理观察，后经 D16 上下文复核确认为误报并撤回。处置只新增测试、注释与文档，无生产行为变更；记录见 docs/review/pr-677-mmp-review.md（D11）。

最终 head 的 V0–V14 结果（实现会话与验收处置会话实测）：V0 索引链接可解析；V1 2/2；V2 2/2；V3 275/275；V4 exit 0；V5 contract 1625/1625、integration 2379（2351 pass、28 skipped）、e2e 226/226；V6 browser 111/111；V7 boundaries 10/10；V8 size/disclosure exit 0；V9 无输出；V10 无输出且 quiet exit 0；V11 无输出；V12 全 KILLED；V14 tests 11/11 且 E1 反向变异 KILLED。V13 的 push/PR/checks 回读留给 Lead。

剩余风险：类型级自检是编译期哨兵而非不可绕过机制——`@ts-expect-error` 指令被改成 `@ts-ignore` 或随接口删除时 tsc 不会失败（S15），其存续由评审把关（D3、D13）；R5 的过期快照陷阱已由 V14 正控判别（P3-1），不再是「无判别」声明；JS 测试不受 tsc 保护，已迁移站点若未来有人回退成顶层键，只有 M5 类变异或评审能发现——这是本计划显式接受的取舍（D3、S6）。P3-5 的 Host 注释清理判断已由 D16（2026-11-24）Superseded：空 workspace 分支不调用 composeCore，该注释准确，没有清理债务或新 issue。

### 本轮 P2 F1 修复

负对照方案与命令见 Design / Spec；本轮在 `refactor/storage-assembly-20261124`（HEAD `e930178e9acfd1ef03abde1edbaf2c815623d6f4` 上的未提交测试/文档修复）执行：修复前 F1 GREEN、SURVIVED、exit 1；扩展现有缺失用例后 F1 RED、失败名仅含 `表内没有 storage 时结构化不可用`、SUMMARY KILLED、exit 0，脚本逐字节还原并确认基线绿。随后 V1 的等价入口 `pnpm test:file tests/integration/core-storage-assembly.test.js` 实测 tests 2 / pass 2 / fail 0 / skipped 0；无新增用例，原缺失形态和全部拒绝断言保留，额外覆盖 direct-only stray，完整状态及提交读栅栏均不变。`git diff --check` 通过，`git diff --name-only -- packages apps` 为空；不改生产、Host、配置或接口。独立修复复评与最终发布门仍由根协调方完成；此前本地/远端观察保留执行期边界，不把测试护栏修复解释为 R1/UAT 或安装态产品接受。

## Bottom Change Note

- 2026-11-24：创建本计划。由独立评审会话把 .superpowers/iteration12/632 下三份独立设计、brief 与 Lead 决策记录收敛为方案 B 的执行计划；纳入设计期只读证据（base RED 探针、Host 空数据根探针、代码实测、测试基线），确定批次、唯一文件集合、迁移规则与验证矩阵；未改代码/测试/其他文档。
- 2026-11-24：实现 Batch 2–5（本地）：新增判别用例与 Host 回归锁（dc08a62），迁移 47 个测试组合点到 provider 表并修掉 execution-run-refresh 的过期快照陷阱（8d793b6），删除 CoreDeps.storage 与双入口选择式并加入编译期自检（17e93b4），回填 Progress/Surprises/Decision Log/Outcomes 并归档到 completed/。三条提交均可独立回滚；字段删除后的合法回滚单位是「Batch 4 + Batch 2 新用例」或整分支。
- 2026-11-24：独立验收处置（Batch 6）：无 P0/P2；P1-1 交付门交 Lead；补 R5 正控用例（V14）、收窄编译期哨兵表述（S15/D13）、记录 P3-3/P3-4/P3-5 处置（D14），新增 `docs/review/pr-677-mmp-review.md` 并回填 Global Constraints/Decision Log/Outcomes。处置只新增测试、注释与文档，无生产行为变更。

- 2026-11-24：本轮 MMP review `6036636080` 后追加 F1 测试护栏方案、可复现 fallback spec 与直接授权；保持 Completed 并显式保留独立修复复评/最终发布门。
- 2026-11-24：根据条件分支源审撤回 P3-5 Host 注释观察，在本计划的历史 Outcomes/Residual Risk 两处标记 Superseded；记录 #224 的 #633/#632 关闭先后门和 R1/UAT 独立边界。
