# Workspace Binding Commands ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：完成 issue #127：带 actor 与幂等键的三条设置命令——创建工作区、连接 GitHub 账号、把 GitHub Project 绑定为工作区唯一的规划来源；第二个启用规划来源与切换来源都以结构化错误拒绝；controller 进程内重放之外，命令本身按自然键幂等。不含：Host 远程操作与重组（#354）、仓库与 Actions 绑定（#353，叠在本 PR 上）、Host 目录（#355）、UI（#131）、解绑（#368）、切换（#202）、凭据 / 权限 / 可见性三类失败区分（#278）。另含独立验收的三项 P3（#375、#376、#384），按人类决定在本 PR 内实现（D13）：#375、#376 由本 PR 关闭；#384 的验收覆盖 `bindPlanningSource` 与 `bindRepository` 两条命令，本 PR 只实现共享的 `sameMountTarget` 与 `bindPlanningSource` 一半（Refs #384），由交付 `bindRepository` 的 #373 关闭（D15）。
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

每条命令：`assertClosed`（未知字段 → `invalid_input`，例如 `token`）→ 一个 `runSetup` 事务内读自然键 → 相同则返回由行算出的 id、零写入；不同则 `refuse`（事务回滚、结构化错误）；缺席才写。Storage **写口**的 `RangeError`（存储校验拒绝）映射为固定文案的 `invalid_input`，文案与 `attemptedValue` 不回显任何输入（粘进句柄字段的令牌不能经结果上 wire）；读口的 `RangeError`（库里的坏行）、程序错误与其它异常原样上抛（Host 的 `guarded` 记诊断，#376）。目标「相同」只由 `sameMountTarget` 判定：深等，但配置按值比较、不比原型（#384）。结果只含 id，账本丢失后由行重算的结果与首次深等。

| 命令 | 发现的状态 | 结果 |
|---|---|---|
| `createWorkspace({ workspaceId, name, statusPolicy })` | 名称空白或策略不在闭集 | `invalid_input` |
| | 无该 id | `putWorkspace` → `{ workspaceId }` |
| | 同 id、同名同策略 | 零写入 → `{ workspaceId }` |
| | 同 id、名或策略不同 | `conflict`（不静默改名，F3） |
| `connectAccount({ 账号四元组, displayName, secretHandle })` | 无同自然键账号 | `newConnectorAccountId()`，`connectionState: 'connected'`，句柄须在 allowlist（否则 `invalid_input`）→ `{ accountId }` |
| | 同自然键、同显示名同句柄 | 零写入 → `{ accountId }` |
| | 同自然键、显示名或句柄不同 | `conflict`（不静默改指凭据） |
| `bindPlanningSource({ workspaceId, accountId, implementationKey, configuration })` | 实现键不是非空字符串或配置不是普通对象 | `invalid_input`（先于任何读写，D15） |
| | 工作区或账号不存在 | `not_found` |
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

- [x] 测试文件骨架：`for (const kind of ['memory', 'sqlite'])`；`openStore(kind)` 返回 `{ storage, reopen(), snapshot(), scan(needle) }`——内存替身用 `createFakeStorage(emptyStorageData(), hostStoragePolicy(PROVIDER_CATALOG))`，`reopen` 经 `exportFakeStorageState` 导入新实例，`snapshot` / `scan` 读导出 JSON；SQLite 用 `mkdtemp` 下的文件与同一策略，`reopen` 关闭后重开，`snapshot` 用 `host-seed.js` 的 `dump`，`scan` 统计数据目录全部文件（含事务期的 `-journal`；存储未启用 WAL）里原文与 base64 的出现次数。`writeSpy(storage)`：Proxy 记录 storage 与 `transaction` 回调里 `tx` 的 `put*/set*/remove*/replace*/advance*/record*` 调用。
- [x] 写 `Validation and Acceptance` 中 AC1、AC2、AC3、AC5 与「原子性」五条用例（经 `createWorkspaceSetup`），先跑出红。
- [x] 实现 `workspace-setup.ts`（规则见 Design，签名见 Interfaces）；`index.ts` 只命名再导出 `createWorkspaceSetup` 与公开类型，模式辅助函数不进包入口。
- [x] 变异核对并把每条的变红用例记入 Progress：M1 删掉启用挂载目标不同时的 `conflict` 分支（AC2 以裸 `Error` / UNIQUE 拒绝而变红）；M2 把停用挂载的 `not_supported` 改成 `conflict`、M3 删掉该分支（AC3 变红）；M4 去掉 `setProviderBindingAccount`（AC1 的 `disabled` 非空）；M5 去掉 `connectAccount` 的 `assertClosed`（AC5 的 `token` 被静默丢弃而成功）；M6 把配置写入挪到第二个 `runSetup`（原子性留下孤儿挂载）。

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

- [x] 追加 AC4 两条用例（`Validation and Acceptance`），先跑出红（模块不导出 `createSetupCommands`）。
- [x] 在 `commands.ts` 实现 `createSetupCommands(setup)`：每个实例一个 `createReplayLog()`，三条命令都走 `replay(name, input, requestPayload(input), …)`，用 Design 的映射；复用模块内的 `resultOf`、`requestPayload`，不改 `createControllerCommands` 与 `Controller`。
- [x] 变异核对：M7 `createWorkspace` 改成先读后无条件 `putWorkspace`（AC4 的写入计数非零）；M8 `createSetupCommands` 绕过 `replay`（「账本内同键异请求」变红）。

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

- [x] `vertical-path.md` §2.1：简称表加 `workspace-setup-commands`；第 1、2 行的生产入口改为 `createWorkspaceSetup` + controller `createSetupCommands`（Host 尚未暴露，#354），成功 / 失败形态引用 AC1–AC5 前缀，结论如实写「部分：命令已有，Host 与 UI 未接（#354、#131）」（评审修复补回原缺口「列表与选择」，见 D15），承接去掉 #127。按该节「用例回读」命令逐个回读新前缀与负对照。（2026-10-21 完成：七个前缀都读回 ✔ 与 `ℹ fail 0`，伪造前缀读回 `ℹ tests 0`；第 2 行由未交付升为部分，证据见 D11；两行承接加 #354。）
- [x] tracker 追加 TD-070、TD-071（内容见 Design「风险与技术债务」）；`docs/README.md` 的本计划索引行由协调者已加，不在本批提交内。
- [x] 跑门禁并提交（结果见 `Validation and Acceptance` 的「验证证据」）。
- [ ] push、PR #371 描述（`Closes #127`、ExecPlan + Batch、验证证据、风险、回滚）与 head、base、issue 关联、checks 的回读：本批不 push，由协调者执行。

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
| 2 | 第二个启用规划绑定返回结构化错误且不改任何东西 | 「AC2 已有启用的规划来源时再绑定：conflict 且零写入（<kind>）」：换 `projectNodeId` 再绑定、同一项目换账号再绑定都得 `error.code === 'conflict'`，同值的空原型配置重放返回原 `bindingId`（#384），写入计数 0，`snapshot` 前后相等；同一用例里对新工作区（先挂一个启用的 `development` 挂载，非规划域不占槽位）并发绑定两个项目，恰好一个 ok、一个 `conflict`、一个规划挂载（换账号与非规划挂载两条由独立验收补，S11） |
| 3 | #202 之前切换规划来源以结构化错误拒绝 | 「AC3 只剩停用的规划挂载时绑定视为切换：not_supported 且零写入（<kind>）」：经端口把已绑挂载写成 `enabled: false, isDefault: false`（F8：生产尚无此路径），再绑定另一项目得 `not_supported`，写入计数 0，`snapshot` 不变 |
| 4 | 同键重发返回原结果且零写入，账本丢失后亦然（2026-10-21 按 D16 改写为：成功命令账本丢失后亦然；被拒请求只在账本存活期间重放，重启后按当时状态重判、前置条件已满足时成功且只写一次；账本丢失后同键指向另一目标是新请求） | 「AC4 账本丢失后同键重放：结果与首次深等、零写入（<kind>）」：经 `createSetupCommands` 跑三条命令与一次被拒的再绑定（`conflict`）→ `reopen` → 新的 `createSetupCommands` 同键同请求重发：四个 `CommandResult` 与首次 `deepEqual`，写入计数 0，`snapshot` 不变；同键改名或改状态策略重发 `createWorkspace`、同键换显示名或句柄重发 `connectAccount` 都得 `conflict` 且 `snapshot` 不变（换显示名 2026-10-21 补，S7；改策略、换句柄由独立验收补，S11）。「AC4 账本内同键异请求：conflict 且不进 core」：同一实例同键换 `externalId` 得 `writeState: 'conflict'`，`WorkspaceSetup` 调用计数不变。新措辞后加的三句由「AC4 账本丢失后同键重放」末尾的断言判定（第二轮评审补）：一个新实例里绑定到缺失的 `OTHER_WORKSPACE` 得 `not_found`；另一新实例以同键 `workspace-1` 建出 `OTHER_WORKSPACE`（账本丢失后同键换目标是新请求，得 `local_only` 与新工作区，也补齐了前置条件）；回到前一个实例同键重发，结果与原拒绝 `deepEqual`（账本存活时只重放拒绝）；换实例同键重发得 `local_only`，写入计数恰为一次挂载（`putProviderBinding`、`setProviderBindingAccount`、`putBindingConfiguration`），该工作区只有这一个挂载；再换实例重发与之 `deepEqual`、写入计数 0。变异 R1（`createReplayLog` 不缓存设置命令带 `error` 的结果）因此在两种存储上变红 |
| 5 | 凭据只以 Host 句柄存储，令牌不进项目库 | 「AC5 凭据只以句柄落库（<kind>）」：带 `token` / `secret` 字段的三条命令都得 `invalid_input` 且写入计数 0（闭集检查先于任何写；另两条命令由独立验收补，S11）；自有键全在闭集内、`token` 挂在原型上的三条命令同样 `invalid_input`、零写入（原型检查，#375）；以令牌哨兵作 `secretHandle` 得 `invalid_input`、结果 JSON 不含哨兵、`snapshot` 不变（写入被 allowlist 拒绝并回滚）；完整流程以 `resolveCredential` 返回哨兵组合引导后，回放请求头均为 `bearer <哨兵>`，`scan(哨兵)` 与 `scan(base64(哨兵))` 为 0、`scan(HANDLE)` ≥ 1 |
| 6 | `pnpm run boundaries` 通过 | `pnpm run boundaries` → `ℹ fail 0` |
| — | 原子性（#353 继承的事务模式） | 「原子性：配置不合 schema 或父行缺失时不留任何行（<kind>）」：`projectNodeId: 'not-a-node'` 得 `invalid_input`，未知工作区得 `not_found`，`snapshot` 均不变；缺实现键、配置为数组的绑定得 `invalid_input` 且写入计数 0（先于任何读写；缺实现键原先在 SQLite 上是 NOT NULL 驱动异常，评审修复补，D15） |
| — | 存储校验之外的 `RangeError` 不报 `invalid_input`（#376） | 「存储读口的 RangeError 原样上抛：库里的坏行与程序错误不是 invalid_input」：写入探针让 `getConnectorAccount` / `listConnectorAccounts` 抛 `RangeError`，`connectAccount` 与 `bindPlanningSource` 都以该异常失败，而不是 `{ ok: false }` 的 `invalid_input`；只跑内存替身（注入点在存储之上，与实现无关）。写口拒绝仍得同一个固定错误值由「原子性」与 AC5 判定 |

