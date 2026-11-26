# PR #695 MMP 交付评审

## Purpose / Big Picture
判断本层能否独立验收、合并和回滚；代码测试不替代用户闭环、已安装 Host 接受或 R1。

## Context and Orientation
2026-11-26 SGT 初始锁定：head `5ade68d320275dad3d9268ed627dc395d51602f0`，base `main@e7a84328a657612006cc1be328487413e14e0cb6`。本层为 #695，所属 issue #691；完整 PR、commits、threads 和 checks 已读取，结论须随版本重新锁定。执行上下文为检出 `feature/multiproject-catalogue-open` 的 `.worktrees/mp-691-catalogue` 根目录。

## Design / Spec
先建立风险矩阵再逐层审查。核对代码、产品、架构、测试、反例、issue 接受和重复追踪。所有首轮 inline 意见一次性提交；P0/P1 请求修改，只有 P2/P3 则批准并进入根因修复。修复需独立复评。

| 严重度 | 风险与反例 | 层 / 最小判别证据 | 初始结论 |
|---|---|---|---|
| P0 | 凭据泄漏、私有根逃逸、不可恢复数据破坏、合入即破坏 main | 架构 / 安全边界、schema、发布面 | 本层未发现；无 schema/凭据存储改动 |
| P1 | A 操作写入 B、旧代响应进入新项目、错误 Saved、恢复失败阻止 Host、单一事实源破坏 | 代码 / 产品；并发、失败、真实接线反例 | F1、F2 均复现跨项目写入，阻塞 |
| P2 | 可恢复的导航、错误反馈、幂等、状态隔离或验收断言不足 | 产品 / 测试；用户路径与相对 base 的判别验证 | 缺失/不支持目标保留 A；正常 Home 打开通过；未新增独立 P2 |
| P3 | 文档和证据漂移、过度设计、重复追踪、提交粒度与可读性 | 设计 / 工作项；issue、计划、范围、当前 checks | 无第二目录/Store/Router；修复归 #691/#636；提交整理留主会话 |

## Global Constraints
遵守七条系统不变量；不写 Planning Status 或依赖关系；评审账号 gh-review（Singularity-AI-Bot），开发/作者回复/合并 gh（SingularityKChen）。仅本 PR 的代码和本评审记录属于本层 ownership。沿用唯一跨层 ExecPlan `docs/exec-plan/active/2026-11-25-multi-project-workspaces.md`；归档在栈顶完成。

## Plan of Work
1. 锁定远端事实、关联 issue 和风险矩阵；完整分层审查并运行最窄判别验证。
2. 一次性提交首轮 review；按根因修复、独立复评，更新本记录。
3. 归档计划、整理交付提交、公开面/体量检查、最终 push 回读，当前门通过后按原生栈 rebase 合并。

验证命令在具体证据处仅记录一次，必须注明检出分支或不可变版本；回滚使用备份 ref 或 revert 本层，不删除 workspace 数据。

## Validation and Acceptance
所有 P0/P1 排除或关闭；每项发现有代码位置、可观察影响与判别证据。全部检查、issue 关联和线程以最终远端 head 回读为准；安装态人类接受与 R1 独立。

## Progress
- [x] 2026-11-26 SGT：锁定初始事实并先建 P0–P3 矩阵。
- [x] 2026-11-26 SGT：完成首轮本地全矩阵审查、反例与变异；一次性 GitHub review 由主会话提交。
- [x] 2026-11-26：两项根因修复与独立复评通过；远端最终 head 门另行回读。
- [ ] rebase 合并和授权清理。

## Surprises & Discoveries
初始为四层依赖链；不同层共享装配和导航边界，跨层问题归属最早引入该问题的层。

2026-11-26 @ `5ade68d320275dad3d9268ed627dc395d51602f0`：正常路径全绿不能排除跨项目写入。现有双 peer 测试只验证「切换后立即读拒绝 → 重开 watch 后放行」，没有覆盖中间一次 host 目录读；客户端覆盖只验证 scope 变化后重读，没有覆盖延迟账号确认后的第二步写入。

## Decision Log
2026-11-26 / 人类直接指定：“你负责后续：三思后修复，但禁止 adhoc 式修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”覆盖 #695–#698，授权当前评审会话负责修复与条件合并；P0/P1 修复并复评前不得合并。

## Idempotence and Recovery
每次推送前保存本层旧 head 为本地 backup ref，并使用精确远端 lease。失败保持当前分支和已存工作区；不以清理覆盖未提交工作。

## Interfaces and Dependencies
GitHub PR/issue/reviews/checks；已有本层 worktree；依赖链 #695 → #696 → #697 → #698。评审边界不授予规划字段写入权。

## Outcomes & Retrospective
首轮结论：**REQUEST_CHANGES，2 × P1；无 P0/P2/P3 独立意见。** 只完成本地独立评审，没有产品修改、提交、push、GitHub 写入或 issue 状态变更。

初始 F1/F2 的阻塞结论 Superseded by 下文“修复复评”（2026-11-26），原始反例保留。

### F1 · P1 · 目录读取错误确认了尚未观察的新装配

