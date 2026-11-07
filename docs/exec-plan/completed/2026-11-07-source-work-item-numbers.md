# 外部工作项号码的来源明确展示与搜索 ExecPlan

> 状态：Completed（工程切片；安装与父项接受另计）
> 创建：2026-11-07
> 范围：Closes #558；Refs #537；最小工程闭环与人工接受分列
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`

## Purpose / Big Picture

用户在已加载且授权可见的行中输入 449 或 #449 找到原生号，在默认列表和详情读到同一个来源及仓库限定编号。号码经过生产 Provider、Core、SQLite reopen、wire 与 UI，不解析 opaque ID。外部叶交付不关闭仍要求本地编号的 #537。

## Context and Orientation

GitHub PlanningItems 查询当前取 number 但不取 repository；decoder 将 Issue number 只放 observation.fields，ProviderWorkItemContent 与 WorkItemContent 不保留。PR 的 domain number 也未穿过 Core ContentReference/controller wire。
SQLite projection 是显式 content_number 列（`storage.ts`、`storage-rows.ts`），不是 JSON 全对象；只改 TypeScript 会 reopen 丢数据。Core `projection.ts:contentReference`、controller `wire.ts`、ui-model `derive.ts` 是后续断点。
列表 identity 列默认隐藏，搜索 `local-table-view.ts` 只看 title；所以只增加隐藏列不满足用户操作。Draft 无原生号码，Local Planning 未有稳定 allocator。

## Design / Spec

继承 A 的外部号码纵向叶与 B 的完整来源元数据；拒绝 UI 拼 URL、row index、截 opaque ID、仅内存缓存。定义可选 `sourceNumber:{sourceName,scopeIdentity:{namespace,id},scopeName,number}`；number 正 safe integer，scopeName 为 Provider 回证 repository nameWithOwner，scopeIdentity 为 native repository identity，sourceName 由 Provider 固定。字段不作为 EntityId 或关系键。
GitHub 同一可见 Issue/PR 对象取 number 与 repository{id,nameWithOwner}，Provider→bootstrap→domain→SQLite→ContentReference→wire→client strict boundary→ui-model 全链路保留。PR 已有 number 与 sourceNumber.number 须一致，不双重猜测。未知来源/无号不给字段，Draft 诚实显示暂无原生编号。
正式 schema 在当前未发布基线直接添加一列安全 source-number JSON（或相同语义显式列）；decoder 严格白名单，redacted 写入时清空，rowToContent 仅对可见内容恢复。不引入 008 legacy migration、旧库迁移兼容测试或双读。验收使用新建库及同格式 reopen；实际旧用户库不改。
ui-model 一个 formatter 产生 `GitHub owner/repo#449`，列表标题附近默认可见，详情使用同函数；source 信息始终限定，不因当前暂时无重号简写。安全 item row 才有 number/search terms，redacted 结构没有这些字段。
449 对 native number 精确匹配，同时保留原有 title 包含搜索（包括数字标题）；#449 显式只匹配 native number，不能误中 1449 或标题。完整来源限定 token 先独立分流，再按 NFC、大小写与首尾空白归一后精确匹配 numberLabel；不存在的 token 也不得回退到标题。搜索工具栏明确显示“搜索标题或编号”。跨 repository/source 同号均保留匹配项并显示区分，计数不纳隐藏行。排序、刷新不能改变号。
Draft→Issue promotion 沿既有 EntityId，新增原生号，不新建实体。父 #537 保留本地方案：workspace scope 的单调正整数，唯一(workspace,entity)和(workspace,number)，counter/mapping 同事务；幂等重放不耗新号、并发不同号、重启/备份重放稳定、删除不复用、promotion 保留别名。该方案本轮不实现，需独立叶与判别测试，不宣称 local 完成。

## Global Constraints

