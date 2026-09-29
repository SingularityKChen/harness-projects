# 2026-09-29-start-work-resume-evidence —— 补齐 Start Work 恢复的剩余闭环（#183）

> 状态：Completed（Batch 0–5 的实现与验证完成；PR #237 的提交整理、远端门禁与 rebase merge 按 D16 在归档后继续）。原文称 draft PR；**Superseded by** 本计划 `Surprises & Discoveries` 的 GitHub 回读：#237 已为 ready，且人类伙伴已明确要求最终 rebase merge。
> 创建：2026-09-29
> 范围：关闭 #183 的三项剩余：① 真实临时 Git 仓库上的「基线前进后续上」用例；② 被接管分支的头提交在分支多于一页时仍被报出，并出现在 controller 视图；③ Development 能力不可用的失败路径不再抹掉已记录的 `branchExternalId`。不改 Storage 契约、不改 provider 实现、不新增 capability key。
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/183>（`Closes`）；<https://github.com/SingularityKChen/harness-projects/issues/141>（`Refs`：本计划交付其中「真实本地 Git」的那一半证据，SQLite 与重启仍归 #141）
> 上游输入：#183 正文与 2026-09-24 评论（剩余三项）；`docs/exec-plan/completed/2026-09-24-start-work-recovery.md`（D1、D2、「接受的残留」、「遗留」§9）；`docs/review/2026-09-24-start-work-batch-review.md`（S8、S10）；`docs/adr/ADR-0007-provider-error-codes-carry-system-promises.md`（Proposed）。
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

本计划的章节与归档规则以仓库根的 `PLANS.md` 为准。

## Purpose / Big Picture

PR #185（`98b8a1d`）让 Start Work 的补偿序列能从分支步之后续上，但只在离线替身上作证，且留下三个缺口。完成本计划后：

1. **验收 2 有真实仓库证据**：在 `mkdtemp` 临时仓库上，用真实本地 Git provider 演示「分支步后中断 → `main` 前进 → 换新幂等键重试 → `ready`」，并以 Git argv 证明重试期间没有解析 `fromRef`。
2. **接管不再按仓库大小静默丢头提交**：分支探测读完全部页才说「不存在」，读不完只说「不知道」。于是接管路径、`conflict` 复用路径和「写入已落地但响应丢失」的对账路径，在分支多于一页时都给出正确事实；controller 的 `StartWorkView` 带出 `branchHeadCommit`。**Superseded by** Batch 5：原实现的 `conflict` 消费者忽略 `probe.error`；已用 P6 钉住读失败时仍须报 `unknown`。
3. **已决定的分支身份写一次**：执行上下文记录里的 `branchExternalId` 一经写入，任何失败路径都不能把它抹成 `undefined`；结果面报出的分支身份就是记录里存下的那个。

判断成功的最小证据（在检出 `fix/start-work-resume-evidence` 的工作树根目录、已 `pnpm install --frozen-lockfile` 后运行）：

```bash
node --test tests/integration/local-git-start-work-resume.test.js tests/integration/local-git-branch-probe.test.js  # 期望：全绿
node --test tests/integration/start-work-step-recording.test.js tests/e2e/controller-roundtrip.test.js             # 期望：全绿
pnpm verify                                                                                                          # 期望：exit 0
```

以及 Validation and Acceptance 表里每一行的「在 base 上红」与变异表的「改坏即红、还原即绿」。

## Context and Orientation

### 术语

- **补偿序列**：`startWork` 的步骤链——认领上下文 → 建分支 → 建工作树 → 启动执行（`packages/core/src/start-work.ts` 的 `provision()`，`packages/core/src/git-provisioning.ts` 的 `provisionGit()`）。
- **已决定的分支**（decided）：执行上下文记录里的 `branchExternalId`。重放时它存在就整个跳过分支步，不解析 `fromRef`（`git-provisioning.ts:129-150`）。
- **分支探测**（`branchProbe`，`git-provisioning.ts:233-243`）：按名字在 `listBranches` 结果里找分支。三个消费者：`conflict` 后的复用确认（`:181-186`）、`ambiguous_result` 后的对账（`:187-193`，经 `reconcileWrite`，`packages/core/src/write-machine.ts:108-119`）、接管路径的头提交报告（`:146-150`）。
- **租约**：`Provisioning` 记录的 `provisioningStartedAt`；30 秒内视为在途（`start-work.ts:56-64`）。测试要走「接管」分支必须让时钟越过它。
- **base**：本计划的比较基线 `origin/main`，观察时刻 2026-09-29 为 `f6a33d2`（重算：`git rev-parse origin/main`）。

### 当前状态（2026-09-29 在 `f6a33d2` 上逐项复核）

复核方式：评审者在与工作树同一提交的检出上，用 `tests/integration/local-git-fixture.js` 与真实 `LocalGitDevelopmentProvider` 写了一次性复现脚本（不入库；场景由本计划 Batch 2 的用例固化：S1 → R1、S2 → P1、S3 / S3b → R2、S4 → P2、S5 → P3、S7 / S7b → V1 与 T3，S6 只作记录）。F1–F16 都是 fact；hard constraint、assumption、unknown 在表下分列。

| # | 事实 | 证据 |
|---|---|---|
| F1 | 剩余项 ① 的**行为**已成立，缺的只是仓库内的真实仓库用例：中断在分支步后、`main` 前进、换新 key 重试 → `status: ready`、`confirmed: true`、头提交等于中断前的分支头；重试期间 argv 里没有 `branch <name> <sha>`、`rev-parse … main^{commit}`、`symbolic-ref` | 复现场景 S1；机制在 `git-provisioning.ts:129-150`；现有证据只在替身上：`tests/integration/start-work-step-recording.test.js:96-126` |
| F2 | 剩余项 ② 仍成立：`branchProbe` 只读第一页（`limit: 100`，不跟 `nextCursor`）；在目标之前放 110 个分支后，接管结果 `status: ready`、`branchHeadCommit: undefined`；第一页 `nextCursor: "100"` | `git-provisioning.ts:235-242`；复现场景 S2 |
| F3 | 同一缺陷更严重的形态 A：真实 provider 上 `git branch` 已写入但响应丢失（`ambiguous_result`），且分支多于一页时，对账把它判成 `failed / not_found`「创建未生效」，而分支就在磁盘上；0 个诱饵分支时同一场景为 `ready` | 复现场景 S4；`write-machine.ts:112-113`；provider 把未识别的写失败映射为 `ambiguous_result`（`packages/providers/development-local-git/src/provider.ts:237-247`） |
| F4 | 同一缺陷更严重的形态 B：离线替身上同名分支已存在（替身报 `conflict`）且排在第一页之外时，`startWork` 为 `failed / conflict` | 复现场景 S5；`git-provisioning.ts:181-188`。真实本地 Git provider 从不对分支报 `conflict`（`provider.ts:158-163`：同起点 `ok`、异起点 `invalid_input`），这条路径今天只在替身与未来的远端 provider 上可达 |
| F5 | controller 的 `StartWorkView` / `toStartWorkView` 不带 `branchHeadCommit`；core 结果面有它（离线替身首次调用为 `'sha-1'`）。`packages/client`、`ui-model`、`ui`、`apps` 都不消费 `StartWorkView` | `packages/controller/src/commands.ts:65-72, 96-105`；`packages/core/src/execution-context.ts:64-72`；`git grep StartWorkView -- packages apps` 只命中 controller |
| F6 | 剩余项 ③ 仍成立：以同一 storage、同一 workspace id、`capabilities: { worktreeCreate: false }` 重新组装后重试 → `failed / not_supported`，记录的 `branchExternalId` 从 `work/wi-3` 变成 `undefined`；`main` 前进后以完整能力再重试 → `failed / invalid_input`「分支 … 已存在且指向 …」。`providers: {}` 形态结果相同 | 复现场景 S3、S3b；`git-provisioning.ts:122-125` 传入 `undefined`；`start-work.ts:129` 与 `:224-236` 用 `contextRecord(...)` 整行替换 |
| F7 | 生产代码里执行上下文记录只有 `start-work.ts` 一个写者，五处：`:94`（记录不存在时新建）、`:105`、`:110`（展开 `existing`）、`:232`（`saveContext` 整行替换）、`:250`（展开 `record`）。只有 `saveContext` 会把步骤字段降级为 `undefined` | `git grep -n putExecutionContext -- packages/core` |
| F8 | 能力不可用那一次只写 `tracks` 关系，不写 `has_worktree` | 复现场景 S3 的关系列表；`start-work.ts:149-150`（`slot` 取本次尝试的 `git.*`） |
| F9 | 同 key 重放走 `existingResult`，`branchHeadCommit` 恒为 `undefined`（记录没有这一列） | `start-work.ts:262-266`；复现场景 S7b；`docs/exec-plan/completed/2026-09-24-start-work-recovery.md:303` 已记录 |
| F10 | 已记录的分支在中断后被删除，之后每次重试都是 `failed / not_found`「分支不存在」。这**不是新发现**：已登记为上一份计划「遗留」§9；#211 只覆盖 `ready` 上下文，不覆盖这条中断路径 | 复现场景 S6；`docs/exec-plan/completed/2026-09-24-start-work-recovery.md:408` |
| F11 | 谱系侧 `readHeadCommit` 同样只读第一页（`PAGE_LIMIT = 50`） | `packages/core/src/chain-facts.ts:28, 94-99, 197-198` |
| F12 | 本地 Git 的 `listBranches` 用十进制 offset 游标，每页重新 `for-each-ref` 全量排序后切片；两页之间若有排在目标之前的分支被删，目标会被跳过 | `provider.ts:106-117`；替身同为 offset（`packages/providers/fake/src/state.ts:37-41`） |
| F13 | 共享契约套件的 `expect.pageSize` 被两个适配器声明为 `1`，但套件里没有任何用例使用它——分页从未被契约钉住 | `tests/contract/suites/development.js:6`；`tests/contract/development-contract.test.js:28`；`tests/integration/development-local-git.test.js:29` |
| F14 | 工作树没有 `node_modules` 时，裸包名沿父目录解析到主检出的 `packages/`；在那种状态下做的「先红」与变异都不可信 | `docs/exec-plan/completed/2026-09-24-start-work-recovery.md:296, 305`；#186 仍开启 |
| F15 | 聚焦基线：`start-work-step-recording`、`start-work-retry-identity`、`local-git-core-provisioning`、`controller-roundtrip`、`development-contract`、`development-local-git` 六个文件在 `f6a33d2` 上 95 / 95 通过（观察于 2026-09-29；重算见 Batch 0 的验证命令） | `node --test <上述六个文件>` |
| F16 | #213 的代码改动（`baseRef` 不再回落 `'main'`）已随 `547b2de` 进入 `main`，但 issue 仍开启，且 `git-provisioning.ts:220` 的注释（「用约定名继续」）与代码相反 | `git log -S'无法确定仓库基线' -- packages/core/src/git-provisioning.ts`；`gh issue view 213 -R SingularityKChen/harness-projects --json state` |

