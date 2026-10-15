# PR #316 MMP 交付评审

评审对象：PR #316，Closes #303、Refs #273。评审账号：Singularity-AI-Bot。本记录覆盖三轮，旧 head 的结论只作历史，不复制到新 head。

## 历史轮次

| 轮次 | head / base | 结论 | 要点 |
|---|---|---|---|
| 1（2026-10-12） | `18982d93` / `ee07c323` | REQUEST_CHANGES | P1：barrier 只代理根 Storage 的 `getPlanningProjection`，没作用到 `tx.getPlanningProjection`，关键断言被跳过 |
| 2（2026-10-12） | `6bf06c8e` / `ee07c323` | REQUEST_CHANGES（P0=0，P1=1，P2=1，P3=2） | P1：`phase === 'tx'` 时先释放状态事务再提交 redacted，`unavailable` 断言不可达；删除生产 redacted guard 的变异在 Fake/SQLite 下存活。P2：交错用例没有让 redacted 在挂起期间提交。P3：计划未写变异表、发布面人工五类目待做 |
| 3（2026-10-15） | `c2014cfc` / `21cb29eb` | 见下文 | 作者按根因重做：D1 事务内原子读-判-写；D2 不可见目标统一 `not_found`；D3 调度探索 + 串行参照预言机 |

## 第三轮：锁定事实

| 项 | 当前事实 |
|---|---|
| head / base | `c2014cfc5094c6307cc48d528da1fdd9f8c8c39a` / `main@21cb29eb27ccc0cc6e0eebe61df6b6ae8c2f5bea`（即当前 main） |
| 状态 | OPEN，非 draft，MERGEABLE，mergeStateStatus=CLEAN；reviewDecision=CHANGES_REQUESTED（第二轮，绑定旧 head） |
| commits | `2d0f5351` fix(core) D1/D2 + controller 用例 → `651afbd2` test(core) D3 竞态证据 → `c2014cfc` docs(exec-plan) |
| threads | 2 条，均已由作者 resolve、均 outdated |
| checks | statusCheckRollup 全部 SUCCESS（PR Fast Gate、Merge Gate 四 lane、Verify、Issue policy、Disclosure、PR size） |
| 规模 | 代码 259 / 1000，文档 346 / 1500 |
| 环境 | Node 26.11.1（`.nvmrc` 26），pnpm 10.28.2 |

## 并集预演

main + 五个开放 PR（#316、#342、#343、#344 → #345）两种顺序：冲突只在 `docs/README.md` 与 `tech-debt-tracker.md`，并集 1678/1678 + 7/7、boundaries 9/9、tsc 0；只合本 PR 1595/1595。本 PR 改的不可见目标错误码与 #344/#345 无交集：Host wire 面只有 `baseline`、`bootstrapWorkspace`、`watch`，`applyPlanningStatus` 不经 Host。

## P0–P3 风险矩阵

| 层 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| 生产代码 | 未见：事务内读-判-写，拒绝分支不写不推进 | 未见：base 上内容复活、head 上拒绝（见下） | 未见 | 未见 |
| 产品闭环 | 未见：MMP Host 不暴露状态命令 | 未见 | **F2** 同一不可见目标两条命令给相反的恢复建议 | 未见 |
| 架构 / 不变量 | 未见：boundaries 9/9，无第二权威源 | 未见 | 未见 | 未见 |
| 测试判别力 | 未见 | 未见：M1/M2/M3/M6/E3 KILLED，E1/E2/E4 保持绿 | **F1** AC3 只有相对判据（S1 存活） | **F3** 夹具无展示字段（R8b 存活） |
| #303 验收 | 未见 | 未见：AC1–AC4 都观测到 | F1 后半：AC3 的解释只在 ExecPlan D3 | 未见 |
| 工作项 / 治理 | 未见 | 未见：没有越权；D2 不属于人类专属裁决 | F2：Start Work 缺口无 issue 也无 TD | **F4** D2 一处理由与事实不符 |
| 发布面 | 未见：disclosure 通过，无本机路径或凭据 | 未见 | **F5** 三个提交与 PR 正文带私有会话链接 | **F6** 提交身份不是开发账号；`2d0f5351` 正文「此前」进 main 后不成立 |

