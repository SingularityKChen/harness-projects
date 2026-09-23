# ADR-0001：外部身份注册表的键是「平台绑定 + 对象种类 + 平台全局 node id」

> 状态：Proposed
> 日期：2026-09-21
> 来源：`docs/exec-plan/completed/2026-09-21-gate-e1-ruling.md`（Batch 1，issue #25）；证据见 `docs/architecture/gate-e1-content-identities.md`（E1-1 / #22）

## Decision

外部身份注册表 `external_identity` 的键是 `(binding_id, external_kind, external_id)`，其中：

1. `external_id` 存平台给出的**全局 node id**（跨 API 面逐字相同的那个值）；
2. `external_kind` 显式存储，取自平台返回的类型名（`__typename` 或条目 `type` 的显式映射），不通过解析 id 前缀得到；
3. 各 API 面自己的数字 id 只作为该面的局部属性存储，不参与键，也不作为查重依据。

## Why

它保护的不变量是"同一个底层对象只有一条内容身份"。实测（E1-1 实验 3 §6 第 1 条）：同一个 change request 在同一个平台的 REST 面上有两个不同的数字 id——`pulls/5.id = 4588791734` 与 `issues/5.id = 5523780322`，两者互不相等；唯一跨面一致的是 node id（GraphQL `PullRequest.id` 与两个 REST 端点的 `node_id` 逐字相同，`PR_kwDOUjWAl88AAAABEYNntg`）。

如果键里放的是 REST 数字 id，调用方按哪一个端点取值，就会为同一个底层对象建出两行身份。E1-1 实验 3 §6 第 2 条进一步证明"该用哪个端点"这一额外知识不可靠：REST `issues/5` 返回了对象，而 GraphQL `repository.issue(number: 5)` 返回 `null` 并报 `NOT_FOUND`——两个 API 面对"编号 5 是不是一个 issue"给出相反答案。

对象种类必须显式，还因为它的词形在两个面上不同：`ProjectV2Item.type` 是 `PULL_REQUEST`，`content.__typename` 是 `PullRequest`（E1-1 实验 3 §6 第 3 条），按字符串相等匹配会漏配。

## Rejected

- **「平台 + 单一规范 id」**：对同一个 change request，两个端点的数字 id 会产生两个键；反例构造与实测见 E1-1 实验 3 §3。
- **只存 REST 数字 id**：draft 在仓库面上完全不可达（E1-1 实验 2 §4 实测 REST issue 面计数为 5，两个 draft 都不在其中），数字 id 在 draft 上取不到。
- **用 `(repository, number)` 作内容键**：draft 上这两个字段在类型上不存在（`undefinedField`，E1-1 实验 2 §4），这个键在 draft 上无法构造。
- **按 id 前缀（`I_` / `PR_` / `DI_`）推断对象种类**：前缀只作为一致性校验；种类来自平台返回的类型名。

## Consequences

- 每次外部读取必须取到 node id；只返回数字 id 的响应不足以登记内容身份。
- 内容身份可以跨工作区复用：同一个对象加入第二个工作区不产生第二条内容身份（E1-1 实验 1 §7、E1-2 实验 1 §4）。
- 注册表的查重只按对象键，不看角色；同一实体可以同时拥有 `primary` 与 `historical` 两条身份（Draft→Issue 提升，见 E1-2 实验 2 §5）。
- 需要一条把平台类型名映射到 `external_kind` 的显式表；映射缺失时登记失败，不做前缀兜底。
