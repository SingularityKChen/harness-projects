# MMP-Core 首发范围与证据责任

> 本页是仓库内 MMP-Core / 后续范围分级的唯一权威入口。范围来自 2026-10-29 对 #413 的人类批准；本页整理准则与证据责任，不替代 #459 完整边界审计、R1 判定或人类发布决定。

2026-11-04 当前源码的操作、准入、开放 findings 与 R1 证据见[候选边界审计](core-release-audit.md)。该观察含未修反例与未决缺口，不表示发布接受；本页下方旧操作清单是当时快照，当前全集以审计页动态回读为准。

## 首发边界

当前 Core Host 的持久规划策略支持集仅为目标工作区的 `provider_authoritative`；目标缺席时允许设置入口，新建工作区默认使用该策略。`host_authoritative` / `manual_only` 策略会在 Provider 构造、映射发现、首次同步及定时器创建之前明确拒绝，保留业务数据、策略、配置和凭据句柄，等待支持原策略的版本。

Host 策略拒绝的数据库字节原样保证，限定为打开前已标记当前 generation `3`、且通过既有 Storage schema/generation 准入的库。完整合法但未标记（`user_version=0`）的库仍先经过 Storage 既有的 `0→3` 元数据标记，再进入 Host 策略准入；该步骤会改变数据库字节和版本标记。本改动保持这项原合同，不新增迁移、策略转换或删库，也不扩大 legacy/untagged 兼容义务。

每代设置重装配复用同一准入：已检测到不支持策略时停止当前 Host 的旧图和更新流，已提交的设置仍作为已发生事实保留；普通装配失败继续既有回退与重试。该门不轮询任意外部 SQL 变更，也不裁决 #273 的完整 policy × incoming 人类语义矩阵；通用 Core 三策略合同和 R1 判定不因此改写。

MMP-Core 候选路径是：已安装的现代 Harness UI 中，从 GitHub Project 取得类型正确的 WorkItem 和详情，执行 Start Work，进入真实执行会话或诚实的人工备用流程，安全创建 PR，并在详情中查看 PR/CI 谱系；同时提供基础连接、设置、访问和恢复能力。候选仍须以实际源码、构建产物、配置与运行证据确认，不由 Project 的 `TargetRelease` 标签、父项关闭数量或本页的范围映射自动接纳。

原完整工作台范围保留在后续阶段：Planning 写入与编辑、Board/Kanban、Backlog/Sprint、Roadmap/Milestone、LocalPlanning、完整关系与诊断、完整设置与部署能力、工作方法预设和产物契约。后续分类不取消原 issue 或验收，不证明功能在 Host、Provider、存储、策略、数据库或其它入口不可达，也不接受任何已知安全或正确性问题。

范围回答本次候选包含什么；[纵向链路](vertical-path.md)回答用户动作；[R1 门禁](../architecture/release-gates.md)仍回答版本能否发布。R1 是全部满足的合取，无法判定等同不满足，且不得由 LLM 判定。Core 分期不改变十二条条件、十项不变量、E1 裁决或任何人类判定者。

## Host 声明快照

以下是 `apps/harness-plugin/src/host-operations.ts` 中 `OPERATIONS` 的静态声明盘点，观察于 2026-11-02。它列出 20 个 unary 操作和一个 stream 操作，并概述其当前产品入口与主要拥有源码。它不是运行时可达性、授权、策略、工作区/数据库准入或安全审计结果。用户入口与测试引用用于定位后续核验，不代表对应行为已在当前发布候选上通过。

