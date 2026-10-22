# 显式交付刷新与可追溯谱系 ExecPlan

> 状态：Active
> 创建：2026-10-22
> 范围：issue #233；补齐 Development 锚点分页，使用录制 Development、真实双 adapter 与 SQLite 验证显式刷新闭环。
> 规范：`PLANS.md`、`AGENTS.md`、`docs/development/workflow.md`；公开需求为同仓 issue #233 及其 2026-10-15 交接评论。

## Purpose / Big Picture

已开始工作的工作项可以显式刷新其已记录分支、提交、PR 与 CI；目标位于第二页仍能找到，暂时读不完整时保留最后确认值并标陈旧。查询只读本地事实，工程变化不改规划状态。

最小成功证据是在真实 Development adapter 的原始录制夹具、真实 Delivery adapter 和 SQLite 上，从公共组合入口刷新，重开数据库后纯查询仍能逐字段追溯整条概念链；后页目标、离线与反向完成的刷新有判别性反例。

## Context and Orientation

事实：`chain-facts.ts` 的 `readHeadCommit` / `readChangeRequest` 只取前 50 项；`delivery-facts.ts` 已拥有唯一摄入事务、完整集合替换、陈旧保留与 `attemptedAt` 乱序保护。`delivery.ts` 查询不再读 Provider。#297 与 #353 已落地，仓库路由和同仓 Local Git/GitHub 引用已有公共入口。

事实：`tests/integration/github-development-lineage.test.js` 目前只有脚本化平台与 FakeStorage 接缝；真实 Development 录制在 `tests/contract/fixtures/github-development/sandbox.json`。`tests/fixtures/github-actions.mjs` 是明确标注的合成协议响应，并非同一沙箱的完整真实 CI 录制。

术语：“概念链”表示可追溯的执行事实，并不要求图的每个相邻概念均有一条串行边。“完整空”表示终页已读完而目标不存在；“缺口”表示未能确认，因此不能删除最后确认值。

假设：本闭环使用单仓显式刷新，现有 writer 足以收敛重复与乱序读取；若反例推翻，先修订本计划的失败机制，不引入观察消费者或顺带解决多仓 Delivery 路由。

观察基线：2026-10-22，协调者在 `origin/main` 的 `6aa6592` 派生检出报告 `pnpm verify` 通过；后续以本分支实际命令重新取证，不继承旧 head 的 CI。

## Design / Spec

独立设计 A 建议复用现有 writer 并增加早停分页，另比较独立 Branch 实体和观察流消费；独立设计 B 比较早停分页、按锚点查找新端口和增量观察协议。独立 reviewer 选择第一条：新增一个小型 Development 查找函数，不扩 capabilities、schema 或 writer。

两处查找请求固定 `limit=50`，最多读取 100 个端口页。每次只保留当前页和已请求游标；找到精确目标即停止，未找到且 `nextCursor === undefined` 才确认不存在。坏页、空或非字符串游标、游标成环、页读取失败、上限后仍有下一页全部产生对应能力缺口。不能把 100 个端口页宣称为 100 次 HTTP 请求：GitHub adapter 内部另有填页边界。

分支名称来自已记录 `ExecutionContext.branchExternalId`，不得由标题或默认名重识别；分支存在但没有 head 仍是缺口。PR 必须匹配该已观察 head，继续使用仓库路由与 `headBranch` 过滤，不接纳 fork、大小写或旧 head 诱饵。

验收中的 Branch 由 `ExecutionContext.branchExternalId` 与 Worktree hop 的 `label` 承载，二者必须相等。实际图是 WorkItem `tracks` Context、Context `has_worktree` Worktree、Commit `derived_from` Worktree、PR `produced_by` Worktree、Pipeline `runs_on` Commit、Check `runs_on` PR；不声称存在独立 Branch hop 或 Commit→PR 直接边。Commit 的 externalId 必须等于录制 PR 的 sourceVersion。

SQLite 整合保持原 Development JSON 不变，使用其 `fixture/gamma` 和实际 head；Start Work 经离线写能力建立锚点，再用公共 `bindRepository` 添加 GitHub alias。Delivery 使用真实 Actions adapter 与明确合成、锚定相同 head 的协议响应。严格 replay 拒绝未录制请求；证据写成“录制 Development + 双 adapter + SQLite”，不得写成同一次真实平台全链录制。

本 PR 不消费 Development `reconcile`。TD-063 保持 Open：没有交付 watermark、增量游标、全量缓冲上界改善，也没有证明 reviewDecision 变化必推进 updatedAt；第一位观察消费者落地前必须解决。通过调用计数或抛错探针证明刷新和查询均未调用该流。重复与乱序验收指显式刷新的重复结果及并发反向完成，不冒充乱序外部事件摄入。

