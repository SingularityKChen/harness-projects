# Gate E1 裁决与 v1 冻结建议

> 状态：草稿（证据与结论；最终采纳由人类伙伴确认，见 §9）
> 日期：2026-09-21
> 批次：E1-4（issue #25）；本 PR 的 base 是 `main`（下层三层 E1-1 / E1-2 / E1-3 已变基进 `main`，栈内原 base `test/e1-write-and-events` 已不存在）
> 判定对象：issue #4 的六条验收行为，以及建立在这些行为上的本地数据模型 v1（表与约束）
> 上游证据：`docs/architecture/gate-e1-content-identities.md`（E1-1 / #22）、`docs/architecture/gate-e1-membership-and-draft.md`（E1-2 / #23）、`docs/architecture/gate-e1-write-and-events.md`（E1-3 / #24）；沙箱定义与九字段记录模板见 `docs/architecture/gate-e1-sandbox.md`
> 本文件自包含：所有引用都是仓库内路径与实验编号，不引用任何不随仓库分发的外部输入（`AGENTS.md` §3）。

## 1. 这份裁决是什么、不是什么

**是什么**：对 issue #4 六条行为的逐条判定，以及由六条汇成的单一取值结论；`revise` 时给出落到表或约束上的修改清单。

**不是什么**：

1. 不是一次新的实验。本裁决只读三份记录，不重跑任何观测（ExecPlan D4）；引用不到的实验一律判为 `inconclusive`。
2. 不是对下层记录文件的修改。发现记录之间矛盾或不足时，本裁决引用两处原文指出，证据保持原样（ExecPlan D6）。
3. 不是"通过"。`docs/architecture/release-gates.md` §1 规定 R1 不得由 LLM 判定；`docs/architecture/release-gates.md` §2 第 1 行把 Gate E1 的判定者列为人类伙伴。本裁决是**证据与草稿**。该行同时错误归因于 `AGENTS.md` §1.2，源文件缺陷登记在 §6.5。
4. 不是对 `packages/domain`（PR #81）与 `packages/capabilities`（PR #84）已冻结语义的重写。裁决决定的是本地**数据模型 v1**（表与约束）能否冻结。

**证据的读取方式**：三份记录都按 `docs/architecture/gate-e1-sandbox.md` §6 的九字段模板填写，因此本裁决引用到"实验编号 + 字段编号"两级。三份记录的九字段都齐全，不存在缺字段而不算证据的条目。

## 2. 六条行为逐条裁决

| # | issue #4 的验收行为 | 引用（实验编号） | 裁决 |
|---|---|---|---|
| 1 | 同一外部对象出现在两个工作区时，产生一条外部身份、两条成员关系、每个工作区一条投影 | E1-1 实验 1；E1-2 实验 1 | pass |
| 2 | 内容为 change request 的成员关系不产生第二个工作项 | E1-1 实验 3 | pass |
| 3 | draft 转成真实对象后内部工作项身份不变，旧外部身份降级为历史别名 | E1-2 实验 2 | pass |
| 4 | 同一观察处理 N 次与处理一次得到相同的实体与关系计数 | E1-3 实验 3（§4.1、§4.2）；E1-3 实验 2（§4.6） | pass |
| 5 | 乱序观察不覆盖更新的快照 | E1-3 实验 1（§4.3、§4.4）；E1-3 实验 2（§4.6） | pass |
| 6 | 结果不确定的外部创建先对账再重试，且不盲目重试 | E1-3 实验 3（§4.1、§4.2、§4.4 支持"先对账"；§8 自述"创建内容那一步响应丢失"分支未实测） | inconclusive |

### 2.1 行为 1 · 一条内容身份、两条成员关系、每工作区一条投影

**观测**：E1-2 实验 1 §4 实测同一个内容 id `I_kwDOUjWAl88AAAABST4Wtw` 对应两条 `ProjectV2Item.id`（`PVTI_lAHOAY1ahM4BkJ9rzg75k64` / `PVTI_lAHOAY1ahM4BkJ9szg75k8c`），两条成员关系的 `createdAt` 不同（`06:59:14Z` / `06:59:18Z`），内容侧 `projectItems.totalCount = 2`；对两条成员关系写入不同的 Status 值后，两条独立读回路径都返回各自写入的值（A = In Progress、B = Done），互不覆盖。E1-1 实验 1 §4 给出同一条内容身份与成员关系身份在 id 形状上的独立（`PVTI_*` 对 `I_*`），以及成员关系的时间戳与内容的时间戳是两套。

