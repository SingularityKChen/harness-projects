# 2026-09-24-start-work-recovery —— 让 Start Work 的补偿序列真正可恢复

> 状态：Completed（第一轮 MMP 评审后随 PR #185 以 rebase merge 合入并归档）。关闭 #184、#165；**#183 保持开启**，剩余项见 Outcomes「第一轮 MMP 评审」
> 载体 issue：<https://github.com/SingularityKChen/harness-projects/issues/183>（步骤级回填）、
> <https://github.com/SingularityKChen/harness-projects/issues/184>（失败可重试）、
> <https://github.com/SingularityKChen/harness-projects/issues/165>（工作树实体身份）
> 本计划同时是 spec 与 plan；正文中文，代码标识符、路径与命令英文。

## Purpose / Big Picture

`startWork` 有一条补偿序列：认领上下文 → 建分支 → 建工作树 → 启动执行。它今天**只能从头跑**：中断了不能续、失败了不能重试、重试还会因为基线前进而硬失败。完成后：

1. **中断能续**：进程在序列中途死掉后，下一次 `startWork` 从**已完成的那一步之后**继续，不重新推导输入；
2. **失败能重试**：一次失败不再把 (工作项, 仓库) 永久锁死；
3. **一份工作树只有一个身份**：恢复路径不再写出第二条 `has_worktree` 关系。

判断成功的最小证据：

```bash
node --test tests/integration/start-work-step-recording.test.js   # 期望：全绿
node --test tests/integration/start-work-retry-identity.test.js    # 期望：全绿
node --test tests/e2e/start-work-recovery.test.js            # 期望：不回归（MVP-0 的四条行为）
pnpm verify                                                  # 期望：exit 0
```

## Context and Orientation

### 补偿序列今天长什么样

```ts
// start-work.ts
export async function startWork(context, request) {
  const replayed = await ledger.replay(context.workspaceId, request.idempotencyKey)
  if (replayed !== undefined) return existingResult(context, contextId, replayed)   // ① 幂等键重放
  const claimed = await claimContext(context, contextId, request)                   // ② 认领
  if (claimed !== 'new' && claimed !== 'resume') return existingResult(...)
  return provision(context, request, contextId, ledger)                             // ③ 序列
}

async function provision(context, request, contextId, ledger) {
  const git = await provisionGit(context, request, namesFor(request), contextId)    // 分支 + 工作树
  await saveContext(context, contextId, request, git.status, git.branchExternalId, git.worktreeExternalId)
  ...
}
```

`claimContext` 只认两种情形：记录不存在（`new`）、或状态是 `Provisioning` 且租约过期（`resume`）。其余一律 `existing` → `existingResult` → `reportForExisting(status)`。

### 三个缺陷，一个共同的形状

| issue | 缺陷 | 为什么它是这个形状 |
|---|---|---|
| #183 | `saveContext` 在 `provisionGit` **整体返回之后**才写，所以「分支已建好」这个事实从不单独落盘；重放必然重跑 `ensureBranch`，而它每次重新解析 `fromRef` | **步骤结果没有分步落盘** |
| #184 | `Failed` 是终态：端口没有删除入口，`Closed` 没有写者，`contextIdFor` 是确定性的，所以一次失败永久锁死这一对 | **状态机没有出口** |
| #165 | `recordStartFacts` 从 `git.worktreeExternalId` 派生实体键，而该值在首次创建（provider 的规范路径）与复用（调用方字符串）两条路径上不同 | **身份从一个随路径变化的值派生** |

### 术语

- **步骤**：补偿序列里一次可独立成功或失败的外部写入（建分支、建工作树、启动执行）。
- **回填**：步骤成功后立刻把它的结果写进执行上下文记录。
- **重放**：`startWork` 被再次调用，且上下文记录已经存在。
- **接管**：重放时把一条终态记录重新置为 `Provisioning` 并继续。
- **active**：端口对执行上下文的措辞——「同一工作项 + 仓库最多一个 **active** 上下文」。

### 相关文件

| 文件 | 角色 |
|---|---|
| `packages/core/src/start-work.ts` | `startWork`、`claimContext`、`provision`、`saveContext`、`recordStartFacts` |
| `packages/core/src/git-provisioning.ts` | `provisionGit`、`ensureBranch`、`ensureWorktree`、`baseRef`、`branchNameFor`、`slug` |
| `packages/core/src/execution-context.ts` | `contextIdFor`、`contextRecord`、`reportForExisting`、`readExecutionContext` |
| `packages/capabilities/src/storage.ts` | 执行段的端口契约与它的「active」措辞 |
| `packages/providers/fake/src/storage.ts` | `isActiveContext`（排除 `Closed` 与 `Failed`） |
| `tests/e2e/start-work-recovery.test.js` | MVP-0 的四条行为断言（离线替身） |
| `docs/product/vertical-path.md` §2 步骤 6–8 | 行为面的验收依据 |
| `docs/architecture/release-gates.md` §2 第 10 行 | R1 门禁「Start Work 失败恢复已验证」 |

### 上游依据（都已实测，不是推测）

- **git 自己**：`git branch X <start>` 在 X 存在时报 `fatal: a branch named 'X' already exists`（**没有 create-or-reuse**）；`git worktree add <path> <branch>` 是**按名接管**；`git update-ref refs/heads/X <new> <全零>` 是**原子 create-if-absent**；目录被删但登记还在时 git **拒绝并点名补救动作**（`add -f` / `prune` / `remove`），不猜。
- **git 的中断恢复**：`rebase` / `am` 把每一步的进度写进 `.git/rebase-merge/done` 与 `git-rebase-todo`，重试是 **resume** 而不是 restart。
- **Stripe**：`idempotency_key` 绑定**第一次请求的 endpoint + 参数**；同 key 不同参数 → `idempotency_error`。key 的含义是「这一个确切的请求」。
- **Terraform**：「already exists」是错误，接管要显式 `terraform import`；**地址是名字，所有权是 state 里的一条记录**。
- **Helm / Kubernetes**：`install`（存在即失败）/ `upgrade --install`（存在则更新）/ `apply`（按名收敛）——模式由调用方显式选。

结论：**没有任何同类工具去"判断"已存在的东西是不是自己的。** 它们把问题拆成 identity / intent / progress 三件正交的事。

## Design / Spec

### D1 · 名字即身份，记录即所有权，sha 只做报告

- **身份**：分支名 `work/<slug>`，由工作项 id 派生，对 UUID 是恒等映射 → 122 位随机的、按工作项稳定的命名空间。
- **所有权**：我们自己记录的那一行（`ExecutionContextRecord.branchExternalId`），而不是「名字看起来像」或「sha 对得上」。
- **报告**：接管发生时把**实际接管的那个提交**作为事实带出来（`ProviderBranch.headCommit` 已经有，`ensureBranch` 今天把它丢掉了）。

**为什么不是 sha**：请求里根本没有 sha——它是 `baseRef()` 每次现推的产物。把易失值当身份，等于把「基线是否前进」提升成「这次请求是否合法」，那正是 #183 的故障本身。

**放弃的方案 C（祖先关系放宽）**：判别方向是反的——人已经在 `work/<slug>` 上提交过时，分支不再是 `main` 的祖先，**恰好在有真实工作可保时失败**；而且它是唯一一个「靠推断 identity」的方案，与所有先例相反。

