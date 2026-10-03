# Provider 连接实现身份与原子注册 ExecPlan

> 状态：Completed（2026-10-03）：Batch R 实现、独立复核（修复轮 1 后通过）、验收与第一轮 MVP 评审修订完成，变基到 `origin/main` 后 #253 组合门已执行；第一轮修复的独立复评在 `2cb5baa` 上 APPROVE 并另提 2 条 P3，已在本地修订（见 Decision Log「第二轮复评」）；ready 与合并由人类决定，以 `gh pr view 255 -R SingularityKChen/harness-projects --json state,reviewDecision,mergedAt` 回读为准
> 创建：2026-10-01；关联：#197；规范：仓库根 `PLANS.md`
> 范围：静态连接实现定义、完整挂载注册与域正确路由；不改变连接锚点/工作区挂载存储模型

## Purpose / Big Picture

用户能把同一连接在一个工作区挂到 Planning 和 Development 两个域，读回时两个挂载同时存在，随后读写命令进入提供相应能力的实例。
同 id 改实现必须拒绝；任一快照失败或后续挂载冲突都不能留下新工作区、孤儿锚点或半批挂载。执行取消必须回到签发该运行的 Execution 挂载。
最小可观察证据是同一套 fake/SQLite 正负控：合法共享读回两行、错误共享整批回滚、Development/Delivery/Execution 三类调用各命中正确实例。
当前用户授权 spec、plan 与 draft。本文可被审阅并用于 draft；产品代码实施须经人类评审，不能以计划 lint 通过替代该门，也不自动 ready 或 merge。Superseded by Decision Log「进入产品实施」（2026-10-02）：实施门由人类伙伴当日在会话中的明确要求开启；ready 与 merge 仍由人类决定。

## Context and Orientation

2026-10-01 21:09 CST，设计检出为 `fix/provider-binding-registration`、基线 `df199a59220cfc32d6cc734116c55b38eec7abd6`，工作树上下文 `.worktrees/provider-binding-registration`。
2026-10-03 评审修复时分支变基到 `origin/main`（已含 #251 仓库身份契约与 #253 SQLite 开始工作），此后的基线以 `git merge-base HEAD origin/main` 回读；`df199a5` 是此前各轮证据的基线。
实施前重读 `git rev-parse HEAD`、`git status --short --branch`；观察 head 不同则重新核对本文接口和预算，不能沿用旧红绿结论。
根 AGENTS、PLANS、`docs/development/workflow.md`、`docs/development/publication.md` 和 ADR-0006 约束本任务。
`packages/core/src/registry.ts::registerBindings` 当前把 domain 写成 implementationKey，并按 bindingId 全局拒绝重复；`context.ts::createContext` 先写 workspace，再逐条读取/登记。
`packages/capabilities/src/storage.ts::ProviderBindingRecord` 已定义连接锚点和工作区挂载视图；两个 Storage 实现允许同 id 同实现跨域、拒绝同 id 异实现，不需新表或新列。
`packages/capabilities/src/registry.ts` 持有完整 BindingRef，但 `core/capabilities.ts::resolveWriteTarget` 与 `chain-facts.ts::gated` 丢掉域后按裸 id 重找。
`core/execution-run.ts::cancelExecutionRun` 也只按签发 bindingId 找第一条；合法共享连接会把取消误投到 Planning。
`ProviderCapabilitySnapshot` 含 bindingId、capability、permission、observedAt，没有 domain；共享对象可合法提供多域 union 快照。
实际实现是 fake 四个 port、Local Git Development、GitHub Projects Planning、Human Execution；其他 Provider 包目前仅占位。
Host 注入实例和凭据句柄，Core 组合，Storage 保持权威映射；Core 不 import concrete Provider，不调用平台名映射。
本稿综合两份独立注册设计后做第三方源码核对；没有把临时设计输入路径作为仓库正式依赖。

## Design / Spec

### 从根定义身份与作用域

implementation 是一套连接语义兼容的具体实现族，可提供一个或多个能力域；implementationKey 由该实现作者的静态定义拥有。
它不表示能力域、账号、类名、平台名或当前权限；单域实现包是实现族的特例，多域实现不能以“都访问同一平台”推断相等。
connection 是 Host 分配稳定 bindingId 所指的连接实例，Storage 实例内可跨工作区/域共享；同 id 的 implementationKey 不可更换。
workspace mount 是 `(workspaceId, bindingId, domain)`，表示工作区启用连接的某能力域；enabled/isDefault 是挂载事实，不是连接身份。
capability domain 是 Planning/Development/Delivery/Execution/Storage 的接口类别；已知 key 的域前缀用来切片能力和选择 port。
role 是本次工作区装配意图：域主槽位 primary 与 executionFallback；它不进入连接锚点、外部身份键或账号自然键。
同 id 同 key 不同域是两个合法挂载；同 id 不同 key 是实现冲突；同 id 同域 primary/fallback 是重复挂载，不能覆盖持久化一行。
多个不同域适配器共享同连接时应引用同一导出定义；同 key 的域集合必须一致，顺序不影响集合相等，静默分叉定义必须拒绝。
静态定义由实现包拥有，Host 只注入实例与 id，Core 只透传并验证；禁止从 constructor.name、packageId、domain、URL 自动补 key。

### 方案比较与裁决