新增行：`apps/harness-plugin/src/remote.ts:257–258`。任何成功 unary 完成后都读取全局 `currentGeneration()` 并写入 peer 的 `delivered`；`listWorkspaces` 是 host 作用域，绕过旧代栅栏，但它并未向调用方交付 B 的工作区快照。于是目录读取也让旧 A 面板获得 B 的后续写入准入。

可复现序列：真实 Gateway 的 peer-a 接收 A baseline；peer-b 打开 B；peer-a 的 baseline 正确被拒绝；peer-a 读 `listWorkspaces`，随后调用 `installExecutionBindings`。实际返回 `local_only`，数据库变化，最后交付给 peer-a 的 watch workspace 仍是 A。这里没有 B baseline，也没有 peer-a 的成功打开。

最小一致修复：内部 dispatch 返回或回调本次调用实际确认的 activation generation，在串行激活发布点捕获；remote 只按该确认推进同一 peer，或者按实际 stream frame 的 generation 推进。host 目录读、失败打开和无确认的结果不得用完成时的全局 generation 追平。只把条件改为 `scope === transition` 仍不足以消除另一次排队 transition 在 await 之后改变 current 的窗口；设置引起的同项目重装配也要保持可恢复。无需扩充外部 wire ABI 或建立第二个选择事实源。

### F2 · P1 · 工作区切换未撤销旧连接意图的第二步写入

新增行：`apps/harness-plugin/src/client.ts:54–55`；关联机制在 `packages/client/src/workspace-setup.ts:189–192,225–228`。workspace 变化只调用 `setup.refresh()`；有 `mutationPending` 时 refresh 加入原 Promise，旧 `connect()` 仍会在账号确认后继续 `bindPlanningSource`。第二个 unary 在到达时才绑定当前 Host workspace，因此旧 A 意图可变成 B 的设置写入。

可复现序列：源在 A 开始 `connect(projectNodeId)`；Host 已完成 `connectAccount`，测试仅延迟该成功回执送达客户端；另一 peer 打开 B，原 peer 接收真实 B baseline；释放 A 回执。实际数据库 `workspace_binding` 新增 `{ workspace_id: B, domain: planning }`，A 选择的规划项目被绑定到 B，源最终 setup 也变为 B。该反例使用真实 composition、SQLite、remote wrapper 与生产 `createWorkspaceSetupSource`，外部 GitHub 请求由已有录制回放提供；没有产品源码变异。即使 F1 修复，此处也仍发生，因为 B baseline 已实际交付。

最小一致修复：源持有正在执行意图的 workspace/activation token（包括 generation，避免 A→B→A 同 id 恢复旧意图），观察 scope 变化时使其失效；在账号 → 规划绑定等每个 await 后检查 token，再决定是否继续下一步写入。保留已确认账号事实，停止旧意图继续写，并要求用户在明确目标上重新提交。客户端 scope 通知必须先失效旧意图再安排读取；普通刷新不能代替失效。不要新增一个客户端 active workspace 权威源。

### 证据与判别性

下列命令均在检出 `feature/multiproject-catalogue-open`、head `5ade68d320275dad3d9268ed627dc395d51602f0` 的 `.worktrees/mp-691-catalogue` 根目录运行，日期 2026-11-26 SGT；Node `v26.13.1`。运行态反例供修复 owner 采用为正式回归，不作为交付产品文件。

| 命令 | 结果 |
|---|---|
| `node scripts/resolution-check.mjs` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `node --test tests/integration/harness-plugin-host-catalogue.test.js tests/integration/harness-plugin-policy-admission.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-setup-client.test.js tests/contract/ui-workspace-setup.test.js tests/contract/harness-host-remote-adapter.test.js tests/contract/harness-host-operations.test.js` | 109/109 pass |
| `node --test tests/contract/storage-contract.test.js` | 292/292 pass |
| `pnpm run boundaries` | 10/10 pass |
| `node --test --test-timeout=120000 tests/browser/projects-home.test.js` | 1/1 pass |
| `node --test .superpowers/review-695/stale-peer.test.mjs` | exit 1；F1 的期望拒绝断言失败，实际 `local_only`、`databaseChanged:true` |
| `node --test .superpowers/review-695/staged-connect.test.mjs` | exit 1；F2 的 B 无新增绑定断言失败，实际 B planning mount = 1 |
| `node scripts/review-mutate.mjs .superpowers/review-695/mutations.json` | exit 0；基线、还原后基线均绿；见变异表 |
| `git diff --exit-code -- apps/harness-plugin/src/remote.ts apps/harness-plugin/src/host-composition.ts` | exit 0，变异后源码无残留 |
| `git diff --check e7a84328a657612006cc1be328487413e14e0cb6...HEAD` | exit 0 |

变异只在本次最终被审树上整表运行一次；每项均指定 `killedBy`，输出在运行态 `.superpowers/review-695/mutations.log`：

| 变异 | 对应判别测试 `killedBy` | 结果 |
|---|---|---|
| M1-peer-fence：移除 remote 的旧 peer 拒绝 | `real Gateway per-peer fence rejects a stale peer unary` | KILLED；唯一失败为指定用例 |
| M2-settings-scope：关闭 configure 的 workspace 检查 | `a settings write admitted on A is scoped out` | KILLED；唯一失败为指定用例 |