### 验证证据（Batch 3 门禁，2026-10-21）

在检出 `feature/workspace-binding-commands` 的工作树根目录运行，root 用户，Node v26.12.0，base `origin/main` @ `f131e68`（`git rev-parse origin/main` 回读一致）；文档改动（tracker、`vertical-path.md`）之后、本节写入之前的树。输出只留判据行。

```text
$ pnpm run typecheck                      -> 退出码 0
$ pnpm run boundaries                     -> ℹ tests 9 / ℹ pass 9 / ℹ fail 0
$ pnpm run test 2>&1 | grep -E '^ℹ (tests|pass|fail)|^✖ ' | sort -u    （root）
ℹ fail 2
ℹ pass 1707
ℹ tests 1709
✖ failing tests:
✖ 拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功
✖ 真实层 tests/integration：非空、全绿，且摘要行被透传
$ runuser -u <非 root 用户> -- env PATH=<node 26 的 bin>:/usr/bin:/bin HOME=<该用户的家目录> \
    node --test tests/integration/development-local-git.test.js   -> ℹ tests 73 / ℹ pass 73 / ℹ fail 0
$ pnpm run test:mvp0                      -> ℹ tests 7 / ℹ pass 7 / ℹ fail 0
$ node scripts/workflow-check.mjs         -> workflow-check: no findings（已检查 8 个文件）
$ node scripts/rule-checks.mjs disclosure origin/main   -> 退出码 0，「均未命中任何已知模式」
$ git diff --check origin/main...HEAD     -> 无输出，退出码 0
```

- 全量测试：`ℹ tests 1709`（base 实测 1696 加本 PR 新文件的 13 条），`ℹ fail 2` 且恰为 root 下已知的两条：前者因 `chmod 000` 对 root 仍可读，后者只因前者而红；非 root 用户重跑前者所在文件 73 / 73 通过，证明两条都是环境因素。没有其它失败。
- `vertical-path.md` 回读（第 1、2 行引用的七个前缀，命令即该节「用例回读」；内存替身与 SQLite 各一条的前缀读回两行 ✔）：

  | 前缀 | `ℹ tests` / `ℹ fail` |
  |---|---|
  | AC1 命令建工作区并绑定 GitHub Project | 2 / 0 |
  | AC2 已有启用的规划来源时再绑定 | 2 / 0 |
  | AC3 只剩停用的规划挂载时绑定视为切换 | 2 / 0 |
  | AC4 账本丢失后同键重放 | 2 / 0 |
  | AC4 账本内同键异请求 | 1 / 0 |
  | AC5 凭据只以句柄落库 | 2 / 0 |
  | 原子性：配置不合 schema 或父行缺失时不留任何行 | 2 / 0 |
  | 不存在的前缀（负对照） | 0 / 0 |

- 规模与差异：见 `Outcomes & Retrospective`。
- 本批只改文档，没有新增守卫，所以没有变异；`vertical-path.md` 的结论与引用由上面的回读（含负对照）逐条核对。

### 独立验收证据（2026-10-21）

检出 `feature/workspace-binding-commands`（工作树 `.worktrees/workspace-binding-commands`）@ `5d7897b`（独立验收的测试与注释提交之后、本节写入之前），root 用户，Node v26.12.0，base `origin/main` @ `f131e68`。

```text
$ node --test tests/integration/workspace-setup-commands.test.js tests/e2e/controller-roundtrip.test.js   -> ℹ tests 33 / ℹ fail 0
$ pnpm run typecheck                      -> 退出码 0
$ pnpm run boundaries                     -> ℹ tests 9 / ℹ pass 9 / ℹ fail 0
$ pnpm run test（root）                   -> ℹ tests 1709 / ℹ pass 1707 / ℹ fail 2，✖ 恰为两条已知 root 项
$ runuser -u <非 root 用户> -- … node --test tests/integration/development-local-git.test.js   -> ℹ tests 73 / ℹ fail 0
$ pnpm run test:mvp0                      -> ℹ tests 7 / ℹ fail 0
$ node scripts/workflow-check.mjs         -> no findings（已检查 8 个文件）
$ node scripts/rule-checks.mjs disclosure origin/main   -> 退出码 0；人工五类目（凭据 / 本机路径与身份 / 账号与个人信息 / 内部系统 / 保密字样）逐条过：无命中
$ node scripts/rule-checks.mjs size origin/main         -> 代码 424 / 1000，文档见 Outcomes
$ git diff --check origin/main...HEAD     -> 无输出
$ vertical-path.md 回读命令，七个前缀  -> 各 ℹ tests 2（「AC4 账本内同键异请求」为 1）/ ℹ fail 0；负对照 ℹ tests 0
```

- 变异（`node scripts/review-mutate.mjs <spec>`，命令为本测试文件，17 个变异，按原文字节还原）：计划的 M1–M5、M7、M8、M-g 全部 KILLED 且归因到对应用例；独立验收新增的 X1 挂载比较忽略账号、X2 去掉规划域过滤、X3 工作区比较忽略状态策略、X4 账号比较忽略句柄、X5 / X6 去掉 `bindPlanningSource` / `createWorkspace` 的闭集检查在 `2739772` 之前**存活**，补断言后各自在两种存储上变红（X1、X2 → AC2；X3、X4 → AC4 账本丢失后；X5、X6 → AC5）；X8 去掉句柄必填、X9 允许空白名称 KILLED；X7 去掉 `assertClosed` 的原型检查仍存活（P3，见 D12）。
- 独立写入探针（仓库外脚本，不入库；不复用测试里的 `writeSpy`）：内存替身改写 `MemoryStorage` 原型上的 `put*/set*/remove*/replace*/advance*/record*` 计数（覆盖事务作用域实例）；SQLite 读连接的 `total_changes()`（被回滚的行也计入）。结果在两种存储上一致：
  - AC4 加强版：经 `createSetupCommands` 跑三条成功命令与两条被拒绑定（`conflict`、`not_found`）→ 重开 → 按 Host 步骤 `restoreProviders` + `composeCore` + `bootstrapWorkspace`（`createContext` 重写工作区与规划挂载、引导在锚点上写身份与观察）→ 重开 → 新实例同键同请求重发：五个结果与首次深等，写入计数 0，转储不变。
  - 拒绝先于写入：闭集（`token` / `secret`）、字段检查、`not_found`、`conflict`、`not_supported` 都是 0 条写语句；SQLite 上粘进句柄字段的令牌与非规范 origin 也是 0（存储在语句前校验）；配置被拒（不合模式、未声明字段、实现键无 schema）是 3 条写语句后回滚（S10）。全部拒绝之后转储不变，结果 JSON 不含令牌哨兵。
  - 故障注入：`setProviderBindingAccount` 或 `putBindingConfiguration` 抛非 `RangeError` 异常 → 原样上抛、转储不变、随后同一绑定成功（无孤儿锚点或挂载）。
  - 并发：同 id 异名 `createWorkspace` 一 ok 一 `conflict`；同账号并发连接两次都 ok、同 id、一行；同自然键异显示名一 ok 一 `conflict`；同目标并发绑定两次都 ok、同 `bindingId`；账本在途合并返回同一对象。
  - AC5：经 controller 的 `token` 字段与粘进句柄字段的令牌都是 `failed` / `invalid_input` 且不回显；SQLite 完整流程加引导后数据目录全部文件（含事务期的 `-journal`；存储未启用 WAL）扫描：哨兵 0、base64 0、句柄名 1。

