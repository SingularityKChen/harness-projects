# 统一只读工作项详情 ExecPlan

> 状态：Active；当前交付为 spec + plan，产品尚未实施。
> 创建：2026-10-05 CST（Asia/Shanghai）。维护遵循根目录 `PLANS.md`。
> 关联：#130；Batch P 为本次计划交付，Batch D 为后续完整能力实现。

## Purpose / Big Picture

用户从工作项列表打开条目，或直接访问 `/projects/:projectId/items/:itemId`，看到同一个只读详情抽屉：规划标题、正文、状态、来源身份、权威归属与新鲜度。断线时仍可辨认最后已知值，派生提示明确标注，不能修改规划事实。

最小成功证据是实际浏览器中列表点击与直接深链驱动同一个组件，能关闭、恢复焦点、使用 Back/Forward；真实客户端读取链断线后保留内容及时间并显示陈旧状态。browser fixture 是本能力的交互证据，真实 Harness/Host 挂载仍由 #229 交付，不能用组件、解析器或 SSR 的存在宣称产品已接通。

## Context and Orientation

本项紧急在于 #129/#178 已交付安全列表和读取生产链，下一迭代可立即验证第 5 步的用户反馈；重要性是两个入口共享权限、规划权威和陈旧标记。当前不依赖 #133 新字段，适合并行交付。 选题按 Project 10 的近期时间盒、P0、前置就绪和闭环贡献判断，不用虚构评分；#221 的交付事实修复、#228 的宿主服务及 #140 的会话适配保留为后续独立精化，不与本项聚合。

本次调查在 `feature/work-item-detail` 工作树根完成。2026-10-05 CST 观察基线 `ed6b9ae`，产品代码与 `c38b0b5` 一致；实施前用 `git rev-parse HEAD`、`git diff origin/main...HEAD -- packages apps tests` 重新核对。选题依据为 2026-10-04 的 Project 10 观察：#130 属于 2026-10-15 至 2026-10-21 迭代、P0、M、M4；这些是历史选择依据，当前值以 `gh issue view 130 -R SingularityKChen/harness-projects --json state,body,projectItems` 回读为准。

已核实的代码事实：`packages/client/src/sync.ts` 的 `WorkspaceSync.read()` 是展示读取生产者；断线保留 store 与接收时间。`packages/ui-model/src/derive.ts` 已提供 `deriveWorkItemDetail`，但其结果含 actions、lineage，且 redacted 仍可能含 status/derived/authority，不能直接交 renderer。`packages/ui-model/src/work-item-list-view.ts` 的 `deriveWorkItemListView` 是既有权限、能力与授权缓存展示门，安全行已归约状态文案、来源与逐行新鲜度。`packages/ui/src/work-item-list.ts` 当前只渲染静态表格；`apps/web/src/index.ts` 只有包标识，没有路由运行器。

术语：safe view 是已删除不可见字段、专供绘制的展示对象；redacted 表示内容不可见，不推断删除或撤权；unresolved 表示当前快照未确认目标存在性。`projectId` 是 `read.workspace.id` 的内部工作区 ID，`itemId` 是内部 entityId，均不是 GitHub Project ID、Issue number 或 externalId。

