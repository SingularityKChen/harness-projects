# Development 真实能力子集契约 ExecPlan

> 状态：Completed；S1 已实施并经独立验收；第 1 轮评审（APPROVE，3 × P2 / 8 × P3）与修复本身的独立复评（0 × P0–P2，5 × P3）的修订均已完成；合并状态以 PR #288 回读为准。
> 创建：2026-10-07（Asia/Shanghai）
> 关联：同仓 issue #205；规范：`PLANS.md`。
> 执行上下文：检出 `test/development-subset-contract` 的工作树根目录；隔离目录 `.worktrees/development-subset-contract-plan`。

## Purpose / Big Picture

实现者可以把完整或诚实的 Development 能力子集接入同一套契约测试。没有声明分支创建、工作树创建/读取/移除或 CR 创建的 provider 不会因套件强制调用而 TypeError；谎报可用、静默成功、拒绝时副作用与假 objects 快照必须被判别测试抓到。

最小成功证据是同一 suite 在无故障完整实例、三个剩余能力关闭实例和五个可选方法真实省略实例上全部通过；每方法的坏适配器在具名断言处失败； **Superseded by Decision Log「矩阵只在失败消息里匹配片段」（2026-10-08）：裸 throw 的红来自 liar 自己的异常，不是套件的具名断言。**真实 Local Git 子集继续通过，无新增移除或 CR 功能。

## Context and Orientation

调查快照为 2026-10-07 23:05 +08:00、`main@6417d45978ec22778b914a9d7dea91d71fb6bb6e`。执行前用 `git rev-parse origin/main HEAD` 回读最新基线。

`tests/contract/suites/development.js::developmentContractSuite` 接收 `{ label, makeProvider(scenario), expect }`。scenario 是测试输入；`describeCapabilities()` 才是被测实例能力事实源。`expect.objects(provider)` 返回本 provider 当前完整外部对象快照，用来检查写入与拒绝后的副作用。

主线已完成 remove key、CR 每方法按 key、objects 必填与已知写入后的 freshness 检查。证据为 `packages/capabilities/src/capability-keys.ts`、suite 的 METHOD_KEY 与 objects 断言。本项只收口剩余分支/工作树路径，不重复建设新 key。

剩余根因是 METHOD_KEY 缺 createWorktree/getWorktree，多个 round-trip、foreign、duplicate、ambiguous 与 CR 不可用分支仍无条件调用 createBranch/createWorktree。已有只省略 createCR/remove 的 proxy 无法覆盖这些缺口。

`tests/integration/development-local-git.test.js` 已接入同一 suite。Local Git 理论能力可没有远端 CR 与 worktree removal；真实临时仓库、argv runner、realpath 根与对象回读在 `tests/integration/local-git-fixture.js`。

上游 `docs/exec-plan/active/2026-09-24-local-git-worktree.md` 已将套件剩余验收拆到 #205；`docs/exec-plan/active/2026-09-29-prelaunch-system-architecture-renewal.md` 的其它能力不由此承接。本项不改这些计划或长期 guidance。

事实是普通 Local Git 子集现已通过；硬约束是 issue 明确排除改变 fake 行为，除声明新 key 以外。新 key 在主线已有，所以当前产品改动预算为零。决策是只改 suite、测试 adapter 与 fixture。

## Design / Spec

在现 suite 增补有限 METHOD_KEY，不引入通用 DSL：

| 方法 | 自己的 key | 形态 |
|---|---|---|
| createBranch | DevelopmentBranchCreate | 可选 capability method |
| createWorktree | DevelopmentWorktreeCreate | 可选 capability method |
| getWorktree | DevelopmentWorktreeRead | 可选 capability method |
| createChangeRequest | DevelopmentChangeRequestCreate | 可选 capability method |
| removeWorktree | DevelopmentWorktreeRemove | 可选 capability method |
| getChangeRequest / listChangeRequests | DevelopmentChangeRequestRead | port 必需方法，能力可不存在 |

`reconcile?` 是可选观察流，没有 capability key；本项不发明 key、不调用它，也不声称验证同步行为。

理论 capability 与 permission 分开。`declares(provider, method)` 看快照的 `capability[key]` 是否声明 available；正常矩阵另验证 effective access。故障 permissionUnavailable 不能把已实现方法改判为 undeclared。场景 flags 只负责构造，suite 不用 flags/provides 决策。 **Superseded by 本节下一段（2026-10-08）：实现按 effective access 判定，不是只看 `capability[key]`。**

`declares(provider, method)` 实际取 `effectiveCapabilities(snapshot)`（capability ∩ permission）里该键的 access 是否为 `available`（`tests/contract/suites/development.js` 的 `accessOf` / `declares`）。permission 为 `read_only` 或 `unavailable` 时，已声明的方法被判成未声明，套件转而要求 not_supported。所以「capability 声明、凭据只读、写调用答 `permission_denied`」这一 port 义务 2 的诚实形态不在本套件判定范围内（suite 头注释「不建模 permission」）；评审探针 `permission-readonly-branch` 在该形态上 4/10 用例红，就是这条边界，不是回归。fake 的 permissionDenied 故障把所有键的 permission 置为 unavailable，所以权限故障用例只调用不经 `declares` 的 `listBranches`。场景 flags 只负责构造，suite 不用 flags/provides 决策。

每个正常矩阵输入的判定相同：声明可用则方法必须存在，执行真读写并验证结果；未声明且方法缺失则验证有效 unavailable；未声明且方法存在则真调用，必须结构化 not_supported、retryable false、objects 不变。外来引用在已声明时 not_found，未声明时仍 not_supported。

消除所有强制前置：branch 创建不可用时从已有分支读取；worktree 创建不可用时不先建 branch；worktree 读取可用但创建不可用时读预置对象；remove 可用但 create 不可用时移除独立预置对象。不能用返回、skip 或 todo 跳过整个用例。

adapter 可新增 `expect.worktreeBranch`（预置且未被检出的分支）和 `expect.worktreeRef`（独立预置工作树定位子）。这些是对象身份，不是第二份能力真源。每种真实 Local Git 模式使用独立临时仓库/路径；重复创建用自己 `-dup` 路径，不复用其它用例残留。

objects 必填，允许异步；在实际已知写入前保存原返回值与 structuredClone，写后确认原快照未跟随变动且新读取发生变化。拒绝前后则完整 deepStrictEqual。这样既判别恒定假快照，也抓到可变 alias 掩盖副作用。只读实例没有合法写入时，仅验证拒绝不改变对象，不宣称其动态 freshness 已被写入实证。 **Superseded by 本节下一段与 Decision Log「删除 alias 断言」（2026-10-08）：alias 无法掩盖副作用，挡住它的是取样时的克隆。**

objects 必填，允许异步。`captureObjects` 在调用前**立即** `structuredClone`；已知写入后只确认重新读取与这份快照不同（判别恒定假快照），拒绝前后完整 deepStrictEqual。钩子返回内部状态引用（alias）时，后续写入改不动已克隆的快照，所以 alias 掩盖不了副作用；合法 adapter `good-objects-alias` 必须通过，去掉那次克隆它就红在「新鲜快照」，由此钉住克隆。只读实例没有合法写入时，仅验证拒绝不改变对象，不宣称其动态 freshness 已被写入实证。 **Superseded by 本节下一段（2026-10-08，修复复评）：只克隆取样一侧时，克隆有损的恒定快照会假绿。**

取样与重读两侧都克隆：`developmentContractSuite` 注册时把 `expect.objects` 包成「每次调用都 `structuredClone`」，套件内所有比较——包括以后直接调用 `expected.objects` 的用例——看到的都是克隆后的数据，class 原型、null 原型与 symbol 键在两侧被同样丢弃。合法 adapter `good-objects-alias`（去掉克隆就红在「新鲜快照」）与 `good-objects-class-instance`（只克隆一侧就误红在「不得改动任何对象」）钉住这一点。钩子返回无法克隆的值（例如 Proxy）会抛 `DataCloneError`，这是对钩子的要求，不是判定。

