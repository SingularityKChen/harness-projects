# PR #513 MMP 交付评审

> 状态：全层独立评审已完成；评审日期：2026-11-03（Asia/Singapore）。

## Purpose / Big Picture
检验 #513 的能力闭环、issue 验收及组合交付；无未修复 P0/P1、独立复评和当前版本门禁成立后，按人类本次直接授权 rebase merge。

## Context and Orientation
2026-11-03最终只读回读：远端与本地head一致，base仍为下列main；Ready、MERGEABLE、mergeStateStatus=UNSTABLE，closingIssuesReferences仅对应#506。初始全分页reviewThreads/reviews均空；本子评审没有发送外部review。当前PR Fast Gate、Browser、Verify与Merge Gate均SUCCESS；可选Create review session日志已逐项读取，为本地转发端点连接失败（run 41591937632），不是代码lane失败。取消的Issue policy/Rule checks有同head后继SUCCESS；Engineering reconcile取消项仍不能写成已成功，最终全局reconcile由主控回读；不以UNSTABLE推导本次代码失败。

初始观察：`feature/detail-expand@912d12f1a4615cf75065a2e40c28069825f7a3f5`，base `main@957451c684c546ddf8a5d19cb3a23a719940fa9b`。执行上下文为检出 `feature/detail-expand` 的 `.worktrees/detail-expand` 根目录。回读：`gh pr view 513 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,statusCheckRollup,reviews,closingIssuesReferences`。焦点：展开/还原、选中项/滚动/焦点保持、窄屏及键盘操作。

## Design / Spec
先用下列矩阵覆盖全部层次，再逐文件与反例验证；不以代码测试成功推导产品/R1 验收。

| 严重度 | 代码/反例 | 产品闭环 | 架构边界 | 测试证据 | issue/设计 |
|---|---|---|---|---|---|
| P0 | 合入破坏主干或执行任意代码 | 核心任务不可恢复 | 凭据泄漏或第二权威源 | 必需门禁失效 | 违反硬约束 |
| P1 | 严重正确性/安全/竞态 | 主用户路径无法完成或越权 | scope/事实拥有者失守 | 关键故障路径缺陷可复现 | 本层验收严重缺失 |
| P2 | 有替代路径的局部缺陷 | 局部体验/状态回退 | 非关键边界欠缺 | 判别力或覆盖不足 | 文档/范围局部欠缺 |
| P3 | 命名/诊断/可维护性 | 低影响文案或可访问性细节 | 低成本收敛 | 小型验证改进 | 记录、重复追踪、过度设计 |

### 当前矩阵结论（锁定 head `912d12f1a4615cf75065a2e40c28069825f7a3f5`）

| 层 | P0 / P1 | P2 / P3 与证据 |
|---|---|---|
| 代码 / 反例 | 未发现；同一dialog/body业务树，effect不含业务调用 | 未发现；当前读位仅按新合法range物理clamp，不复活旧mode历史 |
| 产品闭环 | 同selected route、draft、pending结果、focus持续 | 实际640×480安装读位2804.5→2804.5与多宽动作几何成立；不当成R1接受 |
| 架构 | mode为本地瞬时呈现；Host矩形仍单owner；无Provider读写扩权 | 无第二router/store/详情实现，无过度通用框架 |
| 测试 | 当前25/25通过；3项变异均由对应具名用例杀死 | tests保留真实DOM身份、MutationObserver、calls负控和物理clamp独立判据，无P2/P3 |
| issue / 设计 | #506范围、closing reference、单提交和可逆性匹配 | code326行/文档101行，低于本issue800/1300；现有#506、#430及#449/#460追踪清晰，无新增重复专门issue |

### 全部 findings

未发现P0、P1、P2或P3，建议 **APPROVE**。展开操作仍保持一个modal与业务树，不需要新状态框架。#512的code-only键盘缺口在组合中仍是Markdown叶子问题，不归因成本PR。

## Global Constraints
仅评审本 PR 差异与必要前序；评审账号 `gh-review`，开发/回复/合并账号 `gh`；不改 Planning Status 或原生依赖；证据不含本机绝对路径、凭据或内部地址。生产文件由指定 owner 单独修改。

## Plan of Work
- [ ] Batch 1：锁定 diff、threads、checks 和 issue；完成全矩阵及反例；一次性提交 review。
- [ ] Batch 2：复核意见、根因修复、独立复评；保留可回滚提交边界。
- [ ] Batch 3：归档计划、整理提交、发布面/规模检查、当前 head 回读及授权合并。
验证入口：在上述检出运行相关 `pnpm test:file <test>`，再按风险扩大；最终运行 `node scripts/rule-checks.mjs disclosure <base-ref>`、`node scripts/rule-checks.mjs size <base-ref>`、`git diff --check <base-ref>...HEAD`；期望退出码 0。回滚点为初始 head 与合并前 backup ref。

## Validation and Acceptance
| #506验收项 | 结论 |
|---|---|
| 同Issue/PR展开、还原、关闭，长title下动作可达 | 当前生产ProjectPage/drawer浏览器25/25，Host矩形限域与两动作量测通过 |
| route/selection/content instance/reading/draft/pending | DOM严格身份、MutationObserver、未决Promise完成、当前双向读位和合法clamp通过 |
| 零refresh/Provider新增调用 | 当前calls前后逐字相同；不是只依赖源码推断 |
| Escape单关、Tab包含、close回有效opener/fallback | 原生showModal/close计数、Tab/ShiftTab/Escape及已有安全fallback回归通过 |
| resize/scroll、五宽、短高、200%文字及light/dark | 当前几何循环和旧reflow40组通过；实际安装原始矩阵与组合原生zoom2报告回核 |
| actual installed source/artifact | 生产源码与当前PR相同，包hash及原始截图/量测存在；本次没有重新安装，不当成新的R1接受 |

