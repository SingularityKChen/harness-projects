# 观察版本载体收窄与定序 ExecPlan

> 状态：Completed；载体收窄、R1 旧库恢复与 R2 并发错误结果面均已验收。最终提交、checks、issue 和合并状态以 PR #240 的实时 GitHub 回读为准。
> 创建：2026-09-29
> 范围：issue #203。把观察 `sourceVersion` 的合法载体收窄为一种定宽规范形态（UTC 纳秒时间戳），由 capabilities 提供唯一的归一函数与入口断言，`makeObservation` 与两个 Storage 实现都在入口强制；比较器、SQLite DDL 与 `committed_observation` 视图不变。本 PR 是 2 层堆叠 PR 的栈底，上层是 #70（GitHub Projects 读取投影）。评审响应 R1（评审 5352511875）追加一个不含 DDL 的纯数据迁移 005、迁移前预检与一个先备份的显式修复函数，处理旧库里已持久化的非规范载体（见 `Design / Spec` 的 R1 增补）。
> 上游输入：issue #203（反例来自 PR #157 评审 5319934035）；`packages/capabilities/src/observation.ts`、`packages/capabilities/src/storage.ts`、`packages/providers/fake/src/storage.ts`、`packages/storage/sqlite/src/storage-sync.ts`、`packages/storage/sqlite/migrations/003_control_facts.sql`；`docs/architecture/gate-e1-ruling.md` §2.5 与 R3 / R4；`docs/adr/ADR-0003-events-are-not-the-correctness-mechanism.md`；相邻 issue #70、#189、#198、#199、#201；发布前更新计划见 issue #217（尚无对应 PR，其计划文件在本分支不存在，因此只写 issue 引用，不写路径）。

## Purpose / Big Picture

完成后：

- `packages/capabilities` 对观察的 `sourceVersion` 只接受一种载体：定宽 30 字节的 UTC 纳秒时间戳 `YYYY-MM-DDTHH:MM:SS.fffffffffZ`（下称**规范载体**）。在这个定义域上，`compareSourceVersion` 的码点序、SQLite BINARY 的 UTF-8 字节序和时间序三者相同，所以契约注释列出的载体与比较器的结论一致。
- capabilities 导出纯函数 `sourceVersionFromTimestamp`，把任何 RFC 3339 date-time 无损归一成规范载体；做不到时抛 `RangeError`，不截断、不猜测。
- 未归一的值（秒级 `…54Z`、变精度 `…54.5Z`、带偏移 `+08:00`、`9` / `10`、`v9` / `v10`、sha）在 `makeObservation` 和两个 Storage 的 `recordObservation` 入口**响亮拒绝**，不再返回 `false` 被静默丢弃。
- 两个 Storage 实现（内存替身与 SQLite）在同一组共享用例上给出相同答案：未归一载体被拒绝且不留行；#203 的反例经归一后按时间序定序。
- （评审响应 R1）旧版本写过的库文件在本版本上重开时，已持久化的非规范载体在任何业务写入之前被处理：能无损归一的由迁移 005 归一；不能的，整库在任何迁移之前被拒绝，库文件逐字节不变，并有一条先备份、保留全部行的修复路径。005 之后仍混进账本的旧载体在 `recordObservation` 响亮失败，不再被静默判成乱序。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。

判断成功的最小证据：

1. 在检出本分支的工作树上，把三个产品文件（`observation.ts`、fake `storage.ts`、`storage-sync.ts`）恢复成 `origin/main` 的版本再跑新测试，失败的恰好是本计划 `Validation and Acceptance` #3 列出的那一组用例；恢复 HEAD 后全绿。
2. 变异表 M1–M14（含验收批次拆出的 M6a–M6e、M7a / M7b 与追加的 M12b、M14）的每一条都只让预期的用例变红，还原后全绿，并且每条都先证明变异确实生效。
3. `git diff origin/main...HEAD -- packages/storage/sqlite/migrations/003_control_facts.sql` 只含注释行，DDL 与视图未变。
4. （R1）跨版本重开回归文件 `tests/integration/storage-source-version-upgrade.test.js` 在 `b0218f1` 的产品代码上全红（订正：验收时把 U5 与 U7 合成一条，共 9 条，9 条全红），在 R1 之后全绿；变异 R-M1–R-M10 各自只让预期的用例变红；既有测试文件不改即绿。

## Context and Orientation

### 术语

- **观察**（`ProviderObservation`，`packages/capabilities/src/observation.ts:82-87`）：外部世界的一次变化在本系统里的统一形状。`subject = (bindingId, objectKind, externalId)` 是定序主体，`dedupeKey` 是去重键，`sourceVersion` 是平台版本载体，`receivedTime` 是本地接收时刻。
- **R4 定序**（`docs/architecture/gate-e1-ruling.md` §2.5 与 R4 行）：① 版本更大者更新；② 版本相等时整快照替换；③ 版本更小者拒绝。`recordObservation` 返回 `false` 表示「本次观察未被应用」（`packages/capabilities/src/storage.ts:171-177`）。
- **已提交快照**：同一主体里版本最大、同版本时本地接收时刻最新的那一行。内存替身在 `packages/providers/fake/src/storage.ts:290-296` 计算；SQLite 在 `#committedVersion`（`packages/storage/sqlite/src/storage-sync.ts:235-244`）和视图 `committed_observation`（`packages/storage/sqlite/migrations/003_control_facts.sql:95-110`）计算。
- **规范载体**、**归一**：见 `Design / Spec`。

### 当前状态（fact，观察时刻 2026-09-29 @ `f6a33d2`，`main` 与 `fix/source-version-order` 为同一提交）

- 比较器按码点序逐字符比较，`undefined` 视为最小（`observation.ts:107-119`）。
- 入口只校验「非空 ASCII 可打印」（`observation.ts:95-101`）。两个 Storage 各复制一份三行检查与同一句错误文案（fake `storage.ts:281-283`；SQLite `storage-sync.ts:215-217`）。
- 契约注释已经承认码点序只对「定宽、固定小数位、以 `Z` 结尾」的时间戳和定宽计数器成立，但没有任何可执行的约束（`observation.ts:60-64`）。测试反而把秒级 `2026-09-21T07:11:54Z` 与 `~` 钉成合法载体（`tests/contract/capabilities-observation.test.js:68-69`），并把 `'v1'` 钉成「照常接受」（`tests/contract/suites/storage-sync.js:114`，这一行在断言基线里：`tests/contract/storage-contract.test.js:88`）。
- 复现：在检出 `f6a33d2` 的仓库根，用 `node --input-type=module` 脚本分别对 `createFakeStorage()` 与 `createSqliteStorage()` 先写旧值、再写新值。#203 的五组反例在两个实现上全部输出 `true false`（10/10 格），`compareSourceVersion(new, old)` 均为 `-1`。
- 基线：在同一检出上，`node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js` 为 `pass 125 / fail 0`；`node --test tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js` 为 `pass 23 / fail 0`。这是观察时刻快照，执行时用同一命令在 `origin/main` 上回读。
- 今天没有任何生产路径给观察填 `sourceVersion`：fake 夹具入队的观察不带版本（`packages/providers/fake/src/fixtures.ts:72-74`，`packages/providers/fake/src/state.ts:107-113`），`emitObservation` 在仓库内没有调用者，core 只转发 provider 的观察（`packages/core/src/bootstrap.ts:173-178`）。因此 #203 目前不可达；#70 会是第一个设置观察版本的真实 provider。
- GitHub `ProjectV2Item.updatedAt` 实测为秒级、以 `Z` 结尾，同值重写不推进，同一秒内会碰撞，条目上没有 ETag / revision（`docs/architecture/gate-e1-ruling.md` §2.5、R3）。
- `planning` 的 `ProviderPlanningItem.sourceVersion`（乐观并发，只做相等比较，`packages/providers/fake/src/planning.ts:123`）与 `development` 的 `ProviderChangeRequest.sourceVersion`（头部提交 sha，谱系按相等比较，`packages/core/src/chain-facts.ts:106`）是**另外的字段**，不经过观察入口，不受本计划约束。
- `node:sqlite` 的 `DatabaseSync` 没有注册 collation 的 API（`node -e "console.log(Object.getOwnPropertyNames(require('node:sqlite').DatabaseSync.prototype))"` 的输出里只有 `function` / `aggregate`，没有 collation）。
- 迁移运行器按版本号判断是否已应用，不校验迁移文本（`grep -n "checksum\|createHash\|sha256" packages/storage/sqlite/src/*.ts` 无输出），所以只改 003 的注释不影响已建库。
- 迁移文本上有断言：`tests/integration/execution-relation-write-schema.test.js:87` 要求 003 含「updated_at 更小者拒绝」与「相等时整快照替换」两段文字，改注释时必须保留。

### 契约套件的两道守卫（改测试前必须知道）

- **条数账**：`tests/contract/storage-contract.test.js:83` 的 `CASE_LEDGER` 与 `tests/contract/suites/storage.js` 的 `ADDED_CASE_COUNT`（当前 16）。在 `storage-sync.js` 里新增一条 `register(...)`，两处都要同步加 1。
- **断言基线**：`tests/contract/storage-contract.test.js:86-90` 的 `ASSERTION_BASELINE` 是三组 suite 文件（`storage.js` / `storage-sync.js` / `storage-execution.js`）里 `assert.` 行去掉空白后的多重集。基线里任何一条在当前文件中消失都会变红；要改只能有意替换基线文本，并在提交正文写明。`execution` 组基线**不含** `storage-execution.js:119` 那一行（逐项核对过），`sharedSyncSuite`（`storage-contract.test.js:224` 起）不在基线范围内。

### 栈的位置

本 PR 的 base 是 `main`；#70 的 PR 以后以本分支为 base，形成 2 层栈。本层合并时为真的事实只有：capabilities 导出了归一函数与入口断言，两个 Storage 强制规范载体。本层**不**声称 #70 已经调用归一函数。对上层的要求只以接口契约的形式写在 `Interfaces and Dependencies`。

## Design / Spec

### 规则（decision）

1. **唯一合法载体**是规范载体：`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$`，并且日历合法，即它必须是 `sourceVersionFromTimestamp` 的不动点。`undefined` 仍然是「没有版本」的唯一表达，空串不合法（沿用 base 语义）。计数器、ETag、sha、semver 都不是观察的定序载体；平台只有不透明版本（ETag 一类）或没有版本时，观察的 `sourceVersion` 填 `undefined`。
2. **定宽即正确**：规范载体全为 ASCII 且等长，码点序 = UTF-16 码元序 = UTF-8 字节序（SQLite BINARY）= 时间序。这就是 RFC 3339 §5.1「同一时区写法、同样小数位数时可以按字符串排序」的前提，由写入时的归一化来满足，而不是让比较器理解语义。
3. **纳秒、无损**：固定 9 位小数，右侧补零。超过 9 位小数抛错，不截断。截断会把两个不同版本变成「相等」，按 R4 ② 相等就是整快照替换，晚到的旧快照会顶掉新快照，重新引入 #203 这一类静默回退。
4. **归一责任在 provider**：只有 provider 知道平台字段是时间戳、计数器还是不透明串。capabilities 只提供规则（语法、归一函数、断言），先例是 `observation.ts:121`「dedupeKey 与 payloadHash 由契约函数计算，provider 不得自行发明另一套规则」。
5. **强制点只有一个函数**：`assertComparableSourceVersion` 由 `makeObservation`（生产端，未归一的 provider 在自己的契约测试里就会失败）和两个 Storage 的 `recordObservation`（存储端，防御不经 `makeObservation` 构造的观察）共同调用，删掉两个 Storage 里各自重复的三行检查与文案。
6. **比较器不变**：`compareSourceVersion` 的签名与实现不动，只改注释，写明定义域是规范载体加 `undefined`。它在任意串上仍是全函数（码点序），不会在存储事务中途抛错。
7. **DDL 不变**：`sync_observation`、`committed_observation` 与 `#committedVersion` 的 BINARY 排序在规范域上与比较器同判据。003 只改注释。

### 归一算法（`sourceVersionFromTimestamp`，精确规格）

```ts
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/
```

1. 不匹配就抛 `RangeError`。这一步覆盖：缺偏移、只有日期、空格分隔、`+0800`、超过 9 位小数、`9` / `10` / `v9` / `v10` / sha、空串、非 ASCII 数字（JS 的 `\d` 只匹配 ASCII 0–9）。小写 `t` / `z` 按 RFC 3339 §5.6 接受，输出统一大写。
2. 范围检查：时 00–23、分 00–59、秒 00–59（拒绝闰秒 `:60`，因为 Date 会把它进位成下一秒，与真实的下一秒碰撞）、偏移时 00–23、偏移分 00–59。
3. 日历检查：`const t = new Date(0); t.setUTCFullYear(y, mo - 1, d)`，回读 `getUTCFullYear()` / `getUTCMonth()` / `getUTCDate()` 必须与输入相等。这一步拒绝 `02-30`、`2100-02-29`、月 `00` / `13`、日 `00`。**不用** `Date.UTC`（它把 0–99 年映射到 1900 年代），**不用** `Date.parse`（无时区输入按本地时区解析）。
4. 应用偏移：`t.setUTCHours(h, mi - sign * (oh * 60 + om), s, 0)`，其中 `Z` 与 `-00:00` 的偏移为 0。
5. 结果年份必须在 0000–9999 内，否则抛 `RangeError`。
6. 输出：`YYYY-MM-DDTHH:MM:SS.` 加上小数部分 `padEnd(9, '0')` 再加 `Z`。全程只用 UTC 方法，结果与进程时区无关。

原型（约 20 行，不进仓库）在 Node v26.10.0 上实测：#203 的三组时间戳反例归一后按时间序，同一时刻不同精度归一后逐字相等；上面列出的每类非法输入都被拒绝；20 万个随机时刻加随机偏移与 `Date.prototype.toISOString` 的毫秒部分对照，不一致 0 次。`isComparableSourceVersion` 实现为「内部解析结果与输入逐字相等」。内部解析函数失败时返回 `undefined`，谓词不经过 try/catch；导出的归一函数在 `undefined` 时抛 `RangeError`。

### 错误文案（契约的一部分）

- 入口断言：`sourceVersion 必须是规范载体（定宽 ASCII 的 UTC 纳秒时间戳 YYYY-MM-DDTHH:MM:SS.fffffffffZ，由 sourceVersionFromTimestamp 归一）：<值>`。同时含「规范载体」与「ASCII」：现有 `/ASCII/` 断言（非 ASCII、空串，其中两条在断言基线里）不用改，新用例一律用 `/规范载体/`。
- 归一函数：抛 `RangeError`，文案说明「不是可归一的 RFC 3339 时间戳」，并附原值。测试按 `RangeError` 类型断言，不按文案。

### 被放弃的方案

- **载体感知比较器 + SQLite 序键列**：在 JS 里解析载体并计算保序序键，SQLite 新增 `version_key` 列并让视图与 `#committedVersion` 按它排序。JS 侧可以做对，但代价是：003 要加 `NOT NULL` 列和两条 CHECK；同一事实多出一份派生表示（`updated_at` 与 `version_key`），这是 `AGENTS.md` §2 警告的「第二个权威源」形态；R4 的「updated_at 更大者」措辞与实现脱节；集成测试的位置 INSERT、列集合断言与凭据审计表都要跟着改；回滚后用新 003 建的库在旧代码上无法写入。预计代码量约 360 行，并且还需要一份 ADR。本 issue 的反例没有一个真实使用者需要「原样存变精度载体」，收窄的代价更小。
- **在 SQL 里解析载体**：SQLite 的 `julianday` / `unixepoch` 只到毫秒精度，接受缺秒、空格分隔和 `02-30`，`CAST` 大整数会饱和。这等于维护第二份与 JS 分叉的文法。
- **注册 collation 或 SQL 函数**：`node:sqlite` 没有 collation API；用函数的话，视图脱离应用连接（其他 SQLite 客户端）就无法求值。
- **毫秒规范形态（等于 `toISOString`）**：可读性更好，但会把亚毫秒来源截断成相等版本，触发前面说的「相等即替换」回退（规则 3）。
- **归一失败返回 `undefined`**：`undefined` 是最小值，在已提交的有版本观察面前会被静默拒绝，丢数据的问题只是从 #203 挪到了上层。所以失败必须抛错，由 provider 映射成 `ProviderError`。
- **保留 20 位定宽计数器载体**：issue 把它列为可选，但目前没有真实使用者。加上它就要有跨种类比较规则（比较器抛错或规定种类排位）、更多用例和变异。MMP 前加载体没有兼容成本，真正出现计数器平台时再引入带标签的定宽形式。
- **重写比较器为 `<` 加域校验**：规范域上 `<` 与码点循环等价，但改写并不修复 #203，还会让比较器变成部分函数，在事务中途抛错；并且会让「只删一个 Storage 的入口断言」这类变异被比较器的二次校验部分掩盖，变异证据失真。
- **只改注释**：注释（`observation.ts:61-64`）早已写明 provider 的义务，但没有强制点。漏归一的 provider 仍会静默丢数据。
- **在 `makeObservation` 里自动猜测并归一**：需要靠启发式判断种类（`20260921` 是日期还是编号），等于第二套语义；它只校验、不改写。
- **在 storage 层改写载体**：`updated_at` 列会和 `snapshot_json` 里的 `observation.sourceVersion` 成为同一事实的两个家，违反 `observation.ts:77-80`「storage 不裁剪、不改写」。（范围注，R1，2026-09-30：本条指入口路径，即 storage 不替 provider 归一新观察，仍然成立。旧库行的一次性迁移 005 与显式修复只改 `updated_at`，它是按唯一规则从 `snapshot_json` 推导出的排序键；快照本身不改。见下文 R1 增补的 R1-3。）

### 定稿来源（三份独立设计的取舍）

- **主体取自设计 3（系统视角）**：比较器与 DDL 不动；单一载体；两个 Storage 共用入口断言；测试辅助函数把 `'v1'/'v2'/'v3'` 映射成规范字面量，使断言基线文本不变；执行组和 `sharedSync` 的悬空绑定用例改用规范字面量，避免「因错误原因通过」；base-src 回放；时区矩阵；对上层的 O / G 契约。
- **嫁接自设计 1（收窄载体）**：纳秒而不是毫秒；归一失败抛错而不是返回 `undefined`；谓词取「不动点」；用 `setUTCFullYear` 而不是 `Date.UTC`；capabilities 测试用 `import * as cap` 引用新名字，base 上不会整个文件加载失败；在已完成计划的原决策处标 Superseded；提交正文逐字写出被替换的基线行。
- **嫁接自设计 2（载体感知）**：更宽的拒绝清单（小写、闰年、`+24:00`、`-00:00`）；「SQL 原生解析不可用」的实测理由（写进被放弃的方案）。
- **三份设计中被本评审订正的事实**：`execution` 组断言基线不含 `storage-execution.js:119`（设计 3 称要改两条基线，实为一条）；`#217` 是 issue，没有 PR（三份设计中有两份核实过）；`tests/integration/execution-relation-write-schema.test.js` 的裸 SQL 插入是 DDL 层用例，DDL 不约束载体，无需改动（设计 1 与设计 2 计划改它）。

### 关键不变量

1. 定序判据只有 `compareSourceVersion` 一份；两个 Storage 与视图在规范域上与它同判据。
2. 入口断言只有 `assertComparableSourceVersion` 一份，文案只有一处。
3. 载体语法与归一规则只在 capabilities 有一份；provider 调用它，不自行发明规则。
4. 非规范载体永远不会进入账本：两个 Storage 都在任何写入之前断言。
5. 依赖方向不变：providers / storage → capabilities；capabilities 只依赖 domain 与 Node 内建。规划状态、看板 `Status` 与 LLM 都不在本路径上。

### 评审者会怎么打破它（预判与防线）

