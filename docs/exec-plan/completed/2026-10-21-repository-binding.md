# Repository Binding ExecPlan

> 状态：Active
> 创建：2026-10-21
> 范围：完成 issue #353：一条绑定仓库命令在一个事务里写下一个仓库实体、它在 Local Git 与 GitHub Development（可选 GitHub Actions）下的并列引用及各自的连接；`routeDevelopment` 签名与调用点不变，按操作在并列引用之间路由；工作区快照逐仓库报告开始工作与 PR 谱系入口的可用性。不含：Host 远程操作与重组（#354）、Host 目录条目（#355）、绑定界面（#356）、开始工作对话框与「绑定仓库」恢复动作（#142）、谱系读取接线（#297）、解绑（M4.1）、仓库 node id（TD-064）。人类决定 D16 把独立验收的三项 P3 并回本 PR：#383（规划来源名经 wire 到达页面）、#384（配置按值比较）、#385（逐仓库原因文案的注释）。
> 上游输入：issue #353（正文，无评论）；#127 的 `docs/exec-plan/completed/2026-10-21-workspace-binding-commands.md`（本 PR 叠在它上面，下称「#127 计划」）；`docs/exec-plan/completed/2026-10-08-development-repository-routing.md`（#219，D7、D23、D25–D28）；`docs/architecture/gate-e1-ruling.md` §4 R7；ADR-0006、ADR-0010；本 PR 新增 `docs/adr/ADR-0015-repository-references-side-by-side.md`（人类伙伴 2026-10-21 采纳并补三条约束，Accepted，D20）；TD-035–TD-039、TD-054、TD-064；三份设计提案（最小闭环 / 系统 / 业界实践）经独立评审收敛为本计划。
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

- 本 PR 只写这些文件（估计改动行，相对 base；代码 + 测试 ≤ 800，文档 ≤ 1300）：`packages/core/src/development-route.ts`（约 80）、`packages/core/src/start-work.ts`（约 20）、`packages/core/src/workspace-setup.ts`（#127 的文件，追加约 75）、`packages/core/src/index.ts`（命名再导出 3 个类型）、`packages/core/src/queries.ts`（约 30）、`packages/core/src/context.ts`（1）、`packages/controller/src/commands.ts`（约 8）、`packages/controller/src/wire.ts`（约 15）、`packages/client/src/workspace-read.ts`（约 14）、`packages/client/src/store.ts`（1）、`packages/client/src/sync.ts`（约 3）、`packages/ui-model/src/capability-access.ts`（约 6）、`tests/integration/workspace-setup-commands.test.js`（#127 的文件，追加约 150）、`tests/e2e/repository-routing.test.js`（新，约 230）；既有测试只在钉死了帧头完整形状时随 `repositories` 调整（预留约 15）。文档：本 ExecPlan、`docs/adr/ADR-0015-repository-references-side-by-side.md`、`docs/adr/README.md`（索引一行）、`docs/exec-plan/tech-debt-tracker.md`、`docs/README.md`（Active 索引一行，P-4 订正：原写「不改」与事实不符）；ADR-0015 采纳后（D20）另改 `docs/architecture/gate-e1-ruling.md` 的 R7 行末一句。合计约 650 行代码 + 测试、约 370 行文档（本计划约 300、ADR 56、索引与债务约 15）。人类决定 D16 把 #383、#384、#385 并回本 PR 后，文件集多出 `packages/core/src/bootstrap.ts`（留下项目标题，1 行）、`packages/ui-model/src/work-item-list-view.ts`（只改来源名一条路径）、`tests/contract/ui-work-item-list-view.test.js` 与 `tests/e2e/workspace-read-assembly.test.js`（各追加一处），800 行是弹性目标。
- 不改：`apps/**`（#352、#229）、`packages/capabilities/**`、`packages/domain/**`、`packages/storage/**`、迁移、`packages/providers/**`、`packages/core/src/chain-facts.ts`（#297）、`packages/ui-model/src/derive.ts`（#142）、`packages/ui/**`、`docs/architecture/gate-e1-ruling.md`（只在 ADR-0015 采纳后于 R7 行末追加一句，D20）、`tests/e2e/start-work.test.js`。
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
| — | #383 规划来源名（D16、D18） | `workspace-setup-commands`「#383 规划来源名经 controller 快照到达列表与详情」：Host 组合（目录、录制回放、账号句柄）先离线组合：首轮引导没读到项目，快照头只有五个字段，页面传 `sourceNames: {}` 时「规划来源名称未提供」；上线引导后 `planningSource` 深等 `{ bindingId, name: 'E1 Project A' }`（录制项目的标题），快照不含令牌值、句柄名、账号 id 与实现键；列表的规划来源、行来源与详情来源都是项目标题，页面给名字时以页面为准；同修订 metadata 帧与 delta 携带它，只有它变化也发 metadata，六种坏形状被拒。`workspace-read-assembly`「producer：规划来源名是引导读到的项目标题……」：替身项目改成空标题后再引导，字段缺席。`ui-work-item-list-view`「可见行……」：别的绑定的行仍是「来源名称未提供」（R1–R4、M2–M17） |
| — | #385 逐仓库原因文案（D17） | 只改注释：`WireRepositoryEntry` 写明 `reason` 是路由拒绝文案、可能点名仓库键与连接 id；`AC3 逐仓库可用性` 已断言原因是路由的拒绝文案（Batch 3 的 N-o 被它杀死） |
| — | #384 空原型配置（D16、D19） | `workspace-setup-commands`「AC1-353」补一句：账本丢失后以同值的空原型配置重发，两种存储上都返回首次结果、零写入、库不变 |
| — | 开始工作与并发绑定（风险 R5，独立验收补） | `repository-routing`「开始工作路由之后、认领之前有并发绑定」：替身的 `getRepository` 钩子在路由与认领之间执行绑定命令 → `failed` / `unavailable`，只有一次 `getRepository`、没有建分支或工作树，路由到的连接下没有 alias，仓库只有绑定命令写下的两条引用，没有上下文（D15） |
| — | 评审修复（D22） | `workspace-setup-commands`「首次绑定的锚点是 Development 引用」（F4）、「ADR-0015 约束②」；`repository-routing`「AC2 歧义」的 not_supported 带出服务连接 id（约束③）、「开始工作路由之后、认领之前，并发绑定给已登记的仓库加上第二条声明锚点的引用」（D15 补充）与 R5 用例的「原因可识别」一段；两种存储 |

### 实测读回（2026-10-21，Batch 4）

在检出 `feature/repository-binding` 的工作树根目录运行（Node v26.12.0；代码状态是 Batch 3 提交，之上只有本批的文档改动）。用例按 `docs/product/vertical-path.md` §2.1 的回读命令读回（直接运行测试文件，不加 `--test`），模板：

```bash
f=tests/e2e/repository-routing.test.js; p='AC5 元数据逐仓库'
node --test-reporter=spec --test-name-pattern="$p" "$f" | grep -E '^[[:space:]]*(✔|✖)|^ℹ (tests|fail)'
# 期望：每个存储一行标题含该前缀的 ✔，ℹ tests 等于 ✔ 行数，ℹ fail 0；伪造前缀读回 ℹ tests 0 且没有 ✔
```

| # | 前缀（文件） | 读回 |
|---|---|---|
| 1 | `AC1-353`（workspace-setup-commands） | ✔ 内存替身、✔ SQLite；`ℹ tests 2`、`ℹ fail 0` |
| 2 | `AC2 声明一致`（repository-routing） | ✔ 1 条；`ℹ tests 1`、`ℹ fail 0` |
| 2 | `AC2 并列引用` | ✔ 4 条（Local Git 型、GitHub 型各为 primary × 两种存储）；`ℹ tests 4`、`ℹ fail 0` |
| 2 | `AC2 歧义`；`historical 身份不是现行引用`；`锚点所在连接未组合` | 各 ✔ 2 条（两种存储）；`ℹ tests 2`、`ℹ fail 0` |
| 3 | `AC3 逐仓库可用性`；`AC3 没有已登记仓库` | 各 ✔ 2 条；`ℹ tests 2`、`ℹ fail 0` |
| 4 | `AC4-353`（workspace-setup-commands） | ✔ 2 条；`ℹ tests 2`、`ℹ fail 0` |
| 5 | `AC5 元数据逐仓库` | ✔ 2 条；`ℹ tests 2`、`ℹ fail 0` |
| — | `绑定仓库拒绝`；`绑定仓库原子性`（workspace-setup-commands） | 各 ✔ 2 条；`ℹ tests 2`、`ℹ fail 0` |
| 负对照 | `不存在的前缀` | `ℹ tests 0`、`ℹ fail 0`，没有 ✔ |

整文件：`node --test tests/integration/workspace-setup-commands.test.js tests/e2e/repository-routing.test.js` → `ℹ tests 38`、`ℹ fail 0`（21 + 17）。#219 回归：`node --test tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/provider-binding-registration.test.js` → `ℹ tests 156`、`ℹ fail 0`；`git diff --quiet origin/feature/workspace-binding-commands -- tests/e2e/start-work.test.js` 退出码 0。门禁命令的输出见 Progress 的 Batch 4 一条。

### 独立验收读回（2026-10-21）

在检出 `feature/repository-binding` 的工作树根目录运行，代码状态 `4bcd7e1`（D15 的修复提交），base `origin/feature/workspace-binding-commands` @ `7ff864a`。验收以 issue #353 正文为准逐条找用例、运行、再变异被守护的生产代码（`node scripts/review-mutate.mjs <spec>`，命令跑上表两文件加 `tests/e2e/start-work.test.js` 与 `tests/integration/start-work-sqlite-registration.test.js`，按原文字节还原）：

