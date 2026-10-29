# PR #455 MMP 交付评审

## 锁定事实

- 日期：2026-10-29。head：`86d5fa151f3da971cbfba7ba1da9c9c55c0ad13b`；base：`main@06d929017c8551e6b106fcbe7651f12ac26e4642`。
- 执行上下文：`.worktrees/start-work-owner-fencing`；评审账号 `Singularity-AI-Bot`，开发账号 `SingularityKChen`。
- 阶段：先建立风险矩阵，再检查代码、产品、架构、测试、反例和工作项。独立审查只改本文件、运行隔离探针与验证；未修改产品源码、提交或远端状态。
- 下列结论只适用于上述不可变 head/base。主控另行核对当前远端 head/base、全部 threads、checks 和最终 review 事件；这些外部事实不由本地测试替代。

## 风险矩阵

| 级别 | 代码与反例 | 产品闭环与架构 | 测试与工作项 | 本轮结论 |
|---|---|---|---|---|
| P0 | 审查 schema 世代、完整准入与回滚 | 无新增权威源、凭据或发布门禁路径 | 旧世代及伪装旧形状双入口拒绝，全库不变 | 未发现新增 P0 |
| P1 | 审查 claim、分步、settle、主/人工 run、迟到验证的 owner 边界 | 持久 owner 与依赖写同事务；旧调用不报 Saved、不覆写赢家 | Fake/SQLite 屏障、正反控、跨句柄探针、耗尽与持久往返 | 未发现新增 P1；#420 的本地 fence 闭环成立 |
| P2 | 审查错误码、无句柄 Unknown、失败与本地 I/O 回滚 | 正常开始及过期接管可完成；Ready 缺 run 仍诚实降级 | 故障注入命中真实 tx，原有 #193/#204/#421 不重复立项 | 无新增 P2；既有边界仍须 #459 发布裁决 |
| P3 | 审查 helper/代际 plumbing、ADR、计划归档与导航 | 复用现有 transaction，无通用锁服务或新 CAS port | 文档 self-contained；原 diff 407 code/test、217 docs 行 | 无需为风格或 LOC 扩大修订 |

## 分层证据与反例

### 状态所有权与闭环

- 目标是让 lease 允许接管后，存活旧调用不能再结算本地事实；租约只决定能否接管，generation 决定谁能结算。`packages/core/src/start-work.ts:99–114` 的正 safe-integer 代际与事务 helper 符合这个区分。
- claim 在同一事务读取原代际、递增并写入；Ready/Failed 后仍保留。分支/工作树步骤、最终 context+relations+attempt、主执行及人工执行落账均经 owned transaction。Provider I/O 保持在事务外；不以本地锁声称外部恰好一次。
- 主/人工既有 run 的复用在 owned transaction 中读取（`packages/core/src/start-work.ts:333`、`:360`）；迟到 Ready 验证降 Failed 前复判 generation/status/branch/worktree（`:431–438`）。没有发现先比较再根实例写的耐久窗口。
- Fake/SQLite 均拒绝 0、负数、小数、超 safe integer、NaN、Infinity、null 和字符串代际。新 owner 第 2 代能持久重开；MAX_SAFE_INTEGER 耗尽时拒绝，未新增本地或外部写入。
- Fake/SQLite 的 live-owner 屏障分别覆盖 claim、branch ack、worktree ack 与 settle；31 秒后由另一 key 经真实 Core 命令接管，释放旧调用后 context/relations/run/attempt/revision 的赢家全快照不变。租约内正控不增代。
- 另用两个预先打开的独立 SQLite Storage 句柄组装 Core，旧调用停在 worktree ack，新句柄 31 秒后成功接管；释放后旧调用为 `unknown/result_unknown`、generation=2、旧 attempt 仍 pending、赢家全库快照不变。探针只使用隔离临时库。
- Ready/run 后继测试明确使用 Storage 协议 fixture；当前正常命令不会在 Ready 缺 run 时接管。它们只证明结算协议，不能当作外部 start 唯一或正常公开接管路径的证明。正常用户的分支/工作树供应与已有恢复路径由聚焦测试及跨句柄命令探针验证；未运行本轮安装 Host 人工走查。

### 数据库与架构

- `003_control_facts.sql` 增加 nullable 的整数 generation/CHECK；七份 SQL 数量未变，当前 schema generation 为 2。gen1 旧库、伪装成 gen0/gen2 的缺列旧形状均从 migrate/factory 两入口拒绝，schema/数据/账本/user_version 不变。
- generation optional 限于无主的 Storage 记录；生产 claim 生成正整数。没有迁移兼容分支、自动 ALTER 或删除用户数据。回滚需匹配旧 artifact 与原备份库，不能让旧程序降代接管新库。
- 改动集中在 Start Work 编排、Storage 契约与两适配器；现有 transaction 是唯一原子域。Host 权威、规划/工程轴正交、关系沿谱系与层级依赖保持；无需引入分布式锁、第二事实源或独立 CAS 服务。

### 本轮实际验证

命令均在上述执行上下文、上述产品源码上运行；源码变异完成后逐字节还原，最终 tracked 产品树与 head 一致。

