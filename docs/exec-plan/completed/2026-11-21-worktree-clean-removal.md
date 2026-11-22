# worktree-clean-removal ExecPlan

> 状态：Completed（2026-11-22 评审修复轮收敛并归档；归档后按评审方追加 P2 完成 R671-05 修复并通过第二轮独立复验 PASS WITH FINDINGS，结论不变；归档快照尚未合并，当前 PR 状态以远端回读为准；`Refs #138` 保持 OPEN）
> 创建：2026-11-21
> 范围：issue #138 —— local Git Development provider 只在显式请求且工作树干净时移除工作树；脏树结构化拒绝且逐字节不变；允许根之外在任何 Git 命令之前拒绝。只到 provider 层，不接 core/controller/UI。2026-11-22 评审修复轮关闭 `docs/review/pr-671-mmp-review.md` 的 R671-01..04，并按评审方追加段关闭 R671-05（`worktree repair` 失败时登记回滚不可证明的失败分类）。
> 上游输入：issue #138（`kind:feat area:providers`）、`AGENTS.md` §7、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、`docs/review/responding.md`、`docs/review/pr-671-mmp-review.md`、`docs/exec-plan/completed/2026-09-24-local-git-worktree.md`、`docs/exec-plan/completed/2026-09-26-development-suite-capability-driven.md`、ADR-0007。

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
  `docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md`。`docs/review/pr-671-mmp-review.md` 是只读评审证据，
  随 PR 提交但不修改。不再改其它 tracked 文件。
- **规模**：技术新增+删除 ≤ 800 行（用户上限；forecast 500；本计划估算 350–420），文档 ≤ 1300 行。
  评审修复轮的用户上限不变（代码 800 / 文档 1300），执行前基线 `rule-checks size origin/main` = 代码 408 / 文档 694；
  修复轮分配：provider +130~145、测试 +195~225、计划约 +150~185。`rule-checks size origin/main` 是唯一判定。
- **不削弱守卫**：不改 `tests/contract/suites/development.js`、不改 fake、不改坏 adapter 矩阵；只把已过时的
  事实断言就地改写为真实实现（312–322）。
- **破坏性边界**：无 `--force`/`-f`、无 `prune` 自动执行、无 `branch -d/-D`、不改 `.gitignore`/`info/exclude`；
  不写 storage，不碰 Host 状态。
- **Git 边界**：只经 `GitRunner` 的 argv 数组；不拼 shell（`tests/contract/development-local-git-source.test.js`
  已守卫）。使用 `--no-optional-locks`（Git 2.15+；本仓 CI 观测 git 2.50/2.56，本机复核 2.56.1，不新增版本门）。
- **文档**：正文中文、标识符/命令英文；不写本机绝对路径；本计划随 PR 提交，最终位置是
  `docs/exec-plan/completed/2026-11-21-worktree-clean-removal.md`，`docs/README.md` 索引在 Completed 段保留本计划与
  评审修复轮说明（2026-11-21 首次归档；2026-11-22 按 PR #671 评审重开为 active，评审修复轮收敛后按 `PLANS.md`
  §2 再次归档并回读索引）。
- **分支与工作树**：`feature/worktree-clean-removal`，在仓库内 `.worktrees/worktree-clean-removal/` 执行；
  base 用 `origin/main`（复核时 `f74a3b8b`，执行前用 `git rev-parse origin/main` 回读）。
- **提交**：`<type>(<scope>): <中文摘要>`，正文说明为什么，末尾 `Refs #138`（评审方决定 #138 保持 OPEN，不使用 `Closes`）；一个 PR 独立验收/合并/回滚。
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

### Batch 5 · 评审修复轮（2026-11-22）

**最小闭环**：关闭 PR #671 评审的 R671-01（删除绑定稳定准入对象）、R671-02（detached/身份守卫延伸到删除边界）、
R671-03（可能部分生效的失败一律 ambiguous/reconcile）、R671-04（决策来源更正）、R671-05（`repair` 非零时登记
回滚不可证明的失败分类）；每条都有「修复前红、修复后绿」的
真实状态切换回归，不静默削弱承诺；不可移植窗口以 H1–H5 交人类裁决。
**涉及文件**：`packages/providers/development-local-git/src/provider.ts`、`packages/capabilities/src/development-provider.ts`
（边界与残余风险 JSDoc）、`tests/integration/development-local-git.test.js`、`tests/integration/README.md`、本计划。
其余不变，见 `Global Constraints`。

**最终方案**（独立 spec 评审裁定，D21–D25）：`removeWorktree` 判定链固定为
能力 → 身份 → 路径（纯 fs）→ 登记 → locked/prunable/detached/身份 → ref backend → **HEAD 协调锁** →
锁内身份复验 → **对象锚（dev/ino）** → 干净门 → **`rename` 隔离到 `<rootReal>/.harness-remove-<uuid>`** →
对象复核 → `worktree repair <q>` → `worktree remove <q>`（无 force）→ 回读。任何 remove 非零 = `ambiguous_result`；
reftable 引用后端显式 `not_supported`；崩溃/残锁恢复契约写入 port JSDoc（D24）。

**步骤**：
1. **RED**：改写干净往返（`repair`/`remove` argv 都指向隔离目录、无 force/move、q 父为允许根 realpath）与
   fake-success/locked 用例；新增 T1 同 gitfile 替身（注入点 = 干净门 `status`）、T2 检查后真实 detach、
   T3 真实 0555 部分删除、T4 reftable；删除 4 条只注入 Git 拒绝文案的子例；其它方法的 argv 断言扩到
   repair/remove/move。运行 V2 记录真实红线（读见 Progress）。
2. **GREEN**：`WorktreeRecord.locked`；ref backend 守卫；HEAD.lock（`wx`、marker、finally 只删自己的）；
   锁内身份复验 + `lstat`/dev/ino/ino=0；原子 rename 隔离与 errno 分类；对象复核与回滚；repair 绑定与
   unknown subcommand → `not_supported`；remove 非零一律 ambiguous + 恢复信息；`repair` 非零时先反向 rename 再
   反向 `repair <target>` 并回读登记：能证明登记回到 target 才答 `invalid_input`，否则一律 `ambiguous_result` 并报
   隔离路径/目标/分支/登记实际读数与恢复步骤（R671-05，D27）；删除 `REFUSALS` 死行。
3. **文档（同批提交）**：port JSDoc 支持矩阵/残余风险/崩溃恢复；`tests/integration/README.md` 第 13 行语义；
   本计划（header/Global Constraints/Batch 5/Progress/Surprises/D21–D25/Outcomes，含 R671-04 对 D13 与
   「剩余风险 1」的出处更正）。**不修改**评审文档本身（只读证据，随 PR 提交）。
4. **验证**：V1–V8 + T1–T5 + M13–M17 变异表全 KILLED；三份临时探针按新注入点改写后复跑只作证据，不入仓。
5. **独立复评**：由非实现者在修复 head 上复跑 V1–V8、T1–T4、M13–M17，回读 grep/size/disclosure；通过后才 push、
   回读 PR head/base/checks/threads 并逐条回复（本批不合并不 approve）。
6. **最终独立验收与归档**（2026-11-22，非实现者）：复跑 V1–V7 与 `development-local-git-source.test.js`，回读验证
   报告的 P2/P3；处理 P3 文档项（归档后复核两处历史 Superseded 链接、清理悬空「人体裁决点」引用、把 P3-2/P3-3/P3-5
   记入 Surprises/剩余风险），把 P2-1/P2-2 记录为已声明支持边界与人类裁决点 H1/H4，不改变实现；计划移入
   `docs/exec-plan/completed/` 并回读索引。push、PR 描述、review 回复与 resolve 仍留在人类/Lead 门后。

**验证**：V1–V8（V2 期望 94/94 = 基线 89 + T1–T5）；变异 M13→T2、M14→T1/T5、M15→T3、M16→T4、M17→T1、M18→T5（repair 失败分类）。
**回滚**：revert 本批唯一提交，provider 回到「直接 remove target」旧行为；无 storage/迁移。回滚**不**自动清理
运行期可能残留的 `<rootReal>/.harness-remove-*` 与 `<admin>/HEAD.lock`（按 D24 人工恢复）。

## Validation and Acceptance