| # | 判定用例（两种存储） | 变异 → 变红用例 | 结论 |
|---|---|---|---|
| 1 | AC1-353 | primary 取最后一条、复用分支仍新建、其余引用也写 primary、已登记仍 `putRepository` → AC1-353 | 满足 |
| 2 | AC2 并列引用 / 歧义；#219 的「没有登记」三条 | 多条引用取第一条 → 并列引用；多个声明者取第一个、没有声明者不拒绝 → 歧义；未登记多挂载取第一个 → `start-work.test.js`「两个 / 三个 Development 挂载、仓库没有登记」；现行引用不核对实体 → 「……同 id 的别家身份……」 | 满足 |
| 3 | AC3 逐仓库可用性 / 没有已登记仓库 | 仓库条目不覆盖工作区级、快照丢 `repositories`、`METADATA_KEYS` 不含它、帧头不携带、不校验 → 逐仓库可用性；空也下发 → 没有已登记仓库 | 满足 |
| 4 | AC4-353 | 去掉交付来源预检、交付挂载非默认 → AC4-353 | 满足 |
| 5 | AC5 元数据逐仓库 | 变更请求读按 `repository.read` 选挂载、不报引用、报全部能力 → AC5 | 满足 |
| — | 拒绝 / 原子性 / R5 | 去掉同实现键重复检查、去掉锚点不在挂载下拒绝 → 拒绝；登记先于写挂载 → 原子性等；去掉 D15 的核对 → R5；核对改为「已登记即拒绝」→ AC2 并列引用 | 满足 |

25 个变异全部变红，没有存活（「复用分支仍新建」首轮锚点不唯一、未施加，换唯一锚点重跑后变红）。整文件读回：上面两文件 `ℹ tests 40`、`ℹ fail 0`（多出 R5 两条）；#219 回归同上 `ℹ tests 156`、`ℹ fail 0`，`start-work.test.js` 仍零 diff。与 PR #372（#229）合并：当时 `git merge-tree --write-tree HEAD origin/feature/plugin-work-item-pages` 只在 `docs/exec-plan/tech-debt-tracker.md`、`docs/product/vertical-path.md` 冲突（这一读数已过时：#372 随后由 #382 在 `packages/ui-model/src/work-item-list-view.ts` 加了 `partial`，与本 PR 的 `nameOf` 相邻，现在与 #372 有一处代码冲突，两边保留——rows 用 `nameOf`，保留 `partial`——在 #372 合并后变基时解，D22）；把合并树导出到临时目录，`pnpm run typecheck` 退出码 0，`node --test tests/e2e/*.test.js` → `ℹ tests 197`、`ℹ fail 0`，`tests/integration/harness-plugin-host-watch.test.js` 与 `tests/contract/ui-work-item-app.test.js` 连同 client 套件 `ℹ tests 69`、`ℹ fail 0`（S13）。门禁见 Progress 的独立验收一条。

## Progress

- [x] 2026-10-21 设计评审完成：三份提案经独立评审收敛；审阅探针在两种存储上证实 F1（primary + alias 可共存、仓库挂载不可改指）。
- [x] 2026-10-21 Batch 1 · 绑定命令与唯一写者（含 N1–N6）。在检出 `feature/repository-binding` 的工作树根目录运行（base `origin/feature/workspace-binding-commands` @ `6a902de`）：
  - 红（实现前）：`node --test tests/integration/workspace-setup-commands.test.js` → `ℹ tests 21`、`ℹ fail 8`（6 条 `TypeError: setup.bindRepository is not a function`，2 条 `commands.bindRepository is not a function`）。
  - 绿：同一命令 `ℹ tests 21`、`ℹ fail 0`；`node --test tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/provider-binding-registration.test.js` → `ℹ tests 156`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`；`pnpm run test`（root）`ℹ tests 1717`、`ℹ fail 2`，失败标题恰为两条已知 root 项。
  - 变异（逐条改源码、跑 `tests/integration/workspace-setup-commands.test.js`，N-f 起连同上一行的三个开始工作文件；恢复原文；变红的用例两种存储同时变红）：

    | 变异 | 变红用例 |
    |---|---|
    | N1 复用分支仍 `writeMount` | AC1-353、AC4-353 |
    | N2 去掉交付来源预检 | AC4-353 |
    | N3 去掉目标比对 | AC4-353、拒绝 |
    | N4 `registerRepository` 挪到 `writeMount` 之前 | AC1-353、AC4-353、拒绝、原子性（身份指向尚不存在的连接锚点，存储拒绝） |
    | N5 primary 取最后一条 Development 引用 | AC1-353、AC4-353 |
    | N6 去掉 `(domain, implementationKey)` 重复检查 | 拒绝 |
    | N-a 去掉「交付引用至多一条」 / N-b 去掉「锚点不在挂载下」 / N-c 去掉「未登记须带 Development 引用」 / N-d 去掉账号存在性 / N-e 去掉引用字段类型检查 | 拒绝（各自） |
    | N-f `registerRepository` 已登记仍 `putRepository` | AC1-353、AC4-353（账本丢失后重发的写入计数非零） |
    | N-g `registerRepository` 不核对已有身份所属实体；N-h `repositoryReferences` 不滤 `historical` | 存活，见 S7 |
- [x] 2026-10-21 Batch 2 · 按操作在并列引用之间路由（含 N7–N11）。同一检出，Batch 1 提交之上：
  - 红（实现前，路由只认锚点）：`node --test tests/e2e/repository-routing.test.js` → `ℹ tests 9`、`ℹ fail 4`：GitHub 为 primary 时开始工作得 `not_supported`「没有绑定提供能力 development.branch.create」；两条 Local Git 型引用时没有拒绝（各两种存储）。
  - 绿：Batch 2 的验证命令 `ℹ tests 203`、`ℹ fail 0`（其中 `tests/e2e/repository-routing.test.js` 11 条）；`git diff --quiet origin/feature/workspace-binding-commands -- tests/e2e/start-work.test.js` 退出码 0（#219 的 E 系列不改一字）；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`；`pnpm run test`（root）`ℹ tests 1728`、`ℹ fail 2`，失败标题恰为两条已知 root 项，非 root 用户重跑 `tests/integration/development-local-git.test.js` `ℹ tests 73`、`ℹ fail 0`；`pnpm run test:mvp0` `ℹ tests 7`、`ℹ fail 0`。
  - 变异（逐条改源码，跑上一行的 Batch 2 验证文件加 `tests/integration/workspace-setup-commands.test.js`，恢复原文；变红的用例两种存储同时变红）：

    | 变异 | 变红用例 |
    |---|---|
    | N7 多条引用取第一条 | AC2 并列引用（github 为 primary）、AC2 歧义 |
    | N8 多个声明者取第一个 | AC2 歧义 |
    | N9 已登记仍 `putRepository`：开始工作把仓库挂载改指路由到的身份（S1 的原形） | AC2 并列引用（github 为 primary）、`start-work-sqlite-registration`「写前事务中途失败……」；在 `registerRepository` 内对锚点同值重写即 Batch 1 的 N-f |
    | N10 现行引用不核对实体 | `start-work.test.js`「……仓库挂载的身份属于未挂载的连接时 conflict，即使某个挂载下恰有同 id 的别家身份……」 |
    | N11 没有声明者时退回第一条 | AC2 歧义（文案点名 `branch.create` 而不是锚点 key） |
    | N-h 不滤 `historical`（Batch 1 存活，S7） | historical 身份不是现行引用 |
    | N-i 锚点所在连接未组合时不经 `listIdentitiesForEntity` 确认实体 | 锚点所在连接未组合 |
- [x] 2026-10-21 Batch 3 · 逐仓库可用性经快照到达 client 与 ui-model（含 N12–N16）。同一检出，Batch 2 提交之上：
  - 红（实现前）：`tests/e2e/repository-routing.test.js` 新增的 AC5、AC3「没有已登记仓库」、AC3「逐仓库可用性」各两种存储 → `ℹ tests 17`、`ℹ fail 6`（AC5 与 AC3「逐仓库可用性」：`TypeError: Cannot read properties of undefined (reading 'map')`，`getWorkspaceMetadata().repositories` 与快照的 `repositories` 都不存在；AC3「没有已登记仓库」：`getWorkspaceMetadata().repositories` 是 `undefined` 而不是 `[]`）。红在命名导入 `repositoryAccessIndex` 之前用命名空间导入的临时副本跑出，否则整个文件在加载时就失败、连既有 11 条也变红。
  - 绿：Batch 3 的验证命令 `ℹ tests 95`、`ℹ fail 0`；`pnpm run typecheck` 退出码 0；`pnpm run boundaries` `ℹ fail 0`；`tests/e2e/start-work.test.js` 与 `tests/e2e/delivery-lineage.test.js` 连同上面的套件 `ℹ tests 170`、`ℹ fail 0`；`pnpm run test`（root）`ℹ tests 1734`、`ℹ fail 2`，失败标题恰为两条已知 root 项，非 root 用户重跑 `tests/integration/development-local-git.test.js` `ℹ tests 73`、`ℹ fail 0`；`pnpm run test:mvp0` `ℹ tests 7`、`ℹ fail 0`；`node scripts/workflow-check.mjs` 无 findings。
  - 既有测试只改一条（S10）：`tests/contract/ui-model-presentation.test.js`「结构：fixture 快照与 wire 的字段面机械同形」，`fixtureSnapshot()` 加 `repositories: undefined`（1 行，与 `planningFields: undefined` 同理）；其余帧头相关套件不改一字。
  - 变异（逐条改源码、跑 `tests/e2e/repository-routing.test.js`，用 `git checkout --` 恢复；变红的用例两种存储同时变红）：

    | 变异 | 变红用例 |
    |---|---|
    | N12 元数据仍按 key 经 `bindingForCapability` 解析 | AC5、AC3「逐仓库可用性」 |
    | N13 `repositoryAccessIndex` 不覆盖仓库条目 | AC3「逐仓库可用性」 |
    | N14 `METADATA_KEYS` 不含 `repositories` | AC3「逐仓库可用性」 |
    | N15 `toWireMetadata` 丢 `repositories` / `diffSnapshots` 丢 `repositories` / `sourceSignature` 不含 `repositories`（三处各改一次） | AC3「逐仓库可用性」（各自） |
    | N16 `CHANGE_REQUEST_READ_ROUTE.reports` 多报 `repository.read`（同一 key 由两个操作报告） | AC5、AC3「逐仓库可用性」 |
    | N-j `toWireSnapshot` 总是下发 `repositories`（含空数组） | AC3「没有已登记仓库」 |
    | N-k 元数据不按 id 升序（注册顺序与 id 序不同） | AC3「逐仓库可用性」 |
    | N-l `assertHeader` 不校验 `repositories` / 不查 id 唯一 / 不查 id 非空 / 条目不闭集 / 不校验条目的能力项列表（各改一次） | AC3「逐仓库可用性」（各自） |
    | N-m `sync` 的帧头不携带 `repositories` / `read()` 不携带 `repositories`（各改一次） | AC3「逐仓库可用性」（各自） |
    | N-n 路由成功时不滤 `reports`（报告被选挂载的全部能力） | AC5、AC3「逐仓库可用性」 |
    | N-o 路由被拒时不带拒绝文案作 `reason` | AC3「逐仓库可用性」 |
    | N-p `unavailableCore` 不补 `repositories: []` | AC3「没有已登记仓库」 |
