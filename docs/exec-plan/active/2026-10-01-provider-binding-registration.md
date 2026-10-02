# Provider 连接实现身份与原子注册 ExecPlan

> 状态：Active · 设计已落盘，产品实施待人类评审
> 创建：2026-10-01；关联：#197；规范：仓库根 `PLANS.md`
> 范围：静态连接实现定义、完整挂载注册与域正确路由；不改变连接锚点/工作区挂载存储模型

## Purpose / Big Picture

用户能把同一连接在一个工作区挂到 Planning 和 Development 两个域，读回时两个挂载同时存在，随后读写命令进入提供相应能力的实例。
同 id 改实现必须拒绝；任一快照失败或后续挂载冲突都不能留下新工作区、孤儿锚点或半批挂载。执行取消必须回到签发该运行的 Execution 挂载。
最小可观察证据是同一套 fake/SQLite 正负控：合法共享读回两行、错误共享整批回滚、Development/Delivery/Execution 三类调用各命中正确实例。
当前用户授权 spec、plan 与 draft。本文可被审阅并用于 draft；产品代码实施须经人类评审，不能以计划 lint 通过替代该门，也不自动 ready 或 merge。

## Context and Orientation

2026-10-01 21:09 CST，设计检出为 `fix/provider-binding-registration`、基线 `df199a59220cfc32d6cc734116c55b38eec7abd6`，工作树上下文 `.worktrees/provider-binding-registration`。
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

当前文档改动全集为 `docs/exec-plan/active/2026-10-01-provider-binding-registration.md`（新建）和 `docs/README.md` 的索引行；计划由独立 reviewer 写、索引由主控写，临时 review 不提交。
本轮不改产品/config/tests/旧 ADR/旧计划、不安装依赖、不运行 pnpm run/install、不编辑 #251/#253 的树。主控按用户授权提交文档、创建 draft 并投影相关元数据；不写 Status 或原生阻塞关系，不 ready 或 merge。
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
未来 docs 允许集为本计划（active→同名completed时生命周期移动）350、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`60、主控索引`docs/README.md`6；共416/1300，余884。
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

所有仓库命令在检出 `fix/provider-binding-registration` 的工作树根运行；本轮只文档lint与必要Node窄baseline，以下future标记不代表已经执行。
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

期望SQLite供应前置仍绿；当前基线缺新增文件时这是future，不跑缺文件来制造红。
后续提交与公开面门：

    git diff --check df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD
    git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD
    node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6
    node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6

期望exit0并另按本计划800/1300更严预算核对added+deleted；仓库1000/1500绿不能替代本任务预算。

## Validation and Acceptance

新增tests尚未写/执行；表内绿判据是未来验收，不是本轮实测。adapter矩阵复用同一scenario runner，不在fake/SQLite复制不同断言。

| 验收/反例 | baseline红或保护点 | future绿判据 |
|---|---|---|
| shared planning/development | 全局重复id拒绝且半写 | 同id同key读回两个域，Development写计数1、Planning错误调用0 |
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
- [ ] 后续实施交接前重读draft当前head/base、双向issue关联、元数据和checks，并由人类评审产品设计；发布状态以GitHub当前快照为准。
- [ ] (2026-10-01 21:09 CST) Batch R/V：产品实现、红绿矩阵、类型/组合/公开面门；当前未授权执行。

## Surprises & Discoveries

基线窄测已有“跨工作区共享”2例，但没有同id同workspace跨域正控；原case文案覆盖范围大于实际输入，需扩展它而非删断言。
两稿探针在fake/SQLite均见同id共享compose被拒且残留workspace/首Planning；源码逐条写入顺序确认此因果，Storage单次原子不等于注册整批原子。
2026-10-01本树直接解析TypeScript5.9.3后执行noEmit，实际placeholder.ts两处React TS2307；这是既有环境缺React类型，不能称typecheck绿。
Node现为v26.10.0，pnpm现为11.25.0而声明10.28.2；已知pnpm run会自动install，本轮不调用，不修依赖，不把自动安装当验证步骤。
port锁旧精确数量12/12/8/4/37由当前registry源码读取；新锁只增加四个definition，不能把Storage变更借机收进本任务。

## Decision Log

Decision：选择A静态实现定义和明确域槽位，key owner是连接实现族；Rationale：满足跨域身份并控制调用半径，不捎带#219；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：union快照全闭集校验后按域slice；Rationale：snapshot无domain，多域对象本来合法，role过滤与权限仍分开；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：本地事务仅Storage IO、ack后唯一publish；Rationale：半注册必须由整批rollback消除，权限观察不能在事务内等待远端；Date/Author：2026-10-01 21:09 CST / 独立reviewer。
Decision：目标携完整binding，取消查持久issuer；Rationale：id是连接身份而非域槽位，二次first-find不可接受；Date/Author：2026-10-01 21:09 CST / 独立reviewer。

## Idempotence and Recovery

同配置collect/compose可重复，snapshot仅是当前观察，Storage upsert保持同anchor key/挂载元组；任何拒绝以完整配置重试，不能从中间挂载继续。
失败事务恢复所有本批写；成功注册后bootstrap失败保留合法连接装配并按既有降级返回，不把它回写成空Registry。
无真实用户/数据、无Schema变更，代码回滚为整能力闭环revert；不建兼容接口，不迁移旧库，不删除其他工作区/锚点或凭据句柄。
账号自然键、同域任意多实例/动态发现(#219)、多工作区游标、热配置删未列挂载不在本闭环；它们不会使当前合法跨域注册变成推迟项。
若实施发现这些缺口进入真实用户路径，在`docs/exec-plan/tech-debt-tracker.md`登记owner、触发条件和下一证据；本轮不改旧tracker，只保留明确边界。

## Artifacts and Notes

观察上下文（2026-10-02 06:58 CST）：检出 `fix/provider-binding-registration`、基线如Context所示的文档工作树；技能lint为OK，`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed/0 failed。主控索引使用与另两计划分开的锚点，最终差异重算 `git diff --numstat origin/main...HEAD`；此处不把计划预算称作已实施改动。

