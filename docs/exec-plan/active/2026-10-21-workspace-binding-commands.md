# Workspace Binding Commands ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：完成 issue #127：带 actor 与幂等键的三条设置命令——创建工作区、连接 GitHub 账号、把 GitHub Project 绑定为工作区唯一的规划来源；第二个启用规划来源与切换来源都以结构化错误拒绝；controller 进程内重放之外，命令本身按自然键幂等。不含：Host 远程操作与重组（#354）、仓库与 Actions 绑定（#353，叠在本 PR 上）、Host 目录（#355）、UI（#131）、解绑（#368）、切换（#202）、凭据 / 权限 / 可见性三类失败区分（#278）。
> 上游输入：issue #127（正文；2026-10-08 评论的两项已随 #351 重规划移入 #353）、#202、#354、#131；`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`、`docs/adr/ADR-0010-stable-ids-are-route-locators.md`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`；`docs/exec-plan/completed/2026-10-05-connector-account-storage.md`、`docs/exec-plan/completed/2026-10-12-controller-request-identity.md`、`docs/exec-plan/completed/2026-10-15-host-provider-composition.md`；三份设计提案（最小闭环 / 系统 / 业界实践）经独立评审收敛为本计划。
> 执行上下文：分支 `feature/workspace-binding-commands`，工作树 `.worktrees/workspace-binding-commands`，base `main`（设计时观察到 `f131e68`，以 `git rev-parse origin/main` 回读为准）。命令都在该工作树根目录运行，Node 26（`.nvmrc`）在 PATH 上，开始前执行过 `pnpm install --frozen-lockfile`；`gh` 一律带 `-R "$REPO"`（`REPO` 取 `gh repo view --json nameWithOwner -q .nameWithOwner`）。

## Purpose / Big Picture

完成后，core 有存储作用域的 `createWorkspaceSetup(storage)`：三条 create-or-verify 命令在一个 Storage 事务里「读自然键 → 判定 → 写」，写出的正是 Host 恢复时读取的五类事实（工作区、启用的规划挂载、挂载配置、锚点→账号关联、账号句柄）。controller 有独立于 `Controller` 的 `createSetupCommands(setup)`：以 `CommandEnvelope`（`actorRef` + `idempotencyKey`）进入现有的进程内重放账本，成功报 `local_only`（非权威，没有 provider ack 就不出现 `Saved`）。账本丢失后同键重发，命令按自然键找回同一结果、零写入。#353 在同一模式上加仓库绑定，#354 把命令接到 Host 远程操作并重组。

最小成功证据：`tests/integration/workspace-setup-commands.test.js` 在内存替身与 SQLite 文件上全绿，且每条验收用例在对应守卫被删时变红（Progress 记录）；`pnpm run boundaries` 通过；全量测试只有两条已知的 root 失败。

## Context and Orientation

| 术语 | 含义 |
|---|---|
| 设置命令 | 本 PR 的 `createWorkspace` / `connectAccount` / `bindPlanningSource`：只写本地事实，不调用 provider |
| 自然键 | 存储已强制的身份：工作区主键 `id`；账号四元组 `(platformFamily, platformOrigin, identityKind, externalId)`；「工作区的启用规划挂载」（`002_identity_membership.sql` 的部分唯一索引） |
| 连接锚点 / 挂载 | `provider_binding`（跨工作区连接，带实现键与账号 FK）/ `workspace_binding`（工作区挂载，带 domain、enabled、is_default 与配置），ADR-0006 |
| 重放账本 | `packages/controller/src/commands.ts` 的 `createReplayLog`：键 `命令名:幂等键`，完整请求指纹不同即 `conflict`，在途合并，进程内存，不持久 |

当前事实（base `f131e68` 读码核实）：

