# 统一只读工作项详情 ExecPlan

> 状态：Completed（2026-10-07）· 复评处置完成，R3 收尾（推送、回复与回读）在推送时执行、证据在 PR #269。Batch P / D 的历史实现与验收保留；2026-10-07 因 PR #269 review thread `PRRT_kwDOUekeas6pesrq` 重新打开后，人类伙伴 16:12 CST 批准决策门 H1（ADR-0010 Accepted；H2 不建 issue，H3 只记录于本计划），R1 经两轮对抗验证与独立集成验收，R2 交付物级整合并以精确 lease 推送，R3 复评 19:37 CST 在 `f4f5cdc` 上 APPROVED，其 1×P2 + 6×P3 + 1 条 PR 级 P3 按根因处置后归档。合并与否由人类伙伴决定。
> 创建：2026-10-05 CST（Asia/Shanghai）。维护遵循根目录 `PLANS.md`。
> 关联：#130；Batch P 为计划交付，Batch D 为完整能力实现（落地于 `feature/work-item-detail`）；Batch R0–R3 与决策门 H 是 PR #269 的评审修复。

## Purpose / Big Picture

用户从工作项列表打开条目，或直接访问 `/projects/:projectId/items/:itemId`，看到同一个只读详情抽屉：规划标题、正文、状态、来源身份、权威归属与新鲜度。断线时仍可辨认最后已知值，派生提示明确标注，不能修改规划事实。

最小成功证据是实际浏览器中列表点击与直接深链驱动同一个组件，能关闭、恢复焦点、使用 Back/Forward；真实客户端读取链断线后保留内容及时间并显示陈旧状态。browser fixture 是本能力的交互证据，真实 Harness/Host 挂载仍由 #229 交付，不能用组件、解析器或 SSR 的存在宣称产品已接通。

Review repair 完成后：#129 的正式约束要么经人类伙伴批准、限定范围地原处标注并由 ADR-0010（Accepted）承接，要么按人类给出的其它方向重新规划；ADR-0010 的 L1–L3 由会失败的检查固定；PR #269 在当前 main 上以三个交付物级提交通过全部门禁，thread 带证据 resolve，复评清除 `CHANGES_REQUESTED`。判定证据是 `Validation and Acceptance` 中 2026-10-07 新增的四行。

## Context and Orientation

本项紧急在于 #129/#178 已交付安全列表和读取生产链，下一迭代可立即验证第 5 步的用户反馈；重要性是两个入口共享权限、规划权威和陈旧标记。当前不依赖 #133 新字段，适合并行交付。 选题按 Project 10 的近期时间盒、P0、前置就绪和闭环贡献判断，不用虚构评分；#221 的交付事实修复、#228 的宿主服务及 #140 的会话适配保留为后续独立精化，不与本项聚合。

本次调查在 `feature/work-item-detail` 工作树根完成。2026-10-05 CST 观察基线 `ed6b9ae`，产品代码与 `c38b0b5` 一致；实施前用 `git rev-parse HEAD`、`git diff origin/main...HEAD -- packages apps tests` 重新核对。选题依据为 2026-10-04 的 Project 10 观察：#130 属于 2026-10-15 至 2026-10-21 迭代、P0、M、M4；这些是历史选择依据，当前值以 `gh issue view 130 -R SingularityKChen/harness-projects --json state,body,projectItems` 回读为准。

已核实的代码事实：`packages/client/src/sync.ts` 的 `WorkspaceSync.read()` 是展示读取生产者；断线保留 store 与接收时间。`packages/ui-model/src/derive.ts` 已提供 `deriveWorkItemDetail`，但其结果含 actions、lineage，且 redacted 仍可能含 status/derived/authority，不能直接交 renderer。`packages/ui-model/src/work-item-list-view.ts` 的 `deriveWorkItemListView` 是既有权限、能力与授权缓存展示门，安全行已归约状态文案、来源与逐行新鲜度。`packages/ui/src/work-item-list.ts` 当前只渲染静态表格；`apps/web/src/index.ts` 只有包标识，没有路由运行器。**Superseded by Batch D 完成（2026-10-06 @ `e47f817`）**：`packages/ui/src/work-item-list.ts` 已为 safe item 行提供 opt-in anchor，`apps/web/src/item-route.ts` 已提供 canonical codec、`browserHistoryPort()` 与导航 adapter，`packages/ui-model/src/work-item-detail-view.ts` 已实现唯一安全投影；真实 Harness/Host 装配仍未交付。

术语：safe view 是已删除不可见字段、专供绘制的展示对象；redacted 表示内容不可见，不推断删除或撤权；unresolved 表示当前快照未确认目标存在性。`projectId` 是 `read.workspace.id` 的内部工作区 ID，`itemId` 是内部 entityId，均不是 GitHub Project ID、Issue number 或 externalId。locator 的属性（可观察、非秘密、非 capability，不保证随机）与内容规则以 `docs/adr/ADR-0010-stable-ids-are-route-locators.md`（Accepted）为唯一事实源。

上游验收记录是 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md`（#129）与 `docs/exec-plan/completed/2026-10-03-workspace-read-assembly.md`（#178）。#129 已交付安全列表；#133 将丰富 Provider 字段读取，本轮详情只展示现有 wire 字段，不伪造 iteration/date。

Review repair 的对象锁定（观察时刻 2026-10-07 15:30 CST，易失）：PR #269 远端 head `e47f817`，PR API 的 `baseRefOid` 仍是 `ed6b9ae`，`origin/main` 为 `d911cc9`（#270 已合并，与本 PR 只在 `docs/README.md` 重叠）；`mergeStateStatus=BEHIND`、`reviewDecision=CHANGES_REQUESTED`，旧 head 上 13 项 checks 全部 pass，唯一 thread `PRRT_kwDOUekeas6pesrq`（`packages/ui/src/work-item-list.ts:30`）未解决、未 outdated。本地 `feature/work-item-detail` 在远端 head 之上有上一会话的 R0 草稿 WIP 提交 `aa81b06`（未推送，R2 整合时折回）；恢复锚点 `backup/pr-269-before-r1-20261007` → `e47f817`。在检出 `feature/work-item-detail` 的工作树根用 `gh pr view 269 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,mergeStateStatus,reviewDecision,statusCheckRollup,closingIssuesReferences`、`gh pr checks 269 -R SingularityKChen/harness-projects`、分页 `reviewThreads` 与 `git rev-parse HEAD origin/main` 重算；任何 fetch 后 main 前进、rebase、提交整理或 force-push 都使旧 CI / review 结论失效。

并行 PR #268（`feature/project-field-read`，观察时 head `8115211`，由另一会话负责）同样修改 `packages/ui/src/work-item-list.ts`、`packages/ui-model/src/work-item-list-view.ts`、`tests/contract/ui-work-item-list.test.js` 与 `docs/README.md`；用 `gh pr view 268 -R SingularityKChen/harness-projects --json state,headRefOid,files` 重算。两者谁先合并由人类决定；R1 / R2 只负责把文本冲突降到最小并在合并后的基线上重算。

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

组合页记录打开前的元素用于回焦，仅在关闭后元素仍连接且仍属于当前列表时恢复；直接深链、opener 被移除或 scope 改变时聚焦当前列表标题。**2026-10-07 复评处置订正**：fixture 在跨 scope 时整页替换为中性 unresolved、不再渲染列表，「scope 改变时聚焦当前列表标题」对 fixture 不再适用，焦点会落到 body；真实挂载的焦点由 #229 决定（见 Decision Log 同日复评验证条目）。Back 导致关闭同样回焦，Forward 重新打开则焦点进入 dialog。权限撤销或遮蔽只更新内容，不恢复已失效的 anchor。showModal 不可用时交互门失败并报告环境，不增加自制兼容层。

fixture 的 HTTP 服务必须把两个 canonical pathname 都交给同一入口，刷新/初始深链真实可用；入口使用产品 History adapter、详情投影和组合页，不能在测试内重写它们。fixture 提供合成读取、断线、撤权和切 scope 控件。首次 `sync.read()` 为 undefined 时挂载者构造无内容 loading view；不得伪造工作区或能力快照。Host 对读取 phase、授权缓存和 metadata 的观察仍是 #229 的显式接线责任。

### Route identifier decision gate（2026-10-07 · 提议，待人类裁决）

评审意见（`Singularity-AI-Bot`，2026-10-06 21:16 CST，`[P1][blocking]`，review 状态 `CHANGES_REQUESTED`）：列表把 `row.key` 放进公开 href / 深链 URL，与 #129 计划「`data-*`、`href` 和 DOM id 不放内部标识」冲突，而本计划只登记「待人类确认」、没有 supersede 或修订该正式约束；修法是二选一——改用不透明路由 token，**或**由人类明确修订并归档该约束后补齐决策证据。本次走第二条路径：agent 只提议（ADR-0010 Proposed）并准备决策请求，修订权在人类伙伴（决策门 H）。

定性：冲突事实属实，且比意见所指更宽。同一约束有四份副本——`docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 第 115 行（`href` 不放内部标识）与第 121 行（没有行按钮、死链接、详情）、`packages/ui-model/src/work-item-list-view.ts` 的 `VisibleListRow.key` 注释（不得进入任何属性或文字）、`packages/ui/src/work-item-list.ts` 文件头（没有行按钮、链接）——而唯一会失败的检查 `tests/contract/ui-work-item-list.test.js` 的「泄漏面」用例只在无 navigation 模式运行，新模式绕开了它。作为「已证实的越权漏洞」证据不足：生产路径的 locator 是随机 UUID，单用户本机部署下 URL 的各类观察者得不到页面原本看不到的语义信息（事实与强度见 ADR-0010 Why）。作为治理 / 决策门 P1、合并前必须闭合则成立，先例是 `docs/review/2026-09-26-pr-175-mmp-round6.md` 的两条非代码 P1「合并前必修」。根因（证据见 Surprises 2026-10-07）是保留给人类的决定被路由给了评审者、归档门不区分与正式约束冲突的未裁决项；因此本计划新增决策门 H，并在 R3 归档门加一条。

候选方案与取舍以 ADR-0010 的 Decision / Rejected 为唯一事实源。对本 PR 的执行后果：若 H1 批准，候选 A（稳定 `WorkspaceId` / `EntityId` 作 locator）不新增状态，只需 R1 把 L1–L3 固定为会失败的检查，并按门 H 原处标注 #129 计划第 115、121 行，其余最小披露约束不变；任何 token 方案都横跨 storage → controller wire → client → ui-model → ui，而当前代码已 999/1000，不可能在本 PR 的硬门内闭环。

信息流与控制点：

    浏览器 URL
      → apps/web parseItemRoute（只产生候选目标）
      → 已限定到单个 workspace 的 WorkspaceRead（今天由单用户本机的 Host / client 提供）
      → ui-model deriveWorkItemDetailView（scope / 读取能力 / 安全行 / redaction 最小披露）
      → ui（只绘制）

locator 不是授权凭据；ui-model 的绿测只证明对给定 scoped read 的最小披露，不是 Host 授权回执。引入第二个主体的 issue 自行承接对象级授权与统一响应（ADR-0010 Consequences）。

**事实**：#130 的 In scope 含 deep-link 路由 `/projects/:projectId/items/:itemId`；当前 `packages/ui/src/work-item-list.ts` 把 safe item 行的 `row.key` 交给 navigation `href()`。`EntityId` 的类型契约只保证品牌隔离与「不解析结构」，不保证随机（`packages/domain/src/ids.ts` 的 `asBrandedId()` 接纳任意既有字符串，`packages/core/src/relations.ts` 的 `chainEntityId()` 产生确定性 id）。`deriveWorkItemDetailView()` 只能证明：在给定、已限定 scope 的 `WorkspaceRead` 中，猜到 locator 不能越过展示门拿到内容。

**硬约束**：canonical 深链稳定、可刷新、可复制并支持 Back/Forward（本计划由 #130 的 deep-link 范围推导，Batch D 已验收）；route locator 不参与授权判定；redacted / unavailable 行不生成可用 anchor；未到 MMP 且没有已发布链接需要迁移，不建立双路由、redirect 或兼容层。修订已交付计划的正式约束必须有人类批准记录，并由 ADR、原处标注、判别测试与当前 head 证据共同闭合。

**假设**：#130 没有「隐藏资源存在性」或「禁止跨会话关联」的产品要求；当前 PR 消费的是已限定到单个 workspace 的 read。任一假设被推翻，转入门 H 的否决分支。

**未知**：共享 Host 的用户身份、workspace membership、访问日志、referrer policy 与中性错误策略尚未设计。2026-10-07 15:35 CST 复跑 `gh search issues '<query>' --repo SingularityKChen/harness-projects --state open --limit 50 --json number,title`（查询 `route locator`、`route token`、`authorization workspace entity`、`IDOR`、`tenant isolation`、`object-level authorization`、`multi-user`），没有承接多用户对象级授权的 open issue（`multi-user` 唯一命中 #226，是字面模糊匹配）；`gh issue view 228 -R SingularityKChen/harness-projects --json body` 与 #229 的验收也不含它。按 H2（非阻塞）的提议，不为此建 issue。

## Global Constraints

文件集合只在此声明。当前 Batch P 新建本计划、修改 `docs/README.md` Active 索引唯一行。未来 Batch D 新建 `packages/ui-model/src/work-item-detail-view.ts`、`packages/ui/src/work-item-detail.ts`、`packages/ui/src/work-item-project.ts`、`apps/web/src/item-route.ts`；修改 `packages/ui-model/src/index.ts`、`packages/ui/src/index.ts`、`packages/ui/src/work-item-list.ts`、`apps/web/src/index.ts`；新建 `tests/contract/ui-work-item-detail-view.test.js`、`tests/contract/ui-work-item-detail.test.js`、`tests/contract/web-item-route.test.js`、`tests/contract/ui-work-item-detail-browser.test.js`、`tests/integration/ui-work-item-detail-read.test.js`、`tests/fixtures/work-item-detail-browser.mjs`。仅实际接受新维护债时扩入 `docs/exec-plan/tech-debt-tracker.md` 并说明原因。**Superseded for review repair by 下文「Review repair 文件集」（2026-10-07）**：历史集合只解释已有提交，不授权继续扩大修改面。

规划预算为代码（含测试、fixture）≤800 行、文档≤1300 行；估算产品 330、契约/集成测试 325、fixture 115，共 770 行。以实际 base 差异新增+删除计算，超过规划预算先收敛设计、保留判别测试；不能自创 fixture/测试排除。正式分类、排除和硬门只采用 `scripts/rule-checks.mjs size` 的结果（仓库门为代码1000/文档1500）。若仍超预算，重新设计可独立验收闭环并更新计划，不把一项拆成不可独立使用的 PR。

Batch D 实测：代码（含测试、fixture）998 行、文档 205 行（`rule-checks size`），规划预算 800 未达成。三轮收敛后差异集中在 Validation 表点名的判别面（投影/SSR 契约、真实 bundle 输入面与 node:crypto 负控、真实 sync/read 集成、同源 HTTP fixture）。裁定：以仓库硬门 1000/1500 为准，保留全部命名判别用例，偏差在 Surprises 与 Decision Log 登记。

Review repair 文件集（2026-10-07；集合只在此声明）：

- 文档（R0 修订者与主控）：本计划、`docs/README.md`、`docs/adr/README.md`、`docs/adr/ADR-0010-stable-ids-are-route-locators.md`。`docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 在 H1 批准前必须与 `origin/main` 逐字一致，批准后只由主控追加门 H 规定的两处标注与一条 Change Note。
- R1-U1：`packages/ui-model/src/work-item-list-view.ts`、`packages/ui/src/work-item-list.ts`、`packages/ui/src/work-item-project.ts`、`tests/contract/ui-work-item-detail.test.js`、`tests/contract/ui-work-item-detail-view.test.js`，以及新建的 `tests/fixtures/work-item-wire.mjs`。
- R1-U2：`tests/contract/web-item-route.test.js`、`tests/fixtures/work-item-detail-browser.mjs`、`tests/contract/ui-work-item-detail-browser.test.js`。
- U1 与 U2 的文件集互不重叠；两个 owner 在本计划里各自只替换自己的「执行记录：pending」段。变异实验可以临时改集合外的文件，但必须恢复，且 `git status --short` 不留痕。
- 不改：`apps/web/src/item-route.ts` 与 `packages/ui-model/src/work-item-detail-view.ts`（只作变异对象）、`tests/contract/ui-work-item-list.test.js`（main 既有检查，navigation 模式由 R1 的新断言覆盖）、schema、storage、Provider、Host 与产品可观察行为（A4 / A5 是输出逐字不变的重构）；不新建 route-token 或多用户授权 issue，不登记 tech-debt，不写 Project `Status` / blocked-by。

Review repair 规模：`scripts/rule-checks.mjs` 的 size 按 `git diff <base>...<head>` 的增删之和计（`BUDGETS` 与 `churn` 见该文件「§8.3 PR 体量上限」一节），只比较两个**提交**，不计工作树。观察时刻 2026-10-07 15:30 CST：`node scripts/rule-checks.mjs size origin/main e47f817` 为代码 999/1000、文档 252/1500，`… size origin/main aa81b06` 为代码 999、文档 415。改一行 main 已有行计 +2（删一加一），删一行本 PR 新增行计 −1，改写本 PR 新增行计 0。R1 的目标是代码 ≤995，留 ≥5 行余量吸收 R2 rebase 后的重算（例如 #268 先合并会改变共享文件的基线）；预算账在 Batch R1。禁止删判别断言、压成不可维护的一行或靠排除规则绕门。

Node≥22、pnpm 10.28.2，沿用现有 React/createElement、esbuild；不新增依赖、lockfile 或 manifest 改动。不改 domain、capabilities、core、controller、client、storage、providers；不加编辑、StartWork、工程/交付段或真实 Host 连接。不引入数据迁移或兼容层。外部产品写入为零，凭据为零；Planning 状态和依赖关系均不自动修改。

## Plan of Work

### Batch P · 可审阅设计与草稿交付（已完成 · 2026-10-05）

最小闭环是独立对照两稿、核实源码并保存完整 spec/plan；主文件为本计划。核对十三章节、仅 Progress 勾选、相对路径与链接、未来文件标记和验收 pending。运行本节文档门后，由主控整理文档提交、以 main 为 base 建 draft PR，正文 `Closes #130` 声明完整预期交付，同时回读 PR 的 closingIssuesReferences 与 issue 的 closedByPullRequestsReferences 双向关联；产品 pending 不妨碍本轮登记，保持 draft、不合并就不提前关闭 issue。本轮不执行 Batch D。回滚仅撤销本计划及对应索引行，保留其他计划。

