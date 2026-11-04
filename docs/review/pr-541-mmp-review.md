# PR #541 MMP 交付评审

## 锁定事实

- 日期：2026-11-04（Asia/Singapore）。
- 工作区：`.worktrees/host-policy-admission`。
- 目标：Host 规划策略准入；关注启动拒绝、副作用顺序、旧图停止、恢复与错误传播。
- 初始 head：`0a2c90099b442c756afbdb7a5e81b6399b21233f`；base：`f0883948f78a9bf0a28290e21c7b1c3842b54cf5`（`main`）。
- Ready、OPEN、MERGEABLE / CLEAN；本轮以 `gh-review` 重新读取的 head/base 与上述值相同。reviews、inline comments、review threads 均为空，threads 分页已结束。
- 本轮 `gh pr checks 541` 的 16 个可见检查均 pass，包括 `PR Fast Gate`、实际 Verify / Browser / Merge Gate lanes，以及 `Reconcile engineering state`；不以旧候选检查替代本 head。
- 评审账号：`Singularity-AI-Bot`；作者侧操作：`SingularityKChen`。
- 范围：PR 独立闭环及对应 issue，不将测试或本文审批当作 R1 / 人工 UAT 裁决。

## 先行风险矩阵

| 等级 | 风险与判定 | 检查与门禁 |
|---|---|---|
| P0 | 数据损坏、凭据泄露、硬不变量或 main 被直接破坏 | 查写入边界、保留原始数据、Host 权威与依赖方向；存在则阻塞 |
| P1 | 正常/失败路径导致核心用户闭环错误，证据虚报或无法恢复 | 追踪真实调用链、故障反例、issue 验收；存在则阻塞 |
| P2 | 有界的覆盖、操作说明或证据缺口，不破坏本 PR 交付 | 最窄判别验证，批准后修复和独立复评 |
| P3 | 小型可读性、索引或维护问题 | 检查适度性及已有 issue，避免扩大设计 |

| 层 | 必查问题 | 初始状态 |
|---|---|---|
| 代码 | 正常/异常、错误传播、幂等、停止/恢复 | 已查；启动、重装配、排队 tick / command 与普通失败恢复均有判别证据，无新增缺陷 |
| 产品闭环 | 用户可观察结果、Provider ack、安装/人工证据边界 | 已查；启动固定说明、local_only 与 activationError 分离、wire / client 不误确认；安装与人工发布门保留 |
| 架构 | 七条不变量、事实所有权、依赖及信任边界 | 已查；支持集归 Host，Core 三策略不变，无新依赖或规划事实源；boundaries 9/9 |
| 测试与反例 | 断言判别力、真实命令、变异归因、未验证范围 | 已查；新准入 10 项及独立反例 5 项通过，4 变异具名 KILLED、按字节恢复；见下表 |
| 工作项与设计 | issue 验收、重复追踪、ExecPlan、独立回滚、适度性 | 已查；Closes #540，Refs #273 等；800/1300 子项预算与仓库硬上限内，完整 PR 为回滚单位 |

## 审查证据与发现

本轮为独立 adversarial 评审，使用 Superpowers 的证据/反例流程、Qian Systems Router 与 First Principles Development；没有沿用作者的 clean、测试数量或先前评审结论。

### 代码、生命周期与副作用顺序

- `apps/harness-plugin/src/host-composition.ts:238` 的 `assemble()` 先读选中 `workspaceId`，在第 240 行 guard 后才创建 lifetime；`restoreProviders`、mapping discovery、`composeCore`、reconciler 构造和 timer start 均在其后。空目标与其它 workspace 的合法非默认策略保持独立。
- `createSqliteStorage` 在 Host guard 之前执行既有 `migrate()`；当前标记 generation3 的合法库字节保证与完整未标记库先行 `0→3` 标记已明确分开。错误 generation / schema 仍由原 Storage admission 处理。本轮独立 generation0 / generation2 反例与实际源码一致。
- `configure()` 先排空旧 leases，再提交设置并读 fingerprint；专用错误按 `instanceof HostPolicyAdmissionError` 分类，第 302 行同步 `stop()` 使 closed、watch abort、旧 lifetime / reconciler 退役；finally 不再重启。它没有在自身 pending 内等待 `dispose()`，owner 后续 drain / close 不自等。
- 独立补例把旧 tick 放到 barrier 内，并把 `connectAccount` 排到后续 tail：两种合法不支持策略都使旧 tick 无新 transport / credential 调用、排队命令拒绝、timer 为0，有界 owner dispose 完成。不是只在停止后重新调用一个已经失效的 callback。
- 普通外部错误即使伪造同名 / code / reason 也不触发专用停止；既有失败、timer 分配失败与 same-key retry 用例保持恢复。此处只认模块私有错误类型，没有扩大所有 activation failure 的停止范围。

### 产品、架构、工作项与设计

