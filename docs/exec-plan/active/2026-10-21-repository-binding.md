# Repository Binding ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：完成 issue #353：一条绑定仓库命令在一个事务里写下一个仓库实体、它在 Local Git 与 GitHub Development（可选 GitHub Actions）下的并列引用及各自的连接；`routeDevelopment` 签名与调用点不变，按操作在并列引用之间路由；工作区快照逐仓库报告开始工作与 PR 谱系入口的可用性。不含：Host 远程操作与重组（#354）、Host 目录条目（#355）、绑定界面（#356）、开始工作对话框与「绑定仓库」恢复动作（#142）、谱系读取接线（#297）、解绑（M4.1）、仓库 node id（TD-064）。
> 上游输入：issue #353（正文，无评论）；#127 的 `docs/exec-plan/active/2026-10-21-workspace-binding-commands.md`（本 PR 叠在它上面，下称「#127 计划」）；`docs/exec-plan/completed/2026-10-08-development-repository-routing.md`（#219，D7、D23、D25–D28）；`docs/architecture/gate-e1-ruling.md` §4 R7；ADR-0006、ADR-0010；本 PR 新增 `docs/adr/ADR-0015-repository-references-side-by-side.md`（Proposed）；TD-035–TD-039、TD-054、TD-064；三份设计提案（最小闭环 / 系统 / 业界实践）经独立评审收敛为本计划。
> 执行上下文：分支 `feature/repository-binding`，工作树 `.worktrees/repository-binding`，base 是 #127 的分支 `feature/workspace-binding-commands`（draft PR #371；#127 合并后改为 `main`，以 `gh pr view <本 PR 号> -R "$REPO" --json baseRefName` 回读）。命令都在该工作树根目录运行，Node 26（`.nvmrc`）在 PATH 上，开始前执行过 `pnpm install --frozen-lockfile`；`REPO` 取 `gh repo view --json nameWithOwner -q .nameWithOwner`。

## Purpose / Big Picture

完成后，`WorkspaceSetup` 多一个成员 `bindRepository`：在一个 `runSetup` 事务里为每条新引用写挂载（锚点、账号、配置），再由唯一写者 `registerRepository` 写仓库实体、并列身份与仓库挂载；同请求重发零写入。controller 的 `SetupCommands.bindRepository` 走同一重放账本，成功报 `local_only`。开始工作的工作树与分支路由到 Local Git，变更请求读路由到 GitHub Development，歧义与未登记都结构化拒绝。工作区元数据为每个已登记仓库报告引用与按路由得到的 `development.*` 能力，经 controller 快照与 client 到达 ui-model 的 `repositoryAccessIndex`，两个 Development 挂载时不再被 key 级 fail closed 盖住。

最小成功证据：`tests/integration/workspace-setup-commands.test.js` 的 `AC1-353`、`AC4-353` 在内存替身与 SQLite 文件上全绿；`tests/e2e/repository-routing.test.js` 全绿；`tests/e2e/start-work.test.js`（#219 的 E 系列）不改一字仍全绿；变异 N1–N16 各有用例变红（Progress 记录）；全量测试只剩两条已知 root 失败。

## Context and Orientation

| 术语 | 含义 |
|---|---|
| 引用 | 仓库在一条连接下的外部身份 `(bindingId, repository, repositoryId)`；`repositoryId` 是宿主选定的工作区仓库键 |
| 锚点 | `RepositoryRecord.externalIdentityId` 指向的身份：首次登记写下的 primary，不改指 |
| 现行引用 | 锚点所在实体上、挂在已组合 Development 挂载下的 primary / alias 身份 |
| 操作 | 路由单位：锚点 key 选挂载，前置门（`earlier`）在同一挂载上判定（#219） |
| 声明者 | 有效能力列表含某 key 的挂载（不论访问级别） |

当前事实（base `06111e5` 读码核实；代码与 `main` 的 `f131e68` 相同）：

- F1：`RepositoryRecord` 只指向一条身份；`putRepository` 拒绝同 `(工作区, id)` 改指另一身份（`packages/capabilities/src/storage.ts` 仓库段）。审阅探针在两种存储上实测：同一实体上 primary + alias 被接受，改指被拒（`repository mount already points at another external identity`）。
- F2：每实体至多一个 primary 由部分唯一索引强制（`002_identity_membership.sql`），alias 被两种存储接受（`tests/contract/suites/storage-identity-membership.js`）；`003_control_facts.sql` 把 `repository.external_identity_id` 注为「R7 身份锚点」。
- F3：仓库引用的 `externalId` 是宿主键，平台寻址来自配置（`packages/providers/development-github/src/provider.ts` 的 `repository` 选项、`packages/providers/delivery-github-actions/src/provider.ts` 的 `targetOf`、`apps/harness-plugin/src/host-providers.ts` 的 Local Git 条目）。
- F4：Local Git 声明 `repository.read`、`branch.create`、`worktree.create`、`worktree.read`；GitHub Development 声明 `repository.read`、`change_request.read`；只重叠 `repository.read`。替身恒声明 `repository.read` 与 `change_request.read`（`packages/providers/fake/src/development.ts` 的 `declaredCapabilities`）。
- F5：`routeDevelopment` 按「身份 id 等于锚点」选唯一挂载（`packages/core/src/development-route.ts`）；开始工作以 `REGISTRATION_GATES` 为前置门；`registerParents` 无条件 `putRepository`（`packages/core/src/start-work.ts`），路由到 alias 时会被 F1 拒绝（S1）。
- F6：元数据按 key 经 `bindingForCapability` 汇总（`packages/core/src/queries.ts`），两个 Development 挂载时全部 `development.*` 不可用（TD-035）；人类裁决 D23 定「元数据按绑定给出，开始工作对话框按选中仓库判定，『绑定仓库』恢复动作随 #142」。
- F7：「工作区快照」是 controller 的 `queries.snapshot()` = `baseline()`，由 `getWorkspaceMetadata()` 组装成 `WireSnapshot`（`packages/controller/src/queries.ts`）；client 的 `assertHeader` 对能力项闭集校验，`store.ts` 的 `METADATA_KEYS` 对 metadata 帧闭集校验——wire 头新增字段而 client 不认，第一条同修订 metadata 帧就被拒、流终止（S2）。
- F8：同域写新默认会静默降级旧默认（`storage.ts` 挂载段）；delivery 只能有默认挂载（`packages/capabilities/src/registry.ts`）；交付读取按 key 取默认挂载（`packages/core/src/chain-facts.ts` 的 `readPipelines`）。
- F9：#127 计划提供 `createWorkspaceSetup`、`runSetup`、`refuse`、`assertClosed`、`MountTarget`、`readMountTarget`、`writeMount` 与 `createSetupCommands`；自然幂等、没有持久回执；锚点 id 随机生成；结果只含 id。
- F10：Host 目录只有 `planning.github-projects` 与 `development.local-git`（TD-054）：`development.github`、`github-actions` 的配置在 #355 之前被 Host 的存储策略拒绝。

