# PR #571 MMP 交付评审

## 锁定事实

- 日期：2026-11-07；初始 head `9303a368f17c871814f975bd6135a13b800afb8f`，base `50abd7d779f6ec332401234479e3c10cc8b96251`（`main`）；审读后由协调者变基，本轮本地 head `7004efea3a91438370a76a4c762b123877b5fd3c`，base `c1975c20aeffa960a980f01dd321e38261008f59`。最终发布前需重锁远端 head/checks。
- 目标：诊断异常边界、Storage 注册/行为覆盖和历史 API 证据退役。
- 评审范围：代码、产品闭环、架构、测试与反例、issue 验收、设计适度性和重复追踪。

## 预置风险矩阵（先于逐文件审查）

| 级别 | 风险假设 | 判别证据 | 当前结论 |
|---|---|---|---|
| P0 | 删除破坏 main、发布门禁或系统硬约束 | 当前基线、门禁与七条不变量核对 | 未发现；无数据库/权限/发布门变化 |
| P1 | 退役误删仍在使用的行为、安全/恢复路径或 CI 覆盖 | 调用方追踪、失败路径与反例、判别性现有验证 | 未发现；实际 Storage 行为与 Host 回放继续执行 |
| P2 | 验收遗漏、证据失真或边界说明不完整 | issue/ExecPlan/真实输出与 PR diff 对照 | 未发现新增问题；#336 的剩余测试范围明确保留 |
| P3 | 文档、命名或维护成本问题 | 链接、范围、设计适度性审读 | 未发现；当前变更文档链接可解析 |

## 分层证据与反例

- 代码：`reportSyncRoundFailure` 仅将参数类型缩窄为所需 diagnostics 宿主；scheduler 原吸收器和共享函数的读取、调用及 Promise 同化表达式一致，保留 diagnostics getter 与方法 receiver。成功/显式拒绝/定时拒绝的拥有者不变；没有增加公共导出。
- 产品与架构：本闭环降低维护负担，不改变规划事实、Provider ack、持久身份、权限或恢复。保留 `harness-execution-contract`、`host-session-adapter` 和 Host 集成三组运行验证；历史报告/预注册/整份夹具卫生及证据绑定的持续校验确实失去，计划与 PR 均明确承认，不能将运行测试当等价替代。
- 测试反例：删除的 `ExecutionRunRecord` 输入/输出引用隔离用例，被 `tests/contract/suites/storage-execution.js:41` 的同类用例严格包含：顶层与嵌套输入修改、输出修改、精确字段、重启都被断言。Storage 仍对两个适配器注册原行为组和仓库悬空引用组。`rg` 核对删除的 count/export 名称无当前调用方；移除源码账本、计数/装配防删守卫的真实损失已记入计划。
- 设计适度性：复用现有 1 个内部 helper，删除文档解析器与 meta-tests，不引入框架或为删测试再写测试；Start Work 的身份、代际、撤权与不确定回执保留，范围合理。
- 工作项与重复追踪：读取 #570/#224/#419/#336；#570 的有界 acceptance 得到实现，未声称关闭其他项。#336 仍要求 scheduler 的跨 realm/thenable 与 stop/dispose 后拒绝控制；这是原有、已登记的证据缺口，不是本次改动引入的回归。搜索 `diagnostics absorber` 返回 #336/#570，无需重复建项。#419 的文档/规划语义改写仍未由此 PR 完成。

## 验证与结论

执行上下文为 `.worktrees/code-simplification-20261107`，命令均在该检出根目录运行：

```text
pnpm test:file tests/contract/storage-contract.test.js tests/contract/harness-execution-contract.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-host-execution.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/sync-revision-freshness.test.js tests/contract/content-placement.test.js tests/contract/board-status-semantics.test.js
head 7004efea: tests 303; pass 303; fail 0; cancelled 0; skipped 0; exit 0
pnpm typecheck
head 7004efea: tsc --noEmit; exit 0
```

另按变更文档相对目录解析 Markdown 本地文件链接，242/242 存在；未验证远端 URL 或所有 heading 锚点。变基前六文件命令曾得到 291/291，本轮结论以上述变基后 303 项为准。未新增测试。用现有 `review-mutate.mjs` 在最终产品树运行 D1（让 diagnostics 同步 catch 重新抛出）：TD-030 的内存替身与 SQLite 原有诊断用例按 `killedBy` 归因失败，结论 KILLED，脚本退出 0；还原后基线通过，文件 SHA256 前后相同且 tracked diff 为空。

本轮未发现可行动 P0–P3，支持在最终远端 head/checks/threads 重新锁定后批准。协调者负责统一提交 review；本记录不代表产品、人类或 R1 接受。
