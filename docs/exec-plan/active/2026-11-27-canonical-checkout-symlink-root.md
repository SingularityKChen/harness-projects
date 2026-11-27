# 符号链接检出按 canonical 路径判定允许根 ExecPlan

> 状态：Active
> 创建：2026-11-27
> 范围：issue #340：Local Git 的 `repository.path` 本身是符号链接时，按 canonical 检出判定允许根；允许根位置本身是符号链接时，用点名该布局的消息拒绝。
> 上游输入：issue #340、`AGENTS.md`、`PLANS.md`、`docs/development/workflow.md`、`docs/review/README.md`、`docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md`、`docs/review/pr-328-mmp-review.md`。

## Purpose / Big Picture

完成后，Local Git provider 的两种符号链接布局不再"拒绝对了、原因与消息错了"：

1. `repository.path` 是指向独立检出的符号链接（`alias -> real-checkout`）时，默认工作树根与真实路径派生结果相同，落在 `<real-checkout>.worktrees/<key>`，preflight 与 create 都成功，返回与落盘的都是 canonical 路径。
2. 默认工作树根位置本身是指向 checkout 外目录的符号链接（`<real-checkout>.worktrees -> <outside>`）时，无论目标尾部是否存在，都在任何 Git 命令之前被结构化拒绝，消息点名"允许根本身是符号链接"及其拼写路径，而不是"悬空符号链接"或静默放行。

同时保持 PR #160 建立的承重不变量：允许根落在 `repository.path` 之内时，判定的是**写法**而不是解析结果，检出声明的 `.worktrees -> src`、`.worktrees -> .git`、`.worktrees -> checkout 外` 等链接一律拒绝；Windows 的 plain-path 契约、`..` 拒绝与逃出允许根判定不变。

最小成功证据：`tests/integration/development-local-git.test.js` 中新增/扩展的三处用例在修复前按预期失败、修复后通过；删除 `symlinked_root` 判定的变异让上述用例变红；`pnpm verify` 退出 0。

## Context and Orientation

### 当前代码与失败机制

路径安全集中在 `packages/providers/development-local-git/src/paths.ts` 的 `resolveWorktreePath(rawPath, { repositoryPath, allowedRoot })`。固定判定顺序是：字符串拒绝 → `..` 分量拒绝 → Windows plain-path 检查 → 目标/允许根规范化（最近存在祖先 realpath + 拼回尾部）→ 允许根在检出内的符号链接判定 → 目标尾部悬空链接判定 → 落在允许根内 → 允许调用 Git（零 Git argv 由 `provider.ts` 的预检与注入 runner 断言）。

现有"允许根在检出内的符号链接"判定是：

```ts
const planted = await firstLink(path.resolve(input.repositoryPath), path.resolve(input.allowedRoot))
if (planted !== undefined) return reject('symlinked_root', `允许根在仓库检出内是符号链接：${planted}；请删除该链接或注入仓库之外的 allowedRoot`)
```

`firstLink(ancestor, target)` 的语义是"从 `ancestor` 到 `target` 之间第一个符号链接分量"，但它在检查包含关系**之前**先 `lstat(ancestor)`，是符号链接就直接返回 `ancestor`。当 `repository.path` 本身是符号链接、而允许根在 checkout 外时，`path.resolve(input.repositoryPath)` 就是那条链接，于是返回 `repository.path`、报"允许根在仓库检出内是符号链接"，事实却是 `repository.path` 自己是指向检出的链接。`deriveDefaultRoot` 已经对 `repository.path` 取 `realpath` 并派生出 `<real-checkout>.worktrees`，所以被误拒的是正确目标。

第二种布局是默认根位置本身为符号链接。当前代码没有"根位置是链接"的独立判据：目标尾部不存在时，`canonicalize` 的最近存在祖先就是那条根链接，尾部悬空判定先一步报"路径分量是悬空符号链接：<根>"；目标尾部已存在时 `target.complete === true`，跳过悬空判定，`insideRoot` 以 canonical 根与 canonical 目标比较而成功，于是**静默放行**。同一布局因尾部是否存在得到两种答案，且两种都不是"根位置是链接"。

### 上游依据

- issue #340 的验收：符号链接的 `repository.path` 与真实路径派生同一默认根；默认根位置本身是符号链接时仍拒绝并说明；PR #160/#328 的符号链接逃逸用例保持判别力（删除 `symlinked_root` 必须让测试变红）；`pnpm verify` 通过。
- `docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md` 的 Decision Log（2026-10-14）记录本问题转跟进 #340，并写明"修它要按 canonical 检出判定，会动 PR #160 留下的承重符号链接不变量"。该条结论在本计划实施后需要就地标注 Superseded。
- `docs/review/pr-328-mmp-review.md` 记录 #328 评审把"符号链接检出的 realpath 不可达与两种消息"列为 P3 并转 #340。
- `docs/product/core-release-audit.md` 的 #340 行说明：正式 Host 新绑定先在 `apps/harness-plugin/src/host-repository-binding.ts` 对 `repositoryPath` 取 `realpath` 后再入库，触发面已缩小；默认 Provider 与原始 symlink 配置的错误拒绝仍未修，属于 fail-closed 下的可用性/消息缺陷，不是已发生的越界写。

### 相关文件与当前状态