### Batch D · 只读详情与真实导航闭环（已完成 · 2026-10-06）

这是一个可独立验收、合并和回滚的能力 PR；以下步骤是内部实施顺序，不是四个半成品 PR。每段先新增命名失败测试，确认失败源于缺失行为，再最小实现并跑同一命令转绿；实现与其判别测试同一提交。

1. 主文件 `packages/ui-model/src/work-item-detail-view.ts`：实现 scope→现有门→安全行→白名单投影。新增命名用例 `scope-before-store`（跨 scope 时 list/get 均0次）、`blocked-cache-canary`（三种明确失败及能力阻断下无敏感值）、`redacted-erases-every-field`（连状态/派生/authority 也无）、`selected-fresh-in-partial`（另一行 stale 不改变本行）、`missing-is-unresolved`、`pending-never-shows-cache`；配可见内容正控防止“全部隐藏”空绿。
2. 主文件 `packages/ui/src/work-item-detail.ts`：实现唯一 dialog 与组合页、列表 opt-in anchor。命名用例 `same-drawer-from-both-entries` 断言同一导出组件类型；`readonly-planning-source` 对实际 SSR 断言 title/body/status、来源与 externalId、派生前缀均存在，且无 input/select/textarea、编辑、Saved、StartWork、bindingId；`text-is-escaped` 注入 HTML 字符串断言没有执行标签。旧列表无 navigation 时保持原输出。
3. 主文件 `apps/web/src/item-route.ts`：实现 codec 和实际 History adapter。命名用例 `initial-route-and-popstate`、`canonical-open-close-idempotent`、`invalid-segments-no-echo`、`dispose-stops-listeners` 断言初始发布、每次 popstate、同目标0次重复push、close只有replace、非法输入 undefined、dispose 后0回调；真实浏览器另验修饰键行为，不靠假 port 代替。
4. 主文件 `tests/fixtures/work-item-detail-browser.mjs`：实现同源 HTTP 路径回退与动态 fixture。完整 bundle 测试入口实际调用 adapter→投影→组合页，只外置 React，允许纯 capability key 叶子，禁止 node:* 与 core/controller/client 运行时；vm SSR 必须产生非空 title，负控经 domain 根出口引 node:crypto 必须失败。集成命名用例 `sync-loss-preserves-visible-detail` 经实际 createSync/read、固定时钟与受控 transport 验证断线前后 title/body/status/identity/time deepEqual 且 stale 从 false→true；`sync-source-degraded-retains-content` 注入 Provider 降级 metadata 帧，连接保持正常、所选行转 stale 时同样保留内容/时间；`sync-recovery-reprojects` 验证新帧恢复而非沿用缓存。
5. 运行完整 D 命令和实际浏览器矩阵，记录成功/失败及运行上下文。只在验收全通过后整理提交、执行发布检查、push 回读、回复评审；由人类决定合并。回滚 D 的整个实现/测试提交集合，移除导出与列表 opt-in 即恢复既有列表；无数据变更。

所有命令在检出 `feature/work-item-detail` 的工作树根执行；首次依赖准备为 `pnpm install --frozen-lockfile`，期望 exit 0，不修改锁文件。文档阶段不冒称执行尚未新建的产品测试。**Superseded by Batch D 完成（2026-10-06）**：上一句所说的产品测试已经存在，review repair 必须复跑而不能引用历史绿灯。

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

各测试命令期望非零用例、fail=0、无跳过；typecheck/boundaries/机械门 exit 0。fixture 期望打印本地可访问地址并持续服务，浏览器访问 `/projects/ws-1/items` 和 `/projects/ws-1/items/ent-aa`，完成矩阵后停止进程。该命令与服务是将新建的实现，当前不能执行。发布扫描对未提交新文件不构成覆盖证明；提交前人工检查全部新增文档与五类发布风险，提交后再跑正式门。其中「该命令与服务是将新建的实现，当前不能执行」**Superseded by Batch D 完成（2026-10-06）**。

### Batch R0 · 提议与决策请求（已准备 · 2026-10-07；待决策门 H）

**最小闭环**：把评审意见中成立的正式约束冲突与不成立的推理分开，形成 Proposed 的 ADR-0010 和可直接回答的决策请求；不改产品代码、测试、Git 历史或外部系统，也不替人类修订 #129。

**涉及文件**：本计划、`docs/adr/ADR-0010-stable-ids-are-route-locators.md`、`docs/adr/README.md`、`docs/README.md`；`docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 只恢复为 `origin/main` 原文。

**验证**（在检出 `feature/work-item-detail` 的工作树根）：`exec-plan` 技能自带的 lint 脚本（`lint_execplan.py <本计划路径>`）期望输出 `OK: ExecPlan passed lint checks.`（环境没有该技能时跳过并记录）；`node --test --test-timeout=120000 tests/contract/plan-facts-consistency.test.js tests/contract/e1-evidence-consistency.test.js tests/contract/board-status-semantics.test.js` 期望 fail=0；`git diff --check` exit 0；`git diff origin/main -- docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 无输出；`grep -n 'Accepted' docs/adr/ADR-0010-stable-ids-are-route-locators.md` 只命中状态行里「批准后才改为 Accepted」的条件句；四个文档的相对链接目标都存在。

**回滚**：撤销上述文档路径的工作树改动或其本地 WIP 提交；#129 计划保持 `origin/main` 原文；不碰历史提交与产品文件。

### 决策门 H · 人类裁决（阻塞 R2 / R3；R1 可先行）

门 H 由主控一次性提给人类伙伴。R1 是本地、可逆的判别力工作，可在 H1 答复前执行，其证据随决策请求一起提交（`AGENTS.md` §5：先准备可审阅结果，把批准放在最后一步）；R2 第一步之前，Decision Log 必须已有 H1 的人类批准记录。评审账号、独立研究者、实施者或主控的结论都不是批准。

**H1（阻塞）可批准陈述**，逐字提交：

> 批准 `docs/adr/ADR-0010-stable-ids-are-route-locators.md` 由 Proposed 改为 Accepted：规划实体的 `WorkspaceId` / `EntityId` 作为 `/projects/:projectId/items/:itemId` 的可观察、非秘密、非 capability 的 canonical locator，只有 visible item 行可以在显式 navigation 契约下生成该 href。据此对 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 第 115 行（`href` 不放内部标识）与第 121 行（没有详情入口）做限定范围的原处 supersede；redacted 行无 href、locator 不进 `data-*` / DOM id / 文字 / 详情正文、`bindingId` / `ExternalIdentityId` / 凭据句柄不进任何输出、谱系 id 不进路由的约束保持不变。

**记录格式**（主控写入本计划 Decision Log）：`<YYYY-MM-DD HH:MM> CST / 人类伙伴在会话中批准 H1，主控（agent）记录：「<人类原话逐字引用>」。目标：ADR-0010 状态行；#129 计划第 115、121 行。` 批准附带修改时逐字记录修改，按修改后的文字执行；修改若影响 L1–L3，回到 R1 重跑受影响的变异。

**批准后的机械动作**（主控执行，文字固定；`<批准日期>` 取 Decision Log 记录的日期，`<HH:MM>` 取执行时刻）：

1. ADR-0010 状态行改为 `> 状态：Accepted（人类伙伴 <批准日期> 在 PR #269 的会话中批准决策门 H1；记录见来源 ExecPlan 的 Decision Log）`。`docs/adr/README.md` 索引行状态改为 `Accepted`，说明段落中「采纳与否待人类伙伴裁决其来源 ExecPlan 的决策门 H1」改为「人类伙伴 <批准日期> 批准其来源 ExecPlan 的决策门 H1 后采纳」。
2. #129 计划第 115 行末尾（「data-*、href和DOM id不放内部标识。」之后）追加：``**Superseded by `docs/adr/ADR-0010-stable-ids-are-route-locators.md`（<批准日期>，人类伙伴批准）**：仅限其中 `href` 一项，范围以该 ADR 的 Decision 为准。``
3. #129 计划第 121 行末尾（「没有行按钮、死链接、详情或连接入口。」之后）追加：``**Superseded by `docs/adr/ADR-0010-stable-ids-are-route-locators.md`（<批准日期>，人类伙伴批准）**：仅限其中「详情」入口一项，范围以该 ADR 的 Decision 为准。``
4. #129 计划文件末尾（`## Bottom Change Note` 最后一条之后，先空一行）追加：``Change Note (<批准日期> <HH:MM> CST)：PR #269 的人类伙伴批准决策门 H1 后，按 `docs/adr/ADR-0010-stable-ids-are-route-locators.md` 对第 115 行的 `href` 限制与第 121 行的「详情」入口做限定范围的原处标注；原文保留，#129 已交付的独立列表行为不变。``
5. `docs/README.md` 本计划行：范围列的「ADR-0010（Proposed，待人类裁决）提议」改为「ADR-0010（Accepted）规定」，状态列改为 `Active · H1 已批准；R2–R3`。

动作后在同一工作树根核对：`git diff --stat origin/main -- docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 期望 `4 insertions(+), 2 deletions(-)`；``grep -c 'Superseded by `docs/adr/ADR-0010' docs/exec-plan/completed/2026-10-01-work-item-list-states.md`` 期望 2；`grep -n '状态：' docs/adr/ADR-0010-stable-ids-are-route-locators.md` 期望为第 1 步的文字。

**否决分支**：人类否决 H1 或改选 token 方案时，不执行 R2 / R3，并在 Decision Log 逐字记录。R1 中依赖 H1 的部分（A1 与 C 对 canonical href 值含 locator 的断言、A2 / A3 的注释措辞）随之撤回，L1 / L2 与其余硬化可保留。token 方案（ADR-0010 Rejected 所列的 Host 别名 / HMAC 别名）必然超过本 PR 的 1000 行硬门，主控按 `AGENTS.md` §6 / §8 与人类确定新的能力闭环（新 issue 与新 ExecPlan）及其与 #269 的先后；人类给出方向前 #269 不推进。

**H2（非阻塞）**：demo / MMP 前是单用户；不为多用户对象级授权建 issue，不改 #228 / #229 验收，由引入第二个主体的 issue 自行承接（ADR-0010 Consequences 第 1 条）。未答复时按此执行，并在 Decision Log 标注「H2 未答复」。

**H3（非阻塞，流程）**：归档前置条件（不得存在与正式约束冲突的未裁决项）、决策请求协议、约束写作规则（写明保护对象、理由与适用范围）属于根规则 `PLANS.md` 的改进，是另一个闭环，不并入 #269。请人类选择新开 `docs(exec-plan)` issue，或扩展 #67（其范围是看板写入审批记录的机械核对，是否覆盖需人类判断）。#269 内只局部应用 R3 归档门的一条。

### Batch R1 · 最小披露判别力硬化与注释一致性（U1 ∥ U2）

**最小闭环**：不改变产品可观察行为，把 ADR-0010 的 L1–L3 固定为会失败的检查，让约束副本中的代码注释与 ADR 一致，并在代码 ≤995 内完成；L4 / L5 的既有用例保持绿。

**共同规则**：

- 两个 owner 分别在 `.worktrees/pr269-r1-u1`、`.worktrees/pr269-r1-u2`（路径先按 `AGENTS.md` §7 规范化为 realpath，并核对位于 `.worktrees/` 之内）从同一基线 `R1_BASE` 新建本地分支 `test/pr269-r1-u1`、`test/pr269-r1-u2`。`R1_BASE` 是主控提交本计划本次修订之后的 `feature/work-item-detail` HEAD，用 `git -C .worktrees/item-detail-plan rev-parse HEAD` 回读。新 worktree 先运行 `pnpm install --frozen-lockfile --offline`。提交身份只用 `git -c user.name=… -c user.email=…` 单次传入，禁止任何 `git config` 写入；不 push。
- 顺序：① 在 `R1_BASE` 上跑本单元窄验证为绿并记录用例数；② 先写 / 改测试——行为已经存在，这是契约硬化而不是新功能 TDD，新断言在现有实现上应为绿；③ 做本单元的实现与注释改动，窄验证仍绿；④ 逐条执行变异表：施加变异后先用 `git diff -U0 -- <file>` 证明变异已生效（输出里没有预期行即判「未生效」，不得记为绿），再跑窄验证、记录变红的用例名，最后 `git checkout -- <file>` 并以 `git status --short` 为空证明恢复；⑤ 恢复后窄验证全绿，用例数不少于 ①；⑥ 提交一个本地提交，在该提交上运行 `node scripts/rule-checks.mjs size origin/main HEAD` 记录代码行数；⑦ 只替换本计划中自己的「执行记录：pending」段。
- 规模账是预计值，必须以候选提交实测为准。「probe」指一次性工作树 `.worktrees/pr269-probe-c`（detached `42ac979`）上逐项实测的提交，只作参考，owner 必须按上述顺序重做并自证变红。

| 项 | 内容 | 预计 | 单元 |
|---|---|---|---|
| A1 | `same-drawer-from-both-entries`：`clickOf` 收集任意元素上的 onClick；`href` 桩记录调用并返回 `itemPath({ projectId: 'ws-1', itemId })`；一条 deepEqual 断言 open 调用为 `['ent-aa']`、href 调用集合为 `['ent-aa']`、HTML 中的 href 值为 `['/projects/ws-1/items/ent-aa']`；去掉 href 值后的 HTML 不匹配 `\bent-\|bind-\|ext-\|CANARY\|data-\|\bid=` | +4（probe） | U1 |
| A2 | `packages/ui-model/src/work-item-list-view.ts` 的 `VisibleListRow.key` 注释改为：稳定 `EntityId`（ADR-0010 locator），item 行可经显式 navigation 契约进入 href，redacted 行只供框架做列表 key，任何行都不进 `data-*`、DOM id 或文字 | +2（main 既有行） | U1 |
| A3 | `packages/ui/src/work-item-list.ts` 文件头第 3 行「没有行按钮、链接、详情或连接入口」改为只在无 navigation 时成立的表述 | +2（main 既有行；与本 PR 新增的第 4 行合并成一行则 +1） | U1 |
| A4 | `TitleCell` 改为只返回 `a` 的 `TitleLink({ itemId, title, navigation })`；`ItemRow` 用唯一守卫 `row.kind === 'item' && navigation !== undefined` 决定是否生成 anchor，使「redacted 绝不进 navigation」只有一处 | −3（probe） | U1 |
| A5 | 删除 `packages/ui/src/work-item-project.ts` 冗余的 `export type { ItemNavigation }` 与其后空行；`packages/ui/src/index.ts` 已从 `work-item-list.ts` 导出，删前用 `grep -rn ItemNavigation packages apps tests` 复核没有其它引用方 | −2（probe） | U1 |
| A6 | 内联 `tests/contract/ui-work-item-detail-view.test.js` 只用一次的 `received` | −1（probe） | U1 |
| A7 | `ItemNavigation` 的注释与类型两行从 `COLUMNS` 之后移到 `COLUMN_STYLE` 之后、`TitleLink` 之前，消除与 #268 在 `COLUMNS` 行的冲突 | +1（probe） | U1 |
| B | 新建 `tests/fixtures/work-item-wire.mjs`，导出 `T`、`CANARIES`、`wire`、`redacted(entityId = 'ent-bb', content = {})`；两个 detail 测试删除重复定义、改为一行 import；`derived` 默认统一为 `[]`，逐个复核依赖旧默认 `['ci_failing']` 的用例语义与用例数不变 | −9（probe） | U1 |
| D | `click(event)` 助手加一条 deepEqual：普通左键 preventDefault 且 open；四个修饰键与中键都不拦截、不 open | +1（probe） | U1 |
| F′ | `可见内容正控`：把元组、identity、derived 三条断言合并为对整个 content 对象的一次精确 `assert.deepEqual`（字段集合与值），抓住多出的 locator 字段 | −2（probe 的 `Object.keys` 写法为 +1；F′ 更强也更短） | U1 |
| L1 | 同一用例中渲染第二个列表：redacted 条目换成排序仍在 `ent-aa` 之后、长度不同的 `entityId`，并换掉标题与 `bindingId`；断言其 HTML 与第一次逐字相同，且放在调用断言之前，使 href / open 调用集合一并覆盖 | +2 | U1 |
| A8 | 删除 `tests/contract/web-item-route.test.js` 的 `invalid-segments-no-echo` 中 `assert.equal(route, undefined)` 之后不可达的 `if (route !== undefined) …`，改为单行循环 | −4（probe） | U2 |
| C | `tests/fixtures/work-item-detail-browser.mjs`：`hrefOf = (projectId) => (id) => itemPath({ projectId, itemId: id })`，`renderStatic` 传 `{ href: hrefOf('ws-1'), open: () => undefined }`，`mount` 的 `wired.href` 改用 `hrefOf(projectId)`；`tests/contract/ui-work-item-detail-browser.test.js` 的 vm SSR 用例断言含 `<a href="/projects/ws-1/items/ent-aa">Fixture 详情标题</a>`，既有「各场景无 `ent-bb`」循环随之覆盖 bundle 内的 navigation 路径 | +2（probe） | U2 |
| E | 同文件首个用例断言 bundle 文本匹配 `createItemNavigation\(browserHistoryPort\(\)`，关闭上一轮「fixture 使用产品 port」的空绿 | +1（probe） | U2 |
| G | 删除 `createItemNavigation` 的显式返回类型（−4）：**拒绝**。该返回类型是 `Interfaces and Dependencies` 声明的公共契约，删掉后实现可以静默漂移 | 0 | — |

合计：U1 净 −5（单元上限 −3），U2 净 −1（单元上限 −1），集成后预计 993，硬性目标 ≤995。probe 在 `94e2f7c`（A1、A2、A4–A8、B–E 与 `Object.keys` 版 F）实测为 992，不含 A3 与 L1。超出时先在本表内找不削弱任何断言的简化（例如 A3 采用合并写法）；仍超出就停下记录到 Surprises，不删判别断言。

#### R1-U1 · ui / ui-model 与两个 detail 契约测试、共享 fixture

**涉及文件**：`Global Constraints` 的 R1-U1 集合；表中 A1–A7、B、D、F′、L1。

**步骤**：按共同规则；测试先行的顺序为 B → A6 → A1 + D + L1 → F′，实现与注释的顺序为 A4 → A7 → A5 → A2 → A3。

**变异表**（实现侧，每条先证生效）：

