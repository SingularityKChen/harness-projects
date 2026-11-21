# worktree-clean-removal ExecPlan

> 状态：Completed（2026-11-21 独立验收通过并归档）
> 创建：2026-11-21
> 范围：issue #138 —— local Git Development provider 只在显式请求且工作树干净时移除工作树；脏树结构化拒绝且逐字节不变；允许根之外在任何 Git 命令之前拒绝。只到 provider 层，不接 core/controller/UI。
> 上游输入：issue #138（`kind:feat area:providers`）、`AGENTS.md` §7、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、`docs/exec-plan/completed/2026-09-24-local-git-worktree.md`、`docs/exec-plan/completed/2026-09-26-development-suite-capability-driven.md`、ADR-0007。

## Purpose / Big Picture

完成后，本地 Git Development provider 与共享 Development 契约之间有第一条**破坏性**能力闭环：显式调用
`removeWorktree` 时，只有「本 provider 绑定、允许根内、Git 登记在册、正面确认是本仓库的链接工作树、当前
工作树干净」的工作树会被真正移除；目录与登记一起消失，分支保留；脏工作树被独立检查拒绝，错误消息报告
未提交路径数，工作树内容逐字节不变；允许根之外的路径在发出任何 Git 命令之前被拒；没有任何自动清理、
批量清理、`--force` 或分支删除路径。

判断成功的最小证据：`packages/providers/development-local-git` 的能力快照出现
`development.worktree.remove`；`tests/integration/development-local-git.test.js` 的干净移除/脏拒绝/越界零调用
用例全绿；共享契约套件在 local-git 的 4 个能力形态上自动跑通「声明即真移除 → 对象新鲜 → 二次
`not_found`」；`node scripts/rule-checks.mjs size origin/main` 在预算内。

## Context and Orientation

**术语**

- **Development provider**：`packages/capabilities/src/development-provider.ts` 的 port；可选方法各自对应一个
  capability key，`removeWorktree?` 对应 `development.worktree.remove`。
- **local-git provider**：`packages/providers/development-local-git`，一实例一仓库；通过注入的 argv-only
  `GitRunner` 调用 Git；路径安全集中在 `src/paths.ts`（字符串拒绝 → realpath → 允许根符号链接 → 落根）。
- **工作树登记**：`git worktree list --porcelain -z` 的账本；Git 是「哪些工作树存在」的唯一权威。
- **干净（clean）**：本计划取 **Git 口径**——`git status --porcelain` 非空即脏（已暂存/修改/删除/重命名/未跟踪）；
  被忽略内容不算脏（见 Design / Spec 的 D2）。
- **显式请求**：调用方直接调用 `removeWorktree`。本计划不新增任何其它触发路径。

**当前状态（基于 `origin/main` @ `f74a3b8b`，复核时 `HEAD == origin/main`、工作树干净）**

- 契约面已存在：`development-provider.ts:83,123`（`ProviderRemoveWorktreeInput` / `removeWorktree?`）、
  `capability-keys.ts:42`（`DevelopmentWorktreeRemove`）、`packages/core/src/registry.ts:48`（可选成员表）。
- 共享契约套件已经写好移除语义：`tests/contract/suites/development.js:304-354` 在声明时要求真移除、对象集合
  变新鲜、第二次 `not_found`；未声明时要求结构化 `not_supported` 且零副作用。`:574-612` 要求外来 binding 冷拒。
- fake provider 已实现移除（`packages/providers/fake/src/development.ts:245-255`）并全绿。
- local-git 当前**不实现也不声明**：`src/provider.ts:1-4,101-116`；`tests/integration/development-local-git.test.js:312-322`
  断言 4 个 key 且 `provider.removeWorktree === undefined`；`tests/integration/README.md:98,104` 写「只声明三个键、
  不实现工作树移除」（已与代码不符的历史漂移）。
- e2e `tests/e2e/repository-routing.test.js:36-40` 把 local-git 型替身的 `worktreeRemove` 设为 `false`，并在
  `:97-104` 逐字比较「替身键集合 == 真实 local-git 快照键集合」。声明新键后必须同步改这一处，否则 e2e 必红。
- 无其它移除调用路径：`git grep removeWorktree` 只命中 fake、共享套件/契约测试、capabilities/registry 与文档；
  `packages/core/src/git-provisioning.ts:21` 的门表与 `packages/core/src/development-route.ts:41` 的 reports 都不含
  该 key，因此新增声明不会改变工作区元数据/UI 的「开始工作四键 + 变更请求读」报告。

**上游依据**

- issue #138 的三条验收与 out of scope（分支删除、自动清理）是本文的唯一验收边界。
- ADR-0007 决定 1：确定性拒绝一律 `invalid_input`；`conflict` 只表示「请求状态已成立且可安全复用」；
  `ambiguous_result` 只表示结果真的不确定。决定 2：报成功前必须观测。
- #137 的历史裁决（`docs/exec-plan/completed/2026-09-24-local-git-worktree.md:790-800`）把移除移出本层，并把
  「safe/discard 分层」许诺给 #138；本 issue 的 AC 并不包含该分层，故本计划只交付「仅显式、仅干净（Git 口径）」，
  并在原处加 Superseded 注记（见 D9）。
- #211（Ready 上下文仍持旧句柄）与 #212（createWorktree 的 conflict 语义）不在本 PR 范围。

**相关文件**

`packages/providers/development-local-git/src/{provider.ts,paths.ts,git-runner.ts,index.ts}`、
`tests/integration/{development-local-git.test.js,local-git-fixture.js}`、`tests/contract/suites/development.js`、
`tests/contract/development-contract.test.js`、`tests/e2e/repository-routing.test.js`、`tests/integration/README.md`。

## Design / Spec

### 最终方案（只改 local-git provider）

`LocalGitCapabilityFlags` 增加 `worktreeRemove?: boolean`（默认 `true`，与 `branchCreate` / `worktreeCreate` /
`worktreeRead` 同形）；构造函数与 `describeCapabilities` 按 flag 声明 `development.worktree.remove`；新增
`removeWorktree`，判定链顺序固定（前 3 步不发起 Git 写）：

1. **能力门**：`if (!this.flags.worktreeRemove) return this.notSupported(DevelopmentWorktreeRemove)`。
   能力先于身份（port 义务 1）：关闭 + 外来 ref 必须答 `not_supported`。
2. **身份门**：`ref.bindingId !== this.bindingId || ref.objectKind !== 'worktree'` → `not_found('工作树')`。
3. **路径门（纯 fs，AC3）**：`resolveTarget(ref.externalId)`。只用文件系统判定：字符串/首尾空白/控制字符/
   `..` 分量/悬空链接/允许根在检出内是符号链接/规范化后逃出允许根 → `invalid_input`，**零 Git 调用**。
   与 `getWorktree` 一样不另调 `repositoryError()`：`resolveTarget` 已覆盖仓库路径与允许根问题。