主要不确定性：验收 3 的逐仓库可用性是否必须到达 wire？结论：必须（D4）。F7 说明「工作区快照」是 wire 快照、且任何 wire 头字段都要求 client 同 PR 接受；#142 验收 5 禁止「另一个可用连接使它可用」，排除了平铺到工作区级的做法。

## Design / Spec

### 方案比较

| | A 并列 alias + 按操作路由 + 逐仓库快照（采用） | B 引用 / 路由表 | C 每连接一个 primary | D 按 key 路由 + 工作区级平铺可用性 |
|---|---|---|---|---|
| 状态拥有 | 身份表与仓库挂载（已有） | 第二个权威源（#219 D1 否决） | 同 A，但改部分唯一索引 | 同 A |
| 失败路径 | 歧义与缺路由结构化拒绝 | 表与声明可能不一致 | 与 #190 的 `primary_identity_id` 冲突 | `repository.read` 恒歧义；平铺让别的仓库替它「可用」 |
| 代价 / 可逆 | 约 650 行；无迁移；纯代码回滚 | 迁移 + 端口 + 两个适配器 | 迁移 + R7 重裁 | 违反验收 2、3 |

### 绑定命令 `bindRepository`

请求 `{ workspaceId, repositoryId, references }`，每条引用是 #127 的 `MountTarget` 加 `domain`（`development` 或 `delivery`）。全部在一个 `runSetup` 里：

| 发现的状态 | 结果 |
|---|---|
| 请求或引用不是闭集、字段类型不对、`references` 为空、`repositoryId` 空白、`domain` 不在两域内、同 `(domain, implementationKey)` 出现两次、两条 delivery | `invalid_input`（固定文案，不回显输入） |
| 工作区不存在，或引用的账号不存在 | `not_found` |
| 仓库未登记，请求里没有 Development 引用 | `invalid_input` |
| 仓库已登记，但锚点不在本工作区任何挂载下 | `conflict`（不猜实体） |
| 已有同 `(domain, implementationKey)` 的引用且 `readMountTarget` 深等 | 复用它的 `bindingId`，零写入 |
| 已有同 `(domain, implementationKey)` 的引用而目标不同 | `conflict`：本版本不改绑 |
| 新 delivery 引用，而工作区已有启用的 delivery 挂载 | `conflict`：不替换交付来源（F8） |
| 其余新引用 | `writeMount`（`newProviderBindingId()`；development 非默认，delivery 默认）；全部挂载写完后 `registerRepository` |
| 配置不合 schema（Storage `RangeError`） | `invalid_input`，整笔回滚 |

结果 `{ repositoryId, bindingIds }`，`bindingIds` 按请求顺序；请求里没提到的已有引用保持不动（只追加、不卸载）。`registerRepository(tx, ids, workspaceId, repositoryId, bindingIds)`：仓库未登记时，第一个 binding 下找到或新建身份（新建即新实体上的 primary），其余新建 alias，最后 `putRepository` 指向第一个；已登记时，每个 binding 下已有的身份必须在锚点实体上（否则抛错、事务回滚），缺的补 alias，不碰 `putRepository`。绑定命令传入「第一条 Development 引用在前」的新建 binding 列表；开始工作传 `[路由到的 binding]`，已登记即零写入（修 S1）。

### 路由（`routeDevelopment` 签名不变）

| 仓库状态 | 选挂载 |
|---|---|
| 未登记 | 不变：唯一挂载；多个挂载 conflict，文案不变（D8） |
| 已登记、没有现行引用 | 不变：缺路由 conflict（单挂载先过门） |
| 恰一条现行引用 | 它（与 #219 相同） |
| 多条，恰一条声明锚点 key | 它；前置门按调用方顺序在它上面判定 |
| 多条，没有声明者 | `not_supported`（锚点 key） |
| 多条，多个声明者 | `conflict`：列出连接，含「不取第一个注册者」，零 provider 调用 |

