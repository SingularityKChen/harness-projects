# PR #404 MMP 交付评审

> 状态：初评完成；2026-10-26 冻结修复树独立复评 PASS，R404-1 已关闭，无新增意见。复评方只更新本记录，未修改产品代码或永久测试。
> 日期：2026-10-26；执行上下文：检出 `feature/plugin-workspace-setup` 的工作树根目录（`.worktrees/plugin-workspace-setup`）。

## Purpose / Big Picture

判断 #404 是否交付 #131 的单工作区创建、连接 GitHub Project 和进入工作项列表闭环，并验证失败时的反馈和恢复。评审要求保留 Host 权威、Provider 确认边界和来源身份，不用单元测试或历史截图替代真实宿主证据。

## Context and Orientation

- Head：`eeed01a4e8d04c27ef12a5ab2045d00338278bc4`；Base：`feature/host-recomposition` / `d74212ff4199d7c0475d1966f627f88486e14e0d`。
- 2026-10-26 锁头快照：Open、Ready、mergeable；已有 review、完整分页的 review thread 均为空。`PR Fast Gate`、CI Verify、Merge Gate 及各 lane、Issue policy、size/disclosure、CodeQL 均成功；`Create review session` 失败属于可选评审会话入口，具体远端原因由协调者收齐，不把它当作代码失败。
- 评审账号为 `Singularity-AI-Bot`；开发写入账号为 `SingularityKChen`。本子评审只读远端，不提交 review、issue 修改、commit 或 push。
- #131 scope 是单工作区；三路失败分类属于 #278，仓库 UI 属于 #356，完整 settings 属于 #155。#202 / #368 承接来源切换 / 解绑，不能把本层既有拒绝切换重新定为新增问题。
- 方法：Superpowers 独立评审；Qian Systems Router 的接口、反馈和整体闭环；First Principles Development 的事实 / 硬约束 / 假设区分及最小反例。

## Design / Spec

### 预先风险矩阵

本矩阵在逐文件审查前建立；风险是假设，下表末列是逐项核查后的证据结论。

| 级别 | 代码与反例 | 产品闭环 | 架构与状态拥有 | 最终证据 |
|---|---|---|---|---|
| P0 | 数据破坏、泄密、合入破坏 main | 未确认写入冒充 Saved | 第二权威源、规划轴被工程轴覆盖 | 未发现；设置只写本地事务、DTO 只出 allowlist、安全固定错误文案 |
| P1 | 并发、重试、冷恢复、失败路径 | 主路径不能完成或结果不可信 | 身份、租约、持久化、信任边界 | 未发现；真实 SQLite/remote/source 测试、旧读 fence 和 viewer 重核均成立 |
| P2 | 可恢复边界、诊断不足 | 失败后恢复动作不准确 | 局部状态合同混合 | R404-1（初评；已修复，见修复独立复评）：reconcile 失败被标成 read，下一次重试只读旧状态，额外一次点击后恢复 |
| P3 | 易读性、维护性、证据表述 | 小文案与展示问题 | 无行为影响的一致性 | 未发现需要单独提出的新项；历史阶段文字已标注 superseded |

### 分层检查结论

| 层 | 核查路径与结果 |
|---|---|
| Host 读面 | `apps/harness-plugin/src/host-composition.ts` 的 setup 读面固定 Host workspace scope；SQLite 配置 + active fingerprint + baseline freshness 决定状态。初次存储读失败返回 null+error，client 不把它当空库；binding/project 缺失不能 confirmed。 |
| 并发与激活 | setup read 与 baseline 共用 barrier、epoch 和 assembly lease；真实 create/旧空读竞态与晚读等待均覆盖。local_only 是本地配置，activationError 独立保留；同键 bind 可重新激活。 |
| client 状态 | `packages/client/src/workspace-setup.ts` 只缓存 DTO 和提交 intent；同 payload pending 共用 Promise，unknown / outer throw 保同键，合法 failed/conflict 推进相应 stage attempt；dispose 阻断续 bind 和晚发布。 |
| 身份 | 每次 connect 先调用 Host connectAccount，同 account 子键仍先 GET /user；viewer 改变时 conflict，不能直接复用旧 accountId 继续 bind。 |
| UI 与导航 | `packages/ui/src/workspace-setup.ts` 从 loading、create、summary、connect 到 list；confirmed + 相同 workspace id watch 才进列表。草稿保留、pending 禁用、label/alert、标题焦点和返回设置均有断言。R404-1 是唯一新增问题。 |
| 架构与发布面 | UI 不 import Provider，client 不依赖 React，Host 保有权威配置；runtime 依赖未新增，产物不含 Host/Storage 到 browser 的反向边。机械 disclosure 与人工五类目检查没有发现新泄露。 |
| 产品验收 | #131 四项正文验收与追加的阶段失败新键要求都有对应证据；见 Validation and Acceptance。|