- F1：Storage 端口已有全部所需写口（`packages/capabilities/src/storage.ts` 的工作区、挂载、账号、关联、配置五组与 `transaction`）。两个实现的事务都串行且整笔回滚（内存替身草稿替换；SQLite 从 `BEGIN IMMEDIATE` 持有到提交）。
- F2：句柄 allowlist、按真实锚点实现键分派的配置 schema、账号自然键唯一都由 Storage 以 `RangeError` + 固定无输入文本强制（`packages/capabilities/src/connector-account.ts`）；`putProviderBinding` 的「第二个启用规划挂载」拒绝却是裸 `Error`（替身）或 UNIQUE 失败（SQLite），不是结构化错误。
- F3：SQLite `putWorkspace` 是 `ON CONFLICT DO UPDATE` 的 upsert，盲写会静默改名。
- F4：Host 只服务一个固定工作区 id（`apps/harness-plugin/src/host.ts` 的 `WORKSPACE_ID`），按该 id `getWorkspace`，缺席即 `unavailableCore('工作区尚未创建')`（`apps/harness-plugin/src/host-composition.ts`）；端口没有 `listWorkspaces`；#354 把多工作区移到 M5。
- F5：Host 恢复路径 `restoreProviders`（`apps/harness-plugin/src/host-providers.ts`）对启用挂载按实现键取目录条目，GitHub Projects 条目要求 github.com 账号带句柄、配置含 `projectNodeId`；`tests/integration/fixtures/host-seed.js` 的 `seedPlanning` 正是命令要写出的行集。
- F6：`createContext` 每次组合都在一个事务里重写工作区与已组合挂载（`packages/core/src/context.ts`）；对规划挂载写的值与本 PR 写的相同（enabled、isDefault 均为 true）。
- F7：唯一持久写账本 `mutation_attempt` 的 `binding_id NOT NULL` 且只有外部写的 `WriteState` 语义（`003_control_facts.sql`）；#306 已拒绝把请求指纹放进持久账本（`docs/exec-plan/completed/2026-10-12-controller-request-identity.md` 方案比较第 2 项）。
- F8：生产代码里没有写 `enabled: false` 规划挂载或调用 `removeProviderBinding` 的路径；#202 定义的「切换」是「旧挂载停用、新挂载启用」，旧来源的投影残留在工作区。
- F9：issue 背景里的 `registerBindings` 已不存在，2026-10-02 起由 `collectBindings` 取代（#197）。

主要不确定性：账本丢失后「同键返回原结果、零写入」是否需要持久回执表？结论：不需要（D2）。三条命令全是本地写、没有「结果未知」态；每个目标都有存储强制的自然键（F1、F2），已提交的行就是结果；回执会成为同一事实的第二份记录，而 `mutation_attempt` 在结构与语义上都不合适（F7）。审阅原型在两种存储上验证了零写入重放与各守卫的判别力（Surprises S5）。

## Design / Spec

### 方案比较

| | A 自然幂等 + 进程内账本（采用） | B 持久命令回执 | C 复用 `mutation_attempt` |
|---|---|---|---|
| 边界 | 只动 core 与 controller，无端口、迁移 | 新端口方法 × 两个实现 + 迁移 008 + 契约套件 + `StorageSurface` 锁 | 改外部写账本的 schema 与语义 |
| 状态拥有 | 业务行是唯一事实 | 业务行 + 回执，两份结果记录 | 本地设置与外部写尝试混在一起 |
| 拒绝后重发 | 账本内返回缓存；账本丢失后按当时状态重判 | 永远返回原拒绝 | — |
| 代价 / 可逆 | 约 490 行代码 + 测试；纯代码回滚 | 再加约 250 行、跨 PR 的迁移版本断言；前向 schema | `binding_id NOT NULL` 容不下前两条命令 |

### 命令规则（#353 沿用同一模式）

每条命令：`assertClosed`（未知字段 → `invalid_input`，例如 `token`）→ 一个 `runSetup` 事务内读自然键 → 相同则返回由行算出的 id、零写入；不同则 `refuse`（事务回滚、结构化错误）；缺席才写。Storage 的 `RangeError` 一律映射为固定文案的 `invalid_input`，文案与 `attemptedValue` 不回显任何输入（粘进句柄字段的令牌不能经结果上 wire）；其它异常原样上抛（Host 的 `guarded` 记诊断）。结果只含 id，账本丢失后由行重算的结果与首次深等。

| 命令 | 发现的状态 | 结果 |
|---|---|---|
| `createWorkspace({ workspaceId, name, statusPolicy })` | 名称空白或策略不在闭集 | `invalid_input` |
| | 无该 id | `putWorkspace` → `{ workspaceId }` |
| | 同 id、同名同策略 | 零写入 → `{ workspaceId }` |
| | 同 id、名或策略不同 | `conflict`（不静默改名，F3） |
| `connectAccount({ 账号四元组, displayName, secretHandle })` | 无同自然键账号 | `newConnectorAccountId()`，`connectionState: 'connected'`，句柄须在 allowlist（否则 `invalid_input`）→ `{ accountId }` |
| | 同自然键、同显示名同句柄 | 零写入 → `{ accountId }` |
| | 同自然键、显示名或句柄不同 | `conflict`（不静默改指凭据） |
| `bindPlanningSource({ workspaceId, accountId, implementationKey, configuration })` | 工作区或账号不存在 | `not_found` |
| | 启用的规划挂载，目标 `(implementationKey, accountId, configuration)` 相同 | 零写入 → `{ bindingId }` |
| | 启用的规划挂载，目标不同 | `conflict`：第二个启用来源（不变量 1，验收 2） |
| | 没有启用的、但有停用的规划挂载 | `not_supported`：这是 #202 定义的切换（验收 3） |
| | 没有规划挂载 | `writeMount`：锚点 + 挂载（`newProviderBindingId()`，enabled、isDefault）→ 账号关联 → 配置 → `{ bindingId }` |