**裁决依据**：`one external identity` 由内容 id 只有一条、且 `projectItems.totalCount = 2` 支撑；`two memberships` 由两条独立 id 与独立 `createdAt` 支撑；`one local projection per workspace` 由 E1-2 实验 1 §4 的两条独立读回路径支撑（两个工作区各自持有自己的 Status 值）。E1-2 实验 1 §5 进一步给出落行计数：1 条 `ExternalIdentity` + 2 条成员关系 + 2 条 `IdentityProjection` + 2 条 `WorkspaceProjection`。

**裁决**：pass。这条行为**有观测支持**，但当前冻结的领域模型**无法承载**它的成员关系部分——缺口与修改点见 §4 的 R1。

### 2.2 行为 2 · change request 成员关系不产生第二个工作项

**观测**：E1-1 实验 3 §4 实测 `$E1_PROJECT_A` 的条目连接里 `pr-gamma` 那一条的成员关系 `type` 是 `PULL_REQUEST`、`content.__typename` 是 `PullRequest`；§5 把该 project 的 7 个条目按内容种类映射，得到内容身份 7 条（4 个 issue、2 个 draft、1 个 change request）、成员关系 7 条、**工作项 6 个**、变更请求 1 条；E1-1 实验 3 §5 写明"条目数 7 与工作项数 6 的差正好是那条 change request"。E1-3 实验 3 §4.3 独立实测 `addProjectV2ItemById` 接受 change request 的 node id `PR_kwDOUjWAl88AAAABEYNntg`，返回的是既有成员关系 `PVTI_lAHOAY1ahM4BkJ9rzg75k4g`——即 change request 的成员关系是成员关系，不因它是交付侧产物而多出一条内容身份。

**裁决依据**：工作项计数 6 与条目数 7 的差为 1，且那 1 条的内容种类是 change request；E1-1 实验 3 §5 给出的理由是"如果同时给它建一个工作项，同一个底层对象就有了两个工程身份"，对应 `AGENTS.md` §1.1 第 6 条。

**裁决**：pass。E1-1 实验 3 的未证明清单里有一条相关空白（change request 加入两个 project 时的成员关系形态未观测），但它不改变本条行为——本条判定的是"一条 change request 成员关系是否新增工作项"，该计数在 E1-1 实验 3 里有实测。

### 2.3 行为 3 · Draft→Issue 保持内部身份，旧身份降为历史别名

**观测**：E1-2 实验 2 §4 的"变了/没变"表逐项实测：成员关系 id `PVTI_lAHOAY1ahM4BkJ9rzg75lAw` 与它的 `createdAt`（`2026-09-21T06:59:28Z`）**没变**；内容 id 由 `DI_lAHOAY1ahM4BkJ9rzgLKQZ0` 变为 `I_kwDOUjWAl88AAAABSUC8og`（编号 6），`type` 由 `DRAFT_ISSUE` 变为 `ISSUE`；旧 `DI_*` id 在转换后立即返回 `NOT_FOUND`（"Could not resolve to a node with the global id of 'DI_lAHOAY1ahM4BkJ9rzgLKQZ0'."）。§5 按 `promoteDraftToIssue` 语义给出落行：`Entity` 仍是同一条 `E_convert`，旧 draft 身份保留原 `ExternalIdentityId` 与 `entityId`、`role` 降为 `historical`，新 issue 身份为 `primary`，`activePrimary` 只返回 issue 那一条。

**裁决依据**："内部工作项 id 不变"按 E1-2 实验 2 §5 的操作定义判定——转换前后解析到**同一条内容身份**，而不是外部 id 逐字节相同。该操作定义在本批次被实际使用了一次，并给出与"外部 id 相等"相反的结论（成员关系 id 没变、内容 id 变了），因此这条判定不能简化为 id 比较。

**裁决**：pass。附带一条约束（历史别名不可回查），见 §4 的 R7。

### 2.4 行为 4 · 同一观察 N 次等同一次

**观测**：E1-3 实验 3 §4.1 用完全相同的参数执行 `addProjectV2ItemById` 两次，两次返回的 `item.id`（`PVTI_lAHOAY1ahM4BkJ9rzg75lGI`）、`createdAt`（`06:59:38Z`）、`updatedAt`（`06:59:40Z`）逐字段相同；§4.2 清理临时夹具后的实测条目计数为 7，按内容过滤时 issue #4 只对应**一条**成员关系（"重复执行'加入 project'的实测计数是 1，不是 2"）。E1-3 实验 2 §4.6 给出本地侧的判据：`(platform, kind=ProjectV2Item, id)` 是稳定自然键，同一份观察被投递两次时按幂等 upsert 处理，实体与关系计数不变，且这一步不需要时间戳。