### R404-1 · P2 · 区分规划刷新失败和设置读取失败（已修复）

以下为初评原始反例。Superseded by Outcomes & Retrospective「2026-10-26 修复独立复评」（2026-10-26）；当前冻结修复树已通过同一触发链。

**位置 / 当前 diff 新增行**：`packages/client/src/workspace-setup.ts:125`；关联 UI 分发为 `packages/ui/src/workspace-setup.ts:24`。

**触发**：已配置项目的初次或后续同步是 degraded/unavailable；用户点“重试”执行 `refresh(true)`，该次 `refreshPlanning` 仍失败，随后 `getWorkspaceSetup` 成功返回 degraded。`refresh(true)` 使用 `run('read', ...)`，把前一个命令错误保存为 `failure: 'read'`。网络恢复后再次点“重试”，UI 的 read 分支只执行 `refresh()`，不发 `refreshPlanning`。

**实际影响**：第二次点击只读取仍是 degraded 的本地游标，用户看不到恢复；再点一次才重新执行规划刷新并进入 confirmed。自动调度也可恢复，因此不是主路径永久阻断，定为非阻塞 P2。

**当前树反例**：以 `harness-plugin-workspace-setup.test.js` 的真实 Host / SQLite / remote / replayFetch 构造单工作区和有效 Project；禁用实际 interval（测试 timers），用 503 造成持久 degraded。挂真实 `createWorkspaceSetupSource` 与 `WorkspaceSetupGate`，第一次点击“重试”仍 503，然后恢复 replayFetch 并第二次点击。观测为 `refreshes=1, reads=3, state=degraded`；第三次点击才 `refreshes=2, state=confirmed`。同机制的窄 source/UI 反例与真实 Host 反例均已运行，协调者独立复现。

**根因与最小方向**：在 `WorkspaceSetupSnapshot.failure` 及 `run` kind 中新增 `reconcile`。`refresh(true)` 使用 `run('reconcile', ...)`；`refresh(false)` 仍为 `read`。`run` 开始后 action 抛出或合法命令失败保留 reconcile，真正后置 `read()` 抛出 / null+error 仍归 read。UI 给 reconcile 失败分支执行 `refresh(true)`。这样既能重发真正失败的刷新，也保留“设置 transport 读取失败只重读，不重提 create/connect/reconcile”的已有约束。

**应扩展的永久测试**：扩展 `tests/contract/ui-workspace-setup.test.js` 的 “degraded read without activation error has a reconcile action” 为先失败、后恢复、连续两次实际按钮点击，断言每次点击增加 planning refresh 次数，第二次即 confirmed；另保留并扩展 “cached unbound and confirmed read failures retry only setup read” 负控，覆盖 reconcile 成功但后置 setup read 失败时只能重读。真实 Host 层可扩展 `tests/integration/harness-plugin-workspace-setup.test.js` 的 degraded/refresh 用例，避免把错误来源区分只留在 fake port。

**重复追踪核查**：#360 当前 scope 是工作项列表刷新入口和 last-confirmed 展示，未涉及 setup recovery 的 failure 分类；#278 是凭据 / 权限 / 项目可见性分类。两项均不覆盖本反例。没有另开 issue，修复交协调者按评审收尾流程执行。

## Global Constraints

本轮写入集合仅为本评审记录；临时反例和变异 spec/log 在运行目录，不提交仓库。禁止修产品代码、修改测试、commit、push、远端 review 或规划字段。变异仅由 `scripts/review-mutate.mjs` 临时替换，并逐字节还原；不以 Git checkout 还原。

