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


## 2026-11-09 当前 immutable head 独立复评

本轮固定 `head=8f0e2f8ac33ea7a58700750626748d85502e278a`、`base=main@7bab4b8c79eb497e16d4bb490f2a33d83863be35`；以本 PR 自己的工作树为执行上下文。上述 2026-11-07 证据完整保留，不自动迁移到本轮 head。评审采用 Superpowers、Qian Systems Router 与 First Principles Development；阶段为审查与集成，目标是确认用户能在已确认 PR 上以正确权限添加负责人，并在失败、撤权、重启和并发后保持诚实状态。

### 先验风险矩阵

| 等级 | 层与假设 | 最小判别证据 | 当前状态 |
|---|---|---|---|
| P0 | 数据/凭据泄漏、main 破坏或第二规划事实源 | 全 net diff、DDL 兼容形状、依赖边、发布面检查 | 待核对 |
| P1 | 原生权限或 repository/PR/actor scope 错位导致越权或写错目标 | descriptor/operationVersion/permissionVersion 围栏、Provider 身份校验与反例 | 待核对 |
| P1 | 幂等意图丢失、未知结果重复写、SQLite 重开与取消竞争让错误状态成为 Saved | durable claim→Add→readback→settle 全路径、并发与真实 SQLite 测试 | 待核对 |
| P1 | UI→Host→Core→Provider 无法闭环，Host 权威被前端状态取代 | 原生 assignment 入口、carrier ABI、既有 PR 选择与恢复入口 | 待核对 |
| P2 | 候选/回读不完整、刷新/错误/恢复提示不准确但可恢复 | 分页终游标、筛选、取消、动态权限、UI 判别测试 | 待核对 |
| P3 | 设计超过验收范围、文档或重复跟踪失真 | issue #567 acceptance、ExecPlan、开放同类 issue 与提交规模 | 待核对 |

事实：当前检出源码与指定 head 相同，初始工作树干净；不修改实现、测试、Git 或外部状态。硬约束：Planning/工程轴正交、Host 权威、Provider ack/reconcile 前不能 Saved、unknown 不重放写入。主要未知：原生权限与 durable recovery 在本轮实际 net diff 的组合是否仍满足这些约束。


### 本轮矩阵结论与唯一意见

| 等级与层 | 当前 head 结论 |
|---|---|
| P0 数据、main、发布面 | 未发现新增缺陷；完整 net diff、DDL 白名单、人工五类发布面及机械扫描未见越界。 |
| P1 权限、目标和事实拥有 | 未发现新增缺陷；三能力独立、原生 PR/repository 证明、当前 descriptor 与拒绝代际、共同成功末门保持成立。 |
| P1 耐久恢复、并发和取消 | 未发现新增缺陷；真实 SQLite 单次认领、双实例、重开、完整 receipt、明确失败与 unknown 分开；UI scope/accessToken/连接换代和 Host lease/drain 已核对。 |
| P1 用户闭环与架构 | 生产 carrier 浏览器完成选择→未知→重载→只读恢复，create=1/add=1；Host 仍拥有确认，Planning/关系未改变；边界 9 项通过。 |
| P2 产品错误反馈 | 新增一项，见 F1；没有发现其它可定位的 P2。 |
| P3 范围、设计和跟踪 | 未发现新增缺陷；专用三端口、复用现有日志/状态门足以实现本叶子，无通用 metadata 编辑器。#557 是创建前预选父项，#567 是本叶子，未发现 F1 的独立跟踪项。 |

**F1 / P2 / 非阻塞：保留候选目录失败种类，提供对应恢复提示。** 新增行 `packages/ui/src/change-request-assignees-section.ts:17` 捕获所有错误但只保存当前 owner，`:25` 因而对不支持、拒绝和不完整/暂不可读都显示“负责人候选不可读取”，仅提供相同重试。触发：当前已确认 PR 的候选目录返回 `not_supported`、`permission_denied`，或平台分页不完整（Provider 安全拒绝为 `unavailable`）。影响：用户无法分辨连接根本不提供能力、需要修权限、还是可以重试读取；#567 第一条验收明确要求 unsupported/denied/partial feedback。底层安全拒绝仍成立，因此定级 P2。