- **hard constraint**：见 Global Constraints（规模、依赖方向、看板、发布面）；另有 MMP 前不写兼容层，外部写入未 ack 前不显示权威 `Saved`（`AGENTS.md` §1.1）。
- **assumption A1**：`listBranches` 的游标在无并发写时一次遍历恰好枚举每个分支一次，`nextCursor === undefined` 表示结束。本地 Git 与替身满足，但端口与套件都没有写明——本计划把它写进端口义务与契约套件（D4）。
- **assumption A2**：以同一 storage、同一 workspace id 重新 `createContext` 并换掉 Development 能力，等价于「重启后 Development 能力关闭」（复现场景 S3 已验证可行）。
- **unknown U1**：未来远端 provider（#231）在大仓库上的逐页成本与游标稳定性；登记为技术债 T2。

### 相关文件

| 文件 | 角色 |
|---|---|
| `packages/core/src/start-work.ts` | 状态拥有者：`provision()`、`saveContext()`、`recordStartFacts()`、`existingResult()` |
| `packages/core/src/git-provisioning.ts` | `provisionGit()`、`ensureBranch()`、`branchProbe()` |
| `packages/controller/src/commands.ts` | `StartWorkView`、`toStartWorkView()` |
| `packages/capabilities/src/development-provider.ts` | Development 端口与实现义务（注释） |
| `tests/integration/local-git-fixture.js` | 真实临时仓库夹具 |
| `tests/contract/suites/development.js` | 共享 Development 契约套件（替身与本地 Git 两个适配器） |

## Design / Spec

### 不变量

- **I1 · 已决定的分支身份写一次**：执行上下文记录的 `branchExternalId` 一旦非空，之后的任何写入都保留它；`undefined` 只表示「本次尝试没走到这一步」，不表示「清空」。
- **I2 · 报出去的就是存下的**：`provision()` 在失败路径上报出的 `branchExternalId` 取自写入后的记录，而不是本次尝试的中间结果。
- **I3 · 「不存在」只能来自读完**：分支探测只有在读完全部页后才可以回答「不存在」；读失败或超出页数上限一律回答「不知道」（`probe.error`），对账因此停在 `unknown`，不会 `markFailed`。
- **I4 · 头提交只做报告**：`branchHeadCommit` 不进记录、不参与任何判定（沿用上一份计划的 D1「sha 只做报告」）。探测读不到头提交时报 `undefined`，不改变序列的走向。

### D1 · 在唯一写者处修剩余项 ③（`start-work.ts` 的 `saveContext`）

```ts
// 形状（实现以此为准，注释按仓库语气写全）：
async function saveContext(...same params...): Promise<ExecutionContextRecord> {
  const existing = await context.storage.getExecutionContext(contextId)
  const keepLease = status === ExecutionContextStatus.Provisioning ? existing?.provisioningStartedAt : undefined
  const record: ExecutionContextRecord = {
    ...contextRecord(context, contextId, request, status, existing?.branchExternalId ?? branchExternalId, worktreeExternalId, undefined),
    provisioningStartedAt: keepLease,
  }
  await context.storage.putExecutionContext(record)
  return record
}
```

- 用 `existing ?? produced`（写一次），不用 `produced ?? existing`（非空覆盖）。两者今天行为相同：`decided` 存在时 `provisionGit` 只会产出同一个名字（`git-provisioning.ts:136-150`），且租约保证同一时刻只有一个写者。选前者是因为它把 I1 写成代码，而不是写成「碰巧」。
- **只保留分支，不保留工作树句柄**：工作树步每次重放都重跑（`git-provisioning.ts:152-158`），谱系把 `worktreeExternalId !== undefined` 当作「已观察到」的锚点（`chain-facts.ts:164, 197-198`）；失败的尝试若留下旧句柄，谱系会在它上面读头提交、变更请求与流水线，违反 ack 约束。
- `recordStep` 回调的签名仍是 `Promise<void>`：回调写成 `async (outcome) => { await saveContext(...) }`。
- **为什么不在 `provisionGit` 的能力不可用分支里补传 `decided`**：那样 `GitOutcome.branchExternalId` 有值，`recordStartFacts`（`start-work.ts:149-163`）会在一条今天不写边的路径上新写一条 confirmed `has_worktree`，扩大 #192 的暴露面。本计划用断言「这一次之后 `has_worktree` 为 0」加反事实变异 M4 钉住修复位置。

### D2 · 失败路径的结果面取自写入后的记录

`provision()` 改为 `const saved = await saveContext(...)`；`!git.ok` 时返回 `outcomeOf({ ...git, branchExternalId: saved.branchExternalId })`。`recordStartFacts` 仍吃 `git`（本次尝试观测到的事实），所以不补写关系。成功路径上两者相等，不变。

理由：Host 拥有权威状态（`AGENTS.md` §1.1 不变量 7）；工作树步失败的路径今天已经报出分支（`git-provisioning.ts:159-160`），能力不可用的路径与它对齐；同一事实不再出现「调用返回 `undefined`、记录与 `existingResult` 返回 `work/x`」两种答案。写状态由 `stateForStartWork` 按 phase 决定（`commands.ts:87-94`），不受影响。

### D3 · 分支探测读完全部页（`git-provisioning.ts` 的 `branchProbe`）

```ts
const PROBE_PAGE_SIZE = 100
const PROBE_MAX_PAGES = 1000
// 逐页读，找到即停；nextCursor 为 undefined → 不存在；读失败 → 原样作为 probe.error；
// 超过 PROBE_MAX_PAGES 页 → projectError(ProjectErrorCode.ResultUnknown, 点名上限与分支名)。
```

- 函数签名与三个消费者都不变，三处缺陷（F2、F3、F4）因此一起收敛。不导出，不扩大 core 公共 API。**Superseded by** Batch 5：这只对正常分页成立；`conflict` 消费者原先丢掉 `probe.error`，列表读失败被误报为确定的 `failed/conflict`。Batch 5 在该消费者把读失败传播为 `unknown`，不改接口。
- 找到即停：常见情形只读一页。本地 Git 每页一次 `for-each-ref`，最坏 O(页数 × 分支数)，登记为技术债 T2。
- 页数上限而不是「游标重复检测」：上限同时覆盖「同一游标循环」与「游标一直前进但永不结束」两种 provider 缺陷，一个机制一条用例。上限耗尽时 1000 次调用发生在 provider 已经违反契约（D4）的前提下。
- offset 游标在并发删除下可能跳项（F12），读完仍可能漏掉目标——后果是可恢复的失败（对账 `failed` 后重试会重走 `createBranch`，本地 Git 对同名同起点返回 `ok`），概率要求毫秒级窗口内有并发删除。记为技术债 T2，终点是端口上的精确读。

### D4 · 把分页义务写进端口与契约（ADR-0007「义务写在端口里」）

- `packages/capabilities/src/development-provider.ts` 的实现义务注释加第 4 条：列表方法从 `cursor: undefined` 起逐页读到 `nextCursor === undefined`，无并发写入时恰好枚举每个对象一次；core 据此把「读完仍没有」当作「不存在」。只改注释，不改签名、不加 capability key。
- `tests/contract/suites/development.js` 新增一条用例，用适配器已声明却从未使用的 `expect.pageSize`（F13）逐页遍历 `listBranches`：遍历结果与一次大页（`limit: 1000`）的名字集合相同、无重复、最后一页 `nextCursor` 为 `undefined`；测试自身用「页数 ≤ 大页条数 + 2」给循环设界，不会被坏 provider 挂住。能声明 `development.branch.create` 时先建三条分支让遍历至少跨三页；不能声明时（未来的只读 provider）遍历既有分支。

### D5 · controller 视图带出头提交

`StartWorkView` 增加 `readonly branchHeadCommit: string | undefined`，`toStartWorkView` 透传 `result.branchHeadCommit`。只增字段，没有下游消费者需要迁移（F5）。同 key 重放仍报 `undefined`（F9），见技术债 T3。

### 证据用例（每条写明在 base 上为什么红）