### D2 · 步骤级回填 + 重放跳过（#183）

- `provisionGit` 接收一个可选的 `recordStep` 钩子；**`provision()` 仍然是唯一的持久化调用方**，钩子只决定「什么时候写」。签名向后兼容，`#160` 的集成测试直接调用 `provisionGit` 的写法不受影响。
- 分支步成功后（**新建或接管**）立刻回填 `branchExternalId`，然后才跑工作树步。
- 重放时若记录里已有 `branchExternalId` → **整个跳过分支步**，不解析 `fromRef`。基线是否前进因此不再进入判定。
- **工作树步故意不跳过**：它必须重跑才能保证工作树真的在（PR #160 的 F1 教训——「登记在册但目录消失」必须被拒绝，不能假设存在）。它没有「重新推导易失输入」的问题，所以幂等由**稳定的实体身份**（D7）提供，不由跳过提供。**订正**：本计划初稿写的是「工作树步同样处理」，那句话是错的。
- **序列已经决定的分支身份必须被后续步骤使用**：工作树步传的是 `branch.value`，不是本次请求重新算出来的 `names.branch`。调用方在重放时声明一个**不同**的 `branchName` 是**矛盾**，返回 `invalid_input` 并点名两个名字，而不是静默采纳新名字——静默采纳会让「报出去的身份」与「磁盘上的事实」分叉，与 PR #160 第二轮 P1 是同一形态。

### D3 · 接管终态（#184）

`claimContext` 把 `Failed`（与 `Closed`）视为**非 active**，允许被接管：

- 用 `{...existing, status: Provisioning, provisioningStartedAt: now}` **保留已记录的步骤字段**；**不得**用 `contextRecord(..., undefined, undefined)` 重建——否则 D2 刚落盘的 `branchExternalId` 会被抹掉，**D2 等于白做**。
- 在途（`Provisioning` 且租约未过期）**继续挡住**：接管只针对终态。
- `findActiveExecutionContext` 与 `isActiveContext` 的「active」语义写进 `packages/capabilities/src/storage.ts` 的端口注释——它今天只有存储契约套件一个消费者。

### D4 · 幂等键重放优先于接管

顺序不变：同 key 命中账本 → 返回**那一次**的报告，**不重新尝试**；**换新 key 才是重试**。这是 Stripe 的语义，必须写进文档，否则「我重试了却拿到旧错误」会被读成缺陷。

### D5 · 方案 2（显式关闭）不在本批次

「让人显式作废一个执行上下文」是这条状态机的另一半，但它不是小改动：确定性 id 下，终态 `Closed` 意味着这个工作项**永远不能再开始工作**，于是它逼出「一个 (工作项, 仓库) 能不能有第二份执行上下文」这个模型问题。它的自然归属是 #138（移除工作树）那一批，已登记在 #184 的 `Out of scope`。

### D6 · 分支名必须是可靠的身份（#183 的第二半）

`slug()` 在 cleaned 为空时塌成字面量 `'work-item'`，而 `---` 能通过 `validateRequest`（它只拒绝 trim 后为空）→ 所有这类 id 共用分支名 `work/work-item`。既然身份就是名字，这条可猜的共享名字是前提上的洞：**拒绝**（`invalid_input`）而不是合并。

### D7 · 工作树实体身份只由一处定义（#165）

~~身份是「**这个工作项在这个 binding 下的工作树**」，键为 `${bindingId}|${workItemId}`，由 `chain-facts.ts` 的 `worktreeEntityId` 唯一定义，**写入路径（`recordStartFacts`）与投影路径（`worktreeNode`）都调它，谁都不许再自己拼键**。~~ **Superseded by D12 (2026-09-24):** identity is scoped by `(workspaceId, repositoryId, workItemId)`, not binding.

**路径是属性，不是身份。** 把路径放进键里会造出**第二个派生点**：写入侧拿请求声明的路径，投影侧拿 provider 回填的句柄，而真实 provider 上这两者不同（首次创建返回规范化绝对路径，复用返回调用方字符串），于是**读一次谱系**就会为同一份工作树写出第二条 confirmed 关系、造出第二个实体。改路径重试、恢复时句柄被覆盖成相对路径，都是同一个洞的其它入口。

图谱节点仍携带 provider 的路径作为 `externalId`（那是 `removeWorktree` 需要的**句柄**）——**身份稳定、句柄权威**，两者职责分开。

**订正**：本计划初稿把键写成 `namesFor(request).path`。那是「写入侧单方面派生」——它只修了写入侧，投影侧仍在按路径派生，于是读一次谱系照样多出一条关系。真正的修法是**收敛到一处定义**，而不是把两处的字符串对齐。

### 接受的残留（不假装解决）

1. **写前意图窗口**：进程恰好死在 `git branch` 与回填之间时，重放仍会重推 `fromRef`，基线前进仍会硬失败。关掉它需要「写前意图记录」（先落盘"我打算建 `work/<slug>`，起点 X"，重放时"有意图 + 分支存在"即视为自己的）。**不在本批次**，登记为技术债。
2. **`worktreeExternalId` 的句柄值在两条路径上仍可能不同**（provider 的规范路径 vs 调用方字符串）。实体身份不再受影响（D7），功能也不受影响（provider 的相对路径解析按仓库根解析）。收口条件：让 `createWorktree` 的 `conflict` 也能带回既有工作树的规范引用（需要 `ProviderError` 带值，属 provider 契约变更），或给端口加一个工作树读面。
3. **幂等键没有绑定请求指纹**：同 key 换一个工作项会命中账本、返回那一次的 `saved` 报告，而**什么都没有供应**——一次静默的假成功。见「遗留」§2。

**订正一处错误的论证**：初稿把 #165 的残留窗口写成「进程死在 `git worktree add` 成功与回填之间」。**那个窗口不产生重复边**——`recordStartFacts` 在 `provisionGit` **整体返回之后**才调用，死在序列中途时它根本没跑。真正**自然可达**的重复边是「工作树步失败 → #184 接管重试」：失败那一次已经写下一条关系，重试成功后按另一条路径的键再写一条。结论（#165 仍然必要）不变，论证换了。

## Global Constraints

- 只改 `packages/core/**`、`packages/capabilities/src/storage.ts`（仅注释）、`tests/**`、`docs/**`。
- **不改** `packages/providers/**`（#160 / #161 的领地）、`packages/domain/**`、`packages/storage/sqlite/**`（在飞 SQLite 栈的领地）。
- **不写 `Status`**：看板的规划轴由人拥有。看板字段回填只做机械推导项（Kind / Area / Size / Priority / Iteration / ExecPlan / Batch），已在开 PR 前完成。
- 不新增依赖；不改 `pnpm-lock.yaml`；文档不写本机绝对路径。
- 代码 ≤1000 行、文档 ≤1500 行（按 `origin/main` 度量）。
- 与在飞 PR 的冲突**不止索引文件**（订正初稿把它说小了）：
  - `docs/README.md` 的 Active 计划表、`tests/integration/README.md` 的用例登记表——**两边都保留，按小节拼合**；
  - **`tests/integration/development-local-git.test.js`（#160 的文件）里有两条断言把本批次要修的缺陷写成了期望值**：`assert.equal(hasWorktree.length, 2)` 与 `assert.equal(new Set(...).size, 2)`。在本 PR 的 head 上用同一场景求值，两条都红（actual 1 / expected 2）——**两个 PR 不能同时绿**。初稿把这两条误写成 `assert.notEqual`。
  - 处置：**谁后合并谁负责替换那两条断言**（替换成关系层的「边数 = 1」并点名本批次的身份定义）。本 PR 在 `origin/main` 上，**不改 #160 的文件**。已登记在「遗留」§1。