故障范围固定：保留已声明能力的 permission_denied、unavailable、ambiguous_result 独立用例；正常未声明矩阵含 foreign。未声明 × offline/permissionDenied 的交叉组合本次不扩展。当前 fake 先 `gate.blocked` 后 capability guard，组合时可能返回平台错误；这是既有事实，本次不改产品、不伪称所有 fault 组合合规。

故障边界的精确范围（2026-10-08 评审修订轮补）：base 已有的两条未声明 × fault 断言保留——offline × 未声明 `listChangeRequests`、ambiguousCreate × 未声明 `createChangeRequest`。fake 永远声明 `change_request.read`（`packages/providers/fake/src/development.ts` 的 `declaredCapabilities`），走到前者的只有 Local Git 这类不声明 CR 读的 provider；fake 的 `createChangeRequest` 先查能力再查 ambiguous。所以这两条不受 fake 守卫顺序影响，由子进程负控 `cr-read-offline-first` / `cr-create-ambiguous-first` 判别。真正受影响、本次不验收的组合只有 fake 的 offline / permissionDenied × 先过 `gate.blocked` 的未声明写方法（例如 branchCreate:false 时离线调用 createBranch 答 unavailable）。 **Superseded（2026-10-08，修复复评）：fake 的 getWorktree（读方法）同样先过 `gate.blocked` 再查 `flags.worktreeRead`（`packages/providers/fake/src/development.ts` 的 `getWorktree`），准确范围是「先过 `gate.blocked` 的未声明可选方法（四个写方法与 getWorktree）」；worktreeRead:false × 离线 / 权限被拒同样答平台错误，本次不验收。**

拒绝按 provider 名拆 suite 与 adapter 另报 supports：二者都会弱化可替换性并引入另一事实源。拒绝为了新矩阵移动生产 fake 守卫：违反 #205 Out of Scope。对测试 proxy 的省略/保留 NS stub 必须明确是测试对象，不能掩盖真实生产组合缺陷。

## Global Constraints