| ID | 注入的缺陷 | 文件 | 期望变红 |
|---|---|---|---|
| M-a | `ItemRow` 守卫去掉 `row.kind === 'item'`，redacted 行也生成 `TitleLink` | `packages/ui/src/work-item-list.ts` | `same-drawer-from-both-entries` |
| M-a′ | redacted 行生成只有 `href`、没有 onClick 的 `a` | 同上 | 同上（href 值 / 调用集合） |
| M-b3 | `TitleLink` 的 href 值追加 `?b=bind-1` | 同上 | 同上（href 值） |
| M-c2 | 带 navigation 时 redacted 行的 `th` 加 `data-key` / `id`，值为 `row.key` | 同上 | 同上（去 href 后的正则） |
| M-c3 | visible anchor 加 `data-entity` / `id`，值为 itemId | 同上 | 同上 |
| M-d | redacted 行的 `th` 挂 onClick 调 `navigation.open(row.key)` | 同上 | 同上（可点击元素计数） |
| M-d2 | redacted 行调用 `navigation.href(row.key)` 并丢弃结果 | 同上 | 同上（href 调用集合） |
| M-g | visible anchor 的 href 改为 `'#'` | 同上 | 同上（href 值） |
| M-h1 / M-h2 / M-h3 | 分别删除修饰键守卫、`preventDefault`、非左键守卫 | 同上 | 同上（点击 deepEqual） |
| M-l1 | redacted 行的 `th` 加 `title: String(row.key.length)` | 同上 | 同上（L1 的 HTML 相等）；该变异不含正则所列字面量，只有 L1 能抓到 |
| M-f2 | 详情 content 多一个 `locator: target.itemId` 字段 | `packages/ui-model/src/work-item-detail-view.ts` | `可见内容正控` |
| M-tear（复核上一轮修复） | 删除详情读取后的 `ContentKind.Redacted` 复验 | 同上 | `撕裂读复验` |

**窄验证**（在 U1 worktree 根）：

    node --test --test-timeout=120000 tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js tests/integration/ui-work-item-detail-read.test.js
    pnpm typecheck
    pnpm boundaries
    git diff --check "$R1_BASE" HEAD

期望 Node 测试 fail=0、skip=0、用例数不少于基线，其余 exit 0；本地提交上 `size` 代码 ≤996。

**回滚**：丢弃 `test/pr269-r1-u1`，或在整合后 `git revert` 其提交；无 schema、数据或行为迁移。

**R1-U1 执行记录（2026-10-07 16:12 CST，完成）**

- worktree `.worktrees/pr269-r1-u1`，分支 `test/pr269-r1-u1`，基线 `R1_BASE` `48d8f1a`；单个本地提交 `test(ui): U1 最小披露判别力硬化`（并入本记录前的代码提交为 `8ec21b5`，并入后以分支 tip 为准）。
- 窄验证（计划列出的七个测试文件）：基线 45/45，终点 45/45，fail=0、skip=0；用例数不变（A6 与 B 只搬动定义，新断言都在既有用例内）。附加 `node --test tests/contract tests/integration` 1099/1099；`pnpm typecheck`、`pnpm boundaries`、`git diff --check R1_BASE HEAD` 均 exit 0。
- size：`node scripts/rule-checks.mjs size origin/main HEAD` 代码 996/1000（R1_BASE 为 999，U1 净 −3，等于单元上限），文档以最终提交为准。首版 998：删掉 L1 的独立注释行与其后空行（原因写进断言消息）后降到 996，没有删任何断言。
- 变异（每条先用 `git diff -U0 -- <file>` 确认只出现预期的 +/- 行，再跑七个文件，最后 `git checkout -- <file>` 并以 `git status --short` 为空确认恢复；红灯用例均是 `same-drawer-from-both-entries` 或下文点名者）：M-a、M-a′（redacted 生成无 onClick 的 `a`）、M-b3、M-c2、M-c3、M-d、M-d2、M-g、M-h1、M-h2、M-h3、M-l1 全部变红（44/45）；M-f2 在 `可见内容正控` 变红，M-tear 在 `撕裂读复验` 变红。最先触发的断言：M-a / M-a′ / M-c2 / M-l1 为 L1 的 HTML 相等；M-b3 / M-d2 / M-g 为 L2 的 href 值与调用集合；M-d 为 L2 的可点击元素计数；M-c3 为 L3 的去 href 后正则；M-h1/2/3 为点击守卫 deepEqual；M-f2 为内容对象精确 deepEqual。M-l1 的缺陷不含正则字面量，只有 L1 的 HTML 相等能抓到（实测确认）。
- 判别力对照：同一份变异在 `R1_BASE` 的旧测试上（临时副本，已删除）除 M-a（旧的 anchor 计数）与 M-tear（既有用例）外全部为绿（45/45），即 M-a′、M-b3、M-c2、M-c3、M-d、M-d2、M-g、M-h1/2/3、M-l1、M-f2 都是本批新增的覆盖。
- 与计划的偏差：①变异首轮曾因 `git checkout -- <file>` 同时还原了尚未提交的实现改动而作废，随后重做实现、先提交再对已提交树逐条重跑，上表为重跑结果；②计划未列出但同类的 `ItemRow` 注释「行 key 只给框架，不进任何属性」（main 既有行）保持原文——它限定于 redacted 行，仍成立，改它多计 +2 而超出单元上限；③commit 末行为 `Refs #130`，未追加 Co-Authored-By 尾注（任务要求末行为 Refs）。

**对抗验证修复（2026-10-07 16:26 CST 第一轮；16:42 CST 第二轮由主控收敛，两轮提交已与首个提交合并为单个本地提交）**

- 验证者两条 blocking 都属实。①L1 的「外部身份」空绿：在 `work-item-list-view.ts` 注入「有 redacted 行且无 safeNotice 时把 redacted 条目 externalId 长度写进 `body.notice`」的变异（`git diff -U0` 确认生效），七个文件 45/45 全绿；`same-drawer-from-both-entries` 第二个 redacted 条目补 `externalId: 'OTHER-EXT'`、L1 断言消息补「外部身份」后，同一变异变红（44/45，红灯用例即 `same-drawer-from-both-entries`），恢复后 45/45。②`work-item-list.ts` 文件头改为「没有行按钮或连接入口；只在传入 navigation 时，安全 item 行的标题是打开详情的链接（ADR-0010），redacted 行没有」，不再无条件否认详情入口（H1 拟 supersede 的 #129 表述）。
- 提交：新增本地提交 `test(ui): U1 按对抗验证补齐判别力`（Refs #130），并入本记录；两处改动只改本 PR 已新增或改写的行，size 代码仍 996。
- 第二轮复验（独立验证者）仍判两条 blocking，均属实，主控（agent）按验证者实测过的净 0 行方案收敛，并补一条非阻塞项：①L1 只换了 `externalId`，`externalKind` 仍同为 `issue`——第二个 redacted 条目补 `externalKind: 'change_request'`；②L1 声称覆盖 open 通道，但第二次渲染的可点击元素从未检查——第二个列表改为保留元素 `other`，断言 `[anchors.length, clickOf(other).length]` 为 `[1, 1]`；③（非阻塞 N6e）组合页 `deepLink` 的渲染挪到 href 调用集合断言之前，使 `WorkItemProjectPage` 对 `navigation.href` 的调用一并受 L2 约束。TDD 红证据（变异均先以 `git diff -U0` 确认生效，再分别对修复后与修复前的测试文件跑七个文件）：N5「有 redacted 条目且其 `externalKind` 非 `issue` 时把它写进 `body.notice`」→ 修复后 44/45（`same-drawer-from-both-entries` 红）、修复前 45/45；N11「redacted 行且 key 长度 > 6 时在 `th` 上挂 `onClick` 调 `navigation.open(row.key)`」→ 修复后 44/45、修复前 45/45；N6e「组合页对 redacted 行调用 `navigation.href(row.key)`」→ 修复后 44/45、修复前 45/45；全部恢复后 45/45，`git status --short` 只剩预期改动。

**与 H1 的依赖**：A1 与 C 中「canonical href 值含 locator」的断言、A2 / A3 的注释措辞依赖 H1 批准；L1、L2、A4–A8、B、D、E、F′ 与 H1 无关。H1 被否决时按门 H 的否决分支撤回前者。

#### R1-U2 · route 测试、browser fixture 与 browser 契约测试

**涉及文件**：`Global Constraints` 的 R1-U2 集合；表中 A8、C、E。

**步骤**：按共同规则；测试先行的顺序为 A8 → C → E（C 同时改 fixture 与其契约测试）。

**变异表**：

| ID | 注入的缺陷 | 文件 | 期望变红 |
|---|---|---|---|
| M-e | fixture 的 `hrefOf` 不经 `itemPath`，改为 `` `/projects/${projectId}/item/${id}` `` | `tests/fixtures/work-item-detail-browser.mjs` | `vm SSR 正控` |
| M-port | fixture 的 `mount` 用手写的 location / history / popstate port 代替 `browserHistoryPort()` | 同上 | `完整路径` 用例（E）；先在未加 E 的 `R1_BASE` 上记录它为绿，作为上一轮空绿的证据 |
| M-echo | `parseItemRoute` 对非法输入返回 `{ projectId: pathname }` | `apps/web/src/item-route.ts` | `invalid-segments-no-echo`（A8 后每个非法样本仍断言 undefined） |
| M-codec（复核上一轮修复） | `itemPath` 删去 `decodeSegment(encoded) === undefined` 判据 | 同上 | `canonical-open-close-idempotent` |
| M-popstate（复核上一轮修复） | `browserHistoryPort().subscribe` 不注册 popstate | 同上 | `browser-history-port` |

**窄验证**（在 U2 worktree 根）：

    node --test --test-timeout=120000 tests/contract/web-item-route.test.js tests/contract/ui-work-item-detail-browser.test.js
    pnpm typecheck
    pnpm boundaries
    git diff --check "$R1_BASE" HEAD

期望同 U1；本地提交上 `size` 代码 ≤998。

**回滚**：同 U1，对象为 `test/pr269-r1-u2`。

**R1-U2 执行记录（2026-10-07 16:06–16:11 CST · 完成）**：

- worktree `.worktrees/pr269-r1-u2`，分支 `test/pr269-r1-u2`，基线 `R1_BASE`（`48d8f1a`），提交 `test(ui): U2 最小披露判别力硬化`（单个本地提交，未 push；head 以分支为准）。
- 基线与终点用例数：窄验证（`web-item-route` 5 + `ui-work-item-detail-browser` 3）在 `R1_BASE` 与终点均为 `tests 8 / pass 8 / fail 0 / skipped 0`；用例数不变，新断言并入既有用例。
- A8：删除 `invalid-segments-no-echo` 中 `assert.equal(route, undefined)` 之后不可达的 `if (route !== undefined) …`，改为单行循环。C：fixture 新增 `hrefOf`，`renderStatic` 传带 `href` / `open` 的 navigation，`mount` 的 `wired.href` 改用 `hrefOf(projectId)`；`vm SSR 正控` 断言 `<a href="/projects/ws-1/items/ent-aa">Fixture 详情标题</a>`。E：`完整路径` 断言 bundle 文本匹配 `createItemNavigation\(browserHistoryPort\(\)`。
- TDD 红：只加 C 的断言而 fixture 未改时，`vm SSR 正控` 红（其余 7 绿），改 fixture 后全绿。
- 变异表（每条先用 `git diff -U0 -- <file>` 证明生效，再跑窄验证，再 `git checkout -- <file>`）：

| ID | 生效证据（diff -U0） | 结果 | 变红用例 |
|---|---|---|---|
| M-port（`R1_BASE`，未加 E） | fixture 的 `createItemNavigation(browserHistoryPort(), render)` 被手写 pathname / pushState / replaceState / popstate port 替换 | **绿**（8/8，上一轮空绿证据） | 无 |
| M-port（终点） | 同上 | 红 | `完整路径：meta 触达 adapter → 投影 → 组合页…` |
| M-e | `hrefOf` 改为 `'/projects/' + projectId + '/item/' + id` | 红 | `vm SSR 正控…` |
| M-echo | `parseItemRoute` 对不以 `/projects/` 开头的输入返回 `{ projectId: pathname }` | 红 | `invalid-segments-no-echo…`、`initial-route-and-popstate…` |
| M-codec | `itemPath` 的判据删去 `decodeSegment(encoded) === undefined` | 红 | `canonical-open-close-idempotent…` |
| M-popstate | `browserHistoryPort().subscribe` 不再调用 `addEventListener('popstate', …)` | 红 | `browser-history-port…` |

- 窄验证：`node --test --test-timeout=120000 tests/contract/web-item-route.test.js tests/contract/ui-work-item-detail-browser.test.js` 为 8/8；`pnpm typecheck` exit 0；`pnpm boundaries` 8/8；`git diff --check 48d8f1a… HEAD` 无输出。每次变异后 `git status --short` 在恢复后无残留。
- size：`node scripts/rule-checks.mjs size origin/main HEAD` 在本提交上为代码 998 / 1000、文档约 601（含本段，以集成树为准）；代码较基线 999 净 −1，符合 U2 上限 −1。
- 偏差：（1）M-e 的首次变异用了模板字符串，而 fixture 的 `ENTRY` 本身是模板字符串，内层反引号截断外层导致 fixture 语法错、整个测试文件加载失败，属于「因错误原因变红」，已弃用并改用字符串拼接重做，表中为重做结果；（2）变异恢复用的 `git checkout -- <file>` 会同时抹掉同一文件未提交的实现改动（首轮恢复 fixture 时丢失了未提交的 C 改动，随后发现并重做），因此中途用一个临时 WIP 提交保护改动，最终以 `git reset --soft` 收敛为单个提交；两项均不影响终点结论。
- 对抗验证修复（2026-10-07 16:20 CST）：验证者唯一 blocking 属实——原标题写 `16:09–16:25`，而分支 reflog 显示 `test/pr269-r1-u2` 于 16:06:28 创建、最后一次 amend（`eb1860d`）在 16:10:54，起止均与证据不符；已按 reflog 改为 `16:06–16:11`。这是记录失实而非代码缺陷，不涉及变异；代码与测试不变，窄验证仍 8/8、代码 998。验证者的非阻塞项（N9–N12 的 mount 粘合层、fixture 默认值负控、Me-sameshape）均在 U2 声明范围之外，不在本单元处理，留给 R1 集成验收评估。第二轮复验（16:21 后）唯一 blocking 仍是记录与 Git 事实不符：本段曾以第二个提交 `test(ui): U2 按对抗验证补齐判别力` 落地，而首条写「单个本地提交」。主控（agent）在 16:45 CST 先建 `backup/pr269-r1-u2-before-squash`，再 `git reset --soft 48d8f1a` 把两次提交合并为首条所述的单个提交，代码与测试不变。

#### R1 集成与验收（主控或指定验收者，不由 U1 / U2 owner 自验）

1. 在 `.worktrees/item-detail-plan`（检出 `feature/work-item-detail`）依次 `git cherry-pick` U1、U2 的提交；文件集互不重叠、计划中的两段 pending 互不相邻，期望无冲突。
2. 在集成树上**整表**重跑 U1 与 U2 的全部变异（含三项上一轮修复复核），逐条先证生效、再记录变红、再恢复；变异表只认集成树上的结果。
3. 运行 `node --test --test-timeout=120000 tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js tests/contract/web-item-route.test.js tests/contract/ui-work-item-detail-browser.test.js tests/integration/ui-work-item-detail-read.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-browser.test.js tests/contract/ui-work-item-list-view.test.js`、`pnpm typecheck`、`pnpm boundaries`、`git diff --check "$R1_BASE" HEAD`；`node scripts/rule-checks.mjs size origin/main HEAD` 期望代码 ≤995。
4. 与 #268 的冲突预演：`git merge-tree --write-tree --name-only HEAD <#268 当前 head>`，期望只输出一个 tree id、没有冲突文件。
5. 回填本计划的 Progress、Validation 与 Surprises；Outcomes 留到 R3 归档。

**R1 集成验收记录（2026-10-07 16:44–17:08 CST，独立验收者（agent），完成）**

- 集成：先核对 `.worktrees/item-detail-plan` 的 HEAD 等于 `R1_BASE`（`48d8f1a`），再 `git cherry-pick 3d621af 172fe30`，无冲突，得 `cd1ff8b`（U1）、`3868e56`（U2）。`git diff 3d621af HEAD -- apps packages tests` 只含 U2 的三个文件、`git diff 172fe30 HEAD -- apps packages tests` 只含 U1 的六个文件，即集成树与两个输入逐文件一致。随后验收者本地提交 `edac07e`（重构）与 `c8f8e81`（非阻塞项硬化），理由见 Decision Log。
- 窄验证（第 3 步的八个文件）：`3868e56` 与 `c8f8e81` 都是 50/50，fail=0、skip=0。
- 变异纪律：私有 runner 按精确字符串替换施加（替换目标必须恰好出现一次），打印 `git diff -U0` 的 +/- 行（0 行判「未生效」），跑八个文件并记录变红用例与首条断言消息，`git checkout -- <file>` 后确认 `git status --short` 为空。43 条在最终代码树 `c8f8e81` 上整表重跑，下表只认这次结果；U1 / U2 两表先在 `3868e56` 上跑过一遍，结论相同。

| ID | 变红用例（50 个中的失败数）与首条断言 |
|---|---|
| M-a、M-a′、M-c2 | `same-drawer-from-both-entries`（L1 的 HTML 相等）与 `vm SSR 正控`（`redacted: ent-bb`），2 |
| M-b3、M-g | `same-drawer-from-both-entries`（L2 的 href 值）与 `vm SSR 正控`（canonical anchor），2 |
| M-c3 | `same-drawer-from-both-entries`（L3 的去 href 正则）与 `vm SSR 正控`，2 |
| M-d、N11 | `same-drawer-from-both-entries`（L1 / L2 的可点击元素计数），1 |
| M-d2、N6e | `same-drawer-from-both-entries`（L2 的 href 调用集合），1 |
| M-h1、M-h2、M-h3 | `same-drawer-from-both-entries`（点击守卫 deepEqual），1 |
| M-l1、N5 | `same-drawer-from-both-entries`（L1 的 HTML 相等），1 |
| M-f2 / M-tear | `可见内容正控` / `撕裂读复验`，各 1 |
| M-e / M-port | `vm SSR 正控` / `完整路径`（E），各 1；M-port 再删去 E 断言为 50/50 绿，即没有 E 时上一轮「fixture 用产品 port」的修复仍是空绿 |
| M-echo | `invalid-segments-no-echo`、`initial-route-and-popstate`，2 |
| M-codec / M-popstate | `canonical-open-close-idempotent` / `browser-history-port`，各 1 |

