# Development 变更请求读取事实 ExecPlan

> 状态：Completed；C1 已实施，独立验收与对抗抽查通过；第一轮评审（2026-10-08，APPROVE）的 2 × P2 / 6 × P3 与修复本身独立复评（0 × P0–P2）的 5 × P3 均已修订；合并状态以 PR #287 回读为准。
> 创建：2026-10-07（Asia/Shanghai）
> 关联：同仓 issue #279；规范：`PLANS.md`。
> 执行上下文：检出 `feature/development-change-request-facts` 的工作树根目录；隔离目录 `.worktrees/development-change-request-plan`。

## Purpose / Big Picture

调用方可以从同一变更请求快照取得真实 head branch 与保守 review state，并按精确 head branch 列出变更请求。它不需要根据提交 SHA 猜分支，也不会把审核未知当作批准。

最小成功证据是两个不同分支指向同一 SHA，各自过滤只得到对应对象；create/get/list 三面返回相同新字段；未提供审核事实时明确为 `unknown`。Development 观察仍遵循既有时间戳定序，头 SHA 只作为相等身份。

## Context and Orientation

调查快照为 2026-10-07 23:05 +08:00、`main@6417d45978ec22778b914a9d7dea91d71fb6bb6e`。执行前用 `git rev-parse origin/main HEAD` 回读，不将快照当成后续远端事实。

变更请求是 `ProviderChangeRequest`，即 Development 域对 Pull Request 一类外部对象的读取形状。现 `packages/capabilities/src/development-provider.ts` 含 state/sourceVersion，无 headBranch/reviewState；`ProviderListChangeRequestsInput` 只有仓库和分页参数。

`packages/providers/fake/src/development.ts` 的记录已持有 `head` 与 `headCommit`；`branchOf` 按仓库和分支名定位。`createChangeRequest` 允许分支名或直接提交 SHA，`toChangeRequest` 没有透出分支和审核事实。

两个同名 sourceVersion 必须区分：`ProviderChangeRequest.sourceVersion` 是头 SHA，仅作相等比较；`ProviderObservation.sourceVersion` 是观察更新的可排序载体，现只允许定宽 30 字节 UTC 纳秒时间戳或 undefined。权威规则在 `packages/capabilities/src/observation.ts`，SHA/v9/v10 已被 `makeObservation` 拒绝。

`packages/core/src/chain-facts.ts::readChangeRequest` 当前用 `sourceVersion === head` 定位，属于已有相等语义；本项不修改谱系发现或观察存储。fake 没有 reconcile 实现，本项也不添加观察流。

`DevelopmentReviewRead` key 已预留，但 Development port 没有独立 review 方法。此切片的 reviewState 是 ChangeRequestRead 快照中的字段，不因此声明独立 ReviewRead 能力。

事实是主线已有 SHA 相等和 canonical 时间规则；硬约束是两个版本载体不可混用；决策是直接扩展快照。假设是 review 字段不参与规划状态写入、lineage 匹配或发布门判定，实施必须核对这一点。

## Design / Spec

采用有限、保守的规范审核状态：

```ts
export type ProviderReviewState = 'approved' | 'changes_requested' | 'review_required' | 'unknown'
// ProviderChangeRequest 新增：
readonly headBranch: string | undefined
readonly reviewState: ProviderReviewState
// ProviderListChangeRequestsInput 新增：
readonly headBranch?: string
```

`unknown` 表示来源未提供可靠审核结论；`review_required` 表示来源明确报告需要审核。不能从没有审批、PR open、CI success 或评论数量推断两者。fake 默认 `unknown`；测试记录可显式设置四种状态。来源未来增加未知枚举时投影为 unknown，不默认为 approved。

create 输入的 head 能精确解析为本仓库分支时，记录该分支名；直接 SHA 输入无法确定分支身份时 headBranch 为 undefined。即使已有多个分支指向相同 SHA，也不反推分支。保留现 SHA 创建语义，不为字段增强收窄已有接口。 Superseded by `Decision Log`「评审修订 P2-2」（2026-10-08）：fake 仍接受 sha 作 head；port 与共享套件把它定为 provider 的可选形态——建成时 headBranch 为 undefined，不接受时答结构化 `invalid_input` 且不留任何对象。

list 依次限定 repository 身份、按 headBranch 字节精确相等过滤、按既有 externalId 稳定排序、分页。undefined 表示不筛选；空字符串返回结构化 `invalid_input`，不 trim 或 case-fold。未知但非空分支返回成功空页且 nextCursor undefined。

本 fake 的游标继续沿已有 `paginate` 协议；端口明确游标只可在同一 repository、headBranch、limit scope 下重用。调用方改变 scope 必须从 cursor undefined 重新开始。本切片不新增持久 cursor 协议，不声称 provider 会识别所有跨 scope 误用。

新增字段恒有（headBranch 的值可 undefined），create/get/list 相同字段组；read-only CR provider 仍用自己的读 key。未实现 CR 的 Local Git 保持结构化 not_supported，不为了套件补 PR 功能。

Development port 的观察注释明确引用已有 canonical 规则；不改 `makeObservation`、Storage 排序或 sourceVersion 比较函数。（2026-10-08 第一轮评审核实：此句在 8fd546bd 上没有对应改动；评审修订在 `ProviderChangeRequest.sourceVersion` 与 `reconcile?` 两处补注释指向 `packages/capabilities/src/observation.ts` 的 R4，本句自此成立，见 `Decision Log`「评审修订 P3-port」。）同一个观察主体不混用有版本/无版本，raw 时间戳须由 provider 用 `sourceVersionFromTimestamp` 无损归一。

拒绝任意字符串 reviewState 的方案：调用方无法区分可靠审核结论与未知平台枚举。拒绝 fake 默认 review_required 与声明 ReviewRead：没有源事实和独立方法支撑。拒绝新增 review API：扩大读取时刻、权限和方法生命周期而无当前验收收益。

## Global Constraints