- `packages/providers/development-local-git/src/paths.ts`：唯一需要改的生产文件（`firstLink`、`resolveWorktreePath`、文件头不变量说明）。
- `packages/providers/development-local-git/src/provider.ts`：`deriveDefaultRoot` 已对 `repository.path` 做 `realpath`；`resolveTarget` 把 `repository.path` 原样传给 `resolveWorktreePath`。本计划**不改**它。
- `apps/harness-plugin/src/host-providers.ts` 的 `localGitRoot` 与 `apps/harness-plugin/src/host-repository-binding.ts`：Host 在绑定期 canonical 化 `repositoryPath` 并注入 profile 外 `allowedRoot`；本计划**不改**它们。
- `tests/integration/development-local-git.test.js`：路径安全、符号链接、默认根用例集中在此；本计划在其中新增 2 条用例、扩展 1 条用例。
- `tests/integration/local-git-fixture.js`：`fixtureFor` 已把临时目录 `realpath`，测试构造符号链接只需 `symlink`。
- `tests/integration/README.md`：路径安全与默认允许根的说明表需要同步一行。
- `docs/README.md`：Active ExecPlan 索引。
- `docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md`：需要就"默认配置下 repository.path 叶子不得是符号链接"追加 Superseded 标注。
- PR #690（`test/windows-worktree-removal-20261124`，state OPEN、draft、Blocked）也修改 `tests/integration/development-local-git.test.js`（+3/−31）与 `tests/integration/local-git-fixture.js`（+29/−1）。本计划不叠在它上面；若它先合入，本计划分支 rebase 后重跑 focused 用例即可（冲突面在同一测试文件，不涉及生产代码）。

### 术语

- **checkout / 检出**：含 Git 工作区的仓库根。本计划的判定锚点沿用 `resolveWorktreePath` 的既有语义，是 `repository.path` 的 canonical 形式，不一定是 Git 识别出的 checkout 根（`provider.ts` 的 `deriveDefaultRoot` 才向上找 checkout 根）。
- **canonical repository path**：POSIX 上 `realpath(path.resolve(repositoryPath))`，失败时退回 `path.resolve(repositoryPath)`；Windows 上保留原拼写。
- **允许根位置（root location）**：`path.resolve(input.allowedRoot)` 这一层目录，不含 `rawPath` 尾部。
- **写法 vs 解析结果**：PR #160 的口径是判定允许根到目标之间的**拼写分量**是否有链接，而不是先 realpath 再判结果。本计划保留该口径，只更换"检出"锚点。

## Design / Spec

### 最终判定顺序（`resolveWorktreePath` 内）

在既有"字符串/.. /Windows plain-path"检查与 `target`、`root` 规范化之后，按以下顺序执行（编号用于测试与变异表引用）：

```ts
const rootSpelling = path.resolve(input.allowedRoot)
const root = await canonicalize(rootSpelling) // 既有逻辑，改用 rootSpelling

// (R1) 允许根在检出内的分量不得是符号链接：锚点换成 canonical repository path，
//      但检查的仍是允许根的写法；写法落在 repository.path 之下时把尾部映射到 canonical 锚点后逐分量 lstat。
const repositorySpelling = path.resolve(input.repositoryPath)
const repositoryCanonical = process.platform === 'win32'
  ? repositorySpelling
  : await realpath(repositorySpelling).catch(() => repositorySpelling)
const inCheckoutSpelling = insideRoot(repositoryCanonical, rootSpelling)
  ? rootSpelling
  : insideRoot(repositorySpelling, rootSpelling)
    ? path.join(repositoryCanonical, path.relative(repositorySpelling, rootSpelling))
    : undefined
if (inCheckoutSpelling !== undefined) {
  const planted = await firstLink(repositoryCanonical, inCheckoutSpelling)
  if (planted !== undefined) return reject('symlinked_root', `允许根在仓库检出内是符号链接：${planted}；请删除该链接或注入仓库之外的 allowedRoot`)
}

// (R2) 允许根位置本身不得是符号链接：目标尾部存不存在都不改变这条判据。
//      必须先于悬空链接判定，否则同一布局会按尾部是否存在分别报"悬空符号链接"或静默放行。
if ((await lstat(rootSpelling).catch(() => undefined))?.isSymbolicLink() === true) {
  return reject('symlinked_root', `允许根本身是符号链接：${rootSpelling}；请改用真实目录或注入非链接的 allowedRoot`)
}

// 既有：目标尾部悬空链接判定、insideRoot 逃逸判定，保持不变。
```

规则不变式：

- **I1（#160 写法判定）**：R1 只把"检出"锚点换成 canonical 路径；被逐分量 `lstat` 的仍是允许根拼写。当 `repository.path` 是 `alias -> real-checkout`、允许根写在其下（`alias/.worktrees/...`）时，尾部映射到 `real-checkout/.worktrees/...` 后逐分量判定，检出内由仓库内容种下的链接仍被拒。
- **I2（根位置独立判据）**：R2 用 `lstat(rootSpelling)` 而不是 `stat`/`realpath`，因此悬空链接与指向存在目标的链接都被判为"根位置是链接"；这也把"尾部存在则静默放行"的旧行为改为确定性拒绝。
- **I3（顺序）**：R1 → R2 → 悬空尾部 → 逃逸。R1 在检出内链接布局给出既有消息（沿用"允许根在仓库检出内是符号链接"）；R2 在根位置链接布局给出点名布局的新消息；R2 先于悬空尾部使消息不受尾部存在性影响。
- **I4（Windows 不变）**：`windowsPathsArePlain([repositoryPath, allowedRoot, candidate])` 仍是 Windows 上的第一道门，逐分量拒绝 reparse 属性；因此 `repositoryCanonical` 在 win32 保留原拼写，R2 在 win32 实际不可达（reparse 已被前一道门拒绝），不引入 realpath 的大小写折叠语义。
- **I5（零 Git argv）**：所有新拒绝都在 `provider.ts` 调用 Git 之前发生；预检本身不执行 Git。
- **I6（返回路径）**：`resolveWorktreePath` 仍返回 `canonicalize(candidate)` 的 `target.path`（canonical 路径）。默认根派生已 realpath，因此 T1 的返回路径与真实路径派生结果逐字相同；不新增"返回前再 canonical 化"逻辑。