## Plan of Work

四个批次，每个批次一个可独立审阅的提交序列；批次内的验证必须先看到红。

### Batch 1 · 步骤级回填与重放跳过（#183）

**最小闭环**：中断在分支步之后、工作树步之前的上下文，重放时跳过分支步。

**涉及文件**：`packages/core/src/git-provisioning.ts`、`packages/core/src/start-work.ts`、`packages/core/src/execution-context.ts`、`tests/integration/start-work-step-recording.test.js`（新）。

**步骤**：

1. 先写会失败的用例：用真实的本地 Git provider 组装 core，注入一个「分支步成功后立刻失败」的故障，断言**存储里已经有 `branchExternalId`**（今天必然是 `undefined`）。
2. 再写会失败的用例：把基线分支推进一个提交，然后重放，断言**成功且复用既有分支**（今天是 `invalid_input` / `Failed`）。
3. `provisionGit` 增加可选 `recordStep` 钩子；`provision()` 在分支步与工作树步之后各回填一次。
4. 重放时若 `branchExternalId` 已记录则跳过分支步。
5. `ensureBranch` 把 provider 返回的 `headCommit` 带进结果面（接管不静默）。
6. `slug()` 的退化输入改为 `invalid_input` + 判别性用例。

**验证命令与期望输出**：

```bash
node --test tests/integration/start-work-step-recording.test.js   # 期望：红 → 绿，且用例名点名行为
node --test tests/e2e/start-work-recovery.test.js                  # 期望：不回归
pnpm verify                                                       # 期望：exit 0
```

**实测（2026-09-24，head 见 PR）**：

| 用例 | 红（实现暂存后） | 绿 |
|---|---|---|
| 中断在分支步之后：分支步的结果已经落盘 | `actual: undefined` / `expected: 'work/<uuid>'` | ✔ |
| 基线前进之后重放：跳过分支步、复用既有分支 | `actual: 'failed'` / `expected: 'ready'` | ✔ |
| 接管不静默：被复用分支的头提交出现在结果面 | `actual: undefined` / `expected: 'sha-1'` | ✔ |
| 退化的工作项 id 被拒 | `actual: undefined` / `expected: 'invalid_input'` | ✔ |
| **合计** | `ℹ tests 4 / pass 0 / fail 4` | `ℹ tests 4 / pass 4 / fail 0` |

变异实验（逐条记录红/绿，还原后 `diff` 与备份逐字节一致）：

| # | 改坏 | 红 | 还原 |
|---|---|---|---|
| M1 | 去掉分支步的 `recordStep` 调用 | `pass 1 / fail 3`（前三条全红） | `4 / 0` |
| M2 | 去掉重放跳过（永远重跑分支步） | `pass 2 / fail 2`（重放与头提交两条红） | `4 / 0` |

全量（本验收 head 实测）：`pnpm verify` → **512 pass / 0 fail** + mvp0 **7 pass / 0 fail**；`pnpm run boundaries` → 7/7；`tests/e2e/start-work-recovery.test.js` → 1/1（不回归）；`tests/integration` → **22/22**。

**回滚点**：本批次一个提交；`git revert` 即可，无外部状态。

### Batch 2 · 终态可接管（#184）

**最小闭环**：一次 provisioning 失败之后，清掉原因，换一个新幂等键重试成功。

**涉及文件**：`packages/core/src/start-work.ts`、`packages/capabilities/src/storage.ts`（注释）、`tests/integration/start-work-retry-identity.test.js`。

**步骤**：

1. 先写会失败的用例：制造一次可清除的失败（路径被非工作树占用）→ 清掉 → 换新 key 重试 → 今天返回 `Unavailable`。
2. `claimContext` 允许接管 `Failed` / `Closed`，**保留步骤字段**。
3. 用例钉住：同 key 重放返回旧报告且不重新尝试；在途仍被拒；接管后 `branchExternalId` 未被抹掉。
4. 端口注释写明 active 语义；存储契约套件补一条 `Failed` 上下文的用例。

**验证命令与期望输出**：同上，另加 `node --test tests/contract/storage-contract.test.js`。

**回滚点**：本批次一个提交。

### Batch 3 · 工作树实体身份（#165）

**最小闭环**：恢复路径只写一条 `has_worktree` 关系。

**涉及文件**：`packages/core/src/start-work.ts`、`packages/core/src/chain-facts.ts`、`tests/integration/start-work-retry-identity.test.js`。

**步骤**：

1. ~~把 `#160` 里那两条**表征缺陷**的断言换成**关系层**的断言~~ —— **本 base 上不可执行，已订正**：`tests/integration/development-local-git.test.js` 属于未合并的 #160，`origin/main` 上没有这个文件。关系层断言因此写在**本批次自己的新文件**里（`start-work-retry-identity.test.js` 的「身份：失败后重试只留下一条 has_worktree 关系与一个工作树实体」）。#160 合并后，它那两条 `assert.notEqual` 表征断言由**变基到新 main 的人**替换——本批次不碰它的文件集。
2. 先看它红（今天是 2）。
3. ~~实体键改用 `namesFor(request).path`；图谱节点的 `externalId` 仍用 provider 的规范路径。~~ **Superseded by D12 (2026-09-24):** both write and projection paths call `worktreeEntityId(workspaceId, repositoryId, workItemId)`; provider path remains an external handle.
4. 复跑 Batch 1 / 2 的用例，确认没有回归。

**验证命令与期望输出**：同上。

**回滚点**：本批次一个提交。

### Batch 4 · 文档与索引

**最小闭环**：`docs/README.md` 的 Active 表 +1 行；`tests/integration/README.md` 登记新用例；本计划的 `Progress` / `Outcomes` / `Bottom Change Note` 回填；`docs/architecture/release-gates.md` 第 10 行的判定方式补上「中断后续跑」这一面（如果它今天没写）。

**实测（Batch 4 完成后）**：`tests/integration/README.md` 新增「Start Work 恢复」一节（两个文件的用例 × 不变量，并如实写明替身边界）；`tests/README.md` 在「运行方式」下新增一条**在隔离 worktree 里跑测试前必须先安装依赖**的要求（见 Surprises 的解析陷阱）。`docs/architecture/release-gates.md` **未改**——见下面的 Decision Log D10。

**验证命令与期望输出**：

```bash
node scripts/rule-checks.mjs size origin/main     # 期望：代码 ≤1000、文档 ≤1500，exit 0
node scripts/rule-checks.mjs disclosure origin/main
git diff --check origin/main...HEAD
node scripts/workflow-check.mjs
```

**回滚点**：本批次一个提交。

## Validation and Acceptance

