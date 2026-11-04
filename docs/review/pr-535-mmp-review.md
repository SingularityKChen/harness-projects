# PR #535 MMP 交付评审

## 锁定事实

- 日期：2026-11-04（Asia/Singapore）。
- 工作区：`.worktrees/backup-rollback`。
- 目标：备份与匹配产物回滚；关注备份一致性、拒绝控制、原始数据保留与实装回读。
- 初始 head：`3fab817d06375409f41ff251dcdf8f1570ee45f4`；base：`f0883948f78a9bf0a28290e21c7b1c3842b54cf5`（`main`）。
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
| 代码 | 正常/异常、错误传播、幂等、停止/恢复 | 两段正文 Python 在独立副本原样成功；八类错误输入拒绝，原库不变 |
| 产品闭环 | 用户可观察结果、Provider ack、安装/人工证据边界 | 实际产物、非空 typed reader 与浏览器记录支持工程闭环；R1/完整 UAT 保留人类 |
| 架构 | 七条不变量、事实所有权、依赖及信任边界 | 仅 docs；没有第二事实源、兼容迁移或自动外部执行；路径/issuer 前提明确 |
| 测试与反例 | 断言判别力、真实命令、变异归因、未验证范围 | 179/179 合同通过、0 skip；公开脚本八项拒绝控制通过；无新增产品代码变异项 |
| 工作项与设计 | issue 验收、重复追踪、ExecPlan、独立回滚、适度性 | #532 独立工程子项；#369/#73/#459 保留；0 代码/436 文档行，设计适度 |

## 审查证据与发现

### 2026-11-04 独立审查

复锁 head `3fab817d06375409f41ff251dcdf8f1570ee45f4`、base `f0883948f78a9bf0a28290e21c7b1c3842b54cf5`；review 和 reviewThreads 均为空。该 head 的 PR Fast Gate、Verify、Browser、Merge Gate、规则检查均成功。`Reconcile engineering state` 的取消属于全局并发协调；随后 `41802818121` 于 2026-11-04T08:52:13Z 触发并成功，按评审手册允许由后继全域重算覆盖。

- **P0 / 安全和原件**：全文检查停机、sidecars、只读源、排他新建、隔离原库和失败保留。流程要求先正常退出整个进程组，再核对主库/存在 sidecars 的打开者；不能以关闭浏览器代替停机。恢复前核对备份 SHA、integrity、FK、generation/schema，恢复后核对全表逻辑摘要。当前演练无 WAL/SHM/journal，未声称验证热备或异常 WAL 恢复。没有凭据、本机身份、内部系统或保密字样进入新增发布面；公开文档不含运行目录绝对路径和认证材料。
- **P1 / 实装和恢复**：读取 `.superpowers/backup-rollback/manifest.json`、安装摘要、product reader、逐阶段比较和停机导出回执。两份 tgz 摘要重新计算与文档相符；精确 source tree 分别为 `26f346f6` / `3ae73b90`，七份迁移及 Host 组合契约未改变。两份安装回执各有 12 个文件且全部相符；最终实际安装目录的 12 文件又与当前 tgz 原字节相符。三个回滚/恢复/换回当前阶段 reader 均为 316 项，完整 execution context 相同、ready/running/manual、同一 worktree 和 run 确认时刻；四份浏览器文本均有运行中与非空列表。比较回执证明 context/run/WorkItem 集合及 Git/用户文件未变；独立备份摘要为 `5cc60f44905a58b42277ef085656861870e875ef0fa6f8381dce5d68277ebcad`，隔离原库仍存在。五条停机回执是后补 transcript 导出，保留原 PID、明确 returncode=0 和历史绝对时刻 null；不把后补导出时间当实际停机时刻。
- **P2 / 公开命令与反例**：从 Markdown 原样提取两段 Python，在新的独立 scratch 中只复制保留备份，原样备份/原路径恢复均退出 0；验证副本隔离原件及独立备份未变。已有目标、损坏源、越界路径、符号链接、打开描述符、损坏备份、receipt generation 不符、缺失备份八项均拒绝，原数据库摘要不变。未接触演练原数据库、旧包或安装环境。该验证针对公开操作体；不是产品代码变异表，也不冒充新的官方 Host 演练。
- **P3 / 范围与适度性**：#532 的四项 AC 与父 #369 的人类裁决分离；#73/#459 仍 OPEN，release-gates 只添加入口链接。首次设置 pending/仓库结果 unknown、旧包来源不完整、临时 issuer 生命周期均已披露；没有在本 PR 断言根因或完整设置 UAT 成功。#449/#459 的实装接受与风险审计仍承接这类观察，未把已披露限制重复当新增缺陷。停机 Backup API 加原路径恢复足以完成本工程子项，无需引入服务、迁移或自动重试。

独立命令（在本工作区根）：

```sh
pnpm test:file tests/integration/storage-baseline-admission.test.js tests/integration/storage-restart.test.js tests/integration/harness-plugin-demo-artifact.test.js
node scripts/rule-checks.mjs disclosure f0883948f78a9bf0a28290e21c7b1c3842b54cf5
node scripts/rule-checks.mjs size f0883948f78a9bf0a28290e21c7b1c3842b54cf5
git diff --check f0883948f78a9bf0a28290e21c7b1c3842b54cf5...HEAD
```

结果：179/179、0 fail/skip；disclosure、size（代码 0 / 文档 436 A+D）、diff 检查通过。对六个变更文档逐一解析相对链接，全部目标存在；人工五类发布面检查通过。

## 结论与后续

本轮发现为 **0 × P0 / P1 / P2 / P3**，独立结论为 APPROVE；本子评审没有提交远端 review、issue 修改或 Git 提交。下一道门由协调者串行整合评审记录后重锁最终远端 head/base/checks/threads；若发生修复/rebase/新推送，旧 head 的本结论不自动覆盖新 head。#369/#73 的人类 R1-12、#449 的界面 UAT 和 #459 的当前候选风险判定继续保留。

## 协调者收尾

初始APPROVE已提交并回读。相对初始head的补充仅为本评审记录和计划授权说明；产品/测试/config逐字不变。独立组合检出`.worktrees/pr534-pr541-review-integration`从`f0883948`合入#534测试与#541生产/测试增量，`pnpm verify`通过3592+8、`pnpm test:browser`通过46/46，均零skip；这是本地源码组合证据，不是安装或发布接受。后续提交整理/rebase后仍须以实际新head核对门禁并重批。

当前main重放：base为#541合入`e6153dcb`；README计划插入冲突已保留两项索引，备份步骤/演练正文与原`3fab817d`逐字相同；本PR相对实际base没有任何非docs产品/测试增量。未把原实装演练升级为当前新包安装证据。

二次当前main重放：#534合入`a5f6e71a`后保留备份、浏览器恢复、策略准入三项completed索引；本PR相对实际base仍为纯文档，备份流程和原演练正文不变。前一次merge请求被base变更保护拒绝，未用旧base批准继续合并。
