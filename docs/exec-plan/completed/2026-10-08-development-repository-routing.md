# Development 按仓库路由 ExecPlan

> 状态：Completed（2026-10-08）。Batch 1–3 已实现并推送；三轮独立对抗验证（11 条、7 条、4 条发现）与独立评审（Singularity-AI-Bot，APPROVED，1 × P2、4 × P3）的修订都已逐条处理（`Progress`）；人类伙伴对合并顺序与接线方的裁决见 `Decision Log` D23。本计划在评审修复轮随 PR 归档，是否合并由人类伙伴决定；合并状态与 head 以 `gh pr view 291 -R SingularityKChen/harness-projects --json state,headRefOid,mergeStateStatus` 回读为准。（这一行此前写作「整合提交、推送与回读待做」，Superseded by `Progress` 里协调者建 backup ref、整合并快进推送的条目（2026-10-08）。）第二轮评审（Singularity-AI-Bot，5 × P3）的修订见 `Progress`、D25–D27 与评审记录 `docs/review/pr-291-mmp-review.md` 的「第二轮修复」；K3 接线改由 #297 承担（D27）。
> 创建：2026-10-08 CST；规范：`PLANS.md`
> 关联：[issue #219](https://github.com/SingularityKChen/harness-projects/issues/219)（本 PR 关闭）；epic #216 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 的 Batch 2B 与验收第 4 行；迭代 5 承诺项（`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` D6）
> 执行上下文：检出 `feature/development-repository-routing` 的工作树根目录（本仓库约定的位置是 `.worktrees/development-repository-routing`），起点 `origin/main@6417d45`。评审修复轮（2026-10-08）把分支 rebase 到 `origin/main@a357ef8`，无冲突（`git range-diff origin/main backup/development-repository-routing-pre-review-rebase HEAD` 的三个提交都是 `=`）；`Context and Orientation` 的「现状」行号与基线数字仍以起点 `6417d45` 为准，不随 rebase 改写。下文命令都在这里运行；`gh` 命令一律带 `-R SingularityKChen/harness-projects`。
> 上游输入：issue #219 正文；`AGENTS.md` §1.1、§2；`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`；`docs/exec-plan/completed/2026-10-01-provider-binding-registration.md`（#197 把同域多挂载留给本 issue）。三份互相独立的设计稿（最小闭环 α、系统与不变量 β、同类工具调研 γ）和协调者的跨 PR 契约 K1–K8 是运行态输入，不入库（`AGENTS.md` §3）；本计划只重述其中被采纳或被否决的结论，相关契约条目抄在 `Interfaces and Dependencies`。

## Purpose / Big Picture

完成后：

- 一个工作区可以同时挂两个或更多 Development 连接：Local Git 与 GitHub，或两个各管一个检出的 Local Git。这里的「Local Git 与 GitHub」指的是各自管不同的仓库（一个仓库只登记在一个连接下）；同一个仓库让 Local Git 建工作树、GitHub 开 PR 需要并列引用，归 #127，本 PR 不做（见 `Design / Spec` 的「被放弃的方案」）。开始工作按「这个仓库属于哪个连接」这条已持久化的事实路由——仓库挂载（`RepositoryRecord`）指向的外部身份在哪个连接下，请求就只进那个连接，另一个连接一次调用都收不到。
- 仓库没有登记而候选连接不止一个（歧义），或仓库登记在一个当前没有挂载的连接上（缺路由），都在任何外部调用与本地写入之前返回结构化拒绝 `conflict`，不取第一个注册者。路由到的连接缺某个能力时报 `not_supported`，不改道到另一个声明了该能力的连接。
- 注册的挂载连同角色读回：唯一的 Development 挂载是默认（与今天相同）；两个及以上时全部非默认，Storage 读回与 Registry 一致，不会出现「先写的默认被 Storage 静默降级」的分叉。
- key 级解析（`bindingForCapability` / `gateCommand`）在同域多个对等挂载时 fail closed。还没改用路由的读取（今天的谱系读取）得到缺口，不会读错连接。
- 单 Development 挂载的工作区行为不变，唯一的例外是「换了连接」这一类（Development 绑定 id 变了，`Decision Log` D8、D19）：已 Ready 的上下文读回不再被另一个连接判成 Failed，而是保留 Ready、报 Unknown；新连接不再收到任何调用，所以对已登记仓库开始工作（新工作项、终态接管、过期续跑）一律在写前返回 `conflict`（`reapply`），不再是新连接 `getRepository` 的失败码，也不再向新连接发 `listBranches` / `createWorktree`；conflict 文案点名仓库挂载的外部身份，并去掉了已不成立的「多 binding 路由见 #219」。换连接之外「不变」的证据是与 `origin/main` 的逐项对照：257 项开始工作的能力组合、读回与终态接管、256 项「已登记仓库换连接」组合里除能力全部放行的 4 项外的 252 项，错误码、恢复动作、可重试性、外部调用数与文案全部相同（`Artifacts and Notes` 的「单挂载差分」，换连接一类的差异在其中逐条列出）。

最小成功证据：`tests/e2e/start-work.test.js` 新增的路由用例（E1–E15 各在替身与 SQLite Storage 上跑一遍，外加两条单挂载对照用例 S1、S2）、`tests/contract/capabilities-keys.test.js` 的两条契约用例（C1、C2）、`tests/integration/provider-binding-registration.test.js` 的两个场景（I1 角色读回、I2 注入表数组语义；替身与 SQLite 各跑一次）全部通过；`Artifacts and Notes` 的 48 条变异逐条变红。

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

    /** 在选定挂载上要过的一道门：capability key 与读 / 写模式。 */
    export type DevelopmentGate = readonly [CapabilityKey, CommandMode]

    export async function routeDevelopment(
      source: DevelopmentRouteSource, repositoryId: string, key: CapabilityKey, mode: CommandMode, earlier: readonly DevelopmentGate[] = [],
    ): Promise<DevelopmentRoute> {
      const mounts = bindingsForDomain(source.registry, 'development')
      const refuse = (code: ProjectErrorCode, message: string): DevelopmentRoute => ({ ok: false, error: projectError(code, message) })
      const ids = mounts.map((mount) => mount.ref.bindingId).join('、')
      const registered = (await source.storage.listRepositories(source.workspaceId)).find((mount) => mount.id === repositoryId)
      let binding: ResolvedBinding | undefined
      let missing: DevelopmentRoute | undefined
      if (registered === undefined) {
        if (mounts.length > 1) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记在本工作区，而工作区有 ${mounts.length} 个 Development 挂载（${ids}）：不取第一个注册者，先登记它属于哪个连接（绑定仓库，#127）`)
        binding = mounts[0]
      } else {
        for (const mount of mounts) {
          const identity = await source.storage.findExternalIdentity(mount.ref.bindingId, ExternalIdentityKind.Repository, repositoryId)
          if (identity?.id === registered.externalIdentityId) binding = mount
        }
        if (binding === undefined) {
          missing = refuse(ProjectErrorCode.Conflict, `工作区已把仓库 ${repositoryId} 挂在外部身份 ${registered.externalIdentityId} 上，但当前 Development 绑定 ${ids} 下没有它的身份——绑定 id 变了，或仓库来自另一个连接：不猜映射，Development 绑定 id 必须跨重启稳定`)
          if (mounts.length > 1) return missing
          binding = mounts[0]
        }
      }
      for (const [gateKey, gateMode] of [...earlier, [key, mode] as const]) {
        const gate = gateBinding(binding, gateKey, gateMode)
        if (!gate.allowed) return { ok: false, error: gate.error ?? unsupportedCapability(gateKey) }
      }
      if (missing !== undefined) return missing
      const provider = binding?.development
      if (binding === undefined || provider === undefined) return refuse(ProjectErrorCode.NotSupported, `能力 ${key} 不可用`)
      return { ok: true, binding, provider, repository: { bindingId: binding.ref.bindingId, objectKind: 'repository', externalId: repositoryId, url: undefined } }
    }

**Superseded by D24 / D25（2026-10-08）**：上面代码块里两条 conflict 文案是首版——歧义那条带着「（绑定仓库，#127）」，缺路由那条没有恢复指引。D24 改过一次，但那一版的动作仍然不存在（没有绑定仓库的命令，改绑会被 `Storage.putRepository` 拒绝），D25 重写。现行文案以 `packages/core/src/development-route.ts` 为准，两条的句尾是——歧义：「不取第一个注册者；本版本还不能在多个连接之间登记仓库，也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来」（「也还不能……选定由哪一个来服务它：」是第三轮 D28 在步骤之前补的提示）；缺路由：「Development 绑定 id 必须跨重启稳定；本版本还不能把已登记的仓库改绑到别的连接，只能让原来的 Development 连接以原绑定 id 挂回来」。代码块的其余部分也只是设计期副本（例如兜底拒绝已在 D22 复用 `unsupportedCapability`），一律以代码为准。

配套的两个门函数（两处都只是把既有函数体拆出一个「在已选定挂载上判定」的入口）：

    // packages/core/src/registry.ts：resolveCapability(registry, key) ≡ resolveBinding(bindingForCapability(registry, key), key)
    export function resolveBinding(binding: ResolvedBinding | undefined, key: CapabilityKey): CapabilityResolution
    // packages/core/src/capabilities.ts：gateCommand(registry, key, mode) ≡ gateBinding(bindingForCapability(registry, key), key, mode)
    export function gateBinding(binding: ResolvedBinding | undefined, key: CapabilityKey, mode: CommandMode): CommandGate

`resolveBinding` 对「挂载缺失，或没有声明该 key」报「没有绑定提供能力 K」（与按 key 解析时 `bindingForCapability` 对未声明 key 返回 undefined 的措辞一致），声明了但不可用才是「能力 K 当前不可用」。首版把「未声明」也说成「当前不可用」，单挂载的文案因此变了（对抗验证发现，D16）。

要点：

- **先选挂载，再按顺序过门**：选挂载只取决于持久化事实；过门的先后由调用方的清单决定（`earlier` 先判，锚点 `[key, mode]` 最后），所以单挂载工作区的拒绝与按 key 逐个过门时完全一致。首版把锚点的门放在三个注册门之前，单挂载在 7 个组合里改了错误码与恢复动作（D16）。
- 缺路由时只有一个挂载，就先按它过门、过了再报 conflict：改动前的先后是「门 → ack → 缺路由」，现在没有 ack 调用，其余不变；多个挂载没有可过门的候选，直接 conflict。没有任何 Development 挂载时没有可选的挂载，第一道门报「没有绑定提供能力」，排在任何 conflict 之前（所以不需要为「没有挂载」单设分支）。
- 只读 Storage，不调用 provider；事务内外都能用（`CoreContext` 与事务句柄都满足 `DevelopmentRouteSource`）。
- 已登记仓库的锚点查找：逐个挂载调 `findExternalIdentity(挂载连接, repository, repositoryId)`，身份 id 等于仓库挂载记录的那条就是路由目标。身份的 `bindingId` 唯一、Registry 不允许同域同 id 两个挂载，所以至多一个命中。它依赖「`RepositoryRecord.id` 等于锚点身份的 `externalId`」这条约定（唯一写者如此写），Storage 端口也没有按 id 取身份的方法，登记为 TD-036。
- 路由结果带着该挂载下的仓库引用 `repository`：调用方只用它调 provider，绝不自己用请求串拼引用。今天它的 `externalId` 就是 `repositoryId`；#127 把内部仓库 id 与各连接下的外部 id 解耦时，只改本函数。
- 不导出到 `packages/core/src/index.ts`：消费者都在 core 内部（开始工作，以及 K3 的谱系缝函数），不扩公共面，也不与 PR-C 改 `index.ts` 冲突。

### 拒绝语义

所有拒绝都发生在任何 provider 调用之前；开始工作的新请求在拒绝时不写任何本地行（不落上下文、不登记仓库）。

| 情形 | 错误码（恢复动作） | 文案要点 | 判别用例 |
|---|---|---|---|
| 工作区没有 Development 挂载 | `not_supported`（`manual_execution`） | 沿用「没有绑定提供能力 K」，K 是调用方清单里的第一道门（开始工作是 `development.branch.create`）；仓库已登记时也不报「绑定 id 变了」 | E3 末段、S1（M18） |
| 歧义：仓库未登记，Development 挂载 ≥ 2 | `conflict`（`reapply`） | 列出全部候选连接；「不取第一个注册者」；只写今天走得通的步骤：先只挂载拥有这个仓库的连接并开始工作一次，再把其余连接挂回来（D25）；步骤之前先说登记之后撤不回、要选定由哪一个连接来服务它（D28） | E2（两个挂载，句尾逐字锚定，M47、M50、M51）、E10（三个挂载，M34）、E15（逐字执行文案，M43、M45、M51） |
| 缺路由：仓库已登记，但它的身份不在任何当前挂载的连接下 | `conflict`（`reapply`）；单挂载时先按它过门、门都过了才报 | 保留「当前 Development 绑定 X 下没有它的身份——绑定 id 变了」；只写今天走得通的恢复：让原来的连接以原绑定 id 挂回来，并明说还不能改绑（D25） | E3（含「单挂载先过门」与「挂回原连接」两段，句尾逐字锚定，M18、M44、M46、M48、M49）、E7（身份属于未挂载连接，第一个挂载缺能力也是 conflict，末段在三个挂载下把 dev-old 挂回来，M4、M19、M36）、E12（三个挂载，M35）、`tests/integration/start-work-sqlite-registration.test.js` 两条既有 conflict 用例 |
| 路由到的挂载未声明该 key，或该 key 不可用 | `not_supported`（`manual_execution`） | 未声明沿用「没有绑定提供能力 K」，声明了但不可用沿用「能力 K 当前不可用」；不改道；锚点之前的注册门同样只在路由到的挂载上判定 | E4（M9）、E14（M39、M40）、S1（M30） |
| 写命令遇到只读 | `permission_denied`（`fix_permission`） | 沿用「能力 K 当前只读」 | 既有 `REJECTIONS` 行、S2（M29） |
| 两个能力同时被拒 | 先判的那个：`branch.create` → `repository.read` → `worktree.read` → `worktree.create` | 与改动前按 key 逐个过门的先后一致，路由不得把锚点提到最前；注册门内部的先后同样钉住（文案点名先判的那个） | S2（M29、M37） |

不新增 `ProjectErrorCode`：新码要跨 `packages/domain`、wire、ui-model 与 golden 表改动，还需要一个现在不存在的恢复动作（「去绑定仓库」；这个命令也不存在，所以 conflict 文案不能许诺它，只写今天走得通的步骤，见 D25）。这个动作在 #127 / #142 有界面之前没有消费者；缺路由沿用 `start-work.ts:140` 已有的 `conflict` 先例。可由人类在 PR 评审时推翻（D6）。

### 调用点

- `prepareRegistration`：工作项预检之后，`routeDevelopment(context, request.repositoryId, worktree.create, 'write', REGISTRATION_GATES)`：选定挂载后，先按 `branch.create`（写）、`repository.read`（读）、`worktree.read`（读）、最后锚点 `worktree.create`（写）在同一挂载上过门；任何一步拒绝即拒绝。仓库 ack 向 `route.provider.getRepository(route.repository)` 要，回显必须逐字等于 `route.repository`。登记用 `route.repository.bindingId`。删除第 135–141 行的挂载冲突预检（它就是路由的「缺路由」分支）。
- `provisionGit`：同样按 `worktree.create` / `'write'` 路由；拒绝时 `gitFailure(contextId, markFailed(beginWrite(names.path), route.error), undefined, undefined)`。仓库引用、`bindingId` 都取自路由结果。
- `verifyExistingWorktree`：按 `worktree.read` / `'read'` 路由；拒绝时 `{ ok: false, definite: false, error }`——缺路由只是「此刻无法确认」，不问另一个连接，也不改判 Failed（D8）。工作树引用的 `bindingId` 取 `route.binding.ref.bindingId`。
- `chain-facts.ts` 不改（K3）。多挂载时它的 `gateCommand` 因 key 级 fail closed 得到缺口；单挂载不变。

### 机制与它保护的东西

| 机制 | 保护的验收 / 不变量 | 判别用例（被哪条变异证明） |
|---|---|---|
| `development` 接受数组、角色按数目推出 | #219 验收 1、3；不变量 2 | I1、E1（M11、M12、M16） |
| Registry 的 Development 角色规则 | 验收 3：读回的角色就是 key 级解析的行为 | C1（M13、M14、M15） |
| key 级解析 fail closed（两个及以上对等挂载，不是「恰好两个」） | 验收 2；K3 的「多挂载谱系读是缺口、不读错连接」 | C2（两个与三个对等挂载）、I1（M10、M41） |
| 路由按持久化身份选挂载 | 验收 1；不变量 5、6 | E1（M2、M3）、既有 conflict 用例 |
| 未登记且多挂载时拒绝（不只是「恰好两个」） | 验收 2（歧义） | E2、E10（M1、M34） |
| 锚点不在挂载里时拒绝；多个挂载时直接 conflict，先于任何挂载的能力门 | 验收 2（缺路由） | E3、既有 conflict 用例、E7（两个挂载）、E12（三个挂载）（M4、M35、M36） |
| 按身份在全部挂载里找（不只看前两个），登记在第三个的只进第三个 | 验收 1：Registry 允许 N ≥ 3 个对等挂载（C1），路由不得假定恰好两个 | E11（M38） |
| 缺能力不改道 | 验收 2；不变量 5 | E4（M9） |
| 一次操作只路由一次（注册门、供应、读回都在路由到的挂载上） | 验收 1 | E1（M6、M7、M8、M17）；E14：多挂载下锚点之前的注册门不在第一个挂载上判、也不被跳过（M39、M40） |
| 读回的路由拒绝不判 Failed | 验收 1（新连接零调用）；不变量 7 | E3（M5） |
| 读回按读门路由（`'read'`），不按写门 | 验收 1、不变量 7：只读的工作树读照样验证，不把 Saved 降成 Unknown | E9（M33） |
| 没有任何 Development 挂载时先报缺能力 | 诊断准确：#132 禁用了唯一的 Development 挂载时，已登记仓库报 `not_supported` 而不是误导性的「绑定 id 变了」 | E3 末段、S1（M18） |
| 先选挂载、再按调用方的顺序过门；缺路由时单挂载先过门 | 「单挂载行为不变，唯一例外是 D8」：拒绝的错误码、恢复动作与文案与改动前逐项相同；两个能力同时被拒时点名谁（只比错误码分不出仓库读与工作树读） | S1、S2、E3 的「单挂载先过门」一段（M18、M29、M30、M37）；257 + 256 项差分（`Artifacts and Notes`） |
| 仓库挂载按 id 精确匹配、身份必须是该挂载连接下的那一条 | 验收 1、2：不因「某个挂载下恰有同名身份」或 id 相近而选错连接 | E7、E8（M19、M20） |
| 外部写入记录路由到的连接；路由拒绝不记写尝试 | `AGENTS.md` §7：写尝试记录目标 ProviderBinding，没收到调用的连接不是写入目标 | E1 的账本断言、E6（M21、M32）；E5、E13 的账本断言（M42） |
| 终态接管与过期续跑也路由，拒绝不供应、锚点只读不放行 | 验收 1；D8 的后半（接管与续跑不再向新连接建分支、建工作树） | E5、E6、E13（M22、M23、M32） |
| 注入表的数组语义只属于 `development` 槽位 | Design 声明：其他槽位传数组照旧被拒绝，单元素数组与单个同义，错误文案点名下标 | I2（M25–M28） |
| 路由在替身与 SQLite 上选同一个挂载 | 验收 1、2：路由只读 Storage，两种实现的读回必须一致 | E1–E15 各跑两遍 |

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

实施后实测（在检出本分支的工作树根目录运行 `node scripts/rule-checks.mjs size origin/main`，三轮对抗验证的修复与最终验收的提交之后，易失，以现场输出为准）：代码 508 / 1000（实现 200：`development-route.ts` 70、`start-work.ts` 46、`registry.ts` 37、capabilities 的 `registry.ts` 18、`git-provisioning.ts` 17、`capabilities.ts` 12；测试 308：e2e 261、`provider-binding-registration` 28、`capabilities-keys` 19），文档见 `Outcomes & Retrospective`。Superseded by `Outcomes & Retrospective` 的「规模（回读命令与观察）」（2026-10-08 评审修复轮）：规模是易失值，以回读命令加带树标识的观察为准（评审修复轮观察：代码 512 / 1000，实现仍是 200，测试 312：e2e 263、`provider-binding-registration` 30、`capabilities-keys` 19）。比原型多出的约 210 行代码几乎全是三轮对抗验证补的判别用例（路由用例参数化到两种 Storage、E5–E14、S1、S2、I2，以及 C2 的三个对等挂载与 E5、E13 的账本断言），实现只多了 `earlier` 与「先选后过门」的约 30 行。

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

- [x] 先写 C1、C2、I1，确认按 `Concrete Steps` 所列原因变红。
- [x] 改 `providerRegistry`、`bindingForCapability`、`CoreProviderTable`、`mountsOf`。
- [x] 跑验证，提交 `feat(core): 允许一个工作区挂多个 Development 连接并按角色读回`（正文说明为什么，末行 `Refs #219`）。

**验证**：

    node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js
    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e

期望：第一条 131 / 131（基线 128 加 C2 一条、I1 两条）；`tsc` 无输出；全量 0 fail。（这是该批提交当时的数字；Superseded by「对抗验证后的修订」与 `Outcomes & Retrospective`（2026-10-08）：最终树上的用例数、规模以现场输出为准，命令不变。）
**回滚**：revert 本批提交。注入表回到单槽，没有数据需要恢复。

### Batch 2 · 开始工作按仓库路由

**最小闭环**：两个 Development 替身注入 core，开始工作与读回只进路由给它的那个挂载；歧义、缺路由、缺能力都在任何外部调用之前结构化拒绝；换连接不再把 Ready 判成 Failed。
**涉及文件**：`packages/core/src/development-route.ts`（新）、`packages/core/src/start-work.ts`、`packages/core/src/git-provisioning.ts`、`packages/core/src/capabilities.ts`、`packages/core/src/registry.ts`、`tests/e2e/start-work.test.js`。

- [x] 先写 E1–E4 与三个辅助函数，确认 E1–E3 按 `Concrete Steps` 所列原因变红（E4 在 Batch 1 的中间态碰巧为绿，判别力由 M9 证明）。
- [x] 加 `resolveBinding`、`gateBinding`、`routeDevelopment`，改三个调用点。
- [x] 跑验证，提交 `feat(core): 按仓库把开始工作路由到它所属的 Development 连接`（末行 `Refs #219`）。

**验证**：

    node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js tests/e2e/delivery-lineage.test.js
    node_modules/.bin/tsc --noEmit
    node --test --test-timeout=120000 tests/contract tests/integration tests/e2e
    node --test --test-timeout=120000 tests/mvp0
    pnpm run boundaries

期望：第一条 142 / 142（原型实测）；`tsc` 无输出；全量 0 fail，用例数等于起点加 7；MVP-0 7 / 7；包边界 8 / 8。（首版数字；Superseded by「对抗验证后的修订」与 `Outcomes & Retrospective`（2026-10-08）：最终树第一条命令不再是 142，原因是补了判别用例；`tsc`、全量 0 fail、MVP-0、包边界的期望不变。）
**回滚**：先 revert 本批，再视需要 revert Batch 1。没有 schema 变更；revert 后用单个 Development 重新组合，会把它写回默认。

### Batch 3 · 对抗验证、变异与文档收口

**最小闭环**：独立验证者在最终树上逐条跑变异表并复核验收；技术债务、控制计划与本计划回填到与代码一致。
**涉及文件**：`docs/exec-plan/tech-debt-tracker.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`、本计划、`docs/README.md`。

- [x] 独立验证者对抗验证：在最终树上复跑 M1–M18、做探针与差分，出 11 条发现（P2 × 4、P3 × 7），处理见 `Progress` 与 `Decision Log` D16–D18。修复后实现者在 `git archive HEAD` 的导出树上重跑了变异表（M1–M32 全部变红，每条先证明已生效），结果见 `Artifacts and Notes`。
- [x] 第二轮对抗验证（7 条发现）的处理见 `Progress`、`Decision Log` D19–D21 与「对抗验证后的修订」第 24–28 步；变异表扩到 M38，最终树整表重跑。
- [x] 第三轮对抗验证（4 条发现）与最终验收（验收者重构与复跑）的处理见 `Progress`、`Decision Log` D22 与「对抗验证后的修订」第 29–32 步；变异表扩到 M42，最终树整表重跑。
- [x] 把 `Artifacts and Notes` 的 TD-035–TD-039 五行逐字追加到技术债务表（不要用 `update_tech_debt_tracker.py`，它会抹掉既有条目）。
- [x] 控制计划第 31 行与 Batch 2B 段就地标注（文字见 `Concrete Steps`）。
- [x] 回填本计划的 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective`、`Bottom Change Note`，更新 `docs/README.md` 的状态列。
- [x] 跑发布前检查，提交 `docs(exec-plan): 回填 Development 路由的验证证据与技术债务`（末行 `Refs #219`）。

**验证**：

    node scripts/rule-checks.mjs size origin/main
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/workflow-check.mjs
    git diff --check origin/main...HEAD
    pnpm verify

期望：`size` 报代码 ≤ 800（预计约 297）、文档 ≤ 1300；其余命令 exit 0。（297 是设计阶段的原型数；Superseded by「对抗验证后的修订」与 `Outcomes & Retrospective`（2026-10-08）：最终树的实测见「文件所有权与规模估算」，上限不变。）
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
3. `tests/integration/provider-binding-registration.test.js`，在 `SCENARIOS` 数组开头插入 I1，名字为 `Development 多挂载按角色读回：唯一挂载是默认；两个挂载都非默认且与 Registry 一致，从一个重组为两个时原默认被改写；同一连接在另一个工作区仍是默认；空数组即没有挂载；同一对象注入两次 0 事务被拒；谱系读在多挂载且仓库未登记时是缺口而不取第一个（接线前后都成立，不是路由接线的护栏）`（末段是评审修复轮的改名，D24；首版写作「谱系读在多挂载时是缺口而不取第一个」）。用文件里已有的 `fakes`、`compose`、`rows`、`row`、`probe`、`QUERY` 与 `createFakeDevelopmentProvider`、`readChainFacts`、`CapabilityKey`，依次断言：
   - `compose(storage, { planning, development })` 后 `rows(storage)` 为 `[row(SHARED, 'development'), row(SHARED, 'planning')]`；
   - `const context = await compose(storage, { planning, development: [development, other] })`（`other` 的 `bindingId` 为 `conn-dev-b`）后，`rows(storage)` 为 `[row('conn-dev-b', 'development', KEY, false), row(SHARED, 'development', KEY, false), row(SHARED, 'planning')]`，并且 `context.registry` 里两个 Development 挂载的 `[bindingId, isDefault]` 为 `[[SHARED, false], ['conn-dev-b', false]]`；
   - 再以 `{ workspace: { id: 'ws-2' } }` 只挂 `development`、以 `{ workspace: { id: 'ws-3' } }` 挂 `development: []`：`rows(storage, 'ws-2')` 为 `[row(SHARED, 'development'), row(SHARED, 'planning')]`，`rows(storage, 'ws-3')` 为 `[row(SHARED, 'planning')]`，`rows(storage)`（ws-1）不变；
   - `probe(storage)` 包装后 `compose(probed, { planning, development: [development, development] })` 以 `TypeError` `/重复/` 拒绝，`seen.transactions === 0`；
   - `(await readChainFacts(context, QUERY)).gaps` 含 `key === CapabilityKey.DevelopmentRepositoryRead` 的一条；该场景没有登记任何仓库，所以无论谱系读取是否已改走 `routeDevelopment`（K3 的接线）都成立，它不是接线的护栏（D23、D24）。
   - 起点上为什么红：`mountsOf` 拒绝数组，`TypeError: 槽位 development 的 port 缺少必需方法`。
4. 运行：

       node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js

   期望：恰好 4 条失败（C1、C2、I1 × 2），失败原因与上面三条一致。

### Batch 1 的实现

5. `packages/capabilities/src/registry.ts`：
   - `providerRegistry` 第 57 行的条件加上 `&& ref.domain !== 'development'`，文案改为「只有 Execution 允许备用、Development 允许按仓库路由的对等挂载」；
   - 域循环改为先算 `defaults`、多于 1 即「多个默认挂载」；`domain === 'development'` 时若 `(defaults === 1) !== (mounts.length === 1)` 抛「能力域 development 的挂载角色不一致（N 个挂载、M 个默认）：唯一挂载才是默认，多个挂载一律非默认、按仓库路由」；其他域保留「多个备用」检查（首版在条件前多写了 `mounts.length > 0 &&`，没有挂载时 `false !== false` 本就不抛，是死条件，第二轮对抗验证后删除）；
   - `bindingForCapability` 的最后一个分支改为 `primary ?? (mounts.length === 1 ? spare : undefined)`；
   - 两段函数注释按「Design / Spec」改写。
6. `packages/core/src/registry.ts`：`CoreProviderTable.development` 改为联合类型（含注释）。`mountsOf` 的槽位循环改为先 `MOUNT_SLOTS.flatMap` 展开成 `[slot, domain, isDefault, port]`（`development` 且是数组时逐个展开、槽位名 `development[i]`；`isDefault` 对 `development` 取 `ports.length === 1`），循环体逐字不动，只把 `port` 改为从展开结果取（不要整体缩进循环体，否则行数翻倍）。`MOUNT_SLOTS` 的注释补一句 Development 的角色规则。
7. 运行 Batch 1 的「验证」三条命令，期望同 `Plan of Work`。

### Batch 2 的红用例

（本节与 Batch 2 的实现保留首版的步骤，作为红 / 绿的原始证据。对抗验证之后，E1–E4 与三个辅助函数已参数化到替身与 SQLite 两种 Storage 上、用例名带 `替身 Storage：` / `SQLite Storage：` 前缀，路由函数也加了 `earlier`；新增的 E5–E8、S1、S2 与改动见本节之后的「对抗验证后的修订」；第二轮之后辅助函数 `twoDevelopments` 泛化并改名为 `developments`（可选第三个挂载），下面的代码块保留首版。）

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
   - **E2** `两个 Development 挂载、仓库没有登记：结构化 conflict，两个挂载零调用、不落上下文（#219 验收 2，歧义）`：不登记任何仓库，对 `repo-alpha` 开始工作；`[writeState, executionContextId, error.code]` 为 `['failed', undefined, 'conflict']`，文案含 `dev-a、dev-b` 与「不取第一个注册者」；`A.calls`、`B.calls` 都是 `[]`；替身 Storage 的上下文数为 0。Superseded by 第二轮与第三轮（D25、D28）：现行 E2 还断言步骤之前有「登记之后撤不回」的提示，并对从「：不取第一个注册者；」到句尾的整段文案做 `$` 锚定的相等断言。
   - **E3** `重组后换了 Development 连接：已登记仓库上的新工作项写前 conflict，已 Ready 的上下文保持 Ready 报 Unknown，新连接零调用（#219 验收 1、2，缺路由）`：单挂载组合、对 `repo-alpha` 开始工作得 `saved`；用同一份 Storage、只挂一个 `bindingId` 为 `dev-moved` 的 `recorded` 替身重新组合；另一个工作项对 `repo-alpha` 开始工作得 `failed` + `conflict`，文案匹配 `/绑定 id 变了/`；原工作项换新键开始工作得 `ready` + `unknown`，Query 读到的状态仍是 `ready`；新连接的 `calls` 为 `[]`。最后用同一份 Storage、`development: undefined` 再组合一次，另一个工作项对 `repo-alpha` 开始工作得 `not_supported`（没有任何 Development 挂载时报缺能力，不报「绑定 id 变了」）。
   - **E4** `路由到的挂载缺工作树创建能力：not_supported，不改道到另一个声明了它的挂载（#219 验收 2）`：`twoDevelopments({ a: { capabilities: { worktreeCreate: false } } })`，`repo-alpha` 登记到 `dev-a`；开始工作得 `failed` + `not_supported`；两边 `calls` 都是 `[]`，上下文数为 0。
10. 运行 `node --test tests/e2e/start-work.test.js`。期望 3 条失败，原因：E1 为 `['failed', 'failed']`（多挂载下 key 级门 fail closed，得 `not_supported`）；E2 为 `not_supported`，不是 `conflict`；E3 为 `['failed', 'failed', 'failed']`（读回问了新连接、被判 Failed）。E4 通过。在起点上运行，E1、E2、E4 都因组合时 `TypeError` 而红，E3 的红因与上面相同。

### Batch 2 的实现

11. `packages/core/src/registry.ts`：把 `resolveCapability` 的函数体移到新的 `resolveBinding(binding, key)`，`resolveCapability` 改为一行委托。
12. `packages/core/src/capabilities.ts`：import 加 `resolveBinding`；把 `gateCommand` 的函数体抽成私有的 `gateOn(resolution, key, mode)`，`gateCommand` 与新增的 `gateBinding(binding, key, mode)` 都委托给它。
13. 新建 `packages/core/src/development-route.ts`：文件头注释写明路由来源、只读 Storage、结果带引用、一次操作只路由一次、#127 只改内部；函数体照「Design / Spec」的代码。
14. `packages/core/src/start-work.ts`：import 里 `gateCommand` 换成 `gateBinding`，删掉 `resolveCapability` 的 import，加 `import { routeDevelopment } from './development-route.ts'`；按「调用点」一节改 `prepareRegistration`（同时更新 `REGISTRATION_GATES` 与函数头注释）与 `verifyExistingWorktree`（加一行注释说明拒绝为什么不判 Failed）。Superseded by「对抗验证后的修订」第 21 步与 D16（2026-10-08）：最终的 `start-work.ts` 既不 import `gateCommand` 也不 import `gateBinding`——三个注册门作为 `earlier` 交给 `routeDevelopment`，在选定的挂载上由路由判。
15. `packages/core/src/git-provisioning.ts`：import 删掉 `resolveWriteTarget`、加 `routeDevelopment`；按「调用点」一节改 `provisionGit` 开头，`provider`、`repository`、`bindingId` 都取自路由结果，其余不动。
16. 运行 Batch 2 的「验证」五条命令，期望同 `Plan of Work`。

### 对抗验证后的修订（Batch 3 之后；复跑命令都在检出本分支的工作树根目录）

19. **复现发现 1**：在 `git archive origin/main` 导出树与 HEAD（第一轮修复之前，本地提交，整合后不再存在）上各跑同一份脚本，对 4 个注册相关 key（`branch.create`、`repository.read`、`worktree.read`、`worktree.create`）× 正常 / 只读 / 不可用 / 未声明共 256 个组合加「没有挂载」，比较错误码、恢复动作、可重试性、外部调用数与文案。修订前 76 项错误码或恢复动作不同、131 项只有文案不同，复现了「单挂载拒绝的错误码也变了」。
20. **红用例**：S1（未声明报「没有绑定提供能力」、没有挂载按第一道门报缺能力）、S2（两个能力同时被拒的先后）、E3 的「单挂载先过门」与「没有挂载」两段，在第一轮修复之前的 HEAD 上变红（共 4 条）。
21. **修复**：`resolveBinding` 恢复「没有绑定提供能力」；`routeDevelopment` 先选挂载、再按 `[...earlier, 锚点]` 的顺序过门，开始工作把三个注册门作为 `earlier` 传入；缺路由时单挂载先过门、过了再报 conflict。同一批差分重跑：256 + 1 项逐字节相同，读回与终态接管两条路径相同，「已登记仓库换连接」256 项里 252 项逐项相同、4 项只差新连接不再收到 `getRepository`。
22. **补判别用例**：E1 加写尝试账本断言；新增 E5（终态接管）、E6（多挂载下的终态接管）、E7（仓库挂载的身份属于未挂载连接）、E8（仓库 id 精确匹配）；E1–E8 在两种 Storage 上各跑一遍；I2（注入表数组语义）。每条用例对应的变异见 `Artifacts and Notes`。
23. **复跑**：四文件命令 151 / 151；五文件（加 `tests/e2e/delivery-lineage.test.js`）158 / 158；`tsc --noEmit` 无输出；全量 1229 / 1229；`tests/mvp0` 7 / 7；`pnpm run boundaries` 8 / 8。
24. **第二轮对抗验证的复现（2026-10-08）**：在 `git archive HEAD` 导出树里逐条复现发现，前三条都是判别缺口而不是实现缺陷：把 `verifyExistingWorktree` 里读回路由的 `'read'` 改成 `'write'`，四文件命令仍全绿（只读的工作树读的读回会从 Saved 变成 Unknown）；把歧义判断 `mounts.length > 1` 改成 `=== 2`，三个挂载下未登记的仓库被送给第一个挂载并 `saved`；把 `REGISTRATION_GATES` 里仓库读与工作树读对调仍全绿（两者同时被拒时文案点名另一个能力）。「换连接」一类的差异用同一份脚本在 `git archive origin/main` 导出树与修订前的 HEAD 上各跑一遍，三处断言都属实（逐项输出见 `Artifacts and Notes` 的「单挂载差分」）：新连接 `getRepository` 失败时错误码由 `not_found` / `unavailable` / `permission_denied` 变成统一的 `conflict`；终态接管与过期续跑在 `origin/main` 上向新连接发 `listBranches`、`createWorktree` 并得到 `not_found`，现在是 `conflict`、零调用；conflict 文案点名了内部外部身份 id、去掉了「多 binding 路由见 #219」。
25. **补判别用例**：E9（只读的工作树读：读回确认 Saved）；E10–E12（三个挂载：未登记的歧义、登记在第三个只进第三个、仓库挂在未挂载连接上时第一个挂载缺能力仍是 conflict）；E13（过期续跑换连接，零调用）；E7 让第一个挂载缺能力，钉住两个挂载下「缺路由先于挂载的能力门」；S2 加「仓库读与工作树读同时被拒」一行并比较文案。辅助函数 `twoDevelopments` 泛化为 `developments`（`c` 给了才有第三个挂载）。
26. **删掉死条件**：`providerRegistry` 的 Development 角色检查里 `mounts.length > 0 &&` 是等价代码，删除；不进变异表（见「已知等价变异」）。
27. **文档**：D8 的范围订正、D19–D21；Purpose、差分表、验收表与首版期望的 Superseded 标注；本地提交 SHA 的引用改写成可复现的规则（整合后那些提交不再存在）。
28. **复跑**：四文件命令 161 / 161；五文件（加 `tests/e2e/delivery-lineage.test.js`）168 / 168；`tsc --noEmit` 无输出；全量 1239 / 1239；`tests/mvp0` 7 / 7；`pnpm run boundaries` 8 / 8；变异 M1–M38 在最终树上全部变红。（第二轮之后的数字；Superseded by 第 32 步（2026-10-08 最终验收）。）
29. **第三轮对抗验证的复现（最终验收者，2026-10-08）**：把 M39–M42 四条变异（多挂载下锚点之前的注册门改在第一个挂载上判、多挂载时跳过注册门、key 级解析写成「恰好两个才 fail closed」、`provisionGit` 的路由拒绝把写尝试记在第一个 Development 挂载上）应用到 `git archive HEAD` 导出树，并把两个测试文件换回第三轮之前的版本：四文件命令 161 条里红 0 条，四条都存活，复现了三处判别缺口；实现本身没有缺陷。
30. **补判别用例**：E14（两个挂载、仓库登记在 `dev-b`、`dev-b` 缺分支创建或工作树读：`not_supported` 且文案点名该能力，两个挂载零调用、不落上下文）；C2 对两个与三个对等挂载都断言 `undefined`；E5、E13 断言路由拒绝之后账本里只有 Ready 那一次的写尝试（辅助函数 `attemptKeys`）。换回本步的测试文件后，M39–M42 分别红 2、2、1、4 条。
31. **重构（不改行为）**：`routeDevelopment` 末尾「选中的挂载没有 Development port」的兜底拒绝原来手写 `能力 ${key} 不可用`，与 `unsupportedCapability(key)` 逐字相同，改为直接复用（D22）。
32. **复跑（最终验收者，2026-10-08 02:56 CST）**：四文件命令 163 / 163；五文件 170 / 170；`tsc --noEmit` 无输出；全量 1241 / 1241；`tests/mvp0` 7 / 7；`pnpm run boundaries` 8 / 8；变异 M1–M42 在最终树上全部变红；R1 复现输出 `saved` 与 `ready unknown result_unknown ready`；单挂载差分 1280 项里只有「已登记仓库换连接、没有门被拒」的 4 项不同（`Artifacts and Notes`）。

### Batch 3 的文档文字

17. 控制计划 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`：
    - 第 31 行「每域一个主实例不变」之后、右括号之前，就地追加：`；Superseded by docs/exec-plan/completed/2026-10-08-development-repository-routing.md（2026-10-08，#219）：Development 可以有多个挂载，唯一挂载是默认、多个时全部非默认并按仓库路由，其余域仍每域一个主实例`。
    - Batch 2B 段末追加：`（2026-10-08：设计与实施见 docs/exec-plan/completed/2026-10-08-development-repository-routing.md；路由放在 core，development-provider.ts 不改，理由见该计划 Decision Log D9；验收第 4 行的「Local Git + GitHub 绑定装配」在本 PR 只有两个可区分替身的证据，真实装配随 #231 / #132）`。
18. 合并之后才把本计划移到 `docs/exec-plan/completed/`，并更新索引；合并由人类决定。Superseded by 评审修复轮（2026-10-08，D24）：评审已 APPROVED 且只剩 P2 / P3，本计划随 PR 收尾归档（索引同步移到 Completed 表）；合并仍由人类决定。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 两个 Development provider 各自只收到路由给它的请求（#219 验收 1） | E1：调用记录只含本连接的引用、写尝试记各自的连接，读回各问自己的挂载一次；E3：重组后新连接零调用；E5、E6、E13：终态接管与过期续跑也一样；E7、E8：不被同名身份或相近的仓库 id 带偏；E9：只读的工作树读照样验证读回；E11：三个挂载时登记在第三个的仓库只进第三个；E14：多挂载下锚点之前的注册门也只在仓库所属的挂载上判定；E5、E13：路由拒绝不记写尝试；全部在替身与 SQLite 上各跑一遍 |
| 2 | 缺路由或歧义返回结构化拒绝，不取第一个注册者（#219 验收 2） | E2、E10（歧义 → `conflict`，全部挂载零调用、零上下文，两个与三个挂载）；E3、E7、E12 与 `start-work-sqlite-registration.test.js` 两条既有 conflict 用例（缺路由）；E4、E14（缺能力不改道）；C2（key 级不取第一条，两个与三个对等挂载） |
| 3 | 注册的挂载连同角色读回；`node --test tests/contract/capabilities-keys.test.js` 通过（#219 验收 3） | C1、C2 通过；I1 在替身与 SQLite 上读回的 `isDefault` 与 Registry 一致，重组改写旧默认，跨工作区角色互不影响 |
| 4 | 单挂载工作区的现有行为不变（D8 除外） | `tests/e2e/start-work.test.js`、`tests/integration/start-work-sqlite-registration.test.js`、`tests/e2e/delivery-lineage.test.js`、`tests/mvp0` 的既有用例不改断言、全部通过；S1、S2 与 257 + 256 项差分（`Artifacts and Notes`）证明拒绝的错误码、恢复动作与文案和 `origin/main` 逐项相同，唯一的差别是「换了连接」一类（D8、D19：新连接零调用，一律写前 conflict，文案点名外部身份；差分表逐条列出），E13 钉住其中的过期续跑 |
| 5 | 控制计划验收第 4 行「两个 Development 实现可共存且路由明确」 | 部分：路由明确、歧义拒绝、单连接跨工作区角色不混由替身证据覆盖（E1、E2、I1）；「Local Git + GitHub 绑定装配」要等 #231 的真实 provider 与 #132 的组合根，如实记为部分 |
| 6 | 守卫有判别力 | `Artifacts and Notes` 的变异表 M1–M51 在最终树上逐条变红（每条先证明变异已生效） |
| 7 | 依赖方向与类型 | `pnpm run boundaries` 8 / 8；`node_modules/.bin/tsc --noEmit` 无输出 |
| 8 | 规模 | `node scripts/rule-checks.mjs size origin/main`：代码 ≤ 800、文档 ≤ 1300 |
| 9 | 发布面 | `node scripts/rule-checks.mjs disclosure origin/main` exit 0，并人工过 `docs/development/publication.md` 的五个类目 |
| 10 | 合并顺序与 K3 接线方已定，本 PR 不含接线 | `Decision Log` D23、D27（原定 #290 → #291 → #292、#292 接线并带正例；D27 更正为接线与正例改由 #297 承担，#292 不再等本 PR）、`Interfaces and Dependencies` 的 K3 条目与 TD-037 的「下一步」；`git diff origin/main...HEAD --stat` 不含 `chain-facts.ts`；I1 的谱系缺口断言在用例名与注释里写明接线前后都成立，不是接线的护栏 |
| 11 | 路由拒绝文案只写今天走得通的步骤：不把内部 issue 号当指引，不许诺不存在的命令，不指向会被 Storage 拒绝的改绑 | E2、E3 断言新文案并禁止 `#\d+`、「绑定仓库」「重新绑定」；E15 把歧义文案的三步逐字执行，E3、E7 末段把原连接挂回来（替身与 SQLite 各一遍）；E2、E3 另对两条文案的句尾做 `$` 锚定的相等断言，禁词表挡不住的「在动作后面再追加一个不存在的动作」也会红（D28）；歧义文案在步骤之前说明登记之后撤不回（D28）；M43–M51 变红 |

## Progress

- [x] (2026-10-08 00:05 CST) 读完 issue #219、`AGENTS.md`、`PLANS.md`、三份设计稿、跨 PR 契约、控制计划 Batch 2B、ADR-0006、#197 计划，以及 #127 / #132 / #235 / #233 / #4 的正文。
- [x] (2026-10-08 00:15 CST) 在起点 `origin/main@6417d45` 只读复现设计稿的关键事实：注入表、Registry 三种组合、key 级取第一条、Storage 降级与改写、重组后 Ready 被判 Failed；四个目标测试文件基线 128 / 128。
- [x] (2026-10-08 00:25 CST) 在一份不入库的起点拷贝上做原型：Batch 1 后 131 / 131；Batch 2 后五个相关文件 142 / 142，contract / integration / e2e 全量除一条依赖 `.git` 的 CLI 用例（拷贝里没有 `.git`，与本改动无关）外全部通过，MVP-0 7 / 7，包边界 8 / 8，`tsc` 无输出；变异 18 条全部变红（M17 第一次存活，补强 E1 后变红；M18 是复核「每个机制保护什么」时补的，对应 E3 末段的断言）。
- [x] (2026-10-08 00:40 CST) 裁决三份设计的分歧，写成本计划；在 `docs/README.md` 的 Active 索引加一行。
- [x] (2026-10-08 01:35 CST) 规划提交 `21ccaca` 推送，开 draft PR #291，`node scripts/policy-check.mjs pr 291` 通过；#219 `Status` 置 In Progress（见 Decision Log）。
- [x] (2026-10-08 00:46 CST) Batch 1：注入表、角色与 key 级 fail closed（提交 `feat(core): 允许一个工作区挂多个 Development 连接并按角色读回`）。起点（规划提交之后的本地文档提交，整合后不再存在）上四个目标文件 128 / 128；红阶段恰好 4 条失败（C1、C2、I1 × 2），原因与 `Concrete Steps` 一致（C1 `TypeError … 不是默认挂载：只有 Execution 允许备用`；C2 `repository.read` 返回先注册的 `dev-a`；I1 `TypeError 槽位 development 的 port 缺少必需方法`）；实现后四个文件 131 / 131、`tsc --noEmit` 无输出、contract / integration / e2e 全量 1209 / 1209。变异 M10–M16 在 `git archive HEAD` 导出目录里逐条变红，还原后复跑 131 / 131。
- [x] (2026-10-08 00:50 CST) Batch 2：开始工作按仓库路由（提交 `feat(core): 按仓库把开始工作路由到它所属的 Development 连接`）。红阶段 3 条失败（E1 `['failed','failed']`、E2 得 `not_supported`、E3 `['failed','failed','failed']`），E4 为绿，与计划一致；实现后五个相关文件 142 / 142、`tsc` 无输出、全量 1213 / 1213（起点 1206 加 7）、`tests/mvp0` 7 / 7、`pnpm run boundaries` 8 / 8；R1 复现输出为 `saved` 与 `ready unknown result_unknown ready`，与计划期望相同。M1–M18 在导出树上全部变红，条数与原型逐条相同。`size origin/main`：代码 298 行（计划约 297）。
- [x] (2026-10-08 00:55 CST) Batch 3 里实现者负责的部分：TD-035–TD-039 逐字追加到技术债务表；控制计划第 31 行与 Batch 2B 段就地标注；回填本计划；`docs/README.md` 状态列。发布前检查在文档提交上跑过：`size origin/main` 代码 298 / 1000、文档约 640 / 1500；`disclosure origin/main`、`workflow-check`、`git diff --check origin/main...HEAD`、`pnpm verify`（1213 / 1213，MVP-0 7 / 7）都 exit 0；`tsc --noEmit` 无输出，包边界 8 / 8；人工五类目过了新增行（无凭据、本机路径、账号信息、内部系统与保密字样，提交身份是仓库既有的 noreply 地址）。
- [x] (2026-10-08 CST，验证者回报，早于下一条) Batch 3 的独立对抗验证（验证者）：在第一轮修复之前的最终树（本地提交，整合后不再存在）上复跑 M1–M18、做探针与差分，出 11 条发现——P2 × 4（单挂载拒绝的错误码与恢复动作变了；路由的身份比对无判别用例；终态接管的路由拒绝路径无用例；多挂载下写尝试账本的目标连接无断言）、P3 × 7（接管路径的锚点门降级无用例；注入表数组语义无用例；TD-038 漏记过期默认行；路由用例只在替身上跑；M6 / M16 条数因写法而异且变异文本未记录；D7 与 issue 验收 2 的字面张力；capabilities 层注释引用 core 路径）。
- [x] (2026-10-08 01:40 CST) 对抗验证发现的处理（实现者；四个代码提交加一个回填提交，后续由协调者整合）：
  - 发现 1（P2，属实）：复现于 256 + 1 项单挂载矩阵，修订前 76 项错误码或恢复动作不同；按根因修复为「先选挂载、再按调用方的顺序过门」，`resolveBinding` 恢复「没有绑定提供能力」；补 S1、S2。修复第一版之后，又用「已登记仓库换连接」的 256 项对照发现缺路由的 conflict 把能力门挤到了后面（252 项错误码不同），改为缺路由时单挂载先过门再报 conflict。
  - 发现 2（P2，属实）：N1（`identity !== undefined`）与 N15（`includes` 匹配）在修订前全绿；补 E7、E8，对应 M19、M20。
  - 发现 3（P2，属实）：N20（路由拒绝时改用第一个 Development 挂载继续供应）全绿；补 E5（终态接管遇到换连接：写前 conflict、新连接零调用、上下文仍是 Failed）、E6（多挂载下的终态接管），对应 M22、M32。
  - 发现 4（P2，属实）：N6（账本取第一个 Development 挂载的 bindingId）全绿；E1 加 `listMutationAttempts` 断言，对应 M21。
  - 发现 5（P3，属实）：N3（接管锚点由写门降为读门）全绿；E5 加「接管时锚点只读被拒、不调 provider」，对应 M23。
  - 发现 6（P3，属实）：N9、N10、N25 全绿；补 I2（其他槽位的数组含空数组被 TypeError 拒绝，单元素数组读回为默认，错误文案含 `development[1]`），对应 M25–M27；M28 钉住空数组语义。
  - 发现 7（P3，属实）：TD-038 的简述与下一步补「过期行可能带 `isDefault = true`」（技术债务表与本计划同步改写）。
  - 发现 8（P3，属实）：E1–E8 全部参数化到替身与 SQLite 两种 Storage（两种 Storage 上结果一致，没有分叉）。
  - 发现 9（P3，属实）：变异表改为逐条给出 old → new 的确切文本，M16 明确为「只展开最后一个」（`slice(-1)`）；条数以最终树重跑为准。
  - 发现 10（P3，部分属实、不改代码）：D7（单挂载未登记仍路由到唯一挂载）与 issue 验收 2 的字面确有张力，D7 与 D9 都标注「可由人类推翻」，开 PR 的描述里必须把它们列为需要人类确认的两个解读；单挂载未登记的路径由既有的懒登记用例钉住（M31：改成拒绝则 98 条变红）。
  - 发现 11（P3，属实）：capabilities 层两段注释改成不带 core 路径的措辞。
- [x] (2026-10-08 02:19 CST) 第二轮独立对抗验证（验证者）的 7 条发现处理完（实现者；两个代码类提交加一个回填提交，后续由协调者整合）：
  - P2 读回路由的 `'read'` 改成 `'write'` 全绿（属实，判别缺口）：补 E9（只读的工作树读，读回仍 Saved、provider 收到一次 `getWorktree`），变异 M33。
  - P3 路由从未用 3 个及以上挂载验证（属实，判别缺口，实现正确）：`twoDevelopments` 泛化为 `developments`，补 E10（三个挂载未登记的歧义）、E11（登记在第三个）、E12（缺路由时第一个挂载缺能力仍是 conflict），E7 让第一个挂载缺能力；变异 M34–M36、M38。验证者指出的 X11（缺路由处 `=== 2`）在两个挂载全能力时不可观察，要靠「第一个挂载缺能力」才分得出，所以 E7、E12 都这样造。
  - P3 注册门里仓库读与工作树读先后无判别（属实）：S2 加一行 `[RR, UN]`、`[WR, UN]` 并比较 `message`（错误码相同，只有文案分得出谁先判）；变异 M37。
  - P3 「单挂载行为不变，唯一例外是 D8」比证据窄（属实，三处都在两棵树上复现）：D8 的范围订正为「换了连接」一类，新增 D19；Purpose、差分表、验收表同步；补 E13 钉住过期续跑；不改代码（conflict 文案点名内部身份是设计有意，见 D19）。
  - P3 首版的验证期望与引用没有就地标 Superseded、引用了整合后会消失的本地提交 SHA（属实）：三处期望与第 14 步加 Superseded 标注，SHA 引用改写成可复现的规则，「评审结论待补」字样删除。
  - P3 开放的人类裁决 D7 / D9 仍要进 PR 描述（属实，不是仓库内的改动）：D18 与本条已记录，PR 描述由协调者在整合推送后更新，列出这两个待人类确认的解读。
  - P3 `mounts.length > 0 &&` 是死条件（属实，等价变异）：删除，不进变异表。
- [x] (2026-10-08 CST，验证者回报，早于下一条) 第三轮独立对抗验证：M1–M38 在最终树上逐条按表复跑全部变红、条数与表一致；单挂载差分、随机路由模糊测试（替身与 SQLite）与 105 种 Registry 组合都与规格零偏差。4 条发现：P2 多挂载下锚点之前的注册门没有判别用例（在第一个挂载上判、或多挂载时整个跳过，全量仍绿）；P3 key 级 fail closed 只在恰好两个对等挂载上钉住；P3 `provisionGit` 的路由拒绝把写尝试记到未被调用的连接上没有断言；P3 D7、D9、D19 仍要进 PR 描述。前三条都是判别缺口，实现正确。
- [x] (2026-10-08 02:56 CST) 最终验收（验收者，两个代码类提交加本回填）：通读 `git diff origin/main...HEAD`，按 issue #219 原文与本计划复核验收 1–9；第三轮前三条发现属实，补 E14、C2 的三个对等挂载、E5 与 E13 的账本断言，对应变异 M39–M42（换回第三轮之前的测试文件时四条都存活，换回之后分别变红）；重构 `routeDevelopment` 的兜底拒绝复用 `unsupportedCapability`（D22）；第四条是 PR 描述事项，不改仓库。复跑：四文件 163 / 163、五文件 170 / 170、全量 1241 / 1241、`tests/mvp0` 7 / 7、包边界 8 / 8、`tsc` 无输出，`size` / `disclosure` / `workflow-check` / `git diff --check` 都通过；M1–M42 整表在 `git archive HEAD` 导出树上逐条变红；R1 与单挂载差分（1280 项）在 `origin/main` 与 HEAD 两棵导出树上复跑，结论与计划一致。导出目录用完已删除。
- [x] (2026-10-08 CST) 协调者建 backup ref 后把 `21ccaca` 之后的本地提交收敛为代码与回填两个提交（见 Decision Log 同日条目），整合前后树逐字节相同、文件集合 `comm` 一致；快进推送；推送后的 head、关闭引用与 checks 以 PR #291 回读为准。
- [x] （被上一条取代，保留原文；Superseded by 上一条与 D23（2026-10-08））整理成交付物级提交（规划 / 代码 / 回填），先建 backup ref 再以精确的 force-with-lease 推送，回读 head、base、checks 与评审线程（draft PR 已在规划提交后开出）；PR 描述列出 D7、D9、D19 三个待人类确认的解读——整合与快进推送已由上一条完成，D7 / D9 / D19 已由人类伙伴裁定保持原样（D23）。

- [x] (2026-10-08 19:30 CST) 评审修复轮（评审修复者；独立评审 5455297771，Singularity-AI-Bot，APPROVED，1 × P2、4 × P3；人类裁决见 D23）：
  - rebase：建恢复锚点 `backup/development-repository-routing-pre-review-rebase`（rebase 前的 `eccfab2`，当时的远端 head），`git rebase origin/main`（`a357ef8`）无冲突，`git range-diff` 三个提交都是 `=`。rebase 之后先跑 `tsc --noEmit`（无输出）与全量 contract / integration / e2e：1350 / 1350（`origin/main` 的导出树 1315 / 1315，加本 PR 的 35 条）、`tests/mvp0` 7 / 7、包边界 8 / 8——main 新增的 Development 能力字段与契约套件（#287、#288）和本 PR 的注入表、Registry、路由兼容，没有运行时失败。
  - P2（多 Development 挂载时 Host 自相矛盾，TD-035 的接手条件不在承接 issue 的验收里）：属实，不是代码缺陷，而是 D14 / TD-035 已登记的过渡状态缺承接。人类裁决 D23：#127 / #142 的决策评论由协调者写（元数据按绑定给出；以「绑定仓库」恢复动作取代 `reapply`）；本计划 `Purpose / Big Picture` 写明「Local Git 与 GitHub」指各管不同的仓库、同一仓库的并列引用归 #127；TD-035 的「下一步」改写指向 #127 / #142 的评论与验收。
  - P3（K3 接线没有机械护栏，并集预演基线过期）：属实。人类裁决 D23：合并顺序 #290 → #291 → #292，接线与正例由 #292 承担（Superseded by D27，2026-10-08 第二轮：接线与正例改由 #297 承担，#292 不再等本 PR），本 PR 不接线。写进 D23、K3 条目、TD-037 的「下一步」与验收第 10 行；I1 的缺口断言保留，用例名与注释写明接线前后都成立、不是接线的护栏；预演基线见 `Surprises & Discoveries`。
  - P3（歧义与缺路由的恢复动作是 `reapply`，文案把内部 issue 号当指引）：属实。D6 的错误码与恢复动作保持原样（D23）；两条文案改成用户能执行的动作且不含 issue 号，E2、E3 断言新文案并禁止 `#\d+`，M43、M44 变红（D24）。Superseded by 第二轮修复（D25）：D24 只去掉了 issue 号，文案里的动作仍然不存在，已重写。
  - P3（状态行与「未做」仍写整合推送待做，行数是没有观察时刻的易失值）：属实。状态行、「未做」与规模段改写成事实并就地标 Superseded，行数改成回读命令加观察（树标识）。
  - P3（README 索引状态列过期）：属实。评审已 APPROVED 且只剩 P2 / P3，本计划随 PR 归档：移到 `docs/exec-plan/completed/`，索引移到 Completed 表，全仓引用（控制计划两处、技术债务表五行、本计划内的副本）改为 completed 路径；评审记录写入 `docs/review/pr-291-mmp-review.md`。
  - 复跑与变异：观察基线 `origin/main@a357ef8`，代码内容由 `git rev-parse HEAD:packages HEAD:tests` 标识（`f462e77`、`b7b410b`，整合提交不改变这两个值）；命令与结果见 `Artifacts and Notes` 的「评审修复轮的复跑」。
- [x] (2026-10-08 CST，第二轮) 第二轮评审（Singularity-AI-Bot，5 × P3）的修复（修复者在 `.worktrees/development-repository-routing` 内工作；先建恢复锚点 `backup/development-repository-routing-pre-rr2`（`cbc767b1`）；本地小提交，后续由协调者整合进现有三个提交；不 push、不写 GitHub）：
  - P3 两条 conflict 文案许诺的动作今天都不存在：属实。评审者的探针 `texts.mjs` 在 `git archive cbc767b1` 的导出树上复现——`CoreCommands` 只有 `bootstrapWorkspace / startWork / cancelExecutionRun / confirmRelation / rerunPipeline / applyPlanningStatus`，没有绑定仓库的命令；`Storage.putRepository` 对「同 (工作区, id) 换外部身份」抛 `repository mount already points at another external identity`（契约 `tests/contract/suites/storage-execution.js` 钉住，替身与 SQLite 一致）；探针里「只挂载拥有仓库的连接开始一次、再挂回全部」那条路走得通。红：先改 E2、E3 的期望并新增 E15，六条失败（E2、E3、E15 各在两种 Storage 上），原因都是文案；绿：改 `development-route.ts` 的两条文案后，四文件命令 165 / 165。新文案只写今天走得通的步骤，并由用例逐字执行（E15 执行歧义的三步，E3、E7 的末段在被拒之后把原连接挂回来）；变异 M43–M48 证明断言有判别力（D25）。
  - P3 TD-035 写「已补验收」而两个 issue 的验收框都没改：属实。先把 TD-035 与交接表订正为事实（只有决策评论，#127 issuecomment-6058141177、#142 issuecomment-6058141929，#142 的评论没有「按选中仓库的路由结果判定可用性」），验收是否添加留给人类；随后协调者转述人类裁决「Add both (Recommended)」，两个 issue 已各加一条验收框，TD-035 写成事实（D26）。
  - P3 K3 交接只记在 #291 这一侧：属实。协调者转述人类裁决「Separate small PR (Recommended)」：接线与正例改由新 issue #297 承担，#221 已写决策评论 issuecomment-6060231866，#292 不再等本 PR（D27）；D23、K3 条目、TD-037、验收第 10 行、交接表与 I1 用例注释就地更正。
  - P3 规格里 `routeDevelopment` 的代码副本还是旧文案：属实。就地标 Superseded，指向 D24 / D25，现行文案的句尾写在标注里，其余以代码为准。
  - P3 PR 描述过时（回滚点名的提交、ExecPlan 路径、计数、待确认项、闭环、「控制计划验收第 5 行」）：PR 描述由协调者改，本轮不动。评审记录里与当前提交不符的计数、结论与待办就地更正；「第 5 行」核对为：控制计划验收表里「两个 Development 实现可共存且路由明确」是 `| 4 |` 行（`sed -n 255p docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`），本计划验收表里与它对应的是第 5 行，仓库文档写的都是「控制计划验收第 4 行」，写成「控制计划验收第 5 行」的只在 PR 描述里。
  - 复跑与变异：命令与数字见 `Artifacts and Notes` 的「第二轮评审修复的复跑」。
- [x] (2026-10-08 CST，第三轮) 第三轮评审（Singularity-AI-Bot，4 × P3，其中 1 条非机械）的修复（修复者在 `.worktrees/development-repository-routing` 内工作；先建恢复锚点 `backup/development-repository-routing-pre-r3`（`482c5dc3`，第二轮修复后的 head）；本地小提交，后续由协调者整合进现有三个提交；不 push、不写 GitHub）：
  - P3 「只写今天走得通的步骤」只靠禁词表守：属实。评审者的 `mutate3.mjs` 在 `git archive 482c5dc3` 的导出树上复现——Y3（缺路由文案句尾追加「，或把它改挂到当前的 Development 连接」，即第二轮被 `Storage.putRepository` 拒绝的承诺换个说法）与 Y4（歧义文案句尾追加「；也可以在设置里为它选一个连接」）在四文件命令里都存活（165 / 165）。E2、E3 各对一条文案从判别措辞到句尾的整段动作加 `$` 锚定的相等断言（`AMBIGUOUS_ACTION`、`MISSING_ROUTE_ACTION`），禁词表保留；基线保持 165 / 165，Y3、Y4（变异表 M49、M50）各红 2 条，M47、M48 照样变红（D28）。
  - P3 歧义文案让用户做一次本版本撤不回的登记，却没说（非机械；协调者决定补一句，写法对齐缺路由文案）：属实。评审者的探针 `steps.mjs` 在 `482c5dc3` 与修复后的导出树上结果相同，替身与 SQLite 一致——两个连接都有 repo-alpha，照文案只挂 dev-a 开始工作一次后，想换到 dev-b 得到 `conflict`。红：先改 E2、E15 的期望，165 条里 4 条失败（E2、E15 各在两种 Storage 上），原因都是文案；绿：改 `development-route.ts` 的歧义文案后 165 / 165。新文案在步骤之前补「也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：」，措辞与缺路由文案一致，仍无 issue 号、不承诺不存在的命令；E2、E15 同步，M51 去掉提示后红 4 条（D28）。
  - P3 变异表下的说明（M12 119 条、M31 102 条）与方法段落（42 条、163）还是旧数字：属实。改为 121 条、104 条与 51 条、165（以最终复跑为准）。
  - P3 Surprises 里的正例还写着「由接线方 #292 带（D23）」：属实。就地更正为「由接线方带（D23 原定 #292，Superseded by D27：更正为 #297）」。
  - 复跑与变异：命令与数字见 `Artifacts and Notes` 的「第三轮评审修复的复跑」。

## Surprises & Discoveries

- **重组后换连接会把 Ready 判成 Failed，并向新连接发请求**（γ 首先报告，本计划在起点复现，命令见 `Artifacts and Notes` 的 R1）：`verifyExistingWorktree` 按 key 解析，换连接后问的是新连接，新连接当然答 `not_found`，于是被当成「工作树确定不存在」。这既违反验收 1（新连接收到了不属于它的请求），也违反不变量 7（把「问错了对象」当成权威事实写进记录）。路由按持久化事实选挂载后，它自然变成「缺路由 → 无法确认」。
- **迭代规划 D6 的写入范围不对**：D6 给 #219 列的是 `packages/core/src/{registry,context}.ts` 与 `packages/capabilities/src/{registry,development-provider}.ts`。实际不需要改 `context.ts`（注入表类型定义在 `registry.ts`，`createContext` 原样调 `collectBindings`），也不需要改 `development-provider.ts`（外来引用义务已由契约套件钉住）；需要改的是 `start-work.ts`、`git-provisioning.ts` 与新文件 `development-route.ts`。D6 据此写的「#220 + #199 排在 #219 之后」作废，由 PR-A 的计划记录（跨 PR 契约的拓扑说明）。
- **Storage 的降级语义正是「读回角色」这条验收的风险点**：同域写第二个默认会静默降级第一个，内存 Registry 与库里的行于是不一致。所以多挂载时必须全部写成非默认；实测把旧默认改写成非默认能被如实读回，重组从 1 个到 2 个不需要额外清理。
- **替身种子让误路由「成功」**：两个替身都种了 `repo-alpha`，所以只看 `writeState` 抓不到误路由。路由用例必须逐次记录调用和引用。原型阶段 M17（读回用工作区第一个仓库路由）第一次存活，原因是 E1 只对第一个登记的仓库做了读回；改成两个仓库都读回后变红。
- **规模远小于规划时的 `L`**：原型代码约 297 行（实现约 171），按迭代规划的口径属于 `M`。
- **「单挂载行为不变」首版并不成立，对抗验证用 256 项能力组合抓到了**：首版实施时只比较了 `not_supported` 对 `not_supported` 的三个组合，据此写下「错误码都还是 `not_supported`、恢复动作不变」，并把文案差异留给评审者裁定。这个断言为假：(1) 路由把锚点 `worktree.create` 的门放在三个注册门之前，所以两个能力同时被拒时点名的是锚点，错误码与恢复动作也会变（例如 `branch.create` 只读加 `worktree.create` 不可用，原为 `permission_denied` / `fix_permission`，首版为 `not_supported` / `manual_execution`）；(2) `resolveBinding` 把「挂载没有声明该 key」说成「当前不可用」，原来是「没有绑定提供能力」。根因是路由同时承担了「选挂载」与「过锚点门」。修复与证据见 D16 和 `Artifacts and Notes` 的「单挂载差分」；教训是比较要覆盖整个输入空间（四个注册 key × 四种状态），不能只挑自己想到的几个。
- **修复的第一版又漏了「已登记仓库换连接」**：把选挂载与过门拆开之后，缺路由的 conflict 仍然排在能力门之前，单挂载在「绑定 id 变了、同时某个注册能力被拒」的组合里（256 项里的 252 项）错误码也不同。用同一套矩阵在「已登记仓库换连接」下对照才发现；改为缺路由时单挂载先过门再报 conflict 后，252 项逐项相同，其余 4 项（能力全部可用）只差新连接不再收到 `getRepository`（D8 的内容）。
- **「没有挂载」的专用分支成了等价代码**：缺路由改为「单挂载先过门」后，没有任何挂载时第一道门本来就先于 conflict 报「没有绑定提供能力」，原来包住选挂载的 `mounts.length > 0` 判断让变异 M18 存活，已删除并整体去缩进（行为由 E3 末段与 S1 钉住，M18 改为「缺路由的 conflict 排在门之前」）。
- **缩小组合后 Storage 读回会留下过期的默认行**（对抗验证的探针，替身与 SQLite 一致）：依次组合 `[c]`、`[a, b]` 后，读回里 `c` 仍是默认，Registry 里 `a`、`b` 全是非默认。路由只看 Registry，不会读错连接，影响限于 `listProviderBindings` 的读回；已写进 TD-038。
- **第二轮对抗验证的三个判别缺口都是「用例没覆盖到的输入形状」**：Registry 的契约用例（C1）明确允许 N ≥ 3 个对等挂载，路由用例的辅助函数却只造两个，于是歧义判断写成 `=== 2` 全绿；读回路由的 `'read'` / `'write'` 参数只被「路由拒绝」与「选挂载」的用例间接碰到，没有用例让两种模式给出不同结果（要靠只读的工作树读才分得出，E9）；注册门里仓库读与工作树读的先后只有「错误码相同、文案不同」才分得出，S2 原来的五行没有一行同时拒绝两者。教训与第一轮相同：断言要覆盖整个输入空间（挂载数 × 能力状态 × 先后），不能只覆盖自己想到的形状。
- **「缺路由先于挂载的能力门」在全能力的挂载下不可观察**：缺路由时多个挂载「直接 conflict」与「取第一个挂载过门后再报 conflict」，两个挂载都全能力时结果相同，只有排在第一的挂载缺能力时，后者才会变成 `not_supported`（M35、M36）。E7、E12 因此都让第一个挂载缺工作树创建能力。
- **「换连接」一类的差异比 D8 写的宽**（第二轮对抗验证，两棵树对跑复现）：D8 只写了读回与终态接管，实际凡是已登记仓库的连接换了之后开始工作的路径都变了——新连接 `getRepository` 失败的错误码统一成 `conflict`；过期续跑与终态接管同走 `provisionGit` 的路由，在 `origin/main` 上会向新连接发 `listBranches`、`createWorktree` 并得到 `not_found`；conflict 文案点名内部身份 id、去掉了「多 binding 路由见 #219」。三者方向都比 `origin/main` 安全，范围订正见 D8 与 D19。
- **第三轮的判别缺口仍是「输入形状」问题，只是换到了别的维度**（第三轮对抗验证，最终验收者复现）：第二轮补了「三个挂载」，却只用在路由的选挂载上，key 级解析的契约用例 C2 仍只造两个对等挂载；多挂载用例里被拒的能力全是锚点 `worktree.create`，锚点之前的三个注册门只在单挂载（S1、S2）上被拒过，于是「注册门在第一个挂载上判」与「多挂载跳过注册门」都全绿；账本断言只覆盖成功的写入，没有覆盖「路由拒绝时不记写尝试」。补法都是在已有用例里多放一个被拒的能力或多断言一张表，不需要新机制。以后补判别用例时按「挂载数 × 哪一道门被拒 × 结果的每个可观察通道（调用、上下文、账本）」逐格列表，而不是只补上一轮点名的那一格。
- **多 Development 挂载时 Host 对同一工作区说两种相反的话，而接手条件不在承接 issue 的验收里**（独立评审 P2，评审者用探针在 head `eccfab2` 与测试合并上复现）：两个 Development 挂载、仓库已登记时，`commands.startWork` 成功，`queries.getWorkspaceMetadata()` 却把全部 `development.*` 报成 `unavailable`（经 `packages/controller/src/queries.ts` 进快照，ui-model 的 `capability-access.ts` 据此禁用开始工作入口），交付投影同时 degraded、只剩 tracks / has_worktree 两跳。这正是 D14 / TD-035、TD-037 已登记的过渡状态；评审的新事实是 #127（只要求「each binding's effective access」）与 #142（只要求「only repositories bound to the workspace and only execution options whose providers are available」）的验收原文都不含「Development 可用性按路由到的挂载判定」。当前不阻塞，因为 `apps/*` 里没有 `composeCore` 调用方；处置是人类裁决（D23），不是改代码（K3 不让本 PR 动 `queries.ts`）。
- **I1 的谱系缺口断言在接线前后都成立，所以它不是接线的护栏**（独立评审 P3）：那个场景没有登记仓库，key 级解析 fail closed 与 `routeDevelopment` 的歧义拒绝给出同一个缺口。真正能区分「接上了」与「没接上」的是已登记仓库的正例，它由接线方带（D23 原定 #292，Superseded by D27：更正为 #297）；本 PR 只把这一点写进用例名与注释，不预埋代码。
- **rebase 到 `a357ef8` 无冲突，用例数恰好是 main 加 35**：`origin/main` 在评审期间合入了 #286、#288、#295、#287、#289 等（#287 改 `development-provider.ts`，#288 改 `tests/contract/suites/development.js`，本 PR 都不碰）；rebase 之后全量 1350 / 1350，`origin/main` 的 `git archive` 导出树上同一命令是 1315 / 1315，差正好是本 PR 的 35 条。评审的四分支并集预演基于更早的 main（`7a46a27`、`ce423d9`），其数字（1333、1383）随 main 前进而过期，以这里的回读命令重算为准。
- **歧义与缺路由的拒绝是确定性的，`reapply` 对它们没有意义**（独立评审 P3）：在绑定仓库的命令出现之前，怎么以新 revision 重放都得到同一个 conflict；`projectError` 不支持按调用点覆盖 recovery，沿用 `conflict` 就只能是 `reapply`。D6 已把这个代价列为可由人类推翻；人类裁定保持原样，「绑定仓库」恢复动作随 #127 / #142（D23）。本轮只把文案改成用户能做的动作，不把 issue 号当指引（Superseded by 下一条与 D25：这一版的动作仍然不存在，第二轮评审重写）。
- **D24 去掉了 issue 号，却没有核对文案里的动作存在不存在**（第二轮评审，探针 `texts.mjs` 复现）：第一轮 P3 要的是「文案写成用户能执行的动作」，D24 只做了「去掉 issue 号」，并用 `doesNotMatch(/#\d+/)` 钉住——这条断言只能证明没有出现 issue 号，证明不了动作走得通。文案里的「把仓库绑定到其中一个连接」没有命令，「重新绑定到当前连接」则被 `Storage.putRepository` 拒绝，而 E3 还把这句话钉成了断言。教训：文案里的每一个动作都要有一条用例逐字执行一遍（E15，E3 与 E7 的末段），并句尾逐字锚定整段动作（E2、E3 的 `$` 断言，D28）。Superseded：第二轮写的是「反向钉住『不许诺』的词（E2、E3 禁止『绑定仓库』『重新绑定』）」，可禁词表只挡得住已知的词，挡不住换个说法重新许诺，也挡不住在动作后面再追加一个不存在的动作（第三轮 Y3、Y4）。
- **「原来的 Development 连接挂回来」必须是同一个实现**：E7 的夹具起初把未挂载连接的锚点写成 `implementationKey: 'old'`，挂回替身时 Storage 以 `provider binding id already points at another implementation` 拒绝——锚点按绑定 id 锁定实现键。这正是文案里「原来的」连接的字面含义（同一个实现回到同一个绑定 id）；夹具改用替身的实现键 `harness.fake`，不是实现缺陷。
- **增加走法用例会改变既有变异的红集合**：E15 与 E3、E7 的恢复步骤让 12 条既有变异多红了用例（例如路由选错挂载时 E15 的第三步也会红），表里的「应变红」与「实测」同步更新；没有变异因此变绿。
- **禁词表守不住「在动作后面再追加一个动作」**（第三轮评审，`mutate3.mjs` 的 Y3、Y4 复现）：D25 说 E2、E3「反向钉住『不许诺』的词」，可实际的护栏是正向 `match` 的动作片段，加一张 `doesNotMatch(/#\d+|绑定仓库|重新绑定…/)` 的禁词表，两者都不锚定句尾。Y3（缺路由文案句尾追加「，或把它改挂到当前的 Development 连接」，与第二轮被 `Storage.putRepository` 拒绝的承诺同义）和 Y4（歧义文案句尾追加「；也可以在设置里为它选一个连接」）都避开了禁词，四文件命令 165 / 165 全绿。教训：守一条「动作 + 判别措辞」的整段文案，要用句尾锚定的相等断言，禁词表只能当补充；现在 E2、E3 各有一条（D28）。
- **歧义文案让用户做的是一次撤不回的登记，却没有事先说**（第三轮评审，`steps.mjs`；`482c5dc3` 与修复后的树上结果相同，替身与 SQLite 一致）：两个连接都能服务同一个仓库时（Local Git 管检出、GitHub 开 PR 正是这个场景），按文案只挂其中一个开始工作一次，登记就落在它身上；之后只挂另一个、想换过去，得到「绑定 id 变了」的 conflict，Storage 端口没有删除或改挂仓库挂载的方法。这个事实缺路由文案本来就如实写着（「本版本还不能把已登记的仓库改绑到别的连接」），可它出现在事后的拒绝里，做选择时看到的歧义文案没有。D28 在歧义文案的步骤之前补了同一措辞的提示。目前没有生产路径组装多个 Development 挂载（`apps/*` 里没有调用 `composeCore` 的地方），今天不会有用户撞上；绑定仓库的命令出现后（#127），这句提示和两条文案的动作要一并重写。
- **时间戳**：本计划 Batch 1–3 的 `Progress` 取实现者会话 `date` 的本地时间（CST），早于规划提交条目里记录的 01:35；两处时钟不是同一来源，以提交顺序为准。

## Decision Log

| 日期 / 作者 | 决策与理由 |
|---|---|
| 2026-10-08 / Claude（定稿评审） | **D1 路由来源是持久化事实**：`RepositoryRecord` → 外部身份 → `bindingId`；否决 γ 的组合时路由表。理由：避免同一事实的第二个权威源（`AGENTS.md` §2）；重启后无需额外状态；R1 由构造关闭。 |
| 2026-10-08 / Claude | **D2 注入表用联合类型**：`development?: DevelopmentProvider \| readonly DevelopmentProvider[]`，单个等于单元素数组，空数组等于没有挂载；否决「永远数组」与「另开槽位」。理由：单个不是保留旧语义的兼容路径，两种写法在 `mountsOf` 一处归一、语义相同；空数组不报错，是为了 #132 过滤掉全部不可用挂载时不让整个组合失败（α 原稿是拒绝空数组）。可由人类在 PR 评审时推翻（2026-10-08 人类伙伴裁定保持原样，D23）。 |
| 2026-10-08 / Claude | **D3 默认等于 key 级解析的目标**：Development 唯一挂载是默认，多个时全部非默认，Registry 校验「有默认 ⟺ 挂载数为 1」；否决 β 的「一律 routed」与 `BindingRole` 枚举。理由：K3 要求单挂载行为不变（读回仍是默认）；Storage 的降级语义要求多挂载时不写默认；枚举没有消费者。代价：挂载的角色随同域挂载数变化，重组时由 upsert 改写（I1 钉住）。可由人类在 PR 评审时推翻（2026-10-08 人类伙伴裁定保持原样，D23）。 |
| 2026-10-08 / Claude | **D4 key 级解析 fail closed**：非 Execution 域有两个及以上启用挂载时，对该域所有 key 返回 undefined，不按「唯一声明者」放行。理由：能力子集不是归属事实（不变量 5）。 |
| 2026-10-08 / Claude | **D5 路由键是仓库**：capability key 只用于在路由到的挂载上过门、作锚点和写文案；结果携带该挂载下的仓库引用；一次操作只路由一次，其余 key 用 `gateBinding`。「一个仓库并列持有多个连接的引用」不在本 PR，由 #127 写入并只改 `routeDevelopment` 的内部。理由：#127 的验收拥有这条事实及其写入形状，栈底只写自己的事实；签名带 key、返回引用，所以 #235 / #233 的调用点不必返工。 |
| 2026-10-08 / Claude | **D6 拒绝语义复用既有错误码**：歧义与缺路由为 `conflict`，没有挂载、缺能力为 `not_supported`，只读的写为 `permission_denied`；不新增 `ProjectErrorCode`。理由见「拒绝语义」。可由人类在 PR 评审时推翻（替代方案：新码加「绑定仓库」恢复动作，随 #142 一起做）。人类伙伴 2026-10-08 裁定本 PR 的错误码与恢复动作保持原样，「绑定仓库」恢复动作取代 `reapply` 随 #127 / #142 做（D23）；评审修复轮只改了拒绝文案（D24）。 |
| 2026-10-08 / Claude | **D7 单挂载工作区的未登记仓库仍隐式路由到唯一挂载**，并由开始工作懒登记（现状）。理由：唯一候选不是「取第一个」；改成必须先登记会让开始工作等 #127。懒登记与 #127 的绑定命令将成为两个写者，登记 TD-039。可由人类在 PR 评审时推翻（2026-10-08 人类伙伴裁定保持原样，D23）。 |
| 2026-10-08 / Claude | **D8 读回的路由拒绝判为「无法确认」**（`definite: false`：保留 Ready、报 Unknown），不再把「问错了连接」得到的 `not_found` 当作工作树确定不存在。这是单挂载工作区里唯一有意的行为变化：Development 绑定 id 变了之后，已 Ready 的上下文从 Failed 变为 Unknown；终态接管时 `provisionGit` 也改为 `conflict`，不再向新连接建分支。理由：验收 1、不变量 7。与 K3「单挂载现有行为不变」的字面冲突已在回复协调者时提出。**范围订正（2026-10-08，第二轮对抗验证）**：不止读回与终态接管——已登记仓库的 Development 连接换了之后，开始工作的全部路径（新工作项、终态接管、过期续跑）都改为写前 `conflict`、新连接零调用；差异清单与理由见 D19。 |
| 2026-10-08 / Claude | **D9 不改 `packages/capabilities/src/development-provider.ts`**。issue Scope 点名它，指的是「路由面」；路由放在 core。外来引用答 `not_found` 的义务已由 `tests/contract/suites/development.js` 钉住，PR #287 正在改这个文件（K3）。人类伙伴 2026-10-08 裁定保持原样（D23）。 |
| 2026-10-08 / Claude | **D10 不写新 ADR**，K6 预留给本 PR 的 ADR-0013 不使用。理由：不新增权威源，不改 schema，ADR-0006 的端口语义（每域至多一个默认、写新默认降级旧默认）原样成立。若人类要求，可补一份 `Proposed` 的 ADR-0013；采纳由人类决定。 |
| 2026-10-08 / Claude | **D11 `routeDevelopment` 放新文件，不从 `packages/core/src/index.ts` 导出**。理由：消费者都在 core 内部；单独文件让 #127 只改一处；不与 PR-C 的 `index.ts` 改动冲突。 |
| 2026-10-08 / Claude | **D12 证据层级**：多挂载用例里「仓库属于哪个连接」经 Storage 端口种入（旁证），路由本身经 `composeCore` + `commands.startWork` 这个生产入口验证；#127 落地后改走命令（TD-038）。 |
| 2026-10-08 / Claude | **D13 不新增测试文件**：契约进 `capabilities-keys`，角色读回进 `provider-binding-registration` 的 `SCENARIOS`（两种 Storage 都跑），路由进 issue 点名的 `tests/e2e/start-work.test.js`。 |
| 2026-10-08 / Claude | **D14 不改 `queries.ts` 的工作区元数据**（K3，PR-D 在改）：多挂载工作区的元数据会把 `development.*` 报成 `unavailable`，UI 的开始工作入口被禁用；#127 之前没有生产路径组装出两个 Development 挂载，接受为过渡状态，登记 TD-035。可由人类在 PR 评审时推翻（2026-10-08 人类伙伴裁定保持原样，D23）。 |
| 2026-10-08 01:35 CST / 协调者（开发账号 SingularityKChen） | 规划提交 `21ccaca` 推送后开 draft PR #291（`closingIssuesReferences` = #219），把 #219 的 Project 10 `Status` 由 `Todo` 置 `In Progress`、`ExecPlan` 文本字段写本计划路径（机械回填）。依据：`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md` Decision Log 的 H3 行（人类批准迭代 5–6 的条目在开 draft PR 时由 agent 置 In Progress），写入前已回读原文；回读 `closedByPullRequestsReferences` = #291、`Status = In Progress`。撤销：`Status` 写回 `Todo`、清空 `ExecPlan`。另：协调者采纳定稿评审对 K3 的两条补充——PR-C 的缝函数返回 `{ binding, repository }`；接缝的一方为「已登记仓库的多挂载谱系读」补一个正例。 |
| 2026-10-08 / Claude（实现者） | **D15 实施期取舍**：(1) `mountsOf` 的数组元素槽位名只对 `development` 写成 `development[i]`，其他槽位传数组时槽位名保持原样（原型把它们写成 `execution[0]`，错误文案会指向不存在的元素）；(2) `gateOn` 的参数类型用 `registry.ts` 已导出的 `CapabilityResolution`；(3) 变异驱动脚本与导出目录是运行态内容（`AGENTS.md` §3），不入库，结果写在 `Artifacts and Notes`；(4) Batch 1、2 的 `Progress` 与证据集中回填在第三个提交，不随各批代码提交（整合提交时回填本来就单独成提交）；(5) 单挂载的两处文案差异首版不改代码——该取舍已被 D16 取代：对抗验证证明错误码与恢复动作也变了，已修复。 |
| 2026-10-08 / Claude（实现者，修复对抗验证发现） | **D16 路由先选挂载、再按调用方的顺序过门**：`routeDevelopment(source, repositoryId, key, mode, earlier = [])`，`earlier` 里的门先判、锚点 `[key, mode]` 最后；`resolveBinding` 对未声明的 key 恢复「没有绑定提供能力」；缺路由时只有一个挂载就先按它过门、过了再报 conflict，多个挂载直接 conflict；没有挂载时第一道门先于一切 conflict 报缺能力。否决：(a) 让路由只返回挂载、由每个调用点自己 `gateBinding`——每处都要重写「没有挂载时按第一道门报缺能力」的特例；(b) 保留锚点先判并把差异记为已知偏差——与 Global Constraints「单挂载行为不变，唯一例外是 D8」的字面不符，而且错误码也变了。理由：该约束是协调者的跨 PR 契约 K3，且用 257 + 256 项差分可以直接证明；代价是路由签名多一个可选参数，#235 / #233 的单 key 调用点不受影响。 |
| 2026-10-08 / Claude（实现者） | **D17 路由用例参数化到两种 Storage**：E1–E8 在替身与 SQLite 上各跑一遍，不新增测试文件（测试文件集合不变，`start-work-sqlite-registration.test.js` 保持不改）；SQLite 文件用 `mkdtempSync` 建在系统临时目录并在 `after` 里清理，与既有 SQLite 用例同一做法。理由：路由只读 Storage，两种实现的读回必须选出同一个挂载；对抗验证手工在 SQLite 上复跑没有分叉，这里把它入库。 |
| 2026-10-08 / Claude（实现者） | **D18 D7、D9 留给人类确认，不改代码**：D7（单挂载、仓库未登记时隐式路由到唯一挂载并由开始工作懒登记）与 issue #219 验收 2「缺路由或歧义返回结构化拒绝，不取第一个注册者」有字面张力——唯一候选不是「取第一个」，但这是一个解读；D9（不改 `development-provider.ts`，路由放在 core）与 issue Scope 点名该文件也有出入。两者都已在本计划记录理由并标注「可由人类在 PR 评审时推翻」；开 PR 的描述必须把它们列为需要人类确认的两个解读。Superseded by D23（2026-10-08）：人类伙伴已裁定 D2 / D3 / D6 / D7 / D9 / D14 / D19 保持原样，它们不再是待确认的解读。 |
| 2026-10-08 / Claude（实现者，第二轮对抗验证） | **D19 「换了连接」的差异整体归入 D8，不改代码**：已登记仓库的 Development 连接换了之后，与 `origin/main` 逐项对照的差异是三类：(1) 新连接不再被问 `getRepository`，所以它的 `not_found` / `unavailable` / `permission_denied` 不再出现，一律 `conflict`（`reapply`、不可重试）——那些失败码描述的是「问错了对象」，不是仓库的真实状态，原来的 `unavailable`（可重试）还会诱导调用方对着错误的连接重试；(2) 终态接管与过期续跑不再向新连接发 `listBranches` / `createWorktree`（原为 `not_found`，而且外部调用已经发生），改为写前 conflict；(3) conflict 文案点名仓库挂载的外部身份（`registered.externalIdentityId`）并去掉「多 binding 路由见 #219」：指引已经过时，身份 id 让多挂载下的 conflict 多一条诊断线索（`origin/main` 在「身份存在但不同」的分支也打印身份 id），它是内部身份 id，不是凭据或外部系统信息。三者方向都比 `origin/main` 安全（零外部调用、更早失败）。否决：为了文案逐字相同去掉身份 id——文案里的指引本来就必须改，而去掉身份 id 会让诊断线索变少。可由人类在 PR 评审时推翻（要逐字沿用旧文案，只改 `development-route.ts` 缺路由的那一处模板字符串，E3 / E7 / E12 匹配的是「绑定 id 变了」，不受影响）（2026-10-08 人类伙伴裁定保持原样，D23）。评审修复轮在缺路由 conflict 文案句尾补了用户能执行的动作（D24），下面差分里 HEAD 一栏引的是补写之前的文案。 |
| 2026-10-08 / Claude（实现者，第二轮对抗验证） | **D20 路由用例覆盖的输入形状**：辅助函数 `twoDevelopments` 泛化为 `developments`（`c` 给了才有第三个挂载），三挂载用例 E10–E12 与 E13 各在两种 Storage 上跑；E7、E12 让排在第一的挂载缺工作树创建能力，因为缺路由时「多个挂载直接 conflict」与「取第一个挂载过门后再报 conflict」在全能力挂载下结果相同（M35、M36）；S2 比较 `message`，不只比 `code`。否决：给 `routeDevelopment` 另写按挂载数参数化的单元测试——路由只经 `composeCore` + `commands.startWork` 这个生产入口验证（D12），不增加测试文件（D13）。 |
| 2026-10-08 / Claude（实现者，第二轮对抗验证） | **D21 删除 `providerRegistry` 里 `mounts.length > 0 &&` 的死条件**：没有挂载时 `(defaults === 1) !== (mounts.length === 1)` 是 `false !== false`，本来就不抛；删掉后行为不变（等价变异，不进变异表），读者不必再怀疑「0 个挂载会抛吗」。 |
| 2026-10-08 / Claude（最终验收者） | **D22 最终验收的取舍**：(1) 第三轮的三条判别缺口只补用例，不改实现——E14 用一条用例循环两个能力（分支创建是写门、工作树读是读门），而不是拆成两条；C2 沿用原标题，只把对等挂载数参数化为两个与三个；E5、E13 的账本断言只比幂等键，因为要证明的是「被拒的那个键没有写尝试」。(2) 唯一的实现改动是 `routeDevelopment` 的兜底拒绝复用 `unsupportedCapability(key)`（原来手写了逐字相同的错误码与文案，同一条拒绝两处出处）；行为不变，由全量与 M1–M42 整表复跑确认。(3) 不合并 E7 与 E12 这类结构相近的用例：它们分别钉住两个与三个挂载下的不同变异（M36、M35），合并会改用例名并让变异表的「应变红」失去指向。(4) 不新增 D7 / D9 / D19 的结论：三者仍是待人类确认的解读，由协调者写进 PR 描述。 |
| 2026-10-08 / 协调者（主会话） | **整合为三个交付物级提交，不改写已推送的规划提交**：已推送的 `21ccaca` 原样保留；其后全部本地提交按文件归属收敛为「代码交付物」（`packages/`、`tests/`）与「证据回填」（本计划、控制计划、债务表与索引）两个提交，推送是快进，不需要 force-with-lease。Batch 1 与 Batch 2 的代码在三轮对抗验证的修订里交错（同一组测试文件），不再按批次拆成两个代码提交；本 PR 是一个闭环，整体回滚。可由人类在 PR 评审时推翻。 |
| 2026-10-08 18:40 CST 前后 / 人类伙伴（在协调者会话里经一次四问提问作答；协调者记录，评审修复者回填） | **D23 合并顺序与 K3 接线方（人类裁决）**（**更正（D27，2026-10-08）**：接线方与合并顺序里涉及 #292 的部分已更正——接线与正例改由 #297 承担，#292 不再等 #291；其余内容不变）：问「#291 的交接与合并顺序」，选定的原话是「#290 → #291 first, #292 does the wiring (Recommended)」。执行：本 PR 在 #290 之后、#292 之前合并；契约 K3 的路由缝接线（`developmentReadBinding` → `routeDevelopment`）与 #289 分页的适配都由 #292 在 rebase 到 main 时承担；#292 必须带一条「已登记仓库的多挂载谱系读只进路由到的挂载」的正例，并且它在缝没接上时变红；TD-035 与 D6 由协调者在 #127 / #142 写决策评论（#127 / #142：元数据按绑定给出；以「绑定仓库」恢复动作取代 `reapply`）。**D2 / D3 / D6 / D7 / D9 / D14 / D19 保持原样**（D6 的错误码与恢复动作不变）。同一次提问里的其余三问是 #290 的事，不在本计划。TD-035、TD-037 的「下一步」已按此改写。理由与证据：独立评审指出接线没有机械护栏（I1 的缺口断言在接线前后都成立）、TD-035 的接手条件不在 #127 / #142 的验收里。 |
| 2026-10-08 / Claude（评审修复者） | **D24 评审修复轮的取舍**：(1) 歧义与缺路由两条 conflict 的文案改成用户能执行的动作（Superseded by D25：这一版只去掉了 issue 号，动作本身仍然不存在，第二轮评审重写），不再把 `（绑定仓库，#127）` 这类内部 issue 号当指引；错误码与恢复动作不变（D23）；E2、E3 断言新文案并禁止 `#\d+`，M43、M44 证明断言有判别力。保留「不取第一个注册者」「绑定 id 变了」等判别措辞，所以既有的匹配不改。(2) 本 PR 不做 K3 接线（D23 由 #292 承担；D27 更正为 #297），不为接线预埋代码；护栏的责任写进 D23、K3 条目、TD-037 与验收第 10 行，I1 的断言和用例名写明它不是护栏。(3) 评审已 APPROVED 且只剩 P2 / P3，本计划随 PR 归档（沿用「P2 / P3 先批准、再修复归档」的做法），归档后合并仍由人类决定。(4) 规模、行数等易失值改成回读命令加观察（树标识），不再写成事实。(5) rebase 无冲突，不改写任何已有提交的内容；提交序列由协调者整合。 |
| 2026-10-08 / Claude（第二轮评审修复者） | **D25 第二轮评审的取舍**：(1) D24 只去掉了 issue 号，文案许诺的动作仍不存在：`CoreCommands` 没有绑定仓库的命令，「把仓库重新绑定到当前连接」会被 `Storage.putRepository` 以 `repository mount already points at another external identity` 拒绝；两点都在 `cbc767b1` 的导出树上用评审者的探针复现。(2) 文案只写今天走得通的步骤：歧义（未登记、多个挂载）改为「本版本还不能在多个连接之间登记仓库，先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来」；缺路由（已登记，当前挂载下没有它的身份）改为「本版本还不能把已登记的仓库改绑到别的连接，只能让原来的 Development 连接以原绑定 id 挂回来」。保留「不取第一个注册者」「绑定 id 变了」等判别措辞，错误码与恢复动作不变（D23）。否决：保留「重新绑定」并注明要等 #127（把 issue 号放回文案，而且照做会撞上 Storage 的拒绝）；只陈述事实不给动作（用户没有出路）。(3) 每个动作都有一条用例逐字执行：新增 E15（歧义三步：只挂载 dev-b、开始工作一次、挂回 dev-a，之后 repo-beta 照旧只进 dev-b，dev-a 零调用，替身与 SQLite 各一遍）；E3 在被拒之后把原连接挂回来（已 Ready 的上下文读回确认 Saved，被拒的新工作项照常开始）；E7 在两个挂载加一个缺路由的连接时把 dev-old 挂回来，只进 dev-old。E2、E3 同时禁止「绑定仓库」「重新绑定」，防止许诺回潮；变异 M43–M48。（Superseded by D28：禁词表守不住句尾追加，E2、E3 另加 `$` 锚定的相等断言，变异 M49–M51。）(4) 规格里的 `routeDevelopment` 副本只加 Superseded 标注、不改写，保留首版以便对照。(5) TD-035 与交接表先订正为事实，再按 D26 写成最终事实；K3 的承接方记录按 D27 写成最终事实。代码改动只有两条文案；错误码、恢复动作、可重试性与路由行为不变。 |
| 2026-10-08 / 人类伙伴（在协调者会话里直接回答；协调者转述，第二轮修复者回填） | **D26 #127 / #142 是否添加验收框（人类裁决）**：第二轮评审指出 TD-035 写了「补验收」而两个 issue 的验收框都没改，#142 的决策评论也没有「按选中仓库的路由结果判定开始工作是否可用」。人类伙伴所选答复原文为「Add both (Recommended)」。执行（协调者，2026-10-08）：先有决策评论（#127 issuecomment-6058141177、#142 issuecomment-6058141929），再在两个 issue 的 Acceptance criteria 末尾各加一条验收框，原文——#142：“Start Work is offered for a repository only when it routes to a Development connection that can serve it: the connection it is registered on, or the only connection while it is not yet registered; another available connection never enables it (component test; from #219, decided 2026-10-08)”；#127：“Repository metadata is reported per Development connection, and binding a repository records which connection serves it, the route that #219's routing reads (test; from #219, decided 2026-10-08)”。TD-035 的「下一步」据此写成事实（修复者起初订正为「只有评论、验收框未添加」，随后被本裁决取代）；代码与测试不变。 |
| 2026-10-08 / 人类伙伴（同上） | **D27 K3 接线改由独立小 PR 承担（人类裁决，更正 D23 的接线方）**：第二轮评审指出 K3 接线与正例只记在 #291 这一侧，#221 与 #292 上没有记录，#292 的 PR 描述还写着相反的安排。人类伙伴所选答复原文为「Separate small PR (Recommended)」。含义与执行（协调者，2026-10-08）：把 #292 的缝函数 `developmentReadBinding` 的函数体换成 `routeDevelopment`、并补正例「两个 Development 挂载、仓库登记在 A，只调 A 并记下提交与变更请求跳，缝没接上就变红」的工作，不再由 #292 在 rebase 时承担，改由新 issue #297（`feat(core): route delivery lineage reads through repository routing`，#216 的子 issue）承担，等 #219 与 #221 都进 main 之后再做；#221 已写决策评论 issuecomment-6060231866；#292 不再需要等 #291 合并。更正范围：D23 的「#292 rebase 时承担接线」与「合并顺序 #290 → #291 → #292」中涉及 #292 的部分；K3 条目、TD-037、验收第 10 行、交接表与 I1 用例注释同步改指 #297。D23 的其余内容（D2 / D3 / D6 / D7 / D9 / D14 / D19 保持原样、TD-035 的承接）不变；本 PR 仍不接线、不动 `chain-facts.ts`。 |
| 2026-10-08 / Claude（第三轮评审修复者；非机械项由协调者决定） | **D28 第三轮评审的取舍**：(1) 禁词表守不住句尾追加：评审者的 Y3（缺路由文案追加「，或把它改挂到当前的 Development 连接」）与 Y4（歧义文案追加「；也可以在设置里为它选一个连接」）在 `482c5dc3` 的导出树上都存活（165 / 165）。E2、E3 各加一条 `$` 锚定、从判别措辞（「：不取第一个注册者；」「Development 绑定 id 必须跨重启稳定；」）到句尾的相等断言，常量 `AMBIGUOUS_ACTION`、`MISSING_ROUTE_ACTION`；禁词表保留作补充。基线仍 165 / 165，Y3、Y4（M49、M50）各红 2 条，M47、M48 照样变红。D25 (3) 与 Surprises 里的「反向钉住」就地订正为「句尾逐字锚定」。(2) 歧义文案补不可撤销的提示（协调者决定，写法对齐缺路由文案的「本版本还不能把已登记的仓库改绑到别的连接」）：在步骤之前加「也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：」，步骤原文不动。仍然不带 issue 号，不承诺不存在的命令；错误码、恢复动作、可重试性与路由行为不变。E2 断言提示在步骤之前，E15 断言提示先于三步，句尾锚定同步；M51 去掉提示后红 4 条（E2、E15 各两种 Storage）。否决：(a) 只在 D25 里记一笔「不提示单向性」（评审者给的另一条路）：文案本身就是在教用户做这一步，缺提示是这条指引自己的不完整，不能靠「今天没有生产路径组装多挂载」豁免；(b) 把「选之后要用它开 PR 的那个」写进文案：文案不替用户预设用途，只说要选定由哪一个来服务它；(c) 新增专门证明「登记后改不了」的用例：这个事实已由 E3（已登记仓库换连接 → conflict，末段挂回原连接）与缺路由文案钉住，评审者 `steps.mjs` 的 B3（两个连接都有同一个仓库，先登记 dev-a、之后只挂 dev-b）与它是同一条 Storage 事实。(3) 文档订正：变异表说明里的 M12 / M31 条数与「实测」列对齐为 121 / 104，方法段落的数字改为 51 条与 165，Surprises 里残留的接线方 #292 就地更正为 D27 的 #297。 |

## Idempotence and Recovery

- 组合幂等：同一组 provider 重复组合读回同一组挂载；从一个 Development 挂载重组为两个时，旧默认被 upsert 改写为非默认（I1）。没有 schema 变更，没有迁移。
- 路由是纯读：不写 Storage、不调 provider，重复调用的结果只取决于持久化事实。新请求在一次开始工作里路由两次（写前准备与供应），两次之间只有本命令自己的登记会改变事实，而登记写下的正是第一次路由选中的连接，所以第二次结果相同；已有 Ready 记录的请求只在读回时路由一次。
- 每个批次都是一个提交，可以单独 revert。revert 之后用单个 Development 重新组合，会把它写回默认（写默认会降级同域旧默认，实测替身与 SQLite 都如此）。多挂载组合留在本地开发库里的非默认行不影响 revert 后的组合（Registry 只来自本次组合），但 `listProviderBindings` 会多读到它们（TD-038）；需要干净状态时删除本地开发库重建（首发前没有需要保护的数据）。
- 变异实验：每条变异先确认目标文本恰好出现一次并已改写，再跑用例，结束后用内存里的原文写回并逐字比对；全部跑完 `git status --short` 必须为空。
- 评审修复轮的恢复锚点：rebase 前的 head 保存在本地分支 `backup/development-repository-routing-pre-review-rebase`（`eccfab2`，当时的远端 head）；回读 `git rev-parse backup/development-repository-routing-pre-review-rebase`，期望 `eccfab2bf9a4613ddc3d92455ecb5fda259dac35`。需要回到 rebase 之前时，从它新建分支，不在原分支上 `reset`。
- 第二轮评审修复的恢复锚点：修复前的 head 保存在本地分支 `backup/development-repository-routing-pre-rr2`；回读 `git rev-parse backup/development-repository-routing-pre-rr2`，期望 `cbc767b19e55a17c3e42cd4d63ff1f79806a2426`。
- 发布：开 PR 前整理提交，已推送的分支先建 backup ref，再用精确的 `--force-with-lease=<branch>:<读到的旧 head>` 推送；lease 失败就停下重新回读，不改用裸 `--force`（`AGENTS.md` §6）。

## Interfaces and Dependencies

### 工具与账号

Node ≥ 22（本机 26）、pnpm 10.28.2（`pnpm install --frozen-lockfile`）；验证用 `node_modules/.bin/tsc` 与 `node --test`。不需要凭据、不联网。提交、PR 与回复用开发账号；评审用评审账号。

### 本 PR 提供的接口

- `CoreProviderTable.development?: DevelopmentProvider | readonly DevelopmentProvider[]`（`packages/core/src/registry.ts`）。
- `resolveBinding(binding, key)`（`packages/core/src/registry.ts`）、`gateBinding(binding, key, mode)`（`packages/core/src/capabilities.ts`），经 `index.ts` 既有的 `export *` 自动导出。
- `routeDevelopment(source, repositoryId, key, mode, earlier = [])` 与类型 `DevelopmentRouteSource`、`DevelopmentGate`、`DevelopmentRoute`（`packages/core/src/development-route.ts`，只在 core 内部使用）。
- 消费者必须遵守：一次操作调一次 `routeDevelopment`（按锚点 key；同一操作里要在锚点之前判的其他门按拒绝的先后顺序经 `earlier` 传入，不要在路由之后自己再 `gateBinding`，也不要先判锚点）；调 provider 只用 `route.repository`；写尝试与实体 id 里的连接取 `route.binding.ref.bindingId`；拒绝原样折成结构化错误或缺口（`route.error.message`）；不得用 Development key 调 `gateCommand`、`resolveCapability`、`resolveWriteTarget`、`bindingForCapability`，也不得用请求串自己拼仓库引用。

### 跨 PR 契约（协调者 2026-10-08 裁定，与本 PR 相关的条目）

- **K1 修订号（owner PR-A）**：业务修订号只在工作区快照内容变化时推进，一个事务至多一次；刷新、尝试、游标与新鲜度不推进；查询不写事实。本 PR 的路由只读 Storage，不写任何事实，不改变开始工作的修订号行为。
- **K3 Development 路由（owner 本 PR）**：本 PR 提供 core 内按仓库路由的函数，并让 Development key 级解析在多挂载时 fail closed、不取第一个注册者；单挂载工作区的现有行为不变。本 PR 不改 `chain-facts.ts`、`delivery.ts`、`relations.ts`、`queries.ts`、`context.ts`、`bootstrap.ts`，也不改 `packages/capabilities/src/development-provider.ts`、`packages/providers/fake/src/development.ts`、`tests/contract/suites/development.js`。PR-C 把 `chain-facts.ts` 里的 Development 绑定解析收拢到一个缝函数（建议名 `developmentReadBinding(context, key, repositoryId)`），主干仍是 key 级解析；PR-B 与 PR-C 都合并后，后合并的一方把缝函数的函数体换成 `routeDevelopment`（预计 ≤ 20 行，允许越过上述文件边界，并在 PR 正文写明；Superseded by D23（2026-10-08，人类伙伴裁决）：合并顺序是 #290 → #291 → #292，接线由 #292 在 rebase 到 main 时承担（同时适配 #289 的分页），不再是「后合并的一方」，#292 必须带正例「已登记仓库的多挂载谱系读只进路由到的挂载」且它在缝没接上时变红；Superseded by D27（2026-10-08，人类伙伴裁决「Separate small PR (Recommended)」）：接线与正例改由新 issue #297 承担，等 #219 与 #221 都进 main 之后再做，#292 不再等本 PR）；在此之前，多挂载工作区里的谱系读取退化为缺口。本 PR 的兑现方式：函数名就是 `routeDevelopment`，签名与消费规则见上一小节；I1 的「多挂载谱系读是缺口」断言在接上缝函数之后仍然成立（那个场景没有登记仓库，路由本身就是歧义），所以它在接线前后都成立、不是接线的护栏（用例名与注释已写明）；接缝的一方（D23：#292；D27 更正为 #297）另补一条正例「已登记仓库的谱系读只进路由到的挂载」。本 PR 对 K3 有两点提议，已写进给协调者的回复：单挂载行为有 D8 一处有意变化；缝函数最好返回 `{ binding, repository }` 而不只返回 binding，否则 #127 引入并列引用后还要再改缝的签名。
- **K6 编号预分配**：本 PR 的技术债务用 TD-035–TD-039（五个全部用到，全文见 `Artifacts and Notes`）；ADR-0013 预留但不使用（D10）；本 PR 没有 SQLite 迁移；文件名日期用 2026-10-08。合并时再回读一次 `docs/exec-plan/tech-debt-tracker.md`，确认编号没有被别的 PR 占用。
- **K7 共享文件**：本 PR 只改自己的行——`docs/README.md` Active 表一行；`docs/exec-plan/tech-debt-tracker.md` 五行；控制计划第 31 行与 Batch 2B 段的就地标注。不改 `docs/product/vertical-path.md` §2.1 与 `docs/architecture/release-gates.md`。合并冲突由后合并者 rebase 解决。
- **K8 规模口径**：代码（实现 + 测试，增删都算，`node scripts/rule-checks.mjs size origin/main` 的 code 桶）≤ 800、实现约 ≤ 350；文档 ≤ 1300。

### 与其他 PR / issue 的交接

| 对象 | 交接内容 |
|---|---|
| PR-A（#199、#220，`fix/sync-revision-freshness`） | 本 PR 不改 `context.ts`、`bootstrap.ts`，两者没有先后依赖。唯一约定：PR-A 若在 `composeCore` 里改 catch，只包 `bootstrapWorkspace`，不得吞掉 `createContext` 的注册拒绝（多挂载的角色校验在那里抛 `TypeError`）。 |
| PR-C（#221，PR #292，`feature/delivery-fact-writer`） | 见 K3。接线与正例原定由 #292 在 rebase 到 main 时承担（D23），已由 D27 更正：改由 #297 在 #219 与 #221 都进 main 之后承担，#292 不再等本 PR；#221 的决策评论 issuecomment-6060231866 记录了这一交接。PR-C 新写的代码不得用 Development key 做 key 级解析；交付事实缓存键里的连接取路由命中挂载的 `bindingId`。 |
| #297（K3 接线，#216 的子 issue） | 拥有：把 PR-C 的缝函数 `developmentReadBinding` 的函数体换成 `routeDevelopment`（单挂载工作区的行为不变，同时适配 #289 的分页），并带正例「两个 Development 挂载、仓库登记在 A，只调 A 并记下提交与变更请求跳」，缝没接上时必须变红；等 #219 与 #221 都进 main 之后再做（D27）。 |
| PR-D（#222，栈在 PR-C 上） | 不重叠。`queries.ts` 的元数据汇总保持 key 级（TD-035）；若 PR-D 改名或挪走 `readChainFacts`，由 PR-D 改 I1 场景的调用入口，断言不动。 |
| PR #287、#288 | 不重叠：本 PR 不改 `development-provider.ts`、替身的 Development 实现与契约套件；新用例只用替身已有的 `bindingId`、`capabilities` 选项与 `state.repositories` / `state.branches` 字段，不碰变更请求。 |
| #127 绑定命令 | 拥有：绑定仓库命令（写仓库挂载、锚点身份与同一仓库在另一连接下的并列引用）；只改 `routeDevelopment` 的内部——在已挂载连接的引用之间按 key 选，并显式处理多个候选；按绑定给出有效访问（收 TD-035；决策评论 issuecomment-6058141177，验收框已按 D26 添加）；按 id 取身份或给挂载记录引用（收 TD-036）；解绑写 `enabled = false` 并把本计划的种入改走命令（收 TD-038）；决定懒登记去留（收 TD-039）。 |
| #132 宿主组合根 | 把所有启用的持久化 Development 挂载以数组注入；`isDefault` 由挂载数推出，不从库里读；连接 id 必须跨重启稳定（#228、TD-015），否则已登记的仓库都会得到缺路由的 `conflict` 与读回 Unknown（fail closed，不会读错连接）；未知实现键只禁用那个挂载，登记在它上面的仓库同样得到缺路由。 |
| #235 创建变更请求 | 按 `routeDevelopment(ctx, 上下文的 repositoryId, development.change_request.create, 'write')` 路由；待处理尝试记 `route.binding.ref.bindingId`；provider 调用只用 `route.repository`。#127 之前仓库只登记在一个连接上：登记在 Local Git 上的仓库会得到 `not_supported`（Local Git 不声明创建变更请求），这是正确的 fail closed；#127 加上 GitHub 引用后只改路由内部，#235 的调用点不变。 |
| #233 谱系同步 | 每一跳按路由读：分支头与变更请求各自选锚点 key（#127 之后 `repository.read` 两边都声明，必须锚定，不能各 key 各自路由）；取代 `chain-facts.ts` 第 6 行「同一外部 id 视为同一对象」的假设（TD-037）。 |
| #231 GitHub Development provider | 必须满足契约套件的外来引用义务（答 `not_found`）；它给仓库的外部 id 就是 #127 要登记的并列引用。 |
| #142 开始工作对话框 | 只列已绑定的仓库，按选中仓库的路由结果判定可用性（TD-035），并以「绑定仓库」恢复动作取代 `reapply`（D23）。决策评论 issuecomment-6058141929 写了恢复动作及其测试；「开始工作只在仓库路由到能服务它的连接时提供」这一条由人类裁决「Add both (Recommended)」补成验收框（D26）。 |
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

### 变异表（M1–M51，最终树上的实测）

方法：在 `git archive HEAD` 导出的临时目录（`.superpowers/mutations/<名字>/`，复制了各 `node_modules`，没有 `.git`，用完删除）里逐条做。每条：目标文本 `old` 在文件里恰好出现一次 → 写成改写后的临时文件、用 `/bin/cp -f` 覆盖 → 用 `cmp` 与 `git diff --no-index -U0` 证明文件已变 → 运行 `node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js tests/e2e/start-work.test.js tests/integration/start-work-sqlite-registration.test.js`（导出树 165 条，基线全绿），读 TAP 里的 `not ok` → 用备份 `/bin/cp -f` 还原并 `cmp` 确认逐字相同。51 条全部：已生效、点名的用例都在红集合里；全部跑完复跑回到 165 / 165。驱动脚本是运行态内容，不入库；下面每条的 `-` / `+` 就是它使用的确切文本（同一条里多处改写依次应用）。M1–M18 沿用首版的编号与意图，文本按最终代码重写（首版只有文字描述，后来者无法逐字复现，对抗验证指出）；M18 在去掉等价分支后改为「缺路由的 conflict 排在门之前」；M19–M32 是第一轮对抗验证之后补的判别用例对应的变异；M33–M38 是第二轮之后补的（读回路由的 `'read'` 模式、三个挂载的歧义与缺路由、登记在第三个、缺路由先于挂载的能力门、注册门里两个读门的先后）；M39–M42 是第三轮之后补的（多挂载下锚点之前的注册门在第一个挂载上判或被跳过、key 级解析只在恰好两个对等挂载时 fail closed、路由拒绝把写尝试记到未被调用的连接）；M43–M48 是评审修复轮与第二轮补的（歧义与缺路由两条 conflict 文案退回「把内部 issue 号当指引」或丢掉动作、退回第一轮「绑定到其中一个连接」「重新绑定到当前连接」的措辞、追加 issue 号；M43、M44 的文本在第二轮随文案重写，原文对应首版文案）；M49–M51 是第三轮补的（M49、M50 在两条文案的句尾追加不存在的动作，缺路由追加「改挂到当前的 Development 连接」、歧义追加「在设置里为它选一个连接」，它们躲得过禁词表；M51 去掉歧义文案在步骤之前的「登记之后撤不回」提示；M43、M45 的 `-` 文本随歧义文案的新措辞更新）。第二轮与最终验收的驱动脚本都直接解析下面的 `-` / `+` 文本逐条应用并核对点名的用例都在红集合里，所以这张表就是实际运行的文本；「实测」列是最终验收在最终树上的条数（2026-10-08 02:56 CST，导出自本地提交，代码与整合后的代码提交相同）；第二轮修复之后 12 条的条数与点名用例随 E15、E3 与 E7 的恢复步骤更新，数字以 `Artifacts and Notes` 的「第二轮评审修复的复跑」为准；第三轮修复没有改变 M1–M48 的条数与点名用例，最终树上的整表重跑见「第三轮评审修复的复跑」。

    M1  packages/core/src/development-route.ts  应变红：E2、E10、E15  实测 6 条
    - if (mounts.length > 1) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记
    + if (false) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记
    M2  packages/core/src/development-route.ts  应变红：E1、E3、E15  实测 24 条
    - if (identity?.id === registered.externalIdentityId) binding = mount
    + binding ??= mount
    M3  packages/core/src/development-route.ts  应变红：E1、E4  实测 20 条
    - if (identity?.id === registered.externalIdentityId) binding = mount
    + binding = mount
    M4  packages/core/src/development-route.ts  应变红：E3、E7、既有「绑定 id 变了」用例  实测 14 条
    - if (mounts.length > 1) return missing
    -       binding = mounts[0]
    + missing = undefined
    +       binding = mounts[0]
    M5  packages/core/src/start-work.ts  应变红：E3、既有「工作树读能力被策略设为不可用」用例  实测 4 条
    - if (!route.ok) return { ok: false, definite: false, error: route.error }
    + if (!route.ok) return { ok: false, definite: true, error: route.error }
    M6  packages/core/src/start-work.ts  应变红：E1、E3、E15  实测 6 条
    - const route = await routeDevelopment(context, record.repositoryId, CapabilityKey.DevelopmentWorktreeRead, 'read')
    + const target = (await import('./registry.ts')).resolveCapability(context.registry, CapabilityKey.DevelopmentWorktreeRead); const route = target.available ? { ok: true, binding: target.binding, provider: target.binding.development } : { ok: false, error: target.error }
    M7  packages/core/src/git-provisioning.ts  应变红：E1、E15  实测 16 条
    - const route = await routeDevelopment(context, request.repositoryId, CapabilityKey.DevelopmentWorktreeCreate, 'write')
    -   if (!route.ok) return gitFailure(contextId, markFailed(beginWrite(names.path), route.error), undefined, undefined)
    -   const { provider, repository } = route
    + const target = (await import('./capabilities.ts')).resolveWriteTarget(context.registry, CapabilityKey.DevelopmentWorktreeCreate)
    +   if (target.binding?.development === undefined) return gitFailure(contextId, markFailed(beginWrite(names.path), target.error ?? unsupportedCapability(CapabilityKey.DevelopmentWorktreeCreate)), undefined, undefined)
    +   const provider = target.binding.development
    +   const repository = { bindingId: target.binding.ref.bindingId, objectKind: 'repository', externalId: request.repositoryId, url: undefined }
    M8  packages/core/src/development-route.ts  应变红：E1、E14、E15  实测 14 条
    - import { gateBinding, unsupportedCapability, type CommandMode } from './capabilities.ts'
    + import { gateBinding, gateCommand, unsupportedCapability, type CommandMode } from './capabilities.ts'
    - const gate = gateBinding(binding, gateKey, gateMode)
    + const gate = gateKey === key ? gateBinding(binding, gateKey, gateMode) : gateCommand(source.registry, gateKey, gateMode)
    M9  packages/core/src/development-route.ts  应变红：E4  实测 4 条
    - if (!gate.allowed) return { ok: false, error: gate.error ?? unsupportedCapability(gateKey) }
    + if (!gate.allowed) { const alt = mounts.find((mount) => mount !== binding && gateBinding(mount, key, mode).allowed); if (alt === undefined) return { ok: false, error: gate.error ?? unsupportedCapability(gateKey) }; binding = alt; break }
    M10  packages/capabilities/src/registry.ts  应变红：C2、I1  实测 3 条
    - primary ?? (mounts.length === 1 ? spare : undefined)
    + primary ?? spare
    M11  packages/core/src/registry.ts  应变红：I1、E1、E2、E4、E15  实测 24 条
    - const isDefault = name === 'development' ? ports.length === 1 : primary
    + const isDefault = name === 'development' ? true : primary
    M12  packages/core/src/registry.ts  应变红：I1  实测 121 条
    - const isDefault = name === 'development' ? ports.length === 1 : primary
    + const isDefault = name === 'development' ? false : primary
    M13  packages/capabilities/src/registry.ts  应变红：C1  实测 1 条
    - (defaults === 1) !== (mounts.length === 1)
    + defaults === 0 && mounts.length === 1
    M14  packages/capabilities/src/registry.ts  应变红：C1  实测 1 条
    - (defaults === 1) !== (mounts.length === 1)
    + defaults === 1 && mounts.length > 1
    M15  packages/capabilities/src/registry.ts  应变红：C1、I1、E1、E2、E4、E15  实测 25 条
    -     } else if (mounts.length - defaults > 1) throw new TypeError(
    +     }
    +     if (mounts.length - defaults > 1) throw new TypeError(
    M16  packages/core/src/registry.ts  应变红：I1、E1、E2、E4、E15  实测 20 条
    - const ports: readonly unknown[] = peers ? value : value === undefined ? [] : [value]
    + const ports: readonly unknown[] = peers ? value.slice(-1) : value === undefined ? [] : [value]
    M17  packages/core/src/start-work.ts  应变红：E1  实测 2 条
    - routeDevelopment(context, record.repositoryId, CapabilityKey.DevelopmentWorktreeRead, 'read')
    + routeDevelopment(context, (await context.storage.listRepositories(context.workspaceId))[0].id, CapabilityKey.DevelopmentWorktreeRead, 'read')
    M18  packages/core/src/development-route.ts  应变红：E3  实测 2 条
    - if (mounts.length > 1) return missing
    -       binding = mounts[0]
    + return missing
    M19  packages/core/src/development-route.ts  应变红：E7  实测 2 条
    - if (identity?.id === registered.externalIdentityId) binding = mount
    + if (identity !== undefined) binding = mount
    M20  packages/core/src/development-route.ts  应变红：E8  实测 2 条
    - .find((mount) => mount.id === repositoryId)
    + .find((mount) => String(mount.id).includes(repositoryId))
    M21  packages/core/src/git-provisioning.ts  应变红：E1  实测 2 条
    - const bindingId = repository.bindingId
    + const bindingId = context.registry.bindings.find((b) => b.ref.domain === 'development').ref.bindingId
    M22  packages/core/src/git-provisioning.ts  应变红：E5、E13  实测 4 条
    - const route = await routeDevelopment(context, request.repositoryId, CapabilityKey.DevelopmentWorktreeCreate, 'write')
    + const routed = await routeDevelopment(context, request.repositoryId, CapabilityKey.DevelopmentWorktreeCreate, 'write')
    - if (!route.ok) return gitFailure(contextId, markFailed(beginWrite(names.path), route.error), undefined, undefined)
    -   const { provider, repository } = route
    + const first = context.registry.bindings.find((b) => b.ref.domain === 'development')
    +   const route = routed.ok ? routed : { provider: first.development, repository: { bindingId: first.ref.bindingId, objectKind: 'repository', externalId: request.repositoryId, url: undefined } }
    +   const { provider, repository } = route
    M23  packages/core/src/git-provisioning.ts  应变红：E5  实测 2 条
    - CapabilityKey.DevelopmentWorktreeCreate, 'write')
    + CapabilityKey.DevelopmentWorktreeCreate, 'read')
    M24  packages/core/src/start-work.ts  应变红：既有「ack 与能力门」用例  实测 2 条
    - CapabilityKey.DevelopmentWorktreeCreate, 'write', REGISTRATION_GATES)
    + CapabilityKey.DevelopmentWorktreeCreate, 'read', REGISTRATION_GATES)
    M25  packages/core/src/registry.ts  应变红：I2  实测 2 条
    - const peers = name === 'development' && Array.isArray(value)
    + const peers = Array.isArray(value)
    M26  packages/core/src/registry.ts  应变红：I2  实测 2 条
    - [peers ? `${name}[${index}]` : name, domain, isDefault, port]
    + [name, domain, isDefault, port]
    M27  packages/core/src/registry.ts  应变红：I2  实测 2 条
    - const isDefault = name === 'development' ? ports.length === 1 : primary
    + const isDefault = name === 'development' ? ports.length === 1 && !peers : primary
    M28  packages/core/src/registry.ts  应变红：I1  实测 2 条
    - const ports: readonly unknown[] = peers ? value : value === undefined ? [] : [value]
    + const ports: readonly unknown[] = peers ? (value.length === 0 ? [{}] : value) : value === undefined ? [] : [value]
    M29  packages/core/src/development-route.ts  应变红：S2  实测 4 条
    - [...earlier, [key, mode] as const]
    + [[key, mode] as const, ...earlier]
    M30  packages/core/src/registry.ts  应变红：S1  实测 5 条
    - if (binding === undefined || declared === undefined) return unavailableCapability(`没有绑定提供能力 ${key}`)
    + if (binding === undefined) return unavailableCapability(`没有绑定提供能力 ${key}`)
    +   if (declared === undefined) return unavailableCapability(`能力 ${key} 当前不可用`)
    M31  packages/core/src/development-route.ts  应变红：既有的懒登记用例（单挂载、仓库未登记）、E15  实测 104 条
    -     binding = mounts[0]
    -   } else {
    +     return refuse(ProjectErrorCode.Conflict, '单挂载未登记也拒绝')
    +   } else {
    M32  packages/core/src/git-provisioning.ts  应变红：E1、E6、E7、E15  实测 10 条
    - const { provider, repository } = route
    + const first = context.registry.bindings.find((b) => b.ref.domain === 'development')
    +   const provider = first.development
    +   const repository = { bindingId: first.ref.bindingId, objectKind: 'repository', externalId: request.repositoryId, url: undefined }
    M33  packages/core/src/start-work.ts  应变红：E9  实测 2 条
    - routeDevelopment(context, record.repositoryId, CapabilityKey.DevelopmentWorktreeRead, 'read')
    + routeDevelopment(context, record.repositoryId, CapabilityKey.DevelopmentWorktreeRead, 'write')
    M34  packages/core/src/development-route.ts  应变红：E10  实测 2 条
    - if (mounts.length > 1) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记
    + if (mounts.length === 2) return refuse(ProjectErrorCode.Conflict, `仓库 ${repositoryId} 没有登记
    M35  packages/core/src/development-route.ts  应变红：E12  实测 2 条
    - if (mounts.length > 1) return missing
    + if (mounts.length === 2) return missing
    M36  packages/core/src/development-route.ts  应变红：E7  实测 2 条
    - if (mounts.length > 1) return missing
    + if (mounts.length > 2) return missing
    M37  packages/core/src/start-work.ts  应变红：S2  实测 1 条
    - [CapabilityKey.DevelopmentRepositoryRead, 'read'], [CapabilityKey.DevelopmentWorktreeRead, 'read'],
    + [CapabilityKey.DevelopmentWorktreeRead, 'read'], [CapabilityKey.DevelopmentRepositoryRead, 'read'],
    M38  packages/core/src/development-route.ts  应变红：E7、E11  实测 4 条
    - for (const mount of mounts) {
    + for (const mount of mounts.slice(0, 2)) {
    M39  packages/core/src/development-route.ts  应变红：E14  实测 2 条
    - const gate = gateBinding(binding, gateKey, gateMode)
    + const gate = gateBinding(gateKey === key ? binding : mounts[0], gateKey, gateMode)
    M40  packages/core/src/development-route.ts  应变红：E14  实测 2 条
    - for (const [gateKey, gateMode] of [...earlier, [key, mode] as const]) {
    + for (const [gateKey, gateMode] of mounts.length > 1 ? [[key, mode] as const] : [...earlier, [key, mode] as const]) {
    M41  packages/capabilities/src/registry.ts  应变红：C2  实测 1 条
    - primary ?? (mounts.length === 1 ? spare : undefined)
    + primary ?? (mounts.length !== 2 ? spare : undefined)
    M42  packages/core/src/git-provisioning.ts  应变红：E5、E13  实测 4 条
    - if (!route.ok) return gitFailure(contextId, markFailed(beginWrite(names.path), route.error), undefined, undefined)
    + if (!route.ok) return gitFailure(contextId, markFailed(beginWrite(names.path), route.error), context.registry.bindings.find((b) => b.ref.domain === 'development')?.ref.bindingId, undefined)
    M43  packages/core/src/development-route.ts  应变红：E2、E15  实测 4 条
    - 本版本还不能在多个连接之间登记仓库，也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来`
    + 先登记它属于哪个连接（绑定仓库，#127）`
    M44  packages/core/src/development-route.ts  应变红：E3  实测 2 条
    - ；本版本还不能把已登记的仓库改绑到别的连接，只能让原来的 Development 连接以原绑定 id 挂回来`
    + `
    M45  packages/core/src/development-route.ts  应变红：E2、E15  实测 4 条
    - 本版本还不能在多个连接之间登记仓库，也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载拥有这个仓库的那个 Development 连接，开始工作一次（这会登记仓库属于它），再把其余连接挂回来`
    + 先把这个仓库绑定到其中一个 Development 连接再开始工作`
    M46  packages/core/src/development-route.ts  应变红：E3  实测 2 条
    - 本版本还不能把已登记的仓库改绑到别的连接，只能让原来的 Development 连接以原绑定 id 挂回来`
    + 先让原来的 Development 连接以原绑定 id 挂回来，或把这个仓库重新绑定到当前的 Development 连接`
    M47  packages/core/src/development-route.ts  应变红：E2  实测 2 条
    - 再把其余连接挂回来`
    + 再把其余连接挂回来（见 #127）`
    M48  packages/core/src/development-route.ts  应变红：E3  实测 2 条
    - 只能让原来的 Development 连接以原绑定 id 挂回来`
    + 只能让原来的 Development 连接以原绑定 id 挂回来（见 #142）`
    M49  packages/core/src/development-route.ts  应变红：E3  实测 2 条
    - 只能让原来的 Development 连接以原绑定 id 挂回来`
    + 只能让原来的 Development 连接以原绑定 id 挂回来，或把它改挂到当前的 Development 连接`
    M50  packages/core/src/development-route.ts  应变红：E2  实测 2 条
    - 再把其余连接挂回来`
    + 再把其余连接挂回来；也可以在设置里为它选一个连接`
    M51  packages/core/src/development-route.ts  应变红：E2、E15  实测 4 条
    - ，也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：先只挂载拥有这个仓库的那个 Development 连接
    + ，先只挂载拥有这个仓库的那个 Development 连接

「应变红」里 E1–E15 在替身与 SQLite 上各跑一遍，所以条数常是 2 的倍数；契约用例 C1、C2 与单挂载对照 S1、S2 只跑一遍；M12 红 121 条是因为单个 Development 挂载被写成非默认后 Registry 直接拒绝，几乎所有用例都组合失败；M31 红 104 条证明「单挂载、仓库未登记时隐式路由到唯一挂载」（D7）被既有的懒登记用例钉住；M49、M50 是句尾追加，禁词表躲得过、`$` 锚定的相等断言躲不过；M51 去掉提示后，E2 的整句断言与 E15 的「提示先于三步」同时变红。

已知等价变异，不计入：其他槽位也接受单元素数组——数组长度 ≥ 2 时会被 Registry 的「多个默认 / 多个备用」拒绝，长度 1 时与传单个对象语义相同，没有可观察差异；空数组与非 `development` 槽位的数组由 I2、M25 钉住。另一条等价变异：去掉 `providerRegistry` 里 Development 角色检查的 `mounts.length > 0 &&`（第二轮对抗验证的 X36）全绿——没有挂载时 `false !== false` 本就不抛，条件是死代码，已删除（D21）。

### 实施期证据（实现者实测，`.worktrees/development-repository-routing`，2026-10-08 00:42–00:52 CST）

| 步骤 | 命令 | 结果 |
|---|---|---|
| 基线（规划提交之后、Batch 1 之前的本地文档提交，整合后不再存在） | `node --test tests/contract/capabilities-keys.test.js tests/e2e/start-work.test.js tests/integration/provider-binding-registration.test.js tests/integration/start-work-sqlite-registration.test.js` | 128 / 128 |
| Batch 1 红 | `node --test tests/contract/capabilities-keys.test.js tests/integration/provider-binding-registration.test.js` | 40 条里 4 条失败：C1 `TypeError: 挂载 dev-a@development 不是默认挂载：只有 Execution 允许备用`；C2 `repository.read` 得到先注册的挂载；I1 × 2 `TypeError: 槽位 development 的 port 缺少必需方法` |
| Batch 1 绿 | 基线那条四文件命令 | 131 / 131；`node_modules/.bin/tsc --noEmit` 无输出；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1209 / 1209 |
| Batch 2 红 | `node --test tests/e2e/start-work.test.js` | 11 条里 3 条失败：E1 实际 `['failed','failed']`；E2 实际 `not_supported`；E3 实际 `['failed','failed','failed']`；E4 通过 |
| Batch 2 绿 | 基线那条四文件命令加 `tests/e2e/delivery-lineage.test.js` | 142 / 142 |
| Batch 2 全量 | `tsc --noEmit`；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`；`node --test --test-timeout=120000 tests/mvp0`；`pnpm run boundaries` | 无输出；1213 / 1213（起点 1206 加 7）；7 / 7；8 / 8 |
| R1 复现（上一节命令） | 同上 | `saved`，然后 `ready unknown result_unknown ready` |
| 规模 | `node scripts/rule-checks.mjs size origin/main`（Batch 2 提交后、回填前） | 代码 298 / 1000（计划约 297）；实现与测试的分布与「文件所有权与规模估算」一致 |
| 第二轮对抗验证之后 | 四文件命令；加 `tests/e2e/delivery-lineage.test.js` 的五文件命令；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`；`node --test --test-timeout=120000 tests/mvp0`；`pnpm run boundaries`；`node_modules/.bin/tsc --noEmit` | 161 / 161；168 / 168；1239 / 1239；7 / 7；8 / 8；无输出（2026-10-08 02:19 CST，在检出本分支的工作树根目录；同一树上 `pnpm verify` exit 0、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/workflow-check.mjs`、`git diff --check origin/main...HEAD` 都 exit 0，`size origin/main` 代码 493 / 文档 842） |
| 最终验收（第三轮对抗验证之后） | 同上六条；`node scripts/rule-checks.mjs size origin/main`；`node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/workflow-check.mjs`；`git diff --check origin/main...HEAD`；R1 复现命令 | 163 / 163；170 / 170；1241 / 1241（起点 1206 加 35）；7 / 7；8 / 8；无输出；代码 508 / 1000；`disclosure` 机械扫描通过；`workflow-check: no findings`；exit 0；`saved` 与 `ready unknown result_unknown ready`（2026-10-08 02:47–02:56 CST，在检出本分支的工作树根目录） |

首版变异实验（Batch 1、2 提交上，M1–M18 的条数）已被上面的「变异表」取代；那里的 M1–M18 按最终代码重写并重跑。

单挂载差分（对抗验证后，`origin/main@6417d45` 的 `git archive` 导出树与本分支 HEAD 各跑同一份脚本，结果文件逐字比较）：

| 对照 | 输入空间 | 结果 |
|---|---|---|
| 开始工作的能力组合 | 4 个注册 key（`branch.create`、`repository.read`、`worktree.read`、`worktree.create`）× 正常 / 只读（策略）/ 不可用（策略）/ 未声明（快照里删掉该 key）= 256 项，加「没有任何 Development 挂载」1 项 | 257 项逐字节相同：写状态、错误码、恢复动作、可重试性、外部调用数、文案 |
| 已 Ready 上下文换新键的读回 | `worktree.read` × 4 种状态 | 逐字节相同 |
| 终态接管（Ready 改写成 Failed 再换新键） | `worktree.create` × 4 种状态 | 逐字节相同 |
| 已登记仓库换了 Development 连接后对另一个工作项开始工作 | 同上 256 项 | 252 项逐项相同；其余 4 项（没有任何门被拒，只读的读门也放行）错误码与恢复动作相同（都是 `conflict`、`reapply`），差别是新连接不再收到 `getRepository`，以及文案（见下表第四行，D19） |
| 同上，新连接的 `getRepository` 返回失败 | `not_found` / `unavailable` / `permission_denied` 各一项（第二轮对抗验证，两棵树对跑） | `origin/main`：错误码取自新连接的失败（`not_found` + `open_provider`、`unavailable` + `retry` 且可重试、`permission_denied` + `fix_permission`），新连接收到 `getRepository`；HEAD：三项都是 `conflict` + `reapply`、不可重试，新连接零调用（D19） |
| 终态接管、过期续跑（Provisioning 且租约过期）后换连接再换新键开始工作 | 各一项 | `origin/main`：`failed` + `not_found` + `open_provider`，新连接收到 `listBranches`、`createWorktree`；HEAD：`failed` + `conflict` + `reapply`，新连接零调用（E5、E13；D19） |
| 换连接的 conflict 文案 | 一项 | `origin/main`：「工作区已把仓库 repo-alpha 挂在另一个外部身份上（当前 Development 绑定 dev-moved 下没有它的身份——绑定 id 变了，或仓库来自另一个连接）：不猜映射，Development 绑定 id 必须跨重启稳定，多 binding 路由见 #219」；HEAD：「工作区已把仓库 repo-alpha 挂在外部身份 `<内部身份 id>` 上，但当前 Development 绑定 dev-moved 下没有它的身份——绑定 id 变了，或仓库来自另一个连接：不猜映射，Development 绑定 id 必须跨重启稳定」（D19） |

修订前同一份脚本：在第一轮修复之前的 HEAD（本地提交，整合后不再存在）上，开始工作的 257 项里 76 项错误码或恢复动作不同、131 项只有文案不同；在第一轮修复的第一版（同样是本地提交）上，「已登记仓库换连接」的 256 项里 252 项错误码不同。用对抗验证者的原始命令（`branch.create` 不可用加 `worktree.create` 只读）在 HEAD 上得到 `failed not_supported manual_execution 能力 development.branch.create 当前不可用`，与 `origin/main` 相同。

最终验收的独立复跑（2026-10-08 02:56 CST，另写的脚本，`origin/main@6417d45` 与最终树各自 `git archive` 导出后运行同一份脚本，输出逐行 `diff`）：4 个注册 key × 正常 / 只读 / 不可用 / 未声明的 256 项，各跑「新请求」「已登记仓库上的第二个工作项」「Ready 读回」「终态接管」「换了连接后的第二个工作项」五个场景，共 1280 项，比较写状态、上下文状态、错误码、恢复动作、可重试性、文案（UUID 归一）与新连接收到的调用序列。1276 项逐字相同；不同的 4 项都是「换了连接、没有门被拒」（四个 key 全部正常，或仓库读、工作树读之一或两者只读），两边都是 `conflict` + `reapply`、不可重试，差别只有文案（D19）与 `origin/main` 向新连接发了一次 `getRepository`（D8）。

### 评审修复轮的复跑（2026-10-08；基线 `origin/main@a357ef8`；`packages` 树 `f462e77`、`tests` 树 `b7b410b`）

（第一轮修复时的观察；第二轮修复之后代码与测试的树已变，数字以下一节「第二轮评审修复的复跑」为准。）

在检出 `feature/development-repository-routing` 的工作树根目录运行；变异在 `git archive HEAD` 导出树里做，用完删除。`packages` 与 `tests` 两个树对象标识的是被验证的代码内容，整合提交不改变它们。

| 命令 | 结果 |
|---|---|
| `git range-diff origin/main backup/development-repository-routing-pre-review-rebase HEAD`（rebase 之后、文案修复提交之前） | 三个提交都是 `=`；`git rebase origin/main` 无冲突 |
| `node_modules/.bin/tsc --noEmit` | 无输出 |
| 四文件命令（`Plan of Work` Batch 1 的第一条） | 163 / 163 |
| 加 `tests/e2e/delivery-lineage.test.js` 的五文件命令 | 170 / 170 |
| `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` | 1350 / 1350（`origin/main@a357ef8` 的 `git archive` 导出树上同一命令 1315 / 1315，差正好是本 PR 的 35 条） |
| `node --test --test-timeout=120000 tests/mvp0`；`pnpm run boundaries` | 7 / 7；8 / 8 |
| R1 复现命令（`Artifacts and Notes` 开头那条） | `saved`，然后 `ready unknown result_unknown ready` |
| `node scripts/rule-checks.mjs size origin/main` | 代码 512 / 1000，文档 970 / 1500 |
| `node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/workflow-check.mjs`；`git diff --check origin/main...HEAD` | 机械扫描通过；`workflow-check: no findings`；exit 0 |
| exec-plan 技能的 `lint_execplan.py` 检查本文件；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` | `OK: ExecPlan passed lint checks.`；9 / 9 |
| 变异表 M1–M44（上一节），导出树四文件命令基线 163 / 163 | 44 条全部：目标文本恰好出现一次并已改写（`cmp`，`git diff --no-index -U0` 的 `-` / `+` 行数不为零）、点名的用例都在红集合里、红的条数与表中「实测」列逐条相同；还原后 163 / 163，导出树的被改文件与工作树逐字相同；导出目录用完已删除 |

### 第二轮评审修复的复跑（2026-10-08；基线 `origin/main@a357ef8`；`packages` 树 `b2b1856`、`tests` 树 `b215619`）

（第二轮修复时的观察；第三轮修复之后代码与测试的树已变，数字以下一节「第三轮评审修复的复跑」为准。）

在检出 `feature/development-repository-routing` 的工作树根目录运行；变异在 `git archive HEAD` 导出树里做，用完删除。树对象标识被验证的代码内容，整合提交不改变它们（`git rev-parse HEAD:packages HEAD:tests` 回读）。

| 命令 | 结果 |
|---|---|
| 评审者的探针 `texts.mjs`（在 `git archive cbc767b1` 的导出树上） | `A.commands` 只有 `bootstrapWorkspace,startWork,cancelExecutionRun,confirmRelation,rerunPipeline,applyPlanningStatus`；`B.rebind via Storage port` 为 `rejected: repository mount already points at another external identity`；`A.workaround` 为 `solo saved ready -> both saved ready undefined` |
| 红阶段：只改 E2、E3 的期望并新增 E15 后 `node --test --test-timeout=120000 tests/e2e/start-work.test.js` | 39 条里 6 条失败（E2、E3、E15 各在两种 Storage 上），原因都是文案 |
| 绿阶段：改 `development-route.ts` 的两条文案后同一命令 | 39 / 39 |
| `node_modules/.bin/tsc --noEmit` | 无输出 |
| 四文件命令（`Plan of Work` Batch 1 的第一条） | 165 / 165（第一轮修复时 163，加 E15 两条） |
| 加 `tests/e2e/delivery-lineage.test.js` 的五文件命令 | 172 / 172 |
| `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` | 1352 / 1352（`origin/main@a357ef8` 上同一命令在带 `.git` 的检出里是 1315 / 1315；`git archive` 导出树没有 `.git`，依赖它的那条 CLI 用例失败，两边都用 `--test-skip-pattern='不带扩展名的副本后，无参调用'` 跳过后，`origin/main` 1314 / 1314、本分支 1351 / 1351，差正好是本 PR 的 37 条） |
| `node --test --test-timeout=120000 tests/mvp0`；`pnpm run boundaries` | 7 / 7；8 / 8 |
| R1 复现命令（`Artifacts and Notes` 开头那条） | `saved`，然后 `ready unknown result_unknown ready` |
| `node scripts/rule-checks.mjs size origin/main` | 代码 542 / 1000，文档 1059 / 1500（规划上限 800 / 1300） |
| `node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/workflow-check.mjs`；`git diff --check origin/main...HEAD` | 机械扫描通过（exit 0）；`workflow-check: no findings`；exit 0 |
| exec-plan 技能的 `lint_execplan.py` 检查本文件；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` | `OK: ExecPlan passed lint checks.`；9 / 9 |
| 变异表 M1–M48（上一节），导出树四文件命令基线 165 / 165 | 48 条全部：目标文本恰好出现一次并已改写（`cmp`，`git diff --no-index -U0` 的 `-` / `+` 行数不为零）、点名的用例都在红集合里、红的条数与表中「实测」列逐条相同；还原后 165 / 165；导出目录用完已删除。M43–M48 是文案变异；M1、M2、M6、M7、M8、M11、M12、M15、M16、M31、M32、M38 的条数与点名用例随 E15 与 E3、E7 的恢复步骤更新（没有变异变绿） |
| 评审者的 `mutate.mjs`（X1–X18、M43、M44、Y1、Y2，其中 M43、M44、Y1、Y2 的锚点文本改成新文案） | 22 条（X1–X18、M43、M44、Y1、Y2）全部 KILLED，点名的用例都在红集合里；基线 165 / 165，还原后 165 / 165 |
| 动作可执行性：E15（歧义三步）、E3 与 E7 末段（把原连接挂回来） | 替身与 SQLite 各一遍全部通过；其中歧义三步后 repo-beta 照旧只进 dev-b、dev-a 零调用，缺路由的恢复后已 Ready 的上下文读回为 Saved |

### 第三轮评审修复的复跑（2026-10-08；基线 `origin/main@a357ef8`；`packages` 树 `fa8359e`、`tests` 树 `15946a6`）

（第三轮修复时的观察；以后再改代码或测试，树标识与数字以新的复跑为准。）

在检出 `feature/development-repository-routing` 的工作树根目录运行；变异在 `git archive HEAD` 导出树里做（`$TMPDIR` 下的唯一目录，复制了各 `node_modules`，没有 `.git`），用完删除。树对象标识被验证的代码内容，整合提交不改变它们（`git rev-parse HEAD:packages HEAD:tests` 回读）。

| 命令 | 结果 |
|---|---|
| 评审者的探针 `mutate3.mjs` 的 Y3、Y4，在 `git archive 482c5dc3` 的导出树上（加锚定断言之前） | 两条都 SURVIVED，165 / 165 |
| 同一导出树换上 E2、E3 的句尾锚定断言（基线仍 165 / 165）后重跑 Y3、Y4、M47、M48 | Y3 红 2 条（E3）、Y4 红 2 条（E2）；M47、M48 照样各红 2 条 |
| 评审者的探针 `steps.mjs`（`482c5dc3` 与修复后的两棵导出树，替身与 SQLite 各一遍） | 两棵树结果相同：两个连接都有 repo-alpha，B0 歧义 `conflict(reapply, retry=false)`；B1 只挂 dev-a 开始工作 `confirmed/ready`；B2 挂回两个 `confirmed/ready`；B3 之后只挂 dev-b 想换过去 `failed conflict`，文案「……绑定 id 变了……只能让原来的 Development 连接以原绑定 id 挂回来」。只有歧义文案不同：修复后步骤之前多了「也还不能把已登记的仓库改绑到别的连接，所以仓库在几个连接里都有时，要选定由哪一个来服务它：」 |
| 红阶段：只改 E2、E15 的期望后四文件命令 | 165 条里 4 条失败（E2、E15 各在两种 Storage 上），原因都是文案 |
| 绿阶段：改 `development-route.ts` 的歧义文案后同一命令 | 165 / 165 |
| `node_modules/.bin/tsc --noEmit` | 无输出 |
| 四文件命令（`Plan of Work` Batch 1 的第一条） | 165 / 165（本轮只加断言，不加用例） |
| 加 `tests/e2e/delivery-lineage.test.js` 的五文件命令 | 172 / 172 |
| `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` | 1352 / 1352 |
| `node --test --test-timeout=120000 tests/mvp0`；`pnpm run boundaries` | 7 / 7；8 / 8 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 552 / 1000，文档 1132 / 1500（规划上限 800 / 1300；代码含测试，比第二轮多 10 行，都在 `tests/e2e/start-work.test.js`：两条锚定常量与注释、E2 与 E3 的断言、E2 的提示断言；歧义文案与 E15 的断言是原地改写，行数不变） |
| `node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/workflow-check.mjs`；`git diff --check origin/main...HEAD` | 机械扫描通过（exit 0）；`workflow-check: no findings`；exit 0 |
| exec-plan 技能的 `lint_execplan.py` 检查本文件；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js` | `OK: ExecPlan passed lint checks.`；9 / 9 |
| 变异表 M1–M51（上一节），导出树四文件命令基线 165 / 165；驱动脚本解析表里的 `-` / `+` 文本逐条应用 | 51 条全部：目标文本恰好出现一次并已改写（`cmp` 报告文件已变，`git diff --no-index -U0` 的 `-` / `+` 行数不为零）、点名的用例都在红集合里、红的条数与表中「实测」列逐条相同（M12 121、M31 104；M49、M50 各 2，M51 4）；每条用 `/bin/cp -f` 还原并 `cmp` 确认逐字相同；还原后 165 / 165；导出目录用完已删除 |
| 评审者的 `mutate3.mjs`（X1–X18、M43r2、M44r2、Y1–Y5、Z1 共 26 条，加表里解析出的 M1–M51；其中 M43r2 的锚点文本改成新的歧义文案） | 77 条全部 KILLED，表里 51 条红的条数与「实测」列逐条相同；基线 165 / 165，还原后 165 / 165 |

### 拟新增的技术债务（Batch 3 逐字追加到 `docs/exec-plan/tech-debt-tracker.md` 的 Open Items 表，列与既有行相同）

（TD-035、TD-037 的「下一步」在评审修复轮按 D23 改写、第二轮修复按 D26、D27 写成最终事实，下表与技术债务表逐字相同；其余三行未变。）

| ID | 日期（本地） | 状态 | ExecPlan | 子系统 | 分支 | 记录者 | 简述 | 延期理由 | 遗留影响 | 下一步 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-035 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-development-repository-routing.md` | 查询（`packages/core/src/queries.ts` 的 `workspaceMetadata`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 工作区元数据按 capability key 经 `bindingForCapability` 汇总；Development 有两个及以上挂载时 key 级解析 fail closed，全部 `development.*` key 报 `unavailable`（文案「没有挂载提供能力」），ui-model 的开始工作入口据此禁用 | 跨 PR 契约 K3 规定 #219 不改 `queries.ts`（#222 正在改它）；#127 之前没有生产路径能组装出两个 Development 挂载 | 多挂载工作区的界面把能用的开始工作显示为不可用，原因文案也不对 | 按人类伙伴 2026-10-08 的裁决（`docs/exec-plan/completed/2026-10-08-development-repository-routing.md` D23）：#127 的元数据按绑定给出（即「每个绑定的有效访问快照」），#142 的开始工作对话框按选中仓库的路由结果判定可用性，并以「绑定仓库」恢复动作取代 `reapply`；这两条已先后写成决策评论（#127：issuecomment-6058141177；#142：issuecomment-6058141929），人类伙伴 2026-10-08 又裁决「Add both (Recommended)」（D26），协调者已在两个 issue 的 Acceptance criteria 末尾各加一条验收框——#142：开始工作只在仓库路由到能服务它的 Development 连接时提供，另一个可用连接不能使它可用（组件测试）；#127：仓库元数据按 Development 连接给出，绑定仓库时记下由哪个连接服务；评论与验收以 `gh issue view <n> -R SingularityKChen/harness-projects --comments` 回读为准，落地时关闭本项 |
| TD-036 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-development-repository-routing.md` | 路由（`packages/core/src/development-route.ts`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 已登记仓库的锚点查找依赖「`RepositoryRecord.id` 等于锚点身份的 `externalId`」这条约定（唯一写者 `registerParents` 如此写），并因 Storage 端口没有按 id 取身份的方法，对每个 Development 挂载调一次 `findExternalIdentity` | 加 `getExternalIdentity(id)` 要改端口、两个适配器、契约套件与成员锁，多约 60–100 行，并与 #221、#223 的端口改动冲突 | 内部仓库 id 与外部 id 一旦解耦而路由没跟着改，所有已登记仓库都会被拒为「绑定 id 变了」（fail closed，不会读错连接） | #127 引入绑定仓库命令时，同一 PR 改 `routeDevelopment` 的锚点查找（按 id 取身份，或让挂载记录直接带引用），并加入并列引用的选择 |
| TD-037 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-development-repository-routing.md` | 谱系读取（`packages/core/src/chain-facts.ts`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 多 Development 挂载的工作区里，谱系的 Development 读取（`resolveRepository`、`readHeadCommit`、`readChangeRequest`）仍按 key 解析，退化为缺口；文件头「同一外部 id 视为各 provider 下的同一对象」的假设没有被取代 | 跨 PR 契约 K3：#219 不改 `chain-facts.ts`，#221 正在把其中的 Development 解析收拢到一个缝函数 | 多挂载工作区的交付谱系在提交与变更请求两跳只有骨架与缺口；不会读错连接 | 按人类伙伴 2026-10-08 的两次裁决（`docs/exec-plan/completed/2026-10-08-development-repository-routing.md` D23、D27）：接线与正例改由新 issue #297（`feat(core): route delivery lineage reads through repository routing`，#216 的子 issue）承担，等 #219 与 #221 都进 main 之后再做，更正 D23 原定的「#292 rebase 到 main 时承担」，#292 不再需要等 #291 合并；#297 把缝函数 `developmentReadBinding` 的函数体换成 `routeDevelopment`（同时适配 #289 的分页），并带正例「两个 Development 挂载、仓库登记在 A，只调 A 并记下提交与变更请求跳」，该正例在缝没接上时必须变红；这一交接已写成 #221 的决策评论（issuecomment-6060231866）；按跳锚定与并列引用归 #233 |
| TD-038 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-development-repository-routing.md` | 装配与登记（`packages/core/src/registry.ts`、Storage 的挂载行） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 多挂载工作区没有登记仓库的生产写入口：#219 的多挂载用例经 Storage 端口种入仓库挂载与身份（旁证）；另外用更少的 provider 重新组合后，没列出的旧挂载行仍以启用状态留在 Storage（#197 的遗留），`listProviderBindings` 读回比 Registry 多，过期行还可能带 `isDefault = true`（依次组合 `[c]`、`[a, b]` 后，读回里 `c` 仍是默认，而 Registry 里 `a`、`b` 全是非默认；替身与 SQLite 一致） | 绑定仓库与解绑命令属于 #127；清理没列出的挂载要先定义解绑语义 | #127 之前多挂载只能由测试或宿主直写 Storage 建立；读回列表可能含已不在 Registry 的挂载，其中可能有一个过期的默认行，与「读回的角色与 Registry 一致」只在被组合的挂载上成立（路由只看 Registry，所以不会读错连接） | #127 落地时把 `tests/e2e/start-work.test.js` 的 `bindRepository` 种入改为走绑定命令，解绑写 `enabled = false`；#127 / #132 在组合时把未列出的挂载写成 `enabled = false` 并降为非默认 |
| TD-039 | 2026-10-08 | Open | `docs/exec-plan/completed/2026-10-08-development-repository-routing.md` | 开始工作（`packages/core/src/start-work.ts` 的 `registerParents`） | `feature/development-repository-routing` | #219 设计定稿（Claude） | 单 Development 挂载的工作区里，未登记的仓库仍隐式路由到唯一挂载，并由开始工作在写前事务里懒登记仓库身份与挂载；#127 的绑定仓库命令落地后，这里会成为同一事实的第二个写者 | 跨 PR 契约 K3 要求单挂载行为不变；否则开始工作要等 #127 才能用 | 两个写者对「仓库属于哪个连接」可能写出不同形状（例如 #127 写并列引用，懒登记只写一条） | 由 #127 决定去留：保留则两者共用一个登记函数，取消则单挂载未登记也改为结构化拒绝 |

## Outcomes & Retrospective

设计定稿阶段的结果：三份设计在「路由来源」上二比一，采纳持久化事实（α、β）；在「注入表」上采纳联合类型（α、β）；在「角色」上采纳 α 的「唯一挂载才是默认」；在「路由键」上采纳 α 的内部实现加 β / γ 的操作亲和与「结果带引用」；γ 报告的「换连接把 Ready 判成 Failed」由路由构造关闭，并补了判别用例。相对三份设计删掉的机制：γ 的路由表、槽位与谱系钉住参数；β 的 `BindingRole` 枚举、`routeRepository` 纯函数、并列引用读取与 `development-provider.ts` 注释；α 的「拒绝空数组」与独立集成测试文件。原型实测代码约 297 行，远低于 800 的规划上限。

实施阶段的结果（实现者与最终验收者，2026-10-08；三轮独立对抗验证的 11 条、7 条与 4 条发现都已处理）：

- **与设计对照没有偏差的部分**：Batch 1 红 / 绿的用例集合、Batch 2 的红集合（E1–E3 红、E4 绿）与绿后的用例数（131、142、全量 1213）都与计划逐条相同；R1 的复现输出从 `failed failed not_found failed` 变为 `ready unknown result_unknown ready`。这些是首版实施的结果；对抗验证之后的数字见下一条。
- **规模**：首版代码 298 行；最终验收之后代码 508 行（实现 200 + 测试 308；规划上限 800、CI 上限 1000），文档 868 行（`node scripts/rule-checks.mjs size origin/main`；规划上限 1300、CI 上限 1500；第一轮修复后是 449 与 797，第二轮修复后是 493 与 842）。Superseded by 本条下一行的回读命令与评审修复轮观察（2026-10-08）：行数是易失值，评审者在 `eccfab2` 上实测文档为 870 而不是 868；以后只引用命令与带树标识的观察，不引用裸数字。
- **规模（回读命令与观察）**：命令 `node scripts/rule-checks.mjs size origin/main`，在检出本分支的工作树根目录运行；期望代码 ≤ 800（规划上限）、≤ 1000（CI 上限），文档 ≤ 1300、≤ 1500。2026-10-08 评审修复轮的观察（基线 `origin/main@a357ef8`，`packages` 树 `f462e77`、`tests` 树 `b7b410b`）：代码 512 / 1000，文档 970 / 1500（文档含本计划与评审记录，回填会使其略增，以现场输出为准）。
- **偏差**：首版有一处（第二轮对抗验证又订正了其范围，见下）——单挂载拒绝的错误码、恢复动作与文案与「单挂载行为不变」不符（首版误以为只有文案不同，D15 把它留给评审者）；对抗验证证明属实后已按根因修复（D16），257 + 256 项差分与 `origin/main` 逐项相同（唯一差别是 D8 的「换了连接」一类，第二轮对抗验证把它的范围订正为：新连接零调用、一律写前 conflict、文案点名外部身份，含过期续跑与 `getRepository` 失败码，D19）。测试文件集合没有越界：拒绝先后的对照挪回 `tests/e2e/start-work.test.js`，`start-work-sqlite-registration.test.js` 保持不改。
- **对抗验证之后的结果**：四文件命令 163 / 163、加 `delivery-lineage` 的五文件 170 / 170、全量 1241 / 1241（起点 1206 加 35：C2 一条、I1 与 I2 各两条、e2e 30 条）、`tests/mvp0` 7 / 7、`pnpm run boundaries` 8 / 8、`tsc --noEmit` 无输出；变异 M1–M42 在最终树上全部变红。第二轮 7 条发现里 6 条属实（3 条判别缺口、1 条订正范围、1 条文档的 Superseded 与引用、1 条等价死代码），1 条是 PR 描述事项（D7、D9，由协调者写）；第三轮 4 条里 3 条是判别缺口（多挂载注册门、key 级解析的三个对等挂载、路由拒绝的写尝试），最终验收补了用例与 M39–M42，1 条是 PR 描述事项（D7、D9、D19）。
- **评审修复轮结果**（2026-10-08）：独立评审（APPROVED，1 × P2、4 × P3）全部处理，其中 P2 与 K3 接线两条是人类裁决（D23）、文案与文档三条是本轮修复（D24）；代码改动只有两条 conflict 文案，行为、错误码与恢复动作不变；变异表扩到 M44，最终树整表重跑（`Artifacts and Notes` 的「评审修复轮的复跑」）。
- **最终验收结论**（验收者，2026-10-08）：#219 验收 1、2、3 由替身与 SQLite 两种 Storage 上的 E1–E14、C1、C2、I1、I2 证明；验收 4（单挂载行为不变，D8 / D19 除外）由 S1、S2 与 1280 项独立差分证明；验收 5 如实为部分（真实 Local Git + GitHub 装配随 #231 / #132）；验收 6–9 的命令在最终树上复跑通过。实现没有发现缺陷；唯一的实现改动是一处等价重构（D22）。待人类在评审时裁定的只剩 D7、D9、D19 三个解读（以及 D2、D3、D6、D14 标注的「可由人类推翻」）。Superseded by D23（2026-10-08）：人类伙伴已裁定这些全部保持原样，不再待裁。
- **未做**：原文是「整合成交付物级提交、backup ref、精确 force-with-lease 推送与回读，由协调者执行；PR 描述需把 D7、D9、D19 列为待人类确认的解读；人类专属事项（ADR 采纳、Project `Status`）不在本计划内；合并后才把本计划移到 `docs/exec-plan/completed/`」。Superseded by `Progress`（2026-10-08）与 D23：整合与快进推送已由协调者完成，D7 / D9 / D19 已裁定保持原样，本计划已在评审修复轮归档。现在剩余的只有：评审修复轮提交的整合与推送、推送后对 head / checks / 评审线程的回读（协调者）；第二轮修复提交的整合与推送（协调者）；#127 / #142 的决策评论与验收框（已写、已加，D26）；K3 接线与正例（原定 #292，D27 更正为 #297）；合并（人类伙伴，rebase merge）；人类专属事项（ADR 采纳、Project `Status`）不在本计划内。
- **第二轮评审修复结果**（2026-10-08）：独立评审第二轮（5 × P3）全部处理：文案（D25）、TD-035 与承接 issue 的验收（D26）、K3 接线方（D27）、规格副本的 Superseded、评审记录的更正；PR 描述由协调者改。代码改动只有两条 conflict 文案与一条注释，错误码、恢复动作、可重试性与路由行为不变；新增 E15（逐字执行歧义文案的三步），E3、E7 末段执行缺路由的恢复；变异表扩到 M48，12 条既有变异的条数随新用例更新，最终树整表重跑全部变红（`Artifacts and Notes` 的「第二轮评审修复的复跑」）。
- **第三轮评审修复结果**（2026-10-08）：独立评审第三轮（4 × P3，其中 1 条非机械）全部处理：句尾锚定（E2、E3 的 `$` 断言，禁词表保留作补充）、歧义文案在步骤之前补「登记之后撤不回」的提示（协调者决定，D28）、变异表说明里的旧数字与 Surprises 里残留的接线方 #292 就地更正。代码改动只有歧义那一条 conflict 文案；错误码、恢复动作、可重试性与路由行为不变；测试只改断言，用例数不变（四文件命令仍 165）；变异表扩到 M51，最终树整表重跑全部变红（`Artifacts and Notes` 的「第三轮评审修复的复跑」）。

## Bottom Change Note

- Change Note (2026-10-08 00:40 CST)：创建本计划。读完三份独立设计与跨 PR 契约，在起点只读复现关键事实，在一份不入库的拷贝上做原型并跑完 18 条变异，据此裁决分歧、定稿接口、拒绝语义、测试与变异表，列出 TD-035–TD-039 的全文；在 `docs/README.md` 的 Active 索引加一行。
- Change Note (2026-10-08 00:52 CST)：按计划执行 Batch 1、Batch 2（各一个本地提交）与 Batch 3 里实现者负责的文档收口。回填 `Progress`、`Surprises & Discoveries`（单挂载两处文案差异、时间戳说明）、`Decision Log`（D15）、`Artifacts and Notes`（实施期证据、变异实测列、文案对照）与 `Outcomes & Retrospective`；TD-035–TD-039 逐字追加到技术债务表；控制计划第 31 行与 Batch 2B 段就地标注；`docs/README.md` 状态列更新。
- Change Note (2026-10-08 01:50 CST)：对抗验证的 11 条发现处理完。P2：单挂载拒绝的错误码与恢复动作变了（根因：路由同时承担选挂载与过锚点门；改为先选挂载、再按调用方的顺序过门，缺路由时单挂载先过门再报 conflict，`resolveBinding` 恢复「没有绑定提供能力」）；补 E5–E8、E1 的账本断言、S1、S2、I2，E1–E8 参数化到两种 Storage；变异表重写为逐条 old → new 的确切文本并扩到 M1–M32。P3：TD-038 补过期默认行，capabilities 层注释去掉 core 路径，D7 / D9 记入 D18 留给人类确认。回填 `Progress`、`Surprises & Discoveries`、`Decision Log`（D16–D18）、`Artifacts and Notes`（单挂载差分、变异表）、`Outcomes & Retrospective` 与 `docs/README.md` 状态列。
- Change Note (2026-10-08 02:19 CST)：第二轮对抗验证的 7 条发现处理完。判别缺口：读回路由的 `'read'` 模式（E9，M33）、三个挂载的歧义与缺路由（E10–E12，M34–M36、M38）、注册门里两个读门的先后（S2 比较文案，M37）；订正 D8 的范围为「换了连接」一类（新连接 `getRepository` 失败码统一、过期续跑与终态接管不向新连接发调用、conflict 文案点名外部身份），补 E13 钉住过期续跑，新增 D19–D21；删除 `providerRegistry` 里的死条件；验证期望与 SHA 引用就地标 Superseded 或改写成可复现的规则，「评审结论待补」字样删除。变异表扩到 M38，最终树整表重跑；`Outcomes & Retrospective` 与 `docs/README.md` 状态列同步。
- Change Note (2026-10-08 02:56 CST)：最终验收。通读 diff 并按 issue 与本计划复核验收；第三轮对抗验证的三条判别缺口补 E14、C2 的三个对等挂载、E5 与 E13 的账本断言，变异表扩到 M42 并在最终树整表重跑（条数随 E14 更新）；`routeDevelopment` 的兜底拒绝复用 `unsupportedCapability`（D22）；独立复跑 R1 与 1280 项单挂载差分。回填 `Progress`、`Surprises & Discoveries`、`Decision Log`（D22）、「对抗验证后的修订」第 29–32 步、`Artifacts and Notes`（实施期证据与差分）、`Outcomes & Retrospective` 与 `docs/README.md` 状态列。
- Change Note (2026-10-08 19:30 CST)：评审修复轮。独立评审（APPROVED，1 × P2、4 × P3）逐条处理：rebase 到 `origin/main@a357ef8`（无冲突）；两条 conflict 文案改成用户能执行的动作并补断言与 M43、M44（D24）；人类裁决合并顺序 #290 → #291 → #292、K3 接线与正例由 #292 承担（D27 更正为 #297）、D2 / D3 / D6 / D7 / D9 / D14 / D19 保持原样（D23），TD-035、TD-037 的「下一步」与 K3 条目、交接表、验收第 10–11 行同步；Purpose 写明「Local Git 与 GitHub」指各管不同的仓库；状态行、「未做」、规模与 Progress 里被取代的陈述就地标 Superseded，行数改成回读命令加观察；计划归档到 `docs/exec-plan/completed/`，索引、控制计划、技术债务表同步，评审记录写入 `docs/review/pr-291-mmp-review.md`。
- Change Note (2026-10-08 CST，第二轮)：第二轮评审修复。两条 conflict 文案改成今天走得通的步骤（没有绑定仓库的命令，改绑会被 `Storage.putRepository` 拒绝），补 E15 与 E3、E7 的恢复步骤、M43–M48（D25）；人类裁决 #127 / #142 补验收框（D26）与 K3 接线改由 #297 承担（D27），TD-035、TD-037、K3 条目、交接表、验收第 10–11 行与 I1 注释同步；规格里的 `routeDevelopment` 副本就地标 Superseded；评审记录追加「第二轮修复」。
- Change Note (2026-10-08 CST，第三轮)：第三轮评审修复。E2、E3 对两条 conflict 文案的整段动作做 `$` 锚定的相等断言，补上禁词表挡不住的句尾追加（Y3、Y4，M49、M50）；歧义文案在步骤之前补「登记之后撤不回」的提示（协调者决定，D28），E2、E15 同步，M51 去掉提示变红；变异表说明与方法段落的旧数字对齐实测（M12 121、M31 104；51 条、165），Surprises 里残留的接线方 #292 就地更正为 D27 的 #297；规格副本、验收第 6、11 行、Surprises 与 D25 就地标注。评审记录追加「第三轮修复」。
