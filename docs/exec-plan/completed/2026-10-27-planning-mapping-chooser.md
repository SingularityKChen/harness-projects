# 规划字段映射选择 ExecPlan

> 状态：Completed（本地能力验收完成；发布门禁按下列命令回读）
> 创建：2026-10-27（Asia/Singapore）
> 范围：#358 的定义驱动 chooser、Host 本地命令及同进程激活闭环
> 规范：根 `PLANS.md`；分支 `feature/field-mapping-chooser`；基线观察 `2026-10-27 @ b164a211b0b0d9669724dc794c2fe32896c4eed0`

## Purpose / Big Picture

用户在插件设置中从当前项目的字段定义选择状态、迭代和目标日期字段，并为状态选项选择规范状态。保存后不用重启 Host，列表和已打开的抽屉采用同一映射；未映射选项仍显示原生名称和“未映射”。最小成功证据是 Host 级测试通过真实 remote 命令改变映射后，既有列表和抽屉都更新，Provider 写方法调用数为零。

本计划只交付 #358。#277 已交付持久化和启动装配；本批复用它，不另建映射存储。#226 / #124 仍要求完整宿主安装、重连及 vertical-path 走查，不能由本 PR 自动关闭。

## Context and Orientation

事实：`packages/domain/src/planning-fields.ts` 定义 `WorkspacePlanningFieldMapping` 和闭集形状验证；`packages/capabilities/src/storage.ts` 的 mapping record 以 workspace/binding/project 标识作用域并记录 `origin`。`apps/harness-plugin/src/host-composition.ts::loadPlanningMapping` 恢复 user 映射，否则从字段定义派生默认值。

事实：基线映射在 Core 组合时取快照；基线 `fingerprint()` 不含映射，单独保存不会使运行中的 Core 改变。Superseded by Progress（2026-10-27）：本批已纳入映射，并在候选 bootstrap 后记录实际 fingerprint。`configure()` 已拥有命令串行、在途 lease 排空、候选激活和失败保留机制。`composeCore` 的 Planning bootstrap 已执行一次读取和重投影，不能为了“刷新”无条件再做相同读取。

事实：`apps/harness-plugin/src/host-operations.ts` 是零运行时依赖的操作唯一声明；client setup source 已有结构化错误解析和稳定 intent key。UI 仅可持有表单 intent，Host 拥有有效映射及规划投影。

上游依据：issue #358 三条 AC、`docs/exec-plan/completed/2026-10-05-project-field-read.md`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`。两个独立研究者分别提出方案后，本计划作者用 First Principles 的状态拥有与反例、Qian 的端到端闭环审阅修订，选定现有重组路径，并补足保存成功但读取未确认的分层结果。

假设：本批项目定义规模适合在打开 chooser 时按需读取；没有证据支持定义缓存或离线全量重投影。主要风险是配置已经保存而投影未确认，不是表单样式。

## Design / Spec

新增 `getPlanningMapping()`，Host 从当前组合取得 workspace、启用的 Planning binding 与 project，返回安全 DTO：scope、当前 mapping、origin、字段 id/name/kind 和 single-select 的 option id/name。Assembly 仅暴露窄 mapping helper，闭包捕获该代经 lifetime 包装的 Planning port；query 经现有 read/lease，setter 在 configure 已排空 lease 的 run 内直接用 helper，不持自己的 read lease 再等待 configure，也不在 barrier 内重入 read()，避免自等。定义读取沿现有 Planning lifetime / timeout；loading、无字段和读取失败必须可区分，失败不能伪装为空数组。

新增 `setPlanningMapping(actorRef, idempotencyKey, expectedBindingId, expectedProjectExternalId, mapping)`。workspace 由 Host 注入；两个 expected 值只作陈旧 scope 守卫。Host 在 Storage 事务外读取当前定义，校验本次选择的字段 kind 与 option ID；Core setup 事务内再次核对当前启用挂载与项目，并以 `origin=user` 保存既有 record。复用 domain 形状验证，不引入第二套映射 schema；新选择只能使用当前定义中的 ID。