| # | 攻击 | 防线（用例或变异） |
|---|---|---|
| 1 | 无时区输入被当成本地时间 | 正则强制偏移；归一用例在 `UTC` / `Asia/Shanghai` / `America/Los_Angeles` 三个时区各跑一次；变异 M12 |
| 2 | `Date.UTC` 把 `0050` 年映射成 `1950` 年 | 用例 `0050-01-01T00:00:00Z` → `0050-…`；变异 M11 |
| 3 | 日历滚动（`02-30`、`2100-02-29`） | 往返检查；拒绝用例；变异 M4 |
| 4 | `24:00`、`:60`、`+24:00`、分钟 60 | 范围检查；拒绝用例；变异 M6 |
| 5 | 超过 9 位小数被截断成相等 | 正则 `{1,9}`；10 位小数的拒绝用例；变异 M5 |
| 6 | 小数补齐方向写错（`.5` → `.000000005`） | C1 的精确输出断言与 C3 的 `.49Z` → `.5Z` 一对（`.5Z` → `.51Z` 在补齐方向写反时仍然有序，不能单独承担这一条）；变异 M3 |
| 7 | 偏移符号写反，或跨年、跨出 0000–9999 | `+08:00` 与 `-01:00` 跨年用例；两个方向年份越界的拒绝用例；变异 M2、M7 |
| 8 | 形状对但日历非法的规范串被谓词接受 | `isComparableSourceVersion('2026-02-30T00:00:00.000000000Z') === false` |
| 9 | 小写 `t` / `z` 的「规范样」串被当作载体 | 谓词取不动点，归一输出为大写，因此返回 false，有用例 |
| 10 | 构造观察时绕过 `makeObservation` | 两个 Storage 各自断言；变异 M8 / M9 各自只让对应实现变红 |
| 11 | 被拒绝的写入留下了行 | 拒绝之后同一主体写同一秒的规范观察必须返回 `true`（残留的 `…54Z` 或 `v9` 行会让它返回 false） |
| 12 | 悬空绑定用例因载体而不是外键被拒，「因错误原因通过」 | 夹具默认值与 `storage-execution.js:119` 改成规范字面量；变异 M13 证明 fake 的悬空绑定用例由绑定检查判红 |
| 13 | 断言基线被悄悄放宽 | 只替换一条（`'v1'` 从接受翻成拒绝，属于收紧）；提交正文写明；`Validation and Acceptance` #6 的差集脚本 |
| 14 | 变异没有真正生效 | 每条变异先断言替换次数为 1 并打印 `git diff --stat`；还原用 `git checkout HEAD -- <file>` 再跑 `git diff --quiet` |
| 15 | 存储定序用例在 base 上本来就绿 | 新的存储定序用例经 `cap.sourceVersionFromTimestamp` 归一原始反例，base 上因函数缺失而红；规范字面量的既有定序用例如实标为「钉住型」 |
| 16 | 栈底写了上层事实 | 本计划、注释与 PR 描述只写 O / G 契约，不写「#70 已调用」；`Validation and Acceptance` #9 |
| 17 | 比较器被改成 JS `<`，重新引入 UTF-16 码元陷阱 | 比较器不改；既有 U+FF5E / U+1F600 码点断言保留 |

### 评审响应 R1 增补：旧库里的非规范载体（评审 5352511875）

**问题**（复现与证据见 `Surprises & Discoveries` 的 R1 条目）：本层只在入口收窄了载体，已经持久化的旧载体原样留在 `sync_observation.updated_at`。迁移运行器只按版本号判定是否已应用，所以旧库重开时 `migrate()` 什么也不做；构造函数也不看数据。`#committedVersion` 读回旧值后，按码点序把更新的规范观察判成乱序，静默返回 `false`。受影响的不只是评审给出的 `v9`：`…54Z`、`+08:00` 这类能无损归一的旧值同样会让新事实被丢弃。缺陷的根子是「已有行的版本列在定义域内」这条不变量没有拥有者。

**规则（decision，见 D13）**

- **R1-1 拥有者是迁移运行器**：新增版本化的纯数据迁移 005，不含 DDL。`schema_migrations` 里的 5 就是载体世代标记。它只执行一次；已迁移的库被清单只到 4 的二进制以现有前缀断言拒绝（「数据库已应用版本与迁移清单不一致」），降级写入因此在结构上被挡住。不另建 `schema_generation` 表，那是 #223 的机制。
- **R1-2 分类规则只有一份**，复用 capabilities。对 `sync_observation` 里每个 distinct `updated_at` 值 v：`''` 与 `isComparableSourceVersion(v)` 为真的值保留；`sourceVersionFromTimestamp(v)` 成功的值**可归一**，目标取返回值；抛 `RangeError` 的值**不可定序**，包括 `v9` / `v10`、sha、计数器、无偏移时间戳、超过 9 位小数、闰秒、非 ASCII。不在 SQL 里归一，理由见前文被放弃的方案「在 SQL 里解析载体」。
- **R1-3 能无损迁移就迁移**：可归一的值在 005 的事务内原地改写为规范载体，按 distinct 值执行 `UPDATE sync_observation SET updated_at = ? WHERE updated_at = ?`。`updated_at` 不在任何键里（主键是 `(binding_id, object_kind, object_external_id, observed_at, dedupe_key)`，唯一索引是 `(binding_id, dedupe_key)`），原地改写不会冲突；`observationDedupeKey` 不含 `sourceVersion`，去重不受影响。`snapshot_json` 不改：它是端口收到的原样记录，保留原始载体作审计证据。R1 之后，端口写入的每一行满足 `updated_at === 规范化(snapshot.observation.sourceVersion)`：`undefined` 与不可定序值（只有显式修复会产生后者，见 R1-5）记为 `''`，其余取 `sourceVersionFromTimestamp` 的结果。`updated_at` 因此是按唯一规则从快照推导出的排序键，不是第二个权威源。
- **R1-4 无法无损迁移就整库拒绝，且零改动**：迁移运行器在应用**任何**待应用迁移之前，对所有带数据步骤的待应用条目做只读预检。发现不可定序值就抛 `LegacySourceVersionError`，句柄由 `createSqliteStorage` 已有的 catch 关闭。库文件逐字节不变，更早的待应用迁移（例如 [1,2,3] 库上的 004）也不执行。预检只是提前拒绝，权威判定在 005 的 `BEGIN IMMEDIATE` 之内：数据步骤重新分类，发现不可定序值就抛同一个错误并回滚，版本 5 不记账。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。
- **R1-5 保留数据的恢复路径是显式修复函数** `repairLegacySourceVersions(location, { backupPath })`。它由人调用，不会自动触发。先用 `VACUUM INTO` 备份（目标已存在即拒绝，绝不覆盖）并核对备份：`PRAGMA integrity_check` 为 `ok`，每张表的行数与原库相等。核对通过后，在一个事务里把全部非规范载体收进定义域：可归一的归一，不可定序的**降为无版本**（`updated_at = ''`）。行、去重历史和其他表都留在活库里，原始载体仍在 `snapshot_json` 与备份里；函数返回被降级的行清单，供操作者对这些绑定触发全量对账。降为无版本与本层规则 1「平台只有不透明版本时填 `undefined`」一致，之后任何规范观察都会胜过这些行，评审的反例因此在修复后返回 `true`。这个变换丢掉了被降级行之间的相对次序，定序上是有损的，所以只在人明确调用、并且备份已核对之后发生，不在打开时自动发生。
- **R1-6 旧形状 003 的检查随预检前移**：表缺 `object_kind` 或 `dedupe_key` 时，005 的预检与数据步骤都抛现有的 `REWRITTEN_003_MESSAGE`，保证 005 绝不改写一张随后会被拒绝的旧形状表。判定函数与文案移到新模块；构造函数继续调用同一个函数作防御，已迁移到 5 之后又被改回旧形状的库仍由它拒绝，现有用例 `tests/integration/storage-sync-surface.test.js`「003 重写后的库自检…」不变。附带效果：[1,2,3] 的旧形状库也在 004 之前被拒绝、库不变。main 上是先应用 004 再拒绝，见 R1 的 Surprises。文案不改（H9）。
- **R1-7 评审锚点行加守卫**：`recordObservation` 读到已提交版本后，若它非空且不是规范载体，抛 `LEGACY_COMMITTED_VERSION_MESSAGE`，不再静默返回 `false`。它只在 005 之后仍有旧载体进入账本时触发，例如迁移之前就已打开库的旧版本进程继续写入，或者裸 SQL 写入。它把静默丢弃变成响亮失败，处置指向修复函数。规则 6（比较器是全函数）不变：守卫是显式断言，在任何写入之前抛出，core 的同步事务整笔回滚，与入口断言走同一路径。内存替身没有跨版本持久化，入口已经断言，已提交值不可能非规范，所以不加守卫，G3 不受影响。

**精确规格**（文件所有权见 `Global Constraints` 的 R1）

- `packages/storage/sqlite/src/migrations.ts`：

  ```ts
  export interface MigrationDataStep { preflight(db: WorkspaceDatabase): void; apply(db: WorkspaceDatabase): void }
  export interface Migration { readonly version: number; readonly file: string; readonly data?: MigrationDataStep }
  // 清单追加：{ version: 5, file: '005_source_version_carrier.sql', data: SOURCE_VERSION_CARRIER_STEP }
  ```

- `packages/storage/sqlite/migrations/005_source_version_carrier.sql`：只有注释，写明它是 #203 的载体世代步骤、工作由数据步骤完成、不改 DDL、判据在哪个文件、`schema_migrations` 的 5 是世代标记。`node:sqlite` 的 `exec` 接受只含注释的 SQL（已实测），清单自检「每个版本都有文件」因此不用改。
- `packages/storage/sqlite/src/migrate.ts`：在 `assertAppliedIsManifestPrefix(observed, entries)` 之后、应用循环之前，对不在 `settled` 里且带 `data` 的条目依次调用 `entry.data.preflight(db)`，只读、不开事务。`applyIfMissing` 在 `db.exec(sql)` 之后、`INSERT INTO schema_migrations` 之前调用 `entry.data?.apply(db)`，与迁移体同在一个 `BEGIN IMMEDIATE` 内，抛错走现有的 `rollbackQuietly`。文件头注释补一句：数据步骤与版本记录同生共死，预检早于任何迁移。
- 新文件 `packages/storage/sqlite/src/source-version-carrier.ts`，只依赖 capabilities 的 `isComparableSourceVersion` / `sourceVersionFromTimestamp`、`node:fs`、`node:sqlite`（以只读方式打开备份做核对）与 `./db.ts`：
  - `REWRITTEN_003_MESSAGE`（从 `storage-sync.ts:60` 原样移来）与 `assertRewritten003Shape(db)`：`sync_observation` 存在且缺两列之一时抛错，表不存在时不判定。构造函数原先的条件（`schema_migrations` 含 3 且列不全）改为调用它，行为不变。
  - `classifyCarriers(db)`：表不存在时返回空结果；否则先 `assertRewritten003Shape`，再执行 `SELECT updated_at, count(*) FROM sync_observation GROUP BY updated_at`，按 R1-2 分类，返回 `{ normalizable: Map<原值, 规范值>, unorderable: { value, rows }[] }`。
  - `rewriteCarriers(db, policy: 'reject' | 'demote')`：重新分类。`reject` 下有不可定序值即抛 `LegacySourceVersionError`；否则逐个 distinct 值执行 `UPDATE`，可归一值改为规范值，`demote` 下不可定序值改为 `''`。事务由调用方负责。
  - `SOURCE_VERSION_CARRIER_STEP = { preflight: 有不可定序值即抛, apply: (db) => rewriteCarriers(db, 'reject') }`。
  - `class LegacySourceVersionError extends Error`。字段显式赋值，因为 Node 以 strip-only 模式执行 TS，不支持构造函数参数属性：`code = 'legacy_source_version'`；`unorderableRows: number`；`samples: readonly { bindingId, objectKind, externalId, updatedAt }[]`，最多 5 条，不带 `snapshot_json`，避免把 payload 带进错误文本。`message` 是中文，包含「库未被修改」、「本修复之前的版本仍可打开它」和恢复步骤：停掉打开该库的进程，调用 `repairLegacySourceVersions(<库文件>, { backupPath })`，然后重新打开。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。
  - `repairLegacySourceVersions(location: string, options: { readonly backupPath: string }): LegacyRepairResult`，其中 `LegacyRepairResult = { backupPath: string | undefined; normalized: number; demoted: readonly { bindingId; objectKind; externalId; dedupeKey; updatedAt }[] }`。步骤依次是：
    1. 拒绝 `':memory:'`。
    2. `openDatabase(location)`，不跑 `migrate`，在 `finally` 里关闭。
    3. `classifyCarriers`；没有非规范值时直接返回 `{ backupPath: undefined, normalized: 0, demoted: [] }`，不备份，因此幂等。
    4. `existsSync(backupPath)` 为真即抛错。
    5. `db.prepare('VACUUM INTO ?').run(backupPath)`：路径走参数绑定，不拼进 SQL。
    6. 以只读方式打开备份，核对 `integrity_check = ok` 与每张表行数相等；不等即抛错，此时原库还没被动过。
    7. `BEGIN IMMEDIATE`，先读出将被降级的行，再 `rewriteCarriers(db, 'demote')`，然后 `COMMIT`；失败则 `ROLLBACK`。
    8. 返回结果。`normalized` 是被归一的行数，`demoted` 是被降为无版本的行。
    它不要求版本 5 未应用：守卫（R1-7）触发时也用它恢复。
    订正（验收，D18）：`VACUUM INTO` 不能在事务里执行，所以备份仍在第 7 步之前；第 6 步的核对挪进第 7 步的 `BEGIN IMMEDIATE` 之内，核对失败即回滚，原库不变。另在第 2 步之前拒绝不存在的库文件，否则 `openDatabase` 会建一个空库。
- `packages/storage/sqlite/src/storage-sync.ts`：
  - `REWRITTEN_003_MESSAGE` 与判定改从新模块导入。构造函数「自检失败即关句柄」的做法不变。
  - 新增导出常量 `LEGACY_COMMITTED_VERSION_MESSAGE`。它是约定整串，含「已提交版本不是规范载体」与 `repairLegacySourceVersions`。
  - `recordObservation` 在 `const committed = …`（`:219`）之后加 R1-7 的守卫。
  - 文件头与方法注释各补一句。
- `packages/storage/sqlite/src/storage.ts`：
  - 把 `LEGACY_COMMITTED_VERSION_MESSAGE` 加进 `:13` 的消息再导出行。
  - `createSqliteStorage` 的注释写明：迁移失败（含 `LegacySourceVersionError`）时关句柄并原样抛出。函数体不变。
- `packages/storage/sqlite/src/index.ts`：`export { LegacySourceVersionError, repairLegacySourceVersions, type LegacyRepairResult } from './source-version-carrier.ts'`。显式列名，不让 `REWRITTEN_003_MESSAGE` 与内部分类函数成为包的公开面。

**语义后果**（写进 PR 描述与线程回复）

- 原来被码点序错判的主体，005 之后的已提交快照改为时间上真正最新的那一行。例：main 在 `…07:11:55Z` 之后又接受了 `15:11:54+08:00`，已提交快照选的是更早的时刻。这是纠正，没有删行。
- 归一后，同一时刻的不同写法（`…54Z` 与 `…54.000Z`）是同一版本，按 R4 ② 由 `observed_at` 决胜；之后同一时刻的规范观察按「同版本整快照替换」返回 `true`。
- main 当年已经返回 `false` 的观察从未入账，迁移找不回，只能等 provider 下一次全量对账（TD10）。
- 修复函数降级的行之间不再有相对次序；返回的清单让操作者对这些绑定触发全量对账。

**被放弃的方案（R1）**

- **只拒绝、不迁移（设计 2）**：连 `…54Z`、`+08:00` 这类能无损归一的库也拒绝，违背评审的第一条出路（能迁移就迁移）。它给的理由是「逐值无损不等于定序无损」，但这个理由不成立：丢掉的是错误的码点序（`+08:00` 一例里 main 选了更早的时刻），归一保留的正是载体本来表达的时间序。它的恢复路径是新建空库再对账；执行上下文与运行、关系、写尝试、工作区修订号这些本地独有的事实只留在备份里，回不到产品中，实质上仍是「删库重建加一份备份」，而评审已经说明这满足不了本地数据安全。它每次打开都全表扫描，也没有世代标记，旧二进制还能继续往已被接受的库里写旧载体。
- **打开时把不可定序值自动降为无版本（设计 3）**：原值还在 `snapshot_json` 里，所以可逆，但定序是有损的。它没有备份、也没有经过任何人，就改变了已提交快照的选择，例如 main 选中的 `v10` 行会输给一条规范行。评审明确要求「无法无损迁移时明确拒绝」，所以这个变换只放进由人调用、先备份的修复函数里。
- **修复时删除不可定序行（设计 1 的原方案）**：活库会丢掉这些观察的行与去重历史，只剩备份里有。降为无版本同样让新观察胜出，而行留在活库里，更符合「保留数据」。待人类确认（H7）。
- **预检放在 `createSqliteStorage`、不加迁移（设计 2）**：没有世代标记，只能每次打开都扫全表，也拦不住降级二进制的写入。设计 2 担心放进 `migrate()` 会误伤 `tests/integration/execution-relation-write-schema.test.js` 的裸 SQL 用例，这个担心不成立：那些用例先迁移到最新版本再插入非规范值，而数据步骤只对**待应用**的版本运行。
- **给 `updated_at` 加 CHECK 约束**：要重建 `sync_observation` 并重新声明视图，视图就会出现第二份定义；还要改 `execution-relation-write-schema` 的裸插入，回滚时也要再重建一次表。归 #223 的基线（TD9 / H10）。
- **在 CI 里用 `git archive origin/main` 跑旧代码，或提交二进制夹具**：CI 是浅克隆，而且合并后 `origin/main` 就等于本 head，用例会无声失效；二进制夹具不透明，不利于审阅和发布面扫描。改用「main 等价写入器」，并用一次性的真 main 对照证明两者逐列相等（`Plan of Work` R1 步骤 7）。
- **只在 PR 描述里建议删库**：评审已明确否定。

**关键不变量（R1 追加，接前文 1–5）**

6. 业务写入之前，账本里每一行的 `updated_at` 都属于 `{''} ∪ 规范载体`：旧库要么被 005 迁移进来，要么在任何迁移之前被整库拒绝且零改动；005 之后仍混进来的旧载体由 R1-7 的守卫响亮拒绝。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。
7. 载体分类规则只有一份（capabilities 的归一函数加 `classifyCarriers`），由 005 的预检、005 的数据步骤与修复函数共用。
8. 任何改写旧行的路径都有版本记账或备份：005 的改写与版本 5 同生共死；修复函数先备份并核对，再改写。

**评审者会怎么打破它（R1，接前文 1–17）**

| # | 攻击 | 防线（用例或变异） |
|---|---|---|
| 18 | 旧库在本版本重开后，新事实仍被静默丢弃 | U1 拒绝；U3 / U4 归一后写入返回 `true`；变异 R-M1、R-M5 |
| 19 | 拒绝之前库已被改动（先应用了更早的待应用迁移，或留下日志文件） | U1 / U2 / U10 的文件 sha256、目录列表与 `schema_migrations`；变异 R-M2、R-M10 |
| 20 | 预检与数据步骤之间有并发写入 | 数据步骤在事务内重新分类（U6）；变异 R-M3 |
| 21 | 旧二进制在迁移后继续写旧载体 | 前缀断言拒绝打开（U7）；已打开的旧进程写入后由守卫响亮拒绝（U8）；变异 R-M7 |
| 22 | 恢复路径丢数据或覆盖已有文件 | U9：备份路径已存在时被拒且原库不变；备份核对；只有非规范行的 `updated_at` 变化，行数与其他表不变；逆向 SQL 逐行还原。变异 R-M8、R-M9 |
| 23 | 拒绝时句柄泄漏 | U1 连续 5 次打开，fd 数不变；变异 R-M6 |
| 24 | 回归用例里的「旧库」与真 main 写出来的不一样 | 一次性真 main 对照：同一组输入分别由真 main 端口与等价写入器写库，`sync_observation` 逐列相等（`Plan of Work` R1 步骤 7） |

### R2 · 并发拒绝的阶段与恢复事实

review `5360351140` 复现：旧库版本 [1,2,3] 的只读预检通过后，旧写者插入 `v9`，004 提交、005 事务内复判拒绝；原错误仍称库未修改。保留迁移运行器每条迁移一个事务的机制，修复错误结果面，不增加整个升级的原子承诺。

`LegacySourceVersionError` 新增 `phase: 'preflight' | 'migration'` 与 `appliedVersions: readonly number[]`。预检错误继续说明库未被本次迁移修改；数据步骤错误说明迁移运行器只回滚当前条目、先前已提交迁移不会撤销，版本从同一个数据库读取。恢复仍先停进程、备份并修复，再由当前版本程序重新打开；事务内错误不再承诺旧二进制可打开或整库逐字节不变。

U11 从版本 [1,2,3] 的真实文件库开始，在完整 `migrate` 的首个 `BEGIN IMMEDIATE` 前用第二连接插入旧编码，再运行真实迁移。旧实现按阶段/版本断言红；修复后 `phase=migration`、已提交版本 [1,2,3,4]、005 未记账、迟到观察完整保留。U1 同时钉住 `phase=preflight` 与原文件零变化。执行：`node --test tests/integration/storage-source-version-upgrade.test.js tests/integration/migration-runner.test.js`，期望 15/15；`pnpm run typecheck` 期望退出 0。

## Global Constraints

R2 收尾的文档范围增加 `docs/architecture/release-gates.md` 与 `docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md`：#239 已先合并，关闭 #203 必须在本 PR 更新其证据映射。归档目标为本文件，索引与四条历史取代引用随之更新。R2 的判别性测试与错误元数据是本轮必需修复，代码会略超先前 800 行的弹性规划值；仍须满足 1000 行硬门禁，不通过删减有效断言凑数。

