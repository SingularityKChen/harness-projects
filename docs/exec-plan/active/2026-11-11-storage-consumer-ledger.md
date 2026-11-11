# Observation 与 webhook 当前消费者收敛 ExecPlan

> 状态：Active · 设计审定完成，实施尚未开始
> 创建：2026-11-11
> 范围：完成 #416 的消费者台账、committed 派生选择收敛与 webhook 身份守卫证据。
> 上游：issue #416 / parent #223；规范为根 `PLANS.md`、`AGENTS.md` 与 `docs/development/workflow.md`。

## Purpose / Big Picture

当前观察账本只有一个事实拥有者，已提交版本选择复用既有派生视图；某连接即使只有 webhook 事实，也不能再补绑账号而改写事实身份。无需转换已有当前数据库。

最小证据是生产 `recordObservation` 路径实际读该视图，当前排序/去重仍成立，webhook-only 锚点拒绝补账号且零关联写入。此结果不声称 webhook 安装/订阅管理能力或人类 R1 接受。

## Context and Orientation

账本是追加的原始观察集合；committed 是每个 `(binding_id, object_kind, object_external_id)` 主体中最大版本、再最大接收时刻、再最后追加的一行。派生视图不是第二张可写事实表。

`packages/storage/sqlite/src/storage-sync.ts:#committedVersion` 当前直接在账本上按前两键排序，重复了既有视图的选择规则。它只返回版本，因此最终 rowid tie-break 不会改变当前写入比较结果。

`packages/storage/sqlite/src/storage.ts:setProviderBindingAccount` 已在同一 atomic 体检查外部身份、观察、游标、webhook 和写尝试；已存在任一事实时拒绝首次补账号。无生产 webhook INSERT 不等于该表没有当前安全消费者。

## Design / Spec

本节是本项唯一消费者台账；实施后仅更新 runtime reader 的真实状态，不再另建重复架构台账。

| 对象 | 当前 writer / 事实 owner | 当前 reader | 裁定 |
|---|---|---|---|
| `sync_observation` | `recordObservation` 写唯一追加账本；测试 SQL 构造受控输入 | 去重、当前版本选择、账号关联事实检查及视图 | 保留 ledger，不新增物化 current 表 |
| `committed_observation` | 003 SQL 从 ledger 派生，无独立 writer | 当前 runtime 无直接 SELECT；sync-surface/schema 集成直接查询 | 保留并接入现有 committedVersion reader |
| `webhook_subscription` | 当前无公共写 port / 生产 INSERT；schema fixture 可写 | 账号关联的事实守卫；FK/unique/R6 结构证据 | 保留当前安全责任，不发明新 CRUD |

选择把 `#committedVersion` 改为按三维主体从 `committed_observation` 读取 `updated_at`，移除 direct-table ORDER BY/LIMIT 的重复选择。保留 `columnToVersion`、入口/committed 校验、去重顺序、比较器与唯一队列/事务机制。

视图 SQL 的 BINARY 版本比较、received-time 和 rowid tie-break 不改；只修正“尚待 SQLite 接入”等过时用途注释。保留 webhook 表、现有账号守卫及身份删除 FK，不把表变成规划字段或成员的唯一事实源。

仅补一个 SQLite webhook-only 当前场景：factory 建库，端口建账号与两个未关联锚点，第二连接只给一个锚点插入 disabled 订阅事实；卸载其挂载后事实仍在，初次补账号拒绝且关联仍空，重开后同样拒绝；无事实锚点成功作对照。不得同时种入其他 external facts，以免它们掩盖 webhook guard 丢失。

该场景在原实现应通过。临时移除 webhook SELECT 必须让它失败，再恢复；这是既有合同的判别证据，不伪称新功能 RED。view 接入属于等价重构，以代码审读和既有行为证据确认，不新增断言 SQL 字符串的镜像测试。

不选删除 view，因为 exact schema admission 会改变当前库准入，需要另一项 schema 决策；不选保留重复查询只写台账，因为两份已提交选择没有必要。若出现可复现的视图性能退化，记录样本/查询计划后重审，不能擅加缓存、物化表或兼容路径。

## Global Constraints

工作分支为 `chore/storage-consumer-ledger`，隔离目录为 `.worktrees/storage-consumer-ledger/`，PR base 为 `main`。同一 Storage owner 在 #415 后串行实施；该顺序是所有权协调，不是能力依赖或强制 stack。

唯一技术文件集合：`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/migrations/003_control_facts.sql`（仅注释）、`tests/integration/storage-connector-account.test.js`；仅在当前用途注释确有变化时修改 `tests/integration/storage-sync-surface.test.js` 的说明，不改其行为场景。

文档集合为本计划、`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 的 Batch 5 局部结果，以及完成时协调者更新的 `docs/README.md`。`storage.ts` 的守卫、schema/view 定义、manifest、generation、Provider/Host/Storage 端口不改。

技术新增+删除目标 60–140，执行上限 300 且必须 `<800`；文档目标 160–350 且必须 `<1300`。无依赖、生产写口、用户库转换或真实外部写入；不为旧 350–550 预测补行，不删安全证据。Planning Status 和原生依赖不写。

## Plan of Work

### Batch 1 · 一份 committed 选择与 webhook 身份守卫

**最小闭环**：明确并接通既有消费者，保留 schema 与当前身份保护，形成可独立验收/回滚的 PR。

**涉及主文件**：`packages/storage/sqlite/src/storage-sync.ts`、`tests/integration/storage-connector-account.test.js`。

先提交本计划并建立 `Closes #416` draft，回读 base、head、draft 和关联。补 Design 所述 webhook-only 用例，记录原实现通过、移除守卫负控失败及恢复通过。随后改 committedVersion 的来源并修正用途注释，复用现有最大版本、主体隔离、同版本、无版本和重启去重场景。

