# 创建 PR 的来源 Issue 引用或关闭意图 ExecPlan

> 状态：Completed（工程创建叶；安装及父项接受另计）
> 创建：2026-11-07
> 范围：Closes #563；Refs #556；父项在组合闭环后收口
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`

## Purpose / Big Picture

合法 Issue-backed工作项默认明确引用当前Issue；用户能切为关闭合并或清除关联，并在提交前看到目标和正文片段。创建已确认与所选原生关系是否确认分别呈现；失联/reload后只读原PR，不二次create。

## Context and Orientation

本叶直接base为“原生 Issue 引用与关闭关联观察”叶A当前已验证head，并消费其 relations/per-kind coverage；A仅有读取，当前创建 `create-change-request.ts` 仍只有base/title/body/draft。不得用先后顺序假装没有代码依赖。
Core当前 canonical、marker、durable intent 与 resume 已提供单PR身份恢复，controller命令和capabilities/storage.ts为闭集。Issue目标不能从UI号码字段反解；#537展示元数据不是授权证明。
2026-11-07实际回读#556正文明确默认reference、optionalclosing/none、独立结果、保留userbody、按native引用确认；旧A/B closing-only/defaultnone建议已经Superseded。#544持久观察归属与#557assignee仍独立。

## Design / Spec

继承 A 的分叶/stack与 B 的明确候选、持久选择和两轴确认；淘汰B旧版v1/v2兼容建议：当前未发布，一次更新当前意图格式及fixtures，不造legacy恢复框架。拒绝只加UI checkbox、UI拼当前opaqueID、create后第二次patchbody。
新增 `PlanningProvider.getIssueLinkTarget(input)` 只读端口，input为现有ProviderIssueClosingLinksInput的project/membership/issue三ref，返回ProviderResult，value为这三ref的source回证及nativeIssueIdentity、number、repository:{identity,name}；Core由当前primary与membership生成输入。Core查询 `getChangeRequestIssueOptions(scope:{workItemId,repositoryId,base})` 暴露安全目标与可选reference/closing/none及原因，UI不自由输入任意node/号。
Development既有getRepository返回sourceRepositoryIdentity/defaultBranch；Core提交前重读当前候选与所选repo并比nativeidentity。当前叶仅同repo；跨repo不给静默替代。reference不受defaultbase限制，closing仅base=已回证defaultBranch；Draft/PR-only/redacted/unsupported不能伪造Issue候选，可保留none创建。
选项返回 opaque `targetStamp`，表单原样携带 `issueTargetStamp`；Core 比对当前回证，拒绝预览后变更的目标，stamp 不成为第二事实源。请求新增`issueRelation:'reference'|'closing'|'none'`，eligible默认reference，表单有target与选项预览。Core冻结原生target/source stamp、relation、base与最终body进当前externalIntent/fingerprint；same key改choice/target冲突。mutation前重验ownership/准入/source与repo；存储失败create=0。不能仅相信前端options。
追加一个明确管理的可见 `Refs owner/repo#N` 或 `Closes owner/repo#N` 行，再沿原operation marker方案创建一次PR。none保留用户body字节；不扫描正文推断/升级其他引用，不把父验收改关闭。managed clause由durableintent单次生成，恢复不再次追加，不patch远端body；保留原用户文本。
不修改Development create mutation的官方字段：关系由本次body生成即可。Provider无通用link参数；显式target证据只存Coreintent，不误传GraphQL未知字段。现有precision marker/body/head/draft证明仍保留。
创建结果phase与ref沿既有保存；另返回原selection的relationState（none/pending/confirmed/denied/unknown）与安全说明。PR created不因relation读失败回unknown可重建槽。关系确认调用叶A已授权的Core原生观察，匹配同native PR+repo+originIssue，reference需native_reference，closing需native_closing；partial能提供正证据但不能提供无关系负证据。
resume保留confirmedRef、原target与choice，只读原PR/原Issue关系；在当前source仍与saved source一致时显式重验目标披露回证，当前 source 已变则不借给旧选择。若事件迟到，显式再读，不重create。目标/权限改变不将旧关系确认借给新选择；不改PlanningStatus。不做#544durablesnapshot，但PRintent本身必须SQLite reopen保持。