Controller 映射：`ok` → `local_only`；`error.code === conflict` → `conflict`（与账本内同键异请求的写状态一致）；其余 → `failed`。不推进修订号（ADR-0012：快照内容没变）。

不变量（`AGENTS.md` §1.1）：1 由事务内预检 + 存储唯一索引两层保证，并发两次绑定恰好一个成功；3 不写任何规划状态或投影；5 账号↔锚点关联与实现键都是显式输入；7 Storage 是唯一事实源，`workspaceId` 由 Host 给定（不由 UI 铸造），结果非权威；凭据只以句柄落库。依赖方向不变：core 只引 capabilities、domain 与 `node:util`。

刻意不做：回执表 / 迁移 / 端口方法 / ADR；actor 落库（本地写，`AGENTS.md` §7 的审计要求针对外部写）；实现键与能力域的核对（D5）；账号更新或句柄轮换；provider 侧校验（#278）；Host 远程操作与重组（#354）。

### 风险与技术债务

- 拟登记 TD-070（core / controller 设置命令）：幂等键只在一个 `SetupCommands` 实例内保留。账本丢失后，被拒绝的请求同键重发按当时状态重判（典型：`not_found` 的绑定在工作区与账号补齐后成功）；同键异载荷指向另一对象（另一 `workspaceId`、另一账号自然键）按新请求处理。延期理由见 D2。影响：重启后旧键取不回一次拒绝；多出的工作区或账号行是惰性的（Host 只服务固定 id）。下一步：第一条有外部副作用或没有自然键的设置命令出现时，在同一事务写 `(command, key, fingerprint, actor, result)` 回执（方案 B），API 不变。
- 拟登记 TD-071（Host 组合）：Host 不向 `composeCore` 注入 `project`，`readProject` 只能从观察反查；空 Project 没有观察，引导报 `not_found`（`packages/core/src/bootstrap.ts` 的 `readProject` 与 `packages/providers/planning-github-projects/src/provider.ts` 的 `reconcile`）。注入点在 `apps/` 的组合文件，属 #352 / #354 写入区。下一步：#354 组装时由规划挂载配置注入 `project: { bindingId, objectKind: 'project', externalId: projectNodeId, url: undefined }` 并补空 Project 用例。
- R1：#202 / #368 之前规划来源是一次性的：格式合法但错误的 `projectNodeId` 无法在产品内改正，demo 的恢复手段是换新数据根。验收 3 要求如此；demo 脚本与 #131 文案需提示。
- R2：`connected` 只表示已登记、未验证（#278）。R3：实现键与能力域、账号平台与挂载的匹配只在恢复时检查（不合格挂载被禁用），#354 必须由 Host 目录固定实现键（D5）。R4：账本缓存拒绝结果，#131 每次用户尝试要用新键。R5：若 #368 改为删除挂载行，切换守卫看不到旧来源；#368 须保持「#202 之前拒绝卸载规划挂载」。R6：C→D 堆叠，Batch 1 推送后冻结 `Interfaces and Dependencies` 的签名。

## Global Constraints

- 本 PR 只写这些文件（估计行数；代码 + 测试 ≤ 800，文档 ≤ 1300）：`packages/core/src/workspace-setup.ts`（新，约 130）、`packages/core/src/index.ts`（+1 行命名再导出）、`packages/controller/src/commands.ts`（约 +45）、`tests/integration/workspace-setup-commands.test.js`（新，约 300）、本 ExecPlan、`docs/product/vertical-path.md` §2.1 第 1、2 行与简称表、`docs/exec-plan/tech-debt-tracker.md`（TD-070、TD-071）、`docs/README.md` 索引一行。
- 不改：`apps/**`（#352、#229 并行）、`packages/capabilities`、`packages/storage/**`、`packages/providers/**`、迁移、`tests/integration/fixtures/host-seed.js`（只读引用）、`packages/controller/src/index.ts`（已 `export *`）。不新增 Storage 端口方法、迁移或 ADR（Gate E1 前不冻结模型）。
- Node 以 strip-only 方式执行 TS：不用参数属性、`enum`、`namespace`（审阅原型实测 `constructor(readonly x)` 报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）；包内相对导入带 `.ts`。
- 测试不触网：GitHub 一律用 `host-seed.js` 的 `replayFetch`；令牌哨兵沿用 `ghp_CANARY_…` 这类含下划线的值，不得匹配 `scripts/rule-checks.mjs` 的 `DISCLOSURE_PATTERNS`。
- TDD：每批先写会失败的判别性测试；文档正文中文，标识符与命令英文；提交 `<type>(<scope>): <中文摘要>`，正文末尾 `Refs #127`（最后一个提交 `Closes #127`）；不推 `main`、不自行合并；发布面按 `docs/development/publication.md` 扫描。

