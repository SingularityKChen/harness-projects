# ADR-0008：执行运行的身份是 core 的运行记录，provider 引用是由签发者证明来源、由 core 原子替换的路由句柄

> 状态：Proposed
> 日期：2026-09-28
> 来源：`docs/exec-plan/completed/2026-09-24-human-execution-provider.md`（第十轮评审响应）；issue #139 / #171 / #172；PR #161 第七至九轮的四条 P2（来源闸门、取消分叉、binding 稳定来源、指令可见性）

## Decision

1. **运行身份 = Storage 里的那条运行记录**（`ExecutionRunRecord`，键是 `runIdFor(contextId)`）。执行 provider
   签发的引用落在它的 `providerRef` 字段上，是**路由句柄**，不是第二个身份：重启后 `getRun` / `cancelRun`
   只按它路由，不按 core 自己的 id 猜。
2. **core 是 `providerRef` 的唯一写者**，写入时机只有两个：启动（主执行或 fallback 承接）ack 之后，以及取消
   ack 之后——后者在一个 Storage 事务里**同时**替换状态与引用。已取消的运行身份不再调 provider；并发的第二个
   取消在事务里看到已替换的记录就返回那一个。
3. **签发者身份由宿主注入并在重启前后保持不变**：无状态 provider 的 `bindingId` 与签发密钥缺一即拒绝构造；
   core 路由不到签发该引用的 binding 时 fail closed（`not_found`），不换一个 binding 去问。
4. **无状态 provider 的引用必须能证明来源**：人工执行 provider 的引用带 `HMAC(签发密钥, [bindingId, 规范体])`（JSON 数组分帧，保证输入单射），
   未签、改过字段、换密钥或换 binding 的同形引用一律 `not_found`。
5. **`command` / `environment` 是一次性输入**，不进引用、不进任何记录（port 义务 3）；交接所需的指令事实是执行
   上下文，"这次运行由降级产生"作为运行记录的 `fallback` 字段落库，而不是从 `failed` 反推。

## Why

它保护 `AGENTS.md` §1.1 不变量 7（Host 拥有权威状态）与实现级硬约束（凭据不进 Project 数据库；外部写入 ack
之前不显示权威 `Saved`）。

无状态 provider 是引用的纯函数：它撤销不了已经签出的 `running` 引用，也挡不住同一个引用被取消两次——PR #161
第七、九轮实测同一原始引用取消两次得到两个 canceled 引用，原始引用仍读回 `running`。能让一个运行身份只剩一个
事实的，只有一个有状态、单写者的权威；本系统里那就是 core 的运行记录。反过来，引用一旦落库就成了重启后唯一的
路由依据，于是"谁签发的"必须可验证（否则同形伪造引用会被当成一条 `running` 运行），"签发者是谁"必须稳定（否则
随机默认 binding id 会让重启后的实例把旧引用判为 `not_found`，而且这个失败直到重启之后才暴露）。

## Rejected

- **provider 自带运行账本**（像 fake 那样的进程内表，或 provider 自己的文件）：取消可以就地改状态，但运行事实
  会有两个写者（provider 的账本与 core 的记录），`AGENTS.md` §1.1 的"显式状态拥有"随即失效。
- **把 `command` / `environment` 编进引用或运行记录**：`environment` 可能携带凭据材料，而 `providerRef` 原样落库；
  core 今天下发的 `command` 也只是分支名的推导，信息已在执行上下文里。
- **降级结论继续从 `status === failed` 反推**：fallback 承接成功的人工运行是 `running`，反推会让同键重放与查询面
  报"未降级"，而首次 `startWork` 报的是 `manual_fallback`（第十轮在 PR head 上实测）。
- **缺 binding id 时随机生成、缺密钥时不签名**：两者都把配置错误推迟到重启之后，以"旧运行读不回"的形式暴露。

## Consequences

- 任何执行 provider 若无法从自己的平台回答"这个引用是不是我发出的"，都必须像人工 provider 一样签发可验证的引用；
  有平台的 provider（真实 harness）由平台回答，不需要签名。
- 签发密钥轮换会让既有引用读不回（core 取消时 fail closed、记录不变）。轮换方案（多密钥验签窗口）在出现第一个
  真实宿主装配（#132）时再定，本 ADR 不承诺。
- `ExecutionRunRecord` 增加 `providerRef` 与 `fallback` 两个字段，SQLite 迁移 004 增加对应两列；两个 Storage
  实现在执行组契约里逐字段往返。
