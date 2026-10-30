# PR #464 MMP 交付评审

- 日期：2026-10-30；状态：独立评审完成；无 P0/P1/P2，一项 P3；建议 APPROVE，由人类决定合并。
- Head：`949c903f9d8fca9dd902809858a92b55f2215e7e`；base：`main@b19b4eac4f12aa40c05d75b492f3335299874641`。
- 执行上下文：`.worktrees/github-pr-creation`；评审账号 `Singularity-AI-Bot`，作者侧 `SingularityKChen`。
- 系统目标：验证本 PR 的用户结果、状态所有权和失败恢复闭环；本地测试不替代产品/人类发布验收。
- 方法：Superpowers 独立子评审；Qian 系统接口/反馈综合；First Principles 从不变量及用户结果构造反例。

## 风险矩阵（先建后查）

| 等级 | 主要失效假设 | 检查层 | 结论 |
|---|---|---|---|
| P0 | 错误创建到其它 repository/base，违反显式路由 | 代码、产品闭环、架构、测试/反例、issue 验收与已有跟踪 | 未发现；精确仓库/ref 预检后使用同一 node id，身份失败零 mutation |
| P1 | ack 丢失重复创建、已有 PR 身份/状态错误 | 同上 | 未发现；一次 mutation、未知不可重试、完整 ack oracle、ReadOnly 黏性与并发测试具判别力 |
| P2 | 错误映射、验证或边缘状态反馈不完整 | 同上 | 未发现；显式拒绝/限流/partial payload 分层，失败无敏感正文；Core 恢复边界未冒充完成 |
| P3 | 文案、命名、可维护性 | 同上 | R464-D1：completed 计划第 3 行仍标 Active，当前状态未随归档同步 |

## 锁定事实与验收

- 关联 issue：#436。
- 最终 `gh pr view 464 --repo SingularityKChen/harness-projects --json headRefOid,baseRefName,baseRefOid,isDraft,mergeStateStatus,mergeable,reviewDecision,closingIssuesReferences,statusCheckRollup` 回读 head/base 未变、Ready、MERGEABLE、closing #436。PR Fast Gate、Merge Gate、Verify、CodeQL、Issue policy、size、disclosure 成功；取消的 Issue policy/Rule checks 均有同 head 后继成功。
- GraphQL 最终回读 reviewThreads(first:100) 为空且 hasNextPage=false，head 仍为上述锁定值。mergeStateStatus=UNSTABLE 来自可选 Create review session 失败；`gh api --allow-escape-sequences repos/SingularityKChen/harness-projects/actions/jobs/123867435440/logs` 原始日志显示 `endpoint responded: 404`，随后 exit 1。该检查不在必需门禁，现有 #364 已跟踪，不重复提报。
- 独立核对 279 条 all-state issue 快照：#436 的 adapter 创建/权限/marker 读面/故障矩阵/共享回归五项有对应实现和验证。#437 拥有耐久意图、actor、重启恢复与 UI Saved，#235 为父级产品验收，#451 拥有浏览器恢复验收；本 PR 不关闭这些范围。

## 分层证据与设计判断

完整审读 15 个新增 diff 文件。生产新增行为集中在 provider、两段独立 GraphQL 操作及纯 decoder；不新增公共 port、依赖、第二账本或跨层状态拥有者。Host 既有单次 POST 出口无自动重发。当前官方 schema 的 CreatePullRequestInput/Ref/PullRequest 字段与新增请求一致；五段原录制读查询未改，录制哈希/provenance 回归保留。新增严格合成平台明确区别于真实 API 录制，双 base 解决原共享测试的不合法同 head/base 与重复 OPEN pair，并保留既有 liar 判别断言。

创建入口一次读取 primitive 意图、冻结独立 ack oracle；每次最多一次 mutation。先完整解析预检形状再比较身份；await 后再次检查已知拒绝。ReadOnly 的 latch 只由新实例恢复未知，迟到 ack 仍如实返回已发送成功对象而不解除拒绝；这与旧 registry 快照和 Host cache 边界一致。data+errors 优先 ambiguous，丢 ack 后 get/list/reconcile 保留 body，第二候选/部分页不能代表唯一确认。

设计适度：易失权限证据与本地 intent 快照解决本 adapter 的问题；没有借本 PR 引入持久状态机、reset API 或 UI 设计。新实例恢复、无分支 CAS、marker 可被平台用户编辑和全量读取失败的限制均已明写，未发现需要以扩大范围方式修复的缺口。

本次独立执行（不是转述作者结果）：

| 命令 | 真实结果 |
|---|---|
| `node scripts/resolution-check.mjs && node --test tests/contract/development-github-create.test.js tests/contract/development-github-contract.test.js tests/contract/development-contract.test.js tests/e2e/repository-routing.test.js tests/integration/harness-plugin-host-github-catalog.test.js` | 204/204，0 fail/skip |
| `pnpm run typecheck`（pnpm 10.28.2） | exit 0 |
| `pnpm run boundaries`（pnpm 10.28.2） | 9/9，exit 0 |
| `node scripts/rule-checks.mjs disclosure b19b4eac4f12aa40c05d75b492f3335299874641` | 机械扫描通过；人工审读变更与提交未见五类发布面信息 |
| `node scripts/rule-checks.mjs size b19b4eac4f12aa40c05d75b492f3335299874641` | 代码/测试/config 590，文档 300；同时低于本批 800/1300 与仓库硬门 |
| `git diff --check b19b4eac4f12aa40c05d75b492f3335299874641...949c903f9d8fca9dd902809858a92b55f2215e7e` | exit 0 |