独立复现没有改源码或测试：在工作树根以 Node module heredoc 导入真实 `ChangeRequestAssigneePicker`，用既有契约测试相同的 React hook dispatcher 分别拒绝上述三个 code。三次实际渲染文本均为 `仓库允许的负责人 | 筛选已读取候选 | 重新读取负责人候选 | 负责人候选不可读取`。修复应把允许名单内的失败种类经 options carrier 传到 UI，区分不支持/权限修复/暂时或不完整读取，并补一条具名判别；不要透传 Provider 原异常。当前候选 command 的 Host 异常会被固定文案收口，单改 UI 文案不能保留已丢失的种类。此意见没有复用旧 head 结论，也没有以缺少覆盖代替行为证据。

### 本轮实际验证与证据边界

命令均在本 PR 工作树根、上述固定 head 运行；分组不相加冒称新全量：

- `pnpm test:file tests/integration/change-request-assignees.test.js tests/contract/development-github-assignees.test.js tests/contract/ui-change-request-assignees.test.js`：31 tests，31 pass，fail/cancelled/skipped=0。
- `pnpm test:file tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-github-catalog.test.js tests/e2e/repository-routing.test.js`：78 tests，78 pass，fail/cancelled/skipped=0。
- `pnpm test:file tests/browser/workspace-execution.test.js`：5 tests，5 pass，fail/cancelled/skipped=0，含真实 carrier/SQLite/键盘与重载恢复。
- `pnpm run typecheck`、`pnpm run boundaries`（9/9）、`node scripts/rule-checks.mjs disclosure 7bab4b8c79eb497e16d4bb490f2a33d83863be35`、`node scripts/rule-checks.mjs size 7bab4b8c79eb497e16d4bb490f2a33d83863be35`、`git diff --check 7bab4b8c79eb497e16d4bb490f2a33d83863be35...8f0e2f8ac33ea7a58700750626748d85502e278a`：全部 exit 0。immutable diff 为代码 799、文档 231 行，符合本叶子 <800/<1300；本轮追加评审证据待 owner 整合后重新核算文档和远端 head。

测试判别性直接核对了 foreign PR 零 mutation、部分读回不能 Saved、同键换人 conflict、unknown 不重写、raw deny→regrant 不能释放旧身份、SQLite 重开与并发 Saved 的共同末门；未重复历史七项变异表，也不将历史 KILLED 升级为本轮新运行。独立 F1 渲染反例表明当前绿色 UI suite 没有要求这三种失败呈现不同反馈。

2026-11-09 SGT 实时只读回读仍为 `main@7bab4b8c` / `head@8f0e2f8a`、非 Draft、MERGEABLE/CLEAN、reviewDecision 为空，两条提交是能力源码与归档评审文档。#567 仍 OPEN，双向 closing 指向 #568；其 ExecPlan 旧 active 路径已归档为本文所读 completed 文件。统合者另已完整读取空 reviews/comments/reviewThreads，外部 review 由统合者一次性提交。本人没有提交、push、修改测试/实现、真实 GitHub 写入或合并。

**Issue 验收判定：** 核心赋值与持久恢复闭环有当前 head 本地证据；错误反馈条款仍受 F1 限制，不能声称 #567 每条产品验收均已完成。当前没有 P0/P1，工程评审可按仓库非阻塞意见规则进入后续门；F1 修复或明确承接及当前远端 checks/review 门由 owner/统合者完成。真实 GitHub token 能力、精确安装 artifact、人类 UAT 和 R1 均无本轮新接受证据。


### 2026-11-09 F1 本地修订，待独立复评及发布门