| ID | 验收者新增的变异（目标） | 结果 |
|---|---|---|
| X1 | 带 navigation 时 redacted 行 `th` 加 `aria-describedby: row.key`（L3） | 红 2：`same-drawer-from-both-entries`（L1）、`vm SSR 正控` |
| X2 | visible anchor 加 `title: itemId`（L3） | 红 2：`same-drawer-from-both-entries`（L3 正则）、`vm SSR 正控` |
| X3 | `deriveWorkItemDetailView` 在 scope 检查前先 `store.get` 一次（L4） | 红 5：`scope-before-store`、`pending-never-shows-cache`、`blocked-cache-canary`、`redacted-erases-every-field`、`missing-is-unresolved` |
| X6 / X13 | unavailable / redacted 分支返回前先 `store.get`（L4） | 红 1：`blocked-cache-canary` / `redacted-erases-every-field` |
| X14 | redacted 分支带出原条目的 `planningStatus`（L4） | 红 1：`redacted-erases-every-field` |
| X4 | `itemPath` 对 projectId 不编码、不校验（L5） | 红 1：`canonical-open-close-idempotent`（`{ projectId: '' }` 不再抛错） |
| X8 / X9 / X10 | 组合页 `routed.href` 追加 query；组合页丢掉 navigation；fixture href 用错 projectId | 红 1：`vm SSR 正控` |
| X5 | 组合页渲染两个 drawer | `3868e56` 上绿（全套 1099/1099）；`c8f8e81` 上红 1：`same-drawer-from-both-entries`（dialog 计数） |
| X7 / X7b / X7c | 遮蔽条目的规划状态 / 派生 / 正文与第一份不同时写进 notice（N5b 与正文） | `3868e56` 上绿（全套 1099/1099）；`c8f8e81` 上红 1：`same-drawer-from-both-entries`（L1） |
| N10 | 遮蔽标题长度写进 notice | 两棵树上都红 1（L1） |
| N9b / N9b+N10 / N9c | `redacted()` 忽略 content 覆盖；同时叠加 N10；忽略状态、派生与 reason 覆盖（N9） | `3868e56` 上前两条绿（全套 1099/1099，N9c 的参数当时不存在）；`c8f8e81` 上三条都红 1：`same-drawer-from-both-entries`（L1 自检） |
| X12a | browser fixture 的遮蔽条目改为 `ent-cc`、`redacted` 场景目标仍是 `ent-bb`，详情退化为 missing | `3868e56` 上绿（全套 1099/1099）；`c8f8e81` 上红 1：`vm SSR 正控`（dialog 遮蔽态） |
| X11 | 组合页 `routed.open` 传错 id | 两棵树上都绿：Node 套件不执行组合页的点击，已知限制（Surprises）。**Superseded by 2026-10-07 复评处置**：沿用「事件回调机械判据」的 hook 调度器桩直接调用组合页即可取到 routed `open`，新断言让 X11 与「不记 opener」两个变异都变红，不再是已知限制。 |

- 全量门（`c8f8e81`）：`node --test --test-timeout=120000 tests/contract tests/integration` 1099/1099；`pnpm verify` exit 0（typecheck，contract+integration+e2e 1156/1156，mvp0 7/7）；`pnpm boundaries` 8/8；`node scripts/workflow-check.mjs` no findings；`node scripts/rule-checks.mjs disclosure origin/main HEAD` exit 0；`size` 代码 995 / 1000（`3868e56` 同为 995）；`git diff --check origin/main...HEAD` exit 0；exec-plan lint OK。`3868e56` 上同一组门也全部通过。
- #268 预演：`git fetch origin refs/pull/268/head`（只用 `FETCH_HEAD`，不建 ref）得 `c72de08`；`git merge-tree --write-tree --name-only HEAD FETCH_HEAD` 在 `3868e56` 与 `c8f8e81` 上都只输出一个 tree id，没有冲突文件。
- 浏览器回读（`c8f8e81`，桌面内置浏览器面板，`node tests/fixtures/work-item-detail-browser.mjs`）：列表只有 visible 行一个 anchor，href 为 `/projects/ws-1/items/ent-aa`，redacted 行是纯文本，DOM 不含 `ent-bb` / `bind-` / `CANARY`；点击后 pathname 变为详情、唯一 dialog 打开且焦点在其标题、fixture 的 `open` 计数为 1；Escape 后 pathname 由 replace 回列表（history 长度不变），焦点回到 opener；直接深链打开同一 dialog；Back 关闭并回焦 opener，Forward 重开；切到 redacted 场景后 dialog 只剩「内容不可见」。它覆盖了 U2 对 `mount` 的改动与 X11 所指的点击通道，但不是 Batch D 的 320/768/1200 完整矩阵，也不是会失败的自动化检查。**Superseded by 2026-10-07 复评处置**：fixture 的 `calls` 计数器（`window.__calls`）已删除，「`open` 计数为 1」这一步改为观察 `history.length` 与 `location.pathname`（push 使长度加一、replace 不变）；mount 的路由 → scope 门 → 组合现由 vm SSR 经同一个 mount 覆盖。history 观察弱于原计数器：adapter 对同目标导航去重，连续两次 open / close 只留下一次 push / replace，重复调用已不可观测。

**回滚**：`git revert` 集成进来的 U1 / U2 提交，或回到 `R1_BASE`。

### Batch R2 · 交付物级整合、当前 main 与候选 HEAD 全量验证

**最小闭环**：在 H1 已有人类批准记录、R1 已验收的前提下，把分支重建为基于当时最新 `origin/main` 的三个交付物级提交，在候选提交上通过全部门禁，再以精确 lease 推送。历史操作由主控按 `git-expert-operations` 执行，不交给并行 agent。

**前置**：`git status --short` 为空；H1 批准记录已在 Decision Log；门 H 的机械动作已提交到本分支。

**步骤**（在 `.worktrees/item-detail-plan` 根，变量只在当前 shell 有效）：

1. 锁定：`git fetch origin`；`OLD_REMOTE=$(git rev-parse origin/feature/work-item-detail)`（期望仍为 `e47f817`，否则停下重新评估）、`LOCAL=$(git rev-parse HEAD)`、`BASE=$(git rev-parse origin/main)`、`MB=$(git merge-base "$LOCAL" "$BASE")`。
2. 恢复锚点：`git branch "backup/pr-269-route-locator-$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S)" "$LOCAL"`；保留既有 `backup/pr-269-before-r1-20261007`（→ `e47f817`）。
3. `git switch --detach "$BASE"`，**按路径**构造三个提交，不按旧提交 squash——`f9a4896`、`efa0b07` 也改了计划与 `docs/README.md`，`efa0b07` 还把计划移入 `completed/`，这些文档改动只归 ③。任何文件都不得整文件取自 `$LOCAL`，除非 main 自 `$MB` 起没有改过它（`git diff --quiet "$MB" "$BASE" -- <path>` 判定）；main 改过的文件用 `git diff --binary "$MB" "$LOCAL" -- <paths> | git apply --3way --index` 套用并逐个解决冲突，否则会静默回退 main 的改动（例如 #268 先合并时的两个列表文件）。
   - ① `docs(exec-plan): 规划统一只读详情与深链入口`（`d09a29c` 与 `b723be2` 的交付物）：把 `git show b723be2:docs/exec-plan/active/2026-10-05-work-item-detail.md` 写入同一路径；在 `$BASE` 版 `docs/README.md` 的 Active 表末行之后手工插入 `d09a29c` 中本计划的那一行。正文说明为什么，末行 `Refs #130`。
   - ② `feat(ui): 统一只读详情抽屉与 canonical 深链入口`（`5c150a0`、`f9a4896`、`efa0b07` 的代码与测试，加 R1 与人类批准后的 ADR）：`git diff --binary "$MB" "$LOCAL" -- apps packages tests docs/adr docs/exec-plan/completed/2026-10-01-work-item-list-states.md | git apply --3way --index`（`docs/adr` 含新建的 ADR-0010 与索引改动）。ADR 是许可这段代码的接口契约，必须与代码一起回滚（先例：`docs/exec-plan/completed/2026-09-29-harness-plugin-package.md` 的 D34 把 ADR-0009 与可安装插件放在同一交付物提交）。末行 `Closes #130`。
   - ③ `docs(exec-plan): 回填统一只读详情的评审修复与验证`（`e47f817` 与 R 段回填）：写入 `$LOCAL` 版本计划全文（仍在 `active/`）；把 `docs/README.md` 中 ① 插入的那一行替换为 `$LOCAL` 中的同一行。末行 `Refs #130`。
   - 三个提交的正文都只说明为什么，不写关闭关键字的叙述（例如「把某关键字改成另一个」）；作者沿用开发账号（与 `git log -1 --format='%an' e47f817` 一致），不为此写任何 `git config`。
4. `git branch -f feature/work-item-detail HEAD`，再 `git switch feature/work-item-detail`。
5. 改写核对：文件集合用 `git diff --name-only "$MB" "$LOCAL" | sort` 与 `git diff --name-only "$BASE" HEAD | sort` 各写入 scratch 目录的一个文件，`comm -3` 两者期望无输出；对 main 没改过的每个路径，`git diff "$LOCAL" HEAD -- <path>` 期望无输出；对 main 改过的路径（至少 `docs/README.md`），`git diff "$BASE" HEAD -- <path>` 只含本 PR 的行；`git log --format=%B "$BASE"..HEAD | grep -n -i -E "(close[sd]?|fix(e[sd])?|resolve[sd]?) #[0-9]+"` 期望恰好一行，即 ② 的 `Closes #130`；对 `git rev-list --reverse "$BASE"..HEAD` 中每个提交 `git switch --detach <commit>` 后运行 `pnpm typecheck` 与 `node --test --test-timeout=120000 tests/contract tests/integration`，期望 exit 0、fail=0，结束后切回 `feature/work-item-detail`。
6. 候选 HEAD 全量门（命令见下），并做 `docs/development/publication.md` 的人工五类检查。
7. 推送：`git push --force-with-lease=feature/work-item-detail:"$OLD_REMOTE" origin feature/work-item-detail`。lease 被拒立即停止，重新 fetch 与锁定，绝不放宽 lease 或改用 `--force`。

候选 HEAD 全量门（在检出 `feature/work-item-detail` 的工作树根）：

    node --test --test-timeout=120000 tests/contract tests/integration
    pnpm verify
    pnpm boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main HEAD
    node scripts/rule-checks.mjs size origin/main HEAD
    git diff --check origin/main...HEAD

期望全部 exit 0，Node 测试 fail=0、skip=0，代码 ≤1000（目标 ≤995），文档 ≤1500。size / disclosure 只读提交对象，候选 HEAD 形成之前的绿不算发布门。

**回滚**：第 4 步之前分支没有移动，`git switch feature/work-item-detail` 即丢弃 detached 结果；第 4 步之后从恢复锚点恢复（先 `git switch --detach`，再 `git branch -f feature/work-item-detail <backup>`）；推送之后的回滚以同样的精确 lease 推回锚点提交，并在 PR 写更正说明。合并后的 `git revert` 单位：② 与 ③ 一起回退，或三个一起回退；③ 依赖 ②，单独回退 ③ 会让 ADR-0010 来源行与 #129 标注引用的决策门 H 指向不含该门的 ① 版计划（ADR 状态行本身自带批准时刻与答复原文，不会出现无批准的 Accepted）。

### Batch R3 · 远端回读、PR 描述、thread 闭合、复评与归档

**最小闭环**：外部状态只接受新 head 的证据；thread 在证据齐备后由开发账号回复并 resolve，再请评审账号复评；只有复评清除 `CHANGES_REQUESTED`、且不存在与正式约束冲突的未裁决项时才归档。不得合并。

**步骤**（`gh` 命令都带 `-R SingularityKChen/harness-projects`，由开发账号 `SingularityKChen` 执行）：

1. 回读：`git ls-remote origin refs/heads/feature/work-item-detail` 等于本地 HEAD；`gh pr view 269 --json headRefOid,baseRefOid,mergeStateStatus,reviewDecision,statusCheckRollup,closingIssuesReferences` 期望 head 等于本地、`baseRefOid` 等于当前 `origin/main`、`closingIssuesReferences` 含 #130；`gh pr checks 269` 等到全部 pass；`gh issue view 130 --json closedByPullRequestsReferences` 含 #269。
2. 改写 PR 描述（`gh pr edit 269 --body-file <scratch 文件>`）：删掉「已归档到 `docs/exec-plan/completed/`」「head `d69c0bf`」「请评审时一并裁定」三处过时内容；ExecPlan 链接指向 `docs/exec-plan/active/2026-10-05-work-item-detail.md`；写闭环、ExecPlan + Batch（P、D、R0–R3 与门 H）、`Closes #130`、人类批准 H1 的时刻与 Decision Log 位置、新 head 上的真实验证（命令、结果、观察 head）、L1–L3 与变异证据摘要、风险与回滚（回退 ② 会同时撤回代码与 ADR）、规模和仍未验证项。写入后等 `Disclosure scan` 在新描述上重跑为 pass。
3. 回复 thread `PRRT_kwDOUekeas6pesrq`，必须附：走了评审给出的哪条路径及理由（ADR-0010 Rejected 对 token 的结论）；人类批准记录的位置（本计划 Decision Log 条目、ADR-0010 状态行、#129 计划第 115 / 121 行标注）及其所在提交 SHA（② 与 ③）；L1–L3 的用例名与集成树上的变异红证据；新 head SHA 与 checks 状态。随后用 GraphQL `resolveReviewThread`（`threadId: "PRRT_kwDOUekeas6pesrq"`）resolve，并回读 `isResolved=true`。
4. 请求复评：`gh api -X POST repos/SingularityKChen/harness-projects/pulls/269/requested_reviewers -f 'reviewers[]=Singularity-AI-Bot'`，回读 `requested_reviewers`。复评由评审账号 `Singularity-AI-Bot` 在独立会话执行；若复评仍坚持 token，以人类伙伴的裁决为准，把分歧与人类结论写入 Decision Log。
5. 归档门，全部满足才归档：当前 head 的 `reviewDecision` 不是 `CHANGES_REQUESTED`；没有未解决的 P0 / P1 thread；checks 全绿；#130 双向关联正确；**本计划与其上游计划中没有与正式约束冲突的未裁决项**（Decision Log 里每个「待人类」都有人类裁决记录）。满足后：计划移入 `docs/exec-plan/completed/`；`docs/README.md` 从 Active 表删去本行、在 Completed 表加一行；ADR-0010 来源行与其它指向本计划路径的引用统一改为 `completed/`（`grep -rn 'exec-plan/active/2026-10-05-work-item-detail' docs` 在本计划以外期望无输出；本计划的 R2 / R3 步骤文本按历史保留）；回填 Progress 与 Outcomes。这些改动并入 ③（③ 是顶端提交，用 `git commit --amend`），按 R2 第 5–7 步重新核对，以新的 `OLD_REMOTE` 做精确 lease 推送，再执行本批第 1 步。复评之后的每次 push 都重新回读 review 状态，不沿用旧结论；合并与否由人类决定。

**回滚**：外部写入出错时发布更正，可行时用 `unresolveReviewThread` 重新打开 thread，不用旧 head 的回执掩盖。

### Concrete Steps

执行顺序：R0（本次已准备）→ 主控提交本计划的这次修订 → R1-U1 ∥ R1-U2 → R1 集成与验收 → 门 H（一次性请求 H1–H3，最迟在 R2 开始前得到 H1）→ 门 H 的机械动作 → R2 → R3。每一步的命令、期望输出与回滚只写在对应批次；任何一步失败，停在最早受影响的批次修订本计划，不发布「已完成」。

## Validation and Acceptance

| 验收 | 决定性证据 | 当前状态 |
|---|---|---|
| 列表和深链同一 drawer | `same-drawer-from-both-entries` + 浏览器初始 URL、点击、刷新同一内容 | 已过：SSR 同一导出 + 真实 Chromium 深链刷新/点击/Enter 同一内容 |
| 权限/遮蔽/跨 scope 不泄漏 | canary 覆盖 title/body/id/status/derived/authority/identity/reason；投影与 SSR 正负控；打开中撤权后 DOM 即时清空 | 已过：投影/SSR canary 全清，真实浏览器打开中撤权即时清空且不导航 |
| 授权离线缓存、逐行新鲜度、未知缺项 | 真实 sync/read 集成、固定时间、partial 对照和 unresolved 文案 | 已过（三个集成用例 + partial/unresolved 契约） |
| 只读规划与来源、派生不改状态 | todo 与 merged 提示同时存在；deepEqual 输入状态；无写控件及编辑动作 | 已过（SSR 断言无 input/select/textarea、编辑/Saved/StartWork/bindingId） |
| 原生模态和导航 | 320/768/1200 实际 DOM：Enter打开、焦点入标题、Tab循环、Escape/按钮单次关闭、回焦；Back关闭/Forward打开；direct URL无opener回标题 | 已过：真实 Chromium 矩阵 10/10（含 Tab 在 dialog 内、Escape 回 opener、深链关闭回列表标题） |
| 路由与生命周期 | malformed（含 `.`/`..` 段）、跨scope、快速切项/撤权、重复open/close/dispose、初始路径HTTP可达；修改键保留href | 已过：codec/adapter/HTTP 契约 + 真实浏览器 Back/Forward 切项、撤权即时清空、修饰键保留 href；模态打开时背景 anchor 被原生 inert 拦截，属预期而非缺陷。**2026-10-07 复评订正**：此前「跨scope」只覆盖详情投影，fixture 的列表路由对未知路由与跨工作区仍绑定当前 store 并生成死链；现由 fixture `views` 的 scope 门与中性 unresolved 关闭，vm SSR 以 `/projects/ws-9/items`、`/projects/ws-1/items/a%2Fb` 与 `scoped` 三例逐字断言，codec 补 `/item/` 第二路由形状与解码后 `.` 两个拒绝样本 |
| 浏览器安全与回归 | 实际完整bundle、SSR正控、node:crypto负控、既有列表回归、typecheck/boundaries | 已过（20 + 3 + 25 用例、typecheck/boundaries exit 0） |
| 预算与发布 | 正式size输出与≤800/≤1300规划预算核对、disclosure、人工五类检查、远端当前head回读 | 重构后正式 size 994/1000 代码、233/1500 文档（重算命令 `node scripts/rule-checks.mjs size origin/main`，期望 exit 0 且代码 ≤1000）；规划预算 800/1300 未达，见 Decision Log；**Superseded by** 下方「R 规模与发布」行（2026-10-07） |
| route locator 决策（2026-10-07） | Decision Log 中 H1 的人类批准记录（逐字引用）；ADR-0010 状态行按该记录改为 Accepted；#129 计划第 115 / 121 行的原处标注与 Change Note | 已过：人类伙伴 2026-10-07 16:12 CST 在会话中批准（Decision Log 同日条目）；ADR-0010 状态行为 Accepted 并自带批准时刻与所选答复原文；#129 计划第 115 / 121 行原处标注与 Change Note（`git diff --stat origin/main` 为 4+/2−）。15:50 CST 时为「待门 H」 |
| 最小披露 L1–L3 判别力（2026-10-07） | 集成树上 R1 变异表逐条：生效证据、指定用例变红、恢复后全绿；L4 / L5 既有用例保持绿 | R1 已过（2026-10-07 17:08 CST，验收者（agent），最终代码树 `c8f8e81`）：43 条变异 41 条按预期变红，2 条绿为预期（删去 E 的 M-port 对照、X11 已知限制——**Superseded by 2026-10-07 复评处置**：沿用「事件回调机械判据」的 hook 调度器桩直接调用组合页即可取到 routed `open`，新断言让 X11 与「不记 opener」两个变异都变红，不再是已知限制。）；L4 / L5 既有用例对新增 X3、X4、X6、X13、X14 都变红；明细见 Batch R1「R1 集成验收记录」 |
| R 规模与发布（2026-10-07） | 候选提交上 `node scripts/rule-checks.mjs size origin/main HEAD` 代码 ≤995（硬门 1000）、文档 ≤1500；disclosure exit 0；人工五类；远端 head 回读 | 观察时刻 2026-10-07 15:30 CST：`e47f817` 代码 999 / 文档 252，`aa81b06` 代码 999 / 文档 415；R1 集成树 `3868e56` 与 `c8f8e81` 都是代码 995 / 文档 615，本计划回填提交 `docs(exec-plan): 回填 R1 集成验收与变异证据` 后文档 673；R2 候选 `f4f5cdc` 为代码 995 / 文档 687；复评处置后的交付物级候选为代码 999，文档以该候选的 `rule-checks size` 为准；候选的 disclosure、人工五类与远端回读在推送前后由 R3 执行，结果见 PR #269 描述（本计划不自引用最终 head） |
| 当前 head 与评审闭合（2026-10-07） | R3 第 1、3、4 步回读：远端 head 等于本地、checks 全绿、thread resolved、复评后 `reviewDecision` 不是 `CHANGES_REQUESTED`；归档门全部满足 | 复评前已过：17:21 CST `f4f5cdc` 远端 = 本地、base `d911cc9`、12/12 checks、thread resolved；复评 19:37 CST APPROVED（届时计 13 项，多 1 项 reviewer-signal）。复评处置后的最终 head 由 R3 以精确 lease 推送，回读、thread 回复与 PR 描述的证据在 PR #269，本计划不自引用 |