现有 remote JSON 对 `__proto__` / `constructor` / `prototype` 字典键保留安全拒绝；chooser 用 own-property 保存 opaque ID，遇到上述保留键时在提交前显式提示不支持，不静默丢键或放开通用 wire 安全门。

状态选择器只列 single-select，迭代只列 iteration，目标日期只列 date。值始终用 ID，重名显示名称和可区分的 ID。状态选项目标为五个确定 `NormalizedStatus` 或“未映射”；后者从 options record 省略，不能持久化 unknown。换状态字段后不沿用旧字段的 option map。已有孤儿 ID 显式显示“当前定义中已不存在”，可清除；不要把它按名称重新识别，也不要在 domain/Storage 把定义暂时缺席升级为永久非法历史。

保存进入 `configure()`，fingerprint 纳入 mapping record。ack 的 `local_only` 只代表本地配置提交；候选重组的 bootstrap 完成这次 refresh，并由 watch/baseline 发布重投影结果。相同配置重试无需重组时，显式调用当前 controller 的 `refreshPlanning` 以恢复确认；正常变更不追加第二次 Provider 读取。确认条件是新组合已激活且当前 Planning 读取成功；不能只凭 compose 未抛错显示成功。本代 Core 以既有 `planning_sync_round` 的已提交轮次越过本代引导门且等于最新开始轮次作为成功证明；begin 未获 ack 时保持未确认门。同 Core 重试刷新成功更新同一账本，不新增正常 Provider round。

激活失败返回既有 `activationError`；读取失败保留本地 user 配置和 last-known 投影并标 stale。chooser 只有在本次 intent 收到本地 ack 后显示“本地已保存，来源尚未确认”和重试；明确拒绝保留草稿并提供按错误码恢复，结果未知先独立读回再按原 key 重试。只有 Host 当前读取确认后，列表/抽屉显示新规范状态；UI 不自行改状态。晚到定义响应或保存结果若 scope 已变则废弃，保存事务拒绝陈旧 scope。source 单独持有当前 scope 的待确认 intent；local ack 或定义读取失败不得让 Form 回落到旧 mapping，匹配 Host 确认后才完成 intent，scope 改变即清除。

比较方案：UI 本地映射会形成第二权威源；保存后要求重启不满足 AC；Core 原地变异或缓存重投影需要第二套协调/重投影机制且缓存完整性未证明。现有重组方案复用生命周期与回滚机制，总代价较小。普通可逆选择由本计划决定，不增加待批准项。

## Global Constraints

实际基线 `AGENTS.md` 记录 Gate E1 已于 2026-10-15 获 freeze 裁决；保持七条系统不变量，不改变 StatusPolicy，不调 Provider 写口，不新增 migration、Storage 端口、通用表单框架或规划写能力。配置 ack 与来源确认分开，不能宣称权威 Saved。仓库正文中文、路径相对、公开 issue/PR 文案遵循仓库发布规则。

本批允许文件集合仅在此声明：新增 `packages/core/src/planning-mapping.ts`、`apps/harness-plugin/src/host-planning-mapping.ts`、`packages/client/src/planning-mapping.ts`、`packages/ui/src/planning-mapping.ts`、`tests/contract/ui-planning-mapping.test.js`、`tests/integration/planning-mapping-command.test.js`；修改 `packages/domain/src/browser-values.ts`、`packages/core/src/workspace-setup.ts`、`packages/core/src/context.ts`、`packages/core/src/bootstrap.ts`、`packages/core/src/queries.ts`、`packages/core/src/index.ts`、`packages/controller/src/commands.ts`、`packages/controller/src/index.ts`、`apps/harness-plugin/src/host-operations.ts`、`apps/harness-plugin/src/host-composition.ts`、`apps/harness-plugin/src/client.ts`、`packages/client/src/index.ts`、`packages/ui/src/workspace-setup.ts`、`packages/ui/src/index.ts`、`tests/integration/harness-plugin-host-planning-mapping.test.js`、`tests/integration/harness-plugin-host-recomposition.test.js`、`tests/contract/harness-host-operations.test.js`、`tests/contract/harness-host-remote-adapter.test.js`、`tests/contract/ui-work-item-list-view.test.js`、`tests/contract/package-boundaries.test.js`、`docs/adr/ADR-0014-host-composes-providers-by-implementation-key.md`、本计划、`docs/README.md`、`docs/exec-plan/tech-debt-tracker.md`。若新增 Host helper 需要高层依赖，只加该精确文件的 boundary 白名单和既有 ADR 说明，不放开 apps 整包。