**验证命令唯一入口 V416**：以下在检出 `chore/storage-consumer-ledger` 的工作树根运行，记录当次 HEAD 与 `origin/main`；基线快照为 2026-11-11 SGT 的 `29947425`，既有窄基线为 285 passed，不代表实施完成。

```sh
pnpm test:file tests/integration/execution-relation-write-schema.test.js tests/integration/storage-sync-surface.test.js tests/integration/storage-connector-account.test.js tests/contract/storage-contract.test.js
pnpm typecheck
rg -n 'committed_observation|webhook_subscription' packages apps scripts tests --glob '!**/dist/**'
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
python3 -c "import subprocess; subprocess.run(['git', 'diff', '--check', 'origin/main...HEAD'], check=True)"
```

期望所有命令 exit 0；检索显示 committedVersion 的真实视图 SELECT 和既有 webhook 安全读者，测试 fail 0。webhook-only 负控失败且恢复通过；当前 FK、scope unique、R6、排序和去重证据保留。最终 diff 核算技术/文档预算，做发布面五类人工复查。

独立验收者审查真实 reader、主体维度与负控恢复；整理提交后 push，回读远端当前 head/base/checks/issue 关联及完整 review threads，该 head 通过后才 ready。协调者归档本计划和维护索引；不自行合并。

**回滚点**：独立撤回本 PR 即恢复 direct-table 查询，schema 未变，无需数据库变换。发生 guard 丢失、坏 committed 静默丢弃、负控残留或超预算时停止推进并修订计划。

## Validation and Acceptance

以 V416、webhook-only 负控/恢复输出及实际 diff 为证据。台账区分 writer、runtime reader 与测试消费者；实际写入比较走 view，重复选择 SQL 已消失，账号身份守卫继续拒绝且不写关联。

无新观察读取接口、物化状态、webhook 生产 writer 或数据库迁移。现有 sourceVersion 内容拒绝仍在原时机运行，#415 与本项各自在原 main 基线上成立。

## Progress

- [x] (2026-11-11 18:33 SGT) 核对两对象的真实 writer/reader、源码与两份独立备选。
- [x] (2026-11-11 18:33 SGT) 完成 main-base 独立性和预算审定，核对既有窄基线。
- [ ] Batch 1：webhook-only 证据、reader 收敛、负控/回归、独立验收与 PR 回读。

## Surprises & Discoveries

view 当前只有结构/集成查询消费者，生产版本读取另写相同选择；不能把测试消费者说成已有 runtime 消费。webhook 当前已有安全 reader，即使没有写口，也不能作为死表删除。

## Decision Log

2026-11-11 18:33 SGT / 独立设计审定者：保留两对象，committedVersion 直接读 view，webhook-only 仅补当前行为证据。Rationale：一份账本加派生视图保持唯一事实 owner，不改变 schema 准入或发明生产需求。

2026-11-11 18:33 SGT / 独立设计审定者：台账放在同一 ExecPlan，不新增架构副本或固定 mutation 配额。Rationale：任务闭环足够自包含，证据只补本项独有风险。

2026-11-11 18:33 SGT / 独立设计审定者：Project #10 实际 iteration 10（2026-11-09—15）与 body iteration 11（2026-11-16—22）预测漂移已记录；沿当前选择执行，不改 Status/依赖。Rationale：工程工作不篡位规划事实。

## Idempotence and Recovery

扫描和临时库测试可重复；所有 SQL fixture 都在新临时文件上，负控恢复并核对 diff 后才再次验证。失败不能清空订阅、绕过 guard 或覆盖账号关联。

回滚仅撤销代码与测试提交；没有 DROP/ALTER/UPDATE 用户库的步骤，也无需恢复外部系统。读路径仍由当前 Storage 队列/atomic 体拥有。

## Interfaces and Dependencies

复用 Node SQLite、现有 policy helper、`recordObservation`、`setProviderBindingAccount` 和当前 schema。Fake 没有 webhook state/port，SQLite 专属事实场景不强塞进 Fake 契约；不新增凭据或 Host ABI。

与 #415 同改 storage-sync 的不同责任段，由一个 owner 顺序落地；组合时执行两项命令并集一次并记录组合检出，轻微文本冲突不转写成原生 blocking 关系。

## Outcomes & Retrospective

实际结果为设计审定与计划落盘；实现和负控尚未执行。预计无新债务；#417/#595/#596 的基线折叠继续独立。若真实性能证据要求保留重复查询，先修订选择和理由；产生临时路径时在 `docs/exec-plan/tech-debt-tracker.md` 登记退出条件。

## Bottom Change Note

2026-11-11 18:33 SGT：审定首版，集中真实消费者台账，收敛为 view reader 与 webhook-only 安全证据，保持 main-base 独立交付。

2026-11-11 SGT：核正基线记录，仅保留观察日期，避免把 triage 时间误作测试时间。

来源：当前 owning source 与根 `PLANS.md`；SQLite 官方 `https://www.sqlite.org/lang_createview.html`、`https://www.sqlite.org/lang_transaction.html`（2026-11-11 核对）。