## Global Constraints

唯一 owner 文件集：`packages/capabilities/src/planning-provider.ts` 新target方法/类型段、`storage.ts` PRintent段、`packages/providers/planning-github-projects/src/provider.ts` target注册、新增 `issue-link-target.ts`（自带只读query）、`packages/core/src/create-change-request.ts`、`packages/core/src/issue-closing-links.ts`仅既有 owner/cohort 的来源读 guard、相关拒读版本与 target 反馈桥；exact-source 版本进入既有 scope stamp 和完整回证清遮罩检查，不改双流分页、union 或 coverage 算法；新增 `change-request-issue-link.ts`、`packages/core/src/context.ts`、`queries.ts`、`packages/controller/src/queries.ts`、`commands.ts`、`apps/harness-plugin/src/host-operations.ts` 及 `host-composition.ts`仅PRhandlers、`apps/harness-plugin/src/client.ts` PR creator接线、`capabilities/src/registry.ts` golden及`core/src/registry.ts` PORT_METHODS新port项、`packages/client/src/create-change-request.ts`、`packages/ui/src/create-change-request-section.ts`；P1 修复扩展其来源签名接线 `packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/delivery-lineage-section.ts`，不改变交付谱系读取签名；本计划与tests。
测试集合：`tests/integration/create-change-request.test.js`、`tests/integration/change-request-operation.test.js`、`tests/integration/harness-plugin-change-request-operation.test.js`、`tests/contract/ui-create-change-request.test.js`；新增 `tests/contract/issue-link-target.test.js`、`tests/integration/create-change-request-link-recovery.test.js`；`tests/browser/workspace-execution.test.js`仅丢 PR ack / SQLite reopen 的关系选择恢复断言；P1 连续打开扩展 `tests/browser/native-link-detail.test.js` 与直接 fixture `tests/fixtures/native-link-detail-browser.mjs` 的合法只读 target 响应，不改 native 观察算法；新 ABI 同步 `tests/contract/harness-host-operations.test.js`、`harness-host-remote-adapter.test.js` 与 `tests/integration/harness-plugin-artifact.test.js`。不改A双流观察算法、下层分支或#537展示字段；不加metadata第二写/assignee。

单 owner 修改本闭环；同一共享文件不同语义段仍先由主控协调接口。每 PR code/test/config 的 additions+deletions 严格小于 800，docs 严格小于 1300；不以净行数替代 changed lines，不删判别测试凑预算。
未发布 MVP 不增加 legacy migration、双读、旧 ABI fallback 或 v1/v2 恢复框架。SQLite schema 如需变化按当前未发布基线直接调整；仅验证新建数据库与本次格式 reopen，不要求旧二进制兼容。
禁止 merge、真实模型启动、修改 Planning Status、blocking/blocked-by、#552 或 `docs/product/demo.md`。不手改原验收数据库，不声称修复历史 unknown，不把 local tests 当 Desktop 接受。
保持单 Planning authority、Host 状态权威、工程轴与规划轴正交、Provider ack/reconcile 规则、权限遮蔽及凭据 handle 边界。源码不引用内部输入或本机绝对路径。

## Plan of Work

### Batch 1 · 候选/选择/持久恢复红测

最小闭环：合法Issue默认Refs且当前创建丢选择由真实路径证明。
涉及文件：新增 `tests/contract/issue-link-target.test.js`、`tests/integration/create-change-request-link-recovery.test.js`，现有UI创建测试。
覆盖同repoIssue/defaultbase、reference非defaultbase、closing非defaultbase拒绝、none保持body、Draft/PR-only/denied、Source变化、samekey改choice冲突。先保存原代码红测。用真实Provider target fixture与Core/SQLite，不仅UI setter。
验证：`pnpm test:file tests/contract/issue-link-target.test.js tests/integration/create-change-request-link-recovery.test.js tests/contract/ui-create-change-request.test.js`。预期新增行为断言红；回滚仅测试。

### Batch 2 · 单次创建与两轴确认