## 上一轮意见逐条复核（按原条件，不只原反例）

| 意见 | 原条件 | 当前 head 结果 | 判定 |
|---|---|---|---|
| R1 P1 | 停点必须真正卡住命令读取；拒绝、revision、redacted 断言可达；旧实现红、新实现绿 | 改为在事务体外的每个调用处枚举停点；防空转断言要求每个 k<N 都 `paused`（实测全部命中）；V4（停点永不触发）被 6 条竞态用例杀死；k=0 到达拒绝分支；M1 被 6 条竞态用例杀死；head 用例在 base 上红 | 成立 |
| R2 P1 | 挂起命令必须读到已提交的 redaction 并拒绝；删除 guard 的变异必须被杀；要有 Fake/SQLite 直接 redacted 负向用例 | 命令 k=0 → 同步提交 → 命令 `not_found`（两适配器实测）；M2 被 8 条 redact 串行用例 + controller「不可见」用例杀死；评审自加 R1–R5、R7 全部 KILLED | 成立 |
| R2 P2 | 要有能证明「旧实现复活、新实现拒绝」的真实交错 | k=0 调度即此交错；M1 KILLED | 成立 |
| R2 P3-a | 计划写变异表、完成后归档 | 变异定义表与 Outcomes 已写入；仍在 `active/`，归档留给合并前收尾 | 部分（收尾时完成） |
| R2 P3-b | 发布面人工五类目 | 机械扫描通过；人工检查发现 F5、F6 | 部分 |

## 分层检查

### base / head 反例

命令在第一次 `transaction` 前停住，同步提交 redact 或 remove，再放行命令，两适配器各跑：

- base `21cb29eb`：命令调用序列 `getPlanningProjection, getWorkspace, transaction`；redact 复现 `work_item → redacted → work_item`，remove 下已移除的行被复活；`wrote:true`，工作区 revision 推进到 3。
- head `c2014cfc`：调用序列 `transaction`；`{wrote:false, status:'unknown', code:'not_found', retryable:false}`，行保持 redacted 或缺失，revision 停在 2。
- head 的 `status-policy.test.js` 放到 base 上：6 条竞态 + 8 条 redact 串行用例红（`command k=1/3：交错结果必须等于某个串行顺序的结果`）。

### D3 机制

三个场景 × 两适配器逐调度打印：命令 1 个抢占点（`transaction` 入口），同步 2 个；C S1 S2、S1 C S2、S1 S2 C 三种原子单元顺序全覆盖；无未归属调用；AsyncLocalStorage 在 SQLite 同步 API（经队列包装）与 Fake 上都可靠。V6（只探索命令）下 E3 存活，说明对同步 actor 的探索是承重的。稳定性：串行连跑 12 次、8 路并行各 3 次全绿。

### D2 公共行为（PR 正文「Please confirm this result」）

评审确认 D2：`packages/capabilities/src/result.ts:42` 定义 `not_found` 为「不存在，或对当前凭据不可见」；controller 重放账本按幂等键缓存失败、与 `retryable` 无关（`commands.ts:216-218`），所以 `retryable:false` 正确；`retryable` / `recovery` 在生产代码无读取方，`applyPlanningStatus` 在 client、ui、apps 无调用方。相对 main 的真实变化：redacted 目标在 host / manual 策略下由「写入成功」变为拒绝；`source_managed` 下由 `not_supported` 变为 `not_found`；缺失目标文案改为固定句。#303 Scope 明确让本 PR「define the stale-command result」，不属人类专属裁决。

### F1（P2）：AC3 只有相对判据

