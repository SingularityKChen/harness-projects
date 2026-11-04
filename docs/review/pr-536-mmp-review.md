# PR #536 MMP 交付评审

## 锁定事实

- 日期：2026-11-04（Asia/Singapore）。
- 工作区：`.worktrees/release-evidence`。
- 目标：Core 边界与发布证据；关注事实来源、入口覆盖、反例复现与人工门禁边界。
- 初始 head：`aec1ed039a3d4127fd94005d98c0706c4457a188`；base：`f0883948f78a9bf0a28290e21c7b1c3842b54cf5`（`main`）。
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
| 代码 | 正常/异常、错误传播、幂等、停止/恢复 | 待查 |
| 产品闭环 | 用户可观察结果、Provider ack、安装/人工证据边界 | 待查 |
| 架构 | 七条不变量、事实所有权、依赖及信任边界 | 待查 |
| 测试与反例 | 断言判别力、真实命令、变异归因、未验证范围 | 待查 |
| 工作项与设计 | issue 验收、重复追踪、ExecPlan、独立回滚、适度性 | 待查 |

## 审查证据与发现

- 已逐项核对`OPERATIONS` 23项、`handlersFor`与设置dispatch，审计的入口/owner表与当前source一致；无产品/测试/config增量。
- 本检出运行E1+E5+E6的14个具名文件：`pnpm test:file tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-host-authority.test.js tests/integration/harness-plugin-host-recomposition.test.js tests/integration/storage-baseline-admission.test.js tests/contract/harness-host-operations.test.js tests/e2e/runtime-access-browser.test.js tests/integration/harness-plugin-host-providers.test.js tests/integration/harness-plugin-repository-binding.test.js tests/integration/harness-plugin-workspace-setup.test.js tests/integration/workspace-setup-commands.test.js tests/integration/development-local-git.test.js tests/integration/planning-snapshot.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/harness-plugin-host-planning-mapping.test.js`，362/362、零skip。
- 从公开Markdown提取P273/P202/P309/P336/P341原样运行，退出依次1/1/1/0/1；四个失败均在具名缺陷断言，非依赖或解析故障。P273实际Host/manual `done`被Provider值覆盖（具体条目可能为todo/in_progress），P202双适配器旧投影5条，P309特殊own key丢失，P341 Ready/result_unknown；P336五控制各reports1且零unhandled。
- 已读取#533全部验收及#459/#73/#413边界，九个产品finding均有现存OPEN issue；本PR准确披露而非隐瞒这些缺口，不把已披露的既有缺陷当成本审计阻塞。#541未合入时仍不能豁免P273。
- 设计只增加证据矩阵与可执行反证，无新运行框架/策略/迁移，范围适度。六组1022是原作者观察；本轮独立复跑362与五探针，不声称重新执行全部1022。

唯一发现：**P2**，`docs/product/core-release-audit.md:5`的ExecPlan Markdown链接仍指向已不存在的active路径。`Path.exists`逐一核对本PR相对链接时该项失败；入口中断使读者不能沿审计首页找到执行依据。改到completed路径即可；未发现已有issue跟踪这条有界链接缺陷。

| 层 | 审查结论 |
|---|---|
| 代码/架构 | 纯docs，入口映射与现有source对应，无新增反向依赖/第二权威源 |
| 产品闭环 | 完成工程证据子项，保留真实产品风险、人类R1与安装/UAT缺口 |
| 测试/反例 | 362正式测试与五探针实际运行，预期失败和通过数分开 |
| 工作项/设计 | #533五AC有证据；仅关闭工程子项，九finding与父级均保留；无过度设计 |
| P0/P1/P2/P3 | 0/0/1/0；P2仅归档链接失效 |

## 结论与后续

待全矩阵完成后一次性提交 review。用户已对这四个 PR 明确给出条件式 rebase merge 授权；P0/P1 必须先修复并独立复评。

## P2 修复

已把首页执行依据改为现存completed计划；不改变原审计source、反证或产品行为。初始APPROVE review `5766350872`及唯一inline均已远端回读确认；提交API返回502但实际写入成功，未重发。独立链接复核及最终head批准另行记录。

独立复评确认原P2仅一次href替换、其余审计字节相同；当前六个变更/新增文档196个相对链接全部存在。评审计划另发现归档界限表述矛盾，已统一为最后合并门准备完成，实际merge ack由归档后的GitHub/会话记录承接；不提前声明合并。

## 后续source与最终内容复核

#541已合入`e6153dcb`后，本PR仅文档；原f088快照的五探针和E1–E6逐字保留，精确旧source独立检出方法已补齐。后续guard增量、原处Superseded、#273和R1边界均经独立复核；当前含guard检出实际运行正式policy suite10/10零skip。跨PR记录时态和归档边界中的内部表述也已修正，不提前声称尚未发生的merge。最终远端head仍需当前checks及独立批准。

当前main重放已包含#534，实际base为`a5f6e71a`；README审计、综审、浏览器与准入各索引均保留。相对实际base依旧零非docs增量，原f088探针正文不改，产品/测试source与已完整验证组合23034e42相同。

最后实际base更新为`dac07235`（含#535），README保留综审、审计、备份、浏览器、准入五项索引。相对该base零非docs增量；所有运行/测试文件与组合23034e42逐路径/blob/mode相同。原P2和语义增量已独立复评，最终新head的远端批准、checks与thread结算仍按真实回读执行。