唯一允许改动集如下；P0 只含计划与索引，C1 已按本集合实施（2026-10-07 起）。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/completed/2026-10-07-development-change-request-facts.md`（实施期间位于 `active/`）、`docs/README.md` | spec + plan 与索引 |
| 产品 | `packages/capabilities/src/development-provider.ts` | 类型、filter 与版本义务 |
| 产品 | `packages/providers/fake/src/development.ts` | 真实分支与审核字段投影 |
| 测试 | `tests/contract/suites/development.js`、`tests/contract/development-contract.test.js` | create/get/list 与分支过滤判别 |
| 测试 | `tests/contract/capabilities-observation.test.js` | Development subject 的既有定序护栏 |
| 测试夹具 | `tests/fixtures/development-suite-adapters.mjs` | 预置变更请求事实，合法形态 `good-branch-head-only` / `good-shared-provider`（2026-10-08 评审修订起） |

新增类型沿 capabilities 既有 barrel 导出，不加 port 方法，registry 的 keyof 方法锁无需变化。不改 GitHub Development、core 谱系、Storage 或观察源协议；#231/#233 不进入本闭环。pre-MMP 直接修改实验类型，不加兼容层。

Node `>=22`、pnpm `10.28.2`；不新增依赖。代码、测试与夹具增删合计不超过 800，文档增删合计不超过 1300。估计产品 35–70、suite 25–45、判别测试 130–210，合计 190–325；文档约 200–270。实际提交前重新计数。

#279 与 #205 都触及 Development suite，未来由单 owner 串行整合并重跑相关验证；共享文件不形成业务 blocked-by，四个 PR 仍独立验收和整体回滚。本轮不写人类 `Status` 与阻塞关系，不实施产品、ready 或 merge。 Superseded by `Progress` 与 `Decision Log`（2026-10-08）：C1 已实施；「四个 PR」在本计划内没有定义，本句实际涉及的是本 PR #287（issue #279）与已合并的 PR #288（issue #205）；评审修订、整合提交、复评与 rebase merge 由评审会话按人类伙伴的指定负责。人类 `Status` 与阻塞关系仍不由 agent 写入。

## Plan of Work

### Batch P0 · 设计、计划与 draft 发布

最小闭环：有限 review 状态、分支/观察边界、可执行 C1 与回滚在同一计划。涉及主文件为本计划和 `docs/README.md` 的一个索引行。

完成三份独立方案比较，核对当前 port/fake/Observation，再运行文档检查。整理文档提交后由发布 owner 创建关联 #279 的 draft，回读 PR closingIssuesReferences 与 issue closedByPullRequestsReferences；机械回填 ExecPlan、Batch，保持 draft。

在头部声明的检出根目录执行：

```sh
node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/board-status-semantics.test.js
git diff --check
```

期望全部 pass、无空白错误；另外核对固定 13 节与索引链接。P0 无产品结论。回滚为未发布文档差异；公开 draft 的重试先查询同分支 PR，避免重复。

### Batch C1 · 变更请求形状、分支过滤与版本语义

最小闭环：真实 headBranch、四种 reviewState、分支先过滤后分页，以及 SHA/时间载体边界共同交付。涉及主文件为 `development-provider.ts`、fake `development.ts` 与 Development suite；确切集合见 `Global Constraints`。

1. 先执行 `pnpm install --frozen-lockfile`，期望 exit 0。写具名 `change-request-head-branch-and-review-facts`：同一实例创建分支 CR 和直接 SHA CR，get/list/create 新字段精确一致；SHA CR 的 headBranch 必须 undefined，review 默认 unknown。 Superseded by `Decision Log`「评审修订 P2-2」（2026-10-08）：共享套件不再要求 sha 建成、也不再要求新建为 unknown（只禁止 approved）；fake 的行为不变。（复评后收窄为只允许 unknown / review_required，见 `Decision Log`「评审复核 P3-fresh」）
2. 写 `change-request-filter-before-pagination`：两个不同 branch 同 SHA，加不同 SHA/branch 诱饵；每个目标分支至少两个 CR，limit 1 真跨页、无重复无遗漏。再加同 binding 的另一个仓库同名 branch，证明 repository 隔离；未知 branch 空页、空串 invalid_input。
3. 写 `change-request-review-states-are-not-guessed`，显式 fixture 覆盖四种状态，至少 approved 与 changes_requested 含非 unknown 正控。共享 suite 通过 adapter 的预置事实或已有创建结果断言，不访问 fake.state；fake 专属 discriminator 可以直接构造记录。（2026-10-08 评审修订落实「adapter 的预置事实」：共享套件新增可选 `expect.preparedChangeRequest`，见 `Decision Log`「评审修订 P2-1」。）
4. 运行第一条契约命令，预期新字段/过滤断言在旧代码 RED；记录具体断言。扩展类型与 fake 记录、toChangeRequest、filter，保持原 create SHA 路径；重跑 GREEN。suite 中已声明读/写按各自 key，Local Git 不被迫提供 CR。
5. 在 Development subject 上补 `development-observation-version-remains-canonical`：makeObservation 拒绝 SHA/v9/v10；两个词法顺序相反的 SHA 仍只被 CR 身份相等读回；canonical 时间戳旧<新，乱序后到旧观察不能顶替新观察。沿现 fake Storage 入口验证已有定序，不修改生产排序。 Superseded by `Decision Log`「P2 精简 capabilities-observation」与「评审修订 P3-order」（2026-10-08）：乱序段已删除，由 `tests/contract/suites/storage-sync.js` 的两个 Storage 组承担；本用例保留 sha/v9/v10 拒绝，并按升序、降序两种创建顺序做引用相等读回。
6. 运行窄集成、谱系和边界回归；确认 capabilities 新旧 key 集合完全相同，ReviewRead 不声明。类型、fake 和判别测试与计划证据合成一个可审阅 C1 提交单元。

全部命令在检出 `feature/development-change-request-facts` 的工作树根目录：

```sh
node --test tests/contract/development-contract.test.js tests/contract/capabilities-observation.test.js
node --test tests/integration/development-local-git.test.js tests/e2e/delivery-lineage.test.js
pnpm run typecheck
pnpm run boundaries
```

期望全部 pass / exit 0，新分页测试确有多页；Local Git 原 CR not_supported 保持；谱系 SHA 相等匹配不回归，Observation 拒绝 SHA 的用例通过。回滚整体 C1 的类型/fake/suite/测试，保留原观察规则，无存储迁移。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| create/get/list 事实相同 | 新字段完整 deepStrictEqual；fake 默认 unknown（共享套件对新建只允许 unknown / review_required，见本表「审核未提供仍 unknown」行） |
| 不以 SHA 猜分支 | 两 branch 同 SHA 与 detached SHA 正反控 |
| 按真实 branch、同仓库过滤 | 同名跨仓诱饵，limit 1 先过滤后分页；大小写、首尾空白、真前缀与后缀子串变体不命中，按 sha 过滤不带出 detached（字节精确、按 headBranch 事实）；空串 / 未知分支按 read 键在 create 门之前判定；预置事实在只读形态必需（缺失时具名报「测试装配缺」），能现建的形态可选 |
| 分页完整且 scope 明确 | 同 scope 不重不漏、nextCursor 结束；改变 scope 必须从 `cursor: undefined` 重新读取并完整枚举新 scope，provider 不承诺识别跨 scope 误用；两个 scope 都与同 scope 的一次大页相对比较，由合法形态 `good-shared-provider` 钉住 |
| 审核未提供仍 unknown | 四枚举 exact equality；至少两种非 unknown 正控；union 之外的来源枚举投影为 unknown（fake 专属用例）；共享套件要求预置事实原样投影、新建变更请求只能是 unknown 或 review_required |
| 新规则不被放宽 | 夹具 `RULE_LIAR_NAMES` 的 13 个规则坏形态在子集矩阵里非零退出并命中各自的具名断言；主用例的必需清单与它逐项相等 |
| sha 作 head 是可选形态 | 建成则 headBranch undefined、sourceVersion 为该 sha；不接受则 `invalid_input`、retryable false、对象集合不变；合法形态 `good-branch-head-only` 在 base 与修订后套件上零退出 |
| 不声明虚构 ReviewRead | 五个适配器上 `accessOf(snapshot, development.review.read) === 'unavailable'`，加 `registry.ts` 的 `DevelopmentProviderSurface` 方法锁与 typecheck |
| SHA 不进入观察定序 | Development subject 的 `makeObservation` 拒绝 sha/v9/v10，两个词法顺序相反的 sha 作为 CR 身份按引用相等读回，升序、降序两种创建顺序各一轮（观察侧乱序与 sha 拒绝的主判据由 `storage-sync.js` 既有组覆盖） |
| 真实子集保持 | Local Git 套件与 delivery-lineage 回归 |
| 当前文档可发布 | P0 检查、13 节、索引、披露和实际规模 |

提交前在该检出执行：

```sh
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望 exit 0；对未提交新增内容先人工核对，再用整理后的真实提交重跑完整 range。按 `docs/development/publication.md` 完成人工五类目检查，不把文档检查等同产品验收。