| 编号 | 文件 | 用例要点 | 在 base 上 |
|---|---|---|---|
| R1 | `tests/integration/local-git-start-work-resume.test.js`（新） | 真实仓库：中断在分支步后 → 记录为 `provisioning` 且 `branchExternalId = work/<id>`、工作树为 `undefined` → `advanceMain` → 时钟越过租约 → 新 key 重试：`ready`、`confirmed`、`branchHeadCommit === A` 且 `!== B`；重试期间 argv 中没有 `branch` 子命令、没有含 `main^{commit}` 的参数、没有 `symbolic-ref`；磁盘上分支头仍是 A，工作树数为主检出 + 1，新工作树 `rev-parse --abbrev-ref HEAD` 为 `work/<id>` | **绿**（行为已随 #185 交付，这是证据型用例）；判别力由变异 M1 证明 |
| R2 | 同上 | 真实仓库：中断 → 以共享 storage / workspace / 时钟、`capabilities: { worktreeCreate: false }` 重组后重试：`failed`、`not_supported`；**记录与结果面**的 `branchExternalId` 都仍为 `work/<id>`；`has_worktree` 关系数为 0 → `advanceMain` → 以完整能力重组、新 key 重试：`ready`、头提交为 A | 红：记录变成 `undefined`（F6） |
| R3 | 同上（验收时补入，D11） | 真实仓库：中断后把记录的工作树句柄换成一个旧句柄（模拟「ready 核验失败后的终态记录被接管」），以 `worktreeCreate: false` 重组后重试：`not_supported`；记录的 `branchExternalId` 仍为 `work/<id>`、`worktreeExternalId` 为 `undefined` | 红：在分支断言上先红（base 抹掉分支）；工作树那条断言的判别力由变异 M10 证明 |
| P1 | `tests/integration/local-git-branch-probe.test.js`（新） | 真实仓库：先建 110 个诱饵分支 `a-000…a-109`，中断后断言前置条件「`listBranches({ limit: 100 })` 第一页不含 `work/<id>`」，重试：`ready`、`branchHeadCommit === rev-parse work/<id>` | 红：`undefined`（F2） |
| P2 | 同上 | 真实仓库：110 个诱饵分支；runner 先真实执行 `branch <name> <sha>` 再返回 `code: 128` 与一条不被识别的 stderr（不得命中 `provider.ts:36-42` 的 `REFUSALS`，例如 `fatal: connection reset while writing`）→ `startWork` 为 `ready`、头提交等于 `main` 的头、磁盘上恰有一条 `work/` 分支、工作树数为主检出 + 1；错误码不得是 `not_found` | 红：`failed / not_found`「创建未生效」（F3） |
| P3 | `tests/integration/start-work-step-recording.test.js` | 替身：110 个诱饵分支 + 预置 `work/<id>`，前置条件同 P1；`startWork` 为 `ready`、`branchHeadCommit === 'sha-1'` | 红：`failed / conflict`（F4） |
| P4 | 同上，`{ timeout: 5000 }` | 替身：打开 `AmbiguousCreate`，`listBranches` 覆写为永远返回 `{ items: [], nextCursor: 'again' }`、计数，并在每次调用里 `await new Promise((resolve) => setImmediate(resolve))` 让出宏任务（否则 M6 下的循环只跑微任务，计时器永远不触发，超时断言失效）：结果 `writeState: unknown`、`error.code: 'result_unknown'`，调用次数 > 1 | 红：`failed / not_found`，调用 1 次 |
| P5 | `tests/contract/suites/development.js` | 分页契约（D4），在替身与本地 Git 两个适配器上跑 | **绿**（把 A1 写成契约）；判别力由变异 M8 证明 |
| P6 | `tests/integration/start-work-step-recording.test.js` | 预置同名分支，`createBranch` 报 `conflict`，列表读返回 `unavailable`：结果为 `unknown`、未确认、无工作树；恢复列表后新 key 接管同一分支 | 评审前 head 红：`failed` 而非 `unknown`；Batch 5 实现后绿 |
| V1 | `tests/e2e/controller-roundtrip.test.js` | 在「同键重放」用例里断言 `first.value.branchHeadCommit === 'sha-1'`；不断言 replay（技术债 T3） | 红：`undefined` |

所有真实仓库用例：成功判据用 `status` / `confirmed` / 磁盘事实，不用 `result.error`（夹具没有执行 provider，`error` 恒为 `not_supported`，见 `tests/integration/local-git-core-provisioning.test.js:74-79` 的约定）；不硬编码 `.worktrees/` 字面量（#214 会移动默认根），句柄比较先 `realpath`。

### 变异表（每条先证明变异已生效，再看红，再还原）

| # | 改坏 | 必须变红的用例与失败形态 |
|---|---|---|
| M1 | `git-provisioning.ts`：`const decided = recorded?.branchExternalId` → `const decided = undefined` | R1：`failed / invalid_input`「已存在且指向」，且重试 argv 出现 `main^{commit}` |
| M2 | `start-work.ts`：删掉 `existing?.branchExternalId ??` | R2：记录的 `branchExternalId` 为 `undefined` |
| M3 | `start-work.ts`：失败路径改回 `outcomeOf(git)` | R2：结果面 `branchExternalId` 为 `undefined`，而记录为 `work/<id>` |
| M4 | 反事实修法：撤销 D1，改为在 `provisionGit` 能力不可用分支先读记录并把 `decided` 传给 `gitFailure` | R2：`has_worktree` 关系数为 1（证明修复必须落在写者） |
| M5 | `git-provisioning.ts`：探测只读第一页（循环第一轮后直接返回不存在） | P1 `undefined`；P2 `not_found`；P3 `conflict` |
| M6 | `git-provisioning.ts`：去掉页数上限（`for (;;)`） | P4 以 `test timed out after 5000ms` 被取消、退出码 1；用 `node --test --test-force-exit --test-name-pattern <P4 用例名> tests/integration/start-work-step-recording.test.js` 跑，否则后台循环会让进程不退出（2026-09-29 在 Node v26.10.0 上用最小用例核实：只跑微任务的循环连超时都不触发，让出宏任务后超时生效） |
| M7 | `commands.ts`：去掉 `branchHeadCommit` 透传 | V1 |
| M8 | `packages/providers/development-local-git/src/provider.ts`：`listBranches` 的 `nextCursor` 恒为 `undefined` | P5（本地 Git 适配器） |
| M9 | 负对照：P1 的诱饵数 110 → 98（验收时订正：原写 99。目标前面有诱饵加 `main`，下标 = 诱饵数 + 1，第一页是下标 0–99，所以 99 仍绿、98 才红） | P1 的前置条件断言变红（证明「第一页之外」是承重条件） |
| M10 | 验收时补：`start-work.ts` 的工作树句柄也写一次（`existing?.worktreeExternalId ?? worktreeExternalId`） | R3：记录保留旧句柄。补 R3 之前这条变异下全量 775 条用例全绿 |
| M1b | 验收时补：接管路径在跳过分支步之前额外解析一次基线并重发 `createBranch`（结果丢弃，序列照常 `ready`） | R1 的状态断言通过，首个失败的是「重试期间不得解析 fromRef」——M1 在状态断言上先红，argv 断言要靠它单独观察 |
| M1c | 验收时补：接管路径额外调一次 `getRepository` | R1 的状态断言与 fromRef 断言通过，首个失败的是「重试期间不得探测仓库基线」（`symbolic-ref`） |

执行方式：用编辑器或 `git apply` 施加；用 `git diff --stat` 加 `grep` 一个哨兵字符串证明改动在被测文件上；跑对应用例看到上表的失败形态；`git checkout -- <file>` 还原并用 `git diff --quiet -- <file>`（期望 exit 0）确认。不用 `cp` 备份还原。

### 被放弃的方案

| 方案 | 出处 | 放弃原因 |
|---|---|---|
| 给 `DevelopmentProvider` 加必需方法 `getBranch(name)`，core 精确读 | 设计 3 | 技术上是更好的终点（一次调用、无游标漂移），但它是端口变更：要改 capabilities、两个 provider、`registry.ts` 的 `DevelopmentProviderSurface` 与契约套件，并与 #212（同一端口的读能力，方案 A/B 待人类裁决）、#231（远端 provider 必须实现）纠缠。ADR-0007 为 Proposed，其第 3 条针对的是「写方法没有任何读方法」；#212 正文明确把 `listBranches` 视为分支的观测手段。登记为技术债 T2 的终点，并列入待人类决定 |
| 修复放在 `provisionGit` 的能力不可用分支 | 三份设计都讨论过 | 扩大 #192（见 D1）；且只修一条路径，不修写者 |
| 失败路径结果面报本次尝试（`undefined`） | 设计 1 | 与记录、`existingResult` 给出两种答案；与工作树步失败路径不一致（见 D2） |
| 工作树句柄也写一次 | 按字面套用「不可抹除」 | 谱系会把失败尝试的旧句柄当作已观察到的锚点（见 D1） |
| 接管路径在探测失败或分支不存在时直接失败 | 设计 3 | 把只做报告的头提交变成判定输入，违反 I4；分支被删后的去向属于「遗留」§9 / #211 家族，需要人类定语义 |
| 同一 PR 修 `chain-facts.readHeadCommit` | 设计 2、3 | 另一个闭环（交付谱系），`gated` 会把读错误记成能力缺口，语义要单独定；列入待人类决定 |
| 把 `branchHeadCommit` 落库，让重放也能报 | 三份设计都否决 | Storage 契约与 SQLite 列变更，超出闭环；重放报出的应是首次接管时的头，现读得到的是另一个事实 |
| 新建 `docs/exec-plan/tech-debt-tracker.md` | 设计 2、3 | `main` 上没有这个文件（`ls docs/exec-plan` 只有 `active/` 与 `completed/`）；技术债写在本计划 |

### 评审者会怎么打破它（设计时回答）

