# PR #495 · 持久 PR 操作后端 MMP 评审

## Purpose / Big Picture

受信消费者创建一次PR后，可在Provider丢ack或整份成功响应丢失时，通过当前授权scope发现原操作并只读恢复。原actor/key/body/marker与唯一外部mutation保持，确认结果受当前目标和权限约束。

## Context and Orientation

设计基线为 `554e6fefb1ad9781becf879b9f96e367e9f6ceff`；初评 `a5d8c61` 发现必填selector P2；最终技术对象 `531ffff764b9883e7846e3616f006d5290a356dd` 在 `.worktrees/pr495-final-review` 独立复评。#494由本层关闭，#437的Host/client/详情由PR #491关闭。正式计划见 `docs/exec-plan/completed/2026-11-02-pull-request-command-recovery.md`。

## Design / Spec

单一create/resume状态机复用现有收据、relations与Core刷新所有者。恢复只接收list/get读端口；query单一本地事务零Provider/零持久写。默认发现为同context全部pending/unknown并上精确currentTarget的Saved，历史Saved不阻挡新代际；全并集多个候选明确ambiguous，不取first/latest。必填resume selector与可选query selector分开捕获；最新短事务共同核对授权、目标、收据和实际获胜PR集合。

## Global Constraints

覆盖后端闭环及785行技术源码；最终文档规模用 `node scripts/rule-checks.mjs size origin/main` 重算。无Host/UI运行依赖、第二账本、TTL、索引或迁移平台；原Planning Status/native blocking关系不变。所有命令在对应冻结技术检出或本计划分支工作树根执行，Node26/pnpm10.28.2；公开文档不包含本机绝对路径。

## Plan of Work

初轮全矩阵及六正式变异后修复selector；独立UI验收又发现Saved整成功响应丢失与pending-only规格的矛盾，由独立设计复核后按同一target谓词修订。原owner完成TDD与全量，独立复评累计修复、真实最后窗口、八项正式当前树变异。最后整理提交和当前远端门，仅请求人类评审。

## Validation and Acceptance

| 层 | 核对 | 当前技术结论 |
|---|---|---|
| 代码 | durable pending、required selector、getter-safe capture、不可变scope、单次create | PASS |
| 产品 | Unknown与Saved整响应全丢、新observer恢复、历史Saved排除/并集歧义 | PASS |
| 架构 | 原binding读门、纯本地query、精确candidate升级、Core唯一刷新/最后事务 | PASS |
| 并发与测试 | Saved单调性、六真实事务barrier、全表快照、八正式mutant | PASS |
| 工作项 | #494独立API、36Core/2Host完整映射、SQL/rollback、严格规模 | PASS；上层与发布另行验收 |

初评P2：missing/undefined operationId错误落入discovery并恢复唯一未决操作。修后八非法selector永久反例零Provider/全持久delta。跨层P1：成功Host回复整体丢失后Saved不可发现；修后可信当前Saved参与唯一性发现，原actor/key/input不变。两者最终均无未决项。

## Progress

- [x] (2026-11-02 SGT) 两独立设计、独立综合及后续发现规则窄复核完成。
- [x] (2026-11-02 SGT) 原反例RED→GREEN、独立28探针/309相关测试通过。
- [x] (2026-11-02 SGT) 八项当前树变异归因KILLED、基线前后绿、源码逐字恢复。

## Surprises & Discoveries

Provider接受后丢ack与Host已Saved后整成功回复丢失是两种不同断点。只验证Unknown不能覆盖第二种；保留先前失败结论并明确pending-only规格已被替代。RelationState仅candidate/confirmed，未因错误夹具添加rejected平台。

## Decision Log

2026-11-02：复用一个matchesTarget谓词控制Saved资格和返回view；保留全部旧未决的保守性和完整并集歧义。完成状态可查询的原则不要求generic LRO/队列。getter与scope守卫沿现有输入捕获；不扩公共ABI。当前物理SQL CHECK必须如实披露，不以“无新表列”声称无基线改变。

## Idempotence and Recovery

query可重复，resume结构上不能dispatch、不登记替代收据。回滚保留外部PR和用户数据。当前SQL CHECK支持PR intent，旧DDL会被shape admission拒绝；升级和回退前停调用方并完整备份，旧reader不保证读取新物理合同，不能自动清库/重建。历史整理保留backup ref与精确lease，核对源码等价后发布。

## Interfaces and Dependencies

纯query为 `getChangeRequestOperation({workItemId,repositoryId,operationId?})`；resume为scope+必填operationId+observer。最小DTO不含原body/actor/key/marker。依赖已交付正式GitHub Development adapter、现有Storage/relations/refresh；native stack #496为 #495→#491，两个层分别可审阅/回滚。

## Outcomes & Retrospective

最终独立SPEC/QUALITY均PASS、P0–P3零残留。冻结技术检出运行 `pnpm test:file tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/contract/storage-contract.test.js tests/integration/pull-request-identity-convergence.test.js` 为309/309，独立28探针和边界9/9；作者 `pnpm verify` 为2818+7，零跳过。

正式八变异覆盖原读门、candidate升级、最终scope、PR freshness、Saved单调性、marker证明、required selector、Saved发现；均由预期用例killedBy击败，逐字还原。组合检出 `test/iteration9-final-acceptance@e98f449` 合入两个栈顶后3019+7、边界9、产物/Host/谱系79通过；唯一共享start-work冲突经精确一谓词差异证明后保留#490完整实现。末轮上层小修及最终远端结果由对应上层记录，不把此历史组合伪装成未来head。

最终push后重读PR #495当前head/base、必需checks、双向关闭关联及分页全部review threads，符合才Ready。此记录不建立live GitHub权限/网络一致性、installed Host人工UAT、#143/#449或R1；无新增接受延期债务。

## Bottom Change Note

2026-11-02：自包含归档后端完整矩阵、两次因果修复与当前八项正式变异，保留物理基线和人工门边界。