| # | 验收项（来源） | 判定证据 | 结果 |
|---|---|---|---|
| 1 | #183：分支步成功后 `branchExternalId` 已落盘（在工作树步之前） | 注入「分支步后立刻失败」→ 读存储记录，断言 `branchExternalId` 非空 | 通过（`中断在分支步之后…`；红基线 `undefined !== 'work/<uuid>'`） |
| 2 | #183：基线前进后重放**成功并复用**既有分支，不重新解析 `fromRef` | 覆写 `createBranch` 复刻「同名指向别处」的拒绝 → 推进基线 → 重放，断言 `ready` 且分支头未变 | 通过（`基线前进之后重放…`；红基线 `'failed' !== 'ready'`）。**第一轮 MMP 评审订正**：替身上的证据成立，但 #183 原文要求的是**真实临时仓库**上的集成用例，本 PR 的 base 上还没有真实 provider。评审在 `main`+#160+#161 上叠本 PR、用真实 provider 复跑同一场景：不含本 PR 时 `failed / invalid_input`，含本 PR 时 `ready` 并报出头提交——行为成立，用例归 #183 剩余项 |
| 3 | #183：接管的实际提交被报告出来 | 断言结果面带 `headCommit`，且它等于既有分支的头 | 通过（`接管不静默…`；红基线 `undefined !== 'sha-1'`）。**第一轮 MMP 评审订正**：部分成立——`branchProbe` 只读第一页 100 个分支，110 个分支时头提交为 `undefined`；controller 的 `toStartWorkView` 也不带这个字段。归 #183 剩余项 |
| 4 | #183：退化 slug 被拒 | `workItemId: '---'` → `invalid_input`，且**没有** `work/work-item` 分支产生 | 通过（`退化的工作项 id 被拒…`；红基线 `undefined !== 'invalid_input'`） |
| 5 | #184：失败后换新 key 重试成功 | 占用路径 → 失败 → 清掉 → 新 key 重试 → `ready` | 通过（`重试：可清除的失败之后…`；红基线 `'failed' !== 'saved'`） |
| 6 | #184：接管保留步骤字段 | 分支步后失败 → 清原因 → 重试 → 记录里的 `branchExternalId` 是**复用**而不是重建 | 通过（`接管：终态被接管时保留已记录的步骤字段…`；变异 M1 变红） |
| 7 | #184：同 key 不重新尝试 | 同 key 两次调用 → 第二次返回同一份报告，且 Git 调用次数不增加 | 通过（`幂等：同一个 key 返回那一次的报告…`） |
| 8 | #184：在途仍被拒（**判别性**） | `Provisioning` + 未过期租约 → 拒绝。中断必须注入在**分支步之后**，否则 `recordStep` 从未执行、中途 `saveContext` 从未跑过，这条对租约没有判别力 | 通过（`在途：分支步已回填且租约未过期时仍被拒…`；变异 M-A 变红） |
| 9 | #184：active 语义有端口注释与契约用例 | `storage-contract.test.js` 里 `Failed` 上下文一条 | 通过（`内存 Storage 替身：Failed 与 Closed 不是 active…`；注释落在端口执行段） |
| 10 | #165：恢复后只有一条 `has_worktree` 关系 | 关系层断言：边数 = 1，且 `to` **精确等于** `worktreeEntityId(ws, repositoryId, workItemId)` | 通过（`身份：失败后重试只留下一条 has_worktree…`；变异 M2 变红）。**红基线订正**：该用例在 `e3c99c5^` 上红的是**精确身份**断言，不是 `2 !== 1`——那条属于更早的 `17e9cc3`；在 `e3c99c5^` 上两次都走默认路径、写入侧键相同，边数本来就是 1 |
| 11 | 不回归 | `node --test tests/e2e/start-work-recovery.test.js` 全绿；`pnpm verify` exit 0 | 通过（e2e 1/1；`pnpm verify` **508/508** + mvp0 7/7；`boundaries` 7/7；`storage-contract` 17/17） |
| 12 | 体量与发布面 | `size` / `disclosure` / `git diff --check` / `workflow-check` 全通过 | 通过（代码 **798**/1000、文档 **416**/1500；其余三项 exit 0） |
| 13 | P1-A：序列已决定的分支身份被后续步骤使用；重放声明另一个分支名是**矛盾** | 声明 `work/beta`（且该分支存在）→ `invalid_input` 且点名两个名字、不留工作树；省略 `branchName` → 工作树落在已决定的 `work/alpha` 上 | 通过（`重放不得改变已决定的分支身份…`、`重放省略 branchName 时仍然用已决定的身份…`；变异 M-C 变红） |
| 14 | P1-B：工作树实体身份**只有一处派生** | 复刻真实 provider 的「句柄是规范化路径」形态 → 读一次谱系，边数仍为 1 且 id 精确等于 `worktreeEntityId(ws, repositoryId, workItemId)` | 通过（`身份只有一处派生…`；变异 M1 变红）。**红基线订正**：「2 条关系 / 2 个实体」不是该用例变红的断言——在 `e3c99c5^` 上它读谱系**之前**已是 1 条、读之后才 2 条，该用例红在**前置的精确身份断言**上；「读之后 2 条」是那条谱系断言的证据 |
| 15 | P1-B：路径是属性，不是身份 | 改 `worktreePath` 重试 → 仍然只有一个实体 | 通过（`身份不随路径变化…`） |
| 16 | P2-1：关系层断言有**判别力** | 断言精确的派生值，而不是被「边数 = 1」逻辑蕴含的「实体数 = 1」 | 通过（变异 M-E：把身份换成另一个**请求派生且稳定**的值（分支名）→ 三条身份用例全红） |
| 17 | P2-2：两条承重修复各有回归防线 | ① 分支步已落盘 + 租约未过期 → 重试仍被拒；② 记录里没有 `branchExternalId` 时，即使分支已存在也必须重走分支步 | 通过（变异 M-A 只让 ① 变红、M-B 只让 ② 变红） |
| 18 | 第三轮 P1：身份的作用域是**仓库**，不是 binding | 把 `DevelopmentRepositoryRead` 置为 `Unavailable` → `startWork` 成功，写入侧 id = `repositoryId\|workItemId`；读一次谱系后边数仍为 1、`to` 不变 | 通过（`身份的作用域是仓库而不是 binding…`；变异 M1 复现验证者的签名 `2 !== 1`） |
| 19 | 第三轮 P2：同一工作项在两个仓库上是两个实体 | 同一 binding 下两个仓库各 `startWork` 成功 → 两条关系的 `to` 必须不同，且各自精确等于按三元组算出的值 | 通过（`两个仓库上的两份工作树是两个实体…`；变异 M2 变红） |
| 20 | 第三轮 P2：序列第三步也用已决定的分支身份 | 首次声明 `branchName: 'work/alpha'` 并在分支步后中断 → 省略 `branchName` 重放 → run command 必须是 `harness run work/alpha`，不得回落到默认名 | 通过（`重放省略 branchName 时仍然用已决定的身份…` 里的 run command 断言；变异 M3 变红：actual `harness run work/<uuid>`） |

## Progress

