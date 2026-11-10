# PR #600 MMP 交付评审

观察日期：2026-11-10（Asia/Singapore）。初始 base `main@b8aa03af7e493ea4bb6c1748e70c31ea7815071b`；head `e91154d2415b4ae0b0c993d8ad2ce4e59139dfa1`，分支 `fix/storage-isolation`。本文件为独立评审证据。

## 风险矩阵（先于逐文件审查）

| 级别 | 代码与反例 | 产品闭环 | 架构与事实源 | 测试与验收门 |
|---|---|---|---|---|
| P0 | 主分支不可用、存量事实损坏 | 合并即无法交付 | 凭据泄漏、Planning 权威被覆盖 | 硬门禁被绕过 |
| P1 | 隔离/事务失效、重复执行、跨权限读取 | 用户无法完成声明的关键任务或假成功 | Host/Provider 权限、持久化或依赖边破坏 | 核心失败/恢复无有效证据，issue 闭环不成立 |
| P2 | 局部可恢复缺陷或独有反例遗漏 | 有绕行的次要体验缺陷 | 局部契约/维护成本 | 范围有限的证据或文档缺口 |
| P3 | 命名和可读性 | 文案小瑕疵 | 可选简化 | 链接与措辞精度 |

分层：完整 diff、调用链、失败路径、反例、设计适度、issue/重复跟踪、当前 checks 与全部 threads。代码测试通过不等于安装验证、人工 UAT 或 R1 接受。

## 证据与结论

独立 MMP 审查完成：固定 head 上未发现新增 P0/P1/P2/P3；可进入主控的远端最终回读和正式评审。本文不授权合并；正式评审账号与当前远端 head/base/checks/threads 由主控收口。

### 锁定事实与边界

- 逐层读完 14 个变更文件、Storage 调用链及共享套件；审查基于上述 immutable head/base，执行上下文为 `.worktrees/storage-isolation`。本地 `git status --short --branch` 只有本评审文档未跟踪；未改变 Git index、生产实现或测试的最终内容。
- 固定 PR 元数据关闭关联为 #311、#426，base 为 main、Ready、MERGEABLE；PR Fast Gate、Verify、Browser、CodeQL、PR size、Disclosure 均为 SUCCESS。旧重复 Rule checks/Issue policy 为 CANCELLED 且同名后继 SUCCESS。Create review session 为 FAILURE，属 #364 跟踪的独立回调流程；此条引用快照，主控仍须确认当前 run 的具体失败。
- 固定 threads.json 中 #600 reviewThreads 为空且分页完成。公开 issue 验收框仍未勾选；源码/测试支持验收项不等于 agent 已代人完成规划或发布接受。
- 代码/测试增删共 710 行，文档增删 122 行，均在计划与仓库门内。计划已在 completed 且 docs 索引存在，可整体 revert；没有 schema、迁移、Core API 或 Host ABI 改动。

### 矩阵结论

| 级别 | 代码、产品、架构、测试与工作项审查结果 |
|---|---|
| P0 | 未发现主分支不可用、存量事实破坏、凭据落库或 Planning 权威改变；无新依赖边或发布门禁控制路径。 |
| P1 | 输入在排队前捕获，输出独立快照；Fake staged 状态拥有独立副本，成功后提交 staged 实际状态，失败不替换根数据；事务调用与排队执行均复查 token。身份、关系、revision/fence 与原子约束保持，未发现绕过普通 Storage 端口的别名。 |
| P2 | 逐项核对 constructor、未知实现配置隔离、尚未提交挂载、非枚举约束字段、原型/符号拒绝、重启、失败后恢复及旧 tx 后续使用，未发现新增可复现缺陷。 |
| P3 | 未发现需要独立意见的可维护性或文档缺陷。显式逐端口捕获及专属配置解析复用合理，无通用 Proxy 框架或机械拆类。 |

完整产品因果链是「调用方提交/取得记录 → 可变别名不再改写已存事实 → 后续事务与重启读回仍一致」。本批实现的用户结果是工程事实边界可靠；不涉及 UI Saved、外部 Provider ack 或规划状态推进。

### 工作项独有验收与已有跟踪

- #311：21 行普通端口矩阵在两适配器覆盖 put 完成后改入参、get/list 成员深层修改和阻塞队列期间的入参修改；另有实体/观察、constructor、显式 inspection/injection seams 与事务/修订约束证据。四处旧 raw state 消费者均迁到显式 seam。
- #426：共享提交/回滚后旧 tx 读写拒绝、漏 await 的迟到读写拒绝；既有 SQLite close 专属案例保留，按当前 CLOSED/SETTLED 文本断言；SQLite foundation 的运行期 probe 回读真实提交/回滚事实与 fence，移除注册会失败。
- open-issues 快照中的 #424/#425 是 identity/membership 与 observation/relation 拒绝约束，#223/#417/#595/#596 是基线整理，均不是本批别名/过期句柄闭环的重复 issue；#201 是父验收，仍独立。TD-027 只收口 Fake 普通状态面，SQLite raw-db 仍开放；Fake 事务 work 调根实例可能自等的旧分叉也未被本批宣称解决。没有发现需新建 issue 的新增缺陷。

