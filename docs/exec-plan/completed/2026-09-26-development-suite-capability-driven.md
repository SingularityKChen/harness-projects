# Development 契约套件按能力快照驱动 ExecPlan

> 状态：Completed（2026-09-26，Start Work 栈第六轮评审后就地修复并合并；#205 保持开启，剩余验收见 `Outcomes & Retrospective`）
> 创建：2026-09-26
> 范围：`tests/contract/suites/development.js` 只断言能力快照能表达的东西；新增 `development.worktree.remove` 键让破坏性的工作树移除可声明
> 上游输入：`docs/review/2026-09-24-pr-160-mvp-review.md`、issue #205、issue #137、issue #138

## Purpose / Big Picture

完成后，一个**诚实地声明更小能力子集**的 Development provider 能通过共享契约套件；而一个"快照说不可用、方法却还能跑"的 provider 会被套件抓住。判断成功的最小证据有两条：

1. 一个不支持工作树移除的 provider 跑 `developmentContractSuite` 全绿，且套件对它断言的是结构化 `not_supported` 与"无副作用"，不是跳过。
2. 把套件改回无条件调用 `removeWorktree`，两个不声明移除的适配器（「未声明工作树移除」「省略可选方法」）必须变红（判别性，不是"碰巧通过"）。

这条闭环从 PR #160 拆出来：套件改动只依赖替身与能力契约，不依赖本地 Git provider，本身就是一个可独立验收、合并、回滚的交付物。拆分同时把 #160 的代码体量从 1121 行降到上限以内（见 `Decision Log` D1）。

## Context and Orientation

- `tests/contract/suites/development.js` 是所有 Development provider 共用的契约套件。适配器提供 `{ label, makeProvider(scenario), expect }`，`expect.objects(provider)` 返回"本 provider 现在持有哪些外部对象"的快照，套件用它断言被拒的调用没有副作用。
- `packages/capabilities/src/capability-keys.ts` 是 capability key 的唯一权威表。`tests/contract/capabilities-keys.test.js` 逐条钉住键的形状、域前缀与总数。
- `packages/providers/fake/src/development.ts` 是离线 Development 替身，套件与判别性用例都跑在它上面。
- **当前状态（本计划创建时的 `main`，`53aadd5`）**：套件无条件调用 `createBranch`、`createWorktree`、`removeWorktree` 与 `createChangeRequest`；"未声明的能力"只有一条 `branchCreate: false` 用例；`removeWorktree` 是 port 上的可选成员，但**没有任何 capability key**，所以它的可用性无法在快照里表达。（上一版这里写的是 #160 分支上套件的中间版本，Start Work 栈第六轮评审订正。）
- 术语：capability key 是调用方唯一的按能力分支依据（`AGENTS.md` §2）；快照 `ProviderCapabilitySnapshot` 的 `capability` 字段是 provider 自述的理论能力，未声明的键不出现。

## Design / Spec

### 方案

1. **新增 `CapabilityKey.DevelopmentWorktreeRemove = 'development.worktree.remove'`**。移除是破坏性操作（`AGENTS.md` §7「破坏性删除默认不做」），它必须能被声明，而不是靠"方法在不在"被调用方探测。这与 `createChangeRequest` 已有的处理方式一致：port 的可选方法都对应一个 capability key，方法缺失时快照**不得**声明它可用。
2. **套件的移除往返用例按该键驱动**：声明了才跑"移除后读回消失、第二次 `not_found`"；没声明就断言方法缺失或结构化 `not_supported`、`retryable === false`、`expect.objects` 不变。这不是跳过——跳过会让子集 provider 的假绿不可见，而套件存在的意义正是消除假绿。
3. **替身拆出 `worktreeRemove` 开关**（原先移除复用了 `worktreeCreate` 开关），让"能创建但不能移除"成为一个可构造、可断言的形态。
4. **判定一律按被测方法自己的 capability key**（Start Work 栈第五轮评审 blocking 后修正）：第一版用一个家族级的 `declaresChangeRequests`（取 `change_request.read`）代表整个变更请求子集，于是「能读不能建」（只声明读、不声明写的能力子集）过不了套件；而换成 create 键又会误判读方法。现在每个方法取 `METHOD_KEY[method]`。
5. **能力判定先于身份判定**，并把它写成 port 义务：能力未声明时对**任何**输入（含外来引用）都答 `not_supported`——能力整体不存在时结论与输入无关。两个码指向不同恢复动作（转人工 vs 去平台确认），顺序不能靠实现者猜。
6. **四个适配器覆盖四种真实 provider 形态**：全能力、只读子集（`changeRequestCreate: false`）、未声明移除、**真正省略可选方法**（Proxy 藏掉方法）。最后一个是 `fn === undefined` 分支的唯一覆盖——而「方法不存在」正是本地 Git provider 的真实形态。