最小闭环：原选择持久、一次create、原生关系独立确认/恢复。
涉及文件：target port、Core持久创建、controller/Host/client闭集、创建表单。
实现options/preflight、managedbody与durableintent；利用叶A观察确认同nativePR关系。dropcreateack、relationdenied、延迟事件、SQLite reopen分别assert create=1、原choice不变、phase已创建不回退。全无关系时relationnone不调用原生观察。
验证：`pnpm test:file tests/contract/issue-link-target.test.js tests/integration/create-change-request-link-recovery.test.js tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/contract/ui-create-change-request.test.js tests/integration/harness-plugin-issue-closing-links.test.js`。预期全部pass，UI明确created+relationunknown；前后PlanningStatus相同。回滚本批但保留用户PR与intent。

### Batch 3 · 独立复核与发布门

最小闭环：独立评审当前实现及证据，准备可审阅 PR，不自动合并。
涉及文件：本计划的证据与结论章节。
先按下列精确路径完成判别红绿与相关回归，再运行 typecheck、boundaries、publication/size 与 diff 检查。code/test/config 超过 799 行或 docs 超过 1299 行时停止 push，保持能力闭环重新切片；不把未通过的用例标已完成。
在本计划分支工作树根执行：

```sh
pnpm run typecheck
pnpm run boundaries
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure feature/pull-request-issue-link
node scripts/rule-checks.mjs size feature/pull-request-issue-link
```

预期命令 exit 0；仓库 size checker 的默认上限不能替代本轮更严上限。Git diff、numstat 和 commit 机械检查通过 argv/library 调用；公开面按 `docs/development/publication.md` 五类人工核对。
准备 draft PR 之后、最终 push 之后，由主控对当前 PR 显式 `-R SingularityKChen/harness-projects` 回读 head/base/checks、issue 关联及完整 review threads；这些是易失状态，不预写 SHA 或 pass 数量。
回滚点：保留本 PR 前基线；失败时只回退本闭环提交。已经公开的分支改写须 recovery ref 与精确 lease；未经人类指令不 merge。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 用户意图 | eligible默认Refs，optionalCloses/none，目标/正文可预览 |
| 授权与范围 | source原生回证，同repo/defaultbase规则、撤权无create |
| 持久事实 | SQLite reopen原target/choice/body，samekey改变冲突 |
| 一次外写 | lostack/denied/reload后create=1，只有read重试 |
| 独立确认 | createdref保留，reference/closing分别原生回证 |
| 组合 | 叶A+B生产Host/UI通过，父#556接受不由单PRgreen决定 |

共用接受门：准确记录红测如何失败、绿测命令与输出、执行分支和时间；scope、permission 与 late response 反例通过；当前 head 的 hosted checks 和人工接受单列，缺失即写未验证。

## Progress

- [x] (2026-11-07 SGT) 完成 A/B 独立方案核对、真实路径与现有接口调查，形成最终最小 spec。
- [x] (2026-11-07 SGT) Batch 1 新增 target/options/none/lost-ack/SQLite 四个判别测试，红测确认缺 port/query 与 strict field 拒绝；实施后 4/4 窄测通过。
- [x] (2026-11-07 SGT) 主控完成受保护 rebase 至 A `449c484b8371e437f6158c96fc22473b591cbc08`；原始检查点由 recovery ref 保留。
- [x] (2026-11-07 SGT) Batch 2 完成 target port、选择与 SQLite 持久化、单次创建、按关系种类的新鲜原生确认、Host/client/UI strict 接线与原选择摘要。
- [x] (2026-11-07 SGT) 本地完整 `pnpm test` 3604/3604、`pnpm run test:mvp0` 8/8、typecheck、boundaries 9/9、workflow 检查通过。
- [x] (2026-11-07 SGT) 独立评审三条 finding 已先红后绿修复；173 项相关回归、原 private probe 3/3 通过，待原 reviewer scoped 复核。
- [x] (2026-11-07 SGT) 完成独立完整审读、F1–F4及浏览器修正 scoped 复审，发布面与严格行数检查；draft PR #565 已建立原生双向关闭关联。最终 push 后的当前 head 托管门与 Ready 由主控回读记录，禁止使用旧 head 结果。
- 保留外部门：实际安装与人类接受未执行，#556/#460保持独立；本工程创建叶归档不替代该门。