4. **登记门**：`listWorktrees()`；读失败原样传播。`Promise.all(records.map(samePath))` 找目标；
   无记录 → `not_found('工作树')`。
5. **可移除形状门**：`record.prunable` 或 `!(await occupied(target))` → `not_found`，消息点名
   「请先执行 `git worktree prune`」。**不替人 prune**：实测 Git 对 prunable 登记执行 `worktree remove` 会
   exit 0 并静默清登记，不能把它冒充成「真的删除了工作树」。
6. **正面身份确认**：`record.branch === undefined`（detached 等）→ `invalid_input`；否则把现有
   `reuseBlockedBy(target, branch)` 更名为 `worktreeIdentityProblem(target, branch)` 并原位复用（`createWorktree`
   调用点同步改名，行为不变）：确认目标可读、`--git-common-dir` 等于本仓库、`--git-dir` 不等于 common（不是
   主检出）、`HEAD` 等于登记分支。任一失败 → `invalid_input`，消息点名原因。这里**不以登记账本代替身份**：
   AC2 要求 provider 删除的是本仓库的链接工作树，不是「登记里恰好有这样一条记录」。
7. **干净门**：`runGit(['-C', target, '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'])`。
   - 读失败/被中断 → `failureOf(read)`（`unavailable`），fail closed，绝不移除；
   - `stdout.split('\0').filter(Boolean).length = N > 0` → `invalid_input`，message：
     `工作树有 N 个未提交路径，拒绝移除：<path>；请先提交、stash 或清理后重试`；
   - `--untracked-files=normal` 是承重 flag：仓库配置 `status.showUntrackedFiles=no` 会让未跟踪文件从
     `--porcelain` 消失（实测），显式参数覆盖它；未跟踪目录折叠为 1 条记录，计数口径是「porcelain 记录数」；
   - `--no-optional-locks` 让只读判定不抢 index 锁，拒绝路径不产生 Git 写；
   - 不加 `--ignored`：被忽略内容不算未提交路径（D2）。
8. **删除**：`this.git(['worktree', 'remove', target])`（即 `['-C', repository.path, 'worktree', 'remove', target]`）。
   **永不传 `--force` / `-f`，不 prune，不删分支，不写 `.gitignore` / `info/exclude`。**
9. **写失败映射**：在 `REFUSALS` 末尾加一条（全部是本方法的确定性拒绝）：
   `/contains modified or untracked files|working trees containing submodules|cannot remove a locked working tree|is a main working tree|validation failed, cannot remove working tree/i`
   → `invalid_input`，消息 `Git 拒绝移除工作树`；其后的 detail 行保留 Git 的 fatal 原因。其余写失败仍走
   `failureOf(write)` → `ambiguous_result`（可能已部分删除，诚实标不确定）。
10. **写后回读**：再 `listWorktrees()`；读失败、目标仍在登记或目录仍存在 → `ambiguous_result`
    （`工作树移除结果不确定：…；请先 reconcile`），绝不报 `ok`；否则 `providerOk(undefined)`。

**状态拥有者**：工作树登记与脏状态都以 Git/磁盘为唯一权威，provider 不缓存、不落库、不写 storage。
**命名与边界**：只更名一个私有探针；不改 `packages/capabilities` 的接口形状、不改 capability key、不改
`ProviderError` 形状、不加依赖、不加兼容层。`packages/capabilities/src/development-provider.ts` 的
`removeWorktree` 成员补 5 行 JSDoc，写明「仅显式、脏则 `invalid_input` 并报路径数、不 force、不删分支、
真实文件系统实现由 local-git 集成测试钉住」。

### 失败路径（码 / retryable / 副作用）

| 情形 | code | 副作用 |
|---|---|---|
| 能力未声明 | `not_supported` | 无（零 Git 调用，且先于身份） |
| 外来 binding / 非 worktree kind | `not_found` | 无 |
| 空/控制字符/`..`/首尾空白/允许根符号链接/出根 | `invalid_input` | 无（零 Git 调用，AC3） |
| 未登记 / 目标=主检出 / 登记路径被换成独立仓库 / detached | `invalid_input` 或 `not_found`（未登记用 `not_found`） | 无写型 Git argv |
| 登记在册但目录不存在（prunable） | `not_found` | 无；消息给人工 `prune` 出路 |
| 脏树（修改/未跟踪/已暂存/冲突） | `invalid_input` + 路径数 | 无；工作树逐字节不变 |
| `status` 读失败/中断 | `unavailable` | 无（fail closed） |
| locked / submodule / 检查后变脏 / 被换目录 | `invalid_input`（REFUSALS） | 无 |
| 写进程被中断 / 未映射写失败 | `ambiguous_result` | 可能部分删除，要求 reconcile |
| 写后回读不一致 | `ambiguous_result` | 不报 ok |

`invalid_input` 的 `retryable=false`、recovery=`none`（ADR-0007）；可行动性由 message 承担。

### 可观察行为

| 触发 | 结果 |
|---|---|
| 干净工作树 + 显式请求 | 目录与登记消失、分支保留、二次调用 `not_found`；能力快照声明该 key |
| 脏工作树 | `invalid_input`、消息含 N 个未提交路径与出路、内容逐字节不变；用户提交/stash 后重新显式请求 |
| 只有被忽略内容 | 视为干净，移除成功且 ignored 内容随目录删除（D2，已知数据损失面） |
| 主检出 / 外来工作树 / prunable / detached / 锁定 | 结构化拒绝，不触碰磁盘；prunable 与 locked 给人工出路 |
| 能力关闭 | 快照无该 key；调用 `not_supported`（不是静默成功） |

本 PR 不产生 UI 按钮、core 命令或自动清理；已 Ready 的执行上下文不会因移除被改判（#211）。

### 被否决的方案

- **ignored 算脏 + safe/discard 分层（另一份设计提案）**：与 issue 的 `uncommitted` 用词和 AC2「clean 可移除」冲突；
  真实工作树几乎都含 `node_modules`，会变成不可移除的能力，且需要 issue 未授权的 override/discard 输入。
  数据损失面改为文档化 + 后续 issue（D2/D10）。
- **扩 `ProviderError.details` 或给本方法引入 `rawClass`**：计数已在结构化结果（`ok:false` + `invalid_input`）
  的 message 里；`rawClass` 在 local-git 无先例、无消费者，扩错误模型是跨层变更（D4/D10）。
- **core 命令 + controller/client/UI**：无消费者，需产品决策（入口、二次确认、Ready 失效），超出 issue area
  与预算，且 #211/#212 尚未收口（D1）。
- **把 dirty 场景放进共享契约套件或 fake**：dirty 是文件系统/Git 概念；fake 无文件系统，套件也只建模能力
  声明。共享套件已覆盖声明与 clean round-trip，新增判别力只能来自真实 Git 集成测试（D10）。
- **只解析 Git 的 remove 拒绝文案**：无法报告路径数；文案随版本漂移；ignored-only 时 Git 会静默成功，
  违背 AC1 的意图。
