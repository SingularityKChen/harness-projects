# 未登记工作项的 Storage 结构化拒绝 ExecPlan

> 状态：Completed（2026-10-04）：Batch 0–2 与验收批完成，第一轮 MVP 评审（APPROVE，5 条 P3）已修订并归档；合并与 #196 的关闭由人类决定，以 `gh pr view 265 -R SingularityKChen/harness-projects --json state,mergedAt,headRefOid` 回读为准。
> 创建：2026-10-03；关联 issue：[196](https://github.com/SingularityKChen/harness-projects/issues/196)。
> 分支：`fix/storage-work-item-rejection`；工作树：`.worktrees/storage-work-item-rejection`；PR base：`main`。
> 调度：P0 / S / 迭代 4（2026-10-08–14）/ M2 · 契约与存储骨架 / gate:E1。
> 本计划遵守根 `PLANS.md`；最终 spec、实施批次与失败恢复在同一份活文档中。

## Purpose / Big Picture

调用者向 Storage 写执行上下文时，引用一个未登记工作项，应得到两个实现一致的结构化失败；不能在Fake里成功，却在SQLite暴露驱动外键文字。
完成后，无效引用在任何上下文更新之前被拒绝，根SQLite调用甚至不会打开自己的写事务；有效父实体登记后仍能成功写入。
最小成功证据是共享契约以同一 `work-item-unregistered` 输入，断言同typed failure、旧active与新行不变，并保留实际StartWork的零外部写入/有效正控。
这收口Gate E1的一条端口事实，不批准Gate E1，也不重做 #188 已完成的Core登记闭环。

## Context and Orientation

执行上下文是工作项与仓库的一次工作环境记录。`ExecutionContextRecord.workItemId` 引用已登记 `entity`，SQLite的003保留该外键。
Storage端口和错误基础在 `packages/capabilities/src/storage.ts`、`packages/capabilities/src/result.ts`；调用方码和恢复动作唯一来源在 `packages/domain/src/errors.ts`。
`packages/providers/fake/src/storage.ts` 的 `putExecutionContext` 检查workspace、repository、status，却漏了workItem父实体。
`packages/storage/sqlite/src/storage-execution.ts` 先关闭同键active再UPSERT；通过 `SqliteSyncSurface.atomic` 保证两步回滚，缺父项最终变成裸FK异常。
队列、事务令牌、关闭状态、scoped生命周期唯一实现在 `packages/storage/sqlite/src/storage-sync.ts`，不得另起第二条执行面队列。
`tests/contract/suites/storage-execution.js` 的 divergence 用能力位保留Fake接受/SQLite拒绝的旧差异；绿色只证明旧账目，不证明一致。
`tests/integration/start-work-sqlite-registration.test.js` 已证明新StartWork从当前workspace规划投影拒未知项，不动branch/worktree/run。
`packages/core/src/start-work.ts` 的 `prepareRegistration` 正是该写前守卫；本项不修改它。

独立调查锁定2026-10-03的 `2b51a1b`；本轮计划检出快进到 `68524a0`，产品代码一致。
两位设计者分别研究端口/父边与故障/队列；独立reviewer读实现、确认issue范围并裁定错误码和最小交易适配。
后续命令都在检出 `fix/storage-work-item-rejection` 的工作树根目录运行；实施前重读 `git rev-parse HEAD main origin/main`，不给旧观察值授权未来写入。

## Design / Spec

### 固定拒绝类型，保持异常回滚契约

保留 `putExecutionContext(record):Promise<void>`，新增窄的公开错误类：

    class StorageInputError extends Error {
      readonly operation: 'putExecutionContext'
      readonly resource: 'work_item'
      readonly failure: ProjectError
    }

类在capabilities的Storage契约处定义并从现有index导出；实例name固定为 `StorageInputError`。
缺workItem父行时构造 `projectError(ProjectErrorCode.InvalidInput, '执行上下文引用的工作项未登记')`，operation/resource固定如签名。
`failure` 的完整字段为code/message/recovery/retryable/confirmedValue/attemptedValue；恢复动作none、retryable=false，两value显式undefined。
异常是Promise拒绝对象，不把POJO直接throw，不用ProviderResult包装本地Storage，也不泄露driver code、SQL或父行细节。
该类仅承诺本条已知输入拒绝；closed/busy/disk/编程错误保持原来的响亮失败，不一概映射invalid_input。

两设计的not_found与invalid_input冲突在这里统一为invalid_input。
domain的not_found默认建议open_provider，而此问题是本地引用输入无效；外部平台不能补这个Storage父行，因此采用invalid_input/none。
Core未知规划项原有NotFound保持不变，它描述另一层的查询目标缺失，不用Storage错误改写Core行为。

### 父边与队列内写前检查

只验证 `entity.id===record.workItemId` 已存在，active和terminal状态都检查。
不新增entity.kind必须work_item或必须有本workspace规划投影的Storage条件；前者不是现有FK，后者属于Core可操作项策略。
Fake在唯一 `#mutate` 槽内、关闭旧active和upsert之前检查，失败不改变数组或已有记录。
SQLite在同一队列槽内同步SELECT父行，失败早于自己的BEGIN；不是外部 `await read()` 后再排atomic写的两槽设计。
将现有 `atomic(fn)` 窄扩为 `atomic(fn, preflight?)`：scoped实例在mutate内先preflight再fn，不开嵌套事务；root实例在mutate内先preflight再现有事务体。
为避免队列内自等，提取既有BEGIN/令牌/COMMIT/rollback/finally为一个私有工作体，transaction与atomic共同使用；不要新增第二份交易机制或绕过令牌。
没有preflight的所有既有atomic调用保持原语义。预检与写体在同一槽连续执行，父存在时BEGIN后可复查该父边，保留FK作最终防线。
合法Storage接口没有删除实体，跨连接裸SQL删除不扩成本项新的CRUD/错误平台；若实际发现合法竞态，记录证据并重划门，不静默catch所有FK。
调用者已开的transaction无法撤销其BEGIN；scoped验收是失败方法零DML，未catch的typed异常按现有契约令整笔回滚。
调用者在tx内catch时，失败方法本身零mutation；后续独立合法写是否commit仍按现有交易语义，不偷偷把事务标毒。

### 被拒绝方案

方案B改为 `Promise<StorageResult<void>>`，显式ok:false较易匹配，但忽略返回值会让外层transaction提交先前暂存写。
它需要改全部Core调用点、结果解包与ack后的Unknown路径，扩大公共协议；本项拒绝该方案。
方案C只把SQLiteFK文案翻译成结构化错误，不加Fake父边检查，两个实现仍一边成功，因此拒绝。
方案D在SQLite队列外先SELECT再写，会在在途交易中误读/排两槽并引入检查与更新窗口，因此拒绝。
保留SQL FK、统一窄typed预检，既提供调用者契约，又保留Storage交易异常回滚不变量。

### 判别输入与错误字段

共享未知父边标题用“执行上下文：未登记工作项以同结构拒绝”，输入固定 `work-item-unregistered`，不要用 malformed `---` 触发Core校验替代它。
断言 `error instanceof StorageInputError`、name、operation、resource，以及failure所有字段深相等；失败不能含driver `ERR_SQLITE_ERROR` 或FK文案。
父workspace/repository完整播种，只缺workItem，防止先撞其他FK掩盖本项；合法entity正控复用同record再写。
更新既有context使用同id但未知workItem，确认旧记录深相等；新id未知项确认无新行；两个断言都不可省。
独立新ctx引用合法workItem时仍按原active规则关闭旧ctx，证明检查没有把正常替换全部阻断。
SQLite计数wrapper包实际WorkspaceDatabase，不加产品fault开关；BEGIN/DML零计数从播种完成后开始，避免把fixture写入算作失败副作用。
scoped未catch/catch两种路径分别验证，测试只说“失败方法零写”，不把已有outerBEGIN误写为整个调用过程零交易。
closed/storage驱动故障负对照要保原错误身份，保证typed错误没有变成吞异常总catch。

## Global Constraints

本轮只写本计划与索引；后续唯一文件集如下，超出先修订本章与预算。

| 角色 | 唯一允许文件 |
|---|---|
| 端口 / 导出 | `packages/capabilities/src/storage.ts`；`packages/capabilities/src/index.ts`（未改：已 `export *`，Superseded by Decision Log 2026-10-03 22:20） |
| 实现 | `packages/providers/fake/src/storage.ts`；`packages/storage/sqlite/src/storage-execution.ts`；`packages/storage/sqlite/src/storage-sync.ts` |
| 契约 / 台账 | `tests/contract/suites/storage-execution.js`；`tests/contract/suites/storage.js`；`tests/contract/storage-contract.test.js` |
| 集成 | `tests/integration/storage-work-item-rejection.test.js`（已新建）；`tests/integration/storage-restart.test.js`（未改，Superseded by Decision Log 2026-10-03 22:22）；`tests/integration/execution-relation-write-schema.test.js`（验收补入：`work_item_id` 外键的 DDL 钉住，见 Decision Log 2026-10-03 22:44） |
| 文档 | 本计划；`docs/README.md`；`docs/product/vertical-path.md`（验收补入：§2.1 第 6 行、X1 标题与观察基线）；`docs/exec-plan/tech-debt-tracker.md`（验收补入：TD-023） |

代码增删合计≤800、文档≤1300，含测试和fixtures，排除锁文件/生成目录。
预算区间：错误契约与两实现约80–130；最小交易体复用约50–90；测试/台账/fixture约150–230；代码总计约280–450。文档约280–380行。
交易机制调整超过约100行或总code预计超过600时先审context radius；若最终将超800，停止扩大协议，重新划独立闭环，不能删零BEGIN判别。
不改schema或添加迁移；没有真实用户/数据，不建立历史库兼容、双读/双写、旧数据升级路径。
#189/#196共享Storage端口/Fake/同步机制文件由一个集成owner串行落地；其他区域可并行调查，不因此建立Git stack。
不修改Core身份/登记/ack行为，不创建外部执行资源，不清理其他会话worktree，不改主检出。
规划状态仍由人拥有；本项不修改Status、blocked-by/blocking、Gate裁定、凭据或CI自动化。
技术债引用现有 `docs/exec-plan/tech-debt-tracker.md`；无产品实现就无新增实现债，relation父边与TD-005/TD-006不纳入本项。（Superseded by Decision Log 2026-10-03 22:44：实施后登记 TD-023。）

## Plan of Work

### Batch 0 · 双独立设计与最终边界（已完成）

最小闭环：一致错误结构、零写入/零BEGIN判据和明确队列适配；主文件为本计划与 `docs/README.md`。
独立reviewer统一两个设计的错误码，拒绝外部read→atomic两槽检查，采用已有机制的最小preflight复用。
索引仅紧跟storage-identity-membership条目新增本项，不移动Completed既有条目；状态写Active。Superseded by Decision Log「第一轮评审修订：索引行」（2026-10-04）：该锚点落在 `docs/README.md` 的 `### Completed` 表里；归档时删去原行，在 Completed 表顶部新增指向 `exec-plan/completed/` 的行。
本轮不改产品代码，不将已有Core通过用例算成本项新实现。

在本分支工作树根目录运行：

    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    git diff --check
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main

期望：文档契约/空白/披露/规模门通过；另用已安装ExecPlan技能运行 `lint_execplan.py`，逐项核本计划docs路径。
`rule-checks`只有disclosure/size，不存在doclinks；不要伪造验证命令或声称旧栈planfacts覆盖本计划全部链接。
回滚点：Batch 0干净工作树，仅撤销本轮文档，不触碰用户或其他会话改动。

### Batch 1 · typed父边拒绝与最小preflight（已完成）

最小闭环：两个实现直接Storage写得到一致失败；主文件为 `packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/src/storage-execution.ts`、`tests/contract/suites/storage-execution.js`。
共享契约先加well-formed未知项ready/failed/closed × root/tx矩阵，assert.rejects验证class和完整failure字段；旧Fake成功与SQLite裸异常都必须使它红。
把workItem分叉从divergence台账移为共享拒绝，不删除测试；repository/relation其余分歧仍按真实状态保留。
实现typed错误和两实现队列内父边检查，保持现有active-close+upsert原子单元。
测试同id合法context被未知父项替换时逐字段保持旧值；另有新ctx未知项时无新行；terminal也不能旁路。
先putEntity的Storage正控成功读回，不能用全部拒绝骗过负例。

本分支工作树根目录运行（新增集成文件创建后）：

    pnpm install --frozen-lockfile
    pnpm run typecheck
    node --test tests/contract/storage-contract.test.js tests/integration/storage-work-item-rejection.test.js
    pnpm run boundaries

期望：两Storage矩阵全绿，typed error相同；合法正控成功。拒绝语义测试必须非零，不靠TS缺接口编译失败作唯一红证据。
回滚点：Batch0文档提交；错误类/端口注释/两实现/台账与其测试同一能力提交整体回退。

### Batch 2 · 零BEGIN、回滚和现有Core外部闸门（已完成）

最小闭环：拒绝早于本方法写交易，且交易机制/既有Core有效路径保持；主文件为 `tests/integration/storage-work-item-rejection.test.js`（将新建）、`tests/integration/storage-restart.test.js`、`tests/contract/storage-contract.test.js`。Superseded by Decision Log（2026-10-03 22:22）（2026-10-04）：`tests/integration/storage-restart.test.js` 未改；集成文件已在 Batch 1 新建（Decision Log 2026-10-03 22:20），本批只往里加用例。
通过已有 `WorkspaceDatabase` exec/prepare包装计数，root未知父行检查零BEGIN、零mutating SQL；真实父存在正控至少一个BEGIN并成功。
scoped用例外层BEGIN只计一次，putExecutionContext无嵌套BEGIN；在tx先写可观测临时workspace再让typed拒绝逃出，重开时暂存行/ctx均不存在。
tx内部catch用例确认错误方法零mutation，随后独立合法写能按现有契约提交，不改变事务通用语义。
复跑现有closed/outer-instance/settled-tx/active替换用例，防止私有交易体复用破坏令牌与排队。
沿真实StartWork已有未知项守卫与有效正控，before/after branch/worktree/run计数不变、规划状态不变，不改Core生产代码。

在本分支工作树根目录运行：

    node --test tests/contract/storage-contract.test.js tests/integration/storage-work-item-rejection.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/storage-restart.test.js
    pnpm run typecheck
    pnpm run boundaries
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD
    git diff --numstat origin/main...HEAD

期望：typed结构、零BEGIN/DML、outer回滚、合法正控全绿；闭环所需交易生命周期回归通过；实际用户上限重新统计。
负对照分别删除Fake父检查、SQLitepreflight、把preflight移到BEGIN后；拒绝结构/零BEGIN测试分别变红，恢复后重跑同命令绿。
回滚点：Batch1已验证提交；如交易机制回归失败，回退整能力单元，不删除FK或绕开既有队列。

### 验收批 · 独立复核、外键钉住与文档同步（Opus 验收者，已完成）

最小闭环：在最终树上逐条复核 Design / Spec 与验收表，补回本项删掉的 `work_item_id` 外键钉住，按 `docs/product/vertical-path.md` §2.1 的规则同步第 6 行与 X1，登记 TD-023，整理提交；主文件为 `tests/integration/execution-relation-write-schema.test.js`、`packages/capabilities/src/storage.ts`（端口注释）、`docs/product/vertical-path.md`。

在本分支工作树根目录运行：

    node --test tests/contract/storage-contract.test.js tests/integration/storage-work-item-rejection.test.js tests/integration/start-work-sqlite-registration.test.js tests/integration/storage-restart.test.js tests/integration/execution-relation-write-schema.test.js
    pnpm verify
    pnpm run boundaries
    node scripts/workflow-check.mjs
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main
    git diff --check origin/main...HEAD

期望：第一条 244 pass / 0 fail；`pnpm verify` 退出 0；boundaries 8/8；workflow-check 无发现；disclosure 通过；size 代码 ≤800、文档 ≤1300；无空白错误。负对照在一次性克隆的最终树上逐条施加（打印变异行、跑第一条命令、还原后复绿），结果表见 Artifacts and Notes。
回滚点：验收批不改产品行为（一条 DDL 断言、一行端口注释、两处注释用词与文档），按文件回退即可。

### Concrete Steps

每批对齐 → 隔离 → 实现 → 最窄判别验证 → 记录 → 整理提交 → 汇报。
实施前核查目标realpath在 `.worktrees/storage-work-item-rejection` 内，检查git-dir/common-dir、status、worktree与ignore；不复用其他会话检出。
若#189已落主线，只消费新主线统一形状，不维护两份Storage协议；同一共享文件由一个owner串行整合。
提交保留可独立审阅能力+测试，不留debug/fixup；外部push前五类发布面扫描与numstat复核。
本轮只交draft计划；产品代码未验收不能ready、关闭issue或声称Gate E1通过。

## Validation and Acceptance

| 验收 | 证据 |
|---|---|
| well-formed未知父项同结果 | 两Storage共享assert.rejects class/name/operation/resource/failure六字段 |
| active与terminal一致 | ready/failed/closed × root/tx矩阵 |
| 新行不留、旧行不伤 | get无新ctx；合法旧context深相等；旧active未关闭 |
| SQLite根调用零交易 | wrapper观察BEGIN=0、DML=0，合法正控BEGIN非零 |
| scoped不嵌套且失败零写 | 外层只一个BEGIN，失败方法无DML |
| 未catch整笔回滚 | 临时先写行与ctx重开均不存在 |
| tx内catch保留原语义 | 错误方法无写，随后独立合法写可commit |
| Core未知项零外部写 | 既有StartWork两实现branch/worktree/run计数相等 |
| 有效工作仍能开始 | Storage正控与真实StartWork正控通过 |
| 不混淆其他失败 | closed等保持原错误，不统一伪装invalid_input |
| 机制回归与规模 | 原active/令牌/关闭套件，boundaries、真实diff ≤800/1300 |
| 外键最终防线仍被钉住 | execution-relation-write-schema「已钉住的约束变异」：裸 SQL 插入悬空 `work_item_id` 被外键拒绝；删 003 的 `REFERENCES entity (id)` 使它变红 |
| 纵向路径同步 | `docs/product/vertical-path.md` §2.1 第 6 行失败列与承接列、X1 标题、观察基线同 PR 更新，第 6 行引用逐条回读 |

### Artifacts and Notes

基线证据是两个设计独立内存探针：Fake accepted；SQLite Error / FOREIGN KEY constraint failed。这是缺陷，不是最终成功结果。
既有StartWork未知项测试通过来自 #188；最终报告必须区分“沿用零外部写入守卫”和“新Storage一致拒绝”。
关联只按GitHub事实回读，不把计划中的关闭关键字当权威。

    gh pr list -R SingularityKChen/harness-projects --head fix/storage-work-item-rejection --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences
    gh api graphql -f owner=SingularityKChen -f repo=harness-projects -F number=196 -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){state closedByPullRequestsReferences(first:100){nodes{number isDraft state baseRefName headRefName}}}}}'