唯一允许改动集如下；当前仅计划与索引，S1 仅测试代码。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/completed/2026-10-07-development-subset-contract.md`（实施期间位于 `active/`）、`docs/README.md` | spec + plan 与索引 |
| 测试 | `tests/contract/suites/development.js` | 每方法守卫、前置与对象证据 |
| 测试 | `tests/contract/development-contract.test.js` | 真省略、NS stub、坏 adapter discriminator |
| 集成 | `tests/integration/development-local-git.test.js` | 同 suite 的真实子集装配 |
| 夹具 | `tests/integration/local-git-fixture.js` | 仅必要的独立预置对象与 fresh 回读 |
| 将新建测试夹具 | `tests/fixtures/development-suite-adapters.mjs` | 子进程注册坏 adapter，避免预期失败污染父测试 |

不改 capabilities、fake 产品、Local Git 产品、Storage、core 或应用。五可选方法矩阵不能通过新增 remove/CR 行为使适配器通过。无兼容桥、迁移、新依赖或测试框架。

Node `>=22`、pnpm `10.28.2`；每 PR 代码/测试/夹具增删合计的**门禁**是仓库 `AGENTS.md` §6 / `rule-checks size` 的 1000 行，本文档原自设目标 800（文档同样：门禁 1500，自设 1300）。实测代码桶在完成 P1-1 全部要求后为 837～848（详见 Decision Log），第 1 轮评审修订后为 895、修复复评修订后为 917（2026-10-08，整合提交前；回读 `node scripts/rule-checks.mjs size origin/main`，期望代码 ≤ 1000），超出自设 800 但仍在门禁内；不再为凑数字删减判别性断言。预计 suite 180–250、矩阵/meta 测试 140–220、真实 fixture 40–90，合计 360–560；文档约 230–300。避免重排整份 suite 造成无意义增删；真实计数优先。

#205 与 #279 修改同一 suite，由一个 owner 串行整合，重锁 refs 后验证；不合并两个闭环，也不写 causal blocked-by。当前无产品实施、ready、merge、Status 或阻塞关系写入。

## Plan of Work

### Batch P0 · 设计、计划与 draft 发布

最小闭环：剩余缺口、五方法矩阵、故障边界与恢复点在同一计划。涉及主文件为本计划和 `docs/README.md` 单行索引。

独立审评三份候选并纠正 fake 改动越界后，运行文档验证。整理文档提交，由发布 owner 创建关联 #205 的 draft，回读两侧关闭引用并填写 ExecPlan、Batch；本次不重新交付旧 remove key。

在头部声明的检出根目录：

```sh
node --test tests/contract/content-placement.test.js tests/contract/plan-facts-consistency.test.js tests/contract/board-status-semantics.test.js
git diff --check
```

期望全 pass、无空白错误；另检查 13 节、新增链接与发布面。P0 不运行故障矩阵或声称产品修复。回滚为未公开文档差异；重试发布先查同分支 draft。

### Batch S1 · 可选能力矩阵与真实子集验收

最小闭环：正常完整/子集/省略/stub 形态通过同一 suite，坏声明与副作用真的失败，真实 Local Git 通过。涉及主文件为 Development suite、contract 装配与 Local Git integration；确切集合见 `Global Constraints`。

1. 执行 `pnpm install --frozen-lockfile`，期望 exit 0。在 contract 装配中添加 branchCreate false、worktreeCreate false、worktreeRead false 三个真实 fake 模式；必要预置对象用测试层建立。五方法逐个构造真实 absent 和保留 NS stub 的 proxy；正常快照对应 unavailable，不能让 scenario 后来的默认值重新开启基础 subset。
2. 固化 `development-subset-without-branch-or-worktree-methods` 反例。运行第一条契约命令，旧 suite 应 RED 于无条件调用或缺少具名 unavailable 检验；记录具体测试。再补 METHOD_KEY 与理论 declares，保证 available+missing 失败信息点名 key/method，而非裸 TypeError。
3. 逐个修 round-trip、分页、worktree/create/read/remove、CR-off、lineage、foreign、duplicate、ambiguous 前置。正常矩阵可用才调用 implemented，不可用仍完成 snapshot、NS 与 objects 证据。fault 用例只调用理论已声明的方法；未声明方法的 NS 证据由无故障矩阵承担，不在 fault 场景追加调用。 **Superseded by Design「故障边界的精确范围」（2026-10-08）：这句曾被当成删除 base 两条未声明 × fault 断言的理由，两条已恢复。**只读分支分页使用已有数据；有创建能力的正控仍造至少三个分支跨页。
4. 写 `development-subset-matrix-rejects-liars` meta-test。用 `execFile` 的 argv 调用独立 node --test 子进程加载将新建 fixture；每个坏 adapter 预期非零退出且输出含对应 key/具名断言。 **Superseded by Decision Log「矩阵只在失败消息里匹配片段」（2026-10-08）：片段曾在含 label 的整段输出里匹配。**五方法逐个测试 available+absent、undeclared+success、NS+sideeffect、裸 throw；另测 missing objects、静态 objects、可变 alias。 **Superseded by Decision Log「删除 alias 断言」（2026-10-08）：可变 alias 现在是合法正控 `good-objects-alias`。**正常 adapter 子进程必须零退出，不能“任何失败都算成功”。
5. 保留 full fake 的每个已知 branch/worktree/CR/remove 写入后 fresh 正控。before 的原值与 clone 分开，使 alias 被写后不可变断言抓到。 **Superseded by Decision Log「删除 alias 断言」与「取样与重读两侧都克隆」（2026-10-08）：该断言已删除。**拒绝路径比较完整对象集合，不能只看数组长度。重跑第一条命令 GREEN。
6. 用现 fixture 建独立真实 Local Git 默认模式、branch.create 关闭、worktree.create 关闭与 worktree.read 关闭模式；必要时预置分支与可读工作树。CR/remove 仍 unavailable，不追加产品方法。对象 hook 每次从磁盘真实读取 refs 与 worktree porcelain；无故障子集全 pass，保留已声明 fault 回归。
7. 运行集成与源码边界验证，核对所有能力形态都实际运行断言而没有 skip/todo。实现者提交只包含 suite/判别测试/fixture 与计划证据，不能夹带 fake 产品守卫修复。

所有命令在检出 `test/development-subset-contract` 的工作树根目录：

```sh
node --test --test-timeout=120000 tests/contract/development-contract.test.js
node --test --test-timeout=120000 tests/integration/development-local-git.test.js tests/contract/development-local-git-source.test.js
node --test tests/contract/capabilities-keys.test.js
pnpm run typecheck
pnpm run boundaries
```

期望全部 pass / exit 0；父 meta-test 通过意味着正常子进程通过而指定坏 adapter 被具名断言拒绝。 **Superseded by Decision Log「矩阵只在失败消息里匹配片段」（2026-10-08）：裸 throw 不是具名断言。**Local Git 正常子集与现路径/argv 检查保持。回滚整体 S1 测试与 fixture，产品行为与已有 remove key 原样，无外部系统写入。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 正常完整与三剩余能力关闭 | 同 suite 全部用例运行并通过 |
| 五方法真 absent + unavailable | 五 proxy 逐个通过，无裸 TypeError |
| 五方法 present + undeclared | 真 NS、nonretryable、objects 不变；含 foreign |
| available + absent | 各 key 的具名 implemented 断言红 |
| undeclared 成功、NS 副作用、裸 throw | 各方法 meta-test 要求对应子进程红 |
| objects 是完整独立当前快照 | 必填检查、已知写入正控、静态负控；alias 与 class 实例钩子为合法正控，钉住取样与重读两侧克隆（2026-10-08 改） |
| 随输入变化的未声明副作用 | 子进程 `ns-sideeffect-createChangeRequest-lineage-input` 只能红在谱系用例 |
| CR 读 present + undeclared | 变更请求用例走 `expectOptional` 完整判定；子进程 `undeclared-success` / `ns-sideeffect` × 两个读方法 |
| base 已有的未声明 × fault | offline × listCR、ambiguousCreate × createCR 两条断言；子进程 `cr-read-offline-first` / `cr-create-ambiguous-first` |
| getWorktree 读回完整 ref 身份 | 子进程 `worktree-identity-swapped` 只能红在完整身份断言 |
| 能读不能建与能建不能读合法 | 各自 key、预置身份、实际读回或 NS |
| 已声明故障仍结构化 | 独立 permission/offline/ambiguous 回归 |
| 正常真实 Local Git 子集 | 独立临时模式、磁盘对象回读和 source test |
| scope 没有暗改 fake | 产品文件零差异；fault 交叉未验证声明保留 |

提交前在该检出运行：

```sh
node scripts/rule-checks.mjs disclosure origin/main
node scripts/rule-checks.mjs size origin/main
git diff --check origin/main...HEAD
```

期望 exit 0；新增未提交文件先人工核对，提交后按真实 range 重跑。人工完成 publication 五类目扫描；不得把临时仓库的实际机器路径写进公开证据。

## Progress

- [x] (2026-10-07 23:05 +08:00) 核对已完成 remove/objects/CR 与剩余八类强调用路径。
- [x] (2026-10-07 23:05 +08:00) 三方独立方案审评完成；严格保持 fake Out of Scope，限定 fault 交叉边界。
- [x] (2026-10-08) P0 文档验证、draft 与双向 issue 回读（发布 owner 回读后补证）。**Superseded by 本节「P0 发布证据」条（2026-10-08）：补证此前没有写入。**
- [x] (2026-10-08) S1 子集 RED → GREEN、五方法负控、fresh hook 与真实 Local Git 验收（见 `Outcomes & Retrospective`）。
- [x] (2026-10-08) 独立对抗验证（PASS-with-findings，无 P0）：6 个变异实验如期 RED；P1-1/P1-2/P2-1/P2-2 修复完成并复验。**Superseded by Surprises「CR 读未声明路径没有护栏」（2026-10-08）：P1-1 点名的两个 CR 读方法当时没有修。**
- [x] (2026-10-08 02:00 +08:00) 独立 owner 在最终 HEAD 重跑验收与五条变异，全部如期 RED、逐条字节还原；保持 Active，待合并后归档。
- [x] (2026-10-08) P0 发布证据（评审修订轮回读补入，在任意目录运行）：`gh pr view 288 -R SingularityKChen/harness-projects --json closingIssuesReferences --jq '[.closingIssuesReferences[].number]'`（期望 `[205]`）；`gh api graphql -f query='query{repository(owner:"SingularityKChen",name:"harness-projects"){issue(number:205){closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{number}}}}}'`（期望含 `288`）；`gh api 'repos/SingularityKChen/harness-projects/issues/288/timeline?per_page=100' --jq '[.[]|select(.event=="ready_for_review")]|length'`（期望 ≥ 1，说明以 draft 创建、后转 ready）。
- [x] (2026-10-08) 第 1 轮 MVP 评审（评审会话，在 PR head `6daa845b` 上）：APPROVE，3×P2 / 8×P3，无 P0/P1；11 条意见与探针、变异证据由评审会话保存。
- [x] (2026-10-08 11:21 +0800) 评审修订轮（评审会话接手，检出 `test/development-subset-contract`）：11 条意见逐条判定均属实并修复，见 Decision Log 与 `Outcomes & Retrospective`「评审修订轮」。
- [x] (2026-10-08) 修复复评（独立复评，在本地修订 head `e922de75` 上）：0×P0–P2、5×P3，确认第 1 轮 11 条意见均已修复。
- [x] (2026-10-08 12:07 +0800) 修复复评的 5 条 P3 修订完成，见 Decision Log 与 `Outcomes & Retrospective`「修复复评修订」。

## Surprises & Discoveries

#205 并非零交付：remove key、objects 与 CR 守卫已在 main，计划只针对剩余缺口。证据为当前 METHOD_KEY、注册时 objects 必填断言及已知写入后的 notDeepEqual。

无故障普通 Local Git 已通过现套件，不证明更小子集可用。独立调查的省略 branch/worktree 探针出现 `provider.createBranch is not a function`，直接定位前置假设，而非 provider 功能缺失。

fake 方法先 blocked 后 capability guard，与 port 的“能力整体不存在优先”在 fault 交叉组合存在已知差异。候选 A/B 建议生产修复被本计划拒绝；范围收口是正常子集与已声明 fault，未声明 × fault 未验收，不表述为全输入合规。 **Superseded by Design「故障边界的精确范围」（2026-10-08）：其中两条未声明 × fault 组合不受该差异影响，已验收。**

只读 hook 无合法写入时无法证明随写入变化；不能伪造写 API 来补证据。动态 freshness 判别由有写入的 full fake/Local Git 正控承担，范围在 Design 中明确。

RED 复现确认根因不止 createWorktree：旧 suite 在「真实省略 createBranch/createWorktree 方法」的合法子集上 8/10 用例红，全部是 `provider.createBranch is not a function`。因此 `METHOD_KEY` 必须补齐 createBranch/createWorktree/getWorktree/removeWorktree，光补 worktree 一族不够。

`node --test` **吞掉传给测试文件的 argv**（实测 `process.argv` 只剩 node 与文件路径），位置参数不能用来选 adapter；adapter 选择只能走环境变量 `DEVELOPMENT_SUITE_ADAPTER`。

父测试在测试进程里 `execFile('node', ['--test', fixture])` 时，子进程会继承 `NODE_TEST_CONTEXT=child-v8`，于是 `node:test` 判定为「测试文件内递归调用 run()」，**skip 全部用例并以 0 退出**——任何坏 adapter 都会被误判成通过。meta-test 必须删除该变量再 spawn（否则判别力静默归零）。

「能建不能读」形态暴露了旧用例的一个隐含假设：移除正控依赖「创建出的工作树」，读取正控依赖「创建结果」。修正后读取在创建不可用时读 `expect.worktreeRef` 指向的**预置**对象，移除在没有创建能力时只做 NS 与零副作用断言——两者都不再跳过。

同名分支复用掩蔽过一条判别：Local Git 的分支不可检出性来自「已被其它工作树检出」，而套件原先复用 `worktreeBranch` 作为重复创建的分支，导致 `-dup` 用例在 branchCreate 关闭的 fixture 上因分支已被前序用例占用而假红。新增 `expect.worktreeDupBranch` 后该用例拥有独立分支。

**独立对抗验证发现（2026-10-08，PASS-with-findings / 无 P0）**：`packages/` 零差异与 skip/todo=0 已实证，6 个变异全部如期 RED；但判别力分布有结构性缺口。

P1-1：20 个坏 adapter 里 18 个只靠子进程矩阵拦截，主用例侧不可达。实测把 `assertUndeclared` 整体 no-op 时主用例仍 64/65 绿、把 `assertObjectsUnchanged` no-op 时主用例全绿；`ns-sideeffect-getChangeRequest` / `ns-sideeffect-listChangeRequests` 在主用例路径完全没有被拦。根因：未声明的两个 CR 读方法在主用例里只经 `probeOptional`（只取结果、不比较 objects），写方法在主用例由**合法** adapter 覆盖，liar 只出现在子进程。

P1-2：`worktreeCreate:false` 形态漏填 `expect.worktreeRef` 时失败信息是 undefined 解引用，而不是「测试装配缺字段」。

P2-1：`docs/README.md` 索引与 ExecPlan 头部状态仍写「S1 未实施」，与本 PR 内 Progress/Outcomes 自相矛盾。

P2-2：`getWorktree` 的 `path === externalId` 在替身上是构造等价（同义反复）；`assertFreshAfterWrite` 第一步对每次 `structuredClone` 的合法 adapter 恒真，只对 alias 形态有判别力。

最终 HEAD 复核时发现共享检出已从先前的 `33a39b6c` 推进为 `775e933b`，且初检文档有未提交改动；先锁定最终 HEAD 与干净状态再复跑，不能把初检时的脏状态误报为最终交付状态。SSH `git ls-remote` 一度报远端断开（exit 128），重试成功读到 `775e933b`，与 PR API head 一致；此为瞬时连接失败，不是持续阻塞。 **Superseded（2026-10-08）：`775e933b` 只是那次独立验收时的 head，其后又追加了验收证据提交；PR 当前 head 用 `gh pr view 288 -R SingularityKChen/harness-projects --json headRefOid` 回读，本文不记录。**

**第 1 轮评审发现（2026-10-08，评审会话）**：三处判别力缺口都是「看起来有护栏、实际没有」。

两条未声明 × fault 断言是按错误前提删掉的。Batch S1 删除 base 的「offline × 未声明 listChangeRequests」与「ambiguousCreate × 未声明 createChangeRequest」，注释理由是「fake 先 blocked 后 capability guard」。但 fake 永远声明 `change_request.read`，到不了前者；fake 的 `createChangeRequest` 先查能力再查 ambiguous。证据：在 6daa845b 上原样加回两条，contract 67/67、Local Git 57/57 全绿；探针 `cr-read-undeclared-offline-first`、`cr-create-undeclared-ambiguous-first` 在 base 红、在 6daa845b 绿，即本 PR 让它们变成假绿。

`objects-alias` 负控没有判别力，而它护着的 alias 断言本身也护不住任何东西。负控的 `makeProvider` 忽略 scenario，fault / 能力关闭用例必然红；期望片段「可变 alias」写在 label 里，每条用例名都带着它。删掉 alias 断言（S10）contract 仍 67/67。进一步实测（评审修订轮，在修订前的 head 上）：删掉 alias 断言后，诚实的 alias 钩子 10/10 通过，带副作用的 alias liar 仍红在「被拒的 createBranch（development.branch.create） 不得改动任何对象」；反过来去掉 `captureObjects` 的克隆，副作用就被掩盖（那条断言消失），而 alias 断言此时是 `raw === clone` 的同义反复。挡住 alias 的是取样时的克隆，不是那条断言。 **Superseded by Surprises「修复复评发现」（2026-10-08）：那条断言顺带拦住了克隆有损的恒定快照，「护不住任何东西」不成立。**

CR 读未声明路径没有护栏。`getChangeRequest` / `listChangeRequests` 未声明时只走 `probeOptional` + `assertNotSupported`，不比较 objects；坏 adapter 矩阵与主用例自检只遍历五个可选方法。删掉这两处 NS 断言（S7 / S8）contract 与 Local Git 全绿；「未声明但偷偷写入一条 CR」的探针在 6daa845b 上 10/10 绿。上方 P1-1 的「修复完成并复验」因此对这两个方法不成立。

`rule-checks size` 只计**已提交**的 HEAD：评审修订轮在工作区已有改动时运行，仍报告提交前的 837。Outcomes 里「代码桶 0 行」很可能就是在实现未提交时测的。

**修复复评发现（2026-10-08，独立复评，在 `e922de75` 上）**：五条都是本轮修订自己引入或漏掉的。

只克隆取样一侧时，克隆有损的恒定快照重新变成假绿。`structuredClone` 丢掉 class 原型、null 原型与 symbol 键，`deepStrictEqual` 却比较它们；重读值原样比较时，`notDeepEqual` 恒真。复评探针（钩子按 provider 缓存一份永不变化的快照）`static-classinstance-full` / `static-nullproto-full` / `static-symbolkey-full` 在 base 与修复前都是 7 pass / 3 fail，在 `e922de75` 上 10 / 0；诚实的、每次新建 class 实例的钩子在 `e922de75` 上 8 / 2，误红在「不得改动任何对象」。被删掉的 alias 断言（raw 与 clone 比较）当时顺带拦住了这一类。

L1 的「冗余」判断错了。变更请求用例的输入是 head = base，谱系用例是 head ≠ base；只在 head ≠ base 时偷写的未声明 createChangeRequest 只有谱系用例能拦，L1 变异下该探针 10 / 0。

失败首行的提取依赖 spec reporter。`NODE_OPTIONS=--test-reporter=tap` 下矩阵对所有坏 adapter 都失败（误红，不是假绿）。复评建议「CLI 加 `--test-reporter=spec` 覆盖 NODE_OPTIONS」，实测 Node 26 不是覆盖而是叠加：子进程以 `The argument '--test-reporter' must match the number of specified '--test-reporter-destination'. Received [ 'tap', 'spec' ]` 拒绝启动，连合法 adapter 都红。

故障边界的文字漏了 getWorktree：它是读方法，但同样先过 `gate.blocked` 再查能力开关。另有四处被本轮推翻的旧结论（L12、L108、L109、L123）没有就地标注。

## Decision Log

决策：有限 METHOD_KEY 与理论 capability 驱动，不按 provider 名或 scenario flags 分支。Rationale：保持一个事实源，权限故障与实现声明正交。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：全部修改限测试和 fixture，不改变生产 fake。Rationale：issue 明确 Out of Scope，remove key 已存在；fault 交叉差异不能借套件扩展暗改。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者，任务范围确认。

决策：保留正常矩阵每方法双向证据，故障只验已声明路径，不扩大 undeclared × offline/permissionDenied。Rationale：正常真实子集必须通过，当前 fake 的组合缺陷如实限定而不洗成已修复。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者，任务范围确认。 **Superseded by 本节 2026-10-08「恢复两条未声明 × fault 断言」（2026-10-08）：「故障只验已声明路径」不包括删除 base 已有断言。**

决策：本轮只发布计划 draft，S1 未执行。Rationale：当前人类授权阶段；spec 与 plan 合一并执行独立审评，无重复阶段批准。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权。**Superseded by 本条下方 2026-10-08 的 S1 执行决策（2026-10-08）：S1 已实施并通过验证。**

决策：S1 只改 suite、合同装配、Local Git 集成与新建 adapter fixture，`packages/` 零差异。Rationale：issue #205 的 Out of Scope 是硬约束，不能靠给 fake 加能力让测试变绿。日期/作者：2026-10-08 / 实现 owner。

决策：坏 adapter 判别放在 `execFile` 子进程，选择方式用环境变量而非位置参数。Rationale：`node --test` 吞 argv；子进程隔离避免预期红污染绿色验证。日期/作者：2026-10-08 / 实现 owner。

决策：新增 `worktreeDupBranch` 与「能读不能建」「能建不能读」两个真实子集装配。Rationale：原用法复用了同一分支，重复创建用例在合法子集上假红；两个子集形态是 Design 明确要求且此前无判别证据。日期/作者：2026-10-08 / 实现 owner（简化实现，未改生产）。

决策：未声明 × offline/permissionDenied 交叉组合保持未验证并在 `Outcomes` 如实记录，不顺手改 fake 守卫。Rationale：计划边界固定，生产 fake 的 fault 顺序差异是独立于本项的产品问题。日期/作者：2026-10-08 / 实现 owner。

决策：主用例侧的「未声明」判别改为自检装配，而不是把 liar 塞进真实子集 adapter。做法：`development-contract.test.js` 对五个可选方法各构造「快照不声明、方法存在且写 state / 返回成功 / retryable=true」的 proxy（`withUndeclaredMethod`），断言导出的 `assertUndeclaredRejected` 在具名断言处拒绝；合法子集 adapter 保持诚实、不被污染。Rationale：P1-1 的结构性缺口只有「契约由装配自检」才能闭合；与子进程矩阵形成两层证据。日期/作者：2026-10-08 / 实现 owner（独立对抗验证 P1-1）。

决策：`NODE_TEST_CONTEXT` 负控改为「两半」断言——带变量运行坏 adapter 必须零退出且输出含 skip 证据，同时经生产路径 `runAdapter` 运行必须非零退出并命中具名断言。Rationale：只断言前半段时，删掉 `delete env.NODE_TEST_CONTEXT` 不会让负控红（前半段依然真）；加上后半段，删除行为与断言直接冲突。日期/作者：2026-10-08 / 实现 owner（独立对抗验证 P1-1 第 1 项）。

决策：新增 `needExpectField` 显式装配校验与三个 `objects`/字段负控 adapter。Rationale：形态要求哪些预置字段由能力声明决定，缺字段是**测试装配**问题，失败信息必须点名 `expect.worktreeRef` / `expect.worktreeBranch`，而不是 undefined 解引用。日期/作者：2026-10-08 / 实现 owner（P1-2）。

决策：把 `assertFreshAfterWrite` 的 alias 断言保留但加注释说明判别力边界（对合法 clone 恒真、只对 alias 形态有判别力），并把 getWorktree 的路径断言改为完整 ref 身份比较（path 相等保留为可读证据）。Rationale：删掉 alias 断言会失去 `objects-alias` 负控的判别点，但把它当充分证据是过度声明。日期/作者：2026-10-08 / 实现 owner（P2-2）。 **Superseded by 本节 2026-10-08「删除 alias 断言」（2026-10-08）。**

决策：代码桶 837 行（超本文档自设 800、在仓库门禁 1000 内）就停在实测值，不再为凑 800 删判别性断言或拆文件。Rationale：P1-1 明确要求五个可选方法的「未声明 + 真副作用」具名断言与 `NODE_TEST_CONTEXT` 两半负控，这些是 704 → 837 的主要来源；本轮已先去重重复定义与冗余注释（第二轮新增从 336 行收敛），剩余行数基本是断言与夹具本身。日期/作者：2026-10-08 / 实现 owner（体量收敛轮）。

决策：最终独立验收不再压实体量。已尝试合并 liar 表、复用 `SUITE_EXPECT` / `baseProvider` / `omitMethods`、去掉重复 Proxy 与冗余注释；这些把代码从 868 收敛到 837，继续删具名断言或拆文件凑 800 无净收益。第五变异选择删 `implemented()` 的具名断言而非重复恒定 objects 负控，确认 available + absent 仍由 meta-test 判别。日期/作者：2026-10-08 02:00 +08:00 / 独立验收 owner。

决策：评审修订与合并收尾由评审会话接手。Rationale：#288 由 Codex 会话创建，没有可接手的 Claude 作者会话；人类伙伴在评审会话中明确指定由该会话负责修复、归档、整合提交、复评与 rebase merge。日期/作者：2026-10-08 / 人类伙伴（评审会话记录）。

决策：恢复两条未声明 × fault 断言，按 base 原文用 `assertUndeclared`（只断言结构化 not_supported），注释改成只描述真正受影响的组合。Rationale：port 义务 1 要求未声明的能力对任何输入都答 not_supported；fault 用例看护的是「能力判定先于故障」，副作用不随 fault 变化，已由无故障变更请求用例的完整判定承担。另加子进程负控 `cr-read-offline-first` / `cr-create-ambiguous-first`（fault 下先答平台错误、否则诚实 NS），让这两条断言在仓库内就有判别点，不只靠外部探针。日期/作者：2026-10-08 11:21 +0800 / 评审会话（P2-1）。

决策：未声明 CR 读改走 `expectOptional`（结构化 not_supported + 对象集合不变）。fake 没有关闭 `change_request.read` 的开关且本项不改 fake，所以 CR 读 liar 建在 fixture 层：`withUndeclaredMethod` 剥掉快照里的键，同键的另一个读方法诚实答 NS，只扭曲一个方法（`undeclared-success` / `ns-sideeffect` × 两个读方法）。谱系用例的 createChangeRequest 回到 `expectOptional`（恢复 base 的 objects 比较）；它的读回在 read 未声明时不再调用读方法，与注释一致。Rationale：未声明判定只有一个入口，不靠调用点各自记得比较 objects。日期/作者：2026-10-08 11:21 +0800 / 评审会话（P2-3）。

决策：删除 alias 断言，`objects-alias` 坏 adapter 改成合法的 `good-objects-alias`，`captureObjects` 只返回取样即克隆的快照。Rationale：见 Surprises「第 1 轮评审发现」第二段的实测——alias 断言只会拒绝诚实的 alias 钩子，在唯一会出问题的配置（不克隆）下又是同义反复；真正的机制是克隆，合法 alias adapter 让去掉克隆的变异红在「新鲜快照」。 **Superseded by 本节「取样与重读两侧都克隆」（2026-10-08）：「alias 断言只会拒绝诚实的 alias 钩子」不成立，它顺带拦住了克隆有损的恒定快照。删除它仍成立，缺口由两侧克隆补上。**日期/作者：2026-10-08 11:21 +0800 / 评审会话（P2-2）。

决策：矩阵只在失败消息里匹配片段，且要求同一条消息含全部片段；坏 adapter 一律下传 scenario。`runAdapterRaw` 只收子进程输出里的错误首行（`XxxError [CODE]: 消息`），用例名与 label 不在其中。可用缺失 / 未声明成功 / 拒绝却写入三类要求消息同时点名方法、key 与对应具名断言；裸 throw 的 liar 消息不再含方法与 key，期望只剩「裸异常」——它证明套件真的调用了未声明方法，失败来自 liar 自己的异常，不是套件的具名断言。Rationale：原先方法名由 label 自带、key 由 liar 自己的消息提供，「在具名断言处非零退出」对这些片段不成立。日期/作者：2026-10-08 11:21 +0800 / 评审会话（P2-2、P3）。

决策：删掉 `if (canCreate)` 内两条「快照必须声明可用」的断言，不改写。Rationale：canCreate 本身就是 `declares()` 的结果，断言恒真；「方法能用而快照说不可用」的反方向由 `expectOptional → assertUndeclaredRejected` 判定，注释改到那里。日期/作者：2026-10-08 11:21 +0800 / 评审会话（P3）。

决策：取样与重读两侧都克隆，在 `developmentContractSuite` 注册时把 `expect.objects` 包一次，`captureObjects` 随之删除。Rationale：只克隆一侧会让克隆有损的恒定快照假绿、让诚实的 class 实例钩子误红（见 Surprises「修复复评发现」）。不在两个断言里各套一层，是为了让以后直接调用 `expected.objects` 的用例（例如 #287 的 `const before = await expected.objects(provider)`）也自动比较克隆。导出的 `assertUndeclaredRejected` 不再自己克隆，前提写在它的注释里：调用方的钩子必须每次返回独立快照（主用例自检用的 `SUITE_EXPECT` 本身就克隆）。新增合法 adapter `good-objects-class-instance`，让「只克隆一侧」的变异红。日期/作者：2026-10-08 12:07 +0800 / 评审会话（修复复评 A）。

决策：新增随输入变化的坏 adapter `ns-sideeffect-createChangeRequest-lineage-input`（未声明 createChangeRequest 始终答结构化 not_supported，只在 head ≠ base 时写入），而不是收窄措辞。Rationale：谱系用例里恢复的 objects 比较是这类 liar 的唯一判别点，没有负控就会被当成冗余删掉；新增 adapter 只有十余行。日期/作者：2026-10-08 12:07 +0800 / 评审会话（修复复评 B）。

决策：矩阵子进程固定 `--test-reporter=spec`，并从继承的 NODE_OPTIONS 里删掉 `--test-reporter` / `--test-reporter-destination` 参数。Rationale：失败首行的格式属于 spec reporter；实测 Node 26 把 CLI 与 NODE_OPTIONS 的 reporter 叠加，个数与 destination 不符时直接拒绝启动，所以只加 CLI 参数不够。其余 NODE_OPTIONS 原样保留。日期/作者：2026-10-08 12:07 +0800 / 评审会话（修复复评 C）。

## Idempotence and Recovery

fake 用独立实例；每种 Local Git 模式有独立 mkdtemp 根，先 realpath，再用 argv runner 操作。清理只由 fixture 已登记的临时根执行，不访问用户工作树。重复运行重新造 fixture，不依赖上一次残留。

坏 adapter 在子进程运行，父测试明确断言故意失败位置与退出码，避免全套预期红污染绿色验证。子进程设有限 timeout，游标遍历自带上界，失败不挂住测试。

S1 失败保留差异并停本批，不能靠给 provider 加能力修复测试。与 #279 整合后重锁 head 并重跑全部相关契约；整体回滚测试/fixture 即恢复原 suite，不碰产品、key 或数据库。

draft 发布重试先查同分支 PR；最终 push 后回读 head/base/checks/threads 与两侧关联，不 ready、不 merge、不写 Status 或阻塞关系。共享历史改写遵循恢复锚点与 Git 专家流程。

## Interfaces and Dependencies

suite adapter 的原 `makeProvider(scenario)` 与必填 `objects` 保留；新增 expected 字段只定位测试预置对象：`worktreeBranch`（未被检出的预置分支）、`worktreeRef`（独立预置工作树定位子）、`worktreeRefBranch`（该工作树检出的分支）、`worktreeDupBranch`（重复创建用例专用分支）。METHOD_KEY 中五可选能力方法与两个 CR 读取方法按各自 key 判断；reconcile 未纳入能力方法矩阵。

Node、锁定 pnpm、Git 与既有 `execFile`/fixture 足够；无新 npm 包、GitHub 凭据或网络验收。Local Git 读回必须来自真实磁盘；测试 proxy 不被产品或 Host 导入。

## Outcomes & Retrospective

2026-10-07 23:05 +08:00 的实际结果是严格测试范围的 spec + plan；S1 代码、负控和真实子集未来命令尚未执行。P0 发布证据由 owner 回读后补入。

已有 fake fault 交叉差异作为现状范围记录，未声称修复；本次没有实施延期技术债，故不写 tracker。实施若发现必须延期的真实缺口，先修订闭环并登记 `docs/exec-plan/tech-debt-tracker.md`，不能暗改 issue scope。

2026-10-08 在检出 `test/development-subset-contract`（`.worktrees/development-subset-contract-plan`）实施 S1，产品 `packages/` 零差异：

- RED 证据：旧 suite 对「真实省略 createBranch/createWorktree 方法且快照不声明」的合法子集 10 用例中 8 红，失败信息为 `provider.createBranch is not a function`（分页与 fault 两条因不触碰该方法而绿）。
- GREEN：`node --test tests/contract/development-contract.test.js` → 65 tests / 65 pass / 0 fail / 0 skipped / 0 todo；`node --test tests/integration/development-local-git.test.js tests/contract/development-local-git-source.test.js` → 58 / 58 pass；`node --test tests/contract/capabilities-keys.test.js` → 8 / 8 pass。整个 contract 层 852 pass，整个 integration 层 348 pass，均 0 skip/todo。
- 五方法坏 adapter：20 个 `available-absent|undeclared-success|ns-sideeffect|bare-throw × 5 方法` 全部非零退出，输出均含方法名与对应 capability key；2 个合法子集 adapter 零退出。`objects` 三种伪造（缺失 / 恒定假快照 / 可变 alias）各自红在具名断言。 **Superseded by Decision Log「矩阵只在失败消息里匹配片段」与「删除 alias 断言」（2026-10-08）：方法名当时来自 label，alias 负控的红来自被忽略的 scenario。**
- 真实 Local Git：默认 + branchCreate 关闭 + worktreeCreate 关闭 + worktreeRead 关闭四个独立 mkdtemp 根，同一 suite 全通过，对象钩子每次从磁盘 `for-each-ref` / `worktree list --porcelain` 回读。
- `pnpm run typecheck`、`pnpm run boundaries` exit 0；`rule-checks size` 代码桶 0 行、文档桶在预算内；**Superseded by Surprises「第 1 轮评审发现」末段与 Global Constraints（2026-10-08）：该范围实测代码 837（`rule-checks size` 只计已提交 HEAD）。**`git diff --check origin/main...HEAD` 无空白错误。

遗留未验证：未声明 × offline/permissionDenied 交叉组合仍按计划不覆盖；只读实例没有合法写入，其动态 freshness 未被写入实证。二者都不是本项缺陷，作为边界如实保留。

2026-10-08 第二轮（修复独立对抗验证发现），仍在检出 `test/development-subset-contract`（`.worktrees/development-subset-contract-plan`），`packages/` 仍零差异：

- P1-1 修复：新增 `assertUndeclaredRejected`（真调用 + 结构化 not_supported/retryable + objects 不变）并导出；`expectOptional` 改用它；新增导出 `withUndeclaredMethod` 与主用例侧自检 `test('主用例路径：五个可选方法的未声明成功、真实副作用与错误语义都被具名断言拦截')`，对 5 方法 × 3 liar（undeclared-success / ns-sideeffect / ns-retryable-true）逐个断言 `assert.rejects` 且失败信息点名方法 + capability key。其中 `ns-sideeffect` 对四个写方法用真调用、对只读 `getWorktree` 用显式 state 变更制造「拒绝却动了对象」，五个方法的副作用判定均可达（逐方法探针实测五条都落在「不得改动任何对象」具名断言）。 **Superseded by Surprises「第 1 轮评审发现」（2026-10-08）：P1-1 点名的两个 CR 读方法未在此轮修复。**
- P1-1 第 1 项修复：`NODE_TEST_CONTEXT` 负控改为两半——同一坏 adapter `ns-sideeffect-createBranch` 带 `NODE_TEST_CONTEXT=child-v8` 经 `runAdapterRaw(..., { keepTestContext: true })` 必须 exit 0 且输出含 `skipping running files`、无具名断言、无 `pass N`；经生产路径 `runAdapter` 必须非零退出且输出含「不得改动任何对象」。
- P1-2 修复：新增导出 `needExpectField` 与 suite 注册时必填字段校验；`worktreeBranch` / `worktreeRef` / `worktreeRefBranch` 缺失时抛「测试装配缺 expect.<field>：…」。新增 3 个负控 adapter（`missing-worktree-ref-field`、`missing-worktree-branch-field`、`objects-missing`）。
- P2-1 修复：`docs/README.md` 索引行与 ExecPlan 头部状态改为「S1 已实施 + 对抗验证发现已修复，待最终产品审评与归档」；旧 Decision 原文保留并已追加 `Superseded by`。
- P2-2 修复：`getWorktree` 预置分支路径断言改为与请求对象身份完整 `deepEqual(read.result.value.ref, target)`（路径相等保留为可读证据，注明替身构造等价）；`assertFreshAfterWrite` 的 alias 断言保留但注释写明「对合法 clone 恒真、只对 alias 形态有判别力」。 **Superseded by Decision Log「删除 alias 断言」（2026-10-08）。**
- P3-3：`suiteFixture` 保持 module-level，但补注释说明「仅 `localGitSuite(suiteFixture)` 消费、其余用例一律 `fixtureFor(t)`」；选择「加注释」而非改用 per-test fixture，因为契约 suite 需要一个稳定共享仓库来验证跨用例的重复创建/移除语义。
- 修复后验证：contract 67/67、Local Git + source 58/58、capabilities-keys 8/8，均 0 skip/todo；全量 `node --test tests/contract tests/integration tests/e2e` 1259/1259 pass、0 skip/todo；typecheck / boundaries exit 0。
- P1-1 有效性实测（本轮）：no-op `assertUndeclared` → `✖ 主用例路径：五个可选方法的未声明成功、真实副作用与错误语义都被具名断言拦截` + `✖ development-subset-matrix-rejects-liars` + `✖ NODE_TEST_CONTEXT 负控…`（64 pass / 3 fail）；no-op `assertObjectsUnchanged` → 同样三条红（64 pass / 3 fail，首条 `Missing expected rejection: ns-sideeffect × createBranch`）；删除 `delete env.NODE_TEST_CONTEXT` → `✖ development-subset-matrix-rejects-liars`（`坏 adapter「objects-missing」必须非零退出，实际 0`）+ `✖ NODE_TEST_CONTEXT 负控…`（65 pass / 2 fail）。三次变异后均已从备份恢复，`git status` 干净、contract 67/67 复绿。
- 体量处置：P1-1 要求「五个方法各补未声明 + 真副作用具名断言」后，代码桶从 704（首轮）升至 837；本轮已把主用例 liar 表、`omittingProvider`/`expect` 重复定义、fixture Proxy 与注释收敛去重（第二轮新增 336 行压到实测 837/1000），仍超本文档自设 800、但在 `AGENTS.md` §6 的 1000 门禁内。按「真实计数优先、不为 LOC 删判别性断言」保留，并在 Global Constraints 与 Decision Log 记录。

2026-10-08 11:21 +0800 评审修订轮（评审会话接手；检出 `test/development-subset-contract`，`.worktrees/development-subset-contract-plan`），`packages/` 仍零差异。第 1 轮评审 11 条意见逐条复核均属实，按根因修复：

- P2-1：恢复 base 的两条未声明 × fault 断言（原文），改正注释与 Design 的故障边界；新增子进程负控 `cr-read-offline-first` / `cr-create-ambiguous-first`。评审探针 `cr-read-undeclared-offline-first` 9 pass / 1 fail（红在「权限被拒与离线都是结构化失败」），`cr-create-undeclared-ambiguous-first` 9 / 1（红在「创建结果不确定返回 ambiguous_result…」）；对照组 `cr-read-undeclared-honest`、`cr-create-undeclared-honest` 均 10 / 0。
- P2-2：`objects-alias` 负控与 alias 断言一并删除，改为合法 `good-objects-alias`（理由与实测见 Decision Log「删除 alias 断言」）；矩阵只在失败消息里匹配片段，坏 adapter 一律下传 scenario。
- P2-3：未声明 CR 读走 `expectOptional`；子进程新增 `undeclared-success` / `ns-sideeffect` × `getChangeRequest` / `listChangeRequests`。评审探针 `cr-read-undeclared-getCR-sideeffect`、`cr-read-undeclared-listCR-sideeffect` 均 9 / 1，红在「变更请求的每个方法按**自己**声明的能力…」。
- P3：删掉两条恒真的「快照必须声明可用」；新增 `worktree-identity-swapped` 负控；`worktreeDupBranch` 与谱系用例的预置分支改走 `need()`，suite 头补齐 `worktreeRefBranch` / `worktreeDupBranch`；Local Git 注释改用真实常量名并写明 worktreeCreate:false 形态下 `PREPARED_BRANCH` 被 `wt-prepared` 占用；合并重复的 fixture import、删掉未用的 `createFakeProviders`；Design 的 `declares` 判定、`AGENTS.md` 章节号、代码桶、`775e933b` 与 P0 证据就地订正。
- 子进程矩阵：3 个合法 adapter 零退出；31 个坏 adapter 非零退出，且各有一条失败消息同时含全部期望片段。
- 验证：`node --test --test-timeout=120000 tests/contract/development-contract.test.js tests/integration/development-local-git.test.js` → 124 / 124 pass；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` → 1265 / 1265 pass，0 skipped / 0 todo；`pnpm run typecheck`、`pnpm run boundaries` exit 0；三个文档契约测试、`rule-checks size`（代码 895 / 1000）、`rule-checks disclosure` 与 `git diff --check origin/main...HEAD` 通过。
- 最终树变异（编号沿用第 1 轮评审的变异编号，′ 表示在新代码上的等价变异；每次只改一处或一组锚点，锚点恰好一次，跑完逐字节还原；运行前后 `git diff --quiet HEAD`）。下表「红」指 `tests/contract/development-contract.test.js` 失败的用例：
  - 主用例自检 + 矩阵 + `NODE_TEST_CONTEXT` 负控同红：S1 no-op `assertUndeclared`、S2 no-op `assertObjectsUnchanged`（各 64 / 3）。
  - 多个套件实例红：S3 `declares` 恒真（49 / 18）、S4 恒假（21 / 46）、S5 删 getWorktree 键（55 / 12）、S17 外来拒绝恒 not_found（63 / 4）。
  - 只有矩阵红（66 / 1），括号内为红的坏 / 好 adapter：S6 移除改用 `assertUndeclared`（`ns-sideeffect-removeWorktree`）、S7a / S7b getChangeRequest 退回旧写法 / 不判定（`ns-sideeffect-getChangeRequest` / `undeclared-success-getChangeRequest` 片段缺失）、S8a / S8b 同理 listChangeRequests（`ns-sideeffect-listChangeRequests`）、S9 删 freshness（`objects-static`）、S10′ 去掉取样克隆（`good-objects-alias` 红在「新鲜快照」）、S13 删 `implemented()` 断言（`available-absent-createBranch` 片段缺失）、S14 弱化 worktreeRef 的 `need`（`missing-worktree-ref-field`）、S16 删完整 ref 身份比较（`worktree-identity-swapped`）、S19 getWorktree 未声明改走 probe（`ns-sideeffect-getWorktree`）、F1 删 bare-throw 注册（覆盖检查）、F2′ 裸异常消息去掉片段、F2b 片段只放进 label（均 `bare-throw-createBranch` 片段缺失）、R1′ / R2′ 删掉恢复的两条（`cr-read-offline-first` / `cr-create-ambiguous-first`）、N1 删 CR 读 liar 注册（覆盖检查）、N2 fault-first liar 变诚实、N3 身份 liar 变诚实。
  - S15 删 retryable 断言：主用例自检红（66 / 1）；S18 `labelOf` 去掉方法名：主用例自检 + 矩阵红（65 / 2）；C1 保留 `NODE_TEST_CONTEXT`、F3 副作用 liar 变诚实：矩阵 + 负控红（65 / 2）。
  - S11 / S12 不再适用（两条恒真断言已删除，锚点 0 次）。L1 谱系用例的 createChangeRequest 退回旧写法：存活（67 / 67），因为同一 liar 已由变更请求用例的 `expectOptional` 判定，属于冗余而非缺口。 **Superseded by Outcomes「修复复评修订」（2026-10-08）：只对与输入无关的 liar 冗余；head ≠ base 才写入的 liar 只有谱系用例能拦，现由 `ns-sideeffect-createChangeRequest-lineage-input` 判别，L1 变红。**
  - S7a / S7b / S8a / S8b / R1′ / R2′ 在 `tests/integration/development-local-git.test.js` 上均为 57 / 57：Local Git 是诚实实现，判别点在 fake 矩阵。S10′ 下探针「alias 钩子 + 未声明 createBranch 偷偷写入」不再红在「不得改动任何对象」，即克隆是挡住 alias 的唯一机制。

