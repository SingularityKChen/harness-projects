# PR #612 · MMP 交付评审

## Purpose / Big Picture

核对 #605 交付与安装验收的边界。首轮结论：一项 P1，阻止本层合并。

## Context and Orientation

2026-11-11 SGT 首轮锁定 `200803e2ccf05a4163032ecd6d9a291771e1817c`（`feature/planning-board`）对 `22db967418d891237c7466ea91cee3efa32fbd94`（#615）。原生栈 #616：#610 → #611 → #615 → #612。#605 双向关闭引用存在；首轮前无 GitHub review 线程。

## Design / Spec

| 风险 | 分层结论 |
|---|---|
| P0 | 没有 Provider 写入；未发现直接暴露被脱敏的正文、编号或原生标签。 |
| P1 | 组成 Board 时以 DTO 行数选空态：同一读取状态、同为零可读工作项，空快照与全脱敏快照措辞不同，泄露不可读条目是否存在。 |
| P2 | Board 清除条件重置隐藏的 List 显示列；复用的规划状态排序选项未说明固定组序和组内效果。 |
| P3 | 已归档 ExecPlan 标题仍为 Active、待独立验收，与进度冲突。 |

## Global Constraints

Host 保持事实权威，规划与工程分离；修复不新增 Provider 写入、主题、路由或业务 store。不以源码、fixture 或 CI 代替安装产品验收。

## Plan of Work

修复批次由原实现会话处理一次性 review 的全部意见，补对抗回归和证据。评审会话按新 head / 实际 base 复评；依赖层不先行合并。回滚按原生栈逆序撤各层。

## Validation and Acceptance

在 `.worktrees/planning-board` 对上述固定 head 复核。在 composed List/Board 入口按代码区分零可读两种路径；修复应断言相同 DOM/AX 空态，同时保留加载、拒绝、陈旧及筛选零结果。实际浏览器验证 List 启用来源列 → Board 清除 → List 显示列丢失，且状态升降序不改变参考看板。70 目标测试、9 边界检查、类型和发布扫描通过；`review-mutate.mjs` 三项分组变异按归因检出，技术 493、文档 293 行。 `gh pr checks 612 -R SingularityKChen/harness-projects` 的当前 Fast Gate、Verify 与 Browser 成功。

## Progress

- [x] 2026-11-11 SGT：独立分层评审、验收反例与现有事项检索。
- [x] 2026-11-11 SGT：由评审账号一次提交 [REQUEST_CHANGES](https://github.com/SingularityKChen/harness-projects/pull/612#pullrequestreview-5851923046)。
- [ ] 复核修复提交及该提交的实际 base、当前门禁和全线程。

## Surprises & Discoveries

#145 为完整 Board/Kanban 父项，#608 为确认写入，#599 为实装；未找到替代当前 #605 授权零态要求的开放 issue。规范组序和只读共享 query 架构合适。

## Decision Log

2026-11-11 SGT：P1 对应本层明确验收；交原实现会话修，当前提交不合并。P2/P3 与 P1 同轮交接。

## Idempotence and Recovery

从固定 head/base 重跑对应反例；head 或 base 变更即重新定位及复评。保留现有层与其证据，避免与作者同时改动生产文件。

## Interfaces and Dependencies

GitHub 双账号、#616 原生栈及 #599 实装验收。

## Outcomes & Retrospective

首轮验收不成立；绿色检查没有覆盖上述产品场景。规划 Status 与 R1 不由这次评审改变。

## Bottom Change Note

2026-11-11 SGT：记录首轮风险矩阵、关键反例与当前 review。


## 作者修复证据 · 2026-11-11 SGT

本节追加于完整首轮报告之后，首轮 REQUEST_CHANGES 和阻止合并结论保留。修复准入为服务端 restack 后的 `46d86da50f092e74ecac5ad429399196518a5084`，实际 base 为 `823ff8faeaf396f6ba95a3b1f004d1db246bd76c`；原首轮评审源码身份仍为本报告 Context 中的历史 head。以下是作者本地证据，尚未独立复评或作为当前远端检查。

| 原意见 | 根因与最小修复 | 判别证据 |
|---|---|---|
| P1 授权零态 | `bodyOf` 以 DTO 总行数选空态；改用已有查询结果的 `loadedReadableCount`，List/Board 同用既有 EmptyState，仅就当前已加载可读作用域判空，未另推读状态 | 同一 confirmed read 的真实 WorkItemApp/client 入口下，empty 与 all-redacted 的完整 region HTML 和 AX 均严格相等；原实现两模式不同。mixed、stale/loading/denied、filtered-zero 仍由原合同和真实 Host 浏览器正反控保护 |
| P2 清除列偏好 | 共享 reset 同时重置隐藏的显示列；仅 Board clear 合并保留原 `visibleColumns`，List reset 维持原语义 | List 启用来源列、选择排序并搜索 → Board clear → List，来源列仍启用且查询/排序清空；原实现来源 checkbox 变 false |
| P2 排序作用域 | 规范列序固定却提供新的规划状态升降序；Board 新选项仅标题/迭代/日期，标明组内卡片排序与固定列序 | 继承 List 规划状态降序时保留真实条件，以 disabled 已选项明确“保留列表”与固定列序；切回 List 仍 descending；标题降序只改变组内顺序，规范列序不变 |
| P3 计划生命周期 | 归档页首仍 Active 且待独立验收；改为原交付 Completed、本轮 MMP 待复评、#599 安装门独立 | 修改前后对照页首与已完成 Batch3；原句保留并就地标 Superseded；未声明人类或安装接受 |

在 `feature/planning-board` 的 `.worktrees/planning-board` 根目录执行原计划 Batch4 的三个新反例：修复前 3 条 RED，修复后 3 条 GREEN。原 Batch2 受影响浏览器 32/32、相关 Board/List/query 合同 39/39、边界 9/9 与 typecheck 通过；完整 `pnpm test` 为 1553 contract、2185 integration、226 e2e，共 3964/3964，零失败/跳过。完整测试仍包含 reflow fixture 与 plugin artifact 两项既有 `useLayoutEffect` SSR warning，本次未新增 layout effect。

截图按原源码和修复源码分别记录 source head、dirty、逐文件 SHA-256、实际 theme/font/viewport/data、逐 PNG SHA-256；原始日志和带标签接触表留在本次 ignored 执行目录，协调者最终整合后选择静态证据并更新公开来源。图像不随后续 restack 重标身份。浏览器 fixture 与源码结果不构成安装 Host 或 #599 验收，旧 Ready 不构成本轮 MMP 接受。

待协调者独立复核本批提交、实际 base、最终规模、current-head checks 和全部线程后，才决定是否回复或 resolve。本批没有 Provider 写入、规划 Status/native 依赖修改、push 或合并。

### 协调者串行整合验证

2026-11-11 SGT：本叶已重放至已批准8d9175f5；13个自己的技术blob不变，共享模块bodyOf等于已复评Board、ItemTable等于已批准611（AST逐字检查），仅保留合法组合。clean1967a810执行三层8项原关键反例及typecheck通过，含新授权零态/列保留/排序和继承的详情/窄屏/调宽；本轮8图和新actual-base bundle另记录，不重复完整suite或固定源变异。最终用 `gh pr view 612 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,reviewDecision,statusCheckRollup` 与 `gh pr checks 612 -R SingularityKChen/harness-projects` 回读；原线程待正式复评，不把源码与CI转作安装/#599。