## Progress

- [x] (2026-10-07 23:05 +08:00) 当前 port/fake/Observation 与调用语义调查完成。
- [x] (2026-10-07 23:05 +08:00) 三方设计独立审评完成；有限 union、unknown 默认与 ReviewRead 边界已固定。
- [x] (2026-10-07) P0 文档验证、draft 发布与双向 issue 回读。（发布 owner 的范围，本 C1 执行者不代为勾选）评审修订会话回读（观察时刻 2026-10-08 15:54 +08:00 @ 8fd546bd）：`gh pr view 287 -R SingularityKChen/harness-projects --json closingIssuesReferences` 含 #279，`gh issue view 279 -R SingularityKChen/harness-projects --json closedByPullRequestsReferences` 含 #287，据此勾选。
- [x] (2026-10-07) C1 新字段与过滤 RED → GREEN、版本护栏和真实子集验收。
- [x] (2026-10-08) 独立对抗验证 P1-A/P1-B/P1-C、P2、P3 修复并重跑全部验证。
- [x] (2026-10-08 01:46 +08:00) 独立产品验收：窄契约 65 pass、Local Git/lineage 36 pass、全量 contract/integration/e2e 1220 pass、MVP-0 7 pass；typecheck、boundaries、size、disclosure、diff-check 与文档三项检查均 exit 0。
- [x] (2026-10-08 01:47 +08:00) 独立对抗抽查：reviewState 恒 unknown、忽略 headBranch 过滤、SHA 反推分支、删除空串 invalid_input 四个变异均 RED；每次变异后恢复且 `git status --short` 干净。
- [x] (2026-10-08 01:48 +08:00) 重构评估：无可做重构；核心投影与过滤路径已是单一职责，删除或合并只会降低判别性或扩大共享 suite 改动面。
- [ ] (2026-10-08) 追加验收提交、推送后归档。 Superseded by `Progress` 末项（2026-10-08）：追加验收提交已完成，归档并入末项。
- [x] (2026-10-08) 第一轮评审（head 8fd546bd）：APPROVE，2 × P2 / 6 × P3；逐条复现后全部属实（证据见 `Surprises & Discoveries`）。
- [x] (2026-10-08) 变基到已合入 PR #288 的 `main`（ebe6dc40）；#288 的「判定按被测方法自己的键」与注册时克隆 `expect.objects` 成为本 PR 修订的前提。
- [x] (2026-10-08 16:50 +08:00) 评审修订完成：2 × P2 / 6 × P3 全部修复（见 `Decision Log`「评审修订」各条）；验证计数见 `Outcomes & Retrospective`。
- [x] (2026-10-08) 复评（head f7cbd2f8）：0 × P0–P2、5 × P3，原 8 条逐条确认已修。
- [x] (2026-10-08 17:54 +08:00) 复评 5 × P3 修订完成（见 `Decision Log`「评审复核」各条）；验证计数见 `Outcomes & Retrospective`。
- [ ] (2026-10-08) 整合提交、归档与 rebase merge（评审会话负责，见 `Decision Log` 接手决策）。