- [x] 2026-10-21 Batch 4 · 文档与门禁。draft PR #373 已由协调者开出，本批不创建或编辑 PR；PR 描述、head / base / checks 回读与 `gh pr ready` 留给协调者。在检出 `feature/repository-binding` 的工作树根目录运行，代码状态是 Batch 3 提交（`3169877`），base 取 `origin/feature/workspace-binding-commands`（#127 合并后改 `main`）：
  - 文档：`docs/adr/README.md` 加 ADR-0015（Proposed）索引行与来源段落一句，「上表十四条」改「十五条」；`docs/exec-plan/tech-debt-tracker.md` 追加 TD-074–077（紧随 TD-071，TD-072–073 由并行 PR 保留）、TD-035 与 TD-039 移入 Resolved Items（验证命令写在行内）、TD-036 / TD-037 / TD-038 / TD-054 / TD-064 就地更新（D14）。ADR-0015 与实现逐条核对，没有被推翻的事实，不改；`docs/product/vertical-path.md` 不改（D14）；`docs/README.md` 在 Active 索引加本计划一行（原写「不动」与事实不符，评审 P-4 订正，D22）。
  - 门禁（root 运行）：`pnpm run typecheck` 退出码 0；`pnpm run boundaries` → `ℹ tests 9`、`ℹ fail 0`；`pnpm run test` → `ℹ tests 1734`、`ℹ fail 2`，`pnpm run test 2>&1 | grep -E '^✖ ' | sort -u` 除 `✖ failing tests:` 汇总头外恰为两条已知项（`拒绝：占用路径、被别处检出的分支与不可访问的目录都不伪造成功`、`真实层 tests/integration：非空、全绿，且摘要行被透传`）；非 root 用户重跑 `tests/integration/development-local-git.test.js` → `ℹ tests 73`、`ℹ fail 0`；`pnpm run test:mvp0` → `ℹ tests 7`、`ℹ fail 0`；`node scripts/workflow-check.mjs` → `workflow-check: no findings（已检查 8 个文件）`；`node scripts/rule-checks.mjs disclosure origin/feature/workspace-binding-commands` 机械扫描通过；`git diff --check origin/feature/workspace-binding-commands...HEAD` 无输出。
  - 体量：`node scripts/rule-checks.mjs size origin/feature/workspace-binding-commands` 观察时刻 2026-10-21 @ `3169877` 报告代码 + 测试 714 / 1000 行（计划预算 ≤ 800）、文档 426 / 1500 行；本批提交增加文档行，重算用同一条命令（期望：代码不变，文档 ≤ 1500）。
- [x] 2026-10-21 独立验收完成。检出 `feature/repository-binding`，代码状态 `4bcd7e1`，base `origin/feature/workspace-binding-commands` @ `7ff864a`：验收逐条读回与 25 个变异见 `Validation and Acceptance`「独立验收读回」；P1 一条（S12，并发绑定使开始工作补出同类引用）先红后绿修复于 `4bcd7e1`（D15）。门禁（root）：`pnpm run typecheck` 退出码 0；`pnpm run test` → `ℹ tests 1736`、`ℹ fail 2`，`grep -E '^✖ ' | sort -u` 除汇总头外恰为两条已知 root 项；非 root 用户重跑 `tests/integration/development-local-git.test.js` → `ℹ tests 73`、`ℹ fail 0`；`pnpm run test:mvp0` → `ℹ tests 7`、`ℹ fail 0`；`pnpm run boundaries` → `ℹ tests 9`、`ℹ fail 0`；`node scripts/workflow-check.mjs` → `no findings（已检查 8 个文件）`；disclosure、size 与 `git diff --check` 在本条的文档提交之后重跑，结果写在 PR 汇报里。
- [x] 2026-10-21 并回 #385、#383、#384（人类决定 D16）。在检出 `feature/repository-binding` 的工作树根目录运行；#384 与 #383 的第二版在协调者把本分支 rebase 到 #371 的新 head（`origin/feature/workspace-binding-commands` @ `4d281d4`）之后做：
  - #385（`88dd4df`，docs）：只改注释，没有行为变化（D17）。
  - #383 第一版（`9f0c4c9`）下发实现键；协调者裁定实现键不是显示名，第二版（`ab8dfdc`，整理提交时并入 `9f0c4c9`）改为引导读到的项目标题（D18）。第二版的红：把 `packages/` 退回第一版、只留新用例，`node --test --test-name-pattern='#383|可见行' tests/integration/workspace-setup-commands.test.js tests/contract/ui-work-item-list-view.test.js tests/e2e/workspace-read-assembly.test.js` → `ℹ tests 5`、`ℹ fail 4`（离线组合后头里已有 `planningSource`；显示名断言拿到的是实现键）。绿：同一命令 `ℹ fail 0`；第一版加入字段时全量测试只多出本 PR 的 `AC3 没有已登记仓库` 键列表断言变红（S16）。
  - #383 变异（`node scripts/review-mutate.mjs`，命令 `node --test` 上述三个文件，按字节还原）：20 个全部 KILLED（两种存储同时变红）：

    | 变异 | 变红用例 |
    |---|---|
    | R1 引导不记项目标题；R4 名字拼进绑定账号的句柄 | #383、`workspace-read-assembly`「producer：规划来源名……」 |
    | R2 名字未知也下发（`name` 为 `undefined`）；M2 名字未知时快照也带 `planningSource` 键 | #383（离线组合的头字段断言）、`workspace-read-assembly` 同上 |
    | R3 空标题当作名字 | `workspace-read-assembly`「producer：规划来源名……」 |
    | M3 `toWireMetadata` 丢 / M4 `diffSnapshots` 丢 / M5 `sourceSignature` 不含 `planningSource` | #383（各自） |
    | M6 `METADATA_KEYS` 不含 / M7 `assertHeader` 不校验 / M8 不查闭集 / M9 不查名字非空 / M10 不查绑定 id 非空 | #383（各自；M6 另使 `workspace-read-assembly` 的 metadata 用例变红） |
    | M11 `sync` 帧头不带 / M12 `read()` 不带 `planningSource` | #383（各自） |
    | M13 规划来源名不退到显示名 / M14 行来源名不退到显示名 | #383、`ui-work-item-list-view`「可见行……」 |
    | M15 显示名压过页面给的行来源名 / M17 显示名压过页面给的规划来源名 | #383 |
    | M16 任何绑定的行都退到规划来源名 | `ui-work-item-list-view`「可见行……」 |
  - #384（`54036ba`）红：先补「AC1-353」的空原型配置重发一句，`node --test --test-name-pattern='AC1-353' tests/integration/workspace-setup-commands.test.js` → `ℹ tests 2`、`ℹ fail 2`（两种存储都得 `conflict`）；改用 `sameMountTarget` 后 `ℹ fail 0`。被杀的变异就是改用之前的写法（`isDeepStrictEqual`）；去掉比较本身仍由 Batch 1 的 N3 判别。
- [x] H3 由协调者裁定（2026-10-21）：不给用户看实现键，规划来源名用引导读到的项目标题（D18），名字未知时仍是「未提供」（TD-078 改写）
- [x] H1 由人类伙伴决定（2026-10-21）：ADR-0015 采纳，并补三条约束（D20）；独立验收给决定 5 补的「追加引用只归绑定命令」（D15）随之采纳
- [x] 2026-10-21 评审修复（GitHub review 5595757979 与 ADR-0015 的三条约束，D22）。在检出 `feature/repository-binding` 的工作树根目录运行；先把本 PR 相对旧 base `89e1187` 的改动整体搬到 #371 的新 head `4c33736`（只在 `workspace-setup.ts` 的 `plainObject` 与 tracker 的 TD-070 / 071 两处冲突：保留 #371 的共享 `plainObject` 与带承接链接的 TD-070 / 071，追加本 PR 的 `referenceShaped` 与 TD-074–078）：
  - 约束③ 红：「AC2 歧义」补「not_supported 带出服务连接的 id」，`node --test --test-name-pattern='AC2 歧义' tests/e2e/repository-routing.test.js` → `ℹ tests 2`、`ℹ fail 2`（文案只有「能力 development.worktree.create 不可用」）；绿：`development-route.ts` 的无声明者分支改为带服务连接 id 的 `not_supported`，同一命令 `ℹ fail 0`。
  - F4、约束②、D15 补充：新增「首次绑定的锚点是 Development 引用」「ADR-0015 约束②」（`workspace-setup-commands`，两种存储）与「开始工作路由之后、认领之前，并发绑定给已登记的仓库加上第二条声明锚点的引用」（`repository-routing`，两种存储），R5 用例补「原因可识别」与重发一段；都钉住现有行为，判别力由变异 V19、C2a、C2b、D15a–D15c 证明（表见 D22；C2c 随第二轮评审 R2-1 删掉的端口层一段移出）。
  - F1、F3：只改文字（`queries.ts` 的 `repositoryMetadata` 注释、`wire.ts` 的 `WireRepositoryEntry` 注释、tracker 的 TD-035 解决说明）。