唯一 owner 文件集：`packages/capabilities/src/planning-provider.ts` 内容元数据段、`packages/domain/src/entities.ts`、`browser-values.ts`、`packages/providers/planning-github-projects/src/queries.ts` 的 PlanningItems 段、`decode.ts`、`packages/core/src/bootstrap.ts`、`projection.ts`、`packages/storage/sqlite/migrations/002_identity_membership.sql` 中 projection schema、`packages/storage/sqlite/src/storage.ts`、`storage-rows.ts`、`storage-sync.ts` 的既有形状门、`packages/controller/src/wire.ts`、`packages/client/src/store.ts`（仅有实际 strict boundary 需要时）、`packages/ui-model/src/types.ts`、`derive.ts`、`work-item-list-view.ts`、`work-item-detail-view.ts`、`local-table-view.ts`、新增 `source-number.ts`、`packages/ui/src/work-item-list.ts`、`work-item-detail.ts`、`table-controls.ts`；本计划与 tests。
测试集合：现有 planning-github-projects-contract、storage-contract、ui-work-item-list-view、ui-work-item-detail-view、ui-local-table-view、ui-work-item-list-browser；新增 `tests/integration/source-number-restart.test.js`、`tests/browser/source-numbers.test.js`；同步 `tests/contract/planning-github-projects-mapping.test.js`、`ui-model-presentation.test.js`、`ui-table-controls.test.js`、GitHub `project-a.json` 录制及 `tests/integration/identity-membership-{schema,enums}.test.js` 显式列插入；浏览器 fixture 为 `tests/fixtures/workspace-frame-browser.mjs`，原查询消费者为 `tests/browser/table-query.test.js`。schema owning 表已核验位于 `002_identity_membership.sql`；不追加旧库迁移。不改 #556 issue target port、native links 语义或共享 README。

单 owner 修改本闭环；同一共享文件不同语义段仍先由主控协调接口。每 PR code/test/config 的 additions+deletions 严格小于 800，docs 严格小于 1300；不以净行数替代 changed lines，不删判别测试凑预算。
未发布 MVP 不增加 legacy migration、双读、旧 ABI fallback 或 v1/v2 恢复框架。SQLite schema 如需变化按当前未发布基线直接调整；仅验证新建数据库与本次格式 reopen，不要求旧二进制兼容。
禁止 merge、真实模型启动、修改 Planning Status、blocking/blocked-by、#552 或 `docs/product/demo.md`。不手改原验收数据库，不声称修复历史 unknown，不把 local tests 当 Desktop 接受。
保持单 Planning authority、Host 状态权威、工程轴与规划轴正交、Provider ack/reconcile 规则、权限遮蔽及凭据 handle 边界。源码不引用内部输入或本机绝对路径。

## Plan of Work

### Batch 1 · 生产链路丢号红测与叶子边界

最小闭环：真实 provider/SQLite/wire 失号被测试证明，父 issue 保留。
涉及文件：新增 `tests/integration/source-number-restart.test.js`、`tests/contract/ui-local-table-view.test.js`。
以真实 PlanningItems transport fixture 提供两个 repo 同号、PR、Draft、redacted；bootstrap 落库/reopen 后通过 controller→client→derive 验证默认展示/搜索。先红测断在缺号码或 repo 字段，而非 import。主控已创建英文外部叶 #558，PR Closes #558 + Refs #537；本 owner 不修改 GitHub。
验证：`pnpm test:file tests/integration/source-number-restart.test.js tests/contract/ui-local-table-view.test.js`。预期旧实现新增行为断言红；回滚仅测试。

### Batch 2 · 一条可信号码链与一致展示

最小闭环：来源限定号码穿过所有生产层，reopen、撤权与 promotion 不丢/不泄。
涉及文件：Provider/Domain/Core/SQLite/wire 元数据段与单一 formatter、列表/详情、安全搜索。
实现严格元数据、当前 schema 读写、formatter 与默认标题旁展示；测试跨 repo/source 重号、无号、非法 number、PR 双值冲突、redacted 后 wire/DOM 无号码仓库、promotion EntityId 保持。
验证：`pnpm test:file tests/contract/planning-github-projects-contract.test.js tests/contract/storage-contract.test.js tests/integration/source-number-restart.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-local-table-view.test.js tests/contract/ui-work-item-list-browser.test.js`。预期全部 pass，新格式 reopen 精确保留 sourceNumber，默认展示与搜索一致。回滚只本闭环；不 down-migrate 用户库。

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
| 纵向字段 | production Provider→SQLite reopen→wire→client→列表详情同号同 repo |
| 默认可见/搜索 | 默认标题旁完整号，449/#449 与 qualified token 命中 |
| 跨源重号 | 多 repo 同号可辨，source native metadata 未丢 |
| redaction | wire、row、DOM、search terms 无撤权号码/仓库 |
| promotion | EntityId 不变，无重复行 |
| 父范围 | PR Refs #537，local allocator 未交付并保留设计 |

共用接受门：准确记录红测如何失败、绿测命令与输出、执行分支和时间；scope、permission 与 late response 反例通过；当前 head 的 hosted checks 和人工接受单列，缺失即写未验证。

## Progress