创建后期望唯一draft、base main、精确head匹配；PR closingIssuesReferences与issue closedByPullRequestsReferences真实指向本项，issue开放。
若关联未解析，修正文案后重新回读；不能凭手工写下的关闭关键字宣称关联已成立。

验收证据（观察时刻 2026-10-03 22:50 CST；检出 `fix/storage-work-item-rejection` 的工作树根目录，base `main@68524a0`；最终 head 用 `git rev-parse fix/storage-work-item-rejection` 回读）：

| issue 验收 | 证据 |
|---|---|
| 共享契约对 `work-item-unregistered` 断言同一结果 | storage-contract「执行上下文：未登记工作项以同结构拒绝」在替身与 SQLite 上各一条，class / name / operation / resource / failure 全字段 |
| 未知工作项不触发外部写入 | 沿用 #188 的 start-work-sqlite-registration「工作项守卫」（两实现，branch / worktree / run 前后快照相等，含有效正控）；本项未改 Core |
| SQLite 不再向调用方暴露驱动文字 | 同一共享用例断言 message 不含 `FOREIGN KEY` / `ERR_SQLITE`；直接端口探针在两实现上都得到 `StorageInputError` 与同一 failure |

负对照（一次性克隆检出最终代码树，逐条单独施加，先打印变异行，再跑验收批第一条命令，然后还原；基线与还原后均为 244 pass / 0 fail）：