## Plan of Work

### Batch 1 · 锁头与全矩阵审查

最小闭环：锁定当前 head/base、线程与 checks，再审查全部 18 个变更文件及其相邻权威状态实现。步骤已完成；只生成本记录。失败回滚为停止给出结论，继续补证据，不改产品。

### Batch 2 · 窄验证、反例与判别力

最小闭环：正常 / 失败 / 恢复路径验证、当前树变异表、真实 S3 来源审计及 issue scope 对齐。命令与输出见下一节。变异失败由 harness 自动还原原始字节；临时反例不写入仓库测试集。

## Validation and Acceptance

以下命令在上述锁定 head 的工作树根目录执行：

```text
node --test --test-timeout=120000 tests/contract/ui-workspace-setup.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-setup-client.test.js
# 当前实际：36 tests / 36 pass / 0 fail
node --test --test-timeout=120000 tests/integration/harness-plugin-artifact.test.js tests/contract/package-boundaries.test.js
# 当前实际：33 tests / 33 pass / 0 fail
pnpm run typecheck
# 当前实际：exit 0
node scripts/rule-checks.mjs disclosure d74212ff4199d7c0475d1966f627f88486e14e0d
# 当前实际：exit 0；base新增行、逐提交新增行和commit message机械扫描通过
node scripts/rule-checks.mjs size d74212ff4199d7c0475d1966f627f88486e14e0d
# 当前实际：代码715/1000行、文档224/1500行，exit 0（不含本未提交评审记录）
```

Git 检查使用 Python `subprocess.run(argv)`：`git diff --check <base>...HEAD` 和 `git diff --exit-code` 均退出 0；变异后已确认产品树无 tracked 差异。全量 verify 不在本子评审重复运行；当前 head 的远端 Verify 成功和作者 1983+7 项历史记录只作为各自层级证据，不称本轮亲跑全量。

| #131 验收项 | 当前核查证据与边界 |
|---|---|
| 创建工作区可见且能继续；拒绝后无半成品 | Host 真实 SQLite 的 blank create 为 failed、workspace null；同键并发后恰好一行；source/UI 显示唯一摘要和继续入口 |
| 连接失败有结构化错误与恢复动作 | DTO固定安全文案、各 recovery 映射、无自动动作时的指引均覆盖；存在 R404-1 的一次额外点击缺陷，非阻塞 |
| 宿主内完成步骤1–2并记录#124 | 已审计原始S3记录，见下段；没有本轮重新点击宿主的声称 |
| 双提交复用幂等键且仅一工作区 | source pending Promise、unknown丢外层响应同键重放、真实setup/SQLite一行均覆盖 |
| 追加验收：确定拒绝后新阶段键 | 真 `createSetupCommands` 账本下，failed/conflict 后下一次 stage attempt 重新执行；unknown/畸形/activationError 保原键 |

### 当前树变异表

使用 `node scripts/review-mutate.mjs <spec.json>`；spec 的 command 为 `node --test --test-timeout=10000 tests/contract/ui-workspace-setup.test.js tests/integration/harness-plugin-workspace-setup.test.js`。每项都有 `killedBy`，整表一次运行；基线和还原后基线均绿，7/7 精确 KILLED，无 KILLED_OTHER、SURVIVED 或 NOT_APPLIED。

| 变异 | 故意破坏的属性 | killedBy（用例名片段） | 结果 |
|---|---|---|---|
| M1 | null+error 当作空库发布 | Host null read error | KILLED |
| M2 | 每次同 payload 铸造新 intent | double create shares | KILLED |
| M3 | 确定失败后不推进 stage attempt | real setup replay retries definitive failures | KILLED |
| M4 | 非local_only账号结果继续bind | account non-success states never bind | KILLED |
| M5 | dispose后继续bind | dispose absorbs late rejection | KILLED |
| M6 | 省略watch workspace id门 | real source renders labeled creation | KILLED |
| M7 | 省略Host epoch/assembly读fence | setup reader fences captured empty | KILLED |

### 真实宿主证据审计