统合者已对 `8f0e2f8a` 一次性提交 APPROVE 与 F1/P2；以下只归属该 head 上的未提交本地修订。真实链路证实 Host `guarded` 将原 ProjectError 转成固定异常，`apps/harness-plugin/src/client.ts` 的通用 unwrap 再丢弃分类；旧直接 Picker 注入反例只证明 UI 症状，不能冒充原生 carrier 证明。正式新增浏览器测试从生产 apply、typed remote、Host、Core 到原生 adapter/真实 SQLite：不支持由可选 Provider 能力失败提供，403 与缺失终游标由合成平台 transport 提供，均不做真实外部写入。

修订保留 generic guard/unwrap，候选 handler 仅把三个允许代码作为带 workspace/workItem/repository 的 error-only DTO 返回；client 严格校验作用域与形状并拒绝混合身份/未知代码，Picker 显示固定恢复提示且清候选/选择。普通异常仍由宿主诊断收口并在界面呈现通用暂不可用。失败 DTO 不带 items、login、stamp 或原始异常消息。

正式 RED 命令 `pnpm test:file --test-name-pattern='candidate .*feedback crosses|candidate client preserves' tests/browser/workspace-execution.test.js tests/contract/ui-change-request-assignees.test.js`：4 tests/4 fail，均为预期行为 AssertionError。最小分类修订后 3/4 pass；真实403触发交付观察版本变化，旧创建区 key 随它重挂载，导致自动读取循环。独立 trace 约 3 秒记录 194 次候选请求。下移已接受的 `key: scopeKey`，创建区继续用已有 scope/creator/connected 与独立 creatorAccessToken 围栏，负责人子区访问 key 保留；未改 Core/runtime 权限协议。

再次执行同一窄命令 4/4 pass；随后 `pnpm test:file tests/browser/workspace-execution.test.js tests/contract/ui-change-request-assignees.test.js tests/contract/ui-create-change-request.test.js tests/contract/ui-delivery-lineage-section.test.js` 48/48 pass，fail/cancelled/skipped=0。三类浏览器场景均先选候选、等待原失败响应完成，验证错误类型、身份/选择清空、无原异常 canary；显式交付刷新/读回后错误仍在、候选请求数不增加，人工重试仍区分种类，恢复可读后选择保持为空；create=1/add=0。

当前相对固定 base 的代码858行（原799，修订净增59；HEAD→工作树代码75行），无机械压行或无关测试删除；超过本叶子原 <800，该初轮体量后来由人类“改为 1000 行硬上限”裁决取代；完整F1修订的当前体量另见下段。本文所记源码尚未 commit/push/外部回复/resolve。独立复评和精确新 head 托管门完成前，不把 F1 标为外部已解决；真实平台、安装、人类 UAT 与 R1 仍另计。


本地最终窄回归：`pnpm test:file tests/integration/change-request-assignees.test.js tests/contract/development-github-assignees.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js` 50/50 pass，fail/cancelled/skipped=0；`pnpm run typecheck` 和 `git diff --check` exit 0。与前述48组分开报告，不冒称全库结果；统合者负责当前组合全量。此后只补证据文档，源码交独立复评。


### F1 第二轮：跨调用者访问收据、迟到成功与显式恢复

独立复评补充了同一 F1 的有界 P2：另一 remote 调用者得到原生目录 `permission_denied` 后，已接受的 repository metadata 只改变交付 token，旧 Picker 和 selection 仍保留；未证明未授权外部写入或跨 principal 泄漏。两个正式真实 carrier 用例先 RED（2 tests/2 fail，均 `candidateCount=1` 而应为0）；一例先有已确认 assignment 以判别旧正面提示，另一例用 HTTP carrier 暂扣已通过 Host/Core 的成功 DTO（断言包含原候选），再于访问变化后释放。屏障是生产 console `watch metadata` 已接受事件及其后 `getDeliveryProjection` response finished；没有把 baseline-only observations 当 metadata ACK。

