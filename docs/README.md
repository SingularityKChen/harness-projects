# docs 文档地图

本目录保存**持久文档**：删掉之后，接手的人会缺失决策依据的内容。运行态内容（`.superpowers/`、`.worktrees/`）不进这里。

## 1. 目录职责

| 路径 | 放什么 | 不放什么 |
|---|---|---|
| `docs/exec-plan/active/` | 进行中的 ExecPlan（spec + plan 合一的活文档） | 已完成的历史计划 |
| `docs/exec-plan/completed/` | 已验收完成的 ExecPlan，按原文件名保留 | 需要继续修订的计划 |
| `docs/exec-plan/tech-debt-tracker.md` | 实施时明确接受延期的技术债及其解决/取代记录 | 未裁决的设计候选与功能路线图 |
| `docs/architecture/` | 长期有效的架构说明：模块边界、依赖方向、数据流、集成方式 | 一次性的实施计划 |
| `docs/adr/` | 不可回退的技术决策（ADR），一条决策一份文件 | 可以随时改的偏好设置 |
| `docs/product/` | 产品范围、术语表、目标形态、非目标 | 工程实现细节 |

约定来源见 `AGENTS.md` §3；计划格式见 `PLANS.md`。

## 1.1 Agent 工作流入口

开发、CI 和发布面细则在 [docs/development/workflow.md](development/workflow.md)、[docs/development/ci.md](development/ci.md)、[docs/development/repository-rules.md](development/repository-rules.md) 和 [docs/development/publication.md](development/publication.md)；一段流程知识该住在 `docs/`、`.agents/skills/` 还是脚本里，见 [docs/development/content-placement.md](development/content-placement.md)。MVP 交付评审与回复评审分别见 [docs/review/mvp-review.md](review/mvp-review.md) 和 [docs/review/responding.md](review/responding.md)；评审标准总览仍在 [docs/review/README.md](review/README.md)。

## 2. ExecPlan 索引

### Active

| 计划 | 范围 | 状态 |
|---|---|---|
| [2026-10-05-connector-account-storage](exec-plan/completed/2026-10-05-connector-account-storage.md) | #126 连接账号、宿主凭据引用与工作区配置：独立元数据写口、Fake/SQLite 同契约、身份保留及重启验收；已实施并经评审，等待合并回读（PR #270） | Completed |
| [2026-09-20-mvp0-parallel-stacks](exec-plan/completed/2026-09-20-mvp0-parallel-stacks.md) | MVP-0 并行堆叠 PR 交付的**控制计划**：栈拓扑、文件所有权、模型路由、批次顺序与合并顺序 | Completed |
| [2026-09-20-contract-plane](exec-plan/completed/2026-09-20-contract-plane.md) | 契约栈（A）：领域模型、五域能力契约、契约套件与离线替身 | Completed |
| [2026-09-20-persistence-plane](exec-plan/completed/2026-09-20-persistence-plane.md) | 持久化栈（B）：从空库可重复执行的迁移运行器 | Completed |
| [2026-09-20-mvp0-slice](exec-plan/completed/2026-09-20-mvp0-slice.md) | 切片栈（C）：core 引导、Start Work、交付谱系、controller/client 与进度断言变绿 | Completed |
| [2026-09-20-vertical-path-and-gates](exec-plan/completed/2026-09-20-vertical-path-and-gates.md) | 文档栈（D）：把纵向链路与 R1 门禁逐条重述进仓库 | Completed |
| [2026-09-21-review-session-reliability](exec-plan/completed/2026-09-21-review-session-reliability.md) | 评审会话可靠性：事件负载只从 `GITHUB_EVENT_PATH` 读、并发按 head 提交去重，两条性质由契约测试固定 | Completed |
| [2026-09-21-engineering-state-trust-boundary](exec-plan/completed/2026-09-21-engineering-state-trust-boundary.md) | PR37 工程状态信任边界：删除可伪造 artifact，signal 判定与特权 reconcile fail closed | Completed |
| [2026-09-21-gate-e1-membership-and-draft](exec-plan/completed/2026-09-21-gate-e1-membership-and-draft.md) | Gate E1 多项目成员关系与 Draft 转换：证明同一 issue 在两个 project 下是 1 条内容身份 + 2 条成员关系，且 Draft→Issue 提升只换外部内容 id、内部实体身份不变 | Completed |
| [2026-09-18-review-feedback-convergence](exec-plan/active/2026-09-18-review-feedback-convergence.md) | 评审反馈根因收敛：#12/#19/#21/#35 的 workflow 不变量、自托管威胁模型与 area 词表单源化 | Active |
| [2026-09-18-delivery-planning-and-board](exec-plan/active/2026-09-18-delivery-planning-and-board.md) | 交付规划与工作看板重整：重述原始交付 MVP、建立里程碑与迭代、拆分过大工作项、收敛看板自动化 | Batch 1–9 已完成；剩余人工项为两个 view 的分组设置（无法经 API 回读） |
| [2026-09-21-rule-checks-api-base](exec-plan/active/2026-09-21-rule-checks-api-base.md) | 判定输入改用 PR API 的对象对：判定固定到 `(base_sha, head_sha)` 两个不可变提交，含解析器失败策略与检查 job 的一致性 | Active |
| [2026-09-21-merge-gate-layers](exec-plan/active/2026-09-21-merge-gate-layers.md) | Merge Gate 车道：integration / 包边界 / MVP-0 / E2E 四层各自成为一条 lane，空层与零用例层响亮失败 | Active |
| [2026-09-22-engineering-merged-state](exec-plan/active/2026-09-22-engineering-merged-state.md) | 让合并事件真正写进 `Engineering`：修正 GraphQL 枚举误用导致的合并投影不可达，并补上按日的字段漂移观察 | Active |
| [2026-09-22-content-placement](exec-plan/completed/2026-09-22-content-placement.md) | 流程知识的四桶归属（机械 / 技法 / 约定 / 一次性）与判定规则：给 §0 路由表的每个入口一个可机械核对的桶 | Completed |
| [2026-09-22-status-field-writer](exec-plan/completed/2026-09-22-status-field-writer.md) | 给 `Status` 一个定义、一个写入口、一个防漂移的检查：语义收敛到 `board-semantics.md` 单一事实源、写入口写进交付流程、契约测试按「行 + 子句」设防 | Completed |
| [2026-09-21-gate-e1-write-and-events](exec-plan/active/2026-09-21-gate-e1-write-and-events.md) | Gate E1 写确认与事件可靠性：实测平台无 CAS、事件订不到、重复创建幂等 | Active |
| [2026-09-24-local-git-worktree](exec-plan/active/2026-09-24-local-git-worktree.md) | 本地 Git provider（#137）：仓库读、分支建、工作树建，路径安全在任何 Git 命令之前；第四轮 18 条意见按根因改完，移除与 core 层验收分别拆到 #138 / #207 | Batch 1–5 已完成；四轮评审响应已记录 |
| [2026-09-29-prelaunch-system-architecture-renewal](exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md) | epic #216 的控制计划：先把纵向路径与 R1 不变量的证据如实落账，再收敛读写权威、同步和 Client 重连，最后合并发布前 SQL、清理旧形状并重整测试与文档证据 | Batch 0（#217）已验收；纵向路径矩阵见 `docs/product/vertical-path.md` §2.1，R1 映射见 `docs/architecture/release-gates.md` §2.1.1；PR #239 状态以 GitHub 回读为准；Batch 1–7 待实施 |

