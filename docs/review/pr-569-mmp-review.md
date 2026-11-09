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

工程源码独立审查零未决P0/P1/P2/P3（历史审查结论；Superseded by 2026-11-09 当前 immutable head 独立复评的F1/P2及本地修复）；2026-11-07 15:57 SGT的历史代码head `a4a8f835` 托管验证和Ready回读完成；新base重放与后续文档head均需重新核对，文档归档后继续最终head复核。初次局部通过与后续CI反例均保留，未声称真实20行压力、全部OS缩放、实际安装或人类发布接受。

## Bottom Change Note

2026-11-07 15:57 SGT：归档PR自身工程矩阵、CI布局根因/修复、最终变异与Ready观察；所有易失远端状态保留明确重算命令。

2026-11-07 SGT：按独立重放复核澄清旧Ready/check身份，记录329227dd新基线85项组合与完整browser60结果、Merge Gate退役；未复用旧远端结论。

2026-11-07 SGT：主线7bab4b8c退役未用UI投影后，独立核对总览未消费被删字段；在检出feature/delivery-overview、受验head e7417ca3重跑typecheck及 `pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-work-item-detail.test.js` 12/12通过，功能patch与已受验源保持一致。此条仅补新base本地验证，最终远端状态另行读回。


## 2026-11-09 当前 immutable head 独立复评

本节审查 `c6dcf8c1ee2827c813fd04e313db563d3034efa3`，base `7bab4b8c79eb497e16d4bb490f2a33d83863be35`；历史结论保留原身份。目标是判断 #281 当前仓库总览→PR/流水线/检查摘要→同一工作项详情的独立工程闭环。方法为 Superpowers、Qian Systems Router 的系统边界/分析综合与 First Principles Development 的审计路径。本节初始只读审查阶段仅追加证据、不修改实现；后续修复及独立复评另在末节记录。

### 审查前风险矩阵

| 严重度 | 代码与产品假设 | 架构/测试/工作项验证门 |
|---|---|---|
| P0 | 凭据或不可读身份泄露、破坏 main 或持久事实 | 安全 scope/late result/共享读取边界；无外部写入 |
| P1 | 错仓库或漏页冒充完整事实；未知/过期误作当前通过；主要详情导航中断 | 仓库/游标/年龄/所有状态/孤立谱系；#281 acceptance；源与调用链对照 |
| P2 | 可恢复刷新/焦点/共享布局回归，摘要缺可判别降级 | 共享 assignee/详情 shell 与键盘/响应式合同；窄生产组合测试 |
| P3 | 文档证据身份不清、重复问题追踪或非必要抽象 | 当前 head 的计划/规模/issue/测试判别力、最小机制适配 |

矩阵先于逐文件源审查建立；以下结论由当前源码和真实命令更新，不沿用历史无问题结论。

### 当前发现与综合判断

- **F1 / P2 / 可恢复性能回归**：`packages/ui-model/src/delivery-overview.ts:13` 在每个安全行内调用 `deriveWorkItemDetailView`；后者重算完整 `deriveWorkItemListView`，且详情降级又调用一次完整 `store.list()`。`packages/ui/src/work-item-app.ts:70` 无条件提前调用这个新派生，因此即使仍处于默认“工作项”模式、只打开/关闭一个详情或接收新帧，也要同步完成至少二次方的整表工作。总览20项分页只在该工作完成后执行，不能限制此成本。实际生产模型配合既有 wire 合成夹具测得20项→41次list、约1ms；1000项→2001次list、约145–152ms；3000项→6001次list、约1192–1264ms。同样1000/3000项单次既有列表派生约0–1ms。这会让较大项目的普通列表与详情导航发生可见主线程停顿。修复方向是按同一快照只生成一次安全列表/所需详情元数据（保留逐行redaction与typed目标门），并避免未使用总览时提前全量派生；不应靠减少权限检查或隐藏条目消除成本。最小新diff锚点为上述第13行。