总 code+tests changed lines 硬上限 800，docs 1300；初估生产及接点 330–400、测试 240–310，合计 570–710，文档 180–320。所有接点、旧断言和 fixture 改动均计入。接近上限先消除重复夹具和非闭环重构；不得削 AC、反例测试或用压行规避。

共享写入由主控指定的唯一集成人串行完成：Host composition 的 fingerprint/dispatch、client 壳接线、setup UI、各包 index、boundary 和文档索引。mapping owner 提供精确 patch；#359 的单一安装按钮与 #360 的刷新接点由集成人在相同文件上顺序落地，其他 worker 不并发编辑。新 mapping 模块由本 lane 独占；三个分支互不以文本共享为 stack 理由。索引在既有 `2026-10-26-planning-field-mapping` anchor 后插入；本 lane 不改其他 lane 的技术债行。

执行不改 Project `Status`、`blocked-by`、`blocking`；#358 的 2026-10-28 checkpoint 归 iteration 8 的字段可由主控作机械补齐，不能把它当完成验收。

## Plan of Work

### Batch 1 · 从定义选择到 Host 确认投影

最小闭环：定义读取 → ID 表单 → 本地命令 ack → 重组/读取确认 → 同一 watch 更新列表和抽屉。主文件为新增 mapping 职责模块及 Host composition 的接点；完整写入集合见 `Global Constraints`。

1. 本计划独立审阅后，先做 plan commit 与 draft PR，关联同仓 issue #358 并双向回读 head/base/draft、closingIssuesReferences、文件范围；未实现时不宣称 AC 完成。然后回读本分支状态，先在新增 command、component 与既有 Host mapping 测试写 RED：现有代码缺少操作、重组与 chooser，应明确失败在该缺口，不接受 import 失败作为最终红测理由。
2. 实现窄 setup command、scope/shape 检查、Host 定义 DTO 与提交前定义验证。测试事务拒绝无部分写入，同值/同 key 重放不产生重复配置，Provider 写陷阱零调用。
3. 加 fingerprint 与 configure 接线，区分本地 ack、activationError、Planning stale；明确正常重组 bootstrap 与失败重试 refresh 的去重。验证同进程 List/Drawer 更新和重启 user 映射恢复。
4. 实现 client source、闭集 decoder、chooser 和设置入口，保存期间 single-flight；scope 变化、dispose、晚响应不更新旧 UI。由集成人落共享 patch。
5. 先运行下面最窄命令；新反例通过后跑 typecheck/boundaries，再按 Host 配置风险跑完整 verify。独立验收者核对完整 AC、反例与不变量后做必要重构，并重跑受影响验证。记录真实输出，更新本计划、债务和索引，将初始计划与最终实现整理为一个能力整合 commit `feat(planning): 支持选择并即时激活字段映射`，末尾 `Closes #358`。
6. 最终 push 后回读当前 head/base/checks/所有 review threads/issue 关联，当前 head 验证通过才 ready 并请求人类 review；不自行合并。已推分支若整理历史，先建 backup ref 并按 expert 精确 lease 流程。