- [x] H2（S8）：独立验收判为 P1 并按 R5 收紧——开始工作抛错回滚，不补 alias（S12、D15）；协调者可推翻

- [x] 2026-10-21 收尾（D23）：搬到 main `66870dfd`（#371、#372 已合并），补 U-F1 断言（U1 KILLED），整合为三个交付物级提交，计划归档。
## Surprises & Discoveries

- S1：`registerParents` 无条件 `putRepository`；路由一旦能到 alias，已登记仓库的开始工作会被 F1 拒绝，认领事务回滚并得 `unavailable`「本地登记失败」。审阅探针在两种存储上复现了这条拒绝。
- S2：client 的 metadata 帧键是闭集（`packages/client/src/store.ts` 的 `METADATA_KEYS`）。所以 wire 头上的新字段必须与 client 同 PR 落地；只改 controller 会让第一条同修订 metadata 帧终止流。
- S3：三份提案都假设 #127 提供持久回执（`runIdempotent`）。#127 计划 D2 不提供，本计划改用自然幂等：仓库挂载加逐引用的目标比对。
- S4：替身 Development provider 恒声明 `change_request.read`。Local Git 型替身要靠 Proxy 去掉它，并用「AC2 声明一致」钉住替身与真实 provider 的声明相等。
- S5：TD-035 记下的人类裁决 D23 把「绑定仓库」恢复动作与按选中仓库判定的对话框都放在 #142，支持 D8 与 D4 的切分。
- S6（Batch 1，2026-10-21）：计划请 #127 配合的三项（`Interfaces and Dependencies` 末段）里，#127 的代码已满足两项：① `packages/controller/src/commands.ts` 的模块私有 `setupResult` 就是 `SetupOutcome → CommandResult` 映射，`bindRepository` 直接复用；② `readMountTarget` 总带 `accountId` 键、配置缺席给 `{}`（两种存储在没有关联时都返回 `undefined`：`packages/storage/sqlite/src/storage.ts` 的 `getProviderBindingAccount` 把 `NULL` 映射为 `undefined`）。③ 没有：测试文件的 `openStore(kind)` 固定用 Host 策略，本批自己加（D11）。
- S7（Batch 1，2026-10-21）：两个守卫的变异存活。N-g：已有身份属于别的实体时 `registerRepository` 抛错——绑定命令只给新建的连接（下面没有身份），开始工作只给路由到的连接（路由已确认它在锚点实体上），只有「路由之后、认领之前」的并发写才能到达它，没有不靠竞态的用例；按 Design 保留为防御（不重新识别，不变量 6）。N-h：`repositoryReferences` 滤掉 `historical`——今天没有仓库 `historical` 身份的写者，Batch 2 以端口直写一条 `historical` 身份补判别用例（已补，见 S9）。另：Validation 表里「原子性」一行写的「写入计数 0」做不到——配置只在 `putBindingConfiguration` 时由存储按 schema 校验（D9：core 不读配置），前一条引用的挂载那时已经写过；用例改以「阳性对照：`putProviderBinding` 确实写过」加「`snapshot` 不变」证明整笔回滚。「拒绝」一行的写入计数确实为 0（判定全在任何写之前）。
- S8（Batch 1，2026-10-21）：风险 R5 的写法与 Design 的 `registerRepository` 规则不一致。按 Design「已登记时……缺的补 alias」，开始工作按「未登记、单挂载」路由之后、认领之前若有并发绑定，认领事务里的 `registerRepository` 看到仓库已登记，会把路由到的挂载补成该实体上的 alias，不抛错，开始工作照常进行；该仓库之后可能有两条同类引用，路由按 D3 得到确定的 `conflict`（TD-077 的范围）。R5 写的「抛错、认领回滚」要求 `registerRepository` 区分调用方（新增参数，或开始工作在认领事务里自查「路由时未登记、此刻已登记」），超出 `Interfaces` 冻结的签名；本批按 Design 实现，交协调者决定是否收紧（H2）。独立验收已按 R5 收紧（S12、D15）。
- S9（Batch 2，2026-10-21）：计划列出的三条 AC2 用例不判别两个守卫——N-h（Batch 1 存活）与本批的 N-i 都存活。`tests/e2e/repository-routing.test.js` 因此多两条用例：锚点实体上经端口直写一条 `historical` 身份（今天没有生产写者），它所在的 Local Git 型连接零调用；GitHub 型 primary 不组合、只组合 Local Git 型 alias，开始工作仍 Saved。`setup` 为此接受 `mounts` 参数（组合哪些替身、用哪个 bindingId）。另：`CHANGE_REQUEST_READ_ROUTE` 与 `DevelopmentOperation.reports` 按计划在本批定义，消费者是 Batch 3 的工作区元数据（`development-route.ts` 不进 core 包入口，本批用例碰不到它们）；`packages/core/src/git-provisioning.ts` 的 `worktree.create` 写路由与 `start-work.ts` 的 `worktree.read` 读回路由没有改：选挂载只看锚点 key，前者与 `START_WORK_ROUTE` 选中同一挂载，后者选唯一声明 `worktree.read` 的引用。
- S10（Batch 3，2026-10-21）：`tests/contract/ui-model-presentation.test.js` 的「结构：fixture 快照与 wire 的字段面机械同形」用正则抽 `WireSnapshot` 的全部 `readonly x?:` 字段并要求与 `fixtureSnapshot()` 的键逐字相等，可选字段也算。`repositories?` 加入 `WireWorkspaceHeader` 后它变红（红的就是它设计要拦的漂移）。按 `planningFields: undefined` 的先例给 fixture 加 `repositories: undefined`（没有已登记仓库的形态）。这是帧头完整形状被钉死的唯一一处，全量测试里没有别的既有断言变红。
- S11（Batch 3，2026-10-21）：`WireWorkspaceHeader.repositories?` 不带 `| undefined`（wire 上缺席就是缺席，`exactOptionalPropertyTypes`）。client 因此在两处用条件展开：`accept` 里组 `head`，`read()` 里组返回值，后者在缺席时不多出 `repositories: undefined` 键，所以没有仓库时 `read()` 的对象形状与今天逐字相同。AC3 的测试世界在一个工作区里绑 4 个仓库（7 个 Development 挂载，其中两个挂载共用实现键 `test.github`、三个共用 `test.local-git`）：Storage 对同工作区的重复实现键没有唯一约束，`bindRepository` 的「同键复用」只在同一仓库的引用内判定，所以可行。
- S12（独立验收，2026-10-21）：S8 的交错可确定性复现，且后果是永久的。交错：单个 Local Git 型挂载 M0、仓库未登记 → 开始工作路由到 M0 → `getRepository` 进行中，绑定命令登记同一仓库（新建 L1 primary、G1 alias）→ 认领事务里 `registerRepository` 把 M0 补成 alias，开始工作经 M0 建分支与工作树并 Saved。之后：同一绑定请求重发（新键）按 `mounts.find` 复用先列出的 M0，返回 `[M0, G1]` 而不是首次的 `[L1, G1]`；以 `[M0, L1, G1]` 重组后，另一个工作项的开始工作永久 `conflict`（两条引用都声明 `worktree.create`，没有解绑）。顺序执行到不了这个状态（绑定命令每仓库每实现键至多一条引用，D6）；base 在同一交错下因仓库挂载改指被存储拒绝而回滚。判为 P1，修复见 D15。
- S13（独立验收，2026-10-21）：风险 R2 与「下游契约」说 PR B（#229，PR #372）也改 `packages/client/src/workspace-read.ts`、`store.ts`、`sync.ts`，事实不是：#372 在 client 只改 `index.ts`、`stream.ts` 并新增 `supervise.ts`（`git diff --stat origin/main...origin/feature/plugin-work-item-pages -- packages/client`），`supervise.ts` 只发布 `read()` 的结果、不看它的键。当时代码合并无冲突，合并树的 typecheck 与相关套件全绿（见「独立验收读回」）。此后 #372 的 #382 在 `packages/ui-model/src/work-item-list-view.ts` 加了 `partial`，与本 PR 的 `nameOf` 相邻：现在与 #372 有一处代码冲突（`work-item-list-view.ts`），两边保留——rows 用 `nameOf`，保留 `partial`——在 #372 合并后变基时解；tracker 与 `vertical-path.md` 的文档冲突仍由后合并者解决（D22）。
- S14（独立验收，2026-10-21）：`bindRepository` 的目标比对用 `isDeepStrictEqual`，原型也比；`plainObject` 放行 `Object.create(null)` 的配置，于是进程内调用方以空原型配置重发同一请求得 `conflict`（探针实测，替身存储）。经 wire 的 JSON 都是普通原型，产品内不可达；#127 的 `bindPlanningSource` 同一写法。列为 P3，按人类决定 D16 并回本 PR：#371 落地共享的 `sameMountTarget` 后，`bindRepository` 改用它（#384，D19）。
- S15（并回 #383，2026-10-21）：「wire 带实现键、ui-model 把已知实现键映射成标签」不可行：`tests/contract/ui-model-presentation.test.js`「结构：packages/ui-model/src 不含平台名……」禁止 ui-model 源码出现 `github` 等片段（标签表的键本身就含它），core 也「只按 capability key 分支，不看 provider 名字」（`packages/core/src/registry.ts` 文件头）。绑定记录（`ProviderBindingRecord`）与 `ProviderDefinition` 都没有显示名；账号的 `displayName` 是账号的名字而不是来源的名字。第一版因此下发了实现键；协调者指出 core 每次引导都经 `planning.getProject` 读到 `ProviderProject.title`（`packages/capabilities/src/planning-provider.ts`），`readProject` 只留下 `projectRef` 就把标题丢了——显示名一直在手边，不需要 schema 或标签表（D18）。
- S16（并回 #383，2026-10-21）：加入 `planningSource` 后全量测试只有本 PR 的 `AC3 没有已登记仓库` 变红：它钉死帧头完整键集，而那条用例的组合里有替身规划挂载；键列表补 `planningSource`（替身引导读到了项目标题），「名字未知时字段缺席」改由 #383 用例在离线的 Host 组合上判定（R2、M2）。其余钉死帧头形状的只有 S10 那一条结构断言，同样给 fixture 补 `planningSource: undefined`。

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