以下命令是**唯一来源**；执行上下文统一为「检出 `feature/worktree-clean-removal` 的工作树根目录」，base 用
`origin/main`（执行前 `git rev-parse origin/main` 回读，不把易失 SHA 写死）。

- **V1 类型**：`pnpm run typecheck`。期望：exit 0，无输出错误。
- **V2 判别性集成**：`pnpm test:file tests/integration/development-local-git.test.js`。期望：`ℹ fail 0`，
  `ℹ pass` 等于本文件当前用例数。评审修复前基线 89；修复轮新增 T1–T4（4 条）后期望 **93/93**（改写的用例不计新增；
  执行时回读，不预填读数）。
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
  对照 `git grep -n "'worktree', 'remove'" -- packages/providers/development-local-git/src` 期望恰好 1 处、
  `git grep -n "'worktree', 'repair'"` 期望恰好 **2** 处（R671-05 后：正向绑定 `quarantine` + 反向恢复 `target`，
  都在 `provider.ts` 的 `removeWorktree` 内），`git grep -n "'worktree', 'move'"` 期望 0 处（隔离原语不是 `worktree move`）。
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

评审修复轮新增（M13–M17，独立 spec 与临时 fixture 实测，结果见 Progress）：

| 变异 | 应红 |
|---|---|
| M13 去掉 HEAD 协调锁（不创建 HEAD.lock） | T2「检查后 checkout --detach … 被 HEAD 协调锁拒绝」 |
| M14 跳过隔离（不做 rename，退回直接删除路径） | T5「干净工作树…隔离目录绑定登记」+ T1「同 gitfile 替身」（+ T3、fake-success 也红） |
| M15 remove 非零沿用通用 `failureOf`（权限拒绝映射） | T3「真实权限导致的可能部分删除答 ambiguous_result」 |
| M16 reftable 守卫放行（条件恒假） | T4「reftable 引用后端拒绝破坏性移除」 |
| M17 只取 `lstat` 不做 dev/ino 复核 | T1「准入后对象被换成同 gitfile 替身」 |
| M18 repair 非零一律按「已恢复」分类、不做反向 repair 回读证明 | T5「repair 非零不得声称已回滚…」 |

**未验证项（须在 PR 描述写明）**：Windows 原生未运行本组新用例（`development-local-git-windows.test.js` 只覆盖
路径准入），评审修复轮新增的 HEAD 锁 / `rename` / dev-ino / `worktree repair` 只在 darwin + Git 2.56.1 实测；
Git 版本行为以本机 2.56.1 实测与 CI 的 2.50/2.56 为准，更老 Git（<2.30 无 `worktree repair`）只按 unknown
subcommand → `not_supported` 分类；reftable 只验证 fail-closed、不验证移除；没有产品入口/UI 可观察面，
本 PR 只交付 provider 契约与能力快照。

## Progress

- [x] 2026-11-21 计划创建与事实核验：复核两份设计提案，实测 Git 行为，锁定最终方案与拒绝项（证据见 Surprises & Discoveries）。
- [x] 2026-11-21 Batch 1 · 能力声明与干净移除往返（`5042e1a1`，TDD：V2 红线 4≠5 键 + `removeWorktree is not a function`、V4 键集合不等 → V2 80/80、V4 21/21）。
- [x] 2026-11-21 Batch 2 · 安全拒绝（路径/身份/脏/能力关闭）（`11138076`，TDD：脏树被 Git 拒成 `ambiguous_result`、主检出/detached 身份未判 → V2 86/86）。
- [x] 2026-11-21 Batch 3 · 诚实写路径、守卫与文档（`d3e785bf`，TDD：假成功被报 ok、locked 落成 `ambiguous_result` → V2 89/89）。
- [x] 2026-11-21 最终门禁 V1–V8 独立复跑与 AC1–AC3 判定（实现 head `d3e785bf`、文档 head `c13476fe` 上复跑；`pnpm verify` exit 0；读数见 Outcomes & Retrospective）。
- [x] 2026-11-21 归档与文档收尾：计划移入 `completed/`（文件名不变）、`docs/README.md` 索引从 Active 移到 Completed、两份历史计划的 Superseded 链接改指 `completed/`、ADR-0007 符号引用更名、port JSDoc 计数口径、`:607` 补 `createBranch` 返回值断言、Outcomes 回填最终读数与 P2 剩余风险。PR #671 描述占位（验证报告 P1）按任务约束留给 Lead。

- [x] 2026-11-22 Batch 5 · 评审修复轮实现（本批唯一提交，head 以 `git rev-parse HEAD` 回读，不写死）：
  - **RED**（先改/加判别性用例、未动实现）：`pnpm test:file tests/integration/development-local-git.test.js`
    → `tests 93 / pass 86 / fail 7`。7 条真实红线：干净往返（旧实现无 `repair` argv，remove argv = target）、
    T1 同 gitfile 替身（旧实现 `ok:true` 并删除替身）、T2 检查后 detach（旧实现 detach exit 0）、T3 真实 0555
    部分删除（旧实现 `permission_denied`）、T4 reftable（旧实现 `ok:true` 并删除）、fake-success（旧实现无隔离残留）、
    真实 locked（旧实现落成「Git 拒绝移除工作树」，无 unlock 出路）。
  - **GREEN**：同命令 → `tests 93 / pass 93 / fail 0 / skipped 0`；V1 typecheck exit 0；V3 `96/96`；V4 `21/21`；
    V5 `10/10`；`development-local-git-source.test.js` `1/1`；V7 grep 读数见 Validation。
  - **变异 M13–M17**：5/5 KILLED（M13→T2、M14→T5（T1/T3/fake-success 同红）、M15→T3、M16→T4、M17→T1）。
- [x] 2026-11-22 独立复评（非实现者，PASS WITH FINDINGS，无 P0/P1）：在本地修复 head 上复跑 V1–V8 与
  `development-local-git-source.test.js`，自建 19 个攻击场景/120 条断言、M13–M17 全部 KILLED，逐字节还原后
  `git status` 空、HEAD 未变；2 条 P2 为已声明残余/平台证据缺口，4 条 P3 为文档/分类小项。通过后才 push、
  回读 PR head/base/checks/threads 并逐条回复评审（本批复评不自行 push）。
- [x] 2026-11-22 最终独立验收、P3 收尾与归档（非实现者）：处理 P3-1（两处历史 Superseded 链接在归档后回读可解析）、
  P3-4（清理 D2/D3 悬空的「人体裁决点 1/2/3」引用）；P3-2/P3-3/P3-5 记入 Surprises 22–24 与剩余风险；P2-1/P2-2
  记为已声明支持边界与人类裁决点 H1/H4（不改变实现）。计划移入 `completed/`，`docs/README.md` 索引 Active→Completed
  并保留评审修复轮说明；最终验证读数见 Outcomes 的「独立验证与最终验收」表（V1–V7 + 源扫描全绿，size 代码
  735/1000、文档 953/1500，均在本轮预算 800/1300 内）。
- [x] 2026-11-22 归档后追加修复 R671-05（评审方 11:17 追加 P2，实现者）：`worktree repair` 非零不再只 rename 回目录
  并声称零写入；改为反向 `repair <target>` + 回读登记，可证恢复才 `invalid_input`，否则 `ambiguous_result` 并报实际
  登记读数（D27）。TDD：新增 T5 后先跑 `tests 94 / pass 93 / fail 1`（旧 message「必须给出恢复依据」），实现后
  `tests 94 / pass 94 / fail 0`；V1/V3/V4/V5 全绿；V8 `pnpm verify` exit 0（contract 1625/1625、integration
  2328/2356 skipped 28、e2e 226/226）；M13–M18 6/6 KILLED（新增 M18→T5）；size 代码 796/800、文档 1001/1300（提交 head 回读；评审方两段追加由验收 agent 以 `docs(review)` 收录，最终读数见下一条），
  disclosure 通过、diff-check 无输出。新增独立 `fix(provider)` 提交（不改先前提交、不 push）。
