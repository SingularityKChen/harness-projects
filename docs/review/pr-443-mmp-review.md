# PR #443 MMP 交付评审

## Purpose / Big Picture
判断「事实准确且可读的列表」是否构成独立验收、合并与回滚的 MMP 增量；绿色代码测试不能替代用户闭环与 R1/Demo 验收。

## Context and Orientation
2026-10-29 初始锁定：`feature/truthful-readable-list@b47e70d9a63291454d10f5875f667ee6b953aa49`，base `main@bb9a7a259ab81ca89f01d03aa837555607a74fdd`。执行上下文为检出该分支的 `.worktrees/truthful-readable-list` 根目录。回读：`gh pr view 443 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,statusCheckRollup,closingIssuesReferences`。

## Design / Spec
先建下列风险矩阵，再逐文件检查。重点：可见行新鲜度、redacted 隔离、同步失败/部分读取、八列可读性与键盘导航。采用 Superpowers 独立评审、Qian 系统边界与综合、First Principles 因果与最小反例；优先证明当前交付所承诺的用户结果。

| 等级 | 预先定义的风险 | 判据与最小证据 |
|---|---|---|
| P0 | 合并即破坏 main、数据/凭据泄漏或不可恢复损坏 | diff、事实源/信任边界与破坏性路径逐项检查 |
| P1 | 严重正确性/安全/不变量缺陷，承诺的 MMP 用户结果失效 | 正常/失败路径、跨作用域/身份反例及实际调用链 |
| P2 | 非阻塞的功能或测试判别力缺口 | base/head 对照、已有 issue 与可控修复范围 |
| P3 | 非阻塞的文档、证据或维护问题 | 精确定位，避免为风格扩大设计 |

| 分层 | 评审问题 | 初始状态 |
|---|---|---|
| 代码 | 正常/失败、错误传播、幂等、恢复与反例 | 75 生产链/列表 + 32 展示/详情通过；D/E 与部分成功对照成立 |
| 产品闭环 | 用户触发→权威处理→可观察结果；Saved/规划轴是否诚实 | 560 状态组合及六组 Chromium 布局；八列、时间/来源/占位、导航与键盘保留 |
| 架构 | 七条不变量、依赖边、状态拥有与信任边界 | Core 同一 SyncSummary owner；ui-model 归约仅列表改变；无新 DTO/依赖/Provider 写入 |
| 测试 | 相关命令真实输出、缺失故障路径、必要变异判别性 | D/E/可见 partial 三变异均精准 KILLED、字节恢复；真实浏览器含状态与回焦 |
| issue/设计 | scope/验收/ExecPlan、重复 issue、设计充分性与复杂度 | #366/#429 完整闭环；#427/#430/#314/#144/#143/#236/R1 保持各自边界 |

## Global Constraints
评审证据仅修改本文件；生产/测试修改进入明确修复批次。评审账号 `Singularity-AI-Bot`；开发/回复/合并账号 `SingularityKChen`。2026-10-29 用户在本会话点名 #441–#443，明确授权无 P0/P1 后的修复、独立复评、归档、提交整合、issue 核对与 rebase merge；不包含规划 Status 或依赖写入。

## Plan of Work
1. 锁 head/base、全量 review threads/checks/issue 与实现 owner；按矩阵独立评审。
2. 汇总并验证所有发现后，每 PR 一次性提交一份 inline review；P0/P1 为 REQUEST_CHANGES，其余 APPROVE。
3. 按用户指定 owner 分流；修复需独立复评，最终 push 后重锁全部事实；满足门禁才以 rebase 合并。
回滚：未提交证据可删除本文件；实现修改按所属交付闭环 revert，外部写入须回读确认。

## Validation and Acceptance
在初始锁定 head、检出 `feature/truthful-readable-list` 的 worktree 根目录执行：