- **D11 实现细节（Batch 1，2026-10-21，实现者（Claude Opus））**，`Interfaces and Dependencies` 的签名一个未改：
  - #127 的测试文件只改 `openStore` 一行签名（`openStore(kind, policy = hostStoragePolicy(PROVIDER_CATALOG))`，S6 的 ③），#353 的用例与辅助函数都追加在文件末尾；`workspace-setup.ts` 与 `commands.ts` 也只追加成员与导入，便于随 #127 的修正提交 rebase。
  - `registerRepository` 在仓库已登记时经 `repositoryReferences(tx, record, 本工作区全部挂载)` 定位锚点实体：绑定命令新建的连接下没有身份，只看传入的 `bindingIds` 找不到实体。找不到即抛错（绑定命令在此之前已以 `conflict` 拒绝，不会走到）。未登记时第一个连接下已有的身份照旧复用为锚点（与原 `registerParents` 相同，覆盖「两个工作区挂同一个连接」）。
  - `bindRepository` 的全部判定只读、先于任何写，所以拒绝零写入；引用的账号可缺省（Local Git 没有账号），缺省时不查账号、不写关联。development 挂载非默认、delivery 挂载默认；`registerRepository` 的 id 工厂用 core 的 `defaultIdFactory`，`createWorkspaceSetup(storage)` 签名不变。
- **D12 实现细节（Batch 2，2026-10-21，实现者（Claude Opus））**，`routeDevelopment` 签名与两个调用点不变：
  - 多条现行引用而没有声明者时直接返回 `unsupportedCapability(锚点 key)`（「能力 development.worktree.create 不可用」），不走前置门：前置门的第一项会点名 `branch.create`，而 Design 要求点名锚点 key（N11 由此判别）。
  - 多个声明者的 `conflict` 文案列出仓库键与声明者的连接 id，写明「不取第一个注册者」与「本版本还不能解绑或改绑仓库的引用」，不写恢复步骤：本版本没有走得通的恢复（#219 的 D25 / D28 只允许写走得通的步骤），解绑归 M4.1（TD-077）。
  - 声明者按挂载的有效能力列表含锚点 key 判定，访问级别不看：只读或降级的唯一声明者照样被选中，再由同一挂载上的门给出 `permission_denied` 或降级，不改道。

- **D13 实现细节（Batch 3，2026-10-21，实现者（Claude Sonnet））**，`Interfaces and Dependencies` 的签名一个未改：
  - core 求逐仓库能力时对每个操作调一次 `routeDevelopment`，成功则取 `route.binding.capabilities` 里属于 `reports` 的项（门已过，key 必在其中，所以不需要缺项兜底）；`bindingsForDomain` 的挂载 id 作 `repositoryReferences` 的候选。`RepositoryMetadata` 放在 `queries.ts` 并随 `export *` 到达 core 包入口，没有新增命名再导出。
  - controller：`toWireSnapshot` 在 `repositories` 非空时才带这个字段；`toWireMetadata`、`diffSnapshots` 与 `sourceSignature` 都携带它，所以只有它变化时 watch 在同修订上发 metadata（来源变化，不是业务变化），修订前进时 delta 也带它。`sourceSignature` 不对 `repositories` 排序：core 已按 id 升序，不另立第二个规范化口径。
  - client：`assertHeader` 把原来的能力项校验抽成 `validCapabilityList`（判定不变），`repositories` 的条目复用它；报错文案加入 `repositories`。帧头是整体替换：新帧没有 `repositories`，`read().repositories` 就回到缺席，不跨帧保留。`packages/client/src/index.ts` 与 `stream.ts` 没有改（`ClientWorkspaceRead` 已由 index 导出）。
  - AC3 用例在计划的 R1–R3 之外多一个 `r-twin`（两条实现键不同的 Local Git 型引用）：证明歧义逐仓库报告、原因是路由的拒绝文案，并且不影响其它仓库。

- **D14 实现细节（Batch 4，2026-10-21，实现者（Claude Sonnet））**，只动文档，代码与 `Interfaces and Dependencies` 一字未改：
  - 登记与关闭：TD-074–077 按 Design「风险与技术债务」登记，紧随 TD-071（TD-069、TD-072–073 由并行 PR 保留）。TD-035、TD-039 按 Design 关闭，移入 Resolved Items，沿用既有已解决行的形态：原字段不动，解决说明与验证命令追加在「下一步」末尾。TD-035 的残余（工作区级 `development.*` 仍 `unavailable` 且文案不变，计划刻意不做；界面把能用的开始工作显示为不可用要等 #142 消费 `repositoryAccessIndex`）写在其解决说明里，不另立债务项：#142 验收 5 已承载。TD-036、TD-037、TD-038、TD-054 按 Design 就地更新；TD-038 另记「`tests/e2e/start-work.test.js` 的种入改走绑定命令未做」，因为该文件按 `Global Constraints` 不改。
  - TD-064：#127 的 S9 指出其「延期理由」与「下一步」仍指向 #127，而仓库绑定已随 #351 重规划移入 #353。本批订正承接说明，不关闭：#353 的 `bindRepository` 不取也不存 node id（范围「不含」，配置对 core 不透明，TD-076）；下一步改为宿主在绑定仓库时取得 node id 并存进挂载配置，并写明 ADR-0015 决定 3 的约束（存进仓库身份的 `external_id` 须先改该 ADR）。字段由哪个 issue 定义、填写属建议，尚无 issue 承接，已在该行写明。
  - `docs/product/vertical-path.md` 不改：`Global Constraints` 的文件集没有它；矩阵规则要求「关闭本节引用的 issue 的 PR」同 PR 更新对应行，而 `grep -n '#353' docs/product/vertical-path.md` 无输出（#353 不在任何一行的承接或引用里）；第 6、7 行引用的开始工作用例标题与结论不受影响（`start-work.test.js` 零 diff，读回仍绿）；Host 与 UI 都还没有调用 `bindRepository`（#354、#356），任何行的结论都不能因本 PR 升级。
  - ADR-0015 不订正：决定 1–6 与代码逐条核对（锚点 primary、其余 alias；`registerRepository` 是唯一写者且已登记不改指；按声明选择的三种结果；交付来源每工作区一个且不替换；`CHANGE_REQUEST_READ_ROUTE` 的锚点 `change_request.read` 与前置门 `repository.read`），没有被实现推翻的事实。S8 的 R5 差异在计划内部（风险写法与 Design 不一致），不在 ADR 里。
  - 提交的 `Refs #353`：本批之后还有独立验收，所以不在这里写 `Closes #353`；最后一个提交的 `Closes #353`（`Global Constraints`）由协调者在验收后决定，PR 描述的关联以 `closingIssuesReferences` 回读为准。

- **D15 开始工作的懒登记不给已登记的仓库补引用（2026-10-21，独立验收（Claude Opus））**：S12 判为 P1（不变量 D6 被并发打破、状态永久且没有恢复手段、开始工作在同一交错下的行为相对 base 改变），收紧到风险 R5 的写法。做法：`start-work.ts` 的 `registerParents` 在认领事务里先核对，仓库已登记而路由到的连接下没有它的引用即抛错，认领回滚为「本地登记失败，没有发起任何外部写入」的结构化 `unavailable`；`registerRepository` 与 `routeDevelopment` 的签名不变（`Interfaces` 不动）。备选「`registerRepository` 加区分调用方的参数」被否决：改冻结签名，而非竞态路径上路由已保证路由到的连接下有引用，核对只在竞态时触发。证据：新用例先红（两种存储都 Saved 且调用了 `createBranch`、`createWorktree`）后绿；去掉核对与把核对改成「已登记即拒绝」两个变异分别使 R5 与 AC2 并列引用变红。ADR-0015 决定 5 补一句、TD-039 的解决说明同步。没有做行为不变的重构：读过的改动里没有能同时减代码与减风险的点。

- **D16 人类决定：P2 / P3 后续项在本 PR 内实现（2026-10-21，人类伙伴；记录者：实现者（Claude Opus））**。原话：

  > 这些 P2/P3 不应该你自己修复吗？超过弹性 800 行没有关系。但在实现前你应该自己想一想有没有办法简化改动呀。怎么什么小问题都建 issue 呢？请你在现有 PR 中实现并 link 对应 issue

  据此 #385、#383 在本 PR 各一个提交并 `Closes`；#384 在协调者把本分支 rebase 到 #371 的新 head 之后，以 #371 的共享按值比较改 `bindRepository` 并补重放用例（本 PR 关闭 #384，#371 只引用它，D19）。对这三项，本决定取代 #351 演示窗口规则 D2（P2 / P3 → M4.1 issue）；800 行是弹性目标，CI 硬上限仍是代码 1000、文档 1500。