### 被放弃的方案

- **套件按 `typeof provider.removeWorktree === 'function'` 分支**：调用方按对象形状分支，而不是按 capability key 分支，违反 `AGENTS.md` §2「调用方只按 key 分支」。它还会让"方法存在但能力不可用"这一形态继续不可见。
- **把家族门从一个键换成另一个键**（`change_request.read` → `change_request.create`）：实测只换键会让读方法与只读/离线场景产生新的错误断言（`9 / 6 / 3` 变成另一种红），因为病根是"用一族里的一个键判定另一个方法"，不是选错了那个键。
- **把移除往返用例整段移出套件、只留在替身自己的用例里**：套件确实会变绿，但 `removeWorktree` 从此没有任何共享契约覆盖，等 #138 落地时还要再写一遍。
- **把 `removeWorktree` 从 port 删除**：issue #138 明确要交付这个能力，删除只是把同一份契约工作推迟，并让 #138 变成"重新加回一个成员"。
- **只给套件加"方法缺失就跳过"**：正是套件头部注释点名的假绿形态。
- **把 `deepEqual` 改名 `deepStrictEqual`**：Start Work 栈第五轮评审建议如此，但套件 `import assert from 'node:assert/strict'`，两者是同一个函数（实测 `assert.deepEqual === assert.deepStrictEqual` 为 `true`）。改名没有语义效果，只改注释消除「宽松比较」的误读。

### 关键不变量

- 快照是能力的唯一权威：方法能用就必须声明可用；方法缺失时快照不得声明它可用。
- **能力按方法各自声明**：同一族的读与写是两个独立 key，不得用一个键判定另一个方法。
- **能力判定先于身份判定**：能力整体不存在时结论与输入无关。
- 破坏性能力单独声明，不随"创建"能力一起出现。
- 被拒的调用不得留下任何外部对象（由 `expect.objects` 的前后快照断言）。

## Global Constraints

本计划改这八个文件，不多不少（第一版只列了五个，漏了索引与本计划自身——Start Work 栈第五轮评审指出；第二版把八个写成了「七个」——第六轮评审指出）。合并前另加的评审记录在 `docs/review/`，是单独的交付物（见 `Bottom Change Note`）：

- `packages/capabilities/src/capability-keys.ts`（新增 `development.worktree.remove`）
- `packages/capabilities/src/development-provider.ts`（把可选方法的实现义务写进 port）
- `packages/providers/fake/src/development.ts`（移除独立开关 + 能力判定先于身份判定）
- `tests/contract/capabilities-keys.test.js`（键总数 28 → 29）
- `tests/contract/development-contract.test.js`（四个适配器）
- `tests/contract/suites/development.js`（按方法自己的键驱动）
- `docs/exec-plan/completed/2026-09-26-development-suite-capability-driven.md` 与 `docs/README.md`（本计划与索引；合并前从 `active/` 归档）

其它硬约束：

- 不实现本地 Git provider 的工作树移除（那是 #138）。
- 不改 `packages/core`：`DevelopmentProviderSurface` 是 `keyof DevelopmentProvider` 的精确类型，port 成员集合不变，所以新增键不产生跨层跳跃。
- 不引入新的第三方依赖；测试只用 `node:test` 与 `node:assert/strict`。
- 文档与提交信息用中文，标识符与命令用英文。

