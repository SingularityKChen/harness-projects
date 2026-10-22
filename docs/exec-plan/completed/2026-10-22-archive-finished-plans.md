# 历史计划归档与短索引 ExecPlan

> 状态：Completed
> 创建：2026-10-22
> 范围：issue #363；归档十三份已结束计划、转交真实遗留、修复引用与索引，仅订正当前 Gate E1 状态入口。
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`、`docs/development/content-placement.md`。

## Purpose / Big Picture

读者打开 active 目录与文档索引时，只看到仍开放的工作；历史计划完整保留，可从一行短索引进入。归档表示该执行计划已结束，不表示所有历史风险和未兑现验收都已通过。

成功证据是十三份候选完成证据核对后位于 completed、旧路径零引用、Active 表与真实目录集合一致、索引小于 20000 字节且 `pnpm verify` 通过。

## Context and Orientation

观察基线：2026-10-22 `main@6aa6592` 的 active 有十四份日期计划，`docs/README.md` 为 46995 字节；其 Active 表混入 completed 链接。issue 中的大小与数量是旧观察，执行时重新计算。

`2026-09-29-prelaunch-system-architecture-renewal.md` 控制开放 epic #216，继续 active。本批新建的 #233/#186 计划也按其工作状态保留，不能把“只剩一份”硬编码成全仓不变量。

`2026-09-21-rule-checks-api-base.md` 的验收 5 从未证明真实 stackEntry 运行中的 `github.base_ref` / PR API 声明 `base.ref` 分歧；PR #100 合并不等于该验收通过。Gate E1 的当前权威是 #4 的 2026-10-15 人类 freeze 裁决，历史实验与 ADR 讨论不由本 PR 改写。

假设：十三份候选的执行已经结束，真实遗留均可找到明确承接；若取证发现仍开放的实施工作，先报告并修订候选判断，不能强行打勾或移动以满足旧数量。

## Design / Spec

独立设计 A 比较直接归档、拆分索引与生成器，独立设计 B 增加逐计划剩余项核对及当前目录集合验收。reviewer 采用直接归档与短人工索引：不新增 registry、生成器或兼容重定向，不折叠历史正文。

先从候选计划与远端回读建立十三行运行态证据表：所属 issue/PR、已证实批次、未证实项、承接位置。仅有历史测试/评审/后续实现证据的项才打勾；不因关闭或合并推断变异实验成功。缺少的 Outcomes 只回填可核实结果；找不到证据就明确未核实并保留或转交。

旧计划仅允许完成勾选、Outcomes、路径与生命周期 header 的 Active→Completed 机械投影；不改 Design、Decision Log 或历史验收结论。历史文本被新事实推翻时只在允许的 Outcomes 明确有日期订正，不抹去原反例；必须在原位置补标时，只加指向新 Outcomes 的 Superseded 引用，不重写旧结论。依 `PLANS.md` 对这类订正追加 Bottom Change Note，不将新回读当成历史实验已执行的证据。

预留 TD-090 承接 rule-checks 验收 5，记录原计划完成态路径、分歧证据缺失、为何不能用普通 CI 等价替代、后续自然真实栈成员的取证命令和关闭判据。两个 view 分组人工项、未核实变异等按已有承接保持真实；若发现额外仍需执行的独立工作，先记录明确承接，不能为凑归档数量打假勾。

用真实 rename 移动文件（Superseded by Decision Log 的双副本裁决，2026-10-22：client-frame-validation 保留既有完成态，删除重复 active）；全文检索 `active/<候选名>` 及相对 Markdown 链接，修复具体路径而非替换通用 `active/x.md` 分桶夹具。索引每计划一短行，只保留名称、链接和用途；Active/Completed 表达状态，正文不再复制测试数、审核历史或易失状态。

`AGENTS.md` 的当前门禁仅说明 E1 已获 2026-10-15 freeze 裁决、物理 v1 基线由 #223 承担、R1 仍是发布门；指向 #4 权威评论，不连带重写旧 E1 文档或 ADR。官方方法参考 [GitHub README 相对链接](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)，归档规则以本仓 `PLANS.md` 为准。

## Global Constraints

工作分支 `docs/archive-finished-plans`，隔离位置 `.worktrees/archive-finished-plans`。所有验证在该分支工作树根目录；远端命令带 `-R SingularityKChen/harness-projects`。代码 churn 严格小于 800、文档小于 1300；rename 必须被正常 Git 检测，不能靠改预算掩盖超限。

唯一旧计划移动集合如下（Superseded by Decision Log 的双副本例外，2026-10-22）：同名从 `docs/exec-plan/active/` 到 `docs/exec-plan/completed/`，不另建副本。

| 日期文件名 | 必须核对的完成或剩余事实 |
|---|---|
| `2026-09-18-delivery-planning-and-board.md` | 已完成批次；两个 view 人工分组仍无 API 证据，不打假勾 |
| `2026-09-18-review-feedback-convergence.md` | 四 PR 真实合并；历史 active 理由已过时 |
| `2026-09-18-rule-semantics-and-checker-convergence.md` | 已交付 PR 与各自遗留，不宣称全部原 issue 同时完成 |
| `2026-09-20-repository-guidance.md` | #68/#69 完成，短 Outcomes 反映实际交付 |
| `2026-09-21-gate-e1-write-and-events.md` | #24 完成，保留被取代的实验结论 |
| `2026-09-21-memory-storage-transaction.md` | #85 完成，保留替身剩余边界 |
| `2026-09-21-merge-gate-layers.md` | 已交付车道；#362 后续演进不改写原设计 |
| `2026-09-21-review-blockers-core-invariants.md` | #93/#94/#95 证据；未核实变异不冒充成功 |
| `2026-09-21-rule-checks-api-base.md` | 验收 5 先转 TD-090，仍保留未兑现判定 |
| `2026-09-21-stack-invariant-gaps.md` | 五 PR 真实交付；Outcomes 补足证据边界 |
| `2026-09-22-engineering-merged-state.md` | #110/#111 已交付，保留历史实测 |
| `2026-09-24-local-git-worktree.md` | #137/#160 完成，#214 取代说明保留 |
| `2026-10-12-client-frame-validation.md` | #312/#323 完成，旧最终待跑陈述只据实订正 |

其余唯一编辑集合：`.github/dependabot.yml` 的候选精确路径注释；`AGENTS.md` 当前门禁；`docs/README.md`；债务 tracker 的新增 TD-090；本计划及完成态；`scripts/resolve-pr-base.mjs`、`tests/contract/e1-evidence-consistency.test.js`、`tests/contract/rule-checks.test.js` 的具体路径；评审收尾的 `docs/review/pr-398-mmp-review.md` 与 `docs/project-management/merge-queue.md`；以及全文搜索精确命中上述旧路径的 `docs/` 引用行。后者只换目标目录，不重写相关正文；测试首个 guard import 归 #186 所有。

## Plan of Work

### Batch 0 · 归档清单与 draft

最小闭环：计划和候选证据表可审阅，draft 元数据先建立。主文件是本计划。

协调者先提交计划、创建含 `Closes #363` 与 ExecPlan + Batch 的 draft，回读 head/base/isDraft/issue 关联，之后执行归档。`gh pr list -R SingularityKChen/harness-projects --head docs/archive-finished-plans --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences` 期望一条 draft、base main、关联 #363；回滚点为仅计划提交。