- **先 `--force` 再自检 / 替人 `prune` / 跨包源扫描禁止未来接线**：分别丢掉 Git 防线、扩大删除面、把一次
  正当的未来 core 接线判红；AC2 的 grep 证据写进本计划即可。

### 不变量

I1 `removeWorktree` 是 local-git 唯一删除工作树目录的入口；永不 `--force`、永不删分支。
I2 任何拒绝零副作用：工作树内容逐字节不变、登记不变、分支头不变、无写型 Git argv。
I3 顺序固定：能力 → 身份 → 路径（零 Git）→ 登记 → 正面身份 → 干净 → 删除 → 回读。
I4 报 `ok` 前必须观测：回读登记与目录；观测不到即 `ambiguous_result`。
I5 只由显式调用触发；本 PR 不接自动/批量/命令/UI 路径。
I6 被忽略内容随显式移除删除，是已接受语义，写进 port JSDoc、ExecPlan 与 PR 描述。
I7 不改 core/controller/client/ui-model/ui/apps、不改共享契约套件与 fake、不加依赖/兼容层。

### 测试策略（判别性，细节见 Validation and Acceptance）

先写红再实现：改写过时的「4 键 + 不实现移除」边界为「5 键 + 实现」；新增 10 个用例覆盖 AC1（脏拒绝 +
`snapshotTree` 逐字节比较）、AC2（干净往返 + 分支保留 + 二次 `not_found` + 其它方法不移除）、AC3（越界零
Git 调用），以及能力先于身份、身份正面确认、prunable、detached、locked/REFUSALS 映射、写后回读、argv 形状。
每个用例至少能因一个具体变异而红（变异表见 Validation）；不新增测试框架、不改共享套件、不删既有断言。

## Global Constraints

- **文件集（唯一声明）**：`packages/providers/development-local-git/src/provider.ts`、`.../src/index.ts`、
  `packages/capabilities/src/development-provider.ts`、`tests/integration/development-local-git.test.js`、
  `tests/e2e/repository-routing.test.js`、`tests/integration/README.md`、`docs/README.md`、
  `docs/exec-plan/completed/2026-09-24-local-git-worktree.md`、
  `docs/exec-plan/completed/2026-09-26-development-suite-capability-driven.md`，以及本计划自身
  `docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md`。不再改其它 tracked 文件。
- **规模**：技术新增+删除 ≤ 800 行（用户上限；forecast 500；本计划估算 350–420），文档 ≤ 1300 行。
  `rule-checks size origin/main` 是唯一判定。
- **不削弱守卫**：不改 `tests/contract/suites/development.js`、不改 fake、不改坏 adapter 矩阵；只把已过时的
  事实断言就地改写为真实实现（312–322）。
- **破坏性边界**：无 `--force`/`-f`、无 `prune` 自动执行、无 `branch -d/-D`、不改 `.gitignore`/`info/exclude`；
  不写 storage，不碰 Host 状态。
- **Git 边界**：只经 `GitRunner` 的 argv 数组；不拼 shell（`tests/contract/development-local-git-source.test.js`
  已守卫）。使用 `--no-optional-locks`（Git 2.15+；本仓 CI 观测 git 2.50/2.56，本机复核 2.56.1，不新增版本门）。
- **文档**：正文中文、标识符/命令英文；不写本机绝对路径；本计划随 PR 提交，验收通过后原样移入
  `docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md` 并更新 `docs/README.md` 索引（已归档，见 Progress）。
- **分支与工作树**：`feature/worktree-clean-removal`，在仓库内 `.worktrees/worktree-clean-removal/` 执行；
  base 用 `origin/main`（复核时 `f74a3b8b`，执行前用 `git rev-parse origin/main` 回读）。
- **提交**：`<type>(<scope>): <中文摘要>`，正文说明为什么，`Closes #138`；一个 PR 独立验收/合并/回滚。
- **验证命令唯一来源**：全部命令只在 `Validation and Acceptance` 的 V1–V8 定义；各批次只引用编号，不复制命令。

## Plan of Work

每批按 `AGENTS.md` §4 的 对齐 → 隔离 → 实现 → 验证 → 记录 → 提交 → 汇报 执行；批次之间不重复询问，只有缺凭据、需求歧义或外部系统阻塞才暂停。

### Batch 1 · 能力声明与干净移除往返

**最小闭环**：local-git 声明 `development.worktree.remove` 并在显式请求下真正移除一份干净工作树；共享契约
套件在 4 个 local-git 能力形态上跑通移除往返。
**涉及文件**：`packages/providers/development-local-git/src/provider.ts`、`.../src/index.ts`、
`tests/integration/development-local-git.test.js`、`tests/e2e/repository-routing.test.js`。

步骤：
1. 先写红：把 312–322 的断言改写为 `能力子集：声明五个键（含工作树移除），移除是可选能力`（恰好 5 键 +
   `typeof provider.removeWorktree === 'function'`）；新增
   `工作树移除：干净工作树仅显式移除，目录与登记消失、分支保留，二次移除答 not_found`（argv 恰为
   `['-C',repo,'worktree','remove',target]` 且无 force）；把 `tests/e2e/repository-routing.test.js` 的 local-git
   `worktreeRemove` 改 `true` 并改注释。观察红线：能力子集断言失败（4≠5）、`removeWorktree is not a function`、
   e2e 键集合不相等。
2. 实现 flag、构造函数默认值、`describeCapabilities` 条件 key、包/方法头注释，以及判定链 1–5、8–10 的最小骨架
   （能力/身份/路径/登记/prunable/删除/回读；暂不含第 6 步正面身份与第 7 步 dirty）。
3. 观察转绿：V2 + V4；同时手跑一次共享套件路径（V2 已包含；套件会在 4 个形态上真实移除）。
**验证**：V2、V4（期望 `ℹ fail 0`）。
**回滚**：`git revert <Batch 1 提交>`。回滚后 provider 回到「不声明、不实现」，312–322 的旧断言与 e2e flag
同步恢复；无持久状态需要清理。

### Batch 2 · 安全拒绝（路径 / 身份 / 脏 / 能力关闭）

**最小闭环**：脏工作树被拒且逐字节不变并报告路径数；越界零 Git 调用；主检出/外来目录/detached/prunable/
能力关闭全部结构化拒绝且无副作用。
**涉及文件**：`packages/providers/development-local-git/src/provider.ts`、`tests/integration/development-local-git.test.js`。

步骤：
1. 先写红：新增 `snapshotTree` helper（递归 `lstat` + 相对路径/类型/mode/内容 sha256/链接目标，排序后比较）与
   六个用例：`工作树移除：脏工作树被拒且逐字节不变，错误报告未提交路径数`（3 条未提交路径 + ignored `.env` +
   `git config status.showUntrackedFiles no`，message 含 `3`）、
   `工作树移除：Git 口径下只有被忽略内容的工作树视为干净，显式移除会删除被忽略内容`、
   `工作树移除：越界、含 .. 与符号链接逃逸都在任何 Git 命令之前被拒（零次调用）`、
   `工作树移除：未登记、主检出、被换成独立仓库与 detached 都不是可移除对象，且不发出 remove argv`、
   `工作树移除：登记在册但目录已删（prunable）答 not_found 并给出 prune 出路，不静默清理登记`、
   `工作树移除：能力关闭时快照不出现该键、调用 not_supported 且零次 Git 调用`。观察红线：脏树会被真的删掉、
   越界目标仍会走登记/删除、能力关闭仍按身份答 `not_found`。
