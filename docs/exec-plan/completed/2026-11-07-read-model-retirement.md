# 退役无消费者展示投影 ExecPlan

> 状态：Completed（工程验收，PR 保持 draft）；创建：2026-11-07；关联：#574；规范：`PLANS.md`。

## Purpose / Big Picture

让列表、详情和开始工作只维护真实页面消费的展示契约，移除旧首页、谱系导航和每行动作输出。成功证据是生产代码净删、退役符号无运行时引用，现有安全视图与逐仓库四门用例继续通过。

## Context and Orientation

行为验证基线为 `50abd7d7`；两个提交后续变基到仅更新文档的 `c1975c20`，7份代码/测试补丁及485个非Markdown blob/mode与旧head `bde8fe96` 相同。`derive.ts` 的首页和 actions、`capability-access.ts` 的谱系导航仅由测试消费；真实页面使用 `deriveWorkItemListView`、`deriveWorkItemDetailView` 和 `deriveDeliveryLineageStrip`。开始工作的真实决策位于详情的逐仓库 `startWorkAvailability`，不能用工作区级旧 actions 代替。

## Design / Spec

删除已无运行时消费者的输出及其类型；保留最终安全列表/详情、`ExecutionTarget`、来源身份、降级、新鲜度和开始工作四门。能力 helper 保留实际调用方，去掉仅服务旧谱系入口的 read/write 模式分支。放弃继续保留旧壳和把所有读取归入通用框架：前者继续双轨维护，后者扩大安全策略的修改面。包为 private，旧导出退役是明确范围，不宣称全部导出 API 不变。

## Global Constraints
MMP 收尾追加本 PR 的 `docs/review/pr-579-mmp-review.md` 作为证据，保留原实现文件边界。

唯一文件集：`packages/ui-model/src/derive.ts`、`packages/ui-model/src/types.ts`、`packages/ui-model/src/capability-access.ts`；`tests/contract/ui-model-presentation.test.js`、`tests/e2e/workspace-read-assembly.test.js`、`tests/e2e/repository-routing.test.js`、`tests/integration/local-git-fixture.js`；本计划和 `docs/README.md`。代码含测试增删≤1000；不改 CI、Provider、Storage、Host wire、规划状态、架构总计划或 #568/#569/#571 文件。Node≥22、pnpm10.28.2，不新增依赖或镜像测试。

## Plan of Work

Batch 1：记录调用图、提交计划、建立关联 #574 的 draft PR；回读 base/head/draft/issue。Batch 2：从三个主模块删除旧 home/lineage/actions；旧模型专属断言退役，仍有产品价值的能力断言直接验证真实 helper。Batch 3：运行下节验证，检查规模与发布面，记录结果并 push；保持 draft 交由整合者决定后续 ready。每批可通过整批 revert 恢复。

## Validation and Acceptance

在检出 `chore/read-model-retirement-20261107` 的工作树根运行：

    pnpm test:file tests/contract/ui-model-presentation.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-start-work.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/workspace-read-assembly.test.js tests/e2e/repository-routing.test.js
    pnpm run typecheck
    pnpm run boundaries
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望测试 fail/cancelled/skipped=0、命令退出0；用 `rg -n 'deriveProjectsHome|lineageEntryPoints|LineageTarget|actionsFor' packages apps` 验证无命中（退出1）。核对最终 list/detail 的 scope-before-store、redacted、撕裂读、新鲜度和逐仓库四门证据；实际安装、外部平台和人类验收不在此证据内。

## Progress

- [x] (2026-11-07 15:11 SGT) 核对基线、完整调用图、私有导出及 #569 本地/远端边界，创建 #574。
- [x] (2026-11-07 SGT) Batch 1：计划扫描、13章/66行检查、提交和 draft #579 回读；base main、issue #574、无评审线程。
- [x] (2026-11-07 SGT) Batch 2：退役旧输出；七文件基线143项，移除4个旧投影专属用例后139项通过；typecheck和boundaries 9项通过，四门结果与基线260组差分一致。
- [x] (2026-11-07 SGT) Batch 3：独立审读确认无 P0–P3 可行动问题，工程验收完成并归档；收敛为初始计划加一个实现提交，最终发布按 Interfaces 的回读门执行，PR 保持 draft。

## Surprises & Discoveries

旧投影来自 #128；最终安全列表和逐仓库开始工作后续加入，原输出仍每行计算。#569 新模型只消费最终 list/detail。新工作树首次验证被 resolution-check 拒绝（解析到别的检出），执行 `pnpm install --frozen-lockfile` 后再取基线；退役后首次回归发现集成测试遗漏一条旧 actions 断言，删该条后139项全绿，原同步/断网/恢复断言仍保留。

## Decision Log
2026-11-07 / MMP 收尾授权：人类在本会话直接要求对 PR #571、#576–#579 完整评审；无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 并以 rebase 合并。本条覆盖本 PR 先前“不合并/保持 draft”的执行限制；不授权 Planning Status 或依赖关系写入。

2026-11-07 SGT / 实施者：执行人类授权的无消费者投影退役；Rationale：减少修改入口并保留真实安全门。保留 `startWorkAvailability` 的四门、只读读门和结果解释；不把代码精简扩成授权策略变更。GitHub 写入由已认证维护者执行，目标为同仓 issue/当前分支 draft PR，以 issue #574、分支名和 PR 编号作为可回读身份；不写看板 Status。
2026-11-07 SGT / 独立审读与整合者：完整审读调用者、旧 surface 删除和测试意图，确认无运行时旧消费者、无 P0–P3 可行动问题；授权只做归档、一个最终实现提交和一次 push，保留 draft。

## Idempotence and Recovery

只重复验证和回读；创建外部对象前先按 #574/分支查重。不删除工作树或用户文件；未发布编辑可按 diff 恢复本任务文件，发布后以整 PR revert 回滚，无持久数据迁移。

## Interfaces and Dependencies

保持 client→ui-model→ui 依赖方向、最终安全视图和 `ExecutionTarget`。工具为 Git、gh、Node/pnpm；凭据只用于已授权同仓 issue/PR。最终用 `gh pr view <PR> --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 及 reviewThreads 回读；PR 保持 draft，后续 ready 由整合者处理，不 merge。

## Outcomes & Retrospective

2026-11-07 SGT 本地观察：生产净删115行；`git diff --numstat` 可重算代码与测试规模。最终视图/ExecutionTarget未修改，退役符号在 packages/apps 无命中；独立审读通过，无 P0–P3 可行动问题，发布后的 head/checks 以 PR 回读为准，不代表实际安装或人类验收。技术债复核无新增旁路/临时框架，client pull 由独立任务负责。

## Bottom Change Note

2026-11-07 SGT：依据调用图和明确授权建立可回滚退役闭环，锁定文件范围与现有证据。
2026-11-07 SGT：记录已完成的本地删减、解析纠正和现有验证，最终推送等待独立审读。
2026-11-07 SGT：记录独立审读并归档；随后仅变基文档基线到 `c1975c20`，range-diff与非Markdown对照确认源码未变，未重跑139项；最终head/checks由PR回读提供。

2026-11-07：记录本会话对该 PR 的直接条件合并授权、风险矩阵与独立复评入口；当前 head/checks 以发布后回读为准。