现行引用由 `repositoryReferences(storage, record, bindingIds)` 求得：各挂载下 `findExternalIdentity`，只留锚点所在实体上的 primary / alias（锚点挂载未组合时经 `listIdentitiesForEntity` 确认实体）；同名但属于别的实体的身份不算。两个操作常量放在 `development-route.ts`：`START_WORK_ROUTE`（锚点 `worktree.create` 写，前置 `branch.create` 写、`repository.read` 读、`worktree.read` 读，即今天的 `REGISTRATION_GATES`；报告这四个 key）与 `CHANGE_REQUEST_READ_ROUTE`（锚点 `change_request.read` 读，前置 `repository.read` 读；只报告 `change_request.read`）。

### 逐仓库可用性

- core：`WorkspaceMetadata.repositories` 按 id 升序，每个仓库带 `references`（现行引用的 `bindingId` 与 `role`）与 `capabilities`：对每个操作调 `routeDevelopment`，成功则该操作报告的每个 key 取 `route.binding` 的有效能力（`bindingId` 即服务者），被拒则这些 key 报 `unavailable`、`reason` 为拒绝文案。工作区级 `capabilities` 不变。`unavailableCore` 的元数据补 `repositories: []`。
- controller：`WireWorkspaceHeader.repositories?`，有已登记仓库时才出现；条目 `{ id, capabilities }`，能力项去掉 `bindingId`，不下发引用；快照、delta、metadata 帧都携带，进 `sourceSignature`。
- client：`assertHeader` 校验 `repositories`（闭集 `{ id, capabilities }`、`id` 非空且唯一、能力项沿用同一校验）；`METADATA_KEYS` 加 `repositories`；`sync` 的帧头与 `read()` 携带它。
- ui-model：`repositoryAccessIndex(workspace, repository)` = 工作区级索引再由该仓库条目覆盖；`startWorkAvailability` 与 `lineageEntryPoints` 不变。`derive.ts` 不改：选哪个仓库归 #142。

### 不变量与刻意不做

不变量（`AGENTS.md` §1.1）：1、3 不写规划事实，`planning` 域引用被拒；2 一个仓库多条 Development 连接；5 关联只由命令显式写下，按声明选择，不探测、不取第一个注册者；6 一个实体，懒登记复用它；7 可用性在 core 计算，client 与 ui-model 只消费；本地写报 `local_only`，凭据只以账号 id 引用。依赖方向不变：core 只引 capabilities、domain 与 `node:util`；client 只多引 controller 的类型；ui-model 不新增依赖。

刻意不做：Storage 端口、迁移、新错误码；按实现键核对能力域或配置里的仓库键（与 #127 D5 一致，TD-076）；`derive.ts` 的仓库选择与「绑定仓库」恢复动作（#142）；工作区级 `development.*` 的原因文案；谱系读取接线（#297）；按仓库路由交付读取（TD-074）。

### 风险与技术债务

拟登记（编号从 TD-074 起；TD-069–073 由并行 PR 保留）：

- TD-074（core 交付）：每工作区一个交付来源；Actions 引用记为 alias，交付读取仍按 key 取默认挂载，第二个仓库绑不了自己的 Actions（`conflict`）。下一步：#233 的按跳锚定，或新 issue 按仓库路由交付读取。
- TD-075（core 查询）：每次快照对每个已登记仓库跑两次路由（仓库数 × 挂载数次存储读），叠加 TD-057 的每流每秒轮询。下一步：随 TD-057 的存储变更通知，或按修订号缓存。
- TD-076（core 绑定）：配置对 core 不透明，不核对各连接配置里的仓库键等于 `repositoryId`；不一致只在开始工作的仓库 ack 或交付读时 fail closed（`not_found`）。下一步：#355 的目录条目与 #356 的表单从同一个 `repositoryId` 生成配置并补用例。
- TD-077（core 路由）：不同实现键的两条引用声明同一锚点 key 时路由恒拒，本版本没有解绑或改绑。下一步：M4.1 的解绑 issue 定义移除引用。
- 更新：TD-035、TD-039 关闭；TD-036 收窄（实体经 `listIdentitiesForEntity` 确认，`externalId == repositoryId` 的约定保留）；TD-037 的下一步改为「#297 用 `CHANGE_REQUEST_READ_ROUTE` 读变更请求与远端分支头」；TD-038 收窄（生产写者已有，过期挂载行与解绑仍开放）；TD-054 补「`development.github` 与 `github-actions` 的配置字段与本 PR 测试声明的 `repositoryExternalId`、`repositoryOwner`、`repositoryName` 一致」。

风险：R1 #127 落地的辅助函数签名与计划不同 → 只改本 PR 调用点。R2 client 三个文件与 PR B（#229）同包 → 只加不改，后合并者 rebase。R3 #297 之前 PR 谱系入口报可用而跳是缺口（安全、不会读错）→ #297 紧随其后。R4 #355 之前 Host 内绑定 GitHub 引用得 `invalid_input`（F10）→ #356 已被 #355 阻塞。R5 开始工作按「未登记、单挂载」路由后、认领前有并发绑定 → `registerRepository` 抛错、认领回滚，结果 `unavailable` 且无外部写入。R6 ADR-0015 被否决 → Batch 1–2 的身份写法要改，Batch 3 不受影响。

## Global Constraints