- [x] (2026-09-24) 设计与裁决：D1–D7 定稿；三个 issue 建立并互链；看板字段回填；worktree 与分支建立。
- [x] (2026-09-24) Batch 1 · 步骤级回填与重放跳过（#183）—— 执行者 W-A；四条验收全部落地，见下方 Surprises 与 Batch 1 的实测记录
- [x] (2026-09-24) Batch 2 · 终态可接管（#184）—— 执行者 W-B；`claimContext` 接管终态并保留步骤字段，端口注释写明 active 语义，存储契约补 `Failed` 用例
- [x] (2026-09-24) Batch 3 · 工作树实体身份（#165）—— 执行者 W-B；身份收敛到 `worktreeEntityId(workspaceId, repositoryId, workItemId)`，图谱节点仍挂 provider 的路径作句柄
- [x] (2026-09-24) Batch 4 · 文档与索引——执行者 主控；`tests/integration/README.md` 与 `tests/README.md` 各补一节，`release-gates.md` 按 D10 未改
- [x] (2026-09-24) **对抗验证轮修复**（2×P1 + 4×P2 + 5×P3，逐条红/绿 + 五次变异实验）：P1-A 序列身份、P1-B 身份单一派生点、P2-1 断言判别力、P2-2 两条回归防线、P2-3/P2-4 与 P3 的计划订正。见下方 Surprises 与 Decision Log D12

- [x] (2026-09-24) 第一轮 MMP 评审：无 P0；关闭声明改为 `Refs #183`；`docs/README.md` 索引与三处 P3 就地修；follow-up #192 / #193 / #194；本计划归档，提交按可回滚的交付物收敛

## Surprises & Discoveries

- **(2026-09-24，W-B) 「接管保留步骤字段」这条不变量在一次**成功**的重试之后不可观察。** 第一次写的用例是「失败 → 清原因 → 重试 → 读记录，断言 `branchExternalId` 没变」，它**全绿**——包括在「接管时重建记录」这个错误实现下（变异 M1）。原因是成功的重试会走完供应序列，`saveContext` 把 `branchExternalId` 重新写回去。可观察的窗口只有「接管事务提交之后、`saveContext` 覆盖它之前」，所以用例必须在供应序列的**第一步**取样（`createBranch` 被调用时读一次存储）。**这条如果不做变异实验就会带着假绿通过评审。**
- **(2026-09-24，W-B) 新建 worktree 里没有 `node_modules` 时，裸包名会沿父目录解析到主检出的 `packages/`。** 本批次第一次跑「先红」时，`@harness-projects/core` 解析到了主检出未修改的源码，于是红基线是在**错误的代码**上取得的（随后在正确的解析下重做才得到有效证据）。凡是「在 worktree 里跑测试」的批次都要先 `pnpm install --frozen-lockfile`，并用 `ls -l node_modules/@harness-projects/core` 确认它指向本 worktree。

- **(2026-09-24) `findActiveExecutionContext` 只有存储契约套件一个消费者。** `startWork` 用的是确定性 id 的 `getExecutionContext`。端口注释写的是「最多一个 **active** 上下文」，fake 的 `isActiveContext` 明确排除 `Closed` 与 `Failed`——**「Failed 不算 active，所以它不该挡住下一次开始」这句话在端口面上已经写过了**，只是没接线。这条发现把 #184 从「加一个重试开关」变成了「把已表达的语义接上」。
- **(2026-09-24) `provisionGit` 被 `#160` 的集成测试直接调用。** 所以本批次不能改它的签名，只能加可选参数——否则会与在飞 PR 硬冲突。
- **(2026-09-24) 与在飞 PR 的文件重叠只有两个索引文件**（`docs/README.md`、`tests/integration/README.md`），其余完全不相交。
- **(2026-09-24，Batch 1) 分步回填会踩坏在途保护。** `saveContext` 原来硬编码 `provisioningStartedAt: undefined`——它在整段供应结束后才被调用一次，所以清掉租约起点是对的。分步回填第一次让它在 `Provisioning` **中途**被调用，于是租约起点被抹掉，`claimContext` 的 `leaseExpired(undefined, now)` 恒为真，**在途保护静默失效**。修法：中途写入（`status === Provisioning`）保留既有的租约起点，终态照旧清空。这是分步回填**引入**的问题，不是预先存在的。
- **(2026-09-24，Batch 1) 跳过判定只能落在 `provisionGit` 内部。** 冻结的签名是 `provisionGit(context, request, names, contextId, recordStep)`，没有位置把「上下文里已经记录了分支步」这个决定传进去，所以它自己读一次 `getExecutionContext(contextId)`（它本来就拿得到 `context` 与 `contextId`）。与最初设想的「`provision` 先读一次再传下去」不同，原因是签名被冻结——记在这里以免下一个人以为是随手放的。
- **(2026-09-24，Batch 1) 头提交在重放路径上只能现读。** `ExecutionContextRecord` 没有 `branchHeadCommit` 这一列，而 Storage 契约不归本批次改。所以「跳过分支步」时用一次 `listBranches` 现读被复用分支的头提交；读不到就报 `undefined`，**不改变任何拒绝语义**。`existingResult` 从记录重建结果面时同样报不出来（同一原因，已在代码里注明）。
- **(2026-09-24，Batch 1) 离线替身完全不看 `fromRef`。** `FakeDevelopmentProvider.createBranch` 只把 `fromRef` 当分支名查 head、同名一律报 `Conflict`，所以它**表达不了**「同名分支指向别处」这个真实拒绝，「基线前进」必须由测试覆写 `createBranch` 来模拟。真实本地 Git provider 在未合并的 PR #160 上，真实的临时仓库集成归 #141（被 #137 / #120 阻塞）——本层因此用 `tests/integration` + 离线替身 + 最小覆写，并在用例头注释里写明这处取舍。
- **(2026-09-24，Batch 1) 测试环境陷阱：worktree 里没有 `node_modules` 时，裸包名会解析到主检出的 `packages/`。** 第一次「先红」因此是对着主检出的源码跑的，判别性不成立；在 worktree 内 `pnpm install --frozen-lockfile` 之后重做了红/绿对照（`node_modules/@harness-projects/core -> ../../packages/core`，指向本工作树）。后续任何在本仓库跑测试的人都要先确认这一条。

