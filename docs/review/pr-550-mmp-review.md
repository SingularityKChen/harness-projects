# PR #550 MMP 交付独立评审

> 观察日期：2026-11-06；结论：在已批准的 #548 边界内，无新增 P0/P1/P2/P3 actionable finding。

## Purpose / Big Picture

核查显式 Draft 创建是否形成可独立验收、合并、回滚的工程闭环。最小证据是用户选择到达单次原生 mutation、原意图可持久恢复、首次确认严格且未知结果不会盲重试。工程结论不代替安装件 Desktop、真实模型、父项或 R1 人类验收。

## Context and Orientation

本轮独立对象：base `609463d8ee78a0cc83352512994e2b943e6e57bc`；head `6a28a7a99d7bc78dc1354093c110740a9f3f48bd`，分支 `feature/draft-pull-request`，工作上下文 `.worktrees/iteration9-draft-pr`。开始与结束均核对 HEAD，初始工作树干净。元数据快照记录 `Closes #548`、两个提交、无 review threads/comments/reviews；当前托管 checks、owner 与外部写入由主评审统一回读。

采用 Superpowers、Qian Systems Router 与 First Principles Development：先确定用户结果和权威来源，再沿接口及反馈路径审查；最高风险是 Draft 意图丢失、未知结果错误确认，以及把初始创建事实与后续 Ready 状态混同。

## Design / Spec

详细 diff 之前先建立以下矩阵；表内为待验证风险，不是发现。

| 层 | P0 | P1 | P2 | P3 | 最小证据 |
|---|---|---|---|---|---|
| 代码 | 破坏创建状态机/main | Draft 身份混淆、未知盲重试、错报 Saved | 模式锁定/错误恢复不完整 | 可读性或重复 | 端到端追踪与故障反例 |
| 产品 | 自动改 Planning/发布门禁 | 用户意图丢失、Provider 未确认即 Saved | 文案/切换模式不一致 | 帮助说明 | #548 各验收项与真实路径 |
| 架构 | 第二权威源/信任边界突破 | 意图和当前事实混同、跨域依赖 | 不必要扩张 | 命名与职责 | 七不变量、存储与 Ready 后读取 |
| 测试 | 门禁绕过 | 高风险故障无判别断言 | 假阳性/用例缺口 | 重复用例 | 真正执行的窄测试与探针 |
| 工作项 | 范围破坏 main | 核心 acceptance 未闭合 | 重复已跟踪问题/证据差异 | 表述细节 | #548、ExecPlan、现有反馈 |

审查方案采用既有创建/恢复状态机，拒绝为了 Draft 建立第二命令、状态机或转换流程。当前增量为显式布尔及来源事实，职责和维护成本与目标相称，没有发现应为审美而重构的单元。

## Global Constraints

仅本评审文档与根忽略目录 `.superpowers/pr549-551-mmp-review-20261106/agent550/` 写入；没有修改产品/测试源码、Git 状态或外部系统。正式 source mutation 验证未执行，因为本子评审明确禁止代码修改；下述独立探针不是 mutation-kill 证据。

## Plan of Work

1. 锁定 head/base 与初始状态，先建矩阵；逐层追踪代码、产品、架构、测试与工作项。
2. 运行下列窄测试及独立反例，复核实际输出；新增录制字段另跑读取契约。
3. 形成全部结论，一次回传主评审；回滚只需撤销本评审文档，探针只操作临时测试数据库。

## Validation and Acceptance

全部命令在上述 head 的工作树根目录执行。原始日志保存在 `Global Constraints` 所列忽略目录。

| 命令 | 本轮实际结果 |
|---|---|
| `pnpm test:file tests/contract/development-github-create.test.js tests/integration/create-change-request.test.js tests/integration/change-request-operation.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/contract/ui-create-change-request.test.js tests/contract/development-contract.test.js` | 263/263，0 failed/skipped；`scoped-tests.log` |
| `pnpm test:file tests/browser/workspace-execution.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/harness-plugin-artifact.test.js tests/contract/package-boundaries.test.js` | 56/56，含生产执行 browser 4 项、边界 9 项；`browser-abi-boundaries.log` |
| `pnpm test:file tests/contract/development-github-contract.test.js` | 33/33；`recorded-read-contract.log` |
| `pnpm typecheck` | exit 0；`typecheck.log` |
| `node --test ../../.superpowers/pr549-551-mmp-review-20261106/agent550/probes.test.mjs` | 4/4；`probes.log`，前三项为独立正/反例，第四项为旧数据影响范围测量 |
| `git diff --check 609463d8ee78a0cc83352512994e2b943e6e57bc...6a28a7a99d7bc78dc1354093c110740a9f3f48bd` | exit 0 |

| #548 验收主题 | 审查证据与结论 |
|---|---|
| 显式选择、普通默认 | UI checkbox 默认 false，切换后按钮及提交值一致；client 捕获一次并归一，Host descriptor 追加参数、controller/Core 白名单及 Provider mutation 同步。真实 Host 组合 true/false 正控与 browser 均通过。 |
| 持久与请求身份 | Core canonical、marker 对应的请求身份和 `externalIntentSnapshot` 均包含归一布尔；SQLite restart、改同 key/未决槽位模式冲突、caller mutation、非法值零派发断言通过。 |
| 首次确认与未知恢复 | ack 必须已知匹配；observer 先完整统计身份候选，再验证唯一候选的 list/get Draft。缺失、反值、分页不全、混合 Draft 重复身份均不能 Saved；resume 没有创建或转换入口。 |
| UI 锁定与上下文变化 | pending 冻结选择，未知显示持久原摘要；scope/creator/connection 更换丢弃迟到结果，恢复只传 operationId。工作项切换及 stale lookup 覆盖通过，仓库共用同一 scope owner 判据。 |
| 已确认后 Ready | Saved 恢复沿 confirmedRef 与本地授权/目标校验，不再次要求初始 Draft；原摘要明确是请求类型。持久重启后平台 false 的测试仍定位同一 PR，mutation count 不增。 |
| 系统边界 | UI 不调用 Provider；Host/Core 持有权威；复用既有 lineage、原子结算与访问围栏；没有新增 Planning Status、自动 Ready/merge、secret 或第二身份源。 |
| 交付范围 | 25 个变更文件，code/test/config 增删 317 行，文档 219 行；两提交、同仓 #548 关联，ExecPlan 已自包含归档；完整产品 UAT 独立保留。 |