该输入确为完整工作区而非上游分页：Core `bootstrap.ts` 的 `readAllItems` 追随nextCursor读完整项目；`queries.ts` 返回完整planningSnapshot.views；Client `store.ts` 保存baseline全部entities，`list()`复制并排序全表；WorkItemApp在任何本地表格查询/总览20项切片之前传入此store。旧详情路径原已有有限次全表派生，本PR新增的是每行一次并在所有模式下提前执行的乘数。

重复追踪回读：all-state issue搜索 `quadratic in:title,body`、`performance in:title`、`overview in:title` 以及 `performance delivery overview in:title,body` 均无命中；在这些明确查询范围内未找到重复问题，不声称穷尽全部issue文本。#281仍OPEN，#357/#234/#221/#222为CLOSED的既有能力；本次不创建issue或改规划字段。

| 层 | 当前结论 |
|---|---|
| P0 / 安全与持久事实 | 未发现新增问题。diff无Provider、Storage、Host wire或秘密持久化；撤权与晚到围栏的合同及生产浏览器通过。 |
| P1 / 闭环与权威 | 未发现新增阻塞。明确仓库、20项/3并发、刷新后重读、缺口、失败/未知/陈旧及候选关系保守呈现、同一详情与回焦成立；CI不更改Planning。 |
| P2 / 恢复与共享布局 | F1待处理。当前实际浏览器保留表格XY/短视口/双倍根字号、状态头与详情展开几何断言，均通过。 |
| P3 / 文档与范围 | 未发现新增可行动项。功能保持共享section与纯派生，无新的缓存权威或不必要Core聚合；历史证据身份保留，安装/UAT/R1另计。 |

### 当前命令与证据边界

在检出 `feature/delivery-overview` 的工作树根、上述immutable源码head执行：

    pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-delivery-overview.test.js tests/contract/ui-delivery-lineage-section.test.js tests/contract/ui-delivery-lineage-strip.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-app.test.js

58/58通过，fail/cancelled/skipped/todo=0。

    pnpm test:file tests/browser/delivery-overview.test.js tests/browser/detail-expand.test.js
    pnpm test:file tests/browser/workspace-read.test.js tests/browser/workspace-header.test.js tests/browser/table-geometry.test.js tests/browser/table-rq-integration.test.js

分别7/7和20/20通过，fail/cancelled/skipped/todo=0。总览浏览器覆盖真实Host/client/SQLite与合成Provider、一页fresh/failed/unknown/gap、refresh→read、planning不变、撤权晚到、键盘打开唯一dialog及回焦；后一组覆盖共享列表/头/本地滚动几何与生产读取恢复。

    pnpm run typecheck
    pnpm run boundaries
    git diff --check 7bab4b8c79eb497e16d4bb490f2a33d83863be35...HEAD

类型检查与diff-check退出0，boundaries 9/9通过。未重跑完整verify/全browser或新变异；未把历史变异结果升级为当前执行。性能探针为Node下真实生产模型的同步测量，非浏览器端硬件基准或产品容量SLO。浏览器测试写入其既有ignored证据目录；实现/测试文件未修改。

性能可重建命令（同一根目录）：

```sh
node --input-type=module - <<'JS'
import { performance } from 'node:perf_hooks';
import { createEntityStore } from '@harness-projects/client';
import { deriveDeliveryOverviewTargets } from '@harness-projects/ui-model';
import { wire } from './tests/fixtures/work-item-wire.mjs';
for (const count of [20, 1000, 3000]) {
  const original = createEntityStore();
  original.applyBaseline({ revision: 0, entities: Array.from({ length: count }, (_, i) => wire('i' + i)), source: { revision: 0, freshness: 'fresh', authority: 'provider' } });
  let listCalls = 0;
  const store = { ...original, list: (...args) => { listCalls++; return original.list(...args); } };
  const input = { phase: 'received', refreshing: false, metadata: { sourceNames: {} }, read: { workspace: { id: 'ws', name: 'Workspace' }, store, connection: { connected: true }, capabilities: [{ key: 'planning.item.read', access: 'available' }], repositories: [{ id: 'repo', capabilities: [], accessVersion: 1 }] } };
  const started = performance.now();
  deriveDeliveryOverviewTargets(input);
  console.log({ count, listCalls, overviewMs: Math.round(performance.now() - started) });
}
JS
```