预言机只要求每个调度等于本实现两种串行顺序之一，refresh 场景的两个串行参照本身没有绝对断言（新标题保留、sync→command 下状态为 done、目标行 revision 等于工作区 revision）。变异 S1（`bootstrap.ts` `commitSync` 在状态分歧时保留旧 content，即同步丢掉可见刷新）在 head 全量与 base 全量都存活——main 既有的同步测试缺口，#303 AC3 的证据正好落在这里。当前行为正确（command→sync：`{title:'刷新后的标题', status:'todo', rowRev:3, wsRev:3}`；sync→command：`status:'done'`，其它行停在 2）。AC3 的解释（#273 裁决前 command→sync 下 Host 状态被 provider 覆盖也算允许结果）只在 ExecPlan D3，PR 正文未写。

### F2（P2）：Start Work 缺口无追踪

`packages/core/src/start-work.ts:119` 对 redacted 目标返回 `unavailable`（retry、retryable=true），钉在 `tests/integration/start-work-sqlite-registration.test.js:120` 与 `docs/product/vertical-path.md`。本 PR 合并后同一不可见目标：状态命令说去平台处理，Start Work 说原样重发。ExecPlan 第 208、256 行「待人类伙伴确认后开」未勾；6 组关键词检索与 #136/#141/#142/#193/#194/#284/#304 正文评论都没有登记；tracker 无对应 TD。

### F5（P2）：私有会话链接进入发布面

三个提交各有一行 `Claude-Session:` 尾行（指向会话服务里的私有对话链接），PR 正文末行同一链接；main 全历史与其余四个 PR 为 0。`rule-checks disclosure`（含 `PR_BODY`）仍通过——扫描器没有这个模式。链接指向账号下的私有对话（`docs/development/publication.md`「账号与个人信息、内部系统」），rebase merge 后进入 main 永久历史。

## 变异表（head `c2014cfc`，status-policy + controller-roundtrip 两个 e2e，另注全量）

| id | 改动 | 结论 | killedBy |
|---|---|---|---|
| M1 | 两函数整体换回 base 实现 | KILLED | 6 条竞态 + 8 条 redact 串行 + controller「不可见」 |
| M2 | redacted 判定改为 `false` | KILLED | 8 条 redact 串行 + controller（竞态用例不杀，设计如此） |
| M3 | 事务前根实例预读 | KILLED | 6 条竞态 |
| M6 | 读写拆成两个事务 | KILLED | 6 条竞态 |
| R1 | 可见性用事务前陈旧预读 | KILLED | 竞态 redact |
| R2 | 事务内先写后检查 | KILLED | redact 串行 + controller |
| R3 | 只删 missing 判断 | KILLED | controller + remove 串行 / 竞态 |
| R4 | 缺失拒绝不带 error | KILLED | controller + remove 串行 |
| R5 | 策略先于可见性 | KILLED | controller |
| R6 | redacted 判定改为「title 缺失或为空」 | SURVIVED | 域内等价，不定级 |
| R7 | 放过 deleted reason | KILLED | controller + deleted 串行 |
| R8b | planningFields 取陈旧预读（避开键存在性差异） | SURVIVED | —（F3） |
| R9 | 成功写入清空 planningFields | e2e 下存活，+integration KILLED | github-projects-bootstrap、sync-revision-freshness |
| E3 | 错误的 #273 修法 | KILLED | 竞态 refresh ×2 |
| E1 / E2 / E4 | 等价读 / 正确 #273 修法 / 无害根读 | 保持绿 | 符合期望 |
| V1 / V4 | 被停 actor 不打标签 / 停点永不触发 | KILLED | 6 条竞态 |
| V6 | 只探索命令 actor | 保持绿；其下 E3 存活 | 同步 actor 探索承重 |
| S1 | 同步在状态分歧时丢掉内容刷新 | SURVIVED（head 全量与 base 全量） | —（F1） |

## 命令与结果（head）

#303 AC4 命令组 224/224，`tsc --noEmit` exit 0；`pnpm verify` exit 0（typecheck、test 1595/1595、MVP-0 7/7）——作者沙箱未跑通的一步在本机跑通；workflow-check 无发现；disclosure、size、`git diff --check` 通过；boundaries 9/9；逐提交：`2d0f5351` 两个 e2e 23/23，`651afbd2` 39/39。

