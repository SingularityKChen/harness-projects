# 工作项详情规划字段一致性 ExecPlan

> 状态：Completed；D1 已实施，经 PR #286 第一轮 MVP 评审（APPROVE，P0/P1 为 0，1 × P2、3 × P3）并完成评审修订（见 `Progress` / `Decision Log` / `Outcomes & Retrospective`）；合并状态以 PR #286 回读为准。
> 创建：2026-10-07（Asia/Shanghai）
> 关联：同仓 issue #274；规范：`PLANS.md`。
> 执行上下文：检出 `feature/detail-planning-fields` 的工作树根目录；隔离目录 `.worktrees/detail-planning-fields-plan`。

## Purpose / Big Picture

用户在列表或深链打开同一工作项详情时，看到相同的规划状态、迭代和目标日期。详情只消费已经通过可见性判断的列表行；被遮蔽对象的这些字段不会进入文字、HTML 属性或组合页输出。

最小成功证据是一条 `unknown` 状态带原生状态名称的可见条目，其列表与详情三字段精确相等；三个规划字段逐个变化的遮蔽对照输出完全相同。date-only 日期原样显示，缺值共同显示 `—`。

## Context and Orientation

调查快照为 2026-10-07 23:05 +08:00、`main@6417d45978ec22778b914a9d7dea91d71fb6bb6e`。执行前用 `git rev-parse origin/main HEAD` 重锁基线；快照不代表后续远端状态。

`planningFields` 是规划源返回的展示事实；`iterationTitle` 是原生迭代标题，`targetDate` 是不带时区的日期文本。列表安全投影 `VisibleListRow` 已将它们转为恒有的 `iteration`、`targetDate` 字符串。

`packages/ui-model/src/work-item-list-view.ts::statusText/rowView` 已规定：规范状态已知时显示规范标签；只有规范状态为 `unknown` 时才展示 `statusName（未映射）`。迭代与目标日期缺值都显示 `—`。

`packages/ui-model/src/work-item-detail-view.ts::deriveWorkItemDetailView` 依次检查工作区 scope、列表读取门、安全行，再读取详情并复验 `ContentKind.Redacted`。调查时 `WorkItemDetailContent` 只有规划状态，`packages/ui/src/work-item-detail.ts::contentPanel` 没有迭代与目标日期；D1 已补齐。

承接依据为 `docs/exec-plan/completed/2026-10-05-project-field-read.md` 与 `docs/exec-plan/completed/2026-10-05-work-item-detail.md`。上游字段与详情能力已在调查基线存在；本项是二者并集后的字段交付，不再等待旧 issue Notes 的 PR 阻塞。

调查时 `tests/fixtures/work-item-wire.mjs::wire/redacted` 不接受顶层 `planningFields`，未知参数会悄悄丢弃字段而假绿；D1 已使夹具显式承接该字段。

事实是列表格式化已存在；硬约束是安全门次序不变；决策是复制安全行。假设是本项不改变导航、焦点或 store 原子性；若代码事实推翻该假设，先修订计划边界。

## Design / Spec

采用已有安全投影的白名单扩展。`WorkItemDetailContent` 增加恒有的 `readonly iteration: string` 与 `readonly targetDate: string`；构造 content 时复制 `row.iteration` 和 `row.targetDate`，与 `row.planningStatus` 来自同一次列表投影。

新增字段只在详情 redacted 复验之后进入 content。loading、unavailable、unresolved、redacted 变体保持精确白名单，不携带隐藏字段。详情 raw `planningFields` 不作回填，目标消失时仍按既有接线错误处理。

`contentPanel` 增加只读文字行 `迭代：` 与 `目标日期：`。采用 React 文字转义，日期不经 `Date`、locale 或时区解析。新字段不是输入控件，不产生写命令，也不成为数据属性。

拒绝详情重新格式化 raw 字段的方案：它会制造第二个状态映射和缺值规则，并扩大遮蔽后回填风险。拒绝一次性 store snapshot 改造：既有 TD-024 的原子读取问题由其 owner 处理，此切片只保持现有复验。

