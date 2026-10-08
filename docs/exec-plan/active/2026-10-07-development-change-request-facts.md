# Development 变更请求读取事实 ExecPlan

> 状态：Active；设计与计划已收敛，产品批次未实施。
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

create 输入的 head 能精确解析为本仓库分支时，记录该分支名；直接 SHA 输入无法确定分支身份时 headBranch 为 undefined。即使已有多个分支指向相同 SHA，也不反推分支。保留现 SHA 创建语义，不为字段增强收窄已有接口。

list 依次限定 repository 身份、按 headBranch 字节精确相等过滤、按既有 externalId 稳定排序、分页。undefined 表示不筛选；空字符串返回结构化 `invalid_input`，不 trim 或 case-fold。未知但非空分支返回成功空页且 nextCursor undefined。

本 fake 的游标继续沿已有 `paginate` 协议；端口明确游标只可在同一 repository、headBranch、limit scope 下重用。调用方改变 scope 必须从 cursor undefined 重新开始。本切片不新增持久 cursor 协议，不声称 provider 会识别所有跨 scope 误用。

新增字段恒有（headBranch 的值可 undefined），create/get/list 相同字段组；read-only CR provider 仍用自己的读 key。未实现 CR 的 Local Git 保持结构化 not_supported，不为了套件补 PR 功能。

Development port 的观察注释明确引用已有 canonical 规则；不改 `makeObservation`、Storage 排序或 sourceVersion 比较函数。同一个观察主体不混用有版本/无版本，raw 时间戳须由 provider 用 `sourceVersionFromTimestamp` 无损归一。

拒绝任意字符串 reviewState 的方案：调用方无法区分可靠审核结论与未知平台枚举。拒绝 fake 默认 review_required 与声明 ReviewRead：没有源事实和独立方法支撑。拒绝新增 review API：扩大读取时刻、权限和方法生命周期而无当前验收收益。

## Global Constraints