### P3 并入证据（2026-10-21）

检出 `feature/workspace-binding-commands`（工作树 `.worktrees/workspace-binding-commands`）@ `8098f50`（三个修复提交之后、本节所在的文档提交之前），root 用户，Node v26.12.0，base `origin/main` @ `f131e68`。规模与差异检查在文档提交之后跑。

```text
$ node --test tests/integration/workspace-setup-commands.test.js   -> ℹ tests 14 / ℹ fail 0
$ pnpm run typecheck                      -> 退出码 0
$ pnpm run boundaries                     -> ℹ tests 9 / ℹ pass 9 / ℹ fail 0
$ pnpm run test（root）                   -> ℹ tests 1710 / ℹ pass 1708 / ℹ fail 2，✖ 恰为两条已知 root 项
$ runuser -u <非 root 用户> -- … node --test tests/integration/development-local-git.test.js   -> ℹ tests 73 / ℹ fail 0
$ pnpm run test:mvp0                      -> ℹ tests 7 / ℹ fail 0
$ node scripts/workflow-check.mjs         -> no findings（已检查 8 个文件）
```

- 全量 `ℹ tests 1710` = 之前的 1709 + #376 的新用例（#375、#384 是在已有用例里加断言）。
- 变异表见 `Progress` 的 P3 并入一项；X7 由存活变为两种存储上 KILLED。

### 评审修复证据（2026-10-21）

检出 `feature/workspace-binding-commands`（工作树 `.worktrees/workspace-binding-commands`）@ `7f3e6a6`（评审修复的代码提交之后；工作树另有本轮的文档改动与测试注释订正，都不改被测行为），root 用户，Node v26.12.0，base `origin/main` @ `f131e68`。规模在含本轮全部改动的树上计算。

```text
$ node --test tests/integration/workspace-setup-commands.test.js tests/e2e/controller-roundtrip.test.js   -> ℹ tests 34 / ℹ pass 34 / ℹ fail 0
$ pnpm run typecheck                      -> 退出码 0
$ pnpm run boundaries                     -> ℹ tests 9 / ℹ pass 9 / ℹ fail 0
$ pnpm run test（root）                   -> ℹ tests 1710 / ℹ pass 1708 / ℹ fail 2，✖ 恰为两条已知 root 项
$ runuser -u <非 root 用户> -- … node --test tests/integration/development-local-git.test.js   -> ℹ tests 73 / ℹ pass 73 / ℹ fail 0
$ pnpm run test:mvp0                      -> ℹ tests 7 / ℹ pass 7 / ℹ fail 0
$ node scripts/workflow-check.mjs         -> no findings（已检查 8 个文件）
$ node scripts/rule-checks.mjs disclosure origin/main   -> 退出码 0；人工五类目逐条过：无命中（本机账号名、绝对路径 0 处）
$ node scripts/rule-checks.mjs size origin/main         -> 代码 466 / 1000，文档 531 / 1500
$ git diff --check origin/main...HEAD     -> 无输出
$ vertical-path.md 回读命令，七个前缀  -> 各 ℹ tests 2（「AC4 账本内同键异请求」为 1）/ ℹ fail 0；负对照 ℹ tests 0
```

- 全量 `ℹ tests 1710` 与「P3 并入证据」相同：评审修复是在原子性用例里加断言，没有新用例。
- 两条 issue 评论用 `gh api repos/<owner>/<repo>/issues/<n>/comments` 回读：#354、#131 各 1 条，正文与发出的草稿逐字一致（页脚的空行由平台规范化）。

## Progress

- [x] 2026-10-21 设计评审完成：三份提案经独立评审收敛；审阅原型（仓库外）在两种存储上 4 / 4 通过，6 个守卫变异各自变红（S5）。
- [x] 2026-10-21 Batch 1 · core 设置命令（含 M1–M6 变异记录）。在检出 `feature/workspace-binding-commands` 的工作树根目录运行（base `origin/main` @ `f131e68`）：
  - 红（实现前）：`node --test tests/integration/workspace-setup-commands.test.js` → `SyntaxError: The requested module '@harness-projects/core' does not provide an export named 'createWorkspaceSetup'`，`ℹ tests 1`、`ℹ fail 1`。
  - 绿：同一命令 `ℹ tests 10`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`；`node --test tests/integration` 只有已知 root 项「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」（`ℹ tests 533`、`ℹ fail 1`）。
  - 变异（逐条改 `packages/core/src/workspace-setup.ts`、跑新测试文件、恢复原文；每条两种存储同时变红）：

    | 变异 | 变红用例 |
    |---|---|
    | M1 删启用挂载目标不同时的 `conflict` | AC2（memory 抛 `workspace already has an enabled planning binding`，SQLite 抛 `UNIQUE constraint failed`） |
    | M2 停用挂载的 `not_supported` 改成 `conflict` | AC3 |
    | M3 删停用挂载的 `not_supported` 分支 | AC3 |
    | M4 去掉 `setProviderBindingAccount` | AC1（`disabled` 非空）、AC5（完整流程没有请求） |
    | M5 去掉 `connectAccount` 的 `assertClosed` | AC5（`token` 被静默丢弃而成功） |
    | M6 配置写入挪到第二个 `runSetup` | 原子性（孤儿挂载） |
    | M-a 去掉名称非空检查 / M-b 去掉状态策略闭集检查 | 原子性（各自） |
    | M-c 去掉句柄必填检查（D10） | AC5 |
    | M-d 存储 `RangeError` 不再映射 | AC5、原子性 |
    | M-e 把存储原文与异常放进错误值 | 原子性（S6） |
- [x] 2026-10-21 Batch 2 · controller 设置命令与账本丢失后的重放（含 M7–M8）。同一检出与 base：
  - 红（实现前）：`node --test tests/integration/workspace-setup-commands.test.js` → `SyntaxError: The requested module '@harness-projects/controller' does not provide an export named 'createSetupCommands'`，`ℹ tests 1`、`ℹ fail 1`。
  - 绿：新文件 `ℹ tests 13`、`ℹ fail 0`；连同 `tests/e2e/controller-roundtrip.test.js` `ℹ tests 33`、`ℹ fail 0`（controller-roundtrip 20 条不变）；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`。
  - 变异：

    | 变异 | 变红用例 |
    |---|---|
    | M7 `createWorkspace` 先读后无条件 `putWorkspace` | AC4 账本丢失后（写入计数非零），两种存储 |
    | M8 `createSetupCommands` 绕过 `replay` | AC4 账本内同键异请求 |
    | M-f core 的 `conflict` 报成 `failed` | AC4 账本丢失后，两种存储 |
    | M-g 成功报成 `confirmed` | AC4 三条 |
    | M-h 把信封连同 `actorRef` / `idempotencyKey` 交给 core | AC4 三条（core 闭集检查拒绝） |
    | M-i 删 `createWorkspace` 的改名 `conflict` | AC4 账本丢失后，两种存储 |
    | M-j 删 `connectAccount` 的换显示名 / 句柄 `conflict` | AC4 账本丢失后，两种存储（S7） |
- [x] 2026-10-21 Batch 3 · 文档与门禁（TD-070 / TD-071、`vertical-path.md`、本计划回填）。同一检出与 base；门禁结果行在 `Validation and Acceptance` 的「验证证据」：typecheck 退出码 0；boundaries `ℹ fail 0`；`pnpm run test`（root）`ℹ tests 1709`、`ℹ fail 2`，失败标题恰为两条已知项，非 root 重跑 73 / 73；`test:mvp0` 7 / 7；workflow-check、disclosure、`git diff --check` 全过。文档改动：tracker 追加 TD-070、TD-071（字段数与相邻行一致）；`vertical-path.md` 简称表、第 1、2 行与「第 1、2 行的 #127 订正」段（第 2 行由未交付升为部分，D11）。
- [x] 2026-10-21 独立验收完成（独立验收（Claude Opus））：六条验收逐条找到判别用例并以变异证明；补 X1–X6 六处存活变异的断言（`2739772`）与 `refuse` 的调用约束注释（`5d7897b`），被测代码未改；门禁与探针结果见 `Validation and Acceptance` 的「独立验收证据」；结论与待人类确认项见 D12、`Outcomes & Retrospective`。
- [x] 2026-10-21 独立验收的三项 P3 在本 PR 内实现（D13、D14，实现者（Claude Opus））：#375 `c7b485e`（只改测试）、#376 `ea28a1b`、#384 `8098f50`。在检出 `feature/workspace-binding-commands` 的工作树根目录运行（base `origin/main` @ `f131e68`）：
  - 红：#375 加断言前 X7 存活（`review-mutate` 报 SURVIVED）；#376 新用例在旧 `runSetup` 上 `ℹ fail 1`（`Missing expected rejection (RangeError)`，两条命令都返回了 `invalid_input`）；#384 的 AC2 断言在旧比较上两种存储都红（变异 Y0 即旧调用点）。
  - 绿：`node --test tests/integration/workspace-setup-commands.test.js` `ℹ tests 14`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0。
  - 变异（`node scripts/review-mutate.mjs <spec>`，命令为本测试文件，按原文字节还原；10 个全部 KILLED 且归因到 `killedBy` 用例）：

    | 变异 | 变红用例 |
    |---|---|
    | X7 去掉 `assertClosed` 的原型检查 | AC5（两种存储） |
    | W1 把 `RangeError` → `invalid_input` 放回 `runSetup`（映射放宽回去） | 存储读口的 RangeError 原样上抛 |
    | W2 `storageWrite` 不再映射 | AC5、原子性（两种存储） |
    | W3 `writeMount` 绕过 `storageWrite` / W4 `putConnectorAccount` 绕过 | 原子性 / AC5（两种存储） |
    | Y0 调用点换回 `isDeepStrictEqual`（旧代码） / Y1 `sameMountTarget` 内改回原型敏感 / Y2 只展开外层 | AC2（两种存储） |
    | Y3 比较忽略配置 | AC2、AC4 账本丢失后（两种存储） |
    | X1 比较忽略账号（独立验收的旧变异，在新比较点上复核） | AC2（两种存储） |