## Plan of Work

### Batch 1 · 让移除可声明，并让套件按快照驱动

**最小闭环**：新增键 + 替身声明 + 套件按键驱动 + 一个"未声明移除"的适配器；套件对子集 provider 从"必然红"变成"必然绿且被断言"。
**涉及文件**：见 `Global Constraints`。
- [x] `capability-keys.ts` 增加 `DevelopmentWorktreeRemove`，位置紧跟 `DevelopmentWorktreeCreate`。
- [x] `capabilities-keys.test.js` 的键总数 28 → 29。
- [x] `fake/src/development.ts`：`FakeDevelopmentCapabilities` 增加 `worktreeRemove`；`declaredCapabilities` 按它声明新键；`removeWorktree` 改由它门控。
- [x] `suites/development.js`：新增 `METHOD_KEY`（每个可选方法对应自己的 capability key）并加入 `removeWorktree`；移除往返用例按 `development.worktree.remove` 分支；头部注释说明破坏性能力单独声明。
- [x] `development-contract.test.js`：新增"未声明工作树移除"适配器。

**验证**（在检出 `test/development-suite-capability-driven` 的工作树根目录运行）：

| 命令 | 期望输出 |
|---|---|
| `./node_modules/.bin/tsc --noEmit` | 无输出，exit 0 |
| `node --test tests/contract tests/integration tests/e2e` | `ℹ pass 614`、`ℹ fail 0` |
| `node --test tests/mvp0` | `ℹ pass 7`、`ℹ fail 0` |
| `node --test tests/contract/package-boundaries.test.js` | `ℹ pass 7`、`ℹ fail 0` |

判别性检查（先做变异再还原）：把移除用例的分支条件改成 `if (false)`，`node --test tests/contract/development-contract.test.js` 必须出现 `ℹ fail 2`，失败点恰为两个不声明移除的适配器（「未声明工作树移除」「省略可选方法」）。第一版这里写的 `ℹ fail 1` 是只有两个适配器时的期望，已 Superseded（观察 head：第六轮修复后的本分支 head）。

**回滚**：`git revert <本批次提交>`。回滚后套件恢复无条件调用 `removeWorktree`，#160 必须重新带上移除实现——这是拆分时已经接受的耦合方向。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | `development.worktree.remove` 在键表里且形状合法 | `node --test tests/contract/capabilities-keys.test.js` 全绿（含键总数 29 与域前缀断言） |
| 2 | 未声明移除的 provider 不被要求移除 | "离线 Development 替身（未声明工作树移除）" 适配器 9 条用例全绿 |
| 3 | 套件对该形态断言的是 `not_supported` + 无副作用，不是跳过 | 同一适配器的"工作树创建后可定位；移除按声明的能力"用例断言 `not_supported`、`retryable === false`、`expect.objects` 前后相等 |
| 4 | 该断言具备判别性 | 变异 `if (false)` → `40 / 38 / 2`（两个不声明移除的适配器）；还原后 `40 / 40 / 0`。原期望 `ℹ fail 1` 已 Superseded |
| 5 | 替身的移除开关是承重的 | `capabilities: { worktreeRemove: false }` 时 `removeWorktree` 返回 `not_supported` 且 `state.worktrees` 不变（由验收 2 的用例覆盖） |
| 6 | 包边界未被破坏 | `node --test tests/contract/package-boundaries.test.js` → `ℹ pass 7`、`ℹ fail 0` |
| 7 | 套件内部没有"靠移除清理状态"的顺序依赖 | 本层：各用例的分支名与工作树路径互不重叠（「重复创建」用例用自己的 `${expected.worktreePath}-dup`）。本地 Git provider 接入后仍报 `conflict` 这一半**由 #160 验收**：本层没有本地 Git provider（`tests/integration/development-local-git.test.js` 随 #160 引入），这里不可复跑 |
| 8 | **只读子集**（`change_request.read` 有、`.create` 未声明）能通过套件 | "只读凭据"适配器 9 条用例全绿；把 `METHOD_KEY.createChangeRequest` 换回 read 键 → 四个适配器共 `40 / 32 / 8` |
| 9 | **能力判定先于身份判定**被钉住 | 套件的"外来 binding"用例断言未声明能力 + 外来引用 → `not_supported`；把替身 `createBranch` 改回身份优先 → `40 / 36 / 4` |
| 10 | **省略可选方法**的 provider 有覆盖 | "省略可选方法"适配器（Proxy 藏掉方法）9 条用例全绿；让它谎报能力可用 → `40 / 35 / 5`，5 条失败都由已声明路径上的 `implemented()` 报出「快照声明了 X 可用，Y 就必须实现」（第六轮之前这 5 条红来自 `TypeError`） |
| 11 | `expect.objects` 在每一种已知写入之后都是新鲜快照 | 分支、工作树创建、工作树移除、变更请求创建之后各有一条 `notDeepEqual`；把替身适配器的钩子改成只返回分支 → `40 / 34 / 6` |

