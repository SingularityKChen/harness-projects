# Delivery 运行时读健康与共享返回栅栏 ExecPlan

> 状态：Completed（完整闭环与当前源码验收、归档完成；最终文档 head 远端门按 Batch 4 回读）。
> 创建：2026-10-30（Asia/Singapore）。
> 范围：原 PR #469 自身闭合 Delivery 拒读、离线、scope 恢复及跨 owner 最终返回。
> 关联：Closes #468；Refs #457、#465。规范为根 `PLANS.md`。

## Purpose / Big Picture

Development/Delivery 读取被拒绝时，仅相应 binding、repository、capability key 和 work-item scope 的内容停止外发；其它许可集合和 command lineage 保留。临时离线保留已确认事实并标 stale。恢复权限后，只有同 scope 完整读取事实取得 Storage ack 才恢复，不复活其它历史 scope 的旧 CI。

两个正常 Host 共享同一 SQLite 时，A 读取在最终 scope guard 等待，B 已提交拒读，A 也必须返回当前受限投影。不能以“下一次查询已经正确”接受本次泄漏。这个保证由原 #469 自身交付，#481 只是保存中的中间候选。

## Context and Orientation

`chain-facts.ts` 读取各能力，`delivery-facts.ts` 原子提交事实与谱系，`delivery.ts` 纯读投影，`host-composition.ts` 做最终可见性确认，client/UI 读取并展示这些权威事实。Planning #466 是父层；本任务不改其许可语义。

原实现只保留本 owner epoch。独立 Memory/SQLite Core 与真实双 Host 探针均复现：A 最后读取被暂停，B 提交 pipeline denial，A 仍外发两个旧 pipeline；下一次才为零。只补 UI 遮罩或重复读取 cursor 会继续打开等待窗口。

当前分支 `fix/delivery-runtime-access` 应基于最终已验收的 `fix/planning-runtime-access`；用 `git rev-parse HEAD fix/planning-runtime-access` 和 `git merge-base HEAD fix/planning-runtime-access` 重算真实基线。#472 由独立 owner 维护，不在此改写。

## Design / Spec

### 持久读健康与 scope 恢复

复用唯一 Storage 的 SyncCursor，以 workspace、binding、key、repository 定位读健康；版本、denied、未完成读数和已恢复 scope 分列。读前 marker 与 ownership ack 后才调用 Provider；begin rollback 不能留下 phantom ownership。旧 epoch 的成功/失败不覆盖新观察。

可信 denial 立即推进内存访问版本并清已恢复 scope，内容 publication 与持久健康同事务。redaction/health 失败仍 query-masked，未结清 marker 防止新 owner 误信缓存。成功事实、scope 许可和 reconcile 同事务，ack 后同步当前 authority；半写或 recovery commit rollback 不解锁。普通失败只结束读，保留许可 stale cache。

Development repository/change-request 与 Delivery pipeline/check 按原 capability 规则遮罩。scope 恢复只释放当前工作项，历史 scope 必须自行完整刷新；另一 binding/key/repository 不能解锁受限事实。错误只发布安全固定原因和实际 denying layer，Provider 原文不外发。查询不调用 Provider、不补写 permission，也不改 Planning Status。

### 共享已提交读 fence

Storage 实现历史（Superseded by 本节「前置 Storage 基础交付」）：`Storage.committedReadFence(): string` 是同步的 root 只读 token。Memory 成功提交后增加代次；SQLite 组合本连接成功提交代次和同连接前后比较的 PRAGMA data_version。后者观察其它连接已提交变更，不能比较不同连接裸值，也不会因本连接提交而改变；所以两部分缺一不可。

官方依据为 SQLite 的 PRAGMA 文档 `pragma.html#pragma_data_version`，调研日为 2026-10-30；此处只使用其本地连接变化信号，不把 token 当权限 authority。实际 binding/key/repository/scope 健康仍是许可事实源。

直接 atomic SQL 成功同样推进本地代次；只读事务、rollback 不推进。close 后沿既有 CLOSED_MESSAGE 快速失败。StorageTransaction 类型不暴露 root fence；同 owner 活跃事务 callback 内拒绝 root 调用，finally 清 active，使 commit/rollback 后延迟 callback 可以读取。Core 对非同步 string 明确抛错，不能 fail open。