- `host.ts` 只在 composition 成功后安装 remote。启动拒绝两次均无 Provider factory / 网络 / 凭据 / session / timer / remote 注册，已标记 generation3 的 schema、版本、所有表行与配置/句柄摘要均不变，失败句柄可释放。
- 重装配的真实 `installExecutionBindings` 已提交配置仍返回 `local_only` 和原 binding IDs；独立实测 JSON 保留 `unavailable / retry / retryable:true` 错误 envelope。真实 `createWorkspaceSetupSource` 与 `parseWorkspaceSetup` 接受该 envelope，Host 停止后的读失败不被客户端当作 executionInstalled 确认。
- 共享 Core / domain 源码没有改动；三策略的工程事实隔离和显式写命令测试通过。#273 仍为 OPEN、没有人类 policy × incoming 决定；本 PR 的 Host 拒绝没有实现、裁决或关闭其通用语义。
- 现场读取 #540：其边界明确是 selected-workspace Host support-set，已标记 generation3 的保留、每代准入、专用停止、普通失败恢复与独立变异均可逐项定位。验收 checkbox 仍由 owner 在交付收尾核对，本子评审未修改 issue。#273 已承接通用策略缺陷，无需重复新建。
- 18 行生产 A+D 复用现有 `assemble` / `stop` / pending owner，没有迁移、策略转换、第二状态源或新协议。最早准入点同时挡首次 bootstrap 与后续候选，设计与子项范围相称；单一 PR 可整体 revert，撤回会重开已知风险。
- 规模实测为代码/测试 219 A+D、文档 190 A+D，低于 #540 的800/1300与仓库1000/1500上限；disclosure 与 diff check 通过。人工复核新增内容未见凭据、本机身份路径、个人信息、内部系统或保密内容。

### 本轮实际验证

执行上下文为 `.worktrees/host-policy-admission`，head 为本页锁定值。

| 命令 / 实验 | 观察 |
|---|---|
| `pnpm test:file tests/integration/harness-plugin-policy-admission.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/harness-plugin-host-planning-refresh.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/storage-baseline-admission.test.js tests/e2e/status-policy.test.js tests/contract/domain-status.test.js` | exit0；8个相关文件实际执行。终端输出截断总计，本记录不借作者结果补填数量 |
| `node --test --test-timeout=10000 .superpowers/review-541/counterexamples.test.js` | 独立5项全部 pass，0 fail / skip / cancelled：两种 barrier tick+queued command、真实 JSON strict client、generation0、generation2 |
| `node scripts/review-mutate.mjs .superpowers/review-541/mutation-spec.json` | exit0；每次基线 / 恢复后基线15项绿，4变异全 KILLED；测试含新准入10项与独立5项 |
| `pnpm run typecheck` | exit0 |
| `pnpm run boundaries` | 9/9 pass，0 fail / skip / cancelled |
| `node scripts/rule-checks.mjs disclosure f0883948f78a9bf0a28290e21c7b1c3842b54cf5` | exit0 |
| `node scripts/rule-checks.mjs size f0883948f78a9bf0a28290e21c7b1c3842b54cf5` | exit0，219代码/测试与190文档 |
| `git diff --check f0883948f78a9bf0a28290e21c7b1c3842b54cf5...0a2c90099b442c756afbdb7a5e81b6399b21233f` | exit0 |

四项变异只由仓库脚本顺序施加，没有共享并行变异；对应判别断言如下。spec、补例与日志位于忽略运行目录，未作为产品源码提交。

| 变异 | killedBy | 结论 |
|---|---|---|
| M1 删除准入 guard | `policy startup host_authoritative` | KILLED；不再专用拒绝、原件/零调用边界失败 |
| M2 guard 后移到 Provider restore 之后 | `policy startup host_authoritative` | KILLED；factory/外部顺序断言失败 |
| M3 删除专用 `stop()` | `policy replacement host_authoritative` | KILLED；旧 timer、callback / 排队命令与客户端反例失败 |
| M4 按 error.name 而非对象类型分类 | `ordinary candidate failure with a lookalike error` | KILLED；普通失败错误停止，恢复断言失败 |

变异前后 `host-composition.ts` SHA-256 均为 `b0837164ac0369e5e75829278cb3490d1c836e3c3b4128131883c9f5ed6a6eb4`；最终 tracked 源码 / 测试 diff 为空，只有本评审记录为预先存在的 untracked 文件。

## 结论与后续

全矩阵未发现新增 P0、P1、P2 或 P3，建议协调者在最终 head / base 再锁定后一次性 APPROVE。本子评审没有写远端 review、issue、commit 或 push。

结论限于本 head 的 Host 支持集工程闭环：没有在本轮重复完整 verify / browser，没有安装该候选，也没有做人类 UAT / R1；托管检查只按当前 head 实际回读。任意外部 SQL 变化的持续检测/锁定、通用 Core 的 #273 策略矩阵和实际发布接受不由这组反例证明。用户对四 PR 的条件式 rebase merge 授权与最终操作由协调者保留；P0/P1 若后续出现仍须先修复并独立复评。

## 协调者收尾

初始APPROVE已提交并回读。相对初始head的补充仅为本评审记录和计划授权说明；产品/测试/config逐字不变。独立组合检出`.worktrees/pr534-pr541-review-integration`从`f0883948`合入#534测试与#541生产/测试增量，`pnpm verify`通过3592+8、`pnpm test:browser`通过46/46，均零skip；这是本地源码组合证据，不是安装或发布接受。后续提交整理/rebase后仍须以实际新head核对门禁并重批。