关键判别用例使用 `unknown` + `statusName: 'Native Stage'`、`iterationTitle: 'Iteration A'`、`targetDate: '2026-01-01'`；三字段分别等于列表输出，状态精确为 `Native Stage（未映射）`。另以已知 `in_progress` + 冲突原生名称证明规范标签优先。

遮蔽 differential 是两个输入只有一个规划字段不同，比较完整 view、带 navigation 的列表、组合页、直接 drawer 的静态 HTML。仅归一化 React `useId`；HTML 属性和事件入口同样在对照面内。必须有同字段可见正控，证明夹具覆盖真正进入生产路径。

## Global Constraints

本任务唯一允许改动集如下。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/completed/2026-10-07-detail-planning-fields.md`（实施期间位于 `active/`）、`docs/README.md` | 同一份 spec + plan 及索引 |
| 产品 | `packages/ui-model/src/work-item-detail-view.ts` | 安全 content 白名单 |
| 产品 | `packages/ui/src/work-item-detail.ts` | 只读 renderer |
| 测试 | `tests/contract/ui-work-item-detail-view.test.js`、`tests/contract/ui-work-item-detail.test.js` | 精确字段与真实 SSR 判别 |
| 夹具 | `tests/fixtures/work-item-wire.mjs` | 顶层规划字段输入 |

Node `>=22`、锁定 pnpm `10.28.2`；不增加依赖。保留 provider → core → client → ui-model → ui 的方向。ui 不调用 Provider，Host 挂载、规划写入、状态策略与路由不在此闭环。

每 PR 代码、测试、夹具增删合计不超过 800 行，文档增删合计不超过 1300 行。预计产品 12–25、测试与夹具 90–160，合计 102–185；文档约 180–240。提交前用实际 diff 重算，不能按净增行或旧估计放行。

保留既有用户修改与工作树。不写看板 `Status`、`blocked-by` / `blocking`；工程事件不覆盖规划事实。评审修订与合并收尾的 owner 见 `Decision Log`。

## Plan of Work

### Batch P0 · 设计、计划与 draft 发布

最小闭环：可审阅 spec、步骤、验收与回滚在同一文档；索引到达该文档。涉及主文件为本计划与 `docs/README.md`，仅新增一个 Active 索引行。

先核对四个字段符号与现有门顺序，再完成独立设计比较和语义审评；运行下列文档命令。结果通过后按仓库提交约定整理一个文档提交；draft PR 只关联 #274。发布 owner 回读 `closingIssuesReferences` 与 issue 的 `closedByPullRequestsReferences`，并机械填写 ExecPlan、Batch；保持 draft。

在本文件头部声明的检出根目录运行：

```sh
node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/board-status-semantics.test.js
git diff --check
```

期望全部文档用例通过，diff 无空白错误；另核对 13 个固定章节顺序和新增索引链接。P0 的通过不能证明 D1 产品结果。回滚点是尚未发布的文档差异；公开后保留 draft 供审阅，不做历史删除。

### Batch D1 · 安全规划字段与详情一致性验收

最小闭环：列表、组合页与抽屉共享三字段事实，所有遮蔽/阻断路径不披露。涉及主文件为 `work-item-detail-view.ts`、`work-item-detail.ts`，确切路径与测试集合见 `Global Constraints`。

1. 在该检出执行 `pnpm install --frozen-lockfile`，期望 exit 0。先扩展夹具接受顶层 `planningFields`，自检 fixture 的覆盖值确实存在；不将缺 React 的加载错误当作产品红测试。
2. 新增具名 `detail-planning-fields-match-safe-row` 测试，更新既有 visible content 的完整 `deepStrictEqual`，断言三字段、恒有类型和 `—` 缺值。用 `unknown` + native label 验证整个三字段元组，再以规范状态正控防止原生名称篡位。
3. 新增 `redacted-planning-field-differential` 与 `torn-read-planning-fields-stay-redacted`。三个字段逐个变异，对比 view 与列表/组合页/drawer HTML；getter 第二次读返回 redacted 且带 canary 时仍只输出 redacted。将同字段可见正控作为夹具判别证据。
4. 运行下面第一条命令，预期新字段正控失败于 missing iteration/targetDate 或缺 renderer 标签，原门用例仍通过；记录 RED 对应断言。实施白名单 copy 与两行 renderer，重跑得到 GREEN。
5. date-only 用例在进程内依次切换 UTC、Asia/Shanghai、America/Los_Angeles、Pacific/Kiritimati（必需检查只在 UTC 下运行，外部 `TZ=` 前缀不承重），确认日期仍为 `2026-01-01`；运行列表回归与 typecheck。实现、判别测试和计划证据形成同一个可审阅提交单元，不能先提交未闭环类型。

所有命令均在检出 `feature/detail-planning-fields` 的工作树根目录：

```sh
node --test tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js
node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js
pnpm run typecheck
```

期望全 pass / exit 0，date 用例在四个时区下日期逐字一致，真实 SSR 显示两个标签。没有导航变化，不扩大到新的浏览器平台或 Host 装配验收。回滚为整体撤回 D1 的产品与配对测试，恢复已知安全白名单；无存储迁移或外部写入。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 三字段与列表相同 | `detail-planning-fields-match-safe-row` 对元组及完整 content 精确比较 |
| unknown/native 与规范状态优先 | native label 正控和冲突原生名称正控 |
| 缺值统一、日期不漂移 | `—` 深比较；用例内依次切换 UTC / Asia/Shanghai / America/Los_Angeles / Pacific/Kiritimati |
| 新字段真实可见 | 真实 drawer / composite SSR 含标签与值 |
| redacted 不披露 | 三个单字段 differential，完整 view/HTML/属性相同 |
| torn read 仍遮蔽 | getter 二读 redacted 用例；canary 无任何输出 |
| 原读取门与只读属性保持 | 阻断态精确断言、既有 renderer 与列表回归、typecheck |
| 当前文档可发布 | P0 文档检查、13 节与链接、五类目人工扫描 |

提交与开 PR 前，在该检出运行：

```sh
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望 exit 0；对新增未提交文件另外核对内容，提交后再以真实 commit range 确认。人工核对凭据、本机身份与路径、账号个人信息、内部系统、保密字样。预算按增删合计复核。

