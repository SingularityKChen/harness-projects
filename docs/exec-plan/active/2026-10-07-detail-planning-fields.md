# 工作项详情规划字段一致性 ExecPlan

> 状态：Active；设计与计划已收敛，产品批次未实施。
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

`packages/ui-model/src/work-item-detail-view.ts::deriveWorkItemDetailView` 依次检查工作区 scope、列表读取门、安全行，再读取详情并复验 `ContentKind.Redacted`。现 `WorkItemDetailContent` 只有规划状态；`packages/ui/src/work-item-detail.ts::contentPanel` 也没有迭代与目标日期。

承接依据为 `docs/exec-plan/completed/2026-10-05-project-field-read.md` 与 `docs/exec-plan/completed/2026-10-05-work-item-detail.md`。上游字段与详情能力已在调查基线存在；本项是二者并集后的字段交付，不再等待旧 issue Notes 的 PR 阻塞。

`tests/fixtures/work-item-wire.mjs::wire/redacted` 当前不接受顶层 `planningFields`。测试若只传未知参数，会悄悄丢弃字段而假绿，必须先使夹具显式承接该字段。

事实是列表格式化已存在；硬约束是安全门次序不变；决策是复制安全行。假设是本项不改变导航、焦点或 store 原子性；若代码事实推翻该假设，先修订计划边界。

## Design / Spec

采用已有安全投影的白名单扩展。`WorkItemDetailContent` 增加恒有的 `readonly iteration: string` 与 `readonly targetDate: string`；构造 content 时复制 `row.iteration` 和 `row.targetDate`，与 `row.planningStatus` 来自同一次列表投影。

新增字段只在详情 redacted 复验之后进入 content。loading、unavailable、unresolved、redacted 变体保持精确白名单，不携带隐藏字段。详情 raw `planningFields` 不作回填，目标消失时仍按既有接线错误处理。

`contentPanel` 增加只读文字行 `迭代：` 与 `目标日期：`。采用 React 文字转义，日期不经 `Date`、locale 或时区解析。新字段不是输入控件，不产生写命令，也不成为数据属性。

拒绝详情重新格式化 raw 字段的方案：它会制造第二个状态映射和缺值规则，并扩大遮蔽后回填风险。拒绝一次性 store snapshot 改造：既有 TD-024 的原子读取问题由其 owner 处理，此切片只保持现有复验。

关键判别用例使用 `unknown` + `statusName: 'Native Stage'`、`iterationTitle: 'Iteration A'`、`targetDate: '2026-01-01'`；三字段分别等于列表输出，状态精确为 `Native Stage（未映射）`。另以已知 `in_progress` + 冲突原生名称证明规范标签优先。

遮蔽 differential 是两个输入只有一个规划字段不同，比较完整 view、带 navigation 的列表、组合页、直接 drawer 的静态 HTML。仅归一化 React `useId`；HTML 属性和事件入口同样在对照面内。必须有同字段可见正控，证明夹具覆盖真正进入生产路径。

## Global Constraints

