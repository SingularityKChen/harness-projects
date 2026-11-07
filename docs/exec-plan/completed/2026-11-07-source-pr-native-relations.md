# 原生 Issue 引用与关闭关联的统一观察 ExecPlan

> 状态：Completed（工程观察叶；安装与父项接受另计）
> 创建：2026-11-07
> 范围：Closes #562；Refs #556；父项在组合闭环后收口
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`

## Purpose / Big Picture

已有仅 Refs 的 PR 能通过 GitHub 原生 CrossReferencedEvent 出现在来源关联面板；关闭关联单独标注。相同 native PR 只显示一次并保留实际关系集合，某条流失败不能被说成两类均已确认无关联。最小证据为生产 Provider→Core→strict client→面板的 refs-only fixture 通过，既有 closing 回归保留。

## Context and Orientation

现有 `packages/providers/planning-github-projects/src/issue-closing-links.ts` 只读 closedByPullRequestsReferences，Core `issue-closing-links.ts` 在当前 Host 内缓存且按 native PR identity 回证 Development Provider。client reader 闭集仅认 relation=native_closing，UI section 固定文字“关闭关联”。不能只替换一条文案。
2026-11-07 已回读 #556 当前正文：默认 Refs、可选 Closes/none，面板联合 CrossReferencedEvent 与 closing，去重保留关系，按关系完整性诚实显示。#555→#545 willCloseTarget=false 是需求给定 concrete fixture，issue 明确 #544 拥有持久 last-complete/restart/offline snapshot，本叶不实现该缓存。原生引用不等于 implements 或 execution lineage。
本叶只补观察；创建选择由后续显式 stacked PR 提供。父 #556 保留直到组合全部满足，Leaf A 仅关闭新观察叶 issue。

## Design / Spec

采用 A 的先读取闭环方案，继承 B 的不造业务关系与 native identity 去重原则；拒绝正文扫描和仅改创建正文，因为已有 Refs 仍然在面板消失。只读两个原生连接，不修改 PR/Issue。
保持既有 listIssueClosingLinks/getIssueClosingLinks 命名减少无关改名；扩展 Provider 输入为明确 `relationKind:'native_reference'|'native_closing'`（所有现有调用/fixture同批调整）。继续使用既有 PlanningIssueClosingLinksRead 读门并明确扩大其观察语义，不新增可绕过旧拒读的第二权限门。Provider 按 kind 分别读 timelineItems(CROSS_REFERENCED_EVENT) 或 closedByPullRequestsReferences；两流游标各自推进、每页 source project/membership/Issue/repository 回证，deadline 总预算与页数有界。
CrossReferencedEvent 必须回证 target 当前 Issue、source __typename=PullRequest，提取 PR native identity/repository/number/title/url/state/isDraft 与 willCloseTarget。只接受原生 PR，Issue source 不是 PR，不能靠编号/标题/branch/LLM补识别。willCloseTarget=false 的事件是仅引用；true 不能代替 closing connection 的确认。
Core 继续按 native PR(namespace,id)和 repository identity 向已登记 Development Provider exact-read；保留绑定/权限/owner fencing。输出 `relations` 为去重且稳定排序的 native_reference/native_closing 集合，原生引用额外保留 `referenceWillCloseTarget`（同PR多事件有任一true即保守true，仅作提示而非closing确认）；同一 PR 跨两流只占一行，不以数字去重；同一身份基础字段冲突不能悄悄覆盖。
完整性最少有 per-kind 状态及 observedAt/freshness：两流各自 complete/partial/unavailable；总体 complete 仅两者均 complete，complete empty 仅对本流成立。失败一流不能假定没有该关系；已获准另一流可诚实展示并标缺口。permission denied、binding/source改变、late reply 则整体遮蔽受影响 target，不能保留标题/URL/数量泄漏。
provider/core/client 的闭集验证同时接受 relations 与覆盖状态；无未知字段任意通行。UI false event 明确“仅引用”，closing connection 明确“合并时关闭”；同 PR 双证据两个标记。只有 willCloseTarget=true 而 closing 未证时写“原生引用；关闭关系尚未确认”，不借历史事件宣称当前 closing。
来源页包含不在 Project 的 PR；使用 source PR native identity 查询已登记 repo，不全项目预抓。所有观察只在当前 Host 读取生命周期；#544 的未来持久 snapshot 应复用本关系集合与覆盖契约，本叶不重叠实现。

## Global Constraints

唯一 owner 文件集：`packages/capabilities/src/planning-provider.ts` 原生关系类型/方法段、`packages/providers/planning-github-projects/src/queries.ts` 原生 links query 段、`issue-closing-links.ts`、新增 `issue-references.ts`（独立 timeline query/decoder）、`packages/core/src/issue-closing-links.ts`、`packages/client/src/issue-closing-links-reader.ts`、`packages/ui-model/src/issue-closing-links-view.ts`、`packages/ui/src/issue-closing-links-section.ts`；本计划与 tests。
测试集合：`tests/contract/planning-issue-closing-links.test.js`、`tests/contract/issue-closing-links-reader.test.js`、`tests/contract/ui-issue-closing-links.test.js`、`tests/integration/issue-closing-links-scope.test.js`、`tests/integration/harness-plugin-issue-closing-links.test.js`；新增 `tests/contract/planning-issue-references.test.js`；托管 Browser CI 修复窄扩展 `tests/browser/native-link-detail.test.js` 及其直接 HTTP fixture `tests/fixtures/native-link-detail-browser.mjs`，仅更新测试输入和当前契约断言。本叶不改 storage schema/PR intent、创建表单、#544持久缓存；与#537共享文件先冻结非重叠段。

单 owner 修改本闭环；同一共享文件不同语义段仍先由主控协调接口。每 PR code/test/config 的 additions+deletions 严格小于 800，docs 严格小于 1300；不以净行数替代 changed lines，不删判别测试凑预算。
未发布 MVP 不增加 legacy migration、双读、旧 ABI fallback 或 v1/v2 恢复框架。SQLite schema 如需变化按当前未发布基线直接调整；仅验证新建数据库与本次格式 reopen，不要求旧二进制兼容。
禁止 merge、真实模型启动、修改 Planning Status、blocking/blocked-by、#552 或 `docs/product/demo.md`。不手改原验收数据库，不声称修复历史 unknown，不把 local tests 当 Desktop 接受。
保持单 Planning authority、Host 状态权威、工程轴与规划轴正交、Provider ack/reconcile 规则、权限遮蔽及凭据 handle 边界。源码不引用内部输入或本机绝对路径。

## Plan of Work

### Batch 1 · schema 只读核对与 refs-only 红测

最小闭环：证明真实 CrossReferencedEvent 被当前生产观察遗漏。
涉及文件：新增 `tests/contract/planning-issue-references.test.js`、`tests/integration/harness-plugin-issue-closing-links.test.js`。
2026-11-07 已通过 `gh api graphql` introspection 回证 CrossReferencedEvent.source/target 为 ReferencedSubject、willCloseTarget 为非空 Boolean；已只读 #545 timelineItems，hasNextPage=false，观察到 #555 的source PullRequest/target Issue/false，以及需忽略的Issue source。实施前再回读精确字段与分页；若形状不符先修契约。fixture 采用 source PullRequest、target Issue、willCloseTarget=false，保留当前 closing fixture；测试两流同 PR、同号异 repo、非PR source、空/循环cursor、partial/denied与late。
验证：`pnpm test:file tests/contract/planning-issue-references.test.js tests/integration/harness-plugin-issue-closing-links.test.js`。旧实现应因 refs-only 缺失或关系集合断言红；不发外写。回滚仅测试。

### Batch 2 · 两流分页、联合与真实面板

最小闭环：原生证据贯穿 production Host/client/UI，按关系区分。
涉及文件：Provider relation query/decoder、Core原生观察、client strict parser、现有面板。
冻结 relations 与 per-kind coverage；两流分别分页与source回证，map按native身份联合，保持 Development exact read、权限/epoch围栏；补两类 complete empty、单流错误与完整度反馈。
验证：`pnpm test:file tests/contract/planning-issue-references.test.js tests/contract/planning-issue-closing-links.test.js tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js`。预期全pass，same PR一行双标记、仅引用可见，denied无metadata。回滚本批；不清用户已有关系。

### Batch 3 · 独立复核与发布门

最小闭环：独立评审当前实现及证据，准备可审阅 PR，不自动合并。
涉及文件：本计划的证据与结论章节。
先按下列精确路径完成判别红绿与相关回归，再运行 typecheck、boundaries、publication/size 与 diff 检查。code/test/config 超过 799 行或 docs 超过 1299 行时停止 push，保持能力闭环重新切片；不把未通过的用例标已完成。
在本计划分支工作树根执行：

```sh
pnpm run typecheck
pnpm run boundaries
node scripts/workflow-check.mjs
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
```

预期命令 exit 0；仓库 size checker 的默认上限不能替代本轮更严上限。Git diff、numstat 和 commit 机械检查通过 argv/library 调用；公开面按 `docs/development/publication.md` 五类人工核对。
准备 draft PR 之后、最终 push 之后，由主控对当前 PR 显式 `-R SingularityKChen/harness-projects` 回读 head/base/checks、issue 关联及完整 review threads；这些是易失状态，不预写 SHA 或 pass 数量。
回滚点：保留本 PR 前基线；失败时只回退本闭环提交。已经公开的分支改写须 recovery ref 与精确 lease；未经人类指令不 merge。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 原生引用可见 | production route 的 #555/#545形状 fixture，false→仅引用 |
| 关系不混同 | closing独立来源，true事件不冒充closing |
| 去重 | native同PR一行relations集合，异repo同号不合并 |
| 分页/完整度 | 两流独立coverage，失败不宣称无关联 |
| 安全 | 原source/binding变更、denied、late均无泄露 |
| 范围 | 无body扫描、无implements、无持久snapshot/模型/外写 |

共用接受门：准确记录红测如何失败、绿测命令与输出、执行分支和时间；scope、permission 与 late response 反例通过；当前 head 的 hosted checks 和人工接受单列，缺失即写未验证。

## Progress

- [x] (2026-11-07 SGT) 完成 A/B 独立方案核对、真实路径与现有接口调查，形成最终最小 spec。
- [x] (2026-11-07 SGT) Batch 1：生产 refs-only / union / strict reader / UI badge 红测均因旧契约缺失失败；日志见 `.superpowers/iteration-20261107/relations-red.log` 与 `relations-reader-red.log`。
- [x] (2026-11-07 SGT) Batch 2：双流分页、native identity 联合、coverage、strict client 与面板已实现；在本分支工作树根运行 Batch 2 六文件命令通过。新增 reference 自身拒读/NOT_FOUND/迟到矩阵先红，修复共享来源读门过早恢复后通过，日志见 `relations-reference-security-red.log` 与 `relations-green.log`。
- [x] (2026-11-07 SGT) 初始 Ready 与完整独立 MMP 评审完成，唯一 P3 已补强并独立复评；最终 head 发布面、托管门和远端回读按本节命令执行。
- 保留外部门：实际安装与人类接受未执行，由 #556/#460 跟踪；本工程观察叶归档不替代该门。

- [x] (2026-11-07 SGT) 独立完整审读与修复 scoped 复评完成。F1 已知拒读 cohort 下 partial 回执泄露已由原评审者生产探针 6/6 及 82 项回归复评 ADDRESSED，未发现修复新增 P0/P1/P2。

## Surprises & Discoveries

当前Core会以同identity的整条JSON比较重复，reference/closing同PR自然不同，不能原样沿用该冲突判定；必须拆基础对象一致性与relation集合联合。现有client同样只有单个relation字段，需要同步调整闭集。

源码观察基线为 2026-11-07 的 `main`；用 argv `git rev-parse HEAD` 与 `git status --short --branch` 重读实际分支状态。测试路径已逐一通过文件枚举核验；标为“新增”的测试应由 Batch 1 创建，不是假称既有用例。

独立 reference 安全矩阵发现：closing 单流成功若提前清除共享 source authority/resource 的拒读/缺失 cohort，reference 持续403/NOT_FOUND会使 nativeAccessVersion 每次递增。将 source 恢复推迟到两流均 complete；重复拒读版本保持稳定，late negative 仍可围栏旧回执。Core 的每类 coverage 记录本次观察尝试时间；unavailable 不伪称完成时间。

2026-11-07 SGT 托管 Browser CI 在 head `6bd2ae48378ef525980df64cab4328a91a7799ad` 的 run `42338761001` / job `128301545853` 失败：3 个 native detail 用例等待 complete 超时，其余51通过。本地相同文件复现；直接生产fixture读回 closing=complete/reference=unavailable/top=partial，根因为HTTP fixture完全缺少 PlanningIssueReferences。补 timelineItems/CrossReferencedEvent exact target/PR source/false 与分页形状，双流offline和按Issue拒读；F1后实际denied文案替代旧unread断言，仍精确等待且保留全部metadata/无事实/无循环/late负例。新增 refs-only Chromium正控及reference后台拒读/late场景。未修改Core、公共接口或上层helper。

## Decision Log

- Decision：按本会话人类点名 #564 的条件授权，非阻塞 P3 修复并独立复评后归档、整理提交和 rebase merge。
  Rationale：只增强 strict DTO 的判别负例，原生产守卫与观察权威不变；父项、安装和 Planning Status 独立。
  Date/Author：2026-11-07 SGT / 人类伙伴直接授权，评审协调者记录。

- Decision：人类明确批准将 #553/#554 提前纳入迭代 9，交付 #554/#553/#537 外部叶/#556 修订范围。
  Rationale：修复已出现的产品回执问题，并完成已点名能力；准入授权不包括 Status 或 blocking 关系修改。
  Date/Author：2026-11-07 SGT / 人类授权，主控转达，综合评审者记录。
- Decision：拆观察叶A与创建叶B，B因复用A的relations+coverage观察契约明确stack在A之上；不复制第二套权限/分页读面。
  Rationale：A是独立可验收只读闭环；B若main独立而仍确认reference，需重复A核心观察或放弃真实确认，两者都增加风险。
  Date/Author：2026-11-07 SGT / 独立综合评审者。

## Idempotence and Recovery

每次refresh只有原生读取，重试不写PR。当前Host代际/source/权限变更使旧证据失效；不得引入持久last-complete缓存绕过#544所有权。

所有读取和窄测试可重复。实施失败保留当前红测、准确失败阶段和已知副作用，不抹掉证据。未提交变更只撤本 owner 文件；数据库验证使用临时 fixture，出现新格式不可读则回到当前基线重建临时库，原用户数据库不动。

## Interfaces and Dependencies

冻结接口：`ProviderIssueClosingLinksInput.relationKind` 必填 native_reference/native_closing；Provider 单条 `relation` 与该输入一致，reference 条必须带 boolean `referenceWillCloseTarget`。Core/UI wire 单条改为 `relations` 稳定 reference→closing 顺序；含 reference 才带 hint，同 PR 多事件 hint 取 OR。观察成功/部分结果增加 `coverage.native_reference`、`coverage.native_closing`，各有 complete/partial/unavailable、stale、observedAt；masked/unread 顶层不携带 coverage。总体 complete 仅两流均 complete。

执行上下文：检出 `feature/pull-request-issue-link` 的工作树根（仓库内 `.worktrees/pull-request-issue-link-20261107`）。采用仓库 Node >=22 与 pnpm 10.28.2；用 `pnpm install --frozen-lockfile` 满足依赖，不擅改 lockfile。
本叶独立以main为base；创建叶用本叶已验证head为base，PR diff及<800按直接base算，最终整合检查覆盖两者。保留旧方法名不表示旧关系格式双读兼容；未发布契约一次更新全部消费者。
若实现新增公共 capability 或 wire 字段，生产路径与 strict validator 同时调整；不允许仅改 fixture 让 UI 有数据。

## Outcomes & Retrospective

2026-11-07 SGT：原计划阶段仅完成 spec/plan，未实现源码或运行模型。Superseded by 本节后续实现结果（2026-11-07）。

2026-11-07 SGT 实现结果：在 `feature/pull-request-issue-link` 工作树根完成六文件红绿、typecheck、boundaries 与 workflow 检查。真实只读 GitHub query 再次确认 #545 timeline 一页包含 #555 PullRequest→Issue545/false 与应过滤的 Issue source；无外部写入。发布扫描与严格体量以提交后 `node scripts/rule-checks.mjs disclosure origin/main`、`size origin/main` 及 numstat 回读为准。独立评审、当前 head hosted checks、PR 最终 push/readback 与真实 Desktop 人类验收由主控继续；本叶不声称已接受。
#544是明确既有scope ownership，不在本叶记已交付。命名中closing与实际union不一致可在后续统一命名，但本轮不为美观机械改全仓。
Superseded by 2026-11-07 工程归档：#562 原生观察叶已独立验收并归档；持久快照 #544、实际安装/父项 #556/#460 继续开放，不能从本叶归档推导为已接受。

最终远端状态是易失事实：在本分支根运行 `gh pr view 564 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup`、`gh pr checks 564 -R SingularityKChen/harness-projects` 并完整回读 review threads，期望 head 与本地一致、base=main、closing 关联存在、必需 checks 通过后才 Ready。F1 已知拒读 cohort 下 partial 回执泄露已由原评审者生产探针 6/6 及 82 项回归复评 ADDRESSED，未发现修复新增 P0/P1/P2。


### REL-564-F1 · P3 判别测试补强（2026-11-07）

修复上下文：检出 `feature/pull-request-issue-link`、起点 `a96522978f377fe29849652b32db67e61b47250c`，在工作树 `.worktrees/pull-request-issue-link-20261107` 根运行。人类授权范围由评审协调者交付：只补 strict reader 测试和本修复记录，不改正确的生产守卫、不提交/推送、不写 GitHub。
补入两个独立拒绝用例：顶层 complete 且 reference 流 unavailable/stale；顶层 partial 且两流均 complete/current。两者 DTO 其余字段均合法，顶层 partial 的 stale=true 避免由另一守卫代为拒绝。既有真实合法 partial 正例保持不变。
初审 `564-mutations.log` 的 R4= SURVIVED 是修复前事实；Superseded by 本段最终变异结果（2026-11-07）。最终树整表执行一次：

```sh
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/564-mutations.json
pnpm test:file tests/contract/planning-issue-references.test.js tests/contract/planning-issue-closing-links.test.js tests/contract/issue-closing-links-reader.test.js tests/contract/ui-issue-closing-links.test.js tests/integration/issue-closing-links-scope.test.js tests/integration/harness-plugin-issue-closing-links.test.js
pnpm run typecheck
```

实际结果：变异 exit 0、R1–R4 **4/4 KILLED**，每项均有指定 `killedBy` 归因，baseline/还原后 baseline 通过；R4 的失败名精确包含两个新增拒绝用例，没有靠其他异常杀死。六文件窄回归 **84/84**（零失败/跳过），typecheck exit 0。运行态日志为主评审目录 `.superpowers/pr559-565-review-20261107/564-p3-{mutations,narrow,typecheck}.log`。
`git diff --exit-code HEAD -- packages` exit 0，生产文件与修复前一致。当前仅测试文件和修复文档有变更，未动索引；不以此宣称 live 平台、Desktop 或人类接受。补测实现完成，等待原 relation reviewer 独立 scoped 复评；原初审结论和真实 SURVIVED 证据保留。

### CI 随机内部身份误报修复（2026-11-07，Refs #558）

整合基线 head `32872b17e415a00286f82348dbc8fc06039a927e` 的托管 Verify run `42344975573` 暴露 `source-number-restart` 断言误报：合法 opaque EntityId 偶含 449，整段 JSON 的裸数字正则将它误认作原生号泄漏；实际 content 已 redacted。此为 #561 基线的测试判定缺陷，在 #564 做最小整合门修复，Refs #558，不扩大原生关系能力或修改生产实现。
在 `.worktrees/pull-request-issue-link-20261107`、检出 `feature/pull-request-issue-link` 的工作树根，先仅用既有 `ids` 依赖注入含 449/450 的固定 UUID，旧断言稳定 **3 pass /1 fail**。同根因覆盖单 hidden、撤权 store 与不可用视图三处；最终按 redacted content/row 允许形状、内部路由身份不变和已授权可读搜索数为0判定，剩余文本门只识别已知完整仓库/来源标识、metadata 字段或 native number 字段，不再扫描裸数字。

```sh
pnpm test:file tests/integration/source-number-restart.test.js
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/564-number-id-leak-controls.json
pnpm run typecheck
```

修复后 **4/4**，typecheck exit 0。负控对实际断言入口注入 sourceNumber、repositoryName、native number、redacted row numberLabel、searchHint 与完整来源标签；六项均由该生产链用例 **6/6 归因 KILLED**，baseline/还原后 baseline 通过。负控只改测试内观察快照，夹具逐字节还原，没有改生产代码。保留原 redaction/撤权门，未靠 rerun 或屏蔽测试规避失败。
运行态证据为主评审目录 `.superpowers/pr559-565-review-20261107/564-number-id-{ci-red,ci-green,leak-controls,typecheck}.log`。仅改此集成测试及本修复记录，不改索引、不 commit/push/GitHub 写入；交原 relation reviewer 独立复评后由协调者绑定新 head/托管门，本地结果不是安装或人类接受。

## Bottom Change Note

2026-11-07 SGT：综合 A/B 与真实源码，冻结最小纵向闭环、判别测试、owner 边界和恢复门；修正不存在的路径与未发布兼容负担。

2026-11-07 SGT：补 Batch 1/2 红绿、冻结 wire 契约与 reference 安全矩阵发现；source 恢复仅在双流 complete 时解除已知拒读，保留 #544 与真实 Desktop 接受边界。

2026-11-07 SGT：最终权限复核 deadline 红测确认 top partial 不得携带双流 complete 的矛盾覆盖；全局失败将已完成覆盖降为 partial，strict client 与 Host 语义一致，日志见 `relations-final-fence-red.log`。

2026-11-07 SGT 独立评审 F1（P1）：`449c484b` 的 closing 成功/reference offline 可在尚未恢复的 source authority cohort 中缓存 metadata partial；另一 Issue 重复相同403不增 epoch，旧回执仍可见。此前双流 complete 才清 cohort 的处理仅保证版本稳定，未禁止该 cohort 签发新事实。Superseded by 本段修复：refresh 签发和 get 复用均检查相关未恢复 source authority/resource、关联目标 authority/repository resource，未恢复则遮蔽；不通过重复增 epoch 制造刷新循环。完整 actual 双流证明仍是来源恢复条件，正常首次 partial 正证据保留。

F1 验证在本分支工作树根重复 Batch 2 六文件命令，82/82 pass；`relations-f1-red.log` 保存生产 Host + strict client 在旧实现对403/NOT_FOUND和镜像流的metadata断言失败，`relations-f1-green.log` 保存修复后完整六文件结果。`pnpm run typecheck`、`pnpm run boundaries` 结果见 `relations-f1-typecheck.log`、`relations-f1-boundaries.log`。同资源重复负证版本稳定；不同 Issue 的 NOT_FOUND 属于不同资源，可递增一次，不能将该新资源误当同cohort。恢复前查询无links，双流actual complete恢复后可见。修复前锚点为 `backup/relations-before-f1-20261107`；未发布实现整理为单commit，已发布plan不改写，等待原reviewer scoped复核。

2026-11-07 SGT：主控补入独立完整审读、scoped 修复复评和最终实时回读门；真实安装接受继续单列。

2026-11-07 SGT：托管 Browser CI 修复按 Global Constraints 扩展两份直接测试文件；旧3用例完成态超时及新增refs-only正控先红，补当前双流fixture后目标文件5/5通过。执行命令为本分支工作树根 `pnpm test:file tests/browser/native-link-detail.test.js`，日志见 `relations-browser-ci-red.log`、`relations-browser-refs-red.log`、`relations-browser-ci-green.log`。六文件82/82回归与typecheck仍通过，见 `relations-browser-ci-regression.log`、`relations-browser-ci-typecheck.log`。完整 `pnpm test:browser` 56/56通过（0 failed/cancelled/skipped），见 `relations-browser-ci-layer.log`；托管新head尚未推送验证；这不是Desktop人类验收。恢复锚点 `backup/relations-before-browser-ci-20261107` 指向6bd2ae48，修复新增提交，不改写已推送历史。

2026-11-07 SGT 独立 CI 修复复审：锁定 `b236ef4d61c742f83ba82ee244dfabfe0382161c`，reviewer 直接比较已发布实现 `6bd2ae48` 后的测试改动，独立复现旧 HTTP fixture 的 truthful partial 与 Chromium 超时，再验证当前 provider/browser 7/7 通过。没有新增 P0/P1/P2；核心权限、双流覆盖与迟到响应语义保持。报告为执行态证据 `.superpowers/iteration-20261107/review-native-ci-fix.md`；正式人类接受仍未执行。主控只补本回执，源码与该 reviewed head 相同；托管检查绑定最终 push head 另行回读。

- 2026-11-07：完成 REL-564-F1 两类矛盾 coverage 负例与4/4归因变异补强；记录84项窄回归、typecheck及生产守卫未变，交原评审者独立复评。

- 2026-11-07 SGT：工程计划归档，P3补强经84相关回归、独立reader5例及4/4归因变异复评通过；最终真实main接合和当前head门禁单独回读。

- 2026-11-07：修复整合 Verify 暴露的裸数字误判，固定含原生号数字的内部UUID并保留6项真泄漏负控；Refs #558，工程能力范围不变。

- 2026-11-07 SGT：托管 Verify 的继承基线编号测试误报经确定性内部 UUID 复现、最小语义断言修复和原评审者独立复评通过；4/4相关用例、6/6真泄漏负控，生产无变化。最终新head托管检查仍逐次回读。