### 精确消息

- 检出内链接（不变）：`允许根在仓库检出内是符号链接：<firstLink 结果>；请删除该链接或注入仓库之外的 allowedRoot`
- 根位置链接（新增）：`允许根本身是符号链接：<rootSpelling>；请改用真实目录或注入非链接的 allowedRoot`
- 目标尾部悬空（不变）：`路径分量是悬空符号链接：<link>`
- 逃出允许根（不变）：`规范化后逃出允许根：<target.path>`

新消息不复述链接的解析目标：根位置可能是悬空链接，`realpath` 不可用；拼写路径本身足以让用户定位。Design B 的"（指向 <resolved>）"因此不采用。

### 测试矩阵

新增/扩展都在 `tests/integration/development-local-git.test.js`：

| 编号 | 用例名（新增/扩展） | 关键断言 | 修复前 RED 证据 |
|---|---|---|---|
| T1 | `默认根：repository.path 是符号链接时按 canonical 检出派生同一默认根`（新增，放在 `默认根按真实 checkout 根派生，而不是 repository.path 指向的子目录` 之后） | 不注入 `allowedRoot`；`alias -> repo` 与真实 `repo` 的 preflight 路径相同且等于 `<repo 父目录>/<repo 名>.worktrees/wi-alias`；preflight 期间零 Git argv；`createBranch` + `createWorktree` 成功、返回 canonical 路径、`git worktree list --porcelain` 中出现该 canonical 路径 | preflight 与 create 都答 `invalid_input`，消息为 `允许根在仓库检出内是符号链接：<alias>；…` |
| T2 | `默认根位置本身是符号链接：目标尾部存在与否都在任何 Git argv 之前拒绝并点名该布局`（新增，紧接 T1） | 在派生根 `<repo>.worktrees` 处 `symlink` 到 checkout 外目录；`worktreeKey` 分别为尾部缺失/尾部已存在两种；两种都答 `invalid_input`、消息匹配 `/允许根本身是符号链接/` 且包含派生根拼写；`recordingRunner.calls` 为空；链接目标目录不出现新条目；另以 `resolveWorktreePath` 直接断言 `reason === 'symlinked_root'` | 尾部缺失答 `invalid_input` 但消息为 `路径分量是悬空符号链接：<派生根>`；尾部存在答 `ok: true` 并返回 `<outside>/wi-existing` |
| T3 | 扩展 `显式注入检出内的旧允许根：仓库里的 .worktrees 符号链接一律被拒，指向哪里都一样` | 原三种指向 × 三种锚点拼写：`repositoryPath` 为真实路径且 `allowedRoot` 为检出内链接；`repositoryPath` 为 `alias` 且 `allowedRoot` 为检出内真实拼写；`repositoryPath` 为 `alias` 且 `allowedRoot` 拼写在 alias 下。三种都必须 `invalid_input`、消息匹配 `/允许根在仓库检出内是符号链接/`、消息包含**检出内真实链接路径**而不是 alias、零 Git argv、无工作树残留；末尾删掉链接、创建真实 `repo/.worktrees` 后，alias 实例以 `allowedRoot=repo/.worktrees` 创建成功且路径为 canonical（正控，证明不是"见 alias 就全拒"） | alias 两种拼写的消息指向 `<alias>`（`firstLink` 先 lstat 了自己的祖先），断言失败 |

### 明确不改的文件与契约

- `provider.ts`、`git-runner.ts`、`apps/harness-plugin/src/host-providers.ts`、`apps/harness-plugin/src/host-repository-binding.ts`、`packages/capabilities/**`：不改。
- `WorktreePathRejection` 联合类型不变（仍为 `empty | parent_segment | outside_root | symlinked_root | unresolvable`）；根位置链接复用 `symlinked_root`。
- `resolveWorktreePath` 的入参/返回形状不变；Provider 仍把拒绝映射为 `invalid_input`。
- Windows 行为、workflow、package.json、lockfile、CI 配置不改。

### 被放弃的方案

1. **新增 `root_is_symlink` 拒绝种类**（Design B）：`WorktreePathRejection` 仅被 `paths.ts` 与 `index.ts` 导出，仓库内没有按 reason 分支的消费者（现有测试只断言 `unresolvable`/`symlinked_root` 与 Provider 层 `invalid_input`）。新增枚举值扩大导出面却不产生可观察收益，判定"根位置是链接"与"检出内链接"同属 symlinked_root；消息已经区分布局。
2. **Design B 的 `linkInTail(base, full)` 助手 + 返回路径再 canonical 化**：`firstLink` 已具备逐分量能力，缺的只是锚点与根位置判据；`target.path` 本就由 `canonicalize` 产生，再 canonical 化是重复工作。
3. **Design A 的规则 (2)"canonical 根在 canonical 检出内但拼写不在时拒绝"**：该布局（如 `repositoryPath=repo`，`allowedRoot=<临时根>/x/inner`，`<临时根>/x -> repo`）在基线代码里、当 `repositoryPath` 不是链接时是被**放行**的（显式注入的 canonical 根落在检出内，与现有"显式旧根仍可注入"用例同类）；收紧它不属于 #340 验收，也没有不可信输入在控制 `allowedRoot`。删掉规则 2 不削弱 #160：alias 世界里的检出内写法链接由 R1 的尾部映射覆盖（T3 第 3 种拼写）。
4. **在本 PR 修"目标尾部悬空判定也 lstat 自己的祖先"**：`repository.path` 为 alias 且显式注入的允许根写在 alias 下、根目录或目标尾部尚不存在时，悬空判定仍会先看到 alias 并报"悬空符号链接"（fail closed，但消息仍不准确）。这与本 issue 的两种布局相邻但不同：默认根是 checkout 的 sibling，不经过该分支；显式注入 alias 下根不属于验收。本 PR 只记录残余风险（见 Risks），不为它扩大改动面。
5. **在 win32 上 realpath 化 repository path**：`windowsPathsArePlain` 已用 reparse 属性逐分量拒绝，realpath 在 Windows 只会引入大小写折叠与 UNC/长路径差异；保留原拼写。
6. **只改消息不改判定**：验收要求符号链接 `repository.path` 派生同一默认根并成功创建，纯消息修复不满足。

