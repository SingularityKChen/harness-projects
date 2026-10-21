# docs/adr

不可回退的技术决策记录（Architecture Decision Record）。判断标准：如果这个决定被推翻，会导致已经写好的代码或已经发布的接口需要重做，它就该在这里有一条记录。

## 命名与格式

- 文件：`ADR-XXXX-<slug>.md`，四位递增编号，`<slug>` 为小写英文连字符。
- 编号不复用、不回收；被推翻的决策保留原文件，在文末追加 `Superseded by ADR-YYYY`。

每条 ADR 至少包含：

```markdown
# ADR-XXXX：<一句决策>

> 状态：Proposed | Accepted | Superseded by ADR-YYYY
> 日期：YYYY-MM-DD
> 来源：<ExecPlan 路径 / 讨论 / 上游文档>

## Decision
<做了什么决定>

## Why
<为什么；它保护哪条不变量>

## Rejected
<放弃了什么方案，为什么>

## Consequences
<代价、限制、后续需要遵守的约束>
```

## 索引

| ADR | 决策 | 状态 |
|---|---|---|
| [ADR-0001](ADR-0001-external-identity-key-shape.md) | 外部身份注册表的键是「平台绑定 + 对象种类 + 平台全局 node id」 | Proposed |
| [ADR-0002](ADR-0002-membership-identity-separate-from-content.md) | 成员关系身份与内容身份分离，成员关系落在独立的工作区作用域表 | Proposed |
| [ADR-0003](ADR-0003-events-are-not-the-correctness-mechanism.md) | 事件不是正确性机制，对账是 | Proposed |
| [ADR-0004](ADR-0004-unknown-external-create-is-product-visible.md) | 结果不确定的外部创建先对账再重试；没有自然键时它是产品可见状态。**订正 2026-09-23（L1 / #119）**：证据边界与结论句「平台不提供可对账的输入」按实测就地订正——调用方**自带**的唯一标记 + 作者 + 时间窗可对账，标记不唯一时不可判定。**订正 2026-09-24（评审响应）**：状态列的**类型**取 `packages/domain` 的 `WriteState`（结果轴），L1 给出的是**获知方式**四个标注（`confirmed` / `reconciled` / `rejected` / `unresolved`）——原文写的「状态取值集合 4 个」是两轴合一，**Superseded by `docs/architecture/gate-e1-uncertain-create.md` §2（2026-09-24）** | Proposed |
| [ADR-0005](ADR-0005-projection-anchor-and-behaviour-2-enforcement.md) | 投影的锚点与行为 2 的强制点：删除投影上的成员关系锚点与种类触发器，强制点在 core 的 `entityKindFor` + e2e；storage 只保证「同一工作区同一实体一行投影」（主键），种类一致性登记为 core 推导义务 | Proposed |
| [ADR-0006](ADR-0006-connection-anchor-and-workspace-mount.md) | 把 `provider_binding` 收窄为跨工作区的连接锚点，新增 `workspace_binding` 承载工作区挂载；`external_identity` 的键形状不变 | Proposed |
| [ADR-0007](ADR-0007-provider-error-codes-carry-system-promises.md) | provider 写方法的 `conflict` 是「请求的状态已成立且可复用」的系统级承诺，`ambiguous_result` 是「结果真的不确定」；core 在报权威 `Saved` / `confirmed` 前必须**观测**而不是相信返回码，缺观测手段时补 port 的读能力而不是把义务下推给每个 provider | Proposed |
| [ADR-0008](ADR-0008-run-identity-is-the-core-run-record.md) | 执行运行的身份是 core 的运行记录；provider 引用是落在 `providerRef` 上、由签发者证明来源（签发者身份由宿主稳定注入）、由 core 在取消 ack 后原子替换的路由句柄；`command` / `environment` 不落库，降级结论落在运行记录上 | Proposed |
| [ADR-0009](ADR-0009-harness-plugin-installable-artifact.md) | `apps/harness-plugin` 是唯一有构建步骤的包（esbuild 精确 `0.28.2`，只作它的 devDependency）；安装件 manifest 由构建按白名单生成，宿主 peer（`~0.2.0-rc.2` 范围）与 `dsh` 块不进源 manifest；client 外置表恰好等于宿主基线模块表，宿主半边外置 `@deepseek-ai/*` 与 Node 内置，其余打入，构建闸门 fail closed；占位组件在 `packages/ui`，apps 只注册 | Accepted |
| [ADR-0010](ADR-0010-stable-ids-are-route-locators.md) | 规划实体的稳定 `WorkspaceId` / `EntityId` 作 `/projects/:projectId/items/:itemId` 的可观察、非秘密、非 capability 的 canonical locator；locator 不得编码或可验证地派生自外部 id、binding 或用户内容，最小披露属性 L1–L5 各自绑定到会失败的检查；对象级授权由引入第二个主体的 issue 承接 | Accepted |
| [ADR-0011](ADR-0011-delivery-facts-last-confirmed-snapshot.md) | 交付事实按执行上下文存一份「最后确认快照」（迁移 006 的 `delivery_fact`），`refreshDeliveryFacts` 是唯一写者：只写端点实体、`derived_from` / `produced_by` / `runs_on` 候选边与快照；只有完整读到的集合才替换或删除，不完整的集合保留并标陈旧；新鲜度在快照内，不写同步游标，交付写者不推进业务修订号 | Accepted |
| [ADR-0012](ADR-0012-business-revision-advances-only-on-content-change.md) | 业务修订号只随已提交的工作区快照内容变化推进（一个事务至多一次，移除也算变化）；刷新轮次、同步游标、对账时刻与查询都不推进它；交付写者不推进，扩大快照覆盖面者负责让新事实参与变化判定；`reconcile_cursor` 只由规划全量同步在成功提交时写 | Accepted |
| [ADR-0013](ADR-0013-harness-host-composition.md) | Harness 插件 Host 是 Core/Controller/SQLite 的受控组合根，以 strict typed remote 暴露最小 unary 面；Client 不持有业务状态，provider implementation selection 与 watch 由后续 issue 承担 | Proposed |
| [ADR-0014](ADR-0014-host-composes-providers-by-implementation-key.md) | Host 按每个挂载的实现键从编译期封闭目录构造 provider，事实源是 SQLite 里的挂载、账号与配置；`inject` 只要 `typert`，宿主 `credentials` 每次凭据解析时经 `ctx.get` 取用，缺席时只让该次操作结构化失败、Host 照常加载；挂载级失败只在内存禁用、不写库，宿主级失败整体 fail closed；`HOST_ENTRY` 放行 capabilities 与目录收录的 provider 包（fake 不放行）；采纳后部分取代 ADR-0013 的工厂注入句，是否连同「`credentials` 必需、缺失时 fail closed」半句一并取代待人类伙伴裁定 | Proposed |
| [ADR-0015](ADR-0015-repository-references-side-by-side.md) | 一个仓库一个实体，各连接下的引用是同一实体上的并列身份（首次登记写下的为 `primary` 锚点，其余为 `alias`；不改 schema、Storage 端口与迁移）；core 的 `registerRepository` 是仓库实体、引用身份与仓库挂载的唯一写者，绑定命令与开始工作的懒登记共用它，已登记的仓库只追加引用、不改指锚点；Development 按操作路由——锚点 key 选挂载，前置门在同一挂载上判定，唯一声明锚点 key 的引用被选中，没有声明者 `not_supported`、多个声明者 `conflict`，绝不取第一个注册者；仓库引用的 `external_id` 是宿主键、从不作平台查询参数，R7 逐字成立；交付来源每工作区一个、不替换；采纳时补三条约束：M4.1（#387）之前 `conflict` 是终态、每个仓库在每个连接下至多一条现行引用、`conflict` 与 `not_supported` 带出声明者或服务连接的 id | Accepted |

