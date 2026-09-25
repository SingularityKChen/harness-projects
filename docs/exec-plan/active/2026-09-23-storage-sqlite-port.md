# Storage 端口落地（L4 地基面）ExecPlan

> 状态：Active（2026-09-23 修复轮 2：读路径排队列 + 事务作用域与关闭快速失败 + 读隔离/投影覆盖提升进共享组，见 Batch L4-E）
> 创建：2026-09-23
> 范围：L4 / issue #163（控制计划里的 #120 / #5）；**本层只交付机制与地基面**——事务机制、契约套件的三组切分、以及工作区 / 绑定 / 实体 / 身份 / 规划投影 / 仓库 / 修订号的 SQLite 实现；其余端口方法显式抛出 `not implemented in L4: <method>`。
> 上游输入：`docs/exec-plan/active/2026-09-23-sqlite-v1-stack.md`（控制计划 Batch L4）、`docs/exec-plan/completed/2026-09-23-storage-control-facts.md`（L3，遗留「嵌套事务在运行时静默吞写」）、`docs/exec-plan/completed/2026-09-23-storage-identity-membership.md`（L2）、`packages/capabilities/src/storage.ts`（端口契约）。

## Purpose / Big Picture

完成后，`Storage` 端口第一次有了真实持久化实现的地基：`createSqliteStorage(location)` 打开（必要时创建）库、应用缺失迁移，并在 002/003 建出的表上实现事务与地基面；"重启后不变"由**关掉句柄再打开同一个文件**证明，而不是内存里导出/导入内部状态。契约套件按端口面切成地基 / 同步 / 执行三组，内存替身跑全部三组，SQLite 本层只跑地基组——两组测试的分工因此是显式的，而不是靠"未实现"堆出来的假红。

最小成功证据：

1. `node --test tests/contract` 里 storage 契约用例出现两个实现：内存替身跑全部三组、SQLite 只跑地基组，外加 1 条切分守卫（条数一律以命令回读为准；观察时刻快照：三组 13 / 8 / 3，地基组与守卫在 `storage.js` 内）。
2. `node --test tests/integration/storage-restart.test.js` 三条全绿：端口写入的工作区/绑定/实体/身份/投影/仓库/修订号在 `close()` 后重开逐字段不变；失败事务不留半写行；对已迁移文件再跑迁移是 no-op。
3. 十条判别性实验（改坏 → 红 → 还原 → 绿）有实际摘要，见 `Progress`（修复轮 1 补实验 ① ②，修复轮 2 补实验 ③ ④ ⑤ ⑥）。

## Context and Orientation