- 本 PR 只写这些文件（估计改动行，相对 base；代码 + 测试 ≤ 800，文档 ≤ 1300）：`packages/core/src/development-route.ts`（约 80）、`packages/core/src/start-work.ts`（约 20）、`packages/core/src/workspace-setup.ts`（#127 的文件，追加约 75）、`packages/core/src/index.ts`（命名再导出 3 个类型）、`packages/core/src/queries.ts`（约 30）、`packages/core/src/context.ts`（1）、`packages/controller/src/commands.ts`（约 8）、`packages/controller/src/wire.ts`（约 15）、`packages/client/src/workspace-read.ts`（约 14）、`packages/client/src/store.ts`（1）、`packages/client/src/sync.ts`（约 3）、`packages/ui-model/src/capability-access.ts`（约 6）、`tests/integration/workspace-setup-commands.test.js`（#127 的文件，追加约 150）、`tests/e2e/repository-routing.test.js`（新，约 230）；既有测试只在钉死了帧头完整形状时随 `repositories` 调整（预留约 15）。文档：本 ExecPlan、`docs/adr/ADR-0015-repository-references-side-by-side.md`、`docs/adr/README.md`（索引一行）、`docs/exec-plan/tech-debt-tracker.md`。合计约 650 行代码 + 测试、约 370 行文档（本计划约 300、ADR 56、索引与债务约 15）。
- 不改：`apps/**`（#352、#229）、`packages/capabilities/**`、`packages/domain/**`、`packages/storage/**`、迁移、`packages/providers/**`、`packages/core/src/chain-facts.ts`（#297）、`packages/ui-model/src/derive.ts`（#142）、`packages/ui/**`、`docs/README.md`（协调者维护索引）、`docs/architecture/gate-e1-ruling.md`（ADR-0015 采纳后才改）、`tests/e2e/start-work.test.js`。
- 前置：#127 计划的 Batch 1、2 已提交到 `feature/workspace-binding-commands`，本分支先建 backup ref 再 rebase 到它上面；本 PR 不另造幂等或事务机制，只用 F9 的辅助函数。
- Node 以 strip-only 执行 TS：不用参数属性、`enum`、`namespace`；包内相对导入带 `.ts`。
- 测试不触网；绑定命令的文案与 `attemptedValue` 不回显请求值（路由文案沿用 #219，含仓库键与连接 id）；令牌哨兵沿用 `ghp_CANARY_…` 形状；不构建插件产物（若排查时跑过 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`，先删 `apps/harness-plugin/dist`，否则 `tests/e2e/delivery-lineage.test.js` 会因扫描 `apps/**` 变红，#350）。
- TDD：每批先写会失败的判别性测试；提交 `<type>(<scope>): <中文摘要>`，正文末尾 `Refs #353`（最后一个提交 `Closes #353`）；不推 `main`、不自行合并；发布面按 `docs/development/publication.md` 扫描。

## Plan of Work

批次全部串行：Batch 1–3 共写 `development-route.ts` 或同一测试文件；Batch 4 的文档可在 Batch 1 提交后并行起草，门禁只在 Batch 3 之后跑。

### Batch 1 · 绑定命令与唯一写者（建议 Opus，高推理：身份写入、写序与状态拥有）

**最小闭环**：验收 1、4 与拒绝、原子性在两种存储上成立；开始工作的懒登记改走同一写者且行为不变。
**涉及文件**：`development-route.ts`、`start-work.ts`、`workspace-setup.ts`、core `index.ts`、controller `commands.ts`、`tests/integration/workspace-setup-commands.test.js`。

- [ ] 测试先行：给文件内 `openStore(kind)` 加可选 `policy` 参数（缺省仍是 `hostStoragePolicy(PROVIDER_CATALOG)`）；本批用例的策略在其上补 `development.github` 与 `github-actions` 的配置 schema（`repositoryExternalId`、`repositoryOwner`、`repositoryName`，均为字符串）。写 `Validation and Acceptance` 的 1、4 与「拒绝」「原子性」四条（每条两种存储），跑出红：`setup.bindRepository is not a function`。
- [ ] 在 `development-route.ts` 实现 `repositoryReferences` 与 `registerRepository`；`registerParents` 改为调 `registerRepository(tx, context.ids, context.workspaceId, request.repositoryId, [bindingId])`，其后的上下文与工作树实体不变。
- [ ] 在 `workspace-setup.ts` 按 Design 的表实现 `bindRepository`（目标比对用 `readMountTarget` + `isDeepStrictEqual`，写入用 `writeMount`）；`commands.ts` 的 `createSetupCommands` 加同名成员，走同一个 `replay` 与同一套结果映射。
- [ ] 变异核对并记入 Progress：N1 目标相同仍 `writeMount`；N2 去掉交付来源预检；N3 去掉目标比对；N4 `registerRepository` 挪到 `writeMount` 之前；N5 primary 取最后一条 Development 引用；N6 去掉 `(domain, implementationKey)` 重复检查。

**验证**：

```bash
node --test tests/integration/workspace-setup-commands.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 红（实现前）：新增 8 条失败；绿：ℹ fail 0
node --test tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/provider-binding-registration.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 期望：ℹ fail 0（懒登记行为不变）
pnpm run typecheck && pnpm run boundaries   # 期望：退出码 0，ℹ fail 0
```

**回滚**：`git revert` 本批提交；没有 schema 或数据迁移。

### Batch 2 · 按操作在并列引用之间路由（建议 Opus，高推理：路由与 #219 回归）

**最小闭环**：验收 2 成立，#219 的 E 系列不改一字仍全绿。
**涉及文件**：`development-route.ts`、`start-work.ts`、`tests/e2e/repository-routing.test.js`（新）。