## Global Constraints

**写集合（唯一声明处；Progress、Decision Log、Bottom Change Note 提到时写"见 Global Constraints"）**

生产（1 个文件）：

- `packages/providers/development-local-git/src/paths.ts`：文件头不变量说明；`resolveWorktreePath` 内 R1/R2 两段规则与 `rootSpelling` 变量。预计 +25/−2 行（含注释），净 +23。

测试（1 个文件）：

- `tests/integration/development-local-git.test.js`：新增 T1、T2；扩展 T3（原符号链接用例）。预计 +80/−6 行。

文档（4 个文件；本计划创建时只写前两个，其余由实施批次完成）：

- `docs/exec-plan/active/2026-11-27-canonical-checkout-symlink-root.md`：本文件（创建）。
- `docs/README.md`：Active 索引 +1 行（创建时写）。
- `tests/integration/README.md`：路径安全/默认允许根表 +2 行（Batch 4）。
- `docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md`：Decision Log 2026-10-14 条追加 Superseded 标注 +2 行（Batch 4）。

**硬约束**

- 仓库规模门：本任务用户上限为代码变更 ≤800 行、文档变更 ≤1300 行（仓库通用硬门 1000/1500 只作为绝对上限，不得越过用户上限）；本计划预计代码 +≈110、文档 +≈360，低于 issue 的 500–800 技术增删目标，属于 issue 文本允许的"coherent small fixes stay small"。
- 只在检出 `fix/symlink-canonical-checkout` 的工作树 `.worktrees/symlink-canonical-checkout` 内工作；基线是 `origin/main`。写入时观察：HEAD = origin/main = `f5b731a4`（2026-11-27 15:39 SGT）；实施前回读 `git -C .worktrees/symlink-canonical-checkout rev-parse HEAD origin/main`，期望两个 40 位 SHA 相同。
- 文档正文中文；代码标识符、路径、命令英文；文档不写本机绝对路径；证据里的执行上下文用仓库内相对路径 `.worktrees/symlink-canonical-checkout`。
- 不改 public ABI / capabilities 契约 / Host 装配 / Windows 契约 / CI 配置 / package.json / lockfile。
- Git 只走 argv；破坏性删除默认不做；本计划**不**创建 commit、不 push、不开/改 PR，不写 GitHub 看板或 Status。
- 不把 PR #690 的改动叠进本分支；若 #690 先合入，rebase 本分支后重跑 focused 套件，不修改 #690 的用例。
- 运行态文件（变异 spec、日志）只写 `.superpowers/`（已 gitignore），不进 `docs/`。

## Plan of Work

### Batch 0 · 基线与依赖准备

**最小闭环**：工作树可跑 focused 套件，记录基线 head 与用例摘要。
**涉及文件**：无 tracked 改动（只生成被忽略的 `node_modules/`）。

步骤：

1. 回读工作树与基线：`git -C .worktrees/symlink-canonical-checkout status --short --branch`、`git -C .worktrees/symlink-canonical-checkout rev-parse HEAD origin/main`。
2. 工作树没有 `node_modules/`（已核实），先安装：`cd .worktrees/symlink-canonical-checkout && pnpm install --frozen-lockfile`。
3. 跑基线 focused 套件：`cd .worktrees/symlink-canonical-checkout && pnpm test:file tests/integration/development-local-git.test.js`。

**验证**：安装退出 0；focused 套件退出 0，摘要 `fail 0`、`skipped 0`（用例数是易失值，按当前 head 重算，不抄写）。若安装因网络/凭据失败，停止并如实报告，不改仓库来绕过。
**回滚**：删除被忽略的 `node_modules/` 即可；无 tracked 改动。

### Batch 1 · 先写 RED 用例

**最小闭环**：三处新增/扩展用例在未改生产代码时按旧行为失败，失败原因可归因。
**涉及文件**：`tests/integration/development-local-git.test.js`。

步骤：

1. 在 `默认根按真实 checkout 根派生，而不是 repository.path 指向的子目录` 之后插入 T1（名称与断言见 Design / Spec「测试矩阵」）。
2. 紧接 T1 插入 T2：用默认 provider（不注入 `allowedRoot`），在 `<fixture 根>/<repo 名>.worktrees` 处建指向 checkout 外目录的符号链接，循环尾部缺失/已存在两种 `worktreeKey`；用 `recordingRunner` 构造 provider 并断言零调用。
3. 扩展原 `显式注入检出内的旧允许根…` 用例：加 `alias -> fixture.repositoryPath`，把"三种指向"扩成"三种指向 × 三种锚点拼写"，加消息断言（必须包含真实检出内链接路径、不能只报 alias），末尾加正控（删链接、建真实 `.worktrees` 后 alias 实例创建成功且为 canonical 路径）。
4. 只跑 focused：`cd .worktrees/symlink-canonical-checkout && pnpm test:file tests/integration/development-local-git.test.js`。

