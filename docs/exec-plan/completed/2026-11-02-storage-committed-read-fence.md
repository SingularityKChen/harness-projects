# Storage 已提交读取围栏 ExecPlan

> 状态：Completed（2026-11-02 SGT，本地技术验收完成；最终远端交付按 Batch 2 当前 head 回读门执行）。
> 创建：2026-11-02（Asia/Singapore）。
> 分支：`feature/storage-committed-fence`；基线 `ea3790315ae3d96dffb04dd5c2c4127cc558bb7d`。
> 关联：Closes #509；Refs #465；Refs #468。格式遵循根 `PLANS.md`。

## Purpose / Big Picture

异步读取等待期间，消费者能同步判断同一 Storage 是否发生已提交变化，再决定重读。这个交付只提供底层合同：Memory 同一 root 的共享提交计数，以及 SQLite 同一连接的自身提交和其它连接提交观察；不决定 Planning/Delivery 内容能否外发，也不授予权限或确认 Saved。

## Context and Orientation

#466 的同库另一 owner 可完成只读处置，而原 owner 仍收到旧 Healthy Promise。#469 已实现并验证同步 committed fence，但它是后继消费者，不能让较早的 Planning 依赖后继 Delivery。两份独立系统调查与第三份独立审订比较后，选择将这项已有公共 Storage 能力自然前置；不是把有可达 P1 的安全基础层先放行。

提取来源固定为 `3c8b8da155d71ce977f340cf1eca280d23b71209`，只移动下列合同与实现片段；来源不是目标基线。原纯 Storage 测试11项移入本交付，Core 双 owner 消费测试仍由 #469 保留，不删除或重复计算原断言。新工作树主线基线完整 `pnpm verify` 已为3023/3023加MVP0 7/7；这只是提取前基线，不是本实现验收。

## Design / Spec

`Storage.committedReadFence(): string` 立即返回 opaque token。只能比较同一个 root 实例前后是否相等，不解析、不排序、不跨实例比较数值，不用作业务 revision 或规划状态。接口不排队、不写库、不调用 Provider。

