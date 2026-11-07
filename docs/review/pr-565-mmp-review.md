# PR #565 MMP 交付评审

## Purpose / Big Picture
当前不可变 head 的独立交付结论：**REQUEST_CHANGES**。一项 P1，需原 owner 修复并独立复评；无其他已证实 P0/P2/P3。评审覆盖整张风险矩阵，没有在首项问题后停止。

## Context and Orientation
2026-11-07 观察：head `21d836d177d0bf8c1ba5f7f21d0e34918948dc2f`；直接 base `a96522978f377fe29849652b32db67e61b47250c`；#565 关闭 #563，父项 #556 仅引用。完整原生线程为 0，分页终止；缓存 `*-threads.json` 回证两端 SHA。执行上下文为检出 `feature/pull-request-issue-choice` 的工作树 `.worktrees/pull-request-issue-choice-20261107`。
不可变差异缓存为 `.superpowers/pr559-565-review-20261107/565-immutable.diff`；本记录只对上述 head 有效。#565 依赖 #564，原生 stack #566；#544 拥有持久原生观察恢复，#557 拥有 PR assignee。

## Design / Spec
采用 Superpowers 的证据优先验证、Qian Systems Router 的系统边界/信息反馈和 First Principles Development 的事实/约束分离，审阅 Provider→Core→Host→strict client→UI 的完整路径。关系观察不等于 implements 或 execution lineage；创建确认与选定关系确认分别结算；Planning Status 保持独立。
目标必须由当前 project/membership/Issue/repository 回证。默认 Refs；Closes 只允许已回证默认分支；none 保留正文。原目标/选择/最终正文/fingerprint 持久冻结；恢复只读原 PR，不重复 create。

## Global Constraints
仅拥有本评审记录与运行态 repro/spec/log；不修改生产实现，不 commit/push，不执行 GitHub 写入、模型启动或合并。原工作树检查干净；结束时除本评审记录外无 tracked 改动。证据文件置于 `.superpowers/`，正文不写本机路径和内部系统。

## Plan of Work
1. 锁定当前 head/base、完整线程、checks、issue scope 与 immutable diff。
2. 完成五层 P0–P3 矩阵，检查正常、失败、并发、权限、恢复、正文和独立验收边界。
3. 运行最窄相关回归、浏览器链与带 `killedBy` 的变异；独立反例只修改 fixture/repro。
4. 汇总全部意见；交原 owner 修复，独立评审者不参与修复。
回滚仅移除本评审记录及对应运行态证据，不影响用户 PR 或数据库。

## Validation and Acceptance
| 层 | P0 | P1 | P2 | P3 | 证据与判定 |
|---|---|---|---|---|---|
| 代码 | 未发现 | REL-565-F1 | 未发现 | 未发现 | 写前回证、同键冲突、marker/fingerprint、原 PR 只读恢复已审 |
| 产品闭环 | 未发现 | 同一权限失效根因 | 未发现 | 未发现 | 默认/Closes/none 与正文保留通过；连续打开预览和原摘要泄漏已证实 |
| 架构 | 未发现 | UI 未消费 native 权限版本 | 未发现 | 未发现 | 单 Planning、Host 权威、Provider 边界、凭据 handle、事实谱系均核对；无越层依赖 |
| 测试 | 未发现 | 现有 remount 测试漏掉连续打开 | 未发现 | 未发现 | 真实命令与变异见下；绿色回归不能否定独立反例 |
| 工作项 | 未发现 | #563 权限闭环未满足 | 未发现 | 未发现 | issue 标签/scope/closing 关联正确；#544/#557 无重复实现；人工接受保持独立 |

在上述工作树根运行：