**验证**：退出非 0，且失败恰好来自 T1、T2、T3 扩展；T1 失败于 `invalid_input` 消息 `允许根在仓库检出内是符号链接：<alias>；…`；T2 尾部缺失失败于消息 `路径分量是悬空符号链接：<派生根>`、尾部存在失败于 `ok: true`；T3 alias 拼写失败于消息包含 alias 而不是真实链接路径。其余既有用例保持通过。
**回滚**：`git -C .worktrees/symlink-canonical-checkout checkout -- tests/integration/development-local-git.test.js`。

### Batch 2 · 实现 paths.ts 的 R1/R2

**最小闭环**：focused 套件由红转绿，TypeScript 检查通过。
**涉及文件**：`packages/providers/development-local-git/src/paths.ts`。

步骤：

1. 文件头不变量段落补两句：`repository.path` 自身是符号链接时判定锚点为其 canonical 路径（Windows 保留原拼写，plain-path 门已拒绝 reparse）；允许根位置本身不得是符号链接。
2. 引入 `rootSpelling`，`root` 的 canonicalize 与"允许根不可访问"消息复用它。
3. 用 R1 代码替换现有 `const planted = await firstLink(path.resolve(input.repositoryPath), path.resolve(input.allowedRoot))` 及其 `if`。
4. 在 R1 之后、`if (!target.complete)` 之前插入 R2。
5. 跑：`cd .worktrees/symlink-canonical-checkout && pnpm test:file tests/integration/development-local-git.test.js`，再跑 `pnpm test:file tests/integration/local-git-core-provisioning.test.js` 与 `pnpm typecheck`。

**验证**：focused 两个文件均退出 0、`fail 0`；`pnpm typecheck` 退出 0。额外人工回读：T1 的 `git worktree list --porcelain` 只出现 canonical 路径；T2 两种变体消息逐字相同。
**回滚**：`git -C .worktrees/symlink-canonical-checkout checkout -- packages/providers/development-local-git/src/paths.ts`。

### Batch 3 · 变异与全量门禁

**最小闭环**：新判定各自不可删除，全仓门禁通过。
**涉及文件**：无 tracked 改动；变异 spec 写 `.superpowers/r340-mutants.json`（gitignore）。

步骤：

1. 写变异 spec（`command` 为 focused 测试 argv），至少包含下表 6 个 mutant；用 `node scripts/review-mutate.mjs .superpowers/r340-mutants.json` 在 `.worktrees/symlink-canonical-checkout` 根运行。
2. 跑全量门禁：`pnpm verify`、`pnpm run boundaries`、`node scripts/workflow-check.mjs`、`node scripts/rule-checks.mjs disclosure origin/main`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`。

| 变异 | 锚点/替换 | killedBy |
|---|---|---|
| M1 | 删除 R1 整个 `inCheckoutSpelling` 块 | `显式注入检出内的旧允许根`（T3） |
| M2 | `repositoryCanonical` 改回 `repositorySpelling` | T3（alias 两种拼写的消息断言） |
| M3 | 删除 R2 `lstat(rootSpelling)` 块 | T2 两种变体 |
| M4 | R2 用 `stat`（或 `realpath` 后的目标）代替 `lstat` | T2 尾部已存在变体 |
| M5 | 把 R2 移到 R1 之前 | T3 消息断言（会变成"允许根本身是符号链接"） |
| M6 | `inCheckoutSpelling` 去掉 alias 尾部映射分支 | T3 第三种拼写（alias 下 root 拼写） |

**验证**：变异脚本退出 0 且每个 mutant 都报 KILLED（归因到上表用例名片段）；全量命令全部退出 0；`size` 检查退出 0，且 `git diff --numstat origin/main...HEAD` 回读代码 ≤800、文档 ≤1300（本任务用户上限）。
**回滚**：变异脚本按字节还原；若中断，用 `git -C .worktrees/symlink-canonical-checkout checkout -- packages/providers/development-local-git/src/paths.ts tests/integration/development-local-git.test.js`；删除 `.superpowers/r340-mutants.json`。

### Batch 4 · 文档同步与交接

**最小闭环**：仓库内文档不再描述旧约定，索引与 Superseded 标注就位，PR 描述素材齐全。
**涉及文件**：`tests/integration/README.md`、`docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md`、`docs/README.md`。

步骤：

1. `tests/integration/README.md` 路径安全行补"允许根位置本身是符号链接时点名拒绝"；默认允许根行补"符号链接的 repository.path 按 canonical 检出派生同一默认根"。
2. 在 `docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md` 的 Decision Log 2026-10-14「符号链接检出」条末尾追加 `Superseded by docs/exec-plan/active/2026-11-27-canonical-checkout-symlink-root.md（2026-11-27）：repository.path 叶子符号链接现按 canonical 检出判定，默认根位置链接单独点名拒绝`。
3. 更新本计划 `Progress` 与 `Outcomes & Retrospective`；`docs/README.md` 的该行用途文字在完成后由归档步骤改状态（本 PR 合并前保持 Active）。
4. 交接给 Lead：整理提交、push、创建 draft PR 与回读（本计划不执行 GitHub 写）。PR 描述需包含闭环、ExecPlan+Batch、`Closes #340`、真实证据、风险、回滚。