- `pnpm test:file tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-list-view.test.js tests/contract/ui-work-item-list-browser.test.js tests/e2e/workspace-read-assembly.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js`：75/75；`pnpm test:file tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-model-presentation.test.js`：32/32，无 fail/skip。
- 560 组状态探针：hidden freshness 切换时安全 view 逐字相同；visible/no-visible、connection、never-read、workspace reason、五类读门、pending/received/失败保缓存均保持保守读取；父评审回读脚本/输出。
- `review-mutate.mjs` 最终整表：D 恢复统计 hidden、E 改回 redacted 使用 stale、visible partial 误用 degraded 三项均 KILLED，分别精确归因 D snapshot 或 E partial 用例，字节恢复、还原基线绿。
- 独立 Chromium：1440/1200/1024 × light/dark 六组，每组 24 格 ink containment 全部成立，document width=viewport；1024 时 region 974、table 1064，滚动仅在局部。loading/empty/offline/redacted/denied，Tab 2px 焦点、Enter 打开 drawer、Escape 回 canonical link 均通过。
- 组合树产品/测试 blob 全等于 `test/iteration9-parallel-integration@f4387cf444e554399d00bdeed36449fd8b5403cc`；父评审在该检出重跑 verify 2459/2459 + MVP0 7/7、typecheck，boundaries 9/9。
- 父评审在 clean `0f3cb834649872c320447f8d88ed1b3e5d33a1ae` 相同产品树上重新生成 base/head 报告与真实 pack：client 163238 raw / 38294 gzip 字节，增量 +2112 / +750；Host +91 / +14；tarball 162336 字节（+768），无新增 inputs/external imports。此后仅调整证据文档。真实 Host 安装/真实 Host 主题、完整屏幕阅读器及人工 Demo/R1 未在本轮接受。

P0=0 / P1=0 / P2=0 / P3=0；无 inline 意见。最小方案保留原生 table 与 Host token，未为小改动引入新 data-table/theme 状态层。

## Progress
- [x] 2026-10-29 锁定初始 head/base，先建立 P0–P3 风险矩阵。
- [x] 2026-10-29 完成五层独立评审、变异与产品探针。
- 2026-10-29 最终提交/批准/门禁/合并采用本记录的回读验收；实际 merge 与 issue 状态由 GitHub 持有，不在文档复制易失值。

## Surprises & Discoveries
初始必需 PR Fast Gate SUCCESS。可选 GitHub review session run `40816380218` 因本地端点连接被拒失败；Rule checks `40805803577` / Issue policy `40805803607` 取消，后继 `40805803806` / `40805803790` 同 head 成功；初始 reviews/comments/threads 全空，无分页遗漏。

首页归约仍包含完整集合是已有边界；D 只改变列表。#314 已跟踪 reducer 维护重构，#430 承担 drawer 的实际 Host 响应能力；#427 父项、#144 动态 provider 健康、#143/#236 人工/独立安装均不能随本 PR 关闭。

## Decision Log
- 2026-10-29：用户直接授权本批三个 PR 通过门禁后的 rebase merge，覆盖原仓库「由人类决定是否合并」要求；规划轴保持人类所有。
- 2026-10-29：实现会话「规划迭代优先 Issues」持有三条实现分支；有 P0/P1 时回交该会话；无 P0/P1 时由本评审按本次用户指令负责收尾。

## Idempotence and Recovery
每次 head/base 变化均重读 diff/checks/threads，旧结论仅保留为带 SHA 的历史。本次改写前恢复锚点为 `refs/backup/pr443-before-mmp-review-20261029`，指向初始已发布 head；以精确旧 head lease 发布，禁止覆盖其他推送。

## Interfaces and Dependencies
GitHub PR/reviews/issues/Actions；本地 Git、pnpm 与相关测试。评审提交指定 immutable head。

## Outcomes & Retrospective
独立全矩阵无可行动发现，原 ExecPlan 已完成归档，当前闭环可独立验收和回滚。最终 head 的批准、CI、issue 与 threads 以回读结果为准；真实 Host、人工 Demo 与 R1 仍独立。

## Bottom Change Note
- 2026-10-29：在读实现前建立风险矩阵与本轮证据入口。

- 2026-10-29：补充本轮独立验证、完整风险矩阵结论与证据边界，进入授权收尾。
