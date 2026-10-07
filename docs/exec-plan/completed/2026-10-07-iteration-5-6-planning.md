# 迭代 5–6 规划与 demo 条目规模收敛 ExecPlan

> 状态：Completed（2026-10-07）。Batch 1–4 完成；人类批准见 `Decision Log`，写入与回读见 `Progress`。PR 的合并由人类伙伴决定，合并状态以 `gh pr list -R SingularityKChen/harness-projects --head project-management/iteration-5-6-planning --state all` 回读为准
> 创建：2026-10-07
> 范围：盘点 Project 10 的现状，把 demo（里程碑 M4）剩余工作重排进迭代 5、6，按「每个 PR 代码约 800 行」拆分超规模条目，修正依赖边、父子关系、里程碑与字段；同时给出迭代 7–8 的预览和 demo 日期的取舍。不改 `packages/`、`apps/`、`tests/` 下的任何文件。
> 观察基线：2026-10-07，`main@1481cff`。看板与 issue 的易失状态一律写成回读命令（见 `Validation and Acceptance`），正文里的计数只代表这个时刻。
> 上游输入：`AGENTS.md`、`PLANS.md`、`docs/product/vertical-path.md`、`docs/architecture/release-gates.md`、`docs/architecture/gate-e1-ruling.md`，以及本机只读、不随仓库分发的上游设计输入（`AGENTS.md` §3）。本计划只重述其中仍然有效的结论；冲突时以仓库内文档为准。

## Purpose / Big Picture

完成后，打开 Project 10 的「本迭代」视图，就能直接回答三件事：

1. 迭代 5（10-08 至 10-11）和迭代 6（10-12 至 10-18）各自承诺什么，哪些是可以砍掉的追加项；
2. 每个承诺项能不能现在动手：`blocked-by` 只在真的做不了时才存在，demo 走查（#143）只等 M4 的条目，不再经 epic 间接等 demo 之后的加固项；
3. 每个条目会是多大的 PR：超过约 800 行代码的条目已经拆成能独立验收、合并、回滚的子 issue，剩下标 `L` 的条目都写明了「如果设计评审后仍超 800 行，从哪里切」。

最小成功证据：`Validation and Acceptance` 的 V1–V8 逐条回读通过。

## Context and Orientation

### 术语

| 词 | 在本计划里的意思 |
|---|---|
| demo | 里程碑 M4：在 Harness 插件里走通纵向链路第 1–12 步（`docs/product/vertical-path.md` §2），即 MVP |
| 代码行 | `node scripts/rule-checks.mjs size <base>` 的 `code` 桶：实现与测试都算，新增与删除都算；ExecPlan 等 `.md` 计入 `docs` 桶 |
| 规划线 | 每个 PR 代码约 800 行、文档约 1300 行；CI 硬上限代码 1000 行、文档 1500 行（两者并存，用途不同） |
| 承诺项 / 追加项 | 迭代承诺交付的条目 / 承诺项完成后才拉入、可以整体砍掉的条目 |
| 主链 | 必须串行合并、决定 demo 日期的一串条目 |

### 2026-10-07 的事实

- 迭代窗口（`Iteration` 字段配置）：迭代 4 为 10-01 至 10-07，今天结束；迭代 5 为 10-08 至 10-11，只有 4 天；迭代 6 为 10-12 至 10-18；迭代 7 为 10-19 至 10-25；迭代 8 为 10-26 至 11-01，标题是「Demo 走查与上线」。
- 迭代 4 关闭了 15 个 issue（#126 #129 #130 #133 #177 #178 #187 #188 #189 #192 #195 #196 #197 #248 #249），合并了 10 个产品 PR 和 3 个 CI PR。产品 PR 约每天 1.4 个，其中一部分在迭代 3 就已开工。
- 看板有 168 个条目，其中 81 个 open。#261、#273、#274 是 10-03 以后新开的，Priority、Size、Iteration 与里程碑都为空。所有已关闭条目的 `Status` 都是 `Done`，没有 open 条目处于 `In Review` 或 `Done`。
- 当前没有 open 的 PR，迭代 5 从零在制品开始。
- Harness 宿主：`@deepseek-ai/dsh` 的 `latest` 与本机桌面端都是 `0.2.0-rc.2`，另有 `0.2.1-alpha.1`（10-03 发布）。

### 规模口径校准

最近四个产品 PR 的构成（`gh pr view <n> -R SingularityKChen/harness-projects --json files` 按路径归类）：

| PR | 实现 | 测试 | 文档 | 代码合计 |
|---|---|---|---|---|
| #266 | 369 | 435 | 461 | 804 |
| #268 | 432 | 482 | 222 | 914 |
| #269 | 318 | 681 | 730 | 999 |
| #270 | 508 | 492 | 367 | 1000 |

测试量是实现的 1.0 到 2.1 倍。所以规划成 `M`（≤600 行）的条目，交付时普遍到了 800 到 1000 行。按 800 行规划时，实现部分应控制在约 350 行以内。本计划的所有估算都按「实现 + 测试」写代码行。

### 现状审计的来源

2026-10-07 做了三份只读审计，结论经主会话抽查（例如 `git grep "'main'" packages/core/src` 无命中，证明 #213 已交付；`node scripts/policy-check.mjs issue 261` 报「summary is 83 characters」；`packages/storage/sqlite/src/migrations.ts` 按 `import.meta.url` 读 `../migrations/`，而 `apps/harness-plugin/scripts/build.mjs` 不复制迁移文件）：

