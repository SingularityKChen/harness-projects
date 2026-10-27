# PR #412 MMP 交付评审

## Purpose / Big Picture
手动刷新可见且诚实：views/sync/revision 来自同一次存储读取，未变内容也推进 Host 确认时间，列表与打开抽屉共用单飞入口，失败及部分成功保持正确语义。

## Context and Orientation
2026-10-27 初审 head `2bc7db58b2bba70a9bf1ca3ac71958618f45495d` / base `b164a211b0b0d9669724dc794c2fe32896c4eed0`。修复候选 `d4daf9f95c8ec4ff807ae5ddd42956b3c6ea5ff6` 已独立复评；最终三能力产品组合 `5ab63ce052e6993e2024d94a3d25de4ea7570b69` 已全量验证。#410/#411 合入后已重锁 base main `26e8d05abd71b674b23e9ec64e0b026fabf7a7e0`，rebase 产品候选 `0264d83fb70650d27921f0c2f4e4e02d41e2d222`。执行上下文为 `fix/planning-snapshot` 的 `.worktrees/planning-snapshot` 根目录；最终推送后再次锁定 head/base。

## Design / Spec
先 P0–P3 风险矩阵，再代码、产品闭环、架构、测试、反例、issue 验收。使用 Superpowers、Qian Systems Router、First Principles Development。一致读在 Core/Storage，确认时间和内容由 Host/watch 拥有；刷新器只保存交互状态。错误仅由同 scope 的后续权威成功确认解除；合法部分提交保持整表 degraded、可见行 fresh。

## Global Constraints
单一 Planning 权威、Provider ack 与规划/工程正交；无乐观 Saved。snapshot tx 内不调用 Provider 或根 Storage，不把 UI 点击时间伪造成确认时间。review 用 `gh-review`，作者操作用 `gh`。不覆盖 #218 的晚 baseline 范围、不写看板 Status 或依赖关系。

## Plan of Work
### Batch 1 · 初审
锁定全部事实，先建矩阵，完成全部层次与必要反例；两项 inline 一次提交 APPROVE。
### Batch 2 · 修复与交付
比较最小方案，先 RED 后修复，独立复评；更新原 completed ExecPlan，组合验证，整理能力提交；rebase 后重新锁 head、验证字节与门禁，再授权合并。

## Validation and Acceptance

| 等级 | 代码/反例 | 产品与架构 | 裁决 |
|---|---|---|---|
| P0 | 数据损坏、基础路径破坏 | 第二权威、凭据越界 | 未发现 |
| P1 | 撕裂快照、旧轮覆盖、失败冒充成功 | Host/tx/作用域边界失守 | 未发现；Fake/SQLite 一致三元组与旧 scope/dispose 保护通过 |
| P2 | 同来源后续成功不清旧错误 | 新确认内容持续误标 last-known | F412-1 已修复并独立复评 |
| P2 | 已提交部分成功被当全轮失败 | 全表交互错误覆盖可见行 fresh | F412-2 已修复并独立复评 |
| P3 | 已完成复评/重组仍写等待 | ExecPlan状态与评审记录相反 | F412-3已机械收口，历史结论原处标注Superseded |

#361 AC1：Fake/SQLite 注入交错提交，一次 Storage 读作用域返回 views/sync/revision。AC2：未变内容推进 reconciledAt，业务 revision 不变。AC3：wire 接受合法时间、拒绝畸形值且不部分更新（用例位于 e2e 文件，直接验证运行时协议边界）。#360 AC1：真实 controller metadata 到达列表及已开抽屉；AC2：失败保留最后确认内容并 stale；AC3：在途双击 Provider read=1、Promise 同一。恢复边界另由下述新回归覆盖。

初审 review `5665075601` 一次发布两 P2 并 APPROVE。根评审亲自重放 controller/Fake/sync/React 反例：F412-1 Host fresh、time=T2，旧 error 仍使列表/抽屉显示最后已知值；F412-2 返回 local_only/ok=true/degraded=true/permission_denied，可见行已 fresh，却被交互错误全局标 stale。均为本 PR 新增，有手动成功刷新恢复路径，未定为 P1。

修复选择 source 确认 fence + 严格提交分型；仅清 UI 文案不能恢复因果关系，任何 fresh 都清错会借旧读数伪造成功。failedAt 在失败结算时取 Host 读数，只接受以后同来源、connected、具备读能力且无降级 reason 的更新确认；严格区分完整成功、合法权限缺口部分提交、ok=false/传输/畸形响应。

在锁定产品候选的工作树根目录运行：