## Plan of Work

### Batch 1 · core 设置命令（建议 Opus，中高推理：状态拥有、事务与不变量 1）

**最小闭环**：三条命令在两种存储上满足验收 1、2、3、5 与原子性。
**涉及文件**：`packages/core/src/workspace-setup.ts`、`packages/core/src/index.ts`、`tests/integration/workspace-setup-commands.test.js`。

- [ ] 测试文件骨架：`for (const kind of ['memory', 'sqlite'])`；`openStore(kind)` 返回 `{ storage, reopen(), snapshot(), scan(needle) }`——内存替身用 `createFakeStorage(emptyStorageData(), hostStoragePolicy(PROVIDER_CATALOG))`，`reopen` 经 `exportFakeStorageState` 导入新实例，`snapshot` / `scan` 读导出 JSON；SQLite 用 `mkdtemp` 下的文件与同一策略，`reopen` 关闭后重开，`snapshot` 用 `host-seed.js` 的 `dump`，`scan` 统计数据目录全部文件（含 `-wal`、`-shm`）里原文与 base64 的出现次数。`writeSpy(storage)`：Proxy 记录 storage 与 `transaction` 回调里 `tx` 的 `put*/set*/remove*/replace*/advance*/record*` 调用。
- [ ] 写 `Validation and Acceptance` 中 AC1、AC2、AC3、AC5 与「原子性」五条用例（经 `createWorkspaceSetup`），先跑出红。
- [ ] 实现 `workspace-setup.ts`（规则见 Design，签名见 Interfaces）；`index.ts` 只命名再导出 `createWorkspaceSetup` 与公开类型，模式辅助函数不进包入口。
- [ ] 变异核对并把每条的变红用例记入 Progress：M1 删掉启用挂载目标不同时的 `conflict` 分支（AC2 以裸 `Error` / UNIQUE 拒绝而变红）；M2 把停用挂载的 `not_supported` 改成 `conflict`、M3 删掉该分支（AC3 变红）；M4 去掉 `setProviderBindingAccount`（AC1 的 `disabled` 非空）；M5 去掉 `connectAccount` 的 `assertClosed`（AC5 的 `token` 被静默丢弃而成功）；M6 把配置写入挪到第二个 `runSetup`（原子性留下孤儿挂载）。

**验证**：

```bash
node --test tests/integration/workspace-setup-commands.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 红（实现前）：模块不导出 createWorkspaceSetup，ℹ fail 1
# 绿：ℹ tests 10、ℹ fail 0
pnpm run typecheck    # 期望：退出码 0
pnpm run boundaries   # 期望：ℹ fail 0
```

**回滚**：`git revert` 本批提交；没有 schema 或数据迁移。

### Batch 2 · controller 设置命令与账本丢失后的重放（建议 Sonnet，中推理）

**最小闭环**：`createSetupCommands` 以信封进入重放账本，验收 4 在两种存储上成立。
**涉及文件**：`packages/controller/src/commands.ts`、`tests/integration/workspace-setup-commands.test.js`（追加）。

- [ ] 追加 AC4 两条用例（`Validation and Acceptance`），先跑出红（模块不导出 `createSetupCommands`）。
- [ ] 在 `commands.ts` 实现 `createSetupCommands(setup)`：每个实例一个 `createReplayLog()`，三条命令都走 `replay(name, input, requestPayload(input), …)`，用 Design 的映射；复用模块内的 `resultOf`、`requestPayload`，不改 `createControllerCommands` 与 `Controller`。
- [ ] 变异核对：M7 `createWorkspace` 改成先读后无条件 `putWorkspace`（AC4 的写入计数非零）；M8 `createSetupCommands` 绕过 `replay`（「账本内同键异请求」变红）。

**验证**：

