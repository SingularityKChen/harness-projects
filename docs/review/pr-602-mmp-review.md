# PR #602 MMP 交付评审

观察日期：2026-11-10（Asia/Singapore）。base `main@b8aa03af7e493ea4bb6c1748e70c31ea7815071b`；head `54c340f0bffd63dd3755022d8a09c4c99aad8b51`，分支 `feature/native-issue-hierarchy`。独立评审在该分支的 `.worktrees/native-hierarchy` 执行；本结论只适用于这一对 immutable revisions。

## 风险矩阵（先于逐文件审查）

| 级别 | 代码与反例 | 产品闭环 | 架构与事实源 | 测试与验收门 |
|---|---|---|---|---|
| P0 | 主分支不可用、存量事实损坏 | 合并即无法交付 | 凭据泄漏、Planning 权威被覆盖 | 硬门禁被绕过 |
| P1 | 隔离/事务失效、重复执行、跨权限读取 | 用户无法完成声明的关键任务或假成功 | Host/Provider 权限、持久化或依赖边破坏 | 核心失败/恢复无有效证据，issue 闭环不成立 |
| P2 | 局部可恢复缺陷或独有反例遗漏 | 有绕行的次要体验缺陷 | 局部契约/维护成本 | 范围有限的证据或文档缺口 |
| P3 | 命名和可读性 | 文案小瑕疵 | 可选简化 | 链接与措辞精度 |

分层：完整 diff、调用链、失败路径、反例、设计适度、issue/重复跟踪、当前 checks 与全部 threads。代码测试通过不等于安装验证、人工 UAT 或 R1 接受。

## 证据与结论

结论：完整 diff、调用链、反例与五层矩阵审查完成，未发现新的 P0/P1/P2/P3 问题；建议在最终远端回读仍对应本 head/base、批准门禁满足时接受此工程叶。评审未提交 GitHub review、修改 issue、提交代码或执行合并。

| 层 | 核对结果 |
|---|---|
| 代码 | parent 单项零或一条且不可翻页；children 单独有界分页。每页验证 project/membership/Issue/repository/direction，坏来源、重复游标、错误目标与超时不能产生虚假 complete。 |
| 产品 | 详情分别显示父、子、阻塞此项、被此项阻塞；来源仓库、同号目标、关闭状态与安全链接不混淆。完整空、partial、unavailable 与拒读/未确认有不同文案；父项与子项使用独立状态。 |
| 架构 | 延伸既有 Provider → Core → Controller/Host → strict client → detail 链，无新 Host 操作、持久化、graph 或 Provider 直连 UI。查看不写本地业务关系、成员关系、ExecutionContext 或 Planning 状态。 |
| 权限与恢复 | authority/source receipt、提交围栏与请求序号保留；账号关联 ID 加入来源戳。账号记录不可读时关联变化仍撤销旧结果。Host assembly 退休、UI selection/access token 切换及真实拒读均不能复活旧标题/URL。 |
| 测试与工作项 | 相关 39 条生产 Provider/Core/Host/browser 用例及 9 条边界测试独立重跑通过。唯一关闭目标是 #594；#543 的原始安装态与人类接受继续开放。 |

### 逐文件与反例覆盖

- 审读全部 13 个变更文件，并追踪未改动的 Host handler/assembly fence、Controller local-only result、client 接线、ui-model source/access token 与 native permission receipt。
- Provider 的 parent query 不含分页变量，`null` 只有完整 source proof 且无 GraphQL errors 才成为可见空集；children 用 `subIssues(first, after)`。DTO 不采集 hidden count、body、author 或原始诊断。
- Core 在 parent 的基数或 cursor 不合法时拒绝完成；三个 connection 各至多十页，整次请求共享十秒 deadline。普通后页故障保留已验证 partial；总 deadline 无法完成最终 source 复核时，四流统一清空为 partial，符合该 PR 明示的保守边界。
- strict client 同时要求四流，拒绝多父项、denied 中携带目标、非法 canonical URL、未知字段、错误作用域与不可能日期。UI 用 React text 渲染标题，并提供 `noopener noreferrer` 链接；不把层级装成业务阻塞关系。
- 生产 Chromium 用例实际通过 Host remote 与 production client/detail，检查同号跨仓、关闭的 Project 外目标、键盘焦点/安全链接、partial、empty、offline、denial/recovery、selection、Host 重建及零业务写入。既有原生 PR 链接回归同时通过。
- 未发现需要另开缺陷 issue 的代码反例。#150 仍承担较广关系编辑/环检测范围；本 PR 只读层级不扩大该范围。协调方另核对 #598 已撤回为重复项，#594 是唯一实现 owner；#543 顶部旧 child 编号属于既存跟踪文案，由协调方核对。

### 本轮独立验证

所有命令均在本记录开头指定检出执行。

| 命令 | 实际结果 |
|---|---|
| `pnpm test:file tests/contract/planning-issue-dependencies.test.js tests/integration/issue-dependencies-scope.test.js tests/browser/issue-dependencies.test.js tests/browser/native-link-detail.test.js` | 39/39，退出码 0 |
| `pnpm run boundaries` | 9/9，退出码 0 |
| `node scripts/rule-checks.mjs disclosure b8aa03af7e493ea4bb6c1748e70c31ea7815071b` | 退出码 0；同时人工审读五类发布信息，无新增命中 |
| `node scripts/rule-checks.mjs size b8aa03af7e493ea4bb6c1748e70c31ea7815071b` | 退出码 0；候选代码/测试 188 行，文档 107 行（本评审记录尚未计入） |
| `git diff --check b8aa03af7e493ea4bb6c1748e70c31ea7815071b...HEAD` | 退出码 0 |

