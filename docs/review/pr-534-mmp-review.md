# PR #534 MMP 交付评审

## 锁定事实

- 日期：2026-11-04（Asia/Singapore）。
- 工作区：`.worktrees/browser-execution`。
- 目标：浏览器执行与 PR 恢复；关注错误成功、重复创建、持久化恢复与键盘可达性。
- 初始 head：`998750efa8e7da62e90862579e9f1ebfafaa5e16`；base：`f0883948f78a9bf0a28290e21c7b1c3842b54cf5`（`main`）。
- Ready；初始 review / threads 均为空。`PR Fast Gate` 与执行 lanes 成功；取消的协调检查须核实后继全域运行。
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
| 代码 | 正常/异常、错误传播、幂等、停止/恢复 | 已查：正常/拒绝/unknown/replay/恢复均有下列独立证据 |
| 产品闭环 | 用户可观察结果、Provider ack、安装/人工证据边界 | 已查：四具名流程闭合；安装/人工门未被代替 |
| 架构 | 七条不变量、事实所有权、依赖及信任边界 | 已查：沿用唯一 carrier 和生产 authority；只替换外部端口 |
| 测试与反例 | 断言判别力、真实命令、变异归因、未验证范围 | 已查：4+7 浏览器、28 集成及两项具名负控通过 |
| 工作项与设计 | issue 验收、重复追踪、ExecPlan、独立回滚、适度性 | 已查：#451 四项逐条映射；既有边界继续由原 issue 承担 |

## 审查证据与发现

本次独立评审采用 Qian `analysis_synthesis` 与 First Principles `audit / review`：目标是证明浏览器动作到 Host 权威结果的完整链路，主要不确定性是种子预造结果、恢复时清空外部对象及键盘测试绕过导航。Superpowers 入口的 `SUBAGENT-STOP` 明确允许受派子评审跳过通用编排；本次按仓库 MMP 矩阵执行，不改产品源码。

### 代码、产品与架构

- `tests/browser/workspace-execution.test.js:45–49` 在打开抽屉前直接读 SQLite，确认零 context/run，并确认分支/worktree/主执行/人工执行/PR 均零；新种子不走旧种子的预调用 Start Work 或直接写 fallback。
- 真实链路为 `ENTRY` 生产 `apply` → `apps/harness-plugin/src/client.ts` 的 `createStartWork` / `createChangeRequestCreator` / lineage reader → 同一 carrier `/remote` 的 `parseInput` → `installHostRemote` service → `host-composition.ts` → Controller/Core。默认 URL 无视觉 `scenario`，不会进入 hand-built displayContext 分支。没有新增 client/store/应用 authority。
- `composed-execution-platform.mjs:43–46` 装配实际 Local Git；首流程断言磁盘工作树实际分支 `feature/topic`、登记工作树数 2、磁盘 realpath 等于持久 `worktree_external_id`。重复 UI submit 有两次真实 remote request，却仍只有一个分支/worktree/run 副作用。
- `workspace-execution.test.js:104–121` 覆盖明确 unavailable 与 unknown；实际 human Provider issuer 只在明确拒绝时调用一次，unknown 经读回仍为一个主启动、零人工启动、一个持久 run，页面没有“开始工作已确认”。没有将 fixture 直接写入 fallback 当作证明。
- `workspace-execution.test.js:124–151` 覆盖远端 PR 已存在而 ack 丢失：旧 Host/SQLite dispose，新 storage/Host/peer 与旧对象不同且旧 storage 查询拒绝；远端对象保留。恢复后原 mutation ID、fingerprint、input/ownerGeneration/worktree/bindingId 保持，saved 只在读回确认后出现，create remote request 与平台 mutation 各 1；恢复请求至少 2。它验证 DB/Host recreation，不声称 OS-process crash。
- `workspace-execution.test.js:154–176` 每次实际刷新 delivery，正控 passed 非空，failed/unknown/stale 不显示 passed；异 commit/repository 成功不进入谱系，另一未启动工作项为 not_started。按现有合同 CI 归属 commit，同提交不同 branch 不擅自扩成独立隔离约定。
- 首流程实际 Tab/Enter 打开、Tab/Space 展开、原生 select typeahead `L`+Tab 及实际 value、键盘 branch 输入与 Tab/Enter 提交，最后 Escape 关闭及焦点回 opener；没有测试端 `.focus()` 跳过导航。产品表单的正常自动焦点不等于测试程序化造焦点。
- 生产 TypeScript、schema、依赖、workflow 未变；七条不变量、Provider ack/Saved 和 secret-handle 边界没有被新增代码改写。临时 Git/SQLite、合成 GraphQL/CI、离线主执行端口均有明确边界，没有实际 GitHub/model/安装 Host/UAT 证据扩张。

### 独立验证与反例

在锁定 head 的 `.worktrees/browser-execution` 根执行，均 exit 0，无 skip/todo：

| 命令 | 实际结果 | 判别意义 |
|---|---|---|
| `pnpm test:file tests/browser/workspace-execution.test.js` | 4/4，约 5.8 秒 | 四个新增具名流程与实际 SQLite/Git/remote/平台断言 |
| `pnpm test:file tests/browser/workspace-read.test.js` | 7/7，约 8.7 秒 | 共享 carrier 的既有空库、读取、恢复、撤权、晚到资源收尾未回归 |
| `pnpm test:file tests/integration/harness-plugin-start-work.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/local-git-start-work-resume.test.js tests/integration/harness-plugin-delivery-lineage.test.js` | 28/28，约 1.1 秒 | 真实 Host/client/Core 的恢复、准入、scope 与 Local Git 失败恢复 |
| `git diff --check f0883948...998750ef` | 无输出 | 差异空白检查通过 |

