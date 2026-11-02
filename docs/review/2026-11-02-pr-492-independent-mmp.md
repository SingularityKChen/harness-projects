# PR #492 独立 MMP 交付评审

## 锁定事实

- 日期：2026-11-02；评审账号 Singularity-AI-Bot，作者账号 SingularityKChen。
- 评审 head `0c13913216ae4689cfdd2b4155b63f6427b89674`；直接 base `fix/start-work-execution-recovery` / `abcfe3711c10c47c66e7ebaa6cffbbe183fa8af5`。
- 执行上下文 `.worktrees/start-work-execution-uniqueness`；当前 Ready。范围为本 PR 的 issue 闭环，人工 Host 验收和 R1 保留。
- 方法：Superpowers 独立子评审、Qian 系统接口与闭环综合、First Principles 状态拥有和故障反例。

## 先行风险矩阵

| 级别 | 风险与判据 | 所需证据 | 初始结论 |
|---|---|---|---|
| P0 | main 破坏、秘密发布、规划权威越界、数据丢失 | 依赖与发布扫描、持久化契约、写入拥有者 | 待核验 |
| P1 | 重复外部执行/PR、虚假 Saved、重启恢复失效、权限或并发绕过 | 当前源码、公开入口故障注入、真实 SQLite/Host 边界 | 待核验 |
| P2 | 局部恢复/错误提示、测试盲区、issue 闭环不足 | 反例、验收映射、同问题 issue 排查 | 待核验 |
| P3 | 文档、命名、范围或不必要设计成本 | diff、ExecPlan、规模与回滚 | 待核验 |

分层范围：代码、产品闭环、架构边界、测试判别力与反例、issue 验收与重复追踪、设计缺陷/适度性。测试通过只证明对应断言，不等同产品闭环。

## 独立证据与结论

结论：当前锁定 head 未发现应新增的 P0、P1、P2 或 P3 缺陷，建议 APPROVE；不包含合并授权。
已完整读直接父层 diff 与本 PR 全部新增测试；本 PR 产品改动 0 行，是已有安全机制的组合证明。
计划为 [外部执行唯一性](../exec-plan/completed/2026-11-02-start-work-execution-uniqueness.md)。

## 完成矩阵

| 层 | 级别 | 已核验内容与结论 |
|---|---|---|
| 代码 | P0/P1 | 直接层仅新增测试与文档；产品实现完全来自 #490。读过父层持久 intent、owner fence、recovery、receipt CAS 的组合控制流。 |
| 产品闭环 | P1 | 公开接管确实推进 generation；旧 owner 释放后不能 dispatch 或覆盖完整赢家快照。 |
| 产品闭环 | P1 | durable intent 前后、accepted held/lost ack、same/new key、过期第二 Core 均阻止第二 create；不靠 Fake provider 幂等隐藏副作用。 |
| 架构 | P0/P1 | 独立外部 ledger 每次接受分配新 run；SQLite 用两个活连接，真实重启另行 close/open；无新状态权威或协议。 |
| 测试 | P1/P2 | barriers 有恰中一次断言、完整快照、外部副作用计数与正控；generation 负控按预期被四组公开接管测试杀死。 |
| 测试 | P2 | 缺引用重启明确 Unknown；已知引用沿原 receipt 收敛；late finalizer 不降级另一 Core 已确认的 Saved。 |
| 工作项 | P2 | #421 三项验收均有可运行的组合证据；#193 恢复是明确父层依赖，#304 保留父级范围，不把测试-only 宣称成新协议。 |
| 工作项 | P2/P3 | #458 原展示一致性另有独立 issue；#451 人工/UI 自动化边界不被本 Core 测试代替。 |
| 设计 | P3 | 不重新实现已有 fence，不增大 lease 或全局 session 扫描；204 行测试覆盖真实未决槽位与公开 takeover，范围适度。 |
| 发布面 | P0/P3 | 扫描通过；直接层代码/测试 204 行、文档 168 行，满足本轮 <800 / <1300；人工五类目未见发布命中。 |

## 独立运行证据

执行上下文为本报告开头记录的 PR 工作树；Node `v26.12.1`，pnpm `10.28.2`。

```text
pnpm test:file tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-sqlite-registration.test.js
```

