# Client 单一帧接受点 ExecPlan

> 状态：Completed；创建：2026-11-07；Issue：#575。

## Purpose / Big Picture

删除生产未使用的 pull 同步生命周期，使 Host 推流只经过一个帧接受点；保留原子接受、陈旧值、确认时间和代际隔离的现有证据。

## Context and Orientation

初始验证基线 `main@50abd7d7`；2026-11-07 rebase 到仅含文档更新的 `main@c1975c20`，非 Markdown 补丁哈希逐字不变，沿用原有验证上下文。在检出 `chore/client-push-only-20261107` 的工作树根目录执行。真实链为 `openWorkspaceWatch → superviseWorkspace → followWorkspace → receive`，`stream.ts` 注入拒绝所有拉取的 `PUSH_ONLY` 仅为借用接受点；`createTransport` 没有产品调用方。

## Design / Spec

保留 `createSync(store, options)`、`receive/read/disconnect`，由 follower/supervisor 继续拥有流、重开与退避。删除 transport 和 pull 票据、单飞、基线拉取逻辑；集成测试显式把真实 Controller 基线和 watch 事件交给 receiver。拒绝保留兼容模式或将旧生命周期移入 fixture；旧 pull 独有测试随 API 退役，独有产品语义仍保留。

## Global Constraints
MMP 收尾追加本 PR 的 `docs/review/pr-578-mmp-review.md` 作为证据，保留原实现文件边界。

生产范围仅 `packages/client/src/{sync,stream,index,transport}.ts`。测试范围为 `tests/e2e/{client-sync,workspace-read-assembly,repository-routing}.test.js`、`tests/contract/{client-browser,issue-closing-links-reader}.test.js`、`tests/fixtures/client-browser.mjs`、`tests/integration/{harness-plugin-host-planning-mapping,harness-plugin-issue-closing-links,harness-plugin-planning-refresh-ui,source-number-restart,sync-revision-freshness,ui-work-item-detail-read,workspace-setup-commands}.test.js`。文档仅本计划与 `docs/README.md`。代码含测试增删不超过 1000 行；不改数据库、权限、Provider ack、CI、其他 PR 或规划 Status。

## Plan of Work

### Batch 1 · 删除第二套生命周期

先提交本计划并创建关联 issue 的 draft PR，再迁移现有接受语义测试、删除 pull 代码。若完整差异超限，按 API 迁移与退役的真实边界拆 PR，不删减安全证据。回滚为还原本 PR，不触碰用户数据。

在上述分支根执行 `pnpm install --frozen-lockfile --offline`、`pnpm typecheck`，预期退出 0。执行 `pnpm test:file tests/e2e/client-sync.test.js tests/e2e/workspace-read-assembly.test.js tests/e2e/repository-routing.test.js tests/e2e/client-stream.test.js tests/contract/client-browser.test.js tests/contract/issue-closing-links-reader.test.js tests/integration/harness-plugin-host-planning-mapping.test.js tests/integration/harness-plugin-issue-closing-links.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/integration/source-number-restart.test.js tests/integration/sync-revision-freshness.test.js tests/integration/ui-work-item-detail-read.test.js tests/integration/workspace-setup-commands.test.js tests/integration/harness-plugin-host-watch.test.js`，预期 0 failures。生产组合验证用 `node scripts/run-test-layer.mjs tests/browser "生产组合浏览器读取与恢复"`，预期退出 0。

提交前执行 `pnpm boundaries`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，预期退出 0；最终 push 后回读 `gh pr view <PR> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 与 review threads，保持 draft 供独立评审。

## Validation and Acceptance

只判三项：产品只剩单一接受点；现有独有帧/来源/重连/浏览器语义通过；删除清单和差异规模可审阅。测试通过不代表 R1 或安装产品接受。

## Progress

- [x] 2026-11-07：完成生产调用图取证，建立 issue #575 与隔离检出。
- [x] 2026-11-07：Batch 1 实现与相关验证；14 文件 248/248、浏览器 58/58、boundaries 9/9，typecheck 与差异空白检查退出 0。
- [x] 2026-11-07：独立审读无 P0–P3 可行动问题；归档计划并整理为初始计划与最终实现两个提交，保持 draft 供主 agent 最终回读。

## Surprises & Discoveries

旧 pull 端口仅在测试使用，但部分测试承载真实 Controller/Core/SQLite 的必要接受证据；不能把“无生产调用”误读为整批测试无价值。
先迁移现有来源读取用例得到 `store.applyBaseline is not a function` 的红色结果，再更新生产签名。最终保留真实 Core/SQLite 与浏览器调用链，仅删除 14 个旧 pull 票据、并发轮询和 seed 生命周期用例。

## Decision Log
2026-11-07 / MMP 收尾授权：人类在本会话直接要求对 PR #571、#576–#579 完整评审；无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 并以 rebase 合并。本条覆盖本 PR 先前“不合并/保持 draft”的执行限制；不授权 Planning Status 或依赖关系写入。

2026-11-07 / 独立审读：确认生产删除边界及测试迁移保留独有语义，无 P0–P3 可行动问题，主 agent 授权归档和一次最终 push，PR 仍保持 draft。

2026-11-07 / 用户经主 agent：授权本闭环可逆实现与 issue/draft PR 发布；保留现有真实语义，不新增镜像测试。GitHub 写入 actor 为当前已认证维护者，目标 origin，幂等标识为 issue #575 与分支名，结果由 API 回读。

## Idempotence and Recovery

验证可重跑，日志放 `.superpowers/client-push-only-20261107/`。初始计划提交为实现前恢复点；失败只还原本任务明确路径，保留其他检出。

## Interfaces and Dependencies

使用现有 Node、pnpm、node:test、TypeScript 与 gh，无新运行时依赖。private client 包有意删除无人消费的 pull 导出；Host RemoteStream ABI 不变。

## Outcomes & Retrospective

2026-11-07 在本分支工作树观察：生产净删 127 行；代码与测试合计净删 304 行、增删 786 行。独有帧、来源、确认时刻、重连与浏览器语义的现有验证通过；独立审读确认无旧运行消费者或隐藏 pull 实现，未发现可行动问题。保持 draft 等待组合验证与托管 checks，未声称 R1 或安装产品接受。GitHub 平台协议共享不属于本闭环。

## Bottom Change Note

2026-11-07：依据真实 Host 推流调用图建立简明计划，明确保留接受语义并退役旧 pull 生命周期。
2026-11-07：完成有界迁移并记录实际验证与删除范围，保留独立审读和最终发布步骤。
2026-11-07：根据独立审读无阻塞结论归档计划；同日保留恢复 ref 后更新文档基线，代码补丁不变；托管检查与组合结果由主 agent 最终判定。

2026-11-07：记录本会话对该 PR 的直接条件合并授权、风险矩阵与独立复评入口；当前 head/checks 以发布后回读为准。