本计划改动的文件集合只在这里声明一次，按任务所有者分组；同一文件只有一个所有者。

**T1 · capabilities 契约（Sonnet，工作树 `.worktrees/source-version-order-cap`）**

- `packages/capabilities/src/observation.ts`：新增 `sourceVersionFromTimestamp`、`assertComparableSourceVersion`；`isComparableSourceVersion` 改为不动点判定；删除 `ASCII_SOURCE_VERSION`；`makeObservation` 调用断言；重写定序约定注释（`:60-75`）与比较器注释（`:103-106`）。
- `packages/capabilities/src/storage.ts`：只改 `recordObservation` 段注释（`:171-176`）。
- `tests/contract/capabilities-observation.test.js`

**T2 · 两个 Storage 与契约套件（Sonnet，工作树 `.worktrees/source-version-order-storage`）**

- `packages/providers/fake/src/storage.ts`：只改 `recordObservation` 入口的三行（`:281-283`）。
- `packages/storage/sqlite/src/storage-sync.ts`：改 import、入口三行（`:215-217`）、文件头注释（`:24-25`）与方法注释（`:206-211`）。
- `packages/storage/sqlite/migrations/003_control_facts.sql`：只改注释（`:76-79`、`:98`），DDL 与视图不变，保留「updated_at 更小者拒绝」「相等时整快照替换」两段文字。
- `tests/contract/suites/storage-sync.js`
- `tests/contract/suites/storage-fixtures.js`：只改观察夹具的默认 `sourceVersion`。
- `tests/contract/suites/storage-execution.js`：只改 `:119` 的 `'v1'`。
- `tests/contract/suites/storage.js`：只改 `ADDED_CASE_COUNT` 与它的来处注释。
- `tests/contract/storage-contract.test.js`：`CASE_LEDGER.sync.added`、`ASSERTION_BASELINE.sync` 的一条、`DUPLICATE_OBSERVATION` 与 `sharedSyncSuite` 里的版本字面量。
- `tests/integration/storage-sync-surface.test.js`：`V1`–`V3` 常量与 `:160` 直写行的 `updated_at` 字面量。

**T3 · 对抗验证（Sonnet，工作树 `.worktrees/source-version-order-verify`）**：不持久写入任何文件。变异只在自己的工作树内临时应用并还原，结果交给 T4。

**T4 · 验收、重构、证据与 PR（Opus，工作树 `.worktrees/source-version-order`）**

- `docs/exec-plan/completed/2026-09-29-source-version-order.md`（本计划）
- `docs/README.md`（Active 索引一行，定稿时已写入）
- `docs/exec-plan/completed/2026-09-23-storage-control-facts.md`：只在 `:151` 的决策后原处追加 Superseded 标注，原文保留。
- 验收重构若需要改 T1 / T2 的文件，所有权在集成后转给 T4，并写进 `Progress`。

**R1 · 评审响应（评审 5352511875；按 D0 的顺序：开发 → 对抗验证 → 验收）**

- **R1-D 实现与测试**（单一 owner；工作树 `.worktrees/source-version-order-r1`，分支 `fix/source-version-order-r1`，从本计划的 R1 规划提交创建，只在本地。订正：实际按编排指令没有建这个工作树，开发直接在 `.worktrees/source-version-order` 上做本地 WIP 提交，见 `Progress`）。`storage-sync.ts` 的所有权从 T2 转给 R1-D。
  - `packages/storage/sqlite/src/source-version-carrier.ts`（新建）
  - `packages/storage/sqlite/migrations/005_source_version_carrier.sql`（新建，只有注释）
  - `packages/storage/sqlite/src/migrations.ts`
  - `packages/storage/sqlite/src/migrate.ts`
  - `packages/storage/sqlite/src/storage-sync.ts`
  - `packages/storage/sqlite/src/storage.ts`（只改 `:13` 的消息再导出行与 `createSqliteStorage` 的注释）
  - `packages/storage/sqlite/src/index.ts`（只加一行显式导出）
  - `tests/integration/storage-source-version-upgrade.test.js`（新建）
- **R1-V 对抗验证**（分离工作树 `.worktrees/source-version-order-r1-verify`，不持久写入任何仓库文件）：base-src 回放、R-M 变异表、既有 M1–M14 整表重测，以及真 main 跨版本带外证据（在仓库外的临时目录里做）。
- **R1-A 验收、证据与 PR**（工作树 `.worktrees/source-version-order`）：本计划。
- **R1 明确不改**：
  - `packages/storage/sqlite/migrations/001`–`004`，包括 003 的注释。D8 的出处 token 用例逐行扫描 003，不值得为一句指针冒险。
  - `packages/capabilities/**`。
  - `packages/providers/fake/**`：替身上的已提交值不可能非规范。
  - 全部既有测试文件：R1 之后它们必须不改即绿；如果需要改，先记进 `Surprises & Discoveries` 再决定。
  - `docs/README.md`。

**明确不改**：`packages/capabilities/src/index.ts`（`observation.ts` 已整体再导出）；`packages/core/**`；`packages/providers/fake/src/development.ts`（#198）；`tests/integration/execution-relation-write-schema.test.js`（DDL 层裸 SQL，DDL 不约束载体）；任何迁移的 DDL 语句（R1 新增的 005 只有注释，不含 DDL）。

**其他硬约束**

- 规模：代码 ≤ 800 行、文档 ≤ 1300 行（增删之和，排除锁文件与生成目录）；预计代码约 260 行、文档约 520 行（本计划约 480 行，执行期回填证据约 40 行）。
  - 两层上限的用途不同：800 / 1300 是规划弹性上限，给评审和后续优化留余量；1000 / 1500 是 CI 硬上限（`node scripts/rule-checks.mjs size`）。
  - R1 前的实测为代码 301、文档 535（2026-09-30 @ `b0218f1`，回读 `node scripts/rule-checks.mjs size origin/main`）。
  - R1 预计代码再加约 420 行（产品约 180、测试约 240），累计约 720。文档：本次规划提交后实测为 960（2026-09-30 @ 本计划的 R1 规划提交，回读 `node scripts/rule-checks.mjs size origin/main`），证据再加约 50 行，累计约 1010，仍在 1300 以内。
  - 实现后若代码超过 800，先停下向人类伙伴报告，不推送；超过 1000 时 CI 必红。压缩顺序：先合并测试辅助函数，再合并钉住型用例 U5 / U7；U1–U4、U6、U8–U10 不删。
  - R1 实测（2026-09-30）：开发提交为代码 888；验收按上面的压缩顺序处理后为代码 800 / 1000（回读 `node scripts/rule-checks.mjs size origin/main`），见 `Surprises & Discoveries`。
- 依赖方向 providers / storage → capabilities → core → …；capabilities 不新增依赖（只用 Node 内建与 domain）；Provider 之间不互调。
- MMP 前不做兼容层与迁移：已有开发库里若有非规范的 `updated_at`，处置是删库重建（见 `Idempotence and Recovery`）。**Superseded by `Design / Spec` 的 R1 增补与 `Decision Log` D13（2026-09-30）**：评审 5352511875 明确指出删库不能满足本地数据安全。旧库改由迁移 005 归一，或整库零改动拒绝，并提供先备份的修复函数。
- 不写看板 `Status`；LLM 不进入规划状态、关系语义或门禁控制路径。
- 行为变更先有在 base 上失败、在 head 上通过的判别性测试；变异必须先证明已生效。
- 新测试只用 `node:test` 与 `node:assert/strict`，不引入第三方依赖。
- 提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #203`。关闭关键字只写在 PR 描述里（进 `main` 的提交正文里的关闭关键字也会关 issue）。
- 文档正文中文；标识符、路径、命令英文；不写本机绝对路径、凭据、内部系统。
- 最终提交序列必须每个提交单独为绿。T1 单独会让存储套件变红（夹具仍是 `'v1'`），所以 T1 与 T2 在集成时合成**一个** `fix(capabilities)` 提交。

## Plan of Work

### Batch 0 · 计划定稿与 draft PR

**最小闭环**：本计划与索引进入分支，draft PR 关联 issue。
**涉及文件**：本计划、`docs/README.md`。

- [ ] 在检出 `fix/source-version-order` 的工作树根目录（`.worktrees/source-version-order`）运行 `git rev-parse --git-dir --git-common-dir`、`git status --short --branch`、`git worktree list --porcelain`、`git check-ignore -v .worktrees/`。期望：分支为 `fix/source-version-order...origin/main`，工作区只含本计划与索引的改动。
- [ ] `pnpm install --frozen-lockfile`（工作树当前没有 `node_modules`）。
- [ ] 在 `origin/main` 上回读基线：`node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js`，记录 `ℹ tests` 与 `ℹ fail 0`，写进 `Progress` 并注明检出与 head。
- [ ] 提交 `docs(exec-plan): 定稿观察版本载体收窄计划`，正文说明栈底定位与 #70 的关系，末尾 `Refs #203`。
- [ ] 推送并开 draft PR（base `main`）。标题 `fix(capabilities): 把观察版本载体收窄为定宽 UTC 纳秒时间戳并在入口强制`；标签 `kind:fix`、`area:capabilities`、`area:storage`；描述里写关闭关键字关联 #203，并写 `Refs #70 #198 #217`。

**验证**：

| 命令（在检出 `fix/source-version-order` 的工作树根目录运行） | 期望 |
|---|---|
| `git diff --check origin/main...HEAD` | 无输出 |
| `node scripts/rule-checks.mjs disclosure origin/main` | 无命中 |
| `grep -nE '/Us[e]rs/\|/pr[i]vate/\|T[B]D\|T[O]DO\|稍后补[充]' docs/exec-plan/completed/2026-09-29-source-version-order.md`（字符类让这一行不匹配它自己） | 无输出 |
| `node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/e1-evidence-consistency.test.js` | `ℹ fail 0` |
| `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences,isDraft,baseRefName,labels` | `closingIssuesReferences` 含 203；`isDraft` 为 true；`baseRefName` 为 `main` |

**回滚**：`git revert` 本提交；draft PR 关闭由人类伙伴决定。

### Batch 1 · capabilities 契约（T1，先红后绿）

**最小闭环**：归一函数、谓词、入口断言与 `makeObservation` 强制在 capabilities 单元内闭环，边界用例先红后绿。
**涉及文件**：见 `Global Constraints` 的 T1。

- [ ] 从 Batch 0 的提交建工作树：`git worktree add .worktrees/source-version-order-cap -b fix/source-version-order-cap fix/source-version-order`，然后 `pnpm install --frozen-lockfile`。
- [ ] **先写测试**（`tests/contract/capabilities-observation.test.js`）。新增 `import * as cap from '@harness-projects/capabilities'`，新名字一律经 `cap.` 引用；既有具名导入不变。
  - 夹具 `input()` 的 `sourceVersion` 从 `'v1'` 改为 `'2026-09-20T10:00:00.000000000Z'`。
  - 改写既有用例「比较器边界…」：比较器的码点断言（`:55-65`）保留；`isComparableSourceVersion('2026-09-21T07:11:54Z')` 与 `('~')` 翻成 `false`；新增 `isComparableSourceVersion('2026-09-21T07:11:54.000000000Z') === true`、`('2026-02-30T00:00:00.000000000Z') === false`、`('2026-09-21t07:11:54.000000000z') === false`。用例名改为「比较器边界：码点序、undefined 最小；合法载体只有规范 UTC 纳秒时间戳」。
  - C1「sourceVersionFromTimestamp 把 RFC 3339 无损归一成定宽 UTC 纳秒形态」：精确输出 `…54Z`→`…54.000000000Z`；`…54.5Z` 与 `…54.500Z` 都→`…54.500000000Z`；`…54.51Z`→`…54.510000000Z`；`…54.123456789Z` 原样；`2026-09-21T15:11:54+08:00`→`2026-09-21T07:11:54.000000000Z`；`-00:00` 按 UTC；小写 `t` / `z`→大写；`0050-01-01T00:00:00Z`→`0050-01-01T00:00:00.000000000Z`；`2026-12-31T23:30:00-01:00`→`2027-01-01T00:30:00.000000000Z`；输出满足规范正则且对自身是不动点。
  - C2「无法无损归一的输入一律抛 RangeError」：`2026-09-21T07:11:54`、`2026-09-21`、`2026-09-21 07:11:54Z`、`2026-09-21T07:11:54+0800`、`2026-02-30T00:00:00Z`、`2100-02-29T00:00:00Z`、`2026-13-01T00:00:00Z`、`2026-09-00T00:00:00Z`、`2026-09-21T24:00:00Z`、`2016-12-31T23:59:60Z`、`2026-09-21T07:60:00Z`、`2026-09-21T07:11:54+24:00`、`2026-09-21T07:11:54.1234567891Z`、`0000-01-01T00:30:00+01:00`、`9999-12-31T23:59:59-01:00`、`9`、`10`、`v9`、`v10`、40 位十六进制 sha、空串、全角数字串。正例 `2024-02-29T00:00:00Z` 与 `2000-02-29T12:00:00Z` 不抛。
  - C3「#203 的反例经归一后码点序即时间序（比较器不变）」：三组时间戳反例 `(…54Z, …54.500Z)`、`(.5Z, .51Z)`、`(15:11:54+08:00, 08:00:00Z)` 归一后 `compareSourceVersion(old, new) === -1`；另加 `(…54.49Z, …54.5Z)` 一对，钉住右侧补零的方向；同一时刻不同精度（`…54Z` 与 `…54.000Z`、`+08:00` 与对应的 `Z`）归一后比较为 0；原始串的比较保留为对照，`compareSourceVersion('…54.500Z', '…54Z') === -1`，说明为什么必须先归一；`9` / `10` / `v9` / `v10` 的 `isComparableSourceVersion` 为 false。
  - C5「归一与进程时区无关」（验收批次追加，见 `Decision Log` D12）：在进程内依次把 `process.env.TZ` 设为 `UTC`、`Asia/Shanghai`、`America/Los_Angeles`，对 `+08:00`、跨年 `-01:00`、洛杉矶夏令时空档 `2026-03-08T02:30:00Z`、`0050` 年逐字断言输出，并断言 `9999-12-31T23:59:59-01:00` 抛错；结束时还原 `TZ`。C2 同时追加偏移分钟越界 `+08:60`。
  - C4「makeObservation 与入口断言拒绝非规范 sourceVersion」：`makeObservation(input({ sourceVersion: '2026-09-21T07:11:54Z' }))` 与 `'v1'` 都 `assert.throws(/规范载体/)`；`undefined` 与规范载体正常返回，`sourceVersion` 原样保留，`dedupeKey` 与未设版本时相同；`cap.assertComparableSourceVersion(undefined)` 不抛；对 `'～'` 抛出的文案同时匹配 `/规范载体/` 与 `/ASCII/`。
- [ ] 在产品代码仍为 base 时运行 `node --test tests/contract/capabilities-observation.test.js`，记录失败用例名。期望恰好 5 条失败：改写的「比较器边界…」、C1、C2、C3、C4；其余 3 条通过。
- [ ] 按 `Design / Spec` 实现 `observation.ts`。
- [ ] 本地提交（WIP 也要提交，防止会话中断丢失工作），提交信息 `fix(capabilities): 收窄观察版本载体并提供归一函数`，末尾 `Refs #203`。它会在 Batch 4 与 T2 合并成一个提交。

**验证**（在检出 `fix/source-version-order-cap` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `node --test tests/contract/capabilities-observation.test.js` | `ℹ tests 8`、`ℹ fail 0`（T1 时刻；验收批次追加 C5 后为 `ℹ tests 9`） |
| `for tz in UTC Asia/Shanghai America/Los_Angeles; do TZ=$tz node --test tests/contract/capabilities-observation.test.js \|\| exit 1; done` | 三次都 `ℹ fail 0` |
| `pnpm run typecheck` | exit 0 |
| `pnpm run boundaries` | `ℹ fail 0` |
| `node --test tests/contract/storage-contract.test.js` | **预期红**（夹具仍是 `'v1'`，归 T2），不在本批修 |

**回滚**：丢弃工作树分支 `fix/source-version-order-cap`（清理走 `git-expert-operations` 流程）。

### Batch 2 · 两个 Storage 与契约套件（T2，测试先行可与 Batch 1 并行）

**最小闭环**：两个 Storage 入口共用 capabilities 的断言；共享用例在 fake 与 SQLite 上钉住拒绝与定序。
**涉及文件**：见 `Global Constraints` 的 T2。

- [ ] 从 Batch 0 的提交建工作树：`git worktree add .worktrees/source-version-order-storage -b fix/source-version-order-storage fix/source-version-order`，然后 `pnpm install --frozen-lockfile`。
- [ ] **先写测试**（此时产品代码是 base）：
  - `tests/contract/suites/storage-fixtures.js`：`observation()` 默认 `sourceVersion` 从 `'v1'` 改为 `'2026-09-20T00:00:00.000000000Z'`。
  - `tests/contract/suites/storage-sync.js`：
    - 首条用例的局部 `makeObservation(key, version, payload)` 通过一张表把 `'v1'/'v2'/'v3'` 映射成 `2026-09-21T07:10:00.000000000Z` / `07:11:00.000000000Z` / `07:11:54.000000000Z`。断言行文本不变，基线不受影响。
    - 定序用例（`:90`）的 `at` 辅助把秒级字面量 `…SSZ` 写成 `…SS.000000000Z`（`version.replace(/Z$/, '.000000000Z')`，注释写明这是夹具简写，不是归一规则）。断言行文本不变。
    - 载体用例（`:104`）改名为「版本载体必须是规范载体：非 ASCII、未归一的时间戳与不定长编号在入口被拒绝且不留行（R4 / #203）」。`'～'` / `'😀'` 两行不变；新增对 `'2026-09-21T07:11:54Z'`、`'2026-09-21T07:11:54.5Z'`、`'2026-09-21T07:11:54.500Z'`、`'2026-09-21T15:11:54+08:00'`、`'9'`、`'10'`、`'v9'`、`'v10'`、40 位十六进制 sha、`'2026-09-21t07:11:54.000000000z'` 逐个 `assert.rejects(…, /规范载体/)`；把 `:114` 翻成 `await assert.rejects(storage.recordObservation(at('k3', 'v1')), /规范载体/, …)`；最后 `assert.equal(await storage.recordObservation(at('k4', '2026-09-21T07:11:54.000000000Z')), true, …)`，证明被拒绝的写入没有留下行。
    - 新增一条 `register`：「规范载体按时间序定序：#203 的变精度与偏移反例归一后，更新的被应用、更旧的被拒绝，同一时刻不同精度是同一版本」。文件顶部加 `import * as cap from '@harness-projects/capabilities'`，用 `cap.sourceVersionFromTimestamp` 归一原始反例。三个主体各写一对 `(…54Z → …54.500Z)`、`(.5Z → .51Z)`、`(15:11:54+08:00 → 08:00:00Z)`，都得到 `[true, true]`；随后换 dedupeKey 再写更旧者，得到 `false`；第四个主体先写 `…54Z`、再换 dedupeKey 写 `…54.000Z`，得到 `true`（R4 ② 同版本整快照替换，不是乱序）。
  - `tests/contract/suites/storage-execution.js:119`：`'v1'` 改为 `'2026-09-20T00:00:00.000000000Z'`。
  - `tests/contract/storage-contract.test.js`：`DUPLICATE_OBSERVATION` 的 `'v1'` 与 `sharedSyncSuite` 中 issue / draft 用例的 `'v3'` / `'v1'` 改为规范字面量；`CASE_LEDGER.sync.added` 从 0 改为 1；`ASSERTION_BASELINE.sync` 把 `"assert.equal(awaitstorage.recordObservation(at('k3','v1')),true,'ASCII载体照常接受（provider的义务是让它可比）')"` 替换为新断言去掉空白后的文本（有意替换，属于收紧）。
  - `tests/contract/suites/storage.js`：`ADDED_CASE_COUNT` 从 16 改为 17，来处注释补一句「同步组 +1（#203 规范载体定序）」。
  - `tests/integration/storage-sync-surface.test.js`：`V1 = '2026-09-21T07:10:00.000000000Z'`、`V2 = '2026-09-21T07:11:54.000000000Z'`、`V3 = '2026-09-21T07:11:54.500000000Z'`。这样既有的视图用例会顺带覆盖「同一秒内不同小数」的 BINARY 定序。`:160` 直写行的 `updated_at` 改为 `'2026-09-21T07:09:00.000000000Z'`。