## Surprises & Discoveries

观察 sourceVersion 的主线规则已经比 issue 的最低文字要求严格：30 字节 canonical 时间戳或 undefined，SHA 只可留在 CR sourceVersion。证据为 `observation.ts` 的字段区分与 `makeObservation` 断言；不能引入 equality-only 观察模式。

fake 的 head 输入同时接受分支和 SHA，因此非空字符串不足以证明分支身份。证据为 `createChangeRequest` 的 `branchOf(...).headCommit ?? input.head`；toChangeRequest 必须保存解析结果，不能透出 input.head 充作分支。

ReviewRead 预留 key 没有方法，字段增强不自动变成独立能力面。选型时否决默认 review_required 和无方法声明 key 的候选；本计划以 unknown 默认修正该假设。

2026-10-07 C1 执行：fake 的 review 事实没有来源可写，只有测试能构造。fake 的创建路径只能落 `unknown`，「四种状态逐个透出」的判别力必须由直接构造 `state.changeRequests` 的 fake 专属用例提供；把四种状态塞进共享 suite 会要求 provider 暴露一个制造审核结论的后门，等于新增未验证的写入面。证据：`tests/contract/development-contract.test.js` 的 `四种 reviewState 逐个精确透出` 用例；变异成 `reviewState: 'unknown'` 时只有它变红（54 pass / 1 fail）。

2026-10-07 C1 执行：「先过滤后分页 vs 先分页后过滤」在**只断言结果集合**的写法下等价，常规分页遍历甚至可能仍然收敛。必须额外断言「每个非末页都有命中项」与「页数等于命中对象数」，否则该顺序不可判别。证据：临时把 `listChangeRequests` 改成先分页再过滤，加强前的断言 55 pass / 0 fail，加强后 53 pass / 2 fail（`先过滤后分页时每个非末页都必须有命中项`）。

2026-10-08 第一轮评审修订：两条新用例都在 `createChangeRequest` 未声明时早退，被测方法 `listChangeRequests` 在只读形态下一次都不调用，过滤语义对只读 provider 是假绿。证据：在检出 `feature/development-change-request-facts` 的工作树根目录、变基后的修订前树（f596527a）上，M4r（只读时空串当不筛选）、M2r（只读时忽略过滤）、M7（case-fold）、M7b（trim）、M9（按原始 head 过滤）、M17（sourceVersion 取最大）六个变异在 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 上均 1289 pass / 0 fail 存活。

2026-10-08 第一轮评审修订：修订前的套件把「sha 作 head 必须建成」与「新建必须 unknown」写成了所有可创建 provider 的义务。证据：合法形态 `good-branch-head-only`（只接受分支名作 head、新建报 review_required）在 base 套件 10 pass / 0 fail、修订前套件 10 / 2（红在两条新用例）、修订后套件 12 / 0。

2026-10-08 第一轮评审修订：共享实例下的绝对集合比较不止误伤 scope B。不能建分支时目标退回 `expected.baseBranch`，前面用例在 `main` 上建的变更请求让 scope A 先红。证据：`good-shared-provider`（无故障场景共用实例、branchCreate false）在 base 套件 10 / 0、修订前套件 11 / 1（`先过滤后分页必须恰好枚举目标分支的全部变更请求，不重不漏`）、修订后 12 / 0；评审者的全能力共享实例在修订前红在 scope B 的有界页数。

2026-10-08 第一轮评审修订：fake 的投影把 union 之外的记录值原样透传，port 注释的「投影为 unknown」没有实现。证据：探针向 `state.changeRequests` 推入 `reviewState: 'dismissed'` 的记录，`listChangeRequests` 读回 `["dismissed"]`。

2026-10-08 复评：修订新增的规则只有合法形态守护「套件别太严」，没有坏形态守护「别太松」。证据：评审者在 f7cbd2f8 上把套件里的新断言逐条删掉（S1–S7：新建 approved 拒绝、sha 拒绝码、sha 拒绝零副作用、字节精确变体循环、预置 reviewState 投影、sha 建成时 headBranch undefined、空串 invalid_input 码），窄集都是 164 pass / 0 fail。

2026-10-08 复评：只读形态缺省 `expect.preparedChangeRequest` 时投影与字节精确断言静默跳过；字节精确变体没有前缀 / 子串。证据：只读 fake 压平 reviewState 或 case-fold 过滤，提供字段时 11 / 1、去掉字段后 12 / 0；fake 变异 R1（新建报 changes_requested）、R2（前缀匹配，即 GitHub 搜索 `head:` 的语义）、R2b（子串匹配）在全量上 1289 / 0 存活。

## Decision Log

决策：采用四值 ProviderReviewState，fake 默认 unknown，不声明 ReviewRead。Rationale：把来源未知与来源明确要求审核分开，保持 capability/method 的真实对应。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：保留 SHA create，headBranch 未知为 undefined；filter 在分页前且游标限同 scope。Rationale：SHA 与分支是不同身份，不因展示字段扩大协议或破坏现创建语义。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。
Superseded by「评审修订 P2-2」（2026-10-08）：fake 保留 SHA create；port 与共享套件把 sha 作 head 改为 provider 的可选形态。

决策：保留现观察 canonical 不变量、不改 Storage/core。Rationale：当前入口和存储已有时间序护栏，本项只解释与补 Development 判别。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：当前仅 spec + plan 与 draft 发布，未来产品 C1 未执行。Rationale：人类明确任务阶段，不重复请求设计批准；仓库规范优先于技能默认分文件模板。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权。
Superseded by：C1 已于 2026-10-07 实施（见 `Progress` / `Outcomes & Retrospective`）；本条只保留当时的阶段结论。

决策：C1 按计划原样实施，不新增 review 写入面、不声明 `development.review.read`。Rationale：fake 只能默认 `unknown`，四种状态的判别力由直接构造记录的 fake 专属测试承担，共享 suite 只断言「未提供审核事实时是 unknown」与能力声明不含 review.read。日期/作者：2026-10-07 / C1 实现 owner。
Superseded by「评审修订 P2-1」与「评审修订 P2-2」（2026-10-08）：共享套件对新建变更请求只禁止 approved，另按预置事实断言来源结论原样投影。（复评后收窄为只允许 unknown / review_required，见 `Decision Log`「评审复核 P3-fresh」）