1. 「R1 在 base 上就绿」→ 它是证据型用例，判别力由 M1 给出，并且断言的是 argv 而不只是调用计数。
2. 「变异实验跑的是主检出源码」→ 每个工作树先 `pnpm install --frozen-lockfile`，并回读 `node -p "require('node:fs').realpathSync('node_modules/@harness-projects/core')"` 必须落在本工作树的 `packages/core`（F14）。
3. 「110 个诱饵分支让用例偶然成立」→ P1 / P3 显式断言第一页不含目标；M9 负对照。
4. 「探测会死循环」→ 页数上限 + P4 + M6；契约用例自身有循环上界。
5. 「offset 游标并发漏读」→ 已承认（D3、T2），后果可恢复。
6. 「写一次掩盖分歧」→ 分歧在构造上不可达（D1 第一条）；结果面取自记录（D2），报出与存下不会分叉。
7. 「能力不可用那次多写了关系」→ R2 断言 `has_worktree` 为 0，M4 证明换一种修法会红。
8. 「用例依赖全局 git 配置」→ 夹具已设 `user.*`；新增提交一律 `-c commit.gpgsign=false`；诱饵分支用一次 `update-ref --stdin` 建，不触发钩子。
9. 「把已接受的窗口写成期望值」→ 写前意图窗口（T1）不写成任何断言。
10. 「controller 重放丢头提交」→ 明确划界为 T3，列入待人类决定。
11. 「写一次顺手把工作树句柄也留下，也没人发现」→ 验收时实测 M10 全量绿，补 R3（D11）。
12. 「逐页探测把接管拖过租约」→ 最坏 1000 页、租约 30 秒且不续期；登记在 T2。

### 与相邻 issue 的交互

- **#192**：R2 断言能力不可用那次不新增 `has_worktree`；工作树步失败仍写 confirmed 边的既有缺陷不在本计划。
- **#211**：不改 `existingResult`；F10 的中断路径锁死建议并入 #211 的范围或另开 issue（待人类决定）。
- **#212**：本计划只在端口注释里加分页义务，与 #212 可能在同一段注释上产生文本冲突，后合并者合并编号。
- **#213**：跳过路径不调用 `getRepository`，不受影响；F16 的陈旧注释不在本计划改（属于 #213 的收口）。
- **#214**：新用例不硬编码默认工作树根。
- **#231**：远端 provider 需要通过 P5 分页契约；精确读 `getBranch` 的终点在那时一并评估。
- **#141**：本计划用离线 storage，不覆盖 SQLite 与重启；`tests/integration/README.md` 的「替身边界」说明据此改写。
- **#193 / #194 / #206**：不触及。

### 接受的残留（技术债务，不假装解决）

| # | 残留 | 为什么不在本计划 | 触发条件 / 去向 |
|---|---|---|---|
| T1 | 写前意图窗口：进程死在 `git branch` 与回填之间，重放仍会重推 `fromRef` | #183 正文明确接受；需要写前意图记录 | 沿用上一份计划的登记 |
| T2 | 分支探测是 core 内逐页全扫：offset 游标并发漏读、最坏 O(页数 × 分支数)；探测期间不续租，极端大仓库上耗时可能超过 30 秒租约，让另一个调用方接管 | 终点是端口精确读 `getBranch`，属于端口变更 | #231 实现远端读或 #212 定端口方案时一并做 |
| T3 | 同 key 重放 / `existingResult` 报不出 `branchHeadCommit` | 需要 Storage 列 | 人类决定是否接受为 #183 的边界 |
| T4 | `chain-facts.readHeadCommit` 只读前 50 个分支（F11） | 另一个闭环 | 人类决定：新开 issue 或并入 #231 |
| T5 | 中断后已记录分支被删 → 每次重试 `not_found`（F10） | 需要定「重建还是显式放弃」的语义 | 人类决定：并入 #211 或新开 issue |
| T6 | `git-provisioning.ts:220` 注释与代码相反（F16） | 属于 #213 的收口 | 人类决定 #213 的关闭 |
| T7 | `existingResult` 的 ready 核验失败路径把记录转为 `failed` 时保留旧工作树句柄（`{ ...record, status: Failed }`），谱系把它当作已观察到的锚点——与 D1「不保留句柄」的理由相矛盾（验收时发现） | `main` 上的既有行为；句柄在终态记录里的语义要与 #211 一起定 | 人类决定：并入 #211 |
| T8 | 分支多于一页的用例（P1–P3）的保真度依赖「诱饵数 > `PROBE_PAGE_SIZE`」；调大页大小不会让任何用例变红，只会让它们静默退化为单页 | 页大小不是语义；「跟游标读到底」由 P4 + M5 钉住（D12） | 耦合已写进两个测试文件的注释；调大页大小时同步调大诱饵数 |

## Global Constraints

- **文件集合与所有权**（本计划唯一一处声明；同一文件只有一个 owner）：

  | owner（任务） | 文件 |
  |---|---|
  | W0 夹具 | `tests/integration/local-git-fixture.js` |
  | W1 写者 | `packages/core/src/start-work.ts`、`tests/integration/local-git-start-work-resume.test.js`（新） |
  | W2 探测 | `packages/core/src/git-provisioning.ts`、`packages/capabilities/src/development-provider.ts`（仅注释）、`tests/contract/suites/development.js`、`tests/integration/start-work-step-recording.test.js`、`tests/integration/local-git-branch-probe.test.js`（新） |
  | W3 视图 | `packages/controller/src/commands.ts`、`tests/e2e/controller-roundtrip.test.js` |
  | 主控（验收者） | `docs/exec-plan/completed/2026-09-29-start-work-resume-evidence.md`（原 active 路径在 Batch 5 移入）、`docs/README.md`、`tests/integration/README.md` |

- **不改**：`packages/providers/**` 的实现（M8 只是临时变异）、`packages/domain/**`、`packages/storage/**`、`packages/capabilities/src/registry.ts` 与任何类型签名、`pnpm-lock.yaml`。不新增依赖、不新增 capability key。
- 规模：规划弹性上限代码 ≤800 行、文档 ≤1300 行（人类伙伴本轮指令，给评审与后续优化留余量）；CI 硬上限仍是代码 1000 / 文档 1500（`AGENTS.md` §6，`node scripts/rule-checks.mjs size origin/main` 强制），二者并存不冲突。预估代码约 450–500（测试计入代码）、文档约 480。依赖方向不变（`pnpm run boundaries`）。
- 不写看板 `Status`，不写 `blocked-by` / `blocking`；Project 10 只做机械字段回填。
- 提交格式 `<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #183`；**提交正文不写关闭关键字**，`Closes #183` 只出现在 PR 描述。
- 文档不写本机绝对路径；公开面（分支名、PR 描述、提交信息）先过 `node scripts/rule-checks.mjs disclosure origin/main`。
- 子 agent 不改本计划与索引文件，证据写在回复里，由主控回填（避免共享写入）。

## Plan of Work

批次按「对齐 → 隔离 → 实现 → 验证 → 记录 → 提交 → 汇报」执行；W1、W2 在 W0 提交之后并行，W3 不依赖夹具，可与 W0 同时开始。

并行任务说明（`docs/development/workflow.md` §2 要求的路径、输入、产出、禁止区域、模型能力与停止条件；可写文件以 Global Constraints 的所有权表为准）：

| 任务 | 输入 | 产出 | 禁止修改 | 停止条件 |
|---|---|---|---|---|
| W0 夹具 | 本计划 Batch 1 | 一个提交；回复里附验证输出 | 所有权表中不属于 W0 的文件 | 既有集成用例任一变红 |
| W1 写者 | W0 提交；D1、D2；R1、R2；M1–M4 | 一个提交；回复里附 base 红基线原文与 M1–M4 的施加证据、失败形态、还原结果 | 同上；尤其不改 `git-provisioning.ts`（变异除外，须还原） | R2 在 base 上不红；任何变异不生效或还原后 `git diff --quiet` 非 0 |
| W2 探测 | W0 提交；D3、D4；P1–P5；M5、M6、M8、M9 | 同上 | 同上；尤其不改 `start-work.ts` 与 provider 实现（M8 除外，须还原） | P1–P4 任一在 base 上不红；P5 在 base 上不绿 |
| W3 视图 | D5；V1；M7 | 同上 | 同上 | V1 在 base 上不红 |

实现模型用 Sonnet 级；Batch 3 的验收与重构由 Opus 级模型执行。任何任务遇到与本计划事实不符的情况，先停下在回复里报告证据，不自行改设计。

### Batch 0 · 计划与 draft PR（主控）

**最小闭环**：本计划与索引入库，draft PR 关联 #183。
**涉及文件**：本计划、`docs/README.md`。

- [x] (2026-09-29) 在 `.worktrees/start-work-resume-evidence` 执行 `AGENTS.md` §6 的四条检查，确认分支 `fix/start-work-resume-evidence`、base `origin/main@f6a33d2`。
- [x] (2026-09-29) `pnpm install --frozen-lockfile` exit 0；`@harness-projects/core` 解析到本工作树的 `packages/core`；基线六个文件 `ℹ tests 95` / `ℹ pass 95` / `ℹ fail 0`。
- [x] (2026-09-29) 计划以 `36ee841` 提交（`Refs #183`）并推送，draft PR #237 回读 `isDraft` true、`closingIssuesReferences` = [183]、里程碑 M4。原计划文字：提交 `docs(exec-plan): Start Work 恢复剩余闭环的执行计划`（`Refs #183`），推送，`gh pr create --draft -R SingularityKChen/harness-projects --base main`；描述写闭环、本计划与批次、`Closes #183`、`Refs #141`、风险与回滚；标签见 Interfaces；里程碑 M4。

**验证**：

```bash
git rev-parse --git-dir --git-common-dir && git status --short --branch && git worktree list --porcelain && git check-ignore -v .worktrees/
node -p "require('node:fs').realpathSync('node_modules/@harness-projects/core')"   # 期望：以 .worktrees/start-work-resume-evidence/packages/core 结尾
node --test tests/integration/start-work-step-recording.test.js tests/integration/start-work-retry-identity.test.js tests/integration/local-git-core-provisioning.test.js tests/e2e/controller-roundtrip.test.js tests/contract/development-contract.test.js tests/integration/development-local-git.test.js   # 期望：pass 95 / fail 0（F15）
gh pr view <n> -R SingularityKChen/harness-projects --json isDraft,closingIssuesReferences,labels,milestone   # 期望：isDraft true，closing 含 183
```