- [x] 2026-10-21 评审修复（PR #371 第一轮 MVP 交付评审 REQUEST_CHANGES 的 P1、两条 P2 与本 PR 内可修的 P3；评审修复（Claude Opus））：决定与取舍见 D15，门禁见「评审修复证据」。在检出 `feature/workspace-binding-commands` 的工作树根目录运行（base `origin/main` @ `f131e68`）：
  - `bindPlanningSource` 字段类型（`7f3e6a6`）：红——原子性用例新加的两条请求（缺实现键、配置为数组）在旧代码上两种存储都红：内存替身两次都是 `invalid_input`，但写入探针记下 6 次写调用（`putProviderBinding`、`setProviderBindingAccount`、`putBindingConfiguration` 各两次，随后回滚）；SQLite 原样抛出 `Error: NOT NULL constraint failed: provider_binding.implementation_key`。绿——新文件 `ℹ tests 14`、`ℹ fail 0`，`pnpm run typecheck` 退出码 0。
  - 变异（`node scripts/review-mutate.mjs <spec>`，命令为本测试文件，按原文字节还原；5 个全部 KILLED 且归因到 `killedBy` 用例，每个都在两种存储上变红）：

    | 变异 | 变红用例 |
    |---|---|
    | K1 去掉实现键检查 | 原子性 |
    | K2 去掉配置检查 | 原子性 |
    | K3 `plainObject` 不看原型（数组放行） | 原子性 |
    | K4 `plainObject` 拒绝 null 原型 | AC2（同值空原型配置的重放，#384） |
    | K5 删掉整行检查 | 原子性 |

  - 承接登记：#354 评论（`guarded`、TD-071、D1 / D5）与 #131 评论（R4）已发出并回读；tracker 的 TD-071「下一步」与 TD-070「影响」附评论链接。
  - 文档订正：`vertical-path.md` 第 1 行补回「列表与选择」缺口、订正段引文补全；范围行、D13、D14、Outcomes 与 `Interfaces and Dependencies` 里 #384 的关闭归属与 #353 的表述；`-wal`、`-shm` 的不实陈述（本计划三处与测试注释）；过期的 trailer 句标为已处理。
- [x] 2026-10-21 第二轮评审修复（PR #371 第二轮 MVP 交付评审 REQUEST_CHANGES 的 P1 与 P3；实现者（Claude Opus））：「AC4 账本丢失后同键重放」末尾补新验收 4 后加三句的断言（`6441d92`，只改测试，被测代码未改）；验收表第 4 行的要求与证据列改为新措辞并引用这些断言，删去「重判属 TD-070 的已知残余」；D2 与 Outcomes 三处「需人类确认」原处标注 Superseded by D16。在检出 `feature/workspace-binding-commands` 的工作树根目录运行（merge-base `f131e68`）：
  - 红：变异 R1（`createReplayLog` 对 `createWorkspace` / `connectAccount` / `bindPlanningSource` 带 `error` 的结果不入账本；手改，`git checkout -- packages/controller/src/commands.ts` 还原）下，`node --test tests/integration/workspace-setup-commands.test.js tests/e2e/controller-roundtrip.test.js` 得 `ℹ tests 34`、`ℹ fail 2`：两种存储的「AC4 账本丢失后同键重放」都报 `AssertionError: 账本存活：前置条件补齐后同键仍得原拒绝`（实际 `writeState: 'local_only'` 带新 `bindingId`，期望原 `not_found` 拒绝）；同一变异对 `4c33736` 的测试文件仍是 `ℹ tests 34`、`ℹ fail 0`（存活，与评审一致）。
  - 绿与门禁：同一命令 `ℹ tests 34`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ tests 9`、`ℹ fail 0`；`pnpm run test`（root）`ℹ tests 1710`、`ℹ fail 2`，失败标题恰为两条已知 root 项；非 root 重跑 `development-local-git` 73 / 73；`test:mvp0` 7 / 7；workflow-check no findings；规模（含本轮全部改动）代码 482 / 1000，文档 542 / 1500。
- [x] 2026-10-21 MMP 评审三轮（评审账号）：第一轮 REQUEST_CHANGES（P1 `Closes #384` 落在栈底），第二轮 REQUEST_CHANGES（P1 改写后的验收 4 没有判别用例），第三轮 APPROVE（`5596793726`，head `e7c9b1b9`；R1、R3、R4 三个变异新红旧绿）。线程由开发账号逐条回复。
- [x] 2026-10-21 收尾（评审会话按分工接手）：
  - 变基到含 #348、#370、#372 的 main `f4e130cd`。tracker 与 #372 的相邻 TD 行冲突，按编号两边保留。`vertical-path.md` 的订正段两段并存；简称表 e2e、contract 两行取 #372 的版本，integration 行合并两边，加上 `workspace-setup-commands`。
  - 提交整合为 plan → 代码（core 与 controller、全部测试与跟进项）→ 归档三个提交，提交正文里以 `#` 开头的行改为「issue #…」。
  - 本计划移入 `docs/exec-plan/completed/`，TD-070、TD-071 的 ExecPlan 列与 `docs/README.md` 同步。按人类伙伴在开发会话里的决定（「遵守 D2，不加」），不新增 `docs/review/` 记录。

## Surprises & Discoveries

- S1：issue 引用的 `registerBindings` 已被 `collectBindings` 取代（F9），组合期仍是挂载的第二个写者，但对规划挂载写同值（F6）。
- S2：第二个启用规划挂载在存储层是裸异常而非结构化错误（F2），所以必须在事务内预检；SQLite 的工作区写是 upsert（F3），所以必须先读。
- S3：空 GitHub Project 在 Host 路径下引导得 `not_found`（`bootstrap.ts` 的 `readProject` 在没有注入 `project` 且没有观察时返回「没有可发现的规划项目」）→ TD-071。验收 1 的录制夹具非空，不受影响。
- S4：#353 的设计提案假设本 PR 提供持久的 `runIdempotent` 结果表（其假设 A2）；本计划 D2 不提供，#353 应改用 `runSetup` 与自然键（Interfaces）。
- S5：审阅原型（仓库外，Node 26）：最终设计在内存替身与 SQLite 文件上 4 / 4 通过，`tsc --noEmit` 通过；去掉账号关联、改成盲 upsert、去掉闭集检查、去掉 conflict 分支、去掉 not_supported 分支、把两者合并成 conflict，六个变异各自使对应断言变红；参数属性语法在 strip-only 下不可用。
- S6（Batch 1，2026-10-21）：「Storage `RangeError` 映射为固定文案」最初没有判别用例——变异 M-e（把存储原文放进 `message`、把异常放进 `attemptedValue`）存活，因为两个存储实现的 `RangeError` 文案本身已是固定无输入文本（`packages/capabilities/src/connector-account.ts`），「结果不回显输入」的断言对它不敏感。原子性用例因此加一条不同原因的存储拒绝（未声明字段 `owner`），断言两次拒绝的错误值深等；M-e 随之变红。另：SQLite 的 `workspace.status_policy` 有 CHECK（`packages/storage/sqlite/migrations/002_identity_membership.sql`），未知策略在 SQLite 上是裸驱动异常而不是 `RangeError`，所以 `createWorkspace` 的闭集检查必须在 core（M-b 在两种存储上都变红）。
- S7（Batch 2，2026-10-21）：变异 M-j（删掉 `connectAccount` 的「同自然键换显示名或句柄 → conflict」）在计划列出的用例下存活——Design 命令表有这一行，验收表没有对应断言。AC4「账本丢失后」用例在改名重发之外加一条同键换显示名的 `connectAccount`，两者都断言 `conflict` 且 `snapshot` 不变；M-j 随之变红。句柄只有一个 allowlist 成员，换句柄会先被存储以 `invalid_input` 拒绝，所以用显示名制造差异。
- S8（Batch 3，2026-10-21）：`vertical-path.md` 第 2 行 Provider 格原写「`planning-github-projects` 是占位包」，但该包早已是真实 provider（`packages/providers/planning-github-projects/src/provider.ts` 的 `createGithubProjectsPlanningProvider`，AC1 经录制回放用它引导出 9 个实体）。改写本行时一并订正这一格，其余格不动。
- S9（Batch 3，2026-10-21）：tracker 的 TD-064（仓库没有固定 node id）把「延期理由」和「下一步」都指向 #127（「#127 绑定仓库时保存仓库 node id」），但仓库绑定已随 #351 重规划移入 #353（本计划范围行）。本 PR 不改别人的 tracker 行（Global Constraints 只列 TD-070、TD-071），交协调者在 #353 的计划或合并时订正。证据：`grep -n 'TD-064' docs/exec-plan/tech-debt-tracker.md`。
- S10（独立验收，2026-10-21）：并非每个拒绝都先于写入。配置被拒（`projectNodeId` 不合模式、配置含未声明字段、实现键没有声明 schema）由存储在 `putBindingConfiguration` 里判定，此时同一事务已执行 `putProviderBinding` 与 `setProviderBindingAccount`（SQLite 被拒事务内 `total_changes()` +3），只靠回滚撤销；原因是存储按**真实锚点**的实现键分派配置 schema（#126），core 不持有策略。其余拒绝都是 0 条写语句。两种存储上转储不变、故障注入后可重试，原子性成立；#353 的 `writeMount` 同样如此。
- S11（独立验收，2026-10-21）：计划的变异全部被杀，但六处同样承载验收语义的守卫删掉后仍全绿——挂载比较里的账号（X1）、规划域过滤（X2，Host 路径上要等 #353 写出研发 / 交付挂载才可达）、工作区状态策略（X3）、账号句柄（X4）、另两条命令的闭集检查（X5、X6）。S7「换句柄会先被存储以 invalid_input 拒绝」不成立：已有账号时自然键比较先于存储写入，换成不在 allowlist 的句柄也得 `conflict`，可以直接判别。已在 `2739772` 补断言（只改测试）。
- S12（P3 并入，2026-10-21）：两个存储实现都在**构造时**复验已存行（`packages/storage/sqlite/src/storage-sync.ts` 的 `#assertStoredMetadata`、`packages/providers/fake/src/storage.ts` 的 `MemoryStorage` 构造函数）：以收紧的句柄策略重开同一份数据，`createSqliteStorage` / `createFakeStorage` 本身就抛 `RangeError`，到不了命令。所以命令执行中的读口 `RangeError` 只来自绕过存储的改动或程序错误；#376 的用例改用写入探针注入，而不是「换策略重开」。另：`putWorkspace` 在两个实现里都不抛 `RangeError`（替身是 upsert，SQLite 的状态策略 CHECK 是驱动异常，S6），所以 `storageWrite` 不包它。