- [ ] 在产品代码为 base 时运行 `node --test tests/contract/storage-contract.test.js`，记录失败用例名。期望恰好 4 条失败：载体用例 × 2 个标签（「内存 Storage 替身」「SQLite Storage（同步组）」），以及新定序用例 × 2 个标签（`cap.sourceVersionFromTimestamp` 缺失导致 TypeError）；条数守卫与基线守卫为绿。
- [ ] 取入 T1 的提交：`git cherry-pick <T1 提交>`（T1 的提交以 `git log fix/source-version-order-cap` 回读）。
- [ ] 实现：fake `storage.ts:281-283` 换成 `cap.assertComparableSourceVersion(observation.sourceVersion)`（保持在绑定检查之后）；SQLite `storage-sync.ts:215-217` 换成 `assertComparableSourceVersion(observation.sourceVersion)`，从 import 里去掉不再使用的 `isComparableSourceVersion`；按 `Global Constraints` 更新注释。
- [ ] 本地提交 `fix(storage): 两个 Storage 入口强制规范载体并钉住 #203 边界`，末尾 `Refs #203`。

**验证**（在检出 `fix/source-version-order-storage` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js` | `ℹ fail 0`；`ℹ tests` 比 Batch 0 回读的这两个文件的基线多 6（capabilities 4 条，同步组新增 1 条 × 2 个标签）；验收批次追加 C5 后多 7（`origin/main` 上 125 条，最终树 132 条） |
| `node --test tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js` | `ℹ fail 0`，条数与基线相同 |
| `pnpm verify` | exit 0 |
| `pnpm run boundaries` | `ℹ fail 0` |
| `grep -rnE "sourceVersion: 'v[0-9]+'" tests packages` | 只命中 `tests/contract/capabilities-observation.test.js` 里 C4 有意构造的拒绝用例 `makeObservation(input({ sourceVersion: 'v1' }))`（订正：原预期「无输出」没有排除它） |
| `grep -rn "sourceVersion 必须是" packages` | 只有 `packages/capabilities/src/observation.ts` 一处 |

**回滚**：丢弃工作树分支 `fix/source-version-order-storage`。

### Batch 3 · 对抗验证（T3）

**最小闭环**：在集成后的树上证明每条新断言都有判别力，并证明没有「因错误原因通过」。
**涉及文件**：无持久写入。

- [ ] 从 T2 的分支建一个分离工作树：`git worktree add --detach .worktrees/source-version-order-verify fix/source-version-order-storage`，然后 `pnpm install --frozen-lockfile`。
- [ ] **base-src 回放**：`git restore --source=origin/main -- packages/capabilities/src/observation.ts packages/providers/fake/src/storage.ts packages/storage/sqlite/src/storage-sync.ts`，然后运行 `node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js`。期望失败集合恰好是 `Validation and Acceptance` #3 列出的那一组（T3 时刻 9 条；验收批次追加 C5 后 10 条）。之后 `git checkout HEAD -- packages` 恢复，`git diff --quiet` 退出码 0。
- [ ] **变异表**。每条变异单独应用，先断言替换次数恰为 1（脚本对源文本做一次精确替换，替换前后用 `grep -c` 核对），并打印 `git diff --stat`（只有 1 个文件）；然后跑下表的最窄命令，核对变红的恰好是预期用例；最后 `git checkout HEAD -- <file>`（不要用 `git checkout -- <file>`，它恢复到索引而不是 HEAD），再 `git diff --quiet` 并重跑到绿。不用 `cp` 还原，因为本机 `cp` 会卡在覆盖确认上。

下表的「预期变红」已按验收批次在最终树上的实测订正（订正处标「订正」，原预期保留在括号里；实测输出见 `Progress` 的 Batch 4 验收条目）。每条变异都跑同一条命令 `node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js`，所以「只有」指这三个文件的全部 143 条里只有这些变红。

| # | 变异（文件） | 预期变红 |
|---|---|---|
| M1 | `isComparableSourceVersion` 回到 `/^[\x20-\x7e]+$/`（`observation.ts`） | 「比较器边界…」、C3（`9` / `v9` 等的谓词断言）、C4，以及载体用例 × 2 标签 |
| M2 | 忽略偏移（偏移分钟数恒为 0）（`observation.ts`） | C1、C2（偏移造成的年份越界不再抛错）、C3、C5，以及新定序用例 × 2 标签（`+08:00` 一对） |
| M3 | 小数用 `padStart(9, '0')`（`observation.ts`） | C1、C3（`.49Z` → `.5Z` 一对）；存储侧的 `.5Z` → `.51Z` 在补齐方向写反时仍然有序，不会变红，如实记录 |
| M4 | 删掉日历往返检查（`observation.ts`） | 只有 C2（`02-30`、`2100-02-29`、月 `13`、日 `00`）；谓词取不动点，滚动后的输出与输入不等，所以「比较器边界…」里的 `02-30` 规范样串仍为 false，不变红 |
| M5 | 小数正则改 `\d+` 并 `slice(0, 9)` 截断（`observation.ts`，两处替换） | C2（10 位小数） |
| M6a–M6e | 订正：拆成五条，逐项删掉时、分、秒、偏移时、偏移分的范围检查（`observation.ts`）（原为一条「删掉时、秒、偏移范围检查」） | 每条都只有 C2（`24:00`、分钟 60、`:60`、`+24:00`、`+08:60`）。M6e 在验收前的测试上全绿（没有偏移分钟越界的用例），验收批次在 C2 补 `+08:60` 后变红 |
| M7a / M7b | 订正：拆成两条，分别删掉结果年份的下界、上界检查（`observation.ts`）（原为一条） | M7a：只有 C2（`0000-01-01T00:30:00+01:00`）；M7b：C2 与 C5（`9999-12-31T23:59:59-01:00`） |
| M8 | 删掉 fake 入口断言（`packages/providers/fake/src/storage.ts`） | 订正：「内存 Storage 替身」标签下的载体用例与既有的空串用例（`storage-contract.test.js` 的 sharedSync「空串不是合法版本载体…」），共 2 条；SQLite 标签保持绿（原预期「只有载体用例」漏了空串用例：它同样只由入口断言判红） |
| M9 | 删掉 SQLite 入口断言（`storage-sync.ts`） | 订正：「SQLite Storage（同步组）」标签下的载体用例与空串用例，共 2 条；fake 保持绿（原预期漏了空串用例） |
| M10 | `makeObservation` 不调用断言（`observation.ts`） | 只有 C4 |
| M11 | 日历构造改用 `Date.UTC`（`observation.ts`） | C1 与 C5（`0050` 年） |
| M12 | 只把 `setUTCHours` 换成 `setHours`，本地与 UTC 方法混用（`observation.ts`） | 订正：`TZ=UTC` 下只有 C5（验收前的测试上全绿，即必需检查看不见它）；`TZ=Asia/Shanghai` 下 31 条：规范字面量归一后偏移 8 小时，不再是不动点，所有带版本的观察写入都被入口拒绝（原预期「在 `TZ=Asia/Shanghai` 下 C1 变红」偏少） |
| M12b | 验收批次追加：全程改用本地方法（`setFullYear` / `setHours` / `get*` 五处替换，`observation.ts`） | `TZ=UTC` 下只有 C5：洛杉矶夏令时空档的 `2026-03-08T02:30:00Z` 被挪到 `03:30` |
| M13 | 删掉 fake 的观察绑定存在性检查（`packages/providers/fake/src/storage.ts:280`） | 「内存 Storage 替身」标签下的悬空绑定用例（`storage-contract.test.js:226-229` 的 sharedSync 用例与 `storage-execution.js:119` 所在的父边用例），证明它们由绑定检查而不是载体判红 |
| M14 | 验收批次追加（攻击 #11）：fake 改成先写入、后断言（`packages/providers/fake/src/storage.ts`，两处替换） | 「内存 Storage 替身」标签下的载体用例与空串用例（2 条）：残留的 `～` / `😀` 行让后续写入在断言之前就被判成乱序、返回 `false`，「必须被拒绝」因此失败。SQLite 的 `mutate` 抛错即回滚，同样的改动不留行，不作变异 |

- [ ] **基线差集审计**：在工作树根运行下面的脚本（`Validation and Acceptance` #6）。期望 `minus` 恰好是被替换的 `'v1'` 行，`plus` 恰好是新的 `assert.rejects` 行。
- [ ] 把回放结果、变异表（变异 → 红用例名 → 还原后绿）与时区矩阵的输出交给 T4，写进 `Progress`。

**验证**：同上各条的期望。任一变异未按预期变红，都要回到 T1 / T2 补用例，并记入 `Surprises & Discoveries`。

**回滚**：删除分离工作树（走 `git-expert-operations` 流程）。

### Batch 4 · 验收重构、证据与 PR 定稿（T4）

**最小闭环**：一个可独立验收、合并、回滚的提交序列，PR 从 draft 到 ready。
**涉及文件**：见 `Global Constraints` 的 T4。

- [ ] 在 `.worktrees/source-version-order` 上取入 T2 分支的两个提交，并**合成一个**提交：`fix(capabilities): 把观察版本载体收窄为定宽 UTC 纳秒时间戳并在入口强制`。正文写明：为什么收窄而不是做载体感知比较器；为什么用纳秒且不截断；断言基线替换了哪一行（逐字写出新旧两行）并说明这是收紧；末尾 `Refs #203`。
- [ ] 独立审读：不变量、接口、错误路径、注释与实现一致、测试判别力。重构不得改变验收结果，重构后重跑 Batch 2 的验证。
- [ ] `docs/exec-plan/completed/2026-09-23-storage-control-facts.md:151` 原处追加 `Superseded by docs/exec-plan/completed/2026-09-29-source-version-order.md Decision Log D2（2026-09-29）`。本计划归档到 `completed/` 时，同一提交里把这条标注的路径一并改成 `completed/`。
- [ ] 更新本计划的 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective`、`Bottom Change Note`；提交 `docs(exec-plan): 记录观察版本载体的判别与变异证据`，末尾 `Refs #203`。
- [ ] 整理提交序列（验收批次订正：`57e3de7` 已被上层当作基底，只追加提交、推送为快进，不需要 backup ref 与 `comm` 比对；逐个提交为绿的检查照做，见 D11）：先建 backup ref（`git branch backup/source-version-order-<日期> HEAD`），用 `comm` 比对整理前后两个 head 的文件集合（`git diff --name-only origin/main...<head>` 两份排序后比较），不得丢文件；逐个提交检出后跑 `pnpm run typecheck && node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js`，每个都必须为绿。
- [ ] 推送（已推送分支用精确 old head 的 `--force-with-lease`），回读 PR；验证全部通过后 `gh pr ready <n> -R SingularityKChen/harness-projects`，然后请求人类评审。是否合并由人类伙伴决定。（验收批次按编排指令只做快进推送与 PR 描述更新，不执行 `gh pr ready`，不请求评审、不合并。）

**验证**（在检出 `fix/source-version-order` 的工作树根目录运行）：

| 命令 | 期望 |
|---|---|
| `pnpm verify` | exit 0 |
| `pnpm run boundaries` | `ℹ fail 0` |
| `node scripts/workflow-check.mjs` | exit 0 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 ≤ 800、文档 ≤ 1300 |
| `node scripts/rule-checks.mjs disclosure origin/main` | 无命中；另按 `docs/development/publication.md` 人工过五个类目 |
| `git diff --check origin/main...HEAD` | 无输出 |
| `git log --format='%s%n%b' origin/main..HEAD` | 4 个提交（订正：原为 3 个，见 D11），格式合规；正文不含关闭关键字；各自以 `Refs #203` 结尾（这是 Batch 4 时刻的期望；R1 之后为 7 个，见 R1 验证表） |
| `gh pr view <n> -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,labels,isDraft` | `headRefOid` 等于本地 `git rev-parse HEAD`；`baseRefName` 为 `main`；`closingIssuesReferences` 含 203 |
| `gh pr checks <n> -R SingularityKChen/harness-projects` | `PR Fast Gate` 为 pass |

**回滚**：合并前回到 backup ref；合并后见 `Idempotence and Recovery`。

### 评审响应 · R1（评审 5352511875）

**来源**：人类伙伴（评审账号）在 PR #240 的评审 5352511875，结论 CHANGES_REQUESTED。唯一的阻塞项是 inline comment 4133390588，挂在 `b0218f1` 的 `packages/storage/sqlite/src/storage-sync.ts:217`（入口断言那一行）。意见是：这里只校验新观察，没有校验已有的 `sync_observation.updated_at`；用 main 的公开 Storage 端口写入 `v9` 后，用本 head 重开再写更晚的规范值，返回 `false`，新事实被静默丢弃。要求是在新业务写入前检测并迁移旧载体；无法无损迁移时，明确拒绝旧库并提供保留数据的恢复路径；同时加跨版本重开的回归用例；只在 PR 描述里建议删库不够。评审总述还要求修复后重新锁定 head/base，运行跨版本文件库用例与当前检查；同栈的 #241 在此项收口后另行复评。
**最小闭环**：旧库文件在本 head 上重开时，要么被 005 迁移进定义域（新观察按时间序定序），要么在任何迁移之前被整库拒绝且零改动；被拒绝的库有一条先备份、保留全部行的修复路径；跨版本重开回归用例在 `b0218f1` 上红、在修复后绿。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。
**涉及文件**：见 `Global Constraints` 的 R1。
**提交**（遵守 D11：只追加，推送是快进）：
1. 本计划的 R1 规划提交 `docs(exec-plan)`。
2. 实现与测试合成一个 `fix(storage): 迁移前检测旧观察版本载体，可归一则迁移，否则拒绝并提供备份修复`。每个提交都要单独为绿，所以测试与实现放在同一个提交里。
3. 证据提交 `docs(exec-plan)`。

正文都以 `Refs #203` 结尾，不写关闭关键字。

- [ ] **1. 锁定**（R1-A，在检出 `fix/source-version-order` 的工作树根目录运行）：`git fetch origin && git rev-parse origin/main origin/fix/source-version-order HEAD`，以及 `gh pr view 240 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,reviewDecision`。期望：PR 的 `headRefOid` 等于 `origin/fix/source-version-order`；本地 HEAD 只比它多本计划的 R1 规划提交；base 为 `main`。不一致就停下，先回读新 head 的改动。然后建恢复锚点 `git branch backup/source-version-order-r1-pre b0218f1`。
- [ ] **2. 建工作树**（R1-D）：`git worktree add .worktrees/source-version-order-r1 -b fix/source-version-order-r1 fix/source-version-order`，然后 `pnpm install --frozen-lockfile`。
- [ ] **3. 先写测试**（R1-D，文件 `tests/integration/storage-source-version-upgrade.test.js`）。新名字一律经 `import * as sqlite from '@harness-projects/storage-sqlite'` 引用；既有名字（`createSqliteStorage`、`migrate`、`openDatabase`、`MIGRATIONS`）可以具名导入。这样文件在 `b0218f1` 上也能加载，每条用例各自变红。辅助函数有两个：
  - `legacyDatabase(location, versions, rows)`，即「main 等价写入器」，依次做：
    1. `openDatabase`。
    2. `migrate(db, { entries: MIGRATIONS.slice(0, versions) })`。
    3. 用裸 SQL 写 `workspace` 与 `provider_binding`。
    4. 每条观察按 main 的 `recordObservation` 编码裸插入：列序同 `OBSERVATION_COLUMNS`；`updated_at = legacy ?? ''`；`snapshot_json = JSON.stringify({ observation: { ...cap.makeObservation({ ...input, sourceVersion: undefined }), sourceVersion: legacy }, state })`。展开后覆盖同名键不改变键序；`dedupeKey` 不含 `sourceVersion`，所以产物与 main 的 `makeObservation` 逐字段相同。
    5. 关闭句柄。
  - `fingerprint(location)`：文件 sha256、所在目录的文件名列表、`schema_migrations` 的版本、`sqlite_master` 的 `(type, name, sql)`，以及 `sync_observation` 按 rowid 排序的全部列。

  下面的用例里，U5、U7 在 `b0218f1` 上变红只因为清单里没有版本 5，属于钉住型；其余都是行为判别。
  - **U1「评审反例：旧库含 `v9` 时打开被拒绝，库逐字节不变，句柄不泄漏，旧清单仍能打开」**。
    - 夹具：`legacyDatabase(loc, 4, [item-1 'v9'])`。
    - 断言：`assert.throws(() => createSqliteStorage(loc), (e) => e instanceof sqlite.LegacySourceVersionError && e.code === 'legacy_source_version' && e.unorderableRows === 1 && e.samples[0].updatedAt === 'v9' && /库未被修改/.test(e.message) && /repairLegacySourceVersions/.test(e.message))`；`fingerprint` 前后相等；再连续打开 5 次都抛同一个错误，`readdirSync('/dev/fd').length` 不变；最后 `migrate(openDatabase(loc), { entries: MIGRATIONS.slice(0, 4) }).applied` 为 `[]`，说明本修复之前的清单仍能打开这个未改动的库。
    - 在 `b0218f1` 上：打开成功 → 红。
  - **U2「拒绝早于更早的待应用迁移」**。
    - 夹具：`legacyDatabase(loc, 3, [item-1 'v9'])`。
    - 断言：打开抛 `LegacySourceVersionError`；`schema_migrations` 仍为 `[1,2,3]`；`fingerprint` 相等。
    - 在 `b0218f1` 上：应用了 004 且打开成功 → 红。
  - **U3「可归一的旧值被迁移并纠正定序；`snapshot_json` 不变」**。
    - 夹具：主体 A 写 `2026-09-21T07:11:54Z`；主体 B 先写 `2026-09-21T07:11:55Z`，再写 `2026-09-21T15:11:54+08:00`（main 按码点序接受后者，已提交快照选了更早的时刻）；主体 C 无版本；主体 D 已是规范值。
    - 断言：
      - `migrate(openDatabase(loc)).applied` 为 `[5]`。
      - `updated_at` 依次为 `…07:11:54.000000000Z`、`…07:11:55.000000000Z`、`…07:11:54.000000000Z`、`''`、原值。
      - `snapshot_json` 逐行与迁移前相等。
      - `committed_observation` 里 B 的已提交行是 `…55` 那一行。
      - 再经 `createSqliteStorage` 写：A 写 `…54.500000000Z` 返回 `true`；B 写 `…54.900000000Z` 返回 `false`；C 写规范值返回 `true`。
      - 最后逐行断言 R1-3 的不变量。
    - 在 `b0218f1` 上：`applied` 为 `[]`，A 的写入返回 `false` → 红。
  - **U4「同一时刻的不同写法归一后是同一版本（R4 ②）」**。
    - 夹具：同一主体先写 `…54.000Z`（observed t1），再写 `…54Z`（observed t2，main 按码点序接受；反过来的顺序会被 main 拒绝，见 R1 的 Surprises）。
    - 断言：打开后两行都是 `…54.000000000Z`；换一个 dedupeKey 写 `…54.000000000Z` 返回 `true`（同版本整快照替换）。
    - 在 `b0218f1` 上：已提交的 `…54Z` 按码点序大于规范值，返回 `false` → 红。
  - **U5「幂等」**：空库上 `migrate` 的 `applied` 等于 `MIGRATIONS.map((entry) => entry.version)`，再跑一次为 `[]`。`legacyDatabase(loc, 4, [规范值, 无版本])` 上 `applied` 为 `[5]`，`sync_observation` 全列与迁移前相等。
  - **U6「数据步骤在事务内重新分类」**：模拟预检之后才出现的并发写入。
    - 夹具：`legacyDatabase(loc, 4, [item-1 'v9'])`。
    - 断言：在 `BEGIN IMMEDIATE` 内调用 `MIGRATIONS.at(-1).data.apply(db)`，抛 `LegacySourceVersionError`；`ROLLBACK` 之后行不变，`schema_migrations` 里没有 5。
    - 在 `b0218f1` 上：`data` 不存在 → 红。
  - **U7「降级拒绝」**：迁移到 [1..5] 的库用 `migrate(db, { entries: MIGRATIONS.slice(0, 4) })` 打开，抛 `/已应用版本与迁移清单不一致/`。
  - **U8「迁移后混入的旧载体在评审锚点行被响亮拒绝」**。
    - 夹具：`createSqliteStorage` 建新库，写入工作区与绑定后关闭；再用裸 SQL 给主体 X 插一行 `updated_at = 'v9'`，模拟迁移前就已打开库的旧进程。
    - 断言：重开后对 X 写规范观察，`await assert.rejects(…, (e) => e.message === sqlite.LEGACY_COMMITTED_VERSION_MESSAGE)`，且账本没有新行；对另一个主体的写入返回 `true`，不受影响。
    - 在 `b0218f1` 上：返回 `false` → 红。
  - **U9「恢复路径：先备份并核对，再保留全部行」**。
    - 夹具：`legacyDatabase(loc, 4, …)` 写入 item-1 `v9`；item-2 `…54Z`；item-3 先写规范值 `…54.000000000Z`，后写 `v10`。另用裸 SQL 写一行 `workspace_revision`，作为本地独有事实的代表。
    - 断言：
      1. 备份路径已存在时抛错，原库 `fingerprint` 不变。
      2. 修复返回 `{ backupPath, normalized: 1, demoted }`，其中 `demoted` 恰好是 item-1 的 `v9` 行与 item-3 的 `v10` 行，并且带 bindingId、objectKind、externalId、dedupeKey。
      3. 备份的 `integrity_check` 为 `ok`；它的 `schema_migrations`、`sqlite_master` 与各表全部行都与修复前的原库相同，包括 `v9` 行。
      4. 活库里 `v9`、`v10` 变成 `''`，`…54Z` 变成 `…54.000000000Z`；`snapshot_json` 与其他表逐行不变；行数不变；`schema_migrations` 仍为 `[1..4]`。
      5. `createSqliteStorage` 打开成功（应用 [5]）。item-1 写 `2026-09-30T00:00:00.000000000Z` 返回 `true`，这正是评审期望的结果；item-3 写 `…53.000000000Z` 返回 `false`。
      6. 再调用一次修复，返回 `{ backupPath: undefined, normalized: 0, demoted: [] }`。
      7. 执行逆向 SQL `UPDATE sync_observation SET updated_at = coalesce(json_extract(snapshot_json, '$.observation.sourceVersion'), '')` 后，`updated_at` 列与修复前逐行相等。
    - 在 `b0218f1` 上：函数不存在 → 红。
  - **U10「重写前 003 形状的库在任何迁移之前被拒绝」**。
    - 夹具：`migrate(db, { entries: MIGRATIONS.slice(0, 3) })` 之后，把 `sync_observation` 退回重写前的列集合。做法与 `tests/integration/storage-sync-surface.test.js` 的 `rewriteObservationTable` 相同，在本文件里复制一个最小版本，不改那个文件。
    - 断言：打开抛 `/重写前的 003/`；`schema_migrations` 仍为 `[1,2,3]`；`fingerprint` 相等。
    - 在 `b0218f1` 上：先应用了 004 才拒绝 → 版本断言红。
