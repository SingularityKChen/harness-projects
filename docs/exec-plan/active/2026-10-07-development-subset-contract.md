# Development 真实能力子集契约 ExecPlan

> 状态：Active；设计与计划已收敛，产品批次未实施。
> 创建：2026-10-07（Asia/Shanghai）
> 关联：同仓 issue #205；规范：`PLANS.md`。
> 执行上下文：检出 `test/development-subset-contract` 的工作树根目录；隔离目录 `.worktrees/development-subset-contract-plan`。

## Purpose / Big Picture

实现者可以把完整或诚实的 Development 能力子集接入同一套契约测试。没有声明分支创建、工作树创建/读取/移除或 CR 创建的 provider 不会因套件强制调用而 TypeError；谎报可用、静默成功、拒绝时副作用与假 objects 快照必须被判别测试抓到。

最小成功证据是同一 suite 在无故障完整实例、三个剩余能力关闭实例和五个可选方法真实省略实例上全部通过；每方法的坏适配器在具名断言处失败；真实 Local Git 子集继续通过，无新增移除或 CR 功能。

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

理论 capability 与 permission 分开。`declares(provider, method)` 看快照的 `capability[key]` 是否声明 available；正常矩阵另验证 effective access。故障 permissionUnavailable 不能把已实现方法改判为 undeclared。场景 flags 只负责构造，suite 不用 flags/provides 决策。

每个正常矩阵输入的判定相同：声明可用则方法必须存在，执行真读写并验证结果；未声明且方法缺失则验证有效 unavailable；未声明且方法存在则真调用，必须结构化 not_supported、retryable false、objects 不变。外来引用在已声明时 not_found，未声明时仍 not_supported。

消除所有强制前置：branch 创建不可用时从已有分支读取；worktree 创建不可用时不先建 branch；worktree 读取可用但创建不可用时读预置对象；remove 可用但 create 不可用时移除独立预置对象。不能用返回、skip 或 todo 跳过整个用例。

adapter 可新增 `expect.worktreeBranch`（预置且未被检出的分支）和 `expect.worktreeRef`（独立预置工作树定位子）。这些是对象身份，不是第二份能力真源。每种真实 Local Git 模式使用独立临时仓库/路径；重复创建用自己 `-dup` 路径，不复用其它用例残留。

objects 必填，允许异步；在实际已知写入前保存原返回值与 structuredClone，写后确认原快照未跟随变动且新读取发生变化。拒绝前后则完整 deepStrictEqual。这样既判别恒定假快照，也抓到可变 alias 掩盖副作用。只读实例没有合法写入时，仅验证拒绝不改变对象，不宣称其动态 freshness 已被写入实证。

故障范围固定：保留已声明能力的 permission_denied、unavailable、ambiguous_result 独立用例；正常未声明矩阵含 foreign。未声明 × offline/permissionDenied 的交叉组合本次不扩展。当前 fake 先 `gate.blocked` 后 capability guard，组合时可能返回平台错误；这是既有事实，本次不改产品、不伪称所有 fault 组合合规。

拒绝按 provider 名拆 suite 与 adapter 另报 supports：二者都会弱化可替换性并引入另一事实源。拒绝为了新矩阵移动生产 fake 守卫：违反 #205 Out of Scope。对测试 proxy 的省略/保留 NS stub 必须明确是测试对象，不能掩盖真实生产组合缺陷。

## Global Constraints

唯一允许改动集如下；当前仅计划与索引，S1 仅测试代码。

| 类型 | 路径 | 职责 |
|---|---|---|
| 当前文档 | `docs/exec-plan/active/2026-10-07-development-subset-contract.md`、`docs/README.md` | spec + plan 与索引 |
| 测试 | `tests/contract/suites/development.js` | 每方法守卫、前置与对象证据 |
| 测试 | `tests/contract/development-contract.test.js` | 真省略、NS stub、坏 adapter discriminator |
| 集成 | `tests/integration/development-local-git.test.js` | 同 suite 的真实子集装配 |
| 夹具 | `tests/integration/local-git-fixture.js` | 仅必要的独立预置对象与 fresh 回读 |
| 将新建测试夹具 | `tests/fixtures/development-suite-adapters.mjs` | 子进程注册坏 adapter，避免预期失败污染父测试 |

不改 capabilities、fake 产品、Local Git 产品、Storage、core 或应用。五可选方法矩阵不能通过新增 remove/CR 行为使适配器通过。无兼容桥、迁移、新依赖或测试框架。

Node `>=22`、pnpm `10.28.2`；每 PR 代码/测试/夹具增删合计不超过 800，文档增删合计不超过 1300。预计 suite 180–250、矩阵/meta 测试 140–220、真实 fixture 40–90，合计 360–560；文档约 230–300。避免重排整份 suite 造成无意义增删；真实计数优先。

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
3. 逐个修 round-trip、分页、worktree/create/read/remove、CR-off、lineage、foreign、duplicate、ambiguous 前置。正常矩阵可用才调用 implemented，不可用仍完成 snapshot、NS 与 objects 证据。fault 用例只调用理论已声明的方法；未声明方法的 NS 证据由无故障矩阵承担，不在 fault 场景追加调用。只读分支分页使用已有数据；有创建能力的正控仍造至少三个分支跨页。
4. 写 `development-subset-matrix-rejects-liars` meta-test。用 `execFile` 的 argv 调用独立 node --test 子进程加载将新建 fixture；每个坏 adapter 预期非零退出且输出含对应 key/具名断言。五方法逐个测试 available+absent、undeclared+success、NS+sideeffect、裸 throw；另测 missing objects、静态 objects、可变 alias。正常 adapter 子进程必须零退出，不能“任何失败都算成功”。
5. 保留 full fake 的每个已知 branch/worktree/CR/remove 写入后 fresh 正控。before 的原值与 clone 分开，使 alias 被写后不可变断言抓到。拒绝路径比较完整对象集合，不能只看数组长度。重跑第一条命令 GREEN。
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

