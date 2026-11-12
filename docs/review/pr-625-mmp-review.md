# PR #625 MMP 交付评审

## 锁定事实

2026-11-12 首审：base `main@29947425ba0174fe83c73f2ee8df3e29ea12429d`，head `a9c29e1b2aa479cffc4e17e251434774a2fee34f`。Ready、MERGEABLE，全部 review/comment/thread 为空；当次 PR Fast Gate 成功。`gh pr view 625 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,closingIssuesReferences` 可重算。评审账号 Singularity-AI-Bot，开发与合并账号 SingularityKChen。

风险矩阵先于逐文件审查建立；由独立 UI 审查与跨 PR 产品审查交叉验证（gpt-6.1-sol，medium / high）。

## 风险矩阵

| 级别 | 检查的失败路径 | 结论 |
|---|---|---|
| P0 | 删除活跃入口导致主干不可运行，破坏权威状态/凭据硬约束 | 无新增发现 |
| P1 | 导航、scope、焦点、设置恢复断链，移除真实消费者，依赖边倒置 | 无新增发现 |
| P2 | 活跃 forms 证据丢失、issue 范围未闭合、历史证据被改写 | 无新增发现 |
| P3 | 空包装残留、冗余兼容层、无收益测试与文档表述 | 无新增发现 |

## 分层证据

- 代码：仅移除 wrapper、named export 与专属等值块；WorkItemApp 行为未变。base 技术树消费者只有这三处，head `packages/apps/scripts/tests` 无 wrapper 引用。
- 产品闭环：`apps/harness-plugin/src/client.ts` 的 `bindWorkspaceStatusApp` → WorkspaceStatusPanel → WorkspaceSetupGate → WorkItemApp 活链保留；列表、详情、工作区切换与设置恢复继续可达。
- 架构：UI 包为 private/0.0.0；没有新增依赖、事实拥有者或兼容机制。ReactElement 仍有实际用途。
- 测试/反例：保留 scope trap 正控、链接同管线、焦点 effect 重放；真实设置浏览器保留草稿、pending/unknown、不重发未知写、窄屏与主题证据。不为纯删除新增“旧导出不存在”镜像测试。
- 工作项/设计：#453 最新 consumer audit 已将范围收敛到 wrapper，保留确有消费者的 forms fixture；无需扩成测试框架迁移。#419/#459、安装态人验和 R1 保持独立。
- 文档：`docs/product/vertical-path.md` 的历史 #4 行保留，只在原单元格追加 dated Superseded 说明；步骤 1–13 连续。

## 实际验证

以下在 `.worktrees/ui-binding-retirement`、检出上述首审 head 运行：

| 命令 | 结果 |
|---|---|
| `pnpm test:file tests/contract/ui-work-item-app.test.js tests/browser/workspace-settings-presentation.test.js` | 8 passed，含 2 个真实浏览器用例 |
| `pnpm typecheck`；`pnpm run boundaries` | exit 0；9 passed |
| `pnpm test:file tests/integration/harness-plugin-artifact.test.js tests/integration/harness-plugin-host-watch.test.js tests/integration/harness-plugin-workspace-status.test.js` | 39 passed，含实际 bundle/Panel 装配 |
| `node scripts/rule-checks.mjs disclosure origin/main`；`node scripts/rule-checks.mjs size origin/main`；`git diff --check origin/main...HEAD` | 全部通过；技术 12 / 文档 142 行（首审快照） |

未重跑完整套件或安装人验。既有 SSR useLayoutEffect 提示未导致失败。可选 Create review session 的失败日志确认 HTTP 404，既有 #364 追踪；不阻塞 PR Fast Gate。

## 复评与收尾门

2026-11-12 组合预演 `f22904826d2d78ac18cf51e41c08b759886d6a9a`（base 为 #623 已发布修复头 `9610a669af2cd802cbc81e8c39e6e74577b29ae4`）：只出现 Review 索引冲突，双方保留。`pnpm test:file tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js tests/integration/storage-baseline-admission.test.js tests/contract/ui-work-item-app.test.js tests/browser/workspace-settings-presentation.test.js` 实际 439 passed、0 failed/skipped，覆盖当前 SQLite 准入/定序和真实 UI 浏览器。#623 合入后仍须接合真实 main，并核对全部非文档 blob 与此已测组合相同；不同则返回相应验证门。

无 inline 缺陷，建议 APPROVE。文档补录后须重锁当前 head/base、checks、全部 threads 与双向 issue 关联，再由评审账号提交当前 head 的完整 review。当前计划已在 completed；人类本次直接条件授权覆盖 #623/#625，满足无 P0/P1、独立复评和当前门禁后只以 expected-head rebase 合并。先合 #623，再接合真实 main 并验证本 PR；索引冲突保留双方。Planning Status 与 R1 不随合并裁决。

独立撤回本 PR 可恢复 wrapper/export/等值块，不涉及数据恢复。最终远端结果用 `gh pr view 625 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,mergeCommit` 与 issue #453 回读。

2026-11-12 实际接合：#623 已 rebase 合入 `main@3b86d30f401e257e858871ee989c1305c5e952d9`，#415/#416 CLOSED；合入 tree 与批准 tree 相同。本 PR 移到该真实 main，全部 518 个非文档 blob 与 439 项已测组合逐项相同（SHA-256 `c6bc358105eb6c624a9f9a3c501e46decf2fec0b7371006fd6c8b764fde53dcf`），无产品/测试变动；最终 head 仍按远端 checks/threads/issue/批准门回读。