Core 投影、metadata 与 Host 最终返回同时比较 owner epoch 和共享 committed fence；本地异步 guard 前后变化则重读纯本地投影。fence 校验 helper 放 runtime-access，避免 queries 与 delivery 循环依赖。同步比较之后不再 await，再返回已校验结果。

### 客户端与方案取舍

metadata 的 repository accessVersion 区分 available→denied→available 的 ABA，传到真实详情 token 使旧 Delivery 缓存失效。保留许可 check/command lineage，隐藏受限 pipeline 的 labels、locator 和成功事实。

两份独立系统设计与后续独立复核比较过：共享 Storage token、在返回前重读全部 health、UI-only 补偿。选择 token 是因为它能覆盖另一 owner 提交，且不重复拥有权限。新 DB/owner ledger、轮询 Provider、通用授权框架均无必要。

### 前置 Storage 基础交付

#510 负责已有 Storage 合同、两adapter及原11项纯Storage验收，R2又增加5项正式测试与11具名负控。该前置已于2026-11-02 SGT以head `451457b` Ready并独立APPROVED；这不是合并或Planning接受。#469保留 `tests/integration/delivery-read-fence.test.js` 的Core共享generation消费者和全部Delivery/Host返回fence。source `570c3aa`、base `79daa4b`（2026-11-02 SGT）的独立本层来源审查 findings=[]，代码833、文档389；提取前979只属历史。新父层P2整合后的当前head/CI须按Batch4重锁，不复用旧批准。

## Global Constraints

本 PR 文件集如下，文件边界以相对父层的 `git diff --name-only` 重算：

- `apps/harness-plugin/src/host-composition.ts`。
- `packages/capabilities/src/registry.ts`。
- `packages/capabilities/src/storage.ts`。
- `packages/client/src/delivery-lineage-reader.ts`。
- `packages/client/src/workspace-read.ts`。
- `packages/controller/src/queries.ts`。
- `packages/controller/src/wire.ts`。
- `packages/core/src/chain-facts.ts`。
- `packages/core/src/context.ts`。
- `packages/core/src/delivery-facts.ts`。
- `packages/core/src/delivery.ts`。
- `packages/core/src/queries.ts`。
- `packages/core/src/registry.ts`。
- `packages/core/src/runtime-access.ts`。
- `packages/providers/fake/src/storage.ts`。
- `packages/storage/sqlite/src/storage-sync.ts`。
- `packages/storage/sqlite/src/storage.ts`。
- `packages/ui-model/src/work-item-detail-view.ts`。
- `packages/ui/src/delivery-lineage-section.ts`。
- `packages/ui/src/work-item-detail.ts`。
- `tests/e2e/controller-roundtrip.test.js`。
- `tests/e2e/delivery-lineage.test.js`。
- `tests/e2e/status-policy.test.js`。
- `tests/integration/delivery-read-fence.test.js`。
- `tests/integration/delivery-repository-routing.test.js`。
- `tests/integration/harness-plugin-delivery-lineage.test.js`。
- `tests/integration/harness-plugin-host-github-catalog.test.js`。
- `tests/integration/harness-plugin-runtime-access.test.js`。
- `tests/integration/planning-snapshot.test.js`。
- `tests/integration/provider-binding-registration.test.js`。
- `tests/integration/pull-request-identity-convergence.test.js`。
- `tests/integration/runtime-delivery-access.test.js`。

其余文档仅本计划与 `docs/README.md`。原 #481 的计划合并进同一份控制计划；中间 source、正式测试和评审证据由 backup ref 保留，完整吸收并远端确认前不能关闭中间 PR。

人类具体批准完整 fence 收回 #469、保留所有测试、代码/test/config/fixture A+D 不超过仓库 1000 硬限；文档小于 1300。不压行、不删独立故障断言、不把仍有可达 P1 的基础层先放行。