```sh
pnpm test:file tests/contract/issue-link-target.test.js tests/contract/ui-create-change-request.test.js tests/contract/harness-host-operations.test.js tests/contract/harness-host-remote-adapter.test.js tests/integration/create-change-request-link-recovery.test.js tests/integration/harness-plugin-change-request-operation.test.js tests/integration/change-request-operation.test.js
pnpm test:file tests/browser/workspace-execution.test.js
node scripts/review-mutate.mjs ../../.superpowers/pr559-565-review-20261107/565-mutations.json
```

实际窄回归 **144/144**、Browser **4/4**，均 exit 0；日志 `565-narrow.log`、`565-browser.log`。变异脚本 baseline 和还原后 baseline 均绿；逐原文字节还原，无遗留源码改动。

| 变异 | 目标性质 | 实际结果 |
|---|---|---|
| C1 | 非默认分支禁止 Closes | KILLED，`reference is default, durable` |
| C2 | 旧目标预览 stamp 拒绝 | KILLED，`association rejects stale-preview` |
| C3 | 正确 Refs/Closes 托管正文 | KILLED，`explicit close uses default branch` |
| C4 | 拒读代际阻断迟到证明 | KILLED，`F1 current source denial during-cohort` |

发现：**[P1] Invalidate Issue previews and saved summaries on native access changes**，新增行锚点 `packages/ui/src/create-change-request-section.ts:29–31`。创建消费者需要接入当前来源与原生读取权限版本。这里的 options effect 只依赖 current、base、operation.kind，而父 DeliveryLineageSection 给该组件的 key 只包含 deliveryAccessTokens；work-item-detail-view 的 delivery token 不含 primary、planningSource 或 nativeAccessVersion。因此，当另一调用对同一来源 Issue 实际读到 403/404、Host 已撤销目标证明并发出新的 nativeAccessVersion 时，持续打开的表单仍从 issueView 显示旧仓库名和 #编号，已保存原请求摘要也仍从 view 显示原 issueTarget。独立 Chromium 反例只给既有离线 HTTP fixture 增加合法 PlanningIssueLinkTarget 响应：先预览 Refs，再让同 source 的真实 target query 返回 403；后台 options.target 已为空，浏览器已收到该 native metadata，旧预览仍在 DOM。第二条 actual target decoder→SQLite Host→strict creator→实际组件反例证实，后台 operation query 已不含 issueTarget，而原连续挂载摘要仍有 example/project#545，native create 保持一次。Core 写前拒绝仍有效，但已知撤权后的 UI 元数据披露违反 #563 的权限丢失闭环。请将来源/权限签名传到创建消费者，在 render 阶段拒绝旧 options、operation target 和关系确认回执，再读取获准的 Host 快照；保留用户草稿输入和持久操作，不让 metadata 自动触发 target probe 或第二次 create。测试要覆盖持续打开的表单与 saved 摘要、迟到响应和重复拒读，而不只在拒读后 remount。

在同一工作树根的两个独立判别反例：

```sh
node .superpowers/pr559-565-review-20261107/preview-denial-repro.mjs
node --test .superpowers/pr559-565-review-20261107/saved-summary-denial.test.mjs
```

两者在当前实现均以“已拒读目标必须隐藏”的断言 **exit 1**。第一条真实 Chromium 仅扩展现有离线 HTTP fixture 的目标 query，生产 apply/Provider/Host/client/UI 全部原样使用；输出 `backendTarget=null, metadataObserved=true, leakedPreview=true`。第二条真实目标 decoder/SQLite Host/strict creator/实际组件输出 `metadataChanged=true, leakedSavedSummary=true, nativeCreates=1`；Core 的新 operation query 已无目标。日志 `565-preview-denial.log`、`565-saved-summary-denial.log`；原生读拒绝仍阻止新关联写入。

metadata 缓存中 `PR Fast Gate=SUCCESS`；可选 `Create review session` 为 FAILURE，重复 Rule/Issue jobs 有 CANCELLED 且同 head 后继 SUCCESS。这里只记录观察，不代替父协调的当前远端门禁回读。直接 base 规模：代码/测试/配置 642 行、原 PR 文档 154 行，均低于叶 issue 的 800/1300 限制。

