# PR #492 · 公开执行唯一性 MMP 评审

## Purpose / Big Picture

用公开 startWork 命令证明 takeover、未决意图、丢确认与重启时外部执行最多一次；不为补证明重建已有排他协议。

## Context and Orientation

独立评审 direct base 为 `1039beff9a97ba4c2d85067db3300f94b6b009c7`，head 为 `6c788e93faf0ab3a232eadea7194bcadd0f36c4d`；检出 `.worktrees/pr492-adversarial-review`。初稿在旧父层有4个 F1 RED，父层修复后原提交 range-diff 等价重放并全部转绿。原生 stack #493 为 PR #490 → #492。

## Design / Spec

独立外部 ledger 每次真正创建分配不同 ref；promise barrier、可控 clock、Fake 导出导入与两个 SQLite 连接/真实重开区分允许的接管和被阻止的接管。所有接管从公开命令产生，不用人工 generation 后继冒充组合证明。

## Global Constraints

本记录仅覆盖指定 PR 的工程验收，不改变 Planning Status、原生阻塞关系、人工产品验收或 R1。公开内容只使用仓库相对路径；Git 经 argv。最终发布整理后必须重读当前 head/base/checks/双向 issue 关联及全部 review threads，旧 head 的检查不能替代新 head。

## Plan of Work

审查29项公开行为及完整矩阵，按当前父层重跑两个正式守卫变异。修订并归档旧计划的已知父层 RED 记录，再按直接 base 计量和发布。

## Validation and Acceptance

| 层 | 核对 | 结论 |
|---|---|---|
| 代码 | 无新增运行时实现；直接基底和独立 diff 正确 | 通过 |
| 产品 | 可接管时恰一运行；未决/缺引用保持未知；主/回退对称 | 通过 |
| 架构 | 持久槽与 generation 组合，无第二权威或 Host ABI | 通过 |
| 测试 | 真实 public entry、独立非幂等 ledger、barrier、两连接与重开 | 通过 |
| 工作项 | #421 原验收及 #193 恢复组合、严格规模 | 通过；旧计划最终证据由协调者订正 |

独立结论无 P0/P1；仅发现计划仍留旧父层失败/待恢复措辞的 P2，最终归档时订正，不改变源码验收。

## Progress

- [x] (2026-11-02 SGT) 29 项公开入口证据完成。
- [x] (2026-11-02 SGT) 两个当前树变异均可归因 KILLED、源码逐字还原。
- [x] (2026-11-02 SGT) 父层修复后 issue 指定相关 156/156，独立新文件29/29。

## Surprises & Discoveries

已有正确安全行为可让新证明直接 GREEN；用因果变异而非无必要产品改动验证判别力。M2 必须同时移除 pending 查找并错误把 Ready 视终态才能突破冗余防线；不能将此报告成单个 guard 即可打穿全部安全性。

## Decision Log

2026-11-02：保持 test-only 闭环，保留独立 ledger 和公开状态机路径。因本层包括原 receipt 恢复后原 owner 迟到的组合验收，依赖 #490 的真实代码合同，使用必要原生栈。

## Idempotence and Recovery

回滚本 PR 的测试与文档，不删除运行/用户数据。变异只用于隔离副本，按字节恢复。历史整理保存旧 refs，range-diff 与产品差异核对后使用精确 lease 发布。

## Interfaces and Dependencies

依赖 #204/#420 的持久意图与 owner fence、#193 的已知引用恢复。无 Provider/Host/schema 参数增加。直接 base 是 `fix/start-work-execution-recovery`，累计 main 规模只作记录。

## Outcomes & Retrospective

独立规格和代码质量均 PASS。独立当前新文件29/29，无跳过或取消；M1 删除 generation 比较，被4个 public takeover 全赢家快照用例杀死；M2 双 guard 不安全变体，被4个 accepted-held-ack 的独立 ledger2≠1 用例杀死。脚本均有 killedBy，基线/还原后绿，tracked tree 干净。

在检出 `fix/start-work-execution-uniqueness` 的工作树根运行 `pnpm test:file tests/integration/start-work-execution-uniqueness.test.js tests/e2e/start-work-recovery.test.js tests/integration/start-work-sqlite-registration.test.js`，父层修复后观察156/156。全仓/组合结果由对应 immutable 检出另记，不把29项新文件冒充全部产品验收。人工 Host、R1 和无引用全局发现仍保留原边界；无新增延期债务。

## Bottom Change Note

2026-11-02：记录独立矩阵与正式变异，订正旧父层 RED 的最终状态及归档义务。