上游验收记录是 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md`（#129）与 `docs/exec-plan/completed/2026-10-03-workspace-read-assembly.md`（#178）。#129 已交付安全列表；#133 将丰富 Provider 字段读取，本轮详情只展示现有 wire 字段，不伪造 iteration/date。

## Design / Spec

第一性分析：用户需要知道“哪项、谁的值、是否当前、哪些只是派生提示”；新增缓存或第二读取通道不能改善这些判据。系统综合的主要矛盾是两种入口须共享安全规则，而真实 Host 壳尚未挂载；因此把读取权威留在 client、可见性归 ui-model、绘制归 ui、URL 归 apps/web，以真实 fixture 验证组合。

| 独立候选 | 可取点 | 最终评审与修订理由 |
|---|---|---|
| A：原生 modal dialog、安全目标投影、薄 route codec | scope 先检查；隐藏 bindingId；充分定义焦点和原生模态生命周期 | 采纳。纯 codec 不足以兑现深链，必须补 B 的实际 History adapter；missing 的 confirmed 布尔没有存在性证据，删除该字段 |
| B：应用层 History adapter、原生 anchor、组合页与安全投影 | 初始 URL、push/replace/popstate/dispose 可实际运行；明确 fixture 与 Host 区别 | 采纳。补上 A 的跨工作区先行拒绝；不显示内部 bindingId；统一列表路径为 `/projects/:projectId/items` |
| 宽屏非模态 aside + 窄屏独立页 | 适合连续比较多项 | 本轮不选：引入两套焦点/布局生命周期，超出只读单 drawer 所需 |

不使用 `controller.getEntity` 为深链另建读取路径，不装路由或 UI 框架，不新增 last-good detail cache，不拆分两套 list drawer / route drawer。

原生模态取舍经 [W3C H102](https://www.w3.org/WAI/WCAG22/Techniques/html/H102) 核对：showModal 让浏览器管理焦点进入、背景 inert、焦点限制、Escape 与可用 opener 的回焦。其测试程序要求实际验证键盘打开、入焦、不能到背景、关闭回焦；本计划继承这些行为门，并补路由卸载及 opener 消失时的回焦。该技巧提供设计依据，不等于本组件已满足无障碍验收。

### 唯一安全详情投影

精确接口在 `Interfaces and Dependencies`。执行次序固定为：目标工作区匹配检查 → `deriveWorkItemListView(input)` → loading/unavailable → 按 itemId 查安全行 → unresolved/redacted → `deriveWorkItemDetail(read,itemId)` → 白名单 content。scope 不匹配返回无标识的 unresolved，且不访问 `store.list/get`；不回显路由 ID 或旧工作区名称。任何阻断态禁止调用详情 getter。可见行与详情读取间目标消失时抛 `TypeError` 暴露接线缺陷，绝不回填旧 view；Host 单帧原子性风险另有 TD-024。

content 的 title、planningStatus、source、authority、stale 直接取对应安全行；正文取详情规划 body，空值显示“正文未提供”，标题沿用“标题未提供”。derived 非空时复用安全行 engineering 的完整字符串，前缀“派生提示：”；空时“无派生提示”。不复制枚举词表，不把 derived 写回规划状态。

来源只显示当前主内容身份：安全行来源名、身份种类文案与 `primary.externalId`。bindingId 仅供既有映射查名，不出现在文本、属性、tooltip 或链接；无身份显示“来源身份尚未提供”。不查询账号、多身份历史或推测外部 URL。所有文本由 React 转义，正文以纯文本保留换行，不解释 HTML/Markdown。

| 输入 | 输出与判定 |
|---|---|
| pending（未明确阻断） | loading；非空旧 store 也不提前显示 |
| permission_denied / not_supported / unknown，或能力不可读 | 复用列表 unavailable 的安全文案；缓存不可穿透 |
| offline/error 且 snapshot 已到达、cacheVisibility=authorized | 保留旧标题/正文/身份/状态，stale=true；授权未知则 unavailable |
| refreshing、所选行 stale、读门 degraded、连接断开 | 由所选安全行 stale 归约；显示“最后已知值，当前结果尚未确认” |
| 整表 partial，所选行 fresh，另一行 stale | 所选详情保持 fresh；不能 OR 整表 stale |
| 缺项、跨工作区、坏路由 | “当前快照未找到此条目，是否存在尚未确认”；不显示 404、已删除或确认不存在 |
| redacted，包括上游误带敏感字段 | 仅“内容不可见”和关闭；safe view 不含目标 ID、正文、状态、派生、身份、权威、时间、reason |

时间标签固定为“工作区最后接收确认帧”，未提供则“读取时间未知”；不是 Provider 更新时间，也不是所选项独立确认时间。原始 reason 不进 DOM；只能使用列表安全失败说明。每次读取或权限变动重投影；正在打开的 drawer 即时清除旧内容，不因 view 更新关闭重开。

### 导航与浏览器交互

唯一路由为列表 `/projects/:projectId/items` 与详情 `/projects/:projectId/items/:itemId`。编码逐段使用 encodeURIComponent；解析精确段数，拒绝空段、畸形编码、解码后的 slash/control 字符、多余路径，不反射错误 URL。query/hash 不作为目标，导航生成 canonical pathname。

History adapter 创建时立即发布当前 pathname 的解析结果；普通 anchor 点击阻止默认行为后 push 详情，同目标不重复 push；修饰键/中键保留真实 href。close 用 replace 回对应列表路径，绝不调用 history.back，避免直接深链离开应用。Back/Forward 的 popstate 重新发布 selection；dispose 可重复、释放监听且不再触发回调。未知路由发布 undefined，由挂载者显示中性 unresolved，不绑定当前 store。

`WorkItemListPage` 增加可选 navigation 对象，只有安全 item 行标题生成 anchor；redacted 无 href/callback。`WorkItemProjectPage` 只组合列表与唯一 `WorkItemDetailDrawer`，不持 store 或业务缓存。原生 `<dialog>` 挂载时 showModal，标题 tabindex=-1 并初始聚焦；稳定 aria-labelledby、可见“关闭详情”按钮、Tab 留在模态、Escape 的 cancel 先 preventDefault 再调用一次 onClose。cleanup close 不触发第二次导航。320/768/1200 宽度同一实现，右侧最大 38rem、窄屏全宽、正文可滚动和换行。

组合页记录打开前的元素用于回焦，仅在关闭后元素仍连接且仍属于当前列表时恢复；直接深链、opener 被移除或 scope 改变时聚焦当前列表标题。Back 导致关闭同样回焦，Forward 重新打开则焦点进入 dialog。权限撤销或遮蔽只更新内容，不恢复已失效的 anchor。showModal 不可用时交互门失败并报告环境，不增加自制兼容层。

fixture 的 HTTP 服务必须把两个 canonical pathname 都交给同一入口，刷新/初始深链真实可用；入口使用产品 History adapter、详情投影和组合页，不能在测试内重写它们。fixture 提供合成读取、断线、撤权和切 scope 控件。首次 `sync.read()` 为 undefined 时挂载者构造无内容 loading view；不得伪造工作区或能力快照。Host 对读取 phase、授权缓存和 metadata 的观察仍是 #229 的显式接线责任。

## Global Constraints

文件集合只在此声明。当前 Batch P 新建本计划、修改 `docs/README.md` Active 索引唯一行。未来 Batch D 新建 `packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`apps/web/src/item-route.ts`；修改 `packages/ui-model/src/index.ts`、`packages/ui/src/index.ts`、`packages/ui/src/work-item-list.ts`、`apps/web/src/index.ts`；新建 `tests/contract/ui-work-item-detail-view.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/contract/web-item-route.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`、`tests/integration/ui-work-item-detail-read.test.js`、`tests/fixtures/work-item-detail-browser.mjs`。仅实际接受新维护债时扩入 `docs/exec-plan/tech-debt-tracker.md` 并说明原因。

