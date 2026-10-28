# PR 规划成员与谱系身份收敛 ExecPlan

> 状态：Completed；实现与独立验收通过，PR 等待人类评审。
> 创建：2026-10-28；规范：根 `PLANS.md`。
> 范围：同一个 Provider 确认的原生 PR，两个观察入口和两种顺序均解析为一个全局 ChangeRequest 实体。
> Issue：[同仓 #367](https://github.com/SingularityKChen/harness-projects/issues/367)；分支：`fix/pull-request-identity-convergence`。

## Purpose / Big Picture

一个 PR 可同时是 Planning project 的内容与 Development 谱系上的 change request；两个入口应指向同一实体。
完成后，先同步成员或先刷新谱系都得到同一个 ChangeRequest，重复同步不新增实体、不推进业务修订号。
最小证据是 fake/SQLite × 两观察顺序的真实摄入测试、重开测试及两个真实 GitHub decoder 的契约断言。
只补 `docs/architecture/release-gates.md` §2.1.1 第 3 行的身份证据，不能据此批准整套 Gate R1。

## Context and Orientation

`ExternalIdentity` 表示平台内容身份，键为 `(bindingId, externalKind, externalId)`，全局且故意不带 workspaceId。
成员关系表示内容挂在 project 的那一行，具有独立 membership id；它不是第二个 PR 身份。
`packages/core/src/identity.ts` 的 `ensureEntity` 当前按自然键查找，未命中则分配随机实体；Planning 从 `bootstrap.ts::anchorOf` 进入。
`packages/core/src/chain-facts.ts` 的 `changeRequestNode` 当前用工作区/binding/id 哈希生成另一节点。
`packages/core/src/delivery-facts.ts` 在事务内持久实体、候选边和 facts；读侧 `readChainFacts` 不写 Storage。
两个真实 GitHub decoder 已分别使用 GraphQL PullRequest 的 `source.id/node.id`，但其 implementationKey 和 binding 不同。
外部 ID 只是 Provider binding 内的键；相同字符串或 URL 不足以证明两个任意 Provider 观察到同一物。
规范依据：`packages/domain/src/identity.ts`、`docs/adr/ADR-0006-connection-anchor-and-workspace-mount.md`、`docs/architecture/release-gates.md`。
取证基线：2026-10-28 的 `main@88d21ae6e0f0afb1f18afc776f54efac3ff4723a`；后续命令以执行分支为上下文。
官方依据：GitHub [global node IDs](https://docs.github.com/en/graphql/guides/using-global-node-ids) 说明 GraphQL id 与 REST node_id 的对象引用关系。
GitHub [ID migration](https://docs.github.com/en/graphql/guides/migrating-graphql-global-node-ids) 要求将 ID 当 opaque string；不能解码前缀、用 number 替代或推断全局实例范围。
[GraphQL global object identification](https://graphql.org/learn/global-object-identification/) 的 Node 身份以服务为范围，故不同服务实例不能共用一个不分来源的 namespace。

## Design / Spec

### 推荐方案：PR 结果携带最小原生身份声明

在 capabilities 的现有观察类型模块定义 `ProviderNativeIdentity { readonly namespace: string; readonly id: string }`。
只在 `ProviderPlanningItem` 与 `ProviderChangeRequest` 增加可选 `nativeIdentity`；不扩大全体 `ExternalObjectRef`、Domain identity 或 Storage port。
namespace 是 Provider 对“服务实例 + 对象种类 + ID 协议”的显式承诺，id 是该 namespace 内的 opaque 对象键。
这个声明由适配器解码已确认的内容产生，不能由 Core 根据 URL、implementationKey、账号、number、branch、commit 或 LLM 猜测。
元数据缺省表示没有跨 binding 身份证据；存在但 namespace/id 非法时结构化拒绝该观察，不能当作缺省而悄悄换身份。
Planning 仅 `change_request` 内容可携带该声明；redacted 无内容身份、issue、draft 不携带它。

两个当前公开 GitHub 实现对已验证 PullRequest node 声明同一 namespace，例如 `github.com/graphql/PullRequest`，id 为已验证非空的 node.id。
当前 Host GitHub 路径面向公开实例；该固定值仅适用于这一支持面，未来 GHES/代理到另一实例必须由 Provider 明确给独立 namespace。
不能把任意 transport 回来的 URL 当 origin 证明，也不将当前实现外推成所有 GitHub 实例的统一键。
两个真实 decoder 的契约测试分别固定上述声明，不能只用 fake 测试手填元数据冒充真实来源。

Core 在 `identity.ts` 提供唯一纯函数 `changeRequestEntityId(ref, nativeIdentity)`。
有声明时以 `JSON.stringify([EntityKind.ChangeRequest, 'native', namespace, nativeId])` 哈希派生 EntityId。
没有声明时以 `JSON.stringify([EntityKind.ChangeRequest, 'binding', bindingId, externalId])` 派生局部 EntityId。
数组编码防分隔符碰撞；两个分支均不含 workspace/project/account/repository，binding-local 分支不与另一 binding 合并。
实体前缀保持 ChangeRequest，哈希位数沿已有稳定 ID 约定；不得解析 opaque node id 的结构。
无观察的谱系骨架仍保持 `observed=false`，不得把 branch 占位符登记为真实 PR。

Planning `anchorOf` 为 PR 调同一 resolver；`ensureEntity` 可接显式 desiredId，仅 PR 使用，其他 WorkItem/Draft 行为不扩展。
先查 exact ExternalIdentity；已有身份与本次明确原生 desiredId 不一致时 fail closed，整轮不提交，不自动迁移、合并或改写旧实体。
未命中时 `putEntity(desiredId)`，再登记该 binding 的身份；若目标实体已有 primary，新身份为 alias，不能创造第二个 primary。
重复 exact identity 返回既有实体，重复 alias 不新增行；membership、身份与 Planning projection 仍在同一事务中提交。

Lineage 的真实 ChangeRequestFact 带出 `nativeIdentity`，`changeRequestNode` 直接调同一纯 resolver。
`readChainFacts` 仅计算节点身份，不注册 alias，不触碰 Planning；现有 Delivery writer 将该节点在一个事务中写实体、边与 facts。
无需为本 issue 新增 Development ExternalIdentity 登记：当前谱系存储通过 canonical entityId 对齐内容实体即可闭环。
**Superseded by Fix round 1（2026-10-28）**：上述“每次直接纯解析、不登记 Development 身份即可闭环”的结论被 native → absent 反例推翻；同 binding/ref/head 的可选声明丢失会生成另一个 fallback ID。采用下列现有身份表方案。

### Fix round 1 · Development exact identity 持久锚点

`readChangeRequest` 先要求引用的 `objectKind=change_request` 且 `bindingId` 属于实际选中的 Development read route，非法引用整组降级为 gap。
真实 PR 只读查 exact ExternalIdentity；已有 exact 且声明缺省时复用既有 entityId，明确原生声明与既有指向不一致时拒绝并保留旧 PR/check facts，只标陈旧。
没有 exact 时仍由唯一纯 resolver 计算首次身份，不从 Planning projection 或 Delivery 快照猜关联。
`readChainFacts` 带出本次确认的 PR 引用；Delivery writer 在原有事务里调用 `ensureEntity` 登记该自然键，再写端点、边和 facts。
事务内必须再次核对本次选定的 entityId；读后写前有另一指向出现时返回 Conflict、回滚整轮，不重绑。新身份按已有 primary 决定 primary/alias，重复 exact 零新增。
因此读取仍零写，身份权威仍只有 ExternalIdentity；持久摄入增加一次 exact lookup 和必要的身份行，无 schema、迁移或历史实体合并。
check 的 anchor 与 produced_by 的端点均来自同一 resolved PR 节点；不得只改展示 ID 而遗留旧 anchor。
两个入口首次观察都可幂等写同一 entity；不需要先扫描已有 Planning projection、合并双实体、重连旧边或增加 alias 索引表。
重放遵循现有 Planning 内容深比较规则；sync round/cursor 可变化，但业务 revision 不得因相同内容重放而变化。

### 拒绝方案与维护代价

拒绝裸 externalId/相同 URL/number 归并：没有显式跨域证据，可能混同不同平台、实例或仓库。
比较过静态 `ProviderDefinition.objectIdentityNamespace` + 既有 connectorAccount origin：它能隔离实例，但会把对象身份依赖于认证配置和存储查询。
当前两个结果 decoder 已掌握同一 native node ID，最小结果声明仅增加数行元数据；不需要扩 registry 校验、账号 fixture 或在 Delivery 事务重写端点。
因此选择结果声明；后续 Provider 对 namespace 的正确声明是维护责任，增支持实例必须加反例和契约。
拒绝随机首次分配 + 后续扫描合并：增加竞争、实体重定向与关系修复，未发布阶段没有这些成本的必要。
拒绝 workspace 哈希与共用假 binding：前者违反全局身份，后者掩盖真实两个 implementationKey 的边界。

## Global Constraints

代码、测试、配置增删严格 `<800`，文档 `<1300`；预估契约/decoder 40–70、Core 90–150、测试 280–380 行。
未发布，不做历史双实体迁移、兼容表或数据库重写；不改物理 schema、不新增 Storage 方法或运行依赖。
保持单 primary、事务原子性、关系候选状态、失败恢复和 Planning 唯一权威。
本 PR 独占文件集合：

- `packages/capabilities/src/observation.ts`、`packages/capabilities/src/planning-provider.ts`、`packages/capabilities/src/development-provider.ts`。
- `packages/providers/planning-github-projects/src/decode.ts`、`packages/providers/development-github/src/decode.ts`。
- `packages/core/src/identity.ts`、`packages/core/src/bootstrap.ts`、`packages/core/src/chain-facts.ts`、`packages/core/src/delivery-facts.ts`。
- `tests/integration/pull-request-identity-convergence.test.js`、`tests/integration/github-development-lineage.test.js`、`tests/contract/planning-github-projects-contract.test.js`、`tests/contract/development-github-contract.test.js`。
- `docs/architecture/release-gates.md`，本 ExecPlan。

`capabilities/index.ts` 已 re-export observation；Core 内部复用 identity，不新增 barrel、context 或执行接口改动。
`delivery-facts.ts` 原“默认不改”的边界 **Superseded by Fix round 1（2026-10-28）**：评审反例证明 Development 声明丢失会分叉，新增事务内 exact identity 登记与读后写前复验；沿用现有表，不增加 schema 或 Storage 方法，预计增加 Core 30–50 行、测试 80–120 行。
与 #365、#428 文件所有权不重叠；`docs/README.md` 由整合 owner 最终串行更新。
不改看板 Status、Iteration、原生依赖，不自行合并。

## Plan of Work

所有命令均在检出 `fix/pull-request-identity-convergence` 的工作树根运行，对应 `.worktrees/pull-request-identity-convergence`。

### Batch 1 · 双入口确定性 PR 身份

最小闭环：同一明确 native PR 在两个 binding、两种到达顺序均形成同一个实体。
主文件：`packages/core/src/identity.ts`、`packages/core/src/bootstrap.ts`、`packages/core/src/chain-facts.ts`、`packages/core/src/delivery-facts.ts`。
- 先写 fake/SQLite × Planning-first/Lineage-first 四个红测，fixture 使用不同 binding 和 implementationKey、同一显式 namespace/native id。
- 添加最小结果契约与两个真实 GitHub decoder 声明，测试 actual provider response 的输出。
- 实现唯一 resolver，Planning 登记 desiredId 与 primary/alias；Lineage 在只读生成阶段复用同一 ID。
- 断言 membership/projection entityId、PR 节点、produced_by、check anchor 一致，且只有一个相关 ChangeRequest 实体。
验证：`pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/development-github-contract.test.js`。
期望：新测试首先因双轨 ID/缺声明 RED，实现后全部 GREEN；不能把 fixture 改成共用 binding 让测试通过。
回滚点：本批独立 patch；撤回恢复旧解析规则，不删除任何既有数据或建立迁移。

### Batch 2 · 隔离、重开、幂等与门禁证据

最小闭环：误合被拒、重复零业务 revision，故障后可安全重试，门禁行指向实际测试。
主文件：新增集成测试与 `docs/architecture/release-gates.md` §2.1.1 第 3 行。
- 加不同 namespace/实例、相同 URL/number 但不同 nativeId、缺声明及非法声明反例。
- 同一个 native PR 跨 workspace/账号/binding 复用实体，但 memberships/projections 保持工作区隔离。
- 每顺序做真实 SQLite close/reopen，再从另一入口进入；重复两轮比较实体/身份数量和业务 revision。
- 注入身份/实体/边/facts 写入中途失败，验证对应事务全部回滚；再次同步恢复，不留半边。
- 检查 query 零写；redacted 没有内容身份时不造 CR；已有 desiredId 冲突明确拒绝，不静默合并。
- 更新指定门禁行，只写本项证据强度；记录 RED/GREEN、实际结果和剩余边界。
验证：`pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/integration/planning-membership-reconcile.test.js tests/integration/sync-revision-freshness.test.js tests/integration/delivery-repository-routing.test.js tests/e2e/chain-bootstrap.test.js`。
验证：`pnpm run typecheck`、`pnpm run boundaries`；期望全部 exit 0。
回滚点：撤本批文档与测试调整；身份行为可由 Batch 1 独立回滚，禁止反向改用户数据库。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 两存储 × 两观察顺序同一 CR | 四条真实命令路径，规划 entityId 与谱系 id 相等，相关 entity 仅一条 |
| 跨域证据来自真实 provider | 两 GitHub decoder 的 namespace/id 契约，不使用伪共享 binding |
| 重放不新增、不推进业务 revision | 首次内容变化后记录基准；重复两入口两轮数量和 currentRevision 不增长 |
| 全局身份与隔离兼得 | 跨 workspace/账号同 native 得同 id；member/projection 不串；不同实例 namespace 不合 |
| 不猜测误合 | 同 URL/number/branch/head 不同 nativeId、无声明不同 binding 均保留隔离 |
| 原子、失败恢复和重开 | SQLite 真实重开；摄入故障回滚 entity/identity/edge/fact 对应事务，重试成功 |
| 关系和规划边界 | PR produced_by/check anchor 一致、candidate 不升级、Status/业务 revision 不由 lineage 改写 |
| 门禁引用准确 | release-gates 指向新测试与执行命令，仅更新第 3 行的证据，不声称 R1 整体通过 |

至少用变异反例证明：去掉 namespace、退回 binding 哈希、Planning 重用随机 ID、重复恒 advanceRevision 均能被新增断言识别。
身份/持久化变化交付前运行 `pnpm verify`；结果只构成本地证据，hosted CI 需在最终 PR head 回读。
提交按两份有意义记录收敛：整合 owner 先提交方案/计划并开 draft；实现者只作一个本地未推送能力提交，独立验收修复收敛入它，最终由整合 owner 补证据/索引后 fast-forward push。
机械检查：`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`。
检查严格用户规模及公开面五类目；PR 必须 `Closes #367`，描述包含计划 + Batch、真实证据、风险和回滚。
最终 push 后用 `gh pr view -R SingularityKChen/harness-projects fix/pull-request-identity-convergence --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 及 review threads 重新回读；通过门禁才 ready，由人类决定合并。

## Progress

- [x] 2026-10-28：核对 domain 全局身份、两 decoder 和实际摄入边界，完成双案独立评审。
- [x] 2026-10-28（首次实现 `6ad21bd`）：Batch 1：真实 decoder 契约与四组合摄入先红（52 项中 6 失败：两项缺声明、四项双轨 ID），最小实现后三文件 82/82 绿；新增边界断言后两 provider 契约与集成为 102 项，见下方命令。
- [x] 2026-10-28（首次实现 `6ad21bd`）：Batch 2：集成 54/54 绿；SQLite 两顺序 close/reopen、两轮重放、五个写入故障点的回滚/重开/重试、隔离和非法声明均已断言。四组变异均被对应断言杀死，还原后 46/46 绿；随后增加的边界断言为 54/54 绿。
- [x] 2026-10-28：Fix round 1：独立 F1/F2 探针在两存储先 0/4、后 4/4；扩展集成先 50/68、后 68/68，覆盖两顺序 native → absent 重开/重放、Development identity 写后回滚、明确 native 冲突、错误 kind/binding 和事务复验竞争。
- [x] 2026-10-28：本地全门禁已执行，结果见 Outcomes；发布面五类目人工检查无命中。本轮只提交一个能力 commit，不 push、不改 PR 或看板。独立验收、最终远端 head/CI 回读与 completed/索引由整合 owner 收口。

- [x] 2026-10-28：独立验收 F1/F2 修复后复评 PASS；计划归档，等待远端检查及人类评审。

## Surprises & Discoveries

- 2026-10-28：真实 GitHub 两 decoder 已有相同 nodeId，但 implementationKey/binding 不同，说明同 fake binding 测试不足。
- 2026-10-28：Domain 身份不含 workspace，当前 lineage 哈希惯例不能覆盖内容身份规则。
- 2026-10-28：统一纯节点 resolver 会自然传播到 check anchor；无需为了收敛引入事务后实体合并或新 alias 表。
- 2026-10-28：变异经 Python 子进程调用 pnpm 时曾在测试前触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`；这些失败不算功能 RED。改用 `node --test --test-name-pattern=...` 后，首 import 的 resolution preflight 通过并由目标断言真实失败。
- 2026-10-28：独立验收发现 steady-native 全绿不能覆盖可选声明消失；Development 不登记 exact 身份导致同一对象下轮分叉。Planning 的类型校验也没有自动覆盖 Development。F1/F2 探针 Fake/SQLite 共 4 项失败，改由现有身份表解决。
- 2026-10-28：Fix round 1 首次完整回归 2414 项中 5 项失败，均来自 `github-development-lineage.test.js::planningBytes` 将共享 `external_identity` 整表计入 Planning 不变快照。调整为 Planning 三表逐字不变、原有身份行逐行不变，只允许本次真实 Development binding 下该已确认 PR 的一条新身份，canonical entity 与 primary/alias 角色逐项断言；没有放松规划状态或既有身份不可重绑要求。
- 2026-10-28：重开后 `composeCore` 会自动引导 Planning；故故障落盘断言先 close/reopen Storage、不组合 Core，确认零实体，再组合并重试。否则自动恢复成功会使“重开仍为零”的 fixture 断言失真。

## Decision Log

- 2026-10-28 / 计划评审者：选 PR 结果的 `{ namespace, id }` 声明，限制在实际对象，不扩 ExternalObjectRef；文件范围见 Global Constraints。
- 2026-10-28 / 计划评审者：拒绝 static namespace + account origin 作为本轮默认；当前对象证据已在 decoder，少一次认证/Storage 耦合与更多配置 fixture。
- 2026-10-28 / 计划评审者：全局 canonical ID 不含 workspace；缺声明仅 binding-local，绝不把它声称为跨域验收。
- 2026-10-28 / 计划评审者：Lineage 不新增 identity 登记；统一实体、关系和快照已满足 #367，保留当前写者职责。**Superseded by Fix round 1（2026-10-28）**：F1 证明可选声明消失时不成立，现有 ExternalIdentity 登记为唯一持久锚点。
- 2026-10-28 / 计划评审者：不合并已有双实体、不改 Status/Iteration/原生依赖，未授权合并 PR。
- 2026-10-28 / 实现者：保留现有 Delivery writer，仅读入的 PR 节点经唯一 resolver 收敛；两类摄入各自原子，Lineage 每轮验证 Planning 投影和业务 revision 不变。**Superseded by Fix round 1（2026-10-28）**：新增 writer 内的 exact identity 登记和原子复验，其他职责不变。
- 2026-10-28 / 实现者：只有明确原生声明才校验已有 exact identity 与 desiredId 的冲突；后续声明缺省时保留已登记实体，不用 binding fallback 否决它。新反例修复前两存储 2/2 红，修复后全文件 54/54 绿。
- 2026-10-28 / 实现者：本轮变异在指定隔离 worktree 顺序执行，以文件原字节备份、非空 diff、解析守卫和 `finally` 还原保障证据；不触及其他检出。M1 去 namespace → 隔离 2/2 红，M2 native 改 binding、M3 Planning 改随机、M4 恒推进 → 四顺序 4/4 红。

- 2026-10-28 / 整合 owner 裁定、实现者落实：F1/F2 属本 issue；推翻“无需 Development 登记”，复用现有自然键，在 Delivery 事务内登记/复验，读侧仅 lookup，拒绝错误 kind 与跨 route binding。维护代价为一条 PR exact 身份与一次事务内复验，避免新 schema、快照权威或历史合并。

## Idempotence and Recovery

确定性 ID 与 exact natural-key 查找可反复执行；实体重复写入不产生第二条，alias 重复不新增，业务 revision 由已有内容比较裁决。
Planning 摄入和 Delivery 摄入分别在各自事务内完成；失败原样回滚，修复 Provider/Storage 故障后重新同步。
非法声明或已存身份与新的明确 desiredId 不一致时 fail closed，记录结构化诊断，不自动迁移实体/边。
撤回本 PR 代码即可回到旧行为；保留既有数据，不保证旧代码继续收敛新共享身份，评估使用新测试库，不能自动重建用户库。
若新平台实例需求使 namespace 不再充分，停止扩大本 issue，补契约和成本后重新规划。

## Interfaces and Dependencies

沿用 Node/pnpm/TypeScript、现有 Storage transaction、ExternalIdentity/Entity 与两个 GitHub Provider；不新增依赖或凭据。
namespace 是适配器拥有的对象事实契约；认证账号、项目成员关系与规划状态不是身份解析输入。
公开的三个 PR 独立；整合 owner 串行维护索引和最终交付证据，各实现者只写声明的文件集。

## Outcomes & Retrospective

在检出 `fix/pull-request-identity-convergence` 的工作树根运行：

- `pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/development-github-contract.test.js`：首次实现 102/102；Fix round 1 扩展集成文件实际读回 68/68，两个真实 decoder 契约由下方 202 项命令一并覆盖。
- `pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/integration/planning-membership-reconcile.test.js tests/integration/sync-revision-freshness.test.js tests/integration/delivery-repository-routing.test.js tests/e2e/chain-bootstrap.test.js`：首次实现 180/180；Fix round 1 使用下条更窄的 Delivery 相关回归与完整 verify。
- `pnpm test:file tests/integration/pull-request-identity-convergence.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/development-github-contract.test.js tests/integration/delivery-pages-complete.test.js tests/integration/delivery-repository-routing.test.js tests/integration/github-development-lineage.test.js tests/integration/github-actions-ci-facts.test.js tests/e2e/delivery-lineage.test.js`：Fix round 1 为 202/202。
- `pnpm verify`：类型检查、contract/integration/e2e 及 MVP0 必须全部 exit 0；首次实现为 2400/2400 + MVP0 7/7；Fix round 1 最终为 2414/2414 + MVP0 7/7，全部 exit 0。
- `pnpm run boundaries`：9/9；`node scripts/workflow-check.mjs`：8 个文件 no findings；disclosure、size 与 `git diff --check origin/main...HEAD` 在本地能力 commit 后再次执行，预期无命中、规模低于 Global Constraints。

两个实际 GitHub decoder 声明同一公开实例 namespace；Core 不查账号、不猜 URL、不新增 schema/Storage 方法或迁移。故障点覆盖 Planning 实体/身份和 Lineage 实体/身份/边/facts，每个写后抛错均回滚，重开后可以恢复。查询零写与无观察骨架仍保持。
本地证据仅支持 release-gates §2.1.1 第 3 行这一项；不能据此宣称 R1 或 issue 已获人类接受。遗留边界仍为历史双实体修复、新实例支持和 Draft → Issue 提升，没有新增技术债基础设施。
独立复评已通过并完成归档/索引；远端最终 head/base/checks/关闭引用按本计划命令回读，通过后 ready。

## Bottom Change Note

- 2026-10-28：首次创建；裁决 per-object 原生身份、全局作用域、双入口纯解析与最小持久边界。
- 2026-10-28：完成两批本地实现、真实 RED/GREEN、四组变异、故障重开与完整验证；记录环境性非功能失败和自动 bootstrap 的 fixture 边界，保留独立验收/远端交付门。
- 2026-10-28：Fix round 1 按 F1/F2 真实反例订正原处结论，新增 Development exact identity 原子登记/复验、引用归属校验与对应 RED/GREEN；不扩展 schema、迁移、Planning 或外部写入范围。

- 2026-10-28：独立复评 PASS 后归档；保留旧裁定的 Superseded、缺声明重放与类型守卫修复证据。

- 2026-10-28：订正归档顶部遗留 Active 文案及已完成验收待办；三项产品组合在独立集成检出通过 2442 + 7 与类型检查，最终远端事实仍以回读命令为准。