**裁决依据**：平台侧幂等有两次调用逐字段比对的原文；本地侧的幂等键有"`ProjectV2Item.id` 跨多次读取不变"的实测。**证据边界**：观测到的是 N = 2 的一个实例（E1-3 实验 3 §4.1），加上"重复读取时 id 稳定"（E1-3 实验 2 §4.6），两条合起来覆盖 N 次的一般形式；本裁决不声称做过 N > 2 的投递实验。

**裁决**：pass。

### 2.5 行为 5 · 乱序观察不覆盖更新的快照

**观测**：E1-3 实验 1 §4.3 实测同值重写四次不推进 `updatedAt`（保持 `2026-09-21T07:11:00Z`），而真实改变（`Status` 由 In Progress 改成 Todo）把它推进到 `07:11:54Z`；§4.4 实测连续四次真实值改变中第 3、4 次落在同一秒（`07:13:34Z`），"同秒内的多次真实写入无法用 `updatedAt` 区分先后"；§4.5 实测 `ProjectV2Item` 的字段全集里没有 ETag / revision / version / lock，`UpdateProjectV2ItemFieldValueInput` 也没有任何前置条件参数。E1-3 实验 2 §4.6 据此给出乱序判据的三条规则：① `updatedAt` 更大者更新；② 相等时不能判定谁新，改为"同一次对账读取的快照整体替换"，不逐字段合并；③ 丢弃 `updatedAt < committed.updatedAt` 的观察。该处源记录的正文写"两条规则"而编号列了三条，本裁决按编号列的三条计，并把这一处文/表不一致登记在 §6.6。

**裁决依据**：本条行为的可执行形式就是 E1-3 实验 2 §4.6 的三条规则，它的两个输入（`updatedAt` 的推进语义、秒级同秒碰撞）都有实测。**证据边界**：三条规则是本地策略，仓库内尚无实现，因此不存在"投递一条旧观察、观察到它被拒绝"的直接观测；本裁决按"输入有实测、规则由输入唯一确定"判为 pass，并把规则落成表与约束（§4 的 R4），使它在 #27/#28 里可被断言。

**残余风险**：E1-2 实验 1 §6 记录了一次**未复现的单次观测**——首轮写入 In Progress 后读回成 Done，此后 8 轮 15 次改变值的写入—读回全部互不覆盖。该次不一致出现在写入后 2 秒的读回，与 `docs/architecture/gate-e1-sandbox.md` §4.2 的条目连接读后写延迟同量级。它不能推翻可复现结论，也不能被当作不存在；对应的约束见 §4 的 R4。

### 2.6 行为 6 · 结果不确定的创建先对账再重试，且不盲目重试

**已观测的部分**：E1-3 实验 3 §4.1、§4.2 实测 `(project, content)` 在平台侧唯一，重复加入的计数为 1；§4.3 实测 `contentId` 的接受范围（issue / change request 的 node id 通过、draft 报 `VALIDATION`、不存在的 id 报 `NOT_FOUND`）；§4.4 实测 `contentId` 是稳定可重查的自然键，而 issue 标题**不是**（宽泛关键词命中 5 条，且标题可变）。§7 据此给出恢复路径：写前持久化 `contentId` 与 `(project, contentId)`；响应丢失时先重读 project 条目集合按 `contentId` 找既有成员关系；找到就采纳、不发第二次写入；找不到才重试 `addProjectV2ItemById`。

**未观测的部分**：E1-3 实验 3 §8 的限定原文——"**'创建内容那一步响应丢失'这一分支没有实测**，本批次只观测了'加入既有内容'这一步的幂等性。因此 §7 里第 5 条恢复路径是基于'标题不是可靠自然键'这一实测结论推导出来的，不是直接观测到的平台行为。" §7 也写明"结果不确定"只在**创建 `contentId` 本身的那一步**（`createIssue` / `addProjectV2DraftIssue`）响应丢失时出现，并自述"这一条**本批次没有实测**"。

**裁决依据**：本条行为的后半句"never blindly retries"在记录里唯一的落点就是 §7 第 5 条（没有自然键时进入产品可见的"结果不确定"、不允许静默重试），而该分支被记录自己声明为未实测。前半句"reconciles before any retry"有实测支持，后半句没有。按 ExecPlan D1，引用不到实验的裁决判为 `inconclusive`——这里不是"完全没有引用"，而是"决定性的一半没有观测"，两种情形在结论上同归 `revise`。

**裁决**：inconclusive，计入 `revise`（§4 的 R8）。

## 3. 汇总结论

**汇总结论：`revise`。**

