# Engineering 全候选重算与独立唤醒 ExecPlan

> 状态：Active；Batch 1（共享完整来源、完整零比较与观察者）已实施，位于堆叠 PR 的下层；Batch 2（唯一全域 writer、edited 与 schedule）不在下层，下层单独合并时 #249 的事件丢失仍未修复。
> 创建：2026-10-01；关联 issue：[ #249 ](https://github.com/SingularityKChen/harness-projects/issues/249)。
> 检出：下层 `fix/engineering-project-reader`（Batch 1）与其上的 `fix/engineering-reconcile-coverage`（Batch 2，PR #257），调查基线 `df199a59220cfc32d6cc734116c55b38eec7abd6`。
> 本活文档遵循根 `PLANS.md`；Progress、发现、决策和结果随执行更新。

## Purpose / Big Picture

跨多个 PR 的事件突发不会因一个 pending run 被取消，就使其关联 issue 的 Engineering 永久停在旧值。
一个幸存且通过准入的运行会重算目标 Project 的所有本仓 Issue；最后一个事件也被取消时，独立 schedule 提供再次重算的机会。
日漂移观察者继续只读报错，和写者使用同一完整来源与选择策略；它不承担正常补写职责。
最小证据是生产 main 的离线复现：A running、B cancelled、C survived，C 同时修复 B/C 的不同 issue；无后续 PR 事件时 schedule 同样修复。
本任务只维护自动化拥有的 Engineering；不调查或修改 Status 值，不把工程事实转换为规划接受。

## Context and Orientation

Engineering 是可重算的工程投影，取值为 PR open、Changes requested、Approved、Merged 或空。
PR/review 事件是唤醒提示（hint）：提示值得再读一次，事件 payload 不是字段真值，也不限定重算范围。
`scripts/sync-engineering-state.mjs` 的 `stateForSnapshot` 拥有单 PR 投影，`expectedFor` 拥有多 PR 选择策略、字段 resolver 和带 ack 的 mutation 边界。
`scripts/engineering-drift.mjs` 是纯比较器；`scripts/check-engineering-drift-live.mjs` 是观察者取数/CLI；两者目前按全仓 PR→Issue 图比较。

> **Superseded by** Progress 的 2026-10-02 22:00 Batch 1 条目与 Decision Log「验收裁决（下层）」（2026-10-03）：观察者已改读 Project 页内嵌的完整关闭引用（`loadProjectEngineeringSnapshot`），全仓 PR 列表查询已删除；纯比较器与观察者 CLI 的职责划分不变。下面两行描述的写入口与并发组在 Batch 1 中没有改变。
`.github/workflows/engineering-state.yml` 是唯一自动化 writer 的控制面；signal workflow 和 signal 脚本只提供经准入的唤醒。
当前全局 `engineering-state-reconcile`、cancel-in-progress:false 保护 query/write 串行；默认队列只保留一个 pending，被替换的 B 不运行。
当前 writer 的候选只来自触发 PR 的 closingIssuesReferences；C 不读 B 的目标，因此锁正确而候选域错误。
原 issue 记录 2026-09-30 PR #241 的 signal 成功、reconcile 无 job 被取消，issue #70 的 Changes requested 直到后来事件才修正。
`docs/product/board-semantics.md` §2.1 定义工程轴；`docs/development/ci.md` 记录可信默认分支、字段检查和观察者职责。
本轮是独立设计审查与 author 阶段；使用 brainstorming 比较完整方案、First Principles 推导失败不变量、Qian 统一来源/写者/活性边界。

## Design / Spec

### 方案裁决与状态 owner

采用 Project 页内嵌 Issue.closedByPullRequestsReferences 的全候选读取、默认 single 全局 writer、独立 schedule。
这是对两稿的合成裁决：采用 B 的嵌套读取来源，采用 A 的独立新 CLI 与清晰 import 方向；拒绝逐 issue 初读和全仓历史 PR 图作为权威前置。
GitHub 当前 Issue 关闭引用集合拥有源事实；expectedFor 拥有投影策略；Project Engineering 保存投影；workflow 拥有互斥/准入；observer 只有比较与告警权限。
一个 Project item 只聚合一次完整引用，任一 merged 优先，否则最新 open，否则最新 closed；draft/open、closed/未merged 仍清空。
Merged 的现有含义保持；选择顺序仍先createdAt降序、再number降序，仅两者相同时新增全局PR id按字符串码元升序兜底，不依赖locale或输入顺序。
所有refs始终携带非空全局稳定PR id，reader、关联视图、纯比较与expectedFor不能在映射时丢弃；单Issue引用集合按id验重并拒绝重复，不按仓库局部number去重。
同一PR id跨不同Issue的关联视图行可以重复，但不得在一个Issue的refs里重复；不同仓库同number的两条真引用必须都保留。
#176 的栈内 base 语义不在本任务改写，不从旧事件回放恢复字段；上述id兜底不改变既有非冲突输入的规则或取值。
同仓候选 Issue 可以含来源 API 返回的跨仓关闭 PR；引用不得按当前触发者或 fork head 过滤，writer/observer 必须使用同一集合。
读取 PR 元数据不授权执行 PR 代码；事件 fork gate 与完整数据域是两条不同边界。

| 备选 | 完整性与成本 | 裁决 |
|---|---|---|
| Project 全候选逐 issue 初读 | 165 条目时约超过 166 查询，再加差异复读/写；不会依赖历史 PR 数 | 完整但重复 IO，无必要 |
| 全仓历史 PR→Issue 图复用旧 observer | 当前 77 PR 时约 schema1+PR1+Project2；到 500 历史 PR 后会 fail closed | 不选；双向 association 等价未证明，历史增长会停摆 |
| Project 页嵌套完整 issue 引用 | 当前 schema1+Project2 约3查询；只有引用超过100才追加分页 | 采用；来源与目标范围一致，移除最后关联也能发现 |
| 只改 queue:max | 最多100 pending，溢出/人为取消/最后提示丢失仍未覆盖 | 不作为修复；保留合并 hint 的 single |
| recent/open 时间窗或持久 dirty 集 | 前者缺删除/旧引用完整性，后者需可靠登记/ack/恢复和新 owner | 本规模不引入 |

全历史图若以后再采用，必须把400PR预警、500硬拒绝、容量负责人和改造门作为生命周期要求，不能仅把5页写成永远足够。
本方案的容量边界改为 Project 条目数与每 Issue 的引用数；仍有上限，但不随无关历史 PR 累积增长。
队列容量/替换行为依据[GitHub concurrency官方说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)；本计划已给出采用机制，不要求实现者再猜平台保证。

### 完整快照与比较分离

新增共享只读接口 `loadProjectEngineeringSnapshot` 放在现有 live adapter；writer 和 observer 都调用它，不互相调用 CLI。
分页查询 Project 的 ARCHIVED/NOT_ARCHIVED 全范围，每页100；节点含稳定 item id、content.__typename、Issue id/number/repository 和关闭引用。
每个 Issue 内嵌 first:100、includeClosedPrs:true；引用节点含 id、number、repository、state、merged、isDraft、reviewDecision、createdAt。
这些字段必须实际存在；reviewDecision可以是显式null，不能把缺失字段强制补null或把非法type当正常快照。
Engineering 只用 fieldValueByName(name:"Engineering")；非空返回必须是单选值且 field.id 匹配已校验字段；不读取 fieldValues 全列或 Status。
known PullRequest、DraftIssue、他仓 Issue 明确排除并计数；content:null、未知类型、隐藏对象、缺 id/仓库、重复 item/Issue 均失败。
Project 与每条 refs connection 均校验非负 totalCount、布尔 hasNextPage、有效且不重复 cursor、节点唯一与最终条数。
每页 totalCount 改变、同一 PR id 在本次批次出现矛盾快照等可检测变化以 SourceChanged 拒绝；这不是源原子快照证明。
超过5页/500条即响亮失败；不得把完整性未知、权限错误、missing field 或超限当成空集合。
嵌套 refs 有下一页时，现有 loadClosingPullRequests 接收 initialConnection，消费首批后继续 after，不重复165次逐 issue 预读。
读取所有候选和全部 refs 完毕后才返回快照；首 mutation 前还要计算全部 expectedFor，后项未知枚举不能让前项先写。
快照可保留现有 `{pullRequests,items}` 的关联视图：每条 issue 侧引用生成一行 PR 快照及 closingIssues:[issue]，items 带完整性证据。
这个关联视图是从**同一个 Issue 来源**展开的比较输入，不查询反向 PR closingIssuesReferences，不宣称双向关系必然一致。
同一 PR 引用多个 Issue 时可有多条关联视图行；每个 Issue 侧先按稳定 PR id 验重，不能把重复行或他仓同号 item 混入聚合。
`engineeringDriftFindings` 仍拥有完整输入到 findings 的纯比较，所有本仓 Issue 都参与；JSON 报 referenceEdges，不再把展开行数称全仓 PR 数。

### 完整零引用与唯一策略

冻结 `expectedFor({references,complete=false})`：非空规则保持；数组为空且 complete!==true 仍抛错；complete:true 的完整零返回 null/unreferenced。
完整零须同时证明 Issue 存在、refs nodes=[]、totalCount=0、hasNextPage=false，且全部候选读取完成；事件内容、graph 缺边或异常不是证明。
reader 只在完整分页结束后给 item 标记 referencesComplete:true；writer/observer 都把这个证据交同一 expectedFor，不另写 orphan policy。
非数组、null、undefined、畸形 refs 永远错误；每一个非空引用都经现有 stateForSnapshot 校验，不能只校验被选中的 PR。
零引用且 Engineering 已空为 unchanged；有旧值则 clear。此新语义是设计评审点，不借 MMP 前提清空任何未经完整现读的外部事实。
observer 不再 skipped 无引用条目；完整零残留同样 finding，checked 覆盖全部本仓 Issue。

### 唯一 writer、复读与结果协议

将新建 `scripts/reconcile-engineering-project.mjs`，其 main 是唯一生产 CLI writer；旧 trigger-PR CLI/main/loader删除，不保留兼容写入口。
先 resolveProjectField 校验稳定 ID、目标 Project、名称 Engineering、SINGLE_SELECT、精确四选项和唯一 option ID，再取完整快照并产生全部 findings。
对每个初读有差异的 item，写前 `loadIssueEngineeringSnapshot` 通过稳定 item id 再读取其 Project/Issue 身份、Engineering 与完整 refs。
若 item 移出 Project、换 Issue、字段 id 不匹配或 source 不完整，停止本轮；不能把过时 item 的旧计划继续写入。
fresh expected/current 相等则 unchanged；否则用 fresh expected 的受控 set/clear 构造器调用 writeEngineeringState。
不同事件与 schedule 的 query/write 全段共用 global group；同一运行逐项串行，不开启 per-PR group 或并发 mutation。
全局锁避免两个受控 writer 的 query/write 交错；运行排队时间不等于源快照时间，任何运行执行时都读当前事实。
GitHub 没有本接口可用的 source-snapshot CAS；最终复读与 mutation 间仍可能变化，因此不承诺任何时刻无瞬时 stale。
准确保证是：源稳定后，在 API/凭据可用且公平地再次运行并有一次全域成功完成的条件下，Engineering 最终收敛。
clientMutationId=`runId-runAttempt:itemId` 只关联请求/ack，不是幂等事务保证；ack必须匹配 item id 与 clientMutationId 才 confirmed。
预读失败0 mutation；写中失败非零退出，已经 ack 的项保留 confirmed，读失败项记 unread，已发送但 ack 不明项记 unknown，其余 remaining。
不得输出 allSaved、把 attempted 当 confirmed，或把 ack 丢失谎称0 writes；下一次完整现读只修仍有差异的项。
日志记录 actor=workflow/run、目标 binding=repo/project/field、mutation key、实际 ack 与数量；不打印凭据或含 Status 的对象。

### 独立活性与信任边界

保留 global group 与 cancel-in-progress:false，不设置 queue:max；所有幸存且通过准入的 hint 都扫描相同全集。
增加 pull_request_target:edited，并加非整点 schedule `'17,47 * * * *'`；schedule 不携 PR，不调用 signal jobs/关联 PR 解析。
job if 明确允许 schedule；pull_request_target 同仓 head gate、workflow_run 的事件/success/head_repository gate、原 signal job与唯一正整数PR校验保留。
signal skipped 仍 noop，其它非法 job结论/多PR/空关联/传输错误 fail closed，不能把准入失败转成 broad reconcile。
checkout 固定默认分支、persist-credentials:false；权限 contents/actions read，PROJECTS_TOKEN 只进入唯一 writer step env。
不加 workflow_dispatch、ref selector、PR checkout、artifact 下载、Project change监听或自身 workflow_run，Engineering 写入不形成即时自触发回路。
单 hint 被取消由幸存 hint 覆盖；最后 hint 被取消需独立 schedule，日 observer 不是写者替代品。
GitHub schedule 可延迟/丢弃，公开仓库60日无活动可能禁用；公平再运行是活性前提，不承诺30分钟硬SLA。
这个运行边界依据[GitHub schedule官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)，不把cron频率等同实际执行频率。
持续 API/前缀项故障会让后缀无法推进，需红色告警与人工恢复；不能把固定顺序称为持续故障下的公平保证。

## Global Constraints

本轮只写下面当前文档集；其余均为**未来实施允许集**，没有产品/CI/测试/旧文档改动。所有预算计新增+删除，测试同算，不是净增。
本轮PR当前文档全集：`docs/exec-plan/active/2026-10-01-engineering-reconcile-coverage.md`与`docs/README.md`索引；README由主控owner维护，本reviewer不编辑。
临时 `ci-review.md`仅为独立评审记录，不提交，不属于PR文档全集；本reviewer本轮只改计划与临时记录。

| 未来文件（完整允许集） | 操作/owner | code+tests预算 | docs预算 |
|---|---|---:|---:|
| `scripts/sync-engineering-state.mjs` | 保留策略/字段/ack；删除旧CLI与trigger；加完整性 | 175 | 0 |
| `scripts/check-engineering-drift-live.mjs` | 共享嵌套reader与fresh reader，替换历史图来源 | 170 | 0 |
| `scripts/engineering-drift.mjs` | 完整零比较与引用视图输出 | 30 | 0 |
| `scripts/reconcile-engineering-project.mjs` | 将新建唯一writer CLI | 65 | 0 |
| `tests/contract/engineering-state.test.js` | 旧writer/trigger用例迁到新main，策略/ack/准入保留 | 120 | 0 |
| `tests/contract/engineering-drift.test.js` | 嵌套取数fixture与完整性/定向字段用例 | 100 | 0 |
| `tests/contract/engineering-project.test.js` | 将新建取消/活性/复读/部分失败判别用例 | 90 | 0 |
| `.github/workflows/engineering-state.yml` | 同一writer接edited/schedule，固定默认分支 | 25 | 0 |
| `.github/workflows/board-invariants.yml` | observer传稳定Engineering字段ID，仍只读 | 5 | 0 |
| `docs/exec-plan/active/2026-10-01-engineering-reconcile-coverage.md` | 本活计划 | 0 | 350 |
| `docs/development/ci.md` | 当前来源/触发/恢复/活性边界 | 0 | 85 |
| `docs/product/board-semantics.md` | 就地订正空引用和候选范围 | 0 | 100 |
| `docs/exec-plan/active/2026-09-22-engineering-merged-state.md` | 旧操作入口加Superseded说明，不删历史证据 | 0 | 12 |
| `docs/exec-plan/completed/2026-09-24-engineering-writer-terminal.md` | 旧per-PR runbook加Superseded说明 | 0 | 12 |
| `docs/exec-plan/completed/2026-09-21-engineering-state-trust-boundary.md` | writer入口变更注明，不改历史信任裁决 | 0 | 8 |
| `docs/exec-plan/tech-debt-tracker.md` | 实施owner记录容量/活性后续项 | 0 | 20 |
| `docs/README.md` | 主控owner索引维护 | 0 | 8 |
| 合计/用户上限/余量 | 新增+删除总量 | 780 / 800 / 20 | 595 / 1300 / 705 |

> **Superseded by** Decision Log「沿 Batch 1 / Batch 2 边界切成两个堆叠 PR」（2026-10-03）：按 added+deleted 实测，删除旧 writer 与旧用例使整体 code+tests 超过 780/800 与规则硬上限 1000；允许集与每个文件的职责不变，规模改为逐层核算，每层 code+tests ≤800。

未声明文件只读；不改signal脚本/workflow、workflow-check实现或规则，不新增依赖、持久化服务、schema或迁移。
无真实用户/本地数据不等于GitHub工程投影可丢弃；不能清历史、改Status或用静默unknown→empty简化实现。
实施前用真实diff核预算；旧main/loader/reader删除全部计入。超800须减少重复reader/报告机制或重新切闭环，不删判别用例，不把脚本列生成物排除。
禁止pnpm run/install；使用已存在Node/tsc，缺依赖如实阻塞环境门，不在本任务安装或修无关环境。
人类设计评审是后续实施门；已授权的文档与主控draft发布不用再审批，draft不得ready/merge，本reviewer不执行Git或外部写入。

> **Superseded by** Decision Log「Ruling G1」与 Surprises & Discoveries 的 2026-10-02 实施期条目（2026-10-02）：人类伙伴已授权进入实施；本机 PATH 上的 pnpm 是 pinned 的 10.28.2，主控 Ruling G2 允许 `pnpm install --frozen-lockfile --offline` 与 `pnpm run <script>`，`tsc --noEmit` 是必须通过的门（Ruling G3）。draft 不得 ready/merge 的约束不变。

## Plan of Work

### Batch 1 · 同源完整读取与纯比较

最小闭环是：共享reader从Project页一次取得所有候选/引用，observer用同一策略检测完整零残留，故障能明确失败而不是假无漂移。
主文件为 `scripts/check-engineering-drift-live.mjs`、`scripts/engineering-drift.mjs` 和策略模块；完整允许集见Global Constraints。
先改fixture加入归档跨页、嵌套refs分页、未知对象/字段、后项未知enum、SourceChanged以及完整零/非法空对照，保存旧行为红。
补所有引用fixture的全局id，确保normalizePullRequest保留它；复用策略/状态契约预算加入两个跨仓PR同number/time、不同reviewDecision的数组顺序置换正控。
扩现有paginate验证，复用loadClosingPullRequests的initialConnection分页；resolveProjectField接受owner/projectNumber参数但保持默认目标常量。
按Design构造关联视图，保留纯策略的非空规则，移除observer的零引用skip；所有reader返回前验证全部输入，策略计算发生在任何mutation之前。
离线验证命令：`node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js`；期望全部pass，新增完整零/分页用例旧红新绿。
回滚点为本批完整diff；未接线写入口时只有观察变化，不得把此批称为#249已修好。

### Batch 2 · 单一全域写者与触发覆盖

最小闭环是：C的main能够修复被取消B，独立schedule能处理最后hint丢失；没有第二旧CLI或绕过准入的secret路径。
主文件为将新建的writer与工程workflow；使用Batch1 reader/compare，不把连续注册/写循环为行数拆成更多脚本。
旧红阶段用基线main、触发C号和同一fetch fixture断言B/C均改变；要求红原因是B未改，不是新模块不存在或import失败。
记录红后新建main，删除旧trigger loader/旧main/直接执行guard；测试调用者迁至新main，保留原策略、field schema、ack与signal负控。
增加dry-run只读模式；main全域preflight后对changed item逐项fresh read，输出真实ack/unchanged/unknown/remaining，失败退出非零。
workflow接edited及schedule、job/classifier两类入口和既有review准入；observer只加Engineering字段ID配置，不增加写权限。
命令：`node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js tests/contract/engineering-project.test.js`；期望全部pass且取消/最后hint/fresh/partial反例有判别力。
命令：`node scripts/workflow-check.mjs`；期望8文件无finding，唯一group全局且不取消running，无新secret/ref/artifact面。
回滚必须同时回退新CLI与workflow接线；不保留新旧写者并行。线上关闭writer/回退需后续明确授权，本轮不操作。

### Batch 3 · 发布面、调用图与默认分支验收

最小闭环是：代码/测试/文档一致，独立审阅可证明权限/事实源未退化，合入默认分支后有真实全域运行与observer回读。
主文件为当前CI/语义runbook文档；同源策略和reader由#249一个owner修改，不与其他issue抢产品/Storage区域。
原生rg扫描scripts/workflows/tests/docs中旧CLI、循环import、loadTriggerPullRequest和所有writer调用者；历史命令保留但加当前入口Superseded标记。
按Concrete Steps完成专用契约、类型、公开面/规模检查；环境CLI-space基线失败与新失败分开，不修无关断言或声称全绿。
人类评审批准实现后，主控整理独立闭环commit与draft；最终head全部必要证据回读后才考虑ready，是否merge由人决定。
合入后的默认分支event/schedule回读才算部署证据；draft分支本地mock不是线上活性证明。
回滚遵循Idempotence and Recovery；本任务不写Project Status或被人拥有的关系。

## Concrete Steps

除gh只读命令外均在检出 `fix/engineering-reconcile-coverage` 的工作树根运行；结果必须标实际head和本地CST时间。

> **Superseded by** Decision Log「沿 Batch 1 / Batch 2 边界切成两个堆叠 PR」（2026-10-03）：Batch 1 的命令（下面第一条 `node --test`、两条 workflow-check 与类型 / 公开面 / 规模命令）在检出 `fix/engineering-project-reader` 的工作树根运行；`tests/contract/engineering-project.test.js` 与 `scripts/reconcile-engineering-project.mjs` 属于上层 `fix/engineering-reconcile-coverage`（PR #257），只检出下层时不存在，第二条 `node --test` 会以 `Could not find` 失败。`size` / `disclosure` / `git diff` 的 base 是该层 PR 自己声明的 base（下层是 `origin/main`，上层是下层分支），不是调查基线 `df199a5`：两层变基到较新的 `main` 之后，以调查基线为 base 会把 `main` 自己的提交算进来。

    node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js
    node --test tests/contract/engineering-project.test.js
    node scripts/workflow-check.mjs
    node --test tests/contract/workflow-check.test.js

期望新增契约先产生语义红，再全部工程契约绿；workflow静态扫描无finding。CLI-space失败若仍存在须单独记录，不改变本issue产品范围。

    node node_modules/typescript/bin/tsc --noEmit
    node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6
    node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6
    git diff --numstat df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD
    git diff --check df199a59220cfc32d6cc734116c55b38eec7abd6...HEAD

期望类型/公开面/规模命令exit0、diff-check空输出；按numstat逐项累计code/tests<=800、docs<=1300；未提交改动另读工作树diff，不能遗漏。
CI配置变化的更广验证用 `node --test tests/contract tests/integration tests/e2e tests/mvp0`，禁止pnpm；缺tsc/依赖或继承环境失败显式留下门。

> **Superseded by** 上文 Global Constraints 的同日说明（2026-10-02，Ruling G2/G3）：更广验证改用等价的 `pnpm verify`（typecheck + `tests/contract tests/integration tests/e2e` + `tests/mvp0`），每层在各自检出里运行，结果见 Artifacts and Notes。

    rg -n 'loadTriggerPullRequest|sync-engineering-state.mjs <|node scripts/sync-engineering-state.mjs|export.*main' scripts .github/workflows docs tests

rg期望无旧生产writer调用；历史文档命中必须被Superseded说明覆盖。结构 lint 用的是仓库外 exec-plan 技能的 `scripts/lint_execplan.py`（输出 `OK: ExecPlan passed lint checks.`），不列为可复跑命令；仓库内的等价检查是文档契约 `node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js`（期望全部 pass）。
生产dry-run仅在未来实现后、已配置凭据环境执行 `node scripts/reconcile-engineering-project.mjs --dry-run`；期望0mutation并报告queries/pages/referenceEdges/changed/duration。
当前规模成本目标基础3query、每changed item另加完整fresh read及至多1mutation；记录rateLimit.cost和耗时，不宣称成本为恒定3。
Project或单Issue refs接近400时预警；到500边界仍完整可读，超过则fail closed；写者timeout-minutes=10，当前规模dry-run目标<=240秒是性能门而非收敛SLA。
默认分支部署后只读运行门：`gh run list -R SingularityKChen/harness-projects --workflow engineering-state.yml --limit 10`，期望实际event与schedule成功且无关联号限制候选。
重算门：已配置observer凭据后 `node scripts/check-engineering-drift-live.mjs --json`，完整且无漂移exit0；失败包括实际漂移与source/权限/结构错误。

## Validation and Acceptance

| 验收/反例 | 旧红或防退化 | 新判定证据 |
|---|---|---|
| A running、B cancelled、C survived且B/C不同issue | C只写自身 | C生产main修复两项；observer findings=[] |
| 最后hint取消，无后续PR，独立schedule幸存 | 无正常写恢复入口 | 相同main修复；schedule不调用signal REST或选择PR |
| 同issue多个PR、merged+open、draft、closed | 保护现有三规则 | 任一Merged优先；新draft/closed按既有规则clear；全部refs被校验 |
| 两仓PR不同id、同number/createdAt、不同reviewDecision，调换refs顺序 | 仅时间/编号排序依赖输入顺序；按number验重丢真引用 | reader保留两id；两排列expectedFor结果完全相同，选id码元升序者；重复同id负控失败 |
| 最后closing关联移除，Engineering残留 | trigger不发现旧issue/observer skip | 完整零clear、再读无漂移；空默认仍错误 |
| null/unknown/缺字段/截断/权限/后项未知enum | 禁止错误当empty | 整批preflight0mutation、非零退出 |
| Project跨页/归档/他仓同号/重复item | 防候选遗漏与错配 | 只有本仓Issue参与，重复或隐藏对象失败 |
| refs>100、重复cursor/节点、count变化 | 防部分输入假完整 | 完整分页成功；超5页拒绝；SourceChanged不写 |
| field ID/project/type/option不匹配 | 保持schema边界 | writer/observer均失败；不查询Status/fieldValues |
| 初计划旧、fresh refs或Engineering已变化 | 旧plan直接mutation会错 | 用fresh expected/current；已正确时0额外write |
| mutation后源再变化且无CAS | 不能证明瞬时一致 | 下一公平全域成功run收敛，报告窗口，不虚构锁保护源 |
| 第2项ack错/网络失败，第1项已ack | attempted不可冒充saved | 仅第1项confirmed，后项unknown/remaining；复跑幂等恢复 |
| fork/untrusted/skipped/failure signal/多PR | 防特权入口扩大 | secret step不执行；同repo可信event与schedule正控可执行 |
| 旧CLI/新CLI并存、循环import、自触发 | 防第二writer与循环 | 唯一main接线；pure闭包守卫与workflow负控仍通过 |

Batch 1 的新增 tests 已在本地执行（证据见 Artifacts and Notes）；Batch 2 的新增文件与 tests 不在下层；带凭据的观察者回读属合并后门，本地 mock 不能代替；通过门必须来自真实命令结果和断言，不以计划表代替证据。

## Progress

- [x] (2026-10-01 21:06 CST) 独立审查两方案、原issue、仓库规则/脚本/调用者，明确根因与边界。
- [x] (2026-10-01 21:13 CST) 原生只读API验证两页165条目、完整嵌套refs、字段schema及分页参数；工程两契约96/96通过。
- [x] (2026-10-01 21:25 CST) 保存正式设计/实施计划；当前写入范围见Global Constraints，磁盘semantic与专用lint通过。
- [x] (2026-10-02 06:58 CST) 主控维护独立索引并执行文档契约9/9和技能lint；当前仍未实施writer、schedule或新增测试。
- [ ] 后续实施交接前重新回读本分支draft、#249双向关闭引用、非Status元数据及checks；发布状态以GitHub当前快照为准。
- [x] (2026-10-02 06:54 CST) 最终小审补全跨仓PR id验重/稳定排序及置换正控，明确PR文档全集；预算/lint复核后冻结设计稿。
- [x] (2026-10-02 21:48 CST) 人类伙伴授权进入产品实施（见 Decision Log「Ruling G1」）；对实现的评审与是否合并仍由人决定，未经评审不得 ready/merge。
- [x] (2026-10-02 22:00 CST) Batch 1共享只读来源/比较与旧红新绿证据：`loadProjectEngineeringSnapshot`、`expectedFor` 完整零与 id 兜底、观察者改读 Project 页落地，工程契约 184/184（含 workflow-check 两文件）、tsc exit 0；写前复读 `loadIssueEngineeringSnapshot` 在验收时移到 Batch 2 层（见 Decision Log）。
- [ ] Batch 2唯一全域writer/edited/schedule与取消/partial判别证据：不在下层。
- [ ] Batch 3当前head发布面、环境门、默认分支运行/observer验收及关闭计划。
- [x] (2026-10-02 22:44 CST) 修复轮 1（对抗验证 verify-r1）：缺失的 `reviewDecision` 改为失败而不补 null，矛盾快照元组、Issue 缺 `content.id`/`content.repository`、Project 分页布尔 `hasNextPage` 等无牙守卫补测并用变异复跑证明有牙；修复以 `git commit --fixup` 提交，留待验收 autosquash。
- [x] (2026-10-03 09:40 CST) 人类伙伴批准沿 Batch 1 / Batch 2 边界切成两个堆叠 PR（见 Decision Log）。
- [x] (2026-10-03 09:56 CST) 验收（下层）：autosquash 后树与修复轮 head 逐字节一致；下层只保留 Batch 1 的代码、测试与文档，验收重构、门与变异抽查见 Artifacts and Notes。
- [x] (2026-10-03 11:05 CST) 第一轮 MVP 评审修复（下层，见 Decision Log「第一轮 MVP 评审裁决（下层）」）：变基到 `main`；`docs/development/ci.md` 写明写入口没有随观察者改变、完整零残留只报不清、两种补救与合并前基线命令；索引、Context 与 Concrete Steps 就地订正；`MAX_PAGES` 注释改为本层事实；纯比较器补「不带 `referencesComplete` 键」用例，变异 D1 由存活变红（证据见 Artifacts and Notes）。
- [x] (2026-10-03 11:38 CST) 第二轮修复复评（下层，见 Decision Log「第二轮修复复评裁决（下层）」）：纯比较器再补非布尔真值（`'true'`、`1`）用例，变异 D4 由存活变红；Concrete Steps 删去仓库外的结构 lint 命令，改为说明与仓库内的文档契约（从计划提交起改，栈内任何提交都不再引入该行）。

## Surprises & Discoveries

基线工程契约虽96/96绿，却没有取消pending与最后hint活性的生产main反例；临时机制模型6/6只证明方案逻辑，未接入生产测试。
设计调查的组合契约146/147，唯一既有workflow-check含空格CLI路径stdout为空；本轮独立96/96与workflow-check无finding，不改该环境失败、不称整体green。
2026-10-01约21:06 CST原生API：Project第一页100、第二页65、totalCount165；每页refs完整、最大refs1，每query rateLimit.cost=1；本仓PR历史77。
第二页定向Engineering返回单选字段ID；独立schema查询确认所属Project、Engineering名称及四选项/唯一ID；没有读取Status。
Issue类型原生schema确认after/first/includeClosedPrs参数，includeClosedPrs默认false；现有嵌套合法，不需假设或退成165个初读。
读取快照跨多query不是GitHub事务；检测SourceChanged并不能证明最终复读至mutation期间源未变化。
本轮没有pnpm run/install、产品实现、Git操作或外部mutation；不把缺运行环境转换成放宽安全规则。
2026-10-02 实施期：基线工程契约 + workflow-check 在本机 147/147，上文「CLI 路径含空格」失败不复现；`pnpm install --frozen-lockfile --offline` 已就位、tsc 基线 exit 0，因此 tsc 是必须通过的门（主控 Ruling G2/G3）。
2026-10-02 实施期：`ProjectV2.items` 的 `archivedStates` 默认只含 `NOT_ARCHIVED`（见 `docs/exec-plan/completed/2026-09-29-github-projects-read.md`），读取必须显式写 `[ARCHIVED,NOT_ARCHIVED]`；契约测试钉在查询文本上。
2026-10-02 实施期：观察者的失败表最初只断言 `exit 1` 与 `^::error::`，而一条普通漂移 finding 也满足它；变异 M4（放行未知 content 类型）、M8（放行重复 item）、M13（掩盖缺失的内嵌引用）因此存活。改为要求读取失败的专属前缀、让基准条目无漂移并给每行配独立不变量后，全部被杀。
2026-10-02 实施期：计划的 code+tests 预算 780/800 低估了删除成本——删除旧 writer、旧 loader 及其用例按 added+deleted 全部计入，整体约 1370 行（修复轮 1 之后的观察值），超过规则硬上限 1000；没有靠删判别用例压缩，改为沿批次边界切分（见 Decision Log）。
2026-10-02 修复轮 1：对抗验证复跑 32 个变异，13 个守卫存活；实施期自报的「32 个全部被杀」只对自选清单成立。另有计划明文禁止的一处缺失字段补 null（`reviewDecision`）。均已补测并复跑变异。
2026-10-03 验收：autosquash 之后的下层仍带两处 writer 叙述（live 头注释「观察者与唯一 writer 共用」、快照 JSDoc「观察者与 writer 共用」），`loadIssueEngineeringSnapshot` 在下层也没有生产调用者——只合并下层时 main 会描述一个不存在的 writer 并携带死代码。验收把最终注释直接放进下层、把写前复读整体移到上层，复评 M-R2 的头注释双向抖动随之消失。
2026-10-03 验收：上层原先删掉了观察者层的「完整零引用残留被报告」用例（理由是与写者用例同不变量）；在下层它是 `referencesComplete` 唯一的观察者端判别（变异 A5 只被它杀死），因此两层都保留。
2026-10-03 验收：第一次变异抽查在 zsh 里把测试文件列表当成一个参数传给 `node --test`，输出 `Could not find …`，脚本却把空计数判成 RED；改为按词展开、并把「没有测试汇总」判成 ERROR 后全部重跑。「红」也可能只是测试没跑，与「绿」可能只是变异没落地同形。
2026-10-03 第一轮 MVP 评审：「写入口在本层没有变，完整零残留只会被报出、不会被自动清除」写进了下层文档提交的正文与本计划的 Outcomes，却没有写进运行说明 `docs/development/ci.md`；读 `main` 的运维者只能看到 `scripts/sync-engineering-state.mjs` 注释里「对漂移条目所属的 PR 重跑 writer」的补救，而它对 `prNumber: null` 的完整零 finding 无效。写进提交正文与计划不等于写进了运行说明。
2026-10-03 第一轮 MVP 评审：纯比较器 `normalizeItem` 的 `referencesComplete === true` 守卫只被显式 `false` 的用例覆盖；弱化成 `!== false`（缺证据当作完整）的变异 D1 存活（评审在变基前 head 上 169/169，修复者在变基后 head 上复现 169/169）。验收的变异 A5 只改 reader 一侧，没有覆盖纯比较器自己的缺键输入。

## Decision Log

- Decision：采用Project页嵌套完整Issue引用，保留single全局writer并加独立schedule。
  Rationale：直接修复候选随hint丢失；实际schema可行且约3基础query，避免历史PR500上限与双向关系一致性未知。
  Date/Author：2026-10-01 21:25 CST / 独立reviewer。
- Decision：expectedFor默认空仍报错，仅完整零证据允许clear，writer/observer同源。
  Rationale：最后关联移除必须有收敛闭环，错误或截断不能授权清外部事实；人类设计评审后实施。
  Date/Author：2026-10-01 21:25 CST / 独立reviewer。
- Decision：新CLI为唯一writer，保留投影/比较/reader职责与有向imports，不建立兼容CLI或额外队列服务。
  Rationale：删除旧控制面并计入预算，保留现有判别断言；MMP前无兼容需求不允许清GitHub历史。
  Date/Author：2026-10-01 21:25 CST / 独立reviewer。
- Decision：refs全程保留全局PR id，单Issue按id验重；createdAt/number相同后按id码元升序稳定兜底，writer/observer仍共用expectedFor。
  Rationale：已声明的跨仓集合允许同number/time，不补id会使reviewDecision选择依赖数组顺序；复用既有策略175/状态契约120预算，不增输出或新机制。
  Date/Author：2026-10-02 06:54 CST / 独立reviewer，落实主控最终小审。
- Decision：进入产品实施（Ruling G1）。
  Rationale：2026-10-02 人类伙伴在会话中明确要求继续基于本地 worktree 开发 #255–#257，且已有 spec 与 plan；这就是「产品实施须经人类评审」的门。它不是 `Status` 或看板写入，也不授权 push、合并或任何外部写。
  Date/Author：2026-10-02 21:48 CST / 主控转述人类授权，实施者记录。
- Decision：`loadClosingPullRequests` 与观察者的 `paginate` 各自就地扩展（cursor 去重、totalCount 变化、节点去重、布尔 `hasNextPage`），不抽共享分页器。
  Rationale：两处本来就是独立循环；抽取要把约 60 行旧循环整体改写并计入预算，就地扩展只加 20 余行且保持接口冻结。代价是同一类校验有两份，由两侧各自的失败表约束（复评 M10 记录，验收维持）。
  Date/Author：2026-10-02 22:00 CST / 实施者。
- Decision：完整零引用的 finding 用 `prNumber: null`、`rule: 'unreferenced'`，`describeFinding` 写「无关闭引用」；观察者新增必需环境变量 `ENGINEERING_FIELD_ID`（`board-invariants.yml` 的 job env 取 `vars.PROJECTS_ENGINEERING_FIELD_ID`），仍只读。
  Rationale：expectedFor 返回形状不增字段；观察者要用已校验的字段 ID，才能做定向 `fieldValueByName` 的字段身份核对。
  Date/Author：2026-10-02 22:00 CST / 实施者。
- Decision：修复轮 1 的取舍（下层部分）。缺失的 `reviewDecision` 在 loader 与纯比较两处都失败（显式 null 仍合法）；矛盾快照按 state/merged、reviewDecision、isDraft、createdAt 各一行；删掉与 `Issue id` 互为冗余的 `Issue 编号` 去重（同仓内一一对应）；Project 分页补布尔 `hasNextPage` 检查；Issue 缺 `content.repository` 本来就失败，只补测试钉住，不让它被当成他仓条目排除。
  Rationale：每个守卫都用变异复跑证明有牙；简化只删本 PR 新增且被同不变量用例覆盖的行。
  Date/Author：2026-10-02 22:44 CST / 实施者。
- Decision：沿 Batch 1 / Batch 2 边界切成两个堆叠 PR：下层 `fix/engineering-project-reader`（计划提交 + Batch 1，`Refs #249`），上层 `fix/engineering-reconcile-coverage`（PR #257，Batch 2 与运行文档，由它关闭 #249）。
  Rationale：`rule-checks size` 按 added+deleted 计且是 CI 硬门，整体 code+tests 约 1370 > 1000，其中约 580 行是计划要求的删除，简化无法达标；两层各自 ≤800、各自全绿，栈深 2。下层只陈述自己的事实（完整来源、完整零比较、观察者），不得称 #249 已修好；旧的触发 PR 写入口在下层保持可用。代价是多一个 PR 要评审；回退方式是把 #257 改回以 main 为 base 并关闭下层 PR。
  Date/Author：2026-10-03 09:40 CST / 人类伙伴批准，主控转述；验收者记录。
- Decision：验收裁决（下层）。(1) 写前复读 `loadIssueEngineeringSnapshot` 与其用例移到上层，下层直接采用最终注释（消除 writer 叙述、死代码与复评 M-R2 的头注释抖动）；(2) 观察者层的完整零残留用例保留；(3) 复评 M-R1：Project 分页的非布尔 `hasNextPage` 用 `[undefined, null, 0]` 三行钉住，使 `=== undefined` 与 `== null` 两种弱化都变红；(4) 复评 M12：补观察者 CLI 子进程用例，入口守卫或 `process.exitCode` 丢失都会让每日 job 假绿；(5) `MAX_PAGES` 注释改为 Project 条目与关闭引用两条分页路径；(6) `docs/development/ci.md` 记下观察者必需 `ENGINEERING_FIELD_ID`（M6）与 `content: null` 让整次读取失败的活性代价（M9）；(7) 复评 O1 的 `normalizeItem` 中 `engineering ?? null` 不改：live adapter 先拒绝缺失的 `fieldValueByName`，生产路径不可达，收紧它是独立清理。
  Rationale：只合并下层时 main 只陈述下层事实；每处测试改动都用变异抽查证明有牙（见 Artifacts and Notes）。
  Date/Author：2026-10-03 09:56 CST / 验收者。
- Decision：第一轮 MVP 评审裁决（下层）。2026-10-03 评审账号对 #259 提交 APPROVE：1 × P2 + 4 × P3（inline）与四条 PR 级 P3，全部是 `[suggestion]`；人类伙伴的规则是只剩 P2/P3 时先批准、再修复、整合提交、rebase merge。逐条处置：(1) P2 `docs/development/ci.md`：属实——只合并本层时完整零残留会让每日观察持续报红，而运行说明没有可执行的补救；写明本层事实、两种补救（合并全域 writer，或经人类伙伴批准手工清空并记入本 Decision Log）与合并前回读 `unreferenced` 基线的命令。(2) P3 `docs/README.md` 索引状态、Context 第 21 行与 Concrete Steps 的检出说明：属实，就地订正或标注 Superseded。(3) P3 `MAX_PAGES` 注释：属实，改为本层事实（观察者读 Project 条目分页；写入口与观察者读单个 issue 的关闭引用分页）。(4) P3 `scripts/engineering-drift.mjs` 的 `referencesComplete === true`：属实，补「不带该键」用例。(5) PR 级 P3 不改代码：旧 writer 的成员检查只比编号是 `main` 既有问题，由上层 PR #257 删除旧 writer 消除；容量预警由上层登记进技术债 tracker（本层不改 tracker）；`describeFinding` 的「依据 PR #N」不带仓库名只影响诊断文本，判定按全局 PR id，不在本轮改输出形状；带凭据的观察者 `--json` 回读已是 Concrete Steps 的重算门，`unreferenced` 基线命令写进了 `docs/development/ci.md`。
  Rationale：每条修复只陈述本层合并后 `main` 上成立的事实；补测用变异证明有牙。合并顺序按评审建议：#257 获批后两层用 merge-async 背靠背 rebase merge，不让本层单独停在 `main` 上。
  Date/Author：2026-10-03 11:05 CST / 评审由评审账号提交，人类伙伴规则由主控转述；修复实施者记录。
- Decision：第二轮修复复评裁决（下层）。2026-10-03 评审账号对修复后的 #259 提交 APPROVE，2 × P3，全部是 `[suggestion]`：(1) 「只有显式 `true` 才授权清空」只钉住了缺键与 `false`，非布尔真值被当作完整的弱化（变异 D4 `Boolean(node?.referencesComplete)`）仍存活——属实，在同一用例里补 `'true'` 与 `1` 两个输入；(2) Concrete Steps 把仓库外 exec-plan 技能的 `scripts/lint_execplan.py` 连同本机 home 路径列为可复跑命令——属实，与 `AGENTS.md` §3 的自包含约定和 `docs/exec-plan/completed/2026-10-01-start-work-sqlite-prerequisites.md` 的先例不符，改成「仓库外技能，不列为可复跑命令；仓库内的等价检查是文档契约」。这一行从计划提交起就在，所以改在计划提交里，而不是在后面的提交里删除：每个提交单独引入的新增行都是发布面。
  Rationale：按第一轮意见标题的原条件（「`=== true` 被弱化后没有用例变红」）复核，第一轮只修了一半；补测后 D1–D5 五种弱化全部变红。路径一条机械扫描不覆盖（家目录模式只认字面的绝对路径，不认环境变量写法），靠人工五类目检查发现。
  Date/Author：2026-10-03 11:38 CST / 评审由评审账号提交，主控转述；修复实施者记录。

## Idempotence and Recovery

相同输入重复全域读取/比较无差异即零mutation；partial失败不重放旧plan，下一次完整读取权威current再投影。
预读失败无需回滚外部写，因为未发送；mutation失败可能已生效，保存已确认ack与未知目标，不反向猜测旧值或自动清理。
上线误写风险时由授权操作者先暂停唯一workflow并确认无running writer，再通过新PR整体回退；不开第二writer手工并发修补。
恢复正确默认分支代码/凭据后，通过同一控制面重新完整reconcile；不以旧payload恢复历史Engineering，也不操作Status。
schedule长期未成功、token失效、持续SourceChanged/超限是运维阻塞，observer红报告或运行记录可见；排除故障后公平再运行才有最终收敛。
临时fixture/evidence保留在执行期目录，提交只含Global Constraints允许的交付文件；恢复不删除其他工作树、未追踪内容或用户改动。
后续实施owner在技术债tracker登记容量接近400、scheduler可用性观察与持续前缀失败公平性；#176既有语义缺口保持独立，不在本issue顺手修改。

## Artifacts and Notes

观察上下文（2026-10-02 06:58 CST）：检出 `fix/engineering-reconcile-coverage`、基线如Context所示的文档工作树；技能lint为OK，`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js` 为9 passed/0 failed。新控制器/部署测试未执行；主控索引位于独立锚点，最终公开差异重算 `git diff --numstat origin/main...HEAD`。

    engineering contracts: tests 96 / pass 96 / fail 0
    workflow-check: no findings（已检查 8 个文件）
    nested Project pages: nodes 100 + 65; totalCount 165; refsComplete true; maxRefs 1
    GraphQL page cost: 1 + 1; field schema cost: 1

这些是设计时观察，不是未来新测试或线上writer验收；每次实施后将实际命令/head/CST与差异追加到活计划。

Batch 1 实施期证据（2026-10-02，检出 `fix/engineering-reconcile-coverage` 的 `.worktrees/engineering-reconcile-coverage`）：

    baseline @330fa49: engineering-state + engineering-drift + workflow-check = 147/147 pass; workflow-check 无 finding; tsc exit 0
    Batch 1 RED（新用例对旧代码）: engineering-state 8 fail（expectedFor 完整零仍抛错、跨仓同号置换依赖输入顺序、initialConnection 未消费、多页 totalCount/cursor/节点矛盾未拒绝）; engineering-drift 10 fail
    Batch 1 GREEN: state + drift + workflow-check + check-board-workflows-live = 184/184

变异核对（实施期与修复轮 1，每次先打印被改行确认已落地，再跑测试，用 `cat backup > file` 还原）：选择策略（去掉 id 兜底、忽略 complete、去掉重复 id 拒绝）、reader（未知 content 类型、project id 不符、字段 id 不符、重复 item/Issue、PR 矛盾快照及其四个字段、totalCount 变化、cursor 重复、缺失的内嵌引用被掩盖、`archivedStates` 去掉、initialConnection 被忽略、Issue 缺 id/仓库、布尔 `hasNextPage`）与缺失 `reviewDecision` 补 null，全部被至少一条用例杀死；初始存活的 M4/M8/M13 见 Surprises & Discoveries。

验收（2026-10-03 09:56 CST，下层；检出 `fix/engineering-project-reader` 的 `.worktrees/engineering-project-reader`，代码提交 `7d75b83`；本条目所在的文档提交只改 docs）：

    GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash 330fa49 → 无冲突；与修复轮 head 的备份 ref 比较 git diff --stat 为空
    node --test tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js tests/contract/workflow-check.test.js = 169 pass / 0 fail
    node --test tests/contract = 735 pass / 0 fail；pnpm verify exit 0（931 pass + mvp0 7 pass）；pnpm run boundaries = 8 pass
    node scripts/workflow-check.mjs = no findings（已检查 8 个文件）；node node_modules/typescript/bin/tsc --noEmit exit 0
    node scripts/rule-checks.mjs size df199a59220cfc32d6cc734116c55b38eec7abd6 = 代码 636 / 1000、文档 320 / 1500（观察时刻：代码提交 7d75b83，本文档提交之前；回读用同一命令）
    node scripts/rule-checks.mjs disclosure df199a59220cfc32d6cc734116c55b38eec7abd6 = 机械扫描通过；git diff --check 空输出

变异抽查（下层，S+D+workflow-check 三个文件，基线 169/169；每次先打印被改行，`cat backup > file` 还原后树干净）：A1 Project 分页布尔检查弱化成 `=== undefined` → 3 fail；A2 弱化成 `== null` → 2 fail；A3 观察者入口守卫 `if (false)` → 1 fail；A4 丢掉 `process.exitCode =` → 1 fail；A5 reader 给出 `referencesComplete: false` → 1 fail（只被观察者完整零用例杀死）。

第一轮 MVP 评审修复（2026-10-03 11:05 CST，下层；检出 `fix/engineering-project-reader`，已变基到 `main`；变异先断言 `git diff --quiet`、打印被改行、从内存原文写回后再断言 `git diff --quiet`，没有测试汇总判 ERROR）：

    node --test --test-timeout=120000 tests/contract/engineering-state.test.js tests/contract/engineering-drift.test.js tests/contract/workflow-check.test.js = 169 pass / 0 fail（新断言并入既有完整零用例，用例数不变）
    D1 `referencesComplete === true` → `!== false`：补测前 GREEN(存活) 169/169；补测后 RED 168/169，✖ 完整零引用…缺完整性证据时空引用仍是错误
    D2 缺键时当作 true（`!== undefined ? … : true`）：补测后 RED 168/169，同一用例

第二轮修复复评（2026-10-03 11:38 CST，下层；同一检出与做法）：

    D4 `Boolean(node?.referencesComplete)`：补测前 GREEN(存活) 169/169；补测后 RED 168/169，✖ 完整零引用…缺完整性证据时空引用仍是错误
    D1 `!== false`、D2 缺键当 true、D3 `Boolean(node?.referencesComplete ?? true)`、D5 `== true`：补测后均 RED 168/169，同一用例
    node --test --test-timeout=120000 tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js = 9 pass / 0 fail（替代仓库外结构 lint 的文档契约）
正式文档不依赖临时两稿才能执行；本计划已嵌入选择、接口、失败边界、文件预算和验证步骤。

## Interfaces and Dependencies

依赖Node已有fetch、现有yaml测试解析、GitHub GraphQL/Actions、PROJECTS_TOKEN、PROJECTS_ENGINEERING_FIELD_ID与默认分支。
策略/读取接口冻结为：

    expectedFor({references, complete = false}) -> {value, prNumber, rule}
    loadClosingPullRequests({gql, owner, repo, issueNumber, initialConnection}) -> complete references[]
    loadProjectEngineeringSnapshot({gql, owner, projectNumber, projectId, fieldId, repository}) -> {pullRequests, items, counts}
    loadIssueEngineeringSnapshot({gql, projectId, fieldId, repository, itemId, issueId}) -> {pullRequests, items:[one complete item], counts}   # Batch 2 层
    engineeringDriftFindings({pullRequests, items}) -> {findings, checked}
    main({env, argv, fetchImpl, log}) -> exitCode; argv仅允许--dry-run或无参数，不接受旧PR号   # Batch 2 层

items每项含itemId/issue/issueId/engineering/referencesComplete；pullRequests仅为Issue来源展开的比较视图，counts含pages/items/referenceEdges/excluded。
references及pullRequests关联视图行必须保留id；expectedFor对缺失/空id或同Issue重复id拒绝，newestFirst以createdAt降序→number降序→id码元升序构成确定顺序，返回形状不增字段。
imports方向固定：pure drift→sync策略；live adapter→drift+sync；new writer→live+drift+sync；sync不得反向importwriter/live。
resolveProjectField接受可选owner/projectNumber并保持现有默认目标，observer/writer使用同一schema验证；writeEngineeringState及其受控构造器/ack签名不变。
凭据只经env/既有secret服务解析，不在计划/fixture/log保存；signal分类器保持当前接口，schedule独立准入不用造PR关联。

## Outcomes & Retrospective

2026-10-01 21:25 CST：完成独立设计审查、原生schema/分页/成本验证及自包含正式计划；产品代码与CI仍为基线行为。
本次裁决修订两稿的候选来源/零引用/成本与一致性表述，保留全局串行与信任边界；当前文档集/未来允许集见Global Constraints。
人类设计评审、全部新contracts、dry-run成本、默认分支部署回读仍未完成；draft发布由主控处理，不能宣布生产已修复。
2026-10-02 06:54 CST：小审补齐跨仓PR全局身份/置换不变性和当前PR文档边界；代码/测试仍未实施，设计稿pass/freeze，后续实施门不变。
2026-10-03 09:56 CST：下层（Batch 1）验收完成。观察者与共享 reader 改读 Project 页内嵌的完整关闭引用：完整零残留会被报成漂移，跨仓同号引用的选择与输入顺序无关，缺字段、隐藏对象与分页矛盾一律读取失败。写入口、workflow 与 #249 的事件丢失在下层不变：下层合并后观察者可能新报出此前被跳过的完整零残留，而在 Batch 2 合并前没有自动写入口会清它们。剩余：Batch 2（上层 PR #257）与带凭据的观察者 `--json` 回读（合并后门）。未写 `Status`，未改任何外部状态。

## Bottom Change Note

Change Note (2026-10-01 21:25 CST)：独立审查后采用实测可行的嵌套Project读取，冻结完整零证据/唯一writer/fresh复读/公平活性；记录added+deleted预算与已有环境失败，磁盘复审修正可移植lint路径与fresh接口形状。
Change Note (2026-10-02 06:54 CST)：按主控最终小审补refs全局id保留/验重、时间编号相同的稳定排序及跨仓置换正控，明确本轮PR仅计划+README索引；沿用780/595预算，冻结设计稿。
Change Note (2026-10-02 22:12 CST)：实施后回填 Progress、Surprises（预算低估与失败表假绿）、Decision Log（含 Ruling G1）、Artifacts 与 Outcomes。
Change Note (2026-10-02 22:44 CST)：修复轮 1——按对抗验证补缺失字段 fail closed 与无牙守卫的测试、落实简化清单，并记录主控的两层切分裁决；修复以 fixup 提交。
Change Note (2026-10-03 09:56 CST)：验收——autosquash 后切成两个堆叠提交序列；下层只保留 Batch 1 的事实，记录人类批准的切分、验收裁决、下层门与变异抽查，并就地标注被推翻的预算与「禁止 pnpm」约束；Batch 2 的条目随上层追加。
Change Note (2026-10-03 11:05 CST)：第一轮 MVP 评审修复（下层）——Context 与 Concrete Steps 就地标注 Superseded，回填评审的 Progress、Surprises、Decision Log 与 Artifacts；运行说明的本层事实写在 `docs/development/ci.md`。
Change Note (2026-10-03 11:38 CST)：第二轮修复复评（下层）——Concrete Steps 的仓库外结构 lint 命令改为说明（改在计划提交），回填 Progress、Decision Log 与 Artifacts。
