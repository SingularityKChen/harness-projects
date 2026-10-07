# Development 按仓库路由 ExecPlan

> 状态：Active（设计定稿，待实现；Batch 1–3 未开始）
> 创建：2026-10-08 CST；规范：`PLANS.md`
> 关联：[issue #219](https://github.com/SingularityKChen/harness-projects/issues/219)（本 PR 关闭）；epic #216 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 的 Batch 2B 与验收第 4 行；迭代 5 承诺项（`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` D6）
> 执行上下文：检出 `feature/development-repository-routing` 的工作树根目录（本仓库约定的位置是 `.worktrees/development-repository-routing`），起点 `origin/main@6417d45`。下文命令都在这里运行；`gh` 命令一律带 `-R SingularityKChen/harness-projects`。
> 上游输入：issue #219 正文；`AGENTS.md` §1.1、§2；`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`；`docs/exec-plan/completed/2026-10-01-provider-binding-registration.md`（#197 把同域多挂载留给本 issue）。三份互相独立的设计稿（最小闭环 α、系统与不变量 β、同类工具调研 γ）和协调者的跨 PR 契约 K1–K8 是运行态输入，不入库（`AGENTS.md` §3）；本计划只重述其中被采纳或被否决的结论，相关契约条目抄在 `Interfaces and Dependencies`。

## Purpose / Big Picture

完成后：

- 一个工作区可以同时挂两个或更多 Development 连接：Local Git 与 GitHub，或两个各管一个检出的 Local Git。开始工作按「这个仓库属于哪个连接」这条已持久化的事实路由——仓库挂载（`RepositoryRecord`）指向的外部身份在哪个连接下，请求就只进那个连接，另一个连接一次调用都收不到。
- 仓库没有登记而候选连接不止一个（歧义），或仓库登记在一个当前没有挂载的连接上（缺路由），都在任何外部调用与本地写入之前返回结构化拒绝 `conflict`，不取第一个注册者。路由到的连接缺某个能力时报 `not_supported`，不改道到另一个声明了该能力的连接。
- 注册的挂载连同角色读回：唯一的 Development 挂载是默认（与今天相同）；两个及以上时全部非默认，Storage 读回与 Registry 一致，不会出现「先写的默认被 Storage 静默降级」的分叉。
- key 级解析（`bindingForCapability` / `gateCommand`）在同域多个对等挂载时 fail closed。还没改用路由的读取（今天的谱系读取）得到缺口，不会读错连接。
- 单 Development 挂载的工作区行为不变，只有一处有意的保护性变化：连接换了之后（Development 绑定 id 变了），已 Ready 的上下文读回不再被另一个连接判成 Failed，而是保留 Ready、报 Unknown（`Decision Log` D8）。

最小成功证据：`tests/e2e/start-work.test.js` 新增的四条路由用例、`tests/contract/capabilities-keys.test.js` 的两条契约用例、`tests/integration/provider-binding-registration.test.js` 的角色读回场景（替身与 SQLite 各跑一次）全部通过；`Artifacts and Notes` 的 18 条变异逐条变红。

## Context and Orientation

### 术语

| 词 | 本计划里的意思 |
|---|---|
| 连接 | `provider_binding` 的一行：一个 provider 实现实例的锚点，`id` 即 `bindingId`，可以被多个工作区挂载（ADR-0006） |
| 挂载 | 某工作区在某能力域启用某连接：Registry 里是 `ResolvedBinding`，Storage 里是 `ProviderBindingRecord`（带 `enabled`、`isDefault`） |
| 默认挂载 | `isDefault = true`。本计划把它定义为「key 级解析的目标」 |
| key 级解析 | 只凭 capability key 找挂载：`bindingForCapability`（`packages/capabilities/src/registry.ts`）→ `resolveCapability`（`packages/core/src/registry.ts`）→ `gateCommand` / `resolveWriteTarget` / `effectiveAccess`（`packages/core/src/capabilities.ts`） |
| 仓库挂载 | `RepositoryRecord(workspaceId, id) → externalIdentityId`：工作区登记的仓库指向一条 `repository` 种类的外部身份，身份的 `bindingId` 就是它所属的连接 |
| 路由 | 本计划新增的 `routeDevelopment`：按仓库选 Development 挂载，并给出该挂载下的仓库引用 |
| 锚点 key | 多步操作只路由一次时所用的 key（开始工作用 `development.worktree.create`）；同一操作的其余 key 在同一个挂载上过门 |

### 现状（`origin/main@6417d45`，行号以此为准）

- **注入表每域一个槽位**：`packages/core/src/registry.ts:17-24`（`CoreProviderTable`）、`:39-42`（`MOUNT_SLOTS`）、`:73-101`（`mountsOf`）。传 `development: [a, b]` 得到 `TypeError: 槽位 development 的 port 缺少必需方法`；另开一个槽位得到 `未知的 provider 槽位 …`。
- **Registry 不接受第二个 Development 挂载**：`packages/capabilities/src/registry.ts:47-65`（`providerRegistry`）。第 57 行只允许 Execution 有非默认挂载，第 61–62 行每域至多一个默认、一个备用。两个 Development 挂载按 `[默认, 默认]`、`[默认, 非默认]`、`[非默认, 非默认]` 三种组合全部被拒。
- **只放宽校验会取第一条**：同文件 `:82-88` 的 `primary ?? spare`。两个非默认 Development 挂载时返回先注册的那个（实测返回 `dev-a`）。
- **Storage 会降级旧默认**：`ProviderBindingRecord` 的写入语义（`packages/capabilities/src/storage.ts`）规定同工作区同域写新的默认会把旧默认降级。实测替身与 SQLite 依次写两个默认后都读回 `dev-a:false dev-b:true`；把已有的默认挂载改写成非默认则如实读回 `false`。
- **core 里只有三个文件调用 Development**：
  - `packages/core/src/start-work.ts:114-143`（`prepareRegistration`：三个注册门、`resolveWriteTarget(worktree.create)`、仓库 ack、第 135–141 行的挂载冲突预检，文案里写着「多 binding 路由见 #219」）与 `:409-428`（`verifyExistingWorktree`，按 key 解析 `worktree.read`）；
  - `packages/core/src/git-provisioning.ts:115-128`（`provisionGit`：`resolveWriteTarget(worktree.create)`，再用请求串拼仓库引用）；
  - `packages/core/src/chain-facts.ts:63-106`（谱系读取：`gateCommand` 加请求串拼引用；第 6 行写明「同一外部 id 视为各 provider 下的同一对象」这条显式假设）。
  - 另外 `packages/core/src/queries.ts:100-112` 的 `workspaceMetadata` 按 key 汇总全部能力，ui-model 据此判定开始工作是否可用（`packages/ui-model/src/capability-access.ts:15-18`）。`bootstrap.ts`、`delivery.ts` 不用 Development key。
- **「仓库属于哪个连接」今天已经持久化**：唯一写者 `registerParents`（`start-work.ts:150-165`）在认领事务里写一条 `repository` 身份（`bindingId` 是当时的 Development 连接，`externalId` 是请求的 `repositoryId`）和仓库挂载（`id` 也是请求的 `repositoryId`）。`putRepository` 拒绝把同一挂载改指向另一条身份（见 `storage.ts` 中 `putRepository` 的注释）。
- **一个 Local Git 实例只管一个仓库**：`packages/providers/development-local-git/src/provider.ts:15-24`、`:348-352`。所以即使不接 GitHub，一个工作区有两个本地检出也需要两个 Development 挂载。
- **外来引用的端口义务已经钉住**：`tests/contract/suites/development.js` 的「外来 binding 的仓库引用被拒绝，不读也不写」；替身与 Local Git 都按 `bindingId` 判断归属，外来引用答 `not_found`。
- **替身的种子会掩盖误路由**：每个 `createFakeDevelopmentProvider({ bindingId })` 都在自己的连接下种一个 `repo-alpha` 和它的 `main` 分支（`packages/providers/fake/src/development.ts` 的 `seedDevelopmentState`）。两个替身都能「成功」处理 `repo-alpha`，误路由不会自己报错，只有逐次调用的记录能区分。
- **重组后换连接会把 Ready 判成 Failed（已复现，见 `Artifacts and Notes` 的 R1）**：同一份 Storage 换一个 Development 连接重新组合，再对已 Ready 的上下文换新键开始工作，结果是 `failed / not_found`，记录被改写成 Failed，新连接收到一次 `getWorktree`。
- **上游分工**：#197 把「同域多挂载、默认与角色」留给本 issue（`docs/exec-plan/completed/2026-10-01-provider-binding-registration.md:47`）；#127 的验收拥有「一个内部仓库并列持有 Local Git 与 GitHub 引用」和绑定仓库命令；#132 排在本 issue 之后；#235、#233 被本 issue 阻塞。
- **基线**：在检出 `origin/main@6417d45` 的工作树根目录，`node --test tests/contract/capabilities-keys.test.js tests/e2e/start-work.test.js tests/integration/provider-binding-registration.test.js tests/integration/start-work-sqlite-registration.test.js` 为 128 / 128。

## Design / Spec

### 决策一览

1. 路由来源是已持久化的仓库挂载加外部身份，不另立路由表。
2. `CoreProviderTable.development` 接受单个 provider 或数组；单个等于单元素数组，空数组等于没有挂载。
3. 默认等于「key 级解析的目标」：Development 的唯一挂载是默认，多个时全部非默认。
4. key 级解析在同域多个对等挂载时 fail closed。
5. 路由键是仓库。capability key 只用来在路由到的挂载上过门；一次操作只路由一次；路由结果带着该挂载下的仓库引用。
6. 拒绝复用既有错误码，不新增 `ProjectErrorCode`。
7. 开始工作的三处 Development 调用改走路由；谱系读取（`chain-facts.ts`）按 K3 留给 PR-C 的缝函数，合并后由后合并者接上。

每条的理由与「可由人类推翻」标注见 `Decision Log` D1–D14。

### 路由来源：持久化事实，不是组合时注入的路由表

γ 提议 Host 在组合时注入一张「仓库 → 连接」表。否决理由：仓库属于哪个连接今天已经由 `RepositoryRecord` 加外部身份持久化（唯一写者 `registerParents`），再注入一张表就是同一事实的第二个权威源，`AGENTS.md` §2 要求先写 ADR 与契约测试；γ 自己也承认最终要「由存储派生、Host 照着传入」。由持久化事实推出路由还有两个直接收益：重启后路由不需要额外状态（#132）；路由只取决于持久化事实，所以「换连接把 Ready 判成 Failed」（R1）由构造关闭——仓库登记在旧连接上，新连接根本不是它的路由。

### 注入表与角色

    // packages/core/src/registry.ts
    export interface CoreProviderTable {
      readonly planning?: PlanningProvider
      /** 单个与单元素数组同义；空数组即没有挂载。唯一挂载是默认，多个挂载一律非默认、命令按仓库路由（`development-route.ts`）。 */
      readonly development?: DevelopmentProvider | readonly DevelopmentProvider[]
      readonly delivery?: DeliveryProvider
      readonly execution?: ExecutionProvider
      readonly executionFallback?: ExecutionProvider
      readonly storage?: Storage
    }

- 归一只在 `mountsOf` 一处：每个槽位展开成 0..N 个挂载；只有 `development` 接受数组，其他槽位传数组照旧被「port 缺少必需方法」拒绝。数组元素的槽位名写成 `development[i]`，出现在错误文案里。
- 角色：`isDefault = (Development 挂载数 === 1)`；其余槽位不变（主槽位默认，`executionFallback` 非默认）。
- 同一对象注入两次、或两个对象报同一个 `bindingId`，由既有的 `providerRegistry` 重复检查在写 Storage 之前拒绝，不新增代码。

### Registry 校验规则（`providerRegistry`）

| 域 | 允许 | 拒绝（`TypeError`，在写任何 Storage 之前） |
|---|---|---|
| planning、delivery | 至多一个，且必须是默认 | 非默认挂载（文案含「备用」）；多个默认 |
| execution | 至多一个默认、至多一个非默认（备用） | 多个默认；多个备用 |
| development | 恰好一个且是默认；或两个及以上且全部非默认 | 多个默认（文案含「默认」）；默认与非默认混用、单个非默认（文案含「角色」） |

其余规则（同一工作区、`(bindingId, domain)` 唯一、只带本域 port）不变。为什么要拒绝「默认与非默认混用」和「单个非默认」：默认的含义是「key 级解析选它」，混用时读回会说某个挂载是默认，而 key 级解析其实不选它，读回的角色就与 Registry 的行为不一致（验收 3）。

### key 级解析（`bindingForCapability`）

    const target = key === CapabilityKey.ExecutionRunFallback ? spare
      : key === CapabilityKey.ExecutionRunStart ? primary
      : primary ?? (mounts.length === 1 ? spare : undefined)

只改最后一个分支：主挂载缺失时，只有该域恰好一个启用挂载才选它（保住 Execution「只有备用时读用备用」的现有语义），否则返回 undefined。不采用 β 的「恰好一个声明者才返回」：能力子集不是路由事实——两个 Local Git 声明的能力完全相同，Local Git 与 GitHub 都声明 `development.repository.read`，按唯一声明者放行等于按能力猜仓库归属。

### 路由（新文件 `packages/core/src/development-route.ts`）

    export interface DevelopmentRouteSource {
      readonly workspaceId: WorkspaceId
      readonly registry: ProviderRegistry
      readonly storage: Pick<Storage, 'listRepositories' | 'findExternalIdentity'>
    }

    export type DevelopmentRoute =
      | { readonly ok: true; readonly binding: ResolvedBinding; readonly provider: DevelopmentProvider; readonly repository: ExternalObjectRef }
      | { readonly ok: false; readonly error: ProjectError }

    export async function routeDevelopment(
      source: DevelopmentRouteSource, repositoryId: string, key: CapabilityKey, mode: CommandMode,
    ): Promise<DevelopmentRoute> {
      const mounts = bindingsForDomain(source.registry, 'development')
      const refuse = (code: ProjectErrorCode, message: string): DevelopmentRoute => ({ ok: false, error: projectError(code, message) })
      if (mounts.length === 0) return refuse(ProjectErrorCode.NotSupported, `没有绑定提供能力 ${key}`)
      const ids = mounts.map((mount) => mount.ref.bindingId).join('、')
      const registered = (await source.storage.listRepositories(source.workspaceId)).find((mount) => mount.id === repositoryId)
      let binding: ResolvedBinding | undefined
      if (registered === undefined) {
        if (mounts.length > 1) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记在本工作区，而工作区有 ${mounts.length} 个 Development 挂载（${ids}）：不取第一个注册者，先登记它属于哪个连接（绑定仓库，#127）`)
        binding = mounts[0]
      } else {
        for (const mount of mounts) {
          const identity = await source.storage.findExternalIdentity(mount.ref.bindingId, ExternalIdentityKind.Repository, repositoryId)
          if (identity?.id === registered.externalIdentityId) binding = mount
        }
        if (binding === undefined) return refuse(ProjectErrorCode.Conflict, `工作区已把仓库 ${repositoryId} 挂在外部身份 ${registered.externalIdentityId} 上，但当前 Development 绑定 ${ids} 下没有它的身份——绑定 id 变了，或仓库来自另一个连接：不猜映射，Development 绑定 id 必须跨重启稳定`)
      }
      const gate = gateBinding(binding, key, mode)
      const provider = binding?.development
      if (!gate.allowed || binding === undefined || provider === undefined) return { ok: false, error: gate.error ?? projectError(ProjectErrorCode.NotSupported, `能力 ${key} 不可用`) }
      return { ok: true, binding, provider, repository: { bindingId: binding.ref.bindingId, objectKind: 'repository', externalId: repositoryId, url: undefined } }
    }

配套的两个门函数（两处都只是把既有函数体拆出一个「在已选定挂载上判定」的入口）：

    // packages/core/src/registry.ts：resolveCapability(registry, key) ≡ resolveBinding(bindingForCapability(registry, key), key)
    export function resolveBinding(binding: ResolvedBinding | undefined, key: CapabilityKey): CapabilityResolution
    // packages/core/src/capabilities.ts：gateCommand(registry, key, mode) ≡ gateBinding(bindingForCapability(registry, key), key, mode)
    export function gateBinding(binding: ResolvedBinding | undefined, key: CapabilityKey, mode: CommandMode): CommandGate

要点：

- 只读 Storage，不调用 provider；事务内外都能用（`CoreContext` 与事务句柄都满足 `DevelopmentRouteSource`）。
- 已登记仓库的锚点查找：逐个挂载调 `findExternalIdentity(挂载连接, repository, repositoryId)`，身份 id 等于仓库挂载记录的那条就是路由目标。身份的 `bindingId` 唯一、Registry 不允许同域同 id 两个挂载，所以至多一个命中。它依赖「`RepositoryRecord.id` 等于锚点身份的 `externalId`」这条约定（唯一写者如此写），Storage 端口也没有按 id 取身份的方法，登记为 TD-036。
- 路由结果带着该挂载下的仓库引用 `repository`：调用方只用它调 provider，绝不自己用请求串拼引用。今天它的 `externalId` 就是 `repositoryId`；#127 把内部仓库 id 与各连接下的外部 id 解耦时，只改本函数。
- 不导出到 `packages/core/src/index.ts`：消费者都在 core 内部（开始工作，以及 K3 的谱系缝函数），不扩公共面，也不与 PR-C 改 `index.ts` 冲突。

### 拒绝语义

所有拒绝都发生在任何 provider 调用之前；开始工作的新请求在拒绝时不写任何本地行（不落上下文、不登记仓库）。

| 情形 | 错误码（恢复动作） | 文案要点 | 判别用例 |
|---|---|---|---|
| 工作区没有 Development 挂载 | `not_supported`（`manual_execution`） | 沿用「没有绑定提供能力 K」；仓库已登记时也不报「绑定 id 变了」 | E3 末段 |
| 歧义：仓库未登记，Development 挂载 ≥ 2 | `conflict`（`reapply`） | 列出全部候选连接；「不取第一个注册者」 | E2 |
| 缺路由：仓库已登记，但它的身份不在任何当前挂载的连接下 | `conflict`（`reapply`） | 保留「当前 Development 绑定 X 下没有它的身份——绑定 id 变了」 | E3、`tests/integration/start-work-sqlite-registration.test.js` 两条既有 conflict 用例 |
| 路由到的挂载未声明该 key，或该 key 不可用 | `not_supported`（`manual_execution`） | 沿用「能力 K 当前不可用」；不改道 | E4 |
| 写命令遇到只读 | `permission_denied`（`fix_permission`） | 沿用「能力 K 当前只读」 | 既有 `REJECTIONS` 行 |

不新增 `ProjectErrorCode`：新码要跨 `packages/domain`、wire、ui-model 与 golden 表改动，还需要一个现在不存在的恢复动作（「去绑定仓库」）。这个动作在 #127 / #142 有界面之前没有消费者；缺路由沿用 `start-work.ts:140` 已有的 `conflict` 先例。可由人类在 PR 评审时推翻（D6）。

### 调用点

- `prepareRegistration`：工作项预检之后，`routeDevelopment(context, request.repositoryId, worktree.create, 'write')`；失败即拒绝。随后三个注册门（`branch.create` 写、`repository.read` 读、`worktree.read` 读）用 `gateBinding(route.binding, key, mode)` 在同一挂载上过门。仓库 ack 向 `route.provider.getRepository(route.repository)` 要，回显必须逐字等于 `route.repository`。登记用 `route.repository.bindingId`。删除第 135–141 行的挂载冲突预检（它就是路由的「缺路由」分支）。
- `provisionGit`：同样按 `worktree.create` / `'write'` 路由；拒绝时 `gitFailure(contextId, markFailed(beginWrite(names.path), route.error), undefined, undefined)`。仓库引用、`bindingId` 都取自路由结果。
- `verifyExistingWorktree`：按 `worktree.read` / `'read'` 路由；拒绝时 `{ ok: false, definite: false, error }`——缺路由只是「此刻无法确认」，不问另一个连接，也不改判 Failed（D8）。工作树引用的 `bindingId` 取 `route.binding.ref.bindingId`。
- `chain-facts.ts` 不改（K3）。多挂载时它的 `gateCommand` 因 key 级 fail closed 得到缺口；单挂载不变。

### 机制与它保护的东西

| 机制 | 保护的验收 / 不变量 | 判别用例（被哪条变异证明） |
|---|---|---|
| `development` 接受数组、角色按数目推出 | #219 验收 1、3；不变量 2 | I1、E1（M11、M12、M16） |
| Registry 的 Development 角色规则 | 验收 3：读回的角色就是 key 级解析的行为 | C1（M13、M14、M15） |
| key 级解析 fail closed | 验收 2；K3 的「多挂载谱系读是缺口、不读错连接」 | C2、I1（M10） |
| 路由按持久化身份选挂载 | 验收 1；不变量 5、6 | E1（M2、M3）、既有 conflict 用例 |
| 未登记且多挂载时拒绝 | 验收 2（歧义） | E2（M1） |
| 锚点不在挂载里时拒绝 | 验收 2（缺路由） | E3、既有 conflict 用例（M4） |
| 缺能力不改道 | 验收 2；不变量 5 | E4（M9） |
| 一次操作只路由一次（注册门、供应、读回都在路由到的挂载上） | 验收 1 | E1（M6、M7、M8、M17） |
| 读回的路由拒绝不判 Failed | 验收 1（新连接零调用）；不变量 7 | E3（M5） |
| 没有任何 Development 挂载时先报缺能力 | 诊断准确：#132 禁用了唯一的 Development 挂载时，已登记仓库报 `not_supported` 而不是误导性的「绑定 id 变了」 | E3 末段（M18） |

### 被放弃的方案

- **组合时注入「仓库 → 连接」路由表**（γ）：同一事实的第二个权威源，#132 还得再持久化一份，#127 的绑定命令会成为第二个写者。
- **另开 `developmentRoutes` 槽位、与 `development` 互斥**（γ）：同一个域两个有先后关系的入口，语义更乱。
- **`development` 槽位永远是数组**（β 的方案 B）：`tests/` 里约 107 处直接读 `providers.development.*`，全部要改，收益只是类型更窄。
- **Development 一律非默认，加 `BindingRole` 枚举**（β）：改变单挂载工作区的读回（违背 K3「单挂载行为不变」），枚举没有消费者。
- **按「唯一声明者」放行 key 级解析或路由**（β 的 key 级变体、γ 的能力筛选）：能力子集不是归属事实，见「key 级解析」一节。
- **默认挂载兜底未登记的仓库**（γ 引述的 Terraform 默认配置与 `remote.pushDefault`）：这就是换了名字的「取第一个注册者」。
- **逐个 `getRepository` 探测谁认得这个仓库**：隐式发现，给不该收到请求的连接发调用，直接违反验收 1；网络失败会被误读成「不是我的仓库」。
- **请求里带 `bindingId`**：让调用方选连接，违背 Host 权威；仍然缺各连接下的外部 id。
- **本 PR 就实现「一个仓库并列持有多个连接的引用」**（β 的 `alias` 身份与 `repositoryReferences`）：写入形状属于 #127（验收原文）且可能受 #4 影响；只有读没有写会替 #127 定死数据形状。本 PR 只把签名做成前向兼容：带 key、返回挂载下的引用。
- **给 Storage 端口加 `getExternalIdentity(id)` 或给仓库挂载加一列**：要改端口、两个适配器、契约套件与成员锁，多约 60–100 行，并与 PR-C、#223 冲突；登记 TD-036。
- **新增 `route_missing` / `route_ambiguous` 错误码**：见「拒绝语义」。
- **在 `development-provider.ts` 补「外来引用答 `not_found`」的文档义务**（α、β）：契约套件已经钉住这条义务，PR #287 正在改这个文件（K3）。
- **新写 ADR**（γ 的 H5、β 的 ADR-0006 补段）：本 PR 不新增权威源、不改 schema、不改 ADR-0006 的端口语义，见 D10。

### 文件所有权与规模估算

文件集合只在 `Global Constraints` 声明。下面的行数是设计阶段在一份 `origin/main@6417d45` 拷贝上做的原型（不入库）测得的「增 + 删」，实施后以 `node scripts/rule-checks.mjs size origin/main` 为准。

| 文件 | 改什么 | 原型行数 |
|---|---|---|
| `packages/capabilities/src/registry.ts` | `providerRegistry` 的 Development 角色规则；`bindingForCapability` 的一个分支；两段注释 | 18 |
| `packages/core/src/registry.ts` | `CoreProviderTable.development` 类型；`mountsOf` 的槽位展开；`resolveBinding` | 25 |
| `packages/core/src/capabilities.ts` | `gateBinding`；`gateCommand` 改为委托 | 12 |
| `packages/core/src/development-route.ts`（新） | `routeDevelopment` | 55 |
| `packages/core/src/start-work.ts` | `prepareRegistration`、`verifyExistingWorktree`、import | 44 |
| `packages/core/src/git-provisioning.ts` | `provisionGit` 开头、import | 17 |
| 实现小计 | | 约 171（规划上限约 350） |
| `tests/contract/capabilities-keys.test.js` | C1、C2 | 17 |
| `tests/integration/provider-binding-registration.test.js` | I1 | 17 |
| `tests/e2e/start-work.test.js` | 三个辅助函数与 E1–E4 | 92 |
| 代码合计 | | 约 297（规划上限 800、CI 上限 1000） |
| 文档 | 本计划（约 600 行，实施后回填会再增加）、`docs/README.md` 一行、技术债务表 5 行、控制计划两处标注 | 约 610（上限 1300） |

## Global Constraints

- 保持 `AGENTS.md` §1.1 七条不变量与 §2 依赖方向：core 不 import 任何 provider 实现；`domain` 不改。
- 首发前不写兼容层、不写迁移；不改 Storage 端口、两个 Storage 适配器与 SQLite schema；不新增 `ProjectErrorCode`；不实现真实 GitHub Development provider（#72 / #231）。
- 不按名字、URL、能力子集或探测推断仓库归属（不变量 5）；任何歧义都拒绝，不取第一个注册者。
- 单 Development 挂载工作区的行为不变，唯一例外是 D8；既有测试的断言不改，只有 `tests/contract/capabilities-keys.test.js` 中「单个非默认 Development 挂载被拒」一行的文案正则从 `/备用/` 改为 `/角色/`。
- 规模：代码（实现 + 测试，增删都算）≤ 800、实现约 ≤ 350、文档 ≤ 1300 是规划上限（K8）；CI 硬上限代码 1000、文档 1500。超出时先逐个机制问「它保护哪条验收或不变量」，不为压规模删判别性测试。
- 不提交本机绝对路径、凭据与内部系统信息（`docs/development/publication.md`）。
- 实施由一个实现者按 TDD 执行，另一个独立验证者做对抗验证与变异；同一文件只有一个写者。人类决定是否合并；Project `Status`、`blocked-by` / `blocking` 与 ADR 采纳是人类专属。

本 PR 的文件集合（只在此处声明）：

| 区域 | 文件 |
|---|---|
| 能力契约 | `packages/capabilities/src/registry.ts` |
| core | `packages/core/src/registry.ts`、`packages/core/src/capabilities.ts`、`packages/core/src/development-route.ts`（新）、`packages/core/src/start-work.ts`、`packages/core/src/git-provisioning.ts` |
| 测试 | `tests/contract/capabilities-keys.test.js`、`tests/integration/provider-binding-registration.test.js`、`tests/e2e/start-work.test.js` |
| 文档 | 本计划、`docs/README.md`（索引一行）、`docs/exec-plan/tech-debt-tracker.md`（TD-035–TD-039 五行）、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（第 31 行与 Batch 2B 段的标注） |

明确不改（归属见 `Interfaces and Dependencies`）：`packages/core/src/context.ts`、`bootstrap.ts`、`chain-facts.ts`、`delivery.ts`、`relations.ts`、`queries.ts`、`index.ts`；`packages/capabilities/src/development-provider.ts`、`storage.ts`；`packages/providers/**`；`packages/storage/**`；`packages/domain/**`；`tests/contract/suites/development.js`；`docs/product/vertical-path.md`、`docs/architecture/release-gates.md`。

## Plan of Work

三个批次在同一个 PR 里各自提交，每个提交单独通过类型检查与全量测试。逐步操作、红用例的写法与期望输出见 `Concrete Steps`。本计划与索引行作为规划提交先行。

**规划提交与 draft PR（协调者执行，先于 Batch 1）**：本计划与 `docs/README.md` 索引行提交为 `docs(exec-plan): 规划同域多个 Development 绑定按仓库路由`（尾注 `Refs #219`），推送 `feature/development-repository-routing`，开 draft PR 并用关闭关键字关联 #219、`Refs #216`；回读 `closingIssuesReferences` 恰为 #219。实现者从这个提交开始。

### Batch 1 · 注入表、角色与 key 级 fail closed

**最小闭环**：工作区可以注册两个 Development 挂载，Storage 读回的角色与 Registry 一致；key 级解析在多挂载时拒绝而不是取第一条。开始工作在多挂载时还是结构化不可用（fail closed 的中间态，Batch 2 打通）。
**涉及文件**：`packages/capabilities/src/registry.ts`、`packages/core/src/registry.ts`、`tests/contract/capabilities-keys.test.js`、`tests/integration/provider-binding-registration.test.js`。

- [ ] 先写 C1、C2、I1，确认按 `Concrete Steps` 所列原因变红。
- [ ] 改 `providerRegistry`、`bindingForCapability`、`CoreProviderTable`、`mountsOf`。
- [ ] 跑验证，提交 `feat(core): 允许一个工作区挂多个 Development 连接并按角色读回`（正文说明为什么，末行 `Refs #219`）。

**验证**：

    node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js
    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e

期望：第一条 131 / 131（基线 128 加 C2 一条、I1 两条）；`tsc` 无输出；全量 0 fail。
**回滚**：revert 本批提交。注入表回到单槽，没有数据需要恢复。

### Batch 2 · 开始工作按仓库路由

**最小闭环**：两个 Development 替身注入 core，开始工作与读回只进路由给它的那个挂载；歧义、缺路由、缺能力都在任何外部调用之前结构化拒绝；换连接不再把 Ready 判成 Failed。
**涉及文件**：`packages/core/src/development-route.ts`（新）、`packages/core/src/start-work.ts`、`packages/core/src/git-provisioning.ts`、`packages/core/src/capabilities.ts`、`packages/core/src/registry.ts`、`tests/e2e/start-work.test.js`。

- [ ] 先写 E1–E4 与三个辅助函数，确认 E1–E3 按 `Concrete Steps` 所列原因变红（E4 在 Batch 1 的中间态碰巧为绿，判别力由 M9 证明）。
- [ ] 加 `resolveBinding`、`gateBinding`、`routeDevelopment`，改三个调用点。
- [ ] 跑验证，提交 `feat(core): 按仓库把开始工作路由到它所属的 Development 连接`（末行 `Refs #219`）。

**验证**：

    node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js tests/e2e/delivery-lineage.test.js
    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e
    node --test --test-timeout=120000 tests/mvp0
    pnpm run boundaries

期望：第一条 142 / 142（原型实测）；`tsc` 无输出；全量 0 fail，用例数等于起点加 7；MVP-0 7 / 7；包边界 8 / 8。
**回滚**：先 revert 本批，再视需要 revert Batch 1。没有 schema 变更；revert 后用单个 Development 重新组合，会把它写回默认。

### Batch 3 · 对抗验证、变异与文档收口

**最小闭环**：独立验证者在最终树上逐条跑变异表并复核验收；技术债务、控制计划与本计划回填到与代码一致。
**涉及文件**：`docs/exec-plan/tech-debt-tracker.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`、本计划、`docs/README.md`。

- [ ] 独立验证者跑 `Artifacts and Notes` 的变异表 M1–M18（每条先证明变异生效），记录哪些用例变红；存活的变异要么补用例，要么写明为何等价。
- [ ] 把 `Artifacts and Notes` 的 TD-035–TD-039 五行逐字追加到技术债务表（不要用 `update_tech_debt_tracker.py`，它会抹掉既有条目）。
- [ ] 控制计划第 31 行与 Batch 2B 段就地标注（文字见 `Concrete Steps`）。
- [ ] 回填本计划的 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective`、`Bottom Change Note`，更新 `docs/README.md` 的状态列。
- [ ] 跑发布前检查，提交 `docs(exec-plan): 回填 Development 路由的验证证据与技术债务`（末行 `Refs #219`）。

**验证**：

    node scripts/rule-checks.mjs size origin/main
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/workflow-check.mjs
    git diff --check origin/main...HEAD
    pnpm verify

期望：`size` 报代码 ≤ 800（预计约 297）、文档 ≤ 1300；其余命令 exit 0。
**回滚**：文档提交可单独 revert；代码批次不受影响。

## Concrete Steps

以下每一步都在检出 `feature/development-repository-routing` 的工作树根目录执行。开工前先跑一次基线：

    git rev-parse --short HEAD
    node --test tests/contract/capabilities-keys.test.js tests/e2e/start-work.test.js tests/integration/provider-binding-registration.test.js tests/integration/start-work-sqlite-registration.test.js

期望：HEAD 是本计划的规划提交；128 / 128。

### Batch 1 的红用例

1. `tests/contract/capabilities-keys.test.js`，改既有用例「providerRegistry：…」：
   - 标题改为 `providerRegistry：同 id 跨域、主 + 备用与多个对等 Development 合法；跨工作区、重复挂载、多个默认、多个备用、非 Execution 备用、Development 角色不一致与串域 port 被拒绝而不是取第一条`（C1）。
   - 在第一条合法断言之后加一条合法断言：`providerRegistry([planning, mount('development', 'dev-a', false), mount('development', 'dev-b', false), mount('development', 'dev-c', false)])` 的 `bindings.length` 为 4。
   - 拒绝表里把 `[[mount('development', 'conn-1', false)], /备用/]` 改成 `/角色/`，并加三行：`[mount('development', 'dev-a', true), mount('development', 'dev-b', false)]` → `/角色/`；`[mount('development', 'dev-a', true), mount('development', 'dev-b', true)]` → `/默认/`；`[mount('delivery', 'conn-1', false)]` → `/备用/`。
   - 起点上为什么红：新加的合法断言抛 `TypeError: 挂载 dev-a@development 不是默认挂载：只有 Execution 允许备用`。
2. 同文件末尾新增 C2：`bindingForCapability：同域多个对等挂载时 key 级解析拒绝而不是取第一条，也不按「唯一声明者」改道；单个挂载照旧选中`。用裸对象 `{ bindings: [...] }`（不经 `providerRegistry`，红的原因才落在解析上）：`dev-a` 非默认、只声明 `development.repository.read`；`dev-b` 非默认、声明 `repository.read` 与 `change_request.read`。断言这两个 key 的解析结果都是 `undefined`；再断言只有一个默认 `dev-a` 时，`repository.read` 解析到 `dev-a`。起点上为什么红：`repository.read` 返回先注册的 `dev-a`。
3. `tests/integration/provider-binding-registration.test.js`，在 `SCENARIOS` 数组开头插入 I1，名字为 `Development 多挂载按角色读回：唯一挂载是默认；两个挂载都非默认且与 Registry 一致，从一个重组为两个时原默认被改写；同一连接在另一个工作区仍是默认；空数组即没有挂载；同一对象注入两次 0 事务被拒；谱系读在多挂载时是缺口而不取第一个`。用文件里已有的 `fakes`、`compose`、`rows`、`row`、`probe`、`QUERY` 与 `createFakeDevelopmentProvider`、`readChainFacts`、`CapabilityKey`，依次断言：
   - `compose(storage, { planning, development })` 后 `rows(storage)` 为 `[row(SHARED, 'development'), row(SHARED, 'planning')]`；
   - `const context = await compose(storage, { planning, development: [development, other] })`（`other` 的 `bindingId` 为 `conn-dev-b`）后，`rows(storage)` 为 `[row('conn-dev-b', 'development', KEY, false), row(SHARED, 'development', KEY, false), row(SHARED, 'planning')]`，并且 `context.registry` 里两个 Development 挂载的 `[bindingId, isDefault]` 为 `[[SHARED, false], ['conn-dev-b', false]]`；
   - 再以 `{ workspace: { id: 'ws-2' } }` 只挂 `development`、以 `{ workspace: { id: 'ws-3' } }` 挂 `development: []`：`rows(storage, 'ws-2')` 为 `[row(SHARED, 'development'), row(SHARED, 'planning')]`，`rows(storage, 'ws-3')` 为 `[row(SHARED, 'planning')]`，`rows(storage)`（ws-1）不变；
   - `probe(storage)` 包装后 `compose(probed, { planning, development: [development, development] })` 以 `TypeError` `/重复/` 拒绝，`seen.transactions === 0`；
   - `(await readChainFacts(context, QUERY)).gaps` 含 `key === CapabilityKey.DevelopmentRepositoryRead` 的一条。
   - 起点上为什么红：`mountsOf` 拒绝数组，`TypeError: 槽位 development 的 port 缺少必需方法`。
4. 运行：

       node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js

   期望：恰好 4 条失败（C1、C2、I1 × 2），失败原因与上面三条一致。

### Batch 1 的实现

5. `packages/capabilities/src/registry.ts`：
   - `providerRegistry` 第 57 行的条件加上 `&& ref.domain !== 'development'`，文案改为「只有 Execution 允许备用、Development 允许按仓库路由的对等挂载」；
   - 域循环改为先算 `defaults`、多于 1 即「多个默认挂载」；`domain === 'development'` 时若 `mounts.length > 0 && (defaults === 1) !== (mounts.length === 1)` 抛「能力域 development 的挂载角色不一致（N 个挂载、M 个默认）：唯一挂载才是默认，多个挂载一律非默认、按仓库路由」；其他域保留「多个备用」检查；
   - `bindingForCapability` 的最后一个分支改为 `primary ?? (mounts.length === 1 ? spare : undefined)`；
   - 两段函数注释按「Design / Spec」改写。
6. `packages/core/src/registry.ts`：`CoreProviderTable.development` 改为联合类型（含注释）。`mountsOf` 的槽位循环改为先 `MOUNT_SLOTS.flatMap` 展开成 `[slot, domain, isDefault, port]`（`development` 且是数组时逐个展开、槽位名 `development[i]`；`isDefault` 对 `development` 取 `ports.length === 1`），循环体逐字不动，只把 `port` 改为从展开结果取（不要整体缩进循环体，否则行数翻倍）。`MOUNT_SLOTS` 的注释补一句 Development 的角色规则。
7. 运行 Batch 1 的「验证」三条命令，期望同 `Plan of Work`。

### Batch 2 的红用例

8. `tests/e2e/start-work.test.js`：import 里加 `createFakeDevelopmentProvider`；文件末尾加三个辅助函数：

       /** 记录组合期观察（`describeCapabilities`）之外的每次调用：方法名与它收到的引用（仓库或工作树）的 bindingId / externalId。 */
       function recorded(port) {
         const calls = []
         const proxy = new Proxy(port, { get(target, key) {
           const value = Reflect.get(target, key, target)
           if (typeof value !== 'function') return value
           if (key === 'describeCapabilities') return value.bind(target)
           return (...args) => {
             const ref = args[0]?.repository ?? args[0]?.worktree ?? args[0]
             calls.push(`${String(key)} ${ref?.bindingId}/${ref?.externalId}`)
             return value.apply(target, args)
           }
         } })
         return { proxy, calls }
       }
       /** #127 的绑定仓库命令之前，多挂载工作区里「仓库属于哪个连接」只能经 Storage 端口种入（旁证，TD-038）。 */
       async function bindRepository(storage, bindingId, repositoryId) {
         const entityId = `entity-${bindingId}-${repositoryId}`; const id = `identity-${bindingId}-${repositoryId}`
         await storage.putEntity({ id: entityId, kind: 'repository' })
         await storage.putExternalIdentity({ id, entityId, bindingId, externalKind: 'repository', externalId: repositoryId, role: 'primary' })
         await storage.putRepository({ id: repositoryId, workspaceId: WORKSPACE.id, externalIdentityId: id })
       }
       /** 两个可区分的 Development 替身：两边的种子都有 repo-alpha（误路由也能「成功」，只有调用记录能区分），dev-b 另有 repo-beta 与它的 main 分支。 */
       async function twoDevelopments({ a = {}, b = {} } = {}) {
         const providers = createFakeProviders()
         const devA = createFakeDevelopmentProvider({ bindingId: 'dev-a', ...a })
         const devB = createFakeDevelopmentProvider({ bindingId: 'dev-b', ...b })
         const beta = refOf('dev-b', 'repository', 'repo-beta')
         devB.state.repositories.push({ ref: beta, name: 'beta', defaultBranch: 'main', sourceUpdatedAt: undefined })
         devB.state.branches.push({ repository: beta, ref: refOf('dev-b', 'branch', 'beta-main'), name: 'main', headCommit: 'sha-1' })
         const A = recorded(devA); const B = recorded(devB)
         const core = await compose({ ...providers, development: [A.proxy, B.proxy] })
         return { providers, core, devA, devB, A, B, workItemId: await workItemIdOf(core) }
       }
       const contextsOf = (providers) => exportFakeStorageState(providers.storage).contexts.length

9. 再加四条用例（名字逐字如下），断言要点：
   - **E1** `两个 Development 挂载：每个仓库的开始工作只进路由给它的挂载，换新键的工作树读回也一样（#219 验收 1）`：`bindRepository` 把 `repo-alpha` 登记到 `dev-a`、`repo-beta` 登记到 `dev-b`；同一工作项分别对两个仓库开始工作，`writeState` 都是 `saved`；`[devA 分支数, devA 工作树数, devB 分支数, devB 工作树数]` 为 `[2, 1, 3, 1]`；`A.calls` 非空且每条都含 ` dev-a/`，`B.calls` 同理含 ` dev-b/`；除 `getWorktree` 外的调用分别以 `repo-alpha` / `repo-beta` 结尾。然后对两个仓库各换一个新键再开始工作，都是 `saved` + `ready`，并且这两次之后 `A.calls`、`B.calls` 各只新增一条 `getWorktree`。
   - **E2** `两个 Development 挂载、仓库没有登记：结构化 conflict，两个挂载零调用、不落上下文（#219 验收 2，歧义）`：不登记任何仓库，对 `repo-alpha` 开始工作；`[writeState, executionContextId, error.code]` 为 `['failed', undefined, 'conflict']`，文案含 `dev-a、dev-b` 与「不取第一个注册者」；`A.calls`、`B.calls` 都是 `[]`；替身 Storage 的上下文数为 0。
   - **E3** `重组后换了 Development 连接：已登记仓库上的新工作项写前 conflict，已 Ready 的上下文保持 Ready 报 Unknown，新连接零调用（#219 验收 1、2，缺路由）`：单挂载组合、对 `repo-alpha` 开始工作得 `saved`；用同一份 Storage、只挂一个 `bindingId` 为 `dev-moved` 的 `recorded` 替身重新组合；另一个工作项对 `repo-alpha` 开始工作得 `failed` + `conflict`，文案匹配 `/绑定 id 变了/`；原工作项换新键开始工作得 `ready` + `unknown`，Query 读到的状态仍是 `ready`；新连接的 `calls` 为 `[]`。最后用同一份 Storage、`development: undefined` 再组合一次，另一个工作项对 `repo-alpha` 开始工作得 `not_supported`（没有任何 Development 挂载时报缺能力，不报「绑定 id 变了」）。
   - **E4** `路由到的挂载缺工作树创建能力：not_supported，不改道到另一个声明了它的挂载（#219 验收 2）`：`twoDevelopments({ a: { capabilities: { worktreeCreate: false } } })`，`repo-alpha` 登记到 `dev-a`；开始工作得 `failed` + `not_supported`；两边 `calls` 都是 `[]`，上下文数为 0。
10. 运行 `node --test tests/e2e/start-work.test.js`。期望 3 条失败，原因：E1 为 `['failed', 'failed']`（多挂载下 key 级门 fail closed，得 `not_supported`）；E2 为 `not_supported`，不是 `conflict`；E3 为 `['failed', 'failed', 'failed']`（读回问了新连接、被判 Failed）。E4 通过。在起点上运行，E1、E2、E4 都因组合时 `TypeError` 而红，E3 的红因与上面相同。

### Batch 2 的实现

11. `packages/core/src/registry.ts`：把 `resolveCapability` 的函数体移到新的 `resolveBinding(binding, key)`，`resolveCapability` 改为一行委托。
12. `packages/core/src/capabilities.ts`：import 加 `resolveBinding`；把 `gateCommand` 的函数体抽成私有的 `gateOn(resolution, key, mode)`，`gateCommand` 与新增的 `gateBinding(binding, key, mode)` 都委托给它。
13. 新建 `packages/core/src/development-route.ts`：文件头注释写明路由来源、只读 Storage、结果带引用、一次操作只路由一次、#127 只改内部；函数体照「Design / Spec」的代码。
14. `packages/core/src/start-work.ts`：import 里 `gateCommand` 换成 `gateBinding`，删掉 `resolveCapability` 的 import，加 `import { routeDevelopment } from './development-route.ts'`；按「调用点」一节改 `prepareRegistration`（同时更新 `REGISTRATION_GATES` 与函数头注释）与 `verifyExistingWorktree`（加一行注释说明拒绝为什么不判 Failed）。
15. `packages/core/src/git-provisioning.ts`：import 删掉 `resolveWriteTarget`、加 `routeDevelopment`；按「调用点」一节改 `provisionGit` 开头，`provider`、`repository`、`bindingId` 都取自路由结果，其余不动。
16. 运行 Batch 2 的「验证」五条命令，期望同 `Plan of Work`。

### Batch 3 的文档文字

17. 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`：
    - 第 31 行「每域一个主实例不变」之后、右括号之前，就地追加：`；Superseded by docs/exec-plan/active/2026-10-08-development-repository-routing.md（2026-10-08，#219）：Development 可以有多个挂载，唯一挂载是默认、多个时全部非默认并按仓库路由，其余域仍每域一个主实例`。
    - Batch 2B 段末追加：`（2026-10-08：设计与实施见 docs/exec-plan/active/2026-10-08-development-repository-routing.md；路由放在 core，development-provider.ts 不改，理由见该计划 Decision Log D9；验收第 4 行的「Local Git + GitHub 绑定装配」在本 PR 只有两个可区分替身的证据，真实装配随 #231 / #132）`。
18. 合并之后才把本计划移到 `docs/exec-plan/completed/`，并更新索引；合并由人类决定。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 两个 Development provider 各自只收到路由给它的请求（#219 验收 1） | E1：调用记录只含本连接的引用，读回各问自己的挂载一次；E3：重组后新连接零调用 |
| 2 | 缺路由或歧义返回结构化拒绝，不取第一个注册者（#219 验收 2） | E2（歧义 → `conflict`，两边零调用、零上下文）；E3 与 `start-work-sqlite-registration.test.js` 两条既有 conflict 用例（缺路由）；E4（缺能力不改道）；C2（key 级不取第一条） |
| 3 | 注册的挂载连同角色读回；`node --test tests/contract/capabilities-keys.test.js` 通过（#219 验收 3） | C1、C2 通过；I1 在替身与 SQLite 上读回的 `isDefault` 与 Registry 一致，重组改写旧默认，跨工作区角色互不影响 |
| 4 | 单挂载工作区的现有行为不变（D8 除外） | `tests/e2e/start-work.test.js`、`tests/integration/start-work-sqlite-registration.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/mvp0` 的既有用例不改断言、全部通过 |
| 5 | 控制计划验收第 4 行「两个 Development 实现可共存且路由明确」 | 部分：路由明确、歧义拒绝、单连接跨工作区角色不混由替身证据覆盖（E1、E2、I1）；「Local Git + GitHub 绑定装配」要等 #231 的真实 provider 与 #132 的组合根，如实记为部分 |
| 6 | 守卫有判别力 | `Artifacts and Notes` 的变异表 M1–M18 在最终树上逐条变红 |
| 7 | 依赖方向与类型 | `pnpm run boundaries` 8 / 8；`node_modules/.bin/tsc --noEmit` 无输出 |
| 8 | 规模 | `node scripts/rule-checks.mjs size origin/main`：代码 ≤ 800、文档 ≤ 1300 |
| 9 | 发布面 | `node scripts/rule-checks.mjs disclosure origin/main` exit 0，并人工过 `docs/development/publication.md` 的五个类目 |

## Progress

- [x] (2026-10-08 00:05 CST) 读完 issue #219、`AGENTS.md`、`PLANS.md`、三份设计稿、跨 PR 契约、控制计划 Batch 2B、ADR-0006、#197 计划，以及 #127 / #132 / #235 / #233 / #4 的正文。
- [x] (2026-10-08 00:15 CST) 在起点 `origin/main@6417d45` 只读复现设计稿的关键事实：注入表、Registry 三种组合、key 级取第一条、Storage 降级与改写、重组后 Ready 被判 Failed；四个目标测试文件基线 128 / 128。
- [x] (2026-10-08 00:25 CST) 在一份不入库的起点拷贝上做原型：Batch 1 后 131 / 131；Batch 2 后五个相关文件 142 / 142，contract / integration / e2e 全量除一条依赖 `.git` 的 CLI 用例（拷贝里没有 `.git`，与本改动无关）外全部通过，MVP-0 7 / 7，包边界 8 / 8，`tsc` 无输出；变异 18 条全部变红（M17 第一次存活，补强 E1 后变红；M18 是复核「每个机制保护什么」时补的，对应 E3 末段的断言）。
- [x] (2026-10-08 00:40 CST) 裁决三份设计的分歧，写成本计划；在 `docs/README.md` 的 Active 索引加一行。
- [ ] Batch 1：注入表、角色与 key 级 fail closed。
- [ ] Batch 2：开始工作按仓库路由。
- [ ] Batch 3：对抗验证、变异与文档收口。
- [ ] 整理成交付物级提交（规划 / 代码 / 回填），先建 backup ref 再以精确的 force-with-lease 推送，回读 head、base、checks 与评审线程（draft PR 已在规划提交后开出）。

## Surprises & Discoveries

- **重组后换连接会把 Ready 判成 Failed，并向新连接发请求**（γ 首先报告，本计划在起点复现，命令见 `Artifacts and Notes` 的 R1）：`verifyExistingWorktree` 按 key 解析，换连接后问的是新连接，新连接当然答 `not_found`，于是被当成「工作树确定不存在」。这既违反验收 1（新连接收到了不属于它的请求），也违反不变量 7（把「问错了对象」当成权威事实写进记录）。路由按持久化事实选挂载后，它自然变成「缺路由 → 无法确认」。
- **迭代规划 D6 的写入范围不对**：D6 给 #219 列的是 `packages/core/src/{registry,context}.ts` 与 `packages/capabilities/src/{registry,development-provider}.ts`。实际不需要改 `context.ts`（注入表类型定义在 `registry.ts`，`createContext` 原样调 `collectBindings`），也不需要改 `development-provider.ts`（外来引用义务已由契约套件钉住）；需要改的是 `start-work.ts`、`git-provisioning.ts` 与新文件 `development-route.ts`。D6 据此写的「#220 + #199 排在 #219 之后」作废，由 PR-A 的计划记录（跨 PR 契约的拓扑说明）。
- **Storage 的降级语义正是「读回角色」这条验收的风险点**：同域写第二个默认会静默降级第一个，内存 Registry 与库里的行于是不一致。所以多挂载时必须全部写成非默认；实测把旧默认改写成非默认能被如实读回，重组从 1 个到 2 个不需要额外清理。
- **替身种子让误路由「成功」**：两个替身都种了 `repo-alpha`，所以只看 `writeState` 抓不到误路由。路由用例必须逐次记录调用和引用。原型阶段 M17（读回用工作区第一个仓库路由）第一次存活，原因是 E1 只对第一个登记的仓库做了读回；改成两个仓库都读回后变红。
- **规模远小于规划时的 `L`**：原型代码约 297 行（实现约 171），按迭代规划的口径属于 `M`。

## Decision Log

| 日期 / 作者 | 决策与理由 |
|---|---|
| 2026-10-08 / Claude（定稿评审） | **D1 路由来源是持久化事实**：`RepositoryRecord` → 外部身份 → `bindingId`；否决 γ 的组合时路由表。理由：避免同一事实的第二个权威源（`AGENTS.md` §2）；重启后无需额外状态；R1 由构造关闭。 |
| 2026-10-08 / Claude | **D2 注入表用联合类型**：`development?: DevelopmentProvider \| readonly DevelopmentProvider[]`，单个等于单元素数组，空数组等于没有挂载；否决「永远数组」与「另开槽位」。理由：单个不是保留旧语义的兼容路径，两种写法在 `mountsOf` 一处归一、语义相同；空数组不报错，是为了 #132 过滤掉全部不可用挂载时不让整个组合失败（α 原稿是拒绝空数组）。可由人类在 PR 评审时推翻。 |
| 2026-10-08 / Claude | **D3 默认等于 key 级解析的目标**：Development 唯一挂载是默认，多个时全部非默认，Registry 校验「有默认 ⟺ 挂载数为 1」；否决 β 的「一律 routed」与 `BindingRole` 枚举。理由：K3 要求单挂载行为不变（读回仍是默认）；Storage 的降级语义要求多挂载时不写默认；枚举没有消费者。代价：挂载的角色随同域挂载数变化，重组时由 upsert 改写（I1 钉住）。可由人类在 PR 评审时推翻。 |
| 2026-10-08 / Claude | **D4 key 级解析 fail closed**：非 Execution 域有两个及以上启用挂载时，对该域所有 key 返回 undefined，不按「唯一声明者」放行。理由：能力子集不是归属事实（不变量 5）。 |
| 2026-10-08 / Claude | **D5 路由键是仓库**：capability key 只用于在路由到的挂载上过门、作锚点和写文案；结果携带该挂载下的仓库引用；一次操作只路由一次，其余 key 用 `gateBinding`。「一个仓库并列持有多个连接的引用」不在本 PR，由 #127 写入并只改 `routeDevelopment` 的内部。理由：#127 的验收拥有这条事实及其写入形状，栈底只写自己的事实；签名带 key、返回引用，所以 #235 / #233 的调用点不必返工。 |
| 2026-10-08 / Claude | **D6 拒绝语义复用既有错误码**：歧义与缺路由为 `conflict`，没有挂载、缺能力为 `not_supported`，只读的写为 `permission_denied`；不新增 `ProjectErrorCode`。理由见「拒绝语义」。可由人类在 PR 评审时推翻（替代方案：新码加「绑定仓库」恢复动作，随 #142 一起做）。 |
| 2026-10-08 / Claude | **D7 单挂载工作区的未登记仓库仍隐式路由到唯一挂载**，并由开始工作懒登记（现状）。理由：唯一候选不是「取第一个」；改成必须先登记会让开始工作等 #127。懒登记与 #127 的绑定命令将成为两个写者，登记 TD-039。可由人类在 PR 评审时推翻。 |
| 2026-10-08 / Claude | **D8 读回的路由拒绝判为「无法确认」**（`definite: false`：保留 Ready、报 Unknown），不再把「问错了连接」得到的 `not_found` 当作工作树确定不存在。这是单挂载工作区里唯一有意的行为变化：Development 绑定 id 变了之后，已 Ready 的上下文从 Failed 变为 Unknown；终态接管时 `provisionGit` 也改为 `conflict`，不再向新连接建分支。理由：验收 1、不变量 7。与 K3「单挂载现有行为不变」的字面冲突已在回复协调者时提出。 |
| 2026-10-08 / Claude | **D9 不改 `packages/capabilities/src/development-provider.ts`**。issue Scope 点名它，指的是「路由面」；路由放在 core。外来引用答 `not_found` 的义务已由 `tests/contract/suites/development.js` 钉住，PR #287 正在改这个文件（K3）。 |
| 2026-10-08 / Claude | **D10 不写新 ADR**，K6 预留给本 PR 的 ADR-0013 不使用。理由：不新增权威源，不改 schema，ADR-0006 的端口语义（每域至多一个默认、写新默认降级旧默认）原样成立。若人类要求，可补一份 `Proposed` 的 ADR-0013；采纳由人类决定。 |
| 2026-10-08 / Claude | **D11 `routeDevelopment` 放新文件，不从 `packages/core/src/index.ts` 导出**。理由：消费者都在 core 内部；单独文件让 #127 只改一处；不与 PR-C 的 `index.ts` 改动冲突。 |
| 2026-10-08 / Claude | **D12 证据层级**：多挂载用例里「仓库属于哪个连接」经 Storage 端口种入（旁证），路由本身经 `composeCore` + `commands.startWork` 这个生产入口验证；#127 落地后改走命令（TD-038）。 |
| 2026-10-08 / Claude | **D13 不新增测试文件**：契约进 `capabilities-keys`，角色读回进 `provider-binding-registration` 的 `SCENARIOS`（两种 Storage 都跑），路由进 issue 点名的 `tests/e2e/start-work.test.js`。 |
| 2026-10-08 / Claude | **D14 不改 `queries.ts` 的工作区元数据**（K3，PR-D 在改）：多挂载工作区的元数据会把 `development.*` 报成 `unavailable`，UI 的开始工作入口被禁用；#127 之前没有生产路径组装出两个 Development 挂载，接受为过渡状态，登记 TD-035。可由人类在 PR 评审时推翻。 |

## Idempotence and Recovery

- 组合幂等：同一组 provider 重复组合读回同一组挂载；从一个 Development 挂载重组为两个时，旧默认被 upsert 改写为非默认（I1）。没有 schema 变更，没有迁移。
- 路由是纯读：不写 Storage、不调 provider，重复调用的结果只取决于持久化事实。新请求在一次开始工作里路由两次（写前准备与供应），两次之间只有本命令自己的登记会改变事实，而登记写下的正是第一次路由选中的连接，所以第二次结果相同；已有 Ready 记录的请求只在读回时路由一次。
- 每个批次都是一个提交，可以单独 revert。revert 之后用单个 Development 重新组合，会把它写回默认（写默认会降级同域旧默认，实测替身与 SQLite 都如此）。多挂载组合留在本地开发库里的非默认行不影响 revert 后的组合（Registry 只来自本次组合），但 `listProviderBindings` 会多读到它们（TD-038）；需要干净状态时删除本地开发库重建（首发前没有需要保护的数据）。
- 变异实验：每条变异先确认目标文本恰好出现一次并已改写，再跑用例，结束后用内存里的原文写回并逐字比对；全部跑完 `git status --short` 必须为空。
- 发布：开 PR 前整理提交，已推送的分支先建 backup ref，再用精确的 `--force-with-lease=<branch>:<读到的旧 head>` 推送；lease 失败就停下重新回读，不改用裸 `--force`（`AGENTS.md` §6）。

## Interfaces and Dependencies

### 工具与账号

Node ≥ 22（本机 26）、pnpm 10.28.2（`pnpm install --frozen-lockfile`）；验证用 `node_modules/.bin/tsc` 与 `node --test`。不需要凭据、不联网。提交、PR 与回复用开发账号；评审用评审账号。

### 本 PR 提供的接口

- `CoreProviderTable.development?: DevelopmentProvider | readonly DevelopmentProvider[]`（`packages/core/src/registry.ts`）。
- `resolveBinding(binding, key)`（`packages/core/src/registry.ts`）、`gateBinding(binding, key, mode)`（`packages/core/src/capabilities.ts`），经 `index.ts` 既有的 `export *` 自动导出。
- `routeDevelopment(source, repositoryId, key, mode)` 与类型 `DevelopmentRouteSource`、`DevelopmentRoute`（`packages/core/src/development-route.ts`，只在 core 内部使用）。
- 消费者必须遵守：一次操作调一次 `routeDevelopment`（按锚点 key）；同一操作的其余 key 用 `gateBinding(route.binding, key, mode)`；调 provider 只用 `route.repository`；写尝试与实体 id 里的连接取 `route.binding.ref.bindingId`；拒绝原样折成结构化错误或缺口（`route.error.message`）；不得用 Development key 调 `gateCommand`、`resolveCapability`、`resolveWriteTarget`、`bindingForCapability`，也不得用请求串自己拼仓库引用。

### 跨 PR 契约（协调者 2026-10-08 裁定，与本 PR 相关的条目）

- **K1 修订号（owner PR-A）**：业务修订号只在工作区快照内容变化时推进，一个事务至多一次；刷新、尝试、游标与新鲜度不推进；查询不写事实。本 PR 的路由只读 Storage，不写任何事实，不改变开始工作的修订号行为。
- **K3 Development 路由（owner 本 PR）**：本 PR 提供 core 内按仓库路由的函数，并让 Development key 级解析在多挂载时 fail closed、不取第一个注册者；单挂载工作区的现有行为不变。本 PR 不改 `chain-facts.ts`、`delivery.ts`、`relations.ts`、`queries.ts`、`context.ts`、`bootstrap.ts`，也不改 `packages/capabilities/src/development-provider.ts`、`packages/providers/fake/src/development.ts`、`tests/contract/suites/development.js`。PR-C 把 `chain-facts.ts` 里的 Development 绑定解析收拢到一个缝函数（建议名 `developmentReadBinding(context, key, repositoryId)`），主干仍是 key 级解析；PR-B 与 PR-C 都合并后，后合并的一方把缝函数的函数体换成 `routeDevelopment`（预计 ≤ 20 行，允许越过上述文件边界，并在 PR 正文写明）；在此之前，多挂载工作区里的谱系读取退化为缺口。本 PR 的兑现方式：函数名就是 `routeDevelopment`，签名与消费规则见上一小节；I1 的「多挂载谱系读是缺口」断言在接上缝函数之后仍然成立（那个场景没有登记仓库，路由本身就是歧义），接缝的一方另补一条正例「已登记仓库的谱系读只进路由到的挂载」。本 PR 对 K3 有两点提议，已写进给协调者的回复：单挂载行为有 D8 一处有意变化；缝函数最好返回 `{ binding, repository }` 而不只返回 binding，否则 #127 引入并列引用后还要再改缝的签名。
- **K6 编号预分配**：本 PR 的技术债务用 TD-035–TD-039（五个全部用到，全文见 `Artifacts and Notes`）；ADR-0013 预留但不使用（D10）；本 PR 没有 SQLite 迁移；文件名日期用 2026-10-08。合并时再回读一次 `docs/exec-plan/tech-debt-tracker.md`，确认编号没有被别的 PR 占用。
- **K7 共享文件**：本 PR 只改自己的行——`docs/README.md` Active 表一行；`docs/exec-plan/tech-debt-tracker.md` 五行；控制计划第 31 行与 Batch 2B 段的就地标注。不改 `docs/product/vertical-path.md` §2.1 与 `docs/architecture/release-gates.md`。合并冲突由后合并者 rebase 解决。
- **K8 规模口径**：代码（实现 + 测试，增删都算，`node scripts/rule-checks.mjs size origin/main` 的 code 桶）≤ 800、实现约 ≤ 350；文档 ≤ 1300。

### 与其他 PR / issue 的交接

| 对象 | 交接内容 |
|---|---|
| PR-A（#199、#220，`fix/sync-revision-freshness`） | 本 PR 不改 `context.ts`、`bootstrap.ts`，两者没有先后依赖。唯一约定：PR-A 若在 `composeCore` 里改 catch，只包 `bootstrapWorkspace`，不得吞掉 `createContext` 的注册拒绝（多挂载的角色校验在那里抛 `TypeError`）。 |
| PR-C（#221，`feature/delivery-fact-writer`） | 见 K3。PR-C 新写的代码不得用 Development key 做 key 级解析；交付事实缓存键里的连接取路由命中挂载的 `bindingId`。 |
| PR-D（#222，栈在 PR-C 上） | 不重叠。`queries.ts` 的元数据汇总保持 key 级（TD-035）；若 PR-D 改名或挪走 `readChainFacts`，由 PR-D 改 I1 场景的调用入口，断言不动。 |
| PR #287、#288 | 不重叠：本 PR 不改 `development-provider.ts`、替身的 Development 实现与契约套件；新用例只用替身已有的 `bindingId`、`capabilities` 选项与 `state.repositories` / `state.branches` 字段，不碰变更请求。 |
| #127 绑定命令 | 拥有：绑定仓库命令（写仓库挂载、锚点身份与同一仓库在另一连接下的并列引用）；只改 `routeDevelopment` 的内部——在已挂载连接的引用之间按 key 选，并显式处理多个候选；按绑定给出有效访问（收 TD-035）；按 id 取身份或给挂载记录引用（收 TD-036）；解绑写 `enabled = false` 并把本计划的种入改走命令（收 TD-038）；决定懒登记去留（收 TD-039）。 |
| #132 宿主组合根 | 把所有启用的持久化 Development 挂载以数组注入；`isDefault` 由挂载数推出，不从库里读；连接 id 必须跨重启稳定（#228、TD-015），否则已登记的仓库都会得到缺路由的 `conflict` 与读回 Unknown（fail closed，不会读错连接）；未知实现键只禁用那个挂载，登记在它上面的仓库同样得到缺路由。 |
| #235 创建变更请求 | 按 `routeDevelopment(ctx, 上下文的 repositoryId, development.change_request.create, 'write')` 路由；待处理尝试记 `route.binding.ref.bindingId`；provider 调用只用 `route.repository`。#127 之前仓库只登记在一个连接上：登记在 Local Git 上的仓库会得到 `not_supported`（Local Git 不声明创建变更请求），这是正确的 fail closed；#127 加上 GitHub 引用后只改路由内部，#235 的调用点不变。 |
| #233 谱系同步 | 每一跳按路由读：分支头与变更请求各自选锚点 key（#127 之后 `repository.read` 两边都声明，必须锚定，不能各 key 各自路由）；取代 `chain-facts.ts` 第 6 行「同一外部 id 视为同一对象」的假设（TD-037）。 |
| #231 GitHub Development provider | 必须满足契约套件的外来引用义务（答 `not_found`）；它给仓库的外部 id 就是 #127 要登记的并列引用。 |
| #142 开始工作对话框 | 只列已绑定的仓库，按选中仓库的路由结果判定可用性（TD-035）。 |
| #4 Gate E1 | 路由从不把两个连接下的身份视为同一对象；「Local Git 仓库与 GitHub 仓库是同一个仓库」只由 #127 的命令显式写入。无论 #4 怎么裁决，影响都只落在 `routeDevelopment` 的内部。 |

### 人类专属事项

- 本计划不提议任何 ADR 采纳，也不写 Project `Status`、`blocked-by` / `blocking`。#219 开 draft PR 时置 `In Progress` 已由迭代规划计划的 H3 批准（见 `docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` 的 Decision Log），由那份计划的执行者负责，不在本计划的写入集合里。
- 是否合并由人类决定；合并只用 rebase merge。

## Artifacts and Notes

### R1：重组后 Ready 被判 Failed 的复现（在检出 `origin/main@6417d45` 的工作树根目录运行）

    node --input-type=module -e "
    import { composeCore, contextIdFor } from '@harness-projects/core'
    import { createFakeProviders, createFakeDevelopmentProvider } from '@harness-projects/provider-fake'
    import { newWorkspaceId } from '@harness-projects/domain'
    const p = createFakeProviders(); const ws = { id: newWorkspaceId(), name: 'w' }
    const core = await composeCore({ workspace: ws, providers: p })
    const item = (await core.queries.listPlanningItems()).find((v) => v.kind === 'work_item' && v.content.contentKind === 'work_item').entityId
    const req = { workItemId: item, repositoryId: 'repo-alpha', actor: { kind: 'agent' } }
    console.log((await core.commands.startWork({ ...req, idempotencyKey: 'k1' })).writeState)
    const core2 = await composeCore({ workspace: ws, providers: { ...p, development: createFakeDevelopmentProvider({ bindingId: 'dev-other' }) }, storage: p.storage })
    const again = await core2.commands.startWork({ ...req, idempotencyKey: 'k2' })
    console.log(again.status, again.writeState, again.error?.code, (await p.storage.getExecutionContext(contextIdFor(ws.id, item, 'repo-alpha'))).status)
    "

起点上的输出（2026-10-08 00:12 CST 观察）：`saved`，然后 `failed failed not_found failed`。Batch 2 之后期望第二行为 `ready unknown result_unknown ready`（原型实测）：路由的 `conflict` 只出现在读回失败的原因里，顶层报告按既有规则包成 `result_unknown`，记录保持 Ready。

### 其余只读实验（同一检出，2026-10-08 00:10 CST）

| 实验 | 结果 |
|---|---|
| `composeCore` 传 `development: [a, b]` | `TypeError 槽位 development 的 port 缺少必需方法` |
| 传未知槽位 `development2` | `TypeError 未知的 provider 槽位 development2` |
| `providerRegistry` 两个 Development 挂载 `[默认, 默认]` / `[默认, 非默认]` / `[非默认, 非默认]` | 「多个默认挂载」/「不是默认挂载：只有 Execution 允许备用」/ 同上 |
| `bindingForCapability` 对两个非默认 Development 挂载 | 返回 `dev-a`（先注册的） |
| Storage 依次写两个默认挂载，再都改写为非默认，再把 `dev-a` 写回默认（替身与 SQLite） | `dev-a:false dev-b:true` → `dev-a:false dev-b:false` → `dev-a:true dev-b:false` |

### 变异表（独立验证者在最终树上逐条执行）

每条：在目标文件里确认原文恰好出现一次 → 改写 → 确认文件已变 → 运行 `node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js` → 用内存原文写回。原型上的结果列在「原型变红」一栏，最终树以验证者的实测为准。

| 编号 | 变异（文件：改写） | 应变红的用例 | 原型变红 |
|---|---|---|---|
| M1 | `development-route.ts`：未登记且多挂载时不拒绝（取 `mounts[0]`） | E2 | 1 条 |
| M2 | `development-route.ts`：已登记时忽略身份、取第一个挂载 | E1、E3、两条既有 conflict 用例 | 6 条 |
| M3 | `development-route.ts`：已登记时取最后一个挂载 | E1、E4、两条既有 conflict 用例 | 7 条 |
| M4 | `development-route.ts`：锚点不在挂载里时回落到第一个挂载 | E3、两条既有 conflict 用例 | 5 条 |
| M5 | `start-work.ts`：读回的路由拒绝判 `definite: true` | E3、既有「工作树读能力被策略设为不可用」 | 3 条 |
| M6 | `start-work.ts`：读回仍按 key 解析 `worktree.read` | E1、E3 | 4 条 |
| M7 | `git-provisioning.ts`：仍用 `resolveWriteTarget(worktree.create)` | E1 | 1 条 |
| M8 | `start-work.ts`：注册门用 `gateCommand` 而不是 `gateBinding(route.binding, …)` | E1 | 1 条 |
| M9 | `development-route.ts`：路由到的挂载过不了门时改道到另一个能过门的挂载 | E4 | 1 条 |
| M10 | `capabilities/src/registry.ts`：`bindingForCapability` 恢复 `primary ?? spare` | C2、I1 | 3 条 |
| M11 | `core/src/registry.ts`：Development 多挂载也写成默认 | I1、E1、E2、E4 | 5 条 |
| M12 | `core/src/registry.ts`：唯一 Development 挂载写成非默认 | I1 与大量既有用例 | 108 条 |
| M13 | `capabilities/src/registry.ts`：接受默认与非默认混用 | C1 | 1 条 |
| M14 | `capabilities/src/registry.ts`：接受单个非默认 Development | C1 | 1 条 |
| M15 | `capabilities/src/registry.ts`：「多个备用」检查也作用于 Development | C1、I1、E1、E2、E4 | 6 条 |
| M16 | `core/src/registry.ts`：数组只展开第一个元素 | I1、E1、E2、E4 | 5 条 |
| M17 | `start-work.ts`：读回用工作区第一个登记的仓库路由，而不是记录里的仓库 | E1 | 1 条 |
| M18 | `development-route.ts`：删掉「没有 Development 挂载」那一行 | E3 末段 | 1 条 |

已知等价变异，不计入：其他槽位也接受单元素数组——数组长度 ≥ 2 时会被 Registry 的「多个默认 / 多个备用」拒绝，长度 1 时与传单个对象语义相同，没有可观察差异。

### 拟新增的技术债务（Batch 3 逐字追加到 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 表，列与既有行相同）

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-035 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-development-repository-routing.md` | 查询（`packages/core/src/queries.ts` 的 `workspaceMetadata`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 工作区元数据按 capability key 经 `bindingForCapability` 汇总；Development 有两个及以上挂载时 key 级解析 fail closed，全部 `development.*` key 报 `unavailable`（文案「没有挂载提供能力」），ui-model 的开始工作入口据此禁用 | 跨 PR 契约 K3 规定 #219 不改 `queries.ts`（#222 正在改它）；#127 之前没有生产路径能组装出两个 Development 挂载 | 多挂载工作区的界面把能用的开始工作显示为不可用，原因文案也不对 | #127 的「每个绑定的有效访问快照」按绑定给出；#142 的开始工作对话框按选中仓库的路由结果判定可用性 |
| TD-036 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-development-repository-routing.md` | 路由（`packages/core/src/development-route.ts`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 已登记仓库的锚点查找依赖「`RepositoryRecord.id` 等于锚点身份的 `externalId`」这条约定（唯一写者 `registerParents` 如此写），并因 Storage 端口没有按 id 取身份的方法，对每个 Development 挂载调一次 `findExternalIdentity` | 加 `getExternalIdentity(id)` 要改端口、两个适配器、契约套件与成员锁，多约 60–100 行，并与 #221、#223 的端口改动冲突 | 内部仓库 id 与外部 id 一旦解耦而路由没跟着改，所有已登记仓库都会被拒为「绑定 id 变了」（fail closed，不会读错连接） | #127 引入绑定仓库命令时，同一 PR 改 `routeDevelopment` 的锚点查找（按 id 取身份，或让挂载记录直接带引用），并加入并列引用的选择 |
| TD-037 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-development-repository-routing.md` | 谱系读取（`packages/core/src/chain-facts.ts`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 多 Development 挂载的工作区里，谱系的 Development 读取（`resolveRepository`、`readHeadCommit`、`readChangeRequest`）仍按 key 解析，退化为缺口；文件头「同一外部 id 视为各 provider 下的同一对象」的假设没有被取代 | 跨 PR 契约 K3：#219 不改 `chain-facts.ts`，#221 正在把其中的 Development 解析收拢到一个缝函数 | 多挂载工作区的交付谱系在提交与变更请求两跳只有骨架与缺口；不会读错连接 | #219 与 #221 都合并后，后合并者把缝函数的函数体换成 `routeDevelopment` 并补「已登记仓库只读路由到的挂载」正例；按跳锚定与并列引用归 #233 |
| TD-038 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-development-repository-routing.md` | 装配与登记（`packages/core/src/registry.ts`、Storage 的挂载行） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 多挂载工作区没有登记仓库的生产写入口：#219 的多挂载用例经 Storage 端口种入仓库挂载与身份（旁证）；另外用更少的 provider 重新组合后，没列出的旧挂载行仍以启用状态留在 Storage（#197 的遗留），`listProviderBindings` 读回比 Registry 多 | 绑定仓库与解绑命令属于 #127；清理没列出的挂载要先定义解绑语义 | #127 之前多挂载只能由测试或宿主直写 Storage 建立；读回列表可能含已不在 Registry 的挂载（路由只看 Registry，所以 fail closed） | #127 落地时把 `tests/e2e/start-work.test.js` 的 `bindRepository` 种入改为走绑定命令，解绑写 `enabled = false` |
| TD-039 | 2026-10-08 | Open | `docs/exec-plan/active/2026-10-08-development-repository-routing.md` | 开始工作（`packages/core/src/start-work.ts` 的 `registerParents`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 单 Development 挂载的工作区里，未登记的仓库仍隐式路由到唯一挂载，并由开始工作在写前事务里懒登记仓库身份与挂载；#127 的绑定仓库命令落地后，这里会成为同一事实的第二个写者 | 跨 PR 契约 K3 要求单挂载行为不变；否则开始工作要等 #127 才能用 | 两个写者对「仓库属于哪个连接」可能写出不同形状（例如 #127 写并列引用，懒登记只写一条） | 由 #127 决定去留：保留则两者共用一个登记函数，取消则单挂载未登记也改为结构化拒绝 |

## Outcomes & Retrospective

设计定稿阶段的结果：三份设计在「路由来源」上二比一，采纳持久化事实（α、β）；在「注入表」上采纳联合类型（α、β）；在「角色」上采纳 α 的「唯一挂载才是默认」；在「路由键」上采纳 α 的内部实现加 β / γ 的操作亲和与「结果带引用」；γ 报告的「换连接把 Ready 判成 Failed」由路由构造关闭，并补了判别用例。相对三份设计删掉的机制：γ 的路由表、槽位与谱系钉住参数；β 的 `BindingRole` 枚举、`routeRepository` 纯函数、并列引用读取与 `development-provider.ts` 注释；α 的「拒绝空数组」与独立集成测试文件。原型实测代码约 297 行，远低于 800 的规划上限。

实施完成后在此追加实际规模、全量用例数、变异结果与评审结论，并与上面的设计阶段结论对照偏差。

## Bottom Change Note

- Change Note (2026-10-08 00:40 CST)：创建本计划。读完三份独立设计与跨 PR 契约，在起点只读复现关键事实，在一份不入库的拷贝上做原型并跑完 18 条变异，据此裁决分歧、定稿接口、拒绝语义、测试与变异表，列出 TD-035–TD-039 的全文；在 `docs/README.md` 的 Active 索引加一行。