原执行记录为 2026-10-26 的 Harness `0.2.0-rc.2` web profile，候选源码 `35693c4985d09a1f2dba5a3ef607ee28d3c97f51`。本轮重新计算该记录冻结的15个产品/测试文件哈希，与当前 head 全部相同；tarball SHA-256 为 `a9b8a71e6b40b5f214dd23f7c90c0930152658beb27061cdc3537d29e909a7c2`，本轮核算匹配；12个安装文件逐字节匹配tarball。沙箱前后规范化快照逐字节相同，SHA-256 为 `37fe5b017d8188bab83b760d76c5b598dff6763a2e6e9f6cb2899dd8ca97337a`。

只读 SQLite 复核为1工作区、1启用 planning binding、1已提交完整轮。已查看原始 confirmed/list 截图：插件内显示9个工作项、来源、derived映射和当前快照。原记录的同一 PID、真实 viewer匹配、只存句柄、native workspace在scratch documents下均保留其历史证据级，未声称此刻进程仍存活或本轮亲自点击。外部#124记录actor/target/idempotencyKey及readbackMatches可对应作者证据。未外推到Desktop、其他版本、真实模型、网络中断或#230完整安装矩阵。

## Progress

- [x] 2026-10-26：锁定head/base、全部变更文件、#131正文及追加验收。
- [x] 2026-10-26：完成代码、产品、架构、测试、工作项全矩阵，不因发现R404-1提前收工。
- [x] 2026-10-26：69项窄测试、typecheck、边界、artifact、机械门禁通过；7/7变异精确KILLED并还原。
- [x] 2026-10-26：R404-1窄反例、真实Host反例及协调者独立复现；S3证据源与当前源码一致性核验。
- [x] 2026-10-26：完成本地评审记录并回传；远端一次性review与修复由协调者执行。

## Surprises & Discoveries

R404-1暴露现有测试只验证第一次reconcile按钮会发起刷新，未覆盖“reconcile失败后用户再点一次”。原先将一切refresh都叫read的实现，不能表达同一个方法内的两种失败来源。旧读fence、null+error、unknown同键重放、确定失败stage attempt等高风险路径具有判别性测试，没有在本轮找到第二条独立缺陷。

## Decision Log

- 2026-10-26 / 独立子评审：R404-1定P2、建议APPROVE。依据：可由额外点击或调度恢复，无写入丢失、越权、假Saved或主路径永久阻断；恢复按钮仍有具体行为缺陷，不能以绿测试忽略。
- 2026-10-26 / 协调者：要求先汇总一次性APPROVE review，再由协调者修复产品；子评审不并行修同一分支。
- 2026-10-26 / 独立子评审：来源切换和三路诊断不重新定为本层缺陷，遵守#131当前scope；#360与本问题不重复。

## Idempotence and Recovery

锁头、查询、窄测试和反例可重复执行。mutation harness在每项后和结束时逐字节还原；已用tracked diff为空验证。发现head变化时本记录判断失效，重新锁头；没有在远端写入，故无远端回滚动作。R404-1修复后重跑目标测试和读错误负控，再独立复评。

## Interfaces and Dependencies

依赖现有Node测试、pnpm/typecheck、review-mutate harness、SQLite、remote/source/UI接口和只读评审账号。外部读取仅用于已有PR/issue事实；没有凭据值进入本记录。跨Provider关联、规划Status与关系均不更改。

## Outcomes & Retrospective

初评锁定head未发现P0/P1；全部可复现新意见为R404-1一条P2，建议APPROVE。Superseded by 本节「2026-10-26 修复独立复评」（2026-10-26）：该意见已在冻结修复树关闭。初评未亲跑全量verify、未重新在真实宿主点击，已经明确证据边界；不转移scope或新建追踪。


### 2026-10-26 修复独立复评

复评对象为 `eeed01a4e8d04c27ef12a5ab2045d00338278bc4` 加协调者冻结的未提交修复：`WorkspaceSetupSnapshot.failure` 与 `run` kind 增加 `reconcile`，`refresh(true)` 以该kind执行；UI代码未改。冻结校验SHA-256：client setup源 `a31a63041d1602c6c5a0335a291e38b1342f26c76b5654e3b945bbab25d57e84`，setup契约测试 `92cec976443b407e0baa6351e23dcbf515e9e2d56acac1f649fcce843585b23a`。复评期间产品与永久测试冻结；计划临时回到active的改动属于协调者，复评方没有归档或提交。