| # | 变异 | pass / fail | 变红的用例 |
|---|---|---|---|
| N1 | SQLite 不传 preflight | 239 / 5 | SQLite 共享拒绝与四条 SQLite 集成用例 |
| N2 | preflight 移到 BEGIN 之后 | 241 / 3 | SQLite 共享拒绝、零 BEGIN、拒绝后队列仍可用 |
| N3 | 删去替身的工作项检查 | 243 / 1 | 替身共享拒绝 |
| N4 | 作用域路径忽略 preflight | 241 / 3 | SQLite 共享拒绝、事务内未 catch、事务内 catch |
| N5 | 根 `atomic` 在队列槽外预检：`storage-sync.ts` 的根分支改为 `try { preflight?.() } catch (error) { return Promise.reject(error) }` 后再 `return this.#transact(async () => fn())`，即在调用时同步执行、在 `mutate` 之外 | 243 / 1 | 其他失败保持原身份（关闭文案）：变红靠的是关闭之后 `db.prepare` 打到已关闭的句柄，抛出驱动的 `database is not open` 而不是关闭文案，不是「同槽」被判别（2026-10-04 第一轮评审复跑） |
| N6 | 替身只对 active 状态检查 | 243 / 1 | 替身共享拒绝（终态旁路） |
| N7 | SQLite 把一切失败映射成 `StorageInputError` | 241 / 3 | 其他失败保持原身份、SQLite 仓库分叉格、重启「外键失败时旧 active 不得被关闭」 |
| N8 | 替身要求 `kind === 'work_item'` | 243 / 1 | 替身共享拒绝（非 work_item 正控） |
| N9 | SQLite 预检加 `AND kind = 'work_item'` | 243 / 1 | SQLite 共享拒绝（非 work_item 正控） |
| N10 | 删去 003 里 `work_item_id` 的 `REFERENCES entity (id)` | 243 / 1 | execution-relation-write-schema「已钉住的约束变异」（验收补入；补入前该变异全量 1094 全绿） |
| N11 | 错误码改为 `not_found` | 242 / 2 | 两个实现的共享拒绝 |
| N12 | `#transact` 失败时不 ROLLBACK | 221 / 23 | 地基、同步、执行组的事务回滚用例，重启用例与 SQLite StartWork 的回滚用例 |