- [x] 2026-11-22 第二轮独立复验与最终收尾（非实现者验收）：第二轮复验 PASS WITH FINDINGS、无 P0/P1，R671-05 关闭成立
  （8 个 repair 攻击场景/45 条断言 0 失败；上轮 19 场景/120 断言在新 head 0 失败；M13–M18 6/6 KILLED；RED 复现
  94 条用例 pass 93 / fail 1 恰为 R671-05 的 T5）。评审方追加段（「候选技术核对」+「repair 修复的独立核对」）以
  单独 `docs(review)` 提交 `03c60b7d` 原样收录；计划订正 R671-05 证据、第二轮读数、残余表、P3-N1/N2/N3 records 与
  P3-N4 M14 killedBy 枚举。最终验证与 size 见「第二轮复验与最终收尾」表（typecheck exit 0、集成+源扫描 94/94、
  契约 96/96、e2e 21/21、boundaries 10/10，size 代码 796/800、文档 1115/1300（该提交实测））。
- [x] 2026-11-22 发布前文档口径对齐（非实现者）：按评审方最终核对清单把计划内的提交口径从 Closes 改为 `Refs #138`
  （#138 保持 OPEN，不使用 Closes）；`docs/review/README.md` 评审索引补 PR #671 行；`docs/project-management/merge-queue.md` 本批
  补 #672 已合入（main `4907adaa`）、#671 改为「修复已回传、待复审」，保留 #670/#673 记录；最终门禁复跑读数见
  「第二轮复验与最终收尾」表（size 代码 796/800、文档 1128/1300）。

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

评审修复轮（2026-11-22，独立 spec 复核的临时 fixture 实测；临时探针不入仓）：

17. **F2 files backend 的 `HEAD.lock` 是有效的删除期协调锁。** 在 `<admin>/HEAD` 旁以 `wx` 创建并持有到删除结束：
    `checkout --detach`、`symbolic-ref HEAD`、`checkout -b`、`commit/amend/reset` 全部被 Git 拒绝
    （`cannot lock ref 'HEAD'`），`status` / `worktree list` 正常，`worktree repair` / `remove` 照常成功；
    成功 remove 连 admin dir 与锁一起删除，锁路径不随 move 变化。这是 R671-02 的可实现边界（不是重复探针）。
18. **F3/F4 reftable 下同一把锁无效，必须显式拒绝。** `git init --ref-format=reftable` 仓库里创建 HEAD.lock 后
    `checkout --detach` 仍 exit 0；`git -C <linked-wt> config --local --get extensions.refstorage` 对 files 返回
    exit 1 空、对 reftable 返回 `reftable`。因此把「HEAD 锁 = 并发协调」的承诺限定在 files backend，reftable
    答 `not_supported`（D22）。
19. **F9/F10 否决 `git worktree move` 作隔离原语。** 叶换成同 gitfile 的替身时 move 只搬 symlink 并把登记改写到
    根外解析路径（exit 0）；目标已存在时 move 成功但把工作树搬进 `q/<name>`（登记路径嵌套，不报错）。隔离原语
    改为 `fs.rename` + 显式登记 repair（D21/D23）。
20. **F11 真实 locked 下 `fs.rename` 会成功。** 若把 locked 交给 remove 阶段兜底，rename+repair 已改登记、remove
    才以 locked 拒绝；因此 locked 必须在任何写之前用登记快照拦下并给 `git worktree unlock` 出路。
21. **F5/F6/F8 支撑对象锚与回滚。** `fs.rename` 原子、不跟随末分量 symlink、EACCES（父目录 0555）零副作用；
    rename 后 `worktree remove` 报 `is not a working tree`，`repair <q>` 后可删、可反向 rename+repair 回滚
    （repair 成功时 stderr 有 `repair: gitdir incorrect` 但 exit 0，按 exit code 判）；复制目标 `.git` 的替身被 Git
    当作同一登记工作树，故对象身份只能用 `(dev, ino)`，gitfile 字节相等不是身份。
22. **P3-2 替换物分类：准入后 target 被换成「无 git 标记的外来 clean 目录」时答 `not_found`。** 干净门
    `git status` 读失败走通用 `failureOf`，message 是「Git 找不到目标」而不是「对象不是准入对象」；破坏性动作为零、
    外来内容逐字节保留，不影响 R671-01 的对象绑定结论。仅为分类可读性小项（干净门 + `REFUSALS`），本轮按验证
    报告保留，不做语义改动。
23. **P3-3 R3 外部 `git worktree move` 的分类：窗口内被外部 move 时答 `unavailable`。** 干净门读到的是
    「仓库目录暂时不可达」，实际是登记被移动；无破坏性动作。外部 `git worktree lock` 注入则诚实答 `ambiguous_result`。
    可选的改进是 message 指引先回读登记，属措辞打磨，不改实现。
24. **P3-5 runner 抛异常路径：provider 直接 reject，不进结构化分类。** 注入 runner 抛错时原始 `Error` 透传
    （`GitRunner` 契约未承诺不抛），但 HEAD 锁在 `finally` 释放、树/登记完好；默认 runner 不抛。作为已声明边界记录，
    本轮不改契约。
25. **R671-05（评审方 11:17 追加 P2）：`worktree repair` 失败不等于登记未写。** 真实复现：把 admin 的 `gitdir`
    改写到隔离路径后让 `repair` 中断，登记确实指隔离路径；旧实现只 rename 回目录就答 `invalid_input` 并声称
    「已回滚隔离目录，未删除任何内容」，二次调用 `not_found`——message 与实际登记状态不符。修复后对该路径做
    反向 `repair <target>` 并回读 `worktree list`：可证明登记回到 target 才答 `invalid_input`，证明不了（反向 repair
    失败/被中断/回读失败）一律 `ambiguous_result` 并报「登记仍指隔离路径」等实际读数；M18 钉住该分类。
26. **P3-N1 反向 rename 失败分支的 message 不完整（如实记录、不改代码）。** repair 非零、反向 rename 又被预先重建的
    target 阻断时，provider 诚实答 `ambiguous_result`（含 q/target、无虚假回滚、无锁残留），但 message 缺分支、
    登记实际位置与 `repair`/`prune` 恢复步骤，与另一条 ambiguous 分支不一致。代码体量仅余 4 行（796/800），
    本轮不改代码，记为残余，复用完整恢复模板留后续。
27. **P3-N2 unknown subcommand 的「登记未被修改」是版本门声明而非回读证明。** 该分支回滚后 `not_supported` 的
    「命令未执行、登记未被修改」依赖真实 Git <2.30 在写前退出的行为；恶意/故障 runner 可先改登记再返回同一文案
    使其为假（R5-E2）。风险仅限非真实 Git 语义，本轮如实记录、不改代码。
28. **P3-N3 可证恢复时的过度保守。** 两次 repair 都失败但回读已证明登记仍指 target 时仍答 `ambiguous_result`；
    与 D27 的「反向 repair 失败 → ambiguous」契约一致，无数据风险，留作后续打磨。
29. **P3-N5 代码体量余量只剩 4 行。** 最终代码 796/800（用户上限）；任何后续代码修复都必须先按计划收缩顺序腾量，
    文档增量不计入代码口径。

## Decision Log

- **D1 只做 provider 纵向闭环**（2026-11-21 / 独立 spec 评审）：issue area 是 `providers`，三条 AC 都能在
  provider 层判定；core/controller/UI 没有消费者，接命令需要产品决策（#211/#212），并会超预算。Rationale：
  最小可独立验收/合并/回滚的闭环。
- **D2 clean = Git 口径；ignored 不算脏**（同上）：issue 用词是 `uncommitted`，AC2 要求 clean 工作树可移除；
  把 ignored 计入会让真实工作树不可移除且需要未授权的 discard/override 输入。后果（ignored 内容随显式移除
  删除）写入 port JSDoc、本计划与 PR 描述（决策来源见 D13/D20，支持边界见 D25 的 H5）。