### Batch 1 · 证据回填与迁移

最小闭环：十三份候选的已完成与剩余项均可追溯，文件进入正确生命周期目录。主文件是移动集合与债务新行。

先记录 `wc -c docs/README.md` 超过 20000 的红基线，以及旧路径检索有命中；文档不新增镜像测试。逐计划以 `gh issue view <所属编号> -R SingularityKChen/harness-projects --json state,closedAt` 和 `gh pr view <所属编号> -R SingularityKChen/harness-projects --json state,mergedAt,closingIssuesReferences` 回读并核对仓内证据。先登记 TD-090，再完成允许的勾选/Outcomes/header 与 rename。

验证：`git diff --summary origin/main` 期望候选呈 rename，`git diff --numstat origin/main` 期望不出现整篇删除重建。逐份人工对照只含允许编辑；未兑现验收仍明确未兑现。回滚将本批整体反向恢复，保留运行态证据供重新判断。

### Batch 2 · 引用、短索引和当前门禁

最小闭环：所有读者和测试都能找到移动后的证据，Active 表等于真实目录。主文件是索引、当前门禁与精确引用行。

将十三个旧完整路径写入运行态清单，再执行 `git grep -n -F -f <运行态清单> -- .`，期望无输出、退出 1 表示无匹配；另用 `rg -n 'active/2026-' docs scripts tests` 逐项排除仍开放计划，确认没有移动候选遗漏。清单不提交，也不把旧完整路径复制进新计划形成自命中。