## Surprises & Discoveries

P1 完整回归发现两个无仓库详情的精确白名单断言因无条件加入创建签名失败。签名仅用于具有仓库的创建消费者，因此将其放入既有 WorkItem+非空仓库投影分支，保留无消费者详情的字段面；未放宽白名单断言，13项详情契约通过。原 saved-summary 私有脚本直接挂组件且不传 metadata，保持原文件不变；新增真实 Host 集成以实际 nativeAccessVersion 更新同一实例，另提供仅补该 prop 的运行态 adapter，不把旧无接线脚本声称为修复后原样通过。

现有CreateChangeRequestRequest与controller字段白名单、externalIntentSnapshot均不接受relation；只改Core类型或React字段会被真实链路拒绝。既有getRepository已有defaultBranch/sourceRepositoryIdentity，足够做同repo/defaultbase回证，不新建一套仓库事实。

源码观察基线为 2026-11-07 的 `main`；用 argv `git rev-parse HEAD` 与 `git status --short --branch` 重读实际分支状态。测试路径已逐一通过文件枚举核验；标为“新增”的测试应由 Batch 1 创建，不是假称既有用例。

## Decision Log

- Decision：人类本会话点名 #565，原实现会话修复 P1 后由原评审者独立复评；无 P0/P1 的最终 head 按本会话条件授权归档、整理、核对 issue 并 rebase merge。
  Rationale：来源/native 权限签名只控制消费旧回执，保留草稿、持久意图及 pending 去重槽；创建确认和关系确认独立，#544/#556/#557/安装接受不扩大。
  Date/Author：2026-11-07 SGT / 人类伙伴直接条件授权，评审协调者记录。

- Decision：人类明确批准将 #553/#554 提前纳入迭代 9，交付 #554/#553/#537 外部叶/#556 修订范围。
  Rationale：修复已出现的产品回执问题，并完成已点名能力；准入授权不包括 Status 或 blocking 关系修改。
  Date/Author：2026-11-07 SGT / 人类授权，主控转达，综合评审者记录。
- Decision：B明确stack在观察A上，复用新relations+coverage；默认reference、optionalclosing/none；当前格式直接调整不做legacy。
  Rationale：实际依赖是B的原生关系确认，不是计划排序；复用避免第二套分页与权限语义，保护<800预算及同一事实所有权。
  Date/Author：2026-11-07 SGT / 独立综合评审者。

- Decision：当前 PlanningItemRead 与 exact project/membership/Issue 拒读参与来源目标准入；PlanningIssueClosingLinksRead 拒读只影响关系确认，不能升级为 Issue 内容拒读。
  Rationale：实际 provider 按 capability key 分域记录拒读。共享 owner 的相关拒读版本供 target receipt 使用，避免 native-only 拒读越界遮蔽；target 成功不清任何 native authority。新 Host 无本代 target proof 先遮蔽 durable metadata，显式恢复可在同一保存来源上重新回证。
  Date/Author：2026-11-07 SGT / 主控事实驱动细化，实施者核对代码并补正控。

- Decision：P1 使用创建消费者独立的来源权限 receipt，不扩大 deliveryAccessTokens，也不把 native metadata 作为组件 key。
  Rationale：沿用来源关联消费者的 render 先遮蔽规则；保持交付域与 Planning/native 权限正交、草稿字段与 pending mutation 去重槽稳定。metadata 只纯读原 operation；相同 owner/base 的 target probe 仅首次或用户显式触发。已到达的 PR 创建 ack 需新 operation 回证才继续确认，旧关系确认降为 unknown；晚到写响应不发布旧关系。
  Date/Author：2026-11-07 SGT / 主控依据独立 P1 与现有消费者模式修订。

## Idempotence and Recovery

confirmedRef一旦保存不能因relationfailed删除；resume仅读原PR与原Issue，原choice/source永不悄改。用户明确新建意图时也受既有unresolved槽位约束；不因点击“刷新”追加clause或写body。

所有读取和窄测试可重复。实施失败保留当前红测、准确失败阶段和已知副作用，不抹掉证据。未提交变更只撤本 owner 文件；数据库验证使用临时 fixture，出现新格式不可读则回到当前基线重建临时库，原用户数据库不动。