2026-10-08 12:07 +0800 修复复评修订（评审会话；检出 `test/development-subset-contract`，`.worktrees/development-subset-contract-plan`），`packages/` 仍零差异。修复复评 5 条 P3 均属实：

- A：`developmentContractSuite` 注册时把 `expect.objects` 包成每次 `structuredClone`，`captureObjects` 删除；新增合法 `good-objects-class-instance`。复评探针在本树：`static-classinstance-full` / `static-nullproto-full` / `static-symbolkey-full` / `static-plain-full` 均 7 pass / 3 fail，红在「新鲜快照」；`fresh-classinstance-subset-honest`、`alias-live-full`、`getter-view-honest` 10 / 0；`alias-live-sideeffect`、`getter-view-sideeffect`、`map-view-sideeffect` 8 / 2，红在「被拒的 createBranch（development.branch.create） 不得改动任何对象」；`proxy-view-honest` 7 / 3（`DataCloneError`，与修复前相同）。
- B：新增 `ns-sideeffect-createChangeRequest-lineage-input`，只红在谱系用例；复评探针 `cr-create-sideeffect-when-head-ne-base` 9 / 1，对照组 10 / 0。
- C：矩阵子进程固定 `--test-reporter=spec` 并剥掉继承的 reporter 参数；`NODE_OPTIONS=--test-reporter=tap node --test tests/contract/development-contract.test.js` → 67 / 67，`NODE_OPTIONS="--test-reporter=dot --test-reporter-destination=stdout"` 同样 exit 0。
- D：suite 注释与 Design 的故障边界补上 getWorktree。E：L12、L108、L109、L123 就地标注 Superseded。
- 子进程矩阵：4 个合法 adapter 零退出；32 个坏 adapter 非零退出，且各有一条失败消息同时含全部期望片段。
- 验证：contract + Local Git 两文件 124 / 124 pass；全量 `node --test --test-timeout=120000 tests/contract tests/integration tests/e2e` → 1265 / 1265 pass，0 skipped / 0 todo；`pnpm run typecheck`、`pnpm run boundaries` exit 0；三个文档契约测试 15 / 15 pass；`rule-checks size` 代码 917 / 1000；`rule-checks disclosure` 与 `git diff --check origin/main...HEAD` 通过。
- 最终树变异重跑（34 行，规则同上一轮）：A1「只克隆取样一侧」（即 `e922de75` 的写法）红在矩阵——合法 `good-objects-class-instance` 非零退出（66 / 1），同一变异下探针 `static-classinstance-full` 10 / 0；S10″ 去掉注册时的克隆红在 `good-objects-alias`（66 / 1）；L1 红在 `ns-sideeffect-createChangeRequest-lineage-input`（66 / 1），同一变异下探针 `cr-create-sideeffect-when-head-ne-base` 10 / 0；N4 谱系 liar 变诚实红在同一 adapter；C2 不剥继承的 reporter 参数，在 `NODE_OPTIONS=--test-reporter=tap` 下矩阵与负控红（65 / 2，子进程拒绝启动）；S9 红在 `objects-static`。其余行与上一轮一致：S1 / S2 64 / 3，S3 49 / 18，S4 21 / 46，S5 55 / 12，S17 62 / 5，S15 / S6 / S7a / S7b / S8a / S8b / S13 / S14 / S16 / S19 / F1 / F2′ / F2b / R1′ / R2′ / N1 / N2 / N3 66 / 1，S18 / C1 / F3 65 / 2。唯一存活：C3 去掉 `--test-reporter=spec`（剥参数仍在）在 Node 26 上 67 / 67——Node 26 非 TTY 子进程的默认 reporter 就是 spec，这个固定是给 `engines` 允许的其它 Node 版本的保险，本机无法判别。