2. 实现第 6 步（`reuseBlockedBy` 更名 `worktreeIdentityProblem` 并复用；detached 拒绝）、第 7 步 dirty 门与计数、
   `REFUSALS` 新增一条确定性拒绝映射。
**验证**：V2、V3（期望 `ℹ fail 0`）。
**回滚**：revert 本批；Batch 1 的干净路径仍在，只是缺少安全拒绝（仅作为批次回退点，不单独合并）。

### Batch 3 · 诚实写路径、守卫与文档

**最小闭环**：写后回读把「没删成的成功」判成 `ambiguous_result`；其它既有方法不产生移除；文档与事实源同步，
全部门禁通过。
**涉及文件**：`tests/integration/development-local-git.test.js`、`packages/capabilities/src/development-provider.ts`、
`tests/integration/README.md`、`docs/README.md`、`docs/exec-plan/completed/2026-09-24-local-git-worktree.md`、
`docs/exec-plan/completed/2026-09-26-development-suite-capability-driven.md`、本计划。

步骤：
1. 先写红：新增三个用例——
   `工作树移除：写命令返回成功但回读不一致时答 ambiguous_result，不把未完成删除报成成功`（注入 remove 返回 0
   但不真删 / 移除后 list 失败）、`工作树移除：locked、检查后变脏、submodule、主检出与换目录的 Git 侧拒绝都答
   invalid_input`（真实 locked + 注入 dirty-race/submodule/main/validation 文案）、
   `工作树移除：创建、读取、预检与分支方法都不会移除工作树（AC2 的唯一入口）`；观察红线：回读缺失时假成功、
   确定性拒绝落成 `ambiguous_result`。
2. 实现第 9 步映射补全、第 10 步回读的全部失败分支；补 port JSDoc。
3. 文档：`tests/integration/README.md` 更新 5/13/98/104 的漂移（能力子集、移除能力、脏拒绝证据）；
   `docs/README.md` Active 索引加本计划一行；`2026-09-24-local-git-worktree.md` 与
   `2026-09-26-development-suite-capability-driven.md` 在原处各加一行 Superseded 注记（safe/discard 分层未随 #138
   交付，留给后续 issue）。`docs/product/vertical-path.md` 的 #138 缺口行只读、不改（provider 层证据不等于
   产品入口），在 PR 描述写明。
**验证**：V1–V8（期望见各条）。
**回滚**：revert 本批或整 PR。整 PR 不写 storage/Host 事实，revert 后无数据残留；已移除的测试临时工作树只是
mkdtemp 夹具，由用例清理。

## Validation and Acceptance

以下命令是**唯一来源**；执行上下文统一为「检出 `feature/worktree-clean-removal` 的工作树根目录」，base 用
`origin/main`（执行前 `git rev-parse origin/main` 回读，不把易失 SHA 写死）。

- **V1 类型**：`pnpm run typecheck`。期望：exit 0，无输出错误。
- **V2 判别性集成**：`pnpm test:file tests/integration/development-local-git.test.js`。期望：`ℹ fail 0`，
  `ℹ pass` 等于本文件当前用例数（基线 79 + 新增 10；改写的 1 条不计入新增，执行时回读）。
- **V3 契约/替身/坏 adapter**：`pnpm test:file tests/contract/development-contract.test.js`。期望：`ℹ fail 0`
  （共享套件与坏 adapter 子进程矩阵未被削弱；本 PR 不改该文件）。
- **V4 e2e 键集合**：`pnpm test:file tests/e2e/repository-routing.test.js`。期望：`ℹ fail 0`（含
  「AC2 声明一致：… key 集合等于真实 Provider」）。
- **V5 依赖边**：`pnpm run boundaries`。期望：`ℹ fail 0`（基线 `ℹ pass 10`）。
- **V6 体量与发布面**：`node scripts/rule-checks.mjs size origin/main`、`node scripts/rule-checks.mjs disclosure origin/main`、
  `git diff --check origin/main...HEAD`。期望：代码 ≤ 800、文档 ≤ 1300；disclosure「机械扫描通过」；diff-check 无输出。
- **V7 结构证据**：
  `git grep -nE "\.removeWorktree\s*\(" -- packages/core packages/controller packages/client packages/ui-model packages/ui apps`。
  期望：无输出（exit 1），即没有别的**调用点**（`packages/core/src/registry.ts` 的可选成员字符串清单不算调用）；
  对照 `git grep -n "'worktree', 'remove'" -- packages/providers/development-local-git/src` 期望恰好 1 处，在
  `provider.ts` 的 `removeWorktree` 内。
- **V8 全量门禁**：`pnpm verify`。期望：exit 0（若出现与本 PR 无关的已知环境性失败，必须按 `docs/review/README.md`
  §2 记录为未验证项，并以最终 head 的 `PR Fast Gate` 为准）。

**验收映射**

| AC | 证据 |
|---|---|
| AC1 脏树拒绝且逐字节不变 | V2 的「脏拒绝」：`snapshotTree` 前后 `deepEqual` + 登记/分支头不变 + message 含 `3`；变异 M1/M2/M9 均红 |
| AC2 干净工作树仅显式移除、无其它调用路径 | V2 的干净往返（真删除、分支保留、二次 `not_found`）+ 其它方法不移除；V3 的套件声明往返；V7 的 grep 证据 |
| AC3 越界在任何 Git 命令之前拒绝 | V2 的越界用例 `recorder.calls === []`；共用 `paths.ts` 的零 Git 判定顺序；变异 M4 红 |

**变异表（复核测试有牙；实施后逐条手工注入并还原）**

| 变异 | 应红 |
|---|---|
| M1 删 dirty 门 | 「脏拒绝」 |
| M2 status 去掉 `--untracked-files=normal`（并令 fixture 设置 `showUntrackedFiles=no`） | 「脏拒绝」的计数 3 |
| M3 status 加 `--ignored` 或把 ignored 计入 | 「ignored-only」 |
| M4 把 `resolveTarget` 挪到 `listWorktrees` 之后 | 「越界零调用」 |
| M5 删第 6 步正面身份确认 | 「主检出/独立仓库/detached」的「无 `remove` argv」断言 |
| M6 删第 10 步回读 | 「写后回读」 |
| M7 把脏拒绝改 `conflict` 或 `ambiguous_result` | 「脏拒绝」的码断言 |
| M8 移除后顺手 `branch -D` | 「干净移除」的分支保留 |
| M9 计数写死或不写数字 | 「脏拒绝」的 message 断言 |
| M10 给 remove argv 加 `--force` | 「干净移除」的 argv 断言 |
| M11 能力 gate 移到身份 gate 之后 | 「能力关闭 + 外来 ref」 |
| M12 把 prunable 交给 Git remove（静默清登记） | 「prunable」 |