修订将选中仓库 `assigneeAccessToken` 从 Delivery 经创建区传入事后消费者/Picker。token-only 换代立即遮蔽旧候选与选择、停止自动读取；手工 retry 始于当前收据。scope/port/connected 初始读取仍自动，原发同 scope 的安全失败只作保守负面提示保留。旧 saved/confirmed 文字在收据失配时被中性提示遮蔽，opaque operationId 仅用于当前 Core 门后的持久恢复；迟到 operation lookup 必须同时匹配 owner、request 和精确收据。原生权限、Core写前认领、SQLite意图与最终权限门均未改。

独立复评再指出初始 operation lookup 跨访问变化被丢弃后没有恢复入口。新增具名契约先3pass/1fail（缺少 enabled readonly retry），随后只给 absent/blocked 记录提供“重新读取负责人记录”，不增加换代自动 query 或写入；受验用例要求原查询不重放、人工重读能恢复Picker且写次数0。原 React hook脚手架提取为两真实消费者共用 helper，既有scope/connection断言完整保留。

最终命令 `pnpm test:file tests/browser/workspace-execution.test.js tests/contract/ui-change-request-assignees.test.js tests/contract/ui-create-change-request.test.js tests/contract/ui-delivery-lineage-section.test.js`：51/51 pass（含10个browser），fail/cancelled/skipped=0。两例都要求访问改变后候选/旧选择与旧正面提示消失，迟到成功不能恢复身份，options计数只增加外部明确调用一次；不因opaque版本自动重读。初轮50项assignment/Provider/Host证据仍归其代码树，UI最终树typecheck/独立复评与统合者全量另行回读。

人类已逐字裁决：“改为 1000 行硬上限”，仅针对 #568，文档<1300保持。本地最终完整代码922行（HEAD→工作树代码183行增删），原<800及初轮<900待询预算均被该裁决取代。未删除安全测试、压行或发布源码；B创建前选择与创建时assignment的独立收据适配仅准备为运行态patch，须由B owner在重接A后实现并按B实际树验证。


最终本地类型检查 `pnpm run typecheck` exit0；独立复评者在当前稳定的8个源码/测试文件上另跑7/7（原生三类反馈、跨调用者/迟到成功、client严格失败、初始lookup显式恢复），结论 APPROVE、所报P2均已修复，无未决新项。受验文件哈希由统合者保留为运行态证据；复评后这里只追加文档，源码/测试不再改动。此为本地修订复评，不代替新 immutable head 的托管checks、外部回复/resolve或安装/人类/R1接受。

## 2026-11-09 托管CI反例与修复

43f74f43 / run42593656316实际Browser63/64，permission_denied用例在手动重读后等待旧拒绝提示超时；Fast Gate失败，未合并。独立artifact13661969001证明通用Host回复先到、accepted metadata后到。复现实际Core stale_revision及相同通用回复，不把它冒充新的native403。

修复仅Picker与判别测试：最后已知的允许负消息与本次未知分开，目标生命周期只随范围/端口/连接更换；repo token变化遮蔽候选/选择，历史无身份与正面事实，新成功/明确负结果覆盖历史。先有真实时序RED和两个ABA RED，再18/18局部与独立5/5、portABA、typecheck/diffcheck通过。新Picker SHA c8b58830a9acbde17ad2a6894278ddb9b68ee95a7a6a5786bd5919feda14872f；代码980/1000，旧922和旧托管红均为历史观察。新head真实CI仍须通过，未通过不得合并。

2026-11-09 SGT托管上下文回读：aa8279ba的自动CI没有出现；已有workflow_dispatch run42598185106在该精确head上Verify/Browser/Fast Gate均成功，REST也显示同SHA成功。但PR rollup缺少这些上下文，native stack原子合并返回Required status check expected，#568/#581均未合并。该手动运行只作为真实源码验证，不能当作PR合并门通过；补充本条实际记录后刷新文档head及上层栈，必须等待新pull_request CI和明确CLEAN再合并，不手写status、不使用admin绕过。