唯一允许改动集如下；当前发布只含计划与索引，其余属于未来 C1。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/active/2026-10-07-development-change-request-facts.md`、`docs/README.md` | spec + plan 与索引 |
| 产品 | `packages/capabilities/src/development-provider.ts` | 类型、filter 与版本义务 |
| 产品 | `packages/providers/fake/src/development.ts` | 真实分支与审核字段投影 |
| 测试 | `tests/contract/suites/development.js`、`tests/contract/development-contract.test.js` | create/get/list 与分支过滤判别 |
| 测试 | `tests/contract/capabilities-observation.test.js` | Development subject 的既有定序护栏 |

新增类型沿 capabilities 既有 barrel 导出，不加 port 方法，registry 的 keyof 方法锁无需变化。不改 GitHub Development、core 谱系、Storage 或观察源协议；#231/#233 不进入本闭环。pre-MMP 直接修改实验类型，不加兼容层。

Node `>=22`、pnpm `10.28.2`；不新增依赖。代码、测试与夹具增删合计不超过 800，文档增删合计不超过 1300。估计产品 35–70、suite 25–45、判别测试 130–210，合计 190–325；文档约 200–270。实际提交前重新计数。

#279 与 #205 都触及 Development suite，未来由单 owner 串行整合并重跑相关验证；共享文件不形成业务 blocked-by，四个 PR 仍独立验收和整体回滚。本轮不写人类 `Status` 与阻塞关系，不实施产品、ready 或 merge。

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

1. 先执行 `pnpm install --frozen-lockfile`，期望 exit 0。写具名 `change-request-head-branch-and-review-facts`：同一实例创建分支 CR 和直接 SHA CR，get/list/create 新字段精确一致；SHA CR 的 headBranch 必须 undefined，review 默认 unknown。
2. 写 `change-request-filter-before-pagination`：两个不同 branch 同 SHA，加不同 SHA/branch 诱饵；每个目标分支至少两个 CR，limit 1 真跨页、无重复无遗漏。再加同 binding 的另一个仓库同名 branch，证明 repository 隔离；未知 branch 空页、空串 invalid_input。
3. 写 `change-request-review-states-are-not-guessed`，显式 fixture 覆盖四种状态，至少 approved 与 changes_requested 含非 unknown 正控。共享 suite 通过 adapter 的预置事实或已有创建结果断言，不访问 fake.state；fake 专属 discriminator 可以直接构造记录。
4. 运行第一条契约命令，预期新字段/过滤断言在旧代码 RED；记录具体断言。扩展类型与 fake 记录、toChangeRequest、filter，保持原 create SHA 路径；重跑 GREEN。suite 中已声明读/写按各自 key，Local Git 不被迫提供 CR。
5. 在 Development subject 上补 `development-observation-version-remains-canonical`：makeObservation 拒绝 SHA/v9/v10；两个词法顺序相反的 SHA 仍只被 CR 身份相等读回；canonical 时间戳旧<新，乱序后到旧观察不能顶替新观察。沿现 fake Storage 入口验证已有定序，不修改生产排序。
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
| create/get/list 事实相同 | 新字段完整 deepStrictEqual；默认 unknown |
| 不以 SHA 猜分支 | 两 branch 同 SHA 与 detached SHA 正反控 |
| 按真实 branch、同仓库过滤 | 同名跨仓诱饵，limit 1 先过滤后分页 |
| 分页完整且 scope 明确 | 同 scope 不重不漏、nextCursor 结束；改变 scope 从头读取 |
| 审核未提供仍 unknown | 四枚举 exact equality；至少两种非 unknown 正控 |
| 不声明虚构 ReviewRead | snapshot key 集合比较；port 方法锁与 typecheck |
| SHA 不进入观察定序 | Development subject 拒绝测试、canonical 乱序护栏 |
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
- [ ] (2026-10-07) P0 文档验证、draft 发布与双向 issue 回读。
- [ ] (2026-10-07) C1 新字段与过滤 RED → GREEN、版本护栏和真实子集验收。
- [ ] (2026-10-07) 最终产品审评、证据与完成归档。

## Surprises & Discoveries

观察 sourceVersion 的主线规则已经比 issue 的最低文字要求严格：30 字节 canonical 时间戳或 undefined，SHA 只可留在 CR sourceVersion。证据为 `observation.ts` 的字段区分与 `makeObservation` 断言；不能引入 equality-only 观察模式。

fake 的 head 输入同时接受分支和 SHA，因此非空字符串不足以证明分支身份。证据为 `createChangeRequest` 的 `branchOf(...).headCommit ?? input.head`；toChangeRequest 必须保存解析结果，不能透出 input.head 充作分支。

ReviewRead 预留 key 没有方法，字段增强不自动变成独立能力面。选型时否决默认 review_required 和无方法声明 key 的候选；本计划以 unknown 默认修正该假设。

## Decision Log

决策：采用四值 ProviderReviewState，fake 默认 unknown，不声明 ReviewRead。Rationale：把来源未知与来源明确要求审核分开，保持 capability/method 的真实对应。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：保留 SHA create，headBranch 未知为 undefined；filter 在分页前且游标限同 scope。Rationale：SHA 与分支是不同身份，不因展示字段扩大协议或破坏现创建语义。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：保留现观察 canonical 不变量、不改 Storage/core。Rationale：当前入口和存储已有时间序护栏，本项只解释与补 Development 判别。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：当前仅 spec + plan 与 draft 发布，未来产品 C1 未执行。Rationale：人类明确任务阶段，不重复请求设计批准；仓库规范优先于技能默认分文件模板。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权。

## Idempotence and Recovery

每个契约用例用独立 fake 实例，list 无并发写入时分页稳定。重跑不涉及外部平台。Local Git 用仓库现有临时 fixture，不能在真实用户仓库造分支/worktree。

遇到 typecheck 消费者缺口先定位真实 caller，不加临时 optional 字段或兼容 dual read。suite 与 #205 整合后重新锁 head，重跑同一契约/Local Git 命令，防止两份计划对同文件漂移。

失败保留当前差异，回到已知 C1 前状态时整体撤回产品及配对测试；无 schema 或数据清理。共享历史改写先建恢复锚点并进入专家流程，不自行 force push。

发布失败按分支查已有 draft；最终 push 后回读 head/base/checks/threads 和两侧关联，不 ready、merge 或改人类规划字段。

## Interfaces and Dependencies

新类型由 capabilities 导出；DevelopmentProvider 方法集合保持不变。list 的 headBranch 是可选精确 filter，headBranch 与 sourceVersion 分别表示分支身份和提交身份；reviewState 随 CR read 快照。

工具为锁定 Node/pnpm、Git、现有离线 fake 和 Local Git fixture。产品验收无需真实 GitHub 凭据；真实 GitHub Development、独立 ReviewRead API 和 Host 同步由它们自己的闭环负责。

## Outcomes & Retrospective

2026-10-07 23:05 +08:00 产出是独立审评后 spec + plan。产品新增字段、过滤与未来命令尚未实施/执行；P0 最终证据与 draft 关联由发布 owner 回读后补录。

本次无实施技术债。未交付的 GitHub/lineage/Review API 是明确范围边界，不伪装成已完成；出现真实实施延期时更新本计划并登记 `docs/exec-plan/tech-debt-tracker.md`，当前不改 tracker。

## Bottom Change Note

2026-10-07 23:05 +08:00：据三份方案与主线证据建立计划；订正候选的 review 默认值和 key 声明，固定 SHA/branch/观察载体边界及先过滤后分页的判别验收。