## Progress

- [x] (2026-09-26) Batch 1 实现完成：键、替身开关、套件按键驱动、第二个适配器。
- [x] (2026-09-26) 验证：`tsc --noEmit` 无输出；contract+integration+e2e `614 / 614 / 0`；`node --test tests/contract` `524 / 524 / 0`；mvp0 `7 / 7 / 0`；boundaries `7 / 7 / 0`。
- [x] (2026-09-26) 判别性变异（第一轮）：`if (false)`（让未声明移除的适配器走真实移除路径）→ `development-contract.test.js` `22 / 21 / 1`。该文件当时注册 22 条（套件 9 × 2 个适配器 + 4 条专属），所以「一行 `if (false)` 不可能让 5 条用例消失」这个推论的方向是反的：22 才是当时的真实条数。
- [x] (2026-09-26) Start Work 栈第五轮评审响应：家族级门改成逐方法取键；新增只读凭据与「真正省略可选方法」两个适配器；替身统一能力优先；义务写进 port；三个判别性变异（家族门 8 红 / 身份优先 4 红 / 谎报能力 5 红）。
- [x] (2026-09-26) Start Work 栈第六轮评审（review `5325081139`，10 条 inline：5 × P2、5 × P3，无 P0 / P1）就地修复：`implemented()` 取代同义反复的断言；`expect.objects` 新鲜度扩到全部已知写入；谱系用例的读按 read 键判定；套件头与 port 写明只建模能力声明；本计划的起点、文件数、判别性期望、验收 7 的归属、轮次与恢复锚点订正；`Closes #205` 改为 `Refs #205`。验证：`tsc --noEmit` 无输出；contract+integration+e2e `614 / 614 / 0`；`development-contract.test.js` `40 / 40 / 0`；变异 `if (false)` → `40 / 38 / 2`、家族门 → `40 / 32 / 8`、谎报能力 → `40 / 35 / 5`、只看分支的钩子 → `40 / 34 / 6`。上层回归：修复打到 #160 head（`b0e8499`）→ `638 / 638 / 0`、栈顶（`329a475`）→ `665 / 665 / 0`，本地 Git 适配器 `23 / 23 / 0`。

## Surprises & Discoveries