| 命令 | 观察 |
|---|---|
| `pnpm test:file tests/integration/start-work-owner-fencing.test.js tests/e2e/start-work-recovery.test.js tests/contract/storage-contract.test.js tests/integration/storage-baseline-admission.test.js` | 343/343，0 fail/cancelled/skipped/todo |
| `pnpm test:file tests/integration/start-work-request-binding.test.js tests/integration/start-work-step-recording.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/migration-runner.test.js` | 132/132，0 fail/cancelled/skipped/todo |
| `pnpm run typecheck` | 无类型诊断，正常完成 |
| `pnpm run boundaries` | 9/9，0 fail/cancelled/skipped/todo |
| 双 SQLite 句柄隔离探针 | winner=`saved`、stale=`unknown`、generation=2、全库赢家快照不变 |
| `git diff --check 06d929017c8551e6b106fcbe7651f12ac26e4642...86d5fa151f3da971cbfba7ba1da9c9c55c0ad13b` | exit 0 |

未把计划中的历史全量 verify 或组合产物记录充作本轮新执行；本轮没有重复全量 verify、没有真实模型或安装 Host/UAT 证据。

### 最终产品树变异表

使用 `node scripts/review-mutate.mjs <spec.json>` 整表运行一次，命令为 `node --test --test-timeout=120000 tests/integration/start-work-owner-fencing.test.js tests/integration/storage-baseline-admission.test.js`；fixture 基线与还原后基线均通过，runner exit 0。每项均按实际失败用例归因，源码逐字节还原。

| ID | 变异 | killedBy（失败名片段） | 结果 |
|---|---|---|---|
| F1 | 移除 owned 的代际比较 | `live old owner held at createBranch` | KILLED，Fake/SQLite |
| F2 | nextGeneration 复用原代际 | `generations survive Ready` | KILLED，Fake/SQLite |
| F3 | Ready 降 Failed 不比较 generation/status/handles | `late Ready verification` | KILLED，Fake/SQLite |
| F4 | 无句柄时忽略原 Unknown 阶段 | `uncertain branch without handle remains Unknown after owner loss=true` | KILLED，Fake/SQLite |
| F5 | 放行旧 schema 世代标记 | `拒绝 old-generation-one` | KILLED，双入口结构化拒绝原因断言 |

### 工作项与已有跟踪

- 实际只读核对 #420 原 AC、#304、#421、#193 与 #459 的 2026-10-29 当前 disposition。#420 要求的持久身份、每步与最终 fence、双存储 live-owner 屏障和 ADR 均有本轮证据；issue checkbox 仍由主控按流程核对，不由测试自动接受。
- #421 的外部 start 唯一、#204 的 pending intent、#193 的重启/不确定结果对账及 TD-006 未覆盖部分仍属原 owner。尤其人工 fallback ambiguous_result 仍须 #193 保留诚实未知；这是既有问题，不能借 #420 的部分改进声称已接受。
- #304 的父验收要求 #420 与 #421 两个结果；本 PR 不关闭父项，也不接受整体发布。#459 必须在实际 shipped path 对这些未完正确性能力保留阻塞或取得具体人类例外，不能以 Post-Core 字段或已知问题清单代替。

## 结论与后续

本轮独立全矩阵没有新增 P0/P1/P2/P3 finding；#455 对 #420 的本地持久 owner fencing 构成有界闭环，设计与风险相称。建议主控按当前远端最终 head/base、threads、checks 和 issue 关联完成一次性 review；若 head/base 改变，重新锁定并核对受影响证据。

不把本地软件测试提升为 hosted CI、安装走查、外部唯一性、父 #304 完成或 MMP/R1 发布接受。本轮未提交 GitHub review、未 commit/push、未合并。

## 主控综审与收尾门

- 2026-10-29 首轮：独立子评审与主控全矩阵均无新增 P0/P1/P2/P3。初始 head/base 已锁定；所有原 review threads/reviews 为空。主控逐条查明可选评审转发失败属于 #364；取消的重复规则运行有成功后继，当前代码门通过。
- 已使用 `gh-review` / `Singularity-AI-Bot` 一次性提交完整 APPROVE review，没有可提交的 inline 缺陷；开发与后续外部写入使用 `gh` / `SingularityKChen`。
- 以四个首轮固定 head 按 #454 → #455 → #456 → #445 在隔离 clone 逐项变基预演，无冲突，组合 head `23916987d93026109a2fce8a55cc55147b521e3d`。固定 pnpm 10.28.2 后 typecheck、2551/2551 与 MVP-0 7/7 通过（0 fail/cancelled）。首次 pnpm 11 的依赖预检在测试前因非 TTY 终止，不是测试通过；离线安装也曾因缓存缺包失败，联网 frozen install 成功。
- 收尾只整合提交与审查记录；每个分支先保留原 head 的本地 backup ref，更新到真实 base 后核对源码与预演/独立审查相符，运行受影响验证和发布面/规模检查，以精确 lease 推送。远端最终 head/base/checks/issue/threads 和复评全部成立后才执行 rebase merge；任一条件改变则回到该门，不能借首轮批准跳过。
- 本轮接受对应子 issue 的有界闭环；不接受父级 MMP、真实模型、人工 Demo、独立安装或 R1。保留原跟踪问题和人类验收门。