## Progress

- [x] (2026-10-07 23:05 +08:00) 调查基线、上游已交付字段与安全门核对完成。
- [x] (2026-10-07 23:05 +08:00) 三份独立方案经独立审评收敛；选择安全 row copy，写入本计划。
- [x] (2026-10-07 23:23 +08:00) P0 文档结构、链接与披露检查完成，draft PR #286 发布并只关联 #274；2026-10-08 01:24 +08:00 最终验收时复跑：文档契约 15/15、size / disclosure、diff whitespace 均通过。PR 的 head、checks 与 mergeability 是易失状态，不在本计划静态记录，以最终 head 回读为准。
- [x] (2026-10-07 23:52 +08:00) D1 RED → GREEN、字段 renderer、时区及遮蔽验收。在检出 `feature/detail-planning-fields` 的工作树根目录 `.worktrees/detail-planning-fields-plan` 运行计划中的五条命令，全部 exit 0：详情 pair `tests 19 / pass 19 / fail 0`；`TZ=UTC` 与 `TZ=America/Los_Angeles` 的 `--test-name-pattern='detail-planning-fields'` 各 `tests 2 / pass 2 / fail 0`；列表回归 `tests 24 / pass 24 / fail 0`；`typecheck` 无输出且 exit 0。RED 证据为 4 条具名用例失败（见 `Surprises & Discoveries`）。（Superseded by 2026-10-08 评审修订：外部 `TZ=` 双命令在 CI 中不承重，date-only 判别已移进用例内的四时区循环，验证命令随之收为四条，见 `Decision Log`。）
- [x] (2026-10-07 23:58 +08:00) 独立对抗验证的 P1-1 修复：新增 `detail-planning-fields-come-from-safe-row-not-raw-detail`，在 raw 回填变异下 RED（`actual: ['content', 'RAW-CANARY', '2000-01-02']` / `expected: ['content', 'SAFE-ITERATION', '2026-01-01']`），当前实现 GREEN；详情 pair 由 19 → 20 条全 pass。P2-1 状态一致性、P2-2 composite 断言面一并收敛。证据见 `Surprises & Discoveries` / `Decision Log` / `Outcomes & Retrospective`。
- [x] (2026-10-08 01:24 +08:00) 独立最终验收完成：详情 pair 20/20、UTC 与 America/Los_Angeles 规划字段各 3/3、列表 24/24、全量 contract/integration/e2e 1212/1212、typecheck、size、disclosure、diff check 均通过；有效对抗变异均 RED 且已还原，工作树干净。无净收益重构。待 push 后补 PR 回读并决定归档。（Superseded by 2026-10-08 评审修订：时区证据以下面两条为准；PR 状态不在本计划静态记录，归档随评审修订完成。）
- [x] (2026-10-08 09:58 +08:00) PR #286 第一轮 MVP 评审（评审账号，评审 head `730632ba`）：APPROVE，P0 / P1 为 0；P2 一条（date-only 判别力只在手工的非 UTC 运行里存在），P3 三条（raw 二读的状态 canary 失活；`Global Constraints` 等处仍写「产品实施未执行」；`Progress` 写入了已过期的静态 PR 状态）。评审独立复跑全量 contract/integration/e2e 1212/1212、boundaries 8/8，并在 main 与 #286 `730632ba`、#287 `8fd546bd`、#288 `6daa845b`、#295 `28b454a2`、#289 `9135cf34` 的并集上 1314/1314。
- [x] (2026-10-08 10:12 +08:00) 评审修订（owner 见 `Decision Log`）：两处 date-only 断言改为用例内依次切换 UTC / Asia/Shanghai / America/Los_Angeles / Pacific/Kiritimati（修订复评补入 Kiritimati）；safe-row 来源用例的 raw 二读改为 `unknown` 并显式断言状态；本计划旧句与静态 PR 状态改正，随后归档。详情 pair 20/20；在 UTC 进程里 9 个变异全部 RED（表见 `Outcomes & Retrospective`）。