执行上下文：以下命令均在检出 `feature/field-mapping-chooser` 的工作树根目录运行。

    pnpm test:file tests/integration/planning-mapping-command.test.js tests/contract/ui-planning-mapping.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/contract/harness-host-operations.test.js
    pnpm typecheck
    pnpm run boundaries
    pnpm verify
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望：所有选定测试及 verify pass；boundary 无反向依赖；disclosure 无命中；机械规模通过且另核对本批更严格 800/1300；diff-check 无输出。基线 `pnpm verify` 由主控在 scout 的上述观察 head 跑过 2086 + 7，本分支新增行为尚无验证证据。

回滚点：整个能力 commit 可独立 revert；保留原 mapping record，旧 #277 仍可读取。不要删除用户配置或对 Provider 发补偿写。

### Batch 2 · 修复 F410-1 的本次提交反馈

最小闭环：明确 `failed/invalid_input` 或 `conflict` → 仍保留编辑意图 → 不提示已保存 → 重新读取字段定义 → 新尝试使用新 key；`unknown` 先读回并使用原 key；已获本地 ack 后的读取/激活失败继续保留本地保存提示和原 key。主文件为 `packages/client/src/planning-mapping.ts`、`packages/ui/src/planning-mapping.ts`、`tests/contract/ui-planning-mapping.test.js` 及本计划、PR 独立评审记录。

根因：source 原来只持有 unresolved/unknown，Form 却把旧配置的 origin 当成本次 intent 的本地提交证明。比较方案：只改通用文案无法恢复结构化错误；明确失败时清空 intent 会丢用户草稿；采用 source 记录本次 intent 的提交证明/明确拒绝/未知结果并发布安全错误码与恢复动作，Form 消费该状态。命令 envelope 的 scope/value 校验通过后才建立本地 ack，错误原文不透传。明确拒绝允许新 key，未知结果与已确认 ack 的恢复保持原 key。

验证命令在检出 `feature/field-mapping-chooser` 的工作树根目录执行：

    node --test --test-name-pattern='definitive mapping rejections|unknown mapping results' tests/contract/ui-planning-mapping.test.js
    node --test --test-timeout=120000 tests/integration/planning-mapping-command.test.js tests/contract/ui-planning-mapping.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-recomposition.test.js
    npx --yes pnpm@10.28.2 typecheck
    node scripts/review-mutate.mjs <评审临时 spec>

期望：先见两项行为 RED（明确拒绝与未知结果都错误提示已保存），修复后全部相关测试绿；安全错误码驱动读定义恢复、拒绝后新 key、未知先读/同 key、ack 后失败同 key均被断言。最终产品树的新旧变异整表一次执行且 killedBy 归因正确；字节还原并基线绿。回滚点为本批 source/UI/test 修改整体撤回；不改变原持久化映射或 Provider。

## Validation and Acceptance

| # | 验收项与反例 | 判定证据 |
|---|---|---|
| AC1 | 从当前定义按 kind/ID 选择，重名可区分；未映射原生选项可见 | chooser 组件测试；换状态字段不串旧 option map，孤儿 ID 可清除 |
| AC2 | 选择和保存不调用任一 Provider mutation | command + Host 的全部写方法抛错陷阱及零计数 |
| AC3 | 不重启，列表与已打开抽屉显示新规范状态 | remote→configure→bootstrap→watch 的 Host 集成与当前 UI 投影断言 |
| F1 | 错 binding/project、迟到定义、畸形 mapping 不保存 | 结构化 conflict/invalid_input；事务前后 mapping 相同 |
| F2 | ack 后激活/读取失败不假成功，旧内容 stale，重试恢复 | Host 故障注入；配置 origin=user 仍在，后续确认成功 |
| F3 | 同值重放、双击、重启均不复制配置/读取循环 | single-flight、同 fingerprint 不重复重组、重启恢复用例 |

## Progress