- [x] (2026-11-07 SGT) CodeQL alert 12：隔离红测复现后修为线性扫描；原 N1 浏览器/query 合同加大查询可用性回归 14/14。最终 hosted CodeQL 与安全线程回读仍由主控执行，未在本地宣布 alert resolved 或 Ready。

- [x] (2026-11-07 SGT) 完成 A/B 独立方案核对、真实路径与现有接口调查，形成最终最小 spec。
- [x] (2026-11-07 SGT) Batch 1：8 用例中 4 红，分别点名生产链丢 metadata、unsafe number/repository 未拒绝、client 白名单缺失与号码搜索缺失；原有 4 用例绿。数字标题语义随后依主控裁决修正为保留 title 包含，显式 # 号精确。
- [x] (2026-11-07 SGT) Batch 2：全链路、同格式 reopen、撤权清除、promotion 同 EntityId、PR 双号码冲突、非法 JSON metadata 白名单与默认列表/详情展示完成。相关计划回归 217/217；新判别与浏览器窄回归 10/10；受影响浏览器查询/布局与工具栏回归 13/13。
- [x] (2026-11-07 SGT) 初始交付已 Ready；本轮独立 MMP 审读完成，逐最终 head 的托管门/远端回读按下述命令执行。
- 保留外部门：真实安装与人类验收未执行，归 #537/#460；本工程切片归档不代表外部门通过。

- [x] (2026-11-07 SGT) 独立完整审读与修复 scoped 复评完成。N1 完整来源号码精确分流已由原评审者复评 ADDRESSED，未发现修复新增 P0/P1/P2。

- [x] (2026-11-07 SGT) 托管 CodeQL 正则告警经线性扫描修复；原评审者 scoped 复核通过，无新增 P0/P1/P2。官方扫描状态须在最终 head 再回读，不由本行替代。

## Surprises & Discoveries

2026-11-07 SGT · CodeQL alert 12（`js/polynomial-redos`）核实：N1 的完整限定 token 正则在长空白段上允许重叠消费，导致回溯；原实现 128,000 空格 probe 在独立子进程触发 1.5 秒寿命护栏。新增百万空格普通查询的隔离回归在旧实现触发 5 秒护栏（7 绿 / 1 红），修复后完整输入仍按标题命中，不截断查询。护栏用于包含故障，不断言毫秒速度或增长比。

2026-11-07 SGT，独立评审 N1 发现完整限定 token 仍与标题包含 OR，产生跨来源与无号 Draft 假命中；旧覆盖只有不碰撞的标题，无法证明精确消歧。新增碰撞及未知 token 反例先在旧实现得到 3 红 / 5 绿，修正分流后相关 13 例全绿；原 449 标题包含与 #449 原生精确均保留。

2026-11-07 SGT，在本计划分支工作树根执行 `pnpm test`：初次 3574 中 17 红，均为新增必需 repository 与 source-number 列引起的旧合成/位置插入/字段闭集断言漂移；同步完整新形状后为 3575/3575。未删除安全断言；SQL fixtures 改用显式列清单。
GitHub 历史录制不含 repository。仓库没有专用重录脚本；用当前 `PLANNING_QUERIES` 及原 exchange 的 variables，经已登录 `gh api graphql --input -` 做 6 次只读重录，未读取或打印 token。2026-11-07T03:54:29.352Z 录制的 Project A 仍 9 条；除新增 repository 外，writable 条目的两时间戳已变化。真实录制、query hash 漂移门继续保留；跨 repo 与权限反例使用明确 synthetic transport，未冒充平台实测。
新增 `source_number_json` 要同步现有 `assert002Shape`，否则缺列开发库将晚到 SQL 才报错；此处仅 fail closed，不做旧库迁移。浏览器纯值出口需重导出同一个领域白名单 parser，避免根出口触达 Node crypto。

B 的“SQLite 新可选字段”方向正确，但附带 legacy migration/旧二进制恢复违反本轮未发布约束，裁决直接改当前 schema。只写 JSON 类型不够，现有存储显式列必须同步。

源码观察基线为 2026-11-07 的 `main`；用 argv `git rev-parse HEAD` 与 `git status --short --branch` 重读实际分支状态。测试路径已逐一通过文件枚举核验；标为“新增”的测试应由 Batch 1 创建，不是假称既有用例。

## Decision Log