| Host 操作 | 当前候选路径 / 用户入口 | 主要源码与证据入口 |
|---|---|---|
| `baseline` | Core 工作区基线；由 workspace view 消费 | `apps/harness-plugin/src/host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-roundtrip.test.js` |
| `bootstrapWorkspace` | Core 首次规划读取与工作区引导 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-planning-refresh.test.js` |
| `refreshPlanning` | Core 规划快照刷新 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-planning-refresh.test.js` |
| `getExecutionContext` | Core 工作项详情中的执行上下文 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-execution.test.js` |
| `refreshExecutionRun` | Core 执行状态刷新 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-execution.test.js` |
| `getStartWorkOptions` | Core Start Work 可用选项 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-start-work.test.js` |
| `startWork` | Core 启动执行或返回诚实人工备用 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-start-work.test.js` |
| `createChangeRequest` | Core 安全创建 PR | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-change-request-operation.test.js` |
| `getChangeRequestOperation` | Core 创建操作状态查询与恢复入口 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-change-request-operation.test.js` |
| `resumeChangeRequest` | Core 对既有创建操作进行恢复 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-change-request-operation.test.js` |
| `createWorkspace` | 基础设置：创建工作区 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-setup-client.test.js` |
| `connectAccount` | 基础设置：连接账号 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-setup-client.test.js` |
| `bindPlanningSource` | 基础设置：绑定规划来源 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-setup-client.test.js` |
| `bindRepository` | 基础设置：绑定仓库 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-setup-client.test.js` |
| `installExecutionBindings` | 基础设置：安装执行绑定 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-execution.test.js` |
| `getWorkspaceSetup` | 基础设置读取 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-setup-client.test.js` |
| `getPlanningMapping` | 基础设置读取：规划字段映射 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-planning-mapping.test.js` |
| `setPlanningMapping` | 基础设置写入：规划字段映射 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-host-planning-mapping.test.js` |
| `getDeliveryProjection` | Core 工作项详情中的交付谱系读取 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-delivery-lineage.test.js` |
| `refreshDeliveryFacts` | Core 交付事实刷新 | `host-composition.ts`、`client.ts`；`tests/integration/harness-plugin-delivery-lineage.test.js` |
| `watch` | workspace view 的状态更新流 | `host-composition.ts`、`client.ts`、`workspace-watch.ts`；`tests/integration/harness-plugin-host-watch.test.js` |

操作数量可在仓库根目录重算：

```sh
rg -n '^  [A-Za-z][A-Za-z0-9]*: \{ mode:' apps/harness-plugin/src/host-operations.ts
```

上述列表只说明这些名称出现在该 Host 声明。当前清单没有 `writePlanningStatus`、`applyPlanningStatus`、`cancelExecutionRun` 或 `setSourcePolicy` 这些操作名；这只能证明它们未出现在所列 `OPERATIONS` 声明中，不能推出所有宿主、内部 API、持久策略或数据库路径都不可达。UI 中未显示入口也不是边界拒绝证据。

本页没有逐项验证所有 operation handler、调用者授权、workspace/policy/database admission 或持久化数据兼容。特别是 `packages/storage/sqlite/src/migrate.ts`、Host composition 与各 Provider 的行为须由 #459 在实际候选上核验；若没有可复跑的不可达/明确拒绝证据，状态保持“未核对”。不强制改写已存策略、不静默迁移或删除旧库，也不以这里的范围标签授予兼容例外。

## R1 证据责任矩阵

下表按 [release-gates.md §2](../architecture/release-gates.md) 原有编号列出证据类别、判定者与当前缺口。条件文字及判定者的权威原文仍只在 release-gates；此表不改变其含义，也不构成通过记录。

| R1 | 必须保留的证据责任 | 判定者 | 当前缺口 / 回读入口 |
|---|---|---|---|
| 1 | Gate E1 身份与同步幂等裁决及契约证据 | 人类伙伴 | 对当前候选的适用性仍须人类确认；回读 `AGENTS.md` §1.2 与 `tests/contract/` |
| 2 | 空库迁移成功、可重复，失败不留版本记录 | CI | 当前目标 head 上的非空迁移用例、重复执行和失败路径证据待核对；`tests/integration/` |
| 3 | release-gates §2.1 十项不变量逐条有自动化断言且无凭据/网络通过 | CI + 人类评审 | 沿用 §2.1.1 的历史观察，不代表当前候选复跑；十项责任见下表 |
| 4 | 目标 head 的 PR Fast Gate 连续两次通过并由人类回读 | CI + 人类回读 | 当前 head/checks 未在本子项判定；按 `docs/development/ci.md` 回读 |
| 5 | Merge Gate 的 integration 与 e2e 各有非空用例且目标 head 连续两次通过 | CI + 人类回读 | 当前 head/checks 未在本子项判定；按 `docs/development/ci.md` 回读 |
| 6 | P0/P1 正确性缺陷为零且风险矩阵无未决项 | 人类伙伴 | #459 仍须逐项分类当前开放 findings；Post-Core 标签与 known issues 不接受风险 |
| 7 | 不存在本地缓存静默覆盖外部权威的已知路径 | 人类评审 | 当前候选写路径与 unknown/conflict 证据待核对；见 `tests/README.md` §2 第 2 类 |
| 8 | 不存在 LLM 参与状态控制的已知路径 | 人类评审 | 当前代码路径审查待完成；依据 `AGENTS.md` §1.1 第 5 条及对应契约测试 |
| 9 | Provider 离线与权限撤销场景已验证 | CI + 人工走查 | 当前候选故障注入及撤权证据待核对；见 `tests/README.md` §3 |
| 10 | Start Work 补偿、人工备用、重试唯一性与重启恢复已验证 | CI + 人工走查 | 当前候选完整序列证据待核对；现有测试不代替本项复核 |
| 11 | sandbox 项目上的人工 UAT 逐步走通并留记录 | 人类伙伴 | 未执行；#143/#449 与真实产品验收保持独立 |
| 12 | 备份/回滚文档及一次实际演练记录 | 人类伙伴 | #369 演练及当前 artifact/bundle 的恢复证据待完成 |

