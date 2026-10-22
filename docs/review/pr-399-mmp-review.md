# PR #399 MMP 交付评审

## Purpose / Big Picture
评审目标：原生 Node 与层运行器都必须在外部工作区代码执行前拒绝解析越界。判定当前 PR 是否可独立验收、合并与回滚。

## Context and Orientation
2026-10-22 锁定：PR #399，issue #186，head `f85568ff340763e83171888f00d2ea48032be2af`，base `main@6aa6592d0070239f1957e504e2130baf84ff329e`；执行上下文为检出分支对应的 `.worktrees/worktree-module-isolation` 根目录。提交评审前重新回读 head/base、threads、checks。

## Design / Spec
先建立全级别风险矩阵，再分层验证代码、产品闭环、架构、测试与反例、issue 验收及重复追踪；测试绿不替代用户结果。每个 PR 全部意见以一份 review 提交。有 P0/P1 则 REQUEST_CHANGES；只有 P2/P3 或无问题则 APPROVE。

## Global Constraints
子评审只维护本记录；初审后的修复、发布与收尾由人类改派的协调者执行。评审身份 `Singularity-AI-Bot`（`gh-review`）；作者侧与合并使用 `SingularityKChen`（`gh` / git）。不改规划 Status 或阻塞关系。证据不包含本机绝对路径或敏感信息。

## Plan of Work
1. 锁定事实与风险矩阵。
2. 分层审查与最窄判别验证，检查已有追踪项。
3. 完成独立评审并交回协调者；远端一次性 review 与实现修复由各自 owner 承接。
回滚：只撤销本评审记录；若进入修复，按对应能力提交边界回滚。

## Validation and Acceptance
先验矩阵（2026-10-22，在逐文件检查前建立；各格是待验证风险，非已发现缺陷）：

| 层 | P0 硬约束 / 主线破坏 | P1 MMP 阻塞 | P2 非阻塞缺陷 | P3 可维护性 | 最小判别证据 |
|---|---|---|---|---|---|
| 代码 | 数据 / 执行边界被破坏 | 正常或失败路径丢事实 / 越界 | 有界边缘路径错误 | 错误定位与命名 | 当前 diff、针对性反例 |
| 产品闭环 | 权威事实被篡位 | 声称交付却无法完成用户任务 | 降级 / 提示不完整 | 文案与发现性 | issue 场景到真实入口 |
| 架构 | 七条不变量 / secret 边界被破坏 | 第二 writer、反向依赖或边界漏洞 | 契约边界表述缺口 | 局部耦合 | 调用链与 boundaries |
| 测试与反例 | 门禁可被伪造通过 | 关键路径无判别 / 外部代码先执行 | 少量边界缺测 | 测试组织 | 基线、失败路径、对照 |
| 工作项与交付 | 公开敏感信息 / 破坏性闭环 | issue 验收不成立却关闭 | 重复追踪 / 引用或规模问题 | 索引与证据简洁性 | issue、ExecPlan、相关追踪 |

初审结果（2026-10-22，输入 `f85568ff`；修复状态 Superseded by Outcomes & Retrospective 的协调者记录）：

