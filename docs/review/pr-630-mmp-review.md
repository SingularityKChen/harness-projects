# PR #630 MMP 交付评审

## 锁定事实

2026-11-13 首轮：base `main @ 5708e1edca2ea032f02b35c411ee76e29a31ad1c`；head `f14bfecdfa4970f4741d1f31a2dc8d23e6471f5d`；检出 `test/behavioral-policy-contracts`，工作树 `.worktrees/behavioral-policy-contracts`。评审账号 `Singularity-AI-Bot`；开发账号 `SingularityKChen`。

目标闭环：用行为证据替代文案快照。现有实现会话“梳理迭代紧急重要 Issue”负责三个原分支；P0/P1 交该会话修复，非阻塞收尾由本评审会话承担。用户已在本会话授权无 P0/P1 时逐 PR 修复、复评与 rebase 合并。

## 风险矩阵（逐文件审查前建立）

| 级别 | 候选风险 | 检查与判定门 |
|---|---|---|
| P0 | 破坏 main、泄露凭据或违反规划事实源硬边界 | 发布面、依赖方向、规划/执行轴及写入控制路径 |
| P1 | 规划状态守卫、文档边界、突变测试归因与恢复 导致严重错误或证据不成立 | 代码/失败路径、产品闭环、反例、最窄判别验证、issue 验收 |
| P2 | 有限覆盖缺口、维护成本或已有 issue 重复追踪 | 测试分层、设计成本、重复逻辑与开放 issue |
| P3 | 文档、链接、命名与措辞不准确 | ExecPlan、描述、证据命令和回滚路径 |

覆盖层：代码、产品闭环、架构边界、测试/反例、issue/ExecPlan 验收、设计充分性与复杂度；以下结论只对上列 immutable base/head 有效。

| 层 | 实际检查与反例 | 判定 |
|---|---|---|
| P0／发布面与不变量 | 完整五文件 diff、两个 commit message、PR body 和标签；无生产包、依赖、CI 或真实 Project 状态变更；disclosure 与人工五类目检查 | 未发现 P0；未引入第二 Planning 权威、凭据或本机路径 |
| P1／代码与失败路径 | 新 `hasPathToken` 仅做转义后的路径 token 检查；坏后缀与坏 workflow 路径均红；writer 解析字段时仍验证稳定 ID、project、名称、类型、选项 | 未发现 P1；无新增 parser 或生产行为 |
| P1／产品闭环与所有权 | `engineering-project.test.js` 经唯一 writer `main` 注入 fetch，记录实际 mutation 的 field ID 和写后世界；Status 伪装、错目标 mutation 均被杀死；workflow 禁止开启、误关、unknown/missing 仍 fail closed | 文案精简未移除实际跨轴写入守卫；不据此声称通用 agent 批准已机械化 |
| P2／测试与反例 | 六文件 97/97；五个负变异准确归因，普通措辞＋软换行＋合法 fragment 正控制继续绿；去除全 docs 散文推断与历史白名单，保留路由／桶／任务唯一性／引用目标检查 | 未发现新增覆盖回退；保留结构化路径扫描符合 #419 要求 |
| P2／工作项与过度设计 | 回读 #419 剩余 scope、#224 父项标题及相关开放 issue；代码增删 258、文档 115；没有 Storage 台账、固定变异配额、兼容层或冗余新矩阵 | 闭环独立可回滚；无新增重复 issue 需要创建 |
| P3／文档与证据 | 实现计划已完成归档、`docs/README.md` 链接存在；content-placement §7 如实说明散文由人审；PR 两个提交、Closes #419、标签符合交付范围 | P3-1：计划规模沿用无时点历史值；已改为最终 size 回读规则，最终远端另行重锁 |

## Purpose / Big Picture

核验 #419 剩余文案测试精简闭环：普通改写不要求复制规则，真实 writer／workflow 边界和权威路径仍可判别。

## Context and Orientation

核心文件为 `tests/contract/{board-status-semantics,content-placement}.test.js`，实现计划为 `docs/exec-plan/completed/2026-11-13-behavioral-policy-contracts.md`。先读预建矩阵，再读完整 diff、实际 writer、workflow 检查器与 issue；两个提交及 PR 描述未越界。

## Design / Spec

采用 Superpowers 独立审读、qian 系统边界和 first-principles 不变量核验。保留路径／路由／桶／任务唯一性；散文语义由人审，执行权限由已有行为测试承担。未引入 parser、第二规则镜像或兼容层。

## Global Constraints

首轮子评审仅写本记录；临时变异用 `scripts/review-mutate.mjs` 自动逐字节恢复。主审仅补交付文档，不修改本 PR 的生产代码或测试。Planning Status 和原生关系归规划所有者。

## Plan of Work

### Batch 1 · 固定 head 全矩阵审查

在检出 `test/behavioral-policy-contracts` 的工作树根目录实际执行：

    pnpm test:file tests/contract/content-placement.test.js tests/contract/board-status-semantics.test.js tests/contract/board-workflow.test.js tests/contract/check-board-workflows-live.test.js tests/contract/engineering-state.test.js tests/contract/engineering-project.test.js

结果 97 passed、0 failed/skipped。负变异与正控制在同一最终源树整批执行 `node scripts/review-mutate.mjs <临时spec>`；逐项归因和恢复后基线如下。spec 使用同一六文件 argv 命令及继承环境。