- [ ] 测试先行（`ADAPTERS` 模式，替身 Storage 与 SQLite 文件各一遍）：经 `createWorkspaceSetup` 建工作区并绑定仓库（测试策略为测试实现键声明空 schema），再以返回的 `bindingIds` 组合替身。Local Git 型替身：Proxy 覆盖 `definition`（实现键 `test.local-git`）并从 `describeCapabilities` 去掉 `change_request.read`。GitHub 型替身：`capabilities` 关掉建分支、工作树三项与创建变更请求，实现键 `test.github`。两者都记录调用。先写「AC2 声明一致」：两种替身声明的 key 集合分别等于真实 `createLocalGitDevelopmentProvider` 与 `createGithubDevelopmentProvider`（transport 抛错）的声明。再写「AC2 并列引用」「AC2 歧义」两条，跑出红。
- [ ] 实现选择规则（Design 路由表）；`START_WORK_ROUTE`、`CHANGE_REQUEST_READ_ROUTE` 移入 `development-route.ts`，`start-work.ts` 删除 `REGISTRATION_GATES` 改用前者。
- [ ] 变异核对：N7 多条引用取第一条；N8 多个声明者取第一个；N9 `registerRepository` 已登记仍 `putRepository`；N10 现行引用不核对实体（期望 `start-work.test.js`「仓库挂载的身份属于未挂载的连接时 conflict，即使某个挂载下恰有同 id 的别家身份」变红）；N11 没有声明者时退回第一条。

**验证**：

```bash
node --test tests/e2e/repository-routing.test.js tests/e2e/start-work.test.js tests/integration/provider-binding-registration.test.js tests/integration/start-work-sqlite-registration.test.js tests/e2e/delivery-lineage.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 红（实现前，路由只认锚点）：GitHub 为 primary 时开始工作被拒、两条 Local Git 型时没有拒绝；绿：ℹ fail 0
pnpm run typecheck   # 期望：退出码 0
```

**回滚**：`git revert` 本批提交（Batch 1 仍独立成立：路由回到只认锚点）。

### Batch 3 · 逐仓库可用性经快照到达 client 与 ui-model（建议 Sonnet，中推理）

**最小闭环**：验收 3、5 成立；没有已登记仓库时 wire 与今天逐字相同。
**涉及文件**：`queries.ts`、`context.ts`、controller `wire.ts`、client `workspace-read.ts` / `store.ts` / `sync.ts`、ui-model `capability-access.ts`、`tests/e2e/repository-routing.test.js`（追加）。

- [ ] 测试先行：「AC5」与「AC3」两条（两种存储），跑出红（`repositories` 不存在）。
- [ ] 实现 Design「逐仓库可用性」四层。
- [ ] 跑下方既有套件；只有钉死帧头完整形状的断言随 `repositories` 调整，并在 Progress 写明改了哪条。
- [ ] 变异核对：N12 元数据仍按 key 解析；N13 `repositoryAccessIndex` 不覆盖仓库条目；N14 `METADATA_KEYS` 不含 `repositories`；N15 `toWireMetadata` / `diffSnapshots` 丢 `repositories`；N16 同一 key 由两个操作报告。

**验证**：

```bash
node --test tests/e2e/repository-routing.test.js tests/e2e/workspace-read-assembly.test.js tests/e2e/controller-roundtrip.test.js tests/e2e/client-sync.test.js tests/e2e/client-stream.test.js tests/e2e/workspace-stream.test.js tests/contract/ui-model-presentation.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 期望：ℹ fail 0
pnpm run typecheck && pnpm run boundaries   # 期望：退出码 0，ℹ fail 0
```

**回滚**：`git revert` 本批提交；wire 字段是可选的，回滚后 client 与 Host 照旧。

### Batch 4 · 文档、门禁与 draft PR（建议 Sonnet，低推理）

**最小闭环**：债务、ADR 索引与代码同 PR 更新，门禁全过。
**涉及文件**：`docs/adr/README.md`、`docs/exec-plan/tech-debt-tracker.md`、本 ExecPlan（ADR-0015 正文已随计划写好，只在实现推翻其事实时就地订正）。

- [ ] `docs/adr/README.md` 索引加 ADR-0015（Proposed）一行，来源段落补一句并把「上表十四条」改为十五条；tracker 追加 TD-074–077，按 Design 更新 TD-035–039 与 TD-054 的状态与下一步。
- [ ] 跑门禁；整理提交；开 draft PR（`Closes #353`、ExecPlan + Batch、验证证据、风险、回滚、待人类决定 H1）；回读 head、base、issue 关联与 checks。

**验证**：

```bash
pnpm run typecheck && pnpm run boundaries
pnpm run test 2>&1 | grep -E '^✖ ' | sort -u
# 期望（root 运行）：除 `✖ failing tests:` 汇总头外只有两条已知标题——tests/integration/development-local-git.test.js「拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功」
#   与 tests/contract/run-test-layer.test.js「真实层 tests/integration：非空、全绿，且摘要行被透传」（后者只因前者而红）；任何其它失败都不是已知项
runuser -u <非 root 用户> -- env "PATH=$PATH" node --test tests/integration/development-local-git.test.js 2>&1 | grep -E '^ℹ (tests|fail)'
# 期望：ℹ tests 73、ℹ fail 0（证明上面两条只是 root 下 chmod 000 仍可读）
pnpm run test:mvp0 2>&1 | grep -E '^ℹ fail'   # `pnpm verify` 在 test 失败时短路，root 下单独跑；期望：ℹ fail 0
BASE=origin/$(gh pr view feature/repository-binding -R "$REPO" --json baseRefName -q .baseRefName)   # 开 PR 前用 origin/feature/workspace-binding-commands
node scripts/workflow-check.mjs && node scripts/rule-checks.mjs disclosure "$BASE" && node scripts/rule-checks.mjs size "$BASE"
git diff --check "$BASE"...HEAD   # 期望：无输出；size 报告代码 + 测试 ≤ 800、文档 ≤ 1300
```

