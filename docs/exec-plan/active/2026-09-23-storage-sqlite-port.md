# Storage 端口落地（L4 地基面 + L5 同步面）ExecPlan

> 状态：Active（2026-09-24：L4 修复轮 2 见 Batch L4-E、级联 L2/L3 重写见 Batch L4-F；L5 规划同步面见 Batch L5-A / L5-B / L5-C，修复轮见 Batch L5-D，评审修复轮见 Batch L5-E；**重建**见 Batch L5-F——把同步面搬到 L4 新底并把写者 / 读者路径机制统一收进基类；**级联到新 L2/L3 与级联后的 L4** 见 Batch L5-G；**把 L3 的新 003 与 L4 修复轮 2 的语义落到 L5 的新位置** 见 Batch L5-H）
> 创建：2026-09-23
> 范围：L4 / issue #163（控制计划里的 #120 / #5）与 L5 / issue #164。**L4 只交付机制与地基面**——事务机制、契约套件的三组切分、以及工作区 / 绑定 / 实体 / 身份 / 规划投影 / 仓库 / 修订号的 SQLite 实现；**L5 交付规划同步面**——成员关系 / 字段值 / 观察账本 / 游标；账本主体 = **端口主体** `(bindingId, objectKind, externalId)`（连接级），观察**不解析落点**（**Superseded by L5-H（2026-09-24）**：原文写"观察落点 = 成员关系"的解析规则，已被账本主体改成端口主体取代，见 D11 的 Superseded 标注）。执行组的端口方法仍显式抛出 `not implemented in L4: <method>`。
> 上游输入：`docs/exec-plan/active/2026-09-23-sqlite-v1-stack.md`（控制计划 Batch L4）、`docs/exec-plan/completed/2026-09-23-storage-control-facts.md`（L3，遗留「嵌套事务在运行时静默吞写」）、`docs/exec-plan/completed/2026-09-23-storage-identity-membership.md`（L2）、`packages/capabilities/src/storage.ts`（端口契约）、`tests/contract/suites/storage-sync.js`（L5 的规格，7 条）。

## Purpose / Big Picture

完成后，`Storage` 端口第一次有了真实持久化实现的地基：`createSqliteStorage(location)` 打开（必要时创建）库、应用缺失迁移，并在 002/003 建出的表上实现事务与地基面；"重启后不变"由**关掉句柄再打开同一个文件**证明，而不是内存里导出/导入内部状态。契约套件按端口面切成地基 / 同步 / 执行三组，内存替身跑全部三组，SQLite 本层只跑地基组——两组测试的分工因此是显式的，而不是靠"未实现"堆出来的假红。

最小成功证据：

1. `node --test tests/contract` 全绿（两个实现都跑切分的三组与身份面两组）。**条数一律以命令回读为准，不写死**；原文的 501/501 与"内存替身 22 条三组 + 身份面 8 条；SQLite 地基 12 + 同步 7 + 身份面 8 条"是观察时刻快照，不可复跑。
2. `node --test tests/integration` 全绿：重启用例三条（端口写入的工作区/绑定/实体/身份/投影/仓库/修订号在 `close()` 后重开逐字段不变；失败事务不留半写行；对已迁移文件再跑迁移是 no-op）与 `storage-sync-surface.test.js` 的同步面用例（条数以命令回读为准；原文的 40/40 与"十条"是观察时刻快照）。
3. 判别性实验（改坏 → 红 → 还原 → 绿）有实际摘要，见 `Progress`（L4 修复轮 2 补实验 7–10，L5 补实验 11–21，重建补实验 22–23；条数是观察时刻快照：23 条）。

**L5 补记（2026-09-23）**：完成之后，规划同步面也落在同一个文件库上——成员关系（R1）、字段值（R2）、观察账本与定序（R4）、增量与对账游标（R5）全部由 SQLite 实现，契约装配里 SQLite 从"只跑地基组"变成"地基组 + 同步组"（条数以 `node --test tests/contract` 回读为准；原文的 10 + 7 = 17 是观察时刻快照），同步组的最后一条用例会真正调用 `restart`（L4 指出那条闭包在地基组里是死代码）。

L5 的最小成功证据：

1. `node --test tests/contract` 全绿（SQLite 的 storage 契约用例从只跑地基组扩到地基组 + 同步组；条数以命令回读为准；原文的 432/432、10 → 17、内存替身 20 条都是观察时刻快照，修复轮另加 3 条装配守卫与版本缺失用例，见 L5-D）。
2. `node --test tests/integration/storage-sync-surface.test.js` 全绿（条数以命令回读为准；原文的 8/8 是观察时刻快照）：文件库上的去重账本（投递 N 次与一次的可观测摘要相同、重开句柄后仍去重；**同一主体、同一接收时刻的两条不同观察互不顶掉**）、定序（更旧不落、同版本整快照替换）、`committed_observation` 取最新行、成员关系后者胜、引用完整性两条、游标按作用域隔离，外加「观察不解析落点：没有成员关系的内容也必须被应用，且不凭空造一条成员关系」（**Superseded by L5-H（2026-09-24）**：原文写"观察落点解析不到必须显式失败"）。
3. 判别性实验（改坏 → 红 → 还原 → 绿）有实际摘要，见 `Progress`（原五条 + 修复轮的观察键与装配守卫两条；条数是观察时刻快照：7 条）。

## Context and Orientation