独立探针额外核查：跨两个 list 页、同 marker 且 Draft 相反的两个身份必须 unknown 且零 exact-get；普通 PR 首次未知后 exact-get 变 Draft 必须 unknown；client omitted 与 false 请求共享一个归一后的在途调用。

## Progress

- [x] 2026-11-06：锁定事实并先建 P0–P3 矩阵。
- [x] 2026-11-06：完成所有变更文件及关联调用路径、失败恢复、工作项验收与设计适当性审查。
- [x] 2026-11-06：完成 352 项维护中测试、4 项探针、typecheck、diff-check 并归档证据。

## Surprises & Discoveries

旧实验数据的影响范围比“仅原操作不可恢复”更广：在临时 SQLite 中先创建两条有效操作，再仅从第一条 `input` 删除 `draft`，第二条当前形状 Saved 操作的 exact-ID 查询也返回 `blocked/invalid_operation`，resume 返回 `conflict`，mutation 仍为 2。原因是 `packages/storage/sqlite/src/storage-execution.ts` 的 `listMutationAttempts` 先解码全工作区行，`packages/capabilities/src/storage.ts:153` 拒绝缺 Draft 的历史形状，Core 尚未按目标过滤即失败。

这是明确保留的“不支持旧实验形状、人工处置”边界，不是迁移已交付；不能声称该限制只影响原行。Probe 测量不删除账本、不重发。主评审核对原人类范围及 ExecPlan 的无旧数据兼容决定后，将其作为已接受限制记录，而非要求扩大本 PR 实现兼容框架。

## Decision Log

2026-11-06 / 独立评审：按行为及可验证用户结果评估，不把全绿测试视为 Desktop 或产品接受。三个维护中测试组覆盖受影响消费者，录制读取契约专门验证新 fragment/hash；不重复无风险信号的全仓套件。

2026-11-06 / 独立评审与主评审：上节旧形状影响范围保留为限界。#548 与实现 ExecPlan 已明确未发布产品无旧实验数据迁移/兼容要求；跨不支持行隔离属于额外韧性工作，当前不新增 actionable finding。

## Idempotence and Recovery

未知只读恢复，同 key/未决槽位改变模式拒绝；外部事实与本地结算分别确认。Head/base 变化后本结论必须按新对象重评，不能沿用本次 tests 或元数据。整 PR 撤销不会撤销已创建的外部 PR。

## Interfaces and Dependencies

已追踪 `packages/ui/src/create-change-request-section.ts` → `packages/client/src/create-change-request.ts` → `apps/harness-plugin/src/{client,host-operations,host-composition}.ts` → `packages/controller/src/commands.ts` → `packages/core/src/create-change-request.ts` → GitHub Provider/decoder 与 Storage 快照及 SQLite 行读取。没有引入反向依赖或 schema 迁移。

#545 的模型/安装观测、#72/#143 的父项验收和 #364 可选 review endpoint 失败均已有独立归属，不重复作为本 PR 缺陷；当前 hosted checks 的判定由主评审核对实际运行，不由本地结果替代。

## Outcomes & Retrospective

P0=0、P1=0、P2=0、P3=0 新增 actionable findings。当前工程闭环可进入主评审的最终权限、托管 checks 与合并授权门。验证为合成 GitHub mutation、录制读取回放及本地真实 Git/SQLite/Host/browser；没有真实创建测试 PR、模型调用、Desktop 人类走查或发布裁决。

## 当前 main 接合复评（2026-11-06）

#549 已 rebase merge，实际 base 为 `af4a869555759617bf0e84481766b74741519312`。接合源码候选 `088d33cd3f06b4791f1c9850dc8018c036f223b8` 在本工作树运行：

- `pnpm test:file tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/change-request-operation.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js`：103/103。
- `pnpm typecheck`：exit 0；`git diff --check origin/main...HEAD`：exit 0。
- 另一名独立评审者复核两份 ABI 断言与完整预演字节一致，另跑 18/18；任务参数 6 个、创建参数 8 个，全部正反例保留，没有截断或丢失测试。
- 除 #551 专属五个 Markdown 路径外，全部 476 个产品/测试/配置 manifest 路径与已验证组合一致。后续补本节的文档提交不修改这些文件。

初始 review 表格只代表原 immutable head，不能当作当前托管 CI。最终发布对象通过 `gh pr view 550 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,reviewDecision` 重建，要求当前 head 的 PR Fast Gate 成功、评审账号对当前 head APPROVE、零未决线程，才执行带预期 SHA 的 rebase merge。#548 工程关闭与旧实验数据限制、人工父项接受保持上述边界。

## Bottom Change Note

2026-11-06：先记录风险矩阵，再补本轮独立路径分析、352 项维护中测试、4 项探针及已接受的旧形状影响范围；无产品或 Git 修改。

2026-11-06：补实际 main 接合候选、103 项定向验证和独立 ABI/manifest 复评；初始版本证据保留为历史范围。