**回滚**：`gh pr close <n>` 并删除远端分支前先征得人类同意；本地 `git revert` 该提交。

### Batch 1 · 夹具（W0）

**最小闭环**：真实仓库用例需要的五个助手，默认行为不变。
**涉及文件**：`tests/integration/local-git-fixture.js`。

- [x] `coreContextFor(fixture, providers?, { storage, workspaceId, clock } = {})`：三个选项缺省时与今天完全相同（新建 fake storage、新 workspace、冻结时钟）。
- [x] `controllableClock(start = FROZEN_NOW)` → `{ clock, advance(ms) }`，并导出 `LEASE_EXPIRED_MS = 31_000`（租约 30 秒 + 1 秒），注释点名 `start-work.ts` 的 `PROVISIONING_LEASE_MS`。
- [x] `interruptAfterBranchStep(provider)`：`createWorktree` 第一次调用抛出，之后照常。
- [x] `addDecoyBranches(fixture, count)`：一次 `git update-ref --stdin` 建 `a-000…`（排在 `work/` 之前），指向夹具的初始提交（验收时订正：原写「当前 `HEAD`」，实现用的是 `fixture.headCommit`）。
- [x] `advanceMain(fixture)`：`-c commit.gpgsign=false commit --allow-empty` 并返回新的 `main` 头。

**验证**：

```bash
node --test tests/integration/local-git-core-provisioning.test.js tests/integration/development-local-git.test.js tests/integration/human-execution-provider.test.js   # 期望：与改动前同数、fail 0
node --input-type=module -e "import('./tests/integration/local-git-fixture.js').then((m) => console.log(['controllableClock','LEASE_EXPIRED_MS','interruptAfterBranchStep','addDecoyBranches','advanceMain'].every((k) => k in m)))"   # 期望：true
```

**回滚**：单个提交 `test(tests): …`，`git revert`。

### Batch 2a · 已决定的分支身份写一次（W1，依赖 Batch 1）

**最小闭环**：剩余项 ③ + 验收 2 的真实仓库证据。
**涉及文件**：`packages/core/src/start-work.ts`、`tests/integration/local-git-start-work-resume.test.js`。

- [x] 先写 R1、R2，在未改实现的树上跑：R1 绿、R2 红（记录 `undefined`），把失败信息原文写进回复。
- [x] 实现 D1、D2（含注释：为什么写一次、为什么不含工作树、为什么结果面取记录、为什么不改 `provisionGit`）。
- [x] 跑 M1–M4，每条按变异表的方式施加、证明生效、看红、还原。子任务回报两条 P3：没有用例钉住「工作树句柄不写一次」；M1 的 argv 断言未单独观察——验收时分别以 R3 + M10、M1b / M1c 处理（D11）。

**验证**：

```bash
node --test tests/integration/local-git-start-work-resume.test.js   # 期望：先 1 红 1 绿，实现后全绿
node --test tests/integration/start-work-retry-identity.test.js tests/integration/start-work-step-recording.test.js tests/e2e/start-work.test.js tests/e2e/start-work-recovery.test.js tests/integration/human-execution-provider.test.js   # 期望：fail 0
pnpm run typecheck   # 期望：exit 0
```

**回滚**：单个提交 `fix(core): 已决定的分支身份写一次，失败路径不再抹掉`，`git revert` 回到「失败路径抹掉分支」。

### Batch 2b · 分支探测读完全部页（W2，依赖 Batch 1）

**最小闭环**：剩余项 ② 的 core 部分及其两个同源形态，外加端口义务。
**涉及文件**：`packages/core/src/git-provisioning.ts`、`packages/capabilities/src/development-provider.ts`、`tests/contract/suites/development.js`、`tests/integration/start-work-step-recording.test.js`、`tests/integration/local-git-branch-probe.test.js`。

- [x] 先写 P1–P5，在未改实现的树上跑：P1–P4 红（形态见证据用例表）、P5 绿。
- [x] 实现 D3、D4；顺手把 `start-work-step-recording.test.js` 文件头里「真实本地 Git provider 尚未合并」「真实 provider 的端到端集成由 #141 覆盖」两句改成现状（真实仓库证据在两个新文件，SQLite 与重启归 #141）。
- [x] 跑 M5、M6、M8、M9。子任务回报三条 P3：M9 临界值应为 98；把 `PROBE_PAGE_SIZE` 调到 1000 不会让任何用例变红；端口注释第 4 条只对 ambiguous 对账路径有用例——验收时分别订正变异表、登记 T8（D12）、订正注释措辞。

**验证**：

```bash
node --test tests/integration/local-git-branch-probe.test.js tests/integration/start-work-step-recording.test.js   # 期望：先 4 红，实现后全绿
node --test tests/contract/development-contract.test.js tests/integration/development-local-git.test.js   # 期望：fail 0（P5 在两个适配器上都跑）
node --test tests/e2e/write-machine.test.js tests/e2e/delivery-lineage.test.js tests/integration/local-git-core-provisioning.test.js   # 期望：fail 0（对账与冲突路径回归）
pnpm run typecheck && pnpm run boundaries   # 期望：exit 0
```

**回滚**：单个提交 `fix(core): 分支探测按游标读完全部页`，`git revert` 回到只读第一页。

### Batch 2c · controller 视图（W3，无依赖）

**最小闭环**：剩余项 ② 的 controller 部分。
**涉及文件**：`packages/controller/src/commands.ts`、`tests/e2e/controller-roundtrip.test.js`。

- [x] 先写 V1，看到 `undefined !== 'sha-1'`；实现 D5；跑 M7。子任务回报 P3：同键重放仍为 `undefined`（即 T3，交人类判定）。

**验证**：

```bash
node --test tests/e2e/controller-roundtrip.test.js   # 期望：先 1 红，实现后 fail 0
pnpm run typecheck && pnpm run boundaries   # 期望：exit 0
```

**回滚**：单个提交 `fix(controller): Start Work 视图带出分支头提交`，`git revert` 移除字段（无消费者）。

### Batch 3 · 集成、验收与重构（主控）

**最小闭环**：三个分支按 W1 → W2 → W3 的顺序 cherry-pick 到 `fix/start-work-resume-evidence`，在最终树上重跑全部证据。

- [x] 集成前建恢复锚点 `git branch backup/swre-pre-integrate HEAD`；cherry-pick 后用 `comm` 比对集成前后的文件集合，确认与 Global Constraints 的所有权表一致。
- [x] 在最终树上**整表重跑** M1–M9（上一轮在子工作树里的结果不作数）；再把三个实现文件临时换回 base（`git checkout origin/main -- packages/core/src/start-work.ts packages/core/src/git-provisioning.ts packages/controller/src/commands.ts`），确认 R2、P1–P4、V1 红、R1 与 P5 绿，随后 `git checkout HEAD -- <同三个文件>` 并以 `git diff --quiet` exit 0 收尾。
- [x] 重构：去掉重复注释与死代码；确认 `branchProbe` 没有残留的单页路径（只剩一个循环）。R2 的两处重组抽成 `reassembled` 助手供 R3 复用；三处注释措辞订正（见 Surprises）。
- [x] 回填本计划的 Progress、Surprises、Decision Log、Outcomes；更新 `tests/integration/README.md`（Start Work 恢复表加两个新文件与 P3 / P4 两行，「替身边界的如实说明」改为：真实本地 Git 证据在两个新文件，SQLite 与重启仍归 #141）。

**验证**：

```bash
pnpm verify && pnpm run boundaries && node scripts/workflow-check.mjs   # 期望：全部 exit 0
node scripts/rule-checks.mjs size origin/main        # 期望：代码 ≤800，文档 ≤1300
node scripts/rule-checks.mjs disclosure origin/main  # 期望：无命中
git diff --check origin/main...HEAD                  # 期望：无输出
```

**回滚**：`git reset --hard backup/swre-pre-integrate` 之前先确认没有未推送的有效提交；共享历史的改写走 `git-expert-operations` 流程。

### Batch 4 · 整理、推送与请人类评审（主控）

- [x] 整理提交序列为：计划 → 夹具 → 写者 → 探测 → 视图 → 文档回填；去掉 WIP / fixup；整理后再次 `comm` 比对文件集合并重跑 Batch 3 的验证。

**Superseded by D17（2026-09-29）**：上面是首次推送时的提交序列。本轮在备份完整树后收敛为「运行时能力及其测试」与「ExecPlan 归档及索引」两个可按交付物回滚的提交；产品与测试树须和备份逐字相同，本文新增的整合决策另行逐行核对。
- [x] 分支已推送时先建 backup ref，再 `git push --force-with-lease=fix/start-work-resume-evidence:<旧 head>`。实际不需要：已推送的两个计划提交不改写，其余提交都在其后，推送是快进（D10）。
- [ ] 回读远端 head、base、checks、`closingIssuesReferences`、review threads；全部符合后 `gh pr ready <n> -R SingularityKChen/harness-projects`，请人类伙伴评审。不自行合并。本轮只做回读与 PR 描述更新，`gh pr ready` 留给人类伙伴（D13）。

**Superseded by Batch 5（2026-09-29）**：上述未完成项是原批次的人类评审交接，不是本次合并限制。GitHub 已回读为 ready；人类伙伴现已明确要求修复、归档、整合提交并以 `merge_method=rebase` 合并。提交与检查门禁按 Batch 5 重锁，不把旧 head 的批准或检查当成新 head 的证据。

### Batch 5 · 评审修复与计划归档