「同槽」没有被测试钉住（2026-10-04 第一轮评审复跑，检出 `fix/storage-work-item-rejection` 的工作树根目录，head `fb7c1f7`）：被拒绝的两槽方案 D 写成 `storage-execution.ts` 的 `return this.read(preflight).then(() => this.atomic(() => { … }))`（preflight 一个队列槽、写体另一个槽，先打印变异行再跑），验收批第一条命令 244 pass / 0 fail，全部存活。原因是端口没有删除实体的方法，两槽之间的检查—写入窗口经端口观察不到。所以 N5 证明的只是「预检在关闭检查之后」，「同槽」只由 Design / Spec 的设计论证支撑，没有被测试钉住。还原后 `git diff --quiet`，基线回到 244 / 0。

## Progress

- [x] (2026-10-03 21:34 CST) Batch0：两独立设计、第三方代码审查、最终spec与唯一文件集收敛。
- [x] (2026-10-03 21:34 CST) 独立spec审查pass：统一invalid_input/none、同槽preflight、保留Core既有守卫与FK。
- [x] (2026-10-03 21:52 CST) reviewer实跑 lint_execplan.py：OK；另核13章固定顺序、docs引用/索引存在性及相对路径，均pass。
- [x] (2026-10-03 21:56 CST) Batch 0 文档门：linter通过，文档契约9/9、计划与索引路径、暂存区披露/体量和空白检查通过；产品验收未执行。
- [x] (2026-10-03 22:20 CST) Batch1：typed父边拒绝与共享红绿证据。
  RED：`node --test tests/contract/storage-contract.test.js` 新用例“执行上下文：未登记工作项以同结构拒绝”在替身为 `Missing expected rejection (rejection): ready：根调用`，在 SQLite 为 `必须是 StorageInputError，实际：Error: FOREIGN KEY constraint failed`（类已存根，非编译错误）；
  GREEN：同命令 134 pass / 0 fail（契约 132 + 集成 2），`pnpm run typecheck` exit 0，`pnpm run boundaries` 8/8，全量 `node --test tests/contract tests/integration tests/e2e` 1089 pass / 0 fail；
  负对照（WIP 提交后逐个变异，打印变异行，恢复后复绿）：删替身检查 → 替身共享用例红；删 SQLite preflight → SQLite 共享用例与“队列仍可用”红；替身检查只对 active → 共享用例红（终态旁路）；SQLite 改为 try/catch 全映射 → “其他失败保持原身份”与仓库分叉格红；
  规模：`node scripts/rule-checks.mjs size origin/main` 代码 182（预算 ≤800）、文档 273（预算 ≤1300）。
- [x] (2026-10-03 22:22 CST) Batch2：零BEGIN/DML、回滚与合法正控（实现者验证；远端验收与回读未做）。
  新增三条 SQLite 集成用例（计数包装包真实 `WorkspaceDatabase`，播种后清零）：根调用未登记项 BEGIN=0/DML=0 且合法正控 BEGIN=1；事务内未 catch 外层仅一个 BEGIN、失败方法 DML 增量 0、重开后暂存工作区与上下文均不存在；事务内 catch 后失败方法零写、随后合法写与暂存写随提交生效；
  验证：计划命令 `node --test` 四个文件 232 pass / 0 fail，`pnpm run typecheck` exit 0，`pnpm run boundaries` 8/8，全量 `tests/contract tests/integration tests/e2e` 1094 pass / 0 fail，`tests/mvp0` 7/7，`workflow-check` 无发现；
  负对照（WIP 提交后变异，打印变异行，恢复后复绿）：N1 删 SQLite preflight → 共享用例与四条集成用例红；N2 preflight 移到 BEGIN 之后 → 共享用例、零 BEGIN 用例、队列用例红；N3 删替身检查 → 替身共享用例红；N4 作用域路径忽略 preflight → 共享用例与两条事务内用例红；N5 根 atomic 在槽外预检 → “其他失败保持原身份”（关闭文案）红；
  Core 外部闸门：沿用既有 `start-work-sqlite-registration.test.js` 的“工作项守卫”用例（两实现，`world` 快照含 branch/worktree/run 计数，含有效正控）全绿，Core 生产代码零改动——这是沿用的守卫，不是本项新增证据；
  规模：`node scripts/rule-checks.mjs size origin/main` 代码 261（预算 ≤800）、文档 286（预算 ≤1300）。
- [x] (2026-10-03 22:41 CST) 修复轮1（verify-r1 F1，P2：父边“不看 kind”无测试钉住）：已复现并修复，实现代码零改动。
  复现：对 83b1bb7 变异 M10（替身检查加 `entity.kind === 'work_item'`）、M11（SQLite preflight 加 `AND kind = 'work_item'`）、M17（`AND kind <> 'repository'`），共享套件均 132 pass / 0 fail——三个变异全部存活；
  修复：共享拒绝用例加正控：`workItemId` 取已登记的非 work_item 实体 `repo-entity-1`，两实现都必须接受并逐字段读回；
  变异复测（打印变异行、恢复后复绿）：M10 → 替身“执行上下文：未登记工作项以同结构拒绝”红（131 pass / 1 fail）；M11 与 M17 → SQLite 同名用例红（各 131 pass / 1 fail）；恢复后 132 pass / 0 fail（契约 132；加集成 2 共 137 pass，`tests/contract tests/integration tests/e2e` 1094 pass / 0 fail）；
  `pnpm run typecheck` exit 0，`pnpm run boundaries` 8/8，`workflow-check` 无发现；规模：`node scripts/rule-checks.mjs size origin/main` 代码 265（预算 ≤800）、文档 295（预算 ≤1300）。