这个取值只有 `freeze` 与 `revise` 两个候选，本裁决取 `revise`，无修饰、无条件：

1. 六条行为中五条有观测支持（行为 1–5 判 pass），行为 6 判 `inconclusive`；按 ExecPlan D1，`inconclusive` 等同于需要 `revise`——模型还没有证据，不是"没有发现问题"。
2. 行为 1 虽然判 pass，但它的成员关系部分在冻结模型里没有落点（E1-2 实验 1 §5 自述的模型缺口），且 E1-2 与 E1-3 对同一件事给出了互相矛盾的落行（§6 的矛盾 1）。
3. 因此本地数据模型 v1 **不满足冻结条件**；`revise` 的完成条件是 §4 的 R1–R8 全部落地，或按 §8 显式收窄。

**本裁决不给出冻结范围**：`freeze` 与 `revise` 是互斥取值，给出"部分冻结"等于给出第三种取值，正是 ExecPlan D2 排除的形态。

**本裁决不改动的部分**（列出这些是为了让 #27/#28 知道哪些结论可以直接用，不构成"有条件冻结"）：

- 外部身份注册表的键形状：`(binding, 对象种类, id)`，id 存平台全局 node id；这条由 E1-1 实验 3 字段 3 判定，本裁决不改。
- change request 解析为变更请求、不派生工作项：由 E1-1 实验 3 §5 判定，本裁决不改。
- Draft→Issue 的内部身份语义（旧身份 `historical`、新身份 `primary`、`entityId` 不变）：由 E1-2 实验 2 §5 判定，与 `packages/domain/src/identity.ts` 的 `promoteDraftToIssue` 一致，本裁决不改。
- 规划状态属于工作区投影、字段值挂成员关系：由 E1-1 实验 1 §7 与 E1-2 实验 1 §4 判定，本裁决不改。

## 4. revise 清单：受影响的表与约束

修改清单中没有任何一条以 provider 为条件：每一条都落在表名、键或约束上。需要 provider 特例才能成立的模型按 issue #4 的 Scope 判为模型错，因此不进入本清单。