**最小闭环**：`conflict` 后列表读失败保留未知结果，不伪装确定失败；原问题验收与此故障路径都可复现并通过；本计划移入 `completed/`。
**涉及文件**：`packages/core/src/git-provisioning.ts`、`tests/integration/start-work-step-recording.test.js`、本计划与 `docs/README.md`。

- [x] (2026-09-29) P6 先红后绿：原代码 `failed !== unknown`，修复后 `unknown / unavailable`、未确认、无工作树，读恢复后新 key 得到 `ready`。
- [x] (2026-09-29) 保留已找到分支时的确认路径和读完仍没找到时的既有失败路径；不改变 `DevelopmentProvider` 端口、Storage、provider 实现或 Project `Status`。
- [x] (2026-09-29) 在当前工作树执行 `pnpm verify`（770/770 + MVP-0 7/7）、`pnpm run boundaries`（7/7）、`node scripts/workflow-check.mjs`（no findings）。
- [x] (2026-09-29) 本文移入 `docs/exec-plan/completed/`，`docs/README.md` 改为 Completed 索引；文档、规模与发布面检查在提交整理后对最终 diff 重跑。

**验证**：`node --test --test-name-pattern='conflict 后列表读取失败' tests/integration/start-work-step-recording.test.js` 期望 pass 1；`pnpm verify && pnpm run boundaries && node scripts/workflow-check.mjs` 期望 exit 0；`node scripts/rule-checks.mjs disclosure origin/main && node scripts/rule-checks.mjs size origin/main && git diff --check origin/main...HEAD` 期望无命中、在规模上限内、无空白错误。
**回滚**：运行时代码与测试作为一个交付物 revert，回到评审前 `conflict` 故读失败的表现；归档文档可单独 revert，恢复 active 索引。已推送历史整理先建 backup ref，再以精确 `--force-with-lease` 发布。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | #183 验收 2：真实临时仓库上基线前进后重试成功、接管既有分支、不重新解析 `fromRef` | R1 绿；M1 使其红（`invalid_input` + argv 出现 `main^{commit}`） |
| 2 | #183 验收 3（core）：分支多于一页时头提交被报出 | P1：base 红、head 绿；M5 红 |
| 3 | #183 验收 3（controller）：视图带出 `branchHeadCommit` | V1：base 红、head 绿；M7 红 |
| 4 | 剩余项 ③：能力不可用的失败不抹掉已决定分支，恢复后在基线前进下仍 `ready` | R2：base 红、head 绿；M2、M3 红 |
| 5 | 修复不扩大 #192 | R2 的 `has_worktree === 0`；M4 红 |
| 6 | 同源形态 A：写入已落地但响应丢失、分支多于一页时不报「创建未生效」 | P2：base 红、head 绿；M5 红 |
| 7 | 同源形态 B：`conflict` 路径分支多于一页时复用 | P3：base 红、head 绿；M5 红 |
| 8 | 探测有界：游标不结束时报 `unknown` 而不是挂住或判成不存在 | P4：base 红、head 绿；M6 超时 |
| 9 | 分页义务写进端口与契约 | P5 在两个适配器上绿；M8 红；`development-provider.ts` 注释第 4 条 |
| 10 | 全量门禁与规模 | Batch 3 的验证命令全部符合期望 |
| 11 | 变异表在最终树整表重测 | Progress 里 M1–M10（含补充的 M1b、M1c）各有一行：施加证据、失败形态、还原后 `git diff --quiet` exit 0 |
| 12 | 评审 P2：`conflict` 后列表读失败保留未知，不报确定冲突；恢复后可接管 | P6 在原 head 红、Batch 5 绿；`writeState=unknown`、`confirmed=false`、`error=unavailable`，恢复后 `ready` |

## Progress

- [x] (2026-09-29) 三份独立设计完成；独立评审在 `f6a33d2` 上复核 F1–F16，并在一次性副本上原型验证本设计：`tsc --noEmit` 通过；`tests/integration`、`tests/e2e`、`tests/contract` 757 条中 756 通过，唯一失败是副本不是 Git 仓库导致的 `issue-policy` CLI 用例（与本设计无关）；`tests/mvp0` 7 / 7；复现场景 S2–S5 全部翻转为正确结果，S1 保持正确，P4 场景由 `failed / not_found`（1 次调用）变为 `unknown / result_unknown`；反事实修法 M4 在原型上确实写出 `has_worktree`（关系列表 `tracks`、`has_worktree`），R2 的断言能抓住它。原型不入库，实现以本计划为准。
- [x] (2026-09-29) 定稿本计划，Active 索引加一行。
- [x] (2026-09-29) Batch 0 · 计划入库与 draft PR：`36ee841`、`b02e3e7` 已推送，draft PR #237（详见 Batch 0 一节）。
- [x] (2026-09-29) Batch 1 · 夹具（W0）：一个提交，整理后为 `86850f0`。在该提交上 F15 的六个文件 95 / 95、`pnpm run typecheck` exit 0（与 base 同数）。
- [x] (2026-09-29) Batch 2a · 写者（W1，`.worktrees/swre-record`）：子任务提交整理后为 `6850dc2`（验收时并入 R3）。子任务验证 pass，回报两条 P3（见 Batch 2a）。
- [x] (2026-09-29) Batch 2b · 探测（W2，`.worktrees/swre-probe`）：整理后为 `174eadf`（验收时并入两处测试注释与端口注释措辞）。子任务验证 pass，回报三条 P3（见 Batch 2b）。
- [x] (2026-09-29) Batch 2c · 视图（W3，`.worktrees/swre-view`）：整理后为 `00834e5`（验收时订正字段注释）。子任务验证 pass，回报一条 P3（T3）。
- [x] (2026-09-29) Batch 3 · 集成、整表变异、文档回填：证据见下。
- [x] (2026-09-29) Batch 4 · 整理与快进推送；`gh pr ready` 未执行，交人类伙伴（D13）。
- [x] (2026-09-29 20:40 CST) Batch 5 · P6 先红后绿，聚焦 21/21、typecheck 通过；全量 `pnpm verify` 为 770/770 + MVP-0 7/7，boundaries 7/7，workflow-check 无发现。

**Batch 3 证据**（执行上下文：`.worktrees/start-work-resume-evidence`，Node v26.10.0，base `origin/main@f6a33d2`）：

- 集成：`backup/swre-pre-integrate` 指向 W0 提交；按 W1 → W2 → W3 cherry-pick 无冲突。`comm` 比对 `git diff --name-only origin/main...HEAD`：集成前 3 个文件，集成后多出 9 个且恰好是 W1–W3 的所有权集合，没有文件消失；每个被 cherry-pick 的文件与子分支逐字相同。整理后每个提交只含一个 owner 的文件，文件集合与整理前相同，工作区与整理前的 WIP 提交 `git diff` 为空。
- 逐提交可回滚：`86850f0` / `6850dc2` / `174eadf` / `00834e5` 各自检出后 `typecheck` exit 0，聚焦用例 95 / 98 / 107 / 107 全过。
- 全量：`pnpm install --frozen-lockfile` exit 0，`@harness-projects/core` 解析到本工作树；`pnpm verify` exit 0（`tests/contract`、`tests/integration`、`tests/e2e` 769 / 769，`tests/mvp0` 7 / 7）；`pnpm run boundaries` 7 / 7；`node scripts/workflow-check.mjs` 无发现。
- base 红（三个实现文件临时换回 `origin/main`，六个聚焦文件共 90 条）：7 红——R2（记录 `undefined`）、R3（分支断言）、P1（`undefined`）、P2（`not_found`）、P3（`failed`）、P4（`failed`，不是 `unknown`）、V1（`undefined`）；R1 与 P5 的五个适配器变体绿。还原后 `git diff --quiet` exit 0。
- 变异表（最终树整表重测；每条都以精确匹配施加、`git diff --stat` 与哨兵注释各命中一次，跑完 `git checkout --` 还原并 `git diff --quiet` exit 0）：

  | # | 用例 | 结果 |
  |---|---|---|
  | M1 | R1 | 红：`failed`，消息为 `invalid_input`「分支 work/wi-3 已存在且指向 …，与请求起点 … 不一致」 |
  | M1b | R1 | 红：状态、头提交与 `branch` 断言都通过，首个失败的是「重试期间不得解析 fromRef」 |
  | M1c | R1 | 红：前面的断言都通过，首个失败的是「重试期间不得探测仓库基线」 |
  | M2 | R2 | 红：记录的 `branchExternalId` 为 `undefined` |
  | M3 | R2 | 红：记录正确，结果面 `branchExternalId` 为 `undefined` |
  | M4 | R2 | 红：记录与结果面都正确，`has_worktree` 为 1 |
  | M5 | P1–P4 | 12 条中 4 红：P1 `undefined`、P2 `not_found`、P3 `failed`、P4 `failed` |
  | M6 | P4（`--test-force-exit`） | `test timed out after 5000ms`，cancelled 1，退出码 1 |
  | M7 | V1 | 红：`undefined !== 'sha-1'` |
  | M8 | P5（本地 Git） | 红：逐页只读到 `feature/page-a`，大页是四个分支 |
  | M9 | P1 | 诱饵 98：前置条件「目标分支不在第一页」红；诱饵 99：绿（临界值复核） |
  | M10 | R3 | 红：记录保留旧句柄；补 R3 之前同一变异下全量 775 条全绿 |

## Surprises & Discoveries