规划预算为代码（含测试、fixture）≤800 行、文档≤1300 行；估算产品 330、契约/集成测试 325、fixture 115，共 770 行。以实际 base 差异新增+删除计算，超过规划预算先收敛设计、保留判别测试；不能自创 fixture/测试排除。正式分类、排除和硬门只采用 `scripts/rule-checks.mjs size` 的结果（仓库门为代码1000/文档1500）。若仍超预算，重新设计可独立验收闭环并更新计划，不把一项拆成不可独立使用的 PR。

Node≥22、pnpm 10.28.2，沿用现有 React/createElement、esbuild；不新增依赖、lockfile 或 manifest 改动。不改 domain、capabilities、core、controller、client、storage、providers；不加编辑、StartWork、工程/交付段或真实 Host 连接。不引入数据迁移或兼容层。外部产品写入为零，凭据为零；Planning 状态和依赖关系均不自动修改。

## Plan of Work

### Batch P · 可审阅设计与草稿交付（本次）

最小闭环是独立对照两稿、核实源码并保存完整 spec/plan；主文件为本计划。核对十三章节、仅 Progress 勾选、相对路径与链接、未来文件标记和验收 pending。运行本节文档门后，由主控整理文档提交、以 main 为 base 建 draft PR，正文 `Closes #130` 声明完整预期交付，同时回读 PR 的 closingIssuesReferences 与 issue 的 closedByPullRequestsReferences 双向关联；产品 pending 不妨碍本轮登记，保持 draft、不合并就不提前关闭 issue。本轮不执行 Batch D。回滚仅撤销本计划及对应索引行，保留其他计划。

