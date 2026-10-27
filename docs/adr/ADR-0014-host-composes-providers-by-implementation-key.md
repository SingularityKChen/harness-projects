# ADR-0014：Host 按实现键从已存挂载组合 provider，凭据按操作解析

> 状态：Proposed
> 日期：2026-10-15
> 来源：`docs/exec-plan/completed/2026-10-15-host-provider-composition.md`（Decision Log D-R、D31 与 Batch 7）、issue #132、`docs/adr/ADR-0013-harness-host-composition.md`、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`

## Decision

1. `apps/harness-plugin/src/host.ts`、`host-composition.ts` 与 `host-providers.ts` 是插件 Host 唯一的组合根。provider 由 `host-providers.ts` 里编译期封闭的目录（`实现键 → 定义 + 配置 schema + 构造函数`）按每个挂载的 `implementationKey` 构造。Host 的 `inject` 只有 `['typert']`：宿主 `credentials` 服务不进 `inject`，每次凭据解析时经 `ctx.get('credentials')` 取当前活跃的提供方。服务缺席时只有那一次操作结构化失败（解析以 `name` 为 `CredentialServiceUnavailable` 的 Error 拒绝，宿主诊断日志记一行 `credentialFailed`，provider 按既有分类给出结构化结果），Host 照常加载、typed remote 照常注册；服务出现后下一次操作即可解析，不重载 Host。
2. 事实源是 SQLite 里的工作区、挂载、连接账号与配置。Host 不生成 binding id，provider 拿到的永远是存储里的 `binding.id`；凭据值只在一次 provider 操作内经 `credentials.resolve(句柄)` 解析，不缓存、不进库、不进日志与 wire。
3. 挂载级失败（目录无该实现键、域不匹配、配置或账号不合格、构造抛错）只在内存禁用该挂载并写一行宿主诊断日志，不改库中的挂载行，实现回来后以原身份复活；宿主级失败（迁移、句柄 allowlist、已声明实现键的坏配置、`composeCore` 抛错、typed remote 注册失败）整体 fail closed，关闭已创建的资源并不发布端点。凭据服务缺席不是宿主级失败（第 1 条）。例外：development 默认角色（`workspace_binding.is_default`）由 Core 每次组合按存活挂载数推导并写回；被禁用的挂载若持有默认角色，该角色会迁移到存活的对等挂载（两行都被改写），实现回来后两者都存活、推导为 0，原默认角色不恢复，见 TD-053。
4. `HOST_ENTRY.files` 增加 `host-providers.ts`；`HOST_ENTRY.allow` 增加 `packages/capabilities` 与目录收录的 provider 包（本决策收录 `planning-github-projects`、`development-local-git`）。`provider-fake` 不放行：它只进测试，不进 `apps/harness-plugin` 的 manifest 与源码。
5. 本 ADR 采纳后只部分取代 ADR-0013 的两处：第 5 条「Host 入口要求注入 `harnessProjectsProviders` 工厂与 `credentials` 服务；缺失时 fail closed」这一句（工厂注入取消；`credentials` 改为第 1 条的按操作取用），以及 Consequences 首条里「测试通过注入 fake factory 验证 … 缺失工厂时 Host fail closed」这一句。采纳前（Proposed）这两处取代不生效，ADR-0013 里只有提议态标注；人类伙伴批准的推送方向（来源计划 D33）只点名第 5 条的工厂句，取代范围是否包含「`credentials` 必需、缺失时 fail closed」半句，与是否采纳本 ADR 一并由人类伙伴裁定（来源计划的人类门 H1）。ADR-0013 的其余内容不变，包括卸载先撤回 remote 再关闭 composition、watch / reconnect 与跨代 watch drain 留给 #276。

## Why

决定性证据有四条，都来自官方文档或 Desktop 0.2.0-rc.2 随附的第一方运行时：