- **(2026-09-24，对抗验证轮) 「跳过分支步」把序列的身份决定权留在了半空中。** `ensureWorktree` 收的是 `names.branch`（**本次请求**算出来的），而报出去的 `branchExternalId` 是记录里的——两条线各走各的。只要调用方在重放时声明另一个**已存在**的分支名，工作树就会落在那个分支上、而 wire 报的是旧身份，与 PR #160 第二轮 P1 完全同形（实测：`status=ready` / `writeState=saved` / `reported=work/alpha` / 磁盘 `work/beta`）。根因不是「少了一个校验」，而是**序列已经决定的身份没有被后续步骤使用**。
- **(2026-09-24，对抗验证轮) 同一份事实有两处派生点，读一次谱系就多一条边。** `recordStartFacts` 与 `worktreeNode` 各拼一份工作树实体键，而真实 provider 的句柄是**规范化绝对路径**（不是请求里的字符串），于是投影侧算出另一个 id。用替身的默认形态**测不出来**——它的句柄恰好等于请求路径，分叉被掩盖；必须复刻真实 provider 的返回形态才能复现（1 → 2 条关系、1 → 2 个实体）。修法是收敛到一处定义（`worktreeEntityId`），不是把两处字符串对齐。
- **(2026-09-24，对抗验证轮) 「实体数 = 1」是恒真的断言。** 它被「边数 = 1」逻辑蕴含，所以把实体键换成另一个「请求派生且稳定」的值（例如分支名）时，用例**仍然全绿**。变异 M-E 证明：只有断言**精确的派生值**才有判别力。
- **(2026-09-24，对抗验证轮) 一条用例的判别力取决于中断注入在哪一步。** 「在途仍被拒」原来把中断注入在 `createBranch` 里——`recordStep` 从未执行、中途 `saveContext` 从未跑过，于是把「中途写入保留租约起点」改成清空租约，测试**仍然全绿**。把注入点移到**分支步之后**，同一条变异立刻变红。**注入点选错，用例就只是在重复实现。**
- **(2026-09-24，对抗验证轮) 幂等键没有绑定请求指纹。** 账本只按 `(workspaceId, idempotencyKey)` 查，不校验工作项/仓库，所以**同 key 换一个工作项会返回那一次的 `saved` 报告而什么都没供应**（实测：上下文 1、分支 2、工作树 1，全部未变）。本批次**不修**（要记请求指纹，是 write ledger 的跨层变更），把代码注释从「Stripe 语义：key 绑定这一个确切的请求」收窄到实现真正做到的，并登记进「遗留」§2。

## Decision Log

| # | 决策 | Rationale | 日期/作者 |
|---|---|---|---|
| D1 | 名字即身份、记录即所有权、sha 只做报告 | sha 是 `baseRef()` 每次现推的产物，把易失值当身份就是 #183 的故障本身；分支名是稳定的、由工作项命名空间化的、且已记录在 git 里 | 2026-09-24 / 人类伙伴与批次执行者 |
| D2 | 步骤级回填 + 重放跳过 | 对照 git 的 sequencer（`.git/rebase-merge/done`）与 Terraform 的 state：重试从记录的进度继续，而不是重新推导输入 | 同上 |
| D3 | 接管 `Failed` / `Closed`，保留步骤字段 | 复用端口已表达的 active 语义；重建记录会抹掉 D2 的成果 | 同上 |
| D4 | 幂等键重放优先，换 key 才是重试 | ~~Stripe 的语义：key 绑定「这一个确切的请求」~~ —— **订正**：账本只按 `(workspaceId, idempotencyKey)` 查，**不校验请求**，所以这个类比是错的。实现真正做到的是「同 key 返回那一次的报告」；缺的请求指纹登记在「遗留」§2 | 2026-09-24 / 对抗验证轮订正 |
| D5 | 方案 2（显式关闭）不在本批次，归属 #138 | 它逼出「能不能有第二份执行上下文」这个模型问题，成本远高于「加一个命令」 | 2026-09-24 / 批次执行者 |
| D6 | 退化 slug 拒绝而不是合并 | 既然身份就是名字，可猜的共享名字是前提上的洞 | 2026-09-24 / 批次执行者 |
| D7 | ~~工作树实体键从请求派生（#165 选项 1）~~ → **订正为「身份只由一处定义」** | 初稿只修了写入侧，投影侧仍按路径派生，读一次谱系照样多一条关系。真正的修法是收敛到 `worktreeEntityId` 一处定义，写入与投影都调它；路径降级为属性 | 2026-09-24 / 对抗验证轮订正 |
| D8 | 只有 `Closed` / `Failed` 可接管，`Planned` 不可 | 端口把 active 定义成「不是终态」，替身的 `isActiveContext` 排除的正是这两个；把接管面扩到 `Planned` 会让代码与端口语义分叉 | 2026-09-24 / 执行者 W-B |
| D9 | 「接管保留步骤字段」的断言在**供应序列的第一步**取样 | 被变异实验逼出来的：一次**成功**的重试会走完序列，`saveContext` 把 `branchExternalId` 重写回去，所以这条不变量在重试完成后不可观察。集成 Batch 1 之后取样点进一步移到工作树步（分支步被跳过），并新增 `branchStepCalls === 0` 把两个批次的契约连起来 | 2026-09-24 / 执行者 W-B + 集成者 |
| D10 | **不改 `docs/architecture/release-gates.md` 第 10 行** | 它今天把「重启后可恢复」判成「重建 core 后能查到上下文」（§2.1 item 10）。本批次让更强的一面（中断的 provisioning 真的续上）成立且有用例，但**改门禁要求是规划决定**，不是文档订正——需要人类批准。已在 #141 留评论说明两种读法结论相反，留给门禁的所有者决定 | 2026-09-24 / 集成者 |
| D11 | 并行实现按**函数边界**切所有权，而不是按批次切文件 | 三个批次都改 `start-work.ts`。按文件切会让两个执行者互相踩；按函数切（W-A：`provision` / `provisionGit`；W-B：`claimContext` / `recordStartFacts`）让三个代码提交在集成时**零冲突**，唯一冲突落在计划文件的一处 Progress 列表 | 2026-09-24 / 集成者 |
| D12 | 工作树实体的身份 = **这个工作项在这个仓库上的工作树**（键 `${repositoryId}\|${workItemId}`，与 `contextIdFor` 同一个三元组） | **订正**：初版把作用域写成 binding（键 `${bindingId}\|${workItemId}`），那是错的——**binding 的解析有多个来源**（写入侧走 `DevelopmentWorktreeCreate`、投影侧走 `DevelopmentRepositoryRead`），两个 capability key 可以独立不可用，于是同一份工作树仍会拿到两个身份（第三轮 P1 实测：仓库读能力置为 `Unavailable` → 读一次谱系 1 → 2 条关系）。**repository 是执行上下文记录里已有的事实**，两侧取同一列、不需要任何 capability 解析，分叉从构造上不存在。路径仍然是属性不是身份：写入侧拿请求路径、投影侧拿 provider 句柄，真实 provider 上两者不同。`resolveRepository` 因此仍然保留，但它的用途收窄为**只给 provider 调用造引用**（读分支头、变更请求、流水线），不再参与任何实体身份——`commitNode` / `changeRequestNode` 的键仍含 binding，那是 provider 对象的作用域，与工作树身份无关 | 2026-09-24 / 对抗验证轮 + 第三轮订正 |

## Idempotence and Recovery

- 本批次全部是仓库内容改动，无外部状态写入（看板字段已在开 PR 前完成，且不随仓库回滚）。
- 每个批次一个提交，`git revert <sha>` 可独立回退；三个批次之间无相互依赖的迁移。
  > **Superseded by**（2026-09-24，第一轮 MMP 评审）：批次之间有测试依赖（Batch 2 的 `branchStepCalls === 0` 依赖 Batch 1 的跳过），单独 revert Batch 1 会在 `start-work.ts` 与 `start-work-step-recording.test.js` 上冲突。合并前已按可回滚的交付物收敛为一个代码提交，回滚单位是整个恢复序列修复。
- 重放语义本身是幂等的：同 key 不重复尝试（D4），已完成步骤不重跑（D2）。
- 失败恢复：若 Batch 1 的用例在真实仓库上不稳定（临时目录、Git 版本差异），先把它降级为带显式前置断言的版本并记录，**不要**放宽断言。