```bash
node --test tests/integration/workspace-setup-commands.test.js tests/e2e/controller-roundtrip.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 期望：ℹ fail 0；新文件 13 条全部 ✔，controller-roundtrip 不变
pnpm run typecheck && pnpm run boundaries   # 期望：退出码 0，ℹ fail 0
```

**回滚**：`git revert` 本批提交（Batch 1 仍独立成立）。

### Batch 3 · 文档、门禁与 draft PR（建议 Sonnet，低推理）

**最小闭环**：矩阵、债务与索引与代码同 PR 更新，门禁全过。
**涉及文件**：`docs/product/vertical-path.md`、`docs/exec-plan/tech-debt-tracker.md`、`docs/README.md`、本 ExecPlan。

- [ ] `vertical-path.md` §2.1：简称表加 `workspace-setup-commands`；第 1、2 行的生产入口改为 `createWorkspaceSetup` + controller `createSetupCommands`（Host 尚未暴露，#354），成功 / 失败形态引用 AC1–AC5 前缀，结论如实写「部分：命令已有，Host 与 UI 未接（#354、#131）」，承接去掉 #127。按该节「用例回读」命令逐个回读新前缀与负对照。
- [ ] tracker 追加 TD-070、TD-071（内容见 Design「风险与技术债务」）；`docs/README.md` 加本计划一行（Active）。
- [ ] 跑门禁；整理提交；开 draft PR（`Closes #127`、ExecPlan + Batch、验证证据、风险、回滚）；回读 PR 的 head、base、issue 关联与 checks。

**验证**：

```bash
pnpm run typecheck && pnpm run boundaries
pnpm run test 2>&1 | grep -E '^✖ ' | sort -u
# 期望（root 运行）：除 `✖ failing tests:` 汇总头外只有两条已知标题——tests/integration/development-local-git.test.js「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」
#   与 tests/contract/run-test-layer.test.js「真实层 tests/integration：非空、全绿，且摘要行被透传」（后者只因前者而红）；任何其它失败都不是已知项
#   （base 实测 2026-10-21 @ f131e68：ℹ tests 1696、ℹ fail 2；本 PR 之后 tests 增加 13、fail 仍为 2）
runuser -u <非 root 用户> -- env "PATH=$PATH" node --test tests/integration/development-local-git.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 期望：ℹ tests 73、ℹ fail 0（证明上面两条只是 root 的 chmod 000 仍可读）
pnpm run test:mvp0 2>&1 | grep -E '^ℹ fail'   # `pnpm verify` 在 test 失败时短路，root 下单独跑；期望：ℹ fail 0
node scripts/workflow-check.mjs && node scripts/rule-checks.mjs disclosure origin/main && node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD           # 期望：无输出；size 报告的代码 + 测试 ≤ 800、文档 ≤ 1300
```

**回滚**：文档提交单独 `git revert`。

并行性：Batch 2 依赖 Batch 1 的导出且共写测试文件，必须串行；Batch 3 的文档编辑与 Batch 2 文件不相交，可在 Batch 1 推送后并行起草，但门禁只在 Batch 2 完成后跑。

## Validation and Acceptance

测试都在 `tests/integration/workspace-setup-commands.test.js`，`<kind>` 为 `memory` 与 `sqlite`；命令 `node --test tests/integration/workspace-setup-commands.test.js`。