**验证**：`cd .worktrees/symlink-canonical-checkout && pnpm test:file tests/contract/plan-facts-consistency.test.js` 退出 0（文档引用不悬空）；`node scripts/rule-checks.mjs disclosure origin/main` 退出 0；`git diff --stat origin/main...HEAD` 与 Global Constraints 的写集合一致（只有 paths.ts、测试文件、四个文档）。
**回滚**：反向编辑三个文档；本计划在合并前保持 Active，不提前移入 `completed/`。

## Validation and Acceptance

复跑处见 Plan of Work；这里只给验收映射。

| # | 验收项（issue #340） | 判定证据 |
|---|---|---|
| AC1 | 符号链接 `repository.path` 与真实路径派生同一默认根并成功建树 | T1；`git worktree list --porcelain` 回读 canonical 路径；Batch 2 的两个 focused 文件绿 |
| AC2 | 默认根位置本身是符号链接时仍拒绝，消息说明该布局 | T2 两种尾部变体；消息 `/允许根本身是符号链接/`；零 Git argv |
| AC3 | #160/#328 的符号链接逃逸判别力保留 | T3 + 变异 M1/M2/M5/M6 KILLED；原 `越界、含 .. 与符号链接逃逸`、`已存在的目标祖先是符号链接` 等既有用例保持绿 |
| AC4 | `pnpm verify` 通过 | Batch 3 的 `pnpm verify` 退出 0 |
| AC5 | 不改 Provider/Git/Host 契约与 Windows 行为 | `git diff --stat origin/main...HEAD` 不含 `provider.ts`、`git-runner.ts`、`apps/harness-plugin/`、`packages/capabilities/`、workflow/package.json/lockfile；win32 分支只在 R1 的三元表达式保留原拼写 |
| AC6 | 规模门 | `node scripts/rule-checks.mjs size origin/main` 退出 0，且 `git diff --numstat origin/main...HEAD` 的代码（排除锁文件/生成目录）≤800、文档 ≤1300；预计代码 +≈110、文档 +≈360 |
| AC7 | 真实产品路径不被夸大 | PR 描述写明 Host 绑定期已 canonical 化 `repositoryPath`，本修复主要恢复直接构造 Provider 与原始 symlink 配置；不关闭 #338（"只检查最后一个根分量"）也不改 R1 |

## Progress

- [x] （2026-11-27 15:39 SGT，评审/收敛 agent）取证：在检出 `fix/symlink-canonical-checkout` 的工作树 `.worktrees/symlink-canonical-checkout` 上核对了 `paths.ts`、`provider.ts` 的 `deriveDefaultRoot`/`resolveTarget`、Host 的 `localGitRoot`/`preflightRepositoryBinding`、`tests/integration/development-local-git.test.js` 的相关用例、`docs/exec-plan/completed/2026-10-13-worktree-root-outside-checkout.md` 与 `docs/review/pr-328-mmp-review.md`；确认两份设计对失败机制的描述属实。
- [x] （2026-11-27 15:52 SGT）在仓库外临时目录只读复现（不碰仓库、不建工作树）：符号链接 `repository.path` 的 preflight/create 答 `invalid_input` 且消息指向 alias；默认根位置符号链接在尾部缺失时答"悬空符号链接"、尾部存在时 `ok: true`；alias 锚点下检出内链接的消息指向 alias。用临时目录内的 `paths.ts` 原型验证了 R1/R2 的预期输出与默认根端到端创建。
- [x] （2026-11-27 15:54 SGT）两份设计收敛：采用 Design A 骨架但删去其规则 (2)，拒绝 Design B 的新拒绝种类/助手/返回路径再 canonical 化；判定与测试矩阵落在 Design / Spec（见 Decision Log D1–D8）。
- [x] （2026-11-27 15:54 SGT）创建本计划并更新 `docs/README.md` Active 索引；写集合见 Global Constraints。
- [ ] Batch 0：安装依赖、focused 基线绿（未开始）。
- [ ] Batch 1：T1/T2/T3 先红（未开始）。
- [ ] Batch 2：`paths.ts` R1/R2 转绿（未开始）。
- [ ] Batch 3：6 个变异 KILLED + `pnpm verify`/boundaries/workflow/disclosure/size/diff-check 全绿（未开始）。
- [ ] Batch 4：文档同步、Superseded 标注与 Lead 交接（未开始）。

## Surprises & Discoveries

- 2026-11-27：bug 的直接机制不是"realpath 不可达"，而是 `firstLink` 在判包含关系之前先 `lstat(ancestor)`。因此"把判定锚点换成 canonical 检出"本身不足以描述最小修复：还必须把允许根**拼写**在 alias 下的尾部映射到 canonical 锚点，否则 alias 世界里的检出内链接会漏判（原型验证：仅换 `firstLink` 锚点但去掉尾部映射时，`allowedRoot=alias/.worktrees` 会以"允许根本身是符号链接"拒绝，而不是检出内消息）。
- 2026-11-27：默认根位置符号链接的两种旧答案都复现了，且 `provider.preflightWorktree` 对两种答案都零 Git argv：尾部缺失 `invalid_input` 消息 `路径分量是悬空符号链接：<派生根>`；尾部存在 `ok: true` 返回 `<outside>/wi-existing`。这证明 issue 里"不一致"是行为差异而不只是文案差异。
- 2026-11-27：`repository.path` 为 alias 时，`deriveDefaultRoot` 的 realpath 已经给出正确 canonical root，失败只发生在随后 `resolveWorktreePath` 的检出内链接判定；因此修复面可以停留在 `paths.ts`，`provider.ts`/Host 不需要改。
- 2026-11-27：不修 Design A 规则 (2) 时，`repositoryPath` 为真实路径、`allowedRoot` 经检出外中间链接落进检出内的布局在基线上是放行的（与"显式旧根仍可注入"同类）；收紧要另立验收，不在 #340。
- 2026-11-27：残余但已确认 fail closed 的相邻行为：`repositoryPath` 为 alias 且显式注入的允许根写在 alias 下、根目录或尾部尚不存在时，目标尾部悬空判定仍会先看到 alias 并报"悬空符号链接"。默认根是 checkout 的 sibling，不经该分支；本计划不为它扩大改动面（见 Risks）。
- 2026-11-27：PR #690（draft、Blocked）修改同一测试文件；本分支不得叠在它上面，合并顺序由 Lead 的合并队列处理。