- [x] (2026-10-03 22:50 CST) 验收批（Opus 验收者）：独立复核 diff、Design / Spec 与验收表；补回 `work_item_id` 外键的判别用例，同步纵向路径、索引与 TD-023，整理提交（见 Decision Log 2026-10-03 22:44 各条）。
  验证（检出 `fix/storage-work-item-rejection` 的工作树根目录）：验收批第一条命令 244 pass / 0 fail；`pnpm verify` 退出 0（`tests/contract tests/integration tests/e2e` 1094 pass / 0 fail，`tests/mvp0` 7 / 7）；`pnpm run boundaries` 8/8；`workflow-check` 无发现；文档契约 9/9；`lint_execplan.py` OK；disclosure 通过；`git diff --check origin/main...HEAD` 无输出；规模 代码 268 / 文档 367（观察时刻 2026-10-03 22:50，回读 `node scripts/rule-checks.mjs size origin/main`）。
  纵向路径：§2.1 第 6 行九条引用按回读命令逐条回读（各 ✔、`ℹ fail 0`，伪造前缀 `ℹ tests 0`），X1 重跑 3 次观察值不变。
  负对照：12 条在一次性克隆的最终代码树上全部变红（表见 Artifacts and Notes），还原后 244 / 0。
  整理：`a924850` 之后整理为三个提交；`comm -3` 比对整理前锚点与整理后的文件集合，只多出验收补入的三个文件（`docs/exec-plan/tech-debt-tracker.md`、`docs/product/vertical-path.md`、`tests/integration/execution-relation-write-schema.test.js`）；两个代码提交各自全量绿（1091 / 1094）。
- [x] (2026-10-04) 第一轮 MVP 评审修订（评审在 `fb7c1f7` 上 APPROVE，5 条 P3 全部属实）：`StorageInputError` 注释收窄、TD-023 补 core 压平；「当前位置」「未做」与 Batch 2 主文件原处 Superseded；N5 写明变异形态；暴露面论据改写；索引行随归档移到 Completed 表。处置见 Decision Log 2026-10-04 各条。
  复跑（检出 `fix/storage-work-item-rejection` 的工作树根目录，head `fb7c1f7`，每次先打印变异行、跑完 `git checkout --` 还原并确认 `git diff --quiet`）：N5（`storage-sync.ts` 根分支 `try { preflight?.() } catch (error) { return Promise.reject(error) }` 后 `return this.#transact(async () => fn())`）→ 验收批第一条命令 243 pass / 1 fail，唯一红的是「其他失败保持原身份」，实际报错 `database is not open`；两槽方案 D（`storage-execution.ts` 的 `return this.read(preflight).then(() => this.atomic(() => { … }))`）→ 244 pass / 0 fail，存活；基线 244 / 0。
  本轮只改注释与文档，没有新增或加强测试，因此没有新的「有牙」变异要求。
- [x] (2026-10-04) 归档：计划移入 `docs/exec-plan/completed/`；`docs/README.md` 删去原行、在 `### Completed` 表顶部新增一行；TD-023 的 ExecPlan 列改指 `completed/`。
  最终验证（检出 `fix/storage-work-item-rejection` 的工作树根目录，观察时刻 2026-10-04，最终 head 用 `git rev-parse fix/storage-work-item-rejection` 回读）：`pnpm verify` 退出 0（typecheck 通过，`tests/contract tests/integration tests/e2e` 1094 pass / 0 fail，`tests/mvp0` 7 / 7）；验收批第一条命令 244 / 0；`pnpm run boundaries` 8 / 8；`node scripts/workflow-check.mjs` 无发现（8 个文件）；文档契约 9 / 9；disclosure、size 与 `git diff --check origin/main...HEAD` 的读数见 Outcomes「规模」。
- [ ] 合并后回读（人类合并之后）：`gh pr view 265 -R SingularityKChen/harness-projects --json state,mergedAt` 期望 `state=MERGED`；`gh issue view 196 -R SingularityKChen/harness-projects --json state,closedByPullRequestsReferences` 期望 `CLOSED` 且引用 #265；拉取后 `git ls-tree --name-only origin/main docs/exec-plan/completed/2026-10-03-storage-work-item-rejection.md` 期望输出该路径，`git grep -n 'exec-plan/active/2026-10-03-storage-work-item-rejection' origin/main -- docs/README.md docs/exec-plan/tech-debt-tracker.md` 期望无输出。

## Surprises & Discoveries

StartWork已经在任何外部写前拒未知项；本issue当前缺口在directStorage，不应重复实施 #188。
共享套件绿色固定了Fake接受/SQLiteFK的分歧；台账必须改为共有拒绝而不是删该反例。
两设计错误码不同；domain NotFound的open_provider不适合本地父边缺失，最终统一invalid_input/none。
SQLite atomic原来根调用直接开transaction；为满足issue“交易前拒绝”，需要窄preflight与单一交易体，不需要全Storage重构。
实现中确认：全仓既有调用方（core StartWork 与各集成用例）写上下文前都已登记工作项，替身加父边检查后全量 1094 个用例无需改任何调用方；唯一需补 fixture 的是 `storage-contract.test.js` 里一条直接写上下文的替身专属用例。
把 preflight 移到 BEGIN 之后时，拒绝仍是同一个 typed 错误，只有 BEGIN 计数与队列用例能发现——零 BEGIN 判别是必要的，仅断言错误结构不够。
修复轮1：此前“只验证实体存在、不限定 kind”只写在 Decision Log，所有夹具工作项都是 work_item，把检查收紧到 kind 的三个变异（M10/M11/M17）在共享套件下全部存活；决策必须有判别测试才算被钉住。
验收复核：把 SQLite 分叉格“执行上下文 → 工作项”移入共享拒绝后，`execution_context.work_item_id` 外键失去了唯一的判别用例。在实现者最终提交上删去 003 的 `REFERENCES entity (id)`，`node --test tests/contract tests/integration tests/e2e` 仍 1094 pass / 0 fail；同一变异在 `main@68524a0` 上被该分叉格抓红（1088 pass / 1 fail）。preflight 先于外键拒绝，端口层的任何用例都碰不到外键，所以 Design / Spec 的“保留FK作最终防线”此前只是声明。
验收复核：`docs/product/vertical-path.md` §2.1 规定“关闭本节引用的 issue 的 PR，必须在同一 PR 里更新对应行与这个基线”，第 6 行与 X1 都写着 #196 的分歧仍在；计划文件集没有列这个文件，verify 轮把它当作可推迟的 P3。
第一轮评审：负对照 N5 变红靠的是关闭之后打到已关闭句柄的驱动报错，不是「同槽」；被拒绝的两槽方案 D 在验收批第一条命令下 244 / 0 全部存活（复跑见 Artifacts and Notes 负对照表后的段落）。端口没有删除实体的方法，检查—写入窗口经端口观察不到，「同槽」只能由设计论证支撑。
第一轮评审：`StorageInputError.failure` 没有任何生产调用方消费。`packages/core/src/start-work.ts` 的认领 catch 把新请求的任何认领失败改写成 `unavailable / retry`；该路径目前被 `prepareRegistration` 的 `not_found` 守卫挡住，评审在去掉守卫后复现了这次压平（替身与 SQLite 都是 `unavailable / retry / true`，外部写入 `[0,0,0]`）。