1. `inject` 列出的必需服务缺席时，Cordis 让插件静默停在 PENDING：`apply` 永不运行，不报错也不写日志，官方明说 PENDING 是合法状态而不是错误（教程第 3、6 章）。ADR-0013 要求注入的 `harnessProjectsProviders` 没有任何包提供，#329 在 Desktop 上的 S3 得到 404 就是这个结果。同一机制也落在 `credentials` 上：留在 `inject` 里，凭据提供方迟到、缺席或重载都会让整个 Host 不加载或整体卸载重建。官方第 3 章要求「功能缺失时仍可运行的依赖不写进 inject，在使用处探测」，`ctx.get` 默认只返回活跃提供方（context API）；第一方 `dsh-llm-deepseek-api-key` 也只 inject `llm`，`credentials` 用 `ctx.get` 按需取。
2. Cordis 的服务替换是部署级的「一个名字、一个作用域、一个提供方」，换实现就是在 `cordis.yml` 里换一行。我们的选择是数据驱动的：一个工作区有 N 个挂载，每个挂载按存在 SQLite 里的实现键选实现，服务替换表达不了这种选择。
3. 第一方运行时对固定的实现集合就用封闭表：`dsh-host-directory-picker-auto` 的 `BACKEND_PACKAGES` 注释写明它是 "fixed composition vocabulary, not a tunable"；`dsh-llm-pi-ai` 的 `PROTOCOLS` 表与 `dsh-sdk-jsonrpc-server` 静态挂载适配器同属此类。
4. 官方「能力的三层拆分」只在角色需要独立演进或替换时才分包，要求不做预防性拆分，并允许一个包承担多个角色。本仓库的 provider 没有外部消费方，也没有第二个发布方。

组合根应尽量靠近入口、只有组合根引用全部实现（Seemann）：编译期目录让「Host 能构造哪些实现」成为一份可审阅、可被边界测试约束的清单。它保护不变量 7（Host 拥有权威状态，身份只来自存储）与实现级硬约束（凭据只以句柄存在）。挂载级失败局部隔离、不写库，保证一个失效的挂载不能拖垮其余挂载，也不会因为运行期缺口而改写用户意图。

依据：教程第 3 章 https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/03-services ；第 6 章 https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/06-composition-and-hmr ；context API（`ctx.get` strict、同名 `ctx.provide` 抛错）https://deepseek-harness.github.io/deepseek-harness/reference/cordis-api/context ；能力的三层拆分 https://deepseek-harness.github.io/deepseek-harness/develop/practice/ ；插件配置原则 https://deepseek-harness.github.io/deepseek-harness/develop/basic/config ；存储注册表与生命周期键 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/storage/storage/README.zh.md ；Composition Root https://blog.ploeh.dk/2011/07/28/CompositionRoot/ 。第一方运行时的读数来自本机 Desktop 0.2.0-rc.2 应用包的只读解包（`@deepseek-ai/cordis` 4.0.4）。

## Rejected

- **等待外部提供的 provider 服务（ADR-0013 的工厂注入）**：没有任何包提供它，Host 静默停在 PENDING（Why 第 1 条）。
- **(b) 本包自己 provide `harnessProjectsProviders`**：只是给同一份静态目录多包一层服务。Host 若仍 inject 它，提供方一出错又回到静默 PENDING；同一 fiber 不能 inject 自己提供的服务，只能另拆子 fiber；服务名是扁平全局命名空间，别人先提供同名服务时我们的 `provide` 会抛错。
- **(c) Host 自有注册表加适配器子插件**（官方 `ctx.llm.registerAdapter` 与 `dsh-storage` 的注册表加 `storage.backend.<name>` 生命周期键模式）：暂缓，不是否决。现在做的代价是：适配器必须是 Cordis 插件，与 `packages/providers/*` 只依赖 capabilities 与 domain 的边界冲突，只能在 apps 层再包一层；实现键存在 SQLite 里，Host 激活时不知道该等哪些生命周期键；`composeCore` 需要静态 provider 表，适配器每次变动都要重建整个组合并推进修订号；开放注册还会把按操作的凭据解析交给可注册的代码。触发条件：provider 必须由独立的包或第三方发布，或者需要不重启就增删实现。目录条目已与注册表条目同形（定义 + 配置 schema + `create`），迁移时只换数据来源。
- **(d) 把挂载放进插件 Config**：挂载是用户数据，存在 SQLite 里且有稳定 id；放进 profile patch 会形成第二个事实源（不变量 1、7），而且 patch 整段替换 `config`，任何改动都会重挂整个 Host。部署级参数（GraphQL 端点、请求超时、句柄名）按官方配置原则应为带默认值的 Config 字段，登记为 TD-067，不在本决策内。
- **新建 `packages/host` 共享组合包**：当前只有一个壳；第二个壳（apps/web，#135）出现时再抽公共包。
- **在 core 定义目录契约**：core 会背上 provider 构造与 IO 生命周期，而 apps 到 providers 的依赖边照样要放行。
- **惰性挂载（未知实现键也注册一个占位 provider）**：core 需要增加约 30 行并处理多域实现键的域集合一致；它保护的 development 默认角色本是 core 每次组合推导的派生值，代价登记为技术债而不是为此改 core。