- **D17 #385：改注释，不把拒绝映射成固定文案（2026-10-21，实现者（Claude Opus））**。备选是映射成固定文案并断言 `reason` 不含连接 id；否决：连接 id 是内部不透明 id、不是凭据，开始工作结果带同一段文案，实体的 `content.bindingId` 早已下发，映射只会丢掉「哪几个连接歧义」这条唯一可行动的诊断，还要另立一份拒绝词表。采纳：`WireRepositoryEntry` 注释写明原因可能点名仓库键与连接 id，`WireCapabilityEntry` 的「不带绑定」改成「没有绑定字段」；`AC3 逐仓库可用性` 已断言原因就是路由拒绝文案，不另加测试。
- **D18 #383：规划来源名是引导读到的项目标题，只下发规划来源（2026-10-21，实现者（Claude Opus）；第一版取实现键，协调者裁定实现键不是显示名后改写）**。备选：① 逐绑定 `{ bindingId, domain, implementationKey }` 加 ui-model 标签表——违反平台名契约（S15），逐绑定还要在 wire 上带能力域并校验，今天页面只显示规划条目与规划来源的名字；② 原样显示实现键（第一版）——不是显示名；③ 账号显示名——是账号不是来源；④ 给绑定记录或 `ProviderDefinition` 加显示名——schema 或全部 provider 的改动。采纳：`readProject` 把 `getProject` 读到的标题与 `projectRef` 一起留在 core 上下文（`projectTitle`，同一内存生命周期，不改 schema）；core 元数据 `planningSource` 在规划挂载存在且标题非空时为 `{ bindingId, name }`（空标题算未知，否则 client 会拒帧）；controller 可选头字段 `planningSource`（闭集、逐字段复制，缺席时 wire 与加入前逐字相同），与 `repositories` 同路到 client；ui-model 来源名为「页面给的 → 规划来源自己的行用项目标题 → 未提供」，规划来源名同理，绝不显示实现键或绑定 id，不碰状态文案，`packages/ui` 不改。core 不再为它读 `listProviderBindings`。issue 写的「逐绑定显示名」按意图收窄：两条验收由 #383 用例在两种存储上判定；名字只在内存，Host 启动后首轮读到项目之前显示「未提供」（TD-078）。
- **D19 #384：`bindRepository` 改用 #371 的 `sameMountTarget`（2026-10-21，实现者（Claude Opus））**。备选是在 `bindRepository` 里另写一次按值展开；否决：同一事实会有第二个比较点，#371 已把它收成唯一比较点并导出。改一个调用、补一句重放断言（两种存储），被杀的变异就是原来的 `isDeepStrictEqual` 写法。

- **D20 人类决定 H1：ADR-0015 采纳，并补三条约束（2026-10-21，人类伙伴；记录者：评审修复实现者（Claude Opus））**。人类原话出自评审会话的 AskUserQuestion（2026-10-21，PR #348、#370–#373 的评审会话），由评审会话转给实现者记录。问题陈述：「一个仓库一个实体，各连接下的引用并列挂在同一实体上（首次登记的为 primary 锚点，其余 alias）；按操作选唯一声明者，没有就 not_supported，多个就 conflict，不取先到者；不改 schema」，并附三条约束。所选答复原文：

  > 采纳，并补三条约束 (Recommended)

  三条约束与落点：
  - ①M4.1 提供解绑 / 改绑之前，`conflict` 是终态；承接 issue 是 #387（ADR-0015 Consequences「解绑与改绑（M4.1）」，TD-077 的下一步改指 #387）。
  - ②每个仓库在每个连接下至多一条现行引用（ADR-0015 决定 5；强制点见 D22）。
  - ③`conflict` 与 `not_supported` 的结构化结果带出声明者或服务连接的 id（ADR-0015 决定 4；实现见 D22）。

  机械动作：ADR-0015 状态行改为 Accepted；`docs/adr/README.md` 的索引行改为 Accepted，来源段落改写采纳记录；按 ADR 自己的 Consequences，在 `docs/architecture/gate-e1-ruling.md` 的 R7 行末追加一句指向 ADR-0015。

- **D21 D15 保持：回滚加结构化 `unavailable`，不补引用（2026-10-21，人类伙伴授权，评审会话调研后决定；记录者：评审修复实现者（Claude Opus））**。人类原话出自评审会话的 AskUserQuestion（2026-10-21），由评审会话转给实现者记录：

  > 由你调研相关类似实现后综合判断

  评审会话调研了下列同类系统后，决定保持 D15：开始工作在认领事务里发现「路由之后仓库已被别处登记、路由到的连接下没有它的引用」时整笔回滚，返回结构化 `unavailable`，不补出第二条同类引用。依据是业界对「同一对象的多条外部引用」和「读后写竞态」的共同做法：冲突时拒绝、让调用方重读，而不是让行为未定义或事后靠删除补救。

  调研依据：
  - Sourcegraph 的仓库记录是一条 `ExternalRepo` 加多个 `Sources`，与「一个实体、多条并列引用」同构；但不同代码宿主下出现同名仓库时，官方文档写明此时行为未定义（原文「behavior is undefined」，https://sourcegraph.com/docs/admin/code_hosts/other ），是反例。本 PR 对歧义给出确定的结构化拒绝、不取先到者，正是避开这一点。
  - Backstage 用注解与 locationKey 把实体挂到外部来源；同一 entityRef 来自不同 locationKey 时不覆盖已有实体，记为冲突。
  - Kubernetes ownerReferences 允许多条引用，但至多一条 `controller: true`，第二条在校验时被拒。这对应「每个仓库在每个连接下至多一条现行引用」，以及「多个声明者即 conflict」。
  - Jira 的开发面板挂两条仓库链接时会出现重复提交，补救要靠删除链接，是反例：事后的补救依赖解绑能力，而本版本没有解绑（#387）。
  - 乐观并发的通行做法是比较后拒绝、让调用方重读：Kubernetes `resourceVersion` 不匹配返回 409，HTTP `If-Match` 不满足返回 412，etcd 的 `Txn` 按比较结果整体提交或放弃，Server-Side Apply 遇到字段所有权冲突时拒绝而不覆盖。D15 的「认领事务内核对、不一致即回滚、`unavailable`（恢复动作 `retry`）」属于同一类。
  - 来源：https://sourcegraph.com/docs/admin/code_hosts/other 、https://backstage.io/docs/features/software-catalog/well-known-annotations/ 、https://backstage.io/docs/features/software-catalog/external-integrations/ 、https://kubernetes.io/docs/reference/kubernetes-api/common-definitions/object-meta/ 、https://kubernetes.io/docs/reference/using-api/api-concepts/ 、https://support.atlassian.com/jira/kb/development-panel-showing-duplicate-commits/ 、https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/412 、https://etcd.io/docs/v3.5/learning/api/ 。

