# 可复用工作树冲突契约 ExecPlan

> 状态：Completed；本地及独立验收完成，最终远端门禁按下述命令回读；创建：2026-10-29；规范：根 `PLANS.md`。
> 闭环：同仓 #200；分支 `fix/worktree-conflict-contract`；PR base 为 `main`。

## Purpose / Big Picture

Development Provider 的 `conflict` 必须能让 core 安全复用同一仓库、同一路径、同一分支的既有工作树。占用路径属于另一分支时返回不可重试的硬失败，不能被误报成供应成功。最小成功证据是共享契约先在当前 Fake 上因错误的 `conflict` 失败，修正后 Fake 与现有 Local Git 同时通过。

## Context and Orientation

2026-10-29 独立取证基线为 `main@bb9a7a259ab81ca89f01d03aa837555607a74fdd`。工作树为 `.worktrees/worktree-conflict-contract`；执行前回读 `git rev-parse HEAD origin/main` 与 `git status --short --branch`，不把基线记录当作当前远端状态。

`packages/providers/fake/src/development.ts/createWorktree` 目前只比较工作树引用里的路径，忽略分支；`tests/contract/suites/development.js` 只钉住同路径同分支重复创建。`packages/providers/development-local-git/src/provider.ts/createWorktree` 已拒绝路径对应别的分支，并在确实可复用时才返回 `conflict`。共享套件还有合法能力子集：能建不能读、能读不能建、不能建分支及省略可选方法；新增反例不能破坏这些形态。

事实：本缺口位于 Fake 与共享测试，不需要修改 core。约束：不增加端口、错误枚举或依赖。未知：新增测试是否需要专用预置第二分支；在同一套件装配里解决，不用被其它用例检出的分支掩盖路径碰撞。

## Design / Spec

采用“共享反例 + Fake 路径分支比较”。先在独立路径 P 创建分支 A 的工作树，再用已存在且未被检出的 B 请求 P，要求 `ok=false`、错误码不是 `conflict`、`retryable=false`，对象快照不变；读能力声明时读回 P 仍属于 A。同 P+A 的既有测试继续要求 `conflict`。Fake 用既有 `invalid_input` 表达 P+B，P+A 保留 `conflict`；记录的 repository 也必须经既有 `itemKey` 比较与请求相同，不能因同路径同名分支把另一已知仓库的工作树答成可复用。按原能力、仓库、故障、分支存在性顺序判定。

若 `branch.create` 可用，为本例创建专用 A/B；否则由现有装配显式预置两个不与其它用例共享的分支。`worktree.create` 未声明时仍走现有结构化拒绝及无副作用断言，不 skip 整个能力语义。不要强迫能建不能读的 adapter 调用读取方法。