**未验证项（须在 PR 描述写明）**：Windows 原生未运行本组新用例（`development-local-git-windows.test.js` 只覆盖
路径准入）；Git 版本行为以本机 2.56.1 实测与 CI 的 2.50/2.56 为准；没有产品入口/UI 可观察面，本 PR 只交付
provider 契约与能力快照。

## Progress

- [x] 2026-11-21 计划创建与事实核验：复核两份设计提案，实测 Git 行为，锁定最终方案与拒绝项（证据见 Surprises & Discoveries）。
- [x] 2026-11-21 Batch 1 · 能力声明与干净移除往返（`5042e1a1`，TDD：V2 红线 4≠5 键 + `removeWorktree is not a function`、V4 键集合不等 → V2 80/80、V4 21/21）。
- [x] 2026-11-21 Batch 2 · 安全拒绝（路径/身份/脏/能力关闭）（`11138076`，TDD：脏树被 Git 拒成 `ambiguous_result`、主检出/detached 身份未判 → V2 86/86）。
- [x] 2026-11-21 Batch 3 · 诚实写路径、守卫与文档（`d3e785bf`，TDD：假成功被报 ok、locked 落成 `ambiguous_result` → V2 89/89）。
- [x] 2026-11-21 最终门禁 V1–V8 独立复跑与 AC1–AC3 判定（实现 head `d3e785bf`、文档 head `c13476fe` 上复跑；`pnpm verify` exit 0；读数见 Outcomes & Retrospective）。
- [x] 2026-11-21 归档与文档收尾：计划移入 `completed/`（文件名不变）、`docs/README.md` 索引从 Active 移到 Completed、两份历史计划的 Superseded 链接改指 `completed/`、ADR-0007 符号引用更名、port JSDoc 计数口径、`:607` 补 `createBranch` 返回值断言、Outcomes 回填最终读数与 P2 剩余风险。PR #671 描述占位（验证报告 P1）按任务约束留给 Lead。

## Surprises & Discoveries

创建阶段（2026-11-21）已实测/已读代码得到、且改变设计的发现：

1. **两份独立设计都漏了 e2e 的键集合比较。** `tests/e2e/repository-routing.test.js:36-40` 的
   `FLAGS['local-git'].worktreeRemove=false` 与 `:97-104` 的逐字比较意味着：只要真实 local-git 声明第 5 个键，
   该文件必红。执行前必须同步 flag；这是事实同步，不是削弱断言。
2. **ignored-only 的工作树会被 Git 静默删除。** 临时仓库实测：只有 `.env`/`node_modules/` 时
   `git status --porcelain` 为空，`git worktree remove` exit 0，内容随目录消失。这决定了 D2：Git 口径下它是
   clean，必须在 port JSDoc/PR 描述明写数据损失面，而不是假装它安全。
3. **prunable 登记执行 remove 会 exit 0。** 目录已删、登记仍带 `prunable` 时，`git worktree remove` exit 0 并
   只清登记。若照搬 Git 行为，provider 会把「只清了登记」报成成功删除；故第 5 步直接 `not_found` + 人工
   `prune` 出路。
4. **登记路径被换成独立仓库时 Git 会拒，但错误会落成 `ambiguous_result`。** 实测 exit 128
   `validation failed, cannot remove working tree: '<path>/.git' is not a .git file`。Git 自身不误删，但确定性拒绝
   若未映射会变成「结果不确定」；第 6 步正面确认 + REFUSALS 映射同时解决可行动性与诚实性。
5. **`status.showUntrackedFiles=no` 会隐藏未跟踪文件。** 实测默认 `status --porcelain` 为空、显式
   `--untracked-files=normal` 才看到 `?? u.txt`。脏检查必须显式带该 flag，测试用仓库配置制造这一负控。
6. **rename 计数与 `--no-renames` 无关。** 实测 `-z` 下 rename 占 2 条记录（`R  new\0old\0`），加不加
   `--no-renames` 都是 2 条路径；因此删掉该 flag，减少一个配置/版本面（订正另一份提案中的该说法）。
7. **detached 工作树在 `worktree list --porcelain` 是 `detached` 字段、无 `branch` 行。** provider 只创建分支附着
   工作树；detached 可能承载未被引用的提交，移除会丢可达性，故第 6 步拒绝。
8. **共享套件在 `worktreeCreate:false` 形态下会移除夹具预置的 `wt-prepared`，但后续用例不依赖它**
   （`suites/development.js:356-376` 该形态预检未声明即返回）；每个能力形态又有独立 `mkdtemp` 夹具，不会互相污染。
9. **历史计划把 safe/discard 分层许诺给 #138。** `2026-09-24-local-git-worktree.md:796` 与
   `2026-09-26-development-suite-capability-driven.md:190` 的措辞超出本 issue 的 AC；按 `PLANS.md` §4 在原处
   加 Superseded 注记，而不是让历史结论与本 PR 相反。
10. **实现期：未映射的确定性拒绝会先落成 `ambiguous_result`。** 实现 dirty 门与 REFUSALS 映射之前，真实脏工作树的
    `git worktree remove` 失败被写命令兜底报成 `ambiguous_result`（Batch 2 红线实测），而不是「成功删除」——这既
    验证了 dirty 门的必要性，也说明「确定性拒绝必须有显式映射」不是理论担忧；locked 的 Git 文案是两行
    （`fatal: cannot remove a locked working tree;` + `use 'remove -f -f' to override or unlock first`）。
11. **实现期：unborn 独立仓库会被身份探针读成「不可读」。** 「登记路径被换成独立仓库」的测试若只 `git init` 而
    不提交，`rev-parse --symbolic-full-name HEAD` 会失败，探针答「目录不是可读的 Git 工作树」而走不到
    「不是本仓库的工作树」这一支；测试改为让替换仓库先有一个提交，才真正钉住身份比较。
12. **实现期：环境负载会让子进程矩阵与 spawnSync 期限用例假红。** 并行实现者同时跑全量门禁时，本机 load
    average 长期在 100+（观测 364），`development-contract.test.js` 的坏 adapter 子进程矩阵会撞 120s 单测期限、
    `路径安全：长分隔符…` 的 5s `spawnSync` 期限也会偶发超时。二者与 #138 改动无关，单独重跑或以更长
    `--test-timeout` 复验即可；归档复核在 load < 10 时复跑全绿（见 Outcomes），坐实这一判定。
13. **core 的元数据不报告移除键。** `development-route.ts:41` 的 reports 固定为开始工作四键，
    `git-provisioning.ts:21` 的门表也不含移除；因此声明新键不会改变 e2e AC5 的「4+1」报告面，也不会改 UI 可用性。