## Surprises & Discoveries

详情 getter 已有二次 redacted 复验，增加字段应沿这个边界而非重建读取流程。证据为 `deriveWorkItemDetailView` 中 `ContentKind.Redacted` 分支先于 content 构造。

`wire/redacted` 未承接 planningFields，是测试假绿风险。新增用例必须自检覆盖值和可见正控。调查者在基线上遇到 renderer 的 `ERR_MODULE_NOT_FOUND: react`；这是锁定依赖尚未装齐，D1 因此先安装依赖再取得产品证据。

旧 issue 的上游 PR blocker 已不构成当前代码依赖；承接路径在 `Context and Orientation`。易失 PR 状态由发布 owner 重新回读，不写静态 mergeability 结论。

2026-10-08 独立验收发现：把 `rowView` 的 redacted 分支改为读取 planning field 并不能形成有效泄露，因为上游 `deriveWorkItemList` 已在安全边界前剥离字段；该无效变异 GREEN，已还原，不作为验收证据。改为直接向详情 redacted view 注入 `iteration: CANARY-ITERATION`，`redacted-planning-field-differential` 立即 RED（actual 含 canary、expected 为精确 `{ kind: 'redacted' }`）。这确认验收覆盖的是实际输出边界，而非不可达 raw 对象。

D1 的 RED 阶段在 `.worktrees/detail-planning-fields-plan` 实测到 4 条具名用例失败（`node --test tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js`，`tests 18 / pass 14 / fail 4`）：`detail-planning-fields-match-safe-row` 报 `actual: [undefined, undefined, 'Native Stage（未映射）'] / expected: ['Iteration A', '2026-01-01', 'Native Stage（未映射）']`；`redacted-planning-field-differential` 报夹具正控 `actual: undefined / expected: 'Iteration A'`；既有可见正控因白名单多出 `iteration` / `targetDate` 而失败；`detail-planning-fields-render` 因 SSR 无 `迭代：` / `目标日期：` 文字行失败。实现只在 `WorkItemDetailContent` 增加两个恒有字段并从 `row` 复制，`contentPanel` 增加两行只读文字；修改后同一命令 `tests 19 / pass 19 / fail 0`，无跳过或弱化断言。