- **家族级门把「读」和「写」当成一个能力**：第一版用一个 `declaresChangeRequests`（取 `change_request.read`）代表整个变更请求子集，六处判定都走它。后果是「`change_request.read` 可用、`change_request.create` 未声明」这一能力子集过不了套件：创建走「已声明」分支并在 `created.ok` 上红。独立复现：加一个 `capabilities: { changeRequestCreate: false }` 的适配器 → `9 / 6 / 3`。**同一个门也反过来**：把它换成 create 键会让读方法与只读/离线场景产生新的错误断言，所以正确的修法是**逐方法取自己的键**，而不是换一个键。证据：把 `METHOD_KEY.createChangeRequest` 换回 read 键 → 四个适配器共 `40 / 32 / 8`。
- **套件头部写了一条它自己不遵守的规则**：头部说「未声明的能力对任何输入（含外来引用）都答 `not_supported`」，但「外来 binding」用例里 `createChangeRequest` 的 `declared` 取自 **read** 键；当 read 已声明时该用例要求 `not_found`。也就是说在唯一能观察到「能力 vs 身份」优先级的形态下，套件当时要求的是**身份优先**，与头部注释相反。现在规则写进 port 注释并在套件里用一条断言钉住：把替身的 `createBranch` 改回身份优先 → `40 / 36 / 4`。
- **`assertUndeclared` 的判别力来自适配器而不是断言本身**（第六轮订正：更准确地说，`fn === undefined` 分支里那条断言是同义反复——每个调用点都先经 `declares()` 确认了「未声明」；「谎报可用」的 5 条红来自已声明路径上的 `TypeError`。现在那条断言移到已声明路径上的 `implemented()`）：`accessOf` 对「键缺席」与「显式 unavailable」都返回 `unavailable`（`capability-keys.ts` 的约定是未声明的键不出现），所以这条断言能抓住的是「方法缺失却把该键声明为 available」。第一版三个适配器都**定义**了可选方法，`fn === undefined` 那条分支从未执行。现在补了「省略可选方法」的适配器（用 Proxy 藏掉两个方法）：让它谎报能力可用 → `40 / 35 / 5`。
- **`node:assert/strict` 下 `deepEqual` 就是 `deepStrictEqual`**：第五轮评审建议把 `deepEqual` 改成 `deepStrictEqual`，理由是「宽松比较容忍 `0` / `false` / `"0"` 漂移」。实测 `assert.deepEqual === assert.deepStrictEqual` 为 `true`，且 `0` vs `false`、`"0"` vs `0`、`{a:1}` vs `{a:"1"}` 三组输入下两者抛出的都是 `ERR_ASSERTION: deepStrictEqual`。所以这条不属实，代码不改；只是把注释里的「逐字」写明为「`deepStrictEqual` 意义下不变」以免再次被读成宽松比较。
- **套件的用例之间靠"移除"清理状态，这是一条隐藏的顺序依赖**：`tests/contract/suites/development.js` 的"同一路径重复创建工作树返回 conflict"用例与"工作树创建后可定位"用例共用 `expect.worktreePath`。对替身无所谓（每个 provider 自带 state），但对以**同一个仓库**为后端的适配器（本地 Git provider），前一条用例留下的工作树在移除变成可选之后不会被清掉，于是重复创建那条用例变成"路径已登记但分支不同"，测的不再是重复创建。证据（在 #160 分支上观察；`tests/integration/development-local-git.test.js` 随 #160 引入，本层不可复跑）：本地 Git provider 接入后该用例报 `invalid_input` 而不是 `conflict`（`✖ 本地 Git provider：同一路径重复创建工作树返回 conflict`）。修法：那条用例用自己的路径 `${expected.worktreePath}-dup`。
- **`git checkout -- <file>` 会把工作区恢复到索引而不是 HEAD**：本计划执行时先 `git checkout 57a19a7 -- <file>` 把套件改动取进来（进索引），编辑后为做变异又用 `git checkout -- <file>` 还原，结果把未暂存的编辑一起丢掉。变异实验要用文件副本还原，不要用 `git checkout --`。证据：`grep -c METHOD_KEY tests/contract/suites/development.js` 在还原后为 0。
- **套件的键总数断言是硬编码的 28**（`tests/contract/capabilities-keys.test.js:28`）：新增键必须同步改这一行，否则整条契约 lane 变红。这是有意的——键表是跨层契约，增删必须留下 diff。

## Decision Log

- Decision: 把"套件按能力驱动"从 PR #160 拆成独立 PR，基线 `main`，跟踪 issue #205。
  Rationale: 独立实测（`.worktrees/verify-size`，head `01605c2`，base `origin/main` @ `53aadd5`）显示 #160 代码体量 1121/1000；只删 `removeWorktree` 得 1046（仍超），只把本套件改动拆出得 993。套件改动只依赖替身与能力契约，本身是闭环。人类伙伴在 2026-09-26 明确选择"拆套件 PR + 删 removeWorktree，余量若仍略超再带实测数字裁决"。
  Date/Author: 2026-09-26 / agent（人类伙伴批准）