## Interfaces and Dependencies

- `packages/capabilities/src/storage.ts` 的 `Storage` 端口：本批次**只改注释**，不改方法集合（`StorageSurface` 的精确类型断言不变）。
- `packages/core/src/git-provisioning.ts` 的 `provisionGit`：新增**可选**参数，向后兼容。
- 无新依赖、无凭据需求、无仓库设置变更。
- 依赖的既有行为：`packages/providers/development-local-git` 的 `createBranch` 对「同名同起点」返回 `ok`（幂等复用）、对「指向别处」返回 `invalid_input`（#160 交付）。本批次不依赖它的具体错误码，只依赖「不会被 core 当成复用」。

## Outcomes & Retrospective

**结果（本验收 head 实测）**：Batch 1–4 全部落地，四个聚焦文件合计 **35 / 35**，`pnpm verify` **512 / 512** + mvp0 **7 / 7**，`pnpm run boundaries` **7 / 7**；体量为代码 **934 / 1000**、文档 **455 / 1500**。三个 issue 的验收标准逐条落在用例上（见 Validation 表 17 行）。

> **Superseded by**（2026-09-24，第一轮 MMP 评审实测）：聚焦文件是五个、合计 **42 / 42**（`start-work-step-recording` 8、`start-work-retry-identity` 9、`storage-contract` 17、`start-work-recovery` 1、`delivery-lineage` 7）；最终 head 的数字只写在 PR 描述里，以复跑为准。

**体量口径说明**：`size` 判定的是 `git diff <base>...HEAD`，即**已提交**的 head。本轮修复由主控负责提交，所以这两个数字是用**同一实现**（`rule-checks.mjs` 的 `size()`，注入 `readNumstat` 指向 `git diff --numstat <merge-base>`）在**工作树**上量的——口径与提交后逐字相同，并已用已提交 head 的 `589 / 370` 校准过复刻（校准值一致）。**初稿写的 `577 / 1000、316 / 1500` 是错的**（与 `ae59f8d` 上的实测 `589 / 370` 都不符），已订正。

**对抗验证轮（2026-09-24）**：三个独立验证者分别对 #183 / #184 / #165 证伪，报 **2×P1 + 4×P2 + 5×P3**，逐条复现后按根因修复：

| 编号 | 根因 | 修法 | 证据 |
|---|---|---|---|
| P1-A | 序列已决定的分支身份没有被后续步骤使用（工作树步用本次请求的 `names.branch`） | 工作树步改用 `branch.value`；重放声明一个不同的 `branchName` → `invalid_input` 点名两个名字 | 红：`ready` / `saved` / `reported=work/alpha` / 磁盘 `work/beta`；绿：`invalid_input`。变异 M-C 变红 |
| P1-B | 同一份事实（工作树身份）在两处各自派生 | 身份收敛到 `worktreeEntityId` 一处定义（键 `${repositoryId}\|${workItemId}`），写入与投影都调它；路径降级为属性 | 红：读一次谱系 1 → 2 条关系、1 → 2 个实体；绿：1 / 1。变异 M-D 变红 |
| P2-1 | 关系层断言无判别力（「实体数 = 1」被「边数 = 1」蕴含） | 断言精确的派生值 | 变异 M-E（换成另一个请求派生且稳定的值）→ 三条身份用例全红 |
| P2-2 | 两条承重修复没有回归防线 | ①「在途」的中断注入点移到**分支步之后**；② 新增「不去猜：记录里没有 `branchExternalId` 时即使分支已存在也必须重走分支步」 | 变异 M-A 只让 ① 变红、M-B 只让 ② 变红 |
| P2-3 | 计划 D2 写「工作树步同样处理」，与实现不符 | 订正 D2：分支步跳过、**工作树步故意重跑**（幂等靠稳定身份，不靠跳过） | 文档订正 + 代码注释 |
| P2-4 | 计划把与 #160 的冲突说小了，且把断言类型写错 | 订正 Global Constraints 与「遗留」§1：冲突包含两条把缺陷写成期望值的断言，两个 PR 不能同时绿，谁后合并谁替换 | 文档订正 |
| P3 | 体量数字错、Validation 1–4 未回填、最小证据指向不存在的文件、#165 残留论证错、`claimContext` 注释过度声称 Stripe 语义 | 逐条订正；#165 的残留论证换成真正自然可达的那条（工作树步失败 → #184 接管重试）；注释收窄并登记「遗留」§2 | 文档 + 代码注释订正 |

五次变异实验（M-A … M-E）逐条记录红/绿，每次还原后与备份 `diff` 逐字节一致。新增用例 5 条（`start-work-step-recording` 4 → 7、`start-work-retry-identity` 5 → 7 中新增 2、改写 1）。

**与计划的偏差（三条，都已就地订正）**：

1. **Batch 3 步骤 1 不可执行**：它要求替换 #160 集成用例里的两条表征断言，而那个文件属于未合并的 #160、`origin/main` 上没有。关系层断言改写在批次自己的新文件里（D 见 Batch 3 一节）。
2. **`release-gates.md` 未改**（D10）：门禁要求的变更需要人类批准。
3. **并行按函数切而非按文件切**（D11）：三个批次共用 `start-work.ts`，按批次切文件会让两个执行者互相踩。

**两处实现者主动偏离主控指示、并被接受**：

- **`saveContext` 的函数体必须改**（W-A）：它硬编码清空 `provisioningStartedAt`，在「整段供应结束后调用一次」的旧前提下是对的；分步回填第一次让它在 `Provisioning` **中途**被调用，于是租约起点被抹掉、`leaseExpired(undefined, now)` 恒真、**在途保护静默失效**。这是分步回填自己引入的问题，不修就会让 D3 的「在途仍被拒」变成空话。
- **跳过判定落在 `provisionGit` 内部**（W-A）：冻结的签名没有位置传这个决定；加第 6 个参数会破接口。代价是 `provisionGit` 从纯计算变成读一次存储。

**集成暴露的问题（这是并行开发的真实成本，值得记下）**：两个执行者各自全绿，合起来 `start-work-retry-identity.test.js` 有一条红——它的取样点是「`createBranch` 被调用」，而 Batch 1 的跳过让重放不再调用它，用例自己的防假绿守卫先响了。修法不是放宽守卫，而是把取样点移到重放真正会跑的那一步，并新增 `branchStepCalls === 0` 把两个批次的契约连起来；重跑变异 M1 仍红，说明不变量没被放宽。

**第一轮 MMP 评审（2026-09-24）**：无 P0；唯一的 P1 是**关闭声明与证据不符**（不是代码缺陷），其余按"机械 **且** 留着会在 `main` 上长期误导"就地修，否则登记。与真实 provider 的组合由评审在 `main`+#160+#161 上叠本 PR 实测，11 个场景没有任何假 Ready。