- Decision：本会话人类点名 #561 并授权无 P0/P1 或仅 P2/P3 时完成修复、独立复评、归档、提交整理、issue 核对与 rebase merge。
  Rationale：独立审读当前 head 无新增发现；#558 工程 AC 已验证，#537/#460 人类及剩余能力单独保留，Planning Status 不改。
  Date/Author：2026-11-07 SGT / 人类伙伴直接条件授权，评审协调者记录。

- Decision：完整限定 token 改为线性扫描：定位最后一个 #、单次检查末尾 ASCII 数字、向前扫描 scope 与分隔边界；扫描指针单调，每字符只会被常数次访问。
  Rationale：移除来源文字与空白的重叠正则回溯，同时保留 N1 分流、unknown token 不回退标题、普通 text/449、#449 与 NFC/case/trim；不新增长度截断、平台特例或身份解析。
  Date/Author：2026-11-07 SGT / CodeQL 外部安全反馈、主控指令，实施 owner 记录。

- Decision：N1 用简单完整展示 token 形状分流（来源文字 + scope#digits），仅比较归一 numberLabel；不按当前 label 是否存在判分支，不解析不透明身份。
  Rationale：阻止标题引用别的号码时伪装成该号码实体，同时未知限定 token 保持零可读命中；普通文本与普通数字继续保留 title 包含。
  Date/Author：2026-11-07 SGT / 独立评审 N1、主控修复指令，实施 owner 记录。

- Decision：普通 449 搜索保留既有 title 包含，显式 #449 只按 native number；默认标题旁永远显示完整来源限定号，搜索文案明确包含编号。
  Rationale：不为新增号码查询破坏原有标题搜索；区分相同号码的 repo/source。
  Date/Author：2026-11-07 SGT / 主控裁决，实施 owner 记录。
- Decision：在见 `Global Constraints` 的最小必需扩展中同步当前 schema 形状门、浏览器纯值出口与现有 fixtures/测试；真实只读重录取代 synthetic augmentation。
  Rationale：完整新形状保持旧安全门的判别力，且重录只有 6 个 exchange，未突破预算；原生事实只能从 Provider 回证。
  Date/Author：2026-11-07 SGT / 主控授权窄扩展，实施 owner 记录。

- Decision：人类明确批准将 #553/#554 提前纳入迭代 9，交付 #554/#553/#537 外部叶/#556 修订范围。
  Rationale：修复已出现的产品回执问题，并完成已点名能力；准入授权不包括 Status 或 blocking 关系修改。
  Date/Author：2026-11-07 SGT / 人类授权，主控转达，综合评审者记录。
- Decision：外部号码建立独立叶；完整来源元数据持久贯通；本地 allocator 留在父 #537。
  Rationale：能够独立验收且不扩大状态权威；cross-repository 同号不能靠 UI 猜测消歧。
  Date/Author：2026-11-07 SGT / 独立综合评审者。

## Idempotence and Recovery

refresh 只提交 Provider 当前可见事实；redaction 清字段。同格式临时库 reopen 可重复；不自动从 observations 或 URL 回填旧行。schema 回退只用于重建测试库；原安装数据库不触碰。

所有读取和窄测试可重复。实施失败保留当前红测、准确失败阶段和已知副作用，不抹掉证据。未提交变更只撤本 owner 文件；数据库验证使用临时 fixture，出现新格式不可读则回到当前基线重建临时库，原用户数据库不动。

## Interfaces and Dependencies

执行上下文：检出 `feature/source-aware-numbers` 的工作树根（仓库内 `.worktrees/source-numbers-20261107`）。采用仓库 Node >=22 与 pnpm 10.28.2；用 `pnpm install --frozen-lockfile` 满足依赖，不擅改 lockfile。
#556 必须通过自己的原生 target port 回证，不反解析本 display 字段；共享 planning-provider.ts 的内容区由本 owner 拥有，native target/link 区由 #556 拥有并先协调签名。
若实现新增公共 capability 或 wire 字段，生产路径与 strict validator 同时调整；不允许仅改 fixture 让 UI 有数据。

## Outcomes & Retrospective

2026-11-07 SGT · CodeQL 安全修正：FIX_BASE 为 `backup/numbers-before-codeql-20261107` 的已推送实现，保留该历史并新增独立安全提交，不 amend。`pnpm test:file tests/contract/ui-local-table-view.test.js tests/browser/source-numbers.test.js tests/browser/table-query.test.js tests/contract/ui-table-controls.test.js` → 14/14、0 fail/skip；`pnpm run typecheck` → exit 0。证据为 `.superpowers/iteration-20261107/numbers-codeql-{red,green,typecheck,probe-before,probe-after}.log`；private probe 只证明有界输入上的观测，线性复杂度依据单调扫描控制流。主控将 push 后回读 CodeQL alert、review thread 与当前 head checks；本地不操作安全线程或宣布外部门已解除。