14. **归档复核：spec 的 dirty 用例组成与 shipped 测试不同（2026-11-21 独立验收时记录）。** 最终 spec §6
    写的是「改 tracked + 未跟踪文件 + 未跟踪目录含 2 文件」，shipped 用例实际为「改 tracked + `git add` 的
    staged 新文件 + 未跟踪单文件」= 3 条 porcelain 记录。差异原因：staged-only（`A `）是与修改、未跟踪都不同
    的 porcelain 类，与 `status.showUntrackedFiles=no` 负控组合后仍能钉住「3 条记录」与「按记录计数」；未跟踪
    目录折叠为 1 条的 Git 行为只由独立攻击复现（验证报告 §3），shipped 用例不钉这一条。计数口径因此补进 port
    JSDoc（D16），不在归档时改测试组成。
15. **归档复核：ADR-0007 的两处符号引用已随更名失效。** ADR 的 `Rejected` 与 `Consequences` 仍写
    `reuseBlockedBy`；本次更名不改语义、决策没有被推翻，按 `docs/adr/README.md` 的规则不需要
    `Superseded by ADR`，只把引用改为 `worktreeIdentityProblem` 并注明 2026-11-21 更名（D17）。
16. **归档复核：`removeWorktree` 接受相对 `externalId` 不是越权通道（探针实测）。** 默认拓扑下相对名
    `wt-a` 解析为 `<repo>/wt-a` → `not_found`、零 `remove` argv，兄弟工作树不动；相对 `../wt-a` →
    `invalid_input`、零调用；把允许根合法注入到检出内时，相对名能命中该根内登记并真的删除，但 `remove` argv
    收到的是**规范化绝对路径**，路径门/登记门/正面身份门/干净门全部照常。裁决见 D18：接受，不为 remove 单独
    要求绝对路径。

## Decision Log

- **D1 只做 provider 纵向闭环**（2026-11-21 / 独立 spec 评审）：issue area 是 `providers`，三条 AC 都能在
  provider 层判定；core/controller/UI 没有消费者，接命令需要产品决策（#211/#212），并会超预算。Rationale：
  最小可独立验收/合并/回滚的闭环。
- **D2 clean = Git 口径；ignored 不算脏**（同上）：issue 用词是 `uncommitted`，AC2 要求 clean 工作树可移除；
  把 ignored 计入会让真实工作树不可移除且需要未授权的 discard/override 输入。后果（ignored 内容随显式移除
  删除）写入 port JSDoc、本计划与 PR 描述；人体裁决点 1。
- **D3 脏树/确定性拒绝用 `invalid_input`**（同上）：ADR-0007 决定 1；`conflict` 与 `ambiguous_result` 有系统级含义，
  不得挪用。计数放 message；不扩 `ProviderError`（人体裁决点 2/3）。
- **D4 prunable 用 `not_found` + `prune` 出路**（同上）：Git 对 prunable 的 remove 会静默清登记（实测），
  不能冒充真删除；provider 不替人清理登记。
- **D5 复用并更名 `reuseBlockedBy` → `worktreeIdentityProblem`**（同上）：create 路径已有正面确认（本仓库 common-dir、
  非主检出、HEAD 分支一致），移除比复用更具破坏性，必须复用同一条身份判据，避免第二份判定漂移；更名让调用
  语义与 `reuse` 解耦，行为不变。
- **D6 detached 工作树拒绝**（同上）：provider 不创建 detached；移除 detached 可能让未被引用的提交失去可达性，
  「拒绝并让用户人工处理」比「猜测安全」诚实。
- **D7 不加跨包源扫描**（同上）：AC2 用「干净往返 + 其它方法不移除」行为用例 + `git grep` 证据固定；跨包零调用
  守卫会在未来正当接线时误红。包内不变量由 argv 断言覆盖。
- **D8 同步 e2e 替身 flag**（同上）：`tests/e2e/repository-routing.test.js` 的键集合比较是事实同步，不是削弱；
  不同步则 V4 必红（已实测当前真实/替身各 4 键相等）。
- **D9 历史计划就地注记**（同上）：`PLANS.md` §4 要求被推翻的结论在原处标 Superseded；本 PR 只加一行说明
  safe/discard 分层未随 #138 交付，不静默改旧记录。
- **D10 不做 ignored 双计数/rawClass/details/契约套件扩面**（同上）：无 issue 授权、无消费者或能力上不可由 fake
  证明；保留给后续 issue。
- **D11 保留 `--no-optional-locks`、去掉 `--no-renames`**（同上）：前者让拒绝路径不抢 index 锁；后者对计数无
  影响（实测），少一个选项面。
- **D12 体量控制**（同上）：预估技术 350–420、文档 440–490；若逼近 500/800 线，按「detached → 注入
  main/validation 子例 → port JSDoc」的顺序收缩，不省 AC1/2/3 与防 force/删分支证据。
- **D13 人类伙伴批准的 5 项裁决（2026-11-21 / Lead 转达，实施期直接执行）**：Q1 ignored 不算脏（Git 口径
  `status --porcelain` 为空即干净），显式移除会连带 ignored 内容，作为已文档化的数据损失面；不做 safe/discard
  分层、不加 `--force`。Q2 未提交计数只放 error message，不扩 `ProviderError.details`/`rawClass`。Q3 确定性
  拒绝一律 `invalid_input` + `retryable:false`。Q4 prunable 登记返回 `not_found` 并给 `git worktree prune`
  出路；detached 拒绝为 `invalid_input`。Q5 不接 core/controller/UI 入口、不处理 #211 旧句柄，PR 描述明示
  仅 provider 层能力。Rationale：与 D1–D10、ADR-0007 一致，且不扩大 issue 验收范围。
- **D14 TDD 顺序微调（实施期）**：计划 Batch 1 步骤 2 原含判定链 9（REFUSALS 映射）与 10（写后回读）的
  「最小骨架」，但这两步唯一的判别性测试在 Batch 3；若 Batch 1 先实现，Batch 3 的 RED 会预先为绿（测的是
  已有行为）。实际拆为：Batch 1 = 步骤 1–5、8；Batch 3 = 步骤 9–10。每批因此都满足「先写能红的判别性
  测试，再实现转绿」；批次回滚点与验证编号不变。
- **D15 计数口径回读（实施期）**：重写的「能力子集」用例不计新增；V2 的 `pass` 由基线 79 → Batch 1 80 →
  Batch 2 86 → Batch 3 89（= 79 + 新增 10），与 V2 的期望一致。e2e 的 `FLAGS` 同步写进 Batch 1 的 RED 证据
  （不同步则 V4 的键集合比较必红），属 D8 的事实同步。
- **D16 计数口径写进 port JSDoc（2026-11-21 / 独立验收归档）**：只加一句注释说明「路径数是
  `status --porcelain -z` 的记录数（rename 计 2、未跟踪目录计 1）」，不改契约语义。Rationale：message 的
  「N 个未提交路径」容易被读成文件数；扩 `ProviderError.details` / `rawClass` 仍在 D4/D10 的否决范围。