- **D22 评审修复（2026-10-21，GitHub review 5595757979 与 D20 的约束，实现者（Claude Opus））**。先把本 PR 整体搬到 #371 的新 head（Progress 的评审修复一条）；逐条：
  - F1（P2）：`queries.ts` 的 `repositoryMetadata` 注释与 TD-035 的解决说明原写「与开始工作、PR 谱系读取走同一个 `routeDevelopment`」，#297 落地前不成立（`chain-facts.ts` 的 `developmentReadBinding` 仍按 key 解析）。改为：开始工作的四个 key 报告的就是命令会用的挂载；逐仓库的 `change_request.read` 可用性只说明这条路由可解析，谱系读取在 #297 接线后才走它。只改文字。
  - F3（P2）：`WireRepositoryEntry` 的注释补「外部身份 id」：缺路由的拒绝文案带上仓库挂载指向的 `externalIdentityId`，它与连接 id 一样是内部不透明 id。
  - F4（P3）：补「首次绑定的锚点是 Development 引用」（两种存储）：未登记仓库的引用按 `[Actions, Local Git]` 给出，仓库挂载仍指向 Local Git 下的 primary，Actions 是同一实体上的 alias。
  - 约束②已强制，不改代码，补一条判别用例「ADR-0015 约束②」（两种存储，只测绑定命令一层：同一实现换目标 `conflict`、零写入、没有第二个同实现的连接或第二条引用）。强制点有三处：存储按自然键 `(bindingId, repository, repositoryId)` 收拢同一连接下的身份（SQLite 的 `UNIQUE (binding_id, external_kind, external_id)` 加 `ON CONFLICT … DO UPDATE SET role`，替身按 `externalObjectKey` upsert：保留原 id 与实体，但 `role` 取新写入的值，所以不是「原行不变」），这一层由 `tests/contract` 存储套件的「外部身份全局一份，重复登记保留已分配的 id 与 entityId」（`tests/contract/suites/storage.js`）与「合法 natural-key replay 只更新 role 且保留稳定身份」（`tests/contract/suites/storage-identity-membership.js`）覆盖，本 PR 不另测；`bindRepository` 的请求内去重（同一 `(domain, implementationKey)` 至多一条，`invalid_input`）；跨请求按 `(domain, implementationKey)` 找已服务该仓库的挂载，目标相同就复用，不同就 `conflict`、零写入，不新建第二个同实现的连接。`registerRepository` 只复用或新建，不改指；开始工作不给已登记的仓库补引用（D15）。
  - 约束③：`conflict` 文案原已列出声明者的连接 id（「AC2 歧义」原有断言）；`not_supported`（多条引用、没有声明者）原返回 `unsupportedCapability(key)`，不带连接。`unsupportedCapability` 的调用方（`execution-run`、`start-work`、`delivery`、`git-provisioning`、`capabilities` 与本文件）与 UI 都不依赖固定文案（ui-model 只认错误码），但它是单 key 的通用拒绝，没有仓库上下文；所以只在路由里改用 `refuse(ProjectErrorCode.NotSupported, …)`，文案保留「能力 <key> 不可用」开头，后接仓库键与服务连接的 id，错误码不变。
  - D15 补充（独立调研的中低置信度提醒）：构造交错——仓库已登记、唯一引用在 A，开始工作按 A 路由之后、认领之前，并发的 `bindRepository` 给同一仓库加上另一实现、同样声明 `worktree.create` 的引用（新连接 B）。两种存储上认领都放行，开始工作经 A Saved。不收紧谓词，理由：B 是绑定命令新铸的连接 id，不在运行中 core 的注册表里（注册表在组合时固定，`bindRepository` 从不在已有的、未服务该仓库的连接下写引用），路由的读集（注册表挂载下该仓库的引用）没有变，所以在认领事务内重新路由得到的仍是 A，与现有谓词等价；落库状态（A primary、B alias）与顺序执行「先开始工作、后绑定」相同，同时挂上 A 与 B 的下一次组合按「AC2 歧义」得结构化 `conflict`。新用例钉住这一现状。R5 的 `unavailable` 原因可识别：错误码 `unavailable`、恢复动作 `retry`、`retryable: true`、文案以「本地登记失败，没有发起任何外部写入」开头；原样重发即重新路由，得到缺路由 `conflict`（「绑定 id 变了，或仓库来自另一个连接」），不再调 provider（R5 用例补了这一段）。它不是约束①的终态歧义 `conflict`：Host 按新挂载重组（#354）之后，仓库的引用所在连接进入注册表，缺路由就消失，重组后同键重发得 Saved（第二轮评审时以临时探针在两种存储上实测：首发 `unavailable`、同 core 同键重发 `conflict`、以同一规划绑定 id 和 `[L1, G1]` 重组后同键重发 `saved`；探针未入库）。
  - P-4、U-F5、TD-077、#384：计划文字按事实订正（`docs/README.md` 加了 Active 索引一行；与 #372 有一处代码冲突；TD-077 的下一步指向 #387；本 PR 关闭 #384）。
  - 变异（`node scripts/review-mutate.mjs <spec>`，命令 `node --test --test-timeout=120000 tests/integration/workspace-setup-commands.test.js tests/e2e/repository-routing.test.js`），9 个全部 KILLED、`killedBy` 归因成立（第二轮评审 R2-1 删掉约束②用例的端口层一段后，C2c 只由存储契约套件覆盖，移出本表，余 8 个）：

    | id | 改动 | killedBy |
    |---|---|---|
    | V19 | `const anchorFirst = created`（去掉 Development 引用前置） | 首次绑定的锚点是 Development 引用 |
    | C2a | 去掉「已有引用而目标不同」的 `conflict` | 约束② |
    | C2b | 不找已服务该仓库的同实现挂载（恒新建） | 约束② |
    | C3a | 无声明者分支改回 `unsupportedCapability(key)` | AC2 歧义 |
    | C3b | `conflict` 文案去掉声明者的连接 id | AC2 歧义 |
    | D15a | 核对改为「已登记即拒绝」 | D15 补充 |
    | D15b | 认领时实体上另有现行引用即拒绝（朴素的「重新路由」） | D15 补充 |
    | D15c | R5 的 `unavailable` 文案去掉「没有发起任何外部写入」 | 风险 R5 |