## Interfaces and Dependencies

执行上下文：检出 `feature/pull-request-issue-choice` 的工作树根（仓库内 `.worktrees/pull-request-issue-choice-20261107`）。采用仓库 Node >=22 与 pnpm 10.28.2；用 `pnpm install --frozen-lockfile` 满足依赖，不擅改 lockfile。
在主控已创建的对应worktree实施，本计划只进入B的交付diff。使用仓库gh-stack流程管理真实A→B依赖，B直接base为A分支；不merge。新target端口与#537内容字段按段协调，host PR handler与#553 setup段单owner协调。
若实现新增公共 capability 或 wire 字段，生产路径与 strict validator 同时调整；不允许仅改 fixture 让 UI 有数据。

## Outcomes & Retrospective

2026-11-07 SGT：已实现本叶工程闭环。合法来源默认 reference，可选 closing/none；同仓库与默认分支规则、过期预览及 mutation 前来源重验在 Core 执行。单次 body 生成保留用户正文与无关引用；丢 ack、SQLite reopen 和关系迟到/denied 的恢复均保留原 PR/选择，Planning 投影前后相同。完整本地测试 3604/3604、MVP 不变量 8/8；独立审阅与当前远端 head 的 hosted checks 由主控继续，真实 Desktop 人验未执行。
#544保持native观察持久缓存ownership；本叶仅持久PR选择。#556真实installed接受、当前artifact identity及远端原生readback仍需人工记录，不能以fixtures宣布父完成。
Superseded by 2026-11-07 工程归档：独立 MMP 复评已接受创建叶与 P1 根因修复；实际安装、父项 #556 和持久快照 #544 继续开放，不由本叶归档接受。

## Bottom Change Note

2026-11-07 SGT：综合 A/B 与真实源码，冻结最小纵向闭环、判别测试、owner 边界和恢复门；修正不存在的路径与未发布兼容负担。

2026-11-07 SGT checkpoint：初始计划提交 `3933c96df19176d2fc7242be653f19a65b09b65e`；红测与首轮绿测已记录在本地执行证据，当前 typecheck 仍等待叶 A 的 relations 契约。主控批准新port必要 registry golden / PORT_METHODS 与 apps client PR creator 接缝。未 push、未外写、未运行模型。

2026-11-07 SGT 实施记录：初始计划提交为 `3933c96df19176d2fc7242be653f19a65b09b65e`，在叶 A 上重放后为 `4fb0000a`。红测依次证明缺 target/query/strict relation、partial 正证据被全局 stale 遮蔽、预览缺 stamp 与写前变更被误记未知；对应绿测见 `.superpowers/iteration-20261107/choice-red.log`、`choice-wire-red.log`、`choice-fence-red.log`、`choice-provider-host-ui.log`、`choice-full-test.log`。这些路径仅为执行证据引用，不是正式产品文档。首轮完整回归的四处 ABI 旧夹具已同步，并重新完整通过。新端口复用 PlanningItemRead 准入、现有 PR observer 与 A 的 get/refresh，不引入兼容/迁移或新的观察框架。最终提交前相对 A 的代码/测试/config 增删和为 449 行，文档 134 行，低于本叶严格上限；正式数字以最终提交扫描为准。

2026-11-07 SGT 独立评审修正：锁定 `3d58807bc2df595df3dcdb4a69f0865cba1a3457` / 直接 base `6bd2ae48378ef525980df64cab4328a91a7799ad`，三条 private probe 均先复现红测，见 `.superpowers/iteration-20261107/choice-review-probes-red.log`。F1 由当前 descriptor/policy 与共享 PlanningItemRead/exact-source cohort 检查修复；native-only 拒读正控保持选项可用。F2 由绑定相关拒读版本的本代 exact-target receipt 修复，summary 在本地短事务内按当前来源裁决并遮蔽；SQLite reopen 无当前 receipt 不披露，显式 resume 可只读重验同一原来源。另经红测修复重复 target 拒读后迟到成功恢复遮罩的竞态。F3 在 create 复用原 intent 前比较当前 source，pending/saved、有无 preview stamp 变体均冲突；resume 仍只观察原 PR、create=1。相关 173 项回归及原 private probe 3/3 已通过；执行证据见 `choice-review-regression.log`、`choice-review-probes-green.log`。所有回证均为本地合成 fixture，独立 scoped 复核、远端回读与真实 Desktop 人验仍归主控。