短 Node/人工链接检查解析 README 的 Active 与 Completed 表，和目录日期 Markdown 文件比较集合：无重复、所有移动计划恰在 Completed、Active 包含当前真实开放工作；相对链接目标存在。`wc -c docs/README.md` 期望小于 20000。仅订正 AGENTS 当前门禁。回滚本批可恢复旧索引与引用，但须与 Batch 1 一起撤销避免悬空路径。

### Batch 3 · 验收、提交整理与 ready

最小闭环：路径与历史事实审查通过，当前 head 可交人类评审。主文件是本计划的结果与最终索引短行。

运行 `pnpm test:file tests/contract/e1-evidence-consistency.test.js tests/contract/rule-checks.test.js tests/contract/resolve-pr-base.test.js tests/contract/plan-facts-consistency.test.js`，再按 issue 要求运行 `pnpm verify`；期望 fail 0。运行 `node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs size origin/main`、`node scripts/rule-checks.mjs disclosure origin/main`、`git diff --check origin/main...HEAD`，期望退出 0，并核对本批严格预算。

独立验收者检查历史没有虚报、目录/索引/链接完整和组合冲突；本计划完成后也移入 completed。整理提交后最终 push，回读当前 head/base/checks/closingIssuesReferences/review threads，当前 head 通过才 ready。仅请求人类评审，不合并。整体回滚本 PR 恢复所有目录与引用，运行数据不受影响。

> 合并限制 Superseded by Decision Log「MMP 评审收尾授权」（2026-10-22）：人类后续授权本 PR 修复、独立复评并在当前门禁成立后 rebase merge；不授权改写规划状态或阻塞关系。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| active 只保留开放工作 | 目录与 Active 表集合相等；#216 与在执行的新计划不误归档 |
| 十三份历史全部可达 | rename 记录、Completed 唯一短行、相对链接有效 |
| 旧路径清空 | 旧完整路径 git grep 零命中，退出 1 为预期；相对链接另查 |
| 索引减重 | `wc -c docs/README.md` 小于 20000，主题入口仍可用 |
| 历史与债务真实 | 验收 5 仍未兑现且 TD-090 存在，未核实/人工项不打假勾 |
| 机制无回归 | focused 契约与 pnpm verify 通过；当前 head 门禁回读 |

## Progress

- [x] (2026-10-22 SGT) 独立设计 A/B 与第三方审查已收敛归档边界与十三份候选。
- [x] (2026-10-22) Batch 0：plan-only 提交、draft 与关联回读。
- [x] (2026-10-22) Batch 1：逐份证据、TD-090、允许回填与迁移。
- [x] (2026-10-22) Batch 2：路径、短索引与当前 E1 入口。
- [x] (2026-10-22) Batch 3 本地：聚焦契约、pnpm verify、目录/链接/字节/旧路径检查通过。
- [x] (2026-10-22) Batch 3 独立验收：判别证据、历史编辑边界、74 项 focused；修正 TD-090 分歧对象。
- [x] (2026-10-22 SGT) Batch 3 交付准备：独立验收与归档完成；最终 head 的 CI、关联和 ready 是外部实时事实，按 Outcomes 的命令回读。

## Surprises & Discoveries

2026-10-22 独立验收：TD-090 初稿将原验收的运行时 `github.base_ref` / PR API 声明 `base.ref` 分歧误写成 API base / 声明 base 分歧；两者原本就是同一 API 值。对照 `.github/workflows/rule-checks.yml` 的两条诊断输出与历史验收 5 后修正，关闭条件仍要求真实 stackEntry 运行，普通 CI 不代替。