`redacted` 夹具的既有签名是 `(entityId, content, { planningStatus, derived, reason })`，第三个参数是选项对象而非规划字段本身；D1 扩展为可选的 `planningFields`，遮蔽 differential 用例据此把三个 canary 传进遮蔽条目，同时保留第二个 `content` 参数位置不变。

2026-10-07 23:52 +08:00 交付后在 head `71199e03` 的独立对抗验证发现 P1-1：原实现把 `iteration` / `targetDate` 从安全行 `row` 复制，但当时没有任何可证伪该来源的判别用例。验证者把复制语句改成从 raw 详情回填（`store.get(...).entity.planningFields`）后，`tests/contract/` 与 `tests/integration/` 全绿 1154/1154、零失败——因为 redacted / torn 用例在遮蔽短路处返回、走不到复制语句，而 `detail-planning-fields-match-safe-row` 与 differential 的可见正控里 raw 与安全行恒同值，Design/Spec 与 Decision Log 的「copy safe row」安全论据因此不可证伪。修复是新增具名用例 `detail-planning-fields-come-from-safe-row-not-raw-detail`：构造可见列表行 `SAFE-ITERATION / 2026-01-01` + 详情 getter 返回不同 `planningFields` `RAW-CANARY / 2000-01-02`，断言详情输出逐字等于安全行且 raw 三个值不落任何字段。该用例在 raw 回填变异下 RED：`AssertionError`，`actual: ['content', 'RAW-CANARY', '2000-01-02'] / expected: ['content', 'SAFE-ITERATION', '2026-01-01']`；撤销变异后 GREEN。这证明此前的全绿是测试判别力缺口，不是实现缺陷——实现本身来源正确。

2026-10-08 评审发现：必需检查跑在 `ubuntu-latest`，workflow 不设 `TZ`，即 UTC；UTC 下任何 `Date` 换算都恰好还原 `2026-01-01`，所以外部 `TZ=` 前缀的双时区命令在 CI 中不承重。UTC + America/Los_Angeles 也只覆盖负偏移：`new Date(d + 'T00:00:00').toISOString().slice(0, 10)` 在这两个时区都绿，只有东八区才红。另一处是 safe-row 来源用例的 raw 二读沿用默认 `in_progress`，按列表规则原生名不会显示，`RAW-STATUS` canary 在「从二读按同一规则重算状态」的实现下也不可能出现，该变异 20/20 全绿。

## Decision Log

决策：直接复制安全行的 `iteration` 与 `targetDate`；拒绝 raw 详情第二份格式化。Rationale：一个事实源同时固定状态标签、缺值和日期文本，安全门已经存在。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：不更改导航与 TD-024 的 store 原子读取；只保持二读遮蔽。Rationale：字段闭环无需新客户端接口。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：D1 的遮蔽 differential 拆成两层：`ui-work-item-detail-view.test.js` 比较完整视图对象与列表视图对象（含三个字段逐个变异），`ui-work-item-detail.test.js` 比较归一化 `useId` 后的列表 / 组合页 / drawer 静态 HTML。Rationale：计划要求「比较完整 view、带 navigation 的列表、组合页、直接 drawer 的静态 HTML」，两层各自有判别力且失败定位更窄；HTML 层只归一化 React `useId`，其余属性面逐字比较。日期/作者：2026-10-07 23:52 +08:00 / impl-286。