| 级别 | 意见 | 处置 |
|---|---|---|
| P1 | `Closes #183`：验收 2 要求真实临时仓库用例，本 PR 只有替身；验收 3 在 >100 分支时部分成立 | 改为 `Refs #183`（与 #161 `Closes #139` 的人类裁决同形），#183 保持开启；`Closes #184`、`Closes #165` 保留 |
| P2 | 没有 provider 的那条失败路径把已记录的 `branchExternalId` 抹成 `undefined`，重试回到 #183 的卡死（S8，已复现） | #183 剩余项 |
| P2 | `branchProbe` 只读第一页、controller 丢掉 `branchHeadCommit`（S10，已复现） | #183 剩余项 |
| P2 | 工作树步失败仍写 confirmed `has_worktree`，磁盘上 0 份（S3，`main` 上同样存在） | #192 |
| P2 | 第三步（启动执行）不可续（`main` 上同样存在，需设计） | #193 |
| P2 | 同 key 换请求返回假 `saved`（即下方遗留 §2） | #194 |
| P2 | `docs/README.md` 的 Active 表被整段改写：8 个 completed 计划从索引消失、两行重复 | 就地修：恢复 `main` 的表，只加本计划一行 |
| P3 | `chain-facts.ts` 骨架节点注释与实现相反；`tests/integration/README.md` 把"第一批将落地"改成"既有"；`tests/README.md` 集成层描述删掉了"本地 Git 操作"；"每个批次可独立 revert"不成立 | 就地修 |
| P3 | 退化工作项 id 被拒后仍留下 Failed 上下文；`Closed` 也可接管（替 #138 提前做了模型决定，无用例）；工作树路径没有被"决定"；旧 key 重放得到 `status=ready` 与 `writeState=failed` 的混合结果 | 记入下方遗留 |

**#183 的剩余项**（它保持开启的原因，逐条可验收）：① 真实临时仓库上的"基线前进后重试成功"用例（#160 合并后可写，评审的 S1 场景可直接复用）；② 被接管分支的头提交在 >100 分支时不丢、并出现在 controller 的视图里；③ 没有 provider 的那条失败路径保留已记录的分支。

**遗留**：

1. **与 #160 的断言冲突——谁后合并谁负责替换。** `tests/integration/development-local-git.test.js`（#160 的文件，`origin/main` 上没有）里有两条断言把本批次要修的缺陷写成了期望值：`assert.equal(hasWorktree.length, 2)` 与 `assert.equal(new Set(...).size, 2)`。在本 PR 的 head 上用同一场景求值，两条都红（actual 1 / expected 2）——**两个 PR 不能同时绿**。后合并的一方把那两条替换成关系层的「边数 = 1」并点名 D12 的身份定义。本 PR **不改 #160 的文件**。
   > **Superseded by**（2026-09-24，第一轮 MMP 评审）：本 PR 先合并（#160 本轮因两条 P1 未合并），替换由 #160 在变基到新 `main` 时完成；评审的并集实测确认改成 `=== 1` 后 554 / 554 全绿。
2. **幂等键没有绑定请求指纹。** 账本只按 `(workspaceId, idempotencyKey)` 查（`findMutationAttempt`），不校验工作项、仓库或任何其它参数，所以**同 key 换一个工作项会命中旧记录、返回那一次的 `saved` 报告，而什么都没有供应**——一次静默的假成功（已实测：上下文 1、分支 2、工作树 1，全部未变）。修法是让账本记请求指纹并在重放时比对，那是 write ledger 的跨层变更，**不在本批次**；代码注释已按实现真正做到的收窄（D4 的订正）。
   现已登记为 #194。
3. 写前意图窗口（死在 `git branch` 与回填之间）仍未关，见「接受的残留」§1。
4. `worktreeExternalId` 的句柄值在两条路径上仍可能不同，见「接受的残留」§2。
5. 真实临时仓库上的同一条链路归 #141。
6. 隔离 worktree 的依赖解析陷阱只有文档要求、**没有机械守卫**，已另开 issue（#186）。
7. **退化工作项 id 被拒后仍留下一条 `Failed` 执行上下文**，与 `docs/product/vertical-path.md` §2 第 6 步"不合法则不产生任何执行上下文"不符。收口条件：校验先于认领。
8. **`Closed` 也被当作可接管**，等于替 #138 提前做了"放弃之后能否再开始"的模型决定，且没有用例（变异"`Closed` 不可接管"仍全绿）。收口条件：由 #138 决定语义并补用例。
9. **工作树路径没有被"决定"**：崩在 `worktree add` 之后换一个路径重试会一直硬失败；记录的分支被人删掉后只有 `not_found`，没有恢复指引。
10. **旧 key 重放在重试成功之后**得到 `status=ready` 与 `writeState=failed` 并存的结果——账本记录与当前状态的关系与 #194 同源。
11. 工作树步失败仍写 confirmed `has_worktree`（#192）；第三步不可续（#193）。

## Bottom Change Note

- (2026-09-24) **对抗验证轮修复**：P1-A / P1-B 按根因修（序列身份、身份单一派生点），P2-1/P2-2 补判别性用例与回归防线，P2-3/P2-4/P3 订正计划与代码注释；新增 Decision Log D12、订正 D4/D7、Validation 扩到 17 行、新增「遗留」§1/§2。
- (2026-09-24) **独立验收与重构**：复核三个 issue 的全部验收标准与计划/README 数字；确认无 P0/P1。删除 `branchHeadCommitOf` 死重复辅助函数，复用 `branchProbe`，省 8 行；`branchHeadCommit` 仍由结果面与测试消费，`recordStep` 两次调用、`keepLease`、`Closed` 接管均保留并记录理由。
- (2026-09-24) Batch 2 / Batch 3 实现与证据回填（执行者 W-B）：验收表第 5–10 行、Progress、两条 Surprises、D8/D9。
- (2026-09-24) Batch 1–4 落地后回填 Outcomes、Progress、Decision Log D8–D11 与 Surprises；订正 Batch 3 步骤 1（不可执行）、记录 release-gates 不改的理由。
- (2026-09-24) 创建：批次 spec 与 plan。依据是 #183 / #184 / #165 三个 issue、PR #160 第二轮评审的四条 thread、以及对 git / Stripe / Terraform / Helm 的同类语义调研。
- (2026-09-24，Batch 1) 落地步骤级回填与重放跳过：`provisionGit` 增加可选 `recordStep` 钩子、分支步成功后立刻回填、重放时跳过已记录的分支步、`branchHeadCommit` 进入结果面、退化 slug 改为结构化拒绝。四条用例先红后绿，两次变异实验（去掉回填 / 去掉跳过）各自变红并逐字还原。同时修掉分步回填踩坏的在途保护（见 Surprises）。
- (2026-09-24，独立验收与重构) 核实 `branchHeadCommit`、`recordStep`、`keepLease` 与 `Closed` 均有实际语义，未删除；删除仅被复用逻辑覆盖的 `branchHeadCommitOf` 辅助函数，改用已有 `branchProbe`，省 8 行，TypeScript 与四个聚焦文件全绿。两条承重变异实验待主控补跑并回填证据。
- (2026-09-24，第一轮 MMP 评审) 状态行改为 Completed；验收表第 2、3 行、「可独立 revert」、Outcomes 的聚焦数字与遗留 §1 就地标注 `Superseded by`；新增「第一轮 MMP 评审」处置表与 #183 剩余项；遗留补 §7–§11；本计划移入 `completed/`。