本目录只登记**已在仓库内有证据**的决策：上表十五条里四条来自 Gate E1 的实测记录，ADR-0005 与 ADR-0006 来自 #27 的 schema 评审（PR #122 的两轮），ADR-0007 来自 PR #160 连续五轮被打回的九条 P1 的机制聚类（`docs/exec-plan/active/2026-09-24-local-git-worktree.md`「系统级根因分析」），ADR-0008 来自 PR #161 第七至十轮的实测与变异实验（`docs/exec-plan/completed/2026-09-24-human-execution-provider.md`），ADR-0009 来自 #227 的三份独立设计与评审（`docs/exec-plan/completed/2026-09-29-harness-plugin-package.md`）及 #225 复探的宿主事实（`docs/architecture/harness-host-spike.md` §11；构建产物被真实宿主接受这一条尚待该计划的宿主观测，见 §11.9 第 4 条），**ADR-0009 的上句待观测状态 Superseded by 归档计划D34（2026-09-30）**：构建产物的K验收已完成，人类伙伴授权修订后整合，ADR-0009采纳为Accepted；ADR-0010 来自 #129 的原始最小披露约束、#130 的 deep-link 路由范围、PR #269 的 route-locator review thread，以及 `packages/domain/src/ids.ts`、`packages/core/src/identity.ts`、`packages/core/src/relations.ts`、`packages/ui-model/src/work-item-detail-view.ts` 的机制证据，人类伙伴 2026-10-07 批准其来源 ExecPlan 的决策门 H1 后采纳；ADR-0011 来自 #221 的三份独立设计、定稿评审与原型实测（`docs/exec-plan/completed/2026-10-08-delivery-fact-writer.md`），以及 #222 的 `confirmedAt` 墙钟读数与文字修订（`docs/exec-plan/completed/2026-10-08-delivery-query-pure-read.md`），人类伙伴 2026-10-09 在协调者会话的一次提问中直接批准「在 #293 的修订之后采纳」后采纳；ADR-0012 来自 #220 / #199 的复现、三份独立设计的定稿评审与导出目录里的原型变异实验（`docs/exec-plan/completed/2026-10-08-sync-revision-freshness.md`），人类伙伴 2026-10-08 18:40 CST 前后在协调者会话（负责迭代规划与交付这几个 PR 的会话）的一次四问提问中直接批准其来源 ExecPlan 的采纳问题后采纳；ADR-0013 来自 #228 的宿主组合计划（`docs/exec-plan/completed/2026-10-13-harness-host-composition.md`）与 #225 复探的宿主事实（`docs/architecture/harness-host-spike.md` §11），状态 Proposed，采纳权在人类伙伴；ADR-0014 来自 #132 的宿主组合计划（`docs/exec-plan/completed/2026-10-15-host-provider-composition.md`）、Desktop 不提供 `harnessProjectsProviders` 服务的实测（ADR-0013 的宿主观测）、对官方 Cordis 文档与 Desktop 0.2.0-rc.2 第一方运行时的调研（该计划 Decision Log D-R）以及该计划 Batch 7 的宿主内观测，状态 Proposed，采纳权在人类伙伴；它拟部分取代 ADR-0013 的工厂注入句，是否连同「`credentials` 必需、缺失时 fail closed」半句一并取代与采纳一并由人类伙伴裁定，采纳前 ADR-0013 里的两处标注只是提议态；ADR-0015 来自 #353 的仓库绑定计划（`docs/exec-plan/completed/2026-10-21-repository-binding.md`）：三份独立设计（最小闭环 / 系统 / 业界实践）经独立评审收敛，审阅探针在内存替身与 SQLite 两种存储上实测同一实体上 primary 与 alias 可共存、仓库挂载改指被拒（`repository mount already points at another external identity`），人类伙伴 2026-10-21 在 PR #348、#370–#373 的评审会话中直接批准该计划的 H1 并补三条约束后采纳，`docs/architecture/gate-e1-ruling.md` 的 R7 行末随之追加了指向它的一句；其余条目维持既有状态。`Proposed` 表示证据已进仓库、采纳权在人类伙伴（`docs/architecture/release-gates.md` §2 第 1 行把 Gate E1 的判定者列为人类伙伴，§1 规定 R1 不得由 LLM 判定；裁决见 `docs/architecture/gate-e1-ruling.md`，该行对 `AGENTS.md` §1.2 的错误归因登记在裁决 §6.5）。

上游工程包给出的 12 条初稿决策主题如下，此处只作为**待重述清单**保留，不作为本目录的依据——上游输入不随仓库分发（`AGENTS.md` §3、`docs/README.md` §3），对外可读的结论必须在本目录内独立成立：

Host 权威、ConnectorAccount 与 ProviderBinding 分离、ExternalIdentity 注册表、PlanningItem / WorkItem / ChangeRequest 分离、SQLite current-state 模型、webhook 非正确性依赖、先确认再更新投影、ambiguous create 不自动重试、Capability ∩ Permission ∩ Policy、Start Work 补偿式编排、MVP 不引入 Redis / Queue / Search、ExecPlan 必须在真实仓库上生成。

其中 3 条已在 Gate E1 的实测证据上重述并登记：**ExternalIdentity 注册表** → ADR-0001、**webhook 非正确性依赖** → ADR-0003、**ambiguous create 不自动重试** → ADR-0004。ADR-0002（成员关系身份与内容身份分离）是 Gate E1 实测新增的结论，不在这 12 条之内。其余 9 条在逐条重述并附上仓库内证据之前，不作为任何结论的依据；需要时应先把来源与证据引入仓库，再新增 ADR。