决策：P1-A 让过滤用例按 `declares(provider, 'createBranch')` 分叉，不建分支时以 `expected.baseBranch` 为目标分支、以 detached SHA CR 为诱饵。Rationale：分支创建是独立可选能力（#205 的子集矩阵会把 `branchCreate: false` 的 provider 接进同一 suite），过滤用例不得隐式依赖它；四条具名断言（limit 1 真跨页、每页必有命中项、`pages === 命中数`、不重不漏）全部保留。日期/作者：2026-10-08 / C1 实现 owner。
Superseded by「评审修订 P3-scope」（2026-10-08）：不建分支时诱饵改为预置的 `worktreeBranch` 分支加可选的 detached SHA CR；`pages === 命中数` 改为「每页恰好一项 + 逐页集合等于同 scope 的一次大页」。

决策：P1-B 以用例落实「改变 scope 必须从 `cursor: undefined` 重新读取」，不新增跨 scope 误用识别。Rationale：实测 fake 复用旧游标跨 scope 时静默返回空页，Design §49 已主动免责；把验收表改成可判定的正向义务，并把「provider 不承诺识别误用」写进同一行。日期/作者：2026-10-08 / C1 实现 owner。

决策：P1-C 把 `development.review.read` 必须 unavailable 的断言移到所有早退之前，验收表改为「单 key 断言 + registry 方法锁 + typecheck」。Rationale：原位置在 `createChangeRequest` 未声明的早退之后，5 个适配器中有 3 个走不到；「key 集合比较」是过度声明。日期/作者：2026-10-08 / C1 实现 owner。

决策：P2 精简 `capabilities-observation.test.js` 的新增用例，只保留「sha/v9/v10 不是观察载体」与「两个词法顺序相反的 sha 作 CR 身份按引用相等读回」。Rationale：原 CR 侧断言是恒真（按 ref 相等读取，任何排序回归都不会红），storage 乱序段与 `storage-sync.js` 在两个实现上的既有组重复；为凑 Coverage 保留空洞断言会稀释判别力。日期/作者：2026-10-08 / C1 实现 owner。

决策：独立验收后不做产品重构。Rationale：`toChangeRequest`、headBranch 过滤和创建时分支解析各自职责清晰；删减会损失字段投影或变异判别，触及共享 `tests/contract/suites/development.js` 还会扩大与 PR#288 的整合面。日期/作者：2026-10-08 01:48 +08:00 / 验收 owner。

决策：评审修订与合并收尾由评审会话接手。Rationale：#287 由 Codex 会话创建，没有可接手的 Claude 作者会话；人类伙伴在评审会话中明确指定由该会话负责修复、归档、整合提交、复评与 rebase merge。日期/作者：2026-10-08 / 人类伙伴（评审会话记录）

决策：评审修订 P2-1——过滤用例按被测方法 `listChangeRequests` 自己的键判定：空串 `invalid_input`、未知分支成功空页、预置事实的字节精确过滤都在 create 门之前；共享套件新增可选 `expect.preparedChangeRequest`（`{ ref, headBranch, reviewState }`），声明 `change_request.read` 时据它判定 get / list 的投影与过滤。fake 的预置事实是 `prepared/held` 上一份来源已批准（approved）的变更请求，所有 fake 适配器共用。Rationale：#288 的规则是「判定一律按被测方法自己的键」；只读形态没有现建对象，只能靠适配器给出的预置事实获得判别力。字段可选，是为了不强迫没有预置变更请求的适配器（本地 Git 不声明 CR 读）；预置 approved 同时给共享套件一个非 unknown 正控。日期/作者：2026-10-08 / 评审会话（修订子任务）。
Superseded by「评审复核 P3-prepared」（2026-10-08）：只读形态（能读不能建）必须提供该字段，能现建时仍可选。

决策：评审修订 P2-2——sha 作 head 是 provider 的可选形态：建成时 headBranch 必须 undefined、sourceVersion 为该 sha；不接受时必须结构化 `invalid_input`、retryable false、对象集合不变。新建变更请求的 reviewState 只要求属于四值 union 且不是 approved。port 的 `ProviderCreateChangeRequestInput` 与 `headBranch` 注释同步写明。新增合法形态 `good-branch-head-only` 钉住两条。Rationale：GitHub 的 `POST /pulls` 只收分支名；开了必需审核的仓库对新 PR 报 REVIEW_REQUIRED，按本 PR 的设计投影为 review_required。创建那一刻还不存在任何审核，approved 只能是猜测；changes_requested 同样不可能出现，但它不会让调用方按虚构的批准行动，因此取最小放宽、不另立规则。fake 本身仍接受 sha 并默认 unknown。日期/作者：2026-10-08 / 评审会话（修订子任务）。
Superseded by「评审复核 P3-fresh」（2026-10-08）：放行 changes_requested 不是最小放宽；允许集合收窄为 unknown / review_required。