- [x] (2026-10-27 15:33 +08) 读取 issue、双独立研究及实际 owning source，完成边界/方案/反例审阅。
- [x] (2026-10-27 15:33 +08) 写入自包含 spec/plan；当前尚未实现或测试新增行为。
- [x] (2026-10-27 +08) Batch 1 的 plan commit/draft 双向关联由主控完成；core command、Host remote、client/chooser 先执行明确 RED，再实现 GREEN。
- [x] (2026-10-27 +08) 本地实现完成：scope/shape 事务守卫、live 定义校验、configure 即时激活、同值重试确认、ID chooser 与设置入口；保持 Provider mutation 零调用。
- [x] (2026-10-27 +08) 在检出 `feature/field-mapping-chooser` 的工作树根目录执行新增及相关窄测试 40/40、UI/浏览器入口补充测试 22/22、`pnpm typecheck`、`pnpm run boundaries` 9/9；最终 `pnpm verify` 为主套件 2097/2097 与 MVP-0 7/7。命令输出存于忽略的 `.superpowers/mapping/`。
- [x] (2026-10-27 +08) 首轮独立对抗验收发现 2 项 P1 与 1 项 P2；逐条核实并执行明确 RED/GREEN 后修复，完整 `pnpm verify` 为主套件 2102/2102 与 MVP-0 7/7，`pnpm typecheck` 与 boundaries 9/9 通过。本轮修复未提交。
- [x] (2026-10-27 17:03 +08) 原独立验收者已逐条复评通过；所有本批发现均已修复，未以作者自审替代独立验收。
- [x] (2026-10-27 17:03 +08) 三能力本地并集验收通过，完成归档和索引；发布与 ready 的易失状态由本计划末尾的 GitHub 命令控制，不把工程验收当作人类规划接受。

- [x] (2026-10-27 +08) Batch 2 复核 F410-1 根因并比较三种方案；新增两项明确 RED，修复后组件测试 9/9、最窄相关回归 47/47 通过。首次 typecheck 发现 exactOptionalPropertyTypes 不接受显式 error=undefined，改为从 data 发布清洁 pending 快照；修正后 `npx --yes pnpm@10.28.2 typecheck` exit 0；在本批最终产品树一次整表施加 M410-1–M410-8，全部 KILLED 且 killedBy 正确归因、字节还原及还原后基线绿。详见 `docs/review/pr-410-mmp-review.md` 修复批次。
- [ ] Batch 2 根会话的独立交叉复评及最终组合验证；未 commit/push，不把原组合树的证据当作修复后结果。

## Surprises & Discoveries

基线 `fingerprint()` 完全不含 mapping；只新增保存按钮会持久化成功却不激活。证据是基线 `host-composition.ts` 的 fingerprint 与 `loadPlanningMapping` 分离。另一个发现是重组已 bootstrap，故“保存后再刷新”的直译会多读一轮；本计划把重组读取作为确认，失败重试才显式刷新。

本地验证发现并修复两项实际反例：首次 bootstrap 自动派生 mapping 后必须记录候选的实际 fingerprint，否则下一次同配置意外重组；client/UI 从 domain 根入口导入运行时会触达 `node:crypto`，首次完整 verify 的浏览器构建失败，改用既有纯 browser 入口后最终全套通过。ack 后定义读取失败和候选激活失败的新增 RED 分别捕获错误的 confirmed=true 与 Host fresh；现保留本地配置并显示未确认/陈旧。

独立验收首轮发现并证实：ack 替换 data 对象会使 Form 草稿回落并重试覆盖用户配置；旧 healthy cursor 在 read/cursor 或 begin/cursor 双故障后不等于本代读取成功；原型属性名可触发表单继承读取或 setter 丢键。修复见 Design / Spec 的 intent、既有轮次账本与 transport 保留键边界。

`planningReadBaseline` 让当前已 begin 未 commit 的轮次发出 whole-source degraded metadata；既有 controller 先 views 后 summary 的单帧窗口仍可能使 header/rows 不一致。该窗口由本轮 #361 / PR #412 的原子 snapshot 闭环承接，本 PR 不重复实现。precommit-watch 保留原 delta/New/no-gap 断言并精确接收新增 degraded header metadata；完成双故障后的稳定 baseline/watch rows stale 另有判别测试，不宣称在途单帧 rows/header 已一致。