- S13（评审修复，2026-10-21）：`bindPlanningSource` 缺实现键时两种存储形态不同：内存替身由存储以 `RangeError` 拒绝，经 `storageWrite` 得 `invalid_input`；SQLite 在 `putProviderBinding` 处由驱动抛 `NOT NULL constraint failed`，它不是 `RangeError`（#376 之前同样不映射），带驱动原文上抛。配置不是普通对象（字符串、数组、`null`、`Date`）在两种存储上都得 `invalid_input`，但都先执行三条写再回滚（S10 的同类）。缺 `workspaceId`、缺 `accountId` 或 `accountId` 不是字符串，在两种存储上都已是结构化 `not_found`（仓库外探针，13 种请求 × 两种存储）。原子性用例原先没有写入探针，所以「结果对、但写过再回滚」的差异在测试里不可见。

## Decision Log

以下决策日期均为 2026-10-21，作者：设计评审（Claude Opus，独立评审 subagent）；人类可推翻。

- **D1 工作区 id 由调用方给定**（采纳系统 / 业界提案，否决最小提案的 `sha256(actor, key)` 派生）。证据：Host 只按固定 `WORKSPACE_ID` 读取、端口无 `listWorkspaces`（F4），派生 id 会让下一次组合找不到工作区；#354 与 #131 都只服务单工作区；ADR-0010 禁止可由用户内容验证派生的 `WorkspaceId`。取舍：幂等不再依赖键派生，同 id 本身就是自然键；#354 必须由 Host 填入固定 id，不接受 UI 传值。
- **D2 自然幂等 + 进程内账本，不建回执表**（三份提案一致）。证据：issue 范围写明「naturally idempotent as well as replayed」；F1、F2、F7；#306 已拒绝持久指纹账本；业界：Stripe 只在端点开始执行后保存结果，校验失败与并发冲突不保存、可重试，键保留至少 24 小时后按新请求处理；AWS client token 同参数为无操作、异参数为 `IdempotentParameterMismatch`；Brandur 的设计里只含本地变更的请求是一个原子阶段、无需恢复点。验收 4 的解释：成功命令与「状态未变时的拒绝」在账本丢失后都返回原结果、零写入（有测试）；「状态已变后的拒绝」重判是可接受残余（TD-070）：被拒那次没有写入，之后的成功是唯一一次副作用。此解释需人类确认（Superseded by D16（2026-10-21）：已裁定）。
- **D3 `conflict` 与 `not_supported` 的边界**（采纳最小 / 业界提案，否决系统提案的「同连接换配置也算切换」）。证据：#202 的切换定义是「旧挂载停用、新挂载启用」（F8）；锚点 id 随机生成时，存在启用挂载而目标不同就意味着第二个启用挂载。规则：有启用规划挂载且目标不同 → `conflict`；无启用、有停用 → `not_supported`。两条各有删掉即红的用例（M1、M3），合并成一个码也会被 AC3 抓到（M2）。
- **D4 锚点与账号 id 随机生成，靠事务内自然键查找去重**（否决系统提案的 `connectionIdFor` / `accountIdFor` 派生）。理由：两种存储的事务串行，自然键查找已保证重复请求得到同一 id；ADR-0006 的「同账号一条锚点」前提只在多工作区共享连接时起作用，不在任何验收内（YAGNI）；`writeMount` 由调用方传 id，#353 需要时可自行决定派生。
- **D5 core 不核对实现键是否提供规划域**（否决最小提案的 `definitions` 依赖）。证据：错误实现键的挂载在恢复时被禁用（`restoreProviders` 的「实现不提供这个挂载的能力域」），#354 的 Host 操作由目录固定实现键，产品内不可达；被卡住的规划槽位与「格式合法但错误的 `projectNodeId`」恢复手段相同（R1），单独防一种原因收益低。代价是 core API 被误用时只在恢复时暴露（R3）。
- **D6 controller 用独立的 `SetupCommands`，不加进 `Controller`**（三份提案一致）。理由：工作区未创建时 Host 的 `Controller` 建在 `unavailableCore` 上；独立对象可由 #354 每进程建一次、跨重组保留账本；不触碰 #352、#229 的 `apps/` 文件。
- **D7 验收 1 用 `restoreProviders` + `composeCore` 证明**，与 `host-composition.ts` 的组合步骤相同；不调 `createHostComposition`（#352 正在改它），Host 级证明属 #354 验收 1。空 Project 缺口记 TD-071。
- **D8 请求字段全部必填、结果只含 id**（采纳业界提案）：缺省值会让同一意图有两种指纹；只含 id 的结果在账本丢失后可由行逐字重算。
- **D9 不写 ADR，模式辅助函数不从 core 包入口再导出**：本 PR 没有新依赖边、跨层或第二权威源（`AGENTS.md` §2），决策可纯代码回滚；#353 在 core 内以相对路径引用辅助函数，controller 与 Host 只见命令。
- **D10 实现细节（Batch 1，2026-10-21，实现者（Claude Opus））**，`Interfaces and Dependencies` 的签名一个未改：
  - `refuse` 只在 `runSetup` 的 work 内有意义（它抛出的拒绝只由 `runSetup` 还原成结果），因此 `assertClosed` 与请求字段检查都写在 work 的第一行，而不是事务之前；拒绝发生在任何读写之前，`writeSpy` 计数为 0（AC5）。#353 的 `bindRepository` 照此调用。
  - `connectAccount` 要求 `secretHandle` 是字符串：存储把缺省句柄解释为「无认证账号」，而 Design 的命令表要求句柄在 allowlist 内、D8 要求字段全部必填；没有这条检查，缺句柄的请求会登记一个恢复时必被禁用的账号。AC5 加一条断言（M-c）。
  - `createWorkspace` 的「id、名称非空、策略在闭集」检查由原子性用例覆盖（M-a、M-b，见 S6）。
  - Batch 2：`packages/controller/src/commands.ts` 的模块内 `requestPayload` 改为泛型 `requestPayload<T extends CommandEnvelope>(input: T): Omit<T, keyof CommandEnvelope>`（只改类型，运行时不变）：设置命令要把去掉信封的请求原样交给 core——core 的闭集检查会拒绝 `actorRef` / `idempotencyKey`（M-h）——而原来的 `Record<string, unknown>` 返回类型不能赋给请求接口。`createControllerCommands` 与 `Controller` 未改。
