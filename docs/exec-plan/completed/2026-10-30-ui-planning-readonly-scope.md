# 规划只读提示范围 ExecPlan

> 状态：Completed；创建：2026-10-30；关联：Closes #475
> 规范：根 `AGENTS.md`、`PLANS.md`

## Purpose / Big Picture

只读 Planning 用户看到准确的规划内容说明，仍能使用独立 Development 能力允许的 Start Work。最小成功证据是在同一真实 read 输入下，列表不再宣称开始工作不可用，详情仍按仓库四门允许或拒绝动作。

## Context and Orientation

2026-10-30 +08 在 `main @ b19b4eac4f12aa40c05d75b492f3335299874641` 的源码复现：`deriveWorkItemListView` 的 readOnly 只来自 planning.item.read=read_only；`deriveWorkItemDetailView` 则从所选仓库四个 Development key 决定 Start Work。行为正确，但 renderer 说“只读：规划来源只允许读取，此处不提供编辑或开始工作入口。”，错误扩大了 Planning 范围。

## Design / Spec

选择最小准确文案：“只读：规划来源仅允许读取，此处展示规划内容。”。保留规划只读说明，不推测工程能力。拒绝隐藏 Start Work：它会把正交领域错误耦合；拒绝删掉全部提示：它会丢失规划编辑边界信息。无需新增组件、状态或运行时依赖。

## Global Constraints

本轮审查收尾补充 `docs/review/pr-477-mmp-review.md`；评审证据随本能力闭环交付。

唯一文件集合和 owner：本任务修改 `packages/ui/src/work-item-list.ts`、`tests/contract/ui-work-item-list.test.js`，新增 `tests/contract/ui-planning-read-only-scope.test.js`；正式文档为本计划、`docs/product/ui-workspace-frame.md` 的规划范围说明及协调者最后收敛的 `docs/README.md` 索引行。只改说明和真实组合测试，不改 capability 计算、StartWorkSection、Host、provider、共享视觉模块；与本轮 #448/#434 文件集 disjoint。

代码/测试增删严格小于800，目标35–130；文档小于1300、目标80–120。三分支独立 main，不以别的 PR 截图或代码作为合并前提。#450/#451/#472 的唯一生产 browser carrier、#449 人类 UAT、R1 不在本次验收。

## Plan of Work

### Batch 1 · 真实组合反例与最小修复

先提交本计划，协调者在产品代码前创建关联 #475 的 docs-only draft PR，回读 head/base/draft/issue。主文件为列表 renderer 与新增组合测试。使用真实 `createEntityStore`、同一 input、真实列表/详情投影及 React SSR，先写红测试，再改固定文案。

组合至少覆盖：Planning read_only + 仓库四门 available，列表说明限定规划、详情 target 存在且available=true；Planning read_only + 缺 create 门，available=false；Planning available + 缺 Development 门，available=false；Planning capability unavailable 与缺失/未知时，列表/详情不可读且无 target；redacted canary 不可见。按 `aria-label` 定位 Start Work 区域后检查实际按钮，不锁定无关属性、属性顺序或标题 wrapper。恢复旧文案应令测试失败；错误地用 Planning read_only 禁止 Start Work 也必须失败，纯 className no-op 必须通过。

在检出 `fix/ui-planning-readonly-scope` 的工作树根执行：

    pnpm test:file tests/contract/ui-work-item-list.test.js tests/contract/ui-planning-read-only-scope.test.js tests/contract/ui-start-work.test.js tests/contract/ui-work-item-detail-view.test.js
    pnpm typecheck

期望全部 pass，且红基线有明确命名失败。既有 fixture 320px、200%缩放检查普通文字可换行、无新 tab stop；无需新浏览器 lane。回滚完整小修提交，无外部写入或迁移。

### Batch 2 · 当前提交交付

同一分支根执行 `node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`，期望零失败；按五类人工扫描公开面。整理同批提交后更新既有 draft，final push 回读当前 head/base/checks/Closes #475/threads，通过才 ready，禁止自行合并。完成时归档计划，索引由协调者串行更新。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| 准确范围且保持合法开始工作 | 同一 store/input 的 read_only+四门可用正控；旧误导文案负控 |
| 没有顺带放权 | 缺写门、Planning不可读、redacted 组合反例 |
| 无新交互负担 | 320px/200%文字正常换行，无新control/tab stop |
| 独立小修可审阅 | 最终增删、定向/typecheck、公开面、当前 PR 回读 |

## Progress

- [x] (2026-10-30 +08) 两份独立设计与第三位审稿确认文案根因及最小修复。
- [x] (2026-10-30 +08) Batch 1：先新增真实组合测试，RED 命中旧提示；替换固定文案后，列表、详情、Development 四门与 redacted 组合均通过。
- [x] (2026-10-30 +08) 独立审阅 P2/P3 修订：Start Work SSR 断言按语义区域定位且允许额外属性/wrapper；补 Planning available 缺 Development 门和缺失 Planning 读门组合；本计划文案及覆盖说明与实际测试收敛。no-op className 探针通过结果与完整验证见任务报告。PR、push、README 索引由协调者串行处理。

## Surprises & Discoveries

这是错误的用户声明，现有能力判断没有错误。不能通过隐藏合法动作来消除列表与详情矛盾。新测试因此同时保护文案准确性和跨域组合行为。

## Decision Log

2026-10-30 +08 / 用户在本评审会话指定 PR #476–#478、#480；无P0/P1或只有P2/P3时，明确要求由评审会话负责「三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → `merge_method=rebase` 合并」。本PR首轮无可行动问题，完成独立复评与当前head门禁后按该条件授权收尾。该授权取代此前本计划在未授权时的禁止自行合并；不批准规划Status、native dependency或R1。

2026-10-30 +08 / 独立 spec/plan 审稿：选择短文案加双向组合负控，不新建全局权限解释框架。owner/预算唯一声明见 Global Constraints；没有规划 Status 或依赖写入授权。

## Idempotence and Recovery

测试可重复；无数据/外部状态写入。失败保留证据后在本分支修复，回滚本 PR 即可，不删除用户数据或改他人工作树。

## Interfaces and Dependencies

分支 `fix/ui-planning-readonly-scope`、工作树 `.worktrees/ui-planning-readonly-scope`，独立基于 main。沿用当前 store、ui-model、React renderer。回读 `gh pr list -R SingularityKChen/harness-projects --head fix/ui-planning-readonly-scope --json number,headRefOid,baseRefName,isDraft,statusCheckRollup,closingIssuesReferences` 后，对唯一 PR 回读 review threads。

## Outcomes & Retrospective

实现只替换 Planning read-only 提示并新增真实 store/list/detail/React SSR 组合契约；现有 Start Work 能力判断未改。已观察红基线、旧文案与错误耦合负控失败、纯 className no-op 通过和恢复后绿验证。Parent 提供 320px 视口、28px 字体（200%）观察：说明高 99px、宽 288px、documentWidth 320px，无新增 tab stop；这是本地浏览器观察，不是 Host 验收。没有新增接受延期的债务；PR 当前 head/base、托管 checks、review threads 与人类验收由协调者回读。本次不关闭父 UI epic、#449 或 R1。

## Bottom Change Note

2026-10-30 +08：第三位审稿根据同一输入的真实反例，固定短文案、组合测试与独立 #475 交付边界。

2026-10-30 +08：协调者归档独立验收结果，补产品范围说明与文档索引；最终远端门禁保留命令回读，未改规划Status。

2026-10-30 +08：补全本轮MMP风险矩阵、独立审查与条件合并授权；实现和既有产品验收范围不扩张。