```sh
node --test --test-timeout=120000 tests/integration/planning-snapshot.test.js tests/integration/harness-plugin-planning-refresh-ui.test.js tests/contract/ui-planning-refresh.test.js tests/e2e/workspace-read-assembly.test.js
node --test --test-timeout=120000 tests/integration/harness-plugin-planning-refresh-ui.test.js tests/contract/ui-planning-refresh.test.js tests/contract/ui-work-item-app.test.js tests/e2e/client-sync.test.js
node_modules/.bin/tsc --noEmit
```

| 证据 | 实际结果 |
|---|---|
| 新回归 RED | 旧实现 13 pass/4 fail：后台确认、pending 后晚失败、部分成功、畸形 ok=true |
| 修复 GREEN | 最小17/17，扩展相关80/80，typecheck、diff-check通过 |
| 保护反例 | 同scope重连恢复；旧fresh/改名/旧时间/断连/降级/无读能力不清错；真正ok=false/transport仍stale；旧scope/dispose不发送或结算 |
| 独立复评 | 80/80、tsc；额外真实controller完整/部分响应 JSON 往返、7项否证输入、metadata恢复、可见行/抽屉fresh、换binding晚成功/失败fence通过 |
| 最终产品树变异 | 本能力11/11 KILLED；三能力最终组合整表28/28，killedBy逐项匹配、前后基线绿、字节还原；完整表见批次记录 |
| 最终组合与rebase | 最终组合typecheck、2157/2157、MVP-0 7/7、插件pack通过；rebase后根会话再次verify2157+7。5处冲突保留映射、执行意图与刷新接点；全部apps/packages/tests/锁文件与组合树逐字一致 |

最终在新 base 上运行固定 pnpm10.28.2 的 verify、disclosure、size、diff-check；推送后 `gh pr view 412 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,mergeStateStatus,closingIssuesReferences,statusCheckRollup`、`gh pr checks 412 -R SingularityKChen/harness-projects` 必须回读当前 head。期望 required PR Fast Gate 与相关门禁通过，#360/#361 双向关联、原两 thread 有已验证作者回复且解决。初审取消运行有成功后继，可选 endpoint 故障由 #364 跟踪。

## Progress
- [x] 2026-10-27 先矩阵后全层初审，根独立复现，两条 inline 一次发布。
- [x] 两项 P2 的 RED→GREEN、独立复评与原 completed ExecPlan 修复批次。
- [x] 三能力最终组合2157+7、pack、最终28项整表变异与还原。
- [x] #410/#411合入后rebase、完整产品字节核对与verify2157+7。
- 最终外部回读按下述恢复约束执行，并由批次记录维护。

## Surprises & Discoveries
local_only/ok=true 可以同时携带合法权限缺口 error，不能等同全轮失败；Host 头 degraded 与可见行 fresh 是不同事实。全量开放 issue 未见本次两项新增问题重复跟踪。#218 晚 baseline、#202 换源投影、#144 动态 capability 不作为本 PR 重复发现。

## Decision Log
- 2026-10-27 / 人类：PR #410–#412 仅 P2/P3 时授权本会话修复、re-review、归档、整合、核对 issue 后 `merge_method=rebase` 合并；本 PR 条件满足。
- 2026-10-27 / 根评审：初审无 P0/P1，修复由本会话负责，另一个未参与实现的子评审独立验收；Host/watch 继续拥有确认事实，不从交互状态派生权威内容。

## Idempotence and Recovery
原发布 head 由本地 `refs/backup/pr412-pre-review-20261027` 保存，修复候选由 `refs/backup/pr412-fixed-review-20261027` 保存。每次 rebase 后核对完整产品字节及当前 head 门禁，精确 lease 拒绝覆盖他人推进。整体 revert 能力提交恢复刷新逻辑，不删用户配置、执行记录或 Git 产物。

## Interfaces and Dependencies
根 AGENTS、PLANS、MMP 评审流程、`docs/exec-plan/completed/2026-10-27-planning-refresh-confirmation.md`，Core queries/Storage tx、Controller wire、client sync/refresh、UI list/drawer。跨能力冲突、逐项变异与串行交付见 `2026-10-27-pr410-pr412-mmp-review.md`。

## Outcomes & Retrospective
两个 P2 已消除，修复独立复评无新增缺陷，最终组合自动化证据成立。未执行真实 Desktop、在线 GitHub 或模型走查；#143 与 #124/#136/#226 的父项验收仍保留，不声称全产品 MMP/MVP-1/R1 完成。

## Bottom Change Note
- 2026-10-27：先建立矩阵；完成两反例、根因修复、最终变异与独立复评；收敛为简洁证据，最终易失状态用当前head回读维护。

- 2026-10-27：#410/#411合入后重base到26e8d05；5处冲突与最终组合树逐字比对，完整verify2157+7通过，最终head另行回读。

- 2026-10-27：最终复评发现F412-3（计划状态P3），以APPROVE一次提交；机械收口三份ExecPlan与已合入#410记录的Progress，不改产品，重新锁文档head。