- [ ] **4. 修复前为红**（R1-D）：产品代码仍是 `b0218f1` 时，运行 `node --test tests/integration/storage-source-version-upgrade.test.js`。期望 `ℹ tests 10`、`ℹ fail 10`，失败名单恰好是 U1–U10；把实际输出记进 `Progress`（订正：验收把 U5 与 U7 合成一条后为 `ℹ tests 9`、`ℹ fail 9`）。这就是「跨版本重开回归在当前 head 上红」的证据。
- [ ] **5. 实现**（R1-D）：按 `Design / Spec` 的 R1 增补实现。本地 WIP 也要提交，防止会话中断丢失工作。最后整理成一个 `fix(storage)` 提交，正文写：根因（不变量没有拥有者）；为什么迁移可归一的、拒绝不可定序的；为什么修复函数取降为无版本；005 为什么不含 DDL；末尾 `Refs #203`。
- [ ] **6. 修复后为绿**（R1-D）：跑下面验证表的前五行。
- [ ] **7. 真 main 带外证据**（R1-V，在仓库外的空临时目录 `<tmp>` 里做，只把命令与输出写进 `Progress`，路径用占位符）：
  1. 在检出 `fix/source-version-order-r1` 的工作树根目录，对 `699d715` 与 R1 的实现提交分别执行 `git archive <ref> packages/domain packages/capabilities packages/storage/sqlite | tar -x -C <tmp>/<ref>`。
  2. 在每份拷贝里建三条相对软链：`packages/capabilities/node_modules/@harness-projects/domain` → `../../../domain`；`packages/storage/sqlite/node_modules/@harness-projects/domain` → `../../../../domain`；`packages/storage/sqlite/node_modules/@harness-projects/capabilities` → `../../../../capabilities`。
  3. 写一个一次性脚本（约 20 行，不进仓库）：以 `import('<tmp>/<ref>/packages/storage/sqlite/src/index.ts')` 取 `createSqliteStorage`；首次打开时写工作区 `ws-1` 与绑定 `b-1`；然后对主体 `(b-1, item, <id>)` 以新的 dedupeKey 调 `recordObservation`，打印返回值或异常。
  4. 核对三件事：
     - (a) 等价性：用固定的 `receivedTime`，让真 main 端口与 U1 / U3 的等价写入器写同一组输入（`v9`、`…54Z`、`15:11:54+08:00`、无版本），两库 `sync_observation` 的全部列逐列相等。
     - (b) 评审原输入：main 写 `v9` 返回 `true`；R1 head 打开时抛 `LegacySourceVersionError`，文件 sha256 不变；main 仍能打开并写入；修复之后，R1 head 写 `2026-09-30T00:00:00.000000000Z` 返回 `true`。
     - (c) 可归一库：main 写 `…54Z` 与 `+08:00`；R1 head 打开时应用 [5]，之后写更晚的规范值返回 `true`。
  5. 对照组：同一个脚本换成 `b0218f1` 的拷贝，复现评审的 `true` / `false`。
- [ ] **8. base-src 回放**（R1-V）：
  1. `git worktree add --detach .worktrees/source-version-order-r1-verify fix/source-version-order-r1`，然后 `pnpm install --frozen-lockfile`。
  2. `git restore --source=b0218f1 -- packages/storage/sqlite`。默认的 no-overlay 模式会一并删掉 `b0218f1` 里不存在的两个新文件（已实测）。
  3. 运行 `node --test tests/integration/storage-source-version-upgrade.test.js`，期望 10 条全红。再运行验证表第二、三行的命令，期望全绿（既有测试文件不改即绿，且在 `b0218f1` 上本来就绿）。
  4. `git restore --source=HEAD -- packages/storage/sqlite`，然后 `git status --short` 无输出。
- [ ] **9. 变异**（R1-V）：
  - **方法**：每条变异单独应用，脚本对源文本做一次精确替换，先断言替换次数恰为 1，并确认 `git diff --stat` 只有 1 个文件。然后运行 `node --test tests/integration/storage-source-version-upgrade.test.js tests/integration/storage-sync-surface.test.js tests/integration/migration-runner.test.js`，核对变红的恰好是预期用例。最后 `git checkout HEAD -- <file>`，再 `git diff --quiet`，重跑到绿。下表的预期以最终树上的实测为准，偏差按 Batch 3 的「订正」写法记录。
  - **既有变异表**：M1–M14（含 M6a–M6e、M7a / M7b、M12b）在最终树上用 Batch 3 的原命令整表重测。期望与 Batch 4 的记录一致；M9 与 R1-7 的守卫在同一个方法里，它的红集以实测为准。

| # | 变异（文件） | 预期变红 |
|---|---|---|
| R-M1 | 删掉清单条目 5 的 `data: SOURCE_VERSION_CARRIER_STEP`（`migrations.ts`） | U1、U2、U3、U4、U6、U10；订正：还有 U5 / U7，合并后的用例断言 005 带数据步骤 |
| R-M2 | 删掉 `migrate()` 里的预检调用（`migrate.ts`） | U2、U10（004 先于拒绝被应用）。U1 保持绿：[1..4] 库上 005 的事务内复检照样拒绝并回滚，而只读的 `BEGIN IMMEDIATE` / `ROLLBACK` 不改文件（已实测 sha256 不变）。这正是需要 U2 的理由 |
| R-M3 | 数据步骤 `apply` 改用 `rewriteCarriers(db, 'demote')`，即去掉事务内拒绝（`source-version-carrier.ts`） | 只有 U6 |
| R-M4 | `classifyCarriers` 不收集归一失败的值（`source-version-carrier.ts`） | U1、U2、U6（不再拒绝）；U9（`demoted` 为空） |
| R-M5 | `rewriteCarriers` 跳过可归一值的 `UPDATE`（`source-version-carrier.ts`） | U3、U4、U9（`…54Z` 未归一，`normalized` 不符） |
| R-M6 | 去掉 `createSqliteStorage` 的 catch 里的 `db.close()`（`storage.ts`） | 只有 U1（fd 数增加）；既有的 003 自检用例走构造函数路径，不受影响 |
| R-M7 | 删掉 `recordObservation` 的已提交值守卫（`storage-sync.ts`） | 只有 U8（返回 `false`） |
| R-M8 | 修复函数跳过 `VACUUM INTO` 与备份核对（`source-version-carrier.ts`） | 只有 U9（备份文件不存在） |
| R-M9 | 修复函数对不可定序行改用 `DELETE`（`source-version-carrier.ts`） | 只有 U9（行数与 `demoted` 行仍在活库的断言） |
| R-M10 | `classifyCarriers` 不做旧形状检查（`source-version-carrier.ts`） | 只有 U10：预检放行，004 与 005 都被应用之后才由构造函数拒绝 |
| R-M11 | 验收追加：删掉修复函数里的 `verifyBackup` 调用（`source-version-carrier.ts`） | 无，存活。单进程用例造不出与原库不一致的备份，这条核对是防御性的，如实记录（见 `Surprises & Discoveries`） |

- [ ] **10. 集成与证据**（R1-A）：
  1. 在 `.worktrees/source-version-order` 上运行 `git merge --ff-only fix/source-version-order-r1`。
  2. 跑完下面的验证表。
  3. 按 `docs/development/publication.md` 做机械扫描与人工五类目检查。
  4. 回填 `Progress`、`Surprises & Discoveries`、`Outcomes & Retrospective` 与 `Bottom Change Note`，提交证据 `docs(exec-plan): 记录评审 R1 的跨版本、回放与变异证据`，末尾 `Refs #203`。
- [ ] **11. 推送与回复**（主会话，需要人类伙伴授权的外部写入；本规划任务不执行）：
  - 快进推送 `git push origin fix/source-version-order`。
  - 回读 PR 的 `headRefOid`、`baseRefName`、`mergeStateStatus`、checks、review threads。
  - 更新 PR 描述：删掉删库建议，写入恢复路径、语义后果与 R1 的验证证据。
  - 在 thread 4133390588 下说明根因修复、验证命令与结果。只有新 head 上的证据成立才 resolve。
  - 请人类伙伴复评。
  - #241 以本分支新的 head 为基变基（它自己的提交不碰 `packages/storage/sqlite`，预期没有冲突），在本项收口后另行复评。
  - 是否合并由人类伙伴决定。

**验证**（R1-A，在检出 `fix/source-version-order` 的工作树根目录运行；R1-D 在自己的工作树上跑前五行）：

| 命令 | 期望 |
|---|---|
| `node --test tests/integration/storage-source-version-upgrade.test.js` | `ℹ tests 10`、`ℹ fail 0`（订正：U5 / U7 合并后为 `ℹ tests 9`） |
| `node --test tests/integration/migration-runner.test.js tests/integration/storage-restart.test.js tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js tests/integration/identity-membership-schema.test.js tests/integration/identity-membership-enums.test.js` | `ℹ fail 0`，条数与同一命令在 `b0218f1` 上相同 |
| `node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js` | `ℹ fail 0`，条数与 Batch 4 记录的 143 相同 |
| `for tz in UTC Asia/Shanghai America/Los_Angeles; do TZ=$tz node --test tests/integration/storage-source-version-upgrade.test.js \|\| exit 1; done` | 三次都 `ℹ fail 0` |
| `pnpm run typecheck && pnpm run boundaries` | 退出 0；`ℹ fail 0`（storage-sqlite 只新增对 capabilities 既有导出的使用） |
| `pnpm verify` | 退出 0 |
| `node scripts/workflow-check.mjs` | 退出 0 |
| `node scripts/rule-checks.mjs size origin/main` | 代码 ≤ 800（弹性，超过就先停下报告）且 ≤ 1000（CI 硬上限）；文档 ≤ 1300 且 ≤ 1500 |
| `node scripts/rule-checks.mjs disclosure origin/main` | 无命中；另做人工五类目检查 |
| `git diff --check origin/main...HEAD` | 无输出 |
| `git diff --stat b0218f1 HEAD -- packages/capabilities packages/providers tests/contract packages/storage/sqlite/migrations/001_init.sql packages/storage/sqlite/migrations/002_identity_membership.sql packages/storage/sqlite/migrations/003_control_facts.sql packages/storage/sqlite/migrations/004_execution_run_identity.sql` | 无输出（R1 明确不改的文件） |
| `git diff --name-only b0218f1 HEAD -- tests` | 只有 `tests/integration/storage-source-version-upgrade.test.js` |
| `git log --format='%s%n%b' origin/main..HEAD` | 7 个提交，格式合规，各自以 `Refs #203` 结尾，正文不含关闭关键字（订正：验收在证据提交之后又追加了一个只补记 #17 复跑的文档提交，共 8 个） |
| `gh pr view 240 -R SingularityKChen/harness-projects --json headRefOid,baseRefName,closingIssuesReferences,reviewDecision` | 推送后：`headRefOid` 等于本地 `git rev-parse HEAD`；`baseRefName` 为 `main`；`closingIssuesReferences` 含 203 |
| `gh pr checks 240 -R SingularityKChen/harness-projects` | 推送后 `PR Fast Gate` 为 pass |

**回滚**：
- 合并前：`fix/source-version-order` 只做快进，回退就是把分支指回 R1 之前的提交（锚点 `backup/source-version-order-r1-pre`）。如果已经推送，走 `git-expert-operations` 流程，用精确的 `--force-with-lease`，并同步通知 #241。
- 合并后与运行期的库：见 `Idempotence and Recovery` 的 R1 条目。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | #203 验收 1：契约注释只列出比较器能排对的载体 | `observation.ts` 的定序约定注释只列规范载体；C3 与新定序用例证明规范载体上码点序即时间序 |
| 2 | #203 验收 2：契约用例在 fake 与 SQLite 上覆盖小数精度、偏移与不等宽数字 | `storage-sync.js` 的载体用例（未归一的精度、偏移、`9` / `10` / `v9` / `v10` 在入口被拒）与新定序用例（精度、偏移归一后定序），在「内存 Storage 替身」「SQLite Storage（同步组）」两个标签下都通过 |
| 3 | 新断言对 base 有判别力 | base-src 回放恰好 10 条失败（T3 时刻 9 条，验收批次追加 C5）：capabilities 的「比较器边界…」、C1、C2、C3、C4、C5；「内存 Storage 替身」与「SQLite Storage（同步组）」两个标签下的载体用例与新定序用例各 2 条。`storage-sync-surface` 全绿 |
| 4 | 每条断言都承重 | 变异表 M1–M14（含 M6a–M6e、M7a / M7b、M12b）逐条「已生效 → 预期用例红 → 还原 → 绿」 |
| 5 | 入口断言与文案只有一份 | `grep -rn "sourceVersion 必须是" packages` 只命中 `observation.ts`；两个 Storage 都调用 `assertComparableSourceVersion` |
| 6 | 断言基线只收紧、不放宽 | 下面的差集脚本输出 `minus` 为 `'v1'` 接受行、`plus` 为 `'v1'` 拒绝行，各 1 条 |
| 7 | DDL 与视图未变 | `git diff origin/main...HEAD -- packages/storage/sqlite/migrations/003_control_facts.sql \| grep -E '^[-+][^-+]' \| grep -vE '^[-+]\s*--'` 无输出 |
| 8 | 与时区无关 | Batch 1 的三时区循环全绿；C5 在进程内切换 `TZ`，所以必需检查（在 UTC 下运行）也能判红本地方法回归（M12 / M12b） |
| 9 | 栈底只写本层事实 | 本计划、代码注释与 PR 描述里出现的 #70 只有「上层」与接口契约的写法，没有「已调用 / 已接入」 |
| 10 | 包边界与全量回归 | `pnpm run boundaries`、`pnpm verify` 通过 |
| 11 | 规模与发布面 | size ≤ 800 / ≤ 1300；disclosure 无命中；人工五类目检查通过 |
| 12 | 评审 5352511875 的阻塞项：旧库重开后，新事实不再被静默丢弃 | U1（拒绝）；U9 第 5 项（修复后，评审的原输入返回 `true`）；U3 / U4（可归一的库迁移后返回 `true`）；R1 步骤 7 的真 main 带外证据 |
| 13 | 拒绝零改动、早于任何迁移、不泄漏句柄 | U1 / U2 / U10 的 `fingerprint` 与 fd 计数；变异 R-M2、R-M6、R-M10 |
| 14 | 恢复路径保留数据 | U9 第 1–7 项；变异 R-M8、R-M9 |
| 15 | 跨版本重开回归在修复前的 head 上红 | R1 步骤 4 与步骤 8：`b0218f1` 的产品代码上新文件全红（订正：合并 U5 / U7 后为 9/9）；既有测试文件不改即绿 |
| 16 | R1 的每条断言都承重 | R-M1–R-M10 逐条「已生效 → 预期用例红 → 还原 → 绿」；R-M11（备份核对）存活，记为防御性；既有 M1–M14 在最终树上整表重测 |
| 17 | 既有验收不削弱 | #1–#11 的命令在最终 head 上重跑，结论不变；R1 验证表里「明确不改」那一行无输出 |

基线差集脚本（在工作树根运行，读 `origin/main` 与 `HEAD` 两个版本的 `ASSERTION_BASELINE.sync`）：

```sh
node -e '
const {execFileSync}=require("node:child_process");
const pick=(ref)=>{const src=execFileSync("git",["show",ref+":tests/contract/storage-contract.test.js"],{encoding:"utf8"});const line=src.split("\n").find(l=>l.startsWith("  sync: ["));return JSON.parse(line.slice("  sync: ".length).replace(/,\s*$/,""))};
const a=pick("origin/main"),b=pick("HEAD");console.log(JSON.stringify({minus:a.filter(x=>!b.includes(x)),plus:b.filter(x=>!a.includes(x))},null,1))'
```

（2026-09-29 在 `f6a33d2` 上以 `HEAD = origin/main` 试跑，输出 `minus: []`、`plus: []`，确认脚本可解析基线。）

## Progress

- [x] (2026-09-30) R2 最终树：更新到 `main@1cdfb23`，README 冲突保留两项；`pnpm verify` 787/787 + MVP-0 7/7，boundaries 7/7，workflow-check 无发现。#203 对应的 R1 第 8 行与控制计划同步更新，载体计划归档。

- [x] (2026-09-30) R2：U11 先红后绿；跨版本与迁移运行器 15/15，typecheck 通过。最终 rebase 后再跑全部门禁，按运行时交付物与文档归档整理提交，远端推送与合并只使用新 head 的检查、线程和批准。