## Decision Log

Decision：人类已在Project将 #189/#196/#178 规划启动为In Progress，并将 #178 提前到迭代4；保留新的规划。Rationale：2026-10-03人类明确确认该调整；agent只同步PR迭代索引，不代写Status或blocking。Date/Author：2026-10-03 22:08 CST / 人类伙伴。

Decision：Promise<void>保持，StorageInputError携带唯一failure结构。Rationale：异常仍让现有transaction回滚，避免Result忽略导致半提交。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：只验证实体存在，不加kind/workspaceProjection约束。Rationale：匹配现行FK父边，Core负责可操作项。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：same队列槽内preflight，复用一个私有交易体。Rationale：零BEGIN且不引入外部读→写窗口，保护令牌/关闭语义。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：draft/标签/milestone/Project分类与ExecPlan/Batch复制现有Priority/Size/Iteration有授权；Status/blocking无授权。Rationale：机械索引不代替人规划。Date/Author：2026-10-03 21:34 CST / 用户明确范围。

Decision：工作项检查在替身与 SQLite 都放在 `putExecutionContext` 的最先一步（早于工作区、仓库外键与状态枚举）。Rationale：SQLite 的 preflight 必须早于自己的 BEGIN，因此先于其余驱动级拒绝；替身同序，多缺陷输入才得到同一个失败，两实现不因检查先后分叉。Date/Author：2026-10-03 22:20 CST / Sonnet implementer。
Decision：`StorageInputError` 用私有构造函数加唯一静态工厂 `unregisteredWorkItem()`，不开放通用 `(operation, resource, failure)` 构造。Rationale：本项只承诺一种已知输入拒绝，两实现共用一个构造点，文案与字段不会漂移；出现第二种时再泛化。Date/Author：2026-10-03 22:20 CST / Sonnet implementer。
Decision：不修改 `packages/capabilities/src/index.ts`（Global Constraints 里的导出行未使用）：`index.ts` 已 `export * from './storage.ts'`，类自动导出。Rationale：删除无需的编辑面。Date/Author：2026-10-03 22:20 CST / Sonnet implementer。
Decision：工作项分叉格从 `storageExecutionDivergenceSuite` 移入共享执行组的新用例，分叉台账由三格改为两格（仓库已对齐、关系端点仍分叉），能力位删去 `workItem` 键，台账计数 `CASE_LEDGER.execution.added` 12→13、`ADDED_CASE_COUNT` 19→20。Rationale：绿色分叉用例只固定旧差异；共享用例才证明一致。未删除任何既有断言。Date/Author：2026-10-03 22:20 CST / Sonnet implementer。
Decision：Batch 1 就创建 `tests/integration/storage-work-item-rejection.test.js`，放入“其他失败保持原身份（含 closed）”与“拒绝后队列仍可用”两条；零 BEGIN 与回滚用例留给 Batch 2。Rationale：Batch 1 验证命令引用该文件，且这两条是总 catch / 吞队列变异的判别点。Date/Author：2026-10-03 22:20 CST / Sonnet implementer。

Decision：Core 外部闸门证据只引用既有 StartWork 守卫用例，不在本项重复新增；`tests/integration/storage-restart.test.js` 无需拒绝 fixture，未修改。Rationale：既有用例已覆盖两实现 × 未知项 × 前后 `world` 快照与有效正控；重复只会加行数。Date/Author：2026-10-03 22:22 CST / Sonnet implementer。
Decision：零 BEGIN 观察用包住真实 `WorkspaceDatabase` 的测试侧计数包装构造 `SqliteStorage`（包已导出 `SqliteStorage`、`migrate`、`openDatabase`），不加产品故障开关。Rationale：计划硬性要求；与既有 `injectAfterWrite` 同属测试侧注入。Date/Author：2026-10-03 22:22 CST / Sonnet implementer。
Decision：用共享拒绝用例里的非 work_item 正控（`workItemId='repo-entity-1'` 被两实现接受并读回）钉住“父边不看 kind”，不另开用例、不改实现。Rationale：不看 kind 是端口契约（可操作项策略归 Core），收紧到 kind 会让 Storage 偷带 Core 策略；正控与既有拒绝矩阵共用播种，仅增 5 行；M10/M11/M17 三个变异均由它变红。Date/Author：2026-10-03 22:41 CST / Sonnet implementer（修复轮1，F1 已复现）。

Decision：在 `tests/integration/execution-relation-write-schema.test.js`「已钉住的约束变异」加一条裸 SQL 断言，钉住 `execution_context.work_item_id → entity(id)` 外键，不在端口层补用例。Rationale：证据见 Surprises「验收复核」第一条。端口没有删除实体的方法，外键只能经裸 SQL 触发，DDL 用例是唯一能判别它的层；该用例本来就是“每条拒绝只因目标约束失败”的收口点。判错的代价：多一行断言，产品零改动。Date/Author：2026-10-03 22:44 CST / Opus acceptor。
Decision：本 PR 同步 `docs/product/vertical-path.md`：§2.1 第 6 行失败列的 Storage 残余改写为已对齐并附旁证引用，承接列去掉 #196，简称表补 `storage-contract`，X1 标题与观察基线句随之更新；文件集在 Global Constraints 就地补入。Rationale：该节的同 PR 更新规则适用，`gh pr view 265 -R SingularityKChen/harness-projects --json closingIssuesReferences` 在 2026-10-03 22:44 回读为 `[196]`；不改就是在 main 上留下与代码相反的产品事实（verify-r1 F4 定为 P3，验收者上调为本 PR 必做）。直接调用 Storage 按该节规则只算旁证，第 6 行结论“反例：#194（P4）”不变。判错的代价：文档多改 4 处。Date/Author：2026-10-03 22:44 CST / Opus acceptor。
Decision：登记 TD-023（执行上下文的其余已知输入缺陷仍是裸异常，两个实现的文案不同），本项不泛化 `StorageInputError`。Rationale：issue 验收只要求未登记工作项一条；按“出现第二种时再泛化”的既有决策延期，但延期要进 `docs/exec-plan/tech-debt-tracker.md`，不能只留在 Decision Log。判错的代价：tracker 多一行。Date/Author：2026-10-03 22:44 CST / Opus acceptor。
Decision：端口 `putExecutionContext` 声明处补一行拒绝契约（与 #195 在 `putExternalIdentity` 处写 `RangeError` 同一写法）；`StorageInputError` 注释去掉仓库里不存在的类型名 `StorageResult`；`storage-sync.ts` 两处“交易”改成全仓统一的“事务”。Rationale：调用方读的是端口声明；注释不引用不存在的类型。行为不变。Date/Author：2026-10-03 22:44 CST / Opus acceptor。
Decision：实现形态原样接受，不做结构重构。Rationale：复核未发现死代码或重复。`#transact` 是 `transaction` 与根 `atomic` 唯一共用的事务体；`preflight` 只有一个调用点，但它正是零 BEGIN 判据需要的最小表面；类的字段写法与 `LegacySourceVersionError` 是同一惯用法。verify-r1 的两条观察不改：根 `atomic` 不再经过公有 `transaction()`，但全仓没有子类覆写 `transaction`（Superseded by Decision Log「第一轮评审修订：根 `atomic` 绕开公有 `transaction()` 的真实暴露面」（2026-10-04）：论据换成实例属性替换的暴露面）；替身“事务内未 catch 回滚”没进共享套件，由替身既有事务用例与 verify-r1 探针兜底。Date/Author：2026-10-03 22:44 CST / Opus acceptor。
Decision：verify 轮余项的处置：F2（`{T}` 占位）已在修复轮1补成实际时间，验收时 `grep -n '{T}'` 只命中 Change Note 里的叙述字样，不再改；F3 索引行状态改为“Active；实施与验收完成，待人类评审”，摘要改写成实现后的事实；F5 整理后的提交由验收者重建，尾注按宿主会话要求统一为 `Co-Authored-By: Claude Opus 5.5`，实现者（Sonnet）与验收者（Opus）的分工以本 Decision Log 的 Author 字段为准。Rationale：提交尾注表示产出提交的会话，整理后的每个提交都由验收会话写成；模型分工的权威记录在计划。Date/Author：2026-10-03 22:44 CST / Opus acceptor。
Decision：`a924850` 之后的三个提交（Batch 1、Batch 2、修复轮1）与验收改动整理为三个提交：能力与共享契约（含 kind 正控与端口注释）；零 BEGIN、回滚与外键钉住的判别用例；文档（本计划、索引、纵向路径、TD-023）。`a924850` 及更早的已推送提交不改写。Rationale：每个提交可独立审阅与回滚；修复轮1的正控属于共享拒绝用例本身，不单列 fixup。恢复锚点为本地分支 `backup/storage-work-item-rejection-pre-curate`（实现者最终提交）。Date/Author：2026-10-03 22:44 CST / Opus acceptor。