2026-11-07 SGT 补充 F3 根因收敛：same-key create 一律重新选择当前已回证 target 与默认 relation，拒绝借用 savedSelection 构造双方都为旧来源的 fingerprint；same local refs 下原生目标号变化、原 closing 后省略选择回到默认 reference 的两个反例也先红后绿。显式 resume 同源重验披露不改变原 selection，恢复页可恢复当前已获准 metadata；无 proof/拒读时依然不展示 repo#Issue。`currentTarget` 保持原有工程上下文语义，不以它声称 Issue metadata 可见。

2026-11-07 SGT review 修正验证：`pnpm verify` 再次完整通过（typecheck、3623/3623 tests、8/8 MVP invariants），boundaries 9/9、workflow 与 diff-check 通过；见 `.superpowers/iteration-20261107/choice-review-verify.log`。此为当前 B 层修正的本地证据，不能代替 hosted checks 或真实 Desktop 接受。

2026-11-07 SGT F4 scoped 修正：以 `dc2d3545c0e9970df39ef89a0169055c5f1914da` 为 FIX_BASE、直接 base 仍为 `6bd2ae48378ef525980df64cab4328a91a7799ad`。独立 probe 的重复 native exact-source not_found / 迟到 target 成功已先复现（新 probe 2/3），仓库双向 cross-caller 反例补齐。每个 actual missing 回执在共用 observeResource 推进该 resource 私有 receipt 版本，移除 target wrapper 单侧特判；native scope 捕获相关版本并在清 missing 时校验，故较新的 target not_found 同样能挡住旧 native 完整读回。重复拒读可保持 global native epoch 稳定；native-only capability 拒读隔离保留。新/原两组 private probe 各 3/3，相关 scope/native/Host/UI 回归 137/137，pnpm verify 的 typecheck、3625/3625 tests 与 8/8 MVP invariants 均通过，boundaries/workflow/diff-check 通过。证据为 `.superpowers/iteration-20261107/choice-f4-probe-red.log`、`choice-f4-red.log`、`choice-f4-probe-green.log`、`choice-f4-green.log`、`choice-f4-original-probes.log`、`choice-f4-regression.log`、`choice-f4-verify.log`。未修改下层分支、模型、用户 DB 或规划状态，待原 reviewer scoped 复核。

2026-11-07 SGT 浏览器恢复契约修正：B 基线 `a19288229bd0fb516d6db65fd9c12e44af415626` 独立复现旧 exact 摘要断言超时（0/1）。Playwright trace 的真实 DOM 为“已保存原请求（草稿 PR）：Browser native PR；feature/topic → main；不关联 Issue”，composed planning fixture 未实现 native target port，持久选择诚实为 none；这是测试未同步新增关系摘要，不是产品恢复问题。仅修正浏览器断言，并新增 durable issueSelection=none、reload 仍 unknown/无 target、恢复后原选择逐字保持及 create=1 的证据。`tests/browser/workspace-execution.test.js` 4/4，相关 SQLite/Core/Host 恢复回归 107/107，通过日志为 `.superpowers/iteration-20261107/choice-browser-recovery-red.log`、`choice-browser-recovery-green.log`、`choice-browser-persistence-regression.log`。本 B 旧 A 基线的完整 browser 为 51/54、3 个 native-link-detail 旧夹具失败（`choice-browser-full.log`）；A 已独立修复，主控将在重放后运行 combined 全量 browser/verify。此前 a192 的 full verify 为 3625+8；本次只改测试/计划，不冒称已执行新组合全量。产品源码、隐私和竞态门保持原行为。