## Bottom Change Note

2026-10-07 23:05 +08:00：根据三方设计和主线反例建立计划；移除候选中的生产 fake 修复，固定正常五方法矩阵、独立 objects 判别、真实 Local Git 验收和未覆盖 fault 交叉边界。

2026-10-07 23:18 +08:00：落盘自审明确正常矩阵的 NS 与已声明 fault 用例分工，避免 ambiguous 前置修复暗中扩大未声明 × fault 组合。

2026-10-08：S1 实施完成并回填 Progress / Surprises / Decision Log / Outcomes。新增 adapter fixture、补齐五可选方法 METHOD_KEY、消除全部强制前置、补 objects freshness 与 alias 判别、真实 Local Git 四个独立能力形态；supersede「S1 未执行」的旧决策；未改任何 `packages/` 文件。

2026-10-08（第二轮）：按独立对抗验证的 2×P1 + 2×P2 修复判别力分布与发布面一致性；P3-3 选择加注释方案。主用例侧新增 liar 自检闭合「未声明 + 副作用」缺口，`NODE_TEST_CONTEXT` 负控改为两半断言，新增装配字段具名校验与三个负控 adapter；README 索引与头部状态同步已实施事实。三次变异实验（no-op assertUndeclared / no-op assertObjectsUnchanged / 删 NODE_TEST_CONTEXT 删除行）均由主用例 RED，恢复后全量 1259/1259 绿。