### Batch D · 只读详情与真实导航闭环（实施授权后）

这是一个可独立验收、合并和回滚的能力 PR；以下步骤是内部实施顺序，不是四个半成品 PR。每段先新增命名失败测试，确认失败源于缺失行为，再最小实现并跑同一命令转绿；实现与其判别测试同一提交。

1. 主文件 `packages/ui-model/src/work-item-detail-view.ts`：实现 scope→现有门→安全行→白名单投影。新增命名用例 `scope-before-store`（跨 scope 时 list/get 均0次）、`blocked-cache-canary`（三种明确失败及能力阻断下无敏感值）、`redacted-erases-every-field`（连状态/派生/authority 也无）、`selected-fresh-in-partial`（另一行 stale 不改变本行）、`missing-is-unresolved`、`pending-never-shows-cache`；配可见内容正控防止“全部隐藏”空绿。
2. 主文件 `packages/ui/src/work-item-detail.ts`：实现唯一 dialog 与组合页、列表 opt-in anchor。命名用例 `same-drawer-from-both-entries` 断言同一导出组件类型；`readonly-planning-source` 对实际 SSR 断言 title/body/status、来源与 externalId、派生前缀均存在，且无 input/select/textarea、编辑、Saved、StartWork、bindingId；`text-is-escaped` 注入 HTML 字符串断言没有执行标签。旧列表无 navigation 时保持原输出。
3. 主文件 `apps/web/src/item-route.ts`：实现 codec 和实际 History adapter。命名用例 `initial-route-and-popstate`、`canonical-open-close-idempotent`、`invalid-segments-no-echo`、`dispose-stops-listeners` 断言初始发布、每次 popstate、同目标0次重复push、close只有replace、非法输入 undefined、dispose 后0回调；真实浏览器另验修饰键行为，不靠假 port 代替。
4. 主文件 `tests/fixtures/work-item-detail-browser.mjs`：实现同源 HTTP 路径回退与动态 fixture。完整 bundle 测试入口实际调用 adapter→投影→组合页，只外置 React，允许纯 capability key 叶子，禁止 node:* 与 core/controller/client 运行时；vm SSR 必须产生非空 title，负控经 domain 根出口引 node:crypto 必须失败。集成命名用例 `sync-loss-preserves-visible-detail` 经实际 createSync/read、固定时钟与受控 transport 验证断线前后 title/body/status/identity/time deepEqual 且 stale 从 false→true；`sync-source-degraded-retains-content` 注入 Provider 降级 metadata 帧，连接保持正常、所选行转 stale 时同样保留内容/时间；`sync-recovery-reprojects` 验证新帧恢复而非沿用缓存。
5. 运行完整 D 命令和实际浏览器矩阵，记录成功/失败及运行上下文。只在验收全通过后整理提交、执行发布检查、push 回读、回复评审；由人类决定合并。回滚 D 的整个实现/测试提交集合，移除导出与列表 opt-in 即恢复既有列表；无数据变更。