2026-10-22：全文精确检索额外命中 `.github/dependabot.yml` 的历史注释；“仅 docs 命中”的初始范围假设不成立，只换目标目录即可满足全仓零旧路径。

2026-10-22：`main@6aa6592` 已有 client-frame-validation 的 active/completed 双副本（12349/12840 bytes）。既有 completed 多出已建 PR #326 的勾选、交付 Outcomes 与归档记录；不能覆盖它。实际迁移为十二次 rename 加一份重复 active 删除，十三份历史均在 completed 可达。

2026-10-22：两份规则/不变量计划的 Outcomes 仍是“完成后填写”，另有部分历史已回填；不能机械凑出四份空 Outcomes。证据为候选文件的 Outcomes 原文，按实际欠缺处理。

2026-10-22：E1 证据测试能在两目录发现计划，但声明路径仍含候选旧位置；路径发现成功不能豁免本 issue 的“旧引用为零”。

## Decision Log

2026-10-22 / MMP 评审收尾授权：人类在本次评审会话对 #397–#399 逐项要求，无 P0/P1 或只有 P2/P3 时，由评审会话修复、独立复评、归档、整理提交、核对 issue 后 rebase merge。#398 初审两项 P2、无阻塞，已由评审账号一次性 APPROVE；本次仅修正证据直接支持的状态与批次框，不扩张历史验收。原归档提交与这些修正收敛成一个可回滚的归档闭环；共享历史改写先保存恢复 ref，再用精确 lease，并核对 range-diff。

2026-10-22 / 协调者裁决：允许仅改 `.github/dependabot.yml` 中候选旧路径注释，配置行为不变；这是 every-path 零引用验收的必要路径修复。追加旧路径零匹配、workflow 与 diff 检查，不因纯注释重复全套验证。

2026-10-22 / 协调者裁决：保留既有 completed/client-frame-validation 权威，删除重复 active；允许此归档必要的可逆删除。Superseded：本计划所称十三次全部 rename 的预期；实际是十二次 rename 加一次重复删除。依据为基线双副本逐行差异，不改 completed 原叙事。

2026-10-22 / 协调者回读：draft PR #398 的 base 为 main、初始 head 为 `bf735e9`，双向关联 #363；外部元数据 actor/target/idempotency/ack 已登记运行态记录。当前 head 的最终门禁仍待后续回读。

2026-10-22 / 独立 reviewer 与协调者：采用人工短索引、真实 rename 和有限回填；拒绝 registry/生成器与历史压缩。理由：直接完成验收且减少事实副本。

2026-10-22 / 协调者：允许仅将生命周期 header 的 Active 改为 Completed，解释为 Outcomes 完成状态的机械投影；不改变历史设计和验收结论。理由：保留 Active header 会与目录相互否证；此可逆变更随整 PR 撤销。

2026-10-22 / 用户启动授权：点名开始 #233/#363/#186 允许对应 Status 进入 In Progress；本计划仅负责 #363，不含 In Review / Done 或依赖关系授权。外部写入由协调者留 actor、目标、幂等键和结果。

## Idempotence and Recovery

迁移前检查源存在且目标不存在（client-frame-validation 双副本按 Decision Log 例外保留既有 completed）；重复运行先按当前目录判断，不覆盖既有 completed 文件。路径修改按候选名精确匹配；已完成的替换重复执行不变化。失败时恢复同一批 rename、重复 active 删除、索引与引用，不能只恢复目录或只恢复索引。

## Interfaces and Dependencies

使用 Git、gh、Node 与现有文档契约；除远端只读和 draft 元数据，不需要平台写实验。`docs/README.md` 各 PR 只维护自身短行；tracker TD-090 归本 PR，TD-040/063/068 与 TD-088/089 留给各自 owner。最终组合预演检查表格与行级合并，不能整表覆盖。

## Outcomes & Retrospective

2026-10-22，独立验收在检出 `docs/archive-finished-plans` 的工作树根目录锁定实现 head `01caecf8` 与基线 `6aa6592d`：直接读取基线的 README 为 46995 bytes，当前为 18655 bytes；旧路径匹配从基线 56 处降为 0（当前 grep exit 1），Active 2 / Completed 101 与真实目录相等，README 与十三份候选相对链接无缺失。十二份迁移计划除生命周期 header、路径与 Outcomes 外逐字不变，未新增历史完成勾选；既有 client-frame completed 逐字保留。独立 focused 74 pass / 0 fail，workflow/size/disclosure/diff 检查通过。验收修正 TD-090 的分歧对象并保留未兑现状态；未复跑历史实验，最终远端门禁与 ready 仍由协调者执行。

