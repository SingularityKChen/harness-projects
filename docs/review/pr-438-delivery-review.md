# #365 独立验收报告

- 评审检出：`feature/execution-run-refresh@5d9a11e`
- 基线：`origin/main@88d21ae`
- 评审范围：`git diff origin/main..HEAD`
- 评审方式：只读代码审查、聚焦反例测试、完整本地回归；未修改源码、未提交、未推送、未进行外部写入。
- 结论：**PASS**
- 是否需要修复：**否**。本轮没有发现 P0/P1/P2/P3 缺陷。

## 验收结论

| 验收项 | 证据与判定 |
|---|---|
| 仅调用签发该 run 的 Provider | `packages/core/src/execution-run.ts` 先以 `providerRef.bindingId` 经 `bindingForRef` 解析，再在该 binding 上过 `ExecutionRunRead`；默认切换、缺失 binding、外来 context 的反例均通过。聚焦测试 `issuer fallback is used after default changes; missing/foreign context never asks provider` 通过。 |
| 完整引用与响应身份校验 | `validRunRef` 校验 binding/objectKind/externalId；响应以 `sameRef` 比较三项身份，未知、非 enum、null、空对象及三项引用篡改均保留本地 known 状态并返回失败。Fake 与 SQLite 两套测试均通过。 |
| 状态变化一次、重复状态无持久写 | 状态变化仅在状态不同才 `putExecutionRun`；健康游标只在状态或错误码变化时写入。重复成功读取的 Storage write spy 为零，业务 revision、run/cursor 均不变。Fake 与 SQLite 均通过。实现仍经只读事务重读并做完整 CAS，未产生无条件确认时间写入。 |
| Provider 不可达与恢复 | Provider 异常/结构化失败创建 degraded 游标，保留最后 confirmed 状态和时间；重复相同失败不重复写；同状态恢复只清理 degraded 一次。SQLite close/reopen 后 stale 与最后状态仍在，恢复后清 stale。测试通过。 |
| 迟到刷新、取消与原子性 | 刷新在事务外 I/O，事务内重读 run/context 并按完整本地快照 CAS；取消交错时迟到结果不能覆盖 canceled。cursor 写失败时 run 与健康游标一起回滚，重试可恢复。Fake/SQLite 交错和失败注入均通过。取消保留既有新 externalId 签发语义，并校验 binding/objectKind。 |
| unknown / malformed response | Provider 返回 unknown、缺字段、错误身份或异常时不虚构 terminal 状态；已确认状态保持并标 stale。未知且无确认时间时 UI 显示“状态未知/当前无法核对运行状态”，不显示伪造确认时间。 |
| Planning 正交 | `provider_authoritative`、`manual_only`、`host_authoritative` 三策略及四种 terminal 状态测试均证明 planning items、memberships、field values、projections 与 revision 不变。完整 MVP 节点 7 通过。 |
| Host 可见性与目标清理 | Host 刷新前后均检查 workspace、WorkItem 可见性；redacted/删除在 I/O 前后均拒绝，未调用 Provider 或返回旧详情。target 切换/cleanup 会抑制旧 scope 的排队刷新；多仓库按各自 scope 刷新。相关 Host/UI 测试通过。 |
| DTO/client 严格边界 | `ExecutionContextDTO` 仅透传白名单字段；reader 拒绝未知字段、错误 scope、非法 status、非法 `runStale`/`runConfirmedAt`、原型污染；Host remote descriptor、dispatch、client proxy golden 均同步通过。 |
| 实际按钮链 | 测试从 UI 按钮经 client reader.refresh → typed remote → Host composition → Controller/Core → issuing Fake Provider → DTO strict decode → UI 文案，成功读回 succeeded 与确认时间；失败读回 durable stale。链路测试通过。 |
| 只读 query 边界 | 初始读取和 query 不调用 Provider、不制造 command；刷新仅由显式按钮触发，没有新增轮询或取消入口。 |
| 发布面与规模 | `node scripts/rule-checks.mjs disclosure origin/main` exit 0；`size` exit 0（代码 316/1000，文档 192/1500）；`git diff --check origin/main...HEAD` 无输出；`node scripts/workflow-check.mjs` 无发现。人工检查未发现凭据、本机身份/路径、账号个人信息、内部系统或保密字样。 |

## 执行命令

均在检出 `feature/execution-run-refresh` 的工作树根运行：

```text
pnpm test:file tests/integration/execution-run-refresh.test.js tests/integration/execution-context-run-status.test.js tests/integration/harness-plugin-execution-drawer.test.js tests/contract/ui-execution-context.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/e2e/status-policy.test.js
# 64 pass, 0 fail

pnpm verify
# typecheck exit 0; 2361/2361 tests pass; 7/7 MVP tests pass

node scripts/rule-checks.mjs disclosure origin/main
# exit 0, zero findings
node scripts/rule-checks.mjs size origin/main
# exit 0, code 316/1000, docs 192/1500
node scripts/workflow-check.mjs
# no findings

git diff --check origin/main...HEAD
# no output
```

## 风险边界与证据等级

本次通过表示该提交满足 issue #365 的仓库内可执行验收和现有系统不变量。Provider 证据使用 Fake execution provider，Host 链路使用本地 Host composition、typed remote 和浏览器 fixture；这些是可复现的本地组合证据，不是已安装官方 Host、真实模型/会话平台或 hosted CI 验收。实现也明确保留 Core owner 内的 single-flight 语义，不声称跨进程最新开始序、实时 push、TTL 或运行历史。

未发现需要在本提交中修复的具体路径、符号或测试缺陷。

## 最终归档上下文

2026-10-28：上述验证针对候选 `5d9a11e94cb8df0461d738ced5b46f745a50da34`；归档只修改文档与索引。产品/测试/配置文件路径与 Git blob 组成的 SHA-256 为 `700d3bf8e9b66968bea5a92cf8bf0a8d4222b2419ff60ec4eedc4be36285f7dd`，最终提交须重新计算并相同。最终 PR head/base/checks 以 `gh pr view 438 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,statusCheckRollup` 回读；本记录不把本地回归冒充 hosted CI。