方案 A 为 Provider-owned 静态定义加明确域槽位：四个外部 port 必需 `definition`，现有 CoreProviderTable 明确各域主实例及 Execution 备用。
方案 B 为组成根显式 definitions/connections/mounts：Host 建一条连接再挂多个域，port 不新增成员，所有 CoreDeps 调用根破坏性更新。
B 让连接身份只声明一次，但还要定义同域多挂载/default/角色选择及调用根更新；这属于 #219 的主要表达能力，而非 #197 验收前提。
A 增四个 port 成员和七个实际实例定义、影响契约成员锁；B 至少影响八个 E2E、四个 integration、MVP0 和 Local Git fixture 的组装代码。
裁决选 A：它完整解决共享连接、整批注册和路由，保持单域一个主槽位，没有旧 API 桥或迁移层；保持清晰槽位是当前最佳边界，不是兼容承诺。
采纳 B 对连接实现族、union 快照、引用去重与原子发布的分析；否决把 implementationKey 放到动态 snapshot 中，身份与权限观察应分开。
否决 A 原稿“任何跨域 key 都拒绝”：snapshot 没有单域契约，应校验全部闭集成员后按 mount 域切片。
否决 B 原稿“默认不可用后按输入顺序寻找可用非默认”：这会改变目标并绕开权限；只选择明确目标，再判断其访问等级。
官方 [Backstage services](https://backstage.io/docs/backend-system/architecture/services/) 区分接口、实现 factory 和作用域；[Microsoft DI](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview) 展示显式 keyed 解析。
仅借鉴“显式身份/实例/作用域与先装配后发布”，不引入 DI 框架、反射、动态发现，也不把外部框架单工厂规则代入合法多域连接。

### 接口与静态定义

在 capabilities/registry 定义如下契约，经现有 index 星号导出；四个 port 用 type-only import 引用，避免运行时环。

    type ExternalCapabilityDomain = Exclude<CapabilityDomain, 'storage'>
    interface ProviderDefinition {
      readonly implementationKey: string
      readonly domains: readonly ExternalCapabilityDomain[]
    }
    // PlanningProvider / DevelopmentProvider / DeliveryProvider / ExecutionProvider 均新增：
    readonly definition: ProviderDefinition

实际实现导出冻结常量；fake 一份 `FAKE_PROVIDER_DEFINITION` 覆盖四域，各 fake 类引用它。Local Git、GitHub Projects、Human 分别导出 LOCAL_GIT_PROVIDER_DEFINITION、GITHUB_PROJECTS_PROVIDER_DEFINITION、HUMAN_EXECUTION_PROVIDER_DEFINITION 单域定义。
key 示例固定为 `harness.fake`、`development.local-git`、`planning.github-projects`、`execution.human`；这些是实现作者声明，不是 Core 的平台推断表。
未来多域真实连接必须由拥有其连接语义的实现族导出共同定义；两个单域实现不能仅改配置字符串冒充同一实现。
snapshot 原有四字段逐字保留；Storage port 不加 definition，也不混入外部定义支持域。
静态校验 definition 对象、非空精确 key、非空去重已知外部域集合及对槽位域的支持；不 trim 后改写身份。
先复制并冻结用于本次准备的 descriptor，防止 await 期间外部修改影响同 id 实现比较；key 相同而域集合不同视为无效输入。
注入表只允许 planning/development/delivery/execution/executionFallback/storage 键；非 undefined 未知槽位拒绝，缺 port 不伪造 Provider。
校验注入 port 的 describeCapabilities 和该域必需方法为函数；可选方法缺失允许，出现但非函数则拒绝。
workspace.id 若存在必须非空，name 必须字符串；先用既有默认值将省略的 id/statusPolicy 归一为 WorkspaceRecord，再校验 statusPolicy 的领域闭集，不能误拒合法省略值。policy 的全部 key/非 undefined level 也必须闭集成员。
缺 storage 仍返回现有 unavailableCore；它不产生 Registry。存在 storage 时，workspace 和全注册输入必须在任何写之前校验。

### collect → validate → commit → publish → bootstrap

以 `collectBindings({ workspaceId, providers, policy }) -> Promise<PreparedBindings>` 替换逐条写入的 registerBindings；新输入不包含 Storage。
PreparedBindings 只有 `bindings: readonly ResolvedBinding[]` 与 `records: readonly ProviderBindingRecord[]`；它们是内存准备结果，不是已发布 Registry。
先校验所有静态槽位/descriptor/policy，再收集全部被挂载 port 的 snapshot；执行主与备用都必须完成，不边读边落库。
单次 collect 可用 Map 以对象 reference 缓存 describeCapabilities 的 Promise；共享对象只观察一次，多域复用该结果。
对象 reference 仅减少本次 IO，不能成为持久身份、判断实现相等或推导权限；跨 compose 不复用该缓存。
snapshot.bindingId 必须非空；同对象共享多域天然同 id，同 id 不同对象的 descriptor key/支持域集合必须相等。
对 capability/permission 的全部 own keys 校验 CapabilityKey 闭集；非 undefined 值校验四态 AccessLevel，合法异域 key 允许存在。
未知 key 即使值为 undefined 也拒绝；已知 key 的 undefined 保持“未声明”；缺 permission 仍 unavailable，不授予能力。
先验证整个 snapshot，随后按 mount.domain 同步切 capability 与 permission，再 effectiveCapabilities(snapshotSlice, policy)，最后执行角色过滤。
主 Execution 去掉 execution.run.fallback；fallback 去掉 execution.run.start；不能让备用在主写门 read_only/unavailable 时成为主目标。
每主槽位 isDefault=true，Execution 备用 isDefault=false；只允许一条 enabled Planning，其他非 Execution 域本任务也只有一个主实例。
同 `(workspaceId,bindingId,domain)` 重复拒绝，包括主/备用共 id；同 id 跨域接受；不增加任意同域多实例入口。
PreparedBindings 完成所有 scope、tuple、Planning/default、port 和能力验证后，才进入单一 `storage.transaction`。
事务 work 仅 `tx.putWorkspace(record)` 和依次 `tx.putProviderBinding(record)`；不能调外层 storage 或 Provider 回调，不开嵌套事务。
已有锚点异实现由 Storage 权威拒绝；后序拒绝时整笔回滚 workspace 名称/policy、先写挂载、新锚点与旧默认变化。
不新增 getAnchor 预读、Schema 或迁移；本地事务是防竞态最终裁决，不用预查成功替代它。
事务 Promise ack 后才 `providerRegistry(prepared.bindings)` 并返回 CoreContext；validate 逻辑在 commit 前与 Registry 构造入口保持同一规则。
Registry 构造检查单 workspace、重复 tuple、默认/Planning唯一性和每条仅有本域 port；拒绝非法 public 输入而非 first-wins。
createContext 返回后，composeCore 才调用 bootstrapWorkspace；bootstrap 的降级不会撤销合法注册，但不得吞掉 collect/transaction 的拒绝。
注册 ack 只是本地装配完成，不是 Provider 外部写 ack，不改规划 Status、不产生 Saved、不启动工程执行。
失败以拒绝 Promise 表达：静态/快照形状是 TypeError（点名字段/域，不输出凭据）；snapshot 抛错原样失败；Storage 冲突沿用原错误。
不得把这些失败转成半份 Registry 或“空成功”；正常 unavailable/read_only/degraded 的合法能力快照仍可登记。

### 完整目标解析与签发者回路

ResolvedBinding 新增必填 isDefault:boolean；角色由槽位和过滤规则确定，不新增持久 role 列。
bindingForCapability 先按 key 的已知域筛选；主目标存在就检查它，即使 unavailable 也不另找可用实例。
ExecutionRunFallback 只选非默认备用；ExecutionRunStart 只选默认主；其他 Execution 读选择主，主缺失时才选择唯一备用。
只读 read_only 允许读，阻止所有写；degraded 可用但保留降级标记；未声明/无目标为结构化 NotSupported，不因 fallback 提升访问。
新增 bindingForRef(registry, ref) 严格匹配 workspaceId、bindingId、domain 并要求 enabled；缺失 undefined，重复输入拒绝而非第一条。
CommandGate 删除裸 bindingId，改为 `binding: ResolvedBinding | undefined`；允许态带同次 resolveCapability 解析对象。
resolveWriteTarget 直接使用该 gate.binding；写门拒绝返回 undefined/error，不再按 id 第二次 find。
chain-facts.gated 调用 gate.binding，resolveRepository 从同一个 binding.ref 构造引用；Development 与 Delivery 域均覆盖。
执行取消先核对 run.workspaceId 与当前工作区一致，再以持久 run.providerRef 的 id + 当前workspace + execution 域查签发者，检查该挂载自身 cancel 权限，不按默认或fallback角色重选；不允许使用当前挂载取消别的工作区运行。
保持取消现有终态拒绝、Provider ack 后状态/ref 同事务替换和并发复核语义；本任务不重写运行生命周期。
bootstrap、queries、delivery 的 gate 消费者只看 allowed/error，不重找实例；git-provisioning/start-work/rerunPipeline 经既有 WriteTarget 获得修正。
连接级的 external_identity/观察账本按 bindingId 定位不是 port 解析，不在 #197 改其键；多工作区游标缺口继续列为独立债务。

## Global Constraints

当前文档改动全集为 `docs/exec-plan/active/2026-10-01-provider-binding-registration.md`（新建；2026-10-03 归档为 `docs/exec-plan/completed/` 下的同名文件）和 `docs/README.md` 的索引行；计划由独立 reviewer 写、索引由主控写，临时 review 不提交。
本轮不改产品/config/tests/旧 ADR/旧计划、不安装依赖、不运行 pnpm run/install、不编辑 #251/#253 的树。Superseded by Decision Log「进入产品实施」与 Ruling 255-1（2026-10-02）：产品实施按下表允许集进行，`pnpm run <script>` 可用，#251/#253 的树仍不编辑。主控按用户授权提交文档、创建 draft 并投影相关元数据；不写 Status 或原生阻塞关系，不 ready 或 merge。
未来实施允许集和 added+deleted 预算只在此声明；new 表示将新建，未列路径不得修改。每个现有文件预算包含替换旧行的删除。

| 未来精确路径 | 符号/用途 | code+tests预算 |
|---|---|---:|
| packages/capabilities/src/registry.ts | ProviderDefinition、isDefault、validate/bindingForRef/域目标、四port锁 | 92 |
| packages/capabilities/src/planning-provider.ts | definition必需成员/type import | 5 |
| packages/capabilities/src/development-provider.ts | definition必需成员/type import | 5 |
| packages/capabilities/src/delivery-provider.ts | definition必需成员/type import | 5 |
| packages/capabilities/src/execution-provider.ts | definition必需成员/type import | 5 |
| packages/core/src/registry.ts | collectBindings/PreparedBindings/全量验证与切片 | 195 |
| packages/core/src/context.ts | 单transaction后publish | 34 |
| packages/core/src/capabilities.ts | CommandGate完整目标、WriteTarget | 34 |
| packages/core/src/chain-facts.ts | gated与resolveRepository | 24 |
| packages/core/src/execution-run.ts | 完整execution签发者定位 | 14 |
| packages/providers/fake/src/definition.ts（new） | 四域唯一冻结definition | 14 |
| packages/providers/fake/src/index.ts | 导出definition | 2 |
| packages/providers/fake/src/planning.ts | 实例definition | 4 |
| packages/providers/fake/src/development.ts | 实例definition | 4 |
| packages/providers/fake/src/delivery.ts | 实例definition | 4 |
| packages/providers/fake/src/execution.ts | 实例definition | 4 |
| packages/providers/development-local-git/src/provider.ts | 静态导出定义与实例成员 | 7 |
| packages/providers/planning-github-projects/src/provider.ts | 静态导出定义与返回对象成员 | 7 |
| packages/providers/planning-github-projects/src/index.ts | 显式export定义 | 3 |
| packages/providers/execution-human/src/index.ts | 静态导出定义与实例成员 | 7 |
| tests/integration/provider-binding-registration.test.js（new） | fake/SQLite同形注册/路由/失败矩阵 | 200 |
| tests/contract/capabilities-keys.test.js | 纯Registry域/role/默认与定义闭集 | 60 |
| tests/contract/suites/storage-identity-membership.js | 既有共享case扩正控 | 24 |
| tests/integration/human-execution-provider.test.js | 重复规则断言从id改mount | 5 |

合计758/800，余42。契约/成员锁112、注册/路由301、实际Provider声明56、判别测试/旧断言289，测试不豁免；预算是上限分配，实施须以 numstat 重算。
未来 docs 允许集为本计划（active→同名completed时生命周期移动）350、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`60、主控索引`docs/README.md`6；共416/1300，余884。Superseded by Decision Log「验收裁决 (a)」（2026-10-02）：另加两处最小订正——`docs/product/vertical-path.md` §2.1 第 2 行「生产入口」格、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`「多 Development 来源」行，各改 1 行，其余内容不动。Superseded by Decision Log「评审修复的文件集」（2026-10-03）：第一轮 MVP 评审修订另加 `docs/exec-plan/tech-debt-tracker.md`（追加 TD-019 一行）与 `tests/integration/README.md`（新增本测试文件一节、人工执行一节的一格随 `human-execution-provider` 用例名订正）；归档后 ADR-0006 与 prelaunch 计划里指向本计划的路径各改为 `completed/`，不新增行；代码只改 `tests/integration/provider-binding-registration.test.js`。
ProviderDefinition 加 port 成员是明确契约更新，没有兼容可选字段；所有实际 Provider 立即补成员，不保留旧snapshot key桥。
占位 planning-local/development-github/delivery-github-actions/execution-harness 无实例，不加伪声明；fake gate 只造snapshot，无需改。
Port `keyof` 旧精确数为 Planning12/Development12/Delivery8/Execution4，新精确数13/13/9/5，新增唯一定义成员；Storage37不变。
不得把 Exact 双向锁改成单向 extends、Partial 或宽string；StorageSurface保留原逐字golden，若#253增加成员由其owner同步。
现有 composeCore/createContext 所有调用根 shape 不变：八个E2E、MVP0 chain、GitHub bootstrap、Human、retry identity、step recording、Local Git fixture均消费已有factory实例。
它们无需机械改写 providers；对象原型/Proxy 包装继承新成员。搜索未发现自建 describeCapabilities 实现的旧测试stub；新增stub必须含definition。
保留原测试组/条数与所有旧断言；扩展身份地基第一条case，在另一个storage实例做同id同workspace跨域，不污染原数组期望。
identityFoundation仍4例、两adapter相关筛选仍2例；assembly/countSuiteCases/ASSERTION_BASELINE不改，新增assert不删除旧golden。
若实际 added+deleted 超800或需要 #219 表达，停止扩大实现并回到设计重分闭环，不能缩减安全测试或忽略删除行。

## Plan of Work

### Batch D · 当前设计与 draft 审阅闭环

最小闭环是正式计划落盘、八问semantic审查与专用lint通过，供主控建立关联 #197 的文档draft；只写Global Constraints当前允许文档。
对两稿做源码复核，确认implementation族、union切片、一次事务与完整路由，写下owner签名；人类审批是产品实施的下一门，不阻止当前文档准备。
验证是Concrete Steps的文档lint、标题顺序/预算和已执行baseline回读；恢复仅撤回这份新增计划，不触产品或其他树。

### Batch R · 未来注册能力闭环（待人类评审）

主文件是core registry/context、capabilities registry、三个目标消费者；实现与判别测试必须在同一可独立审阅/回滚的提交闭环。
先在新增integration中写现有半写、误路由与取消反例，针对baseline临时使用旧输入而不是因缺definition导入报错取得假红。
再更新静态定义/四port锁与七实例；编译失败应来自真实类型缺成员，不能放宽port契约；新增定义负控在新接口落地后执行。
实现collect/slice/validate、一个事务和后ack发布；对共享对象做一次观察，非法union先拒绝，合法union再验证每挂载只有该域keys。
修resolveWriteTarget、chain-facts及execution取消，调整唯一旧“binding id重复”断言为同execution mount重复，保留其原取消并发断言。
扩共享Storage case、运行fake/SQLite同形矩阵、相关真实Provider契约与E2E/MVP0回归，最后补ADR的#197机制收口。
相关回归有新失败才扩大test；受控环境中typecheck不可完成就保持实现门未通过，不能以Node类型剥离代替成员锁证据。
回滚必须整闭环revert，不能只撤注册或只撤路由。无Schema变更、迁移/旧库兼容、外部写入或持久身份清理。

### Batch V · 后续整体验收与交接

最小闭环是独立审阅同一最终head的注册和消费证据；主文件为本计划及ADR收口，不能把功能局部绿当产品完成。
先给#253冻结WriteTarget契约，再只读组合检出验证其已提交代码与本修正；不要求#253成为stack前置，不改其未提交树。
整理提交、diff规模与五类公开面检查；最终push/远端回读由获授权的实施任务执行，人类决定ready/merge，不自动推进规划Status。
若组合失败，先区分注册routing owner与#253供应生命周期owner；各自修所属路径，不互相复制权威逻辑。

## Concrete Steps

所有仓库命令在检出 `fix/provider-binding-registration` 的工作树根运行；本轮只文档lint与必要Node窄baseline，以下future标记不代表已经执行。Superseded by Artifacts「2026-10-02 实施证据」：除 #253 组合门外，这些命令已在 2026-10-02 对实现提交执行；#253 组合门与变基后的全量门在 2026-10-03 执行，见 Artifacts「2026-10-03 第一轮 MVP 评审修复证据」。
重锁执行上下文：

    git rev-parse --git-dir --git-common-dir
    git status --short --branch
    git worktree list --porcelain
    git check-ignore -v .worktrees/
    git rev-parse HEAD

期望分支正确、无无关改动、隔离路径被ignore；base移动后重测失效证据，不写共享历史。
当前文档专用lint使用exec-plan技能自带 `scripts/lint_execplan.py` 对Global Constraints当前计划路径检查，期望“OK: ExecPlan passed lint checks.”。
未来注册红绿与纯能力门：

    node --test tests/integration/provider-binding-registration.test.js tests/contract/capabilities-keys.test.js
    node --test --test-name-pattern='绑定锚点跨工作区共享' tests/contract/storage-contract.test.js
    node --test tests/contract/storage-contract.test.js

期望新增矩阵fake/SQLite两侧均pass，共享正负控2例仍pass，完整Storage装配与assertion守卫不减少、不变宽。
未来真实Provider/边界门：

    node --test tests/contract/planning-contract.test.js tests/contract/development-contract.test.js tests/contract/delivery-contract.test.js tests/contract/execution-contract.test.js
    node --test tests/contract/planning-github-projects-contract.test.js tests/integration/development-local-git.test.js tests/integration/human-execution-provider.test.js
    node --test tests/contract/package-boundaries.test.js

期望四port契约及实际实现全部pass，无Core→Provider反向依赖，无动态快照implementationKey重复事实源。
未来路由与调用根门：

    node --test tests/e2e tests/mvp0 tests/integration/github-projects-bootstrap.test.js tests/integration/start-work-retry-identity.test.js tests/integration/start-work-step-recording.test.js

期望旧调用根无需兼容桥仍可运行、MVP0仍7节点，Planning状态不被工程事件改写。未发生实现时不跑这批宽验证。
未来类型门可直接解析已安装二进制，不走pnpm：

    node --input-type=module -e 'import { createRequire } from "node:module"; const r=createRequire(process.cwd()+"/package.json"); console.log(r.resolve("typescript/bin/tsc"))'
    node node_modules/typescript/bin/tsc --noEmit

第二条仅在该标准symlink存在时执行，否则直接调用第一条返回的绝对bin路径；禁止把解析失败转成安装。期望exit0和四port精确成员锁成立。
#253后续组合只在包含双方审阅head的检出运行：

    node --test tests/integration/start-work-sqlite-registration.test.js tests/integration/local-git-core-provisioning.test.js

期望SQLite供应前置仍绿；当前基线缺新增文件时这是future，不跑缺文件来制造红。Superseded by Artifacts「2026-10-03 第一轮 MVP 评审修复证据」：变基到 `origin/main` 后两个文件都在，连同本计划的集成文件一起执行。
后续提交与公开面门：

    git diff --check df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD
    git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD
    node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6
    node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6

期望exit0并另按本计划800/1300更严预算核对added+deleted；仓库1000/1500绿不能替代本任务预算。Superseded（2026-10-03）：变基后四条命令的基线换成 `origin/main`，结果见 Outcomes「评审修复结果」。

## Validation and Acceptance

新增tests尚未写/执行；表内绿判据是未来验收，不是本轮实测。Superseded by Artifacts「2026-10-02 实施证据」：下表各行的红绿与变异证据见该处，#253 组合门除外（2026-10-03 已执行，见「2026-10-03 第一轮 MVP 评审修复证据」）。adapter矩阵复用同一scenario runner，不在fake/SQLite复制不同断言。

| 验收/反例 | baseline红或保护点 | future绿判据 |
|---|---|---|
| shared planning/development | 全局重复id拒绝且半写 | 同id同key读回两个域，Development写计数1、Planning错误调用0（Superseded by Decision Log「评审 P3-3」（2026-10-03）：改经 `core.commands.startWork` 判定——Development 分支与工作树各 +1，Planning 实例状态逐字不变；第二轮复评后场景 1 同 id 加挂 Execution，运行 +1 落在 Execution 实例上，另有备用 Execution 与其他域共享 id 的变体，见 Decision Log「第二轮复评」） |
| union共享对象 | 去重复后未切片会错域 | describe计数1、每挂载keys精确属域；域外合法key对照成功 |
| id异实现/descriptor不一致 | domain冒充身份 | 全静态失败0事务；已有Storage冲突整笔rollback，旧key仍可读 |
| snapshot后序抛错 | 已写workspace/首挂载 | transaction调用0、workspace不存在或旧name/policy未改 |
| 迟发挂载Storage拒绝 | 前序行已提交 | 整批rollback；新id以不同key重试成功证明无孤儿anchor |
| 同execution mount主/备用重复 | 当前只拒绝id而未证明无写 | 清晰重复tuple错误、0事务；异域同id对照成功 |
| unknown key/level/domain/slot | 当前没有闭集校验 | 在任何write前拒绝，包括permission单独污染；合法union对照成功 |
| Planning/default/scope | public Registry first wins | 多Planning/跨workspace/重复tuple/错误port拒绝；正常单域正控成功 |
| main权限+fallback | 可用备用替代主会错 | 主write read_only/unavailable拒绝；fallback仅显式fallback key可选 |
| readonly读/取消权限 | read/write混同会提升 | read_only读允许、写与issuer cancel拒绝；Provider写调用0 |
| Delivery/Development链读 | gated拿裸id第一条 | shared id各域实际分支/CR/pipeline/check调用正确，无假gap |
| Execution取消 | 裸id命中Planning或当前默认 | 按persisted issuer execution调用1，ack后状态/ref原子替换；其他port调用0；foreign-workspace记录拒绝且调用0 |
| publish时点 | 注册数组提前流出 | transaction ack延迟时createContext未完成；ack后一次完整Registry |
| 重复组装/Storage契约 | 重试新增身份或覆盖实现 | 同配置重复读回同元组；异实现拒绝原断言完整保留 |

同形测试使用fake与`:memory:`SQLite，事务proxy在第二个putProviderBinding后抛错，两侧比较完整workspace/mount/default前后值。
拒绝后用不同implementationKey重试失败批次新anchor，证明并非“list空但隐藏孤儿”；SQLite句柄在用例结束close。
路由独立正控直接建合法ResolvedBinding和最小context，避免注册先失败遮蔽错域；取消seed合法workspace/entity/repository/context/run父记录。
Delivery链读seed现有worktree/context，不运行StartWork供应以免混入#253前置；全矩阵不用真实平台或网络。
静态port锁精确内容是旧golden集合逐项加definition：Planning含describeCapabilities/getProject/listPlanningItems/getPlanningItem/listFieldDefinitions/listIterations/createIssueWorkItem/createDraftItem/updateWorkItemContent/updatePlanningFields/movePlanningItem/reconcile。
Development含describeCapabilities/getRepository/listBranches/getCommit/getChangeRequest/listChangeRequests/createBranch/createWorktree/getWorktree/createChangeRequest/removeWorktree/reconcile；Delivery含describeCapabilities/listPipelineRuns/listChecks/listDeployments/listEnvironments/rerunPipeline/cancelPipeline/reconcile。
Execution含describeCapabilities/startRun/getRun/cancelRun。四集合双向Exact；Storage原37成员保留。Node行为测试不能证明这些类型锁通过。

## Progress

- [x] (2026-10-01 21:09 CST) 独立综合两案，读注册/路由/端口/Storage共享套件与已提交#253接口，形成正式计划。
- [x] (2026-10-01 21:09 CST) 当前baseline锚点筛选2/2、capability keys5/5通过；未来矩阵尚未实现。
- [x] (2026-10-01 21:12 CST) Batch D：磁盘八问review与专用lint通过；24文件预算求和758，根13章次序通过。
- [x] (2026-10-02 06:58 CST) 主控完成索引及文档契约9/9检查；当前公开面与规模门按Artifacts记录，产品实现仍未开始。
- [ ] 后续实施交接前重读draft当前head/base、双向issue关联、元数据和checks，并由人类评审产品设计；发布状态以GitHub当前快照为准。Superseded by Decision Log「进入产品实施」（G1，2026-10-02）与「第一轮 MVP 评审」（2026-10-03）：产品设计的人类门由 G1 开启；推送后的 head/base/checks/issue 关联回读并入本节最后一项。
- [x] (2026-10-02 22:08 CST) Batch R：先写判别测试并在基线取得真实红（22/22 集成用例、2/7 纯 Registry 用例红，四个 port 成员锁在补 `definition` 前红于 TS2344），再实现静态定义、`collectBindings`、单事务发布、完整挂载路由与签发者取消；全部门见 Artifacts。
- [x] (2026-10-02 22:08 CST) Batch V 本地部分：ADR-0006 缺陷段就地标记收口，规模（added+deleted）与公开面检查，整理为实现与文档两个本地提交（复核修复轮 1 之后是三个，验收整理后重新是两个）；不 push。
- [x] (2026-10-02 22:40 CST) 复核修复轮 1：独立复核对 41 次变异找出 13 个存活，实现正确但七处静态校验、`execution.run.start` 只选主、`read_only` 读允许、cancel 的 `Unavailable` 与四个真实 Provider 的 key 字符串无判别测试，另有公开 `providerRegistry` 接受多个备用的规格缺口；补测试（含一处产品代码：每域至多一个备用）并逐项重放变异，证据见 Artifacts。
- [x] (2026-10-02 23:03 CST) 验收：逐条核对 issue #197 三条验收与 Validation 14 行（映射见 Artifacts「验收证据」）；行为不变的简化（派生域清单、`implementationKey` 命名、集成测试按可读性重排并让场景 1 经 `composeCore`）、13 次变异抽查、ADR-0006 原段就地标注、两处过期引用订正；计划提交之上整理为实现与文档两个本地提交，不 push。
- [x] (2026-10-03 11:10 CST) Batch V 的 #253 组合门（`start-work-sqlite-registration`、`local-git-core-provisioning`）：Ruling 255-1，#253 未合并且在另一 worktree，本轮不执行，保留为后续门；`resolveWriteTarget` / `WriteTarget` 公开签名保持计划冻结形状供其消费。2026-10-03 完成：#253 以 rebase merge 合入 main 后，本分支变基到 `origin/main` 执行；第一次组合（评审在合并预演上跑）就让本计划自己的集成测试红 4 条，即第一轮 MVP 评审的 P1，修复后组合门连同本文件 119/119，证据见 Artifacts「2026-10-03 第一轮 MVP 评审修复证据」。
- [x] (2026-10-03 11:10 CST) 第一轮 MVP 评审修订（评审 REQUEST_CHANGES：1 × P1 + 3 × P3，见 Decision Log「第一轮 MVP 评审」）：变基到 `origin/main`；P1 把 `seed()` 的仓库身份种类改为 `ExternalIdentityKind.Repository`；P3 三条——恢复路径写清锚点的双向不兼容、`PORT_METHODS` 等值锁登记为 TD-019、场景 1 改经 `core.commands.startWork` 并以变异证明判别力；回填组合门、`docs/README.md` 索引、`tests/integration/README.md`、提交号引用与行号；计划归档到 `docs/exec-plan/completed/`。只做本地提交，推送、线程回复与独立复评由主控执行。
- [x] (2026-10-03 11:38 CST) 第一轮修复的独立复评：评审账号在 `2cb5baa` 上 APPROVE，另提 2 条 P3（Execution 消费者缺判别测试、「M2 等价」措辞过满）；场景 1 同 id 加挂 Execution，新增备用变体并钉住拒绝文案，M1–M6 变异表见 Artifacts「2026-10-03 第二轮复评修复证据」；测试改动并入实现提交，文档改动并入文档提交，仍是三个本地提交，不 push。
- [ ] 独立复核同一最终 head、最终 push 后回读远端（head/base/checks/issue 关联/线程）与 ready/merge 决定：不属于本地实施任务。2026-10-03 起这一项还包括第一轮 MVP 评审之后的独立复评（人类伙伴规则：P0/P1 修复后须独立复评），同样由主控安排。

## Surprises & Discoveries

基线窄测已有“跨工作区共享”2例，但没有同id同workspace跨域正控；原case文案覆盖范围大于实际输入，需扩展它而非删断言。
两稿探针在fake/SQLite均见同id共享compose被拒且残留workspace/首Planning；源码逐条写入顺序确认此因果，Storage单次原子不等于注册整批原子。
2026-10-01本树直接解析TypeScript5.9.3后执行noEmit，实际placeholder.ts两处React TS2307；这是既有环境缺React类型，不能称typecheck绿。Superseded by 本节「2026-10-02 环境订正」。
Node现为v26.10.0，pnpm现为11.25.0而声明10.28.2；已知pnpm run会自动install，本轮不调用，不修依赖，不把自动安装当验证步骤。Superseded by 本节「2026-10-02 环境订正」。
port锁旧精确数量12/12/8/4/37由当前registry源码读取；新锁只增加四个definition，不能把Storage变更借机收进本任务。
2026-10-02 环境订正：本机 pnpm 为 10.28.2，与根 `packageManager` 一致，worktree 已完成 `pnpm install --frozen-lockfile --offline`，React 类型已就位，基线 `node node_modules/typescript/bin/tsc --noEmit` exit 0；因此 typecheck 是必须通过的实现门，`pnpm run <script>` 可用。
2026-10-02 实施发现：角色过滤（主 Execution 去 `execution.run.fallback`、备用去 `execution.run.start`）与 `bindingForCapability` 的角色选择是同一不变量的两道机制；变异删掉过滤后，原有 45 条用例仍全绿（变异存活），于是在重复挂载场景补观察断言（每个执行挂载的 key 表只含自己角色的键），两条过滤变异随后被杀。
2026-10-02 实施发现：原设计的「至多一条启用 Planning」检查被「每域至多一个默认且非 Execution 域只有默认挂载」蕴含，作为独立分支永远不可达，已删除（见 Decision Log）。
2026-10-02 修复轮 1 发现：此前 Artifacts 写的「29 次变异全部被杀」只覆盖了我选的守卫；独立复核另施 41 次变异（含计划逐条点名的静态校验），13 个存活（域集合顺序无关、definition 含挂载域、域去重、key 非空白、空 `bindingId`、已知 key 的 `undefined` 保持未声明、`workspace.name`、`execution.run.start` 只选主、`read_only` 读允许、cancel 的 `Unavailable`、三个真实 Provider 的 key 改名）。产品行为全部正确，缺的是判别测试；已在修复轮 1 补齐并重放。Superseded：「全部被杀」只指当时所列的 29 次。
2026-10-02 修复轮 1 发现：`fallback` 夹具从不声明 `execution.run.start`，使「start 永不落到备用」的断言空转（变异 `primary ?? spare` 存活）；夹具改为备用也声明 start 之后该断言才有判别力。
2026-10-02 修复轮 1 发现：`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 第 31 行「`implementationKey` 取的是域名」同样已被本计划推翻；该文件与 `docs/product/vertical-path.md` 一样不在允许集内，未改。
2026-10-02 实施发现：`docs/product/vertical-path.md` 第 104 行仍写「连接发生在组合期的 `registerBindings`」，该函数已被 `collectBindings` 取代；该文件不在本计划允许集内，未改，留给文档归口时订正。Superseded by Decision Log「验收裁决 (a)」（2026-10-02）：已在本 PR 订正。行号是 `df199a5` 上的；变基到 main 后同一格是 §2.1 表第 2 行、文件第 106 行，以 `grep -n collectBindings docs/product/vertical-path.md` 回读。

2026-10-02 验收发现：`docs/product/vertical-path.md` §2.1 规定「关闭本节引用的 issue 的 PR，必须在同一 PR 里更新对应行与这个基线」，第 2 行承接列含 #197，所以该格订正是本 PR 的义务，不是顺手修；该节首段的基线说明未改，日期标在格内（#253 在首段之后插入新段，同处再插会冲突）。
2026-10-02 验收发现：ADR-0006 收口段原写「上表 `SyncCursorRecord`」，该表在收口段下方；收口段还把「同 id 异 key」一律写成 Storage 拒绝，实际同一批内由 Core 在写前拒绝（`collectBindings` 的连接 key 检查），只有与既有锚点冲突才由 Storage 裁决；均已订正。
2026-10-02 验收发现：#253 的分支已给仓库测试脚本加 `--test-timeout=120000`（其 TD-010），覆盖复核 m-5（事务回调误用外层 Storage 时替身死锁、挂住而不是失败）。集成测试 `mountOf` 有两个从未被传入的参数（`id`、`isDefault`），已删。
2026-10-03 第一轮 MVP 评审发现（P1）：`tests/integration/provider-binding-registration.test.js` 的 `seed()` 把仓库挂载指向 `externalKind: 'branch'` 的身份。基线 `df199a5` 的 SQLite `external_identity.external_kind` CHECK 还没有 `repository`，只能借 `branch` 凑合；#251 合入 main 后两个 Storage 的 `putRepository` 都以 `repository external identity is not a repository identity` 拒绝非 `repository` 种类。于是本 PR 在自己的 head 上 27/27，与 main 组合后「链读」「取消回到签发者」在两个 Storage 上红 4 条，integration 层的非空全绿探针跟着红。Ruling 255-1 把组合门推迟到「#253 合并之后」，推迟本身合理，但它也推迟了这条缺陷的暴露：夹具里写进的是基线的 schema 限制，而不是领域事实。
2026-10-03 评审修复发现：评审的变异 M2（`bindingForCapability` 退回「第一个可用」）在本文件全部场景上等价存活，包括改经 `startWork` 之后的场景 1——域切片让每个挂载只带本域 key，「第一个可用」与「按域定位」在没有 Execution 主备的输入上选中同一个挂载；只有纯 Registry 用例（主不可用时不升级备用）能区分它。场景 1 能区分的是另外两类缺陷：写目标或其消费者退回按裸 id 重找（M1、M3），以及开始工作向同 id 的 Planning 实例写入（M4）。旧场景 1（测试自己调用 `createBranch`）对 M3、M4 都存活。Superseded by 本节「2026-10-03 第二轮复评发现」：「等价」只对选中的挂载成立，拒绝文案可以观察到差异，备用变体已把它钉住，M2 在集成层被杀。

2026-10-03 第二轮复评发现：① 场景 1 只覆盖 Development 消费者。`packages/core/src/start-work.ts` 里 Execution 的两处写目标消费者——`startExecution` 取 `target.binding?.execution`，`manualFallback` 取 `resolveWriteTarget(ExecutionRunFallback).binding`——退回按裸 id 重找第一条（M5、M6）时，全量 `tests/contract tests/integration tests/e2e` 1038 条仍全绿。它们与 M3 同类，只是场景 1 没挂 Execution，开始工作直接转人工降级，走不到这两处。② M2 不是等价变异。三条规则让选中的挂载在两种语义下相同：域切片；注册时按角色扣 key（主挂载不带 `fallback`，备用不带 `start`）；非 Execution 域只有默认挂载。但默认挂载声明了 key、等级是 `unavailable` 时，head 返回该挂载，由 `resolveCapability` 报「能力 X 当前不可用」；M2 跳过它，报「没有绑定提供能力 X」。这条文案会流到 `startWork` 的 `result.error.message` 与链读的 `gap.reason`。「当前不可用」分支是本 PR 才变得可达的，基线的 `bindingForCapability` 本来就排除 `unavailable`。

## Decision Log

Decision：选择A静态实现定义和明确域槽位，key owner是连接实现族；Rationale：满足跨域身份并控制调用半径，不捎带#219；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：union快照全闭集校验后按域slice；Rationale：snapshot无domain，多域对象本来合法，role过滤与权限仍分开；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：本地事务仅Storage IO、ack后唯一publish；Rationale：半注册必须由整批rollback消除，权限观察不能在事务内等待远端；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：目标携完整binding，取消查持久issuer；Rationale：id是连接身份而非域槽位，二次first-find不可接受；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：进入产品实施（Ruling G1）；Rationale：人类伙伴 2026-10-02 在会话中明确要求「继续基于本地 worktree 开发 PR#255-#257，目前已有 spec 和 plan」，这就是本计划「产品实施须经人类评审」的门；它不是 Status 或看板写入，也不授权 push、ready 或 merge；Date/Author：2026-10-02 21:54 CST / 主控转述人类授权。
Decision：Ruling 255-1/2/3——#253 组合门不执行；四 port 的 Exact 成员锁由 `tsc --noEmit` 证明；RED 用旧输入在基线取得半写/误路由/取消误投的真实红；Rationale：不触碰他人未合并的树，类型锁不能由 Node 行为测试代替，缺 `definition` 导入失败不是红；Date/Author：2026-10-02 21:54 CST / 主控。Superseded by Decision Log「第一轮 MVP 评审」（2026-10-03）：#253 合入 main 后本分支变基，组合门已执行。
Decision：`bindingForCapability` 返回「按 key 的域与角色定位的目标」，目标声明该 key 才返回，unavailable 与 read_only 的判定留给 `resolveCapability`/`gateCommand`；Rationale：目标不可用时绝不另找可用实例，原「第一个可用」语义删除，`resolveCapability` 的两条拒绝文案保持；Date/Author：2026-10-02 22:08 CST / 实施者。
Decision：`providerRegistry` 验证全部挂载（含未启用），`collectBindings` 写前调用同一入口验证整批；Rationale：只有一份规则来源，非法输入 fail closed，当前没有任何路径产生未启用挂载，不为假想路径放宽；Date/Author：2026-10-02 22:08 CST / 实施者。
Decision：保留角色过滤并补观察断言，不把它降为路由选择的冗余；Rationale：挂载的 capability 表必须如实反映角色，且变异实验证明此前无测试能观察它；Date/Author：2026-10-02 22:08 CST / 实施者。
Decision：取消时运行记录不属于当前工作区按「运行不存在」处理且不回显其状态；Rationale：外来记录的状态本身也是信息，必须与「不存在」不可区分；Date/Author：2026-10-02 22:08 CST / 实施者。
Decision：公开 `providerRegistry` 对每域非默认挂载至多一个（`collectBindings` 的注入表本来只有一个 `executionFallback`）；Rationale：计划要求「拒绝非法 public 输入而非 first-wins」与「主缺失时才选择唯一备用」，允许多个备用会让 `bindingForCapability` 取第一个，形成 first-wins；Date/Author：2026-10-02 22:40 CST / 实施者（复核修复轮 1，主控裁入）。
Decision：四个 Provider 定义（fake、Local Git、GitHub Projects、Human）的 key、域集合与冻结统一在 `tests/integration/provider-binding-registration.test.js` 的一条用例里逐字固定，不改 `Global Constraints` 之外的测试文件；Rationale：key 会落进持久化锚点，改名等同于换身份；各 Provider 自己的测试文件不在允许集内，一处固定也避免同一不变量四处重复；Date/Author：2026-10-02 22:40 CST / 实施者（复核修复轮 1）。
Decision：新增测试只依赖基线已有的导出（`createContext`、`resolveWriteTarget`、`readChainFacts`、`cancelExecutionRun`、`providerRegistry`），`bindingForRef` 的直接测试在实现之后补；Rationale：缺导出的链接错误不是行为红，`bindingForRef` 的行为由取消用例在基线驱动，直接测试补的是严格匹配与重复拒绝；Date/Author：2026-10-02 22:08 CST / 实施者。

Decision：验收裁决 (a)——`docs/product/vertical-path.md` 第 2 行与 `2026-09-29-prelaunch-system-architecture-renewal.md` 第 31 行做最小订正，扩展的允许集只记在 Global Constraints；Rationale：两处仍指向已删除的 `registerBindings` 与「key 取域名」，前者还受 §2.1「关闭引用 issue 的 PR 同步更新对应行」约束；前者在格内标日期，后者按仓库约定原文保留并就地标 Superseded；Date/Author：2026-10-02 23:03 CST / 验收者（主控裁定）。
Decision：验收裁决 (b)(c)——ADR-0006 原缺陷句后就地追加「已按前一种条件收口，见下段」，收口段订正方向词与拒绝归属，账号自然键与 `SyncCursorRecord` 等未收口原文不动；#253 组合门保持未完成（Ruling 255-1；Superseded by「第一轮 MVP 评审」（2026-10-03）：已执行）；Rationale：issue 验收 3 要求 ADR 不再把它写成开放缺陷，读者停在原句也要能看到已收口；他人未合并的树不检出、不编辑；Date/Author：2026-10-02 23:03 CST / 验收者。
Decision：验收裁决 (d)——集成测试按可读性重排（显示宽度 ≤160 列，抽出 `row`、`withLevels`、`executionContext`，`probe` 复用 `wrap`），断言与用例一条不减（`deepEqual` 22、`equal` 5、`rejects` 6、闭集拒绝 16 例、用例名除场景 1 外逐字相同），文件超出自己的 200 行分项，由代码 + 测试总额吸收（数值见 Outcomes）；场景 1 的重复装配改经 `composeCore`；Rationale：同一 scenario runner 在两个 Storage 上跑，密集一行式断言让评审定位困难；issue 验收 1 的字面入口是 `composeCore`，此前只经 `createContext`；Date/Author：2026-10-02 23:03 CST / 验收者。
Decision：复核 minor 的处置——m-5 不另加文件级超时，由 #253 的仓库脚本超时（TD-010）单一承担；m-6 的计数以「验收证据」为准；m-7（`PORT_METHODS` 手抄、无漂移锁）在 port 成员锁的注释里指向它，编译期等值锁登记为技术债（Outcomes）；Rationale：同一策略只留一个 owner；漂移只会削弱对无类型宿主的纵深校验，TypeScript 实现已被成员锁强制，等值锁约需 8 行条件类型，不在本闭环加；Date/Author：2026-10-02 23:03 CST / 验收者。
Decision：行为不变的简化——`PORT_DOMAINS` 取自 `CapabilityDomain`，`EXTERNAL_DOMAINS` 取自 `PORT_METHODS` 的键，`Mount.key` 改名 `implementationKey`，两处一致性检查先取已知值再比较；整理提交时保留计划提交 `e6a0a4b` 不动（变基后提交号已变；Superseded by「评审修复的提交整理与归档」（2026-10-03）），其后改写为实现与文档两个提交，整理前序列留在本地备份引用；Rationale：去掉手写的第二份域清单，消除与 capability key 混名；每步聚焦测试与变异抽查保持全红全绿；Date/Author：2026-10-02 23:03 CST / 验收者。

Decision：第一轮 MVP 评审（2026-10-03，REQUEST_CHANGES）：1 × P1（与 main 组合后 `seed()` 的仓库身份种类被 `putRepository` 拒绝，本计划自己的集成测试红 4 条）+ 3 × P3（恢复路径没写锚点的双向不兼容；三项延期债务没进 tracker；场景 1 的写调用计数来自测试自己的调用），无 P0 / P2；人类伙伴规则：P0/P1 修复后须独立复评，复评由主控另派；Rationale：P1 是 Ruling 255-1 推迟的组合门的实际结果，阻塞合并；P3 不影响运行行为，但改动机械、范围清楚，按 `docs/review/responding.md` 顺手修；Date/Author：2026-10-03 / 评审（评审账号）、主控转述复评规则。
Decision：评审 P1——变基到 `origin/main` 后 `seed()` 改用 domain 常量 `ExternalIdentityKind.Repository`，不改产品代码；Rationale：根因是夹具写进了基线 `df199a5` 的 schema 限制（当时 CHECK 没有 `repository`），不是领域事实；用常量而不是字面量，种类再改名时测试在取值处就失败；Date/Author：2026-10-03 / 修复实施者。
Decision：评审 P3-1——Idempotence and Recovery 写清已持久化锚点的双向不兼容与「删库重建」的恢复方式，把「不删除其他工作区/锚点」限定为代码不做清理；不改拒绝文案；Rationale：MMP 前不写兼容层或迁移是既定方针，影响只限本地开发库；文案由两个 Storage 适配器抛出，属于 Storage owner，且本计划的设计是「Storage 冲突沿用原错误」，在 Core 包一层提示会改这条设计；Date/Author：2026-10-03 / 修复实施者。
Decision：评审 P3-2——债务 ①（`PORT_METHODS` 没有编译期等值锁）登记为 `docs/exec-plan/tech-debt-tracker.md` 的 TD-019；② 随本 PR 的归档订正 ADR-0006 与 prelaunch 计划里的路径，不再是债务；③ 组合门已执行，也不登记；Rationale：tracker 是延期债务的事实源（`docs/README.md` §1）；TD-016～018 已分配给预计先合并的 #257，所以从 TD-019 起；若合并顺序变了，由后合入的一方重新编号；Date/Author：2026-10-03 / 修复实施者（编号由主控指定）。
Decision：评审 P3-3——场景 1 改经 `core.commands.startWork`：断言 Development 替身的分支与工作树各 +1、同 id 的 Planning 实例状态逐字不变，并把没有 Execution 挂载时的人工降级写成显式断言；保留 `resolveWriteTarget(PlanningStatusWrite)` 命中 Planning 实例的正控；用例名改为描述生产命令；Rationale：#253 合入后 SQLite 上的开始工作可用，生产写命令能直接当证据；判别力用 M1（写目标按裸 id 重找）、M3（开始工作的写前准备按裸 id 取挂载）、M4（Git 供应向 Planning 写）证明，不用评审举例的 M2，M2 在集成层等价（见 Surprises）；Date/Author：2026-10-03 / 修复实施者。Superseded by「第二轮复评」（2026-10-03）：M2 只是路由等价，拒绝文案可区分，已由备用变体钉住；场景 1 也加挂了 Execution。
Decision：评审修复的文件集——代码只改 `tests/integration/provider-binding-registration.test.js`；文档在 Global Constraints 已列文件之外加 `docs/exec-plan/tech-debt-tracker.md` 与 `tests/integration/README.md`，归档后 ADR-0006 与 prelaunch 计划指向本计划的路径改为 `completed/`；Rationale：tracker 登记 TD-019；集成测试说明按文件逐节登记用例与不变量，本文件此前未登记，人工执行一节的一格还写着本 PR 已改掉的旧用例名；Date/Author：2026-10-03 / 修复实施者。
Decision：评审修复的提交整理与归档——计划提交保留；P1 与场景 1 的测试改动并入实现提交；原文档回填提交与本轮文档、归档合为一个文档提交；整理前的序列留在本地备份引用 `backup/provider-binding-registration-pre-review1`；归档在独立复评之前完成，复评若再要求修订，在 `completed/` 下的本文件追加记录，不移回 `active/`；Rationale：实现、验收与评审修订都已完成，剩下的复评、推送回读与 ready/merge 是外部门；每个提交可独立回滚，实现与测试同进同退；Date/Author：2026-10-03 / 修复实施者（归档由主控指定）。
Decision：第二轮复评（2026-10-03，评审账号 APPROVE @ `2cb5baa`，另提 2 × P3）——① 场景 1 同 id 加挂 `execution`，断言开始工作 `ready / saved`、不降级，分支与工作树进 Development 实例，运行 +1 落在 Execution 实例上且 `runExternalId` 就是它，Planning 状态逐字不变；新增备用变体：`executionFallback` 与 Planning、Development 共用 id，主执行换 id，policy 把 `execution.run.start` 置为 `unavailable`，断言运行由共享 id 的备用实例落下、主实例 0 次。② 「M2 在集成层等价」改为「路由等价，拒绝文案可区分」；备用变体先断言写门对 `execution.run.start` 的拒绝文案是「当前不可用」，把差异钉住。仍是 P3，只修测试与证据，产品代码不变；Rationale：M5、M6 与 M3 是同一类回归，执行消费者也应有判别测试；文案是可观察行为，钉住之后 M2 在集成层被杀；两个场景只多 21 行代码，总量仍在 800 弹性线内；Date/Author：2026-10-03 / 复评（评审账号）、修复实施者。

## Idempotence and Recovery

同配置collect/compose可重复，snapshot仅是当前观察，Storage upsert保持同anchor key/挂载元组；任何拒绝以完整配置重试，不能从中间挂载继续。
失败事务恢复所有本批写；成功注册后bootstrap失败保留合法连接装配并按既有降级返回，不把它回写成空Registry。
无真实用户/数据、无Schema变更，代码回滚为整能力闭环revert；不建兼容接口，不迁移旧库，不删除其他工作区/锚点或凭据句柄（2026-10-03 订正：「不删除」指代码不做清理；开发库的恢复见下段）。
已持久化锚点双向不兼容（2026-10-03，评审 P3-1）：本 PR 之前锚点的 `implementationKey` 是域名（例如 `conn-x|planning|planning`），之后是实现定义的 key（例如 `harness.fake`）。前向——合入后继续用之前建的本地库装配，同一 bindingId 被 Storage 以 `provider binding id already points at another implementation` 拒绝；回滚——revert 本 PR 后继续用合入后建的库，得到同一条拒绝。两个方向的拒绝都是整批原子的，库里的行不变。恢复方式都是删除本地开发库（SQLite 文件；替身是进程内状态，重启即清空）后重新装配。没有迁移或兼容层（MMP 前不写兼容）；测试每例新建临时库，当前也没有 app 用持久化 SQLite 组装 core，所以影响只限开发者自己留下的本地库。
账号自然键、同域任意多实例/动态发现(#219)、多工作区游标、热配置删未列挂载不在本闭环；它们不会使当前合法跨域注册变成推迟项。
若实施发现这些缺口进入真实用户路径，在`docs/exec-plan/tech-debt-tracker.md`登记owner、触发条件和下一证据；本轮不改旧tracker，只保留明确边界。Superseded by Decision Log「评审 P3-2」（2026-10-03）：本计划的延期债务 ① 已登记为 TD-019。

## Artifacts and Notes

观察上下文（2026-10-02 06:58 CST）：检出 `fix/provider-binding-registration`、基线如Context所示的文档工作树；技能lint为OK，`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed/0 failed。主控索引使用与另两计划分开的锚点，最终差异重算 `git diff --numstat origin/main...HEAD`；此处不把计划预算称作已实施改动。

当前已执行证据@基线：`node --test --test-name-pattern='绑定锚点跨工作区共享' tests/contract/storage-contract.test.js`为2pass/0fail，capabilities-keys为5pass/0fail。
当前直接noEmit exit2，React TS2307；未来新增tests、完整类型门与#253组合门未执行。2026-10-01 21:12 CST磁盘八问review为pass，专用lint为OK，24个未来文件预算求和758、根13章相对次序正确，git diff --check无错误；计划本身325行。
公开面不写临时输入路径、账号或本机路径；所有仓库引用为相对路径，执行证据同时绑定分支/head/date。

2026-10-02 实施证据（在检出 `fix/provider-binding-registration`，即 `.worktrees/provider-binding-registration`，基线 `df199a5`，实现提交为本地未推送的 `10ac468`（Superseded by「验收证据」：验收整理把 `10ac468`、`19b67b9`、`e28b8ca` 改写为实现与文档两个提交，回读命令见该处）；回读 `git log --oneline origin/main..HEAD`，期望含该提交与随后的文档提交）：

- 真实红（基线 `e6a0a4b` 的产品代码 + 仅新增测试；`e6a0a4b` 是当时的计划提交，产品代码与 `df199a5` 相同，2026-10-03 变基后提交号已变）：`node --test tests/integration/provider-binding-registration.test.js` 为 22 tests / 22 fail——共享 id 装配被拒 `binding id conn-shared 重复`；快照后序失败后既有工作区被改成名称「新名」且留下 `conn-shared|planning|planning|true|true`（半写）；事务探针 `[0, true]`（期望 `[1, false]`，基线没有事务）；写目标命中 `FakePlanningProvider`（期望 Development）；链读 gap `development.repository.read: 绑定没有该域的 provider 实例`；取消 `not_found`、Provider 调用 0，而别的工作区的运行被真取消（调用 1）。`node --test tests/contract/capabilities-keys.test.js` 为 5 pass / 2 fail（`providerRegistry` 不抛、`bindingForCapability` 在主不可用时返回备用 `run-2`）。
- 类型锁红：四个 port 的 `keyof` 锁补 `'definition'` 后、port 未补前，`node node_modules/typescript/bin/tsc --noEmit` 报 4 条 TS2344 `Type 'false' does not satisfy the constraint 'true'`；port 补成员后 7 个实例报 TS2420/TS2741 缺 `definition`，补完 exit 0；Storage 锁原样。
- 绿与门：`node --test tests/integration/provider-binding-registration.test.js tests/contract/capabilities-keys.test.js` 32/32；`--test-name-pattern='绑定锚点跨工作区共享' tests/contract/storage-contract.test.js` 2/2；完整 `tests/contract/storage-contract.test.js` 123/123（用例数与断言基线不变）；四 port 契约 90/90；`planning-github-projects-contract`、`development-local-git`、`human-execution-provider` 48/48；`package-boundaries` 8/8；`tests/e2e tests/mvp0` 与 `github-projects-bootstrap`、`start-work-retry-identity`、`start-work-step-recording` 74/74；`tsc --noEmit` exit 0；`node --test tests/contract tests/integration tests/e2e` 933/933，`tests/mvp0` 7/7（Superseded by「验收证据」：最终树为 939/939 与 7/7）。
- 变异核对（先打印被改行再跑测试，用备份 `cat backup > file` 还原）：对 collect/验证/事务/路由/取消的 29 次变异全部被杀（Superseded by 下方「修复轮 1」：这只是当时所列的 29 次，复核另施的 13 个存活变异在修复轮 1 补齐）——去掉写前 `providerRegistry`、事务外写入、快照缓存、域切片、未知 key 放过、同 id 异实现与同 key 异域集合检查、`bindingForRef` 的域/工作区/启用/重复、取消的工作区核对、`resolveWriteTarget` 与 `gated` 重新按 id 找、目标不分角色、目标恢复只认可用、必需/可选方法与槽位/域/policy/statusPolicy/workspace.id 校验、事务不 await、取消按默认角色重选（该变异由既有 `human-execution-provider` 的重启取消用例杀死）。两条角色过滤变异首次存活，补观察断言后被杀；`definition` 在 await 后被改写的变异首版（getter）等价存活，改为 await 之后实时读后被杀。
- 规模（`git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD`，added+deleted）：以最终提交为准，数值与分项见 Outcomes。
- 修复轮 1（复核存活变异；在同一检出，修复提交在 `10ac468`、`19b67b9` 之上；每个变异先打印被改行，用 `cat backup > file` 还原）：
  - 先写测试：新增用例在现有正确的实现上本来就绿，所以证据是变异红；唯一的先红后绿是 `providerRegistry` 多个备用（`node --test tests/contract/capabilities-keys.test.js` 红于 `Missing expected exception (TypeError)`，补 `providerRegistry` 的一行检查后 8/8）。
  - F1 七项（`node --test tests/integration/provider-binding-registration.test.js tests/contract/capabilities-keys.test.js`，变异后各 2 条红即 fake 与 SQLite 两侧）：域集合比较去掉 `.sort()`、去掉「definition 含挂载域」、去掉域去重、key 空白不拒、空 `bindingId` 不拒、已知 key 的 `undefined` 被拒、`workspace.name` 不校验。
  - F2：`ExecutionRunStart` 不再只选主，`bindingForCapability` 用例红 1 条；F3：`read_only` 连读也拒绝红 2 条，cancel 不再拒绝 `Unavailable` 红 2 条；`providerRegistry` 去掉备用上限红 1 条。
  - 四个 Provider 定义的固定用例（key 改名 ×4、fake 域集合少一个、两个域集合/定义不冻结、GitHub 实例不引用导出常量）：共 8 次变异各至少红 1 条（fake key 改名红 7 条、fake 域集合少一个红 3 条，因为注册矩阵也依赖同一份定义）。
  - 门：`node node_modules/typescript/bin/tsc --noEmit` exit 0；`pnpm run verify` exit 0，939/939 + mvp0 7/7；`package-boundaries` 8/8。

2026-10-02 验收证据（2026-10-02 23:03 CST，在检出 `fix/provider-binding-registration` 的工作树根目录，即 `.worktrees/provider-binding-registration`；代码树与实现提交 `fix(core): 以静态连接定义原子注册并按完整挂载路由` 相同。回读：`git log --oneline df199a59220cfc32d6cc734116c55b38eec7abd6..HEAD` 期望三条——计划、实现、文档提交；`git diff HEAD~1 HEAD --stat` 期望只含 docs）：

- issue #197 验收映射：(1) `composeCore` 同 id 挂 Planning 与 Development 后读回两行 → `tests/integration/provider-binding-registration.test.js` 场景 1（fake 与 `:memory:` SQLite 两侧；2026-10-03 第二轮复评后场景 1 同 id 挂三个域、读回三行，Planning 与 Development 两行包含在内）；(2) 共享契约「同锚点异 key 拒绝、同锚点跨域接受」→ `tests/contract/suites/storage-identity-membership.js` 身份地基第一条（跨工作区与同工作区跨域各一组）；(3) ADR-0006 原缺陷句就地标注已收口，收口段在其下。
- 窄门与回归：`node --test tests/integration/provider-binding-registration.test.js tests/contract/capabilities-keys.test.js` 35/35；`--test-name-pattern='绑定锚点跨工作区共享' tests/contract/storage-contract.test.js` 2/2；完整 `storage-contract` 123/123（`tests/contract/storage-contract.test.js` 与 `tests/contract/suites/storage.js` 对基线零改动，装配台账、`countSuiteCases`、`ASSERTION_BASELINE` 不变）；四 port 契约 90/90；`planning-github-projects-contract` + `development-local-git` + `human-execution-provider` 48/48；`package-boundaries` 8/8；`tests/e2e tests/mvp0` + `github-projects-bootstrap` + `start-work-retry-identity` + `start-work-step-recording` 74/74。
- 类型门：`node node_modules/typescript/bin/tsc --noEmit` exit 0；成员锁并集为 Planning 13、Development 13、Delivery 9、Execution 5，Storage 37 行对基线零改动；从 Delivery 锁删去 `'definition'` 后 tsc exit 2（TS2344），还原后 exit 0。`pnpm run verify` exit 0：939/939 与 mvp0 7/7。
- 变异抽查（先打印被改行，`cat backup > file` 还原并逐次 `cmp` 确认）：13 次有效变异全红——`EXTERNAL_DOMAINS` 混入 storage、`PORT_DOMAINS` 漏 development、连接 key 一致性与域集合一致性检查失效、记录 key 退回域名（红 14）、记录在 await 之后实时读 `definition`、`read_only` 连读也拒、cancel 不拒 `Unavailable`、已知 key 的 `undefined` 被拒、去掉角色过滤、去掉写前 `providerRegistry`、事务外写入（红 6），以及上面的 tsc 锁；另有一次等价变异（把 key 做成 getter，解构在 await 之前，与此前 M19 同理）。
- 规模与公开面、提交整理的门在整理后的 head 上执行，命令见 Concrete Steps，结果见 Outcomes「验收结果」。


2026-10-03 第一轮 MVP 评审修复证据（2026-10-03 11:10 CST，在检出 `fix/provider-binding-registration` 的工作树根目录，即 `.worktrees/provider-binding-registration`；分支已变基到 `origin/main`，观察时 `git merge-base HEAD origin/main` 为 `d008132`，含 #251 与 #253。回读：`git log --oneline origin/main..HEAD` 期望三条——计划、实现、文档提交）：

- P1 先红：变基后、修复前 `node --test --test-timeout=120000 tests/integration/provider-binding-registration.test.js` 为 `ℹ tests 27`、`ℹ pass 23`、`ℹ fail 4`，四条都是 `Error: repository external identity is not a repository identity`（「链读」「取消回到签发者」在替身与 SQLite 上各一条）；`seed()` 改用 `ExternalIdentityKind.Repository` 后 27/27。
- #253 组合门（Ruling 255-1）：`node --test --test-timeout=120000 tests/integration/start-work-sqlite-registration.test.js tests/integration/local-git-core-provisioning.test.js` 为 92/92；加上本计划的集成文件为 119/119。
- 全量门：`pnpm verify` exit 0，`tests/contract tests/integration tests/e2e` 1038/1038，`tests/mvp0` 7/7（其中 typecheck 即 `tsc --noEmit`）；`pnpm run boundaries` 8/8；单独 `node node_modules/typescript/bin/tsc --noEmit` exit 0。
- 场景 1 的判别力（实验前先做本地提交，每个变异前断言 `git diff --quiet`，先打印被改行再跑，`git checkout -- <file>` 还原）：M1 `resolveWriteTarget` 的允许态退回按裸 id 重找第一条——只跑场景 1（`--test-name-pattern='同一连接挂到 Planning 与 Development'`）2/2 红，本文件加 `tests/contract/capabilities-keys.test.js` 35 条里红 4 条；M3 开始工作的写前准备按裸 id 取第一个挂载的 `development`——场景 1 红 2/2，35 条里红 2 条；M4 Git 供应向同 id 的 Planning 实例写一条草稿——场景 1 红 2/2，35 条里红 2 条；M2（评审举例）`bindingForCapability` 退回「第一个可用」——场景 1 红 0/2，35 条里只有纯 Registry 用例红 1 条，与评审观察一致。对照：修改前的场景 1 在 M3、M4 下都是 0/2 红。（以上是第一轮修复时的场景 1；第二轮复评后的变异表见「2026-10-03 第二轮复评修复证据」。）
- 锚点双向不兼容（Idempotence and Recovery 的事实依据）：在临时 SQLite 文件上，先按旧代码的写法写入 `conn-p|planning|planning` 再用本 PR 的 `createContext` 装配，被拒 `provider binding id already points at another implementation`，行仍是 `["planning"]`；反过来先用本 PR 装配（行是 `["harness.fake"]`），再按旧代码的写法写同一 id，得到同一条拒绝，行不变。与评审在两个检出上的复现一致。
- 规模、公开面与提交整理的门在整理后的 head 上执行，结果见 Outcomes「2026-10-03 评审修复结果」。

2026-10-03 第二轮复评修复证据（2026-10-03 11:38 CST，同一检出；场景 1 改为挂三个域、新增备用变体之后。变异流程同上：每个变异前断言 `git diff --quiet`，先打印被改行，`git checkout -- <file>` 还原）。下表中，「场景 1」用 `--test-name-pattern='同一连接挂到 Planning、Development 与 Execution'` 只跑场景 1，「备用变体」用 `--test-name-pattern='Execution 备用与 Planning、Development 共用连接'` 只跑备用变体，两者都是替身与 SQLite 各一条；「全量」是 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e`，共 1040 条，红数包含 contract 层「真实层 tests/integration：非空、全绿」探针的 1 条。

| 变异 | 场景 1 | 备用变体 | 全量 |
|---|---|---|---|
| M1 `resolveWriteTarget` 的允许态按裸 id 重找第一条 | 2/2 红 | 2/2 红 | 7 红 |
| M2 `bindingForCapability` 退回「第一个可用」 | 0/2 | 2/2 红（拒绝文案：实际「没有绑定提供能力 execution.run.start」，期望「能力 execution.run.start 当前不可用」） | 4 红（含纯 Registry 用例 1 条） |
| M3 开始工作的写前准备按裸 id 取 `development` | 2/2 红 | 2/2 红 | 5 红 |
| M4 Git 供应向同 id 的 Planning 实例写草稿 | 2/2 红 | 0/2 | 3 红 |
| M5 `startExecution` 按裸 id 取 `execution` | 2/2 红 | 0/2 | 3 红 |
| M6 `manualFallback` 按备用挂载的裸 id 重找第一条 | 0/2 | 2/2 红 | 3 红 |

复评时 M5、M6 在全量 1038 条上都存活（评审在 `2cb5baa` 上的观察）；补用例之后两者都红。门的数值见 Outcomes「2026-10-03 第二轮复评修复结果」。

## Interfaces and Dependencies

冻结 `resolveWriteTarget(registry: ProviderRegistry, key: CapabilityKey): WriteTarget` 与 `WriteTarget { binding: ResolvedBinding | undefined; error: ProjectError | undefined }` 公开签名不变。
语义加强为已过write门的完整domain挂载对象，拒绝态无binding；注册owner拥有该实现和route修改，#253只消费、不复制解析。
#253 的 `packages/core/src/git-provisioning.ts::provisionGit` 与 `packages/core/src/start-work.ts::prepareRegistration` 使用上述接口（2026-10-03 订正：原写 #253 分支上的提交号，该 PR 以 rebase merge 合入 main 后提交号已改写，改为按文件与符号引用）；不编辑其树，不要求stack前置。
`CommandGate.binding`属于注册owner内部契约，#253已有代码只看allowed/error；若后续head改用旧bindingId，由owner交接而非留兼容双字段。
#251的repository identity与Storage、#253的start-work/git-provisioning/供应fixture保持其owner；本任务不改共享storage.ts签名或Storage锁。
新增Definition静态常量由各实现作者承担连接语义承诺，不是安全认证/账号唯一性证明；权限与policy仍取当前快照的交集。
工具依赖仅现有Node/TypeScript、fake与SQLite；不增加npm依赖，不把官方DI设计类比转为运行依赖。

## Outcomes & Retrospective

Superseded by 本节「2026-10-02 实施结果」：以下是设计阶段的结论，保留原文。当前结果是可审阅spec+plan，产品修复和issue关闭尚未发生。推荐已收敛，但人类可在实施前改选B；改选必须重算全部caller与added+deleted预算。
2026-10-02 实施结果：Batch R 在本地完成。四个外部 port 必需静态 `definition`，七个实际实例补声明；`collectBindings` 先静态校验、再收集并切片全部快照，写前用 `providerRegistry` 验证，单个 `storage.transaction` 写工作区与全部挂载，ack 后才发布；`CommandGate` 带完整挂载，写目标与链读不再二次按 id 重找，取消按持久签发者且核对工作区。偏差：预算按 added+deleted 实测代码与测试 661 行（预算 758/800），其中新集成测试文件 265 行，超出自己的 200 行分项，由其他分项余量吸收；文档 372/1300（本计划 369、ADR-0006 2、索引 1）。修复轮 1：独立复核的 13 个存活变异已用测试补齐，另加每域至多一个备用的产品检查。遗留：#253 组合门、独立复核、最终 push 与远端回读、`docs/product/vertical-path.md` 的陈旧符号名（Superseded by 下方「验收结果」：独立复核已通过，陈旧符号名已订正）。
2026-10-02 验收结果：验收提交之后，按 added+deleted 实测代码与测试 739/800（`tests/integration/provider-binding-registration.test.js` 339，为可读性超出 200 分项；`packages/core/src/registry.ts` 143/195；`packages/capabilities/src/registry.ts` 73/92；其余均在分项内），文档 401/1300（本计划 392，超出 350 分项；ADR-0006 4、索引 1、两处订正各 2）；`node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6` 期望代码 ≤1000、文档 ≤1500。偏差：集成测试与本计划文件超出各自分项，均由总额吸收；允许集按 Decision Log「验收裁决 (a)」扩展两行。
技术债务（`docs/exec-plan/tech-debt-tracker.md` 不在允许集，登记在此）：① `packages/core/src/registry.ts` 的 `PORT_METHODS` 与 port 接口之间没有编译期等值锁；owner 为注册 owner，触发条件是任一外部 port 增删成员，下一证据是一条 tsc 等值锁或遍历接口的契约测试。② ADR-0006 收口段引用本计划的 active 路径，计划移入 `completed/` 时须同步改链接。③ #253 组合门未跑，触发条件是 #253 与本 PR 任一先合并后另一个变基，下一证据是 Concrete Steps 里的两条组合命令在包含双方的检出上通过。Superseded by Decision Log「评审 P3-2」（2026-10-03）：① 已登记为 `docs/exec-plan/tech-debt-tracker.md` 的 TD-019；② 随本 PR 归档订正（ADR-0006 与 prelaunch 计划的路径已改为 `completed/`）；③ 已执行，见 Progress 与 Artifacts「2026-10-03 第一轮 MVP 评审修复证据」。
当前已知未知是真实多域实现族的未来账号自然键与装配代码、环境React类型完整性；都没有被假设为已验证。
完成实施后须在ADR原缺陷段就地标记已由#197机制收口，保留账号自然键/游标等未收口原文；只有全部矩阵和组合门支持后才完成生命周期。2026-10-03：ADR 已就地标注，组合门已执行，生命周期按 Decision Log「评审修复的提交整理与归档」完成。
2026-10-03 评审修复结果：第一轮 MVP 评审的 P1 来自与 main 组合后的夹具种类，产品代码不变；修复后本计划的集成文件、#253 组合门与全量门都绿（数值见 Artifacts「2026-10-03 第一轮 MVP 评审修复证据」），三条 P3 按 Decision Log 处置。规模（`node scripts/rule-checks.mjs size origin/main`，added+deleted，在整理后的 head 上：代码与测试 743/1000，按本计划 800 上限为 743/800，其中 `tests/integration/provider-binding-registration.test.js` 343；文档 449/1500，按本计划 1300 上限为 449/1300，其中本计划 419、`tests/integration/README.md` 20、ADR-0006 4、prelaunch 计划与 `docs/product/vertical-path.md` 各 2、`docs/README.md` 与 tracker 各 1）。`node scripts/rule-checks.mjs disclosure origin/main` 与 `git diff --check origin/main...HEAD` 在整理后的 head 上通过，人工五类目（凭据、本机路径与身份、账号个人信息、内部系统、保密字样）无命中。偏差：集成测试与本计划文件继续超出各自分项，由总额吸收；允许集按 Decision Log「评审修复的文件集」扩展。遗留：独立复评、推送后回读与 ready/merge 由主控与人类执行；TD-019 待外部 port 增删成员时处理。Superseded by 本节「2026-10-03 第二轮复评修复结果」：规模数值与复评状态以那里为准。
2026-10-03 第二轮复评修复结果：复评 APPROVE，另提的 2 条 P3 只改测试与证据，产品代码不变；变异表见 Artifacts「2026-10-03 第二轮复评修复证据」。规模（`node scripts/rule-checks.mjs size origin/main`，added+deleted，在整理后的 head 上：代码与测试 764/1000，按本计划 800 上限为 764/800，其中 `tests/integration/provider-binding-registration.test.js` 364；文档 469/1500，其中本计划 438、`tests/integration/README.md` 21）；实现提交的树上 `pnpm verify` exit 0（1040/1040，mvp0 7/7），计划提交与第一轮相同（1008/1008，7/7）；#253 组合门连同本文件 121/121，`pnpm run boundaries` 8/8；`disclosure` 机械扫描通过、人工五类目无命中，`git diff --check origin/main...HEAD` 干净。遗留同上一段：推送后回读与 ready/merge 由主控与人类执行。

## Bottom Change Note

Change Note (2026-10-01 21:12 CST)：首次创建并完成磁盘语义review；纠正跨域快照拒绝与默认绕权，复核单事务/完整签发者路由；修正预算分项归类与bootstrap调用次序。

Change Note (2026-10-02 06:51 CST)：主控发布前审读明确当前文档全集与分工、工作区默认值归一及取消签发者作用域；原有预算和接口裁决保持，修改集合只见Global Constraints。

Change Note (2026-10-02 22:10 CST)：Batch R 在本地 worktree 实现完成并回填证据：补 G1 授权与 Ruling 255-1/2/3、实施决策与发现、红绿/变异/门的 Artifacts，标注被推翻的环境结论与设计阶段结果；ADR-0006 缺陷段就地收口；#253 组合门保留为未执行的后续门。

Change Note (2026-10-02 22:40 CST)：复核修复轮 1：独立复核指出七处静态校验、`start` 只选主、`read_only` 读与 cancel `Unavailable`、四个 Provider key 字符串缺判别测试，另有公开 Registry 允许多个备用；补测试与一行产品检查（每域至多一个备用），重放变异并回填 Artifacts、Progress、Decision Log 与 Surprises，标注「29 次全部被杀」的适用范围。

Change Note (2026-10-02 23:03 CST)：验收：核对 issue 与 Validation 全部行；行为不变的简化与集成测试可读性重排（断言不减，场景 1 经 `composeCore`）；13 次变异抽查；ADR-0006 原段就地标注并订正收口段的方向词与拒绝归属；按验收裁决 (a) 订正两处过期引用并在 Global Constraints 扩展允许集；回填 Progress、Surprises、Decision Log、Artifacts「验收证据」、Outcomes「验收结果」与技术债务，标注被改写的提交号与旧计数。

Change Note (2026-10-03 11:10 CST)：第一轮 MVP 评审修订：变基到 `origin/main`；P1 的夹具种类修复与 #253 组合门的执行结果回填 Progress、Artifacts 与 Outcomes；Idempotence and Recovery 补锚点双向不兼容；债务 ① 登记为 TD-019，②③ 的处置写进 Decision Log；场景 1 改经 `startWork` 并补变异证据；Interfaces 的提交号改为文件与符号引用；按「Superseded」规则就地标注 Ruling 255-1、验收裁决 (b)(c)、Validation 第 1 行、Concrete Steps 的基线与 vertical-path 行号；状态改为 Completed 并归档到 `docs/exec-plan/completed/`。

Change Note (2026-10-03 11:38 CST)：第二轮复评（APPROVE + 2 × P3）修订：场景 1 同 id 加挂 Execution、新增备用 Execution 共享 id 的变体并钉住拒绝文案；「M2 在集成层等价」就地标注为路由等价、文案可区分；补 Progress、Surprises、Decision Log「第二轮复评」、Artifacts 的 M1–M6 变异表与 Outcomes；Validation 第 1 行与 issue 验收映射就地补注。