- **D3 脏树/确定性拒绝用 `invalid_input`**（同上）：ADR-0007 决定 1；`conflict` 与 `ambiguous_result` 有系统级含义，
  不得挪用。计数放 message；不扩 `ProviderError`（对应 D13 的 Q2/Q3 与 D20 的来源更正）。
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
- **D13 AI 协调者在授权范围内作出的 5 项工程选择（2026-11-21 / Lead 转达，实施期直接执行）**：Q1 ignored 不算脏（Git 口径
  `status --porcelain` 为空即干净），显式移除会连带 ignored 内容，作为已文档化的数据损失面；不做 safe/discard
  分层、不加 `--force`。Q2 未提交计数只放 error message，不扩 `ProviderError.details`/`rawClass`。Q3 确定性
  拒绝一律 `invalid_input` + `retryable:false`。Q4 prunable 登记返回 `not_found` 并给 `git worktree prune`
  出路；detached 拒绝为 `invalid_input`。Q5 不接 core/controller/UI 入口、不处理 #211 旧句柄，PR 描述明示
  仅 provider 层能力。Rationale：与 D1–D10、ADR-0007 一致，且不扩大 issue 验收范围。
  **来源更正（2026-11-22 / R671-04 与 D20）**：原记为「人类伙伴批准的 5 项裁决」，实际是人类授权 AI 协调者
  调研后自行判断、存疑才询问范围内作出的工程选择，人类并未逐项点名批准；技术结论 Q1–Q5 与授权原话不变。
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

- **D20 评审修复轮的范围与来源**（2026-11-22 / 人类交办 + 评审）：人类明确要求 P0/P1 交原实现 session 修复后回传复审；修复范围严格限定 review 文档 R671-01..04，不扩 PR、不改规划 Status/blocked、不合并/approve。此前 D1–D19 中标注为「人类批准/人类伙伴裁决」的条目，实际来源是 AI 协调者在人类授权（调研后自主判断、存疑才询问）范围内所作工程决定；R671-04 要求更正该出处，技术选择本身不变。
- **D21 隔离对象 + dev/ino 对象锚（2026-11-22 / 独立 spec 评审裁定，R671-01）**：删除前把准入对象 `fs.rename` 到
  允许根 realpath 下的 `.harness-remove-<uuid>`，再用 `lstat`/`stat(...,{bigint:true})` 复核隔离对象仍是同一
  `(dev, ino)`；不符则 `rename` 回滚并答 `invalid_input`（未删除任何内容），回滚失败才 `ambiguous_result`。
  理由：路径式递归删除会跟随被替换的祖先 symlink，复制 `.git` gitfile 的替身会被 Git 认成同一登记工作树
  （F8/F9），字节相等不是身份。`git worktree move` 否决（F9/F10）。残余：`repair`/`remove` 末窗仍有非协作替换面
  （R1，Node 无 handle-relative 删除、Git CLI 只收路径）。
- **D22 HEAD 协调锁 + files-only + reftable fail-closed（2026-11-22 / R671-02）**：用目标 admin dir 的 `HEAD.lock`
  （`wx` 创建、marker 含 pid/时刻、finally 只在内容匹配时 unlink）覆盖检查→删除之间普通 Git 的 HEAD/引用变更；
  files backend 实测有效（F2），reftable 无效（F3），因此先用 `config --local --get extensions.refstorage` 探明
  后端：files/未设置放行，reftable 或其他非空值答 `not_supported` 并给人工 `git worktree remove` 出路，其他退出码
  `unavailable`（fail closed）。锁不覆盖工作树内容/索引写入与直接改 `.git` 文件（R2）。
- **D23 rename 原子性 = 可证写前失败的判据（2026-11-22 / R671-03 前置）**：`fs.rename` 失败是原子失败（零副作用，
  F5），按 errno 确定性分类：EACCES/EPERM → `permission_denied`、EXDEV → `invalid_input`、EBUSY/EMFILE/ENFILE →
  `unavailable`（retryable）、ENOENT/ENOTDIR → 重读登记后 `not_found`(+prune) 或 `unavailable`。`permission_denied`
  因此只保留给可证写前失败（锁/rename），不再用于可能部分生效的 remove。
- **D24 崩溃/中止残留契约（2026-11-22 / H3）**：① 锁后崩溃留下 `<admin>/HEAD.lock`，该工作树 commit/detach 被 Git
  拒绝，确认无 Git 进程后删除即可；② rename 后崩溃留下 `prunable` 登记与 `.harness-remove-*`，删除残锁后
  `git worktree repair <q>` 再 `git worktree remove <q>`，或 rename 回原路径再 repair；③ repair 后崩溃可直接
  `git worktree remove <q>`（remove 不读 HEAD.lock）。provider 不自动清理未知残留；回滚本批也不清理运行期残留。
- **D25 支持边界与人类裁决点 H1–H5（2026-11-22 / 独立 spec 评审）**：H1 `repair`/`remove` 末窗不可移植原子性——
  接受「隔离对象 + HEAD 锁 + 诚实分类」还是要求平台原生实现（新依赖、另立 issue）；H2 reftable 拒绝破坏性移除
  （建议 fail closed）vs 文档化降级；H3 崩溃/残锁契约（D24）；H4 `worktree repair` 需 Git ≥2.30（unknown
  subcommand → 回滚后 `not_supported`），锁/rename/ino/repair 仅 darwin 实测、Windows native lane 未覆盖；
  H5 ignored-only 数据损失面语义不变（D2），决策来源按 D20/D13 更正为 AI 协调者在授权内决定。残余风险 R1–R3
  写入 port JSDoc 与 Outcomes，不静默。
- **D26 最终验收与归档处置**（2026-11-22 / 非实现者独立验收）：独立验证 PASS WITH FINDINGS、无 P0/P1，R671-01..04 的
  关闭成立；P2-1（R1 末窗残余）与 P2-2（Windows / Git<2.30 平台证据缺口）不改变实现，作为已声明支持边界分别交人类
  裁决点 H1 与 H4（与 H2 同属平台/后端支持边界；H2 的 reftable fail-closed 已由 D22 落地，H3 崩溃契约见 D24，
  H5 见 D2/D13/D20）。P3 中 P3-1 在归档后回读可解析、P3-4 悬空引用就地清理、P3-2/P3-3/P3-5 记入 Surprises 22–24，
  均不改代码/测试；P3-6（PR 远端 head/正文/threads 陈旧）留待 push 后由执行者回读更新，本轮不 push、不 approve、不 merge。
- **D27 repair 非零的失败分类 = 反向 repair + 回读证明，否则 ambiguous（2026-11-22 / 评审方追加 P2，R671-05）**：
  `worktree repair` 非零可能已经改写 admin `gitdir`；只 rename 回目录不等于登记回滚。因此失败路径先反向 rename，
  再 `repair <target>` 并回读 `worktree list`：登记确实回到 target 且不再指隔离路径 → `invalid_input`（可证零内容删除）；
  反向 repair 失败/中断/回读失败 → `ambiguous_result`(retryable:false) 并在 message 报告隔离路径、目标、分支、登记实际
  位置与 `git worktree repair` / `prune` / `worktree add` 恢复步骤，删除旧的无证据「已回滚隔离目录，未删除任何内容」
  声明。unknown subcommand 仍属可证未执行 → 回滚后 `not_supported`。
- **D28 第二轮复验与最终收尾处置**（2026-11-22 / 非实现者验收，R671-05 后）：第二轮独立复验 PASS WITH FINDINGS、
  无 P0/P1，R671-05 关闭成立（8 场景/45 断言，回归 19 场景/120 断言 0 失败，M13–M18 6/6 KILLED，RED 复现 93/94）；
  评审方追加段以单独 `docs(review)` 提交原样收录（来源=评审会话追加、非实现者改写），不改写评审结论。P2 列表：
  P2-1 末窗 R1（H1）、P2-2 Windows / Git<2.30 证据缺口（H4）、P2-3 repair 不可证恢复时人工 reconcile。P3-N1/N2/N3
  如实记为残余且不改代码（代码余量 4 行）、P3-N4 M14 killedBy 按实测 5 红统一表述、P3-N5 体量余量记录。
  评审方 11:37 追加的「支持范围与工作项收尾判定」亦以文档提交原样收录：H1/H4 记为 AI 提出的支持边界与待验证
  项，不据此建立新的人类批准门；`Refs #138` 保持 OPEN，不另建重复 issue。不 push、不改 PR、不 approve、不 merge。

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
- **评审修复轮的崩溃/中止恢复（D24，同步写入 port JSDoc）**：① 锁后崩溃（未 rename）：残留
  `<admin>/HEAD.lock` 会让该工作树的 commit/detach 被 Git 拒绝，确认无 Git 进程后删除该文件，目录/登记/分支完好；
  ② rename 后崩溃（未 repair）：登记仍指原路径并 `prunable`，内容在允许根下 `.harness-remove-*`，删除残锁后
  `git worktree repair <q>` 再 `git worktree remove <q>`，或 rename 回原路径再 repair；③ repair 后崩溃（未 remove）：
  登记指 q，删除残锁后 `git worktree remove <q>`（remove 不读 HEAD.lock）；④ 真实部分删除后登记已消失、
  repair 不可重建，按 `ambiguous_result` message 的残留与恢复步骤人工处理。provider 不自动清理未知残留。