| 变异／控制 | 唯一锚点变化 | killedBy | 结果 |
|---|---|---|---|
| README 坏后缀 | 目标路径加 `-missing` | Status 文档引用现存的权威语义定义 | KILLED |
| workflow 坏路径 | 权威路径加 `-missing` | 同上 | KILLED |
| Status 字段伪装 | `field.name !== FIELD_NAME` 拒绝分支改为 `false` | Engineering 字段契约任一不匹配都拒绝写入 | KILLED |
| writer 错写字段 | `writeEngineeringState` 的目标覆盖为 `PVTF_status` | A running、B 被取消、C 幸存 | KILLED |
| workflow 忽略启停偏离 | `found.enabled !== rule.enabled` 改为 `false` | 不变量 3：该关的工作流开着，必须被报出来 | KILLED |
| 合法正控制 | Status 同义改写、软换行、引用加 `#planning` | Status 文档引用现存的权威语义定义 | SURVIVED，97 项全绿，符合预期 |

整批出口 1 来自有意保留的正控制 SURVIVED；不将其误报为负变异失败。全部源文件已恢复，`git diff --stat` 空。

### Batch 2 · 当前远端与交付文档

回读命令以 `-R SingularityKChen/harness-projects` 为目标：`gh pr view 630 --json headRefOid,baseRefName,mergeable,mergeStateStatus,isDraft,closingIssuesReferences,statusCheckRollup`、`gh pr checks 630`；REST reviews/comments 和 GraphQL reviewThreads 均为空。首轮 head 未漂移、MERGEABLE、非 draft；Fast Gate、Verify、Browser、CodeQL、规则检查和 Engineering reconcile 均成功。唯一红项 `Create review session` 的 run 43393150262 失败日志为 HTTP 404，由 #364 跟踪；已实查 main 保护只必需 Fast Gate。

`node scripts/rule-checks.mjs disclosure <base>`、`size <base>` 与 `git diff --check <base>...HEAD` 首轮均退出 0（base 见锁定事实）；最终文档提交后重跑并重新读取 head/base/checks/threads。实现计划已归档，本记录随完整交付提交。

## Validation and Acceptance

#419 的剩余 outcome 已逐项核对，Storage 台账已由 #571 交付，本次没有恢复它。实际 mutation 目标、Status 字段伪装、workflow fail-closed 均有行为反例；不是只扫描实现源码。主审在基于相同 base、产品／测试文件逐字节等于三个首轮 head 的组合检出上另行运行 `pnpm verify`：1578 contract + 2252 integration + 226 e2e = 4056 passed，0 failed/skipped；此结果仅证明运行组合，不替代本矩阵的产品闭环判断。

## Progress

- [x] 2026-11-13：先建矩阵，完整差异、issue、远端与写入路径审查完成。
- [x] 2026-11-13：97 项定向、五负一正变异及恢复核对完成；无 P0/P1/P2。
- [x] 2026-11-13：主审文档复核发现 P3-1，以评审账号在原 head 一次性 APPROVE（review 5888404380）并提交 inline；规模规则已修正，进入最终窄复评。
- [ ] 最终 head 的 GitHub 门禁回读、评审账号批准和条件 rebase 合并。

## Surprises & Discoveries

本轮可选 webhook 的真实原因是 HTTP 404，由 #364 跟踪。普通文案正控制存活符合 #419 的目标，不能按负变异解释退出码。

## Decision Log

- 2026-11-13 / 独立子评审：散文扫描移除符合 #419；已有 writer／workflow 行为守卫仍有判别力，未发现需要修复的新问题。
- 2026-11-13 / 人类本会话直接指令：无 P0/P1 或只有 P2/P3 时“你负责后续”并“`merge_method=rebase` 合并”；据此由本评审会话收尾 #630。批准不包含 Planning Status 或原生关系变更。

## Idempotence and Recovery

验证可重复，注入 fetch 不写真实 Project；变异夹具按字节恢复。生产与测试源码无后续修改，整个 PR 可 revert。发布整理前保留原 head backup ref，使用精确 old-head lease，发生并行变更时拒绝覆盖并重锁证据。

## Interfaces and Dependencies

使用现有 Node/pnpm、冻结依赖、仓库变异夹具。审查／批准账号为 `gh-review`，开发与合并为 `gh`；checks 和 review 为两道独立门。

## Outcomes & Retrospective

首轮无 P0/P1/P2；一项 P3-1 为计划的文档行数陈述未标明中间时点。当前已改为最终 V3 回读规则，修复不影响源码/测试，结论 APPROVE。局限：窄路径 token 检查不解析全部 Markdown、fragment 或散文语义；writer 反例不证明任意带凭据 agent 的行为，人类批准记录机械化仍属 #67；active ExecPlan 路径扩围属 #182。不含安装 UAT 或 R1 人类接受。

## Bottom Change Note

2026-11-13：完成固定 head 的全矩阵与反证；主审精简交付记录、补充组合实跑证据及直接条件授权，保留最终远端门禁。

2026-11-13：独立窄复评确认源码/测试对原 head 完全相同；发现并修复 P3-1，保留原评审与修复证据。
