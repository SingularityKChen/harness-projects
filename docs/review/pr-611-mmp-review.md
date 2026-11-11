# PR #611 · MMP 交付评审

## Purpose / Big Picture

核对 #614 交付与安装验收的边界。首轮结论：一项 P1，阻止本层合并。

## Context and Orientation

2026-11-11 SGT 首轮锁定 `37c84f92b1164a9c6e719eb73cd437cb1b198912`（`feature/release-workspace-polish`）对 `d449f90b12a114cea78f2de97953a4266204b2b9`（#610）。原生栈 #616：#610 → #611 → #615 → #612。#614 双向关闭引用存在；首轮前无 GitHub review 线程。

## Design / Spec

| 风险 | 分层结论 |
|---|---|
| P0 | 作用域投影和 canonical Done 防线保留；没有新 Provider 写入或泄露。 |
| P1 | 窄屏与 200% 下离线陈旧提示把 List 推出可滚动区，#614 要求的可达性未闭合；父版也失败，属于验收缺口。 |
| P2 | 无位移调宽冻结自动宽度、拖动中尺寸变化沿用旧上限；Tab 到目标日期排序时被裁；公开素材缺 1200/1024 与长文、异常、200% 对照。 |
| P3 | 无独立 P3；复用现有证据并保持实装门独立。 |

## Global Constraints

Host 保持事实权威，规划与工程分离；修复不新增 Provider 写入、主题、路由或业务 store。不以源码、fixture 或 CI 代替安装产品验收。

## Plan of Work

修复批次由原实现会话处理一次性 review 的全部意见，补对抗回归和证据。评审会话按新 head / 实际 base 复评；依赖层不先行合并。回滚按原生栈逆序撤各层。

## Validation and Acceptance

在 `.worktrees/release-workspace-polish` 对上述固定 head 复核。同一 composed fixture 对照实际父版和当前层。在 390×900、200% 放大、离线且有陈旧授权条目时，滚动到最大后表格起点 y927、裁剪底 y884；390×480 同样失败。以实际命中/最后一行可达作为修复验收。`pnpm test:file`：37 浏览器、50 契约；`pnpm boundaries` 9 通过。`review-mutate.mjs` 四项归因检出（路由 scope、Done、Delivery 滚动、取消回滚）。发布扫描和空白通过，技术 714、文档 261 行。 `gh pr checks 611 -R SingularityKChen/harness-projects` 的当前 Fast Gate、Verify 与 Browser 成功。

## Progress

- [x] 2026-11-11 SGT：独立分层评审、验收反例与现有事项检索。
- [x] 2026-11-11 SGT：由评审账号一次提交 [REQUEST_CHANGES](https://github.com/SingularityKChen/harness-projects/pull/611#pullrequestreview-5851939385)。
- [x] 2026-11-11 SGT：独立复评修复及整合提交，核对实际 base、当前门禁、正式批准与全线程，结论见本记录最终收尾。

## Surprises & Discoveries

#507/#429/#528 为历史已关闭事项，未找到同一组合的开放修复项。#604 保留累计范围，#599 承接实装。保持单一局部查询、列宽和详情 owner。

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


## 作者修复证据（2026-11-11 SGT；已通过本记录最终独立复评）

首轮全文保留。修复从服务端自动重放 head `7aa347b7051b3df38c8a72ac1580fc77b42de539` 开始，实际 base 为 main `4320baac082fc89106ce8d533a7300a8053024c7`；首轮 review SHA 只作历史观察。

| 意见 | 根因与本地判别证据 |
|---|---|
| RXC / P1 | notice 兄弟节点增长后被隐藏祖先裁剪；正文现有容器承载 overflow，表格 XY/sticky 不改。390×900/480、200% 离线陈旧均先 RED；只滚实际 auto/scroll owner 后，尾部 redacted 行命中、最后可读链接命中及点击开详情 GREEN。 |
| RXK / P2 | begin 过早 freeze；drag 存下旧 setter。开始只存恢复快照，实际变化读取当前 onChange/bounds。无位移后自动铺宽、捕获中 title 当前最大640均先 RED 后 GREEN。 |
| RXQ / P2 | sticky 表头的 native focus 同时错误移动 Y，水平位置仍可被 sticky 标题遮挡。按原 DOM 顺序 preventScroll 转移并在同一 scroll owner 揭示，100/200%目标日期可见、命中且 local scrollTop 保持100。 |
| RXX / P2 | 旧包未公开已捕获宽度/状态。补有标签的精选历史 List/Delivery 1200/1024及当前长文/异常/200%拼图；[公开入口](../product/release-list-delivery-evidence/README.md) 保留每套准确身份与hash。 |

本地修复源 `0992a703029949f9a8aba66231bd37df5ee7e7d2` 的相关浏览器33/33、契约55/55、边界9/9与typecheck通过；末尾redacted行的额外断言单独1/1通过。用例及命令在原 ExecPlan Batch4，完整日志保留于本批 ignored 运行目录。中间两次浏览器32/33是新测试等待ResizeObserver不足，已改为等待真实table/client宽度及ARIA边界；这些失败未冒称通过。

作者证据不更改首轮 REQUEST_CHANGES，也不替代最新远端检查、协调者独立复评、实装 #599 或 R1。未 push、回复/resolve线程、合并或修改规划字段/依赖。

### 协调者整合与当前远端证据门

2026-11-11 SGT：用户原独立评审者的三份生产SHA与本候选逐字一致；复用其真实七行、正反Tab及100/200%复核结论，不重复派审。main4320上的fresh clean bundle已重算，见构建证据。最终推送后用 `gh pr view 611 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,reviewDecision,statusCheckRollup`、`gh pr checks 611 -R SingularityKChen/harness-projects` 与完整分页threads回读当前head；作者不resolve首轮线程，REQUEST_CHANGES仅由评审会话按稳定远端版本复评。

### 最终独立复评与授权收尾（2026-11-11 SGT）

修复源与公开证据在 `7722df51078d0f441fb97c8d259d2814a143cafa` / main `4320baac082fc89106ce8d533a7300a8053024c7` 完成独立复评并由评审账号正式 APPROVE；三份修复源码与原七行离线及正反 Tab 探针逐字一致。最终四项变异均按指定用例 KILLED，基线与还原后基线 GREEN；六张补充拼图及来源索引通过。该观察头的全部托管检查成功，四条作者回复及线程 resolve 已回读。

当前技术 gross 为780，原714及755预算仅属修复前观测。六个既有提交分别承载计划、呈现、验收、交互修复、尾行及公开证据、实际父层包体，没有 debug/fixup。此前“待协调者复评”的结论 Superseded by 本节；文档收尾不改产品/测试/图片。

人类本会话原任务明确要求修复、复评、归档、核对 issue 后 rebase merge，本轮直接续令为“继续评审流程”，覆盖 #611 → #615 → #612。合并只通过原生栈端点，指定预期 head 和 `merge_method=rebase`；每次最终 push 重读实际 base/head、全部 threads、正式批准、双向 issue 和 Fast Gate。合并结果以 `gh pr view 611 -R SingularityKChen/harness-projects --json state,mergeCommit,headRefOid` 及 #614 状态回读，不预写结果。#604 后层、#599 及 R1 保持各自范围。