## Decision Log

- Decision：按已确认 P2 的原授权执行 Batch 2。人类原话：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续…merge_method=rebase 合并”。Rationale：本次 PR #410 只有 F410-1 这一项 P2；根会话已独立复现并发布 APPROVE review `5665045132`，当前实现者只修复授权文件并交根会话独立复评，不自行外部写入或合并。Date/Author：2026-10-27 +08 / 根会话授权、修复执行者记录。
- Decision：在 source 中区分本次 intent 的本地 ack、明确拒绝和未知结果，保留独立的本地提交证明。Rationale：origin 只证明旧配置存在；文案修补不能恢复错误语义，清空 intent 会丢草稿。`invalid_input/conflict` 走重新读取定义；明确拒绝后新尝试新 key，未知/已 ack 恢复沿原 key。Date/Author：2026-10-27 +08 / 修复执行者。

- Decision：`packages/core/src/queries.ts` 的私有 `syncSummary` 显式接受 `StorageTransaction` 读面，默认使用 `context.storage`；cursor 与成功 round 都从同一参数读取。Rationale：与 #361 / PR #412 的事务快照集成合同对齐，避免后续只解决函数头冲突却把 round 读取落回根队列产生自等；独立 mapping 的默认调用和成功轮次语义不变，不新增公开端口或重复 snapshot。Date/Author：2026-10-27 +08 / 集成对齐。

- Decision：复用 configure 重组与已有 bootstrap，配置 ack/来源确认分层。Rationale：只有一条有效映射与投影权威路径，既满足即时可见又不重复正常读取。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：新选择验证 live 定义，历史孤儿映射展示并允许清除。Rationale：拒绝陈旧输入，同时不改变既有 domain 的缺项降级合同。Date/Author：2026-10-27 +08 / spec reviewer。
- Decision：不批准任何 Project Status 或阻塞关系变更。Rationale：本次授权仅含 capability 交付与机械迭代归属。Date/Author：2026-10-27 +08 / spec reviewer。

## Idempotence and Recovery

相同本地 intent 用原幂等键重试；未知结果先读回 scope 与 mapping，再决定重试，不能先生成新键。保存已成功但激活失败时沿现有 configure 重试，不撤销正确的本地事实。定义读取失败不清空现有映射；卸载取消 lifetime，恢复后重新读取定义。回滚只撤回本 PR 能力，不删除 SQLite、分支、工作树或外部字段。

## Interfaces and Dependencies

依赖既有 Planning 定义读取与 Storage mapping record，无新增外部凭据。remote 只传内部 DTO、actor/key 和 expected scope；核心命令工作区由 Host 提供。命令返回沿既有 `CommandResult`；错误固定安全文案，不透传 Provider 原文。新 source 的 getSnapshot 在两次 publish 间保持同一不可变对象。

最终推送后由交付者回读当前 head/base/checks、issue 关联和全部 review threads，验证当前 head 后才 ready；本计划不授权合并。计划完成后迁入 completed 并更新索引。

## Outcomes & Retrospective


最终本地结果：字段定义选择、本地映射确认、同 Host 激活与失败意图保留（#358）已通过独立验收、修复复评与组合验证。历史阶段记录如下，其“待验收/未提交”描述仅指当时观察，Superseded by 本段（2026-10-27 17:03 +08）。

本地实现已覆盖 AC1–AC3 与 F1–F3 的自动化证据；同一 Host watch 更新列表和既有抽屉目标，正常变更仅一轮 item read；失败保留 user 配置并可重试，重启恢复同一 ID。实现尚未提交且独立验收待完成，不能将本地测试视为远端 CI 或人类接受；没有 Provider 外部写入。当前未新增技术债；若定义读取预算、离线重投影或装配失败恢复出现本批之外的真实缺口，在 `docs/exec-plan/tech-debt-tracker.md` 记录具体影响和后续验收。不要把未做的离线重投影宣称已支持。