所有命令在检出 `feature/work-item-detail` 的工作树根执行；首次依赖准备为 `pnpm install --frozen-lockfile`，期望 exit 0，不修改锁文件。文档阶段不冒称执行尚未新建的产品测试。

```bash
# Batch P / D 发布前文档与差异门
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
# Batch D：新文件完成后运行，失败必须定位再继续
node --test tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-detail-browser.test.js
node --test tests/integration/ui-work-item-detail-read.test.js
node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js
pnpm typecheck
pnpm boundaries
node tests/fixtures/work-item-detail-browser.mjs
```

各测试命令期望非零用例、fail=0、无跳过；typecheck/boundaries/机械门 exit 0。fixture 期望打印本地可访问地址并持续服务，浏览器访问 `/projects/ws-1/items` 和 `/projects/ws-1/items/ent-aa`，完成矩阵后停止进程。该命令与服务是将新建的实现，当前不能执行。发布扫描对未提交新文件不构成覆盖证明；提交前人工检查全部新增文档与五类发布风险，提交后再跑正式门。

## Validation and Acceptance

| 验收 | 决定性证据 | 当前状态 |
|---|---|---|
| 列表和深链同一 drawer | `same-drawer-from-both-entries` + 浏览器初始 URL、点击、刷新同一内容 | pending |
| 权限/遮蔽/跨 scope 不泄漏 | canary 覆盖 title/body/id/status/derived/authority/identity/reason；投影与 SSR 正负控；打开中撤权后 DOM 即时清空 | pending |
| 授权离线缓存、逐行新鲜度、未知缺项 | 真实 sync/read 集成、固定时间、partial 对照和 unresolved 文案 | pending |
| 只读规划与来源、派生不改状态 | todo 与 merged 提示同时存在；deepEqual 输入状态；无写控件及编辑动作 | pending |
| 原生模态和导航 | 320/768/1200 实际 DOM：Enter打开、焦点入标题、Tab循环、Escape/按钮单次关闭、回焦；Back关闭/Forward打开；direct URL无opener回标题 | pending |
| 路由与生命周期 | malformed、跨scope、快速切项/撤权、重复open/close/dispose、初始路径HTTP可达；修改键保留href | pending |
| 浏览器安全与回归 | 实际完整bundle、SSR正控、node:crypto负控、既有列表回归、typecheck/boundaries | pending |
| 预算与发布 | 正式size输出与≤800/≤1300规划预算核对、disclosure、人工五类检查、远端当前head回读 | pending |

最高风险五项分别是权限变化残留、partial误降级、首次深链无读取、原生dialog重复生命周期、scope切换后的错误回焦；均在上述命名测试或真实 DOM 行中有明确判据。SSR 不证明焦点/历史，bundle 不证明 Host 挂载，fixture 不证明 #229 完成。

## Progress

