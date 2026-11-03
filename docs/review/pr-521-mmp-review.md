# PR #521 MMP 交付评审

> 状态：独立全矩阵评审完成，建议 APPROVE；评审日期：2026-11-03（Asia/Singapore）。本记录不代表已提交 GitHub review 或已合并。

## Purpose / Big Picture

判断本层是否独立可验收、合并和回滚；核查功能、权限、状态所有权与上下游组合。发现项：P0=0、P1=0、P2=0、P3=0。该建议只对以下锁定 head/base 有效。

## Context and Orientation

执行上下文：检出 `feature/table-resize` 的 `.worktrees/table-resize` 根目录；head `82c8623f0cdd50087f0c137bc8db515f2b84dda0`，base `feature/table-geometry@c596d3035fda98f7ebae7796181c2a0c93f63b25`。评审前后本地/远端 head 均一致；只新增此评审文档，没有产品修改。直接读取当前 diff、全部 review/threads、关联 issue 和已完成 ExecPlan；旧 `*-review` 检出未用作证据。

远端回读：`gh pr view 521 --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,closingIssuesReferences,statusCheckRollup`；观察 `isDraft=false`、`MERGEABLE`、当前 head 的 `PR Fast Gate=SUCCESS`。关联：#515（子闭环）；Refs #507。全部线程分页结束；#520/#521 各一条过时且已 resolved 的 CodeQL 测试文本提取意见，当前对应代码已改为语义提取；#522 无线程。

## Design / Spec

矩阵在逐层检查前建立；本轮逐项填入实际结果。核心范围：`column-resize.ts`、`work-item-list.ts`、`work-item-app.ts`→`work-item-project.ts` scope 传递，仅为追踪数据流扩展到 App、safe projection、浏览器 fixture 与相关合同/集成消费者。

| 严重度 | 代码与反例 | 产品闭环 | 架构与信任边界 | 测试/issue/设计结果 |
|---|---|---|---|---|
| P0 | 无 P0；列宽只有内存展示状态，没有 Provider/Storage/Planning 写入。 | 无破坏性主路径回退 | 七条不变量与 Host 权威不变 | 无必需门禁失效 |
| P1 | 无 P1；min/max/有限值、capture loss/cancel/Escape/blur/unmount/reset/scope 生命周期通过；scope 同 render 隔离。 | 本层主要操作完整可达 | 无 scope 越界、隐藏值回流或第二事实源 | 本轮定向验证和变异支持；无 P1 |
| P2 | 无 P2；pointer 完成与键盘改宽均保持可见焦点及 Y offset，20 组布局、重置与刷新保留通过。 | 失败、恢复及组合状态均复核 | 依赖方向符合 ui-model→ui→apps | issue 功能条款有直接证据；无 P2 |
| P3 | 无 P3；宽度 controller、列契约和 DOM handle 职责适度；未引入全局监听或持久化偏好。 | 控件与现有导航/主题协调 | 无额外运行时依赖 | 设计与切片适度；无 P3 |

## Global Constraints

独立评审只写此文档，不修产品、不提交 review、不 commit/push/merge；生产修改由主控 owner 负责。工程状态与 Planning Status 正交；不写原生依赖关系。公开文档不记本机绝对路径、凭据或内部地址。局部成功不推导完整原生桌面壳、辅助技术或 Gate R1 验收。

## Plan of Work

- [x] 锁定 head/base、全部 threads/reviews、checks、issue 与验收范围。
- [x] 完成 P0–P3 代码/产品/架构/测试/工作项矩阵和反例。
- [x] 最窄有效验证、指定工具变异与还原后基线复验；复核版本未改变。
- [ ] 主控按完整批次处理 GitHub review、后续提交整理和最终远端回读；本子评审未执行这些操作。

## Validation and Acceptance

本轮在上述执行上下文实际运行：

```sh
node --test --test-timeout=120000 tests/browser/table-resize.test.js tests/browser/table-resize-regressions.test.js tests/contract/ui-column-resize.test.js tests/contract/ui-work-item-list.test.js tests/contract/ui-work-item-detail.test.js
```

实际输出 `tests 31; pass 31; fail 0`，退出码 0。本轮没有将历史完整回归或安装接受称作独立重跑。

| 验收项 | 证据与判定 |
|---|---|
| 本层功能与安全 | 指针/键盘共同 bounds、取消与 lost capture 清理、不导航、workspace+Planning binding 作用域及同 scope 刷新保留由本轮验证直接支持。 |
| 判别力 | R1：pointercancel 改为正常完成、不回滚；由 `pointer changes actual geometry` 用例 KILLED。 |
| 变异恢复 | `node scripts/review-mutate.mjs <spec.json>` 返回 0；基线、变异、还原后基线由 runner 完整执行；最终只有本评审文档未跟踪。spec/log 位于 `.superpowers/mmp-review-20261103/table-audit/pr-521-mutations.*` |
| issue 范围与预算 | gh 实读 #514/#515/#516/#507；单层代码/测试/fixture 增删 333 行、原文档 122 行，低于 800/1300；每层一个能力提交。#515（子闭环）；Refs #507 |
| 安装与父项边界 | 实读组合安装 report：source `dca3e6f7844dbef7ce0da94f3ff080dadc65f0f0`，artifact SHA-256 `cf710bec2ec6a5a296facea9b1ba174599b60c2a53cfae3918520fca077a9509`，报告 installedBytesEqualTarball=true、native zoom=2、9 cases、errors=[]。这是已有报告核验，本子评审没有重复安装；父项功能 rollup 接受见 Q ExecPlan，#449/#460 与 R1 保持独立。 |