| # | 验收项（issue #127） | 用例标题前缀 → 判定证据 |
|---|---|---|
| 1 | 经命令建工作区并绑定 Project，下一次引导读到该项目（两种存储） | 「AC1 命令建工作区并绑定 GitHub Project：下一次组合的引导读到该项目（<kind>）」：三条命令 → `reopen` → `restoreProviders(storage, WORKSPACE, PROVIDER_CATALOG, { fetch: replayFetch().fetch, … })` 得 `disabled` 为 `[]` → 以库中工作区 `composeCore` → `commands.bootstrapWorkspace()` 得 `{ ok: true, entities: 9, workItems: 8, changeRequests: 1, unanchored: 0 }`，回放 `misses` 为 `[]` |
| 2 | 第二个启用规划绑定返回结构化错误且不改任何东西 | 「AC2 已有启用的规划来源时再绑定：conflict 且零写入（<kind>）」：换 `projectNodeId` 再绑定得 `error.code === 'conflict'`，写入计数 0，`snapshot` 前后相等；同一用例里对新工作区并发绑定两个项目，恰好一个 ok、一个 `conflict`、一个规划挂载 |
| 3 | #202 之前切换规划来源以结构化错误拒绝 | 「AC3 只剩停用的规划挂载时绑定视为切换：not_supported 且零写入（<kind>）」：经端口把已绑挂载写成 `enabled: false, isDefault: false`（F8：生产尚无此路径），再绑定另一项目得 `not_supported`，写入计数 0，`snapshot` 不变 |
| 4 | 同键重发返回原结果且零写入，账本丢失后亦然 | 「AC4 账本丢失后同键重放：结果与首次深等、零写入（<kind>）」：经 `createSetupCommands` 跑三条命令与一次被拒的再绑定（`conflict`）→ `reopen` → 新的 `createSetupCommands` 同键同请求重发：四个 `CommandResult` 与首次 `deepEqual`，写入计数 0，`snapshot` 不变；同键改名重发 `createWorkspace` 得 `conflict` 且名称不变。「AC4 账本内同键异请求：conflict 且不进 core」：同一实例同键换 `externalId` 得 `writeState: 'conflict'`，`WorkspaceSetup` 调用计数不变。被拒请求在状态变化后重判属 TD-070 的已知残余（D2） |
| 5 | 凭据只以 Host 句柄存储，令牌不进项目库 | 「AC5 凭据只以句柄落库（<kind>）」：带 `token` 字段的 `connectAccount` 得 `invalid_input` 且写入计数 0（闭集检查先于任何写）；以令牌哨兵作 `secretHandle` 得 `invalid_input`、结果 JSON 不含哨兵、`snapshot` 不变（写入被 allowlist 拒绝并回滚）；完整流程以 `resolveCredential` 返回哨兵组合引导后，回放请求头均为 `bearer <哨兵>`，`scan(哨兵)` 与 `scan(base64(哨兵))` 为 0、`scan(HANDLE)` ≥ 1 |
| 6 | `pnpm run boundaries` 通过 | `pnpm run boundaries` → `ℹ fail 0` |
| — | 原子性（#353 继承的事务模式） | 「原子性：配置不合 schema 或父行缺失时不留任何行（<kind>）」：`projectNodeId: 'not-a-node'` 得 `invalid_input`，未知工作区得 `not_found`，`snapshot` 均不变 |

## Progress

- [x] 2026-10-21 设计评审完成：三份提案经独立评审收敛；审阅原型（仓库外）在两种存储上 4 / 4 通过，6 个守卫变异各自变红（S5）。
- [ ] Batch 1 · core 设置命令（含 M1–M6 变异记录）
- [ ] Batch 2 · controller 设置命令与账本丢失后的重放（含 M7–M8）
- [ ] Batch 3 · 文档、门禁与 draft PR

## Surprises & Discoveries

- S1：issue 引用的 `registerBindings` 已被 `collectBindings` 取代（F9），组合期仍是挂载的第二个写者，但对规划挂载写同值（F6）。
- S2：第二个启用规划挂载在存储层是裸异常而非结构化错误（F2），所以必须在事务内预检；SQLite 的工作区写是 upsert（F3），所以必须先读。
- S3：空 GitHub Project 在 Host 路径下引导得 `not_found`（`bootstrap.ts` 的 `readProject` 在没有注入 `project` 且没有观察时返回「没有可发现的规划项目」）→ TD-071。验收 1 的录制夹具非空，不受影响。
- S4：#353 的设计提案假设本 PR 提供持久的 `runIdempotent` 结果表（其假设 A2）；本计划 D2 不提供，#353 应改用 `runSetup` 与自然键（Interfaces）。
- S5：审阅原型（仓库外，Node 26）：最终设计在内存替身与 SQLite 文件上 4 / 4 通过，`tsc --noEmit` 通过；去掉账号关联、改成盲 upsert、去掉闭集检查、去掉 conflict 分支、去掉 not_supported 分支、把两者合并成 conflict，六个变异各自使对应断言变红；参数属性语法在 strip-only 下不可用。

## Decision Log

以下决策日期均为 2026-10-21，作者：设计评审（Claude Opus，独立评审 subagent）；人类可推翻。

