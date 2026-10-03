# 未登记工作项的 Storage 结构化拒绝 ExecPlan

> 状态：Active；本轮仅完成 Batch 0，产品实施尚未开始。
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
| 端口 / 导出 | `packages/capabilities/src/storage.ts`；`packages/capabilities/src/index.ts` |
| 实现 | `packages/providers/fake/src/storage.ts`；`packages/storage/sqlite/src/storage-execution.ts`；`packages/storage/sqlite/src/storage-sync.ts` |
| 契约 / 台账 | `tests/contract/suites/storage-execution.js`；`tests/contract/suites/storage.js`；`tests/contract/storage-contract.test.js` |
| 集成 | `tests/integration/storage-work-item-rejection.test.js`（将新建）；`tests/integration/storage-restart.test.js`（仅必要拒绝fixture） |
| 文档 | 本计划；`docs/README.md` |

代码增删合计≤800、文档≤1300，含测试和fixtures，排除锁文件/生成目录。
预算区间：错误契约与两实现约80–130；最小交易体复用约50–90；测试/台账/fixture约150–230；代码总计约280–450。文档约280–380行。
交易机制调整超过约100行或总code预计超过600时先审context radius；若最终将超800，停止扩大协议，重新划独立闭环，不能删零BEGIN判别。
不改schema或添加迁移；没有真实用户/数据，不建立历史库兼容、双读/双写、旧数据升级路径。
#189/#196共享Storage端口/Fake/同步机制文件由一个集成owner串行落地；其他区域可并行调查，不因此建立Git stack。
不修改Core身份/登记/ack行为，不创建外部执行资源，不清理其他会话worktree，不改主检出。
规划状态仍由人拥有；本项不修改Status、blocked-by/blocking、Gate裁定、凭据或CI自动化。
技术债引用现有 `docs/exec-plan/tech-debt-tracker.md`；无产品实现就无新增实现债，relation父边与TD-005/TD-006不纳入本项。

## Plan of Work

### Batch 0 · 双独立设计与最终边界（本轮）

最小闭环：一致错误结构、零写入/零BEGIN判据和明确队列适配；主文件为本计划与 `docs/README.md`。
独立reviewer统一两个设计的错误码，拒绝外部read→atomic两槽检查，采用已有机制的最小preflight复用。
索引仅紧跟storage-identity-membership条目新增本项，不移动Completed既有条目；状态写Active。
本轮不改产品代码，不将已有Core通过用例算成本项新实现。

在本分支工作树根目录运行：

    node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js
    git diff --check
    node scripts/rule-checks.mjs disclosure origin/main
    node scripts/rule-checks.mjs size origin/main

期望：文档契约/空白/披露/规模门通过；另用已安装ExecPlan技能运行 `lint_execplan.py`，逐项核本计划docs路径。
`rule-checks`只有disclosure/size，不存在doclinks；不要伪造验证命令或声称旧栈planfacts覆盖本计划全部链接。
回滚点：Batch 0干净工作树，仅撤销本轮文档，不触碰用户或其他会话改动。

### Batch 1 · typed父边拒绝与最小preflight（pending）

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

### Batch 2 · 零BEGIN、回滚和现有Core外部闸门（pending）

最小闭环：拒绝早于本方法写交易，且交易机制/既有Core有效路径保持；主文件为 `tests/integration/storage-work-item-rejection.test.js`（将新建）、`tests/integration/storage-restart.test.js`、`tests/contract/storage-contract.test.js`。
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

### Artifacts and Notes

基线证据是两个设计独立内存探针：Fake accepted；SQLite Error / FOREIGN KEY constraint failed。这是缺陷，不是最终成功结果。
既有StartWork未知项测试通过来自 #188；最终报告必须区分“沿用零外部写入守卫”和“新Storage一致拒绝”。
关联只按GitHub事实回读，不把计划中的关闭关键字当权威。

    gh pr list -R SingularityKChen/harness-projects --head fix/storage-work-item-rejection --state open --json number,isDraft,baseRefName,headRefOid,closingIssuesReferences
    gh api graphql -f owner=SingularityKChen -f repo=harness-projects -F number=196 -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){state closedByPullRequestsReferences(first:100){nodes{number isDraft state baseRefName headRefName}}}}}'