不做迁移、旧发布兼容或删用户库；不改规划 Status/原生依赖，不自动合并。pnpm 使用 10.28.2；遵守 capabilities→core→controller→client→ui-model→ui 依赖和 publication 检查。

## Plan of Work

以下命令在检出 `fix/delivery-runtime-access` 的工作树根执行。

### Batch 1 · 读健康与故障矩阵

主文件为 runtime-access、chain-facts、delivery-facts、runtime-delivery-access。以真实 Provider deferred 产生 denial、offline、迟到结果和事务故障；先证明旧实现可见受限事实，再实现持久健康与 scope 恢复。只读查询不得改事实。

    pnpm test:file tests/integration/runtime-delivery-access.test.js tests/integration/delivery-repository-routing.test.js tests/integration/provider-binding-registration.test.js

期望 Memory/SQLite 一致，历史/其它目标隔离、普通 offline 与 ack 边界全部通过。回滚须整体退回本批协议，不部分移除 mask。

### Batch 2 · Storage fence 与真实返回（历史提取前范围）

本批 Storage 合同和11项纯 Storage 测试现已完整前置到 #510；本层只保留 Core 消费者、共享返回与 Host 最终 guard。以下为提取前历史，Superseded by「前置 Storage 基础交付」。主文件为 Storage 契约、Memory/SQLite、Core 查询与 Host 最终 guard。先复现 Core 两种 Storage 和真实双 Host 的 RED；再证明同步 token、direct atomic、read-only/rollback、close、活跃/结清 transaction scope。

    pnpm test:file tests/integration/delivery-read-fence.test.js tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js
    pnpm typecheck
    pnpm run boundaries

期望 12 项 fence 与三项跨 owner 用例保留；A 等待期间 B 已提交拒读后，A pipeline=0、许可 check 保留、无 ci_passed。回滚点为完整 Storage/Core/Host fence。

### Batch 3 · UI 缓存与预算重构

主文件为 client reader、metadata token、detail UI 及真实 Host runtime 测试。保留 opened detail、ABA、scope recovery 和不相关 Planning 内容；不能以本地 token 代替共享权限事实。

原独立跨 owner 测试中的 Core/Host 启动夹具与既有模块重复。将两条 Core 用例并入 runtime-delivery-access 复用 fixture，将真实 Host 用例并入 harness-plugin-runtime-access 复用 open/prepare。保留三案全部断言、超时、清理与真实双 Host；Host 使用 60 秒 watchInterval，避免后台 watcher 干扰事务屏障。删除重复夹具，不删除验收。

    pnpm test:file tests/integration/runtime-delivery-access.test.js tests/integration/harness-plugin-runtime-access.test.js tests/integration/delivery-read-fence.test.js
    git diff --numstat fix/planning-runtime-access...HEAD

期望同一三案和已有所有回归通过，规模在具体人类预算内。回滚点是本批测试组织与缓存接线；重复夹具的历史候选保留在 backup ref。

### Batch 4 · 独立验收与原 PR 收口

2026-11-02 起当前交付 owner 按人类“继续并完成 ready 交付”串行执行整栈发布、issue closing、review reply/resolve、归档、关闭中间 PR 与 Ready。此指令取代此前仅本地 freeze 交回的分工；本轮不执行合并。

主文件为本计划和索引。独立复核最终统一 source/base，重放原跨 owner 反例和 fence F1–F4；整理为可独立审阅的中文 Conventional Commits。原 #469 恢复 Closes #468；#481 在完整内容已由原 PR 保存并验收后关闭。

    pnpm verify
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure fix/planning-runtime-access
    node scripts/rule-checks.mjs size fix/planning-runtime-access
    git diff --check fix/planning-runtime-access...HEAD
    gh pr view 469 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup,reviewDecision
    gh workflow run ci.yml --repo SingularityKChen/harness-projects --ref fix/delivery-runtime-access
    gh pr checks 469 --repo SingularityKChen/harness-projects

stack base 不为 main 时 CI 不会自动跑 Verify；dispatch 后必须核对 run headSha 等于最终 PR head，Verify/PR Fast Gate 真正成功。无 required checks 不是通过。最终 push 用 backup ref 和精确 lease，回读双向 issue 关联与全部分页 review threads 后才 Ready。人类决定合并。

