# ADR-0015：一个仓库一个实体，各连接下的引用是并列身份，Development 按操作路由

> 状态：Proposed
> 日期：2026-10-21
> 来源：`docs/exec-plan/active/2026-10-21-repository-binding.md`（#353）；`docs/exec-plan/completed/2026-10-08-development-repository-routing.md`（#219 的 D1、D7、D23）；`docs/architecture/gate-e1-ruling.md` §4 的 R7

## Context

演示里一个仓库同时由三条连接服务：Local Git（分支与工作树）、GitHub Development（PR 与远端分支）、GitHub Actions（CI）。今天工作区的仓库挂载（`RepositoryRecord`）只指向一条外部身份，`packages/core/src/development-route.ts` 因此只能到达一个 Development 连接。

身份角色 `alias` 在 `packages/domain/src/identity.ts` 与 `002_identity_membership.sql` 里存在，却没有生产写者，也没有成文语义。R7 只规定了两种角色：`primary` 可作平台查询参数或同步游标，`historical` 只在本地可读。`003_control_facts.sql` 把 `repository.external_identity_id` 注释为「R7 身份锚点」。

两个 Development 实现都声明 `development.repository.read`，所以按单个 key 路由时，这个 key 必然歧义。

## Decision

1. **一个实体，多条并列身份。** 一个工作区仓库（键 `repositoryId`）是一个 `repository` 实体，它在每条连接下的引用是一条身份 `(bindingId, repository, repositoryId)`，都挂在这个实体上。
   - 仓库挂载指向首次登记写下的那条身份。它是 `primary`，此后不改指。
   - 其余引用都是 `alias`，交付连接的引用也是。
   - 不改 schema、Storage 端口与迁移。
2. **`alias` 的语义。** alias 是同一内部对象在另一条连接下的**现行**引用，只交给它所属连接的 provider。`historical` 的含义不变：只在本地可读的旧身份。
3. **R7 逐字成立。** 仓库身份的 `external_id` 是宿主选定的工作区仓库键，不是平台 id。provider 只拿它与自己配置的键比对，平台寻址只来自挂载配置（路径、owner / name）。因此仓库引用的 `external_id` 从不作平台查询参数或同步游标，路由到 alias 不触犯 R7。
   - 要把平台 id（例如 TD-064 的仓库 node id）存进仓库身份的 `external_id`，须先改本 ADR。
   - 存进挂载配置则不需要。
4. **按操作路由，按声明选择。** 一次操作有一个锚点 key 与若干前置门，前置门在选中的同一挂载上判定。
   - 仓库只有一条现行引用时，就用它。
   - 有多条时，取唯一声明锚点 key 的那条。没有声明者报 `not_supported`，多个声明者报 `conflict`。
   - 角色、登记顺序、可用性与探测都不是选择的输入，绝不取第一个注册者。
   - 工作区元数据按同一选择逐仓库报告可用性。
5. **唯一写者。** core 的 `registerRepository` 是仓库实体、引用身份与仓库挂载的唯一写者，绑定命令与开始工作的懒登记共用它。已登记的仓库只追加引用，不改指锚点。
6. **交付来源每工作区一个。** 工作区已有启用的交付挂载时，再绑定另一个交付来源会被拒绝，不替换。

## Why

- **不变量 6**：谱系沿同一实体传播，不重新识别。
- **不变量 5**：关联由绑定命令显式写下，不按名字、URL 或探测猜测。
- **模型不需要迁移。** 存储已经强制每个实体至多一个 primary（部分唯一索引 `external_identity_primary`），也接受同一实体上的 alias（契约套件 `tests/contract/suites/storage-identity-membership.js`）。
- **按操作路由是 #219 规则的延伸。** #219 已经规定「一次操作只路由一次，前置门在同一挂载上判定」。如果按单个 key 路由，开始工作的前置门 `repository.read` 会永远歧义。
- **业界做法相同。**
  - Git 让同一分支的 fetch 与 push 走不同远端（`pushRemote`）。远端多于一个时，Git 不再隐式回退，要求显式选择（`checkout.defaultRemote`）。
  - Sourcegraph 的一条仓库记录带多个来源。

## Rejected

- **每条连接一个 primary。** 要改部分唯一索引，并与「每个实体恰好一个 primary」冲突（#27，以及 #190 计划的 `primary_identity_id` 列）。
- **每条连接一个实体。** 这是重新识别，违反不变量 6。
- **另立引用表或路由表。** 「仓库属于哪个连接」会有第二个权威源（#219 D1）。
- **按单个 key 路由，或以 primary、第一个注册者、默认挂载兜底。** 违反 #353 验收 2 与不变量 5。primary 优先还会让变更请求读到本地分支头。
- **按可用性或探测选择。** 选择会随 provider 健康度漂移，命令与元数据不再同源。

## Consequences

- **#297。** 它把谱系的变更请求读与远端分支读改走「变更请求读」操作：锚点 `change_request.read`，前置门 `repository.read`。不得单独按 `repository.read` 路由。
- **交付读取（TD-074）。** 交付读取仍按 key 取工作区默认的交付挂载；要按仓库路由交付，需要新的决定。
- **解绑与改绑（M4.1）。** 解绑、改绑与引用歧义的补救都需要新的决定。在此之前，歧义是确定性的结构化拒绝。
- **R7 的指引。** 本 ADR 采纳后，在 `docs/architecture/gate-e1-ruling.md` 的 R7 行末追加一句指向本 ADR；采纳前不改裁决文本。