2026-10-22，在检出 `docs/archive-finished-plans` 的工作树根目录完成本地实现与验证：十二份历史计划真实 rename；client-frame-validation 保留既有 completed、删除重复 active。十三份均在 Completed 唯一可达；两个 view 人工项、未核实变异仍有显式边界，rule-checks 验收 5 未兑现并转入 TD-090。

`docs/README.md` 从本次红基线 47137 bytes 降至 18655 bytes（小于 20000）；Active 两份、Completed 101 份，与本工作树目录集合完全相等，索引相对链接无缺失。候选旧路径清单的 `git grep -n -F -f <清单> -- .` 退出 1、零匹配；相对链接另行核对，未移动候选无遗漏。

既定 focused 四文件经 `pnpm test:file` 验证 74 pass / 0 fail。`pnpm verify` exit 0：typecheck、三层测试 1886 pass / 0 fail、MVP-0 7 pass / 0 fail；`node scripts/workflow-check.mjs` no findings。上述证据来自当前工作树，不替代历史 head 的未执行实验或最终远端 CI。独立验收结果见本节开头；最终当前 head 门禁与 ready 留给协调者，本控制计划继续 active。Superseded by 本节“归档与交付回读”（2026-10-22）。

### 归档与交付回读

2026-10-22，在分支 `docs/archive-finished-plans` 完成本地独立验收后归档本控制计划，索引与目录随之为 Active 1 / Completed 102。用 `wc -c docs/README.md`、目录与表格集合校验可重算。最终交付在 push 后执行 `gh pr view 398 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,isDraft,closingIssuesReferences,mergeStateStatus`、`gh pr checks 398 -R SingularityKChen/harness-projects` 并读取全部 review threads；期望关闭引用含 #363、所有当前 head checks 通过、线程无未解决阻塞，之后由协调者 ready，保持未合并。这些实时值不固化进计划。

提交整理保留完整 PR 的独立归档闭环，不保留临时设计/修复提交；先保存本地恢复 ref，再比较文件树与 range-diff，发布使用精确 old-head lease。

MMP 评审修订观察（2026-10-22，检出 `docs/archive-finished-plans` 工作树，以真实 `main@97f54ebb` 为 base）：两项 P2 已按独立 API 回读修正，未核实过程和人工 view 验收保持未勾。README 冲突采用归档短索引并保留 #397 完成计划行，Active 1 / Completed 103、18,784 字节，目录与索引集合一致、相对链接有效，13 个候选旧路径零命中。该段取代初次验收中“未新增历史完成勾选”的阶段边界；新勾选只有五个已合并批次与已确认配置，不涵盖历史变异或线程操作。最终 head 的 CI、回复与合并仍按上节命令回读，不预写未来状态。

## Bottom Change Note

2026-10-22：独立验收复核全部归档与索引判据，修正 TD-090 的运行时诊断/声明 base 分歧对象，记录真实验证并保留远端交付门。

2026-10-22：记录本地红绿、十二 rename 加重复删除、索引与目录集合；控制计划等待独立验收，未声称远端当前 head CI。

2026-10-22：经协调者裁决纳入 dependabot 精确路径注释；已记录双副本例外与真实迁移数量。

2026-10-22：完成十三份证据边界回填与迁移，新增 TD-090、精确路径和短索引；Batch 3 等待本地验证与独立验收。

2026-10-22 SGT：由两份独立设计审查后创建，预留 TD-090，限定历史编辑与生命周期 header，明确新 active 计划及跨 PR 行级所有权。

2026-10-22 SGT：独立验收后归档控制计划，补充最终交付回读规则与提交恢复边界。

2026-10-22 SGT：补记 MMP 初审两项 P2 的直接证据修复、评审收尾授权与提交边界；旧计划按原处 Superseded 和变更注记保留历史，不推断历史实验完成。