在检出 `test/iteration8-delivery-union` 的工作树根目录，`pnpm verify` 为 2143 个主测试与 7 个 MVP-0 测试通过，`pnpm run boundaries` 为 9 项通过；另完成跨能力的执行租约/映射重组及设置 mutation/单飞刷新组合观察。最终并集与实际宽测树的生产、测试和依赖字节一致，仅计划文档前移。单分支的具体测试与反例见 Progress 和 Validation and Acceptance。

PR #410 的最终发布状态必须重新回读，预期为当前 head/base 正确、全部检查通过、关闭引用完整且没有未处理评审线程，然后才能 ready；人类评审及合并由伙伴决定：

    gh pr view 410 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup
    gh pr checks 410 -R SingularityKChen/harness-projects

父项 #134 已以既有交付证据关闭；#124、#136、#226 仍保留，子能力交付不能替代其真实宿主与端到端走查。#143 的 Desktop/真实模型验收仍未由本批自动化测试覆盖。

## Bottom Change Note

2026-10-27 +08：合成两份独立研究并作系统审阅后首次写入；明确 live scope、Host ack/激活/确认、重组 refresh 去重及共享文件单 owner。

2026-10-27 +08：写后复核补齐 plan commit/draft→红绿→独立验收→最终回读/ready 顺序，移除只针对审阅者的执行限制，加入索引独占 anchor。

2026-10-27 15:33 +08：完成写后复核并以实际本地时钟校正 Progress 时间；保留完整验收和当前未验证状态。

2026-10-27 +08：补列既有 remote adapter 操作名单契约的精确文件；新增命令必须同步名单和参数数量，不改变发布或行为范围。

2026-10-27 +08：首次完整 verify 的浏览器构建拒绝 `node:crypto`，根因是新增运行时从 domain 根入口可达 ids；补列纯 browser-values 入口并复用既有 shape validator，避免复制映射 schema。

2026-10-27 +08：纯 browser 入口复用校验器后，更新既有 browser-values 精确导出名单契约；第二轮 verify 的唯一失败是该合法新增导出尚未列入金样。

2026-10-27 +08：记录 RED/GREEN、浏览器打包与 fingerprint 回归修正、最终 2097+7 本地验证；保持 Active/未提交，等待独立验收与主控交付。

2026-10-27 +08：独立验收要求修复双故障确认漏洞；补列 Core context/bootstrap/queries，复用 planning_sync_round 的本代提交轮次证明，保留既有游标作为持久事实来源，不新增 Provider round 或 Host 侧投影。

2026-10-27 +08：本代提交证明也让当前在途轮次按既有 metadata 通道显式陈旧；补列既有 precommit-watch 测试，增加 degraded metadata 的精确断言，同时保留原 delta/New 内容与无 gap 检查。

2026-10-27 +08：按独立验收修复2项P1与1项P2；增加实际Form重试意图、Core本代成功轮次、opaque ID own-property/明确transport拒绝的RED/GREEN。记录由#361 / PR#412承接的在途views/header原子快照窗口，不重复扩展本闭环。

2026-10-27 +08：依据实际三分支并集冲突处理证据，将已列允许范围内的 Core queries 私有 helper 显式注入 StorageTransaction 读面；cursor/round 同参，降低跨分支手工合并误用风险。默认语义不变，复用窄回归与 typecheck，不增加镜像测试或重复完整 verify。

- 2026-10-27 17:03 +08：独立验收与组合验收后归档，保留历史观察并用发布回读命令代替易失 CI/ready 值；未改变 Project Status 或依赖关系。

- 2026-10-27 +08：依据 F410-1 独立复现及人类 P2 修复授权，在已归档计划增加 Batch 2、根因与三方案比较、真实 RED/GREEN 和独立复评门；原 head 的验收结论仅对其锁定版本成立，不能外推到本批未提交修复树。

- 2026-10-27 +08：补齐修复后最终产品树的 typecheck 通过与八项整表变异结果；独立交叉复评和重组验证仍保留未完成，不引用原组合候选替代。