本任务唯一允许改动集如下；本轮发布只包含计划与索引，其余属于未来 D1 批次。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/active/2026-10-07-detail-planning-fields.md`、`docs/README.md` | 同一份 spec + plan 及索引 |
| 产品 | `packages/ui-model/src/work-item-detail-view.ts` | 安全 content 白名单 |
| 产品 | `packages/ui/src/work-item-detail.ts` | 只读 renderer |
| 测试 | `tests/contract/ui-work-item-detail-view.test.js`、`tests/contract/ui-work-item-detail.test.js` | 精确字段与真实 SSR 判别 |
| 夹具 | `tests/fixtures/work-item-wire.mjs` | 顶层规划字段输入 |

Node `>=22`、锁定 pnpm `10.28.2`；不增加依赖。保留 provider → core → client → ui-model → ui 的方向。ui 不调用 Provider，Host 挂载、规划写入、状态策略与路由不在此闭环。

每 PR 代码、测试、夹具增删合计不超过 800 行，文档增删合计不超过 1300 行。预计产品 12–25、测试与夹具 90–160，合计 102–185；文档约 180–240。提交前用实际 diff 重算，不能按净增行或旧估计放行。

保留既有用户修改与工作树。不写看板 `Status`、`blocked-by` / `blocking`；工程事件不覆盖规划事实。当前授权止于 spec + plan 与 draft 发布，产品实施、ready 和 merge 均未执行。

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
5. 在两个时区运行相同用例，确认日期仍为 `2026-01-01`；运行列表回归与 typecheck。实现、判别测试和计划证据形成同一个可审阅提交单元，不能先提交未闭环类型。

所有命令均在检出 `feature/detail-planning-fields` 的工作树根目录：

```sh
node --test tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js
TZ=UTC node --test --test-name-pattern='detail-planning-fields' tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js
TZ=America/Los_Angeles node --test --test-name-pattern='detail-planning-fields' tests/contract/ui-work-item-detail-view.test.js tests/contract/ui-work-item-detail.test.js
node --test tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list.test.js
pnpm run typecheck
```

期望全 pass / exit 0，两个时区实际运行新增 date 用例且日期逐字一致，真实 SSR 显示两个标签。没有导航变化，不扩大到新的浏览器平台或 Host 装配验收。回滚为整体撤回 D1 的产品与配对测试，恢复已知安全白名单；无存储迁移或外部写入。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 三字段与列表相同 | `detail-planning-fields-match-safe-row` 对元组及完整 content 精确比较 |
| unknown/native 与规范状态优先 | native label 正控和冲突原生名称正控 |
| 缺值统一、日期不漂移 | `—` 深比较；UTC / America/Los_Angeles 两次 date 用例 |
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
- [ ] (2026-10-07) P0 文档结构、链接与披露检查及 draft 发布回读。
- [ ] (2026-10-07) D1 RED → GREEN、字段 renderer、时区及遮蔽验收。
- [ ] (2026-10-07) 产品最终验证、独立评审与完成归档。

## Surprises & Discoveries

详情 getter 已有二次 redacted 复验，增加字段应沿这个边界而非重建读取流程。证据为 `deriveWorkItemDetailView` 中 `ContentKind.Redacted` 分支先于 content 构造。

`wire/redacted` 未承接 planningFields，是测试假绿风险。新增用例必须自检覆盖值和可见正控。调查者在基线上遇到 renderer 的 `ERR_MODULE_NOT_FOUND: react`；这是锁定依赖尚未装齐，未来 D1 先安装依赖再取得产品证据。

旧 issue 的上游 PR blocker 已不构成当前代码依赖；承接路径在 `Context and Orientation`。易失 PR 状态由发布 owner 重新回读，不写静态 mergeability 结论。

## Decision Log

决策：直接复制安全行的 `iteration` 与 `targetDate`；拒绝 raw 详情第二份格式化。Rationale：一个事实源同时固定状态标签、缺值和日期文本，安全门已经存在。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：不更改导航与 TD-024 的 store 原子读取；只保持二读遮蔽。Rationale：字段闭环无需新客户端接口。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：本轮完成 spec + plan 与 draft 发布，不执行 D1。Rationale：人类授权的当前交付阶段；技能默认目录与阶段停顿由仓库 `PLANS.md` 和明确任务范围覆盖。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权。

## Idempotence and Recovery

纯投影和 SSR 用例可以重复执行，无外部请求。先检查 dirty state，保留无关修改。RED 失败必须对应新增行为；安装失败或模块加载失败先处理环境，再重跑同一窄命令。

D1 失败停在本批，保留差异和判别证据；通过前不推送产品。回滚整批白名单、renderer 与配对测试，不修改存储或历史计划。公开历史调整需要恢复锚点和 Git 专家流程，不自行清理用户工作树。

draft 发布失败先按分支查询同仓已有 PR，避免重复创建；成功后回读当前 head/base/checks/threads 与两侧关联。保持 draft，不以文档绿检查推导产品完成。

## Interfaces and Dependencies

输入仍是 `WorkItemListReadInput` 与 `WorkItemDetailTarget`；输出仍是 `WorkItemDetailView` 的 content 分支，仅追加两个恒有字符串字段。使用已有 React renderer，client/Provider 接口与权限模型不变。

工具依赖为 Node、锁定 pnpm、Git；离线产品测试无需 GitHub 凭据。发布 owner 使用仓库现有 `gh` 身份与 Project 规范；`Status` 和阻塞关系保持人类所有。

## Outcomes & Retrospective

2026-10-07 23:05 +08:00 的实际产出是已收敛 spec、可执行 D1 与验收矩阵；产品未实施，未来命令尚未作为通过证据。P0 最终证据与 draft URL 由发布 owner 回读后补入本节。

没有新增实施技术债。现有 TD-024 保持原责任边界；若实施发现需要有意延期的真实工作，先更新本计划并登记 `docs/exec-plan/tech-debt-tracker.md`，本次不写猜测债务。

## Bottom Change Note

2026-10-07 23:05 +08:00：根据三份独立设计及代码审评建立计划；固定安全 copy、单字段遮蔽 differential、夹具正控和 date-only 验证，区分文档发布与未实施产品批次。