- 端口：`packages/capabilities/src/storage.ts`。`Storage.transaction(work)` 的语义是"要么全部生效、要么全部不生效"；`StorageTransaction = Omit<Storage, 'transaction'>` **只是类型层**的排除，运行时不移除任何方法（L3 计划遗留「嵌套事务在运行时静默吞写」记录了内存替身因此在事务内静默吞掉内层写入）。
- 表：`packages/storage/sqlite/migrations/002_identity_membership.sql`（工作区、绑定、实体、身份、成员关系、字段值、投影）与 `003_control_facts.sql`（执行、关系、观察、游标、写尝试、修订号）。`repository.external_identity_id` 与 `workspace_revision.workspace_id` 都是外键，`openDatabase` 显式打开 `foreign_keys`。
- 契约套件：`tests/contract/suites/storage.js` 是切分前的单一入口，装配形状是 `{ label, makeStorage(), restart(storage) }`；装配点在 `tests/contract/storage-contract.test.js`。切分前条数一律回读本层 base：`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`git show "$BASE":tests/contract/suites/storage.js | grep -c '^  test('`（观察时刻快照 18；原文的 232 行 / 16 条是观察时刻快照）。**Superseded by 2026-09-24 的切分收缩**：只抽出同步组与执行组，地基组留在 `storage.js`（见 D1）。
- 行为参照：`packages/providers/fake/src/storage.ts`（内存替身）是"同一套断言跑在两个实现上"的另一半。
- 术语：**地基组** = 工作区 / 绑定 / 实体 / 身份 / 投影 / 仓库 / 修订号 + 事务机制；**同步组** = 成员关系 / 字段值 / 观察 / 游标；**执行组** = 执行上下文与运行 / 关系 / 写尝试。

工作边界：只在检出 `feature/storage-sqlite-port2` 的工作树根目录改文件；不 push，不做 `gh` 写操作，不改迁移文件、`packages/capabilities/**`、`packages/core/**`、`packages/domain/**`、其它层计划与控制计划。

## Design / Spec

### D1. 契约套件按端口面切成三组，切分是纯移动（2026-09-23）

**判据**：L4 只交付地基面，而套件原本是一个全有或全无的入口——SQLite 注册它就会因为未实现的同步/执行方法变红，不注册就一条地基断言也跑不到。"让实现各注册自己已交付的部分"要求套件本身按端口面可分组。

**决定**：拆成 `storage-foundation.js` / `storage-sync.js` / `storage-execution.js` 三个导出（`storageFoundationSuite` / `storageSyncSuite` / `storageExecutionSuite`），共享夹具放 `storage-fixtures.js`，`storage.js` 只做装配、守卫与组合入口 `storageContractSuite`。断言逐条原样搬移：**没有删除、没有放宽**。

**Superseded by 2026-09-24 的切分收缩（第四轮评审响应）**：`storage-foundation.js` 不再存在——只抽出同步组与执行组（`storage-sync.js` / `storage-execution.js`），地基组留在 `storage.js`，`storage.js` 同时保留共享夹具、装配、守卫与组合入口；被移动的行因此减半，体量回到预算内。三组继承条数不变（地基 7 / 同步 8 / 执行 3），本层新增 6。

**守卫**：`PRE_SPLIT_CASE_COUNT`（来处：**回读本层 base（L3 head）的 `tests/contract/suites/storage.js`**——`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`git show "$BASE":tests/contract/suites/storage.js | grep -c '^  test('`，观察时刻快照 18）、`ADDED_CASE_COUNT`（本层新增，观察时刻快照 6）、`INHERITED_CASE_COUNTS = { foundation: 7, sync: 8, execution: 3 }`（三组继承之和必须等于 `PRE_SPLIT_CASE_COUNT`）。守卫用"只计数的注册器"数三组条数：删掉任何一条 `register(...)` 都会变红，而不是让覆盖静默缩水；逐组账见 `tests/contract/storage-contract.test.js` 的 `CASE_LEDGER`。**Superseded by 2026-09-24 的切分收缩**：原文的 16 / 4 / {6,7,3} 与 `storage-foundation.js` 都是观察时刻快照——第四轮评审实测本层 base 有 18 条（地基组继承 7 条），地基组现留在 `storage.js`（见 D1）。**订正 2026-09-24**：原文把 `8f11e38` 写成"新 base"，该提交在第二次级联后已不是 head 的祖先，来处改为上面的回读命令。级联 L2/L3 时，`storage.js` 里地基组的「一个工作区同一时刻只有一个默认绑定」与「replace 收敛指定 binding」改用 `development` 域（新契约下 planning 域只允许一个启用的挂载，写第二个会被拒绝而不是降级），**断言文本不变**。

**被放弃的方案**：把 SQLite 的注册拆成"只跑地基断言的过滤参数"。放弃理由：过滤器把"哪些断言属于哪个面"编码进测试运行参数，实现侧改一个方法名就能悄悄改变覆盖面；按端口面分组是结构，不是开关。

### D2. 未实现的方法显式抛出，而不是静默 no-op（2026-09-23）

**判据**：`getMembership` 返回 `undefined` 与"这个工作区真的没有成员关系"在调用方看来完全一样。静默 no-op 会把"本层没做"变成一条**错误的产品事实**。

**决定**：`storage-unimplemented.ts` 的 `UnimplementedPort` 为 20 个未实现方法抛 `new Error('not implemented in L4: <method>')`，方法体是 `async`，因此表现为 rejected promise 而不是同步抛出。方法名只写一次（`UNIMPLEMENTED_METHODS` 清单 + 构造函数里 `Object.defineProperty` 生成桩），类型层用 `interface UnimplementedPort extends Record<..., (...args: never[]) => never>` 保留端口形状；修复轮把 20 份手写签名换成这张表（见 D7）。`SqliteStorage` 继承它，只覆盖地基面。

### D3. 嵌套事务在运行时被拒绝，两个实现同批修（2026-09-23）

**判据**：L3 计划遗留「嵌套事务在运行时静默吞写」明确要求"与 L4 同批修，否则 JS 调用方会得到无提示的丢写"。类型层的 `Omit` 不会移除方法，所以判据只能落在运行时的行为上。

**决定**：SQLite 侧事务作用域实例（`#scoped` 标记）在 `transaction()` 入口抛 `嵌套事务不被支持：一个事务内不得再开事务`；内存替身侧给事务作用域实例加标记并在 `transaction()` 入口拒绝。契约套件加一条用例，断言"内层调用抛出可识别的错误"（按 `/嵌套事务/` 匹配），而不是让外层事务整体失败——后者会把"嵌套被拒绝"与"事务实现坏了"混在一起。

**修复轮补充**：`SqliteTransaction` 子类在 D5 的队列重构里被 `#scoped` 标记取代（子类只能拒绝嵌套，不能表达"作用域实例已持有队列"这件事）。抛错文本与时机不变，判别性证据仍钉在契约用例上。

**越界说明**：内存替身在控制计划的 L4 文件所有权表里属于"其它包"（只读）。本层改了它 4 行，依据是用户指令"契约套件加一条钉住两个实现都抛"与 L3 计划遗留「嵌套事务在运行时静默吞写」把收口条件指给 L4：只加一条契约用例而不修另一侧，得到的是红套件，不是收口。

### D4. 重启用例走文件库，不走内存导出（2026-09-23）

**判据**：#5 的判据是"重启后身份、关系与执行上下文不变"，内存替身的 `restart` 是导出/导入内部状态模拟的，证明不了持久化。

**决定**：`createSqliteStorage(location)` 返回的实例额外暴露 `close()` 与 `location`（不是端口方法）；`tests/integration/storage-restart.test.js` 真的 `close()` 再 `createSqliteStorage(同一个路径)`。契约装配里的 `restart` 用同一对方法，等同步组落地后可直接复用。

### D5. SQLite 适配器加实例级写队列，直接写入与事务同队列（2026-09-23 修复轮）

**判据**：独立对抗验证在 head `8333cec` 上判 `partially_falsified`，两条 P1 都在"SQLite 的事务语义与内存替身不等价"上，实测复现：

```text
P1-1 重叠事务：T1 在事务内挂起时 T2 开始 → T2 rejected: cannot start a transaction within a transaction；ws-t2 未写入
P1-2 事务在途时经端口直接写入 → 调用方拿到 fulfilled，但事务回滚后该行读不到
```

两者同根因：SQLite 侧只有"事务"这一条串行机制，直接写入绕开它——它要么撞上已打开的 `BEGIN IMMEDIATE`（驱动级原始错误），要么被同一个连接上的在途事务吞掉（调用方已确认，回滚后消失）。内存替身没有这个缺口：它的 `#mutate` 把直接写入与事务排进同一条 `#queue`。

**决定**：给 `SqliteStorage` 加同一条实例级写队列。所有变更（`write()` 单语句与 `mutate()` 多语句块）都经 `mutate` 排队；`transaction` 也在队列内运行，从 `BEGIN IMMEDIATE` 持有到 `COMMIT` / `ROLLBACK` 为止。事务的 work 拿到的是 `#scoped = true` 的作用域实例：它的变更直接执行（它已持有队列，再入队就是队列内自等死锁），并在 `transaction()` 入口拒绝嵌套。这样两个实现共享同一条语义：**同一实例只有一个写者路径**。代价也相同，且已在两处实现注释里写明：work 里必须用 `tx.*`，调外层实例的写入方法会死锁。

**被放弃的方案**：在 `transaction` 里捕获驱动错误后重试。放弃理由：那是把"两个写者路径"的症状压下去——P1-2 的静默吞写没有错误可捕，而且重试掩盖了调用方已经拿到 `resolved` 这件事。

### D6. 写者路径语义提升进共享契约组（2026-09-23 修复轮）

**判据**：这两条语义原先只写在 `tests/contract/storage-contract.test.js`（替身专属），SQLite 适配器因此可以整体偏离而不被发现——P1-1 / P1-2 正是这么漏过去的。

**决定**：把"在途事务提交后保留直接写入""重叠事务串行提交，已确认的写入不被后来者覆盖"两条用例**提升**进 `suites/storage-foundation.js` 的事务组，断言文本逐字不变（只把 `test(` 换成 `register(`、标签换成 `${label}`），替身专属文件里删除重复的那两条。`ADDED_CASE_COUNT` 由 1 改为 4（含实验 ② 暴露的回滚分支），切分守卫继续把条数钉住（当时的分解账是观察时刻快照，已随第四轮评审按 base 实测订正为 `PRE_SPLIT_CASE_COUNT` 18 + 新增 6，见 D1）。两条用例现在各跑两个实现（契约总条数以 `node --test tests/contract` 回读为准，不再写死）。

### D7. 未实现桩改表驱动 + 体量压缩（2026-09-23 修复轮）

**判据**：D5 的队列要在 ≤1000 行的代码预算里落地；而 D6 的提升本身在 `git diff` 上是"删 38 行 + 加 33 行"（同一段断言换文件），净增约 78 行，超出"桩表驱动省 20 行"的余量。

**决定**：① `UnimplementedPort` 的 20 份手写桩换成一张方法名清单 + 构造函数里的生成循环（38 → 16 行）；② `storage.ts` 的 `SqlitePort` / `SqliteStorage` / `SqliteTransaction` 三个类合并成一个（同一个类同时充当 Storage 与 StorageTransaction，作用域由 `#scoped` 表达），单语句变更走 `write()`、多语句块走 `mutate()`；③ `storage-rows.ts` 的五张行映射表改成"一行一条记录"；④ 测试与装配侧的行内 `catch`、注册块与守卫按仓库既有的紧凑风格书写。**没有删除任何断言、没有放宽任何断言文本**；改动全部落在 L4 自己新建的文件与 `storage-contract.test.js` 内。

### D8. 读路径与写路径共用同一条队列，事务作用域与关闭快速失败（2026-09-23 修复轮 2）

**判据**：评审 P1 实测（复刻替身专属隔离用例、只替换实现）：

```text
sqlite: read-during-tx = "T"  <== DIRTY READ   after-rollback = undefined
fake  : read-during-tx = undefined (isolated)  after-rollback = undefined
```

`mutate` 是唯一的串行点，但 8 个读方法直接 `prepare`，事务在途时落进那个打开的 `BEGIN IMMEDIATE`（同连接语义）。影响不止"读到半套投影"：`currentRevision` 返回未提交的 N+1，回滚后已提交修订仍是 N，下一次提交复用 N+1 时 `controller/watch.ts` 判定 `next.revision === state.cursor` 而**不发 delta**——订阅者静默漏更，而该文件自己写明"绝不静默续传一个可能已经错位的投影"。

**决定**：读与写走同一条实例级队列（读方法包 `mutate`），因此事务在途时的**外部读**拿到的是结算后的值；事务作用域内的 `tx.*` 直接执行，读得到本事务自己的未提交写入。两个实现都不暴露未提交数据，差别只是读取时刻：替身的读者在事务在途时立刻看到旧值，队列化的 SQLite 读者等到结算——这一点写进实现头注释与本计划，不写成"两个实现行为完全相同"。

同一轮收口三条同源问题，一律快速失败、抛可识别错误：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| `work` 里调**外层实例**（读 / 写 / 再开事务） | 无限挂起（1.2s 实测不 settle，无错误、无栈） | `AsyncLocalStorage` 标记事务作用域，命中即抛 `OUTER_INSTANCE_MESSAGE` |
| 事务在途时 `close()` | 在途事务拿到驱动文案 `database is not open`，未结算的排队写入变成 unhandled rejection | 实例标记已关闭；在途事务与已排队变更都以 `CLOSED_MESSAGE` 失败 |
| `close()` 之后的任何调用 | 驱动文案 | 同上 |

`AsyncLocalStorage` 是这里唯一能区分"work 内部的调用"与"事务在途时从外部发起的调用"的手段：单纯在队列槽上标记"事务在途"会把合法的事务外读也误判成自等（队列化的外部读本来就该等）。判据见实验 ④ ⑤。

### D9. 读隔离提升进共享组、投影覆盖补用例、嵌套断言收紧到整串（2026-09-23 修复轮 2）

**判据**：三条都是"断言没有判别力"的同一类缺口——(a) 读隔离只写在替身专属文件里（`git grep 未提交 tests` 只命中该文件），所以 SQLite 的脏读不会被任何共享断言发现；(b) `putPlanningProjection` 的 `DO UPDATE` 分支从未被执行（套件里同 `(工作区, 实体)` 从不写第二次，`replace` 只被调用一次且 `items = []`），改成 `DO NOTHING` 也不会红；(c) 嵌套事务断言只匹配 `/嵌套事务/`，两个字面量可以各自漂移而套件仍绿。

**决定**：① 把"未提交的写入不得被事务外的读看到"提升进共享地基组（2026-09-24 切分收缩后在 `tests/contract/suites/storage.js`，见 D1），措辞改成两个实现都能满足的形式（断言"读到的不是未提交的值"，而不是替身专属的"读到 `undefined`"），替身专属文件里的重复项删除；② 在共享组补"同一 `(工作区, 实体)` 的第二次写入覆盖前值"，一次覆盖两个实现；③ 嵌套事务断言从正则收紧到**整串**约定文本（`NESTED_TRANSACTION_MESSAGE` 在共享组里独立声明一份字面量，实现侧改措辞即红）；④ 列表读按 `rowid`（插入序）返回，与内存替身的数组序一致——端口没规定顺序（`packages/capabilities` 不在授权面），两实现静默分叉比"写明不保证"更糟，见本层计划遗留「端口注释没有写明读的排队语义与列表顺序」。

**体量**：本轮新增约 76 行会把 head `6526ded` 的 999/1000 推过预算，因此把本 PR 自己的 `storage.ts` 从 179 行压到 118 行（合并适配器类留下的重复注释、单语句方法一行、列清单两行一条），新增用例按仓库既有紧凑风格书写。**没有删除或放宽任何既有断言**，除了本轮按要求提升的那一条（从替身专属文件移入共享组）与收紧的那一处（正则 → 整串）。最终 992/1000（观察时刻快照，不可复跑；体量以 `node scripts/rule-checks.mjs size "$BASE"` 回读为准，`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`）。

### D10. 绑定落库按"连接锚点 + 工作区挂载"两表写，且两条语句同属一个原子作用域（2026-09-24 级联）

**判据**：L2 的迁移 002 把 `provider_binding` 收窄为跨工作区的连接锚点（`(id, implementation_key)`），工作区作用域的 `domain` / `enabled` / `is_default` 移到 `workspace_binding`。端口 `ProviderBindingRecord` 的形状不变（仍是工作区挂载视图），但一次 `putProviderBinding` 现在必须写两张表。两条语句中间失败会留下**孤儿锚点**：身份地基组随后用同一个 id 换域挂载时必须成功，而孤儿锚点的实现键与请求不一致，会让这次合法写入被"同 id 换实现"拒绝——实测正是这条用例把顺序写法的缺陷钉住。

**决定**：① `BINDING_COLUMNS` 改成 join 别名（列名与拆表前逐字相同，`rowToBinding` 不用改）；② `listProviderBindings` 走 `workspace_binding AS wb JOIN provider_binding AS b`，按 `wb.rowid`（插入序）返回；③ `putProviderBinding` 先按 id 读锚点的 `implementation_key` 并比对——`ON CONFLICT (id) DO NOTHING` 会静默吞掉"同一个 id 换实现"，这是唯一必须由端口显式给出的拒绝；④ 锚点写入、同域旧默认降级、挂载 UPSERT 三条语句包进同一个原子作用域（外层调用走一次真实事务，`tx.*` 内直接执行），因此第二个启用的 planning 挂载、`is_default` 蕴含 `enabled`、以及任何未预见的约束失败都会把前面的写入一起回滚。**拒绝仍然由数据库给出**（002 的部分唯一索引与 CHECK，集成用例直接对 schema 断言），端口只是不留下半写状态。

**被放弃的方案**：只做锚点预检、其余靠约束自然失败（即最初的顺序写法）。放弃理由：锚点已经落库、挂载被拒，孤儿锚点让"被拒绝的挂载不得留下任何行"不成立，且下一次用同一个 id 的合法写入会被误拒。另一种是把所有约束在 JS 里逐条预检，那是把 002 的约束抄第二遍，必然漂移。

### 被放弃的方案

| 方案 | 为什么放弃 |
|---|---|
| 让 SQLite 本层注册全部三组，未实现方法返回空值 | 空值把"没实现"变成"没有数据"；而且会让 20 个方法永远没有失败信号 |
| 用过滤参数而不是分组来限制覆盖面 | 见 D1：覆盖面变成运行参数，实现侧改名即可静默改变它 |
| 把切分做成 `git mv storage.js storage-foundation.js` | 内容是真的被拆到多个文件，用重命名表达会误导评审对 diff 的阅读 |
| 只加契约用例、不改内存替身 | 套件会红（内存替身跑全部三组），等于把 L3 计划遗留「嵌套事务在运行时静默吞写」换个地方挂着 |
| 直接写入撞上在途事务时捕获驱动错误并重试 | 见 D5：P1-2 的静默吞写没有错误可捕，重试掩盖"调用方已拿到 resolved" |
| 把两条写者路径用例留在替身专属文件里、另给 SQLite 写一份 | 同一语义两份断言会各自漂移；共享组是唯一能钉住两个实现的位置 |
| 用"写方法清单 + 构造函数包装"代替逐个 `write()` / `mutate()` | 队列语义在方法定义处不可见，读方法体的人看不到这个写入会排队 |
| 让读另开一条只读连接去观察已提交快照 | 第二条连接要在 `close()` 生命周期、`BEGIN IMMEDIATE` 的写锁与 `busy_timeout` 上各写一套语义；同一实例两个句柄还会让"重开同一文件"的判据失真 |
| 只在队列槽上标记"本实例事务在途"，不用 `AsyncLocalStorage` | 分不清"work 内部的调用"与"事务在途时从外部发起的调用"，会把合法的事务外读也拒掉（见 D8） |
| 保留 `ORDER BY id` 并在注释里写明"顺序不保证" | 两个实现的列表顺序会随存储实现漂移且没有门禁；端口未规定顺序不等于可以静默分叉，改用 `rowid` 对齐替身的插入序只花 4 行 |
| 把跨实例自等用例直接放进共享组 | 内存替身的 `#mutate` 没有事务作用域检查，同一动作在它身上是静默挂起（实测 1.2s 不 settle）——共享组会得到一条永远超时的用例，见本层计划遗留「跨实例自等的共享用例缺另一半」 |

## Global Constraints

- 允许改：`packages/storage/sqlite/src/storage*.ts`（新建）、`packages/storage/sqlite/src/index.ts`、`tests/contract/suites/storage*.js`、`tests/contract/storage-contract.test.js`、`tests/integration/storage-restart.test.js`（新建）、本文件、`docs/README.md`（只加自己那一行）；`packages/providers/fake/src/storage.ts` 的 4 行越界改动见 D3。修复轮 1 在共享地基组里**新增**一条回滚分支用例（见 D6 / `Surprises & Discoveries` 6），没有删改该目录下的既有断言。**订正 2026-09-24**：地基组现留在 `storage.js`（`storage-foundation.js` 已不存在，见 D1）。
- 修复轮 2 的改动面（评审 P1/P3 收口）：`packages/storage/sqlite/src/storage.ts`、共享地基组（只新增两条共享断言并按要求把嵌套事务断言收紧到整串）、`tests/contract/storage-contract.test.js`、本文件。**没有改** `packages/capabilities/**`（端口注释不在授权面，见本层计划遗留「端口注释没有写明读的排队语义与列表顺序」）与 `packages/providers/fake/**`（见本层计划遗留「跨实例自等的共享用例缺另一半」）。**订正 2026-09-24**：共享地基组现在 `tests/contract/suites/storage.js` 内（见 D1）。
- 不得改：迁移文件、`packages/capabilities/**`、`packages/core/**`、`packages/domain/**`、其它层计划、控制计划。
- 代码 ≤1000 行、文档 ≤1500 行（`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`，再 `node scripts/rule-checks.mjs size "$BASE"`）；单文件 ≤200 行、单函数 ≤40 行。
- `storage/sqlite` 只依赖 `@harness-projects/domain` 与 `@harness-projects/capabilities`；不新增运行时依赖，数据库只用 Node 内建 `node:sqlite`，事务作用域标记只用 Node 内建 `node:async_hooks` 的 `AsyncLocalStorage`。
- 关键语义必须有判别性证据：改坏 → 红 → 还原 → 绿，摘要记入 `Progress`。
- 提交格式 `<type>(<scope>): <中文摘要>`；不 push、不做 `gh` 写操作；不写本机绝对路径与凭据。

## Plan of Work

### Batch L4-A · 切分套件并先写红证据

**最小闭环**：契约套件按端口面可分组，切分有可执行的条数守卫；重启用例在实现之前先红。

**涉及文件**：`tests/contract/suites/storage*.js`、`tests/contract/storage-contract.test.js`、`tests/integration/storage-restart.test.js`

- [x] 抽出共享夹具；三组各自导出 suite，`storage.js` 保留组合入口与守卫常量
- [x] 加"事务内再调 `tx.transaction(...)` 必须运行时抛错"（L3 计划遗留「嵌套事务在运行时静默吞写」）
- [x] 写 `tests/integration/storage-restart.test.js`：写入 → `close()` → 同路径重开 → 逐字段比对；失败事务不留半写行；再跑迁移 no-op
- [x] 在 Batch L4-A 的树上运行两条最窄命令，确认按预期失败

**验证**（在检出 `feature/storage-sqlite-port2` 的工作树根目录运行，`git stash push -u` 后即 Batch L4-A 的树）：

```bash
node --test tests/contract/storage-contract.test.js   # 期望：22 pass / 1 fail，红的是"事务内再调 tx.transaction(...) 必须运行时抛错"
node --test tests/integration/storage-restart.test.js # 期望：fail 1，模块找不到 createSqliteStorage
# 以上两条期望值是观察时刻快照，不可复跑
```

**回滚**：`git revert` Batch L4-A（切分套件并先写红证据）的提交；套件回到单一入口，重启用例消失。（**第五轮订正**：批次已并入本层合并时的提交，可执行的回滚见 `Idempotence and Recovery`。）

### Batch L4-B · 适配器机制与地基面

**最小闭环**：SQLite 在文件库上通过地基组契约与三条重启用例，未实现的方法显式抛出。

**涉及文件**：`packages/storage/sqlite/src/storage.ts`、`storage-rows.ts`、`storage-unimplemented.ts`、`packages/storage/sqlite/src/index.ts`、`packages/providers/fake/src/storage.ts`、`tests/contract/storage-contract.test.js`

- [x] `transaction()`：`BEGIN IMMEDIATE` → 工作 → `COMMIT`，失败 `ROLLBACK` 后重抛
- [x] 地基面：工作区 / 绑定（先降级旧默认再插入）/ 实体 / 身份（按对象键 UPSERT，保留已分配 id 与 entityId）/ 投影（含 `replacePlanningProjections` 的作用域收敛）/ 仓库 / 修订号（UPSERT + `RETURNING`）
- [x] `close()` / `location`：让"重启"是关句柄再打开，而不是复用连接
- [x] 内存替身在事务作用域内拒绝嵌套事务；契约装配里 SQLite 只注册地基组
- [x] 四条判别性实验（见 `Progress`）

**验证**：

```bash
node --test tests/contract/storage-contract.test.js    # 期望：30 pass / 0 fail（观察时刻快照，不可复跑）
node --test tests/integration/storage-restart.test.js  # 期望：3 pass / 0 fail
node_modules/.bin/tsc --noEmit                         # 期望：退出码 0
```

**回滚**：`git revert` Batch L4-B（适配器机制与地基面）的提交；002/003 的表与约束留在栈里，端口回到只有内存替身可用。（**第五轮订正**：批次已并入本层合并时的提交，可执行的回滚见 `Idempotence and Recovery`。）

### Batch L4-C · 计划与索引

**最小闭环**：本层计划自包含可复现，`docs/README.md` 的 Active 索引有本层一行。

**涉及文件**：`docs/exec-plan/active/2026-09-23-storage-sqlite-port.md`、`docs/README.md`

- [x] 写本文件：设计、批次、验收表、判别性证据、遗留问题
- [x] `docs/README.md` 只加自己那一行

**验证**：

```bash
BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)
node scripts/rule-checks.mjs disclosure "$BASE"   # 期望：退出码 0
node scripts/rule-checks.mjs size "$BASE"         # 期望：退出码 0，代码 ≤1000、文档 ≤1500
git diff --check "$BASE"...HEAD                   # 期望：无输出
```

**回滚**：`git revert` Batch L4-C（计划与索引）的提交；代码与测试不受影响。（**第五轮订正**：批次已并入本层合并时的提交，可执行的回滚见 `Idempotence and Recovery`。）

### Batch L4-D · 修复轮：写者路径队列 + 语义提升（2026-09-23）

**最小闭环**：两个实现的"只有一个写者路径"语义由同一组共享断言钉住，且体量仍在预算内。

**涉及文件**：`packages/storage/sqlite/src/storage.ts`、`storage-rows.ts`、`storage-unimplemented.ts`、`tests/contract/suites/storage-foundation.js`、`tests/contract/suites/storage.js`、`tests/contract/storage-contract.test.js`、本文件

- [x] 复现两条 P1（重叠事务撞驱动级错误；事务在途时的直接写入随回滚消失）
- [x] `SqliteStorage` 加实例级写队列：`write()` / `mutate()` / `transaction` 排同一条 `#queue`，事务持有到提交/回滚；作用域实例 `#scoped` 直接执行并拒绝嵌套
- [x] 两条写者路径用例提升进 `suites/storage-foundation.js` 事务组，断言文本不变；替身专属文件删除重复项；`ADDED_CASE_COUNT` 1 → 3
- [x] 未实现桩表驱动（38 → 16 行）；三处适配器类合并；体量回到 ≤1000
- [x] 两条新判别性实验（见 `Progress`）

**验证**：

```bash
node --test tests/contract/storage-contract.test.js  # 期望：全绿，且两条写者路径用例在"内存 Storage 替身"与"SQLite Storage（地基组）"两个标签下各出现一次
node scripts/rule-checks.mjs size "$BASE"            # 期望：退出码 0，代码 ≤1000（BASE 见 Global Constraints）
```

**回滚**：`git revert` Batch L4-D（修复轮：写者路径队列 + 语义提升）的提交；SQLite 回到"裸 BEGIN IMMEDIATE + 无队列"，两条写者路径用例随之在 SQLite 侧变红（这正是它要钉住的东西），需连同用例一起回滚。（**第五轮订正**：批次已并入本层合并时的提交，可执行的回滚见 `Idempotence and Recovery`。）

### Batch L4-E · 修复轮 2：读路径排队列 + 事务作用域与关闭快速失败（2026-09-23）

**最小闭环**：两个实现的"未提交写入不得被事务外读到"由同一条共享断言钉住；事务作用域误用与关闭后的调用快速失败，而不是无限挂起或抛驱动文案。

**涉及文件**：`packages/storage/sqlite/src/storage.ts`、`tests/contract/suites/storage-foundation.js`、`tests/contract/storage-contract.test.js`、本文件

- [x] 复现 P1 脏读（`read-during-tx` 拿到未提交值）、P3 自等挂起（1.2s 不 settle）、`close()` 抛驱动文案
- [x] 读方法包 `mutate`：读与写排同一条队列；作用域实例 `#scoped` 直接执行、读得到本事务自己的写入
- [x] `AsyncLocalStorage` 标记事务作用域：`work` 里调外层实例抛 `OUTER_INSTANCE_MESSAGE`
- [x] `#closed` 标记：在途事务与已排队变更以 `CLOSED_MESSAGE` 失败，注释写明"关闭前必须等在途事务结算"
- [x] 列表读改 `ORDER BY rowid`（插入序，与内存替身一致）
- [x] 读隔离提升进共享组；补投影覆盖用例；嵌套事务断言收紧到整串
- [x] 体量回到预算内（观察时刻快照：992/1000；以 `size "$BASE"` 回读为准）；四条新判别性实验（见 `Progress` 实验 ③ ④ ⑤ ⑥）

**验证**：

```bash
node --test tests/contract                          # 期望：427 pass / 0 fail
node --test tests/integration                       # 期望：26 pass / 0 fail（观察时刻快照，不可复跑）
../../node_modules/.bin/tsc --noEmit                # 期望：退出码 0
node scripts/rule-checks.mjs size "$BASE"          # 期望：退出码 0（体量以回读为准）
git diff --check "$BASE"...HEAD                    # 期望：无输出
```

**回滚**：`git revert` Batch L4-E（修复轮 2：读路径排队列 + 事务作用域与关闭快速失败）的提交；读回到直接 `prepare`（读隔离用例随之在 SQLite 侧变红）、事务作用域回到静默挂起、`close()` 回到驱动文案。实现与四条用例是一个闭环，不能只回退一半。（**第五轮订正**：批次已并入本层合并时的提交，可执行的回滚见 `Idempotence and Recovery`。）

### Batch L4-F · 级联 L2/L3 重写（2026-09-24）

**最小闭环**：本层在重写过的 L2/L3 之上重新可验收——绑定落库改成"连接锚点 + 工作区挂载"两表，契约套件仍然全绿且体量在预算内（base 以 `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 回读；原文写死的 `8f11e38` 是观察时刻快照，不可复跑）。

**判据**：L2 的迁移 002 把 `provider_binding` 收窄为跨工作区的连接锚点，工作区作用域的 `domain` / `enabled` / `is_default` 移到 `workspace_binding`。L4 原本的两处实现假设"绑定是一张工作区作用域的表"，在新 base 上必然失败（`no such column: is_default`、`table provider_binding has no column named workspace_id`）。

**涉及文件**：`packages/storage/sqlite/src/storage.ts`、`tests/contract/suites/storage*.js`、`tests/contract/storage-contract.test.js`、本文件

- [x] 建恢复锚点 `refs/heads/backup/storage-sqlite-port2-pre-review-response`，`git rebase --onto 8f11e38 3e255ed` 重放 6 个提交（观察时刻快照，不可复跑）
- [x] 冲突：`suites/storage.js` 取 L4 的切分结构（装配 + 计数守卫），把 L2 对既有用例的两处语义改动带进 `storage-foundation.js`（改 `development` 域，断言文本不变）；`tests/contract/storage-contract.test.js` 让替身注册身份地基组与同步组、SQLite 只注册地基组
- [x] `BINDING_COLUMNS` 改成 join 别名（列名不变，`rowToBinding` 不动）；`listProviderBindings` 走 `workspace_binding JOIN provider_binding`
- [x] `putProviderBinding` 先按 id 比对连接锚点的实现键再写；锚点写入与挂载写入包进同一个原子作用域——挂载被部分唯一索引或 CHECK 拒绝时不得留下孤儿锚点
- [x] 体量压缩回预算（994/1000）：合并重复注释、按仓库既有紧凑风格并句；**没有删除或放宽任何断言**

**验证**：

```bash
node --test tests/contract                          # 期望：全绿（条数以命令回读为准）
node --test tests/integration                       # 期望：全绿（条数以命令回读为准）
node scripts/rule-checks.mjs size "$BASE"          # 期望：退出码 0（体量以回读为准）
```

**回滚**：`git revert` Batch L4-F（级联 L2/L3 重写）的提交；绑定落库回到单表假设，身份地基组在 SQLite 侧立即变红。（**第五轮订正**：批次已并入本层合并时的提交，可执行的回滚见 `Idempotence and Recovery`。）

## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 契约套件切成三组，切分是纯移动 | 三组条数由切分守卫按 `PRE_SPLIT_CASE_COUNT` + `ADDED_CASE_COUNT` 与 `CASE_LEDGER` 断言；`PRE_SPLIT_CASE_COUNT` 以回读本层 base 的 `tests/contract/suites/storage.js` 为准（`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`，观察时刻快照 18），继承 18（地基 7 / 同步 8 / 执行 3）、新增 6。**Superseded by 2026-09-24 的切分收缩**：原文的 12 / 7 / 3 与 `storage-foundation.js` 已不存在（见 D1） | 通过（2026-09-23；修复轮 2 复核；2026-09-24 按实测订正分解账） |
| 2 | 内存替身注册全部三组，SQLite 只注册地基组 | `tests/contract/storage-contract.test.js` 的两次装配 | 通过 |
| 3 | 事务内再调 `tx.transaction(...)` 两个实现都抛错 | 契约用例（两个实现各一次） | 通过 |
| 4 | 事务原子性：抛错后重开句柄读不到半写行 | `tests/integration/storage-restart.test.js` 第 2 条 | 通过 |
| 5 | 重开同一文件逐字段不变 | 重启用例第 1 条（工作区/绑定/身份/投影/仓库/修订号） | 通过 |
| 6 | 再跑迁移是 no-op | 重启用例第 3 条：迁移重跑之前先经端口 `putWorkspace`，迁移后重开逐字段读回（**第五轮订正**：上一版没有这次端口写入却记「通过」；补上后本层字面满足，改为由本层关闭 #163） | 通过 |
| 7 | 未实现方法显式抛出且不误红地基组 | `UnimplementedPort` + SQLite 地基组全绿（条数以 `node --test tests/contract` 回读为准；观察时刻快照 13） | 通过 |
| 8 | 地基组覆盖的端口面（本层交付范围） | 工作区 / 绑定 / 实体 / 身份 / 投影（含 replace）/ 仓库 / 修订号 / 事务 | 通过 |
| 9 | **未交付范围明确**：同步组与执行组 | 20 个方法抛 `not implemented in L4: <method>`；对应契约组只在内存替身上运行 | 通过（本层只交付地基组） |
| 10 | `storage/sqlite` 只依赖 capabilities 与 domain | `node --test tests/contract/package-boundaries.test.js` 7/7 | 通过 |
| 11 | 体量与发布面合规 | `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`，再 `size "$BASE"` / `disclosure "$BASE"` / `git diff --check "$BASE"...HEAD` | 以命令回读为准，不写死数字。**订正 2026-09-24（评审）**：原文写 `size 8f11e38`（该提交在第二次级联后已不是 head 的祖先，不可复跑）与「代码 1103/1000」；体量数字是易失值，且 2026-09-24 已把切分改成只抽出同步组与执行组，被移动的行减半（见 `Outcomes & Retrospective` 的体量说明） |
| 12 | 全门禁 | `node --test tests/contract`、`node --test tests/integration`、`node --test tests/e2e`、`node --test tests/mvp0`、`tsc --noEmit` 全绿（条数以命令回读为准；观察时刻快照：契约 486、集成 30、e2e 38、mvp0 7） | 通过（2026-09-24 级联复跑） |
| 13 | **同一实例只有一个写者路径**（修复轮） | 三条写者路径用例在"内存 Storage 替身"与"SQLite Storage（地基组）"两个标签下各出现一次 | 通过（D5 / D6） |
| 14 | 重叠事务不撞驱动级错误、两个事务都提交 | 契约"重叠事务串行提交，已确认的写入不被后来者覆盖"×2；实验 ① 判别性证据 | 通过 |
| 15 | 事务在途时的直接写入不被并进事务 | 契约"在途事务提交后保留直接写入"与"在途事务回滚后直接写入仍然落库"×2；实验 ② 判别性证据 | 通过 |
| 16 | **读隔离**（修复轮 2）：事务未提交的写入不得被事务外的读看到 | 共享地基组用例在"内存 Storage 替身"与"SQLite Storage（地基组）"两个标签下各一次；实验 ③ 判别性证据 | 通过（D8 / D9） |
| 17 | 事务作用域误用快速失败：不挂起、不抛驱动文案 | `storage-contract.test.js` 的 SQLite 专属用例（读 / 写 / 再开事务三种调用）；实验 ④ 判别性证据 | 通过（**不声称共享**：见本层计划遗留「跨实例自等的共享用例缺另一半」） |
| 18 | 事务在途时 `close()`：在途事务与已排队变更快速失败 | 同上 close 用例；实验 ⑤ 判别性证据 | 通过 |
| 19 | 投影 UPSERT 的覆盖分支有判别性用例 | 共享地基组用例 ×2；实验 ⑥（改 `DO NOTHING` 变红） | 通过（本层计划遗留「投影 UPSERT 的覆盖分支无判别性用例」收口） |
| 20 | **级联后绑定仍按新契约落库**（Batch L4-F） | 身份地基组用例 ×2（替身 + SQLite）：同 id 换实现被拒、第二个启用的 planning 挂载被拒且不留孤儿锚点、同域至多一个启用默认；`listProviderBindings` 走 join 别名 | 通过（2026-09-24） |

**本层不声称**：#5 的"关系与执行上下文重启后不变"要等同步组与执行组落地（本层只交付地基组，验收表第 9 项显式登记）。

## Progress

- [x] (2026-09-24) **第三轮评审响应（本层 9 条）**：① **事务作用域加生命周期**——AsyncLocalStorage 的标记换成可变令牌，`transaction()` 的 `finally` 置 `active = false`，泄漏出 `work` 的 `tx` 在结算后快速失败而不是被并进下一个在途事务；作用域实例与根实例共用关闭状态，`close()` 幂等；新增 `atomic(fn)` 作为多语句写入的唯一原子入口。② **切分守卫加一层断言数基线**，并补回级联时丢掉的两条默认降级断言。③ 重启用例改成"经端口写入 → 关句柄 → 重跑迁移"（**订正 2026-09-24（第四轮评审）**：③ 声称的写法在当时的 head 上不存在；判据是该用例必须包含一次经端口写入，回读 `tests/integration/storage-restart.test.js` 的迁移 no-op 用例）。④ 计划里的体量基线改成回读式，遗留清单补上 `repository` / `workspace_revision` 的引用完整性分叉。逐条处置见 `docs/exec-plan/active/2026-09-24-review-root-cause-convergence.md`。
- [x] (2026-09-23) 读端口契约、002/003 迁移、内存替身、L3 计划遗留「嵌套事务在运行时静默吞写」，确认文件边界与"只交付地基面"的范围。
- [x] (2026-09-23) Batch L4-A：三组切分 + 条数守卫 + 嵌套事务用例 + 重启用例，Batch L4-A 的提交。
- [x] (2026-09-23) 红证据（在 Batch L4-A 的树上运行）：`node --test tests/contract/storage-contract.test.js` → 22 pass / 1 fail，红的是"内存 Storage 替身：事务内再调 tx.transaction(...) 必须运行时抛错"；`node --test tests/integration/storage-restart.test.js` → fail 1（`createSqliteStorage` 尚不存在）。
- [x] (2026-09-23) Batch L4-B：`createSqliteStorage` 地基面、事务机制、未实现桩、内存替身嵌套拒绝、契约装配，Batch L4-B 的提交。
- [x] (2026-09-23) Batch L4-C：本计划与 `docs/README.md` 索引行，Batch L4-C 的提交。
- [x] (2026-09-23) 全门禁与判别性实验，摘要见下。
- [x] (2026-09-23) 修复轮（Batch L4-D）：独立对抗验证判 `partially_falsified` 的两条 P1 复现 → 队列修复 → 语义提升进共享组 → 体量压缩 → 两条新判别性实验 → 全门禁复跑。
- [x] (2026-09-23) 修复轮 2（Batch L4-E）：复现评审 P1 脏读与两条 P3（自等挂起、`close()` 抛驱动文案）→ 读排队列 + 事务作用域标记 + 关闭标记 + `rowid` 排序 → 读隔离/投影覆盖进共享组、嵌套断言收紧 → 体量压缩回预算 → 四条新判别性实验 → 全门禁复跑（观察时刻快照，不可复跑：契约 427/427、集成 26/26、`tsc` 0、992/1000）。
- [x] (2026-09-24) 级联 L2/L3 重写（Batch L4-F）：`git rebase --onto 8f11e38 3e255ed`（观察时刻快照，不可复跑） → 冲突按"取 L4 的切分结构 + 把 L2 的两处语义改动带进组文件"解决 → 绑定落库改双表（锚点 + 挂载，原子作用域）→ 身份地基组在 SQLite 侧注册 → 体量压缩回预算（观察时刻快照，不可复跑：994/1000）→ 全门禁复跑（观察时刻快照，不可复跑：契约 486/486、集成 30/30、e2e 38/38、mvp0 7/7、`tsc` 0、boundaries 7/7）。

判别性实验（改坏 → 红 → 还原 → 绿，均在检出 `feature/storage-sqlite-port2` 的工作树根目录）：

1. **事务回滚**：`rollbackQuietly(this.db)` 改成 `this.db.exec('COMMIT')` → 重启用例第 2 条与契约"事务提交成功、失败整体回滚"红（1 fail / 29 pass 与 1 fail / 2 pass）→ 还原后 33/33 绿。
2. **嵌套事务抛错**：事务作用域不再拒绝 `transaction()`（静默放行）→ 契约"事务内再调 tx.transaction(...) 必须运行时抛错"红 → 还原后 30/30 绿。
3. **UPSERT 后者胜（默认绑定）**：删掉 `putProviderBinding` 里"先降级同域旧默认"的 UPDATE → 契约"一个工作区同一时刻只有一个默认绑定"红（部分唯一索引拒绝第二次插入）→ 还原后 30/30 绿。
4. **重开同一文件**：`createSqliteStorage` 忽略 `location`、固定开 `:memory:` → 三条重启用例全红 → 还原后 3/3 绿。
5. **实验 ①（修复轮）：事务不进队列**——`transaction` 回到裸 `BEGIN IMMEDIATE`（不排进 `#queue`）→ 契约 420 pass / 2 fail：`SQLite Storage（地基组）：重叠事务串行提交，已确认的写入不被后来者覆盖` 红（`Error: cannot start a transaction within a transaction`），`在途事务回滚后直接写入仍然落库` 也红（在途事务期间的直接写入被并进事务后随回滚消失）；内存替身两条仍绿（它本来就有队列）→ 还原后 422/422 绿。
6. **实验 ②（修复轮）：直接写入不进队列**——`write()` 改成 `this.db.prepare(sql).run(...params); return Promise.resolve()`（不等队列）→ 契约 421 pass / 1 fail：`SQLite Storage（地基组）：在途事务回滚后直接写入仍然落库` 红（`AssertionError: 事务在途时的直接写入不得被并进事务、随回滚一起消失`）→ 还原后 422/422 绿。

7. **实验 ③（修复轮 2）：读绕开队列**——`getWorkspace` 改成直接 `Promise.resolve(...)`（不排 `mutate`）→ `tests/contract/storage-contract.test.js` 37 pass / 2 fail：`SQLite Storage（地基组）：事务未提交的写入不得被事务外的读看到` 红（`AssertionError: 未提交的写入不得被事务外的读看到`），`SQLite Storage：事务 work 里调外层实例…` 也红（外层读不再排队，于是不再快速失败）→ 还原后 39/39 绿。
8. **实验 ④（修复轮 2）：去掉事务作用域标记**——删掉 `mutate` 里的 `TX_SCOPE.getStore() === this` 分支 → `SQLite Storage：事务 work 里调外层实例（读 / 写 / 再开事务）必须快速失败…` 5s 超时（`test timed out after 5000ms`，cancelled 1）——正是评审说的"永不 settle 的 promise：没有错误、没有超时、没有栈"→ 还原后 39/39 绿。
9. **实验 ⑤（修复轮 2）：去掉关闭检查**——删掉 `transaction` 里的 `if (this.#closed) throw new Error(CLOSED_MESSAGE)` → `SQLite Storage：事务在途时 close() 后…` 红（`actual: Error: database is not open`）→ 还原后 39/39 绿。
10. **实验 ⑥（修复轮 2）：投影 UPSERT 改 `DO NOTHING`** → `SQLite Storage（地基组）：同一 (工作区, 实体) 的第二次写入覆盖前值` 红（`AssertionError: 同键第二次写入必须覆盖前值，而不是保留旧行`）；内存替身同一用例仍绿（它本来就覆盖）→ 还原后 39/39 绿。

**实验 ② 的意外发现（已收口）**：只按指令提升的那两条用例在 SQLite 上**分辨不出** P1-2——它们的在途事务最终 `COMMIT`，被并进事务的直接写入会随提交一起落库，所以绕过队列时仍然绿。只有回滚分支能把它区分开。因此共享组多了一条 `在途事务回滚后直接写入仍然落库`（见 D6 与 `Surprises & Discoveries` 6），`ADDED_CASE_COUNT` 相应为 4。

验证摘要（易失值，以命令回读为准；命令在检出 `feature/storage-sqlite-port2` 的工作树根目录运行；**以下条数与体量都是观察时刻快照，不可复跑**）：`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`node --test tests/contract`、`node --test tests/integration`、`node --test tests/e2e`、`node --test tests/mvp0`、`tsc --noEmit`、`node --test tests/contract/package-boundaries.test.js`、`node scripts/rule-checks.mjs size "$BASE"`、`git diff --check "$BASE"...HEAD` 全部通过。**订正 2026-09-24**：原文写 `size 8f11e38` 与 `git diff --check 8f11e38...HEAD`（该提交已不是 head 的祖先，不可复跑），并写死契约 486、集成 30、e2e 38、mvp0 7、代码 994/1000 等易失值；这些数字不再作为判据。

修复轮 1 的摘要（历史值，观察时刻快照，不可复跑：head `6526ded`，契约 422/422、代码 999/1000）—— 它记录的是本轮之前的状态，不是当前 head。

## Surprises & Discoveries

1. **两条地基用例缺少前置行，SQLite 一跑就红**（2026-09-23，实测）。`workspace_revision.workspace_id` 与 `repository.external_identity_id` 都是外键，而"投影修订号从 0 起单调递增"没有建工作区、"规划投影与仓库按工作区隔离可读回"指向了不存在的 `identity-9`。实测（`node --input-type=module -e` 打开内存库并跑迁移后直接插入）：

   ```text
   revision without workspace: REJECTED -> FOREIGN KEY constraint failed
   repository with dangling identity: REJECTED -> FOREIGN KEY constraint failed
   ```

   处理：给这两条用例补最小前置行（工作区、仓库自己的实体与身份），**不动任何断言**。判据是套件自己已经声明"引用完整性是两个实现共有的契约"（同步组的"引用不存在的父行必须被拒绝"）；内存替身没有外键，所以这个缺口在它身上看不出来。
2. **投影 UPSERT 的覆盖分支没有判别性用例**（2026-09-23）。把 `upsertProjection` 的 `ON CONFLICT (workspace_id, entity_id) DO UPDATE ...` 改成 `DO NOTHING` 后，契约仍然 30/30 全绿：地基组里没有任何一条用例对同一个 `(工作区, 实体)` 写第二次。登记为本层计划遗留「投影 UPSERT 的覆盖分支无判别性用例」。
3. **`RepositoryRecord.externalIdentityId` 没有对应的身份种类**（2026-09-23）。`ExternalIdentityKind` 只有 draft / issue / change_request / branch / worktree，没有"仓库"这一种；外键只要求身份行存在。用例里用 `branch` 占位，登记为本层计划遗留「仓库没有对应的外部身份种类」。
4. **`replacePlanningProjections` 的两个实现不完全一致**（2026-09-23）。内存替身会连带删除不再被引用的实体，SQLite 侧不能删——`external_identity.entity_id` 以外键指向 `entity`，删实体会留下悬空身份或直接失败。契约套件只断言投影集合，所以两边都能通过；登记为本层计划遗留「`replacePlanningProjections` 的实体清理在两个实现间不一致」。
5. **两条 P1：SQLite 的事务语义与内存替身不等价**（2026-09-23 修复轮，独立对抗验证在 head `8333cec` 上判 `partially_falsified`）。实测复现（`node` 脚本，同一临时目录里两个库）：

   ```text
   P1-1 重叠事务：T1 在事务内挂起时 T2 开始 → T2 rejected: cannot start a transaction within a transaction；ws-t2 未写入
   P1-2 事务在途时经端口直接写入 → 调用方拿到 fulfilled，但事务回滚后该行读不到
   ```

   根因是同一个：SQLite 侧只有"事务"这一条串行机制，直接写入绕开它。修法与证据见 D5 / 实验 ① ②。
6. **按指令提升的两条用例在 SQLite 上分辨不出 P1-2**（2026-09-23 修复轮，实验 ② 实测）。`在途事务提交后保留直接写入` 的在途事务最终 `COMMIT`，被并进事务的直接写入会随提交一起落库——把 `write()` 改成不进队列后它仍然绿（421 pass / 1 fail 里红的是新加的回滚分支）。判据：P1-2 的症状是"回滚后消失"，只有回滚分支能观测到；而内存替身同一用例是红的（它的失败模式是提交时整体替换快照，提交分支就能观测）。处理：在共享组补一条 `在途事务回滚后直接写入仍然落库`，`ADDED_CASE_COUNT` 1 → 4。
7. **体量：语义提升在 diff 上是双份**（2026-09-23 修复轮）。`git diff` 里把断言从 `storage-contract.test.js` 搬到 `storage-foundation.js` = 删 38 行 + 加 33 行，净增约 78 行，远大于"未实现桩表驱动省 20 行"的余量；加上队列本身约 15 行，982 会被推到约 1075。处理：除桩表驱动外，还合并了三个适配器类、把 `storage-rows.ts` 的行映射改成"一行一条记录"、并让测试装配与守卫按仓库既有的紧凑风格书写；**没有删除或放宽任何断言**。最终 999/1000（观察时刻快照，不可复跑）。

8. **内存替身在外层实例调用上是静默挂起，不是"已有同样手法"**（2026-09-23 修复轮 2，实测）。评审 P3 的修复方向要求"补一条**共享**用例（两个实现都抛）"，前提是替身已有同样的 `transactionScope` 手法。实测不成立：替身的 `#transactionScope` 只在**作用域实例**的 `transaction()` 入口生效，它的 `#mutate` 不检查这个标记——`storage.transaction(async () => storage.putWorkspace(...))` 在替身上 1.2s 不 settle（`TIMEOUT(自等挂起)`）。因此快速失败用例先落在 `storage-contract.test.js` 的 SQLite 专属用例上；把替身补上同一检查（约 2 行）后即可提升进共享组，登记为本层计划遗留「跨实例自等的共享用例缺另一半」。
9. **`rowid` 是"与替身一致"的唯一低成本表达**（2026-09-23 修复轮 2）。端口没规定列表顺序，`ORDER BY id` 与替身的插入序不同（实测 `e-1,e-2` vs `e-2,e-1`）；SQLite 没有隐式行序，`rowid` 是插入序的显式表达，4 行改动即对齐两个实现。判据：`replacePlanningProjections` 先删后插，`rowid` 也随之反映 items 顺序，与替身的"过滤 + 按 items 顺序 upsert"一致。
10. **体量：999/1000 上做修复轮 2 需要先还债**（2026-09-23 修复轮 2）。本轮新增约 76 行（8 个读方法排队 + 三条快速失败 + 4 条用例）会把 PR 推过 1000 行预算，而 `PR size` 是 CI 判定。处理：把本 PR 自己的 `storage.ts` 从 179 行压到 118 行、新增用例按仓库既有紧凑风格书写；**没有删除或放宽既有断言**（只有按要求提升的那一条与收紧的那一处措辞）。最终 992/1000。

## Decision Log

- **Decision**：三组切分后，SQLite 本层只注册地基组，未实现方法抛错。**Rationale**：注册未实现的组只会得到"未实现"的假红，而静默返回空值会把"没做"读成"没有数据"。**Date/Author**：2026-09-23 / L4 实现者。
- **Decision**：嵌套事务的收口同时改 SQLite 与内存替身（越出控制计划的 L4 文件所有权 4 行）。**Rationale**：用户指令要求"契约套件加一条钉住两个实现都抛"，L3 计划遗留「嵌套事务在运行时静默吞写」把收口条件指给 L4；只改一侧得到红套件。**Date/Author**：2026-09-23 / L4 实现者。
- **Decision**：守卫用"只计数的注册器"实际数用例条数，而不是手写一份期望条数。**Rationale**：手写数字只能证明"文件里有个数字"，数不出来删除；注入式计数能。**Date/Author**：2026-09-23 / L4 实现者。
- **Decision**：为两条用例补前置行而不改断言。**Rationale**：断言是规格，前置行是"这条规格在什么状态下被检验"；外键是 002/003 已冻结的库层事实，不能为了用例放宽。**订正 2026-09-24**："已冻结"这个说法会被读成"v1 已冻结"，而 Gate E1 的汇总结论仍是 `revise`（`AGENTS.md` §1.2）。准确表述是：002/003 在本栈内由 L2/L3 拥有，L4 不改它们。**Date/Author**：2026-09-23 / L4 实现者。
- **Decision**：SQLite 侧用实例级写队列统一直接写入与事务，而不是在 `transaction` 里捕获驱动错误后重试。**Rationale**：P1-1 与 P1-2 同根因——存在两条写者路径；重试只压得住 P1-1 的错误，压不住 P1-2 的静默吞写。**Date/Author**：2026-09-23 / L4 修复执行者。
- **Decision**：写者路径语义提升进共享地基组，替身专属文件删除重复项。**Rationale**：这两条语义原先只在替身专属文件里，SQLite 可以整体偏离而不被发现，P1-1 / P1-2 正是这么漏过去的。**Date/Author**：2026-09-23 / L4 修复执行者。
- **Decision**：在共享组额外补一条回滚分支用例（`在途事务回滚后直接写入仍然落库`），超出"只提升两条"的字面范围。**Rationale**：实验 ② 实测两条被提升的用例在 SQLite 上分辨不出 P1-2（提交分支看不见"被并进事务"这件事）；不补这一条，P1-2 的修复就没有任何共享断言钉住，回退会静默通过。补的是新增用例，没有删改既有断言。**Date/Author**：2026-09-23 / L4 修复执行者。
- **Decision**：体量压缩落在 L4 自己新建的文件与 `storage-contract.test.js` 内（桩表驱动、三个适配器类合并、行映射一行一条、紧凑的装配与守卫写法），不动 `suites/**` 里的既有断言与其它层文件。**Rationale**：提升的 diff 成本约 78 行是结构性的；压缩只能落在本层自己的产物上，且不能以删除或放宽断言为代价。**Date/Author**：2026-09-23 / L4 修复执行者。
- **Decision**：读与写共用同一条实例级队列（读方法包 `mutate`），而不是让读另开只读连接观察已提交快照。**Rationale**：评审 P1 的判据是"读不得暴露未提交写入"；同一实例多一条连接要在 `close()` 生命周期、写锁与 `busy_timeout` 上各写一套语义，还会让"重开同一文件"的判据失真。**Date/Author**：2026-09-23 / L4 修复执行者 2。
- **Decision**：用 `AsyncLocalStorage` 区分"work 内部的调用"与"事务在途时从外部发起的读"。**Rationale**：只标记"事务在途"会把合法的事务外读也拒掉——它本来就该排队等结算；实测去掉标记后用例 5s 超时，说明这条区分是必要的而不是装饰。**Date/Author**：2026-09-23 / L4 修复执行者 2。
- **Decision**：`close()` 用实例标记 + 队列槽内检查快速失败，而不是把 `close()` 排进队列（改成 async）。**Rationale**：`close()` 是同步方法，重启用例与集成用例都在同步位置调用它（改成 async 会让"关掉再打开"不再真的关掉）；标记让关闭后的调用立刻拿到端口级事实，在途事务在 COMMIT 前检查同一标记。**Date/Author**：2026-09-23 / L4 修复执行者 2。
- **Decision**：列表读改 `ORDER BY rowid`，并在计划里登记"端口未规定顺序"这一事实（本层计划遗留「端口注释没有写明读的排队语义与列表顺序」）。**Rationale**：端口注释不在授权面；两个实现顺序静默分叉会让列表顺序随存储实现漂移且没有门禁，而 `rowid` 用 4 行就把顺序对齐到替身的插入序。**Date/Author**：2026-09-23 / L4 修复执行者 2。
- **Decision**：跨实例自等的用例暂时落在 SQLite 专属文件，而不是共享组。**Rationale**：见本层计划遗留「跨实例自等的共享用例缺另一半」与 `Surprises & Discoveries` 8——替身同一动作是静默挂起，共享组会得到一条永远超时的用例；`providers/fake` 不在本轮授权面，不扩大越界改动。**Date/Author**：2026-09-23 / L4 修复执行者 2。
- **Decision**：级联 L2/L3 时，`suites/storage.js` 取 L4 的切分结构，只把 L2 对**既有用例**的两处语义改动带进 `storage-foundation.js`（默认绑定与 replace 各改用 `development` 域），L2 新增的断言不搬进组文件。**Rationale**：L2 把身份与成员关系面单独成文在 `suites/storage-identity-membership.js` 并原样继承，搬一遍就是同一事实的第二份权威副本；两处域改动则是必需的——新契约下第二个启用的 planning 挂载会被拒绝，不改这两条用例会在两个实现上都变红。**Date/Author**：2026-09-24 / L4 级联执行者。
- **Decision**：`putProviderBinding` 的两条语句包进原子作用域，而不是把所有约束在端口里预检。**Rationale**：见 D10——约束的权威在 002，端口只负责不留下半写状态；预检会把约束抄第二遍。**Date/Author**：2026-09-24 / L4 级联执行者。

- **Decision**：第五轮评审后本层改为关闭 #163，并把事务令牌的生命周期用例放回本层。
  **Rationale**：#163 验收 6 缺的只是「迁移重跑前有一次经端口写入」，补 2 行即字面满足，否则整栈没有任何一层关闭 #163。令牌的可变对象、结算检查、`finally` 置假、作用域实例共享关闭状态都在本层，而钉住它们的唯一用例第四轮时在 L5、级联时整栈丢失——去掉结算检查的后果是静默丢写。评审同时发现结算检查只在调用时做、写入推迟一个微任务：未 await 的 `tx.*` 可能在 ROLLBACK 之后以自动提交落库，改为执行时再查一次（同行替换）。代码体量 994 / 1000。
  **Date/Author**：2026-09-26 / agent（第五轮 MMP 评审，评审者就地修复）
- **Decision**（第四轮，补登）：体量 1110 → 981 靠把地基组留在 `suites/storage.js` 原地、不搬新文件实现，而不是插一个纯搬移 PR 或申请豁免；`replacePlanningProjections` 改走 `atomic`；断言多重集基线取 head 快照。
  **Rationale**：搬移行数减半且 0 条断言丢失（第五轮复核：de95f94 → head 逐句比对）。基线取 head 快照只能防「今后变少」、不能对照切分前的套件，第五轮评审列为测试债（#201）。
  **Date/Author**：2026-09-24 / agent（第五轮补登）

## Idempotence and Recovery

- `createSqliteStorage` 对同一文件可重复调用：迁移按 `schema_migrations` 跳过已应用版本（重启用例第 3 条钉住 no-op）。
- 测试各自使用 `mkdtempSync` 的独立临时目录，`after` 钩子删除；契约装配的临时目录由 `node:test` 的 `after` 回收。
- 若判别性实验改坏后测试变红：把 `packages/storage/sqlite/src/storage.ts` 还原到 Batch L4-B（修复轮之前）或 Batch L4-D（修复轮之后）的内容再复跑最窄命令；本层没有跨提交的中间状态需要清理。
- 修复轮的回退顺序：单独 `git revert` Batch L4-D 的提交会把队列与三条写者路径用例一起撤掉——它们是一个闭环，不能只回退一半（只回退队列会留下红的共享断言，只回退用例会让 P1 静默复活）。
- 修复轮 2 的回退顺序同理：单独 `git revert` Batch L4-E 的提交会把读队列、两条快速失败与四条用例一起撤掉；只回退用例会让 P1 脏读与两条 P3 静默复活。判别性实验改坏后要还原 `storage.ts`，用 `git checkout -- packages/storage/sqlite/src/storage.ts` 回到 Batch L4-E 的版本即可（本层没有跨提交的中间状态）。
- 若合并后发现设计错误：按提交逆序 `git revert` 本层的 3 个提交（`docs(review)` → `docs(storage)` → `feat(storage)`；实现与钉住它的用例在同一个 `feat(storage)` 提交里，不能只回退一半），002/003 的表与约束不受影响；本地库文件按临时目录处理，不存在需要保住的数据。**第五轮订正**：原文按 Batch L4-A–C 的提交描述，批次与提交早已不再一一对应。

## Interfaces and Dependencies

```text
packages/storage/sqlite/src/index.ts
  openDatabase(location: string | ':memory:'): WorkspaceDatabase   # 既有
  migrate(db: WorkspaceDatabase): { applied: number[]; version: number }  # 既有
  createSqliteStorage(location: string | ':memory:'): SqliteStorage       # L4 新增
  SqliteStorage: Storage & { readonly location: string; close(): void }   # close/location 不是端口方法；同一个类也充当 StorageTransaction（作用域由 #scoped 表达）；读与写共用同一条队列，事务作用域由 AsyncLocalStorage 标记
  NESTED_TRANSACTION_MESSAGE: string   # 约定文本：作用域实例再开事务（两个字面量各自维护，共享断言钉整串）
  OUTER_INSTANCE_MESSAGE: string       # 约定文本：work 里调外层实例（队列内自等）
  CLOSED_MESSAGE: string               # 约定文本：实例已关闭后的任何调用
```

依赖 Node 26 的 `node:sqlite` 与 `node:async_hooks`（都是内建，无第三方运行时依赖）、`@harness-projects/domain`、`@harness-projects/capabilities`；测试层额外依赖 `@harness-projects/provider-fake` 与 Node 内建 `node:test` / `node:fs` / `node:os` / `node:path`。无需网络、凭据或 provider API。

## Outcomes & Retrospective

**体量说明（2026-09-24，以回读为准）**：本层的代码体量一律以 `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` + `node scripts/rule-checks.mjs size "$BASE"` 回读，不写死数字（原文的「1103 / 1000」是观察时刻快照，不可复跑）。原因不是新增实现，而是**规则与"切分"这种改动的交互**：`size` 计「增删之和」，把单一套件文件拆成组文件，光是"移动"就要花预算。

**切分收缩（2026-09-24）**：已把切分改成**只抽出同步组与执行组**（`storage-sync.js` / `storage-execution.js`），地基组留在 `storage.js`——被移动的行减半（见 D1）。第四轮评审实测：本层 base 的 `suites/storage.js` 有 18 条用例（回读命令见 D1），三组继承 18（地基 7 / 同步 8 / 执行 3）、本层新增 6。

**原建议（已被上一条取代，保留以记录当时的判断）**：① 把"纯移动"从体量判定里排除（例如 `git diff -M` 的重命名/移动检测）——第四轮评审实测 `-M` / `-C` 都识别不出这次切分（组文件与原文件的相似度都低于阈值），且它是一次对全仓生效的规则变更；② 把套件切分单独拆成一个 PR；③ 为这一层批准一次性豁免并记入 Decision Log。

**实际交付**：

- 契约套件三组切分（条数以切分守卫回读；2026-09-24 切分收缩后地基组留在 `storage.js`，只抽出同步组与执行组）+ 切分守卫；内存替身跑全部三组，SQLite 只跑地基组。
- `createSqliteStorage(location)`：事务机制（`BEGIN IMMEDIATE` / `COMMIT` / 失败 `ROLLBACK`、嵌套事务运行时拒绝）、**实例级写队列**（直接写入与事务排同一条队列，事务在队列内持有到提交/回滚——同一实例只有一个写者路径）、工作区、绑定（先降级旧默认再插入）、实体、身份、规划投影（含 `replace` 作用域收敛）、仓库、修订号；20 个未实现方法表驱动显式抛出。
- 内存替身的事务作用域拒绝嵌套事务（L3 计划遗留「嵌套事务在运行时静默吞写」收口）。
- 写者路径语义的三条用例在共享地基组里对两个实现各跑一次。
- `tests/integration/storage-restart.test.js` 三条：关句柄重开逐字段不变、失败事务不留半写行、再跑迁移 no-op。
- 本计划与 `docs/README.md` 索引行。

**与计划的偏差**：① 原以为切分是"零改动"，实测发现两条用例缺少外键前置行（见 `Surprises & Discoveries` 1），按"不动断言、只补前置行"处理；② 嵌套事务的收口必须改到内存替身，越出控制计划的 L4 文件所有权 4 行（见 D3）；③ 修复轮里"按指令提升的两条用例"不足以钉住 P1-2，共享组因此多了一条回滚分支用例（见 `Surprises & Discoveries` 6 / D6），`ADDED_CASE_COUNT` 最终为 4；④ 体量压缩的规模远超"桩表驱动省 20 行"的预估（见 `Surprises & Discoveries` 7 / D7）；⑤ 修复轮 2 的三条 P3 里，跨实例自等的**共享**用例被替身现状挡住——评审的前提"替身已有同样的 `transactionScope` 手法"实测不成立（见 `Surprises & Discoveries` 8 / 本层计划遗留「跨实例自等的共享用例缺另一半」）；⑥ 修复轮 2 的约 76 行新增靠压缩本 PR 自己的文件才回到预算内（见 `Surprises & Discoveries` 10 / D9）。

### 遗留问题与技术债务

1. **投影 UPSERT 的覆盖分支无判别性用例**（`Surprises & Discoveries` 2）。**已收口（2026-09-23 修复轮 2）**：在地基组补了"同一 `(工作区, 实体)` 的第二次写入覆盖前值"，一次覆盖两个实现；实验 ⑥ 证明把 `DO UPDATE` 改成 `DO NOTHING` 会红。不再挂到同步组落地。
2. **仓库没有对应的外部身份种类**（`Surprises & Discoveries` 3）。收口条件：真实 provider 切片决定仓库身份的登记方式（新增种类或改用别的锚点）后，把契约夹具里的 `branch` 占位换掉。
3. **`replacePlanningProjections` 的实体清理在两个实现间不一致**（`Surprises & Discoveries` 4）。收口条件：core 需要"移除投影即移除实体"时，先决定身份与实体的生命周期，再补端口方法或约束；当前契约只覆盖投影集合。
4. **同步组与执行组共 20 个端口方法未实现**（本层范围之外）。它们是 `not implemented in L4` 的显式桩，`tests/contract/suites/storage-sync.js` / `storage-execution.js` 已就绪：下一层把方法实现后，把 `storageFoundationSuite` 的装配换成 `storageContractSuite` 即可跑全部三组。
5. **`repository` / `workspace_revision` 的引用完整性在两个实现间分叉**（2026-09-24 评审补登；PR 描述里登记过，计划里曾在重排编号时丢掉）。收口条件：替身补两条存在性检查（本轮 L2 已补），或共享组补用例。
6. **跨实例自等的共享用例缺另一半**（`Surprises & Discoveries` 8）。SQLite 侧已快速失败并有用例（`storage-contract.test.js`）；内存替身的 `#mutate` 不检查 `#transactionScope`，同一动作是静默挂起（实测 1.2s 不 settle）。收口条件：给 `packages/providers/fake/src/storage.ts` 的 `#mutate` 加一行作用域检查（约 2 行），然后把该用例从 SQLite 专属文件提升进共享地基组。该文件不在本轮授权面（控制计划把它记为"其它包"；D3 的 4 行越界属于上一轮，本轮不扩大）。
7. **端口注释没有写明读的排队语义与列表顺序**（本轮 P1 / P3 的收口面之一）。评审建议把"读不得暴露未提交写入""顺序不保证、调用方自行排序"写进 `packages/capabilities/src/storage.ts`，但该文件不在本轮授权面。收口条件：下一轮在端口 `Storage` 的读方法组上补一段说明——读不得暴露未提交写入（实现可选择排队或快照，差别是读取时刻而不是可见性）、列表顺序不保证；本层 SQLite 用 `rowid` 与替身对齐只是实现选择，不是端口承诺。
8. **替身与 SQLite 在事务语义上的三处分叉**（第五轮评审登记）：读取时刻（事务在途时的外部读）、活性（work 里调外层实例）、作用域生命周期（结算后与未 await 的 `tx.*`，SQLite 已在执行时再查令牌并拒绝，替身照常落库）。收口条件：替身补作用域令牌，或端口注释把三者写成「实现可选的更严行为」。
9. **投影写入的两处分叉**（第五轮评审登记）：`putPlanningProjection` 的 `workspaceId` 替身以记录为准、SQLite 以参数为准；`replacePlanningProjections` 的 items 指向不存在的实体时替身接受、SQLite 以外键拒绝。收口：共享地基组补两格并统一语义（#201）。
10. **同一进程对同一文件开第二个句柄**（第五轮评审登记）：事务从 `BEGIN IMMEDIATE` 持锁到 await 结束，`node:sqlite` 是同步驱动、`busy_timeout = 5000`，第二个句柄写入会冻结事件循环约 5 秒后抛驱动文案。今天没有宿主开两个句柄。收口：按 realpath 键控复用句柄，或把 `SQLITE_BUSY` 映射成端口级错误。

## Bottom Change Note

- 2026-09-23：首次创建。原因：控制计划 Batch L4 要求本层建立自己的 ExecPlan（D9），而用户把本层范围收窄为"机制 + 地基面"，需要一份自包含的计划说明交付边界、三组切分与守卫、以及四条判别性证据。
- 2026-09-23（修复轮）：独立对抗验证对 head `8333cec` 判 `partially_falsified`，两条 P1 都在"SQLite 的事务语义与内存替身不等价"上。本轮按根因加实例级写队列（D5）、把写者路径语义提升进共享组并补上能真正分辨 P1-2 的回滚分支（D6）、在 ≤1000 行内完成体量压缩（D7）；判别性实验 ① ② 的实际摘要见 `Progress`。
- 2026-09-23（修复轮 2）：评审 P1 实测 SQLite 的读路径绕开写队列、把未提交写入暴露给事务外的读者（内存替身不会），另有两条 P3（work 里调外层实例无限挂起；`close()` 把驱动文案抛给调用方）与三条"断言没有判别力"。本轮按根因让读与写共用同一条队列（D8）、用 `AsyncLocalStorage` 与实例标记把三类误用变成可识别错误、把读隔离与投影覆盖提升/补进共享组并把嵌套事务断言收紧到整串（D9）；证据基准 `a646073` 全部改为实测 base `19f931ee`，条数账按实测更正（见验收表第 1 项）。
- 2026-09-24（级联 L2/L3 重写）：L2/L3 被重写成"连接锚点 + 工作区挂载"两表（`provider_binding` 只留 `(id, implementation_key)`）并在 `tests/contract/suites/storage-identity-membership.js` 里独立成文。本轮在恢复锚点 `backup/storage-sqlite-port2-pre-review-response` 之后 `git rebase --onto 8f11e38 3e255ed`，把绑定落库改成双表并让两条语句同属一个原子作用域（D10），`suites/storage.js` 取本层的切分结构、两处既有用例改用 `development` 域，SQLite 侧注册身份地基组（同步组仍等 L5/L6）。证据基准与条数账改为当时的 base（`8f11e38` / 994/1000，观察时刻快照，不可复跑）；2026-09-24 已一律改为 `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 回读与 `PRE_SPLIT_CASE_COUNT` 实测值。全门禁复跑见 `Progress` 与验收表第 20 项。
- 2026-09-26：第五轮 MMP 评审无 P0 / P1，评审者就地修复：结算检查改到执行时、令牌生命周期用例放回本层（含未 await 写入的一格；三个变异各红）、#163 验收 6 补端口写入并改为关闭 #163、上游路径指向已归档的 L2 / L3 计划、恢复路径按实际提交描述、遗留清单补登三处分叉；切分守卫基线的来源与 SQLite 注册守卫转 #201。