- **回滚本批不清理运行期残留**：`git revert` 只还原 tracked 代码；已产生的 `.harness-remove-*` 与 `HEAD.lock`
  按 D24 人工处理（不自动删除，避免把未知残留误判成自己的）。

## Interfaces and Dependencies

- **契约**：`DevelopmentProvider.removeWorktree?(input: ProviderRemoveWorktreeInput)` 与
  `CapabilityKey.DevelopmentWorktreeRemove = 'development.worktree.remove'` 已存在，本 PR 不改形状、不改 key、
  不改 `ProviderError`、不改共享套件；只新增实现、能力声明与 port JSDoc。
- **依赖方向**：provider 只依赖 `capabilities` 与 `domain`（`package-boundaries.test.js` 守卫），本 PR 不新增导入边。
- **Git**：argv-only；用到 `worktree list --porcelain -z`、`rev-parse`（含 `--git-path HEAD` / `--symbolic-full-name`）、
  `config --local --get extensions.refstorage`、`status --porcelain=v1 -z --untracked-files=normal`、
  `worktree repair`、`worktree remove`。`--no-optional-locks` 需 Git 2.15+；`worktree repair` 需 Git ≥2.30
  （unknown subcommand → 回滚后 `not_supported`）；不新增依赖或版本门。只写目标 admin dir 的 `HEAD.lock` 并只在
  内容匹配本进程 marker 时删除；reftable/其他非空 ref backend 显式 `not_supported`（D22）。锁/`rename`/dev-ino/
  `repair` 只在 darwin + Git 2.56.1 实测，Windows native lane 未覆盖。
- **Node/工具**：现有 `pnpm` scripts；无新包、无新服务、无凭据、不触网。
- **跨模块调用面**：core/controller/client/ui-model/ui/apps 零改动；`packages/core/src/registry.ts` 与
  `git-provisioning.ts` 不改；Host 组合不改。
- **测试依赖**：`tests/integration/local-git-fixture.js` 的 `providerFor`/`recordingRunner`/`fixtureFor`；
  共享套件通过 `tests/integration/development-local-git.test.js` 的 `localGitSuite` 自动接管移除往返。
- **外部事实**：Git 版本行为以复核时的实测为准；Windows 原生不在本 PR 证据面（见 Validation 的未验证项），
  评审修复轮新增的 HEAD 锁、`rename` 隔离、dev/ino 与 `worktree repair` 同样没有 Windows 原生证据。
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

### 评审修复轮与计划的偏差（2026-11-22）

（R671-05 追加修复：新增 T5 后 V2 期望由 93 改为 94；代码体量由 735 增至 796、仍 ≤800；V7 的
`'worktree','repair'` 由恰 1 变为恰 2（正向绑定 + 反向恢复），属于该修复的必要新增调用点；文档 `rule-checks size`
读数按提交 head 回读。）

- 实现顺序按 TDD：先改写/新增判别性用例并跑出 7 条真实红线，再实现判定链；因此 provider 的 `REFUSALS`
  删除了一行、`failureOf` 复用 `detailLine`，均属同批内聚改动。
- 变异 M14（跳过隔离）除 T5/T1 外还让 T3 与 fake-success 变红——这是旧「直接 remove」语义的真实连带结果，
  不是断言过宽；killedBy 只归因到首个失败用例，整表仍 KILLED。
- V2 期望从 89 改为 93（新增 T1–T4）；4 条「只注入 Git 拒绝文案」子例按评审要求删除，不计入新增。
- 临时反例探针（HEAD.lock / rename / reftable / 部分删除）只在 `/tmp` fixture 复跑作为证据，不入仓、不写本机路径。

### 与计划的偏差

- 批次数不变；新增用例 10 个（重写 1 个不计），V2 由 79 → 89；D14 调整了步骤 9–10 的实现批次（TDD 需要）。
- 无收缩项（detached、prunable、REFUSALS 注入等判别性子例全部保留）；实现期实测的 Git 行为（locked 文案两行、
  prunable remove exit 0、`showUntrackedFiles=no` 隐藏未跟踪）与计划一致。
- 归档期没有改变验收行为：只新增 port JSDoc 一句注释与 `:607` 一条 `createBranch` 返回值断言，其余为文档一致性
  修正（D19）。
- 独立验收的重构审查没有发现净收益改动：`removeWorktree` 的判定链与错误映射已按单一权威组织，重复的
  `Promise.all(samePath)` 只有三处且各处上下文不同，抽 helper 会一并改动既有 create/get 及其判别性用例，收益小于回归风险。

### 评审修复轮（Batch 5）判定与读数（2026-11-22）

**判定：R671-01..04 的实现与判别性回归已关闭；独立复评已由非实现者执行并通过（见下节「独立验证与最终验收」）；归档后按评审方 11:17 追加段完成 R671-05 修复（见「R671-05 追加修复读数」）。** 执行上下文：检出
`feature/worktree-clean-removal` 的工作树根目录；修复 head 以 `git rev-parse HEAD` 回读（本批唯一提交，不写死）。
命令定义见 Validation and Acceptance。

| 评审项 | 根因修复 | 判别回归（RED → GREEN） |
|---|---|---|
| R671-01 删除绑定准入对象 | `rename` 隔离到 `.harness-remove-<uuid>` + `(dev, ino)` 对象锚 + 不符回滚（D21） | T1：旧实现 `ok:true` 删除替身 → 现 `invalid_input`、替身逐字节不变、被移走对象完整、登记仍指 target、零 repair/remove argv |
| R671-02 detached 守卫延伸到删除边界 | files backend `HEAD.lock` 全窗持有 + 锁内身份复验；reftable 显式拒绝（D22） | T2：旧实现 detach exit 0 并产生独有提交 → 现 `cannot lock ref 'HEAD'`、移除仍 `ok`、分支头不变、无不可达提交 |
| R671-03 部分删除不得普通权限拒绝 | remove 非零一律 `ambiguous_result` + 隔离残留/登记观察/恢复步骤（D23） | T3：旧实现 `permission_denied` 且登记消失 → 现 `ambiguous_result`、q 保留 `.git` 与只读文件、登记不含 target/q、分支保留、二次 `not_found` |
| R671-04 决策来源 | 文档更正 D13 与「剩余风险 1」为 AI 协调者在授权内决定（D20/D25） | 本计划 diff：授权原话保留，技术结论不变 |
| backend 支持边界 | reftable → `not_supported`（D22） | T4：旧实现 `ok:true` 删除 → 现 `not_supported`、树/登记逐字节不变、零破坏性 argv、无锁残留 |
| R671-05 repair 失败登记回滚不可证明 | `repair` 非零先反向 rename + 反向 `repair <target>` + 回读登记；证明不了则 `ambiguous_result` + 恢复读数（D27） | T5：旧实现只 rename 回目录并声称「已回滚隔离目录，未删除任何内容」→ 现可证恢复答 `invalid_input`（含回读依据）、不可证答 `ambiguous_result`（message 含隔离路径/目标/分支/登记实际位置）；M18 钉住 |

**修复轮实际读数**（本机 darwin / Git 2.56.1，load 正常）：

| 命令 | 结果 |
|---|---|
| V1 `pnpm run typecheck` | exit 0 |
| V2 `pnpm test:file tests/integration/development-local-git.test.js` | RED：tests 93 / pass 86 / fail 7；GREEN：tests 93 / pass 93 / fail 0 / skipped 0 |
| V3 `pnpm test:file tests/contract/development-contract.test.js` | tests 96 / pass 96 / fail 0 |
| V4 `pnpm test:file tests/e2e/repository-routing.test.js` | tests 21 / pass 21 / fail 0 |
| V5 `pnpm run boundaries` | tests 10 / pass 10 / fail 0 |
| `node --test tests/contract/development-local-git-source.test.js` | 1 / pass 1 |
| V7 结构 grep | `.removeWorktree(` 零调用点（exit 1）；`'worktree','remove'` 恰 1；`'worktree','repair'` 恰 2（R671-05 后正向绑定 + 反向恢复）；`'worktree','move'` 0 |
| M13–M18 变异 | 6/6 KILLED（M13→T2；M14→实测 5 红：干净往返 T5、T1 替身、T3 部分删除、fake-success、R671-05 的 T5，T2 与 ignored-only 未红；M15→T3；M16→T4；M17→T1；M18→R671-05 的 T5） |