### Completed

| 计划 | 结论 |
|---|---|
| [2026-10-08-sync-revision-freshness](exec-plan/completed/2026-10-08-sync-revision-freshness.md) | #220 + #199（epic #216 的 Batch 2E）：业务修订号只随已提交的规划快照内容变化推进（写后重读、键序与行序无关的深比较、整批重盖，移除也算变化，#202 残留不误判）；一轮同步的任何异常转成结构化失败（游标 degraded + `unavailable`，固定文案不转发原文，原异常只经宿主的 `diagnostics.syncRoundFailed` 出口，不进 wire；宿主接线由 #132 承接），游标缺失读作陈旧；成功提交写 `reconcile_cursor` 对账时刻，wire 与 client 不变，读侧可见的时间显示归 #229。规则见 ADR-0012（Accepted）；技术债务 TD-030–TD-034。三轮对抗验证（21 条）、MMP 评审（APPROVED，2 × P2、3 × P3）、第二轮评审（1 × P2、5 × P3）与第三轮评审（1 × P3）的修订均已完成，变异 M1–M46 在最终树上全部变红；Completed，合并状态以 PR #290 回读为准 |
| [2026-10-08-development-repository-routing](exec-plan/completed/2026-10-08-development-repository-routing.md) | #219：一个工作区可挂多个 Development 连接（Local Git 与 GitHub 各管不同的仓库，或多个本地检出），开始工作按已持久化的「仓库属于哪个连接」路由到唯一挂载，不另立路由表；歧义与缺路由在任何外部调用前结构化拒绝（`conflict`），缺能力不改道（`not_supported`）；唯一挂载仍是默认、多个时全部非默认并与 Storage 读回一致；key 级解析在多挂载时 fail closed，换连接不再把 Ready 判成 Failed。三轮对抗验证（22 条）与两轮独立评审（第一轮 APPROVE，1 × P2、4 × P3；第二轮 5 × P3）的发现已处理，conflict 文案只写今天走得通的步骤并由用例逐字执行，变异 M1–M48 在最终树上全部变红。人类伙伴裁决谱系读取的路由接线与正例改由独立小 PR（#297）承担，#292 不必等本 PR；元数据按绑定给出与「绑定仓库」恢复动作归 #127 / #142，两个 issue 已补验收框（TD-035、TD-037）；Completed |
| [2026-10-08-delivery-fact-writer](exec-plan/completed/2026-10-08-delivery-fact-writer.md) | #221（epic #216 Batch 3A）：交付事实按执行上下文存一份最后确认快照（迁移 006、ADR-0011），`refreshDeliveryFacts` 是唯一写者；只有完整读取才替换或删除，离线、权限、截断、提交失败都保留并标陈旧；查询暂时委托写者，纯读归 #222 | Completed（2026-10-09）：C1–C3 实现，C4–C8 四轮对抗验证与验收、规模收到 800，C9–C10 rebase 到含 #295 的 main，C11–C12 处理三轮 MMP 评审（变更请求按 `headBranch` 查找、页形非法记缺口）；K3 接线由 #297 单独做；ADR-0011 在本 PR 是 Proposed，由 #293 改为 Accepted |
| [2026-10-08-delivery-query-pure-read](exec-plan/completed/2026-10-08-delivery-query-pure-read.md) | #222（epic #216 Batch 3B，栈在 #221 上）：交付查询只读已提交事实，摄入只经 `commands.refreshDeliveryFacts`；投影带逐跳 stale、逐集合 freshness 与逐位置 gaps，controller 转发；缺口不落成关系 | Completed（2026-10-09）：D0–D3 实现与回填，两轮对抗验证与最终验收，随 #221 三次重新 rebase，三轮 MMP 评审（刷新退出重放账本、`confirmedAt` 改存墙钟读数、作用域类型收紧、年龄规则交 #281 / #234）；ADR-0011 在本 PR 修订后 Accepted |
| [2026-10-07-github-actions-read](exec-plan/completed/2026-10-07-github-actions-read.md) | #232：CI 事实只来自精确提交，不完整的读取就降级——base 片（#295）：Delivery 端口按 repository + commit 定位，core 收齐全部页才发布事实，任一页失败、形状不合法、成环、重复、超限或元素 commit 不是被观察的 head 都放弃整次集合；adapter 片（#289）：只读 GitHub Actions adapter 按 `head_sha` 读 workflow runs 与 check runs，接受 GitHub 实际使用的 `/repositories/{id}` 分页 Link，每个分页守卫有具名 rawClass 判别，原生 status / conclusion 原样透传，Retry-After 与 request id 严格解析。人类伙伴裁定拆分取代归档计划中「#232 不拆」；两层各经 MMP 评审与修复独立复评；Completed |
| [2026-10-07-development-change-request-facts](exec-plan/completed/2026-10-07-development-change-request-facts.md) | #279：变更请求快照透出真实 `headBranch`（直接以提交 SHA 创建时为 undefined，不反推）与保守的 `reviewState`（来源未给结论为 unknown，union 之外的枚举投影为 unknown，新建时只能是 unknown 或 review_required）；`listChangeRequests` 按 repository 再按 headBranch 字节精确过滤后才分页，空串是 invalid_input。共享 suite 按方法自己的 capability key 判定，只读形态必须提供预置变更请求事实；裸 SHA 作 head 可以成功或答 invalid_input。第一轮评审（APPROVE，2 × P2、6 × P3）与修复复评（5 × P3）修订后，13 个规则坏适配器把每条新规则钉住，最终树 47 个变异全部变红；Completed |
| [2026-10-07-development-subset-contract](exec-plan/completed/2026-10-07-development-subset-contract.md) | #205：Development 共享契约套件按 `describeCapabilities()` 的有效能力（capability ∩ permission）选子集——五个可选方法双向受约束（未声明必须结构化 not_supported 且不改对象，声明可用就必须实现），`expect.objects` 必须给出新鲜快照；fake 完整形态加五种子集、Local Git 默认加三种关闭形态共用同一套件，liar 矩阵只按失败消息判别。第一轮评审（APPROVE，3 × P2、8 × P3）修订恢复了两条被误删的「未声明 × fault」断言，补上 CR 读的未声明判定与对应 liar，把没有判别力的 alias 负控改为合法适配器（快照克隆才是承重点）；Completed |
| [2026-10-07-detail-planning-fields](exec-plan/completed/2026-10-07-detail-planning-fields.md) | #274：详情抽屉与列表共享同一份规划事实——`WorkItemDetailContent` 增加恒有的 `iteration` / `targetDate`，在详情遮蔽复验之后从同一次列表安全行复制（不回填 raw 详情、不重新格式化），`contentPanel` 只增加两行只读文字，日期不经 `Date` / locale 解析；loading / unavailable / unresolved / redacted 变体保持精确白名单。遮蔽 differential 覆盖 view、列表、组合页与 drawer；第一轮评审（APPROVE，1 × P2、3 × P3）修订后，date-only 判别在用例内切换四个时区（含 +14 的 Kiritimati），safe-row 来源的状态 canary 改为活的，最终树 12 个变异在 UTC 下全部变红；Completed |
| [2026-10-07-iteration-5-6-planning](exec-plan/completed/2026-10-07-iteration-5-6-planning.md) | #275：迭代 5–6 的规划与 demo 条目规模收敛。规模按「实现 + 测试」重新标定后，demo 路径上原标 `M` 的 12 个条目改为 `L`；#228、#229、#127、#231、#234、#142 各拆出一个同级 issue（#276–#282），另建 M4.1 加固 epic #284 与 Draft→Issue 承接 #283。依赖边新增 19 条、删除 2 条，#143 走查只等 M4；#213 #207 #211 #212 #198 按交付证据关闭。人类伙伴裁决：demo 目标 2026-11-08（加缓冲迭代 9）、Gate E1（#4）在迭代 5 内裁决；Completed |
| [2026-10-05-project-field-read](exec-plan/completed/2026-10-05-project-field-read.md) | #133：GitHub Project 原生字段只读，单页读取字段定义与以 project field id 为键的原生值（R2，`hasNextPage` 即整次失败）；工作区显式映射在注册时校验、深拷贝并冻结，只把列出的 option 归一进唯一的 `planningStatus`，未映射显示「名称（未映射）」、不按名称猜；迭代与目标日期随投影同事务确认，经 wire 到真实列表 HTML，redacted 双层剥离。第一版 1826 行经设计复审精简重写（删除只写不读的原生值落库链、映射不持久化，人类批准），第二轮评审与修复复评的 P2 / P3 已处理；原生值持久化归 #71、映射来源归 #229、同步尊重 `StatusPolicy` 归 #273（待人类裁决）、详情显示迭代与日期归 #274；Completed |
| [2026-10-05-work-item-detail](exec-plan/completed/2026-10-05-work-item-detail.md) | 迭代 5 的 #130：列表与深链打开同一个只读详情抽屉——ui-model 唯一安全投影（scope → 既有列表门 → 安全行 → 白名单 content，详情读取后复验遮蔽）、ui 原生 `<dialog>` 组合页（打开时快照 opener 回焦）、apps/web canonical codec 与产品 `browserHistoryPort`（close 用 replace）。PR #269 的 route-locator P1 经人类伙伴批准 ADR-0010 闭合：规划实体的稳定 ID 是可观察、非秘密、非 capability 的 locator，#129 计划只做限定范围的原处标注；L1–L3 最小披露由带 navigation 的契约用例与变异证据固定（集成树 43 个变异 41 红）。复评 APPROVED 后补 fixture 列表路由 scope 门、组合页 open 通道与 codec 两个拒绝样本。真实 Host 挂载归 #229；与 #268 并集后的详情字段归 #274；非 Chromium 引擎与 300ms 级并发未验证；Completed |
| [2026-10-03-workspace-sync-scope](exec-plan/completed/2026-10-03-workspace-sync-scope.md) | 迭代 4 的 #189：同一连接挂在两个工作区时，同步游标按（工作区，连接，scope）三元键存取——端口记录带必需 `workspaceId`，Fake 与 SQLite 按三字段定位并各查两条父边，003 原位改三元主键（D10），Core 的成功事务、失败结算与 freshness 都显式传工作区，旧两元主键的库在打开时被拒并关闭句柄；工作区 A 的 degraded 与原因不再被 B 的成功洗成 healthy，经 `composeCore` 与 controller 在两个 Storage 上验收，22 项负对照除裁定存活的 N22 外全部变红。第一轮 MVP 评审修订补入「ws1 已接受的事件不阻止 ws2 刷新」两 Storage 回归用例（N23 证明有牙，TD-022 保持 Open）、写明 revert 后需删除重建本地库、把 vertical-path 的 X2 结论改为 issue 记录的复现；遗留 TD-020–TD-022，合并状态以 PR #264 回读为准；Completed |
| [2026-10-03-storage-work-item-rejection](exec-plan/completed/2026-10-03-storage-work-item-rejection.md) | 迭代 4 的 #196：直接向 Storage 写执行上下文、引用未登记工作项时，替身与 SQLite 以同一个 `StorageInputError`（`invalid_input` / 恢复 `none` / 不可重试）拒绝，不再一边接受、一边暴露驱动外键文字；SQLite 的预检在同一队列槽、早于自己的 `BEGIN`，失败方法零写入，事务回滚语义不变，`work_item_id` 外键作为最终防线由 DDL 用例钉住。「同槽」只由设计论证、两槽变体经端口不可判别；core 认领目前把 `failure` 压平成 `unavailable / retry`（不可达），连同其余输入缺陷登记为 TD-023。经第一轮 MVP 评审修订（5 条 P3）后归档；Completed |
| [2026-10-03-workspace-read-assembly](exec-plan/completed/2026-10-03-workspace-read-assembly.md) | 迭代 4 的 #178：client 工作区读取的六个字段都由 `sync.read()` 真实生产，同 revision 的来源降级与恢复经窄 metadata 事件可达，唯一接受点对坏时钟与畸形帧整体拒绝，断网保值保时间，partial 读取的已确认行保持 fresh；第一轮 MVP 评审 11 条 P3 已处置：单帧撕裂读登记 TD-024 待人类定承接，reason 错误码映射（TD-025）与 partial 文案交 #229，lastUpdatedAt 的验收交 #199；另有 TD-026 | Completed |
| [2026-10-01-engineering-reconcile-coverage](exec-plan/completed/2026-10-01-engineering-reconcile-coverage.md) | 迭代 4 的 #249：幸存信号全候选重算、唯一串行写者与独立唤醒——共享 reader 读 Project 页内嵌的完整关闭引用，观察者报出完整零残留；唯一全域 writer 写前算完全部期望、逐项新鲜复读、ack 匹配才算 confirmed，接入 `edited` 与独立 schedule，Planning 状态保持人拥有。两层栈 #259 → #257 经两轮修复复评后合并；合并后首次全域重算清空 8 条完整零残留，schedule 回读通过（频率远低于配置，TD-017），跟进 #261 |
| [2026-10-01-provider-binding-registration](exec-plan/completed/2026-10-01-provider-binding-registration.md) | 迭代 4 的 #197：四个外部 port 必需实现作者声明的静态 `definition`，同一连接可在一个工作区挂多个域；校验与快照都在写之前，工作区与全部挂载在一个事务里写入，ack 之后才发布 Registry；写目标、链读与取消按完整挂载路由，取消回到签发它的 Execution 挂载。经独立复核、验收与第一轮 MVP 评审修订（P1：与 main 组合后的夹具种类），#253 组合门已执行；经两轮修复复评后合并 |
| [2026-10-01-work-item-list-states](exec-plan/completed/2026-10-01-work-item-list-states.md) | 迭代 4 的 #129：只读工作项列表与共享读取状态组件——ui-model 唯一归约首次读取、真空快照、陈旧保行与六种不可用说明（读门未观测说尚未确认、读门已观测不可读说原因未提供，每种都写出还能做什么），redacted 行只剩占位；renderer 经真实 SSR、完整 browser bundle 与 320 / 768 / 1200 静态 fixture 验收，domain 新增纯值出口 `./values`。真实 Host 装配与动态播报归 #178 / #229，一条 redacted 新鲜度的设计取舍已裁决（D 为 UI 层规则、E 写进 #229 验收，见 #129 的决策评论）；经第一轮 MVP 评审修订后合并 |
| [2026-10-01-start-work-sqlite-prerequisites](exec-plan/completed/2026-10-01-start-work-sqlite-prerequisites.md) | 迭代 4 的 #187 / #188 / #192：SQLite 上的开始工作首次走通——外部写入之前登记仓库挂载、canonical 身份与谱系端点；ack 之后 Ready、关系与账本同一事务，本地失败报 Unknown；残缺的 Ready 在重放、重开、接管与 Query 上都不报 Saved。003 原位改挂载键（D10）；经第一轮 MVP 评审修订后合并 |
| [2026-10-01-repository-identity-contract](exec-plan/completed/2026-10-01-repository-identity-contract.md) | 迭代 4 的 #195：`repository` 成为合法的外部身份种类，未知种类在两个存储实现上写前以同一个 `RangeError` 拒绝；002 的 CHECK 原位扩为六值（D10，不写迁移）。Start Work SQLite 栈的栈底，经第一轮 MVP 评审修订后合并 |
| [2026-10-01-board-auto-add-ruling](exec-plan/completed/2026-10-01-board-auto-add-ruling.md) | 看板第十条内置工作流 `Auto-add to project` 的裁决（#248）：按 §4 第 1 步开启，前提是过滤条件只含 issue、不含 PR，该前提只能人工核对；§5 表、`EXPECTED` 与契约测试同步为十条；Completed |
| [2026-09-29-github-projects-read](exec-plan/completed/2026-09-29-github-projects-read.md) | GitHub Projects 读取投影（#70）：注入 GraphQL transport 读条目与内容三态，产出成员关系与内容观察；端口加成员关系分量，core 不登记非内容身份；故障一律结构化失败，契约套件跑在录制夹具上；Completed：R1/R2及P3修订已验收，按交付物整理并经人类授权整合；状态以PR #241回读为准 |
| [2026-09-29-harness-plugin-package](exec-plan/completed/2026-09-29-harness-plugin-package.md) | 插件打包（#227）：`apps/harness-plugin` 只凭本仓库构建出宿主入口、client bundle 与生成的安装件 manifest（目标宿主线 `0.2.0-rc.2`，peer 用范围），经 `dsh plugin --profile desktop add` 装进人类伙伴本机 Desktop 的 `desktop` profile、验收后卸载并核对快照；侧栏入口加占位面板；CI 在干净检出上真跑构建并断言产物契约；宿主侧由 agent 读日志与文件，界面由人类伙伴截图确认，按预注册的 K 行执行；Completed：构建、产物契约和Desktop K验收完成；人类伙伴授权整合，ADR-0009已采纳；transport归#228 |
| [2026-09-29-harness-plugin-reprobe](exec-plan/completed/2026-09-29-harness-plugin-reprobe.md) | 宿主嵌入复探（#225）：仓库外插件包经 `dsh plugin add` 装进一次性 profile，在真实宿主与浏览器里重跑 #125 的问题 2–4；裁决规则、强度分级与 transport 排序先预注册，由契约测试从观测表机械推导 `embed` / `fallback-web`；探针不合并；Completed：Batch 0–6 与评审修订完成，裁决 `embed`（typed remote）；#226 评论及新版复测归属订正已有回执；人类伙伴已授权整合，状态以 PR #238 回读为准 |
| [2026-09-29-source-version-order](exec-plan/completed/2026-09-29-source-version-order.md) | #203 观察版本载体收窄为规范 UTC 纳秒时间戳；旧行迁移、拒绝与备份恢复，完整迁移交错报告阶段和已提交版本；#70 需调用统一归一函数，R1 第 8 行同步收口 | Completed |
| [2026-09-29-e1-uncertain-create-wallclock](exec-plan/completed/2026-09-29-e1-uncertain-create-wallclock.md) | #119 验收 1 按字面补齐（PR #244）：预注册协议 v2 在私有沙箱跑了一次，六个子观测全部复现。`(a-rerun)` 换用写入前确认不存在的标签、`(c-rerun)` 复测平台 `422`，两次写入都没有建出对象；`(b-label)`、`(e2-hit)`、`(e4-hit)`、`(d-count)` 的只读回读与原块逐字节相同。原行加 Superseded，墙钟守卫 `WALLCLOCK_STRICT_DOCS` 防止回退。不能再观测的残余 ①–④ 登记在记录 §3 第 19 条；G3 于 2026-09-30 裁定为 (i)，PR 以关闭关键字关联 #119 |
| [2026-09-29-start-work-resume-evidence](exec-plan/completed/2026-09-29-start-work-resume-evidence.md) | #183 剩余闭环：真实 Git 上基线前进后恢复、多页分支探测与头提交透传、失败时保留已决定分支；评审响应补上 `conflict` 后列表读失败的 `unknown` 传播。PR #237 的最终远端门禁与合并状态按实时 GitHub 回读。 | Completed |
| [2026-09-24-merge-queue-closing-refs](exec-plan/completed/2026-09-24-merge-queue-closing-refs.md) | 订正关闭引用的普适断言，保留两次相反观测；回读 #159、#158、#160、#161 的合并结果及 #139 的关联，并登记 `feat/` 前缀偏差（issue #180） | Completed |
| [2026-09-24-human-execution-provider](exec-plan/completed/2026-09-24-human-execution-provider.md) | 人工执行 provider（#139）：人工运行是 `running`；引用带签发者 HMAC、来源闸门 fail closed，签发者身份由宿主注入；主执行确定起不来时 core 启动声明 `execution.run.fallback` 的绑定（两个角色按能力键分开、受写门约束，#171）；`providerRef` 与降级结论落进运行记录（#172，SQLite 004），取消按运行身份在事务内原子替换（ADR-0008）。库级闭环，宿主装配见 #132，余项见 #215；#139 / #171 / #172 保持 `Refs`，关闭由人类伙伴决定 | Completed |
| [2026-09-26-development-suite-capability-driven](exec-plan/completed/2026-09-26-development-suite-capability-driven.md) | Development 契约套件按能力快照驱动（#205）：新增 `development.worktree.remove` 让破坏性移除可声明；变更请求三个方法与工作树移除按各自的键驱动，已声明路径要求方法真的实现，`expect.objects` 在每种已知写入后都必须新鲜；port 写明「能力先于身份」与只建模能力声明。#205 保持开启：分支 / 工作树创建按快照驱动（验收 2）与本地 Git provider 通过套件（验收 4，随 #160）仍未成立 | Completed |
| [2026-09-23-sqlite-v1-stack](exec-plan/completed/2026-09-23-sqlite-v1-stack.md) | SQLite v1 数据模型栈控制计划：六层堆叠 PR（L1–L6：#121 → #122 → #157 → #167 → #170 → #175）的拓扑、每层目标与判定命令；各层交付状态一律回读（`gh pr list -R SingularityKChen/harness-projects --head <分支> --state all`），随栈顶 #175 归档。v1 是否冻结、#28 / #5 的关闭归属、裁决 R4 / R8 偏离的采纳仍由人类伙伴决定 | Completed |
| [2026-09-24-stack-review-response](exec-plan/completed/2026-09-24-stack-review-response.md) | 第二轮评审响应的执行计划：逐条处置 21 条意见（L1 11 条 + L2 10 条）、栈序表与验收表改成回读命令、R8 收敛到两轴；随栈顶 #175 归档 | Completed |
| [2026-09-24-review-root-cause-convergence](exec-plan/completed/2026-09-24-review-root-cause-convergence.md) | 第三轮响应与第四轮收敛：按"拥有该事实的层"重排批次、删副本加机械判据；含 72 行逐条处置表；随栈顶 #175 归档 | Completed |
| [2026-09-23-storage-sqlite-port](exec-plan/completed/2026-09-23-storage-sqlite-port.md) | SQLite 端口的机制与地基面（Batch L4 / #163）、规划同步面（Batch L5 / #164）与执行面（Batch L6 / #120）：契约套件按端口面切成地基 / 同步 / 执行三组、事务与嵌套事务的运行时拒绝、各表落库、文件库重启用例、观察账本主体 = 端口主体（连接级），以及**唯一一份**写者 / 读者路径机制（`SqliteSyncSurface`）。#120 随 #175 关闭；#28 与 #5 保持 `Refs`：#28 的关闭归属待人类伙伴决定（验收 1 的进程重启 / 逐字节、验收 3 的库层拒绝尚未成立），#5 的验收 3 依赖 #187、#188 与 #132。core 在 SQLite 上的 bootstrap / 列表 / 重启已与替身一致，Start Work 仍受 #187 / #188 / #196 阻塞 | Completed |
| [2026-09-23-storage-control-facts](exec-plan/completed/2026-09-23-storage-control-facts.md) | SQLite 执行、关系、观察、游标、webhook、写尝试（`mutation_attempt`，一行一键）与工作区修订表（Batch L3 / #28）：003 迁移、R4/R5/R6/R8 约束、定序与对账游标端口语义；账本主体 = 端口主体（连接级）、载体校验取非空 ASCII。#28 保持开启：关闭归属待人类伙伴决定；R8 的强制点见 #204，约束测试债见 #201 | Completed |
| [2026-09-23-storage-identity-membership](exec-plan/completed/2026-09-23-storage-identity-membership.md) | SQLite 身份与成员表（Batch L2 / #27）：迁移 002 的八张表（连接锚点与工作区挂载拆开，ADR-0006）与 R1/R2/R3/R7 约束、成员关系与字段值的端口面、表 → 出处映射与变异实验；行为 2 的强制点在 core `entityKindFor` + e2e（ADR-0005），storage 只保证同一工作区同一实体一行投影，种类一致性登记为 core 推导义务。#27 保持开启：验收 3 只到「至多一个 primary」（#190），约束测试债见 #201 | Completed |
| [2026-09-23-e1-uncertain-create](exec-plan/completed/2026-09-23-e1-uncertain-create.md) | 不确定外部创建的裁决证据（栈内 L1 / #119）：四条沙箱实验补测「创建内容本身」的重复创建计数、对账唯一性与可见延迟、平台显式拒绝后的空对账、draft 的对账作用域，并给出 `pending_external_write` 的**获知方式**四个标注及其到 `WriteState` 结果轴的映射（评审响应订正：原先把结果轴与获知方式轴装进同一个集合，才会出现「`pending` 与 `uncertain` 不可判别」的伪约束）。#119 验收 1 的补观测见 [2026-09-29-e1-uncertain-create-wallclock](exec-plan/completed/2026-09-29-e1-uncertain-create-wallclock.md) | Completed |
| [2026-09-24-start-work-recovery](exec-plan/completed/2026-09-24-start-work-recovery.md) | Start Work 的补偿序列可恢复：分支步结果分步落盘、重放跳过已完成的分支步（#183 部分）；`Failed` 可被接管重试（#184）；工作树实体身份收敛到一处定义（#165）。#183 的真实仓库用例与 >100 分支的头提交等剩余项仍开启；follow-up #192 / #193 / #194 | Completed |
| [2026-09-24-ui-model-presentation](exec-plan/completed/2026-09-24-ui-model-presentation.md) | `packages/ui-model` 从客户端模型派生项目首页、工作项列表与统一详情（issue #128）：动作可用性只来自 capability key，陈旧快照不返回空列表，降级只算一次。第二轮 MMP 评审无 P0 / P1；输入契约的组装留给 #178 | Completed |
| [2026-09-24-engineering-writer-terminal](exec-plan/completed/2026-09-24-engineering-writer-terminal.md) | `Engineering` 写入口与观察者共用一份终态选择策略（issue #115 option 1）：`expectedFor` 是唯一实现，写入口聚合 issue 侧全部关闭引用并 fail closed，Merged 终态且单调。第二轮 MMP 评审无 P0 / P1；遗留 #173 / #176 / #177 与合并后的真实事件回读 | Completed |
| [2026-09-24-harness-host-spike](exec-plan/completed/2026-09-24-harness-host-spike.md) | 宿主承载能力探针：四个承载问题各按「机制存在 / 承载能力已实测」两半观测，产出一份记录与 `embed` / `fallback-web` 裁决；裁决为 `fallback-web`，由问题四（插件在一个 slot 里挂载一个页面）决定。无代码合并，探针已删除 | Completed |
| [2026-09-21-gate-e1-ruling](exec-plan/completed/2026-09-21-gate-e1-ruling.md) | Gate E1 裁决：六条行为逐条裁决（1–5 `pass`、6 `inconclusive`），汇总结论 `revise`——本地数据模型 v1 不满足冻结条件；R1–R8 落到表、键或约束上，交 #27/#28 落地；四条结论提升为 ADR（`Proposed`）。#4 保持打开 | Completed |
| [2026-09-21-gate-e1-content-identities](exec-plan/completed/2026-09-21-gate-e1-content-identities.md) | Gate E1 三类内容身份：一次性沙箱、九字段记录模板与三类内容到内部身份的映射证据；三条实验各按九字段模板填满，change request 不产生第二个工作项 | Completed |
| [2026-09-21-policy-check-pr-number](exec-plan/completed/2026-09-21-policy-check-pr-number.md) | policy-check 的目标类型判定已落地：`issue <n>` 命中 PR 编号按用法错误处理（退出码 2）并提示改用 `pr <n>`，`Closes` 指向 PR 按规则违规报出（退出码 1），`Refs` 指向 PR 保持不校验 |
| [2026-09-20-rule-checks-pr-base](exec-plan/completed/2026-09-20-rule-checks-pr-base.md) | PR 体量检查的基线解耦：把"哪些 PR 进入门禁"与"用哪条基线度量"分开，栈上 PR 按自己声明的 base 判定 |
| [2026-09-17-repo-bootstrap](exec-plan/completed/2026-09-17-repo-bootstrap.md) | 仓库引导完成：文档治理约定、pnpm 工作区骨架、包边界契约测试、`PR Fast Gate` 与 `main` 分支保护（只允许 rebase 合并） |
| [2026-09-17-disclosure-audit-and-license](exec-plan/completed/2026-09-17-disclosure-audit-and-license.md) | 发布面审计完成：上游设计输入从仓库历史移除并保留本地只读副本；采用 Apache-2.0；残余暴露面（PR ref）已记录待决 |
| [2026-09-17-issue-convention](exec-plan/completed/2026-09-17-issue-convention.md) | Issue 标题、标签、正文与 PR 关联约定已归档，检查 workflow 保持 advisory |
| [2026-09-17-repo-collaboration-setup](exec-plan/completed/2026-09-17-repo-collaboration-setup.md) | 协作建设完成：README 参考致谢、GitHub Projects 工作项看板、PR 评审体系（含聚合必需检查）、Engram 记忆作用域；四项各自成独立 PR |