- **D1 工作区 id 由调用方给定**（采纳系统 / 业界提案，否决最小提案的 `sha256(actor, key)` 派生）。证据：Host 只按固定 `WORKSPACE_ID` 读取、端口无 `listWorkspaces`（F4），派生 id 会让下一次组合找不到工作区；#354 与 #131 都只服务单工作区；ADR-0010 禁止可由用户内容验证派生的 `WorkspaceId`。取舍：幂等不再依赖键派生，同 id 本身就是自然键；#354 必须由 Host 填入固定 id，不接受 UI 传值。
- **D2 自然幂等 + 进程内账本，不建回执表**（三份提案一致）。证据：issue 范围写明「naturally idempotent as well as replayed」；F1、F2、F7；#306 已拒绝持久指纹账本；业界：Stripe 只在端点开始执行后保存结果，校验失败与并发冲突不保存、可重试，键保留至少 24 小时后按新请求处理；AWS client token 同参数为无操作、异参数为 `IdempotentParameterMismatch`；Brandur 的设计里只含本地变更的请求是一个原子阶段、无需恢复点。验收 4 的解释：成功命令与「状态未变时的拒绝」在账本丢失后都返回原结果、零写入（有测试）；「状态已变后的拒绝」重判是可接受残余（TD-070）：被拒那次没有写入，之后的成功是唯一一次副作用。此解释需人类确认。
- **D3 `conflict` 与 `not_supported` 的边界**（采纳最小 / 业界提案，否决系统提案的「同连接换配置也算切换」）。证据：#202 的切换定义是「旧挂载停用、新挂载启用」（F8）；锚点 id 随机生成时，存在启用挂载而目标不同就意味着第二个启用挂载。规则：有启用规划挂载且目标不同 → `conflict`；无启用、有停用 → `not_supported`。两条各有删掉即红的用例（M1、M3），合并成一个码也会被 AC3 抓到（M2）。
- **D4 锚点与账号 id 随机生成，靠事务内自然键查找去重**（否决系统提案的 `connectionIdFor` / `accountIdFor` 派生）。理由：两种存储的事务串行，自然键查找已保证重复请求得到同一 id；ADR-0006 的「同账号一条锚点」前提只在多工作区共享连接时起作用，不在任何验收内（YAGNI）；`writeMount` 由调用方传 id，#353 需要时可自行决定派生。
- **D5 core 不核对实现键是否提供规划域**（否决最小提案的 `definitions` 依赖）。证据：错误实现键的挂载在恢复时被禁用（`restoreProviders` 的「实现不提供这个挂载的能力域」），#354 的 Host 操作由目录固定实现键，产品内不可达；被卡住的规划槽位与「格式合法但错误的 `projectNodeId`」恢复手段相同（R1），单独防一种原因收益低。代价是 core API 被误用时只在恢复时暴露（R3）。
- **D6 controller 用独立的 `SetupCommands`，不加进 `Controller`**（三份提案一致）。理由：工作区未创建时 Host 的 `Controller` 建在 `unavailableCore` 上；独立对象可由 #354 每进程建一次、跨重组保留账本；不触碰 #352、#229 的 `apps/` 文件。
- **D7 验收 1 用 `restoreProviders` + `composeCore` 证明**，与 `host-composition.ts` 的组合步骤相同；不调 `createHostComposition`（#352 正在改它），Host 级证明属 #354 验收 1。空 Project 缺口记 TD-071。
- **D8 请求字段全部必填、结果只含 id**（采纳业界提案）：缺省值会让同一意图有两种指纹；只含 id 的结果在账本丢失后可由行逐字重算。
- **D9 不写 ADR，模式辅助函数不从 core 包入口再导出**：本 PR 没有新依赖边、跨层或第二权威源（`AGENTS.md` §2），决策可纯代码回滚；#353 在 core 内以相对路径引用辅助函数，controller 与 Host 只见命令。

## Idempotence and Recovery

- 运行期：三条命令可任意重发；同请求零写入，失败整笔回滚，不留半写行（AC2、AC3、原子性）。
- 测试：每条用例在自己的 `mkdtemp` 目录或内存实例上运行，可重复执行；不构建插件产物。若排查时运行过 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，先删 `apps/harness-plugin/dist`，否则 `tests/e2e/delivery-lineage.test.js` 会因扫描 `apps/**` 变红（#350）。
- Git：每批一个可独立回滚的提交；整理提交或重推前先建 backup ref，再用精确的 `--force-with-lease`；复杂改写走 `git-expert-operations` 流程。回到已知良好状态：`git revert` 对应批次，或把分支重置到 backup ref。
- 数据：没有迁移；命令写出的行与 `seedPlanning` 同形，Host 已能读，回滚代码不需要修数据。

## Interfaces and Dependencies

`packages/core/src/workspace-setup.ts`（`index.ts` 只再导出 `SetupOutcome`、三个请求类型、`WorkspaceSetup` 与 `createWorkspaceSetup`）：

