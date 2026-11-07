# 测试执行与进度轨道精简 ExecPlan

> 状态：Completed（工程精简）；Issue：#573；创建：2026-11-07；检出：`chore/test-execution-20261107`（`.worktrees/test-execution-20261107`），调查基线 `50abd7d7`；交付前同步文档更新 `c1975c20`。

## Purpose / Big Picture
每个候选只执行一遍当前三层 Node 行为验证，退役已完成的七节点进度轨道与重复 advisory workflow。保留真实行为、空层拒绝、Browser、PR Fast Gate 与人类发布裁决。

## Context and Orientation
CI 的 `pnpm test` 已执行 contract/integration/e2e，Merge Gate 又单独执行后三者的重叠面。PR #571 的 run 42349349301 与 42349349299 均 checkout `1aba632c1b8d55e7cc2a9657e7ef408197f2624a`；因此旧文档“判定对象不同”的解释被运行日志否定。四条独立执行 lane 各自重复安装，三条重复既有测试，唯一额外为 MVP-0 进度测试。

## Design / Spec
让 `package.json` 的 test 命令通过现有 `run-test-layer.mjs` 顺序执行 contract、integration、e2e；每层缺文件、零执行、全 skip/todo 或失败都非零。保留工作区解析预检与 120 秒单用例超时，固定 spec reporter，计数与执行复用同一份 `*.test.js` 文件清单，避免依赖 Node 各版本的 reporter 默认值和目录参数发现行为。verify 只组合 typecheck/test。CI 保留 Verify、Browser 与不 checkout/不读 secret 的聚合 job，去除 PR base 过滤以接住原 advisory 服务的非 main PR。

退役 `tests/mvp0`、Merge Gate workflow 及其 393 行 YAML 镜像测试；不再保留独立 advisory 检查名、固定七节点刻度、缺导出自定义进度诊断及其源码计数守卫。MVP-0 所测行为保留在 provider-binding-registration、chain-bootstrap、write-machine、start-work、delivery-lineage、status-policy 现有文件中，组合基线 160/160 通过。包边界仍在 contract 层，层运行器的真实行为测试保留。

拒绝只删 CI 内 integration/e2e：那会让必需检查失去原有范围。拒绝把已完成进度测试搬到 fixture 或另加一个工作流。R1 第 4/5 条保持目标 head 上连续两次成功、人类判定与 integration/e2e 各自非空全绿，只统一为 CI 的实际执行证据。分层顺序执行简化日志与失败归属，可能增加单个 job 尾部延迟；本批量化取消重复执行，不宣称未经测量的提速。