## Decision Log

- D1（2026-11-27，评审/收敛 agent）：**复用 `symlinked_root`，不新增 `root_is_symlink`**。Rationale：该拒绝种类只被 `paths.ts` 导出、仓库内没有按 reason 分支的消费者；新增枚举值扩大导出面却无可观察收益，消息已按布局区分。Design B 的此项不采用。
- D2（2026-11-27）：**规则顺序 R1 → R2 → 悬空尾部 → 逃逸**。Rationale：R1 保持"检出内链接"既有消息与 #160 测试口径；R2 先于尾部判定，使根位置链接的消息不随尾部是否存在变化（issue 要求"消息说明"）；悬空尾部判定继续覆盖目标路径里的悬空链接与"已存在祖先链接"用例。
- D3（2026-11-27）：**不实现 Design A 的规则 (2)（canonical 根在 canonical 检出内但拼写不在时拒绝）**。Rationale：该布局在基线（`repositoryPath` 非链接）被放行，属于显式注入根的既有权衡；收紧超出 #340 验收，且没有不可信输入控制 `allowedRoot`。alias 世界的检出内写法链接由 R1 尾部映射保留（T3 第三种拼写）。
- D4（2026-11-27）：**不新增 `linkInTail` 助手、不在返回前再 canonical 化**。Rationale：`firstLink` 已逐分量实现，缺的是锚点；`target.path` 已由 `canonicalize` 产生，重复 canonical 化不改变可观察结果。
- D5（2026-11-27）：**新消息不复述解析目标**：`允许根本身是符号链接：<rootSpelling>；请改用真实目录或注入非链接的 allowedRoot`。Rationale：悬空根链接没有 `realpath` 结果；拼写路径足以定位，消息不必引入第二次系统调用。
- D6（2026-11-27）：**win32 保留原拼写**。Rationale：`windowsPathsArePlain` 先于一切 realpath 逐分量拒绝 reparse；win32 realpath 只会引入大小写折叠/UNC 差异。既有 Windows 契约与用例不变。
- D7（2026-11-27）：**测试为 2 新增 + 1 扩展（含正控），不放宽既有用例**。Rationale：三条用例各自对应 AC1/AC2/AC3；扩展原符号链接用例而不是另起一条，避免同一不变量两份台账。T3 末尾正控防止"见 alias 就全拒"的过宽修复。
- D8（2026-11-27）：**不为相邻的"尾部悬空判定 lstat 自己的祖先"扩大改动**。Rationale：issue 的两种布局不需要它；默认根不经过该分支；扩大会改既有"目标祖先是符号链接"语义的判定面，需要单独验收。残余写入本计划 Idempotence and Recovery / Risks。
- D9（2026-11-27）：**规模低于 issue 的 500–800 目标**。Rationale：issue 现行 disposition 明确"coherent small fixes stay small"；本修复生产 +≈25/−2、测试 +≈80/−6、文档 +≈360，均低于本任务用户上限 800/1300。若实施时发现需要超界，先回写本计划 Decision Log 再继续。
- D10（2026-11-27）：**Completion 语义**：本 PR 只修 Provider 路径判定与消息，不关闭 #338，不改 R1/发布状态、不改看板 Status；合并与否由人类伙伴决定。
- 需要人类决定的事项（当前不阻塞实现）：若确认存在依赖"显式注入的符号链接 allowedRoot 在尾部存在时可用"的仓库外消费者，需要人类决定是否保留该旧行为（当前未发现消费者；Host 注入的是 `worktreesDir/<hash>` 真实目录）。以及是否为本计划 D8 的残余另开 follow-up issue——本计划不创建 issue。

## Idempotence and Recovery

- 所有批次可重复执行：`pnpm install --frozen-lockfile` 幂等；focused 命令不改仓库状态；`review-mutate.mjs` 在施加前按字节读入原文、结束/中断时写回并逐字节比对；spec 文件在被忽略的 `.superpowers/`。
- 失败恢复：Batch 1 失败 → `git checkout -- tests/integration/development-local-git.test.js`；Batch 2 失败 → `git checkout -- packages/providers/development-local-git/src/paths.ts`；Batch 3 中断 → 先确认变异脚本已还原两个文件（`git status --short` 只剩本计划的文档改动），再重跑。
- 已知良好状态：基线 `origin/main` 的 focused 套件绿；任何批次结束都应保持 `pnpm test:file tests/integration/development-local-git.test.js` 绿，除非正处于 Batch 1 的预期 RED。
- 残余（不修，fail closed）：`repositoryPath` 为符号链接 alias、显式注入的 `allowedRoot` 写在 alias 下且根/尾部尚不存在时，仍可能报"悬空符号链接"而不是"根位置是链接"。默认根不经过该分支；显式注入 alias 下根没有已知消费者。若后续要修，应另行立 issue，并从"悬空尾部判定的锚点"统一设计，不在本 PR 追加。
- 回滚边界：本 PR 只改路径判定与文档；回滚 = 反向提交，不迁移/删除任何用户工作树，不动数据库或 Host 状态。