```ts
export type SetupOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProjectError }
export interface CreateWorkspaceRequest { readonly workspaceId: WorkspaceId; readonly name: string; readonly statusPolicy: StatusPolicy }
export interface ConnectAccountRequest extends ConnectorAccountIdentity { readonly displayName: string; readonly secretHandle: string }
export interface BindPlanningSourceRequest {
  readonly workspaceId: WorkspaceId; readonly accountId: ConnectorAccountId
  readonly implementationKey: string; readonly configuration: Readonly<Record<string, string | boolean>>
}
export interface WorkspaceSetup {
  createWorkspace(request: CreateWorkspaceRequest): Promise<SetupOutcome<{ readonly workspaceId: WorkspaceId }>>
  connectAccount(request: ConnectAccountRequest): Promise<SetupOutcome<{ readonly accountId: ConnectorAccountId }>>
  bindPlanningSource(request: BindPlanningSourceRequest): Promise<SetupOutcome<{ readonly bindingId: ProviderBindingId }>>
}
export function createWorkspaceSetup(storage: Storage): WorkspaceSetup
// 模式辅助函数（#353 在 core 内经 './workspace-setup.ts' 引用）：
/** 一个 Storage 事务；work 内 refuse 回滚并返回 { ok: false }；Storage RangeError → 固定文案 invalid_input；其余异常上抛。 */
export function runSetup<T>(storage: Storage, work: (tx: StorageTransaction) => Promise<T>): Promise<SetupOutcome<T>>
export function refuse(code: ProjectErrorCode, message: string): never
/** 非普通对象或含 allowed 之外的键 → refuse(invalid_input)，文案不含键名与值。 */
export function assertClosed(request: unknown, allowed: readonly string[]): void
export interface MountTarget {
  readonly implementationKey: string; readonly accountId: ConnectorAccountId | undefined
  readonly configuration: Readonly<Record<string, string | boolean>>
}
export function readMountTarget(tx: StorageTransaction, mount: ProviderBindingRecord): Promise<MountTarget>
/** 锚点 + 挂载 → 账号关联（accountId 有值时）→ 配置；只能在 runSetup 的事务内调用。 */
export function writeMount(tx: StorageTransaction, mount: Omit<ProviderBindingRecord, 'implementationKey'>, target: MountTarget): Promise<void>
```

`packages/controller/src/commands.ts`（经 `index.ts` 的 `export *` 公开）：

```ts
export type CreateWorkspaceInput = CommandEnvelope & CreateWorkspaceRequest
export type ConnectAccountInput = CommandEnvelope & ConnectAccountRequest
export type BindPlanningSourceInput = CommandEnvelope & BindPlanningSourceRequest
export interface SetupCommands {
  createWorkspace(input: CreateWorkspaceInput): Promise<CommandResult<{ readonly workspaceId: WorkspaceId }>>
  connectAccount(input: ConnectAccountInput): Promise<CommandResult<{ readonly accountId: ConnectorAccountId }>>
  bindPlanningSource(input: BindPlanningSourceInput): Promise<CommandResult<{ readonly bindingId: ProviderBindingId }>>
}
export function createSetupCommands(setup: WorkspaceSetup): SetupCommands
```

下游契约：

- #353：`bindRepository` 是 `WorkspaceSetup` 的新成员（存储作用域，请求带 `workspaceId`），在一个 `runSetup` 里完成；Development / Delivery 挂载用 `writeMount`（id 与 `isDefault` 由 #353 决定），相同挂载用 `readMountTarget` + `isDeepStrictEqual` 判定零写入；controller 侧作为 `SetupCommands` 的成员加在 `createSetupCommands` 内，共用同一个 `replay`。不引入持久结果表（S4）。
- #354：Host 每进程建一次 `createSetupCommands(createWorkspaceSetup(storage))` 并跨重组持有；远程操作填入固定 `WORKSPACE_ID` 与目录中提供 planning 域的实现键，不接受 UI 传这两个值；`ok` 后重组，并按 TD-071 注入 `project`。
- #131：每次用户尝试铸造新幂等键（R4）；按 `ProjectError.recovery` 渲染。

依赖：Node 26（`.nvmrc`）、`pnpm install --frozen-lockfile`；只读引用 `apps/harness-plugin/src/host-providers.ts`（`PROVIDER_CATALOG`、`hostStoragePolicy`、`restoreProviders`）与 `tests/integration/fixtures/host-seed.js`（`WORKSPACE`、`HANDLE`、`projectNodeId`、`replayFetch`、`dump`，背后是 `tests/contract/fixtures/github-projects/` 的录制）。无凭据、无网络；`gh` 只用于 issue / PR 的仓库 REST。

## Outcomes & Retrospective

未开始。

## Bottom Change Note

- 2026-10-21：创建。设计评审（Claude Opus，独立评审 subagent）把三份提案收敛为本计划，决策见 D1–D9。