在 `.worktrees/detail-expand` 根执行：

- `npx --yes --package pnpm@10.28.2 pnpm test:file tests/contract/ui-detail-reflow.test.js tests/contract/ui-work-item-detail.test.js tests/contract/ui-work-item-detail-browser.test.js tests/contract/ui-work-item-list-browser.test.js tests/browser/detail-expand.test.js`：exit0，25pass/0fail/0skip；5条新增实际Chromium用例均通过。
- `node scripts/review-mutate.mjs ../../.superpowers/mmp-review-20261103/detail-expand-mutations.json`：exit0，3/3 KILLED，变异前及逐字节还原后基线绿。
- `node scripts/rule-checks.mjs disclosure 957451c684c546ddf8a5d19cb3a23a719940fa9b`、`node scripts/rule-checks.mjs size 957451c684c546ddf8a5d19cb3a23a719940fa9b`及argv形式`git diff --check <base>...HEAD`均exit0；人工阅读本PR新增文本、commit与PR描述五类发布面无发现。

| 变异 | killedBy（具名用例片段） | 结果 |
|---|---|---|
| D1 按mode重挂载body业务树 | expand keeps the mounted detail | KILLED |
| D2 toggle丢掉当前读位 | expand and restore preserve current reading progress | KILLED |
| D3 expanded仍用preview矩形 | preview and expanded fit the clipped Host rectangle | KILLED |

安装身份独立回核：`git diff 08f810778e9725294b4177404e10fd8d4d0b4ba7 HEAD -- packages apps`无差异；原安装source不是当前commit但生产逐路径相同。`bundle-detail-fixed/report.json`的tarball实算SHA-256为 `24260279b383d588fbb621d416a8101db7a61f2bef4bce229462b3c4a797c7c6`，与原始`installed-host-detail-fixed/process.json`一致，其记录installedBytesEqualTarball=true；五宽×两mode原始JSON均有实际viewport/动作bounds。实际640×480展开offset2804.5还原2804.5，目的max3905，pass=true。组合原生zoom2报告source `dca3e6f7844dbef7ce0da94f3ff080dadc65f0f0`和artifact `cf710bec2ec6a5a296facea9b1ba174599b60c2a53cfae3918520fca077a9509`实算SHA吻合，9case无errors；这是原始安装证据回核，不是本次重装。

| 验收项 | 证据与判定 |
|---|---|
| 全层矩阵与 issue 验收 | 本记录更新后的结论和 GitHub 单份 review |
| 修复/组合/当前门禁 | 独立复评与当前 head checks；未执行前不判通过 |

## Progress
- [x] 2026-11-03：先建立 P0–P3 风险矩阵。
- [x] 2026-11-03：全矩阵、反例、issue 和设计适配性独立评审完成；结论与全部finding见Design / Spec；未由子评审发送GitHub review或修改生产代码。

## Surprises & Discoveries
先前每mode历史读位错误已由当前实现删除；本次独立审查保留该原始反例的验收语义，而没有把旧head结果当当前测试。CSS宽度扩大后的可读measure和合法clamp已分开检查。

初始 checks 含可选 `Create review session` 失败与取消任务；须逐项读日志，不能据旧记录豁免。

## Decision Log
2026-11-03：人类本次直接要求评审 #513 并由本会话负责后续修复、re-review、归档、commit 整合、issue 核对和 `merge_method=rebase` 合并。该授权不覆盖绕过保护、规划 Status 或依赖写入。

## Idempotence and Recovery
只读回读可重复。写操作先核对精确 head；共享历史修改先建 `refs/backup/pr513-before-mmp-review-20261103`，以精确 lease 推送；并发变化停止该写入并重新锁定。

## Interfaces and Dependencies
GitHub PR/issue/review/checks 为远端工程事实；本地测试仅证明命名版本的本地行为。依赖顺序遵循 PR base 与人类指定队列。

## Outcomes & Retrospective
当前head全层独立评审完成，建议APPROVE，没有新增findings。后续fix/review/push/merge由主控按人类授权执行；head变化后本结论必须重锁。

## Bottom Change Note
2026-11-03：创建风险矩阵，先于分层审查；记录人类授权与恢复路径。

2026-11-03：补充当前immutable head的全层矩阵、全部findings、原始安装身份回核、带killedBy变异及具名验证；未修改远端issue/Planning字段。

2026-11-03：主控核对初始版本完整矩阵与独立证据；本层无新增 finding。最终发布会在真实前序 main 上重放并重读 head/base/CI/issue/threads，随后用评审账号提交当前 head 的结论；不继承旧批准。

2026-11-03 最终实际前序回读：在检出 `feature/detail-expand` 的 `.worktrees/detail-expand` 根，基于 `main@530aa23ee4ebb2b1e0d7b20a0795b09c50557dbf` 完成 frozen install、typecheck 与 `pnpm test:file tests/contract/ui-work-item-detail.test.js tests/browser/detail-expand.test.js`，输出 ℹ tests 16 / ℹ pass 16 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0，exit 0。原生依赖只按真实前序重放，当前 head/CI/threads/issue 仍由文中 GH 回读命令确定；本次提交没有继承旧 SHA 的批准。最终组合 `33472f2b` 与新包 `7209b6e6…115a` 的实际接受边界见批次评审。
