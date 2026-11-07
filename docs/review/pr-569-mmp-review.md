# PR #569 MMP 工程评审

## Purpose / Big Picture

确认 #281 的工程交付总览可独立验收、审阅和回滚；工程Ready不等于安装、人类UAT或R1。

## Context and Orientation

2026-11-07 SGT，在检出 `feature/delivery-overview` 的工作树根审查。最终布局源 `2eadb019`；重放至文档基底后的代码提交 `a4a8f835` 的源码、测试与配置树经独立复核逐字相同。此记录提供源码、合成生产组合和对抗证据，不替代真实平台、安装态、人类 UAT 或 R1。

历史证据边界：下文15:57 SGT的托管checks、Ready和旧测试数字对应历史代码head `a4a8f835`（归档文档head `2bd2b7ef`），不代表当前重放head。2026-11-07重放至base `329227dd` 后，受验head为 `aa38346e`；本PR功能patch保持不变，但主线client推流接受点、测试运行器和CI门禁已更新。新head本地验证见下节；当前托管、关联、线程和Ready须对最终发布head重新回读。

当前 head/base、PR checks、issue 与线程均为易失事实，复核时运行 `gh pr view 569 --repo SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,closingIssuesReferences,statusCheckRollup`、`gh pr checks 569 --repo SingularityKChen/harness-projects`，并分页读取所有 reviewThreads。期望当前 required `PR Fast Gate` 与相关执行 lane 成功、Closes #281 成立；历史绿检查不能代替当前 head。

## Design / Spec

先锁定immutable源树，再分别完成任务合规、质量、产品与最终全分支审查；新CI反例先复现再根因修复，旧结论原处标Superseded。

| 层 | 证据与结论 |
|---|---|
| 代码/P0 | 安全 list/detail gate 后仅读 typed native kind 过滤；只复制授权字段；旧 scope/reader/token/timer/队列不能恢复身份。无第二权威源。 |
| 产品/P1 | 当前工作区→明确仓库/每页20项→PR/流水线/检查摘要→同一详情→原行或标题回焦；无PR为缺口，未知/陈旧/候选不变当前通过。CI不裁决Planning/R1。 |
| 架构/P1 | 共享既有 loader、freshness 与 Host 投影；页级最多3个 refresh，显式 refresh 后 read，年龄和前台恢复仅读；不新增Provider/Storage/wire。 |
| 测试/P1 | 窄合同、共享创建回归、生产组合浏览器、类型与边界通过；三类四个变异在最终源树各自归因KILLED、baseline/逐字还原通过。 |
| 工作项/P2 | #281 独立闭环，不依赖负责人 PR；回滚单位为整PR。严格规模以 `node scripts/rule-checks.mjs size origin/main` 重新计算，代码<800、文档<1300。 |
| 视觉/P3 | 唯一F1为summary原始ISO可读性；仅summary复用ObservedTime，精确值保留dateTime，独立复审ADDRESSED，未改loader/detail/年龄规则。 |

独立任务审查与最终全分支审查均完成；最终审查未决 P0/P1/P2/P3 为0。整理后的 immutable head 经再次锁定，不能把旧head身份直接沿用。

## Global Constraints

源码评审只读；变异在独立源导出，workspace解析留在导出内。结论只覆盖给定源码、合成平台与具名故障；不改变Planning Status、阻塞关系或发布裁决。代码<800、文档<1300按当前base/head机械回读。

## Plan of Work

Batch 1锁定需求与源码，检查用户闭环、事实所有权和失败路径。Batch 2完成局部呈现修订和CI共享布局反例修复，独立复审后复跑完整browser及最终归因变异。Batch 3回读当前head/base/checks、双向issue和全线程，再Ready；文档head后按下节命令重新核对。任一反例保留阻断，不以历史绿检查替代。

## Validation and Acceptance

在上述分支工作树根运行：

    pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-delivery-overview.test.js tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-delivery-lineage-strip.test.js
    pnpm test:file tests/contract/ui-create-change-request.test.js tests/contract/ui-work-item-app.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js
    pnpm test:file tests/browser/delivery-overview.test.js tests/browser/workspace-execution.test.js
    pnpm test:browser
    pnpm run typecheck
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main

历史源验收（首次实施/F1及布局修复源，非当前重放head重跑）观察为41项总览/谱系合同、41项共享创建/组合合同、6项生产浏览器、9项边界和类型检查全绿。F1后38项合同、2项总览浏览器、2项既有时间格式浏览器和类型再绿；范围有重叠，不累加成另一总数。全部具名执行 fail/cancelled/skipped=0。中间旧fake-hook与固定children夹具失败经语义接线修正，原焦点/键盘断言保留。