2026-10-08（第三轮，体量收敛）：按 Lead 要求把代码桶压回可交付区间并复核判别力。去重主用例 liar 表（三种 liar 各只对应一个具名断言）、复用 fixture 的 `SUITE_EXPECT` / `baseProvider` / 新导出 `omitMethods`、删除重复 `omittingProvider` 与重复注释；实测代码桶 837/1000（自设 800 仍超出，已按「真实计数优先」在 Global Constraints 记录）。三处变异复测仍 RED：no-op `assertUndeclared` 与 no-op `assertObjectsUnchanged` 各 64 pass / 3 fail，删 `delete env.NODE_TEST_CONTEXT` 65 pass / 2 fail；恢复后 contract 67/67、全量 1259/1259、0 skip/todo。

2026-10-08（独立 owner 验收与重构）：按验收表逐行重跑 contract 67/67、Local Git + source 58/58、capability keys 8/8、全量 contract/integration/e2e 1259/1259；全部 0 skip/todo。`pnpm run typecheck`、`pnpm run boundaries`、size、disclosure 与 `git diff --check` 均通过；`packages/` 相对 `origin/main...HEAD` 为空。五条对抗抽查均按预期 RED：no-op `assertUndeclared`（64 pass / 3 fail）、no-op `assertObjectsUnchanged`（64 / 3）、删除 `NODE_TEST_CONTEXT` 清理（65 / 2）、删除 `createWorktree` METHOD_KEY（50 / 17），以及第五条删除 `implemented()` 的具名 `typeof provider[method]` 断言（66 / 1）；每次变异后字节还原，最终工作树干净。复核后无不改变判别力的净重构可做，保留代码 837 行。

