# PR #568 MMP 工程评审

## Purpose / Big Picture

验收已确认PR的原生负责人选择、持久意图、读回和恢复；源码Ready独立于安装、人类UAT及R1。

## Context and Orientation

2026-11-07 SGT，在检出 `feature/pr-assignee-management` 的工作树根审查。最终受验源码 `4db6e3ca`，base `7bab4b8c`；旧全量与早期Fake测试只保留历史身份。原生API由合成transport提供，SQLite为真实介质。

当前对象运行 `gh pr view 568 --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviewDecision,mergeStateStatus,closingIssuesReferences,statusCheckRollup` 和 `gh pr checks 568 --repo SingularityKChen/harness-projects` 回读，并分页读完reviewThreads、Issue567的closedByPullRequestsReferences。最终head必须重新成立，旧Ready不代替新head。

## Design / Spec

| 风险 | 审查结论 |
|---|---|
| P0 事实源 | 无发现；不改Planning、作者、Issue关系或已确认PR身份。 |
| P1 外部写 | durable claim先于一次Add，原生完整分页/身份证明/子集读回后确认；未知只观察。 |
| P1 权限 | 当前descriptor和已有operationVersion围栏覆盖每一成功出口，raw403/regrant及并发Saved不能复活旧成功；失败如实failed。 |
| P2 恢复 | 同键指纹固定请求、系统sequence正交；SQLite双实例/重开、完整receipt、overflow和旧shape拒绝均有判别测试。 |
| P3 产品 | 默认不指定，候选与事后添加可用；scope/token变化清旧身份；缺权限/未知/失败分开，不借创建权限。 |

## Global Constraints

代码/测试/配置<800，文档<1300；不删安全case或压行凑数。独立验收只读产品树，变异仅精确源导出。未发布当前003DDL直接收紧/扩展，不新增旧版迁移或兼容框架；原库与匹配artifact保留。

## Plan of Work

Task1完成纵向闭环与TDD；Task2对F1分页终游标、F2拒绝epoch、F3动态权限/共同出口及明确失败恢复依次独立复评。整理后重锁所属源码/测试/fixture相同，再按当前head托管、双向Issue和全线程门置Ready。文档归档后继续回读，未经人类授权不merge。

## Validation and Acceptance

在上述分支根运行 `pnpm test:file tests/integration/change-request-assignees.test.js tests/contract/development-github-assignees.test.js`，最终29/29；`pnpm test:file tests/e2e/repository-routing.test.js tests/contract/ui-model-presentation.test.js` 39/39；typecheck通过。独立carrier/runner38/38、另一Core SQLite ABA1/1通过。owner扩展256、最终29、browser5、boundaries9均通过，范围重叠不累加；旧3740+8不是F3后本地全量。

| 危险变异 | 具名判别 | 结果 |
|---|---|---|
| 移除共同成功末门 | SQLite concurrent saved receipt passes the common final permission gate | KILLED |
| 失败结算强制人员读准入 | native DevelopmentAssignees refusal stays failed and terminal discovery restores newer additions | KILLED |
| 缺终游标仍成功 | incomplete assignee pages reject directory/read/add without mutation: undefined | KILLED |
| 拒绝代际回写捕获值 | overlapping denials cannot roll permission epochs backwards and release a late identity | KILLED |
| 去完整receipt比较 | revoked or replaced receipt cannot settle or reveal late assignee identities | KILLED |
| 代际变化不推进operationVersion | successful native readback cannot settle after a newer raw denial, recovery=true | KILLED |
| 部分读回直接成功 | partial readback remains unknown and concurrent extra assignees survive | KILLED |

七项各baseline→具名AssertionError→逐字还原均0→1→0，未把环境/语法/无效selector计为KILLED。精确patch、SHA256、命令和原始输出保留本PR工作树 `.superpowers/sdd/2026-11-07-pr-assignee-management/`。新main不重叠接口经39项受影响验证，不能声称整个仓库tree未变。

## Progress

- [x] (2026-11-07 SGT) 独立任务与最终全分支矩阵、F1/F2/F3修复及最终7项变异完成，零未决P0–P3。
- [x] (2026-11-07 SGT) 历史源码head4db6e3ca全部相关托管checks、双向567与全线程门通过，Ready读回成立；归档后的head另行核对。

## Surprises & Discoveries

原F3四项作者用例默认Fake误称SQLite，已在原报告/计划原处Superseded更正，未冒称原RED介质。最终helper显式SQLite并重跑。共同出口反例与known-failure pending槽反例先20tests/2fail RED，后在根因处归并控制流。真实DRY统一完整scan、receipt合法转移、fixture defer/setup，保留全部安全case，仅移除两个由真实行为覆盖的typeof哨兵。

## Decision Log

2026-11-07 SGT：必要registry方法接线；003当前DDL精确白名单；per-PR序号与同键身份正交；可选易失permissionVersion复制Provider既有代际并接既有runtime围栏。均记录所属计划的依据与恢复边界，不引入第二权限或规划权威。

## Idempotence and Recovery

同键改人冲突；unknown不重复Add；明确failed可修权限后用新显式意图重试，pending/unknown先核对原记录。回滚整PR不撤外部负责人、不删DB；运行旧artifact时使用其匹配的已验证备份/隔离库，不能伪装旧schema接受新intent。

## Interfaces and Dependencies

三独立Provider能力、Core唯一assignment协议、Host严格ABI、scoped client和UI picker；本地query不做GraphQL。permissionVersion只内存、本实例拒绝代际，不是持久授权事实。B复用此协议，以稳定key关联创建时意图，不以latest序号替代。

## Outcomes & Retrospective

源码独立审查完成，原生合成平台/真实SQLite/生产carrier证据成立；4db6e3ca托管CI和Ready为带head的历史观察。后续任何push须重新读当前门。没有真实GitHub token、安装Host、人类UAT或R1接受的新证据，不推进规划Status。

## Bottom Change Note

2026-11-07 SGT：保存最终风险矩阵、根因修复、精确变异及源码head Ready观察，计划归档后保留最终head回读义务。