2026-11-07 SGT，检出上述分支、受验head `aa38346e` / base `329227dd`，执行以下新基线窄组合：

    pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-delivery-overview.test.js tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/e2e/client-sync.test.js tests/e2e/client-stream.test.js tests/e2e/workspace-stream.test.js tests/contract/run-test-layer.test.js tests/contract/ci-browser-workflow.test.js

结果85/85，完整 `pnpm test:browser` 60/60，typecheck通过；workflow-check检查7文件无发现，size/disclosure/diff-check通过。85项包含合同、client/stream E2E和runner覆盖，与历史数字不累加。新基线已退役独立Merge Gate，以当前CI Verify/Browser、PR Fast Gate及相关checks为准；旧变异保留其最终布局源身份，本轮未重复同源变异。

独立最终源导出使用 `node scripts/review-mutate.mjs <spec.json>`，每个spec包含精确killedBy。

| 变异 | 唯一归因用例 | 结果 |
|---|---|---|
| summary无PR缺口误报passed | `missing PR and empty checks render gaps not passed` | KILLED |
| 共享年龄改用attemptedAt | `summary ages at exact threshold from confirmedAt and ignores attemptedAt` | KILLED |
| 新overview队列key去访问令牌 | `unreadable targets dispatch nothing and access generations replace row readers immediately` | KILLED |
| 共享section key去访问令牌 | `revocation and late old repository results never restore canary identities` | KILLED |

各项都有非空diff、baseline退出0、指定失败名、逐字还原与还原后baseline退出0；未把语法错误、未施加变异或KILLED_OTHER充当结果。具体JSON/diff/log保留在本PR工作树 `.superpowers/sdd/2026-11-07-delivery-overview/`，本表给出可重建的变更和测试入口。

真实浏览器使用生产Host/client/SQLite与合成Provider。candidate CI负控保留候选关系、显示unknown；fresh正控通过真实Core显式确认合成关系，未假造生产关系。页面动作前后规划快照相同、planning mutation=0。320CSSpx和双倍根字号像素及Tab/Enter/Escape/唯一dialog回焦已观察；这不是所有OS缩放组合、真实20行压力或安装人类接受。

## Progress

- [x] (2026-11-07 15:57 SGT) 任务与最终分支矩阵审读完成，F1与两项共享布局反例已修复并独立复评。
- [x] (2026-11-07 15:57 SGT) 最终代码源变异4/4归因KILLED；历史代码head `a4a8f835` 的托管checks及双向issue/全线程门通过，PR569在该时点Ready回读成立；重放后的head另行回读。

## Surprises & Discoveries

新增独立mode块占据context之外高度：宽屏toolbar gap70.25、320x320/双倍字号table bottom338.5，违反旧矩阵。单变量移除对照后，修复为原page/context/toolbar始终挂载，mode进入actions，只换body/标题/region；gap26.25、bottom289.5恢复原几何，旧断言未放宽。原源局部验收没有包含这两条全browser矩阵；完整60项随后通过。

## Decision Log

2026-11-07 15:57 SGT / 独立评审与整合者：复用共享loader/年龄规则、精确typed安全scope、原page shell和本地化时间；不为美化另造状态机。候选关系与CI状态独立，页面操作规划快照不变。Ready仅是当前工程交付，后续head重新回读。

## Idempotence and Recovery

首版范围是单仓库、分页20项、3并发，Draft/PR-backed/redacted不产生执行scope。使用者仍需沿单独流程确认来源关系、真实平台结果与发布条件。整PR回退恢复旧列表/详情；持久交付事实和规划权威不需迁移。新依赖、持久化捷径或有意延后安全修复均未引入。

## Interfaces and Dependencies

审查依赖现有DeliveryLineageReader、sharedsection、ui-model年龄函数与生产Host/client/SQLite合成fixture。`gh`只回读明确repo；临时变异使用review-mutate的baseline/restore及killedBy门，未使用真实平台mutation或模型。

## Outcomes & Retrospective

工程源码独立审查零未决P0/P1/P2/P3；2026-11-07 15:57 SGT的历史代码head `a4a8f835` 托管验证和Ready回读完成；新base重放与后续文档head均需重新核对，文档归档后继续最终head复核。初次局部通过与后续CI反例均保留，未声称真实20行压力、全部OS缩放、实际安装或人类发布接受。

## Bottom Change Note

2026-11-07 15:57 SGT：归档PR自身工程矩阵、CI布局根因/修复、最终变异与Ready观察；所有易失远端状态保留明确重算命令。

2026-11-07 SGT：按独立重放复核澄清旧Ready/check身份，记录329227dd新基线85项组合与完整browser60结果、Merge Gate退役；未复用旧远端结论。

2026-11-07 SGT：主线7bab4b8c退役未用UI投影后，独立核对总览未消费被删字段；在检出feature/delivery-overview、受验head e7417ca3重跑typecheck及 `pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-work-item-detail.test.js` 12/12通过，功能patch与已受验源保持一致。此条仅补新base本地验证，最终远端状态另行读回。