Memory 沿原草稿整体替换的提交点计数，失败不替换，纯读事务不推进。SQLite 沿原唯一 mutate/atomic/transaction 提交路径记录本连接成功写入，并组合该连接的 `PRAGMA data_version`；后者仅补充其它连接的提交，本连接提交由本地计数补足。无第二队列、状态表、schema 或数据迁移。[SQLite 官方 PRAGMA 文档](https://www.sqlite.org/pragma.html#pragma_data_version)说明 data_version 的同连接前后比较边界；本合同把两部分封成不可解析的字符串。

StorageTransaction 类型排除该方法。运行时 tx 调用以及同一 root active transaction 动态范围内偷调 root 均拒绝；COMMIT/ROLLBACK 结算后的 callback 可以读取 root fence。SQLite close 后仍按既有 CLOSED_MESSAGE 拒绝。

拒绝只用异步双读：最后一个旧 Promise 仍可在另一 owner 提交后返回。拒绝进程 global Map：它不能证明独立 SQLite 连接的提交。拒绝把 Planning/Delivery 策略、Core helper 或 owned round 混入本交付：同步 fence 只检测变化，稳定 foreign Syncing 的处置仍属于消费者完整修复。

## Global Constraints

代码文件集：`packages/capabilities/src/storage.ts`、`packages/capabilities/src/registry.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/src/storage.ts`、`tests/integration/storage-committed-read-fence.test.js`、`tests/fixtures/storage-committed-fence-mutations.json`；两处既有 instrumentation 为 `tests/e2e/status-policy.test.js`、`tests/integration/planning-snapshot.test.js`，仅同步透传 fence。文档为本计划、`docs/README.md` 和本交付独立评审记录。

代码 A+D≤1000，文档<1300；R1 设计估计145–151仅为历史；Superseded by Outcomes 的 R2 实测295。#472 的具体1074例外不覆盖本 PR。不修改 Planning Status、原生依赖、issue接受、真实凭据、Provider行为或上游权限；不自行 merge。

## Plan of Work

### Batch 1 · 合同与隔离提取

最小闭环：同一合同在两种实现均可同步观察已提交状态。先写11项纯 Storage 验收，在未实现端口的基线确认断言失败；再从锁定来源提取完整提交路径和类型接线，不挑部分安全片段。两处 async proxy 对此同步方法使用 bind 透传，保留其它异步 instrumentation 与原断言。

在检出 `feature/storage-committed-fence` 的工作树根运行：

    pnpm test:file tests/integration/storage-committed-read-fence.test.js
    pnpm typecheck

期望11项通过；失败必须是合同/提交行为，不以导入或夹具错误作 RED。回滚为本批合同、两实现和测试完整撤回，不动业务库。

### Batch 2 · 独立验收与远端交付

最小闭环：既有存储、原子写、事务寿命、跨连接和整个主线无退化。独立验收后整理 Conventional Commits，发布前机械扫描和人工五类检查；push 后回读当前 head/base/checks、issue双向关联及所有 review threads。

    pnpm verify
    pnpm boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure ea3790315ae3d96dffb04dd5c2c4127cc558bb7d
    node scripts/rule-checks.mjs size ea3790315ae3d96dffb04dd5c2c4127cc558bb7d
    git diff --check ea3790315ae3d96dffb04dd5c2c4127cc558bb7d...HEAD

期望全部通过、实际规模符合约束；当前 head CI 和独立评审通过后 Ready，请人类评审，不 merge。消费者再串行依赖本基线并保留各自验收。回滚须在消费者撤回后撤回本基础合同。

### Batch R2 · 独立复评修复同步提交窗口与祖先事务

旧source7c15587的正式独立评审提出一项P1、两项P2和一项P3。公开延迟getWorkspace返回与并发direct写证明：SQLite真实自动提交已被另一连接公共fence观察，但writer的无条件await(fn)尚未推进计数。两个adapter现在只有PromiseLike结果才await；同步fn完成后在同一执行段推进计数，保留原唯一queue与异步transaction结算点。父token链记录每个异步scope尚active的root，内层另一root不能遮住外层active范围；已结算callback仍依据active=false许可。

正式Storage测试从原11项保留全部断言并新增5项：Memory/SQLite成功dirty事务的暂存/ack/read-only、两个独立root嵌套动态范围、真实SQLite公共延迟读与另一连接commit观察。原树新16项13pass/3fail，修复后相邻39项和完整3039+7通过；初次parent optional类型未含undefined被typecheck识别后修正，旧错误保留为历史不计通过。

全部十一项变异定义归入`tests/fixtures/storage-committed-fence-mutations.json`，含id/file/anchor/replacement/killedBy和command。仅在隔离的同source快照、安装同锁文件依赖后运行：

    node scripts/review-mutate.mjs tests/fixtures/storage-committed-fence-mutations.json --root .

期望基线GREEN、11个具名KILLED及逐字还原GREEN；原六项变异在新source使用等价当前anchor，旧归属source7c及原负控记录保留在正式评审记录。禁止在产品owner工作树运行负控，不用旧CI放行新source。

## Validation and Acceptance

| 验收项 | 最小证据 |
|---|---|
| Memory/SQLite commit与rollback | 成功写后变、rollback后不变，2项 |
| SQLite另一连接 | 独立连接提交后当前 root token改变，1项 |
| SQLite关闭 | 既有关闭错误，1项 |
| SQLite atomic写 | 原子写推进、原子rollback不推进，1项 |
| root/tx动态范围 | 两种Storage active root和tx均拒绝，2项 |
| 结算后callback | commit及rollback callback可读root，各2项 |
| 全局边界 | typecheck、boundaries、完整verify、发布面与当前head CI |

## Progress

- [x] 2026-11-02 SGT：两份独立调查和第三份独立审订确认前置 Storage 基础能力边界。
- [x] 2026-11-02 SGT：隔离工作树与精确基线已锁；提取前完整基线3023+7通过。
- [x] 2026-11-02 SGT：Issue #509 / Draft PR #510已双向关联并回读分类；提取合同、实现与11项测试，未实现port的明确RED→GREEN，40窄与typecheck通过。
- [x] 2026-11-02 SGT：独立63项相邻回归和4项暂存/commit/rollback诊断通过；删除Memory no-op rethrow并加强同步string断言，完整3034+7与独立11项复验通过。
- [x] 2026-11-02 SGT：六项具名隔离负控KILLED且还原GREEN，源码冻结7c15587/baseea37903、代码140，发布面机械/人工五类检查通过。
- [x] 2026-11-02 SGT：独立正式R1评审1P1/2P2/1P3已读并根因修复；新16项正式回归先13pass/3fail后GREEN，39窄、完整3039+7及十一具名负控通过。
- [x] 2026-11-02 SGT：R2 source `d44b10a` 经协调者独立技术复评 APPROVE，原四项全部 ADDRESSED、无新增 finding；当前整理后的产品 `235ec37` 与该 source 逐字一致。独立23正式、13诊断、11具名负控及407文件还原 parity 均核对。
- [x] 2026-11-02 SGT：本地技术闭环完成，归档计划并更新索引；最终文档 head 仍须精确 CI、review/issue 回读、正式批准、作者 resolve 后 Ready，不 merge。

## Surprises & Discoveries

单一 SQLite data_version 不含本连接自身提交，所以必须保留本连接计数。异步 instrumentation 若把同步 fence 包成 Promise，会制造虚假的变化或失效，必须精确同步透传。已结算 callback 与 active tx 需要不同动态寿命判断，不能仅以 AsyncLocalStorage 中存在 token 就一律拒绝。

## Decision Log

- 2026-11-02 SGT · 全部开放PR接管：本会话人类原话：“请你接手所有 PR 的 review和 rebase merge。相关 PR 均已经 approval。请你按照审批流程继续”。本授权明确覆盖当前PR #510，由本评审会话接管修复/独立复评、实际base重放、当前head门禁、issue核对及rebase merge。旧阶段“不merge/仅Ready”的限制仅在合并授权上 Superseded by 本决策；技术、范围、预算、凭据与人类UAT/R1门保持。Planning Status及native依赖关系仍不写入。

- Decision：从 #469 自然提取已存在的 Storage primitive，作为 Planning 与 Delivery 的必要共用前置。
  Rationale：低层 Storage 合同可独立验证、合并和回滚；不复制权限状态、不新增公共基础设施，不为满足数字机械拆连续算法。
  Date/Author：2026-11-02 SGT / 两份独立设计、独立审订与本交付owner。
- Decision：保持纯 Storage 边界，Core 同步返回的类型验证及 Planning shared Disposition 留给消费者。
  Rationale：fence 不授稳定未结清读取权限，不能以本基础测试通过冒充 #465/#468 或R1完成。
  Date/Author：2026-11-02 SGT / 独立审订与owner。

## Idempotence and Recovery

重复读取 fence 不写任何事实；比较只在同一 root 内有意义。提取前来源与目标都有恢复 ref；失败保留库和日志，不删库或修业务数据。不依赖 token跨重启延续。无消费者时可整 PR revert；有消费者时按依赖逆序撤回，不能只删端口或一种实现。

## Interfaces and Dependencies

Node≥22、pnpm10.28.2、现有Memory/SQLite与唯一事务队列。公开参考为 SQLite PRAGMA data_version 文档；不依赖网络服务、秘密、LLM或新后台进程。必要 stack 是本基础→#466→#469→#472，技术依赖不修改人类拥有的原生Planning依赖或Status。

## Outcomes & Retrospective

R1 历史（source `7c15587`；Superseded by 本节 R2 当前验收）：当时本地能力闭环通过完整3034+7、独立63+4和精简后11项复验。正式测试额外保留read-only事务token不变断言；隔离副本六项具名负控均KILLED，基线和逐字还原后GREEN。代码实际以相对固定main的机械命令重算，R1源码候选140行；没有Core策略或schema，未延期技术债。远端旧plan-only head不代表当前source已交付，最终CI/独立回读后才Ready。

R2 当前验收（2026-11-02 SGT，source `d44b10a`，等价整理产品 `235ec37`，固定 main `ea37903`）：正式16项及相邻39项、完整3039+7、typecheck通过；独立原反例3/3（同步公开延迟读与两adapter祖先事务）、23正式+13诊断及11具名负控全部通过，协调者结论 APPROVE、原四项 ADDRESSED、无新增 finding。代码/测试/fixture实际295行 A+D；文档随本次归档以 `node scripts/rule-checks.mjs size ea37903` 重算。未延期技术债。最终远端 head、checks、threads、双向 issue 关联以 Batch 2 命令回读，不把本地批准冒充远端正式批准。


### 2026-11-02 · 接管与逐层合入门

本轮实际直接base为 `09eb366c0c7541f7cac40b3e71123e5dfe49579e`；在本分支根执行 `node scripts/rule-checks.mjs disclosure 09eb366c0c7541f7cac40b3e71123e5dfe49579e`、`node scripts/rule-checks.mjs size 09eb366c0c7541f7cac40b3e71123e5dfe49579e` 和 `git diff --check 09eb366c0c7541f7cac40b3e71123e5dfe49579e...HEAD`。早期批次的固定source/base用于重放其历史证据，不作本轮当前判定。

本PR原正式批准与全矩阵证据由 `docs/review/pr-510-mmp-review.md` 承接；本轮用户明确要求接管全部开放PR。每次父层合入后，以真实main/直接父层重新确定replay cut，保留完整已批准产品/测试语义、归档与导航。先建 `refs/backup/pr510-before-approved-integration-20261102`，再检查range-diff、规模、五类发布面与适用验证；仅使用精确旧远端head的lease发布。

在当前分支检出根回读 `gh pr view 510 -R SingularityKChen/harness-projects --json headRefOid,baseRefOid,baseRefName,isDraft,reviews,closingIssuesReferences`、`gh pr checks 510 -R SingularityKChen/harness-projects` 与全部review threads。新head的独立复评及真实必需checks成立后才执行已授权 `merge_method=rebase`；native stack成员使用仓库已验证的merge-async入口，逐项回读实际MERGED、合入tree和对应issue。旧head批准、dispatch、局部测试或“无冲突”不替代当前head验收。

## Bottom Change Note

Change Note (2026-11-02 SGT)：依据两份独立调查及独立审订创建本计划，把已存在Storage同步提交观察自然前置；保留全部事务/两连接/寿命验收，不混Planning策略，不继承472例外。

Change Note (2026-11-02 SGT)：完成纯Storage合同TDD、两adapter提取与同步proxy，独立验收后自然删除无作用catch并加强string/read-only合同，完整3034+7通过；保留最终负控和远端门，未改变规划Status或原生依赖。

Change Note (2026-11-02 SGT)：记录六项有效负控、源码冻结与真实140行；正式独立评审风险矩阵归入docs/review，远端门仍待当前head。

Change Note (2026-11-02 SGT)：按#510一次性正式review修复同步COMMIT与计数microtask窗口、祖先active事务链及正式dirtycommit判别；十一变异定义归正式fixture，自包含重放。当前完整3039+7、39窄与11负控通过，旧140行/3034证据仅属旧source。

Change Note (2026-11-02 SGT)：R2独立技术验收通过，原R1 Outcomes就地标为历史；16正式/295代码/3039+7为当前source证据，归档计划并保留最终远端交付门。

2026-11-02 SGT：按本会话人类对全部开放PR的直接授权接管收尾；新增实际base重放、恢复引用、精确lease、独立复评与逐PR合并回读门，保留原产品/预算/人验边界。