最高风险五项分别是权限变化残留、partial误降级、首次深链无读取、原生dialog重复生命周期、scope切换后的错误回焦；均在上述命名测试或真实 DOM 行中有明确判据。**2026-10-07 复评处置订正**：fixture 在跨 scope 时整页替换为中性 unresolved，焦点落到 body，已不满足「scope 切换后的错误回焦」一项的判据，承接者为 #229 验收中的焦点项（scope 改变或 unresolved 路由在抽屉打开时替换整页，焦点落在列表标题或可聚焦的 unresolved 文案，不落在 body，以测试或浏览器回读验证）；列表路由与详情路由是否分用 unresolved 文案一并交 #229。真实浏览器矩阵在 320/768/1200 与 Back/Forward 下复跑；SSR 不证明焦点/历史，bundle 不证明 Host 挂载，fixture 不证明 #229 完成。

Review repair 新增五项最高风险及其判据：把 agent 的提议当成人类决定（门 H 的记录格式与 R3 归档门）；新断言空绿（变异先证生效、集成树整表重测）；规模越门（R1 预算账与 R2 候选提交重算）；与 #268 的文本冲突（`git merge-tree` 预演）；改写历史时丢文件或回退 main（按路径套用差异、`comm` 文件集比对与内容核对）。ui-model 的绿测只证明 scoped read 上的最小披露，不证明任何 Host 授权。

### Artifacts and Notes

- 评审对象：review `5428915139`（`Singularity-AI-Bot`，`CHANGES_REQUESTED`，commit `e47f817`）与 thread `PRRT_kwDOUekeas6pesrq` 的评论 `4195716745`；用 `gh api repos/SingularityKChen/harness-projects/pulls/269/reviews` 与 `gh api repos/SingularityKChen/harness-projects/pulls/comments/4195716745` 回读。
- PR 描述的过时内容（观察时刻 2026-10-07 15:30 CST，`gh pr view 269 -R SingularityKChen/harness-projects --json body` 回读）：仍写计划「已归档到 `docs/exec-plan/completed/`」、验证段观察 head 为 `d69c0bf`、评审答复段请评审者「一并裁定」路由标识冲突；R3 第 2 步改写。
- 一次性 probe `.worktrees/pr269-probe-c`（detached `42ac979`，不进入 PR）：`git -C .worktrees/pr269-probe-c log --oneline aa81b06..42ac979` 列出 `c047523`（A1、A2、A4–A6、A8）、`5bc2921`（B）、`aca4101`（C）、`df2a95a`（D）、`daa75ab`（E）、`9baa670`（A7）、`94e2f7c`（`Object.keys` 版 F）、`42ac979`（被拒的 G）；各提交上 `node scripts/rule-checks.mjs size origin/main <commit>` 的代码行数依次为 995、986、988、989、990、991、992、988。
- 变异基线（独立研究者在 `e47f817` 上实测，agent）：17 个变异只有 4 个变红；空绿的是 M-a′、M-b3、M-c2、M-c3、M-d、M-d2、M-e、M-g、M-h1 / M-h2 / M-h3、M-f2，以及「fixture 换成手写 port」。
- 冲突预演（2026-10-07 15:30 CST）：`git merge-tree --write-tree --name-only aa81b06 8115211` 冲突于 `packages/ui/src/work-item-list.ts`；`git merge-tree --write-tree --name-only 94e2f7c 8115211` 无冲突。`origin/main`（#270）与 #268 都在 `docs/README.md` 的 Active 表顶部插行，本计划行位于 Active 表末行，与二者都不相邻。
- 冲突预演（2026-10-07 17:00 CST，R1 验收者）：#268 head 已前进为 `c72de08`；`git merge-tree --write-tree --name-only HEAD FETCH_HEAD` 在 `3868e56`、`c8f8e81` 上都无冲突。

## Progress