#281原始五项与追加consumer验收均有对应当前合同/生产组合证据；本轮没有发现破坏其核心acceptance的P0/P1。工程评审建议为 **APPROVE（含F1/P2）**，是否修复、何时合并由根评审按人类授权协调。未勾issue、未提交外部review、未commit/push/merge。当前托管checks与全线程由根评审统一回读；本文不以缓存绿检查代替其最终门禁。


### 2026-11-09 F1/P2 修复证据（未提交工作树）

父评审已在原immutable head完成首轮APPROVE并交由本owner处理F1；下列是该head之上的本地修复，不将旧托管绿检查沿用到新文件树。

- RED：先新增 `overview scans the full safe list once regardless of row count` 与 `ordinary item list and detail routes do not eagerly derive delivery overview targets`。执行 `pnpm test:file tests/contract/delivery-overview-model.test.js tests/contract/ui-work-item-app.test.js`，9项中2失败：前者45≠1（20个工作项+Draft/PR），后者258≠1（128项普通列表）；其余7通过。同期新故障语义测试确认列表后redacted/非工作项/Draft不返回目标，缺失条目仍抛TypeError。
- 修复：`packages/ui-model/src/delivery-overview.ts` 一次列表安全门、逐安全行一次当前get/type门；复用详情既有TD-024消失报错，typed WorkItem与非Draft条件仍生效。仓库ID和accessTokens只计算一次。没有复制详情全文、来源身份、规划状态或body。
- 延迟：`WorkItemApp` 传当前input的纯派生回调；`WorkItemProjectPage` 只在delivery模式调用。没有保留旧结果的新缓存，当前workspace/access替换仍走原目标generation。普通列表仅1次现有扫描；详情路由保留既有3次，不新增按行全表扫描。
- GREEN：上述同命令9/9；再执行本节前述6个模型/section/overview/app/detail合同文件，61/61通过；`pnpm test:file tests/browser/delivery-overview.test.js tests/browser/detail-expand.test.js` 7/7通过；typecheck退出0、boundaries9/9通过。所有具名测试fail/cancelled/skipped/todo=0。
- 3000项补充探针输出 `{count:3000,listCalls:1,overviewMs:2}`，相同生产模型+wire输入；验收测试只断言扫描次数与安全输出，未写脆弱耗时阈值。

规模脚本默认只计算已提交HEAD：`node scripts/rule-checks.mjs size 7bab4b8c79eb497e16d4bb490f2a33d83863be35` 显示410代码/244文档只是旧提交树。当前未提交文件树另以同脚本导出 `tally` 读取 `git diff --numstat <base>` 验证，代码466行，仍低于本PR800/仓库1000预算；文档截至本节340行，低于本PR1300/仓库1500预算；不能把旧HEAD数字冒充修复规模。

修复本身交独立评审后再由根整合者做全verify/browser、提交/最终push与远端head/checks/线程回读。本owner未commit/push、未回复或resolve外部线程。

独立修复复评（2026-11-09）：另一评审者只读检查3个production+2个test文件，结论APPROVE、F1/P2 ADDRESSED，无新可行动项；其独立3项模型测试与20/1000/3000探针确认list恒1、get=N。生产源自该次复评后未再修改；最终组合与远端门仍由根整合者负责。

2026-11-09 SGT最终接合：#568/#581已以rebase原子合并，真实main c2e2f738。总览实际7f747600接合两处共享谱系文本并保留全部索引，产品/测试等501个非docs文件与完整受验4032a6f4逐blob相同，manifest21fb12f0…10ad07。完整source/type/nonbrowser1423/2072/226、browser77、boundaries9及workflow7文件证据集中于批次记录；最终docs运输head另行真实CI/批准/全线程/双向281回读，不把先前Ready当当前通过。