2026-11-07 SGT 最终工程回执：F4 reviewer 锁定 `a1928822`，私有探针6/6与聚焦回归137/137；浏览器 reviewer 锁定 `f37c0c68`，恢复文件4/4，均无未处理P0/P1/P2。相应执行报告为 `.superpowers/iteration-20261107/review-choice-f4-final.md` 与 `review-choice-browser-final.md`。主控以真实旧base `6bd2ae48` 将三个B提交重放到A最终 `a9652297`，range-diff三个提交均等价；仅A测试夹具与文档随新base进入。五候选组合完整verify为3690/3690+8/8，随后仅浏览器断言/文档调整后的完整Browser为57/57，boundaries9/9、workflow通过；源码未变化，不把两次验证冒充同一条命令。主控只补文档回执与直接base验证命令。关闭关联已通过GitHub原生接口双向回读，非默认base并非无法关联的阻塞。最终分支push/checks/Ready属易失状态，以PR实时结果与主控回执为准；Desktop人类接受保持未执行，计划继续Active。

2026-11-07 SGT MMP P1 修复批次（未提交）：评审 `5810401576` 对 `21d836d1` / 直接 base `a9652297` 提出唯一 REL-565-F1。主控独立运行两条原反例，均以已拒读目标仍可见断言 exit 1。根因位于持续挂载创建消费者：未消费 primary/planning/nativeAccessVersion；Core 写前拒绝和 durable intent 不改。修复将来源权限签名从安全投影传到创建消费者，在 render 比较 receipt，先遮蔽旧 options、operation Issue 目标和关系确认；metadata 只纯读 Host operation，实际 target probe 仅首次/base 编辑或显式重验。用户草稿与进行中的 mutation 去重跨权限更新保留，旧异步回执不得恢复旧证据。判别覆盖持续预览/原摘要、重复 metadata、迟到 options/operation/resume、显式恢复及 create=1。只修改 #565 工作树；独立复评由原评审会话执行，本会话不 commit/push/restack/archive/merge，不改 Planning Status/依赖。正式原评审记录 `docs/review/pr-565-mmp-review.md` 保留未跟踪、随本次待审 diff 一并交回。

- [x] REL-565-F1 本地红绿修复与冻结源码验证：verify 3629+8、Browser 57、boundaries9、workflow通过；严格工作树规模与披露扫描通过。
- [ ] 原 reviewer 独立复评及真实新 base 收尾；本地修复仍未提交。

2026-11-07 SGT REL-565-F1 本地待审回执：原 Chromium probe 在同一脚本下由泄漏转为 `leakedPreview=false`；原 saved-summary 私有 probe 保留不改，运行态 adapter 仅从实际 Host baseline 传入新 accessToken，结果 `leakedSavedSummary=false/nativeCreates=1`。仓库维护用例涵盖连续 watch→安全投影→drawer 预览、同实例 reference/closing/none 保存摘要，以及 late options/operation/resume/已到达创建 ack 四组时序。新反例/正控8/8、修改测试文件48/48通过。完整冻结候选 `pnpm verify` typecheck、3629/3629+8/8，`pnpm test:browser`57/57，boundaries9/9，workflow8文件零finding；无失败/跳过/取消。证据为执行态 `pr565-p1-final-v2-*.log`、`pr565-p1-final-v2-validation.json`（含源文件hash）、`pr565-p1-tests.md`，位于 `.superpowers/iteration-20261107/`。HEAD保持 `21d836d1`，直接验证base固定 `a9652297`；评审会话更新的下层不在本次自动重放。工作树扫描显式包含未提交完整diff与未跟踪正式评审文档，不以只读HEAD的提交扫描冒充当前修复扫描。五类发布面已人工核对；不扩大到服务修复、旧数据/兼容或人类接受。本地P1已交回原评审者，未 commit/push/rebase/reset/archive/merge 或修改规划字段。

- 2026-11-07 SGT：Superseded by 2026-11-07 原 relation reviewer 独立 scoped 复评 ADDRESSED：原 Chromium反例、完整草稿/迟到/重复拒读矩阵与真实安全详情签名的saved摘要探针均通过；tracked窄回归48/48，新增守卫8/8具名变异KILLED，baseline/还原绿，候选源码hash与owner final-v2一致。无新增P0/P1/P2/P3；最终真实main restack、不可变head及托管门另行回读。 工程计划归档；实际新 main 接合和最终托管门仍为必需门。