结果：156 passed，0 failed、0 cancelled、0 skipped；包含本 PR 29 项公开入口证明。
外部 ledger 正控对相同输入分配两个不同 ref，说明计数不会被 provider 去重掩盖。
四组公开 takeover 在第一个 owner 仍存活时以第二公开命令取得 generation 2，随后验证全库赢家快照。
四组 dispatch 前 intent barrier 阻止新 key/过期 Core；八组 accepted held/lost ack 断言只有一次外部创建。
八组真实重启分别验证已知/缺失身份的 Saved/Unknown，且替代 key 不另占 receipt。
四组 late finalizer 验证恢复后 Saved 不被旧 owner 改写；starts/read 数、fallback 身份各自有断言。

```text
node scripts/rule-checks.mjs disclosure abcfe3711c10c47c66e7ebaa6cffbbe183fa8af5
node scripts/rule-checks.mjs size abcfe3711c10c47c66e7ebaa6cffbbe183fa8af5
git diff --check abcfe3711c10c47c66e7ebaa6cffbbe183fa8af5...HEAD
```

三项均退出 0。累计父层代码/测试 596 行、文档 348 行；层级规模和累计规模分开记录。
PR 描述的机械扫描由协调者收尾，本次 disclosure 未传 PR_BODY。

## 独立变异与归因

在当前 #492 完整源码临时副本安装离线冻结依赖，裸包解析守卫确认模块归属副本。
副本产品文件与当前 #490/#492 的 SHA-256 同为 `28c2140ab04f1c47688b050afb814f8228475d61f97dc4ac353137bb2e2f68ea`。
正式工具为 `node scripts/review-mutate.mjs review-spec.json`；子命令选取 `late original finalizer|public takeover|late recovery read` 两个相关文件。

| 变异 | killedBy | 实测归因 |
|---|---|---|
| R2：移除 `owned` generation 比较 | `public takeover` | Fake/SQLite × main/fallback 四项准确失败，KILLED |
| R1：移除父层 finalizer receipt CAS | `late original finalizer` | 父层 12 项后继 receipt 场景失败，KILLED |
| R3：移除父层恢复快照 CAS | `late recovery read` | 父层 12 项迟到读场景失败，KILLED |

三项正式批次退出 0，前后基线 GREEN，均有 killedBy；工具逐字还原，最终 hash 与作者两树一致。
副本最初缺 `.gitignore`，harness 在基线阶段退出 2；该次没有施加变异，未计入 KILLED 结论。
作者旧报告的双守卫变异只是历史证据；本独立结论以上述现行源码运行和公开行为断言为依据。
这里不声称删除 pending 单一守卫就必然重复创建，Ready 路径本来还有冗余阻挡。

## 验收映射与限制

#421 第一项：公开 takeover 与持久 intent 合成后，旧 live owner 受 generation fence、新 key 受 unresolved slot 阻挡。
第二项：丢 ack 不盲目 create，原 operation/binding/input 留在持久 intent；无可证实身份仍 Unknown，不宣称自动找回。
第三项：Fake/SQLite、独立非幂等 ledger、两活连接、真实 reopen 与 barriers 同时断言副作用数及诚实状态。
这些是限定现行 Provider/Storage 契约的安全证据，不是全局 exactly-once 或未知引用发现能力。
当前全部 review/comment/thread 为 0；协调者已核对双账号、PR Fast Gate / Merge Gate 成功。
可选 `Create review session` annotation 为 Forward event / local DSH endpoint answered `000000`，由 #364 跟踪。
父层 #490 未合并前此层应保持原生 stack 顺序；retarget/rebase 后须重新锁定 head/base 和 hosted checks。
本轮未重复全量 verify；协调者执行当前四能力组合。真实 Host/UAT、#143/#449 与 R1 保持独立。
无新增技术债、产品源码或原测试修改，无 commit、push、远端 review 写入或合并操作。

## 协调者组合与收尾门

在 `.worktrees/mmp-490-495-integration` 的组合检出 `2c37163fa04d68b158334d5c1e8fd48d71d15cb0`，以 Node26/pnpm10.28.2 运行 `pnpm verify`：3020 + 7 passed，0 failed/cancelled/skipped；`pnpm run boundaries`：9 passed；`node scripts/workflow-check.mjs`：no findings。组合非文档树与作者最终接受的 `4e706564226c0192c114410e624987b805a34a2a` 相同。

源码重排和证据归档后，协调者以 `git diff <本轮原head> HEAD -- . :(exclude)docs` 的空差异证明该 PR 的产品/测试树未变，再回读当前 head/base/完整线程、required checks 和 issue 两侧关联；旧 head 的批准不替代最终 head 的批准。按原生栈 #493 的 #490 → #492 次序使用 rebase；恢复锚点 `refs/backup/pr492-before-independent-mmp-20261102`。