`git diff --check <上述base SHA>...HEAD` 退出码 0。产品/测试输入未因评审留存变异。Hosted Verify、Browser、Merge Gate、CodeQL 均在 snapshot 为 SUCCESS；有取消的重复任务，不用单一红色摘要推断代码失败。唯一 FAILURE 为可选 `Create review session`：逐一读取三个当前 job 日志，实际错误均为本地 review endpoint 连接拒绝；当前必需 `PR Fast Gate` 成功，未冒称所有 checks 全绿。

## Progress

- [x] 2026-11-03：先建立矩阵，再完成顺序 #520→#521→#522 的全层检查。
- [x] 2026-11-03：上述 31/31 定向检查与已归因变异通过，远端 head/base 回读不变。
- [x] 2026-11-03：独立建议 APPROVE；没有需锚定新增行的 actionable finding。

## Surprises & Discoveries

传统滚动条必须以 focus 后 client viewport 判定；现有 G 回归确实杀死 112px 旧值。本轮还核对取消/失捕获不能以卸载成功替代，secret 差分不能以字符串扫描替代。查询默认五列和“显示/共可读”计数是有意范围，不是删除 redacted 安全占位。三层共享一个 table owner，Q 实际消费 R 生命周期，线性依赖成立。

## Decision Log

2026-11-03：人类本次直接要求评审 #521 并由本会话负责后续修复、re-review、归档、commit 整合、issue 核对和 `merge_method=rebase` 合并。该授权不覆盖绕过保护、规划 Status 或依赖写入。

2026-11-03：本轮独立全矩阵只给当前 head 的 APPROVE 建议；未行使 GitHub 写入或合并授权。按 first-principles audit 与 Qian analysis-synthesis 核查局部证据是否闭合到用户路径，不以测试数量或既有安装摘要替代本轮风险判断。

## Idempotence and Recovery

read-only 回读可重复。三个变异均由仓库 runner 在各自原检出执行、逐字还原并重跑基线；Git 状态确认无残留生产 diff。若 head/base 变化，当前建议失效，必须重锁并对受影响路径复评。撤销本轮只有删除未跟踪的此评审文档；未执行破坏性清理。

## Interfaces and Dependencies

G 的 TABLE_COLUMNS 与局部 XY owner 为 R/Q 共享呈现契约；R 的 scope 是 workspace+Planning binding 的内存偏好；Q 输入只允许 VisibleListRow，visibleColumns 不承担权限判定。ui-model 叶子不依赖 React/Provider，ui 不调用 Provider；排序、搜索、列宽不产生规划事实。跨层重放须保留 presentationScopeKey 传递，先 G 再 R 再 Q，不能把先前 base 的检查算到重写后 head。

## Outcomes & Retrospective

建议 **APPROVE**；P0/P1/P2/P3 均无新增发现。相同问题已由 #514/#515/#516/#507 跟踪，无需另建重复 issue；相关 #446/#449 是基本可读/安装接受的既有边界。栈顶查询→调宽→列显示→详情→Escape 状态保持补充探针通过；完整跨功能组合与最终 hosted/发布面回读由主控执行。

## Bottom Change Note

2026-11-03：把预建风险矩阵填为当前精确 head 的完整独立评审结果，加入真实定向输出、变异归因/恢复、issue 与安装证据边界；没有生产改动或 GitHub 外部写入。

2026-11-03：主控核对初始版本完整矩阵与独立证据；本层无新增 finding。最终发布会在真实前序 main 上重放并重读 head/base/CI/issue/threads，随后用评审账号提交当前 head 的结论；不继承旧批准。

2026-11-03 最终实际前序回读：在检出 `feature/table-resize` 的 `.worktrees/table-resize` 根，基于 `main@c0c84ba1517440249f5152dd38f16cf0c0fe130e` 完成 frozen install、typecheck 与 `pnpm test:file tests/contract/ui-column-resize.test.js tests/browser/table-resize.test.js tests/browser/table-resize-regressions.test.js`，输出 ℹ tests 7 / ℹ pass 7 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0，exit 0。原生依赖只按真实前序重放，当前 head/CI/threads/issue 仍由文中 GH 回读命令确定；本次提交没有继承旧 SHA 的批准。最终组合 `33472f2b` 与新包 `7209b6e6…115a` 的实际接受边界见批次评审。