1. 上游设计输入的 MVP 验收、R1、十条不变量、故障矩阵、UAT、界面与 API 契约，与仓库 issue 的覆盖对账；
2. 迭代 5、6 候选条目与代码的对账；
3. 迭代 7、8 与远期条目的对账。

结论落在下面的 Design。

## Design / Spec

### D1. 主要矛盾与主链

主要矛盾是 demo 日期和容量。拆分之后，demo 还需要约 23 个代码 PR 和 4 份文档。按约每天 1.2 到 1.4 个 PR 估算，10-08 至 10-25 的 18 天大约能合并 22 到 25 个，几乎没有余量。

剩余工作按包的所有权分成五条线，它们都汇入 #143 走查：

| 线 | 串行顺序 | 说明 |
|---|---|---|
| 壳 | #228 → #276 → #229 → #277 → #230 | 宿主服务、watch 流、列表与详情挂载、字段映射持久化、打包 |
| 绑定（主链） | #228 → #132 → #127 → #131 / #142 | 宿主组合根、绑定命令、首页与连接流程、开始工作对话框 |
| 同步 | (#220 + #199) → #134 | 修订号与存储拒绝，然后定时对账与刷新 |
| 交付 | #221 → #222 → #233 → #234 | 唯一写者、纯读查询、谱系同步、抽屉谱系条 |
| provider | #205 → #279 → #231；#232 并行 | 只改 `packages/providers/*`、`packages/capabilities` 的增量字段与契约套件 |

主链是绑定线。#228 是壳线和绑定线的共同根，所以迭代 5 的第一优先级是让 #228 在 10-11 前合并。其余线只要文件集合不重叠，就应当从迭代 5、6 开始并行。

### D2. Size 字段按代码行重新标定

`Size` 的取值不变，含义改按代码行（实现 + 测试）读：`XS` ≤100，`S` ≤300，`M` ≤600，`L` ≤1000。`L` 的条目必须在自己的 ExecPlan 里先做一次设计膨胀审查：逐个机制回答「保护哪条验收或不变量」。审查后仍超过 800 行，才按 D3 表里预先写好的切缝拆分。不允许把同一份代码机械地切成几刀。

### D3. 拆分

拆分方式是收窄原 issue 的范围，再新开一个同级子 issue，挂在同一个 epic 下。这样既不加深层级，也保住原 issue 的编号和讨论。新 issue 在起草时用临时代号 N0–N9，2026-10-07 创建后回填为 #275–#284（N*k* 对应 #(275+*k*)）。

| 原 issue | 收窄后保留 | 新 issue（同级） | 依据 |
|---|---|---|---|
| #228（原估 1000–1400） | 宿主服务与 typed remote 的一次查询加一次命令往返；宿主组合根的包边界 ADR（Proposed）与 `tests/contract/package-boundaries.test.js` 更新；迁移文件随插件包发布；凭据引用；卸载释放句柄 | #276 `feat(apps): stream the workspace watch from the plugin host into the client store`（M，迭代 6） | 往返与流是两个可独立验收的闭环；流语义同时是 #218 的前提 |
| #229（原估 1400–2000） | 在插件里挂载列表与详情抽屉（步骤 3–5），含决策 D/E、未知路由、焦点与重连；抽屉的陈旧标记 | #277 `feat(apps): persist the planning field mapping and choose it from the project fields`（L，迭代 7） | 字段映射持久化依赖 #132 的组合根，挂载不依赖 |
| #127（原估 850–1100） | 连接、绑定、解绑命令及其幂等；有效访问快照；第二个启用的规划绑定被拒；绑定仓库时显式关联本地仓库与 GitHub 仓库；绑定 Actions 交付源 | #278 `feat(core): tell credential, permission and project-visibility failures apart on connect`（M，M4.1，挂 #144） | 三类失败的区分属于「访问说明」，demo 走查只验成功路径 |
| #231（原估 900–1150） | GitHub provider 按 head branch 读 PR、提交与评审状态；录制夹具与契约套件 | #279 `feat(capabilities): carry the head branch and review state on change requests`（S，迭代 6；吸收 #198 的剩余部分） | 端口增量字段与平台实现分开，端口先行 |
| #234（原估 750–1000） | 详情抽屉里的谱系条 | #281 `feat(ui): add the delivery view with pull request and CI gate summaries`（M，P1，迭代 8，可砍） | demo 第 11 步只要求详情或交付视图之一可见 |
| #142（原估 750–1000） | 开始工作对话框（仓库、基线、分支名、执行方式），每次提交一个幂等键 | #282 `feat(ui): show the execution context and run state in the work item drawer`（M，迭代 7） | 对话框与上下文展示可独立验收；后者还要给 `ExecutionContextView` 加运行状态 |
| #140 | 不变 | #280 `test(apps): observe the session API a Harness plugin can call to start and read runs`（S，文档，迭代 6） | #225 没有观测宿主会话接口（`docs/architecture/harness-host-spike.md` §11.9） |

另有四个新 issue：

- #275 `chore(project-management): plan iterations 5 and 6 and split the oversized demo issues`（M0.1，本计划的承载 issue）；
- #284 `fix(core): harden Start Work recovery and pull request creation before the first release`（M4.1 的 epic，`Size = 拆分`）：把 #136 下 7 个 M4.1 子项（#138 #141 #174 #193 #200 #206 #215）和 #72 下的 #235 改挂到这里。这样 #136 与 #72 只剩 M4 子项，可以随 demo 关闭，#143 也不会再间接等 M4.1；
- #283 `fix(core): keep the work item identity when a draft becomes an issue during sync`（M4.1，按 H2 的人类裁决新建）：Draft→Issue 没有生产入口，是不变量 I-04 的已知反例（`docs/product/vertical-path.md` §2.1 附行）。

预设切缝：`L` 条目如果设计审查后仍超过 800 行，按下表切。这些切缝只在超门时启用。

| 条目 | 切缝 |
|---|---|
| #221 | 需要新表时，存储层（迁移 + 端口 + 两个适配器）和 core 写者各一个 PR |
| #132 | 组合根与启停一个 PR；重启恢复用例一个 PR |
| #134 | 成员关系删除（端口 + 两个适配器）一个 PR；定时对账与刷新一个 PR |
| #233 | PR 进谱系一个 PR；CI 进谱系与陈旧标记一个 PR |
| #232 | 不拆，用精简夹具控制规模 |
| #277 | 映射持久化一个 PR；从项目字段选择映射的界面一个 PR |

### D4. 依赖边变更

只有「做不了」才建边（`docs/exec-plan/active/2026-09-18-delivery-planning-and-board.md` 的 Decision Log）。

新增：

| 被挡者 | 挡者 | 做不了的证据 |
|---|---|---|
| #132 | #228 | `tests/contract/package-boundaries.test.js` 只允许 `apps/*` 依赖 ui、ui-model、client、domain；宿主组合根落在哪里、包边界怎么放开，要由 #228 的 ADR 先定（#226 评论第 7 条） |
| #127 | #132 | 有效访问快照要先按 implementation key 实例化 provider 再调用 `describeCapabilities`，而 core 不 import 实现 |
| #134 | #220、#199 | #134 验收 4 就是 #220 的修复（`packages/core/src/bootstrap.ts` 无条件 `advanceRevision`）；验收 2 的存储拒绝分支要靠 #199（`packages/core/src/context.ts` 的 `catch {}` 吞掉异常、游标不降级） |
| #276 | #228 | watch 流需要 #228 的宿主服务与 typed remote |
| #229 | #276 | 重连与重拉 baseline 的验收需要 watch 流 |
| #277 | #132、#229 | 映射持久化需要宿主组合根；选择界面挂在 #229 的壳里 |
| #231 | #205、#279 | `tests/contract/suites/development.js` 无条件调用 `createBranch` / `createWorktree`，只读 provider 过不了「按真实能力子集通过套件」；端口还没有 head branch 与评审状态 |
| #234 | #229 | client 没有谱系查询通路，抽屉组件要靠壳挂载 |
| #142 | #127 | 对话框要选「已绑定的仓库」，core 没有仓库列表命令 |
| #282 | #229 | 同上，展示挂在壳里的抽屉 |
| #140 | #280 | 没有观测到的接口无法实现，也无法录制夹具 |
| #278 | #127 | 失败区分在连接命令上做 |
| #281 | #233 | 交付视图读的是 #233 落下的谱系事实 |
| #235 | #219 | `packages/core/src/registry.ts` 只有一个 development 槽位，GitHub 与 Local Git 不能并存 |
| #155 | #273 | 设置页编辑状态策略之前，同步必须先尊重策略 |
| #73 | #284 | R1 第 10 条（Start Work 恢复）的证据在 #284 的子项里 |

删除：

| 被挡者 | 挡者 | 理由 |
|---|---|---|
| #72 | #136 | epic 挡 epic，谱系线没有任何条目依赖开始工作界面；core 的开始工作已经交付 |
| #229 | #131 | 步骤 1–2 的首页挂载改归 #131，收窄后的 #229 不再需要它 |

### D5. 验收补充（覆盖对账的缺口）

上游设计输入的 MVP 验收与 UAT 中，有几条在 demo 路径上，但仓库 issue 的验收里没有写进去：

| issue | 补充 |
|---|---|
| #132 | 重启后执行上下文与谱系关系逐条恢复（一个跨进程用例，同时满足 #28 验收 1）；宿主向 Local Git 注入检出之外的允许根，与 #214 协调 |
| #134 | 没有任何事件时，平台上的字段修改在下一次定时对账后出现；经 core 注入的乱序观察被拒绝；条目移出再加回不换内容身份 |
| #140 | 失败映射改用 `packages/domain/src/errors.ts` 的错误码（原文的 `EXECUTION_FAILURE` 不在词表里）；运行状态可经 `getExecutionContext` 读到 |
| #229 | 同步降级时抽屉显示陈旧标记和最后更新时间，并有经 controller 入口的用例 |
| #233 | 按 head branch 找到的 PR，与同一个 PR 的 PR-backed 项目条目解析为同一个 ChangeRequest；默认策略下 PR 合并不改规划状态 |
| #143 | 走查加四个观察：强制会话启动失败后看到人工降级；断网后列表和抽屉都显示陈旧；重启 Harness 后执行上下文还在；demo 开的 PR 加入项目后只出现一次 |
| #236 | 已知问题至少列出：Draft→Issue 换身份（#283 未交付时）、Development 离线降级、demo 版本之间本地库不迁移（#223）、连接失败不区分三类（#278 未交付时）、重连竞态（#218 未交付时） |

### D6. 迭代 5 · 10-08 至 10-11

**目标**：打下 demo 两条主链的根。插件客户端经宿主服务完成第一次 controller 往返，宿主组合根的包边界由 ADR 定下；交付事实只有一个写者；同域两个研发绑定按仓库路由。

**容量**：4 天，按每天 1.2 个 PR 估约 5 个。承诺 3 个代码 PR 加一份裁决文档，约占 60%；加上追加项约 90%。#228 有宿主侧的未知数（ADR 采纳、真实宿主实测、迁移打包），所以留出余量。

| 优先 | 条目 | Size | 写入范围 | 依赖 |
|---|---|---|---|---|
| P0 承诺 | #228（收窄） | L | `apps/harness-plugin/**`、`tests/contract/package-boundaries.test.js`、`docs/adr/` 新 ADR | 无未满足的边；ADR 采纳需人类 |
| P0 承诺 | #221 | L | `packages/core/src/{delivery,chain-facts,relations,queries}.ts`、存储端口与两个适配器 | 无 |
| P0 承诺 | #219（由迭代 6 提前） | L | `packages/core/src/{registry,context}.ts`、`packages/capabilities/src/{registry,development-provider}.ts` | 无 |
| P0 承诺 | #4 人类裁决 | — | 裁决后回填 `docs/architecture/gate-e1-ruling.md` | 人类 |
| P0 承诺 | #275 本计划 | — | 本文件、`docs/README.md` | 人类批准 |
| P0 追加 | #220 + #199（一个 PR） | M | `packages/core/src/{bootstrap,context}.ts` | 与 #219 同改 `context.ts`，排在它合并之后 |
| P1 追加 | #274 | S | `packages/ui-model`、`packages/ui` | 应在 #229 之前合并 |

移出：#140 移到迭代 7（先做 #280）。

### D7. 迭代 6 · 10-12 至 10-18

**目标**：在 Harness 插件里看到真实工作区。宿主按持久化绑定装配，重启能恢复；watch 流进入客户端；列表与详情挂进插件；同步能定时对账和手动刷新；交付查询只读已提交事实。同时开出 PR 与 Actions 的只读 provider 线。

**容量**：7 天，按每天 1.2 个估约 8 个。承诺 8 项，其中 #205 和 #280 是小条目，折合约 7 个 PR，约占 85%。#220 + #199 如果从迭代 5 溢出，就进入承诺，#232 改为追加。

| 优先 | 条目 | Size | 线 | 依赖 |
|---|---|---|---|---|
| P0 承诺 | #276 | M | 壳 | #228 |
| P0 承诺 | #229（收窄） | L | 壳 | #276 |
| P0 承诺 | #132 | L | 绑定 | #228、#219 已合并 |
| P0 承诺 | #134 | L | 同步 | #220、#199 |
| P0 承诺 | #222 | M | 交付 | #221 |
| P0 承诺 | #205 | S | provider | 无 |
| P0 承诺 | #279 | S | provider | 无 |
| P0 承诺 | #280（文档） | S | 执行 | 需要人类协助启动宿主 |
| P0 追加 | #232 | L | provider | 无 |
| P0 追加 | #231（收窄） | L | provider | #205、#279 |
| P0 追加 | #214 | S | 开始工作 | 与 #132 的允许根协调 |

### D8. 迭代 7–8 预览与 demo 日期

迭代 7（10-19 至 10-25）的 P0：#127、#131、#277、#140、#142、#282、#233、#234、#230，加上从迭代 6 溢出的追加项。这已经超过约 8 个的容量。迭代 8（10-26 至 11-01）的 P0：#143、#236，P1 是 #281。

为了减负已经后移的项：

- #278 移到 M4.1，未交付时写进已知问题；
- #281 降为 P1，可砍；
- #218、#273 留在 demo 之后；
- #213、#207、#211、#212 已交付，关闭；#198 由 #240 交付，剩余部分并入 #279。

即使后移了这些，主链 #228 → #132 → #127 → #131 / #142 → #143 仍有 5 个串行 PR。按每个约 2 天算，#228 必须在 10-11 前合并，#143 才能在迭代 8 开始。demo 日期是 H1，由人类伙伴裁决。

**H1 已裁决（2026-10-07，见 `Decision Log`）**：demo 目标改为 2026-11-08。迭代 8 改为收尾开发并开始走查，迭代 9（11-02 至 11-08）完成走查与上线。迭代 9 在迭代 7 规划时从网页界面添加。

### D9. 放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 新建「父 → 子」两级拆分（例如把 #228 变成 epic，下挂 #228a、#228b） | 层级加深到四级，原 issue 也变成空壳；收窄原 issue 再开一个同级 issue，信息量相同而结构更浅 |
| 把迭代 7 的超载项直接排进迭代 7、指望加速 | 「不靠假设人能做更多来解决容量」；超载要么砍范围，要么延日期，由人类裁决 |
| 把 #143 的依赖边改成直接指向 M4 叶子条目 | 能解决「走查等加固」的问题，但 #136 和 #72 会一直开到首发前，M4 里程碑关不掉；改挂到 M4.1 epic 才同时解决两件事 |
| 修改迭代字段的标题（例如迭代 5 标题里的「Harness 会话」） | 改迭代配置有重建迭代、清空已有赋值的风险（与单选字段改选项同类，见 `docs/project-management/README.md` §3），收益只是标题措辞；目标写在本计划里 |
| 为 #218、#194 加阻塞 #143 的边 | #218 的回滚只在迟到 baseline 的竞态里出现；#194 的反例需要同键不同参数，而对话框每次提交一个新键，demo 路径上不可达。写进已知问题，不阻塞走查 |

## Global Constraints

- 本计划在仓库里只写两个文件：`docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md`（本文件，起草于 `docs/exec-plan/active/`，验收后移到这里），以及 `docs/README.md` 的索引行。
- GitHub 上的写入集合：D3 的新 issue；D3、D5 列出的 issue 正文修改；D4 的依赖边；D3 的父子关系改挂；`Plan of Work` Batch 3 的字段写入与关闭；M4 里程碑的 due date 设为 2026-11-08（H1）。不在这个集合里的写入不做。
- `Status` 和 `blocked-by` / `blocking` 只在人类点名批准后写入；批准原话、actor 与时刻记入 `Decision Log`（`AGENTS.md` §7、`docs/development/repository-rules.md` §3）。issue 的关闭是规划所有者的决定，同样需要批准。
- 不改迭代字段配置，不改单选字段的选项列表，不改看板内置工作流与 view。
- 公开 issue 的标题与正文用英文；标题符合 `<kind>(<area>): <English imperative summary>`，摘要不超过 80 字符；标签为一个 `kind:*`、至少一个 `area:*`、至多一个 `gate:*`；正文按 `.github/ISSUE_TEMPLATE/task.yml` 的五个字段写。
- 发布面：issue、PR 与本文件不写本机绝对路径、本机用户名或主机名、凭据与内部系统；提交前执行 `docs/development/publication.md` 的机械扫描与人工五类目检查。

## Plan of Work

### Batch 1 · 盘点与起草

**最小闭环**：现状、缺口、拆分与两个迭代的计划写成可审阅的文字。
- [x] 读取 Project 10 的字段、迭代配置、168 个条目、81 个 open issue 的正文与评论、里程碑与最近 PR
- [x] 三份只读审计，结论抽查
- [x] 写本计划
**验证**：`grep -c '^## ' docs/exec-plan/completed/2026-10-07-iteration-5-6-planning.md`，期望 13。
**回滚**：删除本文件。

### Batch 2 · 人类批准

**最小闭环**：每一类 GitHub 写入都有点名目标的批准。
- [x] 用一次提问取得 H1（demo 日期）、H2（#283）、H3（写入集合）、H4（#4 的裁决时间）的决定
- [x] 把批准原话、actor、时刻与点名目标写进 `Decision Log`
**验证**：`Decision Log` 里每类写入都有一条人类批准。
**回滚**：不适用（没有外部写入）。

### Batch 3 · GitHub 写入

**最小闭环**：看板状态与本计划一致。按顺序执行，每一步写完就回读：
1. 创建 #275–#284（#283 即 H2 批准新建的那一个），把临时代号回填成真实编号；
2. 收窄或补充 D3、D5 列出的 issue 正文，#261 改标题；
3. 父子关系：新 issue 挂到对应 epic，D3 列出的 M4.1 子项改挂到 #284；
4. 依赖边：按 D4 增删；
5. 字段：里程碑、Priority、Size、Iteration、Gate 按下表写入；
6. 关闭：#213、#207、#211、#212、#198，各附证据评论，`Status` 置 `Done`。

字段写入表：

| 条目 | 里程碑 | Priority | Size | Iteration |
|---|---|---|---|---|
| #228 | — | — | L | 5 |
| #221 | — | — | L | 5 |
| #219 | — | — | L | 6 → 5 |
| #220 / #199 | — | P1 → P0 | — | 5（#199 的 Gate 字段补 E1） |
| #274 | M4 | P1 | S | 5 |
| #140 | — | — | L | 5 → 7 |
| #132 / #134 | — | — | L | 6 |
| #229 | — | — | L | 6 |
| #205 | M4.1 → M4 | P1 → P0 | S | 6 |
| #231 / #232 | — | — | L | 7 → 6 |
| #214 | — | — | — | 7 → 6 |
| #127 / #131 | — | — | L | 6 → 7 |
| #233 | — | — | L | 7 |
| #215 | M4 → M4.1 | — | 拆分 | — |
| #273 | M4.1 | P1 | S | — |
| #261 | M0.1 | P2 | S | — |
| #275–#284 | 按 D3 | 按 D3 | 按 D3 | 按 D3 |

**验证**：`Validation and Acceptance` 的 V1–V8。
**回滚**：见 `Idempotence and Recovery`。

### Batch 4 · 回填与归档

**最小闭环**：本计划记录最终状态，并能被第三方复核。
- [x] 回填 Progress、Outcomes 与真实编号；把本文件移到 `docs/exec-plan/completed/`，更新 `docs/README.md`
- [x] 开 draft PR，`Closes` #275；`gh pr ready` 与合并由人类伙伴决定
**验证**：`node scripts/rule-checks.mjs size origin/main` 的文档行低于 1300；`git diff --check origin/main...HEAD` 退出 0。
**回滚**：`git revert` 本批提交。

## Validation and Acceptance

所有命令都在检出本分支的工作树根目录运行，带 `-R SingularityKChen/harness-projects` 或 `--owner SingularityKChen`。

| # | 验收 | 回读命令与期望 |
|---|---|---|
| V1 | 迭代 5、6 的条目集合与 D6、D7 一致 | `gh api graphql --paginate --slurp` 读 Project 10 的 `items`（查询声明 `$endCursor`），按 `Iteration` 标题筛选；期望迭代 5 恰为 D6 的 8 个条目（#220 与 #199 各算一条），迭代 6 恰为 D7 的 11 个条目 |
| V2 | open 条目没有空字段 | 同一查询筛 open 条目里 Priority、Size、Kind、Area 为空的；期望 0 条 |
| V3 | 新 issue 合规 | 对每个新编号运行 `node scripts/policy-check.mjs issue <n>`；期望全部退出 0。另对 #261 运行，期望退出 0 |
| V4 | 依赖边与 D4 一致 | `gh api graphql` 读每个被挡者的 `blockedBy`；期望 D4 新增的边存在、删除的边不存在 |
| V5 | 父子关系与 D3 一致 | 读 #72、#136、#226、#144、#284 的 `subIssues`；期望 #136 与 #72 下没有 M4.1 条目 |
| V6 | 关闭的五个 issue | `gh issue view <n> --json state,stateReason`；期望 `CLOSED`，且看板 `Status = Done` |
| V7 | #143 只等 M4 | 读 #143 的 `blockedBy` 及各挡者的里程碑；期望全部是 M4 |
| V8 | 本文件结构 | `grep -c '^## '` 期望 13；`node scripts/rule-checks.mjs disclosure origin/main` 退出 0 |

## Progress

- [x] (2026-10-07) Batch 1：盘点、三份只读审计、抽查、起草本计划
- [x] (2026-10-07 约 22:05 CST) Batch 2：人类伙伴批准 H1–H4，原话见 `Decision Log`
- [x] (2026-10-07 22:10–22:40 CST，开发账号) Batch 3：GitHub 写入与逐步回读。
  - 第 1 步：新建 #275–#284，10 个都通过 `node scripts/policy-check.mjs issue <n>`。
  - 第 2 步：改写 16 个 issue 的正文（#228 #229 #127 #131 #132 #134 #140 #142 #231 #233 #234 #143 #236 #136 #72 #144），回读后与写入稿逐字相同（忽略结尾空白）；#261 改标题后 `policy-check` 通过。
  - 第 3 步：建立 15 条父子关系，回读 `parent` 全部命中。
  - 第 4 步：新增 19 条依赖边、删除 2 条，全部 ok。
  - 第 5 步：字段写入 87 次，0 失败；里程碑改 5 个，M4 due date 设为 2026-11-08。
  - 第 6 步：#213 #207 #211 #212 #198 各附证据评论后以 `completed` 关闭，`Status` 由 `Todo` 改为 `Done`。
  - 回读：V3–V7 通过（时刻 2026-10-07 约 22:45 CST）；V1、V2 等 Project 索引追平后判定，见下一条。
- [x] (2026-10-07 约 23:05 CST) V1、V2：`items.totalCount` 追平到 178 后（轮询 7 次，每次间隔 20 秒），迭代 5 的条目恰为 #4 #199 #219 #220 #221 #228 #274 #275，迭代 6 恰为 #132 #134 #205 #214 #222 #229 #231 #232 #276 #279 #280；86 个 open 条目里，Status、Priority、Size、Kind、Area 为空的为 0。唯一没有里程碑的 open 条目是 #135（V1 范围），它不在本计划的写入集合里，归属由人类伙伴决定。
- [x] (2026-10-07) Batch 4：回填真实编号、Progress 与 Outcomes，本文件移到 `docs/exec-plan/completed/`，`docs/README.md` 加索引；draft PR 关闭 #275
- [ ] Batch 4：回填、归档与 draft PR

## Surprises & Discoveries

- **Observation**：标 `M` 的条目交付时普遍到了 800 到 1000 行代码。
  **Evidence**：`Context and Orientation` 的规模口径校准表。
  **Decision impact**：`Size` 改按「实现 + 测试」读（D2），并给 `L` 条目预设切缝（D3）。
- **Observation**：#228 有两处没写进 issue 的范围。一是包边界不允许 `apps/*` 依赖 controller、core、storage；二是插件打包不复制 SQLite 迁移文件，打包后建库会失败。
  **Evidence**：`tests/contract/package-boundaries.test.js` 第 9 行；`packages/storage/sqlite/src/migrations.ts` 的 `MIGRATIONS_DIR`；`apps/harness-plugin/scripts/build.mjs` 不含 migrations。
  **Decision impact**：两者写进收窄后的 #228；#132 改为被 #228 阻塞。
- **Observation**：#143 走查经 #136、#72 间接等待 8 个 M4.1 加固项。
  **Evidence**：#136 的 `subIssues` 里有 10 个 M4.1 条目，#72 下挂着 M4.1 的 #235。
  **Decision impact**：新建 M4.1 epic #284 并改挂（D3）。
- **Observation**：新加入的条目在 Project 10 的 `items` 连接里出现得比 issue 一侧晚。
  **Evidence**：写入后，`items.totalCount` 先读到 171，几分钟后读到 173，而期望值是 178。同一时刻，各新 issue 的 `projectItems(includeArchived:true)` 都显示在 Project 10 里、未归档、`Status = Todo`，字段写入也按 item id 成功。
  **Decision impact**：V1、V2 要等 `items.totalCount` 达到期望值后再判定；在那之前，按 issue 一侧的查询（`blockedBy`、`subIssues`、`projectItems`）核对。
- **Observation**：#213、#207、#211、#212 已经交付却仍 open；#198 的主体已由 #240 交付。
  **Evidence**：`git grep "'main'" packages/core/src` 无命中，用例「无法确定仓库基线时不得由 core 猜测 main」在 `tests/integration/local-git-core-provisioning.test.js`；`getWorktree` 与 `readyGap` 在 `packages/capabilities/src/development-provider.ts` 与 `packages/core/src/execution-context.ts`；`packages/capabilities/src/observation.ts` 在入口拒绝 sha。
  **Decision impact**：请人类批准关闭（Batch 3 第 6 步）。

## Decision Log

| 日期/作者 | 决策 | 理由 |
|---|---|---|
| 2026-10-07 / 计划作者 | 拆分采用「收窄原 issue + 同级新 issue」 | 层级不加深，原编号与讨论保留（D9） |
| 2026-10-07 / 计划作者 | #219 由迭代 6 提前到迭代 5 | 它不被任何条目挡住，又是 #132 的前序（同改 `registry.ts`、`context.ts`）；提前可以缩短主链 |
| 2026-10-07 / 计划作者 | #140 移到迭代 7，先做 #280 | 宿主会话接口没有被观测；没有主执行 provider 时，core 直接走人工降级，demo 不会被它卡死 |
| 2026-10-07 / 计划作者 | #220、#199 升为 P0，合成一个 PR | 两者都是 #134 的硬前置，同改 `bootstrap.ts` / `context.ts` |
| 2026-10-07 / 计划作者（执行 H3） | #212 关闭时如实写明：验收 3 交由 #206，验收 4 交由 #200，两者都在 #284 下 | 交付核对发现 #212 的验收 3、4 依赖仍 open 的 #206、#200；规划稿把 #212 概括成「已交付」偏强。关闭本身已获点名批准，关闭评论按事实写明哪些交出，不在此处另起争议 |
| 2026-10-07 / 计划作者 | provider 线（#205 → #279 → #231、#232）提前到迭代 6 | 只改 providers 与 capabilities 增量，与迭代 6 主线不重叠；否则 #233 最早 10-24 才能合并 |

人类裁决（Batch 2，2026-10-07 约 22:05 CST，人类伙伴在规划会话中通过一次四问的提问作答；actor 为人类伙伴，记录者为本计划作者）：

| 项 | 问题（点名目标） | 人类原话（所选选项） | 执行 |
|---|---|---|---|
| H3 | 「是否批准 ExecPlan Batch 3 的 GitHub 写入集合？包括：新建 9 个 issue；收窄或补充约 15 个 issue 正文；D4 的依赖边（新增 16 条、删除 2 条）；M4.1 子项改挂到新 epic；字段回填；关闭 #213、#207、#211、#212、#198 并把 Status 置 Done；迭代 5–6 的条目在开 draft PR 时由 agent 置 In Progress。」 | 「全部批准 (Recommended)」 | Batch 3 全部执行。问题里的「新增 16 条」指 D4 新增表的 16 行，这 16 行共 19 条边（#134、#277、#231 各有两个挡者）；批准点名的是 D4，所以 19 条全部写入。`Status` 写入的点名范围是 #213、#207、#211、#212、#198 置 `Done`，以及 D6、D7 所列条目（含 #275）在各自开 draft PR 时置 `In Progress` |
| H1 | 「demo 上线日怎么定？」 | 「加一个缓冲迭代，11-08 上线 (Recommended)」 | demo 目标改为 2026-11-08，并写到 M4 里程碑的 due date（H1 的直接投影，已补进 `Global Constraints` 的写入集合）。迭代 9（11-02 至 11-08）在迭代 7 规划时从网页界面添加，本计划不改迭代配置。迭代 8 改为「收尾开发并开始走查」，迭代 9 为「走查与上线」 |
| H2 | 「Draft→Issue 没有生产入口……是否新建承接 issue？」 | 「新建，放 M4.1 (Recommended)」 | 新建 #283（M4.1、P1、不挂父项）。这也回答了发布前收敛计划的待定项 H2：新建，挂 M4.1，不阻塞 #70 或 #134 |
| H4 | 「Gate E1（#4）……什么时候裁？」 | 「迭代 5 内裁 (Recommended)」 | #4 保留在迭代 5。本计划作者在迭代 5 内准备一页决策简报，附证据与选项，并核对 `docs/architecture/gate-e1-ruling.md` §9 的既有裁决；人类裁定后由文档 PR 回填 |

## Idempotence and Recovery

- 字段写入是幂等的：同一个 `updateProjectV2ItemFieldValue` 重放只是写成同一个值。字段与选项 ID 用 `gh project field-list 10 --owner SingularityKChen --format json` 重新取得，不硬编码在别处。
- 新建 issue 不可重放：重跑前先用 `gh issue list -R SingularityKChen/harness-projects --search "<标题> in:title"` 确认它不存在。
- 依赖边：`addBlockedBy` 对已存在的边会报错而不重复建边；撤销用 `removeBlockedBy`（入参字段名是 `blockingIssueId`）。
- 父子关系：`addSubIssue` 带 `replaceParent: true` 改挂；撤销是用同一 mutation 挂回原父项。
- 关闭：用 `gh issue reopen` 撤销，并把 `Status` 写回原值。原值记在本计划的写入日志里。
- 本仓库文件：`git revert`。

**写入前原值（2026-10-07 22:05 CST 读取，撤销时按此写回）**

| 条目 | 里程碑 | Status | Priority | Size | Iteration | Gate |
|---|---|---|---|---|---|---|
| #228 | M4 | Todo | P0 | M | 迭代 5 | ∅ |
| #221 | M2.1 | Todo | P0 | M | 迭代 5 | ∅ |
| #219 | M2.1 | Todo | P0 | M | 迭代 6 | ∅ |
| #220 | M2.1 | Todo | P1 | S | ∅ | ∅ |
| #199 | M2.1 | Todo | P1 | S | ∅ | ∅ |
| #274 | ∅ | Todo | ∅ | ∅ | ∅ | ∅ |
| #140 | M4 | Todo | P0 | M | 迭代 5 | ∅ |
| #132 | M4 | Todo | P0 | M | 迭代 6 | ∅ |
| #134 | M4 | Todo | P0 | M | 迭代 6 | ∅ |
| #229 | M4 | Todo | P0 | M | 迭代 6 | ∅ |
| #205 | M4.1 | Todo | P1 | S | ∅ | ∅ |
| #231 | M4 | Todo | P0 | M | 迭代 7 | ∅ |
| #232 | M4 | Todo | P0 | M | 迭代 7 | ∅ |
| #214 | M4 | Todo | P0 | S | 迭代 7 | ∅ |
| #127 | M4 | Todo | P0 | M | 迭代 6 | ∅ |
| #131 | M4 | Todo | P0 | M | 迭代 6 | ∅ |
| #233 | M4 | Todo | P0 | M | 迭代 7 | ∅ |
| #215 | M4 | Todo | P1 | M | ∅ | ∅ |
| #273 | ∅ | Todo | ∅ | ∅ | ∅ | ∅ |
| #261 | ∅ | Todo | ∅ | ∅ | ∅ | ∅ |
| #213 | M4 | Todo | P1 | S | 迭代 7 | ∅ |
| #207 | M4.1 | Todo | P1 | XS | ∅ | ∅ |
| #211 | M4.1 | Todo | P1 | S | ∅ | ∅ |
| #212 | M4.1 | Todo | P1 | M | ∅ | ∅ |
| #198 | M2.1 | Todo | P1 | XS | ∅ | ∅ |

#261、#273、#274 写入前 Kind 与 Area 也为空；M4 里程碑写入前没有 due date；#261 原标题是 `fix(ci): keep review signals for merged pull requests from failing the Engineering reconcile`。改挂前，#138 #141 #174 #193 #200 #206 #215 的父项是 #136，#235 的父项是 #72。16 个 issue 的原正文可以从各自的编辑历史取回。

## Interfaces and Dependencies

- `gh` CLI，以开发账号 SingularityKChen 认证，需要 `repo` 与 `project` scope；评审账号不参与本计划的任何写入。
- GraphQL mutation：`createIssue` 或 `gh issue create`、`updateIssue`、`addSubIssue`、`addBlockedBy`、`removeBlockedBy`、`updateProjectV2ItemFieldValue`、`closeIssue`。
- Project 10 的字段 ID 见 `docs/project-management/README.md` §3。`Priority`、`Size`、`Iteration`、`Engineering` 四个字段的 ID 还没有同步进该表，这是一个已知缺口。

## Outcomes & Retrospective

- 看板与计划一致：迭代 5 承诺 #228 #221 #219 #4 #275，追加 #220 #199 #274；迭代 6 承诺 #276 #229 #132 #134 #222 #205 #279 #280，追加 #232 #231 #214。
- demo 路径上原标 `M` 的 12 个条目，按「实现 + 测试」重估为 `L`；超出 800 行的 6 个条目，已按能力闭环各拆出一个同级 issue。
- #143 现在只等 M4 的 epic（#124 #226 #72 #136），而这些 epic 下已经没有 open 的 M4.1 子项。M4.1 的加固项集中在 #284 下，#73（R1）被 #284 阻塞。
- demo 目标改为 2026-11-08（M4 due date）。
- 还没有闭合的：迭代 9 要在迭代 7 规划时从网页界面添加；#4 的决策简报在迭代 5 内准备；#135 的里程碑由人类伙伴决定。

## Bottom Change Note

- 2026-10-07：首次创建。迭代 4 结束时，demo 剩余工作的规模被系统性低估；主链根 #228 有未登记的范围；走查经 epic 间接等待加固项；迭代 7 已经超载。这些都需要在迭代 5 开始前重排。
- 2026-10-07：Batch 2–4 完成后归档。人类伙伴批准了全部写入，把 demo 目标定为 2026-11-08，新建 Draft→Issue 承接 #283，并决定在迭代 5 内裁决 Gate E1。