## Concrete Steps

依次执行各 Batch 中的命令；进入最终交付前重新确认工作分支和 base，使用 `git diff --numstat` 累计 additions 与 deletions。命令失败时保留该批 Active，先修复判别失败，再进入下一道门。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 许可范围 | key/binding/repository/work-item 独立；拒读遮罩、其它集合和 command lineage 保留 |
| 持久性 | redaction/health 双故障、close/reopen、新 owner、旧 historical scope 不复活 |
| ack 与时序 | begin rollback 无 phantom owner；failed recovery commit 不发布许可；旧成功/拒读不覆盖新观察 |
| shared return | Memory Core、SQLite Core、同文件双 Host 原窗口返回 pipeline=0；check 许可保留，无成功事实 |
| Storage 语义 | commit/direct atomic 改 token；只读/rollback 不改；close/active transaction 拒绝；settled callback 可读 |
| 客户端 | 已开详情 token、ABA、coalesced metadata、离线与真实 client.apply 继续通过 |
| 交付 | 当前 head 独立复评、真实 hosted CI、1000 硬限与 publication；不代替 UAT/R1 |

## Progress

- [x] 2026-10-30 SGT：独立方案调查、读健康/scope 实现与真实 Host/client 回归。
- [x] 2026-10-30 SGT：跨 owner P1 和 fence F1–F4 先 RED 后 GREEN，形成完整中间候选。
- [x] 2026-10-30 SGT：按人类裁决本地吸收完整 #481 回原 #469，保留所有 15 项新增验收。
- [x] 2026-10-30 SGT：复用既有 Core/Host 夹具，移除重复启动代码；三案和窄测 51/51 通过。
- [x] 2026-10-30 SGT：最终 Planning 父层上完整 verify 2802/2802 加 MVP-0 7/7，统一 source 独立 279/279、原 Core/Host 探针和三案有效负控均通过。
- [x] 2026-10-30 SGT：本地能力/文档提交整理与 freeze 交回；当前源码与独立已验 source 逐字校验。
- [x] 2026-11-02 SGT：接合当前 Planning/main，独立 51/51、完整复跑 2842/2842 加 MVP-0 7/7 及 typecheck 通过；文档归档并备齐最终提交，按 Batch 4 规则回读远端实际 Ready。

## Surprises & Discoveries

只靠本 owner epoch 无法感知另一 Host 提交，已由两种 Core Storage 和真实 Host 证明。SQLite data_version 又不因同连接 commit 改变，因此必须叠加本地成功提交代次。早期实现还漏过 direct atomic、active root guard、close 和 settled AsyncLocal callback 四类边界，均由独立反例促成正式回归。

完整组合最初机械为 1034 code A+D，超过人类批准的 1000。独立检查发现两套新 fixture 重复既有 fixture/open/prepare；复用后为 979，保留三条跨 owner case、12 条 fence case 和全部断言。该数是当次观察，最终按父层/head重算。

历史“738 行基础层先合、#481 关闭 #468”的结论被可达 P1 及人类裁决推翻。Superseded by Decision Log「原 PR 完整吸收」（2026-10-30）：#469 自身必须消除 P1，原 #481 只作候选保存。

## Decision Log

- 2026-11-02 SGT · 全部开放PR接管：本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。本授权明确覆盖当前PR #469，由本评审会话接管修复/独立复评、实际base重放、当前head门禁、issue核对及rebase merge。旧阶段“不merge/仅Ready”的限制仅在合并授权上 Superseded by 本决策；技术、范围、预算、凭据与人类UAT/R1门保持。Planning Status及native依赖关系仍不写入。

- Decision：采用既有 SyncCursor 健康/scope 加共享已提交 token，不创建第二权限 authority。
  Rationale：保持权限事实拥有者，覆盖跨 owner 返回窗口且维持纯查询。
  Date/Author：2026-10-30 SGT / 两份独立设计与最终方案复核。