- **D23 收尾由评审会话接手（2026-10-21，评审会话（Claude Opus）；人类可推翻）**：
  - 修复复评结论为「可以」，三条 P3 已在 D22 落地，之后由评审会话按分工收尾。
  - #372、#371 先后合并到 main。本 PR 的全部改动作为一个整体搬到 main `66870dfd` 上，三处冲突：
    - `work-item-list-view.ts`：rows 用 `nameOf`，保留 #372 的 `partial`；
    - tracker：Open 段取 main 上 TD-070–073 的版本，接本 PR 的 TD-074–078；
    - `docs/README.md`：取两边的行。
  - 本计划里指向 #127 计划的路径改为 completed。
  - 补并集评审 U-F1：`tests/integration/harness-plugin-host-watch.test.js` 的 AC2 用例断言真实插件页面显示「规划来源：项目 Alpha」。变异 U1（页面恒传「规划来源名称未提供」）被它杀死；U2（行来源不退到规划来源名）仍由 #383 的单元用例守着。
  - 提交整合为 plan（ADR-0015 以 Proposed 提出）→ 代码（全部实现与测试，Closes #383、#384、#385）→ 归档（ADR-0015 采纳、R7 指引、回填，Closes #353）。
  - 按人类伙伴在开发会话里的决定（「遵守 D2，不加」），不新增 `docs/review/` 记录。

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
// WireWorkspaceHeader 与 client 的 ClientWorkspaceRead 新可选字段：readonly repositories?: readonly WireRepositoryEntry[]（ClientWorkspaceRead 里另带 `| undefined`，见下方回读）
// packages/ui-model/src/capability-access.ts
export function repositoryAccessIndex(workspace: readonly CapabilitySnapshotEntry[], repository: readonly CapabilitySnapshotEntry[]): ReadonlyMap<string, AccessLevel>
```

需要 #127 配合（请协调者转达）：① controller 的 `SetupOutcome → CommandResult` 映射（`ok` → `local_only`、`conflict` → `conflict`、其余 → `failed`）写成 `commands.ts` 内一个模块私有函数，供 `bindRepository` 复用；② `readMountTarget` 的返回值总带 `accountId` 键（值可为 `undefined`）、配置缺席给 `{}`，本 PR 用 `isDeepStrictEqual` 比较；③ 测试文件的 `openStore(kind)` 接受可选 `policy`（#127 不加则本 PR 加）。回读（Batch 4）：① ② 已由 #127 的代码满足，③ 由本 PR 自己加（S6）。其余辅助函数（`runSetup`、`refuse`、`assertClosed`、`MountTarget`、`writeMount`、`createSetupCommands` 的 `replay`）都已在 #127 的 Interfaces 里。

回读（Batch 4，2026-10-21）：上面的块与导出代码逐项核对，签名一个未改；与块内写法的差异只有三处。① `ClientWorkspaceRead.repositories?` 的类型是 `readonly WireRepositoryEntry[] | undefined`（`packages/client/src/workspace-read.ts`），`WireWorkspaceHeader.repositories?` 不带 `| undefined`（S11）。② `RepositoryMetadata` 不是命名再导出：它在 `queries.ts`，随 core 的 `export * from './queries.ts'` 到达包入口；core 的命名再导出恰为 `BindRepositoryRequest`、`RepositoryBinding`、`RepositoryReferenceRequest` 三个类型。③ `BindRepositoryInput`、`WireRepositoryEntry` 随 controller 包入口的 `export *` 到达，`ClientWorkspaceRead` 由 client 入口导出，`repositoryAccessIndex` 随 ui-model 的 `export * from './capability-access.ts'`；`development-route.ts` 的导出（`START_WORK_ROUTE`、`CHANGE_REQUEST_READ_ROUTE`、`repositoryReferences`、`registerRepository`、`DevelopmentOperation`）仍不进 core 包入口，#297 同样在 core 内相对引用。

回读（并回 #383，2026-10-21）：新增 `CoreContext.projectTitle: string | undefined` 与 `WorkspaceMetadata.planningSource: { readonly bindingId: ProviderBindingId; readonly name: string } | undefined`（core）、`WirePlanningSource { readonly bindingId: ProviderBindingId; readonly name: string }` 与 `WireWorkspaceHeader.planningSource?: WirePlanningSource`（controller）、`ClientWorkspaceRead.planningSource?: WirePlanningSource | undefined`（client）；ui-model 的导出签名不变。PR #372 的插件页面传 `sourceNames: {}`，不改 `packages/ui` 就显示项目标题。

下游契约：#297 的变更请求读与远端分支头读都用 `CHANGE_REQUEST_READ_ROUTE`，不单独按 `repository.read` 路由；#354 的远程操作调 `SetupCommands.bindRepository`、填固定 `WORKSPACE_ID`、`ok` 后重组；#355 的 `development.github` 与 `github-actions` 条目配置含 `repositoryExternalId`、`repositoryOwner`、`repositoryName`；#356 从同一个 `repositoryId` 生成各引用的配置（TD-076）；#142 列出 `read.repositories`、按 `repositoryAccessIndex` 判定可用性并接手「绑定仓库」恢复动作；PR B（#229）与本 PR 在 `packages/client/src/workspace-read.ts`、`store.ts`、`sync.ts` 都只追加，后合并者 rebase 并重跑 Batch 3 的验证。

依赖：Node 26（`.nvmrc`）、`pnpm install --frozen-lockfile`；只读引用 `apps/harness-plugin/src/host-providers.ts`（`PROVIDER_CATALOG`、`hostStoragePolicy`）与真实的 `@harness-projects/provider-development-local-git`、`@harness-projects/provider-development-github`（只取声明）。无凭据、无网络；`gh` 只用于 issue 与 PR 的仓库 REST。

## Outcomes & Retrospective

实施完成并经独立验收（2026-10-21；Batch 1–4 与验收修复 `4bcd7e1` 已提交，draft PR #373 叠在 #371 上）。

- 独立验收：五条验收各有判别用例，25 个变异全部变红（「独立验收读回」）。发现并修复一条 P1：路由之后、认领之前的并发绑定让开始工作补出同类引用，使仓库永久歧义（S12、D15），修复后 H2 关闭。#372 与本 PR 当时代码合并无冲突且合并树全绿（S13）；#372 的 #382 之后与 #372 有一处代码冲突（`work-item-list-view.ts`），两边保留：rows 用 `nameOf`，保留 `partial`；在 #372 合并后变基时解（D22）。P3 发现三项：S14 的空原型配置比对（#384，按 D16 并回本 PR，D19 已改用 #371 的 `sameMountTarget`）；元数据逐仓库求现行引用三次（TD-075 已按实测改写读放大）；逐仓库能力项的 `reason` 可能含连接 id（与开始工作命令结果里的路由文案相同，不是新增披露）而注释写「不带服务它的绑定」（#385，按 D17 订正注释）。下面各条是实施者的回填，独立验收只改了与 S12、S13 相关的句子。

- 结果：issue #353 的五条验收在内存替身与 SQLite 文件上各有判别用例并全绿（读回见 `Validation and Acceptance` 的「实测读回」）。`bindRepository` 在一个事务里写下一个仓库实体、并列引用与各自的连接，同请求重发零写入；`routeDevelopment` 签名与两个调用点不变，按操作在并列引用之间路由，歧义与缺路由结构化拒绝；逐仓库可用性经 core 元数据、controller 的可选头字段 `repositories`、client 校验到 ui-model 的 `repositoryAccessIndex`，两个 Development 挂载时不再被 key 级 fail closed 盖住；GitHub Actions 作为交付来源加入且不替换。#219 的 E 系列（`tests/e2e/start-work.test.js`）相对 base 零 diff、仍全绿。变异 N1–N16 与补充的 N-a–N-p 都有用例变红，只有 N-g 存活（S7：只有「路由之后、认领之前」的并发写能到达，按 Design 保留为防御）。
- 与计划的偏差：S6（`openStore` 的 `policy` 参数由本 PR 自加）、S7（「原子性」一行的「写入计数 0」做不到，改以阳性对照加 `snapshot` 不变）、S9（多两条 AC2 用例判别 N-h、N-i）、S10（一条既有的结构断言随 `repositories` 调整）、S11（`repositories?` 不带 `| undefined`，client 用条件展开）。体量观察时刻 2026-10-21 @ `3169877`：代码 + 测试 714 行，在 ≤ 800 的预算内。
- 没有证明的部分：Host 还没有暴露 `bindRepository`（#354），UI 还没有调用方（#356、#142），所以 Host 内与界面内的端到端未证明，`docs/product/vertical-path.md` 因此不升级（D14）；#355 之前 Host 的存储策略拒绝 `development.github` 与 `github-actions` 的配置（F10），Host 内绑定 GitHub 或 Actions 引用得 `invalid_input`。
- 人类决定：H1 已决（2026-10-21，ADR-0015 采纳并补三条约束，D20）；H2 已由独立验收按 R5 收紧（D15），人类伙伴授权评审会话调研后保持（D21）。
- 评审修复（D22）：F1、F3 订正注释与 TD-035 的说明；约束③ 让无声明者的 `not_supported` 带出服务连接 id；F4、约束②与 D15 补充各有钉住现状的判别用例（两种存储），8 个变异全部变红（第二轮评审 R2-1 删掉约束②用例的端口层一段，存储按自然键收拢由存储契约套件覆盖）；D15 补充的交错在运行中的 core 里得不到 conflict（新连接不在注册表里），认领放行，结果与顺序执行相同，谓词不改。
- 并回（D16）：#385 订正注释（`88dd4df`）；#383（`9f0c4c9` 加 `ab8dfdc`）让插件页面不传名字时也显示规划来源名，名字是引导读到的项目标题，未知时仍是「未提供」，20 个变异全部变红；#384（`54036ba`）让 `bindRepository` 用 #371 的 `sameMountTarget`，空原型配置的同值重发零写入。体量观察时刻 @ `ab8dfdc`：代码 + 测试 854 / 1000 行，文档 551 / 1500 行（本条文档提交之前）。
- 技术债：新登记 TD-074（一个交付来源）、TD-075（每次快照的路由读放大）、TD-076（配置里的仓库键不核对）、TD-077（同类引用歧义无解绑）；TD-035、TD-039 关闭；TD-036、TD-037、TD-038、TD-054、TD-064 更新（D14）。并回 #383 新登记 TD-078（规划来源名只在内存，Host 启动后首轮读到项目之前未知）。
- 下游：#354 暴露 `bindRepository` 并在 Host 内证明；#355 加 `development.github` 与 `github-actions` 目录条目；#356 从同一个 `repositoryId` 生成配置；#142 消费 `repositoryAccessIndex` 并接手「绑定仓库」恢复动作；#297 用 `CHANGE_REQUEST_READ_ROUTE` 接线谱系读取。PR #372（#229）在 client 不改本 PR 的三个文件（S13）；与 #372 有一处代码冲突（`work-item-list-view.ts`），两边保留：rows 用 `nameOf`，保留 `partial`；在 #372 合并后变基时解，同时解 tracker 与 `vertical-path.md` 的文档冲突并重跑 Batch 3 的验证（D22）。


2026-10-21（收尾与归档，评审会话）：#353 的五条验收、#383 两条、#385 与 #384 的 bindRepository 一半都有用例并经评审复跑。ADR-0015 经人类伙伴采纳（三条约束写入正文，承接 issue #387）。在宿主里绑定 GitHub 引用要等 #355；UI 读逐仓库可用性要等 #142；谱系读取改走 `CHANGE_REQUEST_READ_ROUTE` 要等 #297（契约已登记）。
## Bottom Change Note

- 2026-10-21：创建。设计评审（Claude Opus，独立评审 subagent）把三份提案收敛为本计划，决策见 D1–D10；同时写 `docs/adr/ADR-0015-repository-references-side-by-side.md`（Proposed）。
- 2026-10-21：Batch 1 完成：Progress 记红绿与变异表；新增 S6–S8、D11，S8 提出待决定 H2。
- 2026-10-21：Batch 2 完成：Progress 记红绿与变异表；新增 S9、D12（为 N-h、N-i 补两条判别用例）。
- 2026-10-21：Batch 3 完成：Progress 记红绿与变异表；新增 S10、S11、D13（既有测试只改了 `ui-model-presentation` 的一条结构断言）。
- 2026-10-21：Batch 4 完成：文档与门禁。tracker 追加 TD-074–077、关闭 TD-035 与 TD-039、更新 TD-036 / 037 / 038 / 054 / 064；ADR 索引加 ADR-0015；`Validation and Acceptance` 补实测读回，`Interfaces and Dependencies` 补导出回读，`Outcomes & Retrospective` 回填；新增 D14。
- 2026-10-21：独立验收（Claude Opus）：`Validation and Acceptance` 加 R5 一行与「独立验收读回」；新增 S12–S14、D15；Progress 记独立验收与 H2 关闭；`Outcomes & Retrospective` 补验收结论；同提交改 ADR-0015 决定 5 一句、TD-039 解决说明与 TD-075 的读放大。修复代码在 `4bcd7e1`。
- 2026-10-21：并回 #385、#383（人类决定 D16，实现者（Claude Opus））：代码在 `6bc058c`、`69b41ac`；新增 S15、S16、D16–D18，S14 改写承接；Progress 记红绿与 18 个变异，加 H3；`Validation and Acceptance` 加三行；`Interfaces and Dependencies` 补回读；`Outcomes & Retrospective` 改写 P3 一句并补并回结果；`Global Constraints` 补文件集；tracker 新增 TD-078、TD-075 补一句。#384 待做。
- 2026-10-21：协调者 rebase 到 #371 的新 head 之后（实现者（Claude Opus））：#384 在 `54036ba` 改用 `sameMountTarget`；#383 第二版（`ab8dfdc`）把来源名从实现键改为项目标题。改写 S14–S16、D18，新增 D19；Progress 记两项的红绿与 20 个变异、H3 关闭；`Validation and Acceptance` 的三行、`Interfaces and Dependencies` 回读、`Outcomes & Retrospective` 与 `Global Constraints` 随之更新；tracker 改写 TD-078、TD-075 去掉已不存在的常数读。
- 2026-10-21（协调者）：提交整理为同树重写的可审阅序列（推送前在本地留了备份 ref，用精确 lease 推送）。正文中整理前的提交号已不在分支历史里，对应关系（整理前 → 当前；多个旧提交可能并入同一个）：`06111e5` → `6adb8ab`、`3169877` → `8bc58d0`、`4bcd7e1` → `b630926`、`4d281d4` → `89e1187`、`54036ba` → `76f58ad`、`69b41ac` → `eb8d93f`、`6a902de` → `7ff864a`、`6bc058c` → `4e19652`、`88dd4df` → `4e19652`、`9f0c4c9` → `eb8d93f`、`ab8dfdc` → `eb8d93f`。当前序列在检出 `feature/repository-binding` 的工作树根目录用 `git log --oneline origin/feature/workspace-binding-commands..HEAD` 回读。
- 2026-10-21：评审修复（实现者（Claude Opus））：本 PR 整体搬到 #371 的新 head `4c33736`；新增 D20（人类决定 H1：ADR-0015 采纳并补三条约束）、D21（D15 保持与调研依据）、D22（F1、F3、F4、约束②③、D15 补充、P-4、U-F5、TD-077、#384）；Progress 记 H1 关闭与评审修复，`Validation and Acceptance` 加一行，`Outcomes & Retrospective` 补两条；ADR-0015 改 Accepted 并写入三条约束，R7 行末追加指向它的一句。
- 2026-10-21：第二轮评审 P3 修复（实现者（Claude Opus））：搬到 #371 的 `e7c9b1b`；R2-1 删掉约束②用例的端口层一段（两种存储实测把锚点的 primary 改成 alias，断言与注释说的「原行不变」不符），D22 改为引用存储契约套件的两条用例、变异表去掉 C2c；R2-2 订正 D21 里 Sourcegraph 的说法（行为未定义）并附来源；R2-3 写明 R5 重发得到的是缺路由 `conflict`，Host 重组（#354）后消失；D20、D21 写明原话出处。
- 2026-10-21（评审会话）：收尾（D23）。搬到含 #371、#372 的 main，补 U-F1，整合提交，计划归档；正文里整理前的提交号以提交标题对应。
