# PR #490 · 执行回执恢复 MMP 评审

## Purpose / Big Picture

确认 #193 的主执行与人工回退在中断后复用已知引用，保留不确定性且不重复启动。恢复操作同时保持原有工作树确认与所有持久事实的一致性。

## Context and Orientation

设计与实施基底为 `554e6fefb1ad9781becf879b9f96e367e9f6ceff`。首轮审查 `e24a977`，修复复评 `27f6ca4`，最终独立技术对象 `1039beff9a97ba4c2d85067db3300f94b6b009c7`。检出分别为 `.worktrees/pr490-adversarial-review`、`.worktrees/pr490-fix-review`、`.worktrees/pr490-final-review`。最终对外提交可只整理历史和文档；以产品差异核对和当前 CI 为准。

## Design / Spec

run journal 先持久化，最终 receipt-only 事务比较完整原 attempt；已有后继由当前事实决定，不能被迟到写者降级。所有可能确认的恢复路径保留既有 Ready 工作树验证；局部 await 使新增读取异常转为 Unknown。原签发者、精确引用、fallback、当前可见性与请求身份都受守卫。无持久引用只观察，不自动创建。

## Global Constraints

本记录仅覆盖指定 PR 的工程验收，不改变 Planning Status、原生阻塞关系、人工产品验收或 R1。公开内容只使用仓库相对路径；Git 经 argv。最终发布整理后必须重读当前 head/base/checks/双向 issue 关联及全部 review threads，旧 head 的检查不能替代新 head。

## Plan of Work

第一轮完成代码、产品、架构、测试、工作项 P0–P3 矩阵，发现 F1/F2；同一 owner 修复并独立复评。复评新增 E1 后再次窄修，最终原始反例与当前树变异通过。最后由协调者完成文档、提交整理和远端门禁。

## Validation and Acceptance

| 层 | 检查 | 最终技术结论 |
|---|---|---|
| 代码 | journal/receipt 分离、全快照 CAS、迟到读与写、异常边界 | 通过 |
| 产品 | 不能 Ready 假 Saved；未知引用诚实降级；原句柄与回退保留 | 通过 |
| 架构 | 单一事实源、原 issuer、Provider I/O 在事务外、规划轴不变 | 通过 |
| 测试 | Fake/SQLite、真实重开、主/回退、语义 barrier、正式变异 | 通过 |
| 工作项 | #193 原验收、计划声明、规模和发布面 | 源码验收通过；最终发布按当前 head 读回 |

首轮 2 个 P1：F1 原 finalizer 把另一 Core 已恢复的 Saved 改回 Unknown；F2 恢复跳过工作树确认，删除的工作树仍报 Ready。二者由完整 attempt CAS 和复用既有 Ready 守卫修复。复评 1 个 P2 E1：Promise 未 await 导致工作树读取异常逸出；两处分支局部 await 修复。最终 P0/P1/P2/P3 均无未决项。

## Progress

- [x] (2026-11-02 SGT) 两方案与独立规格评审完成。
- [x] (2026-11-02 SGT) F1/F2/E1 原始反例均修复、独立复评通过。
- [x] (2026-11-02 SGT) 当前源码 381 项相关回归与独立变异证据核对。

## Surprises & Discoveries

只防恢复写者并不足以保护命令收敛，原 finalizer 也是竞争写者。执行运行已确认也不替代整个 Ready 的工作树条件。初轮全绿不覆盖这些顺序，因此保留首轮发现与修复事实，不能仅以测试数量判断验收。

## Decision Log

2026-11-02：保留现行 run 表，不加第二账本/Provider ABI；新增完整 receipt 前置条件并复用工作树验证。理由是两项 P1 的直接因果修复。E1 只修新增异步边界，不进行全局异常重构。单一执行 owner 也将同一命令过滤谓词串行加入 PR 创建分支，以保证其独立交付。

## Idempotence and Recovery

回滚单位为整个能力；保留数据库、工作树和外部运行。无引用恢复能力不被夸大为全局 exactly-once。发布前保存恢复引用；历史整理后核对产品文件与已验收对象无差异。

## Interfaces and Dependencies

沿现有 startWork、ExecutionProvider.getRun、Storage 事务和 owner generation；无新接口或迁移。PR #492 只因组合恢复验收依赖本层，使用原生栈；PR 创建分支仅共享同一命令谓词，组合时保留本 PR 的完整 start-work.ts。

## Outcomes & Retrospective

最终独立规格与代码质量均 PASS。原16项探针在修复后全部通过；最终8项异常探针8/8。当前树正式变异全部可归因 KILLED：原子 run+receipt（4）、finalizer 重写 run（4）、跨命令过滤（2）、移除 finalizer CAS（12）、跳过 recovery Ready（40）、跳过 finalizer Ready（16）、移除 applied await（4）、移除 stale-success await（4）。每项均有 killedBy，基线和逐字还原后基线通过。

在检出 `fix/start-work-execution-recovery` 的工作树根运行 `pnpm test:file tests/integration/start-work-execution-recovery.test.js tests/integration/start-work-external-intent.test.js tests/integration/start-work-owner-fencing.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/execution-run-refresh.test.js tests/integration/human-execution-provider.test.js tests/e2e/start-work-recovery.test.js`，观察 381/381；类型检查通过。最终两个 await 之后的完整组合检查由协调者单独记录，不能沿用更早作者 full verify 的 head。

新工作区里的旧 Schema/Provider 能力不被自动扩张；人工 Desktop UAT、#143/#449 和 R1 仍有各自验收。未增加接受延期的技术债。

## Bottom Change Note

2026-11-02：归档独立完整矩阵、两个 P1 与一个 P2 的修复及当前树正式变异；最终远端数据采用回读规则，避免循环嵌入未来提交 SHA。