- Decision：原 PR 完整吸收 #481，原 #469 自身关闭 #468；取消基础层留 P1 的分层交付。
  Rationale：人类明确批准完整 shared-Host fence 修复收回 #469、保留所有测试、最终代码不超过仓库 1000；公开裁决记录为 PR #469 的评论 6518485633。该批准不是产品接受或跳过门禁。
  Date/Author：2026-10-30 SGT / 人类直接裁决，经协调会话转达。
- Decision：复用既有测试夹具，不修改可选 no-storage RuntimeAccess 测试模式。
  Rationale：前者移除真实重复并保留验收；后者仍被 registration 夹具使用，不能未经验证称作 dead code。
  Date/Author：2026-10-30 SGT / 独立简化调查与实现者。

## Idempotence and Recovery

读取 fence 无写入，可重复；失败事务不推进代次、不发布 scope。回退按依赖逆序整 PR revert，不删除已确认事实或外部资源，说明撤权漏洞会重新出现。恢复锚点为 `backup/delivery-before-full-fence-absorb-20261030`（原 #469）、`backup/fence-complete-before-absorb-20261030`（完整 #481）、`backup/delivery-absorbed-before-parent-update-20261030`（吸收后的完整树）和 `backup/delivery-absorbed-reviewed-source-20261030`（已独立验收 source）；source 与原远端 head 都有 backup ref；原未跟踪评审文档保留并纳入最终文档提交，不清理其它 worktree。

未完成完整吸收验收前保留 #481 远端候选。协调者串行最后 push，精确 lease 被拒即停止并重新取证；#472 不在本任务历史改写范围。

## Interfaces and Dependencies

依赖最终 #466、capabilities Storage 契约、Memory/SQLite、Core/Host 和生产 client.apply。测试为本地 fake Provider 与临时 SQLite，不表示真实账号权限或人类 UAT。规划 Status 和原生 blocked-by/blocking 没有修改。

未接受新的延期技术债；如发现必要安全行为未闭合，应保持本计划 Active，不能记入 `docs/exec-plan/tech-debt-tracker.md` 后当作验收通过。

## Artifacts and Notes

正式判别证据是本计划列出的集成测试和具体命令；原始日志、外部探针及临时 checksum 保存在任务运行态目录。产品接受、hosted CI、人类 UAT 和 R1 分别记录，不相互替代。

## Outcomes & Retrospective

2026-11-02 SGT 当前来源复核：source `570c3aa` 对父 `79daa4b` 仅本层833代码/389文档，独立findings为空；全部Storage原子/同步合同在#510，Core消费者仍在本PR。相对R5规范化Delivery生产/Host正式测试增量逐字一致、Host断言无删除。后续当前组合head是PlanningP2的必要restack，验证及远端门须重新回读。下列979与Storage实现均为提取前固定版本历史，Superseded by本段与「前置Storage基础交付」。

2026-11-02 当前 source `c5a72d594faaeddcfe2375276c792c93ae77b633`，base `1744c22a3e02cc476fbe58515decb24bc73dfcf6`。Delivery 生产代码与原已验 db6b01d 增量逐字一致；唯一 Host 测试冲突保留 Planning 的真实配置/Panel 与 Delivery 的 provider/watchInterval 两侧。独立窄验收 51/51、0 fail/cancel/skip；完整复跑 `pnpm verify` 2842/2842 加 MVP-0 7/7 与 typecheck 通过。代码仍 979，文档小于1300。以下数字按原日期仅为历史证据。

历史统一验证 2780/2780 加 MVP-0 7/7 仅适用于当时 source。最终统一 source `4b2d717d3545dceaa4d0076198ad330676b8393e`、base `07f150fff9e125eee856c0db4d20c00425938957` 上完整 `pnpm verify` 为 2802/2802 加 MVP-0 7/7，typecheck 同步通过，命令上下文见 Batch 4。独立聚焦回归 279/279、原 Memory/SQLite Core 与真实 Host 外部探针通过；原 F469 P1 和 fence F1–F4 均闭合。

仅在独立 archive 里把 fence 改常量，迁移的三条正式用例均在内容断言有效 RED（受限 pipeline=2，期望0），未出现导入/夹具失败；正常 source 三案 GREEN。这证明 1034→979 来自夹具复用，验收判别没有被削弱。