- **D11 `vertical-path.md` 第 2 行由未交付升为部分（Batch 3，2026-10-21，实现者（Claude Sonnet）；需人类确认）**（Superseded by D16（2026-10-21）：已裁定记「部分」，§2.1 生产入口规则同步补设置命令入口）。该节规则要求「反向升级需要在所属 ExecPlan 的 Decision Log 写明证据」。证据：(1) 入口：core 包入口命名导出 `createWorkspaceSetup`，controller 经 `commands.ts` 的 `export *` 导出 `createSetupCommands`；运行时回读 core 只导出 `createWorkspaceSetup`、controller 导出 `createSetupCommands`，模式辅助函数不在包入口（D9）；(2) 成功与失败两列都有经入口的用例：AC1、AC5（成功）与 AC2、AC3、AC5、原子性、AC4（失败），七个前缀按回读命令读回 `ℹ tests` ≥ 1、`ℹ fail 0`，负对照 `ℹ tests 0`（`Validation and Acceptance` 的「验证证据」）；(3) 仍记「部分」而非「已交付」的理由：Host 与 UI 都没有调用方（#354、#131），三类失败的区分未做（#278），Host 级证明属 #354 验收 1（D7）。保守读法：若人类认为「生产入口」必须有 Host 调用方，则第 2 行应退回「未交付」；这里按本计划 Batch 3 的措辞记录。同一订正给第 1、2 行的承接加上 #354（缺口的承接者），第 2 行去掉 #127（本 PR 关闭它）。第 1 行本来就是「部分」，只改缺口描述。
- **D12 独立验收结论（2026-10-21，独立验收（Claude Opus）；第 1、2 条需人类确认）**（Superseded by D16（2026-10-21）：第 1、2 条均已裁定）：
  1. 验收 4 与 D2：同意 D2 的读法并把它列为待确认项，而不是 P1。证据：成功命令与状态未变时的拒绝在账本丢失后（含一次 Host 式重组与引导之后）零写入、返回原结果，由独立写入探针在两种存储上确认（「独立验收证据」）；生产代码里没有能改变已成功命令目标行的路径（无改名、无账号更新，F8），所以成功结果在账本丢失后稳定。字面差距只剩 TD-070 的一类：被拒请求在前置条件补齐后同键重发会成功并写一次。issue 范围写的是「naturally idempotent as well as replayed」，自然幂等本身就会按当时状态重判拒绝；这次写入是该意图唯一的一次副作用。若人类要求字面成立，需要方案 B 的持久回执，超出本 PR 规模。
  2. D11（第 2 行升为部分）属边界情形，不由验收者改动。`vertical-path.md` §2.1 的规则把生产入口限定为 `CoreApi.commands/queries`、`Controller.commands/queries` 与 client 同步入口；`createWorkspaceSetup` 不是 `CoreApi` 成员，`SetupCommands` 按 D6 独立于 `Controller`，二者都不在这份封闭清单内。严格读法下第 2 行仍是「未交付」（没有生产入口）；D11 的「保守读法」以「是否有 Host 调用方」立论，没有回应这条清单。人类二选一：认可 `SetupCommands` 为 controller 命令入口（宜同时在规则里补上这一项），或把第 2 行结论改回「未交付」（一格，第 1 行不受影响，它本来就以组合期入口记为部分）。
  3. 测试强度：S11 的六处存活变异在本 PR 内补断言（只改测试文件，属 D2 演示窗口允许的「本 PR 文件内的平凡 P2」）；X7（`assertClosed` 的原型检查）仍存活，经 controller 进入的请求已由 `requestPayload` 展开成普通对象，这条检查只对在 core 内直接调用命令的代码有意义，记 P3 不补。没有发现 P0 / P1，被测代码未改。（后续：X7 与另两项 P3 由 D13 改在本 PR 内实现，见 D14。）
- **D13 独立验收的 P2 / P3 在原 PR 内实现（2026-10-21，人类伙伴，经协调者转达）**。原话：「这些 P2/P3 不应该你自己修复吗？超过弹性 800 行没有关系。但在实现前你应该自己想一想有没有办法简化改动呀。怎么什么小问题都建 issue 呢？请你在现有 PR 中实现并 link 对应 issue」。含义：已登记为后续 issue 的 #375、#376、#384 在本 PR 内实现并在提交里 link 对应 issue；800 行是弹性目标（CI 硬上限 1000 代码 / 1500 文档不变）。对这三项取代 #351 演示窗口规则 D2（P2 / P3 → M4.1 issue）。#384 来自 #373 的独立验收，比较点在本 PR 的文件里，所以共享的 `sameMountTarget` 与 `bindPlanningSource` 一半在本 PR 实现；它的验收要求 `bindPlanningSource` 与 `bindRepository` 两条命令都满足，本 PR 没有 `bindRepository`，所以本 PR 只引用 #384，由交付另一半的 #373 关闭（2026-10-21 评审 P1 订正，D15：原话只要求「link 对应 issue」，没有指定由哪个 PR 关闭，「由本 PR 关闭」是 agent 自己的推论）。
- **D14 三项 P3 的最小改法（2026-10-21，实现者（Claude Opus））**，`runSetup`、`refuse`、`assertClosed`、`MountTarget`、`readMountTarget`、`writeMount` 的导出名与签名都未改：
  - #375：可选「每条命令另写类实例 / 数组 / 外来原型三类新用例」或「给 AC5 的闭集断言加一组原型继承 `token` 的请求」。取后者，只改测试：这是只看自有键的检查唯一拦不住的形态；数组自有 `length`，键检查已拦下，对 X7 没有判别力；类实例与外来原型走同一分支。
  - #376：可选「在 `runSetup` 里按异常来源分辨」（存储的 `RangeError` 没有可区分的类型，要改 capabilities，越界）、「给 core 加设置命令的诊断端口」或「在写口收窄」。取最后者：模块内 `storageWrite` 包住 `putConnectorAccount` 与 `writeMount` 的三次写，`runSetup` 删掉 `RangeError` 分支，其余异常照旧上抛。issue 写的「以 failed 出现、原因只进诊断日志」由 Host 已有的 `guarded`（`apps/harness-plugin/src/host-composition.ts`：`describeError` 进诊断日志，对外固定文案）在 #354 接线时兑现（已登记为 #354 验收：https://github.com/SingularityKChen/harness-projects/issues/354#issuecomment-6309751362），不另造第二条诊断路径；意图（不是 `invalid_input`、原因不上 wire）成立，形态是固定文案的操作失败而非 `CommandResult.writeState: 'failed'`。
  - #384：可选「逐字段比较」（实现键、账号各成新守卫，要各自补变异）、「只把空原型配置特判成普通对象」或「仍用 `isDeepStrictEqual`，先把目标与配置展开成普通对象」。取最后者，导出为 `sameMountTarget(stored, requested)`，作为「相同即零写入」的唯一比较点：只让原型不再参与，实现键、账号与配置值的判别不变（X1 复核仍被杀）。非对象配置展开后是 `{}`，只有已存配置为空时才会被误判同值；`bindPlanningSource` 在比较前已要求配置是普通对象（评审修复 `7f3e6a6`，D15），Host 目录里唯一的规划实现也要求 `projectNodeId`，所以不可达，`sameMountTarget` 本身不另加守卫。下游契约：#353 的仓库绑定若复用 `sameMountTarget`，须同样在比较前要求配置是普通对象。
  - tracker：三项都不对应 `docs/exec-plan/tech-debt-tracker.md` 的任何行（TD-070、TD-071 不受影响），不改 tracker。

- **D15 PR #371 第一轮 MVP 交付评审的修复（2026-10-21，评审修复（Claude Opus））**：评审结论 REQUEST_CHANGES（1 条 P1）；逐条核实后均属实，按根因修改：
  1. P1 #384 的关闭归属：#384 唯一的验收要求 `bindPlanningSource` 与 `bindRepository` 两条命令都满足空原型配置重放零写入，本层 `git grep -n bindRepository HEAD -- packages` 无命中。订正：本 PR 实现共享的 `sameMountTarget` 与 `bindPlanningSource` 一半、只引用 #384，由交付 `bindRepository` 一半的 #373 关闭；范围行、D13、Outcomes 同步。`8098f50` 的提交正文与 PR 描述由协调者改写，本轮不改写已有提交。
  2. P2 承接义务登记到接收方 issue：#354 评论 https://github.com/SingularityKChen/harness-projects/issues/354#issuecomment-6309751362 登记三项验收——设置命令的远程操作经 Host 的 `guarded`，异常只进诊断日志、对外固定文案（#376 剩下的一半）；组合时注入 `project` 并补空 Project 的 Host 级用例（TD-071）；Host 自己填固定 `WORKSPACE_ID` 与目录里的实现键，不接受 UI 传值（D1、D5）。#131 评论 https://github.com/SingularityKChen/harness-projects/issues/131#issuecomment-6309751570 登记 R4：每次用户尝试铸造新幂等键。tracker 依 TD-066、TD-068 的先例在 TD-071「下一步」附 #354 链接；R4 写在 TD-070 的「影响」列，#131 链接附在那里，不放进只管 `project` 注入的 TD-071。
  3. P2 `vertical-path.md` 第 1 行：原结论「部分：无用户命令、列表与选择、创建失败用例」里的「列表与选择」本 PR 没有交付，Batch 3 删掉它不符合 §2.1「只往保守方向修正」（D11 只论证了第 2 行）。补回为「部分：命令已有，Host 与 UI 未接（#354、#131）；没有列表与选择（多工作区已移 M5，见 #354）」，订正段引文补全原结论。
  4. P3 `bindPlanningSource` 字段类型（D8 要求字段全部必填）：在 `assertClosed` 之后、任何读写之前检查实现键是非空字符串、配置是普通对象，否则固定文案 `invalid_input`；null 原型放行，否则 #384 的空原型重放会被拒（K4）。取舍：`plainObject` 与 #373 的同名辅助函数逐字相同，#373 rebase 时只是同一行的重复插入；不复用 `assertClosed` 的原型判定（它同时检查键集）；`workspaceId`、`accountId` 不加检查（两种存储上已是结构化 `not_found`，S13）。从 Host 不可达（实现键由目录固定），只让 core 的契约在两种存储上一致。
  5. P3 D14 与 Outcomes 把 #373 的 `bindRepository` 代码写成本层现状：改为对 #353 的条件句下游契约；D14 的「不可达」改由本层的配置检查（第 4 条）立论。
  6. P3「含 -wal、-shm」不实：SQLite 存储没有设置 `journal_mode`（`grep -rni 'journal_mode\|wal' packages/storage/sqlite/src/` 无命中），默认回滚日志只在事务期有 `-journal`。扫描覆盖数据目录全部文件，结论不变；本计划三处与测试注释改为如实描述。
  7. P3 过期陈述：Outcomes 遗留里「Batch 3 提交 trailer 不一致」已由协调者整理提交时处理（`git log origin/main..HEAD` 回读全部一致），标为已处理。
  8. 发布面：本计划里本机账号名的出现次数为 0，非 root 重跑一律写 `<非 root 用户>` 占位符。
  不在本轮：`vertical-path.md` 简称表与 #372 的冲突、tracker 行序（#372 合入后 rebase 时处理）；PR 描述里 X7 的过期句与提交正文以 `#` 开头的行（协调者整理提交与 PR 描述时处理）；D2 / TD-070 与 D11 仍待人类决定（D12）。