## Global Constraints
MMP 收尾追加 `docs/review/pr-577-mmp-review.md`、两个测试层 README 与 `docs/product/core-release-scope.md`，只同步现行 CI 口径，保留发布条件。
只改 `package.json`、`.github/workflows/ci.yml`、`.github/workflows/merge-gate.yml`、`.github/workflows/board-invariants.yml`（过期注释）、`scripts/run-test-layer.mjs`、`tests/mvp0/`、`tests/contract/merge-gate-workflow.test.js`、`tests/contract/run-test-layer.test.js`、`tests/contract/resolution-check.test.js`、`tests/README.md`、`docs/development/ci.md`、`docs/architecture/release-gates.md`、`docs/product/vertical-path.md`、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`（Batch 7入口退役注）、本计划与 `docs/README.md`。不改生产行为、分支保护、Status、secret 或其他检出；不增测试。代码增删≤1000、文档≤1500行。

## Plan of Work
先建 issue、计划 draft PR 并回读；再按设计删除多余载体、统一命令、修订当前规则。命令均在本计划检出根执行：`pnpm install --frozen-lockfile`；`pnpm test:file tests/contract/run-test-layer.test.js tests/contract/resolution-check.test.js tests/contract/ci-browser-workflow.test.js tests/contract/workflow-check.test.js`；`pnpm verify`；`node scripts/workflow-check.mjs`；`node scripts/rule-checks.mjs disclosure c1975c20`；`node scripts/rule-checks.mjs size c1975c20`；`git diff --check c1975c20...HEAD`。均期望退出0。实际 hosted CI 挂在本 PR 最终 head 后回读，确认单一执行工作流与必需门禁。回滚为 revert 本 PR。

## Validation and Acceptance
只判定当前三层行为与 Browser 继续执行且失败可传播；重复 workflow/进度载体退役；R1 人类权属和发布约束保留。沿用上一节命令，不添加镜像测试或逐项验收矩阵。

## Progress
- [x] （2026-11-07 SGT）完成运行日志与存活行为映射，建立隔离检出及 issue #573。
- [x] （2026-11-07 SGT）完成实现与现有验证；独立审读发现的问题均已修正，组合源码已复核。最终 head 的 hosted 检查仍由 PR API 回读，不自判发布接受。

## Surprises & Discoveries
MMP 评审发现两个测试层入口与 Core 发布范围仍引用已退役的 Merge Gate；统一指向 CI / PR Fast Gate，并保持目标 head 连续两次成功与人类拥有权。
独立审读发现删除目录存在性台账时误删仍被 CLI fixture 使用的 REPO_ROOT；恢复共享常量后，原有108个层/解析/工作流用例通过，没有新增测试。旧 workflow 文档声称不同判定对象，但实际 checkout 的提交完全相同。MVP-0 的节点4仅用非法 id 检查状态枚举，其余节点已有更细粒度的当前行为证据。

## Decision Log
2026-11-07 / MMP 收尾授权：人类在本会话直接要求对 PR #571、#576–#579 完整评审；无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 并以 rebase 合并。本条覆盖本 PR 先前“不合并/保持 draft”的执行限制；不授权 Planning Status 或依赖关系写入。
2026-11-07 / 用户授权继续深入优化及删减冗余测试/验收；主 agent 选择整体退役重复执行路径。R1 现有判据保留，只修正证据入口；不把 CI 绿解释为人类接受。GitHub actor为当前维护者，目标origin，幂等键issue #573 / 分支名。

## Idempotence and Recovery
初始文档提交是恢复锚点，验证可重跑；日志仅在 `.superpowers/test-execution-20261107/`。无数据迁移；revert恢复原布局。

## Interfaces and Dependencies
沿用 Node、pnpm、node:test、既有层运行器与 W1–W7；无新依赖。公开检查的唯一必需名称仍为 PR Fast Gate。

## Outcomes & Retrospective
本分支 Node26 的 `pnpm verify` 通过：contract1432、integration2025、e2e240，共3697，无跳过。后续共享文件清单/显式reporter修改用原有层运行器13例在 Node22.23.4 通过；不宣称整个仓库已在Node22验证。此前4文件窄验证108/108；W1–W7检查当前7份workflow无finding。

最终runner在临时组合检出 `test/code-simplification-integration-20261107`（base50abd7d7，含本PR及#571/#576/#578/#579全部非Markdown修改）再次实际执行 `pnpm verify`：1382+2025+226=3633通过，无跳过；41条owner文件逐文件回读一致。Browser58/58已通过，其13个源码文件及执行清单未变，故不重复同一验证。组合补丁SHA256为 `db3ee11a4acf97300de1fdb8fd981ab44c491da99bc779bc7dc502d50e29a3a4`。这是本地组合证据，不是各PR hosted CI，也不是安装态或R1接受。

独立审读发现目录常量误删、Node22输入/reporter差异及旧活跃命令，已通过保留真实cwd、统一文件清单、显式reporter与生命周期说明修正；P3命名范围说明也已收口。取消四个重复执行job及一个聚合job、退役已完成进度载体，没有新增测试。无新增未接受技术债；原advisory名称与进度诊断不再属于维护承诺。新main仅合入验收文档，最终更新基线后检查源补丁等价，保留本次验证的原始执行上下文。

## Bottom Change Note
2026-11-07：依据同提交重复执行日志与已有行为证据建立有界退役计划。

2026-11-07：保留仍有真实调用的测试运行目录常量，修正 CI base 过滤旧说明，现有窄验证108/108通过。

2026-11-07：Node22真实控制验证揭示目录参数行为差异；统一文件清单与显式reporter，无版本分支或新增测试。

2026-11-07：独立审读与真实Node22/Node26控制验证完成，归档单批闭环；记录组合结果与docs-only基线同步，最终checks由远端回读。

2026-11-07：按 MMP P3 同步三个当前入口的 CI 口径，修复独立复评见 `docs/review/pr-577-mmp-review.md`。

2026-11-07：记录本会话直接条件授权及独立修复复评，保持目标 head 两次 CI 与人类 R1 接受独立。
