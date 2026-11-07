# 代码与验证负担精简 ExecPlan

> 状态：Completed（工程精简）；创建：2026-11-07；Issue：#570；Refs #224、#419、#336。

## Purpose / Big Picture

降低同一规则的重复实现和维护成本：诊断失败只吸收一次，Storage 契约只保留真实行为，已完成探针不再要求日常 CI 解析历史报告。成功证据是相关现有行为验证通过、明确的删除清单和净删减，无新增测试体系。

## Context and Orientation

基线为 `main@45330b54`，执行检出为 `chore/code-simplification-20261107`（`.worktrees/code-simplification-20261107`）。2026-11-07 对 `git ls-files -z` 返回的普通文本逐文件按 `splitlines()` 统计，忽略软链接和二进制：packages/apps 20,936 行、tests 50,155 行、docs 82,871 行；含空行、注释和配置，不是可执行代码数。其中 ExecPlan 56,385 行、review 18,343 行。最近 100 次提交按 `git log HEAD~100..HEAD --format= --numstat` 分类，生产目录净增 5,791 行、tests 净增 17,100 行、docs 净增 25,150 行。

事实：Storage 入口复制测试断言源码，手工账本校验测试数量；会话探针测试只解析报告、预注册与录制夹具；Core 与 scheduler 有两份异常吸收器。偏好：用户明确要求复用、简洁、少特例，并删除无价值测试和冗长验收。未知：这些内容是否有独有的当前行为责任；每项删除先核对调用方和保留证据。

## Design / Spec

采用现有实现复用与有证据的退役。诊断内部函数接受可选 diagnostics 宿主，scheduler 委托它，保持 getter、this、同步异常和 thenable 吸收语义。Storage 保留 adapter 装配与所有独有的读写/拒绝/事务/重启行为，删除源码多重集和历史计数；重复引用隔离用例已被同文件更完整的字段过滤、引用隔离与重启用例包含。会话探针的历史文档一致性校验退出常规测试；录制 fixture/replay 与正式 Host ABI/执行契约继续保留。明确接受不再持续机器锁定历史报告格式、预注册时点、录制夹具白名单/脱敏卫生、会话谱系与证据绑定；Storage 也移除装配遗漏、标签重复及仓库格漏注册的独立防删守卫，这是删减的真实边界。

拒绝按行数机械拆分 Start Work：持久意图、代际、撤权和不确定回执是当前需要的失败路径。暂不为约 50 行 GitHub 分类器复制新增跨包协议层；依赖/边界成本超过本批收益。UI 时间与异步副作用差异具有真实语义，不用模式开关强行统一。

## Global Constraints
MMP 收尾追加批次记录 `docs/review/2026-11-07-pr571-pr579-mmp-review.md`、`docs/project-management/merge-queue.md`、评审索引和本 PR 的 `docs/review/pr-571-mmp-review.md` 作为证据，保留原实现文件边界。