最终能力提交 `c832d695e5f45b1340a6f229c6728cce810dfbb9` 与已验 source 的 packages/apps/tests/scripts 逐字一致。观察时间 2026-10-30 18:41:21 +0800；文档提交不改变这些产品证据。源码与原候选的恢复锚点见 Idempotence and Recovery；机械规模为 code A+D 979，文档在 1300 以内，最终 head 由协调者重新回读。

本计划在实现及当前源码独立验收后归档；最终文档 head 的 CI、双向 closing、全部 review threads 与 Ready 按 Batch 4 回读，不把本地通过当作真实权限 UAT 或 R1。


### 2026-11-02 · 接管与逐层合入门

本轮实际直接base为 `1ec42fccd12c7afbab4887a1bf89881e1d6efd90`；在本分支根执行 `node scripts/rule-checks.mjs disclosure 1ec42fccd12c7afbab4887a1bf89881e1d6efd90`、`node scripts/rule-checks.mjs size 1ec42fccd12c7afbab4887a1bf89881e1d6efd90` 和 `git diff --check 1ec42fccd12c7afbab4887a1bf89881e1d6efd90...HEAD`。早期批次的固定source/base用于重放其历史证据，不作本轮当前判定。

本PR原正式批准与全矩阵证据由 `docs/review/pr-469-mmp-review.md` 承接；本轮用户明确要求接管全部开放PR。每次父层合入后，以真实main/直接父层重新确定replay cut，保留完整已批准产品/测试语义、归档与导航。先建 `refs/backup/pr469-before-approved-integration-20261102`，再检查range-diff、规模、五类发布面与适用验证；仅使用精确旧远端head的lease发布。

在当前分支检出根回读 `gh pr view 469 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviews,closingIssuesReferences`、`gh pr checks 469 -R SingularityKChen/harness-projects` 与全部review threads。新head的独立复评及真实必需checks成立后才执行已授权 `merge_method=rebase`；native stack成员使用仓库已验证的merge-async入口，逐项回读实际MERGED、合入tree和对应issue。旧head批准、dispatch、局部测试或“无冲突”不替代当前head验收。

## Bottom Change Note

Change Note (2026-10-30 SGT)：合并原两份计划为一个独立能力闭环，按人类裁决将完整 fence 收回 #469；记录 shared-return、Storage F1–F4、真实三案迁移和 1034→979 的重复夹具重构，记录当前父层上全量 2802+7、独立 279 与真实三案有效负控通过；远端门待协调者收口，不提前关闭中间 PR。

Change Note (2026-10-30 SGT)：按独立计划语义复核补精确 source/time、backup refs 与实现 owner freeze/协调者串行外部写责任；当前全量与独立已通过，保留远端门。

Change Note (2026-11-02 SGT)：按人类“继续并完成 ready 交付”接管最终交付；重放到新 Planning/main，保留完整共享 fence 与所有断言。当前 source c5a72d59 的独立51与全量复跑2842+7通过。首次全量仅真实 Gateway 并发 intent 用例出现一项 status failed；同文件定向5/5、额外仅加诊断的10次原case及完整复跑均通过，未修改该正式用例或产品路径，也未把未证实的Git锁定当根因。原失败日志保留，不写成首次全绿。实现/文档归档，最终head的CI/closing/全部线程与Ready另按Batch4核对。

Change Note (2026-11-02 SGT)：按独立来源复核明确Storage完整前置到#510、本层保留Core消费者/Delivery/Host全fence；833本层范围替代历史979，不删原判别断言，不改变唯一Closes468或#481关闭状态。

Change Note (2026-11-02 SGT)：当前PlanningP2父层组合真正worktree完整3310+7/typecheck通过；独立本层833来源接受保持，最终新head/CI/正式评审另锁。

2026-11-02 SGT：按本会话人类对全部开放PR的直接授权接管收尾；新增实际base重放、恢复引用、精确lease、独立复评与逐PR合并回读门，保留原产品/预算/人验边界。