## 3. 上游设计输入

本项目的上游设计输入（产品范围、界面规范、工程设计、数据模型、接口契约、身份验证计划、实施计划、测试与发布门禁、决策记录初稿）**不随本仓库分发**：出于发布资格与品牌承诺的考虑，它已从仓库历史中移除，仅作为所有者本地的只读参考存在。审计结论与决策依据见 [2026-09-17-disclosure-audit-and-license](exec-plan/completed/2026-09-17-disclosure-audit-and-license.md)。

因此本目录下的文档是**唯一可分发表述**：对外可读的结论必须能在这里独立成立，不能依赖那份外部输入才说得通（`AGENTS.md` §3）。

后续可能出现的独立批次：

- 把上游决策记录中仍然有效的部分逐条重述为 `docs/adr/ADR-XXXX-<slug>.md`；
- 把工程设计中仍然有效的部分重述为 `docs/architecture/` 下的主题文档；
- 把产品结论中仍然有效的部分重述为 `docs/product/` 下的范围与术语文档。

在这些批次完成之前，本目录下凡涉及长期架构或产品结论的地方，都必须自包含地写明结论本身，而不是指向外部文件。

## 4. docs/product 主题文档索引

`docs/product/` 的目录职责见 §1；随着主题文档陆续落地，实际文档在这里登记（不进 §2 的 ExecPlan 索引——这些是产品结论的权威定义，不是计划）。

| 文档 | 回答的问题 |
|---|---|
| [board-semantics.md](product/board-semantics.md) | `Status` 与 `Engineering` 字段分别属于规划轴还是工程轴、谁写、不变量 3 在看板上如何被满足、全部内置工作流该开该关、`Size` 为什么是信号而不是控制 |
| [vertical-path.md](product/vertical-path.md) | 纵向链路的步骤枚举、MVP-0 / MVP-1 / 首发范围各自的判定方式、MVP-0 的非目标 |
