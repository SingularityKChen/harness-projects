# 本地 Git 工作树与分支 provider ExecPlan

> 状态：Active
> 创建：2026-09-24
> 范围：#137 —— 让本机真的出现 worktree 与 branch，且路径安全在**任何 Git 命令之前**生效；只实现 Development 能力域的本地子集。**第四轮后本计划只覆盖 provider 自身**：共享契约套件的能力驱动拆到 **#205**（PR 基线 `main`，已合入），接进 core 供应序列的验收拆到 **#207**（叠加在本层之上）。**第五轮起本计划只修路径安全的判据与文档**：三族根因里两族的根在 core，见「系统级根因分析」（#212 / #213 / #214）。
> 上游输入：`docs/product/vertical-path.md` §2 步骤 7、`packages/capabilities/src/development-provider.ts`、`packages/core/src/git-provisioning.ts`、`tests/contract/suites/development.js`、`AGENTS.md` §7、issue #205 / #207 / #138 / #206 / #212 / #213 / #214、ADR-0007。

## Purpose / Big Picture

完成后，`packages/providers/development-local-git` 不再是占位包：它按 Development 契约提供**本地子集**——
仓库识别、分支创建、工作树创建——并且是本机唯一会在真实文件系统上产生 worktree / branch 的
provider。`packages/core/src/git-provisioning.ts` 的 `provisionGit` 可以在不改一行的情况下用它跑通
「工作项 + 仓库 → 分支 + 工作树」这一段（`docs/product/vertical-path.md` §2 步骤 7）。工作树**移除**不在
本层（`#137` 的 Out of scope，由 `#138` 交付，见 §3）。

判断成功的最小证据有三条，缺一条都不算完成：

1. 在一个临时仓库上调用 `createWorktree`，`git worktree list` 真的多出一条、`git for-each-ref refs/heads`
   真的多出一个分支；
2. 越界路径、含 `..` 的路径、经符号链接逃逸的路径三类都被拒，且注入的 Git 调用记录器显示**零次调用**；
3. 契约套件对「未声明的能力」断言结构化 `not_supported` 且无副作用，而不是跳过用例——把子集开关接到
   全能力的替身上时，套件必须变红。

## Context and Orientation

术语与现状（全部在本次执行中读过代码核实）：

- **Development 契约**（`packages/capabilities/src/development-provider.ts`）：必选
  `describeCapabilities` / `getRepository` / `listBranches` / `getCommit` / `getChangeRequest` /
  `listChangeRequests`；可选 `createBranch` / `createWorktree` / `createChangeRequest` /
  `removeWorktree` / `reconcile`。`packages/capabilities/src/registry.ts` 用 `DevelopmentProviderSurface`
  把成员锁成编译期契约：方法只能有这些名字，不能多也不能少。
- **capability key 表**（`packages/capabilities/src/capability-keys.ts`）：Development 域有
  `development.repository.read`、`development.branch.create`、`development.worktree.create`、
  `development.change_request.read`、`development.change_request.create`、`development.review.read`。
  **没有** worktree 移除的键。
- **错误模型**（`packages/domain/src/errors.ts`）：provider 错误码是**恰好 8 个**的闭集
  （`not_supported` / `permission_denied` / `not_found` / `conflict` / `rate_limited` / `unavailable` /
  `invalid_input` / `ambiguous_result`），由 `tests/contract/capabilities-errors.test.js` 逐字钉死。
  新增一个码就是跨层契约变更。
- **core 调用方**（`packages/core/src/git-provisioning.ts`）：`provisionGit` 先 `ensureBranch` 再
  `ensureWorktree`；`createBranch` 的 `conflict` 会走 `branchProbe` 当作「已存在」复用，`createWorktree`
  的 `conflict` 直接当作复用。也就是说**幂等复用发生在 core**，provider 层同一路径重复创建必须报 `conflict`。
- **契约套件**（`tests/contract/suites/development.js`）：目前**假设 provider 能力齐全**——无条件调用
  `createWorktree` / `removeWorktree` / `createChangeRequest`。`removeWorktree` 也被它当作 Development
  契约的一部分（「工作树创建后可定位，移除后查不到」）。
- **`AGENTS.md` §7**：worktree 路径交给 Git 之前必须规范化为 realpath，拒绝 `..` 穿越、逃逸允许根目录和
  未经允许的符号链接；Git 用 argv / library API，不拼 shell 字符串。
- **发布面**（`docs/development/publication.md`）：本仓库 public，任何仓库文件里不写凭据、本机身份、
  账号信息、内部系统与本机绝对路径。允许根目录与临时仓库路径**只由构造参数注入**，测试用 `mkdtemp`。
- **沙箱事实**：本机 `pnpm` 必须带 `npm_config_manage_package_manager_versions=false` 前缀，否则会去下载
  pin 的 `pnpm@10.28.2` 并死在临时目录。这是本机沙箱事实，不改 `.npmrc` / `package.json`。

## Design / Spec

### 1. 能力子集：本地 Git 没有远端，就没有变更请求

`describeCapabilities()` 只声明三个键：`development.repository.read`、`development.branch.create`、
`development.worktree.create`（后两个可被构造参数关掉，用于套件的「未启用能力」场景）。

`getChangeRequest` / `listChangeRequests` **存在**（端口必选方法）但一律返回结构化 `not_supported`，
并且**在任何 Git 调用之前**返回，因此无副作用。理由是事实而不是偷懒：本地 Git 没有远端对象，
伪造一个变更请求等于造出第二个权威源（`AGENTS.md` §1.1 不变量 6）。

判定顺序：**未声明的能力先于身份闸门**。对本地 provider 来说，变更请求能力整体不存在，所以对任何输入
（包括外来 binding 的引用）都回答 `not_supported`；调用方拿到的结论与输入无关，这才是诚实的回答。
已声明的能力则先过身份闸门（`not_found`），再校验输入。

### 2. 契约套件改为能力驱动，且「未声明」不是「跳过」

> **Superseded by #205（2026-09-26）**：本节描述的套件改动已拆成以 `main` 为基线的独立 PR（`test/development-suite-capability-driven`，issue #205），并新增 `development.worktree.remove` 键让破坏性移除可声明。本层只**使用**那套套件，不再修改它。原文保留如下。

`provides` 不再由适配器自报：套件从 `describeCapabilities()` 推导子集（第二轮评审 [5]）。未声明的
能力走另一条分支：断言方法**存在**、返回 `not_supported`、`retryable === false`、且不产生任何对象；
方法缺失时由能力快照表达为 `unavailable`。**绝不 return 掉整条用例**——跳过会让子集 provider 的假绿
变得不可见。套件还**无条件**调用两次 `expect.objects(provider)` 钩子、中间做一次已知写入，要求两次
快照不相等——新鲜快照由套件而不是适配器证明（第二轮评审 [6]）。

双向断言：方法成功时必须声明对应能力 `available`（`repository.read` / `branch.create` /
`worktree.create`），快照 `available` 时方法必须可用（第三轮评审 [15]）。变异 M6（让本地 provider 的
`describeCapabilities` 漏掉 `worktree.create`）→ 套件的「工作树创建后可定位」与适配器专属用例变红。

### 3. `removeWorktree` 不在本层实现

> **Superseded by 第四轮评审响应（2026-09-26）**：本节结论被推翻——本层**不再实现** `removeWorktree`，也不声明 `development.worktree.remove`。原因：issue #137 的 Out of scope 明确写了它；`git worktree remove` 不带 `--force` 会把**被忽略的文件**（`.env`、`node_modules/`）连同目录一起删掉，也能删掉允许根下任何干净的人工工作树；`git grep removeWorktree -- packages apps` 在 core 与宿主里零调用方；它还是体量超限的主要来源。后续由 **#138** 按「仅显式请求、仅干净工作树」交付，安全/丢弃分层（`mode: safe | discard`、`overrideLock`、结构化返回被阻止的原因）记在 #138 的验收里。原文保留如下。

issue #137 的 Out of scope 写着「Removing worktrees (separate sub-issue)」，但：

- 契约套件把「工作树创建后可定位，移除后查不到而不是静默成功」当作 Development 契约的一部分；
- capability key 表里**没有** worktree 移除的键，实现移除只需要 `git worktree remove` + `prune` 两条 argv，
  而新增一个跨层 capability key 要动 `packages/capabilities`（本层硬约束禁止）、`effectiveCapabilities`
  的调用方判定与契约测试。第二轮评审后又删掉了成功后的 `git worktree prune`（git 自己已清理登记），
  现在只发 `git worktree remove` 一条 argv。

两条路里实现移除的面更小，因此本层实现它，并复用 `development.worktree.create` 作为它归属的能力键
（「能创建就能清理」这一对在本层同生共死）。这是**有意偏差**，写进 `Decision Log` 与 PR 描述的
「与 issue 的偏差」一节。

### 4. 路径安全：顺序固定，允许根与目标走同一套规范化

拒绝顺序（每一步都在 Git 之前）：

1. **字符串层面**：空值 / 全空白 → 拒绝；含控制字符 → 拒绝；含 `..` 分量 → 拒绝。
2. **规范化**：目标与允许根都做「最近存在祖先 realpath + 拼回不存在的尾部」。叶子与中间目录允许尚不
   存在（`git worktree add` 会创建它们）；允许根自身也允许不存在——core 的默认工作树根
   `<repo>/.worktrees` 在新仓库里就不存在（第三轮评审 [1]）。不可访问（非 ENOENT / ENOTDIR）转成
   结构化 `unresolvable`，不抛裸异常。
3. **悬空符号链接**：目标没有完全存在时，逐分量 `lstat` 尚未存在的尾部；命中符号链接即拒绝。悬空链接
   对 `stat` 不可见，不这样判的话拒绝会来自 `git worktree add` 的 already exists，而不是路径判定
   （第三轮评审 [12]）。
4. **落在允许根内判定**：规范化后的允许根与最终路径做 `path.relative`，以 `..` 开头或为绝对路径都拒绝。
   symlink 逃逸在第 2 步展开后被这一步抓住。
5. **然后才调用 Git**，并且**只用第 4 步得到的最终路径**——规范化与判定之间不再出现调用方传入的字符串。

允许根由构造参数注入，默认取 `<repo>/.worktrees`（最小权限，第三轮评审 [13]）。provider 返回的 `path` 与工作树 `ref.externalId` 都是
**规范化后的绝对路径**（canonical）：调用方拿到的身份在符号链接存在时仍然稳定，`removeWorktree` 也
不需要重新猜测调用方当初写的是哪个字符串。代价是调用方的原始字符串与返回值可能不同（系统临时目录
本身可能位于符号链接之后），测试因此用 `realpath(mkdtemp(...))` 作为期望值。

`removeWorktree` 复用同一套函数：外部引用里的路径是调用方给的字符串，同样必须重新走一遍拒绝顺序，
不能因为「它是我们创建时返回的」就跳过。

### 5. 分支名校验与「同名但指向别处」