- [x] 2026-10-05 CST：读取 AGENTS/PLANS、两个独立设计和当前源码，完成边界、备选方案、接口和验收收敛。
- [x] 2026-10-05 CST：新建正式计划并加入 Active 索引；仅文档修改，产品未实施。
- [x] 2026-10-05 CST：重新读取落盘文件独立自查；十三章节顺序、Progress、可移植引用、预算与本地链接检查通过，`git diff --check` exit 0。
- [x] 2026-10-05 CST：管理登记回执：已创建 [draft PR #269](https://github.com/SingularityKChen/harness-projects/pull/269)，核对双向 issue 引用及 Project 计划字段；产品实施仍 pending。
- [x] 2026-10-05 CST：Batch D 1/4 落地 `packages/ui-model/src/work-item-detail-view.ts`：scope → 既有列表门 → 安全行 → 白名单 content；8 个命名契约用例（scope-before-store / blocked-cache-canary / redacted-erases-every-field / selected-fresh-in-partial / missing-is-unresolved / pending-never-shows-cache + 可见内容正控）。
- [x] 2026-10-05 CST：Batch D 2/4 落地 `packages/ui/src/work-item-detail.ts` + `work-item-project.ts` + 列表 opt-in anchor；5 个命名用例（same-drawer-from-both-entries / readonly-planning-source / text-is-escaped / Escape 单次关闭 + 旧列表回归）。
- [x] 2026-10-05 CST：Batch D 3/4 落地 `apps/web/src/item-route.ts`：codec 与真实 History adapter；4 个命名用例（initial-route-and-popstate / canonical-open-close-idempotent / invalid-segments-no-echo / dispose-stops-listeners）。
- [x] 2026-10-05 CST：Batch D 4/4 落地 `tests/fixtures/work-item-detail-browser.mjs` + 浏览器 bundle 契约 + 真实 sync/read 集成；`node tests/fixtures/work-item-detail-browser.mjs` 实际打印地址并同时服务两个 canonical pathname。
- [x] 2026-10-05 CST：本地验收全绿：四个契约文件 20/20、集成 3/3、列表回归 25/25、全套 contract+integration 1097/1097、typecheck exit 0、boundaries 8/8。
- [x] 2026-10-05 CST：按主控裁定修 Escape 双路径 → 唯一原生 cancel，并补 `Escape 单次关闭` 机械用例；随后做非判别性收敛以回到仓库硬门内。
- [x] 2026-10-05 CST：对抗验证（verify-269）在真实 Chromium 上判定安全/投影/新鲜度/只读面证实，证伪 fixture 挂载（P0）与 Tab 循环、Back 后重开、两条回焦（P1）。
- [x] 2026-10-05 CST：逐条补判别用例后最小修复 P0 + 3×P1：fixture 补 `window.ReactDOMClient = window.ReactDOM` 与真实 UI 接线；`cycleFocus` 用 `Array.from` 接受 NodeList；`publish()` 同步 `current`；opener 在列表 open 时捕获、容器用打开时快照；列表标题经 `headingTabIndex=-1` 可编程聚焦。
- [x] 2026-10-05 CST：真实 Chromium 矩阵 10/10 通过，并用 verify-269 的 `product-fixture-browser.mjs`、`matrix.mjs`、`p1-reopen.mjs`、`revoke-switch.mjs`、`modifier.mjs` 复跑；四契约 20/20、集成 3/3、列表 25/25、全套 1097/1097、typecheck exit 0、boundaries 8/8。
- [x] 2026-10-05 CST：gpt-6-sol 最终验收：锁定 head `12d9bb42c4d7`（工作树干净），独立复跑四契约 20/20、集成 3/3、列表回归 25/25、全套 1097/1097、typecheck exit 0、boundaries 8/8、`git diff --check` exit 0、disclosure exit 0、size 1000/1000；自写真实 Chromium 探针复验深链/列表/Enter 打开同一抽屉、Escape 单次 replace 且回焦 opener、Back 关闭/Forward 重开、Back 后重开真实 push、Tab/Shift+Tab 首尾回绕、320/768/1200 视口、模态打开中场景切到 redacted 即时清空且不导航、修饰键保留 href、投影不改入参。
- [x] 2026-10-05 CST：变异实验证伪空绿：M1 scope 移到列表门后 → 投影契约必红；M2 `publish` 不同步 `current` → 路由契约必红；M3 keydown 重新处理 Escape → 详情契约必红；M5 redacted 不擦字段 → 投影契约必红；M4 列表标题默认 `tabindex=-1` → 详情契约不红、列表回归套件必红（判别力落在回归套件，属正确分工）。全部变异后从备份恢复并校验逐字一致。
- [x] 2026-10-05 CST：最终验收重构（净减、不改变验收结果）：删除投影里与安全行重复的身份词表与 `pick`，identity.kind 改用安全行的同一份文案；fixture `href` 改用产品 `itemPath`；删一行多余空行。代码净 −6 行；重跑全部证据与重构前一致。
- [x] 2026-10-06 CST：外部评审 A/P1——codec 生成侧与解析侧两套判据导致 `%2F`、`%5C`、control、空段不自往返。收敛为单一权威：`itemPath` 每段先 `encodeURIComponent` 再用 `decodeSegment` 同一判据校验，表达不出 canonical 目标就抛 `TypeError`；解析器拒绝语义不变。契约补合法转义自往返（空格/加号/`%20`）与 4 类非法段抛错断言。变异：删去判据校验 → `canonical-open-close-idempotent` 必红。
- [x] 2026-10-06 CST：外部评审 B/P1——Interfaces 承诺的浏览器 HistoryPort 已作为产品代码落地：`apps/web/src/item-route.ts` 导出 `browserHistoryPort()`，fixture 入口改为 import 它并删除内联实现，真实 Chromium 矩阵改走产品 port。变异：`subscribe` 不映射 popstate → `browser-history-port` 必红。
- [x] 2026-10-06 CST：外部评审 C/P2——撕裂读（TD-024）：列表行可见但 `store.get` 已遮蔽时投影仍渲染可见标题。详情投影在 `deriveWorkItemDetail` 之后按 `detail.planning.contentKind === ContentKind.Redacted` 复验并返回 `redacted`。变异：删复验 → `撕裂读复验` 必红。
- [ ] Host 挂载仍归 #229；非 Chromium 引擎与 300ms 级并发时序未验证。

- [x] 2026-10-07 13:20 CST：上一会话主控（agent）重锁 PR #269 的 head / base、thread、checks 与 #129 / #130 / #228 / #229，确认与 #129 正式约束的冲突属实并阻塞闭环。
- [x] 2026-10-07 14:55 CST：上一会话写出 R0 草稿（本地 WIP `aa81b06`，未推送）；其中 ADR「Accepted」与 #129 原处 supersede 属于 agent 自我接受，已由下面的修订撤回。
- [x] 2026-10-07 15:20 CST：主控（agent）综合三路独立研究者（agent）的报告，作出 D1–D8（见 Decision Log）。
- [x] 2026-10-07 16:05 CST：独立 spec/plan 评审与修订者（agent）完成 R0 修订：ADR-0010 改为 Proposed 并按 D2 重写；`docs/adr/README.md`、`docs/README.md` 索引订正；#129 计划恢复为 `origin/main` 原文；本计划恢复 `e47f817` 的历史原文并就地标注 Superseded，新增门 H、R1 两个 owner 单元与 R2 / R3 的精确步骤。验证（`.worktrees/item-detail-plan`，检出 `feature/work-item-detail` @ `aa81b06`，改动未提交）：`exec-plan` lint 输出 OK；`tests/contract/plan-facts-consistency.test.js`、`e1-evidence-consistency.test.js`、`board-status-semantics.test.js`、`rule-checks.test.js` 共 69/69 pass；`git diff --check` exit 0；#129 计划对 `origin/main` 无差异；四个文档没有本机绝对路径，相对链接与仓库路径都存在（唯一缺失的 `tests/fixtures/work-item-wire.mjs` 由 R1 新建）。size / disclosure 只读提交对象，待主控提交本修订后重算。
- [x] 2026-10-07 16:12 CST：决策门 H——人类伙伴在会话中批准 H1（按原文）、H2 选「不建 issue」、H3 选「暂不处理、只记录」；17:10 CST 主控执行门 H 的五步机械动作，核对 `git diff --stat origin/main -- docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 为 `4 insertions(+), 2 deletions(-)`、`Superseded by` 计数 2、ADR-0010 状态行为第 1 步文字。
- [x] 2026-10-07 17:08 CST：R1-U1（`3d621af`）与 R1-U2（`172fe30`）由各自 owner 完成并经两轮对抗验证；独立验收者（agent）在 `.worktrees/item-detail-plan` 集成为 `cd1ff8b`、`3868e56` 并验收，另提交 `edac07e`（重构，−1 行）与 `c8f8e81`（非阻塞项硬化，+1 行）。`c8f8e81` 上 43 条变异整表 41 红、2 条预期绿，全量门全绿，代码 995 / 1000，#268 预演无冲突，浏览器面板回读通过；明细见 Batch R1「R1 集成验收记录」。
- [x] 2026-10-07 17:12–17:21 CST：R2——锚点 `backup/pr-269-route-locator-20261007-171217`；在 `origin/main@d911cc9` 上按路径重建三个交付物级提交（`e3064b5` / `112593c` / `f4f5cdc`）：`comm` 文件集无差，20 条非共享路径与旧 tip 逐字节一致，`docs/README.md` 只多本 PR 一行；中间提交 ② 单独 typecheck + 50 例通过；候选 HEAD 全量门 1117/1117、`pnpm verify` 1174 + 7、boundaries 8/8、size 995 / 687；精确 lease（old `e47f817`）推送。
- [x] 2026-10-07 17:21 CST：R3——远端 head = 本地、base = `d911cc9`、#130 双向关联、12/12 checks；改写 PR 描述；thread `PRRT_kwDOUekeas6pesrq` 回复并 resolve；请求 `Singularity-AI-Bot` 复评。19:37 CST 复评在 `f4f5cdc` 上 APPROVED，附 1×P2 + 6×P3 inline 与 1 条 PR 级 P3。
- [x] 2026-10-07 19:49–20:12 CST：复评处置（本地）——P2 fixture 列表路由 scope 门（静态渲染与浏览器共用同一个 mount）、X11 组合页 open 通道、codec 两个拒绝样本按 TDD 补齐，10 个新变异先证生效后全部变红（明细见 Surprises）；ADR-0010 状态行自带批准原文、L1 登记新鲜度通道；计划状态订正；与 #268 并集的详情字段跟进登记；独立验证者（agent）的 3 条 blocking 已按根因修复；计划移入 `docs/exec-plan/completed/`。
- [ ] R3 收尾（推送时执行，证据在 PR #269，本计划不自引用最终 head）：交付物级整合后精确 lease 推送；原 thread 更正 UUID 熵论证与 X11 表述；改写 PR 描述；7 条复评 thread 逐条回复并 resolve；回读远端 head、checks 与 review 状态。

## Surprises & Discoveries

2026-10-05 CST，`feature/work-item-detail` 源码调查：`derive.ts` 的 redacted 只清 title/body/primary，保留其他字段；因此直接渲染旧详情类型不安全。`work-item-list-view.ts` 明确按行计算 stale，整表 partial 不能替代 selected-row freshness。`sync.ts` 的 lose 只断连接并标陈旧，内容/时间已有保值机制，不需新增详情缓存。

同次调查：`apps/web/src/index.ts` 无 router/mount；现有 `tests/contract/ui-work-item-list-browser.test.js` 仅 bundle+vm+SSR，不能证明 dialog 焦点或导航。独立设计 A 的产品 route 导出仅 codec，导航逻辑留在 fixture；最终将其提升为 B 的实际 adapter，再与 A 的完整 fixture 组合，避免验收只证明测试内导航。本次未运行产品测试，已有其他设计者的测试回执不计为本计划产品验收。

2026-10-05 CST，Batch D 实施发现：`tsconfig` 的 `lib` 只有 ES2023、没有 DOM，而原生 dialog 需要 `showModal` / `querySelectorAll` / `document.activeElement`。追加 `dom-types.ts` 会让文件集超出计划白名单，因此把最小 DOM 结构面内联进既有的 `packages/ui/src/work-item-detail.ts`，全部成员可选、SSR 下为空。另一个发现是 `deriveWorkItemDetail` 对 `ChangeRequest` 行同样返回条目，安全行已经用 `contentKind` 把它筛掉，详情侧再判一次 `ContentKind.WorkItem` 会让 PR 行抛 TypeError；因此只判 `undefined`，把内容种类交给投影。集成测试还暴露：真实 baseline 的整表 `stale` 在 `markAllStale` 后是页级的，而安全行 `stale` 才是逐行结论——详情只取安全行值，避免整表 partial 把选中行洗成陈旧。

2026-10-05 CST，真实浏览器复跑观察：模态打开时点击背景列表 anchor 会被原生 `<dialog>` inert 拦截（`locator.click` 超时报 intercepts pointer events），这是 showModal 的预期语义而非缺陷——切项只经 Back/Forward、先关闭再点、或修饰键新标签，故计划不再声称"模态内可点背景切项"。

2026-10-05 CST，对抗验证发现真实浏览器面缺口：契约测试只做 SSR 与 bundle，未真正挂载，因此 fixture 的 UMD 全局名不匹配（client UMD 只装 `window.ReactDOM`）、`NodeList` 没有 `.filter`、`popstate` 后 `current` 失同步、抽屉标题挂载抢焦点导致 opener 恒为标题，四类缺陷全绿通过。教训：浏览器验收项必须由真实浏览器证据闭环，SSR/单测的绿不能替代；本轮把真实 Chromium 矩阵与变异证据补入验收。

2026-10-06 CST，外部评审发现 `itemPath` 与 `parseItemRoute` 是同一 codec 的两半却各有一套判据：生成侧只拒 `.`/`..` 后 `encodeURIComponent`，解析侧解码后拒 `/`、`\\`、control 与空段。内部 id 含空格以外的 `%2F` 类字符时生成器产出解析器不认的路径，`projectId:''` 同样产生 `/projects//items`。教训：编码器的"可表达"判据必须与解码器的"可接受"判据同源，否则往返不闭合；修复采用让 `itemPath` 复用 `decodeSegment`，而不是放宽解析器。

2026-10-06 CST，**待人类确认的决策冲突**：PR#269 的列表安全行把内部 `entityId` 放进标题 anchor 的 `href`（`/projects/<ws>/items/<entityId>`），并以此驱动深链；而 `docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 记录「`data-*`、`href` 和 DOM id 不放内部标识」。两条路径：(a) 维持现状——`entityId` 是本仓既有 entity 锚点、也是运行时必用的详情主键，深链可复现性与 issue #130 验收依赖它，旧记录的约束按"不泄露**额外**标识"解释；(b) 改为不透明路由 token（每工作区映射表或 hashid），`href` 与 URL 不再含 `entityId`，代价是引入路由层标识与映射存储、扩大本轮范围。本计划不擅自宣布旧决策失效，登记为待人类确认，未改代码。**Superseded by** Design / Spec 的「Route identifier decision gate」与决策门 H（2026-10-07）：冲突属实；处理方式不是由 agent 在 (a)(b) 之间选择或重新解释旧约束，而是把 ADR-0010（Proposed）作为提议，直接请求人类裁决 H1。

2026-10-05 CST，正式规模门与规划预算的差异：`rule-checks size` 给出代码 984/1000、文档 196/1500 时通过硬门；修 Escape 双路径并补机械用例后一度为 1007/1000，已做非判别性收敛回到 998/1000、205/1500，仓库硬门通过。规划预算 800 未达成的根因是判别测试与 fixture 共约 644 行，三轮收敛后仍高；再压只能删计划点名的命名用例或断言，违反“保留判别测试”。

2026-10-05 CST，最终验收发现：投影 `deriveWorkItemDetailView` 自己维护了一份与 `work-item-list-view.ts` 逐字相同的 `IDENTITY` 词表（`issue/draft/change_request`）和 `pick`，用它独立推导 `identity.kind`。安全行早已把同一值算成 `row.identity`，详情行再算一次是同一事实的第二个权威源——两处词表一旦漂移，同一个 `externalKind` 会在列表显示一种身份、在详情显示另一种。已收敛为直接复用安全行的 `row.identity`，删除重复词表（净 −6 行）。这类重复在验收里不表现为红色（两处当前同值），只能靠第一性审读发现；已用可见内容正控 `identity={kind:'PR',externalId:'ext-1'}` 继续覆盖。

2026-10-05 CST，最终验收对「假绿」做变异实验：M1（把 scope 检查挪到 `deriveWorkItemListView` 之后）→ 投影契约必红；M2（`publish` 不同步 `current`）→ 路由契约必红；M3（keydown 重新处理 Escape）→ 详情契约必红；M5（redacted 行不擦字段）→ 投影契约必红；M4（列表标题默认 `tabIndex:-1`）→ 详情契约不红、列表回归套件必红。M4 的判别力确实存在，只是按职责落在 `work-item-list-*` 回归套件而非详情契约文件；结论：现有命名用例对这批关键不变量有牙，不是断言了错误的东西。所有变异后均从备份恢复并校验逐字一致。

2026-10-07 CST（上一会话的独立 spec review，agent）：先前论证把「默认生成 UUID」扩大成了 ID 类型保证。生产路径确为随机 UUID——`packages/core/src/identity.ts` 的 `ensureEntity` 经 `packages/core/src/context.ts` 的 `defaultIdFactory` 调 `packages/domain/src/ids.ts` 的 `newEntityId()`，`WorkspaceId` 缺省 `newWorkspaceId()`、重启恢复时由调用方传入——但 `asBrandedId()` 接纳任意字符串，`chainEntityId()` 产生确定性 id。结论：安全论证不得依赖熵；`deriveWorkItemDetailView()` 是给定 scoped read 上的最小披露，不是 Host 授权；#228 / #229 的验收都不含多用户对象级授权。

2026-10-07 CST（独立研究者，agent）：同一约束有四份副本（见 Design 的决策门一节），唯一会失败的 `tests/contract/ui-work-item-list.test.js`「泄漏面」用例只覆盖无 navigation 模式，新模式由此绕开了检查。`e47f817` 上与 R1 相关的断言大多空绿（数字见 Artifacts and Notes），原因是 `same-drawer-from-both-entries` 只收集 `a` 上的 onClick、`href` 桩不记录调用、带 navigation 的列表 HTML 从未被断言；fixture 的 `renderStatic` 传 `navigation: undefined`；产品里没有 `ItemNavigation.href` 的生产方，只有测试与 fixture 拼出。上一轮「fixture 使用产品 `browserHistoryPort()`」的修复在该 head 上同样空绿。

2026-10-07 CST（独立研究者，agent）根因链：C1 设计期没有核对上游正式约束（`d09a29c` 只把 #129 计划当「上游验收记录」）→ C2 实施期发现冲突（生效）→ C3 决策路由错误（PR 描述请评审者「一并裁定」，人类没有被直接问到）→ C4 归档门只看验收通过（`PLANS.md` §2）而放行 → C5 评审门拦住。R0 草稿又在 C3 失效一次（agent 把 ADR 写成 Accepted）。机制：约束写成没有保护对象与理由的前瞻禁令；一个事实四份副本而机械检查只覆盖一种模式；保留给人类的决定被路由给评审者；归档门不区分「与正式约束冲突」与「无冲突的后续取舍」。主要矛盾是 agent 持续自我闭环与决定权保留给人类，token 与否是次要矛盾。

2026-10-07 CST（独立 spec/plan 评审与修订者，agent）：R0 草稿还有三处机械错误——把 Active 行插进了 `docs/README.md` §1「目录职责」表、改写了 `e47f817` 已发布的历史段落而没有保留原文、对 #129 计划的修改没有人类批准；已在本次修订纠正。另有两处新发现：client store 按 `entityId` 排序（`packages/client/src/store.ts` 的 `sortedList`），redacted 行的相对位置随其 id 变化，所以 L1 限定为不改变相对排序的字段变化；综合输入的规模表与 probe 的 992 都不含 A3 与 L1，改用 F′ 后预计 993。

2026-10-07 17:08 CST（R1 独立验收者，agent）：集成树上的整表变异另外暴露四处空绿，都在两轮对抗验证的判定之外：① L1 只对照标题、`bindingId`、外部身份与 entityId，遮蔽条目的正文、规划状态与派生进入列表页时全套 1099 个用例仍绿（X7 / X7b / X7c，即验证者的 N5b 加正文）；② fixture 本身是 L1 的判据，`redacted()` 一旦忽略覆盖参数，L1 静默退化为只比较 entityId，叠加标题长度泄露也全绿（N9b+N10）；③ 组合页渲染两个 dialog 仍绿，「唯一 drawer」没有机械判据（X5）；④ bundle fixture 的遮蔽条目与 `redacted` 场景的目标脱钩时详情退化为 missing，负控因列表行本身含「内容不可见」而仍绿（X12a）。四处都只改本 PR 新增的行或用本 PR 内的净减抵扣（见 Decision Log），修后全部变红。规律与 Batch D、U1 两轮一致：每次补判据只覆盖当次点名的字段或通道，「对照输入真的不同」「判据只在目标区域内成立」这类元属性要单独证明。

同次：上一轮「fixture 使用产品 `browserHistoryPort()`」的空绿已由 E 关闭——M-port 在 `c8f8e81` 上红，同一变异再删去 E 断言即 50/50 绿。仍然空绿、记为已知限制的有：组合页 `routed.open` 传错 id（X11）只有浏览器点击能抓到，Node 套件不执行组合页的事件（**Superseded by 2026-10-07 复评处置**：沿用「事件回调机械判据」的 hook 调度器桩直接调用组合页即可取到 routed `open`，新断言让 X11 与「不记 opener」两个变异都变红，不再是已知限制。）；E 是源码文本 tripwire，保留匹配文本而绕过产品 port 的写法（验证者 N12）挡不住；C 的 SSR 断言对无需转义的 id 分不出是否经 codec（验证者 Me-sameshape，codec 本身由 M-codec 与 X4 覆盖）。

同次，规模与纪律：计划预计集成后 993，实测 U1 单独 996、U2 单独 998、集成 995（A3 与 L1 的实际成本高于预算账）；验收者两处提交净 0（重构 −1、硬化 +1），代码停在 995，没有删任何断言。变异 runner 首版的 X7c 与 N9b+N10 直接读 `x.entity.content.body.length`，真实 sync 读取链上遮蔽条目没有 `body`，在三个 `sync-*` 集成用例上抛 `TypeError` 而「变红」，与 L1 无关；改为先判类型再取值后重做，表中为重做结果。「变红」必须核对首条断言消息，而不只看失败数。

2026-10-07 19:49 CST，复评暴露的机制缺口：scope 门只写在详情投影（`deriveWorkItemDetailView` 先比 `target.projectId` 与 `read.workspace.id`），列表投影本身不认识路由。fixture 挂载因此在未知路由时回落到场景工作区，跨工作区时照样渲染当前 read 的整张列表，并用外来 projectId 生成死链；Node 套件没有一例走列表路由，Validation 的「跨scope 已过」实际只覆盖详情。修复把 scope 门放在 fixture 唯一的 view 组合点 `views`：projectId 不等于 `read.workspace.id`（含解析失败的未知路由）时不派生任何 view，屏幕只出中性 unresolved，href 只可能用通过 scope 的 projectId；`renderStatic` 改为接收 pathname 并经产品 `parseItemRoute` 解析，与 mount 走同一条 codec → scope 门路径。#229 的真实挂载应照此样板。补测时还踩到一个陷阱：第一次用 `renderStatic(name, undefined)` 表示未知路由，被默认参数悄悄换成 `ws-1` 的合法路由——测试输入要用会真实发生的形状（pathname），不用会被默认值吞掉的 `undefined`。

同次：R1 记为「只有真实点击能抓到」的 X11 不成立——「事件回调机械判据」已有的 hook 调度器桩可直接调用组合页并取到 routed `open`，4 行断言同时钉住 id 原样转交与 opener 记录。codec 的 `/projects/:p/item/:i` 第二路由形状与解码后 `.`（`%2e`）两个变异此前存活，已补为拒绝样本。并集方面，详情 content 不含 #268 的 iteration / targetDate，「详情状态 = 列表状态」在 #269 单独时是等价变异，只有并集可观察。

同次的变异明细（每条先以 `git diff -U0` 证明生效，在复评处置后的集成树上都只让指定用例变红，恢复后 50/50）：X11 组合页 routed `open` 传错 id、X11b 不记 opener（`事件回调机械判据`）；C7a 接受 `/item/`、C7b 解码后不拒 `.`（`invalid-segments-no-echo`）；P2a 去掉 `views` 的 scope 门、P2b 只拦未知路由、MP2 mount 未知路由回落 `ws-1`、MP3 mount 用当前 read 派生而 href 用路由、MP4 unresolved 回显路由（`vm SSR 正控`）；M-port mount 默认改为手写 port（`完整路径`）。X11、X11b、C7a、C7b 在复评所看的 `f4f5cdc` 上都是 50/50 绿，MP2、MP3 在独立验证者所看的 `785f268` 上也是绿。仍只在真实浏览器验证的是：mount 的默认 port / root 创建；open / close 回调传给 adapter 的 id 与 projectId（`renderStatic` 不调用回调，独立验证者的 MN1–MN4 在 Node 套件中为绿；真实 Chromium 中点击 push `/projects/ws-1/items/ent-aa`、Escape replace `/projects/ws-1/items`）；焦点管理；cleanup 不触发额外导航（重复调用被 adapter 去重而不可观测）。href 的 projectId 绑定由新增的 `scoped @ /projects/ws-2/items` 断言覆盖。

## Decision Log

2026-10-05 CST / 独立最终评审者：选择原生 modal dialog + 唯一安全投影 + apps/web History adapter。理由是两入口共享权限与绘制，浏览器承担模态机制，实际导航可测且不扩大到 Host 装配。

2026-10-05 CST / 独立最终评审者：统一列表路径、隐藏 bindingId、删除 missing.confirmed、时间改为工作区确认帧；A/B 分歧按真实源码契约收敛。没有证据支持确认404、对象级更新时间或展示内部连接标识。

2026-10-05 CST / 独立最终评审者：#126/#130/#133 语义并行；共享文件由单 owner 串行整合，不能把可并行能力硬串为 stack。未批准任何 Status、blocked-by 或 blocking 写入；本次边界为 Batch P。

2026-10-05 CST / 主控：Actor 为 SingularityKChen；管理目标是 GitHub 仓库 SingularityKChen/harness-projects 与 Project 10，不虚构产品内 ProviderBinding。幂等标识为 `plan/issue-130/feature/work-item-detail`，字段赋值以 issue/字段名去重；创建结果为 PR #269。观察时刻 @ d09a29c880e6：base=main、draft=true，PR closingIssuesReferences 包含 #130、issue closedByPullRequestsReferences 包含 #269，无评审线程，标题/标签/issue policy 检查通过。Project ExecPlan/Batch 已回读匹配，Kind/Area/M4 已具备；Status=Todo、Priority=P0、Size=M、Iteration 5 及依赖关系保持原值。易失结果用 `gh pr view 269 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 和 `gh issue view 130 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences,projectItems` 复读；最终文档 push 后再次回读当前 head/checks。

2026-10-05 CST / Batch D 实施者：保留全部判别测试与规划预算差异，不继续压行。规划预算代码 ≤800 来自三个设计者的早期估算（产品 330 / 测试 325 / fixture 115）；实际落地为产品 338、测试+fixture 644，差异主要在 canonical 命名的契约用例、真实 bundle 输入面/负控与真实 sync/read 集成——这些正是计划 Validation 表点名的决定性证据。已做三轮收敛（合并单用途辅助、收敛 fixture 场景表与入口页脚本、登记型去重），再压缩只能删除命名用例或断言，违反“保留判别测试”。仓库硬门 1000/1500 通过，因此按 Global Constraints 收敛优先于行数，保留超额并在此记录。

2026-10-05 CST / 主控裁定：接受规划预算 800 未达成，以仓库硬门 1000/1500 为准，保留全部命名判别用例，禁止删测试压行；偏差登记在 Global Constraints、Surprises 与本节。

2026-10-05 CST / Batch D 实施者：P3 收敛——`decodeSegment` 在解码前后都拒绝纯 `.`/`..`，`itemPath` 对 `.`/`..` 段抛 `TypeError` 而不是产出 `/projects/../items` 这类可穿越的非 canonical 路径；`invalid-segments-no-echo` 增加 3 个非法样本与抛错断言。变异：去掉两处拒绝 → codec 两个用例必红。

2026-10-05 CST / Batch D 实施者：verify-269 对抗验证的 4 条缺陷按真实 Chromium 最小复现逐条修复，并补「加回缺陷必红」的判别证据。P0：fixture client UMD 只装 `global.ReactDOM`，入口页补 `window.ReactDOMClient = window.ReactDOM`，`mount` 再做 `(ReactDOMClient ?? ReactDOM).createRoot` 兜底，契约测试断言两者。P1-a：`cycleFocus` 改 `Array.from(...)` 接受 NodeList（变异：改回 `.filter` → 事件用例必红）。P1-b：`publish()` 同步 `current = port.pathname()`（变异：去掉 → 路由两用例必红）。P1-c：opener 改为仅在列表 open 回调里捕获、容器用打开时快照 `openerContainer`（变异：移回 effect 读 activeElement → 真实浏览器 `C2` 必红），列表标题经 `headingTabIndex=-1` 可聚焦且独立列表页输出不变。真实 Chromium 矩阵 10/10 通过。

2026-10-05 CST / Batch D 实施者：Escape 收敛为唯一路径。原实现同时在 keydown 与原生 `cancel` 各调一次 `onClose`，真实浏览器同一次 Escape 可能关闭两次，违反计划「Escape 的 cancel 先 preventDefault 再调用一次 onClose」。删除 keydown 的 Escape 分支，keydown 只留 Tab 循环；新增命名用例 `Escape 单次关闭` 用真实 React hook 调度器直接调用组件，机械证明 Escape keydown 下 onClose 计数为 0、cancel 下 preventDefault 与 onClose 各恰好 1 次（把 Escape 分支加回时该用例必失败）。该修正使代码一度回到 1007/1000，故同步做一次非判别性收敛（合并重复断言与 fixture 辅助）回到 998/1000，不删除任何命名用例。

2026-10-05 CST / gpt-6-sol 最终验收与重构者：在验收 head `12d9bb42c4d7` 上判定八行验收通过、闭环达成（此时 `size` 为 1000/1000），随后做三处**不改变验收结果**的净减重构：① 投影删除与安全行重复的 `IDENTITY` 词表与 `pick`，`identity.kind` 直接取 `row.identity`——同一事实不再有第二个权威源，也移除词表漂移面；② fixture `href` 从字符串拼接改为产品 `itemPath`，使 fixture 的真实入口与 canonical 生成器同源（verify-269 的 P3，本轮顺手消除）；③ 删一行多余空行。三处都不删任何命名用例、不降低判别力。重构提交后重跑全部证据：四契约 20/20、集成 3/3、列表 25/25、`pnpm verify`（typecheck+contract/integration/e2e+mvp0）exit 0、boundaries/diff/disclosure/workflow-check exit 0、`size` 994/1000 代码 233/1500 文档；真实 Chromium 复探（同一抽屉、Escape 单次 replace + 回焦、Back/Forward、Back 后重开真实 push、Tab 首尾回绕、320/768/1200、打开中撤权即时清空、修饰键保留 href、Enter 激活、投影不改入参）全部通过。重构前后验收结论逐条一致。

2026-10-05 CST / gpt-6-sol 最终验收与重构者：明确保留与本轮不改的项——不新增依赖、不动 lockfile、不改 domain/capabilities/core/controller/client/storage/providers；不改 `DOMElement` 结构面（`contains`/`querySelector`/`hasAttribute` 仍有真实调用点，非过度声明）；不改回焦逻辑（三条真实浏览器判据已覆盖，简化会改动焦点语义、超出“不改变验收结果”）；`change_request` 行在列表显示为 item、深链详情返回 content，这与列表基于 `contentKind` 的既有安全行语义一致，详情不再二次判 `ContentKind`（此前决定），不属本轮缺陷。不 push、不改 PR、不合并。

2026-10-06 CST / Batch D 实施者：按外部评审逐条修复 A/B/C，D 随 A 覆盖真正会坏的边界（非法段抛错 + 合法转义自往返）。单一权威原则：`itemPath` 复用 `decodeSegment` 判据；`browserHistoryPort` 成为唯一浏览器 port 实现（fixture 不再自持一份）；详情侧对 `ContentKind.Redacted` 复验，避免撕裂读用列表行回填内容。三项各有"注入缺陷必红"变异证据，净增控制在仓库硬门内（文档改动独立计入）。不 push、不改 PR。

2026-10-06 CST / Batch D 实施者待人类裁定：`entityId` 进 `href` 与 `2026-10-01-work-item-list-states` 的「不放内部标识」记录相反。按任务要求只登记、不改代码，标「待人类确认」。**Superseded by** 2026-10-07 15:20 CST 主控（agent）的 D1：改为通过决策门 H 直接请求人类裁决。

2026-10-07 15:20 CST / 主控（agent），输入为三路独立研究者（agent：威胁模型与同类工具、治理与根因、实现与变异）的报告。D1：P1 定性为治理 / 决策门 P1，事实属实且更宽；不表述为已证实越权，也不转述为「唯一修复是 token」；评审给了两条路径，本次走「人类修订并归档约束」。D2–D4：ADR-0010 在 H1 前保持 Proposed，#129 计划在批准前恢复原文，索引移到 Active 表。D5：R1 拆为文件集互不重叠的 U1 / U2 并把 L1–L3 绑定到变异；R2 三个交付物级提交；R3 归档门加一条。D6：不为多用户对象级授权建 issue、不改 #228 / #229 验收、不登记 tech-debt（不是本 PR 主动延期的工作），以 H2 请人类确认。D7：流程改进另开闭环（H3）。D8：不改 main 上 `tests/contract/ui-work-item-list.test.js` 的「泄漏面」用例。Rationale：`docs/adr/README.md` 规定 Proposed 的采纳权在人类伙伴；批准前写原处 supersede，等于 agent 替人类修订正式约束，正是 C3 的再次失效；其余见 Design 的决策门一节与 ADR-0010。

2026-10-07 16:05 CST / 独立 spec/plan 评审与修订者（agent）：采纳 D1–D8，并按证据订正综合输入七处——① A3 改的是 main 既有行，计 +2（与本 PR 新增行合并时 +1）；② 综合规模表与 probe 实测都不含 A3 与 L1，改用 F′（精确对象断言，−2）代替 `Object.keys`（+1），预计 993；③ L1 限定为不改变相对排序的字段变化（store 按 `entityId` 排序）；④ L3 的「外部身份 id」澄清为 `ExternalIdentityId`，Provider `externalId` 是详情既有的可见文字；⑤ H3 的「Refs #67」与 #67 的范围（看板写入审批记录的机械核对）不完全匹配，改为请人类选择；⑥ R2 按路径而不是按旧提交构造，main 改过的文件只用 3-way 套用差异，避免静默回退 main，且 `f9a4896`、`efa0b07` 中的计划改动归 ③；⑦ 上一轮三项修复的变异由所属单元执行，并在集成树整表复测，而不是两个 owner 各跑一遍。G 的拒绝理由改为「显式返回类型是 Interfaces 声明的公共契约」。`docs/README.md` 的本计划行放在 Active 表末行，避开 main 与 #268 都在表顶插行的位置。Rationale：每处都有文件或命令证据（Surprises 与 Artifacts and Notes）。

2026-10-07 16:05 CST / 本轮记录：没有任何人类批准。H1、H2、H3 都待人类伙伴裁决；H1 的记录出现之前，任何文档都不得把 ADR-0010 写成 Accepted，#129 计划不得出现指向 ADR-0010 的标注。

2026-10-07 17:08 CST / R1 独立验收者（agent）：结论——R1 通过。依据：集成无冲突且与两个输入逐文件一致；43 条变异在最终代码树 `c8f8e81` 上 41 条按预期变红，2 条绿均为预期（删去 E 的 M-port 对照、X11 已知限制——**Superseded by 2026-10-07 复评处置**：沿用「事件回调机械判据」的 hook 调度器桩直接调用组合页即可取到 routed `open`，新断言让 X11 与「不记 opener」两个变异都变红，不再是已知限制。）；全量门全绿，代码 995 / 1000；#268 预演无冲突。复评主控在 U1 第二轮的收敛（第二个遮蔽条目换 `externalKind`、检查第二次渲染的可点击元素、组合页 deepLink 前移到 href 断言之前）：N5、N11、N6e 在集成树上都只在 `same-drawer-from-both-entries` 的对应断言变红，判定成立。本结论不是 H1 的批准；ADR-0010 状态、#129 计划与 `docs/README.md` 未改（`docs/README.md` 本行的「R1–R3」由门 H 第 5 步改写）。

2026-10-07 17:08 CST / R1 独立验收者（agent），两轮验证者非阻塞清单的处置：
- 采纳并修复（`c8f8e81`）：N5b 及正文——`redacted()` 增加状态 / 派生 / reason 覆盖参数，L1 的第二个遮蔽条目同时换掉正文、规划状态、派生与 reason；N9——L1 前加自检，第二个条目序列化后不得含第一个条目的任何对照值；fixture 默认值负控（V9a / N8）——`vm SSR 正控` 改为断言 dialog 内是 `<p>内容不可见</p>`，并去掉只用一次的变量；外加验收者发现的 X5——组合页的 dialog 计数必须为 1。
- 采纳并修复（`edac07e`）：A2 注释补 `aria-*` 与 `title`，与 ADR-0010 L3 一致（改的是本 PR 已改写的 main 行，不增加计数）；C 的断言消息不再声称能区分是否经 codec（Me-sameshape）。
- 记录为已知限制：`mount` 粘合层没有 Node 自动化（N9–N11 / V8 / V8b），本轮以浏览器面板回读代替，建议 R2 候选 HEAD 上按 Batch D 矩阵再回读一次；E 是文本 tripwire（N12 / V13b）；组合页 `routed.open` 的 id（X11 / N6 / N6d）；`hrefOf` 忽略 id（V10，fixture 只有一条 visible 行，按 id 调用由 L2 负责）。
- 拒绝修改：`ItemRow` 注释「行 key 只给框架，不进任何属性」处在描述 redacted 行的句子里，限定成立；改它是 main 既有行（+2），且 #268 同改 `packages/ui/src/work-item-list.ts`，徒增冲突面。可读性项（fixture 第 50 行约 230 字符、L1 / L2 断言较密）：每条断言单一、消息标明所守属性，L1 已顺带拆成「构造 → 自检 → 渲染 → 断言」，其余不为可读性多付行数。
- 已由他人收敛或留给 R2：U1 / U2 执行记录的时间与提交数已由主控在合并前改正；U2 记录的文档数「约 601」以集成树实测为准（`3868e56` 上 615）；提交没有 Co-Authored-By 尾注，本地提交按仓库约定以 `Refs #130` 结尾，R2 交付物级整合时统一处理。验证者的确认项 N8 / N9a（`derived` 默认值改回 `['ci_failing']` 仍全绿）本轮未复测，结论沿用。

2026-10-07 17:08 CST / R1 独立验收者（agent），重构取舍：只做两类——同一输入只构造一次（`redacted-erases-every-field` 的两次 `make` 合并，−1）与注释、断言消息和 ADR 对齐；拒绝把 `apps/web/src/index.ts` 的值与类型两条 re-export 合并来省行（仓库各 index 都分写 `export type`，为省一行改风格不算净化）；`apps/web/src/item-route.ts` 的公共签名与显式返回类型未动。提议（不在本批执行）：ADR-0010 L1 的字段表只列标题、`bindingId`、外部身份与 entityId，测试现已覆盖正文、规划状态、派生与 reason；是否在门 H 提交前让 ADR 文字跟上由主控决定，这不改变 H1 的批准陈述。

2026-10-07 16:12 CST / 人类伙伴在会话中批准 H1，主控（agent）记录：「Approve as written (Recommended)」——所选问题为「H1 (blocks push/reply): Approve ADR-0010 → Accepted? Planning-entity WorkspaceId/EntityId become the observable, non-secret, non-capability canonical locator in /projects/:projectId/items/:itemId; only visible item rows get that href. The #129 plan's line 115 (href) and 121 (no detail entry) get a scoped in-place supersede; redacted rows still get no href, and locators stay out of data-*/DOM id/text/detail body. bindingId/ExternalIdentityId/credentials never appear, and lineage ids are not routable.」目标：ADR-0010 状态行；#129 计划第 115、121 行。批准未附修改，按门 H 的固定文字执行（17:10 CST）。

2026-10-07 16:12 CST / 人类伙伴在会话中裁决 H2，主控（agent）记录：「Leave untracked (Recommended)」——demo / MMP 前单用户，不为多用户对象级授权建 issue，不改 #228 / #229 验收；由引入第二个主体的 issue 自行承接（ADR-0010 Consequences 第 1 条）。

2026-10-07 16:12 CST / 人类伙伴在会话中裁决 H3，主控（agent）记录：「Not now」——归档前置条件、决策请求协议与约束写作规则的 `PLANS.md` 改进本轮不开 issue、不扩展 #67，只在本计划记录：根因见 Surprises 中 2026-10-07 的机制链（约束写成无保护对象的前瞻禁令、四份副本只有一种模式被机械检查、人类决定被路由给评审账号、归档门不区分与正式约束冲突的未裁决项）；#269 内只局部应用 R3 归档门的一条。

2026-10-07 17:10 CST / 主控（agent）：H1 批准后按 R1 验收者的建议，把 ADR-0010 L1 列举的遮蔽字段补齐为测试实际覆盖的「标题、正文、规划状态、派生提示、reason、`bindingId`、外部身份与不改变相对排序的 `entityId`」。这是让 ADR 文字跟上已验证的判别力的加强，不改变 H1 批准陈述的任何一项（locator 范围、visible-only href、#129 第 115 / 121 行的限定 supersede 与保留的禁令）。

2026-10-07 19:49 CST / 主控（agent），复评（`Singularity-AI-Bot`，19:37 CST，APPROVED）处置：
- P2 fixture 列表路由无 scope 门：属实。按根因把 scope 门放在 fixture 唯一的 view 组合点并补三例逐字断言（见 Surprises）；产品 ui-model 不新增路由投影——挂载是壳的接线职责，#229 照 fixture 样板实现。
- P3 X11 已知限制不成立：属实。补断言，Surprises、R1 验收记录与 Validation 中的旧结论原处标注 Superseded。
- P3 计划状态落后于 head：属实。订正状态行、术语段、Interfaces、Validation、Progress 与 Bottom Change Note。
- P3 与 #268 并集的详情字段：不是 #269 单独的缺陷。按评审建议由后合并的一方承接——#269 先合并时由 #268 在详情接线中补 iteration / targetDate 与 unknown + statusName 的判别用例；#268 先合并时 #269 rebase 时补。本轮不开新 issue，合并顺序由人类伙伴决定。**Superseded by 同日后续**：评审会话经人类伙伴批准已开 #274 承接（GitHub 回读核实），本计划以 #274 为承接者。
- P3 L1 未登记新鲜度通道：属实。在 ADR-0010 L1 登记，并指向 #129 的人类裁决 D / E 与 #229 验收；不改代码。
- P3 Accepted 与批准记录分处两个提交：选「批准随产物走」——ADR-0010 状态行自带批准时刻与所选答复原文，提交 ② 自足；提交 ③ 只回填过程记录，可单独回退而不留下无批准的 Accepted。**Superseded by 同日复评验证条目与 R2 回滚段**：单独回退 ③ 会让 ADR 来源行与 #129 标注引用的决策门 H 悬空，回退单位为 ② + ③ 一起。
- P3 codec 两个存活变异：补拒绝样本，0 行。
- PR 级 P3：PR 描述与原 thread 回复把「列表行 id 由 `randomUUID()` 生成」当作非漏洞依据，与 ADR-0010「安全结论不依赖格式、熵或不可枚举性」矛盾。依据改为 ADR 的实际依据（单用户本机部署、locator 不是授权凭据、locator 内容规则保证 URL 不携带已授权页面之外的信息）：推送时在原 thread 发更正并改写 PR 描述，X11 的限制表述同步撤回；执行与回读以 GitHub 为准。
- 规模：修复后代码 998/1000——P2、mount 同路径与 X11 的新增，由删除仓库内无代码读者的 fixture `calls` 计数器（R1 浏览器回读曾手工读取 `window.__calls`，该记录已原处标注改由 history 观察）、内联只用一次的 `T` / `BIND` / `wired` / `screen` 与合并注释抵消，未删任何断言。

2026-10-07 20:12 CST / 主控（agent），复评修复的独立对抗验证（验证者 agent，在 `785f268` 上不通过，3 条 blocking）处置：
- B1 P2 修复在 mount 上空绿（MP2 未知路由回落、MP3 用当前 read 派生而 href 用路由，均 50/50 绿）：属实，根因是 fixture 有 `renderStatic` 与 `mount` 两个组合点而测试只走前者。改为 `renderStatic` 调用真实 `mount`（固定路径 port + 只捕获 HTML 的 root），`mount(element, port = browserHistoryPort(), root = createRoot(element))`；E 改为钉住 mount 的默认 port。MP2、MP3 与 M-port 随即变红。
- B2 计划把尚未发生的外部写入与推送记成已完成：属实。Progress、Validation 与 Decision Log 改为「推送时执行，证据在 PR」，本计划不自引用最终 head。
- B3「删除无读者的 `calls`」不属实：仓库内无代码读者，但 R1 浏览器回读手工读过 `window.__calls`。不恢复计数器，原处标注改由 history 观察。
- 非阻塞：unresolved 文案改用 Design 表的「当前快照未找到此条目，是否存在尚未确认」（坏路由与跨工作区不一定是工作区缺失）；X11 断言消息不再宣称先后顺序（X11c / X11d 不在该断言范围内）；ADR L1 的「由 R1 补。」移到新鲜度句之前；打开详情时切到跨 scope，整页替换为 unresolved、焦点落到 body，与 Design「scope 改变时聚焦当前列表标题」不再适用（列表不再渲染），登记给 #229 的真实挂载决定焦点；并集与 scope 门样板的交接：评审会话经人类伙伴批准已开 #274（详情显示迭代与目标日期），并在 #229 验收加入「未知路由与跨工作区列表路由只出中性 unresolved、href 只用通过 scope 的 projectId」一项（GitHub 回读核实）。

2026-10-07 20:22 CST / 人类伙伴在会话中裁决 ADR-0010 L1 的新鲜度措辞，主控（agent）记录：「调研类似项目的做法综合判断」——所问为「保留"按 #129 D / E 由 #229 关闭"的措辞」与「改用评审会话呈上的"与行序一样不视为泄露"」二选一。评审会话已撤回后者：它与 #129 的人类裁决 D（#229 验收：redacted 行不参与也不声明新鲜度）矛盾，属该会话把问题出错。主控据此调研并裁定保留 D / E 措辞，并在 ADR 写明理由：存在性经占位行公开是同类工具认可的产品选择（GitHub Projects 的 `REDACTED` 项），遮蔽条目的派生状态进入可见聚合则被同类工具当作信息泄露修复（GitLab CVE-2019-12429 机密 issue 的状态与计数经里程碑页泄露、CVE-2019-15579 经里程碑泄露指派人；Jira 的 issue security 下不可见 issue「不以任何方式报告」）。评审会话转述的其它人类批准（收尾写入、#273 / #274 / #133 / #229 / #71 的 issue 写入、合并次序）由该会话执行或在本计划中只作为已核实的 GitHub 事实引用，本计划不据转述执行人类专属决定。

2026-10-07 20:22 CST / 主控（agent），复评修复第二次独立验证（验证者 agent，`c34c09d`，1 条 blocking）处置：计划把 mount 的 Node 覆盖面写宽了——`renderStatic` 不调用 open / close 回调，MN1–MN4（回调用错 projectId / 忽略 id / close 不导航）与 MN6（href 写死 `ws-1`）在 Node 套件中为绿。选择补 1 行断言覆盖 href 的 projectId 绑定（`scoped @ /projects/ws-2/items`，MN6 变红），回调目标如实归入「只在真实浏览器验证」并给出 Chromium 观测；不为 fixture 回调再加 2 行，避免把代码余量压到 0。同次订正：第 367 行注明 history 观察弱于原计数器；C6 处置原处标注 Superseded；状态行不再写「已闭合」；Design 第 73 行注明跨 scope 焦点对 fixture 不再适用；#274 与 #229 验收项作为承接者写入。

2026-10-07 20:47 CST / 主控（agent）：评审账号在 `aafc172` 上 APPROVED 后的 4 条 P3 全部按其修复方向处置（见 Bottom Change Note 同日条目）。#229 验收新增的焦点项（GitHub 回读核实，12:46Z 更新）由评审会话写入；据该会话转述，人类伙伴约 20:45 CST 以「Approve both (Recommended)」批准该写入。本计划只引用该验收项，不据转述执行人类专属决定。

## Idempotence and Recovery

纯投影重复计算无副作用，不保存可见正文；收到新 read 立即重新归约。showModal 只在未打开时调用，view 变化不重置焦点；dispose/cleanup 重复安全且不导航。scope 不匹配先拒绝内容，禁止用旧工作区填补新目标。

命令可重复运行；测试/fixture 使用合成数据，不写真实 Provider。依赖安装失败先恢复可复现依赖环境再验证，不能把缺包归因产品。组件生命周期或预算不成立时停在 D 验收门修订，不发布“已完成”。回滚按对应批次撤销任务提交，不删除用户 worktree/数据库；归档后如恢复工作，计划移回 active 并记录原因。

Review repair：R0 与门 H 的文档改动可重复执行，以 `git diff origin/main -- docs/exec-plan/completed/2026-10-01-work-item-list-states.md` 判断 #129 计划是否仍是原文。R1 两个单元在各自 worktree 的本地分支上可以丢弃重做；变异只用 `git checkout -- <file>` 恢复，并以 `git status --short` 证明干净。R2 / R3 的恢复锚点、lease 与回滚写在各自批次；冲突或 lease 不匹配一律停下重锁，不扩大 force，不对 main、其他 worktree 或未跟踪文件做 reset / 删除。未到 MMP、没有已发布的公开深链，locator 决策直接订正事实源，不维护双 URL、redirect 或 token 兼容层；将来若需要隐藏存在性或跨会话不可关联，先立新的 ADR 与 issue，再直接改 schema / ports / types / tests。

## Interfaces and Dependencies

新接口均 readonly。ui-model：`WorkItemDetailTarget = { readonly projectId: string; readonly itemId: string }`；`deriveWorkItemDetailView(input: WorkItemListReadInput, target: WorkItemDetailTarget): WorkItemDetailView`。View 只有 `body` 联合：`{kind:'loading'}`、`{kind:'unavailable';message:string;remaining:string}`、`{kind:'unresolved'}`、`{kind:'redacted'}`、content。content 精确字段为 `kind:'content'`、`title/body/planningStatus/source/authority: string`、`identity?: {readonly kind:string;readonly externalId:string}`、`derived?: string`、`stale/refreshing: boolean`、`lastUpdatedAt?: string`，不带原始业务对象。

UI：`WorkItemDetailDrawer({view,onClose}: {view:WorkItemDetailView;onClose:()=>void}):ReactElement`；`WorkItemProjectPage({listView,detailView,navigation,onCloseDetail})` 参数分别为 `WorkItemListView`、`WorkItemDetailView|undefined`、`ItemNavigation|undefined`、`()=>void`。`ItemNavigation = { readonly href:(itemId:string)=>string; readonly open:(itemId:string)=>void }` 是 UI 无状态回调契约；`WorkItemListPage({view,navigation?})` 消费同一契约。组合页持 DOM ref 回焦，不持业务缓存。

apps/web：`ItemRoute = {readonly projectId:string;readonly itemId?:string}`；`parseItemRoute(pathname:string):ItemRoute|undefined`；`itemPath(route:ItemRoute):string`；`HistoryPort = {pathname:()=>string;push:(path:string)=>void;replace:(path:string)=>void;subscribe:(listener:()=>void)=>()=>void}`；`createItemNavigation(port:HistoryPort,onRoute:(route:ItemRoute|undefined)=>void):{open:(target:WorkItemDetailTarget)=>void;close:(projectId:string)=>void;dispose:()=>void}`。浏览器 port 把 pathname/history.pushState/history.replaceState/popstate 映射到这四项，构造函数即时发布初始 route。壳与 fixture 将 route、同scope输入投影和 UI callback 接起来；ui 不 import apps，Harness 不 import apps/web。locator 的属性与内容规则见 `docs/adr/ADR-0010-stable-ids-are-route-locators.md`（Accepted）。

#126 的账号/绑定持久化与本轮读取无依赖；#133 的 Provider 字段读取不被本轮消费，故各自基于 main。共享 `packages/ui/src/work-item-list.ts`、ui/ui-model barrel、`docs/README.md` 与可能的 tracker 必须由整合 owner 串行合入，不能多人同时编辑。后续存在真实接口前后关系的 #126→#132、#221→#222 才适合 stack；是否建栈、base 和每层验收在后续任务重新锁定，不创建规划阻塞边来表达合并顺序。

外部回读由主控使用 `gh pr view feature/work-item-detail -R SingularityKChen/harness-projects --json url,headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks feature/work-item-detail -R SingularityKChen/harness-projects`，并分页读取 reviewThreads；预期当前 head/base、draft、#130关联及检查/线程均真实记录。只保留 plan 阶段 draft，不执行 ready/merge。技术债沿用 `docs/exec-plan/tech-debt-tracker.md`：TD-024 已归 #218，TD-025 文案归 #229，TD-026 时间校验重复本轮不触及；不新增没有承接者的“以后修”。其中「只保留 plan 阶段 draft，不执行 ready/merge」**Superseded by** 2026-10-06 的 `gh pr ready 269`（见 Bottom Change Note）：PR 已是 ready；review repair 期间保持 ready、不合并，每次 push 后按 Batch R3 第 1 步回读。

Review repair 的依赖与账号：开发账号 `SingularityKChen` 负责本地提交、push、PR 描述、thread 回复与 resolve、复评请求；评审账号 `Singularity-AI-Bot` 只做复评，不执行修复。需要 `gh` 对本仓库 PR 的读写权限、GraphQL `resolveReviewThread` / `unresolveReviewThread`、REST `pulls/269/requested_reviewers`，以及支持 `git merge-tree --write-tree` 的 Git（2.38 及以上）。ADR-0010 是 locator 属性的长期事实源；本计划只记录执行与证据。

## Outcomes & Retrospective

2026-10-05 CST：完成一份可审阅 spec/plan 与索引，产品验收全部 pending。首要遗留是 D 的实际浏览器导航/模态证据及真实 sync/read 保值集成；#229 Host 挂载是明确后续能力。落盘后二次自查结论 Pass：结果具体、入口与命令可定位、主要验收有证据、模态未知受真实浏览器门约束、恢复/债务/取舍/仓库约定完整；章节/链接/可移植性机械检查和 `git diff --check` 通过。主控仍须执行提交后的正式发布门与远端回读，当前不是产品完成或 PR 发布回执。

2026-10-05 CST（Batch D 实施后回填）：只读详情纵向切片已落地并本地验收：`deriveWorkItemDetailView` 先做 scope 再走既有列表门、redacted 行只出 `redacted`、partial 不拖累选中行；列表 opt-in anchor 与组合页共用唯一 `WorkItemDetailDrawer`；`apps/web` 的 codec + History adapter 用 replace 关闭且不调 `history.back`；fixture 同源服务两个 canonical pathname 并真实装配 adapter→投影→组合页。命令证据：四契约 20/20、集成 3/3、列表回归 25/25、contract+integration 1097/1097、typecheck exit 0、boundaries 8/8；fixture 打印 `http://127.0.0.1:<port>` 并在 `/projects/ws-1/items` 与 `/projects/ws-1/items/ent-aa` 均返回 200 且 HTML 逐字相同。verify-269 对抗验证进一步证伪了 fixture 挂载、Tab 循环、Back 后重开与两条回焦，均已在真实 Chromium 上复现、修复并复跑矩阵 10/10；并用 verify-269 独立 harness 与脚本复跑矩阵、P1 重开、撤权即时清空与修饰键/中键；模态打开期间点击背景 anchor 被原生 inert 拦截（预期）。仍明确未验证：非 Chromium 引擎/真机、300ms 级并发时序、真实 Host 挂载（#229）。规划预算 ≤800 未达（实际 1000），差异与原因见 Surprises 与 Decision Log。下一步由独立验证者做第二轮复验，再由主控执行发布门与远端回读。

2026-10-05 CST（gpt-6-sol 最终验收与重构后回填）：锁定 head `12d9bb42c4d7`、工作树干净（`git status --short` 空），逐条独立复跑并保留原始输出：四契约 20/20、集成 3/3、列表回归 25/25、`node --test --test-timeout=120000 tests/contract tests/integration` 1097/1097、`pnpm typecheck` exit 0、`pnpm boundaries` 8/8、`git diff --check origin/main...HEAD` exit 0、`disclosure origin/main` exit 0、`size origin/main` 代码 1000/1000 文档 218/1500 且 exit 0。issue #130 三条验收逐条判定通过：① 列表与深链同一组件——SSR `same-drawer-from-both-entries` + 真实 Chromium 深链刷新、列表点击、Enter 都到达同一 `WorkItemDetailDrawer`；② 断线显示最后已知值并标陈旧——集成 `sync-loss-preserves-visible-detail`（title/body/status/identity/time deepEqual，stale false→true）+ 真实 fixture offline 场景；③ 派生值标注且无编辑控件——`derived` 前缀 + SSR 断言无 input/select/textarea、编辑/Saved/StartWork。第一性审读未发现 P0/P1；发现并修掉一处**不改变验收结果**的重复权威源（投影自带第二份身份词表，已删，净 −6 行），并把 verify-269 的 P3 fixture 卫生项（`href` 字符串拼接）改为产品 `itemPath`。变异实验证明关键不变量有牙（见 Surprises）。明确未验证：非 Chromium 引擎/真机、300ms 级并发时序、真实 Host 挂载（#229）、plan 声明的 ≤800 规划预算（未达，已登记）。结论：闭环达成，满足请求人类评审的前提；合并与否由人类伙伴决定。**Superseded by 2026-10-07 重新打开**：与 #129 正式约束的冲突未经人类裁决，闭环不成立；见状态行与决策门 H。

2026-10-06 CST（外部评审回复）：A/B/C 三条按根因修复并补判别用例：① codec 单一权威、合法转义自往返、非法段响亮抛错；② 产品 `browserHistoryPort()` 落地并被 fixture 与真实 Chromium 矩阵使用；③ 详情侧 `ContentKind.Redacted` 复验封住撕裂读。窄证据：四契约 22/22、集成 3/3、列表回归 25/25、全套 contract+integration 1099/1099、e2e+mvp0 64/64、`pnpm typecheck`/`boundaries` exit 0、`git diff --check` exit 0；真实 Chromium 矩阵 10/10（产品 port 路径）。规模：仓库硬门代码 999/1000、文档 235/1500（修复净增受 ≤6 行约束，通过合并重复注释与同形逻辑达成；未删任何命名用例或判别断言）。未决：`entityId` 进 `href` 与既有列表决策冲突，标「待人类确认」；非 Chromium 引擎/真机、300ms 级时序、#229 Host 挂载仍属未验证。

2026-10-07 CST（review repair 闭合）：PR #269 唯一 P1 的事实部分属实且更宽——同一约束四份副本，只有一种模式被机械检查；根因是约束写成无保护对象的前瞻禁令、人类专属决定被路由给评审账号、归档门不区分与正式约束冲突的未裁决项。按评审给出的第二条路径，人类伙伴批准 ADR-0010（16:12 CST），#129 计划只做限定范围的原处标注。R1 把 L1–L3 固定为会失败的检查：硬化前 17 个披露变异只有 4 个变红，硬化后集成树 43 个变异 41 个变红；复评 APPROVED 后再补列表路由 scope 门（P2）、组合页 open 通道（X11）与 codec 两个拒绝样本，10 个新变异全部变红，静态渲染与浏览器共用同一个 mount。代码 999/1000。遗留与承接：真实 Host 挂载与读取接线归 #229（含 redacted freshness 的 D / E 裁决与列表路由 scope 门的验收项）；与 #268 并集后详情的 iteration / targetDate 与「详情状态 = 列表状态」判别用例归 #274；非 Chromium 引擎、真机、300ms 级并发，以及 mount 的默认 port / root 创建、open / close 回调的导航目标、焦点管理（含跨 scope 时整页替换后的焦点，交 #229 决定）仍只在真实浏览器或尚未验证；H3 的流程改进（归档前置条件、决策请求协议、约束写作规则）按人类裁决暂不立项。

## Bottom Change Note

2026-10-05 CST：首次创建；独立综合两种设计并核对当前源码，补全实际 History 导航、唯一安全门、scope/redaction/missing/freshness、浏览器焦点验收、预算与并行/整合边界。修改范围见 Global Constraints。

2026-10-05 CST：落盘后二次自查，修正 Active 表行位置与 A 方案描述，补 Provider 降级 metadata 的保值用例，记录实际文档检查；产品验收维持 pending。

2026-10-05 CST：按主控确认补入本轮 draft 的双向关闭关联要求；增加已核对的 W3C H102 官方设计依据，不将其当作组件验收回执。

2026-10-05 CST：主控补选题依据、实际 draft PR/双向引用与 Project 回读结果，完成本轮管理登记；所有产品验收保留 pending，未改规划状态或依赖边。

2026-10-05 CST：Batch D 实施与本地验收回填；按主控裁定把 Escape 收敛为唯一原生 cancel 路径并补机械用例，规模偏差按仓库硬门裁定保留判别测试。

2026-10-05 CST：第二轮对抗验证结论回填；随后由 gpt-6-sol 做最终独立验收与净减重构（删除重复身份词表、fixture 改用 `itemPath`），八行验收逐条复跑全绿并确认闭环，计划按 `PLANS.md` §2 移入 `docs/exec-plan/completed/` 并更新 `docs/README.md` 索引。

2026-10-05 CST：按 verify-269 对抗验证结论修复 P0 + 3×P1 并补真实浏览器矩阵证据；四契约 20/20、集成 3/3、列表 25/25、全套 1097/1097、typecheck/boundaries exit 0、size 1000/1000。

2026-10-06 CST：主控执行最终发布流程。人类伙伴授权「先 push 两个分支」。分支 `feature/work-item-detail` 在精确 old-head lease（`b723be2`）下以 force-with-lease 推送，远端 head 由 `b723be2` 更新为 `d69c0bf`；PR #269 描述改写为最终交付证据（闭环、ExecPlan+Batch、Closes #130、真实验证、风险与回滚、并行与交付、评审请求），并执行 `gh pr ready 269`。回读：`headRefOid = d69c0bf`、base = main、draft = false、mergeStateStatus = CLEAN、closingIssuesReferences = #130、issue #130 的 closedByPullRequestsReferences = #269、review threads = 0；13 项检查全部 pass（首次 Engineering state 因并发被 cancelled，重跑后 success）。未合并，等待人类评审。

2026-10-06 CST：外部评审回复轮——codec 单一权威（A）、产品 browserHistoryPort（B）、撕裂读遮蔽复验（C）与路由负例（D）落地；`entityId` 进 `href` 的决策冲突登记为待人类确认。

2026-10-06 CST：外部评审答复轮（PR#269）。独立评审会话在 `f4bc71f` 上报 1×P1 codec 不自往返 + 1×P1 产品 HistoryPort 缺位 + 1×P2 撕裂读遮蔽未复验 + 1×P3 负例无判别力，另有「entityId 进 href 与 2026-10-01-work-item-list-states 决策冲突」的待裁定项。修复提交 `990fb81`（`Closes #130`）：`itemPath` 每段复用 `decodeSegment` 同一判据并响亮抛 `TypeError`（解析侧不放宽）；`apps/web` 导出 `browserHistoryPort()` 并让 fixture 与真实 Chromium 矩阵改走产品 port；详情投影按 `detail.planning.contentKind === ContentKind.Redacted` 复验遮蔽；负例改为可区分修复前后的断言。三条变异各自 red→恢复 green。证据：四契约 22/22、集成 3/3、列表回归 25/25、contract+integration 1099/1099、e2e+mvp0 64/64、typecheck/boundaries/diff-check/disclosure/size 全 exit 0，代码 999/1000（净增 +5，余量 1 行）。远端 head 更新为 `990fb81`，PR 描述追加评审答复段，12 项检查全 pass、mergeStateStatus CLEAN、0 review threads。`entityId` 进 href 的冲突仍待人类裁定，未擅自宣布旧决策失效。

Change Note (2026-10-07 14:55 CST)：上一会话的 R0 草稿（本地 WIP `aa81b06`，未推送）把计划移回 active，新增 ADR-0010 草稿、Route identifier decision gate、Batch R0–R3 与索引变更；其中 ADR 标为 Accepted、对 #129 计划写原处 supersede、在 Decision Log 写成 reviewer 接受，均属 agent 自我接受，已由下一条撤回。本条合并了草稿中三条重叠的 2026-10-07 注记。

Change Note (2026-10-07 16:05 CST)：独立 spec/plan 评审与修订。恢复 `e47f817` 已发布的历史原文并就地标注 Superseded；ADR-0010 改为 Proposed 并按主控 D2 重写；新增决策门 H（H1 逐字陈述、记录格式、批准后的机械动作、否决分支，H2 / H3 非阻塞）；R1 拆为 U1 / U2 并写实规模账与变异表；R2 按路径构造三个交付物级提交；R3 补 PR 描述改写、thread 证据清单、账号分工与归档门新条件；订正对评审意见的描述；补 `Concrete Steps` / `Artifacts and Notes` 子节并把围栏代码块改为缩进块，内容不变。

Change Note (2026-10-07 17:08 CST)：R1 集成验收（验收者 agent）回填 R1 集成验收记录、Progress、Validation、Surprises 与 Decision Log。

Change Note (2026-10-07 17:10 CST)：人类伙伴批准决策门 H1 后执行门 H 五步机械动作，Decision Log 逐字记录 H1–H3 的答复；ADR-0010 L1 字段表按已验证的判别力补齐（只收紧）。

Change Note (2026-10-07 19:49 CST)：复评（APPROVED，1×P2 + 6×P3 + PR 级 P3）处置后归档：订正状态行、术语段、Interfaces、Validation、Progress 中落后于 head 的状态；Surprises、Decision Log、Outcomes 补复评结论；计划移入 `docs/exec-plan/completed/`，`docs/README.md` 索引移入 Completed 表，ADR-0010 来源路径同步。

Change Note (2026-10-07 20:12 CST)：复评修复的首次独立验证（3 条 blocking）处置：mount 与静态渲染同路径、计划不再把推送与外部写入记为已完成、`calls` 计数器的读者表述订正，以及 N2–N9 非阻塞项。

Change Note (2026-10-07 20:22 CST)：人类伙伴就 ADR-0010 L1 新鲜度措辞授权「调研类似项目的做法综合判断」后，保留 #129 D / E 的处置并补同类工具先例；第二次独立验证的 mount 覆盖面订正与 href 绑定断言；#274 / #229 承接者写入；状态行与 C6 处置订正。

Change Note (2026-10-07 20:46 CST)：评审账号在 `aafc172` 上 APPROVED 后的 4 条 P3 机械修订：最高风险段原处标注 fixture 跨 scope 焦点不再满足、承接者 #229；规模订正为 999；`docs/README.md` 索引的并集跟进改为 #274；HTTP 契约的入口页正则扩到 `mount` 调用点，堵住另传手写 port 的绕过（只改断言、行数不变）。