目标时间仅是计划：2026-11-06 建议 RC cutoff，2026-11-07 至 11-08 进行 UAT、修复、备份/回滚和人类 go/no-go，目标日期为 2026-11-08（Asia/Singapore）。缺少任一门禁即 at risk/no-go；staffing、reviewer 与 UAT 可用性尚无本页可采信的人类确认。

## 十项不变量的逐条核对责任

以下十项名称与 [release-gates.md §2.1](../architecture/release-gates.md) 保持一致。source/test 路径只是重新核对的入口；目录、测试存在或旧快照都不等于当前候选满足该不变量。

| # | 不变量（原文名称） | 重新核对的 source / test 入口 | 当前责任状态 |
|---|---|---|---|
| 1 | 一个工作空间同一时刻只有一个 Planning 事实源 | `AGENTS.md` §1.1；当前 Host/Storage admission 与 `tests/` 对应断言 | 当前候选逐条核验待 #459；不得由静态 operation 清单推断 |
| 2 | 成员关系与内容身份分离 | `tests/README.md` §2 第 1 类；对应 `tests/contract/`、`tests/integration/` | 沿用历史观察；须回读用例断言及当前运行结果 |
| 3 | PR-backed 条目不得生成第二个工作项 | `tests/README.md` §2 第 1 类；identity convergence 用例 | 沿用历史观察；须确认当前目标候选覆盖 |
| 4 | Draft→Issue 内部身份不变 | `tests/README.md` §2 第 1 类；对应 identity 用例 | 沿用历史观察；须确认生产入口断言及当前运行结果 |
| 5 | 规划与工程正交 | `AGENTS.md` §1.1 第 3 条；状态所有权/策略用例 | 三类策略下所有相关事件仍需按当前契约复核 |
| 6 | 外部写入未确认不得显示已保存 | `AGENTS.md` §1.1 实现级硬约束；unknown/conflict 写路径用例 | 当前候选持久意图、Provider 确认与恢复仍待完整核验 |
| 7 | 重复事件处理 N 次等同一次 | `tests/README.md` §2 第 4 类；重复观察用例 | 历史观察不代替当前候选用例和无网络运行结果 |
| 8 | 乱序观察不得覆盖新观察 | `tests/README.md` §2 第 4 类；乱序观察用例 | 历史观察不代替当前候选用例和无网络运行结果 |
| 9 | 能力缺失时 Core 必须拒绝命令 | `AGENTS.md` §1.1 第 5 条；Provider 能力契约/命令入口测试 | 入口覆盖范围待核对；单条负例不能代表所有命令 |
| 10 | Start Work 重启后可恢复 | `tests/README.md` §2 第 5 类；重建 Core/Storage 用例 | 当前真实 Storage、安装候选与重启路径仍待核验 |

不得把历史 `已断言`、局部测试、SSR、closed child 或 Core/Post-Core 分类当作 release-gates 的通过判定。每个不变量仍按 R1 第 3 条由 CI 和人类评审共同核对；每个 R1 人类判定仍由上述权威表指定的人类承担。

## 未完成的人类边界审计

#459 的完整审计仍负责对实际 shipped Host、workspace/policy/database admission、当前 UI 入口和所有开放正确性 findings 逐项分类。重点 issue 为 #191、#202、#215、#273、#309、#313、#336、#340、#341。每个问题须留可复现的当前边界不可达/明确拒绝证据、保留阻塞修复，或按 release-gates §3 由人类记录精确例外、理由、残余风险和失效日期。没有任何例外由本页或 `Post-Core` 分类自动产生。

以下证据仍是独立验收项：#450/#451 production-composed browser proof；#449 已安装现代 Core UI 的人类接受；#143 Demo 与 #124/#72 的实际产品证据；#369 备份/回滚演练；当前安装 artifact、bundle 与 schema/旧库拒绝证据；真实 staffing/review/UAT availability；最终人类 go/no-go。文档范围映射不关闭上述项目，也不关闭 #459、#73 或其它父验收。