Decision：第一轮评审修订：`StorageInputError` 的类注释收窄为「Storage 端口调用方可见」，并写明 core 认领目前压平它（TD-023）；TD-023 的简述补上 core 压平的现状，下一步补「泛化 `resource` 时让 core 认领 catch 透传 `error.failure`」；本 PR 不改 Core。Rationale：意见属实，证据见 Surprises「第一轮评审」第二条；该路径目前不可达，改 Core 超出 #196 范围（Global Constraints：不修改 Core 身份 / 登记 / ack 行为），但下一个泛化 `resource` 的人必须知道 core 侧还差一处透传。判错的代价：注释与 tracker 各多一句。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：第一轮评审修订：Interfaces and Dependencies「当前位置」与 Outcomes「未做」两句原处标注 Superseded，远端状态改成回读规则 `gh pr view 265 -R SingularityKChen/harness-projects --json headRefOid,isDraft,body`；Batch 2 的主文件句原处标注 Superseded。Rationale：意见属实，2026-10-04 回读时远端 head 已是 `fb7c1f7`、PR 描述已含验收证据，与「尚未 push」相反；`PLANS.md` §4 要求易失状态写成回读命令加期望，被推翻的结论就地标注。判错的代价：无，只改文档。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：第一轮评审修订：负对照 N5 写明确切变异形态与变红原因，并补上「两槽方案 D 经端口不可判别」，不为「同槽」新增测试。Rationale：意见属实，复跑见 Artifacts and Notes 负对照表后的段落。要判别两槽，只能加测试专用钩子，或在检查与写入之间用另一个连接裸 SQL 删行；Design / Spec 已把跨连接裸 SQL 删除排除在本项之外。判错的代价：将来有人把预检改回两槽，测试不会报警；`work_item_id` 外键仍是最终防线（N10 钉住）。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：第一轮评审修订：根 `atomic` 绕开公有 `transaction()` 的真实暴露面。2026-10-03 22:44「实现形态原样接受」的结论不变，论据换成实例属性替换。Rationale：会受影响的是在实例上替换 `storage.transaction` 的包装器，不是子类覆写。仓库里这样的替换共三处，回读命令为 `git grep -n -E '\.transaction[[:space:]]*=[^=]' -- tests packages apps scripts`。`tests/integration/start-work-sqlite-registration.test.js` 的 `injectAfterWrite` 与 `dropRelation` 作用在 SQLite 实例上，但只给 `tx` 套 Proxy，拦截的是 `tx.*` 方法；根 `atomic` 的写体只用 `this.db`，从不使用 `tx`。所以 base 上经过包装的那几次根 `atomic` 本来也没被它们观察到，现有断言没有静默失效。评审实测：同一实例上一次成功的 `startWork`，base 经过包装 5 次，head 2 次。`tests/e2e/start-work.test.js` 的 `pauseFirstTransaction` 作用于替身，不受影响。`tests/integration/provider-binding-registration.test.js` 的 `probe` 用 `wrap` 包的是外层对象，内部的 `this.transaction` 本来就不经过它。生产代码（`packages/`、`apps/`）里没有替换 `transaction` 的地方。判错的代价：将来新增的实例级 `transaction` 包装器看不到根 `atomic` 写入，需要改为包 `tx` 或直接计数 `WorkspaceDatabase`。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。
Decision：第一轮评审修订：索引行。本计划随第一轮评审修订在本 PR 内归档，不再等合并后由单独的 docs PR 归档：`docs/README.md` 删去本 PR 原先插在 `### Completed` 表里、指向 `active/` 的那一行，在 Completed 表顶部（该表按日期新到旧）新增一行指向 `exec-plan/completed/`；Batch 0 的锚点句原处标注 Superseded。Rationale：意见属实，原行链接 `active/`、状态写 Active，却放在 Completed 分区，按分区读索引的人会把评审中的计划当成已完成；评审已 APPROVE、只剩 P3，修完即满足 `PLANS.md` §2 的归档条件，归档同时消掉了「合并后再挪一次」。合并后才能观察的事项留在 Progress 的未勾选项里。判错的代价：若合并前又出现阻塞性意见，需要把计划移回 `active/` 并恢复索引行。Date/Author：2026-10-04 / 第一轮评审修订（主控授权）。

## Idempotence and Recovery

拒绝不是提交成功；相同未知输入重复得到同typed failure且零写。父行显式登记后再试可成功，不自动补实体骗过完整性。
根预检失败没有自己的交易；scoped异常未catch时外层统一回滚，catch时失败方法仍零mutation。
测试临时库按fixture重建，不自动删除用户数据；回退代码不碰外部资源，因为本项不创建branch/worktree/run。
外部actor `SingularityKChen`，target公开repo `SingularityKChen/harness-projects` 和Project10；逻辑重试键 `196+fix/storage-work-item-rejection`。
read-before-create：先检索同branch开放PR/同issue Project item，存在则更新；不是GitHub API幂等保证。
未知网络结果先回读，记录actor/target/请求/结果与确认；不盲重发创建、不伪造Engineering=PR open。
Git共享历史改写须backup ref与专家流程；此文档阶段不合并、不清理其他检出。

## Interfaces and Dependencies