决策：夹具 `redacted` 的第三个参数继续是选项对象，新增可选 `planningFields` 键透传到 `wire`。Rationale：不改既有第二个 `content` 参数位置，避免破坏现存调用点，同时让遮蔽对照能把三个字段 canary 送进真实生产路径。日期/作者：2026-10-07 23:52 +08:00 / impl-286。

决策：安全行来源必须是可证伪的具名事实，而不是只写在 Design/Spec 的论据。新增 `detail-planning-fields-come-from-safe-row-not-raw-detail`，用「可见行与详情二次 getter 规划字段不同值」构造判别面。Rationale：对抗验证证明 raw 回填变异能让原 1154 条测试全绿；没有差异值输入，`row.iteration` 与 raw 回填在测试里不可区分。日期/作者：2026-10-07 23:58 +08:00 / impl-286。

决策：验收表第 4 行的 composite 面改为真实断言而非仅不变性比较——`detail-planning-fields-render` 现在对 `WorkItemProjectPage` SSR 断言 `迭代：Iteration A` 与 `目标日期：2026-01-01` 各出现恰好一次。Rationale：验收措辞「真实 drawer / composite SSR 含标签与值」要求 composite 也含值；选择扩断言而非收紧措辞，因为组合页本就是产品可见入口。日期/作者：2026-10-07 23:58 +08:00 / impl-286。

决策：ExecPlan 头部状态行与 `docs/README.md` 索引状态收敛为「D1 已实施并推送」，取代「产品批次未实施」。Rationale：原状态与已推送的 `71199e03` 形成同一事实的两份相反表述；`PLANS.md` §4 要求被推翻的结论就地更新而不是保留旧值。日期/作者：2026-10-07 23:58 +08:00 / impl-286。

决策：独立验收不做代码重构。Rationale：产品改动已是最小的安全行白名单复制与两行 renderer；测试和夹具承担判别职责，删除或合并会降低变异定位面，任何进一步抽象都没有净复杂度收益。日期/作者：2026-10-08 01:24 +08:00 / 验收 owner。

决策：本轮完成 spec + plan 与 draft 发布，不执行 D1。Rationale：人类授权的当前交付阶段；技能默认目录与阶段停顿由仓库 `PLANS.md` 和明确任务范围覆盖。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权。Superseded by 「D1 产品批次已实施并推送」（2026-10-07 23:58 +08:00，见 `Progress` 与头部状态行）：D1 已在同一 PR 分支实施、验证并推送。

决策：评审修订与合并收尾由评审会话接手。Rationale：#286 由 Codex 会话创建，没有可接手的 Claude 作者会话（同期的 #290–#293 作者会话已确认不拥有本分支）；人类伙伴在评审会话中明确指定由该会话负责修复、归档、整合提交、复评与 rebase merge，一个分支一个 owner。日期/作者：2026-10-08 10:05 +08:00 / 人类伙伴（评审会话记录）。

决策：date-only 判别改为用例内切换时区，取代 D1 第 5 步原来的外部 `TZ=UTC` / `TZ=America/Los_Angeles` 双命令。Rationale：必需检查只在 UTC 下运行，外部前缀不进 CI；进程内切换沿用 `tests/contract/capabilities-observation.test.js` 的写法（Node 在给 `process.env.TZ` 赋值时重读时区），东八区与洛杉矶覆盖两侧常见偏移；修订复评发现以本地正午为锚的换算在这三个时区都还原原值、只在 12 小时以上偏移才跨日，因此补入 Pacific/Kiritimati（+14）。日期/作者：2026-10-08 10:12 +08:00 / 评审修订 owner。