| 修改点 | 表 / 约束 | 改什么 | 为什么（引用） |
|---|---|---|---|
| R1 | 新增表 `project_item_membership`；`external_identity` 的键形状不变 | 新增 `project_item_membership(workspace_id, project_external_id, item_external_id, content_external_kind, content_external_id, membership_created_at, membership_updated_at)`；`UNIQUE(workspace_id, project_external_id, item_external_id)` 与 `UNIQUE(workspace_id, project_external_id, content_external_kind, content_external_id)`；**不**把 `ProjectV2Item` 加进 `ExternalIdentityKind` | 成员关系是工作区作用域的：E1-2 实验 1 §4 实测两条成员关系的 Status 值互不覆盖。`external_identity` 的键故意不含工作区：E1-1 实验 1 §7 与 `packages/domain/src/identity.ts` 的 `externalObjectKey`。把成员关系登记成 `external_identity` 行要求给该表加 `workspace_id`，同一内容对象就会在两个工作区产生两条内容身份，与行为 1 冲突（E1-2 实验 1 §5 末段已给出同一结论）。第二条唯一约束来自 E1-3 实验 3 §4.2 的实测"`(project, content)` 在平台侧是唯一的" |
| R2 | `planning_field_value` 的键与唯一约束 | 键 `(workspace_id, item_external_id, project_field_id)`；`UNIQUE(workspace_id, item_external_id, project_field_id)`；定位字段值**不得**使用可选值 id | E1-2 实验 1 §7 实测两个 project 的 Status 字段 id 不同（`PVTSSF_lAHOAY1ahM4BkJ9rzhi7jWY` / `PVTSSF_lAHOAY1ahM4BkJ9szhi7jXQ`）而可选值 id 完全相同（`f75ad846` / `47fc9ee4` / `98236657`），因此 `(option_id)` 不能定位字段值 |
| R3 | `planning_field_value` 的列集合与写入约束 | 不设 `revision` / `etag` / `version` 列；写入路径不得依赖 compare-and-set；权威值必须由一次独立读回支撑（读回写入 `sync_observation` 行） | E1-3 实验 1 §4.5 实测 `ProjectV2Item` 字段全集无 ETag / revision / version / lock，mutation 输入无前置条件参数；§4.2 实测 mutation 回显的 `fieldValues` connection 会丢值（`Status` / `E1 Date` / `E1 Iteration` 三个节点只回 `__typename`）；§4.3、§4.4 实测 `updatedAt` 秒级、同值不推进、同秒碰撞 |
| R4 | `sync_observation` 表与乱序约束 | 键 `(item_external_id, observed_at)`，`observed_at` 是本地接收时刻；约束：① `updated_at` 更大者更新；② `updated_at == committed.updated_at` 时以整快照替换，不逐字段合并；③ `updated_at < committed.updated_at` 的观察被拒绝；投影只在读回成功后提交 | E1-3 实验 2 §4.6 的三条规则（该处正文写"两条"、编号列三条，见 §6.6），其输入由 E1-3 实验 1 §4.3、§4.4 实测；"投影只在读回成功后提交"另有 E1-2 实验 1 §6 的单次未复现读回不一致作为残余风险依据 |
| R5 | `reconcile_cursor` 表 | 键 `UNIQUE(workspace_id)`；游标语义为"上次全量对账时刻"，**不得**存 `updated_at` 作为增量游标；对账按对象全量比对 | E1-3 实验 2 §4.1 实测 `projects_v2_item` 在仓库 webhook 上被 `422` 拒绝；§4.3 实测 user-owned project 没有可用 webhook 作用域；§4.6 实测 `updatedAt` 秒级 + 同秒碰撞 + 同值不推进，无法作为增量游标 |
| R6 | `webhook_subscription` 表 | 该表不得成为 `planning_field_value` 或 `project_item_membership` 的唯一更新来源；事件缺失时同步必须收敛 | E1-3 实验 2 §4.1、§4.3 的实测拒绝与 `404`；§4.4 实测 legacy `project*` 事件名被接受但属于 classic Projects，不构成 Project v2 事件可用的证据 |
| R7 | `external_identity` 的 `role` 约束 | 只有 `role = primary` 的 `external_id` 可作为平台查询参数或同步游标；`role = historical` 的行仅本地可读 | E1-2 实验 2 §4 实测旧 `DI_*` id 在转换后立即返回 `NOT_FOUND`，平台上不存在"旧 id 仍可解析"的过渡窗口；§5 的历史别名表最后一行写明"历史别名解决的是'这个新内容 id 该接到哪条内部记录上'，不是'旧 id 还能被平台查到'" |
| R8 | `pending_external_write` 表（补证据项） | 键 `idempotency_key = content_id`；存在未决行时不得发起第二次外部写。**补证据前不得冻结该表的状态机取值集合** | 已实测：E1-3 实验 3 §4.1、§4.2 的幂等计数 1；§4.4 的 `contentId` 自然键与"标题不是自然键"。未实测：E1-3 实验 3 §8 自述"创建内容那一步响应丢失"分支没有实测。行为 6 因此判 `inconclusive` |

**R1 的连带影响**：`planning_field_value`（R2、R3）、`sync_observation`（R4）、条目顺序表（E1-3 实验 1 §5 的 `item_position`）三处指向成员关系的外键都落在 `project_item_membership.item_external_id` 上，而不是落在 `external_identity` 上。

## 5. 被观测推翻的假设

下列假设在观测前被当作成立，被实测推翻；每条给出记录与位置。这一节是 #27/#28 的实现方最容易按旧假设写错的地方。