未把作者报告的全仓 3851 条或组合 3959 条当作本轮重跑；本轮没有重复全仓 verify。固定远端快照在本 head 显示 Fast Gate、Verify、Browser、CodeQL、size、disclosure success，线程与旧 review/comment 为空；可选 Create review session 失败与 #364 对应，不替代批准门禁。最终提交前远端状态须由协调方重新回读。

### 最终树变异表

使用 `scripts/review-mutate.mjs`，统一执行上述 39 条命令。各项均有 `killedBy`，最终整表退出码 0；脚本前后基线通过且逐字节还原，随后 `git status --short --branch` 只有本评审记录未跟踪，生产/测试文件无差异。

| 变异 | killedBy（实际失败用例名片段） | 最终结果 |
|---|---|---|
| H1：parent null 当作坏目标 | `parent uses singular nullable source proof` | KILLED |
| H2：Core 允许多父项 | `invalid parent plural` | KILLED |
| H3：Core 移除 parent 禁止翻页门 | `source, malformed pages, cursor loops and later failures cannot claim empty complete` | KILLED |
| H4：来源戳移除 account association ID | `held hierarchy is fenced after account` | KILLED |
| H5：strict client 允许多父项 | `strict hierarchy wire requires both streams` | KILLED |
| H6：父区错误消费 children | `production hierarchy detail distinguishes source targets` | KILLED |

H3 首次归因误填单独的 parent cursor 例，脚本诚实给出 `KILLED_OTHER`：移除早期门仍会在后续游标循环检查中成为 partial，但产生多余请求，实际由总调用上界断言捕获。最终表使用实际失败用例重新归因、整表重跑，没有把首次结果算成 KILLED。

### 接受范围与剩余门

#594 四项 AC 的工程证据在本 head 成立，实际勾选与 issue 收尾交回 owner。该结论不证明已安装插件具有本实现，也不代表真实 GitHub 数据/凭据下的四方向人工验收；#543、R1 及人类合并授权仍是独立门。此 PR 通过可逆的 source observation 扩展形成独立工程闭环；回滚不涉及 schema 或业务事实迁移。

## 主控收尾与当前版本门

2026-11-10，本会话用 `gh-review`（Singularity-AI-Bot）在初始不可变 head 提交完整 APPROVE，无 inline findings；开发和合并使用 `gh` / git（SingularityKChen）。未发现待修复代码项，收尾仅登记证据、归档决策与整理提交。实现会话「筛选紧急重要 Issue」已结束；本会话依据用户对 #600–#602 的直接条件授权接管无阻塞分支。

用户原话：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”

每个原始 head 保存在 `refs/backup/pr602-before-mmp-review-20261110`。公开提交收敛为一个交付闭环，保留原实现与测试，review 文档随该 PR 合入。初始三分支完整前序已在仓库外临时 clone 按 #600 → #601 → #602 重放，未出现冲突；该顺序不建立 Planning 依赖。每次前序合入后，以真实 main 接合下一条，相关验证与当前托管 CI 重新判定。

最终门：`gh pr view 602 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,statusCheckRollup`、当前全量 review threads 与双向 issue 关联；期望 main、Ready、当前 head 独立批准、无未处理线程、PR Fast Gate 和执行 lane 通过。先比对产品/测试 blob、publication/size 和提交，再使用精确旧远端 head lease。合并必须指定 expected head 与 `merge_method=rebase`，并回读 state、mergeCommit、issue state 及合入 tree。Create review session 的 HTTP 404 由 #364 跟踪；取消的重复 Rule checks 只在同 head 后继通过时豁免。

外部写入：actor 分别为上述两个账号；目标为 GitHub repository `SingularityKChen/harness-projects` 的本 PR 与其关闭工作项；幂等键 `mmp-review-pr602-20261110`（已存在相同结果时不重复写）。工程验收勾选保留当前 issue 文本和原有跟踪字段，不改变 Project Status、原生依赖或父项接受。最终提交审查与托管结果以当前 head 回读为准，不继承初始批准。

## 实际 main 接合与产品证据

接合 main `62bac076`（已含 #600/#601）；仅 `docs/review/README.md` 的并列索引插入冲突，四条本批索引全部保留。当前产品/测试组合逐 blob 等于初始完整三分支前序预演，生产实现未因收尾改变。主控另核对现有 complete/partial 组件截图：四方向名称、来源限定编号、关闭状态和可访问链接可见；partial 明示仅为本次已验证记录。截图来自生产组合浏览器夹具，不能替代 #543 的安装态/人类验收。最终接合检出重新运行相关 39 例并独立复评后，才进入当前 head 托管门。

上述实际 main 接合检出 `97bd0595` 已由独立评审者复核：原命令四文件（含 `native-link-detail.test.js`）39/39、fail/skipped/todo 为 0，所有新增相对链接存在，diff-check 通过，无 P0–P3。只追加本条事实后，非文档 blob 与该检出保持一致；最终托管与批准仍按当前 head 回读。