## Consequences

- 新增一个可用实现必须同时加目录条目、`HOST_ENTRY.allow` 一行与 manifest 依赖；目录之外的实现键只会被禁用，不会被构造。
- 存储打开期只校验策略已声明实现键的配置，读写口仍按真实锚点的实现键拒绝：没有未校验的值能离开存储，带配置的未知实现键也不再让整个 Host 起不来。`storage-sync.ts` 里 `#assertStoredMetadata` 的文档注释仍是放宽前的口径（「有不匹配行的库在打开时拒绝」），以本条为准，订正登记在 TD-029 的下一步（来源计划 D35）。
- Local Git 的工作树允许根由 Host 注入：`<数据目录>/worktrees/<sha256(binding id) 前 16 个十六进制字符>`，是数据根与 binding id 的纯函数，必须落在仓库检出根之外。检出根自 `realpath(repositoryPath)` 向上找 `.git` 得到，`repositoryPath` 取检出的子目录时同样成立；允许根落在检出根之内时只禁用该挂载（`invalid_input`）。守卫只规范化数据根与 `repositoryPath`：数据根下的 `worktrees` 或摘要分量本身是符号链接时它看不到（前提是宿主自有目录被改动），承接 #338：https://github.com/SingularityKChen/harness-projects/issues/338#issuecomment-6188669512 。provider 的默认推导只是无宿主时的后备。
- 启动竞态（Desktop 0.2.0-rc.2 上已观测）：`credentials` 不再是必需注入后，Host 可能在凭据提供方激活之前完成组合。这时组合期的首轮水合每次解析都失败，诊断日志各记一行 `credentialFailed`（`CredentialServiceUnavailable`），首个 `baseline` 只有库里已有的实体、新鲜度为 degraded（新库上为 0 个实体）；下一次命令重新水合即恢复。degraded 的原因是 `not_found`（「没有可发现的规划项目」），会把「凭据服务尚未就绪」误报成「项目不存在」；只读路径（`baseline`）不会自愈，要等命令或 Host 重载才重新水合。这是「凭据缺席时 Host 照常加载」的代价。自动恢复已由 #132 的评审会话登记为 #335 的拟加验收：https://github.com/SingularityKChen/harness-projects/issues/335#issuecomment-6188668898 ——凭据服务晚于 Host 组合激活时，服务可用后的第一次定时刷新重新水合 degraded / `not_found` 的 baseline，客户端无需发命令即恢复；见 TD-056。
- 凭据服务缺席时没有 Host 级 fail closed：不需要凭据的挂载（Local Git）照常工作，规划挂载的操作结构化失败，原因只在宿主诊断日志里。
- 采纳权在人类伙伴；采纳前保持 Proposed。`Status`、Project Status、`blocked-by` / `blocking` 与 ADR Accepted 状态不由 agent 写入。

2026-10-27：精确增加 `apps/harness-plugin/src/host-planning-mapping.ts` 为 Host-only 边界例外；它只读取当代 lifetime 包装的 Planning port 与本地映射，不可从 client 入口到达。