**回滚**：文档提交单独 `git revert`。

## Validation and Acceptance

两种存储即内存替身与 SQLite 文件（`<kind>` / `<label>`）。命令：`node --test tests/integration/workspace-setup-commands.test.js tests/e2e/repository-routing.test.js`。

| # | 验收项（issue #353） | 用例标题前缀 → 判定证据 |
|---|---|---|
| 1 | 一个内部仓库并列持有 Local Git 与 GitHub 引用及所属连接；同键重发零写入（两种存储） | `workspace-setup-commands`「AC1-353」：建工作区、连账号后绑定 `[Local Git, GitHub]` → 恰一个 `repository` 实体，其上恰两条身份（Local Git primary、GitHub alias），各自的 `bindingId` 是启用的 development 挂载，实现键、账号与配置等于请求，仓库挂载指向 primary。经 `createSetupCommands` 同键重发：账本内，以及 `reopen` 后新建的实例，都与首次 `CommandResult` 深等，写入计数 0，`snapshot` 不变；新键同请求也零写入（N1、N4、N5） |
| 2 | Local Git 与 GitHub 同挂一个工作区：工作树与分支创建选 Local Git，PR 读选 GitHub；未登记或歧义 key 结构化拒绝，不取第一个注册者 | `repository-routing`「AC2 声明一致」。「AC2 并列引用」：开始工作 Saved，只有 Local Git 型收到调用、GitHub 型 0 次；引用顺序反过来（GitHub 为 primary）同样成立。「AC2 歧义」：两条 Local Git 型引用（实现键不同）→ `conflict`，文案含两个 `bindingId` 与「不取第一个注册者」，零调用、无上下文；两条 GitHub 型（实现键不同）→ `not_supported`，文案点名锚点 key `development.worktree.create`（不是第一道门）。PR 读的选择由「AC5」的 `change_request.read` 服务者给出。未登记仓库由 `start-work.test.js` 的「两个 Development 挂载、仓库没有登记」「三个 Development 挂载、仓库没有登记」两条继续守（N7–N11） |
| 3 | 开始工作与 PR 谱系入口按仓库报告可用 / 不可用，不被 key 级 fail closed 盖住（经工作区快照） | `repository-routing`「AC3」：R1 绑 Local Git + GitHub，R2 只绑 GitHub，R3 只绑 Local Git。数据走 `createController(core).baseline()` → client `createSync` → `read().repositories` → `repositoryAccessIndex` → `startWorkAvailability` / `lineageEntryPoints`：R1 两者都可用；R2 开始工作不可用、变更请求入口可用；R3 相反。工作区级 `development.worktree.create` 仍是 `unavailable`。之后推一条同修订 metadata 帧，client 接受且 `repositories` 不变（N12–N15） |
| 4 | GitHub Actions 可作为已绑定仓库的交付来源加入 | `workspace-setup-commands`「AC4-353」：先绑 `[Local Git, GitHub]`，再以新键绑 `[Actions]` → 只新增一个启用、默认的 delivery 挂载及其账号与配置，以及同一实体上的 alias，结果 `bindingIds` 为 `[Actions]`；同请求重发零写入。同仓库换 Actions 配置、或另一仓库绑 Actions，都得 `conflict`，且写入计数 0、`snapshot` 不变（N2） |
| 5 | 元数据按 Development 连接报告，绑定记下服务连接，即 #219 路由读取的那份 | `repository-routing`「AC5」：R1 的 `references` 为 `[{Local Git, primary}, {GitHub, alias}]`；开始工作的四个 key 的 `bindingId` 是 Local Git，`change_request.read` 的是 GitHub；每个 key 恰好一条。开始工作实际调用的挂载与之相同（N12、N16） |
| — | 拒绝与原子性 | `workspace-setup-commands`「绑定仓库拒绝」覆盖 Design 表中的 `invalid_input` / `not_found` / `conflict` 各行，「绑定仓库原子性」覆盖配置不合 schema：两种情形都写入计数 0、`snapshot` 不变（N3、N6） |
| — | 边界与 #219 回归 | `pnpm run boundaries` → `ℹ fail 0`；`node --test tests/e2e/start-work.test.js` → `ℹ fail 0`，且该文件无 diff |

## Progress

- [x] 2026-10-21 设计评审完成：三份提案经独立评审收敛；审阅探针在两种存储上证实 F1（primary + alias 可共存、仓库挂载不可改指）。
- [ ] Batch 1 · 绑定命令与唯一写者（含 N1–N6）
- [ ] Batch 2 · 按操作在并列引用之间路由（含 N7–N11）
- [ ] Batch 3 · 逐仓库可用性经快照到达 client 与 ui-model（含 N12–N16）
- [ ] Batch 4 · 文档、门禁与 draft PR
- [ ] 待人类决定 H1：ADR-0015 是否按原文采纳（不阻塞实现；PR 描述列出）

## Surprises & Discoveries