- Decision: 用**新增 capability key** 表达"能不能移除工作树"，而不是按方法存在性探测。
  Rationale: `AGENTS.md` §2 要求调用方只按 capability key 分支；port 的其它可选方法（`createBranch` / `createWorktree` / `createChangeRequest`）都已有对应键，`removeWorktree` 是唯一的例外，而这个例外正是套件被迫向每个 provider 索取破坏性方法的原因。
  Date/Author: 2026-09-26 / agent
- Decision: 新增第二个套件适配器（`worktreeRemove: false`）而不是只加一条替身用例。
  Rationale: 本计划的验收项 2 是"套件不向子集 provider 索取未声明的破坏性能力"，只有让**整份套件**跑在一个未声明移除的 provider 上才是它的直接证据；单点用例只能证明替身的开关生效。
  Date/Author: 2026-09-26 / agent
- Decision: 拆掉家族级的 `declaresChangeRequests` 门，判定一律按**方法自己的** capability key。
  Rationale: Start Work 栈第五轮评审 blocking。用 `change_request.read` 代表整族会让「能读不能建」（只声明读的能力子集）过不了套件——独立复现 `9 / 6 / 3`。而**换成 create 键同样错**（会让读方法在只读/离线场景产生新错误断言），所以修法是逐方法取键，不是换键。变异：把 `METHOD_KEY.createChangeRequest` 换回 read 键 → `40 / 32 / 8`。
  Date/Author: 2026-09-26 / agent
- Decision: **能力判定先于身份判定**，并把这条义务写进 `packages/capabilities/src/development-provider.ts` 的 port 注释。
  Rationale: 套件头部早就写了这条规则，但「外来 binding」用例把 `createChangeRequest` 的 `declared` 取自 read 键，于是在唯一可观察的形态下要求的是 `not_found`（身份优先）——头部与用例体自相矛盾，而替身也跟着身份优先。两个码指向不同的恢复动作（`not_supported` → 转人工，`not_found` → 去平台确认），所以这是必须被写下来的契约选择。现在替身统一能力优先，套件加一条断言钉住（变异 → `40 / 36 / 4`）。
  Date/Author: 2026-09-26 / agent
- Decision: 补一个**真正省略可选方法**的适配器（Proxy 藏掉两个方法），而不是只改 `assertUndeclared` 的注释。
  Rationale: `accessOf` 对「键缺席」与「显式 unavailable」不可区分，所以这条断言的判别力取决于适配器是否真的省略方法——第一版三个适配器都定义了方法，`fn === undefined` 分支从未执行。补覆盖后，让该适配器谎报能力可用 → `40 / 35 / 5`。
  Date/Author: 2026-09-26 / agent
- Decision: **不**把 `deepEqual` 改成 `deepStrictEqual`；只把注释里的「逐字」写明为「`deepStrictEqual` 意义下不变」。
  Rationale: 套件 `import assert from 'node:assert/strict'`，实测 `assert.deepEqual === assert.deepStrictEqual` 为 `true`，三组宽松比较的经典反例（`0`/`false`、`"0"`/`0`、`{a:1}`/`{a:"1"}`）下两者行为相同。评审的这条建议基于对 strict 模式别名的误读，改名字没有语义效果；但注释确实可以被读成「宽松比较」，所以改注释消除歧义。
  Date/Author: 2026-09-26 / agent
- Decision: PR 与提交从 `Closes #205` 改为 `Refs #205`，#205 保持开启。
  Rationale: Start Work 栈第六轮评审。本 PR 是栈底，只合并这一层时 #205 验收 4（本地 Git provider 以真实子集通过套件）无从成立——provider 在 #160 才存在；验收 2（「every optional method」）对 `createBranch` / `createWorktree` 只部分成立。关闭应当由验收真正同时成立的那一层来做。
  Date/Author: 2026-09-26 / 评审者（主评审就地修复）