V6/V8 的最终读数见下方「修复轮最终门禁」表（提交前在最终工作树复跑；中间读数不写成最终事实）。
R671-05 追加修复的读数见「R671-05 追加修复读数」小节。

### 修复轮最终门禁（提交前复跑）

| 编号 | 命令 | 结果 |
|---|---|---|
| V6 | `node scripts/rule-checks.mjs size origin/main`；`disclosure origin/main`；`git diff --check origin/main...HEAD` | 代码 735 / 800、文档 860 / 1300；disclosure「机械扫描通过」；diff-check 无输出（提交后在 head 上复跑确认） |
| V8 | `pnpm verify` | exit 0：contract 1625/1625、integration 2327/2355（skipped 28）、e2e 226/226 |
| 独立复评 | 由非实现者在修复 head 上复跑 V1–V8、T1–T4、M13–M17 | 已完成：PASS WITH FINDINGS、无 P0/P1（见下节）；通过后才 push/回复评审 |

### R671-05 追加修复读数（2026-11-22，归档后）

**判定：R671-05 关闭。** 执行上下文：检出 `feature/worktree-clean-removal` 的工作树根目录；head 以 `git rev-parse HEAD` 回读
（本次为归档提交后的独立 `fix(provider)` 提交，不改先前提交、不 push）。

| 命令 / 变异 | 结果 |
|---|---|
| V2 `pnpm test:file tests/integration/development-local-git.test.js` | RED（旧实现）：tests 94 / pass 93 / fail 1（「必须给出恢复依据，而不是空口声称已回滚」）；GREEN：tests 94 / pass 94 / fail 0 / skipped 0 |
| V1 / V3 / V4 / V5 | 依次 exit 0 / 96/96 / 21/21 / 10/10 |
| V8 `pnpm verify` | exit 0：contract 1625/1625、integration 2328/2356（skipped 28）、e2e 226/226 |
| M13–M18 变异 | 6/6 KILLED（新增 M18→T5） |
| V6 `rule-checks size origin/main` | 代码 796 / 800、文档 1001 / 1300（该提交 head 实测）；评审追加段与最终计划订正收录后的最终读数见下节「第二轮复验与最终收尾」；disclosure 通过；`git diff --check` 无输出 |

### 独立验证与最终验收（第一轮，2026-11-22）

**独立验证判定（非实现者，对抗验证）：PASS WITH FINDINGS，无 P0/P1。** R671-01..04 的修复与判别性回归独立成立：
19 个攻击场景 / 120 条断言 0 失败；把评审 head 的实现临时换回可复现「修复前红」（15 条目标集 pass 8 / fail 7，
与 Progress 声称的红线一致），M13–M17 5/5 KILLED 且归因正确；每轮变异后逐字节还原，最终 `git status --short` 空、
HEAD 未变、无新提交。2 条 P2 是已声明残余/平台证据缺口，4 条 P3 是文档/分类小项（处置见下）。

**最终验收复跑**（2026-11-22，检出 `feature/worktree-clean-removal` 的工作树根目录，head 以 `git rev-parse HEAD`
回读：最终归档提交；命令定义见 Validation and Acceptance）：

| 编号 | 命令 | 最终读数 |
|---|---|---|
| V1 | `pnpm run typecheck` | exit 0，无错误输出 |
| V2 | `node --test tests/integration/development-local-git.test.js tests/contract/development-local-git-source.test.js` | tests 94 / pass 94 / fail 0 / skipped 0（集成 93 + 源扫描 1；≈5.4s） |
| V3 | `node --test tests/contract/development-contract.test.js` | tests 96 / pass 96 / fail 0 / skipped 0（≈10.3s） |
| V4 | `node --test tests/e2e/repository-routing.test.js` | tests 21 / pass 21 / fail 0 / skipped 0 |
| V5 | `pnpm run boundaries` | tests 10 / pass 10 / fail 0 / skipped 0 |
| V6 | `node scripts/rule-checks.mjs size main`；`disclosure main`；`git diff --check main...HEAD` | 代码 735 / 1000、文档 953 / 1500（本轮用户预算 800 / 1300，均在限内）；disclosure「机械扫描通过」；diff-check 无输出 |
| V7 | `.removeWorktree(` 跨包 grep；`'worktree','remove'/'repair'/'move'` grep | 零调用点（exit 1）；remove 恰 1、repair 恰 1、move 0（均在 `provider.ts` 的 `removeWorktree` 内） |

独立验证另外复跑过 V8 `pnpm verify`（exit 0：contract 1625/1625、integration 2327/2355 且 skipped 28 / fail 0、
e2e 226/226）与 `development-local-git-source.test.js` 1/1；最终验收按本轮任务命令集未重跑全量 `pnpm verify`，
不把验证者的 V8 读数当作本轮自身读数。

**P2 处置（已声明支持边界与人类裁决点，不改变实现）**

- **P2-1 末窗残余 R1**：对象复核 → `repair` → `remove` 之间仍有非协作文件系统写者可替换隔离目录（随机名不构成
  保护）；provider 诚实答 `ambiguous_result` 而绝不报 `ok`，被删对象的分支/提交仍可从 refs 恢复，ignored/未提交面
  不可恢复。对应人类裁决点 **H1**（接受「隔离对象 + HEAD 锁 + 诚实分类」，或要求平台原生原子实现另立 issue）。
- **P2-2 平台证据缺口**：Windows native lane 只跑既有路径准入用例（`minTests` 15），不覆盖新增 HEAD 锁 / `rename` /
  dev-ino / `worktree repair`；Git <2.30 只按 `unknown subcommand → not_supported` 分类、未实测；reftable 只验证
  fail-closed 拒绝、不验证移除。对应人类裁决点 **H4**（与 **H2** 同属平台/后端支持边界；H2 的 reftable 决策已由
  D22 fail-closed 落地）。

**人类裁决点 H1–H5 状态**

| 裁决点 | 状态 | 证据/位置 |
|---|---|---|
| H1 末窗不可移植原子性 | AI 提出的支持边界（残余 R1 已显式声明）；当前实现按「隔离 + 锁 + 诚实分类」交付，不据此建立新的人类批准门，正式判定留人类 | 剩余风险 4、D21、D25、D28 |
| H2 reftable 拒绝破坏性移除 | 已按 fail-closed 实现（人工 `git worktree remove` 出路）；人类仍可改为文档化降级 | D22、T4 |
| H3 崩溃/残锁契约 | 已写入 port JSDoc、`Idempotence and Recovery` 与 D24；provider 不自动清理未知残留 | D24 |
| H4 Git ≥2.30 / Windows 证据缺口 | 未原生验证，作为已声明支持边界保留（只按 unknown subcommand 分类）；属 AI 提出的待验证项，不另设批准门 | 剩余风险 2、Validation 的未验证项、D28 |
| H5 ignored-only 语义与决策来源 | 语义不变（D2）；来源已按 R671-04 更正为 AI 协调者在授权内决定，人类未逐项点名批准，不重复请求批准 | D2、D13、D20 |

**P3 处置（验证报告）**