期望全部 pass / exit 0；父 meta-test 通过意味着正常子进程通过而指定坏 adapter 被具名断言拒绝。Local Git 正常子集与现路径/argv 检查保持。回滚整体 S1 测试与 fixture，产品行为与已有 remove key 原样，无外部系统写入。

## Validation and Acceptance

| 验收项 | 判定证据 |
|---|---|
| 正常完整与三剩余能力关闭 | 同 suite 全部用例运行并通过 |
| 五方法真 absent + unavailable | 五 proxy 逐个通过，无裸 TypeError |
| 五方法 present + undeclared | 真 NS、nonretryable、objects 不变；含 foreign |
| available + absent | 各 key 的具名 implemented 断言红 |
| undeclared 成功、NS 副作用、裸 throw | 各方法 meta-test 要求对应子进程红 |
| objects 是完整独立当前快照 | 必填检查、已知写入正控、静态/alias 负控 |
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
- [ ] (2026-10-07) P0 文档验证、draft 与双向 issue 回读。
- [ ] (2026-10-07) S1 子集 RED → GREEN、五方法负控、fresh hook 与真实 Local Git 验收。
- [ ] (2026-10-07) 最终独立产品审评、证据与完成归档。

## Surprises & Discoveries

#205 并非零交付：remove key、objects 与 CR 守卫已在 main，计划只针对剩余缺口。证据为当前 METHOD_KEY、注册时 objects 必填断言及已知写入后的 notDeepEqual。

无故障普通 Local Git 已通过现套件，不证明更小子集可用。独立调查的省略 branch/worktree 探针出现 `provider.createBranch is not a function`，直接定位前置假设，而非 provider 功能缺失。

fake 方法先 blocked 后 capability guard，与 port 的“能力整体不存在优先”在 fault 交叉组合存在已知差异。候选 A/B 建议生产修复被本计划拒绝；范围收口是正常子集与已声明 fault，未声明 × fault 未验收，不表述为全输入合规。

只读 hook 无合法写入时无法证明随写入变化；不能伪造写 API 来补证据。动态 freshness 判别由有写入的 full fake/Local Git 正控承担，范围在 Design 中明确。

## Decision Log

决策：有限 METHOD_KEY 与理论 capability 驱动，不按 provider 名或 scenario flags 分支。Rationale：保持一个事实源，权限故障与实现声明正交。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者。

决策：全部修改限测试和 fixture，不改变生产 fake。Rationale：issue 明确 Out of Scope，remove key 已存在；fault 交叉差异不能借套件扩展暗改。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者，任务范围确认。

决策：保留正常矩阵每方法双向证据，故障只验已声明路径，不扩大 undeclared × offline/permissionDenied。Rationale：正常真实子集必须通过，当前 fake 的组合缺陷如实限定而不洗成已修复。日期/作者：2026-10-07 23:05 +08:00 / 独立审评者，任务范围确认。

决策：本轮只发布计划 draft，S1 未执行。Rationale：当前人类授权阶段；spec 与 plan 合一并执行独立审评，无重复阶段批准。日期/作者：2026-10-07 23:05 +08:00 / 当前任务授权。

## Idempotence and Recovery

fake 用独立实例；每种 Local Git 模式有独立 mkdtemp 根，先 realpath，再用 argv runner 操作。清理只由 fixture 已登记的临时根执行，不访问用户工作树。重复运行重新造 fixture，不依赖上一次残留。

坏 adapter 在子进程运行，父测试明确断言故意失败位置与退出码，避免全套预期红污染绿色验证。子进程设有限 timeout，游标遍历自带上界，失败不挂住测试。

S1 失败保留差异并停本批，不能靠给 provider 加能力修复测试。与 #279 整合后重锁 head 并重跑全部相关契约；整体回滚测试/fixture 即恢复原 suite，不碰产品、key 或数据库。

draft 发布重试先查同分支 PR；最终 push 后回读 head/base/checks/threads 与两侧关联，不 ready、不 merge、不写 Status 或阻塞关系。共享历史改写遵循恢复锚点与 Git 专家流程。

## Interfaces and Dependencies

suite adapter 的原 `makeProvider(scenario)` 与必填 `objects` 保留；新增 expected 字段只定位测试预置对象。METHOD_KEY 中五可选能力方法与两个 CR 读取方法按各自 key 判断；reconcile 未纳入能力方法矩阵。

Node、锁定 pnpm、Git 与既有 `execFile`/fixture 足够；无新 npm 包、GitHub 凭据或网络验收。Local Git 读回必须来自真实磁盘；测试 proxy 不被产品或 Host 导入。

## Outcomes & Retrospective

2026-10-07 23:05 +08:00 的实际结果是严格测试范围的 spec + plan；S1 代码、负控和真实子集未来命令尚未执行。P0 发布证据由 owner 回读后补入。

已有 fake fault 交叉差异作为现状范围记录，未声称修复；本次没有实施延期技术债，故不写 tracker。实施若发现必须延期的真实缺口，先修订闭环并登记 `docs/exec-plan/tech-debt-tracker.md`，不能暗改 issue scope。

## Bottom Change Note

2026-10-07 23:05 +08:00：根据三方设计和主线反例建立计划；移除候选中的生产 fake 修复，固定正常五方法矩阵、独立 objects 判别、真实 Local Git 验收和未覆盖 fault 交叉边界。

2026-10-07 23:18 +08:00：落盘自审明确正常矩阵的 NS 与已声明 fault 用例分工，避免 ambiguous 前置修复暗中扩大未声明 × fault 组合。