| # | 被推翻的假设 | 实测 | 引用 |
|---|---|---|---|
| 1 | mutation 响应回显完整，可当作写入确认来源 | 同一条 mutation 的回显里 `Status` / `E1 Date` / `E1 Iteration` 三个节点只回了 `__typename`，值字段为空；同一秒的另一次调用返回全量值 | E1-3 实验 1 §4.2 |
| 2 | `updatedAt` 是修订计数器，可用于定序或增量拉取 | 同值重写四次不推进 `updatedAt`；连续四次真实改变中两次落在同一秒，`updatedAt` 相同 | E1-3 实验 1 §4.3、§4.4 |
| 3 | 写请求报错即未生效 | `updateProjectV2ItemPosition` 不给分页参数时 payload 整体为 null（`MISSING_PAGINATION_BOUNDARIES`），而顺序确实已经改变 | E1-3 实验 1 §4.6 |
| 4 | 任何 project item 内容都能挂接 | `addProjectV2ItemById` 拒绝 draft：`contentID must refer to an Issue or a Pull Request.` | E1-3 实验 3 §4.3 |
| 5 | 条目字段值只由用户写入决定 | draft 条目实测 2 个 `fieldValues`，issue / change request 条目 3 个，差额来自调用方无法写入的 `ProjectV2ItemFieldRepositoryValue` | E1-1 实验 2 §6 第 1 条 |
| 6 | 同一对象在同一平台的 REST 面上只有一个数字 id | `pulls/5.id = 4588791734` 与 `issues/5.id = 5523780322` 互不相等，而两者的 `node_id` 与 GraphQL `PullRequest.id` 逐字相同 | E1-1 实验 3 §6 第 1 条 |
| 7 | 两个 API 面对"编号 5 是否存在"给出同一答案 | REST `issues/5` 返回对象，GraphQL `repository.issue(number: 5)` 返回 `null` 并报 `NOT_FOUND` | E1-1 实验 3 §6 第 2 条 |
| 8 | 平台不返回的字段是 `null` | draft 的 `repository` 与 `number` 在类型上不存在（`undefinedField`，exit 1），introspection 的字段全集里也没有它们 | E1-1 实验 2 §4 |
| 9 | draft 转换会更换成员关系身份 | 成员关系 id 与 `createdAt` 都没变，只有 `updatedAt` 与 `type` 变；变的是内容 id | E1-2 实验 2 §6 第 1 条 |
| 10 | 转换后旧 id 仍有一段可解析的过渡窗口 | 旧 `DI_*` 在转换后立即 `NOT_FOUND`，没有过渡窗口 | E1-2 实验 2 §6 第 2 条 |
| 11 | 项目条目事件可以订阅，事件可作为同步驱动 | `projects_v2_item` 在仓库 webhook 上被 `422` 拒绝（`These events are not allowed for this hook: projects_v2_item`）；user-owned project 的 org / user / project 三种作用域分别返回 `404` | E1-3 实验 2 §4.1、§4.3 |
| 12 | 写入或删除后紧随其后的计数可信 | 删除后 `items.totalCount` 一度仍返回 9，而同一 connection 的 `nodes` 已是 7；`gh project item-add` 成功后紧随的查询少看到一条，约 3 秒后才补齐 | E1-3 实验 3 §6 第 3 条；`docs/architecture/gate-e1-sandbox.md` §4.2 |
| 13 | 两个工作区的字段值在任何时刻都互不覆盖 | 首轮写入后读回出现一次 A = Done（写入值为 In Progress）；此后 8 轮 15 次改变值的写入—读回全部互不覆盖，该形态未再复现 | E1-2 实验 1 §6 |
| 14 | 标题可作为创建操作的自然键 | 宽泛关键词 `fixture` 命中 5 条（`total_count = 5`），且标题是可编辑属性 | E1-3 实验 3 §4.4 |

## 6. 记录之间的矛盾与不足

本裁决不修改下层记录；下列问题引用两处原文并列，交给栈级联步骤或人类伙伴决定如何处理。

### 6.1 成员关系落点：E1-2 与 E1-3 给出互相矛盾的落行

E1-2 实验 1 §5 末段原文：

> **成员关系这一行的落点是本实验暴露的模型缺口**：`ExternalIdentityKind` 目前只有 `draft` / `issue` / `change_request` / `branch` / `worktree` 五个取值，**没有**给 `ProjectV2Item` 留位置。……**不能**写成两行 `ExternalIdentity`——那会让同一个内容对象拥有两份身份，直接违反 issue #4 第 1 条。

E1-3 实验 1 §5 与实验 3 §5 的"本地应有行"表原文：

> | `external_identity` | (platform, kind=`ProjectV2Item`, id=`PVTI_...75k-I`) | 1 | 成员关系身份是写路径的目标对象，`updatedAt` 附属于它 |

> | `external_identity` | (platform, kind=`ProjectV2Item`, id=`PVTI_...75lGI`) | 1 | 成员关系身份；重试返回同一个，不新增行 |

同一份 E1-3 实验 3 §5 里又出现第三种写法：

> | `project_item_membership` | (workspace=A, content=`I_...X6Q`) | **1** | 平台保证 `(project, content)` 唯一，实测计数为 1 |

三处不能同时成立：E1-2 说成员关系不能进 `external_identity`，E1-3 实验 1 与实验 3 的 `external_identity` 行说它进，E1-3 实验 3 又给了一张以 `(workspace, content)` 为键的成员关系表。本裁决按 §4 的 R1 定在 E1-2 的立场上（独立表、键含工作区），理由是 E1-2 的立场有"工作区作用域"这一条实测依据（E1-2 实验 1 §4 的两条互不覆盖的 Status），而 E1-3 的两行没有给出与 `ExternalIdentityKind` 的兼容说明。

### 6.2 沙箱定义 §4.1(a) 的快照已过期，§4.1(b) 的重建判据未过期

`docs/architecture/gate-e1-sandbox.md` §4.1**(a)**（小节标题即"当前状态回读（快照，不是重建判据）"）把 `draft-convert` 那一行写成：