- **(2026-09-29，评审复核) 「只读第一页」的后果比 #183 评论写的更重。** 评论只提到头提交为 `undefined`；实测还有两种会写出错误失败的形态：写入已落地的对账被判「创建未生效」（F3），替身 `conflict` 路径直接失败（F4）。三处都来自同一个函数，所以一处修复。
- **(2026-09-29，评审复核) 契约套件早有 `expect.pageSize`，却没有任何用例用它**（F13）。分页从未被钉住，而 core 的修复恰好依赖它。
- **(2026-09-29，评审复核) 「分支被删后永久 `not_found`」不是新发现**（F10）：它是上一份计划「遗留」§9。两份独立设计把它当作新发现，其中一份建议另开 issue——先查已有登记再开，避免重复。
- **(2026-09-29，评审复核) #213 的代码已进 `main`，issue 与注释没有跟上**（F16）。
- **(2026-09-29，评审复核) 「用超时抓死循环」的用例本身可能失效。** 两份设计都打算用 `{ timeout }` 证明「去掉上界会挂住」，但 provider 替身若是立即 resolve 的 `async` 函数，循环只跑微任务，Node 的计时器永远不触发——测试不会超时，而是整个进程挂住（Node v26.10.0 最小用例实测）。P4 的替身因此每次调用都让出一次宏任务，M6 用 `--test-force-exit` 运行。
- **(2026-09-29，评审复核) 三份设计都把全部新用例放进同一个新文件**，与「子 agent 在各自工作树并行」互相矛盾；本计划按不变量拆成两个新文件，并把夹具助手先行提交。
- **(2026-09-29，验收) 变异表的 M9 临界值写错了。** 目标前面有诱饵加 `main`，下标 = 诱饵数 + 1，第一页是下标 0–99，所以 99 个诱饵时目标仍在第二页（绿），98 才红。W2 先指出，最终树上 99 绿、98 红复核。临界值要算，不要估。
- **(2026-09-29，验收) D1 的「只保留分支，不保留工作树句柄」原先没有用例钉住。** 把工作树句柄也改成写一次（M10），全量 775 条全绿。补 R3（D11）。
- **(2026-09-29，验收) R1 的 argv 断言从未被单独观察。** M1 在状态断言上先红，后面的 argv 断言没机会失败。补充 M1b、M1c：状态断言都通过，首个失败的分别是「解析 fromRef」与「探测仓库基线」两条 argv 断言。`branch` 子命令那条找不到现实的单独变异（新建分支只发生在分支不存在时），保留为安全网。
- **(2026-09-29，验收) `existingResult` 的 ready 核验失败路径保留旧工作树句柄。** 它把记录转为 `failed` 时展开整条记录，谱系会把失效的句柄当作已观察到的锚点，与 D1 不保留句柄的理由矛盾。这是 `main` 上的既有行为，登记 T7，R3 因此不依赖这条路径制造前置状态。
- **(2026-09-29，验收) 页大小不是语义，却决定了用例的保真度。** `PROBE_PAGE_SIZE` 调到 1000 时没有用例变红（P4 仍钉住「跟游标读」），但 P1–P3 会静默退化为单页用例。耦合写进测试注释，登记 T8（D12）。
- **(2026-09-29，验收) 三处注释与事实不符，已订正。** 端口注释第 4 条原写「游标不结束或重复枚举」都会停在 `unknown`，但能结束的重复枚举仍会得到答案，改为「游标不结束（包括循环回到旧游标）」。`StartWorkView.branchHeadCommit` 原写「接管时读到的头」，而新建路径同样报出（V1 的 `'sha-1'` 就来自新建），改为「实际落地的头」。夹具 `addDecoyBranches` 原写「指向当前 HEAD」，实为夹具初始提交。
- **(2026-09-29，评审响应) `conflict` 消费者漏读 `probe.error`。** 审核时预置真实同名分支并让列表返回 `unavailable`，旧 head 的 `startWork` 报 `failed / conflict`；`branchProbe` 已返回读错误，但 `ensureBranch` 只看 `found`，非 `ambiguous_result` 分支直接用原冲突调用 `markFailed`。P6 在未改产品代码前按 `failed !== unknown` 红，单点修复后绿；没有 false `Saved`。
- **(2026-09-29，GitHub 回读) PR #237 已为 ready。** 原文与 `docs/README.md` 仍称 draft；评审时 `isDraft=false`、`reviewDecision=APPROVED`。该批准属于旧 head，整理和推送后需要在新 head 上重读并补有效批准。
- **(2026-09-29，提交整合) 完整树备份与最终树会因本计划新增 D17 不同。** 比对 `git diff backup/pr237-pre-squash-20260929 HEAD` 只显示本文档的整合记录；产品与测试文件逐字相同。最初写成「整个树逐字相同」会让正确的计划增补被误判为内容漂移，已在 Batch 4 就地订正。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D0 | 流程：多个独立子 agent 设计 → 独立评审定稿写 ExecPlan → draft PR 关联 issue → Sonnet 在各自 worktree 并行 TDD 与对抗验证 → Opus 验收重构 → 请人类评审 PR | 人类伙伴于 2026-09-29 指定（由本轮编排任务说明转述，待人类伙伴在 PR 评审时确认）。模型分工是本任务的选择，不是仓库默认（`docs/development/workflow.md` §2） | 2026-09-29 / 人类伙伴 |
| D1 | 剩余项 ③ 修在唯一写者 `saveContext`，分支身份写一次（`existing ?? produced`），工作树句柄不在此列 | F7：只有它会降级字段；修在写者覆盖现在与将来的所有失败路径；修在 `provisionGit` 会扩大 #192（M4）；工作树句柄是谱系锚点 | 2026-09-29 / 独立评审 |
| D2 | 失败路径的结果面取自写入后的记录 | Host 拥有权威状态；与工作树步失败路径和 `existingResult` 一致；否决设计 1 的「报本次尝试」 | 2026-09-29 / 独立评审 |
| D3 | 分支探测在 core 内逐页读完、找到即停、页数上限 1000 → `result_unknown`；不在本 PR 加端口方法 `getBranch` | 一处修复收敛三个消费者；不在 #212 待裁决时改 Development 端口；`getBranch` 作为 T2 的终点。**待人类确认**（见 Outcomes「待人类决定」1） | 2026-09-29 / 独立评审 |
| D4 | 分页义务写进端口注释与契约套件，复用 `expect.pageSize` | ADR-0007：义务必须写在端口里，只写在测试里 provider 作者读不到；core 新依赖了这条假设 | 2026-09-29 / 独立评审 |
| D5 | `StartWorkView` 带出 `branchHeadCommit`；同 key 重放仍为 `undefined` | 验收 3 要求「报出」；落库需要改 Storage 契约。**待人类确认**是否据此 `Closes #183` | 2026-09-29 / 独立评审 |
| D6 | 头提交只做报告：接管路径不因探测失败或分支不存在而改变走向 | 上一份计划 D1；否决设计 3 的「探测失败即失败」 | 2026-09-29 / 独立评审 |
| D7 | 证据型用例（R1、P5）在 base 上绿，判别力由变异（M1、M8）证明；「不重新解析 `fromRef`」用 argv 断言 | 调用计数只能证明方法没被调，argv 证明命令没被拼出来 | 2026-09-29 / 独立评审 |
| D8 | 真实仓库用例拆成两个新文件（恢复 / 探测），夹具助手先行提交 | 一个文件一个 owner，W1 与 W2 才能并行 | 2026-09-29 / 独立评审 |
| D9 | 技术债写在本计划，不新建 tracker 文件 | `main` 上没有 tracker；新增文档面不属于本闭环 | 2026-09-29 / 独立评审 |
| D10 | 集成与整理：三条子分支按 W1 → W2 → W3 cherry-pick；已推送的 `36ee841`、`b02e3e7` 不改写，W0 与三条实现提交在其后重建，验收期的订正折叠进各自所属提交，文档回填单独成最后一个提交；推送是快进，不用 force-with-lease | 不改写共享历史；每个提交仍只含一个 owner 的文件，可单独 revert（逐提交跑过 typecheck 与聚焦用例）。验收者在 Batch 3 成为全部文件的唯一 owner，所以 R3 与注释订正可以落进 W0–W3 的文件。**Superseded by D17（2026-09-29）**：人类伙伴要求按可独立回滚交付物整合，故在备份后改写为两个提交并使用精确 lease 推送。 | 2026-09-29 / 验收者 |
| D11 | 补 R3 与 M10；R3 直接写入一个旧句柄来制造「记录带着更早的工作树句柄」，不走 ready 核验失败路径 | D1 的「只保留分支」原先没有用例钉住（M10 全量绿）。核验失败路径保留句柄本身就是 T7，语义归 #211，R3 不该依赖它 | 2026-09-29 / 验收者 |
| D12 | W2 的「页大小」P3：登记 T8，在测试侧写明诱饵数与页大小的耦合，不给 P1–P3 加「探测跨页次数」断言 | 页大小只影响调用次数；「跟游标读到底」由 P4 + M5 钉住。统计探测页数会把用例绑在探测的实现上，T2 的终点 `getBranch` 会让页数合法地变成 0 或 1 | 2026-09-29 / 验收者 |
| D13 | 本轮不执行 `gh pr ready`、不合并、不写看板字段；验证证据写进 PR 描述，交人类伙伴评审 | 本轮编排指令明确要求（由编排任务说明转述，待人类伙伴确认）。**Superseded by D16（2026-09-29）**：人类伙伴已明确授权本次修复后的 rebase merge；看板 `Status` 仍不由 agent 写入。 | 2026-09-29 / 人类伙伴 |
| D14 | `conflict` 后探测若给出 `probe.error`，用 `markUnknown(markWriting(beginWrite(name)), probe.error)` 返回未确认结果；正常找到仍确认，完整读完未找到仍沿用原冲突失败 | P6 在原 head 红、修复后绿；只改三消费者之一的错误传播，不新增端口或重试猜测 | 2026-09-29 / 评审响应 |
| D15 | #183 的剩余验收按 issue 原文判定为已满足；成功后的同 key 重放缺头提交归 T3，不阻断 #183 的「中断后换新 key 重试」验收；#141 的 SQLite 与重启继续开放 | R1 是真实临时 Git，P1 与 V1 报出接管头，R2 保留已决定分支；issue 的验收不要求成功后同 key 重放保留首次头提交 | 2026-09-29 / 评审响应 |
| D16 | 本次修复、归档与提交整合后，在新 head 重新取得有效 reviewer 批准、必需检查和 issue 关联，再按 `merge_method=rebase` 合并；不写 Project `Status` | 人类伙伴明确要求；旧 head 的审批不能代替新 head 的门禁 | 2026-09-29 / 人类伙伴 |
| D17 | 最终历史只保留两个交付物提交：运行时恢复能力及其测试，随后是 ExecPlan 归档、索引和测试目录说明 | 夹具、写者、探测和视图共同构成 #183 的一个可回滚能力，拆成多个互相依赖的提交会使单独 revert 留下不能运行的测试；文档归档可独立回滚。整理前完整树在 `backup/pr237-pre-squash-20260929`，推送用旧远端 head 的精确 lease | 2026-09-29 / 评审响应 |