- **D16 待决项的结论（2026-10-21，由评审会话转达；人类原话照录，其余是评审会话按人类授权调研后的决定，人类可推翻）**：
  - 人类原话（评审会话直接询问）：对 D2 / D11 是「由你调研相关类似实现后综合判断」；对 #127 验收 4 的改写是「批准按此改写 AC4 (Recommended)」。#127 正文第 30 行已由评审会话改写，决定评论 https://github.com/SingularityKChen/harness-projects/issues/127#issuecomment-6310046706 （开发会话已回读）。新验收 4：成功命令同键重发返回原结果、零写入，账本丢失后亦然；拒绝只在账本存活期间重放，重启后同键重发的被拒请求按当时状态重判，前置条件已满足时成功且只写一次；账本丢失后同键指向另一目标按新请求处理。
  - D2 接受：自然幂等，不建持久回执表。依据：Stripe、AIP-155、EC2 ClientToken、Lambda Powertools 的去重保证都只覆盖已成功的请求，被拒请求可同键重来（Stripe 执行前的拒绝、Powertools、Temporal 的 AllowDuplicateFailedOnly）。验收 4 按新措辞成立。TD-070 写明「重放窗口 = 进程寿命，不是保留下限」，触发条件为出现第一条有外部副作用或没有自然键的设置命令时转持久回执。
  - D11：第 2 行记「部分」；`docs/product/vertical-path.md` §2.1「生产入口」规则补一句，把 core `createWorkspaceSetup` 与 controller `createSetupCommands` 列为设置命令入口（D6 独立于 `Controller`）。依据：词表把「部分」定义为「有入口，但某观察面缺经入口的用例」；第 8 行 `cancelExecutionRun` 只在 core 实现也记「部分」；表中没有以「Host 是否调用」作判据的先例。

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
/** 一个 Storage 事务；work 内 refuse 回滚并返回 { ok: false }；其余异常（含读口与程序错误的 RangeError）上抛，由 Host 的 guarded 记诊断。写口的 RangeError 由模块内 storageWrite 先变成 refuse(invalid_input)（#376）。 */
export function runSetup<T>(storage: Storage, work: (tx: StorageTransaction) => Promise<T>): Promise<SetupOutcome<T>>
export function refuse(code: ProjectErrorCode, message: string): never
/** 非普通对象或含 allowed 之外的键 → refuse(invalid_input)，文案不含键名与值。 */
export function assertClosed(request: unknown, allowed: readonly string[]): void
export interface MountTarget {
  readonly implementationKey: string; readonly accountId: ConnectorAccountId | undefined
  readonly configuration: Readonly<Record<string, string | boolean>>
}
export function readMountTarget(tx: StorageTransaction, mount: ProviderBindingRecord): Promise<MountTarget>
/** 「相同即零写入、不同即 conflict」的唯一比较点：深等，但配置按值比较、不比原型（#384 新增，D14）。 */
export function sameMountTarget(stored: MountTarget, requested: MountTarget): boolean
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

- #353：`bindRepository` 是 `WorkspaceSetup` 的新成员（存储作用域，请求带 `workspaceId`），在一个 `runSetup` 里完成；Development / Delivery 挂载用 `writeMount`（id 与 `isDefault` 由 #353 决定），相同挂载用 `readMountTarget` + `sameMountTarget` 判定零写入，比较前要求配置是普通对象（#384，D14）；controller 侧作为 `SetupCommands` 的成员加在 `createSetupCommands` 内，共用同一个 `replay`。不引入持久结果表（S4）。
- #354：Host 每进程建一次 `createSetupCommands(createWorkspaceSetup(storage))` 并跨重组持有；远程操作填入固定 `WORKSPACE_ID` 与目录中提供 planning 域的实现键，不接受 UI 传这两个值；`ok` 后重组，并按 TD-071 注入 `project`；设置命令同其它 Controller 操作一样经 `guarded` 暴露——它们上抛的异常（存储读口的坏行、程序错误，#376）只进诊断日志，对外是固定文案。这三项（`guarded`、TD-071、D1 / D5）已登记为 #354 验收：https://github.com/SingularityKChen/harness-projects/issues/354#issuecomment-6309751362。
- #131：每次用户尝试铸造新幂等键（R4，已登记为 #131 验收：https://github.com/SingularityKChen/harness-projects/issues/131#issuecomment-6309751570）；按 `ProjectError.recovery` 渲染。

Batch 3 回读（2026-10-21，导出以运行时 `Object.keys` 与 `tsc --noEmit` 核对）：以上签名与实际导出逐项一致，Batch 1、2 没有改动签名。`@harness-projects/core` 的包入口只导出 `createWorkspaceSetup` 与类型 `SetupOutcome`、`CreateWorkspaceRequest`、`ConnectAccountRequest`、`BindPlanningSourceRequest`、`WorkspaceSetup`；`runSetup`、`refuse`、`assertClosed`、`MountTarget`、`readMountTarget`、`writeMount` 只在 `packages/core/src/workspace-setup.ts` 内导出（D9）。`@harness-projects/controller` 导出 `createSetupCommands` 与类型 `SetupCommands`、`CreateWorkspaceInput`、`ConnectAccountInput`、`BindPlanningSourceInput`。controller 模块内的 `requestPayload` 改为泛型（D10）与 `setupResult` 都不对外导出。

依赖：Node 26（`.nvmrc`）、`pnpm install --frozen-lockfile`；只读引用 `apps/harness-plugin/src/host-providers.ts`（`PROVIDER_CATALOG`、`hostStoragePolicy`、`restoreProviders`）与 `tests/integration/fixtures/host-seed.js`（`WORKSPACE`、`HANDLE`、`projectNodeId`、`replayFetch`、`dump`，背后是 `tests/contract/fixtures/github-projects/` 的录制）。无凭据、无网络；`gh` 只用于 issue / PR 的仓库 REST。

## Outcomes & Retrospective

实施完成，待独立验收（2026-10-21，实现者（Claude Sonnet）；代码树为 Batch 2 提交 `66053f1` 之上的 Batch 3 文档提交，base `origin/main` @ `f131e68`）。推送、PR #371 回读与归档仍属协调者，见 `Progress`。

- 验收 1（命令建工作区并绑定 Project，下一次引导读到该项目）：内存替身与 SQLite 上成立——`disabled` 为 `[]`，引导 `entities 9`、`workItems 8`、`changeRequests 1`、`unanchored 0`，回放无未命中。
- 验收 2、3（第二个启用来源 `conflict`；只剩停用挂载时 `not_supported`）：成立，写入计数 0、库不变；并发绑定恰好一个成功。各自有删守卫即红的变异（M1–M3）。
- 验收 4（同键重发返回原结果、零写入，账本丢失后亦然）：成立，口径是 D2——成功与「状态未变时的拒绝」账本丢失后零写入返回原结果；「状态已变后的拒绝」重判属 TD-070。此解释需人类确认（Superseded by D16（2026-10-21）：已裁定）。
- 验收 5（凭据只以句柄落库）：成立（M5、M-c、M-d）；落盘扫描覆盖数据目录全部文件（存储未启用 WAL）与 base64，阳性对照找得到句柄名。
- 验收 6：`pnpm run boundaries` `ℹ tests 9`、`ℹ fail 0`。
- 全量：`pnpm run test`（root）`ℹ tests 1709`、`ℹ fail 2`（恰为两条已知 root 项，非 root 重跑 73 / 73）；`test:mvp0` 7 / 7；typecheck、workflow-check、disclosure、`git diff --check` 通过。
- 规模（`node scripts/rule-checks.mjs size origin/main`，Batch 3 提交之后）：代码 410 / 1000，文档 385 / 1500（增删之和；计划估计代码 + 测试 ≤ 800、文档 ≤ 1300）。
- 变异：Batch 1 的 M1–M6 与 M-a 到 M-e、Batch 2 的 M7–M8 与 M-f 到 M-j 共 18 条，每条都使对应用例变红（见 `Progress`）；Batch 3 只改文档，无变异。
- 与计划的偏差：用例比计划多（S6、S7 各补一条判别断言）；D10 记录实现细节而未改签名；第 2 行升级需人类确认（D11；Superseded by D16（2026-10-21）：已裁定）；承接列加 #354。