## Risks

- RK1：canonical 锚点改变了 alias 布局的拒绝路径与消息（此前 fail closed 但消息指向 alias）；由 T1/T3 与 M2/M6 覆盖。残余风险是仓库外直接构造 Provider 的调用方按旧消息做字符串匹配——仓库内没有这种消费者。
- RK2：R2 把"根位置是链接、尾部已存在"从静默放行改为拒绝，可能在仓库外存在依赖该行为的调用方；已搜索仓库内 `allowedRoot` 使用点，Host 注入的是真实目录，测试均以拒绝为预期。PR 描述需点名这是有意收紧（fail closed）。
- RK3：D8 的相邻残余（alias 下显式根拼写 + 尾部缺失仍报悬空消息）保持 fail closed；不关闭 issue 前需在 PR 描述与本计划中如实写出，不称"所有 symlink 布局消息都已修正"。
- RK4：macOS 的 `/var -> /private/var` 等系统符号链接祖先：R2 只 `lstat` 根位置叶子，测试夹具又先 `realpath` 临时目录，不会误伤；T2 的根位置链接是测试自建，目标存在与缺失两种都覆盖。
- RK5：PR #690 同时改 `tests/integration/development-local-git.test.js` 与 `tests/integration/local-git-fixture.js`（draft/Blocked）。本分支基于当前 `origin/main` 不叠栈；若 #690 先合入，rebase 后重跑 focused，冲突按 #690 的用例组织方式解决，不重复其断言。
- RK6：Windows lane 在 CI 上跑 `development-local-git-windows.test.js`，本文件的用例不在该 lane；win32 行为不变由代码路径（保留原拼写、plain-path 先判）与 diff 审查保证，本机不伪造 Windows 证据。
- RK7：`pnpm verify` 依赖工作树内安装（当前工作树无 `node_modules/`）。若环境离线或凭据缺失导致 Batch 0 失败，停止并把未验证项写成阻塞，不用局部命令冒充全量门禁。
- RK8：issue 的 500–800 行目标与实测 +≈110 的差距由 D9 承担；若人类要求扩大到目标区间，需要另立判别性测试（例如 Windows/CI 组合），不能为凑行数复制台账。

## Interfaces and Dependencies

| 依赖/接口 | 用途 | 约束 |
|---|---|---|
| Node ≥26（当前 v26.13.1）、pnpm 10.28.2 | 运行测试与 TypeScript 检查；工作树需 `pnpm install --frozen-lockfile` | 由根 `package.json` 的 engines/packageManager 固定，不改 |
| `node --test` 与 `scripts/run-test-layer.mjs` | focused 与全量测试入口 | 摘要行 `tests/skipped/fail` 是唯一计数锚点；易失值按当前 head 重算 |
| `scripts/review-mutate.mjs` | 变异判别（Batch 3） | spec 形状见脚本文件头；只写被忽略的 `.superpowers/` |
| `scripts/rule-checks.mjs`、`scripts/workflow-check.mjs` | 发布面与规模门 | 在检出 `fix/symlink-canonical-checkout` 工作树运行，base 参数 `origin/main` |
| Git 2.x（argv-only） | 测试夹具与 provider 行为 | 不新增 shell 拼接；不执行破坏性 Git |
| GitHub CLI `gh` | 只读回读 issue #340、PR #690 合并顺序 | 命令带 `-R SingularityKChen/harness-projects`；本计划不做 GitHub 写 |
| `resolveWorktreePath`（`paths.ts` 导出） | Local Git Provider 与 Host 准入共用的路径判定 | 入参/返回形状、`WorktreePathRejection` 联合类型不变 |
| Host 装配（`host-providers.ts`/`host-repository-binding.ts`） | 产品路径的 `repositoryPath` canonical 化与 `allowedRoot` 注入 | 不改；本修复不改变其调用契约 |

## Outcomes & Retrospective

本计划创建时尚未实施。预期结果与判定：

- 实施后，issue #340 的四条验收由 T1/T2/T3、变异 M1–M6 与 `pnpm verify` 覆盖；PR 描述引用本计划 Batch 与证据。
- 与计划的预期偏差：若实施发现 R2 与某个既有用例冲突（例如某测试把符号链接当作合法 `allowedRoot`），以 issue 验收与"根位置不得是链接"不变量为准，并在本计划 Decision Log 追加处置，不静默放宽。
- 不声称：关闭 #338（只检查最后一个根分量）、Windows 原生行为变化、已安装产品/R1 接受。产品侧新绑定仍先 canonical 化 `repositoryPath`，本修复主要恢复默认 Provider 与原始 symlink 配置的可用性与消息准确性。
- 归档条件：全部批次完成、PR 合并后，把本文件移到 `docs/exec-plan/completed/`（文件名不变）并更新 `docs/README.md` 索引状态；本计划创建时不执行。

## Bottom Change Note

- 2026-11-27 15:54 SGT：创建本计划。依据 issue #340、PR #328/#160 的历史证据、两份独立的符号链接修复设计，以及在本检出上的只读复现与原型的预期输出；写集合见 Global Constraints。