变异在由 exact head `git archive` 生成、离线安装依赖的私有临时快照中，仅通过仓库 `scripts/review-mutate.mjs` 执行。共享工作区产品文件未改。两项在同一最终树整表运行一次；harness 基线绿、锚点恰好一次、具名归因、逐字节还原及恢复后四流程绿，退出 0：

| ID | 实际生产防线变异 | killedBy | 结果 |
|---|---|---|---|
| HOST_START_DISPATCH_REMOVED | Host handler 不调真实 Controller Start Work，直接伪造 confirmed | `Start Work dispatch creates one actual Git worktree and run` | KILLED；四流程 RED，首流程包含在失败名中 |
| KEYBOARD_START_UNREACHABLE | 开始工作按钮 `tabIndex=-1` 且 preventDefault 键盘激活 | 同首流程具名断言 | KILLED；首流程 RED |

不把实现者历史 resume mutant 当成本次独立重跑；本次恢复唯一性以实际四流程的请求/对象账单和相关集成为证据。没有首个问题即停查，也没有用同义实现断言代替反例。

### 工作项、已有跟踪与设计适度

- 直接回读 #451：四具名生产浏览器动作、重复/uncertain/restart 与 CI 真假、键盘/source identity、同源离线/失败诊断/正控四项均有上述证据，`Closes #451` 与远端 closingIssuesReferences 一致。
- 回读 #156/#449/#459：原完整十流程、planning editor/conflict、真实平台/安装 Host 人类验收和 R1 仍由父/兄弟 issue 承担。#449 当前人工读操作结果不能被本测试反向推导为执行或离线验收。
- 搜索 open issues 并回读 #141/#235/#284/#304/#453：Local Git 完整补偿/重启、durable external intent/活旧 owner fencing、PR lifecycle 与过时 fixture 退休都有既有 owner。本 PR 新增集成浏览器网，不重复承担或关闭这些工作项；没有发现需要重复建 issue 的新缺陷。
- 精确 diff 为代码/测试/配置 270 A+D、文档 167 A+D（README 按文档）；未机械扩到估算行数，没有新兼容层、新设置框架或第二 carrier；可作为一项测试能力独立 revert。
- ExecPlan 已归档并在 `docs/README.md` 索引；计划明确模型调用、真实平台、安装/UAT/R1 的证据界限和恢复方式。已有日志中的历史本地/托管结论保留各自 head，不覆盖本次独立结果。

### 当前托管事实

独立回读 head/base 仍为本记录锁定值；Ready、MERGEABLE；review/comment 数均 0。当前 exact head 的 `PR Fast Gate`、实际 Verify、Browser、Merge Gate（含各 lane）、CodeQL、size/disclosure/policy 均 SUCCESS。唯一 CANCELLED 是 `Reconcile engineering state`：确认 workflow 使用全局 `engineering-state-reconcile` 串行组，每次全 Project 重算，后继运行 `41796914434` 的整项及 `Reconcile Engineering across the whole Project` step 均 SUCCESS（另有更晚成功运行）。`UNSTABLE` 不被误写成必需产品门失败。

## 完整严重度结论

| 等级 | 结论 | 实际依据/剩余边界 |
|---|---|---|
| P0 | 未发现 | 无生产变更；Host 权威、依赖、持久数据与凭据边界保持 |
| P1 | 未发现 | 正常/拒绝/unknown/重复/reopen/CI 坏状态链路独立绿；无重复 create/run 或虚假确认观察 |
| P2 | 未发现本 PR 可行动缺陷 | 键盘历史缺口在当前树已由真实导航及独立 mutant 判别；安装/人工/R1 不属于被承诺的闭环 |
| P3 | 未发现需列 inline 的问题 | 规模、文档/索引和最小设计适度；过时 fixture 由 #453 跟踪 |

## 结论与后续

建议 `APPROVE`：#534 在其 #451 离线生产组合浏览器范围内形成可独立验收、合并和回滚的闭环；本次没有 inline findings。只编辑本评审记录，未改产品代码、commit/push、远端 review/issue 或规划状态。最终外部 review、owner 收尾与按 PR 的人类 merge 授权由协调者执行；本结论不是安装 Host、人工 UAT 或 R1 接受。

## 协调者收尾

初始APPROVE已提交并回读。相对初始head的补充仅为本评审记录和计划授权说明；产品/测试/config逐字不变。独立组合检出`.worktrees/pr534-pr541-review-integration`从`f0883948`合入#534测试与#541生产/测试增量，`pnpm verify`通过3592+8、`pnpm test:browser`通过46/46，均零skip；这是本地源码组合证据，不是安装或发布接受。后续提交整理/rebase后仍须以实际新head核对门禁并重批。

当前main重放：#541已合入`e6153dcb`后重放本能力，唯一冲突为`docs/README.md`同一索引插入点，保留两项计划行。所有非docs文件与本轮已验证源码组合`23034e42`逐路径/blob/mode相同；不把旧head批准自动覆盖新head。