遗留与债务：

- TD-070（幂等键只在 `SetupCommands` 实例内保留）、TD-071（Host 不注入 `project`，空 Project 引导报 `not_found`）已入 `docs/exec-plan/tech-debt-tracker.md`，ExecPlan 列现指向 `active/`，归档时改为 `completed/`。
- 风险 R1–R6 仍成立；S9 指出的 TD-064 承接编号待 #353 订正。
- 下游：#353 在同一 `runSetup` 模式上加仓库绑定（S4）；#354 把命令接到 Host 远程操作并重组（D1、D5、TD-071）；#131 每次用户尝试铸造新幂等键（R4）。

独立验收（2026-10-21，独立验收（Claude Opus）；检出 `feature/workspace-binding-commands` @ `5d7897b`）：

- 结果：验收 1、2、3、5、6 成立，各有经变异证明的判别用例；验收 4 按 D2 的读法成立，被拒请求在前置条件变化后重判（TD-070）待人类确认（D12-1；Superseded by D16（2026-10-21）：已裁定）。没有 P0 / P1；被测代码未改。
- 与计划的偏差：测试补六处判别断言（S11，`2739772`），`refuse` 补调用约束注释（`5d7897b`）；S7 的「换句柄不可判别」订正；发现配置拒绝依赖回滚而非先于写入（S10，不是缺陷）。
- 规模（`node scripts/rule-checks.mjs size origin/main`，本节提交之后）：代码 424 / 1000，文档 426 / 1500。
- 遗留：D11 第 2 行升级是否成立待人类裁定（D12-2；Superseded by D16（2026-10-21）：已裁定记「部分」）；X7 原型检查无判别用例（P3，已由 #375 在本 PR 内补，D13）；提交 trailer 不一致一项已在协调者整理提交时处理（2026-10-21 评审回读：全部提交 trailer 相同）；最后一个提交不再是带 `Closes #127` 的那个，PR 描述须带 `Closes #127`；TD-070、TD-071 内容经读码核对属实（`readProject` 无注入时只能从观察反查，Host 的 `composeCore` 不传 `project`），编号不与并行的 #352 计划占用的 TD-069 冲突。

P3 并入（2026-10-21，实现者（Claude Opus）；检出 `feature/workspace-binding-commands` @ `8098f50`）：

- 结果：#375（X7 被杀）、#376（只有存储写口的 `RangeError` 映射成 `invalid_input`）各一个提交并关闭对应 issue；#384 一个提交（`sameMountTarget` 按值比较配置），只交付共享比较点与 `bindPlanningSource` 一半，提交只引用 #384，由 #373 关闭（D15）；改法与取舍见 D14，证据见「P3 并入证据」与 `Progress`。被测代码只改 `packages/core/src/workspace-setup.ts`，导出签名不变，新增导出 `sameMountTarget`。
- 规模（`node scripts/rule-checks.mjs size origin/main`，本节提交之后）：代码 456 / 1000，文档 474 / 1500。
- 对下游 #353 的契约（条件句，本层不含它的代码）：仓库绑定若经 `writeMount` 写挂载，即得到 #376 的写口映射；若以 `sameMountTarget` 判定相同目标，并在比较前要求配置是普通对象，即得到 #384 的按值比较（见 `Interfaces and Dependencies` 的下游契约）。

评审修复（2026-10-21，评审修复（Claude Opus）；检出 `feature/workspace-binding-commands` @ `7f3e6a6` 加本轮文档改动）：

- 结果：P1（#384 的关闭归属）、两条 P2（承接登记、`vertical-path.md` 第 1 行缺口）与本 PR 内可修的 P3（`bindPlanningSource` 字段类型、D14 / Outcomes 的下游表述、WAL 陈述、过期 trailer 句）都已处理，决定见 D15，证据见「评审修复证据」与 `Progress`。被测代码只改 `packages/core/src/workspace-setup.ts` 一行检查与一个辅助函数，导出签名不变。
- 规模（`node scripts/rule-checks.mjs size origin/main`，含本轮全部改动）：代码 466 / 1000，文档 531 / 1500。
- 协调者待办：`8098f50` 的提交正文与 PR 描述只引用 #384；PR 描述里 X7 一句改为全部被杀；与 #372 的简称表、tracker 行序冲突在 rebase 时合成。

回顾：设计期的验收表只列了验收级断言，Design 命令表里的几行（显示名 / 句柄不同的 `conflict`、固定文案映射）没有对应断言，直到变异核对才发现（S6、S7）。下次在设计期为命令表的每一行各列一个判别断言。


2026-10-21（三轮评审与归档，评审会话）：#127 的六条验收成立（验收 4 按人类批准改写后的措辞），#375、#376 关闭；#384 的 bindPlanningSource 一半在本 PR，bindRepository 一半与关闭在 #373（#353）。设置命令在 Host 里还没有调用方，接线交给 #354（承接义务已登记在 #354、#131）。
## Bottom Change Note

- 2026-10-21：创建。设计评审（Claude Opus，独立评审 subagent）把三份提案收敛为本计划，决策见 D1–D9。
- 2026-10-21：Batch 1 完成。Progress 记红 / 绿证据与变异表；新增 S6（固定文案映射原先无判别用例、SQLite 状态策略 CHECK）与 D10（`assertClosed` 写在 work 内、句柄必填、工作区字段检查）；`Interfaces and Dependencies` 签名未改。
- 2026-10-21：Batch 2 完成。Progress 记红 / 绿证据与变异表；新增 S7（换显示名的 conflict 原先无判别用例）；D10 追加 `requestPayload` 泛型化；`Interfaces and Dependencies` 签名未改。
- 2026-10-21：Batch 3 完成。tracker 追加 TD-070、TD-071；`vertical-path.md` 订正第 1、2 行与简称表（第 2 行升为部分，D11）；回填验证证据、Interfaces 回读与 Outcomes；新增 S8（占位包陈述过期）、S9（TD-064 的 #127 承接）与 D11。
- 2026-10-21：独立验收完成（独立验收（Claude Opus））。验收表 AC2、AC4、AC5 行随补充断言更新；新增「独立验收证据」、S10、S11、D12 与 Outcomes 的验收段；Progress 拆出协调者剩余项。
- 2026-10-21：P3 并入（实现者（Claude Opus））。按人类决定（D13）在本 PR 内实现 #375、#376、#384；范围行、Design 命令规则、验收表 AC2 / AC5 / 原子性行与新增一行、`Interfaces and Dependencies`（`runSetup` 注释、`sameMountTarget`、#353 / #354 下游契约）随之更新；新增「P3 并入证据」、S12、D13、D14 与 Outcomes 的 P3 段；D12-3 与 Outcomes 遗留里的 X7 标注为已补。
- 2026-10-21（协调者）：提交历史按人类伙伴的决定整理过两次（同树重写：先收敛为可审阅序列，再把作者与提交者统一为仓库所有者、保留 Co-Authored-By、去掉会话链接；每次推送前在本地留备份 ref，用精确 lease 推送）。所以正文里引用的提交号都是**整理前**的观察值，不在当前分支历史里；对应关系按提交标题（`<type>(<scope>): <摘要>`）认，被并入的提交见所在提交的正文。当前序列在检出 `feature/workspace-binding-commands` 的工作树根目录用 `git log --format="%h %s" origin/main..HEAD` 回读。
- 2026-10-21：评审修复（评审修复（Claude Opus））。按 PR #371 第一轮 MVP 交付评审修改：`bindPlanningSource` 先检查实现键与配置的类型（`7f3e6a6`，原子性用例加断言）；#384 的关闭归属改为由 #373 关闭（范围行、D13、Outcomes）；D14、Outcomes 与下游契约里 #353 的表述改为条件句；承接义务登记到 #354、#131 并在 tracker 附链接；`vertical-path.md` 第 1 行补回「列表与选择」；WAL 陈述与过期 trailer 句订正；Design 命令表与验收表原子性行随之更新。新增「评审修复证据」、S13、D15 与 Outcomes 的评审修复段。
- 2026-10-21（协调者）：记录评审会话转达的待决项结论（D16）：D2 接受、#127 验收 4 已按人类批准改写并判为成立、D11 第 2 行记「部分」；§2.1 生产入口规则补设置命令入口，TD-070 补「重放窗口 = 进程寿命」与转持久回执的触发条件；D11、D12 原处标注 Superseded。
- 2026-10-21：第二轮评审修复（实现者（Claude Opus））。按 PR #371 第二轮 MVP 交付评审：「AC4 账本丢失后同键重放」补新验收 4 后加三句的断言（`6441d92`，变异 R1 由存活变为两种存储上变红）；验收表第 4 行改为新验收 4 的措辞并引用这些断言；D2 与 Outcomes 三处「需人类确认」原处标注 Superseded by D16；Progress 记 R1 的红 / 绿与门禁。
- 2026-10-21（评审会话）：三轮评审通过后整合提交、变基到 main，计划归档；正文里整理前的提交号以提交标题对应。