- [x] (2026-09-29) 三份独立设计完成：收窄载体（纳秒 + 计数器）、载体感知比较器（序键列）、系统视角（毫秒 + 单一载体）。
- [x] (2026-09-29) 独立评审定稿：逐条复核关键事实，在检出 `f6a33d2` 的仓库根复现 10/10 格反例，并记录基线（见 `Context and Orientation`）；按 P0–P3 列出三份设计的问题（见 `Decision Log` D3 与 `Design / Spec` 的定稿来源）；原型验证归一算法；写入本计划与 `docs/README.md` 索引行（未提交）。
- [x] (2026-09-29) Batch 0 · 计划提交 `ae8715c` 已推送；draft PR #240（base `main`，标签 `kind:fix` / `area:capabilities` / `area:storage`，`closingIssuesReferences` 含 203）。回读：`gh pr view 240 -R SingularityKChen/harness-projects --json isDraft,baseRefName,closingIssuesReferences,labels`。
- [x] (2026-09-29) Batch 1 · T1 在 `.worktrees/source-version-order-cap`（分支 `fix/source-version-order-cap`，提交 `29479a1`，仅本地）：产品代码为 base 时恰好 5 条失败，实现后 `ℹ tests 8`、`ℹ fail 0`，三个时区都通过（记录在该提交正文）。
- [x] (2026-09-29) Batch 2 · T2 在 `.worktrees/source-version-order-storage`（分支 `fix/source-version-order-storage`：`b598bc3` 取入 T1，`589c4c4` 为 T2 自己的提交，仅本地）。
- [x] (2026-09-29) Batch 3 · T3 对抗验证（Sonnet，分离工作树，无持久写入）。结论 pass，另有四处问题：一条 P3（偏移分钟的范围检查没有用例承重）；M8 / M9 / M12 的预期与实测不符。T3 的数字只作线索；验收批次在最终树上整表重测，证据以下一条为准。
- [x] (2026-09-29) Batch 4 · 集成（主会话）：`57e3de7` 由 T1 与 T2 合成为单一 `fix(capabilities)` 提交，树与 `589c4c4` 逐字节相同（`git diff 589c4c4 57e3de7` 无输出）。上层 #70 随后开了 PR #241（分支 `feature/github-projects-read`，base 为本分支），并以 `57e3de7` 为基变基推送，所以 `ae8715c` 与 `57e3de7` 不再改写（D11）。
- [x] (2026-09-29) Batch 4 · 验收（T4，Opus，在检出 `fix/source-version-order` 的工作树 `.worktrees/source-version-order` 根目录运行）。
  - 复评结论与处置见 `Surprises & Discoveries` 与 D12。追加提交 `test(capabilities): 让偏移分钟与进程时区检查在必需检查上承重`，它改了 T1 所有的 `packages/capabilities/src/observation.ts`（只改一句注释）与 `tests/contract/capabilities-observation.test.js`，这两个文件的所有权按 `Global Constraints` 转给 T4。随后追加本文档提交。代码与测试的证据取自 `18b7aff`（其后只有文档提交），回读命令是 `git log --oneline origin/main..HEAD`。
  - base-src 回放：恰好 10 条失败，即「比较器边界…」、C1、C5、C2、C3、C4，以及两个标签各自的载体用例与新定序用例；`storage-sync-surface` 全绿。恢复后 `git diff --quiet` 退出码为 0，143/143。
  - 变异表（命令与订正后的预期见 Batch 3 的表）：M1 5 条红，M2 6 条，M3 2 条，M4 / M5 / M6a–M6e / M7a / M10 各 1 条，M7b / M8 / M9 / M11 / M13 各 2 条，M12 在 `TZ=UTC` 下 1 条（C5）、在 `TZ=Asia/Shanghai` 下 31 条，M12b 在 `TZ=UTC` 下 1 条（C5），M14 2 条。每条都先断言替换次数并确认 `git diff --stat` 只有 1 个文件；变红的用例与订正后的预期逐条一致；随后 `git checkout HEAD -- <file>`，`git diff --quiet` 退出码为 0，重跑 143/143。
  - 验收前的测试上对照：取 `57e3de7` 的 `capabilities-observation.test.js` 分别应用 M6e 与 M12，在 `TZ=UTC` 下三个文件都是 142/142 全绿。这就是补 `+08:60` 与 C5 的依据。
  - 时区矩阵：`for tz in UTC Asia/Shanghai America/Los_Angeles; do TZ=$tz node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js tests/integration/storage-sync-surface.test.js; done`，三次都是 143/143。
  - 条数：`node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js` 在 `origin/main`（`f6a33d2`）上是 125 条，在最终树上是 132 条（多 7）；`node --test tests/integration/storage-sync-surface.test.js tests/integration/execution-relation-write-schema.test.js` 两边都是 23 条。
  - 逐个提交为绿：分离检出 `ae8715c` / `57e3de7` / `18b7aff`，分别运行 `pnpm run typecheck && node --test tests/contract/capabilities-observation.test.js tests/contract/storage-contract.test.js`，typecheck 都退出 0，测试依次为 125 / 131 / 132 条、0 失败。
  - `Validation and Acceptance` #5 / #6 / #7：`grep -rn "sourceVersion 必须是" packages` 只命中 `observation.ts`；基线差集脚本的 `minus` 与 `plus` 各 1 条，恰好是 `'v1'` 从接受翻成拒绝的那一行；003 的差异只有注释行。
  - 全量与门禁（最终 head）：`pnpm verify` 退出 0（contract + integration + e2e 764 条，mvp0 7 条，0 失败）；`pnpm run boundaries` 7/7；`node scripts/workflow-check.mjs` 退出 0；`node scripts/rule-checks.mjs disclosure origin/main` 与 `size origin/main` 都退出 0（代码 301 / 1000，文档在上限内，回读命令同前）；`git diff --check origin/main...HEAD` 无输出；`node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/e1-evidence-consistency.test.js` 0 失败；按 `docs/development/publication.md` 人工检查了五个类目，没有命中。
  - `docs/exec-plan/completed/2026-09-23-storage-control-facts.md`：原计划只在 `:151` 标注，实际在 `:36`、`:127`、`:151`、`:196` 四处都原地追加了 Superseded，原文保留（见 `Surprises & Discoveries`）。
- [ ] 未执行，按编排指令留给主会话与人类伙伴：`gh pr ready 240`、请求人类评审、合并；H1–H6 的裁决；合并后把本计划移到 `completed/`，并把 Superseded 标注里的路径一并改成 `completed/`。（2026-09-30 回读 `gh pr view 240 -R SingularityKChen/harness-projects --json isDraft,reviewDecision`：PR 已是 ready，人类伙伴已给出评审 5352511875，结论 CHANGES_REQUESTED；合并要等 R1 收口后由人类伙伴决定。）
- [x] (2026-09-30) 评审响应 R1 · 定稿（独立评审定稿者，在检出 `fix/source-version-order` 的工作树 `.worktrees/source-version-order` 根目录运行，head `b0218f1`，`origin/main` 为 `699d715`）。
  - 用真 main 代码复现了评审反例，另外发现三项附带事实，见 `Surprises & Discoveries` 的 R1 条目。
  - 三份设计的 P0–P3 结论见 D14；方案与规格见 `Design / Spec` 的 R1 增补、D13 与 D15–D17。
  - 在仓库外的临时目录里对方案做了只读原型，结论写在 Surprises 里。
  - 本计划的改动已提交为 `docs(exec-plan): 规划评审 R1：旧库观察版本载体的迁移、拒绝与备份修复`，回读命令 `git log --oneline -1 -- docs/exec-plan/completed/2026-09-29-source-version-order.md`。
  - 没有推送，没有写 GitHub，没有改其他文件。
- [x] (2026-09-30) R1-D 实现与测试（开发子任务）。按编排指令没有建 `.worktrees/source-version-order-r1`，直接在 `.worktrees/source-version-order` 上做了两个本地 WIP 提交，未推送。
  - 修复前为红：产品代码为 `b0218f1` 时新文件 10 条全红，原因都是行为判别（没抛错、`applied` 为 `[]`、未归一、写入返回 `false`、函数缺失、004 先被应用），不是加载失败。
  - 修复后：新文件 10/10，三个时区各 10/10；验证表第二、三行为 52 / 143 条，0 失败；`pnpm verify` 退出 0。
  - `size origin/main` 为代码 888，超过 800 的弹性上限，按计划停下报告，没有整理提交。
- [x] (2026-09-30) R1-V 对抗验证（独立验证者，在仓库外的副本里做，无持久写入，对象是开发的 WIP 头）：结论 pass，另有三条 P3。一是备份核对没有用例承重；二是分支仍是 WIP，代码 888；三是恢复入口只有库函数。它还用真 main 复现了跨版本、旧进程交错与 6 进程并发打开，结论与下一条一致。它的数字只作线索，证据以下一条为准。
- [x] (2026-09-30) R1-A 验收（Opus，在检出 `fix/source-version-order` 的工作树 `.worktrees/source-version-order` 根目录运行；`origin/main` = `699d715`，PR head = `b0218f1`，只有 thread 4133390588 一条未解决，回读 `git rev-parse origin/main origin/fix/source-version-order`）。
  - 复评与重构见 D18。代码从 888 降到 800 / 1000。
  - 两个 WIP 提交与验收改动合成 `8029a64`。合成前建了锚点 `backup/source-version-order-r1-wip`；用 `comm` 比对合成前后相对 `a63745a` 的文件集合，无差异。
  - base-src 回放（本工作树，串行）：`git restore --source=b0218f1 -- packages/storage/sqlite` 之后，新文件 `ℹ tests 9`、`ℹ fail 9`，每条都因行为而红（U6 是数据步骤不存在）；验证表第二、三行仍是 52 / 143 条，0 失败。`git restore --source=HEAD -- packages/storage/sqlite` 之后 `git diff --quiet` 退出 0。
  - R-M 变异表：命令同 R1 步骤 9，每条先断言替换次数，并确认 `git diff --stat` 只有 1 个文件；还原后重跑 25/25。结果：
    - R-M1 红 7 条：U1、U2、U3、U4、U5 / U7、U6、U10。
    - R-M2 红 U2、U10；R-M4 红 U1、U2、U6、U9；R-M5 红 U3、U4、U9。
    - 只红一条的：R-M3（U6）、R-M6（U1）、R-M7（U8）、R-M8 与 R-M9（U9）、R-M10（U10）。
    - R-M11 存活。
  - 既有变异表 M1–M14 在最终树上用 Batch 3 的命令整表重测，红的条数与 Batch 4 的记录逐条一致：
    - M1 5 条，M2 6 条，M3 2 条。
    - 各 1 条：M4、M5、M6a–M6e、M7a、M10。
    - 各 2 条：M7b、M8、M9、M11、M13、M14。
    - M12 在 UTC 下 1 条、在东八区 31 条；M12b 1 条。
    - M9 的红集仍是 SQLite 标签下的载体用例与空串用例，R1-7 的守卫没有改变它。
  - 真 main 带外证据（R1 步骤 7，在仓库外的临时目录里，用 `git archive` 导出 `699d715`、`b0218f1`、`8029a64`，并建三条相对软链）：
    - (a) 等价性：固定 `receivedTime`，真 main 端口与等价写入器各写 `v9`、`…54Z`、`15:11:54+08:00`、无版本四行，`sync_observation` 全列相等。
    - (b) 评审原输入：main 写 `v9` 返回 `true`。`8029a64` 打开时抛 `LegacySourceVersionError`；拒绝前后 sha256 相同，库旁没有多出文件，版本仍为 `1,2,3,4`。main 仍能打开并写入。修复之后，`8029a64` 写 `2026-09-30T00:00:00.000000000Z` 返回 `true`，版本变为 `1,2,3,4,5`；此后 main 打开被前缀断言拒绝。
    - (c) 可归一库：main 写 `…54Z` 与 `+08:00`；`8029a64` 打开时应用 [5]，写更晚的值返回 `true`，写更早的 `…53` 返回 `false`。
    - 对照组：同样的输入换成 `b0218f1`，复现评审的 `true` / `false`；main 写 `…54Z` 之后，`b0218f1` 写 `…54.5` 同样返回 `false`。
    - 并发：6 个进程同时用 `8029a64` 打开混合旧库，全部抛 `legacy_source_version`，sha256 不变；同时打开可归一库，全部成功，005 只记账一次。
    - `Idempotence and Recovery` 档 1 的修复命令在仓库根目录按原文运行：输出降级清单；备份的 `integrity_check` 为 `ok`；之后 `createSqliteStorage` 重开成功。
  - 验证表（最终树 `8029a64`）：
    - 新文件 9/9，三个时区各 9/9；第二行 52 条、第三行 143 条，0 失败。
    - `pnpm run typecheck` 退出 0，`pnpm run boundaries` 7/7；`pnpm verify` 退出 0（786 条加 mvp0 7 条，0 失败）；`node scripts/workflow-check.mjs` 退出 0。
    - `size origin/main` 代码 800 / 1000，文档在上限内；`disclosure origin/main` 无命中，并按 `docs/development/publication.md` 人工过了五个类目；`git diff --check origin/main...HEAD` 无输出。
    - 「明确不改」那一行无输出；`git diff --name-only b0218f1 HEAD -- tests` 只有新文件。
    - `Validation and Acceptance` #5 / #6 / #7 与 Batch 4 的结论相同；`content-placement`、`plan-facts-consistency`、`e1-evidence-consistency` 14 条，0 失败。
    - #17 追加复跑（证据提交之后，树不变）：#3 的 base-src 回放改在当前 base 上做，即 `git restore --source=origin/main`（`699d715`）恢复 `observation.ts`、fake `storage.ts` 与整个 `packages/storage/sqlite`，三个文件 143 条里恰好是 #3 列出的那 10 条失败；#8 的三时区循环跑这三个文件，三次都是 143/143。
- [ ] R1 步骤 11 由 R1-A 在本证据提交之后执行：快进推送、更新 PR 描述、回复 thread 4133390588，新 head 上验证成立后 resolve。结果不写回本计划，以 `gh pr view 240 -R SingularityKChen/harness-projects --json headRefOid,reviewDecision` 与线程回读为准。请人类伙伴复评、#241 在新 head 上变基并另行复评、合并，都留给人类伙伴与主会话。

## Surprises & Discoveries

- **#217 是 issue，没有 PR**：编排任务说「更新计划由 PR 形式的 #217 落地」。实测 `gh pr view 217 -R SingularityKChen/harness-projects` 报 `Could not resolve to a PullRequest`，`gh issue view 217` 返回 OPEN 的 issue。#70 同样还没有 PR。本计划只引用 issue 编号。（其中「#70 还没有 PR」**Superseded by 本节验收批次条目（2026-09-29）**：#70 的 PR 是 #241，base 为本分支。）
- **悬空绑定用例的断言对原因没有判别力**：`storage-contract.test.js:226-229` 与 `suites/storage-execution.js:119` 用 `assert.rejects(promise, '<说明文字>')`。第二个参数是字符串时，Node 把它当作失败说明而不是错误匹配器，任何拒绝都能通过。SQLite 先检查载体、后由外键拒绝（`storage-sync.ts:215` 在 INSERT 之前），fake 先检查绑定（fake `storage.ts:280`）。收窄之后如果夹具仍是 `'v1'`，SQLite 上这两条会因为载体而不是外键通过。本计划把夹具改成规范字面量，并用 M13 证明 fake 侧由绑定检查判红；这类断言整体偏弱的问题登记为技术债务。
- **断言基线的实际范围比设计稿说的小**：`execution` 组基线不含 `storage-execution.js:119`（逐项核对 `storage-contract.test.js:89`），`sharedSyncSuite` 不在基线里。本计划只替换 `sync` 组的一条。
- **`Date` 的两个陷阱**：`Date.UTC` 把 0–99 年映射到 1900 年代；`Date.parse` 对无时区输入按本地时区解析。归一算法因此只用 `setUTCFullYear` 加 UTC 方法，并把「本地时间方法」列为变异 M12。
- **`git checkout -- <file>` 恢复到索引而不是 HEAD**（已完成计划 `docs/exec-plan/completed/2026-09-26-development-suite-capability-driven.md` 的 Surprises 记录）：变异还原一律用 `git checkout HEAD -- <file>`。
- **（验收批次，2026-09-29）必需检查在 UTC 下运行，看不见本地时间方法的回归**：`.github/workflows/ci.yml` 与 `merge-gate.yml` 的 job 都是 `runs-on: ubuntu-latest`。在 UTC 下，`setHours` 与 `setUTCHours` 同值。取验收前（`57e3de7`）的测试应用 M12，在 `TZ=UTC` 下 142/142 全绿。攻击 #1 的防线原本只有人工三时区循环和 M12，都不在必需检查里。处置见 D12：C5 在进程内切换 `process.env.TZ`（Node 在赋值时重读时区，已实测）。
- **（验收批次）偏移分钟的范围检查没有用例承重**（T3 的 P3）：`observation.ts` 的 `offsetMinute > 59` 删掉后，验收前的测试 142/142 全绿；原 M6 一次删掉全部范围检查，掩盖了这一项。处置：C2 追加 `+08:60`，M6 拆成 M6a–M6e 逐项证明。M7 同理拆成 M7a / M7b。
- **（验收批次）M8 / M9 还会让既有的空串用例变红**：`storage-contract.test.js` sharedSync 的「空串不是合法版本载体…」在两个实现上都只由入口断言判红，所以删掉任一 Storage 的断言，都会让该标签下的载体用例与空串用例一起变红（各 2 条）。这是正确行为，原预期漏了它。
- **（验收批次）M12 在东八区红的远比预期多**：只把 `setUTCHours` 换成 `setHours` 后，东八区下规范字面量归一的结果偏移 8 小时，不再是不动点；入口断言因此拒绝所有带版本的观察，三个文件里 31 条变红，不只是 C1。另一方面，「全程改用本地方法」（M12b）在 UTC、东八区下都与原实现同值，只有夏令时空档能区分，所以 C5 用了洛杉矶的 `2026-03-08T02:30:00Z`。
- **（验收批次）`grep -rnE "sourceVersion: 'v[0-9]+'" tests packages` 不是无输出**：它命中 C4 有意构造的拒绝用例 `makeObservation(input({ sourceVersion: 'v1' }))`。Batch 2 验证表已订正。
- **（验收批次）被推翻的 ASCII 载体决策在已完成计划里有四处表述**：`docs/exec-plan/completed/2026-09-23-storage-control-facts.md` 的 `:36`（Batch C 的 Superseded 段）、`:127`（第三轮评审响应 ②）、`:151`（Decision）、`:196`（Bottom Change Note 的 Superseded 段）都写着「非空 ASCII 可打印，不是 ISO-8601」。按 `PLANS.md` §4「就地标注」，四处都追加了 Superseded，否则同一事实会有两处相反的说法。
- **（验收批次）T1 把比较器用例里的 `'～'` 改成了全角波浪号字面量**：它与下文 `isComparableSourceVersion('~')` 的 ASCII 波浪号肉眼无法区分，而且是既有断言的无关改动，已恢复成 base 的转义写法。

以下是 R1 条目。观察时刻 2026-09-30，`origin/main` = `699d715`，PR head = `b0218f1`。复现方法：用 `git archive` 把两个提交的 `packages/domain`、`packages/capabilities`、`packages/storage/sqlite` 导出到仓库外的临时目录，建立 `Plan of Work` R1 步骤 7 里的三条相对软链；再用一次性脚本经各自的 `createSqliteStorage` + `recordObservation` 写同一个库文件。仓库本身没有被改动。

- **（R1）评审反例属实，是本层引入的回归**：
  - main 写 `v9` 返回 `true`；关闭后，`b0218f1` 打开同一文件不报错也不迁移，再写 `2026-09-30T00:00:00.000000000Z` 返回 `false`。被拒的写入前后，文件 sha256 相同；账本只有 `v9` 一行，`schema_migrations` 为 `[1,2,3,4]`。
  - 对照组：main 自己重开后写同一个规范值也返回 `false`。这在 main 的契约下是自洽的，因为 main 的契约就是码点序，而 `'v9' > '2…'`。所以缺陷来自本层：收窄了合法载体，却没有处理已经持久化的旧载体。定级维持 P1。
- **（R1）能无损归一的旧值同样会丢事实，评审没有点到这一类**：
  - main 写 `2026-09-21T07:11:54Z` 后，`b0218f1` 写 `…54.500000000Z` 返回 `false`（`'.' < 'Z'`）。
  - main 写 `2026-09-21T15:11:54+08:00` 后，写真实更晚的 `…07:11:55.000000000Z` 返回 `false`（`'1' > '0'`）。
  - main 写 `abc123sha` 后，写规范值返回 `false`。
  - main 写计数器 `10`、无偏移的 `2026-09-21T07:11:54` 后，写规范值恰好返回 `true`，但账本里仍残留非规范值。

  丢不丢事实取决于首个不同字符，没有规律。所以「只拒绝不可定序值」不够，能归一的值也必须归一。
- **（R1）main 的旧库本身就已经定错了序**：
  - main 依次写入 `…54.500Z`、`…54Z`、`2026-09-21T15:11:53+08:00`，三次都返回 `true`，`committed_observation` 选中 `+08:00` 那一行。它换算成 UTC 是 `07:11:53`，是三者里最早的时刻。
  - main 在 `…07:11:55Z` 之后接受了 `15:11:54+08:00`，已提交快照同样选了更早的时刻。
  - 同一时刻的两种写法只有一种顺序能被 main 都接受：先 `…54.000Z` 后 `…54Z` 两次都是 `true`；反过来，第二次返回 `false`。U4 的夹具因此按前一种顺序构造。
- **（R1）main 上既有的缺陷：拒绝之前库已被改动**：`storage-sync.ts:90` 的旧形状 003 自检在 `migrate()` 之后才运行。取一个 [1,2,3] 的库并退回重写前的形状，用 `b0218f1` 打开：库被拒绝，但 `schema_migrations` 已经从 `1,2,3` 变成 `1,2,3,4`，文件 sha256 也变了。R1-6 让它在任何迁移之前被拒绝。
- **（R1）只读原型（临时目录，不进仓库）验证了方案**：
  - `v9` 库被拒绝，文件 sha256 不变；之后 main 仍能打开它并写入。
  - 可归一的库应用 [5]：已提交快照被纠正，后续写入按时间序返回 `true` / `false`。
  - main 打开 [1..5] 的库时报「数据库已应用版本与迁移清单不一致：库为 [1, 2, 3, 4, 5]，清单为 [1, 2, 3, 4]」。
  - 含 `v9` 的 [1,2,3] 库在 004 之前就被拒绝，文件 sha256 不变。
  - 修复原型：`VACUUM INTO` 的备份 `integrity_check` 为 `ok`，各表行数相等；降为无版本之后写规范值返回 `true`；备份路径已存在时被拒绝；逆向 SQL `coalesce(json_extract(snapshot_json, '$.observation.sourceVersion'), '')` 逐行还原出迁移前的 `updated_at`。
- **（R1）`node:sqlite` 的几项实测（Node v26.10.0）**：
  - `exec` 接受只含注释的 SQL。
  - `VACUUM INTO ?` 可以用参数绑定路径，含单引号的路径也行；目标已存在时报 `output file already exists`。
  - 只读的 `BEGIN IMMEDIATE` / `ROLLBACK` 不改变文件 sha256。
  - `git restore --source=<ref> -- <目录>` 默认是 no-overlay，会删掉源提交里不存在的已跟踪文件（在仓库外的临时克隆里实测）。