| P3 | 处置 |
|---|---|
| P3-1 两处历史计划 Superseded 链接 404 | 本计划归档回 `completed/` 后，两处链接（`2026-09-24-local-git-worktree.md:799`、`2026-09-26-development-suite-capability-driven.md:191`）指向的 `completed/2026-11-21-worktree-clean-removal.md` 已存在并回读可解析；`docs/README.md` 索引同步移入 Completed。两处链接原本就指向 `completed/`，无需改成 active。 |
| P3-2 替换物分类为 `not_found` | 记入 Surprises 22；零破坏性动作、外来内容逐字节保留，不做语义改动。 |
| P3-3 R3 外部 move 分类为 `unavailable` | 记入 Surprises 23；无破坏性动作，message 改进留作后续打磨。 |
| P3-4 悬空「人体裁决点 1/2/3」引用 | D2/D3 就地改为对 D13 Q1–Q5、D20 与 H5 的确定引用。 |
| P3-5 runner 抛异常直接 reject | 记入 Surprises 24；锁在 `finally` 释放、树/登记完好，默认 runner 不抛，不改契约。 |
| P3-6 PR 远端 head/正文/threads 陈旧 | 预期内：本轮不 push、不改 PR；push 后由执行者按 `docs/review/responding.md` 回读 head/base/checks/threads 再逐条回复。 |

**验证范围限制（不声称超出证据）**：本轮只在 darwin / Git 2.56.1 实测；Windows 原生、Git <2.30、reftable 仓库的
破坏性移除均未验证，只验证了对应的拒绝/分类路径。R671-04 的来源更正不构成人类批准；H1/H4 是 AI 提出的支持边界/待验证项，不据此建立新的人类批准门，正式 R1 判定与发布接受仍属人类。

### 第二轮复验与最终收尾（2026-11-22，R671-05 后）

**判定：第二轮独立复验 PASS WITH FINDINGS，无 P0/P1；R671-05 关闭成立。** 执行上下文：检出
`feature/worktree-clean-removal` 的工作树根目录；审查对象为 R671-05 的 `fix(provider)` 修复与其后的文档读数提交；
独立验证未 push、未改 PR、未 approve/merge。

| 项 | 独立读数 |
|---|---|
| R671-05 攻击（8 场景 / 45 断言） | 0 失败：已改写 admin `gitdir` 后反向 repair 真实执行 → `invalid_input` 并说明回读依据、随后可成功移除；反向 repair 谎报 0 / 真实失败 → `ambiguous_result`(retryable:false) 且 message 与实际登记一致；repair 未写登记 → `invalid_input`；unknown subcommand → `not_supported`；反向 rename 被阻断 → 诚实 `ambiguous_result`（P3-N1）；X1–X3 无越界动作 |
| R671-01..04 回归 | 上轮 19 场景 / 120 断言在新 head 复跑 0 失败；S18 的 R1 残余仍为已声明行为（provider 绝不报 ok） |
| RED 复现 | 把 `16defe1d` 旧 provider 临时换回、94 条用例全跑 → pass 93 / fail 1，唯一失败即 R671-05 的 T5；随后逐字节还原（sha256 一致） |
| 变异 M13–M18 | 6/6 KILLED；M14 实测 5 红（干净往返 T5、T1、T3、fake-success、R671-05 T5），T2 与 ignored-only 未红；其余各 1 红（M13→T2、M15→T3、M16→T4、M17→T1、M18→R671-05 T5） |
| V1–V5 + 源扫描 | typecheck exit 0；集成 94/94、契约 96/96、e2e 21/21、boundaries 10/10、源扫描 1/1 |
| V6 | 代码 796 / 1000（用户上限 800，余 4 行）、文档 1001 / 1500（用户上限 1300，余 299）；disclosure 通过；diff-check 无输出 |
| V7 | `.removeWorktree(` 零调用点；`'worktree','remove'` 恰 1；`'worktree','repair'` 恰 2（正向绑定 + 反向恢复）；move 0 |
| V8 | 验证者复跑 `pnpm verify` exit 0：contract 1625/1625、integration 2328/2356（skipped 28）、e2e 226/226（本轮最终验收命令集不含全量 verify，不把它当作本轮自身读数） |

**最终收尾读数**（本次验收在最终内容上真实运行；最终 head = 本订正提交，其父 `03c60b7d` 收录评审追加段）：

| 编号 | 命令 | 最终读数 |
|---|---|---|
| V1 | `pnpm run typecheck` | exit 0，无错误输出 |
| V2 | `node --test tests/integration/development-local-git.test.js` | tests 94 / pass 94 / fail 0 / skipped 0 |
| V3 | `node --test tests/contract/development-contract.test.js` | tests 96 / pass 96 / fail 0 / skipped 0 |
| V4 | `node --test tests/e2e/repository-routing.test.js` | tests 21 / pass 21 / fail 0 / skipped 0 |
| V5 | `pnpm run boundaries` | tests 10 / pass 10 / fail 0 / skipped 0 |
| V6 | `node scripts/rule-checks.mjs size main`；`disclosure main`；`git diff --check main...HEAD` | 代码 796 / 1000、文档 1128 / 1500（用户预算 800 / 1300，均在限内；含发布前口径对齐增量）；disclosure「机械扫描通过」；diff-check 无输出 |
| V7 | `.removeWorktree(` 跨包 grep；`'worktree','remove'/'repair'/'move'` grep | 零调用点（exit 1）；remove 1、repair 2、move 0 |

**P2-N 处置**：评审方追加段不是实现者可改的代码，也不能留在未提交状态——已以两个单独的 `docs(review)` 提交
`03c60b7d`（「候选技术核对」+「repair 修复的独立核对」）与 `7551b60b`（「支持范围与工作项收尾判定」）原样收录，
来源=评审会话追加、非实现者改写；不改写评审结论，工作树因此干净。收尾判定按评审方记录执行：`Refs #138` 保持
OPEN、不另建重复 issue、不以合并推导发布接受。

**P3-N 记录（第二轮）**

| P3-N | 处置 |
|---|---|
| N1 反向 rename 失败 message 缺分支/登记实际位置/恢复步骤 | 记入 Surprises 26；分类诚实、无虚假回滚，代码余量仅 4 行，本轮不改代码，记为残余。 |
| N2 unknown subcommand「登记未被修改」依赖版本门而非回读 | 记入 Surprises 27；真实 Git <2.30 写前退出时成立，风险仅限非真实 Git 语义。 |
| N3 可证恢复仍答 ambiguous（过度保守） | 记入 Surprises 28；与 D27 契约一致、无数据风险，留后续打磨。 |
| N4 M14 killedBy 枚举与实测不一致 | 已按实测 5 红订正「修复轮实际读数」表并统一表述（不影响 M14 KILLED 结论）。 |
| N5 代码体量余 4 行 | 记入 Surprises 29；后续任何代码修复必须先按计划收缩顺序腾量。 |

**残余与支持边界总表**：P2-1 末窗 R1 → H1（AI 提出的支持边界，不另设批准门）；P2-2 Windows / Git<2.30 未原生验证 → H4（已声明支持边界/待验证项）；
P2-3 repair 不可证恢复时人工 reconcile（剩余风险 7；依赖回读证明、不覆盖 Git 内部半写，不可移植原子性归 H1）；
P3-N1/N2/N3 为已记录分析残余（不改代码）；H1–H5 状态见上表与 D25/D28。H2/H3/H5 已按 D22/D24/D2·D13·D20 落地；
H1/H4 记为 AI 提出的支持边界/待验证项，不据此建立新的人类批准门，正式 R1 判定仍属人类，本轮不构成批准。
未验证范围不变：Windows 原生、Git <2.30、reftable 破坏性移除均未实测，不声称可用。

### 剩余风险（P2，已记录、不在本 PR 修复）

1. **ignored-only 的数据损失面（D2/D13 是 AI 协调者在人类授权范围内作出的工程选择，已文档化；人类未逐项点名批准）**：Git 口径下只有被忽略内容（`.env`、
   `node_modules/`）的工作树算干净，显式移除会把它们一起删除，当前没有任何产品入口或二次确认；shipped 用例
   「Git 口径下只有被忽略内容的工作树视为干净，显式移除会删除被忽略内容」钉住该语义。**建议**：在出现产品入口
   （core 命令 / UI 按钮）之前另开 **safe/discard 或显式确认** 的后续 issue（如 `mode: safe | discard` +
   结构化 blocked reasons + `overrideLock`），不在本 PR 实现、不新建 issue。