**根因结论**：修复成立。合法reconcile失败及action抛出均保留reconcile来源；`run`在action后读取setup前仍切换局部failure为read，因此真正setup读失败不会错误重发planning命令。当前UI可达的degraded恢复路径会重新执行`refresh(true)`，无需改动UI；create/connect、unknown key、pending与dispose路径保持其原控制机制。已搜索client/ui-model/ui/plugin的全部snapshot failure消费者，没有遗漏的穷举消费者或新增权威状态。

**永久回归**：新用例 `failed planning reconcile retries planning after recovery instead of only rereading degraded setup` 逐一覆盖结构化failed和throw，服务恢复后下一次实际UI按钮点击即confirmed、planning refresh计数为2；缓存setup读取失败负控扩为unbound、confirmed、degraded，仍只重读。

**实际验证命令与结果**（同一检出的冻结修复树）：

```text
node --test --test-timeout=120000 tests/contract/ui-workspace-setup.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/harness-plugin-setup-client.test.js tests/integration/harness-plugin-artifact.test.js tests/contract/package-boundaries.test.js
# 70 tests / 70 pass / 0 fail；7 suites
pnpm run typecheck
# exit 0
node scripts/review-mutate.mjs <final-spec.json>
# 基线及还原后基线均绿，8/8精确KILLED，exit 0
```

最终变异整表为初评M1–M7全部重跑，再加M8：把`run(reconcile ? 'reconcile' : 'read', ...)`恢复为`run('read', ...)`，`killedBy`精确指定上述新回归完整用例名。M8只有该用例失败；其余七项也均由原归因用例KILLED，无SURVIVED、NOT_APPLIED或KILLED_OTHER。运行结束后重新计算四个涉及变异的产品/测试文件哈希，与冻结前逐字节匹配，`git diff --check`退出0。

**真实Host反例复验**：沿用初评真实Host/SQLite/remote/source/UI、503与禁用interval条件，将期望改为正确行为。服务恢复后的第二次点击观测为`refreshes=2, reads=3, state=confirmed`，错误清空。另加边界：reconcile成功后刻意让setup read抛错，failure为read；下一次按钮点击只getWorkspaceSetup，planning refresh计数保持3，错误清空。两段均通过。此为离线真实Host组合验证，不声称重新运行Harness web S3。

**证据边界与收口**：初评S3 tarball/source一致性仍只对应初评锁定源码，不能称冻结修复树与该tarball逐字节相同；本次client source变化经当前artifact构建测试、窄回归和真实Host反例验证。当前未发现P0/P1/P2/P3新意见，R404-1关闭，独立复评PASS。允许协调者按既有授权归档计划、整理提交与最终远端回读；合并仍由人类决定。

## Bottom Change Note

2026-10-26：在预建P0–P3矩阵上完成独立全矩阵审查、69项窄验证、7项变异与S3来源审计；补入R404-1的真实Host复现、最小状态区分方案和非阻塞结论。

2026-10-26：补入R404-1根因修复独立复评，70项窄验证、8项最终变异全表和真实Host恢复及后置read失败负控；关闭R404-1，保留初评历史及S3源码边界。

### 整合后的联合验证

- 2026-10-26：在包含已合并 #402 与更新父层的产品树 `342e4c471d0d4ec7568497fd045dd42e8389499f` 上，`pnpm --filter @harness-projects/app-harness-plugin pack:plugin` 和 `pnpm verify` 均 exit 0；typecheck、2014 主测试与 MVP 7 项全部通过。相对首轮批准并集，产品/测试只改 client 失败分类、恢复测试和父层并发测试三个文件。随后仅补本次文档记录，不改产品/测试；最终 head/base 与 checks 由远端回读锁定。
- 当前本地打包件 SHA-256 `3de36375fd03be653519c5f6cda7f4bc0a2f981023020b373153aa887f2f499e`；只证明当前构建成功，不把它当成原 S3 tarball 的实际安装证据。
