# E1 历史记录校验退役 ExecPlan

> 状态：Completed（工程退役）；创建：2026-11-07；Issue：#572。
> 执行上下文：检出 `test/e1-record-retirement-20261107` 的工作树根目录；上游为 `PLANS.md` 与 `docs/development/workflow.md`。

## Purpose / Big Picture
退役已完成 E1 实验的持续散文校验，减少 938 行测试维护；现有 Provider 行为与包边界仍可执行。

## Context and Orientation
基线为 `main@50abd7d7`；只读观察中历史校验 9/9 通过，它仅解析仓库内文档，不调用生产函数。
Gate E1 的人类 freeze 裁决与实验记录继续保留；它们与当前软件行为证据是不同对象。

## Design / Spec
删除整份历史解析器。放弃继续维护自定义 Markdown 元模型，也不新造检查其删除的测试。
独有损失：实验节、标识符台账、字段计数、时间、Superseded 标签与索引的持续机器一致性校验；行为测试不等价替代这些性质。

## Global Constraints
MMP 收尾追加本 PR 的 `docs/review/pr-576-mmp-review.md` 作为证据，保留原实现文件边界。
文件集合：`tests/contract/e1-evidence-consistency.test.js`、`docs/architecture/gate-e1-sandbox.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`、本计划与 `docs/README.md`。
不改生产、fixture、freeze、Status、依赖关系或其他分支；不新增测试；代码总变更不超过 1000 行。

## Plan of Work
### Batch 1 · 退役并保留当前行为证据
先提交本计划并创建关联 issue 的 draft PR，再删除校验器、更新当前口径与命令、验证并发布结果。
主文件为历史校验器；完成后将本计划归档。回滚为 revert 本批退役提交。
验证：`pnpm install --frozen-lockfile`；`pnpm test:file tests/contract/planning-contract.test.js tests/contract/planning-github-projects-contract.test.js tests/contract/planning-github-projects-mapping.test.js tests/integration/github-projects-bootstrap.test.js tests/contract/package-boundaries.test.js tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js`，期望全部通过且无跳过。

## Validation and Acceptance
上述现存测试必须通过；`git diff --check` 无输出；当前文档不再要求执行被删路径。
发布前运行 `node scripts/rule-checks.mjs disclosure origin/main` 与 `node scripts/rule-checks.mjs size origin/main`，期望无命中且规模通过；同时核对 PR 实际 base。
最终回读 `gh pr view -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences,statusCheckRollup`，独立审读及最终验证通过后才 ready。

## Progress
- [x] 2026-11-07：只读定位与授权，建立 issue #572。
- [x] 2026-11-07：初始文档提交与 draft PR #576 已建立并回读，关联 issue #572。
- [x] 2026-11-07：删除专用历史校验并更新当前文档口径与命令。
- [x] 2026-11-07：安装成功；上述现存测试 110/110、无跳过，差异空白检查通过，208 个本地文档链接可解析。**Superseded by 本计划下文 MMP 复评订正（2026-11-07）**：归档后的最终树含三处失效回链，原检查结论不能覆盖最终树。
- [x] 2026-11-07：独立审读未发现 P0–P3 问题；实现 head 的托管检查通过。归档后按最终 head 回读，只有验证通过才 ready，不合并。

## Surprises & Discoveries
MMP 评审在最终树发现 active 架构计划三处 Superseded 回链仍指向 active 目录；统一改为 `../completed/2026-11-07-e1-record-retirement.md`。最终链接检查与独立复评见 `docs/review/pr-576-mmp-review.md`。
938 行历史校验没有任何生产模块 import；9 个测试保护的是历史文档格式与相互引用，删除它不代表原有历史事实被重新验证。

## Decision Log
2026-11-07 / MMP 收尾授权：人类在本会话直接要求对 PR #571、#576–#579 完整评审；无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 并以 rebase 合并。本条覆盖本 PR 先前“不合并/保持 draft”的执行限制；不授权 Planning Status 或依赖关系写入。
2026-11-07 / 本会话人类直接授权：对 PR #571、#576–#579，无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 并使用 rebase 合并；本 PR 唯一 P2 为归档回链修复。授权不包含 Planning Status 或依赖关系。
2026-11-07 / 人类伙伴经协调者授权：整块退役，只更新当前说明与活跃命令；保留历史证据与 freeze，实现先保持 draft 交独立审读；通过后才 ready，不合并。

## Idempotence and Recovery
安装与只读验证可重复；新增 issue/PR 先回读再复用。验证失败时保留 diff 定位；回滚仅撤销本批退役提交。

## Interfaces and Dependencies
依赖 Node、pnpm、Git 与已认证 gh；GitHub 写入 actor 为当前认证账号，目标为同仓 issue #572 / PR #576，以 issue 与分支名作为复用键；不写看板字段或关系。

## Outcomes & Retrospective
本地退役完成：删除 938 行解析器，保留的行为与边界检查 110/110 通过；这是离线回归，既不重新验证历史实验，也不表示产品或发布门接受。独立审读已在 `db69f3e0` 上完成，无可行动问题；该实现 head 的 CI、Browser、Merge Gate、CodeQL、发布面与规模检查均通过。归档只改文档，最终远端状态用本节回读命令重新确认。
技术债：历史文档不再有该专用校验器；这是本次明确接受的边界，不产生替代测试任务。

## Bottom Change Note
2026-11-07：建立单批次计划，写明独有损失、验证与恢复边界。
2026-11-07：draft #576 建立后执行退役，历史约束加生命周期标注，当前验收命令不再调用被删路径。
2026-11-07：记录本地 110 项既有验证与链接检查，工程结果和独立接受保持分离。

2026-11-07：根据独立审读与实现 head 托管结果归档；最终发布前重新回读，不将历史实验或本地回归声称为产品接受。

2026-11-07：依据 PR #576 的 MMP P2 修复三处归档回链，就地订正历史链接检查声明；复评证据保存在本 PR 评审记录。

2026-11-07：记录本会话对该 PR 的直接条件合并授权、风险矩阵与独立复评入口；当前 head/checks 以发布后回读为准。