决策：safe-row 来源用例的 raw 二读改为 `planningStatus: 'unknown'`，并在元组断言里显式比较 `planningStatus` 仍是安全行的「进行中」。Rationale：只有 raw 规范状态为 unknown 时，按列表规则重算才会显示 `RAW-STATUS（未映射）`，canary 才有判别力；状态从安全行复制是 #269 的既有行为，本项只补证伪面，不改实现。日期/作者：2026-10-08 10:12 +08:00 / 评审修订 owner。

## Idempotence and Recovery

纯投影和 SSR 用例可以重复执行，无外部请求。先检查 dirty state，保留无关修改。RED 失败必须对应新增行为；安装失败或模块加载失败先处理环境，再重跑同一窄命令。

D1 失败停在本批，保留差异和判别证据；通过前不推送产品。回滚整批白名单、renderer 与配对测试，不修改存储或历史计划。公开历史调整需要恢复锚点和 Git 专家流程，不自行清理用户工作树。

draft 发布失败先按分支查询同仓已有 PR，避免重复创建；成功后回读当前 head/base/checks/threads 与两侧关联。保持 draft，不以文档绿检查推导产品完成。

## Interfaces and Dependencies

输入仍是 `WorkItemListReadInput` 与 `WorkItemDetailTarget`；输出仍是 `WorkItemDetailView` 的 content 分支，仅追加两个恒有字符串字段。使用已有 React renderer，client/Provider 接口与权限模型不变。

工具依赖为 Node、锁定 pnpm、Git；离线产品测试无需 GitHub 凭据。发布 owner 使用仓库现有 `gh` 身份与 Project 规范；`Status` 和阻塞关系保持人类所有。

## Outcomes & Retrospective

2026-10-07 23:52 +08:00 的 D1 实际产出：`WorkItemDetailContent` 增加恒有 `iteration` / `targetDate`，由 `row`（安全列表行）与 `planningStatus` 同源复制；`contentPanel` 增加只读文字行 `迭代：` / `目标日期：`，日期不经 `Date` / locale。计划五条验证命令全部 exit 0，`TZ=UTC` 与 `TZ=America/Los_Angeles` 两次 date 用例都命中 `detail-planning-fields` 且日期逐字为 `2026-01-01`。原始 RED 是 4 条具名失败（见 `Surprises & Discoveries`），非环境或加载失败。与计划的偏差仅为把遮蔽 differential 拆成 view 对象层与 SSR HTML 层两个用例，验收矩阵全部覆盖。（Superseded by 2026-10-08 评审修订：两次外部时区运行不进 CI，见下方评审修订产出。）

2026-10-07 23:58 +08:00 的 P1 修复实际产出：对抗验证给出的 PASS-with-findings 中，P1-1 是「copy safe row」不可证伪。新增 `detail-planning-fields-come-from-safe-row-not-raw-detail` 后，详情 pair 由 `tests 19 / pass 19` 变为 `tests 20 / pass 20 / fail 0`；该用例在 raw 回填变异下拿到真实 RED（`actual: ['content', 'RAW-CANARY', '2000-01-02'] / expected: ['content', 'SAFE-ITERATION', '2026-01-01']`），撤销变异后 GREEN，实现本身无改动。P2-1 已把头部状态与 `docs/README.md` 索引改为「D1 已实施并推送」，并把旧 Decision「本轮不执行 D1」就地标注 Superseded。P2-2 选择扩断言：composite SSR 现在各断言一次 `迭代：Iteration A` 与 `目标日期：2026-01-01`。P3-1 的冗余 `typeof` 断言保留（无害且是恒有 string 的直接表达），P3-2 的默认参数语义未改。

2026-10-07 23:05 +08:00 的 P0 实际产出是已收敛 spec、可执行 D1 与验收矩阵；最终文档契约、披露、体量与 whitespace 证据已于 2026-10-08 01:24 +08:00 独立复跑，PR 的 head、checks 与 mergeability 以最终 head 回读为准，不在此静态记录。

2026-10-08 评审修订的实际产出：两处 date-only 断言在用例内切换四个时区；safe-row 来源用例的状态 canary 变为活的；实现无改动。在最终树、UTC 进程内的变异表（详情 pair，基线 20/20）：