- S1：`registerParents` 无条件 `putRepository`；路由一旦能到 alias，已登记仓库的开始工作会被 F1 拒绝，认领事务回滚并得 `unavailable`「本地登记失败」。审阅探针在两种存储上复现了这条拒绝。
- S2：client 的 metadata 帧键是闭集（`packages/client/src/store.ts` 的 `METADATA_KEYS`）。所以 wire 头上的新字段必须与 client 同 PR 落地；只改 controller 会让第一条同修订 metadata 帧终止流。
- S3：三份提案都假设 #127 提供持久回执（`runIdempotent`）。#127 计划 D2 不提供，本计划改用自然幂等：仓库挂载加逐引用的目标比对。
- S4：替身 Development provider 恒声明 `change_request.read`。Local Git 型替身要靠 Proxy 去掉它，并用「AC2 声明一致」钉住替身与真实 provider 的声明相等。
- S5：TD-035 记下的人类裁决 D23 把「绑定仓库」恢复动作与按选中仓库判定的对话框都放在 #142，支持 D8 与 D4 的切分。

## Decision Log

以下决策日期均为 2026-10-21，作者：设计评审（Claude Opus，独立评审 subagent）；人类可推翻。

- **D1 模型：一个实体 + 并列 alias 身份，无 schema 改动**（三份提案一致）。证据：F1、F2、F3；`primary` 每实体唯一由索引强制，#190 计划 `primary_identity_id` 列。
- **D2 写 ADR-0015（Proposed）**（采纳系统 / 业界提案，否决最小提案的「不写」）。证据：issue Notes「identity semantics change 则写 ADR」；本 PR 首次给 `alias` 生产语义；`repository.external_identity_id` 被注为「R7 身份锚点」。结论：R7 文本不改、逐字成立（仓库引用的 `external_id` 是宿主键，从不作平台参数），ADR 写明这条约束与 TD-064 的边界；ADR-0010 不受影响（它只管规划实体作 URL locator，仓库键不是）。采纳权在人类伙伴（H1）；Proposed 不阻塞合并，先例为 ADR-0013、ADR-0014。
- **D3 按操作路由，按声明选择**（三份提案一致）。单引用行为与 #219 相同；多引用时取唯一声明锚点 key 的那条；没有声明者报 `not_supported`（锚点 key），多个声明者报 `conflict`。证据：F4 的 `repository.read` 重叠，且开始工作的前置门含它。业界：Git 的 `pushRemote` 与多远端时的 `checkout.defaultRemote`。
- **D4 逐仓库可用性到达 wire、client 与 ui-model**（采纳系统 / 业界提案，否决最小提案「止于 core 或平铺到工作区级」）。证据：F7「工作区快照」即 `WireSnapshot`；S2 表明任何 wire 字段都要求 client 同 PR 接受；#142 验收 5 禁止平铺。形状上用独立的可选头字段 `repositories`，否决业界提案「能力项加 `repositoryId`」：后者改写既有 `capabilities` 数组的含义，`accessIndex` 后者覆盖前者，会让某仓库的条目替工作区「可用」。`derive.ts` 留给 #142。
- **D5 唯一写者 `registerRepository`，开始工作的懒登记保留并共用它**（采纳系统 / 业界提案）。证据：TD-039 的下一步原文「保留则两者共用一个登记函数」；#219 D7 与 M31（去掉懒登记 98 条变红）；S1。
- **D6 命令创建挂载，逐引用按 `(domain, implementationKey)` create-or-verify，只追加不改指**。依据：#127 的 D4（id 随机生成）与 D8（结果只含 id）；否决最小提案的调用方给定 `bindingId`。每仓库每实现键至多一条引用，换目标直接 `conflict`，不留下必然歧义的第二条。
- **D7 交付来源**：拒绝第二个、不替换（三份提案一致，证据 F8）；Actions 以默认 delivery 挂载加同实体 alias 挂到仓库上，可随后以同一命令加入（采纳业界提案，覆盖验收 4「added to the bound repository」的两种读法）。
- **D8 未登记 + 多挂载的歧义文案保持不变**（否决三份提案的改写）。理由：绑定命令只会新建连接，不能把仓库挂到已挂载的那几条歧义连接上，所以文案里的三步仍是该状态下唯一走得通的恢复。#219 的 D25 / D28 要求文案只写走得通的步骤并做 `$` 锚定。「绑定仓库」恢复动作归 #142（S5）。附带效果：#219 计划里的 E2、E15 用例零改动。
- **D9 不新增错误码**（#219 D6）；绑定命令不核对实现键的能力域与配置里的仓库键（与 #127 D5 一致，TD-076）。
- **D10 体量**：估计约 650 行，不需要切。已移出的部分：`derive.ts` 的仓库选择（#142）、谱系读取接线（#297）、目录条目（#355）、Host 远程操作（#354）。若实测超过 800，先合并「拒绝」用例的表，再把「AC2 声明一致」移到 #355。

## Idempotence and Recovery

- 运行期：`bindRepository` 可任意重发。同请求零写入；失败整笔回滚，不留半写的挂载或身份（「拒绝」「原子性」两条用例）。账本丢失后，被拒请求在状态改变后会重新判定，这是 #127 的 TD-070 已登记的残余。
- 测试：每条用例用自己的 `mkdtemp` 目录或内存实例，可重复执行。
- Git：每批一个可独立回滚的提交。整理提交或重推前先建 backup ref，再用精确的 `--force-with-lease`；rebase 到 #127 的新 head 之前同样先建 backup ref，复杂改写走 `git-expert-operations` 流程。回到已知良好状态：`git revert` 对应批次，或把分支重置到 backup ref。
- 数据：没有迁移。命令写出的行是既有表的普通行，回滚代码不需要修数据。