2026-11-07 SGT · N1 修复：FIX_BASE 为 `backup/numbers-before-n1-20261107` 指向的原实现。先补红测，再运行 `pnpm test:file tests/contract/ui-local-table-view.test.js tests/browser/source-numbers.test.js tests/browser/table-query.test.js tests/contract/ui-table-controls.test.js`，13/13、0 fail/skip；同号、case/NFC/trim、未知 token、Draft 标题引用、#449/native 精确、数字标题和安全计数均覆盖。本轮按主控要求不重复全量；下列 3575 证据属于 N1 前实现，不能冒称本轮全量。当前最终提交由 `git rev-parse HEAD` 回读，独立评审者将作 scoped 复核。

2026-11-07 SGT，在检出 `feature/source-aware-numbers` 的工作树根（见 `Interfaces and Dependencies`）完成实现及本地证据：`pnpm test` 3575/3575、`pnpm run typecheck` exit 0、`pnpm run boundaries` 9/9、`node scripts/workflow-check.mjs` exit 0。`pnpm test:file tests/browser/source-numbers.test.js tests/browser/table-query.test.js tests/browser/table-rq-integration.test.js tests/contract/ui-table-controls.test.js tests/contract/ui-local-table-view.test.js` 13/13；浏览器真实 DOM 验证默认 5 列标题旁号码、同号 repo 消歧、三种搜索及详情一致。截图仅存运行态目录，不进入公开文档。
证据在 `.superpowers/iteration-20261107/numbers-*.log`，含原始红测和初次完整回归失败；无真实模型、无用户数据库改动。主控已建立 draft PR #561（Closes #558 / Refs #537）；本 owner 不执行 GitHub 写入、push、Ready 或 merge。独立复核、最终 head hosted checks、Desktop 安装和人类接受均未由本地测试替代。
本地编号不是隐式技术债结项：#537 继续 OPEN，后续独立 allocator leaf 覆盖分配、重放、并发与恢复；本计划明确未交付，不需为了索引同步修改别人的文档。
Superseded by 本轮工程归档决定（2026-11-07）：本叶 #558 的生产读取、持久重启、权限、安全展示与搜索接受已由独立 MMP 评审验证；本地 allocator、实际安装与人类接受继续在 #537/#460，不能阻止已完成工程计划归档，也不能被归档视为接受。

最终远端状态是易失事实：在本分支根运行 `gh pr view 561 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,statusCheckRollup`、`gh pr checks 561 -R SingularityKChen/harness-projects` 并完整回读 review threads，期望 head 与本地一致、base=main、closing 关联存在、必需 checks 通过后才 Ready。N1 完整来源号码精确分流已由原评审者复评 ADDRESSED，未发现修复新增 P0/P1/P2。

## Bottom Change Note

2026-11-07 SGT：综合 A/B 与真实源码，冻结最小纵向闭环、判别测试、owner 边界和恢复门；修正不存在的路径与未发布兼容负担。

2026-11-07 SGT：主控已创建外部号码子 issue #558，将关联冻结为 Closes #558 / Refs #537，父项本地编号仍保留。

2026-11-07 SGT：实施 owner 补入 Batch 1/2 红绿、真实只读重录、必要字段形状与搜索语义修订、本地全套/浏览器证据；外部接受门继续由主控与人类处理。

2026-11-07 SGT：按独立评审 N1 修正限定 token 与 title OR 的根因，记录先红后绿及不重复全量的证据边界；保留原实现 recovery ref，不改已发布计划提交。

2026-11-07 SGT：主控补入独立完整审读、scoped 修复复评和最终实时回读门；真实安装接受继续单列。

2026-11-07 SGT：核实 CodeQL alert 12 的多项式回溯，补隔离有界红测并用线性扫描修复，记录 14 例 scoped 证据和已推送历史不改写的恢复门。

2026-11-07 SGT：主控记录 CodeQL 修复独立复核与当前 head 官方扫描门；保留此前已推送历史和独立安全修正提交。

- 2026-11-07 SGT：独立 MMP 评审通过；279+48+3 项定向/对抗、9/9 归因变异与组合 3690+8、Browser57 证据见 `docs/review/pr-561-mmp-review.md`。完成工程计划归档，保留实际安装和父项接受。