- Decision: 本轮**不**把 `createBranch` / `createWorktree` 改成按快照驱动，留在 #205 继续跟踪；套件头写明「分支与工作树创建目前仍按已声明使用」。
  Rationale: 这两个方法是分支往返、工作树往返、谱系、重复路径、外来 binding 五条用例的前置步骤，改成可选需要重新设计这几条用例在「未声明」时断言什么（例如没有分支就没有谱系），属于设计变更而不是合并前的机械修复。当前不影响任何现存 provider（替身与本地 Git 都声明这两个键），缺口的方向是「诚实子集假红」而不是「谎报假绿」——谎报的六种适配器全部变红。
  Date/Author: 2026-09-26 / 评审者
- Decision: `AccessLevel` 四态只做最小修：不再声称支持 `AccessLevel.ReadOnly`，在套件头与 port 义务 2 写明本套件只建模能力声明，`permission: read_only` → `permission_denied` 是正交的另一层。
  Rationale: 另一种修法（让 `declares()` 与 core 的 `gateCommand` 用同一套四态约定）要改套件的判定语义并补 `read_only` / `degraded` 两种适配器，是设计变更；而原措辞「只读凭据，正是 `AccessLevel.ReadOnly` 存在的理由」对本套件不成立（只读子集适配器是把 create 键去掉，没有用到 `ReadOnly`）。
  Date/Author: 2026-09-26 / 评审者
- Decision: 「方法缺失时快照不得声明可用」的断言从 `assertUndeclared` 的 `fn === undefined` 分支移到已声明路径上的 `implemented()`。
  Rationale: 原位置上它是同义反复（调用点都已确认「未声明」），删掉结果不变；「谎报可用」的红来自 `TypeError`。移到已声明路径后，同一种谎报仍然 5 条红，失败信息直接指向缺的方法。
  Date/Author: 2026-09-26 / 评审者
- Decision: 替身三个可选方法的判定顺序改动超出了 #205 的 Out of scope（「Changing the fake's behaviour beyond declaring the new key」），保留并在 #205 上登记。
  Rationale: 「能力先于身份」是本 PR 写进 port 的义务，替身作为参考实现必须满足它；不改替身，套件那条断言就会让替身自己红。
  Date/Author: 2026-09-26 / 评审者

## Idempotence and Recovery

- 本批次的全部改动是声明与测试装配，可重复执行：重跑验证命令结果不变；变异实验可反复施加与还原。
- 失败恢复：`git checkout <branch> -- <file>` 从**已提交**的版本恢复单个文件；未提交的编辑用文件副本恢复，不要用 `git checkout -- <file>`（见 `Surprises & Discoveries`）。
- 回到已知良好状态：`git reset --hard <本批次提交>`。
- 分支已被 force-push 过时，恢复锚点是作者本机的 backup ref（不在远端，本仓库里不可解析）；远端可回读的锚点是 PR #208 的提交历史与本计划的合并提交。

## Interfaces and Dependencies

- 依赖 `@harness-projects/capabilities` 的 `CapabilityKey` / `effectiveCapabilities` / `AccessLevel`，与 `@harness-projects/provider-fake` 的 `createFakeDevelopmentProvider`。
- 命名契约：新键的取值必须是 `development.worktree.remove`（域前缀 `development`，形状 `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`），且不得含任何 provider / 平台名片段。
- **适配器契约（破坏性变更，Start Work 栈第五轮补记）**：套件要求 `expect.objects(provider)` 返回「本 provider 当前持有的全部外部对象」的快照，且**每次调用都必须是新鲜快照**——分支创建、工作树创建与移除、变更请求创建之后，套件都会断言它与调用前**不相等**（`assert.notDeepEqual`，第六轮从「只查分支」扩到全部已知写入）。缺失该钩子会在套件**定义期**抛错，不再是可选。
- **provider 义务（写进 `development-provider.ts` 的 port 注释）**：① 能力判定先于身份判定（能力未声明时对任何输入都答 `not_supported`）；② 能力按方法各自声明，读与写是两个独立 key，「只声明读」是合法的能力子集——凭据权限（`permission: read_only` → `permission_denied`）是正交的另一层，本套件不建模；③ 方法缺失时快照不得把对应 key 声明为 `available`。
- 下游：#160 的本地 Git provider 以本 PR 为基线，声明 `repository.read` / `branch.create` / `worktree.create` 三键、不声明移除与变更请求；#138 落地移除时再声明本键并补 safe / discard 语义。
- 无外部凭据、无网络、无仓库设置依赖。