> DRAFT_ISSUE   PVTI_lAHOAY1ahM4BkJ9rzg75lAw  DraftIssue       DI_lAHOAY1ahM4BkJ9rzgLKQZ0

E1-2 实验 2 §4 转换后的独立读回是：

> {"item":{"contentCreatedAt":"2026-09-21T07:18:01Z","contentId":"I_kwDOUjWAl88AAAABSUC8og","contentTypename":"Issue",……"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw",……"type":"ISSUE",……}}

E1-2 实验 2 §6 末段已经指出这一点（"**那一行的期望值已过期**"），并说明该批次受 Global Constraints 限制不能修改沙箱定义。本裁决确认该行已过期，但**订正它的位置与性质**：该行在 §4.1(a)，而这一节按定义是"某一次观测时刻的沙箱原文"，本来就不承担判据职能，因此"过期"只意味着"不再描述当前状态"，不构成判据失效。真正的重建等价判据是 §4.1(b)：它只写形状、不含任何 node id 字面量，并且已经显式覆盖转换前后两种状态——"`draft-convert` 在重建后是 `DRAFT_ISSUE`，转换后是 `ISSUE`，两种状态都必须满足下面的期望输出"。**§4.1(b) 未过期，不需要修改**；需要更新的是 §4.1(a) 的快照本身，属沙箱定义的维护，不在本批次范围内。条目数 7 与"三种 `type` 齐全"仍然成立（`DRAFT_ISSUE` 由 draft-beta 提供）。

### 6.3 E1-3 实验 3 §4.2 的读回与 E1-2 实验 2 的转换结果不一致，且该次读回没有时间戳

E1-3 实验 3 §4.2 清理临时夹具后的读回原文（该表声称"Project A 回到 7 条"）：

> {"id":"PVTI_lAHOAY1ahM4BkJ9rzg75lAw","isArchived":false,"content":{"__typename":"DraftIssue"}}

E1-2 实验 2 §4 把同一条成员关系（`PVTI_lAHOAY1ahM4BkJ9rzg75lAw`）在 `2026-09-21T07:18:02Z` 转换成 `ISSUE`，内容 id 为 `I_kwDOUjWAl88AAAABSUC8og`（编号 6）。两处对同一个 `item id` 给出不同的内容种类。

E1-3 实验 3 §4.2 没有给出这次读回的墙钟时间，E1-2 实验 2 的转换时间有（`07:18:02Z`），E1-3 实验 1 与实验 2 的时间戳集中在 `07:10Z`–`07:13Z`。因此无法从记录本身判定这是"转换之前的读回"还是与 E1-2 冲突的读回——这是记录**不足**，不是可判定的矛盾。影响：按 E1-3 实验 3 §9 复现时，§4.2 那条读回会显示 `content.__typename = Issue`（编号 6）而不是 `DraftIssue`，§9 第 3 步的条目列表也会多出一个 issue 编号；复现者若不读本条会把差异当成失败。

### 6.4 成员关系键的三种写法并存

- E1-1 实验 1 §5：`(project=PVT_kwHOAY1ahM4BkJ9r, item=PVTI_lAHOAY1ahM4BkJ9rzg75k2w)`；
- E1-2 实验 1 §5：`(workspaceId, itemExternalId)`；
- E1-3 实验 1 §5：`(workspace=A, item=PVTI_...75k-I)`。

三种写法都能唯一标识一条成员关系，但只有 E1-2 的写法含工作区。本裁决按 R1 统一为 `(workspace_id, project_external_id, item_external_id)`，并保留 project 分量：成员关系是从 project 的条目连接里发现的，project 分量是对账时的查询作用域。

### 6.5 源文件错误归因：`release-gates.md` §2 第 1 行

`docs/architecture/release-gates.md` §2 第 1 行把“谁判定 = 人类伙伴”同时归因于 `AGENTS.md` §1.2；但 `AGENTS.md` §1.2 只有 Gate E1 的门禁描述，没有“判定者是人类伙伴”这句话。该归因不影响本裁决的证据：正确落点是 `docs/architecture/release-gates.md` §2 第 1 行本身。本批次不修改该源文件（不在 Global Constraints 内），仅登记缺陷供后续文档修订。

### 6.6 E1-3 实验 2 §4.6 的文/表不一致：正文写「两条规则」，编号列了三条

`docs/architecture/gate-e1-write-and-events.md` §4.6 的乱序判据原文：