公开新增仅窄错误类，Storage方法签名不变；SQLite内部atomic可选preflight不是新publicStorage端口。
Node/pnpm/Git/gh足够；产品测试使用Fake/临时SQLite，不需要真实Provider授权。
#189/#196共享区串行集成是编辑安全规则，不是blocking关系或发布依赖。临时组合检出可验证两种整合顺序，不能推成伪stack。
Next gate：Batch0文档门→draft交付；实施从共享红例与队列观察开始；真实产品验收后才考虑ready，合并由人决定。当前位置（2026-10-03 22:50 验收后）：等待人类评审；整理后的提交尚未 push，PR 描述更新与远端回读在评审批准后进行。Superseded by 本行回读规则（2026-10-04）：上句只是 2026-10-03 22:50 的本地观察，远端状态不写成正文事实，一律回读 `gh pr view 265 -R SingularityKChen/harness-projects --json headRefOid,isDraft,body`，期望 `headRefOid` 等于 `git rev-parse fix/storage-work-item-rejection`、`body` 含本计划的验收证据与 `Closes #196`；是否 draft、是否合并以同一回读为准（2026-10-04 第一轮评审时远端 head 已是 `fb7c1f7`，PR 描述已含验收证据）。
有关#199 producer失败、#218客户端竞争与既有tracker债务均独立，不能以本项失败类复用为由关闭它们。

## Outcomes & Retrospective

结果：直接向 Storage 写执行上下文、引用未登记工作项时，替身与 SQLite 以同一个 `StorageInputError`（`invalid_input`、恢复 `none`、`retryable=false`）拒绝；SQLite 的预检在同一队列槽、早于自己的 `BEGIN`，失败方法零写入；事务内未 catch 时整笔回滚，catch 后事务语义不变；`work_item_id` 外键作为最终防线由 DDL 用例单独钉住。issue 三条验收都有证据，其中“未知工作项零外部写入”沿用 #188 的 StartWork 守卫，不是本项新增。
与计划的偏差：`packages/capabilities/src/index.ts` 与 `tests/integration/storage-restart.test.js` 未改；验收补入 `tests/integration/execution-relation-write-schema.test.js`、`docs/product/vertical-path.md` 与 `docs/exec-plan/tech-debt-tracker.md`（Global Constraints 已就地标注）；Batch 2 的三条集成用例写在实现之后，判别力由负对照 N1、N2、N4 证明。
规模：代码 268 / 800、文档 367 / 1300（观察时刻 2026-10-03 22:50）。
债务：新增 TD-023（执行上下文的其余已知输入缺陷仍是裸异常）；关系端点的分叉仍由 #221 承载。
未做：push、PR 描述更新、远端回读与 ready，等人类评审；本项不批准 Gate E1；合并后由单独的 docs PR 把本计划移入 `docs/exec-plan/completed/`。Superseded by Interfaces and Dependencies「当前位置」的回读规则（2026-10-04）：push 与 PR 描述状态以 `gh pr view 265 -R SingularityKChen/harness-projects --json headRefOid,isDraft,body` 回读为准；归档已随第一轮评审修订在本 PR 内完成（Decision Log「第一轮评审修订：索引行」）。
复盘：把分叉格移入共享拒绝时，只看了它“证明分歧”的作用，没看它同时是 `work_item_id` 外键唯一的判别用例；预检先于外键之后，这道“最终防线”在端口层就再也碰不到。两轮对抗验证的变异表都只围着新代码，没有变异被移走的旧约束。以后删除或移动用例前，先对它覆盖的约束做一次“删约束、看谁变红”。
第一轮评审修订（2026-10-04）：5 条 P3 全部属实，都是注释与文档的自述问题，产品行为与测试零改动。`StorageInputError.failure` 目前只对 Storage 端口的直接调用方可见，core 认领会把它压平（不可达，TD-023）；「同槽」预检由设计论证支撑，两槽方案 D 经端口不可判别，N5 只证明预检在关闭检查之后。
规模（归档后）：代码 269 / 800、文档 390 / 1300（观察时刻 2026-10-04，base `main@68524a0`，归档提交后的树；重算 `node scripts/rule-checks.mjs size origin/main`）；disclosure 通过，`git diff --check origin/main...HEAD` 无输出。
复盘（第一轮评审）：负对照表只记了「红了几条」，没有记「为什么红」，于是 N5 被读成「同槽已被钉住」。变异表每一行都应写清确切形态与变红的机制，对不可判别的被拒绝方案也跑一次并如实记为存活。

## Bottom Change Note

Change Note (2026-10-03 21:34 CST)：独立reviewer裁定两个设计的错误码/交易前检查冲突，补零BEGIN与scoped语义、合法正控、driver边界和真实关联回读；产品实施pending。
Change Note (2026-10-03 21:52 CST)：补确切Batch主路径与typed字段判据，独立linter和结构/路径检查已通过；全仓文档门由主执行者继续落账。

Change Note (2026-10-03 21:56 CST)：主执行者全文复核并运行文档契约与独立路径/暂存扫描，记录Batch 0文档门；后续产品批次保持pending。

Change Note (2026-10-03 22:08 CST)：记录人类在Project上的规划启动与#178重排期确认；保留原调查调度快照并明确取代，产品实施仍pending。

Change Note (2026-10-03 22:20 CST)：Batch 1 完成：`StorageInputError`、替身与 SQLite 的队列内工作项父边检查、`atomic(fn, preflight?)` 与 `transaction` 共用私有 `#transact`、共享拒绝矩阵与台账同步；Batch 2 的零 BEGIN、回滚与 Core 外部闸门待做。

Change Note (2026-10-03 22:22 CST)：Batch 2 实现者验证完成：计数包装的零 BEGIN/DML、事务内未 catch 回滚与 catch 保留语义三条集成用例，五个负对照，沿用既有 Core 外部闸门用例；远端验收与人类评审待做。

Change Note (2026-10-03 22:41 CST)：修复轮1：verify-r1 F1 属实，共享拒绝用例补“已登记非 work_item 实体被接受”正控，kind 收紧的三个变异由存活转为变红；顺带把 Decision Log 两处 `{T}` 占位时间戳补成实际时间；实现代码零改动。

Change Note (2026-10-03 22:50 CST)：Opus 验收：补 `work_item_id` 外键的 DDL 钉住、端口 `putExecutionContext` 的拒绝注释与“事务”用词统一；按 `docs/product/vertical-path.md` §2.1 规则同步第 6 行、X1 与基线；登记 TD-023；Global Constraints 就地补文件集；记录 issue 验收对照、负对照表与提交整理；状态改为实施与验收完成，待人类评审。

Change Note (2026-10-04)：第一轮 MVP 评审修订（5 条 P3）：`StorageInputError` 注释收窄并在 TD-023 记下 core 压平；「当前位置」「未做」与 Batch 2 主文件原处标注 Superseded，远端状态改成回读规则；N5 写明变异形态，补两槽方案 D 244 / 0 存活的复跑；根 `atomic` 绕开 `transaction()` 的论据换成实例属性替换的暴露面。

Change Note (2026-10-04)：归档：状态改为 Completed，计划移入 `docs/exec-plan/completed/`，索引行移到 Completed 表，TD-023 链接同步；Progress 补第一轮评审修订、归档与最终验证，合并后回读留作未勾选项；Decision Log 补索引行处置；Outcomes 补第一轮评审结果与复盘。