## Outcomes & Retrospective

- 实际结果：套件对变更请求三个方法与工作树移除只断言快照能表达的东西；"能创建但不能移除"与"能读不能建变更请求"都成为可构造并通过套件的形态。分支与工作树创建仍按「已声明」使用（见下面的遗留问题）。四个适配器（全能力 / 只读子集 / 未声明移除 / 省略可选方法）覆盖了四种真实 provider 形态，四个判别性变异（`if (false)` 2 红 / 家族门 8 红 / 谎报能力 5 红 / 只看分支的钩子 6 红）证明新断言是承重的。
- 与计划的偏差：第一版把「变更请求」当一族、用一个 `change_request.read` 门代表整族（第五轮评审 blocking），并漏记了 `expect.objects` 从可选升级为强制；两者都已订正（见 `Surprises & Discoveries` 与 `Decision Log`）。
- 遗留问题：`removeWorktree` 的 safe / discard 分层语义（默认安全、显式 `discard` 才丢弃修改、`overrideLock` 再升一级、结构化返回被阻止的原因）留给 #138；本 PR 只让"能不能移除"可声明。
- #205 保持开启，剩余验收：
  - 验收 2：`createBranch` / `createWorktree` 按各自的键驱动（未声明时走 `assertUndeclared` + `expect.objects` 不变），并补一个不声明工作树创建的适配器；
  - 验收 4：本地 Git provider 以真实子集通过套件——随 #160 合并成立（Start Work 栈第六轮评审时 #160 因 P1 未合并）；
  - `reconcile` 是 port 上唯一没有 capability key 的可选成员，「缺失即不可用」对它无从表达，需在套件头或 port 写明理由。
- 第六轮评审的完整记录：`docs/review/2026-09-26-pr-208-mmp-review.md` 与批次记录 `docs/review/2026-09-26-start-work-stack-round6-review.md`。

## Bottom Change Note

- 2026-09-26：创建。Batch 1 一次完成并验证；记录 `git checkout --` 的陷阱与键总数断言。
- 2026-09-26：**第五轮评审响应**。6 条意见里 4 条属实并已修（家族级门混淆 read/create、`expect.objects` 的接口面漏记、文件集漏列、验证数字与命令不匹配），1 条部分属实（`assertUndeclared` 不是空转，但 `fn === undefined` 分支无覆盖——已补适配器），1 条不属实（`deepEqual` 在 `node:assert/strict` 下就是 `deepStrictEqual`，已给出实测反驳并只改注释）。
  设计面新增 §「provider 义务」三条并写进 `development-provider.ts`；适配器从 2 个增到 4 个（全能力 / 只读凭据 / 未声明移除 / 省略可选方法）；三个判别性变异（8 红 / 4 红 / 5 红）。验证数字更新为 contract+integration+e2e `614 / 614 / 0`、contract `524 / 524 / 0`。
- 2026-09-26：**Start Work 栈第六轮评审后的就地修复与归档**（主评审执行，review `5325081139`）。10 条意见全部属实：5 条代码 / 测试项按「修复」处置（`implemented()`、全部写入后的新鲜度、谱系读按 read 键、套件头与 port 的能力声明范围），5 条文档项就地订正（起点、文件数、判别性期望、验收 7 归属、轮次与恢复锚点）；「分支 / 工作树按快照驱动」按 Decision Log 留在 #205。`Closes #205` 改为 `Refs #205`。本计划从 `active/` 移入 `completed/`。