### 独立命令证据

以下均在上述 worktree、固定 head 执行；只使用现有套件，没有把实现自述的全量结果当作本次独立实跑。

| 命令 | 真实结果 |
|---|---|
| `pnpm test:file tests/contract/storage-contract.test.js tests/contract/storage-connector-account.test.js tests/integration/execution-run-refresh.test.js tests/e2e/client-sync.test.js` | exit 0；292 tests /292 pass /0 fail /0 skipped /0 todo。 |
| `pnpm test:file tests/integration/storage-restart.test.js` | exit 0；11 tests /11 pass /0 fail。 |
| `pnpm run boundaries` | exit 0；9 tests /9 pass /0 fail。 |
| `pnpm run typecheck` | exit 0；`tsc --noEmit`。 |
| `git diff --check b8aa03af7e493ea4bb6c1748e70c31ea7815071b...e91154d2415b4ae0b0c993d8ad2ce4e59139dfa1` | exit 0，无输出。 |

最终树变异整表仅执行一次，入口为 `node scripts/review-mutate.mjs <local-spec.json>`；spec 运行于本机临时目录，command 为 `node --test --test-reporter=spec tests/contract/storage-contract.test.js`。每个 mutant 均有 killedBy；退出码 0，SUMMARY 为八条 KILLED，夹具已逐字节还原，并验证还原后基线通过。

| 变异 | 指定 killedBy / 实际失败用例 | 结果 |
|---|---|---|
| M1 移除 Fake putWorkspace 入队前复制 | `排队快照 workspace` | KILLED |
| M2 移除 Fake 根读输出复制 | `快照 workspace 输入与 get/list 成员隔离` | KILLED |
| M3 移除 Fake 队列执行时 token 检查 | `事务执行时再查 token` | KILLED |
| M4 移除 SQLite putProviderBinding 入口复制 | `排队快照 binding` | KILLED |
| M5 删除 SQLite foundation 注册 | `tests/contract/storage-contract.test.js`（after hook 的真实 foundationRuns 缺失断言） | KILLED |
| M6 删除 constructor 最终状态复制 | `MemoryStorage 公开 constructor 捕获 seed` | KILLED |
| M7 删除 staged 实际状态提交 | `MemoryStorage 公开 constructor 捕获 seed` | KILLED |
| M8 配置先 clone 再检原形状 | `配置复制前拒绝原始非法容器`（两适配器） | KILLED |

这些有限反例支持本批 Storage 合约；不证明任意输入或调度的完备正确性。本次未重复全量 verify、安装验证或人工 UAT；PR 快照中的 hosted 绿与作者全量结果另列，不能替代 #201、R1 的人类接受。

## 主控收尾与当前版本门

2026-11-10，本会话用 `gh-review`（Singularity-AI-Bot）在初始不可变 head 提交完整 APPROVE，无 inline findings；开发和合并使用 `gh` / git（SingularityKChen）。未发现待修复代码项，收尾仅登记证据、归档决策与整理提交。实现会话「筛选紧急重要 Issue」已结束；本会话依据用户对 #600–#602 的直接条件授权接管无阻塞分支。

用户原话：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”

每个原始 head 保存在 `refs/backup/pr600-before-mmp-review-20261110`。公开提交收敛为一个交付闭环，保留原实现与测试，review 文档随该 PR 合入。初始三分支完整前序已在仓库外临时 clone 按 #600 → #601 → #602 重放，未出现冲突；该顺序不建立 Planning 依赖。每次前序合入后，以真实 main 接合下一条，相关验证与当前托管 CI 重新判定。

最终门：`gh pr view 600 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,statusCheckRollup`、当前全量 review threads 与双向 issue 关联；期望 main、Ready、当前 head 独立批准、无未处理线程、PR Fast Gate 和执行 lane 通过。先比对产品/测试 blob、publication/size 和提交，再使用精确旧远端 head lease。合并必须指定 expected head 与 `merge_method=rebase`，并回读 state、mergeCommit、issue state 及合入 tree。Create review session 的 HTTP 404 由 #364 跟踪；取消的重复 Rule checks 只在同 head 后继通过时豁免。

外部写入：actor 分别为上述两个账号；目标为 GitHub repository `SingularityKChen/harness-projects` 的本 PR 与其关闭工作项；幂等键 `mmp-review-pr600-20261110`（已存在相同结果时不重复写）。工程验收勾选保留当前 issue 文本和原有跟踪字段，不改变 Project Status、原生依赖或父项接受。最终提交审查与托管结果以当前 head 回读为准，不继承初始批准。