- **（R1）本计划自己的两处结论被评审推翻**：
  - `Global Constraints` 的「MMP 前不做兼容层与迁移……删库重建」，以及 `Idempotence and Recovery` 的「本地开发库」「合并后回滚」两条。三处都已原地标注 Superseded。
  - 另外，那一条里写的 `REWRITTEN_003_MESSAGE` 行号 `storage-sync.ts:58` 已过时，实际在 `:60`。
- **（R1）栈与编号**：
  - #241 自己的两个提交（`b03cbd0`、`12e80c5`）不碰 `packages/storage/sqlite`，回读命令 `git diff --stat 63c7bc3..origin/feature/github-projects-read`。
  - 所有远端分支都没有 `005_` 迁移文件，回读方法是用 `git ls-tree -r --name-only <ref> -- packages/storage/sqlite/migrations` 遍历 `refs/remotes/origin`。
  - 发布前更新计划（PR #239，分支 `docs/system-architecture-renewal`；计划文件在本分支不存在，所以只写编号）的 Batch 5（#223）已写明：如果新增了 005，也把它一起压进单一基线。
- **（R1）评审发生在变基之前**：评审 5352511875 提交于 `63c7bc3`；inline comment 4133390588 现挂在 `b0218f1` 的 `storage-sync.ts:217`，即入口断言那一行。
- **（R1 验收）开发提交的代码量是 888，超过 800 的弹性上限**：新测试文件 361 行，新模块 171 行。验收按 `Global Constraints` 的压缩顺序处理。先合并测试辅助函数：指纹复用整库内容快照，`withDb` 取代各处手写的开关句柄。再把钉住型的 U5 与 U7 合成一条。U1–U4、U6、U8–U10 保留，断言只加强不放宽（U6 与 U8 改用整库指纹或整列比对）。代码降到 800 / 1000，新文件的用例数从 10 变为 9。
- **（R1 验收）备份核对没有用例承重**：删掉 `verifyBackup` 的调用（R-M11）后 25 条全绿。单进程用例无法在 `VACUUM INTO` 与写锁之间插入写入，也造不出损坏的备份，所以如实记为防御性检查，不为它写依赖时序的用例。
- **（R1 验收）`VACUUM INTO` 不能在事务里执行**：`node:sqlite` 实测报 `cannot VACUUM from within a transaction`。备份只能放在 `BEGIN IMMEDIATE` 之前；验收把核对挪到写锁之内（D18）。
- **（R1 验收）两处实现偏差**：
  - 修复函数在库文件不存在时拒绝，否则 `openDatabase` 会建一个空库。计划的步骤里没有这一条。
  - 构造函数的旧形状检查改为无条件调用 `assertRewritten003Shape`，原先还要求版本 3 已应用。`sync_observation` 只在 003 之后存在，二者等价；既有的 003 自检用例不改即绿。

## Decision Log

- **D20 · 最终提交粒度**：全部运行时载体行为、迁移与恢复及其测试作为一个可回滚交付物；计划归档、索引与 #203 的 R1 映射另列一笔文档提交。历史开发/补证提交由本地恢复锚点保留，最终 PR 不保留临时或修补序列。共享历史重写后核对整树，精确 lease 推送，先解决线程再重新取得当前 head 的 reviewer 批准。
  Date/Author：2026-09-30 / 执行者，依据人类本轮整理要求。

- **D19 · R2 与收尾**：人类明确要求修复、整合并 rebase merge。保持每条迁移的原子性，通过 phase 与 appliedVersions 如实报告部分升级；U11 验证整个序列。原“整库零改动”承诺在原处标取代。关闭 #203 时同步新矩阵的 R1 第 8 行与对应控制计划记录，本文完成后归档；#241 需保存恢复锚点并在新的父提交 / main 上重新锁定。
  Date/Author：2026-09-30 / 人类伙伴与执行者。

- **D0 · 流程**：多个独立子 agent 分别设计 → 独立评审定稿写 ExecPlan → draft PR 关联 issue → Sonnet 在各自的工作树里并行 TDD 与对抗验证 → Opus 验收重构 → 请人类评审 PR。
  Rationale：设计阶段的独立性用来暴露单一视角的盲区；开发阶段按写入区域互不重叠的任务并行；验收与合并决定留给人。
  Date/Author：2026-09-29 / 人类伙伴指定（来源：本轮编排任务转述人类伙伴的指令，待人类在 PR 上确认）。
- **D1 · 交付形态**：#203 单独作为 #70 的 2 层栈底交付，不与 #189 / #198 一起按更新计划的 Batch 2C 交付；本计划用 issue / PR 编号引用更新计划（#217），不写路径。
  Rationale：#70 是第一个设置观察版本的真实 provider，载体规则必须先于它合并；#189 / #198 与 #70 没有依赖关系。
  Date/Author：2026-09-29 / 人类伙伴决定（来源同 D0）。
- **D2 · 收窄载体集合，不做载体感知比较器**：唯一合法载体是规范 UTC 纳秒时间戳；归一责任在 provider；capabilities 提供唯一的归一函数与入口断言；比较器、DDL、视图不变。它推翻了已完成计划 `docs/exec-plan/completed/2026-09-23-storage-control-facts.md:151` 的「校验取非空 ASCII 可打印、放弃 ISO-8601 方案」：那条决策的理由是 development 域把 sha 当 `sourceVersion`，而 sha 所在的是变更请求读模型（`ProviderChangeRequest.sourceVersion`，谱系只做相等比较），今天没有任何路径把它写成观察的 `sourceVersion`（#198 正文：没有生产路径入队 development 观察）；按 `PLANS.md` §4 在原处标注 Superseded（Batch 4；已执行，实际为四处，见 `Surprises & Discoveries`）。
  Rationale：见 `Design / Spec` 的规则与被放弃的方案。关键在于：同一事实只有一份表示，不产生派生列；SQLite 与 JS 的等价由定宽 ASCII 构造性保证；代码量约为序键方案的 70%。
  Date/Author：2026-09-29 / 独立评审定稿者。
- **D3 · 对三份设计的评审结论（P0–P3）**：没有 P0。P1：设计 3 的毫秒截断会把不同版本变成相等，按 R4 ② 触发旧快照替换新快照；设计 3 的归一失败返回 `undefined` 会让丢数据挪到上层（它自己的风险表也承认）；设计 2 的序键列形成同一事实的第二份表示，并改动 003 的 DDL、自检、集成测试与回滚路径。P2：设计 1 的计数器载体没有使用者，却要求跨种类比较规则；设计 1 把比较器改成部分函数（域校验后用 `<`），会让 M8 / M9 类变异被部分掩盖；设计 2 的十进制计数去前导零后 `007` 与 `7` 相等，全数字短 sha 会被当作计数。P3：设计 3 误称执行组基线含 `storage-execution.js:119`；设计 1 与设计 2 计划改 `execution-relation-write-schema.test.js` 的裸 SQL，但 DDL 不约束载体，没有必要；设计 1 在代码提交正文写关闭关键字：提交正文里的关闭关键字进 `main` 时同样会关闭 issue，与 D8「关闭只由 PR 描述决定」冲突。
  Date/Author：2026-09-29 / 独立评审定稿者。
- **D4 · 纳秒、无损、超出即拒绝**：固定 9 位小数；超过 9 位抛错，不截断。
  Rationale：规则 3（截断等于制造相等，相等即整快照替换）。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（开放问题 H2）。
- **D5 · 不保留计数器载体**：见被放弃的方案。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（开放问题 H1）。
- **D6 · 归一失败抛 `RangeError`；入口断言在 `makeObservation` 与两个 Storage 共用一个函数**。
  Rationale：见规则 4、5 与被放弃的方案。失败模式与 base 上非 ASCII 被拒时相同：裸异常，core 同步事务整笔回滚，结构化失败由 #199 承接。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（开放问题 H3）。
- **D7 · 测试放置**：改写 `storage-sync.js` 既有的载体用例，并在 `storage-sync.js` 新增一条 `register`，同步 `CASE_LEDGER.sync.added` 与 `ADDED_CASE_COUNT`，不借道 `sharedSyncSuite` 回避条数账；断言基线只替换 `'v1'` 那一条。存储套件的拒绝用例使用字面量，不依赖归一函数，base-src 回放时文件仍可加载；只有新定序用例经 `cap.` 调用归一函数，验证「provider 归一 → storage 定序」这一组合。
  Date/Author：2026-09-29 / 独立评审定稿者。
- **D8 · 提交与关闭**：最终 3 个提交（计划 → 实现加测试 → 证据）；T1 与 T2 合成一个实现提交，使每个提交单独为绿；提交正文只写 `Refs #203`，关闭关键字只写在 PR 描述里，以 `gh pr view <n> --json closingIssuesReferences` 回读。**Superseded by D11（2026-09-29）**：最终为 4 个提交，验收修复与证据只追加、不合并进前两个提交。
  Date/Author：2026-09-29 / 独立评审定稿者。
- **D9 · 不写 ADR**：载体规则是契约层的可逆决定（MMP 前改载体没有兼容成本），由本 Decision Log、契约注释与已完成计划的 Superseded 标注承载。
  Date/Author：2026-09-29 / 独立评审定稿者；待人类确认（开放问题 H6）。
- **D10 · 栈底定位与一处来源订正**：人类伙伴在 2026-09-29 决定 #203 单独作为 #70 的栈底（D0 / D1 的「待人类在 PR 上确认」就栈底定位这一点已确认；来源是主会话转述人类伙伴的指令）。人类伙伴同日说的「G1 和 G2 按最佳方式选择」针对的是 #119 的两道闸门，与本计划 `Interfaces and Dependencies` 里 Storage 对调用方的保证 G1–G4 无关，也不构成对开放问题 H1–H6 的裁决；如有子任务报告把它当成本计划的决定，以本条为准。H1–H6 仍待人类伙伴裁决。
  Date/Author：2026-09-29 / T4 验收者（据主会话转述记录）。
- **D11 · 验收阶段只追加提交**：上层 PR #241 已经以 `57e3de7` 为基变基并在其上开发，所以不改写 `ae8715c` 与 `57e3de7`。验收修复与证据作为两个新提交追加（`test(capabilities)` 与 `docs(exec-plan)`），推送是快进。D8 的「3 个提交」因此变成 4 个；每个提交单独为绿的要求不变，已逐个检出验证（见 `Progress`）。上层需要在本分支的新 head 上再变基一次，由主会话安排。
  Rationale：改写已被上层当作基底的提交，会让 #241 的历史与本分支分叉；追加提交的代价只是多一个提交。
  Date/Author：2026-09-29 / 主会话的编排约束，T4 验收者执行。
- **D12 · 验收补强只加测试，不改行为**：C2 追加 `+08:60`；新增 C5，在进程内切换 `process.env.TZ`，覆盖 `UTC`、`Asia/Shanghai`、`America/Los_Angeles`，并含洛杉矶夏令时空档的输入；比较器用例恢复 `'\uff5e'` 转义；`observation.ts` 只订正一句注释（`54.500Z` 不是「秒级」）。放弃的方案是在 CI 里加一个带 `TZ` 矩阵的 job：那要改 workflow，并同步 W1–W7 规则、契约测试与 `docs/development/ci.md`，而且只有这一个文件需要它。
  Rationale：「与进程时区无关」是接口契约里的一句承诺（`sourceVersionFromTimestamp` 的注释），但必需检查在 UTC 下运行，原先的防线都不在必需检查里。
  Date/Author：2026-09-29 / T4 验收者。
- **D13 · 评审 5352511875 的处置（R1）**：评审的要求优先于本计划「MMP 前不做兼容层与迁移、删库重建」的约束，也优先于仓库「MMP 前不写兼容层」的约定。评审要求能无损迁移就迁移，不能就明确拒绝并提供保留数据的恢复路径，另加跨版本重开回归。依据是 `AGENTS.md` §5：用户指令优先于仓库约定，而评审账号代表人类伙伴。被推翻的三处已原地标注 Superseded。 **Superseded by D19**：reviewer 身份本身不能代替人类授权；本轮修复、历史整理与合并的授权来自 2026-09-30 用户的明确指令。
  - 方案（`Design / Spec` 的 R1 增补）：
    - 版本化的纯数据迁移 005 归一可归一的旧值。
    - 迁移前做只读预检：遇到不可定序的值，整库拒绝且零改动。
    - 显式修复函数：先备份并核对，再把不可定序的行降为无版本。
    - `recordObservation` 遇到非规范的已提交版本时响亮失败。
  - 取舍：
    - 主体取设计 1（迁移优先）。
    - 从设计 3 嫁接：锚点行守卫；降为无版本的变换，但只放进显式修复；逆向 SQL；「main 等价写入器加真 main 对照」。
    - 从设计 2 嫁接：错误对象的形状（显式字段、带恢复文本）；「预检移到迁移之后」的判别夹具（U2）与 fd 断言；热日志说明。
  Rationale：
  - 能归一的旧值有唯一的无损目标，即 capabilities 的归一函数。迁移它们满足评审的第一条出路，还顺带纠正了 main 已经定错的序。不可定序的值没有无损目标，由人决定，先备份再修。
  - `schema_migrations` 的 5 同时解决「只扫一次」和「挡住降级写入」两件事。它不需要每次打开都扫全表，也不和 #223 争第二个世代事实源。
  Date/Author：2026-09-30 / 独立评审定稿者（R1）；待人类伙伴在 PR 上确认。
- **D14 · 对三份 R1 设计的评审结论（P0–P3）**：三份设计都没有 P0。
  - **设计 2（拒绝优先）**
    - P1：连能无损归一的库也拒绝，违背评审的第一条出路。
    - P1：恢复路径是新建空库，本地独有的事实只留在备份里、回不到产品中，实质是「删库重建加一份备份」。
    - P2：每次打开都 O(n) 全表扫描，也没有世代标记；旧二进制仍能往已接受的库里写旧载体，下次打开又被拒绝。
    - P3：它称把预检放进 `migrate()` 会误伤 `execution-relation-write-schema` 的裸 SQL 用例，事实不成立。
    - P3：删掉构造函数的自检后，判定只剩一个调用点。
  - **设计 3（系统视角）**
    - P1：打开库时自动把 `v9`、sha、计数器、无偏移时间戳降为无版本。这是没有人看到、也没有备份的有损定序变换（例：main 选中的 `v10` 行会输给一条规范行），与评审「无法无损迁移时明确拒绝」相冲突；它自己也把这一点列为开放问题。
    - P2：新增了「版本列与原样快照不一致即拒绝」这种拒绝模式，处置却只有手写 SQL 指引，没有经过测试的工具。
    - P2：变换在 005 的事务里执行，[1,2,3] 的库上 004 会先于它被应用，所以它在这类库上的拒绝不是零改动。
    - P3：锚点行守卫、逆向 SQL、真 main 对照这三点是好的，已采纳。
  - **设计 1（迁移优先）**
    - P2：修复函数删除不可定序的行，活库会丢掉这些行和去重历史。已改为降为无版本（H7）。
    - P2：没有锚点行守卫，005 之后混入的旧载体仍会静默返回 `false`。已补 R1-7。
    - P2：修复函数拒绝已迁移到 5 的库，守卫触发之后就没有恢复路径。已改为不看版本。
    - P3：计划在 003 里加一句指向 005 的注释，但 D8 的出处 token 用例逐行扫描 003，为一句指针冒险不值得。不改。
  Date/Author：2026-09-30 / 独立评审定稿者（R1）。
- **D15 · 修复时把不可定序的行降为无版本，不删除**（R1-5）。
  Rationale：
  - 两种做法都让之后的规范观察胜出。降为无版本还把行、去重历史和原始载体（在 `snapshot_json` 里）都留在活库，逆向 SQL 能逐行还原。
  - 删除之后，这些信息只剩在备份里。
  - 被降级行之间的次序确实丢了，所以只在人明确调用、并且备份已核对之后发生。
  Date/Author：2026-09-30 / 独立评审定稿者（R1）；待人类确认（H7）。
- **D16 · 旧形状 003 的检查随预检前移，文案不改**（R1-6）。
  Rationale：
  - 005 不能改写一张随后会被拒绝的表，而预检是唯一早于所有迁移的判定点，所以检查必须前移。
  - 这顺带修掉了 main 上既有的「拒绝前已应用 004」。
  - `REWRITTEN_003_MESSAGE` 的「请删除库文件重建」是 main 上既有的文案，要改就一起改它的处置路径，归 #223 或另议（H9）。
  Date/Author：2026-09-30 / 独立评审定稿者（R1）；范围待人类确认（H9）。
- **D17 · 跨版本回归用「main 等价写入器」，不在 CI 里跑旧代码**。
  Rationale：
  - CI 是浅克隆，合并后 `origin/main` 就等于本 head，依赖 git 历史的用例会无声失效。
  - 二进制夹具不透明。
  - 等价写入器与真 main 的一致性，由 R1 步骤 7 的一次性逐列对照证明，证据写进 `Progress`。
  Date/Author：2026-09-30 / 独立评审定稿者（R1）。
- **D18 · R1 验收的复评与重构**：行为不变，验证表与变异表都在重构后的树上整表重跑。
  - 测试按 `Global Constraints` 的顺序压缩：合并辅助函数，U5 与 U7 合成一条。U6 改用 `MIGRATIONS.find((entry) => entry.version === 5)`，以后追加 006 时不会失效。
  - 备份核对挪进 `BEGIN IMMEDIATE`。`VACUUM INTO` 之后若有并发插入或删除，行数不等即整笔回滚；核对之后到提交之前不会再有别的写入。原先核对在事务之外，核对与加锁之间还有一个窗口。
  - `assertRewritten003Shape` 返回表是否存在，`classifyCarriers` 不再重复查询 `sqlite_master`。
  - R-M11 存活，记为防御性（见 Surprises）。
  - H7–H11 仍待人类伙伴裁决，实现按推荐执行：降为无版本（H7）；快照不改（H8）；旧形状检查随预检前移，文案不改（H9）；只导出函数（H11）。
  Rationale：规模的弹性上限要求在不删判别性用例的前提下压缩；把核对放进写锁是零行数代价的加固。
  Date/Author：2026-09-30 / R1 验收者（Opus）。
- **开放问题（待人类伙伴裁决；裁决前按推荐执行，裁决写回本节）**：
  - H1 载体集合：推荐只有规范 UTC 纳秒时间戳；备选是再加 20 位零填充计数器。
  - H2 精度：推荐 9 位纳秒；备选是 3 位毫秒（等于 `toISOString`，会截断更高精度的来源）。
  - H3 在 #199 落地前，provider 缺陷导致的非规范载体会让整次同步以裸异常失败（不是 degraded）。推荐接受：这是响亮失败，不是静默丢数据。
  - H4 GitHub 同秒碰撞让「相等即整快照替换」可能接受晚到的旧快照；`observed_at` 同版本时按 `receivedTime` 字节序决胜，也有变精度风险。并入 #201，还是另开 issue？
  - H5 本 PR 合并后，#198 收窄还是关闭：sha 从此进不了观察账本，但 #198 的验收要求 development provider 的版本可定序。
  - H6 是否需要 ADR：推荐不需要。
  - H7（R1）修复时如何处理不可定序的行。推荐降为无版本：行与去重历史留在活库，原值仍在 `snapshot_json` 与备份里。备选是删除：活库账本只剩可定序的行，原件只在备份里。
  - H8（R1）归一时是否同步改写 `snapshot_json.observation.sourceVersion`。推荐不改：保留原始载体作为审计证据，两者的关系由 R1-3 的不变量约束；改写会违背「storage 不改写快照」。
  - H9（R1）范围问题有两个。其一，旧形状 003 的检查随预检前移（顺带修掉 main 上「拒绝前已应用 004」）是否纳入本 PR：推荐纳入，因为 005 自身的零改动依赖它。其二，`REWRITTEN_003_MESSAGE` 仍写「请删除库文件重建」，与本次保留数据的原则不一致：推荐留给 #223 一并改写（TD8），也可以在本 PR 里改成指向备份流程。
  - H10（R1）#223 的单一基线是否沿用 R1 的原则，即能无损迁移就迁移，否则零改动拒绝并提供先备份的修复，以此取代其计划里的「旧库需备份并重建」。另外，`updated_at` 的库级形状 CHECK 是否归 #223：推荐归 #223（TD9）。
  - H11（R1）修复入口的形式。推荐只导出函数，并在 `Idempotence and Recovery` 里给出可复制的 `node` 命令，#223 落地时一并删除；备选是在 `scripts/` 里加一个 CLI。

## Idempotence and Recovery