### 其余矩阵与边界

- 逐文件检查了本层 29 个变更文件、对应 setup/Host 生命周期和全部已有 review threads（初始为空）。目录直接读 Storage workspace 行、只暴露 id/name/规划挂载存在性/策略支持性；未新增持久目录、schema、Provider 轮询或第二个权威 active 状态。SQLite 与 Fake 的创建序和返回副本由契约验证。
- 普通 open 失败不替换 current、不写全局 activationError，作用域 not_found/not_supported 保留 A；原有同 workspace 重装配、lease drain、旧 scheduler 退休与失败恢复已有判别测试通过。可见 UI 没有新 `Saved` 声明；正常 A/B Home 导航不混行。
- 未把计划明示的「单一不支持策略工作区启动 fail-closed」另报成新增 P1；这是保留的 policy admission 契约，不能声称已证明该场景的 Home 恢复闭环。启动恢复偏好/深链属于 #693；跨重启 create 幂等属于 #692；组合及安装态人工接受属于 #694/#636。此次未执行安装态、人类走查、宽窄屏/键盘/明暗完整矩阵，也未把 1 个浏览器正常路径称为这些接受。
- #691 接受项“旧回复/排队命令固定 workspace+generation”目前因 F1/F2 不成立，不能勾选关闭；修复可归入已有 #691 和父 #636，无需另建重复工作项。#636 仍须四层组合和实际可用安装 Host 的人类证据。本层 800 技术行/351 文档行在硬限制内；当前提交序列含临时修复粒度，主会话最终整理时仍需重新核对。
- 初始锁定的远端 `PR Fast Gate`、Verify、Browser、Windows Native、size/disclosure/policy 均成功；可选 `Create review session` 失败。它不代替上述本地反例；修复 push 后必须重新锁定和回读，旧 head 证据不得转移到新 head。

### 修复复评（2026-11-26 SGT）

候选 `d0e8102909907068d0a66365cbc5096eb0d8f4b0`：F1 以 Host 内部可选 callback 在本次串行激活/确认时同步记录 generation；ordinary host read、失败与迟到响应均不追平 peer。F2 以观察 epoch 撤销旧阶段/读取/排队 reconcile；watch 的 workspace 或 logical generation 变化先失效，再按需要刷新。Host 已提交账号保留，旧流程不能继续 bind；create/open 的自身激活仍可完成。

由未参与修复的原子评审独立核对全部相关矩阵：spec 与代码质量通过，无新增 P0–P3；另跑针对性 9/9。实现者相关窄验证 108/108、typecheck、boundaries 10/10 均通过。较宽测试曾发现 workspace-status 夹具把 carrier 帧序列当成 logical generation；只修正该夹具身份并保留原 no-duplicate-read 断言，两失败项已在窄组恢复，不把旧红隐藏成已通过全量。

最终修复产品树运行 `node scripts/review-mutate.mjs .superpowers/review-695/final-mutations.json`：M1 peer fence、M2 settings scope、M3 arbitrary-unary acknowledgement、M4 staged intent invalidation 均 KILLED，归因为原 Gateway/设置作用域/新 activation 反例，字节还原及基线绿。第一次 M4 仅归因名称写成不存在的 staged，得到 KILLED_OTHER；更正为实际用例名 new activation 后整表通过，前一次不计有效表。

远端最终 push 后仍须重锁 head/base、Fast Gate、issue 和 threads；本段不是沿用旧 head 的 Bot 批准。#691 可在本层最终门完成后关闭；#636/#694 安装态及 R1 接受保持独立。

## Bottom Change Note
2026-11-26：在逐文件审查前创建风险矩阵和可恢复的评审流程。

2026-11-26：独立评审完成，记录两个已复现的跨项目写入 P1、最终树变异和窄验证；保持修复/复评/合并未完成状态。

2026-11-26：记录两个 P1 根因修复、独立复评和最终归因变异表；保留完整远端门与人验边界。

2026-11-26 CI 补充：`bbb345b97cbb760a3ecea7713210ca694e79786e` 的 Browser lane 及本地 Projects Home 1/1 失败；B 的 accepted read 最终出现，但调用方 `.then` 在 raw mutation 结束时先执行，页面留 Home。上文窄组与独立复评结论仅属于所记候选，Superseded by Batch R 的 Source transition 完成契约修复；未满足浏览器及最终门前不批准或合并。

2026-11-26 完成契约复评：上述 Browser 回归改为 Source 的同一 mutation record 区分 raw 与 done；读只等 raw，create/open 的调用方等已安排的确认读取，重复调用同 done。connect/install 维持原预算，旧 epoch 检查不变。独立复评 spec/quality 通过、针对性6/6；实现窄组110/110、Projects Home1/1、typecheck/boundaries10/10通过。最终产品树重新运行同一 final-mutations 命令，加入 M5 transition completion，五项全部 KILLED，基线与还原通过。最终 CI 以此次后续 push 的当前 head 回读，旧 bbb345b 的红门不当作已通过。