- 端口：`packages/capabilities/src/storage.ts`。`Storage.transaction(work)` 的语义是"要么全部生效、要么全部不生效"；`StorageTransaction = Omit<Storage, 'transaction'>` **只是类型层**的排除，运行时不移除任何方法（L3 计划遗留「嵌套事务在运行时静默吞写」记录了内存替身因此在事务内静默吞掉内层写入）。
- 表：`packages/storage/sqlite/migrations/002_identity_membership.sql`（工作区、绑定、实体、身份、成员关系、字段值、投影）与 `003_control_facts.sql`（执行、关系、观察、游标、写尝试、修订号）。`repository.external_identity_id` 与 `workspace_revision.workspace_id` 都是外键，`openDatabase` 显式打开 `foreign_keys`。
- 契约套件：`tests/contract/suites/storage.js` 是切分前的单一入口，装配形状是 `{ label, makeStorage(), restart(storage) }`；装配点在 `tests/contract/storage-contract.test.js`。切分前条数一律回读本层 base：`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`git show "$BASE":tests/contract/suites/storage.js | grep -c '^  test('`（观察时刻快照 18；原文的 232 行 / 16 条是观察时刻快照）。**Superseded by 2026-09-24 的切分收缩**：只抽出同步组与执行组，地基组留在 `storage.js`（见 D1）。
- 行为参照：`packages/providers/fake/src/storage.ts`（内存替身）是"同一套断言跑在两个实现上"的另一半。
- 术语：**地基组** = 工作区 / 绑定 / 实体 / 身份 / 投影 / 仓库 / 修订号 + 事务机制；**同步组** = 成员关系 / 字段值 / 观察 / 游标；**执行组** = 执行上下文与运行 / 关系 / 写尝试。

工作边界：只在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录改文件；不 push，不做 `gh` 写操作，不改迁移文件、`packages/capabilities/**`、`packages/core/**`、`packages/domain/**`、其它层计划与控制计划。

## Design / Spec

### D1. 契约套件按端口面切成三组，切分是纯移动（2026-09-23）

**判据**：L4 只交付地基面，而套件原本是一个全有或全无的入口——SQLite 注册它就会因为未实现的同步/执行方法变红，不注册就一条地基断言也跑不到。"让实现各注册自己已交付的部分"要求套件本身按端口面可分组。

**决定**：拆成 `storage-foundation.js` / `storage-sync.js` / `storage-execution.js` 三个导出（`storageFoundationSuite` / `storageSyncSuite` / `storageExecutionSuite`），共享夹具放 `storage-fixtures.js`，`storage.js` 只做装配、守卫与组合入口 `storageContractSuite`。断言逐条原样搬移：**没有删除、没有放宽**。

**Superseded by 2026-09-24 的切分收缩（第四轮评审响应）**：`storage-foundation.js` 不再存在——只抽出同步组与执行组（`storage-sync.js` / `storage-execution.js`），地基组留在 `storage.js`，`storage.js` 同时保留共享夹具、装配、守卫与组合入口；被移动的行因此减半，体量回到预算内。三组继承条数不变（地基 7 / 同步 8 / 执行 3），本层新增 6。

**守卫**：`PRE_SPLIT_CASE_COUNT`（来处：**回读本层 base（L3 head）的 `tests/contract/suites/storage.js`**——`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`git show "$BASE":tests/contract/suites/storage.js | grep -c '^  test('`，观察时刻快照 18）、`ADDED_CASE_COUNT`（本层新增，观察时刻快照 6）、`INHERITED_CASE_COUNTS = { foundation: 7, sync: 8, execution: 3 }`（三组继承之和必须等于 `PRE_SPLIT_CASE_COUNT`）。守卫用"只计数的注册器"数三组条数：删掉任何一条 `register(...)` 都会变红，而不是让覆盖静默缩水；逐组账见 `tests/contract/storage-contract.test.js` 的 `CASE_LEDGER`。**Superseded by 2026-09-24 的切分收缩**：原文的 16 / 4 / {6,7,3} 与 `storage-foundation.js` 都是观察时刻快照——第四轮评审实测本层 base 有 18 条（地基组继承 7 条），地基组现留在 `storage.js`（见 D1）。**订正 2026-09-24**：原文把 `8f11e38` 写成"新 base"，该提交在第二次级联后已不是 head 的祖先，来处改为上面的回读命令。级联 L2/L3 时，`storage.js` 里地基组的「一个工作区同一时刻只有一个默认绑定」与「replace 收敛指定 binding」改用 `development` 域（新契约下 planning 域只允许一个启用的挂载，写第二个会被拒绝而不是降级），**断言文本不变**。

**修复轮补充（D16）**：这一层守卫数的是**组文件里注册了多少条**，与某个适配器是否装配了这组无关——删掉一整条装配调用（例如 SQLite 的同步组）时三组条数都不变，总条数只是从 432 静默掉到 425，守卫全绿。因此补第二层"装配守卫"：装配走唯一的 `assemble(adapter, groups)` 入口并记录每个标签**实际注册**的条数，守卫拿它与一份独立写下的 `EXPECTED_ASSEMBLY` 逐标签、逐组核对。

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

`AsyncLocalStorage` 是这里唯一能区分"work 内部的调用"与"事务在途时从外部发起的调用"的手段：单纯在队列槽上标记"事务在途"会把合法的事务外读也误判成自等（队列化的外部读本来就该等）。判据见实验 8 / 9。

### D9. 读隔离提升进共享组、投影覆盖补用例、嵌套断言收紧到整串（2026-09-23 修复轮 2）

**判据**：三条都是"断言没有判别力"的同一类缺口——(a) 读隔离只写在替身专属文件里（`git grep 未提交 tests` 只命中该文件），所以 SQLite 的脏读不会被任何共享断言发现；(b) `putPlanningProjection` 的 `DO UPDATE` 分支从未被执行（套件里同 `(工作区, 实体)` 从不写第二次，`replace` 只被调用一次且 `items = []`），改成 `DO NOTHING` 也不会红；(c) 嵌套事务断言只匹配 `/嵌套事务/`，两个字面量可以各自漂移而套件仍绿。

**决定**：① 把"未提交的写入不得被事务外的读看到"提升进共享地基组（2026-09-24 切分收缩后在 `tests/contract/suites/storage.js`，见 D1），措辞改成两个实现都能满足的形式（断言"读到的不是未提交的值"，而不是替身专属的"读到 `undefined`"），替身专属文件里的重复项删除；② 在共享组补"同一 `(工作区, 实体)` 的第二次写入覆盖前值"，一次覆盖两个实现；③ 嵌套事务断言从正则收紧到**整串**约定文本（`NESTED_TRANSACTION_MESSAGE` 在共享组里独立声明一份字面量，实现侧改措辞即红）；④ 列表读按 `rowid`（插入序）返回，与内存替身的数组序一致——端口没规定顺序（`packages/capabilities` 不在授权面），两实现静默分叉比"写明不保证"更糟，见本层计划遗留「端口注释没有写明读的排队语义与列表顺序」。

**体量**：本轮新增约 76 行会把 head `6526ded` 的 999/1000 推过预算，因此把本 PR 自己的 `storage.ts` 从 179 行压到 118 行（合并适配器类留下的重复注释、单语句方法一行、列清单两行一条），新增用例按仓库既有紧凑风格书写。**没有删除或放宽任何既有断言**，除了本轮按要求提升的那一条（从替身专属文件移入共享组）与收紧的那一处（正则 → 整串）。最终 992/1000（观察时刻快照，不可复跑；体量以 `node scripts/rule-checks.mjs size "$BASE"` 回读为准，`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`）。


### D10. 同步面与写者路径同文件：地基面继承同步面（2026-09-23）

**判据**：L5 要加 10 个方法（成员关系 3、字段值 2、观察 1、游标 4），加进 `storage.ts` 会到 260 行上下，超过单文件 ≤200 行；而写者路径（`mutate` / `write` / `#queue` / `scoped`）是两个面共用的机制——复制一份就是同一事实的第二个家。

**决定**：新建 `storage-sync.ts`，把**写者路径机制与同步面的 10 个方法**放在同一个基类 `SqliteSyncSurface` 里，`SqliteStorage extends SqliteSyncSurface` 只保留地基面与 `transaction` / `close`。`#queue` 与 `scoped` 由基类持有，子类通过 `protected` 成员使用；事务作用域实例仍由子类构造（`new SqliteStorage(location, db, true)`），语义与 L4 完全一致——D5 的三条写者路径用例在 SQLite 上继续绿。

**被放弃的方案**：① 把 10 个方法逐条写进 `storage.ts`（超 200 行）；② 自由函数 + 委托（写者路径在方法定义处不可见，与 L4 D7 放弃"包装式写方法清单"同因）。

### D11. 观察落点：账本主体是成员关系，解析不到就显式失败（2026-09-23）（**Superseded by L5-H（2026-09-24）**，见本节末）

**判据**：端口的 `recordObservation` 只带 `(bindingId, subject: (objectKind, externalId))`，而 003 的 `sync_observation` 主键是 `(workspace_id, item_external_id, observed_at)`，并以外键指向成员关系（ADR-0002 写明"`sync_observation` 的外键目标是成员关系，不是内容身份"）。两者之间必须有一次解析，否则观察没有落点。

**决定**：按 `(绑定 → 工作区, 内容种类 + 内容外部 id → 成员关系)` 解析，`ORDER BY item_external_id LIMIT 1` 取确定的一条；**解析不到就抛错**（`观察无法挂载：…`）。不返回 `false`：`false` 的端口语义是"重复或乱序"，把"没有落点"塞进去会让调用方把丢失的事实读成"已经处理过"；也不凭空造一条成员关系——那是把推导塞进 storage（控制计划 D6：推导属于 core）。

**去重键的落点**：`sync_observation` 没有 `dedupeKey` 列，因此整条 `ObservationRecord`（含 `observation.dedupeKey`）以 JSON 存进 `snapshot_json`，去重按 `json_extract(snapshot_json, '$.observation.dedupeKey')` 查。账本没有读回接口（控制计划 D6 刻意不新增），不为此加第二列或第二张表。

**修复轮更正（D14）**：这一条被实测证伪，见 `Surprises & Discoveries` 13——`dedupeKey` **必须**是账本键的一部分，不能只躺在 `snapshot_json` 里。控制计划 D12 允许发布前重写迁移，因此 003 改成 `PRIMARY KEY (workspace_id, item_external_id, observed_at, dedupe_key)` + `(binding_id, dedupe_key)` 唯一索引，去重查询改成按列查；`snapshot_json` 只作为整条观察的载体，不再承担键的职责。

**代价（登记为遗留 5）**：core 的同步路径（`packages/core/src/bootstrap.ts` 的 `recordObservations`）只写投影与观察、不写成员关系，因此它在 SQLite 上会抛错，而内存替身不会。这不是本层引入的偏差：落点解析本来就不该由 storage 凭空补一条成员关系（控制计划 D6：推导属于 core）。**评审修复轮更正**：L3 的 `8cf7d18` 去掉账本外键之后，库层不再挡这件事，挡它的是端口的落点解析（`观察无法挂载：…`）——两条后果不变，只是报错来源从 DDL 换成端口，且不再有"先删成员关系就得先删账本行"的连带。

**Superseded by L5-H（2026-09-24）**：账本主体 = **端口主体** `(binding, objectKind, objectExternalId)`、作用域是**连接**，观察**不解析落点、也不要求成员关系存在**（`workspace_id` / `item_external_id` 已不在键里；见 L3 的新 003 与本层 Batch L5-H）。原文保留以记录当时的决定路径与代价。

### D12. 成员关系"后者胜"清掉旧条目上的字段值，但**不清**观察账本（2026-09-23；评审修复轮 P1 修订）

**判据**：R1 的"后者胜"意味着同 `(工作区, 项目, 内容)` 换了 `item_external_id`——旧条目**已经不存在**。`planning_field_value` 以外键指向成员关系，而 DDL 没有 `ON DELETE CASCADE`：不先清掉旧条目上的字段值，删除会被外键挡住；留着又是挂在不存在条目上的行。

**决定**：`putMembership` 在同一个队列槽内先删"同内容、不同条目"的旧条目及其**字段值**，再 UPSERT `(工作区, 条目)`。同条目重写走 UPSERT 的更新分支、**不删行**——否则幂等覆盖会把挂在同一条目上的字段值一起清掉（集成用例的第二段钉住这一点）。

**评审修复轮修订（P1）**：原决定还连带 `DELETE FROM sync_observation`，那是"账本外键指向成员关系"逼出来的顺序。它把账本变成**可删**的，于是"同一观察再投递必须返回 `false`"在换条目这一格上失效——调用方正是据此决定是否重放副作用（与 D14 修的 P0 是同一症状的另一扇门）。根因在 DDL 而不在这一行：L3 本轮以 `8cf7d18` 去掉该外键（账本是只追加的历史，成员关系是会被改写的当前挂载点），本层随之删掉这条清理。判据落在集成用例上：先投递（`true`）→ 换条目 → 同一 `dedupeKey` 再投递仍 `false`、账本行数不变。

**两个实现的差异（登记为遗留 6）**：内存替身换条目时保留旧条目上的字段值（孤儿行），SQLite 侧连带删除。契约套件没有覆盖"换条目后旧条目的字段值"，因此两边都能通过。 **订正 2026-09-24（第四轮评审）**：这句不再成立——身份同步组用例「成员关系被取代时旧条目名下的字段值一并删除」在两个实现上都跑，替身与 SQLite 都连带删除（判据见遗留 6 的收口标注）。原文保留以记录当时的实测。

### D13. 契约装配为 SQLite 预置最小前置行，而不是放宽用例（2026-09-23）

**判据**：同步组的用例直接投递观察（不建工作区、绑定、成员关系），并给一个只在对账游标里出现过的工作区 `ws-other` 写游标。内存替身没有外键，所以它不需要前置行；SQLite 的 `sync_observation` 与 `reconcile_cursor` 有外键，实测缺父行时是 `FOREIGN KEY constraint failed`（Surprises 11/9）。本层 `tests/contract/suites/**` 冻结，前置行不能写进用例。**评审修复轮更正**：账本外键已由 L3 的 `8cf7d18` 去掉，但前置行仍然必要——投递观察要能解析到成员关系（D11），`reconcile_cursor` 也仍有工作区外键；装配点不变。 **Superseded by L5-H（2026-09-24）**：观察不再解析落点，"投递观察要能解析到成员关系"这一条前提已消失；`reconcile_cursor` 的工作区外键仍要求前置行。

**决定**：在装配点（`tests/contract/storage-contract.test.js`）为 SQLite 的同步组预置最小前置行：工作区 `ws-1` / `ws-other`、绑定 `binding-1`、一条挂在 `issue-1` 上的成员关系（项目与条目 id 用 `contract-seed-*`，不落进任何被断言查询的项目）。**断言一字未改**，与 L4 给两条地基用例补前置行同型（Surprises 1）。**Superseded by Batch E（2026-09-26）**：第四轮已把同步组的前置状态直接写进 `suites/storage-sync.js` 的用例（只走端口），装配点不再 `seedSyncPrereqs` 直插；`suites/**` 不再冻结。

**被放弃的方案**：① 让实现接受悬空引用（关外键或去掉外键）——那是把 DDL 的约束改成"实现说了算"；② 只注册同步组里能过的用例——覆盖面变成装配侧的过滤开关（L4 D1 已否决同型方案）；③ 让 `recordObservation` 自己补前置行——凭空造工作区 / 绑定 / 成员关系。

### D14. 观察账本的键含 `dedupe_key`，committed 视图补追加序 tie-break（2026-09-23 修复轮）

**判据**：独立对抗验证在 head `0aa7c34` 上判 `partially_falsified`，P0 实测：同一 `(工作区, 条目, receivedTime)` 下，第二条**不同 dedupeKey** 的观察走 `ON CONFLICT (workspace_id, item_external_id, observed_at) DO UPDATE` 把第一行顶掉；第一行再投递返回 `true`（调用方据此重放副作用），账本永久丢一条。根因是键：`observed_at` 存的是**本地接收时刻**，同一毫秒/秒收到两条不同观察是可能的，而"两条不同的观察"在只按 (主体, 接收时刻) 做键的表里物理上无法并存。

**决定**：① 003 的 `sync_observation` 加 `dedupe_key TEXT NOT NULL` 并纳入主键（`(workspace_id, item_external_id, observed_at, dedupe_key)`），另加 `(binding_id, dedupe_key)` 唯一索引把端口的去重键变成库级事实；② `recordObservation` 的插入改回**裸 `INSERT`**（账本只追加，冲突是结构性错误，不再有"顶掉"这条路径）；③ 去重查询从 `json_extract(snapshot_json, …)` 改成按 `dedupe_key` 列查；④ `committed_observation` 视图补末级 tie-break `newer.rowid > ledger.rowid`——键变了之后同主体、同版本、同接收时刻会有两行合法并存，没有这一级视图会给出两行 committed。tie-break 取**追加序**而不是 dedupeKey 字典序：账本上的"整快照替换"就是追加，追加序即替换序。

**依据**：控制计划 D12 允许 MVP 首次发布前重写迁移；端口契约 `(bindingId, dedupeKey)` 唯一是 R4 的原文，把它做成库级约束比在端口里"先查后插"更强（查与插之间的窗口在库层被关掉）。

**被放弃的方案**：① 保留 `ON CONFLICT` 但把冲突目标改成新主键——那等于把"同一观察落两次"从结构性错误降级成一次静默覆盖；② tie-break 用 `dedupe_key` 字典序——确定但任意，没有任何调用方要求"key 大的胜"。

### D15. `sourceVersion: undefined` 读回时还原成 `undefined` 再比较（2026-09-23 修复轮）

**判据**：P1-a 实测：两条 `sourceVersion: undefined`（不同 key）在内存替身上都返回 `true`，SQLite 第二条返回 `false`——一条**合法的新事实**被静默丢弃。机理是编码：`undefined` 落成空串（`updated_at` 是 NOT NULL），读回后与 `undefined` 比较得到 -1，于是被判成乱序。

**决定**：`#committedVersion` 读回列值后过一层 `columnToVersion`（`'' → undefined`），再做 `compareVersions`。落库编码不变（空串仍是"版本最小"的载体），只有读回这一处还原。证据是 `tests/contract/storage-contract.test.js` 里对两个实现各跑一次的"两条 sourceVersion 缺失的观察（不同 dedupeKey）都必须被应用"。

**被放弃的方案**：① 把 `updated_at` 改成可空列——视图与比较都要处理 NULL 的三值逻辑，换不来任何东西；② 在写入侧禁止 `undefined`——`ProviderObservation.sourceVersion` 的类型就是 `string | undefined`，禁止等于改端口契约。

### D16. 装配守卫按"实际注册条数"核账（2026-09-23 修复轮）

**判据**：P1-b 实测：删掉 SQLite 的同步组装配后 `node --test tests/contract` 仍 422/422 全绿，条数从 429 静默掉到 422——`suites/storage.js` 里"或整组不再被装配都会变红"这句是**假的**（`countSuiteCases` 数的是组文件，不是装配结果）。

**决定**：装配收敛到唯一的 `assemble(adapter, groups)` 入口，它把每个标签**实际注册**的条数记进 `REGISTERED`；守卫拿它与独立写下的 `EXPECTED_ASSEMBLY`（标签 → 必须装配的组）逐标签核对：标签缺失（整组不再被装配）、组清单不符、组内条数与组文件不符，三种都变红。同时把那句注释改成它真正成立的范围。

**被放弃的方案**：① 从 `assemble` 的实参推导期望——删掉装配调用会连期望一起删掉，守卫永远绿，正是要消灭的缺陷；② 直接断言 `node --test` 输出的总条数——总条数是易失值，且会被无关的用例增减扰动。

### D17. committed 的主体是 `(binding_id, item_external_id)`（2026-09-23 评审修复轮 P2）（**Superseded by L5-H（2026-09-24）**，见本节末）

**判据**：`#committedVersion` 原先按 `(workspace_id, item_external_id)` 取全局赢家，而端口的 subject 是 `(bindingId, objectKind, externalId)`，AGENTS.md §1.1 不变量 2 明确允许一个工作区连接多个提供方。实测：`fake` 绑定先提交 `v07:11`，第二个绑定的**首条**观察（`v07:00`，它自己序列里的第一条）被拿去和别人的版本比大小，判成乱序后静默返回 `false`——调用方把一条合法的新事实读成"已应用过"，且没有任何错误。同一作用域还有第二个后果：条目 id 被重新登记给另一个内容时，旧内容的账本行仍挂在该条目上，新内容的合法观察同样被判成乱序。

**决定**：`#committedVersion(bindingId, itemExternalId)` 的查询主体改成 `binding_id + item_external_id`，与端口 subject 一致；committed 视图的同一维度由 L3 的 `8cf7d18` 同批改（本层不重复改迁移）。证据：集成新增"两个绑定观察同一内容时各自的版本序列互不影响"（第二个绑定的首条观察必须 `true`，两个绑定各自更旧的版本仍必须 `false`）。

**未收口的一格**：主体含 binding 只解决"同一个内容被两个绑定观察"；"同一个条目被重新登记给另一个内容"仍会串版本序列（见遗留 12）。

**被放弃的方案**：① 保留 `(工作区, 条目)` 并在端口注释里写死"committed 主体是工作区 + 条目"——那是把不变量 2 的合法场景判成乱序，写死注释只会把静默丢事实变成有文档的静默丢事实；② 把 binding 并进 `item_external_id` 的解析（例如按绑定各造一条成员关系）——凭空造成员关系是把推导塞进 storage（D11）。

**Superseded by L5-H（2026-09-24）**：主体已与端口 subject 逐字相同 `(binding, objectKind, objectExternalId)`，条目 id 不再参与；`(binding_id, item_external_id)` 只是中间形状。

### D18. 003 重写后的库自检：显式报错，而不是驱动级报错（2026-09-23 评审修复轮 P3）

**判据**：`migrate()` 只按**版本号**判断迁移是否已应用（`assertAppliedIsManifestPrefix`），不校验迁移体内容。重写 003 之后，一个已应用版本 3 的旧库保留旧列集合，`recordObservation` 第一次调用才炸在驱动层。本层实测（把库退回重写前的 7 列形状后打开）：自检关掉时 `recordObservation -> no such column: dedupe_key`；打开时打开库这一步就抛出带处置的显式错误。

**决定**：`SqliteSyncSurface` 的根实例在构造时做一次便宜的自检——`schema_migrations` 含版本 3 且 `sync_observation` 缺 `dedupe_key` 列时抛 `本地库是重写前的 003（sync_observation 缺 dedupe_key）：请删除库文件重建`。放在同步面的构造点，是因为本层的允许面只有 `storage-sync.ts`（迁移运行器与 `createSqliteStorage` 分别归 L3 / L4），而账本正是同步面的表。未迁移（没有 `schema_migrations`）时不判定，交给 `migrate()` 的清单前缀检查。

**被放弃的方案**：① 让 `migrate()` 校验迁移体哈希——那是把"发布前可整份重写"的既定取舍改成一套内容寻址机制，超出本层范围；② 什么都不做，把处置写进文档——评审者撞上的是原始 SQLite 报错，而不是一句可执行的处置。

### D19. `snapshot_json` 原样落库，脱敏责任在 provider（2026-09-23 评审修复轮 P3，安全）

**判据**：`snapshot_json` 存的是 `JSON.stringify(record)`，即整条 `ProviderObservation`，其中 `payload: unknown` 完全由 provider 控制、未经任何处理；webhook / poll 的原始 payload 恰恰最容易带 token、签名或个人信息。同层的投影面有显式脱敏模型（`contentKind: 'redacted'` + `RedactionReason`），而 `packages/capabilities` 与 L3 控制计划都没有关于 `ProviderObservation.payload` 落库形态的表述——这是一个没写下来的决定。

**决定**：取"写死在端口注释"这一侧——`snapshot_json` **原样**持久化整条 `ProviderObservation`，storage 不裁剪、不改写、不丢弃；"payload 必须由 provider 先脱敏"是 provider 侧的写入前义务。`packages/capabilities` 不在本层允许面，因此这句话先写进 `storage-sync.ts` 的模块注释与本计划，并把"端口注释是否要写死这一条"登记为遗留 11（收口条件=允许改 `capabilities` 时）。

**被放弃的方案**：① 落库前过一层脱敏——storage 不知道各 provider 的 payload 语义，猜出来的脱敏会静默丢字段，而且让"事实"在落库时被改写（账本是历史）；② 只记 `payloadHash` 不记 `payload`——R4 的账本要求整快照可回放，丢了 payload 就没法回放。

### D20. 绑定落库按"连接锚点 + 工作区挂载"两表写，且两条语句同属一个原子作用域（2026-09-24 级联）

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
| 把同步面 10 个方法逐条写进 `storage.ts` | 超单文件 ≤200 行；写者路径也不该有两个家（D10） |
| 观察解析不到落点时返回 `false`，或自动补一条成员关系 | `false` 的语义是"重复或乱序"，会把丢失的事实读成"已处理"；自动补成员关系是把推导塞进 storage（D11） |
| 在 `src` 里运行时另建一张观察账本表绕开外键 | 同一事实的第二个家，且绕过 002/003 的 D3/D10 追溯规则（D11 / D13） |
| 把同步组的前置行写进 `suites/storage-sync.js` | 本层 `suites/**` 冻结；断言是规格、前置行是"在什么状态下检验"，与 L4 Surprises 1 同型，只能落在装配点（D13）。（**Superseded by Batch E（2026-09-26）**：前置状态已写进 `suites/storage-sync.js` 的用例，装配点不再直插） |
| 把"committed 主体是工作区 + 条目"写死进端口注释 | 见 D17：那是把不变量 2 的合法场景判成乱序，写死注释只是把静默丢事实变成有文档的静默丢事实 |
| 落库前给 `payload` 过一层脱敏 | 见 D19：storage 不知道各 provider 的 payload 语义，猜出来的脱敏会静默丢字段，也让账本里的"事实"被改写 |
| 让 `migrate()` 校验迁移体哈希以识别重写前的 003 | 见 D18：那是把"发布前可整份重写"改成一套内容寻址机制，超出本层范围 |
| 换条目时把旧账本行改挂到新条目上（re-home） | 见 D12：账本只追加，改挂是删行的另一种写法；它还会把旧内容的历史并进新条目的版本序列 |
| 让读另开一条只读连接去观察已提交快照 | 第二条连接要在 `close()` 生命周期、`BEGIN IMMEDIATE` 的写锁与 `busy_timeout` 上各写一套语义；同一实例两个句柄还会让"重开同一文件"的判据失真 |
| 只在队列槽上标记"本实例事务在途"，不用 `AsyncLocalStorage` | 分不清"work 内部的调用"与"事务在途时从外部发起的调用"，会把合法的事务外读也拒掉（见 D8） |
| 保留 `ORDER BY id` 并在注释里写明"顺序不保证" | 两个实现的列表顺序会随存储实现漂移且没有门禁；端口未规定顺序不等于可以静默分叉，改用 `rowid` 对齐替身的插入序只花 4 行 |
| 把跨实例自等用例直接放进共享组 | 内存替身的 `#mutate` 没有事务作用域检查，同一动作在它身上是静默挂起（实测 1.2s 不 settle）——共享组会得到一条永远超时的用例，见本层计划遗留「跨实例自等的共享用例缺另一半」 |

## Global Constraints

- 允许改：`packages/storage/sqlite/src/storage*.ts`（新建）、`packages/storage/sqlite/src/index.ts`、`tests/contract/suites/storage*.js`、`tests/contract/storage-contract.test.js`、`tests/integration/storage-restart.test.js`（新建）、本文件、`docs/README.md`（只加自己那一行）；`packages/providers/fake/src/storage.ts` 的 4 行越界改动见 D3。修复轮 1 在共享地基组里**新增**一条回滚分支用例（见 D6 / `Surprises & Discoveries` 6），没有删改该目录下的既有断言。**订正 2026-09-24**：地基组现留在 `storage.js`（`storage-foundation.js` 已不存在，见 D1）。
- 修复轮 2 的改动面（评审 P1/P3 收口）：`packages/storage/sqlite/src/storage.ts`、共享地基组（只新增两条共享断言并按要求把嵌套事务断言收紧到整串）、`tests/contract/storage-contract.test.js`、本文件。**没有改** `packages/capabilities/**`（端口注释不在授权面，见本层计划遗留「端口注释没有写明读的排队语义与列表顺序」）与 `packages/providers/fake/**`（见本层计划遗留「跨实例自等的共享用例缺另一半」）。**订正 2026-09-24**：共享地基组现在 `tests/contract/suites/storage.js` 内（见 D1）。
- 不得改：迁移文件、`packages/capabilities/**`、`packages/core/**`、`packages/domain/**`、其它层计划、控制计划。
- **L5 的允许面**：`packages/storage/sqlite/src/**`、`packages/storage/sqlite/src/storage-unimplemented.ts`（把本层实现的方法从桩清单里移除）、`tests/contract/storage-contract.test.js`（SQLite 的装配换成地基组 + 同步组）、`tests/integration/storage-sync-surface.test.js`（新建）、本文件、`docs/README.md`。**`tests/contract/suites/**` 可以补前置状态与新增用例**（跨层的语义改动要先在 PR 描述里点名；不得静默删除或放宽既有断言）。**订正 2026-09-26（第四轮修复轮）**：原文写"不得改 `packages/providers/fake/**`""`suites/**` 只追加用例"，与本 PR 的实际做法相反——`a8a51d7` 给替身的观察补了绑定存在性检查、本轮又给两条游标写入补了存在性检查（第四轮评审 R4-4），`fd33899` 在 `suites/storage-sync.js` 的 4 个用例里补了前置状态，`storage-identity-membership.js` 接受 `register` 参数以便进装配台账。依据是收敛计划 D6 第 2 条（两个实现必须同语义）与 D16（守卫要覆盖实际装配）；理由与取舍见 Decision Log 的「第四轮修复轮的允许面」。
- **修复轮的越界说明**：本层原本不得改迁移文件。修复轮改了 `packages/storage/sqlite/migrations/003_control_facts.sql`（`sync_observation` 的键加 `dedupe_key`、加 `(binding_id, dedupe_key)` 唯一索引、`committed_observation` 补追加序 tie-break）。依据有两条：① 用户指令明确把该文件列进本轮允许面并指出"控制计划 D12 允许发布前重写迁移"；② 不改键就只能继续让两条不同的观察互相顶掉（P0），那是数据丢失，不是风格问题。同批同步了 `tests/integration/execution-relation-write-schema.test.js` 的列集合与位置式 INSERT（表键变化的必然结果），断言语义未变。
- 修复轮的其余改动全部落在既有允许面内：`packages/storage/sqlite/src/**`、`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage.js`（**只改守卫与注释**，不动任何断言语义）、`tests/integration/storage-sync-surface.test.js`、本文件。
- **评审修复轮（Batch L5-E）的允许面**：用户指令把本轮收窄为三个文件——`packages/storage/sqlite/src/storage-sync.ts`、`tests/integration/storage-sync-surface.test.js`、本文件。**迁移文件由 L3 负责**（`8cf7d18` 去掉 `sync_observation` 的成员关系外键、committed 视图含 binding），本层不重复改，也不在报告之外"顺手"改它。
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

### Batch L5-A · 同步面集成用例先红 + 契约装配

**最小闭环**：SQLite 的契约装配跑"地基组 + 同步组"，同步面在文件库上的验收点先红。

**涉及文件**：`tests/integration/storage-sync-surface.test.js`（新建）、`tests/contract/storage-contract.test.js`

- [x] SQLite 装配换成地基组 + 同步组；`restart` 抽成 `restartSqlite` 复用，同步组的最后一条用例真正调用它
- [x] 同步组在装配点预置最小前置行（D13）
- [x] 写集成用例：去重账本、定序与整快照替换、committed 取最新、后者胜、引用完整性、游标作用域（第 7 条"观察落点"在 L5-B 补）
- [x] 在提交 ① 的树上运行两条最窄命令，确认按预期失败

**验证**（提交 ① 的树）：

```bash
node --test tests/contract/storage-contract.test.js         # 期望：35 pass / 6 fail，红的全是 SQLite 同步组，原因 not implemented in L4
node --test tests/integration/storage-sync-surface.test.js  # 期望：0 pass / 6 fail
```

**回滚**：`git revert` 提交 ①；SQLite 回到只跑地基组，集成用例消失。

### Batch L5-B · 同步面落库

**最小闭环**：SQLite 在文件库上通过同步组契约与 7 条集成用例，桩清单只剩执行组。

**涉及文件**：`packages/storage/sqlite/src/storage-sync.ts`（新建）、`storage.ts`、`storage-rows.ts`、`storage-unimplemented.ts`、`tests/integration/storage-sync-surface.test.js`

- [x] 基类 `SqliteSyncSurface`：写者路径机制 + 成员关系 / 字段值 / 观察 / 游标（D10）
- [x] 成员关系后者胜的连带清理与同条目幂等覆盖（D12）
- [x] 观察落点解析、去重账本、字典序定序、整快照替换（D11）
- [x] 四张行映射 + `optionalText`（NULL → `undefined`，端口不得拿到 `null`）
- [x] 从桩清单移除 10 个方法（20 → 10）
- [x] 五条判别性实验（见 `Progress`）

**验证**：

```bash
node --test tests/contract/storage-contract.test.js         # 期望：41 pass / 0 fail（SQLite 地基 10 + 同步 7）
node --test tests/integration/storage-sync-surface.test.js  # 期望：7 pass / 0 fail
node_modules/.bin/tsc --noEmit                              # 期望：退出码 0
```

**回滚**：`git revert` 提交 ②；同步面回到显式抛错的桩，集成用例随之变红（这正是它要钉住的东西），需连同用例一起回滚。

### Batch L5-C · 计划与索引

**最小闭环**：本层计划自包含可复现，`docs/README.md` 的索引行覆盖 L5。

**涉及文件**：本文件、`docs/README.md`

- [x] 本文件补 Batch L5-A/B/C、验收表、判别性证据、遗留问题
- [x] `docs/README.md` 的本层一行补上同步面

**验证**：

```bash
BASE=$(gh pr view 170 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)   # 本层（L5）自己声明的 base
node scripts/rule-checks.mjs size "$BASE"   # 期望：退出码 0，代码 ≤1000、文档 ≤1500
git diff --check "$BASE"...HEAD             # 期望：无输出
```

### Batch L5-D · 修复轮：账本键 + 版本读回 + 装配守卫（2026-09-23）

**最小闭环**：P0（账本在接收时刻碰撞时不是只追加）、P1-a（`undefined` 版本被误判乱序）、P1-b（守卫察觉不到整组没装配）三条各自有可判别的红/绿证据，且计划把 P2/P3 的后果与遗留写清楚。

**涉及文件**：`packages/storage/sqlite/migrations/003_control_facts.sql`、`packages/storage/sqlite/src/storage-sync.ts`、`tests/contract/storage-contract.test.js`、`tests/contract/suites/storage.js`、`tests/integration/storage-sync-surface.test.js`、`tests/integration/execution-relation-write-schema.test.js`、本文件

- [x] 003：`sync_observation` 主键加 `dedupe_key`，加 `(binding_id, dedupe_key)` 唯一索引，`committed_observation` 补 `rowid` 追加序 tie-break（D14）
- [x] `recordObservation`：裸 `INSERT`（不再有顶掉路径）+ 去重按列查；`#committedVersion` 读回 `'' → undefined`（D15）
- [x] 集成补"同一主体、同一接收时刻的两条不同观察互不顶掉"；契约补"两条 `sourceVersion` 缺失的观察都必须被应用"（两个实现各一次）
- [x] 守卫改成按适配器**实际注册条数**核账 + 修正 `suites/storage.js` 里那句不成立的注释（D16）
- [x] 三条新判别性实验 + 原有五条实验在 head 上重跑，摘要见 `Progress`
- [x] P2/P3 回填：遗留 5 的两条后果、遗留 8/9/10 的登记与收口条件、实验数字更新

**验证**：

```bash
node --test tests/contract                            # 期望：fail 0（条数以命令回读为准）
node --test tests/integration                         # 期望：34 pass / 0 fail
node --test tests/contract/storage-contract.test.js   # 期望：44 pass / 0 fail（含两条装配/切分守卫）
node_modules/.bin/tsc --noEmit                        # 期望：退出码 0
```

**回滚**：`git revert` 本次提交。回退后 003 的键回到不含 `dedupe_key`，P0 的三条用例随之变红（这正是它们要钉住的东西），必须连同用例一起回退；单独回退用例会让 P0 静默复活。

### Batch L5-E · 评审修复轮：账本只追加 + committed 含绑定 + 旧库自检（2026-09-23）

**最小闭环**：PR #170 的四条意见（P1 换条目删账本、P2 committed 缺 binding、P2 恒真断言、P3 旧库驱动级报错）各有一条可判别的红/绿证据；P3 的体量证据与安全决定各有可复现的落点。

**涉及文件**（用户指令把本轮收窄为三个）：`packages/storage/sqlite/src/storage-sync.ts`、`tests/integration/storage-sync-surface.test.js`、本文件。**迁移文件不在本轮允许面**：账本外键与 committed 视图的 binding 维度由 L3 的 `8cf7d18` 改（本层不重复改）。

- [x] 删掉 `putMembership` 里"换条目时删观察账本行"的清理：账本只追加，删行会让同一观察再投递重新返回 `true`（D12 修订）
- [x] `#committedVersion` 的主体改成 `(binding_id, item_external_id)`，与端口 subject 一致（D17）
- [x] 集成用例改写：恒真的 `ledger(location).length === 0` 换成"投递 → 换条目 → 再投递 → 仍 `false` 且行数不变"
- [x] 集成新增"两个绑定观察同一内容时各自的版本序列互不影响"（第二个绑定的首条观察必须被应用）
- [x] 适配器打开时加 003 重写自检：版本 3 已应用而 `sync_observation` 缺 `dedupe_key` → 显式抛"请删除重建"（D18）
- [x] 计划里的体量证据基线由失效的 `e49f0ee` 改成实测 base `6526ded9`；`snapshot_json` 原样落库写进模块注释与本计划，端口注释一条登记为遗留 11（D19）
- [x] 三条判别性实验（红 → 还原 → 绿），摘要见 `Progress`

**验证**（命令在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录运行）：

```bash
node --test tests/integration                         # 本分支：36 tests / 35 pass / 1 fail（唯一红的是 L3 外键未级联，见下）
node --test tests/contract                            # 本分支：432 tests / 431 pass / 1 fail（同一根因经 run-test-layer 透传）
../../node_modules/.bin/tsc --noEmit                  # 期望：退出码 0
node scripts/rule-checks.mjs size "$BASE"            # 期望：退出码 0（BASE 见 Global Constraints）
git diff --check "$BASE"...HEAD                      # 期望：无输出
```

**级联后的期望值（已实测）**：把 L3 的 `8cf7d18` 与本层 `cafc245` 的 003 做三方合并（两处冲突：注释段与主键 / 外键块，按"两边都保留 + 主键含 `dedupe_key` 且无外键"解决）后，在同一棵树上 `tests/integration` → **36/36**、`tests/contract/storage-contract.test.js` → **44/44**、`package-boundaries` → 7/7、`tsc` 退出码 0。

**回滚**：`git revert` 本批的两个提交。回退后：账本清理复活（换条目后同一观察再次返回 `true`）、committed 回到全局赢家（第二个绑定的首条观察被静默拒绝）、旧库自检消失（回到驱动级报错）。三条集成用例分别钉住这三件事，所以回退会让它们变红——这正是它们存在的理由。

### Batch L5-F · 重建：把同步面搬到 L4 新底，机制统一收进基类（2026-09-23）

**为什么是重建而不是 rebase**：L5 原分支的 base 是旧 L4（`6526ded`：无读排队、无事务作用域 / 关闭快速失败），而 L4 的评审修复轮把队列逻辑写在**子类** `SqliteStorage` 里（`da902e4`）。两侧在类层次上撞车——整侧取一都会丢掉另一侧的修复，`git rebase` 只能得到语义冲突。

**最小闭环**：写者 / 读者路径机制只有 `SqliteSyncSurface` 一份（`#queue` / `scoped` / `TX_SCOPE` / `#closed` + 唯一入口 `mutate`，`read` 复用同一条串行点），`SqliteStorage` 只留地基面端口方法与作用域实例构造点；两个面的每个读方法都经过统一入口。

**涉及文件**：`packages/storage/sqlite/src/storage-sync.ts`、`storage.ts`、`storage-rows.ts`、`storage-unimplemented.ts`、`migrations/003_control_facts.sql`、`tests/contract/**`、`tests/integration/**`、本文件

- [x] 恢复锚点：`git branch -f backup/l5-before-rebuild 8a43bc4` → `git reset --hard da902e4`；源文件逐条 `git show 8a43bc4:<path>` 取，不 `git checkout` 整支
- [x] 机制收进基类：`#queue` / `scoped` / `TX_SCOPE` / `#closed` 只在 `storage-sync.ts` 声明；`transaction()` / `close()` 随机制进基类，作用域实例由 `SqliteStorage.scopedInstance()` 提供
- [x] `storage.ts` 的每个读方法改走 `read`（`get*` / `list*` / `find*` / `currentRevision`）；`ORDER BY rowid` 与两条快速失败按 L4 修复轮保留
- [x] 003 只加 `dedupe_key`（主键第四列 + `(binding_id, dedupe_key)` 唯一索引），保留 L3 的两条决定（账本不引用成员关系、committed 视图主体含 binding）
- [x] 测试合并：`assemble` 台账 + 装配守卫（L5）与 SQLite 专属 `close()` / 外层实例用例、断言多重集基线（L4 修复轮 2）同时在树；`tests/contract/suites/storage.js` 保持 L4 修复轮 2 的版本
- [x] 集成：`storage-sync-surface.test.js` 10 条（旧库自检的"重写前形状"按新底校正为无外键）；`execution-relation-write-schema.test.js` 保留 L3 的 token 白名单与"账本无外键"用例，另加 `dedupe_key` 列集合、两行并存与两条唯一性拒绝
- [x] 判别性实验 22 / 23（用户指定的两条必需实验）：读回到直接读 → 读隔离用例红 → 还原绿；去掉事务作用域快速失败 → 外层实例用例红 → 还原绿

**验证**：见 `Progress` 的重建验证摘要。

**回滚**：`git reset --hard backup/l5-before-rebuild` 回到重建前。重建后的提交是自包含的（同步面 + 机制收敛 + 迁移 + 用例 + 计划），单独 `git revert` 会同时撤掉机制收敛与同步面装配。

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


### Batch L5-G · 级联到新 L4 底（2026-09-24）

**最小闭环**：L5 的同步面在重写过的 L2/L3 与级联后的 L4 之上重新可验收（base 以 `BASE=$(gh pr view 170 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 回读；原文写死的 `8f11e38` 是观察时刻快照，不可复跑）——`storage.ts` 的绑定读写与 `storage-sync.ts` 的观察落点都按"连接锚点 + 工作区挂载"两表重写，SQLite 适配器同时注册身份同步组。

**判据**：`#observationSubject` 原本用 `provider_binding.workspace_id` 把绑定解析成工作区；拆表后锚点没有 `workspace_id`，查询必须改成 join `workspace_binding`。集成用例 `storage-sync-surface.test.js` 的第二个绑定也踩到新契约：同一工作区第二个启用的 planning 挂载会被部分唯一索引拒绝。

**涉及文件**：`packages/storage/sqlite/src/storage.ts`、`storage-sync.ts`、`tests/contract/storage-contract.test.js`、`tests/integration/storage-sync-surface.test.js`、本文件

- [x] 恢复锚点 `backup/storage-sqlite-sync-surface-pre-review-response`，`git rebase --onto 8f63983 8f4b5da` 重放 2 个提交
- [x] `storage.ts` 与 L4 同型的绑定改动（本层那份继承 `SqliteSyncSurface`，因此走 `this.read` / `this.scoped`）
- [x] `#observationSubject` 改成 `JOIN workspace_binding AS wb ON wb.workspace_id = m.workspace_id AND wb.binding_id = ?`
- [x] 装配前置行的 seed 改成 `provider_binding (id, implementation_key)` + `workspace_binding` 两条
- [x] SQLite 适配器注册身份同步组（两个实现跑同一套断言）；集成用例的第二个绑定改挂 `development` 域
- [x] 体量在预算内（观察时刻快照：829/1000；以 `size "$BASE"` 回读为准）

**验证**：`node --test tests/contract` 与 `node --test tests/integration` 全绿；`node scripts/rule-checks.mjs size "$BASE"` 退出码 0（原文的 501/501、40/40、`size 8f63983`、829/1000 是观察时刻快照，不可复跑）。

### Batch L5-H · 把 L3 的新 003 与 L4 修复轮 2 的语义落到 L5 的新位置（2026-09-24）

**最小闭环**：L5 的同步面在 **L3 重写过的 003**（账本主体 = 端口主体 `(binding_id, object_kind, object_external_id)`，无 `workspace_id` / `item_external_id`）与 **L4 修复轮 2**（可变令牌 + `atomic` + 共用关闭状态 + 幂等 `close()` + 断言层守卫）之上重新可验收，且写者 / 读者路径机制仍然只有 `storage-sync.ts` 一份。

**判据**：`git rebase --onto <L4 新 head> 1773f99` 在 `storage.ts` / `storage-contract.test.js` / `suites/storage.js` / `execution-relation-write-schema.test.js` 上只能得到语义冲突，整侧取一都会丢掉另一侧的修复。原则是"保留 L5 的结构，把 L3/L4 的语义重新落到新位置"。

**涉及文件**：`packages/storage/sqlite/src/storage-sync.ts`、`storage.ts`、`storage-rows.ts`、`tests/contract/storage-contract.test.js`、`suites/storage.js`、`tests/integration/storage-sync-surface.test.js`、`execution-relation-write-schema.test.js`、本文件

- [x] 机制（`#queue` / 可变令牌 `TX_SCOPE` / 共用的 `#state` / 幂等 `close()` / `SETTLED_TRANSACTION_MESSAGE` / `atomic`）落在 `SqliteSyncSurface`；`scopedInstance(state, token)` 把共用关闭标记与本事务令牌交给作用域实例
- [x] 同步面适配新 schema：删 `#observationSubject`、`#committedVersion` 改按端口主体、`OBSERVATION_COLUMNS` 改新列清单、`recordObservation` 改用 `capabilities` 的两个契约函数、`putMembership` 改用 `atomic(...)`、自检失败关句柄（P3）
- [x] 库自检同时看端口主体列与 `dedupe_key`（重写前形状与"只有 `dedupe_key`"的中间形状各有判别性用例）
- [x] 切分守卫的两层账落到 L5 的 `assemble` 台账上：条数 13 / 8 / 3，断言基线 36 / 45 / 12（观察时刻快照，以守卫常量回读为准）；装配守卫（`EXPECTED_ASSEMBLY`）保留
- [x] 补判别性用例：`v1→v3→v2` 必须 `[true, true, false]`；无成员关系的观察两个实现都 `true`；同一 `dedupeKey` 换条目后再投递仍 `false`；结算后泄漏的 `tx` 与关闭后的作用域实例都必须快速失败
- [x] `storage-rows.ts` 补回 L5 的四张行映射与 `optional`——原 rebase 把该文件整侧取 ours 时**静默丢掉**了它们（本次解冲突时发现的隐藏损坏，不在原先列出的 4 个冲突文件里）
- [x] 003 的集成用例取 L3 版本（`d8c7269:tests/integration/execution-relation-write-schema.test.js`）

**验证**：见 `Progress` 的 L5-H 验证摘要。

**回滚**：`git revert` 本次提交；同步面回到旧 003 的列集合，SQLite 侧在第一次写观察时变红。


## Validation and Acceptance

| # | 验收项 | 判定证据 | 结果 |
|---|---|---|---|
| 1 | 契约套件切成三组，切分是纯移动 | 三组条数由切分守卫按 `PRE_SPLIT_CASE_COUNT` + `ADDED_CASE_COUNT` 与 `CASE_LEDGER` 断言；`PRE_SPLIT_CASE_COUNT` 以回读本层 base 的 `tests/contract/suites/storage.js` 为准（`BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`，观察时刻快照 18），继承 18（地基 7 / 同步 8 / 执行 3）、新增 6。**Superseded by 2026-09-24 的切分收缩**：原文的 12 / 7 / 3 与 `storage-foundation.js` 已不存在（见 D1） | 通过（2026-09-23；修复轮 2 复核；2026-09-24 按实测订正分解账） |
| 2 | 内存替身注册全部三组与身份面两组，SQLite 注册地基组 + 同步组 + 身份面两组 | `tests/contract/storage-contract.test.js` 的五次 `assemble(...)`，并由装配守卫按实际注册条数核账（覆盖三组与身份面两组） | 通过（2026-09-26 补回身份同步组与台账覆盖） |
| 3 | 事务内再调 `tx.transaction(...)` 两个实现都抛错 | 契约用例（两个实现各一次） | 通过 |
| 4 | 事务原子性：抛错后重开句柄读不到半写行 | `tests/integration/storage-restart.test.js` 第 2 条 | 通过 |
| 5 | 重开同一文件逐字段不变 | 重启用例第 1 条（工作区/绑定/身份/投影/仓库/修订号） | 通过 |
| 6 | 再跑迁移是 no-op | 重启用例第 3 条：迁移重跑之前先经端口 `putWorkspace`，迁移后重开逐字段读回（**第五轮订正**：上一版没有这次端口写入却记「通过」；补上后本层字面满足，改为由本层关闭 #163） | 通过 |
| 7 | 未实现方法显式抛出且不误红地基组 | `UnimplementedPort` + SQLite 地基组全绿（条数以 `node --test tests/contract` 回读为准；观察时刻快照 13） | 通过 |
| 8 | 地基组覆盖的端口面（本层交付范围） | 工作区 / 绑定 / 实体 / 身份 / 投影（含 replace）/ 仓库 / 修订号 / 事务 | 通过 |
| 9 | **未交付范围明确**：只剩执行组 | 10 个方法抛 `not implemented in L4: <method>`；执行组契约用例只在内存替身上运行（同步组已交付，两个实现都跑） | 通过 |
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
| 20 | SQLite 跑地基组 + 同步组，同步组的 `restart` 真正生效 | `node --test tests/contract` 回读（观察时刻快照：SQLite 地基 13 + 同步 8）；用例「换一个实例能读到同一份内容（模拟重启）」在 SQLite 标签下出现 | 通过（2026-09-23；2026-09-24 按 head 实测订正条数） |
| 21 | 观察去重是账本：投递 N 次与一次相同 | 集成第 1 条（账本 1 行、摘要逐字段相同、重开句柄后仍去重）；实验 11 | 通过 |
| 22 | 定序：更旧不落、同版本整快照替换 | 集成第 2 条 + 契约同步组定序用例；实验 12 | 通过 |
| 23 | `committed_observation` 给出最新的那一行 | 集成第 3 条（含直接写进账本的更旧行永远不是 committed）；同主体同接收时刻由追加序 tie-break，仍只有一行 | 通过（2026-09-23 修复轮补 tie-break） |
| 24 | 成员关系后者胜是真 UPSERT | 集成第 4 条 + 契约"同一内容在两个工作区…"；实验 13 | 通过 |
| 25 | 引用完整性两条（成员关系→工作区、字段值→成员关系） | 集成第 5 条 + 契约"引用不存在的父行必须被拒绝"；实验 14 | 通过 |
| 26 | 游标按作用域隔离（绑定 + scopeKey、工作区） | 集成第 7 条；实验 15 | 通过 |
| 27 | **没有成员关系的观察，两个实现都必须被应用**（账本主体 = 端口主体，观察不解析落点） | 集成用例「观察不解析落点：没有成员关系的内容也必须被应用，且不凭空造一条成员关系」；契约共享用例「没有成员关系的观察必须被应用，换条目后再投递同一观察仍是 false」×2（2026-09-26 从第四轮版本补回） | 通过（2026-09-24 L5-H 重建；**Superseded by L5-H（2026-09-24）**：原文写"观察落点解析不到时显式失败且不留行｜集成第 6 条"，与端口主体语义相反） |
| 28 | 桩清单只剩执行组，未实现仍显式抛出 | `storage-unimplemented.ts` 的 10 个名字；执行组用例仍只在内存替身上运行 | 通过 |
| 29 | 体量与发布面合规 | `node scripts/rule-checks.mjs size "$BASE"` → 退出码 0；`git diff --check "$BASE"...HEAD` 无输出（原文的 `size 6526ded9` 与 476/1000 是观察时刻快照，不可复跑） | 通过（2026-09-23；2026-09-24 改为回读式） |
| 30 | 全门禁（L5，**修复轮前** head `0aa7c34`） | 契约 429/429、集成 33/33、e2e 38/38、mvp0 7/7、`tsc --noEmit` 0、boundaries 7/7 | 通过（修复轮后的当前值见第 31 项） |
| 31 | **账本在接收时刻碰撞时仍只追加**（修复轮 P0） | 集成"同一主体、同一接收时刻的两条不同观察互不顶掉"（账本 2 行、第一条再投递 `false`）；契约同步组"换一个实例…"；实验 16 判别性证据 | 通过（D14） |
| 32 | **`sourceVersion: undefined` 不被误判成乱序**（修复轮 P1-a） | 契约"两条 sourceVersion 缺失的观察（不同 dedupeKey）都必须被应用"×2（两个实现）；实验 17 判别性证据 | 通过（D15） |
| 33 | **守卫察觉得到"整组没装配"**（修复轮 P1-b） | 装配守卫按 `REGISTERED` × `EXPECTED_ASSEMBLY` 逐标签核账（覆盖三组与身份面两组）；实验：删掉 SQLite 同步组装配 → 守卫红；删掉 `EXPECTED_ASSEMBLY` 一项 → 红（2026-09-26 复跑） | 通过（D16） |
| 34 | 观察键的库级事实：主体+接收时刻+去重键 与 端口去重键 | `tests/integration/execution-relation-write-schema.test.js` 的列集合、两行并存、两条唯一性拒绝 | 通过（2026-09-23） |
| 35 | 全门禁（L5 修复轮） | 契约 432/432、集成 34/34、e2e 38/38、mvp0 7/7（观察时刻快照，不可复跑）、`tsc --noEmit` 0、boundaries 7/7 | 通过 |
| 36 | **换条目不删账本**（评审修复轮 P1） | 集成"成员关系后者胜…"：投递 `true` → 换条目 → 同一 `dedupeKey` 再投递仍 `false`、账本行数不变；实验 19 判别性证据 | 通过（D12 修订；本分支上该用例红在 L3 外键未级联，级联后 36/36——见 Batch L5-E 的验证段） |
| 37 | **committed 主体含绑定**（评审修复轮 P2） | 集成"committed 按 (绑定, 条目) 定序…"：第二个绑定的首条观察必须 `true`，两个绑定各自更旧的版本仍 `false`；实验 20 判别性证据 | 通过（D17） |
| 38 | **重写前的 003 显式报错**（评审修复轮 P3） | 集成"003 重写后的库自检…"：退回 7 列旧形状的库在打开时抛"重写前的 003，请删除重建"，当前形状的库照常打开；实验 21 判别性证据 | 通过（D18） |
| 39 | 体量证据可复现（评审修复轮 P3） | 计划里的基线由 `e49f0ee` 改成 `6526ded9`（两个都是观察时刻快照，不可复跑），`node scripts/rule-checks.mjs size "$BASE"` 与 `git diff --check "$BASE"...HEAD` 均按实测记录 | 通过 |
| 40 | **重建**：机制统一收进基类，两侧修复同时成立 | `SqliteSyncSurface` 持有 `#queue` / `scoped` / `TX_SCOPE` / `#closed` 与唯一入口 `mutate`（`read` 复用同一条串行点）；两个面的读方法全部经过它；`tests/contract` SQLite 地基 12 + 同步 7 = 19 条全绿；实验 22 / 23 判别性证据 | 通过（2026-09-23，见 Batch L5-F） |
| 41 | **级联后绑定仍按新契约落库**（Batch L4-F） | 身份地基组用例 ×2（替身 + SQLite）：同 id 换实现被拒、第二个启用的 planning 挂载被拒且不留孤儿锚点、同域至多一个启用默认；`listProviderBindings` 走 join 别名 | 通过（2026-09-24） |
| 42 | **观察主体是端口主体（连接级）**（Batch L5-H；**Superseded by L5-H（2026-09-24）**：原文写"级联后观察落点仍解析到工作区"） | 身份同步组用例 ×2（替身 + SQLite）：同一条连接被两个工作区挂载时同一对象只有一条身份；集成用例「committed 按端口主体定序：两个绑定观察同一内容时各自的版本序列互不影响」与「观察不解析落点…」 | 通过（2026-09-24；2026-09-26 补回 SQLite 身份同步组注册与装配台账覆盖） |

**本层不声称**：#5 的"关系与执行上下文重启后不变"要等执行组落地（L4 只交付地基组，验收表第 9 项显式登记）。**L5 补记**：同步组已经落地——成员关系 / 字段值 / 观察 / 游标在文件库上关句柄重开后逐字段不变（契约同步组最后一条用例真正调用 `restart`）；仍不声称的是**执行组**的关系与执行上下文。

**"验收表全通过"不能读成"SQLite 已经可以当 core 的 storage"**（2026-09-23 修复轮补记，P2；**2026-09-24 按 head 实测改写**）。**Superseded by L5-H（2026-09-24）**：原文的两条"已知后果"（core 的 `recordObservations` 在 SQLite 上抛"观察无法挂载"、`bootstrapWorkspace()` 被 rejected）已被根因修复消掉——账本主体改成端口主体（连接级）后，观察不解析落点、也不要求成员关系存在。改写后的现状：

1. **core 的首轮同步在 SQLite 上与替身结果一致**：`composeCore({ storage: createSqliteStorage(文件) })` + `createFakeProviders()` 的 `bootstrapWorkspace()` 返回 ok，实体与列表条目与替身逐项相同。
2. **执行组在本层未交付**：关系与执行上下文的重启不变性、以及 core 的 Start Work 路径在 SQLite 上仍没有端到端证据（验收表第 9 项）；这属于执行组落地范围，不是本层缺陷。

**订正 2026-09-24（第四轮评审）**：原文写"26 项全通过"与两条 core 后果；条数是易失值（以命令回读为准），后果已被根因修复取代。

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

- [x] (2026-09-23) L5 对齐：读同步组规格（7 条）、002/003 的成员关系 / 字段值 / 观察 / 游标 DDL、内存替身语义，确认"观察落点必须解析到成员关系"与端口入参之间有一处落差（Surprises 11）。
- [x] (2026-09-23) Batch L5-A：SQLite 装配换成地基组 + 同步组（含前置行）、集成用例，提交 ①。
- [x] (2026-09-23) L5 红证据（提交 ① 的树）：`node --test tests/contract/storage-contract.test.js` → 35 pass / 6 fail（红的全是 `SQLite Storage（同步组）`，`Error: not implemented in L4: putMembership` / `recordObservation`）；`node --test tests/integration/storage-sync-surface.test.js` → 0 pass / 6 fail。
- [x] (2026-09-23) Batch L5-B：`storage-sync.ts` 基类 + 同步面 10 个方法、四张行映射、桩清单 20 → 10，提交 ②。
- [x] (2026-09-23) Batch L5-C：本计划与 `docs/README.md` 索引行，提交 ③。
- [x] (2026-09-23) 五条判别性实验与全门禁复跑，摘要见下。

L5 判别性实验（改坏 → 红 → 还原 → 绿，均在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录；**数字已在 head 上重跑**——实验最初跑在只有 6 条集成用例的树上，head 的 `storage-sync-surface` 是 8 条、`storage-contract.test.js` 是 44 条，因此旧记录的集成数字系统性差 1）：

11. **去重账本**：`#hasSeenObservation` 恒返回 `false` → 契约文件 40 pass / 4 fail（`SQLite Storage（同步组）` 的"重复或乱序观察…"、"定序按字典序…"、"换一个实例…"，以及"SQLite Storage：两条 sourceVersion 缺失的观察…"），集成文件 6 pass / 2 fail（`观察账本：同一观察投递 N 次与一次相同…`、`观察账本：同一主体、同一接收时刻的两条不同观察互不顶掉…`）→ 还原后 432/432 + 34/34 绿。
12. **定序**：`compareVersions(...) < 0` 的拒绝分支短路（改成 `< -1`）→ 契约文件 42/2（"重复或乱序观察…"、"定序按字典序…"），集成文件 7/1（`观察定序：更旧的版本不落账本…`）→ 还原后绿。
13. **后者胜**：把"先清同内容旧条目 + UPSERT"换成裸 `INSERT` → 契约文件 43/1（"同一内容在两个工作区是两条成员关系…"：唯一索引拒绝），集成文件 7/1（`成员关系后者胜…`）→ 还原后绿。
14. **引用完整性**：`openDatabase` 改成 `PRAGMA foreign_keys = OFF` → 契约文件 43/1（"引用不存在的父行必须被拒绝"），集成文件 7/1（`引用完整性…`）→ 还原后绿。**实验中的意外发现**：把 `PRAGMA foreign_keys = ON` 那一行删掉**不会**变红——node:sqlite 的默认值就是开（实测 `PRAGMA foreign_keys` 返回 1），只有显式 OFF 才构造得出"悬空引用被静默接受"（Surprises 13）。
15. **游标隔离**：① 写路径把 `ON CONFLICT (binding_id, scope_key)` 改成 `(scope_key)` → 契约文件 43/1，但红的原因是驱动级 `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`，不是隔离语义；② 读路径去掉 `binding_id` 维度 → **契约文件 44/0 全绿**（规格看不见），集成文件 7/1（`游标按作用域隔离…`）。取 ② 作为隔离语义的判别性证据：这条语义只有集成用例钉得住（Surprises 14）。

L5 修复轮判别性实验（同一工作树；前两条是用户指定的必需实验）：

16. **观察键改回不含 `dedupeKey`**（P0）：003 的主键回到 `(workspace_id, item_external_id, observed_at)` 并恢复 `ON CONFLICT … DO UPDATE` → 集成文件 7 pass / 1 fail：`观察账本：同一主体、同一接收时刻的两条不同观察互不顶掉，已见 key 再投递仍是 false` 红在 `AssertionError: 两条不同观察都必须留在账本里：只追加，不互相顶掉`（`1 !== 2`）；`tests/integration/execution-relation-write-schema.test.js` 6/2（列集合与"同接收时刻两行并存"）。**没有这条用例时两处都是绿的**——P0 正是这么漏过去的。还原后集成 34/34 绿。
17. **版本读回不还原空串**（P1-a）：`#committedVersion` 的返回改回 `row?.updated_at` → 契约 431 pass / 1 fail：`SQLite Storage：两条 sourceVersion 缺失的观察（不同 dedupeKey）都必须被应用` 红在 `AssertionError: 第二条版本同样缺失的**新**观察必须被应用，不得被判成乱序`（`false !== true`）；内存替身那条仍绿（它没有空串编码）。还原后 432/432 绿。
18. **删掉 SQLite 同步组装配**（P1-b）：删掉 `assemble({ label: 'SQLite Storage（同步组）' … }, ['sync'])` → 契约 **425 tests / 424 pass / 1 fail**：红的只有新的装配守卫（`装配标签必须与守卫的期望一一对应`，实际台账里没有 `SQLite Storage（同步组）`），总条数从 432 静默掉到 425——这正是修复前 429 → 422 全绿的同一现象。还原后 432/432 绿。

L5 验证摘要（**原 L5 分支的历史值**，修复轮前 head `0aa7c34`；易失值，以命令回读为准；**以下条数与基线 `6526ded9` 都是观察时刻快照，不可复跑**）：`node --test tests/contract` → tests 429 / pass 429 / fail 0（SQLite storage 契约 10 + 7 = 17，内存替身 20 条三组）；`node --test tests/integration` → 33/33；`node --test tests/e2e` → 38/38；`node --test tests/mvp0` → 7/7；`tsc --noEmit` 退出码 0；`node --test tests/contract/package-boundaries.test.js` → 7/7；`node scripts/rule-checks.mjs size 6526ded9` → 代码 476/1000、文档 ≤1500；`git diff --check 6526ded9...HEAD` 无输出。

- [x] (2026-09-23) 修复轮（Batch L5-D）对齐：独立对抗验证在 head `0aa7c34` 上判 `partially_falsified`，1 条 P0 + 2 条 P1 属实，逐条复现（P0 账本顶掉、P1-a 空串编码、P1-b 守卫无判别性）。
- [x] (2026-09-23) P0：003 的键加 `dedupe_key` + 端口去重键唯一索引 + 视图追加序 tie-break；插入改裸 `INSERT`；去重查询改按列查（D14）。
- [x] (2026-09-23) P1-a：`columnToVersion` 读回还原（D15）；P1-b：装配守卫按实际注册条数核账 + 修正 `suites/storage.js` 的假注释（D16）。
- [x] (2026-09-23) 判别性实验 16 / 17 / 18 + 原有五条在 head 上重跑；全门禁复跑；P2/P3 回填（遗留 5 的两条后果、遗留 8/9/10、实验数字）。
- [x] (2026-09-23) 评审修复轮（Batch L5-E）对齐：PR #170 的六条意见逐条判定——P1 换条目删账本、P2 committed 缺 binding、P2 恒真断言、P3 旧库驱动级报错、P3 体量证据不可复现、P3 安全决定未写下，六条**全部属实**；分层归属：账本外键与视图的 binding 维度在 L3（`8cf7d18`），实现侧在本层。
- [x] (2026-09-23) P1：删掉换条目时的账本清理（D12 修订）；P2：`#committedVersion` 主体含 `binding_id`（D17）；P2：恒真断言改写成"投递 → 换条目 → 再投递"的判别性用例。
- [x] (2026-09-23) P3：适配器打开时的 003 重写自检（D18）；计划基线 `e49f0ee` → 实测 `6526ded9`；`snapshot_json` 原样落库写进模块注释与遗留 11（D19）。
- [x] (2026-09-23) 判别性实验 19 / 20 / 21 + 级联后复跑（集成 36/36、存储契约 44/44）；全门禁复跑，本分支的唯一红已定位到 L3 外键未级联。

L5 修复轮验证摘要（**原 L5 分支的历史值**；易失值，以命令回读为准；**以下条数与基线 `6526ded9` 都是观察时刻快照，不可复跑**）：`node --test tests/contract` → 432/432；`node --test tests/integration` → 34/34；`node --test tests/e2e` → 38/38；`node --test tests/mvp0` → 7/7；`tsc --noEmit` 退出码 0；`node --test tests/contract/package-boundaries.test.js` → 7/7；`node scripts/rule-checks.mjs size 6526ded9` → 代码 ≤1000、文档 ≤1500；`git diff --check 6526ded9...HEAD` 无输出。

L5 评审修复轮判别性实验（Batch L5-E；实验 19 / 20 是用户指定的必需实验，都在"L3 的 003 已级联"的等价树上做——见下面的级联说明，否则换条目会先撞上旧外键）：

19. **把"换条目删账本"加回去**（P1）：`putMembership` 恢复 `DELETE FROM sync_observation …` → 集成文件 9 pass / 1 fail：`成员关系后者胜…` 红在 `AssertionError: 换条目不得清掉账本：同一观察再投递必须仍是 false`（`true !== false`）。还原后 10/10 绿。
20. **committed 去掉 binding 维度**（P2）：`#committedVersion` 的查询回到 `workspace_id + item_external_id` → 集成文件 9 pass / 1 fail：`committed 按 (绑定, 条目) 定序…` 红在 `AssertionError: binding-2 的首条观察必须被应用：它比的是**自己**绑定下的已提交版本，不是 binding-1 的`（`false !== true`）。还原后 10/10 绿。
21. **去掉 003 重写自检**（P3）：删掉构造函数里的 `#assertRewrittenSchema()` 调用 → 集成文件 9 pass / 1 fail：`003 重写后的库自检…` 红在 `AssertionError: Missing expected exception`（打开旧库不再报错）。同一实验顺手量到自检要替代的那条报错：旧库上 `recordObservation -> no such column: dedupe_key`。还原后 10/10 绿。

**重建说明（本次最重要的一条执行事实）**：上面三条"级联"结论锚在旧底上——L5 原分支的 base（`6526ded`）不含 L3 的 003 修复，因此"换条目保留账本行"会先撞上旧外键（`Error: FOREIGN KEY constraint failed`），只能靠三方合并 003 才验证得到。**重建把同步面搬到 L4 的新底 `da902e4`（已含 L3 的 003：账本不引用成员关系、committed 视图主体含 binding），因此本树上 `tests/integration` 直接全绿，不再需要级联**；003 的冲突也只剩一处——在 L3 的新形状上加 `dedupe_key` 主键列与 `(binding_id, dedupe_key)` 唯一索引，两条 L3 决定原样保留。原分支的"35/1"与"级联后 36/36"保留作对照。

L5 评审修复轮验证摘要（**原 L5 分支的历史值**；易失值，以命令回读为准；**以下条数与基线 `6526ded9` 都是观察时刻快照，不可复跑**）：**原分支** `node --test tests/integration` → 36 tests / 35 pass / 1 fail（上述旧外键）；`node --test tests/contract` → 432 tests / 431 pass / 1 fail（同一根因经 `run-test-layer` 透传）；`tsc --noEmit` 退出码 0；`node scripts/rule-checks.mjs size 6526ded9` → 代码 ≤1000、文档 ≤1500；`git diff --check 6526ded9...HEAD` 无输出。**级联后（已实测）** 集成 36/36、存储契约 44/44、boundaries 7/7。

- [x] (2026-09-23) **重建对齐（Batch L5-F）**：L5 原分支的 base 是旧 L4（`6526ded`），而 L4 的评审修复轮把队列写在子类里（`da902e4`）——两侧在类层次上撞车，`git rebase` 只能得到语义冲突（整侧取一都会丢掉另一侧的修复）。建立备份锚点 `backup/l5-before-rebuild` / `backup/l5-squashed` 后 `git reset --hard da902e4`，源文件逐条用 `git show 8a43bc4:<path>` 取，不整支检出。
- [x] (2026-09-23) 机制统一收进基类：`#queue` / `scoped` / `TX_SCOPE` / `#closed` 只在 `storage-sync.ts` 声明；`mutate` 是唯一入口，`read` 复用同一条串行点，`write` 是单语句便捷入口；`transaction()` / `close()` 随机制一起进基类，作用域实例由 `SqliteStorage.scopedInstance()` 提供。`storage.ts` 的每个读方法改走 `read`（`get*` / `list*` / `find*` / `currentRevision`），不再有方法直接 `prepare` 读。
- [x] (2026-09-23) 003 只加 `dedupe_key`（主键第四列 + `(binding_id, dedupe_key)` 唯一索引），保留 L3 的两条决定（账本不引用成员关系、committed 视图主体含 binding）；旧库自检用例的"重写前形状"按新底校正为无外键。
- [x] (2026-09-23) 测试合并：契约装配保留 L5 的 `assemble` 台账 + `EXPECTED_ASSEMBLY` 装配守卫，同时保留 L4 修复轮 2 的 SQLite 专属 `close()` / 外层实例用例与断言多重集基线；`tests/contract/suites/storage.js` 保持 L4 修复轮 2 的版本（读隔离 + 投影覆盖两条共享用例）。
- [x] (2026-09-23) 判别性实验 22 / 23（用户指定的两条必需实验）：读回到直接读 → 读隔离用例红 → 还原绿；去掉事务作用域快速失败 → 外层实例用例红 → 还原绿。

重建验证摘要（易失值，以命令回读为准；命令在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录运行；**以下条数与基线 `8f11e38`（观察时刻快照，不可复跑）都是观察时刻快照，不可复跑**）：`node --test tests/contract` → tests 501 / pass 501 / fail 0（SQLite 地基 12 + 同步 7 = 19 条，内存替身 20 条三组）；`node --test tests/integration` → 40/40；`node --test tests/e2e` → 38/38；`node --test tests/mvp0` → 7/7；`../../node_modules/.bin/tsc --noEmit` 退出码 0；`node --test tests/contract/package-boundaries.test.js` → 7/7；`node scripts/rule-checks.mjs size 8f11e38`（观察时刻快照，不可复跑）→ 代码 829/1000、文档 ≤1500；`git diff --check 8f11e38...HEAD`（观察时刻快照，不可复跑）无输出。

- [x] (2026-09-24) **级联到新 L4 底（Batch L4-F + L5-G）**：L2/L3 被重写成"连接锚点 + 工作区挂载"两表（`provider_binding` 只留 `(id, implementation_key)`）并在 `suites/storage-identity-membership.js` 里独立成文。L4 先级联（恢复锚点 `backup/storage-sqlite-port2-pre-review-response`、`git rebase --onto 8f11e38 3e255ed`（观察时刻快照，不可复跑）），L5 再级联到 L4 新 head（恢复锚点 `backup/storage-sqlite-sync-surface-pre-review-response`、`git rebase --onto 8f63983 8f4b5da`）。绑定落库改双表且两条语句同属一个原子作用域（D20）；`#observationSubject` 改 join `workspace_binding`；装配前置行的 seed 改两条表；SQLite 适配器补注册身份同步组；集成用例的第二个绑定改挂 `development` 域。全门禁复跑见 `Progress` 与验收表第 41 / 42 项。

级联验证摘要（易失值，以命令回读为准；命令在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录运行；**以下条数与基线 `8f63983` 都是观察时刻快照，不可复跑**）：`node --test tests/contract` → tests 501 / pass 501 / fail 0；`node --test tests/integration` → 40/40；`node --test tests/e2e` → 38/38；`node --test tests/mvp0` → 7/7；`tsc --noEmit` 退出码 0；`node --test tests/contract/package-boundaries.test.js` → 7/7；`node scripts/rule-checks.mjs size 8f63983` → 代码 829/1000、文档 ≤1500；`git diff --check 8f63983...HEAD` 无输出。

L5-H 验证摘要（易失值，以命令回读为准；命令在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录运行；**以下条数是观察时刻快照，不可复跑**）：`node --test tests/contract tests/integration tests/e2e tests/mvp0` → tests 594 / pass 594 / fail 0；`node_modules/.bin/tsc --noEmit` 无输出（退出码 0）；`node --test tests/contract/package-boundaries.test.js` → 7/7；`node scripts/rule-checks.mjs size <L4 新 head>` → 见 `Outcomes & Retrospective` 的体量说明。

- [x] (2026-09-26) **第四轮修复轮（本轮，按第四轮丢失的改动恢复）**：① 装配台账与守卫从第四轮版本恢复（`assemble` 是唯一装配入口，`EXPECTED_ASSEMBLY` 由守卫独立书写），并把身份面两组纳入台账——删掉 SQLite 同步组装配、或删掉期望里的一项，守卫都变红；② SQLite 注册身份同步组（5 条 ×2），D1/D6/D9/D13/验收 1-20/遗留里的 L4 文本按 base 恢复、数字改成回读或快照标注；③ 补回 6 条共享判别性用例（观察绑定父边、成员关系原子性、object_kind 版本序列、版本缺失、无成员关系的观察、空串入口拒绝）+ 结算令牌用例 + 3 个存活变异（去重绑定维度、对账游标覆盖、NULL→undefined）+ 游标两条父边；④ 计划里的机械损坏（反引号嵌套、命令内中文注释、失效 SHA、旧条数）就地订正，`docs/README.md` 三行按 head 事实恢复。逐条判定与 13 次注入实验见下。

第四轮修复轮判别性实验（2026-09-26，命令在检出 `feature/storage-sqlite-sync-surface` 的工作树根目录运行；每条都是"改坏 → 目标用例红 → 还原（`shasum` 逐字节一致）→ 绿"）：

24. **装配守卫**：删掉 `assemble(sqliteAdapter('SQLite Storage（同步组）', 'storage-sync'), ['sync'])` → 装配守卫红（标签缺失）；删掉 `EXPECTED_ASSEMBLY` 的 `'SQLite Storage（身份同步组）'` 一项 → 红。
25. **版本读回**：`columnToVersion` 改恒等 → `SQLite Storage：两条 sourceVersion 缺失的观察（不同 dedupeKey）都必须被应用` 红。
26. **成员关系原子性**：`putMembership` 的 `this.atomic(` 改回 `this.mutate(` → 成员关系中途失败用例红。
27. **事务令牌**：删掉 `finally { token.active = false }` → `结算后泄漏出 work 的 tx…` 红。
28. **观察绑定父边**：删掉替身的绑定存在性检查 → 替身侧悬空观察用例红（SQLite 侧仍由外键拒绝）。
29. **object_kind 维度**：`#committedVersion` 的 `object_kind = ?` 改恒真 → issue/draft 版本序列用例红。
30. **空串载体**：删掉 `recordObservation` 入口的 `isComparableSourceVersion` 检查 → 空串拒绝用例红。
31. **去重绑定维度**：`#hasSeenObservation` 去掉 `binding_id = ?` → 同一 dedupeKey 两绑定用例红。
32. **对账游标覆盖**：`putReconcileCursor` 的 `DO UPDATE` 改 `DO NOTHING` → 同键覆盖用例红。
33. **NULL 映射**：`rowToMembership` 直接取列 → 缺省时间戳读回用例红。
34. **游标父边**：删掉替身的游标存在性检查 → 悬空游标用例红。
35. **账本只追加**：`putMembership` 加回 `DELETE FROM sync_observation` → 无成员关系观察用例红。

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
11. **端口键与 DDL 键不是同一个键：观察必须先解析到成员关系**（2026-09-23，L5 实测）。`recordObservation` 的入参只有 `(bindingId, subject)`，而 `sync_observation` 的主键是 `(workspace_id, item_external_id, observed_at)`，落点要先经成员关系解析（ADR-0002；当时账本还以外键指向成员关系，该外键已由 L3 的 `8cf7d18` 去掉，解析这一步不变）。实测（打开内存库跑迁移后直接插入）：

   ```text
   obs no parents: REJECTED -> FOREIGN KEY constraint failed
   obs ws only: REJECTED -> FOREIGN KEY constraint failed
   ```

   处理：按 `(绑定 → 工作区, 内容种类 + 内容 id → 成员关系)` 解析落点，解析不到显式抛错（D11）；去重键随整条观察快照存进 `snapshot_json`，用 `json_extract` 查。代价是 core 的同步路径（不写成员关系）在 SQLite 上会抛错，登记为遗留 5。**修复轮更正**：`json_extract` 那半句已被 D14 取代（`dedupeKey` 进了主键，去重按列查）。**Superseded by L5-H（2026-09-24）**："落点解析这半句不变"也不再成立——账本主体改成端口主体（连接级），观察不解析落点、也不要求成员关系存在。
12. **同步组的用例缺少外键前置行，SQLite 一跑就红**（2026-09-23，L5 实测）。7 条用例里投递观察的 3 条都不建工作区 / 绑定 / 成员关系，写对账游标的那条还引用了从未创建的工作区 `ws-other`；内存替身没有外键所以看不出来。处理：在装配点预置最小前置行，断言一字未改（D13）。这与 L4 的 Surprises 1 是同一类问题，区别只是本层 `suites/**` 冻结，前置行只能落在装配点。
13. **`PRAGMA foreign_keys = ON` 那一行删掉不会变红**（2026-09-23，实验 14 的副产品）。实测 node:sqlite 的 `DatabaseSync` 默认就把外键打开（`PRAGMA foreign_keys` 返回 1），只有显式 `OFF` 才能构造出"悬空引用被静默接受"的红。结论：`db.ts` 里那一句仍然必须留——它挡的是"换驱动 / 换 CLI 默认关"的那天，而不是当前的默认值。
14. **游标作用域隔离在冻结的规格里没有判别性**（2026-09-23，实验 15）。把 `getSyncCursor` 的读路径去掉 `binding_id` 维度后，契约套件 41/41 **全绿**——规格里只写过"一个绑定下的一条游标"，`(绑定, scopeKey)` 的隔离从未被断言；只有集成用例的"同一个 scopeKey 在不同绑定下是两条游标"能钉住它。这是 R5 的 scope 定义的一部分，登记为遗留 7。
15. **成员关系换条目时，两个实现对旧条目上的字段值处理不同**（2026-09-23，L5 实现时发现）。内存替身保留孤儿行，SQLite 侧必须连带删除（DDL 无 `ON DELETE CASCADE`，旧条目已不存在）。契约套件不覆盖这一格，登记为遗留 6。
16. **观察账本在 `receivedTime` 碰撞时不是只追加（P0）**（2026-09-23 修复轮，独立对抗验证在 head `0aa7c34` 上判 `partially_falsified`）。实测：同一 `(工作区, 条目, receivedTime)` 下第二条**不同 dedupeKey** 的观察走 `ON CONFLICT (workspace_id, item_external_id, observed_at) DO UPDATE` 把第一行顶掉；第一行再投递返回 `true`（调用方据此重放副作用），账本永久丢一条。根因是键：`observed_at` 是**本地接收时刻**，同毫秒/秒碰撞是可能的，而只按 (主体, 接收时刻) 做键的表在物理上放不下两条不同的观察——`dedupeKey` 只躺在 `snapshot_json` 里（D11 的原决定），管不住主键冲突。修法与证据见 D14 / 实验 16。
17. **`sourceVersion: undefined` 被读成一个具体的最小版本（P1-a）**（2026-09-23 修复轮）。实测：两条 `sourceVersion: undefined`（不同 key）在内存替身上都返回 `true`，SQLite 第二条返回 `false`——合法的新事实被静默丢弃。机理：`undefined` 落成空串（`updated_at` NOT NULL），读回后与 `undefined` 比较得到 -1，于是被判成乱序。处理：读回时把 `''` 还原成 `undefined`（D15）。教训：**落库编码与端口值之间的往返必须有一处显式还原**，否则"没有这个值"会被读成一个具体的值。
18. **切分守卫对"整组没装配"没有判别性（P1-b）**（2026-09-23 修复轮）。实测：删掉 SQLite 的同步组装配后 `node --test tests/contract` 仍 422/422 全绿，条数从 429 静默掉到 422——`suites/storage.js` 里"或整组不再被装配都会变红"这句是假的，`countSuiteCases` 数的是**组文件**而不是**装配结果**。处理：装配收敛到唯一入口并记录实际注册条数，守卫拿独立写下的期望台账核对（D16 / 实验 18）。教训：守卫要断言"实际发生了什么"，不能断言"源文件里写了什么"。
19. **committed 的主体粒度与列表顺序在两个实现间不一致**（2026-09-23 修复轮复验时发现，登记为遗留 8）。内存替身按 `(binding, subject)` 分 committed 槽位，SQLite 侧的主体内涵是 `(workspace, item_external_id)`（账本外键指向成员关系）——同一个内容被两个绑定观察时，替身保留两个 committed，SQLite 只有一个主体。列表顺序也不同：替身按插入序返回，SQLite 用 `ORDER BY`（成员关系按 `item_external_id`、字段值按 `project_field_id`）。契约套件两条都没覆盖，所以两边都能通过。**评审修复轮收口**：committed 那一半按 D17 修（主体含 `binding_id`，视图维度由 L3 的 `8cf7d18` 同批改），列表顺序仍留在遗留 9。

20. **"换条目删账本"的根因在 DDL，不在那一行代码**（2026-09-23 评审修复轮，实测）。`sync_observation` 以 `(workspace_id, item_external_id)` 外键指向成员关系，而"后者胜"要让旧条目消失——两件事在旧 DDL 下不可兼得，于是实现只能先删观察行。实测（把账本清理删掉、DDL 不动）：

    ```text
    membership delete with ledger row: REJECTED -> FOREIGN KEY constraint failed
    ```

    也就是说，本分支上"删掉清理"这一步**必须**等 L3 的 `8cf7d18`（去掉该外键）级联过来才能生效；在那之前 `成员关系后者胜…` 用例红在驱动级外键错误。处理：按"L3 的 003 为权威"实现（账本只追加），把级联要求写进本计划与评审报告，并用"L3 的 003 × 本层 003 三方合并后的等价树"跑出 36/36 作为期望值。教训：**当两条不变量在同一张表上互斥时，先修键的形状，再修代码里的顺序**——顺序修得再对，DDL 也会把它挡回去。

21. **重写 003 之后，旧库的失效点是"第一次写观察"而不是"打开"**（2026-09-23 评审修复轮，实测）。`migrate()` 只按版本号判断是否已应用（`assertAppliedIsManifestPrefix`），不校验迁移体内容，所以一个已应用版本 3 的旧库会一直"看起来是新的"。把库退回重写前的 7 列形状后实测：自检关掉时 `recordObservation -> no such column: dedupe_key`（驱动级、没有处置）；自检打开时**打开库这一步**就抛 `本地库是重写前的 003（sync_observation 缺 dedupe_key）：请删除库文件重建`。处理见 D18；这是"发布前可整份重写迁移"这条既定取舍的收尾成本，不是新增范围。

22. **级联不是"重放一遍改动"，003 会真的冲突**（2026-09-23 评审修复轮，实测）。L3 的 `8cf7d18` 与本层 `cafc245` 都改了 003 的同一段（注释 + `sync_observation` 的主键 / 外键块）：`git merge-file` 给出两处冲突，解决方式是"两段注释都保留 + 主键含 `dedupe_key` 且不带外键"。把合并结果放回同一棵树后集成 36/36、存储契约 44/44——**冲突是文本层的，语义上没有分歧**。这一条写给收口流程：级联 L5 时不要机械取一侧，两处都要看。

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
- **Decision**：级联 L2/L3 时，`suites/storage.js` 取 L4 的切分结构，只把 L2 对**既有用例**的两处语义改动带进 `storage-foundation.js`（默认绑定与 replace 各改用 `development` 域），L2 新增的断言不搬进组文件。**Rationale**：L2 把身份与成员关系面单独成文在 `suites/storage-identity-membership.js` 并原样继承，搬一遍就是同一事实的第二份权威副本；两处域改动则是必需的——新契约下第二个启用的 planning 挂载会被拒绝，不改这两条用例会在两个实现上都变红。**Superseded by 第四轮修复轮（2026-09-26）**：`suites/storage-identity-membership.js` 已接受 `register` 参数并纳入装配台账；删掉任何一组装配都会红。**Date/Author**：2026-09-24 / L4 级联执行者。
- **Decision**：`putProviderBinding` 的两条语句包进原子作用域，而不是把所有约束在端口里预检。**Rationale**：见 D20——约束的权威在 002，端口只负责不留下半写状态；预检会把约束抄第二遍。**Date/Author**：2026-09-24 / L4 级联执行者。
- **Decision**：身份与成员关系面（`suites/storage-identity-membership.js`）不进 `assemble` 装配台账，直接注册。**Rationale**：L2 的那份文件声明了 `register` 参数却直接调 `test(...)`，`countSuiteCases` 数到 0，硬塞进台账只会让守卫拿到恒 0 的期望；该文件不在本层授权面，本层不改它，把这个缺口写进计划而不是绕过去。**Date/Author**：2026-09-24 / L5 级联执行者。
- **Decision**：观察落点按 `(绑定 → 工作区, 内容种类 + 内容 id → 成员关系)` 解析，解析不到抛错。**Rationale**：`false` 的端口语义是"重复或乱序"，不能承载"没有落点"；凭空造成员关系是把推导塞进 storage。**Date/Author**：2026-09-23 / L5 实现者。 **Superseded by L5-H（2026-09-24）**：账本主体改成端口主体（连接级）后，观察不解析落点、也不要求成员关系存在。
- **Decision**：去重键随整条观察快照存进 `snapshot_json`，用 `json_extract` 查，而不是新增列或新表。**Rationale**：迁移文件冻结，账本也没有读回接口；新表是同一事实的第二个家。**Date/Author**：2026-09-23 / L5 实现者。**已被 D14 取代**：这条决定漏掉了"`dedupeKey` 必须参与主键"，实测导致 P0（两条不同的观察互相顶掉，Surprises 16）。
- **Decision**：成员关系后者胜时连带删除旧条目上的字段值与观察，同条目重写走 UPSERT 不删行。**Rationale**：DDL 没有 `ON DELETE CASCADE` 且旧条目已不存在；幂等覆盖若删行会清掉挂载点。**Date/Author**：2026-09-23 / L5 实现者。
- **Decision**：SQLite 的同步组前置行落在契约装配点，而不是改 `suites/**`。**Rationale**：本层 `suites/**` 冻结；断言是规格，前置行是"在什么状态下检验"，与 L4 的处理同型。**Superseded by Batch E（2026-09-26）**：前置状态已改在 `suites/storage-sync.js` 的用例里，装配点不再直插。**Date/Author**：2026-09-23 / L5 实现者。

- **Decision**：改 003 迁移，把 `dedupe_key` 放进 `sync_observation` 主键并加 `(binding_id, dedupe_key)` 唯一索引，`committed_observation` 补 `rowid` 追加序 tie-break。**Rationale**：P0 是数据丢失（两条不同的观察互相顶掉、已见 key 再投递返回 `true`），根因在键；控制计划 D12 允许发布前重写迁移，把端口去重键做成库级唯一比端口"先查后插"更强。**Date/Author**：2026-09-23 / L5 修复执行者。
- **Decision**：`recordObservation` 的插入改回裸 `INSERT`，不再保留任何 `ON CONFLICT … DO UPDATE` 分支。**Rationale**：账本只追加；"同一观察落两次"是结构性错误，保留覆盖分支就是把 P0 从"丢数据"降级成"静默覆盖"。**Date/Author**：2026-09-23 / L5 修复执行者。
- **Decision**：`sourceVersion` 的 `undefined` 只在读回时还原（`'' → undefined`），不改列的可空性与写入编码。**Rationale**：`updated_at` NOT NULL 的编码本身没问题（空串即最小版本），错的是把编码当成端口值来比较；改可空列会让视图与比较都陷入三值逻辑。**Date/Author**：2026-09-23 / L5 修复执行者。
- **Decision**：装配守卫的期望台账独立于装配实参书写，装配结果由唯一入口 `assemble` 记录。**Rationale**：从实参推导期望的话，删掉装配调用会连期望一起删掉，守卫永远绿——那正是 P1-b 的缺陷形态。**Date/Author**：2026-09-23 / L5 修复执行者。

- **Decision**：`putMembership` 只清旧条目上的字段值，**不**清观察账本（推翻 L5 实现轮的原决定）。**Rationale**：账本只追加，删行会让"同一观察再投递必须返回 `false`"在换条目这一格上失效，调用方据此重放副作用；原清理是账本外键逼出来的顺序，根因由 L3 的 `8cf7d18` 去掉外键后消失。**Date/Author**：2026-09-23 / L5 评审修复执行者。
- **Decision**：`#committedVersion` 的主体改成 `(binding_id, item_external_id)`，与端口 subject 一致。**Rationale**：不变量 2 允许一个工作区连接多个提供方，主体少了 binding 就会把第二个 provider 的首条合法观察判成乱序并静默返回 `false`——静默丢事实比报错更贵。**Date/Author**：2026-09-23 / L5 评审修复执行者。 **Superseded by L5-H（2026-09-24）**：主体进一步收敛到端口 subject `(binding, objectKind, objectExternalId)`，条目 id 不再参与。
- **Decision**：在同步面根实例的构造点做 003 重写自检，命中时显式抛"请删除重建"。**Rationale**：`migrate()` 不校验迁移体内容，旧库的失效点在"第一次写观察"且是驱动级报错；本层允许面只有 `storage-sync.ts`，而账本正是同步面的表。**Date/Author**：2026-09-23 / L5 评审修复执行者。
- **Decision**：`snapshot_json` 原样持久化整条 `ProviderObservation`，脱敏责任写在 provider 侧；这一句先落在 `storage-sync.ts` 的模块注释与本计划，端口注释一条登记为遗留 11。**Rationale**：`packages/capabilities` 不在本轮允许面；而"默认原样、没人说过"是三种状态里最差的一种。**Date/Author**：2026-09-23 / L5 评审修复执行者。

- **Decision**：第五轮评审后本层改为关闭 #163，并把事务令牌的生命周期用例放回本层。
  **Rationale**：#163 验收 6 缺的只是「迁移重跑前有一次经端口写入」，补 2 行即字面满足，否则整栈没有任何一层关闭 #163。令牌的可变对象、结算检查、`finally` 置假、作用域实例共享关闭状态都在本层，而钉住它们的唯一用例第四轮时在 L5、级联时整栈丢失——去掉结算检查的后果是静默丢写。评审同时发现结算检查只在调用时做、写入推迟一个微任务：未 await 的 `tx.*` 可能在 ROLLBACK 之后以自动提交落库，改为执行时再查一次（同行替换）。代码体量 994 / 1000。
  **Date/Author**：2026-09-26 / agent（第五轮 MMP 评审，评审者就地修复）
- **Decision**（第四轮，补登）：体量 1110 → 981 靠把地基组留在 `suites/storage.js` 原地、不搬新文件实现，而不是插一个纯搬移 PR 或申请豁免；`replacePlanningProjections` 改走 `atomic`；断言多重集基线取 head 快照。
  **Rationale**：搬移行数减半且 0 条断言丢失（第五轮复核：de95f94 → head 逐句比对）。基线取 head 快照只能防「今后变少」、不能对照切分前的套件，第五轮评审列为测试债（#201）。
  **Date/Author**：2026-09-24 / agent（第五轮补登）
- **Decision**：装配台账与守卫从第四轮版本恢复，并把身份面两组也纳入 `assemble`（为此 `suites/storage-identity-membership.js` 接受 `register` 参数）。**Rationale**：第四轮"删掉 SQLite 同步组装配仍全绿"的缺陷形态同样适用于身份同步组——它是 L5-G、验收 42、遗留 6/9 的证据来源，注册被删必须变红；身份面原来直接调 `test(...)`，绕过了"实际注册条数"这一层。**Date/Author**：2026-09-26 / 第四轮修复执行者。
- **Decision**：第四轮修复轮的允许面按本 PR 的实际改动订正（fake 的绑定 / 游标存在性检查、`suites/**` 补前置状态与 `register` 参数），而不是回退改动去迁就旧允许面。**Rationale**：引用完整性是 capabilities 端口注释写明的共有契约，替身不检查会让"两个实现同语义"只停在断言文本上；收敛计划 D6 第 2 条要求对齐替身。**Date/Author**：2026-09-26 / 第四轮修复执行者。
- **Decision**：`storage-sync.ts` 超过 Global Constraints 的单文件 ≤200 行（行数以 `wc -l packages/storage/sqlite/src/storage-sync.ts` 回读，不写死）；不拆文件，只如实记录。**Rationale**：`AGENTS.md` §5 不鼓励为满足行数机械拆分连续算法，机制与同步面同文件是 D10 的既定决定；行数以 `wc -l` 回读，上限继续约束单函数。**Date/Author**：2026-09-26 / 第四轮修复执行者。

## Idempotence and Recovery

- `createSqliteStorage` 对同一文件可重复调用：迁移按 `schema_migrations` 跳过已应用版本（重启用例第 3 条钉住 no-op）。
- 测试各自使用 `mkdtempSync` 的独立临时目录，`after` 钩子删除；契约装配的临时目录由 `node:test` 的 `after` 回收。
- 若判别性实验改坏后测试变红：把 `packages/storage/sqlite/src/storage.ts` 还原到 Batch L4-B（修复轮之前）或 Batch L4-D（修复轮之后）的内容再复跑最窄命令；本层没有跨提交的中间状态需要清理。
- 修复轮的回退顺序：单独 `git revert` Batch L4-D 的提交会把队列与三条写者路径用例一起撤掉——它们是一个闭环，不能只回退一半（只回退队列会留下红的共享断言，只回退用例会让 P1 静默复活）。
- 修复轮 2 的回退顺序同理：单独 `git revert` Batch L4-E 的提交会把读队列、两条快速失败与四条用例一起撤掉；只回退用例会让 P1 脏读与两条 P3 静默复活。判别性实验改坏后要还原 `storage.ts`，用 `git checkout -- packages/storage/sqlite/src/storage.ts` 回到 Batch L4-E 的版本即可（本层没有跨提交的中间状态）。
- 若合并后发现设计错误：按提交逆序 `git revert` 本层的 3 个提交（`docs(review)` → `docs(storage)` → `feat(storage)`；实现与钉住它的用例在同一个 `feat(storage)` 提交里，不能只回退一半），002/003 的表与约束不受影响；本地库文件按临时目录处理，不存在需要保住的数据。**第五轮订正**：原文按 Batch L4-A–C 的提交描述，批次与提交早已不再一一对应。

- L5 的回退：按提交逆序 `git revert` 本层的提交（清单以 `git log --oneline "$BASE"..HEAD` 回读，`BASE` 取 `gh pr view 170` 的 `baseRefOid`）。同步面实现与钉住它的契约同步组 / 共享同步用例 / 集成用例在同一个 `feat(storage)` 提交里，不能只回退一半（只撤实现会留下红的用例与装配，只撤用例会让同步面失去验收点）；计划与评审记录各自可单独回退。
- L5 判别性实验都只改一个语义点（去重、定序、UPSERT、外键、游标读路径、观察键、版本读回、装配）；还原靠 `packages/storage/sqlite/src` 与迁移文件的副本逐文件覆盖，并用 `diff` 确认与实验前逐字节一致。
- L5 修复轮的回退：`git revert` 该提交。观察键、视图 tie-break、用例与守卫是一个闭环——单独回退迁移会让 P0 的三条用例变红，单独回退用例会让 P0 静默复活。已有库文件按临时目录处理：003 在发布前重写，不存在需要保住的旧库。

## Interfaces and Dependencies

```text
packages/storage/sqlite/src/index.ts
  openDatabase(location: string | ':memory:'): WorkspaceDatabase   # 既有
  migrate(db: WorkspaceDatabase): { applied: number[]; version: number }  # 既有
  createSqliteStorage(location: string | ':memory:'): SqliteStorage       # L4 新增
  SqliteStorage: Storage & { readonly location: string; close(): void }   # close/location 不是端口方法；同一个类也充当 StorageTransaction（作用域由 `scoped` 表达）；每个读方法都经过基类的唯一入口 `read`
  NESTED_TRANSACTION_MESSAGE: string                                       # 约定文本：作用域实例再开事务（两个字面量各自维护，共享断言钉整串）
  OUTER_INSTANCE_MESSAGE: string                                           # 约定文本：work 里调外层实例（队列内自等）
  CLOSED_MESSAGE: string                                                   # 约定文本：实例已关闭后的任何调用
  SqliteSyncSurface                                                        # L5 新增（`storage-sync.ts`，包内可见、不对外导出）：**唯一的写者 / 读者路径机制**（`#queue` / `scoped` / `TX_SCOPE` / `#closed` + `mutate` / `read` / `write` / `transaction` / `close`）+ 成员关系 / 字段值 / 观察 / 游标；SqliteStorage 继承它，对外形状不变
```

003 的观察账本（**按 L3 的新 003 实测订正，2026-09-24**）：`sync_observation` 主键 `(binding_id, object_kind, object_external_id, observed_at, dedupe_key)`（主体 = 端口 subject，连接级），另有唯一索引 `sync_observation_dedupe (binding_id, dedupe_key)`；`committed_observation` 是视图，判据为 `updated_at` 最大 → `observed_at` 最新 → `rowid` 最大（追加序）。回读命令：`BASE=$(gh pr view 170 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)`；`git show "$BASE":packages/storage/sqlite/migrations/003_control_facts.sql | grep -n 'PRIMARY KEY (binding_id'`。**Superseded by L3 的新 003 / L5-H（2026-09-24）**：原文写主键 `(workspace_id, item_external_id, observed_at, dedupe_key)`，与 head 相反。端口面没有观察查询方法，这两条只有集成用例与 schema 用例读得到。

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

**L5 实际交付（2026-09-23）**：

- `storage-sync.ts`：`SqliteSyncSurface`（写者路径机制 + 成员关系 / 字段值 / 观察 / 游标共 10 个方法），`storage.ts` 改为继承它；桩清单 20 → 10（只剩执行组）。
- 观察账本：`(bindingId, dedupeKey)` 去重、字典序定序、同版本整快照替换、`false` = 未应用；落点解析到成员关系，解析不到显式失败。**Superseded by L5-H（2026-09-24）**：账本主体 = 端口主体（连接级），观察**不解析落点、也不要求成员关系存在**。（修复轮更正：去重键的落点从 `snapshot_json` 移到账本键上，见 D14。）
- 契约装配：SQLite 跑地基组 + 同步组（条数以命令回读为准；观察时刻快照：地基 13 + 同步 8），同步组的 `restart` 真正被调用；前置行落在装配点（D13）。
- `tests/integration/storage-sync-surface.test.js`：去重账本、定序、committed 视图、后者胜、引用完整性、观察不解析落点、游标作用域（条数是观察时刻快照：7 条起）。
- 五条判别性实验 + 全门禁复跑，摘要见 `Progress`。

**L5 修复轮实际交付（2026-09-23，Batch L5-D）**：

- 003：`sync_observation` 的键含 `dedupe_key` + `(binding_id, dedupe_key)` 唯一索引，`committed_observation` 补 `rowid` 追加序 tie-break（D14）。
- `storage-sync.ts`：`recordObservation` 改裸 `INSERT`、去重按列查、`columnToVersion` 读回还原（D14 / D15）。
- 契约：新增"两条 `sourceVersion` 缺失的观察都必须被应用"（两个实现各一次）；装配守卫按实际注册条数核账，`suites/storage.js` 的假注释改正（D16）。
- 集成：新增"同一主体、同一接收时刻的两条不同观察互不顶掉"；`execution-relation-write-schema.test.js` 同步列集合与唯一性断言。
- 三条新判别性实验 + 原有五条在 head 上重跑；全门禁复跑（观察时刻快照，不可复跑：契约 432、集成 34、e2e 38、mvp0 7、`tsc` 0）。

**L5 评审修复轮实际交付（2026-09-23，Batch L5-E）**：

- `storage-sync.ts`：`putMembership` 不再删观察账本行（D12 修订）；`#committedVersion` 主体含 `binding_id`（D17）；根实例构造时做 003 重写自检（D18）；模块注释写明 `snapshot_json` 原样落库、脱敏在 provider（D19）。文件行数以回读为准：2026-09-26 实测 265 行（超出 Global Constraints 的单文件 ≤200 行；不拆文件的理由见 Decision Log）。
- 集成：`成员关系后者胜…` 的恒真断言换成"投递 → 换条目 → 再投递 → 仍 `false` 且行数不变"；新增"committed 按端口主体定序…"与"003 重写后的库自检…"（条数是观察时刻快照：`storage-sync-surface.test.js` 8 → 10）。
- 计划：基线 `e49f0ee` → 实测 `6526ded9`（7 处）；新增 D17/D18/D19、Batch L5-E、验收项 32–35、Surprises 20–22、遗留 11，并按 P1 修订 D12。
- 迁移文件**未动**：账本外键与 committed 视图的 binding 维度由 L3 的 `8cf7d18` 负责；本层记录级联要求与合并冲突的两处解法（Surprises 22）。

**重建实际交付（2026-09-23，Batch L5-F）**：

- 机制统一收进 `SqliteSyncSurface`：`#queue` / `scoped` / `TX_SCOPE` / `#closed` 只有一份声明，`mutate` 是唯一入口、`read` 复用同一条串行点；`SqliteStorage` 只留地基面端口方法 + `scopedInstance()`，没有自己的队列。
- 两个面的每个读方法都经过统一入口；判别性实验 22 证明把任一读改回直接读会让"未提交的写入不得被事务外的读看到"变红。
- 003 在 L3 的新形状上只加 `dedupe_key`；L4 修复轮 2 与 L5（含修复轮、评审修复轮）的断言与记录全部保留在同一棵树上。
- 集成与契约全绿（条数以 `node --test tests/contract` / `node --test tests/integration` 回读为准；原文的"集成 40、契约 501、SQLite 地基 12 + 同步 7 = 19、身份面 8 ×2、内存替身 20"是观察时刻快照，不可复跑）。

**L5 与计划的偏差**：① 原以为"把装配换成地基 + 同步即可"，实测发现同步组缺外键前置行（Surprises 12），只能落在装配点；② 实验 15 的写路径改法给出的是驱动级错误，改读路径后才发现**契约规格对游标隔离没有判别性**（Surprises 14）；③ 实验 14 顺手证伪了"删掉 `PRAGMA foreign_keys = ON` 会红"的直觉（Surprises 13）；④ 集成用例第一版把 `payload` 与 `stablePayloadFields` 混用（覆盖了后者却断言前者），在实现轮才发现并改正——提交 ① 的树已按改正后的断言复跑红证据；⑤ 评审修复轮的范围比"改一行"大：删掉清理后暴露出"不变量在同一张表上互斥"的根因（Surprises 20），本层只能按 L3 的权威 DDL 实现并把级联要求写清楚。

**重建与计划的偏差**：① 原计划是"把 L5 内容搬到新底"，实测发现机制本身也要一起搬——`#queue` / `TX_SCOPE` / `#closed` 分散在两侧的子类里，只有把它们收进基类才能同时满足"两个面共用一条队列"与"不丢任一侧的快速失败"；② 计划文档的三条编号序列（决定 D8–D17、验收项 16–35、Surprises 8–19）与 L4 修复轮 2 的同号序列相撞，重建时把 L5 侧整体后移（D10–D19 / 20–39 / 11–22）并统一实验编号为 1–23；③ 旧库自检用例的"重写前形状"原先带账本外键，新底上 003 已无外键，前置形状随之校正（判据不变）。

**与计划的偏差**：① 原以为切分是"零改动"，实测发现两条用例缺少外键前置行（见 `Surprises & Discoveries` 1），按"不动断言、只补前置行"处理；② 嵌套事务的收口必须改到内存替身，越出控制计划的 L4 文件所有权 4 行（见 D3）；③ 修复轮里"按指令提升的两条用例"不足以钉住 P1-2，共享组因此多了一条回滚分支用例（见 `Surprises & Discoveries` 6 / D6），`ADDED_CASE_COUNT` 最终为 4；④ 体量压缩的规模远超"桩表驱动省 20 行"的预估（见 `Surprises & Discoveries` 7 / D7）；⑤ L5 修复轮越出"不得改迁移文件"的约束改了 003（用户指令明确允许，理由见 `Global Constraints` 的越界说明），并因此同步了 `execution-relation-write-schema.test.js` 的列集合与位置式 INSERT（断言语义未变）。

### 遗留问题与技术债务

1. **投影 UPSERT 的覆盖分支无判别性用例**（`Surprises & Discoveries` 2）。**已收口（2026-09-23 修复轮 2）**：在地基组补了"同一 `(工作区, 实体)` 的第二次写入覆盖前值"，一次覆盖两个实现；实验 10 证明把 `DO UPDATE` 改成 `DO NOTHING` 会红。不再挂到同步组落地。
2. **仓库没有对应的外部身份种类**（`Surprises & Discoveries` 3）。收口条件：真实 provider 切片决定仓库身份的登记方式（新增种类或改用别的锚点）后，把契约夹具里的 `branch` 占位换掉。
3. **`replacePlanningProjections` 的实体清理在两个实现间不一致**（`Surprises & Discoveries` 4）。收口条件：core 需要"移除投影即移除实体"时，先决定身份与实体的生命周期，再补端口方法或约束；当前契约只覆盖投影集合。
4. **执行组 10 个端口方法仍未实现**（L5 之后剩执行上下文与运行 / 关系 / 写尝试）。它们是 `not implemented in L4` 的显式桩，`tests/contract/suites/storage-execution.js` 已就绪：下一层把方法实现后，把 SQLite 的装配从"地基组 + 同步组"换成 `storageContractSuite` 即可跑全部三组。**L5 已收口**：同步组的 7 条在两个实现上都跑，且 SQLite 侧真正走 `restart`。
5. **core 的同步路径不写成员关系，SQLite 上会抛"观察无法挂载"**（Surprises 11 / D11）。`packages/core/src/bootstrap.ts` 的 `recordObservations` 只写投影与观察，而端口的落点解析要求成员关系先存在（D11；原先由账本外键兜底，该外键已由 L3 的 `8cf7d18` 去掉，解析这一步不变）——内存替身不做落点解析，所以这条路径在替身上一直"能用"。**两条具体后果（2026-09-23 修复轮补记，P2）**：① 抛错发生在**同一个同步事务**里，因此整笔事务回滚——投影、修订号与游标全都不落库，不是"只丢了观察"；② `bootstrapWorkspace()` 从"结构化失败"变成 rejected，异常穿透到调用方。收口条件：由写成员关系的那一层（真实 provider 切片或 core 的同步步骤）先落成员关系，再投递观察；届时补一条 core + SQLite 的端到端用例。**在那之前，"验收表 39 项全通过"不得读成"SQLite 已经可以当 core 的 storage"。** **已收口（2026-09-24 L5-H 重建）**：账本主体改成端口主体之后，观察**不解析落点、也不要求成员关系存在**，这条路径不再抛错。
6. **成员关系换条目时两个实现对旧条目字段值的处理不同**（Surprises 15 / D12）。收口条件：契约套件补一条"换条目后旧条目的字段值"的用例，两个实现按同一语义对齐（预期是连带删除：旧条目已经不存在）。**同一决定的账本那一半已收口**（2026-09-23 评审修复轮）：原先 SQLite 连带删除旧条目上的观察行，于是换条目后同一个 `dedupeKey` 再投递会再次返回 `true`；按 D12 修订删掉该清理后，两个实现在这一格上都是 `false`（判据是集成"成员关系后者胜…"的第二段）。 **已收口（2026-09-24，判据 = 身份同步组用例）**：用例「成员关系被取代时旧条目名下的字段值一并删除」在两个实现上都跑，替身与 SQLite 都连带删除；D12 里的"替身保留孤儿行"已就地订正。
7. **游标作用域隔离在共享规格里没有判别性用例**（Surprises 14；**订正 2026-09-26**：`suites/**` 已不冻结，收口条件改为"把同一个 scopeKey 在不同绑定下是两条游标补进共享用例"；在此之前由 `tests/integration/storage-sync-surface.test.js` 的"游标按作用域隔离"钉住）。**游标的工作区维度缺失（#189 / ADR-0006 的逐记录作用域表）**：`SyncCursorRecord` 的键只有 `(bindingId, scopeKey)`，而绑定是跨工作区共享的连接锚点——同一绑定被多个工作区挂载时，一个工作区的失败会被另一个工作区的成功覆盖（`degraded` → `healthy`，core 的 freshness 只读这一处）。收口条件属于**端口层**（键里补 `workspaceId` 是签名变更、会波及 core）；本层不改 DDL，只在 `storage-sync.ts` 的 `putSyncCursor` 注释里记录并指向 #189。
8. **committed 的主体粒度在两个实现间不一致**（Surprises 19 / D17）。内存替身按 `(binding, subject)` 分 committed 槽位，SQLite 侧的主体内涵是 `(workspace, item_external_id)`（账本外键指向成员关系，ADR-0002）——同一个内容被两个绑定观察时，替身保留两个 committed，SQLite 只有一个。**评审修复轮收口**：取"含 binding 维度"（D17）——实现侧 `#committedVersion` 的主体改成 `(binding_id, item_external_id)`，视图侧由 L3 的 `8cf7d18` 同批改；判据是集成"committed 按 (绑定, 条目) 定序…"与 L3 自己的视图用例。仍在契约套件之外（`suites/**` 冻结），收口条件：解冻 `suites/**` 时把这条语义补进同步组。 **已收口（2026-09-24 L5-H 重建）**：主体的内涵与端口 subject 逐字相同（`(binding, objectKind, objectExternalId)`），条目 id 已不在主体里，两个实现同判据。
9. **列表顺序在两个实现间不一致**（Surprises 19；**2026-09-24 收窄到 `listFieldValues`**）。`listMemberships` 那一半已由身份同步组用例「listMemberships 按 itemExternalId 升序返回」钉住；剩下的只有 `listFieldValues`——内存替身按插入序、SQLite 按 `project_field_id`，契约套件不断言它的顺序，所以两边都能通过。收口条件：补一条契约断言（按 id 排序）**或**在端口注释里写明"顺序不保证、调用方不得依赖"，二者择一。
10. **版本比较器在两个实现间不一致**（2026-09-23 修复轮复验时发现）。内存替身用 `localeCompare`（ICU 排序），SQLite 用码点比较（`<`）；实测分歧只出现在大小写 `z` 这一类（`localeCompare` 里小写在大写前，码点里 `Z`(0x5A) < `z`(0x7A)）。当前 R4 的载体是 ISO-8601 UTC 时间戳，不含字母，所以两种比较等价。收口条件：把"载体必须是**大写 `Z`** 结尾的 ISO-8601 UTC"写进定序契约（`packages/capabilities/src/observation.ts` 的 `ProviderObservation.sourceVersion` 注释），把这条隐含前提变成明文约束。 **已收口（2026-09-24 L5-H 重建）**：比较器收敛到 `capabilities` 的 `compareSourceVersion`（码点序，与视图的 BINARY 等价），非 ASCII 载体由 `isComparableSourceVersion` 在 `recordObservation` 入口拒绝。
11. **"`payload` 由 provider 先脱敏"这条只写在实现与计划里，端口注释没有它**（2026-09-23 评审修复轮，D19）。`snapshot_json` 原样持久化整条 `ProviderObservation`（含 `payload: unknown`），责任划分目前写在 `storage-sync.ts` 的模块注释与本计划里，而**契约层**（`packages/capabilities/src/observation.ts` 的 `ProviderObservation.payload`）没有这句话。收口条件：**允许改 `packages/capabilities` 时**，在 `payload` 的注释里写死"必须由 provider 在构造观察前脱敏（凭据只以 secret 句柄存在，不进入 Project 数据库）；storage 原样持久化，不做二次处理"，并补一条能力契约用例（例如断言观察的 `payload` 不含 `token` / `signature` / 邮箱形状的字段）。在那之前，本层不擅自改契约包。 **已收口（L3）**：端口注释已写明 payload 由 provider 负责脱敏、storage 原样持久化。
12. **条目 id 被重新登记给另一个内容时，新内容的合法观察仍可能被判成乱序**（2026-09-23 评审修复轮，P2 的第二条后果，本层未收口）。账本主体是 `(工作区, 条目)`（ADR-0002），而端口允许"同 `(工作区, 条目)` 幂等覆盖"——`item-1` 从内容 A 改挂到内容 B 之后，内容 A 的账本行仍挂在 `item-1` 上；内容 B 的首条观察若版本比 A 的已提交版本旧，就会被判成乱序并静默返回 `false`（内存替身按 `(binding, subject)` 分槽位，不会）。D17 的 binding 维度**修不了**这一格：两个内容在同一个绑定、同一个条目下。收口条件：先决定账本主体是否要含内容引用（`sync_observation` 加内容列，或让 committed 主体含 `content_external_kind/id`）——这是 DDL 决策，归 L3；在决定之前本层不擅自加列。判据：契约套件补一条"同条目换内容后新内容的首条观察必须被应用"，两个实现按同一语义对齐。 **已收口（2026-09-24 L5-H 重建）**：账本主体不再含条目 id，条目改挂内容不再影响定序；判据是契约套件的"没有成员关系的观察必须被应用，换条目后再投递同一观察仍是 false"。
13. **跨实例自等的共享用例缺另一半**（`Surprises & Discoveries` 8）。SQLite 侧已快速失败并有用例（`storage-contract.test.js`）；内存替身的 `#mutate` 不检查 `#transactionScope`，同一动作是静默挂起（实测 1.2s 不 settle）。收口条件：给 `packages/providers/fake/src/storage.ts` 的 `#mutate` 加一行作用域检查（约 2 行），然后把该用例从 SQLite 专属文件提升进共享地基组。该文件不在本轮授权面（控制计划把它记为"其它包"；D3 的 4 行越界属于上一轮，本轮不扩大）。
14. **端口注释没有写明读的排队语义与列表顺序**（本轮 P1 / P3 的收口面之一）。评审建议把"读不得暴露未提交写入""顺序不保证、调用方自行排序"写进 `packages/capabilities/src/storage.ts`，但该文件不在本轮授权面。收口条件：下一轮在端口 `Storage` 的读方法组上补一段说明——读不得暴露未提交写入（实现可选择排队或快照，差别是读取时刻而不是可见性）、列表顺序不保证；本层 SQLite 用 `rowid` 与替身对齐只是实现选择，不是端口承诺。
15. **`repository` / `workspace_revision` 的引用完整性在两个实现间分叉**（2026-09-24 评审补登；PR 描述里登记过，计划里曾在重排编号时丢掉；L4 侧原编号 5，本文件 L5 侧整体后移过编号）。收口条件：替身补两条存在性检查（本轮 L2 已补），或共享组补用例。
16. **替身与 SQLite 在事务语义上的三处分叉**（第五轮评审登记）：读取时刻（事务在途时的外部读）、活性（work 里调外层实例）、作用域生命周期（结算后与未 await 的 `tx.*`，SQLite 已在执行时再查令牌并拒绝，替身照常落库）。收口条件：替身补作用域令牌，或端口注释把三者写成「实现可选的更严行为」。
17. **投影写入的两处分叉**（第五轮评审登记）：`putPlanningProjection` 的 `workspaceId` 替身以记录为准、SQLite 以参数为准；`replacePlanningProjections` 的 items 指向不存在的实体时替身接受、SQLite 以外键拒绝。收口：共享地基组补两格并统一语义（#201）。
18. **同一进程对同一文件开第二个句柄**（第五轮评审登记）：事务从 `BEGIN IMMEDIATE` 持锁到 await 结束，`node:sqlite` 是同步驱动、`busy_timeout = 5000`，第二个句柄写入会冻结事件循环约 5 秒后抛驱动文案。今天没有宿主开两个句柄。收口：按 realpath 键控复用句柄，或把 `SQLITE_BUSY` 映射成端口级错误。

## Bottom Change Note

- 2026-09-23：首次创建。原因：控制计划 Batch L4 要求本层建立自己的 ExecPlan（D9），而用户把本层范围收窄为"机制 + 地基面"，需要一份自包含的计划说明交付边界、三组切分与守卫、以及四条判别性证据。
- 2026-09-23（L5）：Batch L5-A/B/C 交付规划同步面。原因：issue #164 要求把成员关系、字段值、观察账本与游标落到 002/003 的表上，并把 SQLite 的契约装配扩到同步组；实测发现端口键与 DDL 键之间缺一次"观察 → 成员关系"的解析（Surprises 11）与同步组缺外键前置行（Surprises 12），处理写进 D11 / D13。
- 2026-09-23（修复轮）：独立对抗验证对 head `8333cec` 判 `partially_falsified`，两条 P1 都在"SQLite 的事务语义与内存替身不等价"上。本轮按根因加实例级写队列（D5）、把写者路径语义提升进共享组并补上能真正分辨 P1-2 的回滚分支（D6）、在 ≤1000 行内完成体量压缩（D7）；判别性实验 ① ② 的实际摘要见 `Progress`。
- 2026-09-23（修复轮 2）：评审 P1 实测 SQLite 的读路径绕开写队列、把未提交写入暴露给事务外的读者（内存替身不会），另有两条 P3（work 里调外层实例无限挂起；`close()` 把驱动文案抛给调用方）与三条"断言没有判别力"。本轮按根因让读与写共用同一条队列（D8）、用 `AsyncLocalStorage` 与实例标记把三类误用变成可识别错误、把读隔离与投影覆盖提升/补进共享组并把嵌套事务断言收紧到整串（D9）；证据基准 `a646073` 全部改为实测 base `19f931ee`，条数账按实测更正（见验收表第 1 项）。
- 2026-09-23（L5 修复轮）：独立对抗验证对 head `0aa7c34` 判 `partially_falsified`，1 条 P0 + 2 条 P1 属实。P0 是账本键缺 `dedupeKey`（同一接收时刻的两条不同观察互相顶掉、已见 key 再投递返回 `true`），按根因改 003 的键并补视图 tie-break（D14）；P1-a 是 `undefined` 版本的空串编码在读回时没有还原（D15）；P1-b 是切分守卫数的是组文件而不是装配结果（D16）。另把 P2/P3 的后果与遗留写进验收表、遗留 5 与遗留 8/9/10，并在 head 上重跑了原有五条实验（旧集成数字系统性差 1）。
- 2026-09-23（L5 评审修复轮）：PR #170 的六条评审意见全部属实，按根因分两层收口。L3 侧（`8cf7d18`）去掉账本到成员关系的外键、把 committed 视图的主体改成含 binding；本层（Batch L5-E）随之删掉"换条目删账本"的清理（D12 修订）、把 `#committedVersion` 的主体改成 `(binding_id, item_external_id)`（D17）、把恒真断言换成判别性用例、加 003 重写自检（D18）、订正计划里失效的体量基线并把 `snapshot_json` 的安全决定写下来（D19）。本分支上 `成员关系后者胜…` 红在旧外键，级联 L3 后集成 36/36（Surprises 20/19）；`payload` 端口注释一条登记为遗留 11。
- 2026-09-23（重建）：L5 原分支与 L4 评审修复轮在类层次上撞车（队列在子类 vs 机制该在基类），`git rebase` 只能得到语义冲突。本轮按"重建而不是解冲突"处理：`git reset --hard da902e4` 后逐文件取 L5 内容，把写者 / 读者路径机制统一收进 `SqliteSyncSurface`（唯一入口 `mutate`，`read` 复用同一条串行点），003 在 L3 的新形状上只加 `dedupe_key`，两侧的修复与断言在同一棵树上同时成立；判别性实验 22 / 23 见 `Progress`。
- 2026-09-24（级联 L2/L3 重写）：L2/L3 被重写成"连接锚点 + 工作区挂载"两表（`provider_binding` 只留 `(id, implementation_key)`）并在 `tests/contract/suites/storage-identity-membership.js` 里独立成文。本轮在恢复锚点 `backup/storage-sqlite-port2-pre-review-response` 之后 `git rebase --onto 8f11e38 3e255ed`，把绑定落库改成双表并让两条语句同属一个原子作用域（D10），`suites/storage.js` 取本层的切分结构、两处既有用例改用 `development` 域，SQLite 侧注册身份地基组（同步组仍等 L5/L6）。证据基准与条数账改为当时的 base（`8f11e38` / 994/1000，观察时刻快照，不可复跑）；2026-09-24 已一律改为 `BASE=$(gh pr view 167 -R SingularityKChen/harness-projects --json baseRefOid -q .baseRefOid)` 回读与 `PRE_SPLIT_CASE_COUNT` 实测值。全门禁复跑见 `Progress` 与验收表第 41 项。
- 2026-09-26：第五轮 MMP 评审无 P0 / P1，评审者就地修复：结算检查改到执行时、令牌生命周期用例放回本层（含未 await 写入的一格；三个变异各红）、#163 验收 6 补端口写入并改为关闭 #163、上游路径指向已归档的 L2 / L3 计划、恢复路径按实际提交描述、遗留清单补登三处分叉；切分守卫基线的来源与 SQLite 注册守卫转 #201。
