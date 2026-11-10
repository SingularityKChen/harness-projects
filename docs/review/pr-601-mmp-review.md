# PR #601 MMP 交付评审

观察日期：2026-11-10（Asia/Singapore）。初始 base `main@b8aa03af7e493ea4bb6c1748e70c31ea7815071b`；head `77e6a06cbdae827fb60411ac8ea54af3945c5f54`，分支 `test/durable-start-work`。本文件为该 immutable head 的独立评审证据。

## 风险矩阵（先于逐文件审查）

| 级别 | 代码与反例 | 产品闭环 | 架构与事实源 | 测试与验收门 |
|---|---|---|---|---|
| P0 | 主分支不可用、存量事实损坏 | 合并即无法交付 | 凭据泄漏、Planning 权威被覆盖 | 硬门禁被绕过 |
| P1 | 隔离/事务失效、重复执行、跨权限读取 | 用户无法完成声明的关键任务或假成功 | Host/Provider 权限、持久化或依赖边破坏 | 核心失败/恢复无有效证据，issue 闭环不成立 |
| P2 | 局部可恢复缺陷或独有反例遗漏 | 有绕行的次要体验缺陷 | 局部契约/维护成本 | 范围有限的证据或文档缺口 |
| P3 | 命名和可读性 | 文案小瑕疵 | 可选简化 | 链接与措辞精度 |

分层：完整 diff、调用链、失败路径、反例、设计适度、issue/重复跟踪、当前 checks 与全部 threads。代码测试通过不等于安装验证、人工 UAT 或 R1 接受。

## 证据与结论

独立审查完整五文件 diff、Core 的 claim/provision/settle/replay 路径、Local Git fixture、SQLite 文件装配与合成 Execution 实现；固定 JSON 的 review threads 为空且分页已完整。此次不执行外部 review、issue 写入或合并；远端最终 head/base/checks 由协调者在提交 review 前回读。

| 级别 | 最终结论与依据 |
|---|---|
| P0 | 无发现。仅新增测试和文档，没有生产 schema、权限、规划状态、凭据或发布门禁变更。 |
| P1 | 无发现。真实 Git 分支、工作树集合/内容与 SQLite context/run/worktree 全集均被独立断言；失败没有执行调用，fallback 引用含原绑定；冷启动在重放命令之前读回完整持久事实，随后没有第二次执行。 |
| P2 | 无发现。四项 #141 原行为逐项覆盖；新键在既有 Ready/run 上如实 conflict，符合既有 task-handoff 契约。可选的中断后基线前进情景未声称覆盖；#304/#554 未被关闭或降格。 |
| P3 | 无需提交意见。release-gates 对安装恢复的简写不定义 #304 全部范围；ExecPlan 明确保留旧 owner fencing、丢失句柄和 installed recovery，README 仍保留 native prerequisite。 |

判别性验证（本 worktree、上述 head，2026-11-10）：

- `pnpm test:file tests/integration/start-work-local-git-sqlite.test.js tests/integration/start-work-task-handoff.test.js`：9/9，fail 0、skip 0。
- `node --test tests/integration`：2175 tests / 8 suites，pass 2175、fail 0、cancelled 0、skip 0；新增四例计入该摘要。
- 最终树仅一次整表执行 `scripts/review-mutate.mjs`，命令为 `node --test tests/integration/start-work-local-git-sqlite.test.js`；每项指定 `killedBy`，脚本 exit 0，基线与自动还原后基线均绿。下表均为归因命中的 KILLED，并非编译失败或 KILLED_OTHER。

| 变异 | 退化 | killedBy（用例名片段） | 结果 |
|---|---|---|---|
| M601-1 | 关库后改开新空文件 | 关闭并重开同一文件 | KILLED |
| M601-2 | 每次外部 startRun 调两次 | 主执行确定失败 | KILLED |
| M601-3 | 用分支 ack 生成 has_worktree | 工作树创建确定失败 | KILLED |
| M601-4 | 不解析 fallback 绑定 | 主执行确定失败 | KILLED |

变异由脚本按原文字节还原；另以 `git diff --exit-code -- packages/core/src/start-work.ts tests/integration/start-work-local-git-sqlite.test.js` 确认无残留（exit 0），复核 HEAD 仍为本文件顶部的 head。没有修改生产代码、共享夹具或测试最终内容。

#141 的原工程测试叶形成可独立验收/回滚闭环，建议 APPROVE，无 inline findings。该结论只证明受控 Core＋真实 Git＋文件 SQLite 组合中的补偿、引用持久化和命令重放；fallback 仍是离线替身，不证明真实人工执行签发者、模型或宿主会话的可读状态。未执行安装验证、原事故数据库修复或人工 UAT；#304、#554 和 R1 的人类接受保持各自责任。

## 主控收尾与当前版本门

2026-11-10，本会话用 `gh-review`（Singularity-AI-Bot）在初始不可变 head 提交完整 APPROVE，无 inline findings；开发和合并使用 `gh` / git（SingularityKChen）。未发现待修复代码项，收尾仅登记证据、归档决策与整理提交。实现会话「筛选紧急重要 Issue」已结束；本会话依据用户对 #600–#602 的直接条件授权接管无阻塞分支。

用户原话：“如果没有且无 P0 / P1，或只有 P2/P3 → 你负责后续：三思后修复 → re-review → 归档 ExecPlan → 按 Conventional Commits 与可独立理解、回滚、审阅的交付边界整合为适量的 commit → 核对并处理对应 issue → merge_method=rebase 合并。”

每个原始 head 保存在 `refs/backup/pr601-before-mmp-review-20261110`。公开提交收敛为一个交付闭环，保留原实现与测试，review 文档随该 PR 合入。初始三分支完整前序已在仓库外临时 clone 按 #600 → #601 → #602 重放，未出现冲突；该顺序不建立 Planning 依赖。每次前序合入后，以真实 main 接合下一条，相关验证与当前托管 CI 重新判定。

最终门：`gh pr view 601 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,mergeable,mergeStateStatus,reviewDecision,closingIssuesReferences,statusCheckRollup`、当前全量 review threads 与双向 issue 关联；期望 main、Ready、当前 head 独立批准、无未处理线程、PR Fast Gate 和执行 lane 通过。先比对产品/测试 blob、publication/size 和提交，再使用精确旧远端 head lease。合并必须指定 expected head 与 `merge_method=rebase`，并回读 state、mergeCommit、issue state 及合入 tree。Create review session 的 HTTP 404 由 #364 跟踪；取消的重复 Rule checks 只在同 head 后继通过时豁免。

外部写入：actor 分别为上述两个账号；目标为 GitHub repository `SingularityKChen/harness-projects` 的本 PR 与其关闭工作项；幂等键 `mmp-review-pr601-20261110`（已存在相同结果时不重复写）。工程验收勾选保留当前 issue 文本和原有跟踪字段，不改变 Project Status、原生依赖或父项接受。最终提交审查与托管结果以当前 head 回读为准，不继承初始批准。