两份独立设计均建议这条最小闭环，独立复核确认 Local Git 已实现目标语义。放弃新增 worktree identity 类型或细分碰撞错误：它会扩大端口与调用方，却不增加本 issue 所需判别力。也放弃只测缺失分支、被别处检出的分支或相同 HEAD：这些失败可能早于路径比较，不能证明 P+B 不可复用。已回读的 [Git 官方仓库 git-worktree 文档](https://github.com/git/git/blob/master/Documentation/git-worktree.adoc) 说明 add 对已检出分支和已分配路径的拒绝；原 git-scm 页面此次回读失败。这里的 `conflict` 可复用保证仍由仓库契约与 Local Git 实现确定，不能归因于 Git 官方错误分类。

## Global Constraints

本次评审收尾允许集追加：`docs/review/pr-442-mmp-review.md`。其余文件边界保持下文定义。

修改允许集只在此声明：`packages/providers/fake/src/development.ts`、`packages/capabilities/src/development-provider.ts`（仅契约注释）、`tests/contract/suites/development.js`、`tests/fixtures/development-suite-adapters.mjs`、`tests/contract/development-contract.test.js`、`tests/integration/development-local-git.test.js`、本计划、`docs/README.md` 索引行（整合 owner）。前六者为代码/测试全集；不需更改时不制造差异。目标 120–220 行新增+删除，严格小于 800；文档严格小于 1300。Local Git 产品实现、core、持久化、CI、依赖和原生关系不在修改面。

一批、一个 owner；无迁移、兼容层、数据清理或用户状态写入。遵守既有七条系统不变量，尤其工程事件不推进规划 Status。不开新公共接口，不改看板 Status、blocked-by、blocking；原「不自行合并」Superseded by Decision Log 的点名授权（2026-10-29）。真实人类 Demo #143/#236 与 R1 裁决独立保留。

## Plan of Work

### Batch 1 · 固定 conflict 的可复用含义

最小闭环是 P+A 可复用而 P+B 被拒，并且两个 adapter 使用同一个共享判据。主文件为 `createWorktree` 所在实现与共享 Development suite，完整允许集见 Global Constraints。

先加专用 A/B 反例与必要的装配预置，在修产品前执行下面的 focused 命令：Fake 必须 RED 在“不同分支不得返回 conflict”断言，不能 RED 于缺失分支或测试装配。再修 Fake 占用路径分支并在端口注释明确复用含义；GREEN 后审查相同路径同分支、不同分支拒绝无副作用、未声明能力及能建不能读子集。可复用既有 liar 矩阵给 mismatch→conflict 坏形态增加具名守卫，不新增框架。最后做一次原谓词回退的临时突变，要求新增反例变红；用 finally 恢复文件，不提交 mutant。重构只消除局部重复，不抽出新状态或扩大 Local Git。

所有命令在检出 `fix/worktree-conflict-contract` 的工作树根执行：

    pnpm test:file tests/contract/development-contract.test.js tests/integration/development-local-git.test.js
    pnpm verify
    pnpm run boundaries
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

focused GREEN 期望两个 adapter 与全部合法能力子集 exit 0；verify 的 typecheck、普通测试、MVP0 均 exit 0；边界、公开面、规模、空白检查均 exit 0。提交前另用当前 working diff 核查新增文件和五类公开面；提交后上述三点 diff 才覆盖最终提交。回滚点是本批独立提交，撤回即可恢复原语义；不删除任何实际工作树。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 同 P+A 明确可复用 | 原共享重复创建用例仍得到 conflict |
| P+B 不是复用 | A/B 均真实存在且 B 未被检出；硬失败、不可重试、对象前后相同 |
| 契约有判别力 | 原 Fake RED；修复 GREEN；临时回退路径谓词再次 RED，恢复后 GREEN |
| Local Git 保持正确 | focused 集成组通过，产品文件无 diff |
| 交付证据准确 | 本地 verify 与当前 PR hosted checks 分开记录，未宣称 Demo 或 R1 完成 |

## Progress

- [x] 2026-10-29 09:11 SGT：完成独立源码、issue 与两设计结论比较，选择最小契约闭环。
- [x] Batch 1：共享契约先 RED 于 Fake 把 P+B 与 P+A 都报为 `conflict`；修正后 focused 通过 172/172，临时恢复旧路径谓词时新反例再次 RED，恢复实现后 focused 再次通过。`pnpm verify` 通过 typecheck、2,454 项 contract/integration/e2e 与 7 项 MVP0；boundaries 9/9。
- [x] 2026-10-29 09:48 SGT：独立整份 PR 验收通过，P0–P3 无发现；身份等价新探针 1/1。归档与索引已整理；最终 push 后仍须回读当前 head/base/checks/threads，再置 ready。

## Surprises & Discoveries

2026-10-29：Local Git 已区分“登记路径但分支不同”和“登记且可复用”，无需产品改动；证据为其 `createWorktree` 的登记分支与 reuse 检查。共享套件复用 adapter 仓库，已有重复创建测试特意隔离路径与分支；新增反例必须沿用这一原则。

2026-10-29：Fake 的工作树引用只由 binding、对象类型和路径组成，所以原路径谓词会把不同分支、甚至同路径同分支但不同已知仓库都报成 `conflict`。共享 suite 用专属 A/B 与隔离路径证明 P+B；Fake-only 反例证明跨仓库身份也要硬失败。Local Git 的共享 suite 与三个能力子集均通过，未改 Local Git 产品实现。

## Decision Log

- 2026-10-29：本次用户指令明确点名 #441–#443，授权无 P0/P1 后由评审会话收尾、整理提交、核对 issue 并 rebase merge。本 PR 独立评审无 P0–P3 可行动发现，证据见 `docs/review/pr-442-mmp-review.md`。不包含规划 Status/依赖写入。

2026-10-29 / 独立计划评审者：采纳两设计共同的共享反例与 Fake 修复。Rationale：把 core 依赖的复用信号钉成共有契约，保留当前 Local Git 的正确实现；文件面见 Global Constraints。用户已授权继续设计与实施，例行选择不重复求批；无规划字段或原生依赖变更授权。

2026-10-29 / Batch 1 执行者：Fake 仅在现有工作树身份相同且 `itemKey(repository)`、分支名都匹配时返回 `conflict`；同一路径被其他仓库或分支占用返回不可重试 `invalid_input`。保持能力判定、仓库身份和分支存在性校验在路径冲突判定之前；未扩大接口或改动 Local Git。

## Idempotence and Recovery

测试只创建临时仓库与 Fake 对象，可重复运行。临时 mutant 前保存精确文件字节，finally 恢复并复跑 focused；失败日志保留运行态，不把预期红测记作验证通过。撤本批代码/测试/文档提交即可恢复基线，无数据库迁移、兼容或工作树清理义务。任何超出允许集或预算的发现先更新本计划，不能弱化反例。

## Interfaces and Dependencies

保留 `DevelopmentProvider.createWorktree`、`ProviderResult`、现有 error code 与 capability key。使用既有 Node、pnpm、Git 及测试 adapter，无凭据和外网写入。Git 操作由整合 owner 用 argv 并核对 realpath。最终提交后整合 owner 执行 `gh pr view -R SingularityKChen/harness-projects fix/worktree-conflict-contract --json headRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup`，期望 base=main、关联 #200、checks 属于最终 head；另读 review threads，验证后才 ready。

## Outcomes & Retrospective

实现与本地验证已完成：共享 P+A 重复创建仍返回 `conflict`；P+B 真实存在且未检出时硬失败、不可重试、对象快照不变，并在可读子集确认原工作树仍属 A；Fake-only 同路径同分支的跨已知仓库请求返回 `invalid_input` 且对象快照不变。TDD RED、GREEN 与旧谓词突变负控均有证据。Focused `pnpm test:file tests/contract/development-contract.test.js tests/integration/development-local-git.test.js` 172/172；`pnpm verify` typecheck 通过，contract/integration/e2e 2,454/2,454，MVP0 7/7；`pnpm run boundaries` 9/9；disclosure 与 size 通过计划提交范围的扫描，提交最终实现后需重跑以覆盖新提交。未改 Local Git 产品代码。不能把本地测试通过当作 hosted CI、人类产品验收或合并授权。

## Bottom Change Note

- 2026-10-29：首次形成单批完整计划；收敛不同分支碰撞、合法能力子集和判别性突变证据，限定 Fake 与共享契约修改面。

- 2026-10-29：完整独立设计复核后补齐契约注释/既有 liar 装配允许面，明确 Git 官方链接未成功回读，不冒称网络核验。

- 2026-10-29：补齐 Fake 多已知仓库的同路径同分支身份守卫及小型专属反例；记录成功回读的 Git 官方仓库原文，仍区分 Git 拒绝与 Provider 复用码。

- 2026-10-29：Batch 1 完成；以共享 A/B 反例限定 `conflict` 的可复用边界，Fake 在仓库和分支身份不匹配时硬失败；保留能力子集、Local Git 行为与现有接口。

- 2026-10-29 09:48 SGT：依据真实 RED/GREEN、回退突变、完整验证及独立全分支验收归档；保留最终 push 后远端门禁与人类评审边界。

- 2026-10-29：补充本次完整 MMP 交付评审、直接授权与最终门禁回读要求；计划保持 Completed。