## Progress
- [x] 2026-11-07 锁定当前 immutable diff、完整空线程、scope 和风险矩阵。
- [x] 2026-11-07 完成逐文件/跨层/产品/权限/恢复/issue 审阅。
- [x] 2026-11-07 完成窄回归、真实 Browser 与最终整表变异，核对还原。
- [x] 2026-11-07 全部意见写入本记录及 `review-relations.json`，未发 GitHub review。
- [ ] 原 owner 修复 P1，并由独立评审者核对新 head。

## Surprises & Discoveries
既有核心 F1–F4 负例和重挂载 UI 测试全绿，持续打开消费者仍未收到相同的权限失效语义；两个独立反例把边界定位在 UI 缓存 admission。

## Decision Log
- 2026-11-07：按每层直接 base 评审与计量，不把 #565 继承源码计作本层新增；#556 仍为父项，#544/#557 不扩入。
- 2026-11-07：P1 交原 owner；修复限来源/权限签名消费与敏感回执失效，不重构 PR 创建持久协议。

## Idempotence and Recovery
读操作和窄测试可重跑；变异夹具已按字节还原，`git status --short` 只有本评审文档未跟踪，`git diff --check` exit 0。任何新 head 使本结论需要重新锁定，不复用旧绿。外部 PR/Issue 未被本评审修改。

## Interfaces and Dependencies
依赖现有 Node/pnpm、只读 GitHub metadata 缓存、隔离 SQLite/HTTP fixtures 与 Chromium。修复复评须覆盖 form 与 saved 摘要；保留用户输入、原 intent 与 create=1；拒读 metadata 不产生自动 target probe 循环；旧响应不能复活。

## Outcomes & Retrospective
完整矩阵结论为 **REQUEST_CHANGES**。一项 P1 已有两条判别反例，无其它已证实缺陷。工程测试不是 live GitHub mutation、exact-artifact Desktop 验证或人类发布接受；这些均未在本评审执行。后续 GitHub review、owner 修复和新 head 复评由父协调串行安排。

## Bottom Change Note
- 2026-11-07：先建立全矩阵，随后追加独立审计、实际测试/变异、全部发现及产品接受边界；保留原 owner 修改权。

2026-11-07 SGT 独立修复复评：Superseded by 2026-11-07 原 relation reviewer 独立 scoped 复评 ADDRESSED：原 Chromium反例、完整草稿/迟到/重复拒读矩阵与真实安全详情签名的saved摘要探针均通过；tracked窄回归48/48，新增守卫8/8具名变异KILLED，baseline/还原绿，候选源码hash与owner final-v2一致。无新增P0/P1/P2/P3；最终真实main restack、不可变head及托管门另行回读。 真实Browser正控保留完整输入、迟到DTO不得复活、重复拒读不自动probe；saved摘要由实际safe detail prop驱动且恢复create=1。首轮REQUEST_CHANGES只对应旧发布head，正式新head批准须等最终门禁与远端回读。

2026-11-07 SGT 最终实际main接合：只有docs/README并列索引冲突，全部保留。所有非docs受管文件与协调者完整组合相同，verify3718+8、Browser58、boundaries9、workflow8文件通过；最终发布head须再完成独立重锁、真实CI、全部threads及双向issue回读，才以原生rebase合入。

2026-11-07 SGT 最终重锁：03a72bae 真实base上的独立48项、持续打开/迟到/完整草稿/no-probe与saved恢复均通过；初始4+修复4unit+4Browser整表12/12归因KILLED，所有受管文件逐字节还原。另发现根协调者合并索引时复活#564旧Active入口（P3），现删除该唯一旧行；五份工程计划均只有一个Completed入口，所有README相对文件链接可解析，源码/tests未变。此文档修订用非docs树相同比较绑定原安全复评结果，不重复冒称产品测试。