| 层 | 结果 | 实际证据 |
|---|---|---|
| 代码 | P1：解析上下文剪枝造成外部代码假绿 | 根内 shadow 的精确 `exports` 指向 `.gitignore` 剪枝的 `dist/`，其 `dist/node_modules` 将 workspace 包指向外层检出；守卫返回空，原生 `node --test` 退出 0，外部 marker 已执行。定位 `scripts/resolution-check.mjs:59`。 |
| 产品闭环 | 主要入口闭环成立，但任意深度承诺不完整 | 未安装内层的文件 script、`--test` 文件、integration/e2e/mvp0 目录和 layer runner 均在外部 marker 前失败；合法安装对照执行内层 marker。上表的根内 shadow + `dist/` 反例仍越过拒绝门。 |
| 架构 / 信任边界 | 静态源码剪枝与运行时解析上下文边界混用 | 守卫复用 `ignoredDirectoryNames`，把构建产物目录从实际 node_modules 父目录发现中剪掉。静态源码扫描应剪枝；Node 实际导入的 workspace 包上下文不能据此剪枝。未涉及规划状态、Provider、凭据或产品层。 |
| 测试与反例 | 定向 53/53 通过；P1 反例暴露覆盖缺口 | 当前 Node 26.12.0 在此工作树运行 `node --test tests/contract/resolution-check.test.js tests/contract/run-test-layer.test.js` 为 53/53；单独合法 worktree `domain-enums` 为 6/6，实际 layer runner package-boundaries 为 9/9。反例脚本先运行真实受管测试，再建立根内 `tests/integration/node_modules` shadow；canonical package export 保持 `./index.js`，shadow export 为 `./dist/index.js`，preflight findings 为空且 external marker 为 true。差异核对显示 109 个既有测试文件仅增加两行 preflight；`resolution-check.test.js` 的两处删除只调整夹具模块类型与导出元数据，未删除既有断言。未运行变异，也未在本子评审中跑完整 `pnpm verify`。 |
| 工作项与交付 | #186 验收尚未完全成立；不新增重复 issue | #186 当前 OPEN，PR 以 `Closes #186` 关联；该 P1 直接属于 #186。TD-088/089 随本 PR 标为 Resolved，但 TD-088 的“任意深度解析边界”完成声明受此反例限制。#396 仅迁移静态 package-boundary 扫描到共享 walker；#350 的静态源码排除构建产物，均不覆盖该运行时缺口。 |

结论：一个 P1，建议 `REQUEST_CHANGES`。修复需让实际消费的 workspace shadow 在 `dist/` 等静态源码剪枝目录下的解析边界可被检查，或在不改变现有 issue 验收的前提下拒绝这类未覆盖的导出目标；补充同构 marker 反例后由原实现会话修复并独立复评。其余已覆盖路径没有新增发现。

## Progress
- [x] 2026-10-22 建立 P0–P3 先验风险矩阵并锁定初始 head/base。
- [x] 2026-10-22 完成代码、产品闭环、架构/信任边界、测试反例、issue 与重复追踪全矩阵；定向用例 53/53 通过，并复现一条 P1 假绿。
- [x] 2026-10-22 远端一次性 REQUEST_CHANGES，review `5611492593`，一条 P1；完整交回原实现会话。
- [x] 2026-10-22 原会话三次未执行后，人类直接指定本会话接手；隔离补丁已整合至原分支，产品源码 blob 与 proposal 相同。

## Surprises & Discoveries
守卫沿用静态源码扫描的 `dist/` 剪枝规则，遗漏被 shadow 包实际 export 到 `dist/` 的 node_modules 解析边界。这个形态不修改 canonical 产品包导出，仍可令已接线的原生测试执行外层 workspace 模块。PR checks 回读中 `PR Fast Gate`、验证、边界与运行层检查通过；`Create review session` 失败属于可选评审会话检查，不替代代码证据。

## Decision Log
- 2026-10-22 / 用户：要求使用 subagent；候选模型为 `gpt-6.1-sol`、`gpt-6-luna`。子评审使用宿主支持的 `gpt-6-luna` / `xhigh`。
- 2026-10-22 / 用户：P0/P1 有实现会话则完整交接后复评；无阻塞项的 PR 由本会话负责修复、复评、归档、整理提交、核对 issue 并 rebase merge。该授权覆盖 #399，最终仍须通过当前 head 门禁。
- 2026-10-22 / 独立子评审：`REQUEST_CHANGES`。复现的根因是静态源码 walker 的忽略目录集合被用于运行时解析上下文发现；真实 marker 证明被忽略目录下的 shadow 仍会执行外层 workspace 代码。按既有归属交回原实现会话修复，不新增 issue、不并行修改实现。