## Interfaces and Dependencies

本 PR 供下游使用的签名（Batch 1 推送后冻结；`development-route.ts` 不进 core 包入口，core 内相对引用，#297 同样）：

```ts
// packages/core/src/workspace-setup.ts（index.ts 命名再导出这三个类型）
export interface RepositoryReferenceRequest extends MountTarget { readonly domain: Extract<CapabilityDomain, 'development' | 'delivery'> }
export interface BindRepositoryRequest { readonly workspaceId: WorkspaceId; readonly repositoryId: string; readonly references: readonly RepositoryReferenceRequest[] }
export interface RepositoryBinding { readonly repositoryId: string; readonly bindingIds: readonly ProviderBindingId[] }
bindRepository(request: BindRepositoryRequest): Promise<SetupOutcome<RepositoryBinding>> // WorkspaceSetup 新成员
// packages/core/src/development-route.ts：DevelopmentRouteSource.storage 的 Pick 增加 'listIdentitiesForEntity'；routeDevelopment 签名不变
export interface DevelopmentOperation { readonly anchor: DevelopmentGate; readonly earlier: readonly DevelopmentGate[]; readonly reports: readonly CapabilityKey[] }
export const START_WORK_ROUTE: DevelopmentOperation
export const CHANGE_REQUEST_READ_ROUTE: DevelopmentOperation
export function repositoryReferences(storage: Pick<Storage, 'findExternalIdentity' | 'listIdentitiesForEntity'>, record: RepositoryRecord, bindingIds: readonly ProviderBindingId[]): Promise<readonly ExternalIdentity[]>
export function registerRepository(tx: StorageTransaction, ids: Pick<IdFactory, 'entityId' | 'externalIdentityId'>, workspaceId: WorkspaceId, repositoryId: string, bindingIds: readonly ProviderBindingId[]): Promise<void>
// packages/core/src/queries.ts：WorkspaceMetadata 新必填字段 readonly repositories: readonly RepositoryMetadata[]
export interface RepositoryMetadata { readonly id: string; readonly references: readonly { readonly bindingId: ProviderBindingId; readonly role: IdentityRole }[]; readonly capabilities: readonly EffectiveCapability[] }
// packages/controller
export type BindRepositoryInput = CommandEnvelope & BindRepositoryRequest
bindRepository(input: BindRepositoryInput): Promise<CommandResult<RepositoryBinding>> // SetupCommands 新成员
export interface WireRepositoryEntry { readonly id: string; readonly capabilities: readonly WireCapabilityEntry[] }
// WireWorkspaceHeader 与 client 的 ClientWorkspaceRead 新可选字段：readonly repositories?: readonly WireRepositoryEntry[]
// packages/ui-model/src/capability-access.ts
export function repositoryAccessIndex(workspace: readonly CapabilitySnapshotEntry[], repository: readonly CapabilitySnapshotEntry[]): ReadonlyMap<string, AccessLevel>
```

需要 #127 配合（请协调者转达）：① controller 的 `SetupOutcome → CommandResult` 映射（`ok` → `local_only`、`conflict` → `conflict`、其余 → `failed`）写成 `commands.ts` 内一个模块私有函数，供 `bindRepository` 复用；② `readMountTarget` 的返回值总带 `accountId` 键（值可为 `undefined`）、配置缺席给 `{}`，本 PR 用 `isDeepStrictEqual` 比较；③ 测试文件的 `openStore(kind)` 接受可选 `policy`（#127 不加则本 PR 加）。其余辅助函数（`runSetup`、`refuse`、`assertClosed`、`MountTarget`、`writeMount`、`createSetupCommands` 的 `replay`）都已在 #127 的 Interfaces 里。

下游契约：#297 的变更请求读与远端分支头读都用 `CHANGE_REQUEST_READ_ROUTE`，不单独按 `repository.read` 路由；#354 的远程操作调 `SetupCommands.bindRepository`、填固定 `WORKSPACE_ID`、`ok` 后重组；#355 的 `development.github` 与 `github-actions` 条目配置含 `repositoryExternalId`、`repositoryOwner`、`repositoryName`；#356 从同一个 `repositoryId` 生成各引用的配置（TD-076）；#142 列出 `read.repositories`、按 `repositoryAccessIndex` 判定可用性并接手「绑定仓库」恢复动作；PR B（#229）与本 PR 在 `packages/client/src/workspace-read.ts`、`store.ts`、`sync.ts` 都只追加，后合并者 rebase 并重跑 Batch 3 的验证。

依赖：Node 26（`.nvmrc`）、`pnpm install --frozen-lockfile`；只读引用 `apps/harness-plugin/src/host-providers.ts`（`PROVIDER_CATALOG`、`hostStoragePolicy`）与真实的 `@harness-projects/provider-development-local-git`、`@harness-projects/provider-development-github`（只取声明）。无凭据、无网络；`gh` 只用于 issue 与 PR 的仓库 REST。

## Outcomes & Retrospective

未开始。

## Bottom Change Note

- 2026-10-21：创建。设计评审（Claude Opus，独立评审 subagent）把三份提案收敛为本计划，决策见 D1–D10；同时写 `docs/adr/ADR-0015-repository-references-side-by-side.md`（Proposed）。