决策：评审修订 P3-scope——过滤用例的 scope A 与 scope B 都与同 scope 的一次大页相对比较：逐页集合等于大页集合、无重复、limit 1 时每页恰好一项，大页包含本用例建的对象并排除诱饵；新增合法形态 `good-shared-provider`（无故障场景共用一个实例、不能建分支）。不能建分支时以预置的 `worktreeBranch` 作诱饵分支；直接 sha 的 detached 诱饵只在 provider 接受 sha 时存在。Rationale：套件明确支持共享对象的适配器（本地 Git 共用一个 fixture）；评审只指出 scope B，但不能建分支时 scope A 同样依赖「从空集开始」，修订前套件上实测先红在 scope A；sha 诱饵变成可选后，不能建分支的形态需要一个总在的分支诱饵来保持「先过滤后分页」的判别。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审修订 P3-bytes——字节精确与「按 headBranch 事实过滤」用机械断言钉住：大小写变体、首尾空白变体的过滤结果里每一项都必须带被查询的分支名，因此不得命中原分支的变更请求；按 sha 过滤的结果里每一项的 headBranch 都必须等于该 sha，因此不会带出 detached 变更请求。同一组断言也对预置事实执行。Rationale：评审实测 M7 / M7b / M9 在全量上存活；断言写成「每一项的 headBranch 必须字节等于查询值」，不依赖诱饵集合大小，共享状态下同样成立。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审修订 P3-enum——fake 记录的 reviewState 改为来源原始枚举（string），`toChangeRequest` 把 union 之外的值投影为 unknown；fake 专属用例补 `dismissed` 读回 unknown 的断言，标题改为「union 之外的来源枚举投影为 unknown」。Rationale：port 注释早已规定这条投影，用例标题也声称覆盖，但实现原样透传、仓库内没有可失败的证据；修实现而不是删标题，port 的承诺才有判别。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审修订 P3-order——`capabilities-observation.test.js` 的 CR 读回按升序、降序两种创建顺序各跑一轮，每轮先建完两个再读回。Rationale：只跑升序时「取最大」回归恰好读回正确值（评审 M17 存活），只跑降序时「取最小」同理；sha 不是观察载体的主判据在 `storage-sync.js` 的两个 Storage 组上，本用例只是 Development 侧护栏。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审修订 P3-port——在 port 的 `ProviderChangeRequest.sourceVersion` 与 `reconcile?` 上加注释指向 `observation.ts` 的 R4，而不是把 Design 的声明改成「本项不改 port」。Rationale：issue #279 的范围要求定序规则在 port 中陈述；两行注释让声明成立，不改任何运行时行为。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：两条新用例的「未声明」分支统一改用 `assertUndeclaredRejected`（结构化 not_supported + 完整对象集合不变），不再手写 before / after 比较。Rationale：#288 已在注册时把 `expect.objects` 包成 `structuredClone`，直接比较已经安全；统一入口让「未声明」判定只有一个实现，与 #288 的其余用例一致。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审复核 P3-prepared——只读形态（声明 change_request.read、不声明 create）经 `need('preparedChangeRequest', …)` 必须提供预置事实，并校验 `headBranch` 是非空字符串；能现建变更请求的形态仍可选。子集矩阵新增坏形态 `missing-prepared-change-request-field`。Rationale：#288 在同一文件立下的规则是「形态所需的预置字段用 `need()` 具名报装配缺失」（`worktreeRef`、`worktreeBranch`、`worktreeDupBranch`）；可选字段会让只读的 GitHub 适配器不填它就跳过 reviewDecision 投影与 head 过滤的判定。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审复核 P3-fresh——新建变更请求的 reviewState 只允许 `unknown` 与 `review_required`。Rationale：P2-2 需要放宽的只有开了必需审核时的 REVIEW_REQUIRED；changes_requested 在创建时同样不可能来自来源，把「没有审批」映射成它会让调用方阻塞或催作者返工，与 port 注释「把来源未知读成任何结论都会让调用方按平台没说过的事实行动」一致；变异 R1 存活证明旧规则太松。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审复核 P3-variants——字节精确变体补真前缀 `branch.slice(0, -1)` 与后缀子串 `branch.slice(1)`，空变体跳过。Rationale：GitHub 搜索 `head:` 限定符按前缀匹配，是 #231 的现实实现路线；前缀查询同时让前缀与子串匹配的实现红在「每一项都必须带这个 headBranch」，后缀查询另外钉住按后缀匹配的实现，各有坏形态（`filter-prefix`、`filter-suffix`）守护。日期/作者：2026-10-08 / 评审会话（修订子任务）。

决策：评审复核 P3-liars——为本 PR 的每条新规则各加一个坏形态（夹具 `RULE_LIARS`，共 13 个：新建报 approved / changes_requested、sha 建成却带 headBranch、sha 拒绝答 not_found / not_supported / 可重试 / 留下对象、只读压平 reviewState、只读 case-fold、前缀 / 后缀匹配、空串答 not_found、只读缺预置事实），都建在 `baseProvider` 上只扭曲一件事；主用例的必需清单与导出的 `RULE_LIAR_NAMES` 逐项相等。空串的 invalid_input 断言补具名消息，让坏形态能按消息片段钉住。Rationale：合法形态只防「套件别太严」，坏形态才防「新断言被改成 no-op」；#288 补坏适配器矩阵也是为了同一类静默变绿。日期/作者：2026-10-08 / 评审会话（修订子任务）。

## Idempotence and Recovery

每个契约用例用独立 fake 实例，list 无并发写入时分页稳定。（合法形态 `good-shared-provider` 例外：无故障场景共用一个实例，套件的列表断言因此只做相对比较。）重跑不涉及外部平台。Local Git 用仓库现有临时 fixture，不能在真实用户仓库造分支/worktree。

遇到 typecheck 消费者缺口先定位真实 caller，不加临时 optional 字段或兼容 dual read。suite 与 #205 整合后重新锁 head，重跑同一契约/Local Git 命令，防止两份计划对同文件漂移。

失败保留当前差异，回到已知 C1 前状态时整体撤回产品及配对测试；无 schema 或数据清理。共享历史改写先建恢复锚点并进入专家流程，不自行 force push。

发布失败按分支查已有 draft；最终 push 后回读 head/base/checks/threads 和两侧关联，不 ready、merge 或改人类规划字段。 Superseded by `Decision Log` 接手决策（2026-10-08）：整合提交、复评与 rebase merge 由评审会话按人类伙伴的指定负责；人类规划字段仍不由 agent 改写。

## Interfaces and Dependencies

新类型由 capabilities 导出；DevelopmentProvider 方法集合保持不变。list 的 headBranch 是可选精确 filter，headBranch 与 sourceVersion 分别表示分支身份和提交身份；reviewState 随 CR read 快照。

工具为锁定 Node/pnpm、Git、现有离线 fake 和 Local Git fixture。产品验收无需真实 GitHub 凭据；真实 GitHub Development、独立 ReviewRead API 和 Host 同步由它们自己的闭环负责。