- 2026-10-22 / 人类直接答复：“本会话接手 #399（推荐）”。协调者接手修复、独立复评与门禁后的 rebase merge；取代上一条修复归属。实际 workspace 包复扫所有包内潜在解析上下文，静态 source-tree 保持原剪枝，node_modules 不展开第三方依赖树。

## Idempotence and Recovery
远端 head/base 变化后重锁事实；历史批准不自动转移。问题未复现不当作事实，无法验证则明确证据边界。评审前不创建重复 issue。

## Interfaces and Dependencies
`gh-review`、`gh`、Git、pnpm、Node；仓库评审标准见 `docs/review/mvp-review.md`。实现 owner 会话已由会话列表定位，问题交接前核对当前归属。

## Outcomes & Retrospective
初审 head `f85568ff340763e83171888f00d2ea48032be2af` 的独立结论为一条 P1、建议 `REQUEST_CHANGES`。定向 53/53、受管真实测试 6/6、实际 layer runner 9/9 均通过，但隔离临时反例使守卫返回空、测试 exit 0 且外层 marker 执行，因此测试绿不构成完整闭环。实际测试与校验在 Node 26.12.0 完成；Node 22 未实跑，不作为缺陷依据。PR 当前回读 `PR Fast Gate` 通过、可选 `Create review session` 失败；PR #399 的 reviews、inline review comments、conversation comments 与 review threads 均为 0。issue #186 保持 OPEN，已有范围说明 comment。此子评审没有向 GitHub 写入；修复后须重锁新 head/base、checks 和 threads 并独立复评。

上述是初审历史结论，Superseded by 本段修复及后续新 head 回读（2026-10-22）：初审已提交 REQUEST_CHANGES，后由人类改派协调者。proposal `a882c84d` 基于原 `f85568ff`，三种 marker 反例覆盖根入口 dist、精确 build 子路径和 src→dist 传递导入；旧遍历红 3/3，修复后绿 3/3，外指不执行 marker，本地同形控制执行内层 marker。子实现者定向 56/56、真实 pack 后 verify 1914 + 7 全绿；这不是新 main 上的协调者验证，也不是新 SHA 独立批准。

协调者整合到 `main@8b742977` 后重新核对 110 个首 import 和 109 个非 owner 正文；仅 README 冲突按短索引集合保留。最终发布前在本分支执行 `pnpm --filter @harness-projects/app-harness-plugin pack:plugin`、`node scripts/resolution-check.mjs`、`pnpm verify`，再用带 killedBy 的变异证明忽略目录回归可杀死，原字节恢复后整理提交。新 head 独立复评、CI 和全部 threads 成立后才作者回复并 rebase merge；结果由 `gh pr view 399 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefOid,mergeCommit,reviews,closingIssuesReferences` 与 `gh pr checks 399 -R SingularityKChen/harness-projects` 回读，不复用初审的绿或批准。

2026-10-22 / 协调者在真实 `main@8b742977` 的整合检出验证：真实 plugin pack 后守卫成功，`pnpm verify` 为 1927 + 7、零失败；110 个首 import 与 109 个非 owner 正文并集保持。Active 1 / Completed 104，README 18,933 字节、集合和相对链接有效。使用 `review-mutate.mjs` 将包内复扫的 true 改回 false，M399-1 由三条“已消费 shadow”失败名归因 KILLED；原字节哈希相同、还原后基线通过。该表只在最终产品源码上运行一次，之后仅整理文档和提交，不改产品源码。

## Bottom Change Note
2026-10-22：在逐文件审查前建立风险矩阵与当前 immutable 输入，作为独立子评审入口。
2026-10-22：补齐全矩阵和 Node 26.12.0 定向实测；根内 shadow 在源码剪枝目录 `dist/` 中仍能把模块解析到外层，形成 P1 假绿证据，按既有 #186 跟踪并交回原实现会话。

2026-10-22：协调者按人类改派整合 P1 修复并对真实 main 变基，补记包内扫描边界、提交整理、独立复评与发布回读规则。
