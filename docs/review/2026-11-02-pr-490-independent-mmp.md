# PR #490 独立 MMP 交付评审

## 锁定事实

- 日期：2026-11-02；评审账号 Singularity-AI-Bot，作者账号 SingularityKChen。
- 评审 head `abcfe3711c10c47c66e7ebaa6cffbbe183fa8af5`；直接 base `main` / `554e6fefb1ad9781becf879b9f96e367e9f6ceff`。
- 执行上下文 `.worktrees/start-work-execution-recovery`；当前 Ready。范围为本 PR 的 issue 闭环，人工 Host 验收和 R1 保留。
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
已完整读直接 base diff、拥有模块及其调用路径，再运行独立验证，未把作者报告作为运行结果。
计划为 [执行回执恢复](../exec-plan/completed/2026-11-02-start-work-execution-recovery.md)。

## 完成矩阵

| 层 | 级别 | 已核验内容与结论 |
|---|---|---|
| 代码 | P0/P1 | `recordRun` 先提交 run 身份，再以完整 receipt 快照结算；后段失败不回滚已提交的 journal。 |
| 代码 | P1 | `recoverAttempt` 复核 workspace/context/generation、原 binding、fallback 和精确 ref；迟到读同时比较三份完整快照。 |
| 产品闭环 | P1 | 有持久 ref 才沿签发者读回并结算原 receipt；缺 ref、拒绝、抛错、未知状态均 Unknown/degraded，不能再 start。 |
| 产品闭环 | P1/P2 | 成功恢复、竞争者已确认和迟到 finalizer 的 confirmed 路径仍检查 Ready 工作树；失联不误报 Saved，确定缺失可判 Failed。 |
| 架构 | P0/P1 | Provider I/O 在事务外；Host/Storage 保持权威；查询无外部恢复写入；未新增规划状态写者、schema、秘密或 Provider ABI。 |
| 测试 | P1/P2 | Fake/SQLite、主/备执行、真实 reopen、receipt 故障、冷读拒绝及并发取消/刷新均有直接断言；三项正式变异证明关键守卫有判别力。 |
| 工作项 | P2 | #193 原验收与审计补充均有明确证据；无引用只承诺诚实降级。#421 的公开接管组合由直接上层 #492 专门证明。 |
| 工作项 | P2/P3 | #458 已跟踪原有 fallback/重放展示一致性，#304 保留父级 owner 范围；未把已知邻域缺口伪装成本 PR 新修复。 |
| 设计 | P3 | 复用现有 run 行与 receipt，避免第二身份表和新 Host 协议；新增状态比较与两事务服务于可定位故障，无过度架构。 |
| 发布面 | P0/P3 | 扫描通过；直接差异代码/测试 392 行、文档 180 行，满足本轮 <800 / <1300；人工五类目未见发布命中。 |

## 独立运行证据

执行上下文为本报告开头记录的 PR 工作树；Node `v26.12.1`，pnpm `10.28.2`。

```text
pnpm test:file tests/integration/start-work-execution-recovery.test.js tests/integration/human-execution-provider.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-sqlite-registration.test.js tests/e2e/start-work-recovery.test.js
```

结果：329 passed，0 failed、0 cancelled、0 skipped。
判别场景包括：最终 receipt 回滚后 journal 仍在、首次 journal 写失败、丢 ack、外来/空 ref、主备 Unknown 对称、冷读 denied/not_found/throw、无 read 权限、late snapshot 变化及 Ready 工作树 throw。
这些场景分别断言 starts=1、原 receipt/target 不替换、句柄保留、Unknown 与已知状态，不用超时增长替代排他。

```text
node scripts/rule-checks.mjs disclosure 554e6fefb1ad9781becf879b9f96e367e9f6ceff
node scripts/rule-checks.mjs size 554e6fefb1ad9781becf879b9f96e367e9f6ceff
git diff --check 554e6fefb1ad9781becf879b9f96e367e9f6ceff...HEAD
```

三项均退出 0。PR 描述的机械扫描由协调者收尾，本次 disclosure 未传 PR_BODY。

## 独立变异与归因

用当前 #492 完整源码临时副本执行；其 `start-work.ts` 与 #490 当前树逐字相同。
依赖以 `pnpm install --frozen-lockfile --offline` 安装，裸包解析守卫通过，未借用作者树模块。
第一次副本缺 `.gitignore`，harness 在基线阶段退出 2、未施加变异；补齐副本文件后整表重新运行。
正式命令：`node scripts/review-mutate.mjs review-spec.json`；子命令如下：

```text
node --test --test-name-pattern=late\ original\ finalizer\|public\ takeover\|late\ recovery\ read tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-execution-uniqueness.test.js
```

| 变异 | killedBy | 实测归因 |
|---|---|---|
| R1：移除 finalizer 的完整 receipt 比较 | `late original finalizer` | 对应 12 项失败，KILLED |
| R2：移除 `owned` generation 守卫 | `public takeover` | 对应 Fake/SQLite × main/fallback 4 项失败，KILLED |
| R3：移除恢复的 attempt/context/run 快照比较 | `late recovery read` | 对应 12 项失败，KILLED |

harness 退出 0，前后基线 GREEN，三项均有 killedBy；完整表只在最终源码执行一次有效批次。
工具逐字还原，副本与两 PR 的产品文件 SHA-256 均为 `28c2140ab04f1c47688b050afb814f8228475d61f97dc4ac353137bb2e2f68ea`。

## 验收、流程与限制

#193：ack 后 receipt 失败已有持久 run 可恢复；首次 run 写失败或真丢响应明确 Unknown，符合“recorded run 或 explicit degraded”。
主/备路径保留 operation/binding 与能持久的句柄，恢复先读原对象；旧计划已原处订正 resumability 声明。
当前全部 review/comment/thread 为 0；协调者已核对双账号、当前 head 的 PR Fast Gate / Merge Gate 成功。
可选 `Create review session` 失败的 annotation 为 Forward event / local DSH endpoint answered `000000`，由 #364 跟踪，不是产品恢复失败。
`UNSTABLE` 不被隐去，也不能单凭合并状态字符串推翻已核实的 required check。
无永久 ref 的操作活性、真实安装 Host/UAT、#143/#449 和 Gate R1 保持各自边界。
本轮未重复全量 verify；协调者执行当前四能力组合验证。无新增技术债、源码修改、commit、push 或远端 review 写入。

## 协调者组合与收尾门

在 `.worktrees/mmp-490-495-integration` 的组合检出 `2c37163fa04d68b158334d5c1e8fd48d71d15cb0`，以 Node26/pnpm10.28.2 运行 `pnpm verify`：3020 + 7 passed，0 failed/cancelled/skipped；`pnpm run boundaries`：9 passed；`node scripts/workflow-check.mjs`：no findings。组合非文档树与作者最终接受的 `4e706564226c0192c114410e624987b805a34a2a` 相同。

源码重排和证据归档后，协调者以 `git diff <本轮原head> HEAD -- . :(exclude)docs` 的空差异证明该 PR 的产品/测试树未变，再回读当前 head/base/完整线程、required checks 和 issue 两侧关联；旧 head 的批准不替代最终 head 的批准。按原生栈 #493 的 #490 → #492 次序使用 rebase；恢复锚点 `refs/backup/pr490-before-independent-mmp-20261102`。