## Outcomes & Retrospective

2026-10-07 23:05 +08:00 产出是独立审评后 spec + plan。产品新增字段、过滤与未来命令尚未实施/执行；P0 最终证据与 draft 关联由发布 owner 回读后补录。

2026-10-07 C1 执行完成（批次见 `Global Constraints` 的允许集合）。在检出 `feature/development-change-request-facts` 的工作树根目录：`node --test tests/contract/development-contract.test.js tests/contract/capabilities-observation.test.js` 65 pass / 0 fail；`node --test tests/integration/development-local-git.test.js tests/e2e/delivery-lineage.test.js` 36 pass / 0 fail；`pnpm run typecheck` exit 0；`pnpm run boundaries` 8 pass / 0 fail；全量 `tests/contract tests/integration tests/e2e` 1220 pass / 0 fail；`tests/mvp0` 7 pass / 0 fail。RED 证据：实现前同两条新 suite 用例分别失败于 `分支名输入必须投影出真实 headBranch`（actual `undefined` vs expected `'main'`）与 `过滤后的每一页都必须全部命中目标分支`。变异实验：把 `reviewState` 固定成 `'unknown'` → 54 pass / 1 fail（`四种 reviewState 逐个精确透出`）；忽略 headBranch 过滤 → 52 pass / 3 fail；从 SHA 反推分支 → 53 pass / 2 fail；删除空串 `invalid_input` → 53 pass / 2 fail；先分页再过滤（断言加强后）→ 53 pass / 2 fail。`node scripts/rule-checks.mjs size origin/main` 与 `disclosure origin/main`、`git diff --check origin/main...HEAD` 均 exit 0。

2026-10-08 独立对抗验证后修复（P1-A/B/C、P2、P3，见 `Decision Log`）。P1-A 实测：把同一 suite 接到 `branchCreate: false` 的 fake 适配器上，两条新用例均 GREEN（`变更请求的分支与评审事实` 与 `变更请求先按 headBranch 过滤再分页` 各 pass，临时适配器文件已删除）；该适配器上 6 条既有用例仍 RED，因为 #205 的子集矩阵尚未实施，本 PR 只保证新增用例不再依赖 `createBranch`。P1-C 实测：`development.review.read` 的 unavailable 断言现位于两个新用例的所有早退之前，5 个适配器全部执行。 Superseded by 本节「2026-10-08 第一轮评审修订」一段（2026-10-08）：实际只有「变更请求的分支与评审事实」用例含这条断言，过滤用例没有——过滤用例不读 reviewState，也不需要它。

2026-10-08 独立验收实测：十组命令全部 exit 0；窄契约 65/65、Local Git 与 delivery lineage 36/36、全量 contract/integration/e2e 1220/1220、MVP-0 7/7、boundaries 8/8、文档三项 15/15。四个临时变异均 RED：reviewState 恒 unknown 为 54 pass / 1 fail；删除 headBranch 过滤为 52 pass / 3 fail；SHA 反推分支为 53 pass / 2 fail；删除空串 invalid_input 为 53 pass / 2 fail。变异脚本在每次运行后恢复原文件，随后 `git status --short` 无输出。

与 issue #205（PR#288）共享 `tests/contract/suites/development.js`：本 PR 只在该文件新增一个 hunk（修复后为 `@@ -207,0 +208,121 @@`，共 121 行），位于既有 `变更请求的每个方法按**自己**声明的能力` 用例（167–206 行）与 `原生谱系——分支头部提交按外部 id 找回` 用例（原 208 行、现 329 行）之间；没有改动任何既有函数、`METHOD_KEY`、`assertNotSupported` / `assertUndeclared` / `implemented` / `declares` 与适配器形状。串行整合时应先合入 #288 的 `METHOD_KEY` 与前置守卫改动，再把本 121 行整体重放到该位置之后。 Superseded by 本节「2026-10-08 第一轮评审修订」一段（2026-10-08）：PR #288 已先合并，本 PR 已变基到其上并按 #288 的判定规则修订；当前 hunk 用 `git diff origin/main...HEAD -- tests/contract/suites/development.js` 回读。

2026-10-08 第一轮评审修订（在检出 `feature/development-change-request-facts` 的工作树根目录；base `origin/main` @ ebe6dc40，已含 PR #288）：评审 8 条（2 × P2 / 6 × P3）逐条复现后全部属实、全部修复，处置见 `Decision Log`「评审修订」各条。验证（观察时刻 2026-10-08 16:50 +08:00 @ a844e718，代码树与第一轮修订的最终提交相同——复评修订后的计数见本节「2026-10-08 复评修订」一段；重算命令即下列命令）：`node --test tests/contract/development-contract.test.js tests/contract/capabilities-observation.test.js tests/integration/development-local-git.test.js tests/e2e/delivery-lineage.test.js` 164 pass / 0 fail；`node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` 1289 / 0；`node --test tests/mvp0` 7 / 0；`pnpm run typecheck` exit 0；`pnpm run boundaries` 8 / 0；`NODE_OPTIONS=--test-reporter=tap node --test tests/contract/development-contract.test.js` 82 / 0；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/board-status-semantics.test.js` 15 / 0。子集矩阵：6 个合法形态（新增 `good-branch-head-only`、`good-shared-provider`）零退出，32 个坏形态非零退出且失败消息命中预期片段。

合法形态三向对照（同一回读时刻，把 `tests/contract/suites/development.js` 临时换成对应版本后逐字节还原）：`good-branch-head-only` 在 base（ebe6dc40）/ 修订前（f596527a）/ 修订后套件上分别 10 pass / 0 fail、10 / 2、12 / 0；`good-shared-provider` 分别 10 / 0、11 / 1、12 / 0。