- 全部测试可重复执行：SQLite 用例在临时目录建库并在 `after` 里删除；不触网、不需要凭据。
- 变异与 base-src 回放可重复：每次都以 `git checkout HEAD -- <file>` 还原并用 `git diff --quiet` 确认；在独立的 T3 工作树里做，不影响 T1 / T2 / T4 的工作区。验收批次的整表重测在 T4 工作树里串行进行：每条变异应用前先断言 `git diff --quiet`，工作区不干净就拒绝应用。
- 会话中断：各任务在自己的工作树里随时做本地 WIP 提交，工作不放在 scratchpad。恢复时读本计划的 `Progress`，再用 `git log --oneline origin/main..<分支>` 回读进度。
- 已知良好状态：`origin/main`（观察时刻为 `f6a33d2`，用 `git rev-parse origin/main` 回读）。整理提交前先建 `backup/source-version-order-<日期>` ref（验收批次只追加提交、不改写历史，不需要它，见 D11）。
- 本地开发库：比较器是全函数，所以旧库里若残留 `'v9'` 这类非规范 `updated_at` 行，不会抛错，但会让规范的新观察被判成更旧。今天没有生产路径写过观察版本，测试库都是临时目录；MMP 前的处置是删除库文件重建，与 `REWRITTEN_003_MESSAGE`（`storage-sync.ts:58`）的先例一致。**Superseded by 本节的 R1 条目（2026-09-30）**：评审 5352511875 否定了删库这一处置；另外，`REWRITTEN_003_MESSAGE` 实际在 `storage-sync.ts:60`。
- 合并后回滚：由人类伙伴发起 PR，`git revert` 实现提交与验收批次的 `test(capabilities)` 提交；后者的 C5 调用实现导出的函数，只回滚实现会让它变红，所以要先回滚它或一起回滚。证据提交与计划提交可以一并 revert。没有 DDL 或数据迁移，库不需要处理（**Superseded by 本节的 R1 条目（2026-09-30）**：R1 增加了纯数据迁移 005，回滚后已迁移的库需要处理）。如果 #70 已经以本分支为 base 或已合并，要先让 #70 去掉对 `sourceVersionFromTimestamp` 的调用（回滚后它会编译失败，失败是可见的），或者先回滚 #70。
- **（R1）测试与原型可重复**：新用例都在临时目录建库并在结束时删除；真 main 带外证据在仓库外的临时目录里做，不改仓库。
- **（R1）运行期被拒绝的库**（`LegacySourceVersionError`）分三档：
  - **档 0（默认）**：什么也不做。库文件逐字节不变，`schema_migrations` 保持原样，本修复之前的版本仍可打开并继续使用它。拒绝路径的「逐字节不变」有一个驱动层例外：库旁如果有热日志 `<库文件>-journal`，SQLite 首次读取时会自动回滚它。
  - **档 1（推荐）**：显式修复，保留全部行。
    1. 停掉所有打开该库的进程。如果有热日志，先用任一版本正常打开一次，让 SQLite 回滚它。
    2. 在检出含 R1 的 `fix/source-version-order`（或合并后的 `main`）的仓库根目录运行下面的命令。`<库文件>` 与 `<备份文件>` 写绝对路径；`<备份文件>` 必须不存在，而且不要放在同步盘或公开目录里。

       ```sh
       node --input-type=module -e "import { repairLegacySourceVersions } from '@harness-projects/storage-sqlite'; console.log(JSON.stringify(repairLegacySourceVersions(process.argv[1], { backupPath: process.argv[2] }), null, 1))" <库文件> <备份文件>
       ```

    3. 输出里的 `demoted` 列出被降为无版本的行。重新打开库时 005 会自动应用，然后对清单里的绑定触发一次全量对账。
    4. 核对：备份文件存在，并且 `node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync(process.argv[1],{readOnly:true}).prepare('PRAGMA integrity_check').get().integrity_check)" <备份文件>` 输出 `ok`。
  - **档 2**：只有人类伙伴判定这个库可以重建时才删库。它不是推荐路径。
- **（R1）守卫触发**（`LEGACY_COMMITTED_VERSION_MESSAGE`）：说明 005 之后仍有旧载体进入账本。先停掉旧版本进程，再运行档 1 的同一条命令（修复函数不要求版本 5 未应用），然后重开。
- **（R1）合并后回滚**：
  - revert R1 的实现提交后，已迁移到 5 的库会被旧代码的前缀断言显式拒绝。
  - 恢复：先备份，再执行 `DELETE FROM schema_migrations WHERE version = 5`。005 不改 DDL，归一值与 `''` 都能被旧代码接受。
  - 如果要连同整个 PR 一起回到 main，并且需要账本精确回到迁移前，就在同一事务里先执行逆向 SQL `UPDATE sync_observation SET updated_at = coalesce(json_extract(snapshot_json, '$.observation.sourceVersion'), '')`（U9 第 7 项证明它能逐行还原）。只回滚 R1、留在 `b0218f1` 时**不要**执行逆向：它会把 `v9` 这类值带回来，而那正是评审指出的缺陷。
  - #241 以本分支为基，回滚本 PR 之前先回滚 #241，或者先去掉它对本层导出的依赖。#241 以后如果需要迁移，从 006 开始编号。
- **（R1）实现期中断**：R1-D 在自己的工作树里随时做本地 WIP 提交。恢复时先读本计划的 `Progress`，再用 `git log --oneline fix/source-version-order..fix/source-version-order-r1` 回读进度。已知良好状态是 `origin/fix/source-version-order`（R1 开始时为 `b0218f1`，锚点 `backup/source-version-order-r1-pre`）。订正：实际没有 `fix/source-version-order-r1` 分支；开发的 WIP 头 `c85fb59` 留在本地锚点 `backup/source-version-order-r1-wip`，验收把它与验收改动合成 `8029a64`。
- 工作树与临时分支（`fix/source-version-order-cap`、`fix/source-version-order-storage`、分离工作树 `source-version-order-verify`）只在本地，不推送；清理交给 `git-expert-operations` 流程，路径先规范化为 realpath 并核对允许根目录（`AGENTS.md` §7）。

## Interfaces and Dependencies

### 本层对上下游的接口契约（capabilities，`packages/capabilities/src/observation.ts`）

```ts
/** RFC 3339 date-time → 规范载体 `YYYY-MM-DDTHH:MM:SS.fffffffffZ`（UTC、9 位小数、年份 0000–9999）。
 *  缺偏移、非法日历、闰秒、偏移越界、超过 9 位小数、结果年份越界、非时间戳：抛 RangeError。与进程时区无关。 */
export function sourceVersionFromTimestamp(timestamp: string): string
/** 端口接受的载体 ⇔ 规范载体（等价于 sourceVersionFromTimestamp 的不动点）。不抛错。 */
export function isComparableSourceVersion(value: string): boolean
/** undefined 放行；其余非规范载体抛 RangeError，文案含「规范载体」与「ASCII」。 */
export function assertComparableSourceVersion(value: string | undefined): void
/** 签名与实现不变：码点序，undefined 最小；在规范载体上码点序 = UTF-8 字节序 = 时间序。 */
export function compareSourceVersion(left: string | undefined, right: string | undefined): number
/** 对 input.sourceVersion 调用 assertComparableSourceVersion，其余不变。 */
export function makeObservation(input: ProviderObservationInput): ProviderObservation
```

**对 provider（含上层 #70）的义务**：

- O1 观察的 `sourceVersion` 取 `sourceVersionFromTimestamp(被观察对象的平台更新时间)`，或者取 `undefined`（平台没有可定序的版本）。不得传入平台原值。
- O2 归一抛错时，provider 报结构化 `ProviderError`，不得改填 `undefined`：`undefined` 是最小值，在已提交的有版本观察面前会被静默拒绝。
- O3 同一 `(binding, objectKind, externalId)` 不混用有版本与无版本的观察。
- O4 `receivedTime` 用定宽 UTC 写法（推荐 `new Date().toISOString()`）且按发出顺序不减。本层不强制，它是同版本时 SQLite 的字节序决胜键。
- O5 `ProviderPlanningItem.sourceVersion`（乐观并发）与 `ProviderChangeRequest.sourceVersion`（谱系）只做相等比较，不受本规则约束，可以存放平台原值。

**Storage 对调用方的保证**：

- G1 非规范载体：两个实现都在任何写入之前抛错，账本不留行；调用方事务回滚（结构化失败由 #199 承接）。
- G2 规范载体：更新的返回 `true`；更旧的返回 `false`；同版本不同 `dedupeKey` 返回 `true`（R4 ② 整快照替换）；同一 `dedupeKey` 重投返回 `false`。`sourceVersion` 不参与去重键（`observation.ts:47-55`），分页重复读不改变计数。
- G3 fake 与 SQLite 对同一输入给出同一答案，由共享契约套件钉住。
- G4 `committed_observation` 视图与 `compareSourceVersion` 在规范域上同判据。

### R1 新增的接口（`@harness-projects/storage-sqlite`，只在本包内，不进 capabilities）

```ts
export class LegacySourceVersionError extends Error {
  readonly code: 'legacy_source_version'; readonly unorderableRows: number
  readonly samples: readonly { bindingId: string; objectKind: string; externalId: string; updatedAt: string }[]
  readonly phase: 'preflight' | 'migration'; readonly appliedVersions: readonly number[]
}
export interface LegacyRepairResult {
  readonly backupPath: string | undefined; readonly normalized: number
  readonly demoted: readonly { bindingId: string; objectKind: string; externalId: string; dedupeKey: string; updatedAt: string }[]
}
export function repairLegacySourceVersions(location: string, options: { readonly backupPath: string }): LegacyRepairResult
export const LEGACY_COMMITTED_VERSION_MESSAGE: string
export interface MigrationDataStep { preflight(db: WorkspaceDatabase): void; apply(db: WorkspaceDatabase): void }
export interface Migration { readonly version: number; readonly file: string; readonly data?: MigrationDataStep }
```

`LegacySourceVersionError` 是适配器的打开错误，不是端口级的结构化失败（后者归 #199）。宿主将来接入 SQLite 时，要把它映射成启动期的结构化失败并展示处置（TD7）。

**SQLite Storage 追加的保证（R1）**：

- G5 `createSqliteStorage` 返回之前，旧库只有两种结局：已经迁移进定义域（版本 5 已记账），或者抛出 `LegacySourceVersionError` 且库文件逐字节不变（也不应用更早的待应用迁移）。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。
- G6 迁移到 5 的库拒绝被清单只到 4 的二进制打开（前缀断言）。
- G7 `recordObservation` 遇到非规范的已提交版本时抛 `LEGACY_COMMITTED_VERSION_MESSAGE`，不返回 `false`。内存替身上这种状态不可达。
- G8 `repairLegacySourceVersions` 不覆盖已有文件；库文件不存在时拒绝，不创建空库；备份核对在写锁之内，通过之前不改原库；只改非规范行的 `updated_at`；对已经在定义域内的库什么也不做。

### 工具、仓库与命名

- Node：`package.json` 的 `engines` 为 `>=22.0.0`；定稿时实测版本为 v26.10.0。pnpm 10.28.2（`packageManager`）。测试只用 `node:test`。
- GitHub：仓库 `SingularityKChen/harness-projects`，`gh` 命令一律带 `-R`。不需要任何凭据进入仓库。
- 标签：`kind:fix`、`area:capabilities`、`area:storage`（`node scripts/policy-check.mjs areas` 列出的合法 area）。
- 分支：工作分支 `fix/source-version-order`；任务分支 `fix/source-version-order-cap`、`fix/source-version-order-storage`（仅本地）。
- 关联：`Closes #203` 只出现在 PR 描述里，回读 `gh pr view <n> -R SingularityKChen/harness-projects --json closingIssuesReferences`；`Refs #70`、`Refs #198`、`Refs #217`。

## Outcomes & Retrospective

**最终收尾（2026-09-30）**：R2 的完整迁移交错先红后绿；预检拒绝保留原文件，事务内拒绝如实报告 phase 与已提交版本。全量 787/787 + MVP-0 7/7；#203 端口反例从反例改为部分（缺 core 乱序注入），历史探针保留并标取代。运行时行为与测试作为一笔交付提交，计划归档及矩阵更新单列文档提交。旧开发八提交为历史，最终序列与恢复锚点在 PR 描述回读；后续技术债继续由 #223 等 issue 承担。

**实际结果（2026-09-29，PR #240 仍是 draft，待人类评审）**

- 观察的 `sourceVersion` 只接受规范载体。`sourceVersionFromTimestamp`、`assertComparableSourceVersion` 与不动点谓词在 `packages/capabilities/src/observation.ts` 各只有一份；`makeObservation` 与两个 Storage 的 `recordObservation` 都在任何写入之前调用同一个断言。比较器、SQLite DDL 与 `committed_observation` 视图没有改。
- #203 的反例经归一后，在 fake 与 SQLite 上都按时间序定序；未归一的值在两个实现的入口被拒绝，且不留行。`Validation and Acceptance` #1–#11 的证据见 `Progress` 的 Batch 4 验收条目。

**复评：评审者会怎么打破它（验收批次逐条复核）**

- `Design / Spec` 预判表的 17 条攻击逐条对照了用例与变异。其中两条的防线原先不在必需检查里：#1（时区）只靠人工循环，#4（范围检查）里的偏移分钟没有用例。两条都已补上（D12）。
- 预判表以外又试了几种输入，都被正确处理：带首尾换行的串被拒绝（JS 的 `$` 不带 `m` 标志时只匹配串尾）；逗号小数、带符号的六位年份、一位数的月份被拒绝；`null`、数字，以及 `toString` 返回规范串的对象，都被入口断言拒绝（不动点比较用 `===`）；`0000-01-01T00:00:00.000000000Z` 与 `9999-12-31T23:59:59.999999999Z` 是合法的边界值。
- 回滚路径订正：验收提交的 C5 依赖实现导出的函数，revert 时要与实现提交一起回滚（见 `Idempotence and Recovery`）。

**与计划的偏差**

- 提交数从 3 个变成 4 个（D11）；变异表拆出 M6a–M6e 与 M7a / M7b，并追加 M12b 与 M14；base-src 回放从 9 条变成 10 条（追加了 C5）；M8 / M9 / M12 与一条 grep 的预期已按实测订正（原预期保留在括号里）；已完成计划的 Superseded 标注从一处变成四处。
- 没有执行 `gh pr ready`、评审请求与合并，按编排指令留给人类伙伴。

**遗留**：开放问题 H1–H6 待人类伙伴裁决（D10）；上层 #241 需要在本分支新的 head 上再变基一次（D11）；技术债务 TD1–TD6 如下，本批次没有新增。（2026-09-30 追加：评审 5352511875 的阻塞项由评审响应 R1 处理，已规划，实现与验收尚未开始，见 `Progress`；新增开放问题 H7–H11 与技术债务 TD7–TD10。）

**R1 实际结果（2026-09-30，实现提交 `8029a64`）**

- 旧库重开时，已持久化的非规范载体在任何业务写入之前被处理。可归一的由 005 在事务内归一；不可定序的在任何迁移之前整库拒绝，库文件逐字节不变；修复函数先备份，在写锁内核对之后，再把不可定序的行降为无版本。005 之后混进来的旧载体在 `recordObservation` 响亮失败。 **Superseded by R2（2026-09-30）**：整库零改动仅适用于迁移前预检拒绝；预检后的并发旧写入在事务内被拒绝时，先前已提交版本仍保留，错误必须报告阶段与已提交版本。
- 评审的原反例：修复前静默返回 `false`；修复后打开即被拒绝并给出恢复入口，修复之后返回 `true`。证据是真 main 带外对照与 U1、U9。
- 与计划的偏差：用例从 10 条合成 9 条；R-M1 多红 U5 / U7；追加 R-M11（存活，防御性）；备份核对挪进写锁；修复函数拒绝不存在的库文件；没有建 R1-D 工作树。
- 遗留：H1–H11 待人类伙伴裁决；#241 需要在本分支新的 head 上再变基并另行复评；TD7–TD10 见下。

### 技术债务（开工前登记，执行中追加）

- TD1 `observed_at` 的同版本决胜键按 `receivedTime` 字节序比较，`receivedTime` 没有被规范化（只有契约 O4）。归属待人类裁决（H4）：并入 #201 或另开 issue。
- TD2 悬空父行用例的 `assert.rejects(promise, '<字符串>')` 不匹配错误原因（`storage-contract.test.js:226-229`、`suites/storage-execution.js` 的父边用例）。与 #201「让变异显示为未防护的检查被钉住」同类。
- TD3 同一主体「已有版本后又来无版本」的观察被静默拒绝（`undefined` 最小）。本层只写契约 O3，未强制。
- TD4 GitHub 秒级 `updatedAt` 的同秒碰撞让相等版本更常出现；R4 ② 可能接受晚到的旧快照。正确性依赖对账（ADR-0003），归属见 H4。
- TD5 入口拒绝仍是裸异常，结构化失败由 #199 承接。
- TD6 development 域变更请求的 sha 不是可定序载体，本层只保证它进不了观察账本（#198）。
- TD7（R1）以下几项都是 #223 单一基线落地之前的过渡：005 的数据步骤、`Migration.data` 扩展点（只有 005 在用，不做成通用插件接口）、`repairLegacySourceVersions`、`LegacySourceVersionError`，以及宿主对它的呈现。#223 合并迁移时整体删除或改写。
- TD8（R1）`REWRITTEN_003_MESSAGE` 仍写「请删除库文件重建」（main 上既有的文案），与 R1 保留数据的原则不一致。归属见 H9。
- TD9（R1）DDL 不约束 `updated_at` 的形状，裸 SQL 仍然可以写入非规范值；R1 用守卫（G7）把它变成响亮失败。库级 CHECK 归 #223（H10）。
- TD10（R1）main 当年返回 `false` 的观察从未入账，迁移找不回，只能依赖 provider 下一次全量对账（ADR-0003）。

## Bottom Change Note

- 2026-09-29：创建。由独立评审定稿者在三份独立设计的基础上写成；定稿来源、嫁接点与被拒方案见 `Design / Spec`，评审结论见 `Decision Log` D3。
- 2026-09-29：T4 验收回填。原因：在最终树上整表重测后，有几处预期与实测不符；复评又补了两处防线。改动包括：状态行；Batch 1 的 C5 与 C2 追加项；Batch 1 / 2 验证表的条数与 grep 预期；Batch 3 的回放条数与变异表（拆出 M6a–M6e、M7a / M7b，追加 M12b 与 M14，订正 M8 / M9 / M12）；Batch 4 的提交数、backup ref 与 `gh pr ready` 说明；`Validation and Acceptance` #3 / #4 / #8；`Progress`；`Surprises & Discoveries`；D2 / D8 的就地标注与 D10–D12；`Idempotence and Recovery` 的变异场地与回滚范围；`Outcomes & Retrospective`。
- 2026-09-30：规划评审响应 R1。原因：人类伙伴的评审 5352511875 指出，旧库里已持久化的非规范载体会让升级后的新观察被静默丢弃，并否定了删库处置。独立评审定稿者复现了反例，评审了三份设计，选定方案。改动：
  - 状态行与范围行；`Purpose / Big Picture` 追加一条结果与一条证据。
  - `Design / Spec`：新增 R1 增补；给「在 storage 层改写载体」加范围注。
  - `Global Constraints`：R1 的文件所有权与明确不改；规模追加（弹性 800 / 1300 与 CI 1000 / 1500 两层）；「MMP 前不做兼容层与迁移」标 Superseded。
  - `Plan of Work`：新增 R1 批次；Batch 4 验证表的提交数加注。
  - `Validation and Acceptance` #12–#17；`Progress`；`Surprises & Discoveries` 的 R1 条目。
  - `Decision Log`：D13–D17 与 H7–H11。
  - `Idempotence and Recovery`：两处标 Superseded，新增 R1 条目。
  - `Interfaces and Dependencies`：R1 接口与 G5–G8。
  - `Outcomes & Retrospective`：遗留与 TD7–TD10。
- 2026-09-30：R1 验收回填。原因：在最终树上整表验证之后，有几处预期与实测不符，并做了一次重构（D18）。改动：状态行；`Purpose` 证据 4 的条数；`Global Constraints` 的 R1-D 工作树与规模实测；R1 规格的备份核对位置与不存在库文件的拒绝；R1 步骤 4 与验证表第一行的条数；R-M1 的红集与新增的 R-M11；`Validation and Acceptance` #15 / #16；`Progress`；`Surprises & Discoveries`；D18；G8；`Idempotence and Recovery` 的实现期中断条；`Outcomes & Retrospective`。

- 2026-09-30：R2 修复并发情况下错误承诺整库未修改的 P2；补完整 migrate 的交错用例和阶段/版本元数据，原过强保证就地标注取代。最终收尾按 D19 完成。

- 2026-09-30：完整验证后归档载体计划，更新 #239 刚落地的 #203 矩阵及控制计划；保留旧保证的取代标注，按 runtime 与文档归档两个交付物整理最终提交。

- 2026-09-30：归档后文档契约指出历史控制计划的四条 active 引用失效，已全部更新为 completed 路径；27 条文档与 MVP-0 验证恢复通过。记录最终提交粒度与弹性规模偏差。