- [x] 2026-10-05 CST：读取 AGENTS/PLANS、两个独立设计和当前源码，完成边界、备选方案、接口和验收收敛。
- [x] 2026-10-05 CST：新建正式计划并加入 Active 索引；仅文档修改，产品未实施。
- [x] 2026-10-05 CST：重新读取落盘文件独立自查；十三章节顺序、Progress、可移植引用、预算与本地链接检查通过，`git diff --check` exit 0。
- [x] (2026-10-05 CST) 管理登记回执：已创建 [draft PR #269](https://github.com/SingularityKChen/harness-projects/pull/269)，核对双向 issue 引用及 Project 计划字段；产品实施仍 pending。
- [ ] Batch D：实施安全投影、统一 drawer、History adapter 和真实 fixture。
- [ ] Batch D：完成全部产品验收、独立评审与发布回读；人类授权后才合并。

## Surprises & Discoveries

2026-10-05 CST，`feature/work-item-detail` 源码调查：`derive.ts` 的 redacted 只清 title/body/primary，保留其他字段；因此直接渲染旧详情类型不安全。`work-item-list-view.ts` 明确按行计算 stale，整表 partial 不能替代 selected-row freshness。`sync.ts` 的 lose 只断连接并标陈旧，内容/时间已有保值机制，不需新增详情缓存。

同次调查：`apps/web/src/index.ts` 无 router/mount；现有 `tests/contract/ui-work-item-list-browser.test.js` 仅 bundle+vm+SSR，不能证明 dialog 焦点或导航。独立设计 A 的产品 route 导出仅 codec，导航逻辑留在 fixture；最终将其提升为 B 的实际 adapter，再与 A 的完整 fixture 组合，避免验收只证明测试内导航。本次未运行产品测试，已有其他设计者的测试回执不计为本计划产品验收。

## Decision Log

2026-10-05 CST / 独立最终评审者：选择原生 modal dialog + 唯一安全投影 + apps/web History adapter。理由是两入口共享权限与绘制，浏览器承担模态机制，实际导航可测且不扩大到 Host 装配。

2026-10-05 CST / 独立最终评审者：统一列表路径、隐藏 bindingId、删除 missing.confirmed、时间改为工作区确认帧；A/B 分歧按真实源码契约收敛。没有证据支持确认404、对象级更新时间或展示内部连接标识。

2026-10-05 CST / 独立最终评审者：#126/#130/#133 语义并行；共享文件由单 owner 串行整合，不能把可并行能力硬串为 stack。未批准任何 Status、blocked-by 或 blocking 写入；本次边界为 Batch P。

2026-10-05 CST / 主控：Actor 为 SingularityKChen；管理目标是 GitHub 仓库 SingularityKChen/harness-projects 与 Project 10，不虚构产品内 ProviderBinding。幂等标识为 `plan/issue-130/feature/work-item-detail`，字段赋值以 issue/字段名去重；创建结果为 PR #269。观察时刻 @ d09a29c880e6：base=main、draft=true，PR closingIssuesReferences 包含 #130、issue closedByPullRequestsReferences 包含 #269，无评审线程，标题/标签/issue policy 检查通过。Project ExecPlan/Batch 已回读匹配，Kind/Area/M4 已具备；Status=Todo、Priority=P0、Size=M、Iteration 5 及依赖关系保持原值。易失结果用 `gh pr view 269 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 和 `gh issue view 130 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences,projectItems` 复读；最终文档 push 后再次回读当前 head/checks。

## Idempotence and Recovery

纯投影重复计算无副作用，不保存可见正文；收到新 read 立即重新归约。showModal 只在未打开时调用，view 变化不重置焦点；dispose/cleanup 重复安全且不导航。scope 不匹配先拒绝内容，禁止用旧工作区填补新目标。

命令可重复运行；测试/fixture 使用合成数据，不写真实 Provider。依赖安装失败先恢复可复现依赖环境再验证，不能把缺包归因产品。组件生命周期或预算不成立时停在 D 验收门修订，不发布“已完成”。回滚按对应批次撤销任务提交，不删除用户 worktree/数据库；归档后如恢复工作，计划移回 active 并记录原因。

## Interfaces and Dependencies

新接口均 readonly。ui-model：`WorkItemDetailTarget = { readonly projectId: string; readonly itemId: string }`；`deriveWorkItemDetailView(input: WorkItemListReadInput, target: WorkItemDetailTarget): WorkItemDetailView`。View 只有 `body` 联合：`{kind:'loading'}`、`{kind:'unavailable';message:string;remaining:string}`、`{kind:'unresolved'}`、`{kind:'redacted'}`、content。content 精确字段为 `kind:'content'`、`title/body/planningStatus/source/authority: string`、`identity?: {readonly kind:string;readonly externalId:string}`、`derived?: string`、`stale/refreshing: boolean`、`lastUpdatedAt?: string`，不带原始业务对象。

UI：`WorkItemDetailDrawer({view,onClose}: {view:WorkItemDetailView;onClose:()=>void}):ReactElement`；`WorkItemProjectPage({listView,detailView,navigation,onCloseDetail})` 参数分别为 `WorkItemListView`、`WorkItemDetailView|undefined`、`ItemNavigation|undefined`、`()=>void`。`ItemNavigation = { readonly href:(itemId:string)=>string; readonly open:(itemId:string)=>void }` 是 UI 无状态回调契约；`WorkItemListPage({view,navigation?})` 消费同一契约。组合页持 DOM ref 回焦，不持业务缓存。

apps/web：`ItemRoute = {readonly projectId:string;readonly itemId?:string}`；`parseItemRoute(pathname:string):ItemRoute|undefined`；`itemPath(route:ItemRoute):string`；`HistoryPort = {pathname:()=>string;push:(path:string)=>void;replace:(path:string)=>void;subscribe:(listener:()=>void)=>()=>void}`；`createItemNavigation(port:HistoryPort,onRoute:(route:ItemRoute|undefined)=>void):{open:(target:WorkItemDetailTarget)=>void;close:(projectId:string)=>void;dispose:()=>void}`。浏览器 port 把 pathname/history.pushState/history.replaceState/popstate 映射到这四项，构造函数即时发布初始 route。壳与 fixture 将 route、同scope输入投影和 UI callback 接起来；ui 不 import apps，Harness 不 import apps/web。

#126 的账号/绑定持久化与本轮读取无依赖；#133 的 Provider 字段读取不被本轮消费，故各自基于 main。共享 `packages/ui/src/work-item-list.ts`、ui/ui-model barrel、`docs/README.md` 与可能的 tracker 必须由整合 owner 串行合入，不能多人同时编辑。后续存在真实接口前后关系的 #126→#132、#221→#222 才适合 stack；是否建栈、base 和每层验收在后续任务重新锁定，不创建规划阻塞边来表达合并顺序。

外部回读由主控使用 `gh pr view feature/work-item-detail -R SingularityKChen/harness-projects --json url,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks feature/work-item-detail -R SingularityKChen/harness-projects`，并分页读取 reviewThreads；预期当前 head/base、draft、#130关联及检查/线程均真实记录。只保留 plan 阶段 draft，不执行 ready/merge。技术债沿用 `docs/exec-plan/tech-debt-tracker.md`：TD-024 已归 #218，TD-025 文案归 #229，TD-026 时间校验重复本轮不触及；不新增没有承接者的“以后修”。

## Outcomes & Retrospective

2026-10-05 CST：完成一份可审阅 spec/plan 与索引，产品验收全部 pending。首要遗留是 D 的实际浏览器导航/模态证据及真实 sync/read 保值集成；#229 Host 挂载是明确后续能力。落盘后二次自查结论 Pass：结果具体、入口与命令可定位、主要验收有证据、模态未知受真实浏览器门约束、恢复/债务/取舍/仓库约定完整；章节/链接/可移植性机械检查和 `git diff --check` 通过。主控仍须执行提交后的正式发布门与远端回读，当前不是产品完成或 PR 发布回执。

## Bottom Change Note

2026-10-05 CST：首次创建；独立综合两种设计并核对当前源码，补全实际 History 导航、唯一安全门、scope/redaction/missing/freshness、浏览器焦点验收、预算与并行/整合边界。修改范围见 Global Constraints。

2026-10-05 CST：落盘后二次自查，修正 Active 表行位置与 A 方案描述，补 Provider 降级 metadata 的保值用例，记录实际文档检查；产品验收维持 pending。

2026-10-05 CST：按主控确认补入本轮 draft 的双向关闭关联要求；增加已核对的 W3C H102 官方设计依据，不将其当作组件验收回执。

2026-10-05 CST：主控补选题依据、实际 draft PR/双向引用与 Project 回读结果，完成本轮管理登记；所有产品验收保留 pending，未改规划状态或依赖边。