| 变异 | 结果 | 变红用例 |
|---|---|---|
| raw 详情回填 iteration / targetDate | RED | come-from-safe-row |
| 删除 renderer 两行 | RED | render |
| redacted view 注入 canary | RED | redacted differential、既有 redacted-erases-every-field |
| view `new Date(d).toLocaleDateString('sv-SE')` | RED | match-safe-row、render |
| view `new Date(d + 'T00:00:00').toISOString().slice(0, 10)` | RED | match-safe-row、render |
| renderer 中同类 Date 换算 | RED | render |
| view 以本地正午为锚 `toISOString().slice(0, 10)` | RED | match-safe-row、render |
| view 以 UTC 正午为锚 `toLocaleDateString('sv-SE')` | RED | match-safe-row、render |
| renderer 以本地正午为锚 `toISOString().slice(0, 10)` | RED | render |
| 状态改从 raw 二读按同一规则重算 | RED | come-from-safe-row |
| view 交换两个字段 | RED | match-safe-row、differential、come-from-safe-row、render |
| renderer 交换两个标签 | RED | render |

修订前，第 4–7 行在 UTC 下全部存活（第 4、6 行只在 America/Los_Angeles 下红，第 5 行只在东八区下红，第 7 行在任何时区都绿）。三个以正午为锚的换算在东八区与洛杉矶也还原原值，修订复评补入 Kiritimati 之前同样存活。

没有新增实施技术债。现有 TD-024 保持原责任边界；若实施发现需要有意延期的真实工作，先更新本计划并登记 `docs/exec-plan/tech-debt-tracker.md`，本次不写猜测债务。

独立验收结论：无可做重构。产品路径已保持单一安全投影，测试的重复样板分别服务 view、SSR 与变异判别，不应为减少行数机械抽象；验收结果因此未被重构扰动。

## Bottom Change Note

2026-10-08 10:12 +08:00：PR #286 第一轮评审修订与归档。由人类指定的评审会话接手：date-only 判别移进用例内的四时区循环，safe-row 来源用例的 raw 二读改为 unknown；改正 `Global Constraints`、D1 第 5 步、验收表与 `Surprises` 中「尚未实施」「两个时区」的旧表述，`Progress` 去掉静态 PR 状态并按时间排序；计划状态改为 Completed 并移入 `completed/`。计划的目的、批次与验收面未变。

2026-10-08 01:24 +08:00：独立 owner 完成最终验收与对抗抽查；详情 20/20、全量 1212/1212、typecheck、规则检查与 whitespace 均通过。raw 回填、删除 renderer、详情 redacted canary 三条有效变异均 RED，逐条恢复后 `git status --short` 干净；无可做重构。文档同步记录实际计数、无效变异发现与重构决策，push/PR 回读待本轮提交后补录。（Superseded by 2026-10-08 10:12 条：PR 状态不在计划中静态记录，回读以最终 head 为准。）

2026-10-07 23:58 +08:00：按独立对抗验证的 P1-1 补 `detail-planning-fields-come-from-safe-row-not-raw-detail`，用可见行与 raw 详情不同值让「安全行来源」可证伪（变异下 RED、修后 GREEN）；P2-1 收敛头部与 `docs/README.md` 状态、旧 Decision 就地标 Superseded；P2-2 把 composite 标签/值断言补齐。计划的目的与批次未改。

2026-10-07 23:52 +08:00：D1 产品与配对测试落地，按 TDD 先取得 4 条具名 RED 再实现；夹具显式承接顶层 `planningFields`，遮蔽 differential 拆为 view 层与 SSR HTML 层。计划正文、批次与验收未改，只补 `Progress` / `Surprises` / `Decision Log` / `Outcomes`。

2026-10-07 23:05 +08:00：根据三份独立设计及代码审评建立计划；固定安全 copy、单字段遮蔽 differential、夹具正控和 date-only 验证，区分文档发布与未实施产品批次。