当前已执行证据@基线：`node --test --test-name-pattern='绑定锚点跨工作区共享' tests/contract/storage-contract.test.js`为2pass/0fail，capabilities-keys为5pass/0fail。
当前直接noEmit exit2，React TS2307；未来新增tests、完整类型门与#253组合门未执行。2026-10-01 21:12 CST磁盘八问review为pass，专用lint为OK，24个未来文件预算求和758、根13章相对次序正确，git diff --check无错误；计划本身325行。
公开面不写临时输入路径、账号或本机路径；所有仓库引用为相对路径，执行证据同时绑定分支/head/date。

## Interfaces and Dependencies

冻结 `resolveWriteTarget(registry: ProviderRegistry, key: CapabilityKey): WriteTarget` 与 `WriteTarget { binding: ResolvedBinding | undefined; error: ProjectError | undefined }` 公开签名不变。
语义加强为已过write门的完整domain挂载对象，拒绝态无binding；注册owner拥有该实现和route修改，#253只消费、不复制解析。
#253已提交`efbd096`只读显示git-provisioning/provisionGit与start-work/prepareRegistration使用上述接口；不编辑其树，不要求stack前置。
`CommandGate.binding`属于注册owner内部契约，#253已有代码只看allowed/error；若后续head改用旧bindingId，由owner交接而非留兼容双字段。
#251的repository identity与Storage、#253的start-work/git-provisioning/供应fixture保持其owner；本任务不改共享storage.ts签名或Storage锁。
新增Definition静态常量由各实现作者承担连接语义承诺，不是安全认证/账号唯一性证明；权限与policy仍取当前快照的交集。
工具依赖仅现有Node/TypeScript、fake与SQLite；不增加npm依赖，不把官方DI设计类比转为运行依赖。

## Outcomes & Retrospective

当前结果是可审阅spec+plan，产品修复和issue关闭尚未发生。推荐已收敛，但人类可在实施前改选B；改选必须重算全部caller与added+deleted预算。
当前已知未知是真实多域实现族的未来账号自然键与装配代码、环境React类型完整性；都没有被假设为已验证。
完成实施后须在ADR原缺陷段就地标记已由#197机制收口，保留账号自然键/游标等未收口原文；只有全部矩阵和组合门支持后才完成生命周期。

## Bottom Change Note

Change Note (2026-10-01 21:12 CST)：首次创建并完成磁盘语义review；纠正跨域快照拒绝与默认绕权，复核单事务/完整签发者路由；修正预算分项归类与bootstrap调用次序。

Change Note (2026-10-02 06:51 CST)：主控发布前审读明确当前文档全集与分工、工作区默认值归一及取消签发者作用域；原有预算和接口裁决保持，修改集合只见Global Constraints。