- **D17 ADR-0007 符号引用同步（2026-11-21 / 独立验收归档）**：只改 `Rejected` 与 `Consequences` 的符号名并
  注明更名来源，不标记 `Superseded`——被推翻的是「实现怎么命名」而不是「`conflict` / `ambiguous_result`
  的系统级承诺」，ADR 决策本身仍成立；ADR 规范只要求对被推翻的决策追加 `Superseded by ADR-YYYY`
  （`docs/adr/README.md`）。
- **D18 `removeWorktree` 继续接受相对 `externalId`（2026-11-21 / 独立验收归档）**：与 `createWorktree` /
  `getWorktree` 共用 `resolveTarget → resolveWorktreePath`（拒绝 `..` / 控制字符 / 首尾空白 / 链接逃逸 / 出根），
  删除目标还必须命中 Git 登记并通过正面身份与干净门，且 `remove` argv 只收规范化绝对路径——相对写法不扩大
  可达删除集合，只改变调用方表达路径的方式。不为 remove 单独要求绝对路径：会让同一 port 的三个工作树方法
  语义不一致，且没有已证实的威胁可消除（探针读数见 Surprises 16）。脚枪风险记入 Outcomes 剩余风险。
- **D19 归档期文档一致性修正（2026-11-21 / 独立验收归档）**：`docs/README.md` 索引移入 Completed、本计划
  自引用改 `completed/`、两份历史计划 Superseded 链接改指 `completed/`、`:607` 补 `createBranch` 返回值断言
  （只新增断言，不弱化既有断言）；P2（ignored-only 数据损失面、Windows 证据缺口）写入 Outcomes 剩余风险并给
  后续 issue 建议，不新建 issue。

## Idempotence and Recovery

- **可重复执行**：所有验证命令只读或使用临时夹具（`mkdtemp`），重复运行结果一致；集成测试的 `fixtureFor`
  每个用例独立仓库并由 `t.after` 清理。`git worktree remove` 成功后再次调用在本 provider 中先命中登记门 →
  `not_found`，不会「又删一次」。
- **失败恢复**：被拒绝的调用不改登记/目录/分支，直接修正输入或工作树后重试；`ambiguous_result` 表示可能已删或
  部分删，必须先 `listWorktrees` / `getWorktree` / 磁盘回读 reconcile，禁止盲目重试；写后回读失败同样按
  `ambiguous_result` 处理。
- **开发期误删的恢复**：本 provider 不移除分支；若调试中真的移除了工作树，分支与提交仍在，可
  `git worktree add <same-path> <branch>` 恢复一份干净工作树（不含 ignored 内容，符合 D2）。测试夹具删除的
  是 `mkdtemp` 临时仓库，无用户数据。
- **回滚**：按批次 `git revert`。Batch 3 → Batch 2 → Batch 1 可逐层回退；整 PR revert 后 provider 回到不声明不实现，
  e2e flag 与过时断言同步恢复。本 PR 不写 storage/Host 事实，唯一不可回滚的是开发中显式移除过的临时工作树。
- **回到已知良好状态**：`git status --short` 干净、V1–V4 `fail 0`、V6 在预算内；若测试夹具残留，删除对应
  `mkdtemp` 目录即可（用例自带清理，失败时按输出路径人工清理）。

## Interfaces and Dependencies

- **契约**：`DevelopmentProvider.removeWorktree?(input: ProviderRemoveWorktreeInput)` 与
  `CapabilityKey.DevelopmentWorktreeRemove = 'development.worktree.remove'` 已存在，本 PR 不改形状、不改 key、
  不改 `ProviderError`、不改共享套件；只新增实现、能力声明与 port JSDoc。
- **依赖方向**：provider 只依赖 `capabilities` 与 `domain`（`package-boundaries.test.js` 守卫），本 PR 不新增导入边。
- **Git**：argv-only；用到 `worktree list --porcelain -z`、`rev-parse`、`status --porcelain=v1 -z --untracked-files=normal`、
  `worktree remove`。`--no-optional-locks` 需 Git 2.15+；本机 2.56.1、CI 观测 2.50/2.56，不新增依赖或版本门。
- **Node/工具**：现有 `pnpm` scripts；无新包、无新服务、无凭据、不触网。
- **跨模块调用面**：core/controller/client/ui-model/ui/apps 零改动；`packages/core/src/registry.ts` 与
  `git-provisioning.ts` 不改；Host 组合不改。
- **测试依赖**：`tests/integration/local-git-fixture.js` 的 `providerFor`/`recordingRunner`/`fixtureFor`；
  共享套件通过 `tests/integration/development-local-git.test.js` 的 `localGitSuite` 自动接管移除往返。
- **外部事实**：Git 版本行为以复核时的实测为准；Windows 原生不在本 PR 证据面（见 Validation 的未验证项）。
- **并行范围**：同迭代的 #191（core）、#314（ui-model）、#396（tests 的 package-boundary 扫描）与本 PR 文件集无交集；唯一共享文件是 `docs/README.md` 的 ExecPlan 索引行，按合并顺序 rebase 解决，不构成技术依赖或堆叠 PR。

## Outcomes & Retrospective

**判定：验收通过（AC1–AC3 全部 PASS），独立验收 2026-11-21。** 实现代码 head `d3e785bf`；本节 V1–V8 是归档提交前
在检出 `feature/worktree-clean-removal` 的工作树根目录**独立复跑**的读数（不是实现者自证），命令定义见
Validation and Acceptance。

### 验收标准逐条

| AC | 判定 | 判据（本轮复跑 / 代码位置） |
|---|---|---|
| AC1 脏工作树被拒且逐字节不变 | PASS | `tests/integration/development-local-git.test.js`「脏工作树被拒且逐字节不变，错误报告未提交路径数」：3 条 porcelain 记录（修改 tracked + staged 新文件 + 未跟踪文件）+ ignored `.env` + `status.showUntrackedFiles=no` 负控 → `invalid_input`、`retryable=false`、message 含「3 个未提交路径」、`snapshotTree` 前后 `deepEqual`、登记/HEAD 不变、零 `remove` argv。 |
| AC2 干净工作树仅在显式请求时移除、无其它调用路径 | PASS | 同文件「干净工作树仅显式移除…」：目录与登记消失、分支与分支头保留、二次 `not_found`、`remove` argv 恰为 `['-C',repo,'worktree','remove',target]`；「创建、读取、预检与分支方法都不会移除工作树」跑完 6 个既有方法（含新增的 `createBranch` 复用返回值断言）后登记原样；V7 grep 证明 core/controller/client/ui-model/ui/apps 零 `.removeWorktree(` 调用点，`provider.ts` 内 `'worktree','remove'` 恰 1 处。 |
| AC3 允许根之外的路径在任何 Git 命令之前被拒 | PASS | 同文件「越界、含 `..` 与符号链接逃逸都在任何 Git 命令之前被拒（零次调用）」逐个断言 `recorder.calls === []`；判定顺序见 `packages/providers/development-local-git/src/provider.ts`：能力 → 身份 → `resolveTarget`（纯 fs）→ 登记 → 正面身份 → 干净 → 删除 → 回读。 |