> **乱序观察**的判据：`updatedAt` **不足以**定序。必须叠加本地接收时刻（`sync_observation.observed_at`）作为 tie-breaker，并遵循两条规则：
>
> 1. `updatedAt` 更大者更新；相等时**不能**判定谁新。
> 2. `updatedAt` 相等时，用"同一次对账读取的快照"整体替换，而不是逐字段合并……
> 3. 丢弃"比本地已提交观察更旧的 `updatedAt`"的观察（`updatedAt < committed.updatedAt` 时拒绝）……

正文的"两条"与紧随其后的编号列（三条）对不上。本裁决按**编号列的三条**计——§2.5 与 §4 的 R4 都按三条写——理由是编号列才是可逐条断言的形式，而"两条"只是叙述；两者的差别只在第 1 条（`updatedAt` 更大者更新）算不算一条独立规则。本批次不修改下层记录（D6），因此这一处不一致只登记、不就地改正；#27/#28 按 §4 的 R4 断言时以三条为准。

## 7. 提升为 ADR 的结论

按 ExecPlan D5，只提升被观测支持且推翻代价高的结论。四条已写入 `docs/adr/`，并在 `docs/adr/README.md` 的索引表登记；状态均为 `Proposed`，因为 Gate E1 的采纳权在人类伙伴（§9）。

| ADR | 决策 | 依据 |
|---|---|---|
| `docs/adr/ADR-0001-external-identity-key-shape.md` | 外部身份注册表的键是「平台绑定 + 对象种类 + 平台全局 node id」，REST 数字 id 不参与键 | E1-1 实验 3 字段 3、字段 6 第 1 条 |
| `docs/adr/ADR-0002-membership-identity-separate-from-content.md` | 成员关系身份与内容身份分离，成员关系落在独立的工作区作用域表 | E1-1 实验 1、E1-2 实验 1 |
| `docs/adr/ADR-0003-events-are-not-the-correctness-mechanism.md` | 事件不是正确性机制，对账是；事件缺失时同步必须收敛 | E1-3 实验 2 §4.1、§4.3、§4.6 |
| `docs/adr/ADR-0004-unknown-external-create-is-product-visible.md` | 结果不确定的外部创建先对账再重试；没有自然键时进入产品可见的"结果不确定"，不得静默重试 | E1-3 实验 3 §4.1、§4.2、§4.4、§8 |

## 8. 未覆盖与残余风险

1. **行为 6 的补证据项**：E1-3 实验 3 §8 自述的"创建内容那一步响应丢失"分支没有实测。补证据属于下层批次的修订，不混进本裁决（ExecPlan D4）；R8 在它落地前不得冻结 `pending_external_write` 的状态机取值集合。
2. **`REDACTED` 条目类型**：`docs/architecture/gate-e1-sandbox.md` §8 记录该枚举取值存在但没有夹具被删除，触发条件与 `content` 形状未观测。成员关系被移除或归档时的身份行为同样未观测（E1-2 §5 的"未覆盖"）。
3. **change request 的多 project 成员关系形态**：E1-1 实验 3 的未证明清单列出该空白；E1-1 只观测了 issue 的多 project 形态。
4. **E1-2 实验 1 §6 的单次未复现读回不一致**：作为残余风险保留，对应 R4 的"投影只在读回成功后提交"。
5. **N > 2 的重复投递**：行为 4 的实测是 N = 2 加上稳定自然键（§2.4 的证据边界）。
6. **分页边界**：三份记录的所有查询都在单页内返回（条目数 ≤ 7），跨页时的 id 与时间戳行为未观测（E1-1 实验 3 字段 3）。
7. **可选值 id 跨 project 相同的原因**：E1-2 实验 1 §7 明确"本批次没有做跨项目对照实验，不作断言"，本裁决同样不作断言。

## 9. 最终采纳

本裁决是**证据与草稿**，不是"通过"。

- `docs/architecture/release-gates.md` §1：R1 是合取门禁，"无法判定"等同于不满足，且 **R1 本身不得由 LLM 判定**；agent 只能提供证据与草稿。
- `AGENTS.md` §1.2：Gate E1（跨 Provider 对象身份与同步幂等性）通过前不冻结本地数据模型 v1。
- `docs/architecture/release-gates.md` §2 第 1 行：该门禁的判定者是**人类伙伴**。该行把这一条同时归因于 `AGENTS.md` §1.2，是源文件的错误归因（§6.5）；正确落点就是该行本身，本裁决不引用那次归因。

因此：`revise` 这个取值的最终采纳、§4 修改清单的取舍、以及是否关闭 issue #4，由人类伙伴确认。在人类伙伴确认之前，本地数据模型 v1 保持未冻结，`packages/storage/sqlite` 的身份与成员表（#27）、执行与关系表（#28）以本裁决的 R1–R8 作为设计输入而不是冻结依据。