## Idempotence and Recovery

- 所有用例在 `mkdtemp` 临时目录里建仓库，经 `t.after` 清理；重复运行不留状态。
- 变异实验只改工作树文件，不提交；每条都以 `git diff --quiet -- <file>` exit 0 收尾。中断后先 `git status --short` 确认没有残留变异，再继续。
- 会话可能中断且会话临时目录可能被清空：每个子工作树在关键节点做本地 WIP 提交，Batch 4 整理时去掉。
- 子工作树：`.worktrees/swre-record`（分支 `fix/swre-record`）、`.worktrees/swre-probe`（`fix/swre-probe`）、`.worktrees/swre-view`（`fix/swre-view`），均从 Batch 1 提交之后的 `fix/start-work-resume-evidence` 建出；路径交给 Git 前先 `realpath` 并确认在仓库的 `.worktrees/` 之下。它们不推送；集成完成后的清理交给人类或 `git-expert-operations` 流程，默认不删。
- 本地恢复锚点（不推送）：`backup/swre-pre-integrate`（集成前的 W0 提交）、`backup/swre-pre-tidy`（集成后、整理前的 head）、`backup/swre-pre-tidy-wip`（整理前把验收期改动收成的 WIP 提交，整理后的工作区与它逐字相同）。
- 已知良好状态：`origin/main`（观察于 2026-09-29 为 `f6a33d2`）。每个实现提交可单独 `git revert`；没有 Storage schema、数据迁移或外部状态，回滚不需要清理数据——记录里保留的 `branchExternalId` 在旧代码下同样是合法值。

## Interfaces and Dependencies

- 工具：Node（观察到 v26.10.0，`node --test` 与 `.ts` 类型剥离）、pnpm（`--frozen-lockfile`）、Git CLI、`gh`（一律带 `-R SingularityKChen/harness-projects`）。开发、提交、回复用开发账号；评审用评审账号。
- 接口变化：
  - `saveContext`（模块私有）返回 `ExecutionContextRecord`；`RecordStep` 签名不变。
  - `branchProbe`（模块私有）签名不变，语义改为 I3。
  - `StartWorkView` 新增 `branchHeadCommit: string | undefined`。
  - Development 端口：签名不变，实现义务注释新增第 4 条（分页）。
  - `tests/integration/local-git-fixture.js`：`coreContextFor` 新增可选第三参；新增 `controllableClock`、`LEASE_EXPIRED_MS`、`interruptAfterBranchStep`、`addDecoyBranches`、`advanceMain`。
- 不新增依赖、capability key、Storage 列或迁移。
- PR：标题 `fix(core): 分支探测读完全部页，失败路径不再抹掉已决定的分支`；标签 `kind:fix`、`area:core`、`area:controller`、`area:capabilities`、`area:tests`；里程碑「M4 · MVP Demo：Harness 内打通 GitHub 链路」；描述写 `Closes #183`、`Refs #141`。

## Outcomes & Retrospective

**原 Batch 3 结果**（2026-09-29，当时代码树为 `00834e5`，其后当时只有本文档回填提交；**Superseded by** 本节下方 Batch 5 结果与当前 GitHub head 回读）：

- 剩余项 ①：R1 在真实临时仓库上证明「分支步后中断 → `main` 前进 → 换新键重试 → `ready`、头提交仍是中断前的 A」，重试期间的 argv 没有 `branch`、`main^{commit}`、`symbolic-ref`。M1 让它以 `invalid_input` 失败，M1b / M1c 分别单独打到两条 argv 断言。
- 剩余项 ②：`branchProbe` 读完全部页、上限 1000 页后报 `result_unknown`。P1–P3 证明接管、ambiguous 对账、conflict 复用三个消费者在分支多于一页时都给出正确事实，P4 证明游标不结束时报 `unknown` 且不挂住。分页义务写进端口注释第 4 条，P5 在五个适配器变体上钉住它。`StartWorkView` 带出 `branchHeadCommit`（V1）。
- 剩余项 ③：`saveContext` 对分支身份写一次，失败路径的结果面取自写入后的记录（R2），那一次不新写 `has_worktree`（M4 证明修在写者）。写一次不含工作树句柄（R3、M10）。
- 门禁：见 Progress 的 Batch 3 证据；规模与发布面检查的输出写在 PR 描述。

**与计划的偏差**：新增 R3 与 M10、M1b、M1c；M9 临界值由 99 订正为 98；三处注释措辞订正；推送是快进而不是 force-with-lease（D10）；`gh pr ready` 不在本轮执行（D13）。设计 D1–D9 没有改变。

**明确的限制（交人类判定是否据此关闭 #183）**：同 key 重放走 `existingResult`，报不出 `branchHeadCommit`（T3）。换新 key 的重试和首次调用都报得出，controller 视图也透传了；要让重放也报得出，需要给 Storage 加一列，不在本闭环。PR 描述保留 `Closes #183`，并写明这一条。**Superseded by D15（2026-09-29）**：#183 原文验收是中断后的重试，不含成功后同 key 重放；该限制仍为 T3，但不阻断本 issue 关闭。

**遗留**：T1–T8（见「接受的残留」）。其中 T7、T8 是验收时新登记的；T2 补记了探测不续租的风险。

**回顾**：子任务回报的六条 P3 全部属实。其中一条（工作树句柄）是真实的覆盖缺口：变异 M10 在全量用例下全绿。另外两条是计划自身的事实错误（M9 临界值、注释措辞）。「在最终树上整表重测」发现的不是回归，而是「原先的变异没有观察到它声称的东西」（M1 的 argv 断言）。

**Batch 5 结果（归档前）**：P6 先红（`failed !== unknown`）后绿，列表暂时不可用时 `writeState=unknown / confirmed=false / error=unavailable`，列表恢复后用新 key 接管；相关聚焦 21/21、`pnpm verify` 770/770 与 MVP-0 7/7、boundaries 7/7、workflow-check 无发现。修复前的 GitHub reviewer 批准与该代码树不同，合并前须按 D16 重锁新 head 并回读审批。

**提交整合（D17）**：运行时与测试已收敛成一个提交 `0b2b9bd`，在该提交树上复测聚焦 21/21 与 typecheck；本文及两个索引文件单列归档提交。旧七提交与临时暂存提交保留在本地备份 ref 供树对照，不进入最终 PR 历史。


**待人类决定**（定稿时列出，执行不因它们暂停；裁决写回 Decision Log）：

1. D3：接受 core 内逐页读完（本计划），还是本 PR 就给端口加 `getBranch`？**Superseded by D16**：本次按现有端口收口；`getBranch` 保持 T2 的后续方案。
2. D5：同 key 重放不报头提交（T3）是否可以据本 PR `Closes #183`？**Superseded by D15**：可以；T3 继续作为限制登记。
3. T4：`chain-facts.readHeadCommit` 的前 50 个限制——新开 issue，还是并入 #231？
4. T5：中断后已记录分支被删的永久 `not_found`——并入 #211 的范围，还是新开 issue？在 #211 上留言属于 GitHub 写入，需要批准。
5. T6：#213 是否已可关闭（代码已在 `main`），陈旧注释随谁的 PR 修？
6. 标签：本 PR 不改 provider 实现，#183 上的 `area:providers` 是否保留？
7. T7：ready 核验失败后终态记录保留旧工作树句柄——并入 #211 的范围，还是另开 issue？
8. 是否把 PR #237 置为 ready：本轮只推送并更新 PR 描述（D13）。**Superseded by** GitHub 当前回读：#237 已是 ready；不重复调用 `gh pr ready`。

## Bottom Change Note

- (2026-09-29) 新建：独立评审综合三份设计定稿，写入复核事实 F1–F16、D0–D9、证据用例、变异表、所有权表与批次。
- (2026-09-29) Batch 3–4（验收者）：集成三条子分支，在最终树上整表重测变异表（新增 M1b、M1c、M10），补 R3；订正 M9 临界值与三处注释；回填 Progress、Surprises、Decision Log（D10–D13）、技术债（T2 补记，新增 T7、T8）与 Outcomes；更新 `tests/integration/README.md` 与索引状态。
- (2026-09-29) Batch 5（评审响应）：补 P6 红绿用例与 `conflict` 读失败的 `unknown` 传播；原 draft / 不合并文字就地标注 Superseded，记录 D14–D16 与 #183 验收裁决，为归档与新 head 门禁留出确切步骤。
- (2026-09-29) 提交整合（D17）：人类伙伴要求按可独立回滚的交付物划分，原七提交序列就地标注 Superseded；记录完整树备份、运行时代码与测试合一、归档文档单列以及精确 lease 的恢复路径。
- (2026-09-29) 整理后树对照：除本文新增的 D17 与其说明外，产品与测试文件和整理前备份一致；订正 Batch 4 对整个树逐字相同的过严表述。