## 结论

第三轮 P0 = 0，P1 = 0，P2 = 3（F1、F2、F5），P3 = 3（F3、F4、F6）。上一轮两条 P1 按原条件成立。APPROVE，并在评审中确认 D2；进入修复：F1 给 refresh 串行参照加绝对断言并把 AC3 解释写进 PR 正文；F2 开 follow-up issue 并回填 D4；F5/F6 整合提交时去掉会话链接、统一为开发账号身份、改写「此前」一句；F3/F4 就地修。

## 第三轮修复与复评（2026-10-15）

按评审流程（只剩 P2/P3），评审会话负责修复：修复由评审会话派出的实施者完成，修复本身另派独立复评，共两轮。

| 意见 | 处置 | 证据 |
|---|---|---|
| F1 AC3 只有相对判据 | refresh 的两个串行参照加绝对断言（Fake / SQLite）：两种顺序都保留新标题与新展示字段，目标行 revision = 工作区 revision = initial+2，其它行内容不变，sync→command 为命令值；command→sync 允许 provider 值或命令值（#273 裁决前） | S1 由存活变为被杀；E2（正确的 #273 修法）保持绿；只写死 `todo` 的副本会让 E2 变红 |
| F2 Start Work 缺口无追踪 | 开 #349，D4 与 PR 正文引用；复评后给 #349 补「可见性检查与登记写入同一事务」验收（Start Work 同形 TOCTOU） | #349 回读 |
| F3 夹具无展示字段 | 工作项带 `nativeValues`（状态、迭代、目标日期），refresh 改目标日期 | R8b 由存活变为被杀 |
| F4 D2 理由与事实不符 | 改写理由，结论不变 | `planning-fields.ts:48-49` 先判 `nativeValues` |
| F5 / F6 发布面 | 整合时去掉三个提交与 PR 正文的 `Claude-Session:` 链接，作者 / 提交者统一为开发账号，改写 `2d0f5351` 正文「此前」一句 | 整合后回读 |
| 复评 N1 夹具改走 `nativeValues` 后 R10 在本文件存活 | REFUSALS 加「redact（statusKey 分支）」变体；加正向用例「可见但状态选项未映射（unknown）的条目照常写入」 | R10 由存活变为被杀；E2 保持绿 |
| 复评 N2 `killedBy` 子串归因含糊 | 参照用例改名「参照 refresh」，命名约定改为竞态 / 串行 / 参照三类三词 | V-ADV2 用 `killedBy: 串行` 报 KILLED_OTHER |
| 复评 N3 两适配器在同步覆盖状态上可分歧 | main 既有，登记到 #201 | V-E2F 四层全量存活 |
| 复评 N4 #349 开立依据 | Decision Log 记开立依据（用户为本会话给定的评审流程），不写成人类单独确认 | — |

修复后读数（整合前 head `4d1f411d`）：`pnpm verify` 1601/1601 + 7；#303 AC4 命令 230/230，`tsc --noEmit` exit 0；size 代码 324 / 文档 378；`--test-name-pattern=参照` pass 2、`竞态` pass 6、`串行` pass 14。最终树上的变异表在整合后重跑，结果写入下一节。

### 整合后最终树（评审会话复核）

整合为三个交付物提交（`fix(core)` → `test(core)` → `docs(exec-plan)`），tree 与整合前 fixup 序列相同、文件集合相同；作者与提交者为开发账号，正文无会话链接、无以 `#` 开头的行。最终树上：`pnpm verify` exit 0；逐提交 `tsc --noEmit` + 两个 e2e 文件：23/23、45/45、45/45。变异整表（`scripts/review-mutate.mjs`）：R10、M2、S1、R8b、M3、M6、E3 均 KILLED，归因与上表一致；E1、E2 保持绿（允许结果）。