变异表（最终代码树，全量 contract/integration/e2e；每个变异先确认锚点恰好出现一次并回读落地，运行后逐字节还原且 `git diff --quiet`）：33 个全部 RED，无存活、无未应用。评审点名的 M2、M2r、M4、M4r、M7、M7b、M9、M16、M17、M17b 按评审原定义，其余 M 编号按本 PR 的规则重建。M2r 与 M4r 只红在「只读凭据」与「省略可选方法」两种形态的过滤用例（各 1286 / 3，含矩阵）；M7 / M7b 红在 `headBranch 过滤必须字节精确`；M9 红在 `按 sha 过滤不得带出以该 sha 直接创建的 detached 变更请求`；M5（先分页再过滤）红在 `先过滤后分页时每一页都必须有命中项`；M17 / M17b 分别只红在降序 / 升序那一轮（各 1288 / 1）。N1–N12 覆盖新规则：未知枚举原样透传或默认 approved、sha head 的三种错误拒绝（留副作用 / retryable true / not_found）、只读形态 list 面压成 unknown 与只读形态的 case-fold / trim；把套件回退到旧的严格规则（sha 必须建成、新建必须 unknown、scope A / B 绝对集合）时，分别由 `good-branch-head-only` 与 `good-shared-provider` 在矩阵里变红。规模用 `node scripts/rule-checks.mjs size origin/main` 回读（期望：满足 `Global Constraints` 的规模上限；观察时刻 2026-10-08 16:50 +08:00 代码为 374）。

2026-10-08 复评修订（同一检出；base `origin/main` @ ebe6dc40）：复评 5 × P3 全部修复，处置见 `Decision Log`「评审复核」各条。验证（观察时刻 2026-10-08 17:54 +08:00 @ 860fbd0a，代码树与最终提交相同，命令同上一段）：窄集 164 pass / 0 fail；全量 contract/integration/e2e 1289 / 0；`tests/mvp0` 7 / 0；`pnpm run typecheck` exit 0；`pnpm run boundaries` 8 / 0；TAP 运行 82 / 0；文档三项 15 / 0。子集矩阵：6 个合法形态零退出，45 个坏形态（新增 13 个规则坏形态）非零退出且失败消息命中预期片段。变异表（最终代码树，全量，规程同上一段）：47 个全部 RED，无存活、无未应用——上一段的 33 个（N9 的锚点随允许集合改写）加复评的 R1、R2、R2b 与 S1–S9b。R1 红在 `新建变更请求在创建时还没有任何审核`；R2 / R2b 红在 `headBranch 过滤必须字节精确："prepared/hel"`；S1–S9b（逐条删掉或放宽套件里的新断言）各 1288 / 1，只红在子集矩阵，分别由 `fresh-reports-approved`、`fresh-reports-changes-requested`、`sha-reject-not-found`、`sha-reject-side-effect`、`readonly-filter-casefold`、`readonly-review-squashed`、`sha-create-infers-branch`、`empty-branch-wrong-code`、`missing-prepared-change-request-field`、`filter-prefix`、`filter-suffix` 零退出触发。规模用 `node scripts/rule-checks.mjs size origin/main` 回读（期望：满足 `Global Constraints` 的规模上限；观察时刻 2026-10-08 17:54 +08:00 代码为 477）。

本次无实施技术债。未交付的 GitHub/lineage/Review API 是明确范围边界，不伪装成已完成；出现真实实施延期时更新本计划并登记 `docs/exec-plan/tech-debt-tracker.md`，当前不改 tracker。

独立验收裁决：验收表九项逐条满足；未发现会改变结果的净收益重构，因此保留产品与共享 suite 的现状，避免扩大与 PR#288 的冲突面。

## Bottom Change Note

2026-10-07 23:05 +08:00：据三份方案与主线证据建立计划；订正候选的 review 默认值和 key 声明，固定 SHA/branch/观察载体边界及先过滤后分页的判别验收。

2026-10-07：C1 实施完成并按计划回填 Progress / Surprises & Discoveries / Decision Log / Outcomes & Retrospective；设计、允许集合与验收标准均未变，故不改 `Design / Spec` 与 `Plan of Work`。

2026-10-08：按独立对抗验证的 P1-A/P1-B/P1-C/P2/P3 修订测试与文档：过滤用例不再依赖 `createBranch`；新增「改变 scope 从 `cursor: undefined` 重新读取」用例；`review.read` 断言前移到早退之前；观察用例精简为判别性内核；头部状态、`Global Constraints` 与 README 索引同步为「C1 已实施」，旧 Decision 就地追加 `Superseded by`。

2026-10-08 01:48 +08:00：独立 owner 完成验收与对抗抽查；记录十组命令的真实计数、四个 RED 变异、无可做重构裁决，并同步 README 状态。证据均为仓库内相对路径与可复现命令；文档目标文件未发现本机绝对路径。

2026-10-08 16:50 +08:00：按第一轮评审（8fd546bd）的 2 × P2 / 6 × P3 修订：过滤与事实用例按 read 键在 create 门之前判定，新增可选 `expect.preparedChangeRequest`；sha 作 head 改为可选形态、新建只禁止 approved；scope A / B 改相对比较；补字节精确与按事实过滤断言；fake 投影 union 之外的枚举为 unknown；观察用例跑两种顺序；port 补观察规则注释。`Design / Spec`、`Global Constraints`（允许集新增 `tests/fixtures/development-suite-adapters.mjs`）、`Plan of Work`、`Validation and Acceptance` 与 `Outcomes & Retrospective` 的受影响陈述就地标注 Superseded 或补注；P0 按回读勾选；新增 `Progress`、`Surprises & Discoveries`、`Decision Log` 条目与接手决策。

2026-10-08 17:54 +08:00：按复评（f7cbd2f8）的 5 × P3 修订：只读形态必需 `expect.preparedChangeRequest`；新建只允许 unknown / review_required；字节精确变体补真前缀与后缀；新增 13 个规则坏形态并钉进主用例的必需清单；第一轮 Outcomes 的规模上限改为引用 `Global Constraints`。验收表「按真实 branch、同仓库过滤」与「审核未提供仍 unknown」两行按实际约束改写并新增「新规则不被放宽」一行；当天写下的「只禁止 approved」「字段可选」两处结论就地标注 Superseded。