`createBranch` / `createWorktree` 的 `branch` 都先过校验（在任何 Git 调用之前）：拒绝空、以 `-` 开头、
含 `..`、含空格或控制字符、含 `~^:?*[\`、以 `.lock` 结尾 → `invalid_input`。

分支身份的**唯一权威是 `for-each-ref` 的枚举**（与 `listBranches` 同一来源）：请求的名字必须在枚举里
逐字出现，且不是符号引用。`rev-parse` 在大小写不敏感文件系统上会把大小写变体解析成既有分支
（`packed-refs` 前后行为还不同），符号引用也会解析到别的分支——两者都会让 provider 报出
`listBranches` 列不出来的名字，或把两份工作树挂到同一条分支（第三轮评审 [6]）。

`createBranch` 对同名分支的判定：

- 解析请求起点 `fromRef` 的提交 → 拿不到就是 `not_found`；
- 若枚举里有同名分支：头部提交与起点相同 → **返回既有分支**（幂等复用，`ok`）；不同 → `invalid_input`
  （同名但指向别处，结构化硬失败；`conflict` 会被 core 的 `ensureBranch` 当成「探测后复用」，把
  provider 层的失败变成系统层的静默复用，第二轮评审 [2]）；
- 不存在则 `git branch <name> <startSha>`，失败按 stderr 映射（D/F 引用冲突、同名大小写变体 →
  `invalid_input`，其余 → `ambiguous_result`）。

`createWorktree` 的 `conflict` 语义收窄为「**正面确认可复用**」：登记记录、分支一致、目录存在都只是
必要条件；provider 还要用 `git -C <target> rev-parse --git-dir --git-common-dir --symbolic-full-name HEAD`
确认目标目录是本仓库的链接工作树、检出的正是请求的分支。目录被换成独立仓库 / 被 lock 后替换 / 指向主
检出时账本依然在，但都硬失败（第三轮评审 [2][7]）。

issue 正文把这一条写成「structured `LOCAL_GIT_FAILURE`」，但 8 码闭集里没有这个码，本层**不新增码**；
同名异指向用 `invalid_input`（`Decision Log` D4 已被 D20 取代）。

### 6. Git 调用：只有 argv

`packages/providers/development-local-git/src` 里的唯一调用点是 `git-runner.ts` 的 `execFile('git', args)`，
`args` 是数组，永远不经过 shell。runner 可注入（`runGit` 构造参数），因此测试能记录每一次调用、
也能注入故障；生产路径用默认 runner。契约层用一份**源码扫描**测试把这条性质钉死（`exec(` /
`execSync` / `shell: true` / `child_process` 的非 `execFile` 用法都不允许出现）。

错误映射：stderr 命中「不是仓库 / 未知修订 / 不是有效对象名 / 需要单个修订 / 不是符号引用」→ `not_found`；
命中「Permission denied / Operation not permitted」→ `permission_denied`；命中「index.lock / 另一个 git
进程 / 资源暂时不可用」→ `unavailable`；D/F 引用冲突（`cannot lock ref … exists; cannot create`）与
同名大小写变体（`a branch named … already exists`）→ `invalid_input`（确定性拒绝，不是结果不确定）；
**其余读失败** → `unavailable`（可原样重发），**其余写失败** → `ambiguous_result`（先 reconcile，不盲目重发）。

默认分支：注入值优先；没有注入就读 `origin/HEAD`；两者都没有时返回 `undefined`（「不知道」），由 core
回落到约定名——不用当前检出分支冒充默认分支（第三轮评审 [14]）。`getRepository` 即使有注入值也先确认
仓库可被 Git 读到，因此离线场景仍是结构化失败。

### 7. 单仓库实例

一个 provider 实例配置一个仓库（`{ externalId, path, name?, defaultBranch? }`）。多仓库是宿主组合的事
（一个 binding 一个仓库路径），本层不引入仓库注册表：`getCommit` 的引用里没有仓库 id，
多仓库会让「这个 sha 属于哪个仓库」变成猜谜。这是显式边界，记入技术债。

### 8. 基线：本地推断链，且不用当前检出分支（第四轮 P1）

`getRepository` 报的 `defaultBranch` 是**新工作分支的基线**，解析链固定为
**注入值 → `refs/remotes/origin/HEAD` → 本地推断**，本地推断再按
**唯一本地分支 → `init.defaultBranch`（该 ref 存在才算）→ 约定名 `main`/`master`/`develop`/`trunk` 中存在的第一个**
取一个。**不读当前检出分支**：它是环境状态而不是仓库事实，用它会让同一个 API 调用的结果随开发者临时
`checkout` 漂移（D14 的结论保留，第三轮缺的是本地推断这一环）。链走完仍不知道就返回 `undefined`，
此时宿主必须注入；`createBranch` 会把缺失的起点 ref 点名报出来（`起点 no-such-base 不存在`），
core 的 `baseRef` 回落到 `main` 只在这条链失败时才可能触发。

被推翻的旧行为：第三轮的链止于 `origin/HEAD`，`undefined` 交给 core 换成字面量 `main`。实测在
`git init -b master`（git 2.50 未配置 `init.defaultBranch`）与「本地建库 + `remote add` + `push -u`」
两类仓库上 Start Work 必然 `failed / not_found`。这不是「更严」，是本层声明的闭环在默认配置、常见
新仓库起点上不成立。

**一条设计事实（第五轮 P3 的附带观察，写在这里而不是当成缺陷）**：`origin/HEAD` 只提供**名字**，起点
最终解析到**本地**同名分支。本地 `main` 落后 `origin/main` 时，新工作分支基于旧提交——实测
`origin/main=090423e`、`main=386eb48`。不用 `origin/<name>` 是刻意的：`fromRef` 是 `createBranch` 的
输入契约，写远端跟踪引用会让「同一个名字」在本地与远端两个位置之间摇摆，而工作分支的基线应当是调用方
看得到的本地事实；要让基线跟上远端是 fetch / pull 的职责，不是分支创建的副作用。

### 9. 允许根的符号链接不变量（第五轮 P1；取代第四轮 P1 的判据）

不注入 `allowedRoot` 时允许根取 `<repo>/.worktrees`。**不变量**：允许根落在**仓库检出之内**的分量一律不得
是符号链接。仓库内容是**不可信输入**——上游提交一条 `.worktrees -> src` / `.worktrees -> .git` 就能决定
检出写到哪里，而 `realpath` 之后「仍在允许根内」照样成立（实测 git 自己也不拦：`git worktree add` 会照建
到被跟踪目录或 `.git/` 里）。判定的是**写法**而不是解析结果，与 `..` 分量同一条口径。宿主注入检出之外的
允许根由宿主负责。

第四轮的判据是「规范化之后仍在仓库内」（`rootWithin`），它只覆盖**逃出仓库**那一半；指向仓库内部的链接
绕过了它，这就是第五轮 P1。改成不变量之后 `rootWithin` 与它的归属比较都成了死代码，一并删除——**判据
更强而实现更小**。判定复用同一条逐分量 `lstat`（`firstLink`），它同时服务「目标尾部不得是悬空链接」。

同一条默认根还有第二个后果：它在用户的检出之内，而 git 不会自动忽略嵌套工作树，主检出的
`git add -A` 会把它们当嵌入仓库收进索引。修法是把 `/.worktrees/` 幂等地写进
`<git-common-dir>/info/exclude`（本仓库私有、不与他人共享的忽略规则位置），**不动用户跟踪的
`.gitignore`**；写不进去就结构化拒绝创建，而不是静默留下隐患。这条**补偿**的根因是 core 的
`worktreePathFor()` 把默认落点放在检出内（见「系统级根因分析」R3）。

### 10. 分支身份的唯一权威是一次枚举（第四轮 P2）

`listBranches` / 精确查找 / 大小写变体判定 / 写入后回读全部从 `branchRecords()` 派生，同一事实只有
一个来源：

- 格式用 `%(refname:lstrip=2)`：`%(refname:short)` 在同名标签存在时会给出 `heads/<name>`，那个名字
  既不能交回 `createWorktree`，也与 core 的 `branchProbe` 按名字查找的约定不符。
- 写入前拿**全部** `refs/heads` 做大小写折叠比较，只差大小写就 `invalid_input`。实测：松散引用时
  git 自己会因为大小写不敏感的文件系统拒绝写入变体，`git pack-refs --all` 之后它**不再拒绝**，
  而精确前缀查询对变体返回空——于是两个只差大小写的名字会折叠到同一条底层引用，两份工作树共用状态。
  身份必须跨文件系统可移植，所以变体一律硬失败，不依赖 git 的拒绝。
- 写入后按**精确名**回读：报成功之前必须确认磁盘上真有一条精确等于请求名、且指向请求起点的引用，
  否则报 `ambiguous_result` 交给 core reconcile。

### 11. 写后回读：报告的必须是写入之后的事实（第四轮 P3）

`worktree add` 成功之后回读 `worktree list --porcelain -z`，登记里没有目标路径就报 `ambiguous_result`。
判定与写入之间的 TOCTOU 窗口本身按 D19 接受（本地单用户工具），但「接受窗口」不等于「可以无条件
报告判定时的路径」——`AGENTS.md` §1.1 要求外部写入得到 ack / reconcile 之前不得显示权威 `Saved`。

### 被放弃的方案

- **给 worktree 移除新增 capability key 并在本层实现移除**：Superseded by 第四轮（2026-09-26）。
  键确实该有（#205 已加 `development.worktree.remove`），但**实现**移除超出 #137 的 scope，且会把
  一个会删掉被忽略文件的破坏性方法塞进本层。移除留给 **#138**。
- **用当前检出分支当基线**：环境状态不是仓库事实，会让同一个调用的结果随开发者临时 `checkout` 漂移。
  需要 Git/VS Code 式「从我现在这里分支」语义的调用方显式注入 `defaultBranch`。
- **provider 层做幂等复用**（同一路径重复创建返回既有工作树）：core 的 `ensureWorktree` 已经把
  `conflict` 当复用，provider 再静默复用会让「第二次创建其实没生效」不可见，也让 core 的分支失去意义。
  放弃；provider 只报 `conflict`。
- **在 provider 里加故障开关**（`faults: { offline: true }` 之类）：那是替身的职责。真实 provider 只暴露
  可注入的 Git runner，故障场景由测试注入 runner 表达。放弃在实现里塞测试开关。
- **契约层直接跑真实 Git 的契约套件**：`tests/README.md` §1 把「本地 Git 操作」划给集成层，契约层只允许
  代码与 fixture。套件装配放在 `tests/integration/`，契约层只放静态源码扫描。
- **argv-only 继续用禁用词表**：Superseded by 第四轮（2026-09-26）。词表只认拼写，实测 7 种写法
  （别名导入 / dynamic import / `require` / 括号访问 / `spawn` / `shell: <非 true>` / 新增 `.mts` 文件）
  全部 `pass 1 / fail 0`。改成正向规则：只有 `git-runner.ts` 可以引用 `child_process`，且它只允许导入
  `execFile`、不得出现 `shell` 选项键、必须收到 argv 数组；文件收集覆盖全部扩展名。

## Global Constraints

- 代码 ≤1000 行、文档 ≤1500 行（本层按**当前 `main`** 度量：`node scripts/rule-checks.mjs size origin/main`）。
  原基线 `test/development-suite-capability-driven` 已随 #208 合入 `main` 并删除分支，改用不可变的合入提交
  `9b33fe5`；锁文件与生成目录不计。**第五轮的实测超出见「评审响应（第五轮）」与 `Outcomes`**。
- 不新增第三方依赖；不改 `pnpm-lock.yaml`；不改 `packages/capabilities`（尤其**不得**新增 capability key）；
  不改 `packages/providers/fake/src/**`；不改 `tests/contract/suites/**`（第四轮后套件归 #205）。
- 本层改动的文件集合（**第五轮就地修订**）：`packages/providers/development-local-git/src/**`、
  `tests/contract/development-local-git-source.test.js`、`tests/integration/development-local-git.test.js`、
  `tests/integration/local-git-fixture.js`、`tests/integration/README.md`、
  `docs/exec-plan/active/2026-09-24-local-git-worktree.md`、`docs/README.md`、
  `docs/review/2026-09-23-pr-160-mvp-review.md`、`docs/review/2026-09-26-pr-160-mmp-review.md`。
  第五轮**没有**扩大它：`packages/capabilities` 的 port 义务写在 ADR-0007 与 `#212`，不在本层改。
- 不在本层实现的：工作树移除（#138）、core 侧的工作树句柄统一（#206）、接进 core 供应序列的验收（#207）。
- 仓库文件里不写凭据、账号、内网信息、本机绝对路径；测试的仓库与允许根一律 `mkdtemp` 生成。
- 不 push `main`；不自行合并；不把 PR 改成 ready（由主控在验收后执行）。
- 沙箱下所有 `pnpm` 命令带前缀 `npm_config_manage_package_manager_versions=false`。
- 集成测试不触网：只用本地临时仓库。

## Plan of Work

### Batch 1 · 计划与 draft PR

**最小闭环**：ExecPlan 落地、索引更新、draft PR 建立且 issue 关联非空。
**涉及文件**：`docs/exec-plan/active/2026-09-24-local-git-worktree.md`、`docs/README.md`。

- [x] 写本计划（spec + plan 合一），更新 `docs/README.md` 的 Active 索引表（只插本层一行）。
- [x] 提交 `docs(exec-plan): 为本地 Git 工作树与分支 provider 写计划` 并 `git push -u origin feat/local-git-worktree`。
- [x] `gh pr create --draft`（labels：`kind:feat`、`area:providers`、`area:tests`；milestone `M4 · MVP-1 真实 GitHub 纵向切片`），
      回读 `closingIssuesReferences` 与 `gh issue view 137 --json closedByPullRequestsReferences`。

**验证**：`gh pr view <n> --json number,url,baseRefName,headRefOid,isDraft,labels,milestone,closingIssuesReferences`
（期望：`isDraft: true`、`baseRefName: main`、closing 非空）；`gh issue view 137 --json closedByPullRequestsReferences`（期望：非空）。
**回滚**：`gh pr close <n>` 并删除远端分支（本层不删除，改为保留分支、关闭 PR）。

### Batch 2 · 契约套件能力驱动（先证明不是假绿）

**最小闭环**：套件按 `expect.provides` 分支；替身显式声明全能力；把声明改成子集时套件变红。
**涉及文件**：`tests/contract/suites/development.js`、`tests/contract/development-contract.test.js`。

- [x] 套件：`provides` 默认 `{ changeRequests: true }`；未声明的用例分支断言 `not_supported` + `retryable === false` + 无副作用。
- [x] 替身装配显式写 `provides: { changeRequests: true }`；替身实现不动。
- [x] 跑 `node --test tests/contract/development-contract.test.js`：期望全绿，用例条数与改动前一致。

**验证**：`npm_config_manage_package_manager_versions=false node --test tests/contract/development-contract.test.js`
（期望：fail 0，条数与 base 相同）。
**回滚**：`git checkout origin/main -- tests/contract/suites/development.js tests/contract/development-contract.test.js`。

### Batch 3 · provider 实现（先红后绿）

**最小闭环**：临时仓库上真的出现 worktree 与 branch；路径安全在 Git 之前生效；变更请求返回 `not_supported`。
**涉及文件**：`packages/providers/development-local-git/src/index.ts`、`git-runner.ts`、`paths.ts`、
`branch-names.ts`、`provider.ts`；`tests/integration/development-local-git.test.js`。

- [x] 先写集成测试（含契约套件装配、路径安全三类 + 零调用、幂等、分支同名异指向、分支名校验、core 复用），
      跑 `node --test tests/integration` 记录**红**。
- [x] 实现 provider：`describeCapabilities` 三键子集、`getRepository` / `listBranches` / `getCommit` 真读、
      `createBranch` / `createWorktree` / `removeWorktree` argv、变更请求 `not_supported`。
- [x] 再跑同一条命令记录**绿**。

**验证**：`npm_config_manage_package_manager_versions=false node --test tests/integration`（先红后绿）；
`npm_config_manage_package_manager_versions=false pnpm run typecheck`（期望 exit 0）。
**回滚**：`git checkout origin/main -- packages/providers/development-local-git/src` 并删除新增测试文件。

### Batch 4 · argv 源码扫描与变异实验

**最小闭环**：argv-only 由静态扫描守住；至少两次「改坏 → 变红 → 还原 → 变绿」有逐条记录。
**涉及文件**：`tests/contract/development-local-git-source.test.js`、`tests/integration/README.md`。

- [x] 新增源码扫描测试：禁止 `exec(` / `execSync` / `shell: true` / 非 `execFile` 的 `child_process` 用法。
- [x] 变异实验 1：把替身装配的 `provides.changeRequests` 改成 `false` → 契约测试必须变红 → 还原变绿。
- [x] 变异实验 2：把 `createWorktree` 的路径判定挪到 Git 调用之后（或去掉 `..` 拒绝）→ 零调用用例必须变红 → 还原变绿。
- [x] 变异实验 3（若预算允许）：让分支复用的起点比较恒真 → 「同名但指向别处」用例必须变红 → 还原变绿。

**验证**：每次变异都跑对应命令并记录真实输出；还原后重跑同一命令得到绿。
**回滚**：变异一律用 `edit` 改回，不留任何变异痕迹（最终 `git diff origin/main...HEAD` 里不存在变异代码）。

### Batch 5 · 全量验证、整理提交与 PR 描述

**最小闭环**：验证命令全绿、提交序列可独立审阅、PR 描述含真实证据与偏差。
**涉及文件**：本层全部改动。

- [x] 依次跑：`pnpm verify`、`pnpm run boundaries`、`node --test tests/integration`、
      `node scripts/rule-checks.mjs size origin/main`、`node scripts/rule-checks.mjs disclosure origin/main`、
      `git diff --check origin/main...HEAD`，逐条记录真实输出。
- [x] 整理提交（计划 / 套件 / 实现 / 测试各自独立），push，`gh pr edit <n> --body-file <文件>`，回读 head 与关联。

**验证**：`gh pr view <n> --json number,url,baseRefName,headRefOid,isDraft,labels,milestone,closingIssuesReferences`
（期望：head 与本地一致、closing 非空、仍为 draft）。
**回滚**：`git reset --soft` 回上一个已知良好提交；远端用精确 force-with-lease 恢复（先建 backup ref）。

## Validation and Acceptance

| # | 验收项 | 判定证据 |
|---|---|---|
| 1 | 本机真的出现 worktree 与 branch | 集成测试用 `git worktree list --porcelain` 与 `git for-each-ref refs/heads` 回读；契约套件「工作树创建后可定位」 |
| 2 | 能力子集：只声明三个键 | 源码扫描 + 集成测试断言 `effectiveCapabilities` 里没有 `development.change_request.read` |
| 3 | 变更请求方法存在但 `not_supported` 且无副作用 | 套件的未声明分支（含"方法缺失必须由快照表达为 unavailable"）+ `expect.objects` 的调用前后快照相等 |
| 4 | 套件能力驱动且不是假绿 | 能力从 `describeCapabilities()` 推导；未声明分支断言 `not_supported` + 无副作用；双向断言（方法可用 ⇒ 快照 `available`）。变异 M6（快照漏掉 `worktree.create`）→ 套件与适配器专属用例变红 |
| 5 | **不实现**工作树移除：快照不声明 `development.worktree.remove`、套件不索取它 | 集成测试断言 `provider.removeWorktree === undefined` + 能力快照只有三个键。**Superseded by 第四轮**：原条目要求「实现移除且第二次移除 `not_found`」，已随 `#138` 移出本层 |
| 6 | 越界 / `..` / symlink 三类在任何 Git 命令之前被拒 | 集成测试断言注入 runner 的 `calls.length === 0`（准确含义：没有调用经过 runner；argv-only 由验收项 10 的源码扫描保证） |
| 7 | 分支名校验 25 类非法输入被拒（含 git refname 规则的 10 类） | 集成测试表驱动用例 + 零 Git 调用 + `invalid_input` |
| 8 | 同名分支指向别处 → 结构化失败 | 集成测试：先在别处建同名分支，再请求 → `invalid_input`；D/F 引用冲突同样是 `invalid_input`（变异 M5 变红） |
| 9 | 幂等：provider 报 `conflict`，core 复用 | provider 用例（第二次创建 `conflict`）+ 经 `provisionGit` 的两次调用用例（同一路径、无重复）。**后者随 #209 交付**；core 的 externalId 不一致见 issue #206 |
| 10 | argv only | 契约层源码扫描：唯一 `node:child_process` 导入点、只允许 `execFile`、无 shell 字符串调用点 |
| 11 | 规模与发布面 | `rule-checks size` / `disclosure` / `git diff --check` 全绿 |
| 12 | 仓库经符号链接访问时主工作树保护仍生效 | **Superseded by 第四轮**：原条目针对 `removeWorktree(主工作树)`，该方法已移出本层。等价保护留在「幂等」用例的最后一条断言（请求主检出路径 → `invalid_input`） |
| 13 | 默认允许根在新仓库上成立 | 「默认允许根」用例：不注入 `allowedRoot`、`<repo>/.worktrees` 不存在，首个工作树仍能建出。**经 `provisionGit` 的那一半随 #209 交付** |
| 14 | `conflict` 必须正面确认可复用 | 幂等用例的四个 lookalike（`.git` 被删 / 独立仓库 / lock 后替换 / 主检出）全部 `invalid_input`。**经 `provisionGit` 断言「不报 `Ready`」的那一半随 #209 交付** |
| 15 | 分支身份来自枚举 | 大小写变体的 `createWorktree` → `not_found`；符号引用 → `invalid_input`（变异 M2 变红） |
| 16 | 路径判定覆盖悬空符号链接 | 路径安全用例新增该类，零 Git 调用（变异 M3 变红） |
| 17 | **允许根在检出内的分量不得是符号链接**（第五轮 P1） | 「默认允许根」用例表驱动三种指向（被跟踪目录 `src` / `.git` / 仓库之外），逐个断言 `invalid_input` + 零 Git 调用 + 不留工作树。变异（删掉该判定）→ `23 / 1`，红的是这条用例 |
| 18 | 起点判定把不可信名字与选项隔开（第五轮 P3） | 「默认分支」用例断言经 runner 的 argv 逐字含 `rev-parse --verify --end-of-options <ref>^{commit}`。当前不可利用（`^{commit}` 后缀偶然挡住），所以钉的是 argv 形状而不是行为 |

## Progress

- [x] 2026-09-24 Batch 1 第一步：ExecPlan 落地 + `docs/README.md` 索引。
- [x] 2026-09-24 Batch 1 剩余：提交 `3ae37ca`、`git push -u origin feat/local-git-worktree`、draft PR #160；
      `gh pr view 160 --json closingIssuesReferences` 与 `gh issue view 137 --json closedByPullRequestsReferences` 均非空。
- [x] 2026-09-24 Batch 2：契约套件能力驱动（提交 `fc6f47d`）；`node --test tests/contract/development-contract.test.js`
      → 13 pass / 0 fail，用例条数与 base 相同（套件 9 + 替身判别性 4）。
- [x] 2026-09-24 Batch 3：先红（`createLocalGitDevelopmentProvider` 不存在 → SyntaxError）后绿；
      `node --test tests/integration` → 25 pass / 0 fail（含评审响应新增用例）。
- [x] 2026-09-24 Batch 4：argv 源码扫描（`tests/contract/development-local-git-source.test.js`，2 条）+ 变异实验（见 `Surprises & Discoveries`）。
- [x] 2026-09-24 Batch 5：全量验证与 PR 描述（见 `Validation and Acceptance` 与 `Outcomes & Retrospective`）。
- [x] 2026-09-24 评审响应：根因 A–D、F3、TOCTOU 登记与文档订正。
- [x] 2026-09-24 第三轮评审响应：两条 P1（默认允许根、`conflict` 正面确认）与 P2/P3 按根因改完；
      判别性变异 M1–M7 逐条记录（见「评审响应（第三轮）」）。
- [x] 2026-09-26 第四轮评审响应：18 条未解决意见在隔离 worktree 里逐条独立复现（2×P1、6×P2、10×P3；
      两条判为「部分属实」并写明成立条件），按 11 组根因改完；判别性用例新增 6 组（默认分支推断、
      缺失起点点名、默认根符号链接逃逸、`info/exclude`、`pack-refs` 大小写变体、写后回读、`worktreeCreate` 守卫）。
- [x] 2026-09-26 交付边界重整：套件改动 → #205（PR 基线 `main`）；`removeWorktree` 移出 → #138；
      core 供应序列验收 → #207（叠加 PR）；本层三个提交各自单独绿。
- [x] 2026-09-26 体量与验证（**第四轮当时**的读数，已随第五轮失效，保留为历史）：`size
      test/development-suite-capability-driven` → 代码 **1000 / 1000**、文档 **903** / 1500；
      contract+integration+e2e `638 / 638 / 0`；mvp0 `7 / 7 / 0`；boundaries `7 / 7 / 0`。
- [x] 2026-09-26 第五轮评审响应：6 条未解决意见逐条独立复现（1×P1、2×P2、3×P3），按根因改完；
      路径安全的**判据换成不变量**（检出内分量不得是符号链接），`rootWithin` 与它的归属比较随之删除；
      `rev-parse` 加 `--end-of-options`；README 的 #207 一节移交 #209。逐条处置见「评审响应（第五轮）」。
- [x] 2026-09-26 系统级根因分析：把五轮 9 条 P1 归成三族，指出**两条的根在 core 而不是本层**，
      并据此拒绝在 provider 侧继续加补偿（R1/R2/R3，见「系统级根因分析」）。新增 ADR-0007 与 #212 / #213 / #214。
- [x] 2026-09-26 W2 路径信任边界修复：新增 `repo/alias -> allowedRoot` + `alias/new` 零 Git 调用反例；删除 ancestor 守卫时 23 / 24，恢复 `firstLink` ancestor 自身 `lstat` 后 24 / 24。

## Surprises & Discoveries

1. **`createChangeRequest` 是 port 的可选成员，套件原来无条件调用它。** 子集 provider 不实现该方法时，
   套件在 `provider.createChangeRequest(...)` 上抛 `TypeError`（第一次跑集成测试时 5 条用例同时红）。
   处理：套件允许"方法缺失**或**返回 `not_supported`"两种形态——与 core 的既有约定一致
   （`packages/core/src/git-provisioning.ts` 对 `createBranch` 就是"方法缺失即不支持"）。
   证据：`node --test tests/integration/development-local-git.test.js` 红 → 改套件 → 绿。
2. **core 的复用路径回填调用方字符串，provider 首次创建返回规范化路径，同一份工作树出现两个 externalId。**
   `packages/core/src/git-provisioning.ts` 的 `ensureWorktree` 在 `conflict` 分支返回 `path`（调用方传入的
   字符串），而 provider 的 `createWorktree` 成功时返回 `result.value.path`（规范化绝对路径）。集成测试
   实测：第一次 `worktreeExternalId` 是绝对路径，第二次（复用）是 `.worktrees/wi-1`。
   **独立对抗验证把后果复现到关系层**：`startWork(k-1)` 建树 → 把上下文置回 `Provisioning` 且租约过期 →
   `startWork(k-2)`，core 的 `recordStartFacts` 会为同一份工作树写出**第二条 confirmed `has_worktree` 关系**
   指向另一个 worktree 实体 id（`git worktree list --porcelain` 只有一份工作树）——违反不变量 6。
   **已建 issue #165**（`fix(core): keep one worktree entity identity across provisioning resume`）。
   本层**不改 core**（超出本层闭环，代码预算也已接近上限）。**收口（第三轮）**：#185 已在 core 修好该
   缺陷并合入 `main`；本层恢复用例改成断言 `has_worktree` 关系数 = 1，收口条件与 #165 选哪条修法无关。
3. **路径规范化必须对"最近的存在祖先"做 realpath。** core 的默认工作树路径是 `.worktrees/<slug>`，
   它的父目录一开始并不存在；若坚持"父目录必须存在"，core 的默认路径会被全部拒掉。实测
   `git worktree add .worktrees/wi-1 <branch>` 会自己创建中间目录（git 2.50.1），因此规范化改成
   "最近存在祖先 realpath + 拼回不存在的尾部"，符号链接逃逸仍然被抓（逃逸用的父目录是存在的符号链接）。
4. **`git cat-file -t <不存在的 sha>` 的 stderr 是 `fatal: git cat-file: could not get object info`**
   （git 2.50.1），最初的不存在模式表里没有它，集成测试的 `not_found` 断言先红；补进映射后绿。
5. **"零调用"证据的准确含义（对抗验证 P3）**：注入 runner 的记录器只能证明"没有任何调用经过 runner"；
   provider 里如果出现裸 `execFile` 绕过 runner，这条断言会全绿。真正保证"Git 只能用 argv"的是
   `tests/contract/development-local-git-source.test.js` 的源码扫描（唯一 `node:child_process` 导入点、
   只允许 `execFile`、不得出现 `shell: true`）。两条证据是互补的，不能互相替代。
6. **分支名校验的黑名单不足以挡住 git 自己的 refname 规则（对抗验证 P2）**：`foo.` / `.foo` / `foo/` /
   `a//b` / `a/./b` / `a.lock/b` / `foo@{bar` / `foo/.bar` / `x.lock/y` / `HEAD` 这 10 个名字会真的触发
   3 次 Git 调用并返回 `ambiguous_result`——把纯输入错误说成"结果不确定，必须先 reconcile"。两处根因：
   校验缺 git 的分量规则；`failureOf` 没有 `not a valid branch name` → `invalid_input` 的映射。
   两者都修了，10 个名字进入表驱动用例（零调用 + `invalid_input`）。
7. **"未声明能力"分支原本有两处假绿（对抗验证 P2）**：`assertOptionalNotSupported` 在方法缺失时直接
   `return`（零断言，而这正是本地 provider 的真实形态）；「返回 `not_supported` 但偷偷 `createBranch`」
   也没有任何断言。现在：方法缺失必须由能力快照表达为 `unavailable`；新增**必填**的
   `expect.objects(provider)` 钩子，断言被拒调用前后的对象集合逐字不变。
8. **主工作树守卫在仓库经符号链接访问时失效（对抗验证 P2）**：`insideRoot` 把"相对路径为空"
   （目标就是允许根本身）判成逃逸，`repositoryRealPath()` 的 realpath 分支因此不可达，守卫不触发，
   最后落到 git 自己的拒绝并返回 `ambiguous_result`。修法是让 `insideRoot` 接受空相对路径，并给
   `is a main working tree` 一个明确的 `conflict` 映射（两道防线，变异实验 6a 显示只回退前者仍是绿的——
   后者是兜底，因此两条都要在）。
9. **`getCommit` 把调用方传入的 rev 字符串当 sha 回填（对抗验证 P3）**：`externalId: 'HEAD'` 会得到
   `sha: 'HEAD'`，同一提交出现两个身份，且该字符串未校验就进了 argv。现在只接受对象名
   （`^[0-9a-f]{7,64}$`，拒绝 `HEAD` 与选项形态），并回填 `rev-parse` 解析出的真实 sha。
10. **变异实验（改坏 → 变红 → 还原 → 变绿）**（全部在检出 `feat/local-git-worktree` 的工作树根目录运行）：
    - 变异 1：把 `tests/contract/development-contract.test.js` 的 `provides.changeRequests` 从 `true` 改成 `false`
      → `node --test tests/contract/development-contract.test.js` 得 `pass 8 / fail 5`（5 条子集分支全红）；
      还原 → `pass 13 / fail 0`。**这证明"未声明"分支断言的是 `not_supported`，不是跳过。**
    - 变异 2：删掉 `packages/providers/development-local-git/src/paths.ts` 的 `..` 分量拒绝
      → 集成测试在零调用断言上红：`绝对路径含 .. 分量 必须在任何 Git 命令之前被拒（实际调用 3 次）`；
      还原 → `pass 17 / fail 0`（当时的用例数）。
    - 变异 3：把 `provider.ts` 的分支复用判定从 `existing.sha === start.sha` 改成 `existing.sha !== undefined`
      → `同名分支：指向请求声明的起点才复用，指向别处是结构化 conflict` 红（`true !== false`）；还原 → 绿。
    - 变异 4：删掉 `branch-names.ts` 新增的分量规则 → 集成测试在零调用断言上红
      （`非法分支名 "foo." 必须在任何 Git 命令之前被拒`，实际调用 3 次）；还原 → `pass 18 / fail 0`。
    - 变异 5a：让本地 provider 的 `describeCapabilities` 谎报 `development.change_request.create` 为 available
      → 诚实性断言红（`createChangeRequest 缺失时能力快照必须把 … 表达为 unavailable`），`pass 13 / fail 5`；
      还原 → `pass 18 / fail 0`。
    - 变异 5b：给本地 provider 加一个"返回 `not_supported` 但偷偷 `git branch sneaky-side-effect`"的
      `createChangeRequest` → 副作用断言红（`被拒的变更请求不得留下任何副作用`），`pass 16 / fail 2`；
      还原 → `pass 18 / fail 0`。
    - 变异 6a：只回退 `insideRoot` 的空相对路径修复 → **仍绿（`pass 18 / fail 0`）**，因为
      `is a main working tree` 的 `conflict` 映射兜住了；如实记录：这两条是冗余防线，单独回退一条不红。
    - 变异 6b：同时回退 `insideRoot` 与 `is a main working tree` 映射 → `移除工作树：仓库经符号链接访问时
      主工作树保护仍然生效` 红（`ambiguous_result` ≠ `conflict`）；还原 → `pass 18 / fail 0`。
    - 变异 7：删掉 `getCommit` 的对象名校验 → `读取：分支与提交都按外部 id 读回…` 红
      （`rev 形态必须被拒…`，`true !== false`）；还原 → `pass 18 / fail 0`。

11. **`prunable` 字段总是带原因**（第三轮评审 [2]）：`git worktree list --porcelain -z` 输出
    `prunable gitdir file points to non-existent location`，按整字段相等判定恒为假。修法是前缀判定；
    但**承重防线是正面确认**——`reuseBlockedBy` 用 `git -C <target> rev-parse` 证明目标目录确实是本
    仓库的链接工作树。变异 M1（关掉正面确认）让「目录被换成独立仓库」变红。
12. **`for-each-ref` 的精确模式在大小写不敏感文件系统上不匹配大小写变体，而 `rev-parse` 会**
    （实测 macOS APFS + `core.ignorecase=true`）：`for-each-ref refs/heads/WORK/WI-1` 无输出，
    `rev-parse --verify refs/heads/WORK/WI-1^{commit}` 解析成既有分支；`git branch WORK/WI-1` 报
    `already exists`，而 `git worktree add <path> WORK/WI-1` **成功**并让两份工作树挂到同一条分支。
    修法：分支身份只认枚举里逐字出现、且非符号引用的名字（变异 M2 变红）。
13. **默认分支「不知道」必须是 `undefined`，但 `getRepository` 仍要真的读一次仓库**：有注入值时若不
    探测，离线故障下 `getRepository` 会假成功（套件的「离线读必须结构化失败」用例抓到）。修法：
    注入值优先 + 一次 `rev-parse --git-dir` 可读性探测（变异 M7 变红）。
14. **第三轮体量超出代码预算**：两条 P1 的修复与判别性用例净增 123 行，`size origin/main` 从 998 涨到
    1121 / 1000（最终读数见 `Outcomes`）。不机械拆分的理由与可选拆法见 `Decision Log` D26；这是可见的、
    需要在 PR 里解释的超出（`rule-checks.yml` 的 advisory 说明），不是偷偷放宽。
15. **git 自己完全不拦「工作树建到哪」**（第五轮，独立调研 + 实测，git 2.50.1）：`git worktree add` 对
    四条路径全部 exit 0——`.worktrees -> src`（被跟踪目录）、`.worktrees -> .git`、`.git/wt3`（无符号
    链接，直接写进管理区）、以及经符号链接逃出仓库。`git-worktree(1)` 与 `gitrepository-layout(5)` 对
    符号链接与 `.git` 都没有一句警告；表面上的「`.git` 被拒」只是因为它恰好已存在。**结论：这条防线
    只能由 provider 自己建**，不能指望 git 兜底，也不能指望「解析结果仍在允许根内」这种间接判据。
16. **`--end-of-options` 不适用于 `git worktree add`**（第五轮调研）：它自 git 2.24.0 起可用，
    `git rev-parse --help` 明确建议对不可信名字使用，正确顺序是
    `git rev-parse --verify --end-of-options <rev>^{commit}`；但 `git worktree add` **既不接受**
    `--end-of-options` **也不接受** `--`（两者都 exit 129 用法错误），而 `git worktree add -evilpath` 报
    `unknown switch`。所以那条命令的选项注入防线只能是**绝对路径**（`resolveTarget` 已经保证返回规范化
    绝对路径），不是标志。
17. **同行默认把工作树根放在检出之外**（第五轮调研）：gwq 用 `~/worktrees`、git-worktree-runner 用
    兄弟目录、lazygit 默认 `../worktrees`、VS Code 与 GitKraken 让用户选；**没有任何一个工具从仓库内容
    推导落点**，也没有一个工具文档化了「拒绝符号链接路径」的策略。本层的 `lstat` 逐分量拒绝比它们都严，
    而 `<repo>/.worktrees` 是孤例——这条观察是 #214 的依据。
18. **`WorktreePathRejection` 的 `reason` 是死代码**（第五轮 dead-code 审计）：全仓只有 `.ok` / `.path` /
    `.message` 被读，`reason` 与那个五元 union 零消费。按「先找 dead code」应当删掉，但它只有 1 行，
    且是结构化诊断词汇，删除会缩掉后续消费者可用的信息面；保留并在 `Decision Log` D31 之外如实登记，
    不作为压缩预算的手段。
19. **目标 ancestor 自身符号链接会被 `firstLink(target.ancestor, candidate)` 跳过**：仓库内 `alias` 指向仓库外
    `allowedRoot` 时，`alias/new` 的最近存在祖先就是链接本身；旧实现从其子项开始扫描，导致解析成功并允许 Git 写入。
    先以变异实验确认新增测试在无守卫时稳定失败，再在 ancestor 上执行 `lstat`，恢复后 provider 在任何 Git argv 前返回
    `invalid_input`，且 runner 调用数为零。

## Decision Log

| # | 决策 | Rationale | 日期 / 作者 |
|---|---|---|---|
| D1 | 能力子集 = `repository.read` + `branch.create` + `worktree.create`；变更请求方法存在但 `not_supported` | 本地 Git 没有远端对象；伪造变更请求会造出第二个权威源（不变量 6） | 2026-09-24 / D2-L1 执行者 |
| D2 | 本层实现 `removeWorktree`（与 issue Out of scope 有意偏差），复用 `development.worktree.create` 键 | 契约套件把移除纳入 Development 契约；新增跨层 capability key 的面更大且被硬约束禁止 | 2026-09-24 / D2-L1 执行者 |
| D3 | 路径拒绝顺序：字符串拒绝 → 父目录 realpath → 落根判定 → 才调用 Git；返回值用规范化绝对路径 | `AGENTS.md` §7；判定后不再信任调用方字符串，身份在符号链接下仍稳定 | 2026-09-24 / D2-L1 执行者 |
| D4 | 同名分支指向别处 → `conflict`（不新增 `LOCAL_GIT_FAILURE`）——**已被 D20 取代**（现在是 `invalid_input`） | issue 正文点名的码不在 8 码闭集里；新增码是跨层契约变更 | 2026-09-24 / D2-L1 执行者 |
| D5 | 套件用 `expect.provides` 声明能力子集；未声明分支断言 `not_supported` + 无副作用，**不跳过**——**已被 D21 取代**（`provides` 改由快照推导） | 跳过会让子集 provider 的假绿不可见；变异实验把这条钉死 | 2026-09-24 / D2-L1 执行者 |
| D6 | 契约套件的本地 Git 装配放在 `tests/integration/`，契约层只放静态 argv 扫描 | `tests/README.md` §1：本地 Git 操作属于集成层；契约层只允许代码与 fixture | 2026-09-24 / D2-L1 执行者 |
| D7 | 未声明的能力先于身份闸门返回 `not_supported` | 能力整体不存在时，结论应与输入无关；已声明能力仍先过身份闸门 | 2026-09-24 / D2-L1 执行者 |
| D8 | 一个 provider 实例一个仓库 | 提交 / 工作树引用里没有仓库 id，多仓库会让归属变成猜谜；多仓库是宿主组合的事 | 2026-09-24 / D2-L1 执行者 |
| D9 | 套件对未声明的可选写方法允许"缺失或 `not_supported`" | `createChangeRequest` 是 port 的可选成员；core 的既有约定就是"方法缺失即不支持"，强制实现会把可选成员变成必选 | 2026-09-24 / D2-L1 执行者 |
| D10 | provider 的工作树身份用规范化绝对路径；core 复用路径的 externalId 不一致**记录而不在本层修**（**#165 已由 #185 修复**） | 规范化身份让同一份工作树只有一个身份（不变量 6 的方向）；改 core 会扩大改动面并与 D2-L2 的集成用例冲突，因此用测试钉住并交给评审 | 2026-09-24 / D2-L1 执行者 |
| D11 | 路径规范化对"最近的存在祖先"做 realpath，叶子与中间目录允许不存在 | `git worktree add` 自己创建中间目录；core 的默认路径 `.worktrees/<slug>` 的父目录一开始并不存在（见 `Surprises` 3） | 2026-09-24 / D2-L1 执行者 |
| D12 | 分支名校验按 git 自己的 refname 规则补齐（分量、`.` 结尾、`//`、`@{`、保留名），`not a valid branch name` → `invalid_input` | 黑名单漏项会让纯输入错误落到写命令兜底变成 `ambiguous_result`（见 `Surprises` 6） | 2026-09-24 / D2-L1 执行者（对抗验证后修订） |
| D13 | 套件的 `expect.objects(provider)` 是**必填**钩子；未声明能力的方法缺失必须由能力快照表达为 `unavailable` | 「无副作用」不能靠"没人看见"；方法缺失不能零断言（见 `Surprises` 7） | 2026-09-24 / D2-L1 执行者（对抗验证后修订） |
| D14 | `getCommit` 只接受对象名并回填解析后的真实 sha | rev 不是稳定外部身份，同一提交不能有两个 id；未校验字符串也不该进 argv（见 `Surprises` 9） | 2026-09-24 / D2-L1 执行者（对抗验证后修订） |
| D15 | core 的关系重复问题交 **issue #165**，本层只在测试里点名表征（**已收口：#185 合入 `main`**，恢复用例改为断言关系数 = 1） | 修它要动 `packages/core/src/start-work.ts` + `git-provisioning.ts`，超出本层闭环且代码预算已接近上限（见 `Surprises` 2） | 2026-09-24 / D2-L1 执行者（对抗验证后修订） |
| D20 | 同名分支指向别处 → `invalid_input`；创建路径的 `conflict` 只由显式复用判定产生 | core 的 `ensureBranch` 把任意 `conflict` 当「探测后复用」，provider 报 `conflict` 会把结构化失败变成静默复用（第二轮评审 [2]） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D21 | 套件从 `describeCapabilities()` 推导 `provides`；无条件证明 `objects` 钩子新鲜；双向断言「方法可用 ⇔ 快照 available」 | 适配器自报能力会假绿；钩子不被调用时断言无效（第二轮评审 [5][6]、第三轮评审 [15]） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D22 | `createWorktree` 报 `conflict` 前必须正面确认：目标目录是本仓库的链接工作树（`--git-dir` ≠ `--git-common-dir` 且 common dir 等于本仓库），且 `HEAD` 就是请求的分支 | 登记记录只说明 git 的账本里有一条；独立仓库 / lock 后替换 / 主检出都能骗过账本（第三轮评审 [2][7]） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D23 | 分支身份只认 `for-each-ref` 逐字枚举、且非符号引用的名字 | `rev-parse` 在大小写不敏感文件系统上解析大小写变体，`worktree add` 会接受它并造出两份挂同一条分支的工作树（第三轮评审 [6]） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D24 | 默认分支：注入值优先，其次 `origin/HEAD`，都不知道就 `undefined`；`getRepository` 仍做一次仓库可读性探测 | 不用当前检出分支冒充默认分支；有注入值就不探测会让离线读假成功（第三轮评审 [14]） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D25 | 路径规范化对目标与允许根统一（最近存在祖先 realpath + 拼回尾部）；尾部逐分量 `lstat` 拒绝悬空符号链接 | 允许根不存在是正常状态（core 默认 `<repo>/.worktrees`）；悬空链接的拒绝不能依赖 git 兜底（第三轮评审 [1][12]） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D26 | 第三轮体量超出 1000 行不机械拆分：如实记录、在 PR 描述解释；若人类要求拆分，首选把 `removeWorktree`（issue #137 已声明 out of scope）拆成叠加 PR | 超出全部来自两条 P1 的判别性用例与身份/路径加固；拆测试与实现会削弱证据，拆 `removeWorktree` 需要给套件加适配器声明（额外契约面） | 2026-09-24 / D2-L1 执行者（第三轮响应） |
| D27 | 路径安全的判据从「解析结果仍在仓库内」（`rootWithin`）换成不变量「**允许根在仓库检出内的分量不得是符号链接**」；`rootWithin` 与它的归属比较删除 | 第四轮的判据只覆盖逃出仓库那一半，指向仓库内部的链接绕过它（第五轮 P1）；判**写法**与 `..` 分量同口径，且在不变量成立后归属比较不可达。**判据更强而实现更小** | 2026-09-26 / agent（第六轮响应） |
| D28 | 允许根符号链接判定**不**按「派生 / 宿主注入」分流，一律按「是否落在检出内」判 | 宿主注入 `<repo>/.worktrees`（最自然的写法）时，链接在哪仍由仓库内容决定，所以「宿主注入即宿主负责」在这里不成立；注入检出之外的允许根不受影响。一条规则比两条容易陈述、容易测 | 2026-09-26 / agent（第六轮响应） |
| D29 | `rev-parse` 加 `--end-of-options`，**不**另加「`fromRef` 以 `-` 开头即 `invalid_input`」的校验 | git 官方对不可信名字的推荐写法；一个机制而不是两套。判别性证据钉 argv 形状（当前不可利用，`^{commit}` 后缀偶然挡住）。调研另确认 `git worktree add` 不接受该选项，故那条命令的防线是绝对路径而不是标志 | 2026-09-26 / agent（第六轮响应） |
| D30 | **驳回**「在 provider 的起点缺失消息里加补救提示」，改在 core 侧不编造基线 | `main` 是 core 的 `baseRef()` 的 `?? 'main'`；provider 判不了这个名字的来源，加提示等于把 core 的兜底写进 provider 的措辞——A/B/C 三族的共同形态。provider 保留它真正的义务：点名缺失的 ref | 2026-09-26 / agent（第六轮响应，**需要人类确认**是否接受该驳回） |
| D31 | 跨层根因写进 **ADR-0007**，三条根因各开一个 issue（#212 / #213 / #214），不在本层加补偿 | 九条 P1 里两条的根在 core、一条的上游在 core；本层已有的补偿（`reuseBlockedBy`、基线推断链）今天仍承重，保留但不再新增。ADR 收录标准是「被推翻会让已写好的接口重做」 | 2026-09-26 / agent（第六轮响应） |
| D32 | W2 在 `firstLink` 入口检查已存在 ancestor 自身；不迁移默认 allowedRoot | 当前 P1 的根因是 `target.ancestor` 为符号链接时从子项开始扫描；ancestor `lstat` 是最小机制修复，默认根迁移属于 #214 后续产品决策 | 2026-09-26 / W2 执行者 |

## Idempotence and Recovery

- 本层的每一步都可重复执行：`git worktree add` 幂等由 core 的 `conflict` 复用保证；测试每次都新建临时仓库，
  不共享状态，可任意重跑。
- 失败恢复：provider 侧无持久状态，重跑测试即可；若测试在临时仓库里留下残留，`mkdtemp` 目录由测试清理，
  不影响仓库内容。
- 回到已知良好状态：`git checkout origin/main -- <本层涉及文件>`（见 `Global Constraints` 的文件集合），
  或 `git reset --hard origin/main`（仅在本 worktree，且本地无未保存改动时）。
- 变异实验一律就地改回并重跑验证，最终 diff 中不得残留变异代码（Batch 4 的判据）。

## Interfaces and Dependencies

- 依赖：`@harness-projects/domain`、`@harness-projects/capabilities`（包边界允许的边）；Node 内置
  `node:child_process`（`execFile`）、`node:fs/promises`、`node:path`。**不新增第三方依赖**。
- 构造契约（测试与宿主都按它装配）：
  `new LocalGitDevelopmentProvider({ bindingId?, repository: { externalId, path, name?, defaultBranch? },
  allowedRoot?, capabilities?: { branchCreate?, worktreeCreate? }, runGit?, observedAt? })`。
- 外部工具：本机 `git`（argv 调用，不触网）；测试用 `mkdtemp` 建临时仓库。
- 仓库设置：无（不 push、不改 CI、不改 workflow）。

## Outcomes & Retrospective

**在包含本行的 head 上实测**（复核：`git rev-parse HEAD` 加同一条命令；易失值不写死）：`pnpm verify` 536/536 + mvp0 7/7、`pnpm run boundaries` 7/7、聚焦三文件 37/37（integration 23 / contract 13 / source 1）；`size origin/main` 代码 **1121 / 1000（超出，见下）**、文档 721 / 1500；`disclosure` 与 `git diff --check` 均通过。第三轮评审响应的订正见「评审响应（第三轮）」。

全部批次完成，并经两轮评审响应与一轮独立对抗验证后修订。下表是第三轮响应后的验证输出，全部在检出
`feat/local-git-worktree` 的工作树根目录运行（易失状态请用同一命令重算）：

| 命令 | 观察到的输出 |
|---|---|
| `pnpm verify` | `tsc --noEmit` 通过；contract+integration+e2e `tests 536 / pass 536 / fail 0`；mvp0 `tests 7 / pass 7 / fail 0`；exit 0（在包含本行的 head 上实测） |
| `pnpm run boundaries` | `tests 7 / pass 7 / fail 0`；exit 0 |
| `node --test tests/integration` | `tests 45 / pass 45 / fail 0`（在包含本行的 head 上实测） |
| `node --test tests/contract/development-contract.test.js` | `tests 13 / pass 13 / fail 0` |
| 三个聚焦文件 | `tests 37 / pass 37 / fail 0`（integration 23 / contract 13 / source 1） |
| `node scripts/rule-checks.mjs size origin/main` | 代码 **1121 / 1000**（超出 121）、文档 721 / 1500；exit 1（advisory，见下） |
| `node scripts/rule-checks.mjs disclosure origin/main` | 机械扫描通过（新增行、每个提交信息、PR_BODY 均未命中）；exit 0 |
| `git diff --check origin/main...HEAD` | 无输出；exit 0 |

### 体量超出（第三轮，需人类裁决）

> **Superseded by 第四轮（2026-09-26）**：本节记的 1121/1000 与「首选拆法是把 `removeWorktree` 拆出去」都已作废——实测删掉 `removeWorktree` 只到 1046，仍超。人类伙伴在 2026-09-26 裁决为「拆套件 PR + 删 `removeWorktree`，余量若仍略超再带实测数字回来」。执行结果见 `评审响应（2026-09-26，第四轮）`。原文保留如下。

代码从 998 涨到 1121（+123），全部是第三轮两条 P1 的修复与判别性用例：`reuseBlockedBy` 正面确认、
分支身份枚举、路径允许根 / 悬空链接、`getRepository` 可读性探测，以及 lookalike / 分支身份 / 默认允许根 /
D-F / 悬空链接五组用例与三处套件断言（断言一条未删）。**没有为凑数字删断言，也没有机械拆分连续算法**
（`AGENTS.md` §5）。`PR size` 是 advisory（`rule-checks.yml` 头注：上限是工程判断，合理超出要可见、要解释）。
若人类要求回到 1000 以内，首选拆法是把 `removeWorktree`（issue #137 已声明 out of scope）拆成叠加 PR，
代价是给契约套件加一条适配器声明（`Decision Log` D26）。

与计划的偏差：

1. **契约套件多改了一处**：`createChangeRequest` 是可选成员，子集 provider 不实现它，因此未声明的分支
   允许"缺失或 `not_supported`"（`Decision Log` D9）。对抗验证指出"允许缺失"会变成零断言，修订后
   缺失必须由能力快照表达为 `unavailable`（D13）。
2. **集成测试多了两条用例**（"读取"与"经符号链接访问仓库"），用来钉住 `not_found` / `invalid_input`
   映射、身份闸门与主工作树守卫。
3. **计划里写"路径安全返回规范化路径"，但没有预料到 core 复用路径回填调用方字符串**（`Surprises` 2）。
   对抗验证进一步证明它会在恢复路径上写出第二条 `has_worktree` 关系 → **issue #165**（D15）；
   **第三轮收口**：#185 已修好并合入 `main`，本层恢复用例改为断言关系数 = 1。

遗留问题（技术债，不在本层修）：

- 一个 provider 实例只支持一个仓库（`Decision Log` D8）；多仓库需要宿主按 binding 组合。
- `removeWorktree` 复用 `development.worktree.create` 键（`Decision Log` D2）：语义上"能创建就能清理"，
  但键名不表达移除；若将来移除要独立授权，需要新增 capability key。
- "零调用"证据只覆盖经过注入 runner 的调用（`Surprises` 5）；argv-only 由源码扫描守住，两条互补。
- 契约套件缺"同一路径换分支再创建不得 conflict"的判别性用例，且替身对任意路径占用都报 `conflict`
  （第三轮评审 [15] 后半）；本 PR 的硬约束不改 `packages/providers/fake/src/**`，已另开 **#200**。
- 生产组装还没有注入 `defaultBranch` / `allowedRoot` 的宿主代码（第三轮评审 [14] 的附带事实）；
  属于宿主组合批次。

## 独立对抗验收（gpt-5.6-sol）

2026-09-24 在当时的 head `3a1ab0e37e3f9d724669969995647d65c826e7a8` 独立重读 `origin/main...HEAD`（**这是历史记录，不是当前 head**；下表数字已按第二轮评审响应后的 head 重测），裁决为 **accept_with_findings**：issue #137 的 5 / 5 条验收标准均有实跑证据，能力闭环可独立验收、合并；回滚为 revert 本层提交，若上层 #139 已合并则须按栈逆序先回滚上层。#139 对真实工作树落盘有技术依赖，栈序不是偏好。

- `node --test tests/integration/development-local-git.test.js tests/contract/development-contract.test.js tests/contract/development-local-git-source.test.js` → `35 / 35 / 0`（第二轮评审响应后重测）。
- `pnpm verify` → contract + integration + e2e `515 / 515 / 0`，MVP-0 `7 / 7 / 0`；`pnpm run boundaries` → `7 / 7 / 0`。
- `size origin/main` → 代码 `998 / 1000`、文档 `592 / 1500`；`disclosure`、`git diff --check` 均通过；文件清单与 `Global Constraints` 一致，无锁文件、依赖、capability key、domain 或 core 改动。
- 独立证伪：临时禁用 `..` 分量守卫后，路径安全用例变红为 `pass 0 / fail 1`，并报告「实际调用 3 次」；还原后工作树无 diff。
- defer #165 成立：修复必须改 `packages/core`，超出本层 provider 闭环且本层代码预算几乎用尽；本层在**关系层**表征该缺陷（恢复后 `has_worktree` 边数），收口条件与 #165 选哪条修法无关。
- issue 偏差均诚实登记：实现 `removeWorktree`；以闭集内 `conflict` 替代不存在的 `LOCAL_GIT_FAILURE`；可选成员 `createChangeRequest` 未实现。

本轮未改代码：未发现能在 9 行余量内提升正确性、且优于现状的必要重构；为 LOC 做机械拆分反而扩大风险。

## 评审响应（2026-09-23，根因修复）

本节按评审原文核对机制后记录本批修复；F9 的 TOCTOU 窗口接受为本地单用户工具的已知风险，不尝试伪造原子性。

| 评审意见 | 是否属实 | 根因分组 | 改法 | 实测证据 |
|---|---|---|---|---|
| F1：`createWorktree` 任意 `conflict` 会让 core 报假 Ready | 属实 | A：provider 状态担保 | 仅登记且目录存在才返回 `conflict`；目录消失返回 `invalid_input` 并提示 `git worktree prune`，普通占用路径返回 `invalid_input` 并提示换路径；不自动 prune/`-f`，遵守拒绝而不是覆盖 | 集成新增“占用路径与错误对象类型不伪造成功”；占用路径为 `invalid_input`，无工作树写入 |
| F2：`remove` 的确定性拒绝落成 `ambiguous_result` | 属实 | B：写命令拒绝分类 | 补齐脏/locked/validation→`conflict`、非工作树→`not_found`、含子模块→`not_supported`；`ambiguous_result` 保留给不可观测结果 | 集成新增脏工作树用例：`conflict`、`git worktree list` 仍登记、未跟踪文件仍存在 |
| F3：替身 `objects` 恒真 | 属实 | 单独测试契约 | `structuredClone(provider.state)`；连续快照在已知写入后必须不相等 | `node --test tests/contract/development-contract.test.js`：14 pass / 0 fail |
| F4：短 sha 与全 sha 产生两个提交身份 | 属实 | C：身份构造唯一来源 | `getCommit` 用 `this.refOf('commit', resolved.sha)`；集成断言短 sha 读回的 `ref.externalId` 是规范 sha | 集成读取用例通过：短 sha 与返回 ref 均为 fixture 的规范 sha |
| F5：`defaultBranch` 误报当前检出分支 | 属实 | D：默认分支语义 | 优先注入 `repository.defaultBranch`，其次 remote HEAD（去掉 `origin/`），再次当前 HEAD；detached 返回 `undefined` | 集成读取用例先 checkout 非默认分支，再断言 `defaultBranch === 'main'` |
| F6：缺少 `objectKind` 闸门 | 属实 | C：身份构造唯一来源 | `getCommit` 要求 `objectKind === 'commit'`，`removeWorktree` 要求 `objectKind === 'worktree'` | 集成拒绝用例用 branch kind 调用两者，均为 `not_found` |
| F7：`limit: 0` 可造成游标不前进 | 属实 | D：边界 | `listBranches` 用 `Math.max(1, input.limit)` 钳住下界；本批未新增独立 limit 用例，保留为另开 issue 以避免突破代码预算 | 实现已覆盖边界；另开 issue 记录判别性用例缺口 |
| F8：`stat` 吞掉非 ENOENT 错误 | 属实 | B：路径错误分类 | `paths.ts` 只吞 ENOENT/ENOTDIR，其他错误归入 `unresolvable` | 类型检查与集成全绿；路径解析错误不再被静默折叠 |
| F9：`resolveWorktreePath` 与 `worktree add` 存在 TOCTOU | 属实但接受风险 | 安全边界 | 本地单用户工具接受判定与写入之间的固有窗口；不尝试通过覆盖或自动修复改变拒绝语义 | 遗留问题登记；路径安全测试继续证明判定前零 Git runner 调用 |
| F10：ExecPlan 数字不一致、两行都编号 F9 | 属实 | 文档订正 | 编号改为 F9 / F10；全部在案数字按当前 head 重测，并以「在包含本行的 head 上实测 + 回读命令」的形式写出，不写死易失值、不留占位符 | `Outcomes` 与本节数字均为当前 head 读数；`rule-checks size origin/main` = 代码 999 / 文档 490 |

### 减法与预算证据

本批未删除断言。为给根因测试腾出空间，压缩了重复拒绝用例脚手架：拒绝用例共享既有 fixture/provider 构造，并将同族结果断言合并为单行而保留每个 `ok`、错误码和副作用不变量；没有删除任何断言或降低判别力。`rule-checks size origin/main` 的最终读数必须不超过 1000；若仍超预算，F7 与 F8 的独立用例降级为另开 issue，不放宽上限。

### Decision Log additions

- D16：`conflict` 只表达“登记在册且目录存在”的可复用工作树；目录消失或普通路径占用均硬失败。provider 不自动 `prune`/`-f`，因为 core 会把 `conflict` 当安全复用，且本仓库纪律是拒绝而不是覆盖。**已被 D22 取代**：还须正面确认目标目录是本仓库的链接工作树、且分支一致。
- D17：`ambiguous_result` 只表达无法观测写入结果；Git 对 remove 的确定性拒绝按语义分类，不把“确定没做任何事”伪装成未知。
- D18：提交身份统一由解析后的 sha 构造；默认分支优先使用注入事实，再使用 remote HEAD，detached 不猜 `main`。**默认分支部分已被 D24 取代**：没有注入又没有 remote HEAD 时返回 `undefined`。
- D19：本地 Git 路径判定到 `worktree add` 的 TOCTOU 窗口接受为单用户工具风险，记录但不消除。

## 评审响应（2026-09-23，第二轮）

第二轮评审提出 13 条未解决意见（`docs/review/2026-09-23-pr-160-mvp-review.md` 锁定了当时的 head 与结论，
逐字收入，不改写）。**13 条全部属实**，按机制归为四组，一次改完而不是逐条打补丁：

| 评审意见 | 是否属实 | 根因分组 | 改法 | 实测证据 |
|---|---|---|---|---|
| [1] `createWorktree` 仍对不可复用的状态报 `conflict`（反例 A/A2/B/C/D） | 属实（P1） | A：provider 状态担保 | 在 `worktree add` **之前**用 `worktree list --porcelain -z` 的记录判定：请求的分支已被**另一份**工作树（含主检出）检出即硬失败；`failureOf` 里"身份被占"的短语（`already exists` / `already used by worktree` / `is already checked out` / `is a main working tree`）不再映射成 `conflict`，`conflict` 只由显式复用判定产生 | 变异 1（撤前置判定 + 把该行改回 `conflict`）→ `pass 20 / fail 1`，`AssertionError: 没有可复用对象时不得报 core 会当成复用成功的 conflict`；还原后 21/21。反例 D（悬空符号链接）实测 `invalid_input` |
| [2] "同名分支指向别处"在 core 层变成静默复用 | 属实（P1） | A：provider 状态担保 | 改报 `invalid_input`——core 的 `ensureBranch` 只对 `conflict` 做"探测后复用"，硬失败才会 `markFailed` | 集成用例名与断言同步为 `invalid_input`；`provisionGit` 侧断言 `ok === false` 且状态不是 `Ready` |
| [3] F8 的修复把"吞掉所有错误"改成"抛裸异常" | 属实（P2） | B：路径错误分类 | `paths.ts` 的非 ENOENT/ENOTDIR 改为 `reject('unresolvable', '目标不可访问')`；`provider.ts` 的存在性判定收成不抛的 `occupied()`——不可访问由路径解析转成结构化拒绝，`stat` 不再有裸抛 | 变异 2（改回 `throw error`）→ 用例以 `Error: EACCES: permission denied, realpath …` 失败；还原后 21/21。新增 mode 000 目录用例断言 `invalid_input` |
| [4] "登记在册但目录已消失"没有判别力 | 属实（P2） | A：provider 状态担保 | 该支改回 `conflict` 后三个聚焦文件仍全绿，说明无用例覆盖 → 在幂等用例里补该分支，并断言经 `provisionGit` 不报 `Ready` | 变异 3（该支改回 `conflict`）→ `AssertionError: 登记仍在而目录消失时没有可复用对象`；还原后 21/21 |
| [5] `provides` 由适配器自报，不与能力快照互相校验 | 属实（P2） | C：契约由快照推导 | `provides` 从 `describeCapabilities()` 推导，套件双向断言"快照说可用 ⇔ 方法可用" | `development-contract.test.js` 14/14；谎报能力快照的变异由适配器专属用例抓住 |
| [6] F3 的修复没有效果：全能力替身从不调用 `objects` 钩子 | 属实（P2） | C：契约由快照推导 | 套件**无条件**调用两次钩子、中间做一次已知写入，要求两次快照不相等——由套件而不是适配器证明钩子是新鲜的 | `suites/development.js` 的无条件快照断言；钩子改成恒等对象或抛错的变异都会变红 |
| [7] #165 的表征抓不住首选修法，收口指令会误导 | 属实（P2） | D：缺陷表征的位置 | 表征移到**关系层**（`startWork` 恢复后 `HasWorktree` 边数），收口条件与 #165 选哪条修法无关；`core 复用` 里收口条件写错的 `externalId` 断言对删除，由关系层用例取代 | 关系层用例断言边数 2、实体数 2（缺陷表征），注释写明两种修法都会让它们回到 1 |
| [8] ExecPlan 数字互相矛盾且在受检 head 上不可复现 | 属实（P2） | E：证据与 head 绑定 | 全部按当前 head 重测，写成"在包含本行的 head 上实测 + 回读命令"；两行重复的 F9 改为 F9 / F10；删除"提交后回填"这类占位 | 本节与 `Outcomes` 的数字；`rule-checks size origin/main` = 代码 999 / 文档 490 |
| [9] F5 的回退路径仍返回当前分支 | 属实（P3） | D：默认分支语义 | 回退链保留（注入值 → `origin/HEAD` → 当前 HEAD），detached 返回 `undefined` 让 core 用约定名；判别用例注入 `defaultBranch` 并先切到非默认分支 | 集成读取用例：切到 `feature/current` 后 `defaultBranch` 仍是 `main` |
| [10] `detail` 取错行、分类顺序遮蔽 | 属实（P3） | B：写命令拒绝分类 | `detail` 优先取第一条 `fatal:` / `error:` 行；`validation failed` 判定前置到分类表首行 | 分类表顺序即判定顺序，表头注释写明"命中多条时以靠前的为准" |
| [11] 十六进制闸门挡不住"与短 sha 同名的分支" | 属实（P3） | C：身份构造唯一来源 | `getCommit` 要求解析出的 sha 以请求值为前缀，否则 `not_found` | 集成读取用例断言短 sha 读回的是同一个规范提交 |
| [12] 含换行的路径被接受、porcelain 未加 `-z` | 属实（P3） | B：路径与解析 | 字符串层拒绝控制字符；`worktree list` 改用 `--porcelain -z` 解析 | 路径用例含控制字符分支；登记解析按 `\0\0` 分块 |
| [13] 默认允许根是仓库的父目录 | 属实（P3） | D：边界 | 默认改为 `<repo>/.worktrees`（最小权限），仍可由构造参数注入 | 构造器默认值；测试一律显式注入允许根 |

**未照评审建议原样改的两处，理由如下**（不是不同意结论）：

1. 评审 [1] 的措辞是"`conflict` 只留给「登记在册 + 目录存在 + 分支一致 + 非 prunable」"，评审 [3] 要求把 `exists()`
   包成 try/catch。实际实现把**不可访问**交给路径解析统一转成结构化拒绝，`provider.ts` 的 `occupied()`
   因此不需要三态或 try/catch——探针实测 EACCES 与 ELOOP 都在 `paths.ts` 就被拒（`目标不可访问`），
   在 `provider.ts` 里再包一层会得到**不可达**的分支，与"先找 dead code 再新增"的纪律冲突。
2. 分类表里 `contains modified or untracked files` / `cannot remove a locked working tree` **保留** `conflict`：
   它们只可能来自 `worktree remove`，创建路径拿不到，因此不会撞上 core 的"Conflict 即复用"；语义上
   "目标状态与请求冲突，重读后重放"也确实是 `conflict` 而不是输入错误。这条口径写进了分类表的表头注释。

**一处需要人类决定的边界（评审 [2] 提出，本轮未改语义）**：基线分支前进后重试会落进"同名分支指向别处"
这一支而硬失败。本轮按"provider 只能报告 core 可以安全复用的状态"处理为硬失败；若人类判定这种重试应当
复用，那是 core 的 `ensureBranch` 要在复用前校验分支头与起点的关系，属于 `packages/core` 的改动，
应与 **#165** 一并处理（两者在同一段代码上）。

### 第二轮减法的实际做法（先找 dead code，再考虑压缩）

上一轮为腾预算删掉了四个模块级"为什么"注释，那是一笔坏交易：ExecPlan 完成后会归档，而字段级理由正是
下一个改这份代码的人在编辑现场需要的。本轮按用户的指示改为**先找 dead code 与可简化项**：

- 内联单次使用的私有 helper（`repositoryRealPath`、`stripTrailingSeparators`、`hasParentSegment`、
  `firstLine`），推理保留为就地注释；
- 把 `failureOf` 的 8 段 if 链收成一张声明表（`REFUSALS`），顺序与语义逐条保留；
- 用 `coreContextFor` 收掉三处重复的 core 装配样板；把两个新增拒绝用例折进同族的既有用例（断言一条未删）；
- 删除 `core 复用` 里**收口条件写错**的两条 `externalId` 断言——评审 [7] 指出它们在 #165 的选项 1 下
  反而会失败，关系层用例已更精确地覆盖同一缺陷。

净结果：union 从接手时的 1029 降到 **999 / 1000**，同时恢复了上一轮删掉的推理注释，断言一条未删。

### 分支名诊断信息的恢复（2026-09-24，人类伙伴裁决）

上面那轮减法把 `branch-names.ts` 的九条规则收成一个正则、原因合成一句「分支名包含 Git 禁止的字符或分量」，理由是省行数。**人类伙伴裁决：诊断信息更重要，必要时可以超预算。**

改法（不是把旧代码搬回来，而是换成规则表）：`RULES` 逐条携带自己的消息，模块注释里不再重述规则清单（清单就是表本身）。表里同时修掉一处**回归**——原来的写法只覆盖「分量以 `.lock` 开头」，漏了「分量以 `.lock` 结尾」，于是 `a.lock/b` 会被放行到 Git。逐名对照 33 个输入，只有前导斜杠（`/lead`）的行为不同：新规则更严，git 确实拒绝它（那是空分量），其余完全等价。

**判别性证据**：把 lookup 的结果换回合成消息 → `tests 21 / pass 20 / fail 1`；还原 → `21 / 21`。新增的那条断言就是钉住「消息必须点名规则」这个性质——否则下一轮再为预算收缩时会静默退化。

**体量**：先找 dead code（`provider.ts` 的 `firstLine` 已在上一轮删除，无残留消费者），再把模块注释里对规则的复述压掉、把 `occupied()` 的 `try/catch` 收成一次 `Promise` 判定，最终 **998 / 1000**——没有超预算。

## 评审响应（2026-09-24，第三轮）

第三轮评审在 head `410eafc` 上留了 15 条未解决 inline 意见（`docs/review/2026-09-24-start-work-batch-review.md`
锁定了当时的 head 与 P0–P3 矩阵）。**逐条核实后 15 条全部属实**（其中 [11] 是"更严"而非缺陷，[15] 后半
超出本 PR 的硬约束）；按机制一次改完，不逐条打补丁：

| 意见 | 是否属实 | 根因 | 改法 | 判别性证据 |
|---|---|---|---|---|
| [1] P1 默认允许根 `<repo>/.worktrees` 在全新仓库里不存在 | 属实 | 允许根被要求必须存在，与目标的"最近存在祖先"规范化不对称 | 目标与允许根统一同一套规范化（`paths.ts`） | 「默认允许根」用例（不注入、经 `provisionGit` → `Ready`）；变异 M4 红 |
| [2] P1 `prunable` 判定恒为假 | 属实 | 字段总是带原因，整字段相等恒假 | 前缀判定 + **正面确认** `reuseBlockedBy` | lookalike 用例 `invalid_input` 且 core 不 `Ready`；变异 M1 红 |
| [3] P2 ExecPlan 设计与 Decision Log 写被推翻的语义 | 属实 | 文档没随代码修订 | 设计章节改写为现状；D4/D5/D16/D18 标"已被 Dxx 取代"；新增 D20–D26 | 本文件当前内容 |
| [4] P2 证据数字不可复现 | 属实 | 数字没按新 head 重测 | 全部重测并写成"在包含本行的 head 上实测 + 回读命令" | `Outcomes` 与本节 |
| [5] P2 第二轮评审记录以 Blocked 进入 `main` | 属实 | 状态写在合并瞬间即失效 | 状态改成对合并时刻为真的表述，第二轮原文保留为历史，补第三轮锁定事实 | `docs/review/2026-09-23-pr-160-mvp-review.md` |
| [6] P2 大小写变体与符号引用绕过"分支已在别处检出" | 属实 | 身份判定用 `rev-parse`（会解析变体），登记比较用字符串 | 分支身份改由 `for-each-ref` 枚举：逐字相等且非符号引用 | 「分支身份」用例；变异 M2 红 |
| [7] P2 `conflict` 只看登记记录（独立仓库 / locked / 主检出假 Ready） | 属实 | 复用判据缺正面确认 | `reuseBlockedBy`（git-dir / common-dir / HEAD 三项） | 四个 lookalike + 主检出用例；变异 M1 红 |
| [8] P2 `tests/integration/README.md` 写旧语义 | 属实 | 索引没随代码修订 | 按当前用例重写登记表 | 该文件 |
| [9] P2 标题说"只保留一条"、断言钉"两条" | 属实 | 断言把 #165 缺陷写成期望值 | #185 已修；改为断言 = 1（收口条件） | 「恢复供应」用例 |
| [10] P3 Bottom Change Note 缺条目 | 属实 | 改完没补 | 补第三轮条目 | 本文件末尾 |
| [11] P3 `\s` 拒了 git 接受的 Unicode 空白 | 属实（更严） | `\s` 覆盖 Unicode 空白，注释与事实不符 | 收窄为 ASCII 空格 `/ /`，注释改成与实测一致 | 分支名校验用例；逐名对照漏判 0 |
| [12] P3 悬空符号链接叶子由 git 兜底 | 属实 | 不存在的尾部没有逐分量 `lstat` | 尾部 `lstat` 命中符号链接即拒（`paths.ts`） | 路径安全用例新增该类；变异 M3 红 |
| [13] P3 D/F 引用冲突落成 `ambiguous_result` | 属实 | 分类表缺 D/F 模式 | 加 `cannot lock ref … cannot create` / `a branch named … already exists` → `invalid_input` | 「同名分支」用例；变异 M5 红 |
| [14] P3 F5 回退未改而 thread 回复称已改 | 属实（回复不实） | 代码没改，回复却写了改法 | 实现 `undefined` 回退 + `getRepository` 可读性探测；三处表述一致 | 「读取」用例；变异 M7 红 |
| [15] P3 双向断言只覆盖变更请求 | 属实 | 缺"方法可用 ⇒ 快照 `available`"的反方向断言 | 三条能力各加一条；套件与替身的另一半另开 **#200** | 变异 M6 红 |

**过严评估**：[12] 的安全结果本已正确（git 的 `file_exists` 不跟随链接），但 #137 验收 1 的字面要求是
"任何 Git 命令之前"，且路径守卫不应依赖被调用的工具，因此采纳（约 10 行）。[15] 后半要求给套件加
"同一路径换分支再创建不得 conflict"并同步改替身，超出本 PR"不改 `packages/providers/fake/src/**`"的
硬约束，**另开 issue** 而不是在回复里假装解决。[11] 的"更严"本身不是缺陷，但注释与事实不符必须修。

**先红后绿（第三轮变异，全部就地还原）**：M1 关掉 `reuseBlockedBy` → 「目录被换成独立仓库」红；M2 分支
身份改回 `rev-parse` → 「分支身份」红；M3 删悬空链接判定 → 「路径安全」红（实际调用 2 次）；M4 允许根
必须存在 → 「默认允许根」红；M5 删 D/F 分类行 → 「同名分支」红；M6 快照漏 `worktree.create` → 套件与
适配器专属用例红；M7 `defaultBranch` 回落当前检出 → 「读取」红。

## 评审响应（2026-09-26，第四轮）

第四轮 review（GitHub review 2026-09-25T16:17）在 #160 上留下 **18 条未解决 inline 意见**（2×P1、6×P2、10×P3）。
每条都在隔离 worktree（`.worktrees/verify-*`，head `01605c2`）里独立复现过，结论与改法如下。**没有一条是"更严"被驳回**；
唯一被判定为「部分属实」的是 [V7]，它的机制成立但当前 head 不复现。

| # | 位置 | 级别 | 是否属实 | 根因分组 | 改法 |
|---|---|---|---|---|---|
| 1 | `paths.ts:79` 默认允许根经符号链接逃出仓库 | P1 | 属实（独立复现：工作树落在仓库外、core 报 `ready / confirmed`；注入 `<repo>/.worktrees` 这条符号链接路径同样逃逸） | 允许根的**自身落点**没有核对 | `rootWithin`：派生的默认根规范化后必须仍在仓库内 |
| 2 | `provider.ts:104` 非 main 且无 `origin/HEAD` 时 Start Work 必然失败 | P1 | 属实（`trunk` 仓库实测 `failed / not_found`；注入 `defaultBranch` 后 `ready`） | 基线解析链在「不知道」处断裂，core 用字面量 `main` 顶上 | 补本地推断链；缺失起点在错误信息里点名 |
| 3 | `development-local-git.test.js:58` `coreContextFor` 绕开 core 组装 | P2 | **部分属实**：机制成立（`createContext` 先 `putWorkspace`；SQLite 开 `foreign_keys=ON`，孤立 binding 会 `FOREIGN KEY constraint failed`），但当前 head 用内存 storage 时 23/23 全绿，SQLite 业务表尚未落地 | 测试助手复制了 core 的装配顺序 | 改用 `createContext`；该助手随 core 层用例移到 #207 |
| 4 | `provider.ts:165` 打包后大小写变体各得一份 Ready 工作树 | P2 | 属实（松散引用时 git 自己拒绝；`pack-refs --all` 后 `createBranch('Work/WI-1')` 返回 ok，两条 ref 折叠到同一底层状态，两份工作树共享 `a.txt`） | 分支身份由多处临时 git 命令拼出 | 一次枚举 `refs/heads` 作唯一权威 + 写入前大小写折叠拒绝 + 写入后精确名回读 |
| 5 | `provider.ts:231` `removeWorktree` 删除被忽略文件 / 人工工作树 | P2 | 属实（只有 `.env` 与 `node_modules/` 时 `status --porcelain` 为空，`removeWorktree` 返回 ok 且 `.env` 一起消失；手工 `git worktree add` 的目录也能删） | 超出 #137 scope 的破坏性方法 | **移出本层**，交 #138 按「仅显式请求、仅干净」交付 |
| 6 | ExecPlan `:458` 体量 1121/1000 未裁决，D26 首选拆法实测无效 | P2 | 属实（删 `removeWorktree` 实测 1046；拆套件改动实测 993） | 交付边界与 issue 不一致 + 套件改动是独立闭环 | 拆套件 → #205；删 `removeWorktree`；core 层用例再拆 → #207；本层落到 **1000/1000** |
| 7 | `paths.ts:70` `trim()` 静默改写路径 | P3 | 属实（`".worktrees/sp "` 与 `" .worktrees/nb"` 都成功且建到去空白后的路径） | 空值判定与取值用了同一个 trim 后的值 | 首尾空白改为拒绝（与分支名「不得含空格」同口径） |
| 8 | `paths.ts:22` `insideRoot` 用 `startsWith('..')` | P3 | 属实（`.worktrees/..wi` 被判成逃逸，结果更严但诊断错） | 比的是字符串前缀而不是 `..` 分量 | 改成 `relative === '..' \|\| startsWith('..' + sep)`，并加一条 `..wi` 必须被接受的断言 |
| 9 | `provider.ts:212` 成功结果无条件报告判定时的路径 | P3 | 属实（注入 runner 在 `add` 前换掉中间目录：返回 `<fx>/repo2/.worktrees/sub/wt`，登记的是 `<fx>/outside/wt`） | 写后没有回读 | `worktree add` 后回读登记，路径不在其中报 `ambiguous_result` |
| 10 | `provider.ts:118` `%(refname:short)` 在同名标签下给出 `heads/<name>` | P3 | 属实（建同名 tag 后 `listBranches` 返回 `["heads/work/wi-1","main"]`） | 与 #4 同源 | 统一用 `%(refname:lstrip=2)` |
| 11 | `development-local-git-source.test.js:37` 源码扫描可被绕过 | P3 | 属实（实测 **7 种**写法全部 `pass 1 / fail 0`，含评审给的两种，以及 dynamic import / `require` / 括号访问 / `spawn` / 新增 `.mts`） | 用字符串匹配近似表达结构约束 | 换成正向规则（谁可以引用 `child_process` + 那个文件长什么样），并逐条验证两种评审写法现在都红 |
| 12 | `provider.ts:183` `worktreeCreate: false` 守卫无用例 | P3 | 属实（删掉两处守卫后三个聚焦文件仍 37/37/0） | 新增的构造选项没有判别性用例 | 新增用例：快照不可用、`not_supported`、零次 Git 调用、不留工作树 |
| 13 | `provider.ts:198` 前置判定没有判别用例 | P3 | 属实（短路后仍 37/37/0；git 的 `already used by worktree` 经 REFUSALS 同样落 `invalid_input`） | 断言只看错误码，没看是谁给的 | **保留**守卫（不依赖 git 的 stderr 措辞）并加消息断言 `/已被另一份工作树检出/` |
| 14 | `development-local-git.test.js:203` 「#165 已由 #185 修好」说过头 | P3 | 属实（`first` 是绝对路径、`second` 是调用方原始字符串；#185 统一的是实体身份） | 断言强于证据 | 就地订正注释并钉住现状，core 侧缺口另开 **#206** |
| 15 | `development-local-git-source.test.js:27` 第一个提交单独是红的 | P3 | 属实（`57a19a7` 上 `14 / 13 / 1`；失败的是「`child_process` 只允许出现在 runner」而 runner 在下一个提交） | 守护某提交代码的测试放在了别的提交 | 源码扫描移进 `feat(providers)` 提交；三个提交各自单独绿 |
| 16 | `provider.ts:78` 默认允许根在主检出内且未被忽略 | P3 | **部分属实**：本仓库 `.gitignore:19` 已忽略 `.worktrees/`，但消费仓库没有这条规则（实测 `?? .worktrees/`，`git add -A` 报 `adding embedded git repository`） | 默认值引入的危险没有被处理 | 幂等写 `<git-common-dir>/info/exclude`，不动 `.gitignore`；写不进去就拒绝创建 |
| 17 | `provider.ts:174` `Closes #137` 与 `LOCAL_GIT_FAILURE` 字面不符 | P2 | 属实（`ProviderErrorCode` 是恰好 8 个值的闭集，全仓零命中该名字） | 验收条目的字面写法与闭集契约冲突 | **人类伙伴 2026-09-26 批准**改 #137 验收条目 3 为「闭集内的结构化错误（`invalid_input`），绝不静默复用」；已执行，`Closes #137` 字面成立 |
| 18 | `provider.ts:217` `removeWorktree` 超 #137 scope 且是体量主要来源 | P2 | 属实 | 与 #5 同源 | 同 #5 |

**过严评估**：这一轮没有需要驳回的意见。[13] 的「删掉这道与 git 重复的守卫」是更省的选项，但不采纳——`REFUSALS`
是字符串匹配，git 的措辞一变就会落到写命令兜底的 `ambiguous_result`，而 core 会把 `ambiguous_result` 拿去 reconcile
并**静默复用**；保留守卫 + 消息断言是更小的风险面。[16] 对**本仓库**不成立（已有 `.gitignore`），但对消费仓库成立，
按「默认值引入的危险由默认值的提供者处理」采纳。

**独立复核的方式**：18 条全部在隔离 worktree 里由独立 agent 自己写最小复现脚本、跑真实命令后判定，不采信评审者给的输出
（评审者的输出只用来对照）。判定为「部分属实」的两条（[3]、[16]）都在上表写明成立条件与不成立的部分。

### 体量：第四轮的实测与拆法（人类裁决已执行）

| 方案 | 实测代码行数（`size`，基线见 `Global Constraints`） | exit |
|---|---|---|
| 第四轮修复后的单一 PR（拆套件前） | 1121 → 修复后 1135 | 1 |
| 只删 `removeWorktree` | 1046 | 1 |
| 只拆套件改动（128 行，→ #205） | 993 | 0 |
| 拆套件 + 删 `removeWorktree` + 保留全部第四轮修复 | 1085 | 1 |
| 再把 core 层用例拆出（→ #207） | 1026 | 1 |
| 再做冗余清理（见下） | **1000** | 0 |

冗余清理（不是为凑数字删断言）：`读取` / `能力子集` 用例去掉契约套件已经覆盖的重复断言（套件在 #205 里已断言
仓库读回、提交谱系、外来 binding 冷拒、未声明方法 `not_supported`）；`REFUSALS` 合并两条同码同消息的条目；
把长篇理由从代码注释移进本计划（一个事实只写一处）。**断言一条未删**——删掉的是与套件重复的部分。
`1000/1000` 没有任何余量，后续任何改动都必须同时给出等量回收或再拆一层。

### Decision Log additions（第四轮）

- Decision: 本层**不实现** `removeWorktree`，也不声明 `development.worktree.remove`；移除交 **#138** 按「仅显式请求、仅干净工作树」交付，安全/丢弃分层（默认安全、显式 `discard` 才丢弃修改、`overrideLock` 再升一级、结构化返回被阻止的原因）写进 #138 的验收。
  Rationale: `git worktree remove` 不带 `--force` 只把已跟踪文件的修改与未跟踪文件算作"脏"，**被忽略的文件**（`.env`、`node_modules/`）会随目录一起消失（实测）；provider 也无法区分"本 binding 建的工作树"与"人工建的工作树"；`git grep removeWorktree -- packages apps` 在 core 与宿主里零调用方；#137 的 Out of scope 明确写了它。同栈的调研（git / Terraform `force_destroy` / MCP `destructiveHint`）一致指向「capability 声明 + 默认安全 + 显式破坏性意图 + 确认在调用方」这一分层，而不是把它塞进创建能力的 PR。
  Date/Author: 2026-09-26 / agent（人类伙伴在 2026-09-26 裁决「拆套件 PR + 删 removeWorktree」）
- Decision: 改 **#137 验收条目 3** 的措辞：`LOCAL_GIT_FAILURE` → 「闭集 `ProviderErrorCode` 内的结构化错误（`invalid_input`），绝不静默复用」。
  Rationale: `ProviderErrorCode` 是恰好 8 个值的闭集，加第 9 个 provider 专用码会破坏「调用方只按 capability key 分支」的契约；条目的意图本来就是「结构化失败、不静默复用」。`AGENTS.md` §7 要求这类验收条目变更走人类批准，人类伙伴在 2026-09-26 明确批准。
  Date/Author: 2026-09-26 / agent（人类伙伴批准，已执行：`gh issue edit 137`）
- Decision: 体量超出时**继续拆层**而不是申请豁免：套件改动 → #205（基线 `main`），core 供应序列验收 → #207（叠加在本层之上）。
  Rationale: 实测「只删 `removeWorktree`」到 1046 仍超；「只拆套件」到 993 但第四轮修复又把它推回 1135。core 层用例（`provisionGit` / `startWork`）本身是一个闭环，拆出去不削弱本层的验收：本层仍保留 AC1（路径安全）、AC2 的 provider 侧（重复创建报 `conflict`、磁盘上不出现第二份）、AC3、AC4、AC5。
  Date/Author: 2026-09-26 / agent（人类伙伴在 2026-09-26 选择该拆法）
- Decision: 派生的默认根写 `<git-common-dir>/info/exclude` 而不是 `.gitignore`；写不进去就拒绝创建。
  Rationale: 调研（git 官方对 ignore 文件用途的划分、Codex/Cursor/Worktrunk 把 worktree 放仓库外或写本地 exclude）一致：`.gitignore` 是共享规则，`info/exclude` 是"本仓库私有"。拒绝而不是静默继续，是因为「把工作树放进用户的检出却不让它被忽略」正是这条默认值引入的危险。
  Date/Author: 2026-09-26 / agent
- Decision: 保留 `createWorktree` 的「分支已被别处检出」前置守卫，并加消息断言，而不是按评审建议删掉它省两行。
  Rationale: 实测 git 的两种占用场景（主检出 / 另一份链接工作树）都会输出 `fatal: '<branch>' is already used by worktree at '<path>'`，经 `REFUSALS` 落成 `invalid_input`——但那依赖 git 的措辞。措辞一变就落到写命令兜底的 `ambiguous_result`，而 core 会把 `ambiguous_result` 拿去 reconcile 并**静默复用**。保留守卫是更小的风险面。
  Date/Author: 2026-09-26 / agent

## 评审响应（2026-09-26，第五轮：由下层套件抓到）

第五轮评审在 **#208**（本层的基线）上提出 6 条意见，其中一条的修复**直接抓到本层的违规**，所以记在这里：

#208 把「能力判定先于身份判定」写成 port 义务并加了判别性断言（未声明的能力对**任何**输入、含外来 binding，都必须答 `not_supported`）。这条断言在本地 Git provider 上立刻变红：`createBranch` / `createWorktree` 把 `ownsRepository` 排在 `flags.*` 之前，于是「能力未声明 + 外来 binding」答的是 `not_found`。

**改法**：两处对调（行数不变，本层仍为 1000/1000）。顺序理由写在 `packages/capabilities/src/development-provider.ts` 的 port 注释里（**一个事实只写一处**），代码里不重复；两个码指向不同的恢复动作——`not_supported` → 转人工，`not_found` → 去平台确认，顺序错了会把调用方引向错误的方向。

**判别性证据**：`node --test tests/contract tests/integration tests/e2e` 在本层上是 `638 / 638 / 0`；把两处对调改回去 → 套件的「外来 binding」用例在 `not_supported` 断言上红。

## 系统级根因分析：五轮 9 条 P1 的共性

本层被连续五轮打回，每轮都有 P1。把九条 P1 按**机制**（而不是按位置、按文件）聚类，只有三族；而且
其中**两族的根不在本层**。这份聚类是第六轮响应的依据，也是「为什么逐条修会一直被打回」的答案。

| 轮次 | P1 | 族 |
|---|---|---|
| 一 | `conflict` 把「可复用」与「不可复用」折成同一个码，core 据此报假 `Ready` | A |
| 二 | `createWorktree` 仍对不可复用的状态报 `conflict`（五个反例） | A |
| 二 | #137 验收 3 在 core 层不成立：同名分支指向别处 → `conflict` → core 静默复用 | A |
| 三 | `prunable` 判定恒为假 → 第二轮反例 C 仍报 `conflict` | A |
| 三 | 派生的默认允许根 `<repo>/.worktrees` 在全新仓库里不存在 → 首个工作树必被拒 | B |
| 四 | 派生的默认允许根跟随符号链接 → 工作树落到仓库之外 | B |
| 四 | 默认分支「不知道」时 core 回落 `main` → 非 `main` 仓库 Start Work 必然失败 | C |
| 五 | 第四轮 P1① 只修了一半：指向仓库**内部**的被跟踪 `.worktrees` 链接仍被跟随 | B |

### A（4 条，连续三轮）：provider 被迫把一个系统级决定编码进一个 provider 局部的错误码

`packages/core/src/git-provisioning.ts` 的 `ensureWorktree` 对**任意** `conflict` 不探测就 `confirmWrite`；
而同一个文件的 `ensureBranch` 会先 `branchProbe`。于是 `conflict` 在分支路径上是「我没建成」，在工作树
路径上是「你可以复用」——同一个码，两个意思。每个 provider 都必须自己重新推导这个承诺，而它**没有写在
port 里**（`packages/capabilities/src/development-provider.ts` 只写了三条**能力**义务），只散落在 #200 与
共享套件的一半里；`packages/providers/fake` 至今仍是「路径被占就 `conflict`，不比分支」。

`ensureWorktree` 之所以不探测，是因为 **port 没有工作树读方法**：分支有 `listBranches` 可以观测，工作树
只有 `createWorktree`，core 没有东西可观测，只能相信 provider 的码。**根在 core 与 capabilities，不在
本层**（→ #212）。

### B（3 条，连续三轮）：允许根这个「策略」是从它要约束的「输入」里推出来的

默认允许根 = `<repo>/.worktrees`，而仓库内容是**不可信输入**。策略由输入决定，是循环的。每一轮都在
「解析结果」上加一层判据（第四轮的 `rootWithin` 判「realpath 之后是否仍在仓库内」），而仓库内容只要换一个
指向就绕过它——第五轮 P1 就是指向仓库内部的形态。正确的形态是判**写法**：检出内的分量不得是符号链接
（一条不变量，与 `..` 分量同一条口径）。第五轮据此改，**判据更强而实现更小**（删掉 `rootWithin` 与它的
归属比较，后者在不变量成立后不可达）。

上游还有一层：`<repo>/.worktrees` 之所以是默认值，是因为 core 的 `worktreePathFor()` 把落点放在检出内。
调研（第六轮，见 `Surprises`）显示**同行默认都放在检出之外**：gwq 用 `~/worktrees`、git-worktree-runner 用
兄弟目录、lazygit 默认 `../worktrees`、VS Code / GitKraken 让用户选；没有任何一个工具从仓库内容推导落点。
放在检出内是本仓库的**孤例**，代价是要额外背一条 `info/exclude` 补偿（16 行实现 + 14 行用例）以及这一族
全部三次 P1。根在 core 的默认落点（→ #214）；本层先把不变量修对。

### C（1 条）：core 在「不知道」处编造输入

`baseRef()` 是 `found.value.defaultBranch ?? 'main'`。本层的基线推断链（14 行）就是为了绕开这个编造而加的
补偿；第五轮 P3「起点 `main` 不存在」不可行动，根仍然是那一行 `?? 'main'`——provider 收到的 `main` 与
仓库里有没有 `main` 无关。**根在 core**（→ #213）。

### 元规律

九条 P1 里有**两条是上一轮 P1 的修复引入的回归**（B-三 由第二轮修复引入，C 由第三轮修复引入），另有一条
（第五轮 B）是上一轮修复的**相邻情形**。这是「逐条修实例」的签名：每修好一个实例，失败就移到相邻的实例
上，因为被修的是实例而不是产生实例的机制。

### 据此本轮的做法

按 `docs/review/responding.md` §2「若意见揭示共享根因，修正单一权威、状态机、边界或契约」，不逐条打补丁：

1. **B 在本层按不变量修**（§9）：判据从「解析结果仍在仓库内」换成「检出内的分量不得是符号链接」。
2. **A 与 C 不在本层加补偿。** 本层已有的 `reuseBlockedBy`（11 行）与基线推断链（14 行）是**今天仍然
   承重**的补偿，保留；但**不再新增**。第五轮 P3 的「可行动的错误信息」因此被驳回（见下节 [6]）——
   provider 判不了「这个名字是 core 编的」，能做的是在 core 里不编。
3. **把跨层的缺失义务写进 ADR-0007**：port 的错误码承载系统级承诺，core 不得用假设代替观测。这条决定
   被推翻会让 port 义务与共享套件重做，符合 `docs/adr/README.md` 的收录标准。
4. **三条根因各开一个 issue**，带独立复现与已否决的方案：#212（工作树读能力）、#213（不编造基线）、
   #214（默认落点移出检出）。

## 评审响应（2026-09-26，第六轮：本轮 6 条未解决 inline）

第六轮 review（GitHub review 2026-09-26T07:38，head `b0e8499`）在 #160 留下 **6 条未解决 inline 意见**
（1×P1、2×P2、3×P3）。**每条都在隔离 worktree 里由独立 agent 自写脚本、跑真实 git 后判定**，不采信
评审者给的输出。结论：**6 条全部属实**；**1 条（[6]）的修法归属被驳回**，理由见该行。

| # | 位置 | 级别 | 是否属实 | 族 | 改法 / 驳回理由 |
|---|---|---|---|---|---|
| 1 | `provider.ts:360` 派生的默认允许根仍跟随**指向仓库内部**的 `.worktrees` 链接 | P1 | 属实。独立复现：`-> src` 时工作树落在被跟踪目录 `src/<id>`，主检出 `git add -A` 把它暂存为嵌入仓库（`info/exclude` 的 `/.worktrees/` 覆盖不到）；`-> .git` 时落在 `.git/<id>/`；两者都 `ready / saved / confirmed`。调研另证 **git 自己不拦**：四种形态 `git worktree add` 全部 exit 0 | B | 判据换成不变量（§9）。三种指向表驱动断言 + 零 Git 调用 + 不留工作树；变异（删判定）→ `23 / 1`，红的正是这条 |
| 2 | `tests/integration/README.md:61` 栈底写了只在 #209 才存在的事实 | P2 | 属实（`git cat-file -e b0e8499:tests/integration/local-git-core-provisioning.test.js` 失败） | 交付边界 | 「本地 Git provider 接进 core（#207）」整节移交 #209；本层 README 与两个测试文件头注改成不指涉不存在的文件 |
| 3 | ExecPlan 六处仍把 `removeWorktree` 写成本层交付物 | P2 | 属实（`provider.removeWorktree === undefined`；第四轮已把它移出，正文没跟上） | 文档一致性 | Purpose、AC5、AC12、D2、遗留问题、issue 偏差六处就地标注 Superseded / 改写 |
| 4 | ExecPlan `:367` 实测读数与验收表停留在被推翻状态 | P3 | 属实（`19` 应为 `903`、`620` 应为 `638`；AC9/13/14 的 `provisionGit` 证据已随 #209 移出） | 文档一致性 | Progress 那两条就地标注为「第四轮当时」并补第五轮条目；AC 表逐条注明哪一半随 #209 |
| 5 | `provider.ts:176` `fromRef` 以 `-` 开头，防线只有 `^{commit}` 后缀 | P3 | 属实，且**当前不可利用**（评审自己的实测：`--help` / `--output=…` 都被后缀挡住） | argv 纪律 | `rev-parse` 加 `--end-of-options`（git 官方对不可信名字的推荐写法）。因不可利用，判别性证据钉 **argv 形状**。另记一条调研事实：`git worktree add` **既不接受** `--end-of-options` **也不接受** `--`，该命令的防线只能是绝对路径（`resolveTarget` 已保证） |
| 6 | `provider.ts:178` 「起点 `main` 不存在」不可行动 | P3 | **属实，但修法归属驳回** | C | `main` 是 core 的 `baseRef()` 用 `?? 'main'` 编出来的；provider 判不了「这个名字是编的」，在 provider 里加提示等于把 core 的兜底写进 provider 的措辞——正是 A/B/C 三族的共同形态。改为在 core 侧不编造（→ **#213**）；provider 保留它真正的义务：点名缺失的 ref |

**过严评估**：没有一条因「更严」被驳回。[6] 是**修法归属**被驳回，不是意见被驳回——意见成立，处置搬到
拥有该事实的层。这与第四轮 [13] 的处置同向（不采纳「删掉守卫省两行」，因为守卫承重）。

### 体量：第五轮实测（需人类裁决，见下）

| 项 | 实测（head 见 PR 描述，`size origin/main`） |
|---|---|
| 代码 | **1014 / 1000**（超出 14） |
| 文档 | 见 `Outcomes` 的回读命令（上限 1500，余量充足） |

**超出全部来自 P1 的修复与它的判别性证据**：实现净增 3 行（`paths.ts` +4、`provider.ts` −1——`rootWithin`
与它的归属比较被删掉，判据反而更强），判别性用例 +9 行，`--end-of-options` 与它的 argv 断言 +6 行。
第四轮把体量压到 1000/1000 的前提是**第四轮的修复不完整**；补完它必然要行数。

**已做的减法**（先找 dead code 再考虑压缩，`AGENTS.md` §5）：本轮最初的重写一度到 1039，随后删掉两处
**我自己加的过度补偿**——provider 侧的基线补救提示（19 行，根在 core，#213）与重复的用例散文，落到 1014。
**没有为凑数字删断言**；`WorktreePathRejection` 的 `reason` 字段全仓零消费（只有 `.ok` / `.path` /
`.message` 被读），是本层唯一剩下的死代码，保留为结构化诊断词汇并在 `Surprises` 登记。

**可选拆法**（若人类要求回到 1000 以内）：把 `tests/contract/development-local-git-source.test.js`（49 行，
argv-only 源码扫描）拆成叠加 PR——它是一个结构类约束，与行为验收不同层，代价是 AC10 的证据与实现分离。

## Bottom Change Note

- 2026-09-24：创建计划（spec + plan 合一），批次 1–5 与验收表落地。
- 2026-09-24：执行完成，补 `Progress`、`Surprises & Discoveries`、`Decision Log` D9–D11、
  `Outcomes & Retrospective` 与真实验证输出；设计章节的规范化说明改成不写具体系统路径。
- 2026-09-24：**对抗验证后修订**。修 P2/P3：分支名规则补齐 git refname 规则并映射
  `not a valid branch name`；套件补"方法缺失必须由快照表达 unavailable"与必填的 `expect.objects`
  副作用断言；`insideRoot` 接受空相对路径 + `is a main working tree` 映射；`getCommit` 只接受对象名并
  回填真实 sha。P1 不改 core，改为在集成测试与本文里点名 **issue #165**。新增变异实验 4/5a/5b/6a/6b/7，
  并订正"零调用"证据与验收表的表述（`Surprises` 5–10、`Decision Log` D12–D15）。
- 2026-09-24：gpt-5.6-sol 独立对抗验收；重读 diff、复跑 5 / 5 issue 标准、全量门禁与一轮路径守卫证伪。结论 `accept_with_findings`，不改代码，仅钉住 head、实测数字、#165 defer 与真实栈/回滚关系。
- 2026-09-24：**第二轮评审响应**。13 条未解决意见全部核实属实，按四组根因一次改完（见上节）：`conflict` 只由显式复用判定产生、
  `failureOf` 收成声明表并补 `remove` 家族、路径不可访问统一走结构化拒绝、`provides` 由能力快照推导、套件无条件证明快照新鲜、
  #165 表征移到关系层、证据数字钉住 head。新增 3 条判别性用例并逐条记录先红后绿；删除 2 条收口条件写错的 `externalId` 断言。
  按"先找 dead code"回收预算：union 1029 → 999，断言一条未删。
- 2026-09-24：**第三轮评审响应**。15 条未解决意见全部核实属实（[11] 是更严、[15] 后半超约束），按根因改：
  允许根与目标统一规范化、`conflict` 正面确认（`reuseBlockedBy`）、分支身份改由 `for-each-ref` 枚举、
  悬空符号链接逐分量 `lstat`、D/F 与大小写变体拒绝分类、`defaultBranch` 不知道返回 `undefined`、
  套件双向断言、索引与评审记录订正。新增 7 个变异实验（M1–M7）与 5 组判别性用例，断言一条未删；
  代码体量 998 → 1121（超出上限，原因与可选拆法见 `Outcomes` 与 D26）。
- 2026-09-26：**第五轮（下层套件）连带修复**。新增「评审响应（2026-09-26，第五轮：由下层套件抓到）」小节：`createBranch` / `createWorktree` 的能力闸门与身份闸门对调，使「能力未声明 + 外来 binding」答 `not_supported` 而不是 `not_found`；行数不变，本层仍为 1000/1000。
- 2026-09-26：**第四轮评审响应 + 交付边界重整**。18 条意见逐条独立复现后按根因改完（见「评审响应（2026-09-26，第四轮）」）；
  §2（套件能力驱动）与 §3（本层实现 `removeWorktree`）就地标注 Superseded；新增 §8–§11 四条设计（基线推断链、
  默认根包含性、分支身份唯一权威、写后回读）；「体量超出（第三轮）」就地作废并给出第四轮实测表。
  交付拆成四层栈：`#205`（套件，基线 `main`）→ 本层（provider）→ `#207`（core 供应序列）→ `#161`（人工执行 provider）。
  人类伙伴 2026-09-26 批准两件事并记入 Decision Log：改 #137 验收条目 3 的 `LOCAL_GIT_FAILURE` 措辞；
  在「拆套件 + 删 `removeWorktree`」仍超限时继续拆出 core 层用例。
- 2026-09-26：**第六轮评审响应 + 系统级根因分析**。6 条未解决 inline 逐条独立复现后全部判为属实，其中 [6]
  的**修法归属**被驳回（根在 core）；新增「系统级根因分析」把五轮 9 条 P1 归成三族并指出两族的根不在本层；
  §9 判据换成不变量并删掉 `rootWithin`；`rev-parse` 加 `--end-of-options`；README 的 #207 一节移交 #209；
  Purpose / AC5 / AC12 / D2 / 遗留问题 / issue 偏差六处就地标注 Superseded；新增 D27–D31 与 ADR-0007，
  并开 #212 / #213 / #214。代码 1014 / 1000（超出 14，来源与可选拆法见「评审响应（第五轮）」的体量小节）。
- 2026-09-26：**Batch 1 W2 路径信任边界**。在本 PR worktree 先写 `alias/new` 反例；删除 ancestor `lstat` 守卫时
  聚焦集成命令为 23 pass / 1 fail，恢复后为 24 pass / 0 fail。实现仅改 `paths.ts` 的 `firstLink` ancestor 检查与集成测试，
  未迁移默认根、未修改 #209/#161 文件；完整门禁结果以本批次提交后的命令回读为准。