创建后期望唯一draft、base main、精确head匹配；PR closingIssuesReferences与issue closedByPullRequestsReferences真实指向本项，issue开放。
若关联未解析，修正文案后重新回读；不能凭手工写下的关闭关键字宣称关联已成立。

## Progress

- [x] (2026-10-03 21:34 CST) Batch0：两独立设计、第三方代码审查、最终spec与唯一文件集收敛。
- [x] (2026-10-03 21:34 CST) 独立spec审查pass：统一invalid_input/none、同槽preflight、保留Core既有守卫与FK。
- [x] (2026-10-03 21:52 CST) reviewer实跑 lint_execplan.py：OK；另核13章固定顺序、docs引用/索引存在性及相对路径，均pass。
- [x] (2026-10-03 21:56 CST) Batch 0 文档门：linter通过，文档契约9/9、计划与索引路径、暂存区披露/体量和空白检查通过；产品验收未执行。
- [ ] (2026-10-03 21:34 CST) Batch1：typed父边拒绝与共享红绿证据。
- [ ] (2026-10-03 21:34 CST) Batch2：零BEGIN/DML、恢复/合法正控与远端验收。

## Surprises & Discoveries

StartWork已经在任何外部写前拒未知项；本issue当前缺口在directStorage，不应重复实施 #188。
共享套件绿色固定了Fake接受/SQLiteFK的分歧；台账必须改为共有拒绝而不是删该反例。
两设计错误码不同；domain NotFound的open_provider不适合本地父边缺失，最终统一invalid_input/none。
SQLite atomic原来根调用直接开transaction；为满足issue“交易前拒绝”，需要窄preflight与单一交易体，不需要全Storage重构。

## Decision Log

Decision：人类已在Project将 #189/#196/#178 规划启动为In Progress，并将 #178 提前到迭代4；保留新的规划。Rationale：2026-10-03人类明确确认该调整；agent只同步PR迭代索引，不代写Status或blocking。Date/Author：2026-10-03 22:08 CST / 人类伙伴。

Decision：Promise<void>保持，StorageInputError携带唯一failure结构。Rationale：异常仍让现有transaction回滚，避免Result忽略导致半提交。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：只验证实体存在，不加kind/workspaceProjection约束。Rationale：匹配现行FK父边，Core负责可操作项。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：same队列槽内preflight，复用一个私有交易体。Rationale：零BEGIN且不引入外部读→写窗口，保护令牌/关闭语义。Date/Author：2026-10-03 21:34 CST / 独立最终reviewer。
Decision：draft/标签/milestone/Project分类与ExecPlan/Batch复制现有Priority/Size/Iteration有授权；Status/blocking无授权。Rationale：机械索引不代替人规划。Date/Author：2026-10-03 21:34 CST / 用户明确范围。

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
Next gate：Batch0文档门→draft交付；实施从共享红例与队列观察开始；真实产品验收后才考虑ready，合并由人决定。
有关#199 producer失败、#218客户端竞争与既有tracker债务均独立，不能以本项失败类复用为由关闭它们。

## Outcomes & Retrospective

当前只形成最终可执行spec，未实现StorageInputError或父边检查；计划Active、issue开放、draft保留。
本项预估保留足够预算验证交易机制，不因代码行数目标机械拆连续算法。
完成产品批次后记录实际红绿、回读和债务，确认所有验收成立再按PLANS归档；当前tracker无新增实现债。

## Bottom Change Note

Change Note (2026-10-03 21:34 CST)：独立reviewer裁定两个设计的错误码/交易前检查冲突，补零BEGIN与scoped语义、合法正控、driver边界和真实关联回读；产品实施pending。
Change Note (2026-10-03 21:52 CST)：补确切Batch主路径与typed字段判据，独立linter和结构/路径检查已通过；全仓文档门由主执行者继续落账。

Change Note (2026-10-03 21:56 CST)：主执行者全文复核并运行文档契约与独立路径/暂存扫描，记录Batch 0文档门；后续产品批次保持pending。

Change Note (2026-10-03 22:08 CST)：记录人类在Project上的规划启动与#178重排期确认；保留原调查调度快照并明确取代，产品实施仍pending。