官方依据：[GraphQL 分页](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api) 说明 cursor 续页；[PullRequest 字段](https://docs.github.com/en/graphql/reference/objects#pullrequest) 未给出评审变化与 updatedAt 的因果保证。项目自身额外承担预算、成环和不完整判定。

## Global Constraints

工作分支 `feature/lineage-refresh`，隔离位置 `.worktrees/lineage-refresh`。下述命令均在该分支工作树根目录运行；GitHub 命令必须带 `-R SingularityKChen/harness-projects`。

唯一改动集合：`packages/core/src/chain-facts.ts`；现有 `tests/integration/github-development-lineage.test.js` 的测试正文；`tests/e2e/delivery-lineage.test.js` 的既有完整性矩阵与相邻注释；必要的新建 `tests/fixtures/lineage-refresh.mjs`；本计划及其完成态路径；`docs/README.md` 的本计划短行；`docs/exec-plan/tech-debt-tracker.md` 的 TD-040/063/068 行。不新增 `*.test.js`，已有测试首个 guard import 归 #186 所有，本任务只追加正文。

每 PR 代码及测试 churn 严格小于 800 行、文档小于 1300 行；不依赖另两 PR、不修改 UI、公共图契约、schema、Provider 实现或 Planning 写策略。仅在证据充分时解决 TD-040/068，TD-063 不关闭。不得推 main、合并 PR 或代写 In Review / Done。

## Plan of Work

### Batch 0 · 固定设计与 draft 元数据

最小闭环：本计划经两个独立设计和第三方审查后，作为后续实现的唯一控制文档。主文件为本计划。

协调者先提交计划，创建含 `Closes #233`、ExecPlan + Batch、验证与风险的 draft PR，补齐机械元数据并回读 issue 关联、base、head、isDraft；实现者收到该回执后才开始 TDD。

验证：`gh pr list -R SingularityKChen/harness-projects --head feature/lineage-refresh --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences`；期望恰一 draft、base 为 main、关联 #233。回滚点是仅计划的提交，不做产品写入。

### Batch 1 · 后页锚点可达且不完整读取保留缺口

最小闭环：第 51 个分支或第 51 个同仓同分支旧 head PR 之后的目标可被找到。主文件为 `chain-facts.ts` 与已有整合测试正文。

先追加会在旧实现失败的分支和 PR 后页用例，再实现早停查找。覆盖第 100 页找到、超限、空中间页、完整无目标、A→B→A、坏页、二页失败；先建立旧快照再注入失败，断言节点、anchor、confirmedAt 不变而 stale 为真。移除两处首页完整性判断，不重构完整 Delivery 集合算法。

验证：`pnpm test:file tests/integration/github-development-lineage.test.js`；先记录新反例失败，再记录修复后 fail 0。临时恢复“只读首页”变异必须使后页用例失败，恢复后复跑。回滚到 Batch 0 即恢复原安全缺口行为。

### Batch 2 · 真实接缝、持久化与状态隔离

最小闭环：真实 adapter 事实通过唯一 writer 落入 SQLite，重开库仍能纯查询，身份与规划状态保持稳定。主文件为已有整合测试正文及必要夹具。

用原始录制分支/head 建立链路，检查实际图和字段映射；SQLite entity 主键、relation 两端、repository 行键不得等于任何录制 PR/Repository node id。重复刷新比较实体与关系三元组集合；晚完成旧刷新不得覆盖新快照；成功→离线→恢复验证陈旧状态。CI failure 覆盖三种 StatusPolicy，PR merged 覆盖默认策略，Planning 存储前后逐字相同。重开库查询时 Provider 调用数为零。

验证：`pnpm test:file tests/integration/github-development-lineage.test.js tests/integration/delivery-repository-routing.test.js tests/integration/delivery-pages-complete.test.js tests/integration/github-actions-ci-facts.test.js tests/e2e/delivery-lineage.test.js`，期望 fail 0；再运行 `pnpm run typecheck` 与 `pnpm run boundaries`，期望退出 0。回滚本批只删除新增验收，不改变已有数据格式。

### Batch 3 · 独立验收与 ready 交付

最小闭环：当前 head 的独立验收和公开面证据完整，可由人类评审。主文件为本计划、债务对应行和索引短行。

未参与实现者审查反例、图语义、TD-063 边界、身份和减法；需要重构时只改本闭环并重新验证。运行 `pnpm verify`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`；期望全部退出 0，并人工确认本批更严行数预算。

整理临时提交为独立可审阅序列；已推分支改写前建立 backup ref 和精确 lease。最终 push 后回读当前 PR head/base、checks、closingIssuesReferences 与所有 review threads；当前 head 通过后才 ready。完成计划移入 completed 并修正自身索引，保持 PR 未合并。回滚方式为整体撤销本 PR，无数据迁移。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 录制场景可追溯概念链 | 公共 Start Work/bind/refresh/query、实际图与 branch/head/PR/CI 字段断言，SQLite 重开仍相同 |
| Development 两处越过 50 项 | 第 51 项及第 100 页目标先红后绿；限制、循环、坏页只形成缺口 |
| 离线与乱序安全 | 旧节点/anchor/confirmedAt 保留；stale 恢复；延迟旧刷新不覆盖新快照 |
| Planning 正交 | 三策略 CI failure 与默认 merged 前后 Planning 存储逐字相等 |
| 身份与纯查询 | node id 不作内部键；重复关系集合不增；重开查询零 Provider 调用 |
| 诚实边界与交付 | reconcile 零调用、TD-063 Open、录制与合成来源明示；当前 head checks 和 issue 关联回读 |

## Progress

- [x] (2026-10-22 SGT) 两份独立设计和独立 reviewer 已核对现有机制，收敛本计划。
- [x] (2026-10-22 SGT) Batch 0：协调者已提交计划并回读 draft #397、双向 issue 关联与元数据。
- [x] (2026-10-22 SGT) Batch 1：现有整合文件初跑 1 pass / 6 fail；有界查找后 7 pass / 0 fail。只读首页变异退出 1，恢复后重跑全绿。
- [ ] Batch 2：双 adapter、SQLite、Planning 与乱序验收。
- [ ] Batch 3：独立验收、整理提交、当前 head 门禁及 ready。

## Surprises & Discoveries

2026-10-22：实际投影以 Worktree.label 表达分支，且 PR 与 Commit 同锚 Worktree；证据是 `delivery.ts` 的 `readDeliveryProjection` 与 `delivery-facts.ts` 的 `setOf`。因此采用逐字段概念链验收，不写不存在的独立 Branch hop。

2026-10-22：Actions helper 的注释说明合成协议，不能与 Development 的真实录制 JSON 混称全真实录制；两种来源在 Design 中已分开说明。

## Decision Log

2026-10-22 / 协调者回执：actor 为 repository owner via gh；目标为 Project 10 的 #233 条目及 draft #397。幂等键采用 `233:<field>:<value>`（assignee、ExecPlan、Batch、Status、Kind、Area）与 `233:pr-readback`、`233:issue-readback`，均 ack；PR 与 issue 双向关联已读回。本实现者不执行外部写入，最终 push 后仍需重新回读当前 head。

2026-10-22 / 独立计划审查者：采用显式刷新和有界查找，保留现有单写者。理由：补足真实缺陷且不引入增量消费的第二套协议；两独立设计均支持，差异与替代已写入 Design。

2026-10-22 / 用户启动授权，由协调者执行：用户点名“开始 issue #233 / #363 / #186”，允许仅这三项 Status 进入 In Progress；本计划只对应 #233。此授权不包含 In Review / Done 或依赖关系修改，外部写入须记录 actor、目标、幂等键和结果。

## Idempotence and Recovery

测试夹具使用独占临时目录，重复执行不读取上次数据库；只清理由测试拥有的临时内容。刷新重放由现有稳定实体/关系键和 attemptedAt 守卫收敛。分页失败返回缺口，事务异常沿既有 writer 降级；不新增局部事实缓存。

## Interfaces and Dependencies

依赖当前 main 的仓库路由、公共 setup/bindRepository、Development/Delivery 端口和 SQLite。离线验收不需要凭据；GitHub 仅 draft、元数据和最终回读由协调者写入。原录制 fixture 的 query hash 与 provenance 契约必须继续通过。

## Outcomes & Retrospective

设计与独立审查已完成，实现和验收尚未执行。最终记录实际 red/green、来源边界、当前 head 证据与遗留；若不消费观察流，TD-063 继续开放，不能因本 PR ready 推导其解决。

## Bottom Change Note

2026-10-22 SGT：初稿经两独立设计与第三方审查收敛，明确概念链图结构、TD-063 条件边界、原始录制不改写和跨 PR 测试正文所有权。

2026-10-22 SGT：记录 Batch 0 回执与 Batch 1 的 red/green、只读首页变异；开发查找只保留当前页和游标，未修改完整 Delivery 集合算法。

2026-10-22 SGT：整理分页交付提交时将后页可达正控与真正不完整负控纳入同批 E2E 边界；录制持久化验收由后续提交完成。