**对抗抽查证据**：对 `tests/contract/suites/development.js` 中 `assertUndeclared` 函数体改为 `return`、`assertObjectsUnchanged` 断言改为 `return`、删除 METHOD_KEY 中 `createWorktree` 行、删除 `implemented()` 内的 `assert.equal(typeof provider[method], 'function', …)`，以及对 `tests/contract/development-contract.test.js` 删除 `if (!keepTestContext) delete env.NODE_TEST_CONTEXT` 行。每次只改一处并运行 `node --test --test-timeout=120000 tests/contract/development-contract.test.js`：前两条 RED 于「主用例路径…」/「development-subset-matrix-rejects-liars」/「NODE_TEST_CONTEXT 负控…」，第三条 RED 于 17 个具名用例（含「工作树创建 / 读取 / 移除各按自己的键…」），第四条 RED 于「development-subset-matrix-rejects-liars」，第五条（环境变量清理）RED 于后两条 meta-test。每轮以变异前字节副本覆写原文件，逐字节比较 `True`；全部结束后 `git status --short` 为空。

2026-10-08 11:21 +0800（评审修订轮）：按第 1 轮评审 3×P2 / 8×P3 修订。恢复两条被误删的未声明 × fault 断言、未声明 CR 读改为完整判定、删除无判别力的 alias 断言并以合法 alias adapter 钉住取样克隆、矩阵只在失败消息里匹配片段；新增 CR 读、fault-first 与工作树身份负控；Design 的 `declares` 判定与故障边界、章节号、代码桶、`775e933b`、P0 证据就地订正并标注 Superseded；评审修订与收尾 owner 写入 Decision Log。

2026-10-08 12:07 +0800（修复复评修订）：按修复复评 5×P3 修订。取样与重读两侧都克隆（注册时包一次）、新增合法 class 实例钩子与随输入变化的谱系 liar、矩阵子进程固定 spec reporter 并剥掉继承的 reporter 参数、故障边界补上 getWorktree；L12 / L57 / L61 / L108 / L109 / L123、L1 的「冗余」结论与 alias 决策的理由就地标注 Superseded；状态行与 `completed/` 位置对齐。