2. **Windows 原生证据缺口（验证报告 P2-2；人类裁决点 H4）**：本组新增的 10 个移除用例（另加 1 条改写的「能力子集」断言）的判别证据只在 darwin
   产生；`.github/workflows/ci.yml` 的 Windows Native lane 只跑 `development-local-git-windows.test.js`（路径准入）
   等既有文件，不含本组用例。Windows 上句柄释放延迟可能让「写后回读」把成功报成 `ambiguous_result`（诚实但可能
   误报）。Git <2.30 只按 `unknown subcommand → not_supported` 分类、未实测；reftable 只验证 fail-closed、不验证移除。
   **建议**：后续把移除用例加入 Windows lane 的 SETS，或至少补一条 Windows 路径/argv 冒烟，作为独立 issue
   的证据工作。
3. **`removeWorktree` 接受相对 `externalId`**（D18）：不是越权通道，但调用方若把相对路径当 canonical id，会得到
   `not_found` 或删到同允许根内的另一份登记；已记录，不改语义。
4. **R1 末窗对象替换（评审修复轮新增、已文档化；验证报告 P2-1）**：`repair`/`remove` 之间仍有非协作文件系统写入者可把隔离目录换掉
   （随机名不构成保护）；Node 无 handle-relative 删除、Git CLI 只收路径，因此 remove 仍可能删到非准入对象。这是
   H1 的显式裁决点（接受隔离+锁+诚实分类，或要求平台原生原子实现另立 issue），不静默。
5. **R2 HEAD 锁不覆盖内容/索引写入**：锁只阻止普通 Git 改 HEAD/引用；工作树内容与索引的并发写入、直接改 `.git`
   文件都不在协调面内，干净门之后的外部编辑仍可能被一起删除。
6. **R3 外部 worktree lock/move 可在窗口改登记**：外部 `git worktree lock/move` 可在检查与删除之间改变登记，
   provider 在 remove 非零时如实答 `ambiguous_result`，不把不确定报成成功。
7. **P2-3 R671-05 的失败分类依赖回读证明（追加修复、已文档化；不可证恢复时人工 reconcile）**：`repair` 非零时只有反向 `repair` + 回读登记能证明
   恢复才答 `invalid_input`；证明不了（反向 repair 失败/中断/回读失败）仍答 `ambiguous_result`，需要人工
   `git worktree repair <target>` / `git worktree prune` 收尾。判别回归用「真实改写 admin `gitdir` + 注入 repair 失败」
   复现，不声称覆盖 Git 内部半写；该窗口的不可移植原子性仍归 H1。
8. **P3-N1/N2/N3 分析残余（第二轮复验记录，不改代码）**：N1 反向 rename 失败时 message 缺分支/登记实际位置/
   `repair`+`prune` 恢复步骤；N2 unknown subcommand 的「登记未被修改」依赖版本门而非回读；N3 可证恢复时仍答
   `ambiguous_result` 的过度保守。三者均无数据风险、分类诚实，受代码余量 4 行限制留后续（详见 Surprises 26–28）。
9. **P3-N5 代码预算余量只剩 4 行**：最终 796/800；后续任何代码修复先按计划收缩顺序腾量，文档增量不计入代码口径。

### 其它遗留

- Ready 上下文旧句柄 #211 仍未处理（D13/Q5 明确不在本 PR 范围）。
- 本 PR 不产生产品入口 / UI 可观察面，只在能力快照与 provider 契约层可观察；PR 描述需写明（见 Validation 的未验证项）。
- PR #671 描述的「真实验证证据」仍是 draft 占位（评审修复轮验证报告 P3-6），须由 Lead 在 push/ready 前回填，
  并回读远端 head/base/checks/threads 后逐条回复评审；本 subagent 按任务约束不改 PR 描述、不 push。

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
- 2026-11-22 / 评审修复轮：按 PR #671 的 REQUEST_CHANGES（R671-01..04）重开本计划，新增 Batch 5；评审文档随 PR 提交；
  决策出处按 R671-04 更正为 AI 协调者决定。最终方案改为「隔离对象 + HEAD 协调锁 + 观察式分类」，写入 D21–D25；
  Batch 5 步骤、Surprises 17–21（F2/F3/F9/F10/F11）与 Progress 的真实 RED→GREEN 读数同步回填；Outcomes 增
  R671-01..04 关闭证据与 R1–R3 残余；header/Global Constraints 自引用改为当时的 `active/` 位置（最终归档后
  本文件位于 `completed/`）、规模口径保持 800/1300。
- 2026-11-22 / 最终独立验收与归档（非实现者）：独立验证 PASS WITH FINDINGS、无 P0/P1；在归档 head 上复跑
  V1–V7 与源扫描（读数见 Outcomes「独立验证与最终验收」），size 代码 735 / 用户预算 800、文档 953 / 1300。
  处理 P3-1（两处历史 Superseded 链接在归档后回读可解析）、P3-4（清理 D2/D3 悬空「人体裁决点」引用）；
  P3-2/P3-3/P3-5 记入 Surprises 22–24，P3-6 留 push 后回读。P2-1/P2-2 记为已声明支持边界与人类裁决点 H1/H4，
  不改变实现；计划移入 `docs/exec-plan/completed/`，`docs/README.md` 索引移到 Completed 并保留评审修复轮说明。
  不 push、不改 PR、不 merge。
- 2026-11-22 / 归档后追加 R671-05 修复（评审方 11:17 追加 P2）：`repair` 非零时登记可能已被改写，失败分类改为
  「反向 rename + 反向 `repair <target>` + 回读登记」证明恢复，否则 `ambiguous_result` 并给实际读数与恢复步骤（D27）；
  新增 T5、M18，读数与残余记入 Outcomes 与 Progress。计划已在 `completed/`（由验收 agent 归档），本次只追加记录，
  不改归档结论；新增独立 `fix(provider)` 提交，不 amend 先前提交、不 push。
- 2026-11-22 / 第二轮复验与最终收尾（非实现者）：第二轮复验 PASS WITH FINDINGS、无 P0/P1，R671-05 关闭；把评审方
  「候选技术核对」追加段作为单独 `docs(review)` 提交原样收录（来源=评审会话追加、非实现者改写）；订正 M14 killedBy
  为实测 5 红、补 P3-N1/N2/N3 残余与 P3-N5 体量记录、残余表增加 P2-3、D28 与第二轮读数回填；最终在内容上复跑
  typecheck / 集成 94/94 / 契约 96/96 / e2e 21/21 / boundaries 10/10 与 size（代码 796、文档 1115，均在本轮
  预算 800/1300 内）、disclosure、diff-check。评审方两段追加（候选技术核对、支持范围与收尾判定）分别以
  `docs(review)` 提交原样收录；H1/H4 记为 AI 提出的支持边界/待验证项，不另设批准门，`Refs #138` 保持 OPEN。
  不 push、不改 PR、不 approve、不 merge。
- 2026-11-22 / 发布前文档口径对齐（非实现者）：按评审方发布文案核对清单把计划的提交口径从 Closes 改为
  `Refs #138`（#138 保持 OPEN）；`docs/review/README.md` §8 补 PR #671 记录行，`docs/project-management/merge-queue.md`
  本批补 #672 已合入（main `4907adaa`，base `57a0f517`）、#671 改为「修复已回传、待复审（Refs #138 保持 OPEN）」、
  保留 #670/#673 现状；最终门禁在收尾 head 上复跑（size 代码 796、文档 1128）。不 push、不改 PR。


### 归档后 Linux CI 测试口径修正（2026-11-22）

发布 head `95962b2f` 的 Verify job `137091156185` 只在部分删除回归的 `.git` 残留断言失败（ENOENT）；Git 不保证递归删除失败时保留哪些可删除项。评审协调者按人类本轮“无 P0/P1 后负责后续修复”的直接授权接手此 P2 测试修正，原实现团队停止分支写入。删除非契约 gitfile 残留断言，把受保护用户文件的存在断言加强为内容相等；真实 0555 故障、ambiguous/retryable、隔离/原路径、登记、分支头、恢复消息和二次调用断言均保留。生产代码不变，不按平台 skip，不改用 mock。当前 Linux head 必需门通过前不宣告最终放行。

本地修正后 local-git 集成 94/94，通过；独立测试 diff 复核确认承重断言完整。生产 blob 保持 `1299a5dcfd13951f14f96871f134097a8581eb17`。后续按原任务授权把过程历史整合为可独立回滚的能力提交，保留恢复引用、完整树等值与精确 lease；最终 Linux CI/当前 head 证据在合并前回读。