只改 `packages/core/src/diagnostics.ts`、`packages/core/src/planning-reconcile.ts`、`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage.js`、`tests/contract/suites/storage-execution.js`、`tests/contract/suites/storage-identity-membership.js`（仅过期注释）、`tests/contract/harness-session-api-record.test.js`、`docs/architecture/harness-session-api.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、本计划和 `docs/README.md`。遵守七条系统不变量；不改公共 API、数据库、权限、Provider 确认与恢复规则；不改已有历史计划/评审记录或其他 worktree。代码变更含删除不超过 1000 行，文档不超过 1500 行。

## Plan of Work

### Batch 1 · 单一实现与冗余验证退役

先建 issue 与只含本计划的 draft PR；审计 leader 修改两个 Core 文件，测试审计 owner 修改 Storage 套件并退役历史探针测试，主 agent 简化当前文档的验收口径。每个 owner 只写自己的范围。所有下述命令在本计划指定分支的工作树根目录运行。

验证使用 `pnpm typecheck`、`pnpm test:file tests/contract/storage-contract.test.js tests/contract/harness-execution-contract.test.js tests/contract/host-session-adapter.test.js tests/integration/harness-plugin-host-execution.test.js tests/integration/planning-refresh-scheduler.test.js tests/integration/sync-revision-freshness.test.js`，预期退出 0。比较 Storage 前后用例名，仅减少四条 meta-test 和两条重复 adapter 用例。源码/fixture 未更改，无需新增镜像测试或全产品人工验收。独立审读后再整理提交。回滚为还原本 PR，不触碰用户数据库。

发布检查：`node scripts/rule-checks.mjs disclosure main`、`node scripts/rule-checks.mjs size main`、`git diff --check main...HEAD`，预期退出 0。PR 当前 head 的 checks、base、issue 与 threads 回读通过后再 ready；不合并。

## Validation and Acceptance

只验三项：相关现有行为通过；删除清单明确保留证据和放弃的历史校验；diff 符合范围与发布规则。命令只写在上一节，不扩展成逐函数、逐断言或跨主题产品验收矩阵。

## Progress

- [x] （2026-11-07 SGT）更新干净 main，建立隔离检出与 issue #570，完成三领域并行审计。
- [x] （2026-11-07 SGT）Batch 1 实现、独立审读、变基后最窄验证与可审阅交付；PR #571 的实时检查以 API 回读为准。

## Surprises & Discoveries

总量的主要来源是测试和过程文档，不能把总行数等同产品代码。Storage 的单段源码账本超过 20KB，却不调用 Storage；历史探针测试 705 行，内部另写 Markdown parser 和判定模型，没有执行生产函数。它们为证据文档建立了第二份规则源。

## Decision Log
2026-11-07 / MMP 收尾授权：人类在本会话直接要求对 PR #571、#576–#579 完整评审；无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 并以 rebase 合并。本条覆盖本 PR 先前“不合并/保持 draft”的执行限制；不授权 Planning Status 或依赖关系写入。

2026-11-07 / 用户：明确授权优化、删减无价值测试/验收并以 leader 带队。主 agent 决定沿用既有行为证据、不为删元测试再写元测试。此请求支持本计划内可逆实现；不改规划 Status 或依赖关系。

2026-11-07 / 主 agent：#570 作为本次有界闭环，Refs 已有跟进 issue；旧 issue 的其余验收不在本次声称完成。公开写入 actor 为当前已认证维护者，目标 GitHub origin，幂等标识为 issue #570 / 分支名；结果通过 issue/PR API 回读。

## Idempotence and Recovery

现有验证可重跑，临时结果放 `.superpowers/code-simplification-20261107/`。初始计划提交提供实现前恢复点；回滚时用明确路径恢复或 revert 本 PR，保留其他检出。无迁移或外部产品写入。

## Interfaces and Dependencies

使用当前 Node、pnpm、TypeScript、node:test 与 gh；无新增依赖。Core helper 为包内部实现。录制会话夹具仍由现有运行契约消费。GitHub 新建 issue/PR 前检查同名目标以避免重复，不改看板字段。

## Outcomes & Retrospective

2026-11-07，在检出 `chore/code-simplification-20261107`、已变基到 `50abd7d7` 的实现提交 `21e06981` 上，Batch 1 的现有行为命令加 `tests/contract/content-placement.test.js`、`tests/contract/board-status-semantics.test.js` 共 303/303 通过，0 fail/skip/cancel；`pnpm typecheck`、disclosure、size 和 diff whitespace 检查均退出 0。这是本地工程证据，不是安装态或 R1 接受。

代码变更 +19/−876，共 895 行，净删 857 行；其中测试净删 849 行、84,037 字节，没有新增测试。Storage 用例 162→156，多重集差异恰为四条元测试和两条重复用例；正式 Host 三组 60 个现有用例保留。历史探针的 31 个报告一致性用例退役，独有校验损失见 Design / Spec。验收模板改成最少可观察结果，包内验证从默认全量改成相关现有用例。

审计判断：重复账本、证据解析器与持续叠加的过程记录形成主要维护负担；生产实现也存在复制，但 Start Work 的持久身份、代际、撤权和不确定结果路径不能按体积删除。独立审读无 P0/P1，发现的三处文档现在时误述已修正并回读确认。无新增技术债；暂不扩展的候选属于调查建议，GitHub 分类器漂移已有 TD-061。

初始 draft PR #571 的 base/head/draft 与 #570 关联已回读。并行 main 推进后已建立 `refs/backup/code-simplification-20261107-before-rebase`，变基的两条提交经 `git range-diff` 确认补丁不变。最终远端 head、checks、issue 与 threads 以 `gh pr view 571 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,closingIssuesReferences,statusCheckRollup` 和 PR reviewThreads API 回读为准；仅验证通过才 ready，不合并。

## Bottom Change Note

2026-11-07：根据当前检出、规模统计和 agent 取证建立计划，将本批验收收敛为最少有效证据。

2026-11-07：独立审读后补全退役校验的独有损失，并记录 Core 窄验证与并行 main 推进。

2026-11-07：完成本批删减与现有行为验证，修正独立审读发现的历史探针持续校验误述。

2026-11-07：记录变基后 303 条现有验证、净删减和独立审读结论，归档工程闭环；远端状态保留可回读方式。

2026-11-07：记录本会话对该 PR 的直接条件合并授权、风险矩阵与独立复评入口；当前 head/checks 以发布后回读为准。