### 最终门禁读数（归档 head）

| 编号 | 命令 | 结果 |
|---|---|---|
| V1 | `pnpm run typecheck` | exit 0 |
| V2 | `node --test --test-timeout=300000 tests/integration/development-local-git.test.js` | tests 89 / pass 89 / fail 0 / cancelled 0（≈13s） |
| V3 | `pnpm test:file tests/contract/development-contract.test.js` | tests 96 / pass 96 / fail 0 / cancelled 0（≈15s） |
| V4 | `node --test --test-timeout=300000 tests/e2e/repository-routing.test.js` | tests 21 / pass 21 / fail 0 |
| V5 | `pnpm run boundaries` | tests 10 / pass 10 / fail 0 |
| V6 | `node scripts/rule-checks.mjs size main`、`disclosure main`、`git diff --check main...HEAD` | 代码 408 / 800、文档 567 / 1300（用户上限；仓库上限 1000 / 1500 更宽）；disclosure 机械扫描通过；diff-check 无输出 |
| V7 | `git grep -nE "\.removeWorktree\s*\(" -- packages/core … apps`；`git grep -n "'worktree', 'remove'" -- packages/providers/development-local-git/src` | 前者无输出（exit 1）；后者恰好 1 处（`provider.ts` 的 `removeWorktree` 内） |
| V8 | `pnpm verify` | exit 0：contract 1620/1620、integration 2323/2351（skipped 28）/ fail 0、e2e 226/226；typecheck exit 0 |

补充：`node --test tests/contract/development-local-git-source.test.js` → 1/1 pass（argv-only 源扫描守卫未被削弱）。

实现期与本轮不一致的两条已就地更新：V3 在实现期因共享机 load≈405 撞 120s 单测期限（`pass 95 / cancelled 2`），
本轮 load < 10 时用精确命令复跑得 96/96 全绿；V8 实现期未完整执行，本轮 `pnpm verify` exit 0。两者都说明当时是
环境（load）而非代码问题，依据见 Surprises 12。

### 与计划的偏差

- 批次数不变；新增用例 10 个（重写 1 个不计），V2 由 79 → 89；D14 调整了步骤 9–10 的实现批次（TDD 需要）。
- 无收缩项（detached、prunable、REFUSALS 注入等判别性子例全部保留）；实现期实测的 Git 行为（locked 文案两行、
  prunable remove exit 0、`showUntrackedFiles=no` 隐藏未跟踪）与计划一致。
- 归档期没有改变验收行为：只新增 port JSDoc 一句注释与 `:607` 一条 `createBranch` 返回值断言，其余为文档一致性
  修正（D19）。
- 独立验收的重构审查没有发现净收益改动：`removeWorktree` 的判定链与错误映射已按单一权威组织，重复的
  `Promise.all(samePath)` 只有三处且各处上下文不同，抽 helper 会一并改动既有 create/get 及其判别性用例，收益小于回归风险。

### 剩余风险（P2，已记录、不在本 PR 修复）

1. **ignored-only 的数据损失面（D2/D13 已由人类伙伴批准并文档化）**：Git 口径下只有被忽略内容（`.env`、
   `node_modules/`）的工作树算干净，显式移除会把它们一起删除，当前没有任何产品入口或二次确认；shipped 用例
   「Git 口径下只有被忽略内容的工作树视为干净，显式移除会删除被忽略内容」钉住该语义。**建议**：在出现产品入口
   （core 命令 / UI 按钮）之前另开 **safe/discard 或显式确认** 的后续 issue（如 `mode: safe | discard` +
   结构化 blocked reasons + `overrideLock`），不在本 PR 实现、不新建 issue。
2. **Windows 原生证据缺口**：本组新增的 10 个移除用例（另加 1 条改写的「能力子集」断言）的判别证据只在 darwin
   产生；`.github/workflows/ci.yml` 的 Windows Native lane 只跑 `development-local-git-windows.test.js`（路径准入）
   等既有文件，不含本组用例。Windows 上句柄释放延迟可能让「写后回读」把成功报成 `ambiguous_result`（诚实但可能
   误报）。**建议**：后续把移除用例加入 Windows lane 的 SETS，或至少补一条 Windows 路径/argv 冒烟，作为独立 issue
   的证据工作。
3. **`removeWorktree` 接受相对 `externalId`**（D18）：不是越权通道，但调用方若把相对路径当 canonical id，会得到
   `not_found` 或删到同允许根内的另一份登记；已记录，不改语义。

### 其它遗留

- Ready 上下文旧句柄 #211 仍未处理（D13/Q5 明确不在本 PR 范围）。
- 本 PR 不产生产品入口 / UI 可观察面，只在能力快照与 provider 契约层可观察；PR 描述需写明（P1）。
- PR #671 描述的「真实验证证据」仍是 draft 占位（独立验证报告 P1），须由 Lead 在 ready 前回填；本 subagent 按
  任务约束不改 PR 描述。

## Bottom Change Note

- 2026-11-21 / 独立 spec 评审：创建本计划。独立复核两份设计提案后收敛：取最小 provider 闭环；裁定 Git 口径 clean、`invalid_input`、
  prunable `not_found`、复用正面身份探针；否决 ignored 算脏、rawClass/details、core-UI 接线、跨包源扫描；补上
  补上两份设计都漏掉的 e2e 键集合同步与历史计划 Superseded 注记；写入 V1–V8 唯一验证命令、变异表与回滚点。
- 2026-11-21 / 实施（TDD，3 批 + 本计划回填）：Batch 1 `5042e1a1` 能力声明 + 干净往返；Batch 2 `11138076`
  正面身份（`reuseBlockedBy` → `worktreeIdentityProblem`）+ detached + 干净门；Batch 3 `d3e785bf` 写后回读 +
  REFUSALS 映射 + port JSDoc + 文档同步。每批都先跑出真实红线再转绿；实现偏差见 D14/D15。
- 2026-11-21 / 独立验收与归档：在 `c13476fe` 上独立复跑 V1–V8（`pnpm verify` exit 0），逐条判定 AC1–AC3
  PASS；按独立验证报告的 P2/P3 做文档与证据收尾——ADR-0007 符号引用更名（D17）、port JSDoc 计数口径（D16）、
  `:607` 补 `createBranch` 返回值断言、dirty 用例组成差异与相对路径裁决分别记入 Surprises 14–16 与 D18、
  两份历史计划的 Superseded 链接改指 `completed/`、`docs/README.md` 索引移入 Completed、Outcomes 回填最终
  读数与 P2 剩余风险；PR #671 描述占位（P1）按任务约束留给 Lead。计划归档到 `docs/exec-plan/completed/`。