以上 pnpm 使用运行环境固定的 pnpm 10 wrapper，无安装或依赖改写；表中省略仅用于选择该 wrapper 的 PATH 前置项，本机路径不进入正式文档。按仓库 packageManager 指定的 pnpm 10.28.2 可重放相同命令。

按 `node scripts/review-mutate.mjs <spec.json>` 在最终锁定树运行一次整表；spec/log 仅留运行态，五项均带 killedBy，基线与恢复后基线通过，退出 0，字节还原后无产品文件差异：

| 变异 | killedBy | 结果 |
|---|---|---|
| M464-route：绕过预检 matches | 预检核对仓库 | KILLED |
| M464-ack-body：不比较 body | 任何不完整或错身份 ack | KILLED |
| M464-sticky：允许旧结果改写 ReadOnly | ReadOnly 黏住 | KILLED |
| M464-oracle：ack 重新读取 caller input | ack 只核对一次读取 | KILLED |
| M464-partial：错误分类忽略 partial payload | 写错误分类不泄漏正文 | KILLED |

本次未重跑完整 pnpm verify，未执行真实 GitHub mutation、安装 Host 或浏览器 UI。204 项局部证据、远端 checks 和作者的全量报告分开记录；不以本次 adapter 评审宣布 #235/#437、R1 或人类 UAT 通过。

## 评审与后续

R464-D1（P3，新增第 3 行）：`docs/exec-plan/completed/2026-10-30-github-pr-creation.md` 顶部仍称 Active、等待独立验收与最终远端交付，与第 299 行归档记录及当前 Ready 事实相矛盾。归档时只追加 Change Note，未同步当前状态摘要。更新顶部为 adapter 交付完成/等待人类合并，继续保留真实平台和 Core/UI 未验收边界即可。279 条 issue 快照未见本项的活动跟踪，历史 #363 不作为本条承接。

评审只写本文件和运行态 findings JSON，没有提交 review/评论、commit、push、merge，也没有改产品或测试。本会话人类已直接授权仅 P2/P3 时由评审协调者负责后续，R464-D1 由本评审会话机械修正。无 P0/P1，结论建议 APPROVE；本地结论不替代人类合并授权。

## Progress / Surprises & Discoveries

- [x] 先建立 P0–P3 矩阵，锁定 head/base/issue/checks/threads，再逐文件审查。
- [x] 完成五层审查、共享测试前提、schema、Host 出口和原录制回归核验。
- [x] 独立 focused 验证、五项具名变异、还原核对和最终远端读取。
- [x] 记录一项 P3 及责任边界；未发现新增架构或技术债务。

发现：强行保留原共享 suite 的同 head/base 和重复 OPEN pair 才会迫使真实 adapter fixture 造假；本 PR 用合法双 base 保留测试目的，属于必要的共享前提修正。

## Decision Log / Recovery / Outcomes

2026-10-30，独立评审决定：adapter 交付可独立验收，建议 APPROVE；P3 由本评审会话修正。外部持久意图与 UI 确认由 #437/#235 验收，当前无需扩大 adapter 责任。

复评触发：head/base 改动使本记录的代码结论失效，重新锁定并跑受影响验证。正式变异已按字节还原，原始代码/测试无差异；若撤回交付，revert 整个 adapter PR 只恢复只读能力，不删除远端 PR、分支或用户数据。未新建或批准技术债务。

2026-10-30 首轮正式 review `5709063165`：Singularity-AI-Bot 在锁定 head 一次性提交唯一 P3 并 APPROVE。协调者修正 completed 计划顶部状态并在 Decision Log 保存本会话原始授权；仅文档改动，代码与测试不变。修复的独立复评和最终发布门另行回读。

2026-10-30 修复独立复评：另一评审者只读核对两个文档，确认 R464-D1 已解决，无新增 P0/P1、无产品/测试变化、无发布面敏感信息；设计、实现和评审记录分别为可独立理解的提交边界。

2026-10-30 最终真实main整合：在源码head `05eda96cbfefdade5fbebe815519e744d32f0079`、base `main@a4dfe95cfae55b6091ad20b089061acd73575669` 上运行完整 `pnpm verify` 为2632/2632及MVP0 7/7；typecheck、disclosure、size（代码590/文档386）与diff-check通过。多次main前移均先backup再精确lease；最后只有docs索引上下文冲突，保留上游全部UI路径与本PR Completed条目。独立评审再次核对全部相关产品/test/fixture blob逐字相同，上游仅UI呈现，不影响adapter边界。此后本次更新仅记录证据文档；最终远端head/base/checks/threads/issue与merge结果按下列命令回读，不预写未来SHA。

    gh pr view 464 -R SingularityKChen/harness-projects --json state,headRefOid,baseRefName,baseRefOid,mergeCommit,statusCheckRollup,reviewDecision,closingIssuesReferences
    gh pr checks 464 -R SingularityKChen/harness-projects --required
    gh issue view 436 -R SingularityKChen/harness-projects --json state,body

期望当前head获得独立批准、Fast Gate和全部代码门成功、线程已解决、#436关联正确后，仅以rebase合并；issue关闭不改变规划Status，不代表#235/#437、UAT或R1完成。
